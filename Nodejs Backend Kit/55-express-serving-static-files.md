---
title: "Serving Static Files with express.static"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Serving Static Files with express.static

*20 min read · Updated 10 Oct 2026 · Topic 87 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0

---

## Say it in 30 seconds

`express.static` is middleware that, for a GET or HEAD request, looks for a file under a root directory and streams it if it is there. If the file is missing it calls next, so later routes still run. It sets the content type, the length, a validator for caches, and support for range requests. Apps use it for a built front end, images, and files like robots.txt, instead of writing that file server by hand. The trade-off is that caching and the "page not found" fallback are your settings. Cache the HTML for too long and users keep a dead build. Fall back to index.html for every miss and a missing script comes back as a web page.

## Why it matters

Almost every Express app sends some files straight from disk: a built single-page app, images, a `robots.txt`, a `.well-known/security.txt`. Lesson 42's appendix built that server by hand and showed the details: MIME types, streaming, `..` segments, dotfiles, and directory requests. `express.static` does that in one line. The bugs come from the settings around it.

- **Stale apps after a deploy.** If HTML is cached for an hour, users keep the old `index.html`, which points at JavaScript files the new build deleted.
- **Endless revalidation.** If nothing is cached, every page view re-requests every asset.
- **A history fallback that returns HTML for everything.** A missing `/assets/app.0ld0ld.js` comes back as `200` with `text/html`. The browser expected a script. An API client gets the SPA shell instead of a JSON 404.
- **Leaking files.** Before Express 5, a dot-directory such as `.git/` inside the served folder was served by default.

## The concept, simply

`express.static(root, options)` returns a middleware function. For GET or HEAD it takes the request path, after any mount prefix, resolves it under `root`, and if a regular file is there it streams that file. The response gets `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Cache-Control`, and `Accept-Ranges`. If there is no such file it calls `next()`, so later middleware and routes still run. "Serve it if it exists, otherwise step aside" is what makes static files fit the pipeline from lesson 49.

Express does not implement this itself. `express.static` is the serve-static package, and serve-static hands each file to the send package, which does the path checks, the conditional requests, and the streaming. `res.sendFile` uses the same send package. Lesson 56 covers that.

Where it sits in a request:

text

```
GET /static/assets/app.3f9a1c.js
        │
        ▼
app.use('/static', express.static(PUBLIC, opts))   ← mount prefix stripped: req.url = /assets/app.3f9a1c.js
        │
        ├─ method not GET/HEAD ───────────────► next()              (fallthrough: true, the default)
        ├─ decode path, '..' or NUL? ─────────► 403 / 400 → next()  (next(err) when fallthrough: false)
        ├─ dotfile segment? (dotfiles option) ► ignore → next()     | deny → 403 → next() | allow → continue
        ├─ stat(PUBLIC + path)
        │     ├─ missing ─────────────────────► next()
        │     ├─ directory without trailing / ► 301 Location: …/     (redirect: true)
        │     ├─ directory with trailing / ───► try index.html → missing → next()   (never a listing)
        │     └─ file
        ▼
setHeaders(res, path, stat)  →  Cache-Control, ETag, Last-Modified, Accept-Ranges, Content-Type
        │
        ├─ If-None-Match / If-Modified-Since match ─► 304, no body
        ├─ Range: bytes=a-b ───────────────────────► 206 slice
        └─ otherwise ──────────────────────────────► 200, file streamed
```

## How it works

For `GET /static/assets/app.3f9a1c.js` with `app.use('/static', express.static(PUBLIC))`:

1. **Mount.** The router sees the `/static` prefix, strips it, and calls the middleware with `req.url` of `/assets/app.3f9a1c.js`. `req.originalUrl` keeps the full path.
2. **Method.** Anything other than GET or HEAD goes to `next()`. With `fallthrough: false` it gets `405` and `Allow: GET, HEAD`.
3. **Path checks, inside send.** The path is percent-decoded. A bad escape or a NUL byte is `400`. The path is joined to the root and normalized. A `..` segment that would still climb out of the root is `403`. Then the dotfiles rule runs on every segment below the root.
4. **`stat()`.** A missing file is a 404 inside send, which serve-static turns into `next()`. A directory without a trailing slash gets a 301 to the same path plus `/`, unless you turn `redirect` off. A directory with a trailing slash is retried as `index.html`, unless you change `index`. No index file means `next()`. Express never lists the directory.
5. **Headers.** `setHeaders(res, path, stat)` runs first. Then send fills whatever is still unset: `Accept-Ranges: bytes`, `Cache-Control: public, max-age=<seconds>` plus `, immutable` when you asked for it, `Last-Modified` from the file mtime, and a weak ETag from size and mtime, shaped like `W/"<size hex>-<mtime ms hex>"`. `Content-Type` comes from the extension.
6. **Freshness and ranges.** A matching `If-None-Match`, or an `If-Modified-Since` that is not older than the mtime, is `304` with no body. A valid `Range` is `206`. Lesson 56 shows ranges.
7. **Streaming.** The file is piped from `fs.createReadStream`. A large file is not read into memory all at once.

