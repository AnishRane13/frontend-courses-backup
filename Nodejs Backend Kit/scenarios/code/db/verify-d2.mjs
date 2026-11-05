// D2: wallet transfers. Checks, with node:assert:
// 1. read-then-write without a lock loses updates under concurrency (both balances end wrong);
// 2. locking both rows in id order inside a transaction keeps every balance and the total right;
// 3. one conditional UPDATE refuses to overdraw, even when many run at once;
// 4. two transfers that lock the same rows in opposite order deadlock (40P01), ordered locks do not;
// 5. under repeatable read the unlocked read-then-write fails with 40001 instead of losing the update.
import assert from 'node:assert/strict';
import pg from 'pg';
import { withPg } from '../lib/pg.mjs';

const PORT = 7721;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = false;                                   // withPg logs a failure; this makes it exit 1
await withPg(PORT, async (pool) => {
  const big = new pg.Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'pw', database: 'postgres', max: 25 });
  big.on('error', () => {});
  try {
    await pool.query('CREATE TABLE accounts (id int PRIMARY KEY, balance bigint NOT NULL CHECK (balance >= 0))');
    const reset = () => pool.query('TRUNCATE accounts; INSERT INTO accounts VALUES (1, 10000), (2, 10000)');
    const state = async () => (await pool.query('SELECT id, balance::int AS b FROM accounts ORDER BY id')).rows.map((r) => r.b);

    const tx = async (fn) => {
      const c = await big.connect();
      try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    };

    // 1. Lost update: read the balance into JS, compute, write the absolute value back.
    const unsafe = (from, to, amt) => tx(async (c) => {
      const a = Number((await c.query('SELECT balance FROM accounts WHERE id = $1', [from])).rows[0].balance);
      const b = Number((await c.query('SELECT balance FROM accounts WHERE id = $1', [to])).rows[0].balance);
      await sleep(5);                               // the app does some work between read and write
      await c.query('UPDATE accounts SET balance = $1 WHERE id = $2', [a - amt, from]);
      await c.query('UPDATE accounts SET balance = $1 WHERE id = $2', [b + amt, to]);
    });
    await reset();
    await Promise.all(Array.from({ length: 50 }, () => unsafe(1, 2, 10)));
    const [ua, ub] = await state();
    assert.ok(ua > 10000 - 500, `debits were lost: sender should be 9500, is ${ua}`);
    assert.ok(ub < 10000 + 500, `credits were lost: receiver should be 10500, is ${ub}`);
    console.log('unsafe: balances', ua, ub, 'total', ua + ub, '(should be 9500, 10500, 20000)');

    // 2. Safe: lock both rows in id order, check, then apply relative updates.
    const safe = (from, to, amt) => tx(async (c) => {
      const { rows } = await c.query('SELECT id, balance FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[from, to]]);
      if (rows.length !== 2) throw new Error('account not found');
      if (Number(rows.find((r) => r.id === from).balance) < amt) throw new Error('insufficient funds');
      await sleep(5);
      await c.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amt, from]);
      await c.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amt, to]);
    });
    await reset();
    await Promise.all([...Array.from({ length: 30 }, () => safe(1, 2, 10)), ...Array.from({ length: 20 }, () => safe(2, 1, 10))]);
    assert.deepEqual(await state(), [10000 - 300 + 200, 10000 + 300 - 200]);
    console.log('safe, both directions at once: balances', await state());

    // 3. One conditional UPDATE: the guard and the debit are one statement.
    await pool.query('UPDATE accounts SET balance = 100 WHERE id = 1');
    const debits = await Promise.all(Array.from({ length: 20 }, () =>
      big.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1', [30, 1])));
    assert.equal(debits.filter((r) => r.rowCount === 1).length, 3);
    assert.deepEqual((await state())[0], 10);
    console.log('conditional debit: 3 of 20 succeeded, balance 10, never negative');

    // 4. Deadlock: each transaction locks its own "from" row first, then the other row.
    await reset();
    const lockPair = (first, second, gate) => tx(async (c) => {
      await c.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [first]);
      await gate;                                   // both hold their first lock before asking for the second
      await c.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [second]);
    });
    const gate = sleep(200);
    const opposite = await Promise.allSettled([lockPair(1, 2, gate), lockPair(2, 1, gate)]);
    const failed = opposite.filter((r) => r.status === 'rejected');
    assert.equal(failed.length, 1, 'exactly one of the two should be cancelled');
    assert.equal(failed[0].reason.code, '40P01');
    const gate2 = sleep(200);
    const ordered = await Promise.allSettled([lockPair(1, 2, gate2), lockPair(1, 2, gate2)]);
    assert.ok(ordered.every((r) => r.status === 'fulfilled'), 'same lock order: the second waits, no deadlock');
    console.log('opposite order: one deadlock (40P01); same order: both committed');
    // 5. Repeatable read: the same read-then-write pattern gets a serialization error (40001) instead of a lost update.
    await reset();
    const rr = () => (async () => {
      const c = await big.connect();
      try {
        await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const a = Number((await c.query('SELECT balance FROM accounts WHERE id = 1')).rows[0].balance);
        await sleep(100);
        await c.query('UPDATE accounts SET balance = $1 WHERE id = 1', [a - 10]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
    })();
    const rrRes = await Promise.allSettled([rr(), rr()]);
    assert.equal(rrRes.filter((r) => r.status === 'rejected' && r.reason.code === '40001').length, 1);
    console.log('repeatable read: one commit, one 40001 to retry');
    ok = true;
  } finally {
    await big.end();
  }
});
if (!ok) process.exit(1);
