---
title: "Scheduled Jobs"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Scheduled Jobs

*28 min read · Updated 12 Oct 2026 · Topic 113 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and node-cron 4.6.0, BullMQ 6.3.13, ioredis 6.0.0, Redis 8.0.5, pg 8.23.1, PostgreSQL 18.4 (embedded-postgres, no Docker), cron-parser 5.10.2, kubeconform 0.8.0 (Kubernetes 1.36.0 schemas)

---

## Say it in 30 seconds

A scheduled job is work that starts because the clock matched a rule, not because a user called you. The rule is usually a cron expression: minute, hour, day of month, month, and day of week. A scheduler waits until that slot arrives and starts the job. It exists for reports, cleanups, partner syncs, and reminders. The trade-off is duplicates. Every copy of the app computes the same slot, so a second start has to notice the job already ran.

## Why it matters

Most backends have work that nobody asks for: a nightly report, a cleanup of expired sessions, a partner sync every ten minutes, a reminder at 09:00 in the customer's time zone. The ways that goes wrong are different from request handling.

It runs once per instance. You scale from one process to three, every process schedules the same cron, and every customer gets three reports. Example 2 shows that.

It runs zero times. The only instance that held the scheduler was restarting at 03:00, or the job was scheduled in an hour that does not exist when the clocks jump forward.

It runs twice for the same slot. A lock stops two runs from overlapping, and a slow instance can still start after the first one has finished and released the lock (Example 5).

It runs at the wrong time. The server is in UTC, the business is in New York, and twice a year the offset between them changes.

None of this shows up on a laptop with one process. This lesson shows each failure with a real run, then the fix.

## The concept, simply

A schedule is a rule that produces points in time: every day at 03:15, or every 10 minutes from 08:00 to 18:59 on weekdays. Each point is a slot. A scheduler watches the clock and, when a slot arrives, starts the job for that slot.

The rule is almost always a cron expression. Five fields: minute, hour, day of month, month, day of week. Six fields when the library adds seconds at the front.

text

```
 ┌───────────── second (only in 6-field expressions: node-cron, BullMQ)
 │ ┌─────────── minute        0-59
 │ │ ┌───────── hour          0-23
 │ │ │ ┌─────── day of month  1-31
 │ │ │ │ ┌───── month         1-12 or jan-dec
 │ │ │ │ │ ┌─── day of week   0-7 or sun-sat (0 and 7 are Sunday)
 │ │ │ │ │ │
 0 15 3 * * *     every day at 03:15:00
 */10 8-18 * * 1-5   (5 fields) every 10 minutes, 08:00-18:50, Monday to Friday
```

Where the scheduler lives decides most of its behaviour:

| Scheduler | Who watches the clock | Several app instances | A restart at the slot time |
|---|---|---|---|
| `node-cron` inside your app | Each Node process | Every process fires (Example 2) | That process misses the slot |
| BullMQ job scheduler | Redis stores the next job; any worker runs it | One job per slot for the whole queue (Example 6) | The delayed job waits in Redis and runs when a worker is back |
| OS cron (`crontab`) | The `cron` daemon on one machine | One per machine that has the crontab | The daemon misses it if the machine is down |
| Kubernetes CronJob | The CronJob controller in the cluster | One Job per slot, "approximately" (Kubernetes docs) | Late Jobs still start, within `startingDeadlineSeconds` |

The rule that ties them together: a slot can be started more than once, so the job must make a second start do nothing. You do that with a run key, a record of "job X for slot T" that only one run can claim.

## How it works

What an in-process scheduler such as node-cron does from `schedule()` to the run:

1. It parses the expression into the allowed values of each field and rejects values that do not exist (minute `61`, hour `24`).
2. It takes the current instant, converts it to wall-clock time in the task's `timezone` (or the system zone if none is given), and finds the next wall-clock time that matches every field.
3. It converts that wall-clock time back to an absolute instant. This is where daylight saving time matters: a wall-clock time can exist twice or not at all.
4. It sets a timer for the gap. node-cron 4 calculates the delay and sleeps until then (changed in v4; v3 checked the expression every second, per its migration guide).
5. When the timer fires, it calls your function with a context whose `date` is the **scheduled** instant, not the moment the callback started (Example 1 prints it).
6. It computes the next slot and goes back to step 4. If your function is still running and `noOverlap` is set, the new slot is skipped and an `execution:overlap` event is emitted.

node-cron 4.6.0 is a TypeScript rewrite and needs Node.js 20 or newer. The options you will actually use are `timezone`, `noOverlap`, and `logger`, plus `task.execute()`, `destroy()`, and `getNextRuns(n)`. `ctx.date` is the scheduled instant, not the moment the callback started. The v3 options that were removed, and the `distributed` flag, are in Good to know.

BullMQ job schedulers store one scheduler under an id in Redis. `queue.upsertJobScheduler(id, { pattern or every, tz }, template)` updates that id instead of adding a second scheduler, so every instance can call it on boot. The scheduler keeps one delayed job for the next slot. Its job id is `repeat:<schedulerId>:<slot in ms>`, so one slot cannot produce two jobs. The docs add that "the scheduler will only generate new jobs when the last job begins processing", so a busy queue gets fewer runs than the pattern asks for. In 6.3.13, `queue.add` with a `repeat` option does not throw. It adds one plain job and no scheduler (Example 6). Install `ioredis` yourself. v6 no longer installs it for you. The version it was added, and the removed method names, are in Good to know.

**OS cron.** On Ubuntu 26.04 (`cron` 3.0pl1-200ubuntu1), `crontab -e` edits a per-user file and the `cron` daemon checks all crontabs once a minute. Facts from `man 5 crontab` and `man 8 cron` on that system:

- Five time fields, then the command. `/etc/crontab` has a user name between them.
- `name = value` lines set environment variables, with no `$VAR` expansion: `PATH=$HOME/bin:$PATH` "will not work as you might expect". `SHELL` defaults to `/usr/bin/sh`, and `HOME` and `LOGNAME` come from `/etc/passwd`. Your login shell's `PATH` and `nvm` setup are not there, so use absolute paths (`/usr/local/bin/node`).
- A `%` in the command becomes a newline, and everything after the first `%` is sent to the command's stdin. Write `date +\%Y-\%m`.
- If **both** day of month and day of week are restricted, the job runs when **either** matches: `30 4 1,15 * 5` runs on the 1st, the 15th and every Friday.
- The daemon runs in one time zone for all crontabs. `TZ=` in a crontab only changes the environment of the commands, not when they run.
- On a DST change of less than 3 hours, jobs at a fixed time inside the skipped hour "will be run soon after the change", and jobs inside a repeated hour "will not be re-run". Jobs with `*` in the minute or hour field just follow the new clock.

This lesson does not install or list a crontab: `crontab file` replaces your real crontab, and even `crontab -l` reads it. Example 7 checks a crontab file with a parser library instead, which is also what you would do in CI.

**Kubernetes CronJob (stable since Kubernetes 1.21; `timeZone` stable since 1.27).** A CronJob creates a Job for each slot, and the Job creates Pods. The fields that control scheduling, from the Kubernetes CronJob page:

