---
title: "File Uploads in Express"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# File Uploads in Express

*28 min read · Updated 10 Oct 2026 · Topic 89 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0

---

## Why it matters

A browser sends a file as one part of a `multipart/form-data` request body. Express's built-in parsers (`express.json()`, `express.urlencoded()`) do not read that format, so with Express alone `req.body` stays `undefined` and the file bytes are never read. You need a multipart parser, and every choice you make around it changes what can go wrong:

- **Where the bytes go.** Kept in memory, a 2 GB upload needs 2 GB of RAM. Written to disk, every failed request can leave a file behind.
- **What the file really is.** The filename and the `Content-Type` of the part are text the client chose. A text file named `cat.png` with `type=image/png` passes any check that reads only those two.
- **How big it is allowed to get.** Without limits, one request can send an unbounded number of parts or bytes.
- **Who carries the bytes.** Proxying uploads through your server to S3 keeps a socket and some memory busy per upload. Presigned URLs let the browser send the bytes to S3 directly while your server only signs permission.
- **What happens when the client goes away.** A phone that loses signal halfway leaves a half-written file, or an unfinished S3 multipart upload, unless something removes it.

This lesson builds each piece on Express 5.3.0 and runs it: multer for the common case, magic-byte checks for the real type, busboy streamed into S3 with `@aws-sdk/lib-storage`, presigned PUT and POST URLs, and cleanup on every failure path.

## The concept, simply

