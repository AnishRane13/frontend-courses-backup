---
title: "Database Migrations and Seeding"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Database Migrations and Seeding

*30 min read · Updated 12 Oct 2026 · Topic 105 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and PostgreSQL 18.4 (run locally via the embedded-postgres npm package, no Docker), pg 8.23.1, node-pg-migrate 9.0.0

---

## Why it matters

Your code lives in git, so every developer, CI job and server can check out exactly the same version of it. Your database schema does not live in git: it lives inside each database. If developers change it by hand (`ALTER TABLE` in a SQL console), the databases drift apart:

- **Drift between environments.** Your laptop has `posts.slug`, staging does not, and production has it with a different type. Code that passed its tests fails after deploy with `column "slug" does not exist`.
- **No order.** Two schema changes that depend on each other (create a table, then add a foreign key to it) have to run in the same order everywhere. A list of SQL snippets in a wiki has no order and no record of which ones ran where.
- **Locks in production.** On a table with two million rows, one innocent `ALTER TABLE` held a lock for 20 seconds in this lesson's final run. An insert from the app waited 19.8 s behind it.

**Migrations** fix the first two: each schema change is a numbered file in git, and a tool records in a table inside each database which files it has already applied. Safe migration patterns fix the third: they split one dangerous change into short steps that keep the app running. **Seeding** answers a related question: how a fresh database gets the rows it needs (lookup data, a demo account) after the schema is in place.

## The concept, simply

A migration is a small, versioned script that changes the schema from one state to the next. The files are ordered, usually by a timestamp in the filename:

text

```
migrations/
  1791814286546_init-schema.js            ← creates users, posts, comments, tags, post_tags
  1791814309246_posts-created-at-index.js ← adds an index
```

The migration tool keeps a **history table** in the database (`pgmigrations` for node-pg-migrate, `_prisma_migrations` for Prisma, `knex_migrations` for Knex). To bring any database up to date, the tool lists the files, reads the history table, and runs only the files that are not recorded there, in order. A brand-new database runs all of them. Production runs only the new one. Every environment ends up with the same schema because it ran the same files in the same order.

Each migration usually has two halves. **Up** applies the change (`CREATE TABLE`). **Down** reverses it (`DROP TABLE`). You use down in development to undo a migration you are still working on. In production, a down that drops a column also deletes its data, so most teams fix forward with a new migration instead.

**Seed data** is the set of rows a database needs to be usable, such as lookup tables or a demo user. It is loaded by a script that is safe to run again. **Fixtures** are small, throwaway rows that one test creates for itself and that are wiped before the next test.

## How it works

What a migration tool does when you run `up` (node-pg-migrate 9.0.0 here; the other tools follow the same steps with different names):

1. It connects to the database named by `DATABASE_URL`.
2. It takes a lock so that two deploys cannot migrate at the same moment. node-pg-migrate calls `pg_try_advisory_lock(7241865325823964)` and fails with "Another migration is already running" if another process holds it. Knex uses a `knex_migrations_lock` table instead.
3. It creates the history table (`pgmigrations`) if it does not exist yet.
4. It reads the migration files, sorts them by name and compares them with the rows in the history table. If a file that has not run sorts *before* one that has, it stops (Example 2): the databases would otherwise end up with the changes in different orders.
5. It runs each pending migration's `up`, then inserts a row with the file name into the history table, inside the same transaction. A failure rolls back both the change and its history row, so the history table never claims that a half-applied migration ran. The exception is a migration that opts out of the transaction (`pgm.noTransaction()`): its statements and its history row run one by one, so a failure part-way can leave a change applied but not recorded.
6. It releases the lock.

`down` follows the same steps in reverse: it takes the most recently applied migration, runs its `down` and deletes the history row.

**What makes a migration dangerous in production.** PostgreSQL protects a table's structure with table-level locks. Almost every `ALTER TABLE` needs an `ACCESS EXCLUSIVE` lock, which conflicts with everything, including plain `SELECT`. That is fine when the statement takes 2 ms. It hurts in two cases:

- **The statement does a lot of work while holding the lock.** `UPDATE` of every row, `SET NOT NULL` (it scans the whole table to check for NULLs), `ADD COLUMN … DEFAULT random()` (it rewrites the table) and plain `CREATE INDEX` (it blocks writes, not reads, for the whole build) all hold their lock for as long as the work takes. Example 6 measured 20.0 s for the one-shot version; the `random()` rewrite in Example 9 took 3.7 s in the final run and 44 s in an earlier one.
- **The statement waits for its lock.** If a long transaction is reading the table, the `ALTER` waits for it to finish. While it waits, it sits in the lock queue, and every query that arrives after it, even a `SELECT`, queues behind it (Example 12). A 2 ms `ALTER` can stop the app for as long as the slowest open transaction.

The safe patterns below keep both cases short. Each was run against a `posts` table with 2,000,004 rows (185 MB). Timings come from `performance.now()` around each `client.query()`, single runs on one laptop (Intel i5-1135G7, 8 threads, embedded-postgres default settings). The laptop was also running other PostgreSQL servers, and the same step varied a lot between runs (the full backfill took 22.6 s in one run and 62.8 s in the final one), so compare numbers only within one run. Treat them as relative sizes, not benchmarks.

**Pattern 1 — add a NOT NULL column in steps.** The one-shot version (`ADD COLUMN`, `UPDATE` every row, `SET NOT NULL` in one transaction) holds `ACCESS EXCLUSIVE` from the first statement to `COMMIT`. The stepwise version (Examples 7 and 8):

1. `ADD COLUMN slug text`: nullable, no default. Only the catalog changes, so the lock is held for a few milliseconds.
2. Deploy app code that writes `slug` for every new row.
3. Backfill old rows in batches (50,000 rows per `UPDATE`, each its own transaction). Each batch locks only the rows it touches, and only for that batch.
4. `ADD CONSTRAINT posts_slug_not_null CHECK (slug IS NOT NULL) NOT VALID`. `NOT VALID` means "enforce this on new and changed rows, but do not scan existing rows now". It is quick, but it still needs `ACCESS EXCLUSIVE` for a moment.
5. `VALIDATE CONSTRAINT posts_slug_not_null`. This scans the table, but it holds only `SHARE UPDATE EXCLUSIVE`, which lets reads and writes continue.
6. `ALTER COLUMN slug SET NOT NULL`. The PostgreSQL docs say this scan "is skipped" when "a valid CHECK constraint exists … which proves no NULL can exist". It took 1 ms.
7. Drop the now-redundant CHECK.

PostgreSQL 18 shortens this: a NOT NULL constraint can itself be added `NOT VALID` and validated later (added in PostgreSQL 18; the PostgreSQL 17 docs allow `NOT VALID` only for foreign key and CHECK constraints). Example 8 runs it. One difference showed up: the column is reported as `attnotnull = true` and rejects new NULLs immediately, even before validation.

**Pattern 2 — build indexes with `CREATE INDEX CONCURRENTLY`.** A plain `CREATE INDEX` takes a `SHARE` lock: reads continue, writes wait for the whole build. `CONCURRENTLY` takes `SHARE UPDATE EXCLUSIVE`, so writes continue, but PostgreSQL "must perform two scans of the table, and in addition it must wait for all existing transactions that could potentially modify or use the index to terminate" (PostgreSQL docs). Because it manages its own transactions, it "cannot" run inside a transaction block (error `25001`). Migration tools that wrap each migration in `BEGIN … COMMIT` need an opt-out: `pgm.noTransaction()` in node-pg-migrate, `config.transaction = false` in Knex. If a concurrent build fails, for example on a duplicate in a unique index, it leaves an `INVALID` index behind that is still updated on every write. Drop it before retrying (Example 11).

**Pattern 3 — expand and contract for renames and type changes.** During a rolling deploy, old and new app versions run against the same database at the same time. A one-step `RENAME COLUMN name TO full_name` breaks every old instance at once with `column "name" does not exist`. Expand and contract splits the change across deploys:

text

```
time ─────────────────────────────────────────────────────────────────────────────►
 deploy 1: EXPAND             deploy 2: SWITCH               deploy 3: CONTRACT
 DB: ADD COLUMN full_name     app v2 reads and writes        DB: drop trigger,
     + sync trigger           full_name only                     full_name SET NOT NULL,
     + backfill                                                  DROP COLUMN name
 app v1 (uses name)       ███████████████████████░░░░░ (instances drain away)
 app v2 (uses full_name)              ░░░░░████████████████████████████████████████
                          ◄──── both columns exist and hold the same values ────►
```

