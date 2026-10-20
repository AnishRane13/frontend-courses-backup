---
title: "MongoDB Aggregation Pipeline"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# MongoDB Aggregation Pipeline

*26 min read · Updated 12 Oct 2026 · Topic 97 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and the `mongodb` Node driver 7.7.0 against MongoDB 8.2.6 run locally via mongodb-memory-server's downloaded mongod binary (no Docker)

---

## Why it matters

`find()` returns documents as they are stored. Reports need something else: revenue per month, the top customers with their latest order, a product search page with counts per category and per price range. You could fetch every order into Node and loop over it, but then the whole collection crosses the network, Node holds it in memory, and each report becomes a hand-written loop.

The aggregation pipeline moves that work into the database. You send an array of stages, and `mongod` runs them next to the data and returns only the result. A 2,000-order collection becomes 15 report rows before anything leaves the server.

Two things decide whether a pipeline is fast or slow, and both are visible only if you read `explain()`:

- **Stage order.** A `$match` that reaches the start of the pipeline can use an index. A `$match` on a value that `$group` computed cannot, so the server reads every document.
- **Memory.** Blocking stages such as `$group` and `$sort` hold their working set in memory, with a limit of 100 MB per stage. Past that, the stage either writes temporary files to disk or the command fails, depending on `allowDiskUse`.

Lesson [43](67-mongodb-amp-mongoose.md) covers basic queries and Mongoose. Lesson [44](68-schema-design-amp-data-modeling.md) explains when to embed and when to reference, which decides how much `$lookup` and `$unwind` you need. This lesson builds three reports on a generated shop dataset and reads the real `explain()` output for each important case.

## The concept, simply

A pipeline is an ordered list of stages. Each stage takes a stream of documents, does one job, and passes a new stream to the next stage. Documents flow through it like water through pipes and filters:

text

```
orders collection (2,000 documents)
   │
   ▼  $match    status in [paid, shipped], createdAt in Apr–Jun  ◄─ can use the {status, createdAt} index
   │            (fewer documents)
   ▼  $unwind   items                                            ◄─ one document per line item (more documents)
   ▼  $addFields month, lineTotal                                ◄─ adds fields, same count
   ▼  $group    by { month, category }                           ◄─ BLOCKING: must see every input first
   │            (15 documents)                                       100 MB limit per stage
   ▼  $project  rename and round fields
   ▼  $sort     month ascending, revenue descending              ◄─ BLOCKING (no index can help here)
   ▼
 cursor → driver → your code (15 report rows)
```

The stages used in this lesson:

| Stage | What it does |
|---|---|
| `$match` | Keeps documents that match a query filter (same syntax as `find`). |
| `$project` | Keeps, removes, renames or computes fields. |
| `$addFields` / `$set` | Adds computed fields and keeps all the others. |
| `$unwind` | Turns one document with an array into one document per element. |
| `$group` | Groups by an `_id` expression and computes accumulators (`$sum`, `$avg`, `$addToSet`, `$first`, …). |
| `$sort`, `$skip`, `$limit` | Order the stream, skip the first N, keep the first N. |
| `$lookup` | Joins documents from another collection into an array field. |
| `$facet` | Runs several sub-pipelines on the same input and returns one document with one array per sub-pipeline. |
| `$bucket` | Groups by ranges of a value (price bands, age bands). |
| `$merge` / `$out` | Write the result into a collection instead of returning it. |

## How it works

What happens when Node calls `collection.aggregate(pipeline)`:

1. The driver sends one `aggregate` command with the stage array. Nothing runs until you read the cursor (`toArray()`, `for await`, `next()`).
2. The server **parses** the stages and runs the **optimizer**, which reorders and merges stages when the result cannot change. For example, it moves a `$match` ahead of a `$sort` or `$addFields` it does not depend on, and folds a `$limit` into the `$sort` before it.
3. The server finds the longest **prefix** of the pipeline that the query layer can run. Usually that is a `$match`, `$sort` and simple `$project`, and often also `$group` and some `$lookup`s. That prefix is planned like a `find`: the planner picks an index (IXSCAN) or a collection scan (COLLSCAN).
4. In MongoDB 8.2 that prefix is usually run by the **slot-based execution engine (SBE)**. Any stages left over run one after another in the classic pipeline engine.
5. **Streaming stages** (`$match`, `$project`, `$unwind`) pass each document on immediately. **Blocking stages** (`$group`, `$sort` without an index, `$bucket`, `$facet`) must read all their input before they emit anything, and that is where memory goes.
6. The server returns the first batch of results, and the driver fetches the next batches as you iterate.

**Where explain puts the plan.** If the whole pipeline was pushed into the query layer, `explain()` has a top-level `queryPlanner` (often with `optimizedPipeline: true`). If some stages are left over, the result has a `stages` array: `stages[0].$cursor.queryPlanner` holds the index choice, and the remaining entries are the classic stages, one object each, in their optimized order. Under SBE the plan tree is at `winningPlan.queryPlan`; for a classic plan the tree is `winningPlan` itself. Example 5 handles both locations.

**Reading the plan tree.** Read it from the leaf (deepest `inputStage`) upward:

- `IXSCAN` reads index keys. `indexBounds` shows which key ranges it reads.
- `FETCH` loads the documents those keys point to.
- `COLLSCAN` reads every document in the collection.
- `PROJECTION_COVERED` means the index alone supplied every field needed.

With `explain('executionStats')` you also get `totalKeysExamined`, `totalDocsExamined` and `nReturned`. For blocking stages you get `usedDisk`, `spills` and `spilledBytes`.

**Why a `$match` after `$group` usually cannot use an index.** An index is built on stored fields. After `$group`, the documents are new: their `_id` is the group key and their other fields are accumulator results such as `n` or `revenue`, which exist nowhere on disk. A filter on `n` must therefore run after the group is computed, and the group must read every document of the input. The one exception seen on 8.2.6 (Example 5, case E) is a filter on the group key itself. `{ $match: { _id: 'paid' } }` after `{ $group: { _id: '$status' } }` is the same as filtering `status` before the group, and the optimizer rewrote it that way. That rewrite is not listed on the optimization docs page, so check `explain()` before relying on it.

