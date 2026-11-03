---
title: "What Node.js Is: Runtime, Layers and Lifecycle"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# What Node.js Is: Runtime, Layers and Lifecycle

*14 min read · Updated 7 Oct 2026 · Topic 1 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

Node.js is one program, the `node` executable. It runs your JavaScript with Google's V8 engine, and it uses the C library libuv to wait on sockets, files, and timers, then run your callbacks one at a time on a single JavaScript thread.

It exists so a server can hold many connections without giving each one a thread that sits blocked. The trade-off is that one long calculation on that JavaScript thread freezes every other callback until it returns.

V8 is the engine that compiles and runs JavaScript. libuv is the C library that provides the event loop, the wait for I/O, and a small pool of helper threads. The event loop is the scheduler that runs those callbacks.

## Why it matters

Later lessons are details of this one program. Five production questions all come from how it is built:

- Why one slow `JSON.parse` of a 200 MB string freezes every request, while 10,000 slow database queries do not.
- Why `fs.readFile` uses a background thread and an HTTP socket does not.
- Why `window` is undefined, while `fetch` and `setTimeout` exist.
- Which Node version is safe to deploy, and for how long.
- Why a `process.on('exit')` handler never sent its log line.

The answers are the parts inside `node` (V8, libuv, C++ bindings, a JavaScript core library), the threads (one JavaScript thread plus helpers), the release lines, and the order a process starts, runs, and stops.

## The concept, simply

**Node.js is a single executable, `node`, that embeds V8, adds an event loop and asynchronous I/O from libuv, and exposes the operating system through a C++ layer and built-in modules such as `node:fs`, `node:http`, and `node:crypto`.** You give it a file. V8 compiles and runs it. The process stays alive while timers, sockets, or other work are pending, and it runs callbacks one at a time as events arrive.

Ryan Dahl presented Node in 2009. Servers then usually gave each connection its own thread, and that thread spent most of its life waiting on a disk or a database. Node uses one thread that does not wait. The I/O call returns at once, the operating system reports when the data is ready, and a callback runs then. JavaScript fit because it had no blocking I/O library to unlearn, and browser programmers already used callbacks. A 2014 fork, io.js, merged back in 2015 as Node.js 4. The OpenJS Foundation runs the project.

| Term | What it is | Examples |
| --- | --- | --- |
| Language | Syntax and meaning. No files, sockets, or timers. | JavaScript (ECMAScript) |
| Engine | Parses, compiles, runs, and collects garbage. | V8, SpiderMonkey, JavaScriptCore |
| Runtime | An engine, plus an event loop, plus host APIs, as something you can start. | Node.js, Deno, Bun, a browser tab |
| Framework | A library you load inside a runtime to structure the app. | Express, Fastify, NestJS |

So `setTimeout`, `fs`, and `process` are Node. `Array.prototype.map` and `Promise` are JavaScript, from V8.

**Four layers inside `node`.**

1. **V8.** Parses and compiles JavaScript to machine code, runs it, and collects garbage. Lesson 2.
2. **libuv.** The event loop. Non-blocking networking through the kernel: `epoll` on Linux, `kqueue` on macOS, IOCP on Windows. A thread pool for work the operating system cannot do without blocking: the file system, DNS `lookup`, some crypto, and zlib.
3. **C++ bindings,** in Node's `src/`. They turn a call such as `fs.open()` into a libuv request, and the completion back into a JavaScript callback. Bundled libraries live here too: OpenSSL, llhttp, zlib, c-ares, ICU, simdjson, sqlite.
4. **The core library,** in Node's `lib/`. The JavaScript behind `node:fs`, `node:http`, and `node:stream`. It is compiled into the binary, so `require('node:fs')` does not touch the disk.

