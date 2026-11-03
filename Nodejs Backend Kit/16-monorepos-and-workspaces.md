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

## Say it in 30 seconds

A monorepo is one git repository that holds many packages, and workspaces are the package-manager feature that links those packages together on disk so one install makes each local package importable by name. It exists so a shared library can be edited and tested with the API in the same commit, instead of publishing and bumping every consumer. The trade-off is a new class of bugs: imports that work only because a dependency was hoisted, two copies of one library in one process, and builds that rerun everything unless a task runner caches them.

## Why it matters

A backend team rarely ships one package. There is an API, a worker, a shared validation library, a shared logger, and a TypeScript and lint setup they should all use. In separate repositories, a change to the shared library is a release dance: publish utils at a new version, open a pull request in the API to bump the range, wait for CI, and repeat for the worker. Bugs hide in the gap, because the API is tested against last week's utils, not the code you just wrote.

Workspaces make one install link the local packages, so the API imports the utils source on disk instead of a published copy. The same machinery creates bugs you do not see in a single package: phantom dependencies, two copies of one library so instanceof returns false, drifting versions, and CI that rebuilds everything. This lesson shows the on-disk layout each package manager actually writes.

## The concept, simply

A monorepo is one repository with many package.json files. A workspace setup has five parts.

1. The root manifest. A package.json at the top, usually with private set to true, that lists where the packages live. npm and Yarn use a workspaces array such as packages/* and apps/*. pnpm uses a pnpm-workspace.yaml file.
2. Workspace packages. Each folder those patterns match, with its own package.json, name, version, dependencies, and scripts.
3. Links. At install time the package manager makes each workspace reachable by name through a symlink in node_modules. For npm, node_modules/@acme/utils points at ../../packages/utils. Nothing is copied. Your edits are visible immediately.
4. One lockfile. The whole graph, every workspace and every third-party package, is resolved in one pass and recorded in a single package-lock.json, pnpm-lock.yaml, or yarn.lock at the root.
5. A task runner. Something that runs build or test in every package, ideally in dependency order and skipping work whose inputs have not changed. That is the package manager's own workspaces flags, or an orchestrator such as Turborepo or Nx.

Workspaces do not change how Node loads modules. Node still walks node_modules the way it always has. The package manager only arranges files and symlinks so that walk finds the right thing.

## How it works

What npm install does in a workspace root:

1. It reads the root package.json and expands the workspaces globs into a list of folders.
2. It reads each folder's package.json. Every workspace becomes a node in the dependency graph, under its name.
3. It resolves the dependencies of all workspaces together. A dependency on @acme/utils is satisfied by the local workspace when the local version matches the requested range.
4. It places third-party packages. npm hoists: it puts each package as high as possible, normally in the root node_modules, and only nests a copy inside a workspace when two workspaces need incompatible versions.
5. It creates a symlink in the root node_modules for every workspace package.
6. It writes one package-lock.json that records workspace folders as link true entries.

Why hoisting works. When apps/api/index.js calls require('ms'), Node does not know about workspaces. It looks for apps/api/node_modules/ms, then apps/node_modules/ms, then the root node_modules/ms, and so on up to the filesystem root, and it stops at the first hit. npm puts every hoisted package in the root node_modules, which sits above every workspace, so the walk from any workspace ends there. The same walk is what makes a phantom dependency possible. apps/api can require('debug') without declaring it, because @acme/utils declared it and npm hoisted it to the root, where the walk from apps/api finds it anyway.

![Diagram of the three specifier types and a node_modules lookup walking up the folder tree, missing /app/src/node_modules/express and finding /app/node_modules/express](assets/i10_01_27074a5e.svg)
*Figure: how Node resolves a bare specifier by walking `node_modules` folders up the directory tree. Look at: the lookup panel, where `/app/src/node_modules/express` misses and `/app/node_modules/express` is found. A hoisted root `node_modules` plays the role of `/app/node_modules` for every workspace.*

pnpm uses isolation instead of hoisting. It stores one copy of each package version in a content-addressable store and hard-links the files into node_modules/.pnpm/name@version/node_modules/name. Each project then gets symlinks only for the dependencies it declares. apps/api/node_modules/ms is a symlink into .pnpm, and debug is absent there if apps/api never asked for it. A package's own dependencies are siblings inside .pnpm, so debug still finds ms. Node follows the symlinks to the real path, and the walk from apps/api never passes a folder that contains an undeclared package. Undeclared imports fail.

Yarn 4, also called Berry, defaults to Plug'n'Play. With no configuration, yarn install writes no node_modules. It writes .pnp.cjs, a generated module that patches Node's resolver with a table of which packages each package may load, and where they are. Plain node index.js therefore fails. You run code through yarn node, which loads .pnp.cjs first. Setting nodeLinker to node-modules in .yarnrc.yml makes Yarn produce an npm-style hoisted tree instead.

The workspace: protocol. pnpm and Yarn let you write "@acme/utils": "workspace:*", which means this must be the local workspace, and the install should fail instead of downloading from the registry. On pnpm pack or pnpm publish the protocol is rewritten into a normal range. workspace:* becomes the exact local version, such as 1.0.0. workspace:^ becomes a caret range of that version. workspace:~ becomes a tilde range of that version. npm 11 does not support the protocol and stops with EUNSUPPORTEDPROTOCOL. In npm you write a normal range, star or caret, and npm links the local package when its version satisfies the range.

Shared configuration through extends. Put a base.json in a workspace package such as @acme/tsconfig and write extends set to @acme/tsconfig/base.json in each package's tsconfig.json. TypeScript resolves that specifier through node_modules, finds the workspace symlink, and merges the base options under the local ones. One rule bites people. Relative paths inside a base file, such as outDir, rootDir, and include, are resolved relative to the base file, not to the package that extends it. Keep those in each package's own tsconfig.json. ESLint's flat config has no extends string. A shared config is a workspace package that exports an array, and the root eslint.config.mjs imports it and spreads it.

Root scripts. The root package.json holds the commands people actually type. build can be npm run build --workspaces --if-present. start can be npm start -w @acme/api. -w, or --workspace, targets one workspace. --workspaces targets all of them. --if-present skips workspaces that lack the script. npm runs workspaces in the order the workspaces globs list them, not in dependency order. pnpm -r run build and Yarn's yarn workspaces foreach -t do sort topologically, meaning dependencies run before the packages that depend on them.

Build orchestration and caching, with Turborepo or Nx. An orchestrator replaces "run the script in every package" with a task graph plus a cache.

1. It reads the workspace list from the package manager and the task rules from its config, turbo.json. dependsOn set to ["^build"] means: before building a package, build the packages it depends on.
2. For each task it hashes the inputs: the files matched by inputs, which by default are the package's git-tracked files, the resolved dependency versions, the task configuration, and the hashes of the dependency tasks it waits on.
3. It looks that hash up in the local cache, .turbo/cache, and optionally a shared remote cache.
4. On a hit it skips the script, restores the files listed in outputs, such as dist/**, and replays the logged output.
5. On a miss it runs the script, then stores the outputs and logs under the new hash.

Because a package's hash includes its dependencies' hashes, editing @acme/utils invalidates @acme/api too, while editing only @acme/api leaves the utils entry cached. Nx implements the same idea, a project graph, cache keys from inputs, and restored outputs, with its own nx.json.

> ⚠️ Unverified: Nx was not installed or run for this lesson; its behaviour is described from the nx.dev documentation only.

Versioning and publishing with Changesets. When several packages publish to npm, someone has to pick each new version, update the ranges of local dependents, and write changelogs. Changesets turns that into files committed with the code.

1. npx changeset init creates .changeset/config.json.
2. With each change, a contributor adds a small Markdown file in .changeset/, by hand or with npx changeset. Its front matter names the packages and the bump type, major, minor, or patch, and its body is the changelog line.
3. npx changeset version reads the pending files, computes the new versions, rewrites the package.json files, bumps local dependents whose ranges no longer match, updates their ranges, writes CHANGELOG.md entries, and deletes the consumed changeset files.
4. npx changeset publish publishes every package whose version is not on the registry yet and creates git tags.

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

- Relying on hoisting. Under npm any workspace can import a package some other workspace declared. It works until the hoisted copy moves or the package is published. Declare every import in the package that uses it. pnpm or Yarn Plug'n'Play will catch the omission.
- npm run with --workspaces follows the workspaces glob order, not dependency order. Use pnpm -r, yarn workspaces foreach -t, or an orchestrator with dependsOn set to ["^build"].
- workspace:* with npm 11 fails with EUNSUPPORTEDPROTOCOL. Use a normal range with npm. Use the workspace protocol only with pnpm or Yarn, which rewrite it on pack and publish.
- Two workspaces asking for incompatible ranges of a stateful library get two copies. instanceof, Symbol-keyed registries, and module-level caches then split. Check with npm ls and align the ranges.
- node index.js in a Yarn Plug'n'Play repo fails because there is no node_modules. Use yarn node, or set nodeLinker to node-modules.
- outDir or include in a shared tsconfig resolves relative to the base file.
- A Turborepo task with no outputs caches logs but no files, so a hit restores no dist folder. Setting inputs replaces the default git-tracked set, so a forgotten file makes stale hits.
- changeset version edits package.json files only. Run install afterwards so the lockfile records the new local versions.

## Best practices

- Keep the root private, so nobody publishes the whole repository by accident.
- Pick one package manager, set the packageManager field, and commit exactly one lockfile.
- Make dependency declarations strict. Use pnpm, or a CI check, so undeclared imports fail before they ship.
- Put shared config in workspace packages such as @acme/tsconfig and @acme/eslint-config.
- Expose build, test, lint, and typecheck as root scripts so CI and people type the same commands.
- Let an orchestrator decide what to rebuild. Declare dependsOn and outputs. Set inputs only when you know the full file set.
- Record version intent in the same pull request, run changeset version in a release step, and commit the updated lockfile with it.

## ⭐ Interview lens

> **Q: “What does a workspace install actually do on disk?”**  
> A workspace install reads the root globs, reads every workspace package.json, and resolves all of those dependencies as one graph. It writes one lockfile, and it makes each workspace importable by name through a symlink, not a copy, so edits are live. npm, and Yarn with the node-modules linker, hoist third-party packages into the root node_modules. pnpm puts the real files in node_modules/.pnpm and symlinks only declared dependencies into each project. Yarn Plug'n'Play writes .pnp.cjs and no node_modules at all, so you run through yarn node. For example, after an npm install, require('@acme/utils') resolves to packages/utils on disk. The limit is that Node itself does not understand workspaces. It only walks node_modules. The package manager has to lay the files out so that walk succeeds.

> **Q: “What is a phantom dependency and why does pnpm catch it when npm doesn't?”**  
> A phantom dependency is an import of a package the importing package never declared, which still works because some other package's dependency was hoisted onto the node_modules walk. npm hoists to the root node_modules, and every workspace's walk reaches that root, so apps/api can require('debug') just because @acme/utils depends on it. pnpm symlinks only what each project declares. The rest stays inside .pnpm, which the walk from the project never passes, so the require fails. Yarn Plug'n'Play fails too, because its table has no debug entry for that package. The fix is to declare debug in the package that imports it. The limit of "pnpm catches it" is local: once you publish and install elsewhere, the bug shows up under npm too, but only after the undeclared import leaves the monorepo.

> **Q: “Why could `err instanceof HttpError` be false for an error that really is an HttpError?”**  
> Two copies of the library are installed, so there are two module instances and two different HttpError classes. That happens when two workspaces request incompatible ranges and the package manager cannot hoist both to one place, so one copy is nested. An error built by one copy fails instanceof against the other copy's class, and an Express handler can turn a 404 into a 500. Diagnose with npm ls and with require.resolve from each package. Fix it by aligning the ranges, or by using a peer dependency. Defend by checking shape, such as isHttpError or err.status, instead of class identity. The same split hits duplicate React copies and any module-level singleton, such as a pool or a cache, that then exists twice.

> **Q: “How does Turborepo know it can skip a build?”**  
> Turborepo hashes the task's inputs together with the hashes of the tasks it depends on. Inputs are the package files, by default the git-tracked ones, the resolved dependency versions, and the task config. If that hash is already in the cache, it skips the script, restores the files listed in outputs, and replays the logs. dependsOn set to ["^build"] means dependencies are built first, and their hashes are part of this key, so editing a library invalidates its dependents while editing only the app leaves the library cached. For example, deleting dist and running again restores the files from .turbo/cache without rerunning the compiler. The limit is the outputs field. With no outputs, a hit restores logs and no dist folder, so the cache looks successful and the build artifacts are missing.

## Cheat-card

- npm: a workspaces array of globs. -w names one workspace. --workspaces runs all. --if-present skips a missing script. npm uses glob order, not dependency order.
- Layout: npm and Yarn node-modules hoist to the root and symlink workspaces. pnpm uses node_modules/.pnpm and symlinks only declared deps. Yarn 4 defaults to .pnp.cjs and no node_modules.
- workspace: is pnpm and Yarn. On publish, star becomes the exact version, caret becomes a caret range, tilde becomes a tilde range. npm 11 rejects it with EUNSUPPORTEDPROTOCOL.
- A phantom dependency works under hoisting and fails under pnpm and Plug'n'Play. Declare what you import.
- Two versions means two module instances, so instanceof is false. Check with npm ls.
- Shared tsconfig extends a workspace package. Paths inside the base file resolve from the base file.
- Turborepo: dependsOn ["^build"], outputs, and a hash. A hit skips the script and restores outputs.
- Changesets: init, one markdown file per change, version to bump and write changelogs, then publish.

## Good to know

- “What does `workspace:^` turn into when you publish?” pnpm and Yarn rewrite it from the local package's current version. workspace:^ with local 2.4.1 becomes ^2.4.1, workspace:~ becomes ~2.4.1, and workspace:* becomes the exact version. Consumers outside the monorepo never see the protocol.

- Example 7 in this lesson was run with Turborepo 2.11.7.

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
