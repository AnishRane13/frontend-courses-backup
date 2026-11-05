// A3: 202 with Location, Retry-After while queued, done with a URL later.
import assert from 'node:assert/strict';
import { run } from '../lib/run.mjs';
const r = run('api-design/03-run-async-jobs.mjs');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /POST \/exports\s+202 \| Location: \/exports\/<id>/);
assert.match(r.stdout, /GET status \+0ms\s+200 \{"id":"<id>","status":"queued"\} \| Retry-After: 2/);
assert.match(r.stdout, /GET status \+400ms\s+200 \{"id":"<id>","status":"done","url":"\/files\/<id>.csv"\}/);
console.log('A3 verified');
