---
title: "MongoDB Sharding"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# MongoDB Sharding

*24 min read · Updated 12 Oct 2026 · Topic 100 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and the `mongodb` Node driver 7.7.0 against a real local sharded cluster of MongoDB 8.2.6: `mongod` from mongodb-memory-server's downloaded binary and `mongos` from the official 8.2.6 Linux tarball (no Docker)

---

## Why it matters

A replica set copies the same data to every member. It protects you from losing a server, but every member still holds all the data and the primary takes every write. When the data no longer fits on one machine's disks or in its RAM, or one primary cannot keep up with the writes, a bigger machine is the only option left inside a replica set.

Sharding splits one collection across several replica sets, called **shards**, by a field you choose, the **shard key**. Each shard holds part of the data and takes the writes for its part. Your application still connects to one address, a **mongos** router, and sends normal queries.

Sharding only helps if the shard key spreads both the data and the traffic. A bad key gives you the cost of a cluster with the throughput of one server: every new document lands on the same shard (a **hot shard**), or every query has to ask every shard (**scatter-gather**). This lesson runs a real two-shard cluster on one machine and shows both failures, with the real `explain()` output and per-shard counters.

For the single-server basics see lessons [43](67-mongodb-amp-mongoose.md) and [44](68-schema-design-amp-data-modeling.md). Lesson [97](71-mongodb-aggregation-pipeline.md) covers the aggregation pipeline that mongos splits across shards in Example 5.

## The concept, simply

A sharded cluster has three kinds of processes:

- **Shards.** Each shard is a replica set that stores a subset of each sharded collection.
- **Config servers.** A replica set that stores the cluster metadata: which collections are sharded, on which key, and which shard owns which key range (`config.collections`, `config.chunks`).
- **mongos.** A stateless router. It caches the routing table from the config servers, sends each operation to the shards that can hold matching documents, and merges their replies.

The shard key's value space, from `MinKey` to `MaxKey`, is cut into contiguous ranges called **chunks**. Each chunk lives on exactly one shard. This is the topology built in Example 2, after Example 4 split the ranged collection at `customerId: 26`:

text

```
              Node app: new MongoClient('mongodb://127.0.0.1:6220')
                                 │
                                 ▼
                     ┌───────────────────────┐   routing table (cached)   ┌─────────────────────────┐
                     │ mongos           :6220│ ◄────────────────────────── │ config server RS "cfg"  │
                     └───────────────────────┘                             │ :6210                   │
          targeted               │      scatter-gather                     │ config.collections      │
  find({ customerId: 7 })        │      find({ status: "paid" })           │ config.chunks           │
           │                     │        │               │                └─────────────────────────┘
           ▼                     │        ▼               ▼
  ┌───────────────────────┐      │  ┌───────────────────────┐
  │ shard RS "shA"  :6211 │ ◄────┘  │ shard RS "shB"  :6212 │
  │ shop.orders           │         │ shop.orders           │
  │ chunk [MinKey, 26)    │         │ chunk [26, MaxKey)    │
  └───────────────────────┘         └───────────────────────┘
```

Two kinds of shard key:

- **Ranged.** Chunks are ranges of the key values themselves. Nearby values sit together, so a range query (`customerId` 1–9, "the last hour") can go to one shard. A key that only grows (a counter, a timestamp, an ObjectId) sends every new document to the chunk that ends at `MaxKey`, which is one shard.
- **Hashed.** MongoDB hashes the value and makes chunks of hash ranges. Consecutive values land on different shards, so inserts spread out, but a range of values is scattered over every chunk, so range queries go to every shard.

## How it works

What happens to a query sent through mongos:

1. The Node driver sends the operation to mongos, exactly as it would to a single server.
2. mongos looks at the filter. If the filter pins the shard key (an equality, or a range on a ranged key), mongos works out which chunks can hold matches and which shards own those chunks.
3. **Targeted**: if those chunks are all on one shard, the operation goes only to that shard. `explain()` reports `SINGLE_SHARD`.
4. **Scatter-gather (broadcast)**: if the filter does not contain the shard key, or the matching chunks are on several shards, mongos sends the operation to every relevant shard. `explain()` reports `SHARD_MERGE`, or `SHARD_MERGE_SORT` when mongos must merge sorted streams.
5. Each shard runs the operation on its own data, with its own indexes, and drops any **orphaned** documents (documents left over from a migration that this shard no longer owns) with a `SHARDING_FILTER` stage.
6. mongos merges the replies and returns one cursor. For an aggregation, it splits the pipeline: a `shardsPart` runs on every shard and a `mergerPart` combines the partial results (Example 5).

What happens on an insert: mongos reads the document's shard key, finds the chunk whose `[min, max)` range contains it, and sends the insert to the shard that owns that chunk. One insert always goes to one shard. So which shard takes the write load depends only on how the key values are distributed.

**Chunks and the balancer.** When you shard an empty collection on a ranged key, MongoDB creates one chunk `[MinKey, MaxKey)` on the database's primary shard (Example 3). A hashed key on an empty collection started with one chunk per shard on 8.2.6. The **balancer**, a background process on the config server primary, moves ranges between shards when a collection's data is uneven. The documented threshold is a data-size difference between shards of at least three times the range size (chunk size). The default range size is 128 MB, so two shards must differ by 384 MB before a migration happens. A test collection of a few thousand documents is never balanced on its own. Examples 4 and 6 therefore move a range by hand (`split` + `moveRange`), and Example 7 lowers the range size to 1 MB, which is only for a lab.

