---
title: "Middleware: the pipeline, next(), and order"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/middleware
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Middleware: the pipeline, next(), and order

*9 min read · Updated 24 Jul 2026 Topic 36 of 70 Bookmark Mark done Why it matters Middleware is the single most important concept in Express · Topic 36 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/middleware](https://www.geekyfrontend.in/learn/nodejs-backend-kit/middleware)

---

## Say it in 30 seconds

Middleware is a function Express calls with the request, the response, and a next function. It can change the request, send the response, or call next to pass the request down an ordered list. Parsing, logging, auth, and your route handlers are all this same kind of function. Middleware exists so you write each of those once instead of pasting them into every route. The trade-off is that the list runs in the order you wrote it. A function placed too late never sees the request, and a function that neither responds nor calls next leaves the client waiting.

## Why it matters

Middleware is the main idea in Express. Parsing bodies, logging, authenticating, CORS headers, errors, and your route logic are all functions in one ordered pipeline. Routing answers which code runs. Middleware answers what happens before it, and what runs only if that code calls `next()`. Interviewers ask it because someone who has only pasted `app.use(cors())` stalls when you ask why order matters or what `next()` does.

In practice, middleware is how you stop repeating yourself. An auth check, a request log, and a body parser are each written once and registered in the pipeline, instead of copied into forty handlers. Error handling, in the next lesson, is the same pipeline with one extra rule.

## The concept, simply

A middleware function has the signature `(req, res, next)`. Express calls it with the request, the response, and `next`. Inside, it can read or modify `req` and `res`, end the request by sending a response, or pass control on by calling `next()`. A middleware that neither responds nor calls `next()` hangs the request. The client waits until it times out. That is the most common Express bug, and it comes from breaking this contract.

Register it with `app.use(fn)` for every request, `app.use('/path', fn)` for paths that start with `/path`, or as an extra argument on one route, `app.get('/x', authCheck, handler)`. Express keeps all of these in one stack, in registration order. The request enters at the top and each function decides whether to continue.

![Nested boxes like an onion showing logger wrapping json body parser wrapping authenticate wrapping the route handler with the request travelling inward via next and the response unwinding outward](assets/i33_01_7f62f706.svg)

The picture is an onion. The request goes inward through the logger, then the body parser, then auth, each calling `next()`, until the route handler at the center. Code placed after a middleware's own `next()` call runs on the way back out. That is how a logger records a start time before `next()` and prints the duration after control returns.

## How it works

Express stores middleware in an ordered array and walks it with a cursor. It calls the first matching entry. The `next` function advances the cursor and calls the next match. Calling `next()` means "run the next middleware". If nothing calls `next()` and nothing responds, the cursor never moves and the request stalls. Calling `next()` twice can run later middleware twice, and two of them may both try to write headers.

![Decision diagram from middleware runs branching to res dot send which ends the chain to next which passes to the next middleware and to next of err which skips to the error handler](assets/i33_02_4aebd34f.svg)

`next()` is the decision. Respond and stop, call `next()` to continue, or call `next(err)` to jump to the error handler.

If you call `next` with any argument, `next(err)`, Express treats it as an error. It skips every remaining normal middleware and jumps to the error-handling middleware, the functions with four parameters, covered in the next lesson. One reserved string, `next('route')`, skips the rest of the current route and tries the next matching route. Anything else you pass to `next` is an error.

Registration order is the behavior. There is no priority system. Body parsers must be registered before routes that read `req.body`, or the body is still unparsed. Auth must come before the protected routes. A logger at the top sees every request. A logger at the bottom sees only requests that fell through everything else.

**Application-level** middleware is `app.use(fn)` and applies to the whole app. **Router-level** middleware is `router.use(fn)` and applies only to requests that reach that router, which is how you guard one subtree such as admin. **Route-level** middleware is an extra argument on a single route. **Built-in** middleware ships with Express: `express.json()`, `express.urlencoded()`, and `express.static()`. **Third-party** middleware comes from npm: `cors`, `helmet`, `morgan`, `express-rate-limit`. All of them are the same shape of function in the same stack.

## Code examples

**1. A custom logging middleware** that times the request using the onion shape.

javascript

```
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`-> ${req.method} ${req.url}`);
  res.on('finish', () => {             // runs when the response is sent
    console.log(`<- ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();                              // must call next, or the request hangs
});
```

**2. Authentication as middleware**, attaching data to `req` for later handlers.

javascript

```
function requireAuth(req, res, next) {
  const token = req.get('Authorization');
  if (!token) {
    return res.status(401).json({ error: 'No token' }); // ends the chain
  }
  req.user = decode(token);            // pass data downstream via req
  next();                              // continue to the handler
}

