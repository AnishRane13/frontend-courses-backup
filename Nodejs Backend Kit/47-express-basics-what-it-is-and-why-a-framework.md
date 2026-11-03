---
title: "Express basics: what it is and why a framework"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-basics
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Express basics: what it is and why a framework

*10 min read · Updated 24 Jul 2026 Topic 34 of 70 Bookmark Mark done Why it matters Express is the framework the Node · Topic 34 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-basics](https://www.geekyfrontend.in/learn/nodejs-backend-kit/express-basics)

---

## Say it in 30 seconds

Express is a small web framework that turns an HTTP request into a response by walking an ordered list of functions. You call express, you get an app, and that app is the function Node's http server calls for every request. It exists so you do not rewrite URL matching, body reading, and JSON responses in every project. The trade-off is that Express does not choose your database, your login system, or your folder layout. You add those yourself.

## Why it matters

For more than a decade Express has been the usual way to build an HTTP API in Node. A large share of production services are Express apps, or they sit on tools that copied this shape. NestJS runs on Express by default. Serverless handlers are often thin Express apps. In a backend interview, "write a small Express endpoint" is very likely, and the question behind it is why you would not use raw `http`.

The idea to hold is that a web framework walks an incoming request through an ordered pipeline of small functions until one of them writes the response. Routing, middleware, errors, and the `req` and `res` objects are that one system, not four separate topics.

## The concept, simply

Express is a minimal, unopinionated web framework for Node.js. Minimal means the core does only a few jobs. It gives you a router, which matches an HTTP method plus a URL path to a function. It gives you a middleware pipeline, which runs an ordered list of functions on a request. And it adds helpers on the request and response, such as `req.params` and `res.json()`. Database access, authentication, validation, and templates are libraries you add. Unopinionated means Express gives you the spine and lets you choose the rest.

Node already ships an `http` module that can run a server. With raw `http` you check `req.method` and `req.url`, split the path, match routes, buffer the body, parse JSON, set headers, and stringify the response. Every app rebuilds that plumbing, and the plumbing is where bugs live. Express is that plumbing, written once.

![Side by side comparison showing raw http requires you to parse URLs match routes buffer bodies and set headers by hand while Express provides routing body parsing and response helpers](assets/i31_01_536a2185.svg)

With raw `http` you own every step from bytes to a response. Express supplies routing, parsing, and helpers so you write your own logic.

Picture an Express app as a stack of functions a request falls through. Each function gets the request, the response, and a `next` function that passes control onward. Some functions do a little work and step aside, such as logging, parsing, or an auth check. One of them finally writes the response.

## How it works

`express()` returns an application object, usually called `app`. That object is itself a request handler. It matches the callback Node's `http.createServer()` expects. `app.listen(3000)` is essentially `http.createServer(app).listen(3000)`. Express does not replace Node's HTTP server. It is the handler you hand to that server. An Express `req` is still a Node `IncomingMessage`, and `res` is still a `ServerResponse`. Express adds methods on top.

Inside `app` is a middleware stack: an ordered array. Each entry can have a path pattern, an HTTP method, and a handler. On every request Express walks the array from top to bottom. If the method and path match, it calls the handler with `(req, res, next)`. The handler either responds, which ends the walk, or calls `next()`, which means keep walking. `next(err)` jumps to the error handlers.

![Flow diagram of a request passing through client then middleware then router then handler then reply back to client with each layer receiving req res and next](assets/i31_02_2b6379fc.svg)

Every layer receives `(req, res, next)` and either responds or calls `next()`. An error jumps to the error handler.

`app.get('/users', fn)` is middleware with a method and a path attached. There is no separate route system bolted on. Routes are middleware that match one method and one path. That is why order matters, why `next()` behaves the same everywhere, and why a middleware registered too late never runs for the route above it.

Express 5 keeps this same model. It drops some deprecated Express 4 method names, changes the path-matching library so unusual regex-style paths are written differently, requires a modern Node, and forwards a rejected promise from an async handler into the error pipeline. A few request details changed too. `req.body` stays `undefined` when no body parser matched. `req.query` is a read-only getter. The default query parser is `"simple"`, so `?a[b]=c` is no longer a nested object. The examples in this chapter run on both versions unless noted.

## Code examples

**1. The smallest useful Express app.** Four lines to a running JSON API.

javascript

```
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ message: 'Hello from Express' });
});

app.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

**2. The same endpoint with raw `http`** — to feel exactly what Express saves you from.

javascript

```
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from raw http' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
});

server.listen(3000);
```

Notice what you had to do by hand: check the method, check the URL, set the status and `Content-Type` header, and stringify the body — and you already need a manual 404 branch. Add a second route with a URL parameter and the raw version balloons; the Express version just gains one line.

**3. A slightly fuller app** showing an application-wide middleware, two routes, and a start-up log.

javascript

```
const express = require('express');
const app = express();

// runs on EVERY request, before any route
app.use(express.json());               // parse JSON bodies into req.body
app.use((req, res, next) => {          // a tiny logger
  console.log(`${req.method} ${req.url}`);
  next();                              // hand control to the next layer
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/echo', (req, res) => {
  res.status(201).json({ youSent: req.body });
});