**One JavaScript thread.** All of your JavaScript runs on the main thread, inside one V8 isolate, meaning one heap. That thread runs one callback to completion. Nothing preempts it. Network sockets are non-blocking in the kernel. libuv asks the operating system to watch thousands of them and sleeps in one `epoll_wait` until one is ready. File reads, `dns.lookup`, `crypto.pbkdf2`, and zlib go to libuv's thread pool, 4 workers by default. `UV_THREADPOOL_SIZE` changes that. V8 also starts its own threads for garbage collection and optimizing compilation. When a helper finishes, it queues a completion for the next trip around the loop.

![Diagram of Node's threads: the main thread running V8 and your JavaScript with the event loop, libuv in the middle, a thread pool of four workers for fs, crypto, zlib and dns.lookup, and the OS kernel handling network sockets with epoll, kqueue or IOCP](assets/i04_01_4d0a93cc.svg)

*Figure: one JavaScript thread on top, libuv in the middle, the thread pool and the kernel underneath. The right-hand box is the point: network sockets use kernel events, not the thread pool.*

## How it works

**What `node app.js` does.**

1. **Bootstrap, C++.** The binary starts V8's platform and its worker threads, OpenSSL, and ICU, then creates one isolate and one context. Official builds do not build that internal state from scratch. They restore a startup snapshot compiled into the binary. `process.config.variables.node_use_node_snapshot` is `true` on those builds.
2. **Bootstrap, JavaScript.** Internal code sets up `process`, `globalThis`, timers, the module loaders, and the error handlers. `performance.nodeTiming.bootstrapComplete` marks the end.
3. **Preload.** Modules named with `--require` or `--import`, including through `NODE_OPTIONS`, load first.
4. **The main module.** Your file runs top to bottom, synchronously. Timers and I/O started here are only registered.
5. **Microtasks.** When that synchronous code ends, the `process.nextTick` queue drains, then the promise queue. An ES module entry differs. Lesson 8.
6. **The event loop.** libuv's `uv_run` turns: timers, pending, poll, check, close. After each callback, microtasks drain again. The loop continues while any ref'd handle or pending request exists.
7. **`beforeExit`.** When nothing is left, Node emits `beforeExit`. If a listener schedules work, the loop runs again, and `beforeExit` fires again when that work is done.
8. **`exit`.** If `beforeExit` added nothing, Node emits `exit` with the code. Listeners must be synchronous. The loop has stopped, so a timer or I/O started here never runs.
9. **Teardown.** Node releases the isolate and the process ends with `process.exitCode`, 0 by default.

text

```
  node app.js
      │
      ▼
  1-2 bootstrap (C++ then internal JS, from the built-in snapshot)
      │
      ▼
  3   preload (--require / --import)
      │
      ▼
  4   main module runs top to bottom ──► 5 drain nextTick + promises
                                              │
                         ┌────────────────────┘
                         ▼
  6   event loop: timers → pending → poll → check → close   (repeats while
                         │                                    ref'd handles
                         │ loop empty                         or requests exist)
                         ▼
  7   'beforeExit' ── listener scheduled work? ── yes ──► back to 6
                         │ no
                         ▼
  8   'exit' (synchronous listeners only)
                         │
                         ▼
  9   teardown, OS exit status = process.exitCode

  process.exit() and an uncaught exception skip 7 but still run 8.
  A signal with no listener (SIGTERM, SIGINT) or SIGKILL skips both 7 and 8.
```

**Good at waiting, bad at computing on the main thread.** A request that spends 50 milliseconds on a database costs the JavaScript thread almost nothing during that wait, so other requests run. API servers, proxies, chat, streams, and CLIs fit. A long computation blocks every other callback: no timer, no new connection. Image work, a huge `JSON.parse`, encrypting a large payload, or a tight numeric loop belongs in `worker_threads`, a child process, a native addon, or another service. The thread pool is shared and small. Four slow `crypto.pbkdf2` calls fill it, and the next `fs.readFile` waits. Lesson 7.

**Browser tab versus Node.** Both are an engine plus an event loop. The host APIs differ.

| | Browser tab | Node.js |
| --- | --- | --- |
| Global object | `window` (also `globalThis`) | `globalThis` (also `global`). No `window`, no `document` |
| DOM | Yes | No |
| Files, processes, raw TCP/UDP | No | `node:fs`, `node:child_process`, `node:net`, `node:dgram` |
| Sandbox | Same-origin policy, permission prompts | None by default. Code has the OS user's permissions. Opt in with `--permission` |
| Modules | Classic scripts and ES modules. No CommonJS | CommonJS and ES modules |
| Event loop | Tasks, microtasks, rendering | libuv phases plus `process.nextTick` |
| Who picks the engine | The user's browser | You, by choosing the Node version |
| In both | `fetch`, `URL`, `TextEncoder`, `AbortController`, `structuredClone`, Web Streams, and a partial `navigator` | |

**Release lines.** A major version moves through phases. Current is the newest major, for its first six months. New features land here. Breaking changes wait for the next major. Active LTS, long-term support, is an even-numbered major about six months after release. It gets a codename. 24 is Krypton. It stays Active for 12 months and receives bug fixes, security fixes, and back-ported features the release team audited. Maintenance is the next 18 months: critical bugs and security fixes only. Active plus Maintenance is about 30 months. End-of-life means no more releases, including security fixes.

Up through Node 26, odd majors such as 23 and 25 never become LTS. They stay Current for about six months, get about two months of Maintenance, then end of life. Node 25 was released 2025-10-15, Maintenance from 2026-04-01, end of life 2026-06-01. From Node 27 the plan changes. nodejs.org says the cycle becomes annual, and every major moves to LTS after six months Current, plus six months of Alpha before that.

text

```
Schedule from nodejs/Release schedule.json, read on 2026-10-07

line  codename  released     Active LTS   Maintenance  End-of-Life   phase on 2026-10-07
----  --------  ----------   ----------   -----------  -----------   -------------------
v20   Iron      2023-04-18   2023-10-24   2024-10-22   2026-04-30    EOL
v22   Jod       2024-04-24   2024-10-29   2025-10-21   2027-04-30    Maintenance
v24   Krypton   2025-05-06   2025-10-28   2026-10-20   2028-04-30    Active LTS (13 days left)
v25   -         2025-10-15   never        2026-04-01   2026-06-01    EOL
v26   (none)    2026-05-05   2026-10-28   2027-10-20   2029-04-30    Current (LTS in 21 days)
v27   (none)    alpha from 2026-10-28, release 2027-04-22, EOL 2030-04-30   not out yet

One even line, as a timeline:
  release ──6 mo Current──► LTS start ──12 mo Active LTS──► Maintenance ──18 mo──► EOL
  v24:  2025-05-06            2025-10-28                     2026-10-20             2028-04-30
```

> ⚠️ Unverified: `schedule.json` lists Node 27 with `alpha` 2026-10-28, `start` 2027-04-22, `maintenance` 2027-10-20 and `end` 2030-04-30, but no `lts` date. I could not find an official nodejs.org page that gives Node 27's LTS start date or explains the `maintenance` date for the new annual cycle, so read those two fields as provisional.

For production, run Active LTS, or a Maintenance line that still covers your upgrade cycle. The dates for 7 Oct 2026 are in Good to know. The diagram above is the source.

## Code examples

**Example 1. The layers, as version numbers.** `process.versions` lists what this binary was built with.

javascript

```
// layers.js: print the versions of the pieces this Node binary is built from
const { node, v8, uv, openssl, llhttp, zlib, undici } = process.versions;
console.log({ node, v8, uv, openssl, llhttp, zlib, undici });
console.log('libuv thread pool size (env):', process.env.UV_THREADPOOL_SIZE ?? '(unset, so libuv uses 4)');
console.log('release line:', process.release.name, process.release.lts ?? '(not an LTS build)');
console.log('built-in modules:', require('node:module').builtinModules.length);

// Real output (Node v24.19.0):
//   {
//     node: '24.19.0',
//     v8: '13.6.233.17-node.51',
//     uv: '1.52.1',
//     openssl: '3.5.7',
//     llhttp: '9.4.3',
//     zlib: '1.3.2.1-motley-3246f1b',
//     undici: '7.29.0'
//   }
//   libuv thread pool size (env): (unset, so libuv uses 4)
//   release line: node Krypton
//   built-in modules: 72
```

`v8` is the engine. `uv` is libuv. `openssl`, `llhttp`, and `zlib` are C libraries behind the C++ bindings. `undici` is the JavaScript HTTP client behind global `fetch`, part of the core library. `process.release.lts` is the codename on LTS builds and `undefined` on a Current build. Do not use `process.binding()` to peek at the C++ layer. It is internal and deprecated, DEP0111.

**Example 2. The threads of a real Node process, Linux only.** The pool starts on the first job that needs it.

javascript

```
// threads.js (Linux only): count the OS threads of this Node process
const fs = require('node:fs');
const crypto = require('node:crypto');

const names = () =>
  fs.readdirSync('/proc/self/task').map((tid) =>
    fs.readFileSync(`/proc/self/task/${tid}/comm`, 'utf8').trim());

console.log('at startup:', names().length, 'threads');
console.log(names().join(', '));

// The first thread-pool job makes libuv start its worker threads.
crypto.pbkdf2('pw', 'salt', 1000, 32, 'sha256', () => {
  console.log('after first pool job:', names().length, 'threads');
  console.log(names().join(', '));
});

// Real output (Node v24.19.0):
//   at startup: 7 threads
//   MainThread, DelayedTaskSche, V8Worker, V8Worker, V8Worker, V8Worker, SignalInspector
//   after first pool job: 11 threads
//   MainThread, DelayedTaskSche, V8Worker, V8Worker, V8Worker, V8Worker, SignalInspector, libuv-worker, libuv-worker, libuv-worker, libuv-worker
```


bash

```
$ UV_THREADPOOL_SIZE=8 node threads.js | tail -2
after first pool job: 15 threads
MainThread, DelayedTaskSche, V8Worker, V8Worker, V8Worker, V8Worker, SignalInspector, libuv-worker, libuv-worker, libuv-worker, libuv-worker, libuv-worker, libuv-worker, libuv-worker, libuv-worker
```

Only `MainThread` runs your JavaScript. The four `V8Worker` threads are V8's platform, for concurrent garbage collection and background compilation. `DelayedTaskSche` schedules V8's delayed tasks. `SignalInspector` waits for the `SIGUSR1` that starts the debugger. `libuv-worker` threads are the pool. The names come from `/proc`, so this is Linux-only.

> ⚠️ Unverified: the thread names and counts on macOS and Windows. This was run only on Linux.

**Example 3. Waiting overlaps. Computing on the main thread does not.**

javascript

```
// cpu-vs-io.js: waiting on I/O overlaps; CPU work on the main thread does not
const { setTimeout: sleep } = require('node:timers/promises');

async function ioBound() {
  const t0 = performance.now();
  // 100 "requests" that each wait 50 ms (a stand-in for a DB or HTTP call)
  await Promise.all(Array.from({ length: 100 }, () => sleep(50)));
  return performance.now() - t0;
}

function cpuBound(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {} // keeps the only JS thread busy
}

(async () => {
  console.log(`100 x 50 ms waits took ${(await ioBound()).toFixed(0)} ms`);

  const scheduled = performance.now();
  setTimeout(() => {
    console.log(`10 ms timer fired after ${(performance.now() - scheduled).toFixed(0)} ms`);
  }, 10);
  cpuBound(300);
  console.log('300 ms of CPU work finished');
})();

// Real output (Node v24.19.0), three runs: 52/52/51 ms and 301/301/300 ms
//   100 x 50 ms waits took 52 ms
//   300 ms of CPU work finished
//   10 ms timer fired after 301 ms
```

A hundred waits of 50 milliseconds finish in about 50 milliseconds, not 5,000, because waiting uses no JavaScript time. The 10 millisecond timer fires after 300 milliseconds. Its delay was already over, but the timers phase cannot run while the main thread is inside `cpuBound`.

**Example 4. What this runtime has, compared with a browser tab.**

javascript

```
// globals.js: what this runtime provides, compared with a browser tab
const names = ['window', 'document', 'globalThis', 'process', 'require',
  'Buffer', 'fetch', 'setImmediate', 'navigator', 'localStorage'];
for (const n of names) {
  let t;
  try { t = typeof eval(n); } catch { t = '(ReferenceError)'; }
  console.log(n.padEnd(13), t);
}
console.log('globalThis === global:', globalThis === global);

// Real output (Node v24.19.0):
//   window        (ReferenceError)
//   document      (ReferenceError)
//   globalThis    object
//   process       object
//   require       function
//   Buffer        function
//   fetch         function
//   setImmediate  function
//   navigator     object
//   localStorage  (ReferenceError)
//   globalThis === global: true
```

`require` shows up here because a CommonJS file is wrapped in a function that receives `require` as a parameter. It is not on `globalThis`, and it does not exist in ES modules. `localStorage` is missing unless you pass `--experimental-webstorage`.

**Example 5. Node's own startup milestones.** `performance.nodeTiming` records when each bootstrap step finished.

javascript

```
// timing.js: Node's own start-up milestones for this process (ms since process start)
const { performance } = require('node:perf_hooks');
const t = performance.nodeTiming;
const ms = (x) => (x < 0 ? '-1 (not yet)' : `${x.toFixed(1)} ms`);

console.log('in the main module: loopStart =', ms(t.loopStart));

setTimeout(() => {
  console.log({
    nodeStart: ms(t.nodeStart),                 // process initialised
    v8Start: ms(t.v8Start),                     // V8 platform initialised
    environment: ms(t.environment),             // Node.js environment initialised
    bootstrapComplete: ms(t.bootstrapComplete), // bootstrapping finished
    loopStart: ms(t.loopStart),                 // event loop started
  });
}, 20);

process.on('exit', () => {
  console.log('in exit: loopExit =', ms(t.loopExit), '| loop iterations:', t.uvMetricsInfo.loopCount);
});

// Real output (Node v24.19.0; the times change by a few ms per run):
//   in the main module: loopStart = -1 (not yet)
//   {
//     nodeStart: '0.7 ms',
//     v8Start: '4.4 ms',
//     environment: '16.8 ms',
//     bootstrapComplete: '21.7 ms',
//     loopStart: '25.8 ms'
//   }
//   in exit: loopExit = 46.4 ms | loop iterations: 1
```

`loopStart` is `-1` while the main module runs, so step 4 happens before the event loop exists. `loopExit` has a value only inside an `exit` listener.

**Example 6. The whole lifecycle in one file.**

javascript

```
// lifecycle.js: the order in which one Node program runs
let rounds = 0;

process.on('beforeExit', (code) => {
  rounds++;
  console.log(`5. beforeExit #${rounds} (code ${code}): the loop is empty`);
  if (rounds === 1) {
    // Scheduling work here restarts the event loop; beforeExit fires again later.
    setTimeout(() => console.log('6. timer scheduled inside beforeExit'), 10);
  }
});

