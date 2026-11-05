// Q1: a scheduled job must run once per slot across three app instances.
// Three separate Node processes fire the same slot at the same moment.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { withPg } from '../lib/pg.mjs';

const PORT = 7780;
const worker = join(import.meta.dirname, 'q1-worker.mjs');
const SLOT1 = '2026-11-05T03:00:00Z';
const SLOT2 = '2026-11-06T03:00:00Z';

function run(mode, slot, startAt) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [worker, String(PORT), mode, slot, String(startAt ?? '')]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, outcome: out ? JSON.parse(out.trim()).outcome : null }));
  });
}
const threeAtOnce = (mode, slot) => { const at = Date.now() + 1500; return Promise.all([1, 2, 3].map(() => run(mode, slot, at))); };
const count = async (pool, sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);

let passed = false;
await withPg(PORT, async (pool) => {
  await pool.query(`
    CREATE TABLE naive_emails (customer_id int NOT NULL, slot timestamptz NOT NULL);
    CREATE TABLE job_runs (job text NOT NULL, slot timestamptz NOT NULL,
      done_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (job, slot));
    CREATE TABLE email_outbox (customer_id int NOT NULL, slot timestamptz NOT NULL,
      PRIMARY KEY (customer_id, slot));`);

  // 1. No guard: three instances, three customers -> every customer gets three emails.
  const naive = await threeAtOnce('naive', SLOT1);
  assert.deepEqual(naive.map((r) => r.outcome), ['ran', 'ran', 'ran']);
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM naive_emails'), 9);
  await pool.query('TRUNCATE naive_emails');

  // 2. Lock alone stops overlap, but a late run after the lock was released runs the slot again.
  assert.equal((await run('lock-only', SLOT1)).outcome, 'ran');
  assert.equal((await run('lock-only', SLOT1)).outcome, 'ran');
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM naive_emails'), 6);

  // 3. Lock + run key: three processes at the same moment, exactly one does the work.
  for (let round = 0; round < 3; round++) {
    await pool.query('TRUNCATE job_runs, email_outbox');
    const res = await threeAtOnce('guarded', SLOT1);
    assert.ok(res.every((r) => r.code === 0));
    assert.equal(res.filter((r) => r.outcome === 'ran').length, 1, JSON.stringify(res));
    assert.ok(res.filter((r) => r.outcome !== 'ran').every((r) => ['locked', 'already-run'].includes(r.outcome)));
    assert.equal(await count(pool, 'SELECT count(*) AS n FROM job_runs'), 1);
    assert.equal(await count(pool, 'SELECT count(*) AS n FROM email_outbox'), 3);   // one per customer
  }

  // 4. A late or retried run for the same slot does nothing.
  assert.equal((await run('guarded', SLOT1)).outcome, 'already-run');
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM email_outbox'), 3);

  // 5. The idempotent side effect: a duplicate email row for the same customer and slot is ignored.
  const dup = await pool.query('INSERT INTO email_outbox VALUES (1, $1) ON CONFLICT DO NOTHING', [SLOT1]);
  assert.equal(dup.rowCount, 0);

  // 6. A run that crashes before commit leaves no run key and no emails, so the retry does the work once.
  const crashed = await run('crash', SLOT2);
  assert.equal(crashed.code, 3);
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM job_runs WHERE slot = $1', [SLOT2]), 0);
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM email_outbox WHERE slot = $1', [SLOT2]), 0);
  assert.equal((await run('guarded', SLOT2)).outcome, 'ran');
  assert.equal((await run('guarded', SLOT2)).outcome, 'already-run');
  assert.equal(await count(pool, 'SELECT count(*) AS n FROM email_outbox WHERE slot = $1', [SLOT2]), 3);

  passed = true;
  console.log('verify-q1: all assertions passed');
});
if (!passed) process.exit(1);
