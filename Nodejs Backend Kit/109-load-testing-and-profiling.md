---
title: "Load Testing and Profiling"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Load Testing and Profiling

*18 min read · Updated 12 Oct 2026 · Topic 114 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, autocannon 8.0.0, k6 v2.3.0 (official release binary), 0x 6.0.0

---

## Why it matters

A service that answers one request in 2 ms on your laptop can still fall over in production. Under load, requests queue behind each other, one slow path that fires for 2% of requests sets the latency most users feel, and a function that costs 4 ms per call caps a whole process at a few hundred requests per second. None of that shows up when you click through the app by hand.

Load testing answers "how does this behave with N requests per second, or N users at once?" Profiling answers "where does the time go while it does that?" Together they replace guessing with a loop: generate load, read the percentiles, profile the hot path, change one thing, measure again. This lesson runs that loop on a local Express 5 app with **autocannon** (a Node load generator) and **k6** (a load-testing tool from Grafana Labs, scripted in JavaScript), and finds the bottleneck with `--cpu-prof` and a 0x flame graph.

## The concept, simply

A load test sends many requests and records how long each one took. The result is not one number but a **distribution**, which you read through **percentiles**:

- **p50 (median):** half the requests were faster than this.
- **p99:** 99% were faster; 1 in 100 was slower.
- **max:** the single slowest request.

The **mean** (average) mixes everything together and hides the tail. If 98% of requests take 1 ms and 2% take 200 ms, the mean is about 5 ms, which looks fine, but 1 request in 50 waits 200 ms. A page that makes 20 API calls hits the slow path at least once on about a third of page loads (1 − 0.98²⁰ ≈ 0.33). That is why latency goals (SLOs) are written as percentiles: "p99 under 100 ms".

Load generators come in two models:

- **Closed model:** a fixed number of connections or virtual users (VUs). Each sends a request, waits for the response, then sends the next. autocannon's `-c 50` works like this. When the server slows down, the tool sends fewer requests.
- **Open model:** requests *arrive* at a fixed rate, whatever the server does, like real users who do not wait for each other. k6's `constant-arrival-rate` executor works like this. When the server slows down, requests pile up, as they would in production.

The difference matters most when the server stalls (Example 7).

## How it works

The load-test-and-profile loop:

1. **Write down the question.** For example: "Can one process serve 200 requests/s on `/price/:sku` with p99 under 100 ms?" A test without a target only produces numbers.
2. **Start the app the way production runs it** (`NODE_ENV=production`, same Node version), on a machine that is as quiet as you can make it. Note the machine and what else is running.
3. **Warm up,** then run the load. V8 compiles hot functions with its optimising compiler only after they have run for a while, so the first seconds are slower. The before/after harness in Example 6 discards a 2 s warm-up run.
4. **Read the percentiles,** not the mean: p50 for the typical request, p99 and max for the tail, plus throughput (requests/s) and errors.
5. **Profile under the same load.** Run the server with `node --cpu-prof` (or under 0x), apply the load, stop the server, and rank functions by self time. Lesson 10's appendix explains the `.cpuprofile` format, the `top-functions.js` script used below and how 0x works; this lesson only applies them to a server under load.
6. **Change one thing,** then repeat steps 3–5 several times for both versions and compare the spread of results, not two single numbers.

