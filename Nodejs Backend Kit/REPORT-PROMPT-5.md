# REPORT — Prompt 5 (REST, API design and databases, 2026-10-12)

**Scope:**
- 10 new lessons (97–106).
- `## Additional topics` sections appended to lessons 39–47, with new bullets added to each of their Cheat-cards.
- README.md updated: a new "Databases in depth" group, 106 lessons now listed in numeric order.

The ORM and query-builder lessons (101–106) all use one shared domain, so the tools can be compared directly:
- **Tables:** users, posts, comments, tags and post_tags. Users have many posts and comments, posts have many comments, and posts and tags are many-to-many.
- **Same in every lesson:** the seed data, one canonical query ("published posts with author name, comment count and tag names, newest first") and an N+1 demonstration with real query counts.

**Environment:**
- **Runtime:** Node v24.19.0, npm 11.17.0, Express 5.3.0.
- **No Docker,** so every example ran against real local database servers:
  - **PostgreSQL 18.4**, run locally through the embedded-postgres npm package.
  - **MongoDB 8.2.6**, using mongodb-memory-server's downloaded `mongod` binary. It ran standalone, as a 1-node replica set for transactions, and as a real sharded cluster: a config-server replica set, two shard replica sets, and a `mongos` from the official 8.2.6 tarball (checksum verified).
  - **SQLite 3.53.3**, bundled with Node's `node:sqlite`.

  No hosted database or real credentials were used.

**Libraries and tools:**

| Area | Versions |
|---|---|
| Postgres driver | pg 8.23.1 (pg-pool 3.14.0) |
| MongoDB | mongodb 7.7.0, mongoose 9.11.1 |
| Prisma | prisma / @prisma/client / @prisma/adapter-pg 7.10.0 — the newest stable release; npm's `latest` for `prisma` is 8.0.0-rc.22 |
| Drizzle | drizzle-orm 0.45.4 (1.0.0-rc.4 for relational queries v2 only), drizzle-kit 0.31.11 |
| Sequelize | sequelize 6.37.8, sequelize-cli 6.6.5 (v7 is still alpha) |
| TypeORM | typeorm 1.1.2 (0.3.31 used only for comparisons), reflect-metadata 0.2.2 |
| Query builder and migrations | knex 3.3.0, node-pg-migrate 9.0.0, umzug 3.8.3 (docs only) |
| TypeScript | typescript 7.0.2, @types/node 24.19.2 |
| Validation | zod 4.6.5, joi 18.2.9, express-validator 7.3.2 |
| HTTP and testing | express-rate-limit 8.7.1, supertest 7.3.1, curl 8.18.0 |

## Files

