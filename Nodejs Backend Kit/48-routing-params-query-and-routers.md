---
title: "Routing: params, query, and Routers"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-routing
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Routing: params, query, and Routers

*9 min read · Updated 24 Jul 2026 Topic 35 of 70 Bookmark Mark done Why it matters Routing is how a server decides which piece of your code answers a given URL · Topic 35 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-routing](https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-routing)

---

## Say it in 30 seconds

A route in Express is an HTTP method, a path pattern, and a handler function. When a request arrives, Express walks the routes from top to bottom and runs the first handler that matches and then responds. The path can name a piece of the URL, such as :id, and the question mark part of the URL arrives separately as the query string. Routing exists so each URL maps to one piece of your code. The trade-off is that a broad pattern registered too early swallows a more specific URL, and nothing warns you.

## Why it matters

Routing is how the server decides which function answers a URL. A REST API is a routing table. `GET /users` lists users, `POST /users` creates one, `GET /users/:id` fetches one, and `DELETE /users/:id` removes it. Get this right and the API reads like a map of the domain. Get it wrong and paths conflict, a parameter reads the wrong value, and `server.js` grows past a thousand lines. Interviewers use routing to see whether you can structure an application, not just answer one URL.

You will use four tools constantly: one route per HTTP method, route parameters such as `:id`, the query string such as `?sort=asc`, and Routers so a growing API is not one file.

## The concept, simply

A route is a triple: an HTTP method, a path pattern, and one or more handler functions. You register one with `app.get`, `app.post`, `app.put`, `app.patch`, or `app.delete`. `app.all()` matches every method. The path can be a literal such as `'/health'`, or it can contain named parameters marked with a colon, such as `'/users/:id'`. When a request matches, Express calls the handler.

Two kinds of variable data ride along. Route parameters are parts of the path. In `/users/:id`, the `:id` segment captures that position, so `/users/42` gives `req.params.id === '42'`. The query string is the part after `?`. In `/users?sort=asc&page=2`, Express parses it into `req.query` as `{ sort: 'asc', page: '2' }`. A parameter names which resource. A query usually filters, sorts, or paginates a collection.

![Diagram breaking a route into method path and handler and showing that colon id becomes req.params.id while question-mark sort becomes req.query.sort](assets/i32_01_1d9139e2.svg)

A route is method plus path plus handler. The `:id` segment lands in `req.params`. The `?sort` part lands in `req.query`.

As the app grows, you do not put every route in one file. A Router is a mini Express app you can mount. Create it with `express.Router()`, attach routes, and mount it with `app.use('/api/users', usersRouter)`. Inside the router, paths are relative to that base, so `router.get('/:id')` answers `GET /api/users/:id`.

## How it works

The router is an ordered list. Express matches top to bottom, and the first handler that responds, without calling `next()`, ends the request. A more specific route must be registered before a more general one that would also match. `/users/new` must come before `/users/:id`, or `:id` captures the string `"new"`.

Path patterns are compiled into regular expressions by path-to-regexp. A segment like `:id` becomes a capture group, and the matched text is stored under that name in `req.params`. Two facts matter. Route params are always strings, so you get `'42'`, never the number `42`, and you convert with `Number()` yourself. And `:id` matches one path segment. It stops at the next `/`. Express 5 changed some advanced syntax, especially optional segments and unnamed wildcards. Named `:param` routing is unchanged.

The query string is parsed separately. Express reads everything after `?`, decodes it, and builds `req.query`. A repeated key becomes an array, so `?tag=a&tag=b` is `{ tag: ['a', 'b'] }`. A value you expect to be a string can arrive as an array. Bracket syntax depends on the version. Express 4 defaults to the `qs` parser named `"extended"`, so `?a[b]=c` becomes `{ a: { b: 'c' } }`. Express 5 defaults to the `"simple"` parser, which is Node's `querystring`, so the same URL is a flat key `{ 'a[b]': 'c' }`. Opt back in with `app.set('query parser', 'extended')` only if you need nested objects. Values in `req.query` are strings, or arrays or objects of strings. Express does not coerce types.

javascript

```
app.get('/search', (req, res) => res.json(req.query));
// GET /search?a[b]=c&tag=x&tag=y

// Real output — Express 4.22.3 (default "extended"):
//   {"a":{"b":"c"},"tag":["x","y"]}
// Real output — Express 5.2.1 (default "simple"):
//   {"a[b]":"c","tag":["x","y"]}
// Real output — Express 5.2.1 after app.set('query parser', 'extended'):
//   {"a":{"b":"c"},"tag":["x","y"]}
```

