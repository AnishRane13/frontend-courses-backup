---
title: "AbortController and AbortSignal: Cancellation in Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# AbortController and AbortSignal: Cancellation in Node

*15 min read · Updated 7 Oct 2026 · Topic 73 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

AbortController and AbortSignal are a pair of objects for cancellation: the controller is the only one that can call abort, and the signal is the read-only object you pass into fetch, file reads, timers, and other async APIs so they can stop themselves. They exist because a promise has no cancel method, so a closed browser tab or a deadline would otherwise leave the work running. The trade-off is that abort only stops work that is still pending, and the error you get is not the same shape for fetch as it is for Node's own APIs.

## Why it matters

A promise has no cancel method. Once you call fetch, start a readFile, or spawn a child process, the work runs until it finishes, even if nobody wants the result. Lesson 18 makes the same point about Promise.race and Promise.all: the losing branches keep running.

On a server that wastes real resources. The user closes the tab, but the handler still runs five database queries, holds a pooled connection, and writes a response to a dead socket. A call with no deadline piles up open sockets until the process runs out of file descriptors. During shutdown, timers and child processes that nobody can stop keep the process alive past the grace period.

Node's answer is one pair of objects, AbortController and AbortSignal, taken from the web platform, the WHATWG DOM spec. WHATWG is the group that writes the living standards browsers follow. Almost every async API in Node core accepts the signal as an option: fetch, http.request, fs and fs/promises, timers/promises, events.once, stream.pipeline, and child_process. Learn the pattern once and you cancel all of them the same way.

## The concept, simply

Cancellation is split in two so the code that decides to cancel is separate from the code that does the work.

AbortController is the trigger. It has one property, signal, and one method, abort(reason). Whoever holds the controller can cancel.

AbortSignal is the read-only half you pass to the operations. It is an EventTarget, an object you can listen on. It has:

- aborted, which is false until abort is called and then true forever.
- reason, which is undefined until abort, then the value you passed, or a DOMException named AbortError if you passed no reason.
- throwIfAborted, which throws signal.reason if the signal is already aborted, and otherwise does nothing.
- an abort event, dispatched once, synchronously inside the abort call.

A signal goes from not aborted to aborted once and never goes back. A second abort call does nothing. Three static helpers create signals with no controller of your own. AbortSignal.timeout(ms) aborts itself after that many milliseconds. AbortSignal.any takes several signals and aborts as soon as any of them aborts. AbortSignal.abort(reason) returns a signal that is already aborted.

Because a signal is a plain object, one controller can be passed to many operations. One abort call stops all of them.

text

```
                        abort(reason)
   your code ────────►  AbortController
                              │ .signal  (one AbortSignal, shared)
        ┌───────────┬─────────┼──────────────┬────────────────┐
        ▼           ▼         ▼              ▼                ▼
     fetch()   readFile()  setTimeout()   pipeline()    spawn()
     closes    stops       (promises)     destroys      sends
     socket    reading     clears timer   all streams   killSignal
        │           │         │              │                │
        └───────────┴─────────┴──────┬───────┴────────────────┘
                                     ▼
          each promise rejects / each callback or 'error' gets an abort error
```

## How it works

1. You create a controller and pass controller.signal into one or more operations, usually as signal in their options object.
2. Each operation checks the signal when it starts. If aborted is already true, it fails immediately and does no I/O. I/O means input and output. If not, it registers an abort listener.
3. Something calls abort(reason): a user action, a deadline from AbortSignal.timeout, a client disconnect, or a shutdown hook. The signal sets aborted to true, stores the reason, and dispatches abort to its listeners before abort returns.
4. Each listener stops its own work. fetch and http.request destroy the socket. fs/promises.readFile stops between chunk reads. timers/promises.setTimeout clears its timer. pipeline destroys every stream in the chain. spawn sends the child its killSignal, which defaults to SIGTERM.
5. The operation reports the abort as an error. A promise rejects, a callback receives an err, or an emitter emits error. The shape depends on the API.
6. Work that has already finished is not affected. Abort only stops work that is still pending. A careful operation also removes its abort listener when it finishes normally, so a long-lived signal does not collect listeners.

