// D3: schema changes on a live table. Checks, with node:assert:
// 1. a plain CREATE INDEX makes a concurrent INSERT wait until the build ends;
//    CREATE INDEX CONCURRENTLY lets the same INSERT finish while the build is still running;
// 2. CONCURRENTLY is refused inside a transaction block (25001);
// 3. lock_timeout makes an ALTER fail fast (55P03) instead of queueing behind a long transaction;
// 4. NOT NULL the safe way: CHECK ... NOT VALID rejects new NULLs at once, VALIDATE fails until
//    the backfill is done and then succeeds, and a concurrent INSERT is not blocked by VALIDATE.
import assert from 'node:assert/strict';
import { withPg } from '../lib/pg.mjs';

let ok = false;                                     // withPg logs a failure; this makes it exit 1
await withPg(7722, async (pool) => {
  await pool.query(`CREATE TABLE events (id bigserial PRIMARY KEY, account_id int NOT NULL,
    kind text, created_at timestamptz NOT NULL DEFAULT now())`);
  await pool.query(`INSERT INTO events (account_id, kind, created_at)
    SELECT (random()*100000)::int, CASE WHEN g % 10 = 0 THEN NULL ELSE 'click' END, now() - g * interval '1 second'
    FROM generate_series(1, 1000000) g`);
  await pool.query('ANALYZE events');

  // Run DDL on one connection; once it is running, time one INSERT on another connection.
  const insertDuring = async (ddl, delayMs = 100) => {
    const ddlConn = await pool.connect();
    const app = await pool.connect();
    try {
      await ddlConn.query('SET max_parallel_maintenance_workers = 0');   // a steadier build time
      let ddlEnd;
      const ddlDone = ddlConn.query(ddl).then(() => { ddlEnd = performance.now(); });
      for (;;) {                                                           // wait until the build is really running
        const { rows } = await pool.query(`SELECT 1 FROM pg_stat_activity WHERE query = $1 AND state = 'active'`, [ddl]);
        if (rows.length) break;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      const t = performance.now();
      await app.query(`INSERT INTO events (account_id, kind) VALUES (1, 'live')`);
      const insEnd = performance.now();
      await ddlDone;
      return { waitMs: insEnd - t, insertBeforeDdlEnd: insEnd < ddlEnd };
    } finally { ddlConn.release(); app.release(); }
  };

  const plain = await insertDuring('CREATE INDEX events_account_plain ON events (account_id, created_at)');
  assert.equal(plain.insertBeforeDdlEnd, false, 'plain CREATE INDEX should hold the insert until the build ends');
  await pool.query('DROP INDEX events_account_plain');
  const conc = await insertDuring('CREATE INDEX CONCURRENTLY events_account_conc ON events (account_id, created_at)');
  assert.equal(conc.insertBeforeDdlEnd, true, 'the insert should finish while the concurrent build is still running');
  assert.ok(plain.waitMs > 10 * conc.waitMs, `plain wait ${plain.waitMs} vs concurrent ${conc.waitMs}`);
  const valid = await pool.query(`SELECT indisvalid FROM pg_index WHERE indexrelid = 'events_account_conc'::regclass`);
  assert.equal(valid.rows[0].indisvalid, true);
  console.log(`insert wait: plain build ${plain.waitMs.toFixed(0)} ms, concurrent build ${conc.waitMs.toFixed(1)} ms`);

  // 2. Not allowed inside BEGIN ... COMMIT (migration tools wrap each file in one by default).
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await assert.rejects(c.query('CREATE INDEX CONCURRENTLY events_kind ON events (kind)'), { code: '25001' });
    await c.query('ROLLBACK');
  } finally { c.release(); }

  // 3. lock_timeout: a long open transaction holds a lock; the ALTER gives up instead of waiting forever.
  const holder = await pool.connect();
  const mig = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM events WHERE id = 1');               // holds ACCESS SHARE until commit
    await mig.query(`SET lock_timeout = '500ms'`);
    const t = performance.now();
    await assert.rejects(mig.query('ALTER TABLE events ADD COLUMN source text'), { code: '55P03' });
    assert.ok(performance.now() - t < 3000);
    await holder.query('COMMIT');
    await mig.query('ALTER TABLE events ADD COLUMN source text');            // retry succeeds once the lock is free
  } finally { holder.release(); mig.release(); }

  // 4. NOT NULL safely: constraint NOT VALID, backfill, VALIDATE.
  await pool.query(`ALTER TABLE events ADD CONSTRAINT events_kind_nn CHECK (kind IS NOT NULL) NOT VALID`);
  await assert.rejects(pool.query(`INSERT INTO events (account_id) VALUES (2)`), { code: '23514' });
  await assert.rejects(pool.query('ALTER TABLE events VALIDATE CONSTRAINT events_kind_nn'), { code: '23514' });
  await pool.query(`UPDATE events SET kind = 'unknown' WHERE kind IS NULL`);  // in production: batches by id range
  const v = await insertDuring('ALTER TABLE events VALIDATE CONSTRAINT events_kind_nn', 0);
  assert.equal(v.insertBeforeDdlEnd, true, 'VALIDATE should not block inserts');
  const con = await pool.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'events_kind_nn'`);
  assert.equal(con.rows[0].convalidated, true);
  console.log('25001 inside a transaction, 55P03 on lock timeout, NOT VALID then VALIDATE without blocking inserts');
  ok = true;
});
if (!ok) process.exit(1);
