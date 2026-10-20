---
title: "APM and Alerting"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# APM and Alerting

*24 min read · Updated 12 Oct 2026 · Topic 112 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, @sentry/node 11.7.0 (sending to a local stand-in server, no Sentry account), OpenTelemetry Collector Contrib 0.162.0 (config validation only for the vendor exporters); Datadog (dd-trace 6.20.1) and New Relic (newrelic 14.7.0) facts come from their docs and package READMEs, with no accounts used

---

## Why it matters

Tracing (lesson [111](107-observability-with-opentelemetry.md)) tells you *why* one request was slow. Two other questions decide whether you hear about problems at all:

- **Which errors are happening, how often, and to whom?** A thrown exception in a route returns a 500 and a log line. With 200 instances and 50 million requests a day, nobody reads that line. Error tracking groups identical exceptions into one issue, counts them, keeps the stack trace with source context and the request details, and tells you when a new one appears after a deploy.
- **When should a human be woken up?** Alerting on raw symptoms ("error rate > 1 % for 5 minutes") pages people for blips that don't matter and stays quiet during slow leaks that do. Teams that get many false pages start ignoring them, and then they miss the real one. That is **alert fatigue**.

**APM** (application performance monitoring) products such as Sentry, Datadog and New Relic package error tracking, tracing, metrics and dashboards. **SLOs and burn-rate alerts** are the method for deciding, with arithmetic instead of guesses, which problems are worth a page.

## The concept, simply

**Error tracking.** An SDK in your process catches unhandled exceptions (and anything you pass to `captureException`), builds an **event** (exception type, message, stack frames with source lines, request, release, environment, trace id), and sends it to the service. The service groups events by fingerprint (mostly the stack trace) into **issues**. You configure the destination with a **DSN** (`http://<public-key>@<host>/<project-id>`), which is a write-only address, not a secret API key.

**SLI, SLO, error budget.**

- An **SLI** (service level indicator) is a ratio of good events to all events, measured where users feel it. Example: the fraction of `GET /checkout` requests that return non-5xx in under 500 ms, measured at the load balancer.
- An **SLO** (objective) is the target for that ratio over a window: 99.9 % over 30 days.
- The **error budget** is what's left over: 0.1 % of requests may be bad. For a 30-day window that is 43.2 minutes of total outage, or 10,000 failed requests out of 10 million (Example 5).
- The **burn rate** is how fast you're spending the budget compared with the rate that would use it up exactly at the end of the window. Burn rate 1 = an error ratio of 0.1 %, which uses the whole budget in 30 days. Burn rate 14.4 = 1.44 %, which uses it in about 2 days.

**Multiwindow, multi-burn-rate alerts** (Google SRE Workbook, chapter "Alerting on SLOs") page only when the budget is being spent fast enough to matter, and only while that's still happening:

text

```
 severity   long window   short window   burn rate   budget spent when it fires
 page       1 hour        5 minutes      14.4        2 %
 page       6 hours       30 minutes     6           5 %
 ticket     3 days        6 hours        1           10 %
 (Table 5-8, "Recommended parameters for a 99.9% SLO alerting configuration")

 alert = error ratio over the long window  > burn × (1 − SLO)
     AND error ratio over the short window > burn × (1 − SLO)
```

The long window makes sure a real amount of budget has been spent, which filters out blips. The short window, 1/12 of the long one, makes the alert stop soon after the problem stops, instead of an hour later.

## How it works

What happens when an Express 5 route throws, with `@sentry/node` 11.7.0 loaded:

1. **Start-up.** `node --import ./instrument.mjs app.mjs` runs `Sentry.init()` before the app imports Express, as the Sentry Express guide requires. `@sentry/node` is built on OpenTelemetry, so its instrumentation has to be in place before the libraries load.
2. **The route throws.** Express 5 forwards the rejected promise to the error-handling middleware (lesson [37](50-error-handling-the-4-arg-handler-and-async-errors.md)).
3. **`expressIntegration` captures it.** In 11.x the integration captures route and middleware errors by itself. Errors whose `status`/`statusCode` is 3xx or 4xx are skipped. `shouldHandleError(error)` changes that rule. `setupExpressErrorHandler(app)` still exists in 11.7.0 but is marked `@deprecated` (changed in v11: in 10.76.2 it is not deprecated and is how errors were captured).
4. **The SDK builds the event.** It adds the stack frames (with `pre_context`/`context_line`/`post_context` from the source files), the request (headers, URL, cookies, query string), `release`, `environment`, the OS and runtime contexts, and the trace id of the current span.
5. **Built-in scrubbing.** Values whose keys match the SDK's denylist (`authorization`, `cookie`, `x-api-key`, a `token` query parameter) are replaced with `[Filtered]` (Example 2).
6. **`beforeSend(event, hint)` runs.** Your function can change the event, or return `null` to drop it. `hint.originalException` is the original error object.
7. **The transport sends an envelope.** It is an HTTP `POST` to `<dsn-host>/api/<project-id>/envelope/?sentry_version=7&sentry_key=<public-key>&sentry_client=sentry.javascript.node/11.7.0`. The body is newline-delimited JSON: one envelope header line, then pairs of item-header and item-payload lines. Separate envelopes carry `client_report` items (counts of events dropped, here spans dropped by `tracesSampleRate: 0`) and `sessions` items (request counts per release).
8. **`Sentry.flush(ms)`** waits for queued envelopes. Call it (or `Sentry.close()`) in your SIGTERM handler (lesson [66](102-graceful-shutdown-monitoring.md)).

