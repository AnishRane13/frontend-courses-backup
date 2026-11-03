---
title: "The req and res objects: reading and responding"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/req-res
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# The req and res objects: reading and responding

*9 min read · Updated 24 Jul 2026 Topic 38 of 70 Bookmark Mark done Why it matters Every Express handler you will ever write does two things · Topic 38 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/req-res](https://www.geekyfrontend.in/learn/nodejs-backend-kit/req-res)

---

## Say it in 30 seconds

req is everything the client sent, and res is how you send one reply back. Express fills the path parameters and the query string for you, and it leaves the body unread until you add a parser such as the JSON parser. You answer with helpers that set the status and send JSON, which also set the headers and end the response. These objects exist so you stop repeating that plumbing. The trade-off is that you still get exactly one response per request, and a body you did not parse stays undefined.

## Why it matters

Every handler does two things. It reads the request, and it writes a response. `req` and `res` are the interface for both. Interviewers use them as a fast check: where the body comes from, how you send a 201 with JSON, and what `res.json()` does that `res.send()` does not.

Under the helpers, these are Node's own `IncomingMessage` and `ServerResponse` with extra methods. What you know about Node HTTP still applies. This lesson maps the read side, which is params, query, body, and headers, and the write side, which is status, json, send, redirect, and headers. The bugs are the string types, the one-response rule, and forgetting to parse the body.

## The concept, simply

`req` is the request, everything the client sent. It has four inputs. `req.params` holds path parameters, so `/users/:id` gives `req.params.id`. `req.query` holds the parsed query string, so `?page=2` gives `req.query.page`. `req.body` holds the parsed body, such as JSON a client POSTs, but only if a body-parsing middleware ran first. `req.headers`, and the helper `req.get('Header-Name')`, hold the headers. You also get `req.method`, `req.path`, `req.originalUrl`, `req.ip`, and `req.cookies` if a cookie parser ran.

`res` is the response, everything you send back. `res.status(code)` sets the status and returns `res` so you can chain. `res.json(obj)` serializes the value and sets `Content-Type: application/json`. `res.send(body)` sends a string, a Buffer, or an object, and it guesses the type. `res.redirect(url)` sends a redirect. `res.set()` sets a header. `res.cookie()` sets a cookie. `res.status(204).end()` ends a response with no body. The rule is one response per request.

![Two panels one labelled req incoming listing params query body and headers the other labelled res outgoing listing status json send and redirect](assets/i35_01_be4c0901.svg)

`req` is the read side. `res` is the write side. One response per request.

Body parsing is not automatic. A JSON POST arrives as a stream of bytes. Express does not put that on `req.body` unless you registered `express.json()` for JSON, or `express.urlencoded()` for HTML form bodies, earlier in the pipeline. Without that, `req.body` is `undefined`. Params and query are parsed for you. The body is opt-in because the strategy depends on the content type.

## How it works

`req` and `res` are the objects Node's HTTP server creates, `http.IncomingMessage` and `http.ServerResponse`, with Express methods mixed in. `res.json()` ends up calling `res.end()`. `req.headers` is Node's header map. You can still use `res.setHeader()`, `res.writeHead()`, and `res.end()`. The helpers remove repeated steps. They do not hide the machine.

A body parser is middleware. It reads the request stream to the end, decodes it according to `Content-Type`, assigns the result to `req.body`, and then calls `next()`. `express.json()` acts only when `Content-Type` is `application/json`. `express.urlencoded()` handles `application/x-www-form-urlencoded`. If the type does not match, or the request has no body, the parser passes through. On Express 5, `req.body` stays `undefined` in that case. Express 4's parsers set it to `{}`. With no parser registered it is `undefined` on both. Do not destructure `req.body` without a fallback. `const { email } = req.body` throws `TypeError: Cannot destructure property 'email' of 'req.body' as it is undefined` on a POST with no JSON body. Use `req.body ?? {}`, or validate first. Both parsers take a `limit` so one huge body cannot exhaust memory. File uploads, which are `multipart/form-data`, need a library such as multer, not these parsers.

On the way out, `res.json(value)` runs `JSON.stringify`, sets `Content-Type` to `application/json`, and sends the body. `res.send(value)` infers the type. A string goes out as HTML or text, a Buffer as binary, and an object or array is handed to `res.json`. For a JSON API, call `res.json()` so the intent is obvious. `res.status(code)` only sets the status and returns `res`. It does not send. You chain it: `res.status(201).json(...)`. `res.redirect(url)` defaults to 302 and sets `Location`. Pass a status first for a permanent redirect: `res.redirect(301, url)`.

An HTTP response can be sent only once. `res.json`, `res.send`, `res.redirect`, and `res.end` finish it. A second call, or a call after the headers were flushed, throws `ERR_HTTP_HEADERS_SENT`, "Cannot set headers after they are sent". That is why you `return` after responding, and why a handler that responded must not also call `next()` into code that responds again. Values in `req.params` and `req.query` are always strings. `req.body` is whatever the client sent. Do not trust it without validation.

## Code examples

**1. Reading all four request inputs in one handler.**

javascript

```
// POST /users/42/notes?draft=true  with a JSON body
app.post('/users/:id/notes', (req, res) => {
  const userId = req.params.id;            // '42' (string, from the path)
  const isDraft = req.query.draft;         // 'true' (string, from ?draft=)
  const note = req.body;                   // { text: '...' } (needs express.json; undefined if no JSON body was sent)
  const auth = req.get('Authorization');   // header value or undefined
  res.status(201).json({ userId, isDraft, note });
});
```

**2. Enabling body parsing** — the prerequisite for `req.body`.

javascript

```
app.use(express.json({ limit: '1mb' }));            // JSON bodies -> req.body
app.use(express.urlencoded({ extended: true }));   // HTML form bodies -> req.body

app.post('/login', (req, res) => {
  // req.body is undefined without the parsers above, and in Express 5 also when
  // the request has no body or a non-matching Content-Type — so guard it.
  const { email, password } = req.body ?? {};
  res.json({ email });
});

// Real output (Express 5.2.1, Node v24.19.0):
//   POST /login  (no body)                        -> 200 {}
//   POST /login  {"email":"a@b.c"} as JSON        -> 200 {"email":"a@b.c"}
// Without "?? {}", the no-body request fails with 500:
//   TypeError: Cannot destructure property 'email' of 'req.body' as it is undefined.
```

**3. Response helpers — status, json, send, redirect, headers.**

javascript

```
app.get('/created', (req, res) => res.status(201).json({ id: 1 }));   // JSON + 201

app.get('/text', (req, res) => res.send('plain string'));            // text/html

app.get('/nothing', (req, res) => res.status(204).end());            // no body

app.get('/old', (req, res) => res.redirect('/new'));                 // 302 -> /new
app.get('/moved', (req, res) => res.redirect(301, '/permanent'));    // 301

app.get('/download', (req, res) => {
  res.set('Cache-Control', 'no-store');   // custom header
  res.json({ ok: true });
});
```

**4. The one-response rule in action** — and how to obey it.

javascript

```
app.get('/guard/:id', (req, res) => {
  if (!req.params.id) {
    return res.status(400).json({ error: 'id required' }); // return = stop here
  }
  // without the return above, execution would continue and try to respond again
  res.json({ id: req.params.id });
});
```

## Common mistakes & gotchas

- **`req.body` is `undefined`.** You forgot `express.json()` or `express.urlencoded()`, you registered it after the route, the client sent a different `Content-Type`, or on Express 5 the request simply had no body. Express 5 no longer defaults that case to `{}`.
- **Two responses.** `res.json()` and then `res.send()`, or a response without `return` that falls through, throws "Cannot set headers after they are sent". Respond once and return.
- **Assuming numbers.** `req.params.id` and `req.query.page` are strings. Use `Number(...)` and validate. `?flag=false` is the truthy string `"false"`, not a boolean.
- **Trusting `req.body`.** It is whatever the client sent, including missing or hostile fields. Validate before you use it.
- **Using `express.json()` for file uploads.** Multipart needs multer. The JSON parser ignores `multipart/form-data`.
- **No body-size `limit`.** An unbounded parser lets a client exhaust memory. Set `limit`.
- **Mixing up `req.path`, `req.url`, and `req.originalUrl`.** Inside a mounted router, `req.url` is relative to the mount. `req.originalUrl` is the full path the client requested.

## Best practices

- Register body parsers once, near the top, with an explicit `limit`, before any route that reads `req.body`.
- Prefer `res.json()` for APIs. `res.send()` would also JSON-encode an object, but `res.json()` states the content type.
- Set the status on purpose. 201 for a create, 204 for an empty success, 4xx for a client error. Do not leave everything at 200.
- Validate and coerce params, query, and body at the boundary, with a schema, so handlers see clean values.
- `return` after every response.
- Read headers with `req.get('Name')`. It is case-insensitive. Indexing `req.headers` with a guessed case is not.

## ⭐ Interview lens

> **Q: "Where do `req.params`, `req.query`, and `req.body` each come from?"**  
> A: `req.params` comes from named segments in the route path. `/users/:id` matched against `/users/42` gives `req.params.id`. Express parses that as it matches the route. `req.query` comes from the query string after `?`, and Express parses it for every request. `req.body` comes from the request body, but only after a parser such as `express.json()` has run and the `Content-Type` matched. Params and query are automatic. The body is opt-in because a JSON body, a form body, and a file upload are different parsers. For example, a POST to `/users/42/notes?draft=true` with a JSON object puts the id in `params`, `"true"` in `query.draft`, and the object in `body` only if `express.json()` ran above the route. The limit is Express 5. If no parser matched, or the request had no body, `req.body` is `undefined`, not `{}`.

> **Q: "Why is `req.body` undefined even though the client sent JSON?"**  
> A: No body parser ran before the handler, or it ran but did not claim this request. `express.json()` has to be registered with `app.use` above the route, and the client has to send `Content-Type: application/json`. The parser reads the stream, runs `JSON.parse`, and sets `req.body` before it calls `next()`. If the header is `text/plain`, or there is no body, the parser calls `next()` and leaves `req.body` alone. On Express 5 that means `undefined`. On Express 4 the built-in parsers set `{}` when they did not parse a body. The limit of checking only "did I call `express.json()`" is order. A parser registered below the route never runs for that route.

> **Q: "Difference between `res.send()` and `res.json()`?"**  
> A: `res.json(value)` always runs `JSON.stringify` on the value and sets `Content-Type` to `application/json`, then ends the response. `res.send(value)` looks at the type. A string goes out as HTML or text, a Buffer as binary, and an object or array is passed through to `res.json`. So `res.send({ ok: true })` does produce JSON, but a reader cannot see that from the call. On a JSON API, call `res.json` so the content type is explicit. Both methods finish the response. You cannot call the other one afterwards. Chain the status first if you need it: `res.status(201).json(data)`. `res.status` only stores the code and returns `res`. It does not send.

> **Q (trap): "What throws 'Cannot set headers after they are sent'?"**  
> A: You finished the response twice. `res.json`, `res.send`, `res.redirect`, and `res.end` write the status line and headers and then the body. Node throws `ERR_HTTP_HEADERS_SENT`, "Cannot set headers after they are sent", if you call another of them, or if you call `next()` and a later handler also writes. The usual shape is a handler that sends a 400 and then, without `return`, falls through to `res.json` of the success body. Return after the error response. The same throw happens if you try to `res.status(500).json(...)` after a stream has already flushed the headers. At that point `res.headersSent` is true, and the only honest move is to stop writing.

## Cheat-card

- Read with `req.params` (the path), `req.query` (after `?`), `req.body` (needs a parser), and `req.get('H')` for a header.
- Write with `res.status(n)`, which only sets the code, then `res.json(obj)`, `res.send(x)`, or `res.redirect(code, url)`.
- `req.body` needs `express.json()` or `express.urlencoded()` before the route.
- Params and query are always strings. Coerce them and validate.
- One response per request. Return after you respond.
- `res.json` is explicit JSON. `res.send` infers the type, and an object becomes JSON.
- Set a body `limit`. Use multer for file uploads, not `express.json()`.
- `req` and `res` extend Node's `IncomingMessage` and `ServerResponse`. `res.end()` and `res.setHeader()` still work.
- More of the API, including `req.is`, `req.accepts`, `req.ip`, `req.fresh`, `req.range`, `res.format`, `res.vary`, `res.append`, `express.raw`, and `express.text`, is lesson 54.
- Guard a JSON route with `if (!req.is('application/json')) return res.sendStatus(415)`, then read `req.body ?? {}`.

## Good to know

- Send a 201 with JSON as `res.status(201).json(data)`. `res.status` only stores the code and returns `res`. `res.json` serializes and sends.
- `req.params` and `req.query` values are always strings. A query value can also be an array or an object when the key is repeated or bracketed, but it is never a number or a boolean. `?active=false` is the truthy string `"false"`. Coerce and validate.
- On Express 5, `req.body` stays `undefined` when no parser matched or the request had no body. Express 4's parsers set `{}` in that case. With no parser at all, both versions leave it `undefined`.

## Learn More

- [Request Object (req) expressjs.com](https://expressjs.com/en/4x/api/request.html)
- [Response Object (res) expressjs.com](https://expressjs.com/en/4x/api/response.html)
- [Node.js and Express.js - Full Course freeCodeCamp.org](https://www.youtube.com/watch?v=Oe421EPjeBE)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (same output on 4.22.3)*

### The rest of the req and res API (pointer to lesson 54)

This lesson covers the request inputs (`params`, `query`, `body`, headers) and the main response helpers. Express adds about twenty more methods and properties to the same two objects. They are prototype methods and getters that Express mixes into Node's `IncomingMessage` and `ServerResponse`, like the ones above. Most of them compare request headers (`Content-Type`, `Accept*`, `X-Forwarded-*`, `If-None-Match`, `Range`) or write response headers (`Vary`, `Link`, `Content-Type`). Lesson 54 ([Express req and res: Complete API Reference](54-express-request-response-api-reference.md)) runs every one against a server. The table maps each item to the place in lesson 54 where it is covered.

How it works:

1. Find the method in the table below.
2. Open the linked section of lesson 54. The Example 1 table has one line per method with the real result, and Example 2 is the script that produced it.
3. For the worked examples (negotiation, webhooks, health checks), follow the example number.

| Method or property | What it does | Covered in lesson 54 |
|---|---|---|
| `req.is(type)` | checks the request `Content-Type` | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `req.accepts`, `req.acceptsLanguages`, `req.acceptsCharsets`, `req.acceptsEncodings` | pick the best match from `Accept*` headers | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples); version note in [How it works](54-express-request-response-api-reference.md#how-it-works) |
| `req.hostname`, `req.protocol`, `req.secure` | host and scheme, `X-Forwarded-*` aware with `trust proxy` | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `req.ip`, `req.ips` | client address and proxy chain with `trust proxy` | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples); settings in [lesson 52](52-express-app-settings-and-locals.md) |
| `req.subdomains` (`subdomain offset`) | host labels left of the base domain | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `req.fresh`, `req.stale` | conditional-request check against `res` `ETag` | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `req.xhr` | `X-Requested-With: XMLHttpRequest` test | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `req.range(size)` | parses the `Range` header | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `res.sendStatus(code)` | status plus reason-phrase body | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `res.format(obj)` | content negotiation, `Vary: Accept`, 406 | [Code examples, Example 3](54-express-request-response-api-reference.md#code-examples) |
| `res.type`, `res.links`, `res.vary`, `res.append` | set `Content-Type`, `Link`, `Vary`, or add a header value | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples) |
| `res.locals`, `res.headersSent` | per-request data; whether headers were written | [Code examples, Examples 1–2](54-express-request-response-api-reference.md#code-examples); locals in [lesson 52](52-express-app-settings-and-locals.md) |
| `express.raw`, `express.text` | body as `Buffer` / string | [Code examples, Examples 1–2 and the webhook in Example 4](54-express-request-response-api-reference.md#code-examples) |
| `express.urlencoded({ extended })` | form bodies; `extended` default `false` in v5 | [Code examples, Example 6](54-express-request-response-api-reference.md#code-examples) |
| health endpoints (`/livez`, `/readyz`, HEAD) | liveness vs readiness, `Cache-Control: no-store` | [Code examples, Example 5](54-express-request-response-api-reference.md#code-examples) |

**Example — `req.is` and `res.sendStatus` guarding a JSON route.**

javascript

```
// json-only.cjs: req.is + res.sendStatus guard in front of a JSON route.
const express = require('express');

const app = express();
app.use(express.json());

app.post('/notes', (req, res) => {
  if (!req.is('application/json')) return res.sendStatus(415); // also covers "no body": req.is returns null
  const { text } = req.body ?? {};                                // Express 5: req.body can still be undefined
  if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  res.status(201).json({ text });
});

const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/notes`;
  const send = async (label, init) => {
    const r = await fetch(url, { method: 'POST', ...init });
    console.log(label.padEnd(28), r.status, await r.text());
  };
  await send('JSON {"text":"hi"}', { headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' });
  await send('JSON {}', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await send('text/plain', { headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  await send('no body', {});
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0):
//   JSON {"text":"hi"}           201 {"text":"hi"}
//   JSON {}                      400 {"error":"text required"}
//   text/plain                   415 Unsupported Media Type
//   no body                      415 Unsupported Media Type
```

### Common mistakes & gotchas (additional topics)

- **Checking `Content-Type` with `===`.** Clients send parameters (`application/json; charset=utf-8`). `req.is('application/json')` ignores them; string equality does not.
- **Using singular `req.acceptsLanguage`** on Express 5. Only the plural forms exist there.

### Edge case worked through: a POST with no body

The last request in the example sends no body and no `Content-Type`. `req.is` returns `null` when the request has no body, so `!req.is(...)` is true and the route answers `415` before touching `req.body`. Without the guard, the route would still be safe because of `req.body ?? {}`: in Express 5 `req.body` is `undefined` here (see the body-parsing paragraph above). The `typeof text` check would then answer `400`.

### ⭐ Interview lens (additional topics)

> **Q: “How do you reject a non-JSON POST in Express?”**  
> A: `if (!req.is('application/json')) return res.sendStatus(415);`. `req.is` compares the media type and ignores parameters such as `charset`. It returns `null` when there is no body, so the same check also rejects empty requests. Keep `req.body ?? {}` afterwards, because Express 5 leaves `req.body` undefined when no parser ran.