![Diagram showing a main app mounting a usersRouter at slash api slash users and an ordersRouter at slash api slash orders with relative paths inside each router resolving to full URLs](assets/i32_02_bfe22857.svg)

A Router is a mini-app mounted at a base path. Routes inside it are written relative to that base, and Express joins them.

`app.use('/api/users', usersRouter)` puts the router in the stack as one middleware entry for that base path. A request to `/api/users/42` matches the mount. Express strips `/api/users` and passes `/42` into the router, which then matches `/:id`. Routers can be nested, and `router.use(...)` adds middleware for that subtree only. "Authenticate every admin route" belongs on the admin router, not on the whole app.

## Code examples

**1. Methods, a route param, and a query.**

javascript

```
// GET /users/42?fields=name
app.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);        // '42' (string) -> 42
  const fields = req.query.fields;         // 'name'
  res.json({ id, fields });
});

app.post('/users', (req, res) => {
  res.status(201).json({ created: req.body });
});

app.delete('/users/:id', (req, res) => {
  res.status(204).end();
});
```

**2. Ordering matters — specific before generic.**

javascript

```
// CORRECT: the literal route is registered first
app.get('/users/me', (req, res) => res.json({ self: true }));
app.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

// If reversed, GET /users/me would match /users/:id
// and req.params.id would be the string "me".
```

**3. A Router in its own module** — the real-world pattern.

javascript

```
// routes/users.js
const express = require('express');
const router = express.Router();

// middleware for THIS router only
router.use((req, res, next) => { req.scope = 'users'; next(); });

router.get('/', (req, res) => res.json({ list: [] }));       // GET /api/users
router.get('/:id', (req, res) => res.json({ id: req.params.id })); // GET /api/users/:id
router.post('/', (req, res) => res.status(201).json(req.body));

module.exports = router;
```

javascript

```
// app.js
const express = require('express');
const app = express();
const usersRouter = require('./routes/users');

app.use(express.json());
app.use('/api/users', usersRouter);   // mount the router at a base path
app.listen(3000);
```

**4. Chaining methods on one path with `app.route()`** to avoid repeating the path string.

javascript

```
app.route('/books/:id')
  .get((req, res) => res.json({ read: req.params.id }))
  .put((req, res) => res.json({ updated: req.params.id }))
  .delete((req, res) => res.status(204).end());
```

## Common mistakes & gotchas

- **Registering `:id` before a literal sibling.** `/users/:id` above `/users/me` makes `req.params.id` the string `"me"`. Put the specific route first.
- **Treating params as numbers.** `req.params.id` is always a string. `req.params.id === 42` is false. Convert with `Number()` and validate.
- **Assuming a query value is a string.** A duplicated key yields an array. Bracket syntax yields objects when the `"extended"` parser is on. That is the Express 4 default. In Express 5 you opt in with `app.set('query parser', 'extended')`. Check the type before you use the value.
- **Confusing `req.params` and `req.query`.** Params come from the path pattern. Query comes from after `?`. The wrong one is `undefined`.
- **Defining the same method and path twice.** The first handler that responds wins. The second is dead code, and Express does not throw.
- **Copying Express 4 wildcard or regex paths onto Express 5.** The matcher changed. Named `:param` routes are safe. Exotic patterns need review.

## Best practices

- One Router per resource, in its own file under `routes/`, mounted at `/api/<resource>`.
- Order routes from specific to generic, and keep the base path in `app.use` so the router paths stay short.
- Validate and coerce params and query at the edge, with a small middleware or a schema library such as Zod or Joi, so handlers see clean values.
- Use `app.route()` when several verbs share one path, so the path is written once.
- Keep handlers thin. Read the request, call a service, send the response. Business rules do not belong in the route callback.
- Pass `{ mergeParams: true }` to a nested router that needs a parameter from the parent's mount path.

## ⭐ Interview lens

> **Q: "What is the difference between `req.params` and `req.query`?"**  
> A: `req.params` holds named pieces of the path pattern. `/users/:id` put against `/users/42` gives `req.params.id` of `'42'`. That identifies one resource. `req.query` is the query string after `?`, parsed into an object. `/users?sort=asc&page=2` gives `{ sort: 'asc', page: '2' }`, which usually filters, sorts, or paginates a list. Express fills both before your handler runs. It does not turn them into numbers or booleans. A repeated query key becomes an array, so check the type. The limit is mixing them up. Reading `req.query.id` on a path that only has `:id` gives `undefined`.

> **Q: "Why does route order matter?"**  
> A: Express walks routes from top to bottom, and the first matching handler that sends a response wins. A pattern like `/users/:id` also matches `/users/me`, because `:id` is any one segment. If that pattern is registered first, the literal route never runs and `req.params.id` is the string `"me"`. Register the literal `/users/me` before `/users/:id`. The same rule covers `/users/new` before `/users/:id`. Express does not warn you. The second route is simply never reached. The limit of "first match wins" is that a later route still runs if the earlier one calls `next()` instead of responding.

