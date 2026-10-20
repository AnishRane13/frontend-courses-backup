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

## Why it matters

Every Express handler you will ever write does two things: it *reads* the incoming request and it *writes* a response. The `req` and `res` objects are the interface for both, and knowing them fluently is the difference between fumbling through docs on every endpoint and writing handlers on autopilot. Interviewers use these objects as a fast competence check: "where does the request body come from?", "how do you set a 201 with JSON?", "what does `res.json()` do that `res.send()` doesn't?" — quick questions that instantly reveal whether you have actually built APIs or just skimmed a tutorial.

Beyond the individual methods, these objects teach an important truth about Express: they are Node's own `IncomingMessage` and `ServerResponse`, *extended* with conveniences. That means everything you know about Node HTTP still applies, and the Express helpers are sugar on top. This topic maps the request side (`params`, `query`, `body`, `headers` and how body parsing actually works) and the response side (`json`, `status`, `send`, `redirect`, headers), plus the gotchas — the string-typing, the one-response rule, the parsing prerequisites — that turn into production bugs when ignored.

## The concept, simply

**`req` is the request: everything the client sent.** It bundles four sources of input. `req.params` holds path parameters (`/users/:id` → `req.params.id`). `req.query` holds the parsed query string (`?page=2` → `req.query.page`). `req.body` holds the parsed request body (the JSON a client POSTs) — but only if a body-parsing middleware ran first. `req.headers` (and the helper `req.get('Header-Name')`) holds the request headers. Plus useful extras: `req.method`, `req.path`, `req.originalUrl`, `req.cookies` (with a cookie parser), and `req.ip`.

**`res` is the response: everything you send back.** Its key methods are `res.status(code)` to set the HTTP status (chainable), `res.json(obj)` to send a JSON body (it serialises and sets `Content-Type: application/json`), `res.send(body)` to send a string, Buffer, or object (it guesses the type), and `res.redirect(url)` to send a redirect. You also set headers with `res.set()`/`res.header()`, cookies with `res.cookie()`, and end a bodiless response with `res.status(204).end()`. The golden rule: **you send exactly one response per request.**

![Two panels one labelled req incoming listing params query body and headers the other labelled res outgoing listing status json send and redirect](assets/i35_01_be4c0901.svg)

req is the read side (params, query, body, headers); res is the write side (status, json, send, redirect). One response per request.

The one concept that trips everyone: **body parsing is not automatic**. When a client POSTs JSON, the body arrives as a raw stream of bytes. Express does not decode it into `req.body` unless you registered `express.json()` (for JSON) or `express.urlencoded()` (for HTML-form encoding) earlier in the pipeline. Without that, `req.body` is `undefined`. Params and query are parsed for free; the body is opt-in because parsing strategy depends on content type.

## How it works

`req` and `res` are the same objects Node's HTTP server creates — `http.IncomingMessage` and `http.ServerResponse` — with Express's prototype methods mixed in. So `res.json()` ultimately calls `res.end()` underneath, and `req.headers` is Node's raw headers map. This layering is why you can always escape to the lower level: `res.setHeader()`, `res.writeHead()`, and `res.end()` all still work. Express helpers exist to remove repetitive steps, not to hide the machine.