**A migration in steps.** The donor shard copies the documents of a range to the recipient. The recipient commits ownership in the config servers. Only later does the donor delete its copies. Until then, the donor still holds the documents as **orphans**. On 8.2.6 `orphanCleanupDelaySecs` is 3600 (one hour) by default (changed in v8.2). Queries through mongos filter orphans out, but a query sent directly to a shard's mongod does not (Example 7).

**Choosing a shard key** comes down to four questions, in this order:

- **Cardinality.** How many distinct values are there? A key with 50 values can never be split into more than 50 chunks.
- **Frequency.** Is any single value very common? All documents with the same key value stay in one chunk.
- **Monotonicity.** Do new values always grow? Then a ranged key sends all new writes to one shard.
- **Query pattern.** Do the hot queries filter on the key? If not, they are all scatter-gather.

A compound key such as `{ customerId: 1, createdAt: 1 }` answers several of these at once. MongoDB can also refine a key by adding suffix fields (`refineCollectionShardKey`) or reshard a collection onto a new key (`reshardCollection`), but resharding clones the whole collection onto the recipient shards, so choose carefully up front.

## Code examples

The Node scripts are ES modules (`.mjs`) run with `node <file>` in a folder where `npm install mongodb@7.7.0` was run. `mongosh` is not part of the server tarball and was not installed, so the examples call the database commands that the `sh.*` helpers wrap (`addShard`, `shardCollection`, `split`, `moveRange`). Example 4 uses `$shardedDataDistribution` and `config.chunks` instead of the `mongosh`-only helper `db.collection.getShardDistribution()`. Ports 6210–6220 are used; any free ports work. Run the examples in order on one cluster.

**Example 1 — download `mongos` and verify the checksum.** mongodb-memory-server downloads only `mongod`, so `mongos` came from the official 8.2.6 tarball. This machine runs Ubuntu 26.04 LTS, and the cached `mongod` is the `ubuntu2404` x86_64 build (its `--version` reports `"distmod": "ubuntu2404"`), so the matching `ubuntu2404` tarball was used. MongoDB publishes a `.sha256` file next to each tarball. The last line compares the SHA-256 of the tarball's `mongod` with the cached one (`cut` shortens the hashes; the full hashes matched too): they are the same binary.

bash

```
set -e
V=8.2.6; F=mongodb-linux-x86_64-ubuntu2404-$V.tgz
curl -sSfLO "https://fastdl.mongodb.org/linux/$F"
curl -sSfLO "https://fastdl.mongodb.org/linux/$F.sha256"
sha256sum -c "$F.sha256"
tar xzf "$F"
ls "mongodb-linux-x86_64-ubuntu2404-$V/bin"
"mongodb-linux-x86_64-ubuntu2404-$V/bin/mongos" --version | head -2
sha256sum "mongodb-linux-x86_64-ubuntu2404-$V/bin/mongod" "$MONGOD" | cut -c1-16
```

bash

```
$ MONGOD=…/mongod-x64-ubuntu-8.2.6 bash dl.sh
mongodb-linux-x86_64-ubuntu2404-8.2.6.tgz: OK
install_compass
mongod
mongos
mongos version v8.2.6
Build Info: {
08b192e3fcfe01ef
08b192e3fcfe01ef
```

**Example 2 — start one config-server replica set, two shard replica sets and a mongos.** Each replica set has a single member, which is enough to run the protocol on one machine but gives no redundancy. Production uses three members each. The `--configsvr` and `--shardsvr` flags give each `mongod` its role. A replica set has to be initiated, and must elect a primary, before mongos can use it.

bash

```
#!/usr/bin/env bash
# start-cluster.sh — 1 config-server replica set + 2 single-node shard replica sets + 1 mongos
set -euo pipefail
MONGOD=${MONGOD:?set MONGOD to the path of the mongod 8.2.6 binary}
MONGOS=${MONGOS:?set MONGOS to the path of the mongos 8.2.6 binary}
D=$(realpath -m "${D:-./cluster-data}")   # absolute: mongod --fork changes directory
rm -rf "$D" && mkdir -p "$D"/{cfg,shA,shB}

"$MONGOD" --configsvr --replSet cfg --port 6210 --bind_ip 127.0.0.1 --dbpath "$D/cfg" --fork --logpath "$D/cfg.log" --pidfilepath "$D/cfg.pid" >/dev/null && echo "cfg mongod started"
"$MONGOD" --shardsvr  --replSet shA --port 6211 --bind_ip 127.0.0.1 --dbpath "$D/shA" --fork --logpath "$D/shA.log" --pidfilepath "$D/shA.pid" >/dev/null && echo "shA mongod started"
"$MONGOD" --shardsvr  --replSet shB --port 6212 --bind_ip 127.0.0.1 --dbpath "$D/shB" --fork --logpath "$D/shB.log" --pidfilepath "$D/shB.pid" >/dev/null && echo "shB mongod started"

# Each replica set must be initiated before mongos can use it (done with the Node driver).
node "$(dirname "$0")/init-replsets.mjs"

"$MONGOS" --configdb cfg/127.0.0.1:6210 --port 6220 --bind_ip 127.0.0.1 --fork --logpath "$D/mongos.log" --pidfilepath "$D/mongos.pid" >/dev/null && echo "mongos started on 6220"
```

