---
title: "Observability with OpenTelemetry"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Observability with OpenTelemetry

*28 min read · Updated 12 Oct 2026 · Topic 111 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, @opentelemetry/sdk-node 0.223.0, @opentelemetry/auto-instrumentations-node 0.81.0 (instrumentation-http 0.223.0, instrumentation-express 0.71.0, instrumentation-undici 0.33.0, instrumentation-pg 0.75.0), @opentelemetry/api 1.9.1, @opentelemetry/sdk-trace and sdk-metrics 2.12.0, pg 8.23.1, PostgreSQL 18.4 (run locally, no Docker), OpenTelemetry Collector Contrib (`otelcol-contrib`) 0.162.0 and Jaeger 2.22.0 (both official release binaries, checksums verified)

---

## Why it matters

A user reports that checkout "sometimes takes five seconds". Checkout touches a gateway, an orders service and PostgreSQL. Each one has its own logs, and nothing in those logs says which lines belong to the same click. You can see that the gateway was slow, but not whether it was waiting on the orders service, the orders service waiting on a pool connection, or the database running a bad plan.

**Observability** is being able to answer that kind of question from the data your services already emit, without shipping new code first. It needs three kinds of data and one thing that ties them together:

- **Traces** show one request's path through every service, with timings for each step.
- **Metrics** are numbers aggregated over time (request rate, error count, latency histogram), cheap enough to keep for every request and to alert on (lesson [112](108-apm-and-alerting.md)).
- **Logs** are the detailed event lines you already write (lesson [56](90-logging.md)).
- **Context propagation** carries a trace id from service to service, so all three can be joined for one request.

**OpenTelemetry (OTel)** is the vendor-neutral standard for producing all of this: an API your code calls, an SDK that records and exports, instrumentation libraries that patch Express, `pg`, `fetch` and others for you, a wire protocol (**OTLP**), and a standalone process, the **Collector**, that receives, processes and forwards the data. Because the format is standard, you can send the same data to Jaeger, Grafana Tempo, Datadog or New Relic by changing exporter config instead of re-instrumenting.

## The concept, simply

A **trace** is the record of one operation, usually one incoming request, across every process it touched. It is a tree of **spans**. A span is one timed unit of work with these concrete fields (all taken from the real output in Example 3):

| Field | Real value | What it is |
|---|---|---|
| Trace ID | `5636fe4773653b2168607e9a80e44f37` | 16 random bytes (32 hex chars), shared by every span in the trace |
| Span ID | `c0460ad1b584ddf9` | 8 random bytes (16 hex chars), unique per span |
| Parent ID | empty for the root; `c0460ad1b584ddf9` for its child | The span ID of the caller; this is what builds the tree |
| Name | `GET /checkout/:orderId` | Low-cardinality operation name (the route, not the URL) |
| Kind | `Server`, `Client`, `Internal` | Server = handled an incoming call; Client = made an outgoing call |
| Start / end time | `17:54:10.785` → `17:54:10.846` | Duration = end − start |
| Attributes | `http.route: /checkout/:orderId`, `http.response.status_code: 200`, `db.query.text: SELECT …` | Key/value facts about this span; names follow the OTel **semantic conventions** |
| Status | `Unset` (or `Error`) | Whether the operation failed |

A **resource** describes the process that produced the data, not the request: `service.name: checkout`, `host.name`, `process.pid`, `process.runtime.version: 24.19.0`, `telemetry.sdk.version: 2.12.0`. Every span, metric point and log record from that process carries the same resource. The **instrumentation scope** names the library that created the span (`@opentelemetry/instrumentation-express 0.71.0`).

A **metric** is a named instrument (counter, histogram, gauge) whose measurements the SDK aggregates in memory and exports every interval. A counter `invoices_processed` that you call `add(1)` on three times is exported as one data point with `Value: 3` (Example 6). A **log record** becomes correlated with a trace when it carries the same `trace_id` and `span_id`.

**Context propagation across services.** Inside one process, the SDK keeps the "current span" in an `AsyncLocalStorage`-based context manager, so when the Express handler calls `fetch()`, the fetch instrumentation finds the handler's span and makes it the parent of the new client span. Across processes there is no shared memory, so the client puts the context into a request header and the server reads it back. OTel's default propagator uses the W3C Trace Context header **`traceparent`**. The value service B received in Example 3 was:

text

```
traceparent: 00-5636fe4773653b2168607e9a80e44f37-39ef6bbf9d8ffcce-01
             │  │                                │                └─ trace-flags: 01 = sampled
             │  │                                └─ parent-id: the caller's client span (the fetch)
             │  └─ trace-id: the same id A's spans use
             └─ version: 00
```

Service B's SDK reads this header, continues trace `5636…4f37`, and makes its server span a child of `39ef6bbf9d8ffcce`. That one header is why the two services' spans line up in one tree.

