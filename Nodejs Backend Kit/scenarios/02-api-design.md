# 02. API design: idempotent POST, versioning, long-running work

> **Remember this**
> 1. A retried POST can charge twice. An idempotency key, saved in the database before the charge, turns the retry into a replay of the first answer.
> 2. If two requests with the same key arrive together, one does the work. The other gets a conflict answer and a hint to retry soon.
> 3. Make a new version only for a breaking change. Adding an optional field breaks nobody. Renaming, removing or changing a field's type does.
> 4. Run the old and new versions side by side. The old one sends "going away" headers with an end date, and that middleware goes before the old router.
> 5. Work that takes longer than a request answers "accepted" with a status link. The job's state lives in a database or a queue, never in server memory.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Idempotent | Running a request many times has the same effect as running it once. |
| Idempotency key | A unique value the client creates for one action, such as one payment, and sends again on every retry. |
| Unique constraint | A database rule that allows only one row with a given value, so a second insert with the same value fails. |
| Claiming the key | Inserting the key into the table first. Only the request whose insert succeeds is allowed to do the work. |
| Replay | Sending back the response that was stored the first time, instead of doing the work again. |
| Request hash | A short fingerprint of the request body. If the same key comes with a different fingerprint, the body changed. |
| Conflict (409) | The status that says "this clashes with the current state", for example the first request is still running. |
| Retry-After header | A response header that tells the client how many seconds to wait before trying again. |
| Unknown outcome | A call that timed out, so you do not know if it worked. It is not the same as a failure. |
| Reconcile | Asking the payment provider what really happened and fixing your own records to match. |
| Breaking change | A change that makes an existing client fail, such as removing, renaming or retyping a field. |
| Additive change | Adding something new, such as an optional field. Old clients ignore it, so nothing breaks. |
| API version | A label, usually in the path such as v1 or v2, that lets old and new response shapes live side by side. |
| Deprecation and Sunset headers | Response headers that say "this version is going away" and the date it will be removed. |
| Middleware | A function that runs on a request before the route handler, in the order it was registered. |
| Accepted (202) | The status that says "I took the work, but it is not finished yet". |
| Background worker | A separate process that takes jobs from a queue and does the slow work outside the request. |
| Polling | The client asking a status link again every few seconds until the job is done. |
| Durable queue | A queue that saves jobs outside the server's memory, so they survive a restart. |
| At least once delivery | A queue promise that every job is delivered, but sometimes more than once. |
| Object storage | A service for storing files, such as S3, that can hand out short-lived download links. |