**Datadog and New Relic, in brief.** Neither was run for this lesson (no accounts). The facts below come from their docs and npm packages, checked on 12 Oct 2026.

| | Datadog | New Relic |
|---|---|---|
| Node package (version checked) | `dd-trace` 6.20.1, `engines.node >=22` | `newrelic` 14.7.0, `engines.node >=22` |
| Load it (CJS) | `node --require dd-trace/init app.js`, or a file containing `require('dd-trace').init({…})` loaded with `--require` | `node -r newrelic app.js` |
| Load it (ESM) | `node --import dd-trace/initialize.mjs app.js` (Node 20.6+) | `node --import newrelic/esm-loader.mjs -r newrelic app.js`; rename `newrelic.js` to `newrelic.cjs` |
| Where data goes | A local Datadog Agent; the tracer's `DD_TRACE_AGENT_PORT` defaults to `8126`, `DD_AGENT_HOST` to `127.0.0.1` | Straight to New Relic, authenticated by the license key (`license_key` in `newrelic.js`, or environment variables) |
| Service identity | `DD_SERVICE`, `DD_ENV`, `DD_VERSION` ("Unified Service Tagging") | `app_name` |
| OpenTelemetry | The docs list "DDOT Collector (Recommended)", "OTLP Ingest in the Agent", "Direct OTLP Ingest" and the Collector's `datadog` exporter | Native OTLP endpoint `https://otlp.nr-data.net` (ports 443, 4317, 4318), license key in the `api-key` header; the docs recommend the Collector's `otlphttp` exporter |

Both vendors' agents patch libraries the same way OpenTelemetry does, so the CJS/ESM loading rules from lesson 107 apply. If you already emit OTLP, a Collector can send the same data to either vendor (Example 4), which keeps your code vendor-neutral.

> ⚠️ Unverified: that `dd-trace` 6.20.1 and `newrelic` 14.7.0 start and report correctly with the commands above, and that the Collector config in Example 4 delivers data to Datadog and New Relic. No accounts or API keys were used; the commands come from the vendors' docs, and the Collector config was validated with `otelcol-contrib validate` but not run against either service.

**Choosing SLIs.** Measure what the user sees, at the outermost point you control (load balancer or gateway logs), as good / total:

- **Availability:** non-5xx responses / all responses (decide whether 429 counts as bad).
- **Latency:** responses faster than a threshold / all responses. Use a threshold ("under 500 ms"), not an average, so it stays a ratio you can budget.
- **Freshness** for pipelines: records processed within N minutes / all records.

Pick the SLO from what users tolerate and what you have achieved, not from "as many nines as possible": a 99.99 % SLO leaves 4.3 minutes a month for every deploy, failover and dependency outage combined.

**The burn-rate arithmetic.** For an SLO window of length *P* and an alert window *w*, spending a fraction *f* of the budget within *w* means a burn rate of *f* × *P* / *w*. 2 % of a 30-day (720 h) budget in 1 hour is 0.02 × 720 / 1 = 14.4. The alert threshold on the error ratio is burn × (1 − SLO) = 14.4 × 0.001 = 1.44 %. Example 5 computes every row and replays an incident through the 1-hour rule.

**Avoiding alert fatigue.** Every page should be **urgent** (someone has to act now), **actionable** (there is something they can do) and **user-facing** (an SLO is at risk). Concretely:

