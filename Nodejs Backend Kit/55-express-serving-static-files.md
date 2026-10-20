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

## Why it matters

Almost every Express app sends some files straight from disk: a built single-page app (SPA), images, a `robots.txt`, a `.well-known/security.txt`. Lesson 42's appendix built a static file server by hand and showed how many details it needs: MIME types, streaming, `..` segments, dotfiles, directory requests. `express.static` does all of that in one line, so most apps use it. The bugs come from the settings around it:

- **Stale apps after a deploy.** If HTML is cached for an hour, users keep loading the old `index.html`, which points at JavaScript files the new build deleted.
- **Endless revalidation.** If nothing is cached, every page view re-requests every asset.
- **A history fallback that returns HTML for everything.** A missing `/assets/app.0ld0ld.js` gets `200 text/html`, so the browser receives HTML where it expected a script, and API clients get the SPA shell instead of a JSON 404.
- **Leaking files.** Before Express 5, a dot-directory such as `.git/` inside the served folder was served by default.

## The concept, simply

`express.static(root, options)` returns a middleware function. For a `GET` or `HEAD` request it takes the request path (after any mount prefix), resolves it under `root`, and if a regular file is there it streams that file with `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Cache-Control` and `Accept-Ranges` headers. If there is no such file it calls `next()`, so later middleware and routes still get the request. That one property, "serve it if it exists, otherwise step aside", is what makes static serving fit into the middleware pipeline from lesson 49.

