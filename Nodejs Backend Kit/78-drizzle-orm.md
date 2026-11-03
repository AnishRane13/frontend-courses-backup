---
title: "Drizzle ORM"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Drizzle ORM

*25 min read · Updated 12 Oct 2026 · Topic 102 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and drizzle-orm 0.45.4, drizzle-kit 0.31.11, pg (node-postgres) 8.23.1, dotenv 18.0.7, TypeScript 7.0.2 (plus drizzle-orm 1.0.0-rc.4 for the Relational Queries v2 comparison), PostgreSQL 18.4 run locally via the embedded-postgres npm package (no Docker)

---

## Say it in 30 seconds

Drizzle is a TypeScript database library: you declare tables as objects, and you write queries as method calls that follow SQL, with the result types inferred from those objects. It exists so you can see the SQL you send and still get type checks, without a separate schema language or a generate step. The trade-off is that joins, counts, and a loop that queries once per row are yours to get right.

## Why it matters

Drizzle stays close to SQL. `pgTable` declares a table. The builder methods follow SQL: select, from, leftJoin, where, groupBy. There is no code-generation step and no separate schema language. The runtime is `drizzle-orm` plus a driver such as pg. A second package, Drizzle Kit, diffs your TypeScript schema against snapshots or the live database and writes SQL migration files.

Put next to Prisma, the trade-off flips. You see and shape the SQL, and one call is usually one statement. You also own aggregates, join fan-out, and N+1. The docs site already describes the 1.0 release candidates and a new relational API, while npm's stable install is still the 0.45 line. This lesson uses the stable line and shows where 1.0 differs.

## The concept, simply

Drizzle has three layers.

1. **Schema in TypeScript.** `pgTable('posts', { ... })` describes columns, keys, and foreign keys. Queries import those objects, types are inferred from them, and Drizzle Kit reads them to write migrations.
2. **Two query APIs on one db object.** The query builder is SQL as method calls. You choose the joins, the grouping, and the fields, and you get flat rows. The relational API, `db.query.posts.findMany({ with: { author: true } })`, returns nested objects. You declare relations separately, and each call compiles to one SQL statement.
3. **Drizzle Kit.** `generate` writes a numbered SQL file from the schema diff. `migrate` applies pending files. `push` makes the database match the schema directly, with no files.

text

```
 src/schema.ts (pgTable + relations)
    │                          │
    │ drizzle-kit generate     │ import
    ▼                          ▼
 drizzle/0000_init.sql     db = drizzle({ client: pool, schema })
 drizzle/meta/*.json          │ db.select()…  ── query builder ──┐
    │ drizzle-kit migrate     │ db.query.x.findMany({ with }) ── relational API ─┤ one SQL string + params
    │  or migrate() at boot   │                                                   ▼
    ▼                         └────────────────────────────────▶ pg.Pool ──▶ PostgreSQL
 PostgreSQL (+ drizzle.__drizzle_migrations)      drizzle-kit push: schema.ts ──▶ PostgreSQL directly (no files, no journal)
```


## How it works

From schema to result:

1. You declare tables in `src/schema.ts`. A column builder such as `integer('author_id')` uses the string as the SQL name and the object key, `authorId`, as the TypeScript name. `.references()` is what creates the foreign key.
2. `drizzle-kit generate` loads the config and the schema, compares them with the last snapshot in `drizzle/meta`, and writes `drizzle/0000_<name>.sql`, a new snapshot, and a journal entry.
3. `drizzle-kit migrate`, or `migrate()` from `drizzle-orm` at startup, reads the journal. It applies every migration newer than the last row in `drizzle.__drizzle_migrations`, inside one transaction, and inserts a row with the file hash and the journal timestamp. The stored hash is not compared on later runs.
4. At runtime `drizzle({ client: pool, schema, logger })` wraps a pg Pool. A builder is lazy. Nothing is sent until you await it. Await renders one SQL string with `$1` parameters, passes it to the logger, and sends it through pg.
5. The builder maps column names back to your keys and runs each column's decoder. A timestamptz becomes a Date. `count()` becomes a number. The relational API gets one row per parent, with JSON for each relation, and parses that into nested objects.

**Relations, v1 and v2.** Stable 0.45 uses v1: `relations(table, ({ one, many }) => ...)` once per table, and you pass the results as `schema`. A many-to-many goes through the junction, so you read `post.postTags[].tag.name`. The 1.0 release candidates replace that with Relational Queries v2: `defineRelations` declares every relation in one place, `through()` hops over the junction so `post.tags[].name` works, and where and orderBy become plain objects. Relations exist only in TypeScript. They add no constraints. The foreign keys in SQL come from `.references()`.

**Builder versus relational, in SQL.** The canonical builder query is one SELECT with LEFT JOIN and GROUP BY, including the aggregates you write. The relational API writes one statement using lateral joins that build JSON. Neither API adds hidden extra queries. That is the difference from Prisma's default of one query per relation level.

**generate plus migrate, versus push.** `push` introspects the database, diffs it against the schema, and applies the change immediately. No SQL file, and nothing in `__drizzle_migrations`. The docs call push the best approach for prototyping, and say some teams use it as their main production flow. `generate` plus `migrate` leaves a reviewable file in git and a history row in every database, which is what a team needs. They mix badly: a database built with push has no history, so a later migrate tries to create the tables again.

**Transactions.** `db.transaction(async (tx) => { ... })` runs begin, your callback, then commit. A throw runs rollback. `tx.rollback()` throws `TransactionRollbackError` to abort on purpose. `tx.transaction` inside runs `savepoint sp1`, and a failure there rolls back to that savepoint while the outer transaction continues. Use `tx` inside the callback. `db` is another pool connection, outside the transaction.

**Types.** `typeof posts.$inferSelect` is the row a SELECT returns. `typeof posts.$inferInsert` is what an INSERT accepts. Columns with a default, or nullable columns, are optional. These types exist only for tsc. When Node runs a TypeScript file it strips types without checking them, so a type error still runs.

## Code examples

