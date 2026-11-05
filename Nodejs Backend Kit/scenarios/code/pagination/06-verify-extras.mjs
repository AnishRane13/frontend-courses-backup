// Partition pruning with a real cursor, why count cannot be stored, split counters, GIN pending list reads.
import pg from 'pg';
import { withPg } from '../lib/pg.mjs';
await withPg(7605, async (pool) => {
  const q = (s, p) => pool.query(s, p);
  const plan = async (label, sql, p) => { const r = (await q('EXPLAIN ANALYZE ' + sql, p)).rows.map((x) => x['QUERY PLAN']);
    const hit = r.filter((l) => /on orders_\d{4}_\d{2}/.test(l) && !/never executed/.test(l)).map((l) => l.match(/orders_\d{4}_(\d{2})/)[1]);
    console.log(label.padEnd(34), r.find((l) => l.startsWith('Execution')), '| months scanned:', [...new Set(hit)].join(',')); };

  console.log('--- partitions, cursor in May (data covers mid April to June)');
  await q(`CREATE TABLE orders (id bigint NOT NULL, created_at timestamptz NOT NULL) PARTITION BY RANGE (created_at)`);
  for (const m of [4, 5, 6]) await q(`CREATE TABLE orders_2026_0${m} PARTITION OF orders FOR VALUES FROM ('2026-0${m}-01') TO ('2026-0${m + 1}-01')`);
  await q(`INSERT INTO orders SELECT g, timestamptz '2026-06-30 10:00+00' - g * interval '3 seconds' FROM generate_series(1, 2000000) g`);
  await q('CREATE INDEX ON orders (created_at DESC, id DESC)'); await q('ANALYZE orders');
  const cur = (await q(`SELECT created_at::text AS ts, id FROM orders WHERE created_at < '2026-05-15' ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
  await plan('row comparison only', 'SELECT id FROM orders WHERE (created_at, id) < ($1::timestamptz, $2::bigint) ORDER BY created_at DESC, id DESC LIMIT 20', [cur.ts, cur.id]);
  await plan('plus created_at <= cursor', 'SELECT id FROM orders WHERE created_at <= $1::timestamptz AND (created_at, id) < ($1::timestamptz, $2::bigint) ORDER BY created_at DESC, id DESC LIMIT 20', [cur.ts, cur.id]);

  console.log('--- two transactions, two different counts');
  const a = await pool.connect(), b = await pool.connect();
  await a.query('BEGIN ISOLATION LEVEL REPEATABLE READ'); const before = (await a.query('SELECT count(*)::int AS n FROM orders_2026_06')).rows[0].n;
  await b.query(`INSERT INTO orders VALUES (0, '2026-06-30 10:30+00')`);
  console.log('A (open transaction):', (await a.query('SELECT count(*)::int AS n FROM orders_2026_06')).rows[0].n, '| B (after its insert):', (await b.query('SELECT count(*)::int AS n FROM orders_2026_06')).rows[0].n, '| A at start:', before);
  await a.query('COMMIT'); a.release(); b.release();

  console.log('--- hot counter: one row vs 16 slot rows, 40 clients x 100 increments');
  await q('CREATE TABLE counter1 (customer_id int PRIMARY KEY, n int NOT NULL)'); await q('INSERT INTO counter1 VALUES (1, 0)');
  await q('CREATE TABLE counter16 (customer_id int, slot int, n int NOT NULL, PRIMARY KEY (customer_id, slot))');
  await q('INSERT INTO counter16 SELECT 1, s, 0 FROM generate_series(0, 15) s');
  const big = new pg.Pool({ host: '127.0.0.1', port: 7605, user: 'postgres', password: 'pw', database: 'postgres', max: 40 }); big.on('error', () => {});
  for (const [label, sql] of [['one row', 'UPDATE counter1 SET n = n + 1 WHERE customer_id = 1'],
    ['16 slots', 'UPDATE counter16 SET n = n + 1 WHERE customer_id = 1 AND slot = $1']]) {
    const t = performance.now();
    await Promise.all(Array.from({ length: 40 }, async () => { const c = await big.connect(); c.on('error', () => {});
      for (let i = 0; i < 100; i++) { await c.query('BEGIN'); await c.query(sql, sql.includes('$1') ? [Math.floor(Math.random() * 16)] : []); await c.query('SELECT pg_sleep(0.001)'); await c.query('COMMIT'); } c.release(); }));
    const total = (await q(label === 'one row' ? 'SELECT n FROM counter1' : 'SELECT sum(n)::int AS n FROM counter16')).rows[0].n;
    console.log(label.padEnd(10), 'total', total, '|', (performance.now() - t).toFixed(0), 'ms');
  }
  await big.end();

  console.log('--- GIN pending list: search before and after cleanup');
  await q('CREATE EXTENSION pg_trgm'); await q('CREATE EXTENSION pgstattuple');
  await q('CREATE TABLE g (id serial, email text)');
  await q(`CREATE INDEX g_trgm ON g USING gin (email gin_trgm_ops) WITH (fastupdate = on, gin_pending_list_limit = 65536)`);
  await q('ALTER TABLE g SET (autovacuum_enabled = false)');
  for (let i = 0; i < 40; i++) await q(`INSERT INTO g (email) SELECT 'user' || g || '_' || $1 || '@mail.com' FROM generate_series(1, 1000) g`, [i]);
  const search = async (label) => { const pend = (await q(`SELECT pending_pages FROM pgstatginindex('g_trgm')`)).rows[0].pending_pages;
    const r = (await q(`EXPLAIN ANALYZE SELECT id FROM g WHERE email LIKE '%r123_7%'`)).rows.map((x) => x['QUERY PLAN']);
    console.log(label.padEnd(26), 'pending pages', String(pend).padStart(5), '|', r.find((l) => l.startsWith('Execution'))); };
  await search('pending list full');
  await q('VACUUM g');
  await search('after VACUUM');
});