- `schedule`: a 5-field cron expression. `CRON_TZ=` or `TZ=` inside it is not supported, and the docs say Kubernetes will fail to create the resource.
- `timeZone`: an IANA name such as `America/New_York`. Without it, "the kube-controller-manager interprets schedules relative to its local time zone".
- `concurrencyPolicy`: `Allow` (the default) lets Jobs overlap, `Forbid` skips a slot while the previous Job still runs, `Replace` stops the running Job and starts the new one. It "only applies to the Jobs created by the same CronJob".
- `startingDeadlineSeconds`: if a Job could not be created within this many seconds of its slot (controller down, `Forbid` blocking), that slot is skipped. Unset means no deadline. The docs warn that values under 10 seconds may never schedule, because the controller checks every 10 seconds, and that a controller that finds more than 100 missed slots does not start the Job.
- The docs also say a CronJob creates a Job "approximately once" per slot: "there are certain circumstances where two Jobs might be created, or no Job might be created", so "the Jobs that you define should be idempotent". Since Kubernetes 1.32 each Job carries the annotation `batch.kubernetes.io/cronjob-scheduled-timestamp` with the slot time.

Example 10 validates a CronJob with kubeconform. Lesson 105 ([Kubernetes for Node developers](105-kubernetes-for-node-developers.md)) covers Deployments, Jobs and running manifests against a cluster.

**Duplicate runs across instances.** An in-process scheduler has no idea that other copies of the app exist. Three replicas compute the same next slot from the same expression, so they all fire within milliseconds of each other:

text

```
            slot 03:00:00.000Z (same expression, same clock)
no guard    A ──fire──► send report
            B ──fire──► send report          3 replicas = 3 reports
            C ──fire──► send report

lock/run    A ──fire──► SET lock:daily-report:<slot> NX → OK      ──► send report
key per     B ──fire──► SET lock:daily-report:<slot> NX → (nil)   ──► skip
slot        C ──fire──► SET lock:daily-report:<slot> NX → (nil)   ──► skip
```

There are three ways to get one run per slot:

- **A lock around the run** (Examples 3 and 4). Each instance tries to take a lock named after the job (and the slot). One wins and runs, the others skip. With Redis, use the token pattern from [lesson 100](100-caching-with-redis.md): a unique token, `SET key token NX PX ttl`, and a Lua compare-and-delete to release, so an instance whose lock has expired cannot delete someone else's lock. With PostgreSQL, `pg_try_advisory_lock(key)` returns `true` to one session and `false` to the rest without waiting. A session-level advisory lock is "held until explicitly released or the session ends" (PostgreSQL docs), so a crashed process loses its lock as soon as its connection closes, where a Redis lock stays until its TTL runs out.
- **A run key** (Example 5). Insert a row keyed by (job, slot) before the work. The primary key lets exactly one insert succeed. This also stops a *later* duplicate, which a released lock does not.
- **Leader election.** The instances elect one leader, and only the leader runs schedules. The leader holds a lease, such as a Redis key with a TTL that it keeps renewing, a long-lived PostgreSQL session holding an advisory lock, or a Kubernetes `Lease` object, and another instance takes over when the lease is not renewed. This is not run in this lesson. Two things to know: failover takes as long as the lease, so slots in that window are late or missed, and a leader that pauses (a long GC, a frozen VM) can still believe it leads after its lease went to someone else. So the jobs still need run keys. node-cron 4.6.0's `distributed: true` is a small version of this idea: the default coordinator reads `NODE_CRON_RUN=true|false` to pick one runner per instance, and `cron.setRunCoordinator()` lets you plug in a shared lock instead. A test run printed the key it passes as `x:2026-10-12T17:08:21.000Z` (task name plus slot).

**Idempotent job design.** Locks control who runs *now*. Idempotency decides what happens when a slot runs *again*: after a crash, a retry, a second Job from Kubernetes, or a slow instance. The design is the same as the idempotent consumer in [lesson 114](114-message-queues-async-jobs.md):

1. Compute the run key from the **scheduled** slot, never from `Date.now()`: `daily-report@2026-10-13T03:00:00.000Z`. node-cron gives you `ctx.date`; BullMQ puts the slot in the job id; a Kubernetes Job has the scheduled-timestamp annotation; a script started by OS cron can recompute it with a parser (Example 7).
2. **Claim**: insert `(job, slot, 'processing', claimed_by)`. If the row exists and is `done`, stop. If it is `processing` and younger than the lease, another run owns it, so stop. If it is older than the lease, its owner crashed, so take it over.
3. **Work.** If the work throws, delete your claim so a retry can start again at step 2.
4. **Done**: update the row to `done`, only after the work succeeded.
5. For side effects outside your database (an email, a payment), pass the run key on as the provider's idempotency key, because a crash between the work and step 4 still repeats the work.

**Time zones and daylight saving time.** A cron expression describes wall-clock time. On 1 November 2026, `America/New_York` falls back from EDT (UTC−4) to EST (UTC−5) at 02:00, so 01:00–01:59 happens twice. On 8 March 2026 it springs forward at 02:00, so 02:00–02:59 does not exist (Example 8 prints both transitions from `Intl`). Each tool resolves this differently, and Example 8 shows them side by side:

| Case | node-cron 4.6.0 | cron-parser 5.10.2 and BullMQ 6.3.13 | Debian/Ubuntu cron (`man 8 cron`) |
|---|---|---|---|
| Daily `30 1 * * *` on the fall-back day | Once (01:30 EDT) | Once (01:30 EDT) | Not re-run in the repeated hour |
| `*/30 * * * *` through the repeated hour | 01:00, 01:30 EDT, then 02:00 EST: the second 01:xx is skipped | 01:00, 01:30 EDT, 01:00, 01:30 EST, 02:00 EST: both passes run | Wildcard hour: follows the clock |
| Daily `30 2 * * *` on the spring-forward day | Skipped that day | Moved to 03:30 EDT | Run "soon after the change" |

BullMQ computes pattern-based slots with cron-parser (it pins 5.10.1 and calls `CronExpressionParser.parse(pattern, { …opts, currentDate })` in its `defaultRepeatStrategy`), which is why the two columns match. If a job must run once per day no matter what, schedule it at a time that is never inside a transition (not between 01:00 and 03:00 in US zones), or run it in `Etc/UTC` and convert for display.

## Code examples

**Example 1 — node-cron 4: validate, schedule with seconds, `noOverlap`, events and `destroy()`.**

bash

```
$ npm install node-cron@4.6.0
```

javascript

```
import cron from 'node-cron';

// 5 fields = minute-level; 6 fields = the first one is seconds
console.log('valid "*/2 * * * * *":', cron.validate('*/2 * * * * *'));
console.log('valid "61 * * * *":   ', cron.validate('61 * * * *'));
console.log(cron.validateDetailed('61 * * * *').errors);

let first;
const rel = (d) => `t=${(d - (first ??= d)) / 1000} s`;   // seconds after the first scheduled run
const logger = {                                     // per-task logger instead of the coloured default
  info: () => {}, debug: () => {},
  warn: (m) => console.log(`  node-cron warn: ${m}`),
  error: (m) => console.log(`  node-cron error: ${m}`),
};

let n = 0;
const task = cron.schedule('*/2 * * * * *', async (ctx) => {
  n += 1;
  console.log(`run ${n} for ${rel(ctx.date)}`);       // ctx.date = the scheduled instant
  await new Promise((r) => setTimeout(r, 3000));       // 3 s of work on a 2 s schedule
}, { name: 'report', noOverlap: true, timezone: 'Etc/UTC', logger });

task.on('execution:overlap', (ctx) => console.log(`skipped ${rel(ctx.date)}: previous run still busy`));

const [a, b, c] = task.getNextRuns(3);
console.log('status:', task.getStatus(), '| next 3 runs are', (b - a) / 1000, 's and', (c - b) / 1000, 's apart');

task.on('execution:finished', async () => {
  if (n < 3) return;
  await task.destroy();                                 // stop for good after the third run
  console.log('status:', task.getStatus(), '| runs:', n);
});

// Real output (Node v24.19.0, node-cron 4.6.0):
//   valid "*/2 * * * * *": true
//   valid "61 * * * *":    false
//   [
//     {
//       field: 'minute',
//       value: '61',
//       message: '61 is a invalid expression for minute'
//     }
//   ]
//   status: idle | next 3 runs are 2 s and 2 s apart
//   run 1 for t=0 s
//   skipped t=2 s: previous run still busy
//     node-cron warn: task still running, new execution blocked by overlap prevention!
//   run 2 for t=4 s
//   skipped t=6 s: previous run still busy
//     node-cron warn: task still running, new execution blocked by overlap prevention!
//   run 3 for t=8 s
//   skipped t=10 s: previous run still busy
//     node-cron warn: task still running, new execution blocked by overlap prevention!
//   status: destroyed | runs: 3
```

