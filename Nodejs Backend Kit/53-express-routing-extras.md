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

## Why it matters

Lesson 48 ([Routing: params, query, and Routers](48-routing-params-query-and-routers.md)) covers the routing you write every day: `app.get('/users/:id')`, `req.query`, one Router per resource. Real codebases also use the less common parts of the router, and those are the parts Express 5 changed:

- **Path strings from Express 4 now throw at startup.** `'/users/:id?'`, `'/files/*'` and `'/user/:id(\\d+)'` were all legal in Express 4. In Express 5 the same line throws a `PathError` while the app starts, before it serves a single request.
- **Express 5 strings on Express 4 fail without any error.** If you copy `'/files/*splat'` from an Express 5 example into an Express 4 app, Express 4 accepts it and then answers 404 for the URLs you meant it to match.
- **Nested routers lose parameters.** A router mounted at `/users/:userId/posts` does not see `:userId` unless it was created with `mergeParams: true`.
- **Logs and redirects use the wrong URL.** Inside a mounted router, `req.url` has the mount path removed. Code that logs or redirects to `req.url` sends the wrong path.

This lesson covers the rest of the routing API: `app.param` / `router.param`, RegExp routes, optional segments, the Express 5 path syntax and what broke, `mergeParams`, `app.all`, how mount paths are stripped, and `next('route')` against `next('router')`.

## The concept, simply

A route path is a small pattern language. Express hands the string to a library called **path-to-regexp**, which compiles it into a regular expression plus a list of parameter names. Express 4.22.3 uses path-to-regexp **0.1.13**, a very old line. Express 5.3.0 uses the separate **router** package (2.2.0), which uses path-to-regexp **8.4.2** (changed in v5):

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

Version 8 has a smaller pattern language than 0.1:

- `:name` matches one path segment, as before.
- `*name` (a **named wildcard**) matches one or more whole segments. Its value is an **array** of segments, not a string.
- `{ … }` (**braces**) mark an optional part: `'/users{/:id}'` matches both `/users` and `/users/7`.
- The characters `( ) [ ] ? + !` are reserved and throw if they appear unescaped. That removes Express 4's `?` (optional), `+` (repeat), `*` (unnamed wildcard) and `(…)` (inline regex).

If a string pattern is not enough, pass a real `RegExp` object as the path, or an array of paths.

Three more routing tools sit on top of the patterns:

- **`app.param(name, fn)`** runs `fn` before the route handlers whenever a route with `:name` matches. It typically loads the record for an id.
- **`mergeParams`** is an option on `express.Router()`. With it, a child router can read the parameters captured by its parent's mount path.
- **`next('route')` and `next('router')`** are the two exits that are not errors. `next('route')` skips the rest of the current route. `next('router')` leaves the current router.

## How it works

When a request arrives, Express walks the app's stack of layers. For each layer:

1. **Match the path.** Each layer holds the regex that path-to-regexp compiled when you called `app.get()`/`app.use()`. A route layer (`app.METHOD`) must match the whole path. A `use` layer (`app.use`, `router.use`) only has to match a prefix that ends on a segment boundary.
2. **Collect parameters.** Capture groups become `req.params`. In Express 5, `req.params` for a string path is an object with a null prototype. A wildcard gives an array, and an optional group that did not match leaves its key out entirely. In Express 4 the key was present with the value `undefined`.
3. **Run param callbacks.** Before the first handler of a matched route runs, Express runs each `app.param`/`router.param` callback registered on *this* router for the parameters in that route. The callback receives `(req, res, next, value, name)`. Express records which parameters it has already processed in this request. If a later route matches the same parameter with the same value, the callback does not run again.
4. **Run the handlers.** `next()` moves to the next handler or layer. `next('route')` skips the remaining handlers of the current route (it works only inside `app.METHOD`/`router.METHOD`/`app.all`). `next('router')` skips everything left in the current router and resumes in the parent. Any other argument is an error.
5. **Descend into routers.** For a `use` layer that holds a Router, Express strips the matched prefix and calls the router with the shorter URL.

**Mount paths are stripped, then restored.** When `app.use('/api', api)` matches `/api/orgs/acme/users/42?tab=posts`, Express adds the matched prefix to `req.baseUrl` (`'/api'`) and rewrites `req.url` to the rest (`'/orgs/acme/users/42?tab=posts'`). `req.path` is the pathname part of the rewritten `req.url`. A nested mount (`api.use('/orgs/:orgId/users', users)`) does the same again, so inside `users` you see `baseUrl = '/api/orgs/acme/users'` (with the real parameter value in it) and `path = '/42'`. `req.originalUrl` is never rewritten. If the router finishes without responding, Express puts `req.url` and `req.baseUrl` back before it moves on to the next app-level layer (Example 6 shows the `after` line). Routes inside a router are therefore written relative to the mount: `router.get('/:id')` answers `GET /api/users/42` when the router is mounted at `/api/users`.

