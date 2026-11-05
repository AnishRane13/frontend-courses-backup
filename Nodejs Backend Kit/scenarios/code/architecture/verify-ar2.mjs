// AR2: keeping two services consistent without a shared transaction.
// Dual write loses an event on a crash; the transactional outbox does not. The relay publishes after
// commit without holding a transaction open, delivery is at least once, and the consumer is idempotent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPg } from '../lib/pg.mjs';

const PORT = 7782;
const writer = (mode, customer) => spawnSync(process.execPath, [join(import.meta.dirname, 'ar2-writer.mjs'), String(PORT), mode, customer]).status;

let passed = false;
await withPg(PORT, async (pool) => {
  await pool.query(`
    CREATE TABLE orders (id serial PRIMARY KEY, customer text NOT NULL, sku text NOT NULL, qty int NOT NULL);
    CREATE TABLE outbox (id bigserial PRIMARY KEY, event_type text NOT NULL, payload jsonb NOT NULL,
      claimed_by text, claimed_until timestamptz NOT NULL DEFAULT '-infinity', sent_at timestamptz);
    CREATE TABLE broker_messages (seq serial PRIMARY KEY, event_id text NOT NULL, payload jsonb NOT NULL);
    -- inventory service side (its own database in real life)
    CREATE TABLE stock (sku text PRIMARY KEY, qty int NOT NULL);
    CREATE TABLE processed_messages (message_id text PRIMARY KEY);
    INSERT INTO stock VALUES ('sku-1', 100);`);
  const n = async (sql, p = []) => Number((await pool.query(sql, p)).rows[0].n);
  const brokerCount = (orderId) => n(`SELECT count(*) AS n FROM broker_messages WHERE (payload->>'orderId')::int = $1`, [orderId]);
  const orderId = async (customer) => (await pool.query('SELECT id FROM orders WHERE customer = $1', [customer])).rows[0]?.id;

  // Publishing also records how many sessions sit idle inside an open transaction at that moment.
  const idleInTx = [];
  async function publish(row) {
    idleInTx.push(await n(`SELECT count(*) AS n FROM pg_stat_activity WHERE state = 'idle in transaction'`));
    await pool.query('INSERT INTO broker_messages (event_id, payload) VALUES ($1, $2)', [String(row.id), row.payload]);
  }

  // Correct relay: a short claim (commits at once), publish with no transaction open, then mark sent.
  async function relayOnce(name, { leaseMs = 5000, batch = 10, crashBeforeMark = false } = {}) {
    const { rows } = await pool.query(`
      UPDATE outbox SET claimed_by = $1, claimed_until = clock_timestamp() + make_interval(secs => $2 / 1000.0)
      WHERE id IN (SELECT id FROM outbox WHERE sent_at IS NULL AND claimed_until < clock_timestamp()
                   ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED)
      RETURNING id, payload`, [name, leaseMs, batch]);
    for (const row of rows) {
      await publish(row);
      if (crashBeforeMark) continue;                   // simulate dying after publish, before the mark
      await pool.query('UPDATE outbox SET sent_at = now() WHERE id = $1 AND claimed_by = $2', [row.id, name]);
    }
    return rows.length;
  }

  // Lesson 114's shape: holds the row locks and a transaction open while it publishes.
  async function relayHoldingTx() {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query('SELECT id, payload FROM outbox WHERE sent_at IS NULL ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED');
      for (const row of rows) { await publish(row); await c.query('UPDATE outbox SET sent_at = now() WHERE id = $1', [row.id]); }
      await c.query('COMMIT');
      return rows.length;
    } finally { c.release(); }
  }

  // Idempotent consumer on the inventory side.
  async function consumeAll() {
    let applied = 0;
    for (const m of (await pool.query('SELECT event_id, payload FROM broker_messages ORDER BY seq')).rows) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const fresh = await c.query('INSERT INTO processed_messages VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1', [m.event_id]);
        if (fresh.rowCount) { await c.query('UPDATE stock SET qty = qty - $2 WHERE sku = $1', [m.payload.sku, m.payload.qty]); applied++; }
        await c.query('COMMIT');
      } finally { c.release(); }
    }
    return applied;
  }

  // 1. Naive dual write: the process dies between commit and publish. The order exists, the event is lost forever.
  assert.equal(writer('naive-crash', 'naive'), 3);
  const naiveId = await orderId('naive');
  assert.ok(naiveId);
  assert.equal(await brokerCount(naiveId), 0);

  // 2. Outbox, crash before commit: neither the order nor the event exists.
  assert.equal(writer('outbox-crash-before-commit', 'early'), 3);
  assert.equal(await orderId('early'), undefined);
  assert.equal(await n('SELECT count(*) AS n FROM outbox'), 0);

  // 3. Outbox, crash after commit: the event waits in the outbox, and the relay publishes it later.
  assert.equal(writer('outbox-crash-after-commit', 'late'), 3);
  const lateId = await orderId('late');
  assert.equal(await brokerCount(lateId), 0);
  assert.equal(await relayOnce('r1'), 1);
  assert.equal(await brokerCount(lateId), 1);
  assert.equal(await relayOnce('r1'), 0);                              // nothing left unsent
  await sleep(1500);                                                   // nothing is published again later
  assert.equal(await relayOnce('r1'), 0);
  assert.deepEqual(idleInTx, [0]);                                     // no transaction open while publishing
  assert.equal(await brokerCount(naiveId), 0);                         // the dual-write event is still lost

  // 4. Lesson 114's relay shape holds a transaction open during the publish.
  await pool.query(`INSERT INTO outbox (event_type, payload) VALUES ('order.placed', '{"orderId": 900, "sku": "sku-1", "qty": 1}')`);
  idleInTx.length = 0;
  assert.equal(await relayHoldingTx(), 1);
  assert.equal(idleInTx[0], 1);

  // 5. Relay dies after publishing, before marking sent: the row is published again once its lease expires.
  await pool.query(`INSERT INTO outbox (event_type, payload) VALUES ('order.placed', '{"orderId": 901, "sku": "sku-1", "qty": 1}')`);
  assert.equal(await relayOnce('r-crash', { leaseMs: 300, crashBeforeMark: true }), 1);
  assert.equal(await relayOnce('r2'), 0);                              // lease still held
  await sleep(450);
  assert.equal(await relayOnce('r2'), 1);
  assert.equal(await brokerCount(901), 2);                             // at least once: a duplicate

  // 6. Two relays at the same time publish each of 20 rows exactly once.
  for (let i = 0; i < 20; i++) await pool.query(`INSERT INTO outbox (event_type, payload) VALUES ('order.placed', $1)`, [{ orderId: 1000 + i, sku: 'sku-1', qty: 1 }]);
  const loop = async (name) => { let total = 0, k; while ((k = await relayOnce(name, { batch: 3 }))) total += k; return total; };
  const [a, b] = await Promise.all([loop('ra'), loop('rb')]);
  assert.equal(a + b, 20);
  assert.equal(await n(`SELECT count(*) AS n FROM broker_messages WHERE (payload->>'orderId')::int >= 1000`), 20);
  assert.equal(await n(`SELECT count(DISTINCT event_id) AS n FROM broker_messages WHERE (payload->>'orderId')::int >= 1000`), 20);

  // 7. The consumer sees 24 messages (one duplicate) and applies 23 distinct events once each.
  assert.equal(await n('SELECT count(*) AS n FROM broker_messages'), 24);
  assert.equal(await consumeAll(), 23);
  assert.equal(await n(`SELECT qty AS n FROM stock WHERE sku = 'sku-1'`), 77);
  assert.equal(await consumeAll(), 0);                                 // full redelivery changes nothing
  assert.equal(await n(`SELECT qty AS n FROM stock WHERE sku = 'sku-1'`), 77);

  passed = true;
  console.log('verify-ar2: all assertions passed');
});
if (!passed) process.exit(1);
