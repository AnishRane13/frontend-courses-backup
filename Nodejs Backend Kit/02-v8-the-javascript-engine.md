---
title: "V8: How Node Runs Your JavaScript"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# V8: How Node Runs Your JavaScript

*16 min read · Updated 7 Oct 2026 · Topic 2 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

V8 is the C++ engine inside Node that takes your JavaScript, compiles it in stages from bytecode up to fast machine code, runs it, and frees unused objects with a garbage collector. Node keeps one V8 isolate, one heap, for the main thread, and another for each worker thread.

It exists so JavaScript can start quickly and then get fast on the code you actually run. The trade-off is that the fast code is built on guesses. If a later value breaks a guess, V8 throws that code away and starts again, and if the heap cannot shrink under its limit, the process aborts.

An isolate is one V8 heap. A hidden class, which V8 calls a map, is the layout of an object's properties. Garbage collection is how V8 reclaims memory nothing can reach anymore.

## Why it matters

Node does not run JavaScript itself. It hands your source to V8, and V8 decides the speed, the memory, and whether the process dies with `FATAL ERROR: Reached heap limit`. The production symptoms are V8 symptoms. A benchmark is fast, then one property read gets slower because real traffic sends objects of many shapes. A 512 MB container is killed, or Node aborts with "JavaScript heap out of memory," because the heap limit was never set to match. p99 spikes line up with garbage-collection pauses. Dashboards show `rss` far above `heapUsed`, and nobody knows which number to alert on.

You need four ideas: the compile tiers, hidden classes and inline caches, the garbage collector, and the memory numbers V8 and Node report.

## The concept, simply

V8 parses JavaScript, compiles it to bytecode and then to machine code in several tiers, runs it, and manages every object with a generational garbage collector. `process.versions.v8` on Node v24.19.0 is `13.6.233.17-node.51`, V8 13.6 plus Node's patches.

1. **Parser.** Source becomes a syntax tree. A function body is only checked for syntax until the first call.
2. **Ignition.** The interpreter. It compiles the tree to compact bytecode and runs it, recording type feedback: which object shapes hit each property, which types hit each `+`.
3. **Sparkplug.** A baseline compiler. It turns bytecode into machine code by a direct translation, without optimizing. Fast to produce, faster than the interpreter.
4. **Maglev.** A mid-tier optimizing compiler. It uses the feedback and produces specialized code quickly.
5. **TurboFan.** The top tier. It spends more compile time for faster code. Its JavaScript backend now uses an internal form called Turboshaft. In Node 24, `--turboshaft` is on by default.
6. **Deoptimizer.** Throws optimized code away when a guess breaks, and resumes in a lower tier.
7. **Heap and collector,** called Orinoco. A young generation collected by a scavenger. An old generation collected by mark-sweep-compact, with incremental, concurrent, and parallel helpers so the main thread pauses less.

You can list the tier names in your own binary:

bash

```
$ node --v8-options | grep -E '^\s*--(sparkplug|maglev|turbofan|turboshaft) ' -A1
  --maglev (enable the maglev optimizing compiler)
        type: bool  default: --maglev
--
  --sparkplug (enable Sparkplug baseline compiler)
        type: bool  default: --sparkplug
--
  --turbofan (use the Turbofan optimizing compiler)
        type: bool  default: --turbofan
--
  --turboshaft (enable TurboFan's Turboshaft phases for JS)
        type: bool  default: --turboshaft
```


## How it works

**One function, from first call to fastest code.**

1. **Pre-parse.** At load, V8 checks the syntax of `square` and does not compile the body.
2. **First call.** Ignition compiles the body to bytecode and runs it. The feedback vector is allocated lazily, not on the very first call. `--lazy-feedback-allocation` is on by default.
3. **Feedback.** Each run records what it saw. "`n * n` saw small integers." "`o.x` saw shape M1."
4. **Sparkplug.** After the function has run a bit, Sparkplug compiles the bytecode to machine code, in batches, on a background thread.
5. **Maglev.** When the function has used its interrupt budget and the feedback has stopped changing, V8 compiles optimized code from that feedback, concurrently. The code contains checks: still a small integer? still shape M1?
6. **TurboFan.** If the function stays hot, TurboFan inlines callees, removes redundant checks, and allocates registers more carefully. A long loop can switch to optimized code in the middle. That is on-stack replacement.
7. **A check fails.** V8 rebuilds the interpreter frame and continues in Ignition. The function collects broader feedback and may be optimized again.

text

```
 source ──► parser ──► AST ──► Ignition bytecode ─────────┐ runs + records feedback
                                    │                     │
                                    ▼                     │
                          Sparkplug (baseline machine code, no optimization)
                                    │ hot and stable
                                    ▼
                          Maglev (fast optimizing, uses feedback)
                                    │ still hot
                                    ▼
                          TurboFan (+ Turboshaft backend, slowest compile, fastest code)

        Maglev / TurboFan code ── a speculation check fails ──► deoptimize ──► back to Ignition
```

The flags `invocation-count-for-maglev` and `invocation-count-for-turbofan` hint at the scale. V8 actually decides from a budget of bytecode executed, so a short function in a loop can tier up within milliseconds.

