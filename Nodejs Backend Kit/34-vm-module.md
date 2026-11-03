---
title: "The vm Module (and Why It Is Not a Sandbox)"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# The vm Module (and Why It Is Not a Sandbox)

*15 min read · Updated 10 Oct 2026 · Topic 82 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

The `vm` module compiles a string of JavaScript and runs it with a global object you supply, so that code sees the values you put there and not your module's local variables. It exists for trusted templates, config, and plugins that should run in a fresh global, compiled once and reused. The trade-off is that a context only walls off global variables. Any object the code can touch leads back to the host `Function` constructor, so this is not a place to run untrusted code.

## Why it matters

`node:vm` compiles a string of JavaScript and runs it with a global object you choose. That sounds like a safe place for untrusted code. The documentation says the opposite: the `node:vm` module is not a security mechanism, and you should not use it to run untrusted code. People still ship a plugin system, a formula field, or a rules engine that evaluates user input, and one line of attacker code reaches the host `process`, reads environment variables, spawns a shell, or deletes files.

Use `vm` for trusted code in a fresh global: compile once, run many times, evaluate a config or template against a controlled set of globals. This lesson also shows, on Node v24.19.0, a one-line break-out of an isolated-looking context, and the alternatives that draw a real boundary: `worker_threads` with resource limits, and the `isolated-vm` package.

## The concept, simply

A context is a fresh V8 global environment. V8 is the JavaScript engine. The context has its own `globalThis`, its own `Object`, `Array`, and `Function`, separate from your program. `vm` runs a string of code inside that context, so the code sees the globals you put there and not your module's variables.

- `vm.createContext(obj)` turns a plain object into a context. Properties of `obj` become globals. Globals the code sets are written back onto `obj`.
- `vm.runInContext(code, context, options)` runs `code` in a context you already made.
- `vm.runInNewContext(code, obj, options)` makes a context from `obj` and runs `code` in one call.
- `vm.runInThisContext(code, options)` runs `code` in the current global. It skips your local scope and shares every global you already have.
- `vm.Script` compiles `code` once. You then call `.runInContext(ctx)` many times, in different contexts, without compiling again.
- `options.timeout` is a wall-clock limit, in milliseconds, for synchronous execution.
- `options.microtaskMode: 'afterEvaluate'` runs the context's promise callbacks before returning, so they fall inside the timeout.

A context isolates global variables. Objects, functions, and prototypes still move between the host and the context. Every object points at its constructor, and a constructor's constructor is `Function`. Any object the context can touch is a path back to a `Function` that compiles new code in the host realm.

## How it works

1. `vm.createContext(sandbox)` attaches a fresh V8 context to `sandbox`. Reading a global inside the context reads a property of `sandbox`. Assigning a global writes it back.
2. `runInContext` compiles the string, unless you already built a `vm.Script`, and runs it with that context's global object.
3. The code cannot see your local `const` bindings, and you cannot see its locals. You share data only through properties of the context object.
4. A `timeout` arms a watchdog that interrupts the V8 isolate if synchronous execution runs past the limit, and throws into your calling code.
5. Promise callbacks and timer callbacks are scheduled onto a queue that drains after the synchronous call returns, outside that watchdog, unless `microtaskMode: 'afterEvaluate'` pulls the promise callbacks back inside.

The watchdog only stops the synchronous call it wraps. `Promise.resolve().then(() => heavyWork())` runs `heavyWork` after `runInNewContext` has returned, so the timeout never sees it. `microtaskMode: 'afterEvaluate'` closes that promise gap. Callbacks scheduled with `setTimeout`, `setImmediate`, or `process.nextTick`, if those functions are even visible in the context, go onto queues shared by every context. `timeout` stops a busy `while (true) {}`. It does not stop a determined async workload.

## Code examples

**Example 1: contexts, `runInNewContext`, `createContext` plus `runInContext`, and `vm.Script` reuse.**

javascript

