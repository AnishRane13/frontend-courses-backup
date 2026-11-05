// P3: ties overlap pages, the id tiebreaker, allow-list, matching index, directions, join sort, NULL cursor, sort by parameter.
import assert from 'node:assert/strict';
import { run, grab } from '../lib/run.mjs';
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout; };

const c = ok(run('pagination/03-run.mjs'));
assert.ok(grab(c, /ORDER BY total DESC\s+rows on both page 1 and 2: (\d+)/) > 0, 'sorting by total alone should overlap');
assert.equal(grab(c, /ORDER BY total DESC, id DESC\s+rows on both page 1 and 2: (\d+)/), 0);
assert.match(c, /no matching index .*> Sort > /);
assert.match(c, /index \(status, total, id\) .*\| Limit > Index Only Scan\n/);

const e = ok(run('pagination/05-verify-extras.mjs'));
assert.match(e, /ASC, ASC \(all flipped\) .*Index Only Scan Backward/);
assert.match(e, /mixed: total DESC, id ASC .*Incremental Sort/);
assert.match(e, /ORDER BY customers.name .*Sort > Hash Join > .*Seq Scan/);
assert.match(e, /rows after a NULL cursor \(NULL, 5\): \(none\)/);
assert.match(e, /with coalesce\(score, -1\), after \(30, 1\): 2, 4, 5, 3/);

const s = ok(run('pagination/09-small-checks.mjs'));
assert.match(s, /ORDER BY \$1 with "total": 1, 2, 3 \|/);

const l = ok(run('pagination/sort-allowlist.mjs'));
assert.match(l, /"-total"\s+-> ORDER BY total DESC, id DESC/);
assert.match(l, /"passwordHash"\s+-> null/);
assert.match(l, /"total; DROP TABLE orders"\s+-> null/);

const v = ok(run('errors/01-run-validation.mjs'));
assert.match(v, /repeated key \?page=1&page=2\s+200 \{"page":\["1","2"\]/);
console.log('P3 verified: ties overlap without the id, none with it; index, directions, join, NULL and allow-list checks pass');
