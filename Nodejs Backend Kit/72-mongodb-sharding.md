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

## Say it in 30 seconds

Sharding splits one MongoDB collection across several replica sets, called shards, by a field you choose, the shard key. Your app still talks to one router, mongos, which sends each query to the shards that could hold a match and merges the replies. You do it when the data or the writes no longer fit on one primary. The trade-off is the key: a key that only grows puts every new write on one shard, and a query that does not include the key has to ask every shard.

## Why it matters

A replica set copies the same data to every member. It protects you from losing a server. Every member still holds all the data, and the primary takes every write. When the data no longer fits on one machine, or one primary cannot keep up with the writes, a bigger machine is the only move left inside a replica set.

Sharding splits one collection across several replica sets. Each shard holds part of the data and takes the writes for its part. The application still connects to one address, a mongos router, and sends normal queries.

Sharding helps only if the shard key spreads both the data and the traffic. A bad key gives you the cost of a cluster and the throughput of one server. Every new document lands on the same shard, a hot shard, or every query has to ask every shard, which is scatter-gather. This lesson runs a real two-shard cluster and shows both failures.

Lessons 67 and 68 are the single-server basics. Lesson 71 is the aggregation pipeline that mongos splits across shards.

## The concept, simply

A sharded cluster has three kinds of processes.

- **Shards.** Each shard is a replica set that stores a subset of each sharded collection.
- **Config servers.** A replica set that stores the metadata: which collections are sharded, on which key, and which shard owns which range of key values (`config.collections`, `config.chunks`).
- **mongos.** A router with no data of its own. It caches the routing table from the config servers, sends each operation to the shards that can hold matching documents, and merges their replies.

The shard key's values, from `MinKey` to `MaxKey`, are cut into contiguous ranges called **chunks**. Each chunk lives on exactly one shard. This is the topology from Example 2, after Example 4 split the ranged collection at `customerId` 26:

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

- **Ranged.** Chunks are ranges of the key values. Nearby values sit together, so a range query such as customer ids 1 through 9 can go to one shard. A key that only grows, a counter, a timestamp, or an ObjectId, sends every new document to the chunk that ends at `MaxKey`, which is one shard.
- **Hashed.** MongoDB hashes the value and cuts chunks on hash ranges. Consecutive values land on different shards, so inserts spread out. A range of original values is scattered, so range queries go to every shard.

## How it works

What happens to a query sent through mongos:

1. The Node driver sends the operation to mongos, the same way it would send it to one server.
2. mongos looks at the filter. If the filter pins the shard key, an equality or a range on a ranged key, mongos works out which chunks can hold matches and which shards own those chunks.
3. **Targeted.** If those chunks are all on one shard, the operation goes only there. `explain()` reports `SINGLE_SHARD`.
4. **Scatter-gather.** If the filter does not contain the shard key, or the matching chunks are on several shards, mongos sends the operation to every relevant shard. `explain()` reports `SHARD_MERGE`, or `SHARD_MERGE_SORT` when mongos must merge sorted streams.
5. Each shard runs the operation on its own data and its own indexes, and drops orphaned documents with a `SHARDING_FILTER` stage. An orphan is a copy left behind after a chunk moved.
6. mongos merges the replies and returns one cursor. For an aggregation it splits the pipeline: a `shardsPart` runs on every shard and a `mergerPart` combines the partial results (Example 5).

An insert goes to exactly one shard. mongos reads the document's shard key, finds the chunk whose range contains it, and sends the insert there. Which shard takes the write load depends only on how the key values are spread.

**Chunks and the balancer.** Sharding an empty collection on a ranged key creates one chunk from `MinKey` to `MaxKey` on the database's primary shard (Example 3). A hashed key on an empty collection started with one chunk per shard on 8.2.6. The balancer, a background process on the config server primary, moves ranges when a collection's data is uneven. The documented threshold is a size difference of at least three times the range size. The default range size is 128 MB, so two shards must differ by 384 MB before a migration. A few thousand test documents never balance on their own. Examples 4 and 6 move a range by hand. Example 7 lowers the range size to 1 MB, which is only for a lab.

