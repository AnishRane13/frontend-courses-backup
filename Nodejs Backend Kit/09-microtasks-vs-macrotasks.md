---
title: "Microtasks vs Macrotasks"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/microtasks-vs-macrotasks
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Microtasks vs Macrotasks

*10 min read · Updated 24 Jul 2026 Topic 9 of 70 Bookmark Mark done Why it matters Every asynchronous callback in Node lands in one of two categories · Topic 9 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/microtasks-vs-macrotasks](https://www.geekyfrontend.in/learn/nodejs-backend-kit/microtasks-vs-macrotasks)

---

## Say it in 30 seconds

A macrotask is one callback from a phase of the event loop, such as a timer, an I/O callback, or `setImmediate`. A microtask is a promise callback, an `await` continuation, or `queueMicrotask`. After every macrotask, Node empties the whole microtask queue, including jobs added during that drain, before it takes the next macrotask.

That is why a promise chain finishes before a timer that was scheduled earlier, and why `await` gives the caller a turn without blocking the thread. The trade-off is starvation. A chain that keeps scheduling another microtask never lets timers or I/O run.

`process.nextTick` is a separate queue that drains even before promises. A phase is one stop on the event loop.

## Why it matters

Which queue a callback sits in decides when it runs. Macrotasks are the phase callbacks. Microtasks are promise work, with `nextTick` as a higher-priority sibling. The rule is absolute. After every macrotask, the microtask queues drain completely before the next macrotask. That is also why a runaway promise chain can freeze I/O the same way a runaway `nextTick` can. The same two queues exist in the browser, so the order you learn here is JavaScript, not only Node.

## The concept, simply

- **Macrotask.** The loop takes one per turn. `setTimeout` and `setInterval` are timers. I/O callbacks are poll. `setImmediate` is check. Close handlers are the close phase.
- **Microtask.** The loop drains all of them, including ones scheduled during the drain, after each macrotask and at every phase boundary. That is `.then`, `.catch`, `.finally`, the continuation after `await`, and `queueMicrotask`. `process.nextTick` has its own queue and drains before promises.

![Two panels: macrotasks (setTimeout, setImmediate, I/O, close) taken one per turn, versus microtasks (nextTick, promises, queueMicrotask) drained fully between them](assets/i06_01_94834faf.svg)

One macro, then all micros, then one macro, then all micros.

## How it works

The drain is exhaustive. If microtask A schedules B, and B schedules C, all three run before the loop may move. That is why an `await` chain resolves in one burst, and why an endless chain freezes timers and I/O.

![Alternating sequence of macrotask callback then microtask drain, repeated, with a note that microtask recursion can starve the loop](assets/i06_02_6c3fcc09.svg)

Node keeps two queues in this family. It empties nextTick, then empties promises. If promises queued new nextTicks, it goes back, and it alternates until both are empty. It does not interrupt a promise drain. At the same scheduling point, nextTick beats a promise. Lesson 8 is the full ordering.

`await x` means: evaluate `x`, then schedule the rest of this function as a promise microtask. Everything before the first `await` is synchronous. At the `await`, the function suspends and the caller continues. The rest resumes as a microtask when the value settles.

The loop runs one macrotask callback, drains nextTick and promises, then runs the next macrotask callback. Microtasks are once per callback, not once per phase. Two due timers that each schedule a promise print `A`, `A-promise`, `B`, `B-promise`. They do not print both timers first.

| | Macrotask | Microtask |
| --- | --- | --- |
| Examples | `setTimeout`, `setInterval`, `setImmediate`, I/O, close | `.then`, `.catch`, `.finally`, `await`, `queueMicrotask`. `process.nextTick` is the higher-priority sibling |
| Lives in | A phase queue | The nextTick queue and V8's microtask queue. Neither is a phase |
| How many per turn | One callback, then a microtask drain | The whole queue, including work added during the drain |
| Starvation | Low. It yields between callbacks | High. A self-scheduling chain never lets the loop advance |

## Code examples

**Example 1. A microtask beats a macrotask.**

javascript

```
console.log('sync 1');
setTimeout(() => console.log('macro: timeout'), 0);
Promise.resolve().then(() => console.log('micro: promise'));
console.log('sync 2');

// Output:
//   sync 1
//   sync 2
//   micro: promise    <- microtask drains before the loop reaches timers
//   macro: timeout
```


**Example 2. A promise chain drains before any timer.**

javascript

```
setTimeout(() => console.log('timeout'), 0);

Promise.resolve()
  .then(() => console.log('p1'))
  .then(() => console.log('p2'))
  .then(() => console.log('p3'));

// Output:
//   p1
//   p2
//   p3
//   timeout
```

Each `.then` schedules the next microtask. The chain empties in one drain, before timers.

**Example 3. async and await ordering.**

javascript

```
async function main() {
  console.log('A');
  await null;          // suspends here; rest becomes a microtask
  console.log('C');
}

console.log('start');
main();
console.log('end');

// Output:
//   start
//   A         <- runs synchronously up to the await
//   end       <- control returned to caller at the await
//   C         <- resumes as a microtask after sync code finishes
```


**Example 4. The six-way ordering trap.**

javascript

```
console.log('1: sync');
setTimeout(() => console.log('2: setTimeout'), 0);
setImmediate(() => console.log('3: setImmediate'));
Promise.resolve().then(() => console.log('4: promise'));
process.nextTick(() => console.log('5: nextTick'));
(async () => { await null; console.log('6: await'); })();
console.log('7: sync');

// Output:
//   1: sync
//   7: sync
//   5: nextTick        <- nextTick queue drains first
//   4: promise         <- then the promise microtask queue...
//   6: await           <- ...including the await continuation (FIFO)
//   2: setTimeout / 3: setImmediate  (macrotasks; order races at top level)
```

Synchronous logs run first. Then nextTick, ahead of promises. Then the promise queue in order: the `.then` was scheduled before the `await` continuation. The two macrotasks race at the top of a file. In an ES module entry the nextTick versus promise pair flips. See Good to know.

## Common mistakes & gotchas

- **Microtasks are not once per loop iteration.** They drain after every macrotask callback and at every phase boundary.
- **A `setTimeout` of 0 does not beat a promise scheduled just before it.** The microtask queue empties before timers.
- **`await` does not block the thread.** It suspends that function and returns to the caller. The rest is a microtask.
- **An unbounded promise chain starves the loop,** the same way recursive `nextTick` does.
- **FIFO inside one queue is not priority across queues.** Promises are FIFO with each other. The nextTick queue outranks the whole promise queue.
- **Synchronous code beats everything.** Nothing async runs until the current stack is empty.
- **Microtasks do not drain once per phase.** Two due timers interleave with their own microtasks.
- **A long microtask drain is not interrupted by I/O.** Until the queue is empty, poll cannot run.

## Best practices

- Prefer `queueMicrotask` or promises over `process.nextTick` unless you must run before the promise queue.
- To split CPU work, use `setImmediate`, a macrotask, so I/O runs between chunks.
- Handle rejection inside a microtask. An unhandled rejection can crash the process under current Node defaults.
- If a bug depends on order, draw the two queues. Do not "fix" it with a 100 millisecond timeout.
- Keep work inside a `.then` short. A long synchronous stretch still blocks the thread.

## ⭐ Interview lens

> **Q: Define microtask vs macrotask in Node.**  
> A macrotask is one callback from a phase: a timer, an I/O callback, `setImmediate`, or a close handler. The loop runs one, then stops to drain microtasks. A microtask is a promise continuation, `queueMicrotask`, or, ahead of those, `process.nextTick`. The microtask queues drain completely after every macrotask, including jobs added during the drain. For example, a resolved promise and a `setTimeout` of 0 print the promise first. The limit is a chain that never ends. That drain never returns, so timers and sockets stall.

> **Q: Output?** `setTimeout(() => console.log('t'), 0); Promise.resolve().then(() => console.log('p'));`  
> `p` then `t`. Scheduling order does not matter. When the current stack ends, Node drains microtasks before it is allowed to enter the timers phase, so the promise runs first. The same promise still wins if you schedule it after the timeout line. The limit is a nextTick scheduled beside them. nextTick prints before `p`, because that queue drains first. And in an ES module entry file, top-level nextTick versus promise order flips.

> **Q: How often do microtasks drain — once per loop, once per phase, or more?**  
> More than once per phase. They drain after every macrotask callback, and again at phase boundaries. Two timers that are both due do not run back to back if each schedules a promise. You get timer A, A's promise, timer B, B's promise. A promise chain scheduled together resolves fully before the next timer. The limit is starvation. Because newly queued microtasks are part of the same drain, a chain that always schedules another one never reaches poll.

> **Q: Trace this async snippet.** `console.log(1); (async()=>{console.log(2); await null; console.log(4);})(); console.log(3);`  
> The output is 1, 2, 3, 4. The call runs synchronously until the first `await`, so 1 and 2 print, then the async function suspends and the caller prints 3. The rest of the async function is a promise microtask, so 4 prints after the stack is empty and before any timer. `await null` still costs a microtask. It does not resume immediately. The limit is everything after the first `await`. A second `await` is another microtask, not a continuation of the same one.

## Cheat-card

- One macrotask, then drain all microtasks, then the next macrotask.
- Macrotasks: `setTimeout`, `setInterval`, `setImmediate`, I/O, close.
- Microtasks: promise `.then` and `await`, `queueMicrotask`. nextTick drains first.
- Order: synchronous code, nextTick, promises, macrotasks. That nextTick-before-promise rule is for synchronous code and macrotask callbacks.
- `await` suspends one function. It does not block the thread.
- An endless microtask chain starves the loop. Yield with `setImmediate`.

## Good to know

- Q: Between a `process.nextTick` and a `Promise.then` scheduled together, which runs first? nextTick, when both were scheduled from synchronous code or from a macrotask. Node empties the nextTick queue before the promise queue. It does not interrupt a promise drain.
- Q: Can microtasks starve the event loop the way `nextTick` can? Yes. The drain includes microtasks added during the drain, so an endless chain never reaches timers or I/O. Hand off to `setImmediate`.
- Thenable extra ticks versus a plain value, observed: `await` of a native promise is 0. `await` of another thenable is +1. `resolve(thenable)` and returning a thenable from `.then` is +1. `resolve` of a native promise, or returning one from `.then`, is +2. An `async` function `return nativePromise` is +2 versus returning the value. `return await nativePromise` is +1, and it is the form a `try/catch` in that function can catch.
- `await` of a native promise passes it through, the V8 7.2 change that Node 12 picked up. On Node v10.24.1, `return promise` printed before `return await promise`. Node v12.22.12 already matched the Node 24 order.
- Example 4 as `.cjs` and `.mjs`: the three microtask lines were stable in 50 of 50 runs of each file. `setImmediate` printed first in 29 of 50 `.cjs` runs and 32 of 50 `.mjs` runs.

---

## Learn More

- [Using microtasks in JavaScript with queueMicrotask() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide)
- [In depth: Microtasks and the JavaScript runtime environment developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth)
- [Understanding setImmediate() (nextTick / microtask / macrotask queue order) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate)
- [JavaScript Visualized - Event Loop, Web APIs, (Micro)task Queue Lydia Hallie](https://www.youtube.com/watch?v=eiC58R16hb8)
- [Jake Archibald: In The Loop — event loop, setTimeout, micro tasks (JSConf.Asia) JSConf](https://www.youtube.com/watch?v=cCOL7MC4Pl0)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### Thenables cost extra microtask ticks

A thenable is any object with a callable `then`. Native promises are thenables too. When a promise is resolved with a thenable, the spec does not copy the value across. It queues a NewPromiseResolveThenableJob, one microtask whose only job is to call `thenable.then(resolve, reject)`. If that thenable is an already fulfilled native promise, the `then` call queues a second microtask, the reaction job, to deliver the value. So wrapping the same value in a promise delivers it one or two ticks later. Throughput does not care. Ordering does. Two paths that both "resolve with 42" can finish in different orders.

Per hop, measured below:

1. A plain value fulfills the derived promise immediately and queues its reaction. That is the baseline.
2. A native promise: tick 1 runs the ResolveThenableJob and calls `p.then`. Tick 2 runs the reaction that settles the outer promise. Plus 2 ticks.
3. A custom thenable whose `then` calls back synchronously: tick 1 runs the job, `then` resolves immediately, and nothing more is queued. Plus 1 tick.
4. `await` uses `PromiseResolve`, which returns a native promise as it is, instead of wrapping it. `await nativePromise` costs the same as `await 42`. This is the change V8 shipped in 7.2 and Node 12 picked up. Any other thenable is still wrapped, so `await thenable` costs plus 1 tick.

**Example. Counting ticks with an interleaved `.then` ladder.**

javascript

```
const p = Promise.resolve();

// Ticker: one log line per microtask turn.
p.then(() => console.log('tick 1'))
 .then(() => console.log('tick 2'))
 .then(() => console.log('tick 3'))
 .then(() => console.log('tick 4'))
 .then(() => console.log('tick 5'));

p.then(() => 'plain').then((v) => console.log(`  ${v} value arrives`));
p.then(() => Promise.resolve('promise')).then((v) => console.log(`  ${v} arrives`));
p.then(() => ({ then: (ok) => ok('thenable') })).then((v) => console.log(`  ${v} arrives`));

// Real output (Node v24.19.0), the same as .cjs and .mjs:
//   tick 1
//   tick 2
//     plain value arrives
//   tick 3
//     thenable arrives
//   tick 4
//     promise arrives
//   tick 5
```

`return 'plain'` arrives with tick 2. `return thenable` is one tick later. `return Promise.resolve(...)` is two ticks later.

**Example. `await`, `resolve()`, and async return values side by side.**

javascript

```
const thenable = { then: (ok) => ok('x') };

Promise.resolve()
  .then(() => console.log('tick 1'))
  .then(() => console.log('tick 2'))
  .then(() => console.log('tick 3'))
  .then(() => console.log('tick 4'));

(async () => { await 'x';                 console.log('  await plain value'); })();
(async () => { await Promise.resolve('x'); console.log('  await native promise'); })();
(async () => { await thenable;            console.log('  await thenable'); })();
new Promise((r) => r('x')).then(() => console.log('  resolve(plain value)'));
new Promise((r) => r(Promise.resolve('x'))).then(() => console.log('  resolve(native promise)'));
new Promise((r) => r(thenable)).then(() => console.log('  resolve(thenable)'));
(async () => Promise.resolve('x'))().then(() => console.log('  async fn: return promise'));
(async () => await Promise.resolve('x'))().then(() => console.log('  async fn: return await promise'));

// Real output (Node v24.19.0), identical in 30 runs and as .mjs:
//   tick 1
//     await plain value
//     await native promise
//     resolve(plain value)
//   tick 2
//     await thenable
//     resolve(thenable)
//     async fn: return await promise
//   tick 3
//     resolve(native promise)
//     async fn: return promise
//   tick 4
```


| Hand-off | Extra ticks versus a plain value |
| --- | --- |
| `await nativePromise` | 0 |
| `await thenable` | +1 |
| `resolve(thenable)` or `.then(() => thenable)` | +1 |
| `resolve(nativePromise)` or `.then(() => nativePromise)` | +2 |
| `async` function `return nativePromise` versus `return value` | +2 |
| `async` function `return await nativePromise` versus `return value` | +1 |

### Microtask order when the entry file is an ES module

The drain rules do not change. The context of top-level code does. A CommonJS entry is a plain function call. When it returns, Node drains nextTick, then promises. An ES module entry is evaluated inside the promise-based loader, so the body is already running inside a microtask drain. Promises it queues run in that drain. Node returns to nextTick only after V8 has emptied the promise queue. The body behaves like one big promise callback.

1. CommonJS: body, nextTick, promises, then the event loop.
2. ES module: the loader awaits evaluation, the body runs inside a promise job, the rest of the promise queue runs, then nextTick, then the loop.
3. Code after a top-level `await` resumes as a promise continuation, so its promises still run before its nextTicks, even if the awaited thing was a timer.
4. Inside a macrotask callback, both module systems agree. nextTick first.

**Example. This lesson's Example 4, as `.cjs` and as `.mjs`.**

bash

```
$ node six.cjs
1: sync
7: sync
5: nextTick
4: promise
6: await
3: setImmediate
2: setTimeout
$ node six.mjs
1: sync
7: sync
4: promise
6: await
5: nextTick
3: setImmediate
2: setTimeout
```

The three microtask lines did not move across 50 runs of each file. The last two lines are the timer race and did vary. The counts are in Good to know. Give the CommonJS answer, and say that it assumes CommonJS.

**Example. After a top-level `await`, promises still beat nextTick.**

javascript

```
// tla.mjs
await new Promise((r) => setTimeout(r, 10));   // module resumes from a timer
process.nextTick(() => console.log('after TLA: nextTick'));
Promise.resolve().then(() => console.log('after TLA: promise'));

// Real output (Node v24.19.0):
//   after TLA: promise
//   after TLA: nextTick
```

The timer callback only resolves the promise. The module body continues in the microtask drain that follows, so it is inside a promise job when it schedules both callbacks.

### Common mistakes & gotchas (additional topics)

- **Returning a promise from `.then` is not free.** It costs two extra ticks versus returning the value, and it can reorder another chain that is running at the same time.
- **`await promise` and `await thenable` are not the same.** A native promise passes through. Any other thenable is wrapped and costs one more tick. A promise object from a userland library is not a native `Promise`.
- **Tests that depend on tick counts break** when someone changes `return x` to `return Promise.resolve(x)`. If order matters, chain it explicitly.
- **"nextTick before promise" depends on where the code runs.** It holds for CommonJS top-level code and inside macrotask callbacks. In an ES module entry, and after a top-level `await`, promises queued there run first.

### Edge case worked through: `return await` is one tick *faster* than `return`, and the only one that catches

An `async` function that returns a promise has its result resolved with that promise, which costs plus 2 ticks. `return await p` waits inside the function. `await` of a native promise costs no extra tick, and the function then returns a plain value, so the total is one tick. The rejection also stays inside that function's `try`.

javascript

```
const slow = async () => Promise.resolve('x');        // returns a promise
const fast = async () => await Promise.resolve('x');  // awaits it first

Promise.resolve()
  .then(() => console.log('tick 1'))
  .then(() => console.log('tick 2'))
  .then(() => console.log('tick 3'));

slow().then(() => console.log('  return promise'));
fast().then(() => console.log('  return await promise'));
(async () => { try { return await Promise.reject(new Error('boom')); } catch (e) { return 'caught here'; } })()
  .then((v) => console.log(`  with try/catch: ${v}`));
(async () => { try { return Promise.reject(new Error('boom')); } catch (e) { return 'caught here'; } })()
  .catch((e) => console.log(`  without await: escaped the try -> ${e.message}`));

// Real output (Node v24.19.0):
//   tick 1
//   tick 2
//     return await promise
//     with try/catch: caught here
//   tick 3
//     return promise
//     without await: escaped the try -> boom
```

The old advice "do not write `return await`, it adds ticks" was true before the V8 7.2 change. The version check is in Good to know. On Node 24, `return await` is one tick shorter, and it is the only form whose own `try/catch` sees the rejection.

### ⭐ Interview lens (additional topics)

> **Q: “Two `.then` chains start together. One returns `42`, the other returns `Promise.resolve(42)`. Which next `.then` runs first, and by how much?”**  
> The plain `42` runs first, by two microtask ticks. Resolving with a thenable queues a ResolveThenableJob that calls `p.then`. Because that native promise is already fulfilled, the call queues one more reaction before the outer promise settles. A custom thenable that calls back synchronously costs one tick, not two. `await` of a native promise costs none, because `PromiseResolve` does not wrap it. The limit is treating every "return 42" as the same shape. Wrapping it in `Promise.resolve` inserts those ticks and can lose a race against another chain.

> **Q: “In an `.mjs` file, does `process.nextTick` still run before `Promise.then` at the top level?”**  
> No. The ES module entry runs inside the loader's promise job, so top-level promise callbacks are part of that drain, and Node reaches nextTick only after the promise queue is empty. In a `.cjs` file, and inside any timer, I/O, or `setImmediate` callback in either format, nextTick runs first. The limit is the word "always." It is the wrong word for top-level ESM, and also for any nextTick scheduled from inside a promise callback.