1. **Page on SLO burn, not on causes.** High CPU, a full disk queue or one pod restarting are causes; page only if users are affected, and put the causes on dashboards and in tickets.
2. **Two severities only:** *page* (fast burn, someone acts in minutes) and *ticket* (slow burn, someone acts this week). The workbook's third row is a ticket.
3. **Use the short window** so a resolved incident stops paging (Example 5: reset 9 minutes after the incident instead of 55).
4. **Group and deduplicate.** One incident should send one notification, not one per instance or per rule. Alertmanager-style grouping and inhibition (a page suppresses the ticket for the same SLO) do this.
5. **Link a runbook** from every alert: what the alert means, the first three things to check, how to mitigate.
6. **Review alerts on a schedule.** Delete or downgrade any alert that fired without anyone needing to act. Track pages per on-call shift.
7. **For error tracking, alert on new issues and regressions** (an issue seen for the first time in a release, or a resolved issue coming back), not on every event.
8. **Low-traffic services** need care. The workbook's example: at 10 requests an hour, one failed request is a 10 % hourly error rate, a 1,000x burn rate for a 99.9 % SLO, and it would page at once. Its options are artificial (synthetic) traffic, combining small services into one for monitoring, or changing the product so that one failure matters less.

## Code examples

**Example 1 — Sentry in an Express 5 app, with the DSN pointed at a local server.**

bash

```
$ npm init -y > /dev/null && npm pkg set type=module
$ npm install express@5.3.0 @sentry/node@11.7.0
…
$ npm ls --depth=0
sentry@1.0.0 /…/sentry
├── @sentry/node@11.7.0
└── express@5.3.0
```

The SDK setup, loaded before the app:

javascript

```
// instrument.mjs: loaded with --import before the app, as the Sentry Express guide says.
// SCRUB=0 turns beforeSend off so you can compare what the SDK sends by default.
import * as Sentry from '@sentry/node';

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;

Sentry.init({
  // Public key "abc123", project id 1, host = our local fake server. No sentry.io involved.
  dsn: 'http://abc123@127.0.0.1:7220/1',
  environment: 'local',
  release: 'orders@1.4.2',
  tracesSampleRate: 0,               // errors only in this example
  beforeSend: process.env.SCRUB === '0' ? undefined : (event, hint) => {
    // Runs in-process, before the event is serialised and sent. Return null to drop it.
    if (hint.originalException?.code === 'ECONNRESET') return null;
    const headers = event.request?.headers;
    if (headers) delete headers['x-customer-email'];
    for (const ex of event.exception?.values ?? []) {
      ex.value = ex.value?.replace(EMAIL, '[email]');
    }
    return event;
  },
});
```

The app. It throws a 5xx error with an email address in the message, and a 404 error:

javascript

```
// app.mjs: Express 5 app; run with  node --import ./instrument.mjs app.mjs
import * as Sentry from '@sentry/node';
import express from 'express';

const app = express();

app.get('/orders/:id', async (req, res) => {
  // Express 5 forwards the rejected promise to the error handlers.
  throw new Error(`order ${req.params.id} not found for ${req.get('x-customer-email')}`);
});

app.get('/coupons/:code', (req, res) => {
  // A client error: expressIntegration skips errors with a 3xx/4xx status by default.
  throw Object.assign(new Error(`unknown coupon ${req.params.code}`), { status: 404 });
});

// Deprecated in @sentry/node 11 (expressIntegration already captures errors);
// harmless there, and needed on v10 and older.
Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  const status = err.status ?? 500;
  // Never echo a 5xx message to the client; give it the event id to quote to support.
  res.status(status).json({ error: status < 500 ? err.message : 'internal', eventId: Sentry.lastEventId() ?? null });
});

const server = app.listen(7221, async () => {
  const r = await fetch('http://127.0.0.1:7221/orders/42?token=s3cr3t', {
    headers: {
      authorization: 'Bearer s3cr3t', cookie: 'sid=abc',
      'x-api-key': 'k-123', 'x-customer-email': 'ada@example.com',
    },
  });
  console.log('client got', r.status, await r.text());
  const c = await fetch('http://127.0.0.1:7221/coupons/FREE');
  console.log('client got', c.status, await c.text());
  await Sentry.flush(2000);          // wait for the envelopes to be sent
  server.close();
});
```

A stand-in for sentry.io that prints the envelopes it receives. The event payload is about 10 KB, so it keeps only the fields discussed here (marked `[event payload, pruned]`); every other line is printed as received:

javascript

```
// fake-sentry.mjs: a stand-in for sentry.io that prints every envelope it receives.
import http from 'node:http';
import { gunzipSync } from 'node:zlib';

// Event payloads are ~10 KB; keep only the fields this lesson discusses.
function prune(e) {
  const frames = e.exception.values[0].stacktrace.frames;
  const top = frames.at(-1);                       // Sentry lists frames oldest first
  return {
    event_id: e.event_id, level: e.level, platform: e.platform,
    exception: e.exception.values.map((v) => ({
      type: v.type, value: v.value, mechanism: v.mechanism,
      frames: `${frames.length} frames, top: ${top.function} ` +
              `${top.filename.split('/').pop()}:${top.lineno} in_app=${top.in_app}`,
      context_line: top.context_line,
    })),
    transaction: e.transaction, environment: e.environment, release: e.release,
    contexts: { trace: e.contexts.trace, runtime: e.contexts.runtime },
    request: e.request, user: e.user,
  };
}

http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = Buffer.concat(chunks);
    if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body);
    console.log(`${req.method} ${req.url}`);
    // An envelope is newline-delimited JSON: one envelope header line,
    // then pairs of lines (item header, item payload).
    const lines = body.toString('utf8').split('\n').filter(Boolean);
    lines.forEach((line, i) => {
      const prev = i > 0 ? JSON.parse(lines[i - 1]) : {};
      if (prev.type === 'event') {
        console.log('[event payload, pruned]', JSON.stringify(prune(JSON.parse(line)), null, 2));
      } else console.log(line);
    });
    console.log('---');
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
}).listen(7220, () => console.log('fake Sentry on http://127.0.0.1:7220'));
```

