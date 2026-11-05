# 08. Async and the event loop

> **Remember this**
> 1. All your JavaScript runs on one main thread. Async helps only while waiting on I/O. CPU work blocks every request, health checks included.
> 2. Measure it: event-loop lag and event-loop utilization show a blocked loop, a CPU profile shows the hot function.
> 3. Move CPU work to a small, fixed pool of worker threads with a bounded queue, or to a background job. Never one new worker per request.
> 4. Independent awaits in a row add up. Start them together and wait with `Promise.all`. Dependent steps stay in order.
> 5. Large fan-out needs a concurrency limit, and partial failure needs `Promise.allSettled` or a per-item result, not a batch that dies on the first error.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| E1 | [A CPU-heavy report freezes the whole server](#e1-a-cpu-heavy-report-freezes-the-whole-server) | Must know |
| E2 | [Sending 10,000 notifications is too slow or too fast](#e2-sending-10000-notifications-is-too-slow-or-too-fast) | Must know |

---

## E1. A CPU-heavy report freezes the whole server
**Tag: Must know**

### Scenario
"Our analytics API has an endpoint that builds a report by crunching numbers in JavaScript for a few seconds. While one report runs, every other request on that instance hangs, and the load balancer's health check times out and restarts the pod. What is going on, and how do you fix it?"

### Questions to ask back
- **What exactly is the heavy part, our own computation or a library call?** A built-in with an async version, such as password hashing or compression, already runs off the main thread, so I just switch to it.
- **How long does one report take, and how many run at once?** Sub-second work fits a worker pool. Minutes of work belongs in a background job.
- **Can the result be cached or precomputed?** If the same report is asked for again and again, computing it once removes the problem.
- **How many CPU cores does each instance get?** That sizes the worker pool. More workers than cores only adds switching.

### Spoken answer
> All our JavaScript runs on one main thread. Async only helps while we wait for input or output. A report that computes for seconds holds that thread, so every other request, even the health check, waits behind it. First I confirm it with event loop lag and utilization metrics, and a CPU profile to find the hot function. Then I move the work off the main thread. If a built in async version exists, like the async password hash, I use it. Otherwise I run it in a small pool of worker threads, sized to the CPU cores, with a bounded queue in front. If a job takes minutes, I accept the request, run it in a background job queue, and let the client poll for the result. The trade off is the cost of copying data to the worker and the memory each thread uses.

### Say it in 5 beats
1. One main thread runs all JavaScript.
2. CPU work blocks everyone, health checks too.
3. Confirm with loop lag and a profile.
4. Move it to a worker pool.
5. Trade-off: copying data, memory per thread.

### Case variations
- **"Can't we just add more instances?"**
  > It spreads the pain, but each instance still freezes while it runs a report, and health checks still fail. Scaling out is fine on top of the fix, not instead of it.
- **"The slow part is a huge JSON parse of an upstream response."**
  > Parsing is CPU work on the main thread too. I would ask for a smaller or paginated response, or parse a stream of records, and only use a worker as a last resort because the result must be copied back.
- **"We already use cluster mode with one process per core."**
  > Cluster gives more event loops, so one report blocks only one process. Requests routed to that process still wait, so the heavy work should still leave the main thread.
- **"The heavy work is password hashing at login."**
  > I use the async version of the hash, which runs on the thread pool, and keep its cost setting reasonable. If logins are bursty, I raise the thread pool size a little.

### Follow-up questions
- **How do you detect a blocked event loop in production?** Track event-loop lag with a timer that measures how late it fires, or the built-in delay histogram, plus event-loop utilization. Alert on a high percentile, and take a CPU profile when it spikes.
- **Worker threads or child processes?** Worker threads share a process and start faster, good for CPU work in JavaScript. A child process gives full isolation, good for running another program or untrusted code.
- **Why a pool and not a new worker per request?** Each worker is a new thread and a new JavaScript engine instance. Creating one per request costs startup time and memory, and under load it overloads the machine.
- **Optional: senior. When do microtasks run, and why does it matter here?** Since Node 11, the microtask queue drains after each callback, not only between phases. A long promise chain that keeps queueing microtasks starves I/O just like a loop. So splitting work with promises does not unblock the loop; only yielding to a macrotask, such as setImmediate, or moving it to a worker does.

### Common wrong answers and red flags
- "Make the function async." An async function that computes still computes on the main thread.
- One new worker per request, with no pool and no queue limit.
- Raising the health check timeout so the pod stops restarting. The users still wait.
- Synchronous file or crypto calls inside a request handler.
- Repeating lesson 29's claim that microtasks drain "between phases". Since Node 11 they drain after every callback, as lesson 9 explains.
- Repeating lesson 19's claim that return await always costs an extra microtask. Lesson 9's measurement shows the opposite on current engines, so do not quote it as a performance reason. The real reason to return await inside a try is so the local catch sees the rejection.

### Numbers to quote
In a local test with a 1.5 second report, a health check sent during the report waited more than 1 second and the loop was blocked for more than 1 second when the report ran on the main thread, but answered in under 300 ms with the loop almost idle when the report ran in a worker pool.

### Code sketch
```js
// report-worker.mjs runs buildReport and posts back { result } or { error }
import { Worker } from 'node:worker_threads';
const idle = [], queue = [];
for (let i = 0; i < 2; i++) idle.push(new Worker(new URL('./report-worker.mjs', import.meta.url)));
export const runReport = (input) => new Promise((resolve, reject) => { queue.push({ input, resolve, reject }); pump(); });
function pump() {
  while (idle.length && queue.length) {
    const worker = idle.pop(), job = queue.shift();
    worker.once('message', ({ result, error }) => {
      idle.push(worker); pump();
      error ? job.reject(new Error(error)) : job.resolve(result);
    });
    worker.postMessage(job.input);
  }
}
```

```js
// app is an Express app; runReport comes from the pool above
let last = performance.now();
setInterval(() => {
  const lagMs = performance.now() - last - 500; // how late this timer fired
  last = performance.now();
  if (lagMs > 100) console.warn({ lagMs, busy: performance.eventLoopUtilization().utilization }, 'event loop blocked');
}, 500).unref();
app.get('/reports/:id', async (req, res) => res.json(await runReport({ id: req.params.id })));
```

Verified by [verify-e1.mjs](code/async/verify-e1.mjs)

### Source
Lessons 6, 7, 9, 10, 29, 98.

---

## E2. Sending 10,000 notifications is too slow or too fast
**Tag: Must know**

### Scenario
"Our notification service sends a push to every user in a segment, sometimes 10,000 users. The first version awaited each send in a loop and took forever. Someone changed it to start all the sends at once, and now the push provider rate-limits us and the database pool runs out of connections. How would you write it?"

### Questions to ask back
- **What is the provider's rate limit?** That sets the concurrency limit, or a rate limiter if the limit is per second.
- **Does each send touch the database?** Then the limit must stay below the pool size, or sends will queue for connections and other requests starve.
- **What should happen when some sends fail?** Usually the batch continues, failures are recorded and retried, and expired device tokens are removed.
- **Must this finish inside an HTTP request?** For thousands of users, no. It belongs in a job queue with progress tracking.

### Spoken answer
> There are opposite mistakes here. The first is awaiting independent calls one after another, so their times add up. When calls do not depend on each other, I start them together and wait for all of them, so the total is about the slowest call. The second mistake is starting thousands of sends at once. That hits the provider rate limit and exhausts the database pool. For a large fan out I use a concurrency limit, a fixed number of workers pulling from a shared list, sized to the rate limit and the pool. I also plan for partial failure. Each send records success or failure instead of throwing, so one bad device token does not stop the batch, and I retry only the failures. The trade off is that a lower limit makes the batch slower, so for very large sends I move the work into a job queue.

### Say it in 5 beats
1. Sequential awaits add up.
2. Independent calls: start together, wait together.
3. Thousands at once floods everything.
4. Cap concurrency, record each failure.
5. Trade-off: lower limit, slower batch.

### Case variations
- **"Step two needs the user id from step one."**
  > Then those two stay in order, because they are dependent. I only run independent calls together, for example loading the profile and the settings once I have the id.
- **"One send fails. With wait for all, what happens to the rest?"**
  > Waiting for all rejects on the first failure, but the other sends keep running and their results are thrown away. So for a batch I settle every send and collect the failures instead.
- **"The provider allows a fixed number of requests per second, not concurrent ones."**
  > A concurrency limit does not guarantee a rate. I would use a token bucket that releases a send at the allowed rate, or let the job queue's rate limiter do it.
- **"The user cancels the campaign halfway."**
  > I pass an abort signal into the loop. Workers check it before taking the next user, and in-flight sends get the signal so their requests are cancelled.

### Follow-up questions
- **How does a simple limiter work?** Start a fixed number of async workers. Each takes the next index from a shared counter, awaits the send, and repeats. Claiming the index is safe because JavaScript runs on one thread.
- **What is the difference between wait for all and settle all?** Waiting for all fails fast on the first rejection. Settling waits for every promise and returns each outcome, which suits batches where partial success is fine.
- **How do you pick the limit?** Start from the tightest downstream limit: the provider's rate limit or the database pool size, minus headroom for normal traffic. Then load test and watch latency and errors.
- **Optional: senior. How do you make the batch survive a crash halfway?** Move it to a job queue. Split the users into chunks, one job per chunk, and record each user's send status. A retry then skips users already sent, which makes each job idempotent.

### Common wrong answers and red flags
- An await inside a for loop for calls that do not depend on each other.
- Starting every send at once with no limit. It exhausts sockets, the provider's rate limit and the database pool.
- Using forEach with an async callback. It does not wait, and errors become unhandled rejections.
- Waiting for all and assuming the other sends stopped after the first rejection. They keep running.
- Chunking into fixed batches and waiting for each whole batch. One slow call stalls the chunk; a pool of workers keeps the pipe full.

### Numbers to quote
In a local test with a fake provider that takes 50 ms per call, 20 sequential calls took over 1 second while the same calls started together took under 400 ms, and for 2,000 sends the unbounded version peaked at 2,000 in flight while the limiter peaked at exactly 20.

### Code sketch
```js
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // claim an index; safe because JavaScript runs on one thread
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
export const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
```

```js
// sendPush, getProfile and getSettings return promises; users and userId exist; mapLimit and settle are above
const [profile, settings] = await Promise.all([getProfile(userId), getSettings(userId)]);
const outcomes = await mapLimit(users, 20, (user) => settle(sendPush(user)));
const failed = users.filter((_, i) => !outcomes[i].ok); // retry or report only these
```

Verified by [verify-e2.mjs](code/async/verify-e2.mjs)

### Source
Lessons 18, 19, 22, 74.
