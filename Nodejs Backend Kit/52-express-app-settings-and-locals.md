---
title: "Express App Settings and Locals"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Express App Settings and Locals

*20 min read · Updated 10 Oct 2026 · Topic 86 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0 (Express 4 comparisons on 4.22.3, requests sent with supertest 7.3.1)

---

## Why it matters

A handful of `app.set(...)` lines decide things that look like they belong to your route code:

- **Who the client is.** `req.ip`, `req.protocol` and `req.hostname` come from the TCP socket or from `X-Forwarded-*` headers, depending on `trust proxy`. Get it wrong behind a load balancer and every client has the balancer's IP, so a rate limiter keyed on `req.ip` puts all users in one bucket. Set it to `true` on a server that is reachable directly and any client can choose its own `req.ip` by sending a header.
- **What `req.query` looks like.** Express 5 changed the default query parser from `"extended"` to `"simple"`, so `?filter[status]=open` is no longer a nested object. Code ported from Express 4 silently reads `undefined`.
- **What the response carries.** `etag`, `x-powered-by` and the `json *` settings change headers and bodies of every response.
- **Which URLs match.** `case sensitive routing` and `strict routing` decide whether `/Users`, `/users` and `/users/` are the same route, and they only work if they are set at the right moment.

`app.locals` and `res.locals` look alike but have different lifetimes. Putting the current user on `app.locals` shows one user's data to another user as soon as two requests overlap. Example 7 shows it happening.

## The concept, simply

Every Express application object has a **settings table**, `app.settings`: a plain object (created with `Object.create(null)`) that maps a name to a value. You write to it with `app.set(name, value)` and read from it with `app.get(name)`. You can store any name you like there (`app.set('title', 'Shop API')`). About a dozen names are **reserved**: Express's own code reads them while it handles a request, so changing them changes behaviour.

`app.get` has two meanings. With **one argument** it is the settings getter: `app.get('etag')` returns `'weak'`. With **a path and one or more handlers** it registers a route for `GET`: `app.get('/users', handler)`. Express checks the number of arguments to decide which one you meant.

`app.enable(name)` is `app.set(name, true)` and `app.disable(name)` is `app.set(name, false)`. `app.enabled(name)` and `app.disabled(name)` return `true` or `false` based on whether the stored value is truthy.

There are two locals objects:

- **`app.locals`** is one object per application. It lives as long as the process. Express passes its properties to every template that `res.render` draws. Use it for values that are the same for every request: the site name, a build id, helper functions.
- **`res.locals`** is a new object for each request. It is discarded with the response. Middleware puts request-specific data on it (the logged-in user, a CSRF token, validated input), and `res.render` passes those to the template as well.

## How it works

1. **`express()` fills in the defaults.** The constructor creates `app.settings` and sets: `x-powered-by` `true`, `etag` `'weak'`, `env` from `NODE_ENV` (or `'development'`), `query parser` `'simple'` (`'extended'` in Express 4; changed in v5), `subdomain offset` `2`, `trust proxy` `false`, `views` `path.resolve('views')` (so `<cwd>/views`), `jsonp callback name` `'callback'`, and `view cache` `true` only when `env` is `'production'`. Every other reserved setting (`case sensitive routing`, `strict routing`, `json spaces`, `json replacer`, `json escape`, `view engine`) starts out `undefined`.
2. **Three settings are compiled.** When you `app.set('etag' | 'query parser' | 'trust proxy', value)`, Express also turns `value` into a function and stores it under a second name: `etag fn`, `query parser fn`, `trust proxy fn`. Request code calls these functions; it never looks at your original value again. That is why one setting can accept a boolean, a string, a number, a list or a function: they all compile into the same kind of function.
3. **Each setting is read at a fixed moment.**
   - `trust proxy fn` is read every time you access `req.ip`, `req.ips`, `req.protocol`, `req.secure`, `req.host` or `req.hostname`.
   - `etag fn` is read by `res.send` (and so by `res.json`) when it sends a body.
   - `json spaces`, `json replacer` and `json escape` are read by every `res.json` call.
   - `x-powered-by` is read once per request when the app starts handling it.
   - `query parser fn` is read every time you access `req.query` in Express 5, because `req.query` is a getter. Express 4 read it once, when the app's router was created.
   - `case sensitive routing` and `strict routing` are read **once**, when the app's router is created. The router is created by the first `app.use`, `app.get`, `app.route` (or any other route method) call. Changing either setting after that has no effect (Example 9).
   - `env` is read at construction for `view cache`, and again by the default error handler for each error.