**Memory limits.** Each blocking stage has a 100 MB memory budget (`internalDocumentSourceGroupMaxMemoryBytes` and `internalQueryMaxBlockingSortMemoryUsageBytes` both read `104857600` on 8.2.6). Since MongoDB 6.0 the server parameter `allowDiskUseByDefault` decides what happens when a stage passes the budget (changed in v6.0; before that, every command had to pass `allowDiskUse: true`). It is `true` on 8.2.6, so stages spill to temporary files unless the command passes `allowDiskUse: false`, in which case the command fails with code 292 `QueryExceededMemoryLimitNoDiskUseAllowed`. `$facet` cannot spill at all: each of its outputs is capped at 100 MB, and the single document it returns is capped at 16 MiB.

**`$lookup` in two forms.** The equality form `{ from, localField, foreignField, as }` looks up the foreign documents whose `foreignField` equals this document's `localField`. The pipeline form `{ from, let, pipeline, as }` runs a whole sub-pipeline per input document. `let` binds fields of the current document to variables (`$$cid`), and the sub-pipeline uses them inside `$expr`. Since MongoDB 5.0 you can combine `localField`/`foreignField` with a `pipeline` (added in v5.0). On 8.2.6 explain shows the two forms run differently (Example 5): the equality form runs inside SBE as an `EQ_LOOKUP` node, using an indexed loop join when the foreign field has an index and a hash join when it does not. The `let` form stays a separate `$lookup` stage that reports `indexesUsed`.

## Code examples

All scripts are ES modules (`.mjs`) run with `node <file>` in a folder where `npm install mongodb@7.7.0` was run. The server was a standalone mongod 8.2.6 on port 6201, started locally through mongodb-memory-server's downloaded binary; any local mongod 8.2 works. Every example reads `MONGO_URL` and falls back to `mongodb://127.0.0.1:6201`. Run Example 1 first; the others read its data.