The sync trigger is what makes it safe for both versions to write at once: whichever column a version writes, the trigger copies the value into the other one. Example 13 runs v1 and v2 side by side. Prisma's docs warn that its schema diff turns a renamed field into "CREATE a new column" plus "DROP the existing column … and the data in that column" unless you edit the generated SQL (`prisma migrate dev --create-only`), which is one more reason to plan renames by hand.

**Pattern 4 — `lock_timeout` on every migration session.** `lock_timeout` makes a statement give up if it has waited longer than the limit for a lock (error `55P03`, "canceling statement due to lock timeout"). The default `0` means wait forever. With `SET lock_timeout = '500ms'`, a blocked `ALTER` stops after half a second, the queries queued behind it go through, and the migration retries with a backoff (Example 12). The docs advise against setting it in `postgresql.conf`, "because it would affect all sessions": set it in the migration's own session.

**Zero-downtime rules.** During a deploy, version N of the app is still serving traffic while N+1 starts. So every migration must work with both:

- **Add before use.** Run the migration that adds a column or table *before* deploying code that reads it.
- **Remove after last use.** Drop a column only in a later deploy, after no running code reads or writes it. For a while, the code must keep working whether the column is there or not.
- **Never rename or retype in one step.** Use expand and contract.
- **New required columns need a value for old writers.** Either a constant `DEFAULT` (instant since PostgreSQL 11, Example 9), or a nullable column plus backfill plus constraint.
- **Keep every lock short.** Batch big `UPDATE`s, use `NOT VALID` + `VALIDATE`, build indexes `CONCURRENTLY`, set `lock_timeout` and retry.
- **Do not edit a migration that has run anywhere shared.** The history table records only the file name, so a changed file never runs again on databases that already applied it. Write a new migration instead.
- **Plan to roll forward.** A down migration that drops a column is not an undo: the data is gone. Keep downs for development and for reversing a failed deploy before any data depends on the change.

**Seed data vs fixtures.**

| | Seed data | Fixtures |
|---|---|---|
| Purpose | Make a new database usable: lookup rows, roles, a demo account | Put one test into a known state |
| When it runs | After migrations, in dev, CI and sometimes production | Before each test (or each file) |
| Lifetime | Stays | Wiped before the next test (`TRUNCATE … RESTART IDENTITY CASCADE` or a rolled-back transaction) |
| Must be | Idempotent: running it twice changes nothing | Small and explicit: the test reads the rows it relies on |
| Example here | `seed.mjs` (Example 3) | `posts.fixture.test.mjs` (Example 4) |

Do not put seed rows inside migrations unless every environment, including production, must have them (a `roles` lookup table, for example). Migrations run once per database and are hard to change later. A seed script can be fixed and re-run.

**The migration tools from lessons 76–79, plus node-pg-migrate.** Facts below come from each tool's documentation, its CLI `--help` and, where noted, its source. node-pg-migrate is the only one run in this lesson. The others are run in their own lessons.

| Tool (version checked) | How a migration is written | History table (default) | Down / rollback | A step outside a transaction (for `CONCURRENTLY`) | Seeding | Lesson |
|---|---|---|---|---|---|---|
| Prisma Migrate (prisma 7.10.0) | Generated: `prisma migrate dev` diffs `schema.prisma` and writes `prisma/migrations/<timestamp>_<name>/migration.sql`; `--create-only` lets you edit it first; `prisma migrate deploy` applies pending files in production | `_prisma_migrations` | No down files. The docs generate a `down.sql` with `prisma migrate diff`, run it with `prisma db execute`, and mark a failed migration with `prisma migrate resolve` | ⚠️ not stated in the pages checked (see note) | `prisma db seed` runs the command set in `prisma.config.ts` (`migrations.seed`); in v7 it is "only triggered explicitly" | [101](77-prisma-orm.md) |
| Drizzle Kit (drizzle-kit 0.31.11) | Generated: `drizzle-kit generate` compares a JSON snapshot of the TypeScript schema with the previous one and writes SQL + `snapshot.json`; `--custom` gives an empty SQL file; `drizzle-kit migrate` applies; `drizzle-kit push` changes the database with no files | `__drizzle_migrations` in schema `drizzle` | No rollback command (`drizzle-kit --help` lists generate, migrate, introspect, push, studio, up, check, drop, export) | drizzle-orm 0.45.4's PostgreSQL `migrate()` runs all pending migrations in one transaction (source, `pg-core/dialect.js`) | `drizzle-seed` package (deterministic fake data) or a `--custom` SQL migration | [102](78-drizzle-orm.md) |
| sequelize-cli (6.6.5) | Hand-written JS: `up(queryInterface, Sequelize)` and `down` | `SequelizeMeta` | `db:migrate:undo`, `db:migrate:undo:all` | The CLI opens no transaction (no transaction code in its `lib/`); the docs example opens one inside `up` with `queryInterface.sequelize.transaction()` | `db:seed:all`; runs are not recorded unless you set `seederStorage` | [103](79-sequelize-and-typeorm.md) |
| Umzug (3.8.3) | A library: you pass a list of `{ name, up, down }` and a storage; sequelize-cli-style CLIs are built on it | Depends on storage: `JSONStorage` writes `umzug.json`, `SequelizeStorage` uses `SequelizeMeta` | `umzug.down()` | Umzug runs your function as written; transactions are up to you | — | [103](79-sequelize-and-typeorm.md) |
| TypeORM migrations (typeorm 1.1.2) | `migration:generate` diffs entities against the database and writes a class with `up`/`down`; `migration:create` gives an empty one | `migrations` (`migrationsTableName`) | `migration:revert` undoes the last one; "call this command multiple times" for more | `migrationsTransactionMode: "all" \| "each" \| "none"` (default `all`); with `each`/`none` a migration class can set `transaction = false` | Not built in | [103](79-sequelize-and-typeorm.md) |
| Knex migrations (knex 3.3.0) | Hand-written JS with the schema builder: `exports.up` / `exports.down`, created by `knex migrate:make` | `knex_migrations`, plus `knex_migrations_lock` | `migrate:rollback` (last batch), `migrate:down` (one) | Per file `exports.config = { transaction: false }`, or `disableTransactions` for all | `knex seed:make` / `seed:run`, "independent of your migration files" | [104](76-knex-query-builder.md) |
| node-pg-migrate (9.0.0, run here) | Hand-written JS/TS/SQL with the `pgm` builder (`pgm.createTable`, `pgm.addColumn`, `pgm.sql`), created by `node-pg-migrate create` | `pgmigrations` | `down` (one by default), `redo`; a file with no `down` is reversed automatically for reversible operations | `pgm.noTransaction()`; by default all pending files share one transaction (`--single-transaction`) and the tool commits around a `noTransaction()` file | Not built in | this lesson |

> ⚠️ Unverified: whether Prisma Migrate wraps each `migration.sql` in a transaction on PostgreSQL, and therefore whether a `CREATE INDEX CONCURRENTLY` inside one works. The Prisma 7 pages checked (migration histories, customizing migrations, down migrations, seeding) do not say, and Prisma was not run for this lesson. See lesson 77.

## Code examples

**Example 1 — node-pg-migrate: two migrations up, the history table, and down.**

Set up the project. node-pg-migrate generates migration files in ESM syntax (`export const up`), so the package is marked as a module. The migrations directory defaults to `migrations/` and the connection string to the `DATABASE_URL` environment variable.

bash

```
$ npm init -y
$ npm pkg set type=module
$ npm install pg@8.23.1 node-pg-migrate@9.0.0
$ npm ls node-pg-migrate
proj@1.0.0 /…/proj
└── node-pg-migrate@9.0.0
$ npx node-pg-migrate --version
1.0.0
$ export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6601/app
$ npx node-pg-migrate create init-schema
Created migration -- /…/proj/migrations/1791814286546_init-schema.js
$ npx node-pg-migrate create posts-created-at-index
Created migration -- /…/proj/migrations/1791814309246_posts-created-at-index.js
```

`npx node-pg-migrate --version` printed `1.0.0`, the version of *this project's* `package.json`, not of the tool (setting the project to 3.2.1 made it print 3.2.1). Use `npm ls` to see the installed version.