**Hidden classes and inline caches.** Most objects are not hash tables. Each object points to a map: the property names, their order, and the slot of each value. Objects created the same way share one map. The names are stored once. Each object holds the values.

`{}` starts at an empty map. Adding `x` transitions to a map with `x` at slot 0. Adding `y` transitions again. Another object built in the same order ends on the same map. `{ y, x }` ends on a different one. `delete` of a property that is not the last one added, or adding very many properties, can switch the object to dictionary mode, a real hash table, which is slower to read.

Each property access in your code has an inline cache in the feedback vector.

- **Monomorphic.** One map. Compare the map, then load the slot.
- **Polymorphic.** 2 to 4 maps. A short list of compares.
- **Megamorphic.** More than 4. The cache gives up on a per-site list and looks the property up in a global stub. Optimizing compilers cannot inline that as well.

**Garbage collection.** V8 frees memory that is no longer reachable from roots: the stack, globals, and handles Node holds. Most objects die young.

text

```
 V8 heap of one isolate
 ┌──────────────── young generation ────────────────┐ ┌──────────── old generation ────────────┐
 │  semi-space A (objects being allocated)          │ │ old space   (survivors, long-lived)    │
 │  semi-space B (empty; copy target)               │ │ code space  (compiled machine code)    │
 │  new large-object space                          │ │ large-object space (very big objects)  │
 └──────────────────────────────────────────────────┘ └────────────────────────────────────────┘
   Scavenge: copy live objects A→B (or promote to old space)     Mark-Compact: mark live objects,
   cost ∝ live objects, a few ms                                 sweep dead ones, compact pages
```

New objects are allocated by bumping a pointer in the young generation. A scavenge, the minor collection, copies the live objects into the other semi-space, or promotes objects that already survived one scavenge into old space, then swaps the spaces. Dead objects are not touched, so the cost is the survivors. When old space grows past a limit, a major collection marks everything reachable from the roots. Marking is incremental on the main thread and concurrent on V8's worker threads. Both are on by default. Unmarked memory returns to free lists, sweeping runs concurrently, and fragmented pages are compacted. The final pause is the "Mark-Compact" line in a `--trace-gc` log.

**The heap limit.** `heap_size_limit` is the old-generation limit plus the young generation, and the young generation is 3 times the maximum semi-space size. `--max-old-space-size` sets the old-generation limit in MiB. `--max-semi-space-size` sets the semi-space. `--max-old-space-size-percentage` sets the old generation as a percentage of system memory. If a full collection cannot get the old generation under its limit, V8 aborts the process. There is no exception to catch.

**Startup snapshots.** A snapshot is a serialized heap. Node's own bootstrap is already restored from a snapshot in the binary. `node --snapshot-blob app.blob --build-snapshot entry.js` runs the entry once and writes the heap. Later, `node --snapshot-blob app.blob` restores that heap and calls the function you registered with `v8.startupSnapshot.setDeserializeMainFunction()`. The flag page for `--snapshot-blob` still says experimental.

## Code examples

**Example 1. One function climbing the tiers.**

javascript

```
// hot.js: run with  node --trace-baseline --trace-opt hot.js 2>&1 | grep -E 'square|done'
function square(n) { return n * n; }
let s = 0;
for (let i = 0; i < 3_000_000; i++) s += square(i & 1023);
console.log('done', s);
```


bash

```
$ node --trace-baseline --trace-opt hot.js 2>&1 | grep -E 'square|done'
[Baseline batch compilation] Enqueued SFI square with estimated size 42 (current budget: 42/4096)
[Baseline batch compilation] Enqueued SFI square with estimated size 42 (current budget: 567/4096)
[marking 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
[compiling method 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> (target MAGLEV), mode: ConcurrencyMode::kConcurrent]
[completed compiling 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> (target MAGLEV) - took 0.000, 0.038, 0.001 ms]
[Concurrent Sparkplug Off Thread] Function 0x2a272b3231a9 <SharedFunctionInfo square> installed
[marking 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> for optimization to TURBOFAN_JS, ConcurrencyMode::kConcurrent, reason: hot and stable]
[compiling method 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> (target TURBOFAN_JS), mode: ConcurrencyMode::kConcurrent]
[completed compiling 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> (target TURBOFAN_JS) - took 0.003, 0.391, 0.009 ms]
[completed optimizing 0x2e09cace4fa9 <JSFunction square (sfi = 0x2a272b3231a9)> (target TURBOFAN_JS)]
done 1046910851360
```

All four tiers show up. Ignition logs nothing. Sparkplug, Maglev, and TurboFan do. Sparkplug's "installed" line can land after Maglev's because both compile on background threads, and the log records when each finished. Addresses change every run. With `--no-maglev`, the same run goes from baseline straight to `TURBOFAN_JS`.

**Example 2. A deoptimization.**

javascript

```
// deopt.js: run with  node --trace-opt --trace-deopt deopt.js
function add(a, b) { return a + b; }

let r = 0;
for (let i = 0; i < 200_000; i++) r = add(i, 1);   // only small integers: V8 speculates "int + int"
console.log('ints done', r);

r = add('x', 1);                                    // a string breaks the speculation
console.log('string done', r);
```


bash

