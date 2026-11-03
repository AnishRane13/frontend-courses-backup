---
title: "zlib: gzip, deflate and Brotli"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# zlib: gzip, deflate and Brotli

*16 min read · Updated 10 Oct 2026 · Topic 80 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

`node:zlib` runs gzip, deflate, Brotli, or zstd on a buffer or on a stream, swapping repeated text for short back-references so the bytes on the wire or on disk get smaller. It exists because JSON, HTML, and logs repeat themselves, and a few kilobytes of JSON can leave the server as a few hundred bytes. The trade-off is CPU time, and a small compressed upload can expand into a huge buffer unless you cap the output.

## Why it matters

JSON, HTML, CSS, JavaScript, and log lines repeat the same keys, tags, and words. A compressor replaces each repeat with a short back-reference. In Example 4 a 5.6 KB JSON response goes out as 420 bytes. That is less bandwidth, faster pages on slow links, and smaller backups.

Compression spends CPU. Brotli's default quality, 11, turned a request that should be quick into a 1.6 second one on a 770 KB sample (Example 6). A compressed response without `Vary: Accept-Encoding` can be cached and then served to a client that cannot decode it. Compressing a body twice sends gzip bytes the client cannot read as text. Decompression is an attack surface: a 100 KB upload can inflate to 100 MB or more, a zip bomb, unless you cap the output (Example 5).

You need `node:zlib` for HTTP compression, for `.gz` files, and for compressed request bodies, and you need to know those limits.

## The concept, simply

`node:zlib` is a binding to compression libraries compiled into the `node` binary. DEFLATE, from RFC 1951, is the core algorithm: it stores back-references into a 32 KiB window and then Huffman-codes the result. It shows up in three wrappers.

- **raw deflate** (`deflateRaw`) is the bare compressed stream, with no header and no checksum.
- **zlib format** (`deflate`, RFC 1950) adds a 2-byte header and a 4-byte Adler-32 checksum. HTTP `Content-Encoding: deflate` means this wrapper.
- **gzip** (`gzip`, RFC 1952) adds a 10-byte header that starts with the magic bytes `1f 8b`, and an 8-byte trailer with a CRC-32 and the original size. That is `.gz` files and `Content-Encoding: gzip`.

Brotli (RFC 7932) uses back-references too, with a larger window and a built-in dictionary of common web text. It is `Content-Encoding: br`. Zstandard (RFC 8878), `zstdCompress` and the matching decompress functions, is `Content-Encoding: zstd`. In the v24 docs zstd is Stability 1, Experimental. On v24.19.0 `typeof zlib.createZstdCompress` is `'function'`, and calling it printed no warning.

Each algorithm has three shapes.

1. **Sync one-shot.** `zlib.gzipSync(buf)` returns a Buffer on the main thread and blocks the event loop until it finishes.
2. **Async one-shot.** `zlib.gzip(buf, callback)`, or `util.promisify(zlib.gzip)`, runs on the libuv thread pool and returns the whole result as one Buffer. There is no `node:zlib/promises` module in v24. `require('zlib/promises')` throws `MODULE_NOT_FOUND`.
3. **Stream.** `zlib.createGzip()` returns a Transform. Compressed chunks come out while input is still going in, and memory stays bounded.

Decompression mirrors this: `gunzip` and `createGunzip`, `inflate`, `inflateRaw`, `brotliDecompress`, `zstdDecompress`. `zlib.unzip` detects gzip or zlib from the header.

## How it works

1. You pick an algorithm and options. For DEFLATE formats, `level` runs from 0 to 9. `Z_DEFAULT_COMPRESSION` is `-1`, which zlib treats as 6. Brotli takes `params` keyed by `zlib.constants`, such as `BROTLI_PARAM_QUALITY` from 0 to 11, default 11. zstd takes `ZSTD_c_compressionLevel`, default 3.
2. Node creates a native handle that owns the C library's window and hash tables. With default deflate settings that state is about 256 KiB, plus an output buffer of `chunkSize` (16 KiB). Inflate needs 32 KiB by default.
3. Input is fed in pieces. Async and stream calls run on the libuv thread pool. The v24 docs say every zlib API except the ones marked synchronous uses that pool. The sync API calls the same C code on the main thread.
4. The library writes into a `chunkSize` buffer. Each time it fills, Node copies a Buffer chunk out. A one-shot call concatenates the chunks. A stream pushes each chunk.
5. At the end the format writes its trailer: gzip's CRC-32 and size, or zlib's Adler-32. On the way back, a bad header or a bad trailer fails with a zlib code such as `Z_DATA_ERROR`.
6. One-shot calls honor `maxOutputLength`, which defaults to `buffer.kMaxLength`. Past that limit they fail with `ERR_BUFFER_TOO_LARGE`. A stream ignores this option. Example 5 shows that.

