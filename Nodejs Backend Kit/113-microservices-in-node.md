---
title: "Microservices in Node"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/microservices
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Microservices in Node

*11 min read · Updated 24 Jul 2026 Topic 69 of 70 Bookmark Mark done Why it matters Every backend starts as a monolith · Topic 69 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/microservices](https://www.geekyfrontend.in/learn/nodejs-backend-kit/microservices)

---

## Why it matters

Every backend starts as a **monolith**: one codebase, one deploy, one database. That is not an embarrassment — it is the correct default, and it stays correct for a very long time. But as an organisation grows, a single deployable can become a bottleneck: fifty engineers stepping on one release pipeline, one memory leak taking the whole product down, and a checkout path that needs ten servers dragging along an admin panel that needs one.

**Microservices** split that one process into many small, independently deployable services, each owning a slice of the domain. It is one of the most over-applied ideas in the industry — teams adopt it for résumé reasons and inherit a distributed-systems tax they were not ready to pay. So the interview value here is almost entirely about *judgement*: recognising the real forces that justify the split, drawing service boundaries that do not leak, and naming honestly what you give up. In Node specifically, the lightweight process model makes spinning up services easy, which makes the discipline of *not* over-splitting even more important.

## The concept, simply

A monolith keeps all its modules in one process; they call each other as ordinary function calls and share one database. Microservices put each capability in its own process, on its own schedule, usually with its own database, and they talk over the **network** instead of via function calls. The unit of independence is the key idea: you can deploy, scale, and (in a failure) lose one service without touching the others.

![A monolith box holding four internal modules over one database, beside four separate services each with its own database talking over the network](assets/i66_01_b72019ff.svg)

A monolith calls in-process over one DB — simple and fast; microservices trade that simplicity for independent deploy and scaling, paying with network calls, distributed data, and operational overhead.

The single most important concept is the **service boundary**. A good boundary follows a *business capability* that changes as a unit and owns its data — "Orders", "Payments", "Notifications" — not a technical layer like "the database service". The litmus test: two services should be able to evolve and deploy independently. If every change to Orders forces a coordinated change to Inventory, you have not drawn a boundary; you have drawn a fault line.

## How it works (deep)

**Data ownership** is the rule that makes microservices actually independent: each service owns its data and no other service touches that database directly — the "database-per-service" pattern. The instant two services share a table, they are coupled at the schema and can no longer deploy independently; you have built a "distributed monolith", which has all the network cost of microservices and none of the independence. Cross-service data is obtained by *asking the owning service*, never by reaching into its store.

**Communication** comes in two flavours. *Synchronous* request/response (HTTP/REST or gRPC) is simple and immediate but creates temporal coupling — if Payments is down, the caller waiting on it is affected, and chains of synchronous calls multiply latency and failure probability. *Asynchronous* messaging (events over a queue or broker) decouples in time: Orders emits "OrderPlaced" and moves on; Notifications and Analytics react whenever they can. Async buys resilience and scalability at the cost of eventual consistency and harder reasoning. Mature systems mix both: synchronous where an answer is needed now, events for everything that can be fire-and-forget.

Because you cannot span a database transaction across services, **consistency becomes eventual** and multi-step workflows use the **Saga** pattern: a sequence of local transactions, each emitting an event that triggers the next, with *compensating actions* to undo prior steps if a later one fails (cancel the order if payment fails, refund the payment if shipping fails). This is a deliberate trade — you give up the simplicity of one ACID transaction to gain independence.

A cluster of supporting pieces make it workable: an **API gateway** as the single front door (auth, routing, rate limiting) so clients do not talk to dozens of services; **service discovery** so services find each other's moving addresses; **resilience patterns** — timeouts, retries with backoff and jitter, and **circuit breakers** that stop hammering a failing dependency — because in a distributed system partial failure is the normal case, not the exception; and **distributed tracing** with correlation IDs so one user action can be followed across ten services when it goes wrong. None of these exist in a monolith because in-process calls do not need them; every one of them is part of the tax.

## Code examples

Two tiny Node services talking over HTTP. Note the *timeout* — a synchronous caller must never wait forever on a dependency.

javascript

```
// orders-service: needs user data it does not own -> ask the users service
import express from 'express';
const app = express();

async function getUser(id) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 800); // fail fast, do not hang
  try {
    const res = await fetch('http://users-svc:4001/users/' + id, { signal: ac.signal });
    if (!res.ok) throw new Error('users-svc ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

app.get('/orders/:id', async (req, res) => {
  try {
    const order = { id: req.params.id, userId: '1', total: 999 };
    const user = await getUser(order.userId); // cross-service call
    res.json({ ...order, user });
  } catch (e) {
    res.status(503).json({ error: 'user lookup failed' });
  }
});

app.listen(4002);
```

A minimal circuit breaker — after repeated failures it "opens" and fails fast instead of piling requests onto a dead dependency, then probes to recover.

javascript

```
class CircuitBreaker {
  constructor(fn, { threshold = 5, cooldownMs = 10_000 } = {}) {
    this.fn = fn; this.threshold = threshold; this.cooldownMs = cooldownMs;
    this.failures = 0; this.state = 'closed'; this.openedAt = 0;
  }
  async call(...args) {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.cooldownMs) throw new Error('circuit open');
      this.state = 'half-open'; // allow one probe
    }
    try {
      const out = await this.fn(...args);
      this.failures = 0; this.state = 'closed';
      return out;
    } catch (err) {
      if (++this.failures >= this.threshold) {
        this.state = 'open'; this.openedAt = Date.now();
      }
      throw err;
    }
  }
}

const getUserSafe = new CircuitBreaker(getUser, { threshold: 3 });
```

Event-driven communication instead of a synchronous call — Orders emits an event and returns immediately; other services react on their own time. (Broker details are the next topic.)

javascript

```
// orders-service publishes; it does NOT wait for email/analytics
import amqplib from 'amqplib';

const conn = await amqplib.connect(process.env.AMQP_URL);
const ch = await conn.createChannel();
await ch.assertExchange('domain-events', 'topic', { durable: true });

function publish(routingKey, payload) {
  ch.publish('domain-events', routingKey,
    Buffer.from(JSON.stringify(payload)),
    { persistent: true, contentType: 'application/json' });
}

// after saving the order locally:
publish('order.placed', { orderId: 'o-42', userId: '1', total: 999 });
// respond to the client now; notifications + analytics consume asynchronously
```

A health/readiness endpoint — orchestrators (Kubernetes) use these to route traffic only to healthy instances, a basic requirement once you run many services.

javascript

```
import express from 'express';
const app = express();

let ready = false;
app.get('/livez', (_req, res) => res.send('ok'));       // process is up
app.get('/readyz', (_req, res) =>                          // deps are usable
  ready ? res.send('ready') : res.status(503).send('not ready'));

(async () => {
  await connectDbAndBroker(); // whatever this service depends on
  ready = true;
})();

app.listen(4001);
async function connectDbAndBroker() {}
```

## Common mistakes & gotchas

- **Splitting too early.** Microservices solve *organisational* and *scaling* problems you do not have on day one. A "monolith-first" approach lets boundaries reveal themselves before you cement them into network calls.
- **Sharing a database between services.** The fastest way to build a distributed monolith: now two services are coupled at the schema and must deploy together, so you pay the network cost and get none of the independence.
- **Drawing boundaries by technical layer** ("a data service", "a logic service") instead of by business capability. Capability boundaries change as a unit; layer boundaries force every feature to cut across many services.
- **Assuming the network is reliable.** Calls time out, retry, and arrive twice. Without timeouts, retries-with-backoff, idempotency, and circuit breakers, one slow dependency cascades into a full outage.
- **Chatty synchronous chains.** Service A calls B calls C calls D to serve one request — latency and failure probability multiply. Prefer events, or aggregate at a gateway, over deep synchronous fan-out.
- **Expecting ACID transactions across services.** There is no distributed transaction to lean on; multi-step consistency needs Sagas with compensating actions and idempotent handlers.
- **No distributed tracing.** When a request touches ten services, a stack trace in one of them tells you almost nothing. Without correlation IDs and tracing, debugging is guesswork.
- **Ignoring the operational cost.** Every service multiplies CI/CD, monitoring, on-call, and deployment surface. Ten services means ten of everything.

## Best practices

- **Start monolith-first;** extract a service only when a real force (independent scaling, team autonomy, isolation of a failure domain) demands it — modular boundaries inside the monolith make later extraction cheap.
- **One service owns its data;** never share a database. Cross-service data comes from the owning service's API or from events, never a direct table read.
- **Prefer async events for anything fire-and-forget;** reserve synchronous calls for when you truly need an answer now, and always bound them with timeouts.
- **Make every consumer idempotent** (dedupe on a message/operation id) because at-least-once delivery and retries mean messages will repeat.
- **Build in resilience:** timeouts, retry-with-backoff-and-jitter, circuit breakers, and sensible fallbacks — treat partial failure as normal.
- **Put a gateway out front** for auth, routing, and rate limiting, and standardise cross-cutting concerns (logging, tracing, correlation IDs) across services.
- **Version contracts and evolve them additively;** a breaking change to a shared event or API must not require a lockstep deploy of every consumer.
- **Invest in observability first:** centralised logs, metrics, and distributed tracing are prerequisites, not afterthoughts, once you cross a couple of services.

## ⭐ Interview lens

> **Q: When would you choose microservices over a monolith?** When concrete forces justify the tax: independent scaling of hot paths, autonomy for many teams shipping in parallel, isolating a failure or security domain, or differing technology needs. Absent those, a modular monolith is simpler, faster, and easier to operate. *Trap:* "because it scales better" — a well-built monolith scales horizontally too; microservices scale *parts* independently, which is a different claim.

> **Q: How do you decide service boundaries?** Around business capabilities that change and deploy as a unit and own their data (Orders, Payments, Notifications) — not around technical layers. The test is independent evolvability: if changing one always forces changing another, the boundary is wrong.

> **Q: What is a "distributed monolith" and why is it the worst case?** Services that must be deployed together — usually because they share a database or have tightly coupled synchronous contracts. You pay the full cost of the network and distributed operations while keeping the coupling of a monolith, getting the downsides of both.

> **Q: You cannot do a transaction across services. How do you keep data consistent?** Accept eventual consistency and use the Saga pattern: a chain of local transactions linked by events, with compensating actions to roll back completed steps when a later one fails. Handlers must be idempotent because messages can be redelivered.

> **Q: Service B is slow. How do you stop it from taking down A?** Timeouts so A never waits indefinitely, retries with backoff and jitter for transient blips, and a circuit breaker that trips after repeated failures to fail fast (with a fallback) instead of queuing doomed requests. Bulkheads isolate the resource pool so one dependency cannot starve the rest.

> **Q: Sync REST/gRPC vs async messaging between services — how do you choose?** Synchronous when the caller genuinely needs the result to proceed (a read it will render now) — accept the temporal coupling and bound it. Asynchronous events when the work can happen independently (notifications, analytics, downstream updates) — you gain decoupling and resilience but must design for eventual consistency and duplicate delivery.

## Cheat-card

- **Monolith =** one deploy, in-process calls, one DB — the right default. **Microservices =** many deploys, network calls, DB-per-service.
- **Boundary rule:** by business capability that owns its data and deploys independently — never by technical layer.
- **Never share a database** ➜ sharing one builds a "distributed monolith" (all cost, no independence).
- **Comms:** sync (HTTP/gRPC) when you need an answer now; async events for fire-and-forget resilience.
- **No cross-service ACID** ➜ Sagas + compensating actions + idempotent, at-least-once handlers.
- **Resilience kit:** timeouts, retry+backoff+jitter, circuit breakers, bulkheads; assume partial failure.
- **Ops tax:** gateway, service discovery, distributed tracing + correlation IDs, N× CI/CD and monitoring.
- **Default advice:** monolith-first; extract a service only when a real force demands it.
- **gRPC:** `.proto` contract + `@grpc/grpc-js` 1.14.6 + `@grpc/proto-loader` 0.8.1; unary `callback(null, msg)` or `callback({ code, details })`; server stream `call.write()` then `call.end()`; always pass `{ deadline }` (none by default). `NOT_FOUND` = 5, `DEADLINE_EXCEEDED` = 4.
- **Gateway / BFF:** one entry point does auth, request ids and timeouts, then forwards by prefix; a BFF route fans out with `Promise.all` and shapes one screen's response; upstream timeout = `504`.
- **Discovery:** `dns.lookup` = OS resolver on the thread pool; `resolveSrv` = DNS query returning host, port, priority, weight. Consul DNS (port 8600) omits failing instances; Kubernetes gives each Service a stable DNS name.
- **Outbox:** order row + outbox row in one transaction; relay claims with `FOR UPDATE SKIP LOCKED` and a lease, publishes, marks `sent_at`; a crash in between republishes, so consumers dedupe (claim → work → done).

---

## Learn More

- [Microservices (Martin Fowler & James Lewis) martinfowler.com](https://martinfowler.com/articles/microservices.html)
- [Pattern: Microservice Architecture microservices.io](https://microservices.io/patterns/microservices.html)
- [What Are Microservices Really All About? (And When Not To Use It) ByteByteGo](https://www.youtube.com/watch?v=lTAcCNbJ7KE)
- [Outbound HTTP: fetch, undici and http.request (this kit)](44-outbound-http-fetch-undici-and-http-request.md)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and @grpc/grpc-js 1.14.6, @grpc/proto-loader 0.8.1, Express 5.3.0, pg 8.23.1, ioredis 6.0.0, PostgreSQL 18.4, Redis 8.0.5*

### gRPC with @grpc/grpc-js

**gRPC** is a remote procedure call framework. A `.proto` file declares services, their methods and the message types they exchange, written in Protocol Buffers. Each call is an HTTP/2 stream. Messages travel as length-prefixed protobuf binary, and the outcome comes back as a numeric **status code** (`OK` = 0, `DEADLINE_EXCEEDED` = 4, `NOT_FOUND` = 5, and so on). Status codes and messages travel in HTTP/2 trailers. In Node, `@grpc/grpc-js` is the pure-JavaScript implementation and `@grpc/proto-loader` loads `.proto` files at runtime, so no code generation step is needed. Without a shared contract, a JSON-over-HTTP call between services has no schema that both sides compile against. A renamed field turns into `undefined` at runtime instead of a load-time error.

How it works:

1. `protoLoader.loadSync()` parses the `.proto` into a package definition. `grpc.loadPackageDefinition()` turns it into JavaScript constructors: a client class per service, plus `.service` for the server. Options decide the JS shape. `keepCase: false` turns `user_id` into `userId`, and `longs: Number` makes `int64` a plain number instead of a `Long` object.
2. **Unary** method: the handler gets `(call, callback)`. `callback(null, message)` sends the reply. `callback({ code, details })` ends the call with that status and no message.
3. **Server-streaming** method (`returns (stream Order)`): the handler gets a writable `call`. Each `call.write(msg)` sends a message, and `call.end()` sends status `OK` in the trailers. On the client the call is a readable stream, so `for await` reads the messages and the loop throws if the status is not `OK`.
4. **Deadlines**: the client passes `{ deadline: Date }`. grpc-js sends it as a `grpc-timeout` header, and both sides start a timer. When it fires, the client gets `DEADLINE_EXCEEDED` and the server call is cancelled (`call.cancelled` becomes `true`). gRPC's deadlines guide says: "By default, gRPC does not set a deadline", so a call without one can wait forever.

```
client                                     server
  | -- HEADERS :path /users.v1.UserService/ListOrders
  |            grpc-timeout (~250 ms) ---> |  handler(call); timer = 250 ms
  | -- DATA ListOrdersRequest ----------> |
  | <------------------ DATA Order o-1 -- |  call.write()   (t = 150 ms)
  |      ... t = 250 ms, deadline fires on both sides ...
  | client: error DEADLINE_EXCEEDED (4)   |  call.cancelled = true -> stop writing
  |
  | normal end instead:
  | <------ TRAILERS grpc-status: 0 ----- |  call.end()
```

**Example — a `.proto`, a server and a client: unary call, `NOT_FOUND`, a server stream, and a stream that hits its deadline.** Install with `npm install @grpc/grpc-js @grpc/proto-loader`.

proto

```
syntax = "proto3";

package users.v1;

service UserService {
  // unary: one request, one response
  rpc GetUser (GetUserRequest) returns (User);
  // server streaming: one request, a stream of responses
  rpc ListOrders (ListOrdersRequest) returns (stream Order);
}

message GetUserRequest { string id = 1; }
message User { string id = 1; string name = 2; }

message ListOrdersRequest { string user_id = 1; int32 delay_ms = 2; }
message Order { string id = 1; int64 total_cents = 2; }
```

javascript

```
// server.js — gRPC server for users.proto
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const def = protoLoader.loadSync(new URL('./users.proto', import.meta.url).pathname, {
  keepCase: false,  // user_id -> userId in JS
  longs: Number,    // int64 as JS number (fine below 2^53)
  defaults: true,
});
const { users } = grpc.loadPackageDefinition(def);

const USERS = new Map([['1', { id: '1', name: 'Ada' }]]);
const ORDERS = { 1: [{ id: 'o-1', totalCents: 999 }, { id: 'o-2', totalCents: 2500 }, { id: 'o-3', totalCents: 120 }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = new grpc.Server();
server.addService(users.v1.UserService.service, {
  GetUser(call, callback) {
    const user = USERS.get(call.request.id);
    if (!user) {
      return callback({ code: grpc.status.NOT_FOUND, details: `user ${call.request.id} not found` });
    }
    callback(null, user);
  },
  async ListOrders(call) {
    let sent = 0, ended = false;
    // grpc-js 1.14.6 also emits 'cancelled' after a normal end(), so check `ended`
    call.on('cancelled', () => console.log(`[server] 'cancelled' event; ended normally: ${ended}, sent: ${sent}`));
    for (const order of ORDERS[call.request.userId] ?? []) {
      if (call.cancelled) return;          // stop doing work nobody will read
      await sleep(call.request.delayMs);
      if (call.cancelled) return;
      call.write(order); sent++;
    }
    ended = true;
    call.end();
  },
});

const PORT = process.env.PORT ?? 7720;
server.bindAsync(`127.0.0.1:${PORT}`, grpc.ServerCredentials.createInsecure(), (err, port) => {
  if (err) throw err;
  console.log('[server] gRPC listening on', port);
});
process.on('SIGTERM', () => server.tryShutdown(() => process.exit(0)));
```

javascript

```
// client.js — unary call, NOT_FOUND, server stream, and a deadline that expires
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const def = protoLoader.loadSync(new URL('./users.proto', import.meta.url).pathname,
  { keepCase: false, longs: Number, defaults: true });
const { users } = grpc.loadPackageDefinition(def);
const client = new users.v1.UserService(`127.0.0.1:${process.env.PORT ?? 7720}`,
  grpc.credentials.createInsecure());

const deadline = (ms) => ({ deadline: new Date(Date.now() + ms) });
const getUser = (id) => new Promise((resolve, reject) =>
  client.GetUser({ id }, deadline(1000), (err, res) => (err ? reject(err) : resolve(res))));

// 1. unary
console.log('GetUser 1 ->', await getUser('1'));

// 2. a real error status
try { await getUser('42'); } catch (err) {
  console.log('GetUser 42 ->', grpc.status[err.code], `(code ${err.code}):`, err.details);
}

// 3. server streaming: the stream is an async iterable of messages
const stream = client.ListOrders({ userId: '1', delayMs: 50 }, deadline(2000));
for await (const order of stream) console.log('stream ->', order);
console.log('stream ended');

// 4. same stream, 150 ms per message, 250 ms deadline
const slow = client.ListOrders({ userId: '1', delayMs: 150 }, deadline(250));
try {
  for await (const order of slow) console.log('slow stream ->', order);
} catch (err) {
  console.log('slow stream ->', grpc.status[err.code], `(code ${err.code}):`, err.details);
}
client.close();

// Real output (Node v24.19.0, @grpc/grpc-js 1.14.6, @grpc/proto-loader 0.8.1), server started first:
//   GetUser 1 -> { id: '1', name: 'Ada' }
//   GetUser 42 -> NOT_FOUND (code 5): user 42 not found
//   stream -> { id: 'o-1', totalCents: 999 }
//   stream -> { id: 'o-2', totalCents: 2500 }
//   stream -> { id: 'o-3', totalCents: 120 }
//   stream ended
//   slow stream -> { id: 'o-1', totalCents: 999 }
//   slow stream -> DEADLINE_EXCEEDED (code 4): Deadline exceeded after 0.250s,remote_addr=127.0.0.1:7720
```

Server log from the same run:

text

```
[server] gRPC listening on 7720
[server] 'cancelled' event; ended normally: true, sent: 3
[server] 'cancelled' event; ended normally: false, sent: 1
```

The `DEADLINE_EXCEEDED` details string differs from run to run: the timings change, and a re-run added an `LB pick: 0.001s` entry. The second stream sent one order (at 150 ms). The 250 ms deadline then fired before the second order was due at 300 ms, and the server saw `call.cancelled` and stopped. In grpc-js 1.14.6 the server-side `'cancelled'` event also fires after a call that ended normally (first log line, `ended normally: true`). The library's `sendStatus` calls the cancel notifier on every finished call. So do not treat that event alone as "the client gave up". Deadlines are not passed on to the calls a server makes by itself. In grpc-js, pass `{ deadline: call.getDeadline() }` on the outgoing call yourself.

### API gateway and BFF

An **API gateway** is one public entry point in front of many services. It routes by path and does the cross-cutting work once: authentication, request ids, timeouts, rate limits. Without one, every client has to know every service's address, and every service has to do its own authentication. A **BFF** (backend for frontend) is a gateway endpoint shaped for one client screen. It calls several services in parallel and returns only what that screen needs. Without one, the mobile app makes N round trips and stitches the results together itself.

How it works:

1. The gateway checks the request (here a fixed bearer token) and attaches an `x-request-id`, reusing the caller's if it sent one. It sends that id to every service, so their logs can be joined (see [lesson 90 — Logging](90-logging.md)).
2. **Forwarding**: `app.use(prefix, …)` strips the prefix from `req.url`. The gateway rebuilds the target URL and streams the request body through `fetch` (with `duplex: 'half'`). It copies status and content type back to the caller. `AbortSignal.timeout(1000)` bounds each upstream call (see [lesson 22 — AbortController and AbortSignal](22-abortcontroller-and-abortsignal.md) and [lesson 44 — Outbound HTTP](44-outbound-http-fetch-undici-and-http-request.md)).
3. **BFF**: `Promise.all` over the two services, then a small response shaped for the screen.
4. Errors: an upstream timeout rejects with a `TimeoutError`. Express 5 forwards the rejection to the error handler, which answers `504`. Any other fetch failure gets `502`.

**Example — two services and an Express 5 gateway with forwarding and one BFF route.**

javascript

```
// services.js — two tiny backend services on their own ports
import express from 'express';

const users = express();
users.get('/users/:id', (req, res) => {
  console.log(`[users]  ${req.method} ${req.url} x-request-id=${req.get('x-request-id')}`);
  if (req.params.id !== '1') return res.status(404).json({ error: 'no such user' });
  res.json({ id: '1', name: 'Ada' });
});
users.listen(7731);

const orders = express();
orders.use(express.json());
const ORDERS = [{ id: 'o-1', userId: '1', totalCents: 999 }];
orders.get('/orders', (req, res) => {
  console.log(`[orders] ${req.method} ${req.url} x-request-id=${req.get('x-request-id')}`);
  res.json(ORDERS.filter((o) => o.userId === req.query.userId));
});
orders.post('/orders', (req, res) => {
  console.log(`[orders] ${req.method} ${req.url} body=${JSON.stringify(req.body)}`);
  const order = { id: `o-${ORDERS.length + 1}`, ...req.body };
  ORDERS.push(order);
  res.status(201).json(order);
});
orders.get('/slow', async (_req, res) => { await new Promise((r) => setTimeout(r, 2000)); res.json({ late: true }); });
orders.listen(7732, () => console.log('users on 7731, orders on 7732'));
```

javascript

```
// gateway.js — one public entry point (Express 5) in front of two services
import express from 'express';
import { randomUUID } from 'node:crypto';

const ROUTES = { '/api/users': 'http://127.0.0.1:7731/users', '/api/orders': 'http://127.0.0.1:7732/orders' };
const app = express();

// cross-cutting concerns live here once, not in every service
app.use((req, res, next) => {
  req.id = req.get('x-request-id') ?? randomUUID();
  res.set('x-request-id', req.id);
  if (req.get('authorization') !== 'Bearer demo') return res.status(401).json({ error: 'unauthorized' });
  next();
});

// 1. API gateway: forward by path prefix (no body parsing, the body is streamed through)
async function forward(req, res, base) {
  // req.url is the part after the mount path: '/1', '/?userId=1' or '/'
  const target = base + req.url.replace(/^\/(?=\?|$)/, '');
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const upstream = await fetch(target, {
    method: req.method,
    headers: { 'content-type': req.get('content-type') ?? '', 'x-request-id': req.id },
    body: hasBody ? req : undefined,
    duplex: 'half',                                      // required by fetch when the body is a stream
    signal: AbortSignal.timeout(1000),                   // never wait forever on a service
  });
  res.status(upstream.status).type(upstream.headers.get('content-type') ?? 'application/json');
  res.send(Buffer.from(await upstream.arrayBuffer()));
}
for (const [prefix, base] of Object.entries(ROUTES)) {
  app.use(prefix, (req, res) => forward(req, res, base));   // Express 5 forwards a rejection to the error handler
}
app.use('/api/slow', (req, res) => forward(req, res, 'http://127.0.0.1:7732/slow'));

// 2. BFF: one endpoint shaped for one screen, fanning out to both services in parallel
app.get('/bff/home/:userId', async (req, res) => {
  const opts = { headers: { 'x-request-id': req.id }, signal: AbortSignal.timeout(1000) };
  const [user, orders] = await Promise.all([
    fetch(`http://127.0.0.1:7731/users/${req.params.userId}`, opts).then((r) => (r.ok ? r.json() : null)),
    fetch(`http://127.0.0.1:7732/orders?userId=${req.params.userId}`, opts).then((r) => r.json()),
  ]);
  if (!user) return res.status(404).json({ error: 'no such user' });
  res.json({ greeting: `Hi ${user.name}`, orderCount: orders.length,
    totalCents: orders.reduce((s, o) => s + o.totalCents, 0) });
});

