# 11. Deployment

> **Remember this**
> 1. When the terminate signal arrives: fail the readiness check first, wait a moment, then close the server, close the pools and exit cleanly.
> 2. Closing the server refuses new connections and lets running requests finish. On recent Node it also closes idle keep-alive connections.
> 3. Add a backup timer that forces the exit, shorter than the platform's grace period. Mark it unref so it cannot keep the process alive on its own.
> 4. "Heap out of memory" in the logs with exit code 134 means Node's engine gave up. A silent exit 137 means the kernel killed the container.
> 5. The real heap limit is the old space flag plus the young generation, and Buffers live outside it. Leave real room under the container limit.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Deploy | Replacing the running version of the app with a new one. |
| Rolling deploy | Replacing instances a few at a time, so old ones keep serving while new ones start. |
| Load balancer | The front door that spreads incoming requests across the instances. |
| 502 error | "Bad gateway". The load balancer sent a request to an instance that gave no proper answer. |
| Readiness check | An endpoint the platform calls to ask "should I send you traffic?". A failing answer takes the instance out of rotation. |
| Liveness check | An endpoint the platform calls to ask "are you still alive?". A failing answer makes the platform restart the instance. |
| SIGTERM, the terminate signal | The polite "please shut down" message the platform sends a process before stopping it. |
| SIGKILL | The forced stop that comes when the grace period ends. A process cannot catch it or clean up. |
| Grace period | How long the platform waits after the terminate signal before it force-kills the process. Kubernetes uses thirty seconds by default. |
| Graceful shutdown | Stopping in an order that lets current work finish: stop taking traffic, finish requests, close connections, then exit. |
| Drain | The part of a graceful shutdown where the instance finishes the requests it already has. |
| Keep-alive connection | A connection the client keeps open after a response, so it can reuse it for the next request. |
| Heap | The memory where Node's JavaScript engine keeps JavaScript objects. |
| Old space and young generation | The two main parts of the heap. New objects start young, and ones that survive move to old space. The usual heap flag sets only old space. |
| Heap limit | The most memory the heap may use. If a full cleanup cannot get under it, the engine aborts the process. |
| Buffer | Raw binary memory for files and network data. It lives outside the heap. |
| RSS, resident memory | All the memory the process really uses: heap, Buffers, compiled code and native libraries. This is what counts against the container limit. |
| Container memory limit | The most memory the container may use in total. |
| Out-of-memory kill | The Linux kernel stopping a container that went over its memory limit. It shows up as exit code 137, with no Node error. |
| Heap snapshot | A file listing every object on the heap at one moment. Comparing two of them shows what grew. |