bash

```
$ node fake-sentry.mjs > fake.log 2>&1 &
$ node --import ./instrument.mjs app.mjs
client got 500 {"error":"internal","eventId":"73d458c8c1d54c61a0371487130bf37c"}
client got 404 {"error":"unknown coupon FREE","eventId":null}
$ kill %1; cat fake.log
fake Sentry on http://127.0.0.1:7220
POST /api/1/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=sentry.javascript.node%2F11.7.0
{"event_id":"73d458c8c1d54c61a0371487130bf37c","sent_at":"2026-10-12T18:00:22.637Z","sdk":{"name":"sentry.javascript.node","version":"11.7.0"},"trace":{"environment":"local","release":"orders@1.4.2","public_key":"abc123","trace_id":"a54dc369eb874765b6ffea1dab0f3cd1","transaction":"GET 127.0.0.1","sampled":"false","sample_rand":"0.26860182347026873","sample_rate":"0"}}
{"type":"event"}
[event payload, pruned] {
  "event_id": "73d458c8c1d54c61a0371487130bf37c",
  "level": "error",
  "platform": "node",
  "exception": [
    {
      "type": "Error",
      "value": "order 42 not found for [email]",
      "mechanism": {
        "type": "auto.http.express",
        "handled": false
      },
      "frames": "10 frames, top: ? app.mjs:9 in_app=true",
      "context_line": "  throw new Error(`order ${req.params.id} not found for ${req.get('x-customer-email')}`);"
    }
  ],
  "transaction": "GET /orders/:id",
  "environment": "local",
  "release": "orders@1.4.2",
  "contexts": {
    "trace": {
      "span_id": "bc4c5757e4b385f4",
      "trace_id": "a54dc369eb874765b6ffea1dab0f3cd1"
    },
    "runtime": {
      "name": "node",
      "version": "v24.19.0"
    }
  },
  "request": {
    "headers": {
      "host": "127.0.0.1:7221",
      "connection": "keep-alive",
      "authorization": "[Filtered]",
      "cookie": "[Filtered]",
      "x-api-key": "[Filtered]",
      "accept": "*/*",
      "accept-language": "*",
      "sec-fetch-mode": "cors",
      "user-agent": "node",
      "accept-encoding": "gzip, deflate",
      "sentry-trace": "a54dc369eb874765b6ffea1dab0f3cd1-b352f7e2f31d40db-0",
      "baggage": "sentry-environment=local,sentry-release=orders%401.4.2,sentry-public_key=abc123,sentry-trace_id=a54dc369eb874765b6ffea1dab0f3cd1,sentry-transaction=GET%20127.0.0.1,sentry-sampled=false,sentry-sample_rand=0.26860182347026873,sentry-sample_rate=0"
    },
    "method": "GET",
    "url": "http://127.0.0.1:7221/orders/42?token=[Filtered]",
    "cookies": {
      "sid": "[Filtered]"
    },
    "query_string": "token=[Filtered]"
  },
  "user": {
    "ip_address": "::ffff:127.0.0.1"
  }
}
---
POST /api/1/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=sentry.javascript.node%2F11.7.0
{}
{"type":"client_report"}
{"timestamp":1791828022.646,"discarded_events":[{"reason":"sample_rate","category":"span","quantity":6}]}
---
POST /api/1/envelope/?sentry_version=7&sentry_key=abc123&sentry_client=sentry.javascript.node%2F11.7.0
{"sent_at":"2026-10-12T18:00:22.647Z","sdk":{"name":"sentry.javascript.node","version":"11.7.0"}}
{"type":"sessions"}
{"aggregates":[{"started":"2026-10-12T18:00:00.000Z","exited":1,"errored":0,"crashed":1}],"attrs":{"release":"orders@1.4.2","environment":"local"}}
---
```

What the run shows:

