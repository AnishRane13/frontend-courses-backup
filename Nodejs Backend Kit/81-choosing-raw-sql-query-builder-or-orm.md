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

## Say it in 30 seconds

Raw SQL, a query builder, and an ORM are three distances from the database: you write the SQL, you assemble it with method calls, or you ask for objects and the library writes the SQL. You pick by how complex the queries are and how much you want the compiler to check. Each step up hides more of the SQL, so a slow page is harder to see, and every tool still needs a safe way back to parameterized SQL.

## Why it matters

The same blog was built with Prisma, Drizzle, Sequelize, TypeORM, and Knex. Each tool sits at a different distance from SQL, and that distance decides four things you live with for years. What the compiler catches: a typo in a column name can fail at build time, or in production on the first request that runs it. What you can see when a page is slow: the SQL you wrote, or SQL you have to turn logging on to find. How the schema changes: generated from a schema file, or written by hand. And the edge: a window function, a lateral join, or FOR UPDATE SKIP LOCKED, which needs an escape hatch to raw SQL that is still parameterized.

Picking the wrong layer is expensive to undo, because the choice spreads into every repository file.

## The concept, simply

Three layers sit between your code and the database.

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


A **driver** such as pg or node:sqlite sends SQL text and parameter values, and gives back rows as plain objects. You write every query. A **query builder** such as Knex or Drizzle lets you build that SQL from calls like select, where, and join. You still decide which tables to join. The builder writes the text and the placeholders. An **ORM** such as Prisma, Sequelize, or TypeORM maps tables to models and relations. You ask for posts with their author and comments, and it decides the SQL, sometimes one query, sometimes several.

Each step up removes typing and adds something to learn and something you no longer see directly. Drizzle sits between the last two: a builder that looks like SQL, and a relational API that works like an ORM.

## How it works

Choose by walking these questions.

1. **How complex are the queries?** Reporting, GROUP BY, CTEs, and window functions stay close to SQL: raw pg, Knex, or Drizzle's builder. Mostly create, read, and update by id, with relations: an ORM saves the most code.
2. **How much should the compiler check?** If you want column names and result types checked, use a tool that knows the schema. Drizzle infers types from the TypeScript schema. Prisma generates them from `schema.prisma`. TypeORM and Sequelize type the models you declare. Raw pg and untyped Knex give you any unless you write the row types yourself.
3. **Who owns the schema?** If the database already exists or is shared, pick a tool that does not insist on generating migrations from its own file. Pair raw pg or Knex with node-pg-migrate or Knex migrations. If your app owns the database, Prisma Migrate, Drizzle Kit, or TypeORM `migration:generate` save work. Read every generated file. A renamed field can become a DROP.
4. **Can you see the SQL?** For a hot path you need the statement and its plan, EXPLAIN ANALYZE. Every tool here can log SQL. With raw SQL the text in your code is the text that runs. With an ORM you read the log after each change.
5. **What is the escape hatch?** It has to be parameterized, and it has to work inside the tool's transactions. All five do. The table below names the call.
6. **Do you need a server?** For a CLI, a desktop app, tests, or a small single-process service, SQLite through `node:sqlite` needs no server and no npm package.

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

None of these layers makes the database faster. What differs is how many queries you send and whether you can see them. The classic leak is N+1: one query for the list, then one or more per row. With raw SQL every round trip is a `query()` you wrote, so a loop is visible in review. With an ORM, a lazy relation or a missing include can do the same thing without a visible loop of queries.

Raw SQL is not unsafe SQL. The safety rule is parameters, not the layer. `pool.query` with a placeholder is as safe as an ORM call. A template string that interpolates a value into the SQL text is injectable in every layer, including the ORMs' unsafe raw methods.

**node:sqlite.** Node ships SQLite in the binary. `new DatabaseSync(path)` opens a file or `':memory:'`. `prepare` compiles a statement once. `run`, `get`, and `all` bind values to `?` or `:name` placeholders. The API is synchronous: each call blocks the event loop until SQLite returns. That is fine for a CLI, tests, or small local queries, and wrong for a long query in a busy HTTP server. Three behaviors differ from PostgreSQL. There is no transaction helper. You write BEGIN, COMMIT, and ROLLBACK yourself. Column types are affinities, not rules. An INTEGER column accepts the text abc unless the table is STRICT. Foreign keys are off by default in SQLite itself. node:sqlite turns them on for you (`enableForeignKeyConstraints` defaults to true), so `PRAGMA foreign_keys` reads 1. A file opened by the sqlite3 shell or an older driver may still run with them off.

## Code examples

The canonical query in raw SQL with pg: published posts with author name, comment count, and tag names, newest first.

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