| File | New or appended | Topics | SVGs embedded | Verification run | Unverified items |
|---|---|---|---|---|---|
| 71-mongodb-aggregation-pipeline.md | new (Topic 97 of 106) | Every listed stage, including both `$lookup` forms, `$facet`, `$bucket`, `$merge`/`$out`; stage order and index use with optimizer rewrites shown in `explain()`; reading pipeline explain output (top-level vs `$cursor` planner); the 100 MB limit, `allowDiskUseByDefault` and real spills for `$sort` and `$group`; three reports on a seeded shop dataset; edge case: `$unwind` and unmatched `$lookup` silently drop documents | none (fenced diagram) | 8 blocks re-run on a fresh mongod | none |
| 69-mongodb-schema-patterns.md | new (Topic 98) | Bucket, subset, computed, extended reference, outlier, polymorphic; trees with parent references (`$graphLookup`), ancestor arrays and materialized paths; costs measured: bucket turned 100,000 documents into 1,670 and the index from 2,072 KB to 68 KB; an anchored path regex examines 5 keys vs 20,006 for an unanchored one | assets/i41_01_7b178f88.svg | 8 blocks re-run (index size within page jitter, as stated) | none |
| 70-mongodb-indexes-in-depth.md | new (Topic 99) | TTL (a real document expiry), partial unique "unique among active", sparse, compound and the prefix rule, text, wildcard, hashed, 8.0 `EXPRESS_IXSCAN`; ESR measured on 200k documents (21 keys and no SORT stage, vs 36,000 keys and an in-memory SORT); build time with concurrent inserts | assets/i41_02_00012497.svg | 6 blocks re-run (only timings vary) | none |
| 72-mongodb-sharding.md | new (Topic 100) | A real cluster: shard keys, chunks and the balancer, hashed vs ranged keys, a hot shard (ranged monotonic key: 0 / 4,000 new inserts per shard; hashed: 2,005 / 1,995), targeted (`SINGLE_SHARD`) vs scatter-gather (`SHARD_MERGE`), unique indexes needing the shard-key prefix; edge case: orphaned documents after a migration inflate a direct shard count | none (fenced diagrams) | Download, cluster and all examples re-run on a fresh cluster | none |
| 77-prisma-orm.md | new (Topic 101) | Prisma 7 setup (`prisma-client` generator + output, adapter-pg, `prisma.config.ts`); `@@map`/`@map` onto the shared tables; migrate dev/deploy/status with the real SQL; seeding; CRUD with P2002/P2025; include/select with logged SQL; the canonical query; batch and interactive transactions; edge cases: using `prisma` instead of `tx`, P2028 timeout, `$queryRaw` vs `$queryRawUnsafe`, BigInt counts; N+1 (9 → 3 → 1 with relationJoins) | none | Fresh database: migration SQL byte-identical, strict tsc, all 10 scripts matched | 1 (quoted below) |
| 78-drizzle-orm.md | new (Topic 102) | `pgTable` schema and relations; drizzle-kit generate/migrate/push and what each one records; the canonical query through the builder and through RQB v1 (plus v2 on the RC); join fan-out inflating counts; transactions with savepoints and `TransactionRollbackError`; `$inferSelect`/`$inferInsert` with real tsc errors that type stripping still runs; N+1 (9 → 1) | none | Fresh database; all outputs matched | none |
| 79-sequelize-and-typeorm.md | new (Topic 103) | Both ORMs on the shared domain: models and entities, associations, migrations with real generated files, transactions, the canonical query with logged SQL, N+1. Pitfalls actually run: timestamps/paranoid (paranoid without timestamps silently hard-deletes), `include` + `limit` subquery, `sync({alter})` dropping an undeclared foreign key, `eager`, TypeORM `synchronize` rename behaviour (a single rename is detected; rename plus another change loses data), `undefined` in where (throws on 1.x) | none | Fresh databases; generated migration reproduced | none |
| 76-knex-query-builder.md | new (Topic 104) | Builder with toSQL/toNative/toString; migrations and seeds with the real knex_migrations batches (one migration opts out of the transaction for CONCURRENTLY); transactions with savepoints; the canonical query (and the wrong count from a double join); a dynamic filter builder; a CTE plus window functions; N+1 (9 → 3); edge cases: `whereIn([])` → `1 = 0`, `.first()`, count returned as a string | none | Fresh database | none |
| 80-database-migrations-and-seeding.md | new (Topic 105) | node-pg-migrate up/down and the out-of-order edge case; idempotent seeds vs fixtures; on a 2,000,004-row table with lock evidence from `pg_locks`: one-shot NOT NULL blocked an INSERT for 19.8 s vs the safe sequence (nullable → batched backfill → `CHECK NOT VALID` → VALIDATE → SET NOT NULL) never blocking it; PG 18 `NOT NULL NOT VALID`; constant vs volatile DEFAULT; CREATE INDEX vs CONCURRENTLY (including the real 25001 error and an INVALID index left behind); `lock_timeout` with retry; expand-and-contract with v1 and v2 apps running together; a 7-tool comparison table | none (fenced diagrams) | Two full runs on fresh databases; timings vary and are given | 1 (quoted below) |
| 81-choosing-raw-sql-query-builder-or-orm.md | new (Topic 106) | Decision table (raw pg, Knex, Drizzle, Prisma, Sequelize, TypeORM) covering type safety, SQL visibility, migrations, learning and escape hatches; the canonical query in raw pg; N+1 counted with a wrapper; the shared domain in `node:sqlite`; edge cases: `enableForeignKeyConstraints` is on by default in node:sqlite (unlike SQLite itself), type affinity vs STRICT tables, boolean binding (throws on v24.19.0, added in v24.21.0) | none | Byte-identical re-run | none |
| 63-rest-principles-constraints-resources-statelessness.md | appended (+3 Cheat-card bullets) | Express's built-in weak ETag and how it is computed; `req.fresh` rules; a real 304 with no body; gotcha: Node `fetch` with a hand-set If-None-Match adds `no-cache`, which gives a 200 | none | curl transcript and scripts matched | none |
| 64-crud-http-verbs-status-codes-idempotency.md | appended (+3) | Automatic HEAD and OPTIONS; the default 404 for a wrong method, then 405 + Allow; 415; 428 (RFC 6585); 412 with strong-only `If-Match`; a two-client race (the winner varies, as stated) | none | Transcript and race script matched | none |
| 65-validation-pagination-filtering-sorting.md | appended (+3) | Joi and express-validator versions of the Zod endpoint, all storing results in `res.locals.validated` (the correction is kept); 7 identical inputs through all three; `matchedData()`. Finding: `.toInt()` silently does not change `req.query` on Express 5 (re-parsed on every read) but does on Express 4. | none | All scripts matched; Express 4 comparison run | none |
| 66-api-versioning-error-shape-rate-limiting-docs.md | appended (+3) | Full RFC 9457 Problem Details handler (`application/problem+json`, about:blank, extensions, negotiation); a real local reverse proxy in front of rate limiting: without trust proxy everyone shares one key, `1` gives per-client limits, `true` lets a forged X-Forwarded-For bypass the limit; a custom keyGenerator disables express-rate-limit's safety checks. The `limit` + `ipKeyGenerator` correction is kept. | none | All scripts matched | none |
| 67-mongodb-amp-mongoose.md | appended (+6) | `timestamps`; virtuals (getter/setter/populate/toJSON vs toObject/lean); discriminators; one error mapper (CastError → 400, ValidationError → 422, 11000 → 409, 404 via orFail); `sanitizeFilter` blocking a real `{"$ne":null}` login bypass | none | 6 blocks re-run | none |
| 68-schema-design-amp-data-modeling.md | appended (+2) | Pointers to 97–100; an example where an index turns "paid, newest 20" from SORT on a COLLSCAN into 20 keys examined | none | Exact match | none |
| 73-sql-basics-from-node.md | appended (+2) | Pointers to 101–106; the corrected `INSERT … RETURNING id, name, email` run through pg; edge case: `ON CONFLICT DO NOTHING RETURNING` returns no rows | none | Matched | none |
| 74-connection-pooling.md | appended (+4) | `pool.on('error')`: real crash without it (57P01, exit 1) vs survival with it; pool statistics sampled under load; `pool.end()` (queued queries stay pending, end after end throws); SIGTERM integration; edge case: a checked-out client needs its own `client.on('error')` | none | All blocks re-run | none |
| 75-transactions-amp-acid.md | appended (+5) | Mongo `withTransaction()` retrying a real WriteConflict; Mongoose `__v` vs `optimisticConcurrency`; a real PostgreSQL deadlock (40P01) with lock ordering and bounded retry; savepoints vs 25P02; a SKIP LOCKED queue with 3 workers (claim → work → done with a lease, consistent with lesson 70) | none (fenced diagrams) | All blocks re-run; a 2,000-job stress run gave no double claims | none |
| README.md | updated | New "Databases in depth" group (97–106); 39–47 marked; numeric ordering for 3-digit lesson numbers; REPORT-PROMPT-5 linked | — | Diffed against the previous version: additions only | — |