app.get('/profile', requireAuth, (req, res) => {
  res.json({ user: req.user });        // req.user was set by the middleware
});
```

**3. Application-level vs router-level scope.**

javascript

```
// app-level: every request
app.use(express.json());

// router-level: only requests under /admin
const admin = express.Router();
admin.use(requireAuth);               // guards the whole admin subtree
admin.get('/stats', (req, res) => res.json({ ok: true }));
app.use('/admin', admin);
```

**4. Common third-party stack**, in the order they should run.

javascript

```
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

app.use(helmet());                    // security headers first
app.use(cors());                      // CORS headers
app.use(morgan('dev'));               // request logging
app.use(express.json());              // body parsing
// ... routes registered AFTER the shared middleware ...
```

## Common mistakes & gotchas

- **Forgetting `next()`.** If you neither respond nor call `next()`, the request hangs. No error is thrown. The client times out.
- **Calling `next()` and also responding.** Downstream code may respond again, and Express throws "Cannot set headers after they are sent". Return after you respond: `return res.status(401).json(...)`.
- **Wrong order.** `express.json()` registered after a route leaves that route with `req.body === undefined`. Shared middleware goes first.
- **Heavy synchronous work.** Middleware runs on every matching request. A blocking call there slows the whole server.
- **Thinking `app.use('/api', fn)` matches only `/api`.** It matches every path that starts with `/api`, including `/api/users`. That is usually what you want.
- **Passing data in a surprising place.** `req.user` is fine. Overwriting core properties, or reading a property an earlier middleware never set, makes the chain brittle.

## Best practices

- Keep one registration order: security headers, CORS, logging, body parsing, routes, the 404 handler, then the error handler.
- `return` after you send a response, so control cannot fall through to `next()`.
- Scope it as narrowly as it needs to be. One route, a router subtree, or the whole app only when it truly is global.
- One job per middleware: log, or parse, or authenticate.
- Pass request data on `req`, such as `req.user` or `req.requestId`, not on globals. It stays tied to that request.
- Prefer `helmet`, `cors`, `express-rate-limit`, and `morgan` over a hand-rolled copy of the same job.

## ⭐ Interview lens

> **Q: "What is middleware in Express?"**  
> A: Middleware is a function `(req, res, next)` that Express runs while handling one request. It can read or change the request and response, end the request by sending a response, or call `next()` to continue. Parsing, logging, auth, route handlers, and error handlers are all middleware in one ordered stack. For example, a logger records the method and URL, then calls `next()`, and `express.json()` reads a JSON body onto `req.body` before your route runs. The limit is the contract. If the function neither responds nor calls `next()`, Express never moves on, and the client waits until it times out.

> **Q: "What does `next()` do, and what happens if I don't call it?"**  
> A: `next()` tells Express to run the next matching function in the stack. Express keeps a cursor. Calling `next()` advances it. If you omit `next()` and you also do not send a response, the cursor stays put. No error is thrown. The socket stays open until the client gives up. The usual fix is to call `next()` after side work such as logging, or to `return res.status(401).json(...)` when you are refusing the request. Do not do both. A response followed by `next()` lets a later function write headers that were already sent.

> **Q: "Why does middleware order matter?"**  
> A: Express walks the stack in the order you registered it, so position is behavior. There is no priority field. `express.json()` has to sit above any route that reads `req.body`, or that route sees `undefined`. An auth check has to sit above the routes it protects, or those routes run with no check. A logger at the top sees every request, including ones a later middleware rejects. A logger at the bottom sees only what fell through. The same rule is why a middleware added below a route looks like it "does not work". It never gets the request.

> **Q: "What is the difference between `next()` and `next(err)`?"**  
> A: `next()` with no argument continues to the next normal middleware or route. `next(err)`, or `next` with any value other than the reserved string `'route'`, is an error. Express skips the remaining normal middleware and jumps to the next error handler, which is a function written with four parameters: `(err, req, res, next)`. `next('route')` is the exception. It skips the rest of the handlers for the current route and tries the next route that matches. For example, a handler can call `next(err)` when a database call fails, and the central error handler chooses the status code. The limit is that a three-parameter function is never treated as an error handler, even if its first parameter is named `err`.

## Cheat-card

- Middleware is `(req, res, next)`. Read or modify, respond, or call `next()`.
- No `next()` and no response means the request hangs. If you respond, do not also call `next()`.
- `next()` continues. `next(err)` jumps to the error handler. `next('route')` tries the next matching route.
- Order is behavior. Shared middleware goes before routes.
- Scopes: `app.use` for the app, `router.use` for a subtree, an inline argument for one route, plus built-in and third-party functions of the same shape.
- The request flows inward through `next()`. Code after `next()` in a middleware runs on the way back out.
- Pass data onward on `req`, such as `req.user`, not on globals.
- A practical order is helmet, then cors, then a logger, then `express.json()`, then routes, then a 404 handler, then the error handler.
- `express.static` answers only when the file exists. Otherwise it calls `next()`. Put it early, after logging and before sessions, auth, and body parsers. Lesson 55 covers it.

## Good to know

- Application-level middleware is `app.use` and runs for the whole app. Router-level middleware is `router.use` on an `express.Router()` and runs only for requests that reach that router. `adminRouter.use(requireAuth)` guards that subtree and leaves other routes alone.
- If you call `res.json(data)` and then `next()` in the same middleware, the response is already sent. When a later handler also writes, Express throws "Cannot set headers after they are sent to the client". Return after you respond.
- `next('router')` was added in Express 4.15.0. It leaves the current router and continues after its mount point. From app-level middleware it ends in Express's final 404.

## Learn More

- [Using middleware expressjs.com](https://expressjs.com/en/guide/using-middleware.html)
- [Writing middleware for use in Express apps expressjs.com](https://expressjs.com/en/guide/writing-middleware.html)
- [Learn Express Middleware In 14 Minutes Web Dev Simplified](https://www.youtube.com/watch?v=lY6icfhap2o)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0*

### `next('router')`: leaving a whole router

`next('router')` is the second reserved string for `next` (added in Express 4.15.0). It tells the router that is currently running "skip everything else you have", so control returns to the parent stack, right after the `app.use('/panel', router)` line that mounted it. `next('route')` is narrower: it skips only the remaining handlers of the *current route* and lets the same router try its next matching route. Without `next('router')`, a router-level guard that decides "this request is not for me" can only respond (for example `403`) or call `next()`, which runs the router's own remaining middleware and routes. That is wrong when a later part of the app should answer, such as a public version of the same URL.

How it works:

1. The app's stack reaches `app.use('/panel', admin)`, strips `/panel`, and starts walking `admin`'s own stack.
2. A function inside `admin` calls `next('router')`.
3. `admin` stops walking its stack. None of its remaining middleware or routes run, and the URL prefix is restored.
4. The app continues with the next entry after the mount, as if `admin` had called `next()` at its very end.
5. `next('route')` in a route handler skips only that route's remaining handlers. The router then tries the next route that matches the same path.
6. Called in app-level middleware, `next('router')` leaves the app's own router, so nothing else in the app runs and Express's final handler answers `404 Cannot GET …`.

**Example — `next('route')` vs `next('router')`, with the functions that ran.**

javascript

```
// next-router.cjs: next('route') skips to the next matching route; next('router') leaves the whole router.
// npm install express@5 supertest
const express = require('express');
const request = require('supertest');

