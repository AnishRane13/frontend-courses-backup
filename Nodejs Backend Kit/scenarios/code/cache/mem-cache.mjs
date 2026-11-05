// An in-process stand-in for Redis: async get, set with a TTL in ms, set-if-absent, del.
// Same shape as the Redis calls, so the cache-aside logic can be tested without a Redis server.
export function memCache() {
  const m = new Map();                                    // key -> { value, expiresAt }
  const live = (k) => { const e = m.get(k); if (e && e.expiresAt <= Date.now()) { m.delete(k); return undefined; } return e; };
  return {
    async get(k) { return live(k)?.value ?? null; },
    async set(k, value, ttlMs = Infinity) { m.set(k, { value: structuredClone(value), expiresAt: Date.now() + ttlMs }); },
    async setNX(k, value, ttlMs = Infinity) { if (live(k)) return false; await this.set(k, value, ttlMs); return true; },
    async del(k) { m.delete(k); },
    async incr(k) { const v = (live(k)?.value ?? 0) + 1; m.set(k, { value: v, expiresAt: Infinity }); return v; },
    expiresAt: (k) => m.get(k)?.expiresAt,
    size: () => m.size,
  };
}
