---
title: "Express Routing Extras"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Express Routing Extras

*16 min read · Updated 10 Oct 2026 · Topic 93 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0 (Express 4.22.3 for the comparisons; supertest 7.3.1)

---

## Say it in 30 seconds

Express turns a route string into a regular expression with a library called path-to-regexp, then walks those patterns from top to bottom. Express 5 uses a stricter version of that library, so an old optional marker such as a question mark throws when the app starts, and you write the optional part in braces instead. Parameter callbacks, mounted routers, and two skip commands, one for the rest of the current route and one for the rest of the current router, exist so a large API can share work and still know which part of the URL it is looking at. The trade-off is that each router sees only the parameters it captured itself, unless you opt in to merging them.

## Why it matters

Lesson 48 covers the routing you write every day: `app.get('/users/:id')`, `req.query`, and one Router per resource. Real code also uses the less common parts, and those are the parts Express 5 changed.

- Path strings from Express 4 now throw at startup. `'/users/:id?'`, `'/files/*'`, and `'/user/:id(\\d+)'` were legal in Express 4. In Express 5 the same line throws a `PathError` before the app serves a request.
- The new strings fail quietly on Express 4. Copy `'/files/*splat'` into an Express 4 app and it accepts the route, then answers 404 for the URLs you meant.
- A router mounted at `/users/:userId/posts` does not see `:userId` unless it was created with `mergeParams: true`.
- Inside a mounted router, `req.url` has the mount path removed. Logging or redirecting to `req.url` sends the wrong path.

This lesson covers `app.param`, RegExp routes, optional segments, the Express 5 path syntax, `mergeParams`, `app.all`, how mount paths are stripped, and `next('route')` against `next('router')`.

## The concept, simply

A route path is a small pattern language. Express hands the string to path-to-regexp, which compiles it into a regular expression plus a list of parameter names. Express 4.22.3 uses path-to-regexp 0.1.13. Express 5.3.0 uses the separate router package 2.2.0, which uses path-to-regexp 8.4.2.

bash

```
$ npm ls path-to-regexp
…
├─┬ express@5.3.0
│ └─┬ router@2.2.0
│   └── path-to-regexp@8.4.2
└─┬ express4@npm:express@4.22.3
  └── path-to-regexp@0.1.13
```

Version 8 has a smaller pattern language than 0.1.

- `:name` still matches one path segment.
- `*name`, a named wildcard, matches one or more whole segments. Its value is an array of segments, not a string.
- Braces mark an optional part. `'/users{/:id}'` matches both `/users` and `/users/7`.
- The characters `( ) [ ] ? + !` are reserved. They throw if they appear unescaped. That removes Express 4's `?` for optional, `+` for repeat, `*` for an unnamed wildcard, and parentheses for an inline regular expression.

If a string is not enough, pass a real `RegExp`, or an array of paths.

Three more tools sit on the patterns. `app.param(name, fn)` runs `fn` before the handlers whenever a route with that `:name` matches. It usually loads the record for an id. `mergeParams` is an option on `express.Router()`. With it, a child router can read parameters the parent's mount path captured. `next('route')` and `next('router')` are the two exits that are not errors. `next('route')` skips the rest of the current route. `next('router')` leaves the current router.

## How it works

When a request arrives, Express walks the stack of layers.

1. **Match the path.** Each layer holds the regex compiled when you called `app.get` or `app.use`. A route layer must match the whole path. A `use` layer only has to match a prefix that ends on a segment boundary.
2. **Collect parameters.** Capture groups become `req.params`. On Express 5, `req.params` for a string path is an object with a null prototype. A wildcard gives an array. An optional group that did not match leaves its key out. On Express 4 the key was present with the value `undefined`.
3. **Run param callbacks.** Before the first handler of a matched route, Express runs each `app.param` or `router.param` callback on this router for the parameters in that route. The callback receives `(req, res, next, value, name)`. Express remembers which parameters it has already processed in this request. A later route with the same parameter and the same value does not run the callback again.
4. **Run the handlers.** `next()` moves to the next handler or layer. `next('route')` skips the remaining handlers of the current route. It works only inside `app.METHOD`, `router.METHOD`, or `app.all`. `next('router')` skips the rest of the current router and resumes in the parent. Any other argument is an error.
5. **Descend into routers.** For a `use` layer that holds a Router, Express strips the matched prefix and calls the router with the shorter URL.