- **One event for the 500, none for the 404.** `expressIntegration` captured the 5xx error (`"mechanism": {"type": "auto.http.express", "handled": false}`) and skipped the error with `status: 404`. The deprecated `setupExpressErrorHandler` did not add a second event.
- **The DSN became the URL.** `http://abc123@127.0.0.1:7220/1` → `POST /api/1/envelope/?…&sentry_key=abc123`. The public key travels in the query string; there is no secret.
- **Three envelopes,** each a header line plus `{"type":…}` item header plus payload: the `event`, a `client_report` (spans discarded because `tracesSampleRate` is 0), and `sessions` (one request `exited` normally, one `crashed`, because its error was unhandled). The order of the three varied between runs.
- **The event carries the trace context** (`contexts.trace.trace_id`), and the SDK added `sentry-trace` and `baggage` headers to the app's own outgoing `fetch`, which is why they appear in the captured request headers.
- **Scrubbing:** `authorization`, `cookie`, `x-api-key`, the cookie value and the `token` query parameter arrived as `[Filtered]` without any code. The email in the exception message became `[email]` and the `x-customer-email` header disappeared, both because of `beforeSend`.
- **The handler kept the 5xx message away from the client** and returned the `eventId` instead, so support can find the event.

**Example 2 — edge case: what the SDK sends when `beforeSend` is off.**

The SDK's built-in filter works on key names. A header or message that holds personal data under an ordinary name passes straight through:

bash

```
$ node fake-sentry.mjs > fake0.log 2>&1 &
$ SCRUB=0 node --import ./instrument.mjs app.mjs > /dev/null
$ kill %1
$ grep -E '"value"|authorization|cookie|x-api|x-customer|"url"|query_string|"sid"|ip_address' fake0.log
      "value": "order 42 not found for ada@example.com",
      "context_line": "  throw new Error(`order ${req.params.id} not found for ${req.get('x-customer-email')}`);"
      "authorization": "[Filtered]",
      "cookie": "[Filtered]",
      "x-api-key": "[Filtered]",
      "x-customer-email": "ada@example.com",
    "url": "http://127.0.0.1:7221/orders/42?token=[Filtered]",
    "cookies": {
      "sid": "[Filtered]"
    "query_string": "token=[Filtered]"
    "ip_address": "::ffff:127.0.0.1"
```

Without `beforeSend`, the customer's email left the process twice: in the exception message and in the `x-customer-email` header. The IP address is sent too. To stop sending it, the Sentry Express guide documents `dataCollection: { userInfo: false }` (the `dataCollection` option is in the 11.7.0 typings; not run here). So scrub messages and app-specific headers in `beforeSend`, and don't put personal data in error messages in the first place.

**Example 3 — edge case: `setupExpressErrorHandler` across major versions.**

The type definitions shipped in each package, checked with `npm pack`:

text

```
@sentry/node 10.76.2  build/types/integrations/tracing/express.d.ts
    export declare function setupExpressErrorHandler(app: { … }   (no @deprecated tag)
@sentry/server-utils 11.0.0 / 11.7.0  build/types/integrations/express/error-handler.d.ts
    * @deprecated `expressIntegration()` now captures errors automatically, so calling this error handler is no longer
    * necessary. To customize which errors are captured, pass `shouldHandleError` to `expressIntegration()`.
    * This export is deprecated and will be removed in the next major version.
```

So the line that most Express + Sentry tutorials end with is required on v10, redundant on v11 (Example 1 sent exactly one event with it present), and will break the build on the next major. If you also handle errors yourself, the guide says to set `expressIntegration({ shouldHandleError: false })` to avoid duplicates.

**Example 4 — one OTLP pipeline to two vendors (Collector config, validated, not run).**

yaml

```
# vendors.yaml: one OTLP pipeline fanned out to two vendors. Keys come from env vars.
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:7241

processors:
  batch:

exporters:
  otlp_http/newrelic:
    endpoint: https://otlp.nr-data.net
    headers:
      api-key: ${env:NEW_RELIC_LICENSE_KEY}
  datadog:
    api:
      key: ${env:DD_API_KEY}
      site: datadoghq.com

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp_http/newrelic, datadog]
```

bash

```
$ O=~/.cache/nodekit-repair-tools/pass7/B3/bin/otelcol-contrib
$ NEW_RELIC_LICENSE_KEY=placeholder DD_API_KEY=placeholder $O validate --config=vendors.yaml; echo "exit $?"
exit 0
$ DD_API_KEY= NEW_RELIC_LICENSE_KEY= $O validate --config=vendors.yaml; echo "exit $?"
Error: exporters::datadog: api.key is not set
exit 1
$ sed 's/      site: datadoghq.com/      site: datadoghq.com\n      region: us/' vendors.yaml > bad.yaml
$ NEW_RELIC_LICENSE_KEY=x DD_API_KEY=x $O validate --config=bad.yaml; echo "exit $?"
exit 0
```