The error you get depends on the API. On Node v24.19.0:

- fetch, built on undici 7.29.0, rejects with signal.reason itself. With no reason that is a DOMException named AbortError with numeric code 20. With AbortSignal.timeout it is a DOMException named TimeoutError with code 23. With abort(new Error('x')) it is your Error. With abort('text') it is the string.
- Node core APIs, meaning timers/promises, fs/promises, fs callbacks, events.once, stream.pipeline, http.request, and child_process, reject with Node's own AbortError. err.name is AbortError, err.code is the string ABORT_ERR, it is an Error and not a DOMException, and err.cause holds signal.reason. This holds even for AbortSignal.timeout, so these APIs never put TimeoutError in err.name. You find it on err.cause.name.

So the reliable test "was this an abort?" is not err.name. It is signal.aborted on the signal you passed. signal.reason then tells you why.

Listener cleanup. An AbortSignal is an EventTarget, so listeners stay until they run or you remove them. A signal that lives for the whole process, such as a shutdown signal, and is passed to thousands of short operations, will hold a closure for each one unless each operation removes its listener when it finishes. once: true removes the listener after it runs. It does not remove a listener that never runs. You still need removeEventListener on the success path, or events.addAbortListener, which returns a Disposable whose Symbol.dispose removes the listener. A Disposable is an object with a dispose method you can call, including with the using syntax.

Detecting a client disconnect in Express. On Express 5.2.1 with Node v24.19.0, listen to res.on('close') and check res.writableEnded. close on the response fires both when the response finished and when the connection died first. writableEnded is true only if your code called res.end, which res.send and res.json do. So not writableEnded inside that handler means the client left before you answered. Do not use req.on('close'). The request stream, an http.IncomingMessage, emits close when the request body has been consumed, not when the socket closes. After express.json reads a POST body it fires right away, while the client is still waiting.

## Code examples

**Example 1 — the controller, the signal, and the `'abort'` event.**

javascript

```
const controller = new AbortController();
const { signal } = controller;           // the read-only half you hand out

console.log('before:', signal.aborted, signal.reason);

signal.addEventListener('abort', () => {
  console.log('  abort event runs inside abort(), reason =', signal.reason.message);
}, { once: true });

console.log('calling abort()');
controller.abort(new Error('user cancelled'));
console.log('abort() returned');
console.log('after:', signal.aborted, signal.reason.message);

controller.abort(new Error('second call'));   // ignored: a signal aborts only once
console.log('reason unchanged:', signal.reason.message);

try {
  signal.throwIfAborted();
} catch (err) {
  console.log('throwIfAborted() threw signal.reason itself:', err === signal.reason);
}

// abort() with no argument: Node fills in a DOMException named AbortError
const c2 = new AbortController();
c2.abort();
const r = c2.signal.reason;
console.log(r instanceof DOMException, r.name, r.code, r.message);

// Real output (Node v24.19.0):
//   before: false undefined
//   calling abort()
//     abort event runs inside abort(), reason = user cancelled
//   abort() returned
//   after: true user cancelled
//   reason unchanged: user cancelled
//   throwIfAborted() threw signal.reason itself: true
//   true AbortError 20 This operation was aborted
```

The `'abort'` listener runs inside the `abort()` call, before the next line. The second `abort()` is ignored, so the first reason wins. With no argument, Node supplies a `DOMException` named `AbortError` (legacy numeric `code` 20).

**Example 2 — `AbortSignal.timeout` and `AbortSignal.any`.**

javascript