**Mount paths are stripped, then restored.** When `app.use('/api', api)` matches `/api/orgs/acme/users/42?tab=posts`, Express sets `req.baseUrl` to `'/api'` and rewrites `req.url` to `'/orgs/acme/users/42?tab=posts'`. `req.path` is the pathname part of that rewritten URL. A nested mount does it again, so inside the users router you see `baseUrl` of `'/api/orgs/acme/users'`, with the real parameter value filled in, and `path` of `'/42'`. `req.originalUrl` is never rewritten. If the router finishes without responding, Express puts `req.url` and `req.baseUrl` back before the next app-level layer. Example 6 shows the `after` line. Routes inside a router are written relative to the mount. `router.get('/:id')` answers `GET /api/users/42` when the router is mounted at `/api/users`.

![Main app mounting usersRouter at /api/users and ordersRouter at /api/orders, with router.get('/:id') inside usersRouter answering GET /api/users/42](assets/i32_02_bfe22857.svg)
*Figure: Mounting Routers on a base path. Look at: `app.use('/api/users', usersRouter)` plus `router.get('/:id')` producing `GET /api/users/42`. Express removes the `/api/users` prefix before the router matches `/:id`.*

**Why a child cannot see the parent's parameters by default.** Each router builds `req.params` from its own match. The mount path `'/users/:userId/posts'` is matched by the parent's layer, so `userId` is in the parent's params. When the child runs, it replaces `req.params` with what its route captured. `express.Router({ mergeParams: true })` tells the child to start from the parent's params and add its own. If both use the same name, the child's value wins.

**Why old patterns throw on Express 5.** path-to-regexp 8 rejects a reserved character it does not expect. The error is a `PathError`, a subclass of `TypeError`, thrown while you register the route. The message names the character and the index, for example `Unexpected ? at index 10: /users/:id?`. The replacements are:

| Express 4 string | Express 5 string | Note |
|---|---|---|
| `'/users/:id?'` | `'/users{/:id}'` | the braces wrap the slash too |
| `'/:file.:ext?'` | `'/:file{.:ext}'` | unmatched `ext` is left out of `req.params` |
| `'/files/*'` (value in `req.params[0]`, a string) | `'/files/*splat'` (value in `req.params.splat`, an array) | `'/files{/*splat}'` also matches `/files` |
| `'/user/:id(\\d+)'` | `/^\/user\/(\d+)$/` (a RegExp) or validate in the handler | no inline regex in strings |
| `'/[discussion\|page]/:slug'` | `['/discussion/:slug', '/page/:slug']` | an array of paths |
| `'/ab?cd'`, `'/ab+cd'` | list the literal paths, or use a RegExp | `?` and `+` are reserved |
| a literal `(`, `)`, `[`, `]`, `?`, `+`, `!` | escape it: `'/price\\(usd\\)'` | backslash in the JS string |

Parameter names can be any valid JavaScript identifier, or a quoted string such as `:"user-id"`.

## Code examples

**Example 1 — the Express 5 path syntax: named wildcards, braces and quoted names.**

javascript