**The options, from the serve-static 2.2.1 README.**

| Option | Default | What it does |
|---|---|---|
| `acceptRanges` | `true` | Send `Accept-Ranges: bytes` and honour `Range`. |
| `cacheControl` | `true` | Send `Cache-Control`. `false` also disables `maxAge` and `immutable`. |
| `dotfiles` | `'ignore'` | `'allow'` serves them, `'deny'` answers `403`, `'ignore'` answers `404`. Applies to every path segment below the root (changed in Express 5 / serve-static 2; see Example 5). |
| `etag` | `true` | Send a weak `ETag`. |
| `extensions` | `false` | Array of fallback extensions, e.g. `['html']` makes `/about` serve `about.html`. |
| `fallthrough` | `true` | `true`: client errors (404, 403, 400) call `next()`. `false`: they call `next(err)`, and non-GET/HEAD methods get `405`. |
| `immutable` | `false` | Add the `immutable` directive to `Cache-Control`. Only useful with a non-zero `maxAge`. |
| `index` | `'index.html'` | File (string or array, in order of preference) to serve for a directory; `false` disables it. |
| `lastModified` | `true` | Send `Last-Modified` from the file's mtime. |
| `maxAge` | `0` | `max-age` in milliseconds, or an [ms](https://github.com/vercel/ms)-format string (`'1h'`, `'1y'`). send caps it at one year. |
| `redirect` | `true` | Redirect a directory path to the same path with a trailing `/`. |
| `setHeaders` | — | `fn(res, path, stat)`, called synchronously just before the headers go out. Only called when a file is actually sent. |

**Cache headers for a built SPA.** A bundler such as Vite or webpack puts a hash of the file contents in the filename, like `app.3f9a1c.js`. That name never changes. When the code changes, the file gets a new name and `index.html` points at it. The two kinds of file need opposite cache rules.

text

```
                           browser / CDN cache
index.html   ── Cache-Control: no-cache ──────► stored, but revalidated on every use:
                                                 If-None-Match: W/"64-…"  →  304 (no body) or 200 (new build)
app.3f9a1c.js ─ Cache-Control: public, max-age=31536000, immutable ─► reused for a year, no request at all

deploy:  index.html now references app.9d41e2.js  →  new URL, fetched once, then cached for a year
```

`no-cache` does not mean "do not store". It means the cache must check with the server before using the stored copy. That costs a round trip and usually comes back as a `304` with no body. `max-age=31536000` is one year in seconds. Together with `immutable`, it tells the browser not to revalidate during that year. A force-reload still revalidates.

**Behind a shared cache.** A CDN, nginx `proxy_cache`, or Varnish stores a response under a cache key. By default that key is the method and the URL, not the request headers. If the body depends on a request header, say so with `Vary`. Use `Vary: Accept-Encoding` when the body may be gzipped, and `Vary: Accept` when the SPA fallback answers differently to `Accept: text/html`. Without it, the cache can hand a gzipped body to a client that did not ask for gzip, or the SPA shell to an API client. `express.static` itself sends no `Vary`. Example 7 shows that `compression` adds one. `trust proxy` does not change static headers. It only changes whether `req.protocol`, `req.ip`, and `req.hostname` are read from `X-Forwarded-*` headers.

> ⚠️ Unverified: how specific CDNs (CloudFront, Cloudflare, Fastly) build their cache keys, which `Vary` values they honour, and whether they keep `immutable`. No CDN was available to test. The behaviour above is what RFC 9111 specifies; check your CDN's documentation for its defaults.

**Security.** send refuses `..` after decoding, with `403`, and a malformed or NUL path, with `400`. It never lists directories. That is a separate package, `serve-index`. send follows symlinks. In a separate run, a `public/link.txt` symlink pointing at `../secret.txt` was served as `200` with the body `TOP SECRET`, so never let anything create links inside the root. `express.static('.')` publishes your source, `package.json`, and the rest of the project directory. Example 6 attacks the checks with `curl --path-as-is`. Lesson 42's appendix builds the same checks by hand.

## Code examples

Every example serves the same directory. Create it once:

bash

```
# setup.sh: a public/ directory with an SPA shell, hashed assets, a dotfile and a dot-directory
mkdir -p public/assets public/docs public/.well-known
printf '<!doctype html><title>app</title><div id="root"></div><script src="/assets/app.3f9a1c.js"></script>\n' > public/index.html
echo 'console.log("app v1")' > public/assets/app.3f9a1c.js
echo 'body{margin:0}' > public/assets/styles.8b2e07.css
printf '<!doctype html><title>about</title>\n' > public/about.html
echo 'guide text' > public/docs/guide.txt
echo 'DB_PASSWORD=hunter2' > public/.env
echo 'Contact: mailto:security@example.com' > public/.well-known/security.txt
echo 'TOP SECRET' > secret.txt
```

Install with `npm install express@5 supertest`. The servers listen on fixed ports so the `curl` commands can reach them. Start each with `node <file>` in one terminal and run the commands in another. `ETag` and `Last-Modified` values come from your files' mtimes, so yours will differ.

**Example 1 — mounting at the root and under a prefix, redirects, no listings.**

javascript

```
// basic.mjs: express.static at the root and mounted under /static, then a 404 route.
import express from 'express';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));   // absolute path
const app = express();

app.use(express.static(PUBLIC));                // GET /about.html -> public/about.html
app.use('/static', express.static(PUBLIC));     // GET /static/about.html -> public/about.html
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use((req, res) => res.status(404).type('text').send(`no route for ${req.method} ${req.originalUrl}\n`));

app.listen(5601, () => console.log('listening on 5601'));

// Real output (Node v24.19.0, Express 5.3.0):
//   listening on 5601
```

bash

```
$ curl -si http://127.0.0.1:5601/about.html
HTTP/1.1 200 OK
X-Powered-By: Express
Accept-Ranges: bytes
Cache-Control: public, max-age=0
Last-Modified: Sat, 10 Oct 2026 16:02:11 GMT
ETag: W/"24-1a1268cea9e"
Content-Type: text/html; charset=utf-8
Content-Length: 36
Date: Sat, 10 Oct 2026 16:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=5

<!doctype html><title>about</title>
$ curl -si http://127.0.0.1:5601/static/assets/styles.8b2e07.css | grep -iE '^(HTTP|content-type|etag)'
HTTP/1.1 200 OK
ETag: W/"f-1a1268cea9e"
Content-Type: text/css; charset=utf-8
$ curl -si http://127.0.0.1:5601/docs | grep -iE '^(HTTP|location)'
HTTP/1.1 301 Moved Permanently
Location: /docs/
$ curl -si http://127.0.0.1:5601/static | grep -iE '^(HTTP|location)'
HTTP/1.1 301 Moved Permanently
Location: /static/
$ curl -s -w '%{http_code}\n' http://127.0.0.1:5601/docs/
no route for GET /docs/
404
$ curl -s -w '%{http_code}\n' -X POST http://127.0.0.1:5601/about.html
no route for POST /about.html
404
$ curl -s http://127.0.0.1:5601/api/health
{"ok":true}
```

The weak ETag `W/"24-1a1268cea9e"` is the size (0x24 = 36 bytes) and the mtime in milliseconds, both in hex. `Cache-Control: public, max-age=0` is the default: caches may store the file but must revalidate it. `/docs` is a directory, so it is redirected to `/docs/`. Under the prefix, the `Location` keeps `/static`. `/docs/` has no `index.html`, so the request falls through to the 404 route instead of producing a listing, and so does the `POST`.

**Example 2 — the options, one mount each.**

javascript

```
// options.mjs: the same public/ directory mounted six times with different options.
import express from 'express';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));
const app = express();

app.use('/ext', express.static(PUBLIC, { extensions: ['html'] }));          // /ext/about -> about.html
app.use('/noindex', express.static(PUBLIC, { index: false, redirect: false }));
app.use('/nocache', express.static(PUBLIC, { etag: false, lastModified: false, maxAge: '1h' }));
app.use('/hdr', express.static(PUBLIC, {
  setHeaders(res, path, stat) {                  // runs synchronously, only when a file is about to be sent
    res.set('X-File-Size', String(stat.size));
    if (path.endsWith('.txt')) res.set('Content-Type', 'text/plain; charset=utf-8');
  },
}));
app.use('/strict', express.static(PUBLIC, { fallthrough: false }));
app.use('/deny', express.static(PUBLIC, { dotfiles: 'deny' }));                    // 403, but falls through
app.use('/deny-strict', express.static(PUBLIC, { dotfiles: 'deny', fallthrough: false }));

app.use((req, res) => res.status(404).type('text').send(`404 route: ${req.method} ${req.originalUrl}\n`));
app.use((err, req, res, next) => {
  // err.message for a missing file contains the absolute path on disk: log it, never send it
  res.status(err.status ?? 500).type('text').send(`error handler: ${err.status} ${err.code ?? err.message}\n`);
});

app.listen(5602, () => console.log('listening on 5602'));

// Real output (Node v24.19.0, Express 5.3.0):
//   listening on 5602
```

bash

```
$ curl -si http://127.0.0.1:5602/ext/about | grep -iE '^(HTTP|content-type)'
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
$ curl -si http://127.0.0.1:5602/noindex/ | grep -iE '^HTTP|route'
HTTP/1.1 404 Not Found
404 route: GET /noindex/
$ curl -si http://127.0.0.1:5602/noindex/docs | grep -iE '^(HTTP|location)|route'
HTTP/1.1 404 Not Found
404 route: GET /noindex/docs
$ curl -sI http://127.0.0.1:5602/nocache/about.html | grep -iE '^(HTTP|cache-control|etag|last-modified)'
HTTP/1.1 200 OK
Cache-Control: public, max-age=3600
$ curl -sI http://127.0.0.1:5602/hdr/docs/guide.txt | grep -iE '^(HTTP|content-type|x-file-size)'
HTTP/1.1 200 OK
X-File-Size: 11
Content-Type: text/plain; charset=utf-8
$ curl -si http://127.0.0.1:5602/strict/missing.js | grep -iE '^HTTP|handler|route'
HTTP/1.1 404 Not Found
error handler: 404 ENOENT
$ curl -si -X POST http://127.0.0.1:5602/strict/about.html | grep -iE '^(HTTP|allow)|handler|route'
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
$ curl -si http://127.0.0.1:5602/deny/.env | grep -iE '^HTTP|handler|route'
HTTP/1.1 404 Not Found
404 route: GET /deny/.env
$ curl -si http://127.0.0.1:5602/deny-strict/.env | grep -iE '^HTTP|handler|route'
HTTP/1.1 403 Forbidden
error handler: 403 Forbidden
$ curl -si http://127.0.0.1:5602/deny-strict/.well-known/security.txt | grep -iE '^HTTP|handler|route'
HTTP/1.1 403 Forbidden
error handler: 403 Forbidden
```

- `extensions: ['html']` gives clean URLs (`/ext/about`) without a route per page.
- `index: false` plus `redirect: false` makes directories invisible: `/noindex/` and `/noindex/docs` both fall through.
- With `etag` and `lastModified` off, the response has no validator, so a cache that wants to reuse it after `max-age=3600` must download it again in full.
- `setHeaders` ran before send's own headers, so its `Content-Type` won.
- `fallthrough: false` turns a missing file into `next(err)` with `err.status` 404 and `err.code` `ENOENT`, and answers `405` with `Allow` to other methods.
- `dotfiles: 'deny'` only shows up as a `403` when `fallthrough` is `false`. With the default `fallthrough: true`, serve-static turns every status below 500 into `next()`, so the 404 route answered.

**Example 3 — hashed assets for a year, HTML revalidated, and the 304s.**

javascript

```
// cache.mjs: hashed assets cached for a year as immutable; HTML revalidated on every use.
import express from 'express';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));
const app = express();

// 1. Fingerprinted files (name contains a content hash): a new build gets a new name.
app.use('/assets', express.static(`${PUBLIC}/assets`, {
  maxAge: '1y',          // ms-format string; send caps maxAge at one year
  immutable: true,       // adds the immutable directive
  fallthrough: false,    // a missing asset is a 404 here, never the SPA shell
}));

// 2. Everything else, HTML included: store it, but revalidate before every reuse.
app.use(express.static(PUBLIC, {
  setHeaders(res, path) {
    if (path.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));

app.use((err, req, res, next) => res.status(err.status ?? 500).type('text').send(`${err.status}\n`));
app.listen(5603, () => console.log('listening on 5603'));

// Real output (Node v24.19.0, Express 5.3.0):
//   listening on 5603
```

bash

```
# cond.sh: conditional requests that send back the validators the server gave us.
etag=$(curl -sI http://127.0.0.1:5603/ | tr -d '\r' | sed -n 's/^ETag: //p')
lm=$(curl -sI http://127.0.0.1:5603/ | tr -d '\r' | sed -n 's/^Last-Modified: //p')
echo "If-None-Match: $etag"
curl -si -H "If-None-Match: $etag" http://127.0.0.1:5603/ | grep -iE '^(HTTP|cache-control|etag|content-length)'
echo "If-Modified-Since: $lm"
curl -si -H "If-Modified-Since: $lm" http://127.0.0.1:5603/ | grep -iE '^(HTTP|content-length)'
echo "stale ETag:"
curl -si -H 'If-None-Match: W/"0-0"' http://127.0.0.1:5603/ | grep -iE '^(HTTP|content-length)'
```

bash

```
$ curl -sI http://127.0.0.1:5603/assets/app.3f9a1c.js | grep -iE '^(HTTP|cache-control|etag|last-modified)'
HTTP/1.1 200 OK
Cache-Control: public, max-age=31536000, immutable
Last-Modified: Sat, 10 Oct 2026 16:02:11 GMT
ETag: W/"16-1a1268cea9e"
$ curl -sI http://127.0.0.1:5603/ | grep -iE '^(HTTP|cache-control|etag|last-modified)'
HTTP/1.1 200 OK
Cache-Control: no-cache
Last-Modified: Sat, 10 Oct 2026 16:02:11 GMT
ETag: W/"64-1a1268cea9e"
$ bash cond.sh
If-None-Match: W/"64-1a1268cea9e"
HTTP/1.1 304 Not Modified
Cache-Control: no-cache
ETag: W/"64-1a1268cea9e"
If-Modified-Since: Sat, 10 Oct 2026 16:02:11 GMT
HTTP/1.1 304 Not Modified
stale ETag:
HTTP/1.1 200 OK
Content-Length: 100
$ curl -si http://127.0.0.1:5603/assets/app.0ld0ld.js | grep -iE '^(HTTP|content-type)'
HTTP/1.1 404 Not Found
Content-Type: text/plain; charset=utf-8
```

`'1y'` became `max-age=31536000`. The ms package counts a year as 365.25 days, and send caps `maxAge` at 365 days, so the cap is what produced exactly one year in seconds. The HTML response keeps the `Cache-Control: no-cache` that `setHeaders` set, because send only fills in `Cache-Control` when it is still unset. Revalidating `index.html` with either validator returned `304` with no body. A changed ETag returned the full 100 bytes. A missing hashed asset is a plain 404, never `index.html`.

**Example 4 — the SPA history fallback, wrong and right.**

A client-side router owns URLs like `/dashboard/settings` that do not exist on disk, so a reload of that URL must still get `index.html`. The fallback is a middleware after `express.static` and the API. The question is which requests it should catch.

javascript

```
// spa.mjs: two SPA history fallbacks. "wrong" (port 5604) catches everything; "right" (port 5605) is narrow.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('./public', import.meta.url));

function api() {
  const r = express.Router();
  r.get('/users', (req, res) => res.json([{ id: 1 }]));
  return r;
}

// WRONG: every GET that nothing else answered gets index.html with status 200.
const wrong = express();
wrong.use(express.static(PUBLIC));
wrong.use('/api', api());
wrong.get('/{*splat}', (req, res) => res.sendFile('index.html', { root: PUBLIC }));
wrong.listen(5604);

// RIGHT: only browser navigations to extension-less, non-API paths get the shell.
function spaFallback(root) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/api' || req.path.startsWith('/api/')) return next();
    if (path.posix.extname(req.path) !== '') return next();       // /app.js, /favicon.ico, /x.map
    res.vary('Accept');                                            // the answer depends on Accept
    const accept = req.get('Accept') ?? '';
    if (!accept.includes('text/html')) return next();              // fetch()/XHR send */* by default
    res.set('Cache-Control', 'no-cache');
    res.sendFile('index.html', { root });
  };
}

const right = express();
right.use(express.static(PUBLIC));
right.use('/api', api());
right.use(spaFallback(PUBLIC));
right.use((req, res) => res.status(404).type('text').send(`404 ${req.originalUrl}\n`));
right.listen(5605, () => console.log('wrong on 5604, right on 5605'));

// Real output (Node v24.19.0, Express 5.3.0):
//   wrong on 5604, right on 5605
```

bash

```
# spa-test.sh: the same five requests against both servers; print status, content type and Vary.
set -f   # keep */* from being expanded as a glob
for port in 5604 5605; do
  echo "== port $port"
  for req in "GET /dashboard/settings text/html" "GET /assets/app.0ld0ld.js */*" \
             "GET /api/nope text/html" "GET /dashboard/settings */*" "POST /dashboard/settings text/html"; do
    set -- $req
    curl -s -o /dev/null -X "$1" -H "Accept: $3" \
      -w "$1 $2 (Accept: $3) -> %{http_code} %{content_type} vary=%header{vary}\n" "http://127.0.0.1:$port$2"
  done
done
```

bash

```
$ bash spa-test.sh
== port 5604
GET /dashboard/settings (Accept: text/html) -> 200 text/html; charset=utf-8 vary=
GET /assets/app.0ld0ld.js (Accept: */*) -> 200 text/html; charset=utf-8 vary=
GET /api/nope (Accept: text/html) -> 200 text/html; charset=utf-8 vary=
GET /dashboard/settings (Accept: */*) -> 200 text/html; charset=utf-8 vary=
POST /dashboard/settings (Accept: text/html) -> 404 text/html; charset=utf-8 vary=
== port 5605
GET /dashboard/settings (Accept: text/html) -> 200 text/html; charset=utf-8 vary=Accept
GET /assets/app.0ld0ld.js (Accept: */*) -> 404 text/plain; charset=utf-8 vary=
GET /api/nope (Accept: text/html) -> 404 text/plain; charset=utf-8 vary=
GET /dashboard/settings (Accept: */*) -> 404 text/plain; charset=utf-8 vary=Accept
POST /dashboard/settings (Accept: text/html) -> 404 text/plain; charset=utf-8 vary=
```

The wrong version answers the old script URL `/assets/app.0ld0ld.js` with `200 text/html`. That happens after every deploy, when a browser that still has the previous `index.html` asks for a file the new build deleted. The browser receives HTML where it expected JavaScript, and a monitoring check sees a 200 instead of a 404. `/api/nope` also gets the HTML shell, so a client calling `res.json()` fails on `<!doctype`. The right version only answers navigations: `GET`/`HEAD`, outside `/api`, no file extension, and `Accept` containing `text/html`, which browsers send for page loads. It checks the header text instead of `req.accepts('html')`, because `req.accepts` also says yes to `*/*` and to a missing `Accept` header. `Vary: Accept` tells shared caches that the same URL has two different answers.

**Example 5 — edge case: the dotfiles default, Express 5 vs Express 4.**

The serve-static README calls a "dotfile" any file *or directory* whose name starts with a dot. The question is what each version does by default with `/.env` (a dotfile) and `/.well-known/security.txt` (a normal file inside a dot-directory). Both are run here against the same directory.

javascript

```
// dotfiles.cjs: the default dotfiles behaviour of express.static, Express 5 vs Express 4.
// npm install express@5 express4@npm:express@4 supertest
const path = require('node:path');
const request = require('supertest');
const PUBLIC = path.join(__dirname, 'public');

const versions = { 'Express 5': require('express'), 'Express 4': require('express4') };
const paths = ['/.env', '/.well-known/security.txt'];

(async () => {
  for (const [label, express] of Object.entries(versions)) {
    const v = require(label === 'Express 5' ? 'express/package.json' : 'express4/package.json').version;
    const app = express();
    app.use(express.static(PUBLIC));                       // defaults only
    for (const p of paths) {
      const res = await request(app).get(p);
      console.log(`${label} (${v}) default  GET ${p.padEnd(26)} -> ${res.status} ${res.status === 200 ? JSON.stringify(res.text.trim()) : ''}`);
    }
  }
  // Express 5: opt in for one dot-directory only (the migration guide's pattern)
  const express = require('express');
  const app = express();
  app.use('/.well-known', express.static(path.join(PUBLIC, '.well-known'), { dotfiles: 'allow' }));
  app.use(express.static(PUBLIC));
  for (const p of paths) {
    const res = await request(app).get(p);
    console.log(`Express 5 + /.well-known allow  GET ${p.padEnd(26)} -> ${res.status}`);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0 and 4.22.3, supertest 7.3.1):
//   Express 5 (5.3.0) default  GET /.env                      -> 404 
//   Express 5 (5.3.0) default  GET /.well-known/security.txt  -> 404 
//   Express 4 (4.22.3) default  GET /.env                      -> 404 
//   Express 4 (4.22.3) default  GET /.well-known/security.txt  -> 200 "Contact: mailto:security@example.com"
//   Express 5 + /.well-known allow  GET /.env                      -> 404
//   Express 5 + /.well-known allow  GET /.well-known/security.txt  -> 200
```

Express 4 did not serve `/.env` by default either. Its default (serve-static 1.16.3) is documented as "similar to `'ignore'`, with the exception that this default will not ignore the files within a directory that begins with a dot". So the real Express 4 exposure was dot-*directories*: a `.git/` or `.well-known/` inside the served folder was readable. Express 5 (serve-static 2) makes `'ignore'` the real default for every segment (changed in Express 5). That breaks anything that relied on `.well-known` being served, such as ACME challenges or app-link files. Fix it by mounting that one directory with `dotfiles: 'allow'`, not by allowing dotfiles everywhere. The check only looks at segments *below* the root: a root that is itself inside a dot-directory still works.

**Example 6 — path-traversal attempts with `curl --path-as-is`.**

curl removes `/../` from a URL before sending it unless you pass `--path-as-is`. These requests go to the `/strict` mount from Example 2 (port 5602), where `fallthrough: false` makes send's verdict visible through the error handler:

bash

```
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/../secret.txt
error handler: 403 Forbidden
403
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/%2e%2e/secret.txt
error handler: 403 Forbidden
403
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/..%2fsecret.txt
error handler: 403 Forbidden
403
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/assets/..%2f..%2f..%2fsecret.txt
error handler: 403 Forbidden
403
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/..%5csecret.txt
error handler: 403 Forbidden
403
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/about.html%00.txt
error handler: 400 Bad Request
400
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/%E0%A4%A
error handler: 400 Bad Request
400
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5602/strict/assets/..%2fabout.html
<!doctype html><title>about</title>
200
```

And the same kind of request against the default `fallthrough: true` mount from Example 1 (port 5601):

bash

```
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5601/../secret.txt
no route for GET /../secret.txt
404
$ curl -s --path-as-is -w '%{http_code}\n' http://127.0.0.1:5601/static/..%2f..%2fsecret.txt
no route for GET /static/..%2f..%2fsecret.txt
404
```

Literal `..`, `%2e%2e`, encoded slashes (`%2f`) and encoded backslashes (`%5c`) are all decoded first and then refused with `403`, because send checks for a `..` segment after decoding and normalizing. A NUL byte and a broken escape are `400`. A `..` that stays inside the root (`assets/../about.html`) is normalized and served. With the default `fallthrough: true` every refusal becomes `next()`, so the attacker just sees your 404 route and cannot tell a blocked path from a missing one. The secret was never sent. Lesson 42's appendix builds the same checks by hand ([A safe path-traversal guard](42-manual-routing-serving-json.md#a-safe-path-traversal-guard)); `express.static` saves you writing them, but not from choosing the wrong root.

**Example 7 — `Vary`, compression and `trust proxy`.**

javascript

```
// proxy.cjs: what a cache in front of Express sees (Vary), and what `trust proxy` changes.
// npm install express@5 compression supertest
const path = require('node:path');
const express = require('express');
const compression = require('compression');
const request = require('supertest');
const PUBLIC = path.join(__dirname, 'public');

function makeApp(trust) {
  const app = express();
  if (trust !== undefined) app.set('trust proxy', trust);
  app.use(compression({ threshold: 0 }));           // compress even tiny files, for the demo
  app.use(express.static(PUBLIC, { maxAge: '1y', immutable: true }));
  app.get('/whoami', (req, res) => res.json({ protocol: req.protocol, ip: req.ip, host: req.hostname, secure: req.secure }));
  return app;
}

(async () => {
  const app = makeApp();
  const gz = await request(app).get('/assets/app.3f9a1c.js').set('Accept-Encoding', 'gzip');
  const plain = await request(app).get('/assets/app.3f9a1c.js').set('Accept-Encoding', 'identity');
  for (const [label, r] of [['gzip    ', gz], ['identity', plain]]) {
    console.log(label, r.status, 'content-encoding:', r.headers['content-encoding'] ?? '-',
      '| vary:', r.headers.vary, '| etag:', r.headers.etag);
  }

  const fwd = { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Host': 'cdn.example.com' };
  for (const trust of [undefined, 'loopback', true]) {
    const r = await request(makeApp(trust)).get('/whoami').set(fwd);
    console.log(`trust proxy ${String(trust).padEnd(9)} ->`, r.text);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, compression 1.8.2, supertest 7.3.1):
//   gzip     200 content-encoding: gzip | vary: Accept-Encoding | etag: W/"16-1a1268cea9e"
//   identity 200 content-encoding: - | vary: Accept-Encoding | etag: W/"16-1a1268cea9e"
//   trust proxy undefined -> {"protocol":"http","ip":"127.0.0.1","host":"127.0.0.1","secure":false}
//   trust proxy loopback  -> {"protocol":"https","ip":"203.0.113.7","host":"cdn.example.com","secure":true}
//   trust proxy true      -> {"protocol":"https","ip":"203.0.113.7","host":"cdn.example.com","secure":true}
```

`compression` adds `Vary: Accept-Encoding` to both the gzipped and the plain response, so a shared cache stores two variants under one URL. Both carry the same weak ETag, which is allowed: a weak tag only claims the two bodies are equivalent, not byte-identical. The static file headers are the same with or without `trust proxy`. The setting only changes what `req.protocol`, `req.ip` and `req.hostname` report. Trust only the proxies you actually run behind (`'loopback'`, a subnet, or a hop count); `true` believes any client that sends the header.

## Common mistakes & gotchas

- **A relative root.** `express.static('public')` is resolved from `process.cwd()`, not from the file that calls it. Start the app from another directory and every file is a 404. Build the root from `import.meta.url` or `__dirname`.
- **Serving the project directory.** `express.static('.')` or `express.static(__dirname)` publishes `package.json` and the source. Serve a dedicated `public/` or `dist/` folder.
- **A catch-all SPA fallback.** `app.get('/{*splat}', sendIndex)` turns every missing asset and every unknown API route into `200` with `text/html`. Example 4 shows it.
- **A long `maxAge` on a file whose name does not change.** `maxAge: '1y'` on `index.html` or `logo.png` keeps the old copy for a year. Only fingerprinted names can be cached that long.
- **Expecting `dotfiles: 'deny'` to produce a 403.** With the default `fallthrough: true`, that 403 becomes `next()` and your 404 route answers.
- **Losing `.well-known` on the way to Express 5.** Dot-directories are ignored by default. Mount that one directory with `dotfiles: 'allow'`.
- **Sending `err.message` to the client.** For a missing file it contains the absolute path on disk.
- **Putting `express.static` after heavy middleware.** Every asset then runs body parsers, session lookups, and auth. Register it early, unless the files are private.
- **Using `express.static` for user uploads.** An upload may be HTML or SVG that runs script on your origin. Serve it from another origin, or with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Lesson 56 covers the header.

## Best practices

- Two mounts for an SPA. `/assets` gets `maxAge: '1y'`, `immutable: true`, and `fallthrough: false`. HTML gets `Cache-Control: no-cache` through `setHeaders`.
- A narrow history fallback: GET or HEAD, not under `/api`, no file extension, and `Accept` contains `text/html`. Send `Vary: Accept`.
- An absolute root, from `fileURLToPath(new URL('./public', import.meta.url))` or `path.join(__dirname, 'public')`.
- Keep the default `dotfiles: 'ignore'`. Opt in per directory, such as `/.well-known`, with `dotfiles: 'allow'`.
- Use `fallthrough: false` on a mount that is only a directory, such as `/assets`, so a miss is a real 404 and other methods get 405.
- Put a CDN or reverse proxy in front for heavy static traffic, and send `Vary` for every request header the response depends on.
- Set `trust proxy` to the proxies you run, not `true`, when you rely on `req.protocol` or `req.ip`.

## ⭐ Interview lens

> **Q: “What does `express.static` do when the file does not exist?”**  
> A: With the default `fallthrough: true`, a missing file calls `next()`. Later middleware and routes still see the request, which is how a 404 handler or an SPA fallback can run. `express.static` only handles GET and HEAD. Anything else also falls through. Set `fallthrough: false` and a miss becomes `next(err)` with `err.status` 404, and other methods get `405` with `Allow: GET, HEAD`. The trap is that fallthrough does not only hide 404s. A `403` from `dotfiles: 'deny'`, or from a `..` path, is also turned into `next()` when the status is below 500. The client then sees your normal 404 and cannot tell a blocked path from a missing file.

> **Q: “How would you cache a built React or Vue app?”**  
> A: A bundler puts a content hash in each asset filename, so `app.3f9a1c.js` never changes until the bytes change, and then the name changes. Give those files `Cache-Control: public, max-age=31536000, immutable`. 31536000 is one year in seconds. The browser can reuse the file all year without asking again. Give `index.html` `no-cache`, so every load revalidates. Until a deploy changes the file, that revalidation is a cheap `304` with no body. After a deploy, the new HTML points at new asset URLs, which are fetched once and cached again. The trap is the word `no-cache`. It still allows storing. `no-store` is the directive that forbids a stored copy. Do not put a year-long max age on HTML or on any file whose name stays the same.

> **Q: “Your SPA fallback serves `index.html` for unknown paths. What can go wrong?”**  
> A: A client-side router owns URLs such as `/dashboard/settings` that are not files, so a reload must still get `index.html`. If that fallback is "any unknown path", three things break. A browser that still has the previous HTML asks for `/assets/app.0ld0ld.js`, which the new build deleted, and gets `200` with `text/html` instead of JavaScript. An unknown `/api` route gets the HTML shell, so the client fails while parsing JSON. A shared cache can store that HTML for a URL an API client also requests. Limit the fallback to GET and HEAD, skip `/api`, skip any path with a file extension, and require `Accept` to contain `text/html`. Check the header text rather than `req.accepts('html')`, because `req.accepts` also says yes to `*/*` and to a missing `Accept` header. Send `Vary: Accept`.

> **Q: “Can `GET /..%2f..%2fetc/passwd` escape `express.static`'s root?”**  
> A: No. send decodes the path, normalizes it, and refuses any `..` segment that would still climb out of the root, with status 403. A NUL byte or a broken percent-escape is 400. The same refusal covers `%2e%2e`, an encoded slash `%2f`, and an encoded backslash `%5c`, because the check runs after decoding. A `..` that stays inside the root, such as `assets/../about.html`, is normalized and served. With `fallthrough: true` the 403 becomes `next()`, so the client just sees your 404. The real ways out are choosing the wrong root, such as `'.'`, which publishes the project, or a symlink inside the root that points outside it. send follows symlinks. In a separate run a link to `../secret.txt` was served.

## Cheat-card

- `express.static(root, opts)` is serve-static, which calls send. Express 5.3.0 uses serve-static 2.2.1 and send 1.2.1. Express 4.22.3 uses serve-static 1.16.3 and send 0.19.2.
- Only GET and HEAD. A miss calls `next()`. `fallthrough: false` turns a miss into `next(err)` with 404, and other methods get 405.
- Defaults: `index` is `index.html`, `redirect` is true so a directory becomes a 301 to `dir/`, `etag` is a weak tag from size and mtime, `lastModified` is true, `maxAge` is 0, `acceptRanges` is true, `cacheControl` is true, `immutable` is false, `extensions` is false, `dotfiles` is `'ignore'`.
- It never lists a directory.
- `app.use('/static', express.static(dir))` strips the prefix from `req.url`.
- Hashed assets: `maxAge: '1y'` and `immutable: true` become `public, max-age=31536000, immutable`. HTML gets `no-cache` from `setHeaders`. Revalidation is a 304.
- `setHeaders(res, path, stat)` runs first. send does not overwrite a `Cache-Control` you already set.
- SPA fallback: GET or HEAD, not `/api`, no extension, `Accept` contains `text/html`, and `Vary: Accept`.
- Dot-directories are ignored too, which changed in Express 5. Mount `/.well-known` with `dotfiles: 'allow'`.
- Traversal: `..`, including `%2e%2e`, `..%2f`, and `..%5c`, is 403. A NUL or a bad escape is 400. Under fallthrough those become `next()`.
- A shared cache keys on the URL. Declare header dependencies with `Vary`. `trust proxy` changes `req.protocol`, `req.ip`, and `req.hostname`, not the static headers.

## Good to know

- What changed about dotfiles in Express 5? serve-static 2 applies `dotfiles: 'ignore'` to every path segment below the root, so a file inside a dot-directory such as `.well-known` is a 404 by default. In Express 4, with serve-static 1.16.3, `.env` was already hidden, but files inside a dot-directory were served. The documented Express 4 exception was that the default would not ignore files within a directory whose name starts with a dot. Opt in per directory with `dotfiles: 'allow'`. The check only looks at segments below the root, so a root that itself sits inside a dot-directory still works.
- `'1y'` becomes `max-age=31536000` because the ms package counts a year as 365.25 days and send then caps `maxAge` at 365 days.

## Learn More

- [express.static() (5.x API) expressjs.com](https://expressjs.com/en/5x/api/express/)
- [Serving static files in Express expressjs.com](https://expressjs.com/en/starter/static-files.html)
- [Migrating to Express 5 (express.static dotfiles) expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Express behind proxies expressjs.com](https://expressjs.com/en/guide/behind-proxies.html)
- [serve-static README github.com](https://github.com/expressjs/serve-static)
- [send README github.com](https://github.com/pillarjs/send)
- [Cache-Control developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
- [Vary developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Vary)
- [RFC 9111 HTTP Caching rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9111.html)
- [RFC 8246 HTTP Immutable Responses rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8246.html)
