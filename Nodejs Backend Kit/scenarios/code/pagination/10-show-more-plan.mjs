// P4 "show more": the keyset query for a type-ahead, with a short prefix ("a" matches about 1 in 16 rows).
// Writes the plans to pagination/output/10-show-more-plan.txt and prints one line per variant.
import { writeFileSync } from 'node:fs';
import { withPg } from '../lib/pg.mjs';
const out = [];
await withPg(7612, async (pool) => {
  const q = (s, p) => pool.query(s, p);
  await q('CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL)');
  await q(`INSERT INTO users (email) SELECT md5(g::text) || '@mail.com' FROM generate_series(1, 2000000) g`);
  const variants = [
    ['pattern_ops index, ORDER BY lower(email)', 'CREATE INDEX ix ON users (lower(email) text_pattern_ops, id)',
      `SELECT id, email FROM users WHERE lower(email) LIKE $1 ORDER BY lower(email), id LIMIT 10`,
      `SELECT id, email FROM users WHERE lower(email) LIKE $1 AND (lower(email), id) > ($2, $3) ORDER BY lower(email), id LIMIT 10`],
    ['C-collation index, ORDER BY ... COLLATE "C"', 'CREATE INDEX ix ON users ((lower(email) COLLATE "C"), id)',
      `SELECT id, email FROM users WHERE lower(email) COLLATE "C" LIKE $1 ORDER BY lower(email) COLLATE "C", id LIMIT 10`,
      `SELECT id, email FROM users WHERE lower(email) COLLATE "C" LIKE $1 AND (lower(email) COLLATE "C", id) > ($2, $3) ORDER BY lower(email) COLLATE "C", id LIMIT 10`],
  ];
  for (const [label, ddl, first, next] of variants) {
    await q('DROP INDEX IF EXISTS ix'); await q(ddl); await q('ANALYZE users');
    for (const prefix of ['a', 'a1b2']) {
      const page1 = (await q(first, [prefix + '%'])).rows;
      const last = page1.at(-1);
      for (const [kind, sql, params] of [['first page', first, [prefix + '%']], ['show more ', next, [prefix + '%', last.email.toLowerCase(), last.id]]]) {
        const plan = (await q('EXPLAIN (ANALYZE, BUFFERS) ' + sql, params)).rows.map((r) => r['QUERY PLAN']);
        const nodes = plan.map((l) => l.match(/^\s*(?:->\s*)?([A-Z][A-Za-z ]+?)(?: using| on|  \()/)?.[1]).filter(Boolean).join(' > ');
        const line = `${label} | prefix "${prefix}" | ${kind} | ${plan.find((l) => l.startsWith('Execution'))} | ${nodes}`;
        console.log(line); out.push(line, ...plan.map((l) => '    ' + l), '');
      }
    }
  }
  const same = async (sqlA, sqlB) => JSON.stringify((await q(sqlA)).rows) === JSON.stringify((await q(sqlB)).rows);
  console.log('C order equals pattern order for these emails:', await same(
    `SELECT id FROM users WHERE lower(email) LIKE 'a1%' ORDER BY lower(email) COLLATE "C", id`,
    `SELECT id FROM users WHERE lower(email) LIKE 'a1%' ORDER BY lower(email) USING ~<~, id`));
});
writeFileSync(new URL('./output/10-show-more-plan.txt', import.meta.url), out.join('\n'));