```
$ node --trace-opt --trace-deopt deopt.js | grep -E 'JSFunction add |done'
[marking 0x3cdd3e225081 <JSFunction add (sfi = 0x1cc3a6da3351)> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
[compiling method 0x3cdd3e225081 <JSFunction add (sfi = 0x1cc3a6da3351)> (target MAGLEV), mode: ConcurrencyMode::kConcurrent]
[completed compiling 0x3cdd3e225081 <JSFunction add (sfi = 0x1cc3a6da3351)> (target MAGLEV) - took 0.001, 0.067, 0.001 ms]
ints done 200000
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing 0x3cdd3e225081 <JSFunction add (sfi = 0x1cc3a6da3351)>, 0x276a8f141da9 <Code MAGLEV>, opt id 3, bytecode offset 2, deopt exit 0, FP to SP delta 24, caller SP 0x7ffee64efca0, pc 0x700bf800373b]
string done x1
```

A Smi is V8's small integer, stored in the pointer instead of as a heap object. Maglev compiled `a + b` as integer addition, guarded by "is `a` a Smi?" The string failed that check, so V8 dropped the optimized code and finished in the interpreter. The result is still correct. Only speed is lost. In six re-runs the bailout hit Maglev five times and TurboFan once, always with reason "not a Smi." One deopt is harmless. A function that deoptimizes and reoptimizes on every request is the problem.

**Example 3. Hidden classes, made visible.** `--allow-natives-syntax` turns on V8's `%` functions. Experiments only. Never ship them.

javascript

```
// shapes.js: run with  node --allow-natives-syntax shapes.js
// %HaveSameMap and %HasFastProperties are V8 debug intrinsics: never ship them.
const a = { x: 1, y: 2 };
const b = { x: 3, y: 4 };
const c = { y: 5, x: 6 };            // same keys, different order
const d = { x: 7 };  d.y = 8;        // y added later, same order as a
class Point { constructor(x, y) { this.x = x; this.y = y; } }

console.log('a vs b (same literal shape):    ', %HaveSameMap(a, b));
console.log('a vs c (keys in other order):   ', %HaveSameMap(a, c));
console.log('a vs d (y added after creation):', %HaveSameMap(a, d));
console.log('Point vs Point:                 ', %HaveSameMap(new Point(1, 2), new Point(3, 4)));
console.log('a vs new Point (literal vs class):', %HaveSameMap(a, new Point(1, 2)));

const e = { x: 1, y: 2, z: 3 };
console.log('e fast properties before delete:', %HasFastProperties(e));
delete e.y;                           // deleting a non-last property
console.log('e fast properties after delete: ', %HasFastProperties(e));
const f = { x: 1, y: 2, z: 3 };
f.y = undefined;                      // alternative: keep the shape
console.log('f after f.y = undefined:        ', %HasFastProperties(f));

// Real output (Node v24.19.0):
//   a vs b (same literal shape):     true
//   a vs c (keys in other order):    false
//   a vs d (y added after creation): false
//   Point vs Point:                  true
//   a vs new Point (literal vs class): false
//   e fast properties before delete: true
//   e fast properties after delete:  false
//   f after f.y = undefined:         true
```

`a` and `d` have the same keys in the same order and still get different maps. A literal gets a map prepared for that literal. `d` started from the `{ x }` literal and then transitioned. Two objects share a map when they are created by the same code path. `delete` put `e` in dictionary mode. Setting `undefined` kept `f` on its fast map.

**Example 4. How many shapes reach one property read.** One call site reads 1,024 objects. The objects get 1, 2, 4, 5, or 32 maps by adding one extra property whose name depends on `i % SHAPES`. Each case is its own process, warms up with 2,000 passes, then times 20,000 passes with `process.hrtime.bigint()`. A checksum shows the reads were not optimized away. A runner repeats each case 10 times.

javascript

```
// shapes-bench.js: cost of o.x when the objects reaching one call site have N shapes
// Usage: node shapes-bench.js <shapes>   (each case runs in its own process,
// so no case inherits another case's inline-cache feedback)
const SHAPES = Number(process.argv[2] ?? 1);
const N = 1024;          // objects in the array
const WARMUP = 2_000;    // passes over the array before timing (lets V8 tier up)
const PASSES = 20_000;   // timed passes: 20,000 x 1,024 = 20.5 M property reads

// Object i gets property x, plus one extra property whose NAME depends on
// i % SHAPES. Different names = different hidden classes (shapes).
const objs = [];
for (let i = 0; i < N; i++) {
  const o = { x: i };
  o['p' + (i % SHAPES)] = 0;
  objs.push(o);
}

function sumX(arr) {          // the one call site: arr[i].x
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i].x;
  return s;
}

let sink = 0;
for (let p = 0; p < WARMUP; p++) sink += sumX(objs);

const t0 = process.hrtime.bigint();
for (let p = 0; p < PASSES; p++) sink += sumX(objs);
const ns = Number(process.hrtime.bigint() - t0);

const expected = (WARMUP + PASSES) * (N * (N - 1)) / 2;   // proves the reads happened
if (sink !== expected) throw new Error('wrong sum');
console.log((ns / (PASSES * N)).toFixed(2));             // ns per property read
```


javascript