4. **Mounting links two settings tables.** `app.use('/admin', admin)` emits a `mount` event on `admin`. Express then calls `Object.setPrototypeOf(admin.settings, parent.settings)`. A sub-app therefore inherits a parent setting only where it has **no value of its own**. Because the constructor already gave every sub-app its own `etag`, `query parser`, `x-powered-by`, `env` and `views`, those are not inherited. Settings without a default (`json spaces`, `view engine`, your own names) are inherited. `trust proxy` is a deliberate exception: a sub-app that never set it drops its own default on mount and uses the parent's (Example 8).
5. **Locals are merged at render time.** `res.render(view, opts)` calls `app.render` with `{ ...app.locals, ...res.locals, ...opts }`. So a value passed to `res.render` overrides `res.locals`, which overrides `app.locals`. `app.locals.settings` is set to `app.settings` by the constructor, which is why every template can see a `settings` variable. `res.locals` is created once per request (`Object.create(null)`) by the first app that handles it. A mounted sub-app reuses the same object, so data set in parent middleware is visible in the sub-app. `app.locals` is never inherited: each app has its own.

**`trust proxy` values.** The setting tells Express which addresses belong to proxies you control. `X-Forwarded-For` is a list that each proxy appends to: `client, proxy1, proxy2`. Express (through the `proxy-addr` package) walks the list from the right, starting with the socket's address, and stops at the first address that is **not** trusted. That address becomes `req.ip`. `req.ips` is every address from the client up to (not including) the socket address. When the socket address itself is trusted, `req.protocol` reads `X-Forwarded-Proto` and `req.hostname` reads `X-Forwarded-Host`. The accepted values:

- `false` (default): trust nothing. `req.ip` is the socket address, and `X-Forwarded-*` is ignored.
- `true`: trust every hop. `req.ip` is the left-most address, which the client can write itself.
- a number `n`: trust the `n` hops closest to the server.
- a string, comma-separated string or array of IPs and subnets (`'10.0.0.0/8'`), plus the names `loopback`, `linklocal` and `uniquelocal`.
- a function `(addr, i) => boolean`, called for each hop.

**`etag` values.** An ETag is a short identifier of a response body. A client that cached the body sends it back as `If-None-Match`. When it still matches, Express answers `304 Not Modified` with no body. The default weak tag (`W/"<length in hex>-<base64 SHA-1, first 27 chars>"`) comes from the `etag` package. `'strong'` drops the `W/` prefix, and `false` stops Express adding the header. A function `(body, encoding) => string` computes your own. These settings apply only to bodies sent by `res.send`/`res.json`; `express.static` has its own `etag` option.

**`query parser` values.** `'simple'` uses Node's `node:querystring`: repeated keys become arrays, and brackets stay part of the key. `'extended'` uses the `qs` package: `a[b]=c` becomes `{ a: { b: 'c' } }`. `false` disables parsing, so `req.query` is `{}`. A function receives the raw query string and returns the object.

**`views` and `view engine`.** `views` is the folder, or array of folders, where `res.render` looks for templates. `view engine` is the file extension Express adds when you write `res.render('home')` without one. `app.engine(ext, fn)` registers a function `(filePath, options, callback)` for an extension. Lesson 59 ([Template engines and server-side rendering](59-template-engines-and-server-side-rendering.md)) covers real engines.

**Routing and JSON settings.** `case sensitive routing` makes `/Users` and `/users` different routes. `strict routing` makes `/users` and `/users/` different. `json spaces` and `json replacer` are passed to `JSON.stringify` as its third and second arguments. `json escape` replaces `<`, `>` and `&` in JSON output with `<`, `>` and `&`, so a JSON body that a browser wrongly treats as HTML cannot open a tag. `x-powered-by` adds `X-Powered-By: Express` to every response. Turning it off hides one fingerprint, but it is not a security control.

**`env`.** `app.get('env')` is `process.env.NODE_ENV` at construction time, or `'development'`. With `'production'` Express enables `view cache` and the default error handler sends a generic `Internal Server Error` page instead of the stack trace. With `'test'` the default error handler stops logging errors to stderr (Example 10).

## Code examples

To run the Express 4 comparisons, install both versions side by side: `npm install express@5 express4@npm:express@4 supertest`. The `express4` alias is an ordinary copy of Express 4. Each script below is a complete file: run it with `node <file>`.

**Example 1 — `app.set`, the one-argument `app.get`, and `enable` / `disable`.**

javascript