javascript

```
// init-replsets.mjs — initiate the three one-member replica sets, then wait for a primary
import { MongoClient } from 'mongodb';

const sets = [
  { _id: 'cfg', port: 6210, configsvr: true },
  { _id: 'shA', port: 6211 },
  { _id: 'shB', port: 6212 },
];
for (const { _id, port, configsvr } of sets) {
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`);
  await client.db('admin').command({
    replSetInitiate: { _id, ...(configsvr && { configsvr }), members: [{ _id: 0, host: `127.0.0.1:${port}` }] },
  });
  while (!(await client.db('admin').command({ hello: 1 })).isWritablePrimary) {
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`${_id} primary on ${port}`);
  await client.close();
}
```

bash

```
$ MONGOD=…/mongod-x64-ubuntu-8.2.6 MONGOS=…/mongodb-linux-x86_64-ubuntu2404-8.2.6/bin/mongos bash start-cluster.sh
cfg mongod started
shA mongod started
shB mongod started
cfg primary on 6210
shA primary on 6211
shB primary on 6212
mongos started on 6220
```

**Example 3 — add the shards, then shard by range and by hash (`sh.addShard`, `sh.shardCollection`).** `shardCollection` creates the supporting index on the shard key if the collection is empty. The ranged collection starts as one chunk on the primary shard. The hashed one starts with two chunks, split at hash value `0` (a 64-bit hash, not a `customerId`), one per shard. The last part shows a rule that follows from the design: a unique index has to start with the shard key, because no shard can check values held by another shard.

javascript

```
// ex2-setup.mjs — register both shards, then shard one collection by range and one by hash
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGOS_URL ?? 'mongodb://127.0.0.1:6220');
const admin = client.db('admin');

// sh.addShard() in mongosh wraps this command.
for (const name of ['shA', 'shB']) {
  const port = name === 'shA' ? 6211 : 6212;
  const r = await admin.command({ addShard: `${name}/127.0.0.1:${port}`, name });
  console.log('addShard', r.shardAdded);
}
console.log((await admin.command({ listShards: 1 })).shards.map(({ _id, host, state }) => ({ _id, host, state })));

// sh.shardCollection() wraps the shardCollection command. MongoDB creates the shard key index.
await admin.command({ shardCollection: 'shop.orders', key: { customerId: 1 } });          // ranged
await admin.command({ shardCollection: 'shop.orders_h', key: { customerId: 'hashed' } }); // hashed

// Where are the chunks? config.chunks references collections by uuid.
const chunks = await client.db('config').collection('chunks').aggregate([
  { $lookup: { from: 'collections', localField: 'uuid', foreignField: 'uuid', as: 'coll' } },
  { $match: { 'coll._id': { $in: ['shop.orders', 'shop.orders_h'] } } },
  { $project: { _id: 0, ns: { $first: '$coll._id' }, min: 1, max: 1, shard: 1 } },
  { $sort: { ns: 1, shard: 1 } },
]).toArray();
console.log(chunks);
// A unique index must start with the shard key: one shard cannot check uniqueness on the others.
try {
  await client.db('shop').collection('orders').createIndex({ email: 1 }, { unique: true });
} catch (err) {
  console.log('unique { email: 1 }:', err.code, err.codeName);
  console.log('   ', err.message.split(':: caused by :: ')[1]);
}
console.log('primary shard of db shop:', (await client.db('config').collection('databases').findOne({ _id: 'shop' })).primary);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6 sharded cluster):
//   addShard shA
//   addShard shB
//   [
//     { _id: 'shA', host: 'shA/127.0.0.1:6211', state: 1 },
//     { _id: 'shB', host: 'shB/127.0.0.1:6212', state: 1 }
//   ]
//   [
//     {
//       min: { customerId: new MinKey() },
//       max: { customerId: new MaxKey() },
//       shard: 'shA',
//       ns: 'shop.orders'
//     },
//     {
//       min: { customerId: 0 },
//       max: { customerId: new MaxKey() },
//       shard: 'shA',
//       ns: 'shop.orders_h'
//     },
//     {
//       min: { customerId: new MinKey() },
//       max: { customerId: 0 },
//       shard: 'shB',
//       ns: 'shop.orders_h'
//     }
//   ]
//   unique { email: 1 }: 67 CannotCreateIndex
//       cannot create index with 'unique' or 'prepareUnique' option over { email: 1 } with shard key pattern { customerId: 1 }
//   primary shard of db shop: shA
```

**Example 4 — split a chunk, move a range, insert data and read the distribution.** `split` cuts the ranged collection's only chunk at `customerId: 26`, and `moveRange` (added in v6.0) moves `[26, MaxKey)` to `shB`. Then 2,000 orders for customers 1–50 (40 orders each) go into both collections. `$shardedDataDistribution` (added in v6.0.3) runs on mongos against the `admin` database and reports owned and orphaned documents per shard.

javascript

```
// ex3-distribution.mjs — split a ranged chunk, move half to shB, insert data, see where it lands
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGOS_URL ?? 'mongodb://127.0.0.1:6220');
const admin = client.db('admin');
const db = client.db('shop');