`createGzip()`, `createGunzip()`, `createBrotliCompress()`, and the rest are Transform streams. You write plain bytes in and read compressed bytes out. `pipeline()` chains them: a file Readable, then gzip, then maybe a cipher, then a file or a socket. Each stage holds its own buffer, up to `highWaterMark` (64 KiB by default since v22), plus the compressor's window. When the destination is slow, `write()` returns `false` and earlier stages pause.

![A transform chain: a Readable file.txt flows into a gzip Transform, then an encrypt Transform, then a Writable, with backpressure flowing back up the chain](assets/i25_01_8f41e854.svg)
*Figure: a Readable → Transform (gzip) → Transform (encrypt) → Writable pipeline, the shape every zlib stream fits into. Look at: the backpressure arrow running back up the chain, which is what keeps memory flat when the Writable is slow.*

Use a one-shot call when the data is small and already in memory: a JSON body, a cache entry, a queue message. On a server, use the async form or a stream. `gzipSync` blocks every other request while it runs. Use a stream when the data is large, already a stream, or when the first compressed bytes should leave before the input has all arrived.

**HTTP negotiation.** The client lists codings in `Accept-Encoding`, with weights. `q=0` means "not this one". You pick a coding you support, set `Content-Encoding`, and set `Vary: Accept-Encoding` so a cache stores the plain and compressed bodies separately. RFC 9110 says a missing `Accept-Encoding` allows any coding, and an empty value allows none. Example 4 sends those uncompressed. A streamed body has no `Content-Length`. HTTP/1.1 then uses chunked transfer.

Do not compress PNG, JPEG, WebP, MP4, ZIP, or `.gz`. They are already compressed, and a second pass costs CPU and usually grows them. Tiny bodies gain little. A body that already has `Content-Encoding` must not be compressed again.

## Code examples

**Example 1: one input, five formats, and what the wrappers cost.**

javascript

```
// ex1.mjs — the same bytes through every one-shot compressor
import zlib from 'node:zlib';

const input = Buffer.from(JSON.stringify(
  Array.from({ length: 2000 }, (_, i) => ({ id: i, user: `user${i % 50}`, status: i % 3 ? 'active' : 'blocked' }))
));

const codecs = {
  gzip:       [zlib.gzipSync,            zlib.gunzipSync],
  deflate:    [zlib.deflateSync,         zlib.inflateSync],
  deflateRaw: [zlib.deflateRawSync,      zlib.inflateRawSync],
  brotli:     [zlib.brotliCompressSync,  zlib.brotliDecompressSync],
  zstd:       [zlib.zstdCompressSync,    zlib.zstdDecompressSync],
};

console.log('input', input.length, 'bytes');
for (const [name, [compress, decompress]] of Object.entries(codecs)) {
  const packed = compress(input);
  const back = decompress(packed);
  console.log(name.padEnd(10), String(packed.length).padStart(6), 'bytes',
    'first bytes', packed.subarray(0, 4).toString('hex'), 'round-trip ok:', back.equals(input));
}

// Real output (Node v24.19.0):
//   input 91158 bytes
//   gzip         6194 bytes first bytes 1f8b0800 round-trip ok: true
//   deflate      6182 bytes first bytes 789c95dd round-trip ok: true
//   deflateRaw   6176 bytes first bytes 95ddc1aa round-trip ok: true
//   brotli       2060 bytes first bytes 5b156471 round-trip ok: true
//   zstd         3328 bytes first bytes 28b52ffd round-trip ok: true
```

The three DEFLATE forms hold the same compressed bytes. `deflate` is raw plus 6 bytes. `gzip` is raw plus 18. Their first bytes are the signatures: `1f8b` gzip, `789c` zlib at the default level, `28b52ffd` zstd. Brotli has no fixed magic number. On this repetitive JSON, Brotli at quality 11 is about a third the size of gzip.

**Example 2: sync, callback, and promisified one-shot calls.**

javascript

