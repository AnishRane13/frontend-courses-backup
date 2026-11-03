---
title: "package.json & Semantic Versioning"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/package-json-semver
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# package.json & Semantic Versioning

*10 min read · Updated 24 Jul 2026 Topic 14 of 70 Bookmark Mark done Why it matters package · Topic 14 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/package-json-semver](https://www.geekyfrontend.in/learn/nodejs-backend-kit/package-json-semver)

---

## Say it in 30 seconds

`package.json` is the manifest for a Node project: its name, the packages it needs, and the commands it runs. Semantic versioning is the promise those version numbers make. MAJOR.MINOR.PATCH means a breaking change, a compatible new feature, or a bug fix. A range such as a caret or a tilde says which of those upgrades are allowed. The lockfile records the exact version that was actually installed.

The split exists so you can accept safe upgrades on purpose, and still have every machine install the same tree until you do. The trade-off is that a range is not a pin. Without the lockfile, the same range can resolve to a different version next week. And a leading zero is special: before 1.0.0, a minor bump counts as breaking.

A lockfile is the file, `package-lock.json` for npm, that stores the chosen version and a hash for every package in the tree.

## Why it matters

Get the manifest right and installs match, upgrades are predictable, and CI stays green. Get the ranges or the lockfile wrong and you ship the usual disasters. It works on one machine, a dependency jumps, or a deploy pulls different code than the laptop did. Most reproducibility and supply-chain incidents come back to two things in this file: what `^` allows, and the fact that the lockfile, not the range, is what got installed.

Semantic versioning is the contract that makes a range mean something. It is the shared promise between the author and everyone who installs the package.

## The concept, simply

A semver version has three numbers, MAJOR.MINOR.PATCH, for example `4.18.2`.

- **MAJOR** is a breaking change. Upgrading may force you to change your code.
- **MINOR** is new functionality that stays backward compatible.
- **PATCH** is a backward compatible bug fix.

You rarely pin one exact version. You write a range, a rule for which versions are acceptable. The caret and the tilde are the common rules. The range says install the newest version that satisfies the rule. A lockfile then records the exact version that was chosen, so every deploy gets the same bytes.

![Diagram of MAJOR MINOR PATCH meaning and the caret, tilde, exact and wildcard range rules against a base version](assets/i11_01_68bcf72b.svg)

Major means breaking, minor means new and compatible, patch means a fix. The caret and the tilde decide how far an install is allowed to move.

## How it works

**Fields you will be asked about.**

- `name` and `version` are the identity. Both are required to publish, and `version` must be valid semver.
- `type` is `"module"` or `"commonjs"`. It decides how `.js` files are read.
- `main` and `exports` are the entry points. Lesson 13.
- `scripts` are the named commands. Lesson 15.
- `dependencies` are needed at runtime and are installed for anyone who installs your package.
- `devDependencies` are for build, test, and lint. They are skipped when your package is installed as someone else's dependency, and you can skip them in production with `npm ci --omit=dev`.
- `peerDependencies` are packages the host app must supply. A React plugin lists `react` as a peer so it shares the app's one copy.
- `optionalDependencies` may fail to install. That is how platform-specific binaries work.
- `engines` names supported Node and npm versions. It is advisory. npm prints `EBADENGINE` and installs anyway, unless `engine-strict=true` in `.npmrc`, which turns the warning into an error. `node` itself never reads the field.
- `files` is the allowlist of what gets published.
- `bin` maps a command name to a file, which is what CLIs and `npx` run.

**Ranges, against `1.2.3`.** The caret allows anything that does not change the left-most non-zero part of the version. For `^1.2.3` that digit is the major, so the range is `>=1.2.3 <2.0.0`. npm writes a caret by default when you `npm install pkg`. The tilde `~1.2.3` is `>=1.2.3 <1.3.0`, patches only. An exact `1.2.3` is only that version. `1.2.x` or `1.2` is any patch of 1.2. `1.x` is any minor or patch of major 1. `>=1.2.3 <2.0.0` is the caret written out. `*` or `latest` is any version. Do not use them.

| Range | Expands to | Takes |
| --- | --- | --- |
| `^1.2.3` | `>=1.2.3 <2.0.0` | minor and patch |
| `^0.2.3` | `>=0.2.3 <0.3.0` | patch only |
| `^0.0.3` | `>=0.0.3 <0.0.4` | nothing, effectively pinned |
| `~1.2.3` | `>=1.2.3 <1.3.0` | patch only |
| `~1.2` | `>=1.2.0 <1.3.0` | patch only |
| `~1` | `>=1.0.0 <2.0.0` | minor and patch |

Before 1.0.0, SemVer says there is no stability guarantee, so the left-most non-zero digit moves right. `^0.2.3` does not allow `0.3.0`. `^0.0.3` does not even allow `0.0.4`.

**Pre-releases sit outside ordinary ranges.** `2.0.0-beta.1` is less than `2.0.0-rc.2`, which is less than `2.0.0`. npm will not give a pre-release to a plain range. `^1.2.3` never selects `2.0.0-beta.1`. Even `^2.0.0-beta.1` matches only other `2.0.0` pre-releases. You opt in with `npm install pkg@next` or an explicit pre-release range. Build metadata after a `+`, such as `1.4.0+20240115`, is ignored for ordering.

**The lockfile is what got installed.** A range says what is allowed. `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml` records the chosen version and the integrity hash of every package, including transitive ones. Commit it. `npm install` may update the lockfile to a newer version that still satisfies the range, and it can change `package.json`. `npm ci` deletes `node_modules`, installs exactly what the lockfile says, and fails if `package.json` and the lockfile disagree. CI and production use `npm ci`.

Until you deliberately `npm update`, the lockfile is why a caret is safe. Without it, `^4.18.2` can be `4.18.2` today and `4.20.0` next week.

## Code examples

**1. A realistic `package.json`.**

json

```
{
  "name": "my-api",
  "version": "1.4.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "./dist/index.js",
  "scripts": {
    "dev": "node --watch src/index.js",
    "build": "tsc -p tsconfig.json",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^4.18.2",
    "zod": "~3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  },
  "files": ["dist"]
}
```


**2. What each range accepts.**

javascript

```
// Given published versions: 1.2.3, 1.2.9, 1.3.0, 1.9.5, 2.0.0
// "^1.2.3" -> highest of 1.2.3 .. 1.9.5 (any minor/patch, not 2.x) -> 1.9.5
// "~1.2.3" -> highest of 1.2.3 .. 1.2.9 (patch only, not 1.3.0)    -> 1.2.9
// "1.2.3"  -> exactly 1.2.3
// "*"      -> 2.0.0 (newest, unpredictable over time)
```


**3. Reproducible install in CI.**

javascript

```
// package.json + package-lock.json are committed together.
// CI / Dockerfile:
//   npm ci                 // exact lockfile install, deterministic
//   npm ci --omit=dev      // production: skip devDependencies
// NOT `npm install` in CI — it may silently bump versions.
```


**4. Pinning when you cannot risk any drift.**

javascript

```
// Save an exact version instead of a caret range:
//   npm install lodash --save-exact   // writes "lodash": "4.17.21"
// Or set once in .npmrc:  save-exact=true
```


## Common mistakes & gotchas

- **Not committing the lockfile.** Teammates and CI can get different transitive versions.
- **`npm install` in CI.** It may update versions and the lockfile. Use `npm ci`.
- **A build tool in `dependencies`, or a runtime library in `devDependencies`.** The first bloats production. The second crashes production with module not found.
- **Treating `^0.x` like `^1.x`.** `^0.2.0` stays inside `0.2.x`.
- **Trusting semver blindly.** A patch can break you. The lockfile plus tests are what catch it.
- **`*` or `latest`.** A future major can land with no announcement.
- **Editing versions by hand and forgetting the lockfile.** `npm ci` then refuses to install.
- **Ignoring `peerDependencies` warnings.** A mismatched peer means two copies and subtle bugs.

## Best practices

- Commit the lockfile and review it like source.
- Use `npm ci` in CI and Docker. Add `--omit=dev` for a production image.
- Runtime goes in `dependencies`, tooling in `devDependencies`, host-provided libraries in `peerDependencies`.
- Keep the caret for most dependencies, because the lockfile pins the real version. Pin an exact version for anything security-sensitive, or use a tilde when you want patches only.
- Set `engines.node` to document the runtime. Add `engine-strict=true` to `.npmrc` if an unsupported Node should fail the install. Without it, npm only warns. Yarn 1 fails by default, and `--ignore-engines` skips that check. pnpm installs by default and fails with `engine-strict=true` (`ERR_PNPM_UNSUPPORTED_ENGINE`). Yarn 4 ignores `engines` entirely.

  Real output with `"engines": { "node": ">=99" }` on Node v24.19.0 / npm 11.17.0:

  ```
  $ npm install            # first warning shown; exit code 0
  npm warn EBADENGINE Unsupported engine {
  npm warn EBADENGINE   package: 'app@1.0.0',
  npm warn EBADENGINE   required: { node: '>=99' },
  npm warn EBADENGINE   current: { node: 'v24.19.0', npm: '11.17.0' }
  npm warn EBADENGINE }
  added 1 package in 183ms

  $ echo "engine-strict=true" > .npmrc && npm install     # exit code 1
  npm error code EBADENGINE
  npm error engine Unsupported engine
  npm error engine Not compatible with your version of node/npm: app@1.0.0
  ```

  (Package-manager behaviour verified with npm 11.17.0, pnpm 10.34.6 and 12.9.1, Yarn 1.22.22 and 4.18.1.)
- Add a `files` allowlist, or `.npmignore`, so you publish only what you mean to.
- Upgrade on purpose with `npm update` or `npm outdated`, run tests, then commit the new lockfile.
- Do not hand-edit `package-lock.json`. Let the CLI write it.

## ⭐ Interview lens

> **Q: Explain `^1.2.3` vs `~1.2.3`.**
> Both are ranges, rules for which versions an install may choose. The caret `^1.2.3` allows compatible changes: anything from 1.2.3 up to but not including 2.0.0, so minor and patch. The tilde `~1.2.3` allows patch only: from 1.2.3 up to but not including 1.3.0. npm writes a caret when you `npm install pkg`, so the default takes more updates. The tilde is the conservative one. The limit is a leading zero. `^0.2.3` is not "anything below 1.0.0". It is only `>=0.2.3 <0.3.0`, because the caret freezes the left-most non-zero digit, and before 1.0.0 that digit is the minor.

> **Q: Difference between `npm install` and `npm ci`?**
> `npm install` resolves ranges, may write a newer lockfile and may change `package.json`, and it installs on top of the `node_modules` you already have. `npm ci` is the opposite. It requires a lockfile, deletes `node_modules`, installs exactly the versions and integrity hashes in the lockfile, and exits with an error if `package.json` and the lockfile disagree. Use `npm ci` in CI and in production images, with `--omit=dev` when you do not want build tools. The limit of `npm install` in a pipeline is that two runs a week apart can legally pick different versions that both satisfy `^1.2.3`.

> **Q: dependencies vs devDependencies vs peerDependencies?**
> `dependencies` are what your program needs at runtime. They are installed for you, and for anyone who installs your package. `devDependencies` are for building and testing, TypeScript, a test runner, a linter. They are not installed when someone else depends on your package, and `npm ci --omit=dev` skips them. `peerDependencies` are what the host application must already have, so a plugin shares the app's single copy of React instead of bringing its own. The limit of putting React in `dependencies` of a plugin is two copies, and bugs that only show up because the two copies do not share state.

> **Q: Trap — what does `^0.2.3` allow?**
> Only `>=0.2.3 <0.3.0`. The caret's rule is "do not change the left-most non-zero digit." In `0.2.3` that digit is the minor, so a minor bump is treated as breaking. `0.2.9` is allowed. `0.3.0` is not. The same rule makes `^0.0.3` mean `>=0.0.3 <0.0.4`, effectively pinned. The limit of the usual answer, "anything below 1.0.0", is that it is wrong, and it is the answer people give because they only remember `^1.2.3`.

## Cheat-card

- Semver: MAJOR breaks, MINOR adds compatible behavior, PATCH fixes.
- `^1.2.3` is `>=1.2.3 <2.0.0`. `~1.2.3` is `>=1.2.3 <1.3.0`. `^0.2.3` is `>=0.2.3 <0.3.0`.
- Avoid `*` and `latest`.
- `dependencies` runtime, `devDependencies` build and test, `peerDependencies` host-provided.
- The lockfile pins the exact tree and the hashes. Commit it.
- `npm ci` installs that tree and fails if the manifest disagrees. `npm install` may update it.
- `engines` warns unless `engine-strict=true`. Node does not read it at runtime.
- A pre-release such as `2.0.0-beta.1` is below `2.0.0` and is not selected by a plain range.

## Good to know

- Q: If `package.json` pins ranges, why do we also need a lockfile? A range says what is allowed, not what was installed. Without a lockfile, `^4.18.2` can resolve to different versions over time and across machines. The lockfile records the exact version and the integrity hash of every package, including transitive ones.
- Q: A "patch" upgrade broke production. What went wrong and how do you prevent it? Semver is a promise an author can break, so a patch contained a breaking change. Prevent it with a committed lockfile and `npm ci`, so upgrades happen only when you choose, plus tests before you adopt the new lockfile. Pin exact versions for critical packages.
- `overrides` is read only from the root `package.json`. A global rule replaces a package everywhere. `"debug": { "ms": "2.1.2" }` replaces it only under `debug`. `npm ls` labels the result `overridden`. A conflict with your own direct dependency is `EOVERRIDE` unless the override uses `$ms` to mean your direct spec. Yarn calls the field `resolutions`. pnpm has its own `overrides`.
- `packageManager`, for example `pnpm@10.34.6` plus a hash, is enforced by Corepack shims, not by npm. Corepack was added in v16.9.0 and v14.19.0, ships in Node v24 as experimental, and is disabled until `corepack enable`. The v24 docs say it will no longer be distributed starting with Node.js v25.
- `"private": true` makes a real `npm publish` fail with `EPRIVATE`. In npm 11.17.0, `npm publish --dry-run` on a single package does not run that check and can print a success line. A workspace publish checks earlier and skips private packages with a warning.
- `sideEffects` is read by bundlers, not by Node. `false` lets the bundler drop a module whose exports are unused. An array lists files that must be kept. esbuild 0.28.2 dropped `track.js` while the field was `false` and kept its `console.log` once the field was `true`. Node ran `track.js` either way.

---

## Learn More

- [package.json docs.npmjs.com](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)
- [About semantic versioning docs.npmjs.com](https://docs.npmjs.com/about-semantic-versioning)
- [Modules: Packages (package.json fields) nodejs.org](https://nodejs.org/api/packages.html)
- [NPM Semantic Versioning (SemVer) Explained for Beginners! CodeLucky](https://www.youtube.com/watch?v=3GmNhGBow7Q)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### `overrides`

`overrides` in the root `package.json` replaces the version npm would pick anywhere in the tree, including a dependency of a dependency. You use it when a transitive package has a fix the parent has not adopted yet. Without it you fork the parent or keep the old version. The details of scope and the `EOVERRIDE` rule are in Good to know.

1. While building the tree, every time a parent asks for a range, npm checks the root `overrides` for that package name, optionally scoped under the parent.
2. A match resolves the override spec instead, even outside the original range.
3. The chosen version is written to `package-lock.json`, and `npm ls` labels it `overridden`.
4. Overrides inside installed packages or workspace packages are ignored.
5. Overriding a package you also depend on directly is `EOVERRIDE` unless the specs match or the override uses a `$name` reference.

**Example. Pin a transitive dependency, globally and only under one parent.** `debug@4.4.3` asks for `ms@^2.1.3`.

json

```
{
  "name": "app",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "debug": "4.4.3" },
  "overrides": { "ms": "2.1.2" }
}
```

Real output, Node v24.19.0, npm 11.17.0:

bash

```
$ npm view debug@4.4.3 dependencies
{ ms: '^2.1.3' }
$ npm install >/dev/null && npm ls --all | tail -n +2
└─┬ debug@4.4.3
  └── ms@2.1.3
$ npm install >/dev/null && npm ls --all | tail -n +2
└─┬ debug@4.4.3
  └── ms@2.1.2 overridden
$ grep -A1 '"node_modules/ms"' package-lock.json
    "node_modules/ms": {
      "version": "2.1.2",
$ npm install >/dev/null && npm ls --all | tail -n +2
├─┬ debug@4.4.3
│ └── ms@2.1.2 overridden
└── ms@2.1.3
```

The first tree is the normal resolution. The second shows `ms@2.1.2 overridden`, outside `debug`'s own `^2.1.3`. The last command used `"overrides": { "debug": { "ms": "2.1.2" } }` with a direct `"ms": "^2.1.3"` in the app, so only the copy under `debug` changed and npm nested it.

### `workspaces`

`workspaces` is an array of folder paths or globs in the root `package.json`. Each matching folder with its own `package.json` joins one install: npm links `node_modules/<name>` to that folder and writes one lockfile. Packages in the repo can depend on each other's source without publishing. Layouts, pnpm, Yarn, and publishing are in lesson 16.

1. npm expands globs such as `packages/*` into folders that contain a `package.json`.
2. Each folder joins the graph under its `name`. A dependency on that name, if the range matches, resolves to the local folder.
3. npm symlinks `node_modules/<name>` to the folder and hoists third-party packages to the root `node_modules`.
4. Root-only fields, including `overrides`, are read from the root manifest, not from a workspace.

**Example. Workspace links, and a workspace-level `overrides` that npm ignores.**

bash

```
$ cat package.json packages/a/package.json
{
  "name": "root",
  "private": true,
  "workspaces": ["packages/*"]
}
{
  "name": "a",
  "version": "1.0.0",
  "dependencies": { "b": "^1.0.0", "debug": "4.4.3" },
  "overrides": { "ms": "2.1.2" }
}
$ npm install >/dev/null && npm ls --all | tail -n +2
├─┬ a@1.0.0 -> ./packages/a
│ ├── b@1.0.0 deduped -> ./packages/b
│ └─┬ debug@4.4.3
│   └── ms@2.1.3
└── b@1.0.0 -> ./packages/b
$ readlink node_modules/a node_modules/b
../packages/a
../packages/b
```

`b` was linked rather than downloaded. `ms` stayed at 2.1.3 because the `overrides` block was in `packages/a/package.json`, which npm does not read for overrides.

### `packageManager` and Corepack

`packageManager` names a package manager, an exact version, and an optional hash, such as `"pnpm@10.34.6+sha512.…"`. npm and Node do not act on it. Corepack does. Its shims read the nearest `package.json`, download that exact release, check the hash, and run it, so CI does not need a global install. The version notes are in Good to know.

1. `corepack enable` writes shims named `pnpm`, `pnpx`, `yarn`, and `yarnpkg`. It does not shim `npm` unless asked.
2. Running `pnpm` makes the shim walk up to the nearest `package.json` and read `packageManager`.
3. If the field names pnpm, Corepack downloads that version into `COREPACK_HOME` (on Linux, `$HOME/.cache/node/corepack` by default), verifies the hash if present, and runs it.
4. If the field names a different manager, the shim refuses, so Yarn cannot write a `yarn.lock` into a pnpm project.
5. `corepack use pnpm@x.y.z` writes the field, including the hash, and runs an install.

**Example. Pin pnpm and watch the shims enforce it.** The shims and `COREPACK_HOME` point at a throwaway directory, so the real Node install and `$HOME` are not touched.

bash

```
$ corepack --version
0.35.0
$ corepack enable --install-directory …/shims && ls …/shims
pnpm
pnpx
yarn
yarnpkg
$ corepack use pnpm@10.34.6 | tail -1 && cat package.json
Done in 307ms using pnpm v10.34.6
{
  "name": "app",
  "private": true,
  "packageManager": "pnpm@10.34.6+sha512.7e1ae66a83a9143c118cc1944f37cc4f2b8acddeda4b001cfa78908f6e46e45e15292739ca6c9d026426cc757e9318cc98c5551d6a16c165097b0028ba87b4e6"
}
$ which pnpm && pnpm --version
…/shims/pnpm
10.34.6
$ yarn install; echo "exit code $?"
This project is configured to use pnpm because …/pm-demo/package.json has a "packageManager" field
exit code 1
$ npm install >/dev/null; echo "exit code $?"
exit code 0
```

`pnpm` ran the pinned 10.34.6. `yarn` was refused because the project names pnpm. Plain `npm install` succeeded, because `npm` is not shimmed and npm does not read the field.

### `private`

`"private": true` makes npm refuse to publish. It protects application repos, monorepo roots, and internal packages from an accidental `npm publish`.

1. `npm publish` packs the tarball and checks credentials, then whether the version already exists.
2. For a single package, the `private` check happens just before upload, so it only runs on a real publish. In npm 11.17.0, `npm publish --dry-run` stops earlier and can report success for a private package.
3. `npm publish --workspaces` checks `private` earlier, skips private workspaces with a warning, and publishes the rest. That check does run in a dry run.

**Example. The refusal, captured without a real upload.** `--dry-run` does not exercise the check, so the second command publishes against a local stand-in registry on port 4601 that answers every request with an error. `registry.log` records what npm sent.

javascript

```
// Local stand-in registry: answers every GET with 404 and refuses every PUT.
require('node:http').createServer((req, res) => {
  console.error('[registry]', req.method, req.url);
  res.writeHead(req.method === 'GET' ? 404 : 403, { 'content-type': 'application/json' });
  res.end('{"error":"not found"}');
}).listen(4601, '127.0.0.1');
```


bash

```
$ npm publish --dry-run 2>&1 | grep -v 'npm notice [0-9a-z]'
npm notice
npm notice 📦  internal-app@1.0.0
npm notice Tarball Contents
npm notice Tarball Details
npm notice
npm warn publish This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
npm notice Publishing to https://registry.npmjs.org/ with tag latest and default access (dry-run)
+ internal-app@1.0.0
$ npm publish --registry http://127.0.0.1:4601/ --//127.0.0.1:4601/:_authToken=fake-token 2>&1 | grep -v 'npm notice'
npm error code EPRIVATE
npm error This package has been marked as private
npm error Remove the 'private' field from the package.json to publish it.
npm error A complete log of this run can be found in: …/_logs/….log
$ cat registry.log
[registry] GET /internal-app
[registry] GET /internal-app
$ npm publish --dry-run --workspaces 2>&1 | grep -E '^\+|Skipping'
+ @acme/utils@1.0.0
npm warn publish Skipping workspace @acme/api, marked as private
```

The dry run printed `+ internal-app@1.0.0` as if the publish would succeed. The real publish stopped with `EPRIVATE` after only two `GET` requests. No `PUT` reached the registry. The workspace dry run, the lesson 16 repository whose `@acme/api` is private, skipped the private workspace.

### `sideEffects`

`sideEffects` is read by bundlers such as webpack, esbuild, and Rollup, not by Node. `"sideEffects": false` promises that importing a file only defines exports, so a bundler may drop the module when none of its exports are used. An array such as `["./track.js", "*.css"]` lists files that do have import-time effects and must be kept. Without the hint, a bundler keeps every module a used module re-exports, because running it might matter.

1. The bundler follows `import { add } from 'fx-lib'` into `index.js`, which re-exports `add.js` and `track.js`.
2. It marks used exports. Only `add` is used.
3. If the package says `"sideEffects": false`, or `track.js` is not in the array, the bundler drops `track.js`, including its top-level `console.log`.
4. If `sideEffects` is `true` or missing, the bundler keeps that top-level code and drops only unused exports.
5. Node never reads the field. `node app.mjs` evaluates every imported module.

**Example. The same import, run by Node and bundled by esbuild 0.28.2.**

json

```
{
  "name": "fx-lib",
  "version": "1.0.0",
  "type": "module",
  "exports": "./index.js",
  "sideEffects": false
}
```


javascript

```
export { add } from './add.js';
export { track } from './track.js';
```


javascript

```
console.log('track.js ran: analytics installed');
export const track = (e) => console.log('track', e);
```


javascript

```
import { add } from 'fx-lib';
console.log('add(2, 3) =', add(2, 3));
```


bash

```
$ npx esbuild --version
0.28.2
$ node app.mjs
track.js ran: analytics installed
add(2, 3) = 5
$ npx esbuild app.mjs --bundle --format=esm --log-level=warning
// node_modules/fx-lib/add.js
var add = (a, b) => a + b;

// app.mjs
console.log("add(2, 3) =", add(2, 3));
$ sed -i 's/"sideEffects": false/"sideEffects": true/' node_modules/fx-lib/package.json && grep sideEffects node_modules/fx-lib/package.json
  "sideEffects": true
$ npx esbuild app.mjs --bundle --format=esm --log-level=warning
// node_modules/fx-lib/add.js
var add = (a, b) => a + b;

// node_modules/fx-lib/track.js
console.log("track.js ran: analytics installed");

// app.mjs
console.log("add(2, 3) =", add(2, 3));
```

Node ran `track.js`. esbuild omitted it while the field was `false`, and kept the `console.log` once the field was `true`. A polyfill, a CSS import, or a global registration covered by `"sideEffects": false` disappears from the bundle with no error.

### Common mistakes & gotchas (additional topics)

- **`overrides` in a workspace package.** npm reads them only from the root and ignores the rest with no warning.
- **A changed `overrides` against an existing lockfile.** In npm 11.17.0, adding the override to an already-installed single package nested `ms@2.1.2` under `node_modules/debug/node_modules/ms` instead of replacing the root copy. In a workspace repo it left `ms@2.1.3` until `node_modules` and `package-lock.json` were deleted. The clean install then installed 2.1.2, and `npm ls` reported it as `invalid` rather than `overridden`. After editing overrides, reinstall from scratch and check `npm ls <pkg>`.
- **Trusting `npm publish --dry-run` to catch `private`.** It does not, for a single package in npm 11.17.0. Only a real publish raises `EPRIVATE`.
- **Assuming npm enforces `packageManager`.** Only Corepack shims, or another tool that reads the field, enforce it.
- **`"sideEffects": false` on a file that does something at import time.** Bundlers then drop polyfills, CSS, and registrations. List those files in an array.
- **Expecting `sideEffects` to change Node.** Node ignores it.

### Edge case worked through: overriding a package you also depend on directly

The app depends on `"ms": "^2.1.3"` and tries a global `"overrides": { "ms": "2.1.2" }`.

json

```
{
  "name": "app",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "debug": "4.4.3", "ms": "^2.1.3" },
  "overrides": { "ms": "2.1.2" }
}
```


bash

```
$ npm install; echo "exit code $?"
npm error code EOVERRIDE
npm error Override for ms@^2.1.3 conflicts with direct dependency
npm error A complete log of this run can be found in: …/_logs/….log
exit code 1
$ npm pkg set 'overrides.ms=$ms' && npm install >/dev/null && npm ls --all | tail -n +2
├─┬ debug@4.4.3
│ └── ms@2.1.3 deduped
└── ms@2.1.3
```

npm refuses an override that conflicts with a direct dependency, because the override would contradict the range you wrote. The `$ms` reference means "use the spec of my direct dependency `ms`", which makes the override consistent. Here that pins every copy of `ms` to your `^2.1.3`, so the copy under `debug` dedupes to the same 2.1.3.

### ⭐ Interview lens (additional topics)

> **Q: “A transitive dependency has a CVE fixed in a patch release, but the package that depends on it hasn't updated. What do you do?”**  
> Add an `overrides` entry in the root `package.json` pinning the fixed version. Yarn's field is `resolutions`. pnpm has its own `overrides`. Scope it under the parent if only one path should change, reinstall, and confirm with `npm ls <pkg>` that the line says `overridden`. Overrides inside a workspace or a dependency are ignored. A conflict with a direct dependency needs the `$name` reference or npm raises `EOVERRIDE`. The trap is editing the copy inside `node_modules`. The next install erases it.

> **Q: “What do `private`, `packageManager` and `sideEffects` each control, and who reads them?”**  
> `private` is read by npm and blocks `npm publish` with `EPRIVATE`. A workspace publish skips private packages. `packageManager` is read by Corepack, which runs that exact manager version and refuses a different one. npm itself ignores it. `sideEffects` is read only by bundlers, which may drop unused modules when it is `false`. Node ignores it. The limit of checking `private` with `npm publish --dry-run` is that, for a single package on npm 11.17.0, the dry run never reaches that check.