The first migration creates the shared blog schema. `'id'` is node-pg-migrate's shorthand for `serial PRIMARY KEY`.

javascript

```
// migrations/1791814286546_init-schema.js — the shared blog schema (node-pg-migrate 9.0.0)
export const up = (pgm) => {
  pgm.createTable('users', {
    id: 'id', // shorthand for serial PRIMARY KEY
    email: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
  });
  pgm.createTable('posts', {
    id: 'id',
    author_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    title: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    published: { type: 'boolean', notNull: true, default: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createTable('comments', {
    id: 'id',
    post_id: { type: 'integer', notNull: true, references: 'posts', onDelete: 'CASCADE' },
    author_id: { type: 'integer', notNull: true, references: 'users', onDelete: 'CASCADE' },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createTable('tags', {
    id: 'id',
    name: { type: 'text', notNull: true, unique: true },
  });
  pgm.createTable('post_tags', {
    post_id: { type: 'integer', notNull: true, references: 'posts', onDelete: 'CASCADE', primaryKey: true },
    tag_id: { type: 'integer', notNull: true, references: 'tags', onDelete: 'CASCADE', primaryKey: true },
  });
};

export const down = (pgm) => {
  pgm.dropTable('post_tags');
  pgm.dropTable('tags');
  pgm.dropTable('comments');
  pgm.dropTable('posts');
  pgm.dropTable('users');
};
```

The second one builds an index without blocking writes, so it opts out of the transaction:

javascript

```
// migrations/1791814309246_posts-created-at-index.js — an index built without blocking writes
export const up = (pgm) => {
  pgm.noTransaction(); // CREATE INDEX CONCURRENTLY refuses to run inside BEGIN … COMMIT
  pgm.createIndex('posts', 'created_at', { name: 'posts_created_at_idx', concurrently: true });
};

export const down = (pgm) => {
  pgm.noTransaction();
  pgm.dropIndex('posts', 'created_at', { name: 'posts_created_at_idx', concurrently: true });
};
```

A small script to look at what the tool recorded:

javascript

```
// show-migrations.mjs — what node-pg-migrate recorded, and which tables exist
import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query('SELECT id, name FROM pgmigrations ORDER BY id');
console.log('pgmigrations:', rows);
const t = await client.query(`SELECT string_agg(tablename, ', ' ORDER BY tablename) AS tables
                              FROM pg_tables WHERE schemaname = 'public'`);
console.log('tables:', t.rows[0].tables);
await client.end();
```

node-pg-migrate prints every SQL statement it runs (`--verbose` is on by default), so you can see exactly what reaches the database:

bash

```
$ npx node-pg-migrate up
> Migrating files:
> - 1791814286546_init-schema
> - 1791814309246_posts-created-at-index
### MIGRATION 1791814286546_init-schema (UP) ###
CREATE TABLE "users" (
  "id" serial PRIMARY KEY,
  "email" text UNIQUE NOT NULL,
  "name" text NOT NULL
);
…
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1791814286546_init-schema', NOW());

### MIGRATION 1791814309246_posts-created-at-index (UP) ###
#> WARNING: Need to break single transaction! <
COMMIT;
CREATE INDEX CONCURRENTLY "posts_created_at_idx" ON "posts" ("created_at");
INSERT INTO "public"."pgmigrations" (name, run_on) VALUES ('1791814309246_posts-created-at-index', NOW());
BEGIN;

Migrations complete!
$ node show-migrations.mjs
pgmigrations: [
  { id: 1, name: '1791814286546_init-schema' },
  { id: 2, name: '1791814309246_posts-created-at-index' }
]
tables: comments, pgmigrations, post_tags, posts, tags, users
$ npx node-pg-migrate down
> Migrating files:
> - 1791814309246_posts-created-at-index
### MIGRATION 1791814309246_posts-created-at-index (DOWN) ###
#> WARNING: Need to break single transaction! <
COMMIT;
DROP INDEX CONCURRENTLY "posts_created_at_idx";
DELETE FROM "public"."pgmigrations" WHERE name='1791814309246_posts-created-at-index';
BEGIN;

Migrations complete!
$ npx node-pg-migrate down
> Migrating files:
> - 1791814286546_init-schema
### MIGRATION 1791814286546_init-schema (DOWN) ###
DROP TABLE "post_tags";
DROP TABLE "tags";
DROP TABLE "comments";
DROP TABLE "posts";
DROP TABLE "users";
DELETE FROM "public"."pgmigrations" WHERE name='1791814286546_init-schema';

Migrations complete!
$ node show-migrations.mjs
pgmigrations: []
tables: pgmigrations
```

Things to notice:

- All pending files run in one transaction by default (`--single-transaction`). For the `noTransaction()` file, the tool prints `WARNING: Need to break single transaction!`, commits, runs the index statement on its own, and opens a new transaction afterwards.
- The history row is written by the same SQL batch as the change (`INSERT INTO "public"."pgmigrations" …`), and `down` deletes it.
- `down` undoes one migration per call, newest first. After both, only the empty `pgmigrations` table is left.

**Example 2 — edge case: a migration from a merged branch sorts before one that already ran.** A developer created `1791814300000_add-users-bio.js` on a branch. Meanwhile `…309246_posts-created-at-index` was merged and applied. The branch is merged later. Its file name sorts *between* two applied migrations:

javascript

```
// migrations/1791814300000_add-users-bio.js — written on a branch, merged after the index migration ran
export const up = (pgm) => {
  pgm.addColumn('users', { bio: { type: 'text' } });
};
// no down: node-pg-migrate reverses addColumn automatically (DROP "bio")
```

bash

```
$ npx node-pg-migrate up
Error: Not run migration 1791814300000_add-users-bio is preceding already run migration 1791814309246_posts-created-at-index
    at checkOrder (file:///…/node_modules/node-pg-migrate/dist/bundle/index.js:3539:40)
…
$ echo $?
1
```

The tool refuses because a database that already ran the index migration would apply `bio` *after* it, while a fresh database would apply it *before*. Here the two changes are independent, so the order does not matter, but the tool cannot know that. The usual fix is to rename the file to a new timestamp (`npx node-pg-migrate create add-users-bio` and move the code into it), so it sorts last everywhere. `--no-check-order` also gets past the check, but every later `up` and `down` then needs the flag too, because the stored order no longer matches the file order.

**Example 3 — a seed script you can run twice.** It loads the shared seed (3 users, 4 posts, 3 comments, 4 tags) in one transaction. Rows are matched by natural keys (`email`, tag `name`, author + title), so a second run inserts nothing.

javascript

```
// seed.mjs — idempotent seed for the shared blog domain (pg 8.23.1). Safe to run twice.
import pg from 'pg';

const users = [['ada@example.com', 'Ada'], ['lin@example.com', 'Lin'], ['grace@example.com', 'Grace']];
const tags = ['sql', 'intro', 'perf', 'node'];
const posts = [ // [author email, title, published, tags]
  ['ada@example.com', 'Hello SQL', true, ['sql', 'intro']],
  ['ada@example.com', 'Indexes', true, ['sql', 'perf']],
  ['lin@example.com', 'Draft', false, []],
  ['grace@example.com', 'Streams', true, ['node']],
];
const comments = [ // [post title, commenter email, body]
  ['Hello SQL', 'lin@example.com', 'Nice'],
  ['Hello SQL', 'grace@example.com', '+1'],
  ['Streams', 'ada@example.com', 'Thanks'],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');
  for (const [email, name] of users) {
    // Natural key (email) + ON CONFLICT: a second run updates nothing and inserts nothing.
    await client.query(
      'INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, name]);
  }
  for (const name of tags) {
    await client.query('INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
  }
  for (const [email, title, published, tagNames] of posts) {
    // posts.title is not UNIQUE, so check by (author, title) instead of ON CONFLICT.
    const { rows } = await client.query(
      `INSERT INTO posts (author_id, title, body, published)
       SELECT u.id, $2, $2 || ' body', $3 FROM users u WHERE u.email = $1
         AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.author_id = u.id AND p.title = $2)
       RETURNING id`, [email, title, published]);
    if (rows.length === 0) continue; // already seeded
    for (const tag of tagNames) {
      await client.query(
        `INSERT INTO post_tags (post_id, tag_id) SELECT $1, id FROM tags WHERE name = $2
         ON CONFLICT DO NOTHING`, [rows[0].id, tag]);
    }
  }
  for (const [title, email, body] of comments) {
    await client.query(
      `INSERT INTO comments (post_id, author_id, body)
       SELECT p.id, u.id, $3 FROM posts p, users u WHERE p.title = $1 AND u.email = $2
         AND NOT EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id AND c.author_id = u.id AND c.body = $3)`,
      [title, email, body]);
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
}
const { rows } = await client.query(`SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM posts) AS posts,
  (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM tags) AS tags, (SELECT count(*) FROM post_tags) AS post_tags`);
console.log('row counts:', rows[0]);
await client.end();
```

