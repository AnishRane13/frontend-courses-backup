---
title: "The Event Loop Phases"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/event-loop-phases
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# The Event Loop Phases

*10 min read · Updated 24 Jul 2026 Topic 6 of 70 Bookmark Mark done Why it matters Node · Topic 6 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/event-loop-phases](https://www.geekyfrontend.in/learn/nodejs-backend-kit/event-loop-phases)

---

## Say it in 30 seconds

The event loop is a scheduler inside Node, provided by the C library libuv, that runs your callbacks one at a time in a fixed order of phases. A phase is one inbox: timers, then a few deferred system callbacks, then poll where I/O is collected, then check where `setImmediate` runs, then close handlers, and then it starts again.

It exists so one JavaScript thread can serve many connections. The thread sleeps in the kernel until a timer or a socket is ready, then runs that callback. The trade-off is cooperation. A callback that does not return blocks every other inbox until it does.

## Why it matters

Every timer, finished file read, and incoming HTTP request is a callback this loop hands to V8. If you cannot name the phases, three bugs stay mysterious. Ordering bugs, such as `setTimeout` and `setImmediate` swapping places. Latency bugs, where the server stalls even though each handler looks small. Starvation bugs, where one recursive callback never lets the loop move. All three are the order in which the loop drains its queues.

## The concept, simply

Picture one person and six inboxes, always in the same order. One full trip is one iteration of the loop. People often call that a tick, but `process.nextTick` is a different queue and the name is historical.

1. **timers.** Callbacks from `setTimeout` and `setInterval` whose delay has elapsed.
2. **pending callbacks.** A few system callbacks deferred from the previous trip, such as some TCP errors like `ECONNREFUSED`.
3. **idle, prepare.** Internal to libuv. You never schedule work here.
4. **poll.** Collects new I/O events and runs their callbacks. If nothing else is due, the loop blocks here and waits.
5. **check.** Runs `setImmediate` callbacks.
6. **close callbacks.** Runs `'close'` handlers, such as `socket.on('close', ...)`.

In practice you schedule into timers, poll, check, and close.

![Circular diagram of the six event loop phases: timers, pending callbacks, idle/prepare, poll, check, and close callbacks](assets/i03_01_d58df36e.svg)

Each phase drains its own queue before the loop advances.

## How it works

A phase owns a first-in, first-out queue. The loop runs callbacks from that queue one by one until the queue is empty or a system limit is hit, then moves on. A callback you schedule during a phase does not run in that same visit. It waits in the queue for the phase it belongs to.

![A phase box containing several queued I/O callbacks that drain left to right until empty, then hand off to the next phase](assets/i03_02_f6f7cf00.svg)

**Poll is the phase that can sleep.** If poll's queue has callbacks, they run. If the queue is empty and `setImmediate` callbacks are waiting, poll ends and the loop goes to check. If nothing is pending anywhere, the loop blocks in poll until the operating system delivers I/O, or until the nearest timer is due. An idle server uses almost no CPU because it is asleep inside that kernel wait: `epoll_wait` on Linux, `kqueue` on macOS, IOCP on Windows.

**nextTick and promise microtasks are not phases.** After the current callback returns, and again at each phase boundary, Node drains the `process.nextTick` queue and then the promise microtask queue before it does anything else. That is why a promise `.then` beats a `setTimeout` of 0. The full rules are the microtask lesson. The rhythm is: run one phase callback, drain nextTick, drain microtasks, run the next callback.

The loop keeps turning while any ref'd handle is open: a listening server, an active timer, an open socket, or a pending request. When none remain, `uv_run` returns and the process exits. That is why `setInterval` keeps a script alive, and why `unref()` on a background timer lets the process exit.

## Code examples

**Example 1. Timers versus immediate at the top of a file is not guaranteed.**

javascript

```
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));

// Possible output A:        Possible output B:
//   timeout                   immediate
//   immediate                 timeout
```

`setTimeout` of 0 is clamped to at least 1 millisecond. Whether that millisecond has already elapsed when the loop first reaches timers depends on startup time. Do not rely on this order.

**Example 2. Inside an I/O callback, the order is fixed.**

javascript

```
const fs = require('fs');

fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});

// Output (always):
//   immediate
//   timeout
```

The `readFile` callback runs in poll. The next phase is check, so `setImmediate` runs first. The timeout waits until the loop wraps back to timers. That order is guaranteed.

**Example 3. The loop stays alive because of a ref'd handle.**

javascript

```
console.log('start');
const t = setInterval(() => console.log('tick'), 1000);
// The process never exits: the interval is an active handle.
// t.unref() would let the loop exit despite the timer still existing.

// Output:
//   start
//   tick   (every second, forever)
```


**Example 4. Microtasks jump the phase queue.**

javascript

```
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
console.log('sync');

// Output:
//   sync
//   promise
//   timeout
```

Synchronous code runs first. Before the loop reaches timers, it drains microtasks, so the promise prints before the timeout even though the timer was scheduled first.

## Common mistakes & gotchas

- **`setTimeout(fn, 0)` is not immediate.** It runs in a later timers phase, after the current stack, after microtasks, and after a 1 millisecond minimum. Under load it can be much later.
- **Phase order does not mean timeout before immediate.** Inside an I/O callback the order is the reverse, and it is guaranteed. At the top of a file it is a race.
- **A callback scheduled during a phase does not run in that same visit.** It waits until the loop reaches the phase it belongs to.
- **Poll is allowed to block.** If the next timer is 200 milliseconds away and nothing else is pending, sleeping in poll is normal.
- **Two meanings of tick.** One loop iteration is one trip through the phases. `process.nextTick` is not that trip.
- **`setInterval(fn, 100)` is not a metronome.** It fires no sooner than 100 milliseconds after it was scheduled, and only when the loop reaches timers. A busy loop makes intervals drift and pile up.

## Best practices

- Do not depend on top-level timer versus immediate order. For "after I/O," use `setImmediate` inside the I/O callback.
- Use `setImmediate` to split CPU work so the loop can serve I/O between chunks.
- Call `.unref()` on background timers that should not keep the process alive by themselves.
- Say which phase a callback runs in. "About 0 milliseconds" is a guess.
- Keep each callback short. The loop cannot preempt a callback that will not return.

## ⭐ Interview lens

> **Q: Name the phases of the event loop in order.**  
> The loop walks six phases, always in this order: timers, pending callbacks, idle and prepare, poll, check, then close callbacks. Timers runs `setTimeout` and `setInterval`. Pending callbacks is a small set of deferred system errors. Idle and prepare are internal. You do not schedule there. Poll collects I/O and can sleep. Check runs `setImmediate`. Close runs `'close'` handlers. Between callbacks, Node drains `process.nextTick` and then promise microtasks. Those two are not phases. The limit of reciting the list is that poll is not "run the queue and move on." If both the poll queue and the immediate queue are empty, the loop blocks there until I/O or the next timer.

> **Q: What is the output?**  
> `setTimeout(() => console.log('A'), 0); setImmediate(() => console.log('B'));`  
> At the top of a file the output is not fixed. It can be A then B, or B then A. A timeout of 0 is clamped to about 1 millisecond, and the winner is whether that time has already passed when the loop first reaches timers. Put both calls inside an `fs.readFile` callback and the order is always B then A. The read callback runs in poll, and check is the next phase. The limit is that "always B then A" is only the I/O-callback case.

> **Q: Why does an idle Node server use almost no CPU?**  
> The loop is asleep in the poll phase, inside one kernel call: `epoll_wait` on Linux, `kqueue` on macOS, or IOCP on Windows. It wakes when the operating system reports a socket event or when the nearest timer is due. It is not spinning. The limit of that picture is a callback that never returns. While your JavaScript runs, the loop is not in that wait, so one long synchronous function uses CPU and also stalls every connection.

> **Q: What keeps the event loop — and the process — alive?**  
> Ref'd handles. An active timer, an open socket, a listening server, or a pending thread-pool request counts. When none remain, `uv_run` returns and the process exits. `unref()` takes a handle out of that count, which is how a heartbeat timer can exist without pinning the process. The limit is signals and `process.exit()`. Those end the process even if handles are still open. `beforeExit` is a separate event for the moment the loop has already found nothing left.

## Cheat-card

- **Order:** timers, pending, poll, check, close, then repeat. Idle and prepare sit between pending and poll, and you do not schedule there.
- **timers:** `setTimeout` and `setInterval`. **poll:** I/O, and it can block. **check:** `setImmediate`. **close:** `'close'` events.
- Each phase drains its queue, then advances.
- nextTick and microtasks drain between callbacks. They are not a phase.
- Inside an I/O callback, `setImmediate` beats `setTimeout` of 0.
- At the top of a file, timer versus immediate is a race.
- The process lives while ref'd handles exist. `unref()` drops that hold.

## Good to know

- Q: In the poll phase, when does the loop decide to move on instead of waiting? If the poll queue has callbacks, it runs them. If the queue is empty but `setImmediate` callbacks exist, it ends poll and goes to check. If nothing is pending, it blocks until I/O arrives or the nearest timer is due.
- Q: Is the event loop the same as a thread? No. It is a scheduler on the one JavaScript thread. libuv also has a worker thread pool for some blocking native calls. Your JavaScript callbacks still run one at a time on the main thread.
- `performance.eventLoopUtilization()` was added in v14.10.0 and v12.19.0. The `perf_hooks.eventLoopUtilization` export was added in v24.12.0.
- `import.meta.filename` was added in v21.2.0 and v20.11.0. Syntax detection treats a `.js` file with no `"type"` as an ES module when it contains `import`, on by default since v22.7.0 and v20.19.0.
- Timeout versus immediate, 200 runs per batch on this machine: `immediate` usually won in both `.cjs` and `.mjs`. Sixteen parallel copies moved both formats to 249 immediate and 51 timeout out of 300. Two milliseconds of synchronous work after scheduling made `timeout` win 200 of 200 in both formats. Inside `fs.readFile`, the order was immediate then timeout, 200 of 200.
- The four-line nextTick versus promise file did not vary in 50 runs of each format. Only the top-level pair flips between CommonJS and ES modules.

---

## Learn More

- [The Node.js Event Loop nodejs.org](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [Overview of Blocking vs Non-Blocking nodejs.org](https://nodejs.org/en/learn/asynchronous-work/overview-of-blocking-vs-non-blocking)
- [Don't Block the Event Loop (or the Worker Pool) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [This is how the Node.js Event Loop really works Software Developer Diaries](https://www.youtube.com/watch?v=paI6J8my3Yw)
- [What the heck is the event loop anyway? | Philip Roberts | JSConf EU JSConf](https://www.youtube.com/watch?v=8aGhZQkoFbQ)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### `performance.eventLoopUtilization()`: how busy the loop is

Event loop utilization, ELU, is the share of wall-clock time the loop spent outside the kernel wait (`epoll_wait` on Linux). That includes your callbacks, microtask drains, and Node's own work between phases. libuv records each poll wait because Node turns on `UV_METRICS_IDLE_TIME`. `performance.eventLoopUtilization()` returns `idle` (milliseconds inside the wait), `active` (milliseconds anywhere else since the loop started), and `utilization` (`active / (idle + active)`, from 0 to 1).

CPU cannot answer this. A process blocked in `spawnSync('sleep')` uses almost no CPU and still serves nothing. Event-loop delay, lesson 10, tells you how late timers fired. ELU tells you how close the loop is to having no spare time, which is the number you want before you shed load or add instances.

1. With no arguments, you get totals since the loop started. They are all zero if bootstrap has not finished.
2. `eventLoopUtilization(prev)` is the delta since `prev`, with `utilization` for that window only. Use this for "the last N seconds."
3. `eventLoopUtilization(later, earlier)` is the delta between two saved readings. Do not subtract two `utilization` ratios. They cover different windows.
4. Idle time grows only while the loop is parked in poll. Any callback, microtask drain, or synchronous block adds to `active`.

**Example. An idle window, a busy window, and the delta forms.**

javascript

```
const { performance } = require('node:perf_hooks');

function busy(ms) {               // burn CPU on the main thread
  const end = performance.now() + ms;
  while (performance.now() < end) {}
}
const fmt = (u) =>
  `idle=${u.idle.toFixed(0)}ms active=${u.active.toFixed(0)}ms utilization=${u.utilization.toFixed(2)}`;

setImmediate(() => {              // bootstrap is done once the loop runs
  const t0 = performance.eventLoopUtilization();
  setTimeout(() => {              // window 1: loop parked in epoll_wait
    const t1 = performance.eventLoopUtilization();
    console.log('idle window :', fmt(performance.eventLoopUtilization(t1, t0)));
    busy(500);                    // window 2: loop never reaches epoll_wait
    setImmediate(() => {
      console.log('busy window :', fmt(performance.eventLoopUtilization(t1)));
      console.log('since start :', fmt(performance.eventLoopUtilization(t0)));
    });
  }, 500);
});

// Real output (Node v24.19.0):
//   idle window : idle=501ms active=0ms utilization=0.00
//   busy window : idle=0ms active=507ms utilization=1.00
//   since start : idle=501ms active=507ms utilization=0.50
```

The busy window shows 507 milliseconds instead of 500 because the `console.log` calls and the trip to check also count as active. Three runs matched these three lines within 1 millisecond.

**Example. ELU and event-loop delay measure different things.** Two workloads, each measured for 2 seconds. A is 2 millisecond chunks back to back, each yielding with `setImmediate`. B is a mostly idle loop with one 300 millisecond block every second.

javascript

```
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

function busy(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {}
}

// Run `scenario` for 2 s, then report ELU and event-loop delay for that window.
function measure(name, scenario) {
  return new Promise((resolve) => {
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const start = performance.eventLoopUtilization();
    const stop = scenario();
    setTimeout(() => {
      stop();
      h.disable();
      const u = performance.eventLoopUtilization(start).utilization;
      console.log(`${name.padEnd(28)} ELU=${u.toFixed(2)}  ` +
        `delay p50=${(h.percentile(50) / 1e6).toFixed(1)}ms max=${(h.max / 1e6).toFixed(1)}ms`);
      resolve();
    }, 2000);
  });
}

(async () => {
  // A: many short callbacks back to back (2 ms of work, then yield).
  await measure('A: 2 ms chunks, no gaps', () => {
    let on = true;
    (function chunk() { if (!on) return; busy(2); setImmediate(chunk); })();
    return () => { on = false; };
  });
  // B: mostly idle, one 300 ms block every second.
  await measure('B: one 300 ms block per 1 s', () => {
    const t = setInterval(() => busy(300), 1000);
    return () => clearInterval(t);
  });
})();

// Real output (Node v24.19.0), the same in 3 runs to within a few ms:
//   A: 2 ms chunks, no gaps      ELU=1.00  delay p50=10.2ms max=10.7ms
//   B: one 300 ms block per 1 s  ELU=0.15  delay p50=10.1ms max=305.4ms
```

The histogram samples every 10 milliseconds, and on v24.19.0 each sample includes that 10 millisecond interval, so about 10 milliseconds means "on time." Workload A has no spare capacity (ELU 1.00) and every timer still fires on time, because no single callback runs long. Workload B has about 85 percent spare capacity (ELU 0.15) and one request in the wrong second waits 300 milliseconds. Use ELU for "can this process take more load?" and delay for "are callbacks waiting too long?"

### Ordering when the entry file is an ES module

The phases do not change. What changes is where the entry file's top-level code runs. A CommonJS entry is called as a plain function. When it returns, Node drains nextTick, then promises. An ES module entry is evaluated inside Node's promise-based loader, so the body runs while V8 is already draining microtasks. Promise jobs the body queued run in that same drain. Node reaches nextTick only after that drain ends. Lesson 08 has the same rule for a nextTick scheduled inside a promise callback.

1. CommonJS entry: body, then nextTick, then promises, then the loop, timers first.
2. ES module entry: the loader awaits evaluation, the body runs inside a promise job, V8 keeps draining promise jobs, then Node drains nextTick, then the loop.
3. The timers versus check race is decided later, in the first iteration, by whether 1 millisecond has passed. It exists in both module systems.
4. Inside a macrotask callback (timer, I/O, or `setImmediate`), both systems agree: nextTick, then promises.

**Example. The same four lines as `.cjs` and `.mjs`.**

javascript

```
// order.cjs and order.mjs (identical bytes)
process.nextTick(() => console.log('top: nextTick'));
Promise.resolve().then(() => console.log('top: promise'));
setTimeout(() => {
  process.nextTick(() => console.log('timer: nextTick'));
  Promise.resolve().then(() => console.log('timer: promise'));
}, 0);
```


bash

```
$ node order.cjs
top: nextTick
top: promise
timer: nextTick
timer: promise
$ node order.mjs
top: promise
top: nextTick
timer: nextTick
timer: promise
```

Only the top-level nextTick versus promise pair flips. A `.js` file under `"type": "module"` matched the `.mjs` output.

**Example. Timeout versus immediate is still a race in an ES module.**

bash

```
$ for b in 1 2 3; do for f in tvi.cjs tvi.mjs; do printf "batch $b $f: "; for i in $(seq 200); do node $f | paste -sd' '; done | sort | uniq -c | paste -sd' '; done; done
batch 1 tvi.cjs:     178 immediate timeout      22 timeout immediate
batch 1 tvi.mjs:     190 immediate timeout      10 timeout immediate
batch 2 tvi.cjs:     193 immediate timeout       7 timeout immediate
batch 2 tvi.mjs:     189 immediate timeout      11 timeout immediate
batch 3 tvi.cjs:     183 immediate timeout      17 timeout immediate
batch 3 tvi.mjs:     191 immediate timeout       9 timeout immediate
```

ESM does not make that order deterministic. Two things do. Add 2 milliseconds of synchronous work after scheduling, and timeout won every run in both formats. Or schedule from inside an I/O callback. The run counts are in Good to know.

### Common mistakes & gotchas (additional topics)

- **Reading ELU as CPU.** ELU is time outside `epoll_wait`, not CPU time. A loop blocked in `spawnSync('sleep')` or `Atomics.wait` for 300 milliseconds shows ELU 1.0 while the CPU is idle. The `Atomics.wait` case measured `1` on v24.19.0.
- **Subtracting two `utilization` numbers.** Pass the earlier reading back in.
- **Measuring ELU at startup.** On the main thread the values stay 0 until bootstrap finishes. Take the first reading inside the loop, for example in a `setImmediate`.
- **Treating low ELU as fast.** ELU 0.15 with a 300 millisecond block is still a 300 millisecond stall. Watch delay too.
- **Expecting an ES module to fix the top-level timer race.** It does not.
- **Porting order-sensitive code from `.cjs` to `.mjs`.** Top-level nextTick versus promise order flips. A listener that "worked" because nextTick ran first can break quietly.

### Edge case worked through: one `import` line flips the order of a `.js` file

Since v22.7.0 and v20.19.0, syntax detection is on by default. A `.js` file with no `"type"` field, or with no `package.json`, is an ES module if it contains ES module syntax. Adding an `import` changes the order of the top-level callbacks.

javascript

```
// detect/a.js: no package.json anywhere up the tree
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));

// detect/b.js: the same, plus one import line
import 'node:process'; // ESM syntax, no "type" field anywhere
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
```


bash

```
$ node detect/a.js
nextTick
promise
$ node detect/b.js
promise
nextTick
```

Nothing about the two callbacks changed. `b.js` was loaded by the ESM loader, so its body ran inside a promise job. If order matters, do not infer the module system from the extension. `typeof require === 'function'` is false in ESM. Or stop depending on top-level order.

### ⭐ Interview lens (additional topics)

> **Q: “ELU is 0.2 but p99 latency is terrible. ELU is 1.0 on another service but latency is fine. How can both be true?”**  
> ELU is the share of time the loop was not waiting in `epoll_wait`. Event-loop delay is how late callbacks actually ran. A mostly idle loop with one 300 millisecond synchronous block has low ELU and a bad tail. A loop of many 2 millisecond callbacks back to back has ELU near 1, meaning no spare capacity, while every timer still runs on time. Use ELU to decide capacity. Use delay to alert on latency. The limit of ELU is that it is not CPU. A sleep in `spawnSync` also reports ELU 1 while the processor is idle.

> **Q: “Does `setTimeout(0)` vs `setImmediate` at the top level become deterministic in an ES module?”**  
> No. In both module systems it depends on whether 1 millisecond passed before the first timers phase. What an ES module changes is top-level nextTick versus promise order. The module body runs inside a promise job, so its promise callbacks run before its nextTick callbacks. Inside a timer, I/O, or `setImmediate` callback, nextTick still wins in both formats. The limit is assuming the extension tells you the system. One `import` in a `.js` file with no `"type"` is enough to flip that top-level pair.
