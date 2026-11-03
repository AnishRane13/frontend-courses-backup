---
title: "API Versioning, Error Shape, Rate Limiting & Docs"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/api-versioning
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# API Versioning, Error Shape, Rate Limiting & Docs

*11 min read · Updated 24 Jul 2026 Topic 42 of 70 Bookmark Mark done Why it matters The moment your API has a single external consumer you cannot control · Topic 42 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/api-versioning](https://www.geekyfrontend.in/learn/nodejs-backend-kit/api-versioning)

---

## Say it in 30 seconds

API versioning lets an old client keep calling the old contract while you ship a breaking change as a new version, usually a `/v1` or `/v2` path. A breaking change is one that can make an existing client fail, such as renaming a field or adding a required input. The same product needs one error shape, a rate limit that answers 429 when a client calls too fast, and an OpenAPI document so other people can call the API without reading your code. The trade-off is that every live version is maintenance you keep paying, so you version only when the change actually breaks someone.

## Why it matters

The moment one external client is outside your deploy, you cannot rename a field or change a response shape freely. A phone running a six-month-old build will break. Versioning is how the server evolves while old clients keep working.

A consistent error shape means every client writes one error handler. Rate limiting is how you stop one user from hammering an endpoint, and it is a standard system-design question. OpenAPI, the spec that used to be called Swagger, is a machine-readable description of the API. Docs, client libraries, and contract tests can be generated from it.

Together these four turn a working route into something other people can rely on.

## The concept, simply

Versioning lets two contracts exist at once, so a breaking change ships as v2 and old clients stay on v1.

![Three versioning strategies URI path custom header and media type with trade-offs](assets/i39_01_e26206d8.svg)

Three ways to version. The path is the one you can see in a browser and in logs.

- **URI path:** `/v1/users` and `/v2/users`. Visible, cacheable, and easy to route. This is the common choice.
- **Custom header:** `API-Version: 2`. The URL stays clean. You cannot paste a versioned URL into a browser, and caches must vary on the header.
- **Media type:** `Accept: application/vnd.myapp.v2+json`. This is the most REST-shaped, and the least supported by tools.

A **breaking change** can break an existing client: removing or renaming a field, changing a type, adding a required input, or changing what a status code means. An **additive change**, such as a new optional field or a new endpoint, is backward compatible and does not need a new version.

A **consistent error shape** is one JSON structure for every error, for example `{ error: { code, message, details } }`. Clients branch on a machine-readable `code`, not on the human sentence. **Rate limiting** caps how many requests a client may make in a window and returns **429 Too Many Requests** when the cap is hit. **OpenAPI** is a YAML or JSON document of paths, methods, schemas, and auth.

## How it works (deep)

**Path versioning wins in practice** even though a strict reading of REST says the same resource should not have two URIs. It wins because you can see the version in logs and in a browser, you can mount `v1Router` and `v2Router` separately, and each URL caches on its own. Header and media-type versioning keep the URL "pure" and cost you tooling: a CDN has to vary on the header, and debugging is harder.

Each live version is maintenance forever, so design responses so you rarely need a new one. Return objects, not bare arrays, so you can add fields later. Add optional fields freely. Cut a new version only for a real break. Then run old and new side by side, announce a sunset, often with a `Deprecation` or `Sunset` header, and give clients months.

**One error envelope, formatted in one place.** The failure mode is every route inventing a shape: `{ error }`, `{ message }`, or a bare string. Put a machine-readable `code`, a human `message`, and optional `details` for field errors in a single Express error middleware. That middleware is a function of four arguments, `(err, req, res, next)`. Express only treats it as an error handler when it has exactly those four. Map error types to status codes there. For a 5xx, log the real cause on the server and return a generic message. Never send a stack trace or a raw database error to the client.

**Rate-limit algorithms.** A fixed window counts requests per clock minute. It is simple, and a burst at the boundary can reach about twice the limit, because the last second of one window and the first second of the next each have a full budget. A sliding window smooths that edge. A token bucket refills tokens at a steady rate and each request spends one, so you allow a controlled burst and then an average rate. A leaky bucket processes at a fixed rate and smooths output. One Node process can count in memory. Several instances cannot: each keeps its own count, and the real limit becomes N times what you intended. Put the counter in a shared store, usually Redis. Key by user id when you have one, and fall back to IP. Return 429 plus `Retry-After` and the `RateLimit-*` headers so a well-behaved client backs off.

**OpenAPI is the contract.** It describes paths, methods, request and response schemas, and auth. Swagger UI renders interactive docs from it. Generators produce typed clients and server stubs. Contract tests check that the implementation matches the spec. You can write the file by hand or generate it from annotations. The point is one source of truth, so the docs cannot drift from the routes.

## Code examples

URI-path versioning by mounting separate routers — v1 and v2 evolve independently.

javascript

```
const express = require('express');
const app = express();

const v1 = require('./routes/v1');
const v2 = require('./routes/v2');

// Signal deprecation so clients know to migrate.
// Register it BEFORE the v1 router: middleware runs in registration order, and
// once the v1 router has sent a response nothing registered after it runs.
app.use('/v1', (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
  next();
});

app.use('/v1', v1); // legacy clients keep working
app.use('/v2', v2); // new shape, breaking changes live here

// Real output (Express 5.2.1, Node v24.19.0):
//   deprecation middleware AFTER app.use('/v1', v1):  GET /v1/users 200  Deprecation: null  Sunset: null
//   deprecation middleware BEFORE app.use('/v1', v1): GET /v1/users 200  Deprecation: true  Sunset: Wed, 31 Dec 2026 23:59:59 GMT
//   GET /v2/users 200  Deprecation: null
```

![Three outcomes of a middleware call: res.send or res.json ends the chain, next passes to the next middleware in registration order, next(err) skips to the error handler](assets/i33_02_4aebd34f.svg)
*Figure: what each middleware outcome does to the chain. Look at: the res.send() / res.json() branch — a router that responds ends the chain, so a middleware registered after it never runs.*

> **Why this was wrong:** the earlier version registered the deprecation middleware after `app.use('/v1', v1)`. The v1 router answered every request first, so the headers were never sent.

A single, consistent error shape via centralized error-handling middleware — note the four arguments and the 4xx/5xx split:

javascript

```
// Throw typed errors anywhere in the app
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status; this.code = code; this.details = details;
  }
}

// One place formats EVERY error (must have 4 args to be an error handler)
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  // Never leak internals on 5xx
  const body = status >= 500
    ? { error: { code: 'INTERNAL', message: 'Something went wrong' } }
    : { error: { code: err.code, message: err.message, details: err.details } };

  if (status >= 500) console.error(err); // log real cause server-side
  res.status(status).json(body);
}

app.use(errorHandler); // mounted LAST, after all routes
```

Rate limiting with a Redis-backed store so the limit is correct across many instances:

javascript

```
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('./redisClient');

const limiter = rateLimit({
  windowMs: 60 * 1000,          // 1-minute window
  limit: 100,                   // 100 requests per key per window (named `max` before v7)
  standardHeaders: true,        // RateLimit-* headers
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args) }),
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip), // per user, fallback per IP (v8: IPv6-safe helper)
  handler: (req, res) => {
    res.set('Retry-After', '60');
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  },
});

app.use('/api', limiter);

// Real output (express-rate-limit 8.7.1, rate-limit-redis 6.0.1, ioredis 6.0.0, Redis 8.0.5):
//   GET /api/ping #1 200  RateLimit-Limit: 100  RateLimit-Remaining: 99
//   GET /api/ping #2 200  RateLimit-Limit: 100  RateLimit-Remaining: 98
//   redis keys: [ 'rl:127.0.0.1' ]
// With the old `keyGenerator: (req) => req.user?.id || req.ip`, v8 logs
//   ValidationError: Custom keyGenerator appears to use request IP without calling the
//   ipKeyGenerator helper function for IPv6 addresses. ... code: 'ERR_ERL_KEY_GEN_IPV6'
```

A minimal OpenAPI fragment documenting one endpoint, plus serving interactive docs with Swagger UI:

javascript

```
// openapi.yaml (excerpt)
// paths:
//   /v2/users/{id}:
//     get:
//       summary: Get a user by id
//       parameters:
//         - name: id
//           in: path
//           required: true
//           schema: { type: string }
//       responses:
//         '200': { description: OK }
//         '404': { description: Not found }

const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const spec = YAML.load('./openapi.yaml');

app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec)); // interactive docs
```

## Common mistakes & gotchas

- **A new version for an additive change.** An optional field does not need v2. Extra versions are maintenance.
- **No sunset.** Without a date, v1 lives forever. Announce it, and send `Deprecation` and `Sunset`.
- **A different error shape per route.** Clients then need a handler per endpoint.
- **Stack traces and database errors on 5xx.** Log them on the server. Return a generic message.
- **An error middleware with three arguments.** Express detects an error handler by its length. Three parameters means normal middleware, and thrown errors skip it.
- **An in-memory counter on several instances.** Each process counts alone, so the real limit is N times the setting. Use Redis.
- **Keying only by IP.** A corporate NAT or a mobile network shares one address. Prefer the user id, with IP as the fallback.
- **Docs maintained by hand.** They rot. Generate them from the OpenAPI spec, or contract-test against it.
- **A bare array as the whole response.** You cannot add pagination later without breaking clients. Wrap it in an object.

## Best practices

- Default to path versions, `/v1` and `/v2`. Version only on a breaking change. Add fields freely.
- Return objects, never a bare array, so additive changes stay compatible.
- Overlap versions, send `Deprecation` and `Sunset`, and give clients months.
- One error envelope, with `code`, `message`, and optional `details`, built in one four-argument error middleware.
- On 5xx, log the cause and return a generic message.
- Rate-limit with Redis across instances, key by user then IP, and return 429 with `Retry-After` and `RateLimit-*`.
- Keep an OpenAPI spec as the source of truth, serve Swagger UI, and generate clients and tests from it.

## ⭐ Interview lens

> **Q: Which API versioning strategy would you choose and why?**  
> I would put the version in the path, `/v1/users` and `/v2/users`. A path is visible in logs and in a browser, you can mount a separate router for each version, and caches treat the URLs as different resources. A custom header such as `API-Version: 2`, or a media type such as `Accept: application/vnd.myapp.v2+json`, keeps a single URL, which is closer to a strict reading of REST, and it is harder to test and to cache because the cache has to vary on that header. For example, a mobile app on v1 and a new web app on v2 can share one host, and a log line tells you which contract failed. The limit is that every live version is code you maintain. Version only for a breaking change, run the old and new side by side, and send `Deprecation` and `Sunset` so v1 has an end date.

> **Q: What counts as a breaking change requiring a new version?**  
> A breaking change is one that can make an existing client fail. Removing or renaming a field, changing a field's type, adding a required request field, and changing what a status code means are breaking. Adding an optional response field, or adding a new endpoint, is additive: old clients ignore what they do not know. For example, renaming `name` to `fullName` needs a v2, and adding optional `nickname` does not. The limit is a response that is a bare array. You cannot later wrap it in `{ data, pagination }` without breaking every client, so the compatible shape from day one is an object. Design so you add fields instead of cutting versions.

> **Q: How would you rate-limit an endpoint across a horizontally-scaled service?**  
> A shared counter in Redis, using a token bucket or a sliding window, keyed by user id with the IP as a fallback. A token bucket refills tokens at a steady rate and each request spends one, so a short burst is allowed and the average rate holds. When the bucket is empty, answer 429 with `Retry-After` and the `RateLimit-*` headers. For example, 100 requests a minute per user, stored in Redis, stays 100 even when ten app instances are running. The limit of an in-memory counter is that each process has its own count, so ten instances allow about 1,000. Also do not key only by IP when users share a NAT. And do not set `trust proxy` to `true` behind a load balancer: the client can then pick the address that the limiter sees.

> **Q: Why must your Express error handler take four arguments?**  
> Express decides that a middleware function is an error handler by counting its parameters. Only `(err, req, res, next)` is an error handler. A function with three parameters is ordinary middleware, so a thrown error skips it and falls through to Express's default handler, which may send an HTML stack trace. You put one four-argument function after the routes and build every error body there: a machine-readable `code`, a human `message`, and optional `details`. For example, a validation error becomes 422 with `EMAIL_TAKEN`, and an unexpected throw becomes 500 with a generic message while the stack stays in the server log. The limit is that the parameter has to be present in the source even if you never call `next`. Dropping it to silence a linter turns the handler back into normal middleware.

## Cheat-card

- Version on a breaking change only. Add optional fields freely. Default to `/v1` and `/v2`.
- Breaking means a removed or renamed field, a changed type, a new required input, or a changed status meaning.
- Deprecate with an overlap, `Deprecation` and `Sunset` headers, and a migration window.
- One error envelope: `{ error: { code, message, details } }`, built in four-argument middleware. Hide internals on 5xx.
- An Express error handler needs `(err, req, res, next)`. Three parameters and it is skipped.
- Rate limit with a shared store across instances, key by user or IP, return 429 and `Retry-After`. A token bucket allows a controlled burst.
- OpenAPI, formerly Swagger, is one spec for docs, SDKs, and contract tests.
- Return objects, not bare arrays, so you can add fields later.

## Good to know

- RFC 9457 Problem Details uses `application/problem+json` with `type` (default `about:blank`), `title`, `status` (advisory), `detail`, `instance`, and extension members. Set `res.type()` before `res.json()`.
- Behind a proxy, `app.set('trust proxy', 1)` or the proxy subnet makes `req.ip` the client. Left unset, everyone shares the proxy's bucket. `true` lets the client choose an IP through `X-Forwarded-For` (lesson 52).
- A custom `keyGenerator` skips express-rate-limit's `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` and `ERR_ERL_PERMISSIVE_TRUST_PROXY` checks. Test the proxy setup yourself.
- Q: What does a good error response look like? One envelope: a machine-readable `code`, a human `message`, and optional `details`. Build it in one middleware. On 5xx, log the cause and hide it. Clients then write one handler.
- Q: What is OpenAPI and why use it? A YAML or JSON spec of paths, schemas, and auth. From it you generate Swagger UI, typed clients, and contract tests, so the docs cannot drift from the routes. Swagger is the old name of that spec.
- Q: Fixed window or token bucket? A fixed window counts per clock interval and can allow about twice the limit across the boundary. A token bucket refills at a steady rate and each request spends a token, so the burst is capped by the bucket and the average rate holds.
- Q: What is RFC 9457 and what does `about:blank` mean? The standard JSON error, `application/problem+json`, with `type`, `title`, `status`, `detail`, and `instance`, plus extension members clients must ignore if they do not know them. Omitting `type` means `about:blank`: nothing beyond the HTTP status, and `title` should be the reason phrase. The body's `status` is advisory. The status line is what clients act on. Hide `detail` on 5xx.
- Q: The rate limiter blocks everyone after a deploy behind a load balancer. Why? `trust proxy` is false, so `req.ip` is the balancer and every user shares one bucket. Set `app.set('trust proxy', 1)` or the balancer subnet so Express takes the client address the balancer appended. Never use `true`: `req.ip` is then the left-most `X-Forwarded-For` entry, which the client controls. The app must be reachable only through the balancer.

---

## Learn More

- [Web API Design Best Practices (API Versioning) - Azure Architecture Center learn.microsoft.com](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [Microsoft Azure REST API Guidelines - API Versioning github.com](https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md)
- [API Versioning Explained | Lightboard Series MuleSoft Videos](https://www.youtube.com/watch?v=_WWr_eFRDeM)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0, express-rate-limit 8.7.1 (in-memory store), supertest 7.3.1*

### RFC 9457 Problem Details (`application/problem+json`)

The error envelope above (`{ error: { code, message, details } }`) is a house format: every client has to learn it. **Problem Details** (RFC 9457, which obsoletes RFC 7807) is the standard version of the same idea. An error response is a JSON object with media type `application/problem+json` and five defined members:

- `type`: a URI naming the kind of problem. Clients branch on it, the way they would branch on a `code`.
- `title`: a short human summary of that type.
- `status`: the HTTP status code, repeated in the body. RFC 9457 calls it "only advisory", so the real status line still has to be correct.
- `detail`: an explanation of this occurrence.
- `instance`: a URI reference for this occurrence.

Any other top-level member is an **extension member** (for example `errors` for field-level validation, or your own `code`). Clients "MUST ignore any such extensions" they do not recognise, so adding one is not a breaking change. When `type` is omitted, it defaults to `about:blank`, meaning "this problem has no meaning beyond the HTTP status code". In that case the `title` SHOULD be the standard reason phrase (`Not Found`).

How it works:

1. Route code throws (or `next()`s) a `ProblemError` that carries `status`, `type`, `title`, `detail` and any extension members. Async handlers can just throw: Express 5 forwards rejected promises to the error handler.
2. A catch-all middleware after the routes turns "no route matched" into a 404 `ProblemError`, so 404s use the same format instead of Express's HTML page.
3. The single four-argument error handler builds the object. Errors that are not `ProblemError`s become `about:blank`, with the title taken from `http.STATUS_CODES`. A body-parser error keeps its own `status` (400 for broken JSON). 5xx responses get no `detail`, so internals stay in the server log.
4. `req.accepts(['application/problem+json', 'application/json'])` picks the media type. A client whose `Accept` lists only `application/json` gets the same body labelled `application/json`. Everyone else, including `Accept: */*`, gets `application/problem+json`. RFC 9457 itself allows sending `application/problem+json` even when the client did not list it ("as is allowed by HTTP"), so this step is a courtesy to strict JSON-only clients, not a requirement.
5. `res.type(...)` is set before `res.json(...)`. `res.json` only fills in `Content-Type` when it is empty, so the problem type survives, with `; charset=utf-8` added.

**Example — one Express 5 error handler mapping validation, bad JSON, 404 and 500 to problem details.**

javascript

```
// problem.cjs: RFC 9457 Problem Details from one Express 5 error handler.
const express = require('express');
const { STATUS_CODES } = require('node:http');

// A typed error that already knows its problem fields.
class ProblemError extends Error {
  constructor(status, { type = 'about:blank', title, detail, ...extensions } = {}) {
    super(detail ?? title);
    Object.assign(this, { status, type, title, detail, extensions });
  }
}

const app = express();
app.use(express.json());

app.post('/orders', (req, res) => {
  const { quantity } = req.body ?? {};
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new ProblemError(422, {
      type: 'https://api.example.com/problems/validation-error',
      title: 'Your request is not valid',
      detail: 'One or more fields failed validation.',
      errors: [{ pointer: '#/quantity', detail: 'must be a positive integer' }], // extension member
    });
  }
  res.status(201).json({ id: 1, quantity });
});

app.get('/boom', async () => { throw new Error('db password=hunter2 rejected'); }); // Express 5 forwards it

// Unmatched routes become a 404 problem instead of Express's HTML page.
app.use((req, res, next) => next(new ProblemError(404, { detail: `No route for ${req.method} ${req.path}` })));

// The only place that formats errors.
app.use((err, req, res, next) => {
  let status = err.status ?? err.statusCode ?? 500;
  if (status < 400 || status > 599) status = 500;
  const known = err instanceof ProblemError;
  const problem = {
    type: known ? err.type : 'about:blank',                 // about:blank = "nothing beyond the status code"
    title: (known && err.title) || STATUS_CODES[status],    // with about:blank, title = the status phrase
    status,
    detail: status >= 500 ? undefined : (err.detail ?? err.message), // never leak 5xx internals
    instance: req.originalUrl,
    ...(known ? err.extensions : {}),                       // extension members sit at the top level
  };
  if (status >= 500) console.error('logged server-side:', err.message);

  // Content negotiation: a client that accepts only application/json still gets JSON.
  const type = req.accepts(['application/problem+json', 'application/json']) || 'application/problem+json';
  res.status(status).type(type).json(problem);
});

const server = app.listen(6720, async () => {
  const url = 'http://127.0.0.1:6720';
  const show = async (label, path, init = {}) => {
    const r = await fetch(url + path, init);
    console.log(`${label}\n  ${r.status} ${r.headers.get('content-type')}\n  ${await r.text()}`);
  };
  const json = { 'Content-Type': 'application/json' };
  await show('POST /orders {"quantity":0}', '/orders', { method: 'POST', headers: json, body: '{"quantity":0}' });
  await show('POST /orders broken JSON', '/orders', { method: 'POST', headers: json, body: '{"quantity":' });
  await show('GET /nope', '/nope');
  await show('GET /boom', '/boom');
  await show('GET /nope  Accept: application/json', '/nope', { headers: { Accept: 'application/json' } });
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0):
//   POST /orders {"quantity":0}
//     422 application/problem+json; charset=utf-8
//     {"type":"https://api.example.com/problems/validation-error","title":"Your request is not valid","status":422,"detail":"One or more fields failed validation.","instance":"/orders","errors":[{"pointer":"#/quantity","detail":"must be a positive integer"}]}
//   POST /orders broken JSON
//     400 application/problem+json; charset=utf-8
//     {"type":"about:blank","title":"Bad Request","status":400,"detail":"Unexpected end of JSON input","instance":"/orders"}
//   GET /nope
//     404 application/problem+json; charset=utf-8
//     {"type":"about:blank","title":"Not Found","status":404,"detail":"No route for GET /nope","instance":"/nope"}
//   logged server-side: db password=hunter2 rejected
//   GET /boom
//     500 application/problem+json; charset=utf-8
//     {"type":"about:blank","title":"Internal Server Error","status":500,"instance":"/boom"}
//   GET /nope  Accept: application/json
//     404 application/json; charset=utf-8
//     {"type":"about:blank","title":"Not Found","status":404,"detail":"No route for GET /nope","instance":"/nope"}
```

The 500 body has no `detail` and does not mention the password; the message only reaches the server log. The validation problem uses a real `type` URI (`https://api.example.com/problems/validation-error` stands in for a page you would publish that describes the problem type) and an `errors` extension member using JSON Pointers, the shape RFC 9457 uses in its own example. `instance` is the request path here; many APIs use a per-request ID URI instead so support staff can find the log line.

### `trust proxy` so the rate limiter sees real client IPs

Behind a reverse proxy or load balancer, every TCP connection to your app comes from the proxy. Express's `req.ip` is the socket's address unless the `trust proxy` setting tells it which `X-Forwarded-For` entries to believe. The rate limiter keys on `req.ip` (here through `ipKeyGenerator(req.ip)`, as in the corrected example above). With the setting left at `false`, all clients therefore share **one** bucket: the proxy's. Set it to `true` and Express believes the left-most `X-Forwarded-For` entry, which the client wrote itself. Anyone can then pick a new IP per request and never be limited. Lesson 52 explains every accepted value ([Express app settings and locals](52-express-app-settings-and-locals.md#how-it-works)).

How it works:

1. The proxy receives a connection from the client (`127.0.0.2`). It appends that address to whatever `X-Forwarded-For` the client sent and forwards the request to the app.
2. The app sees the socket address `127.0.0.1` (the proxy) and `X-Forwarded-For: [forged, …,] 127.0.0.2`.
3. `trust proxy` unset (`false`): `req.ip` = socket = `127.0.0.1` for everyone.
4. `trust proxy` `1`: trust one hop. Express walks the list from the right and takes the first address after one trusted hop: the entry the proxy appended, the real client.
5. `trust proxy` `true`: trust every hop, so `req.ip` is the left-most entry. For a client that sent its own header, that is the forged value.

Linux routes the whole `127.0.0.0/8` range to the loopback interface. The clients below bind `127.0.0.2`, `.3` and `.4` as their source address, so the proxy sees three different real IPs without any extra machines.

**Example — a real local proxy in front of a rate-limited app, with `trust proxy` unset, `1` and `true`.**

javascript

```
// proxy.cjs: a tiny reverse proxy on :6711 that forwards to the app on :6710
// and appends the caller's address to X-Forwarded-For, the way nginx's
// $proxy_add_x_forwarded_for does.
const http = require('node:http');

http.createServer((req, res) => {
  const prior = req.headers['x-forwarded-for'];            // whatever the client sent (may be forged)
  const peer = req.socket.remoteAddress;                    // the address the proxy really saw
  const upstream = http.request({
    host: '127.0.0.1', port: 6710, method: req.method, path: req.url,
    headers: { ...req.headers, 'x-forwarded-for': prior ? `${prior}, ${peer}` : peer },
  }, (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(6711, '127.0.0.1', () => console.log('proxy :6711 -> app :6710'));
```

javascript

```
// app.cjs: the rate-limited API behind the proxy. TRUST_PROXY = unset | 1 | true
const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const app = express();
const trust = process.env.TRUST_PROXY;
if (trust !== undefined) app.set('trust proxy', trust === 'true' ? true : Number(trust));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 3,                                         // small, so the demo hits 429 quickly
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip), // same key rule as the lesson
}));
app.get('/api/ping', (req, res) => res.json({ ip: req.ip }));

app.listen(6710, '127.0.0.1', () => console.log(`app :6710 trust proxy = ${app.get('trust proxy')}`));
```

javascript

```
// clients.cjs: three "machines" call the proxy. Linux routes all of 127.0.0.0/8 to
// loopback, so binding localAddress gives each client its own real source IP.
const http = require('node:http');

function call(localAddress, forged) {
  return new Promise((resolve, reject) => {
    const headers = forged ? { 'X-Forwarded-For': forged } : {};
    http.get({ host: '127.0.0.1', port: 6711, path: '/api/ping', localAddress, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(`${res.statusCode} remaining=${res.headers['ratelimit-remaining']} ${body}`));
    }).on('error', reject);
  });
}

(async () => {
  for (let i = 1; i <= 4; i++) console.log(`alice   127.0.0.2 #${i}:`, await call('127.0.0.2'));
  console.log(`bob     127.0.0.3 #1:`, await call('127.0.0.3'));
  for (let i = 1; i <= 4; i++) {
    const fake = `203.0.113.${i}`;                  // mallory forges a new X-Forwarded-For each time
    console.log(`mallory 127.0.0.4 #${i} (XFF ${fake}):`, await call('127.0.0.4', fake));
  }
})();
```

bash

```
#!/bin/bash
# run-demo.sh: proxy + app + clients, once per trust proxy value. Prints each command, then its output.
node proxy.cjs & PROXY_PID=$!; sleep 0.5
for mode in unset 1 true; do
  echo "=== TRUST_PROXY=$mode"
  if [ "$mode" = unset ]; then node app.cjs & APP_PID=$!
  else TRUST_PROXY=$mode node app.cjs & APP_PID=$!; fi
  sleep 0.7
  node clients.cjs
  kill $APP_PID; wait $APP_PID 2>/dev/null
done
kill $PROXY_PID
```

bash

```
$ bash run-demo.sh
proxy :6711 -> app :6710
=== TRUST_PROXY=unset
app :6710 trust proxy = false
alice   127.0.0.2 #1: 200 remaining=2 {"ip":"127.0.0.1"}
alice   127.0.0.2 #2: 200 remaining=1 {"ip":"127.0.0.1"}
alice   127.0.0.2 #3: 200 remaining=0 {"ip":"127.0.0.1"}
alice   127.0.0.2 #4: 429 remaining=0 Too many requests, please try again later.
bob     127.0.0.3 #1: 429 remaining=0 Too many requests, please try again later.
mallory 127.0.0.4 #1 (XFF 203.0.113.1): 429 remaining=0 Too many requests, please try again later.
mallory 127.0.0.4 #2 (XFF 203.0.113.2): 429 remaining=0 Too many requests, please try again later.
mallory 127.0.0.4 #3 (XFF 203.0.113.3): 429 remaining=0 Too many requests, please try again later.
mallory 127.0.0.4 #4 (XFF 203.0.113.4): 429 remaining=0 Too many requests, please try again later.
=== TRUST_PROXY=1
app :6710 trust proxy = 1
alice   127.0.0.2 #1: 200 remaining=2 {"ip":"127.0.0.2"}
alice   127.0.0.2 #2: 200 remaining=1 {"ip":"127.0.0.2"}
alice   127.0.0.2 #3: 200 remaining=0 {"ip":"127.0.0.2"}
alice   127.0.0.2 #4: 429 remaining=0 Too many requests, please try again later.
bob     127.0.0.3 #1: 200 remaining=2 {"ip":"127.0.0.3"}
mallory 127.0.0.4 #1 (XFF 203.0.113.1): 200 remaining=2 {"ip":"127.0.0.4"}
mallory 127.0.0.4 #2 (XFF 203.0.113.2): 200 remaining=1 {"ip":"127.0.0.4"}
mallory 127.0.0.4 #3 (XFF 203.0.113.3): 200 remaining=0 {"ip":"127.0.0.4"}
mallory 127.0.0.4 #4 (XFF 203.0.113.4): 429 remaining=0 Too many requests, please try again later.
=== TRUST_PROXY=true
app :6710 trust proxy = true
alice   127.0.0.2 #1: 200 remaining=2 {"ip":"127.0.0.2"}
alice   127.0.0.2 #2: 200 remaining=1 {"ip":"127.0.0.2"}
alice   127.0.0.2 #3: 200 remaining=0 {"ip":"127.0.0.2"}
alice   127.0.0.2 #4: 429 remaining=0 Too many requests, please try again later.
bob     127.0.0.3 #1: 200 remaining=2 {"ip":"127.0.0.3"}
mallory 127.0.0.4 #1 (XFF 203.0.113.1): 200 remaining=2 {"ip":"203.0.113.1"}
mallory 127.0.0.4 #2 (XFF 203.0.113.2): 200 remaining=2 {"ip":"203.0.113.2"}
mallory 127.0.0.4 #3 (XFF 203.0.113.3): 200 remaining=2 {"ip":"203.0.113.3"}
mallory 127.0.0.4 #4 (XFF 203.0.113.4): 200 remaining=2 {"ip":"203.0.113.4"}
```

What the three runs show (limit 3 per minute):

- **Unset:** `req.ip` is `127.0.0.1` for all three machines. Alice uses up the shared bucket, and Bob and Mallory get 429 on their first request, before they have sent anything themselves.
- **`1`:** each machine has its own bucket. Alice is limited after 3; Bob is untouched. Mallory's forged `X-Forwarded-For` is ignored (`ip` stays `127.0.0.4`), and she is limited after 3 as well.
- **`true`:** Alice and Bob still look right, because they sent no header of their own. Mallory's four requests get four different `req.ip` values taken from her forged header, `remaining` never drops below 2, and she is never limited.

### Common mistakes & gotchas (additional topics)

- **`trust proxy: true` "to make it work".** It does make `req.ip` look right for honest clients, which is why it slips through review. It also lets any client choose its own IP. Use the hop count (`1` for one proxy) or the proxy's address or subnet.
- **A custom `keyGenerator` turns off express-rate-limit's proxy checks.** The library's default key generator runs the `trustProxy` and `xForwardedForHeader` validations. The lesson's custom `(req) => req.user?.id || ipKeyGenerator(req.ip)` replaces it, so a misconfiguration logs nothing:

javascript

```
// checks.cjs: express-rate-limit's built-in trust-proxy checks, default vs custom keyGenerator.
const express = require('express');
const request = require('supertest');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

async function probe(label, trust, custom) {
  const app = express();
  if (trust !== undefined) app.set('trust proxy', trust);
  app.use(rateLimit({
    windowMs: 60 * 1000, limit: 3, standardHeaders: true, legacyHeaders: false,
    ...(custom ? { keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip) } : {}),
  }));
  app.get('/', (req, res) => res.send('ok'));
  const logged = [];
  const orig = console.error;
  console.error = (e) => logged.push(e?.code ?? String(e)); // the library logs ValidationErrors with console.error
  const r = await request(app).get('/').set('X-Forwarded-For', '203.0.113.9');
  console.error = orig;
  console.log(`${label.padEnd(44)} ${r.status}  logged: ${logged.join(', ') || '(nothing)'}`);
}