process.on('exit', (code) => {
  // Only synchronous work runs here: the loop has stopped.
  setTimeout(() => console.log('never printed'), 0);
  console.log(`7. exit (code ${code})`);
});

setTimeout(() => console.log('4. timer (timers phase, 5 ms later)'), 5);
setImmediate(() => console.log('3. setImmediate (check phase, first loop turn)'));
Promise.resolve().then(() => console.log('2. promise (microtask, right after the main module)'));
console.log('1. main module, synchronous code');

// Real output (Node v24.19.0), identical on three runs:
//   1. main module, synchronous code
//   2. promise (microtask, right after the main module)
//   3. setImmediate (check phase, first loop turn)
//   4. timer (timers phase, 5 ms later)
//   5. beforeExit #1 (code 0): the loop is empty
//   6. timer scheduled inside beforeExit
//   5. beforeExit #2 (code 0): the loop is empty
//   7. exit (code 0)
```

Read it against the steps. Main module, microtasks, the loop, then `beforeExit`, which ran twice because the first listener scheduled a timer, then `exit`. The timer created inside the `exit` listener never ran. The timer uses 5 milliseconds, not 0, because at the top of a file a 0 millisecond timer and `setImmediate` race. Lesson 6.

**Example 7. `process.exit()` and an uncaught error skip `beforeExit`.**

javascript

```
// exit-skip.js: process.exit() and an uncaught error skip beforeExit
process.on('beforeExit', () => console.log('beforeExit (not printed)'));
process.on('exit', (code) => console.log(`exit handler, code ${code}`));