```
// run-bench.js: run each case 10 times in fresh processes, report min / median / max
const { execFileSync } = require('node:child_process');
const RUNS = 10;
for (const shapes of [1, 2, 4, 5, 32]) {
  const xs = [];
  for (let r = 0; r < RUNS; r++) {
    xs.push(Number(execFileSync(process.execPath, ['shapes-bench.js', String(shapes)], { cwd: __dirname })));
  }
  xs.sort((a, b) => a - b);
  const median = (xs[4] + xs[5]) / 2;
  console.log(`${String(shapes).padStart(2)} shape(s): median ${median.toFixed(2)} ns/read  ` +
    `(min ${xs[0].toFixed(2)}, max ${xs[RUNS - 1].toFixed(2)}, ${RUNS} runs)`);
}

// Real output (Node v24.19.0, Linux x64, 8 logical CPUs; first of three sessions):
//    1 shape(s): median 1.56 ns/read  (min 1.33, max 2.00, 10 runs)
//    2 shape(s): median 2.92 ns/read  (min 2.15, max 3.48, 10 runs)
//    4 shape(s): median 3.23 ns/read  (min 2.80, max 4.80, 10 runs)
//    5 shape(s): median 6.46 ns/read  (min 5.53, max 7.76, 10 runs)
//   32 shape(s): median 6.99 ns/read  (min 5.91, max 7.92, 10 runs)
```

The jump is between 4 and 5 shapes, which is where the inline cache leaves the polymorphic state. Past 5 shapes the cost barely grows. The session medians are in Good to know. Treat them as a few nanoseconds per access at a site that runs millions of times, not as a law. Measure your own hot path before rewriting code for shapes.

**Example 5. Reading `--trace-gc`.**

javascript

```
// gc.js: run with  node --trace-gc gc.js
// Phase 1: lots of short-lived garbage (dies young -> Scavenge)
for (let i = 0; i < 2_000_000; i++) { const tmp = { i, s: 'x' + i }; }
console.log('--- phase 1 done: short-lived objects');

// Phase 2: objects that stay reachable (promoted to old space -> Mark-Compact)
const keep = [];
for (let i = 0; i < 1_500_000; i++) keep.push({ i, s: 'y' + i });
console.log('--- phase 2 done: kept', keep.length, 'objects');
```


bash

```
$ node --trace-gc gc.js | sed -E 's/^\[[0-9]+:0x[0-9a-f]+\] +//' | sed -n '1,3p;/phase 1/,$p'
18 ms: Scavenge 4.7 (6.5) -> 3.9 (7.5) MB, pooled: 0 MB, 0.47 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
19 ms: Scavenge 4.7 (7.5) -> 4.1 (7.7) MB, pooled: 0 MB, 0.50 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
20 ms: Scavenge 4.9 (7.7) -> 4.3 (9.7) MB, pooled: 0 MB, 0.41 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
--- phase 1 done: short-lived objects
93 ms: Scavenge 13.0 (22.6) -> 8.1 (22.1) MB, pooled: 0 MB, 2.14 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
100 ms: Scavenge 14.0 (23.6) -> 12.0 (42.5) MB, pooled: 0 MB, 4.57 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
117 ms: Scavenge 27.8 (45.8) -> 23.0 (47.2) MB, pooled: 0 MB, 8.39 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
130 ms: Mark-Compact 23.8 (47.5) -> 22.0 (86.7) MB, pooled: 0 MB, 9.89 / 0.00 ms  (+ 0.1 ms in 10 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 12 ms) (average mu = 0.919, current mu = 0.919) finalize incremental marking via stack guard; GC in old space requested
194 ms: Scavenge 104.6 (137.2) -> 75.0 (123.2) MB, pooled: 0 MB, 12.43 / 0.00 ms  (average mu = 0.919, current mu = 0.919) allocation failure; 
231 ms: Scavenge 103.5 (136.2) -> 95.7 (216.7) MB, pooled: 0 MB, 15.46 / 0.00 ms  (average mu = 0.919, current mu = 0.919) allocation failure; 
--- phase 2 done: kept 1500000 objects
253 ms: Mark-Compact 128.1 (239.3) -> 4.0 (135.2) MB, pooled: 77 MB, 2.99 / 0.00 ms  (+ 0.9 ms in 27 steps since start of marking, biggest step 0.1 ms, walltime since start of marking 4 ms) (average mu = 0.944, current mu = 0.968) finalize incremental marking via task; GC in old space requested
```

The first `sed` strips the `[pid:isolate]` prefix. The second keeps the first 3 lines and everything from "phase 1 done." About 20 more phase-1 scavenge lines are cut. `Scavenge 4.7 (6.5) -> 3.9 (7.5) MB` means 4.7 MB live and 6.5 MB reserved before, 3.9 MB live and 7.5 MB reserved after. `0.47 / 0.00 ms` is the main-thread pause. `mu` is mutator utilisation, the share of time your JavaScript was running, not the collector. In phase 1, garbage dies young. Each scavenge is about 0.5 ms and the heap drops back to about 4 MB. In phase 2, objects stay reachable. Scavenges slow from about 2 ms to 15 ms because every survivor is copied and promoted, until a mark-compact runs. The "+ 0.1 ms in 10 steps" is incremental marking before the final 9.89 ms pause. The last line runs after the main module returns. `keep` is unreachable, so 128 MB drops to 4 MB.

