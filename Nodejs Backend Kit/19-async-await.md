---
title: "Async / Await"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/async-await
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Async / Await

*9 min read · Updated 24 Jul 2026 Topic 18 of 70 Bookmark Mark done Why it matters async · Topic 18 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/async-await](https://www.geekyfrontend.in/learn/nodejs-backend-kit/async-await)

---

## Say it in 30 seconds

async/await is syntax that lets you write promise code top to bottom: an async function always returns a promise, and await pauses that function until the promise settles, then gives you the value or throws the rejection. It exists so try, catch, loops, and early return work with asynchronous results. The trade-off is that the code looks sequential, so independent awaits run one after another unless you start the promises first and wait with Promise.all.

## Why it matters

This is the pattern most backend code uses. It removes callback nesting and long then chains, and ordinary try/catch works again.

The readability is also the trap. Three independent requests awaited one after another take the sum of their times, not the slowest. Interviewers hand you three awaits and ask how to make them overlap. Knowing that this is promise syntax, and when to stop reading it as a straight line, is the point.

## The concept, simply

Marking a function async does two things. The function always returns a promise: a returned value becomes the fulfilment, and a throw becomes the rejection. And you may use await inside it.

await takes a promise, pauses that function until the promise settles, and then evaluates to the fulfilled value. If the promise rejects, await throws the reason like a normal exception.

await pauses your function. It does not block the thread. While this function is parked, the event loop, the loop that runs queued timers and I/O, is free to handle other requests. I/O means input and output. Only this one function is waiting.

![Left side shows code written with await reading top to bottom; right side shows the engine desugaring it into a .then continuation that suspends the function and frees the event loop](assets/i15_01_55bcdfc8.svg)

The source reads top to bottom. The engine turns each await into a continuation that leaves the thread free.

## How it works

An async function is a state machine. At an await it saves its local state, attaches the rest of the function to the promise as a continuation, and returns control to the caller. When the promise settles, that continuation is scheduled as a microtask. A microtask runs after the current stack and before the next timer. So const u = await getUser() is roughly getUser().then(u => { the rest of the function }). Everything after an await runs on a later microtask, never on the current stack.

A rejected promise throws at the await line, so try/catch/finally works. An uncaught throw inside an async function rejects the promise that function returned, and the caller has to handle that.

![Three lanes showing the synchronous call stack draining first, then the microtask queue where await continuations run, then macrotasks like timers](assets/i15_02_11c5707a.svg)

Code after an await resumes as a microtask, ahead of a timer queued at the same time.

Two awaits in a row mean the second job does not even start until the first has finished. The total time is the sum. Independent jobs must be started first, so you have the promises in hand, and then awaited together with Promise.all. The total time is then about the slowest one.

![Top timeline shows three 100ms tasks awaited one after another totalling 300ms; bottom shows the same three started together and awaited via Promise.all totalling 100ms](assets/i15_03_7088db7b.svg)

Awaiting in a row adds the durations. Starting the promises first and awaiting them together takes as long as the slowest.

The failure on the other side is unbounded parallelism. Promise.all on ten thousand ids starts all ten thousand jobs at once, opens that many sockets or file handles, and often falls over or hits a rate limit. Bounded concurrency means at most N jobs in flight. A library such as p-limit does this. The idea is a fixed pool of workers pulling from a shared index.

A minimal limiter: N workers drain one shared queue, and each result stays in input order because the worker writes to the index it claimed.

javascript

```
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;              // claim an index — safe on one thread
      results[i] = await fn(items[i], i);
    }
  }
  const size = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: size }, worker));
  return results;
}

// At most 5 requests in flight at once, regardless of ids.length.
const rows = await mapLimit(ids, 5, fetchRow);
```

await Promise.all rejects on the first rejection and does not cancel the others. They run to completion and their results are discarded. A straggler that rejects with nothing awaiting it can still raise an unhandled rejection after your catch has run. When a partial success is acceptable, use Promise.allSettled so every outcome is captured.

## Code examples

The sequential trap and its fix. The first version takes the sum of all three; the second takes the max because the requests overlap:

javascript

```
// SLOW — sequential: each await waits for the previous (≈300ms).
async function slow() {
  const a = await load('a'); // 100ms
  const b = await load('b'); // another 100ms
  const c = await load('c'); // another 100ms
  return [a, b, c];
}

// FAST — parallel: start all three, then await together (≈100ms).
async function fast() {
  const [a, b, c] = await Promise.all([load('a'), load('b'), load('c')]);
  return [a, b, c];
}
```

Sequential is correct — and required — when steps *depend* on each other. You cannot parallelise what needs the previous result:

javascript

```
async function checkout(userId) {
  const user = await getUser(userId);        // must run first
  const cart = await getCart(user.cartId);   // needs user
  const charge = await pay(cart.total);      // needs cart
  return charge.receipt;
}
```

Error handling reads like synchronous code — the rejected promise throws at the `await`, and `catch` receives it. `finally` runs either way:

javascript

```
async function safeLoad(id) {
  try {
    const data = await load(id);
    return process(data);
  } catch (err) {
    console.error('load failed:', err.message);
    return null;                 // graceful fallback
  } finally {
    console.log('attempt finished'); // always runs
  }
}
```

Iterating with `await` in a `for...of` is sequential by design — use it when order matters or to limit concurrency. For unordered parallelism, map to promises and `Promise.all`. Note that `forEach` does *not* await:

javascript

```
// Sequential, ordered — one at a time.
for (const id of ids) {
  await handle(id);
}

// Parallel — all at once, results in order.
const results = await Promise.all(ids.map((id) => handle(id)));

// BUG: forEach ignores the returned promise — these run "in the background",
// and the outer function does NOT wait for them.
ids.forEach(async (id) => { await handle(id); }); // don't do this
```

## Common mistakes & gotchas

- A forgotten await gives you the pending promise, not the value, so user.isAdmin reads a property off a promise. The work is also not sequenced.
- Awaiting independent calls one per line adds their durations. Start them together and await Promise.all.
- A missing await or return lets the function finish early, and a rejection becomes unhandled.
- await inside forEach or a map that you do not collect does not wait. forEach ignores the promise its callback returns. Use for...of to go one by one, or Promise.all on a map to run together.
- Promise.all on a huge array can open thousands of sockets. Batch the work, or cap it with a limiter.
- Inside a try, return await lets the local catch see a rejection. return x hands the still-pending promise to the caller and skips that catch. Outside a try the difference is an extra microtask.
- Top-level await works in ES modules, files ending in mjs or a package with type module. It does not work in the body of a classic CommonJS module.

## Best practices

- Use async/await for readability, and Promise.all as soon as the jobs are independent.
- Start independent promises before you await them.
- Use try/catch/finally for errors and cleanup.
- Use for...of with await for ordered work. Do not expect forEach to wait.
- Cap concurrency on large collections with batches or a limiter such as p-limit.
- Await or return every promise you create. A lint for floating promises catches the rest.

## ⭐ Interview lens

> **Q: Does `await` block the event loop?**  
> No. await suspends only the current async function. It saves that function's state, schedules the rest as a continuation on the promise, and returns control to the caller so the event loop can run other requests, timers, and I/O. The JavaScript thread is not frozen. What people picture, a blocked server until the database answers, is what a synchronous call such as readFileSync does, not what await does. The limit is everything after the await in that same function: that code does not run until the promise settles. Other functions are free. This one is parked.

> **Q: These three awaits take 300ms — make them 100ms.**  
> Those three awaits are independent, but each one starts only when the previous await resumes, so the times add up to about 300 milliseconds. Call all three functions first, without awaiting, so the three promises are already running, then await Promise.all of that array. The wall time drops to the slowest call, about 100 milliseconds. Do this only when no call needs the previous result. If step two needs the user id from step one, the awaits have to stay in order. The other limit is the opposite mistake: Promise.all on thousands of ids starts thousands of jobs at once and can exhaust sockets. Cap the number in flight.

> **Q: What does an `async` function return?**  
> Always a promise. If you return 5, the caller receives a promise that fulfils with 5, not the number 5. If you throw, or if an awaited promise rejects and you do not catch it, the returned promise rejects with that reason. That is why a caller can await your function or attach then and catch. It is also why an async function that you forget to await becomes a floating promise: the caller holds no handler, and a rejection can crash the process under Node's default. The limit of the "always a promise" rule is that the executor-style work inside may still throw before it returns if you are not in an async function. Inside an async function, a throw becomes a rejection.

> **Q: Why doesn't `await` work inside `forEach`? (trap)**  
> forEach does not look at the promise its callback returns. It calls the function for every element and moves on, so the loop finishes immediately while the async work runs detached. There is no way for the surrounding function to await that. Use for...of with await when you want one item at a time, for example to keep order or to limit concurrency. Use Promise.all on arr.map when the items are independent and you want them to overlap. The limit of for...of is that it is sequential on purpose: the next iteration starts only after the body finishes, so it will not speed up independent calls.

## Cheat-card

- An async function always returns a promise. return fulfils it. throw rejects it.
- await pauses that function and frees the event loop. It does not block the thread.
- Sequential awaits add durations. Use them only when a step needs the previous result.
- For independent work, start the promises, then await Promise.all.
- A rejected await throws, so try/catch works. Inside try, use return await if the local catch must see the rejection.
- for...of awaits. forEach does not. Cap a huge Promise.all.
- Top-level await is for ES modules, not CommonJS module scope.

## Good to know

- What is `async/await` compiled to conceptually? It is a promise state machine. Each await suspends the function and attaches the rest as a microtask continuation, which is the same idea as the code after the await becoming a then callback.

- When does `return await x` differ from `return x`? Inside a try, return await lets the local catch handle a rejection. return x hands the still-pending promise to the caller and skips your catch. Outside a try the difference is one extra microtask.
- Additional examples: 7 Oct 2026, examples verified on Node v24.19.0.
- `AbortSignal.timeout(ms)`: added in v17.3.0.
- `stream.iterator({ destroyOnReturn: false })`: added in v16.3.0, stable since v24.0.0.

---

## Learn More

- [async function (MDN) MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function)
- [Using promises (MDN) MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises)
- [async/await simply explained YouTube](https://www.youtube.com/watch?v=wKY4-WMmbZw)
- [async/await vs promises YouTube](https://www.youtube.com/watch?v=spvYqO_Kp9Q)
- [async/await is easy! YouTube](https://www.youtube.com/watch?v=9j1dZwFEJ-c)

---

## Additional topics

### `for await` and async iterators

An **async iterable** is any object with a `[Symbol.asyncIterator]()` method. That method returns an **async iterator**: an object whose `next()` returns a promise for `{ value, done }`, and which may also have a `return()` method for cleanup. `for await (const x of source)` is the loop that drives this protocol: it calls `next()`, awaits the promise, runs the body with `value`, and repeats until `done` is `true`. It exists for data that arrives over time and in pieces (pages of an API, chunks of a file, rows from a database cursor, messages from a queue). Without it you either load everything into one array first, which costs memory and delays the first item, or you write a manual `while` loop around `next()` and forget the cleanup on early exit.

There are three ways to get an async iterable in Node:

- **Async generators.** `async function* gen() { … yield x; … }`. Calling `gen()` returns an object that is both the iterable and the iterator. Inside, you can `await` before each `yield`.
- **Your own object** with `[Symbol.asyncIterator]()`, written by hand.
- **Built-in sources.** Every `stream.Readable` (including `fs.createReadStream`, an HTTP request, `process.stdin`), `events.on(emitter, name)`, `readline` interfaces, and `timers/promises.setInterval`.

How it works:

1. `for await` calls `source[Symbol.asyncIterator]()` once to get the iterator.
2. Each round it calls `iterator.next()` and awaits the returned promise. The async function pauses here; the event loop runs other work.
3. If the result has `done: false`, the loop body runs with `value`. If `done: true`, the loop ends.
4. The next `next()` call is made only after the body finishes (including any `await` inside it), so there is never more than one item in flight. This is built-in backpressure.
5. If the loop exits early (`break`, `return`, or a `throw` in the body), `for await` calls `iterator.return()`. In an async generator this runs its `finally` blocks; on a `Readable` stream it destroys the stream.
6. If `next()` rejects, the loop throws that error at the `for await` line, where a surrounding `try/catch` can catch it.

`for await` is only valid inside an `async` function or at the top level of an ES module.

**Example — an async generator, a hand-written iterator, and early `break`.**

javascript

```
import { setTimeout as sleep } from 'node:timers/promises';

// 1. An async generator: `async function*` + `yield`. Each value can be awaited before it is yielded.
async function* pages(total) {
  try {
    for (let page = 1; page <= total; page++) {
      await sleep(10);                       // stands in for one HTTP call per page
      console.log(`  fetched page ${page}`);
      yield [`row ${page}a`, `row ${page}b`];
    }
  } finally {
    console.log('  generator cleanup ran');  // runs on normal end AND on early break
  }
}

for await (const rows of pages(3)) console.log('loop got', rows);

// 2. The same protocol by hand: an object with [Symbol.asyncIterator]() returning { next, return }
const countdown = {
  [Symbol.asyncIterator]() {
    let n = 3;
    return {
      async next() { return n > 0 ? { value: n--, done: false } : { value: undefined, done: true }; },
      async return() { console.log('  return() called'); return { value: undefined, done: true }; },
    };
  },
};
for await (const n of countdown) {
  console.log('countdown', n);
  if (n === 2) break;                        // early exit calls return()
}

// 3. Early break on the generator: return() runs its finally block, no more pages are fetched
for await (const rows of pages(100)) {
  console.log('loop got', rows, '-> break');
  break;
}

// Real output (Node v24.19.0):
//     fetched page 1
//   loop got [ 'row 1a', 'row 1b' ]
//     fetched page 2
//   loop got [ 'row 2a', 'row 2b' ]
//     fetched page 3
//   loop got [ 'row 3a', 'row 3b' ]
//     generator cleanup ran
//   countdown 3
//   countdown 2
//     return() called
//     fetched page 1
//   loop got [ 'row 1a', 'row 1b' ] -> break
//     generator cleanup ran
```

The first loop runs the generator to the end, so its `finally` runs after page 3. The countdown object shows the raw protocol: `break` at `2` makes `for await` call `return()`. The last loop breaks after one page out of 100: `return()` runs the generator's `finally` and page 2 is never fetched.

**Example — `for await` over a `Readable` stream, and what `break` does to it.**

javascript

```
import { createReadStream } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';

await writeFile('log.txt', 'line\n'.repeat(10_000));          // 50,000-byte local file

// Every Readable is an async iterable: each iteration awaits the next chunk.
let chunks = 0, bytes = 0;
for await (const chunk of createReadStream('log.txt', { highWaterMark: 16 * 1024 })) {
  chunks++; bytes += chunk.length;
}
console.log(`full read: ${chunks} chunks, ${bytes} bytes`);

// Breaking out early calls the iterator's return(), which destroys the stream.
const stream = createReadStream('log.txt', { highWaterMark: 16 * 1024 });
stream.on('close', () => console.log("stream 'close' event"));
for await (const chunk of stream) {
  console.log('first chunk', chunk.length, 'bytes -> break');
  break;
}
console.log('after break: destroyed =', stream.destroyed, '| bytesRead =', stream.bytesRead);
await new Promise((r) => setImmediate(r));
await rm('log.txt');

// Real output (Node v24.19.0):
//   full read: 4 chunks, 50000 bytes
//   first chunk 16384 bytes -> break
//   after break: destroyed = true | bytesRead = 16384
//   stream 'close' event
```

`highWaterMark: 16 * 1024` is set explicitly so the chunk count does not depend on the default (64 KiB since Node 22, see lesson 35): 50,000 bytes arrive as 4 chunks. After `break`, `return()` has destroyed the stream: `destroyed` is `true`, only the first 16,384 bytes were read, and `'close'` fires. The file descriptor is released without any explicit cleanup in your code.

### Timeouts with AbortSignal

`await` waits as long as the promise takes, which can be forever. A timeout in async/await code is a deadline that makes the pending `await` reject, and the right way to build one is an `AbortSignal` from `AbortSignal.timeout(ms)` passed into every operation the function awaits. The operations then stop their own work at the deadline instead of only being ignored. Full coverage is in [`22-abortcontroller-and-abortsignal.md`](22-abortcontroller-and-abortsignal.md).

How it works:

1. Create the deadline once: `const signal = AbortSignal.timeout(ms)`.
2. Accept `{ signal }` in your async function and pass it to each awaited call (`fetch`, `timers/promises`, `fs/promises`, your own signal-aware functions).
3. When the deadline passes, the call currently being awaited rejects. Node core APIs reject with an `AbortError` whose `cause` is the `TimeoutError`; `fetch` rejects with the `TimeoutError` itself.
4. The rejection throws at that `await`, so the rest of the function is skipped and your `try/catch` runs.
5. In `catch`, check `signal.aborted` to tell "our deadline passed" from "the operation failed".
6. For a `for await` loop, pass the signal to the iterable (for example `timers/promises.setInterval(ms, value, { signal })`). The pending `next()` rejects and the loop throws.

**Example — a deadline for a whole async function, and for a `for await` loop.**

javascript

```
import { setTimeout as sleep, setInterval as every } from 'node:timers/promises';

const fakeQuery = (ms, signal) => sleep(ms, `rows after ${ms} ms`, { signal });

// 1. A deadline for a whole async function: one signal, passed to every await inside
async function buildReport({ signal }) {
  const a = await fakeQuery(100, signal);
  const b = await fakeQuery(100, signal);
  const c = await fakeQuery(100, signal);           // the deadline passes during this one
  return [a, b, c];
}
const deadline = AbortSignal.timeout(250);
try {
  console.log(await buildReport({ signal: deadline }));
} catch (err) {
  if (!deadline.aborted) throw err;                 // a real failure, not our timeout
  console.log('report:', err.name, '| cause:', err.cause.name);
}

// 2. A deadline for a for-await loop: the iterator rejects and the loop throws
let ticks = 0;
try {
  for await (const _ of every(100, null, { signal: AbortSignal.timeout(350) })) {
    console.log('poll', ++ticks);
  }
} catch (err) {
  console.log(`poller stopped after ${ticks} ticks:`, err.name, err.code);
}

// Real output (Node v24.19.0):
//   report: AbortError | cause: TimeoutError
//   poll 1
//   poll 2
//   poll 3
//   poller stopped after 3 ticks: AbortError ABORT_ERR
```

`buildReport` gets through two 100 ms queries; the third is cancelled at 250 ms. The error is Node's `AbortError` with `cause.name === 'TimeoutError'`. The poller yields three ticks (100, 200, 300 ms) and then the iterator rejects at 350 ms.

### Common mistakes & gotchas (additional topics)

- **`for await` over an array of already-started promises.** The loop awaits them one at a time, in array order. A later promise that rejects while the loop is still waiting on an earlier one has no handler yet, and the process crashes with an unhandled rejection (see the edge case below). Use `Promise.all` / `Promise.allSettled` for a set of promises; keep `for await` for sources that produce items over time.
- **Expecting `for await` to run items in parallel.** It is sequential by design: the next `next()` waits for the body to finish.
- **Breaking out of a stream loop and then reading the stream again.** `break` calls `return()`, which destroys the stream. Use `stream.iterator({ destroyOnReturn: false })` if you need to keep it open; in a test run, a second loop over the same stream then read the remaining items.
- **Forgetting `finally` in an async generator.** Cleanup written after the loop inside the generator does not run on early `break`; only `finally` does.
- **A timeout that does not reach the operation.** `Promise.race([op(), timeoutPromise])` throws on time but leaves `op()` running. Pass the signal into `op`.

### Edge case worked through: `for await` over an array of promises crashes on an early rejection

javascript

```
const sleep = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => fail ? rej(new Error(v)) : res(v), ms));

const promises = [sleep(200, 'slow ok'), sleep(50, 'fast failure', true)];
try {
  for await (const v of promises) console.log('got', v);
} catch (err) {
  console.log('caught in loop:', err.message);   // never reached
}
```

bash

```
$ node edge.mjs; echo "exit code $?"
file:///…/l18/edge.mjs:1
const sleep = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => fail ? rej(new Error(v)) : res(v), ms));
                                                                                     ^

Error: fast failure
    at Timeout._onTimeout (file:///…/l18/edge.mjs:1:86)
    at listOnTimeout (node:internal/timers:635:17)
    at process.processTimers (node:internal/timers:571:7)

Node.js v24.19.0
exit code 1
```

The `catch` never runs. At 50 ms the second promise rejects, but `for await` is still waiting on the first one (200 ms) and has not attached anything to the second. Node sees a rejection with no handler and, in the default `--unhandled-rejections=throw` mode, ends the process with exit code 1. `Promise.all` attaches a handler to every promise immediately, so the same failure is caught:

javascript

```
const sleep = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => fail ? rej(new Error(v)) : res(v), ms));

const promises = [sleep(200, 'slow ok'), sleep(50, 'fast failure', true)];
try {
  for (const v of await Promise.all(promises)) console.log('got', v);
} catch (err) {
  console.log('caught:', err.message);   // Promise.all attached a handler to every promise at once
}

// Real output (Node v24.19.0):
//   caught: fast failure
```

### ⭐ Interview lens (additional topics)

> **Q: “What happens to a `Readable` stream when you `break` out of `for await (const chunk of stream)`?”**  
> A: `for await` calls the iterator's `return()`, and the stream's iterator responds by destroying the stream: `destroyed` becomes `true`, the file descriptor or socket is released, and `'close'` is emitted. In an async generator, the same `return()` call runs its `finally` blocks.

> **Q: “How do you put a deadline on an async function that awaits several calls?”**  
> A: Create one `AbortSignal.timeout(ms)` and pass it to every awaited call. At the deadline, the call in progress rejects and the error throws at its `await`. In `catch`, `signal.aborted` tells you it was the deadline. *Trap:* racing against a timer promise only stops you waiting; the work keeps running.