![A correlation id threads one request: the client calls an API gateway, which mints an x-request-id if none is present; the auth service and the orders service log the same id; a log aggregator filters by requestId to show every hop's line in order. The footer says to propagate via headers plus AsyncLocalStorage.](assets/i53_02_6cd24834.svg)
*Figure: the correlation-id pattern from lesson [56](90-logging.md): a gateway mints `x-request-id`, and every hop passes it on in a header and keeps it in `AsyncLocalStorage`. Look at: the same id in every box, which in OpenTelemetry is the trace id carried in `traceparent`.*

The figure is the hand-rolled version of the same idea. In OpenTelemetry, the W3C `traceparent` header plays the role of `x-request-id`: the trace id is the correlation id, and you don't write the middleware. The SDK's AsyncLocalStorage context manager carries it inside each process, and the http and undici instrumentations write and read the header at every hop, adding a fresh parent span id each time so the backend can rebuild the tree, not just a flat list of lines.

## How it works

What happens for one request through the two services in this lesson:

1. **Start-up.** `node --import ./telemetry.mjs service-a.mjs` runs `telemetry.mjs` before the app. It registers the ESM loader hook, creates a `NodeSDK` with an OTLP exporter, a sampler and the auto-instrumentations, and calls `sdk.start()`. The instrumentations hook module loading, so when the app later imports `express` and `pg`, they get patched copies.
2. **Request arrives at A.** The http instrumentation sees no `traceparent` header, so this is a **root span**. The sampler decides now, once, whether this trace is recorded (Example 5). The decision becomes bit `01` of the trace flags.
3. **Express runs the route.** The express instrumentation starts a child span `request handler - /checkout/:orderId` and sets `http.route`, which also renames the server span from `GET` to `GET /checkout/:orderId`.
4. **A calls B with `fetch`.** The undici instrumentation starts a `Client` span and injects `traceparent: 00-<trace-id>-<client-span-id>-01` into the outgoing request.
5. **B receives it.** B's http instrumentation extracts the header and starts a `Server` span whose parent is A's client span. A parent-based sampler copies the `01`/`00` flag instead of deciding again.
6. **B queries PostgreSQL.** The pg instrumentation creates `pg-pool.connect`, `pg.connect` and `pg.query:SELECT app` spans with `db.system.name`, `db.namespace` and `db.query.text`.
7. **Spans end and are buffered.** Each process keeps finished spans in a `BatchSpanProcessor` queue (defaults in 2.12.0: 2,048 spans queued, 512 per export, every 5,000 ms) and sends them with OTLP/HTTP protobuf to the Collector at `127.0.0.1:7241`.
8. **The Collector processes and fans out.** Its pipeline is receivers → processors → exporters. Here: `otlp` receiver → `batch` processor → `debug` (print to stdout) and `otlp_grpc/jaeger` (forward to Jaeger).
9. **Jaeger stores and serves.** Jaeger groups spans by trace id and serves them on its query API (`/api/v3/traces/<id>`), where Example 4 rebuilds the tree.

**SDK setup and auto-instrumentation.** `@opentelemetry/sdk-node` wires together a tracer provider, a meter provider, a logger provider, resource detection, the propagators and the instrumentations. `@opentelemetry/auto-instrumentations-node` 0.81.0 bundles 41 instrumentations, and `getNodeAutoInstrumentations()` returned 39 of them: all except `fs` and `host-metrics`, which are off by default. You can configure one by its package name, for example `'@opentelemetry/instrumentation-net': { enabled: false }`, or with the environment variables `OTEL_NODE_ENABLED_INSTRUMENTATIONS` and `OTEL_NODE_DISABLED_INSTRUMENTATIONS` (short names such as `http,express,pg`). If you only want a few, install them separately (`@opentelemetry/instrumentation-http`, `-express`, `-pg`, `-undici`) and pass instances, as the lesson 102 appendix does.

**CommonJS vs ESM loading.** Instrumentations work by intercepting module loading, so they have to be installed before the module they patch is loaded.

| App type | Start command | Why |
|---|---|---|
| CommonJS | `node --require ./telemetry.cjs app.js`, or start the SDK at the top of the entry file before the first `require('express')` | `require()` goes through `Module._load`, which the instrumentation hooks (require-in-the-middle) |
| ESM | `node --import ./telemetry.mjs app.mjs`, where `telemetry.mjs` calls `module.register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)` before starting the SDK | `import` does not go through `require()`. The loader hook (import-in-the-middle) is what lets instrumentations patch ES module imports |
| ESM, as written in OTel's `esm-support.md` | `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./telemetry.mjs app.mjs` | Same hook. On Node v24.19.0 this prints `ExperimentalWarning: --experimental-loader may be removed in the future; instead use register()` |
| Zero-code | `node --require @opentelemetry/auto-instrumentations-node/register app.js` (ESM adds the loader hook) | The `register` entry point builds the SDK from `OTEL_*` environment variables |

OTel's own ESM document (`doc/esm-support.md` in opentelemetry-js) still documents the `--experimental-loader` form and says the recommendation will move to `module.register(...)`. This lesson uses `register()` inside `telemetry.mjs` because it worked on Node v24.19.0 without the warning (Example 3). Example 7 shows what you lose without any hook.

**Exporters and the Collector.** An exporter turns finished spans or metric points into a wire format. In the Node SDK the choices are OTLP over HTTP/protobuf (`@opentelemetry/exporter-trace-otlp-proto`, used here), OTLP over HTTP/JSON (`-otlp-http`), OTLP over gRPC (`-otlp-grpc`), Zipkin, Prometheus (metrics, pull) and the console exporters for debugging. OTLP's standard ports are 4317 (gRPC) and 4318 (HTTP); this lesson moves them to 7240/7241 because other processes share the machine. You could export straight from the app to a vendor, but most setups send OTLP to a Collector next to the app (a sidecar or a host agent). The Collector then:

- takes retries, batching and back-pressure off the app process;
- holds the vendor credentials, so app containers don't;
- can drop, rename or redact attributes (`attributes`, `transform`, `filter` processors) before data leaves your network;
- can do **tail sampling** (`tail_sampling` processor): it keeps whole traces after seeing them, for example every trace with an error;
- lets you change backends, or send to two at once, by editing YAML.

`otelcol-contrib` is the distribution that includes the community components (`tail_sampling`, `datadog`, `file` and many more). The core `otelcol` distribution is smaller. In 0.162.0 the OTLP exporters are listed as `otlp_grpc` and `otlp_http`. The older names `otlp` and `otlphttp`, which most tutorials use, still passed `otelcol-contrib validate` in this lesson's run.

**Sampling.** Recording every span of every request costs CPU in the app, network, and storage at the backend. **Head sampling** decides at the root span, before anything is known about the request:

- `TraceIdRatioBasedSampler(0.25)` keeps a trace when a number computed from the trace id falls below 25 % of the range. The function is deterministic: the same trace id always gets the same answer.
- `ParentBasedSampler({ root })` uses `root` only for spans with no parent. For a span with a parent, it follows the parent's sampled flag from `traceparent`. That is what keeps a trace whole: if A dropped it, B drops it too, and if A kept it, B keeps it.
- An unsampled span is a non-recording span. It still has a trace id and is still propagated (flag `00`), but nothing is exported.
- The same setup from environment variables: `OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.25`.

Head sampling can't prefer errors or slow requests, because it decides before they happen. Tail sampling in the Collector can, at the cost of buffering whole traces in the Collector's memory.

**PostgreSQL spans.** `instrumentation-pg` 0.75.0 patches `pg/lib/client.js` and `pg-pool`, and records the SQL text with its `$1` placeholders, not the values, as `db.query.text`. The `pg-pool.connect` span shows time spent waiting for a pool connection, which is how a trace tells "the pool was exhausted" (lesson [46](74-connection-pooling.md)) apart from "the query was slow". Long, unique SQL strings make span names and attributes high-cardinality, so keep queries parameterized.

## Code examples

**Example 1 — download and verify the Collector and Jaeger (no root, no Docker).**

The archives come from the projects' GitHub release pages: `otelcol-contrib_0.162.0_linux_amd64.tar.gz` (112 MB) from `open-telemetry/opentelemetry-collector-releases` tag `v0.162.0`, and `jaeger-2.22.0-linux-amd64.tar.gz` (65 MB) from `jaegertracing/jaeger` tag `v2.22.0`. The link here was slow, so they were fetched with parallel ranged `curl -r` requests and joined; a plain `curl -sLO <url>` gives the same file. The collector project publishes a `.sha256` file per archive, and Jaeger publishes checksums for the binaries inside its archive:

bash

```
$ B=~/.cache/nodekit-repair-tools/pass7/B3
$ cd $B/dl/otel
$ curl -sL -o c.sha256 https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.162.0/otelcol-contrib_0.162.0_linux_amd64.tar.gz.sha256
$ cat c.sha256; echo; sha256sum otelcol-contrib_0.162.0_linux_amd64.tar.gz
fcc063749f730f8c21fe29f2d340ff174f5f1c5885bd3156fb6c985a3036fcc3
fcc063749f730f8c21fe29f2d340ff174f5f1c5885bd3156fb6c985a3036fcc3  otelcol-contrib_0.162.0_linux_amd64.tar.gz
$ mkdir -p x && tar xzf otelcol-contrib_0.162.0_linux_amd64.tar.gz -C x && cp x/otelcol-contrib $B/bin/
$ $B/bin/otelcol-contrib --version
otelcol-contrib version 0.162.0
$ cd $B/dl/jaeger
$ curl -sLO https://github.com/jaegertracing/jaeger/releases/download/v2.22.0/jaeger-2.22.0-linux-amd64.sha256sum.txt
$ tar xzf jaeger-2.22.0-linux-amd64.tar.gz && sha256sum -c jaeger-2.22.0-linux-amd64.sha256sum.txt
jaeger-2.22.0-linux-amd64/example-hotrod: OK
jaeger-2.22.0-linux-amd64/jaeger: OK
$ cp jaeger-2.22.0-linux-amd64/jaeger $B/bin/
$ $B/bin/jaeger version 2>/dev/null
{"gitCommit":"462bb49fcff9af4be9556bf0206d07f5171bd8d7","gitVersion":"v2.22.0","buildDate":"2026-10-06T11:44:34Z"}
```

**Example 2 — the Collector and Jaeger configs, validated and then run.**

yaml

```
# collector.yaml: receive OTLP from the Node services, batch, then
# print to stdout (debug) and forward to Jaeger (otlp_grpc).
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:7240
      http:
        endpoint: 127.0.0.1:7241

processors:
  batch:
    timeout: 1s

exporters:
  debug:
    verbosity: detailed
  otlp_grpc/jaeger:
    endpoint: 127.0.0.1:7250
    tls:
      insecure: true

service:
  telemetry:
    metrics:
      level: none
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug, otlp_grpc/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
```

yaml

```
# jaeger.yaml: Jaeger v2 with in-memory storage, OTLP in on 7250, query API/UI on 7252.
service:
  extensions: [jaeger_storage, jaeger_query]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [jaeger_storage_exporter]
  telemetry:
    metrics:
      level: none

extensions:
  jaeger_storage:
    backends:
      mem:
        memory:
          max_traces: 10000
  jaeger_query:
    storage:
      traces: mem
    http:
      endpoint: 127.0.0.1:7252
    grpc:
      endpoint: 127.0.0.1:7253

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 127.0.0.1:7250

processors:
  batch:

exporters:
  jaeger_storage_exporter:
    trace_storage: mem
```

`service.telemetry.metrics.level: none` turns off each binary's own Prometheus endpoint, which defaults to port 8888 and would clash between the two. `otlp_grpc/jaeger` is the `otlp_grpc` exporter with the instance name `jaeger`. Jaeger v2 is built on the Collector, so its config has the same shape.

bash

```
$ BIN=~/.cache/nodekit-repair-tools/pass7/B3/bin
$ $BIN/otelcol-contrib validate --config=collector.yaml; echo "exit $?"
exit 0
$ $BIN/jaeger validate --config=jaeger.yaml > /dev/null 2>&1; echo "exit $?"
exit 0
$ sed 's/verbosity: detailed/verbosty: detailed/' collector.yaml > bad.yaml
$ $BIN/otelcol-contrib validate --config=bad.yaml; echo "exit $?"
Error: failed to get config: cannot unmarshal the configuration: decoding failed due to the following error(s):

'exporters' error reading configuration for "debug": decoding failed due to the following error(s):

'debugexporter.Config' has invalid keys: verbosty
exit 1
$ $BIN/jaeger --config=jaeger.yaml > logs/jaeger.log 2>&1 &
$ $BIN/otelcol-contrib --config=collector.yaml > logs/col.log 2>&1 &
$ sleep 2
$ grep 'Everything is ready' logs/col.log logs/jaeger.log | cut -c1-120
logs/col.log:2026-10-12T23:16:10.512+0530	info	service@v0.162.0/service.go:256	Everything is ready. Begin running and proc
logs/jaeger.log:2026-10-12T23:10:12.611+0530	info	service@v0.160.0/service.go:284	Everything is ready. Begin running and proc
```

**Example 3 — two Express 5 services, one trace, one `traceparent` header.**

The SDK bootstrap, loaded with `--import` before each service:

javascript

```
// telemetry.mjs: start the OpenTelemetry SDK before any app code.
// ESM app:  node --import ./telemetry.mjs app.mjs
import { register } from 'node:module';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';

// ESM imports bypass require(), so instrumentations cannot patch them without a
// loader hook. This registers it for every module loaded after this file.
if (process.env.NO_ESM_HOOK !== '1') {
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
}

const { ParentBasedSampler, TraceIdRatioBasedSampler } = tracing;
const ratio = Number(process.env.SAMPLE_RATIO ?? '1');

const sdk = new NodeSDK({
  // defaultResource() keeps telemetry.sdk.*; service.name comes from OTEL_SERVICE_NAME.
  resource: defaultResource().merge(resourceFromAttributes({ 'deployment.environment.name': 'local' })),
  traceExporter: new OTLPTraceExporter({ url: 'http://127.0.0.1:7241/v1/traces' }),
  // Root spans: keep `ratio` of traces. Spans with a parent: copy the parent's decision.
  sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(ratio) }),
  instrumentations: [getNodeAutoInstrumentations({
    // Express 5 runs on the `router` package; the express and router
    // instrumentations both wrap the same layers. Keep one.
    '@opentelemetry/instrumentation-router': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },   // tcp.connect spans
    '@opentelemetry/instrumentation-dns': { enabled: false },
  })],
});
sdk.start();

// Flush buffered spans on shutdown (lesson 102).
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => sdk.shutdown().finally(() => process.exit(0)));
}
```

Service A, the gateway, calls B with `fetch`:

javascript

```
// service-a.mjs: "checkout" gateway on 7230; calls service B with fetch.
import express from 'express';
import { trace, TraceFlags } from '@opentelemetry/api';

const app = express();
app.get('/checkout/:orderId', async (req, res) => {
  const span = trace.getActiveSpan();                 // the express request-handler span
  span?.setAttribute('app.order_id', req.params.orderId);
  // fetch is instrumented (undici): it starts a client span and adds `traceparent`.
  const r = await fetch(`http://127.0.0.1:7231/orders/${req.params.orderId}`);
  const ctx = span?.spanContext();
  res.status(r.status).json({
    traceId: ctx?.traceId,
    sampled: Boolean((ctx?.traceFlags ?? 0) & TraceFlags.SAMPLED),
    order: await r.json(),
  });
});
app.listen(7230, () => console.log('A on 7230'));
```

Service B reads PostgreSQL 18.4 and, for this demo, prints the header it received:

javascript

```
// service-b.mjs: "orders" service on 7231; reads PostgreSQL.
import express from 'express';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const app = express();
app.get('/orders/:id', async (req, res) => {
  if (process.env.LOG_TRACEPARENT) console.log('B got traceparent:', req.get('traceparent'));
  const { rows } = await pool.query('SELECT id, status, total_cents FROM orders WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});
app.listen(7231, () => console.log('B on 7231'));
```

javascript

```
// seed.mjs: one table, two rows.
import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`DROP TABLE IF EXISTS orders;
  CREATE TABLE orders (id int PRIMARY KEY, status text NOT NULL, total_cents int NOT NULL);
  INSERT INTO orders VALUES (42, 'paid', 1999), (43, 'pending', 500);`);
console.log((await c.query('SELECT count(*)::int AS n FROM orders')).rows[0]);
await c.end();
```

Run it. The PostgreSQL server comes from the kit's `start-pg.mjs` helper (`embedded-postgres`), listening on 7210:

bash

```
$ npm init -y > /dev/null && npm pkg set type=module
$ npm install express@5.3.0 pg@8.23.1 @opentelemetry/api@1.9.1 @opentelemetry/sdk-node@0.223.0 \
    @opentelemetry/auto-instrumentations-node@0.81.0 @opentelemetry/exporter-trace-otlp-proto@0.223.0 \
    @opentelemetry/exporter-metrics-otlp-proto@0.223.0 @opentelemetry/sdk-metrics@2.12.0 \
    @opentelemetry/resources@2.12.0
…
added 262 packages, and audited 263 packages in 31s
…
$ export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7210/app
$ node seed.mjs
{ n: 2 }
$ OTEL_SERVICE_NAME=orders LOG_TRACEPARENT=1 node --import ./telemetry.mjs service-b.mjs > logs/b.log 2>&1 &
$ OTEL_SERVICE_NAME=checkout node --import ./telemetry.mjs service-a.mjs > logs/a.log 2>&1 &
$ sleep 3
$ curl -s localhost:7230/checkout/42
{"traceId":"5636fe4773653b2168607e9a80e44f37","sampled":true,"order":{"id":42,"status":"paid","total_cents":1999}}
$ kill %1 %2          # SIGTERM: sdk.shutdown() flushes the last spans
$ cat logs/b.log
B on 7231
B got traceparent: 00-5636fe4773653b2168607e9a80e44f37-39ef6bbf9d8ffcce-01
```

The Collector's `debug` exporter printed the spans it received. Trimmed to the spans that matter, with long paths cut (`…`):

text

```
2026-10-12T23:24:11.435+0530	info	ResourceSpans #0
Resource attributes:
     -> host.name: Str(MCPLMUMLPTLEN29)
     -> process.pid: Int(2047607)
     -> process.command_args: Slice(["/home/anish.r/.nvm/versions/node/v24.19.0/bin/node","--import","./telemetry.mjs",…])
     -> process.runtime.version: Str(24.19.0)
     …
     -> service.name: Str(checkout)
     -> deployment.environment.name: Str(local)
     -> telemetry.sdk.language: Str(nodejs)
     -> telemetry.sdk.name: Str(opentelemetry)
     -> telemetry.sdk.version: Str(2.12.0)
ScopeSpans #0
InstrumentationScope @opentelemetry/instrumentation-undici 0.33.0
Span #0
    Trace ID       : 5636fe4773653b2168607e9a80e44f37
    Parent ID      : 2520519bc32044cd
    ID             : 39ef6bbf9d8ffcce
    Name           : GET
    Kind           : Client
    Start time     : 2026-10-12 17:54:10.807 +0000 UTC
    End time       : 2026-10-12 17:54:10.840120213 +0000 UTC
    Status code    : Unset
Attributes:
     -> http.request.method: Str(GET)
     -> url.full: Str(http://127.0.0.1:7231/orders/42)
     -> server.port: Int(7231)
     -> http.response.status_code: Int(200)
     …
ScopeSpans #1
InstrumentationScope @opentelemetry/instrumentation-http 0.223.0
Span #0
    Trace ID       : 5636fe4773653b2168607e9a80e44f37
    Parent ID      : 
    ID             : c0460ad1b584ddf9
    Name           : GET /checkout/:orderId
    Kind           : Server
    Start time     : 2026-10-12 17:54:10.785 +0000 UTC
    End time       : 2026-10-12 17:54:10.846595308 +0000 UTC
    …
     -> url.path: Str(/checkout/42)
     -> server.port: Int(7230)
     -> http.response.status_code: Int(200)
     -> http.route: Str(/checkout/:orderId)
ScopeSpans #2
InstrumentationScope @opentelemetry/instrumentation-express 0.71.0
Span #0
    Trace ID       : 5636fe4773653b2168607e9a80e44f37
    Parent ID      : c0460ad1b584ddf9
    ID             : 2520519bc32044cd
    Name           : request handler - /checkout/:orderId
    Kind           : Internal
    …
Attributes:
     -> http.route: Str(/checkout/:orderId)
     -> express.name: Str(/checkout/:orderId)
     -> express.type: Str(request_handler)
     -> app.order_id: Str(42)
ResourceSpans #1
Resource attributes:
     …
     -> service.name: Str(orders)
     …
Span #2
    Trace ID       : 5636fe4773653b2168607e9a80e44f37
    Parent ID      : cbaad3346757b84a
    ID             : 1a0bd85c2783a6ec
    Name           : pg.query:SELECT app
    Kind           : Client
    Start time     : 2026-10-12 17:54:10.83 +0000 UTC
    End time       : 2026-10-12 17:54:10.833187236 +0000 UTC
    …
Attributes:
     -> db.system.name: Str(postgresql)
     -> db.namespace: Str(app)
     -> server.address: Str(127.0.0.1)
     -> server.port: Int(7210)
     -> db.query.text: Str(SELECT id, status, total_cents FROM orders WHERE id = $1)
ScopeSpans #1
InstrumentationScope @opentelemetry/instrumentation-http 0.223.0
Span #0
    Trace ID       : 5636fe4773653b2168607e9a80e44f37
    Parent ID      : 39ef6bbf9d8ffcce
    ID             : d84b0c3989ff98af
    Name           : GET /orders/:id
    Kind           : Server
    …
```

Follow the ids: A's fetch client span is `39ef6bbf9d8ffcce`, the header B received ends in `-39ef6bbf9d8ffcce-01`, and B's server span has `Parent ID: 39ef6bbf9d8ffcce`. Every span has trace id `5636…4f37`. The custom attribute `app.order_id` landed on the express span, because that is the active span inside the handler.

**Example 4 — read the same trace back from Jaeger's query API.**

javascript

```
// dump.mjs: print a span tree for one trace from Jaeger's API v3 (OTLP JSON).
// Usage: node dump.mjs <traceId>
const id = process.argv[2];
let result;
for (let i = 0; i < 20 && !result; i++) {        // spans reach Jaeger a few seconds late
  const body = await (await fetch(`http://127.0.0.1:7252/api/v3/traces/${id}`)).json();
  result = body.result;
  if (!result) await new Promise((r) => setTimeout(r, 500));
}
if (!result) { console.log(`trace ${id}: not found in Jaeger`); process.exit(1); }
const spans = [];
for (const rs of result.resourceSpans) {
  const svc = rs.resource.attributes.find((a) => a.key === 'service.name').value.stringValue;
  for (const ss of rs.scopeSpans) for (const s of ss.spans) spans.push({ ...s, svc, scope: ss.scope.name });
}
const kids = (pid) => spans.filter((s) => (s.parentSpanId ?? '') === pid)
  .sort((a, b) => Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)));
const ms = (s) => (Number(BigInt(s.endTimeUnixNano) - BigInt(s.startTimeUnixNano)) / 1e6).toFixed(1);
const walk = (s, depth) => {
  console.log(`${'  '.repeat(depth)}${s.svc.padEnd(9)} ${s.name}  [${s.scope.replace('@opentelemetry/', '')}] ${ms(s)} ms  span ${s.spanId}`);
  for (const k of kids(s.spanId)) walk(k, depth + 1);
};
console.log(`trace ${id}: ${spans.length} spans`);
for (const root of kids('')) walk(root, 0);

// Real output (Node v24.19.0, Jaeger 2.22.0), `node dump.mjs 5636fe4773653b2168607e9a80e44f37`:
//   trace 5636fe4773653b2168607e9a80e44f37: 8 spans
//   checkout  GET /checkout/:orderId  [instrumentation-http] 61.6 ms  span c0460ad1b584ddf9
//     checkout  request handler - /checkout/:orderId  [instrumentation-express] 59.2 ms  span 2520519bc32044cd
//       checkout  GET  [instrumentation-undici] 33.1 ms  span 39ef6bbf9d8ffcce
//         orders    GET /orders/:id  [instrumentation-http] 21.5 ms  span d84b0c3989ff98af
//           orders    request handler - /orders/:id  [instrumentation-express] 19.3 ms  span cbaad3346757b84a
//             orders    pg-pool.connect  [instrumentation-pg] 10.5 ms  span 4368b1dfbc5db530
//               orders    pg.connect  [instrumentation-pg] 8.6 ms  span 7ff979014bc89110
//             orders    pg.query:SELECT app  [instrumentation-pg] 3.2 ms  span 1a0bd85c2783a6ec
```

`curl -s localhost:7252/api/v3/services` returned `{"services":["checkout","orders"]}`. The same trace is visible in the Jaeger UI at `http://127.0.0.1:7252/` (not screenshotted here). The tree reads like a profile across processes. Of the 33.1 ms the fetch took, B's server span covered 21.5 ms. Of that, 10.5 ms went to getting the first pool connection (`pg-pool.connect`, which includes 8.6 ms of `pg.connect`: a new TCP connection plus authentication), and the query itself took 3.2 ms. Single run on one laptop, first request after start-up; other processes were using the machine, so read the numbers as proportions, not benchmarks.

As a fenced diagram, the parent links are:

text

```
trace 5636…4f37
checkout ─ GET /checkout/:orderId        (Server, root, parent = none)
           └ request handler             (Internal, express)
             └ GET  ── traceparent ──►   (Client, undici)  span 39ef…fcce
orders       └ GET /orders/:id           (Server, parent = 39ef…fcce)
               └ request handler         (Internal, express)
                 ├ pg-pool.connect → pg.connect
                 └ pg.query:SELECT app
```

**Example 5 — parent-based ratio sampling, 1,000 requests at 25 %.**

javascript

```
// sample-run.mjs: send N requests to service A, then count what reached Jaeger.
// Usage: node sample-run.mjs 400
const n = Number(process.argv[2] ?? 400);
const t0 = Date.now() * 1000;                      // Jaeger wants microseconds here
let sampled = 0;
for (let i = 0; i < n; i++) {
  const body = await (await fetch('http://127.0.0.1:7230/checkout/42')).json();
  if (body.sampled) sampled++;
}
console.log(`requests: ${n}, sampled flag set on ${sampled} (${(100 * sampled / n).toFixed(1)}%)`);
await new Promise((r) => setTimeout(r, 8000));     // SDK batch delay (5 s) + collector batch (1 s)

const t1 = Date.now() * 1000;
const seen = {};
for (const svc of ['checkout', 'orders']) {
  const q = new URLSearchParams({
    'query.service_name': svc,
    'query.start_time_min': new Date(t0 / 1000).toISOString(),
    'query.start_time_max': new Date(t1 / 1000).toISOString(),
    'query.search_depth': '1000',
  });
  const body = await (await fetch(`http://127.0.0.1:7252/api/v3/traces?${q}`)).json();
  const ids = new Set();
  for (const rs of body.result?.resourceSpans ?? [])
    for (const ss of rs.scopeSpans) for (const s of ss.spans) ids.add(s.traceId);
  seen[svc] = ids;
  console.log(`Jaeger traces containing service ${svc}: ${ids.size}`);
}
const both = [...seen.checkout].filter((id) => seen.orders.has(id)).length;
console.log(`traces with spans from both services: ${both}`);

