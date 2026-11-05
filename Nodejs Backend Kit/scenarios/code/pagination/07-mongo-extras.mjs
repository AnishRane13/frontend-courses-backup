// Mongo counts, ObjectId time order, and $lookup before vs after $limit.
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';
await withMongo(async (db) => {
  const orders = db.collection('orders'), customers = db.collection('customers');
  await customers.insertMany(Array.from({ length: 20000 }, (_, i) => ({ _id: i, name: 'c' + i })));
  for (let b = 0; b < 20; b++) await orders.insertMany(Array.from({ length: 10000 }, (_, i) => ({ status: i % 3 ? 'paid' : 'pending', customerId: (b * 10000 + i) % 20000, total: i % 500 })));
  const time = async (label, fn) => { const t = performance.now(); const r = await fn(); console.log(label.padEnd(40), String((performance.now() - t).toFixed(1)).padStart(7), 'ms', JSON.stringify(r)); };
  await time('countDocuments({})', () => orders.countDocuments({}));
  await time('countDocuments({ status: "paid" })', () => orders.countDocuments({ status: 'paid' }));
  await time('estimatedDocumentCount()', () => orders.estimatedDocumentCount());
  const ex = await orders.find({ status: 'paid' }).explain('executionStats');
  console.log('a paid filter with no index examines', ex.executionStats.totalDocsExamined, 'docs');

  const ids = [new ObjectId(), new ObjectId(), new ObjectId()];
  console.log('ObjectIds made by the driver, in order:', ids.map((x) => x.toHexString().slice(0, 8) + '…' + x.toHexString().slice(-6)).join(' '));
  console.log('timestamp inside the first:', ids[0].getTimestamp().toISOString(), '| sorted ids equal creation order:', JSON.stringify([...ids].sort()) === JSON.stringify(ids));

  await orders.createIndex({ status: 1, total: -1, _id: -1 });
  const pipe = (lookupFirst) => [{ $match: { status: 'paid' } }, { $sort: { total: -1, _id: -1 } },
    ...(lookupFirst ? [{ $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'c' } }, { $limit: 20 }]
                    : [{ $limit: 20 }, { $lookup: { from: 'customers', localField: 'customerId', foreignField: '_id', as: 'c' } }])];
  for (const first of [true, false]) {
    const t = performance.now(); const rows = await orders.aggregate(pipe(first)).toArray();
    const stages = (await orders.aggregate(pipe(first)).explain('executionStats'));
    const order = []; // walk the plan tree from the top: the first stage listed runs last
    for (let n = stages.queryPlanner.winningPlan.queryPlan; n; n = n.inputStage) order.push(n.stage);
    const lim = JSON.stringify(stages).match(/"limitAmount":(\d+)|"\$limit":(\d+)/);
    console.log((first ? '$lookup then $limit (as written)' : '$limit then $lookup').padEnd(40), (performance.now() - t).toFixed(1).padStart(7), 'ms', '| rows', rows.length, '| plan, top to bottom:', order.join(' > '), '| limit', lim?.[1] ?? lim?.[2]);
  }
});
