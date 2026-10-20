---
title: "MongoDB Indexes in Depth"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# MongoDB Indexes in Depth

*20 min read · Updated 12 Oct 2026 · Topic 99 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and MongoDB 8.2.6 (run locally via mongodb-memory-server's downloaded mongod binary, no Docker), `mongodb` driver 7.7.0

---

## Why it matters

[Lesson 68](68-schema-design-amp-data-modeling.md) introduces indexes and the ESR rule in a few paragraphs. In production most MongoDB performance and correctness questions come back to them. A login that takes 300 ms is a collection scan. "Email must be unique, but deleted accounts may reuse it" is a partial unique index. "Delete sessions after 30 minutes" is a TTL index. A page that is fast with 20 results and slow with 2,000 is an in-memory sort. Each of these is a choice of index *type* or *field order* that you can check with one `explain()` call.

Indexes also cost something. Each one is a second structure that every insert, update and delete has to maintain. Building one on a large collection takes time and locks, and an index the planner cannot use for your query only adds write cost. This lesson measures those trade-offs instead of asserting them.

## The concept, simply

An index is a separate, sorted structure (a B-tree in WiredTiger) of `(key value → record id)` entries for one field or a list of fields. Because the keys are sorted, the server can *seek* to the first matching key and walk forward, instead of opening every document and testing the filter. The same sort order also lets it return results already sorted, with no sort step. Without a usable index, the plan is `COLLSCAN`: read every document.

![With an index vs without: on the left a collection scan reads and checks every document; on the right a B-tree lookup follows a sorted tree from the root to the matching entry](assets/i41_02_00012497.svg)
*Figure: a collection scan versus a B-tree lookup. Look at: the left side touching every document, against the right side's single path from root to "hit". In `explain` terms, an indexed point lookup examines 1 key and 1 document (Example 1).*

The index types in this lesson are all variations on that structure:

| Type | Key it stores | What it is for |
|---|---|---|
| Single / compound | Field values, in the order you list them | Equality, ranges and sorts on those fields |
| Unique | Same, but the server rejects a duplicate key (`E11000`) | Natural keys such as email |
| Partial | Only documents that match `partialFilterExpression` | Smaller index; "unique among active" rows |
| Sparse | Only documents that *have* the field | Optional fields (older form of partial) |
| TTL | A date field, plus `expireAfterSeconds` | Background deletion of expired documents |
| Text | Stemmed words from string fields | `$text` word search with a relevance score |
| Wildcard | `(path, value)` for every field under a path | Arbitrary or user-defined attribute keys |
| Hashed | A hash of the value | Equality lookups and hashed shard keys ([lesson 72](72-mongodb-sharding.md)) |

## How it works

What happens when a `find` reaches the server:

1. The server parses the filter, sort and projection into a query shape.
2. Starting in 8.0, a limited set of simple queries skips regular planning. In the runs for this lesson, an equality match on `_id` and one on a unique single-field index both ran as an `EXPRESS_IXSCAN` stage (new in version 8.0).
3. Otherwise the planner lists every index that *can* answer the query. A compound index qualifies if the query constrains a *prefix* of it. A partial index qualifies only if the filter implies its `partialFilterExpression`.
4. For each candidate it builds index bounds, such as `status: ["paid","paid"], total: [100, inf]`.
5. If there is more than one candidate, the candidates race for a trial period. The winner is cached in the plan cache for that query shape.
6. The winning plan runs. `IXSCAN` walks the bounds, `FETCH` loads each document, and `SORT` runs in memory if the index order does not already give the requested sort.
7. `explain('executionStats')` reports what happened: `totalKeysExamined`, `totalDocsExamined`, `nReturned`, `executionTimeMillis` and the stage tree.

**Reading `explain`.** The ratio to watch is examined versus returned. A plan with `totalKeysExamined: 21` for 20 returned is close to ideal. `totalKeysExamined: 36000` for 20 returned means the index narrowed the scan, but the server still read 36,000 entries and sorted them to keep 20. A `SORT` stage means the order came from an in-memory sort and not from the index. That sort is bounded by a memory limit (`internalQueryMaxBlockingSortMemoryUsageBytes`, 100 MB by default) and spills to disk when `allowDiskUse` is set.

**The ESR rule.** For a compound index, list **E**quality fields first, then the **S**ort field, then **R**ange fields. The reason is the B-tree order. Inside one equality value (`status: 'paid'`) the keys are ordered by the next field. If that next field is the sort field (`createdAt`), walking the keys returns rows already in sort order, and `limit(20)` can stop after 20 keys. The range field (`total`) is tested on the key itself before the document is fetched. If the range field comes second (`{ status, total, createdAt }`), the keys inside `paid` are ordered by `total`, not `createdAt`. The server must read every key with `total >= 100` and sort them in memory. Example 2 measures exactly this.

**Prefixes.** A compound index on `{ a, b, c }` can seek on `{ a }`, `{ a, b }` and `{ a, b, c }`. It cannot seek on `{ b }` or `{ c }` alone, because the keys are not sorted by `b` across different `a` values.

**Partial vs sparse.** A sparse index leaves out documents that do not have the field. It still includes documents where the field is explicitly `null`. A partial index leaves out documents that do not match a filter expression, so it can do everything sparse does and more. The sparse-index page of the MongoDB docs points to partial indexes when you need more control. Both have the same planner restriction: the server will not use them for a query whose results could include documents the index left out, unless you `hint` it, and then those documents silently go missing (Example 4).

**TTL.** A TTL index is a normal single-field index on a date field (or an array of dates), plus `expireAfterSeconds`. A background thread, the TTL monitor, wakes up every 60 seconds (the `ttlMonitorSleepSecs` server parameter, which reported `60` on the 8.2.6 server used here). It deletes documents whose date plus `expireAfterSeconds` is in the past. Deletion therefore never happens before the deadline, and is up to about a minute late, more under heavy load. A document whose field is missing, or is not a BSON date (a string such as `"2026-10-12T…"`), never expires. On a replica set, only the primary runs the deletes, and they replicate like any other delete.

**Text, wildcard, hashed.**

- **Text.** A text index tokenises and stems words ("Indexing" → "index") and supports `$text` with a `textScore`. All of a collection's text fields go into one text index, because a collection can have only one.
- **Wildcard.** A wildcard index (`'attrs.$**': 1`) stores a `(path, value)` key for every field under `attrs`. So `attrs.color` and `attrs.lengthM` are both indexed, without knowing those field names in advance.
- **Hashed.** A hashed index stores a hash of the value. Equal values have equal hashes, so equality works. Ranges and sorts do not, because hashing destroys the order. A hashed index cannot be unique either.

**Index builds in 8.x.** The MongoDB 8.x manual ([Index Builds on Populated Collections](https://www.mongodb.com/docs/manual/core/index-creation/)) describes these stages and locks:

1. Take an exclusive `X` lock on the collection, briefly, to set up the build. The setup creates a "side writes" table for writes that arrive during the build and a constraint-violation table.
2. Downgrade to an intent-exclusive `IX` lock and scan the collection. The `IX` lock is yielded periodically, so reads and writes continue. Keys go to an external sorter, which uses `maxIndexBuildMemoryUsageMegabytes` (200 MB by default on self-hosted deployments) and then temporary files.
3. On a replica set, wait for the *commit quorum* (all data-bearing voting members by default). Changed in 8.0: the commit quorum now counts members that are *ready* to commit, and the write concern then decides how many must have replicated the commit.
4. Take a shared `S` lock (writes blocked) only while the remaining side writes are drained.
5. Take an exclusive `X` lock, briefly, to apply the last side writes, check constraint violations (for example duplicates for a `unique` index) and mark the index ready.

Starting in 7.1, errors found during the scan, other than duplicate-key errors, stop the build immediately instead of at commit. The `indexBuildMinAvailableDiskSpaceMB` parameter can stop a build when disk is low. Example 7 measures the practical effect: inserts on the same collection kept completing during a build on 500,000 documents.

## Code examples

Each example is a standalone ES module. Run it with `MONGO_URL=mongodb://127.0.0.1:<port>/ node file.mjs` after `npm install mongodb@7.7.0`, against MongoDB 8.2.6 run locally via mongodb-memory-server's downloaded mongod binary (no Docker). Each script drops and recreates its own database. Timings were measured on a Linux x64 laptop. Key and document counts are exact and repeat on every run. Millisecond values change between runs.

**Example 1 — collection scan vs index, build time, and writes during the build (500,000 documents).** A second client inserts into the same collection in a loop while `createIndex` runs, and a third loop polls `currentOp` for the build.

javascript

```
// build.mjs — scan vs index on 500,000 docs, build time, and writes running during the build
import { MongoClient } from 'mongodb';
import { setTimeout as sleep } from 'node:timers/promises';

const url = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/';
const client = new MongoClient(url), writer = new MongoClient(url);
const db = client.db('indexes_build');
await db.dropDatabase();
const users = db.collection('users');
for (let b = 0; b < 25; b++) {
  await users.insertMany(Array.from({ length: 20_000 }, (_, i) => {
    const n = b * 20_000 + i;
    return { email: `user${n}@example.com`, plan: n % 3 ? 'free' : 'pro', signupDay: n % 365 };
  }));
}

const show = async (label) => {
  const e = await users.find({ email: 'user424242@example.com' }).explain('executionStats');
  const w = e.queryPlanner.winningPlan;
  const stages = [...JSON.stringify(w.queryPlan ?? w).matchAll(/"stage":"(\w+)"/g)].map(m => m[1]);
  console.log(label.padEnd(14), stages.join('<-'),
    `keys=${e.executionStats.totalKeysExamined} docs=${e.executionStats.totalDocsExamined} ms=${e.executionStats.executionTimeMillis}`);
};
await show('before index:');

// Build the index while a second client keeps inserting into the same collection
let building = true, inserted = 0, worst = 0, sawBuild = false;
const writes = (async () => {
  const col = writer.db('indexes_build').collection('users');
  while (building) {
    const t = performance.now();
    await col.insertOne({ email: `live${inserted}@example.com`, plan: 'free', signupDay: 0 });
    worst = Math.max(worst, performance.now() - t);
    inserted++;
  }
})();
const watch = (async () => {
  while (building) {
    const { inprog } = await writer.db('admin').command({ currentOp: 1, 'command.createIndexes': 'users' });
    if (inprog.length) sawBuild = true;
    await sleep(50);
  }
})();
const t0 = performance.now();
await users.createIndex({ email: 1 }, { unique: true });
const buildMs = performance.now() - t0;
building = false;
await Promise.all([writes, watch]);

console.log(`build: ${Math.round(buildMs)} ms for ${await users.countDocuments()} docs`);
console.log(`during the build: ${inserted} inserts succeeded, slowest ${Math.round(worst)} ms, build seen in currentOp: ${sawBuild}`);
await show('after index:');
await client.close(); await writer.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   before index:  COLLSCAN keys=0 docs=500000 ms=250
//   build: 1094 ms for 503132 docs
//   during the build: 3132 inserts succeeded, slowest 11 ms, build seen in currentOp: true
//   after index:   EXPRESS_IXSCAN keys=1 docs=1 ms=0
```

Before the index, finding one email reads all 500,000 documents. After it, the lookup is an `EXPRESS_IXSCAN` (the 8.0 fast path for an equality match on a unique single-field index) and examines 1 key and 1 document. The build on roughly half a million small documents took about a second. During that time the writer's inserts kept succeeding, with the slowest single insert taking milliseconds, not the whole build. That matches the docs: the collection is exclusively locked only at the start and the end. Writes made during the build go through the side-writes table, which is why the final count includes the `live…` documents and the unique index still built.

**Example 2 — the ESR rule, measured on 200,000 orders.** The query is "paid orders of 100 or more, newest first". The same query is forced (`hint`) onto no index, an E-R-S index and an E-S-R index. Each line is the last of 5 `explain('executionStats')` runs, with the median `executionTimeMillis` of the 5.

javascript

```
// esr.mjs — the same query against no index, an E-R-S index and an E-S-R index
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('indexes_esr');
await db.dropDatabase();
const orders = db.collection('orders');

// 200,000 orders: 5 statuses, totals 0–999, one order per minute
const STATUSES = ['pending', 'paid', 'shipped', 'cancelled', 'refunded'];
const t0 = Date.UTC(2026, 0, 1);
const docs = Array.from({ length: 200_000 }, (_, i) => ({
  status: STATUSES[i % 5], total: (i * 7919) % 1000, createdAt: new Date(t0 + i * 60_000), customerId: i % 5000,
}));
for (let i = 0; i < docs.length; i += 20_000) await orders.insertMany(docs.slice(i, i + 20_000));

await orders.createIndex({ status: 1, total: 1, createdAt: -1 }, { name: 'E_R_S' });
await orders.createIndex({ status: 1, createdAt: -1, total: 1 }, { name: 'E_S_R' });

// "Paid orders of 100 or more, newest first, first page"
const filter = { status: 'paid', total: { $gte: 100 } }, sort = { createdAt: -1 };

const stages = (p) => [p.stage, ...(p.inputStage ? stages(p.inputStage) : []), ...(p.inputStages ?? []).flatMap(stages)];
async function measure(label, hint, limit = 20) {
  const times = [];
  let last;
  for (let run = 0; run < 5; run++) {
    last = await orders.find(filter).sort(sort).limit(limit).hint(hint).explain('executionStats');
    times.push(last.executionStats.executionTimeMillis);
  }
  const s = last.executionStats, plan = last.queryPlanner.winningPlan.queryPlan ?? last.queryPlanner.winningPlan;
  times.sort((a, b) => a - b);
  console.log(label.padEnd(30), `stages=${stages(plan).join('<-')}`.padEnd(32),
    `keys=${s.totalKeysExamined} docs=${s.totalDocsExamined} returned=${s.nReturned} medianMs=${times[2]}`);
}
await measure('no index (COLLSCAN)', { $natural: 1 });
await measure('{status, total, createdAt} ERS', 'E_R_S');
await measure('{status, createdAt, total} ESR', 'E_S_R');

console.log('--- no limit: every matching order');
await measure('{status, total, createdAt} ERS', 'E_R_S', 0);
await measure('{status, createdAt, total} ESR', 'E_S_R', 0);

// What the planner picks on its own when both indexes exist
const auto = await orders.find(filter).sort(sort).limit(20).explain('queryPlanner');
console.log('planner picks:', (auto.queryPlanner.winningPlan.queryPlan ?? auto.queryPlanner.winningPlan).inputStage?.indexName
  ?? JSON.stringify(auto.queryPlanner.winningPlan).match(/"indexName":"(\w+)"/)[1]);

// Prefix rule: both indexes start with status, so a query without status cannot seek into them
for (const f of [{ status: 'paid' }, { total: { $gte: 990 } }]) {
  const w = (await orders.find(f).explain()).queryPlanner.winningPlan;
  console.log(JSON.stringify(f).padEnd(26), '->', JSON.stringify(w.queryPlan ?? w).match(/"stage":"(COLLSCAN|IXSCAN)"/)[1]);
}
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   no index (COLLSCAN)            stages=SORT<-COLLSCAN            keys=0 docs=200000 returned=20 medianMs=115
//   {status, total, createdAt} ERS stages=FETCH<-SORT<-IXSCAN       keys=36000 docs=20 returned=20 medianMs=34
//   {status, createdAt, total} ESR stages=LIMIT<-FETCH<-IXSCAN      keys=21 docs=20 returned=20 medianMs=0
//   --- no limit: every matching order
//   {status, total, createdAt} ERS stages=FETCH<-SORT<-IXSCAN       keys=36000 docs=36000 returned=36000 medianMs=130
//   {status, createdAt, total} ESR stages=FETCH<-IXSCAN             keys=40001 docs=36000 returned=36000 medianMs=63
//   planner picks: E_S_R
//   {"status":"paid"}          -> IXSCAN
//   {"total":{"$gte":990}}     -> COLLSCAN
```

How to read it:

- **No index.** The server reads all 200,000 documents and runs a `SORT` in memory to find the 20 newest.
- **E-R-S `{ status, total, createdAt }`.** The index narrows the scan to `paid` with `total >= 100`, which is 36,000 keys. Inside that range the keys are ordered by `total`, so a `SORT` stage has to order all 36,000 by `createdAt` to keep 20. It fetches only 20 documents, because the sort runs on index keys before the `FETCH`.
- **E-S-R `{ status, createdAt, total }`.** The keys inside `paid` are already newest first. The server walks them, checks `total >= 100` on the key itself, and stops after 20 matches: 21 keys examined, no `SORT` stage, under 1 ms.
- **Without a limit,** E-S-R examines *more* keys than E-R-S (40,001 against 36,000), because it walks every `paid` key and filters on `total` instead of seeking into a `total` range. It is still faster, because there is no sort of 36,000 entries. That is the trade the ESR rule makes: a few extra key comparisons instead of a blocking sort.
- **The planner** picked E-S-R on its own when both indexes existed.
- **Prefix rule:** `{ total }` alone gets a `COLLSCAN`, because no index starts with `total`.

**Example 3 — a TTL index deleting a document, and two that never expire.** This script takes up to about 70 seconds, because the TTL monitor wakes only every 60 seconds. Run it and wait.

javascript

```
// ttl.mjs — watch the TTL monitor delete an expired document (takes up to ~70 s)
import { MongoClient } from 'mongodb';
import { setTimeout as sleep } from 'node:timers/promises';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('indexes_ttl');
await db.dropDatabase();
const sessions = db.collection('sessions');

// expireAfterSeconds: 0 means "delete when the clock passes the date stored in expiresAt"
await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const start = Date.now();
await sessions.insertMany([
  { _id: 'short', expiresAt: new Date(start + 5_000) },          // expires in 5 s
  { _id: 'string-date', expiresAt: new Date(start).toISOString() }, // a string, not a BSON date
  { _id: 'no-field' },
]);
const ttl0 = (await db.admin().command({ serverStatus: 1 })).metrics.ttl;

while (await sessions.countDocuments({ _id: 'short' }) === 1) {
  await sleep(2_000);
  if (Date.now() - start > 130_000) throw new Error('not deleted after 130 s');
}
const ttl1 = (await db.admin().command({ serverStatus: 1 })).metrics.ttl;
console.log(`'short' expired at +5 s, deleted by +${Math.round((Date.now() - start) / 1000)} s`);
console.log('still present:', (await sessions.find().toArray()).map(d => d._id));
console.log('TTL passes during the wait:', Number(ttl1.passes) - Number(ttl0.passes),
  '| deletedDocuments:', Number(ttl1.deletedDocuments) - Number(ttl0.deletedDocuments));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   'short' expired at +5 s, deleted by +22 s
//   still present: [ 'string-date', 'no-field' ]
//   TTL passes during the wait: 1 | deletedDocuments: 1
```

The document expired at +5 s and was deleted at the next monitor pass, here at +22 s. Two earlier runs of the same script printed +12 s and +54 s: the delay depends on where the 60-second cycle happened to be when the document expired. The document with a string date and the document without the field are still there. The TTL monitor only acts on BSON dates. `metrics.ttl.passes` and `metrics.ttl.deletedDocuments` in `serverStatus` count the monitor's work, which is the place to look when "TTL is not deleting anything".

**Example 4 — partial unique index ("unique among active") and the planner rule for partial indexes.**

javascript

```
// partial.mjs — "email is unique among active users", and when the planner may use a partial index
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('indexes_partial');
await db.dropDatabase();
const users = db.collection('users');
await users.createIndex({ email: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'email_active_unique' });

await users.insertOne({ email: 'ada@example.com', status: 'deleted' });
await users.insertOne({ email: 'ada@example.com', status: 'deleted' });   // allowed: not in the index
await users.insertOne({ email: 'ada@example.com', status: 'active' });    // allowed: first active one
try {
  await users.insertOne({ email: 'ada@example.com', status: 'active' });  // rejected
} catch (e) { console.log('second active:', e.code, e.message); }
console.log('rows for ada:', await users.countDocuments({ email: 'ada@example.com' }));

// The planner can use a partial index only if the query implies the filter expression
const plan = async (f) => {
  const w = (await users.find(f).explain()).queryPlanner.winningPlan;
  return JSON.stringify(w).match(/"stage":"(COLLSCAN|IXSCAN)"/)[1];
};
console.log('{ email }                   ->', await plan({ email: 'ada@example.com' }));
console.log('{ email, status: active }   ->', await plan({ email: 'ada@example.com', status: 'active' }));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   second active: 11000 E11000 duplicate key error collection: indexes_partial.users index: email_active_unique dup key: { email: "ada@example.com" }
//   rows for ada: 3
//   { email }                   -> COLLSCAN
//   { email, status: active }   -> IXSCAN
```

The two `deleted` rows are not in the index at all, so they do not collide with each other or with the active row. The second active row is rejected with `E11000`, the same error code as any unique index, so a duplicate-key handler (lesson 67, *Additional topics*) needs no special case. A query on `{ email }` alone cannot use the index: its result could include deleted rows, and those are not in the index. Add `status: 'active'` to the filter and the plan becomes an `IXSCAN`.

**Example 5 — edge case: a sparse unique index allows many missing values but only one `null`, and `hint` drops documents.**

javascript

```
// sparse.mjs — sparse skips documents that lack the field; it still indexes explicit null
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('indexes_sparse');
await db.dropDatabase();
const users = db.collection('users');
await users.createIndex({ twitter: 1 }, { unique: true, sparse: true });

await users.insertMany([{ name: 'Ada', twitter: '@ada' }, { name: 'Lin' }, { name: 'Grace' }]); // two missing: fine
await users.insertOne({ name: 'Joan', twitter: null });
try { await users.insertOne({ name: 'Mary', twitter: null }); }                                  // second null: rejected
catch (e) { console.log('second null:', e.code, e.message); }

const [st] = await users.aggregate([{ $collStats: { storageStats: {} } }]).toArray();
const idx = await users.find({ twitter: { $exists: true } }).hint('twitter_1').explain('executionStats');
console.log('documents:', st.storageStats.count, '| keys in the sparse index:', idx.executionStats.totalKeysExamined);

// Forcing the sparse index onto a query that should see every document drops documents silently
console.log('sort, no hint:   ', (await users.find().sort({ twitter: 1 }).toArray()).length, 'docs');
console.log('sort, hint sparse:', (await users.find().sort({ twitter: 1 }).hint('twitter_1').toArray()).length, 'docs');
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   second null: 11000 E11000 duplicate key error collection: indexes_sparse.users index: twitter_1 dup key: { twitter: null }
//   documents: 4 | keys in the sparse index: 2
//   sort, no hint:    4 docs
//   sort, hint sparse: 2 docs
```

Lin and Grace have no `twitter` field, so the sparse index has no entry for them, and two missing values do not collide. Joan's explicit `null` *is* indexed, so Mary's second `null` collides. The index has 2 keys for 4 documents. Without a hint, the planner does not use the sparse index for a full sort, because it would lose documents, and you get all 4. Force it with `hint` and you silently get 2. With a partial index on `{ twitter: { $exists: true } }` you get the same behaviour from a filter that you can read in the index definition.

**Example 6 — text, wildcard and hashed indexes: what each can and cannot answer.**

javascript

```
// special.mjs — text, wildcard and hashed indexes: what each one can and cannot answer
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('indexes_special');
await db.dropDatabase();
const leaf = (p) => (p.inputStage ? leaf(p.inputStage) : p);
const planOf = async (cursor) => {
  const w = (await cursor.explain()).queryPlanner.winningPlan;
  const l = leaf(w.queryPlan ?? w);
  return l.stage + (l.indexName ? ` ${l.indexName}` : '') + (l.keyPattern ? ` ${JSON.stringify(l.keyPattern)}` : '');
};

// --- text: tokenised, stemmed words; one text index per collection
const posts = db.collection('posts');
await posts.insertMany([
  { title: 'Indexing strategies', body: 'Compound indexes and the ESR rule' },
  { title: 'Streams in Node', body: 'Backpressure explained' },
  { title: 'Index builds', body: 'How an index is built while writes continue' },
]);
await posts.createIndex({ title: 'text', body: 'text' }, { weights: { title: 3 } });
const hits = await posts.find({ $text: { $search: 'index' } }, { projection: { _id: 0, title: 1, score: { $meta: 'textScore' } } })
  .sort({ score: { $meta: 'textScore' }, title: 1 }).toArray();
console.log('text "index":', hits.map(h => `${h.title} (${h.score.toFixed(2)})`));
try { await posts.createIndex({ body: 'text' }, { name: 'second_text' }); }
catch (e) { console.log('second text index:', e.code, e.codeName, '-', e.message.split('. Requested')[0]); }

// --- wildcard: one index over arbitrary keys under attrs
const products = db.collection('products');
await products.insertMany([
  { name: 'Tee', attrs: { color: 'black', size: 'M' } },
  { name: 'Mug', attrs: { color: 'white', volumeMl: 350 } },
  { name: 'Cable', attrs: { lengthM: 2 } },
]);
await products.createIndex({ 'attrs.$**': 1 });
console.log('wildcard attrs.color:', await planOf(products.find({ 'attrs.color': 'black' })));
console.log('wildcard attrs.lengthM:', await planOf(products.find({ 'attrs.lengthM': { $gt: 1 } })));

// --- hashed: equality only (the shard-key building block)
const events = db.collection('events');
await events.insertMany(Array.from({ length: 1000 }, (_, i) => ({ userId: i, kind: 'click' })));
await events.createIndex({ userId: 'hashed' });
console.log('hashed equality:', await planOf(events.find({ userId: 42 })));
console.log('hashed range:   ', await planOf(events.find({ userId: { $gt: 990 } })));
try { await events.createIndex({ orderNo: 'hashed' }, { unique: true }); }
catch (e) { console.log('unique hashed:', e.code, '-', e.message.split(':: caused by :: ').pop()); }
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   text "index": [ 'Index builds (2.88)', 'Indexing strategies (2.88)' ]
//   second text index: 85 IndexOptionsConflict - An equivalent index already exists with a different name and options
//   wildcard attrs.color: IXSCAN attrs.$**_1 {"$_path":1,"attrs.color":1}
//   wildcard attrs.lengthM: IXSCAN attrs.$**_1 {"$_path":1,"attrs.lengthM":1}
//   hashed equality: IXSCAN userId_hashed {"userId":"hashed"}
//   hashed range:    COLLSCAN
//   unique hashed: 16764 - Currently hashed indexes cannot guarantee uniqueness. Use a regular index.
```

- **Text.** "index" matched "Indexing" through stemming. The streams post has no form of the word. A second text index is rejected because every text index uses the same internal key `{ _fts: 'text', _ftsx: 1 }`, so one text index per collection is enforced as "an equivalent index already exists".
- **Wildcard.** The index served both `attrs.color` and `attrs.lengthM`. The key pattern in the plan shows the `$_path` component that it stores.
- **Hashed.** The index served the equality lookup, a range fell back to `COLLSCAN`, and `unique: true` was refused.

## Common mistakes & gotchas

- **Putting the range field before the sort field.** `{ status, total, createdAt }` for "status = X, total ≥ Y, newest first" makes the server sort in memory (Example 2). Use E-S-R.
- **Reading only the stage name.** `IXSCAN` is not the same as fast. Compare `totalKeysExamined` with `nReturned`, and look for a `SORT` stage.
- **Expecting TTL to be exact.** The monitor runs every 60 seconds, and deletes can lag further under load. If an expired row must be invisible immediately, also filter on `expiresAt > now` in the query.
- **Storing the TTL field as a string or a number.** Only BSON dates (or arrays of them) expire. An ISO string never does (Example 3).
- **Writing a query that does not imply the partial filter.** The partial index is skipped and you get a `COLLSCAN` (Example 4). Repeat the filter condition in the query.
- **Hinting a sparse or partial index.** Results silently lose the documents the index skipped (Example 5).
- **Making an optional field `unique` without sparse or partial.** Every document without the field is indexed as `null`, so the second one fails with `E11000 … dup key: { field: null }`.
- **Trying to add a second text index.** A collection can have one. Put all searchable fields into it, with `weights`.
- **Using a hashed index for ranges or sorts.** Hashing destroys order, so the range query in Example 6 becomes a `COLLSCAN`.
- **Building indexes from application start-up on a large collection.** The build is online, but it still reads the whole collection, uses up to `maxIndexBuildMemoryUsageMegabytes` of memory, and briefly takes exclusive locks. Build deliberately, and on a replica set watch the commit quorum.
- **Leaving unused indexes in place.** Every index is updated on every write. Check `$indexStats` and drop the indexes that show no `accesses`.

## Best practices

- **Start from the query:** filter, sort, limit. Write the index for it in E-S-R order and confirm with `explain('executionStats')` that keys examined is close to `nReturned` and that there is no `SORT` stage.
- **Measure on realistic data volume.** On 100 documents every plan looks fine. Generate tens or hundreds of thousands, as these examples do.
- **Prefer partial indexes to sparse** for new work, and write the filter so that queries repeat it.
- **Use a partial unique index for soft-deleted rows** (`{ status: 'active' }`) instead of renaming deleted emails.
- **For TTL, store an explicit `expiresAt` date with `expireAfterSeconds: 0`.** Each document then carries its own deadline, and changing the policy does not require rebuilding the index.
- **One text index per collection,** with `weights` to rank title matches above body matches. For relevance tuning, fuzzy matching or facets, use a dedicated search engine.
- **Wildcard indexes for user-defined attributes,** not as a replacement for compound indexes on fields you know in advance and filter and sort on together. (The docs also describe *compound wildcard indexes*, which combine known fields with a wildcard component; they are not shown here.)
- **Plan index builds:** run them off-peak, check `currentOp` for progress, and on replica sets understand `commitQuorum`.

## ⭐ Interview lens

> **Q: “Explain the ESR rule with a real example.”**  
> A: For "paid orders of 100 or more, newest first, 20 per page", the index is `{ status: 1, createdAt: -1, total: 1 }`: equality, then sort, then range. Inside `status: 'paid'` the keys are already ordered by `createdAt`, so the server walks them, tests `total` on the key, and stops after 20. On 200,000 orders that examined 21 keys with no `SORT` stage. `{ status, total, createdAt }` examined 36,000 keys and sorted them in memory to return the same 20. *Trap:* "range before sort narrows the scan, so it is better". It does narrow the scan, but then the server has to sort everything it read.

> **Q: “How do you make email unique, but let deleted accounts keep their old email?”**  
> A: Use a unique index with `partialFilterExpression: { status: 'active' }`. Deleted rows are not in the index, so they never collide, and a second active row fails with `E11000`. Queries must include `status: 'active'` to use the index, because otherwise their results could include rows the index left out.

> **Q: “Our TTL index exists but documents stay for a minute after they expire. Bug?”**  
> A: No. The TTL monitor runs every 60 seconds, so a deletion lands between 0 and about 60 seconds after expiry, later under load, and only on the primary. If an expired document must never be returned, also filter `expiresAt: { $gt: new Date() }`. Also check that the field is a BSON date, because strings never expire.

> **Q: “Does creating an index lock the collection in MongoDB 8?”**  
> A: Only briefly. The build takes an exclusive lock at the start, then an intent lock that yields so reads and writes continue during the collection scan. Writes during the scan go to a side-writes table. It briefly blocks writes with a shared lock to drain that table, then takes an exclusive lock to commit. In my run, inserts on the same collection kept completing throughout a one-second build on 500,000 documents. The real costs are CPU, I/O and memory, and on a replica set the commit quorum.

> **Q: “When would you use a hashed or wildcard index?”**  
> A: Hashed: equality lookups on a value whose order does not matter, mainly as a hashed shard key that spreads monotonically increasing values such as ObjectIds. It cannot serve ranges or sorts and cannot be unique. Wildcard: documents with user-defined attribute keys, where you cannot list the fields in advance. The index stores `(path, value)` keys for every field under the path.

## Cheat-card

- **Index = sorted B-tree of (key → record id).** No usable index → `COLLSCAN`.
- **explain:** `explain('executionStats')` → `totalKeysExamined`, `totalDocsExamined`, `nReturned`, `executionTimeMillis`, `SORT` stage = in-memory sort.
- **EXPRESS_IXSCAN** (new in 8.0): fast path that skips planning; seen here for equality on `_id` and on a unique single-field index.
- **ESR:** Equality → Sort → Range. Measured: 21 keys and no SORT (E-S-R) vs 36,000 keys plus SORT (E-R-S) for a 20-row page.
- **Prefix rule:** `{ a, b, c }` serves `a`, `a+b`, `a+b+c`; not `b` alone.
- **TTL:** `createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })`; monitor every 60 s; BSON dates only; primary only.
- **Unique among active:** `{ unique: true, partialFilterExpression: { status: 'active' } }`; queries must include `status: 'active'`.
- **Sparse:** skips missing fields, indexes explicit `null`; `hint` on it drops documents. Prefer partial.
- **Text:** one per collection; stemmed; `$text` + `{ $meta: 'textScore' }`.
- **Wildcard:** `'attrs.$**': 1` → key `{ $_path, attrs.x }`.
- **Hashed:** equality only; no ranges, no sorts, no `unique`.
- **Builds (8.x manual):** X lock briefly → IX (yields) scan → S lock to drain side writes → X lock briefly to commit; `maxIndexBuildMemoryUsageMegabytes` 200 MB default; commit quorum on replica sets (changed in 8.0).

---

## Learn More

- [Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/indexes/)
- [The ESR (Equality, Sort, Range) Guideline www.mongodb.com](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
- [Compound Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/)
- [TTL Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/index-ttl/)
- [Partial Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/index-partial/)
- [Sparse Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/index-sparse/)
- [Unique Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/index-unique/)
- [Text Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/)
- [Wildcard Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-wildcard/)
- [Hashed Indexes www.mongodb.com](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-hashed/)
- [Index Builds on Populated Collections www.mongodb.com](https://www.mongodb.com/docs/manual/core/index-creation/)
- [Explain Results www.mongodb.com](https://www.mongodb.com/docs/manual/reference/explain-results/)