**Unverified items (2, exact text in the lessons):**
- **101:** "> ⚠️ Unverified: that `migrate reset` no longer seeds is taken from the v7 upgrade guide and was not run here. Prisma 7.10.0 refuses `migrate reset` when it detects an AI agent without the user's explicit consent, and none was given. `migrate dev` on an empty database was run, and it did not seed (Example 4)."
  - Prisma's consent check was respected, not bypassed. You can run that command yourself to confirm.
- **105:** "> ⚠️ Unverified: whether Prisma Migrate wraps each `migration.sql` in a transaction on PostgreSQL, and therefore whether a `CREATE INDEX CONCURRENTLY` inside one works. The Prisma 7 pages checked … do not say, and Prisma was not run for this lesson. See lesson 101."

All Learn More URLs returned 200 and landed on the intended page.

**Coordinator checks:**
- **Append-only:** a script diffed lessons 39–47 against snapshots taken before writing. The only changes are inserted Cheat-card bullets and the appended tail.
- **Template:** all 10 new lessons have exactly the 9 template sections in order, with 4–5 Q&A each.
- **Line endings and wording:** CRLF everywhere; no marketing words.
- **Cross-lesson consistency:** lesson 106's decision table, lesson 105's tool table and lesson 45's pointers were written before lessons 101–104 existed. I checked all three against the final 101–104 and they match.
- **Independent re-run:** I re-ran 6 sample blocks myself:
  - two `node:sqlite` blocks from 106;
  - two Joi/express-validator blocks from 41;
  - the If-Match race from 40, with its companion server started from the lesson;
  - the rate-limit checks from 42.

  All 58 expected lines were found verbatim.

