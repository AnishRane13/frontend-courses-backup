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

## Say it in 30 seconds

A web stream is the browser-style queue of chunks that `fetch` gives you as `res.body`, with a reader or a writer that locks the stream while it runs. Node has it alongside the older `node:stream` classes because the same code now runs in browsers, Deno, Bun, and Node. The trade-off is backpressure. Nothing in this API refuses a chunk. You have to watch `desiredSize`, or await `writer.ready`, or the whole body queues in memory.

## Why it matters

Node has two stream APIs. Lessons 35 to 38 cover `node:stream`: `Readable`, `Writable`, `Transform`, and `pipeline`. The second is the WHATWG Streams Standard, the one browsers and edge runtimes use. Node ships it as globals (`ReadableStream`, `WritableStream`, `TransformStream`) and from `node:stream/web`.

`fetch` is where you meet it. On Node v24.19.0, `res.body` is a `ReadableStream`, not a Node `Readable`. It has no `.pipe()`, no `'data'` event, and no `setEncoding()`. Code written for Node streams fails with `TypeError: res.body.pipe is not a function`. The same is true of `Blob.stream()`, `CompressionStream`, and `TextDecoderStream`.

You need the web API itself, the converters (`Readable.toWeb`, `Readable.fromWeb`, and the writable and duplex pairs), and the place their backpressure rules differ. Without that last piece a loop looks fine and quietly queues the whole body.

## The concept, simply

A web stream is a queue of chunks plus a small object that feeds or drains it.

- A **ReadableStream** wraps an underlying source. `start(controller)` runs once. `pull(controller)` runs when the queue has room. `cancel(reason)` runs when the consumer gives up. The source calls `controller.enqueue(chunk)`, `controller.close()`, and `controller.error(err)`. `getReader()` locks the stream so only one consumer reads. `reader.read()` returns a promise of `{ value, done }`.
- A **WritableStream** wraps a sink with `start`, `write(chunk, controller)`, `close`, and `abort`. `getWriter()` locks it. `writer.write(chunk)` returns a promise. `writer.desiredSize` is how much room is left. `writer.ready` resolves when there is room again.
- A **TransformStream** is a pair, `writable` and `readable`, joined by `transform(chunk, controller)` and `flush(controller)`.

A **queuing strategy** is `{ highWaterMark, size(chunk) }`. `size` measures one chunk. `highWaterMark` is the limit in those units. `desiredSize` is the limit minus what is queued. `CountQueuingStrategy` counts each chunk as 1. `ByteLengthQueuingStrategy` uses `chunk.byteLength`. With no strategy, a readable or writable counts chunks and the limit is 1.

Nothing refuses data. `enqueue` and `writer.write` always accept the chunk. Past the limit, `desiredSize` goes to zero or below. Backpressure works only if the producer reads `desiredSize` or awaits `writer.ready`.

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

## How it works

1. `new ReadableStream(source, strategy)` calls `start(controller)` at once, then `pull(controller)` while `desiredSize > 0`. If `pull` returns a promise, it is not called again until that promise settles.
2. Each `enqueue` subtracts `size(chunk)` from `desiredSize`. At 0 the stream stops calling `pull`. A source that enqueues from `start` or from a timer is a push source. Nothing stops it. It has to read `controller.desiredSize` itself.
3. `getReader()` locks the stream. `read()` takes the oldest chunk, or waits if the queue is empty. After `close()` and an empty queue, `read()` resolves `{ value: undefined, done: true }`. Taking a chunk raises `desiredSize`, so `pull` runs again.
4. `releaseLock()` lets another reader, a `for await` loop, or `pipeTo` use the stream. `cancel(reason)` drops the queue and calls `source.cancel`.
5. `writer.write(chunk)` queues the chunk and resolves when `sink.write` finishes that chunk. The sink handles one chunk at a time, and the chunk in progress still counts. When `desiredSize <= 0`, `writer.ready` is a new promise that resolves once the queue drops under the limit.
6. `readable.pipeTo(writable)` locks both ends, reads, writes, and waits on `writer.ready`. `pipeThrough(transform)` writes into `transform.writable` and returns `transform.readable`. An error cancels the source or aborts the destination unless `preventCancel`, `preventAbort`, or `preventClose` says otherwise. `signal` stops the pipe.

