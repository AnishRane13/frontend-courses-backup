# 11. Deployment

> **Remember this**
> 1. On the terminate signal: readiness fails first, wait a moment, then `server.close()`, close pools, exit 0.
> 2. `server.close()` refuses new connections, lets in-flight requests finish, and since Node 19 also closes idle keep-alive sockets.
> 3. A forced-exit timer (`setTimeout(...).unref()`) must be shorter than the orchestrator's grace period.
> 4. Heap out of memory is V8 aborting (exit 134, "JavaScript heap out of memory"). A silent exit 137 is the kernel killing the container.
> 5. `heap_size_limit` is old space plus the young generation, and Buffers sit outside it. Leave real headroom under the container limit.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| DP1 | [Every deploy causes 502s and cut off checkouts](#dp1-every-deploy-causes-502s-and-cut-off-checkouts) | Must know |
| DP2 | [A Node service in a 512 MB container restarts every few hours](#dp2-a-node-service-in-a-512-mb-container-restarts-every-few-hours) | Likely |

---

## DP1. Every deploy causes 502s and cut off checkouts
**Tag: Must know**

### Scenario
"Every time we deploy our e-commerce API, monitoring shows a burst of 502 errors for about a minute, and a few customers say their checkout spun and then failed. We run several instances behind a load balancer with rolling deploys. What is going wrong, and how do you fix it?"

### Questions to ask back
- **What runs the app: Kubernetes, ECS, PM2 on a VM?** That tells me who sends the terminate signal and how long the grace period is before a hard kill.
- **Is there a readiness check, and does the balancer use it?** If not, the balancer keeps routing to a dying instance, and I have to add one first.
- **How long can the slowest legitimate request take?** A checkout that calls a payment provider sets the minimum drain time.
- **Is the process started directly, or through npm or a shell script?** If a wrapper does not forward the signal, the app never gets a chance to drain.

### Spoken answer
> Those errors mean the old instance dies while it still has traffic. On the terminate signal, the process should not exit straight away. First I flip the readiness check to failing, so the load balancer stops sending new requests, and I keep serving for a few seconds while that change spreads. Then I close the server. It refuses new connections, lets in flight requests like a checkout finish, and closes idle keep alive connections. After that I close the database pool and flush logs, then exit cleanly. A hard timer forces an exit if one request hangs, and it must be shorter than the orchestrator's grace period, or the process is killed in the middle of the drain. The rolling deploy only moves traffic to a new instance once its readiness passes. The trade off is slower deploys, because every old instance waits for its slowest request.

### Say it in 5 beats
1. Terminate signal: readiness fails first.
2. Wait briefly, then close the server.
3. In-flight requests finish, idle sockets close.
4. Close pools, exit, hard timer backup.
5. Trade-off: slower deploys, safer checkouts.

### Case variations
- **"We run on Kubernetes."**
  > The pre stop hook can do the short wait while the pod is removed from the endpoints. The grace period, thirty seconds by default, covers the hook and my drain, so my hard timer must fit inside what is left.
- **"A checkout can take longer than the grace period."**
  > Then I either raise the grace period or stop doing that work inside the request. Long work goes to a queue, and the request returns quickly with a status to poll.
- **"Some clients hold WebSocket connections."**
  > Closing the server does not close upgraded connections. I send each client a close message with a reconnect hint, so it reconnects to a new instance.
- **"The terminate signal arrives twice."**
  > The handler is guarded by a flag, so the second signal does nothing. Otherwise I would call close twice and could exit before the drain ends.

### Follow-up questions
- **Why fail readiness before closing the server, not after?** Removing an instance from the balancer takes a moment to spread. If I close first, the balancer still sends new connections, they are refused, and users see 502s.
- **What does the exit code tell you?** Exit 0 means a clean drain. The forced exit uses 1, so a deploy log full of exit 1 points to a request that hangs, which is worth investigating.
- **Why does it matter how the process is started?** If npm or a shell runs as the main process, the signal may never reach Node. Start Node directly, or use an init process that forwards signals.
- **Optional: senior. How do you prove a deploy is really zero downtime?** Run a load test through the balancer during a rolling deploy and count non-2xx responses and resets. Also make database migrations backward compatible, because old and new versions serve traffic at the same time during the rollout.

### Common wrong answers and red flags
- Calling `process.exit()` straight from the signal handler. In-flight checkouts are cut off.
- Calling `server.close()` before readiness fails, so the balancer keeps sending to a closed port.
- No forced-exit timer, or a timer longer than the grace period, so the platform's SIGKILL wins.
- Copying lesson 102's claim that idle keep-alive sockets hold `server.close()` forever. Since Node 19, `server.close()` closes idle keep-alive connections itself. The local script sets a 60 second keep-alive timeout and the idle socket still closes the moment `close()` runs. `closeAllConnections()` is still the tool for cutting active connections when the hard timer fires.
- "Handle SIGKILL too." It cannot be caught.
- Readiness and liveness on the same endpoint. A failing liveness check during the drain makes the orchestrator restart the instance instead of waiting.

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

### Scenario
"Our notification service runs in containers with a 512 MB memory limit. Every few hours each container restarts, and traffic is steady. Sometimes there is a stack trace in the logs, sometimes nothing at all. How do you find out what is happening and fix it?"

### Questions to ask back
- **What exit code and reason does the platform record?** 134 with a heap error means V8 hit its own limit. 137 with an out-of-memory reason means the kernel killed the container.
- **Is a heap size flag set, and to what?** If it is set at or above the container limit, the kernel kill comes before any readable error.
- **Does the service handle large Buffers, images or file uploads?** That memory lives outside the heap and needs its own headroom.
- **Do several workers share the container?** Each worker has its own heap, so the limit has to be divided.

### Spoken answer
> A restart every few hours with steady traffic points to memory climbing until something kills the process. First I find out who kills it. If the logs show a heap out of memory error and an abort, V8 hit its own limit. If there is no error and the platform reports an out of memory kill, the kernel did it, because total memory passed the container limit. Node's memory is the heap plus Buffers, compiled code and native libraries. So I set the heap size flag well below the container limit, and log the reported limit at startup, because the young generation is added on top. Then I fix the real cause. I watch heap used and resident memory over hours, and compare heap snapshots taken minutes apart to see what grows. The trade off is that a smaller heap fails sooner, but cleanly, with an error you can read.

### Say it in 5 beats
1. Who killed it: V8 or kernel?
2. Heap error means the V8 limit.
3. Silent kill means the container limit.
4. Heap flag well below container limit.
5. Snapshots find the leak. Trade-off: earlier failure.

### Case variations
- **"Resident memory grows but heap used is flat."**
  > Then it is not a JavaScript object leak. I look at Buffer and array buffer memory, for example streams that are never consumed, and at native modules.
- **"Can we just raise the container limit?"**
  > It buys time while I find the leak. A real leak fills any limit, it just takes longer.
- **"We never set a heap flag at all."**
  > Then I print the reported heap limit inside the container. Recent Node versions size the default heap from the container limit, but I check instead of assuming.
- **"We run several cluster workers in one container."**
  > Each worker has its own heap and its own Buffers. The limit is shared, so each worker's heap flag must be a fraction of it.

### Follow-up questions
- **Why 134 versus 137?** 134 is 128 plus 6, the abort signal V8 raises when a full collection cannot get under the limit. 137 is 128 plus 9, the kill signal the kernel sends. Only the first leaves a Node error.
- **Can you catch a heap out of memory error?** No. It is not an exception. No `try/catch`, `uncaughtException` handler or `exit` listener runs. The local script checks all three.
- **How do you size the flag?** Measure resident memory minus heap under real load, that is your off-heap need. Then heap limit plus off-heap plus a safety margin must fit under the container limit. Print `v8.getHeapStatistics().heap_size_limit`, not the flag, because the young generation is added.
- **Optional: senior. How do you take a heap snapshot in production safely?** Writing one pauses the process and needs extra memory close to the heap's size, so a near-full instance can be killed while writing it. Take it on one instance after failing its readiness, or start with `--heapsnapshot-signal` and send the signal, then take a second one minutes later and compare what grew.

### Common wrong answers and red flags
- Setting the old space equal to the container limit. The young generation, Buffers and native memory sit on top, so the kernel kills the container first.
- Copying lessons 02 and 05: "700 to 768 MiB old space for a 1 GiB container". On this machine a 768 MiB old space reports a 960 MiB heap limit, which leaves about 64 MiB of a 1 GiB container for everything else. Start nearer half the limit, for example 512 MiB, and measure.
- Lesson 105's 384 MiB for a 512 MiB container has the same problem by lesson 02's own formula: it reports 576 MiB. Go lower, or also cap the semi space with `--max-semi-space-size`, which costs more frequent minor collections.
- Wrapping the leak in `try/catch` or an `uncaughtException` handler.
- "Schedule a restart every night." It hides the leak and still crashes on a busy day.
- Treating every resident memory rise as a JavaScript leak.

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
