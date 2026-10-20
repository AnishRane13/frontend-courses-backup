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

## Why it matters

`node:vm` lets you compile a string of JavaScript and run it with a global object you supply. That sounds exactly like "run untrusted code safely", and that is the one thing it does **not** do. The documentation is blunt about it: *"The `node:vm` module is not a security mechanism. Do not use it to run untrusted code."* People read "context" and "sandbox" in the API and ship it anyway — a plugin system, a formula field, a rules engine that `eval`s user input — and then a single line of attacker-supplied code reaches the host `process` and reads environment variables, spawns a shell, or deletes files.

So this lesson has two goals. First, show what `vm` is genuinely good for: running trusted code in a fresh global, compiling once and running many times, evaluating a config or template with a controlled set of globals. Second, demonstrate concretely — on Node v24.19.0 — how an isolated-looking `vm` context is broken out of in one line, and show the alternatives (`worker_threads` with resource limits, and the `isolated-vm` package) that give a real boundary.

## The concept, simply

A **context** is a fresh V8 global environment: its own `globalThis`, its own `Object`, `Array`, `Function`, and so on, separate from your program's. `vm` runs a string of code *inside* a context, so the code sees the globals you put in that context and not your module's variables.

The parts:

- **`vm.createContext(obj)`** — turn a plain object into a context ("contextify" it). Properties of `obj` become globals for code run in it, and globals the code sets are written back onto `obj`.
- **`vm.runInContext(code, context, options)`** — run `code` in a context you already made.
- **`vm.runInNewContext(code, obj, options)`** — make a context from `obj` and run `code` in it, in one call.
- **`vm.runInThisContext(code, options)`** — run `code` in the *current* global context (no isolation of globals; it just skips the local scope).
- **`vm.Script`** — compile `code` once into a reusable object, then `.runInContext(ctx)` it many times (and in different contexts), avoiding recompilation.
- **`options.timeout`** — milliseconds of wall-clock time after which **synchronous** execution is interrupted.
- **`options.microtaskMode: 'afterEvaluate'`** — run the context's microtasks (promise callbacks) before returning, so they fall inside the `timeout`.

The crucial mental model: a context isolates **global variables**, nothing else. Objects, functions and prototypes still flow freely between the host and the context. Because every object carries a reference to its constructor, and every constructor's constructor is `Function`, any object the context can touch is a path back to a `Function` that can compile new host-realm code. That is the hole.

## How it works

1. **You contextify an object.** `vm.createContext(sandbox)` attaches a fresh V8 context to `sandbox`. Reading a global inside the context reads `sandbox`'s property; assigning a global writes it back.
2. **You run code.** `runInContext` compiles the string (unless you pre-compiled a `vm.Script`) and executes it with that context's global object.
3. **Globals are swapped, scope is not shared.** The code cannot see your local `const`s, and you cannot see its locals; you communicate only through the context object's properties.
4. **A `timeout` arms a watchdog** that interrupts the V8 isolate if *synchronous* execution runs past the limit, throwing a timeout error into your calling code.
5. **Async work escapes the timeout.** Promise callbacks and timer callbacks are scheduled onto a queue that drains *after* the synchronous call returns, outside the watchdog — unless `microtaskMode: 'afterEvaluate'` pulls the microtasks back inside.

**Why the timeout is weaker than it looks.** The watchdog can only stop the synchronous call it wraps. The moment code does `Promise.resolve().then(() => heavyWork())`, the `heavyWork` runs on the microtask queue after `runInNewContext` has already returned, so the timeout never sees it. `microtaskMode: 'afterEvaluate'` closes the promise-microtask gap, but callbacks scheduled through `setTimeout`/`setImmediate`/`process.nextTick` (if those are even exposed to the context) go onto global queues shared by all contexts and are still uncontrollable. So `timeout` stops a busy `while(true){}` but not a determined async workload.

## Code examples

**Example 1 — contexts: `runInNewContext`, `createContext` + `runInContext`, and `vm.Script` reuse.**

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

The context sees only what you put in `sandbox`, and assignments flow back out. A context has no `process` (unless you add it). Note `its Array is not ours: false`: an array *created inside* the context is an instance of the context's `Array`, not your program's — the same cross-realm fact that lesson 30 shows breaks `instanceof`. `vm.Script` compiles the source once and runs it in two different contexts, each keeping its own `n`.

**Example 2 — timeouts: synchronous loops stop, async work escapes, `microtaskMode` fixes the promise case.**

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

