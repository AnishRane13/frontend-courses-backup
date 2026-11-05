import request from 'supertest';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPg } from '../lib/pg.mjs';
import { paymentsApp } from './idempotent-payments.mjs';

await withPg(7610, async (pool) => {
  await pool.query(`CREATE TABLE idempotency_keys (key text PRIMARY KEY, request_hash text NOT NULL,
    status text NOT NULL DEFAULT 'in_progress', response_code int, response_body jsonb, created_at timestamptz NOT NULL DEFAULT now())`);
  let charges = 0, next = null;                       // next: 'decline' or 'timeout' makes the following charge fail
  const gateway = { charge: async () => {
    await sleep(200);
    const mode = next; next = null;
    if (mode === 'decline') throw Object.assign(new Error('card declined'), { declined: true });
    if (mode === 'timeout') { charges++; throw new Error('gateway timeout'); }   // charged, but we never hear back
    return { id: 'ch_' + ++charges };
  } };
  const app = paymentsApp(pool, gateway);
  const pay = (key, amount = 500) => { const r = request(app).post('/payments').send({ amount }); return key ? r.set('Idempotency-Key', key) : r; };
  const status = async (key) => (await pool.query('SELECT status FROM idempotency_keys WHERE key = $1', [key])).rows[0]?.status ?? 'none';
  const show = (label, r) => console.log(label.padEnd(44), r.status, JSON.stringify(r.body), r.headers['retry-after'] ? 'Retry-After: ' + r.headers['retry-after'] : '');

  show('1. first call, key A', await pay('A'));
  show('2. retry after a timeout, key A', await pay('A'));
  const [x, y] = await Promise.all([pay('B'), pay('B')]);
  show('3. two at once, key B (first)', x); show('3. two at once, key B (second)', y);
  show('4. key A again, different amount', await pay('A', 999));
  next = 'decline'; show('5. key C, card declined', await pay('C'));
  console.log('   key C status after decline:', await status('C'));
  show('6. key C retried', await pay('C'));
  next = 'timeout'; show('7. key D, gateway timeout', await pay('D'));
  console.log('   key D status after timeout:', await status('D'));
  show('8. key D retried', await pay('D'));
  show('9. no key', await pay(null));
  console.log('charges made:', charges, '(A, B, C, and D once at the provider)');
});
