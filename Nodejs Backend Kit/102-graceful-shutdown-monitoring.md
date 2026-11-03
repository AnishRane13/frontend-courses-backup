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

## Say it in 30 seconds

Graceful shutdown means your process catches SIGTERM, the polite stop signal, stops taking new work, finishes requests it already has, closes the database and Redis, and then exits. Platforms send that signal on every deploy, scale-down, and node drain, and Node's default is to quit immediately and abandon those requests. The trade-off is a stuck request: you need a timer that forces the exit, or shutdown waits forever and the platform kills you anyway.

## Why it matters

In a modern deployment the process is killed constantly, and that is normal. A rolling deploy stops the old version. Autoscaling removes instances. A Kubernetes node drain evicts pods. A crash restarts the process. The question is what happens to requests already in flight. Done badly, a payment is cut off half-committed, a database write is left dangling, or a queued job is lost. Done right, the app stops accepting new work, finishes what it started, closes connections, and exits.

The platform also needs to know whether the instance is alive and whether it should receive traffic. You need latency, error rate, and resource use before users tell you. Shutdown plus health and monitoring is what makes the service operable. "What happens when Kubernetes sends SIGTERM?" is the interview question.

## The concept, simply

When an orchestrator wants the process to stop, it sends **SIGTERM**, a polite please shut down. **SIGKILL** cannot be caught and kills immediately. **SIGINT** is what Ctrl-C sends in a terminal. Node's default on SIGTERM is to exit at once and abandon in-flight work. Graceful shutdown catches the signal and tears down in order.

The order is fixed. Stop taking new requests. Let in-flight requests finish, which is the drain. Close resources: the database pool, Redis, queue consumers, and flush logs and metrics. Exit with code 0. A forced-exit timer is the fifth piece. If a request is stuck, the timeout exits anyway so shutdown cannot hang.

![Ordered sequence for graceful shutdown on SIGTERM flip readiness to not-ready stop accepting connections drain in-flight requests close resources exit and a forced-exit safety timer](assets/i63_01_85ccfa6f.svg)

Graceful shutdown on SIGTERM: mark not-ready so the load balancer stops routing, stop accepting new connections, drain in-flight requests, close the database, Redis, and consumers, then exit, with a forced-exit timer as a safety net.

**Liveness** answers "is the process alive, or wedged and needing a restart?" Fail it and the platform kills and restarts the instance. **Readiness** answers "should this instance receive traffic right now?" Fail it and the load balancer stops routing, and the process stays up. On SIGTERM you flip readiness to not-ready first, so traffic drains while current requests finish.

**Monitoring** is the same instinct, always on: latency, throughput, error rate, event-loop lag, and memory, plus structured logs on stdout, and traces.

## How it works

Register handlers for SIGTERM and, for local dev, SIGINT. The linchpin is `server.close()`. It stops the HTTP server accepting new connections, keeps existing ones open until their requests finish, then runs your callback. In that callback, `await pool.end()`, `await redis.quit()`, stop queue consumers, flush metrics and logs, and exit.

Two details make this work. Idle keep-alive sockets can hold `server.close()` forever, because the connection is open and there is no active request. `server.closeIdleConnections()`, or the more aggressive `closeAllConnections()`, clears them. `server.keepAliveTimeout` helps too. Second, the load balancer must stop sending before you close. Flip the readiness probe to not-ready, wait a beat, then stop accepting. In Kubernetes the pod's `preStop` hook and `terminationGracePeriodSeconds` are part of that same window.

The forced-exit timer is required: `setTimeout(() => process.exit(1), 10_000).unref()`. A slow upstream or a stuck query must not block shutdown until the platform sends SIGKILL. `unref` means the timer itself does not keep the process alive if everything else finished.