```
// ex1.cjs: app.set / app.get, enable / disable, and the two meanings of app.get.
const express = require('express');
const request = require('supertest');

const app = express();

app.set('title', 'Shop API');                 // any name works: settings is a plain store
console.log('app.get("title")       ->', app.get('title'));
console.log('app.get("nope")        ->', app.get('nope'));
console.log('app.set returns app    ->', app.set('json spaces', 2) === app);

// Built-in defaults that exist before you set anything
for (const k of ['env', 'etag', 'query parser', 'trust proxy', 'x-powered-by', 'subdomain offset', 'views']) {
  const v = app.get(k);
  console.log(`default ${JSON.stringify(k).padEnd(18)} ->`, k === 'views' ? v.replace(process.cwd(), '<cwd>') : v);
}

app.disable('x-powered-by');                  // same as app.set('x-powered-by', false)
app.enable('case sensitive routing');         // same as app.set('case sensitive routing', true)
console.log('enabled("case sensitive routing") ->', app.enabled('case sensitive routing'));
console.log('disabled("x-powered-by")          ->', app.disabled('x-powered-by'));
console.log('disabled("strict routing")        ->', app.disabled('strict routing'), '(never set = undefined)');

// Two or more arguments: app.get is the GET route method again.
app.get('/title', (req, res) => res.json({ title: req.app.get('title') }));

request(app).get('/title').then((r) => {
  console.log('GET /title ->', r.status, r.headers['x-powered-by'] ?? '(no X-Powered-By)');
  console.log(r.text);
});

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   app.get("title")       -> Shop API
//   app.get("nope")        -> undefined
//   app.set returns app    -> true
//   default "env"              -> development
//   default "etag"             -> weak
//   default "query parser"     -> simple
//   default "trust proxy"      -> false
//   default "x-powered-by"     -> true
//   default "subdomain offset" -> 2
//   default "views"            -> <cwd>/views
//   enabled("case sensitive routing") -> true
//   disabled("x-powered-by")          -> true
//   disabled("strict routing")        -> true (never set = undefined)
//   GET /title -> 200 (no X-Powered-By)
//   {
//     "title": "Shop API"
//   }
```

The settings getter and the route method share a name. `app.get('/title', handler)` has two arguments, so it registers a route, while `app.get('title')` reads the setting. In Express 4 the `query parser` default prints `extended`.

**Example 2 — `trust proxy`: boolean, number, list or subnet, and function.** supertest connects from `127.0.0.1`, and the request claims to have passed through two proxies.

javascript

```
// ex2.cjs: what each "trust proxy" value does to req.ip, req.ips, req.protocol and req.hostname.
// The request really comes from 127.0.0.1 (supertest) but claims a chain of proxies.
const request = require('supertest');

const headers = {
  'X-Forwarded-For': '198.51.100.7, 203.0.113.9, 10.0.0.2', // client, proxy 1, proxy 2 (closest to us)
  'X-Forwarded-Proto': 'https',
  'X-Forwarded-Host': 'shop.example.com',
};

const settings = [
  ['false (default)', false],
  ['true', true],
  ['1', 1],
  ['2', 2],
  ["'loopback'", 'loopback'],
  ["'loopback, 10.0.0.0/8'", 'loopback, 10.0.0.0/8'],
  ['fn: trust 127.0.0.1 only', (ip, hop) => ip === '127.0.0.1'],
];

async function run(pkg, print) {
  const express = require(pkg);
  const rows = [];
  for (const [label, value] of settings) {
    const app = express();
    app.set('trust proxy', value);
    app.get('/', (req, res) => res.json({
      ip: req.ip, ips: req.ips, protocol: req.protocol, secure: req.secure, hostname: req.hostname,
    }));
    const r = await request(app).get('/').set(headers);
    rows.push(r.text);
    if (print) console.log(label.padEnd(26), r.text);
  }
  return rows;
}

(async () => {
  const v5 = await run('express', true);
  const v4 = await run('express4', false);   // npm i express4@npm:express@4
  console.log('Express 4.22.3 gives the same 7 rows:', JSON.stringify(v4) === JSON.stringify(v5));
})();

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   false (default)            {"ip":"127.0.0.1","ips":[],"protocol":"http","secure":false,"hostname":"127.0.0.1"}
//   true                       {"ip":"198.51.100.7","ips":["198.51.100.7","203.0.113.9","10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   1                          {"ip":"10.0.0.2","ips":["10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   2                          {"ip":"203.0.113.9","ips":["203.0.113.9","10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   'loopback'                 {"ip":"10.0.0.2","ips":["10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   'loopback, 10.0.0.0/8'     {"ip":"203.0.113.9","ips":["203.0.113.9","10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   fn: trust 127.0.0.1 only   {"ip":"10.0.0.2","ips":["10.0.0.2"],"protocol":"https","secure":true,"hostname":"shop.example.com"}
//   Express 4.22.3 gives the same 7 rows: true
```

Read the rows against the chain `198.51.100.7, 203.0.113.9, 10.0.0.2` + socket `127.0.0.1`:

1. `false`: headers ignored; `req.hostname` is the `Host` header.
2. `true`: everything trusted, so `req.ip` is the left-most entry, which anyone can type.
3. `1`: trust the socket hop only, so `req.ip` is the next one, `10.0.0.2`.
4. `2`: also trust `10.0.0.2`, so `req.ip` is `203.0.113.9`.
5. `'loopback'` behaves like `1` here because only `127.0.0.1` is in the subnet. Adding `10.0.0.0/8` makes it behave like `2`.
6. The function trusts only `127.0.0.1`, which gives the same result as `'loopback'`.

**Example 3 — `etag`: weak, strong, off, custom, and the 304 it produces.**

javascript

