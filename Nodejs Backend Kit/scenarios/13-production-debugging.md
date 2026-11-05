# 13. Production debugging

> **Remember this**
> 1. If users are hurt, roll back first. Debug the difference between the two versions afterwards.
> 2. Metrics before tools: event loop delay, heap used after GC, and RSS, compared with the previous version.
> 3. A leak needs two heap snapshots minutes apart, compared. A CPU problem needs a CPU profile under load.
> 4. Usual leaks: a cache with no limit, listeners added per request, closures holding requests. Usual CPU hogs: sync crypto or a huge `JSON.parse` in a hot path.
> 5. Node closes idle keep-alive sockets after `keepAliveTimeout` (5 s default). Behind a balancer, set it above the balancer's idle timeout, and `headersTimeout` above that.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| PD1 | [Memory and latency climb after a deploy](#pd1-memory-and-latency-climb-after-a-deploy) | Must know |
| PD2 | [Intermittent 502s behind the load balancer](#pd2-intermittent-502s-behind-the-load-balancer) | Likely |

---

## PD1. Memory and latency climb after a deploy
**Tag: Must know**

### Scenario
"After yesterday's deploy, memory on our SaaS API grows steadily until the instances restart, and p99 latency has doubled. The release had about forty commits. How do you find the cause?"

### Questions to ask back
- **Are users affected right now?** If yes, I roll back first and investigate the old and new builds side by side, not under pressure.
- **Is it heap used that grows, or only resident memory?** Heap growth is a JavaScript leak. Resident growth with a flat heap points to Buffers or native code.
- **Does it grow with traffic or with time?** Growth per request points to a cache or listeners. Growth with time points to timers or intervals.
- **Do we have event loop delay and heap metrics per version?** If not, adding them is the first step, because they tell CPU and memory apart.

### Spoken answer
> If users are hurting, I roll back first. Then I compare the new version with the previous one on three metrics: event loop delay, heap used after collection, and resident memory. Heap used climbing with traffic means something holds objects, and latency rises because garbage collection works harder. I take two heap snapshots a few minutes apart from one instance, compare them, and look at what grew and what retains it. The usual causes are an in memory cache with no limit, listeners added on every request, or closures holding request objects. If CPU is the problem, I record a CPU profile under load. It names the hot function, often a synchronous hash or a huge parse in a request path. The fix is a bounded cache, removed listeners, or moving work off the main thread. The trade off is that profiling a live instance adds overhead.

### Say it in 5 beats
1. Users hurt: roll back first.
2. Compare versions: loop delay, heap, memory.
3. Two heap snapshots, compare the growth.
4. CPU profile names the hot function.
5. Fix the cause. Trade-off: profiling overhead.

### Case variations
- **"Heap used is flat, but resident memory keeps growing."**
  > Then it is not a JavaScript object leak. I look at Buffer memory, streams that are never drained, and native modules, using the array buffer and external numbers.
- **"Memory is fine, only p99 latency got worse."**
  > That is CPU on the main thread. Event loop delay will be up, and a CPU profile under load shows which function holds the thread, often a synchronous hash or a big parse.
- **"We cannot reproduce it locally."**
  > I take snapshots from one production instance after removing it from rotation, or replay recorded traffic with a load test against the new build in staging.
- **"We cannot roll back because of a database migration."**
  > Then I turn the feature off with a flag if there is one. This is why migrations should stay backward compatible for a release.

### Follow-up questions
- **Why two snapshots, not one?** One snapshot shows what is alive, including caches you meant to keep. The comparison shows what grows, and the retainer path shows what holds it.
- **How do you measure event loop delay?** `perf_hooks.monitorEventLoopDelay()` gives a histogram. I export its p99 next to heap used, so a CPU problem and a memory problem look different on the dashboard.
- **Why does a leak make latency worse?** A bigger old space means more marking work in each major collection, and the collector runs more often as the heap nears its limit, so requests wait.
- **Optional: senior. Is an LRU cache the whole fix?** It bounds memory, but a count limit does not bound size if entries vary, so use a size limit with a size calculation, and a TTL for freshness. Each instance also has its own copy, so if instances must agree, the cache belongs in Redis.

### Common wrong answers and red flags
- "Restart the instances every night." It hides the leak and still fails on a busy day.
- Taking one heap snapshot and blaming the biggest object.
- Taking a snapshot on a serving instance near its limit. Writing it pauses the process and needs extra memory, which can kill it.
- Optimizing code by guessing before a CPU profile.
- "The garbage collector will free it." It only frees objects nothing references. A module-level `Map` references everything put in it.
- Looking only at the new code instead of comparing metrics against the previous version.

### Numbers to quote
In a local test, 3,000 requests with new product ids grew heap used after GC by more than 20 MiB with a plain Map cache and by less than 5 MiB with a 500 entry LRU cache, and the parsed CPU profile ranked `renderProduct` first by self time.

### Code sketch
```js
import { LRUCache } from 'lru-cache';
// Before: const cache = new Map();   every new key stays forever, heap grows with traffic
const cache = new LRUCache({ max: 500 });   // bounded: the least recently used entry is evicted
```

```js
// file is a .cpuprofile written by: node --cpu-prof --cpu-prof-dir=prof server.js
import { readFileSync } from 'node:fs';
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const self = new Map();                                  // function name -> self time in microseconds
prof.samples.forEach((id, i) => {
  const name = byId.get(id).callFrame.functionName || '(anonymous)';
  self.set(name, (self.get(name) ?? 0) + prof.timeDeltas[i]);
});
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 5));   // the hot functions by name
```

Server used by the script: [cache-server.mjs](code/debugging/cache-server.mjs).

Verified by [verify-pd1.mjs](code/debugging/verify-pd1.mjs)

### Source
Lessons 89, 107, 108, 109, 110.

---

## PD2. Intermittent 502s behind the load balancer
**Tag: Likely**

### Scenario
"Our SaaS dashboard API sits behind a cloud load balancer. A few requests a minute fail with 502, at random, even at low traffic, and there is nothing in our application logs for them. What do you check?"

### Questions to ask back
- **What is the balancer's idle timeout?** If it is longer than the server's keep alive timeout, I expect the keep-alive race.
- **What do the balancer's own logs say for those requests?** A reset or closed connection from the target confirms the request never reached our handler.
- **Are they 502s or 504s?** A 504 is a slow answer, which points to timeouts or a full database pool instead.
- **Do instances restart around the same time?** A crash or deploy also produces 502s, and that is a different fix.

### Spoken answer
> Failures with nothing in our logs usually mean the request never reached our code. The classic cause is keep alive timing. The balancer keeps idle connections open for a long time, but the server's keep alive timeout is only a few seconds by default. So the server closes an idle connection at the moment the balancer sends a new request on it. That request gets a reset, and the balancer answers with a bad gateway. The fix is to set the server's keep alive timeout above the balancer's idle timeout, and the headers timeout above that. I would also check the balancer's logs and timeouts, crashes and restarts, and a full database pool. The trade off is more idle connections held open on each instance, which costs a little memory and some file handles.

### Say it in 5 beats
1. Nothing logged: never reached our code.
2. Server closes idle connection first.
3. Balancer reuses it, gets reset.
4. Server timeout above balancer idle timeout.
5. Trade-off: more idle connections held.

### Case variations
- **"We are behind NGINX, not a cloud balancer."**
  > Same rule. NGINX keeps idle upstream connections for its own keep alive timeout, so the server's timeout must be longer than that.
- **"The failures are 504s, not 502s."**
  > Then the server answered too slowly. I look at slow queries, a database pool that is exhausted, and the balancer's request timeout.
- **"The 502s only happen during deploys."**
  > That is a shutdown problem, not keep alive timing. The old instance needs to fail readiness and drain before it closes.
- **"We raised the timeout and still see a few."**
  > I check that the headers timeout is above it, that every hop is configured, and that the instances are not crashing. Safe retries at the balancer for idempotent requests cover the rest.

### Follow-up questions
- **Why does it only hit a few requests?** The connection has to sit idle for exactly the server's timeout and then be reused in the same moment, so only a small fraction of connections lose the race.
- **Why set the headers timeout above the keep alive timeout?** It is the documented safe order. On older Node versions a shorter headers timeout could close a reused connection before the keep alive timeout did.
- **What does Node 24 do here?** It advertises the timeout in the `Keep-Alive` response header and keeps the socket open for an extra `keepAliveTimeoutBuffer`, 1 second by default, so a client that honours the header closes first. The balancer may ignore that header, so the rule still applies.
- **Optional: senior. Can the same race hit your outgoing calls?** Yes. Our HTTP agent reuses idle sockets to an upstream that closes them after its own timeout. I set the agent's free socket timeout below the upstream's keep alive timeout, and retry idempotent calls once on a reset.

### Common wrong answers and red flags
- Lesson 102's sketch sets `server.keepAliveTimeout = 5000` with "don't let idle sockets linger". Behind a balancer with a 60 second idle timeout, that is exactly this bug. Set it above the balancer's timeout, for example 65 seconds, with `headersTimeout` above that.
- Lesson 40's table says the keep-alive timeout is how long an idle socket waits. On Node 24.19 the socket really closes after `keepAliveTimeout` plus `keepAliveTimeoutBuffer` (1 second), as the local script measures. Lesson 97 states this correctly.
- Disabling keep-alive at the balancer. It hides the race by opening a new connection per request, which costs latency.
- Only searching the application logs. The request never reached them.
- Letting the balancer retry every request, including non-idempotent POSTs.

### Numbers to quote
In a local test, with a 1 second keep alive timeout the server closed an idle socket after about 1 second with no buffer and about 2 seconds with the default buffer, a request sent on that connection after the close got no response while one sent at 400 ms got 200, and with the timeout raised to 5 seconds the socket still answered at 2.5 seconds.

### Code sketch
```js
// server is the http.Server; the balancer's idle timeout is assumed to be 60 s (check yours)
server.keepAliveTimeout = 65_000;   // longer than the balancer keeps idle connections
server.headersTimeout = 66_000;     // and the headers timeout above that
```

Unverified: needs a real load balancer. The exact same-moment race and the 502 the balancer returns were not reproduced; the script proves the close timing and that a request sent on the connection after the close gets no answer.

Verified by [verify-pd2.mjs](code/debugging/verify-pd2.mjs)

### Source
Lessons 40, 97, 102, 110.