Case 1 is what `timeout` is for: a synchronous infinite loop is interrupted at 50 ms. Case 2 is the trap: the promise callback is queued and runs *after* `runInNewContext` returns, so `ran` is still `false` when the call finishes — the timeout never applied to it. Case 3 adds `microtaskMode: 'afterEvaluate'` (added in v14.6.0), which drains the context's microtask queue before returning, so a loop hidden inside `.then()` is now caught by the same 50 ms budget. Timers scheduled with `setTimeout` would still escape, because they run on global queues outside the watchdog. (`vm.runInThisContext` does not accept `microtaskMode`, since it has no separate context.)

**Example 3 — edge case: a one-line break-out of the context to the host `process`.**

A context has no `process`, no `require` — it looks sealed. But any object it can reach leads back to the host `Function` constructor, and from there to the real `process`. On Node v24.19.0:

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

`typeof process` *inside* the context is `undefined`, so it looks safe. But `this.constructor.constructor` reaches the host `Function`, and a function built with it runs in the host realm where `process` is a real global. The escaped `process.pid` equals the host's — the code now holds the real `process`, which means `process.env`, `process.exit`, and (via `process.mainModule.require` or `require('child_process')`) a shell. The well-known `this.constructor.constructor('return process')()` one-liner is the canonical demonstration; variants reach the same place through any shared object (`sharedObj.constructor.constructor`). There is no option to `vm` that closes this. Freezing globals, deleting `Function`, and similar hardening are defeated by other paths; the maintained consensus, and the docs, is that `vm` cannot safely run untrusted code.

**Example 4 — real isolation with `worker_threads` and `resourceLimits`.**

A worker thread runs in its **own V8 isolate** — a separate heap and separate globals that your main thread cannot be corrupted by, and that you can cap with memory limits and kill on a deadline. A runaway loop or an out-of-memory in the worker cannot block or crash the main thread.

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

`resourceLimits.maxOldGenerationSizeMb` (the option was added in v13.2.0, v12.16.0) caps the worker's heap; the memory bomb trips it and the worker is torn down with an `'error'` you catch, while the main thread keeps running. A separate `setTimeout` plus `worker.terminate()` enforces a wall-clock deadline that *does* stop a synchronous `while(true){}` loop — and, unlike `vm`'s timeout, it stops async workloads too, because terminating the thread kills everything in it. **Important caveat:** a worker is an isolation boundary for crashes and resource use, not a security boundary against host access. This worker still has `require` and its own `process`; to run genuinely untrusted code you would also have to strip its capabilities (no `require`, a restricted message protocol) or use a dedicated isolate library.

**Example 5 — `isolated-vm`, an alternative that aims at a real boundary.**

`isolated-vm` (npm `isolated-vm`, latest `7.0.1`, `engines: { node: '>=24.0.0' }`) creates genuinely separate V8 isolates with their own heap limits and no shared references — you pass data across the boundary by copying or via explicit `Reference` handles, so the `this.constructor.constructor` path does not reach your realm. It is the usual recommendation when you must run untrusted JavaScript in-process.

The catch is that it is a native addon: installing it compiles C++ with `node-gyp`. On this machine there is no C/C++ toolchain, so the build fails:

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

For most services the better answer is out-of-process isolation you already trust: a worker (Example 4), a separate child process with dropped privileges, or a container/microVM. Run untrusted code where a full break-out still lands inside a jail, not inside your Node process.

## Common mistakes & gotchas

- **Using `vm` as a security sandbox.** It is not one, by the docs' own statement, and Example 3 breaks out in one line. Never run untrusted code in `vm`.
- **Thinking an empty context is sealed.** No `process` or `require` in the context does not matter; `this.constructor.constructor` rebuilds a host function. Deleting or freezing globals does not close it either.
- **Trusting `timeout` to stop everything.** It only interrupts synchronous execution. Async work (promises without `microtaskMode`, any timer) runs after the call returns, outside the watchdog.
- **Forgetting `microtaskMode: 'afterEvaluate'` when you do want promise callbacks bounded** — and expecting it to also bound `setTimeout`, which it does not.
- **Recompiling the same source every run.** `vm.runInContext(sameString, ctx)` recompiles each call. Use `new vm.Script(src)` once and `.runInContext` it.
- **Confusing `runInThisContext` with isolation.** It runs in the *current* global context; it only escapes the local lexical scope. It shares all your globals.
- **Assuming `vm.SourceTextModule` just works.** The ES-module classes (`vm.SourceTextModule`, `vm.SyntheticModule`) are Experimental and require the `--experimental-vm-modules` flag; they are not available by default.

