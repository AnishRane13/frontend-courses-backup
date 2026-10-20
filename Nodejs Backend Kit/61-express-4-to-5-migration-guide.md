---
title: "Migrating from Express 4 to Express 5"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Migrating from Express 4 to Express 5

*22 min read · Updated 10 Oct 2026 · Topic 94 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, each one compared against Express 4.22.3 (supertest 7.3.1, codemod CLI 1.18.3, `@expressjs/v5-migration-recipe` 1.1.0)

---

## Why it matters

Express 5 keeps the shape of the Express 4 API: `app.get`, `req`, `res`, middleware and `next`. That is why an upgrade looks easy and then fails in three different ways:

- **Crashes at startup.** Removed methods (`app.del`, `app.param(fn)`) and old route strings (`'/*'`, `'/:id?'`) throw while the app registers its routes.
- **Errors per request.** `req.param()`, `res.sendfile()` and `req.acceptsCharset()` are gone, so the routes that call them answer 500 with `TypeError: … is not a function`.
- **Silent behaviour changes.** These are the dangerous ones. `res.json(obj, 201)` now answers **200**. `res.send(404)` answers **200** with the body `404`. `res.redirect('back')` sends `Location: back`. `?a[b]=c` stops being a nested object, `req.body` becomes `undefined`, and `/.well-known/…` starts returning 404. None of these throw.