app.use((err, req, res, _next) => {
  const timeout = err.name === 'TimeoutError';
  res.status(timeout ? 504 : 502).json({ error: timeout ? 'upstream timeout' : 'bad gateway', requestId: req.id });
});
app.listen(7730, () => console.log('gateway on 7730'));
```

bash

```
$ node services.js & node gateway.js &
$ curl -s -i localhost:7730/api/users/1 -H 'authorization: Bearer demo' -H 'x-request-id: req-1' | grep -iE '^(HTTP|x-request-id)|^\{'
HTTP/1.1 200 OK
x-request-id: req-1
{"id":"1","name":"Ada"}
$ curl -s localhost:7730/api/users/2 -H 'authorization: Bearer demo' -w ' %{http_code}\n'
{"error":"no such user"} 404
$ curl -s localhost:7730/api/orders -H 'authorization: Bearer demo' -H 'content-type: application/json' -d '{"userId":"1","totalCents":1500}' -w ' %{http_code}\n'
{"id":"o-2","userId":"1","totalCents":1500} 201
$ curl -s 'localhost:7730/api/orders?userId=1' -H 'authorization: Bearer demo' -H 'x-request-id: req-2' -w ' %{http_code}\n'
[{"id":"o-1","userId":"1","totalCents":999},{"id":"o-2","userId":"1","totalCents":1500}] 200
$ curl -s localhost:7730/bff/home/1 -H 'authorization: Bearer demo' -H 'x-request-id: req-3' -w ' %{http_code}\n'
{"greeting":"Hi Ada","orderCount":2,"totalCents":2499} 200
$ curl -s localhost:7730/api/slow -H 'authorization: Bearer demo' -H 'x-request-id: req-4' -w ' %{http_code}\n'
{"error":"upstream timeout","requestId":"req-4"} 504
$ curl -s localhost:7730/api/users/1 -w ' %{http_code}\n'
{"error":"unauthorized"} 401
```

Services' log for the same run (the gateway generated the UUID for the request that sent none):

text

```
users on 7731, orders on 7732
[users]  GET /users/1 x-request-id=req-1
[users]  GET /users/2 x-request-id=2195c99d-1fc4-4c45-b7d8-e651b7f95248
[orders] POST /orders body={"userId":"1","totalCents":1500}
[orders] GET /orders?userId=1 x-request-id=req-2
[users]  GET /users/1 x-request-id=req-3
[orders] GET /orders?userId=1 x-request-id=req-3
```

The `/bff/home/1` request turned into two upstream calls carrying the same `x-request-id: req-3`. The client made one round trip. The `/api/slow` request got `504` after the gateway's 1 s timeout, even though the slow service would have answered at 2 s.

### Service discovery: DNS, Consul and Kubernetes Services

**Service discovery** answers the question "at which address and port is a healthy instance of service X right now?" Instances come and go as they scale, crash and redeploy, so the answer cannot be hard-coded. A hard-coded IP breaks on the next deploy. **DNS** is the oldest common interface for this. An A record gives addresses. An **SRV** record (`_service._proto.name`) gives a target host *and port*, plus a priority and a weight. RFC 2782 says to use the lowest priority first and to choose within it at random, in proportion to weight.

How it works:

1. `dns.lookup()` asks the operating system (getaddrinfo(3), which reads `/etc/hosts` and DNS according to `nsswitch.conf`). The Node docs note that it "runs on libuv's threadpool", so slow lookups can hold up `fs` and crypto work ([lesson 07](07-libuv-the-thread-pool.md)). `fetch`, `http.request` and `net.connect` use it by default.
2. `dns.resolveSrv()` and the other `resolve*()` functions always send a DNS query over the network. They do not read `/etc/hosts` and do not use the thread pool. A `dns.Resolver` instance with `setServers()` sends queries to a server you choose.
3. The client picks one record, connects to `name:port`, and resolves again when the TTL has passed. A cached answer can point at an instance that has since gone away.
4. **Consul** registers services through its agents and runs health checks. It answers DNS on port 8600 for `<service>.service.consul` (A and SRV). Its DNS page says: "Services that fail their health check or that fail a node system check are omitted from the results." So a plain DNS client only gets healthy instances. Consul also has an HTTP API for this.
5. **Kubernetes Services** give a stable name `my-svc.my-namespace.svc.cluster-domain.example`. That name resolves to a ClusterIP, or to Pod IPs for a headless Service. Kubernetes also creates SRV records `_port-name._port-protocol.my-svc.my-namespace.svc…` for named ports. Inside a cluster you normally just use the Service name and let kube-proxy or DNS do the rest. Lesson [109 — Kubernetes for Node developers](105-kubernetes-for-node-developers.md) covers Services, readiness probes and how traffic reaches Pods.

**Example — `dns.lookup`, then SRV and A queries against a local test DNS server.** No real resolver could be installed (no root, no Docker), so `fake-dns.js` is a small UDP server written only for this test. It answers SRV and A questions for `*.local` names and stands in for CoreDNS or Consul DNS. The client side (`discover.js`) is the part you would use for real.

javascript

```
// fake-dns.js — a test-only DNS server on UDP 127.0.0.1:7740 that answers
// SRV queries for _http._tcp.orders.local and A queries for its targets.
// (It stands in for CoreDNS / Consul DNS; it is not a real resolver.)
import dgram from 'node:dgram';