## Best practices

- **Only run trusted code in `vm`** — your own templates, config, or plugin code you control. For anything from a user, use process- or isolate-level isolation.
- **Pre-compile with `vm.Script`** when running the same source repeatedly, and reuse one `createContext` result across runs that should share state.
- **Keep the context object minimal.** Expose only the specific functions the code needs, as plain data or narrow wrappers, never `process`, `require`, or whole modules.
- **Use `timeout` plus `microtaskMode: 'afterEvaluate'`** for trusted-but-possibly-buggy code to bound runaway loops, and still assume async work can escape.
- **For untrusted code, isolate the whole execution unit:** a `worker_threads` worker with `resourceLimits` and a `terminate()` deadline (and stripped capabilities), a child process with dropped privileges, or `isolated-vm` / a microVM / a container.
- **Record the exact versions** of any isolation library (e.g. `isolated-vm@7.0.1`) and confirm it builds on your Node version and platform before shipping.

## ⭐ Interview lens

> **Q: “Is `node:vm` a safe sandbox for running untrusted user code?”**  
> A: No. The docs state it is not a security mechanism. A context isolates globals but shares objects and prototypes, so `this.constructor.constructor('return process')()` reaches the host `process` in one line (verified on v24). Use a worker, a child process, or a dedicated isolate like `isolated-vm`.

> **Q: “What does the `timeout` option actually stop?”**  
> A: Only synchronous execution of the call it wraps. A `while(true){}` is interrupted; a loop inside `Promise.resolve().then(...)` runs after the call returns and escapes it, unless you add `microtaskMode: 'afterEvaluate'`. Timers scheduled onto global queues escape even then.

> **Q: “Why does an array created inside a vm context fail `instanceof Array` in the host?”**  
> A: Each context is its own realm with its own `Array` and `Array.prototype`. The context's array has the context's prototype, not yours, so `instanceof` (which walks the prototype chain) is false. Use `util.types.isArrayBufferView`/`Array.isArray` style realm-safe checks (lesson 30).

> **Q: “How would you actually run untrusted JavaScript in a Node service?”**  
> A: Isolate the whole execution unit. A `worker_threads` worker with `resourceLimits` (memory cap) and a `terminate()` deadline bounds CPU and memory and survives crashes; strip its capabilities so it cannot `require` host modules. `isolated-vm` gives separate isolates in-process. Stronger still: a sandboxed child process, a container, or a microVM. Never rely on `vm` alone.

> **Q: “What is `vm.Script` for?”**  
> A: Compile a source string once into a reusable object, then run it many times (`.runInContext`, `.runInThisContext`, `.runInNewContext`) without recompiling. It is the efficiency tool for repeated execution of the same trusted code, e.g. a template rendered per request.

## Cheat-card

- **Run with a fresh global:** `vm.runInNewContext(code, sandbox[, { timeout, microtaskMode }])`; globals = sandbox props, assignments flow back.
- **Reuse a context:** `const ctx = vm.createContext(obj); vm.runInContext(code, ctx)`. `vm.isContext(ctx)` checks it.
- **Compile once:** `const s = new vm.Script(src); s.runInContext(ctx)` — no recompilation per run.
- **This context (no isolation):** `vm.runInThisContext(code)` escapes local scope only; shares all globals.
- **timeout:** stops *synchronous* code only. Add `microtaskMode: 'afterEvaluate'` to also bound promise microtasks; timers still escape.
- **NOT a sandbox:** `this.constructor.constructor('return process')()` reaches host `process` from an empty context (v24, verified). Docs: "not a security mechanism. Do not use it to run untrusted code."
- **ES modules in vm:** `vm.SourceTextModule`/`SyntheticModule` are Experimental, need `--experimental-vm-modules`.
- **Real isolation:** `worker_threads` + `resourceLimits.maxOldGenerationSizeMb` + `terminate()` deadline (own isolate; strip capabilities); or `isolated-vm` (native addon, needs a compiler); or child process / container / microVM.

---

## Learn More

- [VM (executing JavaScript) nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/vm.html)
- [Worker threads nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)
- [isolated-vm github.com/laverdet/isolated-vm](https://github.com/laverdet/isolated-vm)