```
// ex1-syntax.cjs: Express 5 path syntax, one pattern at a time
const express = require('express');
const request = require('supertest');

const cases = [
  ['/files/*splat',   ['/files', '/files/a', '/files/a/b/c.txt']],
  ['/files{/*splat}', ['/files', '/files/a/b']],
  ['/users{/:id}',    ['/users', '/users/7']],
  ['/:file{.:ext}',   ['/image', '/image.png', '/archive.tar.gz']],
  ['/q/:"user-id"',   ['/q/u-1']],
];

(async () => {
  for (const [pattern, urls] of cases) {
    const app = express();
    app.get(pattern, (req, res) => res.json(req.params));
    for (const url of urls) {
      const r = await request(app).get(url);
      console.log(pattern.padEnd(16), url.padEnd(18), r.status, r.status === 200 ? r.text : '');
    }
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   /files/*splat    /files             404
//   /files/*splat    /files/a           200 {"splat":["a"]}
//   /files/*splat    /files/a/b/c.txt   200 {"splat":["a","b","c.txt"]}
//   /files{/*splat}  /files             200 {}
//   /files{/*splat}  /files/a/b         200 {"splat":["a","b"]}
//   /users{/:id}     /users             200 {}
//   /users{/:id}     /users/7           200 {"id":"7"}
//   /:file{.:ext}    /image             200 {"file":"image"}
//   /:file{.:ext}    /image.png         200 {"file":"image","ext":"png"}
//   /:file{.:ext}    /archive.tar.gz    200 {"file":"archive.tar","ext":"gz"}
//   /q/:"user-id"    /q/u-1             200 {"user-id":"u-1"}
```

`/files/*splat` does not match `/files` itself, because a wildcard needs at least one segment. Wrap it in braces to make it optional. The wildcard value is an array, so use `req.params.splat.join('/')` if you need the string form.

**Example 2 — Express 4 patterns: accepted by Express 4, a `PathError` in Express 5.**

javascript

```
// ex2-old-patterns.cjs: node ex2-old-patterns.cjs express4   (or: express)
const name = process.argv[2] ?? 'express';
const express = require(name);
console.log(`${name} ${require(`${name}/package.json`).version}`);

const old = ['/users/:id?', '/files/*', '/:file.:ext?', '/user/:id(\\d+)', '/ab?cd', '/ab+cd', '/[discussion|page]/:slug', '/wow!'];
for (const pattern of old) {
  const app = express();
  try {
    app.get(pattern, (req, res) => res.end());
    console.log('accepted  ', pattern);
  } catch (err) {
    console.log('THROWS    ', pattern, '->', `${err.constructor.name}: ${err.message}`);
  }
}

// Real output (node ex2-old-patterns.cjs express4):
//   express4 4.22.3
//   accepted   /users/:id?
//   accepted   /files/*
//   accepted   /:file.:ext?
//   accepted   /user/:id(\d+)
//   accepted   /ab?cd
//   accepted   /ab+cd
//   accepted   /[discussion|page]/:slug
//   accepted   /wow!
// Real output (node ex2-old-patterns.cjs express):
//   express 5.3.0
//   THROWS     /users/:id? -> PathError: Unexpected ? at index 10: /users/:id?; visit https://git.new/pathToRegexpError for info
//   THROWS     /files/* -> PathError: Missing parameter name at index 8: /files/*; visit https://git.new/pathToRegexpError for info
//   THROWS     /:file.:ext? -> PathError: Unexpected ? at index 11: /:file.:ext?; visit https://git.new/pathToRegexpError for info
//   THROWS     /user/:id(\d+) -> PathError: Unexpected ( at index 9: /user/:id(\d+); visit https://git.new/pathToRegexpError for info
//   THROWS     /ab?cd -> PathError: Unexpected ? at index 3: /ab?cd; visit https://git.new/pathToRegexpError for info
//   THROWS     /ab+cd -> PathError: Unexpected + at index 3: /ab+cd; visit https://git.new/pathToRegexpError for info
//   THROWS     /[discussion|page]/:slug -> PathError: Unexpected [ at index 1: /[discussion|page]/:slug; visit https://git.new/pathToRegexpError for info
//   THROWS     /wow! -> PathError: Unexpected ! at index 4: /wow!; visit https://git.new/pathToRegexpError for info
```

To run both versions side by side, install them under two names: `npm install express@5 express4@npm:express@4 supertest`. In a real app the throw happens at module load, so `node app.js` exits with the stack trace before `listen()` runs. That is the easy failure to find.

**Example 3 — edge case: Express 5 syntax on Express 4 fails silently.**

javascript