```
// ex2.mjs — callback and promisified one-shot calls run off the main thread
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const input = Buffer.alloc(20 * 1024 * 1024, 'abcdefgh');  // 20 MiB of text

// 1. callback form: error-first, like fs
zlib.gzip('hello', (err, buf) => {
  if (err) throw err;
  console.log('callback gzip:', buf.length, 'bytes');
});

// 2. promisified form: the main thread keeps ticking while a pool thread compresses
let ticks = 0;
const timer = setInterval(() => ticks++, 1);
let t = performance.now();
const packed = await gzip(input, { level: 9 });
console.log(`async gzip: ${packed.length} bytes in ${(performance.now() - t).toFixed(0)} ms, timer ticks meanwhile: ${ticks}`);

// 3. sync form: blocks the event loop for the whole job
ticks = 0;
t = performance.now();
zlib.gzipSync(input, { level: 9 });
console.log(`sync  gzip: done in ${(performance.now() - t).toFixed(0)} ms, timer ticks meanwhile: ${ticks}`);
clearInterval(timer);

// 4. a bad input rejects with a zlib error code
try {
  await gunzip(Buffer.from('not gzip at all'));
} catch (err) {
  console.log('gunzip of garbage:', err.code, '-', err.message);
}

// Real output (Node v24.19.0):
//   callback gzip: 25 bytes
//   async gzip: 30578 bytes in 80 ms, timer ticks meanwhile: 74
//   sync  gzip: done in 72 ms, timer ticks meanwhile: 0
//   gunzip of garbage: Z_DATA_ERROR - incorrect header check
```

The interval kept firing during the promisified call because the work ran on the thread pool, and it fired zero times during `gzipSync`. The async form was not faster here. It keeps the main thread free, which is what a server needs.

**Example 3: streams. Gzip a file and check the round trip.**

javascript

```
// ex3.mjs — gzip a file and gunzip it back with streams; memory stays far below the file size
import { createReadStream, createWriteStream, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { createGzip, createGunzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

// make a log file of N MiB (default 64), 1 MiB at a time
const N = Number(process.argv[2] ?? 64);
const block = Buffer.from('GET /api/orders?page=2 200 13ms ua="curl/8.18.0"\n'.repeat(21400)).subarray(0, 1024 * 1024);
const fd = openSync('access.log', 'w');
for (let i = 0; i < N; i++) writeSync(fd, block);
closeSync(fd);

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MiB';
console.log('RSS before streaming:', mb(process.memoryUsage().rss));
let peak = 0;
const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);

// compress: Readable -> Transform (gzip) -> Writable
await pipeline(createReadStream('access.log'), createGzip(), createWriteStream('access.log.gz'));

// decompress and hash, without writing the plain text anywhere
const hash = createHash('sha256');
await pipeline(createReadStream('access.log.gz'), createGunzip(), hash);
clearInterval(sampler);

const original = createHash('sha256');
await pipeline(createReadStream('access.log'), original);

console.log('plain  :', mb(statSync('access.log').size));
console.log('gzipped:', mb(statSync('access.log.gz').size));
console.log('same bytes after round trip:', hash.digest('hex') === original.digest('hex'));
console.log('peak RSS while streaming:', mb(peak));
```

bash

```
$ node ex3.mjs
RSS before streaming: 51.2 MiB
plain  : 64.0 MiB
gzipped: 0.2 MiB
same bytes after round trip: true
peak RSS while streaming: 75.6 MiB
$ node ex3.mjs 512
RSS before streaming: 51.5 MiB
plain  : 512.0 MiB
gzipped: 1.5 MiB
same bytes after round trip: true
peak RSS while streaming: 103.5 MiB
```

The file grew eight-fold, from 64 MiB to 512 MiB, while peak resident memory grew from about 76 MiB to 104 MiB. Each stage holds its buffer and the compressor's window, not the file. These log lines are identical, so they compress better than real logs would.

**Example 4: HTTP response compression, negotiation, `Vary`, and not compressing twice.**

javascript