Both APIs ask the source for data when the buffer has room. Node calls `_read()`. The web API calls `pull()`. Node's `push(chunk)` returns `false` at the limit. `controller.enqueue(chunk)` returns `undefined`, so you read `desiredSize`. An async `pull` does not overlap. Node calls `_read` again only after a `push`.

A Node byte stream measures bytes, 64 KiB by default since v22, or 16 objects in object mode. A web stream measures whatever `size()` returns. The default is one unit per chunk with a limit of 1, so one chunk can be 10 bytes or 10 MB. Pass `new ByteLengthQueuingStrategy({ highWaterMark: 65536 })` for a byte limit.

`Readable.fromWeb` and `Writable.fromWeb` return ordinary Node streams. `pipeline()` has accepted web streams directly. Chunks from `fetch` and from `Readable.toWeb` on a byte stream are `Uint8Array`, not `Buffer`.

## Code examples

**Example 1: a pull source, a reader, `read()` results, and `releaseLock()`.**

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

`pull` runs once after `start` to fill the one free slot, then once each time `read` takes a chunk. `close()` makes the next `read` resolve with `done: true` and `value: undefined`. `getReader` locks the stream. `releaseLock` unlocks it.

**Example 2: writer backpressure. `desiredSize` goes negative and `writer.ready` waits.**

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

Five `write` calls without `await` are all accepted and `desiredSize` goes to -3. Nothing throws. That is the web version of ignoring `write() === false`. Awaiting `writer.ready` keeps at most the strategy's two chunks queued.

**Example 3: queuing strategies, chunks versus bytes, next to a Node `Readable`.**

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

The same three 1000-byte chunks fill a count strategy after one chunk. `ByteLengthQueuingStrategy` counts bytes, so the limit is a size, not a count.

**Example 4: `pull()` versus `_read()`. Who asks for data, and when.**

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

Both sources are asked for three items while nobody reads, and once more after a read frees a slot. Node's `push` returns `false` at the limit. Web `enqueue` returns nothing, and you read `desiredSize`.

**Example 5: converting with `toWeb` and `fromWeb`.**

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

`Readable.toWeb` on a byte stream copies each `Buffer` into a `Uint8Array` so the chunk is detached from Node's buffer pool. Object mode passes the value through.

**Example 6: how much a `Readable.toWeb` adapter reads ahead.**

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

With no strategy the web side uses a byte strategy sized to the Node `highWaterMark` (64 KiB), and the Node side keeps its own 64 KiB. That is 128 KiB before anyone reads. The strategy option does not cap the Node buffer underneath.

**Example 7: `fetch` bodies, `pipeline`, and a streamed upload with `duplex: 'half'`.**

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

`res.body` is a `ReadableStream` of `Uint8Array` chunks. `pipeThrough(new TextDecoderStream())` decodes UTF-8 that was split across chunks. `Readable.fromWeb` or passing the web stream straight to `pipeline` writes a file. A streamed request body needs `duplex: 'half'` or `fetch` throws.

**Example 8: `for await`, `break`, and `values({ preventCancel: true })`.**

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

`for await` holds a reader for the loop. `break`, `return`, or `throw` cancels the stream and the rest of the data is gone. `stream.values({ preventCancel: true })` only releases the lock, so you can keep reading.

**Example 9: `pipeThrough`, `pipeTo`, `tee()`, `TextDecoderStream`, and `CompressionStream`.**

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

Carry an incomplete line into the next chunk and emit the last line from `flush`. `TextDecoderStream` holds a split UTF-8 character the way `StringDecoder` does. `tee()` splits one stream into two branches.

**Example 10: one reader at a time, and stopping `pipeTo` with a signal.**

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

A second `getReader()` throws `TypeError` with code `ERR_INVALID_STATE`. Aborting the signal aborts the sink, cancels the source, and rejects with `signal.reason`, here a `DOMException` named `AbortError`. Node's `pipeline` rejects with Node's own `AbortError` instead.

**Example 11: `tee()` with one slow branch keeps everything in memory.**

`tee()` pulls from the source when either branch wants data, and a branch you do not read keeps every chunk:

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

The source limit is 1 chunk, and the slow branch still held all 1000 chunks, because the fast branch kept pulling and each chunk was queued for both. The slow queue does not slow the source. A 2 GB download would sit in memory.

Node's `pipe()` to two destinations pauses when any `write()` returns `false`, so the pair runs at the slower speed:

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

