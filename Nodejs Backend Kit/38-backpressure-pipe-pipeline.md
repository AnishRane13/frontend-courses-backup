---
title: "Backpressure, pipe & pipeline"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/backpressure-piping
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Backpressure, pipe & pipeline

*10 min read · Updated 24 Jul 2026 Topic 29 of 70 Bookmark Mark done Why it matters Backpressure is the single most important concept in the entire chapter · Topic 29 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/backpressure-piping](https://www.geekyfrontend.in/learn/nodejs-backend-kit/backpressure-piping)

---

## Say it in 30 seconds

Backpressure is a slow consumer telling a fast producer to pause, so the bytes waiting in memory stay bounded. `write` returns false when the buffer is full, and the `drain` event says you may continue. `pipe` and `pipeline` run that loop for you. The trade-off of the older `pipe` is errors. It does not destroy the other streams, so a failure in the middle leaks file descriptors, which is why `pipeline` is the one to call.

## Why it matters

Backpressure is why streams stay memory-safe. Get it wrong and the service is fine in tests, then buffers gigabytes under load and gets killed, because the bug only shows up when the source is faster than the sink.

`pipe` and `pipeline` are what wire that pause and resume for you. Knowing why `pipeline` exists, and what `pipe` gets wrong, is the practical half of this lesson. Modes, buffers, highWaterMark, and events exist to serve this.

## The concept, simply

Backpressure is a fast producer connected to a slow consumer. A Readable from a fast disk feeding a Writable that is a slow socket must be throttled, or the difference piles up in memory.

![A fast Readable feeding a slow Writable: when write returns false the source is paused, and when the buffer drains a drain event resumes it, keeping memory bounded](assets/i26_01_e8e417ed.svg)


The signal is `write()`. `false` means the buffer is full, so pause. The all-clear is `drain`: the buffer has dropped under the highWaterMark, so resume. Write until you get false, pause the source, wait for `drain`, resume. `pipe` and `pipeline` run that loop. You should almost never write it by hand.

## How it works

When a Readable is piped to a Writable, each chunk goes to `dest.write(chunk)`. If that returns false, `pipe` calls `source.pause()`, which stops `data` events and, once the source's own buffer fills, stops it pulling from the file or socket. The Writable keeps draining to the resource. When the buffered amount falls below the Writable's highWaterMark, it emits `drain`, and `pipe` calls `source.resume()`. Buffered memory across the two streams stays about the sum of their highWaterMarks, however large the file is and however slow the sink is.

`pipe` handles that pause correctly and handles errors badly. If a stream in the chain emits `error`, `pipe` does not destroy the others. In `a.pipe(b).pipe(c)`, an error on `b` leaves `a` and `c` open. Their descriptors or sockets leak, and under load the process runs out. An unhandled `error` also crashes the process. Safe use of `pipe` means an `error` listener on every stream and a manual destroy of the others.

![pipe versus pipeline on error: with pipe a middle stream erroring leaves the others open and leaking, while pipeline destroys every stream and reports the error to one callback](assets/i26_02_6159e80e.svg)


`stream.pipeline(...streams, callback)`, and the promise form from `node:stream/promises`, wires backpressure the same way. If any stream errors or closes early, it destroys the others so nothing leaks, forwards the error to one callback or a rejected promise, and reports success only when the last stream has actually finished. Since Node 15 the promise form is `await pipeline(...)` inside `try/catch`.

A client disconnect is the same idea. If you stream a response and the client hangs up, `res` errors or closes. `pipeline` destroys the file stream, so you stop reading a file nobody is receiving. Bare `pipe` keeps reading.

## Code examples

**1. The wrong way — ignoring backpressure.** This is the code that passes tests and OOMs in production.

javascript

```
import { createReadStream, createWriteStream } from 'node:fs';

const src = createReadStream('huge.bin');
const dst = createWriteStream('/dev/slow-disk/out.bin');

// BAD: pushes every chunk into dst regardless of its buffer state.
src.on('data', (chunk) => {
  dst.write(chunk);          // return value ignored — backpressure lost
});
src.on('end', () => dst.end());
// If dst is slower than src, dst's buffer grows without bound → memory blows up.
```

**2. The right way — `pipeline()` from `node:stream/promises`.** Backpressure, error propagation, and cleanup all handled.

javascript

```
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

try {
  await pipeline(
    createReadStream('huge.bin'),
    createGzip(),
    createWriteStream('huge.bin.gz')
  );
  console.log('Done — memory stayed flat, all streams cleaned up.');
} catch (err) {
  // ANY stream erroring lands here; every stream was already destroyed.
  console.error('Pipeline failed:', err.message);
}
```

**3. Streaming an HTTP response safely, handling client disconnect.**

javascript

```
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

createServer(async (req, res) => {
  try {
    await pipeline(createReadStream('./big.mp4'), res);
  } catch (err) {
    // Client disconnect (ERR_STREAM_PREMATURE_CLOSE) or read error.
    // pipeline already destroyed the file stream — nothing leaks.
    if (!res.headersSent) { res.statusCode = 500; res.end(); }
  }
}).listen(3000);
```

**4. The manual drain loop — what `pipeline()` does for you.** Write this once to understand it, then never again in real code.

javascript

```
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';

async function copyRespectingBackpressure(from, to) {
  const src = createReadStream(from);
  const dst = createWriteStream(to);
  for await (const chunk of src) {          // paused-mode: one chunk at a time
    if (!dst.write(chunk)) {                // buffer full?
      await once(dst, 'drain');             // wait for it to empty
    }
  }
  dst.end();
  await once(dst, 'finish');
}
// pipeline() also handles errors and destroys both streams — this version does not.
```

## Common mistakes & gotchas

- **Ignoring `write()` in a manual loop.** Memory grows with no error, and only when the sink is slower than the source.
- **Bare `pipe()` and assuming errors are handled.** A mid-chain error leaves the other streams open, and an unhandled `error` crashes the process.
- **Cleaning up by hand after `pipe`.** You attach `error` on every stream and destroy the rest. That is the work `pipeline` does.
- **Mixing `await pipeline()` with the callback form.** The promise version is imported from `node:stream/promises`. The one from `node:stream` takes a callback and returns the last stream.
- **No plan for a client disconnect** while streaming a response. Without `pipeline`, the source keeps reading a file nobody will receive.
- **Raising `highWaterMark` to go faster.** It raises the memory ceiling and delays backpressure. Throughput is still the sink's rate.

## Best practices

- **Default to `pipeline()`** from `node:stream/promises`, with `await` inside `try/catch`, even for two streams.
- **Never ignore `write()`'s boolean** in a hand-written loop. Pause on false. Resume on `drain`.
- **Let backpressure work.** Do not buffer chunks in an array, and do not raise highWaterMark to hide a slow sink.
- **Handle the error in one place.** With `pipeline` that is the catch or the callback.
- **For a streaming response, use `pipeline`** so a disconnect destroys the source.
- **Prefer `stream/promises` helpers** (`pipeline`, `finished`) over listening for `end`, `finish`, and `close` yourself.

## ⭐ Interview lens

> **Q: What is backpressure and what mechanism implements it?**  
> A: Backpressure is a slow consumer throttling a fast producer so the data sitting in memory stays bounded. The mechanism is the Writable. `write(chunk)` returns false when the internal buffer reaches `highWaterMark`. The producer pauses and waits for the `drain` event, which means the buffer has dropped back under that mark, and then it writes again. On a piped Readable, `pipe` turns that false into `pause` and that `drain` into `resume`, so the file or socket stops producing. `pipeline` runs the same loop and also destroys every stream if one of them fails. The limit is a hand-written loop that ignores the boolean. Nothing throws. The buffer grows, and you only notice when the sink is the slow one, which is production, not the test.

> **Q: Why prefer `pipeline()` over `pipe()`?** (The signature question.)  
> A: `pipe` and `pipeline` both pause a fast source when a slow destination fills. `pipe` stops there. If one stream emits `error`, the others stay open, so a file descriptor or a socket leaks, and if nobody was listening for `error` the process crashes. `pipeline` destroys every stream in the chain when any of them errors or closes early, and it reports that failure to one callback or one rejected promise. It also resolves only when the last stream has really finished. The promise form is `import { pipeline } from 'node:stream/promises'` and `await pipeline(a, b, c)` inside `try/catch`. The limit of `pipe` plus a careful `error` listener is that you have to remember every stream, including ones added later. `pipeline` already has the list.

> **Q: You ignore the boolean from `write()` and just keep writing. What breaks and when?**  
> A: Nothing throws. `write` still accepts the chunk, and the Writable's buffer grows past `highWaterMark` with no ceiling. Memory climbs and the process is eventually killed. It shows up when the sink is slower than the source: a fast file into a slow client, a tight loop into a disk that cannot keep up. A unit test where both sides are in memory often stays under the mark, so the bug looks like it is not there. The fix is the same protocol either way. Stop when `write` returns false, continue on `drain`, or hand the streams to `pipeline` and let it do that.

> **Q: How do you correctly handle a client disconnecting mid-stream while you serve a large file?**  
> A: Use `await pipeline(fileStream, res)` inside `try/catch`. The response is a Writable. When the client disconnects, that Writable closes or errors, `pipeline` rejects, often with `ERR_STREAM_PREMATURE_CLOSE`, and it destroys the file Readable. You stop reading a file nobody will receive. Bare `file.pipe(res)` keeps reading, because `pipe` does not tear the source down on a destination error. The limit is treating that rejection as a server failure you must log at high severity. A client going away is normal. You still want the file handle closed, which is the part `pipeline` gives you.

## Cheat-card

- **Backpressure:** a slow sink throttles a fast source so memory stays bounded.
- **Signal:** `write()` returns false at the highWaterMark, so pause. `drain` means resume.
- **`pipe()`:** backpressure yes, errors and cleanup no. A mid-chain error leaks the other streams and can crash the process.
- **`pipeline()`:** the same backpressure, and it destroys every stream on error and reports to one place. Use this.
- **Import** `pipeline` from `node:stream/promises` and `await pipeline(a, b, c)` in `try/catch`.
- **Do not** ignore `write()`'s return, buffer chunks to defeat backpressure, or raise highWaterMark to go faster.

## Good to know

- In `a.pipe(b).pipe(c)`, if `b` errors, `a` and `c` are not closed. `a` keeps reading, `c` stays open, and an unhandled `error` on `b` crashes the process. `pipeline(a, b, c)` destroys all three.
- Raising `highWaterMark` does not raise throughput. It raises how much data can sit in the buffer before backpressure starts. The slowest stage still sets the rate. A larger mark can cut a few syscalls and mostly trades memory for a later pause.
- Cancel a running pipeline with `await pipeline(a, b, c, { signal })`. You get Node's `AbortError`, code `ABORT_ERR`, and your reason on `err.cause`. Streams that have already ended or finished are not destroyed.
- Append without closing the destination with `await pipeline(src, out, { end: false })`, promise form only, added in v18.0.0, v17.2.0, and v16.14.0, or `src.pipe(out, { end: false })`. Then call `out.end()` and wait for `finish`. The promise can resolve before the destination has flushed. Middle Transforms are still ended. The destination is not destroyed on error. The promise form of `pipeline` itself was added in v15.0.0.
## Learn More

- [Backpressuring in Streams | Node.js Learn nodejs.org](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
- [Stream | Node.js Documentation nodejs.org](https://nodejs.org/api/stream.html)
- [Node.js Streams EXPLAINED: Backpressure, Buffer Overflow & drain Event Leela Web Dev](https://www.youtube.com/watch?v=scASodUqlbo)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0*

### The `signal` option of `pipeline()`: cancelling a running pipeline

The promise form of `pipeline()` (from `node:stream/promises`, added in v15.0.0) takes an options object as its last argument, and `options.signal` is an `AbortSignal`. When the signal aborts, the pipeline destroys its streams with an `AbortError` and the promise rejects. You need it when the reason to stop comes from outside the streams: the user cancels an export, a deadline (`AbortSignal.timeout`) passes, or the server is shutting down. Without it you would keep references to every stream and destroy each one by hand, which is the error-prone work `pipeline()` exists to remove. Lesson [73 — AbortController and AbortSignal](22-abortcontroller-and-abortsignal.md) covers the signal itself and the different error shapes across APIs.

How it works:

1. `pipeline(a, b, c, { signal })` adds an `'abort'` listener to `signal` (with `events.addAbortListener`, per the v24.19.0 source). If the signal is already aborted, the pipeline fails at once.
2. When the signal aborts, `pipeline()` creates Node's `AbortError`: `name: 'AbortError'`, `code: 'ABORT_ERR'`, `message: 'The operation was aborted'`, and `cause: signal.reason`. It is an `Error`, not a `DOMException`.
3. It calls `destroy(abortError)` on every stream that is still active. Per the docs, streams that are already done are left alone: a Readable that has emitted `'end'` or `'close'`, and a Writable that has emitted `'finish'` or `'close'`. A destination passed with `{ end: false }` is also left alone (see the next topic).
4. The promise rejects with the `AbortError`. To tell "cancelled" from "failed", check `signal.aborted` (or `err.name === 'AbortError'` here, since `pipeline` always wraps the reason) and read the reason from `err.cause`.
5. Async generator stages get `{ signal }` as their second argument. It is the pipeline's own internal signal, not the object you passed, but it aborts when yours does (and when any stage fails), so a stage can pass it on to `fetch`, timers or database calls. In a separate run, after `ac.abort()` the generator's `signal.aborted` was `true` and `signal === ac.signal` was `false`.

**Example — abort an endless gzip pipeline after ~100 ms.**

javascript

```
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';

// An endless source, a gzip Transform and a slow sink. Abort after ~100 ms.
let produced = 0;
const src = new Readable({ read() { setTimeout(() => this.push(`row ${++produced}\n`), 5); } });
const gzip = createGzip();
let written = 0;
const dst = new Writable({ write(c, _e, cb) { written += c.length; setTimeout(cb, 5); } });

const ac = new AbortController();
setTimeout(() => ac.abort(new Error('user cancelled export')), 100);

try {
  await pipeline(src, gzip, dst, { signal: ac.signal });
} catch (err) {
  console.log('name   :', err.name);
  console.log('code   :', err.code);
  console.log('message:', err.message);
  console.log('cause  :', err.cause?.message);
  console.log('instanceof Error:', err instanceof Error, '| DOMException:', err instanceof DOMException);
}
await sleep(20);
for (const [name, s] of [['src', src], ['gzip', gzip], ['dst', dst]]) {
  console.log(`${name.padEnd(4)} destroyed=${s.destroyed} errored=${s.errored?.name ?? null}`);
}
console.log('rows produced before abort > 0:', produced > 0);

// Real output (Node v24.19.0):
//   name   : AbortError
//   code   : ABORT_ERR
//   message: The operation was aborted
//   cause  : user cancelled export
//   instanceof Error: true | DOMException: false
//   src  destroyed=true errored=AbortError
//   gzip destroyed=true errored=AbortError
//   dst  destroyed=true errored=AbortError
//   rows produced before abort > 0: true
```

All three streams, the source, the Transform in the middle and the sink, end up destroyed with the `AbortError` as `errored`. The reason passed to `abort()` is not the rejection itself; it is in `err.cause`.

**Example — which streams get destroyed: a source that has already ended is left alone.**

javascript

```
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// The source ends at once (2 small chunks); the sink needs 50 ms per chunk.
const src = Readable.from(['a', 'b']);
const dst = new Writable({ objectMode: true, write(c, _e, cb) { setTimeout(cb, 50); } });
src.on('end', () => console.log("src 'end' (before the abort)"));

const err = await pipeline(src, dst, { signal: AbortSignal.timeout(30) }).catch((e) => e);
console.log('pipeline rejected:', err.name, '| cause:', err.cause.name);
console.log('src errored:', src.errored?.name ?? null, '| dst errored:', dst.errored?.name ?? null);

// Real output (Node v24.19.0):
//   src 'end' (before the abort)
//   pipeline rejected: AbortError | cause: TimeoutError
//   src errored: null | dst errored: AbortError
```

The source emitted `'end'` before the 30 ms deadline, so `pipeline()` did not destroy it with the `AbortError` (`src errored: null`); the sink was still writing and got it. Note that with `AbortSignal.timeout` the rejection is still named `AbortError`; the `TimeoutError` is in `err.cause`.

**Example — a signal that is already aborted.**

javascript

```
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
let reads = 0;
const src = new Readable({ read() { reads++; this.push(null); } });
const dst = new Writable({ write(c, e, cb) { cb(); } });
const err = await pipeline(src, dst, { signal: AbortSignal.abort('too late') }).catch((e) => e);
console.log(err.name, err.code, '| cause:', err.cause, '| _read() calls:', reads, '| destroyed:', src.destroyed, dst.destroyed);

// Real output (Node v24.19.0):
//   AbortError ABORT_ERR | cause: too late | _read() calls: 0 | destroyed: true true
```

The source's `_read()` was never called: no data moved, and both streams were destroyed. The string reason `'too late'` comes back as `err.cause`.

### `{ end: false }`: keeping the destination open

By default, when the source ends, `pipe()` and `pipeline()` call `end()` on the destination. `{ end: false }` turns that off, so the destination stays writable after the source is done. You need this to write several sources into one destination in turn (join log files, write a header, then a body, then a footer), or to pipe into a stream you do not own, such as a long-lived socket. Without it, the first source ends the destination and the second write fails.

- `readable.pipe(destination, { end: false })`: `pipe()` was added in v0.9.4 and takes `end` (default `true`); the v24 docs list no history entry for the option.
- `pipeline(...streams, { end: false })`: the `end` option was added in v18.0.0, v17.2.0 and v16.14.0, **in the promise form only** (`node:stream/promises`). The callback form from `node:stream` has no options parameter at all (see the example below). The docs add: "Transform streams are always ended, even if this value is `false`." Only the last stream is kept open.

How it works:

1. With `{ end: false }`, the pipe still forwards every chunk and still applies backpressure.
2. When the source emits `'end'`, the destination's `end()` is not called; `writableEnded` stays `false`.
3. The promise from `pipeline(…, { end: false })` resolves when the source side is done. It does not wait for the destination to write what it buffered, and it does not wait for `'finish'`, because there is none yet.
4. You call `destination.end()` yourself once, after the last source, and wait for `'finish'` (or `finished(destination)`) to know the data is written.
5. On an error or abort, `pipeline()` destroys the other streams but **not** the destination: in the v24.19.0 source, a last stream with `end: false` is left out of the list of streams to destroy. You end or destroy it yourself in your `catch` (example below).

**Example — append three files into one write stream, with `pipeline` and with `pipe`.**

javascript

```
import { createReadStream, createWriteStream } from 'node:fs';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';

await writeFile('part1.log', 'jan: 3 errors\n');
await writeFile('part2.log', 'feb: 0 errors\n');
await writeFile('part3.log', 'mar: 7 errors\n');

// 1. pipeline(..., { end: false }): each file is appended; the writable stays open.
const out = createWriteStream('all.log');
for (const part of ['part1.log', 'part2.log', 'part3.log']) {
  await pipeline(createReadStream(part), out, { end: false });
  console.log(`after ${part}: out.writableEnded = ${out.writableEnded}`);
}
out.end('-- end of report --\n');            // we end it ourselves, once
await once(out, 'finish');
process.stdout.write(await readFile('all.log', 'utf8'));

// 2. The same with pipe(dest, { end: false }), one source after another.
const out2 = createWriteStream('all2.log');
for (const part of ['part1.log', 'part2.log']) {
  const src = createReadStream(part);
  src.pipe(out2, { end: false });
  await once(src, 'end');                     // wait for this source before starting the next
}
out2.end();
await once(out2, 'finish');
console.log('pipe version:', JSON.stringify(await readFile('all2.log', 'utf8')));

// 3. Without { end: false }, the first pipeline ends the writable and the second one fails.
const out3 = createWriteStream('all3.log');
await pipeline(createReadStream('part1.log'), out3);
try { await pipeline(createReadStream('part2.log'), out3); }
catch (err) { console.log('second pipeline without end:false ->', err.code); }

for (const f of ['part1.log', 'part2.log', 'part3.log', 'all.log', 'all2.log', 'all3.log']) await rm(f);

// Real output (Node v24.19.0):
//   after part1.log: out.writableEnded = false
//   after part2.log: out.writableEnded = false
//   after part3.log: out.writableEnded = false
//   jan: 3 errors
//   feb: 0 errors
//   mar: 7 errors
//   -- end of report --
//   pipe version: "jan: 3 errors\nfeb: 0 errors\n"
//   second pipeline without end:false -> ERR_STREAM_UNABLE_TO_PIPE
```

Each `pipeline(…, { end: false })` leaves `out.writableEnded === false`, so the next file appends to the same stream, and the final `out.end('-- end of report --\n')` writes a footer and closes it. With `pipe()`, wait for each source's `'end'` before starting the next one, or the files interleave. Without `{ end: false }`, the first pipeline ends `out3`, and the second one rejects with `ERR_STREAM_UNABLE_TO_PIPE`.

**Example — the callback form of `pipeline()` takes no options.**

javascript

```
import { pipeline, Readable, Writable } from 'node:stream';   // the CALLBACK form

const sink = new Writable({ write(c, _e, cb) { cb(); } });
try {
  // The callback form has no options parameter: the object is taken as one more stream.
  pipeline(Readable.from(['a']), sink, { end: false }, () => {});
} catch (err) {
  console.log(err.code, '-', err.message.slice(0, 60) + '…');
}

// Real output (Node v24.19.0):
//   ERR_INVALID_ARG_TYPE - The "body" argument must be of type function or an instance …
```

The object `{ end: false }` is checked as if it were a stream, so the call throws `ERR_INVALID_ARG_TYPE` at once. Use the promise form for `end` and `signal`.

**Example — with `{ end: false }`, a failing pipeline leaves the destination open.**

javascript

```
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const failing = () => new Readable({ read() { this.destroy(new Error('read failed')); } });
const sink = () => new Writable({ write(c, _e, cb) { cb(); } });

for (const opts of [{}, { end: false }]) {
  const out = sink();
  const err = await pipeline(failing(), out, opts).catch((e) => e);
  console.log(`${JSON.stringify(opts).padEnd(14)} rejected: ${err.message} | destination destroyed: ${out.destroyed}`);
  if (!out.destroyed) out.destroy(err);   // with end:false, cleaning up the destination is your job
}

// Real output (Node v24.19.0):
//   {}             rejected: read failed | destination destroyed: true
//   {"end":false}  rejected: read failed | destination destroyed: false
```

Without the option, the failure destroys the destination as usual. With `{ end: false }`, the promise rejects but `out.destroyed` is still `false`: the file descriptor or socket stays open until you destroy or end it, which the last line of the loop does.

### Common mistakes & gotchas (additional topics)

- **Reading `err.message` to find out why an aborted pipeline stopped.** It is always `'The operation was aborted'`. The reason you passed is in `err.cause`.
- **Expecting `TimeoutError` from `pipeline` with `AbortSignal.timeout`.** The rejection is Node's `AbortError`; the `TimeoutError` `DOMException` is `err.cause`.
- **Passing `{ signal }` or `{ end: false }` to the callback form.** It has no options parameter and throws `ERR_INVALID_ARG_TYPE`. Import `pipeline` from `node:stream/promises`.
- **Treating the resolved promise of `pipeline(…, { end: false })` as "written".** It only means the source is done. Data can still be in the destination's buffer (edge case below). Call `end()` and wait for `'finish'`.
- **Forgetting the final `end()`.** With `{ end: false }` nobody else ends the destination: a file stays open and an HTTP response never completes.
- **Expecting a failed `pipeline(…, { end: false })` to clean up the destination.** It does not destroy the last stream on error or abort. Destroy or end it in your `catch`.
- **Expecting `{ end: false }` to keep a Transform open.** Middle Transforms are always ended; only the last stream is kept open. Start a new Transform for each source.
- **Running two `pipe(dest, { end: false })` calls at the same time.** Both sources write into `dest` as their chunks arrive, so the output interleaves. Run them one after another.

### Edge case worked through: `pipeline(…, { end: false })` resolves before the data is written

The destination below needs 20 ms per chunk. The second part pipes two sources through a gzip Transform into one collector with `{ end: false }`:

javascript

```
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, gunzipSync } from 'node:zlib';

// A slow sink: each write takes 20 ms.
const saved = [];
const slow = new Writable({ write(c, _e, cb) { setTimeout(() => { saved.push(c); cb(); }, 20); } });

// 1. With { end: false } the promise resolves when the SOURCE is done,
//    not when the destination has written everything.
await pipeline(Readable.from(['a', 'b', 'c'], { objectMode: false }), slow, { end: false });
console.log('resolved: chunks saved so far =', saved.length, '| still buffered =', slow.writableLength, 'bytes');
slow.end();
await new Promise((r) => slow.on('finish', r));
console.log("after end() and 'finish': chunks saved =", saved.length);

// 2. A Transform in the middle is still ended (docs: "Transform streams are always ended").
const parts = [];
const collector = new Writable({ write(c, _e, cb) { parts.push(c); cb(); } });
for (const text of ['one ', 'two']) {
  const gzip = createGzip();
  await pipeline(Readable.from([text]), gzip, collector, { end: false });
  console.log(`gzip for "${text}": writableEnded = ${gzip.writableEnded} | collector open = ${!collector.writableEnded}`);
}
collector.end();
// Two complete gzip members back to back are still one valid gzip file.
console.log('gunzip of both members:', JSON.stringify(gunzipSync(Buffer.concat(parts)).toString()));

// Real output (Node v24.19.0):
//   resolved: chunks saved so far = 0 | still buffered = 3 bytes
//   after end() and 'finish': chunks saved = 3
//   gzip for "one ": writableEnded = true | collector open = true
//   gzip for "two": writableEnded = true | collector open = true
//   gunzip of both members: "one two"
```

When the first `await pipeline(…)` resolves, the sink has saved **none** of the three chunks; all 3 bytes are still in its buffer (`writableLength` 3). Only after `end()` and `'finish'` are all three saved. So with `{ end: false }`, "the pipeline resolved" means "the source is drained", and a process that exits or reads the file at that moment can miss the tail. The second part shows the docs' rule about Transforms: each `gzip` has `writableEnded === true` after its pipeline, while the collector stays open. Because each gzip was ended, each produced a complete gzip member, and two members back to back still form one valid gzip file, so `gunzipSync` returns `"one two"`.

### ⭐ Interview lens (additional topics)

> **Q: “How do you cancel a running `pipeline()`, and what do you get back?”**  
> A: Pass `{ signal }` as the last argument of the promise form. On abort, `pipeline()` destroys every stream that is not already finished (except a destination passed with `{ end: false }`) with Node's `AbortError` (`name 'AbortError'`, `code 'ABORT_ERR'`, an `Error`, not a `DOMException`) and rejects with it; your reason is in `err.cause`. Streams that already emitted `'end'`/`'finish'`/`'close'` are left alone. *Trap:* with `AbortSignal.timeout`, the error is still `AbortError`; `TimeoutError` is the cause.

> **Q: “How do you concatenate several files into one output stream?”**  
> A: Open one write stream, then for each file `await pipeline(createReadStream(file), out, { end: false })` (promise form, `end` option added in v18.0.0 / v17.2.0 / v16.14.0), then `out.end()` and wait for `'finish'`. Each pipeline still handles backpressure and errors. The files must run one after another, or their chunks interleave.
