---
title: "Web Streams in Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Web Streams in Node

*16 min read · Updated 10 Oct 2026 · Topic 83 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

Node has two stream APIs. Lessons 35–38 cover the original one in `node:stream` (`Readable`, `Writable`, `Transform`, `pipeline`). The second is the WHATWG Streams Standard, the one browsers, Deno, Bun and edge runtimes use. Node ships it as globals (`ReadableStream`, `WritableStream`, `TransformStream`) and in `node:stream/web`.

You meet the second API as soon as you call `fetch`. On Node v24.19.0, `res.body` is a `ReadableStream`, not a `Readable`. It has no `.pipe()`, no `'data'` event and no `setEncoding()`. Code written for Node streams fails on it with `TypeError: res.body.pipe is not a function`. The same is true of `Response`, `Blob.stream()`, `CompressionStream` and `TextDecoderStream`, and of any library written to run in both browsers and Node.

So a Node backend needs three things: the web API itself (readers, writers, queuing strategies), the converters between the two worlds (`Readable.toWeb`, `Readable.fromWeb` and friends), and an understanding of where their backpressure rules differ. Without the last one you write a loop that "works" and quietly queues the whole body in memory.

## The concept, simply

A web stream is a queue of chunks plus a small object that feeds or drains it. There are three classes:

- **`ReadableStream`** wraps an *underlying source*, an object you pass to the constructor with up to three methods: `start(controller)` runs once at creation, `pull(controller)` runs whenever the queue has room, and `cancel(reason)` runs when the consumer gives up. The source puts data in with `controller.enqueue(chunk)`, ends the stream with `controller.close()` and fails it with `controller.error(err)`. To read, you take a **reader** with `getReader()`. A reader *locks* the stream (`stream.locked === true`), so only one consumer reads at a time. `reader.read()` returns a promise for `{ value, done }`.
- **`WritableStream`** wraps an *underlying sink* with `start`, `write(chunk, controller)`, `close()` and `abort(reason)`. To write, you take a **writer** with `getWriter()`, which also locks the stream. `writer.write(chunk)` returns a promise, `writer.desiredSize` says how much room is left, and `writer.ready` is a promise that settles when there is room again.
- **`TransformStream`** is a pair `{ writable, readable }` joined by a *transformer* with `transform(chunk, controller)` and `flush(controller)`. What you write into `.writable` comes out of `.readable` after `transform()` has run on it.

Every queue has a **queuing strategy**: `{ highWaterMark, size(chunk) }`. `size()` measures one chunk and `highWaterMark` is the limit in those units. `desiredSize` is `highWaterMark` minus the total size queued. `CountQueuingStrategy` measures every chunk as 1; `ByteLengthQueuingStrategy` measures `chunk.byteLength`. With no strategy, a `ReadableStream` or `WritableStream` counts chunks with a limit of 1.

Nothing in the web API refuses data. `controller.enqueue()` and `writer.write()` always accept the chunk; when the queue is over its limit, `desiredSize` just goes to zero or below. Backpressure works only if the producer reads `desiredSize` or awaits `writer.ready`.

The two APIs side by side, and the converters between them:

text

```
 Node streams (node:stream)                  Web streams (globals, node:stream/web)
 ──────────────────────────                  ──────────────────────────────────────
 Readable                                    ReadableStream
   _read() asks the source for data            pull(controller) asks the source for data
   push(chunk) -> true / false                 controller.enqueue(chunk) -> undefined
   limit: highWaterMark in BYTES               limit: strategy.highWaterMark in units of
     (16 objects in objectMode)                  strategy.size(chunk); default 1 chunk
   read with: 'data', read(), pipe(),          read with: getReader().read() -> {value, done},
     for await                                   pipeTo(), pipeThrough(), for await
 Writable                                    WritableStream
   write(chunk) -> true / false                writer.write(chunk) -> promise
   wait for the 'drain' event                  await writer.ready; check writer.desiredSize
 Transform / Duplex                          TransformStream = { writable, readable }
 pipeline(a, b, c)                           a.pipeThrough(b).pipeTo(c)
 errors: 'error' event, destroy(err)         errors: rejected promises, cancel() / abort()

        Readable.toWeb(r)  ─────────►  ReadableStream     Readable.fromWeb(rs)  ◄─────────
        Writable.toWeb(w)  ─────────►  WritableStream     Writable.fromWeb(ws)  ◄─────────
        Duplex.toWeb(d)    ─────────►  { readable, writable }   Duplex.fromWeb(pair) ◄─────
```

**Versions.** The classes were added in v16.5.0 in `node:stream/web` and became globals in v18.0.0. The `node:stream/web` module is Stability 2 (Stable) and stopped being experimental in v21.0.0. The globals docs mark the global `ReadableStream`, `CompressionStream` and the rest stable in v23.11.0 and v22.15.0. `TextDecoderStream` and `TextEncoderStream` were added in v16.6.0, `CompressionStream` and `DecompressionStream` in v17.0.0 (`'deflate-raw'` added in v21.2.0 / v20.12.0, `'brotli'` in v24.7.0). `ReadableStream.from(iterable)` was added in v20.6.0. `fetch` was added in v17.5.0 / v16.15.0, lost its `--experimental-fetch` flag in v18.0.0 and stopped being experimental in v21.0.0.