```
// server.mjs — negotiate Content-Encoding, set Vary, never compress twice
import http from 'node:http';
import zlib from 'node:zlib';
import { pipeline, Readable } from 'node:stream';

// Parse "gzip;q=0.8, br, *;q=0" into Map { 'gzip' => 0.8, 'br' => 1, '*' => 0 }
function parseAcceptEncoding(header = '') {
  const map = new Map();
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    map.set(name, q ? Number(q.slice(2)) : 1);
  }
  return map;
}

// Server preference order; return null for "send it uncompressed"
function pickEncoding(header) {
  const accepted = parseAcceptEncoding(header);
  for (const coding of ['br', 'gzip']) {
    const q = accepted.has(coding) ? accepted.get(coding) : (accepted.get('*') ?? 0);
    if (q > 0) return coding;
  }
  return null;
}

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml))/;
const MIN_BYTES = 1024;

function send(req, res, status, headers, body) {
  const type = headers['Content-Type'] ?? '';
  const eligible = COMPRESSIBLE.test(type) && !headers['Content-Encoding'] && body.length >= MIN_BYTES;
  if (eligible) res.setHeader('Vary', 'Accept-Encoding');   // caches must key on this header
  const coding = eligible ? pickEncoding(req.headers['accept-encoding']) : null;
  if (!coding) {
    res.writeHead(status, { ...headers, 'Content-Length': body.length });
    return res.end(body);
  }
  const encoder = coding === 'br'
    ? zlib.createBrotliCompress({ params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5,            // 11 (the default) is too slow per request
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT } })
    : zlib.createGzip({ level: 6 });
  // no Content-Length: the compressed size is unknown until the end, so Node uses chunked encoding
  res.writeHead(status, { ...headers, 'Content-Encoding': coding });
  pipeline(Readable.from([body]), encoder, res, (err) => { if (err) res.destroy(err); });
}

const json = Buffer.from(JSON.stringify({ items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item ${i}` })) }));
const pngLike = Buffer.alloc(4096, 0x89);                  // stands in for an already-compressed image
const preGzipped = zlib.gzipSync('pre-built asset '.repeat(200));

const server = http.createServer((req, res) => {
  if (req.url === '/api/items') return send(req, res, 200, { 'Content-Type': 'application/json' }, json);
  if (req.url === '/logo.png')  return send(req, res, 200, { 'Content-Type': 'image/png' }, pngLike);
  if (req.url === '/app.js')    // a pre-compressed file: already has Content-Encoding, so send() leaves it alone
    return send(req, res, 200, { 'Content-Type': 'application/javascript', 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' }, preGzipped);
  if (req.url === '/app-twice.js') {   // THE BUG: gzip a body that is already gzip
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Content-Encoding': 'gzip' });
    return pipeline(Readable.from([preGzipped]), zlib.createGzip(), res, () => {});
  }
  send(req, res, 404, { 'Content-Type': 'text/plain' }, Buffer.from('not found'));
});
server.listen(5180, () => console.log('listening on http://localhost:5180'));
```

Run it with `node server.mjs`. curl's `--compressed` sends `Accept-Encoding` and decodes the body. The saved output below drops `Date`, `Connection`, `Keep-Alive`, and `Content-Type`.

bash

```
$ curl -s -o /dev/null -D - --compressed http://localhost:5180/api/items
HTTP/1.1 200 OK
Vary: Accept-Encoding
Content-Encoding: br
Transfer-Encoding: chunked
$ curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip' http://localhost:5180/api/items
HTTP/1.1 200 OK
Vary: Accept-Encoding
Content-Encoding: gzip
Transfer-Encoding: chunked
$ curl -s -o /dev/null -D - -H 'Accept-Encoding: br;q=0, gzip;q=0' http://localhost:5180/api/items
HTTP/1.1 200 OK
Vary: Accept-Encoding
Content-Length: 5591
$ curl -s -o /dev/null -D - --compressed http://localhost:5180/logo.png
HTTP/1.1 200 OK
Content-Length: 4096
$ curl -s -o /dev/null -D - --compressed http://localhost:5180/app.js
HTTP/1.1 200 OK
Content-Encoding: gzip
Vary: Accept-Encoding
Content-Length: 61
$ curl -s --compressed http://localhost:5180/app.js | head -c 32; echo
pre-built asset pre-built asset 
$ curl -s --compressed http://localhost:5180/app-twice.js | head -c 4 | od -An -tx1
 1f 8b 08 00
$ curl -s -o /dev/null --compressed -w '%{size_download} bytes on the wire\n' http://localhost:5180/api/items
420 bytes on the wire
$ curl -s -o /dev/null -w '%{size_download} bytes on the wire\n' http://localhost:5180/api/items
5591 bytes on the wire
$ curl -sv -o /dev/null --compressed http://localhost:5180/api/items 2>&1 | grep '> Accept-Encoding'
> Accept-Encoding: deflate, gzip, br, zstd
```

Prefer `br` when it is offered, else gzip. `q=0` stays plain, still with `Vary`. Skip images. Leave a body that already has `Content-Encoding` alone. Compressing it again leaves gzip magic, `1f 8b`, after the outer layer is removed. This JSON went out as 420 bytes instead of 5,591.

**Example 5: a 100 MiB gzip bomb against `maxOutputLength` and a stream guard.**

A zip bomb is a small compressed input that expands hugely. Runs of zeros compress about 1000 to 1 with DEFLATE, so a 100 KB gzip body becomes 100 MiB. If you inflate whatever arrives, the client chooses your memory use.

javascript

```
// bomb.mjs — a 100 MiB gzip bomb against maxOutputLength and a byte-counting stream guard
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const LIMIT = 10 * 1024 * 1024;                  // we accept at most 10 MiB of decompressed data
const mib = (n) => (n / 1024 / 1024).toFixed(1) + ' MiB';

// 1. Build the bomb: 100 MiB of zeros, compressed one chunk at a time
const zero = Buffer.alloc(1024 * 1024);
const parts = [];
await pipeline(Readable.from((function* () { for (let i = 0; i < 100; i++) yield zero; })()),
  zlib.createGzip({ level: 9 }), async function (source) { for await (const c of source) parts.push(c); });
const bomb = Buffer.concat(parts);
console.log(`bomb: ${bomb.length} bytes on disk -> 100 MiB when inflated (ratio ${(100 * 1024 * 1024 / bomb.length).toFixed(0)}:1)`);

// 2. One-shot API: maxOutputLength stops inflation at the limit
const rss0 = process.memoryUsage().rss;
try {
  zlib.gunzipSync(bomb, { maxOutputLength: LIMIT });
} catch (err) {
  console.log('gunzipSync      :', err.code, '-', err.message);
}
try {
  await promisify(zlib.gunzip)(bomb, { maxOutputLength: LIMIT });
} catch (err) {
  console.log('gunzip (promise):', err.code, '-', err.message);
}
console.log('RSS grew by', mib(process.memoryUsage().rss - rss0), 'with the limit');
const rss1 = process.memoryUsage().rss;
const all = zlib.gunzipSync(bomb);                 // no limit: the whole 100 MiB lands in one Buffer
console.log('no limit        :', mib(all.length), 'Buffer, RSS grew by', mib(process.memoryUsage().rss - rss1));

// 3. Stream API: maxOutputLength does not apply, so count bytes yourself
function limitBytes(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > max) return cb(Object.assign(new Error(`decompressed body exceeds ${max} bytes`), { code: 'ERR_TOO_LARGE', seen }));
      cb(null, chunk);
    },
  });
}