```
// ex3-silent.cjs: node ex3-silent.cjs express4  vs  node ex3-silent.cjs express
const name = process.argv[2] ?? 'express';
const express = require(name);
const request = require('supertest');

const app = express();
app.get('/files/*splat', (req, res) => res.json({ route: '/files/*splat', params: req.params }));
app.get('/users{/:id}', (req, res) => res.json({ route: '/users{/:id}', params: req.params }));

(async () => {
  console.log(`${name} ${require(`${name}/package.json`).version}`);
  for (const url of ['/files/a/b', '/files/xsplat', '/users', '/users/7']) {
    const r = await request(app).get(url);
    console.log(url.padEnd(14), r.status, r.status === 200 ? r.text : '');
  }
})();

// Real output (node ex3-silent.cjs express4):
//   express4 4.22.3
//   /files/a/b     404
//   /files/xsplat  200 {"route":"/files/*splat","params":{"0":"x"}}
//   /users         404
//   /users/7       404
// Real output (node ex3-silent.cjs express):
//   express 5.3.0
//   /files/a/b     200 {"route":"/files/*splat","params":{"splat":["a","b"]}}
//   /files/xsplat  200 {"route":"/files/*splat","params":{"splat":["xsplat"]}}
//   /users         200 {"route":"/users{/:id}","params":{}}
//   /users/7       200 {"route":"/users{/:id}","params":{"id":"7"}}
```

Express 4 reads `*splat` as "the unnamed wildcard `*`, then the literal text `splat`", so `/files/xsplat` matches with `req.params[0] === 'x'` and `/files/a/b` does not match. It reads the braces in `{/:id}` as literal characters. Nothing throws and nothing is logged. The only symptom is 404s, so check the installed major version (`npm ls express`) before you copy route strings from documentation.

**Example 4 — RegExp routes, arrays of paths, and escaping reserved characters.**

javascript

```
// ex4-regex.cjs: RegExp routes, and escaping reserved characters in strings
const express = require('express');
const request = require('supertest');

const app = express();
app.get(/^\/item\/(\d+)$/, (req, res) => res.json({ route: 'numbered group', params: req.params }));
app.get(/^\/sku\/(?<code>[A-Z]{3})-(?<n>\d+)$/, (req, res) => res.json({ route: 'named groups', params: req.params }));
app.get(['/discussion/:slug', '/page/:slug'], (req, res) => res.json({ route: 'array of paths', params: req.params }));
app.get('/price\\(usd\\)', (req, res) => res.json({ route: 'escaped ( and )' }));

(async () => {
  for (const url of ['/item/42', '/item/abc', '/sku/ABC-7', '/page/hello', '/price(usd)']) {
    const r = await request(app).get(url);
    console.log(url.padEnd(12), r.status, r.status === 200 ? r.text : '');
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   /item/42     200 {"route":"numbered group","params":{"0":"42"}}
//   /item/abc    404
//   /sku/ABC-7   200 {"route":"named groups","params":{"code":"ABC","n":"7"}}
//   /page/hello  200 {"route":"array of paths","params":{"slug":"hello"}}
//   /price(usd)  200 {"route":"escaped ( and )"}
```

With a RegExp, numbered groups land in `req.params` under `'0'`, `'1'` and so on, and named groups (`(?<code>…)`) land under their names. Express 4.22.3 gives the same `params` for these two RegExp routes. A RegExp route keeps a normal object prototype on `req.params`. String routes get a null prototype in Express 5.

**Example 5 — `app.param` runs once per request and is local to its router.**

javascript