const SRV = { '_http._tcp.orders.local': [
  { priority: 10, weight: 60, port: 7751, target: 'orders-a.local' },
  { priority: 10, weight: 40, port: 7752, target: 'orders-b.local' },
  { priority: 20, weight: 0,  port: 7753, target: 'orders-backup.local' } ] };
const A = { 'orders-a.local': [127, 0, 0, 1], 'orders-b.local': [127, 0, 0, 1], 'orders-backup.local': [127, 0, 0, 1] };

const encodeName = (n) => Buffer.concat([...n.split('.').map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };

const sock = dgram.createSocket('udp4');
sock.on('message', (msg, rinfo) => {
  let i = 12; const labels = [];
  while (msg[i] !== 0) { labels.push(msg.subarray(i + 1, i + 1 + msg[i]).toString()); i += msg[i] + 1; }
  const name = labels.join('.').toLowerCase(), qtype = msg.readUInt16BE(i + 1);
  const question = msg.subarray(12, i + 5);
  const answers = qtype === 33 ? (SRV[name] ?? []).map((r) => {
    const rdata = Buffer.concat([u16(r.priority), u16(r.weight), u16(r.port), encodeName(r.target)]);
    return Buffer.concat([u16(0xc00c), u16(33), u16(1), u32(30), u16(rdata.length), rdata]);
  }) : qtype === 1 && A[name] ? [Buffer.concat([u16(0xc00c), u16(1), u16(1), u32(30), u16(4), Buffer.from(A[name])])] : [];
  const rcode = answers.length || SRV[name] || A[name] ? 0 : 3;          // 3 = NXDOMAIN
  const header = Buffer.concat([msg.subarray(0, 2), u16(0x8400 | rcode), u16(1), u16(answers.length), u16(0), u16(0)]);
  sock.send(Buffer.concat([header, question, ...answers]), rinfo.port, rinfo.address);
});
sock.bind(7740, '127.0.0.1', () => console.log('fake DNS on udp 127.0.0.1:7740'));
process.on('SIGTERM', () => sock.close());
```

javascript

```
// discover.js — find service instances by DNS, the way a client in a cluster would
import dns from 'node:dns/promises';

// 1. dns.lookup asks the OS (getaddrinfo(3): /etc/hosts and DNS, per nsswitch.conf) on the libuv thread pool
console.log('lookup localhost ->', await dns.lookup('localhost', { all: true }));

// 2. SRV records carry host AND port, plus priority/weight. Query a specific server
//    with a Resolver instance (resolve* always sends DNS queries; it never reads /etc/hosts).
const resolver = new dns.Resolver({ timeout: 1000, tries: 1 });
resolver.setServers(['127.0.0.1:7740']);
const records = await resolver.resolveSrv('_http._tcp.orders.local');
console.log('SRV ->', records);

// 3. Pick per RFC 2782: lowest priority first, then weighted-random within it
function pick(recs) {
  const best = Math.min(...recs.map((r) => r.priority));
  const group = recs.filter((r) => r.priority === best);
  let n = Math.random() * group.reduce((s, r) => s + r.weight, 0);
  return group.find((r) => (n -= r.weight) < 0) ?? group[0];
}
const counts = {};
for (let k = 0; k < 1000; k++) { const r = pick(records); counts[`${r.name}:${r.port}`] = (counts[`${r.name}:${r.port}`] ?? 0) + 1; }
console.log('1000 picks ->', counts);
console.log('A for orders-a.local ->', await resolver.resolve4('orders-a.local', { ttl: true }));

// 4. A name that does not exist
try { await resolver.resolveSrv('_http._tcp.nope.local'); }
catch (err) { console.log('missing service ->', err.code, err.message); }

// Real output (Node v24.19.0), fake-dns.js running:
//   lookup localhost -> [ { address: '127.0.0.1', family: 4 } ]
//   SRV -> [
//     {
//       name: 'orders-a.local',
//       port: 7751,
//       priority: 10,
//       weight: 60,
//       type: 'SRV'
//     },
//     {
//       name: 'orders-b.local',
//       port: 7752,
//       priority: 10,
//       weight: 40,
//       type: 'SRV'
//     },
//     {
//       name: 'orders-backup.local',
//       port: 7753,
//       priority: 20,
//       weight: 0,
//       type: 'SRV'
//     }
//   ]
//   1000 picks -> { 'orders-b.local:7752': 374, 'orders-a.local:7751': 626 }
//   A for orders-a.local -> [ { address: '127.0.0.1', ttl: 30 } ]
//   missing service -> ENOTFOUND querySrv ENOTFOUND _http._tcp.nope.local
```

The `1000 picks` counts change from run to run because the pick is random. They stay near the 60/40 weights, and the priority-20 backup is never chosen while priority-10 records exist. On v24.19.0 each SRV result also has `type: 'SRV'`, which the `dns.resolveSrv` docs do not list. Do not depend on it.

> ⚠️ Unverified: Consul and a Kubernetes cluster DNS (CoreDNS) were not run. Their behaviour above comes from the Consul DNS docs and the Kubernetes "DNS for Services and Pods" page. The SRV queries were sent to the test server above, not to a production resolver.

### Transactional outbox with PostgreSQL

A service that saves an order and then publishes `order.placed` to a broker is doing a **dual write**: two systems, no shared transaction. If the process dies after the `COMMIT` but before the publish, the event is lost and downstream services never hear about the order. If it publishes first and the `COMMIT` then fails, they hear about an order that does not exist. The **transactional outbox** removes the second system from the request. The order row and an `outbox` row go in the *same* local transaction, so either both exist or neither does. A separate **relay** later reads unsent outbox rows, publishes them, and marks them sent. The relay can crash between publishing and marking, so delivery is **at least once** and consumers must de-duplicate by event id.

How it works:

1. **Write**: `BEGIN`, `INSERT INTO orders …`, `INSERT INTO outbox (aggregate_id, event_type, payload) …`, `COMMIT`. A failure before `COMMIT` rolls back both.
2. **Claim**: the relay runs one short `UPDATE … WHERE id IN (SELECT … WHERE sent_at IS NULL AND (unclaimed OR lease expired) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT n) RETURNING …`. This is the claim step from [lesson 75's `SKIP LOCKED` appendix](75-transactions-amp-acid.md). Several relays can run, each taking different rows, and no transaction stays open while publishing.
3. **Publish** each claimed row to the broker (here a Redis stream via `XADD`). Use the outbox `id` as the event id.
4. **Mark sent** with `UPDATE outbox SET sent_at = now() WHERE id = $1 AND claimed_by = $me`. If the relay crashes before this, the row stays unsent. After the lease expires, another relay claims it and publishes it again, which produces a duplicate.
5. **Consume** with [lesson 114's idempotent consumer](114-message-queues-async-jobs.md): claim the event id in `processed_messages` (`processing`, with a lease), do the work, mark `done`, and release the claim if the work throws. Acknowledge the broker message (`XACK`) only after that. A duplicate finds `done` and is acknowledged without doing the work again.

```
 request ──► BEGIN; INSERT orders; INSERT outbox; COMMIT          (one local transaction)
                                         │
                                         ▼
 relay loop:  claim (UPDATE … FOR UPDATE SKIP LOCKED, lease) ──► XADD events ──► mark sent_at
                     ▲                                               │
                     │       crash here = row unsent, lease expires, │
                     └──────────── claimed and published again ◄─────┘
                                         │
                                         ▼  (at least once: duplicates possible)
 consumer:   XREADGROUP ──► claim event id (processing) ──► work ──► done ──► XACK
                                 └─ already done? skip the work, XACK
```

**Example — schema, write path, relay and consumer.** Run against PostgreSQL 18.4 and Redis 8.0.5. Install with `npm install pg ioredis`.

text

```
-- orders service: the business table and its outbox live in the SAME database
CREATE TABLE orders (
  id          BIGSERIAL PRIMARY KEY,
  customer    TEXT   NOT NULL,
  total_cents BIGINT NOT NULL
);

CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,               -- also the event id consumers dedupe on
  aggregate_id TEXT        NOT NULL,
  event_type   TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_by   TEXT,                                -- relay attempt that owns the row
  claimed_at   TIMESTAMPTZ,
  attempts     INT         NOT NULL DEFAULT 0,
  sent_at      TIMESTAMPTZ                          -- NULL until published
);
CREATE INDEX outbox_unsent ON outbox (id) WHERE sent_at IS NULL;