**How the numbers in this lesson were produced.** One laptop: Intel Core i5-1135G7 (4 cores, 8 threads), 15 GB RAM, Ubuntu 26.04, Node v24.19.0. The load generator ran on the same machine as the server, so they competed for CPU. Other jobs were running on the machine at the same time (other people's builds and servers, a browser, endpoint security software): the 1-minute load average was between 4 and 15 during these runs. Example 6 shows what that did to one set of runs. Treat every number as a measurement of this setup, not as a benchmark of Node, Express or the tools.

**Why averages mislead, in numbers.** With 2% of requests at 200 ms and 98% at about 0–1 ms, the mean moves by about 0.02 × 200 = 4 ms. A dashboard that shows only the mean shows a service at 4 ms. The p99 shows 200 ms, which is what one request in fifty gets. Averages also hide bimodal distributions (two groups, fast and slow) and say nothing about the worst case.

**Coordinated omission.** A closed-model tool waits for each response before sending the next request on that connection. If the server stalls for 300 ms, each connection sends just one request during the stall, so only a handful of slow requests get recorded, while thousands of fast ones are recorded before and after. In production, users keep arriving during the stall and all of them wait. An open-model test records those waits. Gil Tene named this effect "coordinated omission": the tool coordinates with the server and omits the requests that would have been slow.

**autocannon vs k6.**

| | autocannon 8.0.0 | k6 v2.3.0 |
|---|---|---|
| Install | npm package (`npx autocannon`) | single Go binary from the GitHub release |
| Script | CLI flags, or a Node API (`autocannon({ url, connections, duration })`) | a JavaScript file run by k6's own runtime (not Node; `import http from 'k6/http'`) |
| Load model | closed (connections); with `-R`/`--overallRate` it paces requests and, per its README, corrects latencies for coordinated omission (`-C` turns that off) | closed (`vus`) or open (`constant-arrival-rate`, `ramping-arrival-rate` executors) |
| Pass/fail | none built in; check the JSON result yourself | `thresholds`; a failed threshold makes k6 exit non-zero |
| Good for | quick runs against one URL from a Node project | scripted scenarios, ramps, SLO gates in CI |

## Code examples

**Example 1 — the app under test (Express 5).** One file with four routes: `/fast`, `/tail` (2% slow path), `/stall` (blocks the loop for 300 ms every 2 s) and `/price/:sku`, whose hot path can run in three modes for the before/after measurement. Port 7440.

javascript

```
// server.js — Express 5 app for load testing. PORT defaults to 7440.
import express from 'express';

const app = express();

// /fast: a small JSON response, no I/O
app.get('/fast', (req, res) => res.json({ ok: true }));

// /tail: 1 request in 50 (2%) takes a 200 ms slow path (think: cache miss to a slow service)
let n = 0;
app.get('/tail', async (req, res) => {
  if (++n % 50 === 0) await new Promise((r) => setTimeout(r, 200));
  res.json({ ok: true, n });
});

// /stall: every 2 s one request blocks the event loop for 300 ms (for the k6 edge case)
let lastStall = Date.now();
app.get('/stall', (req, res) => {
  if (Date.now() - lastStall > 2000) {
    lastStall = Date.now();
    while (Date.now() - lastStall < 300) {}                 // synchronous: nothing else runs
  }
  res.json({ ok: true });
});

// /price/:sku: the hot path. The catalog arrives as a JSON string (as from Redis or a file).
const catalog = Array.from({ length: 5000 }, (_, i) => ({
  sku: `SKU-${i}`, name: `Item ${i}`, price: (i % 97) + 0.99, tags: ['a', 'b', 'c'],
}));
const rawCatalog = JSON.stringify(catalog);                 // about 360 KB
let parsed = null;                                          // MODE=1 and MODE=2
let bySku = null;                                           // MODE=2

// MODE=0: parse on every request. MODE=1: parse once. MODE=2: parse once + Map index.
const MODE = process.env.MODE ?? '0';
function findItem(sku) {
  if (MODE === '0') return JSON.parse(rawCatalog).find((p) => p.sku === sku);
  parsed ??= JSON.parse(rawCatalog);
  if (MODE === '1') return parsed.find((p) => p.sku === sku);
  bySku ??= new Map(parsed.map((p) => [p.sku, p]));
  return bySku.get(sku);
}

app.get('/price/:sku', (req, res) => {
  const item = findItem(req.params.sku);
  if (!item) return res.status(404).json({ error: 'not found' });
  res.json({ sku: item.sku, price: item.price });
});

// Express 5 passes listen errors (EADDRINUSE…) to this callback instead of throwing
const server = app.listen(Number(process.env.PORT ?? 7440), '127.0.0.1', (err) => {
  if (err) throw err;
  console.log(`pid ${process.pid} on :${server.address().port} MODE=${MODE}`);
});

// exit cleanly on SIGINT/SIGTERM so --cpu-prof can write its file
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
```

bash

```
$ npm ls express autocannon 0x
proj@1.0.0 /…/proj
├── 0x@6.0.0
├── autocannon@8.0.0
└── express@5.3.0
$ npx autocannon --version
autocannon v8.0.0
node v24.19.0
$ node server.js &
pid … on :7440 MODE=0
```

**Example 2 — autocannon: the mean looks fine, p99 does not.** 50 connections for 10 seconds against `/tail`. `-l` prints the full percentile table.

bash

```
$ npx autocannon -c 50 -d 10 -l http://127.0.0.1:7440/tail
Running 10s test @ http://127.0.0.1:7440/tail
50 connections


┌─────────┬──────┬──────┬───────┬────────┬─────────┬──────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%    │ Avg     │ Stdev    │ Max    │
├─────────┼──────┼──────┼───────┼────────┼─────────┼──────────┼────────┤
│ Latency │ 0 ms │ 0 ms │ 4 ms  │ 199 ms │ 4.03 ms │ 27.69 ms │ 215 ms │
└─────────┴──────┴──────┴───────┴────────┴─────────┴──────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬───────────┬────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg       │ Stdev  │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Req/Sec   │ 9,175   │ 9,175   │ 12,175  │ 12,327  │ 11,836.73 │ 860.86 │ 9,171   │
├───────────┼─────────┼─────────┼─────────┼─────────┼───────────┼────────┼─────────┤
│ Bytes/Sec │ 2.34 MB │ 2.34 MB │ 3.12 MB │ 3.16 MB │ 3.03 MB   │ 224 kB │ 2.34 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴───────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

┌────────────┬──────────────┐
│ Percentile │ Latency (ms) │
├────────────┼──────────────┤
│ …          │ …            │
├────────────┼──────────────┤
│ 90         │ 0            │
├────────────┼──────────────┤
│ 97.5       │ 4            │
├────────────┼──────────────┤
│ 99         │ 199          │
├────────────┼──────────────┤
│ 99.9       │ 201          │
├────────────┼──────────────┤
│ 99.99      │ 204          │
├────────────┼──────────────┤
│ 99.999     │ 211          │
└────────────┴──────────────┘

130k requests in 11.02s, 33.4 MB read
```

- The mean (`Avg`) is 4.03 ms. p50 is 0 ms (autocannon reports whole milliseconds), p97.5 is 4 ms.
- p99 is 199 ms, p99.9 is 201 ms: the 2% slow path. The jump happens between p97.5 and p99, exactly where the slowest 2% begins.
- Throughput was about 11,800 requests/s. The slow requests did not slow the others down, because `await` on a timer does not block the event loop. A *synchronous* slow path would (Example 7).

**Example 3 — k6: an open-model test with an SLO threshold.** Getting the binary without root (the release publishes a checksum file). k6 runs with a throwaway `HOME` so it writes no config into the real one:

bash

```
$ cd ~/.cache/nodekit-repair-tools/pass7/b5/dl
$ curl -sL -o k6.tgz https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-linux-amd64.tar.gz
$ curl -sL -o k6-v2.3.0-checksums.txt https://github.com/grafana/k6/releases/download/v2.3.0/k6-v2.3.0-checksums.txt
$ cp k6.tgz k6-v2.3.0-linux-amd64.tar.gz   # sha256sum -c looks the file up by its release name
$ sha256sum -c --ignore-missing k6-v2.3.0-checksums.txt
k6-v2.3.0-linux-amd64.tar.gz: OK
$ mkdir -p ../k6x && tar -xzf k6-v2.3.0-linux-amd64.tar.gz -C ../k6x
$ cp ../k6x/k6-v2.3.0-linux-amd64/k6 ../bin/k6
$ export PATH=~/.cache/nodekit-repair-tools/pass7/b5/bin:$PATH HOME=~/.cache/nodekit-repair-tools/pass7/b5/home
$ k6 version
k6 v2.3.0 (commit/e088784614, go1.26.8, linux/amd64)
```

The script: 200 requests per second for 20 s, a p99 threshold and an error-rate threshold. `__ENV.URL` comes from `-e URL=…`.

javascript

```
// load.k6.js — open-model load: 200 new requests per second, however slow the server is.
// Run: k6 run -e URL=http://127.0.0.1:7440/tail load.k6.js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    steady: {
      executor: 'constant-arrival-rate',   // start `rate` iterations per `timeUnit`
      rate: 200,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 20,                  // VUs ready at start
      maxVUs: 200,                          // more are started if responses are slow
    },
  },
  thresholds: {
    http_req_duration: ['p(99)<100'],       // SLO: 99% of requests under 100 ms
    http_req_failed: ['rate<0.01'],         // and fewer than 1% errors
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const res = http.get(__ENV.URL);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```

bash

```
$ k6 run --no-usage-report --no-color -q -e URL=http://127.0.0.1:7440/tail load.k6.js; echo "exit $?"


  █ THRESHOLDS 

    http_req_duration
    ✗ 'p(99)<100' p(99)=200.65ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 4000    198.054861/s
    checks_succeeded...: 100.00% 4000 out of 4000
    checks_failed......: 0.00%   0 out of 4000

    ✓ status is 200

    HTTP
    http_req_duration..............: avg=4.53ms med=482.06µs p(90)=693.26µs p(95)=944.91µs p(99)=200.65ms max=202.5ms 
      { expected_response:true }...: avg=4.53ms med=482.06µs p(90)=693.26µs p(95)=944.91µs p(99)=200.65ms max=202.5ms 
    http_req_failed................: 0.00%  0 out of 4000
    http_reqs......................: 4000   198.054861/s

    EXECUTION
    iteration_duration.............: avg=4.7ms  med=639.34µs p(90)=910.58µs p(95)=1.2ms    p(99)=200.79ms max=202.75ms
    iterations.....................: 4000   198.054861/s
    vus............................: 1      min=0         max=1 
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 1.0 MB 50 kB/s
    data_sent......................: 296 kB 15 kB/s



time="2026-10-12T23:23:34+05:30" level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
exit 99
```

- k6 sent 4,000 requests at 198 per second, as configured, and needed only one VU at a time because responses were fast.
- The summary shows the same shape as autocannon: avg 4.53 ms, median 0.48 ms, p95 0.94 ms, and p99 200.65 ms.
- The p99 threshold failed, so k6 printed `✗ 'p(99)<100'`, logged "thresholds on metrics 'http_req_duration' have been crossed" and **exited with code 99**. A CI step that runs k6 fails on that exit code, so a latency regression stops the pipeline (`abortOnFail` in the long threshold format stops the test early instead).

**Example 4 — find the bottleneck with `--cpu-prof` under load.** `/price/:sku` in MODE=0 manages about 220 requests/s. Run the server with the profiler, put 10 s of load on it, stop it with SIGINT (the server's handler calls `process.exit(0)`, which lets V8 write the profile), then rank functions by self time with `top-functions.js` from [lesson 10's appendix](10-blocking-the-event-loop.md) (saved as `top-functions.cjs` because this project is `"type": "module"`).

bash

```
$ MODE=0 node --cpu-prof --cpu-prof-dir=prof-mode0 server.js & P=$!
$ npx autocannon -c 20 -d 10 http://127.0.0.1:7440/price/SKU-4999 > /dev/null
$ kill -INT $P
$ ls prof-mode0
CPU.20261012.231218.1855243.0.001.cpuprofile
$ node top-functions.cjs prof-mode0/*.cpuprofile
11368 samples, 12513 ms profiled
  9848.8 ms  78.7%  findItem server.js:36
  1380.7 ms  11.0%  (idle) 
   147.9 ms   1.2%  writev 
   147.4 ms   1.2%  (anonymous) server.js:37
    93.2 ms   0.7%  (garbage collector) 
    47.2 ms   0.4%  (program) 
```

`findItem` had 79% of all samples. To see *which line*, read the `positionTicks` of the function's node:

javascript

```
// ticks.cjs — per-line sample counts for one function in a .cpuprofile
const fs = require('node:fs');
const [file, fn, minHits = '50'] = process.argv.slice(2);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const n of prof.nodes) {
  const { functionName, url, lineNumber } = n.callFrame;
  if (!url.endsWith('server.js') || n.hitCount < Number(minHits)) continue;
  if (fn && functionName !== fn) continue;
  const lines = (n.positionTicks ?? []).sort((a, b) => b.ticks - a.ticks)
    .map((t) => `line ${t.line}: ${t.ticks}`).join(', ');
  console.log(`${functionName || '(anonymous)'} (starts line ${lineNumber + 1}) hits=${n.hitCount} -> ${lines}`);
}
```

bash

```
$ node ticks.cjs prof-mode0/*.cpuprofile
findItem (starts line 36) hits=8936 -> line 37: 5840, line 36: 3096
(anonymous) (starts line 37) hits=135 -> line 37: 135
```

Line 37 is `JSON.parse(rawCatalog).find(…)`: the 360 KB catalog is parsed again on every request. V8 records some of a function's samples against its first line (36), so read the top line together with the code. The fix is to parse once (MODE=1). Profiling again after that fix shows the *next* bottleneck:

bash

```
$ MODE=1 node --cpu-prof --cpu-prof-dir=prof-mode1 server.js & P=$!
$ npx autocannon -c 20 -d 10 http://127.0.0.1:7440/price/SKU-4999 > /dev/null
$ kill -INT $P
$ node top-functions.cjs prof-mode1/*.cpuprofile
11256 samples, 12506 ms profiled
  2296.9 ms  18.4%  (idle) 
  1916.5 ms  15.3%  (anonymous) server.js:44
  1881.0 ms  15.0%  writev 
   936.1 ms   7.5%  handleRequest layer.js:142
   509.6 ms   4.1%  findItem server.js:36
   461.4 ms   3.7%  handle application.js:152
$ node ticks.cjs prof-mode1/*.cpuprofile
(anonymous) (starts line 44) hits=1732 -> line 39: 1705, line 1031: 7, line 47: 4, …
findItem (starts line 36) hits=454 -> line 36: 418, line 39: 31, line 38: 5
(anonymous) (starts line 39) hits=261 -> line 39: 261
```

`writev` (sending responses) and Express's own routing (`handleRequest`, `handle`) are now near the top, which is normal for a fast handler. The largest application entry is the route handler (line 44), and its samples sit on line 39, `parsed.find((p) => p.sku === sku)`: V8 inlined `findItem` into the handler, so the linear scan over 5,000 items is recorded there (the other entries on that row have single-digit tick counts and are trimmed). MODE=2 replaces the scan with a `Map` lookup.

**Example 5 — a flame graph of the same load with 0x.** `-P` (`--on-port`) runs a command once the server is listening, with `$PORT` set, and stops the profile when that command exits. `npx 0x -D flame -P '…' server.js` does the same; here both tools are called through `node` and their script paths, so the `-P` command does not depend on `node_modules/.bin` being on `PATH` (lesson 10 needed the same form on a `noexec` `/tmp`).

bash

```
$ node ../node_modules/0x/cmd.js -D flame -P 'node ../node_modules/autocannon/autocannon.js -c 20 -d 5 http://127.0.0.1:$PORT/price/SKU-4999' server.js
🔥  Profiling
pid 1865452 on :7440 MODE=0
Running 5s test @ http://127.0.0.1:7440/price/SKU-4999
20 connections


┌─────────┬───────┬───────┬────────┬────────┬─────────┬──────────┬─────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5%  │ 99%    │ Avg     │ Stdev    │ Max     │
├─────────┼───────┼───────┼────────┼────────┼─────────┼──────────┼─────────┤
│ Latency │ 35 ms │ 82 ms │ 168 ms │ 247 ms │ 88.7 ms │ 64.06 ms │ 1049 ms │
└─────────┴───────┴───────┴────────┴────────┴─────────┴──────────┴─────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 186     │ 186     │ 226     │ 243     │ 222.4   │ 19.91   │ 186     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 49.7 kB │ 49.7 kB │ 60.4 kB │ 64.9 kB │ 59.4 kB │ 5.32 kB │ 49.7 kB │
└───────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 5

1k requests in 5.01s, 297 kB read
🔥  Waiting for subprocess to exit...🔥  Process exited, generating flamegraph🔥  Flamegraph generated in
file:///home/anish.r/.cache/nodekit-repair-tools/pass7/b5/proj/l114/flame/flamegraph.html
$ ls flame
flamegraph.html
isolate-0x37c02000-1865452-1865452-v8.log
isolate-0x37c02000-1865452-1865452-v8.log.json
isolate-0x37c02000-1865452-1865452-v8.log.preprocess-ready
meta.json
$ grep -o 'findItem' flame/flamegraph.html | wc -l
17
```

The HTML file (about 830 KB) contains the `findItem` frames. In a flame graph, a bar's width is its share of samples, so `findItem` should show as the widest bar under the route handler.

> ⚠️ Unverified: what the flame graph looks like on screen. The HTML file was generated and searched for `findItem`, but not opened in a browser (headless session).

**Example 6 — before and after, measured several times.** `bench.js` starts a fresh server per run, discards a 2 s warm-up, runs autocannon for 10 s with 20 connections against `/price/SKU-4999`, stops the server, and repeats 5 times per mode.

javascript

```
// bench.js — start server.js once per run, load it with autocannon, report each run and the spread
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import autocannon from 'autocannon';

const RUNS = Number(process.env.RUNS ?? 5);
const URL = 'http://127.0.0.1:7440/price/SKU-4999';

async function oneRun(mode) {
  const child = spawn('node', ['server.js'], { env: { ...process.env, MODE: mode }, stdio: ['ignore', 'pipe', 'inherit'] });
  await once(child.stdout, 'data');                        // wait for the "listening" line
  await autocannon({ url: URL, connections: 20, duration: 2 }); // warm-up, discarded
  const r = await autocannon({ url: URL, connections: 20, duration: 10 });
  child.kill('SIGTERM');
  await once(child, 'exit');
  return { rps: r.requests.average, p50: r.latency.p50, p99: r.latency.p99, errors: r.errors + r.non2xx };
}

const spread = (xs) => `${Math.min(...xs)}–${Math.max(...xs)}`;
for (const mode of (process.env.MODES ?? '0,1,2').split(',')) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await oneRun(mode));
  console.log(`MODE=${mode} req/s per run: ${runs.map((r) => Math.round(r.rps)).join(', ')}`);
  console.log(`       p50 ms: ${runs.map((r) => r.p50).join(', ')} | p99 ms: ${runs.map((r) => r.p99).join(', ')} | errors: ${runs.reduce((a, r) => a + r.errors, 0)}`);
  console.log(`       spread: req/s ${spread(runs.map((r) => Math.round(r.rps)))}, p99 ${spread(runs.map((r) => r.p99))} ms`);
}
```

bash

```
$ uptime
 23:06:50 up  7:18,  1 user,  load average: 4.66, 4.71, 5.06
$ node bench.js
MODE=0 req/s per run: 211, 218, 220, 222, 219
       p50 ms: 87, 83, 84, 83, 84 | p99 ms: 197, 202, 190, 181, 191 | errors: 0
       spread: req/s 211–222, p99 181–202 ms
MODE=1 req/s per run: 8919, 8113, 8750, 8679, 8061
       p50 ms: 2, 2, 2, 2, 2 | p99 ms: 4, 5, 5, 4, 5 | errors: 0
       spread: req/s 8061–8919, p99 4–5 ms
MODE=2 req/s per run: 229, 47, 11016, 16984, 16839
       p50 ms: 72, 372, 0, 1, 1 | p99 ms: 272, 2188, 4, 3, 3 | errors: 0
       spread: req/s 47–16984, p99 3–2188 ms
$ uptime
 23:10:18 up  7:21,  1 user,  load average: 15.38, 8.95, 6.53
```

bash

```
$ uptime
 23:10:36 up  7:22,  1 user,  load average: 11.93, 8.58, 6.46
$ MODES=2 node bench.js
MODE=2 req/s per run: 16292, 18252, 16821, 17716, 18102
       p50 ms: 1, 0, 1, 1, 0 | p99 ms: 2, 2, 2, 2, 2 | errors: 0
       spread: req/s 16292–18252, p99 2–2 ms
```

| Mode | What changed | req/s (5 runs) | p99 (5 runs) |
|---|---|---|---|
| 0 | parse 360 KB JSON on every request | 211–222 | 181–202 ms |
| 1 | parse once, `Array.find` per request | 8,061–8,919 | 4–5 ms |
| 2 | parse once, `Map` lookup | 16,292–18,252 (rerun) | 2 ms (rerun) |

- **Fix 1 (cache the parsed catalog)** raised throughput about 40× and cut p99 from about 190 ms to 5 ms. The profile had pointed straight at it.
- **Fix 2 (index by SKU)** roughly doubled throughput again, from the next item the profile showed.
- **The first MODE=2 set is what a busy machine looks like.** Runs 1 and 2 gave 229 and 47 requests/s, with p99 up to 2,188 ms; runs 3–5 gave 11,016–16,984. The load average rose to 15.4 by the end of that set, from other processes on the machine. A rerun of MODE=2 alone, 5 runs, gave 16,292–18,252 requests/s and p99 2 ms. Without several runs per case, one of those bad runs could have been reported as "the Map makes it slower".

**Example 7 — edge case: a closed-model test hides a stall (coordinated omission).** `/stall` blocks the event loop for 300 ms every 2 s, so the server does nothing for 15% of the time. autocannon with 10 connections:

bash

```
$ npx autocannon -c 10 -d 10 http://127.0.0.1:7440/stall
Running 10s test @ http://127.0.0.1:7440/stall
10 connections


┌─────────┬──────┬──────┬───────┬──────┬─────────┬─────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%  │ Avg     │ Stdev   │ Max    │
├─────────┼──────┼──────┼───────┼──────┼─────────┼─────────┼────────┤
│ Latency │ 0 ms │ 0 ms │ 1 ms  │ 1 ms │ 0.19 ms │ 5.79 ms │ 310 ms │
└─────────┴──────┴──────┴───────┴──────┴─────────┴─────────┴────────┘
┌───────────┬────────┬────────┬─────────┬─────────┬───────────┬──────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%     │ 97.5%   │ Avg       │ Stdev    │ Min    │
├───────────┼────────┼────────┼─────────┼─────────┼───────────┼──────────┼────────┤
│ Req/Sec   │ 10,207 │ 10,207 │ 14,343  │ 18,943  │ 14,848.37 │ 3,059.34 │ 10,204 │
├───────────┼────────┼────────┼─────────┼─────────┼───────────┼──────────┼────────┤
│ Bytes/Sec │ 2.5 MB │ 2.5 MB │ 3.51 MB │ 4.64 MB │ 3.64 MB   │ 749 kB   │ 2.5 MB │
└───────────┴────────┴────────┴─────────┴─────────┴───────────┴──────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 11

163k requests in 11.01s, 40 MB read
```

p99 is 1 ms, and only the max (310 ms) hints at a problem. During each stall the 10 connections sent 10 requests and waited, while about 14,800 requests/s were recorded the rest of the time, so the slow ones were a tiny fraction. Now the same server under k6 at a fixed 200 requests/s:

bash

```
$ k6 run --no-usage-report --no-color -q -e URL=http://127.0.0.1:7440/stall load.k6.js; echo "exit $?"


  █ THRESHOLDS 

    http_req_duration
    ✗ 'p(99)<100' p(99)=283.18ms

    http_req_failed
    ✓ 'rate<0.01' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 3960    197.983388/s
    checks_succeeded...: 100.00% 3960 out of 3960
    checks_failed......: 0.00%   0 out of 3960

    ✓ status is 200

    HTTP
    http_req_duration..............: avg=23.45ms med=482.26µs p(90)=104.62ms p(95)=206.86ms p(99)=283.18ms max=300.52ms
      { expected_response:true }...: avg=23.45ms med=482.26µs p(90)=104.62ms p(95)=206.86ms p(99)=283.18ms max=300.52ms
    http_req_failed................: 0.00%  0 out of 3960
    http_reqs......................: 3960   197.983388/s

    EXECUTION
    dropped_iterations.............: 41     2.049828/s
    iteration_duration.............: avg=23.62ms med=645.6µs  p(90)=104.75ms p(95)=206.95ms p(99)=283.3ms  max=300.7ms 
    iterations.....................: 3960   197.983388/s
    vus............................: 1      min=0         max=1 
    vus_max........................: 61     min=20        max=61

    NETWORK
    data_received..................: 970 kB 49 kB/s
    data_sent......................: 297 kB 15 kB/s



time="2026-10-12T23:24:01+05:30" level=error msg="thresholds on metrics 'http_req_duration' have been crossed"
exit 99
```

- **k6 at 200 arrivals/s:** p90 104.62 ms, p95 206.86 ms, p99 283.18 ms, avg 23.45 ms. One request in ten waited at least 100 ms, which matches a server that is stalled 15% of the time.
- **autocannon with 10 connections:** p99 1 ms. Same server, same stalls.
- **`dropped_iterations: 41`.** During each stall k6 needed more VUs than were running (it started up to 61 of the 200 allowed), and 41 requests could not be started on time. Those are requests the test never sent, so the real tail is slightly worse. Raise `preAllocatedVUs` until this stays at 0.

autocannon has a fixed-rate mode too. With `-R`, its README says latencies "will be corrected to compensate for the effects of the coordinated omission issue"; `-C` turns the correction off. The same 200 requests/s for 20 s, with and without correction:

bash

```
$ npx autocannon -c 10 -R 200  -d 20 http://127.0.0.1:7440/stall
┌─────────┬──────┬────────┬────────┬────────┬──────────┬──────────┬────────┐
│ Stat    │ 2.5% │ 50%    │ 97.5%  │ 99%    │ Avg      │ Stdev    │ Max    │
├─────────┼──────┼────────┼────────┼────────┼──────────┼──────────┼────────┤
│ Latency │ 0 ms │ 127 ms │ 292 ms │ 297 ms │ 130.3 ms │ 95.54 ms │ 305 ms │
└─────────┴──────┴────────┴────────┴────────┴──────────┴──────────┴────────┘

4k requests in 20.02s, 980 kB read
$ npx autocannon -c 10 -R 200 -C -d 20 http://127.0.0.1:7440/stall
┌─────────┬──────┬──────┬───────┬────────┬─────────┬──────────┬────────┐
│ Stat    │ 2.5% │ 50%  │ 97.5% │ 99%    │ Avg     │ Stdev    │ Max    │
├─────────┼──────┼──────┼───────┼────────┼─────────┼──────────┼────────┤
│ Latency │ 0 ms │ 0 ms │ 16 ms │ 300 ms │ 7.93 ms │ 46.78 ms │ 302 ms │
└─────────┴──────┴──────┴───────┴────────┴─────────┴──────────┴────────┘

4k requests in 20.02s, 980 kB read
```

Without the correction (`-C`), p99 was 300 ms but p97.5 only 16 ms. With it, the median jumped to 127 ms, far above k6's median of 0.48 ms for the same arrival rate, so the corrected numbers did not match what an open-model test measured here.

> ⚠️ Unverified: why autocannon's corrected median is so much higher than k6's. Its correction method was not examined; only the outputs above were compared.

1. Requests keep arriving during the stall: 200/s × 0.3 s ≈ 60 per stall.
2. Each one waits for the rest of the stall: up to 300 ms, about 150 ms on average.
3. k6 records every one of them, so the slow share is the share of *arrivals* during stalls, not the share of *completed requests*.

For latency targets, test with an arrival rate close to real traffic (k6's arrival-rate executors), and use closed-model tools for "how much can it take" questions.

## Common mistakes & gotchas

- **Reading the mean.** The mean was 4.03 ms in Example 2 while 1 request in 50 took 200 ms. Report p50, p99 and max.
- **Load generator on the same machine as the server.** They compete for the same CPU, as they did in every run here. For real numbers, run the generator on another machine, or at least note it.
- **One run per case.** Example 6's first MODE=2 set ranged from 47 to 16,984 requests/s because of other load. Run several times, report the spread, rerun when the spread is wide.
- **No warm-up.** The first seconds include JIT compilation and cold caches.
- **Testing a closed model only.** It hides stalls (Example 7). Use an arrival rate for latency SLOs.
- **Profiling a short or idle run.** A profile of 100 ms or of an idle server has few useful samples. Profile under load, for 10 s or more; lesson 10 covers sample counts.
- **Killing the profiled process with SIGKILL, or with SIGINT without a handler.** `--cpu-prof` writes its file when the process exits normally. Exit through `process.exit()` from a signal handler, as `server.js` does.
- **Optimising what the profile did not show.** After fix 1, `writev` and Express routing were large, but they were not the application's problem. Fix the largest application cost first, measure again, and stop when the target is met.
- **Load testing someone else's server.** Only load-test systems you own or have written permission to test.

## Best practices

- **Write the target first** (rate, p99, error rate) and encode it as k6 `thresholds`, so the run passes or fails without interpretation.
- **Pin the tool and app versions** and record the machine, Node version and background load with the results.
- **Use arrival-rate executors for latency SLOs,** closed-model runs for capacity ("how many requests/s until p99 crosses the line").
- **Profile under the same load you measured,** change one thing, and rerun both the load test and the profile.
- **Keep the harness in the repo** (`bench.js`, k6 scripts) and run it in CI on a dedicated runner if you want to catch regressions; shared runners are too noisy for small differences.
- **Watch the server side too** while testing: event-loop delay, CPU, memory, pool waits ([lesson 110](110-performance-tuning-checklist.md) has a check for each).

## ⭐ Interview lens

> **Q: “Your dashboard shows a 5 ms average latency but users complain the API is slow. What do you look at?”**  
> A: The distribution, not the mean. Look at p99 and max, per endpoint. In the run here, 2% of requests took 200 ms and the mean was 4 ms; p99 was 199 ms. Then find what the slow requests have in common (a cache miss path, a particular parameter, a periodic job) and profile that path. *Trap:* a page that calls 20 endpoints hits a 2% slow path on about a third of page loads.

> **Q: “What is coordinated omission?”**  
> A: A closed-model load generator waits for each response before sending the next request on that connection. When the server stalls, the generator stops sending, so it records only a few slow requests and makes the tail look better than real users see it. Real users keep arriving. Use an open model (a fixed arrival rate, like k6's `constant-arrival-rate`). In the example here, a 300 ms stall every 2 s gave autocannon a p99 of 1 ms, while k6 at 200 requests/s recorded it in its tail.

> **Q: “How do you find why a Node endpoint tops out at a few hundred requests per second?”**  
> A: Put it under load and take a CPU profile at the same time (`node --cpu-prof`, or 0x for a flame graph). Rank functions by self time and look at per-line ticks. Here, 79% of samples were in one function, on the line that re-parsed a 360 KB JSON string per request. Caching the parsed value took the endpoint from about 220 to about 8,500 requests/s, and the next profile pointed at a linear scan, which a `Map` fixed.

> **Q: “autocannon or k6?”**  
> A: autocannon is an npm package, quick to run from a Node project against one URL, closed model, with a Node API for scripting. k6 is a separate binary with its own JavaScript runtime, scenarios, open-model executors and thresholds that fail the run, which suits SLO checks and CI. Both measure the same thing; pick by the question.

## Cheat-card

- **Percentiles:** p50 typical, p99 tail, max worst; never the mean alone. 2% at 200 ms → mean ≈ +4 ms, p99 = 200 ms.
- **autocannon 8.0.0:** `npx autocannon -c 50 -d 10 -l URL`; Node API `autocannon({ url, connections, duration })` → `result.latency.p99`, `result.requests.average`.
- **k6 v2.3.0:** `k6 run -e URL=… script.js`; `constant-arrival-rate` (`rate`, `timeUnit`, `duration`, `preAllocatedVUs`, `maxVUs`); `thresholds: { http_req_duration: ['p(99)<100'] }`; failed threshold → non-zero exit.
- **Closed vs open model:** closed hides stalls (coordinated omission); use an arrival rate for latency SLOs.
- **Profile under load:** `node --cpu-prof --cpu-prof-dir=prof server.js`, load it, exit through `process.exit()`; rank self time (lesson 10's script); check `positionTicks` for the line.
- **0x:** `0x -D flame -P 'autocannon -c 20 -d 5 http://127.0.0.1:$PORT/…' server.js`.
- **Before/after:** fresh process per run, warm-up, ≥5 runs per case, report min–max, rerun if noisy.
- **Measured here:** re-parsing 360 KB JSON per request → ~220 req/s; parse once → ~8,500; plus `Map` → ~17,000 (one laptop, busy).

---

## Learn More

- [autocannon (README) github.com](https://github.com/mcollina/autocannon)
- [k6 documentation grafana.com](https://grafana.com/docs/k6/latest/)
- [k6 constant-arrival-rate executor grafana.com](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/)
- [k6 thresholds grafana.com](https://grafana.com/docs/k6/latest/using-k6/thresholds/)
- [Profiling Node.js applications nodejs.org](https://nodejs.org/en/learn/getting-started/profiling)
- [0x flame graphs github.com](https://github.com/davidmarkclements/0x)