A `multipart/form-data` body is a list of **parts** separated by a boundary string that the client picks and announces in the `Content-Type` header (`multipart/form-data; boundary=…`). Each part has its own small header block (`Content-Disposition: form-data; name="avatar"; filename="me.png"` and usually a `Content-Type`), a blank line, then the raw bytes. A text field is a part without a `filename`. Lesson 41 parses this format by hand and then with busboy (see [the busboy appendix in lesson 41](41-parsing-requests-writing-responses.md#the-same-upload-with-busboy)); this lesson does not repeat that.

**busboy** (1.6.0) is the streaming parser: you pipe the request into it, and it emits a `'field'` event per text field and a `'file'` event per file, where each file is its own `Readable` stream.

**multer** (2.4.0, the current `latest` on npm; it depends on `busboy ^1.6.0`) is Express middleware built on busboy. You create it with a **storage engine** and options, then pick one of four middleware factories for a route:

| Factory | Accepts | Result |
|---|---|---|
| `upload.single('avatar')` | at most one file, in field `avatar` | `req.file` |
| `upload.array('photos', 3)` | up to 3 files, all in field `photos` | `req.files` (array) |
| `upload.fields([{ name, maxCount }, …])` | several named file fields | `req.files` (object of arrays) |
| `upload.none()` | text fields only | any file → `LIMIT_UNEXPECTED_FILE` |

Text fields always end up in `req.body` (an object with a `null` prototype). The two built-in storage engines are:

- **`multer.memoryStorage()`**: the file is collected into `file.buffer`. Calling `multer()` with no `storage` uses this one.
- **`multer.diskStorage({ destination, filename })`**: the file is written to `destination/filename` and `file.path` points at it. The default destination is `os.tmpdir()` and the default name is 16 random bytes in hex, with no extension.

For S3, there are two ways to get the bytes there:

text

```
A. Through your server (stream)              B. Direct to S3 (presigned URL)

 browser ──multipart──► Express              browser ──"may I upload?"──► Express
                          │ busboy file stream                             │ signs URL / policy
                          ▼                                                ▼ (no bytes pass here)
                       Upload (lib-storage)   browser ◄──url (+ fields)──── Express
                          │ 5 MiB parts                │
                          ▼                            └──PUT or POST bytes──► S3
                         S3                                                   │ checks signature,
                                                                              │ expiry, policy
                                                                              ▼
                                                                         stored object
```

## How it works

What happens when a request reaches `upload.single('avatar')`:

1. **Is this multipart?** multer checks `Content-Type` with `type-is`. If it is not `multipart/*`, multer calls `next()` at once and does not touch `req.body` (on Express 5 it stays `undefined`).
2. **Start busboy.** multer sets `req.body` to a `null`-prototype object, creates a busboy parser with your `limits`, and runs `req.pipe(busboy)`.
3. **Text fields** are written into `req.body` as they arrive. Bracket names such as `tags[]` become arrays.
4. **Each file part** is checked against the field list of the factory you chose. A field that is not allowed, or one more file than `maxCount`, fails with `LIMIT_UNEXPECTED_FILE`.
5. **`fileFilter(req, file, cb)`** runs next. At this point `file` has `fieldname`, `originalname`, `encoding` and `mimetype`, but no bytes yet. `cb(null, true)` accepts, `cb(null, false)` skips the file silently, `cb(err)` aborts the request with that error.
6. **The storage engine** receives the file stream: memory storage collects it into a `Buffer`, disk storage pipes it into `fs.createWriteStream()`.
7. **Limits** are enforced while bytes flow. When one trips, multer stops reading, **removes every file it already stored for this request**, and calls `next(err)` with a `MulterError`.
8. **When busboy closes and all writes are done**, multer sets `req.file`/`req.files` and calls `next()`. From here on the files are your responsibility, including deleting them.

**Limits and error codes.** `limits` is passed to busboy: `fileSize` (bytes per file), `files`, `fields`, `parts`, `fieldNameSize`, `fieldSize` (default 1 MB) and `headerPairs` (default 2000). multer 2.4.0's README also lists `fieldNestingDepth` and `fieldArrayIndexLimit` for bracket field names. multer passes `fileSize + 1` to busboy, so a file of exactly `fileSize` bytes is accepted (Example 1). Limits apply to the whole request; there is no per-field file size. Each failure is a `MulterError` with a `code`: `LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_FIELD_COUNT`, `LIMIT_PART_COUNT`, `LIMIT_FIELD_KEY`, `LIMIT_FIELD_VALUE`, `LIMIT_UNEXPECTED_FILE`, plus `MISSING_FIELD_NAME`, `LIMIT_FIELD_NESTING`, `LIMIT_FIELD_ARRAY_INDEX`, `INVALID_FIELD_NAME` and `STREAM_DESTROYED` (the list in `lib/multer-error.js`). `err.field` names the field when there is one. Check `err instanceof multer.MulterError` and `err.code` in an error handler; the message text is not an API.

**The real type is in the bytes.** Many formats start with a fixed signature ("magic bytes"): PNG with `89 50 4E 47 0D 0A 1A 0A`, JPEG with `FF D8 FF`, PDF with `25 50 44 46 2D` (`%PDF-`). Reading the first few bytes and comparing them is a check the client cannot fake by renaming a file. It does not prove the rest of the file is valid or harmless; it only tells you which format the file claims to be from the inside. The `file-type` package (22.1.1) does the same for a long list of formats. It is ESM-only (`"type": "module"`, no CommonJS build, `engines.node >= 22`). In an ES module, `import { fileTypeFromBuffer } from 'file-type'`. From CommonJS on Node 24, `require('file-type')` also works because `require()` of a synchronous ES module is unflagged since v22.12.0 / v20.19.0 (and no longer experimental since v24.15.0).

**Streaming to S3.** `Upload` from `@aws-sdk/lib-storage` accepts a stream as `Body`. It reads the stream into parts of `partSize` bytes (default and minimum 5 MiB), and for a body bigger than one part it runs an S3 multipart upload: `CreateMultipartUpload`, then `UploadPart` for each part with up to `queueSize` (default 4) parts in flight, then `CompleteMultipartUpload`. A body that fits in one part is sent with a single `PutObject`. Each of the `queueSize` concurrent uploaders holds one part's buffer at a time (from lib-storage's source), so the file is never read into memory as a whole; the stream waits behind backpressure until a part slot is free. If the upload fails or you call `upload.abort()`, `done()` rejects (`AbortError` for an abort). lib-storage sends `AbortMultipartUpload` (unless `leavePartsOnError: true`) only once its loop that reads the body has stopped, so the body stream must end or be destroyed too (Example 8).

**Presigned URLs.** A presigned URL carries an AWS Signature Version 4 in its query string: an HMAC over the method, bucket, key, expiry and signed headers, computed with your secret key. Anyone holding the URL can make exactly that request until it expires, without credentials. `getSignedUrl(client, new PutObjectCommand({ Bucket, Key }), { expiresIn })` from `@aws-sdk/s3-request-presigner` produces such a URL for a `PUT`. A presigned PUT cannot limit the size of the body. A **presigned POST** (`createPresignedPost` from `@aws-sdk/s3-presigned-post`) instead signs a **policy document**: a base64 JSON list of conditions (`content-length-range`, `starts-with`, exact field values) that S3 checks against the form the browser submits. That is the way to put an upper size limit on a direct upload.

**Cleanup.** multer removes its own files when it fails. It cannot know about checks that run later, in your handler: a wrong magic number, a failed database insert, a thrown error. With disk storage each of those leaves the temp file behind unless your handler deletes it. Delete before you send the error response, so the next request (or a test) never sees the file.

**Client aborts.** When the client closes the connection mid-body, Node emits `'aborted'` (deprecated, still emitted) and then `'close'` with `req.readableEnded === false` on the request. multer listens for these, destroys busboy, deletes the partial file and calls `next(new Error('Request aborted'))`. The error handler runs, but the socket is gone, so there is nobody to answer.

## Code examples

Setup for every example: `npm install express@5.3.0 multer@2.4.0 busboy@1.6.0 file-type@22.1.1`, and for the S3 examples `@aws-sdk/client-s3@3.1149.0 @aws-sdk/lib-storage@3.1149.0 @aws-sdk/s3-request-presigner@3.1149.0 @aws-sdk/s3-presigned-post@3.1149.0`. The sample files are a valid 1×1 `real.png`, a `doc.pdf` that starts with `%PDF-1.4`, and `fake.png`, which is the text `just some text, renamed to .png`.

**Example 1 — memory storage, `limits`, `.single()` and a `MulterError` handler, driven by `curl -F`.**

javascript

```
// ex1.cjs: memory storage, limits, .single(), and a MulterError handler.
const express = require('express');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),          // file.buffer holds the bytes
  limits: { fileSize: 1024, files: 1, fields: 2 },
});

const app = express();

app.post('/avatar', upload.single('avatar'), (req, res) => {
  const f = req.file;                       // undefined if no file was sent
  res.json({
    body: req.body,
    file: f && { fieldname: f.fieldname, originalname: f.originalname,
                 mimetype: f.mimetype, size: f.size, bufferBytes: f.buffer.length },
  });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ code: err.code, field: err.field, message: err.message });
  }
  res.status(500).json({ message: err.message });
});

app.listen(5801, () => console.log('listening on 5801'));

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0):
//   listening on 5801
```

bash

```
$ curl -s -F title=Hi -F avatar=@small.txt localhost:5801/avatar; echo
{"body":{"title":"Hi"},"file":{"fieldname":"avatar","originalname":"small.txt","mimetype":"text/plain","size":5,"bufferBytes":5}}
$ curl -s -F avatar=@1024.bin localhost:5801/avatar; echo
{"body":{},"file":{"fieldname":"avatar","originalname":"1024.bin","mimetype":"application/octet-stream","size":1024,"bufferBytes":1024}}
$ curl -si -F avatar=@1025.bin localhost:5801/avatar | tr -d "\r" | sed -n "1p;\$p"; echo
HTTP/1.1 413 Payload Too Large
{"code":"LIMIT_FILE_SIZE","field":"avatar","message":"File too large"}
$ curl -s -F photo=@small.txt localhost:5801/avatar; echo
{"code":"LIMIT_UNEXPECTED_FILE","field":"photo","message":"Unexpected file field"}
$ curl -s -F avatar=@small.txt -F avatar=@small.txt localhost:5801/avatar; echo
{"code":"LIMIT_FILE_COUNT","message":"Too many files"}
$ curl -s -F a=1 -F b=2 -F c=3 localhost:5801/avatar; echo
{"code":"LIMIT_FIELD_COUNT","message":"Too many fields"}
$ curl -s -H 'content-type: application/json' -d '{"x":1}' localhost:5801/avatar; echo
{}
```

`curl -F name=@file` builds the multipart body and guesses each part's `Content-Type` from the file extension (`text/plain` for `.txt`). The 1024-byte file passes and the 1025-byte one fails, because `fileSize` is the largest size allowed. Two `avatar` files fail with `LIMIT_FILE_COUNT` here only because `files: 1` trips first; without that limit, `.single()` rejects the second one with `LIMIT_UNEXPECTED_FILE`. The JSON request skips multer entirely, so on Express 5 `req.body` is `undefined` and `res.json()` drops both `undefined` keys, leaving `{}`.

**Example 2 — `.array()`, `.fields()` and `.none()`, driven by `fetch` + `FormData`.**

javascript

```
// ex2.cjs: .array(), .fields() and .none(), driven by fetch + FormData.
const express = require('express');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });
const app = express();
const summary = (f) => `${f.fieldname}:${f.originalname}(${f.size}B)`;

app.post('/gallery', upload.array('photos', 3), (req, res) => {
  res.json({ files: req.files.map(summary) });            // req.files is an array
});
app.post('/profile', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'docs', maxCount: 2 },
]), (req, res) => {
  const out = {};                                          // req.files is { field: [files] }
  for (const [k, list] of Object.entries(req.files)) out[k] = list.map(summary);
  res.json({ body: req.body, files: out });
});
app.post('/form', upload.none(), (req, res) => {
  res.json({ body: req.body, proto: Object.getPrototypeOf(req.body) });
});
app.use((err, req, res, next) => {
  res.status(err instanceof multer.MulterError ? 400 : 500)
     .json({ code: err.code, field: err.field });
});

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, entries) => {
    const fd = new FormData();
    for (const [k, v, name] of entries) name ? fd.append(k, new Blob([v]), name) : fd.append(k, v);
    const r = await fetch(base + path, { method: 'POST', body: fd });
    console.log(path, r.status, await r.text());
  };
  await post('/gallery', [['photos', 'aaa', 'a.jpg'], ['photos', 'bb', 'b.jpg']]);
  await post('/gallery', [['photos', '1', '1.jpg'], ['photos', '2', '2.jpg'],
                          ['photos', '3', '3.jpg'], ['photos', '4', '4.jpg']]);
  await post('/profile', [['name', 'Ada'], ['avatar', 'img', 'me.png'],
                          ['docs', 'cv', 'cv.pdf'], ['docs', 'x', 'x.pdf']]);
  await post('/form', [['name', 'Ada'], ['tags[]', 'a'], ['tags[]', 'b']]);
  await post('/form', [['name', 'Ada'], ['file', 'oops', 'oops.txt']]);
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0):
//   /gallery 200 {"files":["photos:a.jpg(3B)","photos:b.jpg(2B)"]}
//   /gallery 400 {"code":"LIMIT_UNEXPECTED_FILE","field":"photos"}
//   /profile 200 {"body":{"name":"Ada"},"files":{"avatar":["avatar:me.png(3B)"],"docs":["docs:cv.pdf(2B)","docs:x.pdf(1B)"]}}
//   /form 200 {"body":{"name":"Ada","tags":["a","b"]},"proto":null}
//   /form 400 {"code":"LIMIT_UNEXPECTED_FILE","field":"file"}
```

The fourth photo goes over `maxCount: 3` and fails the whole request, not just that file. `.none()` accepts text fields (and turns `tags[]` into an array) but treats any file as unexpected. `req.body` has a `null` prototype, so `req.body.hasOwnProperty(…)` would throw; use `Object.hasOwn(req.body, …)`.

**Example 3 — disk storage, a generated filename, and `fileFilter`.**

javascript

```
// ex3.cjs: disk storage with a destination, a safe filename, and fileFilter.
const express = require('express');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const dir = path.join(__dirname, 'uploads');
fs.rmSync(dir, { recursive: true, force: true });

const storage = multer.diskStorage({
  destination: dir,                         // a string: multer creates it (mkdir -p)
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + '.upload'), // never originalname
});
const upload = multer({
  storage,
  limits: { fileSize: 1_000_000 },
  fileFilter: (req, file, cb) => {
    // file.mimetype is whatever the client wrote in the part header.
    if (file.mimetype === 'application/x-msdownload') return cb(new Error('executables not allowed'));
    cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype));   // false = skip silently
  },
});

const app = express();
app.post('/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no acceptable file' });
  const { originalname, mimetype, destination, filename, size } = req.file;
  res.json({ originalname, mimetype, destination: path.relative(__dirname, destination),
             filenameIsUuid: /^[0-9a-f-]{36}\.upload$/.test(filename), size });
});
app.use((err, req, res, next) => res.status(err instanceof multer.MulterError ? 400 : 422)
                                    .json({ error: err.message }));

const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/photo`;
  for (const [name, type] of [['cat.png', 'image/png'], ['notes.txt', 'text/plain'],
                              ['setup.exe', 'application/x-msdownload']]) {
    const fd = new FormData();
    fd.append('photo', new Blob(['not really an image'], { type }), name);
    const r = await fetch(url, { method: 'POST', body: fd });
    console.log(name, r.status, await r.text());
  }
  console.log('files on disk:', fs.readdirSync(dir).length);
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0):
//   cat.png 200 {"originalname":"cat.png","mimetype":"image/png","destination":"uploads","filenameIsUuid":true,"size":19}
//   notes.txt 400 {"error":"no acceptable file"}
//   setup.exe 422 {"error":"executables not allowed"}
//   files on disk: 1
```

`cb(null, false)` skipped `notes.txt` without an error, so the handler saw no `req.file`; `cb(err)` turned `setup.exe` into an error. But `cat.png` was accepted, and it is 19 bytes of text: the filter only saw the `type` the client put on the Blob. The next example fixes that.

**Example 4 — check the real type by its magic bytes, and reject a `.png`-named text file.**

javascript

```
// ex4.mjs: check the real type from the first bytes, not the name or the client's mimetype.
import express from 'express';
import multer from 'multer';
import { fileTypeFromBuffer } from 'file-type';    // file-type 22.x is ESM-only

