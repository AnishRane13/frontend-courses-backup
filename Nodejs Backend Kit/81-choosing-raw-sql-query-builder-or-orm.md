---
title: "Choosing Between Raw SQL, a Query Builder and an ORM"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Choosing Between Raw SQL, a Query Builder and an ORM

*16 min read · Updated 12 Oct 2026 · Topic 106 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and PostgreSQL 18.4 (run locally via the embedded-postgres npm package, no Docker), pg 8.23.1, `node:sqlite` with SQLite 3.53.3

---

## Why it matters

Lessons 76–79 built the same blog (users, posts, comments, tags) with Prisma, Drizzle, Sequelize, TypeORM and Knex. Each tool sits at a different distance from SQL, and that distance decides four things you will live with for years:

- **What the compiler catches.** A typo in a column name can fail at build time, or in production on the first request that runs that query.
- **What you can see.** When a page is slow, you need the exact SQL that ran. Some tools show you the SQL you wrote; others generate it, and you have to turn on logging to find it.
- **How the schema changes.** Some tools generate migrations from a schema file. With others, you write every migration by hand (lesson 80).
- **What happens at the edges.** Every tool eventually meets a query it cannot express: a window function, a `LATERAL` join, `FOR UPDATE SKIP LOCKED`. Then you need an escape hatch to raw SQL that is still parameterised.

Picking the wrong layer is expensive to undo, because the choice spreads into every repository file. This lesson compares the layers side by side, writes the shared canonical query in plain SQL, and shows `node:sqlite`, which needs no npm package at all.

## The concept, simply

There are three layers between your code and the database:

text

```
          your code
             │
   ┌─────────┼──────────────────────────────┐
   │ ORM     │ Prisma, Sequelize, TypeORM    │  objects, relations, "include the author"
   │         ▼                               │  → generates SQL for you
   │ query builder │ Knex, Drizzle           │  SQL clauses as function calls
   │         ▼                               │  → you choose the SQL shape, it writes the text
   │ driver  │ pg, node:sqlite              │  SQL text + parameters in, rows out
   └─────────┼──────────────────────────────┘
             ▼
          database
```

- **A driver** (`pg`, `node:sqlite`) sends SQL text and parameter values to the database and gives back rows as plain objects. You write every query.
- **A query builder** (Knex, Drizzle) lets you build that SQL from function calls: `.select()`, `.where()`, `.join()`. You still decide which tables to join and how. The builder writes the text and the placeholders.
- **An ORM** (Prisma, Sequelize, TypeORM) maps tables to models and relations. You ask for "posts with their author and comments", and it decides which SQL to run, sometimes one query, sometimes several.

Each layer up removes typing work and adds something to learn and something you no longer see directly. Drizzle sits between the last two layers: it has a builder that looks like SQL and a relational query API that works like an ORM.

## How it works

How to choose, as a sequence of questions:

