// C1: cache-aside staleness. An in-process cache stands in for Redis; PostgreSQL is the database.
// Races are replayed in a fixed order with gates, so the result is the same on every run.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPg } from '../lib/pg.mjs';
import { memCache } from './mem-cache.mjs';
import * as p from './products.mjs';

function gate() { let open; const opened = new Promise((r) => { open = r; }); let reached; const arrived = new Promise((r) => { reached = r; });
  return { pause: () => { reached(); return opened; }, arrived, open }; }

await withPg(7760, async (pool) => {
  await pool.query('CREATE TABLE products (id int PRIMARY KEY, price int NOT NULL)');
  const reset = () => pool.query('TRUNCATE products; INSERT INTO products VALUES (1, 100)');
  const dbPrice = async () => (await pool.query('SELECT price FROM products WHERE id = 1')).rows[0].price;
  let cache;

  // 1. No invalidation: the page keeps the old price after the update.
  await reset(); cache = memCache();
  assert.equal((await p.getProduct(pool, cache, 1)).price, 100);
  await p.updatePriceOnly(pool, 1, 80);
  assert.equal((await p.getProduct(pool, cache, 1)).price, 100, 'stale');

  // 2. TTL is the safety net: the same stale entry heals once it expires.
  await reset(); cache = memCache();
  await p.getProduct(pool, cache, 1, { ttlMs: 50 });
  await p.updatePriceOnly(pool, 1, 80);
  assert.equal((await p.getProduct(pool, cache, 1, { ttlMs: 50 })).price, 100);
  await sleep(80);
  assert.equal((await p.getProduct(pool, cache, 1, { ttlMs: 50 })).price, 80, 'healed after TTL');

  // 3. Update the database, then delete the key: the next read is fresh.
  await reset(); cache = memCache();
  await p.getProduct(pool, cache, 1);
  await p.updatePrice(pool, cache, 1, 80);
  assert.equal((await p.getProduct(pool, cache, 1)).price, 80);

  // 4. Updating the cache instead of deleting: two writers finish in the opposite order.
  await reset(); cache = memCache();
  const gA = gate();
  const writerA = p.updatePriceAndCache(pool, cache, 1, 70, { pause: gA.pause });   // DB = 70, then paused
  await gA.arrived;
  await p.updatePriceAndCache(pool, cache, 1, 60);                                  // DB = 60, cache = 60
  gA.open(); await writerA;                                                         // cache = 70
  assert.equal(await dbPrice(), 60);
  assert.equal((await p.getProduct(pool, cache, 1)).price, 70, 'cache disagrees with the database');

  // 5. Delete before update: a reader between the two steps refills the old price.
  await reset(); cache = memCache();
  const gW = gate();
  const w = p.deleteThenUpdate(pool, cache, 1, 80, { pause: gW.pause });
  await gW.arrived;
  await p.getProduct(pool, cache, 1);                                               // refills 100
  gW.open(); await w;
  assert.equal((await p.getProduct(pool, cache, 1)).price, 100, 'stale after delete-then-update');

  // 6. The remaining race with update-then-delete: a slow reader writes the old value back.
  await reset(); cache = memCache();
  const gR = gate();
  const slowReader = p.getProduct(pool, cache, 1, { pause: gR.pause });             // read 100 from DB, paused
  await gR.arrived;
  await p.updatePrice(pool, cache, 1, 80);                                          // DB = 80, key deleted
  gR.open(); await slowReader;                                                      // writes 100 back
  assert.equal(await dbPrice(), 80);
  assert.equal((await p.getProduct(pool, cache, 1)).price, 100, 'stale until the TTL');

  // 7. Same race with versioned keys: the slow reader fills an old key nobody reads.
  await reset(); cache = memCache();
  assert.equal((await p.getProductV(pool, cache, 1)).price, 100);
  await p.updatePriceV(pool, cache, 1, 90);                                          // a write before the race
  const gV = gate();
  const slowV = p.getProductV(pool, cache, 1, { pause: gV.pause });                 // reads 90, paused
  await gV.arrived;
  await p.updatePriceV(pool, cache, 1, 80);
  gV.open(); await slowV;
  assert.equal((await p.getProductV(pool, cache, 1)).price, 80, 'fresh despite the slow reader');
  await cache.del('product:1:ver');                                                  // version key lost
  await p.updatePriceOnly(pool, 1, 75);
  assert.equal((await p.getProductV(pool, cache, 1)).price, 75, 'a lost version key starts a fresh namespace');

  console.log('C1 ok: no invalidation stale; TTL heals; update then delete fresh; update-cache and delete-first races stale; slow reader stale; versioned keys fresh');
});
