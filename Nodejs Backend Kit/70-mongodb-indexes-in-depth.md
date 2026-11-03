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

## Say it in 30 seconds

An index is a second sorted structure, a B-tree, that maps a field's value to the document's id so the server can jump to matches instead of reading every document. You add one for the fields a hot query filters or sorts on, in equality, then sort, then range order. It exists so a lookup stays fast as the collection grows. The trade-off is that every insert, update, and delete must maintain that structure, and an index the planner cannot use is pure write cost.

## Why it matters

Lesson 68 introduces indexes and the ESR rule in a few paragraphs. In production, slow queries and "this must be unique, except for deleted rows" come back to the index type and the field order. A login that takes hundreds of milliseconds is a collection scan. "Deleted accounts may reuse the email" is a partial unique index. "Delete sessions after 30 minutes" is a TTL index. A page that is fast for 20 rows and slow for 2,000 is an in-memory sort. Each of these is one `explain()` call.

Every index is a structure that inserts, updates, and deletes must maintain. Building one on a large collection takes time and brief locks. An index the planner cannot use only adds write cost.

## The concept, simply

An index stores `(key value, record id)` entries, sorted, for one field or a list of fields. Because the keys are sorted, the server seeks the first match and walks forward, instead of opening every document. The same order can return rows already sorted. With no usable index the plan is `COLLSCAN`: read every document.

![With an index vs without: on the left a collection scan reads and checks every document; on the right a B-tree lookup follows a sorted tree from the root to the matching entry](assets/i41_02_00012497.svg)
*Figure: a collection scan versus a B-tree lookup. Look at: the left side touching every document, against the right side's single path from root to "hit". In `explain` terms, an indexed point lookup examines 1 key and 1 document (Example 1).*

| Type | What it stores | What it is for |
|---|---|---|
| Single or compound | Field values, in the order you list | Equality, ranges, and sorts on those fields |
| Unique | The same, and the server rejects a duplicate (`E11000`) | Natural keys such as email |
| Partial | Only documents that match `partialFilterExpression` | A smaller index, and "unique among active" rows |
| Sparse | Only documents that have the field | Optional fields. Partial indexes are the newer form |
| TTL | A date field, plus `expireAfterSeconds` | Background deletion of expired documents |
| Text | Stemmed words from string fields | `$text` search with a relevance score |
| Wildcard | A path and a value for every field under a path | Attribute keys you do not know in advance |
| Hashed | A hash of the value | Equality, and hashed shard keys (lesson 72) |

## How it works

What a `find` does on the server:

1. The server parses the filter, the sort, and the projection into a query shape.
2. The planner lists every index that can answer the query. A compound index qualifies when the query constrains a prefix of it. A partial index qualifies only when the filter implies its `partialFilterExpression`.
3. For each candidate it builds bounds, such as `status` equal to `paid` and `total` from 100 upward.
4. If several candidates remain, they race for a short trial. The winner is cached for that query shape.
5. `IXSCAN` walks the bounds. `FETCH` loads each document. `SORT` runs in memory when the index order is not the requested order.
6. `explain('executionStats')` reports `totalKeysExamined`, `totalDocsExamined`, `nReturned`, `executionTimeMillis`, and the stage tree.

**Reading `explain`.** Compare examined with returned. 21 keys for 20 rows is close to ideal. 36,000 keys for 20 rows means the index narrowed the scan and the server still read 36,000 entries to keep 20. A `SORT` stage means the order came from memory, not from the index.

**The ESR rule.** List equality fields, then the sort field, then range fields. Inside one equality value such as `status: 'paid'`, the keys are ordered by the next field. If that next field is `createdAt`, walking the keys is already newest-first, and `limit(20)` can stop after about 20 keys. The range, such as `total`, is tested on the key before the document is fetched. If the range field comes before the sort field, the keys inside `paid` are ordered by `total`, and the server must read every key in the range and sort them. Example 2 measures this on 200,000 orders: the equality-sort-range index examined 21 keys with no `SORT`, and the equality-range-sort index examined 36,000 keys and sorted them.

**Prefixes.** An index on `{ a, b, c }` can seek on `{ a }`, `{ a, b }`, and `{ a, b, c }`. It cannot seek on `{ b }` or `{ c }` alone, because `b` is not sorted across different values of `a`.

**Partial versus sparse.** A sparse index omits documents that lack the field, and it still includes documents where the field is explicitly `null`. A partial index omits documents that fail a filter, so it can do what sparse does and more. The planner will not use either index for a query whose results might include documents the index left out, unless you `hint` it, and a hint then silently drops those documents (Examples 4 and 5).