![Main app mounting usersRouter at /api/users and ordersRouter at /api/orders, with router.get('/:id') inside usersRouter answering GET /api/users/42](assets/i32_02_bfe22857.svg)
*Figure: Mounting Routers on a base path. Look at: `app.use('/api/users', usersRouter)` plus `router.get('/:id')` producing `GET /api/users/42`. Express removes the `/api/users` prefix before the router matches `/:id`.*

**Why a child router cannot see the parent's parameters by default.** Each router builds its own `req.params` from its own match. The mount path `'/users/:userId/posts'` is matched by the *parent's* layer, so `userId` is in the parent's params object. When the child router runs, it replaces `req.params` with what *its* route captured. `express.Router({ mergeParams: true })` tells the child to start from the parent's params and add its own. When both use the same name, the child's value wins.

**Why old patterns throw in Express 5.** path-to-regexp 8 tokenises the string and rejects any reserved character it does not expect. The error is a `PathError` (a subclass of `TypeError`) thrown while you register the route. Its message gives the character and its index, for example `Unexpected ? at index 10: /users/:id?`. The replacements are:

| Express 4 string | Express 5 string | Note |
|---|---|---|
| `'/users/:id?'` | `'/users{/:id}'` | the braces wrap the slash too |
| `'/:file.:ext?'` | `'/:file{.:ext}'` | unmatched `ext` is left out of `req.params` |
| `'/files/*'` (value in `req.params[0]`, a string) | `'/files/*splat'` (value in `req.params.splat`, an array) | `'/files{/*splat}'` also matches `/files` |
| `'/user/:id(\\d+)'` | `/^\/user\/(\d+)$/` (a RegExp) or validate in the handler | no inline regex in strings |
| `'/[discussion\|page]/:slug'` | `['/discussion/:slug', '/page/:slug']` | an array of paths |
| `'/ab?cd'`, `'/ab+cd'` | list the literal paths, or use a RegExp | `?` and `+` are reserved |
| a literal `(`, `)`, `[`, `]`, `?`, `+`, `!` | escape it: `'/price\\(usd\\)'` | backslash in the JS string |

Parameter names can now be any valid JavaScript identifier, or a quoted string such as `:"user-id"`.

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

- **Porting `:id?`, `*` or `(\\d+)` to Express 5 unchanged.** The app throws `PathError: Unexpected ? at index …` (or `Missing parameter name`) at startup. Rewrite the pattern with braces, a named wildcard or a RegExp (see the table in How it works).
- **Using Express 5 syntax on Express 4.** `'/files/*splat'` and `'/users{/:id}'` register without an error and then return 404 (Example 3).
- **Treating `req.params.splat` as a string.** In Express 5 it is an array (`['a', 'b']`). `req.params.splat.startsWith(…)` throws a `TypeError`. Join it first.
- **Expecting `/files/*splat` to match `/files`.** A wildcard needs one or more segments. Use `'/files{/*splat}'`.
- **Checking `'ext' in req.params` or `req.params.ext === undefined` the Express 4 way.** In Express 5 an unmatched optional key is absent. A check written as `req.params.ext ?? default` works in both versions.
- **Registering `app.param` and expecting it to fire inside mounted routers.** Param callbacks are local to their router (Example 5). Register `router.param` on each router that needs it. In Express 5, `router.param` takes a single string name and throws `TypeError: argument name must be a string` for an array (`app.param` still accepts an array).
- **Forgetting `mergeParams` on a nested router.** `req.params.userId` is `undefined` inside the child. And with `mergeParams`, a parameter name used by both parent and child keeps only the child's value.
- **Logging or redirecting with `req.url` inside a router.** It has the mount path removed. Use `req.originalUrl` for the full URL, and `req.baseUrl + req.path` to rebuild the path without the query.
- **Calling `next('route')` in `app.use` middleware.** It acts like `next()` (Example 9). Use `next('router')` to leave a router, or respond.

## Best practices