-- consumer side (in a real system: the notifications service's own database)
CREATE TABLE processed_messages (
  message_id TEXT PRIMARY KEY,
  status     TEXT NOT NULL CHECK (status IN ('processing', 'done')),
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE emails_sent (                          -- stands in for the real side effect
  id       BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL,
  body     TEXT NOT NULL
);
```

javascript

```
// place-order.js — write the order and its event in ONE transaction
// usage: node place-order.js <customer> <cents> [--fail-before-commit]
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function placeOrder(customer, totalCents, { failBeforeCommit = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [order] } = await client.query(
      'INSERT INTO orders (customer, total_cents) VALUES ($1, $2) RETURNING id',
      [customer, totalCents]);
    await client.query(
      `INSERT INTO outbox (aggregate_id, event_type, payload) VALUES ($1, 'order.placed', $2)`,
      [String(order.id), { orderId: order.id, customer, totalCents }]);
    if (failBeforeCommit) throw new Error('crash before COMMIT');
    await client.query('COMMIT');                     // both rows become visible together
    return order.id;
  } catch (err) {
    await client.query('ROLLBACK');                   // ...or neither does
    throw err;
  } finally {
    client.release();
  }
}

const [customer, cents, flag] = process.argv.slice(2);
try {
  const id = await placeOrder(customer, Number(cents), { failBeforeCommit: flag === '--fail-before-commit' });
  console.log(`placed order ${id} for ${customer}`);
} catch (err) {
  console.log(`order for ${customer} failed: ${err.message} -> rolled back`);
}
await pool.end();
```

javascript

```
// relay.js — move unsent outbox rows to the broker (a Redis stream), at least once.
// usage: node relay.js [--crash-after-publish]
import pg from 'pg';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);
const LEASE = process.env.LEASE ?? '30 seconds';   // longer than one publish batch may take
const me = randomUUID().slice(0, 8);
const crashAfterPublish = process.argv.includes('--crash-after-publish');

