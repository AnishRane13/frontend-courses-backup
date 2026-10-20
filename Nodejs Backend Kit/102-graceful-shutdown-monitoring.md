---
title: "Graceful shutdown & monitoring"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/graceful-shutdown
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Graceful shutdown & monitoring

*11 min read · Updated 24 Jul 2026 Topic 66 of 70 Bookmark Mark done Why it matters In a modern deployment · Topic 66 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/graceful-shutdown](https://www.geekyfrontend.in/learn/nodejs-backend-kit/graceful-shutdown)

---

## Why it matters

In a modern deployment, your process gets **killed constantly** — and that's normal. Every rolling deploy stops the old version, every autoscaling scale-down removes instances, every Kubernetes node drain evicts pods, every crash-and-restart cycle ends a process. The question is not *whether* your app will be told to stop, but *what happens to the requests in flight* when it is. Done naively, the process dies mid-request: a user's payment is cut off half-committed, a database write is left dangling, a queued job is lost. Done right — **graceful shutdown** — the app stops accepting new work, finishes what it's already doing, closes its connections cleanly, and exits. The difference is invisible when it works and a 3 a.m. incident when it doesn't.

The flip side is **monitoring and health checks**: the platform needs to know, continuously, whether your instance is alive and whether it's ready to receive traffic — and you need to know your service's latency, error rate, and resource use before users tell you. Together, graceful shutdown and health/monitoring are what make a Node service *operable*. In interviews they're a favourite because they reveal whether you've actually run software in production: "what happens when Kubernetes sends SIGTERM?" is a question you can only answer well if you've had to.

## The concept, simply

When an orchestrator wants your process to stop, it sends the **SIGTERM** signal — a polite "please shut down." (Contrast **SIGKILL**, which can't be caught and kills instantly, and **SIGINT**, what Ctrl-C sends in your terminal.) By default Node exits on SIGTERM immediately, abandoning in-flight work. Graceful shutdown means *catching* SIGTERM and running an orderly teardown before exiting.

The teardown has a fixed shape: **(1)** stop taking new requests, **(2)** let in-flight requests finish (drain), **(3)** close resources — DB pool, Redis, message-queue consumers, flush logs/metrics, **(4)** exit with code 0. And critically, **(5)** a *forced-exit timer*: if draining takes too long (a stuck request), a timeout forces the exit so shutdown can't hang forever.

![Ordered sequence for graceful shutdown on SIGTERM flip readiness to not-ready stop accepting connections drain in-flight requests close resources exit and a forced-exit safety timer](assets/i63_01_85ccfa6f.svg)

Graceful shutdown on SIGTERM: mark not-ready so the LB stops routing, stop accepting new connections, drain in-flight requests, close DB/Redis/consumers, then exit — with a forced-exit timer as a safety net.

**Health checks** come in two flavours that people constantly conflate. A **liveness** probe answers "is the process alive, or wedged and needing a restart?" — fail it and the platform kills+restarts the instance. A **readiness** probe answers "is this instance ready to receive traffic *right now*?" — fail it and the load balancer stops routing to it *without* killing it. The distinction is what makes zero-downtime shutdown work: on SIGTERM you flip *readiness* to not-ready first, so the load balancer drains you, while the process stays up long enough to finish current requests.

**Monitoring** is the always-on version of the same instinct: continuously observe the service through metrics (latency, throughput, error rate, event-loop lag, memory), logs (structured, to stdout), and traces, so you can see problems before users do and diagnose them fast.

## How it works

You register handlers for the termination signals. On SIGTERM (and usually SIGINT for local dev), you kick off the shutdown sequence. The linchpin is **`server.close()`**: it tells the HTTP server to *stop accepting new connections* but keeps existing ones open until their in-flight requests complete, then fires its callback. That callback is where you close everything else — `await pool.end()`, `await redis.quit()`, stop queue consumers, flush your metrics/log buffers — and finally exit.

Two subtleties make this actually work in production. First, **keep-alive connections**: idle keep-alive sockets can keep `server.close()` from ever completing because the connection is open with no active request. Node's `server.closeIdleConnections()` (and, more aggressively, `closeAllConnections()`) handle this; libraries and Node's own `server.keepAliveTimeout` also help. Second, the **ordering with the load balancer**: if you call `server.close()` before the LB has noticed you're going away, new requests it already routed can hit a closing server. That's why you flip the readiness probe to not-ready *first*, wait a beat for the LB to stop sending traffic, and only then stop accepting. In Kubernetes this is also handled by the pod's `preStop` hook and `terminationGracePeriodSeconds`.

The **forced-exit timer** is non-negotiable: `setTimeout(() => process.exit(1), 10_000).unref()`. If a request hangs (a slow upstream, a stuck DB query), you don't want shutdown to block indefinitely — after the grace period, exit anyway. The `.unref()` ensures this timer itself doesn't keep the process alive if everything *else* finished cleanly.

**Health endpoints** are ordinary HTTP routes. A liveness route (`/healthz`) returns 200 as long as the process can respond — keep it cheap and dependency-free so a slow DB doesn't cause needless restarts. A readiness route (`/readyz`) checks that critical dependencies (DB, Redis) are reachable *and* returns 503 once shutdown has begun, so the LB drains you. For monitoring, you expose metrics (commonly a Prometheus `/metrics` endpoint via `prom-client`), and you watch **event-loop lag** specifically — rising lag is Node's canary for a blocked event loop, the failure this whole chapter's other topics exist to prevent.

Finally, handle the **crash signals**: `uncaughtException` and `unhandledRejection`. Best practice is to log, attempt a fast cleanup, and exit — because after an uncaught exception the process is in an unknown state, so you let the supervisor restart a fresh one rather than limp on corrupted.

## Code examples

A complete, production-shaped graceful shutdown: readiness flip, drain, resource cleanup, forced-exit safety net.

javascript

```
import http from 'node:http';

let shuttingDown = false;
const server = http.createServer(app);
server.keepAliveTimeout = 5000;                 // don't let idle sockets linger
server.listen(3000);

async function shutdown(signal) {
  if (shuttingDown) return;                      // idempotent — signals can repeat
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);

  // 1) Force-exit safety net so a stuck request can't hang us forever.
  const killer = setTimeout(() => {
    console.error('Drain timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  killer.unref();

  // 2) Stop accepting new connections; finish in-flight requests.
  server.close(async () => {
    try {
      await pool.end();                          // close DB pool
      await redis.quit();                        // close Redis
      console.log('Clean shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('Error during cleanup', err);
      process.exit(1);
    }
  });
  server.closeIdleConnections?.();               // release idle keep-alive sockets
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));  // Ctrl-C in dev
```

Liveness vs readiness endpoints — note how readiness reports not-ready as soon as shutdown starts, so the load balancer drains this instance.

javascript

```
// Liveness: is the process responsive at all? Keep it cheap, no deps.
app.get('/healthz', (req, res) => res.status(200).send('ok'));

// Readiness: should traffic be routed here right now?
app.get('/readyz', async (req, res) => {
  if (shuttingDown) return res.status(503).send('shutting down');  // drain me
  try {
    await pool.query('SELECT 1');                // critical dep reachable?
    await redis.ping();
    res.status(200).send('ready');
  } catch {
    res.status(503).send('dependencies unavailable');
  }
});
```

Minimal monitoring: expose Prometheus metrics and watch event-loop lag, Node's early warning for a blocked loop.

javascript

```
import client from 'prom-client';
import { monitorEventLoopDelay } from 'node:perf_hooks';

client.collectDefaultMetrics();                  // CPU, memory, GC, handles
const loopLag = monitorEventLoopDelay({ resolution: 20 });
loopLag.enable();

const lagGauge = new client.Gauge({
  name: 'nodejs_eventloop_lag_p99_ms',
  collect() { this.set(loopLag.percentile(99) / 1e6); },  // ns → ms
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

Crash handlers — log and exit so the supervisor restarts a clean process rather than continuing in an unknown state.

javascript

```
process.on('uncaughtException', (err) => {
  console.error('uncaughtException — exiting', err);
  process.exit(1);                               // let PM2/k8s restart a fresh process
});
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection — exiting', reason);
  process.exit(1);
});
```

## Common mistakes & gotchas

- **Not handling SIGTERM at all.** Node's default is immediate exit, so every deploy/scale-down kills in-flight requests. You must catch it and drain.
- **No forced-exit timer.** If a request hangs, `server.close()` never calls back and the process hangs until the platform SIGKILLs it — losing the graceful part entirely. Always add an unref'd timeout.
- **Idle keep-alive sockets block `server.close()`.** Without closing idle connections (or a keep-alive timeout), drain can stall on connections with no active request.
- **Confusing liveness and readiness.** Putting dependency checks in the *liveness* probe means a brief DB blip triggers pointless restarts. Deep checks belong in readiness; liveness should just prove the process responds.
- **Closing the server before the LB stops routing.** Flip readiness to not-ready first and wait a moment, or new requests hit a closing server. (In k8s, also mind `preStop` and grace period.)
- **Trying to continue after `uncaughtException`.** The process state is unknown; limping on risks corrupt data. Log and exit; let the supervisor restart.
- **Not making the handler idempotent.** Signals can arrive more than once; without a guard you start shutdown twice.
- **Ignoring event-loop lag.** High lag means the loop is blocked (CPU-bound code) — the one metric most specific to Node health, and the one people forget to watch.
- **Grace period mismatch.** If your drain timeout exceeds the platform's `terminationGracePeriodSeconds`, the platform SIGKILLs you mid-drain. Keep your forced-exit shorter than the platform grace period.

## Best practices

- **Catch SIGTERM (and SIGINT) and run an ordered drain**: readiness→not-ready, `server.close()`, close DB/Redis/consumers, exit 0.
- **Always add an unref'd forced-exit timer** shorter than the platform's grace period.
- **Close idle keep-alive connections** so drain can complete; set a sane `keepAliveTimeout`.
- **Separate liveness (cheap, no deps) from readiness (checks deps + reports draining).**
- **Make the shutdown handler idempotent** and log each step so you can debug slow drains.
- **On `uncaughtException`/`unhandledRejection`: log and exit**; rely on the supervisor to restart clean.
- **Expose metrics (Prometheus/OpenTelemetry) and watch event-loop lag, error rate, latency, memory.** Alert on symptoms users feel.
- **Log structured JSON to stdout** (12-factor) and let the platform aggregate; include request IDs for tracing.
- **Test shutdown** — send a real SIGTERM under load and confirm in-flight requests complete and connections close.

## ⭐ Interview lens

> **Q: What happens when Kubernetes sends your pod SIGTERM, and what should happen?**  
> A: By default Node exits immediately, killing in-flight requests. It *should* catch SIGTERM and drain: flip readiness to not-ready so the LB stops routing, call `server.close()` to stop accepting new connections while finishing current ones, close DB/Redis/consumers, then exit 0 — with a forced-exit timer (shorter than `terminationGracePeriodSeconds`) as a safety net.

> **Q: Liveness vs readiness probe — what's the difference?**  
> A: Liveness answers "is the process alive or wedged?" — failing it restarts the instance. Readiness answers "should it get traffic right now?" — failing it removes it from the load balancer *without* restarting. You flip readiness to not-ready on shutdown to drain traffic while the process finishes current work. (Common trap: putting DB checks in liveness, causing restart storms on a DB blip.)

> **Q: Why do you need a forced-exit timeout during shutdown?**  
> A: Because `server.close()` only fires once all in-flight requests finish; a single stuck request (slow upstream, hung query) would block shutdown forever, and the platform would eventually SIGKILL you. An unref'd `setTimeout(process.exit, N)` guarantees you exit within a bounded time.

> **Q: Should you keep running after an uncaughtException?**  
> A: No. After an uncaught exception the process is in an undefined state — continuing risks corrupt data and hidden bugs. Log it, attempt fast cleanup, and exit so the supervisor (PM2/k8s) starts a fresh process. Use uncaughtException as a last-resort log-and-die, not as normal error handling.

> **Q: Why does `server.close()` sometimes never complete?**  
> A: It waits for all open connections to go idle, but idle HTTP keep-alive sockets stay open with no active request, so they never "finish." Use `server.closeIdleConnections()` (and a `keepAliveTimeout`) so drain can complete. This surprises a lot of people.

> **Q: What Node-specific metric would you monitor and why?**  
> A: Event-loop lag/delay. Because Node runs your code on one thread, rising loop lag means the loop is blocked by synchronous/CPU-bound work — requests are queuing even if CPU looks fine. It's the earliest, most Node-specific signal of the exact failure that worker\_threads/clustering exist to avoid. (Alongside standard latency, error rate, and memory.)

## Cheat-card

- **SIGTERM** = polite stop (catch it); **SIGKILL** = uncatchable; **SIGINT** = Ctrl-C.
- Drain order: readiness→not-ready → `server.close()` → close DB/Redis/consumers → `exit(0)`.
- **Always** add an unref'd **forced-exit timer**, shorter than the platform grace period.
- `server.close()` can hang on idle keep-alives → `closeIdleConnections()` + `keepAliveTimeout`.
- **Liveness** = alive? (cheap, restarts) vs **Readiness** = take traffic? (deps + reports draining, no restart).
- `uncaughtException`/`unhandledRejection` → log and **exit**; let the supervisor restart.
- Monitor **event-loop lag** (Node's canary) + latency, error rate, memory; logs as JSON to stdout.
- Make the handler **idempotent**; test shutdown under real load.
- **Flush telemetry on shutdown:** `await sdk.shutdown()` (OpenTelemetry) and `await Sentry.flush(2000)` after `server.close()` drains, before `exit`; a bare `process.exit()` drops the batch queue (default 5 s).
- **Start the tracing SDK before `require('express')`** (or use `--require`/`--import`), or nothing gets patched.
- **Next:** traces, Collector and sampling in [111](107-observability-with-opentelemetry.md); Sentry, SLOs and burn-rate alerts in [112](108-apm-and-alerting.md).

---

## Learn More

- [Node.js process: signal events (SIGTERM/SIGINT) & exit nodejs.org](https://nodejs.org/api/process.html)
- [Node.js http: server.close() for draining connections nodejs.org](https://nodejs.org/api/http.html)
- [Here's how to Gracefully Shutdown your apps (with Node.js examples) Software Developer Diaries](https://www.youtube.com/watch?v=-OjPhPV6Rjs)


---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0, @opentelemetry/sdk-node 0.223.0, @opentelemetry/instrumentation-http 0.223.0, @opentelemetry/instrumentation-express 0.71.0, @opentelemetry/api 1.9.1*

### Going further: tracing, APM and alerting (lessons 107 and 108)

The monitoring part of this lesson stops at a Prometheus `/metrics` endpoint and event-loop lag. Metrics tell you *that* latency or errors went up across the whole service. They can't tell you which downstream call made one request slow, which exception is behind the 500s, or whether a spike is worth waking someone for. Two later lessons cover that:

- **[Observability with OpenTelemetry](107-observability-with-opentelemetry.md) (lesson 107).** What a trace, span, trace id, resource and attribute are. SDK setup with `@opentelemetry/sdk-node` and auto-instrumentation for Express 5, `fetch` and PostgreSQL. Loading for CommonJS (`--require`) and ESM (`--import` plus the loader hook). Two services sharing one trace through the W3C `traceparent` header. Exporting OTLP to a local OpenTelemetry Collector and Jaeger. Parent-based ratio sampling, measured over 1,000 requests.
- **[APM and Alerting](108-apm-and-alerting.md) (lesson 108).** Sentry error tracking in Express 5 (`@sentry/node` 11, with the real envelope captured by a local server), `beforeSend` scrubbing, an overview of Datadog and New Relic, SLIs, SLOs and error budgets, multiwindow multi-burn-rate alerts from the Google SRE Workbook with the arithmetic run by a script, and how to avoid alert fatigue.

Both depend on this lesson's shutdown sequence. Tracing and error SDKs buffer data in memory and send it in the background, so the SIGTERM handler has to flush them after the server drains and before `process.exit()`.

How it works:

1. An instrumentation library patches `http` and Express when they are loaded. That is why the SDK starts before `require('express')` in the example below.
2. Each request creates a server span (`http`) and a child span for the route handler (`express`). Both share one trace id.
3. When a span ends, the span processor hands it to an exporter. `SimpleSpanProcessor` exports each span at once. The default `BatchSpanProcessor` queues spans and exports every 5 s.
4. On shutdown, `await sdk.shutdown()` exports whatever is still queued. Put it in the SIGTERM sequence after `server.close()` and before `process.exit(0)`, next to `pool.end()` and `redis.quit()`.

**Example — one Express 5 route, its spans printed by the console exporter.**

bash

```
$ npm install express@5.3.0 @opentelemetry/api@1.9.1 @opentelemetry/sdk-node@0.223.0 \
    @opentelemetry/instrumentation-http@0.223.0 @opentelemetry/instrumentation-express@0.71.0
