---
title: "Sequelize and TypeORM"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Sequelize and TypeORM

*38 min read · Updated 12 Oct 2026 · Topic 103 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Sequelize 6.37.8 (sequelize-cli 6.6.5), TypeORM 1.1.2 (TypeScript 7.0.2, reflect-metadata 0.2.2), pg 8.23.1, PostgreSQL 18.4 run locally via the embedded-postgres npm package (no Docker)

---

## Say it in 30 seconds

Sequelize and TypeORM are object-relational mappers: you describe a table as a model or a class, and the library turns method calls into SQL and turns the rows back into objects. You will maintain them in existing Node code even if a new project would pick something else. The trade-off is the defaults. Sequelize expects timestamp columns your table may not have, and both libraries can alter a live table to match the model, which can drop columns.

## Why it matters

Both libraries do the same job. They map a class or a model to a table, turn `findAll` or `find` into SQL, and turn rows back into objects. The trouble is the defaults and the SQL they generate. Sequelize assumes every table has `createdAt` and `updatedAt` unless you say otherwise. On this kit's tables, which have neither, the first `findAll` fails. `sync({ alter: true })` and `synchronize: true` make the live table match the model. In the runs here, that dropped columns on a seeded table, and it reset every post's published flag. Lazy getters in a loop sent 9 queries instead of 1 or 2. `include` or `relations` combined with `limit` produces a subquery, a limit on joined rows, or a missing-FROM error, depending on the call.

## The concept, simply

An ORM has three parts.

1. **A mapping.** Which class goes with which table, which property with which column, and how tables relate. Sequelize builds it with `sequelize.define`, then `Post.belongsTo(User)`. TypeORM builds it with decorators: `@Entity('posts')`, `@ManyToOne(() => User)`.
2. **A query generator.** It turns `findAll({ include })` or `find({ relations })` into one or more SQL statements, sends them through the pg pool, and builds objects from the rows.
3. **Schema tools.** Migrations are versioned files that change the schema step by step. A sync mode makes the database match the model at startup. Use migrations for real databases. Sync is for throwaway ones.

text

```
users ─1───N─ posts ─1───N─ comments          posts ─N───N─ tags   (through post_tags)
  │                            ▲
  └──────────1───N─────────────┘  (comments.author_id)

Sequelize                                   TypeORM
User.hasMany(Post, {foreignKey})            @OneToMany(() => Post, p => p.author)    posts
Post.belongsTo(User, {as:'author'})         @ManyToOne(() => User) @JoinColumn       author
Post.hasMany(Comment)                       @OneToMany(() => Comment, c => c.post)   comments
Post.belongsToMany(Tag,{through:'post_tags'}) @ManyToMany(() => Tag) @JoinTable({name:'post_tags'})
```


## How it works

The canonical query is published posts with author name, comment count, and tag names, newest first.

1. At startup the library builds metadata. Sequelize does that from each `define` and each association. TypeORM's `DataSource.initialize` reads decorator metadata that tsc emitted for every entity class.
2. You call `findAll` or a query builder.
3. The generator picks a JOIN for each association and adds the columns it needs to rebuild objects, including primary keys of every joined table.
4. If the query has a limit and a to-many include, the limit has to count parents, not joined rows. Sequelize wraps the parent query in a subquery. TypeORM's `take` first runs a separate `SELECT DISTINCT id ... LIMIT`.
5. With logging on, both libraries hand you the final SQL. That is how every query count in this lesson was taken.
6. Rows come back flat, one per post times tag. The library groups them by primary key into `post.author.name` and `post.tags`.

**Sequelize on an existing schema.** `tableName` stops it pluralizing the model name. `timestamps: false` stops it adding `createdAt` and `updatedAt`, which it does by default. `field` maps a camelCase attribute to a snake_case column. Associations add getters such as `post.getAuthor()` and make `include` work. `foreignKey` names the real column. For `belongsToMany`, `through: 'post_tags'` makes Sequelize build a junction model for that table.

**TypeORM entities.** `@ManyToOne` plus `@JoinColumn({ name: 'author_id' })` is the side that holds the foreign key. `@OneToMany` is the inverse and cannot exist without the ManyToOne. `@ManyToMany` plus `@JoinTable` must name the junction table and both columns, or TypeORM invents names. A bare `@JoinTable()` on `Post.tags` resolved to table `posts_tags_tags` with columns `postsId` and `tagsId` in 1.1.2. Decorators need `experimentalDecorators` and `emitDecoratorMetadata`. Node's type stripping does not transform decorators. The Node docs say they result in a parser error, and Example 10 shows that error. This project is compiled with tsc and run from `dist`.

**Migrations.** `sequelize-cli migration:generate` writes an empty skeleton. You write the `createTable` calls. Sequelize v6's CLI has no model-to-migration diff. `typeorm migration:generate` connects, compares the database with the entity metadata, and writes the SQL that closes the gap. Review that file, because it is a diff of the database as it is right now. Applied migrations are recorded in `SequelizeMeta` (one name column) or in `migrations` (id, timestamp, name). TypeORM wraps a run in one transaction by default.

**Transactions.** The managed form, `sequelize.transaction(async (t) => ...)` or `dataSource.transaction(async (manager) => ...)`, commits when the callback resolves and rolls back when it throws. The unmanaged form gives you a transaction or a query runner, and you commit or roll back yourself. A query joins the transaction only if you route it there. In Sequelize, pass `{ transaction: t }` on every call. In TypeORM, use the manager or `queryRunner.manager`. A query without that runs on another pooled connection.

**Sync.** Both read the live table, compare it with the model, and issue ALTER TABLE until they match. A column in the table but not in the model is dropped. Sequelize's alter also dropped `author_id` when the model declared no association, because the foreign key was then "unknown". TypeORM 1.1.2 renames a column only when exactly one column disappeared and exactly one appeared with the same type and nullability. Otherwise it drops the old column and adds a new one.

text

```
entity vs table diff for "posts"            what synchronize does (Example 18)
──────────────────────────────────          ───────────────────────────────────────────────
1 column renamed, nothing else changed  →   ALTER TABLE … RENAME COLUMN "title" TO "headline"
renamed + 1 new column (counts differ)  →   DROP COLUMN "title"; ADD "headline" text NOT NULL
                                            → fails on existing rows → ROLLBACK, app won't start
renamed column has a DEFAULT + new col  →   DROP COLUMN "published"; ADD "is_published" … DEFAULT false
                                            → COMMIT: every post's flag is now false (data lost)
```


**N+1.** A lazy getter such as `await post.getAuthor()`, or a `findOneBy` inside a loop, is one round trip per call. Four posts times two relations is 1 + 8 = 9 queries, and the count grows with the page. A JOIN, `include` or `relations`, is one query and repeats parent columns on every joined row. One batched query per relation, Sequelize `separate: true` or TypeORM `relationLoadStrategy: 'query'`, is a fixed number of queries whatever the page size.

**include plus limit.** With a to-many JOIN, one post with two comments is two rows, so LIMIT 2 can return one post. Sequelize puts the LIMIT in a subquery over posts and joins the children outside it.

text

```
default (subQuery)                               subQuery: false
SELECT "Post".*, comments.*                      SELECT posts.*, comments.*
FROM (SELECT … FROM posts                        FROM posts LEFT JOIN comments …
      ORDER BY id LIMIT 2) AS "Post"             ORDER BY id LIMIT 2        ← limits joined rows
LEFT JOIN comments ON …                          → post 1 twice (2 comments), post 2 never seen
→ posts 1 and 2, with all their comments
```


The subquery has a cost. A where on `'$comments.body$'` lands inside the subquery, where comments is not joined, and PostgreSQL rejects it.

## Code examples

Every example ran against a real PostgreSQL 18.4 server on `127.0.0.1:6500`, with `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6500/<db>` set in the shell. Each project started from a freshly created, empty database (`node recreate-db.cjs`), then ran its own migration and seed.

**Example 1 — versions, and the three projects.** Check what npm's `latest` tag actually points at before you install:

bash

```
$ npm view sequelize dist-tags
{
  v4: '4.44.4',
  v5: '5.22.5',
  alpha: '7.0.0-alpha.9',
  latest: '6.37.8'
}
$ npm view @sequelize/core dist-tags
{ alpha: '7.0.0-alpha.42', latest: '7.0.0-alpha.48' }
$ npm view typeorm dist-tags
{
  master: '1.0.0-nightly.20260311',
  beta: '1.0.0-beta.3',
  legacy: '0.3.31',
  latest: '1.1.2',
  dev: '1.1.2-nightly.20261012'
}
```

bash

```
$ npm install sequelize@6.37.8 pg@8.23.1 sequelize-cli@6.6.5
…
$ npm ls --depth=0
seq@1.0.0 …/seq
├── pg@8.23.1
├── sequelize-cli@6.6.5
└── sequelize@6.37.8
$ npm install typeorm@1.1.2 pg@8.23.1 reflect-metadata@0.2.2 && npm install -D typescript@7.0.2 @types/node@24
…
$ npm ls --depth=0
torm@1.0.0 …/torm
├── @types/node@24.19.2
├── pg@8.23.1
├── reflect-metadata@0.2.2
├── typeorm@1.1.2
└── typescript@7.0.2
```

Both projects are CommonJS (`"type": "commonjs"` from `npm init -y`). Two small `pg` helpers sit in each project and are reused in [lesson 76](76-knex-query-builder.md). `inspect.cjs` prints query results as tables. `recreate-db.cjs` gives each run a fresh, empty database:

javascript

```
// inspect.cjs — usage: node inspect.cjs <database-url> "<sql>" ...  (prints each result with console.table)
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.argv[2] });
  await client.connect();
  for (const sql of process.argv.slice(3)) console.table((await client.query(sql)).rows);
  await client.end();
})();
```

javascript

```
// recreate-db.cjs — drop and recreate the database named in DATABASE_URL (scratch databases only)
const { Client } = require('pg');
(async () => {
  const url = new URL(process.env.DATABASE_URL);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';                       // connect to the maintenance database
  const client = new Client({ connectionString: url.href });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await client.query(`CREATE DATABASE "${name}"`);
  await client.end();
  console.log('recreated database', name);
})();
```

**Example 2 — Sequelize models and associations mapped onto the existing tables.** The `logging` callback stores every SQL string, so later examples can count queries. The transaction-id prefix (`Executing (default): ` or `Executing (<uuid>): `) is stripped from each string.

javascript

