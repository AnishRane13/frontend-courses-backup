---
title: "Knex Query Builder"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Knex Query Builder

*24 min read · Updated 12 Oct 2026 · Topic 104 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Knex 3.3.0, pg 8.23.1, PostgreSQL 18.4 run locally via the embedded-postgres npm package (no Docker)

---

## Why it matters

Raw SQL strings in a Node service break down in three predictable ways:

- someone concatenates a value into the string;
- a list endpoint grows ten optional filters and the code becomes a pile of `if`s that glue string fragments together;
- the schema changes and nobody has a record of which change ran where.

An ORM solves these by hiding the SQL. A query builder solves them while keeping the SQL visible.

Knex is the long-standing query builder for Node. It gives you:

- a chainable API that compiles to parameterised SQL;
- a migration and seed CLI with a bookkeeping table;
- transactions with savepoints for nested calls.

It does not give you models, relations or an identity map. A row comes back as a plain object, and loading a post's comments is a second query you write yourself. That trade-off is the subject of this lesson. It uses the same five tables, seed and canonical query as [lesson 79](79-sequelize-and-typeorm.md), so you can put the generated SQL side by side.

## The concept, simply

A Knex query is an object that describes SQL. `knex('posts').where({ published: true }).orderBy('id')` sends nothing to the database yet. It records the clauses you called. Two things can happen to it:

- **You inspect it.** `.toSQL()` compiles it to `{ sql, bindings }`, and `.toString()` inlines the bindings for a log line.
- **You run it.** A builder is a *thenable*, so `await` (or `.then`) compiles it for the configured dialect, borrows a pooled connection, sends the SQL with the bindings as separate parameters, and resolves with an array of row objects.

Around the builder sit three more pieces:

- `knex.schema` builds DDL.
- The **CLI** (`knex migrate:*`, `knex seed:*`) runs migration and seed files and records them in `knex_migrations`.
- `knex.transaction()` pins a sequence of queries to one connection.

## How it works

What happens when `await knex('posts').where('published', true).limit(10)` runs:

1. `knex('posts')` creates a QueryBuilder and stores `from = posts`. Each chained call (`where`, `join`, `orderBy`, `limit`) appends an entry to the builder's internal statement list. No SQL exists yet.
2. `await` calls the builder's `then`. The client's query compiler turns the statement list into SQL for the dialect, here PostgreSQL. Identifiers are quoted (`"posts"`). Every value becomes a binding, written as `?` in Knex's own form and rewritten to `$1, $2…` for the `pg` driver (`toSQL().toNative()` shows that form).
3. Before sending, Knex checks the bindings. An `undefined` value throws `Undefined binding(s) detected…`, and no SQL is sent (Example 9).
4. Knex acquires a connection from its pool (tarn.js, configured by `pool` in the knexfile), emits a `query` event with `{ sql, bindings }`, and calls the driver. Every query count in this lesson comes from that event.
5. The driver returns rows, and Knex resolves with `rows` for a select, or with what `.returning()` asked for on an insert or update. Then it releases the connection.

**Bindings vs `toString()`.** `toSQL()` returns placeholders plus a bindings array. That is what goes over the wire, and it is why a value can never change the shape of the SQL. `toString()` inlines the values with escaping, for display only. Do not send its output to the database. Identifiers such as table and column names are quoted by the builder, but they are not bindings. When a column name comes from user input, map it through an allow-list yourself.

**`knex.raw` and its bindings.** `knex.raw(sql, bindings)` takes `?` positional or `:name` named placeholders (and `??` for an identifier), and binds them the same way as the builder. You can use a `knex.raw` fragment inside a builder (`.select(knex.raw('count(distinct c.id)::int as n'))`), so you only drop to raw SQL for the parts the builder has no method for, such as window functions, `FILTER`, casts or `array_agg`.

**Migrations.** A migration file exports `up(knex)` and `down(knex)`. Here is what the CLI does:

1. It reads `knexfile.js`, using the environment named by `NODE_ENV`, or `development`.
2. It creates `knex_migrations` (`id`, `name`, `batch`, `migration_time`) and `knex_migrations_lock` if they are missing.
3. It takes the lock row, so that two deploys cannot migrate at once.
4. It runs each pending file in name order. Each one runs inside a transaction unless the file exports `config = { transaction: false }`, or the knexfile sets `disableTransactions`.
5. It records the files with a new batch number. `migrate:latest` runs everything pending as one batch, and `migrate:up` runs only the next file. `migrate:rollback` undoes the **last batch** by calling `down()` in reverse order.

text

```
knex_migrations                 migrate:latest      migrate:rollback
id name                  batch  ─────────────────   ────────────────────────────
1  …_create_blog_schema   1     (already run)       untouched
2  …_add_posts_feed_index 2     ← runs as batch 2   ← down() runs, row deleted
```

Seeds are different. A seed file exports `seed(knex)`. `seed:run` runs every file in the seeds directory, in name order, **every time**, and records nothing. A seed must therefore reset its own tables, here with `TRUNCATE … RESTART IDENTITY CASCADE`.