```
// ex5-param.cjs: app.param runs once per request, before the first matching route
const express = require('express');
const request = require('supertest');

const users = { 7: { id: 7, name: 'Ada' } };
const app = express();
let calls = 0;

app.param('id', (req, res, next, value, name) => {
  calls++;
  console.log(`  param callback: ${name}=${JSON.stringify(value)}`);
  const user = users[value];
  if (!user) return res.status(404).json({ error: `no user ${value}` });
  req.user = user;          // later handlers read the loaded record
  next();
});

app.get('/users/:id', (req, res, next) => { console.log('  route 1 sees', req.user.name); next(); });
app.get('/users/:id', (req, res) => res.json(req.user));

const admin = express.Router();
admin.get('/users/:id', (req, res) => res.json({ inRouter: req.user ?? null }));
app.use('/admin', admin);   // app.param does NOT apply to routes inside this router

const staff = express.Router();
staff.param('id', (req, res, next, value) => { calls++; req.user = users[value] ?? null; next(); });
staff.get('/users/:id', (req, res) => res.json({ inRouter: req.user }));
app.use('/staff', staff);   // router.param is scoped to its own router

(async () => {
  for (const url of ['/users/7', '/users/9', '/admin/users/7', '/staff/users/7']) {
    calls = 0;
    console.log('GET', url);
    const r = await request(app).get(url);
    console.log(`  ${r.status} ${r.text}  (callback ran ${calls}x)`);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   GET /users/7
//     param callback: id="7"
//     route 1 sees Ada
//     200 {"id":7,"name":"Ada"}  (callback ran 1x)
//   GET /users/9
//     param callback: id="9"
//     404 {"error":"no user 9"}  (callback ran 1x)
//   GET /admin/users/7
//     200 {"inRouter":null}  (callback ran 0x)
//   GET /staff/users/7
//     200 {"inRouter":{"id":7,"name":"Ada"}}  (callback ran 1x)
```

Two routes match `GET /users/7`, but the callback ran once. Express remembers that it already processed `id` with the value `'7'` in this request. The callback can end the request itself (the 404 for `/users/9`), so neither route handler runs. Routes inside `/admin` never trigger the app's callback. Param callbacks belong to the router they are registered on, so the `staff` router needs its own `staff.param('id', …)`. Express 4.22.3 prints the same output for this script.

**Example 6 — what `req.baseUrl`, `req.path`, `req.url` and `req.originalUrl` contain at each level.**

javascript

```
// ex6-mount.cjs: what each level sees after Express strips the mount path
const express = require('express');
const request = require('supertest');

const show = (level) => (req, res, next) => {
  console.log(level.padEnd(6), JSON.stringify({ baseUrl: req.baseUrl, path: req.path, url: req.url, originalUrl: req.originalUrl }));
  next();
};

const app = express();
const api = express.Router();
const users = express.Router({ mergeParams: true });

app.use(show('app'));
app.use('/api', api);
api.use(show('api'));
api.use('/orgs/:orgId/users', users);
users.use(show('users'));
users.get('/:id', (req, res) => res.json({ params: req.params }));
app.use(show('after')); // runs only if nothing above responded

(async () => {
  const r = await request(app).get('/api/orgs/acme/users/42?tab=posts');
  console.log(r.status, r.text);
  await request(app).get('/api/nothing-here');
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   app    {"baseUrl":"","path":"/api/orgs/acme/users/42","url":"/api/orgs/acme/users/42?tab=posts","originalUrl":"/api/orgs/acme/users/42?tab=posts"}
//   api    {"baseUrl":"/api","path":"/orgs/acme/users/42","url":"/orgs/acme/users/42?tab=posts","originalUrl":"/api/orgs/acme/users/42?tab=posts"}
//   users  {"baseUrl":"/api/orgs/acme/users","path":"/42","url":"/42?tab=posts","originalUrl":"/api/orgs/acme/users/42?tab=posts"}
//   200 {"params":{"orgId":"acme","id":"42"}}
//   app    {"baseUrl":"","path":"/api/nothing-here","url":"/api/nothing-here","originalUrl":"/api/nothing-here"}
//   api    {"baseUrl":"/api","path":"/nothing-here","url":"/nothing-here","originalUrl":"/api/nothing-here"}
//   after  {"baseUrl":"","path":"/api/nothing-here","url":"/api/nothing-here","originalUrl":"/api/nothing-here"}
```

For the second request no route in `api` matched, so the request leaves the router. Before the `after` middleware runs, Express has restored `baseUrl` to `''` and `url` to the full path. Express 4.22.3 prints the same lines.

**Example 7 — `mergeParams` off, on, and with a name clash.**

javascript