// Ranged: split [MinKey, MaxKey) at customerId 26, then move [26, MaxKey) to shB.
// (sh.splitAt() and sh.moveRange() in mongosh wrap these two commands.)
await admin.command({ split: 'shop.orders', middle: { customerId: 26 } });
await admin.command({ moveRange: 'shop.orders', min: { customerId: 26 }, toShard: 'shB' });

// 2,000 orders for customers 1–50, written to both collections.
const docs = Array.from({ length: 2000 }, (_, i) => ({
  _id: i + 1, customerId: (i % 50) + 1, status: ['paid', 'shipped', 'cancelled'][i % 3], total: (i % 97) + 0.99,
}));
await db.collection('orders').insertMany(docs);
await db.collection('orders_h').insertMany(docs);

// $shardedDataDistribution (admin db, through mongos) reports owned and orphaned documents per shard.
const dist = await client.db('admin').aggregate([
  { $shardedDataDistribution: {} },
  { $match: { ns: { $in: ['shop.orders', 'shop.orders_h'] } } },
  { $unwind: '$shards' },
  { $project: { _id: 0, ns: 1, shard: '$shards.shardName', owned: '$shards.numOwnedDocuments',
      orphaned: '$shards.numOrphanedDocs' } },
  { $sort: { ns: 1, shard: 1 } },
]).toArray();
console.table(dist);

// The chunk ranges of shop.orders after the split and the move.
const chunks = await client.db('config').collection('chunks')
  .find({ uuid: (await client.db('config').collection('collections').findOne({ _id: 'shop.orders' })).uuid })
  .project({ _id: 0, min: 1, max: 1, shard: 1 }).sort({ min: 1 }).toArray();
console.log(chunks);
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6 sharded cluster):
//   ┌─────────┬─────────────────┬───────┬───────┬──────────┐
//   │ (index) │ ns              │ shard │ owned │ orphaned │
//   ├─────────┼─────────────────┼───────┼───────┼──────────┤
//   │ 0       │ 'shop.orders'   │ 'shA' │ 1000  │ 0        │
//   │ 1       │ 'shop.orders'   │ 'shB' │ 1000  │ 0        │
//   │ 2       │ 'shop.orders_h' │ 'shA' │ 1240  │ 0        │
//   │ 3       │ 'shop.orders_h' │ 'shB' │ 760   │ 0        │
//   └─────────┴─────────────────┴───────┴───────┴──────────┘
//   [
//     {
//       min: { customerId: new MinKey() },
//       max: { customerId: 26 },
//       shard: 'shA'
//     },
//     {
//       min: { customerId: 26 },
//       max: { customerId: new MaxKey() },
//       shard: 'shB'
//     }
//   ]
```

The ranged split is exactly half and half: customers 1–25 on `shA` and 26–50 on `shB`, 1,000 orders each. The hashed collection is not even: 1,240 vs 760, which is 31 customers vs 19. With only 50 distinct key values, each customer's 40 orders travel together, and 50 hash values do not fall evenly into two hash ranges. Hashing spreads *distinct values*. It cannot spread documents that share one value, so cardinality matters as much as the choice of hashed or ranged.

**Example 5 — targeted vs scatter-gather queries, read from `explain()`.** Each line is a real `find().explain('executionStats')` through mongos: the top-level `winningPlan.stage`, then what each shard examined and returned.

javascript

```
// ex4-targeting.mjs — explain() through mongos: targeted (SINGLE_SHARD) vs scatter-gather (SHARD_MERGE)
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGOS_URL ?? 'mongodb://127.0.0.1:6220');
const db = client.db('shop');

const show = async (label, coll, filter, sort) => {
  let cursor = db.collection(coll).find(filter);
  if (sort) cursor = cursor.sort(sort);
  const ex = await cursor.explain('executionStats');
  const perShard = ex.executionStats.executionStages.shards
    .toSorted((a, b) => a.shardName.localeCompare(b.shardName))
    .map((s) => `${s.shardName}: docsExamined=${s.totalDocsExamined} nReturned=${s.nReturned}`);
  console.log(label.padEnd(46), ex.queryPlanner.winningPlan.stage.padEnd(16), perShard.join(' | '));
};

await show('ranged  { customerId: 7 }', 'orders', { customerId: 7 });
await show('ranged  { customerId: { $gte: 1, $lt: 10 } }', 'orders', { customerId: { $gte: 1, $lt: 10 } });
await show('ranged  { customerId: { $gte: 20, $lt: 30 } }', 'orders', { customerId: { $gte: 20, $lt: 30 } });
await show('ranged  { status: "paid" }', 'orders', { status: 'paid' });
await show('ranged  { status: "paid" } sort total', 'orders', { status: 'paid' }, { total: -1 });
await show('hashed  { customerId: 7 }', 'orders_h', { customerId: 7 });
await show('hashed  { customerId: { $gte: 1, $lt: 10 } }', 'orders_h', { customerId: { $gte: 1, $lt: 10 } });