let delivered = 0;
try {
  await pipeline(
    Readable.from([bomb]),
    zlib.createGunzip({ maxOutputLength: LIMIT }),   // accepted, but ignored by streams
    limitBytes(LIMIT),
    async function (source) { for await (const c of source) delivered += c.length; },
  );
} catch (err) {
  console.log('stream guard    :', err.code, '-', err.message, `(stopped after ${mib(err.seen)})`);
}
console.log('bytes the consumer received:', mib(delivered));

// 4. Without the guard the stream happily inflates all of it
let total = 0;
await pipeline(Readable.from([bomb]), zlib.createGunzip({ maxOutputLength: LIMIT }),
  async function (source) { for await (const c of source) total += c.length; });
console.log('no guard, maxOutputLength set on the stream:', mib(total), 'inflated');

// Real output (Node v24.19.0):
//   bomb: 101941 bytes on disk -> 100 MiB when inflated (ratio 1029:1)
//   gunzipSync      : ERR_BUFFER_TOO_LARGE - Cannot create a Buffer larger than 10485760 bytes
//   gunzip (promise): ERR_BUFFER_TOO_LARGE - Cannot create a Buffer larger than 10485760 bytes
//   RSS grew by 14.1 MiB with the limit
//   no limit        : 100.0 MiB Buffer, RSS grew by 205.0 MiB
//   stream guard    : ERR_TOO_LARGE - decompressed body exceeds 10485760 bytes (stopped after 10.0 MiB)
//   bytes the consumer received: 10.0 MiB
//   no guard, maxOutputLength set on the stream: 100.0 MiB inflated
```

The bomb is 101,941 bytes, about 1029 to 1. One-shot `gunzip` stopped at 10 MiB with `ERR_BUFFER_TOO_LARGE`. The stream ignored `maxOutputLength` and emitted 100 MiB until a counting Transform failed the pipeline. Cap the compressed input too, and answer 413.

**Example 6: size and time per level on a ~770 KiB JSON sample.**

javascript

```
// levels.mjs — size and time per level on a ~770 KiB JSON sample (times are machine-specific)
import zlib from 'node:zlib';

