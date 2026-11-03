---
title: "Worker threads"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/worker-threads
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Worker threads

*10 min read · Updated 24 Jul 2026 Topic 62 of 70 Bookmark Mark done Why it matters Node · Topic 62 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/worker-threads](https://www.geekyfrontend.in/learn/nodejs-backend-kit/worker-threads)

---

## Say it in 30 seconds

Worker threads run your JavaScript on extra threads inside the same process, each with its own event loop and its own heap, so a heavy calculation does not freeze the thread that is serving requests. They exist because async and await only help while you are waiting on input or output. A password hash or a huge parse still runs on the main thread and stalls everyone else. The trade-off is that starting a thread is expensive, so you keep a fixed pool and reuse it, and by default messages are copied rather than shared.

## Why it matters

Node's event loop is fast at juggling waiting: files, databases, HTTP. None of that occupies the CPU, so one thread can shepherd thousands of concurrent operations. The moment a request must compute, hash a password, resize an image, parse a large CSV, run a regex over huge input, or do cryptography, that work runs on the main thread. While it runs, the event loop is frozen and every other request stalls. That is blocking the event loop.

`worker_threads` runs JavaScript on additional threads inside the same process, so the CPU work happens off the main thread. Async and await do nothing for CPU-bound code. They only help you wait.

## The concept, simply

A worker thread is a separate JavaScript environment on its own operating-system thread, inside the same process. Each worker gets its own V8 isolate: its own event loop, its own task queues, and its own heap. Ordinary objects are not shared, so you do not get the classic data race on a normal object.

Threads pass messages through a `MessagePort`, `worker.postMessage()` and `parentPort.on('message')`. By default a message is copied with the structured clone algorithm. If the copy is too expensive, you can transfer an `ArrayBuffer`, handing over ownership with no copy so the sender loses access, or use a `SharedArrayBuffer`, which both threads can read and write, coordinated with `Atomics`.

![Side-by-side comparison of worker_threads sharing one process and heap versus cluster forking separate processes with isolated memory](assets/i59_01_9e938b47.svg)

worker_threads live in one process and can share memory; cluster spawns separate processes that share nothing but a port.

Cluster is many processes for input and output throughput. Worker threads are many threads for CPU work. A big service can cluster for concurrency and use a pool of workers for the occasional heavy job.

## How it works

You create a worker with `new Worker(filename, { workerData })`. Node starts a thread, creates a fresh V8 isolate, and runs that file from scratch. Modules are not shared, so the worker imports what it needs. `workerData` is structured-cloned in at start as the initial input. After that, the two sides exchange messages.

![Three panels showing copy via structured clone transfer of an ArrayBuffer and true sharing via SharedArrayBuffer](assets/i59_02_11cad794.svg)

Copy is safe but scales with payload size; transfer hands over an ArrayBuffer with zero copy; SharedArrayBuffer is real shared memory coordinated with Atomics.

- **Copy, the default.** `postMessage(obj)` deep-clones the object. Simple and safe. Cloning hundreds of megabytes defeats the purpose.
- **Transfer, zero copy.** `postMessage(buf, [buf.buffer])` moves an `ArrayBuffer` to the other thread. The sender's buffer is detached and unusable. Use it to hand a large binary payload one way.
- **Share.** A `SharedArrayBuffer` is mapped into both threads. Both can read and write at once, so you coordinate with `Atomics`: atomic loads and stores, and `Atomics.wait` and `notify`, to avoid races.

Spinning up a worker costs a new thread and a new V8 isolate, on the order of single-digit to tens of milliseconds and a few megabytes. One worker per request under load will bury you. The production pattern is a worker pool: a fixed set of long-lived workers pulling jobs from a queue. You pay start-up once. Libraries such as `piscina` provide a pool, or you can write a small one.

Some of Node's own async APIs already use libuv's thread pool without worker threads: `crypto.pbkdf2`, `zlib`, `fs`, and `crypto.randomBytes`. If a heavy operation has an async built-in, prefer it. Worker threads are for your JavaScript computation that has no such offload.

## Code examples

Offload a CPU-bound calculation so the main thread's event loop stays responsive.

javascript

```
// main.js
import { Worker } from 'node:worker_threads';

function runHeavyJob(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./heavy.js', { workerData: input });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with code ${code}`));
    });
  });
}

