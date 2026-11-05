// P1: keyset vs offset, Date cursor bug, inserts while paging, Mongo range cursor, partition pruning.
import assert from 'node:assert/strict';
import { run, grab } from '../lib/run.mjs';
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r.stdout; };

const a = ok(run('pagination/01-run.mjs'));
const deep = grab(a, /OFFSET page 250000\s+Execution Time: ([\d.]+) ms/);
const keyset = grab(a, /KEYSET near the end\s+Execution Time: ([\d.]+) ms/);
assert.ok(deep > 1000, `deep offset page should take over a second, got ${deep} ms`);
assert.ok(keyset < 1, `keyset should take well under a millisecond, got ${keyset} ms`);
assert.match(a, /page 2 ids \[ '4', '5', '6' \]/);
assert.match(a, /limit=5000 -> 422/);
assert.match(a, /bad cursor -> 422/);

const b = ok(run('pagination/02-cursor-precision.mjs'));
assert.match(b, /cursor from JS Date\s+: 1, 4\n/);
assert.match(b, /cursor from ::text\s+: 1, 2, 3, 4\n/);

const c = ok(run('pagination/03-run.mjs'));
assert.match(c, /offset page 1 \[ '1', '2', '3' \] then a new order arrives; offset page 2 \[ '3', '4', '5' \]/);
assert.match(c, /keyset page 2 after the same insert \[ '4', '5', '6' \]/);

const m = ok(run('pagination/04-mongo.mjs'));
assert.match(m, /skip page 10,000 .*\| keys 200000 \|/);
assert.match(m, /range cursor, same depth .*\| keys 21 \|/);

const p = ok(run('pagination/06-verify-extras.mjs'));
assert.match(p, /row comparison only .*months scanned: 06,05\n/);
assert.match(p, /plus created_at <= cursor .*months scanned: 05\n/);
console.log(`P1 verified: deep offset ${deep} ms, keyset ${keyset} ms, Date cursor skips rows, Mongo skip walks 200000 keys`);
