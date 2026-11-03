---
title: "Timers: setTimeout, setInterval, setImmediate & the Event Loop"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/timers
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Timers: setTimeout, setInterval, setImmediate & the Event Loop

*10 min read · Updated 24 Jul 2026 Topic 25 of 70 Bookmark Mark done Why it matters Timers look like the simplest API in Node · Topic 25 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/timers](https://www.geekyfrontend.in/learn/nodejs-backend-kit/timers)

---

## Say it in 30 seconds

setTimeout, setInterval, and setImmediate schedule a function for a later turn of the event loop: a timeout runs once after at least the delay you asked for, an interval repeats, and setImmediate runs in the check phase on the next loop iteration. They exist so retries, deadlines, and polling can wait without blocking the thread. The trade-off is that the delay is a minimum, not a promise of an exact time, and an interval you never clear keeps the process alive and can leak memory.

## Why it matters

Timers look like the simplest API in Node, "run this later", and they are where the event loop becomes visible. You use them for retry backoffs, request deadlines, polling, debouncing, rate limiting, and scheduled cleanup. Knowing when a callback actually runs, and how that lines up with promises and I/O, is what lets you reason about order instead of guessing. I/O means input and output.

A single question, what order do these logs print, shows whether you understand the event loop, microtasks versus macrotasks, and that setTimeout of 0 does not mean now. A microtask is a small job such as a promise callback. A macrotask is a timer or an I/O callback. Leaked intervals and late timeouts are real production bugs.

## The concept, simply

Node gives you three scheduling primitives. setTimeout(fn, ms) runs fn once after at least ms milliseconds. setInterval(fn, ms) runs fn repeatedly every ms until you stop it. setImmediate(fn) runs fn on the next loop iteration, after the current I/O phase. Each returns a handle you cancel with clearTimeout, clearInterval, or clearImmediate.

Two more sit ahead of them. process.nextTick, and promise microtasks, drain before the loop moves on. The important truth: a timer specifies a minimum delay, not an exact one. The callback runs when the event loop reaches the timers phase and the thread is free, never sooner.

![Event loop phases showing timers, poll, and check, with nextTick and microtasks draining between phases](assets/i22_01_094ff453.svg)

setTimeout fires in the timers phase. setImmediate fires in the check phase. process.nextTick and promise microtasks drain between phases, ahead of both.

## How it works (deep)

The event loop runs in phases and repeats. The three that matter here are the timers phase, where expired setTimeout and setInterval callbacks run, the poll phase, where I/O callbacks run and where the loop waits for new I/O, and the check phase, where setImmediate callbacks run. Between every phase, Node drains two higher-priority queues first: the process.nextTick queue, then the promise microtask queue. That is why an await continuation or a then callback always runs before the next setTimeout, even one with delay 0.

setTimeout(fn, 0) does not run immediately. The callback is registered, the current synchronous code finishes, microtasks drain, and only when the loop reaches the timers phase does fn run. A Promise.resolve().then queued in the same turn runs first, because microtasks jump ahead of the next macrotask. process.nextTick beats even that, because its queue drains before microtasks. Per turn the order is: current synchronous code, then the nextTick queue, then promise microtasks, then the next event-loop phase, timers or poll or check.

setTimeout of 0 versus setImmediate is order-dependent at the top level. Called from the main module, which one runs first depends on how much time the loop has already used before the timers phase. Called from inside an I/O callback, which runs in the poll phase, setImmediate always fires first, because check is the very next phase after poll, while timers is a full loop away.

A setInterval that is never cleared runs forever. If its callback closes over large objects, those objects stay in memory. Timers also keep the process alive. By default a pending timer stops Node from exiting. If a background poller should not block shutdown, call unref on the handle so the loop can exit while that timer is the only thing left. setInterval does not guarantee even spacing. If the callback, or a blocked loop, takes longer than the interval, runs bunch up or drift. A self-scheduling setTimeout, one that schedules the next call only after the previous one finishes, keeps a real gap.

Node stores a timer's delay as a signed 32-bit integer, so the maximum is 2147483647 milliseconds, about 24.8 days. Anything larger, or NaN, Infinity, or a negative number, is clamped to 1 millisecond and Node emits a TimeoutOverflowWarning. A naive timeout of 30 days therefore fires almost immediately. Long delays must be chunked, re-armed in bounded steps, or driven by a scheduler that compares wall-clock time. A non-integer delay is truncated. A delay below 1 is treated as 1.

node:timers/promises is the form to reach for in async code. setTimeout(ms, value, { signal, ref }) returns a promise that resolves to value after the delay, so await setTimeout(200) replaces a hand-rolled promise wrapper. An AbortSignal cancels a pending delay, and the promise rejects with an AbortError. ref false mirrors unref. There is also a setInterval async-generator form. for await of setInterval yields on each tick, and because your loop body is awaited before the next yield, it avoids the bunching the callback form suffers. It is the clean way to write a cancellable poller that does not overlap itself.

## Code examples

The ordering that interviewers ask about — predict the output:

javascript

```
console.log('1: sync start');

setTimeout(() => console.log('2: setTimeout 0'), 0);

Promise.resolve().then(() => console.log('3: promise microtask'));

process.nextTick(() => console.log('4: nextTick'));

console.log('5: sync end');

// Output order:
// 1: sync start
// 5: sync end
// 4: nextTick          (nextTick queue drains first)
// 3: promise microtask (microtasks next)
// 2: setTimeout 0      (timers phase last)
```

Clearing timers to cancel work, and using `unref` so a poller does not block exit:

javascript

```
// A cancellable interval:
const handle = setInterval(() => console.log('poll'), 1000);
// Later, stop it — otherwise it runs forever and can leak memory:
clearInterval(handle);

// A background heartbeat that must not keep the process alive on shutdown:
const beat = setInterval(() => sendHeartbeat(), 30_000);
beat.unref(); // process can exit even while this timer is pending
```

A promise-based delay and a timeout wrapper — the modern way to add deadlines:

javascript

```
import { setTimeout as delay } from 'node:timers/promises';

// Await a delay without wrapping setTimeout by hand:
await delay(200);
console.log('ran after ~200ms');

// Race any promise against a deadline using AbortSignal.timeout:
async function fetchWithTimeout(url, ms) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  return res.json();
}
// If the request exceeds ms, it rejects with a TimeoutError.
```

Reliable fixed spacing with self-scheduling `setTimeout` instead of `setInterval`:

javascript

```
// setInterval can bunch up if the task runs long; this waits for completion,
// THEN schedules the next run — guaranteeing a real gap between executions.
async function poll(task, gapMs) {
  while (true) {
    await task();
    await new Promise((r) => setTimeout(r, gapMs));
  }
}
```

## Common mistakes & gotchas

- setTimeout(fn, 0) does not run immediately. It runs after the current synchronous code, the nextTick queue, and all microtasks, and only when the timers phase is reached. Zero is a minimum.
- An uncleared setInterval runs forever and, if it captures large state, leaks memory. Keep the handle and clearInterval when you are done.
- setInterval does not space runs evenly. If the callback or a blocked loop overruns the interval, runs drift or pile up. Self-schedule with setTimeout when you need a real gap.
- A long synchronous computation delays every timer, because callbacks run only when the loop is free. The timer is fine. The blocking code is the problem.
- setTimeout of 0 versus setImmediate is not deterministic in the main module. Inside an I/O callback, setImmediate is first.
- A pending timer keeps the process alive. unref a background timer that should not block exit.
- Recursive process.nextTick drains fully before the loop advances, so it can starve I/O and timers.
- A delay longer than 2147483647 milliseconds, about 24.8 days, or NaN, Infinity, or a negative number, is clamped to 1 millisecond with a TimeoutOverflowWarning. Chunk long waits, or compare wall-clock time.
- Racing timers/promises setTimeout against other work without aborting the loser leaves the timer, and its signal listener, alive until it fires.

## Best practices

- Store timer handles and clear them. An uncleared setInterval is a leak.
- Prefer a self-scheduling setTimeout over setInterval when even spacing, or waiting for async work, matters.
- Use node:timers/promises for await-based delays.
- Put deadlines on AbortSignal.timeout, which cancels the underlying work instead of only ignoring a late result.
- Call unref on background timers that should not keep the process alive.
- Keep each turn of the loop short. Move heavy CPU work to worker threads so timers and I/O stay responsive.
- Order on every turn: synchronous code, then nextTick, then microtasks, then timers, poll, and check.

## ⭐ Interview lens

> **Q: Does `setTimeout(fn, 0)` run `fn` immediately?** No. It schedules `fn` to run in the timers phase after the current synchronous code completes and after the `nextTick` and microtask queues drain. Zero is a minimum delay; the actual delay depends on when the loop reaches the timers phase and whether the thread is free.
> No. setTimeout(fn, 0) registers fn to run in the timers phase after the current synchronous code finishes and after the nextTick queue and the promise microtask queue have drained. Zero is a minimum delay, not "now". The callback runs when the loop actually reaches the timers phase and the thread is free. For example, a log on the line after setTimeout(fn, 0) prints before fn, and a Promise.then queued beside it also prints before fn. The limit is a busy loop. If the thread is stuck in synchronous work, even a timeout of 1000 milliseconds waits until that work finishes. The timer is late because the loop was blocked, not because the clock was wrong.

> **Q: In what order do `setTimeout(0)`, `Promise.then`, and `process.nextTick` run?** `process.nextTick` first (its queue drains before everything), then Promise microtasks, then the `setTimeout` callback in the timers phase. Microtasks always beat macrotasks; `nextTick` beats even microtasks.
> process.nextTick runs first. Its queue drains before anything else, including promise microtasks. Then the promise then callbacks run, because they are microtasks and they drain before the next macrotask. Then the setTimeout callback runs, in the timers phase. So the order is nextTick, then the promise, then the timeout. For example, if you schedule all three and then log "sync", the sync log is first, because it is still on the current stack, and the three callbacks come after in that order. The limit of this order is setImmediate. At the top level, setTimeout of 0 and setImmediate can go either way. The nextTick-then-microtask-then-timer order does not tell you which of those two wins.

> **Q: `setTimeout(fn,0)` vs `setImmediate(fn)` — which runs first?** At the top level it is non-deterministic and depends on loop timing. But *inside an I/O callback*, `setImmediate` always runs first, because `check` is the phase immediately after `poll`, whereas the timers phase is a full loop iteration away.
> At the top level of the main module it is non-deterministic. It depends on how far the loop has already gotten before the timers phase. Inside an I/O callback, setImmediate always runs first. I/O callbacks run in the poll phase, check is the very next phase, and the timers phase is a full lap away. So a setImmediate scheduled from a file or network callback runs before a setTimeout of 0 scheduled in that same callback. The limit is "inside I/O". The guarantee does not apply to code at the top of the file, and it does not apply to a timer scheduled from a promise. Use the rule only where you are actually in a poll-phase callback.

> **Q: Why did my `setTimeout(fn, 1000)` fire much later than 1 second?** Because a timer's delay is a minimum. If the event loop was busy — a long synchronous task or a backlog of callbacks — `fn` waits until the loop is free and reaches the timers phase. The timer was not late; the loop was blocked.
> Because the delay is a minimum. The callback runs when the event loop is free and reaches the timers phase, not when the wall clock hits exactly 1000 milliseconds. A long synchronous task, or a backlog of other callbacks, holds the thread, and every timer waits behind it. The timer was not mis-set. The loop was busy. For example, a JSON parse of a huge payload scheduled just before the timeout will push the timeout out by however long that parse takes. The limit of blaming the timer is the overflow case, which is different: a delay above 2147483647 milliseconds is clamped to 1 millisecond. That one fires early, with a TimeoutOverflowWarning, rather than late.

## Cheat-card

- setTimeout runs once after at least the delay. setInterval repeats. setImmediate runs on the next loop, in the check phase.
- Cancel with clearTimeout, clearInterval, or clearImmediate.
- Each turn: synchronous code, then process.nextTick, then promise microtasks, then timers, poll, and check.
- A delay is a minimum. A blocked loop delays every timer.
- Inside an I/O callback, setImmediate beats setTimeout of 0. At the top level that order is not guaranteed.
- An uncleared setInterval leaks and keeps the process alive. unref background timers.
- Even spacing, or waiting for async work: a self-scheduling setTimeout, not setInterval.
- In async code, use node:timers/promises. For a deadline that stops the work, use AbortSignal.timeout.
- The maximum delay is 2147483647 milliseconds. Longer, or NaN, Infinity, or negative, becomes 1 millisecond.

## Good to know

- How can a `setInterval` cause a memory leak? If it is never cleared and its callback closes over objects, those objects stay alive for the life of the process and the interval keeps firing. Clear it, and unref one that should not block shutdown.

- Why prefer a self-scheduling `setTimeout` over `setInterval` for polling an API? setInterval fires on a fixed schedule even if the previous call has not finished, so slow responses overlap or bunch. Scheduling the next setTimeout after each call finishes leaves a real gap and no overlap.

- timeout.refresh was added in v10.2.0. It restarts the same timer from now, with the same delay, and it re-arms a timer that has already fired. After clearTimeout, refresh does not bring it back.
- timeout.hasRef was added in v11.0.0, and immediate.hasRef too. It is true when the timer holds the process open. unref makes it false. ref makes it true.
- scheduler.wait and scheduler.yield, from node:timers/promises, were added in v17.3.0 and v16.14.0. They are Stability 1, experimental. wait is the promise form of setTimeout. yield is the promise form of setImmediate, useful inside a long CPU loop.
- Additional examples: 7 Oct 2026, examples verified on Node v24.19.0.

---

## Learn More

- [Timers | Node.js Documentation nodejs.org](https://nodejs.org/api/timers.html)
- [Discover JavaScript Timers nodejs.org](https://nodejs.org/learn/asynchronous-work/discover-javascript-timers)
- [Node.js Timers (setTimeout, setInterval, setImmediate) Thomas Gentilhomme](https://www.youtube.com/watch?v=hkvCtgxdaMU)
- [Outbound HTTP: fetch, undici and http.request (this kit)](44-outbound-http-fetch-undici-and-http-request.md)

---

## Additional topics

### `timeout.refresh()`

`timeout.refresh()` sets an existing `Timeout`'s start time to *now* and reschedules it to fire after its original delay, with the same callback. It returns the same `Timeout` object. You need it for timers that are pushed back on every event: an idle timeout on a socket or session, a watchdog, a debounce. Without it, each event does `clearTimeout(t); t = setTimeout(fn, ms)`, which allocates a new `Timeout` object and needs a mutable variable that every piece of code holding the old handle must see.

How it works:

1. `setTimeout(fn, ms)` creates a `Timeout` that records its start time and `ms`.
2. `t.refresh()` sets the start time to the current time. The timer now fires `ms` after this call, not after the original start.
3. The callback, delay and ref/unref state stay the same, and the method returns `t` itself.
4. If the timer has already fired, `refresh()` re-arms it, so the callback runs again (the docs say "will reactivate the timer"; see the edge case below).
5. After `clearTimeout(t)`, `refresh()` does not bring the timer back (observed in the edge case run).

**Example — an idle timeout that activity keeps pushing back.**

javascript

```
// An idle timeout: close the "session" after 300 ms with no activity.
// refresh() restarts the same Timeout object from now, with the same delay and callback.
const t0 = Date.now();
const at = () => `~${Math.round((Date.now() - t0) / 100) * 100} ms`;

const idle = setTimeout(() => console.log(`idle timeout fired at ${at()}`), 300);

// "Activity" at 100, 200 and 300 ms keeps pushing the deadline back
for (const ms of [100, 200, 300]) {
  setTimeout(() => { idle.refresh(); console.log(`activity at ${at()} -> refresh()`); }, ms);
}
// No more activity: it fires 300 ms after the last refresh, at ~600 ms

// refresh() returns the same object, so it chains and needs no new handle
console.log('refresh() returns the same timer:', idle.refresh() === idle);

// Real output (Node v24.19.0):
//   refresh() returns the same timer: true
//   activity at ~100 ms -> refresh()
//   activity at ~200 ms -> refresh()
//   activity at ~300 ms -> refresh()
//   idle timeout fired at ~600 ms
```

Each activity moves the deadline to 300 ms after itself, so the timeout fires at about 600 ms, 300 ms after the last activity.

### `timeout.hasRef()`

`timeout.hasRef()` (added in v11.0.0; `immediate.hasRef()` too) returns `true` if the timer currently keeps the event loop alive, and `false` after `unref()`. A *ref'd* handle counts as pending work: while it exists, Node does not exit. `unref()` takes the timer out of that count and `ref()` puts it back. `hasRef()` lets code check that state instead of tracking it in a separate flag, for example a library that only unrefs its internal timer if the caller has not asked for a ref'd one, or a test asserting that a background timer will not hold the process open.

How it works:

1. A new `Timeout` or `Immediate` is ref'd: `hasRef()` is `true`.
2. `t.unref()` marks it as not holding the loop open: `hasRef()` is `false`. The timer still fires if the process is still running at that time.
3. `t.ref()` reverses that: `hasRef()` is `true` again.
4. When only unref'd handles remain, the loop has no ref'd work and the process exits.

**Example — reading the ref state.**

javascript

```
const t = setTimeout(() => {}, 1000);
console.log('new timer      hasRef():', t.hasRef());
t.unref();
console.log('after unref()  hasRef():', t.hasRef());
t.ref();
console.log('after ref()    hasRef():', t.hasRef());

const imm = setImmediate(() => {});
console.log('setImmediate   hasRef():', imm.hasRef());

// A library can check before deciding whether its timer should hold the process open
t.unref();
console.log('unref() again  hasRef():', t.hasRef(), '-> the script exits now instead of in 1 s');

// Real output (Node v24.19.0):
//   new timer      hasRef(): true
//   after unref()  hasRef(): false
//   after ref()    hasRef(): true
//   setImmediate   hasRef(): true
//   unref() again  hasRef(): false -> the script exits now instead of in 1 s
```

The last state is unref'd, so nothing holds the loop open and the script exits at once instead of waiting for the 1-second timer. A timed run (`/usr/bin/time -f '%e s elapsed' node hasref.mjs`) printed `0.02 s elapsed`.

### `scheduler.wait()` and `scheduler.yield()` from `timers/promises`

`node:timers/promises` exports a `scheduler` object with two methods that follow the web platform's Scheduling APIs draft. Both are **Stability 1 – Experimental** and both were added in v17.3.0 and v16.14.0 (per the v24 docs). On v24.19.0 they print no `ExperimentalWarning`, but experimental APIs can change in any release.

- **`scheduler.wait(delay[, options])`** returns a promise that resolves (with `undefined`) after `delay` ms. The docs define it as equal to `timersPromises.setTimeout(delay, undefined, options)`. `options` takes `signal` (an `AbortSignal` to cancel the wait) and `ref` (`false` so the wait does not hold the process open).
- **`scheduler.yield()`** returns a promise that resolves in the next check phase. The docs define it as equal to `timersPromises.setImmediate()` with no arguments.

Without `yield`, a long synchronous loop in an async function holds the thread until it ends: every other callback (other requests, I/O completions, timers) waits behind it. Awaiting `scheduler.yield()` every N items splits the work across event-loop turns.

How it works:

1. `await scheduler.yield()` queues the rest of your async function as a `setImmediate`-style callback and returns control to the event loop.
2. The loop runs whatever is already due: the rest of the current phase, then poll (I/O), then the check phase, where callbacks queued before yours run first.
3. Your function resumes in the check phase and processes the next batch.
4. `await scheduler.wait(ms, { signal })` works like the promise `setTimeout`: the function resumes in the timers phase after `ms`, or the promise rejects with an `AbortError` when the signal aborts.

**Example — `wait` with and without a signal, and `yield` letting a queued callback run.**

javascript

```
import { scheduler } from 'node:timers/promises';

// scheduler.wait(ms, { signal, ref }) — same as timers/promises setTimeout(ms, undefined, options)
const t0 = Date.now();
const v = await scheduler.wait(100);
console.log(`wait(100) resolved with ${v} after ~${Math.round((Date.now() - t0) / 100) * 100} ms`);

const err = await scheduler.wait(5000, { signal: AbortSignal.timeout(50) }).catch((e) => e);
console.log('wait with signal:', err.name, err.code, '| cause:', err.cause.name);

// scheduler.yield() — same as timers/promises setImmediate(): resume in the next check phase.
// Some other callback is already queued (think: another request waiting for its turn).
async function crunch(label, yieldEvery) {
  setImmediate(() => console.log(`  [${label}] other callback ran`));
  let sum = 0;
  for (let i = 1; i <= 3_000; i++) {
    sum += i;
    if (yieldEvery && i % yieldEvery === 0) {
      console.log(`  [${label}] processed ${i}, yielding`);
      await scheduler.yield();
    }
  }
  console.log(`  [${label}] loop done, sum = ${sum}`);
}
console.log('without yield:');
await crunch('A', 0);
await scheduler.yield();             // let A's queued callback run before the next demo
console.log('with yield every 1,000 items:');
await crunch('B', 1_000);

// Real output (Node v24.19.0):
//   wait(100) resolved with undefined after ~100 ms
//   wait with signal: AbortError ABORT_ERR | cause: TimeoutError
//   without yield:
//     [A] loop done, sum = 4501500
//     [A] other callback ran
//   with yield every 1,000 items:
//     [B] processed 1000, yielding
//     [B] other callback ran
//     [B] processed 2000, yielding
//     [B] processed 3000, yielding
//     [B] loop done, sum = 4501500
```

In run A the queued callback waits until the whole loop is done. In run B it runs at the first `yield`, between the first and second batch.

### Common mistakes & gotchas (additional topics)

- **Expecting `refresh()` to be a no-op on a timer that already fired.** It re-arms the timer and the callback runs again. Clear the timer with `clearTimeout` when you are done with it.
- **Expecting `refresh()` to change the delay.** It reuses the original delay. For a different delay, clear the timer and create a new one.
- **Reading `hasRef() === false` as "this timer will not fire".** An unref'd timer still fires if the process is alive at that time. `hasRef()` only says whether the timer holds the process open.
- **Treating `scheduler` as stable.** Both methods are Stability 1 (Experimental). For production code that must not change, `setTimeout` / `setImmediate` from `node:timers/promises` do the same jobs and are stable.
- **Yielding too often.** Each `scheduler.yield()` costs a full event-loop turn. Yield every batch of work (here every 1,000 items), not every item.

### Edge case worked through: `refresh()` after the timer has fired

javascript

```
// refresh() on a timer that has ALREADY fired re-arms it: the callback runs again.
const t0 = Date.now();
const at = () => `~${Math.round((Date.now() - t0) / 100) * 100} ms`;
let runs = 0;

const t = setTimeout(() => console.log(`callback run ${++runs} at ${at()}`), 100);

setTimeout(() => {
  console.log(`at ${at()} the timer already fired; calling refresh()`);
  t.refresh();
}, 200);

// clearTimeout() is what stops it for good; refresh() after clear does nothing
setTimeout(() => { clearTimeout(t); t.refresh(); console.log(`at ${at()} cleared, then refresh()`); }, 500);
setTimeout(() => console.log(`at ${at()} total callback runs: ${runs}`), 800);

// Real output (Node v24.19.0):
//   callback run 1 at ~100 ms
//   at ~200 ms the timer already fired; calling refresh()
//   callback run 2 at ~300 ms
//   at ~500 ms cleared, then refresh()
//   at ~800 ms total callback runs: 2
```

The callback ran a second time, 100 ms after `refresh()` was called at about 200 ms, although the timer had already fired at about 100 ms. After `clearTimeout(t)`, the same `refresh()` call did nothing: the total stays at 2. So a "fire once" timer that some code path refreshes after it fired turns into a second, unexpected run, unless that path checks whether the work is still needed or the timer is cleared.

### ⭐ Interview lens (additional topics)

> **Q: “How would you implement an idle timeout that resets on every incoming message, without creating a new timer each time?”**  
> A: Create one `setTimeout(onIdle, ms)` and call `timer.refresh()` on every message. `refresh()` restarts the same `Timeout` object from now with the same delay and callback, so no new handle is allocated. Clear it with `clearTimeout` when the connection closes. *Trap:* calling `refresh()` after the timer fired re-arms it, so the idle callback can run twice.

> **Q: “What is `scheduler.yield()` and when would you use it?”**  
> A: An experimental `timers/promises` method (Stability 1, added in v17.3.0) that resolves in the next check phase, the same as the promise form of `setImmediate()`. Awaiting it every N items inside a long CPU loop lets other callbacks run between batches instead of waiting for the whole loop.