Every example ran against a real PostgreSQL 18.4 server. Unless stated otherwise, each starts from a freshly seeded database (`node src/seed.ts`, Example 5), so ids match the shared seed: Ada = 1, Lin = 2, Grace = 3; posts 1 "Hello SQL", 2 "Indexes", 3 "Draft", 4 "Streams". The `.ts` files run directly with `node file.ts` on Node 24 (type stripping). `npx tsc --noEmit -p .` passes on every file except the deliberate errors in Example 12.

**Example 1 — versions: stable 0.x vs the 1.0 release candidates.**

bash

```
$ npm view drizzle-orm dist-tags.latest
0.45.4
$ npm view drizzle-orm dist-tags.rc
1.0.0-rc.4
$ npm view drizzle-kit dist-tags.latest
0.31.11
$ npm view drizzle-orm time[0.45.4]
2026-10-08T10:50:41.953Z
$ npm view drizzle-orm time[1.0.0-rc.4]
2026-06-27T16:10:10.709Z
$ npm init -y && npm pkg set type=module
$ npm i -E drizzle-orm@0.45.4 pg@8.23.1 dotenv@18.0.7
$ npm i -D -E drizzle-kit@0.31.11 typescript@7.0.2 @types/pg@8.23.1 @types/node@24.19.2
…
npm warn allow-scripts   esbuild@0.28.2 (postinstall: node install.js)
…
$ npx drizzle-kit --version
drizzle-kit: v0.31.11
drizzle-orm: v0.45.4
```

Here `latest` is the stable line (0.45.4 was published after 1.0.0-rc.4, as a 0.x maintenance release). drizzle-kit loads your TypeScript config and schema through esbuild-based loaders; it depends on `esbuild` and `tsx`, and esbuild is a native binary. It worked even though npm 11.17 did not run esbuild's postinstall script, because the binary comes from the platform package `@esbuild/linux-x64`.

**Example 2 — the shared schema in TypeScript, with v1 relations.**

typescript

```
// src/schema.ts
import { relations } from 'drizzle-orm';
import { boolean, integer, pgTable, primaryKey, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
});

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  authorId: integer('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  published: boolean('published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable('comments', {
  id: serial('id').primaryKey(),
  postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  authorId: integer('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
});

export const postTags = pgTable(
  'post_tags',
  {
    postId: integer('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.tagId] })],
);

// Relations (v1 API, drizzle-orm 0.x): only used by db.query.*; they create no SQL constraints.
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: many(comments),
  postTags: many(postTags),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
  postTags: many(postTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
  post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
  tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));
```

**Example 3 — `drizzle-kit generate`, and the SQL it wrote.**

typescript

```
// drizzle.config.ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

bash

```
$ npx drizzle-kit generate --name init
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/anish.r/.cache/nodekit-repair-tools/pass5/Y/drizzle/drizzle.config.ts'
5 tables
comments 5 columns 0 indexes 2 fks
post_tags 2 columns 0 indexes 2 fks
posts 6 columns 0 indexes 1 fks
tags 2 columns 0 indexes 0 fks
users 3 columns 0 indexes 0 fks

[✓] Your SQL migration file ➜ drizzle/0000_init.sql 🚀
$ find drizzle -type f
drizzle/0000_init.sql
drizzle/meta/0000_snapshot.json
drizzle/meta/_journal.json
$ cat drizzle/meta/_journal.json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1791815391269,
      "tag": "0000_init",
      "breakpoints": true
    }
  ]
}
```

`drizzle/0000_init.sql`, pasted unchanged. The `--> statement-breakpoint` markers are where the migrator splits the file into separate statements:

sql

```
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_tags" (
	"post_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "post_tags_post_id_tag_id_pk" PRIMARY KEY("post_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"author_id" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
```

Compare this with Prisma's file for the same tables (lesson 77, Example 4). Drizzle keeps `now()` and puts `UNIQUE` constraints inline, while Prisma writes `CURRENT_TIMESTAMP` and separate unique indexes. Drizzle leaves `ON UPDATE no action`, while Prisma adds `ON UPDATE CASCADE`. The constraint names differ too (`users_email_unique` vs `users_email_key`). The tables are equivalent, but a schema-diff tool will see them as different.

**Example 4 — `drizzle-kit migrate`, `push`, and what each database remembers.** `migrate` ran twice against `app`. `push` ran against a second, empty database `app_push`. The spinner frames and terminal escape codes in drizzle-kit's output are removed below.

bash

```
$ npx drizzle-kit migrate
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/anish.r/.cache/nodekit-repair-tools/pass5/Y/drizzle/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
$ npx drizzle-kit migrate
…
[✓] migrations applied successfully!
$ npx drizzle-kit generate
…
No schema changes, nothing to migrate 😴
$ DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:6451/app_push npx drizzle-kit push
No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/anish.r/.cache/nodekit-repair-tools/pass5/Y/drizzle/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] Pulling schema from database...
[✓] Changes applied
```

The second `migrate` printed the same success line although it applied nothing. Look in the database to see what happened:

typescript

```
// src/migration-tables.ts
import { Client } from 'pg';