| # | Scenario | Tag |
|---|---|---|
| DP1 | [Every deploy causes 502s and cut off checkouts](#dp1-every-deploy-causes-502s-and-cut-off-checkouts) | Must know |
| DP2 | [A Node service in a 512 MB container restarts every few hours](#dp2-a-node-service-in-a-512-mb-container-restarts-every-few-hours) | Likely |

---

## DP1. Every deploy causes 502s and cut off checkouts
**Tag: Must know**

### Before you speak
- **Today:** during a rolling deploy, the platform sends each old instance the terminate signal. The app has no handler, or its handler exits at once, so the process dies right away.
- **What goes wrong:** requests that are still running, like a checkout waiting on the payment provider, are cut off. The load balancer also keeps sending new requests for a moment, because it has not noticed the instance is going away. Both show up as 502 errors, meaning the balancer got no proper answer.
- **The fix:** a graceful shutdown in a fixed order. Fail the readiness check first, so the balancer stops sending new traffic. Wait a few seconds for that to take effect. Then close the server: it refuses new connections, lets running requests finish, and closes idle keep-alive connections. Then close the database pool and exit.
- **The safety net:** a backup timer forces the exit if one request hangs. It must fire before the platform's grace period ends, or the platform force-kills the process in the middle of the drain.
- **Why readiness and liveness must be separate:** readiness says "send me traffic". Liveness says "I am alive". If liveness failed during the drain, the platform would restart the instance instead of letting it finish.
- **The trade-off to mention:** deploys get slower, because each old instance waits for its slowest request.

### Scenario
"Every time we deploy our e-commerce API, monitoring shows a burst of 502 errors for about a minute, and a few customers say their checkout spun and then failed. We run several instances behind a load balancer with rolling deploys. What is going wrong, and how do you fix it?"

### Questions to ask back
- **What runs the app: Kubernetes, ECS, or PM2 on a virtual machine?** That tells me who sends the terminate signal, and how long the grace period is before a forced kill.
- **Is there a readiness check, and does the balancer use it?** If not, the balancer keeps sending traffic to a dying instance, so I add one first.
- **How long can the slowest normal request take?** A checkout that calls a payment provider sets the minimum time the drain needs.
- **Is Node started directly, or through npm or a shell script?** If a wrapper does not pass the signal on, the app never gets the chance to drain.

### Spoken answer
> Those errors mean old instances stop while they still have traffic. On the terminate signal, the process should not exit straight away. First I make the readiness check fail, so the load balancer stops sending new requests, and I keep serving for a few seconds while that change spreads. Then I close the server. It refuses new connections, lets in flight requests like a checkout finish, and closes idle keep alive connections. After that I close the database pool, flush logs and exit cleanly. A backup timer forces an exit if one request hangs, and it must be shorter than the platform's grace period, or the process is killed in the middle of the drain. The rolling deploy only sends traffic to a new instance once its readiness passes. The trade off is slower deploys, because every old instance waits for its slowest request.

### Say it in 5 beats
1. Terminate signal: fail readiness first.
2. Wait briefly, then close the server.
3. Running requests finish, idle sockets close.
4. Close pools, exit, backup timer.
5. Trade-off: slower deploys, safer checkouts.

### Case variations
- **"We run on Kubernetes."**
  > A pre stop hook, a command Kubernetes runs before it sends the terminate signal, can do the short wait while the pod is removed from the list of endpoints. The grace period, thirty seconds by default, covers both the hook and my drain. So my backup timer must fit inside whatever time is left.
- **"A checkout can take longer than the grace period."**
  > Then I either raise the grace period or move that work out of the request. Long work goes to a queue, and the request returns quickly with a status the client can check.
- **"Some clients hold WebSocket connections."**
  > Closing the server does not close upgraded connections like WebSockets. I send each client a close message with a hint to reconnect, so it moves to a new instance.
- **"The terminate signal arrives twice."**
  > The handler is guarded by a flag, so the second signal does nothing. Without the flag, the shutdown would start twice and could exit before the drain ends.

### Follow-up questions
- **Why fail readiness before closing the server, not after?** Taking an instance out of the balancer takes a moment to spread. If I close first, the balancer still sends new connections, they are refused, and users see 502 errors.
- **What does the exit code tell you?** Exit code zero means a clean drain. The forced exit uses code one, so a deploy log full of exit one points to a request that hangs, which is worth looking into.
- **Why does it matter how the process is started?** If npm or a shell is the main process in the container, the signal may never reach Node. Start Node directly, or use an init process, a tiny program whose job is to pass signals on.
- **Optional: senior. How do you prove a deploy is really zero downtime?** Run a load test through the balancer during a rolling deploy, and count failed responses and dropped connections. Also make database migrations backward compatible, meaning the old code still works with the new schema, because old and new versions serve traffic side by side during the rollout.

### Common wrong answers and red flags
- Calling `process.exit()` straight from the signal handler. Running checkouts are cut off.
- Calling `server.close()` before readiness fails, so the balancer keeps sending to a closed port.
- No forced-exit timer, or a timer longer than the grace period, so the platform's SIGKILL wins.
- Believing idle keep-alive connections keep `server.close()` waiting forever. Since Node 19, `server.close()` closes idle keep-alive connections itself, and the local script shows an idle socket closing the moment close runs, even with a 60 second keep-alive timeout. `closeAllConnections()` is still the tool for cutting active connections when the backup timer fires.
- "Handle SIGKILL too." It cannot be caught.
- Readiness and liveness on the same endpoint. A failing liveness check during the drain makes the platform restart the instance instead of waiting.

### Numbers to quote
In a local test, a checkout request in flight when the terminate signal arrived still returned 200, readiness answered 503 during the drain, new connections were refused after close, and the process exited 0 well inside its 8 second timer, while a hanging request triggered the forced exit with code 1.

### Code sketch
```js
// server is an http.Server, pool is a pg Pool, `ready` is read by the /ready route
let shuttingDown = false;
process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;                                       // /ready answers 503, the balancer stops sending
  setTimeout(() => process.exit(1), 20_000).unref();   // hard timeout, shorter than the grace period
  setTimeout(() => server.close(async () => {          // refuse new, finish in-flight, close idle sockets
    await pool.end();
    process.exit(0);
  }), 5_000);                                          // let the readiness change reach the balancer
});
```

Full server used by the script: [graceful-server.mjs](code/deploy/graceful-server.mjs).

Unverified: needs Kubernetes and Docker. The pre stop hook, how fast endpoint removal reaches the balancer, the grace period's SIGKILL, and signal forwarding when a wrapper is PID 1 were not run on this machine.

Verified by [verify-dp1.mjs](code/deploy/verify-dp1.mjs)

### Source
Lessons 40, 101, 102, 105.

---

## DP2. A Node service in a 512 MB container restarts every few hours
**Tag: Likely**

### Before you speak
- **Today:** the container has a 512 MB memory limit. With steady traffic, memory slowly climbs until something kills the process, and the platform restarts it.
- **Two different killers:** Node's engine has its own heap limit. If it cannot free enough memory, it aborts with "JavaScript heap out of memory" in the logs and exit code 134. The Linux kernel enforces the container limit. If total memory goes past it, the kernel kills the container with exit code 137, and Node prints nothing.
- **Why the kernel can win:** the heap is not all of the memory. Buffers, compiled code and native libraries sit outside it. If the heap limit is close to the container limit, the total passes the container limit first, and you get a silent kill.
- **A hidden extra:** the usual heap flag sets only old space. The young generation is added on top, so the real heap limit is bigger than the flag. Log the real limit at startup.
- **The fix:** set the heap flag well below the container limit, so a leak fails with a readable error. Then find the leak by watching heap used and resident memory over hours, and by comparing heap snapshots taken minutes apart.
- **The trade-off to mention:** a smaller heap fails sooner, but cleanly, with an error you can read.

### Scenario
"Our notification service runs in containers with a 512 MB memory limit. Every few hours each container restarts, and traffic is steady. Sometimes there is a stack trace in the logs, sometimes nothing at all. How do you find out what is happening and fix it?"

### Questions to ask back
- **What exit code and reason does the platform record?** 134 with a heap error means the engine hit its own limit. 137 with an out-of-memory reason means the kernel killed the container.
- **Is a heap size flag set, and to what?** If it is close to or above the container limit, the kernel kill comes before any readable error.
- **Does the service handle large Buffers, images or file uploads?** That memory lives outside the heap, so it needs its own room under the limit.
- **Do several workers share the container?** Each worker has its own heap, so the limit has to be split between them.

### Spoken answer
> A restart every few hours with steady traffic points to memory climbing until something kills the process. First I find out who kills it. If the logs show a heap out of memory error and an abort, the engine hit its own limit. If there is no error and the platform reports an out of memory kill, the kernel did it, because total memory passed the container limit. Process memory is the heap plus Buffers, compiled code and native libraries. So I set the heap flag well below the container limit, and log the reported limit at startup, because the young generation is added on top. Then I fix the real cause. I watch heap used and resident memory over hours, and compare heap snapshots taken minutes apart to see what grows. The trade off is that a smaller heap fails sooner, but cleanly, with an error you can read.

### Say it in 5 beats
1. Who killed it: engine or kernel?
2. Heap error means the engine limit.
3. Silent kill means the container limit.
4. Heap flag well below container limit.
5. Snapshots find the leak. Trade-off: earlier failure.

### Case variations
- **"Resident memory grows but heap used is flat."**
  > Then it is not a leak of JavaScript objects. I look at Buffer and array buffer memory, for example streams that are never read to the end, and at native modules.
- **"Can we just raise the container limit?"**
  > It buys time while I find the leak. A real leak fills any limit, it just takes longer to get there.
- **"We never set a heap flag at all."**
  > Then I print the reported heap limit from inside the container. Recent Node versions size the default heap from the container limit, but I check instead of assuming.
- **"We run several cluster workers in one container."**
  > Each worker has its own heap and its own Buffers. They all share one container limit, so each worker's heap flag must be a fraction of it.

### Follow-up questions
- **Why 134 and not 137?** An exit code above 128 means the process was stopped by a signal, and you subtract 128 to get the signal number. 134 is 128 plus 6, the abort signal the engine raises when a full cleanup cannot get under the limit. 137 is 128 plus 9, the kill signal the kernel sends. Only the first leaves a Node error.
- **Can you catch a heap out of memory error?** No. It is not a normal exception. No try and catch block, uncaught exception handler or exit listener runs. The local script checks all three.
- **How do you size the flag?** Under real load, measure resident memory minus heap. That is what the process needs outside the heap. Then the real heap limit, plus that amount, plus a safety margin, must fit under the container limit. Use the heap limit Node reports, not the flag, because the young generation is added on top.
- **Optional: senior. How do you take a heap snapshot in production safely?** Writing one pauses the process and needs extra memory close to the heap's size, so a nearly full instance can be killed while writing it. I take it on one instance after failing its readiness, so it gets no traffic. Or I start Node with the flag that writes a snapshot when it receives a signal, send the signal, take a second one minutes later, and compare what grew.

### Common wrong answers and red flags
- Setting the old space flag equal to the container limit. The young generation, Buffers and native memory sit on top, so the kernel kills the container first.
- Following the rule of thumb "700 to 768 MiB old space for a 1 GiB container". On this machine a 768 MiB old space reports a 960 MiB heap limit, which leaves about 64 MiB of a 1 GiB container for everything else. Start nearer half the limit, for example 512 MiB, and measure.
- Setting 384 MiB of old space for a 512 MiB container. By the same math it reports a 576 MiB heap limit, already over the container limit. Go lower, or also cap the young generation with `--max-semi-space-size`, which costs more frequent small cleanups.
- Wrapping the leak in `try/catch` or an `uncaughtException` handler. Neither one runs.
- "Schedule a restart every night." It hides the leak and still crashes on a busy day.
- Treating every rise in resident memory as a JavaScript leak. It can also be Buffers or native memory.

### Numbers to quote
In a local test, a 64 MiB old space reported a 256 MiB heap limit, a leaking process with a 32 MiB old space aborted with "JavaScript heap out of memory" and shell exit code 134, and the same 32 MiB old space held a 128 MiB Buffer without crashing.

### Code sketch
```js
// Log the real limit at startup, then memory by kind every minute.
import v8 from 'node:v8';
const mib = (n) => Math.round(n / 2 ** 20);
console.log('heap limit MiB', mib(v8.getHeapStatistics().heap_size_limit));
setInterval(() => {
  const m = process.memoryUsage();   // heapUsed: JS leaks, arrayBuffers: Buffers, rss: what the container sees
  console.log({ heapUsed: mib(m.heapUsed), arrayBuffers: mib(m.arrayBuffers), rss: mib(m.rss) });
}, 60_000).unref();
```

```sh
# 512 MiB container: reports a 304 MiB heap limit here, the rest is for Buffers and native memory
NODE_OPTIONS="--max-old-space-size=256 --max-semi-space-size=16" node server.js
```

Unverified: needs Docker. The kernel kill with exit 137, the platform's out-of-memory reason, and how Node sizes its default heap from a container limit were not run on this machine.

Verified by [verify-dp2.mjs](code/deploy/verify-dp2.mjs)

### Source
Lessons 02, 05, 89, 101, 105.