const SIGNATURES = [
  { mime: 'image/png',       ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg',      ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },   // "%PDF-"
];
function sniff(buf) {
  return SIGNATURES.find((s) => s.bytes.every((b, i) => buf[i] === b)) ?? null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5_000_000 } });
const app = express();

app.post('/doc', upload.single('doc'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'doc is required' });
  const { originalname, mimetype, buffer } = req.file;
  const ours = sniff(buffer);
  const theirs = await fileTypeFromBuffer(buffer);       // undefined when nothing matches
  const result = { originalname, claimed: mimetype, firstBytes: buffer.subarray(0, 8).toString('hex'),
                   sniffed: ours?.mime ?? null, fileType: theirs ?? null };
  if (!ours) return res.status(415).json({ error: 'unsupported file type', ...result });
  res.json(result);
});

app.listen(5804, () => console.log('listening on 5804'));

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0, file-type 22.1.1):
//   listening on 5804
```

bash

```
$ curl -s -F 'doc=@real.png' localhost:5804/doc; echo
{"originalname":"real.png","claimed":"image/png","firstBytes":"89504e470d0a1a0a","sniffed":"image/png","fileType":{"ext":"png","mime":"image/png"}}
$ curl -s -F 'doc=@doc.pdf' localhost:5804/doc; echo
{"originalname":"doc.pdf","claimed":"application/pdf","firstBytes":"255044462d312e34","sniffed":"application/pdf","fileType":{"ext":"pdf","mime":"application/pdf"}}
$ curl -s -w ' -> %{http_code}\n' -F 'doc=@fake.png;type=image/png' localhost:5804/doc
{"error":"unsupported file type","originalname":"fake.png","claimed":"image/png","firstBytes":"6a75737420736f6d","sniffed":null,"fileType":null} -> 415
```

`fake.png` was sent with the claimed type `image/png`, and multer reported exactly that in `claimed`. Its first bytes are `6a 75 73 74` (`just`), so both the hand-written signature check and `file-type` return nothing, and the route answers `415 Unsupported Media Type`. With memory storage the check costs nothing extra because the bytes are already in `file.buffer`. With disk storage, read the first bytes from `file.path` (Example 5).

`file-type` is ESM-only, but on Node 24 CommonJS can still load it:

bash

```
$ node -e "const ft = require('file-type'); ft.fileTypeFromFile('real.png').then(console.log)"
{ ext: 'png', mime: 'image/png' }
```

**Example 5 — edge case: a check after multer leaks the temp file.**

multer cleans up after its own errors (Example 6). It cannot clean up after yours. Here the magic-byte check runs in the route, after disk storage has already written the file:

javascript

```
// ex5.cjs: a check that runs AFTER multer leaves the temp file behind unless you delete it.
const express = require('express');
const multer = require('multer');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const tmp = path.join(__dirname, 'tmp-uploads');
const kept = path.join(__dirname, 'kept');
for (const d of [tmp, kept]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d); }
const upload = multer({ storage: multer.diskStorage({ destination: tmp }) });