After 100 ms the Node source had made 74 chunks: its 64 KiB buffer plus the ten the slow sink took. If one consumer is much slower, fan out with Node streams, or write a file and read it twice. Use `tee()` when both branches are read at about the same speed.

## Common mistakes & gotchas

- **Calling `.pipe()` or `.on('data')` on `res.body`.** It is a `ReadableStream`. Use `for await`, `getReader()`, `pipeTo()`, or `Readable.fromWeb(res.body)`.
- **Ignoring `desiredSize` in a push source.** `enqueue` never refuses a chunk. A timer that enqueues without checking `desiredSize` fills memory.
- **Not awaiting `writer.ready`.** `write` accepts every chunk. A negative `desiredSize` is the sign (Example 2).
- **Assuming `highWaterMark` means bytes.** It means units of `size()`. The default is one chunk. Use `ByteLengthQueuingStrategy` when sizes vary.
- **Expecting the strategy of `Readable.toWeb` to bound total memory.** It sizes the web queue. The Node stream keeps its own buffer (Example 6).
- **Forgetting `releaseLock()`.** A live reader keeps the stream locked. `pipeTo`, `for await`, and a second `getReader()` then fail with `ERR_INVALID_STATE`.
- **Breaking out of `for await` and expecting to keep reading.** The default iterator cancels. Use `stream.values({ preventCancel: true })`.
- **Sending a `ReadableStream` body without `duplex: 'half'`.** `fetch` throws `TypeError: RequestInit: duplex option is required when sending a body.`
- **Treating `tee()` as free.** The faster branch sets the pace and the slower one buffers the difference (Example 11).
- **Expecting a `Buffer`.** `fetch` and `Readable.toWeb` on a byte stream give `Uint8Array`. Wrap with `Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)`, or use `TextDecoderStream` for text.

## Best practices

- **Stay in one API per pipeline.** Convert once at the edge: `Readable.fromWeb(res.body)` on the way in, `Readable.toWeb(fileStream)` on the way out.
- **Let `pipeline()` handle a mixed chain.** It accepts web streams next to Node streams, destroys Node streams on error, aborts a web destination, and cancels a web source.
- **Give byte streams a byte strategy.** `new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 })` is comparable to a Node byte stream.
- **Write sources as `pull` sources.** One chunk per `pull` is throttled for you. A `start` that enqueues everything is not.
- **Decode with `TextDecoderStream`**, not `new TextDecoder().decode(chunk)` per chunk, so a character split across chunks stays intact.
- **Pass an `AbortSignal` to `pipeTo` and to `fetch`** so a cancelled request stops the transfer.

## ⭐ Interview lens

> **Q: “`fetch` gives you `res.body`. How do you stream it into a file with Node's `fs`?”**  
A: `res.body` from `fetch` is a web `ReadableStream`, the WHATWG queue, not a Node `Readable`. It has no `.pipe()` and no `'data'` event. To write it to disk, convert once and let `pipeline` do backpressure and cleanup: `await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path))`. `pipeline` also accepts the web stream directly, so you can pass `res.body` as a stage. Either way an error destroys the file stream. The chunks are `Uint8Array`. The limit is `await res.arrayBuffer()` or `res.text()`. Those work, and they load the whole body into memory, which is the thing streaming was meant to avoid.

> **Q: “How does backpressure differ between Node streams and web streams?”**  
A: Backpressure is how a slow consumer tells a fast producer to pause so the queue stays bounded. In Node, `push()` and `write()` return `false` when the buffer hits `highWaterMark`, and the writer waits for `'drain'`. In web streams nothing returns false. `controller.enqueue()` and `writer.write()` always take the chunk, and the signal is `desiredSize`, which can go negative, plus the `writer.ready` promise. Example 2 queued five writes with a limit of two and `desiredSize` went to -3 without throwing. A Node byte stream counts bytes, 64 KiB by default. A web stream counts whatever `size()` returns, and the default is one chunk, however large. The limit is a push source that never reads `desiredSize`. The queue grows for as long as the timer keeps enqueueing.

> **Q: “What is a queuing strategy?”**  
A: A queuing strategy is the object `{ highWaterMark, size(chunk) }` that tells a web stream how to measure its queue. `size` scores one chunk. `highWaterMark` is the limit in those same units. `desiredSize` is the limit minus the total already queued, and it is the number you watch for backpressure. `CountQueuingStrategy` scores every chunk as 1, so three 1000-byte chunks and three 10-byte chunks count the same. `ByteLengthQueuingStrategy` sums `byteLength`. With no strategy the default is a count of 1. The limit is the word `highWaterMark` itself. On a web stream it is not "64 KiB" unless you passed a byte strategy. It is "this many units of `size`".

