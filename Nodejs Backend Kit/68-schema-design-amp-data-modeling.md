---
title: "Schema Design &amp; Data Modeling"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/schema-design
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Schema Design &amp; Data Modeling

*9 min read · Updated 24 Jul 2026 Topic 44 of 70 Bookmark Mark done Why it matters You can learn every query operator in an afternoon · Topic 44 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/schema-design](https://www.geekyfrontend.in/learn/nodejs-backend-kit/schema-design)

---

## Say it in 30 seconds

Schema design in MongoDB is choosing, for each relationship, whether to embed the related data inside the parent document or to store an id and look it up later. You embed when the data is owned, read together, and bounded in size, because one fetch returns the whole screen. You reference when the child is shared, large, or can grow without a limit. The trade-off is the 16 MB document cap and the cost of rewriting a huge document on every update, which is why an ever-growing array does not belong inside the parent.

## Why it matters

You can learn query operators in an afternoon. The shape of the documents decides how many round trips a page costs, how big the working set is, whether writes collide, and whether a later feature becomes a migration. The MongoDB rule of thumb is that data accessed together should be stored together. That choice is worth more than any single index.

SQL habits push you to split every entity and join. Document modeling often does the opposite: embed related data so one read returns a screen. Knowing when to embed and when to reference, and being able to say why, is the difference between a fast API and a slow one.

## The concept, simply

You have two tools. **Embedding** nests the related data inside the parent document. **Referencing** stores an `ObjectId` that points at a document in another collection, and you fetch it with a second query.

![Side by side comparison of an order with items embedded versus an order referencing a separate user by id](assets/i41_01_7b178f88.svg)

Embed when the data is owned, read together, and bounded. Reference when it is shared, large, or updated on its own.

Embed "contains" relationships that are one-to-few and read together, such as an order and its line items, or a post and its tags. Reference "relates to" relationships that are one-to-many or many-to-many, where the child is large, shared, or unbounded, such as a user and their thousands of orders, or a product that appears in many carts.

## How it works (deep)

Embedding is one `findOne`. The parent and the nested data come back together. There is no join. The cost is document growth. MongoDB's hard limit is **16 MB per BSON document**. If a nested array can grow without a bound, comments on a viral post or an append-only log, embedding eventually hits that limit, and long before that every update rewrites the whole large document. That is the unbounded-array anti-pattern.

Referencing keeps documents small and lets children grow on their own. Reading costs a second lookup. Mongoose `populate()` issues extra queries. The aggregation `$lookup` stage does a join on the server. Both add latency. Embedding makes reads cheap and makes writes rewrite more. Referencing makes writes and growth cheap and makes reads pay for a join.

**Indexes** are the other half. An index is a sorted B-tree of a field's values so MongoDB can jump to matching documents instead of scanning the collection.

![A collection scan reading every document on the left versus a B-tree index lookup examining a handful on the right](assets/i41_02_00012497.svg)

Without an index a query reads every document. With the right index it walks a tree.

Every collection has a unique index on `_id`. Add indexes for fields you filter or sort on. For a compound index, use the **ESR rule**: Equality, then Sort, then Range. An index on `{ status: 1, createdAt: -1 }` can filter `status` by equality and return `createdAt` order without a separate in-memory sort. Indexes cost RAM, disk, and write time, because every insert or update also updates every index that includes the changed fields. Too many indexes is its own bug.

**Denormalization** means storing the same value in two places, for example copying an author's display name onto each post, so a read does not need a join. When the source changes you must update the copies. Copy only fields that rarely change and are read constantly.

## Code examples

Embedding — line items live inside the order because they are owned by it and always read with it:

javascript

```
const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  total:  Number,
  status: { type: String, enum: ['pending', 'paid', 'shipped'], index: true },
  items: [{                       // embedded sub-documents
    sku:   String,
    name:  String,
    qty:   { type: Number, min: 1 },
    price: Number
  }],
  createdAt: { type: Date, default: Date.now }
});

// One read returns the order AND all its items:
const order = await Order.findById(id); // order.items is right there
```

Referencing — a user has many orders, an unbounded relationship, so we link by id and resolve on demand:

javascript

```
const userSchema = new mongoose.Schema({
  name:  String,
  email: { type: String, unique: true }
  // NOTE: we do NOT embed orders here - they are unbounded
});

// Resolve the reference with populate (extra query under the hood):
const enriched = await Order.findById(id)
  .populate('userId', 'name email') // fetch only these user fields
  .lean();

// Or a server-side join with aggregation:
const rows = await Order.aggregate([
  { $match: { status: 'paid' } },
  { $lookup: {
      from: 'users', localField: 'userId',
      foreignField: '_id', as: 'user'
  }},
  { $unwind: '$user' }
]);
```

Compound index following the ESR rule (Equality → Sort → Range):

javascript

```
// Query: find paid orders, newest first, above a price floor
// Order.find({ status: 'paid', total: { $gt: 50 } }).sort({ createdAt: -1 })
orderSchema.index({ status: 1, createdAt: -1, total: 1 });
//                  ^equality   ^sort          ^range

// Verify the index is actually used:
const plan = await Order.find({ status: 'paid' })
  .sort({ createdAt: -1 })
  .explain('executionStats');
// Look for stage IXSCAN (good) vs COLLSCAN (bad)
```

Controlled denormalization — copy a rarely-changing field to skip a join:

javascript

```
const postSchema = new mongoose.Schema({
  title: String,
  body:  String,
  author: {                    // denormalized snapshot
    _id:  mongoose.Schema.Types.ObjectId,
    name: String               // duplicated from the users collection
  }
});
// Feed page renders author name with zero joins.
// Trade-off: if a user renames, you must update their posts.
```

## Common mistakes & gotchas

- **Unbounded embedded arrays.** Comments, events, or logs that grow forever hit the 16 MB cap, and every update rewrites a huge document. Reference them, or bucket them.
- **Modeling like SQL.** A collection per entity produces a join on every screen. Model the access pattern.
- **Too many indexes.** Each one costs RAM and slows writes. Index the queries you actually run.
- **Wrong compound-index field order.** `{ createdAt: -1, status: 1 }` does not serve an equality filter on `status` well. Equality, then sort, then range.
- **Sorting on a field with no index.** MongoDB sorts in memory and aborts past the sort memory limit.
- **Copying a value that changes often.** You pay a fan-out update and the copies drift. Copy stable, read-hot fields.
- **`populate` inside a loop.** That is one query per parent. Batch with one `$in` or one `$lookup`.

## Best practices

- Start from the screen: what does this request read? Shape the document so that read is one or two queries.
- Embed one-to-few, owned, read-together data. Reference one-to-many, shared, or unbounded data.
- Build compound indexes in ESR order and check `explain('executionStats')` for `IXSCAN`, not `COLLSCAN`.
- If an embedded array could grow large, reference it or use the bucket pattern (lesson 69).
- Put a unique index on a natural key such as email.
- When you copy a field, write down which collection is the source of truth.
- Index reference fields such as `userId`.

## ⭐ Interview lens

> **Q: Embedding vs referencing — how do you decide?**  
> Decide per relationship, from how the data is read and written. Embed when the child is owned by the parent, read with the parent, and bounded in size. An order and its line items are the usual example: one `findOne` returns the whole order. Reference when the child is shared across parents, updated on its own, or can grow without a bound. A user and their orders are the usual example: orders are unbounded, so each order stores `userId`. The sentence to keep is that data accessed together is stored together, unless it grows without a bound. The limit is 16 MB per document, and long before that cap an update rewrites the whole document, so a "small" embedded array that becomes huge is already the wrong shape.

> **Q: What is the document size limit and why does it matter for design?**  
> A BSON document cannot exceed 16 MB. That cap is why you cannot embed an unbounded list such as every comment, click, or log line inside the parent. Even before you hit 16 MB, every update rewrites the entire document, so a large array makes writes expensive and increases contention. For example, a post that embeds every comment works in development and fails, or becomes slow, once the post is popular. Reference the comments, or group them with the bucket pattern so each document holds a bounded chunk. The limit of referencing is the extra read: you pay a `populate` or a `$lookup` to put the screen back together.

> **Q: Explain the ESR rule for compound indexes.**  
> ESR means equality, then sort, then range, and it is the field order of a compound index. Equality fields come first so the B-tree can seek to one contiguous slice. The sort field comes next so walking that slice already returns rows in order, and `limit` can stop early. Range fields come last and are tested on the key. For example, "paid orders, newest first, total at least 100" wants `{ status: 1, createdAt: -1, total: 1 }`. Put `total` before `createdAt` and the keys inside `paid` are ordered by total, so the server reads every matching key and sorts in memory. The limit is the prefix rule. An index on `{ status, createdAt }` does not serve a query on `createdAt` alone, because `createdAt` is not sorted across different status values.

> **Q: Is denormalization good or bad in MongoDB?**  
> It is a tool you use on purpose. A document database expects you to copy a stable, frequently read field so the read does not join. Copying an author's display name onto each post means the post list is one query. The cost is a fan-out: when the source changes, every copy must be updated, and until that job runs the copies are stale. For example, a rename of a customer has to `updateMany` on the orders that stored the name, and that update needs an index on the copied id. The limit is volatile data. Copying a stock count or a last-login time means a fan-out on every change, and the copies drift. Copy only fields that rarely change, and write down which side is the source of truth.

## Cheat-card

- Two tools: embed, or reference with an `ObjectId` plus `populate` or `$lookup`.
- Embed when the data is owned, read together, bounded, and one-to-few.
- Reference when it is shared, unbounded, updated alone, or one-to-many or many-to-many.
- Hard limit: 16 MB per document. Do not embed an unbounded array.
- Compound index order: equality, sort, range.
- `explain()` should show `IXSCAN`, not `COLLSCAN`.
- Denormalize stable, read-hot fields only. Index the reference keys.
- Next: aggregation (lesson 71), schema patterns (lesson 69), indexes (lesson 70), sharding (lesson 72).

## Good to know

- Measured prefix: `{ status: 1, createdAt: -1 }` serves "paid, newest 20" with 20 keys examined. "Newest 20 of any status" is still a `SORT` over a `COLLSCAN` of 50,000 documents, because `createdAt` is only ordered inside one status.
- Q: What are the downsides of many indexes? Each index uses RAM and disk, and every write updates every index that includes the changed fields, so write throughput drops. Index the queries you run and drop the ones `$indexStats` shows are unused.
- Q: How would you model a user and their orders? Reference. Store `userId` on each order, because orders are unbounded and updated on their own. Index `userId`. Load the user with one batched lookup, not `populate` inside a loop.
- Q: You have an embed-or-reference design. What do you check before you call it done? `explain('executionStats')` on realistic volume: keys and documents examined close to the number returned, and no in-memory `SORT` on a paged query. Reports should run as aggregation on the server. Unbounded or join-heavy shapes belong in the patterns of lesson 69. If the collection will outgrow one server, the shard key should match the equality field of the main query (lesson 72).

---

## Learn More

- [Data Modeling in MongoDB www.mongodb.com](https://www.mongodb.com/docs/manual/data-modeling/)
- [Data Model Design (Embedding vs Referencing) www.mongodb.com](https://www.mongodb.com/docs/manual/core/data-model-design/)
- [Mongoose Schemas Guide mongoosejs.com](https://mongoosejs.com/docs/guide.html)
- [MongoDB Data Modeling and Schema Fundamentals | From Relational to Document Model MongoDB](https://www.youtube.com/watch?v=hmGz79ae2AY)
- [A Complete Methodology of Data Modeling for MongoDB MongoDB](https://www.youtube.com/watch?v=DUCvYbcgGsQ)


---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and the `mongodb` driver 7.7.0, MongoDB 8.2.6 run locally via mongodb-memory-server's downloaded mongod binary (no Docker)*

### Where to go next: lessons 69–72
This lesson stops at "embed or reference, then add an index". Four later lessons take each part further. Once a design is in place, three questions come up. How do I compute things across many documents without loading them into Node? Which shape fits data that is neither "owned and bounded" nor "shared and unbounded"? Is the index actually used, and what does it cost? A fourth comes later: what happens when one server is no longer enough? Each question has its own lesson:

- **[Lesson 71 — MongoDB Aggregation Pipeline](71-mongodb-aggregation-pipeline.md).** The pipeline of stages (`$match`, `$group`, `$lookup`, `$unwind`, `$project` and the rest) that computes on the server. The `$lookup` here is one stage of it.
- **[Lesson 69 — MongoDB Schema Patterns](69-mongodb-schema-patterns.md).** The named patterns between embedding and referencing: bucket, subset, computed, extended reference, outlier, polymorphic, and tree structures. Each one comes with a document shape, the query it makes cheap and the cost, measured. The bucket pattern mentioned in this lesson's best practices is worked through there, with real document counts and index sizes.
- **[Lesson 70 — MongoDB Indexes in Depth](70-mongodb-indexes-in-depth.md).** TTL, partial, sparse, unique-among-active, text, wildcard and hashed indexes. It also has the ESR rule measured with `explain('executionStats')` on 200,000 documents, and what index builds lock in MongoDB 8.x.
- **[Lesson 72 — MongoDB Sharding](72-mongodb-sharding.md).** Splitting one collection across several servers by a shard key. The shard key is the schema decision that is hardest to change later.

How the four connect to this lesson:

1. You choose a document shape here (embed or reference).
2. Reads that span many documents become pipelines (97).
3. Shapes that strain the two baselines become patterns (98).
4. Every hot query gets an index you have checked with `explain` (99).
5. When the data or write rate outgrows one replica set, the shard key (100) has to fit the same access patterns.

**Example — the questions those lessons answer, on this lesson's own `orders` shape.** The script uses 50,000 orders shaped like the embedding example above. It runs a server-side aggregation (the subject of lesson 71) and the "paid, newest first" query from the ESR example, before and after its index (the subject of lesson 70). The last line is the edge case below.

javascript

```
// motivate.mjs — lesson 68's orders, 50,000 of them: one aggregation and one explain
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6301/');
const db = client.db('l44_motivate');
await db.dropDatabase();
const orders = db.collection('orders');
const STATUSES = ['pending', 'paid', 'shipped'];
await orders.insertMany(Array.from({ length: 50_000 }, (_, i) => ({
  userId: i % 1000, status: STATUSES[i % 3], total: (i * 37) % 500,
  items: [{ sku: `S${i % 50}`, qty: 1 + (i % 3), price: (i * 37) % 500 }],
  createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
})));

// Lesson 71: an aggregation pipeline answers "revenue and order count per status" on the server
console.log(await orders.aggregate([
  { $group: { _id: '$status', orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
  { $sort: { revenue: -1 } },
]).toArray());

// Lesson 70: the "paid, newest first" query from lesson 68, before and after its index
const plan = async (filter = { status: 'paid' }) => {
  const e = await orders.find(filter).sort({ createdAt: -1 }).limit(20).explain('executionStats');
  const stages = [...JSON.stringify(e.queryPlanner.winningPlan).matchAll(/"stage":"(\w+)"/g)].map(m => m[1]);
  return `${stages.join('<-')} keys=${e.executionStats.totalKeysExamined} docs=${e.executionStats.totalDocsExamined}`;
};
console.log('no index:          ', await plan());
await orders.createIndex({ status: 1, createdAt: -1 });
console.log('{status, createdAt}:', await plan());
// Edge case: the same index, but the query does not constrain status
console.log('any status, newest:', await plan({}));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   [
//     { _id: 'pending', orders: 16667, revenue: 4161321 },
//     { _id: 'paid', orders: 16667, revenue: 4158500 },
//     { _id: 'shipped', orders: 16666, revenue: 4155179 }
//   ]
//   no index:           SORT<-COLLSCAN keys=0 docs=50000
//   {status, createdAt}: LIMIT<-FETCH<-IXSCAN keys=20 docs=20
//   any status, newest: SORT<-COLLSCAN keys=0 docs=50000
```

The aggregation returns three small summary documents instead of shipping 50,000 orders to Node. Without an index, the 20-row page reads all 50,000 documents and sorts them in memory (the `SORT` stage). With `{ status: 1, createdAt: -1 }` it examines 20 keys and 20 documents, and the `SORT` stage is gone. Lesson 70 shows the range field added to this index, and what goes wrong if it is put in the wrong position.

### Common mistakes & gotchas (additional topics)
- **Treating `IXSCAN` in `explain` as the finish line.** In the output above, the indexed plan is good because keys examined (20) equals documents returned (20) and there is no `SORT` stage. Lesson 70 has a case with an `IXSCAN` that still examines 36,000 keys for 20 results.
- **Aggregating in Node instead of on the server.** `find()` followed by a JavaScript `reduce` ships every document over the network. A `$group` ships only the result.
- **Choosing a shard key after the schema is fixed.** The shard key comes from the same access patterns as the schema, so decide both together (lesson 72).

### Edge case worked through: an index that exists but cannot help
The `orders` index `{ status: 1, createdAt: -1 }` from the example does nothing for a query on `createdAt` alone, such as "the 20 newest orders of any status". In that query `status` is not constrained, so the server cannot seek into the index. The keys are sorted by `createdAt` only *within* each status. The last line of the example's output shows the result: `SORT<-COLLSCAN` over all 50,000 documents, even though the index exists. Lesson 70 (Example 2, "prefix rule") shows the same thing for a range filter. The fix is either a separate `{ createdAt: -1 }` index or a query that also states the `status` values it wants.

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