// Real output (Node v24.19.0, Jaeger 2.22.0), both services started with SAMPLE_RATIO=0.25
// (B also with LOG_TRACEPARENT=1), `node sample-run.mjs 1000`:
//   requests: 1000, sampled flag set on 250 (25.0%)
//   Jaeger traces containing service checkout: 250
//   Jaeger traces containing service orders: 250
//   traces with spans from both services: 250
```

Earlier runs while writing this lesson gave 25.3 % (of 400), 25.8 % and 25.7 % (of 1,000): about a quarter each time, varying because trace ids are random. Every kept trace contains both services, and no trace has only one, because B never made its own decision. In the run above, B's log has 250 headers ending in `-01` and 750 ending in `-00` (`grep -c`). The first four:

text

```
B got traceparent: 00-2a747cfe73b378217aa5a2460bb5ea05-07f843db34c8101d-01
B got traceparent: 00-ed2431df65d34ea1339de576043702a4-c22b9ff2ba945f1d-00
B got traceparent: 00-2138fedcc334203a97bbbeeb1aab249c-56f1b8777099748a-00
B got traceparent: 00-9fe371718bf8e1c9bb1f3d5ee70883af-d199dc6d5639f094-00
```

Unsampled requests still carry a trace id and a header (`-00`), so log lines can still be joined by `trace_id` even when no spans were stored.

**Example 6 — a metric and a log line that carries the trace id.**

javascript

```
// metrics-logs.mjs: one span, one counter, one histogram and one log line that carries the trace id.
// Run: node metrics-logs.mjs   (collector must be listening on 7241)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { trace, metrics } from '@opentelemetry/api';