```
// ex3.cjs: the "etag" setting: weak (default), 'strong', false, and a custom function.
const crypto = require('node:crypto');
const request = require('supertest');

const values = [
  ['default', undefined],
  ["'strong'", 'strong'],
  ['false', false],
  ['function', (body, encoding) => '"v1-' + crypto.createHash('sha256').update(body).digest('hex').slice(0, 8) + '"'],
];

async function run(pkg) {
  const express = require(pkg);
  const out = [];
  for (const [label, value] of values) {
    const app = express();
    if (value !== undefined) app.set('etag', value);
    app.get('/doc', (req, res) => res.json({ id: 1, name: 'Ada' }));
    const first = await request(app).get('/doc');
    const etag = first.headers.etag;
    // Send the ETag back: Express compares it (req.fresh) and answers 304 with no body.
    const again = etag ? await request(app).get('/doc').set('If-None-Match', etag) : null;
    out.push(`${label.padEnd(9)} ETag: ${etag ?? '(none)'}  revalidate -> ${again ? again.status + ' body=' + JSON.stringify(again.text) : 'n/a'}`);
  }
  return out;
}

(async () => {
  const v5 = await run('express');
  console.log(v5.join('\n'));
  const v4 = await run('express4');
  console.log('Express 4.22.3 identical:', JSON.stringify(v4) === JSON.stringify(v5));
})();

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   default   ETag: W/"15-Uz5tLeD/GUuik8TTq8kwMsgQWKc"  revalidate -> 304 body=""
//   'strong'  ETag: "15-Uz5tLeD/GUuik8TTq8kwMsgQWKc"  revalidate -> 304 body=""
//   false     ETag: (none)  revalidate -> n/a
//   function  ETag: "v1-0e576c3b"  revalidate -> 304 body=""
//   Express 4.22.3 identical: true
```

`15` is the body length in hex (21 bytes: `{"id":1,"name":"Ada"}`). The 304 response has an empty body: Express compared `If-None-Match` with the ETag it had just computed and dropped the body.

**Example 4 — `query parser`: Express 5 "simple" vs Express 4 "extended".**

javascript

```
// ex4.cjs: the "query parser" setting on Express 5 and Express 4.
const request = require('supertest');
const QS = '/s?a[b]=c&tag=x&tag=y&q=caf%C3%A9';

const values = [
  ['default', undefined],
  ["'simple'", 'simple'],
  ["'extended'", 'extended'],
  ['false', false],
  ['function', (str) => Object.fromEntries(new URLSearchParams(str))], // last value wins
];

async function run(pkg) {
  const express = require(pkg);
  console.log(`--- ${pkg} ${require(pkg + '/package.json').version}`);
  for (const [label, value] of values) {
    const app = express();
    if (value !== undefined) app.set('query parser', value);
    app.get('/s', (req, res) => res.json(req.query));
    const r = await request(app).get(QS);
    console.log(label.padEnd(11), r.text);
  }
}

run('express').then(() => run('express4'));

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   --- express 5.3.0
//   default     {"a[b]":"c","tag":["x","y"],"q":"café"}
//   'simple'    {"a[b]":"c","tag":["x","y"],"q":"café"}
//   'extended'  {"a":{"b":"c"},"tag":["x","y"],"q":"café"}
//   false       {}
//   function    {"a[b]":"c","tag":"y","q":"café"}
//   --- express4 4.22.3
//   default     {"a":{"b":"c"},"tag":["x","y"],"q":"café"}
//   'simple'    {"a[b]":"c","tag":["x","y"],"q":"café"}
//   'extended'  {"a":{"b":"c"},"tag":["x","y"],"q":"café"}
//   false       {}
//   function    {"a[b]":"c","tag":"y","q":"café"}
```

Only the `default` row differs between the versions. Set `query parser` explicitly and the two versions agree. That is the simplest way to make ported code behave the same.

**Example 5 — `views`, `view engine`, and how `app.locals` and `res.locals` reach the template.**

javascript

```
// ex5.cjs: "views", "view engine", app.locals and res.locals flowing into res.render.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

// A throwaway views folder with one template.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'views-'));
fs.writeFileSync(path.join(dir, 'home.tpl'), '{{siteName}} | user={{user}} | title={{title}}');

const app = express();
app.set('views', dir);            // where res.render looks (default: <cwd>/views)
app.set('view engine', 'tpl');    // extension to add when you write res.render('home')

// A 6-line engine: replace {{key}} with options[key]. Real apps use EJS, Pug, etc. (lesson 59).
app.engine('tpl', (file, options, cb) => {
  fs.readFile(file, 'utf8', (err, src) => {
    if (err) return cb(err);
    console.log('engine got keys:', Object.keys(options).join(', '));
    cb(null, src.replace(/\{\{(\w+)\}\}/g, (_, k) => String(options[k])));
  });
});

app.locals.siteName = 'Shop';     // app-wide: lives as long as the app
app.use((req, res, next) => {     // per request: set in middleware, gone after the response
  res.locals.user = req.get('X-User') ?? 'guest';
  next();
});
app.get('/', (req, res) => res.render('home', { title: 'Home' })); // render-call locals win over both

(async () => {
  const r = await request(app).get('/').set('X-User', 'ada');
  console.log(r.status, r.headers['content-type'], '->', r.text);
  const r2 = await request(app).get('/');
  console.log(r2.status, '->', r2.text);
  fs.rmSync(dir, { recursive: true });
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   engine got keys: settings, siteName, user, title, _locals, cache
//   200 text/html; charset=utf-8 -> Shop | user=ada | title=Home
//   engine got keys: settings, siteName, user, title, _locals, cache
//   200 -> Shop | user=guest | title=Home
```