async function isPng(file) {                       // read only the first 8 bytes from disk
  const fh = await fsp.open(file.path);
  try {
    const { buffer } = await fh.read(Buffer.alloc(8), 0, 8, 0);
    return buffer.equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  } finally { await fh.close(); }
}

const app = express();

// Leaky: multer has already finished, so its own cleanup no longer applies.
app.post('/leaky', upload.single('img'), async (req, res) => {
  if (!(await isPng(req.file))) return res.status(415).json({ error: 'not a PNG' });
  await fsp.rename(req.file.path, path.join(kept, req.file.filename + '.png'));
  res.json({ ok: true });
});

// Fixed: any failure after multer deletes the temp file BEFORE the error response goes out.
const httpError = (status, message) => Object.assign(new Error(message), { status });
app.post('/fixed', upload.single('img'), async (req, res) => {
  try {
    if (!(await isPng(req.file))) throw httpError(415, 'not a PNG');
    if (req.body.title === 'boom') throw new Error('database insert failed');  // simulated later failure
    await fsp.rename(req.file.path, path.join(kept, req.file.filename + '.png'));
    res.json({ ok: true });
  } catch (err) {
    await fsp.rm(req.file.path, { force: true });   // force: no error if it is already gone
    throw err;                                      // Express 5 passes it to the error handler
  }
});
app.use((err, req, res, next) => res.status(err.status ?? 500).json({ error: err.message }));

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = async (route, name, title = 'x') => {
    const fd = new FormData();
    fd.append('title', title);
    fd.append('img', new Blob([fs.readFileSync(path.join(__dirname, name))]), name);
    const r = await fetch(base + route, { method: 'POST', body: fd });
    console.log(`${route} ${name} title=${title} -> ${r.status} ${await r.text()}`,
                `| tmp: ${fs.readdirSync(tmp).length} kept: ${fs.readdirSync(kept).length}`);
  };
  await send('/leaky', 'fake.png');
  await send('/leaky', 'fake.png');
  await send('/leaky', 'real.png');
  for (const d of [tmp, kept]) { fs.rmSync(d, { recursive: true }); fs.mkdirSync(d); }
  console.log('--- reset ---');
  await send('/fixed', 'fake.png');
  await send('/fixed', 'real.png', 'boom');
  await send('/fixed', 'real.png');
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0):
//   /leaky fake.png title=x -> 415 {"error":"not a PNG"} | tmp: 1 kept: 0
//   /leaky fake.png title=x -> 415 {"error":"not a PNG"} | tmp: 2 kept: 0
//   /leaky real.png title=x -> 200 {"ok":true} | tmp: 2 kept: 1
//   --- reset ---
//   /fixed fake.png title=x -> 415 {"error":"not a PNG"} | tmp: 0 kept: 0
//   /fixed real.png title=boom -> 500 {"error":"database insert failed"} | tmp: 0 kept: 0
//   /fixed real.png title=x -> 200 {"ok":true} | tmp: 0 kept: 1
```

Each rejected request on `/leaky` adds one orphan to `tmp-uploads`: two after two bad uploads, and they stay there. `/fixed` routes every failure, the `415` and the thrown "database" error alike, through one `catch` that deletes the file and then rethrows. Express 5 sends the rethrown rejection to the error handler (on Express 4 an async handler must catch and call `next(err)` itself, see lesson 50). The delete is awaited before the response is sent. An earlier version of this example deleted in a `finally` block, which runs after `res.json()` has already sent the `415`, and the client then saw `tmp: 1` because it read the directory before the delete finished.

**Example 6 — the client aborts mid-upload, and a file over `fileSize`.**

javascript

```
// ex6.cjs: the client dies halfway through the upload, and a file that is too big.
const express = require('express');
const multer = require('multer');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const tmp = path.join(__dirname, 'tmp-abort');
fs.rmSync(tmp, { recursive: true, force: true });
const upload = multer({ storage: multer.diskStorage({ destination: tmp }),
                        limits: { fileSize: 64 * 1024 } });
const app = express();

app.post('/up', (req, res, next) => {
  req.on('aborted', () => {                         // deprecated event, still emitted
    const sizes = fs.readdirSync(tmp).map((f) => fs.statSync(path.join(tmp, f)).size);
    console.log("  server: req 'aborted'; partial file sizes in tmp right now:", sizes);
  });
  req.on('close', () => console.log("  server: req 'close', readableEnded =", req.readableEnded));
  next();
}, upload.single('file'), (req, res) => res.json({ size: req.file.size }));

app.use((err, req, res, next) => {
  console.log(`  error handler: ${err.name}: ${err.message}` + (err.code ? ` (${err.code})` : ''),
              `| headersSent=${res.headersSent} socket destroyed=${req.socket.destroyed}`);
  setTimeout(() => console.log('  files left in tmp:', fs.readdirSync(tmp)), 50);
  if (!req.socket.destroyed) res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ code: err.code });
});

const server = app.listen(0, async () => {
  const { port } = server.address();
  const boundary = 'XyZ';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\n` +
               `Content-Type: application/octet-stream\r\n\r\n`;

  console.log('1) client sends 20 KiB of a declared 1 MiB upload, then destroys the socket');
  await new Promise((resolve) => {
    const req = http.request({ port, method: 'POST', path: '/up', headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': 1024 * 1024 } });
    req.on('error', (e) => { console.log('  client:', e.code); });
    req.write(head);
    req.write(Buffer.alloc(20 * 1024, 0x61));
    setTimeout(() => { req.destroy(); setTimeout(resolve, 200); }, 100);
  });

  console.log('2) client sends a complete 200 KiB file (limit is 64 KiB)');
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(200 * 1024)]), 'big.bin');
  const r = await fetch(`http://127.0.0.1:${port}/up`, { method: 'POST', body: fd });
  console.log('  client:', r.status, await r.text());
  setTimeout(() => server.close(), 200);
});

// Real output (Node v24.19.0, Express 5.3.0, multer 2.4.0):
//   1) client sends 20 KiB of a declared 1 MiB upload, then destroys the socket
//     server: req 'aborted'; partial file sizes in tmp right now: [ 20480 ]
//     server: req 'close', readableEnded = false
//     client: ECONNRESET
//     error handler: Error: Request aborted | headersSent=false socket destroyed=true
//     files left in tmp: []
//   2) client sends a complete 200 KiB file (limit is 64 KiB)
//     server: req 'close', readableEnded = true
//     error handler: MulterError: File too large (LIMIT_FILE_SIZE) | headersSent=false socket destroyed=false
//     client: 413 {"code":"LIMIT_FILE_SIZE"}
//     files left in tmp: []
```

1. The client declared `Content-Length: 1048576`, sent 20 KiB, and destroyed the socket.
2. Disk storage had already written those 20 480 bytes (`[ 20480 ]` at the moment of `'aborted'`).
3. Node emitted `'aborted'` and then `'close'` with `readableEnded = false` on the request.
4. multer handled that as a failure: it destroyed busboy, removed the partial file, and called `next(new Error('Request aborted'))`. It is a plain `Error`, not a `MulterError`, so an error handler that only checks `instanceof MulterError` falls through to its generic branch.
5. The error handler ran, but `req.socket.destroyed` was `true`, so there was no one to answer and it sent nothing.

In the second run the whole 200 KiB body arrived. busboy stopped writing at 64 KiB, multer removed the file it had started and answered through the error handler with `LIMIT_FILE_SIZE`. In both runs `tmp-abort` ends empty.

**Example 7 — busboy directly in an Express route.** busboy's events, limits and `truncated` flag are covered in [lesson 41's busboy appendix](41-parsing-requests-writing-responses.md#the-same-upload-with-busboy). Inside Express it is the same code; this route hashes each file as it streams past and never stores it.

javascript

```
// ex9.cjs: busboy inside an Express route, hashing the file as it streams past.
const express = require('express');
const busboy = require('busboy');
const crypto = require('node:crypto');