This config was validated, not run: nothing was sent to either vendor. The second run shows that `validate` checks required settings once environment variables are expanded. The third shows its limit: an invented `api.region` key passed `validate` in 0.162.0, even though the `debug` exporter rejects unknown keys (lesson 107, Example 2). A clean `validate` is not proof that every key does something.

**Example 5 — error budget and burn-rate arithmetic, with an incident replayed.**

javascript

```
// burn.mjs: error-budget and burn-rate arithmetic for a 99.9% / 30-day SLO,
// using the parameters from the Google SRE Workbook, "Alerting on SLOs", Table 5-8.
const SLO = 0.999;
const PERIOD_H = 30 * 24;                       // 30-day rolling window, in hours
const budget = 1 - SLO;                         // allowed error ratio = 0.001

console.log(`error budget: ${(budget * 100).toFixed(1)}% of requests`);
console.log(`  = ${(budget * PERIOD_H * 60).toFixed(1)} min of total outage per 30 days`);
console.log(`  = ${(budget * 10_000_000).toFixed(0)} failed requests if you serve 10M per 30 days`);

// burn rate = observed error ratio / budget. Burn rate 1 spends exactly the whole budget in 30 days.
console.log('\nburn rate -> error ratio -> time to spend 100% of the budget');
for (const b of [1, 2, 6, 10, 14.4, 1000]) {
  const hours = PERIOD_H / b;
  const t = hours >= 48 ? `${(hours / 24).toFixed(1)} days` : hours >= 1 ? `${hours.toFixed(1)} h` : `${(hours * 60).toFixed(0)} min`;
  console.log(`  ${String(b).padStart(6)}  ${(b * budget * 100).toFixed(2).padStart(6)}%  ${t}`);
}

// Rule rows: budget fraction spent within the long window => burn-rate threshold.
const rules = [
  { sev: 'page',   spend: 0.02, longH: 1,  shortH: 5 / 60 },
  { sev: 'page',   spend: 0.05, longH: 6,  shortH: 0.5 },
  { sev: 'ticket', spend: 0.10, longH: 72, shortH: 6 },
];
console.log('\nderived thresholds (burn = spend * period / long window)');
for (const r of rules) {
  r.burn = +(r.spend * PERIOD_H / r.longH).toFixed(1);
  r.ratio = r.burn * budget;
  console.log(`  ${r.sev.padEnd(6)} long ${String(r.longH).padStart(2)}h short ${String(r.shortH * 60).padStart(3)}m` +
    `  burn > ${String(r.burn).padStart(4)}  error ratio > ${(r.ratio * 100).toFixed(2)}%`);
}

// Simulate per-minute error ratios: 0.05% baseline, then 15% errors for 10 minutes
// starting at minute 120 (the incident used in the workbook's Figure 5-6).
const minutes = 6 * 60;
const err = Array.from({ length: minutes }, (_, m) => (m >= 120 && m < 130 ? 0.15 : 0.0005));
const avg = (end, lenMin) => {                  // mean error ratio over the last lenMin minutes
  const s = Math.max(0, end - lenMin + 1);
  let sum = 0; for (let i = s; i <= end; i++) sum += err[i];
  return sum / (end - s + 1);
};
const r = rules[0];
const states = [];
for (let m = 0; m < minutes; m++) {
  const longA = avg(m, r.longH * 60), shortA = avg(m, r.shortH * 60);
  states.push({ m, longOnly: longA > r.ratio, shortOnly: shortA > r.ratio, both: longA > r.ratio && shortA > r.ratio });
}
const edges = (key) => states.filter((s, i) => i > 0 && s[key] !== states[i - 1][key])
  .map((s) => `${s[key] ? 'fires' : 'resets'} at minute ${s.m}`);
console.log(`\nincident: 15% errors for minutes 120-129; rule = ${r.sev} 1h/5m, threshold ${(r.ratio * 100).toFixed(2)}%`);
console.log('  1h window only :', edges('longOnly').join(', '));
console.log('  5m window only :', edges('shortOnly').join(', '));
console.log('  1h AND 5m      :', edges('both').join(', '));
const spent = err.slice(120, 130).reduce((a, b) => a + b, 0) / (PERIOD_H * 60) / budget;
console.log(`  budget spent by the incident: ${(spent * 100).toFixed(1)}%`);

// Real output (Node v24.19.0), `node burn.mjs`:
//   error budget: 0.1% of requests
//     = 43.2 min of total outage per 30 days
//     = 10000 failed requests if you serve 10M per 30 days
//
//   burn rate -> error ratio -> time to spend 100% of the budget
//          1    0.10%  30.0 days
//          2    0.20%  15.0 days
//          6    0.60%  5.0 days
//         10    1.00%  3.0 days
//       14.4    1.44%  2.1 days
//       1000  100.00%  43 min
//
//   derived thresholds (burn = spend * period / long window)
//     page   long  1h short   5m  burn > 14.4  error ratio > 1.44%
//     page   long  6h short  30m  burn >    6  error ratio > 0.60%
//     ticket long 72h short 360m  burn >    1  error ratio > 0.10%
//
//   incident: 15% errors for minutes 120-129; rule = page 1h/5m, threshold 1.44%
//     1h window only : fires at minute 125, resets at minute 184
//     5m window only : fires at minute 120, resets at minute 134
//     1h AND 5m      : fires at minute 125, resets at minute 134
//     budget spent by the incident: 3.5%
```