added 137 packages, and audited 138 packages in 20s
…
```

javascript

```
// console-span.cjs: one Express 5 route, its spans printed by ConsoleSpanExporter.
// CommonJS: start the SDK BEFORE require('express'), so the require hook can patch it.
const { NodeSDK, tracing } = require('@opentelemetry/sdk-node');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const sdk = new NodeSDK({
  serviceName: 'health-demo',
  // SimpleSpanProcessor exports each span as it ends (no batching): fine for a demo.
  spanProcessors: [new tracing.SimpleSpanProcessor(new tracing.ConsoleSpanExporter())],
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});
sdk.start();

const express = require('express');            // patched, because the SDK started first
const { trace } = require('@opentelemetry/api');
const app = express();

app.get('/readyz', (req, res) => {
  trace.getActiveSpan()?.setAttribute('app.ready', true);
  res.send('ready');
});

const server = app.listen(7260, async () => {
  const r = await fetch('http://127.0.0.1:7260/readyz');
  console.log('client got', r.status, await r.text());
  server.close();
  await sdk.shutdown();                           // flush, as on SIGTERM (see above)
});

// Real output (Node v24.19.0, @opentelemetry/sdk-node 0.223.0), `node console-span.cjs`, trimmed with …:
//   client got 200 ready
//   {
//     resource: {
//       attributes: {
//         'service.name': 'health-demo',
//         'host.name': 'MCPLMUMLPTLEN29',
//         …
//         'telemetry.sdk.name': 'opentelemetry',
//         'telemetry.sdk.version': '2.12.0'
//       }
//     },
//     instrumentationScope: {
//       name: '@opentelemetry/instrumentation-http',
//       version: '0.223.0',
//       schemaUrl: undefined
//     },
//     traceId: '03a6ca212058e76b76716eab1c4bf094',
//     parentSpanContext: undefined,
//     traceState: undefined,
//     name: 'GET /readyz',
//     id: '85018588964d386c',
//     kind: 1,
//     timestamp: 1791828091413000,
//     duration: 6888.407,
//     attributes: {
//       'http.request.method': 'GET',
//       …
//       'url.path': '/readyz',
//       …
//       'http.response.status_code': 200,
//       'http.route': '/readyz'
//     },
//     status: { code: 0 },
//     events: [],
//     links: []
//   }
//   {
//     …
//     instrumentationScope: {
//       name: '@opentelemetry/instrumentation-express',
//       version: '0.71.0',
//       schemaUrl: undefined
//     },
//     traceId: '03a6ca212058e76b76716eab1c4bf094',
//     parentSpanContext: {
//       traceId: '03a6ca212058e76b76716eab1c4bf094',
//       spanId: '85018588964d386c',
//       traceFlags: 1,
//       traceState: undefined
//     },
//     traceState: undefined,
//     name: 'request handler - /readyz',
//     id: '67bf1c1b34c48c9e',
//     kind: 0,
//     timestamp: 1791828091415000,
//     duration: 5140.039,
//     attributes: {
//       'http.route': '/readyz',
//       'express.name': '/readyz',
//       'express.type': 'request_handler',
//       'app.ready': true
//     },
//     status: { code: 0 },
//     events: [],
//     links: []
//   }
```

The express span's `parentSpanContext.spanId` is the http span's `id`, and both have the same `traceId`. `kind: 1` is `SpanKind.SERVER` and `kind: 0` is `INTERNAL`. `timestamp` and `duration` are in microseconds, so the request took about 6.9 ms. The attribute set with `trace.getActiveSpan()` landed on the express span, because that is the active span inside the handler. Lesson 107 replaces the console exporter with OTLP to a Collector.

### Common mistakes & gotchas (additional topics)

- **Exiting without flushing telemetry.** `process.exit()` right after `server.close()` drops every span still in the batch queue (edge case below). Await `sdk.shutdown()` and, if you use Sentry, `Sentry.flush()`.
- **Starting the SDK after `require('express')`.** Express and the `http` module it loads are already in the module cache, unpatched. Moving `require('express')` to the first line of the example above produced no spans at all: the client still got `200 ready`, and the console exporter printed nothing. Start the SDK first, or load it with `--require` / `--import`.
- **Counting the flush time outside the grace period.** `sdk.shutdown()` waits for the export to finish; the batch processor's `exportTimeoutMillis` defaults to 30,000 ms in sdk-trace 2.12.0. Keep the forced-exit timer from this lesson longer than a normal flush but shorter than the platform's grace period.
- **Using `SimpleSpanProcessor` in production.** It makes one export call per span. It's fine for demos and tests; production uses the batching processor.

### Edge case worked through: the spans that never left the process

The same kind of app with the default `BatchSpanProcessor`, and two ways of exiting:

javascript

```
// lost-spans.cjs: BatchSpanProcessor + an exit that skips sdk.shutdown().
// Run: node lost-spans.cjs exit       -> process.exit(0) right after the response
//      node lost-spans.cjs shutdown   -> await sdk.shutdown() first
const { NodeSDK, tracing } = require('@opentelemetry/sdk-node');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