```
// models.js — Sequelize 6 models mapped onto the existing tables (no sync()).
const { Sequelize, DataTypes } = require('sequelize');

const queries = [];  // every SQL statement Sequelize sends, for counting
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: (sql) => queries.push(sql.replace(/^Executing \([^)]*\): /, '')),
  define: { timestamps: false },   // the tables have no createdAt/updatedAt columns
});

const User = sequelize.define('User', {
  email: { type: DataTypes.TEXT, allowNull: false, unique: true },
  name: { type: DataTypes.TEXT, allowNull: false },
}, { tableName: 'users' });

const Post = sequelize.define('Post', {
  title: { type: DataTypes.TEXT, allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  createdAt: { type: DataTypes.DATE, field: 'created_at' },
}, { tableName: 'posts' });

const Comment = sequelize.define('Comment', {
  body: { type: DataTypes.TEXT, allowNull: false },
  createdAt: { type: DataTypes.DATE, field: 'created_at' },
}, { tableName: 'comments' });

const Tag = sequelize.define('Tag', {
  name: { type: DataTypes.TEXT, allowNull: false, unique: true },
}, { tableName: 'tags' });

// Associations. foreignKey names the real column; `as` names the accessor.
User.hasMany(Post, { foreignKey: 'author_id', as: 'posts' });
Post.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
Post.hasMany(Comment, { foreignKey: 'post_id', as: 'comments' });
Comment.belongsTo(Post, { foreignKey: 'post_id' });
User.hasMany(Comment, { foreignKey: 'author_id' });
Comment.belongsTo(User, { foreignKey: 'author_id', as: 'author' });
// through: a table name string makes Sequelize build a junction model for it.
Post.belongsToMany(Tag, { through: 'post_tags', foreignKey: 'post_id', otherKey: 'tag_id', as: 'tags' });
Tag.belongsToMany(Post, { through: 'post_tags', foreignKey: 'tag_id', otherKey: 'post_id', as: 'posts' });

module.exports = { sequelize, queries, User, Post, Comment, Tag };
```

**Example 3 — Sequelize migrations with sequelize-cli.** `init` creates `config/`, `migrations/`, `seeders/` and `models/`. The config was replaced with one that reads `DATABASE_URL` (`use_env_variable`). `migration:generate` writes only a skeleton:

bash

```
$ npx sequelize-cli init
…
$ printf '{\n  "development": { "use_env_variable": "DATABASE_URL", "dialect": "postgres" }\n}\n' > config/config.json
$ npx sequelize-cli migration:generate --name create-blog-schema

Sequelize CLI [Node: 24.19.0, CLI: 6.6.5, ORM: 6.37.8]

migrations folder at "…/seq/migrations" already exists.
New migration was created at …/seq/migrations/20261012141232-create-blog-schema.js .
$ cat migrations/20261012141232-create-blog-schema.js
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
  }
};
$ npx sequelize-cli seed:generate --name blog-seed
…
New seed was created at …/seq/seeders/20261012141243-blog-seed.js .
```

json

```
{
  "development": { "use_env_variable": "DATABASE_URL", "dialect": "postgres" }
}
```

The migration, written by hand. All five tables are created inside one transaction:

javascript

```
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const fk = (table) => ({ type: Sequelize.INTEGER, allowNull: false,
      references: { model: table, key: 'id' }, onDelete: 'CASCADE' });
    const id = { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true };
    const now = { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('now') };

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable('users', {
        id,
        email: { type: Sequelize.TEXT, allowNull: false, unique: true },
        name: { type: Sequelize.TEXT, allowNull: false },
      }, { transaction });
      await queryInterface.createTable('posts', {
        id,
        author_id: fk('users'),
        title: { type: Sequelize.TEXT, allowNull: false },
        body: { type: Sequelize.TEXT, allowNull: false },
        published: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        created_at: now,
      }, { transaction });
      await queryInterface.createTable('comments', {
        id,
        post_id: fk('posts'),
        author_id: fk('users'),
        body: { type: Sequelize.TEXT, allowNull: false },
        created_at: now,
      }, { transaction });
      await queryInterface.createTable('tags', {
        id,
        name: { type: Sequelize.TEXT, allowNull: false, unique: true },
      }, { transaction });
      await queryInterface.createTable('post_tags', {
        post_id: { ...fk('posts'), primaryKey: true },
        tag_id: { ...fk('tags'), primaryKey: true },
      }, { transaction });
    });
  },

  async down(queryInterface) {
    for (const t of ['post_tags', 'tags', 'comments', 'posts', 'users']) {
      await queryInterface.dropTable(t);
    }
  },
};
```

The seeder. `bulkInsert` sends one multi-row `INSERT` per table:

javascript

```
'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Run against an empty, freshly migrated database, so serial ids start at 1.
    await queryInterface.bulkInsert('users', [
      { email: 'ada@example.com', name: 'Ada' },     // id 1
      { email: 'lin@example.com', name: 'Lin' },     // id 2
      { email: 'grace@example.com', name: 'Grace' }, // id 3
    ]);
    await queryInterface.bulkInsert('posts', [
      { author_id: 1, title: 'Hello SQL', body: 'First post', published: true },
      { author_id: 1, title: 'Indexes', body: 'B-trees', published: true },
      { author_id: 2, title: 'Draft', body: 'WIP', published: false },
      { author_id: 3, title: 'Streams', body: 'Backpressure', published: true },
    ]);
    await queryInterface.bulkInsert('tags', [
      { name: 'sql' }, { name: 'intro' }, { name: 'perf' }, { name: 'node' }, // ids 1-4
    ]);
    await queryInterface.bulkInsert('post_tags', [
      { post_id: 1, tag_id: 1 }, { post_id: 1, tag_id: 2 },
      { post_id: 2, tag_id: 1 }, { post_id: 2, tag_id: 3 },
      { post_id: 4, tag_id: 4 },
    ]);
    await queryInterface.bulkInsert('comments', [
      { post_id: 1, author_id: 2, body: 'Nice' },
      { post_id: 1, author_id: 3, body: '+1' },
      { post_id: 4, author_id: 1, body: 'Thanks' },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      'TRUNCATE post_tags, comments, tags, posts, users RESTART IDENTITY CASCADE');
  },
};
```

Running both, then looking at the bookkeeping table:

bash

```
$ npx sequelize-cli db:migrate

Sequelize CLI [Node: 24.19.0, CLI: 6.6.5, ORM: 6.37.8]

Loaded configuration file "config/config.json".
Using environment "development".
== 20261012141232-create-blog-schema: migrating =======
== 20261012141232-create-blog-schema: migrated (0.024s)

$ npx sequelize-cli db:seed:all

Sequelize CLI [Node: 24.19.0, CLI: 6.6.5, ORM: 6.37.8]

Loaded configuration file "config/config.json".
Using environment "development".
== 20261012141243-blog-seed: migrating =======
== 20261012141243-blog-seed: migrated (0.013s)

$ npx sequelize-cli db:migrate:status

Sequelize CLI [Node: 24.19.0, CLI: 6.6.5, ORM: 6.37.8]

Loaded configuration file "config/config.json".
Using environment "development".
up 20261012141232-create-blog-schema.js
```

bash

```
$ node inspect.cjs "$DATABASE_URL" 'select * from "SequelizeMeta"'
┌─────────┬────────────────────────────────────────┐
│ (index) │ name                                   │
├─────────┼────────────────────────────────────────┤
│ 0       │ '20261012141232-create-blog-schema.js' │
└─────────┴────────────────────────────────────────┘
```

`bulkInsert` gave all four posts the same `created_at`, because they went in one statement and `now()` is fixed for the whole transaction. Every "newest first" query in this lesson therefore orders by `created_at DESC, id DESC`.

**Example 4 — the canonical query in Sequelize, with the real logged SQL.** The comment count is a correlated subquery passed through `sequelize.literal`. A `COUNT` over a JOIN would need `GROUP BY` on every selected column, and the tag JOIN would also multiply the count.

javascript

```
// canonical.js — published posts with author name, comment count and tag names, newest first
const { sequelize, queries, Post, User, Tag } = require('./models');

(async () => {
  const posts = await Post.findAll({
    where: { published: true },
    attributes: ['id', 'title', 'createdAt',
      // a correlated subquery keeps one row per post (a JOIN + COUNT would need GROUP BY on every column)
      [sequelize.literal('(SELECT count(*)::int FROM comments c WHERE c.post_id = "Post"."id")'), 'commentCount']],
    include: [
      { model: User, as: 'author', attributes: ['name'] },
      { model: Tag, as: 'tags', attributes: ['name'], through: { attributes: [] } },
    ],
    order: [['createdAt', 'DESC'], ['id', 'DESC'], [{ model: Tag, as: 'tags' }, 'name', 'ASC']],
  });
  for (const p of posts) {
    console.log(p.id, p.title, '|', p.author.name, '| comments:', p.get('commentCount'),
      '| tags:', p.tags.map((t) => t.name).join(',') || '-');
  }
  console.log('queries:', queries.length);
  console.log(queries[0]);
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node canonical.js`:
//   4 Streams | Grace | comments: 1 | tags: node
//   2 Indexes | Ada | comments: 0 | tags: perf,sql
//   1 Hello SQL | Ada | comments: 2 | tags: intro,sql
//   queries: 1
//   SELECT "Post"."id", "Post"."title", "Post"."created_at" AS "createdAt", (SELECT count(*)::int FROM comments c WHERE c.post_id = "Post"."id") AS "commentCount", "author"."id" AS "author.id", "author"."name" AS "author.name", "tags"."id" AS "tags.id", "tags"."name" AS "tags.name" FROM "posts" AS "Post" LEFT OUTER JOIN "users" AS "author" ON "Post"."author_id" = "author"."id" LEFT OUTER JOIN ( "post_tags" AS "tags->post_tags" INNER JOIN "tags" AS "tags" ON "tags"."id" = "tags->post_tags"."tag_id") ON "Post"."id" = "tags->post_tags"."post_id" WHERE "Post"."published" = true ORDER BY "createdAt" DESC, "Post"."id" DESC, "tags"."name" ASC;
```

**Example 5 — N+1 with lazy getters, counted, then fixed.**

javascript

```
// nplus1.js — lazy association getters in a loop, then the eager-loading fix
const { sequelize, queries, Post, User, Comment } = require('./models');