// deterministic sample: a small PRNG so every run builds the same bytes
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'];
const rows = Array.from({ length: 6000 }, (_, i) => ({
  id: i, sku: `SKU-${Math.floor(rand() * 1e6)}`, name: `${words[i % 8]} ${words[(i * 7) % 8]}`,
  price: +(rand() * 500).toFixed(2), tags: [words[Math.floor(rand() * 8)], words[Math.floor(rand() * 8)]],
  createdAt: new Date(1.7e12 + Math.floor(rand() * 3e10)).toISOString(),
}));
const input = Buffer.from(JSON.stringify(rows));

function bench(label, fn) {
  const times = [];
  let out;
  for (let i = 0; i < 7; i++) { const t = process.hrtime.bigint(); out = fn(); times.push(Number(process.hrtime.bigint() - t) / 1e6); }
  times.sort((a, b) => a - b);
  console.log(`${label.padEnd(34)} ${String(out.length).padStart(7)} B  ${(100 * out.length / input.length).toFixed(1).padStart(5)}%  ${times[3].toFixed(1).padStart(6)} ms`);
}

const { constants: C } = zlib;
console.log('BROTLI_DEFAULT_QUALITY =', C.BROTLI_DEFAULT_QUALITY, ' Z_DEFAULT_COMPRESSION =', C.Z_DEFAULT_COMPRESSION);
console.log(`input ${input.length} bytes; median of 7 runs`);
for (const level of [1, 6, 9]) bench(`gzip level ${level}`, () => zlib.gzipSync(input, { level }));
for (const q of [1, 5, 11]) bench(`brotli quality ${q}`, () =>
  zlib.brotliCompressSync(input, { params: { [C.BROTLI_PARAM_QUALITY]: q } }));
bench('brotli, no options (default)', () => zlib.brotliCompressSync(input));
bench('brotli q5 + MODE_TEXT + SIZE_HINT', () => zlib.brotliCompressSync(input, { params: {
  [C.BROTLI_PARAM_QUALITY]: 5, [C.BROTLI_PARAM_MODE]: C.BROTLI_MODE_TEXT, [C.BROTLI_PARAM_SIZE_HINT]: input.length } }));
for (const level of [1, 3, 19]) bench(`zstd level ${level}`, () =>
  zlib.zstdCompressSync(input, { params: { [C.ZSTD_c_compressionLevel]: level } }));
const gz6 = zlib.gzipSync(input);
bench('gunzip of the level-6 output', () => zlib.gunzipSync(gz6));

