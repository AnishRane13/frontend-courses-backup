// PD2: the keep-alive race behind a load balancer. Checks, with raw TCP sockets:
// 1. defaults on this Node: keep alive timeout 5000 ms, plus a 1000 ms socket buffer (keepAliveTimeoutBuffer);
// 2. an idle keep-alive socket is closed by the server after keepAliveTimeout (plus the buffer, if any);
// 3. a request sent on that connection before the close gets 200, one sent just after gets no response
//    (what an HTTP client or a balancer reports as socket hang up / 502);
// 4. raising keepAliveTimeout keeps the socket open, and reusable, well past the old limit.
// The exact same-millisecond race and the balancer's own idle timeout are not reproduced here.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REQ = 'GET / HTTP/1.1\r\nHost: x\r\n\r\n';

async function serverWith(keepAliveTimeout, buffer) {
  const server = http.createServer((req, res) => res.end('ok'));
  server.keepAliveTimeout = keepAliveTimeout;
  if (buffer !== undefined) server.keepAliveTimeoutBuffer = buffer;
  server.headersTimeout = keepAliveTimeout + 1000;   // the rule: headers timeout above keep alive timeout
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

// Opens a socket, sends one request, then (optionally) sends a second one after `reuseAfter` ms.
// allowHalfOpen lets us write even after the server's FIN, like a balancer that has not noticed yet.
async function probe(port, reuseAfter) {
  const s = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
  const closed = new Promise((r) => s.on('close', () => r(Date.now())));
  const serverEnded = new Promise((r) => s.on('end', () => r(Date.now())));   // the server's FIN
  let err = null; s.on('error', (e) => { err = e.code; });
  await once(s, 'connect');
  s.write(REQ);
  const [first] = await once(s, 'data');
  const t0 = Date.now();
  let second = '';
  if (reuseAfter !== undefined) {
    await sleep(reuseAfter);
    s.on('data', (d) => { second += d; });
    if (!s.destroyed) s.write(REQ, () => {});
    const guard = setTimeout(() => s.destroy(), 3000);
    await closed; clearTimeout(guard);
  }
  const closedAfter = (await Promise.race([serverEnded, sleep(10_000).then(() => NaN)])) - t0;
  s.destroy();
  return { first: String(first), closedAfter, secondOk: second.includes('200 OK'), err };
}

// 1. Defaults.
const plain = http.createServer();
assert.equal(plain.keepAliveTimeout, 5000, 'default keep alive timeout is 5 s');
assert.equal(plain.keepAliveTimeoutBuffer, 1000, 'Node 24.19 adds a 1 s buffer before the socket really closes');

// 2. Close timing, no buffer and default buffer.
{
  const server = await serverWith(1000, 0);
  const { closedAfter, first } = await probe(server.address().port);
  assert.match(first, /Keep-Alive: timeout=1/, 'the server advertises its timeout in seconds');
  assert.ok(closedAfter >= 900 && closedAfter < 2500, `idle socket closed after ~1000 ms (got ${closedAfter})`);
  console.log(`keepAliveTimeout 1000, buffer 0: idle socket closed after ${closedAfter} ms`);
  server.close();
}
{
  const server = await serverWith(1000);
  const { closedAfter } = await probe(server.address().port);
  assert.ok(closedAfter >= 1900 && closedAfter < 3500, `with the default buffer, closed after ~2000 ms (got ${closedAfter})`);
  console.log(`keepAliveTimeout 1000, default buffer: idle socket closed after ${closedAfter} ms`);
  server.close();
}

// 3. Reuse before and after the server closes the idle socket.
{
  const server = await serverWith(1000, 0);
  const port = server.address().port;
  const early = await probe(port, 400);
  assert.ok(early.secondOk, 'a request reusing the socket before the timeout gets 200');
  const late = await probe(port, 1400);
  assert.equal(late.secondOk, false, 'a request reusing the socket after the server closed it gets no response');
  console.log(`reuse at 400 ms: 200; reuse at 1400 ms: no response (${late.err ?? 'connection ended'})`);
  server.close();
}

// 4. A longer keep alive timeout keeps the socket usable past the old limit.
{
  const server = await serverWith(5000, 0);
  const r = await probe(server.address().port, 2500);
  assert.ok(r.secondOk, 'with keepAliveTimeout 5000 the socket is still reusable at 2500 ms');
  server.close();
  console.log('keepAliveTimeout 5000: reuse at 2500 ms still gets 200');
}
console.log('verify-pd2: all claims hold');