Each run takes 3 s, so the slot 2 s later finds it busy and is skipped, not queued. Without `noOverlap`, node-cron starts the next run while the previous one is still going. The message text ("a invalid expression") is node-cron's own.

**Example 2 — three instances, one schedule, three reports.**

The script below is one app instance. It schedules a "daily report" every 5 seconds (so the demo is quick) and wraps the job in one of four guards chosen by `MODE`. A launcher starts three copies, A, B and C, lets two slots pass and prints what each one did. The same files are used in Examples 3 to 5. They need Redis and PostgreSQL; this run used Redis 8.0.5 on port 7301 and PostgreSQL 18.4 on port 7302.

bash

```
$ npm install node-cron@4.6.0 ioredis@6.0.0 pg@8.23.1
$ export REDIS_URL=redis://127.0.0.1:7301 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7302/app
```

javascript

```
// setup-db.mjs
// One row per (job, schedule slot): the run key. Same claim -> work -> done states as lesson 114.
import pg from 'pg';
const db = new pg.Client(process.env.DATABASE_URL);
await db.connect();
await db.query(`DROP TABLE IF EXISTS job_runs;
  CREATE TABLE job_runs (
    job        text        NOT NULL,
    slot       timestamptz NOT NULL,                 -- the scheduled instant, not "now"
    status     text        NOT NULL CHECK (status IN ('processing', 'done')),
    claimed_by text        NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job, slot)
  )`);
console.log('job_runs ready');
await db.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   job_runs ready
```

javascript

```
// report-instance.mjs
// One app instance. Run three of these: each schedules the same job.
// MODE=none | redis | pg | runkey   INSTANCE=A|B|C   LATE_MS=<delay before the job starts>
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import pg from 'pg';

const { MODE = 'none', INSTANCE = '?', LATE_MS = '0' } = process.env;
const redis = MODE === 'redis' ? new Redis(process.env.REDIS_URL) : null;
const db = MODE === 'pg' || MODE === 'runkey' ? new pg.Client(process.env.DATABASE_URL) : null;
await db?.connect();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${INSTANCE}] ${msg}`);

async function sendDailyReport(slot) {        // the job itself: 1 s of work
  const late = ((Date.now() - Date.parse(slot)) / 1000).toFixed(1);
  log(`SENT report for slot ${slot} (+${late} s)`);
  await sleep(1000);
}

// (a) Redis lock: unique token, SET NX PX, Lua compare-and-delete (lesson 100)
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
async function withRedisLock(slot, fn) {
  const key = `lock:daily-report:${slot}`;
  const token = randomUUID();
  if (!(await redis.set(key, token, 'PX', 30_000, 'NX'))) return log(`skip slot ${slot}: lock held by another instance`);
  try { await fn(); } finally { await redis.eval(RELEASE, 1, key, token); }
}

// (b) PostgreSQL advisory lock: session-level, so lock and unlock on the SAME connection
async function withAdvisoryLock(slot, fn) {
  const { rows } = await db.query(`SELECT pg_try_advisory_lock(hashtext('daily-report')) AS ok`);
  if (!rows[0].ok) return log(`skip slot ${slot}: advisory lock held by another session`);
  try { await fn(); } finally { await db.query(`SELECT pg_advisory_unlock(hashtext('daily-report'))`); }
}

// (c) Run key per schedule slot: claim -> work -> done (same lifecycle as lesson 114)
async function withRunKey(slot, fn) {
  const claimId = randomUUID();
  const claim = await db.query(
    `INSERT INTO job_runs (job, slot, status, claimed_by) VALUES ('daily-report', $1, 'processing', $2)
     ON CONFLICT (job, slot) DO UPDATE SET claimed_by = $2, claimed_at = now()
       WHERE job_runs.status = 'processing' AND job_runs.claimed_at < now() - interval '10 minutes'
     RETURNING slot`, [slot, claimId]);
  if (claim.rowCount === 0) return log(`skip slot ${slot}: run key already claimed or done`);
  try { await fn(); } catch (err) {
    await db.query(`DELETE FROM job_runs WHERE job = 'daily-report' AND slot = $1 AND claimed_by = $2 AND status = 'processing'`, [slot, claimId]);
    throw err;
  }
  await db.query(`UPDATE job_runs SET status = 'done' WHERE job = 'daily-report' AND slot = $1 AND claimed_by = $2`, [slot, claimId]);
}

const guard = { none: (slot, fn) => fn(), redis: withRedisLock, pg: withAdvisoryLock, runkey: withRunKey }[MODE];

const task = cron.schedule('*/5 * * * * *', async (ctx) => {
  const slot = ctx.date.toISOString();      // the scheduled instant, identical on every instance
  await sleep(Number(LATE_MS));             // simulates a slow start or a clock that runs behind
  await guard(slot, () => sendDailyReport(slot));
}, { name: 'daily-report', timezone: 'Etc/UTC' });

process.on('SIGTERM', async () => {
  await task.destroy();
  await redis?.quit();
  await db?.end();
  process.exit(0);
});
```

javascript

```
// run-three.mjs
// Starts instances A, B, C with the same MODE, lets two 5-second slots pass, then stops them.
// usage: node run-three.mjs <mode> [lateMsForC]
import { spawn } from 'node:child_process';

const [mode = 'none', lateC = '0'] = process.argv.slice(2);
const lines = [];
const kids = ['A', 'B', 'C'].map((name) => {
  const env = { ...process.env, MODE: mode, INSTANCE: name, LATE_MS: name === 'C' ? lateC : '0' };
  const child = spawn(process.execPath, ['report-instance.mjs'], { env });
  child.stdout.on('data', (d) => lines.push(...d.toString().trim().split('\n')));
  child.stderr.pipe(process.stderr);
  return child;
});

