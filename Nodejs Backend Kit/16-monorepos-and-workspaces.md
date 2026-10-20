---
title: "Monorepos and Workspaces"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Monorepos and Workspaces

*16 min read · Updated 7 Oct 2026 · Topic 74 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

A backend team rarely ships one package. A typical company has an API, a background worker, a shared validation library, a shared logger, and a TypeScript and lint configuration that every one of them should use. Kept in separate repositories, each change to the shared library becomes a release dance: publish `utils@1.4.0`, open a pull request in the API to bump the range, wait for CI, repeat for the worker. Bugs hide in the gap, because the API is tested against last week's `utils`, not the code you just wrote.

A **monorepo** puts all of those packages in one git repository, and **workspaces** are the package-manager feature that makes that practical: one `install` links the local packages to each other, so the API imports the `utils` source on disk instead of a published copy. The same features also create a class of bugs you never see in a single-package project: code that works only because of hoisting (phantom dependencies), two copies of the same library in one process (`instanceof` returning `false`), version numbers that drift, and CI that rebuilds everything on every commit. This lesson shows the real on-disk layout each package manager produces, so those bugs stop being mysterious.

## The concept, simply

A monorepo is one repository with many `package.json` files. A workspace setup has five concrete parts:

1. **The root manifest.** A `package.json` at the top, usually `"private": true`, that lists where the packages live: `"workspaces": ["packages/*", "apps/*"]` for npm and Yarn, or a `pnpm-workspace.yaml` file for pnpm.
2. **Workspace packages.** Each folder matched by those globs, with its own `package.json`, `name`, `version`, dependencies and scripts.
3. **Links.** At install time, the package manager makes each workspace package reachable by name through a symlink in a `node_modules` folder (for npm, `node_modules/@acme/utils -> ../../packages/utils`). Nothing is copied; your edits are visible immediately.
4. **One lockfile.** The whole graph (every workspace, every third-party package) is resolved in one pass and recorded in a single `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock` at the root.
5. **A task runner.** Something that runs `build` or `test` in every package, ideally in dependency order and skipping work whose inputs have not changed: the package manager's own `--workspaces` / `-r` flags, or a build orchestrator such as Turborepo or Nx.

Workspaces do not change how Node itself loads modules. Node still runs the same `node_modules` walk it always has; the package manager only arranges files and symlinks so that the walk finds the right thing.

## How it works

**What `npm install` does in a workspace root**, step by step:

1. It reads the root `package.json` and expands the `workspaces` globs into a list of folders.
2. It reads each folder's `package.json`. Every workspace becomes a node in the dependency graph, under its `name`.
3. It resolves the dependencies of all workspaces together. A dependency on `@acme/utils` is satisfied by the local workspace when the local version matches the requested range.
4. It places third-party packages. npm **hoists**: it puts each package as high as possible, normally in the root `node_modules`, and only nests a copy inside a workspace (`packages/x/node_modules/…`) when two workspaces need incompatible versions.
5. It creates a symlink in the root `node_modules` for every workspace package.
6. It writes one `package-lock.json` that records workspace folders as `"link": true` entries.

**Why hoisting works: Node's `node_modules` walk.** When `apps/api/index.js` calls `require('ms')`, Node does not know about workspaces. It looks for `apps/api/node_modules/ms`, then `apps/node_modules/ms`, then `<root>/node_modules/ms`, and so on up to the filesystem root, stopping at the first hit. npm puts every hoisted package in the root `node_modules`, which sits above every workspace folder, so the walk from any workspace ends there. The same walk is what makes **phantom dependencies** possible: `apps/api` can `require('debug')` without declaring it, because `@acme/utils` declared it and npm hoisted it to the root, where the walk from `apps/api` finds it anyway.

![Diagram of the three specifier types and a node_modules lookup walking up the folder tree, missing /app/src/node_modules/express and finding /app/node_modules/express](assets/i10_01_27074a5e.svg)
*Figure: how Node resolves a bare specifier by walking `node_modules` folders up the directory tree. Look at: the lookup panel, where `/app/src/node_modules/express` misses and `/app/node_modules/express` is found. A hoisted root `node_modules` plays the role of `/app/node_modules` for every workspace.*

**pnpm uses isolation instead of hoisting.** pnpm stores one copy of each package version in a content-addressable store and hard-links the files into `node_modules/.pnpm/<name>@<version>/node_modules/<name>`. Each project then gets symlinks only for the dependencies it declares: `apps/api/node_modules/ms` is a symlink into `.pnpm`, and `debug` is absent there because `apps/api` never asked for it. A package's own dependencies are siblings of it inside `.pnpm/<name>@<version>/node_modules/`, so `debug` still finds `ms`. Node follows the symlinks to the real path (lesson 13 covers that), and the walk from `apps/api` never passes a folder that contains `debug`. Result: undeclared imports fail.

**Yarn 4 (Berry) defaults to Plug'n'Play.** With no configuration, `yarn install` writes no `node_modules` at all. It writes `.pnp.cjs`, a generated module that patches Node's resolver with a table of "package X may load packages A, B, C, located here". Plain `node index.js` therefore fails; you run code through `yarn node`, which loads `.pnp.cjs` first. Setting `nodeLinker: node-modules` in `.yarnrc.yml` makes Yarn produce an npm-style hoisted tree instead.

