# 10. Queues and scheduled jobs

> **Remember this**
> 1. A cron inside the app runs on every instance. Three instances means the job runs three times.
> 2. A lock stops two runs at the same moment. A run key, saved once per job and time slot, also stops a run that starts late or is retried.
> 3. Build the run key from the time the job was scheduled for, never from the current clock.
> 4. Retries need limits: a maximum number of attempts, waits that grow with some randomness, no retries for errors that can never succeed, and a dead-letter table you can replay from.
> 5. A job can be delivered more than once, so every worker must be safe to run twice. If a worker crashes, its job comes back when its lease runs out.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Cron | A schedule written as a time pattern, such as "every day at eight", that starts a job at those times. |
| Scheduled job | Work that runs because the clock says so, not because a user asked for it. |
| Instance | One running copy of the app. Scaling to three servers means three instances. |
| Slot | The exact time a scheduled run was meant for, such as today at eight o'clock. |
| Advisory lock | A Postgres lock on a name or number you choose, not on a row. Only one session can hold it at a time. |
| Run key | A row that records "this job already ran for this slot". A unique constraint allows only one such row. |
| Unique constraint | A database rule that rejects a second row with the same values, so only one insert can win. |
| Idempotent | Safe to run more than once. Running it twice has the same effect as running it once. |
| Idempotency key | A unique value sent with a request, so the receiver can spot a repeat and ignore it. |
| Outbox table | A table where you write "messages to send" in the same transaction as your data. A separate sender sends them later. |
| Job queue | A list of work waiting to be done, often a database table or a Redis structure. |
| Worker | A process that takes jobs from the queue and does them. |
| Retry | Trying a failed job again later. |
| Exponential backoff | Waiting longer before each retry, for example doubling the wait every time. |
| Jitter | A random part added to the wait, so jobs that failed together do not all retry at the same moment. |
| Permanent vs temporary error | A permanent error, like a bad email address, will never succeed. A temporary one, like a timeout, may succeed on a later try. |
| Dead-letter table | Where jobs go after they fail for good, with their last error, so a person can inspect and replay them. |
| Lease | A time limit on a worker's claim on a job. If the worker does not finish in time, the job goes back to the queue. Message brokers call this a visibility timeout. |
| At-least-once delivery | Every job is promised to run, but it may run more than once, for example after a crash. |
| Skip locked | A database option that lets a worker pass over rows another worker has locked, instead of waiting for them. |