```
// ex7-merge.cjs: mergeParams off, on, and on with a name clash
const express = require('express');
const request = require('supertest');

function commentsRouter(options) {
  const r = express.Router(options);
  r.get('/:id', (req, res) => res.json(req.params));
  return r;
}

const app = express();
app.use('/posts/:postId/comments', commentsRouter());                     // default: false
app.use('/v2/posts/:postId/comments', commentsRouter({ mergeParams: true }));
app.use('/v3/posts/:id/comments', commentsRouter({ mergeParams: true }));  // parent and child both use :id

(async () => {
  for (const url of ['/posts/5/comments/9', '/v2/posts/5/comments/9', '/v3/posts/5/comments/9']) {
    const r = await request(app).get(url);
    console.log(url.padEnd(24), r.status, r.text);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   /posts/5/comments/9      200 {"id":"9"}
//   /v2/posts/5/comments/9   200 {"postId":"5","id":"9"}
//   /v3/posts/5/comments/9   200 {"id":"9"}
```

Without the option, the child router never sees `postId`. With it, both values are present. When parent and child both call their parameter `:id`, the child's `'9'` replaces the parent's `'5'`, so give nested parameters distinct names (`:postId`, `:commentId`). Express 4.22.3 gives the same three results.

**Example 8 — `next('route')` against `next('router')`, and `app.all`.**

javascript

```
// ex8-next.cjs: next('route'), next('router') and app.all
const express = require('express');
const request = require('supertest');

const app = express();

// next('route'): skip the remaining handlers of THIS route, try the next route
app.get('/items/:id',
  (req, res, next) => (req.params.id === 'new' ? next('route') : next()),
  (req, res) => res.send(`item handler: ${req.params.id}`));
app.get('/items/:id', (req, res) => res.send('next route: the "new item" form'));

// next('router'): leave this whole router, continue in the parent
const admin = express.Router();
admin.use((req, res, next) => (req.get('x-admin') === 'yes' ? next() : next('router')));
admin.get('/stats', (req, res) => res.send('admin stats'));
app.use('/admin', admin);
app.get('/admin/stats', (req, res) => res.status(403).send('back in app: not an admin'));

// app.all: one handler for every HTTP method on one path
app.all('/ping', (req, res) => res.send(`${req.method} matched app.all`));

async function hit(method, url, headers = {}) {
  const r = await request(app)[method](url).set(headers);
  console.log(method.toUpperCase().padEnd(7), url.padEnd(12), JSON.stringify(headers).padEnd(17), r.status, r.text || '(no body)');
}

(async () => {
  await hit('get', '/items/42');
  await hit('get', '/items/new');
  await hit('get', '/admin/stats', { 'x-admin': 'yes' });
  await hit('get', '/admin/stats');
  for (const m of ['get', 'post', 'delete', 'head', 'options']) await hit(m, '/ping');
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   GET     /items/42    {}                200 item handler: 42
//   GET     /items/new   {}                200 next route: the "new item" form
//   GET     /admin/stats {"x-admin":"yes"} 200 admin stats
//   GET     /admin/stats {}                403 back in app: not an admin
//   GET     /ping        {}                200 GET matched app.all
//   POST    /ping        {}                200 POST matched app.all
//   DELETE  /ping        {}                200 DELETE matched app.all
//   HEAD    /ping        {}                200 (no body)
//   OPTIONS /ping        {}                200 OPTIONS matched app.all
```

`next('route')` stayed inside the app and moved to the second `/items/:id` route. `next('router')` left the `admin` router, so the app-level `/admin/stats` route answered. `app.all` registered one handler for every method. `HEAD` got the same status with no body, because `res.send` skips the body for a `HEAD` request. Express 4.22.3 prints the same lines.

**Example 9 — edge case: `next('route')` outside a route, and `HEAD` without a `HEAD` route.**

javascript

```
// ex9-edge.cjs: next('route') outside a route, and HEAD without a HEAD route
const express = require('express');
const request = require('supertest');

const app = express();
app.use((req, res, next) => {
  console.log(`  app.use middleware calls next('route') for ${req.method} ${req.url}`);
  next('route');                            // not inside app.METHOD(): acts like next()
});
app.get('/x', (req, res) => {
  res.set('X-Handler', 'get /x');
  res.send('body from the GET handler');
});

(async () => {
  for (const method of ['get', 'head']) {
    const r = await request(app)[method]('/x');
    console.log(method.toUpperCase(), r.status, 'X-Handler:', r.headers['x-handler'], 'content-length:', r.headers['content-length'], 'body:', JSON.stringify(r.text ?? ''));
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//     app.use middleware calls next('route') for GET /x
//   GET 200 X-Handler: get /x content-length: 25 body: "body from the GET handler"
//     app.use middleware calls next('route') for HEAD /x
//   HEAD 200 X-Handler: get /x content-length: 25 body: ""
```

