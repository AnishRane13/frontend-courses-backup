---
title: "Promises"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/promises
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Promises

*9 min read · Updated 24 Jul 2026 Topic 17 of 70 Bookmark Mark done Why it matters Promises are the backbone of modern asynchronous JavaScript · Topic 17 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/promises](https://www.geekyfrontend.in/learn/nodejs-backend-kit/promises)

---

## Say it in 30 seconds

A promise is an object that stands for a value that is not ready yet: it starts pending, then settles once as fulfilled with a value or rejected with a reason, and you attach later work with then. It exists so async results can be returned, stored, and combined, which callbacks could not do without nesting. The trade-off is that a rejection nobody handles can crash the process, and combinators such as Promise.all do not stop the other jobs when one of them fails.

## Why it matters

async/await is syntax on top of promises. Every await unwraps a promise, and every async function returns one. If promises are fuzzy, await will surprise you.

Promises also fixed the practical problems of callbacks: the nesting, the repeated error checks, and the fact that a callback is not a value you can pass around. You can return a promise, store it, hand it to Promise.all, or chain transformations. Interviews ask about the combinators all, allSettled, race, and any because they show whether you can reason about several jobs at once.

## The concept, simply

A promise is always in one of three states. Pending means it is still working. Fulfilled means it finished with a value. Rejected means it failed with a reason. The move from pending to either result is called settling, and it happens at most once. After that, the state and the value are frozen.

![A promise starts pending and transitions one-way to either fulfilled via resolve or rejected via reject, and once settled the value is frozen](assets/i14_01_9c7501db.svg)

A promise settles once, and it does not go back.

You read the outcome with three methods. then registers what to do on fulfilment, and optionally on rejection. catch handles rejection. finally runs cleanup either way and does not change the value. All three return a new promise, which is what makes a chain possible.

## How it works

new Promise runs its executor function immediately, on the current stack. resolve settles it as fulfilled. reject settles it as rejected. If you resolve with another promise, or with any thenable, meaning any object that has a then method, the outer promise does not fulfil with that object as the value. It adopts the inner one and waits for it to settle. That flattening is why you rarely see a promise nested inside a promise.

Handlers you attach with then never run synchronously, even if the promise has already settled. They are scheduled as microtasks. The microtask queue drains completely after the current stack finishes and before the event loop runs the next macrotask, such as a timer or an I/O callback. I/O means input and output. That is why a then callback runs before a setTimeout of 0 that was queued at the same time.

![Three lanes showing synchronous call stack first, then the microtask queue draining fully, then the macrotask queue, illustrating that promise callbacks run before timers](assets/i14_02_11c5707a.svg)

Promise callbacks drain before the next timer or I/O callback.

Each then returns a new promise for whatever its callback returns. A plain value is passed to the next then. A returned promise makes the chain wait. A throw, or a returned rejection, skips every later then until a catch. That is the same idea as an exception walking up a call stack, except the rejection walks down the chain.

Promise.resolve(x) returns x unchanged when x is already a native promise, and wraps anything else. Use it to normalise "a value or a promise" instead of wrapping an existing promise in new Promise. Adopting a thenable costs an extra microtask, because the engine schedules an internal then to unwrap it. A handler that returns Promise.resolve(v) therefore resumes one tick later than a handler that returns v directly.

Predict this order before you read the output. Synchronous logs run first, then microtasks, then the timer:

javascript

```
console.log('1 sync');
setTimeout(() => console.log('2 timeout'), 0);
Promise.resolve().then(() => console.log('3 microtask'));
queueMicrotask(() => console.log('4 microtask'));
console.log('5 sync');

// Output:
// 1 sync        ← runs now, on the call stack
// 5 sync        ← runs now, on the call stack
// 3 microtask   ← microtask queue drains before any timer
// 4 microtask   ← same queue, in registration order
// 2 timeout     ← macrotask — only after every microtask
```

The four combinators differ in when they settle and what they do with failure:

| Combinator           | Fulfils when                           | Rejects when                          | Result shape             |          |
| -------------------- | -------------------------------------- | ------------------------------------- | ------------------------ | -------- |
| `Promise.all`        | Every input fulfils                    | First input rejects (fail-fast)       | Array of values          |          |
| `Promise.allSettled` | All inputs settle                      | Never                                 | Array of `{status, value | reason}` |
| `Promise.race`       | First input to settle was a fulfilment | First input to settle was a rejection | Single value / reason    |          |
| `Promise.any`        | First input fulfils                    | Every input rejects                   | Value / `AggregateError` |          |

All four accept any iterable. Apart from allSettled, they propagate the first relevant settlement and do not cancel the others. There is no cancel operation on a promise, so the siblings run to completion no matter which combinator you used.

## Code examples

Promisifying a callback API by hand. The executor runs now; `resolve`/`reject` settle it later from inside the callback:

javascript

```
function delay(ms, value) {
  return new Promise((resolve, reject) => {
    if (ms < 0) return reject(new Error('ms must be >= 0'));
    setTimeout(() => resolve(value), ms);
  });
}

delay(100, 'done').then((v) => console.log(v)); // 'done' after 100ms
```

A chain that transforms a value step by step. Each `.then` hands its return to the next; the single `.catch` at the end handles a failure anywhere above it:

javascript

```
fetchUser(1)
  .then((user) => fetchOrders(user.id)) // return a promise → chain waits
  .then((orders) => orders.filter((o) => o.paid))
  .then((paid) => console.log('paid orders:', paid.length))
  .catch((err) => console.error('chain failed:', err.message))
  .finally(() => console.log('done, success or not'));
```

The four combinators cover distinct concurrency needs. `Promise.all` fails fast; `allSettled` reports every outcome:

javascript

```
// all: need every result; one rejection rejects the whole thing.
const [a, b, c] = await Promise.all([load('a'), load('b'), load('c')]);

// allSettled: never rejects — inspect each result individually.
const results = await Promise.allSettled([load('a'), load('b')]);
for (const r of results) {
  if (r.status === 'fulfilled') console.log('ok', r.value);
  else console.log('failed', r.reason.message);
}
```

`Promise.race` settles on the first to finish (win or lose) — ideal for timeouts. `Promise.any` waits for the first *success*, ignoring rejections until all fail:

javascript

```
// race: timeout wrapper — whichever settles first wins.
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timed out')), ms));
  return Promise.race([promise, timeout]);
}

// any: first mirror to succeed; rejects with AggregateError only if all fail.
const fastest = await Promise.any([mirror1(), mirror2(), mirror3()]);
```

![Four cards contrasting Promise.all fail-fast, allSettled never-rejects, race first-to-settle, and any first-fulfilment with their use cases](assets/i14_03_e1dd7f93.svg)

Pick the combinator by intent: every result (all), every outcome (allSettled), first settle (race), first success (any).

## Common mistakes & gotchas

- Forgetting to return inside then means the chain does not wait, and the next then receives undefined.
- A floating promise, one you neither return, await, nor catch, can reject with nobody listening, and its completion is unordered relative to your code.
- A chain with no catch leaves an unhandled rejection. In current Node that warns and, by default, can crash the process.
- Wrapping a function that already returns a promise in new Promise loses error propagation. Just return that promise.
- Promise.all does not cancel the others when one rejects. A later rejection with no handler can surface on its own.
- race settles on the first outcome, so a fast rejection wins. any ignores rejections until every input rejects.
- A then on an already settled promise still runs as a microtask, never in the current stack.

## Best practices

- End every chain with catch, or await it inside try/catch.
- Return the promise from inside then so the chain waits.
- Use the built-in combinator that matches the job: all, allSettled, race, or any.
- Reject with Error objects, not strings, so you keep a stack and a message.
- Do not wrap an existing promise in new Promise.
- Use allSettled when a partial failure is acceptable. Use all only when you need every result.

## ⭐ Interview lens

> **Q: What are the three states of a promise and which transitions are legal?**  
> A promise has three states: pending, fulfilled, and rejected. It starts pending and moves once, either to fulfilled with a value or to rejected with a reason. That move is called settling, and it is one-way. A second resolve or reject is ignored, and the value cannot be changed later. You observe it with then, catch, and finally, and each of those returns a new promise. For example, fs.promises.readFile gives you a promise that fulfils with the file bytes or rejects with the error. The limit is that settling is not "the work stopped". If you built the promise around a job that keeps running, the promise can ignore a later result, but it does not cancel that job.

> **Q: Does a `.then` handler run synchronously if the promise is already resolved?**  
> No. then always schedules its handlers as microtasks, even when the promise is already fulfilled. A microtask runs after the current synchronous stack finishes and before the next timer or I/O callback. So a log after Promise.resolve().then(...) still prints before the then handler, and that handler still prints before a setTimeout of 0 queued in the same turn. The same rule is why code after an await runs before the next timer. The limit is ordering, not speed: the handler is deferred by one microtask, which is usually soon, but it is never "right now" on this stack.

> **Q: Difference between `Promise.all` and `Promise.allSettled`?**  
> Promise.all fulfils only when every input fulfils, and it rejects as soon as any input rejects. The fulfilment value is an array of results in input order. Promise.allSettled never rejects. It waits for every input to settle and gives you an array of objects with status and either value or reason. Use all when one failure should fail the whole batch, such as loading three records you cannot proceed without. Use allSettled when you are sending ten notifications and you need to report which ones failed. The limit of all is that the rejection does not stop the other promises. They keep running.

> **Q: `Promise.race` vs `Promise.any`? (trap)**  
> Promise.race settles with whichever promise settles first, fulfilment or rejection, so a fast failure can win. Promise.any settles with the first fulfilment and ignores rejections. It rejects only when every input rejects, and the reason is an AggregateError whose errors array holds each failure. race is the one you use for "timeout versus the real call" if you only care which result you observe. any is the one you use for "first healthy mirror". The limit is the same for both: the losers keep running. race does not cancel them, and a later rejection can still be unhandled.

## Cheat-card

- States: pending, then fulfilled or rejected. Settles once.
- then, catch, and finally each return a new promise. Handlers are microtasks.
- all: every result, fail fast. allSettled: every outcome, never rejects.
- race: first to settle, so a rejection can win. any: first fulfilment, or AggregateError if all reject.
- Return inside then. End the chain with catch. Reject with an Error.
- None of the combinators cancel the other jobs.

## Good to know

- If `Promise.all` rejects, what happens to the other promises? Nothing stops them. all ignores their later results, and a later rejection with no handler can become an unhandled rejection.

- What does `resolve`-ing a promise with another promise do? The outer promise stays pending and adopts the inner one, taking its state and value when it settles. That thenable flattening is why promises do not nest.
- Promise.withResolvers is ES2024, not a Node-only API. typeof is undefined on Node v21.7.3 (V8 11.8) and function on Node v22.0.0 (V8 12.4) and on v24.19.0.
- Promise.try is ES2025. It is undefined on Node v22.0.0, v22.9.0, v22.10.0, and v22.23.3 (V8 12.4), and a function on Node v23.0.0 (V8 12.9) and on v24.19.0. Code that must run on Node 22 cannot call it.
- Additional examples: 7 Oct 2026, examples verified on Node v24.19.0.

---

## Learn More

- [Using promises developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [Promise developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
- [Promise.prototype.then() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/then)
- [JavaScript Promise in 100 Seconds Fireship](https://www.youtube.com/watch?v=RvYYCGs45L4)
- [JavaScript Promises In 10 Minutes Web Dev Simplified](https://www.youtube.com/watch?v=DHvZLI7Db8E)

---

## Additional topics

### `Promise.withResolvers()`

`Promise.withResolvers()` returns a plain object `{ promise, resolve, reject }`: a new pending promise plus the two functions that settle it. It is the same as writing `let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; });`, without the outer `let` variables. You need it when the code that creates the promise is not the code that settles it: a request map that resolves when a reply with the matching id arrives, a queue, a "ready" latch, a test helper. Without it, every such place repeats the executor trick, and the `let` variables are easy to read before the executor has assigned them.

How it works:

1. `Promise.withResolvers()` creates a pending promise and returns it together with its `resolve` and `reject` functions.
2. You return `promise` to the caller and store `resolve` / `reject` somewhere the settling code can reach (a `Map`, an object field).
3. Later, other code calls `resolve(value)` or `reject(err)`. The usual rules apply: the first call wins, later calls are ignored, and `.then` handlers run as microtasks.
4. Remove the stored functions once they have been used, or the map keeps growing.

**Example — a reply map: the promise is settled by a different event.**

javascript

```
import { EventEmitter } from 'node:events';

// A tiny RPC client: each call waits for a reply event that carries the same id.
const wire = new EventEmitter();
const pending = new Map();                 // id -> { resolve, reject }
let nextId = 1;

wire.on('reply', ({ id, ok, value }) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  ok ? p.resolve(value) : p.reject(new Error(value));
});

function call(method) {
  const id = nextId++;
  const { promise, resolve, reject } = Promise.withResolvers();
  pending.set(id, { resolve, reject });    // settle it later, from somewhere else
  setTimeout(() => wire.emit('reply', method === 'boom'
    ? { id, ok: false, value: 'remote failure' }
    : { id, ok: true, value: `${method} result` }), 10 * id);
  return promise;
}

console.log(await call('getUser'));
const results = await Promise.allSettled([call('a'), call('boom')]);
console.log(results.map((r) => r.status === 'fulfilled' ? r.value : `rejected: ${r.reason.message}`));
console.log('pending entries left:', pending.size);

// Real output (Node v24.19.0):
//   getUser result
//   [ 'a result', 'rejected: remote failure' ]
//   pending entries left: 0
```

### `Promise.try()`

`Promise.try(fn, ...args)` calls `fn(...args)` **right away, synchronously**, and returns a promise for the result. If `fn` returns a value, the promise fulfils with it. If `fn` returns a promise, the returned promise follows it. If `fn` throws synchronously, the promise rejects with the thrown error instead of the throw escaping to the caller. It exists because a function that "returns a promise" can still throw before it gets to return one (bad arguments, a `JSON.parse` on the first line), and a caller that only attached `.catch()` never sees that error.

How it works:

1. `Promise.try` calls `fn` with the extra arguments, inside an internal `try`.
2. A return value (or returned promise) resolves the new promise.
3. A synchronous throw rejects the new promise.
4. Because `fn` runs immediately, it runs before any microtask. `Promise.resolve().then(fn)` also turns throws into rejections, but runs `fn` one microtask later.

**Example — sync throws become rejections, and `fn` runs immediately.**

javascript

```
function parse(json) {           // a sync function that may throw
  return JSON.parse(json).id;
}
const log = (label) => [(v) => console.log(label, 'fulfilled:', v), (e) => console.log(label, 'rejected:', e.message)];

// 1. Calling it directly: a sync throw escapes, it is NOT a rejection
try { parse('{bad'); } catch (e) { console.log('direct call threw synchronously:', e.constructor.name); }

// 2. Promise.try runs fn now (synchronously) and turns a throw into a rejection
console.log('before Promise.try');
Promise.try(() => { console.log('  fn runs inside Promise.try, synchronously'); return parse('{"id":7}'); }).then(...log('try ok '));
Promise.try(parse, '{bad').then(...log('try bad'));      // extra arguments are passed to fn

// 3. Promise.resolve().then(fn) also catches the throw, but fn runs a tick later
Promise.resolve().then(() => console.log('  fn runs inside .then, later'));
console.log('after both calls');

// Real output (Node v24.19.0):
//   direct call threw synchronously: SyntaxError
//   before Promise.try
//     fn runs inside Promise.try, synchronously
//   after both calls
//   try ok  fulfilled: 7
//   try bad rejected: Expected property name or '}' in JSON at position 1 (line 1 column 2)
//     fn runs inside .then, later
```

`fn runs inside Promise.try, synchronously` prints before `after both calls`, while the `.then` version prints last.

### Cancellation with AbortController

Promises have no cancel operation. `Promise.race` only decides which result you *use*; it does not stop the others (see the combinator note above). Real cancellation needs the operation itself to accept a signal and stop. In Node that is `AbortController` / `AbortSignal`; the full treatment is in [`22-abortcontroller-and-abortsignal.md`](22-abortcontroller-and-abortsignal.md). Here is how it replaces the `withTimeout()` helper from this lesson's Code examples.

How it works:

1. Create the deadline as a signal: `AbortSignal.timeout(ms)`.
2. Pass the signal to the operation (`fetch`, `timers/promises`, `fs/promises` and most core APIs take `{ signal }`).
3. When the deadline passes, the signal aborts and the operation stops its own work and rejects.
4. In `catch`, check `signal.aborted` to tell a timeout from a real failure.
5. If the work finishes first, nothing is left running: the timer behind `AbortSignal.timeout` does not keep the process alive.

**Example — a `withTimeout` that really stops the work.**

javascript

```
import { setTimeout as sleep } from 'node:timers/promises';

// The work takes a signal and stops when it aborts
const work = (ms, signal) => sleep(ms, ms, { signal }).then((v) => { console.log(`  work(${ms}) finished`); return v; });

async function withTimeout(fn, ms) {
  const signal = AbortSignal.timeout(ms);   // no timer left behind: it does not hold the process open
  try {
    return await fn(signal);
  } catch (err) {
    if (signal.aborted) throw new Error(`timed out after ${ms} ms`, { cause: err });
    throw err;
  }
}

const t0 = performance.now();
const ms = () => `${Math.round((performance.now() - t0) / 100) * 100} ms`;
process.on('exit', () => console.log(`process exited at ~${ms()}`));

console.log('fast work:', await withTimeout((s) => work(100, s), 1500), `at ~${ms()}`);
await withTimeout((s) => work(1000, s), 300).catch((e) => console.log('slow work:', e.message, `at ~${ms()}`));

// Real output (Node v24.19.0):
//     work(100) finished
//   fast work: 100 at ~100 ms
//   slow work: timed out after 300 ms at ~400 ms
//   process exited at ~400 ms
```

`work(1000)` never prints `finished`: the sleep was cancelled at 300 ms. The process exits at about 400 ms, as soon as the last real work is done.

### Common mistakes & gotchas (additional topics)

- **Assuming `Promise.race` cancels the loser.** It only ignores the loser's result. Pass a signal and abort it.
- **Leaving the race timer running.** The `setTimeout` inside a hand-made timeout promise stays scheduled after the race is over, keeping the process alive and the closure in memory (see the edge case below). Clear it, or use `AbortSignal.timeout`.
- **Using `Promise.try` on Node 22.** It is `undefined` on every Node 22 release tested; calling it throws `TypeError: Promise.try is not a function`. It needs Node 23+.
- **Leaking stored resolvers.** With `Promise.withResolvers`, delete the map entry when the promise settles. A reply that never arrives leaves the entry forever, so pair it with a timeout.
- **Expecting `Promise.try(fn)` to defer `fn`.** It runs `fn` synchronously, in the current call stack. Use `Promise.resolve().then(fn)` if you need it to run later.

### Edge case worked through: the `withTimeout` above keeps the process alive

The `withTimeout(promise, ms)` in this lesson's Code examples gives the right answers, but run it and time the process:

javascript

```
// The withTimeout() from this lesson's Code examples, unchanged
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timed out')), ms));
  return Promise.race([promise, timeout]);
}
const work = (ms) => new Promise((r) => setTimeout(() => { console.log(`  work(${ms}) finished anyway`); r(ms); }, ms));

const t0 = performance.now();
const ms = () => `${Math.round((performance.now() - t0) / 100) * 100} ms`;
process.on('exit', () => console.log(`process exited at ~${ms()}`));

console.log('fast work:', await withTimeout(work(100), 1500), `at ~${ms()}`);
await withTimeout(work(1000), 300).catch((e) => console.log('slow work:', e.message, `at ~${ms()}`));

// Real output (Node v24.19.0):
//     work(100) finished anyway
//   fast work: 100 at ~100 ms
//   slow work: timed out at ~400 ms
//     work(1000) finished anyway
//   process exited at ~1500 ms
```

Two things go wrong. The slow `work(1000)` keeps running after the timeout and finishes at about 1400 ms, for nobody. And the fast call's 1500 ms timeout timer was never cleared, so the process cannot exit until about 1500 ms, although every result was ready at 400 ms. The `AbortSignal` version above fixes both: the work stops at the deadline, and no timer is left holding the event loop.

### ⭐ Interview lens (additional topics)

> **Q: “What is `Promise.withResolvers()` and when would you use it?”**  
> A: It returns `{ promise, resolve, reject }`, a pending promise plus its settle functions, so code other than the creator can settle it. Typical uses are reply maps keyed by request id, queues and latches. It replaces the "capture `resolve` from the executor into an outer `let`" pattern. Available from Node 22.

> **Q: “How is `Promise.try(fn)` different from `Promise.resolve().then(fn)`?”**  
> A: Both turn a synchronous throw from `fn` into a rejection. `Promise.try` calls `fn` immediately, in the current call stack; `.then(fn)` calls it in a later microtask. *Trap:* `Promise.try` needs Node 23 or later; it is missing on Node 22.