```
// 1. AbortSignal.timeout: aborts itself after the delay with a TimeoutError
const t = AbortSignal.timeout(50);
t.addEventListener('abort', () => {
  const r = t.reason;
  console.log('timeout fired:', r instanceof DOMException, r.name, r.code, r.message);
}, { once: true });

// 2. AbortSignal.any: one signal that aborts when ANY input aborts
const user = new AbortController();
const combined = AbortSignal.any([user.signal, AbortSignal.timeout(1000)]);
setTimeout(() => user.abort(new Error('user pressed cancel')), 100);
combined.addEventListener('abort', () => {
  console.log('combined aborted, reason:', combined.reason.message);
  console.log('reason is the same object:', combined.reason === user.signal.reason);
}, { once: true });

// 3. If an input is already aborted, any() returns an already-aborted signal
const already = AbortSignal.any([AbortSignal.abort('gone'), new AbortController().signal]);
console.log('already aborted:', already.aborted, JSON.stringify(already.reason));

// Real output (Node v24.19.0):
//   already aborted: true "gone"
//   timeout fired: true TimeoutError 23 The operation was aborted due to timeout
//   combined aborted, reason: user pressed cancel
//   reason is the same object: true
```

`AbortSignal.any` copies the reason of the input that aborted first, as the same object. If an input is already aborted, the result is already aborted, so `already aborted` prints first, during synchronous code. The timer behind `AbortSignal.timeout` does not keep the process alive on its own: a script whose only pending work is a 5-second `AbortSignal.timeout` exited in 0.06 s in a separate run (`/usr/bin/time node unref.mjs` → `0.06 s elapsed`).

**Example 3 — deadlines and cancel buttons for `fetch` and `http.request` against a local server.**

javascript

```
import http from 'node:http';
import { once } from 'node:events';

// A local server that takes 2 s to answer and logs when the client hangs up.
const server = http.createServer((req, res) => {
  const timer = setTimeout(() => res.end('slow answer'), 2000);
  res.on('close', () => {
    clearTimeout(timer);
    console.log(`server: ${req.url} closed, response finished = ${res.writableFinished}`);
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

// fetch: the signal goes in the init object
const t0 = Date.now();
try {
  await fetch(`${base}/fetch`, { signal: AbortSignal.timeout(100) });
} catch (err) {
  console.log(`fetch rejected after ~${Math.round((Date.now() - t0) / 100) * 100} ms:`, err.name, err.message);
}

// http.request / http.get: the signal goes in the options object
const ac = new AbortController();
const req = http.get(`${base}/http`, { signal: ac.signal }, (res) => res.resume());
req.on('error', (err) => console.log('http.get error:', err.name, err.code, '| cause:', err.cause));
setTimeout(() => ac.abort('client gave up'), 100);

await new Promise((r) => req.on('close', r)); // not once(): it rejects on 'error'
await new Promise((r) => setTimeout(r, 50)); // let the server log its side
server.close();

// Real output (Node v24.19.0):
//   fetch rejected after ~100 ms: TimeoutError The operation was aborted due to timeout
//   server: /fetch closed, response finished = false
//   http.get error: AbortError ABORT_ERR | cause: client gave up
//   server: /http closed, response finished = false
```

Both clients close their socket, so the server's `res` emits `'close'` with `writableFinished === false` and the server clears its timer. Note the different error shapes: `fetch` rejects with the `TimeoutError` `DOMException` that `AbortSignal.timeout` stored as the reason, while `http.get` emits Node's `AbortError` and puts your reason (`'client gave up'`) in `err.cause`. Do not wait for the request with `events.once(req, 'close')`: `once` rejects when the emitter emits `'error'`, and an aborted request does.

**Example 4 — one signal fans out to four core APIs (local file only).**

javascript

```
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { once, EventEmitter } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';

await writeFile('big.bin', Buffer.alloc(200 * 1024 * 1024)); // 200 MiB local file

const ac = new AbortController();
const { signal } = ac;

// An endless source: it only stops when something destroys the pipeline.
async function* ticks() { for (let i = 0; ; i++) { yield `tick ${i}\n`; await sleep(5); } }
const sink = new Writable({ write(chunk, enc, cb) { cb(); } });

const jobs = {
  'timers/promises setTimeout': sleep(60_000, 'done', { signal }),
  'fs/promises readFile':       readFile('big.bin', { signal }),
  'events.once':                once(new EventEmitter(), 'ready', { signal }),
  'stream/promises pipeline':   pipeline(Readable.from(ticks()), sink, { signal }),
};

setTimeout(() => ac.abort(), 10);   // one call cancels all four

const results = await Promise.allSettled(Object.values(jobs));
Object.keys(jobs).forEach((name, i) => {
  const { status, reason: e } = results[i];
  console.log(`${name.padEnd(27)} ${status}: ${e.name} code=${e.code}`);
});
console.log('sink destroyed by pipeline:', sink.destroyed);
await rm('big.bin');

// Real output (Node v24.19.0):
//   timers/promises setTimeout  rejected: AbortError code=ABORT_ERR
//   fs/promises readFile        rejected: AbortError code=ABORT_ERR
//   events.once                 rejected: AbortError code=ABORT_ERR
//   stream/promises pipeline    rejected: AbortError code=ABORT_ERR
//   sink destroyed by pipeline: true
```