// 1. Claim a batch: one short statement, committed at once (lesson 75's claim step).
//    SKIP LOCKED lets several relays run without taking the same rows.
const CLAIM = `
  UPDATE outbox SET claimed_by = $1, claimed_at = now(), attempts = attempts + 1
  WHERE id IN (
    SELECT id FROM outbox
    WHERE sent_at IS NULL
      AND (claimed_at IS NULL OR claimed_at < now() - $2::interval)   -- unclaimed or lease expired
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT $3)
  RETURNING id, event_type, payload, attempts`;

async function relayOnce(batchSize = 10) {
  const { rows } = await pool.query(CLAIM, [me, LEASE, batchSize]);
  rows.sort((a, b) => Number(a.id) - Number(b.id));   // RETURNING order is not guaranteed
  console.log(`[relay ${me}] claimed ${rows.length} row(s)`);
  for (const row of rows) {
    // 2. Publish. The event id travels with the message so consumers can dedupe.
    const streamId = await redis.xadd('events', '*',
      'eventId', String(row.id), 'type', row.event_type, 'payload', JSON.stringify(row.payload));
    console.log(`[relay ${me}] published outbox ${row.id} (attempt ${row.attempts}) as ${streamId}`);

    if (crashAfterPublish) {
      console.log(`[relay ${me}] CRASH before marking ${row.id} sent`);
      process.exit(1);                                  // the row stays claimed, sent_at stays NULL
    }
    // 3. Mark sent, only if we still own the claim.
    const { rowCount } = await pool.query(
      'UPDATE outbox SET sent_at = now() WHERE id = $1 AND claimed_by = $2 AND sent_at IS NULL', [row.id, me]);
    if (rowCount === 0) console.log(`[relay ${me}] lost the claim on ${row.id}; another relay took over`);
  }
  return rows.length;
}

