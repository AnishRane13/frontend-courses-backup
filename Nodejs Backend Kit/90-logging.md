---
title: "Logging"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/logging
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Logging

*11 min read · Updated 24 Jul 2026 Topic 56 of 70 Bookmark Mark done Why it matters Logs are the primary way you understand a running system that you cannot attach a debugger to · Topic 56 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/logging](https://www.geekyfrontend.in/learn/nodejs-backend-kit/logging)

---

## Say it in 30 seconds

Structured logging writes each event as a JSON object with named fields and a severity level, instead of a free-form sentence. You can then search one user's request across millions of lines when you cannot attach a debugger. The trade-off is that logs are a data store too: they have to stay cheap on the request path, and they must never contain passwords, tokens, or personal data.

## Why it matters

In production you almost never attach a debugger. When a customer says the payment failed at 2:14, you search the record the process left. Structured logs make that a short query. Unstructured logs, missing a request id, full of noise, or holding secrets, make it an afternoon, or a ticket you cannot answer. What you refuse to log is part of the design. Passwords, tokens, full card numbers, and personal data in a log are a security incident.

## The concept, simply

**Structured logging** means each line is machine-readable data, almost always one JSON object, not an English sentence. Instead of "user 42 bought kit 7", you emit level, message, userId, kitId, and requestId as fields. A log platform can index those fields and answer "user 42 and level error" across a huge volume. Free text can only be grepped. It does not aggregate into a dashboard or an alert.

**Log levels** rank severity. The usual ladder is trace, debug, info, warn, error, and fatal. You set a threshold, often info in production and debug while you investigate, and anything below it is dropped. You change verbosity without editing call sites.

![A pyramid of log levels from trace at the noisy base up to fatal at the severe top, with info as the production default](assets/i53_01_fe68c416.svg)

One threshold controls verbosity. Production usually sits at info. Drop to debug or trace only while you are investigating.

A **correlation id**, also called a request id or a trace id, is a unique token on every log line produced while handling one request, and it is passed to every service that request touches. Filter the aggregator on that id and you see one user's action in order, instead of thousands of interleaved lines.

![A request carrying one id through gateway, auth and orders services, all logging that id so a log aggregator can filter one request end to end](assets/i53_02_6cd24834.svg)

One id threads the request across services. Filtering on it rebuilds the journey.

## How it works

In Node the two common structured loggers are **pino** and **winston**. Pino is built to be fast. It writes JSON with little work on your thread, and it can push formatting and shipping to a separate transport process so the request path is not blocked on log I/O. That matters because logging sits on the hot path, and Node has one thread for your JavaScript. A slow synchronous logger caps throughput. Winston has more transports and custom formats, and it does more of that work inline. Both emit JSON, both have levels, and both attach fields.

The ergonomic way to attach the id is a **child logger** plus **AsyncLocalStorage**. At the start of a request you read an incoming `x-request-id` header or mint a UUID, then `req.log = log.child({ requestId })`. Every line from that child includes the id. You do not pass it by hand. `AsyncLocalStorage` from `node:async_hooks` keeps a per-request store alive across every await and callback in that chain, so code deep in a service, with no access to `req`, can still read the current id. That replaces threading a context argument through every function.

Levels are numbers. In pino, trace is 10 and fatal is 60. A call below the threshold is dropped before serialization, so a disabled level is cheap, as long as you did not do expensive work to build the object before the call. Pass an object and let the logger serialize it.

Where the bytes go: the twelve-factor rule, which containers and cloud deploys follow, is that the app writes logs to **stdout and stderr** and the platform captures them. Docker, Kubernetes, or systemd ships them to an aggregator. The app does not manage files, rotation, or shipping. That keeps the process stateless.

## Code examples

A pino logger and a per-request child bound to a correlation id.

javascript

```
import pino from 'pino';
import { randomUUID } from 'node:crypto';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Redact secrets so they never reach disk (see below).
  redact: ['req.headers.authorization', '*.password', '*.token'],
});

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  req.log = log.child({ requestId, method: req.method, path: req.path });
  res.setHeader('x-request-id', requestId); // echo it back to the client
  req.log.info('request started');
  res.on('finish', () => req.log.info({ status: res.statusCode }, 'request done'));
  next();
});

// Deep in a handler — every line carries requestId automatically:
// req.log.warn({ retries: 2 }, 'payment gateway slow');
```


AsyncLocalStorage so code that never sees `req` can still log the id.

javascript

```
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] ?? randomUUID();
  // Everything downstream in this request's async chain shares this store.
  als.run({ requestId }, () => next());
});

// A logger that auto-injects the ambient requestId — no plumbing needed.
function ctxLog(level, obj, msg) {
  const store = als.getStore();
  log[level]({ ...obj, requestId: store?.requestId }, msg);
}

// Called from any service layer, across awaits, with zero context passed in:
async function chargeCard(amount) {
  ctxLog('info', { amount }, 'charging card'); // still tagged with requestId
}
```


Use the levels on purpose, and pass the Error object so the stack stays a field.

javascript

```
req.log.debug({ query }, 'running db query');      // dev detail, off in prod
req.log.info({ userId }, 'user logged in');          // normal milestone
req.log.warn({ latencyMs: 1400 }, 'slow upstream');  // suspicious, recovered

try {
  await charge(order);
} catch (err) {
  // Pass the Error under a key the logger serialises specially (err/stack).
  req.log.error({ err, orderId: order.id }, 'charge failed');
  // ❌ Don't do: req.log.error('charge failed: ' + err) — loses the stack
  //    and turns structured data into an un-queryable string.
}
```


Redaction is the difference between a log line and a data breach. Secrets and personal data never reach the sink.

javascript

```
const log = pino({
  redact: {
    paths: [
      'password', '*.password',
      'req.headers.authorization',
      'req.headers.cookie',
      'creditCard', 'ssn', 'user.email',
    ],
    censor: '[REDACTED]',
  },
});

// Even if a handler naively logs the whole request body, the sensitive
// fields are replaced before serialisation:
log.info({ password: 'hunter2', user: { email: 'a@b.com' } }, 'signup');
// => {"level":30,...,"password":"[REDACTED]","user":{"email":"[REDACTED]"}}
```


## Common mistakes & gotchas

- **Logging secrets or personal data.** Passwords, tokens, session cookies, full card numbers, emails. Redact in the logger so one careless call cannot leak them.
- **String concatenation.** `user 42 did checkout` cannot be queried by field. Emit an object.
- **Stringifying errors.** `failed: ` plus the error drops the stack. Pass the Error under an `err` key.
- **One level for everything.** All info is unreadable and expensive. Nothing until error leaves you blind.
- **Synchronous logging on the hot path.** A blocking logger throttles requests. Use a transport-based logger, and do not pretty-print in production.
- **Log files inside the app.** That couples you to the host. Write stdout and let the platform ship and rotate.
- **No correlation id.** You cannot pull one request out of interleaved lines across services.
- **Logging inside tight loops.** You bury the signal and pay for it. Log decisions and boundaries.

## Best practices

- **JSON logs** with a fast logger such as pino, so lines are queryable.
- **Levels on purpose.** info for milestones, warn for recoverable oddities, error for failed operations, fatal before the process dies. Production threshold at info. Lower it to debug only while investigating.
- **A correlation id on every request,** via a child logger, forwarded in headers and inside the process with AsyncLocalStorage.
- **Log Error objects, not strings,** so the stack survives as fields.
- **Redact at the logger,** with an explicit list. Do not rely on every call site to remember.
- **Write stdout and stderr.** Let the platform route, rotate, and ship. Keep the app stateless.
- **Useful context on each line:** user id, route, status, duration. Log events, not every statement.
- **One shared logger config** across services so fields, levels, and redaction match and dashboards work everywhere.

## ⭐ Interview lens

> **Q: "What is structured logging and why prefer it over `console.log`?"**  
> A: Structured logging means each entry is data, usually one JSON object with named fields, instead of a sentence you hope to grep. A platform can index userId, level, route, and requestId and answer a question across a huge volume, and it can graph and alert on those fields. `console.log` is a free-form string, it has no levels, and it writes synchronously on the thread that is serving the request. That is fine for a script. It is the wrong tool for a service, because you cannot ask "errors for user 42 in the last hour" without scanning text. For example, `{ level: 'info', msg: 'purchase', userId: 42, kitId: 7, requestId }` is a query. The sentence "user 42 bought kit 7" is not. The limit is that JSON is not automatically safe. The same structure that makes userId searchable will index a password if you put one in the object. Redaction belongs in the logger, not in your memory.

> **Q: "What is a correlation id and how do you propagate it in Node?"**  
> A: A correlation id is a unique token for one request, copied onto every log line that request produces, and forwarded to every service it calls. You can then filter the aggregator and see gateway, auth, and orders in order, instead of a mix of everyone else's lines. In Node you read `x-request-id` or mint a UUID at the edge, bind a child logger with `log.child({ requestId })`, and send the same header downstream. Inside one process, AsyncLocalStorage keeps that id available across awaits, so a repository that never received `req` can still log it. For example, a payment failure at 2:14 becomes a search for one id, and you see the order write, the charge call, and the error with its stack. The limit is propagation. If one service forgets the header, the trail breaks at that hop, and a child logger created before you knew the id will not grow the field later.

> **Q (trap): "Should you log the request body so you can debug issues?"**  
> A: Not the whole body. Request bodies regularly contain passwords, tokens, card numbers, and personal data, and a log store is a copy of that data with weaker access control than the database. The default is deny. Redact at the logger, with a list of paths, so the field is censored before it is serialized, and log only the specific safe fields you need to debug, such as an order id or a status code. For example, logging `req.body` on a login route writes the password into every aggregator you ship logs to, and deleting it later does not remove copies. The limit of a redact list is that it only catches names you listed. A new field called `card` or a nested token still leaks until the list is updated, which is why "log the body and redact password" is weaker than "log these four fields".

> **Q: "Why is pino considered fast, and why does logger speed matter?"**  
> A: Pass the Error object as a field, for example `log.error({ err }, 'charge failed')`. Loggers like pino have a serializer that records name, message, and the full stack as structured fields you can read later. Concatenating the error into a string collapses it. You often get the message and lose the stack, or you get a useless conversion, and the line is no longer a set of fields. For example, a charge failure logged as an object shows the stack frame in your own file. The same failure logged as "failed: " plus the error shows a sentence and you start guessing. The limit is that the serializer only helps if you pass the Error itself. A hand-built `{ message: err.message }` drops the stack on purpose. Also do not log the request that caused it if that request holds a secret. The stack is useful. The password next to it is not.

## Cheat-card

- **Structured JSON** is queryable by field. Free text is only greppable.
- **Levels:** trace and debug while investigating, info as the production default, then warn, error, and fatal.
- **pino** is fast and can offload work to a transport. **winston** is more flexible and heavier inline.
- **Correlation id:** child logger, `x-request-id`, and AsyncLocalStorage.
- **Log Error objects** under an `err` key so the stack is kept.
- **Never log** passwords, tokens, cookies, card numbers, or personal data. Redact in the logger.
- **Write stdout.** Let the platform ship and rotate.

## Good to know

- **Why is pino considered fast, and why does that matter?** Logging is on the request path and Node runs your JavaScript on one thread, so a slow synchronous logger caps throughput. Pino serializes straight to JSON and can move formatting and shipping to another process, and it checks the level before serializing, so a disabled call is cheap.
- **Where should a containerized Node app send logs?** To stdout and stderr, and let Docker, Kubernetes, or systemd ship them to an aggregator. The app should not own files, rotation, or shipping, or it stops being stateless.

---

## Learn More

- [Pino — Super fast, all natural JSON logger for Node.js getpino.io](https://getpino.io/)
- [winston — A logger for just about everything github.com](https://github.com/winstonjs/winston)
- [The BEST Way to Log in Node.js - Winston Better Stack](https://www.youtube.com/watch?v=He7Dc6DuxdI)
- [Node.js Logging Like a Pro: Centralized Logs Using Pino Transport, Loki & Grafana Code with Jay](https://www.youtube.com/watch?v=d1VRuGpJd10)
