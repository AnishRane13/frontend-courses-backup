# 05. Databases and indexing

> **Remember this**
> 1. Read the plan before guessing. A sequential scan plus a sort on a big table means a missing or wrongly ordered index.
> 2. Composite index order: equality columns first, then the sort or range column. Then rerun `EXPLAIN (ANALYZE, BUFFERS)` to prove it.
> 3. Money moves inside one transaction, with both rows locked in id order, or with one conditional `UPDATE`. Read, compute in JS, write back loses updates.
> 4. Deadlocks come from opposite lock order. Lock in one global order and retry `40P01` and `40001` a bounded number of times.
> 5. On a live table: `CREATE INDEX CONCURRENTLY`, `CHECK ... NOT VALID` then `VALIDATE`, a short `lock_timeout`, and expand and contract for renames.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| D1 | [The order history query got slow](#d1-the-order-history-query-got-slow) | Must know |
| D2 | [A wallet transfer must never lose or create money](#d2-a-wallet-transfer-must-never-lose-or-create-money) | Must know |
| D3 | [Change the schema of a large live table without downtime](#d3-change-the-schema-of-a-large-live-table-without-downtime) | Likely |

---

## D1. The order history query got slow
**Tag: Must know**

### Scenario
"Our e-commerce app has an order history page. It was instant at launch, but now the orders table has millions of rows and the page takes seconds. How do you find and fix the problem?"

### Questions to ask back
- **Which query is slow, and is it slow for every customer?** If only large customers are slow, it points to a sort or a missing limit, not only a missing index.
- **What does the query filter and sort on?** That decides the column order of the index.
- **How write-heavy is the orders table?** Every new index slows every insert, so I add one index for the hot query, not one per column.
- **Is the page one query, or one query plus one per row?** If it is many small queries, the fix is batching, not an index.

### Spoken answer
> First I would confirm which query is slow, using the slow query log, then run it with the plan and real timings. If the plan shows a full table scan followed by a sort, the database reads every order to return a handful. The fix is a composite index on customer and creation date, in that order. Equality columns go first, then the column we sort or filter by range. With that order, the index already holds one customer's orders sorted by date, so the database reads only the rows it returns and skips the sort. I would build it without blocking writes, then rerun the plan to prove an index scan and a lower time. I would also count queries per request, because a loop that loads each order's details separately is a different problem. The trade-off is slower writes and more storage for every index.

### Say it in 5 beats
1. Find the slow query, read its plan.
2. Full scan plus sort means no index.
3. Composite index: equality first, then sort.
4. Build without blocking writes, recheck the plan.
5. Trade-off: slower writes, more storage.

### Case variations
- **"The page makes one query for the orders, then one per order for the product names."**
  > That is the N plus one problem. Each query is a network round trip, so the time grows with the page size. I would load the names with a join, or one batched query for all the ids, so the page sends one or two queries.
- **"We put the index on the date first, then the customer."**
  > The database can still use it, but it walks the dates for all customers and throws most entries away. With the customer first, one customer's orders sit together, already sorted, and the scan stops after one page.
- **"The plan still shows a full scan after adding the index."**
  > I would check that statistics are fresh, that the query does not wrap the column in a function or cast, and that the filter is selective. For a small table or a filter matching most rows, a full scan can really be cheaper.
- **"The page also filters by status."**
  > Status is another equality filter, so it goes with the customer, before the date. If the status values are few and the filter is optional, I would check the plan both ways before adding a wider index.

### Follow-up questions
- **What is the difference between EXPLAIN and EXPLAIN ANALYZE?** Plain explain shows the planner's estimate without running the query. Analyze runs it and shows real row counts and times, so it is the one to trust, but it really executes, so wrap a write in a transaction and roll it back.
- **What do you look for in the plan?** The node types, sequential scan versus index scan, any sort node, estimated rows versus actual rows, and the buffers read. A big gap between estimated and actual rows means stale statistics.
- **What is a covering index?** An index that holds every column the query needs, so the database can answer from the index alone. In PostgreSQL that is an index only scan, often with extra columns added by INCLUDE.
- **Optional: senior. How do you decide which indexes to drop?** I would look at index usage statistics over a full business cycle, find indexes with no scans or ones that are a prefix of another index, and drop them without blocking writes. Every unused index costs write time and memory, and it makes the planner's job harder.

### Common wrong answers and red flags
- "Add an index on every column." Single-column indexes rarely serve a filter plus a sort, and each one slows writes.
- Putting the range or sort column before the equality column in a composite index.
- Guessing without a plan, or reading only EXPLAIN estimates when real timings are available.
- Building the index with a plain CREATE INDEX on a live table, which blocks writes for the whole build (see D3).
- Fixing N+1 with an index. Faster single queries are still one round trip per row.
- Using `OFFSET` for deep pages of order history. The database still reads every skipped row (see topic 01).

### Numbers to quote
In a local test on 600,000 orders, the index with the date first read over ten times more pages than the index with the customer first, and the N+1 loop sent 21 queries where the join sent 1.

### Code sketch
```sql
-- Before: Seq Scan plus Sort. After: Index Scan, no Sort, about one page of rows read.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total, created_at FROM orders
WHERE customer_id = $1 AND created_at > now() - interval '400 days'
ORDER BY created_at DESC LIMIT 20;

-- Equality column first, then the sort and range column. Writes keep going during the build.
CREATE INDEX CONCURRENTLY orders_customer_created ON orders (customer_id, created_at);
```

```js
// pool is a pg Pool. One query for the page instead of 1 + one per order.
const { rows } = await pool.query(
  `SELECT o.id, o.total, c.name FROM orders o JOIN customers c ON c.id = o.customer_id
   WHERE o.customer_id = $1 ORDER BY o.created_at DESC LIMIT 20`, [customerId]);
```

Verified by [db/verify-d1.mjs](code/db/verify-d1.mjs)

### Source
Lessons 70, 73, 76, 80, 81, 110.

---

## D2. A wallet transfer must never lose or create money
**Tag: Must know**

### Scenario
"Our fintech wallet lets users send money to each other. Under load, support finds balances that do not add up, and once in a while a transfer fails with a deadlock error. How do you write the transfer so money is never lost or created?"

### Questions to ask back
- **How is a balance stored: one number per account, or a ledger of entries?** A ledger makes every change auditable, and the balance can be rebuilt from it.
- **Can the transfer call an outside service, like a fraud check?** That call must happen outside the database transaction, or it holds locks for its whole duration.
- **How hot are single accounts?** A merchant wallet receiving thousands of payments serializes on one row, which changes the design.
- **Can a client retry a transfer?** Then it also needs an idempotency key (topic 02), or a retry moves the money twice.

### Spoken answer
> A transfer must debit and credit together, so both writes go in one database transaction. That alone is not enough. If the code reads a balance, computes the new value in the app, and writes it back, concurrent transfers can read the same balance, and updates are lost. So inside the transaction I lock both account rows before reading them, check the funds, and apply relative updates. I always lock the rows in the same order, lowest account id first, so opposite transfers wait for each other instead of deadlocking. For a simple debit, one conditional update that only succeeds when funds are enough also works. I keep the transaction short, never call outside services inside it, and retry on a deadlock or serialization error. The trade-off is that a hot account serializes, so throughput on one wallet is limited.

### Say it in 5 beats
1. Debit and credit in one transaction.
2. Read, compute, write back loses updates.
3. Lock both rows, lowest id first.
4. Or one conditional update with no read.
5. Trade-off: hot accounts serialize.

### Case variations
- **"Can we just raise the isolation level instead of locking?"**
  > Yes, at repeatable read or serializable the database refuses the lost update with a serialization error instead. But then the app must catch that error and retry the whole transaction. Locking makes the second transfer wait, which is simpler when contention is on known rows.
- **"Two users send money to each other at the same moment."**
  > If each transfer locks its own sender first, each holds one row and waits for the other, which is a deadlock. The database cancels one after about a second. Locking both rows in id order makes the second one simply wait.
- **"One merchant account receives thousands of payments a minute."**
  > Every payment queues on that one row. I would credit through append-only ledger entries and compute or batch the merchant balance, or split the account into several sub-balances.
- **"We use MongoDB, not SQL."**
  > A single-document update is already atomic, so a conditional increment guards one balance. Moving money between two documents needs a multi-document transaction, which needs a replica set, and the callback form retries write conflicts.

### Follow-up questions
- **What is a lost update?** Two transactions read the same value, each computes a new value in the app, and the second write overwrites the first. Relative updates or a row lock prevent it.
- **What does PostgreSQL's default isolation level allow?** Read committed. It prevents dirty reads, but each statement sees the latest committed data, so a read-then-write pattern without a lock can still lose updates.
- **How do you handle a deadlock error?** Treat it as retryable. Roll back, wait a short random time, and run the whole transaction again a bounded number of times. Then fix the lock order so it stops happening.
- **Optional: senior. How do you prove the books balance?** Use double-entry: every transfer writes a debit and a credit entry in one transaction, and a database constraint keeps balances non-negative. A scheduled job checks that all entries sum to zero and that each stored balance matches its entries, and it alerts on any difference.

### Common wrong answers and red flags
- "Wrap it in a transaction" and stop there. At read committed, a read then an absolute write still loses updates.
- Reading the balance in JS and writing back `balance = $computed`.
- Copying the transfer from lessons 74 and 75 as is. Lesson 75 locks only the sender row and lesson 74 locks nothing up front, so two opposite transfers between the same accounts can deadlock. Lesson 74 also never checks the balance, so it can overdraw. Lesson 75 compares `rows[0].balance` without checking that the row exists, and pg returns `numeric` and `bigint` as strings, so convert explicitly. The correct version locks both rows in id order, checks both exist and the funds, then applies relative updates.
- Calling a payment provider or sending an email inside the transaction.
- Fixing deadlocks by raising `deadlock_timeout`. That only delays the detection.
- Storing money as a float. Use integer minor units or `numeric`.

### Numbers to quote
In a local test, 50 concurrent unlocked transfers left both balances wrong, the version that locks both rows in id order kept them exact, and opposite lock order produced one deadlock error where the same order produced none.

### Code sketch
```js
// client is a pg PoolClient from pool.connect(); amount is an integer in cents.
async function transfer(client, fromId, toId, amount) {
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(   // lock both rows, always in id order
      'SELECT id, balance FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE', [[fromId, toId]]);
    if (rows.length !== 2) throw new Error('Account not found');
    if (Number(rows.find((r) => r.id === fromId).balance) < amount) throw new Error('Insufficient funds');
    await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, fromId]);
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, toId]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }  // caller retries 40P01, 40001
}
```

```sql
-- A single debit with no separate read: rowCount 0 means insufficient funds.
UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1;
```

Verified by [db/verify-d2.mjs](code/db/verify-d2.mjs)

### Source
Lessons 74, 75.

---

## D3. Change the schema of a large live table without downtime
**Tag: Likely**

### Scenario
"Our SaaS dashboard has an events table with hundreds of millions of rows and constant writes. We need a new index, a new required column, and a column rename. Last time someone added an index, the app froze for minutes. How do you ship these changes without downtime?"

### Questions to ask back
- **Which database and version?** PostgreSQL 18 can mark NOT NULL itself as not valid, older versions need the CHECK route.
- **Does the migration tool wrap each file in a transaction?** A non-blocking index build cannot run inside one, so that step needs an opt-out.
- **Are there long-running transactions or reports on this table?** Any lock request queues behind them, and every query queues behind that request.
- **Do old and new app versions run at the same time during a deploy?** Then a rename must be split across deploys.

### Spoken answer
> On a big live table, the danger is locks, not the change itself. A normal index build blocks every write to the table until it finishes, which can take minutes. So I build the index without blocking writes. It is slower, cannot run inside a transaction, and if it fails it leaves an invalid index that I drop and retry. For a new required column, I add it as nullable, add the not null rule without checking old rows, backfill in small batches, then validate, which scans without blocking writes. Every migration sets a short lock timeout, so if it queues behind a long transaction it fails fast and retries, instead of freezing traffic. Renames use expand and contract: add the new column, write both, backfill, switch reads, then drop the old one in a later deploy. The trade-off is more steps and more deploys for one change.

### Say it in 5 beats
1. The danger is locks, not the change.
2. Build indexes without blocking writes.
3. Not null: unchecked rule, backfill, validate.
4. Short lock timeout, fail fast, retry.
5. Expand and contract. Trade-off: more deploys.

### Case variations
- **"The non-blocking index build failed halfway."**
  > It leaves an invalid index that the database still updates on every write but never uses for reads. I would drop it, also without blocking, find the cause, often a duplicate for a unique index, and build again.
- **"We need a new column with a default value."**
  > A constant default is stored in the catalog, so adding the column is instant. A default computed per row, like a random id or the current clock time, rewrites the whole table under an exclusive lock, so I add the column without it and backfill.
- **"Just rename the column, it is one statement."**
  > The statement is fast, but every running instance of the old app breaks at that moment. I add the new column, write to both, backfill, move reads, and drop the old column only after no running code uses it.
- **"The migration sat waiting and the whole site went down."**
  > The alter waited for a lock behind a long transaction, and every new query queued behind the alter. A short lock timeout makes it give up and retry later, so the queue never builds.

### Follow-up questions
- **Why can a plain CREATE INDEX still allow reads?** It takes a share lock, which conflicts with writes but not with reads. The concurrent build takes a weaker lock that lets writes through, at the cost of scanning the table twice and waiting for older transactions.
- **Why backfill in batches?** One giant update holds row locks for a long time, creates a huge amount of WAL and dead rows, and can lag replicas. Small batches by id range, with a short pause, keep each transaction short.
- **Where do you set lock_timeout?** On the migration session only, for example half a second, with a retry and backoff. Setting it in the server config would affect every session.
- **Optional: senior. How do you make this safe for a whole team, not just you?** Put the rules in the pipeline: a migration linter that flags blocking statements, lock_timeout and statement_timeout set by the migration runner, separate deploys for expand and contract, and a staging run on a production-sized copy so build times are known before the real run.

### Common wrong answers and red flags
- "Run it at night." Night still has traffic, and a blocked migration can still freeze it.
- Running `CREATE INDEX CONCURRENTLY` inside a migration tool's transaction. It fails with error 25001.
- Adding `NOT NULL` directly to a big table with nulls left, or validating before the backfill finishes.
- `ALTER TABLE ... RENAME COLUMN` while old app instances are still running.
- Leaving `lock_timeout` at its default of 0, which waits forever.
- Forgetting the invalid index left by a failed concurrent build. It still costs write time.

### Numbers to quote
In a local test on a million-row table, an insert waited for the whole plain index build but finished while the non-blocking build was still running, and the validate step did not block inserts either.

### Code sketch
```sql
-- Run outside a transaction; the migration session sets a short lock timeout first.
SET lock_timeout = '500ms';
CREATE INDEX CONCURRENTLY events_account_created ON events (account_id, created_at);

-- Required column: add nullable, guard new rows, backfill in batches, then validate.
ALTER TABLE events ADD COLUMN kind text;
ALTER TABLE events ADD CONSTRAINT events_kind_nn CHECK (kind IS NOT NULL) NOT VALID;
UPDATE events SET kind = 'unknown' WHERE kind IS NULL AND id BETWEEN $1 AND $2;
ALTER TABLE events VALIDATE CONSTRAINT events_kind_nn;  -- does not block writes
```

Verified by [db/verify-d3.mjs](code/db/verify-d3.mjs)

### Source
Lessons 80.
