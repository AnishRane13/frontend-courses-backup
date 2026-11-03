---
title: "Module Resolution"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/module-resolution
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Module Resolution

*10 min read · Updated 24 Jul 2026 Topic 13 of 70 Bookmark Mark done Why it matters Module resolution is the algorithm that turns a short string like · Topic 13 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/module-resolution](https://www.geekyfrontend.in/learn/nodejs-backend-kit/module-resolution)

---

## Say it in 30 seconds

Module resolution is the lookup Node runs on every `require` and every `import`. It turns a short string, the specifier, into one file on disk. A path that starts with `./` is a file next to the importer. A bare name like `express` is a walk up the folders named `node_modules`. A name like `node:fs` is a builtin that ships with Node, so there is no disk lookup.

The lookup exists so a program can name a dependency without writing its absolute path. The trade-off is that the same string can mean different files. CommonJS guesses extensions. ES modules do not. And a package's `exports` map can hide files that are sitting on disk.

A specifier is the string you pass to `require` or `import`.

## Why it matters

When the lookup fails you get `MODULE_NOT_FOUND` or `ERR_MODULE_NOT_FOUND`, the two errors you will see most often. The same algorithm answers the questions that otherwise feel like luck. Why did it load version 2 of a package and not version 3? Why did `import 'pkg/internal'` start failing after an upgrade? Why does a monorepo pick the wrong copy? Those are resolution questions.

If you publish a library, the `exports` field is how you decide which files a consumer can reach, and whether `import` and `require` get different builds.

## The concept, simply

Every specifier is one of three kinds, and each is resolved differently.

- **Relative or absolute.** It starts with `./`, `../`, or `/`. Node treats it as a path from the current file, or from the filesystem root, and looks for a matching file or directory.
- **Bare specifier.** `'express'`, `'lodash/fp'`, `'@scope/pkg'`. Node searches `node_modules` folders, walking up the directory tree.
- **Builtin.** `'fs'`, `'path'`, or the explicit `'node:fs'`. Resolved from Node itself. No disk lookup.

![Diagram of the three specifier types and a node_modules lookup walking up the directory tree from a source file to the filesystem root](assets/i10_01_27074a5e.svg)

A package name starts a walk from the file that imported it, through each parent `node_modules`, until the package is found or the filesystem root is reached.

## How it works

**CommonJS relative paths.** `require('./util')` tries, in order, the exact file `./util`, then `./util.js`, `./util.json`, and `./util.node`, then the directory `./util`. For a directory it reads `package.json` and uses `main`, or falls back to `./util/index.js`. The first hit wins. That guessing is what CommonJS is known for.

**ESM relative paths are stricter.** ES modules do not guess extensions and do not look for `index.js` in a directory. `import './util'` fails. You write `import './util.js'` or `import './util/index.js'`. The strictness matches the browser, where a specifier is a URL.

**The `node_modules` walk.** `require('express')` from `/app/src/server.js` looks at `/app/src/node_modules/express`, then `/app/node_modules/express`, then `/node_modules/express`. The first hit wins. The walk starts from the file that called `require`, so a nested dependency can keep its own copy of a package while the app at the top uses another version.

**Inside the package.** Node reads that package's `package.json`. If `exports` is present, it is the only gateway. Otherwise Node uses `main`, and some tools also look at `module` or `browser`. With none of those, it falls back to `index.js`. A subpath like `'lodash/fp'` is the `fp` entry inside `lodash`, either an `exports` key or a literal file when there is no `exports` map.

**`exports` encapsulates.** Any file not listed is unreachable, even if it exists. `import 'pkg/lib/internal.js'` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. The key `"."` is the package root. `"./utils"` is a named subpath. The value is the real file.

![Diagram showing a package.json exports map with import, require and types conditions, and which import specifiers resolve or are blocked](assets/i10_02_e60cb885.svg)

An entry can be an object of conditions, matched top to bottom. Node takes the first key that applies and stops. It does not merge branches. `"default"` matches anything, so it must be last. `"types"` is where TypeScript looks, and it must come first or TypeScript resolves a JavaScript file before it sees the declarations.

| How the package is loaded | Active conditions, most specific first |
| --- | --- |
| `import 'pkg'` in Node | `node`, `import`, `module-sync`, `default` |
| `require('pkg')` in Node | `node`, `require`, `default` |
| bundled for the browser | `browser`, then `import` or `require`, then `default` |
| type-checked by TypeScript | `types` first, then the runtime set |

An `import` from Node matches both `"import"` and `"node"`, so the author's key order decides which one wins. `"import": "./esm.js"` and `"require": "./cjs.js"` is the dual package. The two builds can hold separate state. That is the dual package hazard.

**Where it ends.** The result is one absolute path for CommonJS, or one `file:` URL for ESM. That string, not the original specifier, is the cache key. Two specifiers that resolve to the same real file share one instance. Two routes that normalise to different absolute paths load twice.

A package can import itself by name. `import { thing } from 'mylib'` from inside `mylib` goes through its own `exports`, so tests hit the public surface.

**The rest.** The `imports` field, keys starting with `#`, is a private alias usable only inside that package. `NODE_PATH` adds extra lookup directories and is discouraged. `require.resolve('pkg')` runs the algorithm and returns the path without loading the file. `module.paths` is the folder list the walk would use.

## Code examples

**1. Inspect what a specifier resolves to.**

javascript

```
// Prints the exact file Node would load — great for debugging duplicates.
console.log(require.resolve('express'));
// e.g. /app/node_modules/express/lib/express.js
console.log(require.resolve('./utils'));
// e.g. /app/src/utils/index.js
console.log(module.paths); // the ordered node_modules dirs Node will search
```


**2. A dual-package `exports` map.**

json

```
{
  "name": "mylib",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.cjs",
      "default": "./dist/index.mjs"
    },
    "./utils": "./dist/utils.js"
  }
}
```


**3. Encapsulation in action.**

javascript

```
import mylib from 'mylib';          // -> dist/index.mjs (import condition)
import u from 'mylib/utils';        // -> dist/utils.js (listed subpath)
import x from 'mylib/dist/secret.js';
// throws ERR_PACKAGE_PATH_NOT_EXPORTED — not listed in "exports"
```


**4. Internal imports with the `#` prefix.**

json

```
{
  "imports": {
    "#config": "./src/config.js",
    "#utils/*": "./src/utils/*.js"
  }
}
```


javascript

```
// Anywhere inside the package:
import config from '#config';         // -> ./src/config.js
import { slug } from '#utils/string'; // -> ./src/utils/string.js
```


## Common mistakes & gotchas

- **Extension guessing in ESM.** It works in CommonJS and fails in ESM. Write the full filename.
- **Reaching into internals.** `import 'pkg/lib/x'` breaks the day the author adds `exports`. Use documented entry points.
- **Two copies of one package.** The walk can load two versions, for example two Reacts, which is the classic invalid-hook bug. Check with `require.resolve` and `npm ls pkg`.
- **`"default"` before `"import"`.** Conditions match top to bottom, so `"default"` always wins and the ESM branch is dead.
- **`"types"` not first.** TypeScript never sees the declarations.
- **Assuming `main` still applies.** When `exports` is present, it wins. `main` is only a fallback for old tools.
- **Wrong casing.** `require('./Util')` can work on macOS or Windows and fail on Linux. Match the filename.
- **`NODE_PATH`.** It hides real dependencies and is not portable. Declare dependencies in `package.json`.

## Best practices

- Debug with `require.resolve('pkg')`, `module.paths`, and `npm ls pkg`.
- Import only documented entry points.
- When you publish, set `exports` so internals stay private and `import` and `require` get the right build.
- Order conditions `"types"` first, then `"import"` and `"require"`, and `"default"` last.
- Use a `#` alias in `imports` instead of a long `../../` chain.
- Write the extension on every relative ESM specifier.
- Keep the tree deduped, with a lockfile and `npm dedupe`, so you do not load two copies.

## ⭐ Interview lens

> **Q: Walk me through how Node resolves `require('express')`.**
> `express` is a bare specifier, a package name with no path. Node does not look at the current directory. It walks `node_modules` folders from the file that called `require`, upward: `./node_modules/express`, then `../node_modules/express`, and so on to the filesystem root. The first hit wins. Node then reads that package's `package.json` and picks the entry from `exports` if it exists, otherwise `main`, otherwise `index.js`. For example, `/app/src/server.js` checks `/app/src/node_modules/express` before `/app/node_modules/express`. The limit is a second copy. A nested package can keep its own `express` in its own `node_modules`, and the walk from that file finds that copy first.

> **Q: How does resolving `'./util'` differ between CJS and ESM?**
> CommonJS guesses. It tries the exact file `util`, then `util.js`, `util.json`, and `util.node`, then the directory `util` with its `package.json` `main` or `util/index.js`. ESM does none of that. The specifier is a URL, so you write the exact filename, `./util.js`. For example, `require('./util')` succeeds when `util.js` exists, and `import './util'` throws `ERR_MODULE_NOT_FOUND` for the same file. The limit of "it worked in my last project" is that the last project was CommonJS. The guess does not come with you when you switch.

> **Q: What does the `exports` field do that `main` doesn't?**
> `main` is one entry file and nothing else. Anyone can still import any file in the package by path. `exports` replaces that. Only the subpaths you list are importable, and anything else throws `ERR_PACKAGE_PATH_NOT_EXPORTED` even if the file is on disk. Each entry can also be conditional, so `import` and `require`, or Node and the browser, get different files. For example, `"."` can point at `./esm.js` for `import` and `./cjs.js` for `require`, while `./lib/internal.js` becomes private. The limit is key order. Node takes the first matching condition and stops. Put `"default"` above `"import"` and the ESM file is never used.

> **Q: How can one `require` and `import` of the same package load different code?**
> Conditional exports. The package sets `"exports": { ".": { "import": "./esm.js", "require": "./cjs.js" } }`. Node matches the condition for how the package was loaded and stops. `import 'pkg'` gets `esm.js`. `require('pkg')` gets `cjs.js`. That is the dual package pattern. The limit is state. The two files are two module instances, so a cache, a counter, or a connection opened in one is invisible to the other. That split is the dual package hazard.

## Cheat-card

- Three specifier types: relative or absolute, bare package name, builtin (`node:`).
- CommonJS relative: exact, then `.js`, `.json`, `.node`, then `dir/index.js`. ESM: the exact filename only.
- Bare: walk `node_modules` upward. First hit wins.
- Entry: `exports`, else `main`, else `index.js`.
- `exports` encapsulates. An unlisted path is `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Conditions, top to bottom: `types`, then `import` or `require` or `node` or `browser`, then `default` last.
- `imports` with `#` is a private alias.
- Debug: `require.resolve('x')`, `module.paths`, `npm ls x`.
- The cache key is the resolved absolute path or `file:` URL, not the specifier you wrote.

## Good to know

- Q: You suspect two versions of a library are loaded. How do you confirm? `require.resolve('lib')` from different files shows the paths. `npm ls lib` shows every version. Duplicates happen because the walk starts from each file, so a nested dependency can pin its own copy.
- Q: What is the `#` in `import '#config'`? A private alias from the `imports` field of `package.json`. It works only inside that package, instead of a long relative chain.
- Subpath patterns, a key with one `*`, were added in v14.13.0 and v12.20.0. Trailers such as `./features/*.js` were added in v16.9.0 and v14.19.0. `*` is plain substitution and may contain `/`. The longest prefix wins. A `null` target throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `--preserve-symlinks` was added in v6.3.0 and keeps the symlink path for dependencies. `--preserve-symlinks-main` was added in v10.2.0 and does the same for the entry file. pnpm 10.34.6 with `debug` 4.4.3 and `ms` 2.1.3 depends on the default, which realpaths the link and looks up dependencies from that real path.

---

## Learn More

- [Modules: Packages (resolution, exports, imports) nodejs.org](https://nodejs.org/api/packages.html)
- [Modules: CommonJS modules (module resolution algorithm) nodejs.org](https://nodejs.org/api/modules.html)
- [Node JS Tutorial for Beginners #7 - Module Patterns Net Ninja](https://www.youtube.com/watch?v=9UaZtgB5tQI)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### Subpath patterns in `exports`

A subpath pattern is an `exports` key with one `*`, such as `"./features/*": "./src/features/*.js"`. It exposes a whole folder without listing every file, and everything outside that folder stays private. A `null` target, `"./features/internal/*": null`, cuts a private hole out of a broader pattern. Without patterns, an author lists every file or drops `exports` and makes every internal file importable. The version dates are in Good to know.

1. Node takes the specifier after the package name and prefixes `./`. `feat-kit/features/billing` becomes `./features/billing`.
2. An exact key wins. Otherwise Node picks the pattern with the longest matching prefix before the `*`. `"./features/internal/*"` beats `"./features/*"` for `./features/internal/flags`.
3. The text the `*` matched is substituted into every `*` on the right. It is plain replacement. The match may contain `/`. Node adds no extension and strips none.
4. A `null` target, or no matching key, throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, even if the file exists.
5. If the target file does not exist, the error is `ERR_MODULE_NOT_FOUND` for ESM, or `MODULE_NOT_FOUND` for CommonJS.

**Example. Patterns, a `null` hole, and the extension trap.** `node_modules/feat-kit/package.json`:

json

```
{
  "name": "feat-kit",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.js",
    "./features/*": "./src/features/*.js",
    "./features/internal/*": null
  }
}
```

`try.mjs`:

javascript

```
const specs = [
  'feat-kit/features/billing',         // * = "billing"
  'feat-kit/features/reports/weekly',  // * = "reports/weekly" (may contain /)
  'feat-kit/features/billing.js',      // * = "billing.js" -> billing.js.js
  'feat-kit/features/internal/flags',  // longer key wins: null target
  'feat-kit/src/features/billing.js',  // file exists, but no key matches
];
for (const s of specs) {
  try {
    const m = await import(s);
    console.log('OK  ', s, '->', m.name);
  } catch (e) {
    console.log('FAIL', s, '->', e.code);
    console.log('     ', e.message.replaceAll(process.cwd(), '.').split('\n')[0]);
  }
}
```

Real output on Node v24.19.0. The `…` in the fence replaces the scratch directory.

bash

```
$ find node_modules/feat-kit/src -type f | sort
node_modules/feat-kit/src/features/billing.js
node_modules/feat-kit/src/features/internal/flags.js
node_modules/feat-kit/src/features/reports/weekly.js
node_modules/feat-kit/src/index.js
$ node try.mjs
OK   feat-kit/features/billing -> billing
OK   feat-kit/features/reports/weekly -> reports/weekly
FAIL feat-kit/features/billing.js -> ERR_MODULE_NOT_FOUND
      Cannot find module './node_modules/feat-kit/src/features/billing.js.js' imported from ./try.mjs
FAIL feat-kit/features/internal/flags -> ERR_PACKAGE_PATH_NOT_EXPORTED
      Package subpath './features/internal/flags' is not defined by "exports" in ./node_modules/feat-kit/package.json imported from ./try.mjs
FAIL feat-kit/src/features/billing.js -> ERR_PACKAGE_PATH_NOT_EXPORTED
      Package subpath './src/features/billing.js' is not defined by "exports" in ./node_modules/feat-kit/package.json imported from ./try.mjs
$ node -e "require('feat-kit/features/internal/flags')" 2>&1 | grep -m1 Error | sed 's#in .*/node_modules#in …/node_modules#'
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './features/internal/flags' is not defined by "exports" in …/node_modules/feat-kit/package.json
```

The third line is the trap. Because the key's `*` already maps onto `*.js`, a consumer who writes the extension loads `billing.js.js`. Pick one style. Keys without extensions, and tell consumers to omit them, or trailers on both sides, `"./features/*.js": "./src/features/*.js"`, which also limits the export to `.js` files.

### Symlinks and the pnpm layout

pnpm builds `node_modules` out of symlinks. Each package version lives once, at `node_modules/.pnpm/<name>@<version>/node_modules/<name>`, with its own dependencies as sibling symlinks in that inner `node_modules`. The project's top-level `node_modules` holds symlinks only for the dependencies the project declares. This works because Node, by default, resolves a symlinked module to its real path and uses that real path as the cache key and as the start of that module's own `node_modules` walk. Without that, a package reached through `node_modules/debug` would look for dependencies next to the symlink, where pnpm put nothing.

text

```
app/
├── package.json                 "dependencies": { "debug": "4.4.3" }
└── node_modules/
    ├── debug -> .pnpm/debug@4.4.3/node_modules/debug        (declared, so linked)
    └── .pnpm/
        ├── debug@4.4.3/node_modules/
        │   ├── debug/           real files (hard links into the pnpm store)
        │   └── ms -> ../../ms@2.1.3/node_modules/ms         (debug's own dependency)
        └── ms@2.1.3/node_modules/
            └── ms/              real files
```

1. `require('debug')` from `app/index.js` finds `app/node_modules/debug`, a symlink.
2. Node calls `realpath` and gets `app/node_modules/.pnpm/debug@4.4.3/node_modules/debug`. That real path is the module's `filename` and its `require.cache` key.
3. Inside `debug`, `require('ms')` walks from the real path and finds the sibling symlink `.pnpm/debug@4.4.3/node_modules/ms`.
4. `ms` is realpathed to `.pnpm/ms@2.1.3/node_modules/ms`. Every dependent of `ms@2.1.3` shares that path and one module instance.
5. `--preserve-symlinks` skips step 2 for dependencies. The walk then starts at `app/node_modules/debug/src`, never passes the `.pnpm` sibling folder, and fails.

**Example. Symlink, realpath, and the cache key.** A pnpm 10.34.6 project with `debug` 4.4.3 and `ms` 2.1.3, and `where.cjs`:

javascript

```
const fs = require('node:fs');
const path = require('node:path');
const rel = (p) => path.relative(__dirname, p);

console.log('symlink :', 'node_modules/ms ->', fs.readlinkSync('node_modules/ms'));
console.log('realpath:', rel(fs.realpathSync('node_modules/ms')));
console.log('resolve :', rel(require.resolve('ms')));

require('ms');
const keys = Object.keys(require.cache).filter((k) => k.includes(`${path.sep}ms${path.sep}`));
console.log('require.cache key:', keys.map(rel));
```


bash

```
$ node where.cjs
symlink : node_modules/ms -> .pnpm/ms@2.1.3/node_modules/ms
realpath: node_modules/.pnpm/ms@2.1.3/node_modules/ms
resolve : node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js
require.cache key: [ 'node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js' ]
$ node --preserve-symlinks where.cjs
symlink : node_modules/ms -> .pnpm/ms@2.1.3/node_modules/ms
realpath: node_modules/.pnpm/ms@2.1.3/node_modules/ms
resolve : node_modules/ms/index.js
require.cache key: [ 'node_modules/ms/index.js' ]
```

By default the cache key is the real path inside `.pnpm`. With `--preserve-symlinks` the same file is identified by the symlink path, so a second route to the same files produces a second module instance.

### Common mistakes & gotchas (additional topics)

- **Expecting the most general pattern to win.** Node picks the longest prefix before the `*`. A `null` entry for a subfolder blocks it even when a broader pattern also matches.
- **`--preserve-symlinks` in a pnpm project.** The layout depends on real-path resolution. Dependencies of dependencies stop resolving. The edge case below is the failure.
- **Comparing `require.resolve` with symlink paths.** By default it returns the real path inside `.pnpm`, not `node_modules/<name>/`. A check for `filename.includes('node_modules/debug/')` misses it.

### Edge case worked through: `--preserve-symlinks` breaks a pnpm install

javascript

```
// The app declares only "debug"; debug itself depends on "ms".
const path = require('node:path');
const rel = (p) => path.relative(__dirname, p);

console.log('debug resolves to:', rel(require.resolve('debug')));
try {
  require('debug');
  console.log('debug loaded OK');
} catch (e) {
  console.log(e.code, '-', e.message.split('\n')[0]);
}
```


bash

```
$ find node_modules -maxdepth 4 -not -name '.*' | sort
node_modules
node_modules/debug
node_modules/.pnpm/debug@4.4.3
node_modules/.pnpm/debug@4.4.3/node_modules
node_modules/.pnpm/debug@4.4.3/node_modules/debug
node_modules/.pnpm/debug@4.4.3/node_modules/ms
node_modules/.pnpm/lock.yaml
node_modules/.pnpm/ms@2.1.3
node_modules/.pnpm/ms@2.1.3/node_modules
node_modules/.pnpm/ms@2.1.3/node_modules/ms
node_modules/.pnpm/node_modules
node_modules/.pnpm/node_modules/ms
$ readlink node_modules/debug node_modules/.pnpm/debug@4.4.3/node_modules/ms
.pnpm/debug@4.4.3/node_modules/debug
../../ms@2.1.3/node_modules/ms
$ node run.cjs
debug resolves to: node_modules/.pnpm/debug@4.4.3/node_modules/debug/src/index.js
debug loaded OK
$ node --preserve-symlinks run.cjs
debug resolves to: node_modules/debug/src/index.js
MODULE_NOT_FOUND - Cannot find module 'ms'
```

With default resolution, `debug`'s real path sits inside `.pnpm/debug@4.4.3/node_modules/`, next to its `ms` symlink, so `require('ms')` succeeds. With `--preserve-symlinks`, `debug` is identified as `node_modules/debug/src/index.js`. The walk checks `node_modules/debug/src/node_modules`, `node_modules/debug/node_modules`, and `node_modules/ms`, finds nothing, and fails. `.pnpm/node_modules/ms` is pnpm's hidden hoisting folder, and it is not on that walk either. The Node docs describe the opposite failure for this flag too: a native addon reached through two symlink paths is loaded twice.

### ⭐ Interview lens (additional topics)

> **Q: “A package exports `"./features/*": "./src/features/*.js"`. What do `pkg/features/a/b` and `pkg/features/a.js` load?”**  
> `*` is plain string substitution and may contain `/`, so `pkg/features/a/b` loads `./src/features/a/b.js`. `pkg/features/a.js` substitutes `a.js` and loads `./src/features/a.js.js`, which fails with `ERR_MODULE_NOT_FOUND`. A file outside `src/features`, or one under a `null` target, fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The limit is assuming Node adds the `.js` for you. It does not.

> **Q: “How can pnpm's symlinked `node_modules` work when Node knows nothing about pnpm?”**  
> Node resolves a symlinked module to its real path, then resolves that module's own imports from the real location. pnpm puts each package's dependencies next to its real location, inside `.pnpm/<name>@<version>/node_modules`, so the ordinary walk finds them, and every dependent of the same version shares one real path and one cached instance. `--preserve-symlinks` turns that off and the layout breaks. The limit is a path check written against `node_modules/debug/`. The real filename is under `.pnpm`.
