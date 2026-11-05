# 10. Queues and scheduled jobs

> **Remember this**
> 1. An in-process cron runs on every instance. Three instances means three runs.
> 2. A lock stops overlap right now. A run key per job and slot stops a late or retried run later.
> 3. Build the run key from the scheduled slot, never from the current time.
> 4. Retries need limits: max attempts, exponential backoff with jitter, permanent errors fail at once, and a dead-letter table you can replay from.
> 5. Delivery is at least once, so every consumer is idempotent, and a crashed worker's job comes back after its lease.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| Q1 | [A daily billing email goes out three times after scaling to three servers](#q1-a-daily-billing-email-goes-out-three-times-after-scaling-to-three-servers) | Must know |
| Q2 | [A notification job fails forever and blocks the queue](#q2-a-notification-job-fails-forever-and-blocks-the-queue) | Likely |

---

## Q1. A daily billing email goes out three times after scaling to three servers
**Tag: Must know**

### Scenario
"Our SaaS app sends a daily billing summary from a cron inside the Node app. After we scaled to three instances, customers started getting three emails every morning. How do you make the job run once?"

### Questions to ask back
- **Can the schedule live outside the app, in a platform scheduler or one scheduler service?** Then only one trigger fires. I still keep the run key, because platform schedulers can fire twice too.
- **If a day is missed, must it still be sent later?** Then I need catch-up logic that walks missed slots, not just a skip.
- **How long does the job take?** A long job needs a lock or lease that outlives it, or a second instance takes over mid-run.
- **Does the email provider accept an idempotency key?** If yes, I pass the run key plus the customer id, so even a crash after sending cannot send twice.

### Spoken answer
> Each instance runs its own copy of the cron, so every instance fires at the same moment. I would fix it in two layers. First, only one instance should do the work. I either move the schedule to one place, or each instance tries a database lock and the losers skip. Second, a lock alone is not enough, because a slow instance can start after the winner released it. So I record a run key, the job name plus the scheduled slot, with a unique constraint. Only one insert can win, and a late or retried run finds the key and stops. The key comes from the scheduled time, not the current clock. The emails themselves are keyed by customer and slot, so they are idempotent too. The trade off is an extra table and a little more code, in exchange for one email per customer per day.

### Say it in 5 beats
1. Every instance fires its own cron.
2. One runner: scheduler or database lock.
3. Run key: job name plus slot.
4. Late or retried runs find it, stop.
5. Trade-off: extra table, one email each.

### Case variations
- **"We moved the job to a Kubernetes CronJob. Are we done?"**
  > Not fully. The Kubernetes docs say a CronJob creates a Job about once per slot, and sometimes two. I keep the run key, built from the scheduled time the Job carries, so a second Job does nothing.
- **"The instance doing the work crashes halfway through."**
  > The run key and the email rows are written in one transaction, so a crash rolls both back. The lock goes with the dropped connection. The next attempt runs the slot cleanly.
- **"We would rather use Redis for the lock."**
  > Same idea. Set the key only if it is absent, with an expiry longer than the job, and a unique token so an instance only deletes its own lock. I still keep the run key in the database, because a Redis lock expires and forgets.
  > Unverified: needs Redis. The local script uses a PostgreSQL advisory lock.
- **"The job is slow and sometimes overlaps the next slot."**
  > The next slot has a different run key, so both can run at once. If that is a problem, I add a lock on the job name alone and alert when a run is skipped.

### Follow-up questions
- **Why not check "did we run today?" before running?** Check, then insert, is a race. All three instances read "no" at the same moment. Only a unique constraint or a lock picks one winner.
- **Why build the run key from the scheduled slot?** Instances fire milliseconds apart. Keys from the current time would all differ, and every insert would win.
- **What about leader election?** One instance holds a lease and runs every schedule. Failover takes as long as the lease, and a paused leader can still think it leads, so the run key stays.
- **Optional: senior. The job sends the emails, then crashes before recording the run. What now?** I avoid that order. The job only writes email rows to an outbox table in the same transaction as the run key, so a crash rolls back both and the retry starts clean. A sender works through the outbox later and passes customer plus slot as the provider's idempotency key, so a crash after a send does not repeat it.
  > Unverified: needs a real email provider that honours idempotency keys. The local script covers only the database side.

### Common wrong answers and red flags
- "Keep a flag in memory." Memory is per process. The other instances never see it.
- A lock with no run key. The script shows a late run after the lock was released sending every email again.
- A run key built from `Date.now()`. Instances a few milliseconds apart get different keys.
- A Redis lock with no expiry, or released with a plain `DEL` that can delete another instance's lock.
- Trusting a platform scheduler to be exactly once. Kubernetes itself says "approximately once".
- Lesson 115 says lesson 105 covers Kubernetes Jobs. It does not. Use the Kubernetes CronJob docs for that part.

### Numbers to quote
In a local test, three Node processes fired the same slot together: with no guard, three customers got nine emails, and with the lock plus run key exactly one process did the work and a later run for the same slot did nothing.

### Code sketch
```js
// c is a pg client inside an async function; slot is the scheduled time; customerIds is an array
await c.query('BEGIN');
const { rows: [l] } = await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('daily-billing')) AS ok`);
if (!l.ok) return c.query('ROLLBACK');                          // another instance is running it
const claim = await c.query(`INSERT INTO job_runs (job, slot) VALUES ('daily-billing', $1)
  ON CONFLICT DO NOTHING RETURNING slot`, [slot]);
