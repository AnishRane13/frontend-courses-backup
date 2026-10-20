---
title: "Bun and Deno Compared with Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Bun and Deno Compared with Node

*30 min read · Updated 12 Oct 2026 · Topic 117 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0, Bun 1.4.3 and Deno 2.9.7 (official Linux x64 release binaries, SHA-256 checked), Express 5.3.0, autocannon 8.0.0

---

## Why it matters

Node is no longer the only server-side JavaScript runtime that can run npm packages. **Bun** and **Deno** both run most Node code, both ship a test runner and a package manager in the same binary, and both run TypeScript files directly. Sooner or later someone on your team will ask "should we switch?". Answering it needs facts that are easy to get wrong:

- **"It runs on Bun" can mean "the server starts".** In this lesson the same Express 5 app answered all four test requests identically on all three runtimes, but Deno refused to even load Express until the process was given environment access, and Bun silently ignored a `Worker` memory limit.
- **The runtimes report misleading versions.** Bun 1.4.3 says `process.version` is `v26.3.0` and `process.versions.v8` is `14.6.202.34-node.20`, although its engine is JavaScriptCore, not V8.
- **The tools collide.** `bun test`, `deno test` and `node --test` each picked up the other runtimes' test files in the same folder and failed on them.
- **Benchmarks need care.** The benchmark in this lesson, run on a laptop shared with other jobs, put the three runtimes in three different orders across its five rounds.

## The concept, simply

All three are programs that embed a JavaScript engine and add what the engine lacks: files, sockets, timers, processes, a module loader. They differ in which engine they embed, which language the runtime layer is written in, how much of Node's API they copy, and what they bundle into the one binary.

text

```
                 Node v24.19.0              Bun 1.4.3                     Deno 2.9.7
 engine          V8 13.6                    JavaScriptCore (WebKit)       V8 15.0
 runtime layer   C++ and JS, libuv          Rust (Zig until May 2026)     Rust, Tokio
 Node APIs       the reference              own implementation; its       compatibility layer,
                                            status page tracks Node v26   node: specifiers
 npm packages    npm (separate CLI)         bun install / bun add         npm: specifiers or package.json
 TypeScript      strips types (no enums)    transpiles; bun check         transpiles; deno check
 tests           node --test                bun test (Jest-style)         deno test
 fmt / lint      none built in              none built in                 deno fmt, deno lint
 bundler         none built in              bun build                     deno bundle
 permissions     opt-in: --permission       none                          on by default: --allow-*
```

The rows come from each binary's `--help`, `process.versions` and the projects' own documentation. Each one is checked by an example below.

## How it works