const app = express();
const trail = [];                                          // which functions ran, per request
const step = (name) => (req, res, next) => { trail.push(name); next(); };

// next('route'): only the rest of THIS route's handlers are skipped
app.get('/users/:id',
  (req, res, next) => { trail.push('route1.check'); if (req.params.id === 'me') return next('route'); next(); },
  (req, res) => { trail.push('route1.byId'); res.json({ handler: 'by id' }); });
app.get('/users/:id', (req, res) => { trail.push('route2'); res.json({ handler: 'second route' }); });

// next('router'): every remaining middleware and route inside this router is skipped
const admin = express.Router();
admin.use((req, res, next) => {
  trail.push('admin.gate');
  if (req.get('X-Role') !== 'admin') return next('router');   // not for us: hand back to the app
  next();
});
admin.use(step('admin.audit'));
admin.get('/stats', (req, res) => { trail.push('admin.stats'); res.json({ from: 'admin router' }); });
app.use('/panel', admin);
app.get('/panel/stats', (req, res) => { trail.push('app.publicStats'); res.json({ from: 'app, after the router' }); });

// next('router') in app-level middleware leaves the app's router: Express's final 404
app.use('/bail', (req, res, next) => { trail.push('app.bail'); next('router'); });
app.use(step('app.after-bail'));