**TTL.** A TTL index is a normal index on a date field, or an array of dates, plus `expireAfterSeconds`. A background thread deletes documents whose date plus that delay is in the past. Deletion is not instant. A missing field, or a value that is not a BSON date, such as an ISO string, never expires. On a replica set only the primary deletes, and the deletes replicate like any other delete.

**Text, wildcard, and hashed.** A text index tokenises and stems words, so "Indexing" and "index" can match, and it supports `$text` with a score. A collection can have only one text index, so every searchable string field goes in that one index. A wildcard index (`'attrs.$**': 1`) stores a path and a value for every field under `attrs`, so `attrs.color` and `attrs.lengthM` are indexed without naming them in advance. A hashed index stores a hash. Equality works, because equal values hash the same. Ranges and sorts do not, because hashing destroys order. A hashed index cannot be unique.

**Builds.** On a populated collection the build takes a brief exclusive lock to set up, then scans while reads and writes continue, recording writes that arrive during the scan. It blocks writes briefly to drain those side writes, then takes a brief exclusive lock to commit and to reject duplicates if the index is unique. Example 7 shows inserts on the same collection completing during a build of 500,000 documents. The costs that matter are CPU, I/O, and memory, and on a replica set the commit quorum. The lock stages and the memory parameter are under Good to know.

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

- **Range before sort.** `{ status, total, createdAt }` for "status equals X, total at least Y, newest first" sorts in memory (Example 2). Use equality, sort, range.
- **Trusting the stage name.** `IXSCAN` is not the same as fast. Compare `totalKeysExamined` with `nReturned`, and look for `SORT`.
- **Expecting TTL to the second.** The monitor is periodic, and deletes can lag further under load. If an expired row must be invisible immediately, also filter `expiresAt` greater than now.
- **Storing the TTL field as a string or a number.** Only BSON dates, or arrays of them, expire. An ISO string never does (Example 3).
- **A query that does not imply the partial filter.** The partial index is skipped and you get a `COLLSCAN` (Example 4). Repeat the filter in the query.
- **Hinting a sparse or partial index.** Documents the index skipped disappear from the result with no error (Example 5).
- **`unique` on an optional field with no sparse or partial filter.** Every missing field is indexed as `null`, so the second document fails with `E11000` on `null`.
- **A second text index.** A collection can have one. Put every searchable field in it, with `weights`.
- **A hashed index for a range or a sort.** Hashing destroys order, so the range becomes a `COLLSCAN` (Example 6).
- **Building a large index from application startup.** The build is online, and it still reads the whole collection, uses memory, and takes brief exclusive locks. Build it on purpose.
- **Leaving unused indexes.** Every index is updated on every write. Check `$indexStats` and drop indexes with no accesses.

## Best practices

- Start from the query: filter, sort, limit. Write the index in equality, sort, range order. Confirm with `explain('executionStats')` that keys examined are close to `nReturned` and that there is no `SORT`.
- Measure on a realistic volume. On 100 documents every plan looks fine.
- Prefer partial indexes to sparse for new work, and repeat the filter in the query.
- For soft-deleted rows, use a partial unique index on `{ status: 'active' }` instead of renaming the email.
- For TTL, store an explicit `expiresAt` date and set `expireAfterSeconds: 0`. Each document carries its own deadline, and a policy change does not rebuild the index.
- One text index per collection, with `weights` so a title match outranks a body match. For fuzzy match or facets, use a dedicated search engine.
- Use a wildcard index for user-defined attributes, not as a stand-in for a compound index on fields you already know and filter together.
- Plan builds for off-peak, watch `currentOp`, and on a replica set understand the commit quorum.

## ⭐ Interview lens

> **Q: “Explain the ESR rule with a real example.”**  
> ESR is the field order of a compound index: equality, then sort, then range. Inside one equality value the B-tree is ordered by the next field. If that field is the sort, walking the keys returns rows already in order, and a limit can stop. The range is tested on the key itself. For "paid orders of 100 or more, newest first, 20 per page," the index is `{ status: 1, createdAt: -1, total: 1 }`. On 200,000 orders that plan examined 21 keys and had no `SORT` stage. The index `{ status, total, createdAt }` examined 36,000 keys and sorted them in memory to return the same 20, because inside `paid` the keys are ordered by `total`, not by time. The limit of "put the range first so the scan is narrower" is exactly that measurement: the scan is narrower than a collection scan, and you still sort everything you read.