bash

```
$ npx node-pg-migrate up > /dev/null
$ node seed.mjs
row counts: { users: '3', posts: '4', comments: '3', tags: '4', post_tags: '5' }
$ node seed.mjs
row counts: { users: '3', posts: '4', comments: '3', tags: '4', post_tags: '5' }
```

The counts are strings because `count(*)` returns `bigint`, which pg returns as a string (lesson 81, Example 2). All seeded posts share one `created_at`, because `now()` returns the start time of the transaction.

**Example 4 — fixtures: each test loads its own small data set.** The test database is built by running the same migrations, so it cannot drift from production's schema. Each test then starts from the same few rows.

javascript

```
// posts.fixture.test.mjs — fixtures: tiny, per-test data that the test owns (node:test + pg 8.23.1)
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

// Each test starts from a known state: empty tables, ids restarting at 1, then only the rows it needs.
async function loadFixture() {
  await pool.query('TRUNCATE users, posts, comments, tags, post_tags RESTART IDENTITY CASCADE');
  await pool.query(`INSERT INTO users (email, name) VALUES ('a@test', 'A'), ('b@test', 'B')`);
  await pool.query(`INSERT INTO posts (author_id, title, body, published) VALUES (1, 'p1', 'x', true), (1, 'draft', 'x', false)`);
  await pool.query(`INSERT INTO comments (post_id, author_id, body) VALUES (1, 2, 'c1'), (1, 2, 'c2')`);
}
beforeEach(loadFixture);
after(() => pool.end());

test('only published posts are listed', async () => {
  const { rows } = await pool.query('SELECT title FROM posts WHERE published ORDER BY id');
  assert.deepEqual(rows.map((r) => r.title), ['p1']);
});

test('deleting a user cascades to their posts and comments', async () => {
  await pool.query('DELETE FROM users WHERE id = 1');
  const { rows } = await pool.query('SELECT (SELECT count(*) FROM posts)::int AS posts, (SELECT count(*) FROM comments)::int AS comments');
  assert.deepEqual(rows[0], { posts: 0, comments: 0 });
});

test('the next test still sees the full fixture', async () => {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM comments');
  assert.equal(rows[0].n, 2);
});
```

bash

```
$ node -e "const pg=require('pg');const c=new pg.Client(process.env.DATABASE_URL);c.connect().then(()=>c.query('CREATE DATABASE app_test')).then(()=>c.end())"
$ DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6601/app_test npx node-pg-migrate up | tail -1
#> WARNING: Need to break single transaction! <
Migrations complete!
$ TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6601/app_test node --test posts.fixture.test.mjs
✔ only published posts are listed (30.854033ms)
✔ deleting a user cascades to their posts and comments (14.468339ms)
✔ the next test still sees the full fixture (12.44394ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.215413
```

The second test deletes user 1 and everything cascades away, yet the third test still finds both comments, because `beforeEach` reloaded the fixture.

**Example 5 — the lab: 2,000,004 posts and a helper that watches locks.** Examples 6–13 run against a database called `lab`: the schema from Example 1, the seed from Example 3, plus two million generated posts.

javascript

```
// lab-setup.mjs — a "lab" database: the shared schema + seed + 2,000,000 extra posts
import pg from 'pg';
import { execSync } from 'node:child_process';
const admin = new pg.Client({ connectionString: 'postgres://postgres:postgres@127.0.0.1:6601/app' });
await admin.connect();
await admin.query('DROP DATABASE IF EXISTS lab WITH (FORCE)');
await admin.query('CREATE DATABASE lab');
await admin.end();
const url = 'postgres://postgres:postgres@127.0.0.1:6601/lab';
execSync('npx node-pg-migrate up', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
execSync('node seed.mjs', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query(`INSERT INTO posts (author_id, title, body, published)
               SELECT 1 + g % 3, 'Post ' || g, 'body', g % 2 = 0 FROM generate_series(1, 2000000) g`);
await c.query('VACUUM ANALYZE posts');
const { rows } = await c.query(`SELECT count(*)::int AS posts, pg_size_pretty(pg_total_relation_size('posts')) AS size FROM posts`);
console.log(rows[0]);
await c.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   { posts: 2000004, size: '185 MB' }
```

The helper opens three connections. **A** runs the migration step, **B** watches `pg_locks`, and **C** plays the running app by sending one `INSERT` 20 ms after the step starts.

javascript

```
// lab-lib.mjs — run one migration step on connection A while connection B watches pg_locks
// and connection C (the running app) tries to INSERT a post. pg 8.23.1, PostgreSQL 18.4.
import pg from 'pg';
const url = process.env.LAB_URL ?? 'postgres://postgres:postgres@127.0.0.1:6601/lab';
export const A = new pg.Client(url), B = new pg.Client(url), C = new pg.Client(url);
await Promise.all([A.connect(), B.connect(), C.connect()]);
const ms = (t) => `${Math.round(performance.now() - t)} ms`;

// Every lock that is held or awaited on the posts table, by role.
async function locksOnPosts() {
  const pids = { [A.processID]: 'A(migration)', [C.processID]: 'C(app)' };
  const { rows } = await B.query(
    `SELECT l.pid, l.mode, l.granted, a.backend_type FROM pg_locks l JOIN pg_stat_activity a USING (pid)
     WHERE l.relation = 'posts'::regclass AND l.pid <> pg_backend_pid() ORDER BY l.pid, l.mode`);
  return rows.map((r) => `${pids[r.pid] ?? r.backend_type} ${r.mode}${r.granted ? '' : ' (WAITING)'}`);
}

// Runs `sql` on A inside BEGIN … COMMIT (or on its own when tx is false). 20 ms in, C sends `appSql`; B samples pg_locks every
// 20 ms while A's statement runs and once more after it finishes (locks are kept until COMMIT).
export async function step(label, sql, appSql, { tx = true } = {}) {
  if (tx) await A.query('BEGIN');
  const t0 = performance.now();
  let done = false;
  const migration = A.query(sql).then(() => { done = true; return ms(t0); });
  await new Promise((r) => setTimeout(r, 20));
  const t1 = performance.now();
  const app = C.query(appSql).then(() => ms(t1), (e) => `failed: ${e.message}`);
  const seen = new Set();
  while (!done) { (await locksOnPosts()).forEach((l) => seen.add(l)); await new Promise((r) => setTimeout(r, 20)); }
  const took = await migration;
  (await locksOnPosts()).forEach((l) => seen.add(l));
  if (tx) await A.query('COMMIT');
  console.log(`${label}\n  statement: ${took} | app INSERT took: ${await app}\n  locks seen: ${[...seen].join('; ')}`);
}
export const end = () => Promise.all([A.end(), B.end(), C.end()]);
```

"app INSERT took" is the time from sending C's `INSERT` until it returned. For steps run in a transaction, that includes waiting until A commits. `locks seen` is sampled every 20 ms, so a lock that is taken and released between two samples is missing. In a repeat run of Example 8, C's quick insert finished between samples and did not appear at all.

**Example 6 — the one-shot migration and the lock it holds.** Add `posts.slug`, fill it, make it NOT NULL, all in one transaction. 200 ms in, the app tries one insert; 300 ms later, B reads `pg_locks`.

javascript