How the query is built. Comment count and tags use correlated subqueries, one per post, instead of joining both comments and post_tags and then grouping. Two one-to-many joins in the same FROM multiply rows: 2 comments and 2 tags become 4 rows, so count says 4 and each tag appears twice. `array_agg(... ORDER BY ...)` builds a PostgreSQL array, which pg turns into a JavaScript array. `coalesce` to `'{}'` turns "no tags" into an empty array instead of null. Order by `created_at` and then `id`, because rows inserted in one transaction share a timestamp. pg turns timestamptz into a Date, text arrays into arrays, and bigint into a string, which is why the query casts `count(*)` to int.

N+1 is visible when every query is a call you wrote.

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


The loop sends 1 + 2 × 3 = 7 queries for 3 posts, and the count grows with every post. The JOIN sends 1, whatever the number of posts. Here only comments is joined, so `count(c.id)` is correct. LEFT JOIN keeps posts with no comments. An ORM can produce the same 7 queries from a loop that reads `post.author` lazily.

The shared domain in node:sqlite. No npm install. The module ships with Node.

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


Differences from PostgreSQL. INTEGER PRIMARY KEY replaces serial. There is no boolean or timestamptz. Here published is 0 or 1, and created_at is ISO-8601 text, which sorts as a string. `json_group_array` replaces `array_agg` and returns JSON text, so you JSON.parse it. SQLite's `count(*)` comes back as a number, not a string. RETURNING id works. After the failed transaction there are still 3 users: the insert ran, and ROLLBACK removed it.

Foreign keys and type affinity.

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


With node:sqlite's default, the orphan post is rejected, and deleting Ada cascades to her post. With `enableForeignKeyConstraints: false`, which is SQLite when nothing turns the pragma on, the post for user 999 is stored, and ON DELETE CASCADE does nothing. The text `'42'` was stored as the integer 42 because the column prefers integers. `'abc'` was stored as text in an INTEGER column. STRICT tables reject that. On Node v24.19.0, binding `true` throws, so pass 1 or 0.

## Common mistakes & gotchas

- **Choosing by popularity.** An ORM built for CRUD is painful for reporting SQL. Raw SQL for dozens of simple CRUD endpoints is a lot of repetition. Look at the hardest queries you expect to write.
- **Joining two one-to-many tables and then counting.** Rows multiply. Use correlated subqueries, count distinct, or aggregate each side separately.
- **Forgetting that pg returns bigint as a string.** `count(*)`, sums of integers, and bigserial ids arrive as strings. Cast in SQL when the value is small, or parse with BigInt.
- **Template strings in raw escape hatches.** Concatenating a value into `$queryRawUnsafe`, `sequelize.query`, or `knex.raw` is injectable. Use the parameterized form.
- **Trusting generated SQL without reading it.** Turn on query logging, especially around loops over relations.
- **Treating `pool.query<Row>()` as validation.** The generic only tells TypeScript what you claim the row is. A renamed column still compiles.
- **node:sqlite for a long query on a busy HTTP server.** The API is synchronous, so a 200 millisecond query blocks every other request for 200 milliseconds.
- **Assuming SQLite enforces foreign keys and types like PostgreSQL.** Foreign keys depend on a per-connection pragma. Column types are affinities unless the table is STRICT.

## Best practices

- Pick one primary layer per service. Use raw SQL, through that layer's parameterized escape hatch, only for the queries it cannot express.
- Keep data access in repository modules, so the choice stays in one place.
- Log SQL in development and in slow-query logs. Check hot plans with EXPLAIN ANALYZE, whatever the layer.
- Count queries per request in tests for list endpoints, so an N+1 fails CI.
- Use Drizzle or Prisma when you use TypeScript and you own the schema. Use raw SQL or Knex, plus a migration tool, when the schema is shared or the SQL is complex.
- For SQLite, use STRICT tables and check `PRAGMA foreign_keys`. Wrap multi-statement writes in BEGIN and COMMIT, with ROLLBACK in catch.

## ⭐ Interview lens

> **Q: “Raw SQL, query builder or ORM: how do you decide?”**  
> A: Decide from the queries, not from which library is popular. If the work is reporting, heavy GROUP BY, CTEs, or window functions, stay close to the SQL: a driver or a query builder, so each round trip is a statement you can read. A builder adds composition and placeholders without hiding the shape. If the work is mostly create, read, and update by id, and this service owns the schema, an ORM saves the mapping code, and Prisma or Drizzle also check column names and result types at compile time. Then check two practical things: how you see the SQL that actually ran, and how the parameterized raw escape hatch works inside a transaction. For example, the shared published-posts query is one statement with two correlated subqueries in raw pg, and the same page is several queries or one generated statement depending on the ORM. The limit of "ORMs are slow" is that the database runs whatever SQL arrives. The cost is extra or badly shaped queries, which you find by reading the query log, not by blaming the layer.