**Transactions and savepoints.** `knex.transaction(async (trx) => { … })` acquires one connection and sends `BEGIN`. `trx` is a builder factory bound to that connection: `trx('posts')` instead of `knex('posts')`. When the callback resolves, Knex sends `COMMIT`. When it throws, Knex sends `ROLLBACK` and rejects with your error. Calling `trx.transaction(...)` inside starts a **savepoint**:

text

```
BEGIN;
  insert … 'Kept'
  SAVEPOINT trx4;                 ← trx.transaction(async (inner) => …)
    insert … 'Undone'
    insert … post_id 999          ← FK error 23503 → inner callback throws
  ROLLBACK TO SAVEPOINT trx4      ← only the inner work is undone
COMMIT;                           ← outer work ('Kept') is saved
```

Without a callback, `await knex.transaction()` returns a `trx` that you finish yourself with `trx.commit()` or `trx.rollback()`.

**When a query builder beats an ORM.** An ORM is a good fit when a request loads an object graph by id, changes a few fields and saves. A query builder fits better when the result has no class of its own. The canonical query here is a good example: a projection of four tables with two aggregates. In Knex it is one `GROUP BY` query whose SQL you can read line by line (Example 4). Lesson 79 needed a `literal()` sub-query in Sequelize and a `@VirtualColumn` in TypeORM to get the same count. Three cases where the builder is the better tool:

- **Reporting and aggregate queries.** `count(distinct …)`, `array_agg … FILTER`, `GROUP BY` (Example 4).
- **Dynamic filters.** Each optional filter adds one parameterised clause, and `.modify()` keeps it in one chain (Example 5).
- **CTEs and window functions.** `.with()` plus `knex.raw` for the window expression, with bindings intact (Example 6).

What you give up: relation loading is your code (Example 7 batches it by hand), and nothing maps rows to classes or tracks changes.

## Code examples

The server is PostgreSQL 18.4 on `127.0.0.1:6550`, and `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6550/knexdemo` is set in the shell. The project is CommonJS (`npm init -y`, then `npm install knex@3.3.0 pg@8.23.1`). Knex 3.3.0 is npm's `latest` and a stable release, published 2026-06-26. `inspect.cjs` (prints query results with `console.table`) and `recreate-db.cjs` (drops and recreates the database in `DATABASE_URL`) are the same small `pg` helpers shown in lesson 79, Example 1.

**Example 1 — knexfile, the shared instance, and the CLI scaffolding.**

javascript

```
// knexfile.js — read by the knex CLI and by db.js
module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations: { directory: './migrations' },   // knex_migrations is the default table name
    seeds: { directory: './seeds' },
  },
};
```

javascript

```
// db.js — one Knex instance (one pool) for the app, plus a query log for counting
const knex = require('knex')(require('./knexfile').development);

const queries = [];
knex.on('query', (q) => queries.push(q.bindings?.length ? `${q.sql} -- ${JSON.stringify(q.bindings)}` : q.sql));

module.exports = { knex, queries };
```

bash

```
$ npx knex init
Created ./knexfile.js
$ npx knex migrate:make create_blog_schema
Using environment: development
Using environment: development
Using environment: development
Created Migration: …/knex/migrations/20261012142155_create_blog_schema.js
$ npx knex seed:make 01_blog
Using environment: development
Using environment: development
Using environment: development
Created seed file: …/knex/seeds/01_blog.js
$ npx knex migrate:make add_posts_feed_index
…
Created Migration: …/knex/migrations/20261012142227_add_posts_feed_index.js
```

The CLI prints `Using environment: development` three times for one `make` command. That is the real output of Knex CLI 3.3.0.

**Example 2 — migrations and seeds: files, CLI session, and the `knex_migrations` table.** The schema migration:

javascript

```
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id');                                   // serial PRIMARY KEY
    t.text('email').notNullable().unique();
    t.text('name').notNullable();
  });
  await knex.schema.createTable('posts', (t) => {
    t.increments('id');
    t.integer('author_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('title').notNullable();
    t.text('body').notNullable();
    t.boolean('published').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('comments', (t) => {
    t.increments('id');
    t.integer('post_id').notNullable().references('id').inTable('posts').onDelete('CASCADE');
    t.integer('author_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('body').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable('tags', (t) => {
    t.increments('id');
    t.text('name').notNullable().unique();
  });
  await knex.schema.createTable('post_tags', (t) => {
    t.integer('post_id').references('id').inTable('posts').onDelete('CASCADE');
    t.integer('tag_id').references('id').inTable('tags').onDelete('CASCADE');
    t.primary(['post_id', 'tag_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  for (const table of ['post_tags', 'tags', 'comments', 'posts', 'users']) {
    await knex.schema.dropTable(table);
  }
};
```

A second migration that cannot run in a transaction, because PostgreSQL refuses `CREATE INDEX CONCURRENTLY` inside one:

javascript

