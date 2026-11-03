---
title: "ES Modules"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/es-modules
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# ES Modules

*10 min read · Updated 24 Jul 2026 Topic 12 of 70 Bookmark Mark done Why it matters ES Modules · Topic 12 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/es-modules](https://www.geekyfrontend.in/learn/nodejs-backend-kit/es-modules)

---

## Say it in 30 seconds

ES modules are JavaScript's own module system, the `import` and `export` syntax, and Node loads them in three steps: it parses every file to find the imports, links those names together, then runs the files. The binding is live. The importer sees the exporter's variable, not a copy taken at load time.

Node has them so the same module syntax can run on the server and in the browser, and so tools can see the dependency graph before any code runs. The trade-off is strictness. A relative import needs the file extension, there is no `__dirname`, and a static `import` cannot sit inside an `if`.

A live binding means the name stays attached to the exporter's variable. Static means the engine reads the import before it runs the file.

## Why it matters

For new backend code, a published library, or code shared with a browser bundle, you need ESM. The boundary with CommonJS is where the real errors live: `ERR_REQUIRE_ESM`, `Cannot use import statement outside a module`, and `__dirname is not defined`. ESM is not new syntax for the same mechanism. It changes when dependencies are resolved, how bindings behave, and which names exist.

## The concept, simply

Instead of `require` and `module.exports`, you write `import` and `export`:

javascript

```
// math.mjs
export function add(a, b) { return a + b; }
export const PI = 3.14159;
export default function multiply(a, b) { return a * b; }

// app.mjs
import multiply, { add, PI } from './math.mjs';
```

`import` and `export` are declarations the engine reads before any code runs. Node parses the graph, links it, then runs module bodies. That is why `import` must be at the top level, and why the specifier must be a string literal. For a computed or conditional load, `await import(expr)` returns a promise.

![Side-by-side comparison table of CommonJS and ES Modules covering file types, loading, exports, timing, bindings and top-level await](assets/i09_01_73d3711b.svg)

CommonJS loads synchronously and hands you a copy of `module.exports`. ESM links live bindings, can use top-level `await`, and does not provide `__dirname`.

## How it works

**How Node decides.** `.mjs` is always ESM. `.cjs` is always CommonJS. A `.js` file follows the nearest `package.json` `"type"`. `"module"` means ESM. `"commonjs"`, or no field, means CommonJS.

**Parse, link, evaluate.** Node parses every module to discover imports and exports without running code, links each import to the exported binding, then evaluates bodies in dependency order. That ahead-of-time graph is what bundlers tree-shake, and it is why ESM cycles are more predictable than CommonJS ones.

**Live bindings.** `require` snapshots `module.exports`. `import` is a read-only view of the exporter's binding. If the exporter later assigns an exported `let`, importers see the new value. You cannot assign to an import.

javascript

```
// counter.mjs
export let count = 0;
export function inc() { count++; }

// app.mjs
import { count, inc } from './counter.mjs';
console.log(count); // 0
inc();
console.log(count); // 1  — live binding reflects the change
// count = 5;       // TypeError: Assignment to constant variable-like binding
```

**Top-level `await`.** An ESM body may `await` at the top. Any module that imports it waits for those awaits before its own body runs. CommonJS cannot do this, which is why a synchronous `require` cannot load an ESM graph that uses it.

**Once, then cached.** Like CommonJS, a given module runs once per process. The registry key is the resolved URL. CommonJS caches the finished `module.exports` object. ESM caches a module record whose bindings stay live. The key includes the query string, so `import './x.js?v=1'` and `import './x.js?v=2'` are two instances. There is no `delete require.cache` for ESM.

**`import.meta`.** Node provides `import.meta.url`, the module's `file:` URL. On Node 20.11 and 21.2 and later, `import.meta.dirname` and `import.meta.filename` are there too. `import.meta.resolve(specifier)` is the ESM form of `require.resolve`. It returns the URL without loading. Turn the URL into a path with `fileURLToPath`. Slicing off `file://` by hand breaks on Windows drive letters and on spaces.

**No `__dirname`, no `require`.** There is no CommonJS wrapper.

javascript

```
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Node 20.11+ / 21.2+ also expose import.meta.dirname and import.meta.filename directly.
```

**Interop.**

- ESM may import CommonJS. `module.exports` becomes the default export. `import pkg from 'some-cjs-lib'` is that object. Node also tries to detect named exports, which works for built-ins and many packages. When detection fails, import the default and destructure.
- CommonJS calling `require()` on ESM used to throw `ERR_REQUIRE_ESM`. `await import()` works from both sides. Current Node can `require()` an ESM graph that has no top-level `await`. `import()` is still the portable answer. Lesson 11 has the versions.
- Relative ESM specifiers need the extension. `import './util.js'`, not `import './util'`.

## Code examples

**1. Named, default, and namespace imports.**

javascript

```
// shapes.mjs
export const PI = 3.14159;
export function area(r) { return PI * r * r; }
export default class Circle { constructor(r) { this.r = r; } }

// app.mjs
import Circle, { area, PI } from './shapes.mjs'; // default + named
import * as shapes from './shapes.mjs';          // namespace object
console.log(shapes.PI, shapes.default);          // 3.14159, [class Circle]
```


**2. Top-level await.**

javascript

```
// config.mjs
const res = await fetch('https://example.com/config.json');
export const config = await res.json();

// server.mjs — waits for config.mjs's top-level awaits before running
import { config } from './config.mjs';
console.log('Loaded config:', config);
```


**3. Load CommonJS from ESM.**

javascript

```
// legacy-lib is CommonJS: module.exports = { greet }
import legacy from 'legacy-lib';   // whole module.exports as default
legacy.greet('world');
// Named import may also work if Node detects it:
import { greet } from 'legacy-lib'; // best-effort static analysis
```


**4. Load ESM from CommonJS with dynamic import.**

javascript

```
// index.cjs (CommonJS)
async function main() {
  const { default: chalk } = await import('chalk'); // chalk is ESM-only
  console.log(chalk.green('works from CJS via import()'));
}
main();
```


## Common mistakes & gotchas

- **No file extension.** `import './util'` throws `ERR_MODULE_NOT_FOUND`. Write `'./util.js'`.
- **`__dirname` in ESM.** It is not defined. Use `import.meta.dirname`, or rebuild it from `import.meta.url`.
- **`require` of an ESM-only package.** The classic error is `ERR_REQUIRE_ESM`. Use `await import()`, or make the caller ESM. On current Node, `require` works only when the graph has no top-level `await`.
- **Forgetting `"type": "module"`.** A `.js` file that uses `import` in a default package throws `Cannot use import statement outside a module`.
- **A conditional static `import`.** It is hoisted and always evaluated. Use `await import()` for a real condition.
- **Named imports from every CJS package.** Detection is a heuristic. Import the default and destructure when it fails.
- **Assigning to an import.** Imports are read-only live bindings.
- **`module.exports` and `export` in one file.** A file is one system or the other.

## Best practices

- For a new project, set `"type": "module"` and use `import` and `export`.
- Write the extension on every relative import.
- Replace `__dirname` with `import.meta.dirname`, or `fileURLToPath` on older Node.
- A published library that must serve both worlds uses the `exports` field with `import` and `require` conditions. Lesson 13.
- Use `await import()` when you must load ESM from CommonJS, or load conditionally.
- Top-level `await` delays every importer. If the work can be a function, make it a function.
- Prefer named exports. Keep `default` for one primary value.

## ⭐ Interview lens

> **Q: Name three concrete differences between ESM and CommonJS beyond syntax.**
> First, loading. `require` runs at the moment you call it and blocks until the file returns. `import` is read before any code runs, and the graph can be asynchronous. Second, bindings. CommonJS hands you a copy of `module.exports` at that moment. ESM gives you a live read-only view of the exporter's variable, so a later assignment is visible. Third, the environment. ESM has top-level `await` and `import.meta`, and it does not have `__dirname` or `require`. For example, `import './util'` fails until you write `./util.js`, because ESM does not guess extensions. The limit is treating "ESM is just `require` with different punctuation" as the whole answer. The load time and the binding are different mechanisms.

> **Q: What does "live binding" mean?**
> An imported name points at the exporter's variable. It is not a copy of the value at import time. If the exporting module later assigns that `let`, importers see the new value, and they cannot assign to the import themselves. In CommonJS, `const x = require('./m').n` captured whatever `n` was when `require` returned. Change `n` afterward and `x` stays old, unless you kept the exports object and read the property again. The limit is a `const` export. A live binding of a `const` cannot change, because the exporter cannot reassign it either.

> **Q: How does Node decide whether a `.js` file is ESM or CJS?**
> It looks at the nearest `package.json`. `"type": "module"` makes `.js` ESM. `"type": "commonjs"`, or no `type` field, makes `.js` CommonJS. The extension overrides that. `.mjs` is always ESM and `.cjs` is always CommonJS. For example, the same source with `import` works in a folder whose package says `"type": "module"` and throws `Cannot use import statement outside a module` next door. The limit is syntax detection. Since v22.7.0 and v20.19.0, a `.js` file with no `"type"` can still be treated as ESM if it contains `import` or `export`. Do not infer the system from the extension alone.

> **Q: You get `ERR_REQUIRE_ESM`. What is happening and how do you fix it?**
> A CommonJS file called `require()` on a package that is ESM only. `require` is synchronous, and an ES module may use top-level `await`, which cannot finish synchronously. Fix it by making the caller ESM, or by writing `const mod = await import('pkg')`, which works from both systems. On Node since v22.12.0 and v20.19.0, `require()` of an ESM graph succeeds when that graph has no top-level `await`. The limit of "just require it" is that await. Add top-level `await` later and the same `require` throws `ERR_REQUIRE_ASYNC_MODULE`.

## Cheat-card

- ESM: `.mjs`, or `.js` with `"type": "module"`. CommonJS: `.cjs`, or `.js` by default.
- `export`, `export default`, `import x, { y } from './f.js'`.
- Relative ESM specifiers need the extension.
- Live read-only bindings. CommonJS copied the exports object.
- Top-level `await` is ESM only, and it makes the module async.
- No `__dirname`. Use `import.meta.dirname` or `fileURLToPath(import.meta.url)`.
- ESM imports CommonJS as the default. CommonJS loads ESM with `await import()`, or with `require` when the graph has no top-level `await`.
- `await import(expr)` is the dynamic load, in both systems.

## Good to know

- Q: How do you get `__dirname` in an ES module? `path.dirname(fileURLToPath(import.meta.url))`, or `import.meta.dirname` on Node 20.11 and later. `import.meta.filename` arrived in the same versions.
- Q: When you `import x from` a CommonJS module, what is `x`? The whole `module.exports` object, as the default export. Named imports may also work if Node's static analysis detects them. When it does not, import the default and destructure.
- JSON: `import x from './x.json' with { type: 'json' }`. Default export only. `assert { type: 'json' }` was removed in v22.0.0 and is a syntax error on v24. Import assertions existed from v17.1.0 and v16.14.0. Attributes, the `with` form, arrived in v21.0.0, v20.10.0, and v18.20.0. JSON modules left experimental in v23.1.0, v22.12.0, v20.18.3, and v18.20.5. Text modules on v24.19.0 need `--experimental-import-text`, added in v24.19.0.
- `module.registerHooks({ resolve, load })` was added in v23.5.0 and v22.15.0, and it has been a release candidate since v24.13.1. The hooks are synchronous and on the same thread, and they apply to `import` and `require`. `module.register()` was added in v20.6.0 and v18.19.0 and is deprecated since v24.15.0, DEP0205. Load hooks with `--import`, not from a sibling static import.
- `"module.exports"` as an export name, so `require()` returns that value, has been supported since v23.0.0 and v22.12.0. The `"module-sync"` exports condition was added in v22.10.0 and v20.19.0. On v22.10 and v22.11 it needs `--experimental-require-module`.
- Type stripping of `.ts` files is stable since v24.12.0. `.mts` is always ESM. A `.ts` file follows `"type"`. Relative imports use the `.ts` extension. `import type` is required for type-only imports, because every other import stays a runtime import. Nothing is type-checked. Lesson 95.

---

## Learn More

- [Modules: ECMAScript modules nodejs.org](https://nodejs.org/api/esm.html)
- [JavaScript modules (import / export) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
- [ESM vs CommonJS in your Node Projects Covalence](https://www.youtube.com/watch?v=I3DrifH-rJE)
- [Outbound HTTP: fetch, undici and http.request (this kit)](44-outbound-http-fetch-undici-and-http-request.md)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### Import attributes: `with { type: 'json' }`

An import attribute is a key-value list after the specifier, `import data from './x.json' with { type: 'json' }`. It tells the loader which format the importer expects. Node supports one key, `type`. It accepts `'json'`, and `'text'` which on v24.19.0 still needs `--experimental-import-text`. The attribute exists because an extension is not proof of format. Requiring `type: 'json'` means a JSON import cannot be evaluated as JavaScript, and the attribute is part of the module cache key. Without it, a JSON import fails with `ERR_IMPORT_ATTRIBUTE_MISSING`. The version history is in Good to know.

1. The parser reads the `with` clause with the specifier. For dynamic `import()`, the attributes go in the second argument: `import(spec, { with: { type: 'json' } })`.
2. The loader checks the format against the attribute. A JSON file without `type: 'json'` throws `ERR_IMPORT_ATTRIBUTE_MISSING`.
3. The JSON is parsed once and exposed as the default export only. There are no named exports.
4. The parsed object is also stored in the CommonJS cache, so `require()` of the same path returns the same object.

**Example. Static and dynamic JSON imports.** `config.json` is `{ "port": 4300, "features": ["a", "b"] }`. `package.json` is `{ "name": "l12-demo", "version": "1.4.0" }`.

javascript

```
// attrs.mjs
import config from './config.json' with { type: 'json' };
import { createRequire } from 'node:module';

console.log(config.port, config.features);

// Dynamic form: the attributes go in the second argument, under `with`
const { default: pkg } = await import('./package.json', { with: { type: 'json' } });
console.log(pkg.name, pkg.version);

// One shared object: the JSON module is also put in the CommonJS cache
const require = createRequire(import.meta.url);
console.log('same object as require():', require('./config.json') === config);
```


bash

```
$ node attrs.mjs
4300 [ 'a', 'b' ]
l12-demo 1.4.0
same object as require(): true
```

And the three ways to get it wrong, each a one-line file:

bash

```
$ node noattr.mjs      # import c from './config.json';
…
TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "file:///…/config.json" needs an import attribute of "type: json"
…
$ node assert.mjs      # import c from './config.json' assert { type: 'json' };
file:///…/assert.mjs:1
import c from './config.json' assert { type: 'json' }; console.log(c);
                              ^^^^^^

SyntaxError: Unexpected identifier 'assert'
…
$ node named.mjs       # import { port } from './config.json' with { type: 'json' };
file:///…/named.mjs:1
…
SyntaxError: The requested module './config.json' does not provide an export named 'port'
…
```


### Module customization hooks: `module.registerHooks()` and `module.register()`

A `resolve` hook turns a specifier into a URL. A `load` hook turns a URL into `{ format, source }`. Tools use them to teach Node new file types without a build step: TypeScript loaders, mocks, import maps, `.sql` or `.yaml`. The version and stability notes are in Good to know.

1. Register hooks before the code they should affect, usually `node --import ./hooks.mjs app.mjs`, or `--require`.
2. For each `import` or `require`, Node calls the last-registered `resolve` hook with `(specifier, context, nextResolve)`. The hook returns `{ url }` or calls `nextResolve`.
3. Node then calls the `load` chain with `(url, context, nextLoad)`. A hook may return `{ format, source }`. `format` is one of `module`, `commonjs`, `json`, `module-typescript`, `commonjs-typescript`, `wasm`, `builtin`, or `addon`.
4. A hook that returns without calling `next` must set `shortCircuit: true`, or Node throws `ERR_INVALID_RETURN_PROPERTY_VALUE`.
5. Node evaluates the returned source in that format.

**Example. A `load` hook that makes `.sql` files importable.**

javascript

```
// sql-hooks.mjs — let `import q from './x.sql'` and `require('./x.sql')` return the file's text
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('.sql')) return nextLoad(url, context);   // everything else: default loader
    const text = readFileSync(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      source: `export default ${JSON.stringify(text)};`,
      shortCircuit: true,                                        // we did not call nextLoad
    };
  },
});
```


javascript

```
// app.mjs  (get-user.sql contains: SELECT id, name FROM users WHERE id = $1;)
import getUser from './get-user.sql';
import { createRequire } from 'node:module';
console.log('import :', getUser.trim());
const require = createRequire(import.meta.url);
console.log('require:', require('./get-user.sql').default.trim());
```


bash

```
$ node --import ./sql-hooks.mjs app.mjs
import : SELECT id, name FROM users WHERE id = $1;
require: SELECT id, name FROM users WHERE id = $1;
$ node app.mjs
…
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".sql" for /…/get-user.sql
…
```

The same synchronous hook served both `import` and `require()`. The `require()` result needed `.default`, because the format was `'module'` and `require` of ESM returns the namespace.

### TypeScript files

On v24.19.0, Node runs `.ts`, `.mts`, and `.cts` by stripping type annotations. The rules match this lesson. `.mts` is always ESM. `.ts` follows `"type"`. Relative imports need the real extension, `import './env.ts'`. Mark type-only imports with `import type`, because every other import stays a runtime import. Nothing is type-checked. The `tsconfig` setup is in lesson 95.

### `require(esm)` from the ES module author's side

Since v22.12.0 and v20.19.0, unflagged, and stable since v24.15.0, CommonJS can `require()` your ES module while the graph is synchronous. What those callers receive is part of the package API. You control the shape, whether top-level `await` forbids `require()`, and which file they get through `"module-sync"`.

1. By default, `require()` returns the namespace. Named exports are properties. The default is under `.default`. `__esModule: true` is set when a default exists.
2. `export { log as 'module.exports' }` makes `require()` return that value, like `module.exports = log`. Other named exports are then invisible to `require()` unless you attach them to that value. `import` callers still see everything.
3. Top-level `await` in your module, or in anything it statically imports, makes every `require()` throw `ERR_REQUIRE_ASYNC_MODULE`. Adding it later is a breaking change for CommonJS users.
4. In `"exports"`, `"module-sync"` matches `import`, `import()`, and `require()`, but only on Node versions where `require(esm)` is enabled. List it before a CommonJS `"default"` and new Node gets one ESM file, while older Node still gets the CommonJS build. That file must not use top-level `await`.

**Example. The `"module.exports"` export.**

javascript

```
// logger.mjs — ESM that hands CommonJS callers a plain function
export default function log(msg) { console.log(`[log] ${msg}`); }
export const level = 'info';                     // lost to require() callers
export { log as 'module.exports' };
```


javascript

```
// use-logger.cjs
const log = require('./logger.mjs');
log('hello from CJS');
console.log(typeof log, log.level);
import('./logger.mjs').then((ns) => console.log(Object.keys(ns)));
```


bash

```
$ node use-logger.cjs
[log] hello from CJS
function undefined
[ 'default', 'level', 'module.exports' ]
```


**Example. One ESM file for everyone, with `"module-sync"`.** `node_modules/greet/package.json`:

json

```
{
  "name": "greet",
  "exports": {
    "module-sync": "./index.mjs",
    "default": "./index.cjs"
  }
}
```

The two entry files:

javascript

```
// node_modules/greet/index.mjs
export function greet(name) { return `hi ${name} (from index.mjs)`; }
```


javascript

```
// node_modules/greet/index.cjs
exports.greet = (name) => `hi ${name} (from index.cjs)`;
```

The caller:

javascript

```
// use-greet.cjs
const { greet } = require('greet');
console.log('require:', greet('Ada'));
import('greet').then((m) => console.log('import :', m.greet('Ada')));
```


bash

```
$ node use-greet.cjs
require: hi Ada (from index.mjs)
import : hi Ada (from index.mjs)
$ node --no-require-module use-greet.cjs
require: hi Ada (from index.cjs)
import : hi Ada (from index.cjs)
$ npx node@22.11.0 use-greet.cjs
require: hi Ada (from index.cjs)
import : hi Ada (from index.cjs)
```

Both callers get the same `index.mjs`, so there is one module instance and no dual-package hazard, meaning two copies of the package's state. Where `require(esm)` is off, Node skips `"module-sync"` and uses `"default"`.

### Common mistakes & gotchas (additional topics)

- **`assert { type: 'json' }`.** Removed in v22.0.0. It is `SyntaxError: Unexpected identifier 'assert'`. Use `with`.
- **Named imports from JSON.** `import { port } from './config.json' with { type: 'json' }` fails. JSON modules have only a default export.
- **New hooks on `module.register()` or `--loader`.** `register()` is deprecated, DEP0205. `--experimental-loader` warns you to use `register()` instead. Use `module.registerHooks()`.
- **A `load` hook that does not continue the chain.** Returning `{ format, source }` without `nextLoad()` or `shortCircuit: true` throws `ERR_INVALID_RETURN_PROPERTY_VALUE` because `shortCircuit` was undefined.
- **`"module.exports"` plus an expectation that named exports survive.** `require()` callers get only that value. In the example, `log.level` was `undefined`.

### Edge case worked through: registering hooks in the file that needs them

Static `import` declarations are loaded and linked before any code in the importing module runs. A hook registered by one static import does not exist yet while its sibling imports load.

javascript

```
// inline.mjs — registers the hook in the same file that needs it
import './sql-hooks.mjs';                 // runs registerHooks()
import query from './get-user.sql';      // static: linked BEFORE any code above runs
console.log(query);
```


javascript

```
// inline-fixed.mjs — register first, then load with dynamic import()
import './sql-hooks.mjs';
const { default: query } = await import('./get-user.sql');
console.log(query.trim());
```


bash

```
$ node inline.mjs
…
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".sql" for /…/get-user.sql
…
$ node inline-fixed.mjs
SELECT id, name FROM users WHERE id = $1;
```

`sql-hooks.mjs` appears first, but Node has to load `get-user.sql` during linking, before `sql-hooks.mjs` has been evaluated. Register hooks with `--import` or `--require`, or load the affected modules with `import()` or `require()` after you register.

### ⭐ Interview lens (additional topics)

> **Q: “Why does importing JSON need `with { type: 'json' }`, and what happened to `assert`?”**  
> The attribute says which format the importer expects. The loader checks it before evaluating anything, so a JSON import cannot run as code, and the attribute is part of the module cache key. The older `assert` syntax, import assertions, was replaced by `with`, import attributes, in v21.0.0 and v20.10.0, and removed in v22.0.0. JSON modules expose only a default export. The limit is a named import. `import { port } from './config.json' with { type: 'json' }` does not work.

> **Q: “You maintain an ESM-only package. How do you keep CommonJS users working?”**  
> Keep the graph free of top-level `await`, so `require(esm)` works on v20.19 and v22.12 and later. Decide what `require()` returns: the namespace, so callers use `.default`, or a value exported as `"module.exports"`. If you also support older Node, publish a CommonJS build under `"default"` and put `"module-sync"` before it, pointing at the ESM file. The trap is adding top-level `await` later. Every `require()` caller then fails with `ERR_REQUIRE_ASYNC_MODULE`.