## How it works

1. **Construction.** `new ReadableStream(source, strategy)` calls `source.start(controller)` at once. After `start` finishes, the stream calls `pull(controller)` as long as `desiredSize > 0`. If `pull` returns a promise, the stream does not call it again until the promise settles.
2. **Filling the queue.** Each `controller.enqueue(chunk)` adds the chunk to the queue and subtracts `size(chunk)` from `desiredSize`. When `desiredSize` reaches 0, the stream stops calling `pull`. A source that enqueues from `start` or from a timer (a *push source*) is not stopped by anything; it has to check `controller.desiredSize` itself.
3. **Reading.** `getReader()` locks the stream. Each `reader.read()` takes the first chunk out of the queue and resolves `{ value: chunk, done: false }`. If the queue is empty, the promise waits. After `close()` and an empty queue, it resolves `{ value: undefined, done: true }`. Taking a chunk out raises `desiredSize`, so `pull` runs again.
4. **Releasing.** `reader.releaseLock()` unlocks the stream so another reader, a `for await` loop or `pipeTo` can use it. `reader.cancel(reason)` or `stream.cancel(reason)` throws away the queue and calls `source.cancel(reason)`.
5. **Writing.** `writer.write(chunk)` adds the chunk to the sink's queue and returns a promise that settles when `sink.write()` has finished with that chunk. The sink handles one chunk at a time; the chunk in progress still counts against `desiredSize`. When `desiredSize <= 0`, `writer.ready` is replaced with a new pending promise that resolves when the queue drops below the limit again.
6. **Piping.** `readable.pipeTo(writable, options)` locks both ends, reads chunks and writes them, and waits on the writer's `ready` before each write. `readable.pipeThrough(transform)` pipes into `transform.writable` and returns `transform.readable`, so calls chain. An error at either end cancels the source or aborts the destination, unless `preventCancel`, `preventAbort` or `preventClose` say otherwise. `signal` stops the pipe.

**Pull model vs push model.** In both APIs the stream asks the source for data when its buffer has room: Node calls `_read()`, the web API calls `pull()`. The difference is how the source answers. Node's `push(chunk)` returns `false` when the buffer is at its limit, so a push-style source gets a direct answer on every call. The web `controller.enqueue(chunk)` returns `undefined`; the source has to read `controller.desiredSize`. The web API also waits for the promise returned by an async `pull()`, so an async source does not get overlapping calls. Node calls `_read()` again only after a `push()`.

**Units.** A Node byte stream measures its buffer in bytes, with a default limit of 64 KiB since v22 (16 objects in object mode). A web stream measures in whatever `size()` returns. The default is one unit per chunk with a limit of 1, so a web stream with no strategy holds one chunk, whether the chunk is 10 bytes or 10 MB. Pass `new ByteLengthQueuingStrategy({ highWaterMark: 65536 })` to get byte-based limits.

**Converters.** `Readable.toWeb`, `Readable.fromWeb`, `Writable.toWeb`, `Writable.fromWeb`, `Duplex.toWeb` and `Duplex.fromWeb` were added in v17.0.0 and marked stable (Stability 2) in v24.0.0. `Readable.toWeb(r, { strategy })` lets you set the web side's queue; with no strategy it uses `ByteLengthQueuingStrategy` with `r.readableHighWaterMark` (or `CountQueuingStrategy` in object mode), as the v24.19.0 source shows. `Readable.toWeb` got a `type: 'bytes'` option in v24.14.0, and `Duplex.toWeb` got `readableType` in v24.15.0. `Readable.fromWeb(rs, { encoding, highWaterMark, objectMode, signal })` and `Writable.fromWeb(ws, { decodeStrings, highWaterMark, objectMode, signal })` return ordinary Node streams. `pipeline()` has accepted web streams directly since v19.7.0 / v18.16.0, and `stream.finished()` since v19.5.0.

## Code examples

**Example 1 — a pull source, a reader, `read()` results and `releaseLock()`.**

javascript

```
import * as web from 'node:stream/web';
console.log('same class as the global:', web.ReadableStream === globalThis.ReadableStream);

// A pull-based source: pull() runs only when the queue has room.
let n = 0;
const stream = new ReadableStream({
  start(controller) {
    console.log('start(): desiredSize =', controller.desiredSize);
  },
  pull(controller) {
    n++;
    console.log(`pull() #${n}: desiredSize = ${controller.desiredSize}`);
    if (n <= 3) controller.enqueue(`chunk ${n}`);
    else controller.close();
  },
}, new CountQueuingStrategy({ highWaterMark: 1 }));

await new Promise((r) => setTimeout(r, 10));     // let start() and the first pull() run
console.log('locked before getReader():', stream.locked);
const reader = stream.getReader();
console.log('locked after getReader():', stream.locked);

let result;
do {
  result = await reader.read();
  console.log('read() ->', result);
} while (!result.done);

reader.releaseLock();
console.log('locked after releaseLock():', stream.locked);