// The event loop keeps serving requests while this runs on another thread.
const result = await runHeavyJob({ n: 45 });
console.log('fib:', result);
```

javascript

```
// heavy.js — runs on its own thread with its own heap
import { workerData, parentPort } from 'node:worker_threads';

function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }

const answer = fib(workerData.n);   // blocks THIS thread only
parentPort.postMessage(answer);     // send the result back, then exit
```

A minimal reusable worker **pool** — the pattern you actually ship. Fixed workers, a task queue, one worker per job at a time.

javascript

```
// pool.js — tiny fixed-size worker pool that survives crashing workers
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export class Pool {
  #file;
  #workers = new Set();
  #idle = [];
  #queue = [];
  #inFlight = new Map();   // worker -> { data, resolve, reject }
  #closed = false;
  constructor(file, size = availableParallelism()) {
    this.#file = file;
    for (let i = 0; i < size; i++) this.#spawn();
  }
  #spawn() {
    const worker = new Worker(this.#file);
    this.#workers.add(worker);
    worker.on('message', (result) => {
      const task = this.#inFlight.get(worker);
      this.#inFlight.delete(worker);
      this.#idle.push(worker);               // healthy: back to the idle list
      task?.resolve(result);
      this.#pump();
    });
    worker.on('error', (err) => {            // uncaught exception in the worker; 'exit' follows
      this.#inFlight.get(worker)?.reject(err);
      this.#inFlight.delete(worker);
    });
    worker.on('exit', (code) => {            // crash, process.exit() or terminate()
      this.#inFlight.get(worker)?.reject(new Error(`Worker stopped with code ${code}`));
      this.#inFlight.delete(worker);
      this.#workers.delete(worker);
      this.#idle = this.#idle.filter((w) => w !== worker);  // never hand out a dead worker
      if (!this.#closed) { this.#spawn(); this.#pump(); }    // replace it, keep the queue moving
    });
    this.#idle.push(worker);
  }
  run(data) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ data, resolve, reject });
      this.#pump();
    });
  }
  #pump() {
    while (this.#queue.length && this.#idle.length) {
      const worker = this.#idle.pop();
      const task = this.#queue.shift();
      this.#inFlight.set(worker, task);
      worker.postMessage(task.data);
    }
  }
  async close() {
    this.#closed = true;
    await Promise.all([...this.#workers].map((w) => w.terminate()));
  }
}
```

What the pool does when a worker dies in the middle of a task:

1. `run()` queues the job; `#pump()` hands it to an idle worker and records it in `#inFlight`.
2. If the worker throws, `'error'` fires and the in-flight task is rejected with that error. (A worker that calls `process.exit()` or is terminated skips this step.)
3. `'exit'` fires: a task still in flight is rejected with the exit code, and the worker is removed from `#workers` and `#idle`, so it is never handed another job.
4. Unless the pool is closing, a replacement worker is spawned and `#pump()` runs, so the queued jobs keep moving.

The worker file the pool runs — long-lived, one job per message:

javascript

```
// task.js — pool worker: long-lived, handles one job per message
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (job) => {
  const end = Date.now() + 50; while (Date.now() < end);   // ~50 ms of CPU work
  if (job.crash === 'throw') throw new Error('boom in worker'); // uncaught error mid-task
  if (job.crash === 'exit') process.exit(1);                 // worker killed mid-task
  parentPort.postMessage(job.n * 2);
});
```

A test that kills workers mid-task (one calls `process.exit(1)`, one throws) and checks that every other job still completes:

javascript

```
// pool.test.js — kill workers mid-task and check the queue keeps moving
import { Pool } from './pool.js';
const pool = new Pool(new URL('./task.js', import.meta.url), 2);
const jobs = [{ n: 1 }, { n: 2, crash: 'exit' }, { n: 3 }, { n: 4, crash: 'throw' }, { n: 5 }, { n: 6 }, { n: 7 }];
const withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('still pending after 2 s')), 2000))]);
const results = await Promise.allSettled(jobs.map((j) => withTimeout(pool.run(j))));
results.forEach((r, i) => console.log(`job ${jobs[i].n}${jobs[i].crash ? ` (${jobs[i].crash})` : ''}:`.padEnd(15), r.status === 'fulfilled' ? r.value : `rejected — ${r.reason.message}`));
await pool.close();
process.exit(0);

// Real output (Node v24.19.0):
//   job 1:          2
//   job 2 (exit):   rejected — Worker stopped with code 1
//   job 3:          6
//   job 4 (throw):  rejected — boom in worker
//   job 5:          10
//   job 6:          12
//   job 7:          14
//
// Same test against the earlier version of this pool:
//   job 2 (exit):   rejected — still pending after 2 s     (exit never handled: task hangs forever)
//   job 4 (throw):  rejected — boom in worker
//   job 5, 6, 7:    rejected — still pending after 2 s     (dead worker was put back in the idle list)
```

> **Why this was wrong:** the earlier pool pushed a worker back into the idle list even after its `'error'` event — but a worker that throws an uncaught error is dead, so every job later handed to it waited forever. It also never listened for `'exit'`, so a worker that called `process.exit()` (or was terminated) left its task pending, and the `'message'` listener of a failed task was never removed. A pool must reject the in-flight task, drop or replace the dead worker, and keep pumping the queue.

Real shared memory with `SharedArrayBuffer` and `Atomics` — multiple threads incrementing one counter safely.

javascript

```
// Shared counter across threads (no copy, no message per update)
import { Worker, isMainThread, workerData } from 'node:worker_threads';

if (isMainThread) {
  const shared = new SharedArrayBuffer(4);       // 4 bytes = one Int32
  const view = new Int32Array(shared);
  for (let i = 0; i < 4; i++) new Worker(new URL(import.meta.url), { workerData: shared });
  setTimeout(() => console.log('total:', Atomics.load(view, 0)), 500);
} else {
  const view = new Int32Array(workerData);
  for (let i = 0; i < 100000; i++) Atomics.add(view, 0, 1);  // atomic += 1
}
```

## Common mistakes & gotchas

- **Creating a worker per request.** Start-up is expensive. Use a fixed pool and reuse workers.
- **Expecting shared variables by default.** A module-level variable in the worker is not the object in main. Only `SharedArrayBuffer` is truly shared. Everything else is copied or transferred.
- **Using a buffer after you transfer it.** The sender's buffer is detached. Transfer is a hand-off.
- **Using worker threads for input and output.** That work is already non-blocking on the main thread. Threading it adds overhead. Use worker threads for CPU-bound JavaScript, and cluster or plain async I/O for concurrency.
- **Forgetting to terminate workers.** Leaked workers keep threads and memory alive and can stop the process from exiting. Call `worker.terminate()`, or bound the pool and clean it up on shutdown.
- **Ignoring `'error'` and a non-zero `'exit'`.** An uncaught throw in a worker is an `'error'` event, not a rejected promise, unless you wire it up.
- **Races on `SharedArrayBuffer` without `Atomics`.** Plain reads and writes across threads are not safe. Use `Atomics` for the data and for wait and notify.

## Best practices

- **Pool, do not spawn per task.** Use `piscina` or a small fixed pool sized to `availableParallelism()`.
- **Send inputs and return outputs.** Transfer `ArrayBuffer`s for large binary data. Share a `SharedArrayBuffer` only when both threads need live access.
- **Prefer built-in async offloads first.** `zlib`, `crypto.pbkdf2`, and async `fs` already use libuv's pool.
- **Keep workers pure where you can:** input in, result out, so they are easy to pool and restart.
- **Handle `error` and `exit`, and set timeouts,** so a stuck job does not leak a worker.
- **Measure before threading.** If the payload is tiny, or an async built-in exists, the worker can cost more than it saves.

## ⭐ Interview lens

> **Q: worker\_threads vs cluster — what's the real difference and when do you use each?**  
> A: Cluster forks separate processes that share one listening port, so more connections can be served across cores. Those processes share no memory. Worker threads start threads inside one process so CPU-bound JavaScript runs off the main thread, and they can share memory through a `SharedArrayBuffer`. Each worker has its own V8 isolate, its own event loop, and its own heap, so blocking one thread does not block the other's loop. You create one with `new Worker(filename, { workerData })`, and you talk with `postMessage`. The default message is a structured-clone copy. For example, cluster is how you take an 8-core box from one busy core to one worker per core for an API that mostly waits on the database. A resize or a huge parse on the request path belongs on a worker thread so the event loop keeps accepting. The limit is using one as the other. Worker threads do not share a port or multiply your HTTP capacity by themselves. Cluster does not speed up a single heavy calculation. A large service can do both.

> **Q: Does async/await help with CPU-bound work?**  
> A: No. `async` and `await` only help while the function is waiting, which is input and output. A synchronous computation still runs to completion on the current thread. The event loop cannot serve anyone else until that function returns, and wrapping it in async does not move it. Worker threads, a job queue, or an external service are what get that work off the main thread. Some Node APIs already escape without worker threads: `crypto.pbkdf2`, `zlib`, async `fs`, and `crypto.randomBytes` run on libuv's thread pool. For example, a function that loops over a giant string and is marked async still freezes `/health` checks until the loop ends. The limit of the short answer "use workers" is those built-ins. If the operation has an async form, prefer it. Worker threads are for your own JavaScript that has nowhere else to go, and even then you want a pool, because creating a thread per call costs milliseconds and megabytes.

> **Q: How do you share data with a worker without copying it?**  
> A: `postMessage` copies by default, using structured clone, and the cost grows with the payload. Two ways avoid the copy. Transfer an `ArrayBuffer` by passing it in the transfer list, `postMessage(buf, [buf.buffer])`. Ownership moves, no bytes are copied, and the sender's buffer is detached, so reading it afterward throws or yields empty. Or allocate a `SharedArrayBuffer`, which is mapped into both threads so both can read and write the same memory. That is real sharing, so you coordinate with `Atomics` or you will race. For example, hand a large image buffer to a resize worker with the transfer list, and use a shared `Int32Array` plus `Atomics.add` only when two threads must update one counter live. The limit is treating transfer as share. After the hand-off the sender must not touch that buffer. And sharing without `Atomics` is how you get torn writes. Copy remains the right default for small objects.

> **Q: Why is creating a worker per request a bad idea?**  
> A: Each worker needs a new operating-system thread and a new V8 isolate. That start-up is single-digit to tens of milliseconds and a few megabytes, and modules are loaded again because they are not shared with the parent. Under load, one worker per request spends more time starting threads than doing the job, and leaked workers can keep the process from exiting. The production pattern is a pool: a fixed number of long-lived workers, sized around `availableParallelism()`, pulling jobs from a queue. `piscina` is one library that does this. You can also write a small pool. For example, a burst of image uploads should queue onto the same four workers, not spawn four hundred. The limit of a pool is a stuck job. Handle the worker's `'error'` event and non-zero `'exit'`, set a timeout, and replace a dead worker. An uncaught throw in the worker is an event, not a rejected promise, unless you wire it.

## Cheat-card

- **worker_threads** are threads in one process for CPU-bound JavaScript. Each has its own loop and heap.
- Default message is a **structured-clone copy**. Transfer an `ArrayBuffer` for zero copy. `SharedArrayBuffer` plus `Atomics` is real shared memory.
- **Cluster** is processes for concurrent input and output. **Worker threads** are for computation. You can use both.
- `async` and `await` do nothing for CPU-bound code.
- Do not spawn per request. Use a **fixed pool**, such as `piscina`, sized to `availableParallelism()`.
- Prefer built-in async offloads, `zlib`, `crypto.pbkdf2`, and async `fs`, before you add threads.
- Handle `error` and `exit`. Terminate or drain the pool on shutdown.

## Good to know

- **Do worker threads share the main event loop?** No. Each worker has its own event loop, its own microtask and macrotask queues, and its own heap. Blocking one thread does not block the other. That isolation is the point.
- **Hashing passwords under signup load:** prefer `crypto.pbkdf2` or `scrypt`. They already run on libuv's thread pool. Use worker threads only for CPU-bound JavaScript that has no async built-in.
- **`resourceLimits` was added in v13.2.0.** Keys are `maxOldGenerationSizeMb`, `maxYoungGenerationSizeMb`, `codeRangeSizeMb`, and `stackSizeMb`, default 4. They cap the JavaScript heap and stack, not `Buffer` or `ArrayBuffer` memory.
- **Worker out of memory:** the worker is terminated, `'error'` has `code: 'ERR_WORKER_OUT_OF_MEMORY'`, `'exit'` gets code 1, and the main thread survives. The pool rejects the job and respawns.

---

## Learn More

- [Node.js Worker Threads (worker_threads) nodejs.org](https://nodejs.org/api/worker_threads.html)
- [Node.js Cluster module (process-level vs thread-level) nodejs.org](https://nodejs.org/api/cluster.html)
- [Multithreading in Node.js with Worker Threads Explained logicBase Labs](https://www.youtube.com/watch?v=JTl6tQ4bqYA)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 (no npm packages)*

### `resourceLimits`: capping a worker's JS engine

Every worker has its own V8 isolate, and by default that isolate may grow its heap as far as V8's own default limits allow. One runaway job (an accidental infinite `push`, a huge `JSON.parse`) can then eat memory that the main thread and the other workers need. The `resourceLimits` option of `new Worker(file, options)` (added in v13.2.0 / v12.16.0) sets limits on that one isolate. The v24 docs list four keys, all numbers:

- **`maxOldGenerationSizeMb`**: the maximum size of the main heap, in MB. The command-line flag `--max-old-space-size` overrides it.
- **`maxYoungGenerationSizeMb`**: the maximum size of a heap space for recently created objects. `--max-semi-space-size` overrides it.
- **`codeRangeSizeMb`**: the size of a pre-allocated memory range used for generated code.
- **`stackSizeMb`**: the default maximum stack size for the thread. **Default:** `4`. The docs warn that small values may make the worker unusable.

When a worker reaches one of these limits, Node terminates **that worker**, not the process. The docs add two limits of their own: the limits "only affect the JS engine, and no external data, including no `ArrayBuffer`s", and "the process may still abort if it encounters a global out-of-memory situation". Inside the worker, `require('node:worker_threads').resourceLimits` shows the values in force (on the main thread it is an empty object). From the parent, `worker.resourceLimits` shows the same values, and an empty object once the worker has stopped.

How it works:

1. The parent passes `resourceLimits` to `new Worker()`. V8 creates the worker's isolate with those heap and stack sizes.
2. The worker allocates. When its old generation is full and garbage collection cannot free enough, V8 reports a heap out-of-memory condition for that isolate only.
3. Node stops the worker thread and emits `'error'` on the `Worker` object in the parent. The error's `code` is `ERR_WORKER_OUT_OF_MEMORY` ("The `Worker` instance terminated because it reached its memory limit", in the errors docs).
4. `'exit'` follows with exit code `1`, as for any terminated worker.
5. The main thread's heap was never involved, so the parent keeps running and can start a new worker.

A stack overflow is different: exceeding `stackSizeMb` throws an ordinary `RangeError` inside the worker, which the worker can catch. Only an uncaught one ends the worker (through the normal `'error'` path).

**Example — a worker hits its 32 MB heap limit; the main thread survives.**

javascript

```
// oom.mjs: a worker with a 32 MB old-generation limit allocates until it runs out.
import { Worker } from 'node:worker_threads';

const code = `
  const { resourceLimits } = require('node:worker_threads');
  console.log('worker limits:', JSON.stringify(resourceLimits));
  const keep = [];
  for (;;) keep.push(new Array(1e5).fill({ n: keep.length }));  // grows the JS heap forever
`;

const worker = new Worker(code, {
  eval: true,
  resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
});
worker.on('error', (err) => console.log('main got error:', err.code, '-', err.message));
worker.on('exit', (code) => {
  console.log('main got exit code:', code);
  console.log('main is still running, heap used MB:',
    Math.round(process.memoryUsage().heapUsed / 1e6));
});

// Real output (Node v24.19.0), `node oom.mjs`, then `echo $?` printed 0:
//   worker limits: {"maxYoungGenerationSizeMb":8,"maxOldGenerationSizeMb":32,"codeRangeSizeMb":0,"stackSizeMb":4}
//   main got error: ERR_WORKER_OUT_OF_MEMORY - Worker terminated due to reaching memory limit: JS heap out of memory
//   main got exit code: 1
//   main is still running, heap used MB: 5
```

The keys you did not set show their defaults as Node reports them: `stackSizeMb` 4, and `codeRangeSizeMb` 0, which leaves the code range size to V8.

**Example — `stackSizeMb` changes how deep a worker can recurse.**

javascript

```
// stack.mjs: how deep can a worker recurse with stackSizeMb 1 vs the default 4?
import { Worker } from 'node:worker_threads';

const code = `
  const { parentPort } = require('node:worker_threads');
  let depth = 0;
  function dive() { depth++; dive(); }
  try { dive(); } catch (e) { parentPort.postMessage(e.constructor.name + ' at depth ' + depth); }
`;
for (const stackSizeMb of [1, 4]) {
  const w = new Worker(code, { eval: true, resourceLimits: { stackSizeMb } });
  w.on('message', (m) => console.log(`stackSizeMb ${stackSizeMb}: ${m}`));
  await new Promise((r) => w.once('exit', r));
}

// Real output (Node v24.19.0), the same on two runs:
//   stackSizeMb 1: RangeError at depth 10348
//   stackSizeMb 4: RangeError at depth 49669
```

The depths depend on the function's frame size and the Node version; the point is that the overflow is a catchable `RangeError`, not a terminated worker.

### Handling out-of-memory in the worker pool

The corrected `Pool` earlier in this lesson already does the right thing when a worker dies, whatever the cause: `'error'` rejects the task in flight, `'exit'` removes the dead worker from `#workers` and `#idle`, spawns a replacement and pumps the queue. An out-of-memory worker is one more way to die, so the pool needs no new logic. It only needs a way to pass `resourceLimits` to each `new Worker()`. The change below adds an optional `options` argument and forwards it; everything else in `pool.js` stays exactly as shown above.

How it works:

1. `new Pool(file, size, { resourceLimits })` stores the options; `#spawn()` passes them to every worker, including replacements.
2. A job that leaks runs its worker into the heap limit. Node terminates that worker and emits `'error'` with `code: 'ERR_WORKER_OUT_OF_MEMORY'`. The pool's `'error'` handler rejects that job's promise with this error.
3. `'exit'` (code 1) follows. The pool drops the worker and spawns a new one with the same limits, then calls `#pump()`.
4. Jobs that were queued, or running on the other worker, finish normally. Later jobs can land on the replacement worker.

**Example — the lesson's `pool.js` with an `options` argument (the only change).**

text

```
@@ -4,17 +4,19 @@
 
 export class Pool {
   #file;
+  #options;               // forwarded to every new Worker (e.g. resourceLimits)
   #workers = new Set();
   #idle = [];
   #queue = [];
   #inFlight = new Map();   // worker -> { data, resolve, reject }
   #closed = false;
-  constructor(file, size = availableParallelism()) {
+  constructor(file, size = availableParallelism(), options = {}) {
     this.#file = file;
+    this.#options = options;
     for (let i = 0; i < size; i++) this.#spawn();
   }
   #spawn() {
-    const worker = new Worker(this.#file);
+    const worker = new Worker(this.#file, this.#options);
     this.#workers.add(worker);
     worker.on('message', (result) => {
       const task = this.#inFlight.get(worker);
```

This is `diff -u` output: the old `pool.js` block from this lesson against the patched copy used in the test below.

**Example — one job exceeds the heap limit; the pool replaces the worker and keeps serving.**

javascript

```
// mem-task.js — pool worker: doubles n, or leaks memory until its heap limit when job.leak is set
import { parentPort, threadId } from 'node:worker_threads';
parentPort.on('message', (job) => {
  if (job.leak) {
    const keep = [];
    for (;;) keep.push(new Array(1e5).fill(job));   // never returns: heap grows until the limit
  }
  parentPort.postMessage({ value: job.n * 2, threadId });
});
```

javascript

```
// oom-pool.test.js — one job blows its worker's heap limit; the pool replaces the worker
import { Pool } from './pool.js';
const pool = new Pool(new URL('./mem-task.js', import.meta.url), 2, {
  resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
});
const show = (label, r) => console.log(label.padEnd(24), r.status === 'fulfilled'
  ? `${r.value.value} on thread ${r.value.threadId}`
  : `rejected — ${r.reason.code}: ${r.reason.message}`);

const batch1 = [{ n: 1 }, { n: 2, leak: true }, { n: 3 }, { n: 4 }];
(await Promise.allSettled(batch1.map((j) => pool.run(j))))
  .forEach((r, i) => show(`batch 1, job ${batch1[i].n}${batch1[i].leak ? ' (leak)' : ''}:`, r));

const batch2 = [{ n: 5 }, { n: 6 }, { n: 7 }, { n: 8 }];   // the replacement worker takes part
(await Promise.allSettled(batch2.map((j) => pool.run(j))))
  .forEach((r, i) => show(`batch 2, job ${batch2[i].n}:`, r));

console.log('main heap used MB:', Math.round(process.memoryUsage().heapUsed / 1e6));
await pool.close();

// Real output (Node v24.19.0), `node oom-pool.test.js` (package.json has "type": "module"), exit code 0:
//   batch 1, job 1:          2 on thread 2
//   batch 1, job 2 (leak):   rejected — ERR_WORKER_OUT_OF_MEMORY: Worker terminated due to reaching memory limit: JS heap out of memory
//   batch 1, job 3:          6 on thread 2
//   batch 1, job 4:          8 on thread 2
//   batch 2, job 5:          10 on thread 3
//   batch 2, job 6:          12 on thread 2
//   batch 2, job 7:          14 on thread 2
//   batch 2, job 8:          16 on thread 2
//   main heap used MB: 6
```

The worker on thread 1 took the leaking job and died; thread 2 kept draining batch 1 while it did. Thread 3 is the replacement that the pool's `'exit'` handler spawned, and it served a job in batch 2. The main thread's heap was about 6 MB at the end (5 MB on a later run).

### Common mistakes & gotchas (additional topics)

- **Expecting `resourceLimits` to cap total memory.** It caps the worker's JS heap and stack only. `Buffer`s and other `ArrayBuffer`s are allocated outside the heap and are not counted (see the edge case below). Process-wide limits come from the container or OS.
- **Setting the limit with a command-line flag as well.** `--max-old-space-size` and `--max-semi-space-size` override `maxOldGenerationSizeMb` and `maxYoungGenerationSizeMb` for workers, so a flag in `NODE_OPTIONS` can silently replace the values you passed.
- **Treating `ERR_WORKER_OUT_OF_MEMORY` as retryable.** The same input will usually blow the same limit again. Reject the job (or send it to a dead-letter list) instead of resubmitting it in a loop.
- **Very small `stackSizeMb`.** The docs warn that small values may lead to unusable workers; a worker that cannot even load its modules fails before it runs any job.
- **No `'error'` listener on a limited worker.** An out-of-memory termination is reported as an `'error'` event; without a listener, the parent throws it as an unhandled `'error'` event and the main process dies after all.

### Edge case worked through: `Buffer` memory is not limited

A worker limited to a 32 MB old generation allocates 200 MB of `Buffer`s and finishes normally.

javascript

```
// external.mjs: Buffers live outside the JS heap, so maxOldGenerationSizeMb does not cap them.
import { Worker } from 'node:worker_threads';

const code = `
  const { parentPort } = require('node:worker_threads');
  const bufs = [];
  for (let i = 0; i < 20; i++) bufs.push(Buffer.alloc(10 * 1024 * 1024, 1));  // 200 MB of Buffers
  const m = process.memoryUsage();
  parentPort.postMessage('memoryUsage().arrayBuffers: ' + Math.round(m.arrayBuffers / 1048576) + ' MiB');
`;
const w = new Worker(code, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 32 } });
w.on('message', console.log);
w.on('error', (e) => console.log('error:', e.code));
w.on('exit', (c) => console.log('exit code:', c));

// Real output (Node v24.19.0):
//   memoryUsage().arrayBuffers: 200 MiB
//   exit code: 0
```

Each `Buffer` object on the heap is small; its 10 MiB of bytes live in memory that V8 does not count toward the old generation. That matches the docs ("no external data, including no `ArrayBuffer`s"). If your workers handle large binary data (images, file uploads), `resourceLimits` will not protect you; limit input sizes, stream the data, and set a memory limit on the container.

### ⭐ Interview lens (additional topics)

> **Q: “A worker thread runs out of memory. What happens to the main process?”**  
> A: If the worker was started with `resourceLimits`, V8 hits the limit in that worker's isolate only. Node terminates the worker, emits `'error'` with `code: 'ERR_WORKER_OUT_OF_MEMORY'`, then `'exit'` with code 1, and the main thread keeps running. A pool should reject the job in flight and spawn a replacement. *Trap:* the limits cover only the JS heap; `ArrayBuffer`/`Buffer` memory is not counted, and the docs say a global out-of-memory can still abort the whole process.

> **Q: “Which keys does `resourceLimits` accept?”**  
> A: `maxOldGenerationSizeMb` (main heap), `maxYoungGenerationSizeMb` (space for new objects), `codeRangeSizeMb` (pre-allocated range for generated code) and `stackSizeMb` (thread stack, default 4). `--max-old-space-size` and `--max-semi-space-size` override the first two.
