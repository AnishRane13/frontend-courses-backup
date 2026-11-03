---
title: "File Responses: sendFile, download and attachment"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# File Responses: sendFile, download and attachment

*18 min read · Updated 10 Oct 2026 · Topic 91 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0

---

## Say it in 30 seconds

`res.sendFile` streams one file from disk, with the content type, the length, cache validators, and support for asking for a byte range. `res.download` is that plus a header that tells the browser to save the file. `res.attachment` only sets that header, and you send the body yourself. You use them when code, not the URL, chooses the file, such as an invoice the user is allowed to see. The trade-off is that a path built from the request with `path.join` can climb out of the folder with `..`, unless you pass a `root` and send refuses to leave it.

## Why it matters

`express.static`, lesson 55, serves a whole directory by URL. Many responses need one file chosen by code: an invoice the user may see, a generated export, a report with a friendly download name, or a video that must support seeking. Express has three methods. `res.sendFile` sends a file. `res.download` sends it as a download. `res.attachment` sets the download headers for a body you produce yourself.

The calls are short, and the mistakes are serious.

- **Path traversal.** Building the path from `req.params` with `path.join` lets `..%2f` reach any file the process can read. Example 2 shows it.
- **Broken file names.** A name with `é`, `€`, or a quote needs the encoding from RFC 8187 in `Content-Disposition`, or the browser saves the wrong name.
- **Unhandled errors.** A missing file, a refused path, or a client that hangs up all arrive in a callback. If you pass a callback, you answer the request yourself.
- **Memory.** Reading the whole file into a buffer before sending it costs as much memory as the file. Example 6 measures it.

## The concept, simply

`res.sendFile(path, options, callback)` streams one file. `path` must be absolute unless you pass `options.root`. With `root`, `path` is resolved under that directory, and any `..` that would escape it is refused with 403. It sets `Content-Type` from the extension and adds `Content-Length`, `ETag`, `Last-Modified`, `Cache-Control`, and `Accept-Ranges`. A conditional request can be 304. A `Range` request can be 206.

`res.download(path, filename, options, callback)` is `res.sendFile` plus `Content-Disposition: attachment`, which tells the browser to save the file instead of showing it. `filename` defaults to the basename of `path`. Unlike `sendFile`, a relative path without `root` is resolved against `process.cwd()`.

`res.attachment(filename)` sends nothing. It sets `Content-Disposition: attachment`, and if you passed a name it also sets `Content-Type` from that name's extension. You then send the body with `res.send`, a stream, or anything else.

`res.sendFile` and `res.download` hand the work to the send package, the same one behind `express.static`. The `Content-Disposition` value comes from the content-disposition package.

## How it works

What `res.sendFile('report.pdf', { root: FILES }, fn)` does:

1. **Argument checks, and they throw immediately.** No path throws `TypeError: path argument is required to res.sendFile`. A relative path and no `root` throws `TypeError: path must be absolute or specify root to res.sendFile`. Express catches that like any other synchronous throw.
2. **Path resolution, inside send.** The path is percent-encoded for send, decoded again, and checked for a NUL byte, which is 400. It is joined to `root` and normalized. A remaining `..` segment is 403. The `dotfiles` rule is `'ignore'` by default, which is a 404, `'deny'` which is 403, or `'allow'`. With no `root`, that rule applies to every segment of an absolute path. That changed in Express 5. Example 8 shows it.
3. **`stat()`.** Missing is 404 with `err.code` `ENOENT`. A directory is `EISDIR`, which Express turns into `next()` when you did not pass a callback.
4. **Headers.** `options.headers` are set first. Then `Accept-Ranges`, unless `acceptRanges` is false. Then `Cache-Control: public, max-age=<maxAge>`, unless `cacheControl` is false, plus `immutable` if you set it. Then `Last-Modified`, unless you turned it off. Then a weak `ETag`, unless the app setting `etag` is disabled. Then `Content-Type` from the extension.
5. **Conditional requests and Range.** A matching `If-None-Match` or `If-Modified-Since` is 304. One satisfiable `Range` is 206 with `Content-Range`. An unsatisfiable range is 416 with `Content-Range: bytes */<size>`. Several ranges are merged when they touch, and otherwise ignored, so the full 200 is sent. send never builds `multipart/byteranges`. An `If-Range` that does not match the current ETag or date turns the range request into a full 200.
6. **Streaming.** The file, or the slice, is piped from `fs.createReadStream` to the response, with backpressure.
7. **The callback.** `fn(err)` runs once. No argument means the transfer finished. An error means it failed before or during the transfer. `err.code === 'ECONNABORTED'` means the client went away. If you pass `fn`, Express does not call `next(err)` for you. If you leave it out, Express calls `next(err)` for every error except a client abort or a socket write error.

The options are `maxAge` in milliseconds or an ms-format string, default 0, `root`, `lastModified` default true, `headers`, `dotfiles` default `'ignore'`, `acceptRanges` default true, `cacheControl` default true, and `immutable` default false. `res.download` passes them to `res.sendFile`, but it ignores a `Content-Disposition` key in `headers` because it sets that header itself. Example 4 shows it. Express 5 removed the `hidden` and `from` options. Use `dotfiles` and `root`. It also removed the lower-case `res.sendfile()`.