// What each database remembers about how its schema got there.
for (const dbName of ['app', 'app_push']) {
  const c = new Client({ connectionString: `postgresql://postgres:postgres@127.0.0.1:6451/${dbName}` });
  await c.connect();
  const tables = await c.query(
    `SELECT table_schema || '.' || table_name AS t FROM information_schema.tables
     WHERE table_schema IN ('public', 'drizzle') ORDER BY 1`,
  );
  console.log(dbName, tables.rows.map((r) => r.t));
  if (tables.rows.some((r) => r.t === 'drizzle.__drizzle_migrations')) {
    const m = await c.query('SELECT id, hash, created_at FROM drizzle.__drizzle_migrations');
    console.log('  journal rows:', m.rows);
  }
  await c.end();
}

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   app [
//     'drizzle.__drizzle_migrations',
//     'public.comments',
//     'public.post_tags',
//     'public.posts',
//     'public.tags',
//     'public.users'
//   ]
//     journal rows: [
//     {
//       id: 1,
//       hash: '4efd6bda2f95eb646fafb1399359308cc72617cb56900a57095b9c569583b2d9',
//       created_at: '1791815391269'
//     }
//   ]
//   app_push [
//     'public.comments',
//     'public.post_tags',
//     'public.posts',
//     'public.tags',
//     'public.users'
//   ]
```

`hash` is `sha256sum drizzle/0000_init.sql`, and `created_at` is the journal's `when`. The `app_push` database has the same tables and no history. In production you usually apply migrations from the app or a release step without shipping drizzle-kit. `migrate()` from `drizzle-orm` does that, shown here with `logger: true` on a third empty database:

typescript

```
// src/migrate.ts
// Apply drizzle/*.sql at deploy time without drizzle-kit (only drizzle-orm + pg are needed).
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle({ client: pool, logger: true });
await migrate(db, { migrationsFolder: './drizzle' });
console.log('migrations applied');
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4), DATABASE_URL=…/app_deploy:
//   Query: CREATE SCHEMA IF NOT EXISTS "drizzle"
//   Query:
//   			CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
//   				id SERIAL PRIMARY KEY,
//   				hash text NOT NULL,
//   				created_at bigint
//   			)
//
//   Query: select id, hash, created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1
//   Query: begin
//   Query: CREATE TABLE "comments" (
//   …
//   Query:
//   ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
//   Query: insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values($1, $2) -- params: ["4efd6bda2f95eb646fafb1399359308cc72617cb56900a57095b9c569583b2d9", 1791815391269]
//   Query: commit
//   migrations applied
//
// Second run on the same database:
//   …
//   Query: select id, hash, created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1
//   Query: begin
//   Query: commit
//   migrations applied
```

The migrator reads only the newest history row (`order by created_at desc limit 1`) and applies journal entries whose `when` is later than it. The stored hash is never compared. When a line was appended to the already-applied `0000_init.sql`, the next `migrate()` again printed just `begin`/`commit`, and `drizzle-kit check` printed `Everything's fine 🐶🔥`.

**Example 5 — the client, a counting logger, and the seed.** `logger: true` prints `Query: … -- params: […]`. A class that implements `Logger` lets you count statements instead.

typescript

```
// src/db.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// logger: true prints every statement as "Query: <sql> -- params: [...]".
export const db = drizzle({ client: pool, schema, logger: true });
```

typescript

```
// src/counting.ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Logger } from 'drizzle-orm/logger';
import { Pool } from 'pg';
import * as schema from './schema.ts';

// A custom Logger: count statements, optionally print them.
export const queries: string[] = [];
let print = false;
class CountingLogger implements Logger {
  logQuery(query: string, params: unknown[]) {
    queries.push(query);
    if (print) console.log(`SQL: ${query}  params: ${JSON.stringify(params)}`);
  }
}
export function startCounting(show = false) {
  queries.length = 0;
  print = show;
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle({ client: pool, schema, logger: new CountingLogger() });
```

typescript

```
// src/seed.ts
import { sql } from 'drizzle-orm';
import { db, pool } from './counting.ts';
import { comments, posts, postTags, tags, users } from './schema.ts';

await db.execute(sql`TRUNCATE post_tags, comments, tags, posts, users RESTART IDENTITY CASCADE`);

const tagRows = await db
  .insert(tags)
  .values([{ name: 'sql' }, { name: 'intro' }, { name: 'perf' }, { name: 'node' }])
  .returning();
const tagId = Object.fromEntries(tagRows.map((t) => [t.name, t.id]));

const [ada, lin, grace] = await db
  .insert(users)
  .values([
    { email: 'ada@example.com', name: 'Ada' },
    { email: 'lin@example.com', name: 'Lin' },
    { email: 'grace@example.com', name: 'Grace' },
  ])
  .returning();

// One insert per post, so created_at increases in this order.
const seedPosts = [
  { authorId: ada.id, title: 'Hello SQL', published: true, tags: ['sql', 'intro'] },
  { authorId: ada.id, title: 'Indexes', published: true, tags: ['sql', 'perf'] },
  { authorId: lin.id, title: 'Draft', published: false, tags: [] },
  { authorId: grace.id, title: 'Streams', published: true, tags: ['node'] },
];
const postIds: number[] = [];
for (const p of seedPosts) {
  const [row] = await db
    .insert(posts)
    .values({ authorId: p.authorId, title: p.title, body: `${p.title} body`, published: p.published })
    .returning({ id: posts.id });
  postIds.push(row.id);
  if (p.tags.length) {
    await db.insert(postTags).values(p.tags.map((name) => ({ postId: row.id, tagId: tagId[name] })));
  }
}

await db.insert(comments).values([
  { postId: postIds[0], authorId: lin.id, body: 'Nice' },
  { postId: postIds[0], authorId: grace.id, body: '+1' },
  { postId: postIds[3], authorId: ada.id, body: 'Thanks' },
]);

console.log('seeded', {
  users: await db.$count(users),
  posts: await db.$count(posts),
  comments: await db.$count(comments),
  tags: await db.$count(tags),
  post_tags: await db.$count(postTags),
});
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   seeded { users: 3, posts: 4, comments: 3, tags: 4, post_tags: 5 }
```

Drizzle has no built-in seed command. The seed is a plain script; the separate `drizzle-seed` package generates fake data and is not used here.

**Example 6 — CRUD with the query builder, and the SQL each call sends.**

typescript