**The `workspace:` protocol.** pnpm and Yarn let you write `"@acme/utils": "workspace:*"`, which means "this must be the local workspace; fail instead of downloading from the registry". On `pnpm pack` / `pnpm publish` the protocol is rewritten into a normal range: `workspace:*` becomes the exact local version (`1.0.0`), `workspace:^` becomes `^<version>`, and `workspace:~` becomes `~<version>`. npm 11 does not support the protocol and stops with `EUNSUPPORTEDPROTOCOL`; in npm you write a normal range (`"*"` or `"^1.0.0"`) and npm links the local package when its version satisfies the range.

**Shared configuration through `extends`.** Put a `base.json` in a workspace package such as `@acme/tsconfig` and write `"extends": "@acme/tsconfig/base.json"` in each package's `tsconfig.json`. TypeScript resolves that specifier through `node_modules` like any package, finds the workspace symlink and merges the base options under the local ones. One rule bites people: relative paths inside a base file (`outDir`, `rootDir`, `include`) are resolved relative to the **base file**, not to the package that extends it, so keep those in each package's own `tsconfig.json`. ESLint's flat config has no `extends` string; a shared config is just a workspace package that exports an array, and the root `eslint.config.mjs` imports it and spreads it.

**Root scripts.** The root `package.json` holds the commands people actually type: `"build": "npm run build --workspaces --if-present"`, `"start": "npm start -w @acme/api"`. `-w <name>` (or `--workspace`) targets one workspace, `--workspaces` targets all of them, and `--if-present` skips workspaces that lack the script. npm runs workspaces in the order the `workspaces` globs list them, **not** in dependency order (Example 2 proves it). pnpm's `pnpm -r run build` and Yarn's `yarn workspaces foreach -t` do sort topologically.

**Build orchestration and caching (Turborepo, Nx).** An orchestrator replaces "run the script in every package" with a task graph plus a cache:

1. It reads the workspace list from the package manager and the task rules from its config (`turbo.json`). `"dependsOn": ["^build"]` means "before building a package, build the packages it depends on".
2. For each task it computes a hash from the task's inputs: the files matched by `inputs` (by default, the package's git-tracked files), the resolved dependency versions, the task configuration, and the hashes of the dependency tasks it waits on.
3. It looks the hash up in the local cache (`.turbo/cache`), and optionally a shared remote cache.
4. On a **hit** it skips the script, restores the files listed in `outputs` (for example `dist/**`) and replays the logged output.
5. On a **miss** it runs the script, then stores the outputs and logs under the new hash.

Because a package's hash includes its dependencies' hashes, editing `@acme/utils` invalidates `@acme/api` too, while editing only `@acme/api` leaves the `utils` entry cached. Example 7 shows all three cases with Turborepo 2.11.7. Nx implements the same idea (a project graph, cache keys from inputs, restored outputs) with its own `nx.json` configuration.

> ⚠️ Unverified: Nx was not installed or run for this lesson; its behaviour is described from the nx.dev documentation only.

**Versioning and publishing with Changesets.** When several packages publish to npm, someone has to decide each new version, update the ranges of local dependents and write changelogs. Changesets turns that into files committed with the code:

1. `npx changeset init` creates `.changeset/config.json`.
2. With each change, a contributor adds a small Markdown file in `.changeset/` (by hand or with `npx changeset`) whose front matter names the packages and the bump type (`major`, `minor`, `patch`), and whose body is the changelog line.
3. `npx changeset version` reads all pending changeset files, computes the new versions, rewrites the `package.json` files, bumps local dependents whose ranges no longer match, updates their ranges, writes `CHANGELOG.md` entries, and deletes the consumed changeset files.
4. `npx changeset publish` publishes every package whose version is not on the registry yet and creates git tags.

## Code examples

**Example 1 — npm workspaces: the real `node_modules` layout after install.** Root `package.json`:

json

```
{
  "name": "acme",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm test --workspaces --if-present",
    "start": "npm start -w @acme/api"
  }
}
```

`packages/utils/package.json` and `packages/utils/index.js`:

json

```
{
  "name": "@acme/utils",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "debug": "^4.4.3" },
  "scripts": {
    "build": "node -e \"console.log('build utils')\"",
    "test": "node -e \"console.log('test utils')\""
  }
}
```

javascript

```
const debug = require('debug')('acme:utils');

exports.slug = (s) => {
  debug('slug %s', s);
  return s.toLowerCase().replace(/\s+/g, '-');
};
```

`apps/api/package.json` and `apps/api/index.js` (note `"@acme/utils": "*"`, a normal range that the local workspace satisfies):

json

```
{
  "name": "@acme/api",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "@acme/utils": "*", "ms": "^2.1.3" },
  "scripts": {
    "build": "node -e \"console.log('build api')\"",
    "start": "node index.js"
  }
}
```

javascript

```
const path = require('node:path');
const { slug } = require('@acme/utils');

console.log(slug('Hello Monorepo World'));
// Where did '@acme/utils' come from? Print it relative to the repo root.
const root = path.resolve(__dirname, '../..');
console.log('resolved to', path.relative(root, require.resolve('@acme/utils')));
```

Real output (Node v24.19.0, npm 11.17.0; `…` replaces the scratch directory path):