A 200 MiB read takes longer than 10 ms, so `readFile` is still reading when the signal fires and stops between chunks. `pipeline` destroys every stream it manages, which is why `sink.destroyed` is `true`. All four rejections are Node's `AbortError` with the string code `'ABORT_ERR'`.

**Example 5 — `child_process.spawn` with a signal and a custom `killSignal`.**

javascript

```
import { spawn } from 'node:child_process';

const ac = new AbortController();
// A child that would run for 30 s on its own
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
  signal: ac.signal,
  killSignal: 'SIGINT',            // default is 'SIGTERM'
});

child.on('error', (err) => console.log('error event:', err.name, err.code));
child.on('exit', (code, sig) => console.log('exit event: code =', code, '| signal =', sig, '| child.killed =', child.killed));

setTimeout(() => ac.abort(), 100);

// Real output (Node v24.19.0):
//   error event: AbortError ABORT_ERR
//   exit event: code = null | signal = SIGINT | child.killed = true
```

When the signal aborts, Node sends the child `killSignal` (`'SIGTERM'` unless you set it; the option was added in v15.11.0), emits `'error'` with an `AbortError`, and then emits `'exit'` with `code === null` and the signal name. `exec`, `execFile` and `fork` take the same `signal` option (a separate run of `fork` with a signal printed `fork error AbortError ABORT_ERR` and `exit null SIGTERM`).

**Example 6 — writing your own abortable function, with listener cleanup.**

javascript

```
import { getEventListeners } from 'node:events';

// An abortable "work" function: resolves after ms, or rejects with the signal's reason.
function work(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();                 // 1. refuse to start if already aborted

    const onAbort = () => {                   // 3. on abort: stop the work, reject
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {          // 2. the real work
      signal?.removeEventListener('abort', onAbort);  // 4. finished: drop the listener
      resolve(`worked ${ms} ms`);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const ac = new AbortController();

// Many calls that finish normally, all sharing one long-lived signal
for (let i = 0; i < 20; i++) await work(1, { signal: ac.signal });
console.log('listeners left after 20 finished calls:', getEventListeners(ac.signal, 'abort').length);

// A call that gets cancelled
setTimeout(() => ac.abort(new Error('shutdown')), 20);
try { await work(1000, { signal: ac.signal }); }
catch (err) { console.log('cancelled with:', err.message); }

// A call made with a signal that is already aborted
try { await work(10, { signal: ac.signal }); }
catch (err) { console.log('refused to start:', err.message); }

// Real output (Node v24.19.0):
//   listeners left after 20 finished calls: 0
//   cancelled with: shutdown
//   refused to start: shutdown
```

The four numbered steps are the whole pattern: refuse to start on an aborted signal, start the work, on abort undo the work and reject with `signal.reason`, and on success remove the listener. Leave out step 4 and the listeners pile up on the shared signal. `{ once: true }` does not help here, because these listeners never run:

javascript

```
import { getEventListeners } from 'node:events';

// Same function WITHOUT step 4: the listener stays on the signal after success
function leakyWork(ms, { signal }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

const ac = new AbortController();
for (let i = 0; i < 20; i++) await leakyWork(1, { signal: ac.signal });
console.log('listeners left after 20 finished calls:', getEventListeners(ac.signal, 'abort').length);

// Real output (Node v24.19.0):
//   listeners left after 20 finished calls: 20
```