(async () => {
  // N+1: one query for the posts, then two more per post
  const posts = await Post.findAll({ order: [['id', 'ASC']] });
  for (const post of posts) {
    const author = await post.getAuthor();     // SELECT … FROM users WHERE id = …
    const comments = await post.getComments(); // SELECT … FROM comments WHERE post_id = …
    console.log(post.title, '-', author.name, '-', comments.length, 'comments');
  }
  console.log('lazy getters:', queries.length, 'queries');
  queries.slice(0, 3).forEach((q) => console.log('  ' + q));
  queries.length = 0;

  // Fix A: one JOINed query
  const joined = await Post.findAll({
    include: [{ model: User, as: 'author' }, { model: Comment, as: 'comments' }],
    order: [['id', 'ASC']],
  });
  console.log('include (JOIN):', queries.length, 'query,', joined.length, 'posts');
  queries.length = 0;

  // Fix B: separate: true runs one extra query per hasMany association, not per row
  await Post.findAll({
    include: [{ model: User, as: 'author' }, { model: Comment, as: 'comments', separate: true }],
    order: [['id', 'ASC']],
  });
  console.log('include + separate:', queries.length, 'queries');
  queries.forEach((q) => console.log('  ' + q));
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node nplus1.js`:
//   Hello SQL - Ada - 2 comments
//   Indexes - Ada - 0 comments
//   Draft - Lin - 0 comments
//   Streams - Grace - 1 comments
//   lazy getters: 9 queries
//     SELECT "id", "title", "body", "published", "created_at" AS "createdAt", "author_id" FROM "posts" AS "Post" ORDER BY "Post"."id" ASC;
//     SELECT "id", "email", "name" FROM "users" AS "User" WHERE "User"."id" = 1;
//     SELECT "id", "body", "created_at" AS "createdAt", "post_id", "author_id" FROM "comments" AS "Comment" WHERE "Comment"."post_id" = 1;
//   include (JOIN): 1 query, 4 posts
//   include + separate: 2 queries
//     SELECT "Post"."id", "Post"."title", "Post"."body", "Post"."published", "Post"."created_at" AS "createdAt", "Post"."author_id", "author"."id" AS "author.id", "author"."email" AS "author.email", "author"."name" AS "author.name" FROM "posts" AS "Post" LEFT OUTER JOIN "users" AS "author" ON "Post"."author_id" = "author"."id" ORDER BY "Post"."id" ASC;
//     SELECT "id", "body", "created_at" AS "createdAt", "post_id", "author_id" FROM "comments" AS "Comment" WHERE "Comment"."post_id" IN (1, 2, 3, 4);
```

9 queries became 1 query with a JOIN, or 2 with `separate: true`. The counts are from the `logging` callback, not estimates.

**Example 6 — Sequelize transactions: managed with rollback, unmanaged, and the sequence that is not rolled back.**

javascript

```
// transactions.js — managed (callback) and unmanaged (manual commit/rollback) transactions
const { sequelize, queries, Post, Tag } = require('./models');

const countPosts = () => Post.count();

(async () => {
  console.log('posts before:', await countPosts());

  // 1. Managed: Sequelize commits when the callback resolves, rolls back when it throws.
  try {
    await sequelize.transaction(async (t) => {
      const post = await Post.create(
        { author_id: 2, title: 'ORMs', body: 'Tx demo', published: true }, { transaction: t });
      const tags = await Tag.findAll({ where: { name: ['sql', 'node'] }, transaction: t });
      await post.addTags(tags, { transaction: t });  // INSERT INTO post_tags …
      console.log('inside tx, post id', post.id, 'posts:', await Post.count({ transaction: t }));
      throw new Error('payment failed');              // → ROLLBACK
    });
  } catch (err) {
    console.log('managed tx rolled back:', err.message);
  }
  console.log('posts after managed rollback:', await countPosts());
  console.log(queries.filter((q) => /START|COMMIT|ROLLBACK|INSERT/.test(q)).join('\n'));
  queries.length = 0;

  // 2. Unmanaged: you call commit() or rollback() yourself, exactly once.
  const t = await sequelize.transaction();
  try {
    await Post.update({ published: false }, { where: { id: 1 }, transaction: t });
    console.log('inside tx  post 1 published =',
      (await Post.findByPk(1, { transaction: t })).published);
    console.log('outside tx post 1 published =',
      (await Post.findByPk(1)).published);         // no `transaction` → another connection
    await t.rollback();                            // decided not to keep it
  } catch (err) {
    await t.rollback();
    throw err;
  }
  console.log('after rollback post 1 published =', (await Post.findByPk(1)).published);

  // 3. A sequence is not transactional: the rolled-back INSERT still used up an id.
  const [[{ last_value }]] = await sequelize.query('SELECT last_value FROM posts_id_seq');
  console.log('posts_id_seq last_value:', last_value);
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node transactions.js`:
//   posts before: 4
//   inside tx, post id 5 posts: 5
//   managed tx rolled back: payment failed
//   posts after managed rollback: 4
//   START TRANSACTION;
//   INSERT INTO "posts" ("id","title","body","published","author_id") VALUES (DEFAULT,$1,$2,$3,$4) RETURNING "id","title","body","published","created_at","author_id";
//   INSERT INTO "post_tags" ("post_id","tag_id") VALUES (5,1),(5,4) RETURNING "post_id","tag_id";
//   ROLLBACK;
//   inside tx  post 1 published = false
//   outside tx post 1 published = true
//   after rollback post 1 published = true
//   posts_id_seq last_value: 5
```

`post.addTags` wrote the junction rows inside the same transaction, and the `ROLLBACK` removed them too. The read without `{ transaction: t }` ran on a different pooled connection and saw the committed value. `posts_id_seq` reads 5 after the rollback, because the rolled-back `INSERT` still used up id 5. Sequences are not transactional, so ids can have gaps.

**Example 7 — pitfall: the default timestamps, and `paranoid`.** The same table mapped with and without `timestamps: false`:

javascript

```
// timestamps.js — the default model options assume createdAt/updatedAt columns
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false });

const Tag = sequelize.define('Tag', { name: DataTypes.TEXT }, { tableName: 'tags' });
const FixedTag = sequelize.define('FixedTag', { name: DataTypes.TEXT },
  { tableName: 'tags', timestamps: false });