> **Q: “Why does a `ReadableStream` have readers and locks?”**  
A: A reader exists so only one consumer takes chunks out of the queue. `getReader()` sets `locked` to true. `releaseLock()` clears it. `pipeTo`, `pipeThrough`, and `for await` take that lock while they run, and a second `getReader()` throws `ERR_INVALID_STATE`. You read with `reader.read()`, which resolves `{ value, done }`. To give two consumers the same bytes you call `tee()`, which returns two branches. The limit is the slow branch. `tee()` pulls when either side wants data, and the side you are not reading keeps every chunk, so a fast reader and an unread branch hold the whole body.

## Cheat-card

- **Classes:** `ReadableStream`, `WritableStream`, `TransformStream`, as globals and from `node:stream/web`.
- **Source:** `start`, `pull`, `cancel`. `controller.enqueue`, `close`, `error`, `desiredSize`.
- **Read:** `getReader()` locks, `read()` returns `{ value, done }`, `releaseLock()` unlocks.
- **Write:** `getWriter()` locks, `await writer.ready`, `writer.write(chunk)`, `close()`. `desiredSize` can go negative.
- **Strategy:** `{ highWaterMark, size }`. Default is 1 chunk. `CountQueuingStrategy` counts chunks. `ByteLengthQueuingStrategy` sums bytes.
- **Signal:** web uses `desiredSize` and `ready`. Node uses `push` or `write` returning `false`, then `'drain'`.
- **Convert:** `Readable.toWeb` and `fromWeb`, and the same pair on `Writable` and `Duplex`.
- **Pipe:** `rs.pipeThrough(ts).pipeTo(ws, { signal, preventClose, preventAbort, preventCancel })`.
- **Iterate:** `for await (const c of rs)`. `break` cancels. `rs.values({ preventCancel: true })` does not.
- **fetch:** `res.body` is a `ReadableStream`. A streamed request body needs `duplex: 'half'`.
- **Built-in transforms:** `TextDecoderStream`, `TextEncoderStream`, `CompressionStream`, `DecompressionStream` (`gzip`, `deflate`, `deflate-raw`, `brotli`).
- **`tee()`:** two branches. The slower one buffers everything the faster one has read.

## Good to know

- The classes were added in v16.5.0 in `node:stream/web` and became globals in v18.0.0. The module stopped being experimental in v21.0.0. The globals docs mark `ReadableStream`, `CompressionStream`, and the rest stable in v23.11.0 and v22.15.0. `TextDecoderStream` and `TextEncoderStream` were added in v16.6.0. `CompressionStream` and `DecompressionStream` were added in v17.0.0, `'deflate-raw'` in v21.2.0 and v20.12.0, `'brotli'` in v24.7.0. `ReadableStream.from(iterable)` was added in v20.6.0. `fetch` was added in v17.5.0 and v16.15.0, lost `--experimental-fetch` in v18.0.0, and stopped being experimental in v21.0.0.
- Converters were added in v17.0.0 and marked stable in v24.0.0. `Readable.toWeb` with no strategy uses `ByteLengthQueuingStrategy` and `r.readableHighWaterMark`, or `CountQueuingStrategy` in object mode. `type: 'bytes'` on `Readable.toWeb` arrived in v24.14.0. `readableType` on `Duplex.toWeb` arrived in v24.15.0. `pipeline()` has accepted web streams since v19.7.0 and v18.16.0. `stream.finished()` has accepted them since v19.5.0.
- You `break` out of `for await (const chunk of stream)`. What happens to the stream? The iterator's `return()` cancels it: `source.cancel()` runs and the rest is discarded. `stream.values({ preventCancel: true })` only releases the lock, so the stream can be read again.
## Learn More

- [Web Streams API nodejs.org](https://nodejs.org/docs/latest-v24.x/api/webstreams.html)
- [Stream (Readable.toWeb / fromWeb) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
- [Streams API developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
- [Streams API concepts developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API/Concepts)
- [RequestInit (duplex) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/RequestInit)
- [Streams Standard streams.spec.whatwg.org](https://streams.spec.whatwg.org/)