const sdk = new NodeSDK({
  serviceName: 'billing-job',
  traceExporter: new OTLPTraceExporter({ url: 'http://127.0.0.1:7241/v1/traces' }),
  metricReaders: [new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: 'http://127.0.0.1:7241/v1/metrics' }),
    exportIntervalMillis: 60_000,                 // shutdown() below forces a final export
  })],
});
sdk.start();

const tracer = trace.getTracer('billing');
const meter = metrics.getMeter('billing');
const invoices = meter.createCounter('invoices_processed', { description: 'Invoices handled' });
const amount = meter.createHistogram('invoice_amount', { unit: 'USD' });

await tracer.startActiveSpan('process-invoices', async (span) => {
  for (const usd of [12, 40, 7]) {
    invoices.add(1, { 'invoice.currency': 'USD' });
    amount.record(usd);
  }
  const { traceId, spanId } = span.spanContext();
  // A log line is correlated with its trace by carrying these two ids.
  console.log(JSON.stringify({ level: 'info', msg: 'invoices done', trace_id: traceId, span_id: spanId }));
  span.end();
});
await sdk.shutdown();                            // flush spans and metrics

// Real output (Node v24.19.0, @opentelemetry/sdk-node 0.223.0), `node metrics-logs.mjs`:
//   {"level":"info","msg":"invoices done","trace_id":"b5d3f646226954f657d1a580446b6063","span_id":"7a788c3decf4b271"}
```

The Collector's `debug` output for the same run (trimmed with `…`; the traces and metrics pipelines print independently, so their order in the log varies between runs):

text

```
InstrumentationScope billing 
Span #0
    Trace ID       : b5d3f646226954f657d1a580446b6063
    Parent ID      : 
    ID             : 7a788c3decf4b271
    Name           : process-invoices
    Kind           : Internal
