# 09. Caching and Redis

> **Remember this**
> 1. Cache-aside: read the cache first. On a miss, read the database and save the result with a TTL, a time to live after which the key expires.
> 2. On a write, update the database first, then delete the cache key. Do not write the new value into the cache, and do not delete before the update.
> 3. A slow reader can still put an old value back after your delete. A TTL limits how long that lasts. A version number in the key removes the problem.
> 4. A stampede is one busy key expiring while many requests need it. Use single-flight inside each server, plus a lock with a token or an early refresh across servers.
> 5. Add jitter, a small random spread, to TTLs so keys filled at the same time do not all expire at the same time.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Cache | A fast copy of data kept close to the app, so it does not have to ask the database every time. |
| Redis | An in-memory key-value store that many servers can share. It is often used as a cache. |
| Cache-aside | The app reads the cache first. On a miss it reads the database and fills the cache itself. |
| Cache hit and miss | A hit means the value was in the cache. A miss means it was not, so the app reads the database. |
| TTL | Time to live: how long a key stays in the cache before it expires on its own. |
| Invalidation | Removing a cached value because the real data changed. |
| Stale data | A cached value that is older than what the database now holds. |
| Race condition | A bug where the result depends on which of two things finishes first. |
| Slow reader race | A reader fetches the old row, pauses, and writes it into the cache after a writer has already deleted the key. |
| Versioned key | A cache key with a version number in its name. Each write bumps the version, so old copies are never read again. |
| Hot key | One key that a very large number of requests read. |
| Stampede | A hot key expires and many requests miss at once, so they all run the same expensive query. |
| Single-flight | Inside one process, only the first miss runs the load. Other requests for the same key wait on that same promise. |
| Lock with token | A short lock stored in Redis with a random value. Only the holder whose value still matches may release it. |
| Atomic | Done as one step, so nothing else can run in the middle of it. |
| Early refresh | Rebuilding a value shortly before it expires, so readers rarely see a miss. |
| Jitter | A small random amount added to each TTL so keys do not all expire together. |
| Avalanche | Many keys expiring at the same moment, usually because they were filled together with the same TTL. |
| Cache penetration | Requests for keys that never exist, so nothing is ever cached and every request reaches the database. |
| Outbox | A place to record pending tasks, such as a cache delete, that a worker keeps retrying until each one succeeds. |