```
// naive.mjs — the one-shot migration: add, fill and constrain in a single transaction
import { A, B, C, end } from './lab-lib.mjs';
const appInsert = `INSERT INTO posts (author_id, title, body) VALUES (1, 'from app', 'x')`;

await A.query('BEGIN');
const t0 = performance.now();
const migration = A.query(`
  ALTER TABLE posts ADD COLUMN slug text;
  UPDATE posts SET slug = 'post-' || id;
  ALTER TABLE posts ALTER COLUMN slug SET NOT NULL;`);
await new Promise((r) => setTimeout(r, 200));
const t1 = performance.now();
const app = C.query(appInsert).then(() => 'ok', (e) => e.message);
await new Promise((r) => setTimeout(r, 300));
const { rows } = await B.query(
  `SELECT pid = $1 AS is_migration, mode, granted FROM pg_locks
   WHERE relation = 'posts'::regclass AND pid <> pg_backend_pid() ORDER BY 1 DESC`, [A.processID]);
console.log('pg_locks on posts while it runs:', rows);
await migration;
console.log(`migration statement: ${Math.round(performance.now() - t0)} ms`);
await A.query('ROLLBACK'); // undo, so the safe version can run on the same table
console.log(`app INSERT: ${await app} after waiting ${Math.round(performance.now() - t1)} ms`);
await end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4, 2,000,004 posts):
//   pg_locks on posts while it runs: [
//     { is_migration: true, mode: 'RowExclusiveLock', granted: true },
//     { is_migration: true, mode: 'AccessExclusiveLock', granted: true },
//     { is_migration: false, mode: 'RowExclusiveLock', granted: false }
//   ]
//   migration statement: 19972 ms
//   app INSERT: ok after waiting 19777 ms
```

The migration holds `AccessExclusiveLock` for the whole run, and the app's insert (`RowExclusiveLock`, `granted: false`) waits the entire time. A real migration would then `COMMIT`, so the insert would have waited until that point. This one rolls back so the next example can use the same table. The app's insert is not undone by that `ROLLBACK`: it ran in its own transaction and committed once the lock was released.

**Example 7 — the same change in safe steps.** C plays the *new* app version, which already writes `slug`.

javascript

```
// safe.mjs — the same change as naive.mjs, split into short steps
import { A, B, C, step, end } from './lab-lib.mjs';
const oldApp = `INSERT INTO posts (author_id, title, body) VALUES (1, 'old app', 'x')`;
const newApp = `INSERT INTO posts (author_id, title, body, slug) VALUES (1, 'new app', 'x', 'new-app')`;

// 1. Nullable column, no default: a catalog change only, no table rewrite.
await step('1. ADD COLUMN slug text', 'ALTER TABLE posts ADD COLUMN slug text', oldApp);

// 2. Backfill in batches; each batch is its own short transaction.
const { rows: [{ max }] } = await B.query('SELECT max(id) FROM posts');
const t0 = performance.now();
let batches = 0, slowest = 0;
for (let from = 1; from <= max; from += 50_000) {
  const tb = performance.now();
  await A.query(`UPDATE posts SET slug = 'post-' || id
                 WHERE id >= $1 AND id < $2 AND slug IS NULL`, [from, from + 50_000]);
  slowest = Math.max(slowest, performance.now() - tb);
  batches++;
}
console.log(`2. backfill: ${batches} batches of 50,000 in ${Math.round(performance.now() - t0)} ms, slowest batch ${Math.round(slowest)} ms`);

// 3. Promise NOT NULL for new rows only: no scan.
await step('3. ADD CONSTRAINT … CHECK (slug IS NOT NULL) NOT VALID',
  'ALTER TABLE posts ADD CONSTRAINT posts_slug_not_null CHECK (slug IS NOT NULL) NOT VALID', newApp);

// 4. Check the old rows: a full scan, but under a lock that lets writes through.
await step('4. VALIDATE CONSTRAINT', 'ALTER TABLE posts VALIDATE CONSTRAINT posts_slug_not_null', newApp);

// 5. SET NOT NULL can now trust the valid CHECK and skip its own scan.
await step('5. SET NOT NULL (valid CHECK exists)', 'ALTER TABLE posts ALTER COLUMN slug SET NOT NULL', newApp);

// 6. The CHECK is redundant now.
await step('6. DROP CONSTRAINT posts_slug_not_null', 'ALTER TABLE posts DROP CONSTRAINT posts_slug_not_null', newApp);

const { rows } = await B.query(`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'posts'::regclass AND attname = 'slug'`);
console.log('slug is NOT NULL:', rows[0].attnotnull);
await end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4, 2,000,004 posts):
//   1. ADD COLUMN slug text
//     statement: 1 ms | app INSERT took: 9 ms
//     locks seen: A(migration) AccessExclusiveLock; C(app) RowExclusiveLock (WAITING)
//   2. backfill: 41 batches of 50,000 in 62839 ms, slowest batch 13589 ms
//   3. ADD CONSTRAINT … CHECK (slug IS NOT NULL) NOT VALID
//     statement: 2 ms | app INSERT took: 3 ms
//     locks seen: A(migration) AccessExclusiveLock; C(app) RowExclusiveLock (WAITING)
//   4. VALIDATE CONSTRAINT
//     statement: 879 ms | app INSERT took: 3 ms
//     locks seen: A(migration) ShareUpdateExclusiveLock; C(app) RowExclusiveLock
//   5. SET NOT NULL (valid CHECK exists)
//     statement: 1 ms | app INSERT took: 3 ms
//     locks seen: A(migration) AccessExclusiveLock; C(app) RowExclusiveLock (WAITING)
//   6. DROP CONSTRAINT posts_slug_not_null
//     statement: 1 ms | app INSERT took: 3 ms
//     locks seen: A(migration) AccessExclusiveLock; C(app) RowExclusiveLock (WAITING)
//   slug is NOT NULL: true
```

Compare it with Example 6:

- The backfill does the same amount of work as the one-shot `UPDATE`, but no single lock lasts longer than one batch.
- Steps 1, 3, 5 and 6 still take `AccessExclusiveLock`, and the app's insert does wait (`WAITING`), but only for a few milliseconds.
- Step 4 is the long scan, and the app's insert went straight through: `ShareUpdateExclusiveLock` does not conflict with the `RowExclusiveLock` an `INSERT` needs.
- Step 5 took about 1 ms because the valid CHECK let PostgreSQL skip the scan that `SET NOT NULL` does in Example 6.

In this run one backfill batch took 13.6 s while the others were far shorter. Long batches lock only the 50,000 rows they update, so the app's inserts of new rows are not affected, but an app `UPDATE` of one of those rows would wait. If a batch is slow, make the batches smaller.

**Example 8 — PostgreSQL 18: NOT NULL itself can be NOT VALID.** This continues on the table from Example 7. It first drops the NOT NULL so it can add it again the new way.

javascript

```
// pg18-notnull.mjs — PostgreSQL 18: a NOT NULL constraint can itself be NOT VALID
import { A, B, step, end } from './lab-lib.mjs';
const newApp = `INSERT INTO posts (author_id, title, body, slug) VALUES (1, 'new app', 'x', 'new-app')`;
await A.query('ALTER TABLE posts ALTER COLUMN slug DROP NOT NULL'); // undo safe.mjs's step 5

await step('a. ADD CONSTRAINT posts_slug_nn NOT NULL slug NOT VALID',
  'ALTER TABLE posts ADD CONSTRAINT posts_slug_nn NOT NULL slug NOT VALID', newApp);
const show = () => B.query(`SELECT c.conname, c.contype, c.convalidated, a.attnotnull
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.conrelid = 'posts'::regclass AND c.conname = 'posts_slug_nn'`).then((r) => console.log('  ', r.rows[0]));
await show();
try {
  await A.query(`INSERT INTO posts (author_id, title, body) VALUES (1, 'no slug', 'x')`);
} catch (e) { console.log('  insert without slug:', e.message, `(${e.code})`); }
await step('b. VALIDATE CONSTRAINT posts_slug_nn', 'ALTER TABLE posts VALIDATE CONSTRAINT posts_slug_nn', newApp);
await show();
await end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4, 2,000,004 posts):
//   a. ADD CONSTRAINT posts_slug_nn NOT NULL slug NOT VALID
//     statement: 1 ms | app INSERT took: 8 ms
//     locks seen: A(migration) AccessExclusiveLock; C(app) RowExclusiveLock (WAITING)
//      {
//     conname: 'posts_slug_nn',
//     contype: 'n',
//     convalidated: false,
//     attnotnull: true
//   }
//     insert without slug: null value in column "slug" of relation "posts" violates not-null constraint (23502)
//   b. VALIDATE CONSTRAINT posts_slug_nn
//     statement: 348 ms | app INSERT took: 1 ms
//     locks seen: A(migration) ShareUpdateExclusiveLock; C(app) RowExclusiveLock
//      {
//     conname: 'posts_slug_nn',
//     contype: 'n',
//     convalidated: true,
//     attnotnull: true
//   }
```