// Poll until the outbox is empty (a real relay would keep polling forever).
while (await relayOnce() > 0);
console.log(`[relay ${me}] nothing claimable; stopping`);
await pool.end();
redis.disconnect();
```

javascript

```
// consumer.js — read events from the stream; claim -> work -> done (lesson 114), then XACK.
import pg from 'pg';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);
const LEASE = '5 minutes';

async function handle(eventId, payload) {
  const claimId = randomUUID();
  // 1. Claim the event id (or take over a claim stuck past the lease).
  const claim = await pool.query(
    `INSERT INTO processed_messages (message_id, status, claimed_by) VALUES ($1, 'processing', $2)
     ON CONFLICT (message_id) DO UPDATE SET claimed_by = $2, claimed_at = now()
       WHERE processed_messages.status = 'processing'
         AND processed_messages.claimed_at < now() - $3::interval
     RETURNING message_id`, [eventId, claimId, LEASE]);
  if (claim.rowCount === 0) {
    const { rows } = await pool.query('SELECT status FROM processed_messages WHERE message_id = $1', [eventId]);
    if (rows[0]?.status === 'done') return 'duplicate, skipped';
    throw new Error(`event ${eventId} is claimed by another worker; retry later`);
  }
  // 2. Work. On failure release the claim so a retry can run.
  try {
    await pool.query('INSERT INTO emails_sent (event_id, body) VALUES ($1, $2)',
      [eventId, `Thanks ${payload.customer}, order ${payload.orderId} received`]);
  } catch (err) {
    await pool.query(`DELETE FROM processed_messages WHERE message_id = $1 AND claimed_by = $2 AND status = 'processing'`,
      [eventId, claimId]);
    throw err;
  }
  // 3. Done.
  await pool.query(`UPDATE processed_messages SET status = 'done' WHERE message_id = $1 AND claimed_by = $2`,
    [eventId, claimId]);
  return 'emailed';
}