**Why a user-controlled path is dangerous.** Express decodes route parameters, so `/unsafe/..%2fsecret.txt` puts `'../secret.txt'` in `req.params.name`. `path.join(FILES, '../secret.txt')` is outside `FILES`. Without `root`, `res.sendFile` sends whatever absolute path you give it. With `root`, send resolves the name under the root and refuses `..` with 403. A leading `/` stays under the root too. `/etc/passwd` became `FILES/etc/passwd`, a 404. `root` does not check permissions. It only keeps the path inside one directory. You still decide whether this user may have this file. Symlinks inside the root are followed. Lesson 55 shows that. Lesson 42's appendix builds the same checks by hand.

**File names.** RFC 6266 defines `Content-Disposition`. `attachment` asks the browser to save the body. `inline` asks it to display the body. `filename` suggests the name. A header value is effectively ISO-8859-1, so a name outside US-ASCII also goes in `filename*`, encoded as RFC 8187 describes: `UTF-8''` plus the percent-encoded UTF-8 bytes. content-disposition writes both. The `filename` fallback replaces non-ASCII characters with `?` and escapes quotes. Clients that understand `filename*` should prefer it.

**Range requests.** A video player or a resumable download asks for part of the file with `Range: bytes=start-end`. Lesson 41's appendix implements the rules by hand. `res.sendFile` does them for you, with one difference. send lets a weak ETag satisfy `If-Range`. RFC 9110's strong comparison does not.

## Code examples

Create the files once (the 200 MiB file is only for Examples 3 and 6):

bash

```
# setup.sh: files to send, a dotfile, and a secret one level above the files directory
mkdir -p files
printf 'abcdefghijklmnopqrstuvwxyz' > files/alphabet.txt
echo '%PDF-1.4 fake report' > files/report-2026.pdf
echo 'x' > files/.htpasswd
echo 'TOP SECRET' > secret.txt
mkdir -p files/.cache && echo '<p>built</p>' > files/.cache/index.html     # for Example 8
head -c 200M /dev/urandom > files/big.bin                                   # for Examples 3 and 6
```

Install with `npm install express@5 supertest` (and `express4@npm:express@4` for Example 8). Servers on fixed ports are started with `node <file>`, and the `curl` commands run in a second terminal. `ETag`, `Last-Modified` and `Date` values depend on your files and clock.

**Example 1 — `res.sendFile` with `root`, options and a callback, and the absolute-path rule.**

javascript

```
// sendfile.mjs: res.sendFile with root, options, the callback, and the absolute-path rule.
import express from 'express';
import { fileURLToPath } from 'node:url';

const FILES = fileURLToPath(new URL('./files', import.meta.url));
const app = express();

app.get('/relative', (req, res) => {
  res.sendFile('files/alphabet.txt');               // relative, no root: throws synchronously
});

app.get('/doc/:name', (req, res, next) => {
  res.sendFile(req.params.name, {
    root: FILES,                                    // relative paths resolve here, '..' is refused
    maxAge: '10m',
    dotfiles: 'deny',                               // default is 'ignore' (404)
    headers: { 'X-Content-Type-Options': 'nosniff' },
  }, (err) => {
    if (!err) return console.log('sent', req.params.name);
    console.log('sendFile error:', err.status, err.code ?? err.message, 'headersSent:', res.headersSent);
    if (res.headersSent) return;                    // part of the file already went out: nothing to fix
    res.status(err.status ?? 500).json({ error: err.status === 404 ? 'not found' : 'cannot send file' });
  });
});

app.use((err, req, res, next) => {
  console.log('error handler:', err.name, err.message);
  res.status(500).json({ error: err.message });
});

app.listen(5610, () => console.log('listening on 5610'));

// Real output (Node v24.19.0, Express 5.3.0), server console after the four curl requests below:
//   listening on 5610
//   sent alphabet.txt
//   sendFile error: 404 ENOENT headersSent: false
//   sendFile error: 403 Forbidden headersSent: false
//   error handler: TypeError path must be absolute or specify root to res.sendFile
```

bash

```
$ curl -si -w '\n' http://127.0.0.1:5610/doc/alphabet.txt
HTTP/1.1 200 OK
X-Powered-By: Express
X-Content-Type-Options: nosniff
Accept-Ranges: bytes
Cache-Control: public, max-age=600
Last-Modified: Sat, 10 Oct 2026 16:08:02 GMT
ETag: W/"1a-1a1269243ae"
Content-Type: text/plain; charset=utf-8
Content-Length: 26
Date: Sat, 10 Oct 2026 16:11:56 GMT
Connection: keep-alive
Keep-Alive: timeout=5

abcdefghijklmnopqrstuvwxyz
$ curl -s -w ' %{http_code}\n' http://127.0.0.1:5610/doc/missing.txt
{"error":"not found"} 404
$ curl -s -w ' %{http_code}\n' http://127.0.0.1:5610/doc/.htpasswd
{"error":"cannot send file"} 403
$ curl -s -w ' %{http_code}\n' http://127.0.0.1:5610/relative
{"error":"path must be absolute or specify root to res.sendFile"} 500
```