> **Q: "What is `express.Router()` and why use it?"**  
> A: `express.Router()` builds a small mountable app. You attach routes and middleware to it, export it, and mount it with `app.use('/api/users', router)`. Express strips the base path and matches the router's own paths against what is left, so `router.get('/:id')` answers `GET /api/users/:id`. Middleware on that router, via `router.use`, runs only for URLs under the mount. That is how a large API stays one file per resource. The limit is that each router builds its own `req.params`. A child mounted at `/users/:userId/posts` does not see `userId` unless you created it with `mergeParams: true`.

> **Q (trap): "`req.params.id` for `/users/42` — is it the number 42?"**  
> A: No. It is the string `"42"`. Express captures the text of the segment and does not coerce it. `req.params.id === 42` is false, and so is a numeric comparison against `req.query.page`. Query values are strings too, or an array of strings when the key is repeated. `?active=false` is the string `"false"`, which is truthy if you use it as a boolean. Convert with `Number()` or a schema, then reject values that do not convert. The limit of a bare `Number('me')` is `NaN`, so validate before you use the number.

## Cheat-card

- A route is a method, a path, and a handler: `app.get('/users/:id', fn)`.
- `req.params` is the `:id` segment. `req.query` is the part after `?`. Both are strings.
- Matching is top to bottom, and the first handler that responds wins. Specific paths go before generic ones.
- `express.Router()` is a mountable mini-app. `app.use('/base', router)` joins the paths. Paths inside the router are relative to that base.
- `app.route('/path')` chains `.get().put().delete()` on one path.
- `mergeParams: true` belongs on the child router, so it can see the parent's `:userId`. On a name clash, the child's value wins.
- Express 5 changed the path matcher. Audit wildcard and regex paths on upgrade.
- An optional parameter in Express 5 is `'/users{/:id}'`. `'/users/:id?'` throws `PathError: Unexpected ?` at startup. Lesson 53 has the rest.

## Good to know

- A user hits `GET /users/me` and the handler returns the wrong record when `/users/:id` was registered before `/users/me`, so `:id` captured the string `"me"`. Move the literal route above the dynamic one.
- Attach auth to only the admin routes by putting those routes on their own Router and calling `router.use(authMiddleware)`, or by passing the middleware when you mount that router. The rest of the app is untouched.
- path-to-regexp is 0.1.13 under Express 4.22.3, and 8.4.2 through the `router` package 2.2.0 under Express 5.3.0. Version 8 throws a `PathError` at registration for an unexpected `( ) [ ] ? + !` or a `*` without a name.

## Learn More