app.listen(3000);
```

**4. ESM instead of CommonJS.** Modern projects with `"type": "module"` import Express the same way conceptually.

javascript

```
import express from 'express';

const app = express();
app.get('/', (req, res) => res.send('ok'));
app.listen(3000);
```

## Common mistakes & gotchas

- **Thinking Express replaces `http`.** It sits on top. `req` and `res` are still the Node objects, so `res.end()` and `req.headers` still work.
- **Forgetting body parsing.** Out of the box `req.body` is `undefined`. Register `express.json()` or `express.urlencoded()` before routes that read a body.
- **Registering middleware after the route that needs it.** Express walks top to bottom. A middleware below a handler never runs for that handler.
- **Confusing "minimal" with "incomplete".** Leaving out a database or auth layer is the design. Those are separate packages.
- **Blocking the event loop.** A big synchronous loop or sync crypto inside a handler stalls every other request. Express does not move that work off the loop.

## Best practices

- Create `app` in one file and call `app.listen()` in another, so tests can import the app without opening a port.
- Register parsers and shared middleware first, then routes, then the 404 handler, then the error handler.
- Pin the Express major version, and read the migration notes before moving from 4 to 5. The path matcher and async errors are the parts that bite.
- Use Express when you want control and the ecosystem around it. Fastify is the throughput alternative. NestJS is the opinionated, structured alternative. They share this same request pipeline.
- Do not hand-roll CORS, security headers, or compression. Use `cors`, `helmet`, and `compression`.

## ⭐ Interview lens

> **Q: "What is Express and what does it actually add over Node's `http` module?"**  
> A: Express is a small web framework on top of Node's built-in HTTP server. Calling `express()` gives you an app object, and that object is the function you would otherwise pass to `http.createServer`. On each request Express walks an ordered stack, runs the entries whose method and path match, and gives each one `(req, res, next)`. It also adds helpers such as `req.params` and `res.json()`, so you stop writing URL matching, body buffering, and JSON headers by hand. For example, `app.get('/')` plus `res.json()` replaces a hand-written method check, a `Content-Type` header, and `JSON.stringify`. The limit is that Express adds the pipeline and the helpers only. It does not choose your database, auth, or validation, and it does not give you extra threads.

> **Q: "How does a request flow through an Express app?"**  
> A: Express keeps one ordered stack of middleware and route handlers. A request starts at the top. For each entry, Express checks the HTTP method and the path. On a match it calls the function with the request, the response, and `next`. If that function writes a response, the walk stops. If it calls `next()` with no argument, Express moves to the next match. If it calls `next(err)`, Express skips the remaining normal functions and jumps to the error handlers, which are the functions with four parameters. A logger registered first sees every request. `express.json()` registered after a route is invisible to that route. There is no priority number. Code order is the order.

> **Q: "Are routes and middleware different things?"**  
> A: A route handler is middleware that also matches one HTTP method and one path. `app.get('/users', fn)` and `app.use(fn)` live in the same stack and receive the same `(req, res, next)`. `app.use` runs for every method, or for a path prefix if you pass one. `app.get` runs only for GET and only when the path matches. That is why `next()` means the same thing in a logger and in a route, and why a route registered above a middleware never sees that middleware. The limit people hit is thinking there is a separate router phase after middleware. There is not. The first function that responds ends the walk for both.

> **Q (trap): "Express handles concurrency for you, right?"**  
> A: No. Express is ordinary single-threaded Node. Many requests overlap only because input and output are asynchronous. The process starts the work, and the event loop runs another request while it waits. A CPU-heavy loop or synchronous crypto inside a handler freezes every request, including ones that only needed the network. Express does not create a thread per request. If you need parallel CPU work, that is worker threads, several processes, or moving the heavy job somewhere else. The framework will not do it for you.

## Cheat-card

- `const app = express()` creates an app that is also an HTTP request handler.
- `app.listen(port)` is `http.createServer(app).listen(port)`.
- Express is a router, a middleware pipeline, and helpers on `req` and `res`. It is minimal and unopinionated.
- A route is middleware with a method and a path. Same stack, same `next()`.
- `req` is a Node `IncomingMessage`. `res` is a `ServerResponse`. Both are extended.
- `req.body` stays empty until you add `express.json()` or `express.urlencoded()`.
- Order is code order. Shared middleware goes before routes.
- Express 5 keeps the same model, forwards async rejections, and uses a new path matcher.
- `app.set(name, value)` writes a setting. `app.get(name)` with one argument reads it. `app.get(path, fn)` is a route. Lesson 52 lists the settings.
- `app.locals` lasts for the life of the app. `res.locals` lasts for one request.

## Good to know

- Is Express opinionated? Deliberately not. It gives you routing and middleware, and leaves the database, auth, validation, and folder structure to you. Small apps stay easy. Large teams often add their own conventions, or they pick NestJS, to get that structure back.
- What changed in Express 5? The core model is the same. Express 5 removed deprecated 4.x method names, upgraded path-to-regexp so some wildcard and regex path syntax changed, requires a newer Node, and forwards rejected promises from async handlers to the error middleware. `req.body` stays `undefined` when no parser matched, `req.query` is a read-only getter, and the default query parser is `"simple"`.
- Express 5 reached a stable release in 2024 to 2025 after years as `5.0-beta`.

## Learn More

- [Hello world example expressjs.com](https://expressjs.com/en/starter/hello-world.html)
- [Express 4.x API Reference expressjs.com](https://expressjs.com/en/4x/api.html)
- [Express JS Crash Course Traversy Media](https://www.youtube.com/watch?v=L72fhGm1tfE)
- [Learn Express JS In 35 Minutes Web Dev Simplified](https://www.youtube.com/watch?v=SccSCuHhOw0)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (same output on 4.22.3)*

### App settings and app.locals (summary; full lesson: 86)

Every app object carries a settings table, `app.settings`, which maps names to values. `app.set(name, value)` writes an entry, and `app.get(name)` called with **one** argument reads it back. Called with a path and a handler, `app.get` is the GET route method you already know; Express tells the two apart by the number of arguments. About a dozen names are reserved because Express reads them while handling requests: `trust proxy` (what `req.ip` and `req.protocol` report behind a proxy), `etag`, `query parser` (Express 5 default `'simple'`, Express 4 `'extended'`), `x-powered-by`, `case sensitive routing`, `strict routing`, `json spaces`, `views` and `view engine`. Any other name is just stored. `app.locals` is a separate object that lives as long as the app; `res.render` passes its properties to every template, and `req.app.locals` reaches it from a handler. Data that belongs to one request goes on `res.locals`, never on `app.locals`.

Lesson 52 ([Express App Settings and Locals](52-express-app-settings-and-locals.md)) runs every setting on Express 5 and 4, shows sub-app inheritance, and reproduces the `app.locals` leak with two concurrent requests.

How it works:

1. `express()` creates `app.settings` and fills in the defaults: `x-powered-by` `true`, `etag` `'weak'`, `env` from `NODE_ENV`, `query parser`, `trust proxy` `false`, `views` `<cwd>/views`.
2. `app.set` overwrites an entry, and `app.enable` / `app.disable` are shorthands for `true` / `false`.
3. Express reads each reserved entry while it handles a request. `res.json` reads `json spaces` on every call. The routing settings are read only once, when the first route is added, so put `app.set` calls before your routes.
4. `app.locals` is one object for the whole app, shared by every request.

**Example — `app.set`, both meanings of `app.get`, and `app.locals`.**

javascript

```
// settings-locals.cjs: app.set / app.get (one argument) and app.locals.
const express = require('express');

