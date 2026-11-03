---
title: "Debugging Node.js"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/debugging-nodejs
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Debugging Node.js

*11 min read · Updated 24 Jul 2026 Topic 55 of 70 Bookmark Mark done Why it matters Debugging is where most engineering time actually goes · Topic 55 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/debugging-nodejs](https://www.geekyfrontend.in/learn/nodejs-backend-kit/debugging-nodejs)

---

## Say it in 30 seconds

Node's debugger is the V8 inspector: start the process with an inspect flag and a tool such as Chrome DevTools connects over a local socket so you can pause on a line, read variables, and take a memory snapshot. Console log falls apart on races, leaks, and crashes you can only reproduce in production. The inspect port can run code inside your process, so you never open it on a public address.

## Why it matters

Most engineering time is debugging, and a scatter of console log works only for a small bug. It collapses on a race between two async calls, a leak that shows up after an hour, a CPU spike, or a crash you cannot reproduce locally. Attaching a debugger, pausing on a condition, and comparing two heap snapshots is the skill interviewers use as a proxy for whether you understand the runtime.

## The concept, simply

When you start with `node --inspect app.js`, V8 opens a WebSocket on 127.0.0.1 port 9229 and speaks the Chrome DevTools Protocol. Any client that speaks that protocol can connect: Chrome's inspect page, the VS Code debugger, or the terminal `node inspect` client. Once connected you can set breakpoints, step, read variables, evaluate in the paused frame, profile CPU, and take heap snapshots.

![A Node process exposing a WebSocket on port 9229 that a V8 Inspector protocol connects to Chrome DevTools or VS Code](assets/i52_01_45d1d270.svg)

`--inspect` exposes the V8 inspector over a WebSocket. Any Chrome DevTools Protocol client can attach. Do not expose that port publicly.

**`--inspect-brk`** is the same, except it pauses on the first line and waits for a debugger before running anything. Use it when the bug is during startup. With plain `--inspect`, that code may finish before you connect.

## How it works

V8 runs the inspector inside the process. `--inspect` turns it on and binds the WebSocket. The client exchanges JSON messages: set a breakpoint, paused, evaluate, take a heap snapshot. It is the same protocol Chrome uses for page JavaScript, so the DevTools UI you already know works on a Node process. You can also turn the inspector on for a process that is already running by sending it SIGUSR1, `kill -USR1 <pid>`. That helps when a live process misbehaves and you did not start it with the flag.

The `debugger;` statement is a breakpoint in source. If an inspector is attached, V8 pauses there. If none is attached, it does nothing, so it is tolerable in development and should not ship.

Once paused you get the call stack, including async frames that modern V8 stitches in, the scopes, watch expressions, and a console that evaluates in that frame.

Two profilers matter for hard bugs. The **CPU profiler** samples the stack and shows where time goes, which is what you want for a slow route or a blocked event loop. The **heap profiler** takes snapshots of every live object and what retains it. Two snapshots a few minutes apart, and the comparison of what grew, is how you find a leak. A leak is almost always objects that should have been collected and are still reachable from a module-level array, a cache with no eviction, or a listener that was never removed.

A **core dump** is heavier: a snapshot of the whole process memory at the moment it crashed, written by the OS if you enabled it with `ulimit -c unlimited`, and inspected later with a tool such as llnode. That is how you look at a crash you cannot reproduce interactively. Node's **diagnostic report** (`--report-on-fatalerror`, or `process.report`) is a lighter JSON file with the stack, resource use, libuv handles, and environment at the failure.

## Code examples

`--inspect-brk` waits for you before running a line, which is what you want for a startup bug.

bash

```
# Attach at will; code runs immediately.
node --inspect app.js

# Pause on line 1 and wait for a debugger to attach (debug startup code).
node --inspect-brk app.js

# Open chrome://inspect in Chrome, click "inspect", or in VS Code use a
# launch config. Then set breakpoints in the DevTools Sources panel.

# Trigger the inspector on an ALREADY-running process (didn't use --inspect):
kill -USR1 $(pgrep -f 'node app.js')
```


`debugger;` plus a condition pauses only on the case you care about.

javascript

```
function processOrder(order) {
  // Pauses here ONLY when the Inspector is attached AND this branch runs.
  if (order.total < 0) {
    debugger; // inspect 'order' live: full object, call stack, scope
  }
  return charge(order);
}

// Prefer a conditional breakpoint in DevTools (right-click the gutter) over
// editing source: e.g. break on line 42 only when order.id === 'abc'.
```


A diagnostic report from code is a portable artifact you can attach to a bug, with no extra dependency.

javascript

```
import process from 'node:process';

// Configure at startup: auto-write a JSON report on a fatal error or signal.
process.report.reportOnFatalError = true;
process.report.reportOnSignal = true;
process.report.directory = './reports';

// Or capture one on demand when something looks wrong:
function snapshotOnAnomaly(reason) {
  const file = process.report.writeReport();
  console.error('wrote diagnostic report:', file, 'reason:', reason);
  // The report contains: JS + native stack, heap/resource usage, libuv
  // handles (open sockets/timers), env vars, and Node/OS versions.
}
```


The leak demo is deliberate, so the snapshot comparison has something to show.

javascript

```
const cache = []; // module-level: never garbage-collected

app.get('/leak', (req, res) => {
  // ❌ Grows forever — nothing ever removes entries. Classic leak.
  cache.push(Buffer.alloc(1024 * 100, 'x'));
  res.end('ok');
});

// Diagnose: run with --inspect, open DevTools > Memory. Take a heap snapshot,
// hit /leak many times, take a SECOND snapshot, then use the "Comparison"
// view. The retained Buffers under 'cache' light up as the delta. The fix is
// an eviction policy (LRU, TTL) or not caching at module scope at all.

// Quick numeric signal without DevTools:
setInterval(() => {
  const { heapUsed } = process.memoryUsage();
  console.log('heapUsed MB:', (heapUsed / 1048576).toFixed(1));
}, 5000).unref();
```


## Common mistakes & gotchas

- **Opening the inspector on a public address.** Port 9229 can run arbitrary code in your process. Bind to localhost and tunnel over SSH. Never `--inspect=0.0.0.0` on a public host.
- **`--inspect` when you needed `--inspect-brk`.** Startup code runs before you attach, and you miss it.
- **Shipping `debugger;` statements.** With an inspector attached they halt the process. Lint them out of production.
- **console log on an async race.** Logging changes the timing and can hide the race. A breakpoint pauses everyone.
- **One heap snapshot for a leak.** One snapshot shows what is alive, not what is growing. Take two and compare.
- **Forgetting to enable core dumps before the crash.** After it dies, it is too late.
- **Calling a blocked event loop a leak.** Flat memory and stuck requests is a CPU problem. Check memory and event-loop lag before you pick a profiler.
- **Assuming async stacks are complete.** Modern V8 is much better, and traces can still be cut. `--stack-trace-limit` and `Error.stackTraceLimit` set the depth.

## Best practices

- **Learn one real debugger,** VS Code or Chrome DevTools, and use it instead of console log as the default.
- **Conditional breakpoints and logpoints** so you pause on the interesting case, not every iteration.
- **Keep the inspector on localhost.** Reach a remote process through an SSH tunnel.
- **Turn on diagnostic reports** for fatal errors and signals in production, so a crash leaves a file.
- **Leaks: two heap snapshots and the comparison.** Look for module-level state, caches, and listeners that were never removed.
- **CPU: the sampling profiler,** the Performance tab or `--cpu-prof`, before you micro-optimize.
- **SIGUSR1 attaches to a live process** you did not start with `--inspect`, so you do not have to restart and lose the state.
- **Core dumps for crashes you cannot reproduce,** inspected with llnode or the diagnostic report.

## ⭐ Interview lens

> **Q: "How does `node --inspect` actually work?"**  
> A: `node --inspect` turns on V8's inspector inside the process and opens a WebSocket, by default 127.0.0.1 port 9229, speaking the Chrome DevTools Protocol. A client such as chrome://inspect, VS Code, or the terminal `node inspect` connects and sends JSON: set a breakpoint, read scope, evaluate an expression, take a CPU profile or a heap snapshot. It is the same protocol Chrome uses for page scripts, so the DevTools UI works on a Node backend without a separate debugger. For example, you start the server with the flag, open the inspect page, set a breakpoint in the route, and send one request. The process pauses with the live locals. The limit is the port itself. Anyone who can reach 9229 can run code in your process, so it stays on localhost, and you tunnel if the process is on another machine.

> **Q: "What's the difference between `--inspect` and `--inspect-brk`?"**  
> A: Both flags open the inspector. `--inspect` lets the process run immediately, and you attach when you are ready. `--inspect-brk` pauses on the first line and waits until a debugger connects, so nothing in startup runs unobserved. Use the break variant when the bug is "it crashes before I can attach" or "the bad state is created while modules load". Use the plain flag when the server is up and you want to catch a later request. For example, a throw in the database connect at boot is invisible with `--inspect` if you are slow to click attach, and it is sitting on line 1 with `--inspect-brk`. The limit is that `--inspect-brk` holds the whole process, including health checks, until you connect. Do not leave a production boot paused on it.

> **Q (trap): "Can you leave `--inspect` on in production so you can debug live?"**  
> A: No. The inspector is a remote code execution channel. A client that can open port 9229 can evaluate arbitrary JavaScript in your process, which is a full compromise, not a read-only view. If you must debug a live box, bind to 127.0.0.1 only and reach it through an SSH tunnel, or send SIGUSR1 to a process that was not started with the flag, then turn it off when you are done. Never `--inspect=0.0.0.0` on a host that is reachable from the network. For example, a container that publishes 9229 "just in case" is an open shell as the app user. The limit of the SIGUSR1 trick is that you still have to protect the port after you enable it. Turning the inspector on does not make the protocol safe. The network policy does.

> **Q: "A Node service's memory keeps climbing until it OOMs. How do you find the leak?"**  
> A: A climb to an out-of-memory kill is usually a leak: objects that should have been collected are still reachable. Attach with `--inspect`, open the Memory panel, take a heap snapshot, drive the traffic that leaks, take a second snapshot, and compare. The delta shows which constructors grew, and the retainer path shows what is holding them, often a module-level array, a cache with no eviction, a closure that captured a big buffer, or an event listener that was never removed. One snapshot only tells you what is alive right now, which includes legitimate caches. For example, an array pushed to on every request and never spliced shows up as the retainer of thousands of request bodies. The limit is that the snapshot is a point in time on one process. If you have many instances, capture from the one whose memory is climbing, and do not confuse a cache you intended with a leak. The comparison is what separates them.

## Cheat-card

- **`node --inspect`:** V8 inspector WebSocket on 127.0.0.1 port 9229, Chrome DevTools Protocol.
- **`--inspect-brk`:** pause on line 1, for startup and crash-on-boot.
- **`debugger;`** pauses if a debugger is attached, otherwise it does nothing.
- **`kill -USR1 <pid>`** turns the inspector on for a process that is already running.
- **Leak:** two heap snapshots and the comparison. Find what grew and what retains it.
- **Slow or blocked:** CPU profiler, `--cpu-prof`. Find the synchronous hot path.
- **A crash you cannot reproduce:** a core dump (`ulimit -c unlimited`) or a diagnostic report.
- **Security:** never expose 9229. It is remote code execution.

## Good to know

- **What is a core dump, and when do you use one?** It is a full memory image written when the process crashes, if you enabled it with `ulimit -c unlimited`. You inspect the dead process with llnode. Node's diagnostic report is the lighter JSON alternative: stack, resource use, and libuv handles.
- **Memory is flat but requests hang. What now?** That is a blocked event loop, not a leak. Use the CPU profiler and look for synchronous work on the one thread: a big JSON parse, sync crypto or filesystem calls, a catastrophic regex, or a tight loop. Event-loop lag confirms it. Move the work to a worker or make it async.

---

## Learn More

- [Debugging Node.js nodejs.org](https://nodejs.org/en/learn/getting-started/debugging)
- [Debugger (Node.js API) nodejs.org](https://nodejs.org/api/debugger.html)
- [Getting started with Node.js debugging in VS Code Visual Studio Code](https://www.youtube.com/watch?v=2oFKNL7vYV8)
