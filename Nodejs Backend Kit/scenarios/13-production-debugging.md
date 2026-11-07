# 13. Production debugging

> **Remember this**
> 1. If users are hurting, roll back first. Find the cause afterwards by comparing the old and new versions.
> 2. Read metrics before reaching for tools: event loop delay, heap used after garbage collection, and total process memory, each compared with the previous version.
> 3. For a leak, take two heap snapshots minutes apart and compare them. For a CPU problem, record a CPU profile under load.
> 4. Usual leaks: a cache with no limit, listeners added on every request, closures holding requests. Usual CPU hogs: synchronous crypto or a huge JSON parse on a busy path.
> 5. Node closes an idle keep-alive connection after a few seconds by default. Behind a load balancer, set that timeout above the balancer's idle timeout, and the headers timeout above that.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Rollback | Putting the previous working version back into production. |
| p99 latency | The time within which ninety nine out of a hundred requests finish. It shows how slow the slowest requests are. |
| Event loop delay | How late Node's main thread is in picking up the next task. It goes up when the thread is busy with CPU work. |
| Heap | The memory where JavaScript objects live. |
| Garbage collection | Node's automatic cleanup that frees objects nothing refers to any more. |
| Heap used after garbage collection | How much heap is still in use right after a cleanup. If it keeps climbing, something is holding objects. |
| Resident memory | All memory the process holds, called RSS. It includes the heap plus Buffers and native code. |
| Memory leak | Memory that keeps growing because the code still refers to objects it no longer needs. |
| Heap snapshot | A file that lists every object in the heap at one moment and what refers to each one. |
| Retainer path | The chain of references that keeps an object alive, such as a module level map that holds it. |
| Unbounded cache | A cache with no size limit. Every new key stays forever. |
| LRU cache | A cache with a size limit that drops the least recently used entry when it is full. |
| CPU profile | A recording of which functions were running and for how long, taken while the app works. |
| Hot function | The function that uses the most CPU time in a profile. |
| Load balancer | A server in front of your instances that spreads incoming requests across them. |
| 502 Bad Gateway | The balancer's answer when the server behind it closed or broke the connection instead of replying. |
| 504 Gateway Timeout | The balancer's answer when the server behind it took too long to reply. |
| Keep-alive | Reusing one open connection for many requests instead of opening a new one each time. |
| Idle timeout | How long the balancer keeps an unused connection open before closing it. |
| Keep-alive timeout | How long Node keeps an unused connection open before closing it. It is a few seconds by default. |
| Headers timeout | How long Node waits for a client to finish sending request headers before giving up. |