The NOT NULL constraint is now a named row in `pg_constraint` (`contype: 'n'`). `convalidated: false` until `VALIDATE`, which scans under `ShareUpdateExclusiveLock` and lets writes through, the same as the CHECK route. So on PostgreSQL 18 steps 3–7 of the pattern become two statements. On PostgreSQL 17 and earlier, `NOT VALID` on a NOT NULL constraint is a syntax error. Use the CHECK route there.

**Example 9 — edge case: `ADD COLUMN … DEFAULT` is instant or a full rewrite, depending on the default.**

javascript

```
// add-default.mjs — ADD COLUMN … DEFAULT: constant default vs volatile default, on 2,000,000 posts
import pg from 'pg';
const db = new pg.Client(process.env.LAB_URL ?? 'postgres://postgres:postgres@127.0.0.1:6601/lab');
await db.connect();
const relfile = async () => (await db.query(`SELECT pg_relation_filenode('posts') AS f`)).rows[0].f;
async function timed(sql) {
  const before = await relfile();
  const t = performance.now();
  await db.query(sql);
  const took = Math.round(performance.now() - t);
  console.log(`${sql}\n  ${took} ms, table rewritten: ${before !== (await relfile())}`);
}
await timed('ALTER TABLE posts ADD COLUMN views int NOT NULL DEFAULT 0');      // stored in the catalog
await timed('ALTER TABLE posts ADD COLUMN token float8 NOT NULL DEFAULT random()'); // must be computed per row
await db.query('ALTER TABLE posts DROP COLUMN views, DROP COLUMN token');
await db.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4, 2,000,004 posts):
//   ALTER TABLE posts ADD COLUMN views int NOT NULL DEFAULT 0
//     2 ms, table rewritten: false
//   ALTER TABLE posts ADD COLUMN token float8 NOT NULL DEFAULT random()
//     3708 ms, table rewritten: true
```

A rewrite gives the table a new data file, so `pg_relation_filenode` changes. With a constant default, PostgreSQL stores the value in the catalog and returns it for old rows, with no rewrite (changed in PostgreSQL 11). A volatile default such as `random()`, `clock_timestamp()` or `gen_random_uuid()` must be computed for each existing row, so the whole table is rewritten under `ACCESS EXCLUSIVE`. That makes `NOT NULL DEFAULT 0` safe for a big table, while `DEFAULT gen_random_uuid()` is not: add that column nullable and backfill it instead.

**Example 10 — `CREATE INDEX` vs `CREATE INDEX CONCURRENTLY`, and the transaction rule.**

javascript

```
// index.mjs — CREATE INDEX vs CREATE INDEX CONCURRENTLY on 2,000,000 posts
import { A, B, step, end } from './lab-lib.mjs';
const app = `INSERT INTO posts (author_id, title, body, slug) VALUES (1, 'app', 'x', 'app')`;

// 1. CONCURRENTLY inside a transaction block is refused.
await A.query('BEGIN');
try {
  await A.query('CREATE INDEX CONCURRENTLY posts_author_created_idx ON posts (author_id, created_at)');
} catch (e) { console.log('inside BEGIN:', e.message, `(${e.code})`); }
await A.query('ROLLBACK');

// 2. So is a multi-statement query string: PostgreSQL runs it as one implicit transaction.
try {
  await A.query('SET lock_timeout = 0; CREATE INDEX CONCURRENTLY posts_author_created_idx ON posts (author_id, created_at)');
} catch (e) { console.log('multi-statement string:', e.message, `(${e.code})`); }

// 3. Plain CREATE INDEX: writes wait for the whole build.
await step('CREATE INDEX', 'CREATE INDEX posts_author_created_idx ON posts (author_id, created_at)', app, { tx: false });
await A.query('DROP INDEX posts_author_created_idx');

// 4. CONCURRENTLY: writes keep going; the build takes longer.
await step('CREATE INDEX CONCURRENTLY',
  'CREATE INDEX CONCURRENTLY posts_author_created_idx ON posts (author_id, created_at)', app, { tx: false });
await end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4, 2,000,004 posts):
//   inside BEGIN: CREATE INDEX CONCURRENTLY cannot run inside a transaction block (25001)
//   multi-statement string: CREATE INDEX CONCURRENTLY cannot run inside a transaction block (25001)
//   CREATE INDEX
//     statement: 1461 ms | app INSERT took: 1443 ms
//     locks seen: A(migration) ShareLock; C(app) RowExclusiveLock (WAITING); parallel worker ShareLock
//   CREATE INDEX CONCURRENTLY
//     statement: 1533 ms | app INSERT took: 2 ms
//     locks seen: A(migration) ShareUpdateExclusiveLock; C(app) RowExclusiveLock; parallel worker ShareUpdateExclusiveLock
```

The second error catches people who never typed `BEGIN`. When pg sends a query string with several statements and no parameters, PostgreSQL runs them as one implicit transaction, so `CONCURRENTLY` is refused there too. Send it as its own `query()` call. The `parallel worker` rows are extra processes PostgreSQL started to help build the index; they take the same lock mode as the main process.

**Example 11 — edge case: a failed concurrent build leaves an INVALID index.**

javascript

```
// invalid-index.mjs — a failed CREATE UNIQUE INDEX CONCURRENTLY leaves an INVALID index behind
import pg from 'pg';
const db = new pg.Client(process.env.LAB_URL ?? 'postgres://postgres:postgres@127.0.0.1:6601/lab');
await db.connect();
await db.query(`INSERT INTO posts (author_id, title, body, slug) VALUES (1, 'dup', 'x', 'd1'), (2, 'dup', 'x', 'd2')`);
try {
  await db.query('CREATE UNIQUE INDEX CONCURRENTLY posts_title_key ON posts (title)');
} catch (e) { console.log('build failed:', e.message, `(${e.code})`); }

const invalid = () => db.query(`SELECT indexrelid::regclass AS index, indisvalid FROM pg_index
                                WHERE indrelid = 'posts'::regclass AND NOT indisvalid`);
console.log('left behind:', (await invalid()).rows);
try {
  await db.query('CREATE UNIQUE INDEX CONCURRENTLY posts_title_key ON posts (title)'); // the retry
} catch (e) { console.log('retry:', e.message, `(${e.code})`); }
// The invalid index is not used for reads but is still updated on every write. Drop it, then retry.
await db.query('DROP INDEX CONCURRENTLY posts_title_key');
await db.query(`DELETE FROM posts WHERE title = 'dup'`);
console.log('after DROP INDEX CONCURRENTLY:', (await invalid()).rows);
await db.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   build failed: could not create unique index "posts_title_key" (23505)
//   left behind: [ { index: 'posts_title_key', indisvalid: false } ]
//   retry: relation "posts_title_key" already exists (42P07)
//   after DROP INDEX CONCURRENTLY: []
```

A plain `CREATE INDEX` that fails rolls back completely. A concurrent one has already committed the index's catalog entry, so the name stays taken, and a migration that simply retries fails with `42P07`. A down migration or a pre-check should run `DROP INDEX CONCURRENTLY IF EXISTS` before retrying.

**Example 12 — a blocked ALTER, the queue behind it, and `lock_timeout`.** Connection L plays a long report: it opens a transaction, reads `posts` and stays open.

javascript

