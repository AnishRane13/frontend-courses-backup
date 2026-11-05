// Runs fn over items with at most `limit` calls in flight. Results keep input order.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++; // claim an index; safe because JavaScript runs on one thread
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Never rejects: each item becomes { ok: true, value } or { ok: false, error }, so one failure cannot stop the batch.
export const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