setTimeout(() => console.log('pending timer (not printed)'), 100);

if (process.argv[2] === 'throw') {
  throw new Error('boom');
}
process.exitCode = 3;          // the code the process will end with
process.exit();                // ends now: pending timer dropped, no beforeExit
```


bash

```
$ node exit-skip.js; echo "exit status: $?"
exit handler, code 3
exit status: 3
$ node exit-skip.js throw; echo "exit status: $?"
exit handler, code 1
…/exit-skip.js:8
  throw new Error('boom');
  ^

Error: boom
    at Object.<anonymous> (…/exit-skip.js:8:9)
    …

Node.js v24.19.0
exit status: 1
```

`beforeExit` does not fire in either run. The docs say it is not emitted for explicit termination, such as `process.exit()` or an uncaught exception. Use `exit` for synchronous cleanup, and signal handlers for asynchronous cleanup. `process.exit()` drops the pending 100 millisecond timer. With no argument it uses `process.exitCode`. An uncaught exception sets the code to 1.

A signal with no listener skips both events. `SIGTERM` is what `kill`, Docker, and Kubernetes send.

javascript

```
// sigterm.js: a signal with no listener ends the process before either event
process.on('beforeExit', () => console.log('beforeExit (not printed)'));
process.on('exit', (code) => console.log(`exit, code ${code} (not printed)`));
setTimeout(() => {}, 5000);                                  // keeps the loop alive
setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);  // what `kill <pid>` sends
```


bash

```
$ node sigterm.js; echo "exit status: $?"
Terminated                 node sigterm.js
exit status: 143
```

Status 143 is 128 plus 15, the number of `SIGTERM`. `Terminated` is printed by the shell, not by Node. `process.on('SIGTERM', handler)` replaces the default. From there you decide when to exit.

**Example 8. Reading the release schedule in code.**

javascript

```
// release-status.mjs: which phase is each Node major in on a given date?
// Usage: node release-status.mjs [YYYY-MM-DD]
const URL = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
const day = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const schedule = await (await fetch(URL)).json();