**A migration.** The donor copies the documents of a range to the recipient. The recipient commits ownership in the config servers. The donor deletes its copies later. Until then the donor still holds them as orphans. Queries through mongos filter orphans out. A query sent straight to a shard's `mongod` does not (Example 7).

**Choosing a key,** in this order:

- **Cardinality.** How many distinct values are there? A key with 50 values can never be split into more than 50 chunks.
- **Frequency.** Is one value very common? Every document with that value stays in one chunk.
- **Monotonicity.** Do new values always grow? A ranged key then sends all new writes to one shard.
- **Query pattern.** Do the hot queries filter on the key? If they do not, they are all scatter-gather.

A compound key such as `{ customerId: 1, createdAt: 1 }` answers several of these at once. You can add suffix fields later with `refineCollectionShardKey`, or move the collection onto a new key with `reshardCollection`. Resharding copies the whole collection, so choose carefully up front.

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

- **A ranged key that only grows,** such as a timestamp, a counter, or an ObjectId `_id`. Every insert goes to the shard that owns the open top chunk (Example 6: 0 versus 4,000). Hash the field, or lead with a field whose new values arrive in no particular order.
- **A low-cardinality key.** Hashing 50 customer ids still gave a 1,240 / 760 split (Example 4). Documents that share a key value stay in one chunk, and that chunk cannot be split.
- **A range query on a hashed key.** It goes to every shard, and the hashed index cannot serve it, so each shard scans unless another index matches (Example 5).
- **A hot query that does not include the shard key.** Every such query asks every shard. That is acceptable for a rare report. It is not acceptable for a hot path.
- **Counting on a shard directly.** A direct count includes orphans: 12,000 on a shard that owns 6,970 (Example 7). Count through mongos, and use `$shardedDataDistribution` for per-shard numbers.
- **A unique index that does not start with the shard key.** `createIndex({ email: 1 }, { unique: true })` fails with `CannotCreateIndex` (code 67) when the shard key is `{ customerId: 1 }` (Example 3). No shard can check uniqueness of values another shard holds.
- **Expecting the balancer to move a small collection.** With the default 128 MB range, nothing moves until shards differ by 384 MB. Do not leave a 1 MB range size in production. It means many more migrations.
- **Looking for `sh.*` helpers in the driver.** `sh.shardCollection` and `sh.moveRange` are mongosh helpers. From Node, run `shardCollection`, `split`, and `moveRange` through `db.admin().command(...)`.
- **A slow mongos shutdown.** A SIGTERM waits on the order of 15 seconds by default (Example 8). Allow for that in deploy scripts.

## Best practices

- Shard when you must. First use indexes, schema changes, and a larger replica set. A shard key is expensive to change.
- List the top queries and the write pattern, then pick a key with high cardinality, no single huge value, no single growing direction, and that the hot queries filter on.
- Prefer a compound key such as `{ tenantId: 1, createdAt: 1 }` or `{ customerId: 1, _id: 1 }`. The first field targets queries. The second keeps chunks splittable.
- Check each hot query with `explain()`. You want `SINGLE_SHARD`, or `SHARD_MERGE` over only the shards you expect.
- Watch `$shardedDataDistribution`, including `numOrphanedDocs` after migrations.
- Applications connect only to mongos, several of them for availability, never to a shard directly.
- In production, run three-member replica sets for every shard and for the config servers. The one-member sets in the examples exist so the protocol can run on a laptop.

## ⭐ Interview lens

> **Q: “How do you choose a shard key?”**  
> Start from the workload, not from a default field. The key needs high cardinality, so the data can be split into many chunks, and low frequency, so one value does not pin a huge share of documents in a single chunk. It should not be a value that only grows, or every insert lands on the chunk that ends at `MaxKey`. And the hot queries have to filter on it, or mongos cannot target a shard. A compound key often does all of this: a tenant or customer id first, then a time or id field so chunks stay splittable. For example, `{ customerId: 1, createdAt: 1 }` targets "this customer's recent orders" and still splits when one customer is huge. Then check `explain()` for `SINGLE_SHARD`. The limit of choosing `_id` is that a default ObjectId grows over time, so a ranged `_id` key is a hot shard. You can reshard later, and resharding copies the whole collection.