> **Q: “How do you make email unique, but let deleted accounts keep their old email?”**  
> Use a unique index with `partialFilterExpression: { status: 'active' }`. A partial index contains only documents that match the filter. Deleted rows are not in the index, so they never collide with a new signup, and a second active row with the same email fails with `E11000`. Queries that should use the index must include `status: 'active'`, because the planner will not pick an index whose contents might be missing documents the query could return. For example, `find({ email, status: 'active' })` seeks the index, and `find({ email })` does not. The limit of a hint that forces the partial index is silent data loss: rows the index omitted simply do not appear.

> **Q: “Our TTL index exists but documents stay for a minute after they expire. Bug?”**  
> No. A TTL index is a date field plus `expireAfterSeconds`. A background monitor deletes documents whose date plus that delay is already past. The monitor does not run continuously, so a document can sit past its deadline until the next pass, and longer under load. On a replica set only the primary deletes, and the delete then replicates. If an expired document must never be returned, the query also filters `expiresAt` greater than now. For example, sessions with `expireAfterSeconds: 0` on an `expiresAt` date disappear on the monitor's schedule, not on the exact timestamp. The limit is the type: a string such as `"2026-10-12T…"` is not a BSON date, and it never expires.

> **Q: “When would you use a hashed or wildcard index?”**  
> A hashed index stores a hash of the value. Equal values have equal hashes, so equality lookups work, and order is gone, so ranges and sorts do not. It also cannot be unique. The common use is a hashed shard key, so a monotonic value such as an ObjectId spreads across shards instead of landing on one (lesson 72). A wildcard index stores a path and a value for every field under a prefix, such as `'attrs.$**': 1`, so user-defined keys like `attrs.color` are indexed without listing them. For example, a product with arbitrary attributes can be filtered on any of those keys. The limit is that a wildcard index is not a substitute for a compound index on fields you know and sort together. Those still want an ESR index.

## Cheat-card

- An index is a sorted B-tree from key to record id. No usable index means `COLLSCAN`.
- `explain('executionStats')`: keys examined, docs examined, `nReturned`, time, and a `SORT` stage for an in-memory sort.
- ESR: equality, then sort, then range. Measured: 21 keys and no SORT, versus 36,000 keys plus SORT, for a 20-row page.
- Prefix: `{ a, b, c }` serves `a`, `a` plus `b`, and all three. It does not serve `b` alone.
- TTL: a BSON date plus `expireAfterSeconds`. Not instant. Primary only. Strings never expire.
- Unique among active: `{ unique: true, partialFilterExpression: { status: 'active' } }`. The query must include `status: 'active'`.
- Sparse skips missing fields and still indexes explicit `null`. A hint can drop documents. Prefer partial.
- One text index per collection. It is stemmed. Query with `$text` and `$meta: 'textScore'`.
- Wildcard: `'attrs.$**': 1`. Hashed: equality only, no range, no sort, no unique.

## Good to know

- `EXPRESS_IXSCAN` is new in MongoDB 8.0. It skips regular planning. In these runs it appeared for equality on `_id` and for equality on a unique single-field index.
- The in-memory sort limit is `internalQueryMaxBlockingSortMemoryUsageBytes`, 100 MB by default. With `allowDiskUse` the sort can spill to disk.
- The TTL monitor sleep is `ttlMonitorSleepSecs`. It reported 60 on the 8.2.6 server used here, so expiry can be up to about a minute late, more under load.
- Index build locks, from the MongoDB 8.x manual: a brief exclusive `X` lock to set up a side-writes table, then an intent-exclusive `IX` lock that yields during the scan, then a shared `S` lock while side writes drain, then a brief `X` lock to commit. `maxIndexBuildMemoryUsageMegabytes` defaults to 200 MB on self-hosted deployments.
- Commit quorum, changed in 8.0: it counts members that are ready to commit, and write concern then decides how many must have replicated the commit.
- Starting in 7.1, errors found during the scan, other than duplicate-key errors, stop the build immediately instead of at the commit. `indexBuildMinAvailableDiskSpaceMB` can stop a build when disk is low.
- In the build measurement, inserts on the same collection kept completing during a build on 500,000 documents.
- Q: Does creating an index lock the collection in MongoDB 8? Only briefly. Reads and writes continue during the scan under the intent lock. Writes that arrive are applied from a side-writes table. A shared lock blocks writes while that table drains, then a brief exclusive lock commits. In this run, inserts kept completing through a build of 500,000 documents. The lasting costs are CPU, I/O, memory, and on a replica set the commit quorum.

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