**Example 6. What `--max-old-space-size` does to `heap_size_limit`.**

javascript

```
// heaplimit.js: how big may the V8 heap grow in this process?
const v8 = require('node:v8');
const mb = (b) => `${(b / 1024 / 1024).toFixed(0)} MB`;
const s = v8.getHeapStatistics();
console.log('heap_size_limit:', mb(s.heap_size_limit), '| execArgv:', process.execArgv.join(' ') || '(none)');
```


bash

```
$ node heaplimit.js
heap_size_limit: 2240 MB | execArgv: (none)
$ node --max-old-space-size=512 heaplimit.js
heap_size_limit: 704 MB | execArgv: --max-old-space-size=512
$ node --max-old-space-size=4096 heaplimit.js
heap_size_limit: 4288 MB | execArgv: --max-old-space-size=4096
$ NODE_OPTIONS=--max-old-space-size=1024 node heaplimit.js
heap_size_limit: 1216 MB | execArgv: (none)
$ node --max-semi-space-size=16 heaplimit.js
heap_size_limit: 2096 MB | execArgv: --max-semi-space-size=16
$ node --max-semi-space-size=128 heaplimit.js
heap_size_limit: 2432 MB | execArgv: --max-semi-space-size=128
$ node --max-old-space-size-percentage=25 heaplimit.js
heap_size_limit: 3986 MB | execArgv: --max-old-space-size-percentage=25
```

On this 15 GB machine the numbers fit old-generation limit plus 3 times the max semi-space. The default is 2048 plus 3 times 64, which is 2240 MB. `--max-old-space-size=512` gives 512 plus 192, which is 704 MB. A 16 MB semi-space gives 2048 plus 48, which is 2096 MB. `NODE_OPTIONS` works like the flag but does not appear in `process.execArgv`. 25 percent of this machine's 15,178 MB is 3,794 MB, plus 192 MB of young generation, which is 3,986 MB. The default old-generation limit depends on the machine and the V8 version. Print `heap_size_limit` on the real host.

**Example 7. Every field of `v8.getHeapStatistics()`.**

bash

```
$ node -p "require('v8').getHeapStatistics()"
{
  total_heap_size: 6025216,
  total_heap_size_executable: 262144,
  total_physical_size: 5779456,
  total_available_size: 2345390936,
  used_heap_size: 4458104,
  heap_size_limit: 2348810240,
  malloced_memory: 163928,
  peak_malloced_memory: 114752,
  does_zap_garbage: 0,
  number_of_native_contexts: 1,
  number_of_detached_contexts: 0,
  total_global_handles_size: 12360,
  used_global_handles_size: 2400,
  external_memory: 1807292
}
```


| Field | Meaning, in bytes unless noted |
| --- | --- |
| `total_heap_size` | Memory V8 has allocated for the heap. |
| `total_heap_size_executable` | The part that may hold JIT code. |
| `total_physical_size` | Heap memory actually committed. |
| `total_available_size` | How much more V8 can use before the limit. |
| `used_heap_size` | Bytes occupied by JavaScript objects right now. |
| `heap_size_limit` | The maximum heap size. Example 6. |
| `malloced_memory`, `peak_malloced_memory` | Memory V8 allocated with `malloc`, now and at the peak. |
| `does_zap_garbage` | 0 or 1. Whether V8 overwrites freed memory with a pattern. A debug option. |
| `number_of_native_contexts` | Top-level contexts alive. Each `vm` context adds one. A number that keeps growing is a context leak. |
| `number_of_detached_contexts` | Contexts detached but not yet collected. Non-zero for long is a likely leak. |
| `total_global_handles_size`, `used_global_handles_size` | Memory for the C++-side handles that keep JavaScript objects alive. |
| `external_memory` | Memory outside the heap that V8 has been told about, including Buffers. |

**Example 8. A 100 MB `Buffer` that does not move `rss` until you write it.** `rss` is resident set size, physical RAM for the whole process. `heapTotal` and `heapUsed` are V8's heap. `external` is C++ memory bound to JavaScript objects. `arrayBuffers` is memory for `ArrayBuffer` and `SharedArrayBuffer`, including every Node `Buffer`, and it is also counted in `external`.

javascript

