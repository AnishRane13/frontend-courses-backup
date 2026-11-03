---
title: "CRUD, HTTP Verbs, Status Codes & Idempotency"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/crud-status-codes
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# CRUD, HTTP Verbs, Status Codes & Idempotency

*11 min read · Updated 24 Jul 2026 Topic 40 of 70 Bookmark Mark done Why it matters The difference between an API that feels professional and one that feels amateur is almost entirely in the details of this topic · Topic 40 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/crud-status-codes](https://www.geekyfrontend.in/learn/nodejs-backend-kit/crud-status-codes)

---

## Say it in 30 seconds

CRUD is create, read, update, and delete, and HTTP gives each one a method and a success code: POST answers 201, GET answers 200, PUT or PATCH answers 200 or 204, and DELETE answers 204. Idempotent means one call and many identical calls leave the server in the same state, which is true of GET, PUT, and DELETE, and not of POST, because each POST can create another row. You follow this so caches, retries, and monitoring can trust the method and the status. The trade-off is that a retried POST needs an idempotency key, or it can create or charge twice.

## Why it matters

The method, the status code, and idempotency decide whether clients, caches, and dashboards behave. A browser will cache a response you marked 200 when it should have been an error. A dashboard that counts 5xx will miss an outage you returned as 200 with `{"error": true}`. A payment client that retries a non-idempotent request can charge a customer twice.

"What status do you return when the resource already exists?" and "Is PUT idempotent? Is POST?" are standard backend questions. The reasoning matters more than the yes or no. Networks fail, clients retry, and only idempotent operations survive a retry without corruption.

## The concept, simply

CRUD is the four operations most resources support. Each one has a conventional success status.

![Table mapping CRUD to HTTP verbs success codes and idempotency](assets/i37_01_0ff846bf.svg)

Each CRUD operation maps to an HTTP verb, a success code, and a safety or idempotency property.

- **Create** is `POST /users`, then **201 Created**, plus a `Location` header pointing at the new resource.
- **Read** is `GET /users/42`, then **200 OK**, or 404 if it does not exist.
- **Update** is `PUT /users/42` for a full replace, or `PATCH /users/42` for a partial change, then **200 OK** with the body, or **204 No Content** if you return nothing.
- **Delete** is `DELETE /users/42`, then **204 No Content**, or 200 if you return a body.

A method is **safe** if it does not change server state. GET is safe. A method is **idempotent** if one call and many identical calls leave the server in the same final state. GET, PUT, and DELETE are idempotent. POST is not.

## How it works (deep)

**Idempotency is about server state, not the response bytes.** `DELETE /users/42` can return 204 the first time and 404 the second time. The responses differ. After either call, user 42 is gone. That is still idempotent.

**POST is not idempotent** because `POST /orders` means "create a new order." The server picks a new id each time. Two calls create two orders. You cannot know whether the first call succeeded before the network dropped, so a blind retry is dangerous.

**PUT is idempotent because the client picks the URL.** `PUT /users/42` means "make the resource at this URL equal this body." Ten identical calls leave user 42 in that same state. POST lets the server pick the identity, so repetition creates more rows.

**PATCH is usually not idempotent.** `{ "op": "increment", "field": "views" }` adds one on every call. A "set field X to Y" PATCH is idempotent only if you designed it that way. JSON Patch operations such as "add to array" are not. Treat PATCH as non-idempotent unless you have made it so.

**Idempotency keys** make a POST safe to retry. The client sends a unique `Idempotency-Key` per logical operation. The server stores the result under that key. A retry with the same key returns the stored result instead of creating a second charge. Stripe is the usual example.

**Status code families.** 2xx means success. 3xx means redirection or a cached copy. 4xx means the caller must fix the request. 5xx means the server failed a valid request. Monitoring and on-call depend on that line.

![Five status code families 1xx through 5xx with example codes](assets/i37_02_b53e0eaa.svg)

The five families. 4xx is the caller's fault. 5xx is the server's fault.

Know these 4xx codes: **400** malformed, **401** not authenticated, **403** authenticated but not allowed, **404** not found, **409** conflict with current state, **422** well-formed but semantically invalid, **429** too many requests. On the success side: **200**, **201**, **204**, and **304** Not Modified.

**401 means "I do not know who you are."** Log in or send a new credential. **403 means "I know who you are, and you still cannot do this."** Logging in again will not help. **400** is for a request that does not parse, such as broken JSON. **422** is for a request that parses and fails a business rule, such as a negative age. **409** is for a collision with current state, such as an email that is already registered, or an edit of a row someone else changed.

## Code examples

A full CRUD controller with correct verbs and status codes. Note `201` plus `Location` on create, and `204` on delete.

javascript

```
const express = require('express');
const router = express.Router();

// CREATE — 201 + Location header, body is the new resource
router.post('/users', async (req, res) => {
  const user = await User.create(req.body);
  res.status(201)
     .location(`/users/${user.id}`)
     .json(user);
});

// READ one — 200 or 404
router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.status(200).json(user);
});

// REPLACE — PUT is idempotent: set the resource to this exact state
router.put('/users/:id', async (req, res) => {
  const user = await User.replace(req.params.id, req.body);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.status(200).json(user);
});

// DELETE — idempotent; 204 with empty body
router.delete('/users/:id', async (req, res) => {
  await User.remove(req.params.id); // no-op if already gone
  res.status(204).end();
});

module.exports = router;
```

Returning the right 4xx for the right reason — distinguishing 401, 403, 409, and 422:

javascript

```
router.post('/orders', authenticate, async (req, res) => {
  // 403: authenticated but not permitted
  if (!req.user.canOrder) {
    return res.status(403).json({ error: 'Not allowed to place orders' });
  }
  // 422: well-formed but semantically invalid
  if (req.body.quantity <= 0) {
    return res.status(422).json({ error: 'Quantity must be positive' });
  }
  // 409: conflicts with current state
  const existing = await Order.findByIdempotencyRef(req.body.ref);
  if (existing) {
    return res.status(409).json({ error: 'Order already exists', id: existing.id });
  }
  const order = await Order.create(req.body);
  res.status(201).location(`/orders/${order.id}`).json(order);
});
```

Making an unsafe POST safely retriable with an idempotency key — the pattern Stripe uses:

javascript

```
router.post('/charges', async (req, res) => {
  const key = req.headers['idempotency-key'];
  if (!key) return res.status(400).json({ error: 'Idempotency-Key required' });

  // Already processed this key? Return the SAME result — no double charge.
  const prior = await IdempotencyStore.get(key);
  if (prior) return res.status(prior.status).json(prior.body);

  const charge = await paymentGateway.charge(req.body);
  const result = { status: 201, body: charge };

  await IdempotencyStore.save(key, result); // persist keyed on the client's key
  res.status(result.status).json(result.body);
});
```

A PATCH that is deliberately *non-idempotent* — incrementing a counter — to make the property concrete:

javascript

```
// Each call adds 1: calling it 3 times != calling it once. NOT idempotent.
router.patch('/posts/:id/views', async (req, res) => {
  const post = await Post.increment(req.params.id, 'views', 1);
  res.status(200).json({ views: post.views });
});
```

## Common mistakes & gotchas

- **Returning 200 for errors** with an `{ "error": ... }` body. Caches, clients, and monitoring all trust the status line.
- **Swapping 401 and 403.** 401 means not authenticated. 403 means authenticated and still forbidden.
- **Using 400 for every validation failure.** 400 means unparseable. 422 means parsed and invalid.
- **Treating idempotent as "same response."** It means the same server state. A second DELETE that returns 404 is still idempotent.
- **Retrying POST with no idempotency key.** A retried create can duplicate an order or a charge.
- **Using PUT for a partial update.** PUT replaces the whole resource. Omitted fields get wiped. Use PATCH for a partial change.
- **201 with no `Location` header.** The client cannot find the new resource.
- **Side effects on GET.** GET must be safe. Prefetchers and crawlers will trigger those effects.

## Best practices

- Map create to POST, read to GET, full replace to PUT, partial update to PATCH, and delete to DELETE.
- Return 201 plus `Location` on create, 204 when there is no body, and 200 when you return the resource.
- Keep 4xx and 5xx honest. Monitoring depends on that line.
- Prefer 422 for validation errors, 409 for state conflicts, and keep 401 distinct from 403.
- Make writes safe to retry. PUT and DELETE already are. Wrap a create or a charge in an `Idempotency-Key`.
- Keep GET free of writes.
- Return one machine-readable error body with the status (lesson 66).

## ⭐ Interview lens

> **Q: Is PUT idempotent? Is POST? Why?**  
> PUT is idempotent. It means "make the resource at this client-chosen URL equal this representation." Sending the same PUT ten times leaves that resource in the same state, because the client already picked the identity. POST is not idempotent. It means "create a new resource," and the server picks a new id each time, so two identical POSTs become two orders. For example, `PUT /users/42` with the same body converges, and `POST /orders` diverges. The limit is PATCH. A patch that increments a counter changes state on every call. A patch that sets one field to a value is idempotent only when you designed it that way. Treat PATCH as non-idempotent unless you can show the final state does not depend on how many times it ran.

> **Q: DELETE returns 204 the first time and 404 the second. Is it still idempotent?**  
> Yes. Idempotent means the effect on server state of many identical calls equals the effect of one. It does not mean the response bytes match. After the first DELETE, user 42 is gone and the server answers 204. After the second, user 42 is still gone and the server answers 404 because there is nothing left to delete. The state matches. For example, a client that retries a DELETE after a timeout cannot create a second deletion. The limit is a DELETE handler that does extra work with its own identity, such as inserting a new audit row with a new id on every call. The user is still gone, but the rest of the database changed again, so that handler is not idempotent.

> **Q: 401 vs 403?**  
> 401 means the server does not know who you are. The credential is missing or bad, and the client should log in or refresh it. 403 means the server knows who you are and still refuses the action. Sending the password again will not help. For example, a logged-out call to place an order is 401, and a logged-in user who is not allowed to order is 403. The limit of swapping them is client behaviour. A client that sees 401 will try to authenticate again. A client that sees 403 will stop. Returning 403 for a missing token teaches the client not to log in. The status line is what HTTP libraries and gateways branch on. A sentence in the JSON body does not repair a swapped code.

> **Q: How do you make a "create payment" endpoint safe to retry?**  
> Accept an `Idempotency-Key` header. The client generates one unique key per logical payment, not per HTTP attempt. The server stores the result under that key. If the same key arrives again, the server returns the stored status and body and does not charge a second time. That is the pattern Stripe uses, and it turns a non-idempotent POST into something a timeout can retry. For example, the first call charges and saves `{ status: 201, body }`. The retry hits the store and returns that same 201. The limit is the key's lifetime and scope. A key reused for a different payment would return the old charge, and a key that is never stored, because the process crashed before the save, can still double-charge. Persist the key before you call the gateway, or in the same transaction as the charge record.

## Cheat-card

- Create: POST, 201, and `Location`. Read: GET, 200 or 404. Update: PUT or PATCH, 200 or 204. Delete: DELETE, 204.
- Safe: GET. Idempotent: GET, PUT, DELETE. Not idempotent: POST, and usually PATCH.
- Idempotent means the same server state after N calls, not the same response.
- 401 who are you. 403 you cannot. 404 not here. 409 conflict. 422 invalid. 429 rate limited.
- 4xx is the caller's fault. 5xx is the server's fault.
- A retry-safe POST stores the result under an `Idempotency-Key`.
- PUT replaces the whole resource. PATCH changes part of it.

## Good to know

- HEAD and OPTIONS are automatic on a route that has GET. HEAD runs the GET handler and drops the body. OPTIONS replies `Allow: GET, HEAD`. A wrong method is 404, not 405, until you add it.
- 405 is `app.route(path).get(...).all(handler)` plus an `Allow` header, which RFC 9110 requires on a 405. Answer OPTIONS inside `.all()`.
- 415 is the wrong `Content-Type`, checked with `req.is`. 428 means `If-Match` was required and missing (RFC 6585). 412 means `If-Match` is stale. The compare is strong, so a weak ETag does not match.
- Q: Which status for "email already registered" on signup? 409 Conflict, because the request collides with current state. Some teams use 422. 200 and 400 do not fit. Pick one and keep it.
- Q: Why not return 200 with `{ "success": false }`? Status codes are the contract for caches, load balancers, retries, and monitoring. A 200 error stays invisible to them, so dashboards stay green during an outage and clients can cache the failure.
- Q: How do you stop two users overwriting each other without a lock? Optimistic concurrency. GET returns a strong ETag from a version. PUT or PATCH must send `If-Match`. A changed resource answers 412, and the client re-reads. Require `If-Match` with 428, or clients that omit it skip the check. Compare inside the UPDATE `WHERE` so it is atomic. A weak ETag or `req.fresh` is the wrong tool. `If-Match` needs the strong comparison.
- Q: Does Express return 405 for an unsupported method? No. It answers 404 `Cannot DELETE /path`, because no route matched. It does answer OPTIONS (`Allow: GET, HEAD`) and HEAD through the GET handler. Add `.all()` after the methods on `app.route()` and set `Allow`.

---

## Learn More

- [HTTP response status codes developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status)
- [HTTP request methods developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods)
- [Learn HTTP Status Codes In 10 Minutes Web Dev Simplified](https://www.youtube.com/watch?v=wJa5CTIFj7U)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (router 2.2.0), supertest 7.3.1, curl 8.18.0*

### HEAD, OPTIONS, 405 + `Allow`, 415, and `If-Match` (412 / 428)

The verbs above cover CRUD. Clients also send methods that ask about a resource instead of changing it. **HEAD** is a GET that returns only the headers, for example to check size or ETag without downloading. **OPTIONS** asks which methods the resource supports; the answer goes in the `Allow` header. Express answers both for you on any route that has a GET.

When a method is not supported, HTTP has a code for it: **405 Method Not Allowed**, which "MUST generate an Allow header field" (RFC 9110 section 15.5.6). Express does not send it. A wrong method falls through every route and reaches the final handler, which answers **404**. You add 405 yourself.

Three more codes guard writes:

- **415 Unsupported Media Type:** the body is in a format the endpoint does not accept.
- **412 Precondition Failed:** the client sent `If-Match: "<etag it last read>"` and the resource has changed since. This is optimistic concurrency. Nobody holds a lock; a writer with a stale copy is refused instead of silently overwriting the other client's change (the "lost update").
- **428 Precondition Required** (RFC 6585 section 3): the server requires the request to be conditional, and the client sent no `If-Match` at all. Without it, a client that never sends `If-Match` bypasses the whole check.

How it works:

1. **HEAD:** Express's router treats a HEAD request as GET when the route has no `.head()` handler. Your GET handler runs in full (database work included). `res.send` sets `Content-Length` and `ETag` as usual, then calls `res.end()` without the body.
2. **OPTIONS:** if no route handles OPTIONS for the path, the router collects the methods of every route that matches the path (adding HEAD wherever GET exists). It replies `200` with `Allow: GET, HEAD` and the same list as a `text/plain` body.
3. **Wrong method:** no route matches, so Express's final handler sends `404` with the HTML page `Cannot DELETE /plain`.
4. **405:** `app.route(path).get(…).put(…).all(handler)` puts the catch-all after the real methods on the same route. Anything that reaches `.all()` gets `405` and `Allow`. Because `.all()` matches every method, the route now "handles" OPTIONS too. The automatic OPTIONS reply no longer happens, so answer OPTIONS inside `.all()`.
5. **415:** `req.is('application/json')` checks the request `Content-Type` (it returns `null` when there is no body).
6. **`If-Match`:** the server sends a strong ETag derived from a version number. On PUT it checks, in order: 415 → 428 if `If-Match` is missing → 412 if no listed tag equals the current one. Then it writes and bumps the version. RFC 9110 section 13.1.1 requires the **strong** comparison for `If-Match`, so a weak `W/"…"` tag never passes, unlike `If-None-Match`.

**Example — automatic HEAD and OPTIONS, default 404, then 405, 415, 428 and 412.**

javascript

```
// verbs-server.cjs: automatic HEAD/OPTIONS, default 404 vs 405 + Allow, 415, and If-Match (412 / 428).
const express = require('express');

const app = express();
app.use(express.json());

// --- A plain route: Express answers HEAD and OPTIONS for it by itself.
app.get('/plain', (req, res) => {
  console.log(`GET handler ran for ${req.method} /plain`); // HEAD runs this handler too
  res.json({ hello: 'world' });
});

// --- One document with a version number; the ETag is derived from the version.
const doc = { id: 1, title: 'Draft', version: 1 };
const tagOf = (d) => `"v${d.version}"`;            // strong ETag: no W/ prefix

// RFC 9110 13.1.1: If-Match uses the STRONG comparison, so W/"..." never matches.
function ifMatchPasses(header, currentTag) {
  if (header.trim() === '*') return true;          // "any current version"
  return header.split(',').map((t) => t.trim()).includes(currentTag);
}

const ALLOW = 'GET, HEAD, PUT, OPTIONS';

app.route('/docs/1')
  .get((req, res) => {
    res.set('ETag', tagOf(doc));
    res.json(doc);                                 // Express also handles HEAD via this handler
  })
  .put((req, res) => {
    if (!req.is('application/json')) {             // 415: we only accept JSON bodies
      return res.status(415).json({ error: 'Send application/json' });
    }
    const ifMatch = req.get('If-Match');
    if (!ifMatch) {                                // 428 (RFC 6585 section 3): we require a precondition
      return res.status(428).json({ error: 'Send If-Match with the ETag you last read' });
    }
    if (!ifMatchPasses(ifMatch, tagOf(doc))) {     // 412: somebody changed it since you read it
      return res.status(412).set('ETag', tagOf(doc)).json({ error: 'Stale ETag', current: tagOf(doc) });
    }
    doc.title = String(req.body?.title ?? doc.title);
    doc.version += 1;
    res.set('ETag', tagOf(doc)).json(doc);
  })
  .all((req, res) => {                             // every other method on this path
    if (req.method === 'OPTIONS') {                // .all() also catches OPTIONS, so answer it here
      return res.set('Allow', ALLOW).status(204).end();
    }
    res.set('Allow', ALLOW).status(405).json({ error: `${req.method} not allowed` });
  });

app.listen(6702, () => console.log('listening on 6702'));

// Real output (Node v24.19.0, Express 5.3.0), server console after the curl session below:
//   listening on 6702
//   GET handler ran for HEAD /plain
```

Run `node verbs-server.cjs`, then:

bash

```
$ curl -I http://127.0.0.1:6702/plain
HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 17
ETag: W/"11-IkjuL6CqqtmReFMfkkvwC0sKj04"
Date: Mon, 12 Oct 2026 14:21:21 GMT
Connection: keep-alive
Keep-Alive: timeout=5

$ curl -i -X OPTIONS http://127.0.0.1:6702/plain
HTTP/1.1 200 OK
X-Powered-By: Express
Allow: GET, HEAD
Content-Length: 9
Content-Type: text/plain
X-Content-Type-Options: nosniff
Date: Mon, 12 Oct 2026 14:21:21 GMT
Connection: keep-alive
Keep-Alive: timeout=5

GET, HEAD
$ curl -i -X DELETE http://127.0.0.1:6702/plain
HTTP/1.1 404 Not Found
X-Powered-By: Express
Content-Security-Policy: default-src 'none'
X-Content-Type-Options: nosniff
Content-Type: text/html; charset=utf-8
Content-Length: 147
…
<pre>Cannot DELETE /plain</pre>
…
$ curl -i -X DELETE http://127.0.0.1:6702/docs/1
HTTP/1.1 405 Method Not Allowed
X-Powered-By: Express
Allow: GET, HEAD, PUT, OPTIONS
Content-Type: application/json; charset=utf-8
…
{"error":"DELETE not allowed"}
$ curl -i -X OPTIONS http://127.0.0.1:6702/docs/1
HTTP/1.1 204 No Content
X-Powered-By: Express
Allow: GET, HEAD, PUT, OPTIONS
…
$ curl -I http://127.0.0.1:6702/docs/1
HTTP/1.1 200 OK
X-Powered-By: Express
ETag: "v1"
Content-Type: application/json; charset=utf-8
Content-Length: 36
…
$ curl -i -X PUT http://127.0.0.1:6702/docs/1 -H 'Content-Type: text/plain' -d 'hi'
HTTP/1.1 415 Unsupported Media Type
…
{"error":"Send application/json"}
$ curl -i -X PUT http://127.0.0.1:6702/docs/1 -H 'Content-Type: application/json' -d '{"title":"A"}'
HTTP/1.1 428 Precondition Required
…
{"error":"Send If-Match with the ETag you last read"}
```

The HEAD reply has the same `Content-Length: 17` and `ETag` a GET would have, with no body, and the server log shows the GET handler ran. The automatic OPTIONS reply is a 200 with a text body; our own one on `/docs/1` is a 204 with only the header. Both are valid.

**Example — two clients racing to save the same document.** Alice and Bob both read version 1 and then both PUT at the same moment. Start a fresh `verbs-server.cjs` (so the document is back at version 1), then run:

javascript

```
// race.cjs: two clients read the same version, then both try to save it.
// Start verbs-server.cjs first (fresh process, so the document is at version 1).
const URL = 'http://127.0.0.1:6702/docs/1';

async function read(who) {
  const r = await fetch(URL);
  const etag = r.headers.get('etag');
  console.log(`${who.padEnd(5)} GET                -> ${r.status} ETag ${etag}  ${JSON.stringify(await r.json())}`);
  return etag;
}

async function save(who, etag, title) {
  const r = await fetch(URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify({ title }),
  });
  console.log(`${who.padEnd(5)} PUT If-Match ${etag.padEnd(6)} -> ${r.status} ETag ${r.headers.get('etag')}  ${await r.text()}`);
  return r.status;
}

(async () => {
  const [a, b] = await Promise.all([read('Alice'), read('Bob')]); // both hold "v1"
  const [sa] = await Promise.all([save('Alice', a, 'Alice title'), save('Bob', b, 'Bob title')]); // one wins
  const loser = sa === 412 ? 'Alice' : 'Bob';
  const fresh = await read(loser);                                // the loser re-reads ...
  await save(loser, fresh, `${loser} title (merged)`);            // ... merges and retries
  await save('Eve', 'W/"v3"', 'weak tag');                        // a weak tag never passes If-Match
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   Alice GET                -> 200 ETag "v1"  {"id":1,"title":"Draft","version":1}
//   Bob   GET                -> 200 ETag "v1"  {"id":1,"title":"Draft","version":1}
//   Alice PUT If-Match "v1"   -> 200 ETag "v2"  {"id":1,"title":"Alice title","version":2}
//   Bob   PUT If-Match "v1"   -> 412 ETag "v2"  {"error":"Stale ETag","current":"\"v2\""}
//   Bob   GET                -> 200 ETag "v2"  {"id":1,"title":"Alice title","version":2}
//   Bob   PUT If-Match "v2"   -> 200 ETag "v3"  {"id":1,"title":"Bob title (merged)","version":3}
//   Eve   PUT If-Match W/"v3" -> 412 ETag "v3"  {"error":"Stale ETag","current":"\"v3\""}
```

Exactly one of the two simultaneous PUTs gets 200; the other gets 412 and the current ETag. Without `If-Match`, both would get 200 and Alice's title would be silently lost. Which client wins depends on which request reaches the server first. In one of five runs Bob won instead (`Bob PUT If-Match "v1" -> 200`, `Alice PUT If-Match "v1" -> 412`), so the script picks the loser from the status code instead of assuming it.

### Common mistakes & gotchas (additional topics)

- **Expecting Express to send 405.** It sends 404 for a known path with the wrong method. Add `.all()` at the end of `app.route()` and always include `Allow`.
- **Putting `.all()` first on the route.** Route handlers run in order, so `.all()` before `.get()` answers 405 to GET as well. It also swallows OPTIONS, so handle OPTIONS inside it.
- **Assuming HEAD is cheap.** Without a `.head()` handler, Express runs your GET handler in full and only drops the body.
- **Comparing `If-Match` weakly.** `If-None-Match` (caching) uses the weak comparison; `If-Match` (writes) must use the strong one. Express has no helper for `If-Match`; `req.fresh` only covers `If-None-Match`/`If-Modified-Since`.
- **Check-then-write across processes.** The example is safe because Node runs the check and the write in one synchronous step in one process. With a database and several app instances, the check and the update must be one atomic operation, for example an `UPDATE … WHERE id = $1 AND version = $2` that reports 0 rows when the version moved.

### Edge case worked through: why one of two simultaneous PUTs must fail

Both clients send `If-Match: "v1"`. The server handles one request completely before it starts the next: it checks the tag, writes, and bumps the version to 2. When the second request is checked, the current tag is `"v2"`, `ifMatchPasses('"v1"', '"v2"')` is `false`, and it gets 412 with `ETag: "v2"`. The loser then has what it needs to recover: GET the new version, merge its change, and retry with `If-Match: "v2"`, which succeeds and produces `"v3"`. Eve's `W/"v3"` names the current version, but in weak form, and the strong comparison rejects it. A weak tag only says two representations are equivalent, which is not enough to prove the client is editing the exact current state.

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
