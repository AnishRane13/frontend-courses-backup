// V3: default crash, handled drain-and-exit, swallow keeps serving, warn flag keeps serving, lint rule flags the floating promise.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { run } from '../lib/run.mjs';
const mode = (m, node = []) => run('errors/crash-handler.mjs', [m], { node, cacheMinutes: 0 });
const d = mode('default'); assert.equal(d.status, 1);
const h = mode('handled'); assert.equal(h.status, 1); assert.match(h.stdout, /not serving any more/);
const s = mode('swallow'); assert.equal(s.status, 0); assert.match(s.stdout, /still serving after the error/);
const w = mode('default', ['--unhandled-rejections=warn']); assert.equal(w.status, 0); assert.match(w.stdout, /still serving after the error/);
const lintDir = join(import.meta.dirname, 'lint-demo');
const eslint = join(import.meta.dirname, '..', 'node_modules', '.bin', 'eslint');
const l = spawnSync(eslint, ['refresh.ts'], { cwd: lintDir, encoding: 'utf8' });
assert.equal(l.status, 1, l.stderr);
assert.match(l.stdout, /4:\d+\s+error .*@typescript-eslint\/no-floating-promises/);
assert.match(l.stdout, /1 problem \(1 error, 0 warnings\)/);
console.log('V3 verified');