| # | Scenario | Tag |
|---|---|---|
| A1 | [A retried payment charges the customer twice](#a1-a-retried-payment-charges-the-customer-twice) | Must know |
| A2 | [You must change a response shape the mobile app depends on](#a2-you-must-change-a-response-shape-the-mobile-app-depends-on) | Likely |
| A3 | [An export takes two minutes and the request times out](#a3-an-export-takes-two-minutes-and-the-request-times-out) | Likely |

---

## A1. A retried payment charges the customer twice
**Tag: Must know**

### Before you speak
- **Today:** the app sends a POST to create a payment. On a bad network the answer never arrives, so the app cannot tell if the charge happened. It sends the same request again.
- **What goes wrong:** the server treats the retry as a brand new payment. The first request may already have charged the card, so the customer pays twice.
- **The fix:** the client creates one idempotency key per payment and sends the same key on every retry. Before calling the payment provider, the server inserts that key into a table with a unique constraint.
- **Why the fix works:** the database allows only one row per key, so only one request can win. Every later request with that key finds the row. It gets the stored answer, or a "still working, retry soon" answer, never a second charge.
- **Why claim first:** if you save the key only after charging, and the process dies in between, the retry finds no key and charges again.
- **The trade-off to mention:** you need an extra table, and old keys must expire so the table does not grow forever.

### Scenario
"Our fintech app calls POST /payments. On a bad mobile network the request times out, the app retries, and some customers get charged twice. How do you make this endpoint safe to retry?"

### Questions to ask back
- **Can the client send a unique key per payment?** If yes, that is the cleanest design. If not, I need a field that is already unique, like an order reference.
- **Does the payment provider accept its own idempotency keys?** If yes, I pass the same key through, so the provider is protected too, not only our table.
- **Can two retries arrive at the same moment?** Usually yes, so the design must handle requests running at the same time, not just one after another.
- **How long after the first attempt can a retry come?** That decides how long I keep the keys before they expire.

### Spoken answer
> A payment request is not safe to retry, because every call can create a new charge. So the client sends an idempotency key, which means a unique value per payment, and reuses it on every retry. On the server, I first claim that key in the database with a unique constraint, before I call the payment provider. If the claim succeeds, I charge, then store the response next to the key. If the key already exists, there are a few cases. A different body with the same key is a client bug, so I reject it. If the first request is still running, I answer with a conflict and ask the client to retry shortly. If it finished, I return the stored response, and nothing is charged twice. The trade off is an extra table, and keys need an expiry.

### Say it in 5 beats
1. Retries create duplicate charges.
2. Client sends one key per payment.
3. Claim the key first, with a unique constraint.
4. Seen before: reject, conflict, or replay.
5. Trade-off: extra table, keys expire.

### Case variations
- **"Two retries arrive at exactly the same moment."**
  > The unique constraint decides. Only one insert can create the row for that key. The other request finds the row still in progress and gets a conflict with a hint to retry shortly.
- **"The provider clearly declines the card, or the call times out."**
  > A clear decline means no money moved, so I delete the key and the customer can try again. A timeout is different, because the charge may or may not have happened. I mark the key as unknown, and retries get a conflict until I check with the provider.
- **"The server crashes after claiming the key, before saving the result."**
  > The key is stuck as in progress, so every retry gets a conflict. I give in-progress keys a time limit. When it passes, I ask the provider what really happened before I allow a new charge.
- **"Two different users send the same key."**
  > Keys must belong to one user or one API client, so the table's key becomes the user plus the key. Otherwise one user could get back another user's stored payment response.

### Follow-up questions
- **Why claim the key before charging, not after?** If you save it after the charge and the process dies in between, the retry finds no key and charges again. Claim first, always.
- **What do you store?** The key, a hash of the request body, which is a short fingerprint of it, the status, and the response code and body to replay.
- **Isn't a unique constraint on the order reference enough?** It stops duplicates when the client already has a unique id. A key works for any request, and a retry gets the original success response instead of an error.
- **Optional: senior. The provider charged the card, but your call timed out, so you deleted the key. What now?** A timeout is not a failure. It is an unknown outcome, meaning you do not know if it worked. Only delete the key on a clear decline. On a timeout, mark the key unknown, pass the same key to the provider's own idempotency feature, and reconcile, which means checking with the provider, before charging again.
  > Unverified: the provider side needs a real payment provider account. The local script covers only our own table.

### Common wrong answers and red flags
- "Disable the retry button." The network layer and the app retry on their own too.
- "Check if a payment exists, then insert." Two requests can both pass the check at the same time. Only a unique constraint or a lock is safe.
- Saving the key after calling the provider.
- Deleting the key on every error, including timeouts. Delete only on a clear decline, and mark a timeout as unknown.
- Not storing a hash of the body, so a key reused with a different body silently returns an unrelated payment.

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

### Before you speak
- **Today:** the user endpoint returns the full name as one string, and both the web app and the mobile app read it.
- **What goes wrong:** if you replace that string with two new fields, every installed mobile app breaks, because it looks for a field that is gone. The web app ships a fix in a day, but mobile users update over weeks.
- **First check:** adding fields breaks nobody, because old clients ignore fields they do not know. If you can keep the old string and add first and last name next to it, you need no new version.
- **The fix for a real breaking change:** publish the new shape under a new version in the path, and keep the old version running. Both versions call the same business code. Only the last step, which shapes the response, differs.
- **Retiring the old version:** the old version sends a deprecation header, meaning "this is going away", and a sunset header with the end date. You log which clients still call it, and remove it after the date once its traffic stops.
- **The trade-off to mention:** every live version is extra code you keep tested and working.

### Scenario
"Our user endpoint returns `name` as one string. Product wants first and last name as separate fields. The web app ships daily, but the mobile app takes weeks to reach users. How do you make this change?"

### Questions to ask back
- **Can I add the new fields and keep the old one?** Then nothing breaks, and I may not need a new version at all.
- **Who calls this API?** If it is only our own apps, I control the timeline. Partners need much longer notice.
- **Do we know which clients still use the old shape?** If not, I add logging per client before I announce an end date.

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
  > A header keeps URLs clean, but you cannot see it in logs or in a browser, and caches must store a copy per header value. A version in the path is easy to see, route and cache. So I default to the path.
- **"Only one endpoint changes. Do we copy the whole API into a new version?"**
  > No. Only the changed endpoint gets a new response mapping in the new version. Every other route is simply mounted under both paths and runs the same code.
- **"A partner ignores the sunset date."**
  > I contact them with their own traffic numbers and agree on an extension if needed. When I finally remove the old version, I return a clear error that points to the new version, not a bare not found.
- **"The change is in the request, a new required field."**
  > A new required input is breaking too, because old clients do not send it. The old version fills in a default on the server, and only the new version requires the field.

### Follow-up questions
- **What counts as breaking?** Removing or renaming a field, changing its type, adding a required input, or changing what a status code means. Adding an optional field is not breaking.
- **Why return objects instead of bare arrays?** An object has room to grow. You can later add fields like pagination info next to the list without breaking anyone.
- **Where must the deprecation middleware go?** Before the old router. Middleware runs in the order it was registered. If it comes after, the router has already answered and the headers are never sent.
- **Optional: senior. How do you avoid copying business logic across versions?** Versions differ only at the edge, meaning the code that reads the request and shapes the response. Each version is a thin router with its own mapping over the same service layer. The same tests run against both versions until the old one is removed.

### Common wrong answers and red flags
- Making a new version for an additive change, such as one new optional field.
- Changing the old version in place "because only our app uses it". Installed mobile apps still break.
- No sunset date, so the old version lives forever.
- Registering the deprecation middleware after the old router, so the headers never go out.

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

### Before you speak
- **Today:** the export request builds the whole CSV file while the browser waits. That takes about two minutes.
- **What goes wrong:** the load balancer, the server in front of the app that passes requests through, gives up after sixty seconds. The admin sees an error and clicks again, so a second export starts while the first is still running.
- **The fix:** answer at once with an accepted status, a job id and a status link. A background worker, a separate process that takes jobs from a queue, builds the file.
- **How the client learns it is done:** it polls, which means it asks the status link every few seconds. The status says queued, running, done with a download link, or failed with a reason.
- **Where the job lives:** in a database or a durable queue, not in server memory. Memory is lost on restart, and other servers cannot see it.
- **The trade-off to mention:** more moving parts, a queue, a worker and a jobs table. In return nothing times out, and the admin can leave the page.

### Scenario
"Admins on our SaaS dashboard click 'Export orders', and the server builds a large CSV. It takes about two minutes, the load balancer cuts the request at sixty seconds, and admins click again, which starts another export. How would you redesign this?"

### Questions to ask back
- **How big can the export get?** A small export could just stream back in the response. A big one needs a background job.
- **Where should the finished file go?** Object storage with a download link is the usual answer, so the API server does not serve big files.
- **Do admins wait on the page, or come back later?** That decides between polling, a push over a live connection, or an email.
- **Is the same export often requested twice?** Then I reuse a job that is already running instead of starting another.

### Spoken answer
> I would not keep the request open. The server accepts the job, stores it, and answers right away with an accepted status, the job id, and a link to a status endpoint. A worker does the real work in the background. The client polls the status link. The status says queued, running, done with a download link, or failed with a reason, and it tells the client how long to wait before asking again. If polling is too chatty, I push the result over a live socket, or send an email when it is ready. The job state must live in a database or a queue, not in server memory, or a restart loses it. The trade off is more moving parts, but nothing times out, and the admin can leave the page.

### Say it in 5 beats
1. Don't hold the request open.
2. Accepted status, job id, status link.
3. Worker does the job in the background.
4. Client polls, or gets a push.
5. Job state in a database or queue.

### Case variations
- **"The server restarts in the middle of a job."**
  > With a durable queue, the job is still there and another worker picks it up. That means a job can run twice. So the worker must be safe to repeat, for example by writing the file under the job id.
- **"An admin clicks export twice."**
  > Before creating a job, I look for a queued or running export with the same filters from the same admin. If one exists, I return that job instead of starting a new one.
- **"Hundreds of admins poll at once."**
  > Each status lookup is cheap, but I still send a retry delay and make sure job lookups use an index. If polling keeps growing, I push updates to the page instead.
- **"Could you just stream the CSV instead?"**
  > Yes, if the first rows can go out quickly and the proxy allows long responses. Streaming keeps memory flat, because rows are sent as they are read. But a slow query before the first byte still hits the timeout, so a job is safer here.

### Follow-up questions
- **Why an accepted status and not created?** Created means the new resource exists now. Accepted means the work was taken but is not finished yet.
- **Where do you put the finished file?** In object storage, returned as a short-lived download link, so the API server never has to send large files itself.
- **How long do you keep job records?** Long enough for the admin to download the result. Then a cleanup job removes the records and the files.
- **Optional: senior. How do you make sure the export runs exactly once?** Queues promise at least once delivery, meaning a job can arrive twice, so exactly once delivery is not the goal. The goal is an idempotent worker. It marks the job as done and writes the output under the job id, so a second run either sees the done flag or overwrites the same file.

### Common wrong answers and red flags
- "Raise the load balancer timeout to five minutes." The next, bigger export hits the new limit, and a busy server holds many long requests open.
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
