// Seeds 5M orders, then compares deep OFFSET with keyset and drives the API.
import request from 'supertest';
import { withPg } from '../lib/pg.mjs';
import { ordersApp } from './orders-api.mjs';

await withPg(7601, async (pool) => {
await pool.query(`CREATE TABLE orders (id bigserial PRIMARY KEY, customer_id int NOT NULL,
  status text NOT NULL, total numeric(10,2) NOT NULL, created_at timestamptz NOT NULL)`);
let t = Date.now();
await pool.query(`INSERT INTO orders (customer_id, status, total, created_at)
  SELECT (random()*50000)::int, (ARRAY['paid','pending','refunded'])[1 + (g % 3)],
         round((random()*500)::numeric, 2), now() - (g * interval '1 second')
  FROM generate_series(1, 5000000) g`);
await pool.query('CREATE INDEX orders_created_id ON orders (created_at DESC, id DESC)');
await pool.query('ANALYZE orders');
console.log('seeded 5,000,000 rows in', ((Date.now() - t) / 1000).toFixed(1), 's');

const plan = async (label, sql, params) => {
  const { rows } = await pool.query('EXPLAIN (ANALYZE, BUFFERS) ' + sql, params);
  const text = rows.map((r) => r['QUERY PLAN']);
  console.log(label.padEnd(26), text.find((l) => l.startsWith('Execution Time')),
    '|', text[1]?.trim().slice(0, 70));
};
for (const page of [1, 1000, 100000, 250000]) {
  await plan(`OFFSET page ${page}`, 'SELECT id, total, created_at FROM orders ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET $1', [(page - 1) * 20]);
}
const deep = (await pool.query('SELECT created_at, id FROM orders ORDER BY created_at DESC, id DESC OFFSET 4999979 LIMIT 1')).rows[0];
await plan('KEYSET near the end', `SELECT id, total, created_at FROM orders WHERE (created_at, id) < ($1, $2)
  ORDER BY created_at DESC, id DESC LIMIT 20`, [deep.created_at, deep.id]);

const app = ordersApp(pool);
const p1 = await request(app).get('/orders?limit=3');
console.log('page 1 ids', p1.body.data.map((r) => r.id), 'next', p1.body.nextCursor);
const p2 = await request(app).get('/orders?limit=3&after=' + p1.body.nextCursor);
console.log('page 2 ids', p2.body.data.map((r) => r.id));
console.log('limit=5000 ->', (await request(app).get('/orders?limit=5000')).status);
console.log('bad cursor ->', (await request(app).get('/orders?after=garbage')).status);
// The API's own query, explained with a cursor near the end of the table
const last = (await pool.query('SELECT created_at::text AS ts, id FROM orders ORDER BY created_at, id LIMIT 1 OFFSET 30')).rows[0];
await plan('API next-page query, deep', `SELECT id, total, created_at, created_at::text AS ts FROM orders
  WHERE (created_at, id) < ($1::timestamptz, $2::bigint)
  ORDER BY created_at DESC, id DESC LIMIT $3`, [last.ts, last.id, 21]);
});