bash

```
$ npm install

added 4 packages, and audited 7 packages in 798ms

found 0 vulnerabilities
$ ls -la node_modules node_modules/@acme
node_modules:
total 4
drwxrwxr-x 5 anish.r anish.r  120 Oct  7 17:18 .
drwxrwxr-x 5 anish.r anish.r  140 Oct  7 17:18 ..
-rw-rw-r-- 1 anish.r anish.r 1327 Oct  7 17:18 .package-lock.json
drwxrwxr-x 2 anish.r anish.r   80 Oct  7 17:18 @acme
drwxrwxr-x 3 anish.r anish.r  120 Oct  7 17:18 debug
drwxrwxr-x 2 anish.r anish.r  120 Oct  7 17:18 ms

node_modules/@acme:
total 0
drwxrwxr-x 2 anish.r anish.r  80 Oct  7 17:18 .
drwxrwxr-x 5 anish.r anish.r 120 Oct  7 17:18 ..
lrwxrwxrwx 1 anish.r anish.r  14 Oct  7 17:18 api -> ../../apps/api
lrwxrwxrwx 1 anish.r anish.r  20 Oct  7 17:18 utils -> ../../packages/utils
$ ls apps/api/node_modules packages/utils/node_modules
ls: cannot access 'apps/api/node_modules': No such file or directory
ls: cannot access 'packages/utils/node_modules': No such file or directory
$ npm ls --all
acme@ …/ex1-npm
├─┬ @acme/api@1.0.0 -> ./apps/api
│ ├── @acme/utils@1.0.0 deduped -> ./packages/utils
│ └── ms@2.1.3
└─┬ @acme/utils@1.0.0 -> ./packages/utils
  └─┬ debug@4.4.3
    └── ms@2.1.3 deduped
$ npm start

> start
> npm start -w @acme/api


> @acme/api@1.0.0 start
> node index.js

hello-monorepo-world
resolved to packages/utils/index.js
```

Read the layout: `debug` and `ms` were hoisted to the root `node_modules`; neither workspace got its own `node_modules` folder; both workspaces are symlinks under `node_modules/@acme`; and `require('@acme/utils')` resolved to the real file in `packages/utils`, not to a copy.

**Example 2 — running scripts across workspaces with `-w`, `--workspaces` and `--if-present`.** Same repository:

bash

```
$ npm run build

> build
> npm run build --workspaces --if-present


> @acme/utils@1.0.0 build
> node -e "console.log('build utils')"

build utils

> @acme/api@1.0.0 build
> node -e "console.log('build api')"

build api
$ npm test --workspaces

> @acme/utils@1.0.0 test
> node -e "console.log('test utils')"

test utils
npm error Lifecycle script `test` failed with error:
npm error workspace @acme/api@1.0.0
npm error location …/ex1-npm/apps/api
npm error Missing script: "test"
npm error
npm error To see a list of scripts, run:
npm error   npm run --workspace=@acme/api@1.0.0
$ npm test --workspaces --if-present

> @acme/utils@1.0.0 test
> node -e "console.log('test utils')"

test utils
$ npm run build -w @acme/utils

> @acme/utils@1.0.0 build
> node -e "console.log('build utils')"

build utils
$ npm install nanoid@5 -w @acme/api

added 1 package, and audited 8 packages in 684ms

found 0 vulnerabilities
$ npm pkg get dependencies -w @acme/api
{
  "@acme/api": {
    "@acme/utils": "*",
    "ms": "^2.1.3",
    "nanoid": "^5.1.16"
  }
}
$ ls node_modules apps/api/node_modules
ls: cannot access 'apps/api/node_modules': No such file or directory
node_modules:
@acme
debug
ms
nanoid
$ npm pkg set 'workspaces[0]=apps/*' 'workspaces[1]=packages/*' && npm pkg get workspaces
[
  "apps/*",
  "packages/*"
]
$ npm run build | grep '^build'
build api
build utils
```

`npm install nanoid@5 -w @acme/api` wrote the dependency into `apps/api/package.json` but put the package in the root `node_modules`. The last two commands list `apps/*` first, and npm then builds `@acme/api` before the `@acme/utils` it depends on: npm follows the glob order, not the dependency graph.

**Example 3 — the same repository under pnpm 10.** Replace the `workspaces` field with `pnpm-workspace.yaml`, and declare the local dependency with the `workspace:` protocol:

text

```
packages:
  - "apps/*"
  - "packages/*"
```

json

```
{
  "name": "@acme/api",
  "version": "1.0.0",
  "private": true,
  "dependencies": { "@acme/utils": "workspace:*", "ms": "^2.1.3" },
  "scripts": {
    "build": "node -e \"console.log('build api')\"",
    "start": "node index.js"
  }
}
```

Real output (`npx -y pnpm@10.34.6`):

bash