This lesson walks the official migration guide ([expressjs.com/en/guide/migrating-5.html](https://expressjs.com/en/guide/migrating-5.html)) item by item. For each item it shows what Express 4.22.3 actually did and what Express 5.3.0 actually does, measured by running both side by side. It ends with the official codemod (run on a real sample, with its diff and the two things it got wrong), grep patterns for what the codemod does not touch, and a step-by-step checklist.

## The concept, simply

Express 5.0 was released in September 2024. 5.3.0 is the current release on npm as of this lesson. It needs Node 18 or newer (`"engines": {"node": ">= 18"}` in its `package.json`; Express 4.22.3 says `>= 0.10.0`). Most of the changes come from Express swapping or upgrading the small packages it is built from:

| Part | Express 4.22.3 | Express 5.3.0 |
|---|---|---|
| Router | built in (`lib/router`) | the `router` package 2.2.0 |
| Path matching | path-to-regexp 0.1.13 | path-to-regexp 8.4.2 |
| Body parsers | body-parser 1.20.8 | body-parser 2.3.0 |
| Static files / `sendFile` | serve-static 1.16.3, send 0.19.2 | serve-static 2.2.1, send 1.2.1 |
| MIME types | mime 1.6.0 / mime-db 1.52.0 | mime-types 3.0.2 / mime-db 1.54.0 |
| Final error handler | finalhandler 1.3.2 | finalhandler 2.1.1 |
| Default query parser | `"extended"` (qs) | `"simple"` (Node's `querystring`) |

You can run both majors in one project to compare them, because npm can install a package under an alias:

bash

```
$ npm install express@5 express4@npm:express@4 supertest
$ node -p "require('express/package.json').version + ' / ' + require('express4/package.json').version"
5.3.0 / 4.22.3
```

Every example below takes the package name as an argument (`node file.cjs express4` or `node file.cjs express`).

The guide groups the changes into three lists, and this lesson keeps that order:

1. **Removed:** methods and signatures that no longer exist. Most of them printed a `deprecated` warning in Express 4.
2. **Changed:** APIs that still exist but behave differently.
3. **Improvements:** changes that need no code edits.

## How it works

Upgrade in this order, because each step makes the next one's failures easier to read:

1. **Run your test suite on Express 4 and read its deprecation warnings.** Express 4 prints a line such as `express deprecated res.json(obj, status): Use res.status(status).json(obj) instead at routes/users.js:12:7` for most removed APIs. It prints the warning once for each call site, and only when that line actually runs. Each warning names a line you must change.
2. **Run the official codemod** (`npx codemod@latest @expressjs/v5-migration-recipe`) on a clean git tree, then review its diff (Example 9).
3. **Grep for what the codemod does not handle**: route strings, `req.query` writes, `express.urlencoded()` without options, `router.param` arrays, `clearCookie` options (Example 10).
4. **Install `express@5`, start the app,** and fix every `PathError` and `TypeError` thrown at startup.
5. **Run the tests again** and go through the silent changes in the table below one by one.

**Removed methods and signatures.** Results from Examples 1 and 2:

| Guide item | Express 4.22.3 (measured) | Express 5.3.0 (measured) | Replace with |
|---|---|---|---|
| `app.del()` | works, `deprecated app.del` | `TypeError: app.del is not a function` at registration | `app.delete()` |
| `app.param(fn)` / `router.param(fn)` | works, `deprecated router.param(fn)` | `TypeError: argument name must be a string` | `app.param(name, fn)` |
| `req.acceptsCharset/Encoding/Language()` | works, deprecated | `TypeError: req.acceptsCharset is not a function` (500) | `acceptsCharsets/Encodings/Languages()` |
| leading colon, `app.param(':id', fn)` | runs, deprecated | **never runs, no warning** (stored under the name `':id'`) | `app.param('id', fn)` |
| `req.param(name)` | works, deprecated | `TypeError: req.param is not a function` | `req.params.x`, `req.body.x` or `req.query.x`, whichever the value really comes from |
| `res.json(obj, status)`, `res.jsonp(obj, status)` | status 201 used, deprecated | **200**, second argument ignored | `res.status(201).json(obj)` |
| `res.send(body, status)` | status used, deprecated | **200**, second argument ignored | `res.status(s).send(body)` |
| `res.send(404)` | `404 Not Found`, deprecated | **200**, JSON body `404` | `res.sendStatus(404)` |
| `res.redirect(url, status)` | redirect works, deprecated | 500 `TypeError: Invalid status code: "/users"` | `res.redirect(301, url)` |
| `res.redirect('back')`, `res.location('back')` | uses `Referer` (or `/`), deprecated | **`Location: back`** (a literal relative URL) | `req.get('Referrer') \|\| '/'` |
| `res.sendfile()` | works, deprecated | `TypeError: res.sendfile is not a function` | `res.sendFile()` |
| `sendFile`/`static` option `hidden` | `hidden: true` serves dotfiles, deprecated | option ignored, dotfiles 404 | `dotfiles: 'allow'` |
| `from` option | not usable through `res.sendFile` in 4.22.3 either | same `TypeError` | `root` |
| `express.static.mime` | an object (`mime` 1.6.0) | `undefined` | the `mime-types` package |
| MIME types | `.js` → `application/javascript` | `.js` → `text/javascript` | nothing. Update tests that compare `Content-Type`. |
| debug output | `DEBUG=express:*` shows router lines | router lines moved to `router`, `router:*` | `DEBUG=express:*,router,router:*` |

The guide says Express 5 "will silently ignore" a leading colon in `app.param(name, fn)` and "use the name parameter without prefixing it with a colon". In router 2.2.0, `Router.prototype.param` stores the name exactly as given. So `app.param(':uid', fn)` registers a callback for a parameter literally named `:uid`. That callback never matches, and Example 1 shows it never runs.

**Path syntax.** path-to-regexp 8 removed `?`, `+`, `*`, `(…)` and `[…]` from string patterns. Old strings throw a `PathError` at registration. [Express Routing Extras](53-express-routing-extras.md) (lesson 53) has the full before/after table and the real errors (its Examples 2 and 3). Note that Express 4 accepts the new syntax and just never matches it. Wildcards now give arrays (`req.params.splat` is `['foo', 'bar']`), and an unmatched optional parameter is absent from `req.params` instead of being `undefined` (Example 4).

**Async errors.** An Express 4 route handler is called inside a synchronous `try/catch`. An `async` handler returns a promise straight away, so when that promise rejects later, nothing in Express is listening. The rejection becomes an unhandled rejection. Node's default `--unhandled-rejections=throw` mode (since Node 15) turns it into an uncaught exception, and **the process exits with code 1**. Every other in-flight request is dropped with it (Example 3). In Express 5, the router checks whether a handler returned a promise. If it did, the router attaches `.then(null, err => next(err || new Error('Rejected promise')))`. A rejected or throwing `async` handler or middleware therefore reaches your error middleware exactly as if you had called `next(err)`. A rejection with a falsy value (`throw undefined`) arrives as `Error: Rejected promise`. You can delete `asyncHandler` wrappers and `express-async-errors` after the upgrade. They still work, but they are redundant.

![Middleware A calls next(), the handler throws or calls next(err), the normal middleware after it is skipped, and the error jumps straight to the 4-argument error handler; notes say Express 4 does not catch async throws while Express 5 auto-forwards a rejected async handler to next(err)](assets/i34_01_6ef3f077.svg)
*Figure: How an error skips ahead. Look at: the two notes at the bottom. "Express 4: async throws are NOT caught" (in practice the process crashes), while "Express 5: a rejected async handler auto-forwards to next(err)".*

**Request changes** (Example 4):

- **`req.body`** is `undefined` until a body parser has set it. In Express 4 it was `{}` whenever a parser was registered, even if that parser skipped the request (for example a `text/plain` body with only `express.json()`). Code that destructures `req.body` must use `req.body ?? {}`.
- **`req.query`** is a getter (not a writable property). It re-parses the query string **on every read**, so `req.query === req.query` is `false`. Assigning to it throws in strict code (ES modules and `'use strict'` files) and is silently ignored in sloppy code. Mutating it (`req.query.page = 1`) changes an object that the next read throws away. Put normalised values somewhere else, for example `res.locals.validated` (the pattern used in lesson 65).
- **The default query parser** is `"simple"` (Node's `querystring`). `?a[b]=c` gives `{ 'a[b]': 'c' }`. Repeated keys still give arrays. `app.set('query parser', 'extended')` restores qs parsing.
- **`req.host`** keeps the port (`example.com:8080`). In Express 4 it dropped the port and was deprecated in favour of `req.hostname`, which never includes the port in either version.
- **`req.params`** has a null prototype for string paths (`req.params.hasOwnProperty` is `undefined`; use `Object.hasOwn`). A RegExp route still gives a normal object.

**Body parsers** (Example 5). `express.urlencoded()` now defaults to `extended: false` (Node's `querystring`, flat keys). Express 4 defaulted to `extended: true` (qs, nested objects) and printed `body-parser deprecated undefined extended: provide extended option`. All four parsers (`json`, `urlencoded`, `text`, `raw`) now also decompress `Content-Encoding: br`. All four go through body-parser 2.3.0's shared `lib/read.js`, and only `json` was exercised here. Express 4 rejected it with `415 unsupported content encoding "br"`.

**Static files and `sendFile`** (Example 6). The guide's sentence is "In Express 4, dotfiles were served by default." That is not what Express 4.22.3 (serve-static 1.16.3 / send 0.19.2) does. With no `dotfiles` option, it returned **404 for a dotfile itself** (`/.env`) but **served files inside a dot-directory** (`/.well-known/acme-challenge/token`). Express 5 (serve-static 2.2.1 / send 1.2.1) defaults `dotfiles` to `"ignore"` for **every** path segment that starts with a dot. So `/.env` is still 404, `/.well-known/…` becomes 404, and `res.sendFile('/abs/path/.cache/index.html')` becomes 404 too. The fix the guide recommends is a separate mount, `app.use('/.well-known', express.static('public/.well-known', { dotfiles: 'allow' }))`, which opens only that directory. With `root`, only the part of the path below `root` is checked.

**Response validation** (Example 7). `res.status()` now throws on anything that is not an integer from 100 to 999. The message is `RangeError: … must be greater than 99 and less than 1000` or `TypeError: … must be an integer`. Express 4 accepted the string `"201"` and rounded `200.5` with a warning. `res.vary()` with no argument throws `TypeError: field argument is required`. Express 4 only warned. `res.clearCookie(name, { maxAge, expires })` ignores both options and always sends `Expires=Thu, 01 Jan 1970`. In Express 4, `maxAge: 60000` produced a "cleared" cookie that lived for 60 more seconds.

**The rest** (Example 8). `app.listen(port, cb)` now calls `cb(err)` on a listen error such as `EADDRINUSE`. Express 4 threw it as an uncaught exception. If your callback ignores its argument, the error is now swallowed. `app.router` exists again as a reference to the app's base router (Express 4 threw `'app.router' is deprecated!`). `res.render` always calls back asynchronously, even with a view engine that calls back synchronously.

## Code examples

**Example 1 — removed methods: deprecation warnings in Express 4, `TypeError` in Express 5.**

javascript

```
// removed.cjs: node removed.cjs express4   vs   node removed.cjs express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`)); // depd emits here instead of stderr

function register(label, fn) {
  try { fn(); console.log(`${label}: registered`); }
  catch (err) { console.log(`${label}: THROWS ${err.constructor.name}: ${err.message}`); }
}

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  const app = express();
  register("app.del('/u/:id')", () => app.del('/u/:id', (req, res) => res.send('deleted')));
  register('app.param(fn)', () => app.param((n, opt) => (req, res, next) => next()));
  register('router.param(fn)', () => express.Router().param((n, opt) => (req, res, next) => next()));
  register("router.param(['id','page'], fn)", () => express.Router().param(['id', 'page'], (req, res, next) => next()));
  register("app.param(['id','page'], fn)", () => app.param(['id', 'page'], (req, res, next) => next()));
  console.log('typeof express.static.mime:', typeof express.static.mime);

  const routes = express();  // a fresh app: app.param(fn) above changed how app.param works on `app`
  routes.param(':uid', (req, res, next, v) => { req.loaded = v; next(); });  // leading colon
  routes.get('/colon/:uid', (req, res) => res.send(`param callback ran: ${req.loaded !== undefined}`));
  routes.get('/accepts', (req, res) => res.send(`${req.acceptsCharset('utf-8')} ${req.acceptsEncoding('br')} ${req.acceptsLanguage('en')}`));
  routes.get('/param/:id', (req, res) => res.send(`req.param('id') = ${req.param('id')}`));
  routes.get('/sendfile', (req, res) => res.sendfile(__filename));
  routes.use((err, req, res, next) => res.status(500).send(`${err.constructor.name}: ${err.message}`));

  for (const url of ['/colon/1', '/accepts', '/param/7', '/sendfile']) {
    const r = await request(routes).get(url).set('Accept-Language', 'en').set('Accept-Encoding', 'br');
    console.log(`GET ${url} -> ${r.status} ${r.text ?? `(${r.headers['content-type']} body)`}`);
  }
})();

// Real output (node removed.cjs express4):
//   express4 4.22.3
//       deprecation: app.del: Use app.delete instead
//   app.del('/u/:id'): registered
//       deprecation: router.param(fn): Refactor to use path params
//   app.param(fn): registered
//       deprecation: router.param(fn): Refactor to use path params
//   router.param(fn): registered
//   router.param(['id','page'], fn): registered
//   app.param(['id','page'], fn): registered
//   typeof express.static.mime: object
//       deprecation: router.param(":uid", fn): Use router.param("uid", fn) instead
//   GET /colon/1 -> 200 param callback ran: true
//       deprecation: req.acceptsCharset: Use acceptsCharsets instead
//       deprecation: req.acceptsEncoding: Use acceptsEncodings instead
//       deprecation: req.acceptsLanguage: Use acceptsLanguages instead
//   GET /accepts -> 200 utf-8 br en
//       deprecation: req.param(name): Use req.params, req.body, or req.query instead
//   GET /param/7 -> 200 req.param('id') = 7
//       deprecation: res.sendfile: Use res.sendFile instead
//   GET /sendfile -> 200 (application/octet-stream body)
// Real output (node removed.cjs express):
//   express 5.3.0
//   app.del('/u/:id'): THROWS TypeError: app.del is not a function
//   app.param(fn): THROWS TypeError: argument name must be a string
//   router.param(fn): THROWS TypeError: argument name must be a string
//   router.param(['id','page'], fn): THROWS TypeError: argument name must be a string
//   app.param(['id','page'], fn): registered
//   typeof express.static.mime: undefined
//   GET /colon/1 -> 200 param callback ran: false
//   GET /accepts -> 500 TypeError: req.acceptsCharset is not a function
//   GET /param/7 -> 500 TypeError: req.param is not a function
//   GET /sendfile -> 500 TypeError: res.sendfile is not a function
```

The `process.on('deprecation')` listener is a feature of the `depd` package that Express uses. When the listener exists, `depd` emits the warning there instead of printing a timestamped line to stderr. `app.param(['id', 'page'], fn)` still works in Express 5, because `app.param` loops over the array itself. `router.param` does not, and throws.

**Example 2 — old response signatures: the silent ones and the loud ones.**

javascript

```
// sigs.cjs: old response signatures. node sigs.cjs express4  vs  node sigs.cjs express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`));

const app = express();
app.get('/json', (req, res) => res.json({ name: 'Ruben' }, 201));
app.get('/jsonp', (req, res) => res.jsonp({ name: 'Ruben' }, 201));
app.get('/send-body-status', (req, res) => res.send('created', 201));
app.get('/send-status', (req, res) => res.send(404));
app.get('/redirect-url-status', (req, res) => res.redirect('/users', 301));
app.get('/redirect-back', (req, res) => res.redirect('back'));
app.get('/location-back', (req, res) => res.location('back').sendStatus(204));
app.use((err, req, res, next) => res.status(500).send(`${err.constructor.name}: ${err.message}`));

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  for (const url of ['/json', '/jsonp', '/send-body-status', '/send-status', '/redirect-url-status', '/redirect-back', '/location-back']) {
    const r = await request(app).get(url).set('Referer', 'http://shop.test/cart');
    const loc = r.headers.location ? ` Location: ${r.headers.location}` : '';
    console.log(`GET ${url} -> ${r.status} ${r.headers['content-type']?.split(';')[0] ?? '-'}${loc} body: ${JSON.stringify(r.text)}`);
  }
})();