function phase(r) {                         // ISO dates compare correctly as strings
  if (day < (r.alpha ?? r.start)) return null;    // not out yet
  if (day >= r.end) return 'End-of-Life';
  if (day < r.start) return 'Alpha';
  if (r.maintenance && day >= r.maintenance) return 'Maintenance';
  if (r.lts && day >= r.lts) return 'Active LTS';
  return 'Current';
}

console.log(`Status on ${day}:`);
for (const [line, r] of Object.entries(schedule)) {
  const p = phase(r);
  if (p && p !== 'End-of-Life') {
    console.log(`  ${line.padEnd(4)} ${p.padEnd(12)} lts ${(r.lts ?? '-').padEnd(10)}  maintenance ${r.maintenance}  end ${r.end}`);
  }
}
```


bash

```
$ node release-status.mjs 2026-10-07
Status on 2026-10-07:
  v22  Maintenance  lts 2024-10-29  maintenance 2025-10-21  end 2027-04-30
  v24  Active LTS   lts 2025-10-28  maintenance 2026-10-20  end 2028-04-30
  v26  Current      lts 2026-10-28  maintenance 2027-10-20  end 2029-04-30
$ node release-status.mjs 2026-10-28
Status on 2026-10-28:
  v22  Maintenance  lts 2024-10-29  maintenance 2025-10-21  end 2027-04-30
  v24  Maintenance  lts 2025-10-28  maintenance 2026-10-20  end 2028-04-30
  v26  Active LTS   lts 2026-10-28  maintenance 2027-10-20  end 2029-04-30
  v27  Alpha        lts -           maintenance 2027-10-20  end 2030-04-30