`maxAge: '10m'` became `max-age=600`, and the custom header was sent. Because the route passes a callback, the 404 and 403 cases reached the callback, not the error handler, and the callback had to send the response itself. The relative path without `root` threw a `TypeError` before any I/O, and Express passed it to the error handler. The error handler in this demo echoes `err.message`; in production, log it instead, because send's error messages can contain absolute paths.

**Example 2 — user-controlled names: traversal with and without `root`.**

javascript

```
// traversal.mjs: a user-controlled file name, joined by hand vs passed with { root }.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = fileURLToPath(new URL('./files', import.meta.url));
const app = express();
const show = (req, res, next) => { console.log(req.path, '-> params', JSON.stringify(req.params)); next(); };

// UNSAFE: req.params is already percent-decoded, so '..%2f' arrives as '../'
app.get('/unsafe/:name', show, (req, res) => res.sendFile(path.join(FILES, req.params.name)));
app.get('/unsafe-wild/*file', show, (req, res) => res.sendFile(path.join(FILES, ...req.params.file)));

// SAFE: send resolves the name under root and refuses any '..' segment with 403
app.get('/safe/:name', show, (req, res) => res.sendFile(req.params.name, { root: FILES }));
app.get('/safe-wild/*file', show, (req, res) => res.sendFile(req.params.file.join('/'), { root: FILES }));

app.use((err, req, res, next) => res.status(err.status ?? 500).type('text').send(`${err.status} ${err.code ?? err.message}\n`));
app.listen(5611, () => console.log('listening on 5611'));

// Real output (Node v24.19.0, Express 5.3.0), server console after the curl requests below:
//   listening on 5611
//   /unsafe/..%2fsecret.txt -> params {"name":"../secret.txt"}
//   /unsafe-wild/../secret.txt -> params {"file":["..","secret.txt"]}
//   /unsafe-wild/..%2fsecret.txt -> params {"file":["../secret.txt"]}
//   /safe/..%2fsecret.txt -> params {"name":"../secret.txt"}
//   /safe-wild/../secret.txt -> params {"file":["..","secret.txt"]}
//   /safe-wild/..%2fsecret.txt -> params {"file":["../secret.txt"]}
//   /safe/%2Fetc%2Fpasswd -> params {"name":"/etc/passwd"}
//   /safe/alphabet.txt -> params {"name":"alphabet.txt"}
```

bash

```
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/unsafe/..%2fsecret.txt
TOP SECRET
 200
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/unsafe-wild/../secret.txt
TOP SECRET
 200
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/unsafe-wild/..%2fsecret.txt
TOP SECRET
 200
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/safe/..%2fsecret.txt
403 Forbidden
 403
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/safe-wild/../secret.txt
403 Forbidden
 403
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/safe-wild/..%2fsecret.txt
403 Forbidden
 403
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/safe/%2Fetc%2Fpasswd
404 ENOENT
 404
$ curl -s --path-as-is -w ' %{http_code}\n' http://127.0.0.1:5611/safe/alphabet.txt
abcdefghijklmnopqrstuvwxyz 200
```

The server log shows the mechanism: `:name` arrived as `'../secret.txt'`, and the Express 5 wildcard `*file` arrived as an array of segments that can contain `'..'`. Every unsafe route leaked the file one directory up. The same inputs with `root` were refused with `403`, and an absolute name was kept inside the root (`404`). curl only sends `/../` as written because of `--path-as-is`; an attacker's client does not normalize anything.

**Example 3 — the callback when the client hangs up mid-transfer.**

javascript

```
// abort.mjs: what the sendFile callback receives when the client hangs up mid-transfer.
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const FILES = fileURLToPath(new URL('./files', import.meta.url));     // files/big.bin: 200 MiB
const app = express();
app.get('/big', (req, res) => {
  res.sendFile('big.bin', { root: FILES }, (err) => {
    console.log('server callback:', err ? `${err.code} "${err.message}"` : 'complete',
      '| headersSent:', res.headersSent);
    server.close();
  });
});

const server = app.listen(0, () => {
  const req = http.get(`http://127.0.0.1:${server.address().port}/big`, (res) => {
    console.log('client: status', res.statusCode, 'content-length', res.headers['content-length']);
    res.once('data', (chunk) => {
      console.log('client: got', chunk.length, 'bytes, hanging up');
      req.destroy();                                   // close the socket mid-download
    });
  });
  req.on('error', () => {});
});

// Real output (Node v24.19.0, Express 5.3.0):
//   client: status 200 content-length 209715200
//   client: got 65210 bytes, hanging up
//   server callback: ECONNABORTED "Request aborted" | headersSent: true
```

A client abort is reported as `err.code === 'ECONNABORTED'` with the headers already sent, so there is nothing left to answer. Treat it as "the download did not complete" (do not count a download credit, for example) and do not try to send an error response. Without a callback, Express ignores this error instead of calling `next(err)`.

**Example 4 — `res.download` and `res.attachment`.**

javascript

```
// download.mjs: res.download and res.attachment, and the Content-Disposition they produce.
import express from 'express';
import { fileURLToPath } from 'node:url';

