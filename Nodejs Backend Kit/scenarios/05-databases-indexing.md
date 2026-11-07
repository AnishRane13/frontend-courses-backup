# 05. Databases and indexing

> **Remember this**
> 1. Read the query plan before guessing. Reading the whole table and then sorting it means an index is missing or its columns are in the wrong order.
> 2. In an index on several columns, put the columns you match exactly first, then the column you sort or filter by range. Then run the plan again to prove it worked.
> 3. Move money inside one transaction, with both rows locked in id order, or with one update that checks the balance itself. Reading, doing the math in JavaScript and writing back loses updates.
> 4. Deadlocks come from two transactions locking the same rows in opposite order. Always lock in one fixed order, and retry deadlock and serialization errors a few times.
> 5. On a live table, build indexes without blocking writes, add new rules unchecked and validate them later, set a short lock timeout, and rename in steps with expand and contract.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Index | A sorted copy of some columns that lets the database find rows without reading the whole table. |
| Query plan | The database's step-by-step description of how it will run a query. |
| EXPLAIN ANALYZE | A command that runs the query and shows the plan with real row counts and timings. |
| Sequential scan | Reading every row of the table from start to end. |
| Index scan | Finding rows through an index, so only the needed rows are read. |
| Composite index | One index on several columns in a set order, such as customer, then created date. |
| Covering index | An index that holds every column a query needs, so the table itself is never read. |
| N+1 problem | One query for a list, then one more query for each row in it, so the number of queries grows with the page. |
| Transaction | A group of statements that all succeed or all fail together. |
| Row lock | A lock on one row that makes other transactions wait before changing it. |
| Lost update | Two transactions read the same value, and the second write silently overwrites the first. |
| Deadlock | Two transactions each hold a lock the other needs, so neither can continue. The database cancels one. |
| Isolation level | How much a transaction sees of other transactions running at the same time. |
| Read committed | The PostgreSQL default level: each statement sees the latest committed data. |
| Serialization error | An error the database raises at stricter isolation levels instead of allowing a conflict. The app must retry. |
| Idempotency key | A unique id the client sends with a request, so a retry of the same request runs only once. |
| Ledger | An append-only list of money movements that the balance can be rebuilt from. |
| Migration | A versioned script that changes the database schema. |
| Lock timeout | The longest a statement may wait for a lock before it gives up with an error. |
| Concurrent index build | Building an index while normal writes keep going. It is slower but does not block the app. |
| Backfill | Filling a new column for existing rows, usually in small batches. |
| Expand and contract | Changing a schema in safe steps: add the new shape, move the code and data over, then remove the old shape later. |

