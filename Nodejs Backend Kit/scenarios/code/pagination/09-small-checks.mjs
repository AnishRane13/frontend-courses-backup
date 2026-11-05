// Small claims used in follow-up answers.
import { withPg } from '../lib/pg.mjs';
await withPg(7606, async (pool) => {
  const q = (s, p) => pool.query(s, p);
  await q(`ALTER SYSTEM SET autovacuum = off`); await q('SELECT pg_reload_conf()');
  await q('CREATE TABLE t (id int PRIMARY KEY, total int, email text)');
  await q(`INSERT INTO t SELECT g, g % 100, 'user' || g || '@x.io' FROM generate_series(1, 100000) g`); await q('ANALYZE t');
  const est = async () => (await q(`SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 't'`)).rows[0].n;
  console.log('estimate after ANALYZE:', await est());
  await q(`INSERT INTO t SELECT g, g % 100, 'user' || g || '@x.io' FROM generate_series(100001, 300000) g`);
  console.log('after inserting 200,000 more, no ANALYZE:', await est());
  await q('ANALYZE t'); console.log('after ANALYZE again:', await est());

  const byParam = (await q('SELECT id FROM t ORDER BY $1 LIMIT 3', ['total'])).rows.map((r) => r.id);
  const byCol = (await q('SELECT id, total FROM t ORDER BY total DESC, id LIMIT 3')).rows.map((r) => r.id);
  console.log('ORDER BY $1 with "total":', byParam.join(', '), '| ORDER BY total DESC:', byCol.join(', '));

  const coll = (await q(`SELECT datcollate FROM pg_database WHERE datname = current_database()`)).rows[0].datcollate;
  await q('CREATE INDEX t_plain ON t (lower(email))'); await q('ANALYZE t');
  const p = (await q(`EXPLAIN SELECT id FROM t WHERE lower(email) LIKE 'user1234%'`)).rows.map((r) => r['QUERY PLAN'].trim().split('  (')[0]);
  console.log(`collation ${coll}, plain index, prefix LIKE:`, p.join(' > '));
});