| # | Scenario | Tag |
|---|---|---|
| C1 | [Customers see the old price after a price change](#c1-customers-see-the-old-price-after-a-price-change) | Must know |
| C2 | [A hot dashboard key expires and floods the database](#c2-a-hot-dashboard-key-expires-and-floods-the-database) | Likely |

---

## C1. Customers see the old price after a price change
**Tag: Must know**

### Before you speak
- **Today:** the product page uses cache-aside. It reads the product from Redis, and on a miss it reads the database and stores the row with a TTL.
- **What goes wrong:** when a merchant changes the price, the cached copy is not removed correctly, so customers see the old price until the TTL runs out. Common causes are writing the new value into the cache, deleting the key before the database update, or a writer that never deletes at all.
- **Why the old price can come back:** even with the right order, a slow reader can read the old row, pause, and then write it into the cache after the writer deleted the key. That is a race condition.
- **The fix:** update the database first, then delete the key. The next read misses and fills the cache from the fresh row. Keep a TTL on every key as a safety net for any delete that gets missed.
- **Closing the race fully:** put a version number in the key. Each write bumps the version, so a slow reader can only fill an old key that nobody reads any more.
- **The trade-off to mention:** more reads hit the database after each write, and versioned keys add one extra cache lookup on every read.
- **Rule for money:** checkout always reads the price from the database. The cache is only for showing the page.

### Scenario
"Our e-commerce product page is cached in Redis. After a merchant changes a price, customers keep seeing the old price for a long time, and sometimes it comes back after it was fixed. What is going on, and how do you fix it?"

### Questions to ask back
- **How old may a price on the page be?** A few seconds on the page can be fine. Checkout must always read the price from the database, so this only shapes the display path.
- **Who writes prices?** If an admin tool, an import job and an API all write prices, every one of them must delete the key. Or I delete it from the database's change stream, so no writer can forget.
- **Is the page also cached by a CDN or the browser?** Then deleting the Redis key is not enough. I need a short cache lifetime on the page, or a CDN purge.
- **Is the cache shared, or kept in each server's memory?** Copies in each server's memory need an invalidation message sent to every server.

### Spoken answer
> Cache aside means the app reads the cache first. On a miss it reads the database and stores the result with a short lifetime. The stale price comes from the write path. On a price change, I update the database first, then delete the cache key. I delete rather than update the cached copy, because concurrent writers can finish in a different order and leave the wrong value. Deleting before the update is also wrong, because a reader can refill the old price in between. Even in the right order, a slow reader can fetch the old row, pause, and write it back after my delete. So every key has a lifetime as a safety net. For prices I keep it short, or put a version number in the key that each write bumps. The trade off is more database reads and an extra cache lookup on every read.

### Say it in 5 beats
1. Read cache, on miss fill with TTL.
2. Write: update database, then delete key.
3. Never update the cached copy directly.
4. Slow reader race: short TTL or versions.
5. Trade-off: more reads, extra lookup.

### Case variations
- **"The price update runs inside a database transaction."**
  > I delete the key after the commit, not inside the transaction. Before the commit, other readers still see the old row. If one of them misses the cache in that gap, it fills the cache with the old price again.
- **"The cache delete times out."**
  > The database already has the new price, so I retry the delete. If the retry can fail too, I record the delete in an outbox that a worker keeps retrying. The TTL is the last line of defence.
- **"Each server also keeps a small in-memory cache."**
  > Deleting the Redis key does not touch those copies. I publish an invalidation message that every server listens to, and each server drops its copy. I also keep the in-memory TTL very short.
- **"A customer was charged the old price."**
  > That is a correctness bug, not a cache bug. Checkout must read the price from the database inside the order transaction. The cache is only for display.

### Follow-up questions
- **Why delete the key instead of writing the new value into the cache?** Two writers can update the database in one order and the cache in the other order. The cache then keeps the losing writer's value. A delete has no value to get wrong, and the next read refills from the database.
- **Why not delete first, then update the database?** A reader that runs between the two steps misses the cache, reads the old row and puts it back. It then stays there until the TTL ends.
- **If you always delete on write, why keep a TTL?** Deletes get missed: a failed call, a writer that forgets, or the slow reader race. The TTL limits how long any of those can last.
- **Optional: senior. How do versioned keys close the slow reader race?** Readers first look up a version number, then read and fill the key with that version in its name. A write updates the database and increments the version. A slow reader can only fill the old key, which nobody reads any more. If the version key itself is lost, I start from a new random version, never from zero, so old keys are not reused.

### Common wrong answers and red flags
- Writing the new value into the cache on every update.
- Deleting the key before the database update, or inside a transaction that has not committed yet.
- Keys with no TTL, so one missed delete leaves a stale value forever.
- "Just set the TTL to one second." That removes most of the benefit of caching.
- Finding keys to delete with `KEYS product:*` in production. It walks every key and blocks Redis while it runs. Delete the keys you know.
- Charging the customer from the cached price.

### Numbers to quote
In a local test, update then delete showed the new price on the next read, writing the cache on update and deleting before the update both left the old price, a slow reader paused between its database read and its cache write put the old price back after the delete, and versioned keys returned the new price in that same race.

### Code sketch
```js
// cache has async get, set(key, value, ttlMs) and del: Redis in production, an in-process Map with TTL locally
async function getProduct(pool, cache, id) {
  const key = `product:${id}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const { rows: [row] } = await pool.query('SELECT id, price FROM products WHERE id = $1', [id]);
  if (row) await cache.set(key, row, 60_000);              // TTL is the safety net
  return row ?? null;
}
async function updatePrice(pool, cache, id, price) {
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
  await cache.del(`product:${id}`);                        // after the write; delete, never update
}
```

```js
// same cache, plus setNX (set if absent) and incr; randomInt comes from node:crypto
async function productKey(cache, id) {
  await cache.setNX(`product:${id}:ver`, randomInt(2 ** 47));   // random start, never reused
  return `product:${id}:v${await cache.get(`product:${id}:ver`)}`;
}
// read: getProduct as above, but with key = await productKey(cache, id)
async function updatePriceV(pool, cache, id, price) {
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
  await cache.incr(`product:${id}:ver`);                   // a slow reader can only fill the old key
}
```

Unverified: needs a Redis server. The same calls ran against an in-process cache, not Redis.
Verified by [verify-c1.mjs](code/cache/verify-c1.mjs)

### Source
Lessons 100, 110.

---

## C2. A hot dashboard key expires and floods the database
**Tag: Likely**

### Before you speak
- **Today:** the dashboard caches an expensive stats query with a TTL of one minute. Many users read that one key.
- **What goes wrong:** when the key expires, every request in that moment misses at once. They all run the expensive query together, so database CPU spikes. This is a cache stampede.
- **Fix inside one server:** single-flight. The first miss starts the query and stores its promise. Every other request for that key waits on the same promise, so each server runs the query only once.
- **Fix across servers:** single-flight only works inside one process, so many servers still run the query once each. For a very expensive query, take a short lock in Redis with a random token, so only one server rebuilds. Or refresh the value in the background before it expires, so users rarely see a miss.
- **Why the lock needs an expiry and a token:** the expiry frees the lock if the holder crashes. The token makes sure a holder deletes only its own lock, not one another server took after the first lock expired.
- **Jitter:** add a small random amount to each TTL, so keys filled together do not all expire in the same second.
- **The trade-off to mention:** users may see slightly old stats, and there are more moving parts to run and test.

### Scenario
"Our SaaS dashboard caches an expensive stats query for one minute. Every minute, right when the key expires, database CPU spikes and the dashboard slows down for everyone. What is happening, and how do you stop it?"

### Questions to ask back
- **How expensive is the query, and how many requests read that key?** Together they decide if single-flight is enough, or if I also need a lock across servers.
- **Can users see stats that are a little old?** If yes, I serve the old value while one request refreshes it, and nobody waits.
- **How many app servers are there?** With one, single-flight solves it. With many, each server still runs the query once.
- **Is it one global key or one key per tenant?** Many tenant keys filled at the same time also need jitter, so they do not expire together.

### Spoken answer
> This is a cache stampede. A hot key expires, and every request misses at the same moment, so they all run the expensive query together. Inside each server, I use single flight. The first miss starts the query, and every other request waits on that same promise. Across servers, each one still runs it once, so for a really expensive query I add a short lock with a unique token, released only if the token still matches. The others serve the old value or wait briefly. Better still, a background refresh renews the value before it expires, so users rarely see a miss. I also add random jitter to lifetimes, so keys warmed together do not expire together. The trade off is slightly stale data and more moving parts, and the lock needs an expiry so a crashed holder cannot block everyone.

### Say it in 5 beats
1. Hot key expires, everyone misses together.
2. Single flight: one query per server.
3. Across servers: token lock or early refresh.
4. Jitter TTLs so expiries spread out.
5. Trade-off: stale data, more moving parts.

### Case variations
- **"The stats query sometimes fails."**
  > The failure must not be cached. Every waiting request gets the error, the in-flight entry is cleared, and the next request tries again. If I still have the old value, I serve that instead of an error.
- **"We run twenty servers."**
  > Single-flight still leaves one query per server, so twenty queries at each expiry. I either take a lock with a token so only one server rebuilds, or have one scheduled job recompute the stats and write the key. Then requests never compute it at all.
- **"We warmed thousands of keys at boot with the same one hour TTL."**
  > That is an avalanche, not a stampede, because they all expire in the same second. Adding about ten percent random jitter to each TTL spreads the expiries over several minutes.
- **"Bots request stats for tenant ids that do not exist."**
  > That is cache penetration. Nothing gets cached for a missing tenant, so every request reaches the database. I cache the not found result for a short time, and I validate ids before querying.

### Follow-up questions
- **Why must single-flight clear its entry when the load fails?** Otherwise the failed promise stays in the map. Every later request joins it and gets the same old error without ever trying again.
- **Stampede, avalanche, penetration: what is the difference?** A stampede is one hot key, meaning a key many requests read, expiring under load. Fix it with single-flight, a lock or early refresh. An avalanche is many keys expiring together, fixed with jitter. Penetration is requests for keys that never exist, fixed by caching a short not found value.
- **Why does the lock store a random token?** If the holder is slow, its lock can expire and another server takes it. A plain delete from the first holder would then remove the second holder's lock. Deleting only when the stored token still matches, in one atomic step, meaning nothing can run between the check and the delete, prevents that.
- **Optional: senior. How does early refresh work without a lock?** Each request near expiry has a small chance to refresh the value early, and that chance grows as expiry gets closer. Usually one request refreshes first, and the others keep reading the value that is still valid. An in-process cache can do the same with a stale while refresh mode.

### Common wrong answers and red flags
- "Make the TTL longer." The stampede still happens, just less often.
- A lock with no expiry, so a crashed holder blocks everyone.
- A lock that stores a fixed value and is released with a plain delete. A slow holder can then delete a lock that another server now holds. Store a random token and delete only if it still matches.
- Waiting for the lock by retrying forever with no limit. Cap the retries, then serve the old value or read the database directly.
- Caching a failed promise, so one failure is served to every request after it.
- Giving every key filled at the same time the same TTL.
- Believing single-flight protects the database across servers. It only works inside one process.

### Numbers to quote
In a local test, 100 concurrent misses ran the stats query 100 times without single-flight and once with it, two separate single-flight instances still ran it twice, and with ten percent jitter 1000 keys warmed together never had more than 15 expiring in the same second, instead of all 1000.

### Code sketch
```js
function singleFlight(load) {
  const inFlight = new Map();                               // key -> promise of the running load
  return (key) => {
    if (inFlight.has(key)) return inFlight.get(key);        // join the load already running
    const p = load(key).finally(() => inFlight.delete(key)); // cleared on success and on failure
    inFlight.set(key, p);
    return p;
  };
}
const jitter = (baseMs, spread = 0.1) => Math.round(baseMs * (1 - spread + Math.random() * 2 * spread));
```

```js
// redis is an ioredis client; locally an in-process cache with setNX and a token check stands in for it
import { randomUUID } from 'node:crypto';
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const token = randomUUID();
if (await redis.set(`lock:${key}`, token, 'PX', 10_000, 'NX')) {
  try { await rebuild(key); } finally { await redis.eval(RELEASE, 1, `lock:${key}`, token); }
}
```

Unverified: needs a Redis server. SET NX PX and the Lua release were not run; the script checks the same acquire and token-checked release on an in-process stand-in.
Verified by [verify-c2.mjs](code/cache/verify-c2.mjs)

### Source
Lessons 100, 110.
