// A product API with an in-memory cache. Run as a child by verify-pd1.mjs.
// CACHE=unbounded uses a plain Map (the leak). CACHE=lru uses lru-cache with a size cap.
// Run with --expose-gc so /stats can report heap used after a full collection.
import http from 'node:http';
import { LRUCache } from 'lru-cache';

const cache = process.env.CACHE === 'lru' ? new LRUCache({ max: 500 }) : new Map();

function renderProduct(id) {                     // the hot function a CPU profile should name
  let h = 0;
  for (let i = 0; i < 200_000; i++) h = (h * 31 + id.charCodeAt(i % id.length) + i) | 0;
  const prices = new Array(2000);                // about 16 KB of heap per cached product
  for (let i = 0; i < prices.length; i++) prices[i] = (h + i) & 0xffff;
  return { id, hash: h, prices };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/stats') {
    globalThis.gc?.();
    return res.end(JSON.stringify({ heapUsed: process.memoryUsage().heapUsed, size: cache.size }));
  }
  const id = url.searchParams.get('id') ?? 'none';
  let product = cache.get(id);
  if (!product) { product = renderProduct(id); cache.set(id, product); }
  res.end(JSON.stringify({ id, hash: product.hash }));
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));   // a normal exit, so --cpu-prof writes its file
server.listen(0, '127.0.0.1', () => process.stdout.write(`port ${server.address().port}\n`));