```
// src/crud.ts
import { and, eq, ilike } from 'drizzle-orm';
import { db, pool } from './db.ts';
import { posts, users } from './schema.ts';

const [alan] = await db.insert(users).values({ email: 'alan@example.com', name: 'Alan' }).returning();
console.log('insert:', alan);

console.log(
  'select:',
  await db
    .select({ id: posts.id, title: posts.title })
    .from(posts)
    .where(and(eq(posts.published, true), ilike(posts.title, '%s%')))
    .orderBy(posts.id),
);

const [renamed] = await db
  .update(users)
  .set({ name: 'Alan T.' })
  .where(eq(users.id, alan.id))
  .returning({ id: users.id, name: users.name });
console.log('update:', renamed);

const deleted = await db.delete(users).where(eq(users.id, alan.id)).returning({ id: users.id });
console.log('delete:', deleted);

// Upsert: ON CONFLICT on the unique email
const [up] = await db
  .insert(users)
  .values({ email: 'ada@example.com', name: 'Ada L.' })
  .onConflictDoUpdate({ target: users.email, set: { name: 'Ada L.' } })
  .returning();
console.log('upsert:', up);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   Query: insert into "users" ("id", "email", "name") values (default, $1, $2) returning "id", "email", "name" -- params: ["alan@example.com", "Alan"]
//   insert: { id: 4, email: 'alan@example.com', name: 'Alan' }
//   Query: select "id", "title" from "posts" where ("posts"."published" = $1 and "posts"."title" ilike $2) order by "posts"."id" -- params: [true, "%s%"]
//   select: [
//     { id: 1, title: 'Hello SQL' },
//     { id: 2, title: 'Indexes' },
//     { id: 4, title: 'Streams' }
//   ]
//   Query: update "users" set "name" = $1 where "users"."id" = $2 returning "id", "name" -- params: ["Alan T.", 4]
//   update: { id: 4, name: 'Alan T.' }
//   Query: delete from "users" where "users"."id" = $1 returning "id" -- params: [4]
//   delete: [ { id: 4 } ]
//   Query: insert into "users" ("id", "email", "name") values (default, $1, $2) on conflict ("email") do update set "name" = $3 returning "id", "email", "name" -- params: ["ada@example.com", "Ada L.", "Ada L."]
//   upsert: { id: 1, email: 'ada@example.com', name: 'Ada L.' }
```

Each `await` is exactly one statement. Without `.returning()`, an insert or update resolves to the driver's result object, not rows. An `update` or `delete` with no `.where()` touches every row.

**Example 7 — the canonical query with the query builder.** Published posts with author name, comment count and tag names, newest first. You write the joins and the aggregates yourself.

typescript

```
// src/canonical-builder.ts
import { countDistinct, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from './db.ts';
import { comments, posts, postTags, tags, users } from './schema.ts';

// Published posts with author name, comment count and tag names, newest first.
const rows = await db
  .select({
    id: posts.id,
    title: posts.title,
    author: users.name,
    comments: countDistinct(comments.id), // distinct: the tag join repeats comment rows
    tags: sql<string[]>`array_remove(array_agg(distinct ${tags.name} order by ${tags.name}), null)`,
  })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
  .leftJoin(comments, eq(comments.postId, posts.id))
  .leftJoin(postTags, eq(postTags.postId, posts.id))
  .leftJoin(tags, eq(tags.id, postTags.tagId))
  .where(eq(posts.published, true))
  .groupBy(posts.id, users.name)
  .orderBy(desc(posts.createdAt), desc(posts.id));

console.table(rows);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   Query: select "posts"."id", "posts"."title", "users"."name", count(distinct "comments"."id"), array_remove(array_agg(distinct "tags"."name" order by "tags"."name"), null) from "posts" inner join "users" on "users"."id" = "posts"."author_id" left join "comments" on "comments"."post_id" = "posts"."id" left join "post_tags" on "post_tags"."post_id" = "posts"."id" left join "tags" on "tags"."id" = "post_tags"."tag_id" where "posts"."published" = $1 group by "posts"."id", "users"."name" order by "posts"."created_at" desc, "posts"."id" desc -- params: [true]
//   ┌─────────┬────┬─────────────┬─────────┬──────────┬────────────────────┐
//   │ (index) │ id │ title       │ author  │ comments │ tags               │
//   ├─────────┼────┼─────────────┼─────────┼──────────┼────────────────────┤
//   │ 0       │ 4  │ 'Streams'   │ 'Grace' │ 1        │ [ 'node' ]         │
//   │ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ 0        │ [ 'perf', 'sql' ]  │
//   │ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ 2        │ [ 'intro', 'sql' ] │
//   └─────────┴────┴─────────────┴─────────┴──────────┴────────────────────┘
```

`countDistinct()` came back as the number `2`, not the string `'2'` that `pg` returns for a `bigint`, because Drizzle's helper maps the result to a number. In a raw `` sql`count(*)` `` you would add `::int` or `.mapWith(Number)` yourself. `array_remove(…, null)` drops the single `NULL` that a post with no tags would otherwise produce. `group by "posts"."id"` is enough for the other `posts` columns because `id` is the primary key.

**Example 8 — the canonical query with the relational API (v1, drizzle-orm 0.45.4).**

typescript

```
// src/canonical-rqb.ts
import { desc, eq, sql } from 'drizzle-orm';
import { db, pool } from './db.ts';
import { posts } from './schema.ts';

// The same question through the relational query API (v1, drizzle-orm 0.45).
const rows = await db.query.posts.findMany({
  where: eq(posts.published, true),
  orderBy: [desc(posts.createdAt), desc(posts.id)],
  columns: { id: true, title: true },
  extras: {
    commentCount: sql<number>`(select count(*)::int from comments c where c.post_id = ${posts.id})`.as('comment_count'),
  },
  with: {
    author: { columns: { name: true } },
    postTags: { columns: {}, with: { tag: { columns: { name: true } } } },
  },
});

console.table(
  rows.map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author.name,
    comments: p.commentCount,
    tags: p.postTags.map((pt) => pt.tag.name).sort().join(', '),
  })),
);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   Query: select "posts"."id", "posts"."title", (select count(*)::int from comments c where c.post_id = "posts"."id") as "comment_count", "posts_author"."data" as "author", "posts_postTags"."data" as "postTags" from "posts" "posts" left join lateral (select json_build_array("posts_author"."name") as "data" from (select * from "users" "posts_author" where "posts_author"."id" = "posts"."author_id" limit $1) "posts_author") "posts_author" on true left join lateral (select coalesce(json_agg(json_build_array("posts_postTags_tag"."data")), '[]'::json) as "data" from "post_tags" "posts_postTags" left join lateral (select json_build_array("posts_postTags_tag"."name") as "data" from (select * from "tags" "posts_postTags_tag" where "posts_postTags_tag"."id" = "posts_postTags"."tag_id" limit $2) "posts_postTags_tag") "posts_postTags_tag" on true where "posts_postTags"."post_id" = "posts"."id") "posts_postTags" on true where "posts"."published" = $3 order by "posts"."created_at" desc, "posts"."id" desc -- params: [1, 1, true]
//   ┌─────────┬────┬─────────────┬─────────┬──────────┬──────────────┐
//   │ (index) │ id │ title       │ author  │ comments │ tags         │
//   ├─────────┼────┼─────────────┼─────────┼──────────┼──────────────┤
//   │ 0       │ 4  │ 'Streams'   │ 'Grace' │ 1        │ 'node'       │
//   │ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ 0        │ 'perf, sql'  │
//   │ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ 2        │ 'intro, sql' │
//   └─────────┴────┴─────────────┴─────────┴──────────┴──────────────┘
```