```
// Index for the canonical query (published posts, newest first).
// CREATE INDEX CONCURRENTLY cannot run inside a transaction, so opt this file out.
exports.config = { transaction: false };

exports.up = (knex) => knex.raw(
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS posts_published_created_at_idx ON posts (published, created_at DESC)');

exports.down = (knex) => knex.raw(
  'DROP INDEX CONCURRENTLY IF EXISTS posts_published_created_at_idx');
```

The seed resets its tables first, because `seed:run` re-runs every seed file each time:

javascript

```
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function (knex) {
  // Seeds re-run on every `knex seed:run`, so start from empty tables.
  await knex.raw('TRUNCATE post_tags, comments, tags, posts, users RESTART IDENTITY CASCADE');

  const [ada, lin, grace] = await knex('users').insert([
    { email: 'ada@example.com', name: 'Ada' },
    { email: 'lin@example.com', name: 'Lin' },
    { email: 'grace@example.com', name: 'Grace' },
  ]).returning('id');
  const tags = await knex('tags').insert(
    ['sql', 'intro', 'perf', 'node'].map((name) => ({ name }))).returning(['id', 'name']);
  const tag = Object.fromEntries(tags.map((t) => [t.name, t.id]));

  const [p1, p2, , p4] = await knex('posts').insert([
    { author_id: ada.id, title: 'Hello SQL', body: 'First post', published: true },
    { author_id: ada.id, title: 'Indexes', body: 'B-trees', published: true },
    { author_id: lin.id, title: 'Draft', body: 'WIP', published: false },
    { author_id: grace.id, title: 'Streams', body: 'Backpressure', published: true },
  ]).returning('id');

  await knex('post_tags').insert([
    { post_id: p1.id, tag_id: tag.sql }, { post_id: p1.id, tag_id: tag.intro },
    { post_id: p2.id, tag_id: tag.sql }, { post_id: p2.id, tag_id: tag.perf },
    { post_id: p4.id, tag_id: tag.node },
  ]);
  await knex('comments').insert([
    { post_id: p1.id, author_id: lin.id, body: 'Nice' },
    { post_id: p1.id, author_id: grace.id, body: '+1' },
    { post_id: p4.id, author_id: ada.id, body: 'Thanks' },
  ]);
};
```

The session, on a freshly created empty database (`node recreate-db.cjs` first):

bash

```
$ npx knex migrate:list
Using environment: development
No Completed Migration files Found.
Found 2 Pending Migration file/files.
20261012142155_create_blog_schema.js
20261012142227_add_posts_feed_index.js

$ npx knex migrate:up
Using environment: development
Batch 1 ran the following migrations:
20261012142155_create_blog_schema.js
$ npx knex seed:run
Using environment: development
Ran 1 seed files
$ npx knex migrate:latest
Using environment: development
Batch 2 run: 1 migrations
$ node inspect.cjs "$DATABASE_URL" "select * from knex_migrations order by id" "select indexname from pg_indexes where tablename = 'posts'"
┌─────────┬────┬──────────────────────────────────────────┬───────┬──────────────────────────┐
│ (index) │ id │ name                                     │ batch │ migration_time           │
├─────────┼────┼──────────────────────────────────────────┼───────┼──────────────────────────┤
│ 0       │ 1  │ '20261012142155_create_blog_schema.js'   │ 1     │ 2026-10-12T14:39:18.067Z │
│ 1       │ 2  │ '20261012142227_add_posts_feed_index.js' │ 2     │ 2026-10-12T14:39:19.086Z │
└─────────┴────┴──────────────────────────────────────────┴───────┴──────────────────────────┘
┌─────────┬──────────────────────────────────┐
│ (index) │ indexname                        │
├─────────┼──────────────────────────────────┤
│ 0       │ 'posts_pkey'                     │
│ 1       │ 'posts_published_created_at_idx' │
└─────────┴──────────────────────────────────┘
$ npx knex migrate:rollback
Using environment: development
Batch 2 rolled back: 1 migrations
$ npx knex migrate:list
Using environment: development
Found 1 Completed Migration file/files.
20261012142155_create_blog_schema.js
Found 1 Pending Migration file/files.
20261012142227_add_posts_feed_index.js
```

`migrate:up` ran one file as batch 1, and `migrate:latest` ran the rest as batch 2. `migrate:rollback` undid only batch 2: it ran `down()`, dropped the index and deleted row 2. `knex_migrations_lock` held a single row `{ index: 1, is_locked: 0 }` between runs. The examples below ran after a final `npx knex migrate:latest`.

**Example 3 — the builder: `toSQL()`, `toNative()`, `toString()`, then execution.**

javascript

