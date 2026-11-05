// D1: a customer's order history query. Checks, with node:assert:
// 1. without an index the plan is a sequential scan plus a sort;
// 2. an index with the equality column first, then the sort column, gives an index scan with no sort
//    and reads far fewer buffers than an index in the wrong column order;
// 3. the N+1 loop sends one query per order, the JOIN sends one query in total.
import assert from 'node:assert/strict';
import { withPg } from '../lib/pg.mjs';

const nodes = (plan) => [plan['Node Type'], ...(plan.Plans ?? []).flatMap(nodes)];
const buffers = (plan) => (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);

let ok = false;                                   // withPg logs a failure; this makes it exit 1
await withPg(7720, async (pool) => {
  await pool.query(`CREATE TABLE customers (id int PRIMARY KEY, name text NOT NULL)`);
  await pool.query(`INSERT INTO customers SELECT g, 'customer ' || g FROM generate_series(1, 5000) g`);
  await pool.query(`CREATE TABLE orders (id bigserial PRIMARY KEY, customer_id int NOT NULL REFERENCES customers,
    status text NOT NULL, total numeric(10,2) NOT NULL, created_at timestamptz NOT NULL)`);
  await pool.query(`INSERT INTO orders (customer_id, status, total, created_at)
    SELECT 1 + (g % 5000), (ARRAY['paid','pending','refunded'])[1 + (g % 3)],
           round((random()*500)::numeric, 2), now() - (g * interval '1 minute')
    FROM generate_series(1, 600000) g`);
  await pool.query('ANALYZE');

  const SQL = `SELECT id, status, total, created_at FROM orders
    WHERE customer_id = $1 AND created_at > now() - interval '400 days'
    ORDER BY created_at DESC LIMIT 20`;
  const explain = async () => {
    const { rows } = await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + SQL, [42]);
    return rows[0]['QUERY PLAN'][0].Plan;
  };

  // 1. No index on customer_id: the whole table is scanned and sorted.
  const none = await explain();
  const noneNodes = nodes(none);
  assert.ok(noneNodes.some((n) => n === 'Seq Scan'), `expected a Seq Scan, got ${noneNodes}`);
  assert.ok(noneNodes.includes('Sort'), 'expected a Sort without an index');

  // 2a. Wrong order: the range/sort column first, the equality column second.
  await pool.query('CREATE INDEX orders_wrong ON orders (created_at, customer_id)');
  await pool.query('ANALYZE orders');
  const wrong = await explain();
  await pool.query('DROP INDEX orders_wrong');

  // 2b. Right order: equality column first, then the sort and range column.
  await pool.query('CREATE INDEX orders_customer_created ON orders (customer_id, created_at)');
  await pool.query('ANALYZE orders');
  const right = await explain();
  const rightNodes = nodes(right);
  assert.ok(rightNodes.some((n) => /Index/.test(n)), `expected an index scan, got ${rightNodes}`);
  assert.ok(!rightNodes.includes('Sort'), 'the right index should return rows already sorted');
  assert.ok(!rightNodes.includes('Seq Scan'), 'no sequential scan with the right index');
  assert.equal(right['Actual Rows'], 20);
  assert.ok(buffers(wrong) >= 10 * buffers(right),
    `wrong-order index should read at least 10x more buffers (wrong ${buffers(wrong)}, right ${buffers(right)})`);
  console.log('no index:', noneNodes.join(' > '), '| wrong order:', nodes(wrong).join(' > '), buffers(wrong), 'buffers',
    '| right order:', rightNodes.join(' > '), buffers(right), 'buffers');

  // 3. N+1: one query for the orders, then one per order for the customer name.
  let count = 0;
  const q = (sql, params) => { count++; return pool.query(sql, params); };
  const { rows: recent } = await q('SELECT id, customer_id FROM orders ORDER BY id DESC LIMIT 20');
  for (const o of recent) o.name = (await q('SELECT name FROM customers WHERE id = $1', [o.customer_id])).rows[0].name;
  assert.equal(count, 21);
  count = 0;
  const { rows: joined } = await q(`SELECT o.id, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
    ORDER BY o.id DESC LIMIT 20`);
  assert.equal(count, 1);
  assert.deepEqual(joined.map((r) => r.name), recent.map((r) => r.name));
  console.log('N+1 sent 21 queries, the JOIN sent 1, same names');
  ok = true;
});
if (!ok) process.exit(1);