Body parsing works because a parser is a middleware that reads the request stream to completion, decodes it according to the `Content-Type` header, and assigns the result to `req.body` before calling `next()`. `express.json()` only acts on requests whose `Content-Type` is `application/json`; `express.urlencoded()` handles `application/x-www-form-urlencoded`. If the incoming type does not match, or the request has no body at all, the parser passes through and `req.body` is left **`undefined`** in Express 5 (changed in v5; Express 4's parsers set it to `{}` in that case). With no parser registered it is `undefined` in both versions. So never destructure `req.body` without a fallback — `const { email } = req.body` throws `TypeError: Cannot destructure property 'email' of 'req.body' as it is undefined.` on a POST with no JSON body; write `req.body ?? {}` or validate it first. Both parsers accept a `limit` option to cap body size — an important guard against memory-exhaustion attacks. File uploads (`multipart/form-data`) need a dedicated library like `multer`, not the built-in parsers.

On the response side, `res.json(value)` runs `JSON.stringify` on the value, sets the `Content-Type` to `application/json`, and sends it. `res.send(value)` is more flexible and infers the type: a string is sent as HTML/text, a Buffer as binary, and — importantly — an object or array is sent as JSON (it delegates to `res.json`). For a JSON API, prefer `res.json()` explicitly; it is unambiguous. `res.status(code)` only *sets* the status and returns `res` so you can chain (`res.status(201).json(...)`); it does not send anything on its own. `res.redirect(url)` defaults to a 302 and sets the `Location` header; pass a status first for a permanent redirect (`res.redirect(301, url)`).

The strict rule underneath all of this is that **an HTTP response can be sent only once**. Methods like `res.json`, `res.send`, `res.redirect`, and `res.end` *finish* the response. Calling any of them a second time — or calling one after the headers have been flushed — throws `ERR_HTTP_HEADERS_SENT` ("Cannot set headers after they are sent"). This is why you `return` after responding, and why a handler that responds must not also fall through to `next()` into code that responds again. Types are the other recurring gotcha: values in `req.params` and `req.query` are always strings, and `req.body` reflects exactly what the client sent — never trust it without validation.

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

- **`req.body` is `undefined`.** You forgot `express.json()` / `express.urlencoded()`, or registered it after the route, or the client didn't send a matching `Content-Type`, or (Express 5) the request simply had no body — Express 5 no longer defaults it to `{}`.
- **Sending two responses.** Calling `res.json()` then `res.send()` (or responding without `return` and falling through) throws "Cannot set headers after they are sent". Respond once; `return` after.
- **Assuming numbers.** `req.params.id` and `req.query.page` are strings; do `Number(...)` and validate. `?flag=false` is the truthy string `"false"`, not a boolean.
- **Trusting `req.body`.** It is whatever the client sent, including missing or malicious fields. Validate/whitelist before using it (schema library or manual checks).
- **Using `express.json()` for file uploads.** Multipart uploads need `multer`; the JSON parser won't touch `multipart/form-data`.
- **Forgetting a body-size `limit`.** An unbounded parser lets a client send a huge body and exhaust memory; set `limit`.
- **Confusing `req.path`, `req.url`, and `req.originalUrl`.** Inside a mounted router `req.url` is relative to the mount; `req.originalUrl` is the full path the client requested.

## Best practices

- **Register body parsers once, near the top**, with an explicit `limit`, before any route that reads `req.body`.
- **Prefer `res.json()` for APIs** over `res.send()` — it is explicit about content type and intent, even though `send` would also JSON-encode an object.
- **Always set an intentional status** — 201 for creates, 204 for empty successes, 4xx for client errors — instead of letting everything default to 200.
- **Validate and coerce request inputs at the boundary** (params, query, body) with a schema library, so handlers work with clean, typed data.
- **Always `return` after sending a response** to guarantee the one-response rule and avoid header-already-sent errors.
- **Read headers via `req.get('Name')`** (case-insensitive) rather than indexing `req.headers` with a guessed casing.

## ⭐ Interview lens

> **Q: "Where do `req.params`, `req.query`, and `req.body` each come from?"**  
> A: `req.params` from named segments in the route path (`/users/:id`); `req.query` from the query string after the `?`; `req.body` from the parsed request body — but only after a body-parsing middleware like `express.json()` runs. Params and query are parsed automatically; the body is opt-in.

> **Q: "Why is `req.body` undefined even though the client sent JSON?"**  
> A: No body parser ran before the handler. You need `app.use(express.json())` registered above the route, and the client must send `Content-Type: application/json` so the parser activates.

> **Q: "Difference between `res.send()` and `res.json()`?"**  
> A: `res.json()` always serialises the argument with `JSON.stringify` and sets `Content-Type: application/json`. `res.send()` infers the type — string as text/HTML, Buffer as binary, object/array delegated to `res.json()`. For a JSON API, use `res.json()` for clarity.

> **Q: "How do you send a 201 with a JSON body?"**  
> A: `res.status(201).json(data)`. `res.status()` only sets the code and returns `res` for chaining; `res.json()` serialises and sends. It does not send by itself.

> **Q (trap): "What throws 'Cannot set headers after they are sent'?"**  
> A: Sending the response more than once — e.g. calling `res.json()` and then another `res.send()`/`res.redirect()`, or responding and then falling through into `next()` to code that also responds. An HTTP response can be finished only once; `return` after you respond.

> **Q: "Are `req.params` and `req.query` values typed?"**  
> A: No — always strings (query values can also be arrays/objects from repeated or bracketed keys, but never numbers or booleans). `?active=false` gives the truthy string `"false"`. You must coerce and validate.

## Cheat-card

- `req` reads: `req.params` (path), `req.query` (`?`), `req.body` (needs parser), `req.get('H')` (headers).
- `res` writes: `res.status(n)` (chainable), `res.json(obj)`, `res.send(x)`, `res.redirect([code,] url)`.
- `req.body` needs `express.json()` / `express.urlencoded()` **before** the route.
- Params & query are **always strings**. Coerce & validate.
- **One response per request.** `return` after responding.
- `res.json` = explicit JSON; `res.send` = infers type (object → JSON).
- Set a body-size `limit`; use `multer` for file uploads.
- `req`/`res` extend Node's `IncomingMessage`/`ServerResponse` — `res.end()`/`res.setHeader()` still work.
- **More of the API** (`req.is`, `req.accepts*`, `req.ip`/`ips`, `req.fresh`, `req.range`, `res.format`, `res.vary`, `res.append`, `express.raw`/`text`): lesson 54.
- **Guard JSON routes:** `if (!req.is('application/json')) return res.sendStatus(415)`, then `req.body ?? {}`.

---

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