The engine's `options` object is the merge from step 5: `settings` and `siteName` from `app.locals`, `user` from `res.locals`, `title` from the `res.render` call, plus `_locals` (the `res.locals` object itself) and `cache` (the `view cache` setting).

**Example 6 — `case sensitive routing`, `strict routing`, `x-powered-by`, `json spaces`, `json replacer` and `json escape`.**

javascript

```
// ex6.cjs: routing and JSON settings. Routing settings go BEFORE the first route.
const request = require('supertest');

async function run(pkg) {
  const express = require(pkg);
  const out = [];

  const loose = express();                      // defaults: case-insensitive, non-strict
  loose.get('/Users', (req, res) => res.send('hit'));
  const strict = express();
  strict.set('case sensitive routing', true);   // set first...
  strict.set('strict routing', true);
  strict.get('/Users', (req, res) => res.send('hit'));  // ...then define routes
  for (const p of ['/Users', '/users', '/Users/']) {
    const a = await request(loose).get(p), b = await request(strict).get(p);
    out.push(`${p.padEnd(8)} default -> ${a.status}   case+strict -> ${b.status}`);
  }

  const j = express();
  j.disable('x-powered-by');
  j.set('json spaces', 2);
  j.set('json replacer', (key, value) => (key === 'password' ? undefined : value));
  j.set('json escape', true);
  j.get('/u', (req, res) => res.json({ name: '<b>Ada</b> & co', password: 'hunter2' }));
  const r = await request(j).get('/u');
  out.push(`X-Powered-By: ${r.headers['x-powered-by'] ?? '(absent)'}`, r.text);

  const plain = await request(express().get('/u', (req, res) => res.json({ a: 1 }))).get('/u');
  out.push(`default app X-Powered-By: ${plain.headers['x-powered-by']}  body: ${plain.text}`);
  return out;
}

(async () => {
  const v5 = await run('express');
  console.log(v5.join('\n'));
  console.log('Express 4.22.3 identical:', JSON.stringify(await run('express4')) === JSON.stringify(v5));
})();

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   /Users   default -> 200   case+strict -> 200
//   /users   default -> 200   case+strict -> 404
//   /Users/  default -> 200   case+strict -> 404
//   X-Powered-By: (absent)
//   {
//     "name": "\u003cb\u003eAda\u003c/b\u003e \u0026 co"
//   }
//   default app X-Powered-By: Express  body: {"a":1}
//   Express 4.22.3 identical: true
```

The replacer removed `password` before serialisation, `json spaces: 2` indented the output, and `json escape` turned `<`, `>` and `&` into `<`, `>` and `&`. A JSON client decodes them back to the same characters.

**Example 7 — `app.locals` vs `res.locals`: the leak with two concurrent requests.** Alice's request starts first and waits 50 ms (as if it were querying a database). Bob's request arrives 10 ms later and finishes at once.

javascript

```
// ex7.cjs: per-request data on app.locals leaks between concurrent requests.
const express = require('express');
const request = require('supertest');
const { setTimeout: sleep } = require('node:timers/promises');

const app = express();

// WRONG: app.locals is one object shared by every request.
app.get('/bad', async (req, res) => {
  app.locals.user = req.get('X-User');   // request A writes "alice", then request B overwrites with "bob"
  await sleep(Number(req.get('X-Delay'))); // any await: a DB query, a fetch...
  res.json({ asked: req.get('X-User'), got: app.locals.user });
});

// RIGHT: res.locals is a new object for each request.
app.get('/good', async (req, res) => {
  res.locals.user = req.get('X-User');
  await sleep(Number(req.get('X-Delay')));
  res.json({ asked: req.get('X-User'), got: res.locals.user });
});

(async () => {
  for (const path of ['/bad', '/good']) {
    // alice starts first but waits longer; bob arrives 10 ms later
    const [a, b] = await Promise.all([
      request(app).get(path).set({ 'X-User': 'alice', 'X-Delay': '50' }),
      sleep(10).then(() => request(app).get(path).set({ 'X-User': 'bob', 'X-Delay': '0' })),
    ]);
    console.log(path.padEnd(5), a.text, b.text);
  }
  console.log('app.locals.user after the run:', app.locals.user);
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   /bad  {"asked":"alice","got":"bob"} {"asked":"bob","got":"bob"}
//   /good {"asked":"alice","got":"alice"} {"asked":"bob","got":"bob"}
//   app.locals.user after the run: bob
```

Here is the order of events on `/bad`:

1. Alice's handler sets `app.locals.user = 'alice'` and awaits.
2. Bob's handler runs during that wait and overwrites the same property with `'bob'`.
3. Alice's handler resumes and reads `'bob'`.

