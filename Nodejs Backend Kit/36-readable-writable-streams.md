---
title: "Readable & Writable Streams"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/readable-writable
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Readable & Writable Streams

*10 min read · Updated 24 Jul 2026 Topic 27 of 70 Bookmark Mark done Why it matters Readable and Writable are the two halves of every data movement in Node · Topic 27 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/readable-writable](https://www.geekyfrontend.in/learn/nodejs-backend-kit/readable-writable)

---

## Say it in 30 seconds

A Readable is a source of chunks, and a Writable is the sink you write those chunks into. Files, HTTP requests, and HTTP responses are these two objects. The stream starts paused, and it starts pushing as soon as you attach a `data` listener, call `pipe`, or call `resume`. The trade-off is easy to miss. If you are not ready when it starts flowing, chunks disappear, and if you ignore `write` returning false, the buffer grows without an error.

## Why it matters

Readable and Writable are the two halves of data moving through Node. The request coming in is a Readable. The response going out is a Writable. A file you read is a Readable. A file you write is a Writable. Duplex and Transform, next lesson, are built by combining these two.

The trap is that a Readable has two modes, paused and flowing. The wrong mode, or an accidental switch, causes the two production bugs interviewers ask about: data that vanishes, and memory that blows up because backpressure was ignored.

## The concept, simply

A Readable is a faucet. A Writable is a drain. The sink between them is the internal buffer, and not overflowing it is backpressure.

In paused mode, also called pull mode, data sits in the buffer until you call `read()`. You set the pace. In flowing mode, also called push mode, the stream fires `data` events as fast as the source can produce, and you have to keep up.

![Two Readable modes side by side: paused mode where you pull with read on the readable event, and flowing mode where data is pushed to you via data events](assets/i24_01_c085ea4d.svg)


A new Readable starts paused. It switches to flowing when you attach a `data` listener, call `pipe`, or call `resume`. It switches back when you call `pause`, and, when it is piped, when the destination signals backpressure. Attaching a `data` listener starts the flow immediately. If you then `await` setup before you can handle chunks, the chunks that arrive in the gap are gone.

## How it works

A Readable pulls from its source, a file or a socket, into an internal buffer through `_read`. It pulls until the buffer reaches `highWaterMark`, 64 KB for a file, then it stops asking. In paused mode, `read(n)` takes up to `n` bytes, or returns `null` if not enough is buffered yet. As the buffer drops under the mark, the stream pulls again. In flowing mode the same buffer drains itself by emitting `data`. Nothing pauses it for you if your handler is slower than the source, unless you piped it.

A Writable's `write(chunk)` appends to its buffer and asks the resource to take it through `_write`. The return value is the signal. `true` means you are under `highWaterMark`. `false` means stop and wait for `drain`. Ignoring `false` does not throw. The buffer grows without a bound. That is the slow disk and fast source leak.

![A Writable stream's internal buffer shown as a tank with a highWaterMark line: write returns true below the line and false at or above it, requiring a wait for the drain event](assets/i24_02_e1ea38ee.svg)


You finish a Writable with `end`, optionally with a last chunk. When the buffer has been flushed, it emits `finish`. When the resource is released, it emits `close`. A Readable that is exhausted emits `end`. `end` means the source is done producing. `finish` means the sink is done consuming.

`for await` of a Readable is paused mode in disguise. The loop pulls one chunk, waits for your body, then pulls the next. Backpressure is automatic, and errors land in `try/catch`.

## Code examples

**1. Consume with `for await` (recommended default).** Backpressure and errors are handled by the language, not by hand.

javascript

```
import { createReadStream } from 'node:fs';

async function countLines(path) {
  let count = 0, tail = '';
  const stream = createReadStream(path, { encoding: 'utf8' });
  for await (const chunk of stream) {   // pulls one chunk at a time
    const parts = (tail + chunk).split('
');
    tail = parts.pop();                 // last piece may be incomplete
    count += parts.length;
  }
  if (tail) count++;                     // final line with no newline
  return count;
}
console.log(await countLines('access.log'));
```

**2. Respecting Writable backpressure by hand.** The pattern `pipeline()` automates — worth writing once so you understand what it does.

javascript

```
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

async function writeLots(path, n) {
  const out = createWriteStream(path);
  for (let i = 0; i < n; i++) {
    const ok = out.write(`row ${i}
`);
    if (!ok) {
      // Buffer is full — pause until it drains below highWaterMark.
      await once(out, 'drain');
    }
  }
  out.end();
  await once(out, 'finish');   // all data flushed to disk
}
await writeLots('rows.txt', 1_000_000);
```

**3. Creating your own Readable.** Push data with `push(chunk)`; signal the end with `push(null)`.

javascript

```
import { Readable } from 'node:stream';

// Simplest: from an iterable / generator.
const numbers = Readable.from((function* () {
  for (let i = 1; i <= 5; i++) yield `${i}
`;
})());

// Explicit form: implement _read and push chunks yourself.
class Counter extends Readable {
  #n = 0;
  constructor(max) { super(); this.max = max; }
  _read() {
    this.#n++;
    if (this.#n > this.max) this.push(null);        // end of stream
    else this.push(Buffer.from(`${this.#n}
`));   // emit a chunk
  }
}
new Counter(3).pipe(process.stdout);   // prints 1
2
3
```

**4. Creating your own Writable.** Implement `_write`; call the callback when the chunk is handled (this is how backpressure is reported upstream).

javascript

```
import { Writable } from 'node:stream';

class JsonlLogger extends Writable {
  constructor() { super({ objectMode: true }); }   // accept objects, not bytes
  _write(record, _enc, cb) {
    process.stdout.write(JSON.stringify(record) + '
');
    cb();   // MUST call cb — err first if it failed. Until then, backpressure holds.
  }
}
const log = new JsonlLogger();
log.write({ level: 'info', msg: 'up' });
log.write({ level: 'warn', msg: 'slow query' });
log.end();
```

## Common mistakes & gotchas

- **Attaching `data` too early.** It flips the stream to flowing immediately. An `await` before you handle chunks drops what arrives in the gap. Attach the listener when you are ready, or use `for await`.
- **Ignoring `write()` returning false.** The buffer grows without an error. Wait for `drain`.
- **Mixing paused and flowing.** `read()` plus a `data` listener, or piping a stream you are also reading, sends data to one consumer.
- **Confusing `end` with `finish`.** `end` means a Readable has nothing left. `finish` means a Writable has flushed what you gave it.
- **Never calling the `_write` callback.** The stream thinks the chunk is still in progress and stalls.
- **`push` after `push(null)`**, or pushing faster than `_read` is called. Both throw or leak.

## Best practices

- **Prefer `for await`** when you need per-chunk logic. You get backpressure and `try/catch`.
- **Prefer `pipeline()`** when you are moving bytes from a Readable to a Writable. Do not hand-roll the drain loop unless you are learning it.
- **Custom streams:** pass `read` or `write` in the constructor, or implement the underscore methods, and always call the callback.
- **`objectMode: true`** when the stream carries values rather than bytes. `highWaterMark` then counts objects.
- **`Readable.from(iterable)`** turns an array, a generator, or an async iterator into a stream.

## ⭐ Interview lens

> **Q: What are the two modes of a Readable stream, and what triggers each?**  
> A: A Readable starts paused, which means nothing comes out until you pull. Flowing mode pushes chunks at you. Three calls switch it to flowing: adding a `data` listener, calling `pipe`, or calling `resume`. `pause` switches it back, and so does a piped destination that is applying backpressure. In paused mode you call `read`, often after a `readable` event. In flowing mode each chunk is a `data` event. `for await` is paused mode with the pull hidden in the loop, so the source waits while your body runs. The limit is the moment you attach `data`. The flow starts in that turn, not when you feel ready.

> **Q: You attach a `'data'` handler but some chunks seem to vanish. Why?** (Trap.)  
> A: Attaching `data` switches the Readable to flowing mode immediately, in that same turn. If you then `await` real work before the handler can use the chunk, or if a second consumer shows up later, the chunks emitted in the gap are delivered to nobody and they are gone. Flowing mode does not store them for a listener that was not there. Use `for await`, which pulls the next chunk only after you finish the current one, or attach `data` only when you can handle it. The limit is that this failure is silent. There is no error event. The count is just short.

> **Q: What does `stream.write()` returning `false` mean, and what should you do?**  
> A: `write` returning false means the Writable's internal buffer has reached its `highWaterMark`. That is backpressure. Stop calling `write` and wait for the `drain` event, which fires when the buffer has dropped back under the mark, then continue. `pipeline` and `pipe` run that loop for you. The limit is that ignoring the boolean does not throw. The bytes queue in memory, and the process grows until it is killed, which you will not see in a test where the sink is as fast as the source.

> **Q: Difference between the `'end'` and `'finish'` events?**  
> A: `end` fires on a Readable when the source has no more data to give you. `finish` fires on a Writable after you called `end` and every buffered chunk has been flushed to the file, socket, or other resource. They are different objects and different moments. `close` comes after that, when the underlying descriptor or socket is released. A stream that is destroyed early can emit `close` and neither `end` nor `finish`. The limit of waiting only for `end` is that case: the wait never completes. `stream.finished` reports it as `ERR_STREAM_PREMATURE_CLOSE`.

## Cheat-card

- **Readable:** a source. Starts paused. Goes flowing on a `data` listener, `pipe()`, or `resume()`.
- **Paused:** pull with `read()` on `readable`. **Flowing:** chunks arrive on `data`.
- **Writable:** a sink. `write()` returning false means the buffer is at `highWaterMark`. Wait for `drain`.
- **End signals:** a Readable emits `end`. A Writable's `end()` leads to `finish`, then `close`.
- **Build:** `push(chunk)` and `push(null)` on a custom Readable. `_write(chunk, enc, cb)` on a custom Writable, and always call `cb`.
- **Consume:** `for await` when you have per-chunk logic. `pipeline()` when you are moving bytes. `objectMode` for records.

## Good to know

- In a custom Writable, if `_write(chunk, enc, cb)` never calls `cb`, the stream believes the chunk is still in progress, never asks for the next one, and the pipeline stalls with no error. Call `cb()` on success or `cb(err)` on failure.
- Signal the end of a custom Readable with `this.push(null)`. Earlier `push(chunk)` calls emit data. `push(null)` is EOF and leads to `end` downstream.
- `destroy(err)` was added in v8.0.0 and is a no-op on an already destroyed stream since v14.0.0. `errored` and `closed` were added in v18.0.0. `finished` was added in v10.0.0, the promise form in v15.0.0. `_final` was added in v8.0.0. `cork` and `uncork` were added in v0.11.2. `map` and `filter` were added in v17.4.0 and v16.14.0. `take` and `toArray` were added in v17.5.0 and v16.15.0, and in the v24 docs they are still Stability 1, Experimental. `Readable.fromWeb` was added in v17.0.0 and marked stable in v24.0.0.
## Learn More

- [Stream | Node.js Documentation nodejs.org](https://nodejs.org/api/stream.html)
- [Node.js Streams: Everything you need to know freecodecamp.org](https://www.freecodecamp.org/news/node-js-streams-everything-you-need-to-know-c9141306be93)
- [Learn Node.js Streams in 25 minutes | NodeJS Tutorials for Beginners Dipesh Malvia](https://www.youtube.com/watch?v=EcznOgzOdxI)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0*

### `destroy()`, `'close'`, `destroyed` and `errored`

`stream.destroy([error])` (added in v8.0.0; a no-op on an already destroyed stream since v14.0.0) stops a stream at once and releases what it holds: a file descriptor, a socket, a timer. It is the "abort" button, as opposed to `end()` on a Writable, which is the "finish normally" button. Without it, a stream whose consumer has gone away keeps its descriptor open, and every error path in a server leaks one. `pipeline()` calls `destroy(err)` on every stream when one of them fails; you call it yourself when you stop using a stream early.

How it works:

1. `destroy(err)` sets `stream.destroyed = true` at once and, if `err` is given, `stream.errored = err` (both properties are readable on Readable and Writable; `errored` was added in v18.0.0).
2. It calls the stream's `_destroy(err, callback)` (the `destroy` constructor option), where an implementation closes its resource and then calls `callback(err)`.
3. On a later tick, the stream emits `'error'` (only if there was an error) and then `'close'` (unless `emitClose: false`). `stream.closed` (added in v18.0.0) becomes `true`.
4. After that, a Readable ignores `push()` and a Writable fails `write()` with `ERR_STREAM_DESTROYED`. Calling `destroy()` again does nothing.
5. Data still in the buffers is dropped. `end()` writes it out first; `destroy()` does not (see the edge case below).

**Example — `destroy(err)` vs `destroy()`, and writing after destroy.**

javascript

```
import { Readable, Writable } from 'node:stream';

// 1. destroy(err): 'error' then 'close'; destroyed and errored are set at once.
const r = new Readable({
  read() {},
  destroy(err, cb) { console.log('  _destroy() runs, err =', err?.message); cb(err); },
});
r.on('error', (err) => console.log("  'error' event:", err.message));
r.on('close', () => console.log("  'close' event | closed =", r.closed));
r.push('some data');
r.destroy(new Error('disk gone'));
console.log('right after destroy(): destroyed =', r.destroyed, '| errored =', r.errored?.message, '| closed =', r.closed);
console.log('push() after destroy returns', r.push('more'), '(ignored)');
await new Promise((res) => setImmediate(res));

// 2. destroy() with no error: only 'close', errored stays null.
const w = new Writable({ write(c, e, cb) { cb(); } });
w.on('error', (err) => console.log("  writable 'error':", err.code));
w.on('close', () => console.log("  writable 'close' | errored =", w.errored));
w.destroy();
await new Promise((res) => setImmediate(res));

// 3. write() after destroy(): the callback gets ERR_STREAM_DESTROYED; no second 'error' event.
console.log('write() returns', w.write('late', (err) => console.log('write callback:', err.code)));
await new Promise((res) => setTimeout(res, 10));

// Real output (Node v24.19.0):
//     _destroy() runs, err = disk gone
//   right after destroy(): destroyed = true | errored = disk gone | closed = true
//   push() after destroy returns false (ignored)
//     'error' event: disk gone
//     'close' event | closed = true
//     writable 'close' | errored = null
//   write() returns false
//   write callback: ERR_STREAM_DESTROYED
```

`destroyed` and `errored` are set before `destroy()` returns. In this run `closed` was also already `true`, because `_destroy()` called its callback synchronously, but the `'error'` and `'close'` *events* came a tick later, in that order. `destroy()` without an argument emits only `'close'` and leaves `errored` as `null`. A `write()` after destroy returns `false` and its callback gets `ERR_STREAM_DESTROYED`.

### `stream.finished()`: one place to learn that a stream is done

`stream.finished(stream[, options], callback)` (added in v10.0.0) calls `callback(err)` once, when the stream has ended, finished, errored or closed early. The promise version in `node:stream/promises` (added in v15.0.0) resolves or rejects instead. Without it you listen to `'end'`, `'finish'`, `'error'` and `'close'` yourself and still miss a case: a stream destroyed before it ended emits `'close'` but neither `'end'` nor `'finish'`, so code that waits for `'end'` hangs.

How it works:

1. `finished()` attaches listeners for `'end'`, `'finish'`, `'error'` and `'close'` (and checks whether the stream is already done: since v14.0.0 the callback runs for a stream that finished earlier).
2. Normal end: the callback gets no error (`undefined`), or the promise resolves.
3. Error: the callback gets the error, or the promise rejects with it.
4. `'close'` before `'end'` or `'finish'`: the callback gets `ERR_STREAM_PREMATURE_CLOSE` (since v14.0.0).
5. The listeners stay attached afterwards, on purpose, so a late `'error'` from a badly written stream does not crash the process. The callback form returns a **cleanup function** that removes them; the promise form takes `{ cleanup: true }` (added in v19.1.0 / v18.13.0). Both forms take `signal` (callback form: added in v15.11.0), which stops the *waiting*, not the stream.

**Example — callback form, cleanup function, premature close and the promise form.**

javascript

```
import { Readable, Writable, finished } from 'node:stream';
import { finished as finishedP } from 'node:stream/promises';

const count = (s) => ['error', 'end', 'finish', 'close'].map((e) => s.listenerCount(e)).join('/');

// 1. Callback form: called once, for success OR failure OR premature close.
const ok = Readable.from(['a', 'b']);
const cleanup = finished(ok, (err) => {
  console.log('callback, ok stream: err =', err);
  console.log('  listeners error/end/finish/close before cleanup:', count(ok));
  cleanup();                                   // remove the listeners finished() added
  console.log('  after cleanup():', count(ok));
});
ok.resume();
await new Promise((r) => setTimeout(r, 10));

// 2. A stream destroyed before it ended: ERR_STREAM_PREMATURE_CLOSE.
const cut = new Readable({ read() {} });
finished(cut, (err) => console.log('callback, destroyed early:', err.code));
cut.destroy();
await new Promise((r) => setTimeout(r, 10));

// 3. Promise form, with an error.
const bad = new Writable({ write(c, e, cb) { cb(new Error('disk full')); } });
bad.on('error', () => {});
bad.write('x');
try { await finishedP(bad); } catch (err) { console.log('promise form rejected:', err.message); }

// 4. Promise form: listeners stay behind unless you pass { cleanup: true }.
for (const opts of [{}, { cleanup: true }]) {
  const w = new Writable({ write(c, e, cb) { cb(); } });
  w.end('done');
  await finishedP(w, opts);
  console.log(`promise form ${JSON.stringify(opts)}: listeners left`, count(w));
}

// Real output (Node v24.19.0):
//   callback, ok stream: err = undefined
//     listeners error/end/finish/close before cleanup: 1/1/1/1
//     after cleanup(): 0/0/0/0
//   callback, destroyed early: ERR_STREAM_PREMATURE_CLOSE
//   promise form rejected: disk full
//   promise form {}: listeners left 1/1/1/1
//   promise form {"cleanup":true}: listeners left 0/0/0/0
```

Each line shows the listener counts for `'error'`, `'end'`, `'finish'` and `'close'`. `finished()` added one of each; the returned `cleanup()` removes them, and so does `{ cleanup: true }` in the promise form. The destroyed-early stream never emitted `'end'`, and `finished()` reports that as `ERR_STREAM_PREMATURE_CLOSE` instead of waiting forever.

### `_final()`: work that must happen before `'finish'`

`_final(callback)` (added in v8.0.0; the `final` constructor option) is an optional method of a custom Writable. Node calls it once, after `end()` and after the last `_write()` has completed, and holds back `'finish'` until you call `callback()`. A Writable that batches, buffers or holds a connection needs it: without `_final`, the last partial batch is never sent, and `'finish'` (which tells `pipeline()` "all data is safe") fires while rows are still in your array.

How it works:

1. Your code calls `end()`. `writableEnded` becomes `true`; no more writes are accepted.
2. Node waits until every queued chunk has gone through `_write()` / `_writev()`.
3. Node calls `_final(callback)`. You flush what you buffered, close the connection, and so on.
4. When you call `callback()`, `writableFinished` becomes `true` and `'finish'` is emitted, then `'close'`. If you call `callback(err)`, the stream errors instead.

**Example — a batching writer that sends its last partial batch in `_final`.**

javascript

```
import { Writable } from 'node:stream';

// A batching writer: collects rows, sends them 3 at a time, and must send the rest at the end.
class BatchWriter extends Writable {
  #batch = [];
  constructor() { super({ objectMode: true }); }
  _write(row, _enc, cb) {
    this.#batch.push(row);
    if (this.#batch.length < 3) return cb();
    this.#send(cb);
  }
  _final(cb) {                         // runs after end(), before 'finish'
    console.log(`  _final(): ${this.#batch.length} row(s) still buffered`);
    if (this.#batch.length === 0) return cb();
    this.#send(cb);                    // 'finish' waits until this cb is called
  }
  #send(cb) {
    const rows = this.#batch.splice(0);
    setTimeout(() => { console.log('  sent batch:', rows.join(',')); cb(); }, 20);  // a fake network call
  }
}

const w = new BatchWriter();
w.on('finish', () => console.log("'finish' (every row sent)"));
w.on('close', () => console.log("'close'"));
for (const row of ['r1', 'r2', 'r3', 'r4', 'r5']) w.write(row);
w.end();
console.log('end() returned; writableEnded =', w.writableEnded, '| writableFinished =', w.writableFinished);

// Real output (Node v24.19.0):
//   end() returned; writableEnded = true | writableFinished = false
//     sent batch: r1,r2,r3
//     _final(): 2 row(s) still buffered
//     sent batch: r4,r5
//   'finish' (every row sent)
//   'close'
```

`end()` returns at once with `writableEnded === true` but `writableFinished === false`. The first batch (`r1,r2,r3`) goes out from `_write()`. `_final()` then finds `r4` and `r5` still buffered and sends them, and `'finish'` waits until that send's callback. Remove `_final` and `r4,r5` are lost while `'finish'` still fires.

### `cork()`, `uncork()` and `_writev()` batching

`writable.cork()` and `writable.uncork()` (added in v0.11.2) let you group many small writes into one call to the underlying resource. While a stream is *corked*, `write()` only adds chunks to the buffer. `uncork()` (or `end()`) flushes them, and if the stream implements `_writev(chunks, callback)`, all buffered chunks go to it in a single call. `net.Socket` implements `_writev()`: in a separate run, `strace` showed a corked socket sending three 1-byte writes as one `writev(fd, ["a", "b", "c"], 3)` system call instead of three. Without `_writev`, the docs warn that cork can lower throughput, because the chunks are then written one by one anyway.

How it works:

1. `cork()` increments `writableCorked` (added in v13.2.0 / v12.16.0). While it is above 0, `write()` buffers the chunk and returns.
2. Each `uncork()` decrements `writableCorked`. When it reaches 0, the buffered chunks are flushed; with a `_writev`, they arrive as one array of `{ chunk, encoding }`.
3. `cork()` twice needs `uncork()` twice.
4. The docs' pattern is `cork()`, then the writes, then `process.nextTick(() => stream.uncork())`, so every write in the current tick joins the batch.
5. Even without `cork()`, chunks that queue up while a `_write()` is still in progress are handed to `_writev()` together on the next round.

**Example — the same three writes with and without `cork()`.**

javascript

```
import { Writable } from 'node:stream';

// A sink that logs how it is called: _write() gets one chunk, _writev() gets a batch.
function makeSink(label) {
  return new Writable({
    write(chunk, _enc, cb) { console.log(`  ${label} _write : ${JSON.stringify(chunk.toString())}`); setImmediate(cb); },
    writev(chunks, cb) {
      console.log(`  ${label} _writev: ${chunks.length} chunks ->`, JSON.stringify(Buffer.concat(chunks.map((c) => c.chunk)).toString()));
      setImmediate(cb);
    },
  });
}

// 1. No cork: the first write goes to _write() at once; the others queue up behind it
//    while it is busy, so they arrive later as one _writev() batch.
console.log('without cork():');
const a = makeSink('a');
for (const part of ['GET ', '/ ', 'HTTP/1.1\r\n']) a.write(part);
a.end();
await new Promise((r) => a.on('finish', r));

// 2. cork() + uncork() on the next tick: all three writes reach _writev() in one call.
console.log('with cork():');
const b = makeSink('b');
b.cork();
for (const part of ['GET ', '/ ', 'HTTP/1.1\r\n']) b.write(part);
console.log('  writableCorked =', b.writableCorked, '| writableLength =', b.writableLength);
process.nextTick(() => { b.uncork(); b.end(); });   // the docs' pattern: uncork on the next tick
await new Promise((r) => b.on('finish', r));

// 3. cork() twice needs uncork() twice.
const c = makeSink('c');
c.cork(); c.cork(); c.write('x');
c.uncork();
console.log('after one uncork(): writableCorked =', c.writableCorked);
c.uncork();
console.log('after two uncork(): writableCorked =', c.writableCorked);

// Real output (Node v24.19.0):
//   without cork():
//     a _write : "GET "
//     a _writev: 2 chunks -> "/ HTTP/1.1\r\n"
//   with cork():
//     writableCorked = 1 | writableLength = 16
//     b _writev: 3 chunks -> "GET / HTTP/1.1\r\n"
//   after one uncork(): writableCorked = 1
//     c _write : "x"
//   after two uncork(): writableCorked = 0
```

Without `cork()`, the first write goes straight to `_write()`, and the two that arrive while it is busy go to `_writev()` as a batch of 2. With `cork()`, nothing reaches the sink until the next tick; then all 16 bytes reach `_writev()` in one call. The last part shows the counter: after one of two `uncork()` calls, `writableCorked` is still 1 and `x` has not been written.

### Stream operators: `map`, `filter`, `take`, `toArray`

Readable streams have array-like methods that return a new stream (`map`, `filter`, `take`, plus `drop`, `flatMap`) or a promise (`toArray`, `forEach`, `reduce`, `some`, `every`, `find`). `map` and `filter` were added in v17.4.0 / v16.14.0 (with a `highWaterMark` option since v20.7.0 / v18.19.0), `take` and `toArray` in v17.5.0 / v16.15.0. In the v24 docs these four are still **Stability: 1 – Experimental** (unlike `readable.compose()` and `readable.iterator()`, which were marked stable in v24.0.0). No warning was printed on v24.19.0, but experimental APIs can change in any release. Without them, a simple "parse, filter, take the first 100" means writing three Transform classes or an async generator by hand.

How it works:

1. `source.map(fn, options)` returns a new Readable in object mode. It reads from `source`, calls `fn(chunk, { signal })`, awaits the result if it is a promise, and pushes it. `filter(fn)` pushes the chunk only if `fn` returns a truthy value.
2. `options.concurrency` (default `1`) is the number of `fn` calls that may run at once. Results still come out in input order. `options.highWaterMark` (default `concurrency * 2 - 1`) is how many finished results are buffered while waiting for the consumer.
3. `take(n)` passes on the first `n` chunks, then ends and destroys the source (`endless.destroyed` was `true` afterwards in a separate run).
4. `toArray()` reads the whole stream into an array and resolves with it. It puts the entire stream in memory, so use it for small or bounded streams (the docs say it "negates the benefits of streams").
5. An operator reads the stream it is called on. Read from the returned stream only; reading the original as well splits the chunks between two consumers.

**Example — chaining operators, `take` stopping an endless source, and `concurrency`.**

javascript

```
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

// 1. map / filter / take / toArray chain like array methods, but chunk by chunk.
const out = await Readable.from([1, 2, 3, 4, 5, 6, 7, 8])
  .filter((n) => n % 2 === 0)       // 2 4 6 8
  .map((n) => n * 10)               // 20 40 60 80
  .take(3)                          // stop after 3 items
  .toArray();
console.log('result:', out);

// 2. take() stops the source: it is not read to the end.
let produced = 0;
const endless = Readable.from((function* () { while (true) yield ++produced; })());
console.log('first 3 of an endless stream:', await endless.take(3).toArray(), '| produced:', produced);

// 3. concurrency: up to N async calls at once; results still come out in input order.
const slowLookup = async (id) => { await sleep(id === 1 ? 300 : 100); return `user${id}`; };
for (const concurrency of [1, 3]) {
  const start = Date.now();
  const users = await Readable.from([1, 2, 3]).map(slowLookup, { concurrency }).toArray();
  console.log(`concurrency ${concurrency}: ${JSON.stringify(users)} in ~${Math.round((Date.now() - start) / 100) * 100} ms`);
}

// Real output (Node v24.19.0):
//   result: [ 20, 40, 60 ]
//   first 3 of an endless stream: [ 1, 2, 3 ] | produced: 4
//   concurrency 1: ["user1","user2","user3"] in ~500 ms
//   concurrency 3: ["user1","user2","user3"] in ~300 ms
```

`take(3)` ends the chain after three items even though the source is endless. `produced: 4` shows that one more item was read ahead into the buffer before the source was destroyed. With `concurrency: 1` the three lookups run one after another (300 + 100 + 100 ms); with `concurrency: 3` they run together and the slowest one (300 ms) sets the time. In both cases `user1` comes first, although it finished last: order is kept.

### Web streams: the other stream API

Everything in this lesson is about Node's `node:stream` classes. Node also has the WHATWG `ReadableStream` / `WritableStream` API, which `fetch`, `Response` and `CompressionStream` use. A web stream has no `pipe()`, no `'data'` event and no `destroy()`. `Readable.fromWeb()` and `Readable.toWeb()` convert between the two. Lesson [83 — Web Streams in Node](39-web-streams.md) covers readers, writers, queuing strategies and how their backpressure differs.

How it works:

1. A web `ReadableStream` is consumed with a reader, `for await`, or `pipeTo()`.
2. `Readable.fromWeb(webStream, options)` (added in v17.0.0, stable since v24.0.0) returns a Node `Readable` that reads from it.
3. From then on, `'end'`, `pipe()`, `destroy()`, `finished()` and the operators above all work.

**Example — a `fetch`-style body is not a Node `Readable` until you wrap it.**

javascript

```
import { Readable } from 'node:stream';

// Same data, two stream APIs. A web ReadableStream (for example a fetch body) is not a Node Readable.
const body = new Response('line 1\nline 2\n').body;
console.log('instanceof Readable:', body instanceof Readable, '| has pipe():', typeof body.pipe);

// Readable.fromWeb() wraps it, so everything in this lesson works on it again.
const node = Readable.fromWeb(body, { encoding: 'utf8' });
node.on('end', () => console.log("'end' fired, as on any Node Readable"));
console.log('chunks:', await node.toArray());

// Real output (Node v24.19.0):
//   instanceof Readable: false | has pipe(): undefined
//   'end' fired, as on any Node Readable
//   chunks: [ 'line 1\nline 2\n' ]
```

### Common mistakes & gotchas (additional topics)

- **Using `destroy()` to finish a Writable.** It drops queued data. Call `end()` and wait for `'finish'`; keep `destroy()` for errors and early exits.
- **Waiting only for `'end'` or `'finish'`.** A stream destroyed early emits neither, so the wait never ends. Use `finished()`, which reports `ERR_STREAM_PREMATURE_CLOSE`.
- **Expecting `finished()` to clean up after itself.** It leaves its listeners attached. Call the returned cleanup function, or pass `{ cleanup: true }` to the promise form.
- **Doing final flushing in a `'finish'` listener.** By then `pipeline()` has already been told the data is safe. Flush in `_final()`, which runs *before* `'finish'`.
- **Corking without `_writev()`.** The chunks are still written one by one, after a delay. Implement `_writev()` or do not cork.
- **Uncorking fewer times than you corked.** Data stays buffered until `writableCorked` is back to 0.
- **Calling `toArray()` on an unbounded stream.** It reads everything into memory. Use `take(n)` before it, or `for await`.
- **Assuming `map` with `concurrency > 1` returns results as they finish.** Order is kept; one slow item holds back the ones after it.

### Edge case worked through: `destroy()` drops queued writes, `end()` does not

Three chunks are written to a sink that needs 20 ms per chunk. One sink is closed with `end()`, the other with `destroy()` right after the writes:

javascript

```
import { Writable } from 'node:stream';

// A slow sink: each chunk takes 20 ms to "reach the disk".
function slowSink() {
  const saved = [];
  const w = new Writable({
    write(chunk, _e, cb) { setTimeout(() => { saved.push(chunk.toString()); cb(); }, 20); },
  });
  return { w, saved };
}

// end(): queued chunks are written first, then 'finish', then 'close'.
const a = slowSink();
['1', '2', '3'].forEach((c) => a.w.write(c));
a.w.end();
a.w.on('close', () => console.log("end()     'close': saved", a.saved));

// destroy(): stops now. The chunk already handed to _write() still lands; queued ones are dropped.
const b = slowSink();
['1', '2', '3'].forEach((c) => b.w.write(c, (err) => console.log(`  destroy() case, write(${c}) callback:`, err?.code ?? 'ok')));
b.w.destroy();
b.w.on('close', () => console.log("destroy() 'close': saved", b.saved));

setTimeout(() => console.log('100 ms later, destroy() case saved', b.saved), 100);

// Real output (Node v24.19.0):
//   destroy() 'close': saved []
//     destroy() case, write(1) callback: ok
//     destroy() case, write(2) callback: ERR_STREAM_DESTROYED
//     destroy() case, write(3) callback: ERR_STREAM_DESTROYED
//   end()     'close': saved [ '1', '2', '3' ]
//   100 ms later, destroy() case saved [ '1' ]
```

With `end()`, all three chunks are saved before `'close'`. With `destroy()`, `'close'` fires first, while chunk 1 is still inside `_write()`. That chunk does land 20 ms later (its callback reports `ok`, and `saved` holds `'1'` at 100 ms), because Node cannot take back work it has already handed to `_write()`. Chunks 2 and 3 were still in the buffer, so they are dropped and their callbacks get `ERR_STREAM_DESTROYED`. So after `destroy()`, a resource can still receive data after `'close'`, and a `_destroy()` that closes the resource must allow for a write that is still running.

### ⭐ Interview lens (additional topics)

> **Q: “What is the difference between `end()` and `destroy()` on a Writable?”**  
> A: `end()` says "no more data": the queued chunks are written, `_final()` runs, then `'finish'` and `'close'` are emitted. `destroy(err)` says "stop now": `destroyed` (and `errored`) are set at once, queued chunks are dropped with `ERR_STREAM_DESTROYED`, and only `'error'` (if given an error) and `'close'` are emitted. *Trap:* a chunk already inside `_write()` still completes after `'close'`.

> **Q: “Why use `cork()` and `uncork()`?”**  
> A: To turn several small writes into one call to the resource. While corked, `write()` only buffers; `uncork()` hands all the buffered chunks to `_writev()` in one call, which for a `net.Socket` is one `writev` system call. It only helps if the stream implements `_writev()`, and you need one `uncork()` per `cork()`.
