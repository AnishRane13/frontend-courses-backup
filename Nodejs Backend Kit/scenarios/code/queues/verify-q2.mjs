// Q2: a failing job must not retry forever. PostgreSQL jobs table, workers that skip locked rows,
// max attempts, exponential backoff with jitter, permanent vs temporary errors, dead letters,
// an idempotent consumer, and stuck-job recovery.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { withPg } from '../lib/pg.mjs';

const PORT = 7781;
const BASE_MS = 40;
const backoff = (attempt) => {                        // exponential, with "equal jitter": half fixed, half random
  const d = Math.min(BASE_MS * 2 ** (attempt - 1), 30_000);
  return Math.round(d / 2 + Math.random() * (d / 2));
};
class PermanentError extends Error {}

let passed = false;
await withPg(PORT, async (pool) => {
  await pool.query(`
    CREATE TABLE jobs (id bigserial PRIMARY KEY, payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
      attempts int NOT NULL DEFAULT 0, max_attempts int NOT NULL DEFAULT 5,
      run_at timestamptz NOT NULL DEFAULT now(), locked_by text, locked_until timestamptz,
      last_error text, finished_at timestamptz);
    CREATE INDEX jobs_ready ON jobs (run_at, id) WHERE status = 'queued';
    CREATE TABLE dead_letters (job_id bigint PRIMARY KEY, payload jsonb NOT NULL, attempts int NOT NULL,
      error text NOT NULL, failed_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE processed_messages (message_key text PRIMARY KEY);
    CREATE TABLE sent_log (job_id bigint NOT NULL, message_key text NOT NULL, worker text NOT NULL);`);

  const enqueue = async (payload) => (await pool.query('INSERT INTO jobs (payload) VALUES ($1) RETURNING id', [payload])).rows[0].id;

  // Claim one ready job. Workers skip rows another worker has locked, so no job is taken twice.
  const claim = async (worker, leaseMs = 5000) => (await pool.query(`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = $1,
      locked_until = clock_timestamp() + make_interval(secs => $2 / 1000.0)
    WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= clock_timestamp()
                ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`, [worker, leaseMs])).rows[0];

  const complete = (job, worker) => pool.query(`UPDATE jobs SET status = 'done', locked_by = NULL,
    finished_at = clock_timestamp() WHERE id = $1 AND locked_by = $2`, [job.id, worker]);

  const retryDelays = new Map();                       // job id -> delays chosen, for the backoff check
  async function fail(job, worker, err) {
    if (err instanceof PermanentError || job.attempts >= job.max_attempts) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO dead_letters (job_id, payload, attempts, error) VALUES ($1, $2, $3, $4)',
          [job.id, job.payload, job.attempts, err.message]);
        await c.query(`UPDATE jobs SET status = 'dead', locked_by = NULL, last_error = $2 WHERE id = $1`, [job.id, err.message]);
        await c.query('COMMIT');
      } finally { c.release(); }
      return;
    }
    const delay = backoff(job.attempts);
    retryDelays.set(job.id, [...(retryDelays.get(job.id) ?? []), delay]);
    await pool.query(`UPDATE jobs SET status = 'queued', locked_by = NULL, last_error = $3,
      run_at = clock_timestamp() + make_interval(secs => $2 / 1000.0) WHERE id = $1 AND locked_by = $4`,
      [job.id, delay, err.message, worker]);
  }

  // The handler: idempotent consumer. The message key is claimed in the same transaction as the effect.
  let providerUp = false;
  const attemptTimes = new Map();
  async function handle(job, worker) {
    attemptTimes.set(job.id, [...(attemptTimes.get(job.id) ?? []), Date.now()]);
    const { to, key } = job.payload;
    if (!to.includes('@')) throw new PermanentError(`invalid address ${to}`);
    if (to.endsWith('@down.example') && !providerUp) throw new Error('provider 503');
    await sleep(3);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const fresh = await c.query('INSERT INTO processed_messages VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1', [key]);
      if (fresh.rowCount) await c.query('INSERT INTO sent_log VALUES ($1, $2, $3)', [job.id, key, worker]);
      await c.query('COMMIT');
    } finally { c.release(); }
  }

  const inFlight = new Set();
  const perWorker = {};
  async function worker(name, stopWhen) {
    perWorker[name] = 0;
    while (!(await stopWhen())) {
      const job = await claim(name);
      if (!job) { await sleep(5); continue; }
      assert.ok(!inFlight.has(job.id), `job ${job.id} processed by two workers at once`);
      inFlight.add(job.id);
      perWorker[name]++;
      try { await handle(job, name); await complete(job, name); } catch (err) { await fail(job, name, err); } finally { inFlight.delete(job.id); }
    }
  }
  const allSettled = async () => Number((await pool.query(`SELECT count(*) AS n FROM jobs WHERE status IN ('queued','running')`)).rows[0].n) === 0;

  // A. 40 good jobs, one job whose provider is down (temporary), one bad address (permanent).
  const poison = await enqueue({ to: 'a@down.example', key: 'm-poison' });
  const bad = await enqueue({ to: 'not-an-address', key: 'm-bad' });
  const good = [];
  for (let i = 0; i < 40; i++) good.push(await enqueue({ to: `u${i}@ok.example`, key: `m-${i}` }));
  await Promise.all([worker('w1', allSettled), worker('w2', allSettled)]);

  const job = async (id) => (await pool.query('SELECT * FROM jobs WHERE id = $1', [id])).rows[0];
  const p = await job(poison);
  assert.equal(p.status, 'dead');
  assert.equal(p.attempts, 5);                                         // stopped after N attempts
  const b = await job(bad);
  assert.equal(b.status, 'dead');
  assert.equal(b.attempts, 1);                                         // permanent error: no retries
  const dl = (await pool.query('SELECT * FROM dead_letters ORDER BY job_id')).rows;
  assert.deepEqual(dl.map((r) => [Number(r.job_id), r.attempts, r.error]),
    [[Number(poison), 5, 'provider 503'], [Number(bad), 1, 'invalid address not-an-address']]);

  // Backoff delays grow: 4 retries, each inside [base/2, base] for its attempt, never smaller than the last.
  const delays = retryDelays.get(poison);
  assert.equal(delays.length, 4);
  delays.forEach((d, i) => { const full = BASE_MS * 2 ** i; assert.ok(d >= full / 2 && d <= full, `delay ${d} for retry ${i + 1}`); });
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1]);
  // The database honoured them: no attempt started before its delay, and the gaps grew.
  const t = attemptTimes.get(poison);
  const gaps = t.slice(1).map((x, i) => x - t[i]);
  gaps.forEach((g, i) => assert.ok(g >= delays[i] - 5, `gap ${g} < delay ${delays[i]}`));
  assert.ok(gaps[3] > gaps[1]);                                       // the first gap also includes waiting behind the 40 good jobs

  // Other jobs kept flowing: every good job done once, on its first attempt, before the poison job died.
  const goodRows = (await pool.query('SELECT status, attempts, finished_at FROM jobs WHERE id = ANY($1)', [good])).rows;
  assert.ok(goodRows.every((r) => r.status === 'done' && r.attempts === 1));
  assert.ok(Math.max(...goodRows.map((r) => r.finished_at.getTime())) < dl.find((r) => Number(r.job_id) === Number(poison)).failed_at.getTime());
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM sent_log')).rows[0].n), 40);
  assert.ok(perWorker.w1 > 0 && perWorker.w2 > 0, JSON.stringify(perWorker));   // both workers took jobs

  // B. Replay from the dead-letter table after the provider recovers.
  providerUp = true;
  const r = await pool.connect();
  await r.query('BEGIN');
  await r.query(`UPDATE jobs SET status = 'queued', attempts = 0, run_at = now() WHERE id = $1`, [poison]);
  await r.query('DELETE FROM dead_letters WHERE job_id = $1', [poison]);
  await r.query('COMMIT');
  r.release();
  await worker('w1', allSettled);
  assert.equal((await job(poison)).status, 'done');
  assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM sent_log WHERE message_key = 'm-poison'`)).rows[0].n), 1);

  // C. Stuck job: a worker claims with a short lease, does the work, then dies before marking it done.
  const stuck = await enqueue({ to: 'z@ok.example', key: 'm-stuck' });
  const claimed = await claim('w-crash', 300);
  assert.equal(claimed.id, stuck);
  await handle(claimed, 'w-crash');                                   // effect committed, never marked done
  const recover = async () => (await pool.query(`UPDATE jobs SET status = 'queued', locked_by = NULL
    WHERE status = 'running' AND locked_until < clock_timestamp() RETURNING id`)).rowCount;
  assert.equal(await recover(), 0);                                   // lease still valid: not stolen
  await sleep(400);
  assert.equal(await recover(), 1);                                   // lease expired: back in the queue
  await worker('w2', allSettled);
  const s = await job(stuck);
  assert.equal(s.status, 'done');
  assert.equal(s.attempts, 2);
  assert.equal(Number((await pool.query(`SELECT count(*) AS n FROM sent_log WHERE message_key = 'm-stuck'`)).rows[0].n), 1);   // retry was safe

  passed = true;
  console.log('verify-q2: all assertions passed', JSON.stringify({ delays, gaps, perWorker }));
});
if (!passed) process.exit(1);