```
// builder.js — build a query, inspect it with toSQL()/toString(), then run it
const { knex } = require('./db');

(async () => {
  const q = knex('posts')
    .select('id', 'title')
    .where({ published: true })
    .andWhere('title', 'ilike', '%s%')
    .orderBy('id')
    .limit(10);

  console.log(q.toSQL().sql);          // knex's own form: ? placeholders
  console.log(q.toSQL().toNative());   // what the pg driver receives: $1 placeholders + bindings
  console.log(q.toString());           // bindings inlined — for logs/debugging only
  console.log(await q);                // a builder is a thenable: await runs it
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node builder.js`:
//   select "id", "title" from "posts" where "published" = ? and "title" ilike ? order by "id" asc limit ?
//   {
//     sql: 'select "id", "title" from "posts" where "published" = $1 and "title" ilike $2 order by "id" asc limit $3',
//     bindings: [ true, '%s%', 10 ]
//   }
//   select "id", "title" from "posts" where "published" = true and "title" ilike '%s%' order by "id" asc limit 10
//   [
//     { id: 1, title: 'Hello SQL' },
//     { id: 2, title: 'Indexes' },
//     { id: 4, title: 'Streams' }
//   ]
```

**Example 4 — the canonical query: one GROUP BY over four tables.** It joins posts to their author, comments and tags, groups by post, and aggregates. `naive_count` is there on purpose, to show the fan-out trap:

javascript

```
// canonical.js — published posts with author name, comment count and tag names, newest first
const { knex, queries } = require('./db');

