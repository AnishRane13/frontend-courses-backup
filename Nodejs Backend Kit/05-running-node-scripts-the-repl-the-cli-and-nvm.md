---
title: "Running Node: Scripts, the REPL, the CLI, and nvm"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/running-node-repl
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Running Node: Scripts, the REPL, the CLI, and nvm

*10 min read · Updated 24 Jul 2026 Topic 5 of 70 Bookmark Mark done Why it matters Knowing the concepts is one thing · Topic 5 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/running-node-repl](https://www.geekyfrontend.in/learn/nodejs-backend-kit/running-node-repl)

---

## Say it in 30 seconds

You run JavaScript with Node in three ways. `node app.js` runs a file. `node` with no file opens the REPL, a prompt that reads a line, evaluates it, and prints the result. `node -e` runs a snippet you pass as a string. nvm, the Node Version Manager, installs several Node versions side by side and points the current shell at the one a project asks for.

The file stays running only while asynchronous work is still pending, which is why a server stays up and a plain script exits. The trade-off of nvm is that global CLIs belong to one version. Switch versions and that command can disappear until you install it again.

REPL stands for read, eval, print, loop. LTS means long-term support, the even-numbered majors you run in production.

## Why it matters

Day to day you need more than `node app.js`. The REPL answers "what does this return?" without a file. `node -e` and `node -p` drop a check into a shell script. nvm keeps an old project on one major and a new one on another. Interviews ask how you check the version, how you try a snippet, and how you run two versions on one machine.

## The concept, simply

**1. A file.** `node app.js` runs the script from top to bottom. This is how servers and real programs start.

**2. The REPL.** `node` with no file opens an interactive prompt. You type an expression, press Enter, and Node prints the result.

**3. Inline.** `node -e "code"` runs a string from the command line. `node -p` runs it and prints the result.

![Three panels showing node app.js to run a file, node for the interactive REPL, and node -e for inline evaluation](assets/i02_01_d8b026e1.svg)

Which version you run is a separate question. nvm installs several versions and switches per project, so a project on Node 18 and a project on Node 22 can share one machine.

## How it works

**A file.** `node path/to/file.js` starts a process, loads the file, and runs it. The process stays alive while asynchronous work is pending: an open server, a timer, a pending promise. A script with nothing pending exits when the last line finishes. `server.listen()` is why a web server stays up. Arguments after the filename are `process.argv`.

**The REPL.** Start it with `node`.

- `_` is the last value, like a calculator's answer memory.
- Tab completes. `process.` then Tab lists properties.
- An unfinished statement, an open brace or bracket, shows a `...` continuation prompt.
- Commands that start with a dot: `.help`, `.exit` or Ctrl-D to quit, `.clear` to reset, `.load file.js`, `.save file.js`.
- Core modules load lazily. You can type `os.platform()` without requiring `os`.

| Command | What it does |
| --- | --- |
| `node app.js` | Run a file |
| `node` | Open the REPL |
| `node -e "expr"` | Run a snippet |
| `node -p "expr"` | Run it and print the result |
| `node -v` | Print the version |
| `node --watch app.js` | Re-run when files change |
| `node --env-file=.env app.js` | Load environment variables from a file |
| `node --check app.js` | Check syntax, do not run |
| `node --inspect app.js` | Open the debugger for Chrome DevTools |

`--watch` and `--env-file` cover the simple cases people used to add nodemon and dotenv for. The versions those flags arrived in are in Good to know.

**nvm.** On macOS and Linux, nvm is the usual manager. Windows uses nvm-windows, or fnm or Volta. Lesson 3 compares them.

| Command | Meaning |
| --- | --- |
| `nvm install 22` | Install the latest Node 22 |
| `nvm install --lts` | Install the latest LTS |
| `nvm use 20` | Switch this shell to Node 20 |
| `nvm ls` | List what is installed |
| `nvm alias default 22` | Default for new shells |

![Diagram showing nvm at the top feeding three projects each pinned to a different Node version: 20, 22, and 18](assets/i02_02_ba74adeb.svg)

Put `22` in `.nvmrc` and `nvm use` reads it, so the team runs the same major. Even-numbered majors become LTS and get security patches. Odd majors are short-lived. Prefer LTS for anything real. The phase lengths are in lesson 1.

## Code examples

**Example 1. A REPL session.** Everything after `>` is what you type.

javascript

```
$ node
Welcome to Node.js v22.11.0.
> 2 + 2
4
> _ * 10          // _ is the last result
40
> const os = require('node:os');
undefined
> os.platform()
'darwin'
> [1, 2, 3].map(n => n * n)
[ 1, 4, 9 ]
> .exit           // or press Ctrl-D
```


**Example 2. Inline evaluation.**

javascript

```
# -e runs code; -p runs AND prints the result:
$ node -p "process.version"
v22.11.0

$ node -p "Math.max(3, 7, 2)"
7

# Useful inside shell scripts / CI:
$ node -e "console.log('Build at', new Date().toISOString())"
```


**Example 3. A file, with the built-in dev flags.**

javascript

```
// server.js
const http = require('node:http');
const port = Number(process.env.PORT) || 3000;

http.createServer((req, res) => res.end('ok'))
  .listen(port, () => console.log('listening on ' + port));

// Auto-restart on save + load env from a file — no extra packages:
//   node --watch --env-file=.env server.js
// The process stays alive because server.listen keeps the loop busy.
```


**Example 4. Check and switch versions.**

javascript

```
# Which Node am I running?
$ node -v
v22.11.0

# Install and pin the LTS for a project:
$ nvm install --lts
$ echo "22" > .nvmrc
$ nvm use
Now using node v22.11.0 (npm v10.x)
```


## Common mistakes & gotchas

- **Expecting a plain script to stay running.** Node exits when nothing asynchronous is pending. A server or an interval is what holds the loop open.
- **Mixing up `-e` and `-p`.** `-e` prints nothing unless you `console.log`. `-p` prints the result.
- **Treating the REPL as the program.** Its variables vanish when you exit. `const x = 5` prints `undefined`, because that is the statement's value.
- **No pin file.** Teammates run different majors and hit "works on my machine." Commit `.nvmrc`, and say the same thing in `engines`.
- **Globals installed under the wrong version.** With nvm, global packages belong to one version. Switch, and the CLI looks gone.
- **An odd major in production.** 19, 21, and 23 do not get long-term support. Use an even LTS major.
- **Adding nodemon when `--watch` is enough.** For a simple restart-on-save loop, the built-in flag is the whole tool.

## Best practices

- When you do not know what a method returns, type it in the REPL before you write a file.
- Pin the version with `.nvmrc` and `engines`, including CI.
- Run production on LTS. Upgrade when that line is approaching end of life.
- Prefer built-in flags before new dependencies: `--watch`, `--env-file`, `--inspect`.
- Put the exact command in a `package.json` script so nobody retypes the flags.
- Leave the REPL with `.exit` or Ctrl-D. Ctrl-C twice also works.

## ⭐ Interview lens

> **Q: “What is the Node REPL and when would you use it?”**  
> REPL means read, eval, print, loop. You start it with `node` and no file. Each line is evaluated and the result is printed. `_` holds the last value. Use it to try a snippet, check what an API returns, or do a one-off calculation without creating a file. Dot commands such as `.exit` and `.load` manage the session. The limit is that nothing persists. Close the prompt and the variables are gone, and a `const` statement prints `undefined` because the statement itself has no value.

> **Q: “How do you run a one-off JavaScript snippet without a file?”**  
> `node -e "code"` runs the string. `node -p "code"` runs it and prints the result, which is what you want in a shell script or a CI check. `-e` stays quiet unless the code calls `console.log`. The limit is anything that needs a module graph or a long program. Past a line or two, a file is easier to read, and `-e` still starts a real process with the same event loop as `node app.js`.

> **Q: “How do you run different Node versions on the same machine?”**  
> Use a version manager. nvm installs versions with `nvm install`, switches the current shell with `nvm use`, and reads a one-line `.nvmrc` so the project picks the version. fnm and Volta do the same job with different pin files. Lesson 3 is the mechanical difference. The limit is reinstalling Node from the operating system each time. That replaces the one binary on `PATH`. A manager keeps the versions side by side under your home directory.

> **Q: “Why does a Node web server keep running while a plain script exits?”**  
> Node exits when the event loop has no more work. `server.listen()` holds a ref'd handle, a listening socket, so the loop stays alive. A script that only computes and prints finishes its last line with nothing pending, and the process ends. The limit is a timer you forgot. `setInterval` also keeps the process alive. `unref()` on that timer lets the process exit when the server is the only thing you meant to keep.

## Cheat-card

- Run a file: `node app.js`. It stays up while async work is pending.
- REPL: `node`. `_` is the last result. `.exit` or Ctrl-D quits.
- Inline: `node -e` runs. `node -p` runs and prints.
- Version: `node -v`. Dev flags: `--watch`, `--env-file`, `--inspect`, `--check`.
- nvm: `install`, `use`, `ls`. Pin with `.nvmrc` and `engines`.
- Even majors become LTS. Odd majors are short-lived.

## Good to know

- Q: What's the difference between LTS and Current Node releases? Even-numbered majors become LTS, long-term support, about 30 months of fixes. Use those in production. Odd majors are short-lived Current releases. Do not deploy one.
- Q: How would you auto-restart a Node app during development without extra packages? `node --watch app.js`. It re-runs when files change. Pair it with `--env-file` to load a `.env` without dotenv.
- `--watch` has been built in since v18.11. `--env-file` since v20.6. `node --run` was added in v22.0.0, and v22.3.0 added the walk up to `package.json` and the `NODE_RUN_*` variables. `node --test` was added in v18.1.0 and v16.17.0, stable since v20.0.0. Type stripping was added in v22.6.0 behind `--experimental-strip-types`, on by default in v23.6.0 and v22.18.0, and stable in v24.12.0, when the opt-out became `--no-strip-types`. `NODE_OPTIONS` was added in v8.0.0. Corepack was added in v16.9.0 and v14.19.0.
- `node --run` skips npm's startup and also skips `pre` and `post` hooks and `npm_*` variables. In the lesson's timing, the gap was about tenfold. One run was on the order of 10 ms versus about 140 ms.
- On this 15 GB machine, `heap_size_limit` without a flag was 2240 MiB. With `--max-old-space-size`, the reported limit was the flag plus 192 MiB of young generation: 512 became 704, 1024 became 1216. Out of memory is `FATAL ERROR`, exit 134. A container kill with no stack is often 137, SIGKILL, because the heap limit was larger than the container.
- Corepack in v24.19.0 reports 0.35.0 and is still experimental. It is not distributed starting with Node 25.
- `NODE_OPTIONS` rejects flags that choose what to run, including `--test`, `--run`, `--eval`, `--print`, and `--env-file`, with exit code 9. A flag there is inherited by every child `node`. A flag on the command line is not. In the edge-case run, the child kept the default 2240 MiB with a CLI flag, and got the parent's 704 MiB cap from `NODE_OPTIONS`.

---

## Learn More

- [How to use the Node.js REPL nodejs.org](https://nodejs.org/en/learn/command-line/how-to-use-the-nodejs-repl)
- [Run Node.js scripts from the command line nodejs.org](https://nodejs.org/en/learn/command-line/run-nodejs-scripts-from-the-command-line)
- [REPL | Node.js API Documentation nodejs.org](https://nodejs.org/api/repl.html)
- [Node.js Crash Course Traversy Media](https://www.youtube.com/watch?v=fBNz5xF-Kx4)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### `node --run`

`node --run <name>` runs a command from the `"scripts"` object of `package.json` without starting npm. `npm run` loads npm, a large JavaScript program, and then spawns your script. `node --run` does the lookup inside the `node` binary. It skips npm's startup and also skips npm's extras.

1. Node finds the nearest `package.json`, walking up from the current folder.
2. It prepends `node_modules/.bin` of every ancestor to `PATH`, so a local `eslint` or `tsc` resolves.
3. It sets `NODE_RUN_SCRIPT_NAME` and `NODE_RUN_PACKAGE_JSON_PATH`, appends arguments after `--`, and runs the script string in a shell in the folder that holds `package.json`.
4. It does not run `pre<name>` or `post<name>` hooks, and it does not set `npm_lifecycle_event` or the other `npm_*` variables.

**Example. The same script both ways, and the startup cost.**

json

```
{
  "name": "runcmp",
  "scripts": {
    "hello": "echo hello from $npm_lifecycle_event$NODE_RUN_SCRIPT_NAME"
  }
}
```


javascript

```
// bench.js: start-up cost of `node --run` vs `npm run`, 10 runs each
const { execFileSync } = require('node:child_process');

function avgMs(cmd, args) {
  const runs = 10;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) execFileSync(cmd, args, { stdio: 'ignore' });
  return Number(process.hrtime.bigint() - t0) / 1e6 / runs;
}
console.log('node --run hello:', avgMs(process.execPath, ['--run', 'hello']).toFixed(0), 'ms');
console.log('npm run hello   :', avgMs('npm', ['run', 'hello']).toFixed(0), 'ms');
```


bash

```
$ node --run hello
hello from hello
$ npm run -s hello
hello from hello
$ node bench.js
node --run hello: 13 ms
npm run hello   : 133 ms
$ node bench.js
node --run hello: 8 ms
npm run hello   : 144 ms
```

Under `npm run`, the name came from `$npm_lifecycle_event`. Under `node --run`, it came from `$NODE_RUN_SCRIPT_NAME`. The times move between machines. The roughly tenfold gap is the cost of loading npm. Lesson 96 shows the skipped `pre` hook.

### `node --test`

`node --test` starts the built-in test runner. Tests use `node:test` (`test`, `describe`, `it`, hooks, mocks) and `node:assert`. There is no config file and no Jest or Mocha install.

1. With no file arguments, it collects the default globs: `**/*.test.{cjs,mjs,js}`, `**/*-test.*`, `**/*_test.*`, `**/test-*.*`, `**/test.*`, and `**/test/**/*.*`, plus the `.ts`, `.mts`, and `.cts` forms unless `--no-strip-types` is set. `node_modules` is skipped.
2. Each file runs in its own child process. Isolation `'process'` is the default, and several run at once.
3. `spec` is the default reporter. `--test-reporter` also accepts `dot`, `tap`, `junit`, and `lcov`.
4. The exit code is 1 if any test failed, otherwise 0.

**Example. Run, change the reporter, filter by name.**

javascript

```
// test/slug.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

describe('slug', () => {
  it('lowercases and joins words', () => assert.equal(slug('Hello World'), 'hello-world'));
  it('drops punctuation', () => assert.equal(slug('  Node.js, v24! '), 'node-js-v24'));
  it('handles empty input', () => assert.equal(slug(''), ''));
});
```


bash

```
$ node --test
▶ slug
  ✔ lowercases and joins words (0.937335ms)
  ✔ drops punctuation (0.181722ms)
  ✔ handles empty input (0.182262ms)
✔ slug (2.521994ms)
ℹ tests 3
ℹ suites 1
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 91.946584
$ node --test --test-reporter=dot
....
$ node --test --test-name-pattern="punctuation"
▶ slug
  ✔ drops punctuation (0.978663ms)
✔ slug (2.213213ms)
ℹ tests 1
ℹ suites 1
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 78.292709
```

The `dot` reporter printed four dots: three tests plus the `describe` suite. Lessons 91 to 94 cover testing. Lesson 96 shows why `*.spec.js` is skipped by default.

### Built-in TypeScript type stripping

`node app.ts` runs a TypeScript file by stripping types. It removes annotations such as `: string`, `interface`, and `as T`, and runs what is left. It does not type-check. A type error still runs.

1. Node sees `.ts`, `.mts`, or `.cts`.
2. It replaces type-only syntax with whitespace, so line and column numbers stay put and stack traces point at your source.
3. Syntax that would need generated JavaScript, such as `enum`, a `namespace` with values, or parameter properties, is rejected with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. `--experimental-transform-types` handles those.
4. Run `tsc --noEmit` in CI or the editor for real type checking.

**Example. A `.ts` file with no build step, and an `enum` that is refused.**

typescript

```
// greet.ts
interface User { name: string; age: number }

function greet(user: User): string {
  return `Hello, ${user.name} (${user.age})`;
}

console.log(greet({ name: 'Ada', age: 36 }));
const wrong: number = 'not a number' as any as number;   // no type check happens at run time
console.log(typeof wrong);
```


bash

```
$ node greet.ts
Hello, Ada (36)
string
$ cat color.ts
enum Color { Red, Green }
console.log(Color.Green);
$ node color.ts
file://<cwd>/color.ts:1
enum Color { Red, Green }
^^^^^^^^^^^^^^^^^^^^^^^^^
console.log(Color.Green);

SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
    …
$ node --no-strip-types greet.ts
<cwd>/greet.ts:2
interface User { name: string; age: number }
          ^^^^

SyntaxError: Unexpected identifier 'User'
    …
```

`<cwd>` stands for the working directory. `tsconfig`, `import type`, and `.ts` extensions in imports are in lesson 95.

### `NODE_OPTIONS`

`NODE_OPTIONS` is a space-separated list of `node` flags in the environment. Node reads them at startup as if they were typed before the real command line. Use it for a `node` process you do not launch yourself: one started by npm, a test runner, or a container entrypoint.

1. Node parses `NODE_OPTIONS` first, then the command line. If a flag may appear only once, the command line wins.
2. Only an allow-list is accepted (`process.allowedNodeEnvironmentFlags`, and the docs). Flags that choose what to run, `--eval`, `--print`, `--test`, `--run`, a script path, and `--env-file`, are rejected. The process exits 9.
3. Every child process inherits the variable, including every `node` that npm or your tools start.
4. On v24.19.0 the allow-list included `--max-old-space-size`, `--enable-source-maps`, `--require`, `--import`, `--inspect`, `--watch`, `--permission`, and `--no-strip-types`.

**Example. Allowed and rejected flags.**

bash

```
$ node -e "const f = process.allowedNodeEnvironmentFlags; for (const x of ['--max-old-space-size','--enable-source-maps','--require','--watch','--env-file','--test','--run','--eval']) console.log(x.padEnd(22), f.has(x))"
--max-old-space-size   true
--enable-source-maps   true
--require              true
--watch                true
--env-file             false
--test                 false
--run                  false
--eval                 false
$ NODE_OPTIONS="--test" node -p 1
node: --test is not allowed in NODE_OPTIONS
$ echo $?
9
$ NODE_OPTIONS="--env-file=.env" node -p 1
node: --env-file= is not allowed in NODE_OPTIONS
```


### `--max-old-space-size`

V8 splits the heap into a small young generation and a large old generation. `--max-old-space-size=<MiB>` caps the old generation. If live data still does not fit after a full collection, V8 aborts with `FATAL ERROR` and "JavaScript heap out of memory." If the default limit is larger than the container, the kernel's OOM killer ends the process first, with SIGKILL and no message.

1. Without the flag, V8 picks a default from the machine's memory. On this 15 GB machine, `heap_size_limit` was 2240 MiB.
2. With the flag, the reported limit is your value plus the young generation, 192 MiB here. 512 became 704. 1024 became 1216.
3. As the heap nears the limit, V8 runs more full collections, the "Last few GCs" in the crash log, then aborts.
4. An abort is SIGABRT, signal 6, so the shell sees 134, which is 128 plus 6.

**Example. Read the limit, then hit it.**

javascript

```
// heap.js: print the heap limit, then (with "grow") allocate until the limit is hit
const v8 = require('node:v8');
const mib = (n) => Math.round(n / 2 ** 20);
console.log('heap_size_limit:', mib(v8.getHeapStatistics().heap_size_limit), 'MiB');

if (process.argv[2] === 'grow') {
  const keep = [];
  setInterval(() => {
    for (let i = 0; i < 1e5; i++) keep.push({ i, s: 'x'.repeat(20) + i });
    console.log('heapUsed:', mib(process.memoryUsage().heapUsed), 'MiB');
  }, 0);
}
```


bash

```
$ node heap.js
heap_size_limit: 2240 MiB
$ node --max-old-space-size=1024 heap.js
heap_size_limit: 1216 MiB
$ NODE_OPTIONS=--max-old-space-size=512 node heap.js
heap_size_limit: 704 MiB
$ NODE_OPTIONS=--max-old-space-size=512 node --max-old-space-size=1024 heap.js
heap_size_limit: 1216 MiB
$ node --max-old-space-size=32 heap.js grow
heap_size_limit: 224 MiB
heapUsed: 27 MiB

<--- Last few GCs --->

[94005:0x12dad000]       56 ms: Scavenge 19.4 (29.1) -> 19.2 (51.3) MB, pooled: 0 MB, 4.53 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
[94005:0x12dad000]      109 ms: Mark-Compact 36.0 (53.5) -> 33.1 (67.5) MB, pooled: 0 MB, 15.99 / 0.00 ms  (+ 10.1 ms in 235 steps since start of marking, biggest step 0.3 ms, walltime since start of marking 53 ms) (average mu = 0.748, current mu = 0.748)
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

 1: 0x75356c node::OOMErrorHandler(char const*, v8::OOMDetails const&) [node]
 …
$ echo $?
134
```

The fourth run shows the command-line flag, 1024, winning over `NODE_OPTIONS`, 512. Lesson 4's exit-code line explains 134.

### Corepack

Corepack downloads and runs the exact pnpm or Yarn version named in `"packageManager"`. You do not install that package manager globally. In v24.19.0 it is still bundled, `corepack --version` prints `0.35.0`, and it is marked experimental. The v24 docs say it will no longer be distributed starting with Node 25. After that, `npm install -g corepack` if you still want it.

1. `package.json` says `"packageManager": "pnpm@10.34.6"`.
2. `corepack pnpm`, or a shim from `corepack enable`, reads that field, downloads that exact version into `COREPACK_HOME` on first use, and runs it.
3. Calling a different package manager in that project is refused, so lockfiles do not mix.
4. `corepack enable` writes shims (`pnpm`, `pnpx`, `yarn`, `yarnpkg`) next to the `corepack` binary, or into `--install-directory`.

**Example. A throwaway `COREPACK_HOME` and shim folder, so the real environment is not changed.**

bash

```
$ cat package.json
{
  "name": "cp-demo",
  "packageManager": "pnpm@10.34.6"
}
$ export COREPACK_HOME=$PWD/../home      # throwaway cache
$ corepack --version
0.35.0
$ corepack pnpm --version
10.34.6
$ corepack yarn --version
This project is configured to use pnpm because …/cp/proj/package.json has a "packageManager" field
$ echo $?
1
$ mkdir ../shims                          # enable fails with ENOENT if the folder is missing
$ corepack enable --install-directory ../shims
$ ls ../shims
pnpm
pnpx
yarn
yarnpkg
$ PATH=$PWD/../shims:$PATH pnpm --version
10.34.6
```


### Common mistakes & gotchas (additional topics)

- **Switching `npm run` to `node --run` when you have `pre` and `post` hooks.** The hooks stop, and nothing warns you.
- **Thinking `node app.ts` type-checks.** It only strips types. Keep `tsc --noEmit` in CI.
- **Putting `--env-file` or `--test` in `NODE_OPTIONS`.** Both are rejected with exit 9. Put them on the command line or in a script.
- **Setting `NODE_OPTIONS` in a shell profile or a Dockerfile `ENV` for one app.** Every Node process inherits it, including npm and build tools.
- **Setting `--max-old-space-size` above the container limit.** The kernel then sends SIGKILL, exit 137, before V8 can print anything. Leave room for the young generation, buffers, and native memory.
- **Relying on bundled Corepack in a new setup.** It is experimental, and it is not bundled from Node 25.

### Edge case worked through: `NODE_OPTIONS` reaches every child process, a CLI flag does not

A flag on the command line applies to that one process. The same flag in `NODE_OPTIONS` is in the environment, so every `node` started below it inherits it. That is how you add `--require ./tracing.js` to an app a framework CLI starts. It also means a memory cap meant for one server lands on npm, the test runner, and every worker those tools spawn.

javascript

```
// parent.js: print this process's heap limit, then a child's
const { execFileSync } = require('node:child_process');
const limit = "Math.round(require('node:v8').getHeapStatistics().heap_size_limit / 2 ** 20) + ' MiB'";
console.log('parent:', eval(limit), '| NODE_OPTIONS =', JSON.stringify(process.env.NODE_OPTIONS));
console.log('child :', execFileSync(process.execPath, ['-p', limit]).toString().trim());
```


bash

```
$ node --max-old-space-size=512 parent.js
parent: 704 MiB | NODE_OPTIONS = undefined
child : 2240 MiB
$ NODE_OPTIONS=--max-old-space-size=512 node parent.js
parent: 704 MiB | NODE_OPTIONS = "--max-old-space-size=512"
child : 704 MiB
```

With the CLI flag, the child got the default 2240 MiB. With `NODE_OPTIONS`, the child got the same 704 MiB cap as the parent. For one child only, pass `execArgv` to `fork()`, or give `spawn()` an `env` that drops or changes `NODE_OPTIONS`.

### ⭐ Interview lens (additional topics)

> **Q: “Your Node service in a 1 GiB container is killed with exit code 137 and no stack trace. What is happening and what do you change?”**  
> 137 is 128 plus 9. The process received SIGKILL. Here that is the kernel OOM killer, because the container hit its memory limit. V8 never noticed. Its default heap limit comes from the machine's memory and can be larger than the container. Set `--max-old-space-size` below the limit, for example 700 to 768 MiB for 1 GiB, leaving room for the young generation, buffers, and native memory. If the data really does not fit, V8 then fails with `FATAL ERROR` and exit 134, which shows up in the logs. The trap is raising the heap limit above the container. That makes 137 more likely, not less.

> **Q: “`node --run` or `npm run`?”**  
> `node --run` starts faster because it does not load npm. In the run in this lesson the gap was about tenfold, on the order of 10 ms versus about 140 ms, and the exact times move by machine. In return there are no `pre` or `post` hooks and no `npm_*` variables. Use `node --run` for a script you run constantly in a dev loop. Keep `npm run` where a hook or an npm variable is part of the script. The limit is switching a project over without reading the `scripts` block. A `prebuild` that used to run will silently stop.