// Real output (Node v24.19.0):
//   same class as the global: true
//   start(): desiredSize = 1
//   pull() #1: desiredSize = 1
//   locked before getReader(): false
//   locked after getReader(): true
//   pull() #2: desiredSize = 1
//   read() -> { value: 'chunk 1', done: false }
//   pull() #3: desiredSize = 1
//   read() -> { value: 'chunk 2', done: false }
//   pull() #4: desiredSize = 1
//   read() -> { value: 'chunk 3', done: false }
//   read() -> { value: undefined, done: true }
//   locked after releaseLock(): false
```

`pull()` runs once after `start()` to fill the one free slot, then once each time `read()` takes a chunk out. When `pull()` calls `close()`, the next `read()` resolves with `done: true` and `value: undefined`. `getReader()` locks the stream and `releaseLock()` unlocks it.

**Example 2 — writer backpressure: `desiredSize` goes negative and `writer.ready` waits.**

javascript

```
// A slow sink: each write takes 50 ms. Queue limit: 2 chunks.
const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 50) * 50).padStart(3)} ms`;

const sink = new WritableStream({
  async write(chunk) {
    await new Promise((r) => setTimeout(r, 50));
    console.log(`${at()}  sink wrote ${chunk}`);
  },
}, new CountQueuingStrategy({ highWaterMark: 2 }));

const writer = sink.getWriter();
console.log(`${at()}  desiredSize at start: ${writer.desiredSize}`);

// 1. Ignore backpressure: write() never refuses, desiredSize just goes negative.
for (const c of ['a', 'b', 'c', 'd', 'e']) {
  writer.write(c);                       // promise not awaited
  console.log(`${at()}  write(${c}) -> desiredSize ${writer.desiredSize}`);
}

// 2. Respect it: await writer.ready before each write.
for (const c of ['f', 'g']) {
  await writer.ready;                    // resolves when desiredSize > 0 again
  console.log(`${at()}  ready resolved, desiredSize ${writer.desiredSize}, writing ${c}`);
  writer.write(c);
}
await writer.close();
console.log(`${at()}  closed`);

// Real output (Node v24.19.0):
//     0 ms  desiredSize at start: 2
//     0 ms  write(a) -> desiredSize 1
//     0 ms  write(b) -> desiredSize 0
//     0 ms  write(c) -> desiredSize -1
//     0 ms  write(d) -> desiredSize -2
//     0 ms  write(e) -> desiredSize -3
//    50 ms  sink wrote a
//   100 ms  sink wrote b
//   150 ms  sink wrote c
//   200 ms  sink wrote d
//   200 ms  ready resolved, desiredSize 1, writing f
//   250 ms  sink wrote e
//   250 ms  ready resolved, desiredSize 1, writing g
//   300 ms  sink wrote f
//   350 ms  sink wrote g
//   350 ms  closed
```

The sink allows 2 chunks. Five `write()` calls without `await` are all accepted: `desiredSize` goes to -3 and nothing throws. That is the web version of ignoring `write() === false` in Node. The second loop awaits `writer.ready`, which stays pending until the queue drops below the limit (at 200 ms only `e` is left, so `desiredSize` is 1). Awaiting `ready` before each write keeps at most 2 chunks queued.

**Example 3 — queuing strategies: chunks vs bytes, compared with a Node `Readable`.**

javascript

```
import { Readable } from 'node:stream';

const chunk = new Uint8Array(1000);   // 1000 bytes

// Web: the strategy decides the unit. Enqueue 3 chunks without reading.
function fill(strategy) {
  let ctl;
  new ReadableStream({ start(c) { ctl = c; } }, strategy);
  const sizes = [];
  for (let i = 0; i < 3; i++) { ctl.enqueue(chunk); sizes.push(ctl.desiredSize); }
  return sizes.join(', ');
}
console.log('default strategy (count, hwm 1)  :', fill(undefined));
console.log('CountQueuingStrategy hwm 4       :', fill(new CountQueuingStrategy({ highWaterMark: 4 })));
console.log('ByteLengthQueuingStrategy 2500   :', fill(new ByteLengthQueuingStrategy({ highWaterMark: 2500 })));

// Node: the unit is bytes (or objects in objectMode); push() returns a boolean.
const r = new Readable({ read() {}, highWaterMark: 2500 });
const pushes = [];
for (let i = 0; i < 3; i++) pushes.push(`${r.push(chunk)}/${r.readableLength}`);
console.log('Node Readable hwm 2500 push()    :', pushes.join(', '), '(returned/bufferedBytes)');

// Real output (Node v24.19.0):
//   default strategy (count, hwm 1)  : 0, -1, -2
//   CountQueuingStrategy hwm 4       : 3, 2, 1
//   ByteLengthQueuingStrategy 2500   : 1500, 500, -500
//   Node Readable hwm 2500 push()    : true/1000, true/2000, false/3000 (returned/bufferedBytes)
```

The same three 1000-byte chunks give different `desiredSize` values depending on the strategy. With the default (count, limit 1), the stream is "full" after one chunk of any size. `ByteLengthQueuingStrategy` counts bytes, like Node. The Node `Readable` tells the source directly: its third `push()` returns `false`.

