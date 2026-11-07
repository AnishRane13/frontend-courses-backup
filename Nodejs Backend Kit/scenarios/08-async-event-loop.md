# 08. Async and the event loop

> **Remember this**
> 1. All your JavaScript runs on one main thread. Async only helps while you wait for the network or the disk. Heavy CPU work blocks every request, even health checks.
> 2. Measure before you fix. Event loop lag shows that the loop is blocked, and a CPU profile shows which function is hot.
> 3. Move CPU work to a small, fixed pool of worker threads with a limited queue, or to a background job. Never start one new worker per request.
> 4. Awaits that do not need each other add up when you run them one by one. Start them together and wait with `Promise.all`. Steps that need an earlier result stay in order.
> 5. A big fan-out needs a concurrency limit. When some items can fail, keep a result per item, or use `Promise.allSettled`, so one error does not kill the whole batch.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Event loop | The loop inside Node that picks the next ready callback and runs it on the single main thread, one at a time. |
| Blocking | Code that keeps the main thread busy, so no other request, timer or callback can run until it finishes. |
| CPU-bound work | Work limited by computing, such as number crunching or parsing, which keeps the thread busy the whole time. |
| I/O-bound work | Work that mostly waits on the network, the disk or the database. Node can serve other requests while it waits. |
| Event loop lag | How late a timer fires compared with when it was due. Also called event loop delay. High lag means something is blocking the loop. |
| Event loop utilization | The share of time the loop is busy running code instead of sitting idle waiting for events. |
| CPU profile | A recording of which functions used the CPU and for how long. It points at the hot function. |
| Worker thread | A separate thread with its own JavaScript engine inside the same process. It can run heavy code without blocking the main thread. |
| Worker pool | A fixed set of worker threads reused for many jobs, with a queue for jobs that wait their turn. |
| Thread pool | Node's built-in set of background threads that runs some file, DNS, crypto and compression calls off the main thread. |
| Background job queue | A list of jobs stored outside the request, which separate workers pick up and run later. |
| Promise | An object that stands for a result that arrives later, either a value or an error. |
| Await | Pauses the current async function until a promise finishes, while the main thread runs other work. |
| Sequential vs parallel | Sequential means one call after another, so the times add up. Parallel means starting them together, so the total is close to the slowest call. |
| Fan-out | One task that starts many smaller calls, such as one push per user. |
| Concurrency limit | A cap on how many calls are in progress at the same moment. |
| Rate limit | A cap a provider sets on how many requests you may send per second or per minute. |
| Partial failure | Some items in a batch fail while the others succeed. |
| Settled | A promise is settled once it has either succeeded or failed. `Promise.allSettled` waits for all of them and reports each outcome. |
| Microtask | A small callback, such as a promise reaction, that runs right after the current callback, before the loop moves on. |

