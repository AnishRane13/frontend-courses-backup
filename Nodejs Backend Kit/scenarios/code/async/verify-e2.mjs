// Verifies E2: sequential awaits add up, waiting for independent calls together takes about the slowest one,
// a limiter caps in-flight sends at the limit while unbounded fan-out starts all of them at once,
// and settling each send lets the batch finish despite failures, where waiting for all fails fast.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mapLimit, settle } from './map-limit.mjs';

// A fake push provider: 50 ms per call, tracks how many calls are in flight. Users whose id ends in 7 fail.
let inFlight = 0, maxInFlight = 0, completed = 0;
async function sendPush(userId) {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await sleep(50);
    if (userId % 10 === 7) throw new Error(`device token expired for user ${userId}`);
    return `sent:${userId}`;
  } finally {
    inFlight--;
    completed++;
  }
}
const reset = () => { inFlight = 0; maxInFlight = 0; completed = 0; };
const timed = async (fn) => { const t = performance.now(); const r = await fn(); return { ms: performance.now() - t, r }; };
const ok = Array.from({ length: 20 }, (_, i) => i * 10); // ids that never fail

// 1. Sequential versus together, 20 independent calls of 50 ms.
const seq = await timed(async () => { const out = []; for (const id of ok) out.push(await sendPush(id)); return out; });
const par = await timed(() => Promise.all(ok.map(sendPush)));
console.log(`20 calls: sequential ${seq.ms.toFixed(0)} ms, together ${par.ms.toFixed(0)} ms`);
assert.ok(seq.ms >= 1000, 'sequential awaits add up');
assert.ok(par.ms < 400, 'together takes about the slowest call');
assert.deepEqual(par.r, seq.r);

// 2. Fan-out to 2,000 users: unbounded versus a limit of 20.
const users = Array.from({ length: 2000 }, (_, i) => i);
reset();
await Promise.all(users.map((id) => settle(sendPush(id))));
const unboundedPeak = maxInFlight;
reset();
const limited = await timed(() => mapLimit(users, 20, (id) => settle(sendPush(id))));
console.log(`2,000 sends: unbounded peak in flight ${unboundedPeak}, limited peak ${maxInFlight}, limited took ${limited.ms.toFixed(0)} ms`);
assert.equal(unboundedPeak, 2000, 'unbounded fan-out starts every send at once');
assert.equal(maxInFlight, 20, 'the limiter never exceeds its limit');
assert.ok(limited.ms >= 4900, '2,000 sends at 20 at a time and 50 ms each take at least 5 seconds');
assert.deepEqual(limited.r.map((o) => o.ok ? o.value : null).slice(0, 3), ['sent:0', 'sent:1', 'sent:2'], 'results keep input order');

// 3. Partial failure. Settled: every send runs, failures are listed. Waiting for all: rejects on the first failure,
// while the other sends keep running in the background.
const failed = limited.r.filter((o) => !o.ok);
assert.equal(failed.length, 200, 'one user in ten fails, and every failure is reported');
assert.equal(limited.r.length - failed.length, 1800, 'the other sends all went out');

reset();
const batch = users.slice(0, 100);
const all = await timed(() => Promise.all(batch.map(sendPush)).then(() => 'resolved', (e) => e.message));
assert.match(all.r, /device token expired/);
const completedWhenRejected = completed;
await sleep(200);
console.log(`waiting for all: rejected after ${all.ms.toFixed(0)} ms with ${completedWhenRejected} of 100 done, ${completed} done later`);
assert.ok(completedWhenRejected < 100, 'the rejection came before every send had finished');
assert.equal(completed, 100, 'the other sends were not cancelled');
const settled = await Promise.allSettled([sendPush(1), sendPush(7), sendPush(3)]);
assert.deepEqual(settled.map((s) => s.status), ['fulfilled', 'rejected', 'fulfilled']);
console.log('E2 claims hold');