…
2026-10-12T23:26:05.541+0530	info	ResourceMetrics #0
Resource attributes:
     -> service.name: Str(billing-job)
     …
InstrumentationScope billing 
Metric #0
Descriptor:
     -> Name: invoices_processed
     -> Description: Invoices handled
     -> Unit: 
     -> DataType: Sum
     -> IsMonotonic: true
     -> AggregationTemporality: Cumulative
NumberDataPoints #0
Data point attributes:
     -> invoice.currency: Str(USD)
…
Value: 3.000000
Metric #1
Descriptor:
     -> Name: invoice_amount
     -> Unit: USD
     -> DataType: Histogram
     -> AggregationTemporality: Cumulative
HistogramDataPoints #0
…
Count: 3
Sum: 59.000000
Min: 7.000000
Max: 40.000000
ExplicitBounds #0: 0.000000
ExplicitBounds #1: 5.000000
ExplicitBounds #2: 10.000000
ExplicitBounds #3: 25.000000
ExplicitBounds #4: 50.000000
…
Buckets #2, Count: 1
Buckets #3, Count: 1
Buckets #4, Count: 1
…
```

Three `add(1)` calls left the process as one point, `Value: 3`. Three recorded amounts became one histogram point (count, sum, min, max and per-bucket counts with the SDK's default boundaries 0, 5, 10, 25, 50, …). The individual values are gone, which is why metrics are cheap. The log line's `trace_id` matches the span's `Trace ID`, so a log search for that id finds the trace. A logging library instrumentation (`instrumentation-pino`, `instrumentation-winston`, `instrumentation-bunyan` are in the auto-instrumentations list) adds these fields for you. This lesson did not run them.

**Example 7 — edge case: ESM without the loader hook loses the Express spans.**

The same two services, started with `NO_ESM_HOOK=1` so that `telemetry.mjs` skips `register()`:

bash

```
$ NO_ESM_HOOK=1 OTEL_SERVICE_NAME=orders node --import ./telemetry.mjs service-b.mjs > logs/b.log 2>&1 &
$ NO_ESM_HOOK=1 OTEL_SERVICE_NAME=checkout node --import ./telemetry.mjs service-a.mjs > logs/a.log 2>&1 &
$ sleep 3
$ curl -s localhost:7230/checkout/42
{"traceId":"5029d1207dafd25981b6b358cfcbac67","sampled":true,"order":{"id":42,"status":"paid","total_cents":1999}}
$ kill %1 %2
$ node dump.mjs 5029d1207dafd25981b6b358cfcbac67
trace 5029d1207dafd25981b6b358cfcbac67: 6 spans
checkout  GET  [instrumentation-http] 63.9 ms  span c1446f200154a346
  checkout  GET  [instrumentation-undici] 34.4 ms  span 1fa354a3fb675856
    orders    GET  [instrumentation-http] 20.0 ms  span c603f0c96489b88d
      orders    pg-pool.connect  [instrumentation-pg] 10.1 ms  span 073f594b920415e3
        orders    pg.connect  [instrumentation-pg] 8.1 ms  span 3474c542fae2f8b9
      orders    pg.query:SELECT app  [instrumentation-pg] 2.9 ms  span f8ca1e6c0727240a