// Real output (node sigs.cjs express4):
//   express4 4.22.3
//       deprecation: res.json(obj, status): Use res.status(status).json(obj) instead
//   GET /json -> 201 application/json body: "{\"name\":\"Ruben\"}"
//       deprecation: res.jsonp(obj, status): Use res.status(status).jsonp(obj) instead
//   GET /jsonp -> 201 application/json body: "{\"name\":\"Ruben\"}"
//       deprecation: res.send(body, status): Use res.status(status).send(body) instead
//   GET /send-body-status -> 201 text/html body: "created"
//       deprecation: res.send(status): Use res.sendStatus(status) instead
//   GET /send-status -> 404 text/plain body: "Not Found"
//       deprecation: res.redirect(url, status): Use res.redirect(status, url) instead
//   GET /redirect-url-status -> 301 text/plain Location: /users body: "Moved Permanently. Redirecting to /users"
//       deprecation: res.location("back"): use res.location(req.get("Referrer") || "/") and refer to https://dub.sh/security-redirect for best practices
//   GET /redirect-back -> 302 text/plain Location: http://shop.test/cart body: "Found. Redirecting to http://shop.test/cart"
//       deprecation: res.location("back"): use res.location(req.get("Referrer") || "/") and refer to https://dub.sh/security-redirect for best practices
//   GET /location-back -> 204 - Location: http://shop.test/cart body: ""
// Real output (node sigs.cjs express):
//   express 5.3.0
//   GET /json -> 200 application/json body: "{\"name\":\"Ruben\"}"
//   GET /jsonp -> 200 application/json body: "{\"name\":\"Ruben\"}"
//   GET /send-body-status -> 200 text/html body: "created"
//   GET /send-status -> 200 application/json body: "404"
//       deprecation: Url must be a string
//       deprecation: Status must be a number
//   GET /redirect-url-status -> 500 text/plain Location: 301 body: "TypeError: Invalid status code: \"/users\". Status code must be an integer."
//   GET /redirect-back -> 302 text/plain Location: back body: "Found. Redirecting to back"
//   GET /location-back -> 204 - Location: back body: ""
```

Four of these change behaviour without an error in Express 5. `res.json(obj, 201)`, `res.jsonp(obj, 201)` and `res.send('created', 201)` answer 200. `res.send(404)` answers 200 with `Content-Type: application/json` and the body `404`. A test that checks only the body passes. A client that checks the status sees success. `res.redirect('back')` sends a relative `Location: back`, and a browser resolves that against the current URL (`/redirect-back` → `/back`).

**Example 3 — async handler errors: Express 4 crashes, Express 5 forwards.**

javascript

```
// async.cjs: node async.cjs express4  vs  node async.cjs express
// The same async handler on both versions; the parent process plays the client.
const { spawn } = require('node:child_process');
const name = process.argv[2] ?? 'express';

if (process.argv[3] === 'server') {
  const express = require(name);
  const app = express();
  app.get('/user/:id', async (req, res) => {
    await new Promise((r) => setTimeout(r, 10));
    throw new Error('db down');                 // a rejected promise from the handler
  });
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, () => console.log(`PORT ${server.address().port}`));
} else {
  const child = spawn(process.execPath, [__filename, name, 'server']);
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  child.on('exit', (code, signal) => {
    const errLine = stderr.split('\n').find((l) => l.startsWith('Error')) ?? '(none)';
    console.log(`server exit: code=${code} signal=${signal}; server stderr: ${errLine}`);
  });
  child.stdout.once('data', async (d) => {
    const port = String(d).match(/PORT (\d+)/)[1];
    console.log(`${name} ${require(`${name}/package.json`).version}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/user/1`, { signal: AbortSignal.timeout(3000) });
      console.log(`client: HTTP ${r.status} ${await r.text()}`);
    } catch (err) {
      console.log(`client: ${err.name}: ${err.message} (cause: ${err.cause?.code ?? err.cause?.name})`);
    }
    child.kill();
  });
}

