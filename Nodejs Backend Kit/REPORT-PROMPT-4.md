# REPORT — Prompt 4 (Express in depth, 2026-10-10)

**Scope:**
- 11 new lessons (86–96) covering everyday Express features. Each targets Express 5 and calls out Express 4 differences, which were verified by running both versions side by side.
- `## Additional topics` sections appended to lessons 34, 35, 36, 37 and 38, with new bullets added to each lesson's Cheat-card.
- README.md updated with a new "Express in depth" group; it now lists 96 lessons.

**Environment:**
- Node **v24.19.0**, npm 11.17.0, Linux x64.
- **Express 5.3.0** (npm latest), compared against Express 4.22.3 (`express4@npm:express@4`).
- Every example was run against a real running server, driven by supertest 7.3.1 or curl 8.18.0. The outputs pasted in the lessons come from those runs.

**Libraries and tools by area:**

| Area | Versions |
|---|---|
| Express 5 internals | router 2.2.0, path-to-regexp 8.4.2, body-parser 2.3.0, serve-static 2.2.1, send 1.2.1, content-disposition 2.0.1, finalhandler 2.1.1, range-parser 1.3.0, accepts 2.0.0, type-is 2.1.0, fresh 2.0.0, proxy-addr 2.0.8, qs 6.16.0 |
| Express 4 internals | path-to-regexp 0.1.13, body-parser 1.20.8, serve-static 1.16.3, send 0.19.2, range-parser 1.2.1, content-disposition 0.5.4 |
| Templates | ejs 7.0.1 (and 6.0.1 for comparison), pug 3.0.4, express-handlebars 9.0.2 (handlebars 4.7.10), parse5 8.0.1 |
| Cookies and sessions | cookie-parser 1.4.7, express-session 1.19.0 |
| Uploads | multer 2.4.0, busboy 1.6.0, file-type 22.1.1 |
| AWS SDK | @aws-sdk/client-s3, lib-storage, s3-request-presigner and s3-presigned-post, all 3.1149.0 |
| Local S3 | SeaweedFS 4.48, used because the MinIO download now returns 410 Gone ("archived") |
| Validation | zod 4.6.5 |
| Alternative frameworks | fastify 5.12.5, koa 3.2.1, @koa/router 15.7.0, @koa/bodyparser 6.1.0, hono 4.13.13, @hono/node-server 2.1.4, @hono/zod-validator 0.9.1 |
| NestJS | @nestjs/* 12.1.2, class-validator 0.15.1, class-transformer 0.5.1, reflect-metadata 0.2.2, typescript 7.0.2 |
| Benchmarking | autocannon 8.0.0 |
| Migration codemod | codemod CLI 1.18.3 with the official recipe 1.1.0; `@expressjs/codemod` 0.0.5 inspected only (deprecated) |
| Other | compression 1.8.2 |

## Files

| File | New or appended | Topics | SVGs embedded | Verification run | Unverified items |
|---|---|---|---|---|---|
| 52-express-app-settings-and-locals.md | new (Topic 86 of 96) | `app.set` and the one-argument `app.get`; enable/disable; `trust proxy` (7 forms and their effect on req.ip/ips/protocol/secure/hostname); etag; query parser (Express 5 reads it on every access, Express 4 only once); views / view engine; x-powered-by; case sensitive and strict routing; json spaces/replacer/escape; `app.locals` vs `res.locals` (leak shown with two concurrent requests); edge cases: sub-app inheritance (settings with defaults are not inherited) and settings changed after the first route | none | 10 scripts against supertest; 7 also run on 4.22.3; all 10 re-run as saved | none |
| 55-express-serving-static-files.md | new (Topic 87) | Every serve-static 2.2.1 option; mounting; directory redirects and no listings; hashed-asset `immutable` vs HTML `no-cache`, with real 304s; a wrong vs safe SPA fallback; Vary, compression and `trust proxy`; dotfiles Express 4 vs 5 (edge case: Express 4 already returned 404 for `/.env` and only served dot-directories); traversal attempts with `curl --path-as-is`; symlinks followed | none (fenced diagrams) | 7 examples and 33 curl commands re-run as saved | 1: CDN cache-key behaviour (no CDN available) |
| 59-template-engines-and-server-side-rendering.md | new (Topic 88) | `res.render`/`app.render` internals and view lookup; a custom `(filePath, options, cb)` engine; the same page in EJS, Pug and express-handlebars; layouts and partials; escaping with a real `<script>` payload, plus contexts escaping does not cover (`javascript:` href, unquoted attribute, inline script); view cache (only when `NODE_ENV` is exactly `production`); edge case: EJS 7.0.1 ignores the per-render `cache` local; locals precedence; spreading `req.query` into locals lets the client choose the layout; when SSR beats a JSON API | none (fenced diagram) | 14 blocks re-run as saved | none |
| 58-file-uploads-in-express.md | new (Topic 89) | multer memory vs disk storage, limits (fileSize inclusive), fileFilter, single/array/fields/none, MulterError handling; magic-byte checks plus file-type (a `.png`-named text file → 415); edge case: a leaked temp file, then the fix; abort and oversize handling (no partial files); busboy streamed into lib-storage `Upload` (a client abort needs the stream destroyed as well as `upload.abort()`); presigned PUT (the default CRC32 checksum gives BadDigest; `requestChecksumCalculation: 'WHEN_REQUIRED'` fixes it) and presigned POST with content-length-range (204 / 400 EntityTooLarge / 403) | none (fenced diagrams) | All blocks re-run against fresh servers and a local SeaweedFS with signatures enforced; no real AWS | none |
| 57-cookies-in-express.md | new (Topic 90) | Express without cookie-parser; signed cookies (tampered → `false`; an unsigned same-named cookie is a forgery trap); all 11 `res.cookie` options with real `Set-Cookie` headers; edge case: `clearCookie` with a mismatched path leaves the cookie alive (real curl jar); `clearCookie` + `maxAge` Express 4 vs 5; secret rotation order; relation to sessions (`connect.sid` unsigns to `req.sessionID`), linking to 50 | none (fenced diagram) | 9 blocks re-run as saved | none |
| 56-express-file-responses.md | new (Topic 91) | `res.sendFile` (root, the absolute-path TypeError, traversal leak without root vs 403 with it, client abort → ECONNABORTED); `res.download`; `res.attachment`; Content-Disposition with a real `filename*=UTF-8''…` header; streaming memory measured (200 MiB file: readFile +203 MiB vs sendFile +64 MiB); Range (206/416, multi-range → 200, If-Range); edge case: a path through `.cache/` returns 404 on Express 5 and 200 on Express 4 | none | 19 curl commands and scripts re-run as saved | none |
| 54-express-request-response-api-reference.md | new (Topic 92) | A 25-row table, one real run per row (`req.is`, accepts*, hostname/protocol/secure, ip/ips, subdomains, fresh/stale, xhr, range, sendStatus, format, type, links, vary, append, locals, headersSent, raw/text/urlencoded); worked examples: content negotiation (406), an `express.raw` webhook with HMAC and `timingSafeEqual` (valid / tampered / wrong length / missing), a health endpoint (liveness vs readiness, no-store, HEAD, 503 on shutdown); urlencoded `extended` default (Express 5 false vs Express 4 true + deprecation warning) | assets/i35_01_be4c0901.svg | 5 blocks re-run as saved; table and format examples also run on 4.22.3 | none |
| 53-express-routing-extras.md | new (Topic 93) | `app.param`/`router.param` (once per request); regex and array routes; optional `{…}` parts; Express 5 path syntax (`/*splat` is an array, `{/:id}`); real PathErrors for old patterns, which Express 4 accepts; edge case: Express 5 syntax on Express 4 gives a silent 404; mergeParams (off, on, name clash); mount stripping printed at each level; `next('route')` vs `next('router')`; `app.all`; HEAD falling back to GET | assets/i32_02_bfe22857.svg | 9 examples on 5.3.0; 6 also on 4.22.3 | none |
| 61-express-4-to-5-migration-guide.md | new (Topic 94) | Every item in the fetched official guide, each run on both versions; silent breakages (`res.json(obj, 201)` → 200, `res.send(404)` → 200 with body `404`, `redirect('back')` → `Location: back`); the async crash (Express 4 exits with code 1) vs Express 5's 500; checklist; the official codemod recipe run on a sample with the real diff, and what it misses (`'/*'`, `:id?`, `req.query` writes, etc.); edge case: the codemod rewrites `req.param('id')` to `req.params.id`, breaking query-string ids; grep audit script | assets/i34_01_6ef3f077.svg | 11 examples on both versions; codemod run under a throwaway HOME | none |
| 60-express-project-structure.md | new (Topic 95) | Layer-based vs feature-based layouts; the controller/service/repository dependency rule; a zod config module that fails fast; error module and central handler; a `createApp(deps)` factory (no listen; `getActiveResourcesInfo()` → `[]`); hand-written DI; a complete notes API built and run (real tree, 14/14 tests, curl session); edge case: the same project on Express 4 hangs in tests (exit 124); a dependency-rule test | assets/i56_01_dc096a03.svg | Project rebuilt from the lesson's own blocks (15 files byte-identical), tests and curl re-run | none |
| 62-express-alternatives-nestjs-fastify-koa-hono.md | new (Topic 96) | The same API (health, validated POST, 404/500 JSON) in Express 5, Fastify, Koa, Hono and NestJS; side-by-side code and tables; one curl script against all 5 servers; default error shapes; Koa onion vs Express; edge cases: Koa 404 when `ctx.body` is not set, Hono's `c.req.json()` 500, one payload getting five verdicts (Fastify coerces and strips), Fastify response schema dropping fields; a benchmark with its method stated (machine was loaded, as the lesson says) | none | Every block re-run as saved; Nest compiled with tsc and re-run; benchmark repeated | 1: Hono on Workers/Deno/Bun (only Node installed) |
| 47-express-basics-what-it-is-and-why-a-framework.md | appended (+2 Cheat-card bullets) | Summary of app settings and `app.locals`, linking to 86; edge case: `app.get('/health')` with only a path is a settings read | none | Run on 5.3.0 and 4.22.3 | none |
| 48-routing-params-query-and-routers.md | appended (+2) | Link to 93 (`:id?` throws vs `{/:id}`); one mergeParams example with and without it; edge case: parent and child both using `:id`. The prompt said to add this example "in place"; it went in the appended section because of the protect-existing-content rule. | none | Run on both versions | none |
| 49-middleware-the-pipeline-next-and-order.md | appended (+2) | `next('router')` vs `next('route')`; `express.static` in the middleware order and fallthrough, linking to 87; edge case: `next('router')` with nothing after it, and a misspelt `'Router'` becoming an error | none | 3 scripts re-run | none |
| 50-error-handling-the-4-arg-handler-and-async-errors.md | appended (+3) | `res.headersSent` mid-stream (curl exit 18; without the check only ERR_HTTP_HEADERS_SENT is logged); router-level error handlers; the default handler (status picked from `err.status` / `statusCode` / an existing status; `err.headers`; stack unless production; nothing logged in test) — consistent with the existing crash-vs-hang correction | none | curl and supertest under 3 `NODE_ENV` values | none |
| 51-the-req-and-res-objects-reading-and-responding.md | appended (+2) | A pointer table from each missing req/res method to its place in 92; a runnable `req.is` + `sendStatus(415)` guard that keeps `req.body ?? {}` | none | Run on both versions | none |
| README.md | updated | New "Express in depth" group (86–96); 34–38 marked "+ additional topics"; REPORT-PROMPT-4 linked | — | Diffed against the previous version: additions only | — |

**Totals:**
- 2 `> ⚠️ Unverified` lines, each next to its claim.
- No output was pasted without being run.
- All Learn More URLs returned HTTP 200.

**Coordinator checks:**
- **Append-only:** a script diffed lessons 34–38 against snapshots taken before writing. The only changes are inserted Cheat-card bullets and the appended tail.
- **Template:** all 11 new lessons have exactly the 9 template sections in order, with 4–5 Q&A each.
- **Formatting:** CRLF line endings throughout; no marketing words.
- **Independent re-run:** I re-ran 8 sample supertest blocks myself against Express 5.3.0: lessons 86, 90, 92, 93, 94 and the 34, 35 and 37 appendices. All 64 expected output lines were found verbatim.
- **Consistency fix during the pass:** the dotfiles finding from lesson 87 was sent to the migration-guide writer. Lesson 94 verified it independently, so the two lessons agree.

## ASSET_ISSUES rows added

None. The four embedded figures agree with the text.

One minor note that was not filed: i56_01's "Your app" box mentions "DB". Lesson 95's tests inject an in-memory repository instead, and the lesson says so.

## MISSING_DIAGRAMS rows added (13)

| Lesson | Concept |
|---|---|
| 86 | `trust proxy` hop walk |
| 87 | express.static request flow and cache headers |
| 87 | Safe SPA history fallback |
| 88 | `res.render` flow |
| 89 | multer request pipeline |
| 89 | Upload through the server vs presigned direct upload |
| 89 | Presigned PUT vs POST sequence |
| 90 | Set-Cookie → Cookie cycle |
| 91 | sendFile root containment and Range |
| 94 | Async error propagation, Express 4 vs 5 |
| 37 (appendix) | headersSent mid-stream |
| 95 | Layered architecture and the dependency rule |
| 96 | Koa onion vs Express `next()` |

Full descriptions are in MISSING_DIAGRAMS.md.

## Differences from official docs (verified by running and stated in the lessons)

- **Migration guide, dotfiles:** "In Express 4, dotfiles were served by default." Express 4.22.3 already returned 404 for `/.env`; only files inside dot-directories were served.
- **Migration guide, `app.param(':id')`:** the guide says the leading colon is ignored. Router 2.2.0 actually stores the name as `':id'`, so the callback never runs.
- **5.x settings table:** says sub-apps inherit case/strict routing. The value is inherited, but routing is not affected, because the sub-app's router already exists. Settings that have defaults (etag, x-powered-by, query parser) are not inherited.
- **5.x `res.cookie` docs:** say object values are "parsed by bodyParser()". In fact cookie-parser decodes them.
- **Old `#res.cookie` link:** `https://expressjs.com/en/5x/api.html#res.cookie` now opens an index page. The option list is at `/en/5x/api/response`.

## Found but not changed (outside this prompt)

- **50:**
  - The sample `Set-Cookie: connect.sid=…; … Max-Age=86400` header is not what express-session 1.19.0 sends. It sends `Expires`, not `Max-Age`.
  - It calls "Lax" the "modern browser default"; MDN says only some browsers do this.
- **38:** the Interview lens says bracketed query keys give objects. That is not true under Express 5's default "simple" parser.
- **37:** "How it works" doesn't mention that `NODE_ENV=test` also sends the stack and suppresses logging. The 37 appendix covers it.
- **34–38:** headers still contain scraped junk ("Topic NN of 70 Bookmark …"). Lessons 34 and 38 link only to the Express 4.x API pages.
- **External link checks:** some AWS S3 POST-form doc URLs return 200 but redirect to the S3 API index. Treat a 200 status as weak evidence for those links.

## Side effects outside the kit

- **Tool caches:** throwaway tools and projects live under `~/.cache/nodekit-repair-tools/pass4/`: SeaweedFS, the codemod CLI, and the NestJS/TypeScript 7 project. Copies of the coordinator scripts, the brief and the snapshot are in `~/.cache/nodekit-repair-tools/`. All of it can be deleted.
- **Your environment:** no real credentials were used. Your npm prefix, `~/.npmrc`, shell rc files and git config were not touched.
- **Processes:** none left running.

## Step 6 verification output

```
PASS  47-express-basics-what-it-is-and-why-a-framework.md  (2 image link(s))
PASS  48-routing-params-query-and-routers.md  (2 image link(s))
PASS  49-middleware-the-pipeline-next-and-order.md  (2 image link(s))
PASS  50-error-handling-the-4-arg-handler-and-async-errors.md  (1 image link(s))
PASS  51-the-req-and-res-objects-reading-and-responding.md  (1 image link(s))
PASS  52-express-app-settings-and-locals.md  (0 image link(s))
PASS  55-express-serving-static-files.md  (0 image link(s))
PASS  59-template-engines-and-server-side-rendering.md  (0 image link(s))
PASS  58-file-uploads-in-express.md  (0 image link(s))
PASS  57-cookies-in-express.md  (0 image link(s))
PASS  56-express-file-responses.md  (0 image link(s))
PASS  54-express-request-response-api-reference.md  (1 image link(s))
PASS  53-express-routing-extras.md  (1 image link(s))
PASS  61-express-4-to-5-migration-guide.md  (1 image link(s))
PASS  60-express-project-structure.md  (1 image link(s))
PASS  62-express-alternatives-nestjs-fastify-koa-hono.md  (0 image link(s))
PASS  README.md  (0 image link(s))
PASS  ASSET_MAP.md  (0 image link(s))
PASS  MISSING_DIAGRAMS.md  (0 image link(s))
PASS  REPORT-PROMPT-4.md  (0 image link(s))
PASS  index links 52-express-app-settings-and-locals.md
PASS  index links 55-express-serving-static-files.md
PASS  index links 59-template-engines-and-server-side-rendering.md
PASS  index links 58-file-uploads-in-express.md
PASS  index links 57-cookies-in-express.md
PASS  index links 56-express-file-responses.md
PASS  index links 54-express-request-response-api-reference.md
PASS  index links 53-express-routing-extras.md
PASS  index links 61-express-4-to-5-migration-guide.md
PASS  index links 60-express-project-structure.md
PASS  index links 62-express-alternatives-nestjs-fastify-koa-hono.md
PASS  index links REPORT-PROMPT-4.md

12 image links checked in 20 files; 12 new files index-checked: 0 failure(s)
```
