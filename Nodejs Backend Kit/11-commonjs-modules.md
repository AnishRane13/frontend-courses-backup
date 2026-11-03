---
title: "CommonJS Modules"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/commonjs-modules
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# CommonJS Modules

*10 min read · Updated 24 Jul 2026 Topic 11 of 70 Bookmark Mark done Why it matters Every non · Topic 11 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/commonjs-modules](https://www.geekyfrontend.in/learn/nodejs-backend-kit/commonjs-modules)

---

## Say it in 30 seconds

CommonJS is Node's original module system. Each file is wrapped in a function, so its variables stay private, and it shares a value by assigning `module.exports`. Another file reads that value with `require`, which loads the file immediately and then caches it by the resolved path.

It exists so a program can be split across files without every variable becoming global. The trade-off is that `require` is synchronous, and the cache makes each file a singleton. The top of the file runs once per process, and a circular require can see the exports object before it is finished.

A singleton means every `require` of that path gets the same object. The wrapper is the function Node puts around your file before running it.

## Why it matters

`require('express')` and `module.exports` are CommonJS. Even with ES modules available, most packages on npm still ship it, and a `.js` file with no `"type"` is still CommonJS. If you cannot say what `require`, `module.exports`, and `exports` do, the bugs feel like magic: a value that is `undefined`, a file that seems to run twice, or a circular dependency that returns half an object.

## The concept, simply

A CommonJS module is a file. Top-level variables belong to that file, not to the process. You publish a value by assigning `module.exports`. You read it with `require('./that-file')`, which returns whatever that file assigned.

- **Export.** `module.exports = something`, or `exports.name = something`.
- **Import.** `const x = require('./file')`, synchronous.

The private scope is not a JavaScript language rule. Node wraps the file in a function before running it. That one fact explains most of the surprises.

![Diagram showing a user file being wrapped in a function with five parameters](assets/i08_01_d4aee3f6.svg)

The wrapper is why top-level variables stay private, and why `exports`, `require`, `module`, `__filename`, and `__dirname` exist without an import.

## How it works

**The wrapper.** Node does not run your source directly. It places the source inside a function like this:

javascript

```
(function (exports, require, module, __filename, __dirname) {
  // ... your file's code goes here ...
});
```

Node calls that function with the five arguments. `require`, `module`, `exports`, `__filename`, and `__dirname` are parameters, not globals. A top-level `const` does not leak, because it is local to the wrapper. Older Node exposed the template at `require('module').wrapper`. At the top of a module, `arguments.length === 5`.

**`module.exports` versus `exports`.** The wrapper starts with `module.exports = {}` and `exports = module.exports`, so both names point at the same object. `exports.add = ...` and `module.exports.add = ...` change that object. `exports = somethingElse` only rebinds the parameter. The caller still receives `module.exports`, which is still the empty object. To export one value, assign `module.exports`. To export several names, add properties.

**Resolve, then cache.** `require(spec)` turns the specifier into one absolute path. Lesson 13 is that algorithm. It then looks in `require.cache`, keyed by that path. A hit returns `.exports` and does not run the file again. A miss creates a `Module`, stores it in the cache before running the file, wraps and runs it, and returns `module.exports`. Caching before execution is what lets a circular require finish instead of looping forever.

![Flow diagram showing require checking the cache keyed by resolved path, running the file once on a miss and returning cached exports on a hit](assets/i08_02_41a518d2.svg)

The first `require` of a path runs the file. Every later `require` of the same resolved path returns the cached object. A database connection or a config object at the top of a file is shared across the process, and the top-level code runs once. `delete require.cache[require.resolve('./x')]` forces a fresh run. That is a test and hot-reload trick, not application code.

**`__dirname` and `__filename`.** `__filename` is the absolute path of this file. `__dirname` is its directory. Both are injected by the wrapper. `fs` resolves a bare relative path against `process.cwd()`, not against the file, so use `path.join(__dirname, 'data.json')`.

**`require` is synchronous.** It reads and runs the target before it returns. That is fine at startup. It is also why, on older Node, `require` could not load an ES module that uses top-level `await`. The additional topics cover the modern exception.

## Code examples

**1. Several named exports.**

javascript

```
// math.js
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }

exports.add = add;          // same as module.exports.add
module.exports.sub = sub;   // both attach to the one exports object

// app.js
const math = require('./math');
console.log(math.add(2, 3)); // 5
const { sub } = require('./math'); // destructure named exports
console.log(sub(9, 4));      // 5
```


**2. One export, and the reassignment trap.**

javascript

```
// logger.js  — WRONG
exports = function log(msg) { console.log(msg); };
// reassigns the local 'exports' param; module.exports is still {}

// logger.js  — RIGHT
module.exports = function log(msg) { console.log(msg); };

// app.js
const log = require('./logger');
log('hello'); // works only with the RIGHT version
```


**3. The cache makes a singleton.**

javascript

```
// counter.js
let count = 0;
module.exports = {
  inc() { return ++count; },
  get() { return count; },
};

// a.js
const c = require('./counter');
c.inc(); c.inc();

// b.js
const c = require('./counter');
console.log(c.get()); // 2 — same instance as a.js, count is shared
```


**4. A file next to the module.**

javascript

```
const fs = require('node:fs');
const path = require('node:path');

// Robust: resolves against THIS file, not the process cwd.
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
module.exports = config;
```


## Common mistakes & gotchas

- **`exports = fn` exports nothing.** Only `module.exports = fn` replaces the object the caller receives.
- **Expecting a fresh module on every `require`.** The cache returns the same object. Do not put per-request state at the top of the file.
- **Thinking a top-level `const` is global.** It is local to the wrapper.
- **A bare relative path in `fs`.** `fs.readFileSync('config.json')` uses `process.cwd()`. Use `__dirname`.
- **A circular dependency returns a partial object.** If A requires B while B is still requiring A, B sees whatever A had assigned so far. Finish the exports before the `require`, or split the shared piece into a third file.
- **Mutating another module's exports.** Every requirer shares that object. Treat it as read-only.
- **`require` inside a hot loop.** After the first call it is a cache lookup, but it still clutters the file. Require at the top.

## Best practices

- Put every `require` at the top of the file.
- Prefer one `module.exports = { a, b, c }` over a series of `exports.x =` lines.
- Use the `node:` prefix for built-ins, `require('node:fs')`, so a package named `fs` cannot shadow it.
- Keep top-level code cheap. Open connections inside a function you call.
- Build paths with `path.join(__dirname, ...)`.
- Do not `delete require.cache` in application code. It leaks and duplicates singletons.
- Break a cycle by moving the shared piece into a third module both can require.

## ⭐ Interview lens

> **Q: What is the module wrapper function and why does it exist?**
> Node wraps each file in a function, `(function (exports, require, module, __filename, __dirname) { ... })`, and calls it with those five arguments. Top-level variables are locals of that function, not globals, and `require` and `__dirname` exist because they are parameters. For example, a `const` at the top of `a.js` is invisible in `b.js` unless `a.js` puts it on `module.exports`. The limit is ES modules. They do not get this wrapper, so `require`, `__dirname`, and `module` are not there.

> **Q: Difference between `module.exports` and `exports`?**
> They start as the same object. `exports` is a parameter set to `module.exports`, which starts as `{}`. Adding a property on either name changes that object. Reassigning `exports = function () {}` only rebinds the parameter. The caller still receives `module.exports`, the original empty object. Reassigning `module.exports` is what replaces the export. The limit of "they are aliases" is that sentence. They are aliases until you assign to the name `exports` itself.

> **Q: Is `require` synchronous or asynchronous, and where is the result stored?**
> Synchronous. It resolves the path, reads the file, runs it, and returns `module.exports` before your next line runs. The result is stored on `require.cache`, keyed by the resolved absolute path, so the file runs at most once per process. A second `require` of the same path returns the cached exports and does not run the file. The limit is an ES module that uses top-level `await`. A synchronous `require` cannot wait. On current Node it loads an ES module only when that graph has no top-level `await`. Otherwise it throws `ERR_REQUIRE_ASYNC_MODULE`.

> **Q: What happens with a circular dependency in CommonJS?**
> Node puts the module in `require.cache` before it runs the file. If A requires B and B requires A, the second require of A returns the exports object as it exists at that moment, not a crash and not the finished object. A property assigned after that `require` line is still `undefined` inside B. Finish populating `module.exports` before you require the other file, or move the shared code into a third module both can load. The limit of "cycles are fine" is that partial object. The program runs, and the value is wrong.

## Cheat-card

- Wrapper parameters: `exports`, `require`, `module`, `__filename`, `__dirname`. That is the private scope.
- One value: `module.exports = X`. Several: add properties. Never `exports = X`.
- `require` is synchronous. The cache key is the resolved absolute path.
- A module is a singleton. Top-level code runs once per process.
- A cycle returns partial exports, because the module is cached before it runs.
- `__dirname` is the file's directory. `__filename` is the file. Join paths from `__dirname`.
- Built-ins: `require('node:fs')`.

## Good to know

- Q: How do you make a module NOT be a singleton? You cannot, cleanly. The cache is one object per resolved path. Export a factory the caller invokes for a fresh instance. Deleting `require.cache` is a tooling hack.
- Q: Why is `path.join(__dirname, 'x.json')` safer than `'./x.json'` for `fs`? `fs` resolves a relative path against `process.cwd()`, the directory where `node` was launched. `__dirname` is the file's own directory, so the path is right no matter where the process started.
- `require.main === module` is true only in the entry file. When the entry is an ES module, `require.main` is `undefined`. The ESM equivalent is `import.meta.main`, added in v24.2.0, still early.
- `module.createRequire` was added in v12.2.0. `createRequire(import.meta.url)` gives an ES module a real `require`, including `require.resolve` and `require.cache`. A relative path throws `ERR_INVALID_ARG_VALUE`.
- `require()` of an ES module with no top-level `await` was added in v22.0.0 and v20.17.0 behind `--experimental-require-module`, unflagged in v23.0.0, v22.12.0, and v20.19.0, and stable in v24.15.0. It returns the namespace, default under `.default`, or the `"module.exports"` export. Top-level `await` throws `ERR_REQUIRE_ASYNC_MODULE`. On v22.11.0 without the flag the error is still `ERR_REQUIRE_ESM`.

---

## Learn More

- [Modules: CommonJS modules nodejs.org](https://nodejs.org/api/modules.html)
- [JavaScript modules (import / export) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [Node JS Tutorial for Beginners #6 - Modules and require() Net Ninja](https://www.youtube.com/watch?v=xHLd36QoS4k)
- [How to Import and Export Modules in Node JS (CommonJS) Nikita Dev](https://www.youtube.com/watch?v=XTND4rjATXA)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### `require.main === module`

`require.main` is the `Module` object of the file named on the `node` command line. `module` is this file's own `Module`, one of the wrapper parameters. `require.main === module` is true in exactly one file, the one Node was started with. A file can export a function and also run as a CLI, and the CLI branch does not run when another file requires it. Without the check, requiring a CLI file runs its command-line code, reads the wrong `process.argv`, and may call `process.exit()` inside the importer.

1. `node slugify.js` sets `require.main` to that file's module. Inside it, `module` is the same object.
2. `node app.js` sets `require.main` to `app.js`. When `app.js` requires `./slugify`, `slugify.js` has a different `module`, so the check is false.
3. When the entry is an ES module, there is no CommonJS main. `require.main` is `undefined` in every CommonJS file of that process.
4. The ESM check is `import.meta.main`.

**Example. One file as a library and as a CLI.**

javascript

```
// slugify.js — a library function that is also a tiny CLI
function slugify(text) {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
module.exports = slugify;

if (require.main === module) {
  // Only runs for `node slugify.js ...`, never for require('./slugify')
  console.log(slugify(process.argv.slice(2).join(' ')));
}
```


javascript

```
// app.js
const slugify = require('./slugify');
console.log('app sees:', slugify('Hello, World!'));
console.log('require.main is app.js:', require.main === module);
```


bash

```
$ node slugify.js Hello Node World
hello-node-world
$ node app.js
app sees: hello-world
require.main is app.js: true
```

When `app.js` is the entry, the CLI branch in `slugify.js` did not run.

### `module.createRequire(filename)`

`createRequire`, from `node:module`, builds a CommonJS `require`, with `require.resolve` and `require.cache`, that resolves as if it were called from the file you name. ES modules have no `require`, because the wrapper never runs. `createRequire(import.meta.url)` gives one back, so ESM can load a CommonJS-only file, read JSON without an import attribute, or ask where a package resolved.

1. Pass an absolute path, a `file:` URL string, or a `URL`. That location is the base for relative specifiers and for the `node_modules` walk.
2. The function then does ordinary CommonJS: resolve, cache, wrap, run, return `module.exports`.
3. A relative path is rejected with `ERR_INVALID_ARG_VALUE`. It has no base.

**Example. `require` inside an ES module.** Same folder as `slugify.js`, `package.json` `{ "name": "l11-demo" }`.

javascript

```
// entry.mjs — an ES module entry point
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const slugify = require('./slugify.js');          // a CommonJS file
console.log('from ESM:', slugify('Node Modules 101'));
console.log(require('./package.json').name);       // JSON, synchronously
console.log(require.resolve('./slugify.js').endsWith('/slugify.js'));
console.log('import.meta.main:', import.meta.main);

try {
  createRequire('./');
} catch (err) {
  console.log(err.code, '-', err.message.split('\n')[0]);
}
```


bash

```
$ node entry.mjs
from ESM: node-modules-101
l11-demo
true
import.meta.main: true
ERR_INVALID_ARG_VALUE - The argument 'filename' must be a file URL object, file URL string, or absolute path string. Received './'
```


### `require(esm)`: loading an ES module with `require()`

`require` is synchronous, so it cannot wait on top-level `await`. If the whole ES module graph is synchronous, current Node loads, links, and evaluates it on the spot and returns the module namespace. If any module in the graph uses top-level `await`, `require()` throws `ERR_REQUIRE_ASYNC_MODULE` and you use `import()`. Before this, a CommonJS app that required an ESM-only package failed with `ERR_REQUIRE_ESM`.

The version steps are in Good to know. On v24.19.0 nothing is printed by default, and `process.features.require_module` is `true`.

1. `require(spec)` resolves the path and decides the file is ESM: `.mjs`, a `.js` file under `"type": "module"`, or a `.js` file with no `"type"` that contains ESM syntax.
2. Node loads and links the static `import` graph synchronously.
3. Top-level `await` anywhere in that graph throws `ERR_REQUIRE_ASYNC_MODULE`.
4. Otherwise you get the namespace. Named exports are properties. The default is `.default`. `__esModule: true` is set when a default exists, so older compiled code can find it. The docs call `__esModule` experimental and meant for tools.
5. If the module exports a binding named `"module.exports"`, `require()` returns that value instead of the namespace. Lesson 12 covers that from the author's side.

**Example. What `require()` returns, and the top-level await limit.**

javascript

```
// point.mjs — an ES module with a default and a named export
export default class Point {
  constructor(x, y) { this.x = x; this.y = y; }
}
export function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
```


javascript

```
// main.cjs — CommonJS requiring an ES module, synchronously
const ns = require('./point.mjs');
console.log(ns);
const Point = ns.default;                       // the default export lives on .default
console.log(ns.distance(new Point(0, 0), new Point(3, 4)));
console.log('require_module:', process.features.require_module);
```


javascript

```
// config.mjs — top-level await makes this module asynchronous
const { setTimeout: sleep } = await import('node:timers/promises');
await sleep(10);
export const port = 4300;
```


javascript

```
// tla.cjs — require() refuses an ES module graph that uses top-level await
try {
  require('./config.mjs');
} catch (err) {
  console.log(err.code);
  console.log(err.message.split('\n')[0]);
}
import('./config.mjs').then((ns) => console.log('import() works:', ns.port));
```


bash

```
$ node main.cjs
[Module: null prototype] {
  __esModule: true,
  default: [class Point],
  distance: [Function: distance]
}
5
require_module: true
$ node tla.cjs
ERR_REQUIRE_ASYNC_MODULE
require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.
import() works: 4300
$ node --trace-require-module=all main.cjs 2>&1 >/dev/null
(node:115942) ExperimentalWarning: CommonJS module /…/main.cjs is loading ES Module /…/point.mjs using require().
Support for loading ES Module in require() is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
$ npx node@22.11.0 main.cjs
node:internal/modules/cjs/loader:1309
    throw new ERR_REQUIRE_ESM(filename, true);
    ^

Error [ERR_REQUIRE_ESM]: require() of ES Module /…/point.mjs not supported.
Instead change the require of /…/point.mjs to a dynamic import() which is available in all CommonJS modules.
    at TracingChannel.traceSync (node:diagnostics_channel:315:14)
    at Object.<anonymous> (/…/main.cjs:2:12) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v22.11.0
```

On v22.12.0 the same `main.cjs` printed the namespace plus an `ExperimentalWarning`. The trace flag on v24.19.0 still uses the old "experimental" wording, although the docs mark the feature stable since v24.15.0.

### Common mistakes & gotchas (additional topics)

- **Forgetting `.default`.** `require('./point.mjs')` is the namespace, not the class. `new Point()` throws `TypeError: Point is not a constructor`. Use `.default`, unless the module exports `"module.exports"`.
- **Adding top-level `await` to a library.** Every CommonJS `require()` of that graph starts failing with `ERR_REQUIRE_ASYNC_MODULE`. For a published package, that is a breaking change.
- **Assuming every supported Node has `require(esm)`.** v22.11.0 still throws `ERR_REQUIRE_ESM` without the flag. Check `process.features.require_module`, or keep `import()` while you support older lines.
- **`createRequire` with a relative path.** It throws `ERR_INVALID_ARG_VALUE`. Pass `import.meta.url` or an absolute path.
- **Depending on `__esModule`.** Hand-written CommonJS should read `.default`.

### Edge case worked through: `require.main` under an ES module entry

A CommonJS file loaded by an ES module entry, an `.mjs` server or a test runner, has no CommonJS main module.

javascript

```
// who.cjs — prints how it was loaded
console.log('require.main:', require.main === undefined ? 'undefined' : require.main.filename.split('/').pop());
console.log('am I main?', require.main === module);
```


javascript

```
// start.mjs
import './who.cjs';
```


bash

```
$ node who.cjs
require.main: who.cjs
am I main? true
$ node start.mjs
require.main: undefined
am I main? false
```

`require.main.filename` throws `TypeError` under an ESM entry, because `require.main` is `undefined`. Use `__dirname` of a known file, or `process.argv[1]` for the entry script's path.

### ⭐ Interview lens (additional topics)

> **Q: “Can CommonJS `require()` an ES module today?”**  
> Yes, when the ES module graph has no top-level `await`. It has been unflagged since v22.12.0 and v20.19.0, and stable since v24.15.0. `require()` returns the namespace, with the default under `.default`, or the value exported as `"module.exports"`. If the graph uses top-level `await`, it throws `ERR_REQUIRE_ASYNC_MODULE`, and the answer is `await import()`. The trap is "never, you get `ERR_REQUIRE_ESM`." That is true for v22.11 and older lines without the flag, not for current Node.

> **Q: “How do you write a file that is both a module and a script?”**  
> Guard the script with `if (require.main === module)`. `require.main` is the entry file's module, so the check is true only for `node thatfile.js`. Callers that `require` the file get the exports and skip the CLI branch. In ESM the equivalent is `import.meta.main`. When the entry point itself is ESM, `require.main` is `undefined`, so a CommonJS file loaded from that process never sees itself as main. The limit is reading `require.main.filename` to find the app directory. Under an ESM entry that property access throws.