```
// memory.js: which field of process.memoryUsage() moves for which allocation
const MB = (b) => (b / 1024 / 1024).toFixed(1).padStart(6);
function show(label) {
  const m = process.memoryUsage();
  console.log(`${label.padEnd(24)} rss ${MB(m.rss)} | heapTotal ${MB(m.heapTotal)} | ` +
    `heapUsed ${MB(m.heapUsed)} | external ${MB(m.external)} | arrayBuffers ${MB(m.arrayBuffers)}`);
}

show('start');
const objects = Array.from({ length: 1_000_000 }, (_, i) => ({ i }));   // JS objects: V8 heap
show('+1M small objects');
const buf = Buffer.alloc(100 * 1024 * 1024);                              // bytes live outside the V8 heap
show('+100 MB Buffer');
buf.fill(1);                                                              // now the OS must back every page
show('after buf.fill(1)');
console.log('keys:', Object.keys(process.memoryUsage()).join(', '), '| kept', objects.length, buf.length);

// Real output (Node v24.19.0, Linux x64):
//   start                    rss   44.4 | heapTotal    6.2 | heapUsed    3.8 | external    1.5 | arrayBuffers    0.1
//   +1M small objects        rss  113.4 | heapTotal   60.1 | heapUsed   42.2 | external    1.7 | arrayBuffers    0.1
//   +100 MB Buffer           rss  113.4 | heapTotal   60.1 | heapUsed   42.2 | external  101.7 | arrayBuffers  100.1
//   after buf.fill(1)        rss  213.4 | heapTotal   60.1 | heapUsed   42.2 | external  101.7 | arrayBuffers  100.1
//   keys: rss, heapTotal, heapUsed, external, arrayBuffers | kept 1000000 104857600
```

One million small objects add about 38 MB to `heapUsed` and about 69 MB to `rss`. `Buffer.alloc` of 100 MB adds 100 MB to `arrayBuffers` and `external`, and nothing to `heapUsed`. Buffer bytes live outside the V8 heap, so `--max-old-space-size` does not limit them. It also adds nothing to `rss` until `buf.fill(1)` writes every page, and then `rss` rises by exactly 100 MB. On Linux a fresh zeroed allocation of this size is mapped without physical pages until the first write. Alert on `rss` for the container, on `heapUsed` after GC for a JavaScript leak, and on `arrayBuffers` for a Buffer leak. On glibc, `rss` can also grow while `heapTotal` is stable because of malloc fragmentation.

> ⚠️ Unverified: whether `rss` also stays flat after `Buffer.alloc` on macOS and Windows. This depends on each OS's lazy page allocation, and it was only run on Linux.

**Example 9. A 64 MB old space that reports a 256 MB limit, then aborts.**

javascript

```
// oom.js: keep everything reachable until the old space is full
const v8 = require('node:v8');
console.log('limit', (v8.getHeapStatistics().heap_size_limit / 1048576).toFixed(0), 'MB');
const keep = [];
for (;;) keep.push({ n: keep.length, s: 'item-' + keep.length });
```


bash

```
$ node --max-old-space-size=64 oom.js 2>&1 | grep -v '^\s*[0-9]*: 0x' | head -12; echo "exit status: ${PIPESTATUS[0]}"
limit 256 MB

<--- Last few GCs --->

[90195:0x14afd000]      139 ms: Mark-Compact 46.9 (105.4) -> 40.8 (105.9) MB, pooled: 0 MB, 32.27 / 0.00 ms  (+ 0.1 ms in 10 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 34 ms) (average mu = 0.681, current mu = 0.605)[90195:0x14afd000]      222 ms: Mark-Compact 75.5 (123.8) -> 63.6 (128.9) MB, pooled: 0 MB, 62.34 / 0.00 ms  (+ 0.0 ms in 0 steps since start of marking, biggest step 0.0 ms, walltime since start of marking 63 ms) (average mu = 0.443, current mu = 0.249) 
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

exit status: 134
```

The limit reads 256 MB, not 64, because 192 MB of young generation, 3 times a 64 MB semi-space on this machine, is added to the 64 MB old space. The process does not throw a catchable `RangeError`. V8 aborts. Exit status 134 is 128 plus `SIGABRT`, so no `try/catch`, `uncaughtException` handler, or `exit` listener runs. The `grep -v` removes native stack frames. If the container has 512 MB, set `--max-old-space-size` well below it, for example 384, so the heap, Buffers, and native memory fit together.

**Example 10. A real startup snapshot.**

javascript

```
// entry.js: build-time script for `node --build-snapshot`
const v8 = require('node:v8');

// Slow to compute, small to keep: count the primes below 30 million.
function primesBelow(n) {
  const composite = new Uint8Array(n);
  let count = 0, last = 0;
  for (let i = 2; i < n; i++) {
    if (composite[i]) continue;
    count++; last = i;
    for (let j = i * i; j < n; j += i) composite[j] = 1;
  }
  return { count, last };
}
const t0 = performance.now();
const result = primesBelow(30_000_000);           // runs ONCE, at build time
const buildMs = (performance.now() - t0).toFixed(0);

v8.startupSnapshot.setDeserializeMainFunction(() => {
  // Runs on every start from the blob, with that process's argv and env.
  console.log('argv:', process.argv.slice(1));
  console.log(`primes: ${result.count}, last: ${result.last} (${buildMs} ms of work done at build time)`);
});
```


javascript

```
// plain.js: the same work, done on every start
function primesBelow(n) {
  const composite = new Uint8Array(n);
  let count = 0, last = 0;
  for (let i = 2; i < n; i++) {
    if (composite[i]) continue;
    count++; last = i;
    for (let j = i * i; j < n; j += i) composite[j] = 1;
  }
  return { count, last };
}
const result = primesBelow(30_000_000);
console.log('argv:', process.argv.slice(1));
console.log(`primes: ${result.count}, last: ${result.last}`);
```


bash

