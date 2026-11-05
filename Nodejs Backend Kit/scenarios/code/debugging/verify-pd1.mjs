// PD1: memory and CPU after a deploy. Checks:
// 1. Under the same load (unique product ids), heap used after GC grows with an unbounded Map cache
//    and stays flat with a size-capped LRU cache.
// 2. A CPU profile (--cpu-prof), parsed as JSON, names the hot function (renderProduct) as the top self-time frame.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const serverFile = join(import.meta.dirname, 'cache-server.mjs');
const MiB = 2 ** 20;
const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });

function start(args, env) {
  const child = spawn(process.execPath, [...args, serverFile], { cwd: import.meta.dirname, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = new Promise((resolve) => { let out = ''; child.stdout.on('data', (d) => { out += d; const m = out.match(/port (\d+)/); if (m) resolve(Number(m[1])); }); });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, port, exited };
}
const get = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, agent }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(b)); }).on('error', reject);
});
async function load(port, from, count) {           // count requests, 10 at a time, each with a new product id
  for (let i = from; i < from + count; i += 10) await Promise.all(Array.from({ length: 10 }, (_, j) => get(port, `/product?id=p${i + j}`)));
}
const stats = async (port) => JSON.parse(await get(port, '/stats'));

async function heapGrowth(cache) {
  const s = start(['--expose-gc'], { CACHE: cache });
  const port = await s.port;
  await load(port, 0, 1000);                       // warm up: the LRU fills to its cap here
  const before = await stats(port);
  await load(port, 1000, 3000);
  const after = await stats(port);
  s.child.kill('SIGTERM');
  await s.exited;
  return { growth: (after.heapUsed - before.heapUsed) / MiB, size: after.size };
}

const unbounded = await heapGrowth('unbounded');
const lru = await heapGrowth('lru');
console.log(`heap growth over 3000 extra requests: Map ${unbounded.growth.toFixed(1)} MiB (${unbounded.size} entries), LRU ${lru.growth.toFixed(1)} MiB (${lru.size} entries)`);
assert.equal(unbounded.size, 4000, 'the Map kept every key');
assert.equal(lru.size, 500, 'the LRU stayed at its cap');
assert.ok(unbounded.growth > 20, 'unbounded Map: heap grows with traffic');
assert.ok(lru.growth < 5, 'bounded LRU: heap stays flat');

// 2. CPU profile.
const dir = mkdtempSync(join(tmpdir(), 'pd1-prof-'));
try {
  const s = start(['--cpu-prof', `--cpu-prof-dir=${dir}`], { CACHE: 'lru' });
  const port = await s.port;
  await load(port, 0, 300);
  s.child.kill('SIGTERM');
  assert.equal(await s.exited, 0);
  const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  assert.ok(file, 'a .cpuprofile file was written');
  const prof = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const self = new Map();                          // self time per function name, from samples and timeDeltas
  prof.samples.forEach((id, i) => {
    const name = byId.get(id).callFrame.functionName || '(anonymous)';
    self.set(name, (self.get(name) ?? 0) + (prof.timeDeltas[i] ?? 0));
  });
  const ranked = [...self].filter(([n]) => !['(idle)', '(program)', '(root)', '(garbage collector)'].includes(n)).sort((a, b) => b[1] - a[1]);
  console.log('top self time:', ranked.slice(0, 3).map(([n, t]) => `${n} ${(t / 1000).toFixed(0)} ms`).join(', '));
  assert.equal(ranked[0][0], 'renderProduct', 'the profile names the hot function');
} finally { rmSync(dir, { recursive: true, force: true }); }
agent.destroy();
console.log('verify-pd1: all claims hold');
