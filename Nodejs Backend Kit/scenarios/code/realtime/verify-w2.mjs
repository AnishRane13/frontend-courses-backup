// W2: a reconnecting client resumes from its last id and gets exactly the events it missed;
// a wrong Origin or a missing session is refused before the handshake; a peer that stops
// answering pings is terminated by the heartbeat; backoff delays stay within their cap.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { startFeedServer } from './feed-server.mjs';
import { connectFeed, backoff } from './feed-client.mjs';

const ORIGIN = 'https://app.example.com';
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timeout'); await sleep(10); } };
const handshake = (port, headers, opts = {}) => new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers, ...opts });
  ws.on('open', () => resolve({ status: 101, ws }));
  ws.on('unexpected-response', (_req, res) => { resolve({ status: res.statusCode }); ws.terminate(); });
  ws.on('error', () => {});
});

const srv = await startFeedServer({ allowedOrigins: new Set([ORIGIN]), sessions: new Map([['s1', { id: 'u1' }]]), keep: 5, pingMs: 100 });
const url = `ws://127.0.0.1:${srv.port}`;
const good = { origin: ORIGIN, cookie: 'sid=s1' };
try {
  // 1. Origin and session are checked on the upgrade.
  assert.equal((await handshake(srv.port, { origin: 'https://evil.example', cookie: 'sid=s1' })).status, 403);
  assert.equal((await handshake(srv.port, { origin: ORIGIN })).status, 401);
  assert.equal((await handshake(srv.port, { origin: ORIGIN, cookie: 'sid=wrong' })).status, 401);
  const ok = await handshake(srv.port, good);
  assert.equal(ok.status, 101); ok.ws.close();

  // 2. Resume: receive 1..3, drop, miss 4..6, reconnect, then live 7. No gaps, no duplicates.
  const seen = [];
  const feed = connectFeed({ url, headers: good, room: 'orders_t1', onEvent: (e) => seen.push(e.id), base: 100 });
  await until(() => srv.clients() === 1); await sleep(50);
  for (let i = 1; i <= 3; i++) srv.publish('orders_t1', { status: 'step ' + i });
  await until(() => seen.length === 3);
  srv.dropAll();
  for (let i = 4; i <= 6; i++) srv.publish('orders_t1', { status: 'step ' + i });   // while it is away
  await until(() => feed.stats.connects === 2 && seen.length === 6);
  srv.publish('orders_t1', { status: 'step 7' });
  await until(() => seen.length === 7);
  assert.deepEqual(seen, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(feed.stats.raw, [1, 2, 3, 4, 5, 6, 7], 'the server itself sent no duplicates');
  feed.close();

  // 3. A client too far behind (older than the kept window of 5) is told to resync over HTTP.
  for (let i = 8; i <= 20; i++) srv.publish('orders_t1', { status: 'step ' + i });
  let resynced = false;
  const late = connectFeed({ url, headers: good, room: 'orders_t1', onEvent: () => {}, onResync: () => { resynced = true; } });
  await until(() => late.stats.connects === 1);
  late.close();
  const stale = new WebSocket(url, { headers: good });
  await new Promise((r) => stale.on('open', r));
  const reply = new Promise((r) => stale.once('message', (d) => r(JSON.parse(d))));
  stale.send(JSON.stringify({ type: 'subscribe', room: 'orders_t1', lastId: 7 }));
  assert.deepEqual(await reply, { type: 'resync' });
  stale.close();
  assert.equal(resynced, false, 'a brand new client (no last id) is not asked to resync');

  // 4. Heartbeat: a peer that never answers pings is terminated; a healthy one stays.
  await sleep(100);
  const before = srv.events.terminated;
  const dead = await handshake(srv.port, good, { autoPong: false });
  const alive = await handshake(srv.port, good);
  let deadClosed = false; dead.ws.on('close', () => { deadClosed = true; });
  await sleep(450);
  assert.equal(deadClosed, true, 'silent peer was terminated');
  assert.equal(srv.events.terminated - before, 1, 'only the silent peer');
  assert.equal(alive.ws.readyState, WebSocket.OPEN, 'healthy peer still open');
  alive.ws.close();

  // 5. Full-jitter backoff: random, never above min(cap, base * 2^attempt).
  for (let a = 0; a <= 12; a++) {
    const ds = Array.from({ length: 1000 }, () => backoff(a));
    const ceiling = Math.min(5000, 200 * 2 ** a);
    assert.ok(ds.every((d) => d >= 0 && d <= ceiling));
    assert.ok(new Set(ds.map(Math.round)).size > 50, 'delays are spread, not identical');
  }
  console.log('W2 ok: origin 403, no session 401, resume 1..7 with no gap or duplicate, resync when too old, dead peer terminated');
} finally {
  await srv.close();
}