One statement with three nested `left join lateral` subqueries. V1 has no relational aggregate, so the count is a correlated subquery in `extras`. Many-to-many goes through `postTags[].tag`, and the tag order was sorted in JavaScript.

**Example 9 — the same query on drizzle-orm 1.0.0-rc.4 with Relational Queries v2.** This is a separate project with `drizzle-orm@1.0.0-rc.4`. It uses the same tables from Example 2, without the v1 `relations()` block, against the same database.

typescript

```
// src/relations.ts  (drizzle-orm 1.0.0-rc.4)
// Relational Queries v2 (drizzle-orm 1.0 release candidates): one place for every relation.
import { defineRelations } from 'drizzle-orm';
import * as schema from './schema.ts';

export const relations = defineRelations(schema, (r) => ({
  users: {
    posts: r.many.posts(),
    comments: r.many.comments(),
  },
  posts: {
    author: r.one.users({ from: r.posts.authorId, to: r.users.id, optional: false }),
    comments: r.many.comments(),
    // many-to-many straight through the post_tags junction table
    tags: r.many.tags({
      from: r.posts.id.through(r.postTags.postId),
      to: r.tags.id.through(r.postTags.tagId),
    }),
  },
  comments: {
    post: r.one.posts({ from: r.comments.postId, to: r.posts.id }),
    author: r.one.users({ from: r.comments.authorId, to: r.users.id }),
  },
}));
```

typescript

```
// src/canonical-v2.ts  (drizzle-orm 1.0.0-rc.4)
import { drizzle } from 'drizzle-orm/node-postgres';
import { relations } from './relations.ts';

const db = drizzle(process.env.DATABASE_URL!, { relations, logger: true });

// Published posts with author name, comment count and tag names, newest first.
const rows = await db.query.posts.findMany({
  where: { published: true },
  orderBy: { createdAt: 'desc', id: 'desc' },
  columns: { id: true, title: true },
  extras: {
    commentCount: (t, { sql }) =>
      sql<number>`(select count(*)::int from comments c where c.post_id = ${t.id})`,
  },
  with: {
    author: { columns: { name: true } },
    tags: { columns: { name: true }, orderBy: { name: 'asc' } },
  },
});
console.log(JSON.stringify(rows));
await db.$client.end();

// Real output (Node v24.19.0, drizzle-orm 1.0.0-rc.4, PostgreSQL 18.4):
//   Query: select "d0"."id" as "id", "d0"."title" as "title", ((select count(*)::int from comments c where c.post_id = "d0"."id")) as "commentCount", "author"."r" as "author", "tags"."r" as "tags" from "posts" as "d0" left join lateral(select row_to_json("t".*) "r" from (select "d1"."name" as "name" from "users" as "d1" where "d0"."author_id" = "d1"."id" limit $1) as "t") as "author" on true left join lateral(select coalesce(json_agg(row_to_json("t".*)), '[]') as "r" from (select "d1"."name" as "name" from "tags" as "d1" inner join "post_tags" as "tr0" on "tr0"."tag_id" = "d1"."id" where "d0"."id" = "tr0"."post_id" order by "d1"."name" asc) as "t") as "tags" on true where "d0"."published" = $2 order by "d0"."created_at" desc, "d0"."id" desc -- params: [1, true]
//   [{"id":4,"title":"Streams","commentCount":1,"author":{"name":"Grace"},"tags":[{"name":"node"}]},{"id":2,"title":"Indexes","commentCount":0,"author":{"name":"Ada"},"tags":[{"name":"perf"},{"name":"sql"}]},{"id":1,"title":"Hello SQL","commentCount":2,"author":{"name":"Ada"},"tags":[{"name":"intro"},{"name":"sql"}]}]
```

What changed against v1:

- relations are declared once, with `defineRelations`;
- `through()` removes the junction level (`tags[].name`) and lets the database sort the tags;
- `where` and `orderBy` are objects;
- `extras` takes a callback that receives the aliased table `t`. The docs warn that referencing the imported `posts` table there is wrong in v2, because the outer table is aliased `d0`.

`optional: false` makes `author` non-nullable in the result type. Release candidates can still change, so pin the exact version if you adopt one.

**Example 10 — edge case: join fan-out inflates `count()`.** Example 7 used `countDistinct`. This is what happens without it. Joining two one-to-many tables onto `posts` produces comments × tags rows per post.

typescript

```
// src/fanout.ts
import { count, countDistinct, eq } from 'drizzle-orm';
import { db, pool } from './counting.ts';
import { comments, posts, postTags } from './schema.ts';

// Joining two one-to-many tables multiplies rows: post 1 has 2 comments x 2 tags = 4 rows.
const rows = await db
  .select({
    id: posts.id,
    naive: count(comments.id),
    distinct: countDistinct(comments.id),
  })
  .from(posts)
  .leftJoin(comments, eq(comments.postId, posts.id))
  .leftJoin(postTags, eq(postTags.postId, posts.id))
  .where(eq(posts.published, true))
  .groupBy(posts.id)
  .orderBy(posts.id);
console.log(rows);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   [
//     { id: 1, naive: 4, distinct: 2 },
//     { id: 2, naive: 0, distinct: 0 },
//     { id: 4, naive: 1, distinct: 1 }
//   ]
```

Post 1 reports 4 comments instead of 2, a wrong number with no error. The bug only shows on rows that have several children in both joined tables. `DISTINCT` fixes counts of ids. For sums, aggregate each child table in its own subquery (or a correlated subquery, as in Example 8) before joining.

**Example 11 — transactions: a nested savepoint and an explicit rollback.**

typescript