class CountingExporter extends tracing.ConsoleSpanExporter {
  export(spans, done) {                         // print one line per span instead of the full dump
    for (const s of spans) console.log('exported span:', s.name);
    done({ code: 0 });
  }
}
const sdk = new NodeSDK({
  serviceName: 'shutdown-demo',
  // The default batching processor: spans wait in memory for up to 5 s.
  spanProcessors: [new tracing.BatchSpanProcessor(new CountingExporter())],
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});
sdk.start();

const express = require('express');
const app = express();
app.get('/work', (req, res) => res.send('done'));

const server = app.listen(7261, async () => {
  const r = await fetch('http://127.0.0.1:7261/work');
  console.log('client got', r.status);
  server.close();
  if (process.argv[2] === 'shutdown') await sdk.shutdown();   // flush the batch queue
  console.log('exiting');
  process.exit(0);
});

// Real output (Node v24.19.0, @opentelemetry/sdk-node 0.223.0):
// `node lost-spans.cjs exit`
//   client got 200
//   exiting
// `node lost-spans.cjs shutdown`
//   client got 200
//   exported span: GET /work
//   exported span: request handler - /work
//   exiting
```

Both runs served the request and exited with code 0. Only the second exported anything. In the first, the two spans were sitting in the batch queue waiting for the 5-second timer, and `process.exit(0)` ended the process first. In production this means the traces for the last few seconds before every deploy, including any request that failed during the drain, are missing. That is why `sdk.shutdown()` belongs in the ordered shutdown, right after the server has drained.

### ⭐ Interview lens (additional topics)

> **Q: “Where does telemetry flushing go in a graceful shutdown?”**  
> A: After `server.close()` has drained in-flight requests, since those requests still produce spans and errors, and before `process.exit()`. Alongside closing the DB pool and Redis, `await sdk.shutdown()` for OpenTelemetry and `await Sentry.flush(2000)` for Sentry. The forced-exit timer still bounds the total time. *Trap:* flushing before the drain loses the spans of the requests that were still finishing.

> **Q: “Metrics already show the error rate went up. Why add tracing?”**  
> A: Metrics are aggregates. They show that p99 latency rose, not which downstream call caused it for a given request. A trace shows one request's spans across services with their timings, so you can see that the time went into, say, waiting for a pool connection in the orders service. Lesson 107 builds this; lesson 108 turns the metrics into SLO-based alerts.
