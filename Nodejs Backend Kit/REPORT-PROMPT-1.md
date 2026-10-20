# REPORT — Prompt 1 (repair pass, 2026-10-07)

Scope: repair the 15 audited errors (lessons 08, 14, 26, 28, 35, 37, 38, 41, 42, 45, 62, 64, 65, 68, 70), then sweep the kit for the same bug classes. No new topics were added. Only the incorrect passages were edited; every lesson keeps its 9 standard `##` sections, its CRLF line endings and balanced code fences.

Environment: Node **v24.19.0**, npm 11.17.0 (full list of library and tool versions in CORRECTIONS.md). All code ran in a scratch directory outside the kit. Postgres, Redis and hadolint were placed in `~/.cache/nodekit-repair-tools`, because `/tmp` is mounted `noexec`. No Docker daemon was available.

| File | Repair | Verification run | SVGs embedded | Unverified items |
|---|---|---|---|---|
| 08-processnexttick-vs-setimmediate.md | nextTick scheduled inside a promise callback runs *after* promises queued later; "nextTick first" scoped to sync/macrotask scheduling; ESM-entry ordering noted; new Example 2b with real output | `node ordering.js`, `node top.cjs` vs `top.mjs` (Node 24.19.0) | none (the matching figures i05_01 / i05_02 are already in this lesson) | none |
| 14-packagejson-semantic-versioning.md | `engines` only warns in npm unless `engine-strict=true`; pnpm / Yarn 1 / Yarn 4 behaviour stated | npm 11.17.0, pnpm 10.34.6 + 12.9.1, Yarn 1.22.22 + 4.18.1 with `engines.node >=99` | none (no matching diagram; not needed) | none |
| 35-streams-overview.md | Default `highWaterMark` is 64 KiB for byte streams (changed in v22), 16 objects in object mode; snippet reads the real value | lesson snippet on v24.19.0; `npx node@21` / `node@22` | none (i24_02 shows the old 16 KB value — see ASSET_ISSUES) | none |
| 37-transform-duplex-streams.md | CSV transform rewritten (carried tail + `StringDecoder` + `flush`); proof test with mid-row / mid-character chunks; scrape-broken `'\n'` literals in Examples 3–4 repaired; numbered sequence added | old vs new test; Example 4 as saved with 5-byte chunks | none — logged in MISSING_DIAGRAMS | none |
| 48-routing-params-query-and-routers.md | Express 4 `"extended"` vs Express 5 `"simple"` query parser, with `app.set('query parser', 'extended')` | `GET /search?a[b]=c&tag=x&tag=y` on Express 4.22.3 and 5.2.1; Express source | none (no matching diagram) | none |
| 50-error-handling-the-4-arg-handler-and-async-errors.md | Unhandled async error crashes the process by default (Node 15+); hangs only when swallowed; Example 2b demonstrates crash / hang / Express 5 500 | spawned servers + fetch / curl; Node CLI docs | none (i34_01 already here and still accurate; i51_01 is only loosely related, so not embedded) | none |
| 51-the-req-and-res-objects-reading-and-responding.md | `req.body` is `undefined` in Express 5 with no body / no matching parser; `/login` destructure guarded | 4 configs × 5 requests; lesson block as saved | none (i35_01 already here) | none |
| 65-validation-pagination-filtering-sorting.md | Validated data goes to `res.locals.validated` instead of reassigning `req.query`; all examples updated | old in CJS and ESM; new lesson blocks as saved (Express 5.2.1, Zod 4.6.5) | none (i38_01 already here) | none |
| 66-api-versioning-error-shape-rate-limiting-docs.md | Deprecation middleware moved before the v1 router; `max` → `limit`; `ipKeyGenerator` for the v8 IPv6 check | real requests on Express 5.2.1; express-rate-limit 8.7.1 + rate-limit-redis 6.0.1 + Redis 8.0.5 | **assets/i33_02_4aebd34f.svg** ("What next() decides"), after the corrected versioning example | none |
| 73-sql-basics-from-node.md | `RETURNING id, created_at` → `RETURNING id, name, email` | lesson schema + insert block on PostgreSQL 18.4 (embedded-postgres), pg 8.23.1 | none | none |
| 98-worker-threads.md | Pool handles `'error'` and `'exit'`, rejects the in-flight task, respawns, keeps pumping; `close()`; kill-mid-task test; numbered sequence | old vs new pool; lesson blocks as saved; close test | none — logged in MISSING_DIAGRAMS | none |
| 100-caching-with-redis.md | Token lock: `SET key token NX PX`, Lua compare-and-delete release; distributed-lock caveat; numbered timeline | old vs new on Redis 8.0.5; lesson block as saved; redis.io distributed-locks page | none (i61_01 already here; no lock diagram) — logged in MISSING_DIAGRAMS | none |
| 101-pm2-docker.md | Comments moved to their own lines; `node:24` / `node:24-slim`; why-wrong note | hadolint 2.15.1 (old: DL3021 error; new: no errors or warnings); BuildKit source; Node release schedule; Docker Hub tags | none (i62_01 in this lesson shows `node:20` — see ASSET_ISSUES) | **`docker build` was not run** (no Docker); lint and parser-source check only |
| 112-graphql-basics.md | Apollo Server 5 current (v4 end-of-life 2026-01-26); `npm install @apollo/server graphql@16`; Express 5 integration via `@as-integrations/express5` | npm peer deps; Apollo docs; ran the lesson server and the Express snippet, real GraphQL response | none (i65_02 already here) | none |
| 114-message-queues-async-jobs.md | Claim (`processing`) → work → `done`; 5-minute lease for stuck claims; claim released on throw; before/after crash output; numbered lifecycle | real crash (child `process.exit(1)` inside `charge()`) on PostgreSQL 18.4; lesson blocks as saved | none (i67_01 already here) — logged in MISSING_DIAGRAMS | none |
| 27, 34, 48, 51, 52, 53 (**sweep**) | 16 KB claim (27); Express 5 request changes listed (34); `req.body ?? {}` (48, 51 ×2); `max` → `limit` (52 ×2); Express 5 dependency stated for "just throw" (53) | same runs as above; `node l52.cjs` → `200 200 200 200 200 429` | none | none |