const FILES = fileURLToPath(new URL('./files', import.meta.url));
const app = express();

// 1. res.download(path): filename taken from the path's basename
app.get('/dl/plain', (req, res) => res.download(`${FILES}/report-2026.pdf`));

// 2. a filename argument plus sendFile options (root, headers); a Content-Disposition in headers is ignored
app.get('/dl/named', (req, res, next) => {
  res.download('report-2026.pdf', 'Q3 report.pdf', {
    root: FILES,
    headers: { 'X-Report': 'q3', 'Content-Disposition': 'inline' },
  }, (err) => {
    if (err && !res.headersSent) next(err);
  });
});

// 3. non-ASCII and quotes in the name
app.get('/dl/unicode', (req, res) => res.download('report-2026.pdf', 'Résumé "final" €.pdf', { root: FILES }));

// 4. res.attachment only sets headers; you still send the body yourself
app.get('/export.csv', (req, res) => {
  res.attachment('users 2026-10.csv');               // also sets Content-Type from the extension
  res.send('id,name\n1,Ada\n');
});
app.get('/bare', (req, res) => res.attachment().send('no name'));

// 5. a missing file with the default callback goes to the error handler
app.get('/dl/missing', (req, res) => res.download('nope.pdf', { root: FILES }));

app.use((err, req, res, next) => res.status(err.status ?? 500).type('text').send(`${err.status} ${err.code}\n`));
app.listen(5612, () => console.log('listening on 5612'));

// Real output (Node v24.19.0, Express 5.3.0):
//   listening on 5612
```

bash

```
$ curl -sI http://127.0.0.1:5612/dl/plain | grep -iE '^(HTTP|content-disposition|content-type|content-length|x-report)'
HTTP/1.1 200 OK
Content-Disposition: attachment; filename=report-2026.pdf
Content-Type: application/pdf
Content-Length: 21
$ curl -sI http://127.0.0.1:5612/dl/named | grep -iE '^(HTTP|content-disposition|content-type|content-length|x-report)'
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="Q3 report.pdf"
X-Report: q3
Content-Type: application/pdf
Content-Length: 21
$ curl -sI http://127.0.0.1:5612/dl/unicode | grep -iE '^(HTTP|content-disposition|content-type|content-length|x-report)'
HTTP/1.1 200 OK
Content-Disposition: attachment; filename="R?sum? \"final\" ?.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22%20%E2%82%AC.pdf
Content-Type: application/pdf
Content-Length: 21
$ curl -si http://127.0.0.1:5612/export.csv | grep -iE '^(HTTP|content-disposition|content-type|content-length|x-report)'
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="users 2026-10.csv"
Content-Length: 14
$ curl -si http://127.0.0.1:5612/bare | grep -iE '^(HTTP|content-disposition|content-type|content-length|x-report)'
HTTP/1.1 200 OK
Content-Disposition: attachment
Content-Type: text/html; charset=utf-8
Content-Length: 7
$ curl -s -w '%{http_code}\n' http://127.0.0.1:5612/dl/missing
404 ENOENT
404
```

A name made only of token characters is sent unquoted (`filename=report-2026.pdf`). A space forces quotes. The `'inline'` value in `headers` was dropped, because `res.download` always sets its own `Content-Disposition`. For the non-ASCII name, `filename` is a lossy fallback (`R?sum? \"final\" ?.pdf`) and `filename*` carries the exact UTF-8 bytes. `res.attachment('users 2026-10.csv')` set `text/csv` from the extension. `res.attachment()` with no name set no type, so `res.send('no name')` defaulted to `text/html`. Set the type yourself in that case.

**Example 5 — the content-disposition package directly.**

javascript

```
// cd.mjs: the content-disposition package that res.attachment and res.download call.
// npm install content-disposition@2   (Express 5.3.0 depends on 2.0.1; import it directly only if you list it)
import { create, parse } from 'content-disposition';

const names = ['report.pdf', 'Q3 report.pdf', 'say "hi".txt', 'naïve.txt', '日本語.txt', '€ rates.txt'];
for (const n of names) console.log(JSON.stringify(n).padEnd(16), '->', create(n));

console.log(create('naïve.txt', { fallback: 'naive.txt' }));
console.log(create('naïve.txt', { fallback: false }));
console.log(create('chart.png', { type: 'inline' }));

// parse() decodes filename* and prefers it over filename
const parsed = parse(create('Résumé "final" €.pdf'));
console.log(parsed.type, '|', parsed.parameters.filename);

// Real output (Node v24.19.0, content-disposition 2.0.1):
//   "report.pdf"     -> attachment; filename=report.pdf
//   "Q3 report.pdf"  -> attachment; filename="Q3 report.pdf"
//   "say \"hi\".txt" -> attachment; filename="say \"hi\".txt"
//   "naïve.txt"      -> attachment; filename="na?ve.txt"; filename*=UTF-8''na%C3%AFve.txt
//   "日本語.txt"        -> attachment; filename="???.txt"; filename*=UTF-8''%E6%97%A5%E6%9C%AC%E8%AA%9E.txt
//   "€ rates.txt"    -> attachment; filename="? rates.txt"; filename*=UTF-8''%E2%82%AC%20rates.txt
//   attachment; filename=naive.txt; filename*=UTF-8''na%C3%AFve.txt
//   attachment; filename*=UTF-8''na%C3%AFve.txt
//   inline; filename=chart.png
//   attachment | Résumé "final" €.pdf
```