No warning was printed in this run, so nothing tells you about the leak. Each leftover listener keeps its closure (here the timer and the `reject` function) alive for as long as the signal lives.

**Example 7 — `events.addAbortListener`: a listener you can dispose of.**

javascript

```
import { addAbortListener, getEventListeners } from 'node:events';

const ac = new AbortController();

// Returns a Disposable; calling [Symbol.dispose]() removes the listener.
const disposable = addAbortListener(ac.signal, () => console.log('listener A ran'));
console.log('typeof dispose:', typeof disposable[Symbol.dispose]);
console.log('listeners:', getEventListeners(ac.signal, 'abort').length);
disposable[Symbol.dispose]();
console.log('after dispose:', getEventListeners(ac.signal, 'abort').length);

// It still runs a listener added to an ALREADY-aborted signal (addEventListener does not)
const dead = AbortSignal.abort();
dead.addEventListener('abort', () => console.log('addEventListener on aborted signal ran'));
addAbortListener(dead, () => console.log('addAbortListener on aborted signal ran'));
console.log('sync code done');

// Real output (Node v24.19.0):
//   typeof dispose: function
//   listeners: 1
//   after dispose: 0
//   sync code done
//   addAbortListener on aborted signal ran
```

`addAbortListener` returns a `Disposable`, so in Node 24 you can also write `using sub = addAbortListener(signal, onAbort);` and the listener is removed when the block exits. It has one more difference from `addEventListener`: given a signal that is already aborted, it still calls the listener (on a later tick, after `sync code done`), while `addEventListener` never fires for an `'abort'` that already happened.

**Example 8 — cancelling the losing branches of `Promise.race`.**

javascript

```
import http from 'node:http';
import { once } from 'node:events';

// One local server that plays three "mirrors" with different speeds.
const delays = { '/a': 300, '/b': 50, '/c': 600 };
const server = http.createServer((req, res) => {
  const timer = setTimeout(() => res.end(`answer from ${req.url}`), delays[req.url]);
  res.on('close', () => {
    clearTimeout(timer);
    console.log(`server ${req.url}: ${res.writableFinished ? 'sent its answer' : 'client hung up, work stopped'}`);
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

async function fastest(paths) {
  const ac = new AbortController();
  try {
    return await Promise.race(paths.map(async (p) => {
      const res = await fetch(base + p, { signal: ac.signal });
      return res.text();
    }));
  } finally {
    ac.abort(new Error('lost the race'));   // cancel every branch still running
  }
}

console.log('winner:', await fastest(['/a', '/b', '/c']));
await new Promise((r) => setTimeout(r, 100));
server.close();

// Real output (Node v24.19.0):
//   server /b: sent its answer
//   winner: answer from /b
//   server /c: client hung up, work stopped
//   server /a: client hung up, work stopped
```

`Promise.race` settles with `/b`, and the `finally` block aborts the shared controller. The two `fetch` calls still in flight close their sockets, so the server stops the work for `/a` and `/c`. Without the abort, both would run to completion and their answers would be thrown away. The losers' rejections do not become unhandled rejections, because `Promise.race` has already attached handlers to every input.

**Example 9 — edge case: in Express 5, `req.on('close')` fires before the response is sent.**

The task: "stop working when the client disconnects". The obvious listener is `req.on('close')`. This probe (Express 5.2.1) logs both events for a POST with a JSON body, once when the client waits and once when it disconnects at 100 ms:

javascript