The `app.use` middleware is not part of a route, so there is no "rest of the route" to skip. `next('route')` behaves like `next()`, and the request continues to `/x`. Express 4.22.3 behaves the same way. Separately, there is no `app.head('/x')`, yet `HEAD /x` ran the `GET` handler (the `X-Handler` header is there). Express routes a `HEAD` request to a matching `GET` route when no `HEAD` route exists. The response kept `Content-Length: 25` and dropped the body.

## Common mistakes & gotchas

- **Porting `:id?`, `*`, or `(\\d+)` onto Express 5.** The app throws `PathError` at startup, `Unexpected ? at index …` or `Missing parameter name`. Rewrite with braces, a named wildcard, or a RegExp. The table above is the map.
- **Using Express 5 syntax on Express 4.** `'/files/*splat'` and `'/users{/:id}'` register with no error and then return 404. Example 3 shows it.
- **Treating `req.params.splat` as a string.** On Express 5 it is an array, such as `['a', 'b']`. Calling `.startsWith` throws. Join it first.
- **Expecting `/files/*splat` to match `/files`.** A wildcard needs one or more segments. Use `'/files{/*splat}'`.
- **Checking an optional key the Express 4 way.** On Express 5 an unmatched optional key is absent, not `undefined`. `req.params.ext ?? default` works on both.
- **Expecting `app.param` to fire inside mounted routers.** Param callbacks belong to the router they are registered on. Example 5 shows it. On Express 5, `router.param` takes a single string and throws `TypeError: argument name must be a string` for an array. `app.param` still accepts an array.
- **Forgetting `mergeParams` on a nested router.** `req.params.userId` is `undefined` in the child. With `mergeParams`, a name used by both parent and child keeps only the child's value.
- **Logging or redirecting with `req.url` inside a router.** The mount path has been removed. Use `req.originalUrl` for the full URL, and `req.baseUrl + req.path` to rebuild the path without the query.
- **Calling `next('route')` in `app.use` middleware.** It acts like `next()`. Example 9 shows it. Use `next('router')` to leave a router, or respond.

## Best practices

- Prefer string paths with named parameters. Put checks such as "digits only" in validation or in a param callback. Use a RegExp route only when the shape cannot be a string.
- Give every wildcard and every nested parameter its own name, such as `*filePath`, `:orgId`, and `:userId`. Unique names avoid `mergeParams` clashes.
- Load the record in `router.param` so every route under `/:id` gets `req.user` or a 404 from one place, and the lookup runs once per request.
- Set `mergeParams: true` on any router mounted at a path that contains a parameter.
- Use `req.originalUrl` in logs, errors, and "redirect back after login". Use `req.baseUrl` when a router builds links to its own routes.
- On an upgrade, search route strings for `?`, `*`, `(`, and `+`. Lesson 61 has the patterns. The startup `PathError` finds what you missed.

## ⭐ Interview lens

> **Q: “Why does `app.get('/users/:id?')` crash on Express 5, and what replaces it?”**  
> A: Express 5 compiles paths with path-to-regexp 8, through the router 2.x package. In that version `?` is reserved, so `app.get('/users/:id?')` throws `PathError: Unexpected ? at index 10` while the route is being registered, before `listen`. Write the optional piece in braces, including the slash: `'/users{/:id}'`. That matches `/users` and `/users/7`. When `id` is missing, Express 5 leaves the key out of `req.params`. Express 4 kept the key with the value `undefined`. The trap is the other direction. Express 4 accepts the brace syntax as literal text and then 404s, with no error at startup. The spelling has to match the installed major version.