(async () => {
  console.log('attributes Sequelize added:', Object.keys(Tag.getAttributes()));
  try {
    await Tag.findAll();
  } catch (err) {
    console.log(err.name, '-', err.message);
    console.log('SQL:', err.sql);
  }
  try {
    await Tag.create({ name: 'graphql' });
  } catch (err) {
    console.log(err.name, '-', err.message);
  }
  const rows = await FixedTag.findAll({ order: [['id', 'ASC']], raw: true });
  console.log('with timestamps: false ->', rows.map((r) => r.name));
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node timestamps.js`:
//   attributes Sequelize added: [ 'id', 'name', 'createdAt', 'updatedAt' ]
//   SequelizeDatabaseError - column "createdAt" does not exist
//   SQL: SELECT "id", "name", "createdAt", "updatedAt" FROM "tags" AS "Tag";
//   SequelizeDatabaseError - column "createdAt" of relation "tags" does not exist
//   with timestamps: false -> [ 'sql', 'intro', 'perf', 'node' ]
```

`paranoid: true` turns `destroy()` into an `UPDATE` of a `deletedAt` column. The Sequelize docs say "Paranoid requires timestamps to work", and the first model below shows what happens without them. `paranoid` stays `true` on the options, but `destroy()` issues a real `DELETE`, with no warning:

javascript

```
// paranoid.js — paranoid: true turns destroy() into an UPDATE of deletedAt
const { Sequelize, DataTypes } = require('sequelize');
const log = [];
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: (s) => log.push(s) });

// paranoid needs timestamps; with timestamps: false it is silently ignored
const NoTs = sequelize.define('NoTs', { name: DataTypes.TEXT },
  { tableName: 'tags', timestamps: false, paranoid: true });
const Soft = sequelize.define('Soft', { name: DataTypes.TEXT },
  { tableName: 'tags', paranoid: true, createdAt: false, updatedAt: false, deletedAt: 'deleted_at' });

(async () => {
  console.log('NoTs paranoid?', NoTs.options.paranoid, NoTs.getAttributes().deleted_at ? 'has deleted_at' : 'no deleted_at attr');
  await sequelize.transaction(async (transaction) => {
    await NoTs.destroy({ where: { name: 'node' }, transaction });
    console.log(log.at(-1));
    throw new Error('rollback on purpose');
  }).catch((e) => console.log(e.message));
  try {
    await Soft.destroy({ where: { name: 'node' } });
  } catch (err) {
    console.log(err.name, '-', err.message);
    console.log(log.at(-1));
  }
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node paranoid.js`:
//   NoTs paranoid? true no deleted_at attr
//   Executing (1194fe72-6c97-4bc4-93ee-10835543f7fe): DELETE FROM "tags" WHERE "name" = 'node'
//   rollback on purpose
//   SequelizeDatabaseError - column "deleted_at" does not exist
//   Executing (default): UPDATE "tags" SET "deleted_at"=$1 WHERE "deleted_at" IS NULL AND "name" = $2
```

The first `DELETE` ran inside a transaction that was then rolled back on purpose, so the seed is intact. The fix is the same for both: declare exactly the columns the table has. That means `timestamps: false` here. A soft-delete model needs a real `deleted_at` column, added by a migration.

**Example 8 — pitfall: `include` of a hasMany with `limit`.**

javascript

```
// include-limit.js — include of a hasMany + limit: Sequelize wraps the parent in a subquery
const { sequelize, queries, Post, Comment } = require('./models');

const show = (label, posts) => console.log(label, posts.map((p) => `${p.id}:${p.comments.length}c`).join(' '));

(async () => {
  const opts = { include: [{ model: Comment, as: 'comments' }], order: [['id', 'ASC']], limit: 2 };

  show('default      ->', await Post.findAll(opts));
  console.log(queries.at(-1));

  // subQuery: false puts LIMIT on the joined rows, not on posts
  show('subQuery:false ->', await Post.findAll({ ...opts, subQuery: false }));
  console.log(queries.at(-1));

  // a required include + limit: the WHERE EXISTS-style filter moves inside the subquery
  show('required:true ->', await Post.findAll({ ...opts, include: [{ model: Comment, as: 'comments', required: true }] }));
  console.log(queries.at(-1));

  // a '$nested.column$' filter + limit: the WHERE lands inside the subquery, where "comments" is not joined
  try {
    await Post.findAll({ ...opts, where: { '$comments.body$': 'Nice' } });
  } catch (err) {
    console.log(err.name, '-', err.message);
    console.log(queries.at(-1));
  }
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node include-limit.js`:
//   default      -> 1:2c 2:0c
//   SELECT "Post".*, "comments"."id" AS "comments.id", "comments"."body" AS "comments.body", "comments"."created_at" AS "comments.createdAt", "comments"."post_id" AS "comments.post_id", "comments"."author_id" AS "comments.author_id" FROM (SELECT "Post"."id", "Post"."title", "Post"."body", "Post"."published", "Post"."created_at" AS "createdAt", "Post"."author_id" FROM "posts" AS "Post" ORDER BY "Post"."id" ASC LIMIT 2) AS "Post" LEFT OUTER JOIN "comments" AS "comments" ON "Post"."id" = "comments"."post_id" ORDER BY "Post"."id" ASC;
//   subQuery:false -> 1:2c
//   SELECT "Post"."id", "Post"."title", "Post"."body", "Post"."published", "Post"."created_at" AS "createdAt", "Post"."author_id", "comments"."id" AS "comments.id", "comments"."body" AS "comments.body", "comments"."created_at" AS "comments.createdAt", "comments"."post_id" AS "comments.post_id", "comments"."author_id" AS "comments.author_id" FROM "posts" AS "Post" LEFT OUTER JOIN "comments" AS "comments" ON "Post"."id" = "comments"."post_id" ORDER BY "Post"."id" ASC LIMIT 2;
//   required:true -> 1:2c 4:1c
//   SELECT "Post".*, "comments"."id" AS "comments.id", "comments"."body" AS "comments.body", "comments"."created_at" AS "comments.createdAt", "comments"."post_id" AS "comments.post_id", "comments"."author_id" AS "comments.author_id" FROM (SELECT "Post"."id", "Post"."title", "Post"."body", "Post"."published", "Post"."created_at" AS "createdAt", "Post"."author_id" FROM "posts" AS "Post" WHERE ( SELECT "post_id" FROM "comments" AS "comments" WHERE ("comments"."post_id" = "Post"."id") LIMIT 1 ) IS NOT NULL ORDER BY "Post"."id" ASC LIMIT 2) AS "Post" INNER JOIN "comments" AS "comments" ON "Post"."id" = "comments"."post_id" ORDER BY "Post"."id" ASC;
//   SequelizeDatabaseError - missing FROM-clause entry for table "comments"
//   SELECT "Post".*, "comments"."id" AS "comments.id", "comments"."body" AS "comments.body", "comments"."created_at" AS "comments.createdAt", "comments"."post_id" AS "comments.post_id", "comments"."author_id" AS "comments.author_id" FROM (SELECT "Post"."id", "Post"."title", "Post"."body", "Post"."published", "Post"."created_at" AS "createdAt", "Post"."author_id" FROM "posts" AS "Post" WHERE "comments"."body" = 'Nice' ORDER BY "Post"."id" ASC LIMIT 2) AS "Post" LEFT OUTER JOIN "comments" AS "comments" ON "Post"."id" = "comments"."post_id" ORDER BY "Post"."id" ASC;
```

- The default wraps `posts … LIMIT 2` in a subquery, which gives the correct 2 posts.
- `subQuery: false` applies the limit to joined rows, so it returns 1 post.
- `required: true` adds a correlated `IS NOT NULL` check inside the subquery.
- The `$comments.body$` filter lands inside the subquery, where `comments` does not exist, and PostgreSQL rejects it.

For that last one, use `required: true` with a `where` on the include itself, or drop the limit. For pagination over parents, `separate: true` on the to-many include avoids the subquery entirely.

**Example 9 — edge case: `sync({ alter: true })` on a seeded table (scratch database).** A model where someone renamed `title` to `headline` and left out `body`. It was run against a separate, freshly migrated and seeded database, `seqalter`:

javascript

```
// alter.js — sync({ alter: true }) makes the table match the model, data or not. Scratch DB only.
const { Sequelize, DataTypes } = require('sequelize');
const sql = [];
const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: (s) => sql.push(s.replace(/^Executing \([^)]*\): /, '')) });

// Someone renamed `title` to `headline` in the model and removed `body`.
const Post = sequelize.define('Post', {
  headline: { type: DataTypes.TEXT },
  published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'posts', timestamps: false });

(async () => {
  const [before] = await sequelize.query('SELECT id, title, body FROM posts ORDER BY id');
  console.log('before:', before);
  await Post.sync({ alter: true });
  sql.filter((s) => /^ALTER/.test(s)).forEach((s) => console.log(s));
  const [after] = await sequelize.query('SELECT * FROM posts ORDER BY id');
  console.log('after:', after);
  await sequelize.close();
})();

// Real output (Node v24.19.0, Sequelize 6.37.8, PostgreSQL 18.4), `node alter.js`:
//   before: [
//     { id: 1, title: 'Hello SQL', body: 'First post' },
//     { id: 2, title: 'Indexes', body: 'B-trees' },
//     { id: 3, title: 'Draft', body: 'WIP' },
//     { id: 4, title: 'Streams', body: 'Backpressure' }
//   ]
//   ALTER TABLE "public"."posts" ADD COLUMN "headline" TEXT;
//   ALTER TABLE "public"."posts" DROP COLUMN "author_id";
//   ALTER TABLE "public"."posts" DROP COLUMN "title";
//   ALTER TABLE "public"."posts" DROP COLUMN "body";
//   ALTER TABLE "posts" ALTER COLUMN "published" SET NOT NULL;ALTER TABLE "posts" ALTER COLUMN "published" SET DEFAULT false;ALTER TABLE "posts" ALTER COLUMN "published" TYPE BOOLEAN;
//   ALTER TABLE "public"."posts" DROP COLUMN "created_at";
//   after: [
//     { id: 1, published: true, headline: null },
//     { id: 2, published: true, headline: null },
//     { id: 3, published: false, headline: null },
//     { id: 4, published: true, headline: null }
//   ]
```

Sequelize has no rename detection. It added an empty `headline` and dropped `title`, `body` and `created_at`. It also dropped `author_id`, because this model declared no `belongsTo`, so the foreign key column was not part of the model. Dropping `author_id` also dropped its foreign key. The Sequelize docs say `sync({ force: true })` and `sync({ alter: true })` "can be destructive operations. Therefore, they are not recommended for production-level software."

**Example 10 — TypeORM project setup: tsconfig, entities, DataSource, build.** Node's built-in type stripping cannot run decorators:

typescript

```
// decorators.mts — does Node's built-in type stripping accept a decorator?
const Entity = (table: string) => (target: Function) => target;

@Entity('users')
class User { id!: number; }

console.log(User.name);
```

bash

```
$ node decorators.mts
file://…/torm/decorators.mts:4
@Entity('users')
^

SyntaxError: Invalid or unexpected token
```

So the project is compiled with `tsc`:

json

```
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "strictPropertyInitialization": false,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

typescript

```
// src/entities.ts — TypeORM 1.x entities mapped onto the shared tables
import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, OneToMany, ManyToMany, JoinColumn, JoinTable, VirtualColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'text', unique: true }) email: string;
  @Column({ type: 'text' }) name: string;
  @OneToMany(() => Post, (post) => post.author) posts: Post[];
  @OneToMany(() => Comment, (comment) => comment.author) comments: Comment[];
}

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'author_id' }) authorId: number;
  @ManyToOne(() => User, (user) => user.posts, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text' }) body: string;
  @Column({ default: false }) published: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @OneToMany(() => Comment, (comment) => comment.post) comments: Comment[];
  @ManyToMany(() => Tag, (tag) => tag.posts)
  @JoinTable({
    name: 'post_tags',
    joinColumn: { name: 'post_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags: Tag[];
  // (added in 1.0 as the replacement for loadRelationCountAndMap / @RelationCount)
  @VirtualColumn({ type: 'int', query: (alias) =>
    `SELECT count(*) FROM comments c WHERE c.post_id = ${alias}.id` })
  commentCount: number;
}

@Entity('comments')
export class Comment {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => Post, (post) => post.comments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'post_id' })
  post: Post;
  @ManyToOne(() => User, (user) => user.comments, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;
  @Column({ type: 'text' }) body: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('tags')
export class Tag {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'text', unique: true }) name: string;
  @ManyToMany(() => Post, (post) => post.tags) posts: Post[];
}
```

The DataSource is used by both the app and the CLI. Its custom logger collects every query for counting. It also prints the CLI's schema and migration messages, and prints SQL when `LOG_SQL` is set.

typescript

```
// src/data-source.ts — the DataSource the CLI and the app both load
import 'reflect-metadata';
import { DataSource, type Logger } from 'typeorm';
import { User, Post, Comment, Tag } from './entities.js';

// Every SQL statement TypeORM sends, so examples can count them.
export const queries: string[] = [];
const countingLogger: Logger = {
  logQuery: (sql, params) => {
    queries.push(params?.length ? `${sql} -- ${JSON.stringify(params)}` : sql);
    if (process.env.LOG_SQL) console.log('query: ' + sql);
  },
  logQueryError: (err, sql) => console.log('query failed:', String(err), '\n  ', sql),
  logQuerySlow: () => {},
  logSchemaBuild: (message) => console.log(message),  // the migration CLI reports progress here
  logMigration: (message) => console.log(message),
  log: (level, message) => { if (level === 'warn') console.log(message); },
};

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Post, Comment, Tag],
  migrations: [__dirname + '/migrations/*.js'],
  synchronize: false,          // schema changes go through migrations
  logger: countingLogger,
});
```

bash

```
$ npx tsc -p . && ls dist dist/migrations
dist:
canonical.js
data-source.js
eager.js
entities.js
migrations
nplus1.js
paginate.js
seed.js
sync-rename.js
transactions.js
undefined-where.js