**Example 4 — `pull()` vs `_read()`: who asks for data, and when.**

javascript

```
import { Readable } from 'node:stream';

// The same source in both APIs: one item per request, limit 3 items, nobody reading yet.
let webPulls = 0, nodeReads = 0, i = 0, j = 0, webCtl;

const web = new ReadableStream({
  start(controller) { webCtl = controller; },
  async pull(controller) {            // web: returns a promise; no new pull() until it settles
    webPulls++;
    await new Promise((r) => setTimeout(r, 5));
    controller.enqueue(++i);          // enqueue() returns nothing; desiredSize is the signal
  },
}, new CountQueuingStrategy({ highWaterMark: 3 }));

const node = new Readable({
  objectMode: true, highWaterMark: 3,
  read() {                            // node: _read() asks for data; push() delivers it later
    nodeReads++;
    setTimeout(() => console.log(`node: push(${++j}) returned`, this.push(j)), 5);
  },
});
node.on('readable', () => {});        // start node's buffering without reading anything

await new Promise((r) => setTimeout(r, 200));
console.log(`web : pull() calls = ${webPulls}, desiredSize = ${webCtl.desiredSize}`);
console.log(`node: _read() calls = ${nodeReads}, readableLength = ${node.readableLength}`);

// One read on each side frees one slot, so each source is asked exactly once more.
await web.getReader().read();
node.read();
await new Promise((r) => setTimeout(r, 50));
console.log(`after one read -> web pull() calls = ${webPulls}, node _read() calls = ${nodeReads}`);

// Real output (Node v24.19.0):
//   node: push(1) returned true
//   node: push(2) returned true
//   node: push(3) returned false
//   web : pull() calls = 3, desiredSize = 0
//   node: _read() calls = 3, readableLength = 3
//   node: push(4) returned false
//   after one read -> web pull() calls = 4, node _read() calls = 4
```

Both sources are asked for exactly three items while nobody reads, and once more after one read frees a slot. The difference is in the answer: Node's `push(3)` returns `false`, while the web `enqueue()` returns nothing and the source would have to look at `desiredSize` (0 here).

**Example 5 — converting with `toWeb` and `fromWeb`.**

javascript

```
import { Readable, Writable, Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// 1. Node Readable -> web ReadableStream. In byte mode each Buffer arrives as a Uint8Array copy.
const webReadable = Readable.toWeb(Readable.from([Buffer.from('ab'), Buffer.from('cd')], { objectMode: false }));
for await (const chunk of webReadable) {
  console.log('toWeb chunk:', chunk.constructor.name, Buffer.from(chunk).toString());
}

// 2. web ReadableStream -> Node Readable. Now it has Node methods (setEncoding, pipe, operators).
const nodeReadable = Readable.fromWeb(new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode('hello ')); c.enqueue(new TextEncoder().encode('web')); c.close(); },
}));
nodeReadable.setEncoding('utf8');
console.log('fromWeb text:', (await nodeReadable.toArray()).join(''));

// 3. Node Writable <-> web WritableStream.
const got = [];
const nodeSink = new Writable({ write(c, _e, cb) { got.push(c.toString()); cb(); } });
const webSink = Writable.toWeb(nodeSink);
const w = webSink.getWriter();
await w.write(new TextEncoder().encode('x'));
await w.write(new TextEncoder().encode('y'));
await w.close();
console.log('Writable.toWeb received:', got, '| node finished:', nodeSink.writableFinished);

const seen = [];
const back = Writable.fromWeb(new WritableStream({ write(c) { seen.push(Buffer.from(c).toString()); } }));
await pipeline(Readable.from(['1', '2', '3']), back);
console.log('Writable.fromWeb received:', seen);

// 4. Duplex -> { readable, writable } pair, e.g. to hand a Node transform to web code.
const upper = new Duplex({
  read() {},
  write(chunk, _e, cb) { this.push(chunk.toString().toUpperCase()); cb(); },
  final(cb) { this.push(null); cb(); },
});
const { readable, writable } = Duplex.toWeb(upper);
const out = readable.pipeThrough(new TextDecoderStream()).values();
const writer = writable.getWriter();
await writer.write(new TextEncoder().encode('duplex'));
await writer.close();
for await (const s of out) console.log('Duplex.toWeb readable side:', s);

// Real output (Node v24.19.0):
//   toWeb chunk: Uint8Array ab
//   toWeb chunk: Uint8Array cd
//   fromWeb text: hello web
//   Writable.toWeb received: [ 'x', 'y' ] | node finished: true
//   Writable.fromWeb received: [ '1', '2', '3' ]
//   Duplex.toWeb readable side: DUPLEX
```