// Real output (node async.cjs express4):
//   express4 4.22.3
//   client: TypeError: fetch failed (cause: UND_ERR_SOCKET)
//   server exit: code=1 signal=null; server stderr: Error: db down
// Real output (node async.cjs express):
//   express 5.3.0
//   client: HTTP 500 {"error":"db down"}
//   server exit: code=null signal=SIGTERM; server stderr: (none)
```

On Express 4 the error middleware never ran. The rejection killed the server process (exit code 1), and the client saw its socket close (`UND_ERR_SOCKET`). On Express 5 the same handler produced a normal 500 from the error middleware, and the server kept running until the script stopped it with `SIGTERM`. Lesson 50 shows the third Express 4 outcome, a hang, which happens when something swallows unhandled rejections.

**Example 4 — request changes: `req.body`, `req.query`, `req.host`, `req.params`.**

javascript

```
'use strict';
// reqs.cjs: request-side changes. node reqs.cjs express4  vs  node reqs.cjs express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
const v5 = name === 'express';
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`));

const app = express();
app.use(express.json());
app.post('/body', (req, res) => res.json({ body: req.body === undefined ? 'undefined' : req.body }));

app.get('/query', (req, res) => {
  const parsed = structuredClone(req.query);
  const q = req.query;
  q.page = '1';                                   // mutate the object the getter returned
  let assign = 'ok';
  try { req.query = { page: '2' }; } catch (err) { assign = `${err.constructor.name}: ${err.message}`; }
  res.json({ parsed, after: req.query, sameObjectTwice: req.query === req.query, assign });
});

app.get('/host', (req, res) => res.json({ host: req.host, hostname: req.hostname }));

app.get(v5 ? '/w/*splat' : '/w/*', (req, res) => res.json(req.params));
app.get(v5 ? '/f/:file{.:ext}' : '/f/:file.:ext?', (req, res) =>
  res.json({ params: req.params, keys: Object.keys(req.params), nullProto: Object.getPrototypeOf(req.params) === null }));

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  const show = async (label, r) => console.log(`${label.padEnd(36)} ${r.status} ${r.text}`);
  await show('POST /body (no body)', await request(app).post('/body'));
  await show('POST /body (text/plain)', await request(app).post('/body').type('text').send('hi'));
  await show('GET /query?a[b]=c&tag=x&tag=y', await request(app).get('/query?a[b]=c&tag=x&tag=y'));
  await show('GET /host (Host: example.com:8080)', await request(app).get('/host').set('Host', 'example.com:8080'));
  await show('GET /w/foo/bar', await request(app).get('/w/foo/bar'));
  await show('GET /f/image', await request(app).get('/f/image'));
})();

// Real output (node reqs.cjs express4):
//   express4 4.22.3
//   POST /body (no body)                 200 {"body":{}}
//   POST /body (text/plain)              200 {"body":{}}
//   GET /query?a[b]=c&tag=x&tag=y        200 {"parsed":{"a":{"b":"c"},"tag":["x","y"]},"after":{"page":"2"},"sameObjectTwice":true,"assign":"ok"}
//       deprecation: req.host: Use req.hostname instead
//   GET /host (Host: example.com:8080)   200 {"host":"example.com","hostname":"example.com"}
//   GET /w/foo/bar                       200 {"0":"foo/bar"}
//   GET /f/image                         200 {"params":{"file":"image"},"keys":["file","ext"],"nullProto":false}
// Real output (node reqs.cjs express):
//   express 5.3.0
//   POST /body (no body)                 200 {"body":"undefined"}
//   POST /body (text/plain)              200 {"body":"undefined"}
//   GET /query?a[b]=c&tag=x&tag=y        200 {"parsed":{"a[b]":"c","tag":["x","y"]},"after":{"a[b]":"c","tag":["x","y"]},"sameObjectTwice":false,"assign":"TypeError: Cannot set property query of #<IncomingMessage> which has only a getter"}
//   GET /host (Host: example.com:8080)   200 {"host":"example.com:8080","hostname":"example.com"}
//   GET /w/foo/bar                       200 {"splat":["foo","bar"]}
//   GET /f/image                         200 {"params":{"file":"image"},"keys":["file"],"nullProto":true}
```

Read the `/query` line closely. In Express 5, `parsed` is flat (`a[b]`). The `page` written into the first object is gone in `after`, because the getter parsed the string again. `sameObjectTwice` is `false`, and the assignment threw because this file is in strict mode. In Express 4 the property was a plain value: the assignment replaced it, and the same object came back on every read. The `/f/image` line shows the other two changes: Express 4 kept an `ext` key (value `undefined`, so `JSON.stringify` dropped it from `params` but `keys` still lists it), while Express 5 omits the key and uses a null prototype.

**Example 5 — `express.urlencoded()` defaults and Brotli request bodies, driven with curl.**

javascript

```
// parsers.cjs: node parsers.cjs express4 5910   /   node parsers.cjs express 5911
const [name = 'express', port = '5911'] = process.argv.slice(2);
const express = require(name);
const app = express();
app.use(express.urlencoded());      // no `extended` option given
app.use(express.json());
app.post('/form', (req, res) => res.json(req.body));
app.post('/json', (req, res) => res.json(req.body));
app.use((err, req, res, next) => res.status(err.status ?? 500).json({ status: err.status, type: err.type, message: err.message }));
app.listen(Number(port), () => console.log(`${name} ${require(`${name}/package.json`).version} on ${port}`));
```

bash

```
$ node parsers.cjs express4 5910 &   # prints:
  Sat, 10 Oct 2026 16:19:24 GMT body-parser deprecated undefined extended: provide extended option at parsers.cjs:5:17
  express4 4.22.3 on 5910
$ node parsers.cjs express 5911 &    # prints:
  express 5.3.0 on 5911
$ curl -s localhost:5910/form -d 'a[b]=c&t=1'
{"a":{"b":"c"},"t":"1"}
$ curl -s localhost:5911/form -d 'a[b]=c&t=1'
{"a[b]":"c","t":"1"}
$ node -e "process.stdout.write(require('node:zlib').brotliCompressSync('{\"a\":1}'))" > body.br
$ curl -s localhost:5910/json -H 'Content-Type: application/json' -H 'Content-Encoding: br' --data-binary @body.br
{"status":415,"type":"encoding.unsupported","message":"unsupported content encoding \"br\""}
$ curl -s localhost:5911/json -H 'Content-Type: application/json' -H 'Content-Encoding: br' --data-binary @body.br
{"a":1}
```

Both servers ran the same file. Set `extended` explicitly in Express 4 code before you upgrade: `true` keeps nested objects, `false` gets Express 5's behaviour today.

**Example 6 — `express.static` dotfiles, hidden directories, `hidden`, `sendFile` and MIME types.**

javascript

```
// static.cjs: dotfiles, hidden directories and MIME types. node static.cjs express4 | express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
const fs = require('node:fs');
const path = require('node:path');
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`));

const pub = path.join(__dirname, 'fixture', 'public');            // build the fixture tree
fs.mkdirSync(path.join(pub, '.well-known', 'acme-challenge'), { recursive: true });
fs.writeFileSync(path.join(pub, '.well-known', 'acme-challenge', 'token'), 'abc123');
fs.writeFileSync(path.join(pub, '.env'), 'SECRET=1');
fs.writeFileSync(path.join(pub, 'app.js'), 'console.log(1)');
const built = path.join(__dirname, 'fixture', '.cache', 'index.html');
fs.mkdirSync(path.dirname(built), { recursive: true });
fs.writeFileSync(built, '<h1>built</h1>');

const plain = express();
plain.use(express.static(pub));                                   // defaults only

const hidden = express();
hidden.use(express.static(pub, { hidden: true }));                // Express 4 option

const fixed = express();                                          // the guide's fix
fixed.use('/.well-known', express.static(path.join(pub, '.well-known'), { dotfiles: 'allow' }));
fixed.use(express.static(pub));