- [Routing expressjs.com](https://expressjs.com/en/guide/routing.html)
- [Basic routing expressjs.com](https://expressjs.com/en/starter/basic-routing.html)
- [Node.js Crash Course Tutorial #11 - Express Router & MVC Net Ninja](https://www.youtube.com/watch?v=zW_tZR0Ir3Q)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (Express 4.22.3 for comparison; supertest 7.3.1)*

### More routing: lesson 53

This lesson covers the routing you use every day. [Express Routing Extras](53-express-routing-extras.md) (lesson 53) covers the rest:

- `app.param` / `router.param`;
- RegExp routes and arrays of paths;
- the Express 5 path syntax and the exact `PathError` each old Express 4 pattern throws;
- what `req.baseUrl`, `req.path` and `req.originalUrl` contain at each level of nested routers;
- `next('route')` against `next('router')`, and `app.all`.

The two lessons share one rule. A route path is a pattern that path-to-regexp compiles into a regex: version 0.1.13 under Express 4.22.3, and 8.4.2 (through the `router` package 2.2.0) under Express 5.3.0. "Audit wildcard/regex paths on upgrade" means exactly the patterns version 8 rejects.

How it works:

1. `app.get(path, fn)` passes `path` to path-to-regexp when the route is registered, not when a request arrives.
2. Version 8 tokenises the string and throws a `PathError` (a subclass of `TypeError`) on a reserved character it does not expect: `( ) [ ] ? + !` or a `*` without a name.
3. So an Express 4 optional parameter (`:id?`) stops the app at startup. The Express 5 spelling wraps the optional part in braces: `'/users{/:id}'`.

**Example — an optional `:id` in both spellings, on Express 5.**

javascript

```
// optional.cjs: an optional :id, Express 4 spelling vs Express 5 spelling
const express = require('express');
const request = require('supertest');

const app = express();
try {
  app.get('/users/:id?', (req, res) => res.json(req.params));  // Express 4 spelling
} catch (err) {
  console.log(`'/users/:id?' -> ${err.constructor.name}: ${err.message.split(';')[0]}`);
}
app.get('/users{/:id}', (req, res) => res.json(req.params));   // Express 5 spelling

(async () => {
  for (const url of ['/users', '/users/42']) {
    const r = await request(app).get(url);
    console.log(`GET ${url} -> ${r.status} ${r.text}`);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   '/users/:id?' -> PathError: Unexpected ? at index 10: /users/:id?
//   GET /users -> 200 {}
//   GET /users/42 -> 200 {"id":"42"}
```

When `id` is missing, Express 5 leaves the key out of `req.params` (`{}`). Express 4 kept the key with the value `undefined`.

### Nested routers and `mergeParams`

Each Router builds its own `req.params` from the part of the URL that *it* matched. When a router is mounted at a path with a parameter, as in `app.use('/users/:userId/posts', postsRouter)`, the **parent** captures `userId` while matching the mount path. The child router then replaces `req.params` with its own captures, so by default `req.params.userId` is `undefined` inside the child. `express.Router({ mergeParams: true })` makes the child start from the parent's params and add its own on top. Without it, every nested resource (`/users/:userId/posts/:postId`) loses its parent id.

How it works:

1. `GET /users/7/posts/99` matches the mount layer `/users/:userId/posts`. The parent records `{ userId: '7' }` and strips the prefix, so the child sees `/99`.
2. The child matches its route `/:postId` and captures `{ postId: '99' }`.
3. Without `mergeParams`, `req.params` becomes `{ postId: '99' }`. With `mergeParams: true`, it becomes `{ userId: '7', postId: '99' }`.
4. When the request leaves the child, the parent's `req.params` comes back.

**Example — the same posts router with and without `mergeParams`.**

javascript

```
// merge.cjs: a nested posts router reads the parent's :userId
const express = require('express');
const request = require('supertest');

function postsRouter(options) {
  const posts = express.Router(options);
  posts.get('/:postId', (req, res) => {
    res.json({ userId: req.params.userId ?? null, postId: req.params.postId });
  });
  return posts;
}

const app = express();
app.use('/users/:userId/posts', postsRouter());                       // default
app.use('/v2/users/:userId/posts', postsRouter({ mergeParams: true })); // opt in

(async () => {
  for (const url of ['/users/7/posts/99', '/v2/users/7/posts/99']) {
    const res = await request(app).get(url);
    console.log(url.padEnd(22), res.status, res.text);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   /users/7/posts/99      200 {"userId":null,"postId":"99"}
//   /v2/users/7/posts/99   200 {"userId":"7","postId":"99"}
```

Express 4.22.3 prints the same two lines.

### Common mistakes & gotchas (additional topics)

- **Setting `mergeParams` on the parent instead of the child.** The option belongs to the router that needs to *read* the parent's params, which is the one you mount.
- **Reusing a parameter name in parent and child.** With `mergeParams: true`, the child's value wins (see the edge case below).
- **Copying `:id?` from Express 4 code into Express 5.** It throws `PathError: Unexpected ? at index 10` at startup. Use `'/users{/:id}'`. The reverse also fails: Express 4 treats `{/:id}` as literal text and answers 404, without any error.

### Edge case worked through: parent and child both call it `:id`

A child router mounted at `/users/:id/posts` with its own route `/:id` and `mergeParams: true` gets two values for one key: `'7'` from the parent and `'99'` from the child. Express merges the parent's params first and then the child's, so the child's capture overwrites the parent's and the user id is lost:

javascript

```
// clash.cjs: parent and child routers both call their parameter :id
const express = require('express');
const request = require('supertest');

const posts = express.Router({ mergeParams: true });
posts.get('/:id', (req, res) => res.json(req.params));

const app = express();
app.use('/users/:id/posts', posts);          // parent :id = user id

request(app).get('/users/7/posts/99').then((r) => console.log(r.status, r.text));

// Real output (Node v24.19.0, Express 5.3.0):
//   200 {"id":"99"}
```

Express 4.22.3 prints the same line. Name nested parameters after their resource (`:userId`, `:postId`) so each key is set by exactly one router.

### ⭐ Interview lens (additional topics)

> **Q: “Inside a router mounted at `/users/:userId/posts`, `req.params.userId` is `undefined`. Why, and what is the fix?”**  
> A: The parent captured `userId` while matching the mount path, but the child router sets `req.params` from its own match only. Create the child with `express.Router({ mergeParams: true })`. Then it starts from the parent's params and adds its own. A name used by both is resolved in favour of the child.
