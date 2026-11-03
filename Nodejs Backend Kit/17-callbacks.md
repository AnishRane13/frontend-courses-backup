---
title: "Callbacks"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/callbacks
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Callbacks

*10 min read · Updated 24 Jul 2026 Topic 16 of 70 Bookmark Mark done Why it matters Node · Topic 16 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/callbacks](https://www.geekyfrontend.in/learn/nodejs-backend-kit/callbacks)

---

## Say it in 30 seconds

A callback is a function you hand to Node now so Node can run it later, after slow work such as a file read finishes, instead of freezing the one JavaScript thread while it waits. Node does this so that one thread can keep serving other connections: it starts the slow job, returns immediately, and runs your function on a later turn of the event loop, the loop that runs queued work once the current stack of calls is empty. The trade-off is that the callback runs on a fresh empty stack, so a thrown error cannot reach the caller, and several steps that depend on each other end up nested.

## Why it matters

Node runs your JavaScript on one thread and still serves many connections, because it does not wait on slow work. You pass a function. Node starts the file read, the database query, or the call to another service, and runs that function when the answer is ready. That function is a callback. Promises and async/await sit on top of this pattern.

You meet callbacks in streams, in EventEmitter, in the classic fs and net APIs, and in packages written before 2016. A stack trace that shows up from nowhere, or an old library you wrap so it returns a promise, is this pattern.

## The concept, simply

A callback is a function you pass to another function so it can run later, when some work finishes. A synchronous callback, such as the function you give Array.map, runs immediately. An asynchronous callback is handed over now. Your code keeps running, and Node runs it on a future turn of the event loop once the event happens.

Node's convention is the error-first callback, also called node-style or an errback. The first parameter is the error. The result comes after it. On failure the first argument is an Error and the rest are undefined. On success the first argument is null and the data follows.

![Diagram of an error-first callback: caller passes a callback, the async op runs off the stack, then cb(err, data) is invoked with either the error path or the success path](assets/i13_01_a8b892c3.svg)

Check the error first. Use the data only after that.

## How it works

fs.readFile does not read the file on your thread. It registers the request with the operating system through libuv, the library Node uses to do file and network work off your JavaScript thread, and then returns immediately. The next line of your code runs before the file is read. When the read finishes, libuv queues your callback. The event loop runs it once the current call stack is empty. That is why a console.log placed after readFile prints before the callback.

The callback runs on a fresh, empty call stack. The function that called readFile has already returned. A try/catch around that call cannot catch a throw inside the callback, because the try block is gone. The error-first convention exists because throw cannot reach the caller. The error has to be passed in as data.

Each next step can be scheduled only from inside the previous callback. Dependent steps nest, and each level checks its own error. The code drifts right. That shape is called callback hell.

Not every deferral runs at the same time. process.nextTick runs your callback before the event loop moves on, even ahead of promise microtasks. A microtask is a small job, such as a promise callback, that runs before the next timer or I/O callback. I/O means input and output, such as disk and network. setImmediate runs on the next loop iteration, in the check phase. setTimeout with a delay of 0 runs in the timers phase, after a clamp of at least 1 millisecond. To make a synchronous path asynchronous without jumping the queue, prefer setImmediate. Recursive nextTick can starve the loop, meaning other work never gets a turn.

Promise then and queueMicrotask run after nextTick and before the next phase. They drain fully, so scheduling them recursively can also starve the loop. setImmediate and setTimeout with a delay of 0 run one callback per iteration, so they give the loop a chance to continue.

Network sockets use the operating system's event notification, so thousands can be in flight at once. File I/O, and a few CPU-heavy jobs such as crypto.pbkdf2, zlib, and DNS lookup, cannot. libuv runs those on a pool of worker threads. The default size is four, set by UV_THREADPOOL_SIZE. Five concurrent fs.readFile calls means the fifth callback waits for a free worker.

![Four callbacks nested inside one another, each indented further right, forming a pyramid shape known as callback hell](assets/i13_02_38a50215.svg)

Dependent steps nest, and each one repeats its own error check.

## Code examples

The canonical error-first pattern. Notice the error branch is handled first and returns early, so the success code never runs on a failure:

javascript

```
const fs = require('node:fs');

fs.readFile('config.json', 'utf8', (err, data) => {
  if (err) {
    console.error('Failed to read config:', err.message);
    return; // stop — do NOT fall through to use data
  }
  const config = JSON.parse(data);
  console.log('Port:', config.port);
});

console.log('This logs FIRST — readFile is async.');
```

Sequencing dependent steps produces the nesting the diagram showed. Each step needs the previous step's result:

javascript

```
getUser(1, (err, user) => {
  if (err) return done(err);
  getOrders(user.id, (err, orders) => {
    if (err) return done(err);
    getItems(orders[0].id, (err, items) => {
      if (err) return done(err);
      done(null, items); // finally, the result
    });
  });
});
```

Writing an async function of your own means *always* calling the callback the same way — error first, and never both calling back with an error and continuing. Deferring with `setImmediate` keeps the API consistently asynchronous:

javascript

```
function loadUser(id, cb) {
  if (typeof id !== 'number') {
    // Defer so the callback never runs synchronously — see gotchas below.
    return setImmediate(() => cb(new Error('id must be a number')));
  }
  db.find(id, (err, row) => {
    if (err) return cb(err);        // pass the error along
    cb(null, { id: row.id, name: row.name }); // null error on success
  });
}
```

Running independent callback operations in parallel and collecting results by hand shows why libraries and promises were welcomed. You must count completions yourself and guard against calling `done` twice:

javascript

```
function loadAll(ids, done) {
  const results = [];
  let remaining = ids.length;
  let finished = false;
  if (remaining === 0) return done(null, results);

  ids.forEach((id, i) => {
    loadUser(id, (err, user) => {
      if (finished) return;         // already errored out
      if (err) { finished = true; return done(err); }
      results[i] = user;            // preserve order by index
      if (--remaining === 0) done(null, results);
    });
  });
}
```

## Common mistakes & gotchas

- Wrapping an async callback in try/catch catches nothing. The try block has already finished. Handle the err argument.
- Forgetting to return after the error lets the success path run on undefined data, often crashing on JSON.parse or a null property.
- Calling the callback more than once duplicates later work. Return after the call, or guard it with a finished flag.
- A callback that is sometimes synchronous and sometimes asynchronous, called releasing Zalgo, makes order unpredictable. Defer the synchronous path with setImmediate.
- An empty err check swallows a real failure. At least log it and stop.
- Passing a method as a bare callback loses this. Wrap it in an arrow function or use bind.
- fs callbacks share the default pool of four threads, so heavy file, crypto, or zlib work queues behind it. Set UV_THREADPOOL_SIZE before the pool is first used, or throttle the work.

## Best practices

- In every callback you write, the first argument is the error, and only the error.
- Handle that branch first and return immediately.
- Never call a callback synchronously. Defer with setImmediate so the API is always asynchronous.
- Name callback functions instead of nesting anonymous ones, so stack traces stay readable.
- Past one or two steps, use util.promisify or the promise APIs such as fs.promises.
- Never call a callback twice.

## ⭐ Interview lens

> **Q: What is an error-first callback and why did Node adopt it?**  
> An error-first callback is a function Node runs later whose first argument is the error, and whose later arguments are the result. Node adopted it because that function runs on a fresh, empty call stack, after the function that started the work has already returned. A throw inside the callback cannot reach the original caller, and a try/catch around the original call is already gone. Passing the error as data gives every async API the same shape: an Error on failure, or null and then the data on success. With fs.readFile you check err, return if it is set, and only then use the file text. The limit is that every nested step must do that check itself. If you forget the return, the success path runs on undefined data.

> **Q: Why does `console.log` after `fs.readFile` print before the file contents?**  
> fs.readFile does not read the file on your JavaScript thread. It hands the read to libuv, the library that does file work on a small pool of worker threads, and returns immediately, so the console.log on the next line runs while the file is still being read. Your callback is queued and runs only after the current stack is empty and the event loop reaches it. That is the same reason a log after the call appears first. The limit is that "queued" is not "parallel without limit". File reads share a default pool of four workers, so a fifth read waits even though the calls look simultaneous.

> **Q: Can a `try/catch` catch an error thrown inside an async callback?**  
> No. By the time the callback runs, the try block that wrapped the original call has already returned, and the callback starts on a new stack. A throw inside it becomes an uncaught exception, which can take down the process. That is why Node passes the error as the first argument instead of throwing. You handle it with if (err) return, not with try/catch around readFile. The limit of that rule is the synchronous case: a throw that happens before the function returns, still on the same stack, can be caught. The async callback itself cannot.

> **Q: What is "callback hell" and what actually causes it?**  
> Callback hell is deeply nested callbacks. It happens when each async step needs the previous step's result, so the next call can be scheduled only from inside the previous callback. Every level also repeats its own error check, and an early exit means remembering to return at each level. A user lookup that then loads orders and then loads items is the usual picture: three functions indented inside each other. The limit is that the nesting is a sequencing problem, not just a style problem. util.promisify or async/await flattens the shape, but the steps are still ordered if each one needs the last result.

## Cheat-card

- Shape: err first, then data. On success err is null.
- Runs later, on an empty stack, through the event loop.
- try/catch cannot catch a throw inside the callback. Check err and return.
- Never call the callback twice. Defer a synchronous path with setImmediate.
- Past a couple of steps, use util.promisify or fs.promises.
- File, crypto, zlib, and DNS lookup callbacks share the default pool of four threads.

## Good to know

- What is "releasing Zalgo"? (trap) It means the callback runs immediately on one path and later on another, so callers cannot reason about order. Always defer the synchronous path with setImmediate or process.nextTick.

- How do you convert a callback API into a promise? Use util.promisify on an error-first function, or build a Promise and call resolve with the data or reject with the error from inside the callback.
- Additional examples: 7 Oct 2026, examples verified on Node v24.19.0.
- `util.callbackify(fn)`: added in v8.2.0.

---

## Learn More

- [JavaScript Asynchronous Programming and Callbacks nodejs.org](https://nodejs.org/en/learn/asynchronous-work/javascript-asynchronous-programming-and-callbacks)
- [Introducing asynchronous JavaScript developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Async_JS/Introducing)
- [Async JS Crash Course - Callbacks, Promises, Async Await Traversy Media](https://www.youtube.com/watch?v=PoRJizFvM7s)
- [Error First Callback Patterns in JS Steve Griffith - Prof3ssorSt3v3](https://www.youtube.com/watch?v=0pNo1O42m6k)

---

## Additional topics

### `util.callbackify`: from a promise back to a callback

`util.callbackify(fn)` is the reverse of `util.promisify`. It takes a function that returns a promise (usually an `async` function) and returns a new function that takes the same arguments plus an error-first callback at the end. You need it when an older API expects a callback (a plugin hook, a test framework, a library that calls `cb(err, value)`) and the code you want to plug in is written with `async`/`await`. Without it you would write the same `.then(v => cb(null, v), e => cb(e))` adapter by hand each time, and the hand-written version usually gets the edge cases below wrong.

How it works:

1. You call the wrapper with the original arguments and a callback last: `wrapped(a, b, cb)`.
2. The wrapper calls `fn(a, b)` and gets a promise.
3. If the promise fulfils with `value`, the wrapper calls `cb(null, value)`.
4. If it rejects with a truthy `reason`, the wrapper calls `cb(reason)`.
5. If it rejects with a falsy reason (`null`, `undefined`, `0`, `''`, `false`), the wrapper cannot pass it as the first argument, because a falsy first argument means "no error". It creates an `Error` with `code: 'ERR_FALSY_VALUE_REJECTION'` and the original value in an own property `reason`, and calls `cb(thatError)`.
6. The callback always runs asynchronously, on a later tick. If it throws, the error is not turned into a rejection; it becomes an `uncaughtException`.

**Example — wrapping an `async` function for a callback API.**

javascript

```
const { callbackify } = require('node:util');

async function getUser(id) {
  if (id < 0) throw new Error(`no user ${id}`);
  return { id, name: 'Ada' };
}
const getUserCb = callbackify(getUser);   // same arguments, plus a callback at the end

getUserCb(1, (err, user) => {
  console.log('ok    ->', err, user);
});
getUserCb(-1, (err, user) => {
  console.log('error ->', err.message, user);
});
console.log('sync code finished first');

// Real output (Node v24.19.0):
//   sync code finished first
//   ok    -> null { id: 1, name: 'Ada' }
//   error -> no user -1 undefined
```

The callback runs after the synchronous code, as step 6 says, so a callbackified function never "releases Zalgo".

### AbortSignal with callback APIs

The callback-style core APIs take the same `AbortSignal` as the promise APIs (see [`22-abortcontroller-and-abortsignal.md`](22-abortcontroller-and-abortsignal.md)). The signal goes into the options object, and the abort shows up as the callback's `err`. `fs.readFile(path, { signal }, cb)` supports it since v15.2.0, `child_process.exec` since v15.4.0, and `execFile` since v15.4.0 (all from the History tables of the v24 docs). Without a signal, a callback API has no way to stop work you no longer need: the read keeps buffering the whole file, and the child process keeps running.

How it works:

1. Create an `AbortController` and pass `{ signal: controller.signal }` in the options.
2. The API registers an abort listener and starts the work.
3. When you call `controller.abort()`, `fs.readFile` stops its internal buffering between chunk reads (the docs note it does not cancel a single OS read already in progress). `exec` sends the child its `killSignal`, `'SIGTERM'` by default.
4. The callback is called once, with `err` set to Node's `AbortError` (`err.name === 'AbortError'`, `err.code === 'ABORT_ERR'`, the abort reason in `err.cause`) and no data.

**Example — cancelling `fs.readFile` and `child_process.exec` (local file and local command only).**

javascript

```
const fs = require('node:fs');
const { exec } = require('node:child_process');

fs.writeFileSync('big.bin', Buffer.alloc(200 * 1024 * 1024));   // 200 MiB local file

// 1. fs.readFile: the signal goes in the options object, before the callback
const readAc = new AbortController();
fs.readFile('big.bin', { signal: readAc.signal }, (err, data) => {
  if (err) console.log('readFile ->', err.name, err.code, '| data:', data);
  else console.log('readFile -> read', data.length, 'bytes');
  fs.rmSync('big.bin');
});
readAc.abort();          // abort right after starting

// 2. child_process.exec: Node kills the child with killSignal (default 'SIGTERM')
const execAc = new AbortController();
const child = exec('sleep 1 && echo finished > marker.txt', { signal: execAc.signal }, (err) => {
  console.log('exec     ->', err.name, err.code, '| err.killed:', err.killed, '| err.signal:', err.signal);
});
child.on('exit', (code, signal) => console.log('child exit -> code:', code, '| signal:', signal));
setTimeout(() => execAc.abort(), 200);

setTimeout(() => console.log('marker.txt written?', fs.existsSync('marker.txt')), 1500);

// Real output (Node v24.19.0):
//   readFile -> AbortError ABORT_ERR | data: undefined
//   exec     -> AbortError ABORT_ERR | err.killed: undefined | err.signal: undefined
//   child exit -> code: null | signal: SIGTERM
//   marker.txt written? false
```

The `exec` callback still gets exactly one call, with the `AbortError`. The `'exit'` event shows the shell was killed by `SIGTERM`, and `marker.txt` was never written, so the command really stopped.

### Common mistakes & gotchas (additional topics)

- **Throwing inside a callbackified function's callback.** The throw does not reach any `catch` or promise. It becomes an `uncaughtException` (verified: a handler registered with `process.on('uncaughtException')` received `bug in the callback, got value`). Handle errors inside the callback.
- **Testing `if (err === null)` after a falsy rejection.** A promise that rejects with `null` reaches the callback as a real `Error` with `code === 'ERR_FALSY_VALUE_REJECTION'`, not as `null`. The original value is in `err.reason`.
- **Reading `err.killed` / `err.signal` after aborting `exec`.** When `exec` is stopped by a signal, the error is the `AbortError`, and `err.killed` and `err.signal` are `undefined` (they are set when the `timeout` option kills the child). Use the child's `'exit'` event to see the kill signal.
- **Passing the signal itself instead of `{ signal }`.** `fs.readFile(path, signal, cb)` does not throw; the signal is silently ignored. In a test run with an already-aborted signal passed this way, the callback got `err === null` and the whole file. Always wrap it: `{ signal }`.

### Edge case worked through: a promise that rejects with a falsy value

A hand-written adapter like `fn().then(v => cb(null, v), e => cb(e))` breaks when `fn` rejects with `null`: the callback receives `cb(null)` and treats the failure as a success with `undefined` data. The first line of output below shows it; `util.callbackify` handles the case:

javascript

```
const { callbackify } = require('node:util');

// A hand-written adapter: looks fine, but a null rejection reaches cb as "no error"
const naive = (fn) => (cb) => fn().then((v) => cb(null, v), (e) => cb(e));
naive(() => Promise.reject(null))((err, v) => {
  console.log('hand-written adapter, reject(null) -> err:', err, '| treated as success:', !err);
});

// util.callbackify wraps every falsy reason in a real Error
for (const reason of [null, undefined, 0, '', false]) {
  const rejects = callbackify(() => Promise.reject(reason));
  rejects((err) => {
    console.log(
      `reject(${JSON.stringify(reason) ?? 'undefined'}) ->`,
      `${err.constructor.name} | message: ${JSON.stringify(err.message)} | code: ${err.code}`,
      `| has own 'reason': ${Object.hasOwn(err, 'reason')} | err.reason: ${JSON.stringify(err.reason) ?? 'undefined'}`,
    );
  });
}

// Real output (Node v24.19.0):
//   hand-written adapter, reject(null) -> err: null | treated as success: true
//   reject(null) -> Error | message: "Promise was rejected with falsy value" | code: ERR_FALSY_VALUE_REJECTION | has own 'reason': true | err.reason: null
//   reject(undefined) -> Error | message: "Promise was rejected with falsy value" | code: ERR_FALSY_VALUE_REJECTION | has own 'reason': true | err.reason: undefined
//   reject(0) -> Error | message: "Promise was rejected with falsy value" | code: ERR_FALSY_VALUE_REJECTION | has own 'reason': true | err.reason: 0
//   reject("") -> Error | message: "Promise was rejected with falsy value" | code: ERR_FALSY_VALUE_REJECTION | has own 'reason': true | err.reason: ""
//   reject(false) -> Error | message: "Promise was rejected with falsy value" | code: ERR_FALSY_VALUE_REJECTION | has own 'reason': true | err.reason: false
```

Every falsy reason, including `undefined`, arrives as an `Error` whose message is `Promise was rejected with falsy value` and whose own `reason` property holds the original value. The `if (err) return …` check from the error-first convention therefore still works.

### ⭐ Interview lens (additional topics)

> **Q: “What does `util.callbackify` do when the promise rejects with `null`?”**  
> A: It cannot call `cb(null)`, because a falsy first argument means success. It wraps the value in an `Error` with `code: 'ERR_FALSY_VALUE_REJECTION'` and stores the original `null` in `err.reason`. *Trap:* a hand-rolled `.then(v => cb(null, v), cb)` adapter gets this wrong and reports success.

> **Q: “How do you cancel an `fs.readFile` or an `exec` that uses a callback?”**  
> A: Pass `{ signal }` from an `AbortController` in the options and call `abort()`. The callback runs once with an `AbortError` (`code 'ABORT_ERR'`); for `exec`, Node also sends the child `killSignal` (default `SIGTERM`).