// An aggregation: explain shows which part runs on the shards and which part merges.
const agg = await db.collection('orders').aggregate([
  { $match: { status: 'paid' } },
  { $group: { _id: '$status', revenue: { $sum: '$total' } } },
]).explain('queryPlanner');
console.log('mergeType:', agg.mergeType);
console.log('shardsPart:', JSON.stringify(agg.splitPipeline.shardsPart));
console.log('mergerPart:', JSON.stringify(agg.splitPipeline.mergerPart.map((s) => Object.keys(s)[0] === '$mergeCursors' ? { $mergeCursors: '…' } : s)));
await client.close();

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6 sharded cluster):
//   ranged  { customerId: 7 }                      SINGLE_SHARD     shA: docsExamined=40 nReturned=40
//   ranged  { customerId: { $gte: 1, $lt: 10 } }   SINGLE_SHARD     shA: docsExamined=360 nReturned=360
//   ranged  { customerId: { $gte: 20, $lt: 30 } }  SHARD_MERGE      shA: docsExamined=240 nReturned=240 | shB: docsExamined=160 nReturned=160
//   ranged  { status: "paid" }                     SHARD_MERGE      shA: docsExamined=1000 nReturned=334 | shB: docsExamined=1000 nReturned=333
//   ranged  { status: "paid" } sort total          SHARD_MERGE_SORT shA: docsExamined=1000 nReturned=334 | shB: docsExamined=1000 nReturned=333
//   hashed  { customerId: 7 }                      SINGLE_SHARD     shA: docsExamined=40 nReturned=40
//   hashed  { customerId: { $gte: 1, $lt: 10 } }   SHARD_MERGE      shA: docsExamined=1240 nReturned=240 | shB: docsExamined=760 nReturned=120
//   mergeType: router
//   shardsPart: [{"$match":{"status":{"$eq":"paid"}}},{"$group":{"_id":"$status","revenue":{"$sum":"$total"}}}]
//   mergerPart: [{"$mergeCursors":"…"},{"$group":{"_id":"$$ROOT._id","revenue":{"$sum":"$$ROOT.revenue"},"$doingMerge":true}}]
```

Line by line:

- **Equality on the shard key** goes to one shard, whether the key is ranged or hashed.
- **A range on a ranged key** goes to one shard if it falls inside one chunk (1–9), and to both if it crosses the split at 26 (20–29: 240 + 160 documents).
- **A filter without the shard key** (`status`) goes to every shard. Each shard reads all 1,000 of its documents, because `status` has no index.
- **A sort without the shard key** turns the merge into `SHARD_MERGE_SORT`: each shard sorts its part, and mongos merges the sorted streams.
- **A range on a hashed key** goes to every shard. Each shard also read every document it holds (1,240 and 760), because a hashed index cannot answer a range: consecutive values have unrelated hashes.

The aggregation explain shows the split: the `$match` and a partial `$group` ran on each shard, and mongos (`mergeType: router`) merged the partial sums with a second `$group`.

**Example 6 — the hot shard: a monotonically increasing ranged key.** Two collections receive the same 4,000 new events with `seq` 1001–5000. One is sharded on `{ seq: 1 }` (ranged), the other on `{ seq: 'hashed' }`. The ranged one is set up the way a balanced cluster ends up: the old values (`seq` 1–1000) are on `shA`, and the open-ended top chunk `[1001, MaxKey)` is on `shB`. Each shard's own `serverStatus().opcounters.insert` counts the inserts it actually received.

javascript

```
// ex5-hot-shard.mjs — a monotonically increasing ranged key sends every new insert to one shard
import { MongoClient } from 'mongodb';