> **Q: “What is the N+1 problem and how do you find it?”**  
> A: N+1 is one query that loads a list, then more queries per item. In the raw example that was 7 queries for 3 posts: the list, then author and comments for each. You find it by counting round trips per request, with the tool's query log or a wrapper around `query()`. You fix it with a join, an IN list that batches the children, or the ORM's eager-load option, which brings the count back to one or two queries however many items there are. For example, the JOIN version of that page sent 1 query, and LEFT JOIN kept the post that had no comments at a count of 0. The limit is a join of two one-to-many tables at once. Comments times tags multiplies rows, so a plain count lies. Aggregate each side in its own subquery, which is what the canonical query does.

> **Q: “Why does `count(*)` come back as a string from pg?”**  
> A: `count(*)` in PostgreSQL is bigint, an int8, which can be larger than `Number.MAX_SAFE_INTEGER`. The pg driver returns that as a string so it does not silently lose digits. You see it on counts, on sums of integers, and on bigserial ids. When the value is small, cast to int in the SQL, which is why the canonical query casts `count(*)`. When it might be huge, convert with BigInt in JavaScript. node:sqlite is the opposite default: INTEGER comes back as a JavaScript number, and it throws for values it cannot represent unless you enable BigInts. The limit of the cast is the cast. `::int` overflows if the count does not fit. Use it when you know the magnitude, not as a habit on every aggregate.

> **Q: “When would you use SQLite through `node:sqlite` in a Node backend?”**  
> A: Use `node:sqlite` when you do not want a server or an npm dependency: a CLI, a desktop or edge app, a local cache, tests, or a small single-process service. The data is one file. `DatabaseSync` opens it, `prepare` compiles a statement, and `run`, `get`, and `all` bind `?` or named placeholders. Three limits decide whether it belongs in a backend. The API is synchronous, so a long query blocks the event loop for every other request. Column types are affinities unless the table is declared STRICT, so an INTEGER column can store text. Foreign keys are off in SQLite itself and on by default in node:sqlite, so a file also opened by the sqlite3 shell may not enforce them. For example, with the pragma off, an orphan post was stored and ON DELETE CASCADE did nothing. With the default, the orphan was rejected and the cascade ran.

## Cheat-card

- **Layers:** driver (pg, node:sqlite), then query builder (Knex, Drizzle), then ORM (Prisma, Sequelize, TypeORM).
- **See the SQL:** raw is your text. Knex has `toSQL` and `debug`. Drizzle has `toSQL` and `logger`. Prisma has `log: ['query']`. Sequelize logs by default. TypeORM has `logging` and `getSql()`.
- **Escape hatches:** `knex.raw`, Drizzle `sql` plus `db.execute`, `prisma.$queryRaw`, `sequelize.query` with replacements, `dataSource.query`.
- **Types:** Drizzle infers from the TypeScript schema. Prisma generates them. `pool.query<Row>()` only asserts.
- **Canonical query:** correlated subqueries for the count and the tags. `array_agg` ordered, with coalesce to an empty array. Order by `created_at` then `id`.
- **pg types:** timestamptz becomes a Date, a text array becomes an array, bigint becomes a string. Cast `count(*)` to int when it is small.
- **node:sqlite:** `DatabaseSync`, `prepare`, then `run`, `get`, or `all`. Placeholders are `?` and `:name`. You write BEGIN, COMMIT, and ROLLBACK. Calls are synchronous. Foreign keys default on here, and off in SQLite itself. Use STRICT tables.

## Good to know

- node:sqlite arrived behind `--experimental-sqlite` in Node v22.5.0, was unflagged in v23.4.0 and v22.13.0, and has been a release candidate, stability 1.2, since v24.15.0. Pin the Node version while it is a release candidate.
- Boolean binding was added in v24.21.0. The same line on Node v24.19.0 and v24.20.0 throws. On v24.21.0 it stored the integer 1. The v24 docs say booleans are written as the integers 1 and 0.
- Lesson 96 covers the module's basics and the case where an integer does not fit in a JavaScript number and comes back as a BigInt.
- Versions behind the table: Node v24.19.0, PostgreSQL 18.4, pg 8.23.1, SQLite 3.53.3 bundled with that Node. Facts checked against knex 3.3.0, drizzle-orm 0.45.4, drizzle-kit 0.31.11, prisma and @prisma/client 7.10.0, sequelize 6.37.8, typeorm 1.1.2.

---

## Learn More

- [node-postgres: Queries node-postgres.com](https://node-postgres.com/features/queries)
- [node-postgres: Data types node-postgres.com](https://node-postgres.com/features/types)
- [SQLite (node:sqlite) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
- [Datatypes In SQLite sqlite.org](https://www.sqlite.org/datatype3.html)
- [SQLite Foreign Key Support sqlite.org](https://www.sqlite.org/foreignkeys.html)
- [STRICT Tables sqlite.org](https://www.sqlite.org/stricttables.html)
- [Aggregate Functions: array_agg (PostgreSQL 18) postgresql.org](https://www.postgresql.org/docs/18/functions-aggregate.html)
