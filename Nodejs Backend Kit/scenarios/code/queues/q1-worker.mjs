// One app instance firing the daily billing summary for one schedule slot.
// Usage: node q1-worker.mjs <port> <mode> <slot> [startAtMs]
// Modes: naive (no guard), lock-only (advisory lock, no run key), guarded (lock + run key),
//        crash (guarded, but the process dies before COMMIT).
// Prints one JSON line: { pid, outcome } where outcome is ran | locked | already-run.
import pg from 'pg';

const [port, mode, slot, startAt] = process.argv.slice(2);
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(port), user: 'postgres', password: 'pw', database: 'postgres' });
pool.on('error', () => {});
const CUSTOMERS = [1, 2, 3];

if (startAt) await new Promise((r) => setTimeout(r, Math.max(0, Number(startAt) - Date.now())));   // fire together

async function runSlot(c) {
  if (mode === 'naive') {
    for (const id of CUSTOMERS) await c.query('INSERT INTO naive_emails (customer_id, slot) VALUES ($1, $2)', [id, slot]);
    return 'ran';
  }
  await c.query('BEGIN');
  const { rows: [l] } = await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('daily-billing')) AS ok`);
  if (!l.ok) { await c.query('ROLLBACK'); return 'locked'; }                 // another instance is running it
  if (mode === 'lock-only') {
    for (const id of CUSTOMERS) await c.query('INSERT INTO naive_emails (customer_id, slot) VALUES ($1, $2)', [id, slot]);
    await c.query('COMMIT');
    return 'ran';
  }
  const claim = await c.query(`INSERT INTO job_runs (job, slot) VALUES ('daily-billing', $1)
    ON CONFLICT DO NOTHING RETURNING slot`, [slot]);
  if (claim.rowCount === 0) { await c.query('ROLLBACK'); return 'already-run'; }   // slot already done
  for (const id of CUSTOMERS) await c.query(`INSERT INTO email_outbox (customer_id, slot) VALUES ($1, $2)
    ON CONFLICT DO NOTHING`, [id, slot]);
  if (mode === 'crash') process.exit(3);                                    // dies before COMMIT
  await c.query('COMMIT');
  return 'ran';
}

const c = await pool.connect();
const outcome = await runSlot(c);
c.release();
await pool.end();
console.log(JSON.stringify({ pid: process.pid, outcome }));