dist/migrations:
1791815302588-CreateBlogSchema.js
```

**Example 11 — TypeORM migrations: generate from the entities, review, run.** Against an empty database, `migration:generate` writes the full DDL:

bash

```
$ npx typeorm migration:generate src/migrations/CreateBlogSchema -d dist/data-source.js
creating a new table: public.users
creating a new table: public.posts
creating a new table: public.comments
creating a new table: public.tags
creating a new table: public.post_tags
creating a foreign keys: FK_312c63be865c81b922e39c2475e on table "posts"
creating a foreign keys: FK_259bf9825d9d198608d1b46b0b5, FK_e6d38899c31997c45d128a8973b on table "comments"
creating a foreign keys: FK_5df4e8dc2cb3e668b962362265d, FK_192ab488d1c284ac9abe2e30356 on table "post_tags"
Migration …/torm/src/migrations/1791815302588-CreateBlogSchema.ts has been generated successfully.
```

The generated file, unedited:

typescript

```
import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBlogSchema1791815302588 implements MigrationInterface {
    name = 'CreateBlogSchema1791815302588'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "email" text NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "posts" ("id" SERIAL NOT NULL, "author_id" integer NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "published" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "comments" ("id" SERIAL NOT NULL, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "post_id" integer NOT NULL, "author_id" integer NOT NULL, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "tags" ("id" SERIAL NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_d90243459a697eadb8ad56e9092" UNIQUE ("name"), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "post_tags" ("post_id" integer NOT NULL, "tag_id" integer NOT NULL, CONSTRAINT "PK_deee54a40024b7afc16d25684f8" PRIMARY KEY ("post_id", "tag_id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5df4e8dc2cb3e668b962362265" ON "post_tags"  ("post_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_192ab488d1c284ac9abe2e3035" ON "post_tags"  ("tag_id") `);
        await queryRunner.query(`ALTER TABLE "posts" ADD CONSTRAINT "FK_312c63be865c81b922e39c2475e" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_259bf9825d9d198608d1b46b0b5" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "comments" ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_tags" ADD CONSTRAINT "FK_5df4e8dc2cb3e668b962362265d" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "post_tags" ADD CONSTRAINT "FK_192ab488d1c284ac9abe2e30356" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "post_tags" DROP CONSTRAINT "FK_192ab488d1c284ac9abe2e30356"`);
        await queryRunner.query(`ALTER TABLE "post_tags" DROP CONSTRAINT "FK_5df4e8dc2cb3e668b962362265d"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_e6d38899c31997c45d128a8973b"`);
        await queryRunner.query(`ALTER TABLE "comments" DROP CONSTRAINT "FK_259bf9825d9d198608d1b46b0b5"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_312c63be865c81b922e39c2475e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_192ab488d1c284ac9abe2e3035"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5df4e8dc2cb3e668b962362265"`);
        await queryRunner.query(`DROP TABLE "post_tags"`);
        await queryRunner.query(`DROP TABLE "tags"`);
        await queryRunner.query(`DROP TABLE "comments"`);
        await queryRunner.query(`DROP TABLE "posts"`);
        await queryRunner.query(`DROP TABLE "users"`);
    }

}
```

It matches the shared schema, plus two things TypeORM adds by default: an index on each `post_tags` column, and `ON UPDATE CASCADE` on the junction foreign keys. Constraint names are hashes such as `PK_a3ffb1c0c8416b9fc6f907b7433`, so they are stable for the same table and columns. After `npx tsc -p .`, run it on a fresh database:

bash

```
$ npx typeorm migration:show -d dist/data-source.js
[ ] CreateBlogSchema1791815302588
$ LOG_SQL=1 npx typeorm migration:run -d dist/data-source.js
query: SELECT version()
query: SELECT * FROM current_schema()
query: SELECT * FROM "information_schema"."tables" WHERE "table_schema" = $1 AND "table_name" = $2
query: SELECT * FROM "migrations" "migrations" ORDER BY "id" DESC
0 migrations are already loaded in the database.
1 migrations were found in the source code.
1 migrations are new migrations must be executed.
query: START TRANSACTION
query: CREATE TABLE "users" ("id" SERIAL NOT NULL, "email" text NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))
query: CREATE TABLE "posts" ("id" SERIAL NOT NULL, "author_id" integer NOT NULL, "title" text NOT NULL, "body" text NOT NULL, "published" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))
query: CREATE TABLE "comments" ("id" SERIAL NOT NULL, "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "post_id" integer NOT NULL, "author_id" integer NOT NULL, CONSTRAINT "PK_8bf68bc960f2b69e818bdb90dcb" PRIMARY KEY ("id"))
query: CREATE TABLE "tags" ("id" SERIAL NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_d90243459a697eadb8ad56e9092" UNIQUE ("name"), CONSTRAINT "PK_e7dc17249a1148a1970748eda99" PRIMARY KEY ("id"))
query: CREATE TABLE "post_tags" ("post_id" integer NOT NULL, "tag_id" integer NOT NULL, CONSTRAINT "PK_deee54a40024b7afc16d25684f8" PRIMARY KEY ("post_id", "tag_id"))
query: CREATE INDEX "IDX_5df4e8dc2cb3e668b962362265" ON "post_tags"  ("post_id")
query: CREATE INDEX "IDX_192ab488d1c284ac9abe2e3035" ON "post_tags"  ("tag_id")
query: ALTER TABLE "posts" ADD CONSTRAINT "FK_312c63be865c81b922e39c2475e" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
query: ALTER TABLE "comments" ADD CONSTRAINT "FK_259bf9825d9d198608d1b46b0b5" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
query: ALTER TABLE "comments" ADD CONSTRAINT "FK_e6d38899c31997c45d128a8973b" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
query: ALTER TABLE "post_tags" ADD CONSTRAINT "FK_5df4e8dc2cb3e668b962362265d" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE
query: ALTER TABLE "post_tags" ADD CONSTRAINT "FK_192ab488d1c284ac9abe2e30356" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE
query: INSERT INTO "migrations"("timestamp", "name") VALUES ($1, $2)
Migration CreateBlogSchema1791815302588 has been executed successfully.
query: COMMIT
$ npx typeorm migration:show -d dist/data-source.js
[X] 1 CreateBlogSchema1791815302588
$ npx typeorm migration:generate src/migrations/Drift -d dist/data-source.js --check; echo "exit $?"
No changes in database schema were found
exit 0
```

`--check` is the CI guard. It exits 0 when the entities and the database agree, and 1 when a migration is missing.

**Example 12 — seeding through the ORM.** Saving a `Post` with `tags` set also writes its `post_tags` rows.

typescript

```
// src/seed.ts — the shared seed, written through the ORM
import { AppDataSource } from './data-source.js';
import { User, Post, Comment, Tag } from './entities.js';

async function main() {
  await AppDataSource.initialize();
  await AppDataSource.transaction(async (m) => {
    const [ada, lin, grace] = await m.save(User, [
      { email: 'ada@example.com', name: 'Ada' },
      { email: 'lin@example.com', name: 'Lin' },
      { email: 'grace@example.com', name: 'Grace' },
    ]);
    const [sql, intro, perf, node] = await m.save(Tag,
      ['sql', 'intro', 'perf', 'node'].map((name) => ({ name })));
    // saving a post with `tags` set also writes its post_tags rows
    const [p1, , , p4] = await m.save(Post, [
      { author: ada, title: 'Hello SQL', body: 'First post', published: true, tags: [sql, intro] },
      { author: ada, title: 'Indexes', body: 'B-trees', published: true, tags: [sql, perf] },
      { author: lin, title: 'Draft', body: 'WIP', published: false, tags: [] },
      { author: grace, title: 'Streams', body: 'Backpressure', published: true, tags: [node] },
    ]);
    await m.save(Comment, [
      { post: p1, author: lin, body: 'Nice' },
      { post: p1, author: grace, body: '+1' },
      { post: p4, author: ada, body: 'Thanks' },
    ]);
  });
  const counts = await AppDataSource.query(
    `SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM posts) AS posts,
            (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM post_tags) AS post_tags`);
  console.log(counts[0]);
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/seed.js`:
//   { users: '3', posts: '4', comments: '3', post_tags: '5' }
```

**Example 13 — the canonical query in TypeORM, with the real logged SQL.** `commentCount` comes from the `@VirtualColumn` sub-query on the entity (added in v1.0 as the replacement for `loadRelationCountAndMap`).

typescript

```
// src/canonical.ts — published posts with author name, comment count and tag names, newest first
import { AppDataSource, queries } from './data-source.js';
import { Post } from './entities.js';

async function main() {
  await AppDataSource.initialize();
  queries.length = 0;
  const posts = await AppDataSource.getRepository(Post)
    .createQueryBuilder('post')
    .innerJoin('post.author', 'author').addSelect('author.name')
    .leftJoin('post.tags', 'tag').addSelect('tag.name')
    .where('post.published = :published', { published: true })
    .orderBy('post.createdAt', 'DESC').addOrderBy('post.id', 'DESC').addOrderBy('tag.name', 'ASC')
    .getMany();   // commentCount comes from the @VirtualColumn sub-query

  for (const p of posts) {
    console.log(p.id, p.title, '|', p.author.name, '| comments:', p.commentCount,
      '| tags:', p.tags.map((t) => t.name).join(',') || '-');
  }
  console.log('queries:', queries.length);
  console.log(queries[0]);
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/canonical.js`:
//   4 Streams | Grace | comments: 1 | tags: node
//   2 Indexes | Ada | comments: 0 | tags: perf,sql
//   1 Hello SQL | Ada | comments: 2 | tags: intro,sql
//   queries: 1
//   SELECT "post"."id" AS "post_id", "post"."author_id" AS "post_author_id", "post"."title" AS "post_title", "post"."body" AS "post_body", "post"."published" AS "post_published", "post"."created_at" AS "post_created_at", (SELECT count(*) FROM comments c WHERE c.post_id = "post".id) AS "post_commentCount", "author"."name" AS "author_name", "author"."id" AS "author_id", "tag"."name" AS "tag_name", "tag"."id" AS "tag_id" FROM "posts" "post" INNER JOIN "users" "author" ON "author"."id"="post"."author_id"  LEFT JOIN "post_tags" "post_tag" ON "post_tag"."post_id"="post"."id" LEFT JOIN "tags" "tag" ON "tag"."id"="post_tag"."tag_id" WHERE "post"."published" = $1 ORDER BY "post"."created_at" DESC, "post"."id" DESC, "tag_name" ASC -- [true]
```

**Example 14 — N+1 in TypeORM, counted, then fixed two ways.**

typescript

```
// src/nplus1.ts — per-post lookups in a loop, then the relations fix
import { AppDataSource, queries } from './data-source.js';
import { Post, User, Comment } from './entities.js';

async function main() {
  await AppDataSource.initialize();
  const m = AppDataSource.manager;
  queries.length = 0;

  // N+1: one query for the posts, then two per post
  const posts = await m.find(Post, { order: { id: 'ASC' } });
  for (const post of posts) {
    const author = await m.findOneByOrFail(User, { id: post.authorId });
    const comments = await m.findBy(Comment, { post: { id: post.id } });
    console.log(post.title, '-', author.name, '-', comments.length, 'comments');
  }
  console.log('loop:', queries.length, 'queries');
  queries.slice(1, 3).forEach((q) => console.log('  ' + q));

  // Fix A: relations → one query with LEFT/INNER JOINs
  queries.length = 0;
  await m.find(Post, { relations: { author: true, comments: true }, order: { id: 'ASC' } });
  console.log('relations (join):', queries.length, 'query');

  // Fix B: relationLoadStrategy 'query' → one query per relation, not per row
  queries.length = 0;
  await m.find(Post, { relations: { author: true, comments: true }, relationLoadStrategy: 'query',
    order: { id: 'ASC' } });
  console.log("relationLoadStrategy 'query':", queries.length, 'queries');
  queries.forEach((q) => console.log('  ' + q));
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/nplus1.js`:
//   Hello SQL - Ada - 2 comments
//   Indexes - Ada - 0 comments
//   Draft - Lin - 0 comments
//   Streams - Grace - 1 comments
//   loop: 9 queries
//     SELECT "User"."id" AS "User_id", "User"."email" AS "User_email", "User"."name" AS "User_name" FROM "users" "User" WHERE (("User"."id" = $1)) LIMIT 1 -- [1]
//     SELECT "Comment"."id" AS "Comment_id", "Comment"."body" AS "Comment_body", "Comment"."created_at" AS "Comment_created_at", "Comment"."post_id" AS "Comment_post_id", "Comment"."author_id" AS "Comment_author_id" FROM "comments" "Comment" INNER JOIN "posts" "Comment__Comment_post" ON "Comment__Comment_post"."id"="Comment"."post_id" WHERE (((("Comment__Comment_post"."id" = $1)))) -- [1]
//   relations (join): 1 query
//   relationLoadStrategy 'query': 4 queries
//     SELECT "Post"."id" AS "Post_id", "Post"."author_id" AS "Post_author_id", "Post"."title" AS "Post_title", "Post"."body" AS "Post_body", "Post"."published" AS "Post_published", "Post"."created_at" AS "Post_created_at", (SELECT count(*) FROM comments c WHERE c.post_id = "Post".id) AS "Post_commentCount" FROM "posts" "Post" ORDER BY "Post"."id" ASC
//     SELECT "User"."id" AS "User_id", "User"."email" AS "User_email", "User"."name" AS "User_name" FROM "users" "User" INNER JOIN "posts" "Post" ON "Post"."author_id" = "User"."id" WHERE "Post"."id" IN ($1, $2, $3, $4) -- [1,2,3,4]
//     SELECT "Comment"."id" AS "Comment_id", "Comment"."body" AS "Comment_body", "Comment"."created_at" AS "Comment_created_at", "Comment"."post_id" AS "Comment_post_id", "Comment"."author_id" AS "Comment_author_id" FROM "comments" "Comment" WHERE "Comment"."post_id" IN ($1, $2, $3, $4) -- [1,2,3,4]
//     SELECT "Comment"."id" AS "Comment_comments_id", "Comment"."post_id" AS "Post_id" FROM "comments" "Comment" WHERE "Comment"."post_id" IN (1, 2, 3, 4)
```

The loop made 9 queries. `relations` brought that down to 1 JOINed query. `relationLoadStrategy: 'query'` used 4: the posts, the authors by `IN`, the comments by `IN`, and a fourth query TypeORM uses to map comment ids back to posts. Notice the `@VirtualColumn` sub-query in the posts `SELECT`. A virtual column is computed on **every** query of that entity, whether or not you read it.

**Example 15 — TypeORM transactions: managed with rollback, unmanaged with a QueryRunner.**

typescript

```
// src/transactions.ts — managed (callback) and unmanaged (QueryRunner) transactions
import { AppDataSource, queries } from './data-source.js';
import { Post, Tag } from './entities.js';
import { In } from 'typeorm';

async function main() {
  await AppDataSource.initialize();
  const posts = AppDataSource.getRepository(Post);
  console.log('posts before:', await posts.count());

  // 1. Managed: commit when the callback resolves, ROLLBACK when it throws.
  //    Use the `manager` argument; the global repository would run outside the transaction.
  queries.length = 0;
  try {
    await AppDataSource.transaction(async (manager) => {
      const tags = await manager.findBy(Tag, { name: In(['sql', 'node']) });
      const post = await manager.save(Post,
        { authorId: 2, title: 'ORMs', body: 'Tx demo', published: true, tags });
      console.log('inside tx, post id', post.id, 'posts:', await manager.count(Post));
      throw new Error('payment failed');
    });
  } catch (err) {
    console.log('managed tx rolled back:', (err as Error).message);
  }
  console.log('posts after managed rollback:', await posts.count());
  queries.filter((q) => /^(START|COMMIT|ROLLBACK|INSERT)/.test(q))
    .forEach((q) => console.log('  ' + q));

  // 2. Unmanaged: one QueryRunner = one pooled connection; you start, end and release it.
  const qr = AppDataSource.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await qr.manager.update(Post, { id: 1 }, { published: false });
    console.log('inside tx  post 1 published =', (await qr.manager.findOneByOrFail(Post, { id: 1 })).published);
    console.log('outside tx post 1 published =', (await posts.findOneByOrFail({ id: 1 })).published);
    await qr.rollbackTransaction();                  // decided not to keep it
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();                              // always return the connection
  }
  console.log('after rollback post 1 published =', (await posts.findOneByOrFail({ id: 1 })).published);
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/transactions.js`:
//   posts before: 4
//   inside tx, post id 5 posts: 5
//   managed tx rolled back: payment failed
//   posts after managed rollback: 4
//     START TRANSACTION
//     INSERT INTO "posts"("author_id", "title", "body", "published", "created_at") VALUES ($1, $2, $3, $4, DEFAULT) RETURNING "id", "published", "created_at" -- [2,"ORMs","Tx demo",1]
//     INSERT INTO "post_tags"("post_id", "tag_id") VALUES ($1, $2), ($3, $4) -- [5,1,5,4]
//     ROLLBACK
//   inside tx  post 1 published = false
//   outside tx post 1 published = true
//   after rollback post 1 published = true
```

The `post_tags` rows were written with the post, and both were rolled back. In the QueryRunner block, the read through `qr.manager` saw the uncommitted `false`. The read through the global repository went to another connection and saw `true`. `release()` in `finally` returns the connection to the pool, as in [lesson 74](74-connection-pooling.md).

**Example 16 — pitfall: `eager: true`.** These are separate minimal entities on the same tables, so the main entities stay lazy:

typescript

```
// src/eager.ts — eager: true loads the relation on every find(), but QueryBuilder ignores it
import 'reflect-metadata';
import { DataSource, Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';

@Entity('users')
class Author {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'text' }) name: string;
}

@Entity('posts')
class EagerPost {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'text' }) title: string;
  @ManyToOne(() => Author, { eager: true, nullable: false })
  @JoinColumn({ name: 'author_id' })
  author: Author;
}

const sql: string[] = [];
const ds = new DataSource({
  type: 'postgres', url: process.env.DATABASE_URL, entities: [Author, EagerPost],
  logger: { logQuery: (q) => sql.push(q), logQueryError() {}, logQuerySlow() {},
    logSchemaBuild() {}, logMigration() {}, log() {} },
});

async function main() {
  await ds.initialize();
  const repo = ds.getRepository(EagerPost);

  // only ids and titles wanted, yet the eager JOIN is added
  const titles = await repo.find({ select: { id: true, title: true }, order: { id: 'ASC' } });
  console.log('find():', titles[0], '\n  ', sql.at(-1));

  const viaQb = await repo.createQueryBuilder('p').orderBy('p.id', 'ASC').getMany();
  console.log('QueryBuilder:', viaQb[0], '\n  ', sql.at(-1));
  await ds.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/eager.js`:
//   find(): EagerPost {
//     id: 1,
//     title: 'Hello SQL',
//     author: Author { id: 1, name: 'Ada' }
//   }
//      SELECT "EagerPost"."id" AS "EagerPost_id", "EagerPost"."title" AS "EagerPost_title", "EagerPost__author"."id" AS "EagerPost__author_id", "EagerPost__author"."name" AS "EagerPost__author_name" FROM "posts" "EagerPost" INNER JOIN "users" "EagerPost__author" ON "EagerPost__author"."id"="EagerPost"."author_id" ORDER BY "EagerPost_id" ASC
//   QueryBuilder: EagerPost { id: 1, title: 'Hello SQL', author: undefined }
//      SELECT "p"."id" AS "p_id", "p"."title" AS "p_title", "p"."author_id" AS "p_author_id" FROM "posts" "p" ORDER BY "p"."id" ASC
```

`find()` added the JOIN even though only `id` and `title` were selected. QueryBuilder ignored `eager` entirely and returned `author: undefined`, which the TypeORM docs state: "If you use QueryBuilder eager relations are disabled". The join is `INNER` because the relation is `nullable: false` (changed in v1.0; the same file compiled against typeorm@0.3.31 produced `LEFT JOIN`).

**Example 17 — pitfall: `find` with relations and pagination, and `limit()` vs `take()`.**

typescript

```
// src/paginate.ts — find() with relations + take/skip, and limit() vs take() in QueryBuilder
import { AppDataSource, queries } from './data-source.js';
import { Post } from './entities.js';

const show = (label: string, posts: Post[]) =>
  console.log(label, posts.map((p) => `${p.id}:${p.comments.length}c`).join(' '));

async function main() {
  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Post);

  // find + relations + take: TypeORM first selects DISTINCT ids, then loads those posts
  queries.length = 0;
  show('find take:2      ->', await repo.find({ relations: { comments: true }, order: { id: 'ASC' }, take: 2 }));
  console.log(queries.length, 'queries'); queries.forEach((q) => console.log('  ' + q));

  // QueryBuilder .limit() puts LIMIT on the joined rows
  queries.length = 0;
  show('qb limit(2)      ->', await repo.createQueryBuilder('post')
    .leftJoinAndSelect('post.comments', 'comment').orderBy('post.id', 'ASC').limit(2).getMany());
  console.log('  ' + queries[0].replace(/^SELECT .* FROM/, 'SELECT … FROM'));

  // QueryBuilder .take() paginates entities (same two-step query as find)
  queries.length = 0;
  show('qb take(2)       ->', await repo.createQueryBuilder('post')
    .leftJoinAndSelect('post.comments', 'comment').orderBy('post.id', 'ASC').take(2).getMany());
  console.log(queries.length, 'queries');
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/paginate.js`:
//   find take:2      -> 1:2c 2:0c
//   2 queries
//     SELECT DISTINCT "distinctAlias"."Post_id" AS "ids_Post_id", "distinctAlias"."Post_id" FROM (SELECT "Post"."id" AS "Post_id", "Post"."author_id" AS "Post_author_id", "Post"."title" AS "Post_title", "Post"."body" AS "Post_body", "Post"."published" AS "Post_published", "Post"."created_at" AS "Post_created_at", (SELECT count(*) FROM comments c WHERE c.post_id = "Post".id) AS "Post_commentCount", "Post__Post_comments"."id" AS "Post__Post_comments_id", "Post__Post_comments"."body" AS "Post__Post_comments_body", "Post__Post_comments"."created_at" AS "Post__Post_comments_created_at", "Post__Post_comments"."post_id" AS "Post__Post_comments_post_id", "Post__Post_comments"."author_id" AS "Post__Post_comments_author_id" FROM "posts" "Post" LEFT JOIN "comments" "Post__Post_comments" ON "Post__Post_comments"."post_id"="Post"."id") "distinctAlias" ORDER BY "distinctAlias"."Post_id" ASC, "Post_id" ASC LIMIT 2
//     SELECT "Post"."id" AS "Post_id", "Post"."author_id" AS "Post_author_id", "Post"."title" AS "Post_title", "Post"."body" AS "Post_body", "Post"."published" AS "Post_published", "Post"."created_at" AS "Post_created_at", (SELECT count(*) FROM comments c WHERE c.post_id = "Post".id) AS "Post_commentCount", "Post__Post_comments"."id" AS "Post__Post_comments_id", "Post__Post_comments"."body" AS "Post__Post_comments_body", "Post__Post_comments"."created_at" AS "Post__Post_comments_created_at", "Post__Post_comments"."post_id" AS "Post__Post_comments_post_id", "Post__Post_comments"."author_id" AS "Post__Post_comments_author_id" FROM "posts" "Post" LEFT JOIN "comments" "Post__Post_comments" ON "Post__Post_comments"."post_id"="Post"."id" WHERE "Post"."id" IN (1, 2) ORDER BY "Post"."id" ASC
//   qb limit(2)      -> 1:2c
//     SELECT … FROM "posts" "post" LEFT JOIN "comments" "comment" ON "comment"."post_id"="post"."id" ORDER BY "post"."id" ASC LIMIT 2
//   qb take(2)       -> 1:2c 2:0c
//   2 queries
```

`find({ relations, take })` and QueryBuilder `.take()` both run two queries: a `SELECT DISTINCT` of the page's ids, then the data `WHERE "Post"."id" IN (1, 2)`. `.limit(2)` sends a plain `LIMIT 2` on the joined rows and returned one post. With joins, use `take`/`skip`. Use `limit`/`offset` only for queries without to-many joins.

**Example 18 — edge case: `synchronize: true` and a renamed property (scratch database).** Three entity versions of `posts`, each run against a freshly migrated and seeded copy of the database:

typescript

```
// src/sync-rename.ts — synchronize: true after renaming a property. Scratch database ONLY.
// usage: node dist/sync-rename.js rename | rename+column | rename-default+column
import 'reflect-metadata';
import { DataSource, Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn } from 'typeorm';

@Entity('users')
class User {
  @PrimaryGeneratedColumn() id: number;
  @Column({ type: 'text', unique: true }) email: string;
  @Column({ type: 'text' }) name: string;
}

// A: only `title` renamed to `headline`
@Entity('posts')
class PostA {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' }) author: User;
  @Column({ type: 'text' }) headline: string;                  // was title
  @Column({ type: 'text' }) body: string;
  @Column({ default: false }) published: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

// B: the same rename, shipped together with a new column
@Entity('posts')
class PostB {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' }) author: User;
  @Column({ type: 'text' }) headline: string;                  // was title
  @Column({ type: 'text' }) body: string;
  @Column({ default: false }) published: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'text', nullable: true }) summary: string | null;  // new
}

// C: a column WITH a default renamed, plus a new column
@Entity('posts')
class PostC {
  @PrimaryGeneratedColumn() id: number;
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' }) author: User;
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text' }) body: string;
  @Column({ name: 'is_published', default: false }) isPublished: boolean; // was published
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @Column({ type: 'text', nullable: true }) summary: string | null;  // new
}

const variants = { 'rename': PostA, 'rename+column': PostB, 'rename-default+column': PostC };

async function main() {
  const variant = process.argv[2] as keyof typeof variants;
  const ddl: string[] = [];
  const ds = new DataSource({
    type: 'postgres', url: process.env.DATABASE_URL, entities: [User, variants[variant]],
    synchronize: true,                               // diff entities → ALTER the live tables
    logger: { logQuery: (q) => { if (/^(ALTER|START|COMMIT|ROLLBACK)/.test(q)) ddl.push(q); },
      logQueryError() {}, logQuerySlow() {}, logSchemaBuild() {}, logMigration() {}, log() {} },
  });
  console.log(variant, 'before:', JSON.stringify(await rows()));
  try {
    await ds.initialize();                           // synchronize runs inside initialize()
  } catch (err) {
    console.log('initialize() threw:', (err as Error).message);
  }
  ddl.forEach((q) => console.log('  ' + q));
  console.log(variant, 'after: ', JSON.stringify(await rows()));
  if (ds.isInitialized) await ds.destroy();
}

// read the table through a plain DataSource (no entities, no sync)
async function rows() {
  const raw = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL });
  await raw.initialize();
  const r = await raw.query('SELECT * FROM posts ORDER BY id');
  await raw.destroy();
  return r.map(({ created_at, body, author_id, ...rest }: any) => rest);  // trim for display
}
main();
```

The driver script recreates the scratch database before each variant:

bash

```
# sync-demo.sh — run in the TypeORM project: per variant, a fresh scratch DB, migrate, seed, synchronize
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6500/tormsync
for v in rename rename+column rename-default+column; do
  node recreate-db.cjs > /dev/null
  npx typeorm migration:run -d dist/data-source.js > /dev/null
  node dist/seed.js > /dev/null
  node dist/sync-rename.js "$v"