```
const express = require('express');               // express@5.2.1
const app = express();
app.use(express.json());

app.post('/slow', (req, res) => {
  const t0 = Date.now();
  const at = () => `~${String(Math.round((Date.now() - t0) / 100) * 100).padStart(3)} ms`;
  req.on('close', () => console.log(`  ${at()} req 'close'  (res.writableEnded=${res.writableEnded})`));
  res.on('close', () => console.log(`  ${at()} res 'close'  (res.writableEnded=${res.writableEnded})`));
  setTimeout(() => { if (!res.writableEnded) res.json({ ok: true }); }, 300);
});

const server = app.listen(4575, async () => {
  const send = (signal) => fetch('http://127.0.0.1:4575/slow', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}', signal,
  }).then((r) => r.text());

  console.log('A: client waits for the full response');
  await send();
  console.log('B: client disconnects after 100 ms');
  await send(AbortSignal.timeout(100)).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  server.close();
});

// Real output (Node v24.19.0):
//   A: client waits for the full response
//     ~  0 ms req 'close'  (res.writableEnded=false)
//     ~300 ms res 'close'  (res.writableEnded=true)
//   B: client disconnects after 100 ms
//     ~  0 ms req 'close'  (res.writableEnded=false)
//     ~100 ms res 'close'  (res.writableEnded=false)
```

In both cases `req` emits `'close'` at about 0 ms, as soon as `express.json()` has read the body. In case A the client is still waiting and gets its answer, so treating this as a disconnect would cancel a healthy request. `res` emits `'close'` at the real moment the connection ends, and `res.writableEnded` separates the two cases: `true` in A (we answered), `false` in B (the client left first). (In a separate run with a GET and no body, `req` emitted `'close'` only after the response or the disconnect, which is why this bug is easy to miss when you test with GET.)

**Example 10 — wiring it up: a per-request signal in Express 5.2.1.**

javascript

```
const express = require('express');               // express@5.2.1
const { setTimeout: sleep } = require('node:timers/promises');

const app = express();
app.use(express.json());

// One AbortController per request, aborted when the client goes away early.
app.use((req, res, next) => {
  const ac = new AbortController();
  res.on('close', () => {
    // 'close' also fires after a normal response; writableEnded tells them apart.
    if (!res.writableEnded) ac.abort(new Error('client disconnected'));
  });
  res.locals.signal = ac.signal;
  next();
});

app.post('/report', async (req, res) => {
  const { signal } = res.locals;
  try {
    for (let step = 1; step <= 5; step++) {
      await sleep(100, null, { signal });          // stands in for one slow query
      console.log(`server: step ${step} done`);
    }
    res.json({ ok: true, rows: req.body.rows });
  } catch (err) {
    if (signal.aborted) return console.log(`server: stopped early (${signal.reason.message})`);
    throw err;
  }
});

const server = app.listen(4574, async () => {
  const post = (signal) => fetch('http://127.0.0.1:4574/report', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows: 3 }), signal,
  });

  console.log('client 1 waits for the answer');
  console.log('client 1 got:', await (await post()).text());

  console.log('client 2 hangs up after 250 ms');
  await post(AbortSignal.timeout(250)).catch((e) => console.log('client 2:', e.name));
  await sleep(200);
  server.close();
});

// Real output (Node v24.19.0):
//   client 1 waits for the answer
//   server: step 1 done
//   server: step 2 done
//   server: step 3 done
//   server: step 4 done
//   server: step 5 done
//   client 1 got: {"ok":true,"rows":3}
//   client 2 hangs up after 250 ms
//   server: step 1 done
//   server: step 2 done
//   client 2: TimeoutError
//   server: stopped early (client disconnected)
```

The middleware creates a controller per request and aborts it from `res.on('close')` only when `res.writableEnded` is `false`. The handler passes `res.locals.signal` to every slow call, so client 2's request stops after two of five steps instead of running all five for nobody.

**Example 11 — reason types: what you actually catch.**

javascript