| # | Scenario | Tag |
|---|---|---|
| PD1 | [Memory and latency climb after a deploy](#pd1-memory-and-latency-climb-after-a-deploy) | Must know |
| PD2 | [Intermittent 502s behind the load balancer](#pd2-intermittent-502s-behind-the-load-balancer) | Likely |

---

## PD1. Memory and latency climb after a deploy
**Tag: Must know**

### Before you speak
- **Today:** a release with about forty commits went out. Memory climbs until instances restart, and the slowest requests, the p99, now take twice as long.
- **First move:** if users are hurting, roll back. The old version is known to be good, and you can then debug calmly by comparing the two builds.
- **Read the metrics to choose the tool:** event loop delay going up means the main thread is busy with CPU work. Heap used after garbage collection climbing means JavaScript objects are being kept forever. Resident memory rising while the heap stays flat points to Buffers or native code.
- **Why a leak also makes things slow:** the garbage collector has more live objects to check, and it runs more often as the heap fills up. Requests wait while it works.
- **Tool for memory:** two heap snapshots a few minutes apart, compared. What grew between them is the leak, and its retainer path shows what is holding it. Common culprits are a cache with no limit, listeners added on every request, and closures that keep request objects alive.
- **Tool for CPU:** a CPU profile under load. It ranks functions by time, so it names the hot function, often a synchronous hash or a huge parse, instead of you guessing.
- **The trade-off to mention:** snapshots and profiles slow down or pause the instance, so take them on one instance that is out of rotation.

### Scenario
"After yesterday's deploy, memory on our SaaS API grows steadily until the instances restart, and p99 latency has doubled. The release had about forty commits. How do you find the cause?"

### Questions to ask back
- **Are users affected right now?** If yes, I roll back first and compare the old and new builds side by side, without the pressure.
- **Is it the heap that grows, or only total process memory?** Heap growth is a JavaScript leak. Total memory growing with a flat heap points to Buffers or native code.
- **Does it grow with traffic or with time?** Growth per request points to a cache or listeners. Growth with time, even when idle, points to timers.
- **Do we have event loop delay and heap metrics per version?** If not, adding them is my first step, because they tell a CPU problem from a memory problem.

### Spoken answer
> If users are hurting, I roll back first. Then I compare the new version with the previous one on three metrics: event loop delay, heap used after collection, and resident memory. Heap used climbing with traffic means something holds objects, and latency rises because garbage collection works harder. I take two heap snapshots a few minutes apart from one instance, compare them, and look at what grew and what retains it. The usual causes are an in memory cache with no limit, listeners added on every request, or closures holding request objects. If CPU is the problem, I record a CPU profile under load. It names the hot function, often a synchronous hash or a huge parse in a request path. The fix is a bounded cache, removed listeners, or moving work off the main thread. The trade-off is that profiling a live instance adds overhead.

### Say it in 5 beats
1. Users hurting: roll back first.
2. Compare versions: loop delay, heap, memory.
3. Two heap snapshots, compare the growth.
4. CPU profile names the hot function.
5. Fix the cause. Trade-off: profiling overhead.

### Case variations
- **"Heap used is flat, but resident memory keeps growing."**
  > Then it is not a leak of JavaScript objects. I would look at Buffer memory, streams that are never read to the end, and native modules. Node reports array buffer and external memory separately, so those numbers show where it goes.
- **"Memory is fine, only p99 latency got worse."**
  > Then something is using CPU on the main thread. Event loop delay will be up too. A CPU profile under load shows which function holds the thread, often a synchronous hash or a big parse.
- **"We cannot reproduce it locally."**
  > I would take snapshots from one production instance after removing it from the load balancer, so no user waits while it pauses. Or I replay recorded traffic with a load test against the new build in staging.
- **"We cannot roll back because of a database migration."**
  > Then I turn the new feature off with a feature flag, if there is one. This is why migrations should stay compatible with the previous version for at least one release.

### Follow-up questions
- **Why two snapshots, not one?** One snapshot shows everything alive, including caches you meant to keep. Comparing two shows what grows, and the retainer path, the chain of references holding an object, shows what keeps it alive.
- **How do you measure event loop delay?** Node has a built-in delay histogram that gives percentiles. I export its high percentile next to heap used, so a CPU problem and a memory problem look different on the dashboard.
- **Why does a leak make latency worse?** Long-lived objects sit in the old space, the part of the heap for objects that survived earlier cleanups. A bigger old space means more marking work in each major collection. The collector also runs more often as the heap nears its limit, so requests wait.
- **Optional: senior. Is an LRU cache the whole fix?** It limits memory, but a limit on the number of entries does not limit size if entries vary. So I would set a size limit with a size calculation, plus a lifetime so entries stay fresh. Each instance also keeps its own copy, so if instances must agree, the cache belongs in a shared store like Redis.

### Common wrong answers and red flags
- "Restart the instances every night." It hides the leak and still fails on a busy day.
- Taking one heap snapshot and blaming the biggest object.
- Taking a snapshot on an instance that is serving traffic near its memory limit. Writing the snapshot pauses the process and needs extra memory, which can crash it.
- Guessing which code is slow and optimizing it before recording a CPU profile.
- "The garbage collector will free it." It only frees objects nothing refers to. A `Map` at the top of a module refers to everything put in it.
- Reading only the new code instead of comparing metrics against the previous version.

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

### Before you speak
- **Today:** the load balancer keeps connections to the Node server open and reuses them for many requests. That reuse is called keep-alive, and it saves the cost of a new connection each time.
- **Who closes first:** both sides close a connection that has been idle for a while. The balancer's idle timeout is often long, for example sixty seconds. Node's keep-alive timeout is only a few seconds by default, so Node closes first.
- **What goes wrong:** Node closes an idle connection at the very moment the balancer sends a new request on it. The request lands on a closed connection and never reaches the app. The balancer answers 502 Bad Gateway, which is why the app logs show nothing.
- **Why only a few requests fail:** it needs exact timing. The connection must sit idle for just the timeout and be reused in that same moment.
- **The fix:** set Node's keep-alive timeout above the balancer's idle timeout, so the balancer always closes first. Set the headers timeout above that, which is the documented safe order.
- **The trade-off to mention:** more idle connections stay open on each instance, which costs a little memory and some file handles.
- **Other causes to rule out:** crashes and restarts, deploys that do not drain, and slow answers, which show up as 504 instead.

### Scenario
"Our SaaS dashboard API sits behind a cloud load balancer. A few requests a minute fail with 502, at random, even at low traffic, and there is nothing in our application logs for them. What do you check?"

### Questions to ask back
- **What is the balancer's idle timeout?** If it is longer than the server's keep-alive timeout, I expect this keep-alive race.
- **What do the balancer's own logs say for those requests?** A reset or closed connection from the server confirms the request never reached our code.
- **Are they 502s or 504s?** A 504 means the answer was too slow, which points to timeouts or a full database pool instead.
- **Do instances restart around the same time?** A crash or a deploy also causes 502s, and that needs a different fix.

### Spoken answer
> Failures with nothing in our logs usually mean the request never reached our code. The classic cause is keep alive timing. The balancer keeps idle connections open for a long time, but the server's keep alive timeout is only a few seconds by default. So the server closes an idle connection at the moment the balancer sends a new request on it. That request gets a reset, and the balancer answers with a bad gateway. The fix is to set the server's keep alive timeout above the balancer's idle timeout, and the headers timeout above that. I would also check the balancer's logs and timeouts, crashes and restarts, and a full database pool. The trade-off is more idle connections held open on each instance, which costs a little memory and some file handles.

### Say it in 5 beats
1. Nothing logged: never reached our code.
2. Server closes idle connection first.
3. Balancer reuses it, gets reset.
4. Server timeout above balancer idle timeout.
5. Trade-off: more idle connections held.

### Case variations
- **"We are behind NGINX, not a cloud balancer."**
  > The rule is the same. NGINX keeps idle connections to the server open for its own keep-alive timeout. So the Node server's timeout must be longer than that one.
- **"The failures are 504s, not 502s."**
  > Then the server did answer, just too slowly. I would look at slow queries, a database connection pool that has run out, and the balancer's request timeout.
- **"The 502s only happen during deploys."**
  > That is a shutdown problem, not keep-alive timing. The old instance should first report itself as not ready, so the balancer stops sending to it. Then it finishes the requests it has and only then closes.
- **"We raised the timeout and still see a few."**
  > I would check that the headers timeout is above it, that every hop in the chain is set the same way, and that instances are not crashing. For the rest, the balancer can safely retry idempotent requests, meaning requests that are safe to repeat, like a read.

### Follow-up questions
- **Why does it only hit a few requests?** The connection has to sit idle for exactly the server's timeout and then be reused in that same moment. Only a small share of connections lose that race.
- **Why set the headers timeout above the keep-alive timeout?** It is the documented safe order. On older Node versions, a shorter headers timeout could close a reused connection before the keep-alive timeout did.
- **What does a recent Node do here?** It tells the client its timeout in the keep-alive response header, and keeps the connection open for an extra buffer of about one second by default. A client that reads that header closes first. A balancer may ignore the header, so the rule still applies.
- **Optional: senior. Can the same race hit your outgoing calls?** Yes. Our HTTP agent, the object that pools connections for outgoing requests, reuses idle connections to a service that closes them after its own timeout. I set the agent's free socket timeout below that service's keep-alive timeout, and retry idempotent calls once if the connection is reset.

### Common wrong answers and red flags
- Setting the server keep-alive timeout to five seconds "so idle sockets do not linger" behind a balancer with a sixty second idle timeout. That is exactly this bug. Set it above the balancer's timeout, for example 65 seconds, with the headers timeout above that.
- Believing the keep-alive timeout is exactly how long an idle connection waits. On recent Node the connection really closes after the keep-alive timeout plus a buffer of one second, as the local script measures.
- Turning keep-alive off at the balancer. It hides the race by opening a new connection for every request, which adds latency.
- Only searching the application logs. The failed requests never reached them.
- Letting the balancer retry every request, including POSTs that are not safe to repeat.

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