Nothing crashed, and every response was a 200. The bug only shows up when requests overlap, and the value also stays in `app.locals` after both requests end.

**Example 8 — edge case: what a mounted sub-app inherits.**

javascript

```
// ex8.cjs: which parent settings does a mounted sub-app inherit?
const request = require('supertest');

async function run(pkg) {
  const express = require(pkg);
  const parent = express();
  parent.set('json spaces', 2);              // no default  -> inherited
  parent.set('title', 'Shop');               // no default  -> inherited
  parent.set('trust proxy', 'loopback');     // has a default, but inherited on purpose (back-compat)
  parent.set('query parser', 'extended');    // has a default -> NOT inherited
  parent.set('etag', false);                 // has a default -> NOT inherited
  parent.disable('x-powered-by');            // has a default -> NOT inherited
  parent.enable('case sensitive routing');   // inherited as a value, but too late for the sub-app's router
  parent.locals.siteName = 'Shop';           // app.locals is never inherited

  const admin = express();
  admin.get('/Stats', (req, res) => {
    res.json({
      'json spaces': req.app.get('json spaces'),
      title: req.app.get('title'),
      ip: req.ip,                            // 10.0.0.2 only if trust proxy was inherited
      query: req.query,                      // nested only if 'extended' was inherited
      caseSensitive: req.app.get('case sensitive routing'),
      siteName: req.app.locals.siteName ?? null,
    });
  });
  const before = admin.get('json spaces');
  parent.use('/admin', admin);               // emits 'mount': admin.settings now has parent.settings as prototype
  console.log(`--- ${pkg}: admin.get('json spaces') before mount = ${before}, after = ${admin.get('json spaces')}`);

  const r = await request(parent).get('/admin/Stats?f[x]=1').set('X-Forwarded-For', '10.0.0.2');
  console.log(r.text);
  console.log('ETag:', r.headers.etag ?? '(none)', '| X-Powered-By:', r.headers['x-powered-by'] ?? '(none)');
  console.log('GET /admin/stats (lower case) ->', (await request(parent).get('/admin/stats')).status);
}

run('express').then(() => run('express4'));

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   --- express: admin.get('json spaces') before mount = undefined, after = 2
//   {
//     "json spaces": 2,
//     "title": "Shop",
//     "ip": "10.0.0.2",
//     "query": {
//       "f[x]": "1"
//     },
//     "caseSensitive": true,
//     "siteName": null
//   }
//   ETag: W/"8c-ypdnHclFN4R2TneMZfU2gDC7Qro" | X-Powered-By: Express
//   GET /admin/stats (lower case) -> 200
//   --- express4: admin.get('json spaces') before mount = undefined, after = 2
//   {
//     "json spaces": 2,
//     "title": "Shop",
//     "ip": "10.0.0.2",
//     "query": {
//       "f": {
//         "x": "1"
//       }
//     },
//     "caseSensitive": true,
//     "siteName": null
//   }
//   ETag: W/"9c-/5R2ElB/O2NVCTsZShZ4iaTPvNQ" | X-Powered-By: Express
//   GET /admin/stats (lower case) -> 200
```

What the output shows, for both versions:

- **Inherited:** `json spaces`, `title` and `trust proxy`. `req.ip` is `10.0.0.2`, so the sub-app used the parent's `'loopback'` setting. Before the mount the sub-app's `json spaces` was `undefined`; afterwards it reads `2` through the prototype link.
- **Not inherited:** `etag` (the sub-app still sent a weak ETag), `x-powered-by` (the parent disabled it, but the sub-app's own default `true` added the header) and `query parser` (Express 5 shows the sub-app's own `'simple'`; on Express 4 both apps use the default `'extended'`, so that row cannot show the difference).
- **Inherited but useless:** `case sensitive routing` reads `true` inside the sub-app, yet `/admin/stats` still matched `/Stats`. The sub-app's router had already been created by `admin.get('/Stats', …)`, before the mount, with the sub-app's own value (`undefined`). The expressjs.com settings table says sub-apps inherit this setting. That is true of the stored value, not of routing. Set routing options on each sub-app (or each `express.Router({ caseSensitive: true, strict: true })`) before defining its routes.
- **`app.locals`:** `siteName` is `null`, because each app has its own `app.locals`.

**Example 9 — edge case: a setting changed after the first route.**

javascript

```
// ex9.cjs: settings changed AFTER the first route. Which ones still take effect?
const request = require('supertest');

async function run(pkg) {
  const express = require(pkg);
  const app = express();
  app.get('/Users', (req, res) => res.json({ query: req.query })); // first route: the router is created here

  // Now change three settings, too late or not:
  app.set('case sensitive routing', true);  // read once, when the router was created
  app.set('strict routing', true);          // read once, when the router was created
  app.set('query parser', false);           // Express 5 reads it per request; Express 4 read it once

  const a = await request(app).get('/users?f[x]=1');   // lower-case path, trailing-slash-free
  const b = await request(app).get('/Users/?f[x]=1');  // trailing slash
  console.log(`${pkg.padEnd(8)} GET /users -> ${a.status} ${a.text} | GET /Users/ -> ${b.status} ${b.text}`);
}

run('express').then(() => run('express4'));

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   express  GET /users -> 200 {"query":{}} | GET /Users/ -> 200 {"query":{}}
//   express4 GET /users -> 200 {"query":{"f":{"x":"1"}}} | GET /Users/ -> 200 {"query":{"f":{"x":"1"}}}
```