```
import vm from 'node:vm';

// 1. runInNewContext: a fresh global object, built from the sandbox you pass
const sandbox = { count: 0, result: null };
vm.runInNewContext('result = count + 1; count = 10', sandbox);
console.log('after run, sandbox =', sandbox);       // changes are written back

// 2. createContext + runInContext: reuse one context across several runs
const ctx = vm.createContext({ total: 0 });
console.log('isContext:', vm.isContext(ctx));
for (const n of [1, 2, 3]) vm.runInContext(`total += ${n}`, ctx);
console.log('total after three runs:', ctx.total);

// 3. The context has its OWN globals, separate from ours
const probe = vm.runInNewContext('({ hasProcess: typeof process, arr: [1,2] instanceof Array })', {});
console.log('inside the context:', probe);
console.log('its Array is not ours:', vm.runInNewContext('[]') instanceof Array);

// 4. vm.Script: compile once, run many times (and in different contexts)
const script = new vm.Script('n = (n || 0) + 1');
const a = { n: 0 }, b = { n: 100 };
vm.createContext(a); vm.createContext(b);
script.runInContext(a); script.runInContext(a); script.runInContext(b);
console.log('compiled once, run in two contexts:', a.n, b.n);

// Real output (Node v24.19.0):
//   after run, sandbox = { count: 10, result: 1 }
//   isContext: true
//   total after three runs: 6
//   inside the context: { hasProcess: 'undefined', arr: true }
//   its Array is not ours: false
//   compiled once, run in two contexts: 2 101
```

The context sees only what you put in `sandbox`, and assignments flow back out. A context has no `process` unless you add it. An array created inside the context is an instance of that context's `Array`, not yours, which is why `instanceof Array` is false. `vm.Script` compiles once and runs in two contexts, each with its own `n`.

**Example 2: timeouts stop synchronous loops. Async work escapes unless `microtaskMode` pulls promise callbacks back in.**

javascript

```
import vm from 'node:vm';

// 1. A synchronous infinite loop IS stopped by timeout
try {
  vm.runInNewContext('while (true) {}', {}, { timeout: 50 });
} catch (err) {
  console.log('1 sync loop        :', err.constructor.name, '-', err.message);
}

// 2. Async work scheduled from inside ESCAPES the timeout
let ran = false;
function mark() { ran = true; }
vm.runInNewContext(
  'Promise.resolve().then(() => mark());',   // runs AFTER the script returns
  { mark },
  { timeout: 50 },
);
console.log('2 did the promise callback run inside the timeout? ', ran);  // false: it is still queued
await Promise.resolve();                       // let the microtask run
console.log('2 after a tick, ran =', ran);     // now true, but the timeout never saw it

// 3. microtaskMode: 'afterEvaluate' pulls microtasks INTO the timeout scope
try {
  vm.runInNewContext(
    'Promise.resolve().then(() => { while (true) {} });',
    {},
    { timeout: 50, microtaskMode: 'afterEvaluate' },
  );
} catch (err) {
  console.log('3 with afterEvaluate:', err.constructor.name, '-', err.message);
}

// Real output (Node v24.19.0):
//   1 sync loop        : Error - Script execution timed out after 50ms
//   2 did the promise callback run inside the timeout?  false
//   2 after a tick, ran = true
//   3 with afterEvaluate: Error - Script execution timed out after 50ms
```

A synchronous infinite loop stops at 50 ms. A promise callback runs after the call returns, so the timeout misses it, unless `microtaskMode: 'afterEvaluate'` drains that queue first. A `setTimeout` still escapes. `runInThisContext` does not accept `microtaskMode`.

**Example 3: a one-line break-out to the host `process`.**

A context has no `process` and no `require`. Any object it can reach still leads to the host `Function` constructor, and from there to the real `process`. On Node v24.19.0:

javascript

```
const vm = require('node:vm');

// A context with no process, no require, no globals we added.
const result = vm.runInNewContext(`
  // 'this' is the sandbox's global object. Walk its prototype chain:
  // this.constructor is the HOST Object, .constructor is the HOST Function.
  const HostFunction = this.constructor.constructor;
  const proc = HostFunction('return process')();   // compiled & run in the HOST realm
  proc.pid;
`, {});

console.log('process inside the vm context:', vm.runInNewContext('typeof process', {}));
console.log('escaped to host process.pid   :', result);
console.log('equals our real process.pid   :', result === process.pid);

// Real output (Node v24.19.0):
//   process inside the vm context: undefined
//   escaped to host process.pid   : 629327
//   equals our real process.pid   : true
```

Inside the context, `typeof process` is `undefined`. `this.constructor.constructor` is the host `Function`, and the function it builds runs where `process` is real, so the escaped `pid` matches the host. From there the code can read `process.env` or load `child_process`. No `vm` option closes this. Freezing globals or deleting `Function` loses to other paths.

**Example 4: real isolation with `worker_threads` and `resourceLimits`.**

A worker thread runs in its own V8 isolate: a separate heap and separate globals. You can cap its memory and kill it on a deadline. A runaway loop or an out-of-memory error in the worker does not block or crash the main thread.

javascript