Use `fallback` to give old clients a readable ASCII name instead of `na?ve.txt`. Use `type: 'inline'` when the browser should display the file (a PDF preview) but still get a suggested name if the user saves it. `res.attachment` and `res.download` always use `attachment`, so for `inline` set the header yourself: `res.set('Content-Disposition', create(name, { type: 'inline' }))`. The version under Express 4 behaves differently: content-disposition 0.5.4 gave `attachment; filename="naïve.txt"` for the same input, writing `ï` as a raw ISO-8859-1 byte with no `filename*` (checked in a separate run).

**Example 6 — streaming: `sendFile` vs `createReadStream` + `pipeline` vs `readFile`, with memory measured.**

`res.sendFile` already streams. A hand-written `pipeline(fs.createReadStream(file), res)` also streams, but then you write `Content-Type`, `Content-Length`, ETags, conditional requests and `Range` yourself. `readFile` + `res.send` holds the whole file in memory. This script measures it: each mode runs in a fresh Node process, `curl` (a separate process) downloads the file, and the server samples `process.memoryUsage().rss` every 5 ms.

javascript

```
// memory.mjs: peak RSS while serving a 200 MiB file three ways. Each mode runs in a fresh process.
// usage: node memory.mjs            (parent: runs every mode and prints a table)
//        node memory.mjs <mode>     (child: one server, one download)
import express from 'express';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./files/big.bin', import.meta.url));   // head -c 200M /dev/urandom > files/big.bin
const mode = process.argv[2];

if (!mode) {
  for (const m of ['readFile + res.send', 'res.sendFile', 'createReadStream + pipeline']) {
    console.log(execFileSync(process.execPath, [fileURLToPath(import.meta.url), m], { encoding: 'utf8' }).trim());
  }
} else {
  const app = express();
  app.get('/big', async (req, res, next) => {
    try {
      if (mode === 'readFile + res.send') {
        res.type('application/octet-stream').send(await readFile(FILE));       // whole file in memory
      } else if (mode === 'res.sendFile') {
        res.sendFile(FILE);                                                      // streams via send
      } else {
        const { size } = await stat(FILE);
        res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': size });
        await pipeline(createReadStream(FILE), res);                             // streams, no Range/ETag
      }
    } catch (err) { next(err); }
  });
  const server = app.listen(0, () => {
    const base = process.memoryUsage().rss;
    let peak = base;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 5);
    // the client is curl, a separate process, so only the server's memory is measured
    execFile('curl', ['-s', '-o', '/dev/null', '-w', '%{size_download}', `http://127.0.0.1:${server.address().port}/big`], (err, out) => {
      clearInterval(timer);
      const mb = (n) => (n / 1048576).toFixed(0).padStart(4);
      console.log(`${mode.padEnd(28)} sent ${mb(Number(out))} MiB | RSS before ${mb(base)} MiB | peak ${mb(peak)} MiB | +${mb(peak - base)} MiB`);
      server.close();
    });
  });
}

// Real output (Node v24.19.0, Express 5.3.0, curl 8.18.0; Intel Core i5-1135G7, 8 threads, 14 GiB RAM, Linux x64, file on tmpfs):
//   readFile + res.send          sent  200 MiB | RSS before   73 MiB | peak  276 MiB | + 203 MiB
//   res.sendFile                 sent  200 MiB | RSS before   72 MiB | peak  137 MiB | +  64 MiB
//   createReadStream + pipeline  sent  200 MiB | RSS before   73 MiB | peak  138 MiB | +  65 MiB
```

Re-runs differ by a MiB or two. `readFile` grew RSS by about the file size. The two streaming versions grew by about 64 MiB. That growth comes from short-lived 64 KiB chunks that the garbage collector had not reclaimed yet, and it did not scale with the file: the same script with a 600 MiB file (a separate run) gave `+604 MiB` for `readFile`, `+74 MiB` for `res.sendFile` and `+72 MiB` for `pipeline`. RSS is a coarse measure (it includes memory V8 has not returned to the OS), so read these as "proportional to the file" versus "roughly constant", not as exact costs. Choose `pipeline` when the bytes do not come from a file on disk (a transform, an object-storage stream, a zip being built); use `res.sendFile` for files on disk, because it also handles `Range`, `304` and the headers.

**Example 7 — Range requests: `206`, `416`, merged ranges, `If-Range` and `acceptRanges: false`.**

javascript

```
// range.mjs: Range requests answered by res.sendFile, with and without acceptRanges.
import express from 'express';
import { fileURLToPath } from 'node:url';

