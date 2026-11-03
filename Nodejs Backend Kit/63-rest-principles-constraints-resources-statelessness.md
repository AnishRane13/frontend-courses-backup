---
title: "REST Principles: Constraints, Resources & Statelessness"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/rest-principles
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# REST Principles: Constraints, Resources & Statelessness

*12 min read · Updated 24 Jul 2026 Topic 39 of 70 Bookmark Mark done Why it matters Almost every backend job description asks you to · Topic 39 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/rest-principles](https://www.geekyfrontend.in/learn/nodejs-backend-kit/rest-principles)

---

## Say it in 30 seconds

REST, short for representational state transfer, is a way to design an API so the client sends a picture of a resource, usually JSON, and the server applies it. A resource is any named thing, such as a user or an order: the URL names it, and the HTTP method names the action. It exists so clients, caches, and extra servers can work without remembering the last call. The trade-off is that full REST, where the response includes links for what to do next, is rare in real JSON APIs.

## Why it matters

Almost every backend job asks you to build and consume REST APIs. Browsers, mobile apps, and services talk to each other this way. If you understand the constraints, you can design an interface a stranger can use without reading your source.

Most people treat REST as JSON over HTTP. That is just HTTP. REST is an architectural style from Roy Fielding's year-2000 dissertation: a set of constraints that buy scalability, cacheability, and the ability to change the server and the client separately.

A stateful API that stores per-user data in server memory cannot be load-balanced across machines. An API that ignores the uniform interface forces every client to be hand-coded against your quirks. Those are the difference between an API that scales and one that falls over.

## The concept, simply

A client transfers representations of resource state with the server. The resource lives on the server. What crosses the wire is a picture of it at one moment, usually JSON or HTML.

REST has six constraints. Five are required. One is optional. Accepting them is what makes an API RESTful.

- **Client-server:** the user interface and the data storage evolve separately.
- **Stateless:** each request carries everything the server needs. The server keeps no memory of previous requests.
- **Cacheable:** responses say whether they can be stored and reused.
- **Uniform interface:** resources have URIs, you change them by sending representations, messages describe themselves, and hypermedia drives what the client does next. That last part is called HATEOAS.
- **Layered system:** the client cannot tell whether it reached the origin server or a proxy, gateway, or cache in between.
- **Code on demand (optional):** the server may send executable code, such as JavaScript, to extend the client.

![Grid of the six REST constraints with Uniform Interface highlighted](assets/i36_01_4e8d3a7b.svg)

The six REST constraints. Five are required. Only code on demand is optional. The uniform interface is the one most APIs get wrong.

The shortcut: REST is about nouns. You do not have `/getUser` and `/deleteUser`. You have `/users/42`, and you use GET or DELETE on it. The URL names the thing. The method names the action.

## How it works (deep)

**Statelessness** means the server stores no client session between requests. Every request contains what the server needs to process it, typically an auth token, not a pointer to memory on the server. Your database is still full of state. The conversation is stateless. Because request N does not depend on the server remembering request N-1, any of ten identical servers can handle it. You can add servers behind a load balancer, restart one, and route each request anywhere.

A JWT or a cookie that carries the token is state that lives on the client and is sent every time. The server checks it and forgets it. An old server-side session, where the cookie is only an id pointing at memory on that machine, is stateful. It needs sticky sessions or a shared session store.

**The uniform interface** has four parts. Identification: each resource has a stable URI, such as `/orders/9`. Manipulation through representations: the client sends a JSON body describing the new state. It does not edit the resource in place. Self-descriptive messages: the method, `Content-Type`, and status code are enough to understand the message alone. HATEOAS, hypermedia as the engine of application state: the response includes links that tell the client what it can do next, so the client discovers actions instead of hard-coding URLs.

**HATEOAS** is the least implemented part, and Fielding treated an API without it as not truly REST. Instead of the client memorizing `POST /orders/9/pay`, the order document contains a link such as `{ "rel": "pay", "href": "/orders/9/pay" }`. The server can move the URL and the client still works. Very few JSON APIs do this fully, because it adds complexity clients rarely use. A fair interview line is that full HATEOAS is rare, and most teams ship a pragmatic REST-ish API with hard-coded routes.

**Cacheability and the layered system** work together. If a response says it can be cached, through `Cache-Control`, `ETag`, or `Last-Modified`, a proxy can answer later requests without the origin seeing them. The client cannot tell whether it hit the origin or a CDN. That invisibility is the layered system, and it is why a well-labeled REST API gets CDN speed without extra code.

## Code examples

A minimal resource-oriented Express router. Notice the URL names a noun and the HTTP method carries the intent — there is no verb in the path.

javascript

```
const express = require('express');
const router = express.Router();

// Resource: the "users" collection and its members
router.get('/users', listUsers);        // read the collection
router.post('/users', createUser);       // create a member
router.get('/users/:id', getUser);       // read one member
router.put('/users/:id', replaceUser);   // replace one member
router.delete('/users/:id', deleteUser); // remove one member

module.exports = router;
```

Statelessness in practice: the server reads the identity from the token on *every* request and holds nothing between calls. No `req.session`, no in-memory user map.

javascript

```
const jwt = require('jsonwebtoken');

// Auth middleware — stateless: the token IS the context
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    // Verified fresh each request; server keeps no memory of it afterwards
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
```

A HATEOAS-flavored response — the resource tells the client what it can do next, instead of the client hard-coding paths.

javascript

```
function getOrder(req, res) {
  const order = { id: 9, status: 'pending', total: 4200 };

  res.json({
    ...order,
    _links: {
      self:   { href: `/orders/${order.id}` },
      pay:    { href: `/orders/${order.id}/pay`,    method: 'POST' },
      cancel: { href: `/orders/${order.id}/cancel`, method: 'POST' },
    },
  });
}
```

And a self-descriptive, cacheable response using an `ETag` so a proxy or the browser can revalidate cheaply:

javascript

```
function getProduct(req, res) {
  const product = { id: 7, name: 'Keyboard', version: 3 };
  const etag = `"prod-${product.id}-v${product.version}"`;

  res.set('Cache-Control', 'public, max-age=60');
  res.set('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end(); // Not Modified — client reuses its copy
  }
  res.json(product);
}
```

## Common mistakes & gotchas

- **Verbs in URLs:** `/getUser`, `/createOrder`, `/api/deleteUser?id=3`. The method already carries the verb. The path is a noun. A verb in the path is an RPC API wearing a REST costume. RPC means you call a remote function.
- **Treating stateless as "no database."** Statelessness is about per-client session data on the server. Persistence in the database is fine.
- **Sessions in process memory.** A module-level map of logins breaks as soon as two instances run. That is a statelessness violation.
- **Mixed plurals:** `/user/42` next to `/orders/9`. Pick plural collection nouns and stay with them.
- **Calling hard-coded URLs HATEOAS.** Hard-coded routes are common and fine. They are not HATEOAS.
- **Infinite nesting:** `/users/1/orders/9/items/3/reviews/2`. Nest one level for ownership, then link.

## Best practices

- Model nouns as resources and use HTTP methods as the verbs.
- Use plural collection names (`/users`, `/orders`) and identify members by id (`/users/42`).
- Carry auth in a token. If you need shared session data, put it in Redis or the database, never in process memory.
- Declare cacheability with `Cache-Control` and `ETag`.
- Nest one level. Beyond that, return links or use query filters.
- Add `_links` where they help a client discover an action. Do not pretend the whole API is HATEOAS.
- Pick REST when resources map cleanly to create, read, update, and delete and you want HTTP caching. Reach for gRPC or GraphQL when that fit is poor.

## REST vs RPC vs GraphQL

![Three-column comparison of REST resource-oriented RPC action-oriented and GraphQL query-oriented](assets/i36_02_af6f2f0c.svg)

REST names resources, RPC names actions, and GraphQL lets the client shape the response.

**RPC** (remote procedure call, for example gRPC) is action-oriented. You call a remote function such as `getUser(42)` or `chargeCard(...)`, usually by POSTing to one endpoint per procedure. It fits internal service-to-service traffic when you control both ends, want a typed contract such as Protobuf, and do not need HTTP caching. **GraphQL** exposes one endpoint and lets the client ask for the fields it needs. That addresses over-fetching, which is getting fields you do not use, and under-fetching, which is needing several round trips. The cost is that HTTP caching and simple status codes get harder, because everything is a POST that returns 200. **REST** sits in the middle: resource-oriented, cache-friendly, and usable with curl or a browser. A strong answer: REST for public, cacheable, CRUD-shaped resources; gRPC for high-throughput internal calls; GraphQL when many clients need differently shaped reads from one graph.

## ⭐ Interview lens

> **Q: What does "stateless" really mean in REST, and why do we want it?**  
> Stateless means the server keeps no client session between requests. Each request carries everything needed to process it, usually an auth token in a header. The application still has state in the database. Users, orders, and balances live there. What the server does not keep is "this browser was in the middle of a conversation." For example, ten identical servers can sit behind a load balancer, and any of them can handle the next call, because none of them has to remember the last one. You can restart a machine without logging people out. The limit is a cookie that is only an id pointing at memory on one machine. That design is stateful. It needs sticky sessions, where the balancer always sends that user to the same machine, or a shared store such as Redis.

> **Q: Name the REST constraints. Which is optional?**  
> The six constraints are client-server, stateless, cacheable, uniform interface, layered system, and code on demand. Code on demand is the only optional one. It means the server may send code, such as JavaScript, for the client to run. The uniform interface is the one that makes an API feel like REST, and it has four parts: a stable URI for each resource, changes sent as a representation such as JSON, messages that carry their own method and content type, and HATEOAS, links in the response that say what the client can do next. For example, `/orders/9` plus GET or DELETE, with `Content-Type` and a status code, is the uniform interface in daily use. The limit is that naming the six words is not the same as using them. An API that stores the session in process memory has already dropped statelessness, whatever it says on the slide.

> **Q: What is HATEOAS and do real APIs use it?**  
> HATEOAS means hypermedia as the engine of application state. The response includes links that tell the client the next legal actions, so the client follows links the way a person follows a web page. For example, an order with status pending can include `{ "rel": "pay", "href": "/orders/9/pay" }`, and the client posts to that href instead of memorizing the path. If the server renames the path, clients that follow the link keep working. Fielding treated an API without this as not really REST. The limit is that full HATEOAS is rare in JSON APIs. Most teams hard-code the routes, ship a REST-ish API, and accept that trade-off. Calling a plain JSON body HATEOAS is the mistake.

> **Q: How do you decide between REST and GraphQL?**  
> REST fits when the data is resources you create, read, update, and delete, and you want HTTP caching, status codes, and tools as simple as curl. GraphQL fits when many different clients each need a different slice of the same graph, so a fixed REST response would over-fetch, sending fields they do not use, or under-fetch, forcing extra round trips. For example, a mobile screen that needs a user, three orders, and one field of each product can ask for exactly that in one GraphQL query. The limit is that GraphQL usually sends everything as a POST that returns 200, so caches and status-code monitoring do less of the work for you. gRPC is the third option when both sides are yours and you want a typed remote function call.

## Cheat-card

- REST means representational state transfer. It is an architectural style, not "JSON over HTTP."
- Six constraints: client-server, stateless, cacheable, uniform interface, layered system, code on demand (optional).
- Resources are nouns. HTTP methods are the verbs.
- Stateless means no server-side session between requests. The database can still hold state.
- Uniform interface: identify resources, change them through representations, self-descriptive messages, HATEOAS.
- HATEOAS means the response links to the next actions. Rare in real JSON APIs.
- REST, RPC, and GraphQL: nouns, actions, and client-shaped queries.
- Plural collection names, shallow nesting, explicit cache headers.

## Good to know

- Built-in ETag: `res.send` and `res.json` add `W/"<len hex>-<sha1 prefix>"` unless you set `ETag` first. `app.set('etag', 'strong' | false | fn)` changes it (lesson 52).
- A 304 happens only for GET and HEAD, and also QUERY in Express 5.3.0, with a 2xx status and a matching `If-None-Match`. Express strips the body and the `Content-*` headers.
- `req.fresh` uses a weak compare and understands lists and `*`. It is false when the request has `Cache-Control: no-cache`, or when the response has no `ETag` or `Last-Modified` yet.
- Q: Is a JWT-based auth API stateful? No. The token is state the client holds and sends each request. The server checks it and forgets it. A server-side session, where the cookie is an id pointing at server memory, is stateful.
- Q: Why is `POST /users/deleteAll` not RESTful? The path contains a verb, and POST is used for a destructive bulk action. Model the resources and use DELETE, or make the bulk action its own resource.
- Q: Does Express support conditional GET, and what does a 304 cost? Yes. `res.send` and `res.json` add a weak ETag, and a matching `If-None-Match` becomes a 304 with no body, only for GET and HEAD (QUERY too in Express 5.3.0) with a 2xx status. It saves bandwidth, not work: the tag is a hash of the finished body, so the handler has already run. POST and 404 responses still get an ETag. They never become 304.
- Q: Why does a 304 test pass with curl and fail with `fetch`? With the default cache mode, a hand-written `If-None-Match` makes `fetch` switch to `no-store` and add `Cache-Control: no-cache`, and `fresh` then refuses the 304. Use `cache: 'no-cache'`, curl, or supertest.

---

## Learn More

- [REST - MDN Web Docs Glossary developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Glossary/REST)
- [An overview of HTTP developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [Web API Design Best Practices - Azure Architecture Center learn.microsoft.com](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [REST API concepts and examples WebConcepts](https://www.youtube.com/watch?v=7YcW25PHnAA)
- [APIs for Beginners - How to use an API (Full Course / Tutorial) freeCodeCamp.org](https://www.youtube.com/watch?v=WXsD0ZgxjRw)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (etag 1.8.1, fresh 2.0.0), supertest 7.3.1, curl 8.18.0*

### Express's built-in ETag, `req.fresh` and a real 304

The last code example above builds an ETag by hand and compares it with `If-None-Match` itself. Express already does most of this for you. Every body sent through `res.send` (and so `res.json`) gets an `ETag` header unless you set one first. When the request carries a matching `If-None-Match`, Express turns the response into `304 Not Modified` and drops the body. The client keeps its cached copy, and the server skips sending the bytes. It does not skip the work: by the time `res.json` runs, your handler has already loaded the data and built the body. The `etag` setting controls the tag: `'weak'` (default), `'strong'`, `false`, or your own function. Lesson 52 covers the setting itself ([Express app settings and locals](52-express-app-settings-and-locals.md#how-it-works)); this section follows one request through it.

How it works:

1. Your handler calls `res.json(obj)`. Express serialises it, then calls `res.send` with the string.
2. `res.send` reads the compiled `etag fn` setting. If the response has no `ETag` yet and the body has a length, Express converts it to a Buffer and calls the function. The default weak tag is `W/"<byte length in hex>-<first 27 chars of the base64 SHA-1 of the body>"`. The `etag` package computes it (empty bodies get a fixed tag).
3. It sets the header. The method and status are not checked here, so POST responses and 404s get an ETag too.
4. It reads `req.fresh`. That getter returns `false` unless the method is GET or HEAD (or QUERY, added in Express 5.3.0), and the status is 2xx or 304. Otherwise it asks the `fresh` package. `fresh` returns `false` when the request has `Cache-Control: no-cache`. It returns `true` when an `If-None-Match` entry equals the response ETag under the weak comparison (the `W/` prefix is ignored). It also returns `true` for `*`, and handles comma-separated lists. A `Last-Modified` response header is checked against `If-Modified-Since` only when there is no `If-None-Match`.
5. If fresh, the status becomes 304. On 204 and 304 Express removes `Content-Type`, `Content-Length` and `Transfer-Encoding` and sends an empty body: a 304 "cannot contain content" (RFC 9110 section 15.4.5).
6. `res.end`, `res.write` streams and `res.sendFile` do not go through this path. `res.sendFile` and `express.static` use the `send` package, which has its own `etag` option.

**Example — the default weak ETag, a 304 with no body, and `req.fresh` before the expensive work.**

javascript

```
// etag-server.cjs: Express's built-in ETag, req.fresh and a real 304.
const express = require('express');
const crypto = require('node:crypto');

const app = express(); // 'etag' setting defaults to 'weak'
const product = { id: 7, name: 'Keyboard', version: 3 };

// 1. Plain res.json: Express hashes the body and adds a weak ETag.
app.get('/products/7', (req, res) => {
  res.set('Cache-Control', 'no-cache'); // cache it, but revalidate every time
  res.json(product);
});

// 2. Same body from POST and from a 404: they get an ETag too, but never a 304.
app.post('/products/7', (req, res) => res.json(product));
app.get('/missing', (req, res) => res.status(404).json(product));

// 3. req.fresh before doing the expensive work: set a cheap validator first.
app.get('/reports/1', (req, res) => {
  res.set('ETag', `"report-1-v${product.version}"`);
  console.log(`GET /reports/1  If-None-Match=${req.get('If-None-Match') ?? '(none)'}  req.fresh=${req.fresh}`);
  if (req.fresh) return res.status(304).end(); // skip building the report
  res.json({ report: 1, rows: 3 });            // ETag already set, so Express keeps ours
});

// Recompute the default weak tag by hand to show what it contains.
const body = Buffer.from(JSON.stringify(product));
const hash = crypto.createHash('sha1').update(body).digest('base64').slice(0, 27);
console.log(`by hand: W/"${body.length.toString(16)}-${hash}"`);

app.listen(6701, () => console.log('listening on 6701'));

// Real output (Node v24.19.0, Express 5.3.0), server console after the curl session below:
//   by hand: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"
//   listening on 6701
//   GET /reports/1  If-None-Match=(none)  req.fresh=false
//   GET /reports/1  If-None-Match="report-1-v3"  req.fresh=true
```

Run `node etag-server.cjs`, then in a second terminal:

bash

```
$ curl -i http://127.0.0.1:6701/products/7
HTTP/1.1 200 OK
X-Powered-By: Express
Cache-Control: no-cache
Content-Type: application/json; charset=utf-8
Content-Length: 38
ETag: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"
Date: Mon, 12 Oct 2026 14:19:46 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"id":7,"name":"Keyboard","version":3}

$ curl -i http://127.0.0.1:6701/products/7 -H 'If-None-Match: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"'
HTTP/1.1 304 Not Modified
X-Powered-By: Express
Cache-Control: no-cache
ETag: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"
Date: Mon, 12 Oct 2026 14:19:46 GMT
Connection: keep-alive
Keep-Alive: timeout=5

$ curl -s http://127.0.0.1:6701/products/7 -H 'If-None-Match: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"' | wc -c
0
$ curl -s -o /dev/null -w '%{http_code} %header{etag}\n' -X POST http://127.0.0.1:6701/products/7 -H 'If-None-Match: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"'
200 W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"
$ curl -s -o /dev/null -w '%{http_code} %header{etag}\n' http://127.0.0.1:6701/missing -H 'If-None-Match: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"'
404 W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6701/products/7 -H 'If-None-Match: W/"26-+GyA9lnaTi2EzHo6sG46htTRQx0"' -H 'Cache-Control: no-cache'
200
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6701/reports/1
200
$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6701/reports/1 -H 'If-None-Match: "report-1-v3"'
304
```

What the transcript shows:

- `26` is the body length in hex (38 bytes, matching `Content-Length: 38`), and the hash matches the one computed by hand.
- The 304 has the same `ETag` and `Cache-Control` but no `Content-Type` or `Content-Length`, and `wc -c` counts 0 body bytes.
- POST and the 404 carry the identical tag but answer 200 and 404: `req.fresh` is `false` for them.
- `Cache-Control: no-cache` on the request (a browser hard reload sends it) forces a full 200.
- `/reports/1` sets its own strong ETag from a version number before doing any work. `req.fresh` is only meaningful after the response has an `ETag` (or `Last-Modified`), so set the validator first and read `req.fresh` second.

How this relates to the manual `getProduct` example above: it sets its own `ETag`, so Express keeps it and does not hash the body (step 2 only runs when no `ETag` is set). Its `===` check is a shortcut that skips `res.json` on an exact match. When the check misses, `res.json` still runs `req.fresh` and can still answer 304, as the edge case below shows.

### Common mistakes & gotchas (additional topics)

- **Reading `req.fresh` before setting a validator.** It compares against the response's `ETag`/`Last-Modified`. With neither set, it is always `false`, even when the client sent a correct `If-None-Match`.
- **Expecting the default ETag to save database work.** It is computed from the finished body, so the handler has already run. To skip the work, derive a tag from something cheap (a version or `updated_at` column) and check `req.fresh` first, like `/reports/1`.
- **Testing a 304 with Node's `fetch` and a hand-set `If-None-Match`.** Under the Fetch standard, a request with the default cache mode that carries a conditional header is switched to `no-store`. `fetch` then adds `Cache-Control: no-cache` (and `Pragma: no-cache`), so Express answers 200. Use curl or supertest, or pass `cache: 'no-cache'`, which sends `Cache-Control: max-age=0` instead:

javascript

```
// fetch-gotcha.cjs: testing a conditional GET with Node's built-in fetch.
const express = require('express');

const app = express();
app.get('/p', (req, res) => {
  console.log(`  server saw Cache-Control: ${req.get('Cache-Control') ?? '(none)'}`);
  res.json({ id: 7 });
});

const server = app.listen(6704, async () => {
  const url = 'http://127.0.0.1:6704/p';
  const etag = (await fetch(url)).headers.get('etag');
  for (const cache of ['default', 'no-cache']) {
    console.log(`fetch cache: '${cache}', If-None-Match: ${etag}`);
    const r = await fetch(url, { cache, headers: { 'If-None-Match': etag } });
    console.log(`  -> ${r.status}`);
  }
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0):
//     server saw Cache-Control: (none)
//   fetch cache: 'default', If-None-Match: W/"8-eE+TghVu0lqfC5QQKmjMzwJAx2U"
//     server saw Cache-Control: no-cache
//     -> 200
//   fetch cache: 'no-cache', If-None-Match: W/"8-eE+TghVu0lqfC5QQKmjMzwJAx2U"
//     server saw Cache-Control: max-age=0
//     -> 304
```

- **Assuming `app.set('etag', false)` turns off 304s.** It only stops Express generating tags. A route that sets its own `ETag` still gets 304s from `res.send`.

### Edge case worked through: the manual `===` check versus `req.fresh`

The lesson's `getProduct` compares the raw header string with its tag. Clients do not always echo the exact string: a cache may send a weak form (`W/"prod-7-v3"`), or a list of several tags it holds. The script below runs the lesson function unchanged (plus one counter line) next to a `req.fresh` version. It counts how often each one reaches its body-building path.

javascript

```
// manual-vs-fresh.cjs: the lesson's getProduct (string ===) next to the same route using req.fresh.
const express = require('express');
const request = require('supertest');

const built = { manual: 0, fresh: 0 };
function getProduct(req, res) {                 // copied from the Code examples above
  const product = { id: 7, name: 'Keyboard', version: 3 };
  const etag = `"prod-${product.id}-v${product.version}"`;
  res.set('Cache-Control', 'public, max-age=60');
  res.set('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }
  built.manual++;                               // added: count how often the body path runs
  res.json(product);
}

function getProductFresh(req, res) {            // same, but let Express compare
  const product = { id: 7, name: 'Keyboard', version: 3 };
  res.set('Cache-Control', 'public, max-age=60');
  res.set('ETag', `"prod-${product.id}-v${product.version}"`);
  if (req.fresh) return res.status(304).end();
  built.fresh++;
  res.json(product);
}

const app = express();
app.get('/manual', getProduct);
app.get('/fresh', getProductFresh);

(async () => {
  for (const inm of ['"prod-7-v3"', 'W/"prod-7-v3"', '"prod-7-v2", "prod-7-v3"', '"prod-7-v2"']) {
    const a = await request(app).get('/manual').set('If-None-Match', inm);
    const b = await request(app).get('/fresh').set('If-None-Match', inm);
    console.log(`If-None-Match: ${inm.padEnd(26)} manual === -> ${a.status} (body path runs: ${built.manual})   req.fresh -> ${b.status} (body path runs: ${built.fresh})`);
    built.manual = built.fresh = 0;
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, supertest 7.3.1):
//   If-None-Match: "prod-7-v3"                manual === -> 304 (body path runs: 0)   req.fresh -> 304 (body path runs: 0)
//   If-None-Match: W/"prod-7-v3"              manual === -> 304 (body path runs: 1)   req.fresh -> 304 (body path runs: 0)
//   If-None-Match: "prod-7-v2", "prod-7-v3"   manual === -> 304 (body path runs: 1)   req.fresh -> 304 (body path runs: 0)
//   If-None-Match: "prod-7-v2"                manual === -> 200 (body path runs: 1)   req.fresh -> 200 (body path runs: 1)
```

All four status codes agree. The manual version is not wrong for the client: when `===` misses, `res.json` evaluates `req.fresh` and still sends 304. The difference is the work done. For the weak form and the list, the manual route runs the body path anyway, because `===` cannot see that `W/"prod-7-v3"` and `"prod-7-v2", "prod-7-v3"` both match. With a real database behind it, that is a query you hoped to skip. `req.fresh` applies the weak comparison and list handling from RFC 9110 section 13.1.2, so use it instead of string equality.

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