const files = express();
const send = (opts, file = built) => (req, res, next) => res.sendFile(file, opts, (err) => err && next(err));
files.get('/abs', send({}));                                       // absolute path through ".cache"
files.get('/abs-allow', send({ dotfiles: 'allow' }));
files.get('/root', send({ root: path.dirname(built) }, 'index.html'));
files.use((err, req, res, next) => res.status(err.status ?? 500).send(`${err.status} ${err.message.replace(__dirname, '.')}`));

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  const run = async (label, app, url) => {
    const r = await request(app).get(url);
    console.log(`${label.padEnd(7)} GET ${url.padEnd(33)} ${r.status} ${r.headers['content-type']}`);
  };
  await run('plain', plain, '/app.js');
  await run('plain', plain, '/.env');
  await run('plain', plain, '/.well-known/acme-challenge/token');
  await run('hidden', hidden, '/.env');
  await run('fixed', fixed, '/.well-known/acme-challenge/token');
  await run('fixed', fixed, '/.env');
  for (const url of ['/abs', '/abs-allow', '/root']) await run('files', files, url);
})();

// Real output (node static.cjs express4):
//   express4 4.22.3
//   plain   GET /app.js                           200 application/javascript; charset=UTF-8
//   plain   GET /.env                             404 text/html; charset=utf-8
//   plain   GET /.well-known/acme-challenge/token 200 application/octet-stream
//       deprecation: hidden: use dotfiles: 'allow' instead
//   hidden  GET /.env                             200 application/octet-stream
//   fixed   GET /.well-known/acme-challenge/token 200 application/octet-stream
//   fixed   GET /.env                             404 text/html; charset=utf-8
//   files   GET /abs                              200 text/html; charset=UTF-8
//   files   GET /abs-allow                        200 text/html; charset=UTF-8
//   files   GET /root                             200 text/html; charset=UTF-8
// Real output (node static.cjs express):
//   express 5.3.0
//   plain   GET /app.js                           200 text/javascript; charset=utf-8
//   plain   GET /.env                             404 text/html; charset=utf-8
//   plain   GET /.well-known/acme-challenge/token 404 text/html; charset=utf-8
//   hidden  GET /.env                             404 text/html; charset=utf-8
//   fixed   GET /.well-known/acme-challenge/token 200 application/octet-stream
//   fixed   GET /.env                             404 text/html; charset=utf-8
//   files   GET /abs                              404 text/html; charset=utf-8
//   files   GET /abs-allow                        200 text/html; charset=utf-8
//   files   GET /root                             200 text/html; charset=utf-8
```

Line 2 shows that `/.env` was already 404 on Express 4. What changed is line 3: files inside a dot-directory. The `fixed` app serves only `.well-known` and still hides `/.env`. On the `files` lines, the absolute path runs through the hidden directory `.cache`, so Express 5 refuses it unless you pass `dotfiles: 'allow'` or move the hidden part into `root`. The guide also lists the undocumented `from` option. It never worked through `res.sendFile` in 4.22.3 either:

javascript

```
// from.cjs: the undocumented `from` option (alias of `root`). node from.cjs express4 | express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
const path = require('node:path');
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`));
const dir = path.join(__dirname, 'fixture', 'public');            // created by static.cjs
const app = express();
app.get('/from', (req, res, next) => res.sendFile('app.js', { from: dir }, (err) => err && next(err)));
app.get('/root', (req, res, next) => res.sendFile('app.js', { root: dir }, (err) => err && next(err)));
app.use((err, req, res, next) => res.status(err.status ?? 500).send(`${err.constructor.name}: ${err.message}`));
(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  for (const url of ['/from', '/root']) {
    const r = await request(app).get(url);
    console.log(`GET ${url} -> ${r.status} ${r.text ?? r.headers['content-type']}`);
  }
})();

// Real output (node from.cjs express4):
//   express4 4.22.3
//   GET /from -> 500 TypeError: path must be absolute or specify root to res.sendFile
//   GET /root -> 200 console.log(1)
// Real output (node from.cjs express):
//   express 5.3.0
//   GET /from -> 500 TypeError: path must be absolute or specify root to res.sendFile
//   GET /root -> 200 console.log(1)
```

**Example 7 — `res.status` validation, `res.vary()`, `res.clearCookie()` options.**

javascript

```
// resp.cjs: res.status validation, res.vary(), res.clearCookie(). node resp.cjs express4 | express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');
process.on('deprecation', (e) => console.log(`    deprecation: ${e.message}`));

const app = express();
app.get('/status', (req, res) => res.status(JSON.parse(req.query.code)).send('ok'));
app.get('/vary', (req, res) => { res.vary(); res.send('ok'); });
app.get('/logout', (req, res) => res.clearCookie('session', { maxAge: 60_000, path: '/' }).sendStatus(204));
app.use((err, req, res, next) => res.status(500).send(`${err.constructor.name}: ${err.message}`));

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  for (const code of ['99', '1000', '200.5', '"201"', '404']) {
    const r = await request(app).get('/status').query({ code });
    console.log(`res.status(${code}) -> ${r.status} ${r.text}`);
  }
  const v = await request(app).get('/vary');
  console.log(`res.vary() -> ${v.status} ${v.text}`);
  const c = await request(app).get('/logout');
  console.log(`clearCookie({ maxAge: 60000 }) -> Set-Cookie: ${c.headers['set-cookie']}`);
})();

// Real output (node resp.cjs express4):
//   express4 4.22.3
//   res.status(99) -> 500 RangeError: Invalid status code: 99
//   res.status(1000) -> 500 RangeError: Invalid status code: 1000
//       deprecation: res.status(200.5): use res.status(200) instead
//   res.status(200.5) -> 200 ok
//   res.status("201") -> 201 ok
//   res.status(404) -> 404 ok
//       deprecation: res.vary(): Provide a field name
//   res.vary() -> 200 ok
//       deprecation: res.clearCookie: Passing "options.maxAge" is deprecated. In v5.0.0 of Express, this option will be ignored, as res.clearCookie will automatically set cookies to expire immediately. Please update your code to omit this option.
//   clearCookie({ maxAge: 60000 }) -> Set-Cookie: session=; Max-Age=60; Path=/; Expires=Sat, 10 Oct 2026 16:20:12 GMT
// Real output (node resp.cjs express):
//   express 5.3.0
//   res.status(99) -> 500 RangeError: Invalid status code: 99. Status code must be greater than 99 and less than 1000.
//   res.status(1000) -> 500 RangeError: Invalid status code: 1000. Status code must be greater than 99 and less than 1000.
//   res.status(200.5) -> 500 TypeError: Invalid status code: 200.5. Status code must be an integer.
//   res.status("201") -> 500 TypeError: Invalid status code: "201". Status code must be an integer.
//   res.status(404) -> 404 ok
//   res.vary() -> 500 TypeError: field argument is required
//   clearCookie({ maxAge: 60000 }) -> Set-Cookie: session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
```

Status codes taken from user input, config files or upstream responses now have to be integers. `res.status(Number(x))` is not enough for `200.5`, so check with `Number.isInteger()`. The Express 4 `clearCookie` line is a real bug in old code: the "cleared" cookie gets `Max-Age=60` and stays in the browser for a minute.

**Example 8 — `app.listen` errors, `app.router`, `res.render` timing, debug namespaces.**

javascript

