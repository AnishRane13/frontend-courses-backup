// Verifies E1: a CPU-heavy request on the main thread makes a health check wait and shows a large event-loop delay;
// the same work in a worker pool leaves the health check fast and the loop delay small.
// The server runs in a child process, so the client timing it is never blocked by the server's work.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

const WORK_MS = 1500;

if (process.argv[2] === 'server') {
  const express = (await import('express')).default;
  const { buildReport } = await import('./cpu.mjs');
  const { closePool, runReport } = await import('./report-pool.mjs');
  // Lag probe: a timer that should fire every 50 ms; any extra wait is time the loop was blocked.
  let maxLagMs = 0;
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 50);
    last = now;
  }, 50);
  let elu = performance.eventLoopUtilization();
  const app = express();
  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/report-main', (req, res) => res.json(buildReport({ ms: Number(req.query.ms), id: 'main' })));
  app.get('/report-worker', async (req, res) => res.json(await runReport({ ms: Number(req.query.ms), id: 'worker' })));
  app.post('/loop-delay/reset', (req, res) => { maxLagMs = 0; elu = performance.eventLoopUtilization(); res.end(); });
  app.get('/loop-delay', (req, res) => res.json({ maxMs: maxLagMs, utilization: performance.eventLoopUtilization(elu).utilization }));
  const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
  process.on('message', async () => { server.close(); server.closeAllConnections(); clearInterval(probe); await closePool(); process.disconnect(); });
} else {
  const child = fork(import.meta.filename, ['server']);
  const [{ port }] = await once(child, 'message');
  const base = `http://127.0.0.1:${port}`;
  try {
    // Starts a report, sends a health check 100 ms later, and times the health check.
    const healthDuring = async (route) => {
      await fetch(base + '/loop-delay/reset', { method: 'POST' });
      const report = fetch(`${base}${route}?ms=${WORK_MS}`).then((r) => r.json());
      await sleep(100);
      const t = performance.now();
      const health = await fetch(base + '/health').then((r) => r.json());
      const healthMs = performance.now() - t;
      const result = await report;
      assert.equal(health.ok, true);
      assert.ok(result.rounds > 0);
      await sleep(100); // let the lag probe fire once after the stall
      const { maxMs, utilization } = await fetch(base + '/loop-delay').then((r) => r.json());
      return { healthMs, maxDelayMs: maxMs, utilization };
    };

    await fetch(base + '/health'); // warm up
    const main = await healthDuring('/report-main');
    const worker = await healthDuring('/report-worker');
    console.log(`main thread: health waited ${main.healthMs.toFixed(0)} ms, max loop delay ${main.maxDelayMs.toFixed(0)} ms, loop busy ${(main.utilization * 100).toFixed(0)}%`);
    console.log(`worker pool: health waited ${worker.healthMs.toFixed(0)} ms, max loop delay ${worker.maxDelayMs.toFixed(0)} ms, loop busy ${(worker.utilization * 100).toFixed(0)}%`);
    assert.ok(main.healthMs > 1000, 'on the main thread the health check waits for most of the report');
    assert.ok(main.maxDelayMs > 1000, 'and the event-loop delay shows the stall');
    assert.ok(worker.healthMs < 300, 'in a worker the health check answers quickly');
    assert.ok(worker.maxDelayMs < 300, 'and the event loop stays responsive');
    assert.ok(main.utilization > 0.6, 'the main-thread report keeps the loop busy');
    assert.ok(worker.utilization < 0.3, 'the worker report leaves the loop mostly idle');

    // Pool of two: two reports run side by side, a third waits in the queue.
    const t = performance.now();
    await Promise.all([1, 2, 3].map(() => fetch(`${base}/report-worker?ms=500`).then((r) => r.json())));
    const threeMs = performance.now() - t;
    console.log(`three 500 ms reports on a pool of two took ${threeMs.toFixed(0)} ms`);
    assert.ok(threeMs > 950, 'the third report queues behind the first two');
    assert.ok(threeMs < 1450, 'the first two ran in parallel');
  } finally {
    child.send('stop');
  }
  await once(child, 'exit');

  // Microtasks drain after each callback, not only between phases (lesson 29 has this wrong).
  const order = [];
  setTimeout(() => { order.push('timer 1'); Promise.resolve().then(() => order.push('microtask 1')); }, 5);
  setTimeout(() => { order.push('timer 2'); Promise.resolve().then(() => order.push('microtask 2')); }, 5);
  await sleep(50);
  assert.deepEqual(order, ['timer 1', 'microtask 1', 'timer 2', 'microtask 2']);
  console.log('E1 claims hold');
}