```
$ node --snapshot-blob app.blob --build-snapshot entry.js; echo "build exit: $?"
build exit: 0
$ ls -l app.blob | awk '{print $5, $9}'
6310958 app.blob
$ node --snapshot-blob app.blob hello
argv: [ 'hello' ]
primes: 1857859, last: 29999999 (1611 ms of work done at build time)
$ node plain.js hello
argv: [
  '…/snap/plain.js',
  'hello'
]
primes: 1857859, last: 29999999
$ for i in 1 2 3; do /usr/bin/time -f "snapshot %e s" node --snapshot-blob app.blob >/dev/null; /usr/bin/time -f "plain    %e s" node plain.js > /dev/null; done
snapshot 0.03 s
plain    0.47 s
snapshot 0.03 s
plain    0.49 s
snapshot 0.03 s
plain    0.47 s
```


bash

```
$ node --snapshot-blob app.blob --build-snapshot entry-require.js
node:internal/main/mksnapshot:117
    throw err;
    ^

Error: Cannot find module './work.js'. 
    at requireForUserSnapshot (node:internal/main/mksnapshot:113:17)
    …
$ npx -y node@22 --snapshot-blob app.blob; echo "exit $?"
Failed to load the startup snapshot because it was built withNode.js version 24.19.0 and the current Node.js version is v22.23.3.
exit 14
```

The snapshot start takes 0.03 seconds against 0.47 seconds because the heap already contains `result`. The sieve does not run again. In a snapshot start there is no script path, so `process.argv[1]` is the first user argument, not a file name. Code that reads `process.argv[2]` gets the wrong value. Blob size and build time move a little between builds: 6,308,270 and 6,310,958 bytes, 1,503 and 1,611 ms. The builder accepts one entry script. It may load built-ins, not your own files, so a real app has to be bundled first. A blob loads only on the Node version, architecture, and platform that built it. The docs say a mismatch exits 1. On v22.23.3 the status was 14, which the `process` docs list as snapshot failure. A snapshot helps when setup is slow to compute and small to store. A 200,000-entry `Map` produced a 21 MB blob and started no faster than the plain script, 0.13 seconds each.

> ⚠️ Unverified: why the sieve took 1,435 to 1,611 ms inside `--build-snapshot` but about 460 ms in plain `node`. With `--no-maglev --no-turbofan` it took about 1,290 ms, which suggests the snapshot builder runs without the optimizing tiers, but that was not found in the docs.

## Common mistakes & gotchas

- **"V8 compiles everything ahead of time."** It interprets first, compiles a baseline, and optimizes only hot functions, using guesses it can throw away.
- **Rewriting every object for shapes.** The cost is nanoseconds per access. It matters at sites that run millions of times a second.
- **Building one kind of object in several ways.** Different property order, adding fields later, and mixing literals with class instances create different maps and can push a hot site to megamorphic.
- **`delete` on hot objects.** It can switch the object to dictionary mode. Set the property to `undefined`, or use a `Map` for keys that come and go.
- **Treating `heapUsed` as "memory used."** Buffers are outside the heap. `rss` includes code, stacks, native libraries, and allocator fragmentation.
- **Setting `--max-old-space-size` equal to the container limit.** The young generation is added, and Buffers and native memory sit on top. Leave headroom, or the kernel's OOM killer wins.
- **Expecting to catch heap exhaustion.** "JavaScript heap out of memory" aborts the process, exit 134.
- **Shipping `--allow-natives-syntax` or `%` functions.** They are V8 internals and they change between versions.
- **Reading `process.argv[2]` in a snapshot-started app.** The script path is missing. Arguments start at index 1.

## Best practices

- Create one kind of object in one place, a class or a factory, and initialize every property there, in the same order, even if the value starts as `null`.
- Keep types stable in hot functions. A function that always gets numbers stays optimized.
- Profile before tuning. `node --cpu-prof`, `--trace-deopt` filtered to your function, or `--trace-gc`.
- In containers, pass `--max-old-space-size` below the memory limit, and log `heap_size_limit` at startup so you can see what you got.
- Export all five `process.memoryUsage()` fields, not only `heapUsed`.
- Use a startup snapshot for startup time when it matters, such as a CLI or a cold start. Bundle first, and build the blob with the same Node binary you run.

## ⭐ Interview lens

> **Q: “Walk me through what V8 does with a function from first call to fastest code.”**  
> At load the function is only pre-parsed. On the first call, Ignition compiles the body to bytecode and runs it, recording the types and object shapes it saw. Sparkplug then turns that bytecode into unoptimized machine code. When the function is hot and the feedback has settled, Maglev compiles optimized code from those guesses. If it stays hot, TurboFan, using its Turboshaft backend, compiles faster code and can inline callees. The optimized code has checks. When a check fails, V8 deoptimizes back to the interpreter. The limit of "V8 is a JIT" is the idea that it compiles everything to machine code up front. It does not. Cold code stays bytecode.

> **Q: “What is a hidden class, and why does property order matter?”**  
> A hidden class, which V8 calls a map, is an object's layout: which properties, in which order, at which offset. Objects built the same way share one map, and each property access caches the maps it has seen. `{x, y}` and `{y, x}` get different maps, so a call site that sees both is polymorphic. More than 4 maps makes the site megamorphic, and in the measurement here that read cost about 3.5 to 5 times the one-shape read. The limit is rewriting the whole codebase for shapes. The gap is nanoseconds, and it matters at a site that runs millions of times.

