// Scenario 5: products in MongoDB. skip() vs a range cursor, and the index it needs.
import { withMongo } from '../lib/mongo.mjs';
await withMongo(async (db) => {
  const products = db.collection('products');
  const cats = ['shoes', 'bags', 'watches', 'shirts'];
  for (let b = 0; b < 100; b++) {
    await products.insertMany(Array.from({ length: 10000 }, (_, i) => {
      const n = b * 10000 + i;
      return { category: cats[n % 4], price: (n * 7919) % 500, name: 'p' + n };
    }));
  }
  await products.createIndex({ category: 1, price: -1, _id: -1 });
  const filter = { category: 'shoes' }, sort = { price: -1, _id: -1 };
  const stats = async (label, cursor) => {
    const s = (await cursor.explain('executionStats')).executionStats;
    console.log(label.padEnd(30), 'ms', String(s.executionTimeMillis).padStart(4), '| keys', s.totalKeysExamined, '| docs', s.totalDocsExamined, '| returned', s.nReturned);
  };
  await stats('skip page 1', products.find(filter).sort(sort).limit(20));
  await stats('skip page 10,000 (skip 199,980)', products.find(filter).sort(sort).skip(199980).limit(20));
  const last = await products.find(filter).sort(sort).skip(199979).limit(1).next();
  const after = { ...filter, $or: [{ price: { $lt: last.price } }, { price: last.price, _id: { $lt: last._id } }] };
  await stats('range cursor, same depth', products.find(after).sort(sort).limit(20));
  const p1 = await products.find(filter).sort({ price: -1 }).limit(20).toArray();
  const p2 = await products.find(filter).sort({ price: -1 }).skip(20).limit(20).toArray();
  const ids = new Set(p1.map((d) => String(d._id)));
  console.log('sort by price only, rows on page 1 and 2:', p2.filter((d) => ids.has(String(d._id))).length);
});
