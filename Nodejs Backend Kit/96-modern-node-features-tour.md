---
title: "Modern Node Features: A Guided Tour"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Modern Node Features: A Guided Tour

*22 min read · Updated 7 Oct 2026 · Topic 72 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

Between Node 18 and Node 24 the runtime took over jobs that used to need an npm package: running `package.json` scripts (`npm run`), running tests (Jest, Mocha), restarting on save (nodemon), loading `.env` files (dotenv), parsing CLI flags (yargs, commander), making HTTP and WebSocket client calls (axios, node-fetch, ws), embedding a database (better-sqlite3), packaging an app as one binary (pkg) and restricting what a script may touch. Each built-in replacement removes a dependency to install, audit and upgrade.

The catch is that each feature arrived behind a flag, changed while it was experimental, and became stable in a different release. Code written for Node 20 can fail on Node 24 and the other way round: the permission flag was spelled `--experimental-permission` on Node 20, `require()` of an ES module threw `ERR_REQUIRE_ESM` until v22.12.0, and `import … assert { type: 'json' }` is now a syntax error. If you know when each feature landed and how stable it is, you can tell which features you can rely on in production, which ones need a version check in `engines`, and which errors mean "wrong Node version" and not "bug in my code".

## The concept, simply

Each feature in this tour is one of three kinds of thing:

1. **A CLI flag** read by the `node` binary before your code runs: `--run`, `--test`, `--watch`, `--watch-path`, `--env-file`, `--permission` and the `--allow-*` flags, `--experimental-sea-config`.
2. **A built-in module or API** you load from code: `node:sqlite`, `util.parseArgs`, `process.loadEnvFile`, `node:sea`.
3. **A global or a module-loader rule**: the `fetch`, `WebSocket` and `URLPattern` globals, `require()` of ES modules, and import attributes for JSON.

Every one of them carries a **stability index** in the docs: `1` Experimental (with sub-levels 1.0 early development, 1.1 active development, 1.2 release candidate), `2` Stable, `3` Legacy. The **History** table under each API lists the release where it was added, where its flag was removed ("unflagged"), and where it stopped being experimental. Those two pieces, the stability index and the History table, are the "Added in" lines below.

## How it works

A feature normally goes through these steps between landing and becoming stable:

1. **Lands behind a flag.** The code ships in a release but only runs if you pass a flag such as `--experimental-sqlite`. Without it, the module or global does not exist.
2. **Unflagged but experimental.** The flag is removed (or flipped to an opt-out such as `--no-experimental-websocket`). The feature is available by default and may print an `ExperimentalWarning` on first use. Its API can still change in a minor release.
3. **Release candidate (1.2).** The API is believed final; only fixes are expected.
4. **Stable (2).** Semver applies: breaking changes need a new major version.
5. **Backports.** Many features are backported to older LTS lines, which is why History tables list two or three versions per row (for example `v23.5.0, v22.13.0`).

Where each feature in this tour stood on **v24.19.0**, taken from the History tables in the v24.19.0 API docs:

| Feature | Added in | Unflagged | Status in v24.19.0 |
| --- | --- | --- | --- |
| `node --run` | v22.0.0 | (no flag) | no stability marker (treated as stable); folder traversal added v22.3.0 |
| `node --test` | v18.1.0, v16.17.0 | (no flag) | Stable since v20.0.0 |
| `--watch`, `--watch-path` | v18.11.0, v16.19.0 | (no flag) | Stable since v22.0.0, v20.13.0 |
| `--env-file` | v20.6.0 | (no flag) | Stable since v24.10.0 |
| `process.loadEnvFile()` | v21.7.0, v20.12.0 | (no flag) | Stable since v24.10.0 |
| `--permission`, `--allow-fs-read/-write` | v20.0.0 (as `--experimental-permission`) | renamed `--permission` | Stable since v23.5.0, v22.13.0 |
| `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi` | v20.0.0 (addons v21.6.0, wasi v22.3.0) | — | 1.1 Active development |
| `node:sqlite` | v22.5.0 (`--experimental-sqlite`) | v23.4.0, v22.13.0 | 1.2 Release candidate since v24.15.0 |
| `require(esm)` | v22.0.0, v20.17.0 (`--experimental-require-module`) | v23.0.0, v22.12.0, v20.19.0 | Stable since v24.15.0 |
| Import attributes (`with { type: 'json' }`) | v17.1.0, v16.14.0 (as `assert`) | — | `assert` → `with` in v21.0.0, v20.10.0, v18.20.0; JSON modules stable since v23.1.0, v22.12.0 |
| `URLPattern` | v23.8.0 (`node:url`), global in v24.0.0 | (no flag) | 1 Experimental |
| Single executable applications | v19.7.0, v18.16.0 | (no flag) | 1.1 Active development |
| `util.parseArgs()` | v18.3.0, v16.17.0 | (no flag) | Stable since v20.0.0 |
| `fetch` | v17.5.0, v16.15.0 (`--experimental-fetch`) | v18.0.0 | Stable since v21.0.0 |
| `WebSocket` (client) | v21.0.0, v20.10.0 (`--experimental-websocket`) | v22.0.0 | Stable since v22.4.0 |