`Readable.toWeb` on a byte-mode stream copies each `Buffer` into a plain `Uint8Array` (the adapter does this to detach the chunk from Node's buffer pool), so web code does not see `Buffer` methods. In object mode the chunks pass through as they are. `Readable.fromWeb` gives back a Node `Readable` with all of its methods. `Duplex.toWeb` returns the `{ readable, writable }` pair that `pipeThrough` expects.

**Example 6 — how much a `Readable.toWeb` adapter reads ahead.**

javascript

```
import { Readable } from 'node:stream';

// A Node source that would produce 2000 chunks of 1 KiB, counted as it is asked.
function source() {
  let made = 0;
  const r = new Readable({ read() { made++; this.push(made <= 2000 ? Buffer.alloc(1024) : null); } });
  return { r, made: () => made };
}

for (const [label, opts] of [
  ['toWeb() defaults', undefined],
  ['toWeb() hwm 4 chunks', { strategy: new CountQueuingStrategy({ highWaterMark: 4 }) }],
]) {
  const { r, made } = source();
  const web = Readable.toWeb(r, opts);
  await new Promise((res) => setTimeout(res, 100));   // nobody reads
  console.log(`${label.padEnd(22)} chunks pulled from node with no reader: ${made()}`);
  await web.cancel();
}

// Real output (Node v24.19.0):
//   toWeb() defaults       chunks pulled from node with no reader: 128
//   toWeb() hwm 4 chunks   chunks pulled from node with no reader: 68
```

With no strategy, the web side uses a byte-length strategy with the Node stream's own `highWaterMark` (64 KiB), and the Node side keeps its own 64 KiB buffer as well: 128 chunks of 1 KiB, 128 KiB in memory, before anyone reads. With a `CountQueuingStrategy` of 4, the web queue holds 4 chunks and the Node buffer still fills its 64 KiB (64 chunks): 68. The `strategy` option only sizes the web queue.

**Example 7 — `fetch` bodies: reading `res.body`, saving it with `pipeline`, and a streamed upload with `duplex: 'half'` (local server).**

javascript

```
import http from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';

// Local server: GET /count sends 3 lines 50 ms apart; POST /upload counts the body bytes.
const server = http.createServer(async (req, res) => {
  if (req.url === '/count') {
    for (let i = 1; i <= 3; i++) {
      res.write(`line ${i}\n`);
      await new Promise((r) => setTimeout(r, 50));
    }
    return res.end();
  }
  let bytes = 0;
  for await (const chunk of req) bytes += chunk.length;
  res.end(`server got ${bytes} bytes, transfer-encoding: ${req.headers['transfer-encoding']}`);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;

// 1. A response body is a web ReadableStream: read it as it arrives.
const res = await fetch(`${base}/count`);
console.log('res.body is a ReadableStream:', res.body instanceof ReadableStream);
for await (const text of res.body.pipeThrough(new TextDecoderStream())) {
  console.log('chunk:', JSON.stringify(text));
}

// 2. Save a response body with Node streams: Readable.fromWeb + pipeline.
const res2 = await fetch(`${base}/count`);
await pipeline(Readable.fromWeb(res2.body), createWriteStream('out.txt'));
console.log('saved file:', JSON.stringify(await readFile('out.txt', 'utf8')));
await rm('out.txt');

// 3. A streamed request body needs duplex: 'half'.
const makeBody = () => new ReadableStream({
  start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(1000)); c.close(); },
});
try {
  await fetch(`${base}/upload`, { method: 'POST', body: makeBody() });
} catch (err) {
  console.log('without duplex:', err.name, '-', err.message);
}
const up = await fetch(`${base}/upload`, { method: 'POST', body: makeBody(), duplex: 'half' });
console.log('with duplex: "half":', await up.text());

server.close();

// Real output (Node v24.19.0):
//   res.body is a ReadableStream: true
//   chunk: "line 1\n"
//   chunk: "line 2\n"
//   chunk: "line 3\n"
//   saved file: "line 1\nline 2\nline 3\n"
//   without duplex: TypeError - RequestInit: duplex option is required when sending a body.
//   with duplex: "half": server got 4000 bytes, transfer-encoding: chunked
```

`res.body` is a `ReadableStream` of `Uint8Array` chunks. `pipeThrough(new TextDecoderStream())` turns it into text and decodes UTF-8 characters that are split across chunks correctly. To hand it to Node code, wrap it with `Readable.fromWeb`. To send a `ReadableStream` as a request body, `fetch` requires `duplex: 'half'`; without it, v24.19.0 throws the `TypeError` shown. The body goes out with `Transfer-Encoding: chunked`, because the length is not known in advance.

**Example 8 — async iteration: `for await`, `break`, and `values({ preventCancel: true })`.**

javascript

```
function numbers(label) {
  let i = 0;
  return new ReadableStream({
    pull(c) { c.enqueue(++i); if (i === 5) c.close(); },
    cancel(reason) { console.log(`  ${label}: cancel() called, reason =`, reason); },
  });
}

// 1. for await + break: the stream is cancelled and cannot be read again.
const a = numbers('a');
for await (const n of a) { console.log('a got', n); if (n === 2) break; }
console.log('a locked after break:', a.locked);
console.log('a read after break:', await a.getReader().read());

// 2. values({ preventCancel: true }) + break: the lock is released, the data is still there.
const b = numbers('b');
for await (const n of b.values({ preventCancel: true })) { console.log('b got', n); if (n === 2) break; }
console.log('b locked after break:', b.locked);
const left = [];
for await (const n of b) left.push(n);
console.log('b remaining:', left);

// Real output (Node v24.19.0):
//   a got 1
//   a got 2
//     a: cancel() called, reason = undefined
//   a locked after break: false
//   a read after break: { value: undefined, done: true }
//   b got 1
//   b got 2
//   b locked after break: false
//   b remaining: [ 3, 4, 5 ]
```

`for await` takes a reader for the length of the loop. Leaving the loop early with `break`, `return` or `throw` cancels the stream: `cancel()` runs and the remaining items are gone. `stream.values({ preventCancel: true })` returns an iterator that only releases the lock on early exit, so a second loop reads `3, 4, 5`.

**Example 9 — `pipeThrough`, `pipeTo`, `tee()`, `TextDecoderStream` and `CompressionStream`.**

javascript

```
import { gunzipSync } from 'node:zlib';

// A web TransformStream that splits text into lines: carry the tail, emit the last line in flush().
function lineSplitter() {
  let tail = '';
  return new TransformStream({
    transform(text, controller) {
      const lines = (tail + text).split('\n');
      tail = lines.pop();                       // maybe half a line: keep it for the next chunk
      for (const line of lines) controller.enqueue(line);
    },
    flush(controller) { if (tail) controller.enqueue(tail); },
  });
}

// Bytes split in awkward places: mid-line and inside the 2-byte "ë".
const bytes = new TextEncoder().encode('Ada,1500\nZoë,2500\nLin,200');
const source = () => new ReadableStream({
  start(c) { c.enqueue(bytes.subarray(0, 5)); c.enqueue(bytes.subarray(5, 12)); c.enqueue(bytes.subarray(12)); c.close(); },
});

// 1. pipeThrough chains transforms; TextDecoderStream keeps split UTF-8 characters intact.
const lines = [];
await source()
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(lineSplitter())
  .pipeTo(new WritableStream({ write(line) { lines.push(line); } }));
console.log('lines:', lines);

// 2. tee(): two independent branches of one stream. Here: gzip one, count the other.
const [toZip, toCount] = source().tee();
const [gz, n] = await Promise.all([
  new Response(toZip.pipeThrough(new CompressionStream('gzip'))).arrayBuffer(),
  (async () => { let total = 0; for await (const c of toCount) total += c.byteLength; return total; })(),
]);
console.log('branch 2 counted', n, 'bytes; branch 1 gzip size', gz.byteLength);
console.log('zlib can gunzip it:', gunzipSync(Buffer.from(gz)).toString().split('\n')[1]);

// 3. Round trip through DecompressionStream.
const back = await new Response(
  new Response(gz).body.pipeThrough(new DecompressionStream('gzip')),
).text();
console.log('DecompressionStream:', JSON.stringify(back));

// Real output (Node v24.19.0):
//   lines: [ 'Ada,1500', 'Zoë,2500', 'Lin,200' ]
//   branch 2 counted 26 bytes; branch 1 gzip size 44
//   zlib can gunzip it: Zoë,2500
//   DecompressionStream: "Ada,1500\nZoë,2500\nLin,200"
```

`lineSplitter()` is the web version of lesson 37's `createCsvParser()` approach: carry the incomplete tail into the next chunk and emit the last line in `flush()`. Here `TextDecoderStream` does the job of `StringDecoder`, which is why `Zoë` survives a chunk boundary in the middle of `ë`. `tee()` returns two branches that each get every chunk. `CompressionStream('gzip')` produces standard gzip that `zlib.gunzipSync` reads.

**Example 10 — one reader at a time, and stopping `pipeTo` with a signal.**

javascript

```
// 1. A stream has one reader at a time.
const s = new ReadableStream();
s.getReader();
try { s.getReader(); } catch (err) { console.log('second getReader():', err.name, err.code, '-', err.message); }

// 2. pipeTo with a signal: abort stops the pipe; the promise rejects with signal.reason.
let i = 0;
const ticks = new ReadableStream({
  async pull(c) { await new Promise((r) => setTimeout(r, 10)); c.enqueue(++i); },
  cancel(reason) { console.log('source cancel():', reason.name); },
});
const sink = new WritableStream({
  write(n) { if (n % 5 === 0) console.log('sink got', n); },
  abort(reason) { console.log('sink abort():', reason.name); },
});
const ac = new AbortController();
setTimeout(() => ac.abort(), 120);
try {
  await ticks.pipeTo(sink, { signal: ac.signal });
} catch (err) {
  console.log('pipeTo rejected:', err.name, err instanceof DOMException, err === ac.signal.reason);
}

// Real output (Node v24.19.0):
//   second getReader(): TypeError ERR_INVALID_STATE - Invalid state: ReadableStream is locked
//   sink got 5
//   sink got 10
//   sink abort(): AbortError
//   source cancel(): AbortError
//   pipeTo rejected: AbortError true true
```

A second `getReader()` throws a `TypeError` with code `ERR_INVALID_STATE`. When the signal aborts, `pipeTo` aborts the destination (`sink.abort()` runs), cancels the source (`source.cancel()` runs) and rejects with `signal.reason`, here the default `DOMException` named `AbortError`. This is the web shape; Node's `pipeline()` rejects with Node's own `AbortError` instead (see lesson 22).

**Example 11 — edge case: `tee()` with one slow branch keeps everything in memory.**

The task: send a download to two places, a fast one and a slow one. `tee()` looks like the answer. But a tee pulls from the source whenever *either* branch wants data, and a branch that is not read keeps every chunk in its queue:

javascript

```
// A source of 1000 chunks of 1 KiB, with a queue limit of 1 chunk.
let pulled = 0;
const source = new ReadableStream({
  pull(c) { if (++pulled > 1000) c.close(); else c.enqueue(new Uint8Array(1024)); },
}, new CountQueuingStrategy({ highWaterMark: 1 }));

const [fast, slow] = source.tee();

// Read only the fast branch. The slow branch is never read.
let fastBytes = 0;
for await (const c of fast) fastBytes += c.byteLength;
console.log('fast branch read', fastBytes / 1024, 'KiB');
console.log('chunks pulled from the source:', Math.min(pulled, 1000));

// Everything the fast branch saw is now waiting in the slow branch's queue.
const reader = slow.getReader();
let waiting = 0;
for (let r = await reader.read(); !r.done; r = await reader.read()) waiting++;
console.log('chunks that sat in the slow branch queue:', waiting);

// Real output (Node v24.19.0):
//   fast branch read 1000 KiB
//   chunks pulled from the source: 1000
//   chunks that sat in the slow branch queue: 1000
```

The source has a limit of 1 chunk, yet the slow branch ended up holding all 1000 chunks (1000 KiB), because the fast branch kept pulling and the tee enqueued each chunk into both branches. The slow branch's queue does not slow the source down. With a real 2 GB download, that is 2 GB in memory.

Node's `pipe()` to two destinations behaves the other way: the source pauses whenever *any* destination's `write()` returns `false`, so the pair runs at the slower speed:

javascript

```
import { Readable, Writable } from 'node:stream';

// The same fan-out with Node streams: one Readable piped to two Writables.
let made = 0;
const src = new Readable({ read() { this.push(++made <= 1000 ? Buffer.alloc(1024) : null); } });
const fast = new Writable({ write(c, _e, cb) { cb(); } });
const slow = new Writable({ highWaterMark: 1024, write(c, _e, cb) { setTimeout(cb, 10); } });  // 10 ms per KiB
src.pipe(fast);
src.pipe(slow);   // pipe() pauses the source whenever ANY destination's write() returns false

setTimeout(() => {
  console.log('after 100 ms: chunks made =', made, '| slow sink buffered =', slow.writableLength, 'bytes');
  src.unpipe(); src.destroy();
}, 100);

// Real output (Node v24.19.0):
//   after 100 ms: chunks made = 74 | slow sink buffered = 1024 bytes
```

After 100 ms the Node source has made only 74 chunks: its own 64 KiB buffer (64 chunks) plus the ten the slow sink has taken. So if one consumer can be much slower than the other, either fan out with Node streams (`Readable.fromWeb(body)` piped to both), or write the data to a file first and read the file twice. Use `tee()` only when both branches are read at about the same speed.

## Common mistakes & gotchas

- **Calling `.pipe()` or `.on('data')` on `res.body`.** It is a `ReadableStream`. Use `for await`, `getReader()`, `pipeTo()`, or wrap it with `Readable.fromWeb(res.body)`.
- **Ignoring `desiredSize` in a push source.** `controller.enqueue()` never refuses data. A source that enqueues from a timer or an event without checking `controller.desiredSize` fills memory, just like ignoring `write() === false` in Node.
- **Not awaiting `writer.ready`.** `writer.write()` accepts every chunk; `desiredSize` going negative is the only sign (Example 2). Await `ready` before each write, or let `pipeTo` do it.
- **Assuming `highWaterMark` means bytes.** In a web stream it means units of `size()`, and the default is one chunk. Use `ByteLengthQueuingStrategy` when chunk sizes vary.
- **Expecting the `strategy` of `Readable.toWeb` to bound total memory.** It sizes only the web queue; the Node stream underneath keeps its own buffer (Example 6).
- **Forgetting `releaseLock()`.** A stream with a live reader stays locked; `pipeTo`, `for await` and a second `getReader()` then fail with `ERR_INVALID_STATE`.
- **Breaking out of `for await` and expecting to keep reading.** The default iterator cancels the stream. Use `stream.values({ preventCancel: true })`.
- **Sending a `ReadableStream` body without `duplex: 'half'`.** `fetch` throws `TypeError: RequestInit: duplex option is required when sending a body.`
- **Treating `tee()` as free.** The faster branch sets the pace and the slower one buffers the difference (Example 11). Node's `pipe()` to two destinations goes at the slower one's pace instead.
- **Expecting a `Buffer`.** Chunks from `fetch` and from `Readable.toWeb` on a byte stream are `Uint8Array`. Wrap with `Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)` or use `TextDecoderStream` when you need text.

## Best practices

- **Stay in one API per pipeline.** Convert once at the boundary (`Readable.fromWeb(res.body)` going in, `Readable.toWeb(fileStream)` going out) instead of mixing the two inside a chain.
- **Let `pipeline()` handle mixed chains.** Since v19.7.0 / v18.16.0 it accepts `ReadableStream`, `TransformStream` and `WritableStream` stages next to Node streams. On error it destroys the Node streams, aborts a web destination and cancels a web source (a separate run on v24.19.0: a failing `Readable` made the `WritableStream`'s `abort()` run, and a failing `WritableStream` made the `ReadableStream`'s `cancel()` run).
- **Give byte streams a byte strategy.** `new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 })` makes a web stream's limit comparable to a Node stream's.
- **Write sources as `pull()` sources.** A `pull()` that produces one chunk per call is throttled by the stream for you; a `start()` that enqueues everything is not.
- **Decode with `TextDecoderStream`**, not with `new TextDecoder().decode(chunk)` per chunk, so UTF-8 characters split across chunks are decoded correctly.
- **Pass an `AbortSignal` to `pipeTo`** (and to `fetch`) so a cancelled request stops the whole transfer.

## ⭐ Interview lens

> **Q: “`fetch` gives you `res.body`. How do you stream it into a file with Node's `fs`?”**  
> A: `res.body` is a web `ReadableStream`, so `pipe()` does not exist on it. Either `await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path))`, or pass `res.body` straight to `pipeline()`, which has accepted web streams since v19.7.0. Both give Node's error handling and cleanup. *Trap:* `await res.arrayBuffer()` works too but loads the whole body into memory.

> **Q: “How does backpressure differ between Node streams and web streams?”**  
> A: In Node, `push()` and `write()` return `false` at the `highWaterMark`, and a writer waits for `'drain'`. In web streams nothing returns `false`: `enqueue()` and `writer.write()` always accept the chunk, and the signal is `desiredSize` (which can go negative) plus the `writer.ready` promise. Node measures byte streams in bytes; a web stream measures in units of the strategy's `size()`, one chunk by default.

> **Q: “What is a queuing strategy?”**  
> A: An object `{ highWaterMark, size(chunk) }`. `size` measures each chunk, `highWaterMark` is the limit in the same units, and `desiredSize = highWaterMark − total queued size`. `CountQueuingStrategy` counts chunks; `ByteLengthQueuingStrategy` sums `byteLength`.

> **Q: “Why does a `ReadableStream` have readers and locks?”**  
> A: So that only one consumer takes chunks out of the queue. `getReader()` locks the stream and `releaseLock()` unlocks it; `pipeTo`, `pipeThrough` and `for await` take the lock while they run. To give two consumers the same data you `tee()` it, and the slower branch then buffers the difference.

> **Q: “You `break` out of `for await (const chunk of stream)`. What happens to the stream?”**  
> A: The iterator's `return()` cancels it: the source's `cancel()` runs and the rest of the data is discarded. `stream.values({ preventCancel: true })` only releases the lock, so the stream can be read again.

## Cheat-card

- **Classes:** `ReadableStream`, `WritableStream`, `TransformStream` (globals since v18.0.0; `node:stream/web` since v16.5.0, stable since v21.0.0).
- **Source:** `start` / `pull` / `cancel`; `controller.enqueue`, `close`, `error`, `desiredSize`.
- **Read:** `getReader()` locks → `read()` → `{ value, done }` → `releaseLock()`.
- **Write:** `getWriter()` locks → `await writer.ready` → `writer.write(chunk)` → `close()`; `desiredSize` can go negative.
- **Strategy:** `{ highWaterMark, size }`; default = 1 chunk; `CountQueuingStrategy` (chunks), `ByteLengthQueuingStrategy` (bytes).
- **Signal:** web = `desiredSize` + `ready`; Node = `push()`/`write()` → `false` + `'drain'`.
- **Convert:** `Readable.toWeb/fromWeb`, `Writable.toWeb/fromWeb`, `Duplex.toWeb/fromWeb` (added v17.0.0, stable v24.0.0).
- **Pipe:** `rs.pipeThrough(ts).pipeTo(ws, { signal, preventClose, preventAbort, preventCancel })`.
- **Iterate:** `for await (const c of rs)`; `break` cancels; `rs.values({ preventCancel: true })` does not.
- **fetch:** `res.body` is a `ReadableStream`; streamed request body needs `duplex: 'half'`.
- **Built-in transforms:** `TextDecoderStream`, `TextEncoderStream`, `CompressionStream` / `DecompressionStream` (`gzip`, `deflate`, `deflate-raw`, `brotli` since v24.7.0).
- **`tee()`:** two branches; the slower one buffers everything the faster one has read.

---

## Learn More

- [Web Streams API nodejs.org](https://nodejs.org/docs/latest-v24.x/api/webstreams.html)
- [Stream (Readable.toWeb / fromWeb) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
- [Streams API developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
- [Streams API concepts developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Concepts)
- [RequestInit (duplex) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit)
- [Streams Standard streams.spec.whatwg.org](https://streams.spec.whatwg.org/)