```
$ npx -y pnpm@10.34.6 install --reporter=append-only | tail -3
Progress: resolved 2, reused 2, downloaded 0, added 2, done

Done in 563ms using pnpm v10.34.6
$ ls -A node_modules node_modules/.pnpm
node_modules:
.modules.yaml
.pnpm
.pnpm-workspace-state-v1.json

node_modules/.pnpm:
debug@4.4.3
lock.yaml
ms@2.1.3
node_modules
$ ls -l apps/api/node_modules apps/api/node_modules/@acme packages/utils/node_modules
apps/api/node_modules:
total 0
drwxrwxr-x 2 anish.r anish.r 60 Oct  7 17:18 @acme
lrwxrwxrwx 1 anish.r anish.r 52 Oct  7 17:18 ms -> ../../../node_modules/.pnpm/ms@2.1.3/node_modules/ms

apps/api/node_modules/@acme:
total 0
lrwxrwxrwx 1 anish.r anish.r 26 Oct  7 17:18 utils -> ../../../../packages/utils

packages/utils/node_modules:
total 0
lrwxrwxrwx 1 anish.r anish.r 58 Oct  7 17:18 debug -> ../../../node_modules/.pnpm/debug@4.4.3/node_modules/debug
$ ls -l node_modules/.pnpm/debug@4.4.3/node_modules
total 0
drwxrwxr-x 3 anish.r anish.r 120 Oct  7 17:18 debug
lrwxrwxrwx 1 anish.r anish.r  30 Oct  7 17:18 ms -> ../../ms@2.1.3/node_modules/ms
$ npx -y pnpm@10.34.6 -r run build
Scope: 2 of 3 workspace projects
packages/utils build$ node -e "console.log('build utils')"
packages/utils build: build utils
packages/utils build: Done
apps/api build$ node -e "console.log('build api')"
apps/api build: build api
apps/api build: Done
$ cd apps/api && node index.js
hello-monorepo-world
resolved to packages/utils/index.js
$ npx -y pnpm@10.34.6 store path
/tmp/.pnpm-store/v10
$ stat -c '%h hard links  %n' node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js
6 hard links  node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js
```

The root `node_modules` contains no `debug` and no `ms`, only `.pnpm`. `apps/api/node_modules` has exactly the two things `apps/api` declares, both symlinks. `debug`'s own dependency `ms` sits next to it inside `.pnpm/debug@4.4.3/node_modules`. `pnpm -r run build` built `utils` before `api` even though the YAML lists `apps/*` first, because pnpm sorts by the dependency graph. A hard-link count above 1 shows the file is shared with pnpm's store (the exact count grows with every project on the machine that uses `ms@2.1.3`) (with no store path configured, pnpm creates a `.pnpm-store` at the root of the filesystem the project is on, here the `/tmp` mount, because hard links cannot cross filesystems).

**Example 4 — Yarn 4: Plug'n'Play by default, `node_modules` on request.** Same packages, `workspaces` field as in Example 1, `workspace:*` in `apps/api`:

bash

```
$ npx -y @yarnpkg/cli-dist@4.18.1 install | tail -2
➤ YN0000: └ Completed
➤ YN0000: · Done in 0s 235ms
$ ls -A
.pnp.cjs
.yarn
apps
package.json
packages
yarn.lock
$ cd apps/api && node index.js 2>&1 | head -5
node:internal/modules/cjs/loader:1520
  throw err;
  ^

Error: Cannot find module '@acme/utils'
$ cd apps/api && npx -y @yarnpkg/cli-dist@4.18.1 node index.js
hello-monorepo-world
resolved to packages/utils/index.js
$ echo 'nodeLinker: node-modules' > .yarnrc.yml && npx -y @yarnpkg/cli-dist@4.18.1 install | tail -1
➤ YN0000: · Done in 0s 52ms
$ ls -A node_modules node_modules/@acme
node_modules:
.package-map.json
.yarn-state.yml
@acme
debug
ms

node_modules/@acme:
api
utils
$ cd apps/api && node index.js
hello-monorepo-world
resolved to packages/utils/index.js
```

**Example 5 — what `workspace:*` becomes in the published tarball.** A pnpm workspace package `@acme/logger` with three protocol forms (local versions: `utils` 1.0.0, `config` 2.4.1, `types` 0.9.0):

json

```
{
  "name": "@acme/logger",
  "version": "0.3.0",
  "main": "index.js",
  "dependencies": {
    "@acme/utils": "workspace:*",
    "@acme/config": "workspace:^"
  },
  "devDependencies": {
    "@acme/types": "workspace:~"
  }
}
```

bash

```
$ npx -y pnpm@10.34.6 pack | tail -1
acme-logger-0.3.0.tgz
$ tar -xOzf acme-logger-0.3.0.tgz package/package.json; echo
{
  "name": "@acme/logger",
  "version": "0.3.0",
  "main": "index.js",
  "dependencies": {
    "@acme/config": "^2.4.1",
    "@acme/utils": "1.0.0"
  },
  "devDependencies": {
    "@acme/types": "~0.9.0"
  }
}
$ npm pkg set 'dependencies.@acme/utils=workspace:*' -w @acme/api && npm install
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
npm error A complete log of this run can be found in: …/_logs/….log
```

(The order of the rewritten keys differed between two runs; the values did not.) `workspace:*` became the exact version `1.0.0`, `workspace:^` became `^2.4.1` and `workspace:~` became `~0.9.0`. The last command shows npm refusing the protocol.

**Example 6 — shared tsconfig and lint config, plus root scripts.** This repository uses TypeScript 7.0.2 and ESLint 10.12.0, installed once at the root. Root `package.json`:

json