// Real output (Node v24.19.0):
//   BROTLI_DEFAULT_QUALITY = 11  Z_DEFAULT_COMPRESSION = -1
//   input 788077 bytes; median of 7 runs
//   gzip level 1                        180053 B   22.8%     6.3 ms
//   gzip level 6                        143195 B   18.2%    17.6 ms
//   gzip level 9                        140800 B   17.9%    36.8 ms
//   brotli quality 1                    175954 B   22.3%     3.7 ms
//   brotli quality 5                    144553 B   18.3%    19.3 ms
//   brotli quality 11                   113869 B   14.4%  1568.7 ms
//   brotli, no options (default)        113869 B   14.4%  1568.9 ms
//   brotli q5 + MODE_TEXT + SIZE_HINT   144553 B   18.3%    18.4 ms
//   zstd level 1                        163818 B   20.8%     2.8 ms
//   zstd level 3                        159349 B   20.2%     3.8 ms
//   zstd level 19                       120659 B   15.3%   447.1 ms
//   gunzip of the level-6 output        788077 B  100.0%     2.0 ms
```

On this i5-1135G7, gzip's default level 6 was slower than level 1 for a modest size win, and Brotli's default quality 11 took 1.6 seconds. The per-level table is the thing to re-run on your own data. The reading of those rows is in Good to know.

## Common mistakes & gotchas

- **`*Sync` in a request handler.** `gzipSync` on a 20 MiB body blocked the event loop for 72 to 115 ms in Example 2. Use the callback, the promisified form, or a stream.
- **Brotli quality 11 on dynamic responses.** That default took 1.6 s on 770 KiB. Use a quality around 5 on the fly, and 11 only for assets you compress once.
- **No `Vary: Accept-Encoding`.** A shared cache can store the first version it saw and serve gzip to a client that did not ask, or plain bytes to everyone.
- **Compressing twice.** A pre-compressed file or an upstream that already set `Content-Encoding` becomes gzip inside gzip (Example 4, `/app-twice.js`).
- **`Content-Length` set to the uncompressed size.** Drop it and let Node use chunked encoding, or compress first and set the real length.
- **Expecting `maxOutputLength` to protect a stream.** It limits one-shot calls only. Count bytes in a Transform after the decompressor.
- **HTTP `deflate` decoded with `inflateRaw`.** `Content-Encoding: deflate` is the zlib wrapper. Raw inflate then fails with `Z_DATA_ERROR`.
- **Compressing images, video, and archives.** You pay CPU for a body the same size or larger.
- **Thousands of zlib calls at once.** Each one owns native state. The v24 docs warn that 30,000 concurrent `zlib.deflate` calls can fragment memory. Cache compressed results.
- **Treating zstd as a stable API.** It is Stability 1, Experimental, in v24, even though it prints no warning.

## Best practices

- **Compress in one place:** a reverse proxy, a CDN, or one middleware, so `Vary`, content type, and the double-compression check stay consistent.
- **Pre-compress static files** at Brotli 11 and gzip 9, store `app.js.br` and `app.js.gz`, and serve the match with `Content-Encoding` and `Vary`. Dynamic responses stay at gzip 1 to 6 or Brotli around 5.
- **Skip small bodies and compressed media.** Example 4 uses a 1 KiB minimum and allows text, JSON, JavaScript, and XML.
- **Cap decompression.** `maxOutputLength` on one-shot calls, a byte-counting Transform on streams, and a cap on the compressed input.
- **Use `pipeline()` for every zlib stream** so an error destroys every stage and frees the native handle.
- **Measure on your own data.** Ratios depend on the content and the CPU. Example 6 is a template.

## ⭐ Interview lens

> **Q: “What is the difference between `deflate`, `deflateRaw` and `gzip` in `node:zlib`?”**  
A: All three carry the same DEFLATE stream. DEFLATE is back-references plus Huffman coding. `deflateRaw` is that stream with nothing wrapped around it. `deflate` adds the zlib wrapper, a 2-byte header and a 4-byte Adler-32 checksum, 6 bytes in all. `gzip` adds a 10-byte header that starts with the bytes `1f 8b`, and an 8-byte trailer with a CRC-32 and the original size, 18 bytes of framing. HTTP `Content-Encoding: deflate` means the zlib wrapper, not the raw stream. On one repetitive JSON sample the three DEFLATE forms differed only by those framing bytes. The limit is treating gzip as a different algorithm. It is the same DEFLATE bytes in a different envelope, which is why a gzip body decoded as raw deflate fails.

> **Q: “How do you add response compression to a raw `http` server correctly?”**  
A: Read `Accept-Encoding`, including `q` weights, and pick a coding you support. Skip small bodies, types that are already compressed, and any body that already has `Content-Encoding`. Set `Content-Encoding` to the coding you chose, and set `Vary: Accept-Encoding` on every response whose body can change with that header. Pipe the body through `createBrotliCompress` or `createGzip` into `res` with `pipeline`, and omit `Content-Length` so Node sends chunked encoding. Use a low Brotli quality, around 5, because the default is 11. In the sample server, a client that offered Brotli got `br`, and a body that was already gzip was left alone. The limit is a second compression pass. Gzip inside gzip still starts with `1f 8b` after the outer layer is removed, and the browser cannot read it as script.

> **Q: “A client can upload gzip-encoded JSON. What can go wrong?”**  
A: A zip bomb is a small gzip body that expands enormously. Runs of zeros are about 1000 to 1, so 100 KB becomes 100 MiB. If you inflate into a Buffer, the client chooses how much memory you allocate. For one-shot `gunzip` and `gunzipSync`, pass `maxOutputLength`. Past the cap Node throws `ERR_BUFFER_TOO_LARGE`. In the lesson's run, a 10 MiB cap stopped a 100 MiB bomb and resident memory grew by 14 MiB. Without the cap it grew by 205 MiB. The limit is streams. `createGunzip({ maxOutputLength })` ignored the option and emitted the full 100 MiB, so you count bytes in a Transform after the decompressor, cap the compressed bytes you read from `req`, and answer 413.

> **Q: “Why is Brotli sometimes slower than gzip, when it is supposed to be better?”**  
A: Brotli is often smaller than gzip, and its default quality is 11, the slowest setting. On a 770 KiB JSON sample, quality 11 made the smallest output and took 1.6 seconds, against about 18 ms for gzip at level 6. Quality 5 matched gzip 6 in both size and speed. The algorithm is still back-references and Huffman coding, with a larger window and a dictionary of common web strings, so the extra time is the search for a smaller encoding, not a different result you get for free. Use 11 for a file you compress once at build time. The limit is per-request compression. Shipping the default on a dynamic response spends CPU the client will not notice as a smaller body if you already matched gzip's size at quality 5.

## Cheat-card

- **Formats:** `deflateRaw` is bare. `deflate` is the zlib wrapper, plus 6 bytes, and it is HTTP "deflate". `gzip` is plus 18 bytes, magic `1f 8b`. `brotliCompress` is `br`. `zstdCompress` is `zstd` and Experimental in v24.
- **Three shapes:** `xSync(buf)` blocks. `x(buf, cb)` or `promisify(x)` uses the pool. `createX()` is a Transform.
- **No `zlib/promises`.** Use `util.promisify(zlib.gzip)`.
- **Defaults:** gzip level 6 (`Z_DEFAULT_COMPRESSION` is -1). Brotli quality 11, which is slow. zstd level 3. `chunkSize` 16 KiB.
- **HTTP:** parse `Accept-Encoding` and `q` (`q=0` refuses). Set `Content-Encoding`. Always send `Vary: Accept-Encoding`. Omit `Content-Length` when streaming.
- **Skip:** images, video, archives, tiny bodies, anything that already has `Content-Encoding`.
- **Zip bombs:** `maxOutputLength` on one-shot calls throws `ERR_BUFFER_TOO_LARGE`. Streams need a counting Transform. Cap the compressed input. Answer 413.
- **Tuning:** dynamic responses at gzip 1 to 6 or Brotli around 5. Build-time assets at Brotli 11 or gzip 9. Measure your data.

## Good to know

- On v24.19.0, `process.versions` reports zlib `1.3.2.1-motley-3246f1b`, Brotli 1.2.0, and zstd 1.5.7. Brotli was added in v11.7.0 and v10.16.0. zstd was added in v23.8.0 and v22.15.0. `maxOutputLength` was added to the convenience methods in v14.5.0 and v12.19.0.
- Deflate memory in the v24 docs is `(1 << (windowBits + 2)) + (1 << (memLevel + 9))` bytes, 128 KiB plus 128 KiB at the defaults, plus a `chunkSize` output buffer. Inflate needs `1 << windowBits` bytes, 32 KiB by default.
- Is `zlib.gzip` with a callback faster than `zlib.gzipSync`? Not by itself. It runs the same C code on a libuv pool thread and was about the same speed or slower in Example 2 (about 80 to 150 ms async against 72 to 115 ms sync over five runs). It keeps the main thread free, and it shares the four default pool threads with `fs` and `crypto`.
- `BROTLI_PARAM_SIZE_HINT` is the expected input size and defaults to 0 for an unknown size. Passing it did not change the output size in Example 6, one-shot or in 16 KiB stream chunks.
- Example 6 on an i5-1135G7: gzip level 6 was 2.8 times slower than level 1 for a 20% smaller result. Level 9 doubled that time and saved under 2%. Brotli quality 11 took 1.6 s. Quality 5 matched gzip 6 in size and speed. zstd level 3 was the fastest, sized between gzip 1 and gzip 6. Level 19 came within 6% of Brotli 11 in under a third of the time. Gunzip of the level-6 output took 2 ms.
## Learn More

- [Zlib | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/zlib.html)
- [Stream (pipeline) | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
- [Accept-Encoding developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding)
- [Content-Encoding developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding)
- [Vary developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary)
- [RFC 9110: HTTP Semantics (Accept-Encoding) rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 1952: GZIP file format rfc-editor.org](https://www.rfc-editor.org/rfc/rfc1952.html)
- [RFC 7932: Brotli rfc-editor.org](https://www.rfc-editor.org/rfc/rfc7932.html)