// Stop the children 2.6 s after the second fire; skip a slot that is too close for them to boot
let msToNextSlot = 5000 - (Date.now() % 5000);
if (msToNextSlot < 1500) msToNextSlot += 5000;
setTimeout(async () => {
  for (const k of kids) k.kill('SIGTERM');
  await Promise.all(kids.map((k) => new Promise((r) => k.on('exit', r))));
  const key = (l) => `${l.match(/slot (\S+?Z)/)?.[1]} ${l.includes('SENT') ? 0 : 1} ${l}`;  // slot, SENT first, instance
  const order = (a, b) => (key(a) > key(b)) - (key(a) < key(b));
  for (const l of lines.sort(order)) console.log(l);
  const sent = lines.filter((l) => l.includes('SENT')).length;
  console.log(`mode=${mode}: ${sent} reports sent for 2 slots`);
}, msToNextSlot + 5000 + 2600);
```

No guard: every instance fires at the same second and sends the report.

bash

```
$ node setup-db.mjs
job_runs ready
$ node run-three.mjs none
[A] SENT report for slot 2026-10-12T17:20:00.000Z (+0.0 s)
[B] SENT report for slot 2026-10-12T17:20:00.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:00.000Z (+0.0 s)
[A] SENT report for slot 2026-10-12T17:20:05.000Z (+0.0 s)
[B] SENT report for slot 2026-10-12T17:20:05.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:05.000Z (+0.0 s)
mode=none: 6 reports sent for 2 slots
```

The slot timestamps differ on every run; the pattern does not.

**Example 3 — fix (a): a Redis lock per slot with a token and Lua release.**

bash

```
$ node run-three.mjs redis
[C] SENT report for slot 2026-10-12T17:20:10.000Z (+0.0 s)
[A] skip slot 2026-10-12T17:20:10.000Z: lock held by another instance
[B] skip slot 2026-10-12T17:20:10.000Z: lock held by another instance
[C] SENT report for slot 2026-10-12T17:20:15.000Z (+0.0 s)
[A] skip slot 2026-10-12T17:20:15.000Z: lock held by another instance
[B] skip slot 2026-10-12T17:20:15.000Z: lock held by another instance
mode=redis: 2 reports sent for 2 slots
```

Whichever instance reaches Redis first wins (C both times here, but it varies). The lock key includes the slot, so a lock from the previous slot can never block the next one. Lesson 100's caveat still applies: the TTL can expire while a slow job is still running, and a Redis failover can lose a lock that was just granted.

**Example 4 — fix (b): a PostgreSQL advisory lock.**

bash

```
$ node run-three.mjs pg
[A] SENT report for slot 2026-10-12T17:20:20.000Z (+0.0 s)
[B] skip slot 2026-10-12T17:20:20.000Z: advisory lock held by another session
[C] skip slot 2026-10-12T17:20:20.000Z: advisory lock held by another session
[A] SENT report for slot 2026-10-12T17:20:25.000Z (+0.0 s)
[B] skip slot 2026-10-12T17:20:25.000Z: advisory lock held by another session
[C] skip slot 2026-10-12T17:20:25.000Z: advisory lock held by another session
mode=pg: 2 reports sent for 2 slots
```

`hashtext('daily-report')` turns the job name into the integer key the function needs. Each instance uses its own `pg.Client`, because a session-level advisory lock belongs to one connection. With a `pg.Pool` the unlock can run on a different connection than the lock. This run shows what happens then:

javascript

```
// Session-level advisory locks belong to ONE connection. A pool can hand the
// unlock to a different connection than the lock.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
pool.on('connect', (c) => c.on('notice', (n) => console.log(`  server ${n.severity}: ${n.message}`)));

const c1 = await pool.connect();
const c2 = await pool.connect();
const lock = await c1.query(`SELECT pg_try_advisory_lock(42) AS got, pg_backend_pid() AS pid`);
c1.release();                                   // back to the pool, still holding the lock
const unlock = await c2.query(`SELECT pg_advisory_unlock(42) AS released, pg_backend_pid() AS pid`);
c2.release();
console.log(`lock on c1: ${lock.rows[0].got} | unlock on c2: ${unlock.rows[0].released} | same backend: ${lock.rows[0].pid === unlock.rows[0].pid}`);
const held = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 42`);
console.log('advisory lock 42 still held:', held.rows[0].n === 1);

// Fix: a transaction-level lock is released by COMMIT/ROLLBACK on the client that took it
const c = await pool.connect();
await c.query('BEGIN');
const x = await c.query(`SELECT pg_try_advisory_xact_lock(43) AS got`);
/* ... the job's work, inside this transaction ... */
await c.query('COMMIT');
c.release();
const after = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = 43`);
console.log('xact lock 43 got:', x.rows[0].got, '| still held after COMMIT:', after.rows[0].n === 1);
await pool.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//     server WARNING: you don't own a lock of type ExclusiveLock
//   lock on c1: true | unlock on c2: false | same backend: false
//   advisory lock 42 still held: true
//   xact lock 43 got: true | still held after COMMIT: false
```

The unlock returned `false` with only a server WARNING, no error, and the lock stayed held by an idle pooled connection, so the job would never run again until that connection closed. Use a dedicated client, or `pg_try_advisory_xact_lock` inside a transaction (released at `COMMIT` or `ROLLBACK`).

**Example 5 — edge case: a late instance runs the slot again after the lock is released.**

Both locks above prevent *concurrent* runs. They do not prevent a second run that *starts after the first one finished*. Here instance C starts its job 1.5 s late (`LATE_MS=1500`: a long GC pause, a slow cold start, or a clock 1.5 s behind). The winner's job takes 1 s and releases the lock, so C finds it free:

bash

```
$ node run-three.mjs redis 1500
[B] SENT report for slot 2026-10-12T17:20:30.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:30.000Z (+1.5 s)
[A] skip slot 2026-10-12T17:20:30.000Z: lock held by another instance
[B] SENT report for slot 2026-10-12T17:20:35.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:35.000Z (+1.5 s)
[A] skip slot 2026-10-12T17:20:35.000Z: lock held by another instance
mode=redis: 4 reports sent for 2 slots
$ node run-three.mjs pg 1500
[B] SENT report for slot 2026-10-12T17:20:40.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:40.000Z (+1.5 s)
[A] skip slot 2026-10-12T17:20:40.000Z: advisory lock held by another session
[B] SENT report for slot 2026-10-12T17:20:45.000Z (+0.0 s)
[C] SENT report for slot 2026-10-12T17:20:45.000Z (+1.5 s)
[A] skip slot 2026-10-12T17:20:45.000Z: advisory lock held by another session
mode=pg: 4 reports sent for 2 slots
```

The run key remembers the slot after the work is done, so the late start finds the row in state `done` and skips:

bash

```
$ node run-three.mjs runkey 1500
[B] SENT report for slot 2026-10-12T17:20:50.000Z (+0.0 s)
[A] skip slot 2026-10-12T17:20:50.000Z: run key already claimed or done
[C] skip slot 2026-10-12T17:20:50.000Z: run key already claimed or done
[B] SENT report for slot 2026-10-12T17:20:55.000Z (+0.0 s)
[A] skip slot 2026-10-12T17:20:55.000Z: run key already claimed or done
[C] skip slot 2026-10-12T17:20:55.000Z: run key already claimed or done
mode=runkey: 2 reports sent for 2 slots
```

Two ways to fix the Redis version are not releasing the per-slot lock at all (let its TTL, which must be longer than the worst lateness, expire on its own), or recording "done" for the slot. The run key does the second in the database you already trust, and it also handles retries after a crash: a row stuck in `processing` for longer than the lease (10 minutes here) can be taken over, exactly as in lesson 114.

**Example 6 — BullMQ 6 job scheduler: three upserts, one scheduler, one job per slot.**

bash

```
$ npm install bullmq@6.3.13 ioredis@6.0.0
```

javascript

```
import { Queue, Worker } from 'bullmq';

