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

## Why it matters

JSON, HTML, CSS, JavaScript and log lines repeat themselves: the same keys, tags and words appear again and again. A compressor replaces each repeat with a short back-reference, so a 5.6 KB JSON response goes over the wire as 420 bytes (Example 4). That means less bandwidth, faster pages on slow mobile links, smaller backups and cheaper storage.

Compression also costs something, and the costs show up in production. Every byte you compress uses CPU time. The wrong setting (Brotli's default quality 11 on a dynamic response) can turn a 20 ms request into a 1.6 s one (Example 6). A response that is compressed without `Vary: Accept-Encoding` can be cached by a proxy and then served to a client that cannot decode it. A body that is compressed twice reaches the client as gzip bytes it cannot read. And decompression is an attack surface: a 100 KB upload can inflate to 100 MB or more (a "zip bomb") and exhaust the server's memory unless you cap the output (Example 5).

Node ships all of this in the `node:zlib` module. You need it for HTTP compression, for reading `.gz` files and for decoding compressed request bodies, and you need to know where its limits are.

## The concept, simply

`node:zlib` is a binding to three C compression libraries that are compiled into the `node` binary. On v24.19.0, `process.versions` reports `zlib 1.3.2.1-motley-3246f1b` (Chromium's fork of zlib), `brotli 1.2.0` and `zstd 1.5.7`. They give you four algorithms, one of which comes in three wrappers:

- **DEFLATE** (RFC 1951) is LZ77 back-references plus Huffman coding, with a 32 KiB look-back window. It comes in three wrappers:
  - **raw deflate** (`deflateRaw`) is the bare compressed stream, with no header and no checksum;
  - **zlib format** (`deflate`, RFC 1950) adds a 2-byte header and a 4-byte Adler-32 checksum. HTTP's `Content-Encoding: deflate` means this format;
  - **gzip** (`gzip`, RFC 1952) adds a 10-byte header (it starts with the magic bytes `1f 8b`) and an 8-byte trailer holding a CRC-32 and the input size. This is what `.gz` files and `Content-Encoding: gzip` use.
- **Brotli** (RFC 7932, added in v11.7.0 and v10.16.0) also uses back-references and Huffman coding, but with a larger window, context modelling and a built-in dictionary of common web strings. It is `Content-Encoding: br`.
- **Zstandard** (RFC 8878, `zstdCompress` and friends, added in v23.8.0 and v22.15.0) is `Content-Encoding: zstd`. It is **Stability 1, Experimental** in the v24 docs. On v24.19.0 `typeof zlib.createZstdCompress` is `'function'`, and calling it printed no warning.

Each algorithm has the same three API shapes:

1. **Sync one-shot:** `zlib.gzipSync(buf)` returns a Buffer. It runs on the main thread and blocks the event loop until it finishes.
2. **Async one-shot:** `zlib.gzip(buf, callback)`, or `util.promisify(zlib.gzip)`. It runs on the libuv thread pool and gives you the whole result as one Buffer. There is no `node:zlib/promises` module in v24 (`require('zlib/promises')` throws `MODULE_NOT_FOUND`), so you promisify it yourself.
3. **Stream:** `zlib.createGzip()` returns a Transform stream. Compressed chunks come out while input is still going in, and memory stays bounded.

Decompression mirrors compression: `gunzip`/`createGunzip`, `inflate`, `inflateRaw`, `brotliDecompress`, `zstdDecompress`. `zlib.unzip` auto-detects gzip or zlib format from the header.

## How it works

1. **You pick an algorithm and options.** For DEFLATE formats the main option is `level` (0 to 9; `Z_DEFAULT_COMPRESSION` is `-1`, which zlib treats as 6). For Brotli you pass `params` keyed by `zlib.constants`, for example `BROTLI_PARAM_QUALITY` (0 to 11, default 11). For zstd you pass `params` with `ZSTD_c_compressionLevel` (default 3).
2. **Node creates a native handle** that owns the C library's state: for deflate, the window and hash tables. The v24 docs give the deflate memory as `(1 << (windowBits + 2)) + (1 << (memLevel + 9))` bytes, which is 128 KiB + 128 KiB with the defaults, plus an output buffer of `chunkSize` (16 KiB by default). Inflate needs `1 << windowBits` bytes, 32 KiB by default.
3. **Input is fed to the library in pieces.** For the async and stream APIs each piece is processed on a libuv thread-pool thread ("All `zlib` APIs, except those that are explicitly synchronous, use the Node.js internal threadpool", in the v24 docs). The sync API calls the same C code directly on the main thread.
4. **The library writes output into a `chunkSize` buffer.** Each time it fills, Node copies it out as a Buffer chunk. A one-shot call collects the chunks and concatenates them. A stream pushes each chunk to its readable side.
5. **At the end, the format's trailer is written** (gzip's CRC-32 and size, zlib's Adler-32). On decompression, the trailer is checked, and a mismatch or a bad header rejects with a zlib error code such as `Z_DATA_ERROR`.
6. **One-shot calls check `maxOutputLength`.** It defaults to `buffer.kMaxLength`. If the collected output would grow past it, the call fails with `ERR_BUFFER_TOO_LARGE`. This option was added to the convenience methods in v14.5.0 and v12.19.0. The docs say it "limits output size when using convenience methods", and Example 5 shows that a stream ignores it.

**The stream API.** `createGzip()`, `createGunzip()`, `createBrotliCompress()` and the rest return Transform streams. You write uncompressed bytes into the writable side, and compressed bytes come out of the readable side. Because they are ordinary Transforms, you compose them with `pipeline()`: a file Readable, then gzip, then perhaps a cipher, then a file or socket Writable. Each stage holds only its internal buffer (up to `highWaterMark`, 64 KiB by default since v22), plus the compressor's window. When the destination is slow, `write()` returns `false` further down the chain and the earlier stages pause, so a file of any size passes through in bounded memory.

![A transform chain: a Readable file.txt flows into a gzip Transform, then an encrypt Transform, then a Writable, with backpressure flowing back up the chain](assets/i25_01_8f41e854.svg)
*Figure: a Readable → Transform (gzip) → Transform (encrypt) → Writable pipeline, the shape every zlib stream fits into. Look at: the backpressure arrow running back up the chain, which is what keeps memory flat when the Writable is slow.*

**Choosing between one-shot and streams.** Use one-shot calls for data that is small and already in memory: a JSON body, a cache entry, a message on a queue. Use the async one-shot (callback or promisified) on a server, because the sync form blocks every other request while it runs. Use streams when the data is large, comes from a stream already (a file, `req`, a socket), or when you want the first compressed bytes to leave before the input has all arrived.

**HTTP negotiation.** The client lists what it can decode in `Accept-Encoding`, optionally with weights: `br, gzip;q=0.8, *;q=0`. A weight of `q=0` means "not acceptable". The server picks one coding it supports, compresses, and labels the body with `Content-Encoding`. Per RFC 9110, a request with **no** `Accept-Encoding` header means any coding is acceptable, while an **empty** value means none is wanted. The server in Example 4 sends an uncompressed body in both cases, which is always safe. Because the response body now depends on a request header, the server must send `Vary: Accept-Encoding`. That tells every cache between the server and the client to store the gzip and identity versions separately. The compressed length is not known until the compressor finishes, so a streamed compressed response has no `Content-Length`, and Node uses `Transfer-Encoding: chunked` on HTTP/1.1.

**What not to compress.** PNG, JPEG, WebP, MP4, ZIP and `.gz` files are already compressed, and compressing them again costs CPU and usually makes them slightly bigger. Bodies of a few hundred bytes gain little. A body that already has a `Content-Encoding` (a pre-compressed asset, or a response proxied from an upstream that compressed it) must not be compressed a second time.

## Code examples

**Example 1 — one input, five formats, and what the wrappers cost.**

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

The three DEFLATE variants hold the same compressed data. `deflate` is raw plus 6 bytes (2-byte header, 4-byte Adler-32), and `gzip` is raw plus 18 bytes (10-byte header, 8-byte trailer). Their first bytes are the format signatures: `1f8b` for gzip, `789c` for the zlib header at the default level, `28b52ffd` for zstd. Brotli has no fixed magic number. On this repetitive JSON, Brotli at its default quality 11 is a third the size of gzip.

**Example 2 — sync, callback and promisified one-shot calls.**

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

The interval kept firing during the promisified call because the work ran on the thread pool, and it fired zero times during `gzipSync`. The async form is not faster: its total time was about the same or longer in repeated runs (80 to 150 ms async against 72 to 115 ms sync over five runs on this machine), because the data crosses into the pool in chunks. It keeps the main thread free, which on a server is what matters. Your timings will be different.

**Example 3 — streams: gzip a file and check the round trip.**

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

The file grew eight-fold between the two runs, from 64 MiB to 512 MiB, while the peak resident memory grew from about 76 MiB to 104 MiB: memory grew far less than the file did, because each stage holds only its buffer and the compressor's window, not the file. The log lines are identical, so this sample compresses far better than real logs would.

**Example 4 — HTTP response compression: negotiation, `Vary`, and not compressing twice.**

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

Run it with `node server.mjs` and query it from another terminal with curl 8.18.0. `--compressed` makes curl send `Accept-Encoding` and decode the response. The output is trimmed (…): the `Date`, `Connection`, `Keep-Alive` and `Content-Type` header lines were removed.

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

How to read it:

1. curl's `--compressed` offered `deflate, gzip, br, zstd`, and the server picked `br` because it comes first in the server's preference list. With only `gzip` offered, it sent gzip.
2. Both compressed responses have `Vary: Accept-Encoding` and `Transfer-Encoding: chunked` instead of `Content-Length`.
3. When the client refuses both codings with `q=0`, the body goes out uncompressed, still with `Vary`, because the response for this URL *does* vary with the header.
4. `/logo.png` is skipped by the content-type check, and gets no `Vary` because it never varies.
5. `/app.js` already carries `Content-Encoding: gzip` (a file compressed at build time), so `send()` leaves it alone and curl decodes it to text.
6. `/app-twice.js` shows the bug: after curl removes one layer of gzip, the body still starts with `1f 8b 08 00`, the gzip magic. A browser would show garbage, or fail to load the script.
7. The JSON went over the wire as 420 bytes instead of 5,591.

**Example 5 — edge case: a 100 MiB gzip bomb against `maxOutputLength` and a stream guard.**

A zip bomb is a small compressed input that expands to a huge output. Runs of zeros compress about 1000:1 with DEFLATE, so a 100 KB request body with `Content-Encoding: gzip` becomes 100 MiB once inflated. If your code inflates whatever arrives, an attacker controls how much memory you allocate.

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

What happened, in order:

1. The bomb is 101,941 bytes: 100 MiB of zeros at a ratio of about 1029:1.
2. `gunzipSync` and the promisified `gunzip` both stopped at 10 MiB with `ERR_BUFFER_TOO_LARGE`. Memory grew by 14 MiB.
3. Without the limit, the same call returned a 100 MiB Buffer, and resident memory grew by 205 MiB: the output chunks plus the final concatenated copy.
4. On the stream, the guard Transform counted bytes and failed the pipeline just past 10 MiB. `pipeline` destroyed every stage, and the consumer had received 10 MiB.
5. Without the guard, the stream inflated the full 100 MiB even though `maxOutputLength` was passed to `createGunzip`. The option applies to one-shot calls only.

In a server you would also cap the *compressed* request size (stop reading `req` after, say, 1 MiB), and return `413 Content Too Large` when either limit trips.

**Example 6 — tuning: size and time per level on a ~770 KiB JSON sample.**

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

These numbers are machine-specific: they were measured on an Intel Core i5-1135G7 (8 logical CPUs) running Linux, and the sizes depend on the sample. Run the script on your own data before you choose. What this run shows:

- **gzip:** level 6 (the default) was 2.8 times slower than level 1 for a 20% smaller result. Level 9 doubled the time again and saved under 2% more.
- **Brotli quality 11, the default when you pass no options, took 1.6 seconds** for under 1 MB. That is fine for files you compress once at build time and wrong for per-request compression. Quality 5 gave the gzip-6 size at the gzip-6 speed.
- **`BROTLI_PARAM_MODE` and `BROTLI_PARAM_SIZE_HINT` made no measurable difference here.** The output was the same size, byte for byte, with and without them (one-shot and also when streamed in 16 KiB chunks, which I checked separately). The docs describe the size hint as "the expected input size; defaults to `0` for an unknown input size". Passing it does no harm, but measure before you expect a gain.
- **zstd level 3 (its default) was the fastest compressor in the table** at a size between gzip 1 and gzip 6. At level 19 it came within 6% of Brotli 11's size in under a third of the time.
- **Decompression is cheap:** gunzip of the level-6 output took 2 ms, whatever level produced it.

## Common mistakes & gotchas

- **Using `*Sync` zlib calls in request handlers.** `gzipSync` on a 20 MiB body blocked the event loop for 72 to 115 ms in Example 2. Use the callback, promisified or stream form on a server.
- **Shipping Brotli's default quality to dynamic responses.** The default is 11 (`BROTLI_DEFAULT_QUALITY`), which took 1.6 s on 770 KiB in Example 6. Set `BROTLI_PARAM_QUALITY` to around 5 for on-the-fly compression, and use 11 only for build-time assets.
- **Forgetting `Vary: Accept-Encoding`.** A shared cache then stores whichever version it saw first and serves gzip bytes to a client that did not ask for them, or plain bytes to everyone.
- **Compressing twice.** A pre-compressed asset or a proxied upstream response already has `Content-Encoding`. Compressing it again leaves gzip inside gzip (Example 4, `/app-twice.js`). Check `Content-Encoding` before you compress.
- **Setting `Content-Length` to the uncompressed size.** The client then waits for bytes that never come, or cuts the body short. Either drop `Content-Length` and let Node use chunked encoding, or compress first and set the real compressed length.
- **Expecting `maxOutputLength` to protect a stream.** It only limits the one-shot convenience methods. A `createGunzip()` stream inflated a full 100 MiB bomb with the option set (Example 5). Count bytes in a Transform after the decompressor.
- **Confusing HTTP `deflate` with raw deflate.** `Content-Encoding: deflate` means the zlib format (`deflate`/`inflate`), not `deflateRaw`. Decoding an HTTP `deflate` body with `inflateRaw` fails, because the 2-byte zlib header is not valid raw deflate data (`Z_DATA_ERROR invalid stored block lengths` in a quick test on v24.19.0).
- **Compressing already-compressed media.** PNG, JPEG, MP4 and ZIP do not shrink further. You pay CPU for a body of the same size or larger.
- **Starting thousands of zlib operations at once.** Each one allocates its own native state. The v24 docs warn that 30,000 concurrent `zlib.deflate` calls "may lead to significant memory fragmentation", and recommend caching compressed results.
- **Relying on zstd as a stable API.** `zstdCompress` and friends are Stability 1 (Experimental) in v24, even though they print no warning. Pin the Node version if you use them.

## Best practices

- **Compress in one place.** Use a reverse proxy, a CDN or one middleware function, not ad hoc calls in each handler. Then the `Vary`, content-type and double-compression rules are applied consistently.
- **Pre-compress static assets at build time** with Brotli 11 and gzip 9, store `app.js.br` and `app.js.gz`, and serve the matching file with `Content-Encoding` and `Vary`. Compress dynamic responses at a low setting (gzip 1 to 6, Brotli around 5).
- **Skip small bodies and compressed media.** Example 4 uses a 1 KiB minimum and a content-type allow-list (`text/*`, JSON, JavaScript, XML).
- **Always cap decompression.** Pass `maxOutputLength` to one-shot calls, put a byte-counting Transform after every decompression stream, and limit the compressed input size too.
- **Use `pipeline()` for every zlib stream**, so an error in any stage destroys all of them and frees the native handles.
- **Measure on your own data.** Ratios and timings depend on the content and the CPU. Example 6 is a template, not a result to copy.

## ⭐ Interview lens

> **Q: “What is the difference between `deflate`, `deflateRaw` and `gzip` in `node:zlib`?”**  
> A: All three carry the same DEFLATE stream. `deflateRaw` is the bare stream. `deflate` adds the zlib wrapper (a 2-byte header and an Adler-32 checksum, 6 bytes in total). `gzip` adds a 10-byte header starting `1f 8b` and an 8-byte trailer with a CRC-32 and the input size. HTTP `Content-Encoding: deflate` means the zlib wrapper. *Trap:* saying gzip is a different algorithm.

> **Q: “How do you add response compression to a raw `http` server correctly?”**  
> A: Parse `Accept-Encoding` with its `q` weights, pick a coding you support, and skip compression for small bodies, already-compressed types and bodies that already have `Content-Encoding`. Send `Vary: Accept-Encoding` on every response whose body can vary. Pipe the body through `createBrotliCompress`/`createGzip` into `res` with `pipeline`, and drop `Content-Length` so Node uses chunked encoding. Use a low Brotli quality, not the default 11.

> **Q: “A client can upload gzip-encoded JSON. What can go wrong?”**  
> A: A zip bomb: 100 KB of gzip can inflate to 100 MiB or more. With one-shot calls, pass `maxOutputLength`, which fails with `ERR_BUFFER_TOO_LARGE`. With streams, `maxOutputLength` is ignored, so put a Transform after `createGunzip()` that counts bytes and errors past the limit, and also cap the compressed bytes you read from `req`. Answer `413`.

> **Q: “Is `zlib.gzip` with a callback faster than `zlib.gzipSync`?”**  
> A: Not by itself. It runs the same C code on a libuv pool thread and was about the same speed or slower in Example 2. Its benefit is that the main thread keeps serving other requests. It also competes with `fs` and `crypto` for the four default pool threads.

> **Q: “Why is Brotli sometimes slower than gzip, when it is supposed to be better?”**  
> A: Its default quality is 11, the slowest setting. In Example 6 it produced the smallest output but took 1.6 s on 770 KiB, against 18 ms for gzip 6. At quality 5 Brotli matched gzip 6 in both size and speed. Use 11 only for assets compressed once at build time.

## Cheat-card

- **Formats:** `deflateRaw` (bare) · `deflate` = zlib wrapper (+6 B, HTTP "deflate") · `gzip` (+18 B, magic `1f 8b`) · `brotliCompress` (`br`, v11.7.0) · `zstdCompress` (`zstd`, v23.8.0/v22.15.0, Experimental).
- **Three shapes:** `xSync(buf)` blocks · `x(buf, cb)` / `promisify(x)` on the pool · `createX()` Transform stream.
- **No `zlib/promises`:** use `util.promisify(zlib.gzip)`.
- **Defaults:** gzip level 6 (`Z_DEFAULT_COMPRESSION` = -1) · Brotli quality 11 (slow) · zstd level 3 · `chunkSize` 16 KiB.
- **HTTP:** parse `Accept-Encoding` with `q` (`q=0` = refuse) · set `Content-Encoding` · always `Vary: Accept-Encoding` · no `Content-Length` when streaming.
- **Never compress:** images, video, archives, tiny bodies, anything with `Content-Encoding` already set.
- **Zip bombs:** `maxOutputLength` (one-shot only, throws `ERR_BUFFER_TOO_LARGE`) · byte-counting Transform for streams · cap compressed input · `413`.
- **Tuning:** dynamic responses gzip 1–6 / Brotli ≈5; build-time Brotli 11 / gzip 9; measure on your data and machine.

---

## Learn More

- [Zlib | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/zlib.html)
- [Stream (pipeline) | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
- [Accept-Encoding developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Accept-Encoding)
- [Content-Encoding developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding)
- [Vary developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary)
- [RFC 9110: HTTP Semantics (Accept-Encoding) rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 1952: GZIP file format rfc-editor.org](https://www.rfc-editor.org/rfc/rfc1952.html)
- [RFC 7932: Brotli rfc-editor.org](https://www.rfc-editor.org/rfc/rfc7932.html)