```
// misc.cjs: app.listen errors, app.router, render timing. node misc.cjs express4 | express
const name = process.argv[2] ?? 'express';
const express = require(name);
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);

  // 1. app.listen on a port that is already taken
  const blocker = net.createServer().listen(0);
  await new Promise((r) => blocker.once('listening', r));
  const port = blocker.address().port;
  await new Promise((done) => {
    const onUncaught = (err) => { console.log(`app.listen: thrown as uncaughtException (${err.code})`); done(); };
    process.once('uncaughtException', onUncaught);
    express().listen(port, (err) => {
      process.removeListener('uncaughtException', onUncaught);
      console.log(`app.listen: callback called with ${err ? err.code : 'no error'}`);
      done();
    });
  });
  blocker.close();

  // 2. app.router
  try { console.log(`app.router: ${typeof express().router}`); }
  catch (err) { console.log(`app.router: throws "${err.message.split('\n')[0]}"`); }

  // 3. res.render / app.render with a view engine that calls back synchronously
  const views = path.join(__dirname, 'fixture', 'views');
  fs.mkdirSync(views, { recursive: true });
  fs.writeFileSync(path.join(views, 'hello.sync'), 'hi');
  const app = express();
  app.set('views', views);
  app.engine('sync', (file, opts, cb) => cb(null, 'rendered'));   // synchronous engine
  const order = [];
  app.render('hello.sync', {}, () => order.push('render callback'));
  order.push('code after app.render()');
  await new Promise((r) => setTimeout(r, 20));
  console.log(`render order: ${order.join(' -> ')}`);
})();

// Real output (node misc.cjs express4):
//   express4 4.22.3
//   app.listen: thrown as uncaughtException (EADDRINUSE)
//   app.router: throws "'app.router' is deprecated!"
//   render order: render callback -> code after app.render()
// Real output (node misc.cjs express):
//   express 5.3.0
//   app.listen: callback called with EADDRINUSE
//   app.router: function
//   render order: code after app.render() -> render callback
```

javascript

```
// debug.cjs: one request, to see which debug namespaces print. node debug.cjs express4 | express
const express = require(process.argv[2] ?? 'express');
const request = require('supertest');
const app = express();
app.get('/x', (req, res) => res.send('ok'));
request(app).get('/x').then((r) => console.log('status', r.status));
```

bash

```
$ DEBUG_HIDE_DATE=1 DEBUG='express:*' node debug.cjs express4 2>&1 | grep -v application
Sat, 10 Oct 2026 16:15:53 GMT express:router use '/' query
Sat, 10 Oct 2026 16:15:53 GMT express:router:layer new '/'
Sat, 10 Oct 2026 16:15:53 GMT express:router use '/' expressInit
Sat, 10 Oct 2026 16:15:53 GMT express:router:layer new '/'
Sat, 10 Oct 2026 16:15:53 GMT express:router:route new '/x'
Sat, 10 Oct 2026 16:15:53 GMT express:router:layer new '/x'
Sat, 10 Oct 2026 16:15:53 GMT express:router:route get '/x'
Sat, 10 Oct 2026 16:15:53 GMT express:router:layer new '/'
Sat, 10 Oct 2026 16:15:53 GMT express:router dispatching GET /x
Sat, 10 Oct 2026 16:15:53 GMT express:router query  : /x
Sat, 10 Oct 2026 16:15:53 GMT express:router expressInit  : /x
status 200
$ DEBUG_HIDE_DATE=1 DEBUG='express:*' node debug.cjs express 2>&1 | grep -v application
status 200
$ DEBUG_HIDE_DATE=1 DEBUG='express:*,router,router:*' node debug.cjs express 2>&1 | grep -v application
router:route new '/x'
router:layer new '/x'
router:route get /x
router:layer new '/'
router dispatching GET /x
status 200
```

(Express 4 bundles debug 2.6.9, which ignores `DEBUG_HIDE_DATE`. The `express:application set …` lines are filtered out in all three runs.) Watch out for the `app.listen` change: code written as `app.listen(port, () => console.log('up'))` now prints nothing and keeps the process alive without a listening server when the port is taken. Always handle the `err` argument.

**Example 9 — the official codemod, run on a small Express 4 app.**

The guide's codemods are published in the codemod.com registry, not on npm. `npm view @expressjs/v5-migration-recipe` returns `404 Not Found`. The older npm package `@expressjs/codemod` (0.0.5) still installs, but it is deprecated. The sample app below has one of each common removed API. It was run from a directory containing `app.js` and a `package.json` with `"express": "^4.21.2"`:

bash

```
$ npm view @expressjs/codemod@0.0.5 deprecated
This package has been deprecated and is no longer maintained. Please use the codemods available on codemod.com instead. To see all official codemods, visit https://app.codemod.com/registry?q=scope%3Aexpressjs.

$ npm install codemod@1.18.3     # the CLI that the guide runs as `npx codemod@latest`
$ npx codemod run @expressjs/v5-migration-recipe --target . --allow-dirty --no-interactive --disable-analytics --no-color
[1/2] 🔍 Resolving package from registry: https://app.codemod.com ...
[2/2] 🏁 Running codemod: @expressjs/v5-migration-recipe
…
  Running @expressjs/back-redirect-deprecated
  Running @expressjs/explicit-request-params
  Running @expressjs/pluralize-method-names
  Running @expressjs/status-send-order
  Running @expressjs/redirect-arg-order
  Running @expressjs/camelcase-sendfile
  Running @expressjs/route-del-to-delete
  Running @expressjs/static-dotfiles
  Running @expressjs/static-mime
  Running @expressjs/sendfile-options
…
Workflow completed in 11.0s

Run summary
  Modified     11
  Unmodified   1

$ diff -u before/ after/
--- before/app.js
+++ after/app.js
@@ -1,33 +1,33 @@
 const express = require('express');
 const app = express();
 
-app.del('/user/:id', (req, res) => {
+app.delete('/user/:id', (req, res) => {
   res.send(`DELETE /user/${req.params.id}`);
 });
 
 app.get('/user', (req, res) => {
-  const id = req.param('id');
-  if (!id) return res.send(400);
-  res.json({ id }, 201);
+  const id = req.params.id;
+  if (!id) return res.sendStatus(400);
+  res.status(201).json({ id });
 });
 
 app.get('/old', (req, res) => {
-  res.redirect('/new', 301);
+  res.redirect(301, '/new');
 });
 
 app.get('/back', (req, res) => {
-  res.redirect('back');
+  res.redirect(req.get("Referrer") || "/");
 });
 
 app.get('/file', (req, res) => {
-  res.sendfile('/srv/files/report.pdf');
+  res.sendFile('/srv/files/report.pdf', { dotfiles: 'allow' /* Express 5: preserve v4 behavior */ });
 });
 
 app.get('/lang', (req, res) => {
-  res.send(req.acceptsLanguage('en') ? 'en' : 'other');
+  res.send(req.acceptsLanguages('en') ? 'en' : 'other');
 });
 
-app.use(express.static('public', { hidden: true }));
+app.use(express.static('public', { dotfiles: 'allow' }));
 
 app.get('/*', (req, res) => res.send('catch-all'));
 
--- before/package.json
+++ after/package.json
@@ -2,6 +2,7 @@
   "name": "sample",
   "version": "1.0.0",
   "dependencies": {
-    "express": "^4.21.2"
+    "express": "^5.0.0",
+    "mime-types": "^3.0.0"
   }
 }
```

The recipe 1.1.0 ran ten bundled codemods plus a `package.json` update. It rewrote every removed API in the sample. Two things are left for you:

bash