```
// src/transactions.ts
import { DrizzleQueryError, eq, TransactionRollbackError } from 'drizzle-orm';
import { db, pool, startCounting } from './counting.ts';
import { comments, posts, tags } from './schema.ts';

// Outer transaction with a nested one: the nested call becomes a SAVEPOINT.
startCounting(true);
const result = await db.transaction(async (tx) => {
  await tx.update(posts).set({ published: true }).where(eq(posts.id, 3));

  try {
    await tx.transaction(async (inner) => {
      await inner.insert(comments).values({ postId: 3, authorId: 1, body: 'Ship it' });
      await inner.insert(tags).values({ name: 'sql' }); // duplicate -> unique violation
    });
  } catch (err) {
    if (!(err instanceof DrizzleQueryError)) throw err;
    console.log('inner failed:', err.constructor.name, (err.cause as { code?: string }).code);
  }
  return tx.$count(comments, eq(comments.postId, 3));
});
startCounting();
console.log('comments on post 3 inside the outer tx after the savepoint rollback:', result);
const [p3] = await db.select({ published: posts.published }).from(posts).where(eq(posts.id, 3));
console.log('post 3 published (outer committed):', p3.published);

// Explicit rollback: tx.rollback() throws, so nothing after it runs and the whole tx is undone.
startCounting(true);
try {
  await db.transaction(async (tx) => {
    await tx.update(posts).set({ title: 'Renamed' }).where(eq(posts.id, 1));
    const n = await tx.$count(posts, eq(posts.title, 'Renamed'));
    if (n > 0) tx.rollback();
  });
} catch (err) {
  console.log('rolled back:', err instanceof TransactionRollbackError, (err as Error).message);
}
startCounting();
const [p1] = await db.select({ title: posts.title }).from(posts).where(eq(posts.id, 1));
console.log('post 1 title:', p1.title);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   SQL: begin  params: []
//   SQL: update "posts" set "published" = $1 where "posts"."id" = $2  params: [true,3]
//   SQL: savepoint sp1  params: []
//   SQL: insert into "comments" ("id", "post_id", "author_id", "body", "created_at") values (default, $1, $2, $3, default)  params: [3,1,"Ship it"]
//   SQL: insert into "tags" ("id", "name") values (default, $1)  params: ["sql"]
//   SQL: rollback to savepoint sp1  params: []
//   inner failed: DrizzleQueryError 23505
//   SQL: select count(*) as count from "comments" where "comments"."post_id" = $1;  params: [3]
//   SQL: commit  params: []
//   comments on post 3 inside the outer tx after the savepoint rollback: 0
//   post 3 published (outer committed): true
//   SQL: begin  params: []
//   SQL: update "posts" set "title" = $1 where "posts"."id" = $2  params: ["Renamed",1]
//   SQL: select count(*) as count from "posts" where "posts"."title" = $1;  params: ["Renamed"]
//   SQL: rollback  params: []
//   rolled back: true Rollback
//   post 1 title: Hello SQL
```

The comment insert inside the savepoint was undone together with the failing tag insert, while the outer `update` committed. Since drizzle-orm 0.44 a failed query is wrapped in `DrizzleQueryError` (its `message` contains the SQL and params), and the `pg` error with the SQLSTATE `code`, here `23505`, is on `err.cause`. `db.transaction(cb, { isolationLevel: 'serializable' })` sets the isolation level.

**Example 12 — edge case: type inference, a real `tsc` error, and why Node runs it anyway.**

typescript

```
// src/types-demo.ts
import { eq } from 'drizzle-orm';
import { db, pool } from './db.ts';
import { posts } from './schema.ts';

// Row types come from the table definition; nothing is generated.
type Post = typeof posts.$inferSelect; // what a SELECT returns
type NewPost = typeof posts.$inferInsert; // what an INSERT accepts

// id, published and createdAt have defaults, so they are optional on insert.
const ok: NewPost = { authorId: 1, title: 'Typed', body: 'b' };

// A misspelled column name is rejected by the compiler.
const typo: NewPost = { authorId: 1, title: 'Typed', body: 'b', publised: true };

// So is a wrong value type in a filter.
await db.select().from(posts).where(eq(posts.published, 'yes'));

const [row]: Post[] = await db.insert(posts).values(ok).returning();
console.log(typeof row.createdAt, row.createdAt instanceof Date, typo);
await pool.end();
```

bash

```
$ npx tsc --noEmit -p .; echo "exit $?"
src/types-demo.ts(14,65): error TS2561: Object literal may only specify known properties, but 'publised' does not exist in type '{ authorId: number; body: string; createdAt?: Date | undefined; id?: number | undefined; published?: boolean | undefined; title: string; }'. Did you mean to write 'published'?
src/types-demo.ts(17,40): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Argument of type 'PgColumn<{ name: "published"; tableName: "posts"; dataType: "boolean"; columnType: "PgBoolean"; data: boolean; driverParam: boolean; notNull: true; hasDefault: true; isPrimaryKey: false; isAutoincrement: false; ... 4 more ...; generated: undefined; }, {}, {}>' is not assignable to parameter of type 'never'.
exit 1
$ node src/types-demo.ts; echo "exit $?"
Query: select "id", "author_id", "title", "body", "published", "created_at" from "posts" where "posts"."published" = $1 -- params: ["yes"]
Query: insert into "posts" ("id", "author_id", "title", "body", "published", "created_at") values (default, $1, $2, $3, default, default) returning "id", "author_id", "title", "body", "published", "created_at" -- params: [1, "Typed", "b"]
object true { authorId: 1, title: 'Typed', body: 'b', publised: true }
exit 0
```

The first error is clear: the inferred insert type lists the real columns and which ones are optional. The second is typical of Drizzle's overloaded helpers. A wrong value type shows up as "not assignable to `never`" on the *column* argument, so read the column's `data: boolean` to see the expected type. At runtime nothing stopped either mistake. Node's type stripping does not type-check, Drizzle silently ignored the unknown `publised` key, and PostgreSQL accepted `'yes'` as a boolean literal. Run `tsc --noEmit` in CI. `$inferSelect` also shows that `timestamptz` arrives as a `Date`.

**Example 13 — the N+1 trap, measured with the counting logger.**

typescript

