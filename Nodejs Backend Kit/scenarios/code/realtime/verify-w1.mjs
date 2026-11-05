// W1: two chat servers. Without a shared bus, a client on server A never sees a message sent on
// server B. With PostgreSQL LISTEN/NOTIFY as the bus (standing in for Redis pub/sub) it does,
// exactly once, and only members of that room receive it.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';
import { withPg } from '../lib/pg.mjs';
import { startChatServer } from './chat-server.mjs';

async function client(port, room) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got = [];
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  const joined = new Promise((r) => ws.on('message', (d) => { const m = JSON.parse(d); if (m.joined) r(); else got.push(m.text); }));
  ws.send(JSON.stringify({ type: 'join', room }));
  await joined;
  return { ws, got, say: (text) => ws.send(JSON.stringify({ type: 'say', room, from: 'x', text })) };
}

async function scenario(pool, bus) {
  const A = await startChatServer({ pool, bus });
  const B = await startChatServer({ pool, bus });
  const alice = await client(A.port, 'r1');      // on server A
  const bob = await client(B.port, 'r1');        // on server B, same room
  const carol = await client(B.port, 'r2');      // on server B, other room
  bob.say('hello from B');
  await sleep(300);
  const result = { alice: [...alice.got], bob: [...bob.got], carol: [...carol.got], aListens: bus ? await A.listening() : null };
  for (const c of [alice, bob, carol]) c.ws.close();
  await sleep(100);
  result.aListensAfter = bus ? await A.listening() : null;
  await A.close(); await B.close();
  return result;
}

await withPg(7762, async (pool) => {
  const noBus = await scenario(pool, false);
  assert.deepEqual(noBus.alice, [], 'without a bus, the client on server A gets nothing');
  assert.deepEqual(noBus.bob, ['hello from B'], 'without a bus, only server B\'s own room members get it');
  assert.deepEqual(noBus.carol, []);

  const withBus = await scenario(pool, true);
  assert.deepEqual(withBus.alice, ['hello from B'], 'with the bus, server A delivers it exactly once');
  assert.deepEqual(withBus.bob, ['hello from B'], 'sender sees it once, not twice');
  assert.deepEqual(withBus.carol, [], 'another room never receives it');
  assert.deepEqual(withBus.aListens, ['room_r1'], 'server A listens only on rooms with local members');
  assert.deepEqual(withBus.aListensAfter, [], 'and stops when the last local member leaves');

  // NOTIFY payloads are capped (8000 bytes by default): send ids on the bus, not big documents.
  await assert.rejects(pool.query('SELECT pg_notify($1, $2)', ['room_r1', 'x'.repeat(8000)]), /payload string too long/);
  await pool.query('SELECT pg_notify($1, $2)', ['room_r1', 'x'.repeat(7999)]);
  console.log('W1 ok: no bus -> lost across servers; bus -> delivered once per member, per room only');
});