```
import { Worker } from 'node:worker_threads';

// Run untrusted-ish code in a worker with a hard memory cap and a wall-clock
// deadline. A worker runs in its own V8 isolate, so an infinite loop or an
// out-of-memory there cannot block or crash the main thread.
function runSandboxed(code, { memMb = 16, timeoutMs = 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };

    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads');
       let result;
       try { result = eval(workerData); } catch (e) { result = 'threw: ' + e.message; }
       parentPort.postMessage(result);`,
      { eval: true, workerData: code, resourceLimits: { maxOldGenerationSizeMb: memMb } },
    );

    const timer = setTimeout(() => { worker.terminate(); done(reject, new Error('killed: deadline exceeded')); }, timeoutMs);
    worker.once('message', (m) => { worker.terminate(); done(resolve, m); });
    worker.once('error', (e) => done(reject, new Error(`killed: ${e.message}`)));  // memory limit arrives here
  });
}

console.log('normal        :', await runSandboxed('40 + 2'));
console.log('its own global:', await runSandboxed('typeof process.mainModule'));

try { await runSandboxed('while (true) {}', { timeoutMs: 200 }); }
catch (e) { console.log('infinite loop :', e.message); }

try { await runSandboxed('const a=[]; while (true) a.push(new Array(1e6).fill(0));', { memMb: 16 }); }
catch (e) { console.log('memory bomb   :', e.message); }

console.log('main thread survived all three');

