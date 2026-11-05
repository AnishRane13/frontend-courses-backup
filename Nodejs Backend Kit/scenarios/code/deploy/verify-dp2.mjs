// DP2: memory limits. Checks:
// 1. a heap size flag changes v8.getHeapStatistics().heap_size_limit (old space plus young generation),
//    so 384 MiB of old space reports more than 512 MiB and 768 MiB reports over 90 percent of 1 GiB,
//    while 256 MiB of old space with a 16 MiB semi space stays near 300 MiB;
// 2. a process with a small old space dies with "JavaScript heap out of memory" by abort
//    (signal SIGABRT, which a shell reports as exit code 134), and no handler runs;
// 3. Buffer memory is outside the V8 heap limit: a 32 MiB old space can hold a 128 MiB Buffer.
// The kernel OOM kill (exit 137) needs a container memory limit and is not tested here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const node = (args, code) => spawnSync(process.execPath, [...args, '-e', code], { encoding: 'utf8', timeout: 120_000 });
const MiB = 2 ** 20;

// 1. Reading the effective heap limit.
const readLimit = 'console.log(require("v8").getHeapStatistics().heap_size_limit)';
const defaultLimit = Number(node([], readLimit).stdout) / MiB;
const limit64 = Number(node(['--max-old-space-size=64'], readLimit).stdout) / MiB;
assert.ok(limit64 >= 64, 'heap_size_limit includes the 64 MiB old space');
assert.ok(limit64 < defaultLimit, 'the flag lowers the limit');
assert.ok(limit64 - 64 > 0, 'heap_size_limit is more than the old space alone (young generation is added)');
const limitFor = (mib) => Number(node([`--max-old-space-size=${mib}`], readLimit).stdout) / MiB;
const limit384 = limitFor(384), limit768 = limitFor(768);
assert.equal(limit64, 256, 'on this machine 192 MiB of young generation is added to the old space');
const capped = Number(node(['--max-old-space-size=256', '--max-semi-space-size=16'], readLimit).stdout) / MiB;
assert.ok(capped <= 320, 'capping the semi space too keeps a 256 MiB old space near 300 MiB of heap limit');
assert.ok(limit384 > 512, 'a 384 MiB old space reports a heap limit above a 512 MiB container');
assert.ok(limit768 > 0.9 * 1024, 'a 768 MiB old space reports a heap limit over 90 percent of 1 GiB');
console.log(`heap_size_limit: default ${defaultLimit} MiB, old space 64 -> ${limit64}, 384 -> ${limit384}, 768 -> ${limit768} MiB, 256 with 16 MiB semi space -> ${capped} MiB`);

// 2. Heap OOM: an abort, not an exception.
const leak = `
  process.on('uncaughtException', () => { console.log('HANDLER RAN'); });
  process.on('exit', () => { console.log('EXIT LISTENER RAN'); });
  const keep = [];
  try { for (;;) keep.push({ id: keep.length, payload: 'x'.repeat(64) + keep.length }); }
  catch { console.log('CATCH RAN'); }`;
const direct = node(['--max-old-space-size=32'], leak);
assert.equal(direct.status, null, 'no normal exit code');
assert.equal(direct.signal, 'SIGABRT', 'V8 aborts the process');
assert.match(direct.stderr, /JavaScript heap out of memory/);
assert.doesNotMatch(direct.stdout, /HANDLER RAN|EXIT LISTENER RAN|CATCH RAN/, 'no catch, handler or exit listener runs');

const viaShell = spawnSync('sh', ['-c', `"${process.execPath}" --max-old-space-size=32 -e "$CODE" 2>/dev/null; echo "exit=$?"`],
  { encoding: 'utf8', env: { ...process.env, CODE: leak }, timeout: 120_000 });
assert.match(viaShell.stdout, /exit=134/, 'a shell (or a container runtime) reports 128 + 6 = 134');
console.log('heap OOM: SIGABRT, shell exit code 134, "JavaScript heap out of memory"');

// 3. Buffers live outside the V8 heap limit.
const buf = node(['--max-old-space-size=32'], `
  const b = Buffer.alloc(128 * 2 ** 20); b.fill(1);
  const m = process.memoryUsage();
  console.log(JSON.stringify({ heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers, rss: m.rss,
    limit: require('v8').getHeapStatistics().heap_size_limit }));`);
assert.equal(buf.status, 0, 'a 128 MiB Buffer does not crash a 32 MiB old space');
const m = JSON.parse(buf.stdout);
assert.ok(m.arrayBuffers >= 128 * MiB, 'the Buffer is counted in arrayBuffers');
assert.ok(m.heapUsed < 32 * MiB, 'and not in heapUsed');
assert.ok(m.rss >= 128 * MiB, 'the written Buffer pages count in rss, the number a container limit sees');
console.log(`buffer: heapUsed ${(m.heapUsed / MiB).toFixed(1)} MiB, arrayBuffers ${(m.arrayBuffers / MiB).toFixed(0)} MiB, rss ${(m.rss / MiB).toFixed(0)} MiB, heap limit ${(m.limit / MiB).toFixed(0)} MiB`);
console.log('verify-dp2: all claims hold');