```
import { setTimeout as sleep } from 'node:timers/promises';

for (const reason of [undefined, 'timeout!', null, 0, new Error('real error')]) {
  const signal = AbortSignal.abort(reason);       // already aborted
  const shown = (v) => v instanceof Error ? `${v.constructor.name}(${v.name}: ${v.message})` : JSON.stringify(v);

  // fetch hands back the reason itself (fails before any network I/O)
  const f = await fetch('http://127.0.0.1:9/', { signal }).catch((e) => e);
  // timers/promises wraps it: AbortError with the reason in .cause
  const t = await sleep(10, null, { signal }).catch((e) => e);

  console.log(`abort(${reason instanceof Error ? 'new Error(...)' : JSON.stringify(reason)})`);
  console.log('   signal.reason   :', shown(signal.reason));
  console.log('   fetch rejects   :', shown(f));
  console.log('   sleep rejects   :', shown(t), '| cause:', shown(t.cause));
}

// Real output (Node v24.19.0):
//   abort(undefined)
//      signal.reason   : DOMException(AbortError: This operation was aborted)
//      fetch rejects   : DOMException(AbortError: This operation was aborted)
//      sleep rejects   : AbortError(AbortError: The operation was aborted) | cause: DOMException(AbortError: This operation was aborted)
//   abort("timeout!")
//      signal.reason   : "timeout!"
//      fetch rejects   : "timeout!"
//      sleep rejects   : AbortError(AbortError: The operation was aborted) | cause: "timeout!"
//   abort(null)
//      signal.reason   : null
//      fetch rejects   : null
//      sleep rejects   : AbortError(AbortError: The operation was aborted) | cause: null
//   abort(0)
//      signal.reason   : 0
//      fetch rejects   : 0
//      sleep rejects   : AbortError(AbortError: The operation was aborted) | cause: 0
//   abort(new Error(...))
//      signal.reason   : Error(Error: real error)
//      fetch rejects   : Error(Error: real error)
//      sleep rejects   : AbortError(AbortError: The operation was aborted) | cause: Error(Error: real error)
```

`fetch` passes the reason through untouched, so `abort('timeout!')` makes `fetch` reject with a string, and `abort(null)` makes it reject with `null`. A `catch (err) { log(err.message) }` then throws a `TypeError` of its own on `null`. Node core APIs always wrap the reason in an `AbortError` and expose it as `err.cause`. Only `undefined` is replaced by the default `DOMException`; `null` and `0` are stored as they are.

## Common mistakes & gotchas

- err.name === 'AbortError' works for Node core APIs, but fetch rejects with the reason itself. After abort(new Error('x')) the name is Error, and after AbortSignal.timeout it is TimeoutError. Check signal.aborted on the signal you passed.
- err.code is not the same everywhere. Node's AbortError has the string ABORT_ERR. A DOMException has a legacy numeric code: 20 for AbortError, 23 for TimeoutError.
- With AbortSignal.timeout, timers/promises, fs/promises, events.once, pipeline, http.request, and child_process all reject with name AbortError. The TimeoutError is on err.cause.
- abort('stop') stores a string. fetch rejects with that string, which has no stack and no message. Pass an Error, or pass nothing.
- An abort listener added after the signal is already aborted never runs, because the event is dispatched once. The operation then hangs. Check signal.aborted or call throwIfAborted first, or use events.addAbortListener, which calls the listener for an already-aborted signal.
- once: true only removes a listener after it runs. On a long-lived signal, listeners from finished operations pile up.
- req.on('close') in Express fires once the request body has been read, which for a POST is before you respond. Use res.on('close') with not writableEnded.
- events.once(req, 'close') on an aborted request rejects, because events.once rejects on error, and an aborted http.request emits error before close.
- Abort stops pending I/O. A database write the server already committed stays committed. Cancellation is not a rollback.

## Best practices

- Accept signal in every async function you write that does I/O or waits, and pass it down. A signal that stops at the first layer cancels nothing below it.
- Use AbortSignal.timeout for deadlines instead of racing a hand-made timer. It aborts the underlying work, and its timer does not keep the process alive.
- Combine reasons with AbortSignal.any: a deadline, a client disconnect, and a shutdown signal, passed as one signal.
- Abort with an Error that says why, so logs and err.cause carry a message and a stack.
- Decide cancelled or failed with signal.aborted, then read signal.reason. Do not log a cancellation as a server error.
- Remove listeners on the success path, or use the Disposable from events.addAbortListener.
- After Promise.race or Promise.any, abort the shared controller in finally so the losers stop.

## ⭐ Interview lens