// Real output (Node v24.19.0):
//   normal        : 42
//   its own global: undefined
//   infinite loop : killed: deadline exceeded
//   memory bomb   : killed: Worker terminated due to reaching memory limit: JS heap out of memory
//   main thread survived all three
```

`maxOldGenerationSizeMb` caps the worker heap. The memory bomb tears the worker down with an `'error'` you can catch, and the main thread keeps running. `terminate()` on a timer stops a `while (true) {}` and async work, because the thread dies. The worker still has `require` and its own `process`, so strip those before you treat it as a jail.

**Example 5: `isolated-vm`, aimed at a real boundary.**

`isolated-vm` at `7.0.1` (`engines.node` at least 24) builds separate V8 isolates with their own heap limits and no shared references, so data crosses by copy or by an explicit `Reference`. It is a native addon, and this machine has no C or C++ toolchain, so install fails:

bash

```
$ npm install isolated-vm@7.0.1
npm error gyp ERR! build error
npm error gyp ERR! stack Error: not found: make
npm error gyp ERR! System Linux 7.0.0-38-generic
npm error gyp ERR! command "…/bin/node" "…/node-gyp/bin/node-gyp.js" "rebuild" …
npm error gyp ERR! node -v v24.19.0
npm error gyp ERR! not ok
```

> ⚠️ Unverified: isolated-vm's runtime behavior on Node v24.19.0 could not be verified here. The npm metadata (version `7.0.1`, `engines.node >= 24.0.0`) is real, but the package needs native compilation and this environment has no C/C++ toolchain (no `gcc`/`g++`/`make`), so `npm install` fails with `gyp ERR! not found: make`. On a machine with build tools (or using a prebuilt binary) it is designed to install on Node 24. Verify on your own build host before relying on it.

For most services, isolate outside the process: a worker (Example 4), a child process with dropped privileges, or a container or microVM. A full break-out should land inside a jail, not inside your Node process.

## Common mistakes & gotchas

- **Using `vm` as a security sandbox.** The docs say it is not one, and Example 3 breaks out in one line.
- **Thinking an empty context is sealed.** Missing `process` and `require` does not matter. `this.constructor.constructor` rebuilds a host function. Deleting or freezing globals does not close the hole.
- **Trusting `timeout` to stop everything.** It interrupts synchronous execution only. Promises without `microtaskMode`, and any timer, run after the call returns.
- **Expecting `microtaskMode: 'afterEvaluate'` to bound `setTimeout`.** It bounds promise callbacks. Timers still escape.
- **Recompiling the same source on every run.** `vm.runInContext(sameString, ctx)` compiles each call. Build `new vm.Script(src)` once.
- **Confusing `runInThisContext` with isolation.** It runs in the current global and only escapes the local lexical scope.
- **Assuming `vm.SourceTextModule` works by default.** The ES module classes are Experimental and need `--experimental-vm-modules`.

## Best practices

- **Run only trusted code in `vm`.** Your own templates, config, or plugins. For user input, isolate a process or an isolate.
- **Pre-compile with `vm.Script`** when the same source runs repeatedly, and reuse one `createContext` result when runs should share state.
- **Keep the context object small.** Expose the functions the code needs. Do not pass `process`, `require`, or whole modules.
- **Pair `timeout` with `microtaskMode: 'afterEvaluate'`** for trusted code that might loop, and still assume async work can escape.
- **For untrusted code, isolate the whole unit:** a worker with `resourceLimits` and a `terminate()` deadline, with capabilities stripped, or a child process, `isolated-vm`, a container, or a microVM.
- **Record the isolation library version** and confirm it builds on your Node version and platform before you ship it.

## ⭐ Interview lens

> **Q: “Is `node:vm` a safe sandbox for running untrusted user code?”**  
A: No. A context is a fresh set of global variables, and `vm` runs your string against that global. The docs say it is not a security mechanism. Objects and prototypes are still shared, so `this.constructor.constructor('return process')()` reaches the host `process` from a context that looks empty. I verified that one-liner on Node v24: inside the context `process` is undefined, and the escaped `pid` matches the host. Use a worker with resource limits, a child process, or a separate isolate such as `isolated-vm`. The limit is that no `vm` option closes the hole. Freezing globals or deleting `Function` loses to other paths.

> **Q: “What does the `timeout` option actually stop?”**  
A: `timeout` is a watchdog around one synchronous call. If that call is still running on the isolate when the milliseconds elapse, V8 interrupts it and your caller gets an error. A `while (true) {}` stops. A loop inside `Promise.resolve().then(...)` is queued as a microtask and runs after `runInNewContext` has already returned, so the watchdog never sees it. `microtaskMode: 'afterEvaluate'` drains those promise callbacks before the call returns, and then the same budget applies. The limit is timers. `setTimeout`, `setImmediate`, and `process.nextTick` sit on queues shared by every context, and `microtaskMode` does not cover them.

> **Q: “How would you actually run untrusted JavaScript in a Node service?”**  
A: Isolate the whole execution unit, not just the global object. A `worker_threads` worker has its own V8 isolate. `resourceLimits.maxOldGenerationSizeMb` caps the heap, and `worker.terminate()` on a timer stops both a synchronous loop and async work, because the thread dies. Catch the worker's `'error'` and the main thread keeps running. Strip `require` and talk over a narrow message protocol, because a worker still has its own `process`. `isolated-vm` aims at separate isolates in-process, with data copied across. A child process, a container, or a microVM is stronger. The limit is `vm` itself. Do not use it as the boundary.

> **Q: “What is `vm.Script` for?”**  
A: `vm.Script` compiles a source string once into an object you can run many times. Call `.runInContext`, `.runInThisContext`, or `.runInNewContext` without compiling again. That is the tool for the same trusted template rendered on every request, each time against the context you pass. Each context keeps its own globals, so two contexts running one script do not share `n`. The limit is trust and scope. The script is still ordinary `vm` code, so it is for code you control, and `runInThisContext` shares your real globals.

## Cheat-card

- **Fresh global:** `vm.runInNewContext(code, sandbox[, { timeout, microtaskMode }])`. Globals are sandbox properties. Assignments flow back.
- **Reuse a context:** `vm.createContext(obj)`, then `vm.runInContext(code, ctx)`. `vm.isContext(ctx)` checks it.
- **Compile once:** `new vm.Script(src)`, then `s.runInContext(ctx)`.
- **Current global:** `vm.runInThisContext(code)` escapes local scope only.
- **timeout:** synchronous code only. Add `microtaskMode: 'afterEvaluate'` for promise callbacks. Timers still escape.
- **Not a sandbox:** `this.constructor.constructor('return process')()` reaches the host `process` from an empty context, verified on v24. The docs say it is not a security mechanism.
- **ES modules:** `vm.SourceTextModule` and `SyntheticModule` are Experimental and need `--experimental-vm-modules`.
- **Real isolation:** `worker_threads` with `resourceLimits.maxOldGenerationSizeMb` and `terminate()`, or `isolated-vm` (native addon, needs a compiler), or a child process, container, or microVM.

## Good to know

- `microtaskMode` was added in v14.6.0. `resourceLimits.maxOldGenerationSizeMb` was added in v13.2.0 and v12.16.0.
- Why does an array created inside a vm context fail `instanceof Array` in the host? Each context has its own `Array`. The array's prototype is the context's, so `instanceof` is false. Use a realm-safe check such as `Array.isArray`, as lesson 30 describes.
## Learn More

- [VM (executing JavaScript) nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/vm.html)
- [Worker threads nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)
- [isolated-vm github.com/laverdet/isolated-vm](https://github.com/laverdet/isolated-vm)