**How the flags reach your code.** CLI flags are parsed by the C++ side of Node before the JavaScript environment exists. Some act before any module loads: `--env-file` reads its files before the permission model starts, which is why the permission docs list it as not subject to permission rules. `--watch` does not run your script itself: it starts a supervisor process that spawns your script as a child (in a test run, the script's `process.ppid` was the PID of the `node --watch` process) and kills and respawns it when a watched file changes. `--test` spawns one child process per test file by default (test isolation `'process'`) and collects their results. `--run` does not start a JavaScript environment at all (`node --require ./pre.js --run build` never ran `pre.js`): it reads `package.json`, prepends every `node_modules/.bin` folder from the current directory up to the root to `PATH`, and hands the script string to the shell.

**How the globals are provided.** `fetch`, `Request`, `Response`, `Headers`, `FormData` and `WebSocket` come from **undici**, an HTTP/1.1 client written in JavaScript and bundled into Node (`process.versions.undici` is `7.29.0` on v24.19.0). They follow the WHATWG (browser) specifications, so a `fetch` response is a web `ReadableStream`, not a Node stream, and a `WebSocket` uses `addEventListener`, not `.on()`. Node ships only the WebSocket *client*; to accept WebSocket connections you still need a server library (the examples use `ws` 8.22.0).

**How the module rules changed.** Since v22.12.0 / v20.19.0 the CommonJS loader can load an ES module synchronously, as long as the ES module graph contains no top-level `await`. If it does, `require()` throws `ERR_REQUIRE_ASYNC_MODULE`, because a synchronous call cannot wait for a promise. For JSON, the ES module loader requires the attribute `with { type: 'json' }`. The attribute exists for safety: a file served as `.json` cannot then be run as JavaScript.

## Code examples

**Example 1 — `node --run`: run a `package.json` script without npm.**
*Added in:* v22.0.0. v22.3.0 added `NODE_RUN_SCRIPT_NAME`, `NODE_RUN_PACKAGE_JSON_PATH` and the walk up to the nearest `package.json`. The v24 docs show no experimental marker. `node --run` skips `pre`/`post` hooks and npm's `npm_*` environment variables on purpose; the docs list both under "Intentional limitations". That is part of why it starts faster than `npm run`.

json

```
{
  "name": "run-demo",
  "scripts": {
    "prebuild": "echo prebuild hook",
    "build": "echo building",
    "where": "node -p \"process.env.NODE_RUN_SCRIPT_NAME + ' in ' + require('node:path').basename(process.cwd())\""
  }
}
```

bash

```
# run from run-demo/packages/api, a subfolder with no package.json of its own
$ node --run build -- --minify
building --minify
$ npm run build -- --minify

> prebuild
> echo prebuild hook

prebuild hook

> build
> echo building --minify

building --minify
$ node --run where
where in run-demo
$ node --run nope
Missing script: "nope" for …/run-demo/package.json

Available scripts are:
  prebuild: echo prebuild hook
  build: echo building
  where: node -p "process.env.NODE_RUN_SCRIPT_NAME + ' in ' + require('node:path').basename(process.cwd())"
$ echo $?
1
```

Notice three things. The `prebuild` hook ran under npm but not under `node --run`. Arguments after `--` are appended to the script string. The script ran in `run-demo` (the folder holding `package.json`), not in the subfolder it was launched from.

**Example 2 — edge case: `node --test` finds `*.test.js` but not `*.spec.js`.**
*Added in:* v18.1.0, v16.17.0. Stable since v20.0.0. With no file arguments, `--test` looks for files matching `**/*.test.{cjs,mjs,js}`, `**/*-test.*`, `**/*_test.*`, `**/test-*.*`, `**/test.*` and `**/test/**/*.*`. TypeScript variants (`.ts`, `.mts`, `.cts`) are also matched unless you pass `--no-strip-types`. `*.spec.js` is **not** on that list.

javascript

```
// sum.js
exports.sum = (a, b) => a + b;
```

javascript

```
// sum.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sum } = require('./sum.js');

test('adds integers', () => {
  assert.equal(sum(2, 3), 5);
});

test('adds decimals', () => {
  assert.equal(sum(0.1, 0.2), 0.3); // fails: floating point
});
```

javascript

```
// sum.spec.js
require('node:test')('spec file test', () => {});
```

bash

```
$ node --test
✔ adds integers (1.454767ms)
✖ adds decimals (2.142786ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 132.382098

✖ failing tests:

test at sum.test.js:10:1
✖ adds decimals (2.142786ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 0.30000000000000004
  - 0.3
       ^
  
  …
$ echo $?
1
$ node --test "**/*.spec.js"
✔ spec file test (0.880726ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 77.895738
```

`sum.spec.js` never ran in the first command, and nothing warned about it. Quote the glob (`"**/*.spec.js"`) so that Node expands it, not the shell. A failing test makes the process exit with code 1, which is what CI checks. Durations differ on every run.

**Example 3 — edge case: `--watch` watches the module graph, `--watch-path` watches folders.**
*Added in:* v18.11.0, v16.19.0. Stable since v22.0.0, v20.13.0. `--watch` restarts when the entry file or any module it loaded with `require`/`import` changes. A file you read with `fs` is not in that graph, so editing it does not restart the process. `--watch-path` replaces graph tracking with the paths you give it. The v24.19.0 docs still say `--watch-path` is "only supported on macOS and Windows", but it worked on Linux in the run below. Recursive `fs.watch` gained Linux support in v19.1.0.

javascript

```
// app.js
const { readFileSync } = require('node:fs');
const msg = require('./src/msg.js');                          // in the module graph
const cfg = JSON.parse(readFileSync('config/settings.json')); // read with fs: not in the graph
console.log(`msg=${msg} level=${cfg.level}`);
```

javascript

```
// drive-watch.js: start node in watch mode, edit two files, print what it printed.
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

async function run(flags) {
  writeFileSync('src/msg.js', "module.exports = 'v1';\n");
  writeFileSync('config/settings.json', '{ "level": "info" }\n');
  console.log(`$ node ${flags.join(' ')} app.js`);
  const child = spawn(process.execPath, [...flags, 'app.js']);
  child.stdout.on('data', (d) => process.stdout.write(String(d).replaceAll(process.cwd(), '<cwd>')));
  await sleep(1000);
  for (const [file, text] of [['config/settings.json', '{ "level": "debug" }\n'],
                              ['src/msg.js', "module.exports = 'v2';\n"]]) {
    console.log(`  [driver] edited ${file}`);
    writeFileSync(file, text);
    await sleep(1000);
  }
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('close', resolve));
}

(async () => {
  await run(['--watch']);
  await run(['--watch-path=./src', '--watch-path=./config']);
})();

// Real output (Node v24.19.0), `node drive-watch.js`:
//   $ node --watch app.js
//   msg=v1 level=info
//   Completed running 'app.js'. Waiting for file changes before restarting...
//     [driver] edited config/settings.json
//     [driver] edited src/msg.js
//   Change detected in '<cwd>/src/msg.js'
//   Restarting 'app.js'
//   msg=v2 level=debug
//   Completed running 'app.js'. Waiting for file changes before restarting...
//   $ node --watch-path=./src --watch-path=./config app.js
//   msg=v1 level=info
//   Completed running 'app.js'. Waiting for file changes before restarting...
//     [driver] edited config/settings.json
//   Change detected in '<cwd>/config/settings.json'
//   Restarting 'app.js'
//   msg=v1 level=debug
//   Completed running 'app.js'. Waiting for file changes before restarting...
//     [driver] edited src/msg.js
//   Change detected in '<cwd>/src/msg.js'
//   Restarting 'app.js'
//   msg=v2 level=debug
//   Completed running 'app.js'. Waiting for file changes before restarting...
```

Under `--watch`, editing `config/settings.json` printed nothing. The new `level=debug` only showed up because the later edit to `src/msg.js` caused a restart. With the two `--watch-path` flags, each edit restarted the app. When output goes to a terminal, watch mode also clears the screen on restart; `--watch-preserve-output` turns that off. The driver replaces the working directory with `<cwd>`.

**Example 4 — `--env-file` and `process.loadEnvFile()`.**
*Added in:* `--env-file` v20.6.0 (multi-line values v21.7.0, v20.12.0), stable since v24.10.0. `process.loadEnvFile()` v21.7.0, v20.12.0, stable since v24.10.0. `--env-file-if-exists` v22.9.0, stable since v24.10.0. The parser understands `#` comments, quotes, `export` prefixes and multi-line quoted values.

bash

```
$ cat .env
# .env
PORT=3000
DB_URL="postgres://localhost/dev" # quotes are stripped, comment ignored
export LOG_LEVEL=debug
GREETING="line one
line two"
$ cat .env.local
PORT=4400
$ cat show.js
const { PORT, DB_URL, LOG_LEVEL, GREETING } = process.env;
console.log({ PORT, DB_URL, LOG_LEVEL, GREETING });
$ node --env-file=.env show.js
{
  PORT: '3000',
  DB_URL: 'postgres://localhost/dev',
  LOG_LEVEL: 'debug',
  GREETING: 'line one\nline two'
}
$ node --env-file=.env --env-file=.env.local show.js
{
  PORT: '4400',
  DB_URL: 'postgres://localhost/dev',
  LOG_LEVEL: 'debug',
  GREETING: 'line one\nline two'
}
$ PORT=9999 node --env-file=.env show.js
{
  PORT: '9999',
  DB_URL: 'postgres://localhost/dev',
  LOG_LEVEL: 'debug',
  GREETING: 'line one\nline two'
}
$ node --env-file=missing.env show.js
node: missing.env: not found
$ echo $?
9
$ node --env-file-if-exists=missing.env show.js
missing.env not found. Continuing without it.
{
  PORT: undefined,
  DB_URL: undefined,
  LOG_LEVEL: undefined,
  GREETING: undefined
}
```

Later `--env-file` files override earlier ones, but a variable that is already set in the real environment beats every file. `process.loadEnvFile()` does the same parsing from inside your code, so you can pick the file at run time. Like the flag, it never overwrites a variable that is already set:

javascript

```
// load.js
process.env.PORT = 'set-in-code';
process.loadEnvFile('.env');            // path defaults to './.env'
console.log(process.env.PORT, process.env.LOG_LEVEL);
console.log(require('node:util').parseEnv('A=1\nB="two" # c'));
try { process.loadEnvFile('nope.env'); } catch (e) { console.log(e.code); }

// Real output (Node v24.19.0):
//   set-in-code debug
//   { A: '1', B: 'two' }
//   ENOENT
```

`util.parseEnv()` (added v21.7.0, v20.12.0, stable since v24.10.0) parses the text and returns an object without touching `process.env`. Lesson 04 compares these loaders with the `dotenv` package: [The Global Object, process, and Environment](04-the-global-object-process-and-environment.md).

**Example 5 — the permission model: a real `ERR_ACCESS_DENIED`.**
*Added in:* v20.0.0 as `--experimental-permission` (on Node 20, `--permission` is rejected with `node: bad option: --permission`). Renamed `--permission` and marked **stable** in v23.5.0, v22.13.0 (`node@22.12.0 --permission` → `bad option`; `node@22.13.0` accepts both spellings; v24.19.0 rejects the old one with `node: bad option: --experimental-permission`). `--allow-fs-read` and `--allow-fs-write` are stable. `--allow-child-process`, `--allow-worker`, `--allow-addons` (v21.6.0) and `--allow-wasi` (v22.3.0) are 1.1 Active development, and `--allow-inspector` (v24.12.0) is 1.0 Early development. Since v24.2.0 the entry file is readable without a grant.

javascript

```
// app.js: try each capability the permission model controls
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');

function attempt(label, fn) {
  try { console.log(`${label}: ok -> ${fn()}`); }
  catch (err) { console.log(`${label}: ${err.code} (${err.permission}) ${err.resource ?? ''}`.trimEnd()); }
}

console.log('permission model on:', process.permission !== undefined);
attempt('read data/in.txt  ', () => fs.readFileSync('data/in.txt', 'utf8').trim());
attempt('write out/log.txt ', () => { fs.writeFileSync('out/log.txt', 'x'); return 'written'; });
attempt('read /etc/hostname', () => fs.readFileSync('/etc/hostname').length + ' bytes');
attempt('spawn child       ', () => execFileSync('echo', ['hi']).toString().trim());
attempt('start worker      ', () => { new Worker('0', { eval: true }).terminate(); return 'started'; });
console.log('has fs.write out/:', process.permission?.has('fs.write', 'out/'));
```

bash

```
$ node app.js
permission model on: false
read data/in.txt  : ok -> hello from data
write out/log.txt : ok -> written
read /etc/hostname: ok -> 16 bytes
spawn child       : ok -> hi
start worker      : ok -> started
has fs.write out/: undefined
$ node --permission app.js
permission model on: true
read data/in.txt  : ERR_ACCESS_DENIED (FileSystemRead) data/in.txt
write out/log.txt : ERR_ACCESS_DENIED (FileSystemWrite) out/log.txt
read /etc/hostname: ERR_ACCESS_DENIED (FileSystemRead) /etc/hostname
spawn child       : ERR_ACCESS_DENIED (ChildProcess) echo
start worker      : ERR_ACCESS_DENIED (WorkerThreads)
has fs.write out/: false
$ node --permission --allow-fs-read=./data --allow-fs-write=./out --allow-child-process app.js
permission model on: true
read data/in.txt  : ok -> hello from data
write out/log.txt : ok -> written
read /etc/hostname: ERR_ACCESS_DENIED (FileSystemRead) /etc/hostname
spawn child       : ok -> hi
start worker      : ERR_ACCESS_DENIED (WorkerThreads)
has fs.write out/: true
(node:100676) SecurityWarning: The flag --allow-child-process must be used with extreme caution. It could invalidate the permission model.
(Use `node --trace-warnings ...` to show where the warning was created)
```

Uncaught, the error carries the denied `permission` and `resource` (working directory shortened to `<cwd>`, stack trimmed):

bash

```
$ cat crash.js
// crash.js
require('node:fs').readFileSync('data/in.txt');
$ node --permission crash.js
node:fs:622
  return binding.open(
                 ^

Error: Access to this API has been restricted. Use --allow-fs-read to manage permissions.
    at Object.openSync (node:fs:622:18)
    at Object.readFileSync (node:fs:488:35)
    at Object.<anonymous> (<cwd>/crash.js:2:20)
    …
  code: 'ERR_ACCESS_DENIED',
  permission: 'FileSystemRead',
  resource: 'data/in.txt'
}

Node.js v24.19.0
$ echo $?
1
```

**Example 6 — edge case: `--permission` in v24 does not restrict the network.**
There is no `--allow-net` in v24.19.0 (`process.allowedNodeEnvironmentFlags.has('--allow-net')` printed `false`). A process with no grants can still listen on a port and make outgoing requests:

javascript

```
// net.js: what --permission does NOT restrict in v24
const fs = require('node:fs');
const http = require('node:http');

console.log('read own entry file:', fs.readFileSync(__filename).length > 0); // implicit since v24.2.0
try { fs.readFileSync('app.js'); } catch (err) { console.log('read app.js:', err.code); }

const server = http.createServer((req, res) => res.end('reached'));
server.listen(4402, async () => {
  const body = await (await fetch('http://localhost:4402/')).text();
  console.log('listen + fetch:', body);
  server.close();
});

// Real output (Node v24.19.0), `node --permission net.js`:
//   read own entry file: true
//   read app.js: ERR_ACCESS_DENIED
//   listen + fetch: reached
```

The docs call the permission model a "seat belt" for trusted code. Malicious code can get around it, for example through file descriptors that are already open, symbolic links, or `process._debugProcess()`.

**Example 7 — `node:sqlite`: an embedded database with no npm package.**
*Added in:* v22.5.0 behind `--experimental-sqlite`. Unflagged in v23.4.0, v22.13.0 (still experimental). **1.2 Release candidate** since v24.15.0. The module has no `sqlite:` alias; you must write the `node:` prefix. The API is synchronous: every call blocks the event loop until SQLite returns.

javascript

```
// db.js
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');   // or a file path such as 'app.db'
db.exec(`
  CREATE TABLE users (
    id    INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    age   INTEGER
  ) STRICT
`);

const insert = db.prepare('INSERT INTO users (email, age) VALUES (?, ?)');
console.log(insert.run('ada@example.com', 36));
console.log(insert.run('lin@example.com', 29));

const byAge = db.prepare('SELECT id, email FROM users WHERE age > :min ORDER BY id');
console.log(byAge.all({ min: 30 }));
console.log(db.prepare('SELECT count(*) AS n FROM users').get());

try { insert.run('ada@example.com', 50); }
catch (err) { console.log(err.code, err.errstr, '-', err.message); }
db.close();

// Real output (Node v24.19.0):
//   { changes: 1, lastInsertRowid: 1 }
//   { changes: 1, lastInsertRowid: 2 }
//   [ [Object: null prototype] { id: 1, email: 'ada@example.com' } ]
//   [Object: null prototype] { n: 2 }
//   ERR_SQLITE_ERROR constraint failed - UNIQUE constraint failed: users.email
```

Rows come back as null-prototype objects. `?` placeholders take positional arguments and `:name` placeholders take an object. Both are bound by SQLite, never concatenated into the SQL, so they are safe against SQL injection. No `ExperimentalWarning` was printed on v24.19.0.

**Example 8 — edge case: SQLite integers above 2^53.**
SQLite stores 64-bit integers; a JavaScript number is exact only up to 2^53 − 1. Node does not round silently. It throws, unless you ask for BigInts:

javascript

```
// big.js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE t (v INTEGER)');
db.prepare('INSERT INTO t VALUES (?)').run(9007199254740993n); // 2^53 + 1, passed as BigInt

const read = db.prepare('SELECT v FROM t');
try { console.log('default :', read.get()); }
catch (err) { console.log('default :', err.code, '-', err.message); }

read.setReadBigInts(true);
console.log('bigints :', read.get());

// Real output (Node v24.19.0):
//   default : ERR_OUT_OF_RANGE - Value is too large to be represented as a JavaScript number: 9007199254740993
//   bigints : [Object: null prototype] { v: 9007199254740993n }
```

**Example 9 — `require(esm)`: CommonJS loading an ES module.**
*Added in:* v22.0.0, v20.17.0 behind `--experimental-require-module`. Unflagged in v23.0.0, v22.12.0, v20.19.0. The warning was dropped in v23.5.0, v22.13.0, v20.19.0, and the feature is **stable** since v24.15.0 (the opt-out flag is now `--no-require-module`). `require()` returns the module **namespace object**, so a default export sits under `.default`. An ES module can choose what `require()` returns by exporting a name called `'module.exports'`.

javascript

```
// math.mjs: an ES module
export const add = (a, b) => a + b;
export default function mul(a, b) { return a * b; }
```

javascript

```
// interop.mjs: chooses what require() returns
export default class Logger {}
export { Logger as 'module.exports' };
```

javascript

```
// tla.mjs: uses top-level await
const config = await Promise.resolve({ ready: true });
export default config;
```

javascript

```
// main.cjs: a CommonJS file requiring ES modules
const math = require('./math.mjs');
console.log(math);
console.log(math.add(2, 3), math.default(2, 3));

console.log(require('./interop.mjs'));

try { require('./tla.mjs'); }
catch (err) { console.log(err.code, '-', err.message.split('\n')[0]); }

// Real output (Node v24.19.0):
//   [Module: null prototype] {
//     __esModule: true,
//     add: [Function: add],
//     default: [Function: mul]
//   }
//   5 6
//   [class Logger]
//   ERR_REQUIRE_ASYNC_MODULE - require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.
```

The same `main.cjs` on Node 22.11.0 (`npx -y node@22.11.0 main.cjs`) stops at the first line with `Error [ERR_REQUIRE_ESM]: require() of ES Module …/math.mjs not supported.` A library that ships ESM only works for CommonJS users on v22.12.0 and later, so it should say so in `engines`.

**Example 10 — import attributes for JSON.**
*Added in:* v17.1.0, v16.14.0 as import *assertions* (`assert { type: 'json' }`). Switched to import *attributes* (`with { type: 'json' }`) in v21.0.0, v20.10.0, v18.20.0. JSON modules are stable since v23.1.0, v22.12.0.

javascript

```
// ok.mjs
import pkg from './pkg.json' with { type: 'json' };
const again = await import('./pkg.json', { with: { type: 'json' } });
console.log(pkg.version, again.default === pkg);

// Real output (Node v24.19.0), pkg.json = { "name": "demo", "version": "1.2.3" }:
//   1.2.3 true
```

javascript

```
// missing.mjs: forget the attribute
try { await import('./pkg.json'); }
catch (err) { console.log(err.code, '-', err.message.replace(/file:\/\/\S+\//, '')); }

// Real output (Node v24.19.0):
//   ERR_IMPORT_ATTRIBUTE_MISSING - Module "pkg.json" needs an import attribute of "type: json"
```

**Example 11 — edge case: JSON gives only a default export, and `assert` is gone.**

bash

```
$ cat named.mjs
import { version } from './pkg.json' with { type: 'json' };
console.log(version);
$ node named.mjs
file://<cwd>/named.mjs:1
import { version } from './pkg.json' with { type: 'json' };
         ^^^^^^^
SyntaxError: The requested module './pkg.json' does not provide an export named 'version'
    …
$ cat old.mjs
import pkg from './pkg.json' assert { type: 'json' };
console.log(pkg.name);
$ node old.mjs
file://<cwd>/old.mjs:1
import pkg from './pkg.json' assert { type: 'json' };
                             ^^^^^^

SyntaxError: Unexpected identifier 'assert'
```

Bundlers such as webpack allow named imports from JSON; Node does not. Code copied from a bundled front-end project fails here. Import the default and destructure it: `const { version } = pkg;`.

**Example 12 — `URLPattern`: match URLs against route patterns.**
*Added in:* v23.8.0 as `require('node:url').URLPattern`; a **global** since v24.0.0. Stability **1 Experimental**. `node -p "typeof URLPattern"` printed `function` on v24.19.0, and no warning was printed. Inside a pattern, `:name` is a named group, `(regex)` after it constrains what the group matches, `?` makes a group optional and `*` matches anything.

javascript

```
// up.mjs
const route = new URLPattern({ pathname: '/users/:id(\\d+)/posts/:slug?' });

console.log(route.test('https://api.example.com/users/42/posts/hello'));
const m = route.exec('https://api.example.com/users/42/posts/hello');
console.log(m.pathname.groups);
console.log(route.exec({ pathname: '/users/42/posts' })?.pathname.groups);
console.log(route.test({ pathname: '/users/abc/posts' }));

// Real output (Node v24.19.0):
//   true
//   { slug: 'hello', id: '42' }
//   { slug: undefined, id: '42' }
//   false
```

**Example 13 — edge case: a string pattern needs a base URL, and the base pins the host.**

bash

```
$ node -e "
try { new URLPattern('/users/:id'); } catch (e) { console.log(e.name, '-', e.message); }
const p = new URLPattern('/users/:id', 'https://x.test');
console.log(p.protocol, p.hostname, p.pathname);
console.log(p.test('http://other.test/users/1'), p.test('https://x.test/users/1'));
console.log(new URLPattern({ pathname: '/users/:id' }).test('http://other.test/users/1'));
"
TypeError - Failed to construct URLPattern
https x.test /users/:id
false true
true
```

With the object form, every component you leave out (protocol, host, port, search) matches anything. With the string-plus-base form, those components are copied from the base, so the pattern rejects other hosts.

**Example 14 — Single executable application (SEA): one binary, no Node install needed.**
*Added in:* v19.7.0, v18.16.0. Stability **1.1 Active development**. The `node:sea` APIs (`isSea`, `getAsset`, `getAssetAsBlob`, `getRawAsset`) were added in v21.7.0, v20.12.0, and `getAssetKeys` in v24.8.0. How it works: (1) Node serialises your single CommonJS script and its assets into a *preparation blob*; (2) you copy the `node` binary; (3) postject writes the blob into the copy as a resource named `NODE_SEA_BLOB` (an ELF note on Linux, a PE resource on Windows, a Mach-O segment on macOS) and flips a sentinel string, the *fuse*, from `…:0` to `…:1` (`grep -ac NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1 hello` printed `1`); (4) at start-up Node sees the flipped fuse and runs the embedded script instead of reading its command line. Built and run here with postject 1.0.0-alpha.6, under `~/.cache` because `/tmp` on the test machine is mounted `noexec`.

javascript

```
// hello.js: the app that goes inside the executable (CommonJS, one file)
const { isSea, getAsset } = require('node:sea');
console.log(`Hello, ${process.argv[2]}!`);
console.log('isSea:', isSea());
console.log('asset:', getAsset('greeting.txt', 'utf8').trim());
```

json

```
{
  "main": "hello.js",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "assets": { "greeting.txt": "greeting.txt" }
}
```

bash

```
$ cat build.sh
npm install --save-dev postject@1.0.0-alpha.6 --silent
node --experimental-sea-config sea-config.json
cp "$(command -v node)" hello
npx postject hello NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 2>&1 \
  | grep -v "Can't find string offset" | sed 's/\x1b\[[0-9;]*m//g'
$ bash build.sh
Wrote single executable preparation blob to sea-prep.blob
Start injection of NODE_SEA_BLOB in hello...
💉 Injection done!
$ ./hello world
Hello, world!
isSea: true
asset: embedded at build time
$ ls -lh hello sea-prep.blob | awk '{print $5, $9}'
121M hello
354 sea-prep.blob
$ node hello.js world
Hello, world!
isSea: false
node:sea:27
    throw new ERR_NOT_IN_SINGLE_EXECUTABLE_APPLICATION();
    ^
…
```

On Linux, postject prints a block of `warning: Can't find string offset for section name '.note…'` lines; `build.sh` filters them out, and the binary works anyway. The executable is the whole Node binary plus a 354-byte blob, which is why it is 121 MB. On macOS you must also pass `--macho-segment-name NODE_SEA` and re-sign with `codesign`; on Windows the copy must end in `.exe`.

> ⚠️ Unverified: the macOS (`codesign --remove-signature`, `--macho-segment-name NODE_SEA`, `codesign --sign -`) and Windows (`hello.exe`, `signtool`) steps come from the v24 SEA docs; only Linux x64 was available to run them.

**Example 15 — edge case: inside a SEA, `require()` only loads built-in modules.**

javascript

```
// app2.js: require() inside a SEA only knows built-in modules
console.log('built-in:', typeof require('node:os').cpus);
try { require('./helper.js'); }
catch (err) { console.log(err.code, '-', err.message); }

const { createRequire } = require('node:module');
const fileRequire = createRequire(__filename);   // a normal, file-based require
console.log('createRequire:', fileRequire('./helper.js'));

// Real output (Node v24.19.0), built as ./app2 with helper.js (module.exports = 42) next to it:
//   built-in: function
//   ERR_UNKNOWN_BUILTIN_MODULE - No such built-in module: ./helper.js
//   createRequire: 42
```

The SEA runs exactly one script. Bundle your code first (esbuild, Rollup, webpack) so that the single file contains every dependency, or load files from disk on purpose with `createRequire`.

**Example 16 — `util.parseArgs()`: flags without yargs or commander.**
*Added in:* v18.3.0, v16.17.0. Stable since v20.0.0. `default` values were added in v18.11.0, `tokens` in v18.7.0, and `allowNegative` (`--no-color`) in v22.4.0, v20.16.0. It reads `process.argv.slice(2)` by default. The only types are `'string'` and `'boolean'`, so numbers arrive as strings.

javascript

```
// cli.js
const { parseArgs } = require('node:util');

const options = {
  port:    { type: 'string', short: 'p', default: '3000' },
  verbose: { type: 'boolean', short: 'v' },
  color:   { type: 'boolean', default: true },
  tag:     { type: 'string', multiple: true },
};

try {
  const { values, positionals } = parseArgs({ options, allowPositionals: true, allowNegative: true });
  console.log(values, positionals);
} catch (err) {
  console.error(`${err.code}: ${err.message}`);
  process.exitCode = 2;
}
```

bash

```
$ node cli.js serve -p 8080 -v --tag a --tag b
[Object: null prototype] {
  port: '8080',
  verbose: true,
  tag: [ 'a', 'b' ],
  color: true
} [ 'serve' ]
$ node cli.js --no-color build
[Object: null prototype] { color: false, port: '3000' } [ 'build' ]
$ node cli.js --port=1 -- --verbose
[Object: null prototype] { port: '1', color: true } [ '--verbose' ]
$ node cli.js --prot 8080
ERR_PARSE_ARGS_UNKNOWN_OPTION: Unknown option '--prot'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- "--prot"
$ echo $?
2
$ node cli.js --port
ERR_PARSE_ARGS_INVALID_OPTION_VALUE: Option '-p, --port <value>' argument missing
```

`strict` is `true` by default, so a typo such as `--prot` throws instead of being ignored. Everything after `--` is a positional.

**Example 17 — the `fetch` and `WebSocket` globals against a local server.**
*Added in:* `fetch` v17.5.0, v16.15.0 behind `--experimental-fetch`, unflagged in v18.0.0, stable since v21.0.0. `WebSocket` v21.0.0, v20.10.0 behind `--experimental-websocket`, unflagged in v22.0.0, stable since v22.4.0. The server side uses `ws` 8.22.0, because Node has no built-in WebSocket server.

javascript

```
// client.mjs: global fetch + global WebSocket against a local server (port 4401)
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';           // server side only; the client is built in

const server = createServer((req, res) => {
  if (req.url === '/api/user') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ id: 1, name: 'Ada' }));
  }
  res.statusCode = 404;
  res.end('not found');
});
new WebSocketServer({ server }).on('connection', (sock) => {
  sock.on('message', (data) => sock.send(`echo: ${data}`));
});
await new Promise((resolve) => server.listen(4401, resolve));

// 1. fetch
const res = await fetch('http://localhost:4401/api/user');
console.log(res.status, res.headers.get('content-type'), await res.json());

const missing = await fetch('http://localhost:4401/nope');
console.log('404 resolves, ok =', missing.ok, '| body:', await missing.text());

// 2. WebSocket (browser-style API: events, not Node streams)
const ws = new WebSocket('ws://localhost:4401');
ws.addEventListener('open', () => ws.send('hello'));
const reply = await new Promise((resolve) => ws.addEventListener('message', (e) => resolve(e.data)));
console.log('ws reply:', reply);
ws.close();

// 3. connection refused: fetch rejects, the reason is on err.cause
try { await fetch('http://localhost:4499/'); }
catch (err) { console.log(err.name, err.message, '| cause:', err.cause.code); }

server.close();

// Real output (Node v24.19.0), `npm install ws@8.22.0` then `node client.mjs`:
//   200 application/json { id: 1, name: 'Ada' }
//   404 resolves, ok = false | body: not found
//   ws reply: echo: hello
//   TypeError fetch failed | cause: ECONNREFUSED
```

Two edge cases are in that output. A 404 **resolves**: `fetch` rejects only when no HTTP response arrives at all, so you must check `res.ok` or `res.status` yourself. And when it does reject, the message is always the generic `fetch failed`; the real reason (`ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_SOCKET`) is on `err.cause`.

## Common mistakes & gotchas

- **Expecting `node --run` to behave like `npm run`.** It does not run `pre`/`post` hooks and does not set `npm_package_*` or other `npm_*` variables. A `prestart` that builds assets is silently skipped.
- **Naming tests `*.spec.js` and running bare `node --test`.** Zero spec files run and nothing warns you. Pass a quoted glob or rename the files.
- **Expecting `--watch` to see files read with `fs`.** Config, templates and `.env` files are not in the module graph. Add `--watch-path` for them, and remember that `--watch-path` turns graph tracking off, so list your source folder too.
- **Assuming `--env-file` overrides the shell.** A variable already set in the environment (by Docker, CI or your shell profile) wins over the file, and `process.loadEnvFile()` never overwrites one either.
- **Treating `--permission` as a sandbox.** It is a seat belt for trusted code: it has no network scope in v24, and it does not cover symlink escapes or file descriptors that are already open. Use OS isolation (containers, separate users) for untrusted code.
- **`require()` of an ESM package that uses top-level `await`.** You get `ERR_REQUIRE_ASYNC_MODULE` even on v24. Use `await import()` instead.
- **Reading `.default` off the wrong thing.** `require('./esm.mjs')` returns the namespace object; the default export is `.default`, unless the module exports `'module.exports'`.
- **Copying `assert { type: 'json' }` from old tutorials.** It is a `SyntaxError` now; write `with`.
- **Building a SEA from an unbundled project.** `require('./x')` inside the binary throws `ERR_UNKNOWN_BUILTIN_MODULE`. Bundle first.
- **Treating a non-2xx `fetch` response as an exception.** It is not one. Check `res.ok`.
- **Parsing numbers with `parseArgs`.** There is no number type; `values.port` is `'8080'`. Convert it and validate it.

## Best practices

- **Read the History table before relying on a feature.** It tells you the minimum version, and that version belongs in `engines.node` (for example `>=22.12.0` for an ESM-only package that CommonJS users will `require()`).
- **Prefer the stable features in production:** `--test`, `--watch` (dev only), `--env-file`, `parseArgs`, `fetch`, `WebSocket`, `require(esm)` and the fs permission flags. Pin exact Node versions when you use `node:sqlite` (release candidate), `URLPattern` (experimental) or SEA (active development).
- **Use `node --run` for hot dev loops and `npm run` when you need hooks.** Keep `npm run` in CI scripts that depend on `pre`/`post` hooks.
- **Grant permissions narrowly:** `--allow-fs-read=./config --allow-fs-write=./logs`, not `=*`. Check grants at run time with `process.permission.has()` so you can fail with a clear message.
- **Validate after loading the environment.** `--env-file` only puts strings into `process.env`; parse them into a typed config object at start-up (lesson 04 shows this with zod).
- **Wrap `fetch` once.** Write one helper that checks `res.ok`, sets a timeout with `AbortSignal.timeout(ms)` and logs `err.cause`, and use it everywhere.
- **Bundle before you build a SEA,** and build the blob with the same Node binary you inject it into: the docs require the versions to match.

## ⭐ Interview lens

> **Q: “Which npm packages can modern Node replace, and from which version?”**  
> A: `npm run` → `node --run` (v22), Jest/Mocha for simple suites → `node --test` (stable v20), nodemon → `--watch` (stable v22.0.0/v20.13.0), dotenv → `--env-file`/`process.loadEnvFile` (stable v24.10.0), yargs/commander → `util.parseArgs` (stable v20), node-fetch/axios → global `fetch` (unflagged v18, stable v21), the `ws` client → global `WebSocket` (stable v22.4.0), better-sqlite3 → `node:sqlite` (release candidate in v24.15.0). *Trap:* claiming they are drop-in replacements. `node --run` has no hooks, and Node has no WebSocket server.

> **Q: “What does `--permission` restrict, and is it a security boundary?”**  
> A: In v24 it restricts fs reads and writes, child processes, worker threads, native addons, WASI and the inspector, each re-opened with an `--allow-*` flag. A violation throws `ERR_ACCESS_DENIED` with `permission` and `resource` properties. It is not a sandbox: the docs call it a seat belt for trusted code, it has no network scope in v24, and symlinks and open file descriptors can get around it. *Trap:* saying it isolates untrusted plugins.

> **Q: “Can CommonJS `require()` an ES module now?”**  
> A: Yes. Since v22.12.0 / v20.19.0 it works without a flag, and it is stable since v24.15.0. The module is loaded synchronously and `require` returns its namespace object, with the default export under `.default` unless the module exports `'module.exports'`. It fails with `ERR_REQUIRE_ASYNC_MODULE` if the graph uses top-level await, because a synchronous call cannot wait for a promise.

> **Q: “Why does `fetch` not throw on a 500?”**  
> A: It follows the WHATWG spec: the promise rejects only on network failure (no response). Any HTTP response, including 4xx and 5xx, resolves with `ok === false`. On rejection the message is the generic `fetch failed`, and the real reason is on `err.cause`.

> **Q: “How does a Node single executable application work?”**  
> A: `node --experimental-sea-config` serialises one CommonJS script plus its assets into a blob. postject injects that blob into a copy of the `node` binary as a new section and flips a sentinel fuse string. At start-up Node finds the flipped fuse and runs the embedded script. Only built-in modules can be `require`d inside it, so you bundle first. The feature is 1.1 Active development in v24.

## Cheat-card

- **`node --run <script> -- args`:** runs a `package.json` script without npm; no pre/post hooks; walks up to the nearest `package.json` (v22.3.0).
- **`node --test`:** default globs are `*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*`, `test/**`. `*.spec.js` is not included, so quote your own glob.
- **`--watch`:** watches the module graph only. **`--watch-path=dir`:** watches given paths and turns graph tracking off.
- **`--env-file`:** later files override earlier ones; the real environment beats every file; missing file → exit 9. `--env-file-if-exists` skips a missing file.
- **`process.loadEnvFile(path)`:** never overwrites a variable that is already set; `util.parseEnv(text)` only parses.
- **`--permission` + `--allow-fs-read/-write`** (stable), `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`; violation → `ERR_ACCESS_DENIED`; no network scope in v24.
- **`node:sqlite`:** `DatabaseSync`, `prepare().run/get/all`, synchronous, release candidate; `setReadBigInts(true)` for values above 2^53.
- **`require(esm)`:** stable v24.15.0; returns the namespace; top-level await → `ERR_REQUIRE_ASYNC_MODULE`.
- **JSON import:** `with { type: 'json' }`, default export only; `assert` is a SyntaxError.
- **`URLPattern`:** global since v24.0.0, experimental; object form wildcards the parts you leave out.
- **SEA:** blob + postject + fuse; one CommonJS file; bundle first.
- **`util.parseArgs`:** string/boolean only; strict by default; `allowNegative` for `--no-x`.
- **`fetch`:** resolves on 404/500; rejects with `fetch failed` + `err.cause`. **`WebSocket`:** client only, event-target API.

---

## Learn More

- [Command-line API (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/cli.html)
- [Stability index nodejs.org](https://nodejs.org/docs/latest-v24.x/api/documentation.html)
- [Permissions nodejs.org](https://nodejs.org/docs/latest-v24.x/api/permissions.html)
- [Test runner nodejs.org](https://nodejs.org/docs/latest-v24.x/api/test.html)
- [SQLite nodejs.org](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Modules: CommonJS modules (loading ECMAScript modules using require()) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/modules.html)
- [Modules: ECMAScript modules (import attributes) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/esm.html)
- [URL (URLPattern) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/url.html)
- [Single executable applications nodejs.org](https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
- [Util (parseArgs, parseEnv) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/util.html)
- [Global objects (fetch, WebSocket) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/globals.html)
- [postject github.com](https://github.com/nodejs/postject)
- [ws github.com](https://github.com/websockets/ws)