```
// lock-timeout.mjs — an ALTER stuck behind a long transaction, and the same ALTER with lock_timeout
import pg from 'pg';
import { A, B, C, end } from './lab-lib.mjs';
const L = new pg.Client(process.env.LAB_URL ?? 'postgres://postgres:postgres@127.0.0.1:6601/lab');
await L.connect();
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const since = (t) => `${Math.round(performance.now() - t)} ms`;
const who = { [L.processID]: 'L(report)', [A.processID]: 'A(migration)', [C.processID]: 'C(app)' };
async function snapshot() {
  const { rows } = await B.query(
    `SELECT l.pid, l.mode, l.granted, a.wait_event_type FROM pg_locks l JOIN pg_stat_activity a USING (pid)
     WHERE l.relation = 'posts'::regclass AND l.pid = ANY($1) ORDER BY l.granted DESC, l.pid`,
    [[L.processID, A.processID, C.processID]]);
  for (const r of rows) console.log(`   ${who[r.pid]} ${r.mode} granted=${r.granted} wait=${r.wait_event_type}`);
}

// A long transaction that has read posts: it holds AccessShareLock until it ends.
await L.query('BEGIN');
await L.query('SELECT count(*) FROM posts');

console.log('1. ALTER with no lock_timeout (the default, 0 = wait forever)');
let t = performance.now();
const alter = A.query('ALTER TABLE posts ADD COLUMN views int').then(() => `done after ${since(t)}`, (e) => e.message);
await sleep(200);
const tc = performance.now();
const read = C.query('SELECT title FROM posts WHERE id = 1').then(() => `C's SELECT returned after ${since(tc)}`);
await sleep(1000);
await snapshot();
await B.query('SELECT pg_cancel_backend($1)', [A.processID]); // what an operator does by hand
console.log('  ', await alter);
console.log('  ', await read);

console.log('2. the same ALTER with SET lock_timeout = \'500ms\'');
await A.query(`SET lock_timeout = '500ms'`);
t = performance.now();
const failing = A.query('ALTER TABLE posts ADD COLUMN views int')
  .catch((e) => console.log(`   ${e.message} (${e.code}) after ${since(t)}`));
await sleep(100);
const tc2 = performance.now();
await C.query('SELECT title FROM posts WHERE id = 1');
console.log(`   C's SELECT returned after ${since(tc2)}`);
await failing;

console.log('3. retry with backoff while the report finishes');
setTimeout(() => L.query('COMMIT'), 1800); // the report ends 1.8 s from now
for (let attempt = 1; ; attempt++) {
  try {
    await A.query('ALTER TABLE posts ADD COLUMN views int');
    console.log(`   attempt ${attempt}: ok`);
    break;
  } catch (e) {
    if (e.code !== '55P03' || attempt === 10) throw e;
    console.log(`   attempt ${attempt}: ${e.message}, retrying in 300 ms`);
    await sleep(300);
  }
}
await A.query('ALTER TABLE posts DROP COLUMN views');
await L.end();
await end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   1. ALTER with no lock_timeout (the default, 0 = wait forever)
//      L(report) AccessShareLock granted=true wait=Client
//      A(migration) AccessExclusiveLock granted=false wait=Lock
//      C(app) AccessShareLock granted=false wait=Lock
//      canceling statement due to user request
//      C's SELECT returned after 1008 ms
//   2. the same ALTER with SET lock_timeout = '500ms'
//      canceling statement due to lock timeout (55P03) after 501 ms
//      C's SELECT returned after 401 ms
//   3. retry with backoff while the report finishes
//      attempt 1: canceling statement due to lock timeout, retrying in 300 ms
//      attempt 2: canceling statement due to lock timeout, retrying in 300 ms
//      attempt 3: ok
```

Read the snapshot in part 1 from the top:

1. L holds `AccessShareLock` and is idle (`wait=Client`: it is waiting for its client to send the next command).
2. A wants `AccessExclusiveLock`, which conflicts with L's lock, so it waits (`granted=false wait=Lock`).
3. C wants only `AccessShareLock`, which does *not* conflict with L. It still waits, because PostgreSQL grants locks in queue order and A is ahead of it.

C's one-row `SELECT` waited until someone cancelled A. Without that manual cancel, it would have waited until the report ended. With `lock_timeout = '500ms'`, the same `ALTER` gives up after 501 ms, C's `SELECT` waits less than that, and the retry loop gets the lock as soon as the report commits.

**Example 13 — expand and contract: renaming `users.name` to `users.full_name` while v1 and v2 both run.**

javascript

```
// rename.mjs — renaming users.name to users.full_name while v1 and v2 of the app both run
import pg from 'pg';
const db = new pg.Client(process.env.LAB_URL ?? 'postgres://postgres:postgres@127.0.0.1:6601/lab');
await db.connect();
const v1 = { // the old app only knows "name"
  add: (email, n) => db.query('INSERT INTO users (email, name) VALUES ($1, $2)', [email, n]),
  rename: (email, n) => db.query('UPDATE users SET name = $2 WHERE email = $1', [email, n]),
  list: () => db.query('SELECT name FROM users ORDER BY id').then((r) => r.rows.map((x) => x.name).join(', ')),
};
const v2 = { // the new app only knows "full_name"
  add: (email, n) => db.query('INSERT INTO users (email, full_name) VALUES ($1, $2)', [email, n]),
  list: () => db.query('SELECT full_name FROM users ORDER BY id').then((r) => r.rows.map((x) => x.full_name).join(', ')),
};
const tryIt = (label, fn) => fn().then((r) => console.log(`   ${label}: ${typeof r === 'string' ? r : 'ok'}`),
  (e) => console.log(`   ${label}: ERROR ${e.message} (${e.code})`));

console.log('0. one-step RENAME COLUMN (rolled back)');
await db.query('BEGIN');
await db.query('ALTER TABLE users RENAME COLUMN name TO full_name');
await tryIt('v1 list', v1.list);
await db.query('ROLLBACK');

console.log('1. expand: add full_name, keep both columns in sync with a trigger');
await db.query(`
  ALTER TABLE users ADD COLUMN full_name text;
  CREATE FUNCTION users_sync_name() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      NEW.full_name := coalesce(NEW.full_name, NEW.name);
      NEW.name      := coalesce(NEW.name, NEW.full_name);
    ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
      NEW.full_name := NEW.name;
    ELSIF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
      NEW.name := NEW.full_name;
    END IF;
    RETURN NEW;
  END $$;
  CREATE TRIGGER users_sync_name BEFORE INSERT OR UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION users_sync_name();`);

console.log('2. backfill old rows (batch this on a big table)');
const { rowCount } = await db.query('UPDATE users SET full_name = name WHERE full_name IS NULL');
console.log(`   backfilled ${rowCount} rows`);

console.log('3. v1 and v2 run side by side');
await tryIt('v1 add Linus', () => v1.add('linus@example.com', 'Linus'));
await tryIt('v2 add Barbara', () => v2.add('barbara@example.com', 'Barbara'));
await tryIt('v1 renames Lin -> Lin Q', () => v1.rename('lin@example.com', 'Lin Q'));
await tryIt('v1 list', v1.list);
await tryIt('v2 list', v2.list);

console.log('4. contract (only after every v1 instance is gone)');
await db.query(`
  DROP TRIGGER users_sync_name ON users;
  DROP FUNCTION users_sync_name();
  ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;
  ALTER TABLE users DROP COLUMN name;`);