1. **How complex are your queries?** Reporting, analytics, heavy use of `GROUP BY`, CTEs and window functions: stay close to SQL (raw `pg`, Knex, Drizzle's builder). Mostly create/read/update by id, with relations: an ORM saves the most code.
2. **How much do you want the compiler to check?** If you use TypeScript and want column names and result types checked, use a tool that knows your schema: Drizzle (types come from the TypeScript schema) or Prisma (types are generated from `schema.prisma`). TypeORM and Sequelize give types for models you declare. Raw `pg` and untyped Knex give you `any` unless you write the row types yourself.
3. **Who owns the schema?** If the database already exists or is shared with other services, pick a tool that does not insist on generating migrations from its own schema file. You can pair raw `pg` or Knex with node-pg-migrate or Knex migrations. If your app owns the database, a tool that diffs its schema into migrations (Prisma Migrate, Drizzle Kit, TypeORM `migration:generate`) saves work. Read every generated file before applying it (lesson 80: a renamed field can become a DROP).
4. **Can you see and control the SQL?** For a hot path, you need the exact SQL and its plan (`EXPLAIN ANALYZE`). Every tool here can log its SQL. With raw SQL the text in your code is the text that runs. With an ORM, you check the log after each change.
5. **What is the escape hatch?** Check that the tool has a parameterised raw-SQL call and that it works inside the tool's transactions. All five do (table below).
6. **Do you need a server at all?** For a CLI, a desktop app, tests or a small single-process service, SQLite through `node:sqlite` needs no server and no npm dependency (Examples 3 and 4).

**The decision table.** The facts come from each library's docs and type definitions (versions in the Cheat-card). The lessons have the runnable examples.

| | Raw `pg` | Knex | Drizzle | Prisma | Sequelize | TypeORM |
|---|---|---|---|---|---|---|
| **Layer** | Driver | Query builder | Query builder + relational API | ORM | ORM | ORM (Active Record or Data Mapper) |
| **Type safety** | None by default; `pool.query<Row>()` (from `@types/pg`) only asserts the type you give it | Rows are `any` unless you declare table types in a `Tables` interface (`knex/types/tables`) | Inferred from the TypeScript schema; columns and results are checked | Generated from `schema.prisma` by `prisma generate`; queries and results are checked | Model types you declare (`InferAttributes<User>` in v6) | Entity classes give types; QueryBuilder string column names are not checked |
| **Can you see the SQL?** | Yes: it is the text you wrote | `.toSQL()` / `.toString()` on a query; `debug: true` | `.toSQL()` on a query; `logger: true` | `log: ['query']` on the client | Logged with `console.log` by default (`logging` option) | `logging` option; `.getSql()` on a QueryBuilder |
| **Migrations** | None built in; pair with node-pg-migrate (lesson 80) | `knex migrate:make/latest/rollback`, hand-written up/down | `drizzle-kit generate` from the schema diff, `migrate`, `push`; no rollback command | Prisma Migrate: generated SQL files, no down files | `sequelize-cli` / Umzug, hand-written up/down | `migration:generate` from the entity diff, `run`, `revert` |
| **What you must learn** | SQL, the driver API (`query`, `Pool`, transactions on one client) | SQL plus the builder's method names | SQL-like TypeScript API, the schema DSL, drizzle-kit | Prisma schema language, the client API, the generate step | Models, associations, hooks, `Op` operators | Entities and decorators (needs `reflect-metadata`; `EntitySchema` without decorators), DataSource, repositories, QueryBuilder |
| **Escape hatch to raw SQL** | — | `knex.raw('… ?', [v])` | `` sql`… ${v}` `` with `db.execute()` | `` prisma.$queryRaw`… ${v}` ``, `$executeRaw` (parameterised); `$queryRawUnsafe` (not) | `sequelize.query('… ?', { replacements })` | `dataSource.query('… $1', [v])` |
| **Lesson** | [45](73-sql-basics-from-node.md), [46](74-connection-pooling.md), this lesson | [104](76-knex-query-builder.md) | [102](78-drizzle-orm.md) | [101](77-prisma-orm.md) | [103](79-sequelize-and-typeorm.md) | [103](79-sequelize-and-typeorm.md) |

**Performance transparency, concretely.** None of these layers makes the database faster. What differs is how many queries you send and whether you can see them. The classic leak is N+1: one query for the list, then one or more per row. With raw SQL, every round trip is a `query()` call you wrote, so a loop that queries is visible in review (Example 2). With an ORM, a lazy relation or a missing `include` can produce the same pattern without a visible loop of queries. Lessons 76–79 each run the N+1 demo with that tool's query log and count the queries.

**Raw SQL is not "unsafe SQL".** The safety rule is parameters, not the layer. `pool.query('… WHERE email = $1', [email])` is as safe as any ORM call. A template string with `${email}` inside the SQL text is injectable in every layer, including the ORMs' raw-SQL methods (`$queryRawUnsafe`, `sequelize.query` with string concatenation).

**`node:sqlite`, the zero-dependency option.** Since Node v22.5.0 (behind `--experimental-sqlite`; unflagged in v23.4.0 and v22.13.0; release candidate, stability 1.2, since v24.15.0), Node ships SQLite in the binary. `new DatabaseSync(path)` opens a file or `':memory:'`. `db.prepare(sql)` compiles a statement once, and `.run()`, `.get()` and `.all()` bind values to `?` or `:name` placeholders. The API is synchronous: each call blocks the event loop until SQLite returns, which is fine for a CLI, tests or small local queries, and wrong for long queries in a busy HTTP server. Three behaviours differ from PostgreSQL:

- **There is no transaction helper.** You write `BEGIN` / `COMMIT` / `ROLLBACK` with `db.exec()`.
- **Column types are "affinities", not rules.** An `INTEGER` column accepts `'abc'` unless the table is declared `STRICT`.
- **Foreign keys are off by default in SQLite itself.** The SQLite docs: "Foreign key constraints are disabled by default (for backwards compatibility), so must be enabled separately for each database connection". `node:sqlite` turns them on for you (`enableForeignKeyConstraints`, default `true`), so `PRAGMA foreign_keys` reads `1`. A database file opened by another tool, such as the `sqlite3` shell or an older driver, may still run with them off.

Lesson 96 covers the module's basics and the 2^53 BigInt edge case: [Modern Node Features: A Guided Tour](96-modern-node-features-tour.md).

## Code examples

**Example 1 — the canonical query in raw SQL with `pg`.** "Published posts with author name, comment count and tag names, newest first", on the shared schema and seed.

javascript

```
// canonical-pg.mjs — the shared domain and the canonical query with raw SQL (pg 8.23.1)
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

await pool.query(`
  DROP TABLE IF EXISTS post_tags, tags, comments, posts, users;
  CREATE TABLE users    (id serial PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL);
  CREATE TABLE posts    (id serial PRIMARY KEY,
                         author_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                         title text NOT NULL, body text NOT NULL,
                         published boolean NOT NULL DEFAULT false,
                         created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE comments (id serial PRIMARY KEY,
                         post_id int NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                         author_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                         body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE tags     (id serial PRIMARY KEY, name text UNIQUE NOT NULL);
  CREATE TABLE post_tags (post_id int REFERENCES posts(id) ON DELETE CASCADE,
                          tag_id int REFERENCES tags(id) ON DELETE CASCADE,
                          PRIMARY KEY (post_id, tag_id));`);

// Seed. Each post gets its own created_at so "newest first" has a defined order.
await pool.query(`
  INSERT INTO users (email, name) VALUES ('ada@example.com', 'Ada'), ('lin@example.com', 'Lin'), ('grace@example.com', 'Grace');
  INSERT INTO tags (name) VALUES ('sql'), ('intro'), ('perf'), ('node');
  INSERT INTO posts (author_id, title, body, published, created_at) VALUES
    (1, 'Hello SQL', 'Hello SQL body', true,  '2026-10-01T09:00Z'),
    (1, 'Indexes',   'Indexes body',   true,  '2026-10-02T09:00Z'),
    (2, 'Draft',     'Draft body',     false, '2026-10-03T09:00Z'),
    (3, 'Streams',   'Streams body',   true,  '2026-10-04T09:00Z');
  INSERT INTO post_tags VALUES (1, 1), (1, 2), (2, 1), (2, 3), (4, 4);
  INSERT INTO comments (post_id, author_id, body) VALUES (1, 2, 'Nice'), (1, 3, '+1'), (4, 1, 'Thanks');`);

// The canonical query: published posts with author name, comment count and tag names, newest first.
const canonical = `
  SELECT p.id, p.title, u.name AS author, p.created_at,
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id)::int AS comment_count,
         coalesce((SELECT array_agg(t.name ORDER BY t.name)
                   FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                   WHERE pt.post_id = p.id), '{}') AS tags
  FROM posts p
  JOIN users u ON u.id = p.author_id
  WHERE p.published = $1
  ORDER BY p.created_at DESC, p.id DESC`;
const { rows } = await pool.query(canonical, [true]);
console.table(rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })));
console.log('created_at is a Date:', rows[0].created_at instanceof Date, '| tags is an array:', Array.isArray(rows[0].tags));

// Edge case: count(*) is bigint (int8). pg returns int8 as a string, because it can exceed 2^53.
const raw = await pool.query('SELECT count(*) AS n FROM comments');
console.log('without ::int ->', raw.rows[0].n, typeof raw.rows[0].n);
await pool.end();
```

bash

```
$ npm install pg@8.23.1
$ DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6651/app node canonical-pg.mjs
┌─────────┬────┬─────────────┬─────────┬────────────────────────────┬───────────────┬────────────────────┐
│ (index) │ id │ title       │ author  │ created_at                 │ comment_count │ tags               │
├─────────┼────┼─────────────┼─────────┼────────────────────────────┼───────────────┼────────────────────┤
│ 0       │ 4  │ 'Streams'   │ 'Grace' │ '2026-10-04T09:00:00.000Z' │ 1             │ [ 'node' ]         │
│ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ '2026-10-02T09:00:00.000Z' │ 0             │ [ 'perf', 'sql' ]  │
│ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ '2026-10-01T09:00:00.000Z' │ 2             │ [ 'intro', 'sql' ] │
└─────────┴────┴─────────────┴─────────┴────────────────────────────┴───────────────┴────────────────────┘
created_at is a Date: true | tags is an array: true
without ::int -> 3 string
```

How the query is built:

- **Comment count and tags use correlated subqueries,** one per post, instead of joining both `comments` and `post_tags` and then grouping. Two one-to-many joins in the same `FROM` multiply rows: a post with 2 comments and 2 tags would produce 4 rows, so `count()` says 4 and each tag appears twice.
- **`array_agg(… ORDER BY …)`** builds a real PostgreSQL array, which pg turns into a JS array. `coalesce(…, '{}')` turns "no tags" into `[]` instead of `null`.
- **`ORDER BY p.created_at DESC, p.id DESC`.** The `id` tie-breaker matters when rows share a timestamp, for example rows inserted in one transaction, where `now()` returns the same value for every row.
- **pg's type conversions are visible:** `timestamptz` becomes a `Date`, `text[]` becomes an array, and `bigint` becomes a **string**. That is why the query casts `count(*)` to `int`.

**Example 2 — edge case: N+1 is visible when every query is a call you wrote.** A one-line wrapper counts round trips. This uses the database from Example 1.

javascript

```
// n-plus-one-pg.mjs — with raw SQL every round trip is one line you wrote. Count them.
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let queries = 0;
const query = (text, values) => { queries++; return pool.query(text, values); }; // a one-line query log

// N+1: one query for the posts, then two more per post.
const { rows: posts } = await query('SELECT id, title, author_id FROM posts WHERE published ORDER BY created_at DESC');
for (const p of posts) {
  p.author = (await query('SELECT name FROM users WHERE id = $1', [p.author_id])).rows[0].name;
  p.comments = (await query('SELECT count(*)::int AS n FROM comments WHERE post_id = $1', [p.id])).rows[0].n;
}
console.log(`loop: ${posts.length} posts, ${queries} queries`);

// Fixed: one JOIN with a grouped count.
queries = 0;
const { rows } = await query(`
  SELECT p.id, p.title, u.name AS author, count(c.id)::int AS comments
  FROM posts p JOIN users u ON u.id = p.author_id LEFT JOIN comments c ON c.post_id = p.id
  WHERE p.published GROUP BY p.id, u.name ORDER BY p.created_at DESC`);
console.log(`join: ${rows.length} posts, ${queries} query`, rows.map((r) => `${r.title}/${r.author}/${r.comments}`));
await pool.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   loop: 3 posts, 7 queries
//   join: 3 posts, 1 query [ 'Streams/Grace/1', 'Indexes/Ada/0', 'Hello SQL/Ada/2' ]
```

The loop sends 1 + 2 × 3 = 7 queries for 3 posts, and the count grows with every post. The `JOIN` version sends 1 whatever the number of posts. Here only one one-to-many table (`comments`) is joined, so `count(c.id)` is correct. `LEFT JOIN` keeps posts with no comments ("Indexes" shows 0). An ORM can produce the same 7 queries from a loop that reads `post.author` lazily. Lessons 76–79 show the fix in each tool.

**Example 3 — the shared domain in `node:sqlite`: prepared statements, a transaction and the canonical query.** No `npm install`: the module ships with Node.

javascript

```
// blog-sqlite.mjs — the shared blog domain in node:sqlite (built into Node, no npm install)
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:'); // or a file path such as './blog.db'
console.log('SQLite', db.prepare('SELECT sqlite_version() AS v').get().v);

db.exec(`
  CREATE TABLE users    (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE posts    (id INTEGER PRIMARY KEY,
                         author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                         title TEXT NOT NULL, body TEXT NOT NULL,
                         published INTEGER NOT NULL DEFAULT 0,          -- no boolean type: 0/1
                         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
  CREATE TABLE comments (id INTEGER PRIMARY KEY,
                         post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                         author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                         body TEXT NOT NULL,
                         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')));
  CREATE TABLE tags     (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
  CREATE TABLE post_tags (post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                          tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                          PRIMARY KEY (post_id, tag_id));`);

// Prepared statements: compiled once, values bound by SQLite (never concatenated).
const addUser = db.prepare('INSERT INTO users (email, name) VALUES (?, ?) RETURNING id');
const addTag = db.prepare('INSERT INTO tags (name) VALUES (?) RETURNING id');
const addPost = db.prepare(`INSERT INTO posts (author_id, title, body, published, created_at)
                            VALUES (:author, :title, :body, :published, :at) RETURNING id`);
const tagPost = db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)');
const addComment = db.prepare('INSERT INTO comments (post_id, author_id, body) VALUES (?, ?, ?)');

// A transaction: node:sqlite has no helper, so BEGIN/COMMIT/ROLLBACK by hand.
function seed() {
  db.exec('BEGIN');
  try {
    const [ada, lin, grace] = [['ada@example.com', 'Ada'], ['lin@example.com', 'Lin'], ['grace@example.com', 'Grace']]
      .map(([e, n]) => addUser.get(e, n).id);
    const tag = Object.fromEntries(['sql', 'intro', 'perf', 'node'].map((n) => [n, addTag.get(n).id]));
    const posts = [[ada, 'Hello SQL', 1, ['sql', 'intro']], [ada, 'Indexes', 1, ['sql', 'perf']],
                   [lin, 'Draft', 0, []], [grace, 'Streams', 1, ['node']]];
    const ids = posts.map(([author, title, published, tags], i) => {
      const { id } = addPost.get({ author, title, body: `${title} body`, published,
                                   at: `2026-10-0${i + 1}T09:00:00.000Z` });
      for (const t of tags) tagPost.run(id, tag[t]);
      return id;
    });
    addComment.run(ids[0], lin, 'Nice');
    addComment.run(ids[0], grace, '+1');
    addComment.run(ids[3], ada, 'Thanks');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
seed();

// The canonical query: published posts with author name, comment count and tag names, newest first.
const canonical = db.prepare(`
  SELECT p.id, p.title, u.name AS author, p.created_at,
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         (SELECT json_group_array(name) FROM (SELECT t.name FROM post_tags pt JOIN tags t ON t.id = pt.tag_id
                                              WHERE pt.post_id = p.id ORDER BY t.name)) AS tags
  FROM posts p JOIN users u ON u.id = p.author_id
  WHERE p.published = 1
  ORDER BY p.created_at DESC, p.id DESC`);
console.table(canonical.all().map((row) => ({ ...row, tags: JSON.parse(row.tags) })));

// A failing transaction rolls back every statement in it.
try {
  db.exec('BEGIN');
  addUser.get('new@example.com', 'New');
  addUser.get('ada@example.com', 'Ada again'); // UNIQUE violation
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  console.log('rolled back:', err.message, '| users now:', db.prepare('SELECT count(*) AS n FROM users').get().n);
}
db.close();

// Real output (Node v24.19.0, node:sqlite, SQLite 3.53.3):
//   SQLite 3.53.3
//   ┌─────────┬────┬─────────────┬─────────┬────────────────────────────┬───────────────┬────────────────────┐
//   │ (index) │ id │ title       │ author  │ created_at                 │ comment_count │ tags               │
//   ├─────────┼────┼─────────────┼─────────┼────────────────────────────┼───────────────┼────────────────────┤
//   │ 0       │ 4  │ 'Streams'   │ 'Grace' │ '2026-10-04T09:00:00.000Z' │ 1             │ [ 'node' ]         │
//   │ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ '2026-10-02T09:00:00.000Z' │ 0             │ [ 'perf', 'sql' ]  │
//   │ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ '2026-10-01T09:00:00.000Z' │ 2             │ [ 'intro', 'sql' ] │
//   └─────────┴────┴─────────────┴─────────┴────────────────────────────┴───────────────┴────────────────────┘
//   rolled back: UNIQUE constraint failed: users.email | users now: 3
```

Differences from the PostgreSQL version:

- `INTEGER PRIMARY KEY` replaces `serial`: it is an alias for SQLite's rowid and is assigned automatically.
- There is no `boolean` or `timestamptz`. Here `published` is 0/1 and `created_at` is ISO-8601 text, which sorts correctly as a string.
- `json_group_array` replaces `array_agg`. It returns JSON **text**, hence the `JSON.parse`. The inner `ORDER BY` subquery sorts the tag names.
- SQLite's `count(*)` comes back as a JS number, not a string. node:sqlite returns INTEGER values as numbers unless you enable BigInts (lesson 96, Example 8).
- `RETURNING id` works in SQLite too (since SQLite 3.35).
- After the failed transaction there are still 3 users: the `new@example.com` insert ran, but the `ROLLBACK` removed it.

**Example 4 — edge case: SQLite foreign keys and type affinity.**

javascript

```
// sqlite-edge.mjs — two SQLite behaviours that surprise PostgreSQL users
import { DatabaseSync } from 'node:sqlite';
const schema = `
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                      title TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0);`;

// 1. Foreign keys. SQLite itself starts every connection with them OFF; node:sqlite turns them ON
//    unless you pass enableForeignKeyConstraints: false.
for (const enableForeignKeyConstraints of [true, false]) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints });
  db.exec(schema);
  db.exec(`INSERT INTO users (email, name) VALUES ('ada@example.com', 'Ada')`);
  const fk = db.prepare('PRAGMA foreign_keys').get().foreign_keys;
  let orphan;
  try { db.prepare('INSERT INTO posts (author_id, title) VALUES (999, ?)').run('orphan'); orphan = 'accepted'; }
  catch (e) { orphan = `rejected (${e.message})`; }
  db.prepare('INSERT INTO posts (author_id, title) VALUES (1, ?)').run('Hello SQL');
  db.exec('DELETE FROM users WHERE id = 1');
  const left = db.prepare('SELECT count(*) AS n FROM posts').get().n;
  console.log(`enableForeignKeyConstraints: ${enableForeignKeyConstraints} -> PRAGMA foreign_keys = ${fk}; ` +
              `post for user 999 ${orphan}; posts left after deleting Ada: ${left}`);
  db.close();
}

// 2. Type affinity. A declared type is a preference, not a rule, unless the table is STRICT.
const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE loose (n INTEGER); CREATE TABLE tight (n INTEGER) STRICT;`);
const ins = db.prepare('INSERT INTO loose (n) VALUES (?)');
for (const v of ['42', 'abc', 4.5]) ins.run(v);
console.log('loose:', db.prepare('SELECT n, typeof(n) AS stored_as FROM loose').all());
try { db.prepare('INSERT INTO tight (n) VALUES (?)').run('abc'); }
catch (e) { console.log('STRICT:', e.message); }
try { ins.run(true); } catch (e) { console.log('binding true:', e.message); }
db.close();

// Real output (Node v24.19.0, node:sqlite, SQLite 3.53.3):
//   enableForeignKeyConstraints: true -> PRAGMA foreign_keys = 1; post for user 999 rejected (FOREIGN KEY constraint failed); posts left after deleting Ada: 0
//   enableForeignKeyConstraints: false -> PRAGMA foreign_keys = 0; post for user 999 accepted; posts left after deleting Ada: 2
//   loose: [
//     [Object: null prototype] { n: 42, stored_as: 'integer' },
//     [Object: null prototype] { n: 'abc', stored_as: 'text' },
//     [Object: null prototype] { n: 4.5, stored_as: 'real' }
//   ]
//   STRICT: cannot store TEXT value in INTEGER column tight.n
//   binding true: Provided value cannot be bound to SQLite parameter 1.
```

What the run shows:

- **Foreign keys.** With node:sqlite's default (`true`), the orphan post is rejected, and deleting Ada cascades to her post (0 left). With `enableForeignKeyConstraints: false`, which is how SQLite behaves when nothing turns the pragma on, the post for user 999 is stored, and `ON DELETE CASCADE` silently does nothing: both posts are left pointing at users that do not exist. If your database file is also written by another tool, check `PRAGMA foreign_keys` there too.
- **Affinity.** The text `'42'` was converted to the integer 42 because the column prefers integers. `'abc'` could not be converted, so it was stored as text in an `INTEGER` column. `STRICT` tables (SQLite 3.37+) reject it.
- **Booleans.** On Node v24.19.0, binding `true` throws, so pass `1`/`0`. Boolean binding was added in v24.21.0: the same line run on `npx node@24.21.0` stored the integer `1`, and v24.20.0 still threw. The current v24 docs say "Booleans are written as the INTEGER values 1 and 0".

## Common mistakes & gotchas

- **Choosing by popularity instead of by your queries.** An ORM built for CRUD is painful for reporting SQL, and raw SQL for 40 simple CRUD endpoints is a lot of repetition. Look at the five hardest queries you expect to write.
- **Joining two one-to-many tables and then counting.** `posts JOIN comments JOIN post_tags` multiplies rows, so counts and tag lists come out wrong. Use correlated subqueries, `count(DISTINCT …)`, or aggregate each side separately.
- **Forgetting that pg returns `bigint` as a string.** `count(*)`, `sum()` of integers and `bigserial` ids arrive as strings. Cast in SQL (`::int`) when the value is small, or parse with `BigInt`.
- **Template strings in "raw" escape hatches.** `` $queryRawUnsafe(`… ${x}`) ``, `sequelize.query('…' + x)` and `knex.raw(`… ${x}`)` are all injectable. Use the parameterised forms.
- **Trusting generated SQL without looking.** Turn on query logging in development and read what each new query sends, especially loops over relations (N+1).
- **Treating `pool.query<Row>()` as validation.** The generic only tells TypeScript what you claim the row is. A renamed column still compiles. Use a schema-aware tool, or validate the rows.
- **Using `node:sqlite` in a busy HTTP server for long queries.** The API is synchronous, so a 200 ms query blocks every request for 200 ms. Keep queries short, or move them to a worker thread.
- **Assuming SQLite enforces foreign keys and types like PostgreSQL.** Foreign keys depend on a per-connection pragma, and column types are affinities unless the table is `STRICT`.

## Best practices

- **Pick one primary layer per service** and keep raw SQL for the queries the layer cannot express, through its parameterised escape hatch.
- **Keep data access in repository modules** (lesson 60), so the choice of layer stays in one place and can change later.
- **Log the SQL in development and in slow-query logs in production.** Check the plan of hot queries with `EXPLAIN ANALYZE` whatever the layer.
- **Count queries per request in tests** for list endpoints, so N+1 regressions fail CI.
- **Use a schema-aware typed tool (Drizzle, Prisma) when you use TypeScript and own the schema.** Use raw SQL or Knex with a migration tool when the schema is shared or the SQL is complex.
- **For SQLite, use `STRICT` tables and check `PRAGMA foreign_keys`.** Wrap multi-statement writes in `BEGIN` / `COMMIT` with `ROLLBACK` in `catch`. Pin the Node version while `node:sqlite` is a release candidate.

## ⭐ Interview lens

> **Q: “Raw SQL, query builder or ORM: how do you decide?”**  
> A: By the queries and the team. For complex reporting SQL and full control over each round trip, use raw SQL or a builder. Builders add composition and placeholders without hiding the SQL shape. For CRUD-heavy apps where the service owns its schema, an ORM saves code and, with Prisma or Drizzle, checks column names and result types at compile time. Then check two things: how the tool shows its SQL, and how its parameterised raw-SQL escape hatch works. *Trap:* "ORMs are slow". The database runs whatever SQL arrives. The cost is extra or badly shaped queries, which you find by reading the query log.

> **Q: “What is the N+1 problem and how do you find it?”**  
> A: One query loads a list, then the code runs one or more queries per item, here 7 queries for 3 posts. You find it by counting queries per request, with the tool's query log or a wrapper around `query()`. You fix it with a join, an `IN (…)` batch, or the ORM's eager-loading option, which brings the count back to one or two queries however many items there are.

> **Q: “Why does `count(*)` come back as a string from pg?”**  
> A: `count(*)` returns PostgreSQL `bigint` (int8), which can exceed `Number.MAX_SAFE_INTEGER`, so pg returns it as a string rather than silently losing precision. Cast to `int` in SQL when the value is small, or convert with `BigInt`. node:sqlite returns numbers by default and throws for values it cannot represent unless you enable BigInts.

> **Q: “When would you use SQLite through `node:sqlite` in a Node backend?”**  
> A: For CLIs, desktop or edge apps, local caches, tests and small single-process services: no server, no npm dependency, and the data is one file. Watch three things: the API is synchronous and blocks the event loop; column types are affinities unless the table is `STRICT`; and foreign key enforcement is a per-connection pragma, which node:sqlite turns on by default but SQLite itself does not.

## Cheat-card

- **Layers:** driver (`pg`, `node:sqlite`) → query builder (Knex, Drizzle) → ORM (Prisma, Sequelize, TypeORM).
- **See the SQL:** raw = your text; Knex `.toSQL()`/`debug`; Drizzle `.toSQL()`/`logger: true`; Prisma `log: ['query']`; Sequelize `logging` (on by default); TypeORM `logging`/`.getSql()`.
- **Escape hatches:** `knex.raw`, Drizzle `` sql`` `` + `db.execute`, `` prisma.$queryRaw`` ``, `sequelize.query` with `replacements`, `dataSource.query`.
- **Types:** Drizzle (from the TS schema) and Prisma (generated) check columns and results; `pool.query<Row>()` only asserts.
- **Canonical query:** correlated subqueries for count and tags; `array_agg(… ORDER BY …)` with `coalesce(…, '{}')`; `ORDER BY created_at DESC, id DESC`.
- **pg types:** `timestamptz` → `Date`, `text[]` → array, `bigint` → string (cast `::int`).
- **node:sqlite:** `DatabaseSync`, `prepare().run/get/all`, `?` and `:name` params, manual `BEGIN`/`COMMIT`/`ROLLBACK`, synchronous; `enableForeignKeyConstraints` default `true` (SQLite's own default is off); `STRICT` tables; booleans bind only from v24.21.0.
- **Versions used:** Node v24.19.0, PostgreSQL 18.4, pg 8.23.1, SQLite 3.53.3 (bundled with Node v24.19.0); table facts checked against knex 3.3.0, drizzle-orm 0.45.4 / drizzle-kit 0.31.11, prisma / @prisma/client 7.10.0, sequelize 6.37.8, typeorm 1.1.2.

---

## Learn More

- [node-postgres: Queries node-postgres.com](https://node-postgres.com/features/queries)
- [node-postgres: Data types node-postgres.com](https://node-postgres.com/features/types)
- [SQLite (node:sqlite) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Datatypes In SQLite sqlite.org](https://www.sqlite.org/datatype3.html)
- [SQLite Foreign Key Support sqlite.org](https://www.sqlite.org/foreignkeys.html)
- [STRICT Tables sqlite.org](https://www.sqlite.org/stricttables.html)
- [Aggregate Functions: array_agg (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/functions-aggregate.html)
