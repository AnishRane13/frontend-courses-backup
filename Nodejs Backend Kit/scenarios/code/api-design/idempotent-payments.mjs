// POST /payments with an Idempotency-Key. The key row is claimed BEFORE the charge.
// gateway.charge throws an error with declined = true on a clear decline; anything else is an unknown outcome.
import express from 'express';
import { createHash } from 'node:crypto';

export function paymentsApp(pool, gateway) {
  const app = express();
  app.use(express.json());
  app.post('/payments', async (req, res) => {
    const key = req.get('Idempotency-Key');
    if (!key) return res.status(400).json({ error: 'Idempotency-Key required' });
    const hash = createHash('sha256').update(JSON.stringify(req.body)).digest('hex');
    const claimed = await pool.query(
      `INSERT INTO idempotency_keys (key, request_hash) VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING RETURNING key`, [key, hash]);
    if (claimed.rowCount === 0) {                                            // seen this key before
      const { rows: [prev] } = await pool.query('SELECT * FROM idempotency_keys WHERE key = $1', [key]);
      if (prev.request_hash !== hash) return res.status(422).json({ error: 'Key reused with a different body' });
      if (prev.status !== 'done') return res.status(409).set('Retry-After', '1').end(); // in progress or unknown
      return res.status(prev.response_code).json(prev.response_body);        // replay, no second charge
    }
    try {
      const charge = await gateway.charge(req.body.amount);
      const body = { paymentId: charge.id, amount: req.body.amount };
      await pool.query(`UPDATE idempotency_keys SET status = 'done', response_code = 201, response_body = $2 WHERE key = $1`, [key, body]);
      return res.status(201).json(body);
    } catch (err) {
      if (err.declined) {                                          // nothing was charged: allow a retry
        await pool.query('DELETE FROM idempotency_keys WHERE key = $1', [key]);
        return res.status(402).json({ error: 'Card declined' });
      }
      await pool.query(`UPDATE idempotency_keys SET status = 'unknown' WHERE key = $1`, [key]); // reconcile later
      return res.status(502).json({ error: 'Payment outcome unknown' });
    }
  });
  return app;
}