done
```

bash

```
$ bash sync-demo.sh
rename before: [{"id":1,"title":"Hello SQL","published":true},{"id":2,"title":"Indexes","published":true},{"id":3,"title":"Draft","published":false},{"id":4,"title":"Streams","published":true}]
  START TRANSACTION
  ALTER TABLE "posts" RENAME COLUMN "title" TO "headline"
  COMMIT
rename after:  [{"id":1,"headline":"Hello SQL","published":true},{"id":2,"headline":"Indexes","published":true},{"id":3,"headline":"Draft","published":false},{"id":4,"headline":"Streams","published":true}]
rename+column before: [{"id":1,"title":"Hello SQL","published":true},{"id":2,"title":"Indexes","published":true},{"id":3,"title":"Draft","published":false},{"id":4,"title":"Streams","published":true}]
initialize() threw: column "headline" of relation "posts" contains null values
  START TRANSACTION
  ALTER TABLE "posts" DROP COLUMN "title"
  ALTER TABLE "posts" ADD "headline" text NOT NULL
  ROLLBACK
rename+column after:  [{"id":1,"title":"Hello SQL","published":true},{"id":2,"title":"Indexes","published":true},{"id":3,"title":"Draft","published":false},{"id":4,"title":"Streams","published":true}]
rename-default+column before: [{"id":1,"title":"Hello SQL","published":true},{"id":2,"title":"Indexes","published":true},{"id":3,"title":"Draft","published":false},{"id":4,"title":"Streams","published":true}]
  START TRANSACTION
  ALTER TABLE "posts" DROP COLUMN "published"
  ALTER TABLE "posts" ADD "is_published" boolean NOT NULL DEFAULT false
  ALTER TABLE "posts" ADD "summary" text
  COMMIT