| # | Scenario | Tag |
|---|---|---|
| E1 | [A CPU-heavy report freezes the whole server](#e1-a-cpu-heavy-report-freezes-the-whole-server) | Must know |
| E2 | [Sending 10,000 notifications is too slow or too fast](#e2-sending-10000-notifications-is-too-slow-or-too-fast) | Must know |

---

## E1. A CPU-heavy report freezes the whole server
**Tag: Must know**

### Before you speak
- **Today:** the report endpoint runs a few seconds of number crunching directly inside the request handler, on the main thread.
- **What goes wrong:** Node runs all JavaScript on one main thread. Async only helps while you wait for the network or the disk. While the report computes, the thread cannot run anything else. Every other request waits, the health check times out, and the pod gets restarted.
- **How to confirm it:** event loop lag measures how late a timer fires. If it jumps to seconds while a report runs, the loop is blocked. A CPU profile then names the hot function.
- **The fix:** move the work off the main thread. If a built-in has an async version, such as async password hashing, use it. Otherwise send the work to a small, fixed pool of worker threads, about one per CPU core, with a limited queue in front. Work that takes minutes goes to a background job.
- **Why the fix works:** the main thread only hands the input over and later receives the result. In between it is free to answer other requests and the health check.
- **The trade-off to mention:** the data has to be copied to the worker and back, and every worker thread uses its own memory.
- **Word to know:** a worker thread is a separate thread with its own JavaScript engine, inside the same process.

### Scenario
"Our analytics API has an endpoint that builds a report by crunching numbers in JavaScript for a few seconds. While one report runs, every other request on that instance hangs, and the load balancer's health check times out and restarts the pod. What is going on, and how do you fix it?"

### Questions to ask back
- **Is the heavy part our own code or a library call?** Some built-ins, such as password hashing or compression, have an async version that already runs off the main thread. Then I just switch to it.
- **How long does one report take, and how many run at once?** Work under a second fits a worker pool. Work that takes minutes belongs in a background job.
- **Do many users ask for the same report?** If so, I can compute it once and cache it, and the problem mostly goes away.
- **How many CPU cores does each instance have?** That sets the pool size. More workers than cores just makes them take turns.

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
  > More instances spread the load, but each one still freezes while it runs a report. Its health check still fails, and it still gets restarted. I would scale out on top of the fix, not instead of it.
- **"The slow part is a huge JSON parse of an upstream response."**
  > Parsing JSON is CPU work on the main thread too. I would first ask for a smaller or paginated response, or parse it as a stream of records. A worker is my last choice here, because the parsed result has to be copied back to the main thread anyway.
- **"We already use cluster mode with one process per core."**
  > Cluster mode runs several processes, each with its own event loop, so one report blocks only one process. But every request sent to that process still waits. So the heavy work should still leave the main thread.
- **"The heavy work is password hashing at login."**
  > I switch to the async version of the hash, which runs on Node's thread pool instead of the main thread. I keep its cost setting reasonable. If logins come in bursts, I raise the thread pool size a little.

### Follow-up questions
- **How do you spot a blocked event loop in production?** Measure event loop lag, which is how late a timer fires, with a simple timer or Node's built-in delay histogram. Also track event loop utilization, the share of time the loop is busy. Alert on a high percentile, and take a CPU profile when it spikes.
- **Worker threads or child processes?** Worker threads live inside the same process and start faster, so they suit CPU-heavy JavaScript. A child process is a fully separate program, so it suits running another tool or untrusted code.
- **Why a pool and not a new worker per request?** Each worker is a new thread with its own JavaScript engine, so it costs startup time and memory. Creating one per request under load can overload the machine. A fixed pool reuses a few workers and queues the rest.
- **Optional: senior. When do microtasks run, and why does it matter here?** A microtask is a small callback, such as a promise reaction, that runs before the loop moves on. Since Node 11, the microtask queue drains after each callback, not only between phases of the loop. So a long promise chain that keeps adding microtasks starves I/O just like a plain loop. Splitting work with promises does not free the loop. Only yielding to a macrotask, such as setImmediate, or moving the work to a worker does.

### Common wrong answers and red flags
- "Just make the function async." An async function that computes still computes on the main thread.
- Starting a new worker for every request, with no pool and no limit on the queue.
- Raising the health check timeout so the pod stops restarting. Users still wait just as long.
- Calling synchronous file or crypto functions inside a request handler.
- Saying microtasks run only between event loop phases. On current Node they run after every callback.
- Saying `return await` always costs an extra microtask. That is not true on current engines. The real reason to use it inside a try block is so the local catch sees the error.

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

### Before you speak
- **Today, version one:** the code loops over the users and awaits each send before starting the next. Every call waits for the one before it, so the total time is the sum of all the calls.
- **Today, version two:** the code starts every send at once. Thousands of requests hit the push provider together, so it rate-limits us. Every send that uses the database also grabs a connection, so the pool runs out and normal requests starve.
- **The fix:** a concurrency limit. A fixed number of async workers each take the next user from a shared list, send, and repeat. At most that many sends are in progress at once, and the number is kept below the provider's limit and the database pool size.
- **Partial failure:** in a big batch some sends will fail, for example because a device token expired. Each send records success or failure instead of throwing, so one failure does not stop the rest. Then I retry only the failures.
- **Independent vs dependent calls:** calls that do not need each other's results can start together and be awaited with Promise.all, so the total time is about the slowest call. A call that needs an earlier result must wait for it.
- **The trade-off to mention:** a lower limit is safer but slower. For very large sends, the work moves to a job queue.
- **Words to know:** fan-out means one task starting many smaller calls. Settled means a promise has finished, either with a value or with an error.

### Scenario
"Our notification service sends a push to every user in a segment, sometimes 10,000 users. The first version awaited each send in a loop and took forever. Someone changed it to start all the sends at once, and now the push provider rate-limits us and the database pool runs out of connections. How would you write it?"

### Questions to ask back
- **What is the provider's rate limit?** It sets my concurrency limit. If the limit is per second rather than per open request, I need a rate limiter instead.
- **Does each send use the database?** Then the limit must stay below the pool size. Otherwise sends wait for connections and normal requests starve.
- **What should happen when some sends fail?** Usually the batch keeps going. I record the failures, retry them, and remove expired device tokens.
- **Must this finish inside one HTTP request?** For thousands of users, no. It belongs in a job queue that tracks progress.

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
  > Then those two steps stay in order, because the second depends on the first. I only run calls together when they are independent. For example, once I have the id, I can load the profile and the settings at the same time.
- **"One send fails. With wait for all, what happens to the rest?"**
  > Promise.all rejects as soon as the first send fails. The other sends keep running, but their results are thrown away. For a batch, I settle every send and collect the failures instead.
- **"The provider allows a fixed number of requests per second, not concurrent ones."**
  > A concurrency limit caps how many sends are open at once, not how many start each second. If the provider answers fast, I could still go over a per second limit. I would use a token bucket, which releases sends at a steady rate, or the job queue's built-in rate limiter.
- **"The user cancels the campaign halfway."**
  > I pass an abort signal into the loop. Each worker checks it before taking the next user, so no new sends start. Sends already in flight get the same signal, so their requests are cancelled.

### Follow-up questions
- **How does a simple limiter work?** Start a fixed number of async workers. Each one takes the next index from a shared counter, awaits the send, and repeats until the list is empty. Two workers never take the same index, because JavaScript runs on one thread and reading and bumping the counter happens in one step.
- **What is the difference between Promise.all and Promise.allSettled?** Promise.all fails fast, meaning it rejects on the first error. Promise.allSettled waits for every promise to settle, meaning finish with a value or an error, and returns each outcome. That suits batches where partial success is fine.
- **How do you pick the limit?** Start from the tightest limit downstream: the provider's rate limit or the database pool size, minus room for normal traffic. Then load test, and watch latency and errors.
- **Optional: senior. How do you make the batch survive a crash halfway?** Move it to a job queue. Split the users into chunks, one job per chunk, and record each user's send status. A retried job then skips users already sent, which makes it idempotent, meaning running it twice has the same effect as running it once.

### Common wrong answers and red flags
- An await inside a for loop for calls that do not depend on each other.
- Starting every send at once with no limit. It uses up sockets, the provider's rate limit and the database pool.
- Using forEach with an async callback. forEach does not wait for the promises, and their errors become unhandled rejections.
- Using Promise.all and assuming the other sends stop after the first failure. They keep running.
- Splitting the users into fixed batches and waiting for each whole batch. One slow call stalls the batch, while a pool of workers keeps every slot busy.

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