| # | Scenario | Tag |
|---|---|---|
| D1 | [The order history query got slow](#d1-the-order-history-query-got-slow) | Must know |
| D2 | [A wallet transfer must never lose or create money](#d2-a-wallet-transfer-must-never-lose-or-create-money) | Must know |
| D3 | [Change the schema of a large live table without downtime](#d3-change-the-schema-of-a-large-live-table-without-downtime) | Likely |

---

## D1. The order history query got slow
**Tag: Must know**

### Before you speak
- **Today:** the page runs one query: "this customer's orders, newest first, first twenty". At launch the table was small, so any plan was fast.
- **What goes wrong:** no index fits that query. The database reads the whole table, keeps this customer's rows, sorts them by date, and only then returns twenty. That work grows with the whole table, not with one customer.
- **How to see it:** run the query with EXPLAIN ANALYZE. A sequential scan followed by a sort on a big table is the sign.
- **The fix:** a composite index on customer, then created date. One customer's orders then sit next to each other, already sorted by date. The database reads twenty index entries and stops, with no sort.
- **Why the column order matters:** columns you match exactly go first, then the column you sort or filter by range. With the date first, one customer's rows are spread across the whole index.
- **A second bug to check:** N+1, where the page runs one query per order to load its details. That is fixed with a join or one batched query, not an index.
- **The trade-off to mention:** every index slows every insert and uses storage. On a live table, build it in the mode that does not block writes.

### Scenario
"Our e-commerce app has an order history page. It was instant at launch, but now the orders table has millions of rows and the page takes seconds. How do you find and fix the problem?"

### Questions to ask back
- **Which query is slow, and is it slow for every customer?** If only big customers are slow, I look for a sort or a missing limit, not only a missing index.
- **What does the query filter and sort on?** That decides the column order of the index.
- **How many writes does the orders table take?** Every new index slows every insert, so I add one index for the hot query, not one per column.
- **Is the page one query, or one query plus one per row?** Many small queries need batching, not an index.

### Spoken answer
> First I find the slow query in the slow query log, then I run it with the plan and real timings. If the plan shows a full table scan and then a sort, the database is reading every order to return a few. The fix is a composite index, meaning one index on more than one column: customer, then creation date. Equality columns go first, then the column we sort or filter by range. That way one customer's orders already sit sorted by date, so the database reads only the rows it returns and skips the sort. I build the index without blocking writes, then rerun the plan to prove an index scan and a lower time. I also count queries per request, because a loop that loads each order's details is a different bug. The trade off is slower writes and more storage for every index.

### Say it in 5 beats
1. Find the slow query, read its plan.
2. Full scan plus sort means no index.
3. Composite index: exact match first, then sort.
4. Build without blocking writes, recheck the plan.
5. Trade-off: slower writes, more storage.

### Case variations
- **"The page makes one query for the orders, then one per order for the product names."**
  > That is the N plus one problem. Each query is a network round trip, so the page gets slower as it shows more rows. I would load the names with a join, or with one batched query for all the ids. Then the page sends one or two queries in total.
- **"We put the index on the date first, then the customer."**
  > The database can still use it, but it walks the dates of every customer and throws most rows away. With the customer first, one customer's orders sit together, already sorted. The read stops after one page.
- **"The plan still shows a full scan after adding the index."**
  > I would check that the table statistics are fresh, and that the query does not wrap the column in a function or a type cast, which stops the index from matching. I also check how many rows the filter keeps. For a small table, or a filter that matches most rows, a full scan really can be cheaper.
- **"The page also filters by status."**
  > Status is another exact-match filter, so it goes next to the customer, before the date. If there are only a few status values and the filter is optional, I would compare the plans both ways before adding a wider index.

### Follow-up questions
- **What is the difference between EXPLAIN and EXPLAIN ANALYZE?** Plain EXPLAIN shows the planner's guess without running the query. EXPLAIN ANALYZE runs it and shows real row counts and times, so trust that one. Because it really runs, wrap a write in a transaction and roll it back.
- **What do you look for in the plan?** Whether it reads the whole table or uses an index, whether there is a sort step, estimated rows versus actual rows, and buffers, meaning how many data pages were read. A big gap between estimated and actual rows means the statistics are stale.
- **What is a covering index?** An index that holds every column the query needs, so the database answers from the index alone. In PostgreSQL that shows up as an index only scan, often with extra columns added through INCLUDE.
- **Optional: senior. How do you decide which indexes to drop?** I would look at index usage stats over a full business cycle, such as a month, so rare reports are counted. Then I find indexes that are never scanned, or that are just the first columns of another index, and drop them without blocking writes. Every unused index costs write time and memory, and gives the planner more options to get wrong.

### Common wrong answers and red flags
- "Add an index on every column." Single-column indexes rarely serve a filter and a sort together, and each one slows writes.
- Putting the range or sort column before the exact-match column in a composite index.
- Guessing without a plan, or reading only the planner's estimates when real timings are available.
- Building the index with a plain CREATE INDEX on a live table, which blocks writes for the whole build.
- Trying to fix N+1 with an index. Each query gets faster, but there is still one round trip per row.
- Using OFFSET for deep pages of order history. The database still reads every skipped row.

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

### Before you speak
- **Today:** the transfer code reads both balances, works out the new balances in JavaScript, and writes those numbers back.
- **What goes wrong, lost updates:** two transfers from the same account can read the same balance at the same moment. Each writes back its own result, and the second overwrites the first. One debit simply disappears.
- **Why a transaction alone is not enough:** PostgreSQL's default level, read committed, lets both transactions read the same balance. The transaction only makes the writes all-or-nothing.
- **The fix:** inside one transaction, lock both account rows before reading them, check the funds, then use relative updates such as "balance minus amount". A second transfer on the same row now waits for the first to finish.
- **Why deadlocks happen:** A sends to B while B sends to A. If each transfer locks its own sender first, each holds one row and waits for the other forever. Locking both rows in id order, lowest first, makes the second transfer wait instead.
- **A simpler option for one account:** a single update that subtracts only if the balance is enough. If it changes no row, the funds were too low. There is no separate read to race with.
- **The trade-off to mention:** a very busy account becomes a queue, because every transfer on it waits for the row lock.

### Scenario
"Our fintech wallet lets users send money to each other. Under load, support finds balances that do not add up, and once in a while a transfer fails with a deadlock error. How do you write the transfer so money is never lost or created?"

### Questions to ask back
- **How is a balance stored: one number per account, or a ledger of entries?** A ledger records every change, so it can be audited and the balance can be rebuilt from it.
- **Does the transfer call an outside service, like a fraud check?** That call must happen outside the database transaction, or the row locks are held for the whole call.
- **How busy are single accounts?** A merchant wallet receiving many payments queues on one row, which changes the design.
- **Can a client retry a transfer?** Then it also needs an idempotency key, or a retry moves the money twice.

### Spoken answer
> A transfer must debit and credit together, so both writes go in one database transaction. That alone is not enough. If the code reads a balance, computes the new value in the app, and writes it back, two transfers can read the same balance and one update is lost. So inside the transaction I lock both account rows before reading them, check the funds, and apply relative updates. I always lock the rows in the same order, lowest account id first, so opposite transfers wait instead of deadlocking. For a simple debit, one conditional update that only succeeds when funds are enough also works. I keep the transaction short, never call outside services inside it, and retry on a deadlock or serialization error. The trade off is that a hot account serializes, so throughput on one wallet is limited.

### Say it in 5 beats
1. Debit and credit in one transaction.
2. Read, compute, write back loses updates.
3. Lock both rows, lowest id first.
4. Or one conditional update, no read.
5. Trade-off: busy accounts become a queue.

### Case variations
- **"Can we just raise the isolation level instead of locking?"**
  > Yes. At repeatable read or serializable, the database refuses the lost update and raises a serialization error instead. But then the app must catch that error and run the whole transaction again. Locking makes the second transfer simply wait, which is simpler when the conflict is on rows you know in advance.
- **"Two users send money to each other at the same moment."**
  > If each transfer locks its own sender first, each holds one row and waits for the other. That is a deadlock, and the database cancels one of them after about a second. Locking both rows in id order means the second transfer just waits its turn.
- **"One merchant account receives thousands of payments a minute."**
  > Every payment queues on that one row. I would record each credit as a new ledger entry, which needs no lock on the balance row, and update the merchant balance in batches. Another option is splitting the account into several sub-balances that are added up when read.
- **"We use MongoDB, not SQL."**
  > An update to a single document is already all-or-nothing, so a conditional decrement protects one balance. Moving money between two documents needs a multi-document transaction, which requires a replica set. The callback form of the transaction API retries write conflicts for you.

### Follow-up questions
- **What is a lost update?** Two transactions read the same value, each computes a new value in the app, and the second write overwrites the first. Relative updates or a row lock prevent it.
- **What does PostgreSQL's default isolation level allow?** Read committed. It never shows you uncommitted data, but each statement sees the latest committed data. So a read followed by a write, with no lock, can still lose updates.
- **How do you handle a deadlock error?** Treat it as safe to retry. Roll back, wait a short random time, and run the whole transaction again, up to a fixed number of tries. Then fix the lock order so it stops happening.
- **Optional: senior. How do you prove the books balance?** Use double-entry bookkeeping, where every transfer writes a debit entry and a credit entry in one transaction, and a database constraint keeps balances from going below zero. A scheduled job checks that all entries add up to zero and that each stored balance matches its entries, and it alerts on any difference.

### Common wrong answers and red flags
- "Wrap it in a transaction" and stop there. At read committed, a read followed by writing an absolute new value still loses updates.
- Reading the balance in JavaScript and writing back an absolute new balance.
- Locking only the sender, or locking nothing up front. Opposite transfers can deadlock, and skipping the balance check can overdraw. Also, the driver can return money columns as strings, so convert them to numbers before comparing.
- Calling a payment provider or sending an email inside the transaction.
- Trying to fix deadlocks by raising the deadlock timeout setting. That only delays detection.
- Storing money as a float. Use whole numbers of the smallest unit, such as cents, or an exact numeric type.

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

### Before you speak
- **Today:** someone runs a normal CREATE INDEX or ALTER TABLE on a huge table while the app is live, and the app freezes.
- **What goes wrong, part one:** a normal index build blocks every write until it finishes, which on hundreds of millions of rows takes minutes.
- **What goes wrong, part two:** most ALTER TABLE statements need the strongest lock, which blocks even reads. If the statement has to wait behind a long-running transaction, every new query queues behind the statement. A change that takes milliseconds can still stop the app.
- **Fix for the index:** build it concurrently, meaning normal writes keep going. It is slower, cannot run inside a transaction, and if it fails it leaves an invalid index to drop and rebuild.
- **Fix for a required column:** add it as nullable. Add a "must not be null" check marked not valid, which applies to new rows only. Backfill old rows in small batches. Then validate the check, which scans the table without blocking writes.
- **Fix for the waiting problem and renames:** set a short lock timeout, so a blocked migration fails fast and retries. Rename with expand and contract: add the new column, write to both, copy the data, switch reads, and drop the old column in a later deploy.
- **The trade-off to mention:** one change becomes several steps and several deploys.

### Scenario
"Our SaaS dashboard has an events table with hundreds of millions of rows and constant writes. We need a new index, a new required column, and a column rename. Last time someone added an index, the app froze for minutes. How do you ship these changes without downtime?"

### Questions to ask back
- **Which database and version?** Newer PostgreSQL can mark NOT NULL itself as not valid; older versions need the CHECK route.
- **Does the migration tool wrap each file in a transaction?** A concurrent index build cannot run inside one, so that step must opt out.
- **Are there long-running transactions or reports on this table?** Any lock request waits behind them, and every new query waits behind that request.
- **Do old and new app versions run at the same time during a deploy?** Then a rename must be split across several deploys.

### Spoken answer
> On a big live table, the danger is locks, not the change itself. A normal index build blocks every write until it finishes, which can take minutes. So I build the index without blocking writes. It is slower, cannot run inside a transaction, and if it fails it leaves an invalid index that I drop and retry. For a new required column, I add it as nullable, add the not null rule without checking old rows, backfill in small batches, then validate, which scans without blocking writes. Every migration sets a short lock timeout, so if it queues behind a long transaction it fails fast and retries, instead of freezing traffic. Renames use expand and contract: add the new column, write both, backfill, switch reads, then drop the old one in a later deploy. The trade off is more steps and more deploys for one change.

### Say it in 5 beats
1. The danger is locks, not the change.
2. Build indexes without blocking writes.
3. Not null: unchecked rule, backfill, validate.
4. Short lock timeout, fail fast, retry.
5. Expand and contract. Trade-off: more deploys.

### Case variations
- **"The non-blocking index build failed halfway."**
  > It leaves an invalid index. The database still updates it on every write but never uses it for reads, so it only costs. I would drop it, also without blocking, find the cause, which for a unique index is often a duplicate value, and build it again.
- **"We need a new column with a default value."**
  > A fixed default, like zero, is stored once in the table's metadata, so adding the column is instant. A default worked out per row, like a random id or the current clock time, rewrites the whole table under the strongest lock. So for that kind I add the column without the default and backfill it.
- **"Just rename the column, it is one statement."**
  > The statement is fast, but every running instance of the old app breaks at that moment, because it still asks for the old name. I add the new column, write to both, copy the data, move reads to the new column, and drop the old column only after no running code uses it.
- **"The migration sat waiting and the whole site went down."**
  > The ALTER waited for its lock behind a long transaction, and every new query queued behind the ALTER. A short lock timeout makes it give up and retry later. The queue then never builds up.

### Follow-up questions
- **Why does a plain CREATE INDEX still allow reads?** It takes a share lock, which blocks writes but not reads. The concurrent build takes a weaker lock that lets writes through. The cost is scanning the table twice and waiting for older transactions to finish.
- **Why backfill in batches?** One giant update holds row locks for a long time, writes a huge amount to the WAL, the write-ahead log every change goes through, and leaves many dead rows. It can also make replicas fall behind. Small batches by id range, with a short pause between them, keep each transaction short.
- **Where do you set the lock timeout?** On the migration's own database session only, for example half a second, with a retry and a growing wait between tries. Setting it in the server config would affect every session.
- **Optional: senior. How do you make this safe for a whole team, not just you?** Put the rules in the pipeline. A migration linter flags blocking statements, the migration runner sets the lock timeout and statement timeout, expand and contract ship as separate deploys, and a staging run on a production-sized copy shows build times before the real run.

### Common wrong answers and red flags
- "Run it at night." Night still has traffic, and a blocked migration can still freeze it.
- Running CREATE INDEX CONCURRENTLY inside the migration tool's transaction. It fails with error 25001.
- Adding NOT NULL directly to a big table that still has nulls, or validating before the backfill is finished.
- Renaming a column while old app instances are still running.
- Leaving the lock timeout at its default of zero, which waits forever.
- Forgetting the invalid index left by a failed concurrent build. It still costs time on every write.

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
