// DP1: graceful shutdown. Checks, with a real child process and a real terminate signal:
// readiness answers 503 during the drain, an in-flight slow request still completes,
// new connections are refused after close, an idle keep-alive socket is closed by server.close()
// (Node 19 and later) without waiting for the keep-alive timeout, the process exits 0 within the timeout,
// and a hanging request triggers the forced exit (code 1).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';

const serverFile = join(import.meta.dirname, 'graceful-server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function start(env) {
  const child = spawn(process.execPath, [serverFile], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const port = new Promise((resolve) => child.stdout.on('data', () => { const m = out.match(/port (\d+)/); if (m) resolve(Number(m[1])); }));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, at: Date.now() })));
  return { child, port, exited, output: () => out };
}

function get(port, path, agent = false) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

// Raw keep-alive socket: send one request, read the response, then stay idle.
async function idleKeepAliveSocket(port) {
  const sock = net.connect(port, '127.0.0.1');
  await once(sock, 'connect');
  sock.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
  await once(sock, 'data');
  const closed = new Promise((resolve) => sock.on('close', () => resolve(Date.now())));
  sock.on('error', () => {});
  return { sock, closed };
}

// Part 1: clean drain.
{
  const { child, port: p, exited, output } = start({ DRAIN_DELAY_MS: '800', FORCE_EXIT_MS: '8000' });
  const port = await p;
  assert.equal((await get(port, '/ready')).status, 200, 'ready before shutdown');
  const idle = await idleKeepAliveSocket(port);

  const checkout = get(port, '/checkout');               // in flight when the signal arrives
  await sleep(200);
  const sigAt = Date.now();
  child.kill('SIGTERM');
  await sleep(200);

  const r = await get(port, '/ready');                   // still accepting, but readiness fails
  assert.equal(r.status, 503, 'readiness returns 503 during the drain');

  await sleep(1000);                                     // past DRAIN_DELAY_MS: server.close() has run
  await assert.rejects(get(port, '/'), (e) => e.code === 'ECONNREFUSED', 'new connections are refused after close');

  const done = await checkout;
  assert.equal(done.status, 200, 'in-flight request completed');
  assert.equal(done.body, 'order placed');

  const idleClosedAt = await idle.closed;
  assert.ok(idleClosedAt - sigAt < 5000, 'idle keep-alive socket closed by server.close(), long before the 60 s keep-alive timeout');

  const ex = await exited;
  assert.equal(ex.code, 0, 'exit code 0 after a clean drain');
  assert.ok(ex.at - sigAt < 8000, 'exited before the forced-exit timer');
  assert.match(output(), /closed cleanly/);
  console.log(`clean drain: exit ${ex.code} after ${ex.at - sigAt} ms, idle socket closed after ${idleClosedAt - sigAt} ms`);
}

// Part 2: a hanging request forces the hard timeout.
{
  const { child, port: p, exited, output } = start({ DRAIN_DELAY_MS: '100', FORCE_EXIT_MS: '1500' });
  const port = await p;
  const hang = get(port, '/hang').catch((e) => e);       // never answered
  await sleep(200);
  const sigAt = Date.now();
  child.kill('SIGTERM');
  const ex = await exited;
  assert.equal(ex.code, 1, 'forced exit code 1 when a request hangs');
  assert.ok(ex.at - sigAt >= 1400, 'forced exit waited for the timer');
  assert.ok(ex.at - sigAt < 6000, 'forced exit happened within a bound');
  assert.doesNotMatch(output(), /closed cleanly/);
  const err = await hang;
  assert.equal(err.code, 'ECONNRESET', 'the hung request was cut off');
  console.log(`hung request: forced exit ${ex.code} after ${ex.at - sigAt} ms`);
}
console.log('verify-dp1: all claims hold');