(async () => {
  await probe('trust proxy unset, default keyGenerator', undefined, false);
  await probe('trust proxy true,  default keyGenerator', true, false);
  await probe('trust proxy 1,     default keyGenerator', 1, false);
  await probe('trust proxy unset, custom keyGenerator', undefined, true);
  await probe('trust proxy true,  custom keyGenerator', true, true);
})();

// Real output (Node v24.19.0, Express 5.3.0, express-rate-limit 8.7.1):
//   trust proxy unset, default keyGenerator      200  logged: ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
//   trust proxy true,  default keyGenerator      200  logged: ERR_ERL_PERMISSIVE_TRUST_PROXY
//   trust proxy 1,     default keyGenerator      200  logged: (nothing)
//   trust proxy unset, custom keyGenerator       200  logged: (nothing)
//   trust proxy true,  custom keyGenerator       200  logged: (nothing)
```

With a custom key generator, test the topology yourself, like the proxy demo above. The error codes are listed on the express-rate-limit wiki ([Error Codes](https://github.com/express-rate-limit/express-rate-limit/wiki/Error-Codes)).
- **Sending `title` that changes per request.** `title` describes the problem *type*; put occurrence details in `detail` or in extension members.
- **Returning `status` in the body but a different status line.** Clients and proxies act on the status line; the body copy is advisory.

### Edge case worked through: `trust proxy: 1` when the proxy can be bypassed

A hop count only says "the last N addresses are mine". Express cannot tell whether the last hop really was your proxy. If a client reaches the app port directly, the socket address is the client itself, and with `1` Express trusts it as the hop and takes the address to its left, the one the client wrote:

javascript

```
// bypass.cjs: trust proxy = 1, but the client talks to the app directly (no proxy in between).
const express = require('express');
const request = require('supertest');

const app = express();
app.set('trust proxy', 1);
app.get('/', (req, res) => res.json({ ip: req.ip, ips: req.ips }));

(async () => {
  for (const xff of [null, '198.51.100.7']) {
    const r = await request(app).get('/').set(xff ? { 'X-Forwarded-For': xff } : {});
    console.log(`X-Forwarded-For: ${xff ?? '(none)'}`.padEnd(32), r.text);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   X-Forwarded-For: (none)          {"ip":"127.0.0.1","ips":[]}
//   X-Forwarded-For: 198.51.100.7    {"ip":"198.51.100.7","ips":["198.51.100.7"]}
```

That is why `app.cjs` listens on `127.0.0.1` only, so nothing outside the machine can skip the proxy. In production, use a private network or firewall rule, or give `trust proxy` the proxy's actual address or subnet (for example `'10.0.0.0/8'` or `'loopback'`). Then a direct connection from any other address is not trusted at all.

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