const connection = { host: '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379) };
const queue = new Queue('reports', { connection });

// Three app instances all call upsert on boot with the same scheduler id
await Promise.all([1, 2, 3].map(() =>
  queue.upsertJobScheduler(
    'daily-report',                                       // scheduler id: upsert, not add
    { pattern: '*/2 * * * * *', tz: 'Etc/UTC' },          // cron with seconds; or { every: 2000 }
    { name: 'send-report', data: { to: 'ops@example.com' }, opts: { attempts: 3 } },
  )));
console.log('schedulers:', await queue.getJobSchedulersCount());
const [s] = await queue.getJobSchedulers();
console.log({ key: s.key, pattern: s.pattern, tz: s.tz, next: new Date(s.next).toISOString() });

// Three workers (normally three processes) consume the produced jobs
const seen = [];
let threeDone;
const three = new Promise((r) => { threeDone = r; });
const workers = ['W1', 'W2', 'W3'].map((w) => new Worker('reports', async (job) => {
  seen.push(job.id);
  console.log(`${w} ran ${job.name} id=${job.id}`);
  if (seen.length === 3) threeDone();
}, { connection }));

await three;                                             // three fires, about 6 s
console.log('jobs run:', seen.length, '| distinct ids:', new Set(seen).size);

await queue.removeJobScheduler('daily-report');
console.log('schedulers after remove:', await queue.getJobSchedulersCount());

// v5-style repeatable job: in v6 the repeat option is gone (removed in v6.0.0)
const old = await queue.add('old-style', {}, { repeat: { pattern: '* * * * *' } });
await new Promise((r) => setTimeout(r, 500));
console.log(`add({ repeat }): plain job id=${old.id}, state=${await old.getState()}, schedulers=${await queue.getJobSchedulersCount()}`);
await Promise.all(workers.map((w) => w.close()));
await queue.obliterate({ force: true });
await queue.close();

// Real output (Node v24.19.0, bullmq 6.3.13, ioredis 6.0.0, Redis 8.0.5; REDIS_PORT=7301):
//   schedulers: 1
//   {
//     key: 'daily-report',
//     pattern: '*/2 * * * * *',
//     tz: 'Etc/UTC',
//     next: '2026-10-12T17:27:28.000Z'
//   }
//   W1 ran send-report id=repeat:daily-report:1791826048000
//   W1 ran send-report id=repeat:daily-report:1791826050000
//   W1 ran send-report id=repeat:daily-report:1791826052000
//   jobs run: 3 | distinct ids: 3
//   schedulers after remove: 0
//   W2 ran old-style id=7
//   add({ repeat }): plain job id=7, state=completed, schedulers=0
```

Three upserts left one scheduler, and three workers ran each slot once (which worker picks up each job, and the times, differ between runs). The number at the end of each job id is the slot in milliseconds (`1791826048000` is `2026-10-12T17:27:28.000Z`, the `next` printed above), which makes it a ready-made run key. The last line is the v6 trap: the old `repeat` option is silently ignored and the job runs once.

**Example 7 — OS cron: check a crontab file without installing it.**

The crontab to check (label `text`, because it is not a shell script):

text

```
# m   h   dom mon dow   command
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=""

# Nightly cleanup at 03:15
15    3   *   *   *     cd /srv/app && node scripts/cleanup.mjs >> /var/log/app/cleanup.log 2>&1
# Every 10 minutes during working hours, Monday to Friday
*/10  8-18 *  *   1-5   /usr/local/bin/node /srv/app/scripts/sync.mjs
# A date in the command needs \% because a bare % ends the command
0     0   1   *   *     /srv/app/scripts/monthly.sh "$(date +\%Y-\%m)"
# Typo: hour 24 does not exist
0     24  *   *   *     /srv/app/scripts/broken.sh
```

javascript

```
// Validate a crontab file WITHOUT installing it: never run `crontab file` / `crontab -l` for this.
import { CronFileParser, CronExpressionParser } from 'cron-parser';

const { variables, expressions, errors } = CronFileParser.parseFileSync(process.argv[2]);
console.log('variables:', variables);
const from = { currentDate: new Date('2026-10-12T00:00:00Z'), tz: 'UTC' };  // fixed start, so output is stable
for (const e of expressions) {
  const it = CronExpressionParser.parse(e.stringify(), from);
  const next = [it.next(), it.next()].map((d) => d.toISOString().slice(0, 16)).join(', ');
  console.log(`ok   ${e.stringify().padEnd(18)} next: ${next}`);
}
for (const [line, err] of Object.entries(errors)) console.log(`FAIL ${line.trim()}\n     -> ${err.message}`);

// Real output (Node v24.19.0, cron-parser 5.10.2; `node check.mjs app.crontab`):
//   variables: {
//     SHELL: '/bin/bash',
//     PATH: '/usr/local/bin:/usr/bin:/bin',
//     MAILTO: ''
//   }
//   ok   15 3 * * *         next: 2026-10-12T03:15, 2026-10-13T03:15
//   ok   */10 8-18 * * 1-5  next: 2026-10-12T08:00, 2026-10-12T08:10
//   ok   0 0 1 * *          next: 2026-11-01T00:00, 2026-12-01T00:00
//   FAIL 0     24  *   *   *     /srv/app/scripts/broken.sh
//        -> Constraint error, got value 24 expected range 0-23
```

The parser checks the time fields only. It does not check that `\%` is escaped or that the command exists. A script started by cron does not know which slot started it, so it has to recompute the slot for its run key. `prev()` is strictly earlier than `currentDate`, which gives an off-by-one-slot bug when the script starts at exactly the slot time:

javascript

```
// A script started by OS cron does not know its slot. Recompute it from the schedule.
import { CronExpressionParser } from 'cron-parser';

function slotFor(schedule, now, tz = 'UTC') {
  // prev() is strictly before currentDate, so add 1 ms: a start at exactly 03:15:00.000 is that slot
  const it = CronExpressionParser.parse(schedule, { tz, currentDate: new Date(now.getTime() + 1) });
  return it.prev().toISOString();
}
const naive = (schedule, now) =>
  CronExpressionParser.parse(schedule, { tz: 'UTC', currentDate: now }).prev().toISOString();

for (const started of ['2026-10-12T03:15:00.000Z', '2026-10-12T03:15:03.250Z', '2026-10-12T03:19:59.000Z']) {
  const now = new Date(started);
  console.log(`started ${started.slice(11, 23)} -> run key cleanup@${slotFor('15 3 * * *', now)} | without +1 ms: ${naive('15 3 * * *', now)}`);
}

// Real output (Node v24.19.0, cron-parser 5.10.2):
//   started 03:15:00.000 -> run key cleanup@2026-10-12T03:15:00.000Z | without +1 ms: 2026-10-11T03:15:00.000Z
//   started 03:15:03.250 -> run key cleanup@2026-10-12T03:15:00.000Z | without +1 ms: 2026-10-12T03:15:00.000Z
//   started 03:19:59.000 -> run key cleanup@2026-10-12T03:15:00.000Z | without +1 ms: 2026-10-12T03:15:00.000Z
```

Without the extra millisecond, a run that starts on time claims *yesterday's* run key, finds it `done`, and skips today's work.

**Example 8 — edge case: the DST fall-back on 1 November 2026, three libraries side by side.**

`node:test`'s `mock.timers` fakes `Date` so node-cron's `getNextRuns()` starts from a chosen instant. BullMQ's own `defaultRepeatStrategy` export is called directly, so its column is BullMQ's real calculation, not a guess.

javascript

```
// Next run times across the 2026 US DST changes in America/New_York,
// from node-cron 4.6.0, cron-parser 5.10.2 and BullMQ 6.3.13's own repeat strategy.
import { mock } from 'node:test';
import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { defaultRepeatStrategy } from 'bullmq';

const tz = 'America/New_York';
const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', month: '2-digit', day: '2-digit' });
const local = (d) => zoneName.format(d).replace(',', '');

function nodeCron(expr, from, n) {
  mock.timers.enable({ apis: ['Date'], now: new Date(from) });   // fake "now" for getNextRuns
  const task = cron.createTask(expr, () => {}, { timezone: tz });  // created, never started
  const runs = task.getNextRuns(n);
  task.destroy();
  mock.timers.reset();
  return runs;
}
function cronParser(expr, from, n) {
  const it = CronExpressionParser.parse(expr, { tz, currentDate: new Date(from) });
  return Array.from({ length: n }, () => it.next().toDate());
}
function bullmq(expr, from, n) {
  const out = []; let t = Date.parse(from);
  for (let i = 0; i < n; i++) out.push(new Date(t = defaultRepeatStrategy(t, { pattern: expr, tz })));
  return out;
}

// First prove the dates: the same wall-clock 01:30 exists twice on 1 Nov 2026
console.log('05:30Z ->', local(new Date('2026-11-01T05:30:00Z')), '| 06:30Z ->', local(new Date('2026-11-01T06:30:00Z')));
console.log('06:59Z ->', local(new Date('2026-03-08T06:59:00Z')), '| 07:00Z ->', local(new Date('2026-03-08T07:00:00Z')));

for (const [title, expr, from, n] of [
  ['fall back, "*/30 * * * *" from 00:45 EDT on 1 Nov', '*/30 * * * *', '2026-11-01T04:45:00Z', 5],
  ['fall back, "30 1 * * *" from 31 Oct', '30 1 * * *', '2026-10-31T12:00:00Z', 2],
  ['spring forward, "30 2 * * *" from 7 Mar', '30 2 * * *', '2026-03-07T12:00:00Z', 2],
]) {
  console.log(`\n${title}`);
  for (const [name, fn] of [['node-cron  ', nodeCron], ['cron-parser', cronParser], ['bullmq     ', bullmq]]) {
    console.log(`  ${name}`, fn(expr, from, n).map(local).join(' | '));
  }
}

// Real output (Node v24.19.0, node-cron 4.6.0, cron-parser 5.10.2, bullmq 6.3.13):
//   05:30Z -> 11/01 01:30 EDT | 06:30Z -> 11/01 01:30 EST
//   06:59Z -> 03/08 01:59 EST | 07:00Z -> 03/08 03:00 EDT
//
//   fall back, "*/30 * * * *" from 00:45 EDT on 1 Nov
//     node-cron   11/01 01:00 EDT | 11/01 01:30 EDT | 11/01 02:00 EST | 11/01 02:30 EST | 11/01 03:00 EST
//     cron-parser 11/01 01:00 EDT | 11/01 01:30 EDT | 11/01 01:00 EST | 11/01 01:30 EST | 11/01 02:00 EST
//     bullmq      11/01 01:00 EDT | 11/01 01:30 EDT | 11/01 01:00 EST | 11/01 01:30 EST | 11/01 02:00 EST
//
//   fall back, "30 1 * * *" from 31 Oct
//     node-cron   11/01 01:30 EDT | 11/02 01:30 EST
//     cron-parser 11/01 01:30 EDT | 11/02 01:30 EST
//     bullmq      11/01 01:30 EDT | 11/02 01:30 EST
//
//   spring forward, "30 2 * * *" from 7 Mar
//     node-cron   03/09 02:30 EDT | 03/10 02:30 EDT
//     cron-parser 03/08 03:30 EDT | 03/09 02:30 EDT
//     bullmq      03/08 03:30 EDT | 03/09 02:30 EDT
```

The first two lines confirm the dates: 01:30 exists as both EDT and EST on 1 November 2026, and on 8 March 2026 the clock goes from 01:59 EST straight to 03:00 EDT. On the fall-back day node-cron leaves a 90-minute gap in a 30-minute schedule (no run at 06:00Z or 06:30Z), while cron-parser and BullMQ run 01:00 and 01:30 twice. On the spring-forward day node-cron drops the 02:30 run, and the other two move it to 03:30. node-cron documents its choice ("the repeated hour runs once"; a time in the gap "is skipped for that day"). Neither choice is wrong, but moving a job from node-cron to BullMQ changes it.

**Example 9 — edge case: day of month AND day of week.**

javascript

```
import { CronExpressionParser } from 'cron-parser';
import { mock } from 'node:test';
import cron from 'node-cron';
const expr = '0 9 13 * 5';   // "09:00 on the 13th" and/or "09:00 on Fridays"
const from = new Date('2026-11-01T00:00:00Z');
const it = CronExpressionParser.parse(expr, { currentDate: from, tz: 'UTC' });
console.log('cron-parser:', Array.from({ length: 4 }, () => it.next().toISOString().slice(0, 10)).join(' '));
mock.timers.enable({ apis: ['Date'], now: from });
const t = cron.createTask(expr, () => {}, { timezone: 'Etc/UTC' });
console.log('node-cron:  ', t.getNextRuns(4).map((d) => d.toISOString().slice(0, 10)).join(' '));
t.destroy();

// Real output (Node v24.19.0, cron-parser 5.10.2, node-cron 4.6.0):
//   cron-parser: 2026-11-06 2026-11-13 2026-11-20 2026-11-27
//   node-cron:   2026-11-13 2027-08-13 2028-10-13 2029-04-13
```

cron-parser (and so BullMQ) uses the classic cron rule from `man 5 crontab`: either day field may match, so every Friday plus the 13th. node-cron 4 requires **both** ("day-of-month and day-of-week are combined with AND", from its README), so only Friday the 13th, about once a year. The same five fields, copied between tools, fire 52 times a year or 1 or 2 times a year.

**Example 10 — a Kubernetes CronJob, validated with kubeconform (validated, not run on a cluster).**

yaml

```
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "30 1 * * *"
  # Stable since Kubernetes 1.27. Without it, the controller manager's local zone is used.
  timeZone: "America/New_York"
  # Skip a run if the previous Job is still running (default is Allow)
  concurrencyPolicy: Forbid
  # A run that could not start within 10 minutes of its time is skipped, not run late
  startingDeadlineSeconds: 600
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 5
  jobTemplate:
    spec:
      # Pod retries before the Job counts as failed
      backoffLimit: 2
      # Kill the Job if it runs longer than 30 minutes
      activeDeadlineSeconds: 1800
      template:
        spec:
          restartPolicy: Never
          containers:
            - name: report
              image: registry.example.com/app:1.4.2
              command: ["node", "scripts/daily-report.mjs"]
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: app-db
                      key: url
```

A broken copy with four mistakes:

yaml

```
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "30 1 * * *"
  # wrong case: the field is timeZone
  timezone: "America/New_York"
  # wrong case: the valid values are Allow, Forbid, Replace
  concurrencyPolicy: forbid
  # a string, not an integer
  startingDeadlineSeconds: "600"
  jobTemplate:
    spec:
      template:
        spec:
          # Job pods only allow Never or OnFailure
          restartPolicy: Always
          containers:
            - name: report
              image: registry.example.com/app:1.4.2
```

bash

```
$ kubeconform -v
v0.8.0
$ kubeconform -strict -summary -kubernetes-version 1.36.0 k8s/cronjob.yaml
Summary: 1 resource found in 1 file - Valid: 1, Invalid: 0, Errors: 0, Skipped: 0
$ kubeconform -strict -summary -kubernetes-version 1.36.0 k8s/cronjob-broken.yaml
k8s/cronjob-broken.yaml - CronJob daily-report is invalid: problem validating schema. Check JSON formatting: jsonschema validation failed with 'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.36.0-standalone-strict/cronjob-batch-v1.json#' - at '/spec/startingDeadlineSeconds': got string, want null or integer - at '/spec': additional properties 'timezone' not allowed
Summary: 1 resource found in 1 file - Valid: 0, Invalid: 1, Errors: 0, Skipped: 0
$ echo $?
1
```

kubeconform (downloaded from its GitHub release, SHA-256 checked against the release's `CHECKSUMS`) caught two of the four mistakes. `-strict` is what catches `timezone`: without it, unknown fields are allowed. It did not catch `forbid` or `restartPolicy: Always`, because the JSON schema types both fields as plain strings. The Job docs say "Only a RestartPolicy equal to Never or OnFailure is allowed", and the API server checks these values when you apply the manifest.

> ⚠️ Unverified: how a real API server rejects `concurrencyPolicy: forbid` and `restartPolicy: Always`, and how the CronJob controller schedules this manifest (no cluster or kubectl was available). Only the schema validation above was run. See lesson 105.

## Common mistakes & gotchas

- **One cron per replica.** An in-process scheduler fires in every copy of the app: 3 reports from 3 instances (Example 2). Put a lock or a run key around every scheduled job, or run schedules in one place (a queue scheduler, a CronJob, a leader).
- **Trusting a lock to stop duplicates.** A lock released after the work lets a late instance run the same slot again (Example 5). Keep a run key per slot.
- **Run keys from `Date.now()`.** Two instances a few milliseconds apart compute different keys. Use the scheduled slot: `ctx.date`, the BullMQ job id, the Kubernetes annotation, or `prev()` + 1 ms (Example 7).
- **Session advisory locks through a pool.** The unlock can land on another connection, return `false` with a WARNING, and leave the lock held (Example 4). Use a dedicated client or `pg_try_advisory_xact_lock`.
- **BullMQ 6 with v5 code.** `queue.add(..., { repeat })` no longer schedules anything and does not throw (Example 6); `getRepeatableJobs()` and `removeRepeatableByKey()` are gone. Use `upsertJobScheduler` and `removeJobScheduler`, and install `ioredis` yourself.
- **node-cron v3 options on v4.** `scheduled: false`, `runOnInit` and `recoverMissedExecutions` were removed and `task.now()` became `task.execute()`. Check the migration guide before upgrading.
- **Copying expressions between tools.** Day-of-month plus day-of-week is OR in cron and cron-parser/BullMQ, AND in node-cron (Example 9). Six fields mean "seconds first" in node-cron and BullMQ; the OS crontab and Kubernetes take five.
- **Daily jobs between 01:00 and 03:00 local time.** On DST days they run twice, not at all, or an hour late, depending on the tool (Example 8). Move them, or schedule in `Etc/UTC`.
- **No time zone at all.** The schedule then follows the process (node-cron), the cron daemon or the kube-controller-manager. A server image built in UTC and one in local time give different run times for the same expression. Set `timezone`, `tz` or `timeZone` explicitly.
- **Crontab environment.** No `nvm`, a minimal `PATH`, `/usr/bin/sh`, and `%` turns into a newline. Use absolute paths and `\%`, and send output to a log file.
- **Testing cron with your real crontab.** `crontab file` replaces it in one step. Validate with a parser (Example 7) and install through your deploy tooling.
- **`startingDeadlineSeconds` under 10.** The Kubernetes docs warn the job "may not be scheduled", because the controller checks every 10 seconds.
- **Overlapping long runs.** A job that sometimes takes longer than its interval stacks up. Use `noOverlap` (node-cron), `concurrencyPolicy: Forbid` (Kubernetes) or the run-key lease, and alert on runs that are skipped.

## Best practices

- **Decide where schedules live** before scaling past one instance: a BullMQ job scheduler or Kubernetes CronJob for "once per slot for the whole system"; node-cron only for per-instance work (refresh a local cache) or behind a lock or leader.
- **Make every scheduled job idempotent per slot:** claim → work → done on a `(job, slot)` key, release the claim on a throw, and take over claims older than a lease, as in lesson 114.
- **Keep the run key's slot in UTC ISO form** (`2026-10-13T07:30:00.000Z`), even when the schedule is in a local zone, so the repeated 01:30 on a fall-back day gives two different keys.
- **Set the time zone explicitly** on every schedule, and keep jobs that must run once per day out of the 01:00–03:00 local window in DST zones.
- **Use Redis locks for "do not overlap" and the database for "do not repeat".** A Redis lock is fine for keeping two runs from overlapping, but use a database row when a repeat would cost money or send mail.
- **Pass the run key to external APIs** as their idempotency key, so a crash after the side effect but before `done` does not repeat it.
- **Bound every run:** a timeout (`activeDeadlineSeconds` on a CronJob's Job, or your own `AbortSignal` from [lesson 22](22-abortcontroller-and-abortsignal.md); node-cron's `executeTimeout` applies to background tasks only, per its docs), so a hung run cannot hold a lock or claim forever.
- **Stop schedulers on shutdown** (`task.destroy()`, `worker.close()`; see [lesson 102](102-graceful-shutdown-monitoring.md)), so a deploy does not cut a run in half.
- **Record and alert on outcomes:** last success per job, skipped or overlapping runs, run duration. A job that silently stopped running is only noticed when someone asks for last night's report.
- **Validate schedules in CI:** parse every expression (`cron.validate`, cron-parser, kubeconform for CronJobs) and print the next few run times, so a typo fails the build and not the night.

## ⭐ Interview lens

> **Q: “We run three replicas and our nightly job ran three times. How do you fix it?”**  
> A: Each replica runs its own in-process scheduler. They parse the same cron expression, compute the same next slot, and fire within milliseconds of each other. Example 2 is that with three processes. First I make a second start do nothing. The run key is a row keyed by job and slot, and the slot comes from the scheduled time, `ctx.date` or the BullMQ job id, never from `Date.now()`. One insert wins. If the row is already `done`, stop. If it is `processing` and younger than the lease, someone else owns it. If it is older, the owner crashed, so take it over. Then do the work, and mark `done` only after it succeeds. Second, I stop the extra triggers. A BullMQ job scheduler stores one scheduler in Redis and every instance can upsert the same id. A Kubernetes CronJob creates the Job in the cluster, not in each pod. Or a lock: Redis `SET key token NX PX ttl`, released by a Lua compare-and-delete, or `pg_try_advisory_lock`. The trap is the lock alone. It stops overlap. A slow replica that starts after the first one released the lock runs the slot again. The run key is what remembers the slot is finished.

> **Q: “Redis lock or PostgreSQL advisory lock for a scheduled job?”**  
> A: Both answer "who runs right now". A Redis lock is a key with a TTL. If the holder crashes, everyone else waits out the TTL. If the job runs longer than the TTL, a second worker can take the lock while the first is still going. The release has to be compare-and-delete with the token you stored, or an expired holder deletes the new owner's lock. A session advisory lock, `pg_try_advisory_lock`, returns true to one session and false to the rest, and PostgreSQL holds it until you unlock or the session ends. A crash frees it as soon as the connection closes. There is no TTL to tune, and it holds a connection for the whole job. Through a pool the unlock can land on a different connection, return false, and leave the lock held. Use a dedicated client, or `pg_try_advisory_xact_lock`, which ends with the transaction. If the job already writes to PostgreSQL, I prefer the run-key row. It is one winner now, and it also remembers that the slot is done after the lock would have been released.

> **Q: “What happens to a job scheduled at 01:30 New York time on the day the clocks go back?”**  
> A: A cron expression is wall-clock time. On 1 November 2026, America/New_York falls back at 02:00, so 01:00 to 01:59 happens twice, once in EDT and once in EST. A daily `30 1 * * *` ran once, at the EDT 01:30, in node-cron 4.6.0, cron-parser 5.10.2, and BullMQ 6.3.13. A `*/30` schedule does not agree. node-cron skips the repeated hour: 01:00 EDT, 01:30 EDT, then 02:00 EST. cron-parser and BullMQ run both passes, so 01:00 and 01:30 happen twice. BullMQ uses cron-parser for pattern slots, which is why those two match. On the spring-forward day, 8 March 2026, 02:00 to 02:59 does not exist. node-cron skips a daily 02:30. cron-parser and BullMQ move it to 03:30 EDT. Debian cron, for a change under 3 hours, runs a fixed time in the skipped hour soon after the change, and does not re-run a job in a repeated hour. So I keep a once-a-day job out of 01:00 to 03:00 in a US zone, or I schedule it in UTC, and the run key stays a UTC instant so the two 01:30s would still be different keys.

> **Q: “What do `concurrencyPolicy` and `startingDeadlineSeconds` do on a Kubernetes CronJob?”**  
> A: A CronJob creates a Job for each slot, and the Job creates Pods. `concurrencyPolicy` is about overlap between Jobs of this one CronJob. `Allow` is the default and lets them overlap. `Forbid` skips a slot while the previous Job is still running. `Replace` stops the running Job and starts the new one. It does not look at any other CronJob. `startingDeadlineSeconds` is how late a Job may still be created. Past that, the slot is skipped. Unset means no deadline. The docs warn that a value under 10 seconds may never schedule, because the controller checks about every 10 seconds, and that more than 100 missed slots means the Job is not started. Neither field is exactly-once. The docs say a CronJob creates a Job "approximately once" per slot, and sometimes two Jobs or none, so the Job should be idempotent. Since Kubernetes 1.32 the Job carries `batch.kubernetes.io/cronjob-scheduled-timestamp` with the slot time, which is the run key you claim. `timeZone` is an IANA name. Without it, the controller uses its own zone. `timeZone` has been stable since 1.27. CronJob itself has been stable since 1.21.

## Cheat-card

- **node-cron 4.6.0:** `cron.schedule(expr, fn, { name, timezone, noOverlap, maxExecutions, logger })`; `createTask` (not started), `execute()`, `stop()`, `destroy()`, `getNextRuns(n)`; `ctx.date` = scheduled slot; 6 fields = seconds first; Node ≥ 20.
- **v3 → v4:** removed `scheduled`, `runOnInit`, `recoverMissedExecutions`; `now()` → `execute()`; DoM + DoW combined with AND.
- **BullMQ 6.3.13:** `upsertJobScheduler(id, { pattern | every, tz }, { name, data, opts })` (added in v5.16.0); job id `repeat:<id>:<ms>`; `repeat` on `add()` removed in v6.0.0 and silently ignored; install `ioredis` yourself.
- **OS cron:** 5 fields + command; no `$VAR` expansion; `SHELL=/usr/bin/sh`; escape `%` as `\%`; DoM/DoW restricted together = OR; one daemon time zone; never test with your real `crontab`.
- **Kubernetes CronJob:** `schedule` (5 fields, no `CRON_TZ`), `timeZone` (stable 1.27), `concurrencyPolicy` Allow/Forbid/Replace, `startingDeadlineSeconds` (≥ 10), Job pods `restartPolicy` Never/OnFailure; "approximately once" per slot.
- **One run per slot:** lock (Redis token + `SET NX PX` + Lua release, or `pg_try_advisory_lock` on a dedicated connection / `pg_try_advisory_xact_lock`) + run key `(job, slot)` claim → work → done.
- **Leader election:** one lease holder runs schedules; failover = lease time; still needs run keys.
- **DST (America/New_York, 2026):** fall back 1 Nov (01:00–01:59 twice), spring forward 8 Mar (02:00–02:59 missing); node-cron skips, cron-parser/BullMQ repeat or shift; schedule critical jobs outside 01:00–03:00 or in UTC.
- **Versions used:** Node v24.19.0, node-cron 4.6.0, bullmq 6.3.13, ioredis 6.0.0, Redis 8.0.5, pg 8.23.1, PostgreSQL 18.4, cron-parser 5.10.2, kubeconform 0.8.0.

## Good to know

- node-cron v3 removals, from the migration guide and the 4.6.0 types: `scheduled`, `runOnInit`, `recoverMissedExecutions`. `task.now()` became `task.execute()`. A missed run emits `execution:missed`. Also added: `maxExecutions`, `maxRandomDelay`, `lastRun()`. `distributed: true` reads `NODE_CRON_RUN=true|false` by default. A test run passed the coordinator key `x:2026-10-12T17:08:21.000Z` (task name plus slot).
- BullMQ job schedulers were added in v5.16.0. v6.0.0 removed `repeat` on `Queue#add` and `addBulk`, the Repeat class, `getRepeatableJobs()`, `removeRepeatable()`, and `removeRepeatableByKey()`. BullMQ pins cron-parser 5.10.1. This lesson also used cron-parser 5.10.2 directly. Inside BullMQ the call is `CronExpressionParser.parse(pattern, { …opts, currentDate })`.
- OS cron on this machine was `cron` 3.0pl1-200ubuntu1. Kubernetes CronJob schemas were 1.36.0. kubeconform caught `startingDeadlineSeconds` as a string and `timezone` (not `timeZone`) only with `-strict`. It did not catch `concurrencyPolicy: forbid` or `restartPolicy: Always`, because the schema types those as strings.
- Day-of-month and day-of-week together are OR in OS cron, cron-parser, and BullMQ (`30 4 1,15 * 5` runs on the 1st, the 15th, and every Friday). node-cron combines them with AND.

---

## Learn More

- [node-cron documentation nodecron.com](https://nodecron.com/)
- [Migrating from node-cron v3 to v4 nodecron.com](https://nodecron.com/migrating-from-v3)
- [Timezones & DST in node-cron nodecron.com](https://nodecron.com/timezones-and-dst)
- [Job Schedulers (BullMQ) docs.bullmq.io](https://docs.bullmq.io/guide/job-schedulers)
- [BullMQ changelog, including v6.0.0 breaking changes docs.bullmq.io](https://docs.bullmq.io/changelog)
- [cron-parser github.com](https://github.com/harrisiirak/cron-parser)
- [CronJob (Kubernetes) kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/)
- [kubeconform github.com](https://github.com/yannh/kubeconform)
- [Explicit Locking: advisory locks (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/explicit-locking.html)
- [Advisory lock functions (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/functions-admin.html)
- [Distributed locks with Redis redis.io](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/)
