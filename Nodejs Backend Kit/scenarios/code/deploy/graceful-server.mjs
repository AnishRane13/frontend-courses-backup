// A small API with a graceful shutdown. Run as a child process by verify-dp1.mjs.
// Env: DRAIN_DELAY_MS (readiness fails before close), FORCE_EXIT_MS (hard timeout).
import http from 'node:http';

const DRAIN_DELAY_MS = Number(process.env.DRAIN_DELAY_MS ?? 1000);
const FORCE_EXIT_MS = Number(process.env.FORCE_EXIT_MS ?? 10_000);
const pool = { open: true, async end() { this.open = false; } };   // stands in for a pg Pool
let ready = true;
let shuttingDown = false;

const server = http.createServer((req, res) => {
  if (req.url === '/ready') return res.writeHead(ready ? 200 : 503).end(ready ? 'ok' : 'draining');
  if (req.url === '/checkout') return setTimeout(() => res.end('order placed'), 1500);   // slow, in flight
  if (req.url === '/hang') return;                                                      // never answers
  res.end('hello');
});
server.keepAliveTimeout = 60_000;          // long, so only server.close() can close idle sockets in this test

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;                                                   // 1. readiness fails, the balancer stops sending
  setTimeout(() => process.exit(1), FORCE_EXIT_MS).unref();        // 5. hard timeout if something hangs
  setTimeout(() => {
    server.close(async () => {                                     // 2. no new connections, 3. in-flight finish
      await pool.end();                                            // 4. close the database pool
      process.stdout.write('closed cleanly\n');
      process.exit(0);
    });
  }, DRAIN_DELAY_MS);
});

server.listen(0, '127.0.0.1', () => process.stdout.write(`port ${server.address().port}\n`));