await tryIt('v2 add Edsger', () => v2.add('edsger@example.com', 'Edsger'));
await tryIt('v1 list', v1.list);
await db.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   0. one-step RENAME COLUMN (rolled back)
//      v1 list: ERROR column "name" does not exist (42703)
//   1. expand: add full_name, keep both columns in sync with a trigger
//   2. backfill old rows (batch this on a big table)
//      backfilled 3 rows
//   3. v1 and v2 run side by side
//      v1 add Linus: ok
//      v2 add Barbara: ok
//      v1 renames Lin -> Lin Q: ok
//      v1 list: Ada, Lin Q, Grace, Linus, Barbara
//      v2 list: Ada, Lin Q, Grace, Linus, Barbara
//   4. contract (only after every v1 instance is gone)
//      v2 add Edsger: ok
//      v1 list: ERROR column "name" does not exist (42703)
```

Three details make this work:

- `name` is still `NOT NULL`, yet v2's insert, which never mentions `name`, succeeds. A `BEFORE` trigger runs before constraints are checked, so the trigger fills `name` in time.
- v1's rename of Lin shows up in v2's list, because the `UPDATE` branch copies whichever column changed.
- The final `v1 list` error is the expected end state: the contract step runs only after every v1 instance has stopped. On a large table, the contract's `SET NOT NULL` should use the pattern from Example 7 or 8.

## Common mistakes & gotchas

- **Editing a migration that already ran.** The history table stores only the file name, so databases that ran the old version never see your change, and new databases get a different schema. Add a new migration instead.
- **One transaction for add + backfill + constrain.** The first `ALTER` takes `ACCESS EXCLUSIVE`, and the lock lasts until `COMMIT`. In Example 6, the app's insert waited 19.8 s.
- **`SET NOT NULL` straight on a big table.** It scans the whole table under `ACCESS EXCLUSIVE`. Add a `CHECK … NOT VALID`, `VALIDATE` it, then `SET NOT NULL` (or on PostgreSQL 18, `ADD CONSTRAINT … NOT NULL … NOT VALID` + `VALIDATE`).
- **A volatile default on a new column.** `DEFAULT gen_random_uuid()` or `DEFAULT random()` rewrites the table: 3.7 s to 44 s for 2 million rows in Example 9's runs. Constant defaults are instant.
- **`CREATE INDEX CONCURRENTLY` inside the migration transaction.** Error `25001`. It also fails inside a multi-statement query string. Opt that one migration out of the transaction (`pgm.noTransaction()`, Knex `config.transaction = false`).
- **Retrying a failed concurrent index build.** The INVALID index from the failed run is still there, so the retry fails with `42P07`, and the leftover index is still updated on every write. Drop it with `DROP INDEX CONCURRENTLY` first.
- **No `lock_timeout`.** A 2 ms `ALTER` that waits behind a long transaction blocks every later query on that table, including reads. Set `lock_timeout` in the migration session and retry.
- **Renaming or dropping a column in the same deploy as the code change.** Old instances that are still running break immediately. Use expand and contract over several deploys.
- **Assuming down migrations restore data.** Dropping a column in `down` deletes what was written to it. Down is for development and for failed deploys before any data depends on the change.
- **Seed scripts that are not idempotent.** Running a plain `INSERT` seed twice creates duplicate rows or fails on a UNIQUE constraint. Use natural keys with `ON CONFLICT DO NOTHING` or `NOT EXISTS`.
- **Tests sharing state.** Without a per-test reset, one test's deleted rows break the next test. Truncate with `RESTART IDENTITY CASCADE`, or wrap each test in a transaction and roll it back.

## Best practices

- **Every schema change is a migration file in git,** reviewed like code and applied by the tool, never by hand. Build test and CI databases from the same migrations.
- **Run migrations as a separate deploy step,** before the new app version starts, and only one at a time (the tool's lock covers this).
- **Set `lock_timeout` (a few hundred ms to a few seconds) in the migration session** and retry with backoff. Consider `statement_timeout` for statements that should never run long.
- **Keep each migration to one kind of change.** Put locking DDL and long scans in separate migrations, so a failure is easy to locate and retry.
- **Batch backfills** in small transactions, by primary-key range, and make them restartable (`WHERE new_col IS NULL`).
- **Use `NOT VALID` + `VALIDATE CONSTRAINT`** for CHECK, foreign key and (PostgreSQL 18) NOT NULL constraints on existing tables.
- **Build and drop indexes `CONCURRENTLY`** on tables that take writes, in a migration that runs outside a transaction, and check for INVALID leftovers.
- **Plan renames and type changes as expand → switch → contract,** with a sync trigger or dual writes while both versions run.
- **Keep seed scripts idempotent and separate from migrations.** Only put data in a migration when every environment needs it.
- **Test the down migration in CI** (up → down → up) if you rely on it, so it is not first run during an incident.

## ⭐ Interview lens

> **Q: “Why do migration tools keep a table in the database?”**  
> A: The table records which migration files have been applied to *that* database. The tool compares it with the files in git and runs only the missing ones, in filename order, recording each one in the same transaction as the change. That is how a laptop, CI and production end up with the same schema from the same files. It also lets the tool refuse to run when an unapplied file sorts before an applied one, which would apply changes in different orders on different databases. *Trap:* editing an applied migration. The table stores only the name, so the edit never runs where the old version already ran.

> **Q: “How do you add a NOT NULL column to a table with millions of rows without downtime?”**  
> A: Add it nullable (catalog-only, milliseconds). Deploy code that writes it. Backfill in batches of small transactions. Add `CHECK (col IS NOT NULL) NOT VALID`, then `VALIDATE CONSTRAINT`, which scans under `SHARE UPDATE EXCLUSIVE` and lets writes through. Then `SET NOT NULL` skips its scan because a valid CHECK proves it, and you drop the CHECK. On PostgreSQL 18 you can add the NOT NULL constraint itself as `NOT VALID` and validate it. If a constant default works, `ADD COLUMN … NOT NULL DEFAULT 0` is instant since PostgreSQL 11. *Trap:* a volatile default such as `gen_random_uuid()` rewrites the whole table.

> **Q: “Why can't `CREATE INDEX CONCURRENTLY` run in a transaction, and what happens if it fails?”**  
> A: It runs as several transactions of its own: it registers the index, waits for existing transactions, scans the table twice and waits again. A surrounding `BEGIN` would make that impossible, so PostgreSQL rejects it with `25001`. Migration tools need a per-migration opt-out. If it fails, for example on a duplicate in a unique index, it leaves an INVALID index that is ignored by queries but still updated on writes. Drop it with `DROP INDEX CONCURRENTLY` and retry.

> **Q: “A 2 ms `ALTER TABLE` took the site down. How?”**  
> A: It needed `ACCESS EXCLUSIVE` and had to wait for a long-running transaction that had read the table. While it waited at the head of the lock queue, every new query on that table, including plain `SELECT`s, queued behind it. Set `lock_timeout` in the migration session so the `ALTER` gives up quickly (`55P03`) and retries later, and watch for long transactions in `pg_stat_activity`.

> **Q: “Seed data or fixtures?”**  
> A: Seed data makes a new database usable (lookup rows, a demo account), stays in place and must be idempotent. Fixtures are per-test rows that put one test in a known state and are wiped before the next test. Mixing them makes tests depend on whatever the seed happens to contain.

## Cheat-card

- **Migration:** versioned file with `up` (apply) and `down` (reverse), run in filename order; the tool records each in a history table (`pgmigrations`, `_prisma_migrations`, `__drizzle_migrations`, `SequelizeMeta`, `migrations`, `knex_migrations`).
- **node-pg-migrate 9.0.0:** `create <name>`, `up`, `down`, `redo`; `DATABASE_URL`; `migrations/`; `pgm.noTransaction()`; advisory lock; refuses out-of-order files unless `--no-check-order`.
- **Lock modes:** most `ALTER TABLE` → `ACCESS EXCLUSIVE` (blocks reads and writes); `CREATE INDEX` → `SHARE` (blocks writes); `VALIDATE CONSTRAINT` and `CREATE INDEX CONCURRENTLY` → `SHARE UPDATE EXCLUSIVE` (writes continue).
- **NOT NULL column:** nullable add → batched backfill → `CHECK … NOT VALID` → `VALIDATE` → `SET NOT NULL` (no scan) → drop CHECK. PostgreSQL 18: `ADD CONSTRAINT x NOT NULL col NOT VALID` → `VALIDATE`.
- **Defaults:** constant `DEFAULT` = instant (PostgreSQL 11+); volatile default = full rewrite.
- **`CONCURRENTLY`:** not in a transaction or multi-statement string (`25001`); a failure leaves an INVALID index, so drop it before retrying.
- **`lock_timeout`:** default 0 = wait forever; set it per session, catch `55P03`, retry with backoff.
- **Zero downtime:** every migration works with app N and N+1; add before use, remove after last use; expand → switch → contract for renames.
- **Seed vs fixture:** idempotent and kept vs per-test and wiped.
- **Versions used:** Node v24.19.0, PostgreSQL 18.4, pg 8.23.1, node-pg-migrate 9.0.0; table facts checked against prisma 7.10.0, drizzle-kit 0.31.11, sequelize-cli 6.6.5, umzug 3.8.3, typeorm 1.1.2, knex 3.3.0.

---

## Learn More

- [ALTER TABLE (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/sql-altertable.html)
- [Explicit Locking: table-level lock modes (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/explicit-locking.html)
- [CREATE INDEX, including CONCURRENTLY (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/sql-createindex.html)
- [Client connection defaults: lock_timeout (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/runtime-config-client.html)
- [node-pg-migrate: Getting started salsita.github.io](https://salsita.github.io/node-pg-migrate/getting-started)
- [node-pg-migrate: Defining migrations salsita.github.io](https://salsita.github.io/node-pg-migrate/migrations/)
- [Customizing migrations, incl. expand and contract (Prisma ORM v7) prisma.io](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations)
- [Migrations (Knex) knexjs.org](https://knexjs.org/guide/migrations.html)