## ASSET_ISSUES rows added

| File | Embedded in | Problem |
|---|---|---|
| assets/i41_02_00012497.svg | 44, 99 | Low severity. "~20 docs examined, O(log n)" mixes B-tree page visits with documents examined. A measured indexed point lookup examined 1 key and 1 document; lesson 99's caption states that. |

## MISSING_DIAGRAMS rows added (19)

| Lesson | Concept |
|---|---|
| 39 (appendix) | Conditional GET / 304 flow |
| 42 (appendix) | trust proxy and X-Forwarded-For |
| 47 (appendix) | PostgreSQL deadlock timeline |
| 47 (appendix) | FOR UPDATE SKIP LOCKED work queue |
| 97 | Aggregation pipeline stages |
| 99 | Compound index field order (ESR) |
| 100 | Sharded cluster topology and query routing |
| 101 | Prisma 7 pipeline from schema to SQL |
| 101 | Interactive transaction connection binding |
| 102 | Drizzle layers and migration flow |
| 102 | Join fan-out |
| 103 | Sequelize `include` + `limit` subquery |
| 103 | TypeORM `synchronize` rename heuristic |
| 104 | Knex nested transaction savepoint |
| 104 | Knex migration batches and rollback |
| 105 | Expand-and-contract |
| 105 | Lock queue behind a long transaction |
| 105 | Safe NOT NULL steps |
| 106 | Driver → query builder → ORM layers |

## Differences from docs and common claims (verified, stated in the lessons)

- **Prisma 7.10.0:**
  - `migrate deploy` printed no warning for a modified applied migration, although the docs say it warns.
  - `migrate --help` still says `dev` runs generators, but it did not.
  - Prisma's and Drizzle's docs sites now default to their unreleased next majors.
- **TypeORM 1.1.2:** `synchronize` handles a lone column rename as `RENAME COLUMN`; data is lost only when a rename ships together with another change.
- **MongoDB 8.2.6:**
  - A `$match` on a `$group` `_id` was pushed before the group and used an index. The optimization docs don't list this rewrite, so the lesson tells readers to check `explain()`.
  - `/docs/v8.2/` now redirects to the current manual.
- **pg-pool 3.14.0:** after `pool.end()`, queued queries stay pending forever.

## Found but not changed (outside this prompt)

