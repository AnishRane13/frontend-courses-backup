// V2: one problem+json shape, bugs hidden, parser errors mapped, Express 5 vs 4 async throw, 23505 mapped to 409.
import assert from 'node:assert/strict';
import { run } from '../lib/run.mjs';
const r = run('errors/02-run-error-handler.mjs');
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /known 404 \(async\)\s+404 application\/problem\+json .*"code":"ORDER_NOT_FOUND"/);
assert.match(r.stdout, /bug in async route\s+500 application\/problem\+json .*"title":"Internal Server Error"/);
assert.match(r.stdout, /broken JSON\s+400 application\/problem\+json .*"code":"entity.parse.failed"/);
assert.match(r.stdout, /body too large\s+413 application\/problem\+json/);
assert.match(r.stdout, /unknown route\s+404 application\/problem\+json .*"code":"NOT_FOUND"/);
assert.match(r.stdout, /unexpected error: Cannot read properties of undefined/);
const e5 = run('errors/express-async-crash.mjs', ['express'], { cacheMinutes: 0 });
assert.equal(e5.status, 0); assert.match(e5.stdout, /express response: 500 \{"handled":"db down"\}/);
const e4 = run('errors/express-async-crash.mjs', ['express4'], { cacheMinutes: 0 });
assert.equal(e4.status, 1, 'Express 4 should crash the process'); assert.match(e4.stderr, /Error: db down/);
const s = run('errors/03-small-checks.mjs');
assert.match(s.stdout, /code: '23505'/); assert.match(s.stdout, /mapped to: \{ status: 409, code: 'EMAIL_TAKEN' \}/);
console.log('V2 verified');
