---
title: "npm & Scripts"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/npm-and-scripts
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# npm & Scripts

*9 min read · Updated 24 Jul 2026 Topic 15 of 70 Bookmark Mark done Why it matters npm is the package manager that ships with Node and the front door to the largest software registry in the world · Topic 15 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/npm-and-scripts](https://www.geekyfrontend.in/learn/nodejs-backend-kit/npm-and-scripts)

---

## Say it in 30 seconds

An npm script is a named shell command stored under `scripts` in `package.json`. `npm run` starts that command with your project's `node_modules/.bin` at the front of `PATH`, so a tool installed in the project, such as `tsc`, runs without a global install. For any script name, npm also runs `pre` and `post` scripts around it if you defined them.

Scripts exist so `npm test` and `npm run build` mean the same thing on every laptop and in CI. The trade-off is that install runs scripts too. A `postinstall` in a dependency executes on your machine when you install it, which is a supply-chain risk. `npx` is the one-shot version: it runs a package's binary, from the local install if you have one, otherwise from a temporary download.

`PATH` is the list of directories the shell searches for a command. `.bin` is the folder of executables your dependencies declared.

## Why it matters

npm is the package manager that ships with Node, and the scripts in `package.json` are the shared vocabulary of a project. `npm run dev`, `npm test`, and `npm run build` should not depend on what a developer installed globally. The same mechanism is a security surface. Installing a package runs its lifecycle scripts. Publishing sends your code, and your credentials, to a registry. Knowing when a script fires is part of running a Node project safely.

## The concept, simply

**npm scripts** are named commands under `"scripts"`. You run them with `npm run <name>`. A few names, `start`, `test`, `stop`, and `restart`, can drop the `run`. When a script runs, npm puts `node_modules/.bin` on `PATH`, so `tsc` and `eslint` resolve to the copies this project installed.

**`npx`** runs a package binary without adding it as a permanent dependency. **yarn** and **pnpm** read the same `package.json` and store the files differently. **`npm audit`** checks the installed tree against a vulnerability database.

![Diagram showing prebuild, build and postbuild scripts running in order, plus reserved lifecycle names like postinstall](assets/i12_01_90755c45.svg)

npm runs `pre` and `post` hooks around a script on its own. Reserved names such as `postinstall` fire during install, which is the supply-chain case.

## How it works

**Hooks.** For a script `x`, npm runs `prex` before it and `postx` after it, if those names exist. `prebuild`, `build`, and `postbuild` all run from `npm run build`. That is how a project cleans a folder, compiles, and copies assets without a task runner.

Some names are reserved and fire at a lifecycle moment. `preinstall`, `install`, and `postinstall` run during `npm install`. `prepare` runs on a local install and before publishing, which is the usual place to build or to install git hooks. `prepublishOnly` runs only before `npm publish`.

**Why `postinstall` is a security concern.** It runs automatically for every dependency, on your laptop and in CI. A malicious package can run arbitrary code at install time. Review what you add, install from the lockfile, and use `npm ci --ignore-scripts` where install-time code is unacceptable.

**Arguments and chaining.** `npm run test -- --watch` forwards `--watch` to the test runner. The `--` is required, because flags before it belong to npm. Call another script with `npm run other`, or chain with `&&`. For parallel scripts use `npm-run-all` or `concurrently`. A raw `&` is not portable to Windows.

**Local binaries.** `node_modules/.bin` holds executables created from each package's `bin` field. `"build": "tsc"` works because `tsc` resolves to the TypeScript this project pinned, not to whatever is installed globally.

**`npx`.** `npx foo` looks in the local `.bin` first. If it is missing, npx downloads the package to a temporary cache, runs it, and discards it. `npx create-next-app` is the usual example. Pin a version with `npx pkg@1.2.3`.

**Publishing, short version.** `npm version patch`, `minor`, or `major` bumps `package.json` and creates a git tag. `npm login` authenticates. The `files` field, or `.npmignore`, limits the tarball. `npm pack --dry-run` previews it. `npm publish` uploads it, with `--access public` for a scoped public package. `prepublishOnly` or `prepare` usually runs the build first. `npm audit` reports known vulnerabilities by severity. `npm audit fix` upgrades inside your ranges. `--force` allows breaking upgrades, so read the diff. An advisory is not proof that your code path is exploitable.

## Code examples

**1. Scripts with pre/post hooks and local binaries.**

json

```
{
  "scripts": {
    "clean": "rimraf dist",
    "prebuild": "npm run clean",
    "build": "tsc -p tsconfig.json",
    "postbuild": "cp -r public dist/public",
    "dev": "node --watch src/index.js",
    "test": "node --test",
    "lint": "eslint ."
  }
}
```


**2. Running scripts and forwarding args.**

javascript

```
// npm run build        -> runs prebuild, build, postbuild in order
// npm test             -> shorthand for `npm run test`
// npm run test -- --watch   // forwards --watch to node --test
// npm run lint -- --fix     // forwards --fix to eslint
```


**3. npx for one-off tools.**

javascript

```
// Scaffold a project without a global install:
//   npx create-vite@latest my-app
// Run a specific version once:
//   npx prettier@3.3.3 --check "src/**/*.js"
// Uses local node_modules/.bin if the tool is already installed.
```


**4. Publish flow and audit.**

javascript

```
// One-time: npm login
// Bump version (also creates a git tag):
//   npm version patch        // 1.4.0 -> 1.4.1
// Preview exactly what will be published:
//   npm pack --dry-run
// Publish (scoped public package):
//   npm publish --access public
// Security pass:
//   npm audit                 // report
//   npm audit fix             // safe upgrades within ranges
```


## Common mistakes & gotchas

- **Forgetting `--`.** `npm run test --watch` gives `--watch` to npm. Write `npm run test -- --watch`.
- **Global installs of project tools.** Versions drift between machines. Install locally and call the tool from a script or from `npx`.
- **Mixing package managers.** `yarn` and then `npm install` produces two lockfiles. Pick one client per repo.
- **Ignoring `postinstall`.** An untrusted dependency runs code at install time. Audit dependencies, and consider `--ignore-scripts` for a sensitive CI install.
- **`&` for parallel scripts.** It is not portable to Windows. Use `npm-run-all -p` or `concurrently`.
- **Publishing more than you meant.** Without `files` you can ship tests or secrets. Preview with `npm pack --dry-run`.
- **A scoped package without `--access public`.** The publish fails, or it publishes as private when you did not mean to.
- **Treating every audit finding as critical.** Check whether the advisory reaches your code. Do not run `audit fix --force` blindly. It can jump a major.

## Best practices

- Standardise on `dev`, `build`, `test`, `lint`, and `start`.
- Install tools locally and invoke them through scripts or `npx`.
- Use `pre` and `post` hooks instead of a task runner when the sequence is just setup and teardown.
- One package manager per repo, and commit only its lockfile.
- Run `npm audit` in CI. Keep the dependency list short.
- Before you publish: `npm version`, build in `prepublishOnly` or `prepare`, set `files`, and dry-run with `npm pack`.
- In CI and Docker, `npm ci`. Add `--ignore-scripts` where install-time execution is the risk you care about.

## ⭐ Interview lens

> **Q: How do npm script lifecycle hooks work?**
> For any script `x`, npm looks for `prex` and `postx` and runs them around `x` if they exist. You do not call them yourself. `npm run build` runs `prebuild`, then `build`, then `postbuild`, which is how a project can clean, compile, and copy assets with one command. Separate from those prefixes, a few names are reserved lifecycle scripts. `preinstall`, `install`, and `postinstall` run during `npm install`. `prepare` runs on a local install and before publish. `prepublishOnly` runs only before `npm publish`. The limit is that `postinstall` is not just your hook. Every dependency's `postinstall` runs too, on your machine, which is why `--ignore-scripts` exists.

> **Q: Difference between `npm install pkg` and `npx pkg`?**
> `npm install pkg` puts the package in `node_modules`, records it in `package.json`, and leaves it there for every later run. `npx pkg` only executes the package's binary. It uses the local copy if you already have one. Otherwise it downloads into a temporary cache, runs the command, and discards it. `npx create-vite` is the usual case: a scaffolder you want once, not as a dependency. You can pin it with `npx pkg@1.2.3`. The limit of npx for a tool you run every day is that you want that version locked in the project. Install it and call it from a script.

> **Q: How does `npm run build` find `tsc` without a global install?**
> When npm runs a script, it prepends this project's `node_modules/.bin` to `PATH`. That folder contains the executables installed packages declared in their `bin` field, so the shell finds `./node_modules/.bin/tsc` before any global `tsc`. The version is the one in your lockfile, which is why two developers get the same TypeScript. The limit is a command you type yourself in the terminal. Your interactive shell does not get that `PATH` change. Only the script's process does, unless you call the binary through `npx` or `npm exec`.

> **Q: Why are `postinstall` scripts a security risk?**
> `postinstall` runs automatically as part of `npm install`, for your package and for every dependency. A compromised or malicious package can execute arbitrary code on a laptop or in CI at install time. That is a supply-chain attack, and it does not need anyone to run the program afterward. Reduce it by reviewing dependencies, installing from a committed lockfile so a new release cannot appear silently, and using `npm ci --ignore-scripts` in environments where install-time code is unacceptable. The limit of `--ignore-scripts` is that some packages need their script to build a native addon. Turning scripts off can leave the install incomplete, so you use it where the risk matters, not as a blanket default you never check.

## Cheat-card

- `npm run x`. `start`, `test`, `stop`, and `restart` can skip `run`.
- Hooks: `prex`, then `x`, then `postx`. Reserved: `postinstall`, `prepare`, `prepublishOnly`.
- Forward flags with `npm run x -- --flag`.
- npm puts `node_modules/.bin` on `PATH` for the script.
- `npx` runs a binary once: local first, otherwise a temp download.
- Publish: `npm version`, then a `files` allowlist, then `npm pack --dry-run`, then `npm publish`, with `--access public` for a public scoped package.
- `npm audit` reports advisories. `audit fix` stays inside ranges. `--force` can jump majors.
- `npm ci` for CI. Add `--ignore-scripts` when install-time code is the threat.

## Good to know

- Q: npm vs yarn vs pnpm — what actually differs? They share `package.json` and differ in storage and lockfiles. npm flattens `node_modules` and writes `package-lock.json`. pnpm keeps one copy of each version in a global content-addressable store and symlinks it in, which saves disk and blocks phantom dependencies, packages you import without declaring. Yarn added fast installs and workspaces, and modern Yarn can use Plug'n'Play, which has no `node_modules`. Do not mix clients in one repo.
- Q: Walk through publishing a package safely. `npm login`, then `npm version` with `patch`, `minor`, or `major`, which updates the version and makes a git tag. Limit the tarball with `files`. Build in `prepublishOnly` or `prepare`. Preview with `npm pack --dry-run`. Publish with `npm publish`, plus `--access public` for a scoped public package. Run `npm audit` first.
- `cross-env` 10.1.0 is an ES module package that needs Node 20 or newer. `node --env-file` was added in v20.6.0 and is no longer experimental since v24.10.0. `--env-file-if-exists` was added in v22.9.0. A variable already in the environment wins over the file.
- Provenance needs npm 9.5.0 or later and a public `repository` field that matches the publishing repo. Trusted publishing needs npm 11.5.1 or later and Node 22.14.0 or later, and it generates provenance without the `--provenance` flag. npm 11.17.0 also ships `npm trust`.

---

## Learn More

- [scripts docs.npmjs.com](https://docs.npmjs.com/cli/v10/using-npm/scripts)
- [An introduction to the npm package manager nodejs.org](https://nodejs.org/en/learn/getting-started/an-introduction-to-the-npm-package-manager)
- [npm run-script docs.npmjs.com](https://docs.npmjs.com/cli/v10/commands/npm-run-script)
- [NPM Scripts | Define Custom Scripts in package.json Rapid Tutor](https://www.youtube.com/watch?v=4oz0rqoB6VM)
- [Node.js Crash Course Traversy Media](https://www.youtube.com/watch?v=fBNz5xF-Kx4)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### Scripts in workspaces and monorepos

In a repo with a `workspaces` field, `-w <name>` or `--workspace` runs a command in one workspace, `--workspaces` runs it in all of them, and `--if-present` skips workspaces that do not define the script. A root script can drive many packages without `cd packages/x && npm run build`. Layouts, pnpm and Yarn, caching, and publishing are in lesson 16.

1. npm reads the root `workspaces` globs and maps each folder to its package `name`.
2. `-w <name>` runs that workspace's script with the workspace folder as the working directory, and puts every `node_modules/.bin` from the workspace up to the repo root on `PATH`.
3. `--workspaces` repeats that for every workspace, in glob order, which is not dependency order.
4. `npm exec -w <name> -- <cmd>` runs an arbitrary command in that workspace the same way.

**Example. One workspace, from the repository root.** This is the Example 1 repository from lesson 16.

bash

```
$ npm run build -w @acme/utils

> @acme/utils@1.0.0 build
> node -e "console.log('build utils')"

build utils
$ npm exec -w @acme/api -- node -p "require('./package.json').name + ' in ' + process.cwd().split('/').slice(-2).join('/')"
@acme/api in apps/api
```


### `npm link`

`npm link` connects a package you are developing to an app, through two symlinks, so you can test without publishing. Inside the package, `npm link` symlinks it into npm's global `lib/node_modules` and links its `bin` entries. Inside the app, `npm link <name>` points `node_modules/<name>` at the package folder. The example sets `npm_config_prefix` to a throwaway folder so the real global install is never touched.

1. In `greet-cli/`, `npm link` creates `<prefix>/lib/node_modules/greet-cli` pointing at the package, and `<prefix>/bin/greet` pointing at `bin/greet.js`.
2. In `app/`, `npm link greet-cli` creates `app/node_modules/greet-cli` as a symlink straight to the source folder.
3. Node follows the symlink to the real path, so `require('greet-cli')` loads the files you are editing. Edits show up with no reinstall.
4. The link is not written to `app/package.json` unless you pass `--save`, so npm treats it as extraneous.
5. `npm unlink -g` inside the package removes the global entries.

**Example. Link a CLI into a project, inside a throwaway prefix.**

json

```
{
  "name": "greet-cli",
  "version": "0.1.0",
  "bin": { "greet": "bin/greet.js" },
  "main": "index.js"
}
```


javascript

```
module.exports = (name) => `hello, ${name} (from ${__dirname})`;
```


javascript

```
#!/usr/bin/env node
console.log(require('../index.js')(process.argv[2] ?? 'world'));
```


bash

```
$ npm config get prefix
…/link/prefix
$ npm link >/dev/null && ls -l ../prefix/lib/node_modules ../prefix/bin | sed 's/^.* \([^ ]* -> \)/\1/'
../prefix/bin:
total 0
greet -> ../lib/node_modules/greet-cli/bin/greet.js

../prefix/lib/node_modules:
total 0
greet-cli -> ../../../greet-cli
$ ../prefix/bin/greet Ada
hello, Ada (from …/link/greet-cli)
$ npm link greet-cli >/dev/null && readlink node_modules/greet-cli && npm ls
../../greet-cli
app@1.0.0 …/link/app
└── greet-cli@0.1.0 extraneous -> ./../greet-cli
$ node -p "require('greet-cli')('app')"
hello, app (from …/link/greet-cli)
```

The `__dirname` in the output shows the app is running the linked source, not a copy. The commands used `npm_config_prefix` pointed at the throwaway directory. The `sed` in the fence only drops the permission and date columns from `ls -l`.

### cross-env and portable environment variables

`cross-env` is a small CLI, `cross-env NAME=value command …`, that sets variables and then spawns the command. npm runs scripts through the system shell, `sh` on Linux and macOS and `cmd.exe` on Windows, and only a POSIX shell understands the `NAME=value command` prefix. `"start": "NODE_ENV=production node app.js"` fails on a Windows shell. Two dependency-free alternatives: `node --env-file=<file>`, where a variable already set in the environment wins over the file, and a small Node script that sets `process.env` before importing the app. The version dates are in Good to know.

1. npm hands the script string to the shell.
2. The shell runs `cross-env`, which parses the leading `NAME=value` arguments.
3. cross-env copies `process.env`, adds those variables, and spawns the rest of the command with that environment.
4. cross-env exits with the child's exit code.

**Example. Three ways to set `NODE_ENV`.**

json

```
{
  "name": "xenv",
  "private": true,
  "scripts": {
    "start:posix": "NODE_ENV=production node show-env.js",
    "start:cross": "cross-env NODE_ENV=production node show-env.js",
    "start:envfile": "node --env-file=.env.production show-env.js"
  },
  "devDependencies": { "cross-env": "^10.1.0" }
}
```


javascript

```
console.log(`NODE_ENV=${process.env.NODE_ENV} PORT=${process.env.PORT ?? '(unset)'}`);
```


bash

```
$ cat .env.production
NODE_ENV=production
PORT=4600
$ npm run start:posix

> start:posix
> NODE_ENV=production node show-env.js

NODE_ENV=production PORT=(unset)
$ npm run start:cross

> start:cross
> cross-env NODE_ENV=production node show-env.js

NODE_ENV=production PORT=(unset)
$ npm run start:envfile

> start:envfile
> node --env-file=.env.production show-env.js

NODE_ENV=production PORT=4600
$ NODE_ENV=staging npm run start:envfile

> start:envfile
> node --env-file=.env.production show-env.js

NODE_ENV=staging PORT=4600
$ npm ls cross-env | tail -n +2 && npm view cross-env@10.1.0 engines type
└── cross-env@10.1.0

engines = { node: '>=20' }
type = 'module'
```

All three give `NODE_ENV=production` on Linux. Only the `--env-file` run also loads `PORT` from the file. The run with `NODE_ENV=staging` already exported shows the environment winning over the file.

> ⚠️ Unverified: the failure of `start:posix` and the success of `start:cross` on Windows `cmd.exe` were not reproduced; no Windows machine was available. The cmd.exe behaviour is taken from the cross-env README.

### Provenance and trusted publishing

A provenance statement is a signed attestation attached to a published version. It records which repository, commit, and CI workflow built the package. It is signed through Sigstore and written to a public transparency log. `npm audit signatures` checks it. Trusted publishing removes the long-lived npm token. You register one CI workflow, GitHub Actions, GitLab CI/CD, or CircleCI, on cloud-hosted runners only, and the npm CLI exchanges that job's short-lived OIDC token for publish rights. A consumer otherwise cannot tell whether a tarball came from the repository it names. The version requirements are in Good to know.

1. The workflow has `permissions: id-token: write` and runs on a GitHub-hosted runner.
2. During `npm publish --provenance`, or a trusted-publishing `npm publish`, npm detects the CI provider and requests an OIDC token.
3. For trusted publishing, npm sends that token to the registry. The registry checks it against the trusted publisher (organisation, repository, workflow filename, optional environment) and returns a short-lived token for this publish.
4. For provenance, npm uses the identity token to get a signing certificate from Sigstore, signs a statement about the build, and uploads it with the tarball. The registry records it in the transparency log.
5. Outside a supported CI provider there is no identity token, so a provenance publish fails before upload.

The parts that can run locally:

bash

```
$ npm publish --help | grep -o '\[--provenance|--provenance-file <file>\]'
[--provenance|--provenance-file <file>]
$ npm publish --provenance --access public --dry-run 2>&1 | grep -v 'npm notice [0-9a-z]'
npm notice
npm notice 📦  @acme-demo/prov-check@0.0.1
npm notice Tarball Contents
npm notice Tarball Details
npm notice
npm warn publish This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
+ @acme-demo/prov-check@0.0.1
$ npm publish --provenance --access public --registry http://127.0.0.1:4601/ --//127.0.0.1:4601/:_authToken=fake-token 2>&1 | grep -v 'npm notice'
npm error code EUSAGE
npm error Automatic provenance generation not supported for provider: null
npm error A complete log of this run can be found in: …/_logs/….log
$ cat registry.log
[registry] GET /@acme-demo%2fprov-check
[registry] GET /@acme-demo%2fprov-check
$ npm trust --help | head -8
Create a trusted relationship between a package and a OIDC provider

Usage:
npm trust github [package] --file [--repo|--repository] [--env|--environment] [--allow-publish] [--allow-stage-publish] [-y|--yes]
npm trust gitlab [package] --file [--project|--repo|--repository] [--env|--environment] [--allow-publish] [--allow-stage-publish] [-y|--yes]
npm trust circleci [package] --org-id <uuid> --project-id <uuid> --pipeline-definition-id <uuid> --vcs-origin <origin> [--context-id <uuid>...] [--allow-publish] [--allow-stage-publish] [-y|--yes]
npm trust list [package]
npm trust revoke [package] --id=<trust-id>
```

The dry run accepted `--provenance` and did not exercise it. The real publish, sent to the same local stand-in registry as lesson 14, failed with `EUSAGE` because no CI provider was detected. Only two `GET` requests reached the registry. Nothing was uploaded.

A publish workflow following the docs.npmjs.com trusted-publishing example:

text

```
name: Publish Package
on:
  push:
    tags:
      - 'v*'
permissions:
  id-token: write   # Required for OIDC
  contents: read
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
          package-manager-cache: false
      - run: npm ci
      - run: npm run build --if-present
      - run: npm test
      - run: npm publish
```


> ⚠️ Unverified: the workflow above, the OIDC token exchange, the provenance signing and `npm audit signatures` output were not run; they need a GitHub Actions or GitLab CI/CD runner, a trusted-publisher configuration on npmjs.com and a real package to publish. Steps 2 to 4 are summarised from docs.npmjs.com ("Generating provenance statements" and "Trusted publishing for npm packages"), not observed.

### Common mistakes & gotchas (additional topics)

- **`npm link` against the real global prefix.** It writes into the global `lib/node_modules` and `bin`. Set `npm_config_prefix` to a scratch folder, and run `npm unlink -g` afterward.
- **A link is extraneous.** Without `--save` it is not in `package.json`, and installing another package removes it. The edge case below is that removal.
- **Linking a package that has peer dependencies.** The linked package resolves imports from its real folder, so its own `node_modules` can load a second copy of a framework. Prefer workspaces for packages you develop together.
- **`NAME=value cmd` in a script that must run on Windows.** Use cross-env, `node --env-file`, or a Node script.
- **Expecting `--env-file` to override the environment.** Values already set win over the file.
- **Expecting `npm publish --provenance --dry-run` to test provenance.** It does not. Provenance runs on a real publish from a supported CI runner.

### Edge case worked through: installing another package silently removes a link

Continuing in the same `app/` with the same throwaway prefix:

bash

```
$ npm install >/dev/null && ls node_modules
greet-cli
$ npm install ms@2.1.3 >/dev/null && ls node_modules && npm ls
ms
app@1.0.0 …/link/app
└── ms@2.1.3
$ npm link greet-cli --save >/dev/null && npm pkg get dependencies && npm ls
{
  "greet-cli": "file:../greet-cli",
  "ms": "^2.1.3"
}
app@1.0.0 …/link/app
├── greet-cli@0.1.0 -> ./../greet-cli
└── ms@2.1.3
$ npm unlink -g >/dev/null; ls ../prefix/lib/node_modules ../prefix/bin
../prefix/bin:

../prefix/lib/node_modules:
```

A plain `npm install` kept the extraneous link. `npm install ms@2.1.3` rebuilt the tree from `package.json`, where `greet-cli` was not listed, and removed `node_modules/greet-cli`. `npm link greet-cli --save` records `"file:../greet-cli"`, so later installs keep it. Restore the real range before you commit. `npm unlink -g` then emptied the throwaway global folders.

### ⭐ Interview lens (additional topics)

> **Q: “How do you test a local library inside an app without publishing it?”**  
> In a monorepo, make both packages workspaces and depend on the library by name. The install symlinks it. Across repositories, run `npm link` in the library, which creates a global symlink and its `bin`, then `npm link <name>` in the app, which points `node_modules/<name>` at the library folder. Node follows the symlink, so edits are live. The trap is that the link is extraneous unless you pass `--save`, and the next `npm install <pkg>` removes it. For a trial, set `npm_config_prefix` to a scratch folder so the global link is not your real prefix.

> **Q: “What is npm provenance, and what does trusted publishing add?”**  
> Provenance is a Sigstore-signed statement attached to the published version. It links that tarball to the repository, commit, and CI workflow that built it, records the statement in a public transparency log, and `npm audit signatures` checks it. Trusted publishing replaces a long-lived npm token. npm exchanges the CI job's short-lived OIDC token for publish rights, only for the workflow registered on npmjs.com, and provenance is generated automatically. Both need a supported cloud CI runner. A local `npm publish --provenance` fails with `EUSAGE` before upload. The steps that need a real CI runner and a real publish were not run here.