await redis.xgroup('CREATE', 'events', 'notifications', '0', 'MKSTREAM').catch(() => {}); // BUSYGROUP if it exists
for (;;) {
  const res = await redis.xreadgroup('GROUP', 'notifications', 'c1', 'COUNT', 10, 'BLOCK', 1000,
    'STREAMS', 'events', '>');
  if (!res) break;                                       // idle for 1 s: stop (demo only)
  for (const [, entries] of res) {
    for (const [streamId, fields] of entries) {
      const f = {};                                      // fields arrive as [k1, v1, k2, v2, ...]
      for (let i = 0; i < fields.length; i += 2) f[fields[i]] = fields[i + 1];
      const outcome = await handle(f.eventId, JSON.parse(f.payload));
      await redis.xack('events', 'notifications', streamId);   // ack only after the handler returned
      console.log(`[consumer] ${streamId} event ${f.eventId}: ${outcome}`);
    }
  }
}
await pool.end();
redis.disconnect();
```

The demo also uses two small helpers: `setup.js` drops and recreates the tables from `schema.sql` and deletes the `events` stream, and `show.js "<sql>"` prints one query's rows with `console.table`. The run is in the edge case below.

### Common mistakes & gotchas (additional topics)

- **gRPC calls without a deadline.** By default there is none. A hung server holds the caller's call open forever. Set `{ deadline }` on every call and pass the remaining time on to downstream calls.
- **Reading the server's `'cancelled'` event as "client gave up".** In grpc-js 1.14.6 it also fires after a normal `end()`. Check `call.cancelled` *before* doing more work, and track whether you finished.
- **`int64` fields arriving as `Long` objects.** That is proto-loader's default. Choose `longs: Number` (safe below 2^53) or `longs: String` on purpose.
- **Gateway routes with `app.get('/api/x', …)` that forward `req.url`.** Only `app.use()` strips the mount path. With `app.get`, `req.url` is still `/api/x`, and the first version of this gateway forwarded `/slow/api/slow` and got a 404.
- **A gateway without timeouts.** One slow service then ties up gateway sockets and memory for every request routed to it. Bound every upstream call and return `504`.
- **Caching DNS answers forever.** Respect the TTL (`resolve4(name, { ttl: true })` returns it). Remember that `dns.lookup()` uses the thread pool and does not expose TTLs.
- **Publishing inside the database transaction.** If the broker is slow, the transaction stays open. If the `COMMIT` then fails, the event is already out. The outbox exists so the request path never talks to the broker.
- **Claiming a big batch per relay.** When a relay crashes, every row it claimed waits for the lease, not just the one it was publishing. Keep batches small and leases short, but longer than one batch takes to publish.
- **Assuming the outbox keeps global order.** Rows are claimed in `id` order, but several relays, retries and lease takeovers can publish them out of order. If a consumer needs per-entity order, partition by `aggregate_id` or check a version number.
- **Forgetting broker-side redelivery.** With Redis Streams consumer groups, a message read but never `XACK`ed stays in the pending list and must be reclaimed (`XAUTOCLAIM`). The consumer's dedupe covers that duplicate too.

### Edge case worked through: the relay crashes between publish and mark-sent

`run.sh` places two orders, fails a third before `COMMIT`, then runs the relay three times. The first run crashes right after its first publish. The second runs inside the 2-second lease. The third runs after the lease has expired. Last, the consumer reads the stream.

bash

```
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7760/app REDIS_URL=redis://127.0.0.1:7761 LEASE='2 seconds'
node setup.js
node place-order.js alice 1500
node place-order.js bob 990
node place-order.js carol 700 --fail-before-commit
node show.js "SELECT (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM outbox) AS outbox_rows"
node relay.js --crash-after-publish; echo "relay exit code: $?"
node relay.js                                  # row 1 is still claimed: its lease has not expired
sleep 2.5
node relay.js                                  # lease expired: row 1 is published a second time
node show.js "SELECT id, attempts, sent_at IS NOT NULL AS sent FROM outbox ORDER BY id"
node consumer.js
node show.js "SELECT event_id, count(*) AS emails FROM emails_sent GROUP BY event_id ORDER BY event_id"
node show.js "SELECT message_id, status FROM processed_messages ORDER BY message_id"
```

bash

```
$ bash run.sh
schema created, stream cleared
placed order 1 for alice
placed order 2 for bob
order for carol failed: crash before COMMIT -> rolled back
┌─────────┬────────┬─────────────┐
│ (index) │ orders │ outbox_rows │
├─────────┼────────┼─────────────┤
│ 0       │ '2'    │ '2'         │
└─────────┴────────┴─────────────┘
[relay 1266b782] claimed 2 row(s)
[relay 1266b782] published outbox 1 (attempt 1) as 1791826922662-0
[relay 1266b782] CRASH before marking 1 sent
relay exit code: 1
[relay 6900c272] claimed 0 row(s)
[relay 6900c272] nothing claimable; stopping
[relay 79fcd208] claimed 2 row(s)
[relay 79fcd208] published outbox 1 (attempt 2) as 1791826925487-0
[relay 79fcd208] published outbox 2 (attempt 2) as 1791826925489-0
[relay 79fcd208] claimed 0 row(s)
[relay 79fcd208] nothing claimable; stopping
┌─────────┬─────┬──────────┬──────┐
│ (index) │ id  │ attempts │ sent │
├─────────┼─────┼──────────┼──────┤
│ 0       │ '1' │ 2        │ true │
│ 1       │ '2' │ 2        │ true │
└─────────┴─────┴──────────┴──────┘
[consumer] 1791826922662-0 event 1: emailed
[consumer] 1791826925487-0 event 1: duplicate, skipped
[consumer] 1791826925489-0 event 2: emailed
┌─────────┬──────────┬────────┐
│ (index) │ event_id │ emails │
├─────────┼──────────┼────────┤
│ 0       │ '1'      │ '1'    │
│ 1       │ '2'      │ '1'    │
└─────────┴──────────┴────────┘
┌─────────┬────────────┬────────┐
│ (index) │ message_id │ status │
├─────────┼────────────┼────────┤
│ 0       │ '1'        │ 'done' │
│ 1       │ '2'        │ 'done' │
└─────────┴────────────┴────────┘
```

Relay ids and stream ids are random or time-based, so they differ on each run. The sequence of events was the same in all three runs.

What happened, step by step:

1. Carol's order rolled back together with its outbox row: 2 orders and 2 outbox rows, never an event without an order.
2. The first relay claimed **both** rows (batch of 10), published outbox 1, and exited with code 1 before setting `sent_at`.
3. The second relay claimed nothing. Both rows were still inside the crashed relay's lease, including row 2, which had never been published.
4. After the lease expired, the third relay claimed both rows again (`attempt 2`) and published outbox 1 a **second time**. The stream now holds three messages for two events.
5. The consumer processed event 1, then found event 1 already `done` and skipped it, then processed event 2. One email per order, both claims `done`.

The duplicate is the price of not losing events. Removing it on the relay side would need the publish and the `sent_at` update to be atomic, and with a separate broker they are not. The dedupe has to happen where the side effect happens.

### ⭐ Interview lens (additional topics)

> **Q: “Why not just publish the event right after committing the order?”**  
> A: That is a dual write. A crash between the commit and the publish loses the event, and publishing first can announce an order that then fails to commit. The outbox writes the event row in the same transaction as the order. A relay publishes it later, at least once: claim with `FOR UPDATE SKIP LOCKED` and a lease, publish, mark sent. A crash before the mark republishes after the lease, so consumers de-duplicate on the event id (claim → work → done). *Trap:* calling it exactly-once. It is at-least-once plus idempotent consumers.

> **Q: “When would you pick gRPC over REST/JSON between services, and what must every gRPC call have?”**  
> A: For internal service-to-service calls where a shared `.proto` contract, binary encoding over HTTP/2, and streaming (server, client or bidirectional) help. Browsers and public APIs usually stay on REST or GraphQL. Every call needs a deadline, because gRPC sets none by default. Handlers should check cancellation and return proper status codes (`NOT_FOUND`, `INVALID_ARGUMENT`) instead of a generic error.