Reading the output:

- **The derived thresholds reproduce Table 5-8** of the workbook: 14.4, 6 and 1. The 1-hour/5-minute pair pages when the 1-hour error ratio passes 1.44 %.
- **The incident** (15 % errors for 10 minutes, the same shape as the workbook's Figure 5-6) spent 3.5 % of the month's budget. Both rules fired at minute 125, the 6th minute of the incident, when the 1-hour average reached 6 × 15 % / 60 = 1.5 %.
- **The short window made the difference after the incident.** With the 1-hour window alone, the alert stayed firing until minute 184, 55 minutes after the errors stopped. With 1 hour AND 5 minutes, it reset at minute 134, 5 minutes after. That is the workbook's point about reset time: an alert that keeps firing for an hour after recovery teaches people to ignore it.

The same edges as a timeline (positions are approximate; the minute numbers are the script's):

text

```
minute            120  125   130  134                                       184
errors (15%)      [#########]                                                    120–129
1h avg > 1.44%         [=====================================================]   125 → reset 184
5m avg > 1.44%    [================]                                             120 → reset 134
page (1h AND 5m)       [===========]                                             125 → reset 134
```

The 5-minute window alone would have fired at minute 120, on the first bad minute; it is the 1-hour condition that holds the page back until 2 % of the budget is actually gone.

## Common mistakes & gotchas

- **Calling `Sentry.init()` inside the app after `import express`.** The SDK's instrumentation (OpenTelemetry-based) must load first: use `--import ./instrument.mjs` or `--require ./instrument.js`.
- **Relying on `setupExpressErrorHandler` across upgrades.** Needed in v10, deprecated in v11, announced for removal in the next major (Example 3).
- **Expecting 4xx errors in Sentry.** `expressIntegration` skips 3xx/4xx by default. Use `shouldHandleError` if a 401/403 spike matters to you.
- **Assuming the denylist scrubs personal data.** It matches key names. Emails in messages, custom headers and request bodies need `beforeSend` (Example 2).
- **Not flushing on shutdown.** Events are sent asynchronously; a process that exits right after an error can lose it. `await Sentry.flush(2000)` or `Sentry.close()` in the SIGTERM handler.
- **Echoing the error message to the client.** Return a generic message and the `eventId` for 5xx.
- **Alerting on a threshold over a short window** ("error rate > 1 % for 5 minutes"). It pages on blips that spend almost no budget and misses slow burns. Use burn rates over long and short windows.
- **An SLO of "100 %".** It leaves no budget for deploys or dependencies, so every blip becomes an incident and the alerts get muted.
- **Measuring SLIs inside the app only.** A crashed process reports no errors. Measure at the load balancer or with synthetic checks as well.
- **One page per instance.** 40 pods failing a health check is one incident; group alerts by service and SLO.
- **Copying vendor setup snippets without the loader flags.** `dd-trace` and `newrelic` need `--import` hooks for ESM, just like OpenTelemetry.

## Best practices

- **Load the APM SDK first** with `--import`/`--require`, and set `release` (git SHA or version) and `environment` so issues can be tied to deploys.
- **Scrub in `beforeSend`, and again in the Collector** for traces; keep personal data out of error messages.
- **Sample traces, keep all errors.** Error events are usually few; spans are many.
- **Define 1–3 SLIs per user-facing service**, as good/total ratios measured at the edge, with an SLO and a written error-budget policy (what happens when it's spent: freeze risky deploys, prioritise reliability work).
- **Start from Table 5-8** (14.4 / 6 / 1 with 1 h/5 m, 6 h/30 m, 3 d/6 h) and adjust only after reviewing real incidents.
- **Page for fast burns, ticket for slow burns,** and attach a runbook to each.
- **Review every page** in the on-call handover: was it urgent, actionable, user-facing? If not, fix or delete the rule.
- **Keep instrumentation vendor-neutral** (OpenTelemetry + Collector) so switching APM vendors is a config change.

## ⭐ Interview lens

> **Q: “What's an error budget and what is a burn rate?”**  
> A: The error budget is 1 − SLO: with 99.9 % availability over 30 days, 0.1 % of requests may fail, which is 43.2 minutes of full outage or 10,000 failures out of 10 million requests. The burn rate is the current error ratio divided by that budget ratio. At burn rate 1 you use the budget up exactly at the end of the window; at 14.4 you use it up in about 2 days, which is 2 % of the budget per hour.

> **Q: “Why use multiwindow, multi-burn-rate alerts instead of 'error rate > 1 % for 5 minutes'?”**  
> A: A fixed short-window threshold pages on blips that cost almost nothing and misses slow burns that use up the month. Burn-rate alerts tie the threshold to budget spent: page when 2 % is spent in an hour or 5 % in 6 hours, ticket when 10 % is spent in 3 days. Requiring a short window (1/12 of the long one) to also be over the threshold makes the alert stop a few minutes after recovery instead of an hour later. In my replay of a 10-minute, 15 % incident, the 1-hour rule alone kept firing 55 minutes after the errors stopped; with the 5-minute window it reset after 5.

> **Q: “How do you set up Sentry in an Express 5 app, and what changed in v11?”**  
> A: Put `Sentry.init({ dsn, release, environment, beforeSend })` in `instrument.mjs` and start with `node --import ./instrument.mjs app.mjs`. In v11, `expressIntegration` captures route errors itself and skips 3xx/4xx, and `setupExpressErrorHandler` is deprecated; in v10 you had to call it after your routes. Flush on SIGTERM. *Trap:* thinking the DSN is a secret. It's a write-only public key.

> **Q: “How do you reduce alert fatigue?”**  
> A: Page only for urgent, actionable, user-facing problems, which in practice means SLO burn-rate alerts. Send causes (CPU, restarts, queue depth) to dashboards and tickets. Group and deduplicate notifications, attach runbooks, and review every page afterwards, deleting rules that fired without needing action.

## Cheat-card

- **SLI** = good/total at the edge; **SLO** = target over a window; **budget** = 1 − SLO (99.9 %/30 d → 43.2 min, or 10,000 of 10 M).
- **Burn rate** = error ratio / (1 − SLO) = budget fraction × period / window. Threshold = burn × (1 − SLO).
- **Table 5-8 (99.9 %):** page 1 h + 5 m at 14.4 (2 %); page 6 h + 30 m at 6 (5 %); ticket 3 d + 6 h at 1 (10 %). Short window = long / 12.
- **Replay (15 % errors × 10 min):** fires at minute 6 of the incident; resets 5 min after recovery with the short window, 55 min without.
- **@sentry/node 11.7.0:** `node --import ./instrument.mjs app.mjs`; `expressIntegration` captures 5xx and skips 3xx/4xx (`shouldHandleError`); `setupExpressErrorHandler` deprecated (changed in v11).
- **Envelope:** `POST /api/<project>/envelope/?sentry_key=<public key>`; NDJSON: header, then item header + payload pairs; `event`, `client_report`, `sessions`.
- **Scrubbing:** built-in denylist by key name → `[Filtered]`; messages and custom headers need `beforeSend` (return `null` to drop).
- **Datadog:** `dd-trace` 6.20.1, `--require dd-trace/init` / `--import dd-trace/initialize.mjs`, Agent on 8126, `DD_SERVICE`/`DD_ENV`/`DD_VERSION`.
- **New Relic:** `newrelic` 14.7.0, `-r newrelic` (+ `--import newrelic/esm-loader.mjs`), OTLP at `otlp.nr-data.net` with `api-key` header.
- **Alert fatigue:** page = urgent + actionable + user-facing; group, dedupe, runbook, review.

---

## Learn More

- [Alerting on SLOs (The Site Reliability Workbook, chapter 5) sre.google](https://sre.google/workbook/alerting-on-slos/)
- [Implementing SLOs (The Site Reliability Workbook, chapter 2) sre.google](https://sre.google/workbook/implementing-slos/)
- [Sentry for Express docs.sentry.io](https://docs.sentry.io/platforms/javascript/guides/express/)
- [Filtering events and beforeSend (Sentry) docs.sentry.io](https://docs.sentry.io/platforms/javascript/guides/express/configuration/filtering/)
- [Envelopes (Sentry SDK developer docs) develop.sentry.dev](https://develop.sentry.dev/sdk/data-model/envelopes/)
- [Tracing Node.js applications (Datadog) docs.datadoghq.com](https://docs.datadoghq.com/tracing/trace_collection/automatic_instrumentation/dd_libraries/nodejs/)
- [Install the Node.js agent (New Relic) docs.newrelic.com](https://docs.newrelic.com/docs/apm/agents/nodejs-agent/installation-configuration/install-nodejs-agent/)
- [New Relic OTLP endpoint docs.newrelic.com](https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/)