Health routes are ordinary HTTP. `/healthz`, liveness, returns 200 as long as the process can respond. Keep it cheap and free of dependencies, so a slow database does not cause restarts. `/readyz`, readiness, checks that the database and Redis are reachable, and returns 503 once shutdown has begun. For metrics, a Prometheus `/metrics` endpoint via `prom-client` is common. Watch **event-loop lag**. Rising lag means the loop is blocked, which is the Node-specific failure.

`uncaughtException` and `unhandledRejection` mean the process is in an unknown state. Log, try a fast cleanup, and exit. Let the supervisor start a fresh process. Do not keep serving.

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

- **No SIGTERM handler.** Node exits immediately, so every deploy kills in-flight requests.
- **No forced-exit timer.** A hung request means `server.close()` never calls back, and the platform SIGKILLs you. Add an unref'd timeout.
- **Idle keep-alive sockets block `server.close()`.** Close idle connections, or set a keep-alive timeout.
- **Dependency checks on the liveness probe.** A brief database blip restarts the process. Deep checks belong on readiness.
- **Closing the server before the load balancer stops routing.** Flip readiness first. In Kubernetes, also mind `preStop` and the grace period.
- **Continuing after `uncaughtException`.** The process state is unknown. Log and exit.
- **A handler that is not idempotent.** Signals can arrive twice. Guard so shutdown starts once.
- **Ignoring event-loop lag.** High lag means the loop is blocked. It is the Node-specific health signal.
- **A drain timeout longer than `terminationGracePeriodSeconds`.** The platform SIGKILLs you mid-drain. Keep the forced exit shorter than the platform grace period.

## Best practices

- **Catch SIGTERM and SIGINT.** Order: readiness to not-ready, `server.close()`, close the database, Redis, and consumers, exit 0.
- **An unref'd forced-exit timer**, shorter than the platform grace period.
- **Close idle keep-alive connections** and set a sane `keepAliveTimeout`.
- **Liveness is cheap and has no dependencies. Readiness checks dependencies and reports draining.**
- **Make the handler idempotent** and log each step.
- **On `uncaughtException` and `unhandledRejection`, log and exit.** Let the supervisor restart.
- **Expose metrics and watch event-loop lag, error rate, latency, and memory.**
- **Log structured JSON to stdout**, with request ids.
- **Send a real SIGTERM under load** and confirm in-flight requests finish.

## ⭐ Interview lens

> **Q: What happens when Kubernetes sends your pod SIGTERM, and what should happen?**  
> A: SIGTERM is the polite stop. SIGKILL cannot be caught. Node's default is to exit on SIGTERM immediately, which kills requests already in flight, including a payment or a database write halfway done. The handler should drain in order. Flip readiness to not-ready so the load balancer stops sending, which in Kubernetes is also what `preStop` and removing the pod from endpoints are doing. Call `server.close()` so new connections are refused and current requests can finish. Then close the pool, Redis, and queue consumers, flush telemetry, and exit 0. A forced-exit timer, `setTimeout` plus `unref`, must fire first if something hangs, and it must be shorter than `terminationGracePeriodSeconds` or the kubelet sends SIGKILL mid-drain. For example, a 10 second timer inside a 30 second grace period. The limit is keep-alive. Idle sockets have no active request, so `server.close()` can wait forever unless you call `closeIdleConnections()` or set `keepAliveTimeout`. Make the handler idempotent, because the signal can arrive twice.

> **Q: Liveness vs readiness probe — what's the difference?**  
> A: Liveness answers whether the process is alive or wedged. If it fails, the platform restarts the instance. Readiness answers whether the instance should get traffic right now. If it fails, the load balancer takes it out and does not kill it. That split is what makes a zero-downtime shutdown possible: on SIGTERM you fail readiness first, traffic moves away, and the process stays up to finish current requests. `/healthz` should be cheap and dependency-free, a 200 as long as the event loop can respond. `/readyz` may check the database and Redis, and it must return 503 once shutdown has started. For example, a five-second database blip should mark the pod not-ready, not restart every replica. The limit is putting that database check on liveness. You then get a restart storm, and the restarts make the database worse. The same split shows up in monitoring: event-loop lag tells you the process is wedged before users do, which is closer to a liveness problem than a traffic-routing problem.

