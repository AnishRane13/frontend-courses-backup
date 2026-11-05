// A2: deprecation headers only when the middleware runs before the old router; v2 shape.
import assert from 'node:assert/strict';
import { run } from '../lib/run.mjs';
const r = run('api-design/02-run-versioning.mjs');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /deprecation before v1\s+200 .*\| Deprecation: true \| Sunset: Wed, 30 Jun 2027/);
assert.match(r.stdout, /deprecation after v1 \(bug\)\s+200 .*\| Deprecation: null \| Sunset: null/);
assert.match(r.stdout, /v2\s+200 \{"id":7,"name":\{"first":"Asha","last":"Rao"\}/);
console.log('A2 verified');
