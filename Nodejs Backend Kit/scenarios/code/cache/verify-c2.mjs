// C2: cache stampede on a hot key. 100 concurrent misses run the expensive query 100 times
// without single-flight and once with it. Jittered TTLs spread expiry times.
// An in-process cache stands in for Redis; PostgreSQL runs the real query.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { LRUCache } from 'lru-cache';
import { withPg } from '../lib/pg.mjs';
import { memCache } from './mem-cache.mjs';
import { singleFlight, cached, jitter, acquire, release } from './stampede.mjs';

await withPg(7761, async (pool) => {
  await pool.query('CREATE TABLE orders (id serial PRIMARY KEY, tenant int, amount int)');
  await pool.query('INSERT INTO orders (tenant, amount) SELECT g % 10, g FROM generate_series(1, 50000) g');
  let queries = 0;
  const loadStats = async () => {                    // the expensive dashboard query, slowed down
    queries++;
    const { rows: [r] } = await pool.query('SELECT count(*)::int AS n, sum(amount)::bigint AS total, pg_sleep(0.1) FROM orders');
    return { n: r.n, total: r.total };
  };
  const herd = (fn) => Promise.all(Array.from({ length: 100 }, () => fn()));

  // 1. No guard: every concurrent miss runs the query.
  queries = 0;
  let cache = memCache();
  const plain = await herd(() => cached(cache, 'stats', loadStats, 60_000));
  assert.equal(queries, 100);
  const firstRun = queries;

  // 2. Single-flight: one query, every caller gets the same answer.
  queries = 0; cache = memCache();
  const sf = singleFlight(loadStats);
  const shared = await herd(() => cached(cache, 'stats', sf, 60_000));
  assert.equal(queries, 1);
  assert.ok(shared.every((s) => s.total === plain[0].total && s.n === 50000));

  // 3. It is per process: two servers, each with its own single-flight, still run it twice.
  queries = 0;
  const [s1, s2] = [singleFlight(loadStats), singleFlight(loadStats)];
  await Promise.all([herd(() => s1('stats')), herd(() => s2('stats'))]);
  assert.equal(queries, 2);

  // 4. A failed load is not cached: all waiters get the error, the next call tries again.
  let fail = true, tries = 0;
  const flaky = singleFlight(async () => { tries++; await sleep(20); if (fail) throw new Error('db down'); return 'ok'; });
  const results = await Promise.allSettled(Array.from({ length: 100 }, () => flaky('k')));
  assert.ok(results.every((r) => r.status === 'rejected') && tries === 1);
  fail = false;
  assert.equal(await flaky('k'), 'ok');
  assert.equal(tries, 2);

  // 5. lru-cache's fetch() coalesces concurrent misses the same way.
  queries = 0;
  const lru = new LRUCache({ max: 100, ttl: 60_000, fetchMethod: () => loadStats() });
  await herd(() => lru.fetch('stats'));
  assert.equal(queries, 1);

  // 6. Lock logic (stand-in for SET NX PX plus a Lua compare-and-delete).
  const c = memCache();
  const a = await acquire(c, 'lock:stats', 50);
  assert.ok(a);
  assert.equal(await acquire(c, 'lock:stats', 50), null, 'second server cannot take it');
  await sleep(70);                                   // A's lock expired while A was still working
  const b = await acquire(c, 'lock:stats', 1000);
  assert.ok(b);
  assert.equal(await release(c, 'lock:stats', a), false, 'A must not delete B\'s lock');
  assert.equal(await c.get('lock:stats'), b);
  assert.equal(await release(c, 'lock:stats', b), true);

  // 7. Jitter: 1000 keys warmed at the same moment with a one hour TTL.
  const base = 3_600_000;
  const perSecond = (ttls) => Math.max(...Object.values(Object.groupBy(ttls, (t) => Math.floor(t / 1000))).map((g) => g.length));
  const fixed = Array.from({ length: 1000 }, () => base);
  const spread = Array.from({ length: 1000 }, () => jitter(base));
  assert.equal(perSecond(fixed), 1000, 'without jitter all 1000 expire in the same second');
  assert.ok(spread.every((t) => t >= base * 0.9 && t <= base * 1.1));
  assert.ok(perSecond(spread) <= 15, `with jitter the busiest second has ${perSecond(spread)} keys`);
  assert.ok(Math.max(...spread) - Math.min(...spread) > base * 0.15, 'spread over most of the 12 minute window');

  console.log(`C2 ok: no guard ${firstRun} queries, single-flight 1, two servers 2, lru fetch 1; jitter busiest second ${perSecond(spread)} of 1000`);
});
