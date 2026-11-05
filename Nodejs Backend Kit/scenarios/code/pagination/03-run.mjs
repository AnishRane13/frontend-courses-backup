// Scenarios 2, 3, 4, 6: counts, drift, ties, prefix search. One 5M-row table.
import { withPg } from '../lib/pg.mjs';
await withPg(7603, async (pool) => {
const q = (sql, p) => pool.query(sql, p);
const ms = async (label, sql, p) => { const t = performance.now(); const r = await q(sql, p);
  console.log(label.padEnd(34), (performance.now() - t).toFixed(1).padStart(8), 'ms', JSON.stringify(r.rows[0] ?? null)); return r; };
const plan = async (label, sql, p) => { const r = (await q('EXPLAIN ANALYZE ' + sql, p)).rows.map((x) => x['QUERY PLAN']);
  const nodes = r.map((l) => l.match(/^\s*(?:->\s*)?([A-Z][A-Za-z ]+?)(?: using| on|  \()/)?.[1]).filter(Boolean);
  console.log(label.padEnd(34), r.find((l) => l.startsWith('Execution')), '|', nodes.join(' > ')); };

await q(`CREATE TABLE orders (id bigserial PRIMARY KEY, status text NOT NULL, total int NOT NULL, created_at timestamptz NOT NULL)`);
await q(`INSERT INTO orders (status, total, created_at) SELECT (ARRAY['paid','pending','refunded'])[1 + (g % 3)],
  ((g::bigint * 7919) % 1000)::int, now() - g * interval '1 second' FROM generate_series(1, 5000000) g`);
await q('CREATE INDEX ON orders (created_at DESC, id DESC)'); await q('ANALYZE orders');

console.log('--- S2 total count');
await ms('exact count(*)', 'SELECT count(*)::int AS n FROM orders');
await ms('exact count, status=paid', `SELECT count(*)::int AS n FROM orders WHERE status = 'paid'`);
await ms('planner estimate (reltuples)', `SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'orders'`);
await ms('capped count (10,001)', 'SELECT count(*)::int AS n FROM (SELECT 1 FROM orders LIMIT 10001) s');

console.log('--- S3 rows inserted while paging');
const pageOff = async (o) => (await q('SELECT id FROM orders ORDER BY created_at DESC, id DESC LIMIT 3 OFFSET $1', [o])).rows.map((r) => r.id);
const a1 = await pageOff(0);
await q(`INSERT INTO orders (status, total, created_at) VALUES ('paid', 1, now() + interval '1 hour')`);
console.log('offset page 1', a1, 'then a new order arrives; offset page 2', await pageOff(3));
const ks = (await q(`SELECT id FROM orders WHERE (created_at, id) < (SELECT created_at, id FROM orders WHERE id = $1)
  ORDER BY created_at DESC, id DESC LIMIT 3`, [a1.at(-1)])).rows.map((r) => r.id);
console.log('keyset page 2 after the same insert', ks);

console.log('--- S4 sort by a non-unique column');
const tie = async (by, o) => (await q(`SELECT id FROM orders WHERE status = 'paid' ORDER BY ${by} LIMIT 20 OFFSET $1`, [o])).rows.map((r) => r.id);
for (const by of ['total DESC', 'total DESC, id DESC']) {
  const p1 = await tie(by, 0), p2 = await tie(by, 20);
  console.log(`ORDER BY ${by}`.padEnd(30), 'rows on both page 1 and 2:', p1.filter((x) => p2.includes(x)).length);
}
const sortSql = `SELECT id, total FROM orders WHERE status = 'paid' ORDER BY total DESC, id DESC LIMIT 20`;
await plan('no matching index', sortSql);
await q('CREATE INDEX ON orders (status, total DESC, id DESC)'); await q('ANALYZE orders');
await plan('index (status, total, id)', sortSql);
await plan('keyset after (total 990, id)', `SELECT id, total FROM orders WHERE status = 'paid' AND (total, id) < ($1, $2)
  ORDER BY total DESC, id DESC LIMIT 20`, [990, 2500000]);

console.log('--- S6 type-ahead search');
await q(`CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL)`);
await q(`INSERT INTO users (email) SELECT 'user' || g || '@' || (ARRAY['gmail.com','acme.io','mactores.com'])[1 + g % 3] FROM generate_series(1, 2000000) g`);
await q('ANALYZE users');
const prefix = `SELECT id, email FROM users WHERE lower(email) LIKE $1 ORDER BY lower(email), id LIMIT 10`;
await plan('prefix, no index', prefix, ['user1234%']);
await q('CREATE INDEX users_email_prefix ON users (lower(email) text_pattern_ops, id)'); await q('ANALYZE users');
await plan('prefix, text_pattern_ops index', prefix, ['user1234%']);
await plan('contains %1234%, same index', prefix, ['%1234%']);
await q('CREATE EXTENSION pg_trgm');
await q('CREATE INDEX users_email_trgm ON users USING gin (lower(email) gin_trgm_ops)'); await q('ANALYZE users');
await plan('contains %1234%, trigram GIN index', prefix, ['%1234%']);
console.log('pg_trgm available:', (await q(`SELECT count(*)::int AS n FROM pg_available_extensions WHERE name = 'pg_trgm'`)).rows[0].n === 1);
});