```
$ npm install express@5 && node app.js      # the codemod output, unchanged
PathError [TypeError]: Missing parameter name at index 2: /*; visit https://git.new/pathToRegexpError for info
…
$ echo $?
1
```

It did not touch the `'/*'` route string, so the result still crashes on Express 5 at startup (rewrite it as `'/*splat'`, or `'/{*splat}'` to also match `/`). And it did not change anything in a second file that used `'/users/:id?'`, a `req.query` write, `express.urlencoded()` with no options, `router.param([...])`, `res.clearCookie(name, { maxAge: 0 })` and `res.vary()`. Its summary for that file was `Modified 0`. Note also that `sendfile-options` added `dotfiles: 'allow'` to every `res.sendFile` call "to preserve v4 behavior". If a `sendFile` path comes from user input, that reopens dotfiles you may want hidden, so review each one.

**Example 10 — grep patterns for what to review by hand.**

bash

```
#!/usr/bin/env bash
# audit.sh DIR: list Express 4 patterns that break or change in Express 5
dir=${1:-src}
check() { echo "== $1"; grep -rnE --include='*.js' --include='*.cjs' --include='*.mjs' --include='*.ts' "$2" "$dir" || echo "   (none)"; }
check 'removed: app.del, req.param, res.sendfile, singular accepts*' '\bapp\.del\(|req\.param\(|\.sendfile\(|acceptsCharset\(|acceptsEncoding\(|acceptsLanguage\('
check 'old signatures: (body, status), send(status), redirect(url, status), back' '\.(json|jsonp|send)\([^()]*,\s*[0-9]{3}\s*\)|\.send\(\s*[0-9]{3}\s*\)|redirect\(\s*[^,()]+,\s*[0-9]{3}\s*\)|(redirect|location)\(\s*.back.\s*\)'
check 'route strings with * ? + ( [ (path-to-regexp 8)' '\.(get|post|put|patch|delete|all|use|route)\(\s*['"'"'"`][^'"'"'"`]*[*?+([]'
check 'param(): function form, array form, leading colon' '\.param\(\s*(function|\(|\[|['"'"'"]:)'
check 'req.query writes' 'req\.query(\.[A-Za-z_$][A-Za-z0-9_$]*|\[[^]]+\])?\s*=[^=]'
check 'body parsers and static options to review' 'urlencoded\(\s*\)|express\.static\(|static\.mime|\bhidden\s*:|\bfrom\s*:'
check 'clearCookie with maxAge/expires, res.vary(), req.host' 'clearCookie\([^)]*(maxAge|expires)|\.vary\(\s*\)|req\.host\b'
```

bash

```
$ bash audit.sh legacy/src
== removed: app.del, req.param, res.sendfile, singular accepts*
legacy/src/app.js:4:app.del('/user/:id', (req, res) => {
legacy/src/app.js:9:  const id = req.param('id');
legacy/src/app.js:23:  res.sendfile('/srv/files/report.pdf');
legacy/src/app.js:27:  res.send(req.acceptsLanguage('en') ? 'en' : 'other');
== old signatures: (body, status), send(status), redirect(url, status), back
legacy/src/app.js:10:  if (!id) return res.send(400);
legacy/src/app.js:11:  res.json({ id }, 201);
legacy/src/app.js:15:  res.redirect('/new', 301);
legacy/src/app.js:19:  res.redirect('back');
== route strings with * ? + ( [ (path-to-regexp 8)
legacy/src/extra.js:5:router.get('/users/:id?', (req, res) => res.json({ id: req.params.id }));
legacy/src/app.js:32:app.get('/*', (req, res) => res.send('catch-all'));
== param(): function form, array form, leading colon
legacy/src/extra.js:15:router.param(['id', 'page'], (req, res, next) => next());
== req.query writes
legacy/src/extra.js:7:  req.query.page = Number(req.query.page) || 1;
== body parsers and static options to review
legacy/src/extra.js:4:router.use(express.urlencoded());
legacy/src/app.js:30:app.use(express.static('public', { hidden: true }));
== clearCookie with maxAge/expires, res.vary(), req.host
legacy/src/extra.js:11:  res.clearCookie('session', { maxAge: 0 });
legacy/src/extra.js:12:  res.vary();
legacy/src/extra.js:13:  res.send(req.host);
```

`legacy/src` holds the Example 9 sample (`app.js`) plus the second file (`extra.js`). The patterns are deliberately loose. The route-string pattern also flags a literal `?` or `+` that you meant, and the `express.static(` line lists every static mount so you can decide on dotfiles. Grep cannot find code that relies on `req.body` being `{}` or on nested `req.query`/`req.body` objects. Only tests find those.

**Example 11 — edge case: the codemod's `req.param` rewrite changes behaviour.**

The codemod turned `const id = req.param('id')` into `const id = req.params.id` on a route with no `:id` in its path. `req.param()` looked in `req.params`, then `req.body`, then `req.query`. The codemod cannot know which source a given call relied on:

javascript

```
// edge-codemod.cjs: the /user route before the codemod (Express 4) and after it (Express 5)
const request = require('supertest');

const before = require('express4')();
before.get('/user', (req, res) => {
  const id = req.param('id');            // looked in params, then body, then query
  if (!id) return res.send(400);
  res.json({ id }, 201);
});

const after = require('express')();
after.get('/user', (req, res) => {
  const id = req.params.id;              // what the codemod wrote: this route has no :id
  if (!id) return res.sendStatus(400);
  res.status(201).json({ id });
});

const fixed = require('express')();
fixed.get('/user', (req, res) => {
  const id = req.query.id;               // where the value really comes from
  if (!id) return res.sendStatus(400);
  res.status(201).json({ id });
});

process.on('deprecation', () => {});     // silence Express 4's warnings for this demo
(async () => {
  for (const [label, app] of [['before (Express 4.22.3)', before], ['codemod (Express 5.3.0)', after], ['fixed (Express 5.3.0)', fixed]]) {
    const r = await request(app).get('/user?id=5');
    console.log(`${label.padEnd(24)} GET /user?id=5 -> ${r.status} ${r.text}`);
  }
})();

// Real output (Node v24.19.0):
//   before (Express 4.22.3)  GET /user?id=5 -> 201 {"id":"5"}
//   codemod (Express 5.3.0)  GET /user?id=5 -> 400 Bad Request
//   fixed (Express 5.3.0)    GET /user?id=5 -> 201 {"id":"5"}
```

The codemod's output compiles and starts, and every request that used to work now gets 400. For every `req.param(` the codemod rewrote, check the route path. If the parameter is not in the path, it came from the query or the body.

## Common mistakes & gotchas

- **Trusting a green startup.** Removed methods called inside handlers (`req.param`, `res.sendfile`, `req.acceptsLanguage`) only fail when that route runs, and the signature changes (`res.json(obj, 201)`, `res.send(404)`) never fail at all. Exercise every route.
- **Keeping `res.send(statusNumber)`.** Express 5 sends `200` with the JSON body `404`. Use `res.sendStatus(404)`. To send a number as the body, convert it to a string first.
- **Keeping `res.redirect('back')`.** It sends `Location: back`. Use `req.get('Referrer') || '/'`, and validate the referrer if you do not want an open redirect (see lesson 86).
- **`app.param(':id', fn)`.** In Express 5 the callback silently never runs (Example 1).
- **Mutating or assigning `req.query`.** Assigning throws in strict code. Mutations are lost on the next read. Store normalised data in `res.locals`.
- **Assuming `req.body` exists.** Destructuring `undefined` throws `Cannot destructure property … of 'req.body' as it is undefined.` Use `req.body ?? {}`.
- **Relying on nested `?filter[status]=x` or nested form fields.** Both the query parser and `express.urlencoded()` default to flat keys now. Opt in to `extended` explicitly.
- **Losing `/.well-known` (ACME challenges, Apple/Android app links).** It returns 404 after the upgrade. Add a dedicated `dotfiles: 'allow'` mount for that directory only.
- **Passing a status straight from a variable.** `res.status('201')` now throws. Convert and check with `Number.isInteger()`.
- **Ignoring the `app.listen` callback's error.** `EADDRINUSE` no longer crashes the process. It is handed to your callback, and if the callback ignores it, the error disappears.
- **Taking the codemod's output on trust.** It skips route strings and rewrites `req.param()` to `req.params` even where the value came from the query (Example 11).

## Best practices

**The migration checklist, in order:**

1. **Upgrade Node first** to a version Express 5 supports (it requires `>= 18`; use an Active LTS line), and get the test suite green on Express 4.
2. **Fix every Express 4 deprecation warning.** Run the tests and the app, and read stderr for `express deprecated` and `body-parser deprecated`. Each line names a file and line.
3. **Commit, then run** `npx codemod@latest @expressjs/v5-migration-recipe`. Review the diff line by line, especially `req.param` rewrites (check where the value really comes from) and the added `dotfiles: 'allow'` options (keep them only where you really serve dotfiles).
4. **Run `audit.sh` (Example 10)** and fix each hit. Rewrite route strings using lesson 53's table. Replace `router.param` arrays with one call per name. Set `extended` explicitly on `express.urlencoded`. Move `req.query` writes to `res.locals`. Drop `maxAge`/`expires` from `clearCookie`. Give `res.vary()` a field name.
5. **Install `express@5`** (and replace integrations pinned to Express 4, for example `@as-integrations/express5` for Apollo, see lesson 112). Start the app and fix every `PathError`.
6. **Decide on parsing explicitly.** Either keep the new flat defaults, or set `app.set('query parser', 'extended')` and `express.urlencoded({ extended: true })`. Make that choice deliberately.
7. **Guard `req.body`** with `req.body ?? {}` (or validate it, lesson 65).
8. **Check static and file routes:** `/.well-known`, any `sendFile` path that crosses a dot-directory, and tests that compare `Content-Type` for `.js` files.
9. **Handle `err` in the `app.listen` callback,** and switch debug settings to `DEBUG=express:*,router,router:*`.
10. **Delete async wrappers** (`asyncHandler`, `express-async-errors`) once the suite passes. Leave the error middleware in place.
11. **Run the full suite plus a smoke test of every route** (status codes, `Location` headers and response types, not just bodies), then deploy.

Other habits:

- **Upgrade in a branch with both versions installed** (`express4@npm:express@4`) so you can run a failing test against both and see which change caused it.
- **Write the new form even while still on Express 4** wherever it already works there: `res.status(201).json()`, `res.sendStatus()`, `res.redirect(301, url)`, `res.sendFile()`, `acceptsLanguages()`, `express.urlencoded({ extended })`. Then the version bump itself is small.

## ⭐ Interview lens

> **Q: “What is the most important behavioural change in Express 5 for application code?”**  
> A: Rejected promises from handlers and middleware are forwarded to the error middleware as `next(err)`. In Express 4, an `async` handler that throws produces an unhandled rejection, which on Node 15+ crashes the whole process with exit code 1 (or hangs the request if something swallows the rejection). So Express 5 lets you write plain `async` handlers without wrappers. *Trap:* saying Express 4 "just hangs". That was Node ≤ 14 behaviour, or a swallowed rejection.

> **Q: “Your app starts fine on Express 5, but a client reports that creating a user now returns 200 instead of 201. Why?”**  
> A: The code uses a removed signature that fails silently: `res.json(obj, 201)` or `res.send(body, 201)`. Express 5 ignores the second argument. Express 4 honoured it and printed a deprecation warning. Fix it as `res.status(201).json(obj)`. The same class of bug: `res.send(404)` now sends 200 with the body `404`.

> **Q: “Why can't Express 5 validation middleware do `req.query = parsed`?”**  
> A: In Express 5, `req.query` is a getter on the request prototype that parses the query string on each access. There is no setter, so assignment throws in strict mode (ESM) and is ignored in sloppy mode, and mutations are lost on the next read. Put the validated object in `res.locals` (or another property you own).

> **Q: “Does the official codemod do the whole migration?”**  
> A: No. `@expressjs/v5-migration-recipe` rewrites removed APIs and signatures (`app.del`, `req.param`, `res.json(obj, status)`, `res.redirect(url, status)`, `'back'`, `sendfile`, pluralised `accepts*`, `hidden` → `dotfiles`, `express.static.mime`) and bumps `package.json`. It leaves route strings such as `'/*'` alone, so the result can still crash at startup. It does not touch `req.query` writes, parser defaults or `clearCookie` options. And it maps `req.param('id')` to `req.params.id` even when the value came from the query. Review the diff, grep for the rest, and test.

> **Q: “After upgrading, Let's Encrypt renewals fail. What changed?”**  
> A: `express.static` now applies its `dotfiles: 'ignore'` default to dot-directories too, so `/.well-known/acme-challenge/<token>` returns 404. Express 4.22.3 already hid dotfiles themselves (`/.env`) but served files inside dot-directories. Mount the directory explicitly: `app.use('/.well-known', express.static('public/.well-known', { dotfiles: 'allow' }))`.

## Cheat-card

- **Versions:** Express 5.3.0 needs Node ≥ 18. Compare locally with `express4@npm:express@4` (4.22.3).
- **Now throw:** `app.del`, `app.param(fn)`, `router.param(fn | [names])`, `req.param`, `res.sendfile`, `req.acceptsCharset/Encoding/Language`, old route strings (`PathError`).
- **Now silent:** `res.json/jsonp/send(x, status)` → 200. `res.send(404)` → 200 with body `404`. `redirect('back')` → `Location: back`. `app.param(':id')` never runs.
- **Redirect order:** `res.redirect(status, url)`. The old order gives a 500.
- **Async:** a rejection goes to `next(err)` (v5). In v4 it is an unhandled rejection → process exit 1.
- **`req.body`:** `undefined` without a matching parser (v4: `{}`).
- **`req.query`:** a re-parsing getter, `"simple"` parser by default. Validated data goes in `res.locals.validated`.
- **`express.urlencoded()`:** `extended: false` by default. Brotli request bodies are accepted.
- **Static:** dot-directories are ignored too. `/.well-known` needs `dotfiles: 'allow'`. `hidden` → `dotfiles`, `from` → `root`. `.js` is `text/javascript`.
- **`res.status`:** integers 100–999 only. **`res.vary()`** needs a field. **`clearCookie`** ignores `maxAge`/`expires`.
- **`req.host`** keeps the port. **`req.params`** has a null prototype (string paths), wildcards give arrays, unmatched optional keys are omitted.
- **`app.listen(port, cb)`:** `cb(err)` on `EADDRINUSE`. `app.router` is back.
- **Tools:** `npx codemod@latest @expressjs/v5-migration-recipe`, then the grep audit, then the tests.

---

## Learn More

- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Error handling expressjs.com](https://expressjs.com/en/guide/error-handling.html)
- [Express codemods in the codemod.com registry app.codemod.com](https://app.codemod.com/registry)
- [path-to-regexp README github.com](https://github.com/pillarjs/path-to-regexp)