if (claim.rowCount === 0) return c.query('ROLLBACK');           // this slot already ran
for (const id of customerIds) await c.query(`INSERT INTO email_outbox (customer_id, slot)
  VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, slot]);          // sent later, keyed by customer and slot
await c.query('COMMIT');                                         // run key and emails commit together
```

```sql
CREATE TABLE job_runs (job text NOT NULL, slot timestamptz NOT NULL,
  done_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (job, slot));
CREATE TABLE email_outbox (customer_id int NOT NULL, slot timestamptz NOT NULL,
  PRIMARY KEY (customer_id, slot));
```

Verified by [verify-q1.mjs](code/queues/verify-q1.mjs)

### Source
Lessons 115, 114, 75.

---

## Q2. A notification job fails forever and blocks the queue
**Tag: Likely**

### Scenario
"Our notification service sends emails from a job queue. One job has a bad email address, and it keeps failing and retrying, hammering the provider while other notifications pile up behind it. How would you redesign the retry handling?"

### Questions to ask back
- **Which errors can never succeed?** A bad address or a rejected request is permanent, so it skips retries and goes straight to dead letters.
- **Does the provider rate limit us or send a retry hint?** If it says when to retry, I follow that instead of my own backoff.
- **Must one user's notifications stay in order?** Then I process each user's jobs one at a time, which limits parallelism.
- **Who looks at failed jobs?** That decides the alerting and who owns the replay tool.

### Spoken answer
> I would stop retrying forever in four ways. Every job gets a maximum number of attempts. Retries wait longer each time, with exponential backoff and random jitter, so failed jobs do not hit the provider in waves. I separate errors. A bad address is permanent, so it fails at once. A timeout or an outage is temporary, so it retries. A job that runs out of attempts moves to a dead letter table with its last error, where someone can inspect it and replay it after a fix. Workers skip rows another worker has locked, so a waiting job never blocks the rest. Each claim has a lease, so a crashed worker's job comes back. Since a job can then run twice, the consumer records each message key and skips repeats. The trade off is more state to manage, and alerts to watch on the dead letters.

### Say it in 5 beats
1. Cap the attempts per job.
2. Exponential backoff with random jitter.
3. Permanent errors fail at once.
4. Dead letters: inspect, fix, replay.
5. Trade-off: more state, more alerts.

### Case variations
- **"The provider is down for an hour, so every job fails."**
  > Backoff alone still lets every job burn its attempts. I put a circuit breaker around the provider, so workers pause instead of failing jobs, and attempts are saved for real errors.
- **"A worker crashes in the middle of a job."**
  > Its claim has a lease. When the lease runs out, a recovery query puts the job back in the queue and another worker takes it. The consumer already recorded the message key, so the email is not applied twice.
- **"We use BullMQ instead of a database table."**
  > Same ideas: attempts, exponential backoff, and a failed set you can retry from. There is no dead-letter queue built in, so I move jobs that fail for good to a separate queue myself, and mark permanent errors as unrecoverable.
  > Unverified: needs Redis to run BullMQ.
- **"We are on RabbitMQ or SQS."**
  > RabbitMQ: reject without requeue and route to a dead-letter exchange. SQS: a redrive policy with a maximum receive count, then a dead-letter queue.
  > Unverified: needs RabbitMQ and SQS.

### Follow-up questions
- **Why jitter?** Jobs that failed together would retry together and hit the provider in synchronized waves. I keep half the delay fixed and randomize the other half, so delays still grow but spread out.
- **How do two workers avoid taking the same job?** Each worker claims one ready row in a single statement that skips locked rows, marks it running, and sets a lease. The claim commits at once, so no transaction stays open during the work.
- **How do you replay a dead letter?** In one transaction, reset the job to queued with zero attempts and delete the dead-letter row. Replay after fixing the cause, not in a loop.
- **Optional: senior. Why a lease, if the database already locks the row?** The row lock lasts only as long as the claim's transaction, which is short on purpose. Holding a transaction open during an email call ties up a connection and holds back vacuum. The lease is the long-lived claim, and a recovery query requeues jobs whose lease ran out. The cost: a slow but alive worker can lose its job, so the lease must outlive the slowest normal run, and the consumer must be idempotent.

### Common wrong answers and red flags
- Retrying every error the same way, including a bad address.
- A fixed retry delay, or exponential backoff with no jitter.
- No max attempts, or a dead-letter table nobody watches.
- Holding a database transaction open while calling the provider. Lesson 114's outbox relay does this. Claim, commit, then call.
- Assuming retries are safe without an idempotent consumer.
- Stuck-job recovery that requeues every running job, ignoring the lease, so live work gets stolen.

### Numbers to quote
In a local test with two workers, a job whose provider was down stopped after five attempts with retry delays in ranges that doubled from 20 to 40 milliseconds up to 160 to 320, a bad address went to dead letters after one attempt, and all 40 other jobs finished once each before the failing job gave up.

### Code sketch
```js
// pool is a pg Pool; worker is this worker's name; leaseMs is how long a claim lasts
const { rows: [job] } = await pool.query(`
  UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = $1,
    locked_until = clock_timestamp() + make_interval(secs => $2 / 1000.0)
  WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_at <= clock_timestamp()
              ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
  RETURNING *`, [worker, leaseMs]);
// Stuck-job recovery, run on a timer: only jobs whose lease ran out go back to the queue.
await pool.query(`UPDATE jobs SET status = 'queued', locked_by = NULL
  WHERE status = 'running' AND locked_until < clock_timestamp()`);
```

```js
// pool is a pg Pool; PermanentError is an Error subclass; moveToDeadLetters copies the row and marks it dead in one transaction
const backoff = (attempt) => {                                   // exponential, half fixed, half random
  const d = Math.min(40 * 2 ** (attempt - 1), 30_000);
  return Math.round(d / 2 + Math.random() * (d / 2));
};
async function fail(job, worker, err) {
  if (err instanceof PermanentError || job.attempts >= job.max_attempts) return moveToDeadLetters(job, err);
  await pool.query(`UPDATE jobs SET status = 'queued', locked_by = NULL, last_error = $3,
    run_at = clock_timestamp() + make_interval(secs => $2 / 1000.0) WHERE id = $1 AND locked_by = $4`,
    [job.id, backoff(job.attempts), err.message, worker]);
}
```

Verified by [verify-q2.mjs](code/queues/verify-q2.mjs)

### Source
Lessons 114, 75, 113.