rename-default+column after:  [{"id":1,"title":"Hello SQL","is_published":false,"summary":null},{"id":2,"title":"Indexes","is_published":false,"summary":null},{"id":3,"title":"Draft","is_published":false,"summary":null},{"id":4,"title":"Streams","is_published":false,"summary":null}]
```

- **Variant A**, a lone rename, became `RENAME COLUMN` and kept the data.
- **Variant B** shipped the same rename with one new column. The column counts no longer matched, so the heuristic did not apply, and TypeORM tried `DROP COLUMN` + `ADD … NOT NULL`. PostgreSQL rejected the `ADD` on a table with rows, the transaction rolled back, and `initialize()` threw. The app would not start.
- **Variant C** renamed a column that has a `DEFAULT`. The `ADD` succeeded, the transaction committed, and every post's published flag was lost. The Draft/published distinction is gone.

The TypeORM docs say of `synchronize`: "don't use this in production - otherwise you can lose production data."

**Example 19 — edge case: an `undefined` value in a `where` (changed in v1.0).**

typescript

```
// src/undefined-where.ts — an undefined value in a find() where clause
import { IsNull } from 'typeorm';
import { AppDataSource, queries } from './data-source.js';
import { Post } from './entities.js';

async function main() {
  await AppDataSource.initialize();
  const posts = AppDataSource.getRepository(Post);
  const authorIdFromRequest: number | undefined = undefined;   // e.g. a missing query param

  try {
    const rows = await posts.findBy({ authorId: authorIdFromRequest });
    console.log('rows:', rows.length);
  } catch (err) {
    console.log((err as Error).constructor.name, '-', (err as Error).message);
  }

  // QueryBuilder .where() is not covered by the setting (changed in 1.0)
  queries.length = 0;
  const viaQb = await posts.createQueryBuilder('p')
    .where('p.authorId = :id', { id: authorIdFromRequest }).getMany();
  console.log('QueryBuilder rows:', viaQb.length, '\n  ', queries[0].replace(/^SELECT .* FROM/, 'SELECT … FROM'));

  // matching NULL has to be explicit
  console.log('IsNull():', (await posts.findBy({ title: IsNull() })).length);
  await AppDataSource.destroy();
}
main();

