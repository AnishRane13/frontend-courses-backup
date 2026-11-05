# 09. Caching and Redis

> **Remember this**
> 1. Cache-aside: read the cache, on a miss read the database and store the value with a TTL.
> 2. On a write, update the database first, then delete the key. Do not write the new value into the cache, and do not delete before the update.
> 3. A slow reader can still put an old value back after the delete. A TTL bounds that, and a version in the key removes it.
> 4. A stampede is one hot key expiring under load. Single-flight per process, plus a lock with a token or an early refresh across servers.
> 5. Add jitter to TTLs so keys warmed together do not expire together.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| C1 | [Customers see the old price after a price change](#c1-customers-see-the-old-price-after-a-price-change) | Must know |
| C2 | [A hot dashboard key expires and floods the database](#c2-a-hot-dashboard-key-expires-and-floods-the-database) | Likely |

---

## C1. Customers see the old price after a price change
**Tag: Must know**

### Scenario
"Our e-commerce product page is cached in Redis. After a merchant changes a price, customers keep seeing the old price for a long time, and sometimes it comes back after it was fixed. What is going on, and how do you fix it?"

### Questions to ask back
- **How stale may a price be on the page?** A few seconds on the page can be fine, but checkout must always read the price from the database.
- **Who writes prices?** If an admin tool, an import job and an API all write, every one of them must invalidate, or I invalidate from the database change stream.
- **Is the page also cached by a CDN or the browser?** Then deleting the Redis key is not enough; I need a short max-age or a CDN purge.
- **Is the cache shared, or in each server's memory?** In-memory copies need an invalidation message to every server.

### Spoken answer
> Cache aside means the app reads the cache first, and on a miss reads the database and stores the result with a TTL. The stale price comes from the write path. On a price change, I update the database first, then delete the cache key. I delete rather than update the cached copy, because concurrent writers can finish in a different order and leave the wrong value. Deleting before the update is also wrong, because a reader can refill the old price in between. Even in the right order, a slow reader can fetch the old row, pause, and write it back after my delete. So every key has a TTL as a safety net. For prices I keep it short, or put a version number in the key that each write bumps. The trade-off is more database reads and an extra cache lookup on every read.

### Say it in 5 beats
1. Read cache, on miss fill with TTL.
2. Write: update database, then delete key.
3. Never update the cached copy directly.
4. Slow reader race: short TTL or versions.
5. Trade-off: more reads, extra lookup.

### Case variations
- **"The price update runs inside a database transaction."**
  > I delete the key after the commit, not inside the transaction. Before the commit, a reader still sees the old row and refills the cache with it.
- **"The cache delete times out."**
  > The database is already updated, so I retry the delete, or queue it in an outbox that a worker retries. The TTL is the last line of defence.
- **"Each server also keeps a small in-memory cache."**
  > Deleting the Redis key does not touch those copies. I publish an invalidation message that every server listens to, and keep the in-memory TTL very short.
- **"A customer was charged the old price."**
  > That is a correctness bug, not a cache bug. Checkout must read the price from the database inside the order transaction. The cache is only for display.

### Follow-up questions
- **Why delete instead of updating the cache?** Two writers can update the database in one order and the cache in the other, and the cache keeps the loser's value. A delete has no value to get wrong; the next read refills from the database.
- **Why not delete first, then update the database?** A reader that runs between the two steps reads the old row and puts it back in the cache, and it stays there until the TTL.
- **If you always delete on write, why keep a TTL?** Deletes get missed: a failed call, a writer that forgets, or the slow reader race. The TTL bounds how long any of those can last.
- **Optional: senior. How do versioned keys close the slow reader race?** Readers look up a version number, then read and fill the key with that version in its name. A write updates the database and increments the version. A slow reader can only fill the old key, which nobody reads any more. If the version key itself is lost, I start from a new random version, never from zero, so old keys are not reused.

### Common wrong answers and red flags
- Writing the new value into the cache on every update.
- Deleting the key before the database update, or inside the open transaction.
- Keys without a TTL, so a single missed delete is stale forever.
- "Just set the TTL to one second." That removes most of the benefit of caching.
- Invalidating with `KEYS product:*` in production. It blocks Redis; delete the keys you know.
- Charging from the cached price.

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

### Scenario
"Our SaaS dashboard caches an expensive stats query for one minute. Every minute, right when the key expires, database CPU spikes and the dashboard slows down for everyone. What is happening, and how do you stop it?"

### Questions to ask back
- **How expensive is the query, and how many requests hit that key?** The product of the two decides whether single-flight is enough or I need a lock.
- **Can users see stats that are a little old?** If yes, I serve the old value while one request refreshes it, and nobody waits.
- **How many app servers are there?** With one, single-flight solves it. With many, each server still runs the query once.
- **Is it one global key or one key per tenant?** Many tenant keys warmed together also need jitter so they do not expire together.

### Spoken answer
> This is a cache stampede. A hot key expires, and every request misses at the same moment, so they all run the expensive query together. Inside each server, I would use single flight. The first miss starts the query, and every other request waits on that same promise. Across servers, each one still runs it once, so for a really expensive query I add a short lock in Redis with a unique token, released only if the token still matches. The others serve the old value or wait briefly. Better still, a background refresh renews the value before it expires, so users rarely see a miss. I also add random jitter to TTLs, so keys warmed together do not expire together. The trade-off is slightly stale data and more moving parts, and the lock needs an expiry so a crashed holder cannot block everyone.

### Say it in 5 beats
1. Hot key expires, everyone misses together.
2. Single flight: one query per server.
3. Across servers: token lock or early refresh.
4. Jitter TTLs so expiries spread out.
5. Trade-off: stale data, more moving parts.

### Case variations
- **"The stats query sometimes fails."**
  > The failure must not be cached. Every waiter gets the error, the in-flight entry is cleared, and the next request tries again. If I still have the old value, I serve it instead of an error.
- **"We run twenty servers."**
  > Single-flight still leaves one query per server. I either take a lock with a token so only one server rebuilds, or have one scheduled job recompute the stats and write the key, so requests never compute it.
- **"We warmed thousands of keys at boot with the same one hour TTL."**
  > That is an avalanche, not a stampede. They all expire in the same second. Adding about ten percent random jitter to each TTL spreads them over several minutes.
- **"Bots request stats for tenant ids that do not exist."**
  > That is cache penetration. Nothing gets cached, so every request reaches the database. I cache the not found result for a short time, and validate ids before querying.

### Follow-up questions
- **Why must single-flight clear its entry on failure?** Otherwise the rejected promise is shared forever, and every later request gets the same old error without trying again.
- **Stampede, avalanche, penetration: what is the difference?** Stampede is one hot key expiring under load; fix it with single-flight, a lock or early refresh. Avalanche is many keys expiring together; fix it with jitter. Penetration is keys that never exist; cache a short not found value.
- **Why does the lock store a random token?** If the holder is slow and its lock expires, another server takes the lock. A plain delete from the first holder would remove the second holder's lock. Releasing only when the stored token still matches, atomically in a Lua script, prevents that.
- **Optional: senior. How does early refresh work without a lock?** Each request near expiry has a small chance to refresh the value early, and that chance grows as expiry approaches. One request usually refreshes first, and the others keep reading the still-valid value. lru-cache's stale-while-refresh mode gives the same effect inside one process.

### Common wrong answers and red flags
- "Make the TTL longer." The stampede still happens, just less often.
- A lock without an expiry, or released with a plain delete. Lesson 100 shows the earlier broken version (value `'1'` plus `DEL`); use a token and a compare-and-delete.
- Lesson 100's `getWithLock` waits and retries by calling itself with no limit. Cap the retries, then serve stale or read the database directly.
- Caching a rejected promise, so one failure is served forever.
- The same TTL on every key warmed at the same time.
- Believing single-flight protects the database across servers. It is per process.

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