> **Q: Why do you need a forced-exit timeout during shutdown?**  
> A: `server.close()` runs your callback only after in-flight requests finish. One stuck request, a slow upstream or a hung query, means the callback never runs and shutdown waits until the platform gives up and sends SIGKILL. You then lose the graceful part, the flush and the clean pool close, and you still drop the stuck request. An unref'd timer, `setTimeout(() => process.exit(1), 10_000).unref()`, guarantees you exit inside a bound. `unref` matters so the timer does not keep the process alive when everything else already finished cleanly. The number has to be shorter than the platform's grace period, `terminationGracePeriodSeconds` on Kubernetes, because that grace includes your whole drain. For example, a 20 second timer inside a 30 second grace period leaves room for a `preStop` sleep. The limit is a timer that is longer than the platform's. The platform wins, and it wins with SIGKILL, which you cannot catch.

> **Q: Why does `server.close()` sometimes never complete?**  
> A: `server.close()` stops accepting new connections and waits until existing ones go idle. HTTP keep-alive leaves sockets open with no active request, so they never "finish," and the callback never runs. From the outside it looks like shutdown is hung, and the platform eventually SIGKILLs the pod. Call `server.closeIdleConnections()` so those idle sockets drop, or `closeAllConnections()` if you must be more aggressive, and set `keepAliveTimeout` so idle sockets do not live forever in normal traffic either. For example, a client that keeps one connection open for many requests will pin the drain until you close idle connections, even though no handler is running. The limit is closing too early in the other direction. If you `server.close()` before the load balancer has stopped sending, new requests hit a server that is already closing. Flip readiness to not-ready, wait briefly, and then close. The forced-exit timer is still required, because a request that is actually stuck is not an idle socket.

## Cheat-card

- **SIGTERM** is the polite stop. Catch it. **SIGKILL** cannot be caught. **SIGINT** is Ctrl-C.
- Drain order: readiness to not-ready, `server.close()`, close the database, Redis, and consumers, `exit(0)`.
- An unref'd **forced-exit timer**, shorter than the platform grace period.
- `server.close()` can hang on idle keep-alive. Use `closeIdleConnections()` and `keepAliveTimeout`.
- **Liveness** asks "alive?" and a failure restarts. **Readiness** asks "take traffic?" and a failure does not restart.
- `uncaughtException` and `unhandledRejection`: log and exit. Let the supervisor restart.
- Watch **event-loop lag**, plus latency, error rate, and memory. Log JSON to stdout.
- The handler must be idempotent. Test shutdown under load.

## Good to know

- **Should you keep running after `uncaughtException`?** No. The process is in an undefined state, so continuing risks corrupt data. Log, try a fast cleanup, and exit so PM2 or Kubernetes starts a fresh process. This is a last resort, not normal error handling. The same goes for `unhandledRejection`.
- **Which Node-specific metric do you watch?** Event-loop lag. Your code runs on one thread, so rising lag means the loop is blocked by synchronous work and requests are queueing even if CPU looks fine. It is the early signal for the failure that worker threads and clustering exist to avoid. Also watch latency, error rate, and memory.
- **Flush telemetry on shutdown:** `await sdk.shutdown()` for OpenTelemetry and `await Sentry.flush(2000)` after `server.close()` drains and before exit. A bare `process.exit()` drops the batch queue, whose default is 5 seconds.
- **Start the tracing SDK before `require('express')`**, or use `--require` or `--import`, or nothing gets patched.
- **Next:** traces, Collector, and sampling are in [111](107-observability-with-opentelemetry.md). Sentry, SLOs, and burn-rate alerts are in [112](108-apm-and-alerting.md).

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
