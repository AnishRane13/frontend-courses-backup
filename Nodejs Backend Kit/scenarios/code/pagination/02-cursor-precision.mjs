// Does a timestamptz survive a JSON cursor round trip through JS Date?
import { withPg } from '../lib/pg.mjs';
await withPg(7602, async (pool) => {
await pool.query(`CREATE TABLE t (id int PRIMARY KEY, created_at timestamptz NOT NULL)`);
await pool.query(`INSERT INTO t VALUES (1, '2026-11-04 10:00:00.123900+00'), (2, '2026-11-04 10:00:00.123500+00'),
  (3, '2026-11-04 10:00:00.123100+00'), (4, '2026-11-04 09:59:59+00')`);
const SEL = 'SELECT id, created_at, created_at::text AS ts_text FROM t';
const page = async ([ts, id]) => (ts === null
  ? await pool.query(`${SEL} ORDER BY created_at DESC, id DESC LIMIT 1`)
  : await pool.query(`${SEL} WHERE (created_at, id) < ($1::timestamptz, $2::int) ORDER BY created_at DESC, id DESC LIMIT 1`, [ts, id])).rows[0];
// Bug: cursor built from the JS Date (milliseconds only)
let r = await page([null, null]); const seenA = [r.id];
while (r) { r = await page([JSON.parse(JSON.stringify(r.created_at)), r.id]); if (r) seenA.push(r.id); }
console.log('cursor from JS Date    :', seenA.join(', '));
// Fix: cursor built from the exact text Postgres returned
r = await page([null, null]); const seenB = [r.id];
while (r) { r = await page([r.ts_text, r.id]); if (r) seenB.push(r.id); }
console.log('cursor from ::text     :', seenB.join(', '));
});
