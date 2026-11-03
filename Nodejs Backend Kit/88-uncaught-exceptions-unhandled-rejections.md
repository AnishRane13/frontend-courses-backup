---
title: "Uncaught Exceptions & Unhandled Rejections"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/uncaught-unhandled
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Uncaught Exceptions & Unhandled Rejections

*11 min read · Updated 24 Jul 2026 Topic 54 of 70 Bookmark Mark done Why it matters No matter how disciplined your error handling is · Topic 54 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/uncaught-unhandled](https://www.geekyfrontend.in/learn/nodejs-backend-kit/uncaught-unhandled)

---

## Say it in 30 seconds

An uncaught exception or an unhandled rejection is an error that got past every handler you wrote, and Node emits a last-resort event so you can log it and exit. The process may be holding a lock or sitting in the middle of an update, so you cannot trust it to keep serving. The safe pattern is to crash and let a supervisor start a fresh process, not to catch the event and continue.

## Why it matters

Some error will eventually escape: a library throws on a path you never tested, a promise rejects with nobody awaiting it, a timer callback blows up. What Node does then, and what you configure, decides whether you corrupt data or restart clean. "Catch it and keep running so we never go down" is the common production mistake. Resilience comes from restarting, not from resuming a process whose state you no longer understand.

## The concept, simply

Two global events are the last resort. **`uncaughtException`** fires when a throw reaches the top with nothing to catch it. **`unhandledRejection`** fires when a promise rejects and nothing ever attaches a catch or an await. Both mean an error slipped past the handling you intended.

The crash-only idea: after an unknown error, the process is in an undefined state. Log it, do a short bounded cleanup, and exit. An external supervisor starts a new process with clean memory. A restart is quick. A subtly corrupt process can damage data for hours.

![A cycle where an uncaught error triggers a handler that logs and exits, then a supervisor restarts a fresh process](assets/i51_01_9a6c4bfc.svg)

The global handler is for logging and shutdown, not for recovery. The supervisor provides resilience by replacing the dead process.

## How it works

When an exception reaches the top with no handler, Node emits `uncaughtException` on `process`. If you registered a listener, Node calls it and then **does not exit on its own**. It assumes you took responsibility. If that listener only logs and returns, the process keeps running in the broken state. If you register no listener, Node prints the stack to stderr and exits with code 1, which is the safer default.

Since Node 15, an unhandled promise rejection also terminates the process by default, exit code 1, same as an uncaught exception. Older Node only printed a warning. You can still listen for `unhandledRejection` to log before you exit. A companion event, `rejectionHandled`, fires if a rejection that was already reported as unhandled later gets a handler. It is rarely used directly. It matters when a promise is awaited far from where it was created.

You cannot safely resume, because the throw unwound the stack at an arbitrary point. A function may have taken a lock, opened a transaction, or half-updated a shared structure. There is no general way to know what was left broken. After `uncaughtException`, shut down. The handler flushes logs and closes resources, on a timeout, then `process.exit(1)`.

Resilience comes from **outside** the process. systemd, PM2, a Docker restart policy, or Kubernetes replacing a pod starts the service again. Several instances behind a load balancer, or the cluster module, mean one crash drops only the requests that instance was handling. This is the same "let it crash" idea Erlang made famous.

**Graceful shutdown** is the planned version. A deploy sends SIGTERM. The process stops accepting new connections, finishes in-flight requests within a timeout, closes the database pool, and exits 0. The crash handler often calls the same cleanup, then exits 1 instead of 0.

## Code examples

Last-resort handlers: log, try a bounded cleanup, then exit. The timer exists so a hung cleanup cannot wedge the process.

javascript

```
import process from 'node:process';

let shuttingDown = false;

function crash(origin, err) {
  if (shuttingDown) return; // avoid re-entrancy if cleanup itself throws
  shuttingDown = true;
  // Use a raw, synchronous-ish log path; the async logger may be broken.
  console.error('FATAL', origin, err);

  // Give logs/metrics a moment to flush, but never hang forever.
  const timer = setTimeout(() => process.exit(1), 3000);
  timer.unref(); // don't keep the loop alive just for this timer

  closeServerAndDb()
    .catch(() => {})
    .finally(() => process.exit(1));
}

process.on('uncaughtException', (err) => crash('uncaughtException', err));
process.on('unhandledRejection', (reason) => crash('unhandledRejection', reason));
```


The pattern to reject in review: swallow the exception to "stay up".

javascript

```
// ❌ NEVER DO THIS. The process keeps running in an unknown, possibly
// corrupt state. Locks may be held, transactions half-open, memory leaked.
process.on('uncaughtException', (err) => {
  console.error('ignoring', err); // and then... nothing. Loop keeps going.
});

// Subtle failure: a request handler threw mid-transaction. The connection
// is never released back to the pool. After enough of these, the pool is
// exhausted and EVERY request hangs — with no obvious crash to point at.
```


Graceful shutdown on SIGTERM. Stop taking work, drain, close, exit clean. This is the planned counterpart of a crash.

javascript

```
import http from 'node:http';

const server = http.createServer(app);
server.listen(3000);

async function shutdown(signal) {
  console.log('received ' + signal + ', draining...');
  server.close(async () => {          // stop accepting new connections
    try {
      await db.pool.end();            // close DB connections
    } finally {
      process.exit(0);                 // clean, intentional exit
    }
  });
  // Hard cap: if draining stalls, force-exit so the orchestrator moves on.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```


An un-awaited rejection is fatal by default on modern Node. One missing await is enough.

javascript

```
async function chargeCard() {
  throw new Error('gateway down');
}

// ❌ No await, no .catch — the returned promise rejects with nobody watching.
function handlePayment() {
  chargeCard(); // fire-and-forget: becomes an unhandledRejection
}
handlePayment();
// Node >= 15 prints the rejection and exits with code 1.

// ✅ Fix: await it inside a try/catch, or attach .catch explicitly.
async function handlePaymentFixed() {
  try { await chargeCard(); }
  catch (e) { /* operational: retry or surface a 502 */ }
}
```


## Common mistakes & gotchas

- **An `uncaughtException` handler that does not exit.** That disables the safe default crash and lets a corrupt process keep serving.
- **Assuming unhandled rejections only warn.** Since Node 15 they exit with code 1. Code that ignored them on Node 12 now crashes.
- **Calling an async function with no await and no catch.** Any rejection becomes unhandled. Common with "background" logging and metrics.
- **Heavy work in the last-resort handler.** The loop and your libraries may already be broken. Keep cleanup small, and guard it with a force-exit timer.
- **No supervisor.** Crash-only design needs something to restart you. A bare `node server.js` stays down.
- **Mixing up SIGTERM and a crash.** SIGTERM is a planned stop, exit 0. An uncaught exception is an emergency, exit 1. They can share cleanup code.
- **Forgetting `unref()` on the safety timer.** The timer itself keeps the process alive.
- **Logging asynchronously and exiting immediately.** The last fatal line never flushes.

## Best practices

- **Let it crash.** `uncaughtException` and `unhandledRejection` mean log, flush, and exit 1. Do not resume normal work.
- **Run under a supervisor** (systemd, PM2, Kubernetes, a Docker restart policy) and run more than one instance.
- **Bound cleanup with `setTimeout(...).unref()`** so a hung shutdown cannot strand the process.
- **On SIGTERM and SIGINT:** stop accepting, drain in-flight work, close pools, exit 0.
- **No floating promises.** Always await or catch. The ESLint rule `no-floating-promises` catches them early.
- **A simple fatal log, preferably a sync write or a logger that flushes,** so the last line reaches stdout.
- **A health endpoint** so an orchestrator can restart a process that is wedged but not crashed.
- **Test the restart,** not only the happy path.

## ⭐ Interview lens

> **Q: "You have an `uncaughtException` handler so your server never goes down. Is that good?"**  
> A: No. Registering `uncaughtException` turns off Node's default, which is to print the stack and exit with code 1. If the handler logs and returns, the process keeps accepting requests in an unknown state: a lock may be held, a transaction half open, a connection leaked. The throw already unwound the stack at some arbitrary line, and there is no general way to repair that. The correct handler logs, runs a short cleanup guarded by a timeout, and calls `process.exit(1)`. A supervisor then starts a clean process. For example, a timeout you expected is handled in the route. A TypeError that reached this hook is not something you resume from. The limit is that this only works if something restarts you. Without systemd, PM2, Docker, or Kubernetes, the exit is just downtime.

> **Q: "What happens to an unhandled promise rejection in modern Node?"**  
> A: Since Node 15, a promise that rejects with no catch and no await terminates the process with exit code 1, the same outcome as an uncaught exception. Before that, Node printed a warning and kept going, which is why old code seemed fine while it dropped errors on the floor. The usual cause is a floating promise: an async function called without await or `.catch()`, often "fire and forget" logging or metrics. You can listen for `unhandledRejection` to log the reason, and you should still exit. For example, `chargeCard()` with no await, inside a request that already sent its response, crashes the process when the charge rejects. The limit of "we are on Node 15 so we are safe" is the handler you add later. A listener that swallows the rejection puts you back on the old, dangerous behavior.

> **Q (trap): "Why not just catch the error and keep the request alive?"**  
> A: For a known operational error, yes. A timeout, a missing row, bad input: that belongs in try catch or an error middleware, and you return a status and keep serving. If the error reached `uncaughtException`, it is unknown. It escaped every boundary, so you do not know which invariant it broke on the way out. Continuing can write corrupt data, which is worse than dropping the few requests that process was handling. For example, a 404 for an unknown order id is handled in the route. A throw after you have updated one account and not the other, with no transaction around it, is not something to catch at the process edge and ignore. The limit of "always crash" is the opposite mistake: crashing on errors you could have handled. Classify them. Handle the expected ones. Exit on the rest.

> **Q: "What's the difference between `SIGTERM` handling and an uncaught-exception handler?"**  
> A: SIGTERM is a planned stop. The orchestrator is asking the process to leave, so you stop accepting new connections, let in-flight requests finish within a timeout, close the database pool, and exit 0. An uncaught exception is an emergency. Something escaped every handler, so you do a minimal flush and exit 1. They often call the same cleanup function, and the exit code is how you tell a planned deploy from a crash. For example, a rolling deploy sends SIGTERM and expects exit 0 after drain. A bug in a timer sends you through the exception handler and exit 1, and the supervisor restarts you. The limit is time. Both paths need a force-exit timer, because a hung close of the pool would otherwise leave the process up forever. `unref()` on that timer means a fast cleanup can still exit immediately.

## Cheat-card

- **`uncaughtException`:** a throw reached the top with no catch.
- **`unhandledRejection`:** a promise rejected with no handler. Node 15 and later exit by default.
- **Rule:** the handler logs, flushes, and exits 1. It does not resume.
- **Resilience is outside the process:** a supervisor plus more than one instance.
- **Graceful shutdown:** on SIGTERM, stop accepting, drain, close pools, exit 0.
- **Bound cleanup** with `setTimeout(...).unref()`.
- **No floating promises.** await or `.catch()`. Lint with `no-floating-promises`.

## Good to know

- **Why `unref()` on the force-exit timer?** A pending timer keeps the process alive. `unref()` means Node will not stay up only for that timer, so a fast cleanup can exit now, and a hung cleanup still hits the timer.
- **How is crash-only design invisible to users?** Run more than one instance behind a load balancer, and restart each one with a supervisor. One crash drops only its in-flight requests. New traffic goes to the healthy instances.

---

## Learn More

- [Process — 'uncaughtException' & 'unhandledRejection' events (Node.js API) nodejs.org](https://nodejs.org/api/process.html)
- [Errors (Node.js API) nodejs.org](https://nodejs.org/api/errors.html)
