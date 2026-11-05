// V1: strict schema rejects role, fields picked by name, parser errors, strip mode, Express 5 req.query getter, __proto__.
import assert from 'node:assert/strict';
import { run } from '../lib/run.mjs';
const r = run('errors/01-run-validation.mjs');
assert.equal(r.status, 0, r.stderr);
const o = r.stdout;
assert.match(o, /extra role: admin\s+422 .*Unrecognized key: \\"role\\"/);
assert.match(o, /stored roles: \[ 'user' \] \| stored keys: \[ 'email', 'passwordHash', 'name', 'role' \]/);
assert.match(o, /broken JSON\s+400/);
assert.match(o, /body too large\s+413/);
assert.match(o, /strip mode output: \{"name":"Asha"\}/);
assert.match(o, /assign req.query \(Express 5\)\s+500 .*only a getter/);
const s = run('errors/03-small-checks.mjs');
assert.equal(s.status, 0, s.stderr);
assert.match(s.stdout, /strict schema: rejected: Unrecognized key: "__proto__"/);
assert.match(s.stdout, /Object.assign\(\{\}, body\).isAdmin: true \| \(\{\}\).isAdmin: undefined/);
console.log('V1 verified');