- **46:** says pools "validate connections and transparently replace dead ones". pg-pool 3.14.0 does no validation when it hands out a client; it removes a client only on `'error'`.
- **43:**
  - recommends `{ new: true }`, which Mongoose 9.2 deprecated in favour of `returnDocument: 'after'`;
  - says indexes "build in the background", but that option is gone;
  - doesn't mention that Mongoose 9 removed `next()` from pre hooks.
- **44:** "16 MB" is precisely 16 MiB (16,777,216 bytes).
- **39 and 47:** the existing manual `getProduct` ETag check is only partial, and the existing Mongo transaction example has no retry. The appendices explain both.
- **39–47:** headers still contain scraped junk ("Topic NN of 70 Bookmark …").

## Side effects outside the kit

- **Your home folder:** an early Prisma run created `~/.cache/prisma` and `~/.config/prisma-nodejs/commands.json` under your real HOME. Both were deleted, and all later runs used a throwaway HOME.
- **Prisma's agent files:** Prisma's `init` wrote agent skill files (`.claude/`, `.agents/`, `.windsurf/`) inside a scratch project only; they were removed.
- **Tool caches:** everything else is under `~/.cache/nodekit-repair-tools/`:
  - the start-pg / start-mongo helpers;
  - the mongod 8.2.6 and mongos downloads;
  - per-writer projects in `pass5/`;
  - copies of the coordinator scripts and snapshots.

  All of it can be deleted.
- **Processes:** all database servers are stopped.

## Step 6 verification output

```
PASS  71-mongodb-aggregation-pipeline.md  (0 image link(s))
PASS  69-mongodb-schema-patterns.md  (1 image link(s))
PASS  70-mongodb-indexes-in-depth.md  (1 image link(s))
PASS  72-mongodb-sharding.md  (0 image link(s))
PASS  77-prisma-orm.md  (0 image link(s))
PASS  78-drizzle-orm.md  (0 image link(s))
PASS  79-sequelize-and-typeorm.md  (0 image link(s))
PASS  76-knex-query-builder.md  (0 image link(s))
PASS  80-database-migrations-and-seeding.md  (0 image link(s))
PASS  81-choosing-raw-sql-query-builder-or-orm.md  (0 image link(s))
PASS  63-rest-principles-constraints-resources-statelessness.md  (2 image link(s))
PASS  64-crud-http-verbs-status-codes-idempotency.md  (2 image link(s))
PASS  65-validation-pagination-filtering-sorting.md  (2 image link(s))
PASS  66-api-versioning-error-shape-rate-limiting-docs.md  (2 image link(s))
PASS  67-mongodb-amp-mongoose.md  (1 image link(s))
PASS  68-schema-design-amp-data-modeling.md  (2 image link(s))
PASS  73-sql-basics-from-node.md  (1 image link(s))
PASS  74-connection-pooling.md  (1 image link(s))
PASS  75-transactions-amp-acid.md  (2 image link(s))
PASS  README.md  (0 image link(s))
PASS  ASSET_MAP.md  (0 image link(s))
PASS  ASSET_ISSUES.md  (0 image link(s))
PASS  MISSING_DIAGRAMS.md  (0 image link(s))
PASS  REPORT-PROMPT-5.md  (0 image link(s))
PASS  index links 71-mongodb-aggregation-pipeline.md
PASS  index links 69-mongodb-schema-patterns.md
PASS  index links 70-mongodb-indexes-in-depth.md
PASS  index links 72-mongodb-sharding.md
PASS  index links 77-prisma-orm.md
PASS  index links 78-drizzle-orm.md
PASS  index links 79-sequelize-and-typeorm.md
PASS  index links 76-knex-query-builder.md
PASS  index links 80-database-migrations-and-seeding.md
PASS  index links 81-choosing-raw-sql-query-builder-or-orm.md
PASS  index links REPORT-PROMPT-5.md

17 image links checked in 24 files; 11 new files index-checked: 0 failure(s)
```