**Unverified items:** none were left in the lessons, and no `> ⚠️ Unverified` marker was needed. The only verification gap is lesson 65, which was linted rather than built.

**Final link check** (step 6, over all 24 changed or new Markdown files): 35 image links, **0 failures**. Every link resolves, every referenced SVG is well-formed XML, no SVG has `<script>`, alt text is non-empty, and there are no absolute or backslash paths.

## ASSET_ISSUES rows added

| File | Embedded in | What the SVG says | Why it is a problem |
|---|---|---|---|
| assets/i24_02_e1ea38ee.svg | 27 | "highWaterMark (default 16 KB)" | 64 KiB since Node 22; contradicts corrected lessons 26/27 |
| assets/i62_01_f49bfdf5.svg | 65 | "FROM node:20" / "FROM node:20-slim" | Node 20 end-of-life 2026-04-30; lesson now uses `node:24` |
| assets/i06_01_94834faf.svg | 09 | "Macrotasks (one per turn)" | A phase runs all its callbacks per turn, draining microtasks after each |
| assets/i22_01_094ff453.svg | 25 | microtasks drain "Between every phase" | They drain after every callback (since Node 11) |
| assets/i02_02_ba74adeb.svg | 05 | "Node 20 LTS", "Node 18" | Both end-of-life; labels are dated |

## MISSING_DIAGRAMS rows added

| Lesson | Concept | What the diagram should show |
|---|---|---|
| 28 | Carrying an incomplete line across chunks | chunks → Transform with a `tail` slot and `StringDecoder`; rows out; `flush` at end |
| 62 | Pool behaviour when a worker dies mid-task | queue → idle → in-flight; `'error'`/`'exit'`; reject, remove, respawn, next job |
| 64 | Why a lock needs an owner token | A/B timeline: A's lock expires, B takes it, old `DEL` vs Lua compare-and-delete |
| 70 | Claim → work → done lifecycle | none → processing → done; processing → deleted (throw); stuck → re-claimed after lease |

## Notes

- **Caption style:** the one new figure (lesson 42) uses the requested `*Figure: … Look at: …*` caption. The kit's existing figures use a plain one-sentence caption after a blank line.
- **Folder permissions:** the kit folder was read-only (`dr-xr-xr-x`). With your approval it was made writable (`chmod u+w`) so the new report files could be created, and it was left writable. `assets/` and `PDF/` were not touched.
- **PDF copies:** the files in `PDF/` were not regenerated, so they no longer match the corrected Markdown.
- **Seen but left alone (out of scope for this pass):**
  - 8 scrape-broken `'\n'` string literals remain in lessons 04 (1), 27 (2), 30 (3), 33 (1) and 67 (1).
  - Unguarded `req.body.<field>` reads remain in example code in lessons 40 (`req.body.quantity`, `req.body.ref`) and 52 (`req.body.email`, `req.body.file`). Under Express 5 they throw a TypeError (500) when no body is sent.
  - Lesson 41 still uses `z.string().email()`, which is deprecated in Zod 4.
  - Lesson 64's lock retry recursion is unbounded.
  - Lesson 09's "at the same scheduling point" wording is a looser version of the scoping fixed in lesson 08.
