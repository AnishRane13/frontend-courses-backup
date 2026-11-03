---
title: "The Global Object, process, and Environment"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/global-process-env
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# The Global Object, process, and Environment

*9 min read · Updated 24 Jul 2026 Topic 4 of 70 Bookmark Mark done Why it matters Every real Node application needs to answer questions about itself and its surroundings · Topic 4 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/global-process-env](https://www.geekyfrontend.in/learn/nodejs-backend-kit/global-process-env)

---

## Say it in 30 seconds

`process` is the global object that represents this running Node program. You read the command line from `process.argv`, configuration from `process.env`, and the launch directory from `process.cwd()`, and you stop the program with an exit code or a signal handler.

It exists so the same build can run in development and production without hard-coded paths or passwords. The trade-off is that every value in `process.env` is a string. `"3000"` is not the number 3000, and the string `"false"` is still truthy if you use it as a boolean.

`global` is Node's global object. There is no `window`. `globalThis` is the name that also works in a browser.

## Why it matters

A real program has to know how it was started. Which arguments were on the command line. Which database URL to use. Which directory it was launched from. Whether this is production. How to stop without cutting off open requests. All of that is `process`. Configuration comes in through environment variables. CLIs read `process.argv`. Servers shut down through exit codes and signal handlers.

## The concept, simply

In the browser the global object is `window`, the tab. In Node the global object is `global`, the running program. There is no `window`. A few names exist everywhere without an import: `console`, `setTimeout`, `process`, `Buffer`, and, in CommonJS only, `__dirname` and `__filename`. The portable name for the global object is `globalThis`.

`process` is the control panel. Through it you read arguments, environment variables, the working directory, the process id, memory, and the platform, and you can listen for lifecycle events or exit.

![Diagram of the process object branching into argv, env, and cwd, with a footer listing exit, platform, pid, and memoryUsage](assets/i01_01_9bdc8d89.svg)

The three you use constantly are `process.argv`, `process.env`, and `process.cwd()`.

## How it works

**`process.argv` is an array of strings.** Index 0 is the path to the Node binary. Index 1 is the path to the script. The user's arguments start at index 2. For `node app.js hello 42`, index 2 is `hello` and index 3 is the string `"42"`, not the number 42. Slice from 2, and convert types yourself.

**`process.env` is a plain object of strings,** copied from the environment that launched the process. Database URLs, API keys, feature flags, and `NODE_ENV` (`"development"`, `"production"`, or `"test"`) belong here. A key you never set is `undefined`. Secrets belong in the environment, not in source.

**`process.cwd()` versus `__dirname`.** `cwd()` is the directory you were in when you started Node. `__dirname` is the directory of the current file, and it exists in CommonJS. If you are in `/home/me` and run `node ./scripts/build.js`, `cwd()` is `/home/me` and `__dirname` is `/home/me/scripts`. Use `__dirname` with `path.join` to find files shipped next to the code. Use `cwd()` for "wherever the user invoked me."

**Lifecycle.** `process.exit(code)` ends the process immediately. 0 is success. Anything else is failure. `exit` listeners must be synchronous. `SIGINT` is Ctrl-C. `SIGTERM` is the polite stop from `kill`, Docker, and Kubernetes. A server should stop accepting connections, finish in-flight requests, and close pools before it exits. Prefer setting `process.exitCode` and letting the loop drain over calling `process.exit()` right after a log line. On a pipe, a large write can be cut off. The additional topics show that.

Other useful fields: `process.version`, `process.platform` (`darwin`, `linux`, `win32`), `process.pid`, `process.memoryUsage()`, and `process.uptime()`. You can hang your own values on `global`. Do not. Pass them in instead.

## Code examples

**Example 1. Command-line arguments.**

javascript

```
// greet.js
const args = process.argv.slice(2); // drop node path + script path
const name = args[0] || 'world';
const times = Number(args[1]) || 1;  // argv values are strings — convert!

for (let i = 0; i < times; i++) {
  console.log('Hello, ' + name + '!');
}

// Run:  node greet.js Ankit 3
// Output: Hello, Ankit!  (three times)
```


**Example 2. Configuration from the environment.**

javascript

```
// config.js
const config = {
  port: Number(process.env.PORT) || 3000,        // string -> number, with default
  nodeEnv: process.env.NODE_ENV || 'development',
  dbUrl: process.env.DATABASE_URL,               // required in production
  isProd: process.env.NODE_ENV === 'production',
};

if (config.isProd && !config.dbUrl) {
  console.error('DATABASE_URL is required in production');
  process.exit(1); // non-zero = failure, stops deploy scripts
}

console.log('Starting in ' + config.nodeEnv + ' on port ' + config.port);

// Run:  PORT=8080 NODE_ENV=production DATABASE_URL=... node config.js
```


**Example 3. The environment, and where the file actually is.**

javascript

```
// info.js
const path = require('node:path');

console.log('Node version :', process.version);
console.log('Platform     :', process.platform);
console.log('Process ID   :', process.pid);
console.log('Launched from :', process.cwd());
console.log('This file dir :', __dirname);

// Build a path relative to THIS file, not the caller's location:
const dataFile = path.join(__dirname, 'data', 'seed.json');
console.log('Data file    :', dataFile);

const mb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
console.log('Heap used    :', mb + ' MB');
```


**Example 4. Catch Ctrl-C and clean up.**

javascript

```
// shutdown.js
console.log('Running... press Ctrl-C to stop. PID:', process.pid);

process.on('SIGINT', () => {
  console.log('
Caught interrupt — closing connections, flushing logs...');
  // ...close DB, finish in-flight requests here...
  process.exit(0); // clean exit
});

setInterval(() => console.log('still working:', process.uptime().toFixed(0) + 's'), 1000);
```


## Common mistakes & gotchas

- **Forgetting `slice(2)`.** `argv[0]` is Node, not the user's first argument.
- **Treating env values as numbers or booleans.** `PORT` is `"3000"`. The string `"false"` is truthy. Convert with `Number`, and compare strings on purpose.
- **Secrets in source.** Read them from the environment.
- **`cwd()` used to find a file that ships with the code.** That path breaks when the process is started from another directory. Use `__dirname`.
- **Reaching for `window`.** It does not exist. Use `process`, or `globalThis` for the global object.
- **`process.exit()` too early.** It can cut off buffered writes. Set `process.exitCode` and return, or shut down on purpose.
- **Hanging values on `global`.** That is hidden coupling. Pass the values in.

## Best practices

- Read `process.env` once into a config object, check the required keys at startup, and exit non-zero if one is missing.
- Convert and default: `Number(process.env.PORT) || 3000`.
- Keep secrets in the environment or a secrets manager. A local `.env` stays out of git. Load it with `--env-file` or a loader.
- Build paths to bundled files with `path.join` and `__dirname`.
- Handle `SIGTERM` and `SIGINT` in servers. Close connections and finish requests before you exit.
- Prefer `globalThis` when you need the global object itself.

## ⭐ Interview lens

> **Q: “What is the `process` object?”**  
> `process` is a global object for this running Node program. It exposes the command line as `argv`, the environment as `env`, the launch directory as `cwd()`, identity such as `pid`, `platform`, `version`, and `memoryUsage()`, and lifecycle controls such as `exit()` and signal events. You do not import it. A server reads its port and database URL from it, and a CLI reads its flags from it. The limit is treating it as a bag of already-typed values. Every `argv` entry and every env value is a string, and a missing env key is `undefined`, not an empty string.

> **Q: “What's in `process.argv[0]` and `[1]`?”**  
> Index 0 is the path to the Node executable. Index 1 is the path to the script that is running. The arguments the user typed start at index 2, so you read `process.argv.slice(2)`. For `node app.js hello 42`, index 3 is the string `"42"`. You convert it if you need a number. The limit is a snapshot or a non-file entry. In a startup snapshot there is no script path, so user arguments start earlier. Do not assume index 2 in that case. Lesson 2 shows it.

> **Q: “How do you pass configuration into a Node app, and why not hard-code it?”**  
> Read environment variables from `process.env`. The same build can point at a local database or a production one, and secrets stay out of source control. `NODE_ENV` is the usual switch for development, production, or test. The limit is the type. `process.env.PORT` is the string `"3000"`, and `Boolean("false")` is true because any non-empty string is truthy. Convert explicitly, and fail at startup if a required key is missing, not on the first request that needs it.

> **Q: “Difference between `process.cwd()` and `__dirname`?”**  
> `process.cwd()` is the directory the process was launched from, so it changes with the shell's current directory. `__dirname` is the directory of the current CommonJS file, and it does not move. If you are in `/home/me` and run `node ./scripts/build.js`, `cwd()` is `/home/me` and `__dirname` is `/home/me/scripts`. Use `__dirname` with `path.join` for a file that ships with the code. Use `cwd()` for a path the user meant, relative to where they ran the command. The limit is ES modules. `__dirname` does not exist there. You rebuild it from `import.meta.url`, or use `import.meta.dirname` on a current Node. Lesson 12.

## Cheat-card

- Global object: `global`. No `window`. Portable name: `globalThis`.
- `process.argv`: strings. Real arguments start at index 2. Use `slice(2)`.
- `process.env`: config and secrets. Every value is a string. A missing key is `undefined`.
- `process.cwd()` is the launch directory. `__dirname` is the file's directory, in CommonJS.
- Lifecycle: `process.exit(code)`, and listeners for `SIGINT`, `SIGTERM`, and `exit`.
- Also: `process.version`, `.platform`, `.pid`, `.memoryUsage()`.
- Convert env values. Do not hard-code secrets. Do not hang state on `global`.

## Good to know

- Q: Is there a `window` object in Node? No. `window` is a browser global. Node's global object is `global`, and the portable reference is `globalThis`. The global you use every day is `process`.
- Q: How would you implement graceful shutdown? Listen for `SIGTERM` and `SIGINT`. Stop accepting connections with `server.close()`, drop idle keep-alive sockets, finish in-flight requests, close pools, then exit 0. A deadline shorter than the orchestrator's grace period should force a non-zero exit if something hangs. Calling `process.exit()` as the first line drops that work. With no handler, Node dies on SIGTERM and a shell reports 143, which is 128 plus 15.
- Exit codes: 0 success. 1 uncaught exception. 5 fatal V8 error. 7 an `uncaughtException` handler that itself threw. 9 invalid CLI option. 13 unsettled top-level await. 14 snapshot failure. 2 is reserved by Bash. 3, 4, 6, and 10 are internal bootstrap failures. Many CLIs also use 64 for a bad command line, 70 for an internal software error, and 78 for bad configuration. A signal has no exit code. The shell reports 128 plus the signal number: SIGTERM 15 is 143, SIGKILL 9 is 137, SIGABRT 6 is 134. Codes are 8-bit, so `process.exit(256)` is seen as 0. Keep your own codes in 0 to 125.
- `--env-file` was added in v20.6.0 and is stable since v24.10.0. `process.loadEnvFile()` was added in v21.7.0 and v20.12.0, stable since v24.10.0. With `--env-file`, the last file wins. With `loadEnvFile` or a dotenv path array, the first file wins, because later loads skip keys already set. A variable already in the real environment beats every file. dotenv 18.0.6 was the package used here.
- `util.parseArgs()` was added in v18.3.0 and v16.17.0, stable since v20.0.0. It returns strings and booleans only. `strict` defaults to true, and an unknown option throws `ERR_PARSE_ARGS_*`, exit 1 if uncaught.
- `process.hrtime.bigint()` was added in v10.7.0 and returns monotonic nanoseconds as a BigInt. `process.hrtime()` was added in v0.7.6 and is marked Legacy. `beforeExit` was added in v0.11.12. It fires when the loop is empty and may schedule more work. It does not fire on `process.exit()`, an uncaught exception, or a signal.
- On a POSIX pipe, `process.exit()` right after a large stdout write kept 65,536 bytes of 1,048,576 and still exited 0. The kernel pipe buffer is 64 KiB. Setting `process.exitCode` lets the queued write finish. A write to a file is synchronous, so the file got every byte.

---

## Learn More

- [Process | Node.js API Documentation nodejs.org](https://nodejs.org/api/process.html)
- [Global objects | Node.js API Documentation nodejs.org](https://nodejs.org/api/globals.html)
- [How to read environment variables from Node.js nodejs.org](https://nodejs.org/en/learn/command-line/how-to-read-environment-variables-from-nodejs)
- [Learn Node.js - Full Tutorial for Beginners freeCodeCamp.org](https://www.youtube.com/watch?v=RLtyhwFtXQA)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### dotenv and `process.loadEnvFile()`

A `.env` file is `KEY=value` lines you keep out of git. Something has to copy those keys into `process.env` before your config code runs. dotenv, the npm package, is the original JavaScript loader. Node also has `--env-file` and `process.loadEnvFile(path)`. Without a loader, a value that exists only in `.env` is `undefined`, and the app falls back to a default or crashes on the first database call.

1. The loader parses each line. It strips quotes, drops `#` comments, ignores an `export ` prefix, and joins quoted multi-line values.
2. For each key it checks whether `process.env` already has that key. dotenv and `loadEnvFile` skip keys that are set, unless you pass dotenv `override: true`.
3. It assigns the remaining keys as strings. Nothing becomes a number or a boolean.
4. With several files, which value wins depends on the loader. The rule is in Good to know.

**Example. dotenv 18.0.6, and the precedence of the three loaders.** `.env` holds `PORT=3000` and `LOG_LEVEL=info`. `.env.local` holds `PORT=4400`.

javascript

```
// dotenv-demo.js (dotenv 18.0.6)
const dotenv = require('dotenv');

const result = dotenv.config({ path: ['.env.local', '.env'] });
console.log('parsed:', result.parsed);
console.log('PORT =', process.env.PORT, '| LOG_LEVEL =', process.env.LOG_LEVEL);

const missing = dotenv.config({ path: 'nope.env', quiet: true });
console.log('missing file ->', missing.error?.code, '(no throw)');
```


bash

```
$ npm install dotenv@18.0.6
$ node dotenv-demo.js
◇ injected env (2) from .env.local,.env
parsed: { PORT: '4400', LOG_LEVEL: 'info' }
PORT = 4400 | LOG_LEVEL = info
missing file -> ENOENT (no throw)
$ PORT=1 node dotenv-demo.js
◇ injected env (1) from .env.local,.env
parsed: { PORT: '4400', LOG_LEVEL: 'info' }
PORT = 1 | LOG_LEVEL = info
missing file -> ENOENT (no throw)
```

dotenv prints a `◇ injected env` line unless you pass `quiet: true`. In the second run, `result.parsed` still says `4400` even though `process.env.PORT` stayed `1`. `parsed` is what the file contained, not what was applied. A missing file does not throw. It shows up as `result.error`.

javascript

```
// precedence.js: the same two files, three loaders. .env.local has PORT=4400, .env has PORT=3000.
const { execFileSync } = require('node:child_process');
const run = (args, code) =>
  execFileSync(process.execPath, [...args, '-e', code], { env: { PATH: process.env.PATH } }).toString().trim();

const show = 'console.log(process.env.PORT)';
console.log('--env-file=.env.local --env-file=.env :',
  run(['--env-file=.env.local', '--env-file=.env'], show));
console.log("loadEnvFile('.env.local') then ('.env'):",
  run([], "process.loadEnvFile('.env.local'); process.loadEnvFile('.env');" + show));
console.log("dotenv path ['.env.local', '.env']     :",
  run([], "require('dotenv').config({ path: ['.env.local', '.env'], quiet: true });" + show));
console.log('shell PORT=1 + --env-file=.env        :',
  execFileSync(process.execPath, ['--env-file=.env', '-e', show], { env: { PORT: '1' } }).toString().trim());

// Real output (Node v24.19.0, dotenv 18.0.6):
//   --env-file=.env.local --env-file=.env : 3000
//   loadEnvFile('.env.local') then ('.env'): 4400
//   dotenv path ['.env.local', '.env']     : 4400
//   shell PORT=1 + --env-file=.env        : 1
```

Lesson 96 covers the flag's parser, `--env-file-if-exists`, and `util.parseEnv()`.

### Validating config with a schema at startup

`process.env` is optional strings. A schema says which keys are required, their types, the allowed values, and the defaults. zod, 4.6.5 here, checks `process.env` once at startup and returns a typed object or a list of every problem. Without that, `PORT=80a` becomes `NaN` and fails only when `listen()` runs. A missing `DATABASE_URL` fails on the first query.

1. Load the `.env` file first, so `process.env` is complete.
2. Define a `z.object` whose keys are the env names. `z.coerce.number()` converts the string. `z.stringbool()` accepts `"true"`, `"false"`, `"1"`, `"0"`, `"yes"`, `"no"`, and similar. `.default()` fills gaps.
3. `safeParse(process.env)` does not throw. You get `{ success: true, data }` or `{ success: false, error }`.
4. On failure, print every issue, `z.prettifyError`, and exit non-zero before you open a port.
5. Freeze the result and export it. The rest of the app imports `config`, not `process.env`.

**Example. A config module that refuses to start on bad input.**

javascript

```
// config.js (zod 4.6.5): parse process.env once, at startup, into a typed object
const { z } = require('zod');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  DEBUG: z.stringbool().default(false),        // "true"/"false"/"1"/"0"/"yes"/"no"... -> boolean
});

const result = EnvSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid configuration:');
  console.error(z.prettifyError(result.error));
  process.exit(78);                            // see "Exit codes" below
}
const config = Object.freeze(result.data);
module.exports = config;
if (require.main === module) console.log(config);
```


bash

```
$ npm install zod@4.6.5
$ DATABASE_URL=postgres://db/app PORT=8080 DEBUG=false node config.js
{
  NODE_ENV: 'development',
  PORT: 8080,
  DATABASE_URL: 'postgres://db/app',
  DEBUG: false
}
$ PORT=80a DEBUG=nope NODE_ENV=prod node config.js
Invalid configuration:
✖ Invalid option: expected one of "development"|"test"|"production"
  → at NODE_ENV
✖ Invalid input: expected number, received NaN
  → at PORT
✖ Invalid input: expected string, received undefined
  → at DATABASE_URL
✖ Invalid option: expected one of "true"|"1"|"yes"|"on"|"y"|"enabled"|"false"|"0"|"no"|"off"|"n"|"disabled"
  → at DEBUG
$ echo $?
78
```

`DEBUG=false` became the boolean `false`. `Boolean(process.env.DEBUG)` would have been `true`, because `"false"` is a non-empty string.

### `util.parseArgs()`

`util.parseArgs()` turns `process.argv.slice(2)` into `{ values, positionals }` from an `options` description. Hand-written loops tend to get `--port=80`, `-p 80`, `--`, and repeated flags wrong.

1. Each option is `type: 'string'` or `'boolean'`, plus optional `short`, `default`, and `multiple`.
2. It matches `--name`, `--name=value`, `-n value`, and grouped short flags such as `-vp 80`, and it stops treating arguments as options after `--`.
3. With `strict: true`, the default, an unknown option or a string option with no value throws a `TypeError` whose code is `ERR_PARSE_ARGS_*`. Uncaught, the process exits 1.
4. Values stay strings. You convert them.

**Example. CLI flag beats environment variable beats default.**

javascript

```
// serve-cli.js: CLI flag > environment variable > default
const { parseArgs } = require('node:util');

const { values } = parseArgs({
  options: {
    port: { type: 'string', short: 'p' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (values.help) {
  console.log('usage: node serve-cli.js [--port N]');
  process.exit(0);
}
const port = Number(values.port ?? process.env.PORT ?? 3000);
if (!Number.isInteger(port)) {
  console.error(`invalid port: ${values.port ?? process.env.PORT}`);
  process.exit(64);                       // EX_USAGE, see "Exit codes" below
}
console.log('port', port, typeof port);
```


bash

```
$ node serve-cli.js
port 3000 number
$ PORT=8080 node serve-cli.js
port 8080 number
$ PORT=8080 node serve-cli.js -p 9090
port 9090 number
$ node serve-cli.js --port abc
invalid port: abc
$ echo $?
64
$ node serve-cli.js -x
node:internal/util/parse_args/parse_args:102
      throw new ERR_PARSE_ARGS_UNKNOWN_OPTION(
      ^
…
TypeError [ERR_PARSE_ARGS_UNKNOWN_OPTION]: Unknown option '-x'
…
$ echo $?
1
```

Lesson 96 shows `allowPositionals`, `multiple`, and `allowNegative` (`--no-color`).

### `process.stdin`, `process.stdout`, `process.stderr`

Every process starts with three file descriptors. 0 is stdin, input. 1 is stdout, results. 2 is stderr, diagnostics. Node wraps them as streams. `process.stdin` is readable. `process.stdout` and `process.stderr` are writable. `console.log` writes stdout. `console.error` writes stderr. A shell can pipe stdout to `jq` or a file and still show errors on the terminal. A CLI that logs on stdout breaks every pipeline it is used in.

1. The shell connects each descriptor to a terminal, a file, or a pipe before Node starts. `isTTY` is true only for a terminal.
2. `for await` on `process.stdin` yields chunks until the writer closes the pipe.
3. Writes to stdout and stderr are synchronous for files, and for terminals on POSIX. For pipes on POSIX they are asynchronous. An async write that has not finished when the process ends is lost.
4. `2>/dev/null` discards stderr. `2>&1 >/dev/null` keeps only stderr.

**Example. A Unix filter.**

javascript

```
// upper.js: a filter. Data in on stdin, results on stdout, diagnostics on stderr.
async function main() {
  if (process.stdin.isTTY) {
    console.error('usage: <something> | node upper.js');
    process.exitCode = 64;
    return;
  }
  let lines = 0;
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {     // stdin is a Readable stream
    lines += chunk.split('\n').length - 1;
    process.stdout.write(chunk.toUpperCase());    // stdout is a Writable stream
  }
  console.error(`[upper] ${lines} lines processed`); // console.error writes to stderr
}
main();
```


bash

```
$ printf "ada\nlin\n" | node upper.js
ADA
LIN
[upper] 2 lines processed
$ printf "ada\nlin\n" | node upper.js 2>/dev/null
ADA
LIN
$ printf "ada\nlin\n" | node upper.js 2>&1 >/dev/null
[upper] 2 lines processed
$ node upper.js            # stdin is a terminal (run inside `script -qec` to get a real TTY)
usage: <something> | node upper.js
$ echo $?
64
```


### `process.hrtime()` and `process.hrtime.bigint()`

`process.hrtime.bigint()` returns nanoseconds as a BigInt from a monotonic clock. That clock counts from an arbitrary point, often boot. It does not jump backwards, and NTP or a manual clock change does not move it. `process.hrtime()` returns the same clock as a `[seconds, nanoseconds]` pair and is marked Legacy. `Date.now()` is wall-clock time in milliseconds. A clock step can make a `Date.now()` difference wrong, even negative. Durations should use the monotonic clock.

1. Take `start = process.hrtime.bigint()` before the work and `end` after it.
2. `end - start` is a BigInt of nanoseconds. `Number(ns) / 1e6` is milliseconds. Mixing BigInt and Number in one arithmetic expression throws a `TypeError`.
3. With the legacy tuple, pass the earlier tuple back in, `hrtime(start)`, to get the difference.

**Example. Timing a 50 ms timer.**

javascript

```
// timing.js: measure a duration with the monotonic clock
const { hrtime } = require('node:process');

const start = hrtime.bigint();            // nanoseconds since an arbitrary point, as a BigInt
const startTuple = hrtime();              // legacy form: [seconds, nanoseconds]

setTimeout(() => {
  const ns = hrtime.bigint() - start;     // BigInt minus BigInt
  const [s, n] = hrtime(startTuple);      // legacy: pass the old tuple to get the difference
  console.log('bigint :', ns, 'ns =', Number(ns) / 1e6, 'ms');
  console.log('tuple  :', [s, n], '=', s * 1e3 + n / 1e6, 'ms');
  try { ns / 1e6; } catch (err) { console.log('mixing :', err.constructor.name, '-', err.message); }
}, 50);

// Real output (Node v24.19.0; the numbers differ on every run):
//   bigint : 50562051n ns = 50.562051 ms
//   tuple  : [ 0, 50563245 ] = 50.563245 ms
//   mixing : TypeError - Cannot mix BigInt and other types, use explicit conversions
```

The timer was set for 50 ms and fired after about 50.5 ms. A timer delay is a minimum, not an exact time.

### The `'beforeExit'` event

`'beforeExit'` fires when the event loop has no work left: no timers, sockets, or pending I/O. Unlike `'exit'`, a listener may start new asynchronous work. If it does, the loop keeps running, and `'beforeExit'` fires again the next time the loop is empty. That is the place for a last flush of buffered logs or metrics. It does not fire when the process ends through `process.exit()`, an uncaught exception, or a fatal signal.

1. The last callback returns and the loop finds nothing pending.
2. Node emits `'beforeExit'` with `process.exitCode`.
3. If a listener scheduled work, the loop runs it and comes back to step 1.
4. If nothing was scheduled, Node emits `'exit'`. Only synchronous code runs there. Then the process ends.

**Example. Flush a queue, and what `process.exit()` skips.**

javascript

```
// before-exit.js: 'beforeExit' fires when the loop runs out of work; 'exit' fires on the way out
let flushes = 0;
const queue = ['a', 'b'];

process.on('beforeExit', (code) => {
  console.log(`beforeExit #${++flushes} (code ${code}), queued: ${queue.length}`);
  if (queue.length) {
    const batch = queue.splice(0);
    setTimeout(() => console.log('  flushed', batch), 10); // new async work: the loop keeps going
  }
});
process.on('exit', (code) => console.log(`exit (code ${code}); only sync code runs here`));

console.log('main script done');
if (process.argv[2] === 'hard') process.exit(0);
```


bash

```
$ node before-exit.js
main script done
beforeExit #1 (code 0), queued: 2
  flushed [ 'a', 'b' ]
beforeExit #2 (code 0), queued: 0
exit (code 0); only sync code runs here
$ node before-exit.js hard
main script done
exit (code 0); only sync code runs here
```

The listener has to stop scheduling work, here once the queue is empty, or the process never exits.

### A complete SIGTERM handler

SIGTERM, signal 15, is the polite stop that `kill`, `docker stop`, Kubernetes, and systemd send before they escalate to SIGKILL, signal 9, which cannot be caught. With no listener, Node's default is to die at once. The process then reports no exit code, only the signal, and a request in progress has its socket cut.

1. `process.on('SIGTERM', fn)` replaces that default. Your code is now responsible for exiting.
2. `server.close(cb)` stops accepting new connections. New clients get `ECONNREFUSED`.
3. Requests already in progress finish. `closeIdleConnections()` drops idle keep-alive sockets so they do not hold `close` open.
4. When the last connection ends, close pools, flush logs, and `process.exit(0)`.
5. A `setTimeout(...).unref()` deadline forces `exit(1)` if something hangs. Keep it shorter than the orchestrator's grace period. Kubernetes defaults to 30 seconds.

**Example. Send a real SIGTERM mid-request, with and without a handler.**

javascript

```
// server.js: an HTTP server that shuts down cleanly on SIGTERM
const http = require('node:http');

const server = http.createServer((req, res) => {
  // a slow request: 500 ms of "work"
  setTimeout(() => res.end(`done ${req.url}\n`), 500);
});
server.listen(Number(process.env.PORT) || 4410, () => console.log(`pid ${process.pid} listening`));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;                  // a second signal should not restart the sequence
  shuttingDown = true;
  console.log(`${signal} received: closing listener, waiting for in-flight requests`);

  server.close((err) => {                    // stops accepting; callback runs after the last connection ends
    console.log('all connections closed');
    // ...close DB pools, flush logs here...
    process.exit(err ? 1 : 0);
  });
  server.closeIdleConnections();             // drop idle keep-alive sockets now

  setTimeout(() => {                         // hard deadline, shorter than the orchestrator's grace period
    console.log('deadline hit: forcing exit');
    process.exit(1);
  }, 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```


javascript

```
// bare-server.js: same server, no signal handling
const http = require('node:http');
http.createServer((req, res) => setTimeout(() => res.end(`done ${req.url}\n`), 500))
  .listen(Number(process.env.PORT) || 4410, () => console.log(`pid ${process.pid} listening`));
```


javascript

```
// send-sigterm.js: start server.js, start a slow request, send SIGTERM mid-request
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

async function trial(script) {
  const child = spawn(process.execPath, [script], { env: { ...process.env, PORT: '4410' } });
  child.stdout.on('data', (d) => process.stdout.write(`  [child] ${d}`));
  child.stderr.on('data', (d) => process.stdout.write(`  [child stderr] ${d}`));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  await sleep(300);

  const inFlight = fetch('http://localhost:4410/report')
    .then(async (r) => `HTTP ${r.status} ${(await r.text()).trim()}`, (e) => `failed: ${e.cause?.code ?? e.message}`);
  await sleep(100);                       // the request is now being processed
  console.log(`  [parent] kill(${child.pid}, 'SIGTERM')`);
  child.kill('SIGTERM');

  console.log('  [parent] in-flight request ->', await inFlight);
  const after = await fetch('http://localhost:4410/late').then(() => 'accepted', (e) => `refused (${e.cause?.code})`);
  console.log('  [parent] new request after SIGTERM ->', after);
  console.log('  [parent] child exit ->', await exited);
}

(async () => {
  console.log('with the SIGTERM handler (server.js):');
  await trial('server.js');
  console.log('without a handler (bare-server.js):');
  await trial('bare-server.js');
})();

// Real output (Node v24.19.0; PIDs differ per run):
//   with the SIGTERM handler (server.js):
//     [child] pid 91454 listening
//     [parent] kill(91454, 'SIGTERM')
//     [child] SIGTERM received: closing listener, waiting for in-flight requests
//     [parent] in-flight request -> HTTP 200 done /report
//     [parent] new request after SIGTERM -> refused (ECONNREFUSED)
//     [child] all connections closed
//     [parent] child exit -> { code: 0, signal: null }
//   without a handler (bare-server.js):
//     [child] pid 91470 listening
//     [parent] kill(91470, 'SIGTERM')
//     [parent] in-flight request -> failed: UND_ERR_SOCKET
//     [parent] new request after SIGTERM -> refused (ECONNREFUSED)
//     [parent] child exit -> { code: null, signal: 'SIGTERM' }
```

With the handler, the in-flight request completed with 200 and the process exited 0. Without it, the client's socket was cut (`UND_ERR_SOCKET`), and Node reports `code: null, signal: 'SIGTERM'`. A shell shows that as 143.

### Exit-code conventions

An exit code is the small integer a process hands its parent. `$?` in a shell, `code` on Node's `'exit'` event. 0 is success. Anything else is failure. CI, `&&` chains, Docker restart policies, and systemd all decide the next step from this number. A script that logs an error and exits 0 is reported as success.

The numeric catalog is one line in Good to know. Your own codes should not clash with Node's. In Node, `child.on('exit', (code, signal) => ...)` gives `code === null` and `signal === 'SIGTERM'` when a signal killed the child.

**Example. Every case, run for real.**

bash

```
$ cat exit-codes.sh
# exit-codes.sh: run each case and print the status the shell sees
node -e "console.log('done')" >/dev/null;              echo "normal end            -> $?"
node -e "throw new Error('boom')" 2>/dev/null;         echo "uncaught exception    -> $?"
node -e "process.exitCode = 3" ;                       echo "process.exitCode = 3  -> $?"
node --no-such-flag 2>/dev/null;                       echo "unknown CLI option    -> $?"
node --input-type=module -e "await new Promise(() => {})" 2>/dev/null; echo "unsettled top-level await -> $?"
node -e "setInterval(() => {}, 1000)" & PID=$!; sleep 0.3; kill -TERM $PID; wait $PID; echo "killed by SIGTERM (15) -> $?"
node -e "setInterval(() => {}, 1000)" & PID=$!; sleep 0.3; kill -KILL $PID; wait $PID; echo "killed by SIGKILL (9)  -> $?"
node -e "process.exit(256)";                           echo "process.exit(256)     -> $?"
$ bash exit-codes.sh
normal end            -> 0
uncaught exception    -> 1
process.exitCode = 3  -> 3
unknown CLI option    -> 9
unsettled top-level await -> 13
killed by SIGTERM (15) -> 143
exit-codes.sh: line 8: 114025 Killed                     node -e "setInterval(() => {}, 1000)"
killed by SIGKILL (9)  -> 137
process.exit(256)     -> 0
```

The 134 case, SIGABRT, is what a JavaScript heap out-of-memory crash produces. Lesson 05 shows it with `--max-old-space-size`.

### Common mistakes & gotchas (additional topics)

- **Assuming every loader resolves duplicates the same way.** `--env-file` is last-file-wins. `loadEnvFile` and a dotenv path array are first-file-wins. The real environment wins in all of them.
- **Trusting `dotenv.config().parsed`.** That is the file, not `process.env`.
- **Validating config lazily.** A bad `PORT` then fails on the first request, not at deploy.
- **`Boolean(process.env.FLAG)`.** `"false"` and `"0"` are truthy strings. Use `z.stringbool()` or compare strings.
- **Logging to stdout in a CLI whose output is piped.** Diagnostics belong on stderr.
- **`process.exit()` straight after a large write to a pipe.** On POSIX the tail is lost. Set `process.exitCode` and return.
- **Async work in `'exit'`.** Timers and promises created there never run. Use `'beforeExit'` for the last flush, and remember it does not fire on `process.exit()` or a signal.
- **A SIGTERM listener that never exits.** Node will not die on SIGTERM once a listener exists. Without `process.exit()` or a deadline, the orchestrator waits out its grace period and sends SIGKILL, 137.
- **`Date.now()` differences for durations.** Wall-clock time can jump. Use `process.hrtime.bigint()` or `performance.now()`.

### Edge case worked through: `process.exit()` truncates piped stdout at 64 KiB

The docs say stdout writes to a pipe are asynchronous on POSIX. `process.stdout.write()` copies what the kernel pipe buffer accepts, 64 KiB on Linux by default, and queues the rest. `process.exit()` ends the process without waiting, so the rest is never written. A fast reader can hide it. A reader that is slow to start shows it every time.

javascript

```
// big-out.js: write 1 MiB to stdout, then end the process one of two ways
const chunk = 'x'.repeat(1024 * 1024);
process.stdout.write(chunk);
if (process.argv[2] === 'exit') process.exit(0);    // hard stop
else process.exitCode = 0;                          // let the loop drain the pipe
```


bash

```
$ node big-out.js exit | wc -c
1048576
$ node big-out.js exit | (sleep 0.5; wc -c)
65536
$ node big-out.js exit | (sleep 0.5; wc -c)
65536
$ node big-out.js | (sleep 0.5; wc -c)
1048576
$ node big-out.js exit > out.txt; wc -c < out.txt
1048576
```

With a slow reader, `process.exit(0)` delivered exactly 65,536 bytes of the 1,048,576 written, and the status was still 0. Setting `process.exitCode` lets the loop run until the queued write drains. Writing to a file is synchronous, so the file got every byte. `console.log(err); process.exit(1)` behind a pipe can drop a crashing service's last lines.

### ⭐ Interview lens (additional topics)

> **Q: “Your service exits 0 but its last log lines are missing. Why?”**  
> `process.exit()` ran right after the log, and stdout is a pipe: a log collector, `| tee`, or a container runtime. On POSIX, pipe writes are asynchronous. Bytes past the kernel pipe buffer, 64 KiB on Linux, are still queued when `exit()` ends the process, and the status can still be 0. Set `process.exitCode` and let the loop drain, or write the fatal line with `fs.writeSync` on fd 2. The limit of blaming the collector is that a write to a real file is synchronous and does not lose those bytes. The pipe is the condition.

> **Q: “What happens when Kubernetes stops your pod, and what exit codes can it see?”**  
> It sends SIGTERM, waits the grace period, 30 seconds by default, then sends SIGKILL. With a handler, the app stops accepting connections, finishes in-flight requests, closes pools, and exits 0. Without a handler, Node dies on SIGTERM, which the runtime reports as 143, 128 plus 15. If the handler hangs past the grace period, SIGKILL arrives and the status is 137. The limit is a listener that never exits. Once you handle SIGTERM, Node will not die on its own.