(async () => {
  const rows = await knex('posts as p')
    .join('users as u', 'u.id', 'p.author_id')
    .leftJoin('comments as c', 'c.post_id', 'p.id')
    .leftJoin('post_tags as pt', 'pt.post_id', 'p.id')
    .leftJoin('tags as t', 't.id', 'pt.tag_id')
    .where('p.published', true)
    .groupBy('p.id', 'u.name')
    .select('p.id', 'p.title', 'u.name as author')
    // two 1-N joins multiply rows (2 comments × 2 tags = 4), so count DISTINCT ids
    .select(knex.raw('count(distinct c.id)::int as comment_count'))
    .select(knex.raw('count(c.id)::int as naive_count'))          // wrong on purpose
    .select(knex.raw(`coalesce(array_agg(distinct t.name) filter (where t.name is not null), '{}') as tags`))
    .orderBy([{ column: 'p.created_at', order: 'desc' }, { column: 'p.id', order: 'desc' }]);

  console.table(rows);
  console.log('queries:', queries.length);
  console.log(queries[0]);
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node canonical.js`:
//   ┌─────────┬────┬─────────────┬─────────┬───────────────┬─────────────┬────────────────────┐
//   │ (index) │ id │ title       │ author  │ comment_count │ naive_count │ tags               │
//   ├─────────┼────┼─────────────┼─────────┼───────────────┼─────────────┼────────────────────┤
//   │ 0       │ 4  │ 'Streams'   │ 'Grace' │ 1             │ 1           │ [ 'node' ]         │
//   │ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ 0             │ 0           │ [ 'perf', 'sql' ]  │
//   │ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ 2             │ 4           │ [ 'intro', 'sql' ] │
//   └─────────┴────┴─────────────┴─────────┴───────────────┴─────────────┴────────────────────┘
//   queries: 1
//   select "p"."id", "p"."title", "u"."name" as "author", count(distinct c.id)::int as comment_count, count(c.id)::int as naive_count, coalesce(array_agg(distinct t.name) filter (where t.name is not null), '{}') as tags from "posts" as "p" inner join "users" as "u" on "u"."id" = "p"."author_id" left join "comments" as "c" on "c"."post_id" = "p"."id" left join "post_tags" as "pt" on "pt"."post_id" = "p"."id" left join "tags" as "t" on "t"."id" = "pt"."tag_id" where "p"."published" = $1 group by "p"."id", "u"."name" order by "p"."created_at" desc, "p"."id" desc -- [true]
```

"Hello SQL" has 2 comments and 2 tags. Joining both multiplies them into 4 rows, so `count(c.id)` returned 4, and `count(distinct c.id)` returned the right 2. `GROUP BY p.id` is enough to select `p.title` and order by `p.created_at`, because PostgreSQL knows the other `posts` columns depend on the primary key. `u.name` has to be listed. Compare the single statement here with the generated SQL of lesson 79, Examples 4 and 13.

**Example 5 — a dynamic filter builder.** Each optional filter adds exactly one clause, and every value stays a binding:

javascript

```
// filters.js — a dynamic filter builder: each optional filter adds one clause
const { knex } = require('./db');

function listPosts(filters = {}) {
  return knex('posts as p')
    .join('users as u', 'u.id', 'p.author_id')
    .select('p.id', 'p.title', 'u.name as author')
    .modify((qb) => {
      if (filters.published !== undefined) qb.where('p.published', filters.published);
      if (filters.author) qb.where('u.name', filters.author);
      if (filters.search) qb.whereILike('p.title', `%${filters.search}%`);
      if (filters.tag) {
        qb.whereExists(knex('post_tags as pt').join('tags as t', 't.id', 'pt.tag_id')
          .whereRaw('pt.post_id = p.id').where('t.name', filters.tag));
      }
      if (filters.minComments) {
        qb.whereRaw('(select count(*) from comments c where c.post_id = p.id) >= ?', [filters.minComments]);
      }
    })
    .orderBy('p.id');
}

(async () => {
  for (const f of [{}, { published: true, tag: 'sql' }, { search: 'e', minComments: 1 }, { author: 'Lin' }]) {
    const q = listPosts(f);
    const rows = await q;
    console.log(JSON.stringify(f), '->', rows.map((r) => r.title));
    console.log('   ', q.toSQL().sql.replace(/^select .*? from/, 'select … from'));
  }
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node filters.js`:
//   {} -> [ 'Hello SQL', 'Indexes', 'Draft', 'Streams' ]
//       select … from "posts" as "p" inner join "users" as "u" on "u"."id" = "p"."author_id" order by "p"."id" asc
//   {"published":true,"tag":"sql"} -> [ 'Hello SQL', 'Indexes' ]
//       select … from "posts" as "p" inner join "users" as "u" on "u"."id" = "p"."author_id" where "p"."published" = ? and exists (select * from "post_tags" as "pt" inner join "tags" as "t" on "t"."id" = "pt"."tag_id" where pt.post_id = p.id and "t"."name" = ?) order by "p"."id" asc
//   {"search":"e","minComments":1} -> [ 'Hello SQL', 'Streams' ]
//       select … from "posts" as "p" inner join "users" as "u" on "u"."id" = "p"."author_id" where "p"."title" ilike ? and (select count(*) from comments c where c.post_id = p.id) >= ? order by "p"."id" asc
//   {"author":"Lin"} -> [ 'Draft' ]
//       select … from "posts" as "p" inner join "users" as "u" on "u"."id" = "p"."author_id" where "u"."name" = ? order by "p"."id" asc
```

The string-concatenation version of this function is where SQL injection and `WHERE AND` bugs come from. The builder handles the `where`/`and` joining, and all user values are `?`. The comment-count filter uses `whereRaw` with a `?` binding, because the builder has no method for "correlated sub-query compared to a value".

**Example 6 — a CTE and window functions via `.with()` and `knex.raw` with bindings.** This query finds each author's newest published post and their published-post count:

javascript

```
// cte.js — a CTE + window function: each author's newest published post and their post count
const { knex, queries } = require('./db');

(async () => {
  const q = knex
    .with('ranked', (qb) => qb
      .from('posts')
      .where('published', true)
      .select('id', 'author_id', 'title', 'created_at')
      .select(knex.raw('row_number() over (partition by author_id order by created_at desc, id desc) as rn'))
      .select(knex.raw('count(*) over (partition by author_id)::int as author_posts')))
    .from('ranked as r')
    .join('users as u', 'u.id', 'r.author_id')
    .where('r.rn', 1)
    .select('u.name', 'r.title as newest', 'r.author_posts')
    .orderBy('u.name');
  console.log(q.toSQL().toNative().sql);
  console.table(await q);

  // the same shape as raw SQL with named bindings — knex still parameterises it
  const { rows } = await knex.raw(
    `with ranked as (
       select p.*, row_number() over (partition by author_id order by created_at desc, id desc) as rn
       from posts p where published = :published)
     select u.name, r.title from ranked r join users u on u.id = r.author_id
     where r.rn <= :perAuthor order by u.name`,
    { published: true, perAuthor: 1 });
  console.log(rows);
  console.log(queries.at(-1).replace(/\s+/g, ' '));
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node cte.js`:
//   with "ranked" as (select "id", "author_id", "title", "created_at", row_number() over (partition by author_id order by created_at desc, id desc) as rn, count(*) over (partition by author_id)::int as author_posts from "posts" where "published" = $1) select "u"."name", "r"."title" as "newest", "r"."author_posts" from "ranked" as "r" inner join "users" as "u" on "u"."id" = "r"."author_id" where "r"."rn" = $2 order by "u"."name" asc
//   ┌─────────┬─────────┬───────────┬──────────────┐
//   │ (index) │ name    │ newest    │ author_posts │
//   ├─────────┼─────────┼───────────┼──────────────┤
//   │ 0       │ 'Ada'   │ 'Indexes' │ 2            │
//   │ 1       │ 'Grace' │ 'Streams' │ 1            │
//   └─────────┴─────────┴───────────┴──────────────┘
//   [
//     { name: 'Ada', title: 'Indexes' },
//     { name: 'Grace', title: 'Streams' }
//   ]
//   with ranked as ( select p.*, row_number() over (partition by author_id order by created_at desc, id desc) as rn from posts p where published = $1) select u.name, r.title from ranked r join users u on u.id = r.author_id where r.rn <= $2 order by u.name -- [true,1]
```

The builder version and the raw version produce the same result. Even the fully raw query went out with `$1`, `$2` and a bindings array, because named `:published` / `:perAuthor` placeholders are bindings, not string formatting.

**Example 7 — N+1 with query counts, then batched with `whereIn`.**

javascript

```
// nplus1.js — per-post queries in a loop, then batched with whereIn
const { knex, queries } = require('./db');

(async () => {
  // N+1: 1 query for posts + 2 per post
  const posts = await knex('posts').select('id', 'title', 'author_id').orderBy('id');
  for (const post of posts) {
    post.author = await knex('users').where({ id: post.author_id }).first('name');
    post.comments = await knex('comments').where({ post_id: post.id }).select('id', 'body');
  }
  console.log(posts.map((p) => `${p.title}: ${p.author.name}, ${p.comments.length}c`).join(' | '));
  console.log('loop:', queries.length, 'queries');
  queries.slice(1, 3).forEach((q) => console.log('  ' + q));

  // Fix: 3 queries total, whatever the number of posts
  queries.length = 0;
  const list = await knex('posts').select('id', 'title', 'author_id').orderBy('id');
  const ids = list.map((p) => p.id);
  const authorIds = [...new Set(list.map((p) => p.author_id))];
  const [authors, comments] = await Promise.all([
    knex('users').whereIn('id', authorIds).select('id', 'name'),
    knex('comments').whereIn('post_id', ids).select('id', 'post_id', 'body'),
  ]);
  const authorById = new Map(authors.map((a) => [a.id, a]));
  for (const p of list) {
    p.author = authorById.get(p.author_id);
    p.comments = comments.filter((c) => c.post_id === p.id);
  }
  console.log(list.map((p) => `${p.title}: ${p.author.name}, ${p.comments.length}c`).join(' | '));
  console.log('batched:', queries.length, 'queries');
  queries.slice(1).forEach((q) => console.log('  ' + q));
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node nplus1.js`:
//   Hello SQL: Ada, 2c | Indexes: Ada, 0c | Draft: Lin, 0c | Streams: Grace, 1c
//   loop: 9 queries
//     select "name" from "users" where "id" = $1 limit $2 -- [1,1]
//     select "id", "body" from "comments" where "post_id" = $1 -- [1]
//   Hello SQL: Ada, 2c | Indexes: Ada, 0c | Draft: Lin, 0c | Streams: Grace, 1c
//   batched: 3 queries
//     select "id", "name" from "users" where "id" in ($1, $2, $3) -- [1,2,3]
//     select "id", "post_id", "body" from "comments" where "post_id" in ($1, $2, $3, $4) -- [1,2,3,4]
```

1 + 2 × 4 = 9 queries in the loop, and 3 after batching, a number that stays fixed whatever the page size is. This is the same `IN (…)` batching that Sequelize's `separate: true` and TypeORM's `relationLoadStrategy: 'query'` generate (lesson 79, Examples 5 and 14). With Knex, you write the grouping (`Map`, `filter`) yourself.

**Example 8 — transactions: rollback on throw, a savepoint via nested transaction, and the manual form.**

javascript

```
// transactions.js — knex.transaction with trx, rollback on throw, and a nested savepoint
const { knex, queries } = require('./db');

const count = async (table) => (await knex(table).count({ n: '*' }).first()).n;

(async () => {
  // 1. Throw inside the callback → ROLLBACK, the promise rejects with your error
  try {
    await knex.transaction(async (trx) => {
      const [post] = await trx('posts')
        .insert({ author_id: 2, title: 'ORMs', body: 'Tx demo', published: true })
        .returning('id');
      await trx('post_tags').insert([{ post_id: post.id, tag_id: 1 }, { post_id: post.id, tag_id: 4 }]);
      throw new Error('payment failed');
    });
  } catch (err) {
    console.log('rolled back:', err.message, '| posts:', await count('posts'));
  }

  // 2. Nested trx.transaction() → SAVEPOINT; its failure undoes only the inner part
  queries.length = 0;
  await knex.transaction(async (trx) => {
    await trx('comments').insert({ post_id: 2, author_id: 3, body: 'Kept' });
    try {
      await trx.transaction(async (inner) => {
        await inner('comments').insert({ post_id: 2, author_id: 3, body: 'Undone' });
        await inner('comments').insert({ post_id: 999, author_id: 3, body: 'bad FK' }); // fails
      });
    } catch (err) {
      console.log('inner failed:', err.code, err.constraint);
    }
  });                                                  // outer COMMIT
  console.log('comments on post 2:', await knex('comments').where({ post_id: 2 }).pluck('body'));
  queries.forEach((q) => console.log('  ' + q));

  await knex('comments').where({ post_id: 2 }).del();   // put the seed back

  // 3. Without a callback: you get trx back and must commit() or rollback() yourself
  const trx = await knex.transaction();
  try {
    await trx('posts').where({ id: 1 }).update({ published: false });
    console.log('inside trx:', (await trx('posts').where({ id: 1 }).first('published')).published,
      '| outside:', (await knex('posts').where({ id: 1 }).first('published')).published);
    await trx.rollback();
  } catch (err) {
    await trx.rollback();
    throw err;
  }
  console.log('completed?', trx.isCompleted(), '| after rollback:',
    (await knex('posts').where({ id: 1 }).first('published')).published);
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node transactions.js`:
//   rolled back: payment failed | posts: 4
//   inner failed: 23503 comments_post_id_foreign
//   comments on post 2: [ 'Kept' ]
//     BEGIN;
//     insert into "comments" ("author_id", "body", "post_id") values ($1, $2, $3) -- [3,"Kept",2]
//     SAVEPOINT trx4;
//     insert into "comments" ("author_id", "body", "post_id") values ($1, $2, $3) -- [3,"Undone",2]
//     insert into "comments" ("author_id", "body", "post_id") values ($1, $2, $3) -- [3,"bad FK",999]
//     ROLLBACK TO SAVEPOINT trx4
//     COMMIT;
//     select "body" from "comments" where "post_id" = $1 -- [2]
//   inside trx: false | outside: true
//   completed? true | after rollback: true
```

- In part 1, the insert and its two `post_tags` rows were rolled back, and the post count stayed at 4.
- In part 2, the logged SQL shows `SAVEPOINT trx4` … `ROLLBACK TO SAVEPOINT trx4` … `COMMIT`. The inner failure (`23503`, the foreign-key violation) undid only `'Undone'`, and `'Kept'` was committed. The savepoint name comes from Knex's internal transaction id (`trx4` in this run), so do not depend on it.
- In part 3, the read through `knex` (not `trx`) ran on another pooled connection and saw the committed `true`.

**Example 9 — edge case: `whereIn([])`, `.first()`, `count()` and an undefined binding.**

javascript

```
// edge.js — whereIn([]), whereNotIn([]), .first() and an undefined binding
const { knex, queries } = require('./db');

(async () => {
  const none = [];
  console.log(knex('posts').whereIn('id', none).toString());
  console.log('whereIn([]) rows:', (await knex('posts').whereIn('id', none)).length);
  console.log(knex('posts').whereNotIn('id', none).toString());
  console.log('whereNotIn([]) rows:', (await knex('posts').whereNotIn('id', none)).length);

  // .first() adds LIMIT 1 and returns one object, or undefined (never null, never [])
  const hit = await knex('users').where({ email: 'ada@example.com' }).first('id', 'name');
  const miss = await knex('users').where({ email: 'nobody@example.com' }).first();
  console.log('first hit:', hit, '| miss:', miss, '|', queries.at(-1));

  // .first() with no orderBy: "first" is whatever row the database returns first
  console.log(knex('posts').first('title').toString());
  console.log(knex('posts').orderBy('created_at', 'desc').first('title').toString());

  // count() comes back as a string: PostgreSQL count is bigint, and pg returns int8 as text
  console.log(await knex('posts').count('* as n').first());

  // an undefined value is rejected before any SQL is sent
  try {
    await knex('posts').where({ author_id: undefined });
  } catch (err) {
    console.log(err.message);
  }
  await knex.destroy();
})();

// Real output (Node v24.19.0, Knex 3.3.0, PostgreSQL 18.4), `node edge.js`:
//   select * from "posts" where 1 = 0
//   whereIn([]) rows: 0
//   select * from "posts" where 1 = 1
//   whereNotIn([]) rows: 4
//   first hit: { id: 1, name: 'Ada' } | miss: undefined | select * from "users" where "email" = $1 limit $2 -- ["nobody@example.com",1]
//   select "title" from "posts" limit 1
//   select "title" from "posts" order by "created_at" desc limit 1
//   { n: '4' }
//   Undefined binding(s) detected when compiling SELECT. Undefined column(s): [author_id] query: select * from "posts" where "author_id" = ?
```

- **`whereIn('id', [])` compiles to `where 1 = 0`**, which returns nothing. **`whereNotIn('id', [])` compiles to `where 1 = 1`**, which returns everything. If an empty list from user input should mean "no filter" or "no rows", decide that explicitly before calling.
- **`.first()` adds `limit 1` and resolves with one object or `undefined`.** It never returns `null` or `[]`, as the miss shows. Without `orderBy`, "first" is whatever row PostgreSQL returns first.
- **`count()` resolves with a string (`'4'`).** PostgreSQL's `count` is `bigint`, and the `pg` driver returns `int8` as text. Cast in SQL (`count(*)::int`, as in Example 4) or convert in JS.
- **An `undefined` value in `where({ … })` throws before any SQL is sent.** Compare TypeORM 1.x in lesson 79, Example 19, which also throws, and TypeORM 0.3, which silently dropped the condition.

## Common mistakes & gotchas

- **Forgetting that a builder is lazy and reusable.** Nothing runs until `await` or `.then`. A builder you `await` twice runs twice. Build a fresh one per call (`listPosts(filters)` in Example 5).
- **Using `toString()` output as SQL.** It is for logs. Execution always uses `{ sql, bindings }`.
- **Interpolating values into `knex.raw` or `whereRaw`.** Pass `?`, `:name` or `??` bindings, never `` `…${value}…` ``.
- **Counting across two 1-N joins.** Comments × tags fan out, so `count(c.id)` gave 4 for a post with 2 comments. Use `count(distinct …)` or a sub-query.
- **`whereIn` with an empty array.** It does not throw. It silently matches nothing (`1 = 0`), and `whereNotIn([])` matches everything (`1 = 1`).
- **Expecting numbers from `count()`.** It returns `'4'`, a string.
- **Running a query with `knex` inside a transaction callback.** Only `trx(...)` queries are in the transaction. `knex(...)` uses another connection (Example 8, part 3).
- **Seeds that append.** `seed:run` re-runs every seed file each time, so a seed without a `TRUNCATE`/`del()` first duplicates rows or hits unique constraints.
- **`CREATE INDEX CONCURRENTLY` in a normal migration.** PostgreSQL rejects it inside a transaction, so the file needs `exports.config = { transaction: false }`.
- **N+1 through a loop of `first()` calls.** Batch with `whereIn` and group in JS, or JOIN.

## Best practices

- Create one Knex instance per process (`db.js`) and share it. It owns the pool, so call `knex.destroy()` on shutdown.
- Subscribe to `knex.on('query')` in development and tests to log and count queries per request.
- Keep migrations small and reversible. Write a real `down()`, and test `migrate:rollback` followed by `migrate:latest` in CI.
- Opt out of the migration transaction only for statements that require it (`CONCURRENTLY`), and make such files idempotent (`IF NOT EXISTS`).
- Make seeds reset their own tables, and never run them against production data.
- Use the builder for structure and `knex.raw` fragments for SQL features it lacks (window functions, `FILTER`, casts), always with bindings.
- Use the callback form `knex.transaction(async (trx) => …)` so commit and rollback cannot be forgotten. Use nested `trx.transaction()` when part of the work may fail without undoing the rest.
- Cast aggregates in SQL (`::int`) when the value fits in a JS number.

## ⭐ Interview lens

> **Q: “Query builder or ORM: how do you choose?”**
> A: An ORM is a good fit for load-by-id, change and save flows over an object graph, where it handles relation loading and persistence. A query builder fits reporting and list endpoints, where the result is a projection, the filters are dynamic, or you need CTEs, window functions or `GROUP BY`. In those cases you want to read and control the SQL. Knex keeps every value a binding and gives you migrations and transactions, but relation loading and row-to-object mapping are your code. *Trap:* "query builders are just raw SQL with extra steps". The builder's job is composing clauses safely, which string templates do badly.

> **Q: “What does `whereIn('id', [])` generate in Knex?”**
> A: `where 1 = 0`, so it matches no rows and does not throw. `whereNotIn('id', [])` generates `where 1 = 1`, which matches every row. Treat an empty list explicitly before you build the query.

> **Q: “How do nested transactions work in Knex?”**
> A: `trx.transaction()` inside a transaction issues `SAVEPOINT <name>`. If the inner callback throws, Knex sends `ROLLBACK TO SAVEPOINT`, which undoes only the inner statements, and the outer transaction can still commit. A real `BEGIN` happens only once per connection.

> **Q: “Walk me through `knex migrate:latest` and `migrate:rollback`.”**
> A: The CLI loads the knexfile and ensures `knex_migrations` and `knex_migrations_lock` exist. It takes the lock, runs every pending file in name order, each in a transaction unless the file opts out, and records them all under one new batch number. `rollback` takes the highest batch, calls each file's `down()` in reverse order, and deletes those rows. Seeds are separate: `seed:run` re-runs every seed file each time and records nothing.

## Cheat-card

- **Version:** Knex 3.3.0 (npm `latest`, stable, 2026-06-26) + `pg` 8.23.1.
- **Inspect:** `.toSQL()` → `{ sql: '… ?', bindings }`; `.toSQL().toNative()` → `$1…`; `.toString()` = inlined, logs only.
- **Run:** `await builder` → rows; `.first()` → object or `undefined` (`limit 1`); `count()` → string.
- **Raw:** `knex.raw('… ? …', [v])`, `:name` named, `??` identifier; mix into builders via `.select(knex.raw(…))`.
- **Dynamic filters:** `.modify((qb) => { if (f.x) qb.where(...) })`.
- **CTE:** `knex.with('name', (qb) => …).from('name')`.
- **Edge cases:** `whereIn([])` → `1 = 0`; `whereNotIn([])` → `1 = 1`; `undefined` binding throws before sending.
- **Migrations:** `migrate:make`, `migrate:up`, `migrate:latest` (one batch), `migrate:rollback` (last batch), `migrate:list`; `knex_migrations` (id, name, batch, migration_time) + `_lock`; opt out with `exports.config = { transaction: false }`.
- **Seeds:** `seed:make`, `seed:run` re-runs every seed file each time and records nothing; reset tables first.
- **Transactions:** `knex.transaction(async (trx) => …)`; nested `trx.transaction()` = `SAVEPOINT`; manual `await knex.transaction()` + `commit()` / `rollback()`.
- **N+1 fix:** one `whereIn` per relation, then group in JS: 9 queries → 3.

---

## Learn More

- [Query Builder knexjs.org](https://knexjs.org/guide/query-builder.html)
- [Raw knexjs.org](https://knexjs.org/guide/raw.html)
- [Transactions knexjs.org](https://knexjs.org/guide/transactions.html)
- [Migrations and seeds knexjs.org](https://knexjs.org/guide/migrations.html)
- [Interfaces (promises, toSQL) knexjs.org](https://knexjs.org/guide/interfaces.html)
- [Installation and configuration knexjs.org](https://knexjs.org/guide/)