| # | Scenario | Tag |
|---|---|---|
| Q1 | [A daily billing email goes out three times after scaling to three servers](#q1-a-daily-billing-email-goes-out-three-times-after-scaling-to-three-servers) | Must know |
| Q2 | [A notification job fails forever and blocks the queue](#q2-a-notification-job-fails-forever-and-blocks-the-queue) | Likely |

---

## Q1. A daily billing email goes out three times after scaling to three servers
**Tag: Must know**

### Before you speak
- **Today:** the billing job is a cron inside the Node app. Every running copy of the app, called an instance, has its own timer. With one instance, it ran once a day.
- **What goes wrong:** after scaling to three instances, three timers fire at the same moment, and each one emails every customer. Nothing tells an instance that another copy is already doing the job.
- **Fix, part one:** let only one instance do the work. Either move the schedule out of the app into one scheduler, or have each instance try a database lock. The instance that gets the lock runs the job. The others skip.
- **Fix, part two:** a lock only protects the moment it is held. A slow instance can start after the winner finished and let go, and run everything again. So I also save a run key: the job name plus the scheduled slot, in a table with a unique constraint. Only one insert can succeed, and any later run finds the key and stops.
- **Why the slot and not the clock:** instances fire a few milliseconds apart. A key built from the current time would be different on each one, so every instance would win.
- **The trade-off to mention:** an extra table and a little more code, in exchange for exactly one email per customer per day.
- **Terms:** an advisory lock is a Postgres lock on a name you pick, not on a row. Idempotent means running something twice has the same effect as running it once.

### Scenario
"Our SaaS app sends a daily billing summary from a cron inside the Node app. After we scaled to three instances, customers started getting three emails every morning. How do you make the job run once?"

### Questions to ask back
- **Can the schedule move out of the app, to the platform's scheduler or one scheduler service?** Then only one trigger fires. I still keep the run key, because platform schedulers can sometimes fire twice.
- **If a day is missed, must it still be sent later?** Then I need catch-up logic that walks through the missed slots, instead of just skipping them.
- **How long does the job take?** If it is long, the lock must last for the whole run, or a second instance may start halfway through.
- **Does the email provider accept an idempotency key?** If yes, I send the run key plus the customer id as the key, so even a crash right after sending cannot send twice.

### Spoken answer
> Each instance runs its own copy of the cron, so all of them fire at the same moment. I would fix it in layers. First, only one instance should do the work. I either move the schedule to one place, or each instance tries a database lock and the others skip. A lock alone is not enough, because a slow instance can start after the winner let go. So I also record a run key, the job name plus the scheduled slot, with a unique rule. Only one insert can win, and a late or retried run finds the key and stops. The key comes from the scheduled time, not the current clock. Each email is keyed by customer and slot, so it is safe to retry. The trade off is an extra table and a little more code, in exchange for one email per customer per day.

### Say it in 5 beats
1. Every instance fires its own cron.
2. One runner: scheduler or database lock.
3. Run key: job name plus slot.
4. Late or retried runs find it, stop.
5. Trade-off: extra table, one email each.

### Case variations
- **"We moved the job to a Kubernetes CronJob. Are we done?"**
  > Not fully. The Kubernetes docs say a CronJob starts a run about once per slot, and sometimes twice. I keep the run key, built from the scheduled time that the run carries, so a second run does nothing.
- **"The instance doing the work crashes halfway through."**
  > The run key and the email rows are saved in one transaction, so a crash undoes both. The lock is released when the database connection drops. The next attempt runs the slot cleanly from the start.
- **"We would rather use Redis for the lock."**
  > The idea is the same. I set the key only if it does not exist yet, give it an expiry longer than the job, and store a unique token so an instance only deletes its own lock. I still keep the run key in the database, because a Redis lock expires and forgets.
  > Unverified: needs Redis. The local script uses a PostgreSQL advisory lock.
- **"The job is slow and sometimes runs into the next slot."**
  > The next slot has a different run key, so both runs can happen at once. If that is a problem, I add a second lock on the job name alone, and alert when a run is skipped because of it.

### Follow-up questions
- **Why not just check "did we run today?" before running?** Check then insert is a race, meaning the result depends on timing. All three instances can read "no" at the same moment, and all three run. Only a unique constraint or a lock picks exactly one winner.
- **Why build the run key from the scheduled slot?** Instances fire a few milliseconds apart. Keys built from the current time would all be different, so every insert would succeed.
- **What about leader election?** Leader election means one instance holds a renewable lease and runs every schedule. If it dies, another takes over only after the lease runs out. A leader that was paused can also still believe it leads, so I keep the run key anyway.
- **Optional: senior. The job sends the emails, then crashes before recording the run. What now?** I avoid that order. The job only writes email rows to an outbox table, a list of messages waiting to be sent, in the same transaction as the run key. A crash rolls back both, so the retry starts clean. A separate sender works through the outbox later and passes customer plus slot as the provider's idempotency key, so a crash after a send does not repeat it.
  > Unverified: needs a real email provider that honours idempotency keys. The local script covers only the database side.

### Common wrong answers and red flags
- "Keep a flag in memory." Memory belongs to one process, so the other instances never see it.
- A lock with no run key. A run that starts late, after the lock was released, sends every email again.
- A run key built from `Date.now()`. Instances a few milliseconds apart get different keys.
- A Redis lock with no expiry, or released with a plain `DEL`, which can delete another instance's lock.
- Trusting a platform scheduler to run exactly once. Kubernetes itself only promises "approximately once".

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

### Before you speak
- **Today:** a worker takes a job from the queue and tries to send the email. On any error, it puts the job straight back to try again. There is no limit on attempts and no real wait between them.
- **What goes wrong:** a job with a bad email address can never succeed. It fails, retries and fails again forever. It hammers the provider, and other notifications wait behind it.
- **Fix, limits:** give every job a maximum number of attempts. Wait longer before each retry, which is exponential backoff, and add a random part, called jitter, so many failed jobs do not retry at the same instant.
- **Fix, sort the errors:** a permanent error, like a bad address, fails at once. A temporary error, like a timeout or an outage, is retried. A job that runs out of attempts moves to a dead-letter table with its last error, so someone can inspect it and replay it after a fix.
- **Fix, never block:** workers skip rows another worker has locked, so one job never holds up the rest. Each claim has a lease, a time limit, so a crashed worker's job goes back to the queue.
- **Why idempotent matters:** with leases and retries, a job can run twice. That is called at-least-once delivery. The worker records each message key and skips repeats.
- **The trade-off to mention:** more state to manage, and a dead-letter table that someone must watch through alerts.

### Scenario
"Our notification service sends emails from a job queue. One job has a bad email address, and it keeps failing and retrying, hammering the provider while other notifications pile up behind it. How would you redesign the retry handling?"

### Questions to ask back
- **Which errors can never succeed?** A bad address, or a request the provider rejects, is permanent. It should skip retries and go straight to dead letters.
- **Does the provider rate limit us, or tell us when to retry?** If it sends a retry hint, I follow that instead of my own backoff.
- **Must one user's notifications arrive in order?** Then each user's jobs run one at a time, which limits how much can run in parallel.
- **Who looks at failed jobs?** That decides where the alerts go and who owns the replay tool.

### Spoken answer
> I would stop the endless retries in four ways. Every job gets a maximum number of attempts. Each retry waits longer than the last, with a little random jitter, so failed jobs do not hit the provider in waves. I split errors. A bad address is permanent, so it fails at once. A timeout or an outage is temporary, so it retries. A job that runs out of attempts moves to a dead letter table with its last error, where someone can inspect it and replay it after a fix. Workers skip rows another worker has locked, so one stuck job never blocks the rest. Each claim has a lease, so a crashed worker's job comes back. Since a job can then run twice, the worker records each message key and skips repeats. The trade off is more state to manage, and alerts to watch on the dead letters.

### Say it in 5 beats
1. Cap the attempts per job.
2. Growing backoff with random jitter.
3. Permanent errors fail at once.
4. Dead letters: inspect, fix, replay.
5. Trade-off: more state, more alerts.

### Case variations
- **"The provider is down for an hour, so every job fails."**
  > Backoff alone still lets every job use up its attempts during the outage. I put a circuit breaker around the provider, a switch that stops calling it for a while after many failures. Workers then pause instead of failing jobs, so attempts are saved for real errors.
- **"A worker crashes in the middle of a job."**
  > Its claim has a lease. When the lease runs out, a recovery query puts the job back in the queue, and another worker takes it. The worker already recorded the message key, so the email is not applied twice.
- **"We use BullMQ instead of a database table."**
  > The same ideas apply: attempts, growing backoff, and a failed set you can retry from. There is no dead-letter queue built in, so I move jobs that fail for good to a separate queue myself, and mark permanent errors as unrecoverable.
  > Unverified: needs Redis to run BullMQ.
- **"We are on RabbitMQ or SQS."**
  > The tools differ, but the idea is the same. On RabbitMQ, I reject the message without putting it back, and route it to a dead-letter exchange. On SQS, I set a redrive policy with a maximum receive count, and messages past it go to a dead-letter queue.
  > Unverified: needs RabbitMQ and SQS.

### Follow-up questions
- **Why add jitter?** Jobs that failed together would retry together and hit the provider in waves. I keep half the wait fixed and make the other half random, so the waits still grow but spread out.
- **How do two workers avoid taking the same job?** Each worker claims one ready row in a single statement that skips rows other workers have locked, marks it running, and sets a lease. That claim commits at once, so no transaction stays open while the email is sent.
- **How do you replay a dead letter?** In one transaction, set the job back to queued with zero attempts and delete the dead-letter row. Replay only after fixing the cause, never in an automatic loop.
- **Optional: senior. Why a lease, if the database already locks the row?** The row lock only lasts as long as the claim's transaction, which is short on purpose. Keeping a transaction open during an email call ties up a connection and holds back vacuum, the database's background cleanup. The lease is the long-lived claim, and a recovery query requeues jobs whose lease ran out. The cost is that a slow but alive worker can lose its job, so the lease must be longer than the slowest normal run, and the worker must be idempotent.

### Common wrong answers and red flags
- Retrying every error the same way, including a bad address that can never work.
- A fixed retry delay, or growing backoff with no jitter.
- No maximum attempts, or a dead-letter table nobody watches.
- Holding a database transaction open while calling the email provider. Claim the job, commit, then call the provider.
- Assuming retries are safe when the worker is not idempotent.
- Stuck-job recovery that requeues every running job and ignores the lease, so jobs that are still being worked on get taken away.

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