const FILES = fileURLToPath(new URL('./files', import.meta.url));
const app = express();
app.get('/a', (req, res) => res.sendFile('alphabet.txt', { root: FILES }));                        // 26 bytes a..z
app.get('/norange', (req, res) => res.sendFile('alphabet.txt', { root: FILES, acceptRanges: false }));
app.use((err, req, res, next) => res.status(err.status ?? 500).type('text').send(`${err.status} ${err.message}\n`));
app.listen(5613, () => console.log('listening on 5613'));

// Real output (Node v24.19.0, Express 5.3.0):
//   listening on 5613
```

bash

```
# range-test.sh: status, the range headers and the body for each request.
show() { echo "## curl $*"; curl -si "$@" | tr -d '\r' | grep -E '^HTTP/|^(Content-Range|Content-Length|Accept-Ranges):|^[a-z]+$'; }
A=http://127.0.0.1:5613/a
show -r 0-4 $A
show -r 20- $A
show -r -3 $A
show -r 30-40 $A
show -r 0-1,5-6 $A
show -r 0-4,5-9 $A
show -r 0-4 http://127.0.0.1:5613/norange
etag=$(curl -sI $A | tr -d '\r' | sed -n 's/^ETag: //p')
show -r 0-4 -H "If-Range: $etag" $A
show -r 0-4 -H 'If-Range: "some-older-version"' $A
```

bash

```
$ bash range-test.sh
## curl -r 0-4 http://127.0.0.1:5613/a
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-4/26
Content-Length: 5
abcde
## curl -r 20- http://127.0.0.1:5613/a
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 20-25/26
Content-Length: 6
uvwxyz
## curl -r -3 http://127.0.0.1:5613/a
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 23-25/26
Content-Length: 3
xyz
## curl -r 30-40 http://127.0.0.1:5613/a
HTTP/1.1 416 Range Not Satisfiable
Accept-Ranges: bytes
Content-Range: bytes */26
Content-Length: 26
## curl -r 0-1,5-6 http://127.0.0.1:5613/a
HTTP/1.1 200 OK
Accept-Ranges: bytes
Content-Length: 26
abcdefghijklmnopqrstuvwxyz
## curl -r 0-4,5-9 http://127.0.0.1:5613/a
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-9/26
Content-Length: 10
abcdefghij
## curl -r 0-4 http://127.0.0.1:5613/norange
HTTP/1.1 200 OK
Content-Length: 26
abcdefghijklmnopqrstuvwxyz
## curl -r 0-4 -H If-Range: W/"1a-1a1269243ae" http://127.0.0.1:5613/a
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 0-4/26
Content-Length: 5
abcde
## curl -r 0-4 -H If-Range: "some-older-version" http://127.0.0.1:5613/a
HTTP/1.1 200 OK
Accept-Ranges: bytes
Content-Length: 26
abcdefghijklmnopqrstuvwxyz
```

- `bytes=0-4`, `20-` (to the end) and `-3` (the last three bytes) each gave `206` with a `Content-Range` of the form `bytes start-end/size`.
- A range that starts past the end gave `416` with `Content-Range: bytes */26`. send set that header before raising the error, so it was still there when the error handler responded. The 26-byte body is the handler's `416 Range Not Satisfiable\n`.
- Two separate ranges gave the full `200`. send does not produce `multipart/byteranges`. Adjacent ranges (`0-4,5-9`) were merged into one `206`.
- `acceptRanges: false` removed `Accept-Ranges` and ignored the `Range` header.
- An `If-Range` that does not match gave the full file, which is what a resuming client needs when the file has changed. A matching *weak* ETag still gave `206`. RFC 9110 §13.1.5 says a client must not send a weak tag in `If-Range` and a server must evaluate it with the strong comparison, under which a weak tag never matches. send 1.2.1 checks with a substring test (`ifRange.indexOf(etag)`). Lesson 41's hand-written server follows the RFC here and the two behave differently.

**Example 8 — edge case: an absolute path through a dot-directory, Express 5 vs Express 4.**

Build tools often write to hidden directories (`.next`, `.cache`, `.output`). The question is whether `res.sendFile('/…/files/.cache/index.html')` still works after upgrading.

javascript

```
// hidden-dir.cjs: res.sendFile with an absolute path through a dot-directory, Express 5 vs 4.
// npm install express@5 express4@npm:express@4 supertest
const path = require('node:path');
const request = require('supertest');
const FILE = path.join(__dirname, 'files', '.cache', 'index.html');     // mkdir files/.cache; echo '<p>built</p>' > files/.cache/index.html