// Real output (Node v24.19.0, TypeORM 1.1.2, TypeScript 7.0.2, PostgreSQL 18.4), `node dist/undefined-where.js`:
//   TypeORMError - Undefined value encountered in property 'Post.authorId' of a where condition. Set 'invalidWhereValuesBehavior.undefined' to 'ignore' in connection options to skip properties with undefined values.
//   QueryBuilder rows: 0
//      SELECT … FROM "posts" "p" WHERE "p"."author_id" = $1 -- [null]
//   IsNull(): 0
```

The v1.0 release notes: "passing null or undefined in where conditions now throws an error instead of silently ignoring the property". The same file compiled against typeorm@0.3.31 printed `rows: 4`: the condition was dropped and every post came back. That is a serious failure mode for `delete` and `update`. The setting does not cover QueryBuilder `.where()`, which sent `$1 = null` and matched nothing.

## Common mistakes & gotchas

- **Leaving Sequelize timestamps on.** `define()` adds `createdAt` and `updatedAt`. On these tables the first findAll fails with column "createdAt" does not exist. Set `timestamps: false`, and map real columns with `field`.
- **`paranoid: true` with `timestamps: false`.** No error, and no soft delete. `destroy()` issued a real DELETE.
- **sync or synchronize outside a scratch database.** They drop what the model does not declare. That included `author_id` and its foreign key in Sequelize, and a published flag on every row in TypeORM.
- **Trusting TypeORM's rename detection.** It renames only when exactly one column changed in that table. A rename shipped with any other column change becomes DROP plus ADD.
- **A query that skips the transaction.** Without `{ transaction: t }`, or through the global repository instead of the manager, it runs on another connection and is not rolled back.
- **N+1 through accessors.** `getAuthor` or `findOneBy` in a loop was 9 queries for 4 posts. Use include or relations, or the batched modes.
- **include plus limit in Sequelize.** `subQuery: false` limits joined rows. A `$nested.column$` filter with a limit fails with missing FROM-clause entry.
- **TypeORM `.limit()` with joins.** It limits rows, not entities. Use `.take()`.
- **`eager: true` as a convenience.** It adds the JOIN to every find, even ones that do not need the relation. QueryBuilder ignores eager.
- **`@VirtualColumn` is not free.** Its subquery runs in every SELECT of that entity, including the pagination query.
- **Copying TypeORM 0.3 code into 1.x.** String `relations`, `loadRelationCountAndMap`, global `getRepository`, and `findByIds` were removed in 1.0.
- **Expecting sequelize-cli `migration:generate` to read your models.** It writes an empty skeleton. Only TypeORM's generator diffs.

## Best practices

- Pick the stable line on purpose. `sequelize@6`, because v7 is still an alpha published as `@sequelize/core`. `typeorm@1` for new TypeORM code. Pin exact versions.
- On an existing schema, declare everything: `tableName`, `timestamps: false`, field mappings, and explicit foreign key and join table names. Then compare the logged SQL with the real tables once.
- Change schemas only with migrations. Review every file TypeORM generates. For a rename, edit it to RENAME COLUMN. Run `migration:generate --check` in CI. It exits 1 when a migration is missing.
- Keep sync and synchronize for tests and throwaway databases. Never point them at shared data.
- Log queries in development and in tests, and assert query counts on list endpoints.
- Use the managed transaction form by default. If you use the unmanaged form, roll back in catch and `release()` in finally.
- Pagination with to-many relations: Sequelize `separate: true`, or the default subquery but no `$nested$` filters. TypeORM `take` and `skip`, not `limit` and `offset`.
- When a query is mostly aggregation, use TypeORM's query builder or Sequelize `literal`, or a query builder such as Knex.

## ⭐ Interview lens

> **Q: “What does `sync({ alter: true })` or `synchronize: true` actually do, and why not run it in production?”**
> A: `sync({ alter: true })` in Sequelize and `synchronize: true` in TypeORM run at startup, read the live tables, diff them against the model, and issue ALTER TABLE until the database matches the code. Columns the model does not declare are dropped. Sequelize has no rename detection, so renaming `title` to `headline` added an empty headline and dropped title, body, created_at, and author_id, including the foreign key. TypeORM renames only when exactly one column in that table changed type-for-type. Any other column change in the same deploy becomes DROP plus ADD. On a seeded table that reset every post's published flag when the new column had a default, because the ADD succeeded and the transaction committed. The docs of both libraries say not to use this in production. The limit of "TypeORM detects renames, so it is safe" is that lone-column rule. Ship the rename with any other column change and the heuristic does not apply. Use a reviewed migration, and write RENAME COLUMN yourself when that is what you mean.

> **Q: “Your list endpoint makes 1 + 2N queries. How do you find and fix it?”**
> A: 1 + 2N means one query for the list and then two more per row, usually a lazy getter or a find-by-id inside the loop. You find it by logging every statement, Sequelize's logging callback or a TypeORM logger, and counting per request. Here that was 9 queries for 4 posts. You fix it two ways. A JOIN, `include` or `relations`, is one query, and the library groups the flat rows back into objects. A batched load, Sequelize `separate: true` or TypeORM `relationLoadStrategy: 'query'`, is one IN query per relation, a fixed count that does not grow with the page. In this lesson those fixes landed at 1 or 2 queries in Sequelize and 1 or 4 in TypeORM. The TypeORM query strategy used a fourth statement to map comment ids back to posts. The limit is pagination. A JOIN plus a plain LIMIT counts joined rows, so you can get one post when you asked for two. Use the subquery or `take`, not a raw limit, when a to-many relation is in the query.

> **Q: “Why does Sequelize put a subquery in my query when I add `limit` to an `include`?”**
> A: A hasMany JOIN turns one parent into many rows, one per child. A LIMIT on that result counts rows, not posts, so LIMIT 2 can return a single post that has two comments. Sequelize's default puts the LIMIT in a subquery over the parent table and joins the children outside it, which returns the right number of posts. `subQuery: false` removes that wrapper and goes back to limiting joined rows. For example, the default returned 2 posts, and `subQuery: false` returned 1. The limit of the subquery is a filter written as `$comments.body$`. That condition is placed inside the subquery, where the comments table is not joined, and PostgreSQL raises missing FROM-clause entry. Put the where on the include with `required: true`, drop the limit, or use `separate: true`, which loads the children in their own query and avoids the subquery.

> **Q: “How do you make sure every query runs inside the transaction?”**
> A: A transaction is one pooled connection. Only the statements you route onto that connection are inside it. In Sequelize that means `{ transaction: t }` on every call, including association helpers such as `addTags`. In TypeORM it means the `manager` from the callback, or `queryRunner.manager` if you opened the transaction yourself. The managed callback commits when it resolves and rolls back when it throws. The unmanaged form is commit and rollback you call yourself, plus `release()` in finally so the connection returns to the pool. For example, a read that forgot the transaction option ran on another connection and saw the old committed value, while the same read through the manager saw the uncommitted change. The limit is sequences. A rolled-back INSERT in PostgreSQL still consumes the id, so the next id has a gap. Rollback undoes rows. It does not rewind a sequence.

## Cheat-card

- **Sequelize on an existing schema:** `tableName`, `timestamps: false`, `field: 'created_at'`, explicit `foreignKey`, and `belongsToMany` through `post_tags`.
- **TypeORM mapping:** `@Entity`, `@ManyToOne` plus `@JoinColumn`, `@ManyToMany` plus `@JoinTable` with both column names. Compile with tsc. Decorators do not survive Node's type stripping.
- **Migrations:** sequelize-cli generate is an empty skeleton, then `db:migrate`, recorded in `SequelizeMeta`. TypeORM generate is a diff, then `migration:run` in one transaction, recorded in `migrations`. `--check` exits 1 when a migration is missing.
- **Transactions:** managed callback commits or rolls back. Unmanaged means you commit, roll back, and release. Route every query.
- **N+1:** accessors in a loop were 1 + 2N. Fix with a JOIN or with `separate: true` / `relationLoadStrategy: 'query'`.
- **Limits with to-many joins:** Sequelize subquery, and no `$nested$` filters. TypeORM `take` and `skip`, not `limit`.
- **Never on shared data:** `sync({ alter: true })`, `synchronize: true`. TypeORM renames only a lone single-column change.
- **TypeORM 1.0:** undefined in a find where throws. A non-nullable ManyToOne is an INNER JOIN. `@VirtualColumn` replaces `loadRelationCountAndMap`.

## Good to know

- `npm install sequelize` gave 6.37.8, published 2026-03-07, the stable v6 line. Sequelize v7 is the package `@sequelize/core`, and its npm latest was 7.0.0-alpha.48, published 2026-02-04, with docs labeled unreleased. TypeORM latest was 1.1.2, published 2026-10-08. The 1.x line started with 1.0.0 on 2026-05-19. The 0.3 line is tagged legacy at 0.3.31.
- TypeORM 1.0 removed string `relations: ['author']`, `loadRelationCountAndMap`, `@RelationCount`, global `createConnection` / `getRepository`, and `findByIds`.
- `bulkInsert` gave all four posts the same `created_at`, because they went in one statement and `now()` is fixed for the transaction. Newest-first queries here order by `created_at DESC, id DESC`.
- A rolled-back INSERT still advanced `posts_id_seq`. Sequences are not transactional.
- `eager: true` added a JOIN even when only id and title were selected. QueryBuilder ignored eager and returned `author: undefined`. The join was INNER because the relation is non-nullable, which changed in v1.0. The same file on typeorm 0.3.31 produced a LEFT JOIN.
- An undefined where in `find` throws on 1.0. The same file on 0.3.31 returned all 4 posts, because the condition was dropped. That is dangerous for update and delete. QueryBuilder `.where()` is not covered: it sent `$1 = null` and matched nothing.
- **Why does TypeORM need tsc when Node can run TypeScript?** The mapping is decorators plus `emitDecoratorMetadata`. Type stripping only removes types, and a decorator is a parser error there. tsc with `experimentalDecorators` and `emitDecoratorMetadata` compiles the decorators into function calls and emits `design:type`.

---

## Learn More

- [Model Basics (timestamps, sync) sequelize.org](https://sequelize.org/docs/v6/core-concepts/model-basics/)
- [Associations sequelize.org](https://sequelize.org/docs/v6/core-concepts/assocs/)
- [Eager Loading sequelize.org](https://sequelize.org/docs/v6/advanced-association-concepts/eager-loading/)
- [Migrations sequelize.org](https://sequelize.org/docs/v6/other-topics/migrations/)
- [Transactions sequelize.org](https://sequelize.org/docs/v6/other-topics/transactions/)
- [Paranoid sequelize.org](https://sequelize.org/docs/v6/core-concepts/paranoid/)
- [Sequelize v7 (alpha) sequelize.org](https://sequelize.org/docs/v7/)
- [Release Notes 1.0 typeorm.io](https://typeorm.io/docs/releases/1.0/release-notes/)
- [Upgrading from 0.3 to 1.0 typeorm.io](https://typeorm.io/docs/releases/1.0/upgrading-from-0.3/)
- [Many-to-many relations typeorm.io](https://typeorm.io/docs/relations/many-to-many-relations/)
- [Eager and Lazy Relations typeorm.io](https://typeorm.io/docs/relations/eager-and-lazy-relations/)
- [Generating migrations typeorm.io](https://typeorm.io/docs/migrations/generating/)
- [Transactions typeorm.io](https://typeorm.io/docs/transactions/)
- [Data Source Options typeorm.io](https://typeorm.io/docs/data-source/data-source-options/)
- [Modules: TypeScript (type stripping) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