> **Q: “Explain V8's garbage collector.”**  
> It is generational, because most objects die young. New objects go into a young generation of two semi-spaces. A scavenge copies the live ones to the other space, or promotes them to old space, so the cost follows the survivors, not the garbage. The old generation is mark-sweep-compact. Marking runs in small steps and on background threads while your JavaScript runs. Sweeping is concurrent. A short final pause finishes marking and compacts. `--trace-gc` prints each collection and its pause. The limit is the heap ceiling. If a full collection cannot get old space under `--max-old-space-size`, V8 aborts the process. You cannot catch it.

> **Q: “Your container has 1 GB of RAM. How do you set Node's memory?”**  
> Set `--max-old-space-size` to about 700 to 768 MB, not 1024. The reported heap limit also includes the young generation, 3 times the semi-space, and Buffers, code, and native memory live outside the heap. Check `v8.getHeapStatistics().heap_size_limit` at startup, and watch `rss` and `arrayBuffers` as well as `heapUsed`. On a 15 GB machine here, a 512 MB old space reported a 704 MB limit because 192 MB of young generation was added. The limit of copying a blog number is the machine. Print the limit on the host you deploy.

## Cheat-card

- Pipeline: parser, Ignition bytecode and feedback, Sparkplug baseline, Maglev, TurboFan with Turboshaft. A failed check deoptimizes back to Ignition.
- See it: `--trace-opt`, `--trace-deopt`, `--trace-baseline`, `--trace-gc`. `node --v8-options` lists the flags.
- Same creation path, same map. Inline cache: 1 map monomorphic, 2 to 4 polymorphic, 5 or more megamorphic.
- Avoid in hot code: changing property order, adding properties later, `delete`, mixing value types.
- Young generation: scavenge, cost follows live objects. Old generation: mark-sweep-compact.
- `heap_size_limit` is old space plus 3 times the semi-space. Set it with `--max-old-space-size` in MiB.
- "JavaScript heap out of memory" aborts the process, exit 134. It cannot be caught.
- `process.memoryUsage()`: `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers`. Buffers are never `heapUsed`.
- Snapshot: `node --snapshot-blob app.blob --build-snapshot entry.js`, then run with the blob. One bundled file, the same Node binary, and `process.argv[1]` is the first argument.

## Good to know

- Q: What is a deoptimization and how would you find one? Optimized code assumes the types and shapes it saw. A string where only small integers came before fails the check, V8 drops that code, and the function continues in the interpreter. Run `--trace-opt --trace-deopt` and filter for your function. Repeated bailouts for the same function mean unstable types.
- Example 4 medians, nanoseconds per read, four sessions: 1 shape 1.56, 1.37, 1.85, 1.17. 2 shapes 2.92, 2.81, 2.92, 1.79. 4 shapes 3.23, 3.15, 2.88, 2.17. 5 shapes 6.46, 7.04, 6.48, 4.85. 32 shapes 6.99, 7.20, 5.99, 4.89. In every session the 5-shape median was 2.0 to 2.3 times the 4-shape median and 3.5 to 5.1 times the 1-shape median.
- `--max-valid-polymorphic-map-count` is 4 in V8 13.6. `invocation-count-for-maglev` defaults to 400 and `invocation-count-for-turbofan` to 3000, but tier-up is really a bytecode budget.
- `v8.startupSnapshot` was added in v18.6.0 and marked stable in v24.0.0. `--build-snapshot` was added in v18.8.0 and stopped being experimental in v24.13.1. `--snapshot-blob` is still marked Stability 1, experimental. `arrayBuffers` was added in v13.9.0 and v12.17.0. `external` was added in v7.2.0. `process.memoryUsage.rss()` was added in v15.6.0.
- V8's March 2025 post says the whole JavaScript backend of TurboFan now uses Turboshaft. In Node 24, `--turboshaft` is on by default.

---

## Learn More

- [The V8 JavaScript Engine nodejs.org](https://nodejs.org/en/learn/getting-started/the-v8-javascript-engine)
- [Ignition (V8 docs) v8.dev](https://v8.dev/docs/ignition)
- [Sparkplug — a non-optimizing JavaScript compiler v8.dev](https://v8.dev/blog/sparkplug)
- [Maglev — V8's Fastest Optimizing JIT v8.dev](https://v8.dev/blog/maglev)
- [Land ahoy: leaving the Sea of Nodes (Turboshaft) v8.dev](https://v8.dev/blog/leaving-the-sea-of-nodes)
- [Fast properties in V8 v8.dev](https://v8.dev/blog/fast-properties)
- [JavaScript engine fundamentals: Shapes and Inline Caches mathiasbynens.be](https://mathiasbynens.be/notes/shapes-ics)
- [Trash talk: the Orinoco garbage collector v8.dev](https://v8.dev/blog/trash-talk)
- [Concurrent marking in V8 v8.dev](https://v8.dev/blog/concurrent-marking)
- [Understanding and Tuning Memory nodejs.org](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory)
- [V8 module: startup snapshot API nodejs.org](https://nodejs.org/api/v8.html)