```

Nothing failed, and the cross-service link still works. Three things are missing, and only a careful look shows it:

1. **No express spans.** `instrumentation-express` hooks the top-level `express` module, and here it was loaded by an ESM `import`, which the require hook never sees.
2. **Server spans are named `GET`**, not `GET /checkout/:orderId`. The route name comes from the express instrumentation, so every endpoint now has the same span name and can't be told apart in a latency breakdown.
3. **The pg spans survived.** `instrumentation-pg` patches `pg/lib/client.js` and `pg-pool`, which `pg` itself loads with `require()` from inside the package, so the require hook still catches them.

So "some spans appear" does not prove that ESM instrumentation works. Check for a span from every library you rely on.

**Example 8 — edge case: Express 5 + the `router` instrumentation doubles the middleware spans.**

Express 5 delegates routing to the separate `router` package, and `auto-instrumentations-node` includes both `instrumentation-express` and `instrumentation-router`. The same request as Example 3, with a copy of `telemetry.mjs` that leaves both of them (and `net`) on:

bash

```
$ sed -e "/instrumentation-router': { enabled: false }/d" -e "/instrumentation-net': { enabled: false }/d" telemetry.mjs > telemetry-all.mjs
$ OTEL_SERVICE_NAME=orders node --import ./telemetry-all.mjs service-b.mjs > logs/b.log 2>&1 &
$ OTEL_SERVICE_NAME=checkout node --import ./telemetry-all.mjs service-a.mjs > logs/a.log 2>&1 &
$ sleep 3
$ curl -s localhost:7230/checkout/42
{"traceId":"4821ad2c1611f910245658f4e278dba0","sampled":true,"order":{"id":42,"status":"paid","total_cents":1999}}
$ kill %1 %2
$ node dump.mjs 4821ad2c1611f910245658f4e278dba0
trace 4821ad2c1611f910245658f4e278dba0: 14 spans
checkout  GET /checkout/:orderId  [instrumentation-http] 69.1 ms  span 080e4db6d646a302
  checkout  middleware - patched  [instrumentation-router] 67.1 ms  span 77f865633d595951
    checkout  request handler - /checkout/:orderId  [instrumentation-express] 65.9 ms  span fa44c161b27df6ea
      checkout  request handler - /checkout/:orderId  [instrumentation-router] 65.5 ms  span 2bd756c7d475f29b
        checkout  GET  [instrumentation-undici] 37.8 ms  span 82a290fa0fe484b2
          orders    GET /orders/:id  [instrumentation-http] 23.2 ms  span 0a414350123265ac
            orders    middleware - patched  [instrumentation-router] 21.7 ms  span 6af186e531b4a692
              orders    request handler - /orders/:id  [instrumentation-express] 21.0 ms  span 3ce47acfd89665ab
                orders    request handler - /orders/:id  [instrumentation-router] 20.6 ms  span 5328b36e476b6799
                  orders    pg-pool.connect  [instrumentation-pg] 11.4 ms  span a20da96c07c2d1c5
                    orders    pg.connect  [instrumentation-pg] 9.4 ms  span 687d799b7bd1a828
                      orders    tcp.connect  [instrumentation-net] 2.3 ms  span fb5857d157696daf
                  orders    pg.query:SELECT app  [instrumentation-pg] 3.4 ms  span e4ee40912021b327
        checkout  tcp.connect  [instrumentation-net] 3.8 ms  span c9b37e8906aa5f81