```
{
  "name": "acme",
  "private": true,
  "packageManager": "npm@11.17.0",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "turbo run build",
    "lint": "eslint .",
    "typecheck": "tsc -b apps/api"
  },
  "devDependencies": {
    "@acme/eslint-config": "*",
    "@acme/tsconfig": "*",
    "eslint": "^10.12.0",
    "turbo": "^2.11.7",
    "typescript": "^7.0.2"
  }
}
```

`packages/tsconfig/base.json` (the package's `package.json` is just `{ "name": "@acme/tsconfig", "version": "1.0.0", "private": true, "files": ["base.json"] }`):

json

```
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "strict": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true
  }
}
```

`apps/api/tsconfig.json` (`packages/utils/tsconfig.json` is the same without `references`):

json

```
{
  "extends": "@acme/tsconfig/base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../../packages/utils" }]
}
```

The shared ESLint config, `packages/eslint-config/index.js`, and the root `eslint.config.mjs` that uses it:

javascript

```
import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    rules: { 'no-var': 'error', eqeqeq: 'error' },
  },
];
```

javascript

```
import acme from '@acme/eslint-config';

export default [
  { ignores: ['**/dist/**'] },
  ...acme,
];
```

A deliberately bad file, `apps/api/scripts/seed.js`:

javascript

```
var count = 0;
if (count == '0') console.log('seeding');
```

Real output (first 14 lines of `--showConfig`, which prints the merged result):

bash

```
$ cd apps/api && npx tsc --version && npx tsc -p tsconfig.json --showConfig | head -14
Version 7.0.2
{
    "compilerOptions": {
        "composite": true,
        "declaration": true,
        "module": "nodenext",
        "outDir": "./dist",
        "rootDir": "./src",
        "skipLibCheck": true,
        "strict": true,
        "target": "es2023",
        "moduleResolution": "nodenext",
        "moduleDetection": "force",
        "incremental": true
    },
$ npm run lint; echo "exit code $?"

> lint
> eslint .


…/tools-ws/apps/api/scripts/seed.js
  1:1   error  Unexpected var, use let or const instead  no-var
  2:11  error  Expected '===' and instead saw '=='       eqeqeq

✖ 2 problems (2 errors, 0 warnings)
  1 error and 0 warnings potentially fixable with the `--fix` option.

exit code 1
```

The merged config contains every option from `base.json` plus the local `rootDir`/`outDir`; the two lint errors come from rules that only the shared package defines.

**Example 6b — edge case: relative paths in a shared tsconfig resolve from the base file.** Add `packages/tsconfig/base-outdir.json` that sets `outDir`, and extend it from `packages/utils` without a local `outDir`:

json

```
{
  "extends": "./base.json",
  "compilerOptions": { "outDir": "dist" }
}
```

json

```
{
  "extends": "@acme/tsconfig/base-outdir.json",
  "include": ["src"]
}
```

bash

```
$ npx tsc -p tsconfig.edge.json --showConfig | grep outDir
        "outDir": "../tsconfig/dist",
```

The output folder resolved to `packages/tsconfig/dist`, next to the base file, so every package that relied on it would write into the same folder in the config package. Keep path options in each package's own `tsconfig.json`.

**Example 7 — Turborepo caching.** `turbo.json` at the root of the Example 6 repository (`turbo` 2.11.7 runs from `node_modules/.bin`; its binary lives outside `/tmp` because `/tmp` is mounted noexec on the test machine):

json

```
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "outputs": ["dist/**"]
    }
  }
}
```

Real output (`Time:` values vary between runs):

bash

```
$ npx turbo --version
2.11.7
$ npx turbo run build --output-logs=hash-only

   • turbo 2.11.7
   • Packages in scope: @acme/api, @acme/eslint-config, @acme/tsconfig, @acme/utils
   • Running build in 4 packages
   • Remote caching disabled

@acme/utils:build: cache miss, executing abe724d136e7b019
@acme/api:build: cache miss, executing c24f015f37ce1dc6

 Tasks:    2 successful, 2 total
Cached:    0 cached, 2 total
  Time:    422ms 
$ npx turbo run build --output-logs=hash-only

   • turbo 2.11.7
   • Packages in scope: @acme/api, @acme/eslint-config, @acme/tsconfig, @acme/utils
   • Running build in 4 packages
   • Remote caching disabled

@acme/utils:build: cache hit, suppressing logs abe724d136e7b019
@acme/api:build: cache hit, suppressing logs c24f015f37ce1dc6

 Tasks:    2 successful, 2 total
Cached:    2 cached, 2 total
  Time:    15ms >>> FULL TURBO
$ rm -rf apps/api/dist packages/utils/dist && npx turbo run build --output-logs=hash-only | grep cache && ls apps/api/dist
@acme/utils:build: cache hit, suppressing logs abe724d136e7b019
@acme/api:build: cache hit, suppressing logs c24f015f37ce1dc6
Cached:    2 cached, 2 total
main.d.ts
main.js
$ echo '// edited' >> apps/api/src/main.ts && npx turbo run build --output-logs=hash-only | grep cache
@acme/utils:build: cache hit, suppressing logs abe724d136e7b019
@acme/api:build: cache miss, executing 2a1aa1c171fb21a1
Cached:    1 cached, 2 total
$ echo '// edited' >> packages/utils/src/index.ts && npx turbo run build --output-logs=hash-only | grep cache
@acme/utils:build: cache miss, executing a62ba92229fba4b7
@acme/api:build: cache miss, executing ccdb4d48be73c500
Cached:    0 cached, 2 total
$ npm start -w @acme/api | tail -1
hello-monorepo-world
$ ls .turbo/cache | head -3
2a1aa1c171fb21a1-manifest.json
2a1aa1c171fb21a1-meta.json
2a1aa1c171fb21a1.tar.zst
```

Run 1 missed and executed both builds, `utils` first because of `^build`. Run 2 hit both and skipped `tsc` completely. After deleting `dist`, Turborepo restored the files from `.turbo/cache`. Editing only `apps/api` re-ran only `api` (same `utils` hash `abe724d136e7b019`); editing `utils` re-ran both, because `api`'s hash includes `utils`'s.

**Example 8 — Changesets: init, a changeset file, `changeset version`.** A throwaway git repository with `@acme/utils` 1.0.0 and `@acme/client` 1.0.0 (which depends on `"@acme/utils": "^1.0.0"`), and `@changesets/cli` 3.0.3 as a root dev dependency. `changeset init` asks four questions (GitHub changelog, auto-commit, public or private access, base branch); the run below accepts each default. The changeset file `.changeset/strict-slug.md`:

text

```
---
"@acme/utils": major
---

`slug()` now throws a TypeError on non-string input.
```

bash

```
$ (for i in 1 2 3 4 5 6; do sleep 2; printf '\r'; done) | npx changeset init 2>&1 | sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' | grep -v '^\s*$' | tail -4
Changesets initialization is complete.
The .changeset folder has been updated with:
- config.json (customized based on the provided preferences)
- README.md (a quick guide for using changesets)
$ cat .changeset/config.json
{
  "$schema": "https://unpkg.com/@changesets/config@4.0.1/schema.json",
  "baseBranch": "main",
  "access": "restricted",
  "format": "auto",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "ignore": [],
  "fixed": [],
  "linked": [],
  "updateInternalDependencies": "patch"
}
$ npx changeset status
🦋 changeset v3.0.3

Packages to be bumped:
- major
  - @acme/utils

- patch
  - @acme/client
$ npx changeset version
🦋 changeset v3.0.3

All files have been updated. Review them and commit at your leisure
$ git status --short
 M packages/client/package.json
 M packages/utils/package.json
?? packages/client/CHANGELOG.md
?? packages/utils/CHANGELOG.md
$ git diff -- packages
diff --git a/packages/client/package.json b/packages/client/package.json
index 6b5a792..aa3d4b1 100644
--- a/packages/client/package.json
+++ b/packages/client/package.json
@@ -1,5 +1,5 @@
 {
   "name": "@acme/client",
-  "version": "1.0.0",
-  "dependencies": { "@acme/utils": "^1.0.0" }
+  "version": "1.0.1",
+  "dependencies": { "@acme/utils": "^2.0.0" }
 }
diff --git a/packages/utils/package.json b/packages/utils/package.json
index 094fea6..43d0b5d 100644
--- a/packages/utils/package.json
+++ b/packages/utils/package.json
@@ -1,4 +1,4 @@
 {
   "name": "@acme/utils",
-  "version": "1.0.0"
+  "version": "2.0.0"
 }
$ cat packages/utils/CHANGELOG.md packages/client/CHANGELOG.md
# @acme/utils

## 2.0.0

### Major Changes

- `slug()` now throws a TypeError on non-string input.
# @acme/client

## 1.0.1

### Patch Changes

- Updated dependencies
  - @acme/utils@2.0.0
$ ls .changeset
README.md
config.json
$ grep -A2 '"packages/utils": {' package-lock.json
    "packages/utils": {
      "name": "@acme/utils",
      "version": "1.0.0"
$ npm install >/dev/null && git status --short package-lock.json && grep -A2 '"packages/utils": {' package-lock.json
 M package-lock.json
    "packages/utils": {
      "name": "@acme/utils",
      "version": "2.0.0"
```

`@acme/utils` went to 2.0.0. `@acme/client` was not mentioned in the changeset, but its range `^1.0.0` no longer accepts 2.0.0, so Changesets bumped it to 1.0.1, rewrote the range to `^2.0.0` and wrote an "Updated dependencies" changelog entry. The changeset file was consumed. `package-lock.json` still recorded `1.0.0` until `npm install` ran. In a separate run with a `minor` changeset instead, `@acme/utils` went to 1.1.0 and `@acme/client` was left untouched, because 1.1.0 still satisfies `^1.0.0`. With `"private": true` on the dependent, Changesets 3.0.3 rewrote its range but did not bump its version (the `privatePackages.version` option defaults to `false` in this version's config schema).

> ⚠️ Unverified: `npx changeset publish` was not run, because it publishes to the real npm registry.

**Example 9 — edge case: a phantom dependency that works under npm and fails under pnpm and Yarn PnP.** `apps/api/phantom.js` uses `debug`, which only `@acme/utils` declares:

javascript

```
// apps/api/phantom.js: @acme/api never declares `debug`; only @acme/utils does.
const path = require('node:path');
const debug = require('debug');
const root = path.resolve(__dirname, '../..');
console.log('loaded debug from', path.relative(root, require.resolve('debug')));
```

The same file in the Example 1 (npm), Example 3 (pnpm) and Example 4 (Yarn PnP) repositories:

bash

```
$ node phantom.js
loaded debug from node_modules/debug/src/index.js
$ node phantom.js 2>&1 | sed -n '5,7p'
Error: Cannot find module 'debug'
Require stack:
- …/ex3-pnpm/apps/api/phantom.js
$ npx -y @yarnpkg/cli-dist@4.18.1 node phantom.js 2>&1 | sed -n '5,8p'
Error: Your application tried to access debug, but it isn't declared in your dependencies; this makes the require call ambiguous and unsound.

Required package: debug
Required by: …/ex4-yarn/apps/api/
```

Under npm the walk from `apps/api` reached the hoisted root copy, so the bug is invisible until someone removes `debug` from `@acme/utils`, or until the package is published and installed somewhere without that sibling. pnpm never put `debug` on the walk from `apps/api`; Yarn PnP refused because its dependency table has no `debug` entry for `@acme/api`. The fix is the same in all three: add `debug` to `apps/api/package.json`.

**Example 10 — edge case: two copies of a package, so `instanceof` is `false`.** `@acme/errors` declares `"http-errors": "^1.8.1"`; `@acme/api` declares `"http-errors": "^2.0.1"`. npm cannot hoist both to the root, so one copy gets nested:

javascript

```
// packages/errors/index.js: declares "http-errors": "^1.8.1"
const createError = require('http-errors');

exports.notFound = (what) => createError(404, `${what} not found`);
```

javascript

```
// apps/api/index.js: declares "http-errors": "^2.0.1"
const path = require('node:path');
const createError = require('http-errors');   // api's copy
const { notFound } = require('@acme/errors'); // builds errors with its own copy

const err = notFound('user');
console.log('err.status:', err.status);
console.log('err instanceof createError.HttpError:', err instanceof createError.HttpError);
console.log('createError.isHttpError(err):', createError.isHttpError(err));

const root = path.resolve(__dirname, '../..');
const fromErrors = require.resolve('http-errors', {
  paths: [path.dirname(require.resolve('@acme/errors'))],
});
console.log('api    loads', path.relative(root, require.resolve('http-errors')));
console.log('errors loads', path.relative(root, fromErrors));
```

bash

```
$ npm ls http-errors | tail -n +2
├─┬ @acme/api@1.0.0 -> ./apps/api
│ └── http-errors@2.0.1
└─┬ @acme/errors@1.0.0 -> ./packages/errors
  └── http-errors@1.8.1
$ node apps/api/index.js
err.status: 404
err instanceof createError.HttpError: false
createError.isHttpError(err): true
api    loads node_modules/http-errors/index.js
errors loads packages/errors/node_modules/http-errors/index.js
$ npm pkg set 'dependencies.http-errors=^2.0.1' -w @acme/errors && npm install >/dev/null && npm ls http-errors | tail -n +2
├─┬ @acme/api@1.0.0 -> ./apps/api
│ └── http-errors@2.0.1
└─┬ @acme/errors@1.0.0 -> ./packages/errors
  └── http-errors@2.0.1 deduped
$ node apps/api/index.js
err.status: 404
err instanceof createError.HttpError: true
createError.isHttpError(err): true
api    loads node_modules/http-errors/index.js
errors loads node_modules/http-errors/index.js
```

Two copies on disk means two module instances, and each defines its own `HttpError` class, so an error built by one copy is not an instance of the other copy's class. An Express error handler that checks `err instanceof createError.HttpError` would treat a 404 as a 500. `isHttpError` still returned `true` because it checks the shape of the object, not the class. Aligning the range made npm dedupe to one copy, and `instanceof` became `true`. The same mechanism is behind duplicate React copies and any module-level singleton (a connection pool, a registry, a cache) that silently exists twice.

## Common mistakes & gotchas

- **Relying on hoisting.** Under npm any workspace can import anything another workspace declared. It works until the hoisted copy moves or the package is published. Declare every import in the package that uses it; pnpm or Yarn PnP will catch the omission (Example 9).
- **Assuming `npm run x --workspaces` runs in dependency order.** It follows the `workspaces` glob order. Use pnpm `-r`, `yarn workspaces foreach -t`, or an orchestrator with `dependsOn: ["^build"]`.
- **Using `workspace:*` with npm.** npm 11 rejects it with `EUNSUPPORTEDPROTOCOL`. Use a normal range with npm; use `workspace:` only with pnpm or Yarn, which rewrite it on pack/publish.
- **Version-range mismatches between workspaces.** Two workspaces asking for incompatible ranges of a stateful library get two copies, and `instanceof`, `Symbol`-keyed registries and module-level caches split in two (Example 10). Check with `npm ls <pkg>` and align ranges.
- **Running `node index.js` in a Yarn PnP repo.** There is no `node_modules`; use `yarn node` or set `nodeLinker: node-modules`.
- **Putting `outDir` or `include` in a shared tsconfig.** They resolve relative to the base file (Example 6b).
- **Caching a task without `outputs`.** Turborepo's docs state that without `outputs` it caches no files, so a cache hit restores logs but no `dist` folder. Also, setting `inputs` replaces the default git-tracked file set, so forgetting a file there makes stale cache hits.
- **Forgetting the lockfile after `changeset version`.** It edits `package.json` files only; run the install command so the lockfile records the new local versions (Example 8).

## Best practices

- **Keep the root `private`.** `"private": true` on the root manifest stops anyone from publishing the whole repository by accident.
- **Pick one package manager and pin it.** Set `packageManager` in the root `package.json` and commit exactly one lockfile.
- **Make dependency declarations strict.** Use pnpm, or run a check in CI, so undeclared imports fail before they ship.
- **Put shared config in workspace packages.** `@acme/tsconfig`, `@acme/eslint-config`: each package extends or imports them, so a rule change is one commit.
- **Expose the common commands at the root.** `build`, `test`, `lint`, `typecheck` as root scripts, so CI and people type the same thing.
- **Let an orchestrator decide what to rebuild.** Declare `dependsOn` and `outputs` per task; give `inputs` only when you know the full file set.
- **Record version intent with the change.** A changeset file in the same pull request as the code; `changeset version` in a release step; commit the updated lockfile with it.

## ⭐ Interview lens

> **Q: “What does a workspace install actually do on disk?”**  
> A: It expands the workspace globs, resolves all packages' dependencies in one graph, writes one lockfile, and makes each workspace reachable by name through a symlink. npm and Yarn's `node-modules` linker hoist third-party packages to the root `node_modules`; pnpm keeps them in `node_modules/.pnpm` and symlinks only declared dependencies into each project; Yarn PnP writes `.pnp.cjs` and no `node_modules`. *Trap:* saying the local packages are copied. They are symlinked, so edits are live.

> **Q: “What is a phantom dependency and why does pnpm catch it when npm doesn't?”**  
> A: An import of a package the importing package never declared, which still works because another package's dependency was hoisted to a `node_modules` on the lookup path. npm hoists to the root, which every workspace's walk reaches. pnpm symlinks only declared dependencies into each project's `node_modules` and keeps the rest inside `.pnpm`, which the walk from the project never passes, so the `require` fails.

> **Q: “Why could `err instanceof HttpError` be false for an error that really is an HttpError?”**  
> A: Two copies of the library are installed, for example because two workspaces requested incompatible ranges, so one copy is nested. Each copy is a separate module instance with its own class. Diagnose with `npm ls <pkg>` and `require.resolve` from each package; fix by aligning ranges (or using a peer dependency); defend by checking shape (`isHttpError`, `err.status`) instead of class identity.

> **Q: “How does Turborepo know it can skip a build?”**  
> A: It hashes the task's inputs (package files, dependency versions, task config) together with the hashes of the tasks it depends on. If that hash is in the cache, it restores the declared `outputs` and replays the logs instead of running the script. Because dependency hashes are part of the key, changing a library invalidates its dependents.

> **Q: “What does `workspace:^` turn into when you publish?”**  
> A: pnpm and Yarn rewrite it to a real range based on the local package's current version: `workspace:^` with local `2.4.1` becomes `^2.4.1`, `workspace:~` becomes `~2.4.1`, and `workspace:*` becomes the exact version. Consumers outside the monorepo never see the protocol.

## Cheat-card

- **npm:** `"workspaces": [globs]`; `-w <name>` one workspace; `--workspaces` all; `--if-present` skip missing scripts; runs in glob order.
- **Layout:** npm/Yarn `node-modules` = hoisted root `node_modules` + symlinks for workspaces; pnpm = `node_modules/.pnpm` + symlinks for declared deps only; Yarn 4 default = `.pnp.cjs`, no `node_modules`.
- **`workspace:` protocol:** pnpm/Yarn only; on pack `*` → exact, `^` → `^x.y.z`, `~` → `~x.y.z`; npm: `EUNSUPPORTEDPROTOCOL`.
- **Phantom dep:** works under hoisting, fails under pnpm/PnP; declare what you import.
- **Duplicate copies:** two versions = two module instances = `instanceof` false; `npm ls <pkg>`.
- **Shared config:** `"extends": "@acme/tsconfig/base.json"`; base-file paths resolve from the base file.
- **Turborepo:** `dependsOn: ["^build"]`, `outputs`, `inputs`; hash hit = skip + restore outputs.
- **Changesets:** `init` → `.changeset/*.md` per change → `version` (bumps, ranges, CHANGELOG) → `publish`.

---

## Learn More

- [workspaces docs.npmjs.com](https://docs.npmjs.com/cli/v11/using-npm/workspaces)
- [Workspace pnpm.io](https://pnpm.io/workspaces)
- [Symlinked node_modules structure pnpm.io](https://pnpm.io/symlinked-node-modules-structure)
- [Does pnpm work across multiple drives or filesystems? pnpm.io](https://pnpm.io/faq)
- [Workspaces yarnpkg.com](https://yarnpkg.com/features/workspaces)
- [Turborepo documentation turborepo.com](https://turborepo.com/docs)
- [Cache task results nx.dev](https://nx.dev/docs/features/cache-task-results)
- [Changesets github.com](https://github.com/changesets/changesets)
- [tsconfig extends typescriptlang.org](https://www.typescriptlang.org/tsconfig/#extends)
- [Configuration files eslint.org](https://eslint.org/docs/latest/use/configure/configuration-files)