Express does not implement this itself. `express.static` is the [serve-static](https://github.com/expressjs/serve-static) package (2.2.1 under Express 5.3.0; 1.16.3 under Express 4.22.3), and serve-static hands each file to the [send](https://github.com/pillarjs/send) package (1.2.1 under Express 5.3.0; 0.19.2 under Express 4.22.3), which does the path checks, the conditional-request logic and the streaming. `res.sendFile` uses the same `send` package (lesson 56).

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

What happens for `GET /static/assets/app.3f9a1c.js` with `app.use('/static', express.static(PUBLIC))`:

1. **Mount matching.** The router sees the `/static` prefix, strips it, and calls the middleware with `req.url` set to `/assets/app.3f9a1c.js` (`req.originalUrl` keeps the full path).
2. **Method check.** Anything other than `GET` or `HEAD` goes to `next()`. With `fallthrough: false` it gets `405` and `Allow: GET, HEAD` instead.
3. **Path decoding and checks (in send).** The path is percent-decoded. A malformed escape or a NUL byte gives `400`. The path is then joined to the root and normalized, and if a `..` segment would still be left (an attempt to climb out of the root) the result is `403`. Then the dotfiles rule is applied to every segment of the path below the root.
4. **`stat()`.** A missing file is `404` inside send, which serve-static turns into `next()`. A directory without a trailing slash gets a `301` to the same path plus `/` (option `redirect`). A directory with a trailing slash is retried with `index.html` (option `index`). If there is no index file, the request goes to `next()`. No directory listing is ever generated.
5. **Headers.** `setHeaders(res, path, stat)` runs first, then send fills in whatever is still unset: `Accept-Ranges: bytes`, `Cache-Control: public, max-age=<maxAge in seconds>` (plus `, immutable`), `Last-Modified` from the file's mtime, and a weak `ETag` built from size and mtime (`W/"<size hex>-<mtime ms hex>"`). `Content-Type` comes from the extension.
6. **Freshness and ranges.** If `If-None-Match` matches the ETag, or `If-Modified-Since` is not older than the mtime, the answer is `304` with no body. A valid `Range` header gives `206` (lesson 56 shows ranges in detail).
7. **Streaming.** The file is piped from an `fs.createReadStream`, so a large file is never read into memory all at once.

**The options (serve-static 2.2.1 README).**

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

**Cache headers for a built SPA.** A bundler such as Vite or webpack puts a hash of the content in each asset's filename (`app.3f9a1c.js`). A file with a given name therefore never changes. When the code changes, the file gets a new name and `index.html` points at it. That gives two classes of file with opposite rules:

text

```
                           browser / CDN cache
index.html   ── Cache-Control: no-cache ──────► stored, but revalidated on every use:
                                                 If-None-Match: W/"64-…"  →  304 (no body) or 200 (new build)
app.3f9a1c.js ─ Cache-Control: public, max-age=31536000, immutable ─► reused for a year, no request at all

deploy:  index.html now references app.9d41e2.js  →  new URL, fetched once, then cached for a year
```

`no-cache` does not mean "do not store". RFC 9111 §5.2.2.4 says it means the cache must not use the stored copy without validating it with the server first, which costs a round trip but usually returns a body-less `304`. `max-age=31536000` (one year in seconds) plus `immutable` (RFC 8246) tells the browser not to revalidate during that year. RFC 8246 says clients "SHOULD NOT issue a conditional request during the response's freshness lifetime (e.g., upon a reload)"; a force-reload still revalidates.

**Behind a CDN or reverse proxy.** A shared cache (CDN, nginx `proxy_cache`, Varnish) stores a response under a *cache key*. By default that key is the method and the URL (often including the host), not the request headers. If the response depends on a request header, the server has to say so with `Vary`, for example `Vary: Accept-Encoding` when the body may be gzipped and `Vary: Accept` when the SPA fallback answers differently to `Accept: text/html`. Without it, the cache can hand a gzipped body to a client that did not ask for gzip, or the SPA shell to an API client. `express.static` itself sends no `Vary` header (Example 7 shows that `compression` adds one). Express's `trust proxy` setting does not affect `express.static` at all. It decides whether `req.protocol`, `req.ip` and `req.hostname` are read from `X-Forwarded-*` headers, which matters when you build absolute URLs or redirects behind the proxy (lesson 41's appendix [`X-Forwarded-For` and trust boundaries](41-parsing-requests-writing-responses.md#x-forwarded-for-and-trust-boundaries) covers the trust boundary).

> ⚠️ Unverified: how specific CDNs (CloudFront, Cloudflare, Fastly) build their cache keys, which `Vary` values they honour, and whether they keep `immutable`. No CDN was available to test. The behaviour above is what RFC 9111 specifies; check your CDN's documentation for its defaults.

**Security.** send refuses `..` after decoding (`403`) and malformed or NUL-containing paths (`400`), and it never lists directories (that is a separate package, `serve-index`). send follows symlinks: in a separate run, a `public/link.txt` symlink pointing at `../secret.txt` was served (`200 TOP SECRET`), so never let anything create links inside the root. It also does not stop you from serving the wrong folder: `express.static('.')` publishes your source code, `package.json` and anything else in the project directory. Example 6 attacks it with `curl --path-as-is`. For the hand-written version of the same checks, see lesson 42's appendix, [A safe path-traversal guard](42-manual-routing-serving-json.md#a-safe-path-traversal-guard).

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

- **A relative root.** `express.static('public')` is resolved against `process.cwd()`, not against the file that calls it. Start the app from another directory and every file is a 404. Build the root from `import.meta.url` or `__dirname`.
- **Serving the project directory.** `express.static('.')` or `express.static(__dirname)` publishes `package.json`, the source code and anything else next to it. Serve a dedicated `public/` or `dist/` folder.
- **Catch-all SPA fallback.** `app.get('/{*splat}', sendIndex)` turns every missing asset and every unknown API route into `200 text/html` (Example 4).
- **Long `max-age` on unhashed files.** `maxAge: '1y'` on `index.html` or `logo.png` means users keep the old copy for a year. Only fingerprinted names can be cached that long.
- **Expecting `dotfiles: 'deny'` to produce a 403.** With the default `fallthrough: true` the 403 becomes `next()` and your 404 route answers.
- **Upgrading to Express 5 and losing `.well-known`.** Dot-directories are now ignored by default. Mount that one directory with `dotfiles: 'allow'`.
- **Sending `err.message` to the client.** For a missing file it contains the absolute path on disk (`ENOENT: no such file or directory, stat '/srv/app/public/x.js'`).
- **Putting `express.static` after heavy middleware.** Every asset request then runs body parsers, session lookups and auth. Register static serving early, before sessions and auth, unless the files are private.
- **Using `express.static` for user uploads.** Uploaded files may be HTML or SVG that runs script in your origin. Serve them from another origin, or with `Content-Disposition: attachment` (lesson 56) and `X-Content-Type-Options: nosniff`.

## Best practices

- **Two mounts for an SPA:** `/assets` with `maxAge: '1y', immutable: true, fallthrough: false`, and the rest with `Cache-Control: no-cache` on HTML.
- **A narrow history fallback:** `GET`/`HEAD`, not `/api`, no extension, `Accept` contains `text/html`, plus `Vary: Accept`.
- **Absolute roots** from `fileURLToPath(new URL('./public', import.meta.url))` or `path.join(__dirname, 'public')`.
- **Keep the default `dotfiles: 'ignore'`** and opt in per directory (`/.well-known`) with `dotfiles: 'allow'`.
- **Use `fallthrough: false` on mounts that are only a directory** (like `/assets`), so misses are real 404s and other methods get `405`.
- **Put a CDN or reverse proxy in front for heavy static traffic**, as the Express API docs recommend, and send `Vary` for every request header your response depends on.
- **Set `trust proxy` to the proxies you run**, not `true`, if you rely on `req.protocol` or `req.ip`.

## ⭐ Interview lens

> **Q: “What does `express.static` do when the file does not exist?”**  
> A: It calls `next()`, so later middleware and routes still get the request. That is the default `fallthrough: true`. With `fallthrough: false` a miss becomes `next(err)` with `err.status` 404, and non-GET/HEAD methods get `405` with `Allow: GET, HEAD`. *Trap:* with fallthrough on, a `403` from `dotfiles: 'deny'` or a `..` path is also turned into `next()`.

> **Q: “How would you cache a built React or Vue app?”**  
> A: Hashed asset files get `Cache-Control: public, max-age=31536000, immutable`, because a changed file gets a new name. `index.html` gets `no-cache`, so the browser revalidates it on each load and gets a cheap `304` until a deploy changes it. A deploy then changes the asset URLs inside `index.html`. *Trap:* `no-cache` still allows storing; `no-store` is the one that forbids it.

> **Q: “Your SPA fallback serves `index.html` for unknown paths. What can go wrong?”**  
> A: Missing scripts after a deploy come back as `200 text/html`, API 404s turn into HTML, POSTs can get HTML, and a CDN can cache the HTML for a URL that an API client also requests. Limit it to `GET`/`HEAD`, non-`/api` paths, paths without an extension and requests whose `Accept` includes `text/html`, and send `Vary: Accept`.

> **Q: “What changed about dotfiles in Express 5?”**  
> A: serve-static 2 applies `dotfiles: 'ignore'` to every path segment below the root, so files inside dot-directories like `.well-known` are 404 by default. In Express 4, `.env` was already hidden by default, but files inside a dot-directory were served. Opt in per directory with `dotfiles: 'allow'`.

> **Q: “Can `GET /..%2f..%2fetc/passwd` escape `express.static`'s root?”**  
> A: No. send decodes the path, normalizes it, and refuses any remaining `..` segment with `403`, and a NUL byte or malformed escape with `400`. The real risks are choosing the wrong root (`.`), or symlinks inside the root that point outside it.

## Cheat-card

- **`express.static(root, opts)`** = serve-static 2.2.1 → send 1.2.1 (Express 5.3.0). Express 4.22.3: serve-static 1.16.3 → send 0.19.2.
- **Only `GET`/`HEAD`.** Miss → `next()`. `fallthrough: false` → `next(err)` (404) and `405` for other methods.
- **Defaults:** `index: 'index.html'`, `redirect: true` (dir → `301` to `dir/`), `etag: true` (weak, size-mtime), `lastModified: true`, `maxAge: 0`, `acceptRanges: true`, `cacheControl: true`, `immutable: false`, `extensions: false`, `dotfiles: 'ignore'`.
- **Never lists directories.**
- **Mount:** `app.use('/static', express.static(dir))`; the prefix is stripped from `req.url`.
- **Cache:** hashed assets `maxAge: '1y', immutable: true` → `public, max-age=31536000, immutable`; HTML `no-cache` via `setHeaders`. Revalidation → `304`.
- **`setHeaders(res, path, stat)`** runs first; send does not overwrite a `Cache-Control` you set.
- **SPA fallback:** GET/HEAD + not `/api` + no extension + `Accept` has `text/html` + `Vary: Accept`.
- **Dotfiles (changed in Express 5):** dot-directories ignored too. `/.well-known` → mount with `dotfiles: 'allow'`.
- **Traversal:** `..` (also `%2e%2e`, `..%2f`, `..%5c`) → `403`; NUL or bad escape → `400`; hidden as `next()` under fallthrough.
- **Proxies:** caches key on URL; declare header dependencies with `Vary`; `trust proxy` changes `req.protocol/ip/hostname`, not static headers.

---

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