> **Q: “Hashed or ranged sharding?”**  
> Ranged sharding cuts the real key values into ranges. Nearby values sit on the same shard, so a query for customer ids 1 through 9 can be `SINGLE_SHARD`. A key that only increases, a counter or a timestamp, sends every new insert to one shard. Hashed sharding stores ranges of the hash. Consecutive values spread out, which is what balanced the inserts in Example 6 at 2,005 and 1,995. A range of the original values is scattered across every chunk, and the hashed index cannot serve that range, so each shard scans unless another index matches. Hashing does not fix a key with few distinct values: 50 customer ids still split 1,240 / 760, because every document with the same key stays in one chunk. The limit is picking hashed for a workload whose hot queries are ranges. You balanced the writes and made every read a scatter-gather.

> **Q: “What is a scatter-gather query and why does it matter?”**  
> A scatter-gather query is one mongos cannot send to a single shard. The filter has no shard key, or the matching chunks live on more than one shard. mongos broadcasts it and merges the replies. `explain()` shows `SHARD_MERGE`, or `SHARD_MERGE_SORT` when the streams are sorted and mongos has to merge them in order. Every shard does work, so the cost grows with the number of shards, and the latency is the slowest shard. For example, `find({ status: 'paid' })` on a collection sharded by `customerId` asks every shard, while `find({ customerId: 7 })` asks one. The limit of "it still returns the right answer" is capacity. A rare report can scatter. A hot request path that scatters means you added shards and did not add throughput.

> **Q: “What are orphaned documents?”**  
> An orphan is a copy of a document a shard no longer owns. During a migration the donor copies the range to the recipient, ownership moves in the config servers, and the donor deletes its copies later. Until that delete, the donor still has the documents. Queries through mongos drop them with a `SHARDING_FILTER` stage, so application reads stay correct. A query or a count sent directly to a shard's `mongod` includes them. Example 7 counted 12,000 on a shard that owned 6,970. The limit is any admin script, backup, or metric that connects to a shard instead of to mongos. Use `$shardedDataDistribution` for per-shard counts. On the 8.2.6 server in this lesson the donor keeps those copies for `orphanCleanupDelaySecs`, which is 3600 seconds, and only then deletes them.

## Cheat-card

- Topology: shards, a config-server replica set (`config.chunks`), and mongos. Apps connect only to mongos.
- A chunk is a `[min, max)` range of shard-key values on one shard. Default range size is 128 MB. Balancing starts at a 3 times difference, 384 MB.
- A ranged key keeps range queries targeted. A monotonic key produced a hot shard here: 0 versus 4,000 inserts.
- A hashed key spread inserts here, 2,005 and 1,995. Range queries scatter, and the hashed index cannot serve them.
- All documents with one key value share a chunk. 50 hashed values split 1,240 / 760.
- Equality or an in-chunk range on the shard key is `SINGLE_SHARD`. No shard key, or a range across shards, is `SHARD_MERGE` or `SHARD_MERGE_SORT`.
- Aggregation on mongos: `splitPipeline.shardsPart` on the shards, `mergerPart` on mongos.
- A unique index must start with the shard key. Otherwise the error is code 67.
- Count through mongos. A direct count includes orphans.

## Good to know

- `moveRange` was added in MongoDB 6.0. `$shardedDataDistribution` was added in 6.0.3 and runs on mongos against the `admin` database.
- On 8.2.6, `orphanCleanupDelaySecs` is 3600, changed in v8.2. Queries through mongos filter orphans. A direct count on the shard does not.
- Example 8: mongos spent about 15 seconds in quiesce mode (`"quiesceModeMillis":15023`), the default of `mongosShutdownTimeoutMillisForSignaledShutdown` at 15,000 ms.
- Commands from Node are `addShard`, `shardCollection`, `split`, and `moveRange`. Distribution uses `$shardedDataDistribution`.
- Versions used: Node v24.19.0, `mongodb` driver 7.7.0, MongoDB 8.2.6, `mongod` and `mongos`, the ubuntu2404 x86_64 build.

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
