# 02. API design: idempotent POST, versioning, long-running work

> **Remember this**
> 1. POST is not safe to retry. An idempotency key, claimed in the database before the side effect, turns a retry into a replay.
> 2. Two requests with the same key at the same moment: one does the work, the other gets 409 and `Retry-After`.
> 3. Version only for a breaking change. Adding an optional field is not breaking. Renaming, removing or retyping a field is.
> 4. Run old and new versions side by side, send `Deprecation` and `Sunset`, and register that middleware before the old router.
> 5. Work that outlives a request answers 202 with a status URL. The job state lives in a database or a queue, never in memory.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| A1 | [A retried payment charges the customer twice](#a1-a-retried-payment-charges-the-customer-twice) | Must know |
| A2 | [You must change a response shape the mobile app depends on](#a2-you-must-change-a-response-shape-the-mobile-app-depends-on) | Likely |
| A3 | [An export takes two minutes and the request times out](#a3-an-export-takes-two-minutes-and-the-request-times-out) | Likely |

---

## A1. A retried payment charges the customer twice
**Tag: Must know**

### Scenario
"Our fintech app calls POST /payments. On a bad mobile network the request times out, the app retries, and some customers get charged twice. How do you make this endpoint safe to retry?"

### Questions to ask back
- **Can the client send a unique key per payment?** If yes, that is the cleanest design. If not, I need a natural unique field, like an order reference.
- **Does the payment provider support its own idempotency keys?** If yes, I pass the same key through, so the provider side is protected too.
- **Can two retries arrive at the same moment?** Usually yes, so the design must handle concurrency, not just a sequence.
- **How long after the first attempt can a retry come?** That decides how long I keep the keys.

### Spoken answer
> A payment request is not safe to retry, because every call can create a new charge. So the client sends an idempotency key, a unique value per payment, and reuses it on every retry. On the server, I first claim that key in the database with a unique constraint, before I call the payment provider. If the claim succeeds, I charge, then store the response next to the key. If the key already exists, there are three cases. A different body with the same key is a client bug, so I reject it. If the first request is still running, I answer with a conflict and ask the client to retry shortly. If it finished, I return the stored response, and nothing is charged twice. The trade off is an extra table, and keys need an expiry.

### Say it in 5 beats
1. Retries create duplicate charges.
2. Client sends one key per payment.
3. Claim the key first, with a unique constraint.
4. Seen before: reject, conflict, or replay.
5. Trade-off: extra table, keys expire.

### Case variations
- **"Two retries arrive at exactly the same moment."**
  > The unique constraint decides. Only one insert can claim the key. The other request sees it in progress and gets a conflict with a retry hint.
- **"The provider clearly declines the card, or the call times out."**
  > A clear decline means nothing was charged, so I delete the key and the customer can try again. A timeout is an unknown outcome, so I mark the key unknown and retries get a conflict until I reconcile with the provider.
- **"The server crashes after claiming the key, before saving the result."**
  > The key is stuck in progress, so every retry gets a conflict. I give in-progress keys a time limit. After it passes, I ask the provider what happened before I allow a new charge.
- **"Two different users send the same key."**
  > Keys must be scoped to the user or API client, so the primary key becomes user plus key. Otherwise one user could replay another user's response.

### Follow-up questions
- **Why claim the key before charging, not after?** If you save it after the charge and the process dies in between, the retry finds no key and charges again. Lesson 64's interview answer says this, but its own code saves after, so do not copy that code.
- **What do you store?** The key, a hash of the request body, the status, and the response code and body to replay.
- **Isn't a unique constraint on the order reference enough?** It stops duplicates when the client has a natural id. A key is more general, and a retry gets the original success response instead of an error.
- **Optional: senior. The provider charged the card, but your call timed out, so you deleted the key. What now?** A timeout is not a failure, it is an unknown outcome. Only delete the key on a clear decline. On a timeout, mark the key unknown, pass the same key to the provider's own idempotency feature, and reconcile with the provider before charging again.
  > Unverified: the provider side needs a real payment provider account. The local script covers only our own table.

### Common wrong answers and red flags
- "Disable the retry button." The network and the app retry too.
- "Check if a payment exists, then insert." Two requests can both pass the check. Only a unique constraint or a lock is safe.
- Saving the key after calling the provider.
- Deleting the key on every error, including timeouts. Delete only on a clear decline, and mark a timeout as unknown.
- Ignoring the body hash, so a reused key silently returns an unrelated payment.

### Numbers to quote
In a local test, two identical requests sent at the same moment produced one charge and one conflict response.

### Code sketch
```js
// pool is a pg Pool; key is the Idempotency-Key header; hash is a sha256 of the request body
const claimed = await pool.query(
  `INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2)
   ON CONFLICT (key) DO NOTHING RETURNING key`, [key, hash]);
if (claimed.rowCount === 0) {                                            // seen this key before
  const { rows: [prev] } = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
  if (prev.request_hash !== hash) return res.status(422).json({ error: 'Key reused with a different body' });
  if (prev.status !== 'done') return res.status(409).set('Retry-After', '1').end(); // in progress or unknown
  return res.status(prev.response_code).json(prev.response_body);        // replay, no second charge
}
```

```js
// gateway.charge throws an error with declined = true on a clear decline; anything else is an unknown outcome
try {
  const charge = await gateway.charge(req.body.amount);
  const body = { paymentId: charge.id, amount: req.body.amount };
  await pool.query(`UPDATE idempotency_keys SET status = 'done', response_code = 201, response_body = $2 WHERE key = $1`, [key, body]);
  return res.status(201).json(body);
} catch (err) {
  if (err.declined) {                                          // nothing was charged: allow a retry
    await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
    return res.status(402).json({ error: 'Card declined' });
  }
  await pool.query(`UPDATE idempotency_keys SET status = 'unknown' WHERE key = $1`, [key]); // reconcile later
  return res.status(502).json({ error: 'Payment outcome unknown' });
}
```

```sql
CREATE TABLE idempotency_keys (key text PRIMARY KEY, request_hash text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress', response_code int, response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
```

Verified by [verify-a1.mjs](code/api-design/verify-a1.mjs)

### Source
Lessons 64, 73, 75.

---

## A2. You must change a response shape the mobile app depends on
**Tag: Likely**

### Scenario
"Our user endpoint returns `name` as one string. Product wants first and last name as separate fields. The web app ships daily, but the mobile app takes weeks to reach users. How do you make this change?"

### Questions to ask back
- **Can I add the new fields without removing the old one?** Then it is not a breaking change, and I may not need a new version at all.
- **Who calls this API?** Only our apps, or partners too? Partners need longer notice.
- **Do we know which clients still call the old shape?** If not, I add logging by client before announcing a date.

### Spoken answer
> First I check whether the change really breaks anyone. Adding fields is safe, so if I can keep the old name string and add first and last name next to it, I do that and skip versioning. If the name field itself must change shape, that is breaking, and the mobile app cannot update overnight. So I ship the new shape as a new version in the path, and keep the old one running beside it. Both call the same service code. Only the response mapping differs. The old version sends deprecation and sunset headers with an end date, and I log which clients still call it. After that date, once the traffic stops, I remove it. The trade off is that every live version is code you keep maintaining.

### Say it in 5 beats
1. Is it really breaking? Adding is not.
2. Breaking: new version in the path.
3. Run old and new side by side.
4. Deprecation and sunset headers, log old callers.
5. Remove after the date. Trade-off: maintenance.

### Case variations
- **"Why not put the version in a header instead of the path?"**
  > A header keeps URLs clean, but it is invisible in logs and in a browser, and caches must vary on it. A path is easy to see, route and cache, so I default to the path.
- **"Only one endpoint changes. Do we copy the whole API into a new version?"**
  > No. Only the changed endpoint gets a new mapping. Everything else is mounted under both paths.
- **"A partner ignores the sunset date."**
  > I contact them with their traffic numbers and agree on an extension if needed. When I finally remove it, I return a clear error that points to the new version, not a bare not found.
- **"The change is in the request, a new required field."**
  > A new required input is breaking too. The old version fills in a server-side default, and only the new version requires it.

### Follow-up questions
- **What counts as breaking?** Removing or renaming a field, changing its type, adding a required input, or changing what a status code means.
- **Why return objects instead of bare arrays?** So you can add fields like pagination info later without breaking anyone.
- **Where must the deprecation middleware go in Express?** Before the old router. If it comes after, the router has already answered and the headers are never sent.
- **Optional: senior. How do you avoid duplicating business logic across versions?** Versions differ only at the edge. Each version is a thin router with its own request and response mapping over the same service layer, and the same tests run against both until the old one is removed.

### Common wrong answers and red flags
- A new version for an additive change.
- Changing the old version in place "because only our app uses it".
- No sunset date, so the old version lives forever.
- Registering the deprecation middleware after the old router.

### Numbers to quote
No figures needed.

### Code sketch
```js
// app is an Express app; v1 and v2 are routers that map the same service result to different shapes
const deprecate = (req, res, next) => {
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Wed, 30 Jun 2027 23:59:59 GMT');
  res.set('Link', '</v2/users>; rel="successor-version"');
  next();
};

app.use('/v1', deprecate, v1);   // deprecate first, or v1 answers before the headers are set
app.use('/v2', v2);
```

Verified by [verify-a2.mjs](code/api-design/verify-a2.mjs)

### Source
Lessons 60, 66.

---

## A3. An export takes two minutes and the request times out
**Tag: Likely**

### Scenario
"Admins on our SaaS dashboard click 'Export orders', and the server builds a large CSV. It takes about two minutes, the load balancer cuts the request at sixty seconds, and admins click again, which starts another export. How would you redesign this?"

### Questions to ask back
- **How big can the export get?** Small exports could just stream. Big ones need a background job.
- **Where should the file end up?** Object storage with a download link is the usual answer.
- **Do admins wait on the page, or come back later?** That decides between polling, a push, or an email.
- **Is the same export often requested twice?** Then I reuse a running job instead of starting another.

### Spoken answer
> I would not keep the request open. The server accepts the job, stores it, and answers right away with an accepted status, the job id, and a link to a status endpoint. A worker does the real work in the background. The client polls the status link. The status says queued, running, done with a download link, or failed with a reason, and it tells the client how long to wait before asking again. If polling is too chatty, I push the result over a WebSocket, or send an email when it is ready. The job state must live in a database or a queue, not in server memory, or a restart loses it. The trade off is more moving parts, but nothing times out, and the admin can leave the page.

### Say it in 5 beats
1. Don't hold the request open.
2. Accepted status, job id, status link.
3. Worker does the job in the background.
4. Client polls, or gets a push.
5. Job state in a database or queue.

### Case variations
- **"The server restarts in the middle of a job."**
  > With a durable queue, the job is still there and another worker picks it up. So a job can run twice, and the worker must be safe to repeat, for example by writing the file under the job id.
- **"An admin clicks export twice."**
  > I look for a queued or running export with the same filters by the same admin and return that job instead of creating a new one.
- **"Hundreds of admins poll at once."**
  > The status lookup is cheap, but I still send a retry delay and keep job lookups on an index. If it grows, I push updates instead of polling.
- **"Could you just stream the CSV instead?"**
  > Yes, if it can start sending quickly and the proxy allows long responses. Streaming keeps memory flat. But a slow query before the first byte still hits the timeout, so a job is safer here.

### Follow-up questions
- **Why 202 and not 201?** 201 means the resource now exists. 202 means the work was accepted but is not finished.
- **Where do you put the finished file?** In object storage, returned as a short-lived download link, so the API server does not serve large files.
- **How long do you keep job records?** Long enough to download the result, then a cleanup job removes them and the files.
- **Optional: senior. How do you make sure the export runs exactly once?** Queues deliver at least once, so exactly-once delivery is not the goal. The goal is an idempotent worker: it records the job as done and writes the output under the job id, so a second run either sees the done flag or overwrites the same file.

### Common wrong answers and red flags
- "Raise the load balancer timeout to five minutes."
- Keeping job state in a `Map` in production. The local script uses one only to keep the demo short.
- No "failed" status, so the client polls forever.
- Starting a new job on every click.

### Numbers to quote
No figures needed.

### Code sketch
```js
// app is an Express app; jobs wraps a jobs table and queue is a job queue (the verifying script uses a Map and a promise)
app.post('/exports', async (req, res) => {
  const job = await jobs.create({ type: 'orders-export', filters: req.body, status: 'queued' });
  await queue.add('orders-export', { jobId: job.id });            // a worker picks it up
  res.status(202).location(`/exports/${job.id}`).json({ id: job.id, status: 'queued' });
});

app.get('/exports/:id', async (req, res) => {
  const job = await jobs.find(req.params.id);
  if (!job) return res.status(404).json({ error: 'Unknown export' });
  if (job.status === 'queued' || job.status === 'running') res.set('Retry-After', '2');
  res.json({ id: job.id, status: job.status, url: job.url, error: job.error });
});
```

Verified by [verify-a3.mjs](code/api-design/verify-a3.mjs)

### Source
Lessons 38, 58, 111, 114.