- **Prefer string paths with named parameters**, and move value checks such as "digits only" into validation (lesson 65) or a param callback. Use a RegExp route only when the shape of the path cannot be written as a string.
- **Give every wildcard and every nested parameter a descriptive, unique name** (`*filePath`, `:orgId`, `:userId`). Names are what you read in `req.params`, and unique names avoid `mergeParams` clashes.
- **Load records in `router.param`** so every route under `/:id` receives `req.user` or a 404 from one place, and the database lookup runs once per request.
- **Set `mergeParams: true` on any router mounted at a path that contains a parameter.**
- **Use `req.originalUrl` in logs, error messages and "redirect back after login" code**, and `req.baseUrl` when a router needs to build links to its own routes.
- **When upgrading, search for `?`, `*`, `(` and `+` inside route strings** (lesson 61 has the grep patterns), and let the startup `PathError` find anything you missed. Run the app once before deploying.

## ⭐ Interview lens

> **Q: “Why does `app.get('/users/:id?')` crash on Express 5, and what replaces it?”**  
> A: Express 5 uses path-to-regexp 8 (through the router 2.x package), where `?` is a reserved character. Registering the route throws `PathError: Unexpected ? at index 10`. Optional parts are written with braces: `'/users{/:id}'`. When `id` is missing, its key is left out of `req.params`. *Trap:* Express 4 silently accepts the new brace syntax as literal text, so the fix has to match the installed major version.

> **Q: “What is the difference between `next('route')` and `next('router')`?”**  
> A: `next('route')` skips the remaining handlers of the current route and tries the next matching route in the same router. It only means that inside `app.METHOD`/`router.METHOD`/`app.all`. `next('router')` skips everything left in the current router instance and continues with the layer after the router's mount in the parent. Neither is an error. Any other argument to `next` is treated as one.

> **Q: “Inside a router mounted at `/api/users`, what are `req.url`, `req.baseUrl` and `req.originalUrl` for `GET /api/users/42?x=1`?”**  
> A: `req.url` is `'/42?x=1'` (prefix stripped), `req.path` is `'/42'`, `req.baseUrl` is `'/api/users'` (with real parameter values when the mount path has parameters), and `req.originalUrl` is `'/api/users/42?x=1'`, which never changes. Express restores `url` and `baseUrl` when the request leaves the router.

> **Q: “A nested router can't read `req.params.userId`. Why?”**  
> A: The parent layer captured `userId` while matching the mount path. Each router then sets its own `req.params`. Create the child with `express.Router({ mergeParams: true })` so it starts from the parent's params. A name clash resolves in favour of the child.

> **Q: “How many times does an `app.param('id')` callback run if two routes match `/users/7`?”**  
> A: Once. Express records that `id` was already processed with the value `'7'` in this request and skips the callback for the second route. It also does not run for routes inside mounted routers, because param callbacks are local to the router they are registered on.

## Cheat-card

- **Versions:** Express 5.3.0 → router 2.2.0 → path-to-regexp 8.4.2. Express 4.22.3 → path-to-regexp 0.1.13.
- **Named wildcard:** `'/files/*splat'` → `req.params.splat` is an array. `'/files{/*splat}'` also matches `/files`.
- **Optional:** `'/users{/:id}'`, `'/:file{.:ext}'`. The unmatched key is omitted (Express 4: `undefined`).
- **Reserved in Express 5 strings:** `( ) [ ] ? + !`. Escape with `\\`. Quoted names: `:"user-id"`.
- **Old pattern on Express 5:** `PathError` (a `TypeError`) at registration, for example `Unexpected ? at index 10`.
- **New pattern on Express 4:** accepted, then a silent 404.
- **RegExp route:** groups go in `req.params['0']` or by group name. Normal object prototype.
- **`app.param(name, (req, res, next, value, name) => …)`:** once per request per value. Local to its router. `router.param` takes a string only (v5).
- **`mergeParams: true`:** the child sees the parent's params. The child wins a name clash.
- **Mount stripping:** `req.url` / `req.path` are relative, `req.baseUrl` is the matched prefix, `req.originalUrl` is the full URL. Restored on exit.
- **`next('route')`** skips the rest of the route (route handlers only). **`next('router')`** leaves the router.
- **`app.all(path, fn)`:** every method. `HEAD` falls back to a `GET` route.

---

## Learn More

- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Routing guide expressjs.com](https://expressjs.com/en/guide/routing.html)
- [path-to-regexp README github.com](https://github.com/pillarjs/path-to-regexp)
- [router (the Express 5 router package) github.com](https://github.com/pillarjs/router)
- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
