// Checks the claims that were marked Unverified in the first draft.
import { withPg } from '../lib/pg.mjs';
await withPg(7604, async (pool) => {
  const q = (s, p) => pool.query(s, p);
  const plan = async (label, sql, p) => { const r = (await q('EXPLAIN ANALYZE ' + sql, p)).rows.map((x) => x['QUERY PLAN']);
    const nodes = r.map((l) => l.match(/^\s*(?:->\s*)?([A-Z][A-Za-z ]+?)(?: using| on|  \()/)?.[1]).filter(Boolean);
        console.log(label.padEnd(36), r.find((l) => l.startsWith('Execution')), '|', nodes.join(' > ')); };

  console.log('--- one index, both directions');
  await q('CREATE TABLE o2 AS SELECT g AS id, (ARRAY[\'paid\',\'pending\'])[1 + g % 2] AS status, g % 1000 AS total FROM generate_series(1, 1000000) g');
  await q('CREATE INDEX ON o2 (status, total DESC, id DESC)'); await q('ANALYZE o2');
  await plan('DESC, DESC', `SELECT id FROM o2 WHERE status = 'paid' ORDER BY total DESC, id DESC LIMIT 20`);
  await plan('ASC, ASC (all flipped)', `SELECT id FROM o2 WHERE status = 'paid' ORDER BY total ASC, id ASC LIMIT 20`);
  await plan('mixed: total DESC, id ASC', `SELECT id FROM o2 WHERE status = 'paid' ORDER BY total DESC, id ASC LIMIT 20`);

  console.log('--- sort by a column in another table');
  await q(`CREATE TABLE customers (id int PRIMARY KEY, name text NOT NULL)`);
  await q(`INSERT INTO customers SELECT g, 'customer ' || lpad(g::text, 6, '0') FROM generate_series(1, 50000) g`);
  await q('ALTER TABLE o2 ADD COLUMN customer_id int'); await q('UPDATE o2 SET customer_id = 1 + id % 50000'); await q('ANALYZE o2');
  await plan('ORDER BY customers.name', `SELECT o2.id, c.name FROM o2 JOIN customers c ON c.id = o2.customer_id WHERE status = 'paid' ORDER BY c.name, o2.id LIMIT 20`);

  console.log('--- NULL in the sort column');
  await q('CREATE TABLE n (id int PRIMARY KEY, score int)');
  await q('INSERT INTO n VALUES (1, 30), (2, 20), (3, NULL), (4, 10), (5, NULL)');
  const all = (await q('SELECT id FROM n ORDER BY score DESC, id DESC')).rows.map((r) => r.id);
  console.log('full order, DESC (NULLs first by default):', all.join(', '));
  const after = (await q('SELECT id FROM n WHERE (score, id) < ($1, $2) ORDER BY score DESC, id DESC', [30, 1])).rows.map((r) => r.id);
  console.log('cursor after id 5? no, rows after (30, 1):', after.join(', '));
  const afterNull = (await q('SELECT id FROM n WHERE (score, id) < ($1, $2) ORDER BY score DESC, id DESC', [null, 5])).rows.map((r) => r.id);
  console.log('rows after a NULL cursor (NULL, 5):', afterNull.length ? afterNull.join(', ') : '(none)');
  const fixed = (await q('SELECT id FROM n WHERE (coalesce(score, -1), id) < ($1, $2) ORDER BY coalesce(score, -1) DESC, id DESC', [30, 1])).rows.map((r) => r.id);
  console.log('with coalesce(score, -1), after (30, 1):', fixed.join(', '));

  console.log('--- LIKE prefix and collation');
  const coll = (await q(`SELECT datcollate FROM pg_database WHERE datname = current_database()`)).rows[0].datcollate;
  console.log('database collation:', coll);
  await q(`CREATE TABLE u (id serial PRIMARY KEY, email text COLLATE "en-x-icu" NOT NULL)`);
  await q(`INSERT INTO u (email) SELECT 'user' || g || '@x.io' FROM generate_series(1, 300000) g`);
  await q('CREATE INDEX u_plain ON u (lower(email))'); await q('ANALYZE u');
  await plan('ICU collation, plain index', `SELECT id FROM u WHERE lower(email) LIKE 'user1234%' LIMIT 10`);
  await q('CREATE INDEX u_pattern ON u (lower(email) text_pattern_ops)'); await q('ANALYZE u');
  await plan('ICU collation, pattern_ops index', `SELECT id FROM u WHERE lower(email) LIKE 'user1234%' LIMIT 10`);

  console.log('--- user typed a percent sign');
  const esc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  const n1 = (await q(`SELECT count(*)::int AS n FROM u WHERE lower(email) LIKE $1`, ['%' + '%'])).rows[0].n;
  const n2 = (await q(`SELECT count(*)::int AS n FROM u WHERE lower(email) LIKE $1`, [esc('%') + '%'])).rows[0].n;
  console.log('input "%" raw ->', n1, 'rows | escaped ->', n2, 'rows');

  console.log('--- GIN fastupdate on vs off (inserts)');
  await q('CREATE EXTENSION pg_trgm');
  for (const fu of ['on', 'off']) {
    await q(`CREATE TABLE g_${fu} (email text)`);
    await q(`CREATE INDEX ON g_${fu} USING gin (email gin_trgm_ops) WITH (fastupdate = ${fu})`);
    const t = performance.now();
    for (let b = 0; b < 20; b++) await q(`INSERT INTO g_${fu} SELECT 'user' || g || '_' || $1 || '@mail.com' FROM generate_series(1, 1000) g`, [b]);
    console.log(`fastupdate=${fu}`.padEnd(16), '20 x 1,000-row inserts', (performance.now() - t).toFixed(0), 'ms');
  }
});