```

Top-level `await` works because the file is an ES module, `.mjs`. The JSON is the same data the nodejs.org release table is built from, so a CI job can fail when the Docker base image's major is within 90 days of `end`.

## Common mistakes & gotchas

- **"Node is single-threaded."** Only your JavaScript is. A plain `node` process on Linux has 7 OS threads at startup and 11 after the first thread-pool job. One JavaScript thread per isolate, plus libuv and V8 helper threads.
- **"Everything async uses the thread pool."** Network I/O uses kernel readiness (`epoll`, `kqueue`, or IOCP). The pool runs file system calls, `dns.lookup`, async `crypto.pbkdf2`, `scrypt`, `randomBytes`, `randomFill`, `generateKeyPair`, and zlib.
- **Calling Node a framework or a language.** Node is a runtime. Express is a framework. JavaScript is the language.
- **Expecting browser globals.** `window`, `document`, and `localStorage` without a flag do not exist. Shared code uses `globalThis` and feature checks.
- **Deploying Current, or an odd major, to production.** A Current line has not been audited for LTS. Odd lines up through 25 reach end of life about seven and a half months after release. Use Active LTS or Maintenance.
- **Async work in an `exit` listener.** The loop has stopped. A `setTimeout`, a network log, or a database `close()` started there never finishes.
- **Using `beforeExit` as the only cleanup.** It does not fire on `process.exit()`, an uncaught exception, or a signal. An unhandled `SIGTERM` skips `exit` too.
- **Using `process.binding()`.** Internal, deprecated as DEP0111, and unavailable under the permission model. Use the public modules.

## Best practices

- Pin the major in `.nvmrc` or `.node-version` and in the Docker `FROM` tag. `"engines"` in `package.json` is documentation. npm only warns unless `engine-strict=true`. Lesson 14.
- Move to the next LTS during its Active phase, before your line's end of life. Example 8 is a check you can automate.
- Keep CPU work off the main thread when it takes more than a few milliseconds per request.
- If you do heavy `fs`, crypto, or zlib, set `UV_THREADPOOL_SIZE` in the environment before Node starts. Setting it from inside a running script is unreliable once the pool exists.
- Put shutdown in `SIGTERM` and `SIGINT` handlers, not in `beforeExit`. Close servers and pools, then let the loop empty or call `process.exit()`.
- Require built-ins as `node:fs`. The prefix cannot be shadowed by an npm package of the same name.

## ⭐ Interview lens

> **Q: “What is Node.js, in one precise sentence?”**  
> Node.js is a JavaScript runtime: one executable that embeds the V8 engine, uses libuv for the event loop, non-blocking network I/O, and a thread pool, and exposes the operating system through C++ bindings and built-in modules such as `fs`, `net`, and `http`. You hand it a file. V8 runs that file. libuv keeps the process alive while work is pending and runs callbacks one at a time. The limit of the sentence is the slogan people substitute. It is not a framework, and it is not a language. Express is a framework that runs on it. JavaScript is the language V8 implements.

> **Q: “If Node is single-threaded, how does it serve 10,000 connections?”**  
> Only the JavaScript is single-threaded. The sockets are non-blocking. libuv registers them with the kernel, `epoll` on Linux, and the main thread sleeps in one `epoll_wait` until some are ready, then runs their callbacks one by one. A connection that is waiting costs memory, not a thread. Blocking file and DNS work goes to libuv's pool of 4 threads. The limit is CPU time per callback. One slow synchronous callback delays all 10,000, because nothing else can run on that thread until it returns.

> **Q: “What is the difference between `beforeExit` and `exit`?”**  
> `beforeExit` fires when the event loop has no work left. A listener may schedule more work, the loop runs again, and `beforeExit` can fire again. It does not fire for `process.exit()` or an uncaught exception. `exit` fires once, just before the process ends, including those cases, and its listeners must be synchronous because the loop is gone. A timer started in `exit` never runs. Neither event fires when a signal with no listener ends the process, such as `SIGTERM`, `SIGINT`, or `SIGKILL`. For cleanup that must be async, handle the signal yourself.

> **Q: “Name things that exist in the browser but not Node, and the reverse.”**  
> The browser has `window`, `document`, the DOM, and a same-origin sandbox. Node has `process`, `Buffer`, CommonJS `require`, `fs`, `child_process`, raw TCP and UDP, `setImmediate`, and `process.nextTick`. Both have `fetch`, `URL`, `AbortController`, `TextEncoder`, Web Streams, and `structuredClone`. `localStorage` is not there on Node 24 unless you pass a flag. The limit is assuming a shared API behaves the same. Node has no sandbox by default. Code runs with the permissions of the user who started the process.

## Cheat-card

- **Node** is V8, plus libuv, plus C++ bindings, plus the core JavaScript library, in one binary.
- JavaScript is the language. Node is the runtime. Express is a framework.
- One JavaScript thread. libuv pool defaults to 4. V8 has helper threads. Network I/O uses the kernel, not the pool.
- Strong at I/O. A long computation on the main thread blocks everything else.
- `process.versions` has `v8`, `uv`, and `openssl`. `process.release.lts` is the codename on LTS builds.
- Lifecycle: bootstrap, preload, main module, microtasks, event loop, `beforeExit` (may schedule more work), `exit` (synchronous only), teardown.
- `process.exit()`, an uncaught exception, and signals skip `beforeExit`. A signal with no listener also skips `exit`.

## Good to know

- Q: Which Node version would you deploy today, and why? On 7 Oct 2026, Node 24, Krypton. Active LTS until 2026-10-20, then Maintenance until 2028-04-30. Node 26 becomes Active LTS on 2026-10-28. Do not deploy a Current line. Node 22 is Maintenance until 2027-04-30.
- On 2026-10-07 the lines are: 24 Active LTS, Maintenance from 2026-10-20, end 2028-04-30. 26 Current, LTS from 2026-10-28, end 2029-04-30. 22 Maintenance until 2027-04-30. 20 ended 2026-04-30. 25 ended 2026-06-01. 27 is not out. Alpha is listed from 2026-10-28, release 2027-04-22, end 2030-04-30, and `schedule.json` has no LTS date. See the unverified note under the schedule.
- Phases up through Node 26: Current about 6 months, Active LTS 12 months, Maintenance 18 months, then end of life. Odd majors through 25 never become LTS. From 27, every major is planned to become LTS.
- `--permission` was added in v20.0.0 and is stable since v23.5.0 and v22.13.0. Partial `navigator` was added in v21.0.0. `fetch` stopped being experimental in v21.0.0. `localStorage` on Node 24 needs `--experimental-webstorage`, added in v22.4.0. `uvMetricsInfo` was added in v22.8.0.
- A plain process on Linux showed 7 threads at startup and 11 after the first pool job. Example 2.

---

## Learn More

- [Introduction to Node.js nodejs.org](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- [Differences between Node.js and the Browser nodejs.org](https://nodejs.org/en/learn/getting-started/differences-between-nodejs-and-the-browser)
- [Node.js Releases nodejs.org](https://nodejs.org/en/about/previous-releases)
- [Node.js Release Working Group schedule GitHub](https://github.com/nodejs/Release)
- [process: 'beforeExit' and 'exit' events nodejs.org](https://nodejs.org/api/process.html)
- [libuv design overview docs.libuv.org](https://docs.libuv.org/en/v1.x/design.html)
- [Don't Block the Event Loop (or the Worker Pool) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)