```

`middleware - patched` is the router instrumentation naming a layer after its function, and that function is `patched`, the wrapper that instrumentation-express 0.71.0 installs around each layer's handler (`const patched = function (req, res) {…}` in its source). Both libraries are timing the same handler. Disabling `@opentelemetry/instrumentation-router` (and `net`, whose `tcp.connect` spans duplicate what `pg.connect` and the undici span already show) brought it down to the 8 spans of Example 4.

## Common mistakes & gotchas

- **Starting the SDK after the app's imports.** Instrumentation patches modules as they load. In CommonJS, `require('express')` before `sdk.start()` gives an unpatched Express. Use `--require`/`--import` or start the SDK on the first lines of the entry file.
- **ESM without the loader hook.** No error, just missing spans and route names (Example 7). Register `@opentelemetry/instrumentation/hook.mjs`.
- **Not calling `sdk.shutdown()` on exit.** Spans wait up to 5 s in the batch queue. A process killed without a flush loses the last few seconds, which are often the ones around a crash. Hook it into the SIGTERM handler from lesson [66](102-graceful-shutdown-monitoring.md).
- **A different sampler in each service.** If B uses a plain `TraceIdRatioBasedSampler` with a different ratio from A, traces lose their B half or have B without their root. Use `ParentBasedSampler` everywhere and decide only at the edge.
- **High-cardinality span names or metric attributes.** `GET /orders/42` as a span name, or `user.id` as a metric attribute, creates one time series per value and can make a metrics backend expensive or unusable. Put ids in span attributes, keep names to the route.
- **Expecting the trace id to be generated by you.** Don't mint your own `x-request-id` and also run OTel without linking them. Either log the OTel `trace_id`, or keep the request id as a span attribute.
- **Double instrumentation on Express 5.** `instrumentation-express` and `instrumentation-router` both wrap the same layers (Example 8).
- **Assuming `traceparent` means "sampled".** The header is sent for unsampled traces too, with flags `00`.
- **Leaking secrets into spans.** `db.query.text` holds the SQL text. Parameterized queries keep values out of it; string-built SQL puts them in. URLs in `url.full` can carry tokens in the query string. Redact in the Collector before data leaves your network.
- **Old Collector exporter names.** Recent Collector docs and `components` output use `otlp_grpc` / `otlp_http`; older tutorials use `otlp` / `otlphttp`. Both validated in 0.162.0, but check `otelcol-contrib components` for your version.
- **Port clashes on a shared host.** The Collector's own metrics endpoint defaults to 8888, and OTLP to 4317/4318. Running two Collector-based binaries (the Collector and Jaeger v2) on one host needs different ports or `service.telemetry.metrics.level: none`.

## Best practices

- **Put SDK setup in its own file** (`telemetry.mjs` / `telemetry.cjs`) and load it with `--import` / `--require`, so app code never has to import it first.
- **Set `service.name`** (`OTEL_SERVICE_NAME`) and a deployment environment attribute on every service. Without them every process shows up as `unknown_service:node`.
- **Merge with `defaultResource()`** when you pass a custom resource, so the `telemetry.sdk.*` attributes stay.
- **Export OTLP to a local Collector**, and keep vendor exporters, credentials, redaction and tail sampling there.
- **Sample at the edge with `ParentBasedSampler`**, and use Collector tail sampling if you must keep all errors or slow traces.
- **Turn off instrumentations you don't need** (`net`, `dns`, and `router` on Express 5) to cut span volume and noise.
- **Add business attributes** (`app.order_id`, tenant, plan) to the active span. They are what make a trace searchable during an incident.
- **Put `trace_id` and `span_id` in every log line**, so logs and traces join.
- **Watch the `pg-pool.connect` span duration.** It is pool wait time, the early sign of pool exhaustion.
- **Validate Collector config in CI** with `otelcol-contrib validate --config=…`. It catches unknown keys for components that decode strictly (Example 2).

## ⭐ Interview lens

> **Q: “What is a span, and how do spans from two services end up in one trace?”**  
> A: A span is one timed operation with a trace id, its own span id, a parent span id, a name, a kind, start and end times, attributes and a status. Spans that share a trace id form one trace, and the parent ids make it a tree. Across services, the client-side instrumentation injects the W3C `traceparent` header (`00-<trace-id>-<client-span-id>-<flags>`), and the server-side instrumentation extracts it and starts its server span as a child of the client span. Inside a process, an AsyncLocalStorage-based context manager carries the current span across `await`s. *Trap:* saying the backend "matches up timestamps". The link is the propagated ids.

> **Q: “Why does OpenTelemetry need a special loader for ESM apps?”**  
> A: Auto-instrumentation patches libraries as they are loaded. For CommonJS it hooks `require()`. ES module `import`s don't go through `require()`, so a loader hook (`@opentelemetry/instrumentation/hook.mjs`, registered with `module.register()` or `--experimental-loader`) is needed. Without it you get partial data: packages that load internal files with `require()` (like `pg`) are still patched, but a top-level `import express` isn't, so you lose the Express spans and route names.

> **Q: “Head sampling vs tail sampling?”**  
> A: Head sampling decides at the root span, before the request runs, usually as a ratio of trace ids. With a parent-based sampler, downstream services follow the decision in `traceparent`, so traces stay whole. It is cheap but blind to outcome. Tail sampling runs in the Collector after all of a trace's spans have arrived, so it can keep every error or every slow trace. It costs memory and needs every span of a trace to reach the same Collector instance.

> **Q: “Why run a Collector instead of exporting straight to the vendor?”**  
> A: It takes retries and batching off the app process, keeps vendor credentials out of app containers, lets you redact or drop attributes before data leaves your network, enables tail sampling, and lets you change or add backends by editing YAML instead of redeploying every service.

> **Q: “What makes a metric expensive?”**  
> A: Cardinality: every unique combination of attribute values is its own time series. A counter with `route` and `status` is fine; add `user.id` and you get a series per user. Put unbounded values on spans or logs instead.

## Cheat-card

- **Signals:** traces (one request, many spans), metrics (aggregated numbers), logs (events). Join them on `trace_id`.
- **Span:** trace id (32 hex), span id (16 hex), parent id, name, kind, start/end, attributes, status. **Resource:** `service.name`, host, process, `telemetry.sdk.*`.
- **`traceparent`:** `00-<trace-id>-<parent-span-id>-<flags>`; `01` = sampled, `00` = not sampled (still propagated).
- **Setup:** `@opentelemetry/sdk-node` 0.223.0 + `@opentelemetry/auto-instrumentations-node` 0.81.0 (`fs`, `host-metrics` off by default).
- **CJS:** `node --require ./telemetry.cjs app.js`. **ESM:** `node --import ./telemetry.mjs app.mjs` with `register('@opentelemetry/instrumentation/hook.mjs', import.meta.url)` inside.
- **Express 5:** disable `@opentelemetry/instrumentation-router` to avoid doubled spans.
- **Sampling:** `ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.25) })` or `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.25`. 1,000 requests → 250 kept, all whole.
- **Batch defaults (2.12.0):** 2,048 queued, 512 per export, 5,000 ms delay. Call `sdk.shutdown()` on SIGTERM.
- **Collector:** receivers → processors → exporters; `otelcol-contrib validate --config=…`; OTLP ports 4317 gRPC / 4318 HTTP; exporters `otlp_grpc`, `otlp_http`, `debug`.
- **Jaeger 2.22.0:** Collector-based; `jaeger_storage` + `jaeger_query` extensions; API `/api/v3/services`, `/api/v3/traces/<id>`.
- **Versions used:** Node v24.19.0, Express 5.3.0, sdk-node 0.223.0, auto-instrumentations-node 0.81.0, instrumentation-express 0.71.0, instrumentation-pg 0.75.0, instrumentation-undici 0.33.0, api 1.9.1, pg 8.23.1, PostgreSQL 18.4, otelcol-contrib 0.162.0, Jaeger 2.22.0.

---

## Learn More

- [OpenTelemetry concepts: signals, traces, context propagation opentelemetry.io](https://opentelemetry.io/docs/concepts/signals/traces/)
- [OpenTelemetry JavaScript: getting started with Node.js opentelemetry.io](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [ECMAScript Modules vs. CommonJS (opentelemetry-js esm-support.md) github.com](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md)
- [@opentelemetry/auto-instrumentations-node README github.com](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node)
- [Trace Context (W3C Recommendation) w3.org](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Collector configuration opentelemetry.io](https://opentelemetry.io/docs/collector/configuration/)
- [Sampling opentelemetry.io](https://opentelemetry.io/docs/concepts/sampling/)
- [Jaeger: getting started jaegertracing.io](https://www.jaegertracing.io/docs/latest/getting-started/)