const mongos = new MongoClient(process.env.MONGOS_URL ?? 'mongodb://127.0.0.1:6220');
const shards = { shA: 6211, shB: 6212 };
const direct = Object.fromEntries(Object.entries(shards).map(([name, port]) =>
  [name, new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`)]));
const admin = mongos.db('admin');
const db = mongos.db('shop');

// Inserts counted by each shard's own serverStatus counter.
const inserts = async () => Object.fromEntries(await Promise.all(Object.entries(direct).map(
  async ([name, c]) => [name, (await c.db('admin').command({ serverStatus: 1 })).opcounters.insert])));

// Ranged on a counter, and hashed on the same counter.
await admin.command({ shardCollection: 'shop.events_r', key: { seq: 1 } });
await admin.command({ shardCollection: 'shop.events_h', key: { seq: 'hashed' } });

// History: seq 1–1000 already exists. Split the ranged collection at 1001 and give the upper
// range [1001, MaxKey) to shB, as a balancer would after the collection had grown.
const history = Array.from({ length: 1000 }, (_, i) => ({ seq: i + 1, at: new Date(Date.UTC(2026, 9, 1) + i * 60_000) }));
await db.collection('events_r').insertMany(history);
await db.collection('events_h').insertMany(history);
await admin.command({ split: 'shop.events_r', middle: { seq: 1001 } });
await admin.command({ moveRange: 'shop.events_r', min: { seq: 1001 }, toShard: 'shB' });

// New traffic: seq 1001–5000, in 40 batches of 100, the way an app would write them.
for (const coll of ['events_r', 'events_h']) {
  const before = await inserts();
  for (let b = 0; b < 40; b++) {
    await db.collection(coll).insertMany(Array.from({ length: 100 }, (_, i) => {
      const seq = 1001 + b * 100 + i;
      return { seq, at: new Date(Date.UTC(2026, 9, 1) + seq * 60_000) };
    }));
  }
  const after = await inserts();
  console.log(coll, 'new inserts per shard:',
    Object.fromEntries(Object.keys(shards).map((s) => [s, after[s] - before[s]])));
}

const dist = await admin.aggregate([
  { $shardedDataDistribution: {} },
  { $match: { ns: { $in: ['shop.events_r', 'shop.events_h'] } } },
  { $unwind: '$shards' },
  { $project: { _id: 0, ns: 1, shard: '$shards.shardName', owned: '$shards.numOwnedDocuments' } },
  { $sort: { ns: 1, shard: 1 } },
]).toArray();
console.table(dist);
await Promise.all([mongos, ...Object.values(direct)].map((c) => c.close()));

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6 sharded cluster):
//   events_r new inserts per shard: { shA: 0, shB: 4000 }
//   events_h new inserts per shard: { shA: 2005, shB: 1995 }
//   ┌─────────┬─────────────────┬───────┬───────┐
//   │ (index) │ ns              │ shard │ owned │
//   ├─────────┼─────────────────┼───────┼───────┤
//   │ 0       │ 'shop.events_h' │ 'shA' │ 2525  │
//   │ 1       │ 'shop.events_h' │ 'shB' │ 2475  │
//   │ 2       │ 'shop.events_r' │ 'shA' │ 1000  │
//   │ 3       │ 'shop.events_r' │ 'shB' │ 4000  │
//   └─────────┴─────────────────┴───────┴───────┘
```

With the ranged key, `shA` received **0** of the 4,000 new inserts and `shB` received all of them. Every new `seq` is larger than every existing one, so it always falls into the chunk that ends at `MaxKey`. Adding shards would not change this. If the top range were moved to another shard, that shard would become the hot one. The hashed key split the same inserts 2,005 / 1,995. The trade-off is that "events from the last hour" is now a scatter-gather query (Example 5, hashed range line). A common middle ground is a compound key whose first field has many values that arrive in no particular order, such as `{ deviceId: 1, seq: 1 }`. Once the key space is split into chunks, different devices' writes go to different chunks, and one device's events still sit together in `seq` order.

text

```
ranged { seq: 1 }                         hashed { seq: 'hashed' }
shA  [MinKey, 1001)   ← old data only     one shard    [MinKey, 0) of hash(seq)  ← ~half the new seqs
shB  [1001, MaxKey)   ← every new seq     other shard  [0, MaxKey) of hash(seq)  ← ~half the new seqs
```

**Example 7 — edge case: the balancer migrates ranges, and the donor keeps orphans that a direct count includes.** This example lowers the cluster-wide range size to 1 MB (lab only; the default is 128 MB), inserts about 12 MB into a collection whose single chunk sits on `shA`, and polls `$shardedDataDistribution` until the numbers stop changing.

javascript

```
// ex6-balancer-orphans.mjs — the balancer moves ranges; the donor shard keeps orphans for a while
import { MongoClient } from 'mongodb';

const mongos = new MongoClient(process.env.MONGOS_URL ?? 'mongodb://127.0.0.1:6220');
const shA = new MongoClient('mongodb://127.0.0.1:6211/?directConnection=true');
const admin = mongos.db('admin');
const logs = mongos.db('shop').collection('logs');

// Lab-only setting: a 1 MB range size (default 128 MB), so ~12 MB of data is enough to rebalance.
await mongos.db('config').collection('settings')
  .updateOne({ _id: 'chunksize' }, { $set: { value: 1 } }, { upsert: true });
await admin.command({ shardCollection: 'shop.logs', key: { seq: 1 } });

const pad = 'x'.repeat(1000);
for (let b = 0; b < 12; b++) {
  await logs.insertMany(Array.from({ length: 1000 }, (_, i) => ({ seq: b * 1000 + i, pad })));
}

const distribution = async () => {
  const [d] = await admin.aggregate([{ $shardedDataDistribution: {} }, { $match: { ns: 'shop.logs' } }]).toArray();
  return Object.fromEntries(d.shards.toSorted((a, b) => a.shardName.localeCompare(b.shardName))
    .map((s) => [s.shardName, { owned: s.numOwnedDocuments, orphaned: s.numOrphanedDocs }]));
};

// Poll until shB owns documents and the numbers stop changing for 15 s (or give up after 120 s).
const t0 = Date.now();
let last = '', stableSince = Date.now();
while (Date.now() - t0 < 120_000) {
  const now = JSON.stringify(await distribution());
  if (now !== last) { last = now; stableSince = Date.now(); console.log(`t+${Math.round((Date.now() - t0) / 1000)}s`, now); }
  if (now.includes('"shB"') && Date.now() - stableSince > 15_000) break;
  await new Promise((r) => setTimeout(r, 1000));
}

// Counting through mongos filters orphans; counting on the shard's own mongod does not.
console.log('count via mongos      :', await logs.countDocuments());
console.log('count directly on shA :', await shA.db('shop').collection('logs').countDocuments());
console.log('orphanCleanupDelaySecs:', (await shA.db('admin').command({ getParameter: 1, orphanCleanupDelaySecs: 1 })).orphanCleanupDelaySecs);
await Promise.all([mongos.close(), shA.close()]);

// Real output (Node v24.19.0, mongodb 7.7.0, MongoDB 8.2.6 cluster; timings and in-flight lines vary per run, the final state did not):
//   t+0s {"shA":{"owned":12000,"orphaned":0}}
//   t+3s {"shA":{"owned":10994,"orphaned":1006},"shB":{"owned":1006,"orphaned":0}}
//   t+4s {"shA":{"owned":9988,"orphaned":2012},"shB":{"owned":2012,"orphaned":0}}
//   t+5s {"shA":{"owned":8982,"orphaned":3018},"shB":{"owned":3018,"orphaned":0}}
//   t+6s {"shA":{"owned":8982,"orphaned":3018},"shB":{"owned":3018,"orphaned":1006}}
//   t+7s {"shA":{"owned":7976,"orphaned":4024},"shB":{"owned":4024,"orphaned":0}}
//   t+8s {"shA":{"owned":6970,"orphaned":5030},"shB":{"owned":5030,"orphaned":0}}
//   count via mongos      : 12000
//   count directly on shA : 12000
//   orphanCleanupDelaySecs: 3600
```

What happened:

- The balancer moved five ranges of about 1,006 documents each, one at a time, and then stopped. `shA` now owns 6,970 documents (about 7.3 MB) and `shB` owns 5,030 (about 5.2 MB). The difference is under 3 × 1 MB, which is the documented threshold.
- During one migration, `shB` briefly reported 1,006 *orphaned* documents. Those are documents being received for a range whose ownership had not been committed yet.
- After the moves, `shA` still physically holds all 12,000 documents: 6,970 owned and 5,030 orphaned. The orphans stay until the range deleter runs after `orphanCleanupDelaySecs` (3,600 s).
- A count through mongos returns the true 12,000. A count sent straight to `shA`'s mongod also returns 12,000, although `shA` owns only 6,970, so adding up direct per-shard counts would give 17,030.

Always read and count through mongos. For per-shard numbers, use `$shardedDataDistribution`, which separates owned from orphaned documents. Do not use a shard's own `count` or `$collStats` storage numbers.

**Example 8 — stop the cluster.** The script sends SIGTERM to each process from its pid file, mongos first, and waits for each to exit. mongos spent about 15 s in quiesce mode before exiting (`"quiesceModeMillis":15023` in its log), which is the documented default of `mongosShutdownTimeoutMillisForSignaledShutdown` (15,000 ms). It gives in-flight operations time to finish.

bash

```
#!/usr/bin/env bash
# stop-cluster.sh — SIGTERM each process from its pid file (mongos first), wait until they exit
D=$(realpath -m "${D:-./cluster-data}")   # absolute: mongod --fork changes directory
for n in mongos shB shA cfg; do
  pid=$(cat "$D/$n.pid") && kill "$pid" && while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
  echo "$n stopped"
done
```

bash

```
$ time bash stop-cluster.sh
mongos stopped
shB stopped
shA stopped
cfg stopped

real	0m15.654s
user	0m0.053s
sys	0m0.200s
```

## Common mistakes & gotchas

- **A monotonically increasing ranged key** (timestamp, counter, ObjectId `_id`) sends every insert to the shard that owns `[x, MaxKey)` (Example 6: 0 vs 4,000). Hash it, or lead with a field that has many values arriving in no order.
- **A low-cardinality key.** Hashing 50 customer ids gave a 1,240 / 760 split (Example 4). All documents with the same key value stay in one chunk forever, and that chunk cannot be split.
- **Range queries on a hashed key.** They go to every shard, and the hashed index cannot serve them, so each shard scans everything unless another index matches (Example 5).
- **Queries that do not include the shard key.** Every such query asks every shard. That is acceptable for rare reports, but a hot request path should filter on the key.
- **Counting on a shard directly.** A direct count includes orphans: 12,000 on a shard that owns 6,970 (Example 7). Count through mongos, and use `$shardedDataDistribution` for per-shard numbers.
- **Unique indexes on other fields.** `createIndex({ email: 1 }, { unique: true })` fails with `CannotCreateIndex` (67) when the shard key is `{ customerId: 1 }` (Example 3). A unique index must start with the shard key.
- **Expecting the balancer to act on small data.** With the default 128 MB range size, nothing moves until shards differ by 384 MB. Do not "test" balancing with a few MB unless you lower `chunksize`, and do not leave a 1 MB `chunksize` in production: it means many more migrations.
- **Looking for `sh.*` in the driver.** `sh.shardCollection`, `sh.splitAt`, `sh.moveRange` and `db.collection.getShardDistribution()` are `mongosh` helpers. From Node, call the commands (`shardCollection`, `split`, `moveRange`) with `db.admin().command(...)`, and use the `$shardedDataDistribution` stage.
- **Slow shutdown surprises.** A SIGTERM to mongos waits about 15 s by default (Example 8). Allow for that in deploy scripts.

## Best practices

- **Shard only when you must.** First use indexes, schema changes and a bigger replica set. Sharding adds a router, config servers and a shard key that is expensive to change.
- **Choose the key from the workload.** List the top queries and the write pattern, then pick a key with high cardinality, low frequency, no single growing direction, and that the hot queries filter on.
- **Prefer compound keys** like `{ tenantId: 1, createdAt: 1 }` or `{ customerId: 1, _id: 1 }`. The first field targets queries; the second keeps chunks splittable.
- **Check targeting with `explain()`** for each hot query: you want `SINGLE_SHARD`, or `SHARD_MERGE` over only the shards you expect.
- **Watch distribution with `$shardedDataDistribution`,** and check `numOrphanedDocs` after migrations.
- **Always connect applications to mongos** (several mongos for availability), never to individual shards.
- **Run three-member replica sets** for every shard and for the config servers in production. The one-member sets here exist only to make the protocol runnable on a laptop.

## ⭐ Interview lens

> **Q: “How do you choose a shard key?”**
> A: Start from the workload. Pick a key with high cardinality and low frequency, so data can be split into many chunks. Avoid a key that only grows, so writes do not all go to one chunk. And use the field that the hot queries filter on, so those queries are targeted to one shard. A compound key often satisfies all three, for example a tenant or customer id first, then a time or id field. Then verify targeting with `explain()` (`SINGLE_SHARD`). *Trap:* answering "use `_id`". A default ObjectId `_id` grows over time, so a ranged `_id` key creates a hot shard.

> **Q: “Hashed or ranged sharding?”**
> A: Ranged keeps nearby values together, which makes range queries targeted but gives a hot shard for monotonic keys. Hashed spreads consecutive values, which balances inserts (2,005 / 1,995 in Example 6) but turns every range query into scatter-gather, and the hashed index cannot serve the range. Hashing does not fix low cardinality: 50 values still gave a 1,240 / 760 split.

> **Q: “What is a scatter-gather query and why does it matter?”**
> A: A query mongos cannot route to one shard, because it lacks the shard key or spans chunks on several shards. mongos sends it to every relevant shard and merges the results (`SHARD_MERGE`, or `SHARD_MERGE_SORT` when sorted). Every shard does work for it, so its cost grows with the number of shards, and its latency is set by the slowest shard.

> **Q: “What are orphaned documents?”**
> A: Copies of documents a shard no longer owns, left behind after a range migration until the range deleter removes them, by default after `orphanCleanupDelaySecs` (3,600 s on 8.2). Queries through mongos filter them out with a `SHARDING_FILTER` stage. Queries sent directly to a shard's mongod include them, which is why you never count on a shard directly.

## Cheat-card

- **Topology:** shards (replica sets) + config server replica set (metadata, `config.chunks`) + mongos (router). Apps connect only to mongos.
- **Chunk:** a contiguous `[min, max)` range of shard-key values on one shard. Default range size 128 MB; balancing starts at a 3× range-size difference.
- **Ranged key:** range queries targeted; monotonic key → hot shard (0 vs 4,000 inserts here).
- **Hashed key:** inserts spread (2,005 / 1,995 here); range queries scatter and cannot use the hashed index.
- **Cardinality:** all documents with one key value share a chunk; 50 values hashed → 1,240 / 760.
- **Targeted:** equality or in-chunk range on the shard key → `SINGLE_SHARD`.
- **Scatter-gather:** no shard key or a range spanning shards → `SHARD_MERGE` / `SHARD_MERGE_SORT`.
- **Aggregation on mongos:** `splitPipeline.shardsPart` on shards, `mergerPart` on mongos (`mergeType: router`).
- **Commands from Node:** `addShard`, `shardCollection`, `split`, `moveRange` (v6.0+); distribution with `$shardedDataDistribution` (v6.0.3+, `admin` db).
- **Orphans:** kept for `orphanCleanupDelaySecs` (3,600 s on 8.2); count via mongos, never directly on a shard.
- **Unique index:** must be prefixed by the shard key (error 67 otherwise).
- **Versions used:** Node v24.19.0, `mongodb` driver 7.7.0, MongoDB 8.2.6 (`mongod` + `mongos`, ubuntu2404 x86_64 build).

---

## Learn More

- [Sharding mongodb.com](https://www.mongodb.com/docs/manual/sharding/)
- [Shard Keys mongodb.com](https://www.mongodb.com/docs/manual/core/sharding-shard-key/)
- [Choose a Shard Key mongodb.com](https://www.mongodb.com/docs/manual/core/sharding-choose-a-shard-key/)
- [Hashed Sharding mongodb.com](https://www.mongodb.com/docs/manual/core/hashed-sharding/)
- [Ranged Sharding mongodb.com](https://www.mongodb.com/docs/manual/core/ranged-sharding/)
- [Data Partitioning with Chunks mongodb.com](https://www.mongodb.com/docs/manual/core/sharding-data-partitioning/)
- [Sharded Cluster Balancer mongodb.com](https://www.mongodb.com/docs/manual/core/sharding-balancer-administration/)
- [Routing with mongos mongodb.com](https://www.mongodb.com/docs/manual/core/sharded-cluster-query-router/)
- [$shardedDataDistribution mongodb.com](https://www.mongodb.com/docs/manual/reference/operator/aggregation/shardeddatadistribution/)
