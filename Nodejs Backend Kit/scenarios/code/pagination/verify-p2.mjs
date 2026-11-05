// P2: exact vs estimated vs capped count, MVCC counts, estimate freshness, slot counter, Mongo counts.
import assert from 'node:assert/strict';
import { run, grab } from '../lib/run.mjs';
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout; };

const c = ok(run('pagination/03-run.mjs'));
const exact = grab(c, /exact count\(\*\)\s+([\d.]+) ms/);
const capped = grab(c, /capped count \(10,001\)\s+([\d.]+) ms \{"n":10001\}/);
const estimate = grab(c, /planner estimate \(reltuples\)\s+([\d.]+) ms/);
assert.ok(exact / capped > 5, `capped count should be more than five times faster: exact ${exact}, capped ${capped}`);
assert.ok(estimate < exact, 'the estimate should be cheaper than the exact count');

const x = ok(run('pagination/06-verify-extras.mjs'));
const [, aNow, bNow, aStart] = x.match(/A \(open transaction\): (\d+) \| B \(after its insert\): (\d+) \| A at start: (\d+)/).map(Number);
assert.equal(aNow, aStart); assert.equal(bNow, aStart + 1);
const one = grab(x, /one row\s+total 4000 \| (\d+) ms/);
const slots = grab(x, /16 slots\s+total 4000 \| (\d+) ms/);
assert.ok(slots * 3 < one, `16 slot rows should be much faster than one row: ${slots} vs ${one} ms`);

const s = ok(run('pagination/09-small-checks.mjs'));
assert.match(s, /after inserting 200,000 more, no ANALYZE: 100000\n/);
assert.match(s, /after ANALYZE again: 300000\n/);

const m = ok(run('pagination/07-mongo-extras.mjs'));
const cd = grab(m, /countDocuments\(\{\}\)\s+([\d.]+) ms/);
const est = grab(m, /estimatedDocumentCount\(\)\s+([\d.]+) ms/);
assert.ok(est < cd, 'estimatedDocumentCount should be faster than countDocuments');
assert.match(m, /a paid filter with no index examines 200000 docs/);
console.log(`P2 verified: exact ${exact} ms vs capped ${capped} ms, slots ${slots} ms vs one row ${one} ms`);