const app = express();
app.post('/hash', (req, res) => {
  const bb = busboy({ headers: req.headers });       // throws on a non-multipart request
  const out = {};
  bb.on('file', (name, stream, { filename }) => {
    const h = crypto.createHash('sha256');
    stream.on('data', (chunk) => h.update(chunk));   // consuming the stream is mandatory
    stream.on('end', () => { out[name] = { filename, sha256: h.digest('hex') }; });
  });
  bb.on('close', () => res.json(out));
  req.pipe(bb);
});
app.use((err, req, res, next) => res.status(400).json({ error: err.message }));

const server = app.listen(0, async () => {
  const url = `http://127.0.0.1:${server.address().port}/hash`;
  const fd = new FormData();
  fd.append('doc', new Blob(['hello\n']), 'hello.txt');
  let r = await fetch(url, { method: 'POST', body: fd });
  console.log(r.status, await r.text());
  r = await fetch(url, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  console.log(r.status, await r.text());
  server.close();
});

// Real output (Node v24.19.0, Express 5.3.0, busboy 1.6.0):
//   200 {"doc":{"filename":"hello.txt","sha256":"5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03"}}
//   400 {"error":"Unsupported content type: application/json"}
```

The digest matches `printf 'hello\n' | sha256sum`. `busboy()` throws synchronously for a non-multipart body; Express catches a synchronous throw in a handler and passes it to the error handler, which turns it into a `400`.

**The local S3 server for Examples 8–10.** No AWS account or real credentials are used anywhere in this lesson. MinIO was the first choice, but its download URL `https://dl.min.io/server/minio/release/linux-amd64/minio` now answers `410` with the text "The open-source MinIO Server, MinIO Client (mc) and MinIO KES projects are archived and no longer maintained". The examples run instead against **SeaweedFS 4.48** (`linux_amd64.tar.gz` from its GitHub release, MD5 checked against the published `.md5`), an open-source storage server with an S3-compatible gateway. `weed server` starts the master, volume, filer and S3 gateway in one process; the S3 identity file holds a throwaway key pair:

json

```
{
  "identities": [
    {
      "name": "dev",
      "credentials": [{ "accessKey": "devkey", "secretKey": "devsecret-devsecret" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
```

bash

```
# start-weed.sh: one SeaweedFS process (master, volume, filer, S3 gateway), every port in 5820-5834.
D=~/.cache/nodekit-repair-tools/pass4/S/seaweedfs
cd $D && ./weed server -ip=127.0.0.1 -ip.bind=127.0.0.1 -dir=$D/data -master.telemetry=false \
  -master.port=5820 -master.port.grpc=5821 -volume.port=5822 -volume.port.grpc=5823 \
  -filer -filer.port=5824 -filer.port.grpc=5825 \
  -s3 -s3.port=5833 -s3.port.grpc=5834 -s3.port.iceberg=0 -s3.port.lance=0 -s3.config=$D/s3.json \
  -volume.max=5 -master.volumeSizeLimitMB=64 > $D/weed.log 2>&1 &
echo $! > $D/weed.pid
```

`mkbucket.cjs` creates the bucket with the throwaway keys, and shows that a wrong secret and an unsigned request are both refused, so the signatures in the next examples are really checked:

javascript

```
// mkbucket.cjs: create the 'uploads' bucket on the local S3 server (throwaway keys).
const { S3Client, CreateBucketCommand, ListBucketsCommand } = require('@aws-sdk/client-s3');
const mk = (secret) => new S3Client({ endpoint: 'http://127.0.0.1:5833', region: 'us-east-1',
  forcePathStyle: true, credentials: { accessKeyId: 'devkey', secretAccessKey: secret } });
(async () => {
  await mk('devsecret-devsecret').send(new CreateBucketCommand({ Bucket: 'uploads' }));
  const { Buckets } = await mk('devsecret-devsecret').send(new ListBucketsCommand({}));
  console.log('buckets:', Buckets.map((b) => b.Name));
  try { await mk('wrong-secret').send(new ListBucketsCommand({})); }
  catch (err) { console.log('wrong secret ->', err.name, err.$metadata.httpStatusCode); }
})();
```

bash

```
$ ./weed version 2>/dev/null
version 30GB 4.48 530be3e37337488ecc34d58441e0bc476e121c93 linux amd64
$ bash start-weed.sh
$ node mkbucket.cjs
buckets: [ 'uploads' ]
wrong secret -> SignatureDoesNotMatch 403
$ curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data x http://127.0.0.1:5833/uploads/anon.txt
403
```

Every S3 example creates its client with `endpoint` pointing at that server and `forcePathStyle: true`, so requests go to `http://127.0.0.1:5833/uploads/<key>` instead of `http://uploads.127.0.0.1:5833/<key>` (a virtual-hosted name that would need DNS for every bucket). On real S3 you drop `endpoint` and `forcePathStyle` and let the SDK load credentials from its default provider chain.

**Example 8 — stream an upload through Express into S3 with busboy and `Upload`, with nothing written to disk.**

javascript

```
// ex7.cjs: stream a multipart file straight from busboy into S3 with lib-storage's Upload.
const express = require('express');
const busboy = require('busboy');
const crypto = require('node:crypto');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:5833',   // local S3-compatible server
  region: 'us-east-1',
  forcePathStyle: true,                     // http://host/bucket/key, not http://bucket.host/key
  credentials: { accessKeyId: process.env.S3_KEY ?? 'devkey',
                 secretAccessKey: process.env.S3_SECRET ?? 'devsecret-devsecret' },
});
const Bucket = 'uploads';

const app = express();
app.post('/files', (req, res, next) => {
  let bb;
  try { bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: 20 * 1024 * 1024 } }); }
  catch (err) { return res.status(400).json({ error: err.message }); }

  let upload, done, fileStream, Key;
  bb.on('file', (name, stream, info) => {
    fileStream = stream;
    Key = `incoming/${crypto.randomUUID()}`;
    upload = new Upload({
      client: s3,
      params: { Bucket, Key, Body: stream, ContentType: 'application/octet-stream' },
      partSize: 5 * 1024 * 1024,            // 5 MiB: the S3 minimum size for every part but the last
      queueSize: 2,                         // at most 2 parts in flight at once
    });
    upload.on('httpUploadProgress', (p) => console.log(`  part ${p.part}: loaded=${p.loaded}`));
    stream.on('limit', () => upload.abort());   // too big: stop, and abort the S3 multipart upload
    done = upload.done();
    done.catch((e) => console.log(`  upload.done() rejected: ${e.name}: ${e.message}`));
  });
  req.on('close', () => {                   // client went away before the body ended
    if (req.readableEnded || !upload) return;
    console.log('  client aborted -> destroy the file stream, then upload.abort()');
    fileStream.destroy(new Error('client aborted'));   // ends lib-storage's read loop
    upload.abort();                                     // done() rejects with AbortError
  });
  bb.on('close', async () => {
    if (!done) return res.status(400).json({ error: 'no file' });
    try {
      await done;
      const head = await s3.send(new HeadObjectCommand({ Bucket, Key }));
      res.status(201).json({ key: 'incoming/<uuid>', storedBytes: head.ContentLength });
    } catch (err) {
      if (fileStream.truncated) return res.status(413).json({ error: 'file too large' });
      next(err);
    }
  });
  req.pipe(bb);
});
app.use((err, req, res, next) => res.status(502).json({ error: err.name, message: err.message }));

app.listen(5807, () => console.log('listening on 5807'));

// Real output (Node v24.19.0, Express 5.3.0, busboy 1.6.0, @aws-sdk/lib-storage 3.1149.0, SeaweedFS 4.48; server log for the three requests below, the order of parts 1-3 changes between runs):
//   listening on 5807
//     part 2: loaded=5242880
//     part 3: loaded=7340032
//     part 1: loaded=12582912
//     part 1: loaded=5242880
//     part 2: loaded=10485760
//     upload.done() rejected: AbortError: Upload aborted.
//     part 1: loaded=5242880
//     client aborted -> destroy the file stream, then upload.abort()
//     upload.done() rejected: AbortError: Upload aborted.
```

The helper scripts used in the transcript (`abort-client.cjs` declares a 30 MiB body, sends 8 MiB and drops the socket; `s3-state.cjs` lists objects and open multipart uploads):

javascript

```
// abort-client.cjs: send 8 MiB of a declared 30 MiB multipart upload, then drop the connection.
const http = require('node:http');
const head = '--B\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\n\r\n';
const req = http.request({ port: 5807, method: 'POST', path: '/files', headers: {
  'content-type': 'multipart/form-data; boundary=B', 'content-length': 30 * 1024 * 1024 } });
req.on('error', (e) => console.log('client:', e.code));
req.write(head);
req.write(Buffer.alloc(8 * 1024 * 1024, 1), () => setTimeout(() => req.destroy(), 500));
```

javascript

```
// s3-state.cjs: what is in the bucket, and are any multipart uploads still open?
const { S3Client, ListObjectsV2Command, ListMultipartUploadsCommand } = require('@aws-sdk/client-s3');
const s3 = new S3Client({ endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:5833', region: 'us-east-1',
  forcePathStyle: true, credentials: { accessKeyId: process.env.S3_KEY ?? 'devkey',
  secretAccessKey: process.env.S3_SECRET ?? 'devsecret-devsecret' } });
(async () => {
  const objs = await s3.send(new ListObjectsV2Command({ Bucket: 'uploads' }));
  const mpu = await s3.send(new ListMultipartUploadsCommand({ Bucket: 'uploads' }));
  console.log('objects:', (objs.Contents ?? []).map((o) => `${o.Key.split('/')[0]}/… ${o.Size}`));
  console.log('open multipart uploads:', (mpu.Uploads ?? []).length);
})();
```

bash

```
$ curl -s -w ' -> %{http_code}\n' -F file=@12mib.bin localhost:5807/files
{"key":"incoming/<uuid>","storedBytes":12582912} -> 201
$ curl -s -w ' -> %{http_code}\n' -F file=@25mib.bin localhost:5807/files   # over the 20 MiB fileSize
{"error":"file too large"} -> 413
$ node abort-client.cjs          # 8 MiB of a declared 30 MiB, then the socket closes
client: ECONNRESET
$ node s3-state.cjs
objects: [ 'incoming/… 12582912' ]
open multipart uploads: 0
```

What the log shows:

1. **12 MiB file.** lib-storage cut it into parts of 5, 5 and 2 MiB and ran a multipart upload. Two parts were in flight at once (`queueSize: 2`), so they finished out of order: `loaded` is the running total when each part finished, and the order changes from run to run. `HeadObject` then reported all 12 582 912 bytes.
2. **25 MiB file.** At 20 MiB busboy fired `'limit'` on the file stream; the handler called `upload.abort()`, `done()` rejected with `AbortError`, and `fileStream.truncated` turned that into a `413`. lib-storage sent `AbortMultipartUpload` for the parts already stored.
3. **Client abort.** `req` closed with `readableEnded === false`. The handler destroyed the busboy file stream and called `upload.abort()`; `s3-state.cjs` then found one object (the 12 MiB file) and `open multipart uploads: 0`.

The `fileStream.destroy()` line is the part that is easy to miss. In an earlier run of this same server without it, the abort case ended with `open multipart uploads: 1`. The reason is in lib-storage's source: `done()` races the upload against the abort signal, so it rejects at once, but `AbortMultipartUpload` is only sent after the part-reading loop finishes. That loop was waiting on a busboy stream whose request was gone, so it never ended, and the started multipart upload stayed open on the server (S3 keeps the parts of an unfinished multipart upload until it is aborted or a lifecycle rule removes it).

**Example 9 — a presigned PUT URL, used with `curl -T`.** The Express app only signs; the bytes go from the client to S3.

javascript

```
// ex8.cjs: Express hands out presigned URLs; the browser uploads straight to S3.
const express = require('express');
const crypto = require('node:crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');

const config = {
  endpoint: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:5833',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_KEY ?? 'devkey',
                 secretAccessKey: process.env.S3_SECRET ?? 'devsecret-devsecret' },
};
// Without this option the SDK (3.729.0+) signs a CRC32 of the EMPTY body into a presigned PUT URL.
const s3 = new S3Client({ ...config, requestChecksumCalculation: 'WHEN_REQUIRED' });
const s3Default = new S3Client(config);               // kept only to show the failure
const Bucket = 'uploads';
const app = express();

// PUT: one URL for one key. The signature covers method, bucket, key and expiry.
app.post('/uploads/put-url', async (req, res) => {
  const client = req.query.client === 'default' ? s3Default : s3;
  const Key = `direct/${crypto.randomUUID()}`;
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket, Key }), { expiresIn: 300 });
  res.json({ key: Key, url });
});

// POST: a signed policy document. S3 checks every condition, including the size range.
app.post('/uploads/post-form', async (req, res) => {
  const { url, fields } = await createPresignedPost(s3, {
    Bucket,
    Key: `direct/${crypto.randomUUID()}`,
    Conditions: [
      ['content-length-range', 1, 1024 * 1024],     // 1 byte .. 1 MiB
      ['starts-with', '$Content-Type', 'image/'],
    ],
    Fields: { 'Content-Type': 'image/png' },
    Expires: 300,                                     // seconds
  });
  res.json({ url, fields });
});

app.listen(5808, () => console.log('listening on 5808'));

// Real output (Node v24.19.0, Express 5.3.0, @aws-sdk/client-s3 3.1149.0, @aws-sdk/s3-request-presigner 3.1149.0, @aws-sdk/s3-presigned-post 3.1149.0):
//   listening on 5808
```

bash

```
$ url=$(curl -s -X POST "localhost:5808/uploads/put-url?client=default" | jq -r .url)
$ echo "$url" | tr "&?" "\n\n" | grep -i checksum
x-amz-checksum-crc32=AAAAAA%3D%3D
x-amz-sdk-checksum-algorithm=CRC32
$ curl -s -i -T real.png "$url" | grep -aoE "^HTTP/1.1 [0-9]+|<Code>[^<]+"
HTTP/1.1 400
<Code>BadDigest
$ url=$(curl -s -X POST "localhost:5808/uploads/put-url" | jq -r .url)
$ echo "$url" | tr "&?" "\n\n" | grep -ic checksum
0
$ curl -s -i -T real.png "$url" | grep -aoE "^HTTP/1.1 [0-9]+|<Code>[^<]+"
HTTP/1.1 200
$ curl -s -i -T real.png "${url/direct\//direct/other-}" | grep -aoE "^HTTP/1.1 [0-9]+|<Code>[^<]+"
HTTP/1.1 403
<Code>SignatureDoesNotMatch
$ curl -s -i -X DELETE "$url" | grep -aoE "^HTTP/1.1 [0-9]+|<Code>[^<]+"
HTTP/1.1 403
<Code>SignatureDoesNotMatch
$ node s3-state.cjs
objects: [ 'direct/… 67' ]
open multipart uploads: 0
```

- **The default client's URL failed with `BadDigest`.** Since SDK v3.729.0 the S3 client computes request checksums by default (`requestChecksumCalculation: 'WHEN_SUPPORTED'`). For a presigned `PutObjectCommand` with no `Body`, it signed the CRC32 of an empty body (`AAAAAA==`) into the query string, so the server compared that against the real file and refused it. Creating the client with `requestChecksumCalculation: 'WHEN_REQUIRED'` leaves the checksum out, and the same upload got `200`.
- **The signature binds the request.** Changing the key or the method on the same URL got `403 SignatureDoesNotMatch`.
- **Nothing limits the size.** The URL said nothing about `Content-Length`; any body up to S3's single-PUT maximum would have been accepted until the URL expired.

**Example 10 — a presigned POST with `content-length-range`, and an oversize upload rejected by S3.** A browser builds a `<form>` or a `FormData` from `url` and `fields`; `post-upload.sh` does the same with curl and jq 1.8.1:

bash

```
# post-upload.sh FILE: get a presigned POST form from Express, then send FILE straight to S3.
# CT=... replaces the signed Content-Type field, to show a policy violation.
form=$(curl -s -X POST localhost:5808/uploads/post-form)
[ -n "$CT" ] && form=$(jq --arg ct "$CT" '.fields["Content-Type"] = $ct' <<< "$form")
url=$(jq -r .url <<< "$form")
args=()
while IFS= read -r kv; do args+=(-F "$kv"); done < <(jq -r '.fields | to_entries[] | "\(.key)=\(.value)"' <<< "$form")
# all policy fields first, the file part last
curl -s -i "${args[@]}" -F "file=@$1" "$url" | grep -aoE '^HTTP/1.1 [0-9]+|<Code>[^<]+|<Message>[^<]+'
```

bash

```
$ curl -s -X POST localhost:5808/uploads/post-form | jq -c "{url, fieldNames: (.fields | keys)}"
{"url":"http://127.0.0.1:5833/uploads","fieldNames":["Content-Type","Policy","X-Amz-Algorithm","X-Amz-Credential","X-Amz-Date","X-Amz-Signature","bucket","key"]}
$ curl -s -X POST localhost:5808/uploads/post-form | jq -r .fields.Policy | base64 -d | jq -c .conditions[:3]
[["content-length-range",1,1048576],["starts-with","$Content-Type","image/"],{"Content-Type":"image/png"}]
$ bash post-upload.sh real.png            # 67 bytes
HTTP/1.1 204
$ bash post-upload.sh 2mb.png             # 2,000,000 bytes, over the 1 MiB maximum
HTTP/1.1 100
HTTP/1.1 400
<Code>EntityTooLarge
<Message>Your proposed upload exceeds the maximum allowed object size.
$ CT=text/plain bash post-upload.sh real.png   # Content-Type no longer starts with image/
HTTP/1.1 403
<Code>AccessDenied
<Message>Invalid according to Policy: Policy Condition failed
$ node s3-state.cjs
objects: [ 'direct/… 67' ]
open multipart uploads: 0
```

The policy is a base64 JSON document whose `conditions` S3 checks against the submitted form, and `X-Amz-Signature` is an HMAC over that base64 text, so the client cannot edit the conditions. The 67-byte PNG got `204 No Content`. The 2 000 000-byte file broke `content-length-range` (max 1 048 576) and got `400 EntityTooLarge`; the `HTTP/1.1 100` line before it is curl's `Expect: 100-continue` handshake, which curl uses for large bodies. Changing the `Content-Type` field to `text/plain` no longer matched the policy (it fails the exact `{"Content-Type":"image/png"}` condition as well as `starts-with`) and got `403 AccessDenied`. Only the accepted upload is in the bucket. S3 does not look inside the file: `2mb.png` is all zero bytes, and it was rejected for its size, not its content. Check the stored object's first bytes before you use it, as in Example 4.

The two direct-upload flows, step by step:

text

```
Presigned PUT                                   Presigned POST
1. browser → Express  POST /uploads/put-url      1. browser → Express  POST /uploads/post-form
2. Express: getSignedUrl(PutObjectCommand)       2. Express: createPresignedPost(conditions)
   (HMAC with the secret key, no network call)      (base64 policy + HMAC, no network call)
3. Express → browser  { key, url }               3. Express → browser  { url, fields }
4. browser → S3  PUT url, body = file            4. browser → S3  POST url, multipart:
                                                    policy fields, then the file
5. S3 checks signature + expiry → 200            5. S3 checks signature, expiry and every
   (any body size)                                  condition → 204, or 400 / 403
6. browser → Express  "done, key=…"              6. browser → Express  "done, key=…"
7. Express: HeadObject / read first bytes        7. Express: HeadObject / read first bytes
```

## Common mistakes & gotchas

- **Trusting `file.mimetype` or the extension.** Both come from the client. Example 3 accepted 19 bytes of text as `image/png`; Example 4 caught it by reading the first bytes.
- **Using `originalname` as a path.** It is attacker input and can contain `../`. Generate the stored name (a UUID) and keep `originalname` only as display text.
- **No `limits`.** Every limit defaults to `Infinity` except `fieldSize` and `headerPairs`. With memory storage and no `fileSize`, one request can fill the heap.
- **Error handler that only knows `MulterError`.** A client abort arrives as a plain `Error('Request aborted')` and a `fileFilter` error as whatever you passed to `cb(err)` (Examples 3 and 6). Handle the generic case too.
- **Forgetting the temp file after your own checks fail.** multer only removes files on its own errors. Example 5 leaked one file per rejected request until the handler deleted it.
- **Deleting after responding.** A delete in a `finally` that runs after `res.json()` races the client; in one run the client read the directory first and saw the file. Await the delete, then respond.
- **Two files for `.single()`.** The second file fails the whole request (`LIMIT_UNEXPECTED_FILE`, or `LIMIT_FILE_COUNT` if `files: 1` trips first); it is not silently dropped.
- **`req.body.hasOwnProperty`.** multer's `req.body` has a `null` prototype, so that call throws. Use `Object.hasOwn()`.
- **A presigned PUT has no size limit.** Anyone with the URL can upload any size until it expires. Use a presigned POST with `content-length-range` when size matters (Example 10).
- **A presigned PUT URL that carries an empty-body checksum.** With SDK 3.1149.0's default `requestChecksumCalculation: 'WHEN_SUPPORTED'`, the URL contained `x-amz-checksum-crc32=AAAAAA%3D%3D` and the real upload failed with `400 BadDigest` (Example 9). Create the presigning client with `requestChecksumCalculation: 'WHEN_REQUIRED'`.
- **`upload.abort()` alone after a client disconnect.** `done()` rejects, but in Example 8 the multipart upload stayed open until the busboy file stream was destroyed as well.
- **A `partSize` under 5 MiB.** The `Upload` constructor throws `EntityTooSmall: Your proposed upload part size [1048576] is smaller than the minimum allowed size [5242880] (5MB)` (checked with `partSize: 1024 * 1024`) before anything is sent.

## Best practices

- Set `limits` on every multer instance: at least `fileSize`, `files`, `fields` and `parts`.
- Choose storage by size: memory for small files you check and forward at once, disk for larger files you process locally, streaming or presigned URLs for anything that ends up in object storage.
- Store under a generated name; never under `originalname`.
- Check the type from the first bytes (your own signature table or `file-type`), and keep an allow-list of formats, not a deny-list.
- Put the post-multer work in one `try`/`catch` that deletes the temp file and rethrows (Example 5); answer only after the delete finished.
- Handle every error shape in the upload error handler: `MulterError` (`err.code`), plain errors from aborts, and your own `fileFilter` errors.
- For direct uploads, presign a short-lived POST with `content-length-range` and a fixed key per upload, then verify the object (size, type by bytes) before you use it.
- When the client disconnects or a limit trips, destroy the file stream and call `upload.abort()`, then confirm with `ListMultipartUploads` in tests that nothing stays open. A bucket lifecycle rule that aborts incomplete multipart uploads catches what slips through.

## ⭐ Interview lens

> **Q: “Why can't you trust `req.file.mimetype`, and what do you check instead?”**  
> A: It is the `Content-Type` the client wrote into the part header, and curl or a browser derive it from the file extension. I check the first bytes against known signatures (`89 50 4E 47 …` for PNG, `FF D8 FF` for JPEG, `%PDF-` for PDF), either with a small table or the `file-type` package, and reject anything not on my allow-list. *Trap:* a matching signature says which format the file claims to be; it does not prove the file is harmless or well-formed.

> **Q: “Memory storage or disk storage in multer?”**  
> A: Memory storage puts the bytes in `file.buffer`, so it suits small files I inspect and forward right away, with a strict `fileSize`. Disk storage writes to `file.path`, which suits bigger files, but every failure after multer must delete the file or it leaks. For S3 I avoid both and stream the busboy file stream into lib-storage's `Upload`, or let the browser upload with a presigned URL.

> **Q: “What happens in multer when the client disconnects mid-upload?”**  
> A: Node emits `'aborted'` and `'close'` on the request without `readableEnded`. multer destroys busboy, removes any partial file it wrote, and calls `next(new Error('Request aborted'))`. The error handler runs, but the socket is already destroyed, so it should not try to respond.

> **Q: “Presigned PUT vs presigned POST?”**  
> A: A presigned PUT is a URL whose SigV4 query signature allows one `PUT` to one key until it expires; it cannot limit the body size. A presigned POST signs a policy document with conditions such as `content-length-range` and `starts-with $Content-Type`, and S3 rejects a form that breaks them, for example `EntityTooLarge` for a file over the range.

> **Q: “How does `@aws-sdk/lib-storage` upload a stream of unknown length?”**  
> A: It cuts the stream into `partSize` chunks (minimum 5 MiB). If the first chunk is also the last, it sends one `PutObject`; otherwise it starts a multipart upload, sends up to `queueSize` parts at once, and completes it at the end. On error or `abort()` it sends `AbortMultipartUpload`, but only after its read loop stops, so on a client disconnect I also destroy the body stream.

## Cheat-card

- **Parser:** multer 2.4.0 = Express middleware on busboy 1.6.0; non-multipart requests pass through untouched.
- **Factories:** `.single(f)` → `req.file`; `.array(f, n)` → `req.files[]`; `.fields([...])` → `req.files{}`; `.none()` → text only.
- **Storage:** `memoryStorage()` → `file.buffer`; `diskStorage({ destination, filename })` → `file.path` (default `os.tmpdir()`, random hex name).
- **Limits:** `fileSize` is inclusive; `files`, `fields`, `parts`; all default `Infinity` except `fieldSize` (1 MB) and `headerPairs` (2000).
- **Errors:** `err instanceof multer.MulterError`, switch on `err.code` (`LIMIT_FILE_SIZE` → 413); aborts are a plain `Error('Request aborted')`.
- **Real type:** first bytes, PNG `89504e470d0a1a0a`, JPEG `ffd8ff`, PDF `255044462d`; `file-type` 22.x is ESM-only.
- **Cleanup:** multer cleans its own failures; your later failures must `fs.rm(file.path)` before responding.
- **S3 stream:** `new Upload({ client, params: { Bucket, Key, Body: stream }, partSize: 5 MiB, queueSize })`; on a limit or disconnect, destroy the stream and `abort()`.
- **Presigned:** PUT = `getSignedUrl(s3, new PutObjectCommand(...), { expiresIn })`, no size limit, client with `requestChecksumCalculation: 'WHEN_REQUIRED'`; POST = `createPresignedPost` with `['content-length-range', min, max]`.
- **Local S3:** `endpoint` + `forcePathStyle: true` + throwaway keys; never real credentials in examples.

---

## Learn More

- [multer README github.com](https://github.com/expressjs/multer)
- [Multer middleware expressjs.com](https://expressjs.com/en/resources/middleware/multer.html)
- [busboy README github.com](https://github.com/mscdex/busboy)
- [file-type README github.com](https://github.com/sindresorhus/file-type)
- [@aws-sdk/lib-storage AWS SDK for JavaScript v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/)
- [Uploading objects with presigned URLs Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
- [@aws-sdk/s3-presigned-post README github.com](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-presigned-post)
- [Announcement: S3 default integrity change aws-sdk-js-v3 on github.com](https://github.com/aws/aws-sdk-js-v3/issues/6810)
- [SeaweedFS Amazon S3 API wiki github.com](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [Uploading and copying objects using multipart upload Amazon S3 User Guide](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [File Upload Cheat Sheet OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Loading ECMAScript modules using require() nodejs.org](https://nodejs.org/docs/latest-v24.x/api/modules.html)