(async () => {
  const cases = [
    ['/users/42', {}], ['/users/me', {}],
    ['/panel/stats', { 'X-Role': 'admin' }], ['/panel/stats', {}],
    ['/bail', {}],
  ];
  for (const [url, headers] of cases) {
    trail.length = 0;
    const res = await request(app).get(url).set(headers);
    const body = res.type === 'application/json' ? JSON.stringify(res.body) : res.text.match(/<pre>(.*)<\/pre>/)?.[1];
    console.log(`GET ${url} ${JSON.stringify(headers)} -> ${res.status} ${body}\n    ran: ${trail.join(' > ')}`);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1; identical with Express 4.22.3):
//   GET /users/42 {} -> 200 {"handler":"by id"}
//       ran: route1.check > route1.byId
//   GET /users/me {} -> 200 {"handler":"second route"}
//       ran: route1.check > route2
//   GET /panel/stats {"X-Role":"admin"} -> 200 {"from":"admin router"}
//       ran: admin.gate > admin.audit > admin.stats
//   GET /panel/stats {} -> 200 {"from":"app, after the router"}
//       ran: admin.gate > app.publicStats
//   GET /bail {} -> 404 Cannot GET /bail
//       ran: app.bail
```

For `/users/me`, `next('route')` skipped `route1.byId` but the second `/users/:id` route still ran. For `/panel/stats` without the header, `next('router')` skipped `admin.audit` and `admin.stats` and the app's own `/panel/stats` route answered.

### `express.static` in the middleware order

`express.static(root)` is a built-in middleware that answers `GET` and `HEAD` requests whose path names an existing file under `root`, and calls `next()` for everything else: missing files, other methods, directories without an index file. That "answer or step aside" behaviour is the `fallthrough: true` default. Because it is ordinary middleware, its position in the stack decides two things: which middleware runs before a file is served, and which later routes get the requests it did not answer. Lesson 55, [Serving Static Files with express.static](55-express-serving-static-files.md), covers the options, caching, the SPA fallback and the security checks.

How it works:

1. The request walks the stack in registration order, as for any middleware.
2. When it reaches `express.static`, the path (minus any mount prefix) is resolved under the root and checked.
3. If a file is there, the middleware streams it and the request ends. Nothing registered later runs.
4. If not, it calls `next()`, and the request continues to the middleware and routes registered after it.
5. Middleware registered *before* `express.static` runs for every asset request, which is why loggers usually come first and auth, sessions and body parsers usually come after it (unless the files themselves are private).

**Example — `express.static` before and after an auth middleware.**

javascript

```
// static-order.cjs: where express.static sits in the pipeline, and how a miss falls through.
// npm install express@5 supertest; public/style.css must exist: mkdir public; echo 'body{margin:0}' > public/style.css
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const trail = [];
const logger = (req, res, next) => { trail.push('logger'); next(); };
const requireAuth = (req, res, next) => {
  trail.push('auth');
  if (req.get('Authorization') !== 'Bearer t0ken') return res.status(401).json({ error: 'login first' });
  next();
};
const routes = express.Router();
routes.get('/report.css', (req, res) => { trail.push('route /report.css'); res.type('css').send('/* generated */'); });
const notFound = (req, res) => { trail.push('404'); res.status(404).json({ error: 'not found' }); };
const serveStatic = express.static(path.join(__dirname, 'public'));
const staticStep = (req, res, next) => { trail.push('static'); serveStatic(req, res, next); };   // same middleware, logged

// A: static early. Files are answered before auth; misses fall through to auth and the routes.
const early = express();
early.use(logger, staticStep, requireAuth, routes, notFound);

// B: static after auth. Every asset request now needs a token.
const late = express();
late.use(logger, requireAuth, staticStep, routes, notFound);

(async () => {
  for (const [label, app] of [['A static early', early], ['B static late ', late]]) {
    for (const [url, auth] of [['/style.css', false], ['/report.css', true], ['/report.css', false], ['/nope.css', true]]) {
      trail.length = 0;
      const req = request(app).get(url);
      if (auth) req.set('Authorization', 'Bearer t0ken');
      const res = await req;
      console.log(`${label} GET ${url.padEnd(11)} token=${String(auth).padEnd(5)} -> ${res.status}  ran: ${trail.join(' > ')}`);
    }
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   A static early GET /style.css  token=false -> 200  ran: logger > static
//   A static early GET /report.css token=true  -> 200  ran: logger > static > auth > route /report.css
//   A static early GET /report.css token=false -> 401  ran: logger > static > auth
//   A static early GET /nope.css   token=true  -> 404  ran: logger > static > auth > 404
//   B static late  GET /style.css  token=false -> 401  ran: logger > auth
//   B static late  GET /report.css token=true  -> 200  ran: logger > auth > static > route /report.css
//   B static late  GET /report.css token=false -> 401  ran: logger > auth
//   B static late  GET /nope.css   token=true  -> 404  ran: logger > auth > static > 404
```

In A, `/style.css` exists, so the chain stopped at `static` and auth never ran. `/report.css` is not on disk, so `static` called `next()` and the request fell through to auth and then to the route that generates it. In B the same public stylesheet needs a token, because auth now sits in front of it.

### Common mistakes & gotchas (additional topics)

- **Using `next('router')` where `next('route')` was meant.** `next('router')` skips every remaining route in the router, not just the current one.
- **Calling `next('router')` in app-level middleware.** It leaves the app's router, so no later app middleware runs and the client gets Express's final `404 Cannot GET …` (the `/bail` case above).
- **Misspelling the string.** Only the exact strings `'route'` and `'router'` are special. `next('Router')` is treated as an error, so the error handler receives the string `"Router"` (edge case below).
- **Putting `express.static` after sessions, body parsers or auth.** Every image and script request then pays for them, and public assets can end up behind a login (case B).
- **Expecting `express.static` to answer a miss with 404.** By default it calls `next()`. Your 404 handler, or a route registered later, answers instead.
- **A route that shadows a file, or a file that shadows a route.** Whichever is registered first wins: with static first, a `public/report.css` would stop the `/report.css` route from ever running.

### Edge case worked through: `next('router')` with nothing after the router

The question: a guard in a router calls `next('router')`, but the app has no route after the mount that matches the same URL. Where does the request end up?

1. `admin.gate` calls `next('router')`, and `admin` returns control to the app right after `app.use('/panel', admin)`.
2. The app keeps walking its stack. If nothing later matches `/panel/stats`, the stack runs out.
3. When the app's stack runs out, Express's final handler answers `404` with `Cannot GET /panel/stats`, exactly as for an unknown URL. The `/bail` case in the example shows the same result when `next('router')` is called from app-level middleware: the trail stops at `app.bail` and the response is `404 Cannot GET /bail`.

The run below checks this, next to an explicit `403` and a misspelt string:

javascript

```
// edge.cjs: next('router') from a guard when nothing after the mount matches, vs an explicit 403.
const express = require('express');
const request = require('supertest');

function adminRouter(onRefuse) {
  const admin = express.Router();
  admin.use((req, res, next) => (req.get('X-Role') === 'admin' ? next() : onRefuse(req, res, next)));
  admin.get('/stats', (req, res) => res.json({ ok: true }));
  return admin;
}

const hidden = express();
hidden.use('/panel', adminRouter((req, res, next) => next('router')));   // nothing after the mount
const explicit = express();
explicit.use('/panel', adminRouter((req, res) => res.status(403).json({ error: 'admins only' })));
const typo = express();
typo.use('/panel', adminRouter((req, res, next) => next('Router')));     // not the reserved string
typo.use((err, req, res, next) => res.status(500).json({ error: `next() got ${JSON.stringify(err)}` }));

(async () => {
  for (const [label, app] of [['next(\'router\')', hidden], ['403        ', explicit], ['next(\'Router\')', typo]]) {
    const res = await request(app).get('/panel/stats');
    console.log(label, '->', res.status, res.type === 'application/json' ? JSON.stringify(res.body) : res.text.match(/<pre>(.*)<\/pre>/)?.[1]);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   next('router') -> 404 Cannot GET /panel/stats
//   403         -> 403 {"error":"admins only"}
//   next('Router') -> 500 {"error":"next() got \"Router\""}
```

So `next('router')` from a guard looks like "this URL does not exist", not like "access denied". That is useful when you do not want to reveal that an admin route exists. When the client needs to know the request was refused, send a `403` instead.

### ⭐ Interview lens (additional topics)

> **Q: “What is the difference between `next('route')` and `next('router')`?”**  
> A: `next('route')` skips the remaining handlers of the current route, and the same router continues with its next matching route. `next('router')` skips everything left in the current router and returns to the parent stack after the mount point. Use it when a router-level check decides the request belongs to another part of the app. *Trap:* from app-level middleware, `next('router')` exits the app's router and produces Express's final 404.

> **Q: “Where do you put `express.static` and why?”**  
> A: Early, usually right after logging and security headers, and before sessions, body parsers and auth, so asset requests do not pay for them and public files stay public. It only answers when the file exists; otherwise it calls `next()` and later routes still run. Private files go behind auth, often with `res.sendFile` in a route instead.