**Example 1 — seed a repeatable e-commerce dataset.** It creates 40 products in 5 categories, 50 customers and 2,000 orders between 1 Jan and 30 Jun 2026. Each order embeds its line items with a snapshot of name, category and price (lesson 68's "embed what you read together"). `draft` orders have an empty `items` array, which matters in Example 8. A seeded PRNG makes every run produce the same data, so the outputs below can be reproduced.

javascript

```
// ex1-seed.mjs — build a small, repeatable e-commerce dataset in the "shop" database
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const db = client.db('shop');

// A seeded PRNG (mulberry32), so every run produces exactly the same data.
let seed = 42;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));

const categories = ['books', 'games', 'garden', 'kitchen', 'toys'];
const products = Array.from({ length: 40 }, (_, i) => ({
  _id: `p${String(i + 1).padStart(2, '0')}`,
  name: `Product ${i + 1}`,
  category: categories[i % categories.length],
  price: int(5, 250) - 0.01,                 // 4.99 … 249.99
  inStock: rand() > 0.2,
}));

const names = ['Ada', 'Lin', 'Grace', 'Alan', 'Barbara', 'Ken', 'Margaret', 'Dennis', 'Radia', 'Edsger'];
const customers = Array.from({ length: 50 }, (_, i) => ({
  _id: i + 1,
  name: `${names[i % names.length]} ${i + 1}`,
  email: `c${i + 1}@example.com`,
  country: pick(['DE', 'IN', 'US', 'UK']),
}));

const start = Date.UTC(2026, 0, 1), end = Date.UTC(2026, 6, 1);   // Jan 1 – Jun 30, 2026
const orders = Array.from({ length: 2000 }, (_, i) => {
  const status = pick(['paid', 'paid', 'paid', 'shipped', 'shipped', 'cancelled', 'draft']);
  const items = status === 'draft' ? [] : Array.from({ length: int(1, 4) }, () => {
    const p = pick(products);
    // Snapshot name, category and price at purchase time (the price can change later).
    return { productId: p._id, name: p.name, category: p.category, qty: int(1, 3), price: p.price };
  });
  return {
    _id: i + 1,
    customerId: int(1, 50),
    status,
    createdAt: new Date(start + Math.floor(rand() * (end - start))),
    items,
  };
});

await db.dropDatabase();
await db.collection('products').insertMany(products);
await db.collection('customers').insertMany(customers);
await db.collection('orders').insertMany(orders);
await db.collection('orders').createIndex({ status: 1, createdAt: 1 });
await db.collection('orders').createIndex({ customerId: 1, createdAt: -1 });

for (const c of ['products', 'customers', 'orders']) {
  console.log(c, await db.collection(c).countDocuments());
}
console.log(await db.collection('orders').findOne({ _id: 1 }));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   products 40
//   customers 50
//   orders 2000
//   {
//     _id: 1,
//     customerId: 29,
//     status: 'shipped',
//     createdAt: 2026-06-28T22:19:23.459Z,
//     items: [
//       {
//         productId: 'p12',
//         name: 'Product 12',
//         category: 'games',
//         qty: 1,
//         price: 149.99
//       },
//       {
//         productId: 'p14',
//         name: 'Product 14',
//         category: 'kitchen',
//   …
```

**Example 2 — Report 1: monthly revenue by category (`$match`, `$unwind`, `$addFields`, `$group`, `$project`, `$sort`, `$skip`, `$limit`).** `$match` comes first so that it can use the `{ status: 1, createdAt: 1 }` index. `$unwind` produces one document per line item, so the `$group` can key on `items.category`. `$addToSet` collects distinct order ids, so "orders" counts orders, not line items.

javascript

```
// ex2-monthly.mjs — Report 1: revenue per month per category (paid + shipped orders, Q2 2026)
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const orders = client.db('shop').collection('orders');

const pipeline = [
  // 1. Filter first: this stage can use the { status: 1, createdAt: 1 } index.
  { $match: {
      status: { $in: ['paid', 'shipped'] },
      createdAt: { $gte: new Date('2026-04-01'), $lt: new Date('2026-07-01') },
  } },
  // 2. One document per line item.
  { $unwind: '$items' },
  // 3. Compute per-line values.
  { $addFields: {
      month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
      lineTotal: { $multiply: ['$items.qty', '$items.price'] },
  } },
  // 4. Group by (month, category).
  { $group: {
      _id: { month: '$month', category: '$items.category' },
      revenue: { $sum: '$lineTotal' },
      units: { $sum: '$items.qty' },
      orderIds: { $addToSet: '$_id' },
  } },
  // 5. Reshape the output.
  { $project: {
      _id: 0,
      month: '$_id.month',
      category: '$_id.category',
      revenue: { $round: ['$revenue', 2] },
      units: 1,
      orders: { $size: '$orderIds' },
  } },
  { $sort: { month: 1, revenue: -1 } },
];

const rows = await orders.aggregate(pipeline).toArray();
console.table(rows);

// $skip + $limit: page 2 of the same report, 5 rows per page.
const page2 = await orders.aggregate([...pipeline, { $skip: 5 }, { $limit: 5 }]).toArray();
console.log('page 2:', page2.map((r) => `${r.month} ${r.category}`));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   ┌─────────┬───────┬───────────┬───────────┬──────────┬────────┐
//   │ (index) │ units │ month     │ category  │ revenue  │ orders │
//   ├─────────┼───────┼───────────┼───────────┼──────────┼────────┤
//   │ 0       │ 238   │ '2026-04' │ 'games'   │ 33895.62 │ 94     │
//   │ 1       │ 232   │ '2026-04' │ 'toys'    │ 31325.68 │ 94     │
//   │ 2       │ 256   │ '2026-04' │ 'books'   │ 26373.44 │ 105    │
//   │ 3       │ 232   │ '2026-04' │ 'garden'  │ 25197.68 │ 96     │
//   │ 4       │ 222   │ '2026-04' │ 'kitchen' │ 18864.78 │ 102    │
//   │ 5       │ 241   │ '2026-05' │ 'toys'    │ 37688.59 │ 95     │
//   │ 6       │ 264   │ '2026-05' │ 'games'   │ 37377.36 │ 107    │
//   │ 7       │ 264   │ '2026-05' │ 'garden'  │ 28028.36 │ 103    │
//   │ 8       │ 268   │ '2026-05' │ 'kitchen' │ 27491.32 │ 112    │
//   │ 9       │ 242   │ '2026-05' │ 'books'   │ 22136.58 │ 102    │
//   │ 10      │ 239   │ '2026-06' │ 'toys'    │ 33097.61 │ 94     │
//   │ 11      │ 227   │ '2026-06' │ 'games'   │ 32634.73 │ 93     │
//   │ 12      │ 216   │ '2026-06' │ 'kitchen' │ 24723.84 │ 83     │
//   │ 13      │ 203   │ '2026-06' │ 'garden'  │ 22330.97 │ 90     │
//   │ 14      │ 180   │ '2026-06' │ 'books'   │ 16788.2  │ 78     │
//   └─────────┴───────┴───────────┴───────────┴──────────┴────────┘
//   page 2: [
//     '2026-05 toys',
//     '2026-05 games',
//     '2026-05 garden',
//     '2026-05 kitchen',
//     '2026-05 books'
//   ]
```

Two details in that output. First, `$dateToString` formats in UTC unless you pass `timezone`. An order at 23:30 on 30 April in New York counts as May here. Second, `$project` emitted the kept field `units` before the computed fields, so do not rely on field order in pipeline output. For paging, `$skip` + `$limit` after a `$sort` works, but the server still computes and sorts every row before skipping. For deep pages over large results, filter on the last seen sort key instead (lesson [41](65-validation-pagination-filtering-sorting.md) covers cursor pagination).

**Example 3 — Report 2: top customers with their profile and last order (`$lookup` both forms).** The first `$lookup` is an equality join on `_id`. The second uses `let` + `pipeline` to fetch only the newest non-draft order: the sub-pipeline sorts and limits inside the join, so only one order per customer is copied into the result.

javascript

```
// ex3-top.mjs — Report 2: top 5 customers by spend, with their profile and their last order
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const db = client.db('shop');

const pipeline = [
  { $match: { status: { $in: ['paid', 'shipped'] } } },
  { $unwind: '$items' },
  { $group: {
      _id: '$customerId',
      spent: { $sum: { $multiply: ['$items.qty', '$items.price'] } },
      orderIds: { $addToSet: '$_id' },
  } },
  { $sort: { spent: -1, _id: 1 } },          // _id breaks ties, so the order is stable
  { $limit: 5 },
  // Equality join: customers._id == this document's _id (the customerId we grouped on).
  { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
  { $unwind: '$customer' },                   // exactly one match, so turn the array into an object
  // Pipeline join with let: the most recent non-draft order of this customer.
  { $lookup: {
      from: 'orders',
      let: { cid: '$_id' },
      pipeline: [
        { $match: { $expr: { $eq: ['$customerId', '$$cid'] }, status: { $ne: 'draft' } } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        { $project: { _id: 1, status: 1, createdAt: 1, items: { $size: '$items' } } },
      ],
      as: 'lastOrder',
  } },
  { $project: {
      _id: 0,
      customer: '$customer.name',
      country: '$customer.country',
      spent: { $round: ['$spent', 2] },
      orders: { $size: '$orderIds' },
      lastOrder: { $first: '$lastOrder' },
  } },
];

for (const row of await db.collection('orders').aggregate(pipeline).toArray()) console.log(row);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   {
//     customer: 'Margaret 27',
//     country: 'DE',
//     spent: 27740.81,
//     orders: 38,
//     lastOrder: {
//       _id: 624,
//       status: 'paid',
//       createdAt: 2026-06-29T14:11:43.236Z,
//       items: 2
//     }
//   }
//   {
//     customer: 'Edsger 50',
//     country: 'DE',
//     spent: 23900.96,
//     orders: 36,
//     lastOrder: {
//       _id: 558,
//       status: 'shipped',
//       createdAt: 2026-06-26T10:47:47.499Z,
//       items: 4
//     }
//   }
//   …
```

The output is trimmed after the second customer; the other three have the same shape. The `$lookup`s run after `$limit: 5`, so they run 5 times, not 50. Joining before the limit would do the same work for every customer and then discard most of it.

**Example 4 — Report 3: a faceted product search (`$facet`, `$bucket`).** A search page needs four things from the same filtered set: a page of results, the total, counts per category, and counts per price band. `$facet` computes all four in one round trip.

javascript

```
// ex4-facet.mjs — Report 3: one request returns a results page, category counts and price buckets
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const products = client.db('shop').collection('products');

const [result] = await products.aggregate([
  { $match: { inStock: true } },                 // the shared filter, applied once
  { $facet: {                                    // each sub-pipeline gets the same input documents
      results: [
        { $sort: { price: 1, _id: 1 } },
        { $skip: 0 }, { $limit: 3 },
        { $project: { _id: 1, name: 1, category: 1, price: 1 } },
      ],
      total: [{ $count: 'n' }],
      byCategory: [
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },        // _id breaks ties, so the order is stable
      ],
      byPrice: [{ $bucket: {
          groupBy: '$price',
          boundaries: [0, 25, 50, 100, 200],     // [0,25) [25,50) [50,100) [100,200)
          default: '200+',                       // everything outside the boundaries
          output: { count: { $sum: 1 }, cheapest: { $min: '$price' } },
      } }],
  } },
]).toArray();

console.dir(result, { depth: null });

// Without "default", a price outside every boundary makes the whole stage fail.
try {
  await products.aggregate([{ $bucket: { groupBy: '$price', boundaries: [0, 25, 50] } }]).toArray();
} catch (err) {
  console.log('no default:', err.code, err.message.split(':: caused by :: ')[1]);
}
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   {
//     results: [
//       { _id: 'p10', name: 'Product 10', category: 'toys', price: 4.99 },
//       { _id: 'p26', name: 'Product 26', category: 'books', price: 22.99 },
//       {
//         _id: 'p34',
//         name: 'Product 34',
//         category: 'kitchen',
//         price: 23.99
//       }
//     ],
//     total: [ { n: 31 } ],
//     byCategory: [
//       { _id: 'games', count: 7 },
//       { _id: 'kitchen', count: 7 },
//       { _id: 'garden', count: 6 },
//       { _id: 'toys', count: 6 },
//       { _id: 'books', count: 5 }
//     ],
//     byPrice: [
//       { _id: 0, count: 3, cheapest: 4.99 },
//       { _id: 25, count: 4, cheapest: 33.99 },
//       { _id: 50, count: 8, cheapest: 52.99 },
//       { _id: 100, count: 12, cheapest: 110.99 },
//       { _id: '200+', count: 4, cheapest: 213.99 }
//     ]
//   }
//   no default: 7158303 $switch could not find a matching branch for an input, and no default was specified.
```

`$bucket` puts each document into the range `[boundary[i], boundary[i+1])`. The bucket `_id` is the lower bound, and anything outside the boundaries goes to `default`. Without a `default`, a document outside every range makes the stage fail. The last lines of the output show it: error 7158303. The message names `$switch`, not `$bucket`, which makes it hard to trace back to the stage. Here the `$match` runs before `$facet`, so it can use an index. A `$facet` that is the first stage always does a COLLSCAN, according to the `$facet` docs.

**Example 5 — stage order, the optimizer and `explain()`.** Five pipelines, each explained with `queryPlanner` verbosity, then two with `executionStats`, then three `$lookup` plans. The `summarize` helper prints the plan tree from leaf to root, whichever of the two locations it is in.

javascript

```
// ex5-explain.mjs — where the $match sits decides whether an index is used
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const orders = client.db('shop').collection('orders');

// The query-layer plan is at explain.queryPlanner when the whole pipeline was pushed down,
// or at explain.stages[0].$cursor.queryPlanner when some stages still run in the pipeline.
const summarize = (ex) => {
  const qp = ex.queryPlanner ?? ex.stages[0].$cursor.queryPlanner;
  const chain = [];
  for (let n = qp.winningPlan.queryPlan ?? qp.winningPlan; n; n = n.inputStage) {
    chain.push(n.indexName ? `${n.stage}(${n.indexName})` : n.stage);
  }
  const rest = (ex.stages ?? []).slice(1).map((s) => Object.keys(s)[0]);
  return { plan: chain.join(' <- '), parsedQuery: JSON.stringify(qp.parsedQuery), laterStages: rest };
};
const explain = async (label, pipeline) => {
  console.log(label, summarize(await orders.aggregate(pipeline).explain('queryPlanner')));
};

const paid = { status: 'paid' };
const byCustomer = { $group: { _id: '$customerId', n: { $sum: 1 } } };

await explain('A. $match first:', [{ $match: paid }, byCustomer]);
await explain('B. $match on an accumulator after $group:', [byCustomer, { $match: { n: { $gt: 25 } } }]);
await explain('C. $addFields, then $match on an original field:', [
  { $addFields: { month: { $month: '$createdAt' } } }, { $match: paid },
]);
await explain('D. $sort, then $match, then $limit:', [
  { $sort: { createdAt: -1 } }, { $match: paid }, { $limit: 3 },
]);
await explain('E. $match on the $group key:', [
  { $group: { _id: '$status', n: { $sum: 1 } } }, { $match: { _id: 'paid' } },
]);

// The raw JSON for D: no SORT stage, the index is walked backward instead.
const rawD = await orders.aggregate([{ $sort: { createdAt: -1 } }, { $match: paid }, { $limit: 3 }])
  .explain('queryPlanner');
const { inputStage: { inputStage: ix } } = rawD.queryPlanner.winningPlan;
console.log(JSON.stringify({ stage: ix.stage, indexName: ix.indexName, direction: ix.direction,
  indexBounds: ix.indexBounds }, null, 2));

// executionStats: how much work each version did.
const stats = async (label, pipeline) => {
  const ex = await orders.aggregate(pipeline).explain('executionStats');
  const es = ex.executionStats ?? ex.stages[0].$cursor.executionStats;
  console.log(label, { nReturned: es.nReturned, totalKeysExamined: es.totalKeysExamined,
    totalDocsExamined: es.totalDocsExamined });
};
await stats('A stats:', [{ $match: paid }, byCustomer]);
await stats('B stats:', [byCustomer, { $match: { n: { $gt: 25 } } }]);

// $lookup: localField/foreignField joins run in SBE as an EQ_LOOKUP node with a join strategy;
// a $lookup with let + pipeline stays a separate $lookup stage that reports indexesUsed.
const lookupPlan = async (label, coll, pipeline) => {
  const ex = await client.db('shop').collection(coll).aggregate(pipeline).explain('executionStats');
  const qp = (ex.queryPlanner ?? ex.stages[0].$cursor.queryPlanner).winningPlan.queryPlan;
  const lk = ex.stages?.find((s) => s.$lookup);
  console.log(label, lk
    ? { stage: '$lookup', indexesUsed: lk.indexesUsed, collectionScans: lk.collectionScans,
        totalDocsExamined: lk.totalDocsExamined }
    : { stage: qp.stage, strategy: qp.strategy, indexName: qp.indexName });
};
const firstThree = [{ $sort: { _id: 1 } }, { $limit: 3 }];
await lookupPlan('1. join on orders.customerId (indexed):  ', 'customers', [...firstThree,
  { $lookup: { from: 'orders', localField: '_id', foreignField: 'customerId', as: 'orders' } }]);
await lookupPlan('2. join on orders.items.productId (none):', 'products', [...firstThree,
  { $lookup: { from: 'orders', localField: '_id', foreignField: 'items.productId', as: 'orders' } }]);
await lookupPlan('3. let + pipeline on orders.customerId:  ', 'customers', [...firstThree,
  { $lookup: { from: 'orders', let: { cid: '$_id' }, as: 'orders',
      pipeline: [{ $match: { $expr: { $eq: ['$customerId', '$$cid'] } } }] } }]);
await lookupPlan('4. let + pipeline, $in on items.productId:', 'products', [...firstThree,
  { $lookup: { from: 'orders', let: { pid: '$_id' }, as: 'orders',
      pipeline: [{ $match: { $expr: { $in: ['$$pid', '$items.productId'] } } }] } }]);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   A. $match first: {
//     plan: 'GROUP <- FETCH <- IXSCAN(status_1_createdAt_1)',
//     parsedQuery: '{"status":{"$eq":"paid"}}',
//     laterStages: []
//   }
//   B. $match on an accumulator after $group: {
//     plan: 'GROUP <- COLLSCAN',
//     parsedQuery: '{}',
//     laterStages: [ '$match' ]
//   }
//   C. $addFields, then $match on an original field: {
//     plan: 'FETCH <- IXSCAN(status_1_createdAt_1)',
//     parsedQuery: '{"status":{"$eq":"paid"}}',
//     laterStages: [ '$addFields' ]
//   }
//   D. $sort, then $match, then $limit: {
//     plan: 'LIMIT <- FETCH <- IXSCAN(status_1_createdAt_1)',
//     parsedQuery: '{"status":{"$eq":"paid"}}',
//     laterStages: []
//   }
//   E. $match on the $group key: {
//     plan: 'GROUP <- PROJECTION_COVERED <- IXSCAN(status_1_createdAt_1)',
//     parsedQuery: '{"status":{"$eq":"paid"}}',
//     laterStages: []
//   }
//   {
//     "stage": "IXSCAN",
//     "indexName": "status_1_createdAt_1",
//     "direction": "backward",
//     "indexBounds": {
//       "status": [
//         "[\"paid\", \"paid\"]"
//       ],
//       "createdAt": [
//         "[MaxKey, MinKey]"
//       ]
//     }
//   }
//   A stats: { nReturned: 50, totalKeysExamined: 858, totalDocsExamined: 858 }
//   B stats: { nReturned: 50, totalKeysExamined: 0, totalDocsExamined: 2000 }
//   1. join on orders.customerId (indexed):   {
//     stage: 'EQ_LOOKUP',
//     strategy: 'IndexedLoopJoin',
//     indexName: 'customerId_1_createdAt_-1'
//   }
//   2. join on orders.items.productId (none): { stage: 'EQ_LOOKUP', strategy: 'HashJoin', indexName: undefined }
//   3. let + pipeline on orders.customerId:   {
//     stage: '$lookup',
//     indexesUsed: [ 'customerId_1_createdAt_-1' ],
//     collectionScans: 0,
//     totalDocsExamined: 103
//   }
//   4. let + pipeline, $in on items.productId: {
//     stage: '$lookup',
//     indexesUsed: [],
//     collectionScans: 3,
//     totalDocsExamined: 6000
//   }
```

How to read it:

- **A vs B** is the main lesson. With `$match` first, the plan is an IXSCAN on `status_1_createdAt_1` that examined 858 keys and 858 documents (the 858 paid orders). With the filter on the accumulator `n` after `$group`, the plan is a COLLSCAN of all 2,000 documents, and `$match` is left over as a classic stage. B's `nReturned: 50` counts the 50 groups that leave the query layer, before the `$match` runs.
- **C** was written with `$addFields` first. The optimizer moved the `$match` on `status` (a stored field) ahead of it, so the index is used and `$addFields` runs afterwards.
- **D** was written `$sort`, `$match`, `$limit`. The optimizer moved the `$match` ahead of the `$sort` and then served the sort from the same index, read backward (`"direction": "backward"`). There is no SORT stage in the plan at all.
- **E** is the group-key pushdown described in How it works. The plan is even covered (`PROJECTION_COVERED`), because `status` comes from the index keys.
- **The `$lookup` plans** show that a join on an indexed foreign field uses the index (`IndexedLoopJoin`), while a join on a field with no index builds a hash table from the foreign collection (`HashJoin`). The `let` form stays a classic `$lookup` stage. In case 3 its `$expr: { $eq }` match used the index. In case 4 no index could serve the `$in`, so the sub-pipeline scanned the 2,000 orders once per product: 3 collection scans and 6,000 documents examined for 3 input documents.

**Example 6 — writing results with `$merge` and `$out`.** A dashboard should not recompute six months of revenue on every page view. Write the report into a collection on a schedule, then read that collection. `$merge` upserts row by row into a collection, which can already exist. `$out` builds a new collection and swaps it in place of the old one when the pipeline finishes.

javascript

```
// ex6-merge.mjs — write report results into collections with $merge and $out
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const db = client.db('shop');
const orders = db.collection('orders');

const monthlyByCategory = (from, to) => [
  { $match: { status: { $in: ['paid', 'shipped'] }, createdAt: { $gte: from, $lt: to } } },
  { $unwind: '$items' },
  { $group: {
      _id: { month: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, category: '$items.category' },
      revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } },
  } },
  { $set: { revenue: { $round: ['$revenue', 2] }, refreshedAt: '$$NOW' } },
];

// $merge upserts into an existing (or new) collection, matching on _id by default.
const mergeInto = { $merge: { into: 'revenue_monthly', whenMatched: 'replace', whenNotMatched: 'insert' } };
for (const c of ['revenue_monthly', 'revenue_snapshot', 'status_counts']) await db.collection(c).drop().catch(() => {});

await orders.aggregate([...monthlyByCategory(new Date('2026-01-01'), new Date('2026-04-01')), mergeInto]).toArray();
console.log('after Q1 run:', await db.collection('revenue_monthly').countDocuments());
await orders.aggregate([...monthlyByCategory(new Date('2026-03-01'), new Date('2026-07-01')), mergeInto]).toArray();
console.log('after Mar–Jun run:', await db.collection('revenue_monthly').countDocuments(), '(March was replaced, not duplicated)');

// $out replaces the whole target collection with the pipeline's result.
await db.collection('revenue_snapshot').insertOne({ _id: 'stale', note: 'left over from yesterday' });
await orders.aggregate([...monthlyByCategory(new Date('2026-06-01'), new Date('2026-07-01')), { $out: 'revenue_snapshot' }]).toArray();
console.log('snapshot ids:', (await db.collection('revenue_snapshot').find().sort({ _id: 1 }).toArray())
  .map((d) => `${d._id.month}/${d._id.category}`));

// $merge "on" a field other than _id needs a unique index on that field.
try {
  await orders.aggregate([
    { $group: { _id: '$status', n: { $sum: 1 } } },
    { $project: { _id: 0, status: '$_id', n: 1 } },
    { $merge: { into: 'status_counts', on: 'status' } },
  ]).toArray();
} catch (err) {
  console.log('merge on status:', err.code, err.codeName, '-', err.message);
}
await db.collection('status_counts').createIndex({ status: 1 }, { unique: true });
await orders.aggregate([
  { $group: { _id: '$status', n: { $sum: 1 } } },
  { $project: { _id: 0, status: '$_id', n: 1 } },
  { $merge: { into: 'status_counts', on: 'status' } },
]).toArray();
console.log(await db.collection('status_counts').find({}, { projection: { _id: 0 } }).sort({ status: 1 }).toArray());
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   after Q1 run: 15
//   after Mar–Jun run: 30 (March was replaced, not duplicated)
//   snapshot ids: [
//     '2026-06/books',
//     '2026-06/games',
//     '2026-06/garden',
//     '2026-06/kitchen',
//     '2026-06/toys'
//   ]
//   merge on status: 51183 Location51183 - Cannot find index to verify that join fields will be unique
//   [
//     { status: 'cancelled', n: 268 },
//     { status: 'draft', n: 288 },
//     { status: 'paid', n: 858 },
//     { status: 'shipped', n: 586 }
//   ]
```

The second `$merge` run covered March again. March's five rows were replaced, not duplicated, because they matched on the same `_id`: 15 + 20 − 5 = 30. `$out` dropped the stale document: after an `$out`, the target holds only that run's result. The failed `$merge` shows a documented rule. Matching `on` a field other than `_id` needs a unique index on exactly those fields, and if the target does not exist yet, `on` must be `_id`. Error 51183 appears until you create the collection and the index.

**Example 7 — the 100 MB limit, `allowDiskUseByDefault` and a real spill.** The script reads the server parameters, generates 200,000 documents with an 800-byte payload, and runs a blocking `$sort` and a `$group` with 200,000 distinct keys, first with `allowDiskUse: false` and then with no option. The `bigEvents` collection is dropped at the end.

javascript

```
// ex7-disk.mjs — the 100 MB per-stage memory limit, allowDiskUse, and a real spill to disk
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const admin = client.db('admin');
const big = client.db('shop').collection('bigEvents');

// Collect every explain node that reports usedDisk (the blocking stages: sort, group, …).
const spillNodes = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  if ('usedDisk' in node) {
    const { stage, usedDisk, spills, spilledRecords, spilledBytes } = node;
    out.push({ stage, usedDisk, spills, spilledRecords, spilledBytes });
  }
  for (const v of Object.values(node)) spillNodes(v, out);
  return out;
};

// 1. What does this server allow by default?
console.log(await admin.command({
  getParameter: 1,
  allowDiskUseByDefault: 1,
  internalQueryMaxBlockingSortMemoryUsageBytes: 1,
  internalDocumentSourceGroupMaxMemoryBytes: 1,
}));

// 2. Generated data: 200,000 documents with an 800-byte payload each (~180 MB of BSON).
await big.drop().catch(() => {});
const payload = 'x'.repeat(800);
for (let b = 0; b < 20; b++) {
  await big.insertMany(Array.from({ length: 10_000 }, (_, i) => {
    const n = b * 10_000 + i;
    return { n, bucket: n % 150_000, payload };
  }));
}
console.log('bigEvents docs:', await big.countDocuments());

// A blocking sort on fields with no index, and a $group with 200,000 distinct keys.
const sortAll  = [{ $sort: { bucket: -1, n: 1 } }, { $skip: 199_999 }, { $project: { _id: 0, n: 1 } }];
const groupAll = [{ $group: { _id: '$n', p: { $first: '$payload' } } }, { $count: 'groups' }];

for (const [name, pipeline] of [['$sort', sortAll], ['$group', groupAll]]) {
  // 3. allowDiskUse: false -> the stage hits its 100 MB limit and the command fails.
  try {
    await big.aggregate(pipeline, { allowDiskUse: false }).toArray();
  } catch (err) {
    console.log(`${name} allowDiskUse:false ->`, err.code, err.codeName);
    console.log('   ', err.message.split(':: caused by :: ')[1]);
  }
  // 4. Same pipeline with no option: allowDiskUseByDefault is true, so it spills and succeeds.
  console.log(`${name} default ->`, await big.aggregate(pipeline).toArray());

  // 5. explain('executionStats') shows the spill on the blocking stage.
  const ex = await big.aggregate(pipeline).explain('executionStats');
  for (const n of spillNodes(ex)) console.log('   ', JSON.stringify(n));
}
await big.drop();
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6; the script took about 8 s):
//   {
//     allowDiskUseByDefault: true,
//     internalDocumentSourceGroupMaxMemoryBytes: 104857600,
//     internalQueryMaxBlockingSortMemoryUsageBytes: 104857600,
//     ok: 1
//   }
//   bigEvents docs: 200000
//   $sort allowDiskUse:false -> 292 QueryExceededMemoryLimitNoDiskUseAllowed
//       Sort exceeded memory limit of 104857600 bytes, but did not opt in to external sorting.
//   $sort default -> [ { n: 150000 } ]
//       {"stage":"SORT","usedDisk":true,"spills":2,"spilledRecords":200000,"spilledBytes":174000000}
//   $group allowDiskUse:false -> 292 QueryExceededMemoryLimitNoDiskUseAllowed
//       Exceeded memory limit for $group, but didn't allow external spilling; pass allowDiskUse:true to opt in
//   $group default -> [ { groups: 200000 } ]
//       {"stage":"group","usedDisk":false,"spills":0,"spilledRecords":0,"spilledBytes":0}
//       {"stage":"group","usedDisk":true,"spills":2,"spilledRecords":200000,"spilledBytes":162800000}
```

What it shows:

- `allowDiskUseByDefault` is `true` on 8.2.6, and both per-stage limits are 104,857,600 bytes (100 MiB).
- With `allowDiskUse: false`, both stages fail with code 292.
- With no option, they succeed, and `executionStats` shows `usedDisk: true` with 2 spills of all 200,000 records.
- The `$group` pipeline shows two `group` nodes. The first is the `$count` stage, which SBE also runs as a group; it holds one counter and did not spill.

Spilling is not free: the 174 MB that went to disk had to be written and read back. Treat a spill as a sign to add a `$match` earlier, project fewer fields before the blocking stage, or add an index the `$sort` can use.

**Example 8 — edge case: `$unwind` silently drops documents with an empty or missing array.** The 288 `draft` orders have `items: []`. After a plain `$unwind` they are gone, and a report built on it under-counts orders without any error. The same happens after a `$lookup` that finds nothing: the customer disappears.

javascript

```
// ex8-unwind-edge.mjs — edge case: $unwind silently drops documents whose array is empty
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL ?? 'mongodb://127.0.0.1:6201');
const orders = client.db('shop').collection('orders');

const countPerStatus = (unwind) => orders.aggregate([
  { $unwind: unwind },
  { $group: { _id: '$status', orders: { $addToSet: '$_id' } } },
  { $project: { orders: { $size: '$orders' } } },
  { $sort: { _id: 1 } },
]).toArray();

console.log('plain $unwind:   ', await countPerStatus('$items'));
console.log('preserve empties:', await countPerStatus({ path: '$items', preserveNullAndEmptyArrays: true }));

// The same trap with $lookup: a customer with no orders vanishes after { $unwind: '$orders' }.
await client.db('shop').collection('customers').insertOne({ _id: 999, name: 'No Orders Yet', email: 'new@example.com', country: 'US' });
const joined = (unwind) => client.db('shop').collection('customers').aggregate([
  { $match: { _id: { $in: [1, 999] } } },
  { $lookup: { from: 'orders', localField: '_id', foreignField: 'customerId', as: 'orders' } },
  { $unwind: unwind },
  { $group: { _id: '$name', rows: { $sum: 1 } } },
  { $sort: { _id: 1 } },
]).toArray();
console.log('lookup + $unwind:  ', await joined('$orders'));
console.log('lookup + preserve: ', await joined({ path: '$orders', preserveNullAndEmptyArrays: true }));
await client.db('shop').collection('customers').deleteOne({ _id: 999 });
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6):
//   plain $unwind:    [
//     { _id: 'cancelled', orders: 268 },
//     { _id: 'paid', orders: 858 },
//     { _id: 'shipped', orders: 586 }
//   ]
//   preserve empties: [
//     { _id: 'cancelled', orders: 268 },
//     { _id: 'draft', orders: 288 },
//     { _id: 'paid', orders: 858 },
//     { _id: 'shipped', orders: 586 }
//   ]
//   lookup + $unwind:   [ { _id: 'Ada 1', rows: 23 } ]
//   lookup + preserve:  [ { _id: 'Ada 1', rows: 23 }, { _id: 'No Orders Yet', rows: 1 } ]
```

`preserveNullAndEmptyArrays: true` keeps such documents, with the field missing (for an empty array) or `null`. Use it whenever "no items" or "no match" should still produce a row, for example "customers and their order count, including zero".

## Common mistakes & gotchas

- **Filtering after `$group` on an accumulator and expecting an index.** `{ $match: { n: { $gt: 25 } } }` after a group always reads the whole input (Example 5, case B). Put every filter on stored fields before the `$group`, and leave only filters on computed values after it.
- **Assuming `$unwind` keeps every parent.** Empty arrays, missing fields and `null` produce no output (Example 8). After a `$lookup` with no match, `$unwind` drops the parent too.
- **Joining before limiting.** A `$lookup` runs once per input document. Put `$sort` + `$limit` (or the `$match`) before the `$lookup` when the join is only needed for the final rows (Example 3).
- **A `$lookup` on an unindexed foreign field.** On 8.2.6 the equality form fell back to a `HashJoin` over the foreign collection, and the `let` form scanned the whole foreign collection once per input document (Example 5, case 4). Index the foreign field and confirm with `explain()`.
- **Grouping money stored as floating-point numbers.** Sums of doubles carry binary rounding error, which is why the reports use `$round` for display. For real money, store integer cents or `Decimal128`.
- **Turning off disk use and forgetting it.** `allowDiskUse: false` (or `allowDiskUseByDefault: false` on the server) turns a big `$group` or `$sort` into error 292 instead of a slower success.
- **Large `$facet` outputs.** `$facet` cannot spill. Each output is limited to 100 MB, and the whole result is one document limited to 16 MiB. Put `$limit` inside the result facet.
- **`$out` replaces the target.** Anything already in the target collection is gone after the run. Use `$merge` to upsert into a collection that other code also writes to.
- **Trusting stage order in the source code.** The optimizer reorders and merges stages. Read the order in `explain()`, not in your code.
- **Timezones.** Date operators (`$dateToString`, `$month`, `$dateTrunc`) default to UTC. Pass `timezone: 'Europe/Berlin'` (or similar) when "month" means the business's local month.

## Best practices

- **Start every pipeline with the most selective `$match`,** on indexed fields, then `$sort` on an index if you can, and only then `$unwind`, `$group` and `$lookup`.
- **Read `explain()` for every report query** before it ships. Look for IXSCAN vs COLLSCAN in the query-layer plan, `totalDocsExamined` vs `nReturned`, and `usedDisk` on blocking stages.
- **Limit before you join,** and use the `let` + `pipeline` form when you need only part of the foreign documents (`$sort` + `$limit: 1` for "latest").
- **Give `$sort` a unique tiebreaker** (`_id`) when the order is part of the output or of pagination. Equal sort keys come back in no guaranteed order.
- **Precompute heavy reports** with `$merge` into a report collection on a schedule, and serve reads from it.
- **Treat spills as a warning, not a fix.** If `usedDisk` is true, filter or project earlier, or add an index.
- **Keep pipelines as data.** A pipeline is a plain array, so build it from small functions (Example 6's `monthlyByCategory(from, to)`) and unit-test the arrays.

## ⭐ Interview lens

> **Q: “Why should `$match` come first in an aggregation pipeline?”**
> A: Only the part of the pipeline that the query layer runs can use an index, and that part starts at the first stage. A `$match` on stored fields at the start becomes an IXSCAN, so later stages see fewer documents. A `$match` on a value computed by `$group` can only run after the group, and the group has to read the whole collection. The optimizer moves some filters forward for you (past `$sort`, `$addFields`, `$project`), but not a filter on an accumulator. *Trap:* saying "the optimizer always fixes the order". Verify with `explain()`.

> **Q: “What happens when a `$group` needs more than 100 MB?”**
> A: Each blocking stage has a 100 MB memory budget. Since 6.0 the server parameter `allowDiskUseByDefault` (default `true`) lets the stage spill to temporary files, and `executionStats` shows `usedDisk: true` and the spill counts. With `allowDiskUse: false` the command fails with `QueryExceededMemoryLimitNoDiskUseAllowed` (292). `$facet` cannot spill. The 16 MiB document limit still applies to each output document.

> **Q: “When do you use `localField`/`foreignField` and when `let` + `pipeline` in `$lookup`?”**
> A: Use the equality form for a plain key join; it runs as an indexed or hash join. Use `let` + `pipeline` when the join needs extra conditions or reshaping: a non-equality condition, "only the latest one" (`$sort` + `$limit` inside), or projecting a few fields. Either way, index the foreign field and run the `$lookup` after you have reduced the input.

> **Q: “`$merge` or `$out`?”**
> A: `$out` builds a new collection and swaps it in place of the target, which suits a full snapshot. `$merge` upserts each result into an existing collection, matching on `_id` or on fields with a unique index, with configurable `whenMatched`/`whenNotMatched`. That suits incremental refreshes, such as recomputing only the last month.

## Cheat-card

- **Order:** `$match` (indexed) → `$sort` (indexed) → `$unwind` → `$group` → `$lookup` after `$limit` → `$project` last.
- **Index use:** only the leading part pushed to the query layer. Look for IXSCAN vs COLLSCAN in `queryPlanner` or `stages[0].$cursor.queryPlanner`.
- **Optimizer:** moves `$match` before `$sort`/`$addFields`/`$project` when it does not use computed fields; folds `$limit` into `$sort`. On 8.2.6 it also pushed a `$match` on the `$group` key before the group.
- **`$match` on an accumulator after `$group`:** COLLSCAN of the input (858 vs 2,000 docs examined here).
- **Explain:** `explain('executionStats')` → `totalKeysExamined`, `totalDocsExamined`, `nReturned`, `usedDisk`, `spills`.
- **Memory:** 100 MB per blocking stage; `allowDiskUseByDefault: true` on 8.2.6 (since 6.0); `allowDiskUse: false` → error 292.
- **`$lookup`:** `localField`/`foreignField` → `EQ_LOOKUP` (`IndexedLoopJoin` or `HashJoin`); `let` + `pipeline` + `$expr` for conditions and "latest one".
- **`$unwind`:** drops empty/missing arrays unless `preserveNullAndEmptyArrays: true`.
- **`$facet`:** one round trip, many sub-pipelines; no spilling; result ≤ 16 MiB.
- **`$bucket`:** `[lower, upper)` ranges, `_id` = lower bound, `default` for the rest.
- **`$merge`** upserts (unique index for `on`); **`$out`** replaces the whole collection.
- **Versions used:** Node v24.19.0, `mongodb` driver 7.7.0, MongoDB 8.2.6.

---

## Learn More

- [Aggregation Pipeline mongodb.com](https://www.mongodb.com/docs/manual/core/aggregation-pipeline/)
- [Aggregation Pipeline Optimization mongodb.com](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-optimization/)
- [Aggregation Pipeline Limits mongodb.com](https://www.mongodb.com/docs/manual/core/aggregation-pipeline-limits/)
- [Explain Results mongodb.com](https://www.mongodb.com/docs/manual/reference/explain-results/)
- [$lookup mongodb.com](https://www.mongodb.com/docs/manual/reference/operator/aggregation/lookup/)
- [$facet mongodb.com](https://www.mongodb.com/docs/manual/reference/operator/aggregation/facet/)
- [$merge mongodb.com](https://www.mongodb.com/docs/manual/reference/operator/aggregation/merge/)
- [Aggregation (Node.js driver) mongodb.com](https://www.mongodb.com/docs/drivers/node/current/aggregation/)