> **Q: “Why are there two objects, `AbortController` and `AbortSignal`, instead of one?”**  
> They split the right to cancel from the ability to watch cancellation. The controller has abort. The signal only has aborted, reason, throwIfAborted, and the abort event. You pass the signal to any number of operations and you keep the controller, so a library that receives the signal cannot cancel your other work. There is no signal.abort instance method. AbortSignal.abort is a separate factory that returns an already-aborted signal. For example, a request handler creates one controller, passes its signal into the database call and the upstream fetch, and calls abort when the client leaves. The limit is that the signal is cooperative. An API that never reads the signal will not stop, and abort does not undo work that already finished.

> **Q: “How do you put a 2-second deadline on a `fetch` and also let the user cancel it?”**  
> Pass one signal built with AbortSignal.any of two inputs: the user's controller.signal, and AbortSignal.timeout(2000). fetch(url, { signal: that }) aborts when either input aborts, and any copies that input's reason onto the combined signal. A TimeoutError DOMException means the deadline won. Your own Error means the user cancelled. fetch rejects with that reason itself, not with a wrapper. The limit is the shape if you use a Node core API instead of fetch. timers or fs reject with Node's AbortError and put the reason on err.cause, so the same deadline shows up as name AbortError with cause.name TimeoutError.

> **Q: “A client closes the browser tab during a slow Express 5 request. How does the handler find out?”**  
> Listen on the response, not the request. res.on('close', () => { if (!res.writableEnded) controller.abort(...) }), and pass that controller's signal into every slow call in the handler. close on the response fires both when you finished the response and when the connection died first. writableEnded is true only after your code ended the response, so the check tells those apart. req.on('close') is the wrong event: on the incoming message it means the body has been consumed, which for a POST is before you respond. The limit is that abort does not roll back a write you already committed. It only stops work that is still pending.

> **Q: “`Promise.race` returned the fastest of three requests. What happens to the other two?”**  
> They keep running. A promise cannot be cancelled, and race only chooses which result you observe. To stop the losers, pass one shared signal into all three requests and call controller.abort in a finally after the race settles. The losers then close their sockets and reject. race has already attached handlers, so those rejections are not unhandled. The limit is any API that ignores the signal. Aborting the controller does nothing for a call you forgot to pass the signal into, and it does not undo a side effect that already happened.

## Cheat-card

- Create a controller, pass its signal, and call abort with an Error that says why.
- aborted flips once and stays true. reason defaults to a DOMException named AbortError. abort fires synchronously inside abort().
- Factories: AbortSignal.timeout(ms), AbortSignal.any of several signals, and AbortSignal.abort for an already-aborted signal.
- Core options that take signal: fetch, http.request, fs.readFile and fs/promises, timers/promises, events.once, stream.pipeline, and spawn, exec, execFile, and fork.
- fetch rejects with signal.reason as it is. Node core rejects with AbortError, code ABORT_ERR, and the reason on err.cause.
- Detect a cancel with signal.aborted, not with err.name.
- In your own function: check first, do the work, on abort undo and reject with signal.reason, and on success remove the listener.
- Express disconnect: res close, and only abort when writableEnded is false. Not req close.
- After a race, abort the shared controller in finally.

## Good to know

- “What does `timers/promises` reject with when you abort it with `new Error('stop')`?” Node's AbortError: name AbortError, code ABORT_ERR, an Error but not a DOMException, with your Error on err.cause. fetch with the same signal rejects with your Error itself.

- AbortController was added in v15.0.0 and stopped being experimental in v15.4.0.
- The optional reason argument to abort was added in v17.2.0.
- AbortSignal.throwIfAborted and AbortSignal.timeout were added in v17.3.0.
- AbortSignal.abort, which returns an already-aborted signal, was added in v15.12.0.
- AbortSignal.any was added in v20.3.0.
- events.addAbortListener was added in v20.5.0 and is stable since v24.0.0.
- req close meaning "the body has been consumed" is the behaviour since v16.0.0.

---

## Learn More

- [AbortController (Globals) nodejs.org](https://nodejs.org/api/globals.html)
- [events.addAbortListener nodejs.org](https://nodejs.org/api/events.html)
- [AbortSignal developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
- [AbortSignal.any() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static)
- [AbortSignal.timeout() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static)
- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