> **Q: “What is the difference between `next('route')` and `next('router')`?”**  
> A: `next('route')` skips the remaining handlers of the current route and tries the next route in the same router that matches. It only means that inside `app.get` and the other method helpers, including `app.all`. Outside a route, in `app.use`, it behaves like a plain `next()`. `next('router')` skips everything left in the current router and continues with the layer after that router's mount in the parent. Neither is an error. Any other argument to `next` is an error and jumps to the error handler. For example, a guard inside an admin router can call `next('router')` so a public route registered after the mount can answer the same URL. The limit is calling `next('router')` from app-level middleware. That leaves the app's own router, and Express answers with its final 404.

> **Q: “Inside a router mounted at `/api/users`, what are `req.url`, `req.baseUrl` and `req.originalUrl` for `GET /api/users/42?x=1`?”**  
> A: Express strips the mount prefix while the request is inside the router, and it restores the values if the router does not respond. For `GET /api/users/42?x=1` mounted at `/api/users`, `req.url` is `'/42?x=1'`, `req.path` is `'/42'`, `req.baseUrl` is `'/api/users'`, and `req.originalUrl` stays `'/api/users/42?x=1'`. When the mount path itself has parameters, `req.baseUrl` contains the real values, not the `:name` pattern. Use `req.originalUrl` for logs and redirects. Use `req.baseUrl + req.path` when you need the path without the query. The limit of `req.url` is that it is the remainder. Redirecting to it drops `/api/users`.

> **Q: “A nested router can't read `req.params.userId`. Why?”**  
> A: The parent captured `userId` while matching the mount path. Each router then sets `req.params` from its own match, so the child replaces the object and `userId` is gone. Create the child with `express.Router({ mergeParams: true })`. It starts from the parent's params and adds its own. A name used by both keeps the child's value, so call them `:userId` and `:postId`, not `:id` twice. The option belongs on the child, the router that needs to read the parent, not on the parent. Example 7 shows the same posts route with and without the flag: `userId` is null until you opt in.

## Cheat-card

- Express 5.3.0 uses router 2.2.0 and path-to-regexp 8.4.2. Express 4.22.3 uses path-to-regexp 0.1.13.
- A named wildcard is `'/files/*splat'`. `req.params.splat` is an array. `'/files{/*splat}'` also matches `/files`.
- Optional parts are `'/users{/:id}'` and `'/:file{.:ext}'`. An unmatched key is omitted. Express 4 used `undefined`.
- Reserved in Express 5 strings: `( ) [ ] ? + !`. Escape a literal with `\\`. Quoted names look like `:"user-id"`.
- An old pattern on Express 5 throws `PathError`, a `TypeError`, at registration. Example: `Unexpected ? at index 10`.
- A new pattern on Express 4 is accepted, then a silent 404.
- On a RegExp route, groups land in `req.params['0']` or under the group name. The params object keeps a normal prototype.
- `app.param(name, (req, res, next, value, name) => ...)` runs once per request per value, and only on its own router. On Express 5, `router.param` takes a string only.
- `mergeParams: true` lets the child see the parent's params. The child wins a name clash.
- After a mount, `req.url` and `req.path` are relative, `req.baseUrl` is the matched prefix, and `req.originalUrl` is the full URL. Express restores `url` and `baseUrl` on the way out.
- `next('route')` skips the rest of the route, and only inside a route handler. `next('router')` leaves the router.
- `app.all(path, fn)` matches every method. A `HEAD` request falls back to a matching `GET` route.

## Good to know

- An `app.param('id')` callback runs once if two routes match `/users/7`. Express records that `id` was already processed with the value `'7'` and skips the callback for the second route. It also does not run for routes inside mounted routers, because param callbacks are local to the router they were registered on.
- `router.param(['id', 'userId'], fn)` throws `TypeError: argument name must be a string` on Express 5. `app.param` still accepts an array of names.

## Learn More

- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Routing guide expressjs.com](https://expressjs.com/en/guide/routing.html)
- [path-to-regexp README github.com](https://github.com/pillarjs/path-to-regexp)
- [router (the Express 5 router package) github.com](https://github.com/pillarjs/router)
- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