```
// src/n-plus-one.ts
import { asc, eq, inArray } from 'drizzle-orm';
import { db, pool, queries, startCounting } from './counting.ts';
import { comments, posts, users } from './schema.ts';

// 1) The trap: one query for the posts, then two more per post inside the loop.
startCounting();
const all = await db.select().from(posts).orderBy(asc(posts.id));
const loop = [];
for (const post of all) {
  const author = await db.query.users.findFirst({ where: eq(users.id, post.authorId) });
  const cs = await db.select().from(comments).where(eq(comments.postId, post.id));
  loop.push(`${post.title} by ${author?.name}: ${cs.length} comments`);
}
console.log(loop);
console.log('loop queries:', queries.length);

// 2) Fix with the relational API: one SQL statement with lateral joins.
startCounting();
const nested = await db.query.posts.findMany({
  orderBy: [asc(posts.id)],
  with: { author: true, comments: true },
});
console.log(nested.map((p) => `${p.title} by ${p.author.name}: ${p.comments.length} comments`));
console.log('db.query queries:', queries.length);

// 3) Fix with the query builder: a join for the author, one IN (...) query for the comments.
startCounting();
const rows = await db
  .select({ post: posts, authorName: users.name })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.authorId))
  .orderBy(asc(posts.id));
const cs = await db
  .select()
  .from(comments)
  .where(inArray(comments.postId, rows.map((r) => r.post.id)));
const byPost = Map.groupBy(cs, (c) => c.postId);
console.log(rows.map((r) => `${r.post.title} by ${r.authorName}: ${byPost.get(r.post.id)?.length ?? 0} comments`));
console.log('builder queries:', queries.length);
for (const q of queries) console.log('  ' + q);
await pool.end();

// Real output (Node v24.19.0, drizzle-orm 0.45.4, PostgreSQL 18.4):
//   [
//     'Hello SQL by Ada: 2 comments',
//     'Indexes by Ada: 0 comments',
//     'Draft by Lin: 0 comments',
//     'Streams by Grace: 1 comments'
//   ]
//   loop queries: 9
//   [
//     'Hello SQL by Ada: 2 comments',
//     'Indexes by Ada: 0 comments',
//     'Draft by Lin: 0 comments',
//     'Streams by Grace: 1 comments'
//   ]
//   db.query queries: 1
//   [
//     'Hello SQL by Ada: 2 comments',
//     'Indexes by Ada: 0 comments',
//     'Draft by Lin: 0 comments',
//     'Streams by Grace: 1 comments'
//   ]
//   builder queries: 2
//     select "posts"."id", "posts"."author_id", "posts"."title", "posts"."body", "posts"."published", "posts"."created_at", "users"."name" from "posts" inner join "users" on "users"."id" = "posts"."author_id" order by "posts"."id" asc
//     select "id", "post_id", "author_id", "body", "created_at" from "comments" where "comments"."post_id" in ($1, $2, $3, $4)
```

The loop costs 1 + 2 × N statements: 9 here, 2,001 for 1,000 posts. The relational API needs 1 statement and the builder version 2, whatever N is. Drizzle has no automatic batching of the kind Prisma has for `findUnique`, so `Promise.all` over the loop would still send 9 statements, just concurrently. The query counts were measured. Run times were not, so choosing between the 1-statement and 2-statement versions is a matter of measuring your data. `Map.groupBy` needs Node 21+ (and `"target": "ES2024"` or later in `tsconfig.json` for its types).

## Common mistakes & gotchas

- **Reading the docs for the wrong major.** The docs site describes 1.0 relational queries v2. `npm i drizzle-orm` installs 0.45, which has v1 `relations()`. Check `drizzle-kit --version` against the page.
- **Forgetting to pass schema (v1) or relations (v2) into drizzle().** `db.query.posts` is then undefined. The query builder still works, which hides the mistake.
- **Thinking relations() creates foreign keys.** It only feeds `db.query`. Constraints come from `.references()`.
- **Counting across two joined one-to-many tables.** Rows multiply and count() is silently wrong. Use countDistinct, or aggregate each child in a subquery.
- **Raw sql aggregates come back as strings.** pg returns bigint and numeric as strings. Use `count()` or `countDistinct()`, cast with `::int`, or call `.mapWith(Number)`.
- **Mixing push and migrate on one database.** push leaves no history, so a later migrate tries to create tables that exist. Pick one per environment.
- **Editing or reordering applied migrations.** The migrator compares journal timestamps with the newest history row and does not re-check hashes. An edited file is skipped. A file merged with an older timestamp than the last applied one is also skipped.
- **Using db instead of tx inside a transaction.** That query is outside the transaction and is not rolled back.
- **Trusting `node file.ts` as a type check.** Type stripping runs code that has type errors. Run `tsc --noEmit` in CI.
- **update or delete without where.** It affects every row. The builder does not warn.

## Best practices

- Pin `drizzle-orm` and `drizzle-kit` exactly. Move to 1.0 on purpose, using the v1-to-v2 guide, not through a caret range.
- Commit the `drizzle` folder, SQL plus meta. Review each generated file. Apply with `migrate()` or `drizzle-kit migrate`. Keep push for throwaway databases.
- One Pool and one db per process.
- Relational API for nested reads. Builder for reports, aggregates, and bulk writes. Log SQL in tests and check the statement count.
- Select only the columns you need.
- Export `$inferSelect` and `$inferInsert` from the schema module and use them in services, instead of hand-written row types.
- Keep transactions short. Pass tx into helpers. Use a nested savepoint for a sub-step that may fail without aborting the rest.
- Put values into SQL only through the bound `sql` template. `sql.raw()` inserts text as-is and must only receive constants.

## ⭐ Interview lens

> **Q: “How does Drizzle differ from Prisma in how a query reaches the database?”**  
> A: Drizzle has no code generation and no separate query engine. The schema is TypeScript objects from `pgTable`, the result types are inferred from those objects, and awaiting a builder renders one SQL string and sends it through your driver, pg in this lesson. The relational API, `db.query`, also compiles to one statement, using lateral joins and JSON, rather than one query per relation. Prisma generates a client and, by default, runs one query per relation level and stitches the objects in JavaScript. For example, the canonical published-posts query is one GROUP BY you write in the builder, or one lateral-join statement from `db.query`. The limit of "Drizzle has no N+1" is that a loop of queries is still N+1. Drizzle only avoids adding hidden queries of its own. The measured loop here was 9 statements, the relational call was 1, and a builder join plus an IN list was 2.

