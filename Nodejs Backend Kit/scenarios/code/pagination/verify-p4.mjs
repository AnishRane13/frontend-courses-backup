// P4: one-letter "show more" with both indexes, client debounce and cancel, trigram, collation, escaping, GIN pending list.
import assert from 'node:assert/strict';
import { run, grab } from '../lib/run.mjs';
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout; };

const s = ok(run('pagination/10-show-more-plan.mjs'));
const pat1 = grab(s, /pattern_ops index.*prefix "a" \| first page \| Execution Time: ([\d.]+) ms/);
const pat2 = grab(s, /pattern_ops index.*prefix "a" \| show more  \| Execution Time: ([\d.]+) ms/);
const c1 = grab(s, /C-collation index.*prefix "a" \| first page \| Execution Time: ([\d.]+) ms/);
const c2 = grab(s, /C-collation index.*prefix "a" \| show more  \| Execution Time: ([\d.]+) ms/);
assert.ok(pat1 > 100 && pat2 > 100, `pattern index with default-collation sort should take over 100 ms: ${pat1}, ${pat2}`);
assert.ok(c1 < 1 && c2 < 1, `C-collation index should take under 1 ms: ${c1}, ${c2}`);
assert.match(s, /C-collation index.*prefix "a" \| show more  \|.*\| Limit > Index Scan\n/);

const cl = ok(run('pagination/08-search-client-test.mjs'));
assert.match(cl, /keystrokes 5 \| requests sent 2 \| results rendered \["anish"\]/);

const c = ok(run('pagination/03-run.mjs'));
assert.match(c, /contains %1234%, same index .*Seq Scan/);
assert.match(c, /contains %1234%, trigram GIN index .*Bitmap Index Scan/);

const e = ok(run('pagination/05-verify-extras.mjs'));
assert.match(e, /ICU collation, plain index .*\| Limit > Seq Scan/);
assert.match(e, /ICU collation, pattern_ops index .*\| Limit > Index Scan/);
assert.match(e, /input "%" raw -> 300000 rows \| escaped -> 0 rows/);
assert.ok(grab(e, /fastupdate=off .* ([\d]+) ms/) > grab(e, /fastupdate=on .* ([\d]+) ms/), 'turning the pending list off should slow inserts');

const x = ok(run('pagination/06-verify-extras.mjs'));
assert.ok(grab(x, /pending list full .*Execution Time: ([\d.]+) ms/) > grab(x, /after VACUUM .*Execution Time: ([\d.]+) ms/));
const n = ok(run('pagination/09-small-checks.mjs'));
assert.match(n, /collation en_US.UTF-8, plain index, prefix LIKE: .*Seq Scan/);
console.log(`P4 verified: one-letter search ${pat1}/${pat2} ms with the pattern index, ${c1}/${c2} ms with the C index`);
