---
title: "process.nextTick vs setImmediate"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/nexttick-vs-setimmediate
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# process.nextTick vs setImmediate

*10 min read · Updated 24 Jul 2026 Topic 8 of 70 Bookmark Mark done Why it matters Three functions promise to · Topic 8 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/nexttick-vs-setimmediate](https://www.geekyfrontend.in/learn/nodejs-backend-kit/nexttick-vs-setimmediate)

---

## Say it in 30 seconds

`process.nextTick` queues a function that runs after the current JavaScript returns, and before the event loop is allowed to take its next step. `setImmediate` queues a function for the check phase, a later stop on that loop.

`nextTick` exists so a library can finish the call that is running now before it fires a callback, for example so the caller can attach a listener first. The trade-off is starvation. If that callback keeps scheduling another `nextTick`, timers and file or network callbacks never get a turn.

The event loop is Node's scheduler. A phase is one of its stops. Check is the stop where `setImmediate` runs. A promise callback is a microtask, a small job drained before the loop moves on. A macrotask is one phase callback, such as a timer.

## Why it matters

The three "run this later" tools have misleading names, and guessing their order changes what users of your function observe. The expensive mistake is recursive `nextTick`. The process stays busy, and timers and I/O never run, so a server freezes while it looks alive.

## The concept, simply

From code that is running right now, soonest to latest:

1. **`process.nextTick(fn)`.** After the current operation, before the event loop may enter any phase. Its own queue drains completely first.
2. **Promise callbacks** (`.then`, `await`, `queueMicrotask`). The microtask queue. It drains right after nextTick. The next lesson covers it.
3. **`setImmediate(fn)`.** The check phase. A macrotask, meaning one turn of a phase.
4. **`setTimeout(fn, 0)`.** The timers phase, after a floor of about 1 millisecond. Also a macrotask.

![Four priority lanes stacked: process.nextTick first, Promise microtasks second, then setTimeout timers phase and setImmediate check phase as macrotasks](assets/i05_01_f4f3de83.svg)

nextTick and promises are not a phase. They run between phases. `setImmediate` and `setTimeout` are phases. At the same moment, the first group always wins. Between the two macrotasks, order depends on where you scheduled them.

## How it works

After the current function returns, and again at every phase boundary, Node empties the whole nextTick queue, including nextTicks added during that drain, then empties the promise queue. Only then may the loop move.

The loop cannot move while nextTick still has work. A callback that schedules another `nextTick` forever blocks timers, I/O, and `setImmediate`. A `setImmediate` scheduled during check runs on the next trip, so poll and timers still happen.

![Timeline showing a macrotask callback followed by a microtask drain, then another macrotask, then another drain, illustrating recursion risk](assets/i05_02_6c3fcc09.svg)

At the top of a file, `setTimeout` of 0 and `setImmediate` race, depending on whether about 1 millisecond has passed before the first timers phase. Inside an I/O callback, `setImmediate` always wins. That callback is in poll, check is next, and the timer waits for the loop to wrap around.

Node does not interrupt a promise drain for a nextTick that a promise just scheduled. It finishes the promise queue, then goes back to nextTick, and repeats until both are empty. Example 2b is that case. "nextTick first" means both were scheduled from synchronous code or from a macrotask.

Use nextTick for order. Make an error callback always asynchronous, so it never fires on the caller's stack. Or emit on nextTick so the caller can listen first.

## Code examples

**Example 1. The usual ordering question.**

javascript

```
console.log('start');

setTimeout(() => console.log('setTimeout'), 0);
setImmediate(() => console.log('setImmediate'));
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));

console.log('end');

// Output:
//   start
//   end
//   nextTick        <- microtask family, drains first (before promises)
//   promise         <- microtask queue, right after nextTick
//   setTimeout / setImmediate  (these two race at the top level)
```

`start` and `end` run first because they are synchronous. Then nextTick, then the promise. The timer and `setImmediate` are macrotasks, and at the top of a file their order is not guaranteed.

**Example 2. Inside I/O, immediate is fixed.**

javascript

```
const fs = require('fs');

fs.readFile(__filename, () => {
  setTimeout(() => console.log('setTimeout'), 0);
  setImmediate(() => console.log('setImmediate'));
  process.nextTick(() => console.log('nextTick'));
  Promise.resolve().then(() => console.log('promise'));
});

// Output (always):
//   nextTick
//   promise
//   setImmediate
//   setTimeout
```

nextTick and the promise drain before the loop leaves poll. Check runs `setImmediate`. The timer waits for the next trip's timers phase.

**Example 2b. A nextTick scheduled inside a promise waits for that promise queue.**

javascript

```
// ordering.js — run as CommonJS: node ordering.js
Promise.resolve().then(() => {
  console.log('promise A runs');
  process.nextTick(() => console.log('nextTick scheduled inside A'));
  Promise.resolve().then(() => console.log('promise B (queued inside A, after the nextTick)'));
});
Promise.resolve().then(() => console.log('promise C (queued before A ran)'));

// Real output (Node v24.19.0):
//   promise A runs
//   promise C (queued before A ran)
//   promise B (queued inside A, after the nextTick)
//   nextTick scheduled inside A
```

V8 empties the promise queue before Node returns to nextTick, so `C` and `B` both run first. "nextTick first" holds when both were scheduled from synchronous code or from a macrotask.

**Example 3. nextTick recursion freezes everything.**

javascript

```
let count = 0;
setTimeout(() => console.log('timer fired'), 100);

function loop() {
  if (++count % 1000000 === 0) console.log('still ticking', count);
  process.nextTick(loop); // never lets the loop advance
}
loop();

// Output:
//   still ticking 1000000
//   still ticking 2000000
//   ... forever. 'timer fired' NEVER prints — the loop is starved.
```

Replace `process.nextTick(loop)` with `setImmediate(loop)` and the timer does fire, because `setImmediate` yields between trips.

**Example 4. nextTick so listeners can attach.**

javascript

```
const EventEmitter = require('events');

class Thing extends EventEmitter {
  constructor() {
    super();
    // WRONG: emit here fires before caller can add a listener.
    // Defer so the 'ready' handler below is registered first.
    process.nextTick(() => this.emit('ready'));
  }
}

const t = new Thing();
t.on('ready', () => console.log('ready!')); // attached in time

// Output:
//   ready!
```

The `'ready'` listener on the next line is attached before the deferred emit runs.

## Common mistakes & gotchas

- **Reading `nextTick` as "the next turn of the loop."** It runs before the loop advances, ahead of every phase and ahead of promises.
- **Splitting work with recursive `nextTick`.** That starves the loop. Use `setImmediate` when you must yield to I/O.
- **Treating `nextTick` and `Promise.resolve().then` as one queue.** When both are scheduled from synchronous code or a macrotask, nextTick runs first.
- **Hearing `setImmediate` as "right now."** It runs in check, after poll and after pending microtasks.
- **Expecting one order for `setTimeout` of 0 and `setImmediate`.** Fixed only inside an I/O callback, and there immediate is first. At the top of a file it is a race.
- **Emitting from a constructor before the caller can listen.** A synchronous `'ready'` is missed by `.on` on the next line. Defer it with `nextTick`.
- **Expecting a nextTick inside a promise to jump the rest of that promise queue.** The promise queue empties first, including promises queued after the nextTick. The same rule flips Example 1 in an ES module entry: the body runs inside Node's promise loader, so `promise` prints before `nextTick`. Checked on Node v24.19.0 as `.cjs` versus `.mjs`.
- **Calling `setImmediate` faster than `setTimeout` of 0.** They are different phases. The firm rule is the I/O callback, where `setImmediate` is first.

## Best practices

- Use `setImmediate`, not `nextTick`, to break up work or to mean "after this phase, but let I/O run."
- Use `nextTick` only for an ordering guarantee: an API that is always asynchronous, or an emit deferred so callers can subscribe.
- Do not build an unbounded `nextTick` chain. Cap it, or hand off to `setImmediate`.
- Prefer promises or `queueMicrotask` unless you specifically need to run before the promise queue.
- If you depend on a phase, say so in a comment. "Runs in check, after I/O" is enough.

## ⭐ Interview lens

> **Q: `nextTick` vs `setImmediate` — one sentence each.**  
> `process.nextTick` is its own queue, not a phase of the event loop. When the current function returns, Node empties that queue, then promise callbacks, before the loop may move. `setImmediate` is a macrotask for the check phase, after poll, where I/O callbacks run. Schedule both from synchronous code and nextTick prints first. The limit is starvation. A nextTick that schedules another nextTick holds the loop. `setImmediate` waits for the next trip, so I/O still runs.

> **Q: Predict the output.**  
> `process.nextTick(() => console.log('a')); Promise.resolve().then(() => console.log('b')); setImmediate(() => console.log('c'));`  
> From synchronous code, such as a CommonJS file, you get `a`, then `b`, then `c`. The three lines only schedule work. When the stack ends, nextTick prints `a`, the promise microtask prints `b`, and check prints `c`. The limit is the module format. An ES module entry runs its body inside a promise job, so the promise can print before nextTick.

> **Q: How can `process.nextTick` freeze a Node server?**  
> The loop may not enter the next phase until the nextTick queue is empty, including nextTicks added while it drains. A callback that calls `process.nextTick` on itself keeps that queue full, so timers, I/O callbacks, and `setImmediate` never start. The same loop with `setImmediate` does not stick, because each call waits for the next trip and poll still runs. You pay in wall-clock time. The work is slower because you yield on purpose.

> **Q: Inside `fs.readFile`'s callback you schedule both `setTimeout(fn, 0)` and `setImmediate`. Which runs first?**  
> `setImmediate` always runs first. The read callback runs in poll. The next phase is check. The timeout waits for timers on the next trip. nextTick and promises scheduled in that same callback still run before both, because those queues drain before the loop leaves the boundary. The limit is location. At the top of the file, timeout and immediate are a startup race.

## Cheat-card

- **Order:** nextTick, then promises, then a macrotask in timers or check.
- `process.nextTick`: before the loop advances. Drains before promises.
- `setImmediate`: check phase. Yields between trips.
- `setTimeout(fn, 0)`: timers phase, after about 1 millisecond.
- Inside an I/O callback, `setImmediate` comes before `setTimeout` of 0.
- Recursive `nextTick` starves the loop. Recursive `setImmediate` yields.
- `nextTick` is for order. `setImmediate` is for yielding to I/O.

## Good to know

- Q: Why would a library emit an event via `process.nextTick` instead of synchronously? So the caller can attach listeners first. A constructor that emits `'ready'` during `new` runs before `.on('ready')` on the next line.
- Q: Is `setTimeout(fn, 0)` the same as `setImmediate`? No. The timer is clamped to about 1 millisecond and runs in the timers phase. `setImmediate` runs in check with no delay clamp. They race at the top of a file. Inside an I/O callback, `setImmediate` wins.

---

## Learn More

- [The Node.js Event Loop (process.nextTick vs setImmediate) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)
- [Understanding setImmediate() nodejs.org](https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate)
- [process.nextTick(callback[, ...args]) — API docs nodejs.org](https://nodejs.org/api/process.html)
- [setImmediate(callback[, ...args]) — Timers API docs nodejs.org](https://nodejs.org/api/timers.html)
- [This is how the Node.js Event Loop really works Software Developer Diaries](https://www.youtube.com/watch?v=paI6J8my3Yw)