Both versions ignore the late routing settings: `/users` and `/Users/` still match `/Users`. Only Express 5 honours the late `query parser`, because its `req.query` getter reads the setting on every access; Express 4 had already put a parser built from the old setting into the router. Put all `app.set` calls before the first `app.use` or route.

**Example 10 — `env` / `NODE_ENV`: view cache and the default error handler.**

javascript

```
// ex10.cjs: what NODE_ENV changes. The script re-runs itself with three NODE_ENV values.
const { spawnSync } = require('node:child_process');

if (process.argv[2] === 'child') {
  const express = require(process.argv[3]);
  const request = require('supertest');
  const app = express();
  app.get('/boom', () => { throw new Error('db down'); });  // no error handler of our own
  request(app).get('/boom').then((r) => {
    console.log(JSON.stringify({
      env: app.get('env'),
      viewCache: app.enabled('view cache'),
      status: r.status,
      stackInBody: r.text.includes('at '),                // the default handler prints err.stack?
      title: r.text.match(/<pre>([^<&]*)/)[1].trim(),
    }));
  });
} else {
  for (const pkg of ['express', 'express4']) {
    for (const NODE_ENV of [undefined, 'production', 'test']) {
      const env = { ...process.env };
      if (NODE_ENV) env.NODE_ENV = NODE_ENV; else delete env.NODE_ENV;
      const p = spawnSync(process.execPath, [__filename, 'child', pkg], { env, encoding: 'utf8' });
      const logged = p.stderr.trim().split('\n')[0] || '(nothing)';
      console.log(`${pkg.padEnd(8)} NODE_ENV=${(NODE_ENV ?? '(unset)').padEnd(10)} ${p.stdout.trim()}  stderr: ${logged}`);
    }
  }
}

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   express  NODE_ENV=(unset)    {"env":"development","viewCache":false,"status":500,"stackInBody":true,"title":"Error: db down"}  stderr: Error: db down
//   express  NODE_ENV=production {"env":"production","viewCache":true,"status":500,"stackInBody":false,"title":"Internal Server Error"}  stderr: Error: db down
//   express  NODE_ENV=test       {"env":"test","viewCache":false,"status":500,"stackInBody":true,"title":"Error: db down"}  stderr: (nothing)
//   express4 NODE_ENV=(unset)    {"env":"development","viewCache":false,"status":500,"stackInBody":true,"title":"Error: db down"}  stderr: Error: db down
//   express4 NODE_ENV=production {"env":"production","viewCache":true,"status":500,"stackInBody":false,"title":"Internal Server Error"}  stderr: Error: db down
//   express4 NODE_ENV=test       {"env":"test","viewCache":false,"status":500,"stackInBody":true,"title":"Error: db down"}  stderr: (nothing)
```

With `NODE_ENV=production` the default 500 page hides the stack and `view cache` is on. With `test`, Express stops writing the error to stderr. In every mode the error still reaches your own error handler if you have one (lesson 50). The two versions behave the same here.

## Common mistakes & gotchas

- **`trust proxy` set to `true` on a server reachable without the proxy.** The client writes `X-Forwarded-For: 1.2.3.4` and `req.ip` becomes `1.2.3.4`. Rate limits, audit logs and IP allow-lists then trust a value the attacker chose. Use the hop count or the proxy's subnet.
- **`trust proxy` left at `false` behind a load balancer.** Every `req.ip` is the balancer's address and `req.protocol` is `http` even for HTTPS clients, so `secure` cookies and HTTPS redirects misbehave.
- **Porting Express 4 code that reads nested query objects.** Express 5's default `'simple'` parser gives `{ 'filter[status]': 'open' }`. Set `app.set('query parser', 'extended')` explicitly if you rely on brackets (lesson 48).
- **Routing settings after the first route.** `case sensitive routing` and `strict routing` are read when the router is created, so setting them after the first `app.use` or `app.get` does nothing (Example 9).
- **Assuming a sub-app inherits everything.** Settings that have defaults (`etag`, `x-powered-by`, `query parser`) are not inherited. `app.disable('x-powered-by')` on the parent does not remove the header from routes inside a mounted sub-app (Example 8).
- **Per-request data on `app.locals`.** It is shared by every request, so concurrent requests overwrite each other (Example 7). Use `res.locals`.
- **Calling `app.get('/path')` with one argument and expecting a route.** One argument means "read the setting named `/path`". It returns `undefined` and registers nothing.
- **Expecting `etag: false` to affect static files.** `express.static` has its own `etag` option. The `etag` setting covers `res.send`/`res.json` only.

