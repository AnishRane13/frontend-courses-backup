---
title: "Blocking the Event Loop"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/blocking-event-loop
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Blocking the Event Loop

*9 min read · Updated 24 Jul 2026 Topic 10 of 70 Bookmark Mark done Why it matters Node · Topic 10 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/blocking-event-loop](https://www.geekyfrontend.in/learn/nodejs-backend-kit/blocking-event-loop)

---

## Say it in 30 seconds

Blocking the event loop means one JavaScript callback keeps running so long that Node cannot run anything else. The loop is cooperative. It does not interrupt a callback. Async I/O does not do this, because that callback returns immediately and the wait happens in the kernel or on libuv's thread pool.

This is the usual way a Node service looks fine in a single test and then freezes under load. The trade-off of the single JavaScript thread is that one slow `JSON.parse`, sync hash, or tight loop delays every other request until it returns.

Cooperative means the callback must return before the next one can start. Lag is how late a timer runs compared with when it was due.

## Why it matters

Node's speed assumes callbacks return quickly. One long synchronous stretch stops every other request, timer, and I/O completion. Health checks time out. The tail of latency blows up. A server can be 99 percent idle and still be stuck inside one function. "Fast in a single request, frozen under load" is almost always a blocked loop.

## The concept, simply

All of your JavaScript runs on one thread. The loop advances only when the current callback returns. A callback that spends 800 milliseconds of CPU freezes the loop for 800 milliseconds. Work is not lost. It is delayed. A request that should have taken 1 millisecond now waits out that whole stretch.

![Two timelines: a healthy one with many small callbacks flowing, and a blocked one where a single CPU-bound handler stalls all following requests](assets/i07_01_f1d1847e.svg)

The test is: does this callback do a lot of work without hitting an `await` or returning? If yes, it blocks for the whole stretch. A database call, an HTTP call, or an async file read does not block. The callback returns, and the kernel or the thread pool does the waiting.

## How it works

**What blocks.** A tight loop, a regex that backtracks without bound (ReDoS), a large `JSON.parse` or `JSON.stringify`, synchronous crypto such as `crypto.pbkdf2Sync` or bcrypt's sync API, `zlib.gzipSync`, and the `*Sync` file calls. `fs.readFileSync` on a large file blocks for the whole read. The async version uses the thread pool. Heavy template rendering, image or PDF work in pure JavaScript, and big sorts do the same.

**What does not.** `fs.readFile` hands the read to the pool and returns. A database driver writes to a socket and registers a callback. The loop is free until the response arrives. Blocking is your JavaScript occupying the main thread continuously. Wrapping that loop in a Promise does not move it to another thread.

**How to stay responsive.**

1. **A worker thread.** `worker_threads` is a second thread with its own V8 isolate. Run the CPU function there and post the result back.
2. **A child process or another service.** For heavy or isolated work, spawn a process or push a job onto a queue.
3. **Chunk and yield.** Split the work and schedule the next piece with `setImmediate`, so I/O runs between chunks. Total time goes up. The server stays responsive.
4. **Stream.** Parse or compress incrementally so you never chew a huge buffer in one call.

**Lag** is how late a timer fires versus when it was due.

![A timeline showing a timer's due time and its later actual run time, with the gap labelled as lag, and a note about monitorEventLoopDelay](assets/i07_02_3ff080ab.svg)

A crude measure is a self-correcting timer: schedule `setTimeout` for N milliseconds and record how much later it ran. The precise tool is `perf_hooks.monitorEventLoopDelay()`, a histogram with mean, p50, p99, and max. Watch the tail, not the mean. A calm average can hide a stall of hundreds of milliseconds.

## Code examples

**Example 1. One blocking handler stalls the server.**

javascript

```
const http = require('http');

http.createServer((req, res) => {
  if (req.url === '/block') {
    // Synchronous CPU work — freezes the loop for ~2s.
    const end = Date.now() + 2000;
    while (Date.now() < end) {}
    res.end('done blocking');
  } else {
    res.end('fast'); // normally instant...
  }
}).listen(3000);

// While ONE client hits /block, every request to '/' also hangs
// for up to 2 seconds. One handler blocks all of them.
```


**Example 2. A self-correcting timer shows lag.**

javascript

```
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = now - last - 500; // expected gap is 500ms
  if (lag > 50) console.warn(`event loop lag: ${lag}ms`);
  last = now;
}, 500);

// If some other callback blocks for 400ms, this logs ~400ms of lag.
```


**Example 3. The histogram from `perf_hooks`.**

javascript

```
const { monitorEventLoopDelay } = require('perf_hooks');

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

setInterval(() => {
  console.log('p50:', (h.percentile(50) / 1e6).toFixed(1), 'ms',
              '| p99:', (h.percentile(99) / 1e6).toFixed(1), 'ms',
              '| max:', (h.max / 1e6).toFixed(1), 'ms');
  h.reset();
}, 1000);

// Values are in nanoseconds; divide by 1e6 for milliseconds.
// A healthy idle service shows p99 well under a few ms.
```


**Example 4. Move the CPU work to a worker thread.**

javascript

```
// main.js
const { Worker } = require('worker_threads');

function hashOffMainThread(password) {
  return new Promise((resolve, reject) => {
    const w = new Worker('./hash-worker.js', { workerData: password });
    w.on('message', resolve);
    w.on('error', reject);
  });
}

// The event loop stays responsive while the worker hashes.
hashOffMainThread('secret').then((hash) => console.log('hashed:', hash));

// hash-worker.js
// const { workerData, parentPort } = require('worker_threads');
// const crypto = require('crypto');
// const out = crypto.pbkdf2Sync(workerData, 'salt', 200000, 64, 'sha512');
// parentPort.postMessage(out.toString('hex'));
```


## Common mistakes & gotchas

- **`*Sync` APIs on the request path.** `fs.readFileSync`, `crypto.pbkdf2Sync`, and `zlib.gzipSync` block for their full duration. Fine at startup. Bad per request.
- **Parsing a huge body with `JSON.parse`.** It is synchronous and grows with the payload. Limit the size, or stream.
- **A Promise does not make CPU work non-blocking.** The loop inside `.then` still runs to completion on the main thread.
- **ReDoS.** A backtracking pattern on attacker-controlled input can peg the loop. Bound the input.
- **Alerting on average lag.** The mean hides a periodic stall. Use p99 and max.
- **Putting your JavaScript on the libuv pool.** That pool is for Node's native work. Your CPU-bound JavaScript belongs in `worker_threads`.
- **Chunking with `process.nextTick`.** That does not yield to I/O. Use `setImmediate`.

## Best practices

- Treat "how long may this callback run?" as a design limit on the request path.
- Move hashing, image or PDF work, and big parses to `worker_threads`, a child process, or a queue.
- Use async I/O on the hot path. Keep `*Sync` for startup and CLIs.
- Stream large data. Enforce a body size limit.
- If you chunk a loop, yield with `setImmediate`.
- Record loop lag in production with `monitorEventLoopDelay()`, and alert on the tail.
- Load-test with concurrency. A single request will not show the block.

## ⭐ Interview lens

> **Q: Your Node service is fast in a single-request test but freezes under load. What's the likely cause?**  
> One handler is doing synchronous CPU work on the main thread: a large `JSON.parse`, sync crypto, a tight loop, a `*Sync` call, or a regex that backtracks. The loop cannot interrupt it, so every other request waits behind that callback and the tail of latency spikes. A single request looks fine because nothing else is waiting. The limit of the guess is a full libuv pool. Four slow `pbkdf2` or file calls can delay other pool work, but they do not freeze JavaScript the way a synchronous loop does. Check both.

> **Q: Does async I/O block the event loop?**  
> No. Network I/O registers the socket with the kernel and returns. Async `fs` and async crypto hand the call to the libuv thread pool and return. The loop keeps running other callbacks while that wait happens. What blocks is synchronous CPU, or a `*Sync` API, that stays on the main thread until it finishes. The limit is the callback that runs when the I/O completes. If that callback then parses a huge payload synchronously, the wait was fine and the parse still blocks.

> **Q: How do you run CPU-bound work without blocking the loop?**  
> Move it off the main thread. `worker_threads` gives you another V8 isolate for the JavaScript. A child process or a job queue fits heavier work. If the job is small, split it and schedule the next chunk with `setImmediate` so I/O runs in between. Streaming avoids holding the whole buffer at all. The limit of a brand-new worker per request is startup cost. Creating the isolate can take tens of milliseconds, so a pool of workers beats one worker per task.

> **Q: Does wrapping CPU work in a Promise make it non-blocking?**  
> No. A promise changes when the callback is scheduled, not which thread runs it. A synchronous loop inside `.then`, or before the first `await` in an async function, still runs to completion on the main thread and blocks the loop for the whole stretch. The limit is an `await` that people insert in the middle of the loop and expect to yield. `await` of an already resolved value only queues a microtask. It does not let timers or I/O in until that chain drains.

## Cheat-card

- The loop is cooperative. One long callback stalls every request.
- Blocks: tight loops, big `JSON.parse`, sync crypto or zlib, `*Sync` files, ReDoS.
- Does not block: async I/O. The callback returns at once.
- Fixes: `worker_threads`, a child process or queue, `setImmediate` chunks, streaming.
- A Promise does not move CPU work off the main thread.
- Your JavaScript does not go on the libuv pool.
- Measure with `perf_hooks.monitorEventLoopDelay()`. Alert on p99 and max, not the mean.

## Good to know

- Q: How do you measure event loop lag, and what do you watch? A self-correcting timer reports how late it fired. `perf_hooks.monitorEventLoopDelay()` gives a histogram. Watch p99 and max. On v24.19.0 each sample includes the `resolution` interval, so subtract it. An idle loop with `resolution: 20` showed min 19.12 ms, p50 20.25 ms, and max 21.00 ms.
- Q: Why `worker_threads` rather than the libuv pool for CPU work? The pool is for Node's native `fs`, crypto, and zlib. You cannot schedule arbitrary JavaScript on it. A worker is another V8 isolate. Pass messages, or share memory with `SharedArrayBuffer`.
- `new Worker` took 56 to 64 milliseconds to reach `'online'` across 5 runs on this machine. piscina 5.3.2 (`engines` node 20 or newer) keeps workers alive. Defaults from its README: `minThreads` is `os.availableParallelism()`, `maxThreads` is that times 1.5, `maxQueue: 'auto'` is `maxThreads` squared, and the default `idleTimeout` is immediate.
- Eight CPU jobs inline: one timer more than 500 ms late. Through the pool, worst lateness under 4 ms, and the jobs finished 2 to 3.5 times sooner, including the time to start 4 workers.
- `--cpu-prof` was added in v12.0.0 and is stable since v22.4.0 and v20.16.0. Default sample interval is 1000 microseconds. `--cpu-prof-interval` was added in v12.2.0. In the sample profile, `slowParse` had `hitCount` 114, all on line 4.
- 0x 6.0.0 was released 2025-07-07. Its README lists Node 20 and above. The headless run wrote a 492 KB HTML flame graph.
- clinic.js 13.0.0, last release 2023-06-28, last GitHub push 2024-09-19. The README says it is not actively maintained. Without a TTY and without `NO_INSIGHT=1` it can exit 0 and never run the script, because insight 0.11.1 returns a promise and clinic wraps it with `promisify` (`DEP0174`). `npm audit` of clinic 13.0.0 plus 0x 6.0.0 plus piscina 5.3.2 reported 24 vulnerabilities, 2 critical and 4 high, and clinic was the only direct dependency flagged.
- A 300 ms block in the same synchronous turn as `monitorEventLoopDelay().enable()` showed max 10.1 ms (not recorded) in trial 1 and 304 ms in trial 2. `compare.js` waits 50 ms after `enable()` for that reason.

---

## Learn More

- [Don't Block the Event Loop (or the Worker Pool) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Overview of Blocking vs Non-Blocking nodejs.org](https://nodejs.org/en/learn/asynchronous-work/overview-of-blocking-vs-non-blocking)
- [What the heck is the event loop anyway? | Philip Roberts | JSConf EU JSConf](https://www.youtube.com/watch?v=8aGhZQkoFbQ)
- [This is how the Node.js Event Loop really works Software Developer Diaries](https://www.youtube.com/watch?v=paI6J8my3Yw)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### Worker pools with piscina

Example 4 starts a new `Worker` per task. That pays for a fresh isolate and a module load every time, and nothing caps how many run at once. A worker pool keeps a fixed set of threads, queues tasks, and hands each task to the next idle worker. piscina is that pool. Three parts: a pool on the main thread (`new Piscina({ filename })`), a worker file whose export is the function that runs the task, and `pool.run(task)`, which structured-clones the task to an idle worker and returns a promise. If the function throws, the promise rejects.

Without a pool you either block the loop or pay startup on every request, with no backpressure. With a pool, the main thread only posts messages and tracks promises.

1. The constructor starts `minThreads` workers. The README defaults are in Good to know.
2. `pool.run(task)` queues the task. When a worker is idle, piscina posts it, by default using `Atomics` to signal faster.
3. The worker calls your function and posts the result back. piscina resolves the promise on the main thread.
4. If every worker is busy, tasks wait. The queue is unbounded unless you set `maxQueue`. `idleTimeout` is how long an idle worker lives. Set it if workers keep exiting and starting.
5. `pool.close()` waits for running tasks, then stops the threads. `pool.destroy()` stops them immediately and rejects queued tasks.

**Example. The same 8 CPU-bound jobs, inline versus piscina, with timer lateness.**

javascript

```
// fib.js — the CPU-bound task (deliberately slow recursive Fibonacci)
function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
module.exports = (n) => fib(n);
```


javascript

```
// compare.js — run 8 fib(34) jobs inline, then through piscina,
// while a histogram measures how late the main loop's timers fire.
const path = require('node:path');
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { Piscina } = require('piscina');
const fib = require('./fib.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RES = 10; // histogram samples every 10 ms; values include this interval
async function measure(label, work) {
  const h = monitorEventLoopDelay({ resolution: RES });
  h.enable();
  await sleep(50);               // let the histogram take its first samples
  const t0 = performance.now();
  await work();
  const ms = performance.now() - t0;
  await sleep(50);               // and a last one after the work
  h.disable();
  const late = (ns) => Math.max(0, ns / 1e6 - RES).toFixed(1);
  console.log(`${label.padEnd(8)} wall=${ms.toFixed(0)}ms  ` +
    `worst timer lateness=${late(h.max)}ms (${h.count} samples)`);
}

(async () => {
  const jobs = Array(8).fill(34);
  await measure('inline', async () => { for (const n of jobs) fib(n); });

  const pool = new Piscina({ filename: path.resolve(__dirname, 'fib.js'), maxThreads: 4 });
  await measure('piscina', () => Promise.all(jobs.map((n) => pool.run(n))));
  console.log('piscina', Piscina.version, '| threads:', pool.threads.length,
    '| completed:', pool.completed);
  await pool.close();
})();

// Real output (Node v24.19.0, piscina 5.3.2, 8 logical CPUs), three runs:
//   inline   wall=516ms  worst timer lateness=516.6ms (9 samples)
//   piscina  wall=149ms  worst timer lateness=0.5ms (24 samples)
//   piscina 5.3.2 | threads: 4 | completed: 8
//   inline   wall=518ms  worst timer lateness=518.7ms (9 samples)
//   piscina  wall=157ms  worst timer lateness=0.8ms (25 samples)
//   piscina 5.3.2 | threads: 4 | completed: 8
//   inline   wall=515ms  worst timer lateness=514.3ms (9 samples)
//   piscina  wall=249ms  worst timer lateness=3.9ms (33 samples)
//   piscina 5.3.2 | threads: 4 | completed: 8
```

Inline, one timer was more than 500 milliseconds late, so every request in that half-second would have waited. Through the pool, the worst lateness was under 4 milliseconds, and the jobs finished 2 to 3.5 times sooner because four cores shared them. That wall time includes starting the 4 workers.

### Profiling CPU hotspots: `--cpu-prof`, 0x and clinic.js

Lag tells you that the loop blocked. A CPU profile tells you which function did it. V8's sampling profiler interrupts the main thread at a fixed interval, 1000 microseconds by default, records the JavaScript stack, and builds a call tree. Functions in many samples are where the time went.

1. `node --cpu-prof app.js` starts the profiler at launch and writes `CPU.<date>.<time>.<pid>.<tid>.<seq>.cpuprofile` on exit. `--cpu-prof-dir` and `--cpu-prof-name` pick the path. `--cpu-prof-interval` is the sample interval in microseconds.
2. The file is JSON: `nodes`, `startTime`, `endTime`, `samples`, and `timeDeltas`. Each node has a `callFrame` (`functionName`, `url`, 0-based `lineNumber`), a `hitCount`, `positionTicks`, and `children`. `samples[i]` is the node on top of the stack for `timeDeltas[i]` microseconds. Sum those per function for self time.
3. Read it with a script, as below, or open it in a profile viewer.

> ⚠️ Unverified: loading the `.cpuprofile` into Chrome DevTools or VS Code. This session was headless. Only the JSON was parsed.

4. 0x wraps your command, collects V8's tick log, and writes a flame-graph HTML file. It stays headless unless you pass `--open`.
5. clinic.js bundles `doctor`, `flame` (built on 0x), `bubbleprof`, and `heapprofiler`. The README says it is not actively maintained.

**Example. Run `--cpu-prof` and read the top functions.**

javascript

```
// hot.js — a workload with one obvious hotspot and one small one
function slowParse(n) {            // the hotspot: repeated JSON round-trips
  let o = { items: [] };
  for (let i = 0; i < n; i++) o = JSON.parse(JSON.stringify({ items: [...o.items.slice(-50), i] }));
  return o.items.length;
}
function cheapSum(n) { let s = 0; for (let i = 0; i < n; i++) s += i; return s; }

console.log(slowParse(60000), cheapSum(1e6));
```


javascript

```
// top-functions.js — print the functions with the most self time in a .cpuprofile
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2];
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));

// samples[i] is the node that was on top of the stack for timeDeltas[i] microseconds
const selfUs = new Map();
prof.samples.forEach((id, i) => {
  const { functionName, url, lineNumber } = byId.get(id).callFrame;
  const key = `${functionName || '(anonymous)'} ${url ? path.basename(url) + ':' + (lineNumber + 1) : ''}`;
  selfUs.set(key, (selfUs.get(key) || 0) + (prof.timeDeltas[i] || 0));
});

const total = [...selfUs.values()].reduce((a, b) => a + b, 0);
console.log(`${prof.samples.length} samples, ${(total / 1000).toFixed(0)} ms profiled`);
[...selfUs].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([k, us]) =>
  console.log(`${(us / 1000).toFixed(1).padStart(8)} ms ${(100 * us / total).toFixed(1).padStart(5)}%  ${k}`));
```


bash

```
$ node --cpu-prof --cpu-prof-dir=prof hot.js
51 499999500000
$ ls prof
CPU.20261007.170552.114258.0.001.cpuprofile
$ node top-functions.js prof/*.cpuprofile
148 samples, 176 ms profiled
   125.5 ms  71.4%  slowParse hot.js:2
    21.0 ms  11.9%  (program) 
    16.3 ms   9.3%  (garbage collector) 
     4.6 ms   2.6%  (anonymous) hot.js:1
     2.8 ms   1.6%  cheapSum hot.js:7
     2.2 ms   1.3%  compileForInternalLoader realm:383
```

The `slowParse` node was `hitCount` 114, and all 114 `positionTicks` were on line 4, the `JSON.parse(JSON.stringify(...))` line. `(program)` is native code outside JavaScript. `(garbage collector)` is GC, heavy here because each round allocates. Sample counts move between runs, and the small entries swapped order once. `slowParse` was first by a wide margin every time.

**Example. A 0x flame graph, headless.**

bash

```
$ node node_modules/0x/cmd.js -D flame hot.js
🔥  Profiling51 499999500000
🔥  Process exited, generating flamegraph
🔥  Flamegraph generated in
file:///…/l10/flame/flamegraph.html
$ ls flame
flamegraph.html
isolate-0x1a308000-114654-114654-v8.log
isolate-0x1a308000-114654-114654-v8.log.json
isolate-0x1a308000-114654-114654-v8.log.preprocess-ready
meta.json
```

Terminal control codes 0x uses to redraw its status line were removed from this output. The `isolate-…-v8.log` file is V8's tick log. On this machine `/tmp` is mounted `noexec`, so the `0x` bin shim could not run directly and `node node_modules/0x/cmd.js` was used. `npx 0x` works where scripts can execute. The HTML file includes the `slowParse` frames. Width is the share of samples. The widest bar near the top of the stacks is the hotspot.

> ⚠️ Unverified: what the flame graph looks like on screen. The HTML was generated and searched for `slowParse`. It was not opened in a browser.

**Example. clinic.js on Node 24, and whether it is maintained.**

javascript

```
// long.js — 3 s of 30 ms blocks separated by short idle gaps
const end = Date.now() + 3000;
(function round() {
  const stop = Date.now() + 30; while (Date.now() < stop) {}
  if (Date.now() < end) setTimeout(round, 5);
})();
```


bash

```
$ npm view clinic version time.modified
version = '13.0.0'
time.modified = '2026-08-31T10:08:51.521Z'
$ npm view clinic time --json | tail -3
  "12.1.0": "2023-03-15T21:02:40.117Z",
  "13.0.0": "2023-06-28T13:06:55.146Z"
}
$ HOME=$PWD/h1 node node_modules/clinic/bin.js doctor --open=false -- node long.js; echo "exit $?"; ls .clinic
(node:115160) [DEP0174] DeprecationWarning: Calling promisify on a function that returns a Promise is likely a mistake.
(Use `node --trace-deprecation ...` to show where the warning was created)
exit 0
ls: cannot access '.clinic': No such file or directory
$ HOME=$PWD/h1 NO_INSIGHT=1 node node_modules/clinic/bin.js doctor --open=false -- node long.js
To generate the report press: Ctrl + C
Analysing data
Generated HTML file is file:///…/l10/.clinic/115198.clinic-doctor.html
exit 0
$ grep -o '"issues":{"delay":"[a-z]*","cpu":"[a-z]*"' .clinic/*.clinic-doctor.html
"issues":{"delay":"performance","cpu":"performance"
```

Checked 7 Oct 2026. The last release, 13.0.0, was 2023-06-28. A 2026 `time.modified` value is registry metadata, not a release. The GitHub repo clinicjs/node-clinic is not archived. Its last push was 2024-09-19. The README says Clinic.js is not being actively maintained, and that because it is tied to Node internals it may not work or the results may not be accurate.

On a fresh `HOME` with no TTY, the anonymous-usage prompt hangs. clinic wraps `insight.askPermission` in `promisify`, but insight 0.11.1's `askPermission` returns a promise and never calls a callback (`DEP0174`). The wrapped promise never settles, the loop goes empty, and clinic exits 0 without running your script. `NO_INSIGHT=1` is checked in clinic's `bin.js` and skips the prompt.

With `NO_INSIGHT=1`, `clinic doctor` and `clinic flame` both wrote HTML on Node v24.19.0, and doctor flagged event-loop delay and CPU. A shorter script, `hot.js`, about 150 milliseconds, instead said the profile data looked empty and the report might not be generated.

`npm audit` in a project with those three packages reported 24 vulnerabilities, 2 critical and 4 high. clinic was the only direct dependency flagged, through packages such as `request`, `form-data`, `tmp`, and `d3-color`.

Use `--cpu-prof` first. It is built in and scriptable. Use 0x when you want the flame graph. Treat clinic as optional, dev-only, with `NO_INSIGHT=1`, and check it against `--cpu-prof` or `monitorEventLoopDelay`.

### Common mistakes & gotchas (additional topics)

- **A new `Worker` per request.** You pay isolate startup, and nothing limits the count. Use a pool sized from `os.availableParallelism()`.
- **Sending a huge object to a worker.** `pool.run(task)` structured-clones `task` on the main thread. Pass a `transferList` for `ArrayBuffer`s, or send a path or an id.
- **Moving async I/O into workers.** `fs`, crypto, and zlib are already parallel through libuv. Workers help with synchronous JavaScript.
- **An unbounded queue.** The default `maxQueue` will hold a traffic spike in memory with no limit. Set `maxQueue` and shed load when `pool.queueSize` is high.
- **Reading `monitorEventLoopDelay` as pure lateness.** On v24.19.0 every sample includes the `resolution`. Subtract it, or compare with an idle baseline. The idle numbers are in Good to know.
- **Profiling a 100 millisecond script.** At 1 sample per millisecond that is about 100 samples. Profile long enough, or under load, to get thousands.
- **clinic in CI without `NO_INSIGHT=1`.** On a fresh `HOME` it exits 0 and does nothing, so the step looks green.

### Edge case worked through: a stall right after `enable()` is invisible

`monitorEventLoopDelay()` samples with a libuv timer. A stall that starts in the same synchronous run as `h.enable()`, before that timer has fired once, is not recorded.

javascript

```
const { monitorEventLoopDelay } = require('node:perf_hooks');
const block = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
const ms = (ns) => (ns / 1e6).toFixed(1);

function report(label, h) {
  h.disable();
  console.log(`${label.padEnd(30)} samples=${h.count} min=${ms(h.min)}ms max=${ms(h.max)}ms`);
}

// Trial 1: block in the same synchronous run as enable().
const h1 = monitorEventLoopDelay({ resolution: 10 });
h1.enable();
block(300);
setTimeout(() => {
  report('block right after enable()', h1);

  // Trial 2: let the histogram's timer start first, then block.
  const h2 = monitorEventLoopDelay({ resolution: 10 });
  h2.enable();
  setTimeout(() => {
    block(300);
    setTimeout(() => report('block 50 ms after enable()', h2), 100);
  }, 50);
}, 100);

// Real output (Node v24.19.0), the same pattern in 3 runs:
//   block right after enable()     samples=9 min=10.1ms max=10.1ms
//   block 50 ms after enable()     samples=14 min=10.1ms max=304.3ms
```

The same 300 millisecond block shows as max 10.1 milliseconds in trial 1 and as 304 milliseconds in trial 2. That is why `compare.js` waits 50 milliseconds after `enable()`. A monitor enabled in the same turn as a slow startup step will not report that step. Time startup with `performance.now()`, or use `--cpu-prof`.

### ⭐ Interview lens (additional topics)

> **Q: “You moved a CPU-heavy function into `worker_threads` and p99 got better but throughput got worse. What would you check?”**  
> Check whether you start a worker per task. Isolate startup was about 60 milliseconds here, so a pool with a fixed `maxThreads` and an explicit `idleTimeout` is the fix. Check how much data you clone per task. The clone runs on the main thread. And check that the pool is not larger than `os.availableParallelism()`, or the threads fight over the cgroup quota. Compare loop delay and the pool's `waitTime` and `runTime` before and after. The limit is assuming "off the main thread" is free. Startup and cloning can cost more than the CPU work you moved.

> **Q: “How do you find what is blocking the event loop in production-like conditions?”**  
> First confirm the stall with `monitorEventLoopDelay`, p99 and max, minus the resolution, or with event-loop utilization. Then take a CPU profile under load with `node --cpu-prof` and rank functions by self time from `samples` and `timeDeltas`. 0x turns that into a flame graph. clinic.js still runs on Node 24 with `NO_INSIGHT=1`, but it has been unmaintained since 2023, so check whatever it reports against the built-in tools. The limit is a profile of a tiny script. A hundred samples will not show a rare stall. Profile under the load that reproduces it.
