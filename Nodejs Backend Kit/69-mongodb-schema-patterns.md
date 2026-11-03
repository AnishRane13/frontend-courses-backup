---
title: "MongoDB Schema Patterns"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# MongoDB Schema Patterns

*18 min read · Updated 12 Oct 2026 · Topic 98 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and MongoDB 8.2.6 (run locally via mongodb-memory-server's downloaded mongod binary, no Docker), `mongodb` driver 7.7.0

---

## Say it in 30 seconds

Schema patterns are named shapes between embedding and referencing: group many tiny events into buckets, keep only the few items a page shows, store a running total, or copy a stable field so a list does not join. You pick one by naming the read you want to make cheap and the extra work each write will do. They exist because real data is often too big to embed and too costly to join on every page. The trade-off is an invariant you must keep true, such as "this array holds at most three reviews," or the copies drift.

## Why it matters

Lesson 68 gives you embed or reference. Real collections often fit neither. A sensor that writes once a minute for years cannot embed every reading, and one document per reading creates millions of tiny documents. A product page wants the three newest reviews, not all 40,000. A bestseller's buyer list is a thousand times longer than a normal book's.

Each pattern moves cost: from reads to writes, from many small documents to fewer larger ones, or from a join to a copy that can go stale. "I would use the bucket pattern" is a weak interview answer. A strong one names the grouping, the measured change in document count and index size, and the cost on the write.

## The concept, simply

Every pattern sits between the two baselines. Embedding puts owned, bounded data inside the parent so one read returns it. Referencing keeps a second collection and joins at read time with `populate()` or `$lookup`. The patterns embed some of it, embed a summary, group small things into medium documents, or treat the rare huge case differently.

![Embedding vs referencing: an order with items nested inside it, read in one query, versus an order holding a userId that points into a separate users collection and is joined at read time](assets/i41_01_7b178f88.svg)
*Figure: the two baselines every schema pattern trades between. Look at: "One read gets everything" on the embed side versus "Needs populate / $lookup" on the reference side.*

| Pattern | Problem it solves | Read it makes cheap | What it costs |
|---|---|---|---|
| Bucket | Millions of tiny documents, such as time series or events | "All readings for sensor S in this range" | An upsert on every write. You read and update a bucket, not a row |
| Subset | A large array when the page shows only the first few | The page that shows the top N | Two writes per item, and the subset is a duplicate |
| Computed | The same aggregate recomputed on every read | A count, sum, or average | An extra write per change, and drift if a write is missed |
| Extended reference | A join on every read for a few stable fields | A list that shows the related name | Copies stay stale until a fan-out runs |
| Outlier | A few documents are far larger than the rest | The common case stays one read | A second code path and a second query for the outliers |
| Polymorphic | Different shapes that are queried together | One query across all types | Validation and indexes must allow missing fields |
| Tree: parent reference | Hierarchies where you move nodes or list children | Direct children | A subtree needs recursion (`$graphLookup`) |
| Tree: materialized path | Hierarchies where you read whole subtrees | A subtree, as one prefix scan | Moving a node rewrites every descendant |

## How it works

Choose in this order:

1. Write down the hot reads, with filter and sort. "One sensor, one day, ordered by time." "The product page and its 3 newest reviews."
2. Write down the writes and how often they happen. A reading a minute, a review a day, a rename once a year.
3. Start from lesson 68: embed if the data is owned and bounded, reference if not.
4. Name the cost that hurts: too many documents, a document that is too large, a join on every read, or an aggregate on every read.
5. Pick the pattern that moves that cost onto something rarer, usually the write.
6. Measure both shapes with `$collStats` for sizes and counts, and `explain('executionStats')` for keys and documents examined.
7. Write down the invariant. "`recentReviews` holds at most 3." "`ratingSum` equals the sum of `ratings.stars`." "`customer.name` on an order may lag by one fan-out job." The pattern is correct only while that stays true.

**Bucket.** One document holds a group of small items, such as all readings for one sensor in one hour, plus `count` and `sum`. A write is an upsert that `$push`es into the open bucket. The filter includes `count: { $lt: N }` so a full bucket stops matching and the next upsert starts a new one. Reads fetch a handful of buckets instead of thousands of documents. The index has one entry per bucket, which is where most of the space saving in Example 1 comes from. Fewer documents also means less repeated `_id` and field-name overhead. MongoDB time series collections, added in 5.0, do this bucketing inside the server. For measurements over time, read those docs before you build buckets by hand.

**Subset.** The parent embeds only the slice the hot read shows, such as the newest 3 reviews. The full set lives in its own collection. `$push` with `$each`, `$position: 0`, and `$slice: N` keeps the embedded array at exactly N in one atomic update. The cost is two writes per new item.

**Computed.** Store `ratingCount` and `ratingSum`, and `$inc` them on each write. Reads no longer scan the detail rows. The stored values must equal what an aggregation would return. A write path that forgets the `$inc`, or crashes between the two writes, breaks that. Use a transaction when exactness matters (lesson 75, which needs a replica set), or a periodic recompute.

**Extended reference.** The order stores `{ _id, name, city }` instead of only `customerId`. The full customer stays in `customers`. The list screen needs no join. A rename updates `customers` and not the copies, until `updateMany` runs. Copy fields that change rarely. A shipping address on an order is often meant to stay as a snapshot of what was true at purchase.

**Outlier.** Design for the common case. Embed buyers on the book, capped at a limit you choose. When a document hits the cap, set `hasOverflow: true` and write the rest to another collection. Readers query the overflow only when the flag is set. The common case stays one read. The rare case pays a second query and a second code path.

**Polymorphic.** Books, shirts, and ebooks share one collection because you query them together, for example "everything under $50." A `type` field tells the shapes apart. Mongoose calls this a discriminator (lesson 67). Shared fields get normal indexes. A type-specific field such as `isbn` gets a partial index filtered on `type`, so shirts do not need an isbn (lesson 70).

**Trees.** Four shapes, trading write cost for read cost.

- **Parent references.** Each node stores `parent`. Direct children are one indexed equality query. Moving a node changes one document. A subtree needs `$graphLookup`.
- **Child references.** Each node stores a `children` array. Listing children is fast, and the array has to stay in sync. Not shown in the examples.
- **Array of ancestors.** Each node stores `ancestors: ['Books', 'Programming']`. A subtree is an equality match on a multikey index. The breadcrumb is already on the document.
- **Materialized path.** Each node stores a string such as `,Books,Programming,Databases,`. A subtree is an anchored prefix regex, `^,Books,Programming,`, which the index turns into a key range. Sorting by `path` is depth-first. Moving a node rewrites every descendant's path.

**What "anchored" buys you.** A regex that starts with `^` and is case-sensitive lets the planner turn the literal prefix into index bounds. In Example 7 the bounds are `[",Books,Programming,", ",Books,Programming-")`. The character after the comma in ASCII is the hyphen, so only keys inside that range are examined. Any other regex may still use the index and still has to test every key (Example 8).

## Code examples

Each example is a standalone ES module. Run it with `MONGO_URL=mongodb://127.0.0.1:<port>/ node file.mjs` after `npm install mongodb@7.7.0`, against MongoDB 8.2.6 run locally via mongodb-memory-server's downloaded mongod binary (no Docker). Each script drops and recreates its own database.

**Example 1 — bucket vs one document per reading, measured with `$collStats` and `explain`.** There are 100,000 readings (10 sensors × 10,000 minutes), stored once as one document per reading and once as sensor-hour buckets. `fsync` forces a WiredTiger checkpoint so the on-disk sizes reflect the data just written. `scale: 1024` reports sizes in KB.

javascript

```
// bucket.mjs — one document per reading vs one document per sensor-hour
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_bucket');
await db.dropDatabase();

const SENSORS = 10, MINUTES = 10_000;          // 10 sensors × 10,000 minutes = 100,000 readings
const t0 = Date.UTC(2026, 0, 1);
const flat = [], buckets = new Map();
for (let s = 0; s < SENSORS; s++) {
  for (let m = 0; m < MINUTES; m++) {
    const ts = new Date(t0 + m * 60_000);
    const value = 20 + ((s * 7 + m) % 50) / 10;
    flat.push({ sensorId: s, ts, value });
    const hour = new Date(Math.floor(ts / 3_600_000) * 3_600_000);
    const key = `${s}|${+hour}`;
    if (!buckets.has(key)) buckets.set(key, { sensorId: s, start: hour, count: 0, sum: 0, readings: [] });
    const b = buckets.get(key);
    b.readings.push({ ts, value }); b.count++; b.sum += value;   // computed fields kept beside the bucket
  }
}
await db.collection('readings').insertMany(flat);
await db.collection('readings').createIndex({ sensorId: 1, ts: 1 });
await db.collection('reading_buckets').insertMany([...buckets.values()]);
await db.collection('reading_buckets').createIndex({ sensorId: 1, start: 1 });

await db.admin().command({ fsync: 1 });        // force a checkpoint so the on-disk sizes are current
for (const name of ['readings', 'reading_buckets']) {
  const [st] = await db.collection(name).aggregate([{ $collStats: { storageStats: { scale: 1024 } } }]).toArray();
  const s = st.storageStats;
  console.log(name.padEnd(16), `docs=${s.count}`, `dataKB=${s.size}`, `storageKB=${s.storageSize}`,
    `indexKB=${s.totalIndexSize}`, s.indexSizes);
}

// The read both shapes serve: one sensor, one day (1,440 readings)
const from = new Date(t0 + 2 * 86_400_000), to = new Date(+from + 86_400_000);
const e1 = await db.collection('readings').find({ sensorId: 3, ts: { $gte: from, $lt: to } })
  .explain('executionStats');
const e2 = await db.collection('reading_buckets').find({ sensorId: 3, start: { $gte: from, $lt: to } })
  .explain('executionStats');
for (const [name, e] of [['readings', e1], ['reading_buckets', e2]]) {
  const x = e.executionStats;
  console.log(name.padEnd(16), `returned=${x.nReturned} keys=${x.totalKeysExamined} docs=${x.totalDocsExamined}`);
}

// Writing one new reading into the bucket shape: upsert into the open bucket for that hour
const ts = new Date(t0 + MINUTES * 60_000), hour = new Date(Math.floor(ts / 3_600_000) * 3_600_000);
const r = await db.collection('reading_buckets').updateOne(
  { sensorId: 3, start: hour, count: { $lt: 60 } },
  { $push: { readings: { ts, value: 21.5 } }, $inc: { count: 1, sum: 21.5 } },
  { upsert: true });
console.log('bucket write:', { matched: r.matchedCount, modified: r.modifiedCount, upserted: r.upsertedCount });
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   readings         docs=100000 dataKB=6113 storageKB=2148 indexKB=2072 { _id_: 976, sensorId_1_ts_1: 1096 }
//   reading_buckets  docs=1670 dataKB=3601 storageKB=1528 indexKB=68 { _id_: 32, sensorId_1_start_1: 36 }
//   readings         returned=1440 keys=1440 docs=1440
//   reading_buckets  returned=24 keys=24 docs=24
//   bucket write: { matched: 1, modified: 1, upserted: 0 }
```

What the numbers say:

- **Documents:** 100,000 → 1,670 (60× fewer).
- **Index size:** 2,072 KB → 68 KB. There is one key per bucket instead of one per reading, so the `_id` index and the compound index shrink by the same factor.
- **Data size:** 6,113 KB → 3,601 KB uncompressed BSON. That is less than half the saving because the reading values still have to be stored. What disappears is the per-document `_id` and the repeated `sensorId` field. On disk (compressed) the change is 2,148 KB → 1,528 KB.
- **The day query:** it examines 24 index keys and 24 documents instead of 1,440 of each. It returns 24 buckets, and the application (or an `$unwind`) flattens them.
- **The cost** is in the write path: every reading is an upsert with a filter on `count`, not a plain insert. Reading a single minute means fetching its whole bucket.

Storage sizes move by a few KB between runs, because they depend on when WiredTiger compacts its pages. The document counts and the keys examined are exact.

**Example 2 — subset: the newest 3 reviews embedded, all reviews in their own collection.**

javascript

```
// subset.mjs — keep the 3 newest reviews on the product, all reviews in their own collection
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_subset');
await db.dropDatabase();
const products = db.collection('products'), reviews = db.collection('reviews');
await reviews.createIndex({ productId: 1, at: -1 });
await products.insertOne({ _id: 'p1', name: 'Kettle', price: 39, recentReviews: [], reviewCount: 0 });

async function addReview(productId, review) {
  await reviews.insertOne({ productId, ...review });           // write 1: the full history
  await products.updateOne({ _id: productId }, {                // write 2: the embedded subset
    $push: { recentReviews: { $each: [review], $position: 0, $slice: 3 } },
    $inc: { reviewCount: 1 },
  });
}
for (let i = 1; i <= 5; i++) {
  await addReview('p1', { by: `user${i}`, stars: (i % 5) + 1, text: `review ${i}`, at: new Date(Date.UTC(2026, 9, i)) });
}

// Product page: one read, bounded size
console.log(await products.findOne({ _id: 'p1' }, { projection: { _id: 0, name: 1, reviewCount: 1, 'recentReviews.by': 1 } }));
// "See all reviews" page: the second collection, paged by the index
console.log((await reviews.find({ productId: 'p1' }).sort({ at: -1 }).skip(3).limit(3).toArray()).map(r => r.by));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   {
//     name: 'Kettle',
//     recentReviews: [ { by: 'user5' }, { by: 'user4' }, { by: 'user3' } ],
//     reviewCount: 5
//   }
//   [ 'user2', 'user1' ]
```

`$slice: 3` runs after `$position: 0` puts the new review first, so the array never holds more than 3 entries. The "all reviews" page reads `reviews` through the `{ productId: 1, at: -1 }` index. It skips the 3 that are already embedded and shows `user2` and `user1`.

**Example 3 — computed: store `ratingCount` and `ratingSum` instead of aggregating 20,000 ratings per read.**

javascript

```
// computed.mjs — compute the average once per write instead of once per read
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_computed');
await db.dropDatabase();
const ratings = db.collection('ratings'), movies = db.collection('movies');
await ratings.createIndex({ movieId: 1 });

const docs = Array.from({ length: 20_000 }, (_, i) => ({ movieId: 'm1', stars: (i % 5) + 1 }));
await ratings.insertMany(docs);
// Computed fields: maintained by $inc on every rating write
await movies.insertOne({ _id: 'm1', title: 'Arrival', ratingCount: 20_000, ratingSum: docs.reduce((s, d) => s + d.stars, 0) });

// Read path A: aggregate on every page view
const a = await ratings.aggregate([{ $match: { movieId: 'm1' } }, { $group: { _id: null, avg: { $avg: '$stars' } } }])
  .explain('executionStats');
const stA = a.stages?.[0]?.$cursor?.executionStats ?? a.executionStats;
const [{ avg }] = await ratings.aggregate([{ $match: { movieId: 'm1' } }, { $group: { _id: null, avg: { $avg: '$stars' } } }]).toArray();
console.log('aggregate per read: avg =', avg, '| keys examined =', stA.totalKeysExamined, '| docs examined =', stA.totalDocsExamined);

// Read path B: read the precomputed fields
const e = await movies.find({ _id: 'm1' }).explain('executionStats');
const m = await movies.findOne({ _id: 'm1' });
console.log('computed field:     avg =', m.ratingSum / m.ratingCount, '| keys examined =', e.executionStats.totalKeysExamined, '| docs examined =', e.executionStats.totalDocsExamined);

// The write cost: every new rating is two writes
await ratings.insertOne({ movieId: 'm1', stars: 5 });
await movies.updateOne({ _id: 'm1' }, { $inc: { ratingCount: 1, ratingSum: 5 } });
console.log(await movies.findOne({ _id: 'm1' }, { projection: { _id: 0, ratingCount: 1, ratingSum: 1 } }));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   aggregate per read: avg = 3 | keys examined = 20000 | docs examined = 20000
//   computed field:     avg = 3 | keys examined = 1 | docs examined = 1
//   { ratingCount: 20001, ratingSum: 60005 }
```

The aggregation reads 20,000 index keys and 20,000 documents on every page view. The computed fields read 1 of each. The price is the second write in the last block. If the process dies between the two writes, `ratingCount` is off by one until something recomputes it.

**Example 4 — extended reference: a join-free order list, and the staleness it costs.**

javascript

```
// extref.mjs — copy the few customer fields an order screen needs into each order
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_extref');
await db.dropDatabase();
const customers = db.collection('customers'), orders = db.collection('orders');
await orders.createIndex({ 'customer._id': 1 });

await customers.insertOne({ _id: 'c1', name: 'Ada Lovelace', city: 'London', email: 'ada@example.com', phone: '…', loyalty: { tier: 'gold' } });
const ada = await customers.findOne({ _id: 'c1' });
await orders.insertMany([1, 2, 3].map(n => ({
  _id: `o${n}`, total: n * 10,
  customer: { _id: ada._id, name: ada.name, city: ada.city },   // the extended reference
})));

// Order list: one query, no $lookup
console.log(await orders.find({}, { projection: { _id: 1, 'customer.name': 1 } }).toArray());

// The cost: the copy goes stale until you fan the change out
await customers.updateOne({ _id: 'c1' }, { $set: { name: 'Ada King' } });
console.log('after rename, order says:', (await orders.findOne({ _id: 'o1' })).customer.name);
const r = await orders.updateMany({ 'customer._id': 'c1' }, { $set: { 'customer.name': 'Ada King' } });
console.log('fan-out update:', { matched: r.matchedCount, modified: r.modifiedCount });
console.log('now order says:', (await orders.findOne({ _id: 'o1' })).customer.name);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   [
//     { _id: 'o1', customer: { name: 'Ada Lovelace' } },
//     { _id: 'o2', customer: { name: 'Ada Lovelace' } },
//     { _id: 'o3', customer: { name: 'Ada Lovelace' } }
//   ]
//   after rename, order says: Ada Lovelace
//   fan-out update: { matched: 3, modified: 3 }
//   now order says: Ada King
```

Between the rename and the `updateMany`, every order shows the old name. The fan-out touches every order that references the customer, which is 3 here. For a customer with 50,000 orders, a rename is 50,000 document writes, so the `{ 'customer._id': 1 }` index is what keeps that update from scanning the whole collection.

**Example 5 — outlier: cap the embedded array, overflow the rare huge case.**

javascript

```
// outlier.mjs — most books have a few buyers; one bestseller has thousands
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_outlier');
await db.dropDatabase();
const books = db.collection('books'), overflow = db.collection('book_buyers_overflow');
await overflow.createIndex({ bookId: 1 });
const CAP = 1000;   // the array limit you choose for the main document

await books.insertOne({ _id: 'b-normal', title: 'Niche Book', buyers: ['u1', 'u2', 'u3'] });
await books.insertOne({ _id: 'b-hit', title: 'Bestseller', buyers: [], hasOverflow: false });

async function addBuyer(bookId, userId) {
  // Try the main document first, only while the array is below the cap
  const r = await books.updateOne({ _id: bookId, [`buyers.${CAP - 1}`]: { $exists: false } },
                                  { $push: { buyers: userId } });
  if (r.modifiedCount === 1) return 'main';
  // Full: flag the outlier and write to an overflow document
  await books.updateOne({ _id: bookId }, { $set: { hasOverflow: true } });
  await overflow.updateOne({ bookId, count: { $lt: CAP } },
                           { $push: { buyers: userId }, $inc: { count: 1 } }, { upsert: true });
  return 'overflow';
}
const where = { main: 0, overflow: 0 };
for (let i = 0; i < 2500; i++) where[await addBuyer('b-hit', `u${i}`)]++;
console.log('writes landed in:', where);

// The common case pays nothing extra: one read
const normal = await books.findOne({ _id: 'b-normal' });
console.log(normal.title, 'buyers:', normal.buyers.length, 'hasOverflow:', normal.hasOverflow ?? false);
// Only the outlier needs the second query
const hit = await books.findOne({ _id: 'b-hit' });
let total = hit.buyers.length;
if (hit.hasOverflow) for await (const o of overflow.find({ bookId: 'b-hit' })) total += o.buyers.length;
console.log(hit.title, 'main array:', hit.buyers.length, 'overflow docs:', await overflow.countDocuments({ bookId: 'b-hit' }), 'total buyers:', total);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   writes landed in: { main: 1000, overflow: 1500 }
//   Niche Book buyers: 3 hasOverflow: false
//   Bestseller main array: 1000 overflow docs: 2 total buyers: 2500
```

The filter `'buyers.999': { $exists: false }` matches only while the array has fewer than 1,000 entries, so the check and the push happen in one atomic update. The niche book never sets `hasOverflow` and is read with one query. Only the bestseller needs the second query, which reads 2 overflow documents of up to 1,000 buyers each.

**Example 6 — polymorphic: three shapes in one collection, with a partial unique index for one type.**

javascript

```
// poly.mjs — one collection, several shapes, one shared "type" field
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_poly');
await db.dropDatabase();
const items = db.collection('catalog');
await items.createIndex({ type: 1, price: 1 });
await items.createIndex({ isbn: 1 }, { unique: true, partialFilterExpression: { type: 'book' } });

await items.insertMany([
  { type: 'book',  name: 'SICP',         price: 45, isbn: '978-0262510875', pages: 657 },
  { type: 'book',  name: 'TAOCP Vol 1',  price: 80, isbn: '978-0201896831', pages: 672 },
  { type: 'shirt', name: 'Logo tee',     price: 20, sizes: ['S', 'M', 'L'], color: 'black' },
  { type: 'ebook', name: 'Node Streams', price: 15, formats: ['epub', 'pdf'], fileMB: 4 },
]);

// One query across every shape, using only the shared fields
console.log(await items.find({ price: { $lt: 50 } }, { projection: { _id: 0, type: 1, name: 1, price: 1 } }).sort({ price: 1 }).toArray());
// Shape-specific fields are just absent on the other types
console.log(await items.find({ type: 'book', pages: { $gt: 660 } }, { projection: { _id: 0, name: 1, pages: 1 } }).toArray());
// The partial unique index only constrains books; shirts have no isbn at all
try { await items.insertOne({ type: 'book', name: 'dupe', price: 1, isbn: '978-0262510875' }); }
catch (e) { console.log('duplicate isbn:', e.code, e.message.split(' dup key')[0]); }
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   [
//     { type: 'ebook', name: 'Node Streams', price: 15 },
//     { type: 'shirt', name: 'Logo tee', price: 20 },
//     { type: 'book', name: 'SICP', price: 45 }
//   ]
//   [ { name: 'TAOCP Vol 1', pages: 672 } ]
//   duplicate isbn: 11000 E11000 duplicate key error collection: patterns_poly.catalog index: isbn_1
```

The price query spans all types because `price` is a shared field. `pages` exists only on books, and the other documents simply do not match. The unique index on `isbn` has `partialFilterExpression: { type: 'book' }`, so it enforces uniqueness for books and contains no entries for shirts or ebooks.

**Example 7 — trees: parent references with `$graphLookup`, materialized path with an indexed prefix regex, array of ancestors.** The tree is small, so 20,000 unrelated categories are added to show that the prefix scan skips them.

javascript

```
// tree.mjs — the same category tree stored with parent references and with materialized paths
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_tree');
await db.dropDatabase();
const cats = db.collection('categories');
await cats.createIndex({ parent: 1 });
await cats.createIndex({ path: 1 });

// Books > Programming > {Databases, JavaScript > Node}, Books > Fiction
const nodes = [
  ['Books', null], ['Programming', 'Books'], ['Fiction', 'Books'],
  ['Databases', 'Programming'], ['JavaScript', 'Programming'], ['Node', 'JavaScript'],
];
const pathOf = {};
for (const [name, parent] of nodes) {
  pathOf[name] = parent ? `${pathOf[parent]}${name},` : `,${name},`;
  await cats.insertOne({ _id: name, parent, path: pathOf[name], ancestors: parent ? [...(pathOf[parent].split(',').filter(Boolean))] : [] });
}
// Padding: 20,000 unrelated categories so the index has something to skip
await cats.insertMany(Array.from({ length: 20_000 }, (_, i) => ({ _id: `x${i}`, parent: 'Other', path: `,Other,x${i},`, ancestors: ['Other'] })));

// Parent references: direct children is one indexed equality query
console.log('children of Programming:', (await cats.find({ parent: 'Programming' }).toArray()).map(c => c._id));
// ...but the whole subtree needs a recursive $graphLookup
const [sub] = await cats.aggregate([
  { $match: { _id: 'Programming' } },
  { $graphLookup: { from: 'categories', startWith: '$_id', connectFromField: '_id', connectToField: 'parent', as: 'desc' } },
]).toArray();
console.log('graphLookup subtree:', sub.desc.map(d => d._id).sort());

// Materialized path: the subtree is one anchored-prefix regex on an indexed string
const q = { path: /^,Books,Programming,/ };
console.log('regex subtree:', (await cats.find(q).sort({ path: 1 }).toArray()).map(c => c.path));
const e = (await cats.find(q).explain('executionStats'));
const ix = e.queryPlanner.winningPlan.inputStage ?? e.queryPlanner.winningPlan;
console.log('plan:', e.queryPlanner.winningPlan.stage, '<-', ix.stage, JSON.stringify(ix.indexBounds),
  '| keys', e.executionStats.totalKeysExamined, 'docs', e.executionStats.totalDocsExamined);

// Array of ancestors: subtree is an equality match on a multikey index
await cats.createIndex({ ancestors: 1 });
console.log('ancestors subtree:', (await cats.find({ ancestors: 'Programming' }).toArray()).map(c => c._id).sort());
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   children of Programming: [ 'Databases', 'JavaScript' ]
//   graphLookup subtree: [ 'Databases', 'JavaScript', 'Node' ]
//   regex subtree: [
//     ',Books,Programming,',
//     ',Books,Programming,Databases,',
//     ',Books,Programming,JavaScript,',
//     ',Books,Programming,JavaScript,Node,'
//   ]
//   plan: FETCH <- IXSCAN {"path":["[\",Books,Programming,\", \",Books,Programming-\")","[/^,Books,Programming,/, /^,Books,Programming,/]"]} | keys 5 docs 4
//   ancestors subtree: [ 'Databases', 'JavaScript', 'Node' ]
```

The plan is an `IXSCAN` on `path_1` with bounds `[",Books,Programming,", ",Books,Programming-")`. It examined 5 keys (4 matches plus the first key past the range) and fetched 4 documents, even though the collection has 20,006 documents. The regex subtree includes `Programming` itself because its path matches the prefix. The `$graphLookup` and `ancestors` queries return only the descendants.

**Example 8 — edge case: which regexes the path index can serve, and what moving a subtree costs.** Only an anchored, case-sensitive prefix becomes a tight range. Moving a node rewrites every descendant's path.

javascript

```
// tree-edge.mjs — which regexes the path index can serve, and what moving a subtree costs
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('patterns_tree_edge');
await db.dropDatabase();
const cats = db.collection('categories');
await cats.createIndex({ path: 1 });
await cats.insertMany([
  ',Books,', ',Books,Programming,', ',Books,Programming,Databases,',
  ',Books,Programming,JavaScript,', ',Books,Programming,JavaScript,Node,', ',Books,Fiction,',
].map(path => ({ path })));
await cats.insertMany(Array.from({ length: 20_000 }, (_, i) => ({ path: `,Other,x${i},` })));

for (const re of [/^,Books,Programming,/, /Programming,/, /^,books,programming,/i]) {
  const e = await cats.find({ path: re }).explain('executionStats');
  const s = e.executionStats;
  console.log(String(re).padEnd(24), 'returned', s.nReturned, '| keys examined', s.totalKeysExamined);
}

// Moving JavaScript (and everything under it) from Programming to Books rewrites every descendant
const oldPrefix = ',Books,Programming,JavaScript,', newPrefix = ',Books,JavaScript,';
const r = await cats.updateMany(
  { path: { $regex: '^' + oldPrefix } },
  [{ $set: { path: { $concat: [newPrefix, { $substrCP: ['$path', oldPrefix.length, { $strLenCP: '$path' }] }] } } }],
);
console.log('move subtree:', { matched: r.matchedCount, modified: r.modifiedCount });
console.log((await cats.find({ path: /^,Books,/ }).sort({ path: 1 }).toArray()).map(c => c.path));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   /^,Books,Programming,/   returned 4 | keys examined 5
//   /Programming,/           returned 4 | keys examined 20006
//   /^,books,programming,/i  returned 4 | keys examined 20006
//   move subtree: { matched: 2, modified: 2 }
//   [
//     ',Books,',
//     ',Books,Fiction,',
//     ',Books,JavaScript,',
//     ',Books,JavaScript,Node,',
//     ',Books,Programming,',
//     ',Books,Programming,Databases,'
//   ]
```

All three regexes return the same 4 documents. The anchored one examines 5 index keys. The unanchored `/Programming,/` and the case-insensitive `/i` versions both examine all 20,006 keys: they still walk the index, but they test every key against the regex. The fix for case is to store the path in one case, not to add `/i`. The move is a single pipeline `updateMany` that rewrites 2 documents here. In a real catalog, moving a top-level node rewrites every document under it. Node names that contain regex metacharacters (`.`, `+`, `(`) must be escaped before you build the prefix pattern.

## Common mistakes & gotchas

- **A bucket upsert with no cap in the filter.** `{ sensorId, start }` alone pushes into one document forever. Include `count: { $lt: N }`, or bound the bucket by time.
- **Treating a bucket as a row.** The day query in Example 1 returns 24 documents, not 1,440 readings. Flatten with `$unwind` if you need one result per reading.
- **`$push` with no `$slice`.** The "recent" array then grows without a bound, which is the problem the subset was meant to solve.
- **A computed field updated on only some write paths.** One service `$inc`s and another inserts directly, and the totals drift with no error. One function should do both writes, or you recompute on a schedule.
- **Copying a volatile field.** `lastLoginAt` or a stock level means a fan-out on every change. Copy fields that rarely change, and name the source of truth.
- **A fan-out with no index.** `updateMany({ 'customer._id': id })` without an index on `customer._id` scans every order.
- **Outlier logic that only some writers know.** A direct `$push` bypasses the cap. Route every write through one function.
- **An unanchored or case-insensitive path regex.** It examines every key (Example 8). Anchor with `^` and write the path in one case.
- **A prefix with no delimiter at the end.** `^,Books,Prog` also matches `,Books,Programming,` and `,Books,Prognosis,`. End the prefix with the delimiter.
- **A full unique index on a type-only field.** A unique index on `isbn` indexes every shirt as `isbn: null`, so a second document with no isbn collides. Use a partial index filtered on `type`.

## Best practices

- Name the read first. Each pattern is justified by one query. Record `explain('executionStats')` before and after.
- Measure with `$collStats` and `explain`: document count, `size`, `totalIndexSize`, `totalKeysExamined`, `totalDocsExamined`.
- Prefer a time series collection for measurements over time. Hand-built buckets are for groupings the server does not know, such as "all events of one order."
- Bound every embedded array with `$slice`, a count in the filter, or a cap plus overflow.
- Keep the invariant in one function: the detail and the summary, or the detail and the subset.
- Plan the fan-out: which job updates the copies, which index it uses, and how stale a copy may be.
- For trees, pick the shape from the common operation. Parent references when moves are common. A path or an ancestors array when subtree reads are common. Both if you need both, and then both fields must stay in sync.

## ⭐ Interview lens

> **Q: “We store one document per IoT reading and the collection has 2 billion documents. What would you change?”**  
> Bucket by device and time, or use a time series collection, which buckets inside the server. A hand-built bucket is one document per device-hour holding the readings plus `count`, `sum`, `min`, and `max`. The write is an upsert whose filter includes `count` less than N, so a full hour starts a new document. In the measurement in Example 1, 100,000 readings went from 100,000 documents and a 2,072 KB index to 1,670 documents and a 68 KB index, and a one-day query went from 1,440 documents examined to 24. The reading values themselves are still stored, so the data does not shrink by the same factor as the document count. What shrinks is per-document overhead and index entries. The limit is the read shape: you get buckets, not one document per reading, so callers that expect a row per sample have to flatten.

> **Q: “How do you show the 3 newest reviews on a product page without loading all of them?”**  
> Use the subset pattern. Store every review in `reviews`, with an index on `{ productId: 1, at: -1 }`, and embed only the newest three on the product. The update is `$push` with `$each`, `$position: 0`, and `$slice: 3`, which inserts at the front and keeps the array at length 3 in one atomic write. The page is one read of the product. The full history stays queryable in `reviews`. The cost is two writes per review, and the three newest reviews exist twice. The limit is a writer that `$push`es without `$slice`: the embedded array grows without a bound, which is the problem you were avoiding. One function should write the review document and the subset together.

> **Q: “What goes wrong with the extended reference pattern?”**  
> The copied fields go stale. An extended reference stores a few fields of the related document, such as `{ _id, name }`, so a list screen does not join. When the source changes, every copy still shows the old value until a fan-out `updateMany` runs, and that update scans the whole collection unless you indexed the copied id. For example, renaming a customer updates `customers` immediately and updates orders only when the job finishes. Copy fields that rarely change. Decide which copies are snapshots on purpose, such as the address on an order that has already shipped. The limit is a field that changes often, such as a stock level: the fan-out becomes the hot path, and you were better off with a join.

> **Q: “Parent references or materialized paths for a category tree?”**  
> A parent reference stores `parent` on each node. Listing children is one indexed equality query, and moving a node rewrites one document. A whole subtree needs `$graphLookup`, a recursive search on the server. A materialized path stores a string such as `,Books,Programming,Databases,`. A subtree is one index range scan from an anchored, case-sensitive prefix regex, and sorting by the path is depth-first. Moving a node rewrites the path of every descendant. If subtree reads dominate and moves are rare, use paths, often together with `parent`. The limit is the regex. A case-insensitive flag or a pattern that does not start with `^` makes the index test every key, so the path no longer narrows the scan. End the prefix with the delimiter so `,Books,Prog` does not match `Programming`.

## Cheat-card

- Bucket: one document per group, upsert with `count: { $lt: N }`. Measured here: 100,000 documents to 1,670, index 2,072 KB to 68 KB.
- Time series collections, added in 5.0, bucket inside the server. Prefer them for measurements over time.
- Subset: `$push` with `$each`, `$position: 0`, and `$slice: N`, plus the full collection. Two writes per item.
- Computed: `$inc` the totals on write. A read examines 1 document instead of N. The totals drift if a write is missed.
- Extended reference: copy `{ _id, name }`. Stale until an `updateMany` fan-out. Index the copied `_id`.
- Outlier: cap the array, set `hasOverflow`, and read the overflow only when the flag is set.
- Polymorphic: a shared `type` field, and partial indexes for fields that only one type has.
- Trees: parent reference for cheap moves, ancestors array for multikey equality, materialized path for an anchored prefix. A move rewrites descendants.
- Only an anchored, case-sensitive prefix gets tight index bounds. `/x/` and `/^x/i` examine every key.
- Measure with `$collStats` and `explain('executionStats')`.

## Good to know

- Example 1 used 100,000 readings: 10 sensors times 10,000 minutes. `fsync` forced a WiredTiger checkpoint so the on-disk sizes matched the data just written. `scale: 1024` reports kilobytes.
- The anchored bounds in Example 7 are `[",Books,Programming,", ",Books,Programming-")`, because `-` is the character after `,` in ASCII.

---

## Learn More

- [Schema Design Patterns www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/)
- [Group Data with the Bucket Pattern www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/group-data/bucket-pattern/)
- [Group Data with the Subset Pattern www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/group-data/subset-pattern/)
- [Group Data with the Outlier Pattern www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/group-data/outlier-pattern/)
- [Use the Computed Pattern www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/computed-values/computed-schema-pattern/)
- [Polymorphic Schema Pattern www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/design-patterns/polymorphic-data/polymorphic-schema-pattern/)
- [Building with Patterns: The Extended Reference Pattern www.mongodb.com](https://www.mongodb.com/company/blog/building-with-patterns-the-extended-reference-pattern)
- [Model Tree Structures www.mongodb.com](https://www.mongodb.com/docs/manual/applications/data-models-tree-structures/)
- [Model Tree Structures with Materialized Paths www.mongodb.com](https://www.mongodb.com/docs/manual/tutorial/model-tree-structures-with-materialized-paths/)
- [$collStats (aggregation stage) www.mongodb.com](https://www.mongodb.com/docs/manual/reference/operator/aggregation/collstats/)
- [Time Series Collections www.mongodb.com](https://www.mongodb.com/docs/manual/core/timeseries-collections/)
