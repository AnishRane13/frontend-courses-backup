// Stampede guards for one hot key: single-flight per process, jittered TTLs, and a lock with a
// token that is released by compare-and-delete. The lock here runs on the in-process stand-in;
// in production the same two steps are Redis SET NX PX and a Lua compare-and-delete.
import { randomUUID } from 'node:crypto';

export function singleFlight(load) {
  const inFlight = new Map();                       // key -> promise of the running load
  return (key) => {
    if (inFlight.has(key)) return inFlight.get(key); // join the load already running
    const p = load(key).finally(() => inFlight.delete(key)); // cleared on success and on failure
    inFlight.set(key, p);
    return p;
  };
}

export const jitter = (baseMs, spread = 0.1) => Math.round(baseMs * (1 - spread + Math.random() * 2 * spread));

export async function cached(cache, key, load, ttlMs) {
  const hit = await cache.get(key);
  if (hit) return hit;
  const value = await load(key);
  await cache.set(key, value, jitter(ttlMs));
  return value;
}

// Lock stand-in: acquire only if absent, with an expiry; release only if the token is still ours.
export async function acquire(cache, lockKey, ms) {
  const token = randomUUID();
  return (await cache.setNX(lockKey, token, ms)) ? token : null;
}
export async function release(cache, lockKey, token) {
  if ((await cache.get(lockKey)) !== token) return false;   // in Redis: one Lua script, atomic
  await cache.del(lockKey);
  return true;
}