const app = express();
app.set('json spaces', 2);              // reserved setting: res.json indents with 2 spaces
app.set('title', 'Shop API');           // your own setting: Express only stores it
app.locals.startedAt = '2026-10-10';    // same value for every request

app.get('/about', (req, res) => {       // path + handler: this app.get is the GET route method
  res.json({
    title: req.app.get('title'),        // one argument: this app.get reads a setting
    startedAt: req.app.locals.startedAt,
    jsonSpaces: app.get('json spaces'),
  });
});

app.get('/health');                     // one argument, no handler: a settings READ, not a route

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(`${base}/about`);
  console.log(r.status, r.headers.get('x-powered-by'));
  console.log(await r.text());
  console.log('GET /health ->', (await fetch(`${base}/health`)).status);
  console.log('app.get("/health") ->', app.get('/health'));
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0):
//   200 Express
//   {
//     "title": "Shop API",
//     "startedAt": "2026-10-10",
//     "jsonSpaces": 2
//   }
//   GET /health -> 404
//   app.get("/health") -> undefined
```

### Common mistakes & gotchas (additional topics)

- **Setting routing options after the routes.** `case sensitive routing` and `strict routing` are read when the first route is added; later changes do nothing.
- **Request data on `app.locals`.** It is shared by every request, so concurrent requests overwrite each other's values. Use `res.locals`.
- **Assuming the Express 4 query parser.** On Express 5 `?a[b]=c` gives `{ 'a[b]': 'c' }` unless you `app.set('query parser', 'extended')`.

### Edge case worked through: `app.get` with only a path

`app.get('/health')` in the example has a path and no handler. Express counts one argument and treats it as a settings read: it returns the value stored under the name `'/health'` (`undefined`) and registers nothing. The output shows the result: `GET /health -> 404` and `app.get("/health") -> undefined`. A route needs at least one handler after the path.

### ⭐ Interview lens (additional topics)

> **Q: “What does `app.get('json spaces')` do, given that `app.get` defines routes?”**  
> A: With one argument `app.get` is the settings getter, so it returns the stored value (`2` after `app.set('json spaces', 2)`). With a path and handlers it registers a GET route. *Trap:* a path with no handler is a settings read, so no route is created.

> **Q: “`app.locals` or `res.locals` for the logged-in user?”**  
> A: `res.locals`. It is created for each request and discarded with the response. `app.locals` is one object for the app's lifetime, so a value put there by one request is seen by the next.