(async () => {
  for (const [label, mod] of [['Express 5', 'express'], ['Express 4', 'express4']]) {
    const express = require(mod);
    const app = express();
    app.get('/abs', (req, res) => res.sendFile(FILE));
    app.get('/abs-allow', (req, res) => res.sendFile(FILE, { dotfiles: 'allow' }));
    app.get('/root', (req, res) => res.sendFile('index.html', { root: path.dirname(FILE) }));
    app.use((err, req, res, next) => res.sendStatus(err.status ?? 500));    // quiet: no stack trace
    const v = require(`${mod}/package.json`).version;
    for (const p of ['/abs', '/abs-allow', '/root']) {
      const r = await request(app).get(p);
      console.log(`${label} (${v}) GET ${p.padEnd(10)} -> ${r.status}`);
    }
  }
})();

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   Express 5 (5.3.0) GET /abs       -> 404
//   Express 5 (5.3.0) GET /abs-allow -> 200
//   Express 5 (5.3.0) GET /root      -> 200
//   Express 4 (4.22.3) GET /abs       -> 200
//   Express 4 (4.22.3) GET /abs-allow -> 200
//   Express 4 (4.22.3) GET /root      -> 200
```

Without `root`, send checks every segment of the absolute path, and Express 5 (send 1.x) applies `dotfiles: 'ignore'` to directories too, so `.cache` makes the file "not exist" (changed in Express 5). Express 4 only hid files whose own name starts with a dot. The cleanest fix is `root`: only the part of the path below the root is checked, so the hidden directory is no longer part of it. The same rule bites if the whole app lives under a hidden directory (for example `~/.local/app`) and every route calls `res.sendFile` with an absolute path.

## Common mistakes & gotchas

- **`res.sendFile(path.join(DIR, req.params.name))`.** Params are decoded, so `..%2f` becomes `../` and leaves `DIR`. Pass the name with `{ root: DIR }`. Example 2 shows it.
- **A relative path without `root`.** `res.sendFile('files/a.txt')` throws `TypeError: path must be absolute or specify root to res.sendFile`. `res.download` accepts it and resolves it from `process.cwd()`, which changes with where you start the app.
- **A callback that does not respond.** With `fn`, Express no longer calls `next(err)`. A callback that only logs leaves a 404 or 403 hanging.
- **Responding after a partial send.** For `ECONNABORTED`, or a read error mid-stream, `res.headersSent` is true. Check it before you write an error response.
- **Echoing `err.message`.** send's missing-file errors include the absolute path.
- **Building `Content-Disposition` by hand.** A template like `attachment; filename="${name}"` breaks on quotes and on non-ASCII names. Use `res.attachment`, `res.download`, or `contentDisposition()`.
- **Expecting `res.attachment` to send a file.** It only sets headers. With no name it sets no `Content-Type`, so `res.send('text')` goes out as `text/html`.
- **`readFile` plus `res.send` for a big file.** Memory grows with the file, and you get no `Range` and no 304. Example 6 measures it.
- **Expecting a multi-range body.** send serves the whole file when the ranges do not touch.
- **Files in hidden directories after an upgrade to Express 5.** An absolute path through `.cache/` and similar now 404s. Example 8 shows it.

## Best practices

- Always pass `root` when any part of the name comes from the request, and decide whether this user may read this file before you call `sendFile`.
- Prefer an id in the URL. `/invoices/:id` looks up the stored path, then `res.sendFile(storedName, { root })`.
- Handle the callback fully. If there is no error, return. If `res.headersSent` is true, return. Otherwise respond or call `next(err)`. Treat `ECONNABORTED` as an incomplete transfer, not a server error.
- Use `res.download(path, niceName)` for a download. Pass a `fallback` ASCII name when old clients matter.
- Use `res.sendFile` for a file on disk. Use `pipeline()` when the bytes come from somewhere else, so you still stream, and accept that you then write `Range` and `ETag` yourself.
- Set caching per file type with `maxAge`, `immutable`, and `headers`, as in lesson 55.
- Turn `acceptRanges` off for a one-time generated file. Leave it on for media and large downloads.

## ⭐ Interview lens

> **Q: “What is the difference between `res.sendFile`, `res.download` and `res.attachment`?”**  
> A: `res.sendFile` streams one file. It sets the type from the extension, the length, cache validators, and range handling, and it can answer 304 or 206. `res.download` is that same call plus `Content-Disposition: attachment` and a filename, so the browser saves the file instead of showing it. The name defaults to the file's basename. `res.attachment` only sets that header, and the content type from the name, and sends nothing. You write the body afterwards. The trap is relative paths. `download` resolves a relative path against `process.cwd()`. `sendFile` throws `TypeError: path must be absolute or specify root` unless you pass `root`. `download` also ignores a `Content-Disposition` you put in `options.headers`, because it sets that header itself.

> **Q: “Is `res.sendFile(path.join(__dirname, 'uploads', req.params.file))` safe?”**  
> A: No. Express decodes the parameter, so `..%2f..%2f.env` arrives as `../../.env`, and `path.join` resolves that outside `uploads`. Without `root`, sendFile sends any absolute path the process can read. Pass the name as `res.sendFile(req.params.file, { root: UPLOADS })`. send then refuses `..` with 403, and a leading slash stays inside the root, so `/etc/passwd` becomes a path under `UPLOADS` and 404s. `root` stops the climb. It does not stop one user from naming another user's file in the same directory. Check ownership in your code, or better, map an id to a stored name and never put the raw filename in the URL. A wildcard such as `*file` arrives as an array of segments that can contain `'..'`. Example 2 shows both.

> **Q: “How do you send a file name like `Résumé.pdf` in a download?”**  
> A: Put the real name in `filename*`, as RFC 6266 and RFC 8187 describe: `filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`. Also send an ASCII `filename` fallback for old clients. Non-ASCII characters in that fallback become `?`, and quotes are escaped. `res.download` and `res.attachment` produce both through the content-disposition package. A client that understands `filename*` uses it. If you need `inline`, so the browser displays a PDF but still suggests a name, set the header yourself with that package's `type: 'inline'`. `res.attachment` and `res.download` always use `attachment`. Do not build the header with a template string. A quote or a non-ASCII character breaks it.

> **Q: “Does `res.sendFile` load the file into memory? What about Range?”**  
> A: No. `res.sendFile` streams with `fs.createReadStream` and respects backpressure. It does not hold the whole file. In the measured run, peak RSS rose about 64 to 74 MiB for both a 200 MiB file and a 600 MiB file, while `readFile` plus `res.send` rose by about the file size, 604 MiB on the 600 MiB file. RSS is coarse, because it includes memory V8 has not returned to the operating system, so read it as "roughly constant" versus "proportional to the file". Ranges work for one range: 206 with `Content-Range: bytes start-end/size`, and 416 with `bytes */size` when the start is past the end. Adjacent ranges are merged. Several separate ranges fall back to a full 200, because send does not build a multipart body. `If-Range` that does not match returns the whole file. `acceptRanges: false` ignores `Range`. One limit: send 1.2.1 accepts a weak ETag in `If-Range`. RFC 9110 says a weak tag must not match.

## Cheat-card

- `res.sendFile(path, opts, fn)` needs an absolute path, or a relative path plus `root`. `..` under `root` is 403. A bad escape or a NUL is 400. Missing is 404 `ENOENT`.
- Options: `root`, `maxAge` default 0, `headers`, `dotfiles` default `'ignore'`, `lastModified` default true, `acceptRanges` default true, `cacheControl` default true, `immutable` default false. Express 5 removed `hidden`, `from`, and `res.sendfile()`.
- If you pass a callback, you must respond on error. Check `res.headersSent`. `ECONNABORTED` means the client left. With no callback, Express calls `next(err)` except for aborts.
- `res.download(path, name, opts, fn)` is sendFile plus `Content-Disposition: attachment`. It ignores `Content-Disposition` inside `headers`. A relative path uses `process.cwd()`.
- `res.attachment(name)` sets the header only, plus `Content-Type` from the name. No name means no type.
- The filename encoding is an ASCII `filename` plus `filename*=UTF-8''` and the percent-encoded bytes. That is content-disposition 2.0.1 on Express 5. Express 4's 0.5.4 wrote Latin-1 names raw, with no `filename*`.
- sendFile streams, so RSS stays roughly flat. `readFile` plus `send` grows with the file. `pipeline(createReadStream, res)` streams too, but you lose Range, ETag, and 304.
- Range: 206 with `Content-Range: bytes a-b/size`. 416 with `bytes */size`. Several separate ranges become 200. Adjacent ranges are merged. An `If-Range` mismatch is 200. send 1.2.1 accepts a weak ETag there.
- A dot-directory on an absolute path 404s on Express 5. Pass `root`, or `dotfiles: 'allow'`.

## Good to know

- If the user cancels a `sendFile` download, the callback receives `err.code === 'ECONNABORTED'` and `res.headersSent` is true. Nothing more can be sent. Log it or mark the transfer incomplete. Without a callback, Express ignores that error instead of passing it to `next`.
- send is 1.2.1 under Express 5.3.0 and 0.19.2 under Express 4.22.3. content-disposition is 2.0.1 under Express 5.3.0 and 0.5.4 under Express 4.22.3.
- In the memory run, a 200 MiB file and a separate 600 MiB file both grew RSS by about 64 to 74 MiB for `res.sendFile` and `pipeline`. `readFile` grew by about the file size: `+604 MiB` on the 600 MiB file. The streaming growth was short-lived 64 KiB chunks the garbage collector had not reclaimed yet.

## Learn More

- [res.sendFile, res.download, res.attachment (5.x API) expressjs.com](https://expressjs.com/en/5x/api/response/)
- [Migrating to Express 5 (sendFile options, dotfiles) expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [send README github.com](https://github.com/pillarjs/send)
- [content-disposition README github.com](https://github.com/jshttp/content-disposition)
- [Content-Disposition developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Disposition)
- [HTTP range requests developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [RFC 6266 Content-Disposition in HTTP rfc-editor.org](https://www.rfc-editor.org/rfc/rfc6266.html)
- [RFC 8187 Character set and language encoding for HTTP header parameters rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8187.html)
- [Stream (pipeline) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
