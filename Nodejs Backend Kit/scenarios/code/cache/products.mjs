// Cache-aside for a product page. `pause` is a test hook that holds a reader or writer between
// its database step and its cache step, so races can be replayed in a fixed order.
import { randomInt } from 'node:crypto';

const TTL = 60_000;

export async function getProduct(pool, cache, id, { ttlMs = TTL, pause } = {}) {
  const key = `product:${id}`;
  const hit = await cache.get(key);
  if (hit) return hit;                                              // hit
  const { rows: [row] } = await pool.query('SELECT id, price FROM products WHERE id = $1', [id]);
  await pause?.();
  if (row) await cache.set(key, row, ttlMs);                        // miss: fill with a TTL
  return row ?? null;
}

// Correct write path: update the database, then delete the key.
export async function updatePrice(pool, cache, id, price) {
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
  await cache.del(`product:${id}`);
}

// Wrong: no invalidation at all.
export async function updatePriceOnly(pool, id, price) {
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
}

// Wrong: write the new value into the cache instead of deleting it.
export async function updatePriceAndCache(pool, cache, id, price, { pause } = {}) {
  const { rows: [row] } = await pool.query('UPDATE products SET price = $2 WHERE id = $1 RETURNING id, price', [id, price]);
  await pause?.();
  await cache.set(`product:${id}`, row, TTL);
}

// Wrong order: delete first, then update. A reader in between refills the old value.
export async function deleteThenUpdate(pool, cache, id, price, { pause } = {}) {
  await cache.del(`product:${id}`);
  await pause?.();
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
}

// Versioned keys: readers fill product:<id>:v<version>; a write bumps the version, so a slow
// reader can only write into an old key that nobody reads any more. If the version key is lost,
// a new random version starts a fresh namespace instead of reusing an old one.
async function version(cache, id) {
  await cache.setNX(`product:${id}:ver`, randomInt(2 ** 47));    // random start, never reused
  return cache.get(`product:${id}:ver`);
}
export async function getProductV(pool, cache, id, { ttlMs = TTL, pause } = {}) {
  const key = `product:${id}:v${await version(cache, id)}`;
  const hit = await cache.get(key);
  if (hit) return hit;
  const { rows: [row] } = await pool.query('SELECT id, price FROM products WHERE id = $1', [id]);
  await pause?.();
  if (row) await cache.set(key, row, ttlMs);
  return row ?? null;
}
export async function updatePriceV(pool, cache, id, price) {
  await pool.query('UPDATE products SET price = $2 WHERE id = $1', [id, price]);
  await cache.incr(`product:${id}:ver`);
}