1. **The engine runs your JavaScript.** Node and Deno embed V8, the engine from Chrome. Bun embeds JavaScriptCore, the engine from Safari; its docs say "Bun is powered by the JavaScriptCore engine, which is developed by Apple for Safari". The engine compiles and optimises your code and runs the garbage collector, so the same program can use memory and CPU differently on the two engines.
2. **The runtime layer provides I/O.** Node's is C++ plus JavaScript on top of libuv ([lesson 07](07-libuv-the-thread-pool.md)). The Deno README says Deno is "built on V8, Rust, and Tokio" (Tokio is Rust's async I/O library). Bun was written in Zig until the pull request "Rewrite Bun in Rust" (#30412) was merged on 2026-05-14. The last release before it was v1.3.14 (2026-05-13); v1.4.0 (2026-08-20) was the first release after it. The Bun README now says "It's written in Rust and powered by JavaScriptCore". Bun 1.4.3 still lists a `zig` entry in `process.versions` (Example 2).
3. **Each runtime provides its own version of Node's APIs.** Bun implements each module and publishes a per-module status page that "reflects the latest version of Bun's compatibility with Node.js v26". It marks `node:fs` and `node:http` 🟢 "Fully implemented", and `node:worker_threads`, `node:crypto`, `node:v8` and `node:inspector` 🟡 partial, with the gaps listed. Deno "provides Node's built-in APIs through a compatibility layer" that you import with the `node:` prefix. Both runtimes report a Node version in `process.version` (`v26.3.0`, `v26.5.1`), not their own version.
4. **npm packages come from the npm registry either way.** Bun reads `package.json`, installs into `node_modules` and writes `bun.lock`. Deno resolves `npm:express@5.3.0` specifiers (directly in an import, or through an `imports` map in `deno.json`) into its own cache (`DENO_DIR`), or from `package.json` dependencies (the Deno docs list npm packages as "Supported, via npm: specifiers or package.json").
5. **TypeScript is handled at load time.** Node v24.19.0 strips type annotations and rejects syntax that needs code generation, such as `enum` (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`; [lesson 95](95-typescript-with-node.md)). Bun and Deno transpile TypeScript fully. None of the three type-checks when it *runs* a file: a type error still runs. Type checking is a separate command (`tsc`, `bun check`, `deno check`), although `deno test` type-checks local modules before running them (Example 7).
6. **Permissions differ by default.** A Node or Bun process can read any file, open any socket and read every environment variable that the OS user can. Node can be restricted with `--permission` ([lesson 96](96-modern-node-features-tour.md)). Deno starts with no access: the security docs say "you must explicitly grant access to these resources with command line flags or with a runtime permission prompt", and a refused operation throws `NotCapable` (Examples 4 and 10).

**Event loops: only what is documented.** Node's event loop is libuv's ([lesson 06](06-the-event-loop-phases.md)). Deno's I/O is built on Tokio. The Bun pages checked for this lesson do not describe Bun's event-loop design. They do list behaviour that differs from Node, for example: "`backup()` runs synchronously and blocks the event loop for the duration of the copy (Node runs it on a worker thread)" (`node:sqlite`). Microtask and timer ordering in [lessons 08–09](08-processnexttick-vs-setimmediate.md) was verified on Node only; do not assume it carries over.

**What "Node-compatible" means in practice.** Packages fail on another runtime for a few recurring reasons:

- **A gap in a Node module.** It is listed on the runtime's compatibility page (Bun: `crypto.encapsulate` missing, `Worker` `resourceLimits` ignored, `http.Server` not a `net.Server`). Example 5 hit all three.
- **Native addons** (`.node` files). Bun has a Node-API documentation page, and Deno's security docs say `--allow-ffi` "loads native libraries through FFI or Node-API addons". Whether a given addon works was not tested here; check each one you depend on.
- **Assumptions about the host.** `process.version` checks, `process.versions.v8`-based feature detection, V8 flags (`v8.setFlagsFromString` is ignored by Bun, per its docs), heap snapshots that tools expect in V8's format.
- **Permissions (Deno only).** A dependency that reads `process.env` or the filesystem at import time fails under a tight grant (Example 4).

**Built-in tooling, side by side.** Checked against each binary's `--help` (Node v24.19.0, Bun 1.4.3, Deno 2.9.7):

| Job | Node | Bun | Deno |
|---|---|---|---|
| Run a TS file | `node app.ts` (type stripping; `--experimental-transform-types` for `enum`) | `bun app.ts` | `deno run app.ts` |
| Type check | `tsc` (separate package) | `bun check` (reads `tsconfig.json`) | `deno check` |
| Tests | `node --test` (`node:test`) | `bun test` (`bun:test`, Jest-style `expect`) | `deno test` (`Deno.test`) |
| Package manager | npm, pnpm, Yarn (separate tools) | `bun install`, `bun add`, `bun remove`, `bun audit` | `deno install`, `deno add`, `deno remove`, `deno audit` |
| Bundler | none (esbuild, Rollup…) | `bun build` | `deno bundle` |
| Formatter / linter | none (Prettier, ESLint…) | none in `bun --help` | `deno fmt`, `deno lint` |
| Single executable | SEA ([lesson 96](96-modern-node-features-tour.md)) | `bun build --compile` | `deno compile` |
| Watch mode | `node --watch` | `bun --watch`, `bun --hot` | `deno run --watch`, `deno watch` |

**When switching is and is not worth it.** A decision guide, with the reasons taken from the runs in this lesson:

| Situation | Suggestion | Why |
|---|---|---|
| Large production Express/Nest app, native addons, APM agents, V8 heap tooling | Stay on Node | Every agent, profiler and addon targets Node first; a gap shows up in production, not in a quick test (Example 5). |
| You need a supported LTS line and long patch windows | Stay on Node | Node 24 is Active LTS until 2026-10-20 and Node 26 becomes LTS on 2026-10-28; check each runtime's own support policy before you commit. |
| Scripts, CLIs, internal tools written in TypeScript | Bun or Deno are worth trying | Both run `.ts` with enums and other transforms with no build step; Deno adds fmt/lint/check in the same binary. |
| Running code you do not fully trust (plugins, generated code, CI helpers) | Deno, or Node with `--permission` | Deno denies by default and names the missing grant; Node's model must be switched on. Neither is a full sandbox for hostile code. |
| Slow installs or test runs in CI | Try `bun install` / `bun test` while keeping Node for production | The tools can be adopted one at a time; `bun build --target=node` output ran on Node in Example 8. |
| "It is faster" | Measure your own app first | Example 11 shows how noisy a comparison is on a shared machine; a hello-world route is not your workload. |
| Greenfield service with few dependencies and a team that wants one tool | Bun or Deno are reasonable | Fewer moving parts (one binary for run, test, install), if every dependency passes your tests on that runtime. |

## Code examples

The runs below used a throwaway `HOME` and `DENO_DIR` so nothing was written to the real home directory; you do not need that on your own machine. `NO_COLOR=1` keeps colour codes out of the transcripts. Absolute paths in error messages are shortened to `<cwd>`.

**Example 1 — download the official binaries and check their SHA-256 sums.** Bun publishes `SHASUMS256.txt` (plus a GPG signature, `SHASUMS256.txt.asc`, which was not checked here); Deno publishes a `.sha256sum` file per archive. No install script was used, so no shell rc file was edited.

bash

```
$ mkdir -p bin dl && cd dl
$ curl -LO https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-x64.zip
$ curl -LO https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/SHASUMS256.txt
$ curl -LO https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip
$ curl -LO https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-unknown-linux-gnu.zip.sha256sum
$ grep ' bun-linux-x64.zip$' SHASUMS256.txt | sha256sum -c -
bun-linux-x64.zip: OK
$ sha256sum -c deno-x86_64-unknown-linux-gnu.zip.sha256sum
deno-x86_64-unknown-linux-gnu.zip: OK
$ unzip -j bun-linux-x64.zip bun-linux-x64/bun -d ../bin && unzip deno-x86_64-unknown-linux-gnu.zip -d ../bin
Archive:  bun-linux-x64.zip
  inflating: ../bin/bun              
Archive:  deno-x86_64-unknown-linux-gnu.zip
  inflating: ../bin/deno             
$ cd .. && export PATH="$PWD/bin:$PATH" NO_COLOR=1
$ bun --revision
1.4.3+c6da4a4d3
$ deno --version
deno 2.9.7 (stable, release, x86_64-unknown-linux-gnu)
v8 15.0.245.2-rusty
typescript 6.0.3
```

The downloads here used `curl -sL -C -` (resume) because the connection was slow; the checksum lines are what matters. At 12 Oct 2026 these were the latest releases (GitHub `releases/latest`: `bun-v1.4.3` published 2026-10-10, `v2.9.7` published 2026-09-17).

**Example 2 — what each runtime says about itself.**

javascript

```
// versions.mjs — what each runtime says about itself
const v = process.versions;
const runtime = globalThis.Bun ? 'bun' : globalThis.Deno ? 'deno' : 'node';
console.log(runtime.padEnd(5), JSON.stringify({
  'process.version': process.version, v8: v.v8, uv: v.uv, webkit: v.webkit?.slice(0, 10),
  zig: v.zig?.slice(0, 10), typescript: v.typescript, icu: v.icu,
}));
```

bash

```
$ node versions.mjs
node  {"process.version":"v24.19.0","v8":"13.6.233.17-node.51","uv":"1.52.1","icu":"78.3"}
$ bun versions.mjs
bun   {"process.version":"v26.3.0","v8":"14.6.202.34-node.20","uv":"1.48.0","webkit":"0c06faadf6","zig":"04e7f6ac1e","typescript":"7.0.2","icu":"78.3"}
$ deno run versions.mjs
deno  {"process.version":"v26.5.1","v8":"15.0.245.2-rusty","uv":"1.52.1","typescript":"6.0.3","icu":"78.3"}
```

- Bun reports `v26.3.0` and a `v8` string although its engine is JavaScriptCore (the `webkit` entry). Do not detect the engine or the runtime from `process.version` or `process.versions.v8`; check `globalThis.Bun` / `globalThis.Deno`, or `process.versions.bun` / `process.versions.deno`.
- Bun 1.4.3 still lists a `zig` entry after the Rust rewrite; the binary's own metadata is not documentation.
- Deno's `v8` entry is its real engine (`15.0.245.2-rusty`, the same string `deno --version` prints, next to `typescript 6.0.3`). Bun lists `typescript 7.0.2`. Deno and Node both list `uv 1.52.1`, and Bun `uv 1.48.0`; these entries alone do not tell you how either runtime does its I/O.

**Example 3 — the same Express 5 app on node, bun and deno.** One `server.mjs`, unchanged. It uses `express.json()`, `node:fs/promises`, `node:crypto` and an async route that throws (Express 5 forwards the rejection to the error handler, [lesson 50](50-error-handling-the-4-arg-handler-and-async-errors.md)).

javascript

```
// server.mjs — one Express 5 app, run unchanged under node, bun and deno
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';

const runtime = globalThis.Bun ? `bun ${Bun.version}` : globalThis.Deno ? `deno ${Deno.version.deno}` : `node ${process.version}`;
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.json({ runtime, hello: 'world' }));
app.post('/echo', (req, res) => res.status(201).json({ got: req.body ?? null, id: randomUUID().length }));
app.get('/hash', async (req, res) => {
  const text = await readFile(new URL('./data.txt', import.meta.url), 'utf8');
  res.json({ sha256: createHash('sha256').update(text).digest('hex').slice(0, 16) });
});
app.get('/boom', async () => { throw new Error('async failure'); }); // Express 5 forwards this
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const port = Number(process.env.PORT ?? 7550);
app.listen(port, () => console.log(`${runtime} listening on ${port}`));
```

javascript

```
// client.mjs — the same four requests against whichever server is on PORT (run with node)
const base = `http://127.0.0.1:${process.env.PORT ?? 7550}`;
const show = async (label, res) => console.log(label.padEnd(10), res.status, await res.text());
await show('GET /', await fetch(`${base}/`));
await show('POST /echo', await fetch(`${base}/echo`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 1 }) }));
await show('GET /hash', await fetch(`${base}/hash`));
await show('GET /boom', await fetch(`${base}/boom`));
```

`serve.sh` starts a server, waits for its first log line, runs the client with Node, then stops the server:

bash

```
#!/bin/bash
# serve.sh PORT CMD... — start the server command, wait for its first log line,
# send the four client requests with node, then stop the server
port=$1; shift
log=$(mktemp)
PORT=$port "$@" > "$log" 2>&1 & pid=$!
for _ in $(seq 1 600); do [ -s "$log" ] && break; sleep 0.1; done
head -n 1 "$log"
PORT=$port node client.mjs
kill "$pid"; wait "$pid" 2>/dev/null; rm -f "$log"
```

For Node and Bun, Express comes from `npm install express@5.3.0` (`node_modules`). For Deno, a `deno.json` next to the same `server.mjs` maps the bare specifier `express` to an `npm:` specifier, and `deno install` fetched it into `DENO_DIR`:

json

```
{
  "imports": {
    "express": "npm:express@5.3.0"
  }
}
```

bash

```
$ ./serve.sh 7551 node server.mjs
node v24.19.0 listening on 7551
GET /      200 {"runtime":"node v24.19.0","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  200 {"sha256":"4fd7704830bea1c3"}
GET /boom  500 {"error":"async failure"}
$ ./serve.sh 7552 bun server.mjs
bun 1.4.3 listening on 7552
GET /      200 {"runtime":"bun 1.4.3","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  200 {"sha256":"4fd7704830bea1c3"}
GET /boom  500 {"error":"async failure"}
$ ./serve.sh 7553 deno run --allow-net --allow-read --allow-env server.mjs
deno 2.9.7 listening on 7553
GET /      200 {"runtime":"deno 2.9.7","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  200 {"sha256":"4fd7704830bea1c3"}
GET /boom  500 {"error":"async failure"}
```

All three gave the same status codes and bodies, including the `500` from the async throw and the same SHA-256 of the file read through `node:fs/promises`.

**Example 4 — edge case: Deno permissions meet a real npm dependency.** Start with no flags, then try to grant only what the app seems to need.

bash

```
$ deno run server.mjs 2>&1 | grep -E 'NotCapable|inspectOpts|npm/registry'
error: Uncaught (in promise) NotCapable: Requires env access, run again with the --allow-env flag
exports.inspectOpts = Object.keys(process.env).filter(key => {
    at Object.<anonymous> (file://$DENO_DIR/npm/registry.npmjs.org/debug/4.4.3/src/node.js:124:30)
$ ./serve.sh 7554 deno run --allow-env=PORT --allow-net server.mjs 2>&1 | head -1
error: Uncaught (in promise) NotCapable: Requires env access, run again with the --allow-env flag
$ ./serve.sh 7555 deno run --allow-env --allow-net=0.0.0.0:7555 --allow-read=./data.txt server.mjs 2>&1 | head -1
error: Uncaught (in promise) NotCapable: Requires net access to "[::]:7555", run again with the --allow-net flag
$ ./serve.sh 7556 deno run --allow-env --allow-net=[::]:7556 --allow-read=./data.txt server.mjs
deno 2.9.7 listening on 7556
GET /      200 {"runtime":"deno 2.9.7","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  200 {"sha256":"4fd7704830bea1c3"}
GET /boom  500 {"error":"async failure"}
$ ./serve.sh 7557 deno run --allow-env --allow-net server.mjs
deno 2.9.7 listening on 7557
GET /      200 {"runtime":"deno 2.9.7","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  500 {"error":"Requires read access to \"<cwd>/data.txt\", run again with the --allow-read flag"}
GET /boom  500 {"error":"async failure"}
```

1. With no flags, Deno stopped while *importing* Express: the `debug` package (Express 5.3.0 depends on `debug` `^4.4.0`; here 4.4.3) calls `Object.keys(process.env)` at load time. The app's own code never ran.
2. `--allow-env=PORT` was not enough for the same reason: listing every key needs access to all of them.
3. `app.listen(port)` with no host binds `[::]` (all IPv6 and, on this machine, IPv4 addresses), so a grant for `0.0.0.0:7555` was refused. `--allow-net=[::]:7556` worked. (In the failing runs the client then printed `ECONNREFUSED`; `head -1` hides it.)
4. Without `--allow-read`, the app started and three routes worked, but `/hash` returned the `NotCapable` message through Express's error handler. A permission problem can hide in one route until a user hits it.

**Example 5 — `node:` built-ins under the three runtimes.**

javascript

```
// node-apis.mjs — a few node: built-ins, each in its own try so one failure does not hide the rest
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const check = async (name, fn) => {
  try { console.log('ok  ', name.padEnd(22), await fn()); }
  catch (e) { console.log('FAIL', name.padEnd(22), `${e.code ?? e.name}: ${e.message.split('\n')[0]}`); }
};

await check('fs/promises', async () => {
  const { writeFile, readFile, rm } = await import('node:fs/promises');
  const f = join(tmpdir(), `rt-${process.pid}.txt`);
  await writeFile(f, 'héllo');
  const back = await readFile(f, 'utf8');
  await rm(f);
  return back;
});
await check('crypto hash+scrypt', async () => {
  const { createHash, scryptSync } = await import('node:crypto');
  return createHash('sha256').update('abc').digest('hex').slice(0, 12) + ' ' +
    scryptSync('pw', 'salt', 16).toString('hex').slice(0, 12);
});
await check('worker_threads', async () => {
  const { Worker } = await import('node:worker_threads');
  const w = new Worker('const { parentPort, workerData } = require("node:worker_threads"); parentPort.postMessage(workerData * 2);',
    { eval: true, workerData: 21 });
  return await new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
});
await check('AsyncLocalStorage', async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  const als = new AsyncLocalStorage();
  return await als.run({ id: 7 }, async () => { await new Promise((r) => setTimeout(r, 5)); return als.getStore().id; });
});
await check('zlib gzip', async () => {
  const { gzipSync, gunzipSync } = await import('node:zlib');
  return gunzipSync(gzipSync('x'.repeat(1000))).length;
});
await check('child_process', async () => {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('echo', ['hi']).toString().trim();
});
await check('node:sqlite', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return db.prepare('select 1 + 1 as two').get().two;
});
await check('v8.getHeapStatistics', async () => {
  const v8 = await import('node:v8');
  return typeof v8.getHeapStatistics().used_heap_size;
});
await check('node:test', async () => typeof (await import('node:test')).test);
await check('inspector Session', async () => {
  const { Session } = await import('node:inspector');
  const s = new Session(); s.connect(); s.disconnect(); return 'connected';
});
// details the compatibility pages document as different
await check('http.Server is net.Server', async () => {
  const http = await import('node:http');
  const net = await import('node:net');
  return http.createServer() instanceof net.Server;
});
await check('crypto.encapsulate', async () => typeof (await import('node:crypto')).encapsulate);
await check('process.versions.v8', async () => process.versions.v8);
await check('Worker resourceLimits', async () => {
  const { Worker } = await import('node:worker_threads');
  const src = 'const wt = require("node:worker_threads"); wt.parentPort.postMessage(wt.resourceLimits.maxOldGenerationSizeMb);';
  const w = new Worker(src, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 32 } });
  return await new Promise((resolve, reject) => { w.once('message', resolve); w.once('error', reject); });
});
```

bash

```
$ node node-apis.mjs
ok   fs/promises            héllo
ok   crypto hash+scrypt     ba7816bf8f01 c0b515908e61
ok   worker_threads         42
ok   AsyncLocalStorage      7
ok   zlib gzip              1000
ok   child_process          hi
ok   node:sqlite            2
ok   v8.getHeapStatistics   number
ok   node:test              function
ok   inspector Session      connected
ok   http.Server is net.Server true
ok   crypto.encapsulate     function
ok   process.versions.v8    13.6.233.17-node.51
ok   Worker resourceLimits  32
$ bun node-apis.mjs
ok   fs/promises            héllo
ok   crypto hash+scrypt     ba7816bf8f01 c0b515908e61
ok   worker_threads         42
ok   AsyncLocalStorage      7
ok   zlib gzip              1000
ok   child_process          hi
ok   node:sqlite            2
ok   v8.getHeapStatistics   number
ok   node:test              function
ok   inspector Session      connected
ok   http.Server is net.Server false
ok   crypto.encapsulate     undefined
ok   process.versions.v8    14.6.202.34-node.20
ok   Worker resourceLimits  undefined
$ deno run -A node-apis.mjs
ok   fs/promises            héllo
ok   crypto hash+scrypt     ba7816bf8f01 c0b515908e61
ok   worker_threads         42
ok   AsyncLocalStorage      7
ok   zlib gzip              1000
ok   child_process          hi
ok   node:sqlite            2
ok   v8.getHeapStatistics   number
ok   node:test              function
ok   inspector Session      connected
ok   http.Server is net.Server true
ok   crypto.encapsulate     undefined
ok   process.versions.v8    15.0.245.2-rusty
ok   Worker resourceLimits  32
```

Everything in the first block worked on all three, including `worker_threads` with `eval: true`, `AsyncLocalStorage` across an `await`, `child_process` and `node:sqlite`. The last four lines show the gaps the compatibility pages document, and one more found here:

- Bun: `http.Server` is not an `instanceof net.Server` (documented), `crypto.encapsulate` is missing (documented), and the worker saw `resourceLimits.maxOldGenerationSizeMb` as `undefined` because Bun ignores `resourceLimits` (documented). No error was thrown in any of these cases.
- Deno: `crypto.encapsulate` is also `undefined` in Deno 2.9.7. Node v24.19.0 has it.
- `deno run -A` grants everything; it is used here only so the API checks are not mixed up with permission errors.

**Example 6 — TypeScript: run, strip, transform, check.**

typescript

```
// sum.ts — plain type annotations only
export interface Line { label: string; cents: number }
export function total(lines: Line[]): number {
  return lines.reduce((acc: number, l: Line) => acc + l.cents, 0);
}
```

typescript

```
// main.ts — imports a .ts file and uses an enum (needs a real transform, not just type stripping)
import { total, type Line } from './sum.ts';
enum Currency { EUR = 'EUR', USD = 'USD' }
const lines: Line[] = [{ label: 'a', cents: 250 }, { label: 'b', cents: 199 }];
console.log(total(lines), Currency.EUR);
```

typescript

```
// bad.ts — a type error: runtimes that only strip types still run it
const cents: number = 'twelve';
console.log('ran anyway:', cents);
```

bash

```
$ node main.ts 2>&1 | grep ERR_
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
  code: 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX'
$ bun main.ts
449 EUR
$ deno run main.ts
449 EUR
$ node bad.ts
ran anyway: twelve
$ bun bad.ts
ran anyway: twelve
$ deno run bad.ts
ran anyway: twelve
$ deno check bad.ts
Check bad.ts
TS2322 [ERROR]: Type 'string' is not assignable to type 'number'.
const cents: number = 'twelve';
      ~~~~~
    at file://<cwd>/bad.ts:2:7

error: Type checking failed.
$ bun check bad.ts | head -9
<error file="bad.ts" line="2" column="7" code="TS2322">
Type 'string' is not assignable to type 'number'.
<source>
1 | // bad.ts — a type error: runtimes that only strip types still run it
2 | const cents: number = 'twelve';
          ^^^^^
3 | console.log('ran anyway:', cents);
</source>
</error>
note: Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun
Found 2 errors in 1 file, checked 1 file [9.40ms]
```

Node strips types and refuses `enum`; Bun and Deno transform it. All three ran `bad.ts` even though it has a type error. `bun check` and `deno check` reported the same TS2322 error. `bun check` also reported `Cannot find name 'console'` (its block is cut off by `head`; the `note:` and `Found` lines come from stderr, which `head` does not filter) and suggested `bun add -d @types/bun`, because Bun's type definitions were not installed in the folder.

**Example 7 — a real `bun test` and `deno test` run, with `node --test` for comparison.** Each file tests `sum.ts` from Example 6 in its runner's own style.

typescript

```
// sum.bun.test.ts — bun test (Jest-style API from "bun:test")
import { describe, test, expect } from 'bun:test';
import { total } from './sum.ts';

describe('total', () => {
  test('adds cents', () => {
    expect(total([{ label: 'a', cents: 250 }, { label: 'b', cents: 199 }])).toBe(449);
  });
  test('empty list is 0', () => {
    expect(total([])).toBe(0);
  });
});
```

typescript

```
// sum_test.ts — deno test (Deno.test, assertions from node:assert)
import assert from 'node:assert/strict';
import { total } from './sum.ts';

Deno.test('total adds cents', () => {
  assert.equal(total([{ label: 'a', cents: 250 }, { label: 'b', cents: 199 }]), 449);
});
Deno.test('total of an empty list is 0', () => {
  assert.equal(total([]), 0);
});
```

typescript

```
// sum.node.test.ts — node --test (node:test), for comparison
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total } from './sum.ts';

test('total adds cents', () => {
  assert.equal(total([{ label: 'a', cents: 250 }, { label: 'b', cents: 199 }]), 449);
});
test('total of an empty list is 0', () => {
  assert.equal(total([]), 0);
});
```

bash

```
$ bun test ./sum.bun.test.ts
bun test v1.4.3 (c6da4a4d3)

 2 pass
 0 fail
 2 expect() calls
Ran 2 tests across 1 file. [3.00ms]
$ deno test sum_test.ts
running 2 tests from ./sum_test.ts
total adds cents ... ok (397µs)
total of an empty list is 0 ... ok (56µs)

ok | 2 passed | 0 failed (6ms)
$ node --test sum.node.test.ts
✔ total adds cents (0.808576ms)
✔ total of an empty list is 0 (0.187346ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 103.514181
```

`deno test` "type-checks local modules by default" (`deno test --help`). In a fresh copy of the folder the first run printed `Check sum_test.ts` before `running 2 tests`; a second run there, like the run above, printed no `Check` line, so Deno reuses an earlier check of an unchanged file. `bun test` takes a path filter; the `./` makes Bun treat it as a path. Durations change on every run.

**Example 8 — edge case: three test runners in one folder.** Run each runner with no arguments in the same `ts/` directory:

bash

```
$ bun test 2>&1 | grep -E 'Deno is not defined|pass|fail|Ran'
ReferenceError: Deno is not defined
      at <cwd>/sum_test.ts:5:1
 4 pass
 1 fail
Ran 5 tests across 3 files. [19.00ms]
$ deno test 2>&1 | grep -E 'running|ok \||error:|bun:test'
running 2 tests from ./sum.node.test.ts
running 2 tests from ./sum_test.ts
ok | 4 passed | 0 failed (87ms)
error: Unsupported scheme "bun" for module "bun:test". Supported schemes:
$ node --test 2>&1 | grep -E 'Received protocol|Deno is not defined|^✖|ℹ (pass|fail)'
Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. Received protocol 'bun:'
✖ sum.bun.test.ts (98.115106ms)
ReferenceError: Deno is not defined
✖ sum_test.ts (98.63107ms)
ℹ pass 2
ℹ fail 2
✖ failing tests:
✖ sum.bun.test.ts (98.115106ms)
✖ sum_test.ts (98.63107ms)
```

Each runner's default file pattern matched the other runtimes' files (`*.test.ts` and `*_test.ts` both count), and each failed on the other runtime's API: `bun:test` is not a valid scheme for Deno or Node, and `Deno` is not defined in Bun or Node. `bun test` also ran the `node:test` file and passed it. Keep one runner per project, or give each runner an explicit path or pattern.

**Example 9 — Bun as bundler and package manager for a Node app.** `bun build --target=node` bundles the Express app into one file that Node runs:

bash

```
$ bun build ./server.mjs --target=node --outfile=dist/server.mjs
Bundled 138 modules in 14ms

  server.mjs  0.87 MB  (entry point)
$ cp data.txt client.mjs serve.sh dist/ && cd dist
$ ./serve.sh 7558 node server.mjs
node v24.19.0 listening on 7558
GET /      200 {"runtime":"node v24.19.0","hello":"world"}
POST /echo 201 {"got":{"a":1},"id":36}
GET /hash  200 {"sha256":"4fd7704830bea1c3"}
GET /boom  500 {"error":"async failure"}
```

And `bun add` in an empty project (output from the first run; a second run in a fresh folder, with Bun's cache already filled, printed `[61]` and `[1.83s]` on those two lines):

bash

```
$ printf '{ "name": "bun-install-demo", "type": "module" }\n' > package.json
$ bun add express@5.3.0
bun add v1.4.3 (c6da4a4d3)
Resolving dependencies
Resolved, downloaded and extracted [260]
Saved lockfile

installed express@5.3.0

65 packages installed [5.18s]
$ head -9 bun.lock
{
  "lockfileVersion": 2,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "bun-install-demo",
      "dependencies": {
        "express": "5.3.0",
      },
```

`bun.lock` is a text file (with trailing commas), not `package-lock.json`. A team that mixes `npm install` and `bun install` ends up with two lockfiles that can resolve different versions; pick one per project.

**Example 10 — permissions: Deno `--allow-*`, Node `--permission`, and Bun.**

javascript

```
// perm.mjs — read one allowed file, one file outside the grant, and an env var
import { readFile } from 'node:fs/promises';

const attempt = async (label, fn) => {
  try { console.log('allowed', label, '->', `${(await fn()).length} chars`); }
  catch (e) { console.log('denied ', label, '->', e.code ?? e.name, '|', e.message.split('\n')[0]); }
};
await attempt('read ./data.txt', () => readFile(new URL('./data.txt', import.meta.url), 'utf8'));
await attempt('read /etc/hostname', () => readFile('/etc/hostname', 'utf8'));
await attempt('env HOME', async () => String(process.env.HOME));
```

bash

```
$ deno run perm.mjs
denied  read ./data.txt -> NotCapable | Requires read access to "<cwd>/data.txt", run again with the --allow-read flag
denied  read /etc/hostname -> NotCapable | Requires read access to "/etc/hostname", run again with the --allow-read flag
denied  env HOME -> NotCapable | Requires env access to "HOME", run again with the --allow-env flag
$ deno run --allow-read=./data.txt --allow-env=HOME perm.mjs
allowed read ./data.txt -> 32 chars
denied  read /etc/hostname -> NotCapable | Requires read access to "/etc/hostname", run again with the --allow-read flag
allowed env HOME -> 55 chars
$ deno run --allow-read --deny-read=/etc --allow-env=HOME perm.mjs
allowed read ./data.txt -> 32 chars
denied  read /etc/hostname -> NotCapable | Requires read access to "/etc/hostname", run again with the --allow-read flag
allowed env HOME -> 55 chars
$ node --permission --allow-fs-read=./data.txt perm.mjs
allowed read ./data.txt -> 32 chars
denied  read /etc/hostname -> ERR_ACCESS_DENIED | Access to this API has been restricted. Use --allow-fs-read to manage permissions.
allowed env HOME -> 55 chars
$ bun perm.mjs
allowed read ./data.txt -> 32 chars
allowed read /etc/hostname -> 16 chars
allowed env HOME -> 55 chars
```

- Deno with no flags denied all three, with the exact flag to add. Standard input was not a terminal, so Deno did not show its interactive prompt (`Allow? [y/n/A]`, per the security docs).
- `--deny-read=/etc` overrides a broad `--allow-read` ("`--deny-*` flags override their `--allow-*` counterparts").
- Node's `--permission` blocked the file read with `ERR_ACCESS_DENIED` but did not restrict environment variables, which Node's permission model does not cover. Lesson 96 shows its other flags (`--allow-fs-write`, `--allow-child-process`, `--allow-worker`).
- Bun has no permission flags in `bun --help` (1.4.3), so everything was allowed.
- Neither model is a sandbox for hostile code. Deno's docs ask you to read their security notes "before using Deno to run completely untrusted code", warn that `--allow-run` and `--allow-ffi` are "effectively granting full access" (a subprocess or native library is not bound by Deno's checks), and `-A` turns the checks off.

**Example 11 — a benchmark, run here, and why it ranks nothing.** autocannon 8.0.0 (run with Node v24.19.0 on the same machine) against `GET /` of the Example 3 app. Method: 50 connections; per runtime and round, start a fresh server, 3 s warm-up (discarded), then 10 s measured; 5 rounds, interleaved node → bun → deno so that background load hits all three. Machine: Intel Core i5-1135G7 (4 cores, 8 threads), 14 GiB RAM, Ubuntu 26.04. **Other jobs, including other writers' builds and tests, were running on the same machine**; the load average went from 4.60 to 19.66 during the run.

javascript

```
// bench.mjs — autocannon 8.0.0 against the same Express app on node, bun and deno
// Rounds are interleaved (node, bun, deno, node, bun, deno, …) so background load hits all three.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import autocannon from 'autocannon';

const B = process.env.BIN; // directory with the downloaded bun and deno binaries
const APP = process.env.APP; // directory with server.mjs
const runtimes = {
  node: ['node', ['server.mjs'], APP],
  bun: [`${B}/bun`, ['server.mjs'], APP],
  deno: [`${B}/deno`, ['run', '--allow-net', '--allow-read', '--allow-env', 'server.mjs'], `${APP}/../deno-app`],
};
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const results = { node: [], bun: [], deno: [] };

for (let round = 1; round <= ROUNDS; round++) {
  for (const [name, [cmd, args, cwd]] of Object.entries(runtimes)) {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PORT: '7560' }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve) => child.stdout.once('data', resolve)); // "… listening on 7560"
    await autocannon({ url: 'http://127.0.0.1:7560/', connections: 50, duration: 3 }); // warm-up, discarded
    const r = await autocannon({ url: 'http://127.0.0.1:7560/', connections: 50, duration: 10 });
    results[name].push({ rps: Math.round(r.requests.average), p99: r.latency.p99, errors: r.errors + r.non2xx });
    console.log(`round ${round} ${name.padEnd(4)} req/s avg ${Math.round(r.requests.average)}  latency p50 ${r.latency.p50} ms p99 ${r.latency.p99} ms  errors+non2xx ${r.errors + r.non2xx}`);
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await sleep(1000);
  }
}
for (const [name, rs] of Object.entries(results)) {
  const rps = rs.map((r) => r.rps).sort((a, b) => a - b);
  console.log(`${name.padEnd(4)} median req/s ${rps[Math.floor(rps.length / 2)]}  (runs: ${rs.map((r) => r.rps).join(', ')})`);
}
```

text

```
$ uptime
 23:47:05 up  7:58,  1 user,  load average: 4.60, 6.42, 6.41
$ BIN=$PWD/../bin APP=$PWD/../app ROUNDS=5 node bench.mjs
round 1 node req/s avg 2845  latency p50 3 ms p99 98 ms  errors+non2xx 0
round 1 bun  req/s avg 999  latency p50 41 ms p99 147 ms  errors+non2xx 0
round 1 deno req/s avg 10125  latency p50 2 ms p99 88 ms  errors+non2xx 0
round 2 node req/s avg 20053  latency p50 2 ms p99 4 ms  errors+non2xx 0
round 2 bun  req/s avg 30241  latency p50 1 ms p99 4 ms  errors+non2xx 0
round 2 deno req/s avg 16929  latency p50 2 ms p99 8 ms  errors+non2xx 0
round 3 node req/s avg 15140  latency p50 3 ms p99 7 ms  errors+non2xx 0
round 3 bun  req/s avg 26689  latency p50 1 ms p99 4 ms  errors+non2xx 0
round 3 deno req/s avg 14849  latency p50 2 ms p99 10 ms  errors+non2xx 0
round 4 node req/s avg 14862  latency p50 3 ms p99 6 ms  errors+non2xx 0
round 4 bun  req/s avg 15015  latency p50 2 ms p99 11 ms  errors+non2xx 0
round 4 deno req/s avg 7476  latency p50 3 ms p99 110 ms  errors+non2xx 0
(node:2398549) TimeoutNegativeWarning: -78 is a negative number.
Timeout duration was set to 1.
(Use `node --trace-warnings ...` to show where the warning was created)
round 5 node req/s avg 82  latency p50 280 ms p99 6730 ms  errors+non2xx 1
round 5 bun  req/s avg 7859  latency p50 1 ms p99 25 ms  errors+non2xx 0
round 5 deno req/s avg 17662  latency p50 2 ms p99 8 ms  errors+non2xx 0
node median req/s 14862  (runs: 2845, 20053, 15140, 14862, 82)
bun  median req/s 15015  (runs: 999, 30241, 26689, 15015, 7859)
deno median req/s 14849  (runs: 10125, 16929, 14849, 7476, 17662)
$ uptime
 23:50:59 up  8:02,  1 user,  load average: 19.66, 10.85, 7.96
```

What it shows: the same runtime varied between rounds by a factor of about 2.4 (deno: 7,476 to 17,662), 30 (bun: 999 to 30,241) and 240 (node: 82 to 20,053; its round 5 collapsed to 82 req/s with one error while the load average rose). The medians (14,862 / 15,015 / 14,849 req/s) are within about 1% of each other. Deno was fastest in rounds 1 and 5, Bun in rounds 2–4, and each runtime was slowest in at least one round. On this machine, at this time, the run cannot rank the runtimes for this app. (The `TimeoutNegativeWarning` came from autocannon's own timers under load.) A useful comparison needs an otherwise idle machine, the client on separate hardware, many more rounds and your own routes, not a hello-world handler.

## Common mistakes & gotchas

- **Treating "the server starts" as compatibility.** Run your whole test suite on the new runtime. Example 5's gaps returned values without throwing.
- **Detecting the runtime from `process.version` or `process.versions.v8`.** Bun reports Node `v26.3.0` and a V8 string. Check `globalThis.Bun`, `globalThis.Deno` or `process.versions.bun`/`.deno`.
- **Relying on `Worker` `resourceLimits` in Bun.** They are ignored (`undefined` inside the worker); a runaway worker is not capped.
- **Granting Deno permissions per variable or per address too narrowly.** Dependencies may enumerate all of `process.env` at import, and `listen(port)` binds `[::]`, not `0.0.0.0` (Example 4).
- **Hiding a missing permission behind an error handler.** A `NotCapable` in one route becomes a `500` only when that route is hit; test every route under the production flags.
- **Using `-A` in production "to make it work".** That removes the reason to use Deno's model.
- **Mixed test files in one folder.** Each runner picks up the others' files (Example 8).
- **Two lockfiles.** `bun.lock` and `package-lock.json` (or `deno.lock`) drift; CI should use the same one as production.
- **Assuming the runtime type-checks.** `node`, `bun` and `deno run` all ran a file with a type error. Add `tsc`, `bun check` or `deno check` to CI.
- **Node-only tooling.** APM agents, `--inspect` workflows, `clinic`/0x ([lesson 10](10-blocking-the-event-loop.md)) and heap-snapshot tools are built for V8 and Node; check each one before switching.
- **Trusting a quick benchmark.** Example 11 on a shared laptop varied by up to 240× per runtime. Publish method and machine with any number, or publish none.

## Best practices

- **Decide per workload, not per company.** Production services with heavy dependencies usually stay on Node; scripts, tools and greenfield services are where Bun or Deno are easiest to adopt.
- **Adopt tools before runtimes.** `bun install`, `bun test` or `deno fmt`/`deno lint` can be used while production still runs on Node; switch the runtime only after your tests pass on it.
- **Run CI on every runtime you claim to support,** with the exact versions you deploy (record them: Node v24.19.0, Bun 1.4.3, Deno 2.9.7 here).
- **Pin and verify binaries.** Download a fixed release and check its SHA-256 (Example 1) instead of piping an install script to a shell.
- **In Deno, grant the narrowest flags that pass your tests** (`--allow-read=./data`, `--allow-net=[::]:8080`, `--deny-*` for carve-outs) and keep them in a `deno task` or in `deno.json` permissions so they are reviewed like code.
- **In Node, consider `--permission`** for processes that do not need the whole filesystem ([lesson 96](96-modern-node-features-tour.md)).
- **Keep runtime-specific code behind a small adapter** (`Bun.serve`, `Deno.serve`, `bun:sqlite`) so the rest of the app stays portable.
- **Benchmark your own app** on idle, dedicated machines, several runs, interleaved, with the load generator elsewhere ([lesson 109](109-load-testing-and-profiling.md)).

## ⭐ Interview lens

> **Q: “What are the main architectural differences between Node, Bun and Deno?”**  
> A: Engine and runtime layer. Node embeds V8 and does I/O through libuv, with its core written in C++ and JavaScript. Deno embeds V8 too, but its runtime is Rust on Tokio, with permissions on by default and fmt/lint/test/check built in. Bun embeds JavaScriptCore (Safari's engine) and was written in Zig until its Rust rewrite was merged in May 2026; it bundles a package manager, test runner and bundler. Both Bun and Deno provide Node's APIs through their own implementations and report a Node version (v26.x) in `process.version`. *Trap:* reading `process.versions.v8` under Bun: it prints a V8 version although the engine is JavaScriptCore.

> **Q: “Can I run my Express app on Bun or Deno?”**  
> A: Often, yes: in this lesson the same Express 5.3.0 app returned identical responses on all three. But check three things: the runtime's compatibility page for the Node modules you use (Bun ignores `Worker` `resourceLimits` silently), native addons and Node-specific tooling such as APM agents, and in Deno, permissions: Express's `debug` dependency needed `--allow-env` just to load. Run the full test suite on the target runtime, not just a smoke test.

> **Q: “How does Deno's permission model compare with Node's?”**  
> A: Deno denies file, network, environment, subprocess and FFI access by default; you grant it with `--allow-read=…`, `--allow-net=host:port`, `--allow-env=VAR` and so on, and `--deny-*` carves out exceptions. A refused operation throws `NotCapable`, naming the flag. Node's model is opt-in with `--permission` plus `--allow-fs-read/-write`, `--allow-child-process`, `--allow-worker`; it throws `ERR_ACCESS_DENIED`, and it does not cover environment variables. Bun has none. Neither is a sandbox for hostile code.

> **Q: “Bun is faster, so should we switch?”**  
> A: Measure first, on your app and on quiet hardware. In this lesson's run on a shared laptop, the medians for a hello-world Express route were within about 1% of each other and individual rounds varied by up to 240×, so no ranking was possible. Even a real speed-up has to be weighed against compatibility gaps, tooling (APM, profilers), team familiarity and support windows. Adopting `bun install` or `bun test` alone is a lower-risk first step.

## Cheat-card

- **Versions here:** Node v24.19.0 (V8 13.6), Bun 1.4.3 (JavaScriptCore, reports Node v26.3.0), Deno 2.9.7 (V8 15.0, TypeScript 6.0.3, reports Node v26.5.1).
- **Architecture:** Node = V8 + libuv + C++/JS; Deno = V8 + Rust + Tokio; Bun = JavaScriptCore + Rust (Zig until PR #30412, merged 2026-05-14; first release after it v1.4.0).
- **Detect runtime:** `globalThis.Bun`, `globalThis.Deno`, `process.versions.bun`/`.deno`, never `process.versions.v8`.
- **npm in Deno:** `import express from 'npm:express@5.3.0'` or `deno.json` `"imports": { "express": "npm:express@5.3.0" }`; `deno install` fills `DENO_DIR`.
- **Deno flags:** `--allow-read[=paths]`, `--allow-write`, `--allow-net[=host:port]`, `--allow-env[=VARS]`, `--allow-sys`, `--allow-run`, `--allow-ffi`, `--allow-import`, matching `--deny-*`, `-A`; error `NotCapable`; `--allow-run`/`--allow-ffi` escape the sandbox.
- **Node flags:** `--permission --allow-fs-read=… --allow-fs-write=…`; error `ERR_ACCESS_DENIED`; env not covered.
- **Tests:** `bun test ./file` (`bun:test`), `deno test file` (`Deno.test`, type-checks first), `node --test file`; default patterns overlap.
- **TS:** `node` strips (no `enum`); `bun`/`deno run` transform; none type-checks on run; `bun check`, `deno check`, `tsc`.
- **Tools:** Bun = install/add/test/build/check; Deno = install/add/test/fmt/lint/check/bundle/compile.
- **Known Bun gaps hit here:** `http.Server` not `net.Server`, no `crypto.encapsulate`, `Worker` `resourceLimits` ignored.
- **Benchmarks:** only your own, with method, machine and load stated.

---

## Learn More

- [Bun documentation bun.com](https://bun.com/docs)
- [Node.js compatibility (Bun) bun.com](https://bun.com/docs/runtime/nodejs-compat)
- [Test runner (Bun) bun.com](https://bun.com/docs/test)
- [Bundler (Bun) bun.com](https://bun.com/docs/bundler)
- [Rewrite Bun in Rust, PR #30412 github.com](https://github.com/oven-sh/bun/pull/30412)
- [Deno runtime manual docs.deno.com](https://docs.deno.com/runtime/)
- [Security and permissions (Deno) docs.deno.com](https://docs.deno.com/runtime/fundamentals/security/)
- [Node and npm compatibility (Deno) docs.deno.com](https://docs.deno.com/runtime/fundamentals/node/)
- [deno test reference docs.deno.com](https://docs.deno.com/runtime/reference/cli/test/)
- [Permissions (Node.js v24 docs) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/permissions.html)
- [Modules: TypeScript (Node.js v24 docs) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