> **Q: “Query builder or `db.query`? When do you use each?”**  
> A: `db.query.posts.findMany({ with })` returns nested objects from the relation definitions you declared. It fits an API response shaped like the data: a post, its author, its tags. The builder returns flat rows and gives you the SQL shape: joins, groupBy, aggregates, CTEs. It fits reports and writes. For example, comment count plus tag names is either a relational call with a correlated count in extras, or a builder query where you write `countDistinct` yourself. The limit is join fan-out. Two one-to-many joins in the builder multiply rows, so a post with 2 comments and 2 tags counted as 4 with a plain count, and nothing errored. Use countDistinct, or aggregate each child in its own subquery before you join.

> **Q: “`drizzle-kit push` vs `generate` + `migrate`?”**  
> A: `drizzle-kit push` diffs the TypeScript schema against the live database and applies the change directly. It writes no file and no history row. It suits a prototype, and it leaves nothing to review later. `generate` writes a SQL file plus a snapshot you can read in review. `migrate` applies pending files in one transaction and records each one in `drizzle.__drizzle_migrations`. Teams and production use that pair, because every database then has the same history. For example, a second migrate on an up-to-date database applies nothing, and you only know that by looking at the history table, because the success line looks the same. The limit is that the migrator applies files newer than the last recorded timestamp and does not re-check the hash of a file already applied. Editing an applied file does nothing on databases that already ran it. Write a new migration.

> **Q: “How do nested transactions work in Drizzle?”**  
> A: `db.transaction` sends begin, runs your callback on one connection, then commit. A throw sends rollback. Nesting `tx.transaction` does not start a second transaction. It sends `savepoint spN`. If the inner callback throws, Drizzle rolls back to that savepoint and the outer callback can catch it and still commit. `tx.rollback()` throws `TransactionRollbackError` when you want to abort the whole unit on purpose. For example, a tag insert that hits a unique violation can roll back only the savepoint, while the outer update of the post still commits. Since 0.44 a failed query is wrapped in `DrizzleQueryError`, and the pg error code, such as 23505, is on `err.cause`. The limit is the same as any of these libraries: a call on `db` inside the callback uses another pool connection and is not rolled back. Pass `tx` into helpers.

## Cheat-card

- **Schema:** `pgTable` with the SQL name in the column builder and the TypeScript name as the key. Composite primary key in the table callback. Foreign keys from `.references()`.
- **Client:** `drizzle({ client: pool, schema, logger: true })`. A custom logger implements `logQuery`.
- **Relations:** v1 is `relations()` per table, and many-to-many goes through the junction. v2 on the 1.0 release candidate is `defineRelations` with `through()`.
- **Builder:** select, from, join, where, groupBy, orderBy. `count()` and `countDistinct()` return numbers. `returning()` gives rows from a write.
- **Relational:** `db.query.posts.findMany` with columns, with, where, orderBy, and extras is one SQL statement.
- **Kit:** `generate` writes SQL plus meta. `migrate` records the journal in `drizzle.__drizzle_migrations`. `push` has no files and no history.
- **Runtime migrations:** `migrate(db, { migrationsFolder })` from `drizzle-orm/node-postgres/migrator`.
- **Transactions:** callback commits or rolls back. Nested call is a savepoint. `tx.rollback()` throws `TransactionRollbackError`.
- **Types:** `$inferSelect` and `$inferInsert` are checked only by tsc.
- **N+1 measured:** loop 9, relational with 1, builder join plus inArray 2, for 4 posts.

## Good to know

- Versions used here: drizzle-orm 0.45.4 (npm latest), drizzle-kit 0.31.11, pg 8.23.1, Node v24.19.0, TypeScript 7.0.2, PostgreSQL 18.4. Relational Queries v2 was checked on drizzle-orm 1.0.0-rc.4. `latest` stayed on 0.45 because 0.45.4 was published after that release candidate.
- drizzle-kit loads TypeScript through esbuild. It worked even though npm 11.17 did not run esbuild's postinstall, because the binary comes from `@esbuild/linux-x64`.
- **What are `$inferSelect` and `$inferInsert`, and what do they not protect you from?** They are types taken from a `pgTable`. Select is the row you get back. Insert makes defaulted or nullable columns optional. Only tsc checks them. Type stripping, plain JavaScript, and untrusted request bodies are not checked. Validate at the edge and run `tsc --noEmit` in CI.
- The migrator reads only the newest history row and applies journal entries whose timestamp is later. When a line was appended to an already-applied file, the next migrate still only printed begin and commit, and `drizzle-kit check` printed that everything was fine.
- Query counts were measured. Run times were not, so choosing between the 1-statement and 2-statement versions is a measurement on your data. `Map.groupBy` needs Node 21 or later.
- Drizzle has no built-in seed command. The seed here is a plain script. The separate `drizzle-seed` package generates fake data and was not used.

---

## Learn More

- [Drizzle schema declaration orm.drizzle.team](https://orm.drizzle.team/docs/sql-schema-declaration)
- [Relational Queries v1 to v2 orm.drizzle.team](https://orm.drizzle.team/docs/relations-v1-v2)
- [Relational queries (v2) orm.drizzle.team](https://orm.drizzle.team/docs/rqb)
- [Joins orm.drizzle.team](https://orm.drizzle.team/docs/joins)
- [Transactions orm.drizzle.team](https://orm.drizzle.team/docs/transactions)
- [Migrations overview orm.drizzle.team](https://orm.drizzle.team/docs/migrations)
- [drizzle-kit generate orm.drizzle.team](https://orm.drizzle.team/docs/drizzle-kit-generate)
- [drizzle-kit migrate orm.drizzle.team](https://orm.drizzle.team/docs/drizzle-kit-migrate)
- [drizzle-kit push orm.drizzle.team](https://orm.drizzle.team/docs/drizzle-kit-push)
- [Type API ($inferSelect / $inferInsert) orm.drizzle.team](https://orm.drizzle.team/docs/goodies)
- [drizzle-orm 0.45.4 release github.com](https://github.com/drizzle-team/drizzle-orm/releases/tag/0.45.4)