## Best practices

- **Put every `app.set` at the top of the file that creates the app**, before the first `app.use` or route. Routing settings must be set there, and reading the configuration in one place is easier.
- **Set `trust proxy` to exactly your proxy topology:** a hop count (`1` for a single load balancer) or the proxy subnets. Never `true` unless the app is unreachable except through the proxy.
- **Set `query parser` explicitly** (`'simple'` or `'extended'`), so the behaviour does not depend on the Express major version.
- **Keep `app.locals` for constants** (site name, asset version, formatting helpers) and put anything derived from the request on `res.locals`.
- **Configure each sub-app or Router itself** for routing options and for `x-powered-by`. Don't rely on inheritance for settings that have defaults.
- **Set `NODE_ENV=production` in production.** Without it, the default error handler sends stack traces to clients.
- **Use your own setting names sparingly.** `app.set('title', …)` works, but a config module that you import is easier to type-check and test.

## ⭐ Interview lens

> **Q: “What does `app.get('trust proxy')` return, and how is that different from `app.get('/x', fn)`?”**  
> A: With one argument `app.get` reads the settings table, so it returns the stored value (`false` by default). With a path and a handler it registers a `GET` route. Express decides by the argument count. *Trap:* `app.get('/x')` with no handler is a settings read that returns `undefined`.

> **Q: “Your API runs behind one AWS load balancer and `req.ip` is always 10.x. What do you change, and why not `true`?”**  
> A: `app.set('trust proxy', 1)`, or the balancer's subnet. Express then skips the one trusted hop and takes the next address from `X-Forwarded-For`, and `req.protocol` reads `X-Forwarded-Proto`. `true` trusts every hop, so the left-most address wins, and a client can put any value there.

> **Q: “What is the difference between `app.locals` and `res.locals`?”**  
> A: `app.locals` is one object per app, kept for the life of the process and merged into every render. `res.locals` is created for each request and dropped with the response. `res.render` merges `app.locals`, then `res.locals`, then the render options, with later values winning. Request data on `app.locals` leaks between concurrent requests.

> **Q: “A team ports an Express 4 app to 5 and `req.query.filter.status` throws. Why?”**  
> A: Express 5's default query parser is `'simple'` (Node's `querystring`), so `filter[status]=open` stays a flat key `'filter[status]'` and `req.query.filter` is `undefined`. Express 4 defaulted to `'extended'` (`qs`). Fix: `app.set('query parser', 'extended')` before the routes, or change the URL format.

> **Q: “Does a sub-app mounted with `app.use` inherit the parent's settings?”**  
> A: Only where it has no value of its own: Express links the sub-app's settings to the parent's through the prototype chain on mount. Settings with defaults (`etag`, `x-powered-by`, `query parser`) are already set on the sub-app, so they are not inherited; `trust proxy` is the documented exception. Routing options are read when the sub-app's router is created, which is usually before the mount.

## Cheat-card

- **`app.set(name, value)`** writes `app.settings`; **`app.get(name)`** (one argument) reads it; `app.get(path, fn)` is a route.
- **`app.enable` / `app.disable`** = set `true` / `false`; **`app.enabled` / `app.disabled`** test truthiness.
- **Defaults:** `x-powered-by` true, `etag` `'weak'`, `env` NODE_ENV or `'development'`, `query parser` `'simple'` (v4: `'extended'`), `subdomain offset` 2, `trust proxy` false, `views` `<cwd>/views`.
- **`trust proxy`:** `false` / `true` / hop count / IPs, subnets, `loopback` / function. Affects `req.ip`, `ips`, `protocol`, `secure`, `hostname`.
- **`etag`:** `'weak'` (default) / `'strong'` / `false` / `(body, encoding) => tag`; `res.send` only, not `express.static`.
- **`query parser`:** `'simple'` (flat), `'extended'` (nested, `qs`), `false` (`{}`), or a function. v5 reads it per access; v4 once.
- **Routing settings** (`case sensitive routing`, `strict routing`) must be set before the first route.
- **JSON:** `json spaces`, `json replacer`, `json escape` (escapes `<` `>` `&`).
- **Locals:** `app.locals` per app, permanent; `res.locals` per request. Render merge: app → res → options.
- **Sub-apps** inherit only settings they have not set themselves; `trust proxy` is inherited anyway; `app.locals` never.
- **`NODE_ENV=production`:** `view cache` on, no stack trace in the default 500 page; `test`: no error logging.

---

## Learn More

- [Application settings (app.set) expressjs.com](https://expressjs.com/en/5x/api/application)
- [Express behind proxies expressjs.com](https://expressjs.com/en/guide/behind-proxies.html)
- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Using template engines with Express expressjs.com](https://expressjs.com/en/guide/using-template-engines.html)
- [Production best practices: performance and reliability expressjs.com](https://expressjs.com/en/advanced/best-practice-performance.html)
- [proxy-addr github.com](https://github.com/jshttp/proxy-addr)
- [etag github.com](https://github.com/jshttp/etag)
