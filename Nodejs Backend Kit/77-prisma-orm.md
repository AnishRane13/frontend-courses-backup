---
title: "Prisma ORM"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Prisma ORM

*28 min read · Updated 12 Oct 2026 · Topic 101 of 106 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Prisma 7.10.0 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`), pg 8.23.1, dotenv 18.0.7, TypeScript 7.0.2, PostgreSQL 18.4 run locally via the embedded-postgres npm package (no Docker)

---

## Why it matters

Lesson 73 wrote SQL by hand with `pg`. That works, but every query returns rows typed as `any`, every rename of a column means a search through string literals, and joining three tables into nested JSON is code you write and test yourself. Prisma takes a different approach. You describe your tables once in a schema file, and Prisma does three jobs from it:

- **Migrate** turns the schema into SQL migration files and applies them.
- **Generate** writes a TypeScript client whose methods and result types match your tables.
- **The client** turns calls like `prisma.post.findMany({ include: { author: true } })` into SQL at runtime and sends it to the database.

Prisma is one of the most used Node ORMs, so you will meet it in existing code bases and in interviews. You also need to know where it hurts. It can send more queries than you expect. It has its own transaction API with a timeout. Its raw-SQL escape hatch has one safe and one unsafe form. And version 7 changed how a project is set up. This lesson builds the kit's shared blog database (users, posts, comments, tags) with Prisma 7.10.0 and measures each of these points against a real PostgreSQL 18.4 server.

## The concept, simply

An ORM (object-relational mapper) sits between your code and the SQL database. You work with objects and method calls, and the ORM writes the SQL. Prisma's version of this has three parts that you run at different times:

1. **The schema** (`prisma/schema.prisma`). One `model` per table, with fields, types, keys and relations. It is the source of truth.
2. **The CLI** (`npx prisma …`), used at development and deploy time. `migrate dev` compares the schema with the migration history and writes a new `migration.sql`. `migrate deploy` applies pending migrations. `generate` writes the client code.
3. **Prisma Client**, used at runtime. It is generated code plus a runtime library. In Prisma 7 the runtime builds SQL in-process with a WebAssembly query compiler and sends it through a *driver adapter*: for PostgreSQL that is `@prisma/adapter-pg`, which uses the ordinary `pg` driver.

text

```
            development / CI                                   runtime (your server)
 ┌────────────────────────────┐
 │ prisma/schema.prisma       │──prisma migrate dev──▶ prisma/migrations/<timestamp>_init/migration.sql
 │ (models, relations, @map)  │                                │ prisma migrate deploy
 └────────────┬───────────────┘                                ▼
              │ prisma generate                        PostgreSQL (+ _prisma_migrations table)
              ▼                                                ▲
 src/generated/prisma/*.ts ──import──▶ new PrismaClient({ adapter })
                                         prisma.post.findMany({ include: … })
                                           → query compiler (WebAssembly, in-process) → SQL + params
                                           → @prisma/adapter-pg → pg.Pool ───────────────┘
```

## How it works

What happens from an empty folder to a running query, in the project this lesson builds:

1. `npx prisma init` writes `prisma/schema.prisma`, a config file and `.env`. You write the models.
2. `npx prisma migrate dev --name init` loads `prisma.config.ts`, which gives it the database URL. It compares the schema with the existing migrations and writes `prisma/migrations/<timestamp>_init/migration.sql`. It applies that file and records it in the `_prisma_migrations` table. In Prisma 7 it does **not** run `generate` or the seed script any more (changed in v7.0).
3. `npx prisma generate` writes the client into the `output` folder from the generator block, here `src/generated/prisma`. It is plain TypeScript with `.ts` import specifiers.
4. Your code creates `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`. In v7 the adapter is required (changed in v7.0).
5. A call such as `prisma.post.findMany({ where, include })` is validated against the generated types. At runtime the query compiler turns it into one or more SQL statements with `$1, $2…` parameters. The adapter sends them over a `pg` pool connection and Prisma assembles the nested result objects.

**What changed in Prisma 7.** If you read a Prisma 5 or 6 tutorial, five things now work differently. Each one was checked in this project:

- **The generator.** It is now `provider = "prisma-client"` with a required `output` path. The client is generated into your source tree instead of `node_modules/.prisma`, and you import it from that path rather than from `@prisma/client`. The old `prisma-client-js` provider still exists but is scheduled for removal.
- **Driver adapters.** They are mandatory. The Rust query engine binary is gone from the client, and `@prisma/adapter-pg` plus `pg` do the networking. Pool settings are now `pg`'s settings: the upgrade guide notes that `pg` has no connection timeout by default, where Prisma 6 used 5 seconds.
- **`prisma.config.ts`.** The CLI reads the database URL, schema path, migrations path and seed command from it. The `url` field in the `datasource` block is deprecated. The CLI does not load `.env` by itself, so the config file starts with `import 'dotenv/config'`.
- **ESM.** Prisma now ships as an ES module. The upgrade guide asks for `"type": "module"` and lists Node 20.19.0 and TypeScript 5.4.0 as minimum versions.
- **No automatic seeding.** `migrate dev` and `migrate reset` no longer run the seed script; you run `prisma db seed` yourself.

> ⚠️ Unverified: that `migrate reset` no longer seeds is taken from the v7 upgrade guide and was not run here. Prisma 7.10.0 refuses `migrate reset` when it detects an AI agent without the user's explicit consent, and none was given. `migrate dev` on an empty database was run, and it did not seed (Example 4).

**Which version, and why 7.10.0.** On 12 Oct 2026 npm's `latest` tag for the `prisma` CLI package points at `8.0.0-rc.22`, a release candidate published 8 Oct 2026. The `latest` tag of `@prisma/client`, however, still points at `7.10.0`. So a bare `npm install prisma @prisma/client` gives you a CLI and a client from two different major versions. The newest stable release of both is 7.10.0 (25 Aug 2026), so this lesson pins it with `-E`. The docs site has also moved to v8 by default; the v7 pages live under `/docs/orm/v7/`, and the Learn More links point there. 7.10.0 also renamed the config file: `prisma init` now writes `prisma7.config.ts` so that a Prisma 7 config can sit next to a Prisma 8 `prisma.config.ts` (changed in v7.10.0). The 7.10.0 loader looks for `prisma7.config.*` first and falls back to `prisma.config.*`. This lesson uses `prisma.config.ts`, the name every 7.x release understands, and the CLI confirms it with `Loaded Prisma config from prisma.config.ts.`

**Mapping to the shared tables.** Prisma's model and field names are what your TypeScript sees: `Post`, `authorId`, `createdAt`. `@@map("posts")` sets the table name and `@map("author_id")` sets the column name, so the database keeps the kit's snake_case names. The many-to-many link is an *explicit* join model, `PostTag` mapped to `post_tags`, with a composite `@@id([postId, tagId])`. Prisma also supports *implicit* many-to-many (`tags Tag[]` on `Post` and `posts Post[]` on `Tag`, with no join model). In that case Prisma creates and names the join table itself: `_PostToTag`, with columns `A` and `B`. `@relation("post_tags")` on both sides only renames it to `_post_tags`, and the columns stay `A` and `B` (Example 3 shows the generated SQL). The shared domain's `post_tags (post_id, tag_id)` therefore needs the explicit form. The price is one more level when you query: `post.tags[].tag.name` instead of `post.tags[].name`.

**How relation loading turns into SQL.** By default, `include` and nested `select` use the `query` strategy: one SELECT per relation level, with the child rows fetched by `WHERE parent_id IN (…)` and stitched together in JavaScript. A 3-level include is therefore 3 or 4 queries, not 1, and Examples 8 and 14 count them. The `relationJoins` preview feature adds `relationLoadStrategy: "join"`, which uses PostgreSQL `LEFT JOIN LATERAL` with JSON aggregation to load everything in one statement. It is still marked Preview in the v7 docs, so it has to be enabled in the generator block.

**Transactions come in three forms.**

- **Nested writes.** A `create` that also creates `tags` rows is wrapped in a transaction automatically.
- **`$transaction([q1, q2])`.** It runs a list of independent queries inside one transaction, and all of them commit or none do.
- **`$transaction(async (tx) => { … })`.** An *interactive* transaction holds one connection for the whole callback, so you can read, decide in JavaScript, then write. A throw rolls everything back. Every query inside must go through `tx`, and the callback has a 5-second default `timeout` (with `maxWait` 2 seconds to get a connection).

**Raw SQL.** `$queryRaw` is a tagged template, so each `${value}` becomes a bind parameter. `$queryRawUnsafe(string, ...values)` takes a plain string, and if you build that string by concatenation, user input becomes SQL. `$executeRaw` returns an affected-row count. Raw results are not mapped through the models, so PostgreSQL `bigint` (for example `count(*)`) comes back as a JavaScript `BigInt`.

**Migrations and the history table.** Each migration is a folder with one `migration.sql`. `_prisma_migrations` stores a row per applied migration, including a SHA-256 `checksum` of the file. `migrate dev` (development) compares those checksums with the files, generates new migrations and can ask to reset the database. `migrate deploy` (CI or production) only applies migrations that are not yet in the table and never generates or resets anything. `migrate status` reports pending ones and exits with code 1 while any are pending.

## Code examples

Every example ran against a real PostgreSQL 18.4 server. Unless stated otherwise, each one starts from a freshly seeded database (`npx prisma db seed`, Example 5), so ids match the shared seed: Ada = 1, Lin = 2, Grace = 3; posts 1 "Hello SQL", 2 "Indexes", 3 "Draft", 4 "Streams". The TypeScript files run directly with `node file.ts`: Node 24 strips the types and the generated client uses `.ts` import paths, so no build step or `tsx` is needed. `npx tsc -p .` (TypeScript 7.0.2, `strict`) passes on every file shown.

**Example 1 — choosing the version and installing it.** `latest` is a release candidate for the CLI but not for the client, so pin both to the newest stable release.

bash

```
$ npm view prisma dist-tags.latest
8.0.0-rc.22
$ npm view @prisma/client dist-tags.latest
7.10.0
$ npm view prisma 'time[7.10.0]'
2026-08-25T12:47:51.307Z
$ npm view prisma 'time[8.0.0-rc.22]'
2026-10-08T18:19:30.528Z
$ npm init -y && npm pkg set type=module
$ npm i -E prisma@7.10.0 @prisma/client@7.10.0 @prisma/adapter-pg@7.10.0 pg@8.23.1 dotenv
npm warn allow-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn allow-scripts   prisma@7.10.0 (preinstall: node scripts/preinstall-entry.js)
npm warn allow-scripts   @prisma/engines@7.10.0 (postinstall: node scripts/postinstall.js)
…
$ npx prisma --version
…
prisma               : 7.10.0
@prisma/client       : 7.10.0
Operating System     : linux
Architecture         : x64
Node.js              : v24.19.0
TypeScript           : 7.0.2
Query Compiler       : enabled
PSL                  : @prisma/prisma-schema-wasm 7.10.0-4.0edf323efd1d98336f3f0a68684b56f689b900d3
Schema Engine        : schema-engine-cli 0edf323efd1d98336f3f0a68684b56f689b900d3 (at node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x)
…
```

npm 11.17 does not run install scripts until you approve them. The CLI still worked: the first CLI command downloaded the schema engine (the Rust binary used by Migrate) into `node_modules/@prisma/engines`, and also into a cache under `$HOME/.cache/prisma`. `Query Compiler : enabled` is the v7 client path, with no query engine binary at runtime.

**Example 2 — `prisma init` and the config file.** `--no-skills` skips copying Prisma's AI-agent skill files into `.claude/`, `.agents/` and `.windsurf/`, which 7.10.0 `init` does by default.

bash

```
$ npx prisma init --datasource-provider postgresql --output ../src/generated/prisma --no-skills
Initialized Prisma in your project

  prisma/
    schema.prisma
  prisma7.config.ts
  .env
  .gitignore
…
$ mv prisma7.config.ts prisma.config.ts
```

The config file after editing. `seed` is the command `prisma db seed` runs, and `env()` throws if the variable is missing:

typescript

```
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

`.env` holds `DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:6401/app"`. `dotenv/config` does not override a variable that is already set in the shell, which Example 13 uses to point the CLI at other databases.

**Example 3 — the schema for the shared domain.** Model names are PascalCase for the client; `@@map`/`@map` keep the kit's table and column names. `@db.Timestamptz` makes `created_at` a `timestamptz` rather than Prisma's default `timestamp(3)`.

prisma

```
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model User {
  id       Int       @id @default(autoincrement())
  email    String    @unique
  name     String
  posts    Post[]
  comments Comment[]

  @@map("users")
}

model Post {
  id        Int       @id @default(autoincrement())
  authorId  Int       @map("author_id")
  title     String
  body      String
  published Boolean   @default(false)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  author    User      @relation(fields: [authorId], references: [id], onDelete: Cascade)
  comments  Comment[]
  tags      PostTag[]

  @@map("posts")
}

model Comment {
  id        Int      @id @default(autoincrement())
  postId    Int      @map("post_id")
  authorId  Int      @map("author_id")
  body      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  author    User     @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@map("comments")
}

model Tag {
  id    Int       @id @default(autoincrement())
  name  String    @unique
  posts PostTag[]

  @@map("tags")
}

// Explicit many-to-many: the join table is a model, so it can be named post_tags.
model PostTag {
  postId Int  @map("post_id")
  tagId  Int  @map("tag_id")
  post   Post @relation(fields: [postId], references: [id], onDelete: Cascade)
  tag    Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([postId, tagId])
  @@map("post_tags")
}
```

For comparison, here is the implicit form with a named relation. `prisma migrate diff` prints the SQL Prisma would generate, without touching a database:

prisma

```
// variants/implicit.prisma
datasource db {
  provider = "postgresql"
}
model Post {
  id   Int   @id @default(autoincrement())
  tags Tag[] @relation("post_tags")
  @@map("posts")
}
model Tag {
  id    Int    @id @default(autoincrement())
  posts Post[] @relation("post_tags")
  @@map("tags")
}
```

bash

```
$ npx prisma migrate diff --from-empty --to-schema variants/implicit.prisma --script
…
-- CreateTable
CREATE TABLE "_post_tags" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_post_tags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_post_tags_B_index" ON "_post_tags"("B");
…
```

**Example 4 — the first migration and client generation.** Run against an empty database:

bash

```
$ npx prisma migrate dev --name init
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "app", schema "public" at "127.0.0.1:6401"

Applying migration `20261012141654_init`

The following migration(s) have been created and applied from new schema changes:

prisma/migrations/
  └─ 20261012141654_init/
    └─ migration.sql

Your database is now in sync with your schema.

$ ls src
ls: cannot access 'src': No such file or directory
$ npx prisma generate
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.

✔ Generated Prisma Client (7.10.0) to ./src/generated/prisma in 78ms
$ cat prisma/migrations/migration_lock.toml
# Please do not edit this file manually
# It should be added in your version-control system (e.g., Git)
provider = "postgresql"
```

The folder name starts with the UTC creation time, so yours will differ. `src/` did not exist after `migrate dev`, which shows that v7 no longer generates the client for you. `prisma migrate --help` in 7.10.0 still describes `dev` as "…apply it to the database, trigger generators", but it did not. The generated file, `prisma/migrations/20261012141654_init/migration.sql`, pasted unchanged:

sql

```
-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "author_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_tags" (
    "post_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "post_tags_pkey" PRIMARY KEY ("post_id","tag_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_tags" ADD CONSTRAINT "post_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Three things to notice. `@default(now())` became `DEFAULT CURRENT_TIMESTAMP`, which PostgreSQL treats the same as `now()`. Prisma added `ON UPDATE CASCADE` to every foreign key, its default `onUpdate` for required relations. And PostgreSQL does not index foreign-key columns by itself, so `posts.author_id` has no index unless you add `@@index([authorId])`.

**Example 5 — the client, a logging client, and the seed.** `db.ts` is the plain client. `logged.ts` creates a client that emits every SQL statement as a `query` event, which later examples use to count queries.

typescript

```
// src/db.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

typescript

```
// src/logged.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

// Same client, but every SQL statement is emitted as a 'query' event.
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: [{ emit: 'event', level: 'query' }],
});

export const queries: string[] = [];
let print = false;
prisma.$on('query', (e) => {
  queries.push(e.query);
  if (print) console.log(`SQL: ${e.query}  params: ${e.params}`);
});
export function startCounting(show = false) {
  queries.length = 0;
  print = show;
}
```

The seed truncates and restarts the serial counters, so it can be re-run and always produces the same ids:

typescript

```
// prisma/seed.ts
import { prisma } from '../src/db.ts';

// Start from empty tables and reset the serial counters, so ids are 1, 2, 3, ...
await prisma.$executeRawUnsafe(
  'TRUNCATE post_tags, comments, tags, posts, users RESTART IDENTITY CASCADE',
);

await prisma.tag.createMany({
  data: [{ name: 'sql' }, { name: 'intro' }, { name: 'perf' }, { name: 'node' }],
});

const ada = await prisma.user.create({ data: { email: 'ada@example.com', name: 'Ada' } });
const lin = await prisma.user.create({ data: { email: 'lin@example.com', name: 'Lin' } });
const grace = await prisma.user.create({ data: { email: 'grace@example.com', name: 'Grace' } });

// One post at a time, so created_at increases in this order.
const posts = [
  { authorId: ada.id, title: 'Hello SQL', published: true, tags: ['sql', 'intro'] },
  { authorId: ada.id, title: 'Indexes', published: true, tags: ['sql', 'perf'] },
  { authorId: lin.id, title: 'Draft', published: false, tags: [] },
  { authorId: grace.id, title: 'Streams', published: true, tags: ['node'] },
];
const created = [];
for (const p of posts) {
  created.push(
    await prisma.post.create({
      data: {
        authorId: p.authorId,
        title: p.title,
        body: `${p.title} body`,
        published: p.published,
        // Nested write into the join table: one PostTag row per tag name.
        tags: { create: p.tags.map((name) => ({ tag: { connect: { name } } })) },
      },
    }),
  );
}

await prisma.comment.createMany({
  data: [
    { postId: created[0].id, authorId: lin.id, body: 'Nice' },
    { postId: created[0].id, authorId: grace.id, body: '+1' },
    { postId: created[3].id, authorId: ada.id, body: 'Thanks' },
  ],
});

const counts = {
  users: await prisma.user.count(),
  posts: await prisma.post.count(),
  comments: await prisma.comment.count(),
  tags: await prisma.tag.count(),
  post_tags: await prisma.postTag.count(),
};
console.log('seeded', counts);
await prisma.$disconnect();
```

bash

```
$ npx prisma db seed
Loaded Prisma config from prisma.config.ts.

Running seed command `node prisma/seed.ts` ...
seeded { users: 3, posts: 4, comments: 3, tags: 4, post_tags: 5 }

🌱  The seed command has been executed.
```

**Example 6 — CRUD and the two errors you will catch most.** `P2002` is a unique-constraint violation and `P2025` means "the record you targeted does not exist". Check with `instanceof Prisma.PrismaClientKnownRequestError` before reading `.code`.

typescript

```
// src/crud.ts
import { prisma } from './db.ts';
import { Prisma } from './generated/prisma/client.ts';

// Create
const alan = await prisma.user.create({
  data: { email: 'alan@example.com', name: 'Alan' },
});
console.log('create:', alan);

// Read one by a unique field, and many with a filter
console.log('findUnique:', await prisma.user.findUnique({ where: { email: 'ada@example.com' } }));
console.log(
  'findMany:',
  await prisma.post.findMany({
    where: { published: true, title: { contains: 'S' } },
    select: { id: true, title: true },
    orderBy: { id: 'asc' },
  }),
);

// Update
const renamed = await prisma.user.update({
  where: { id: alan.id },
  data: { name: 'Alan T.' },
});
console.log('update:', renamed);

// Delete
console.log('delete:', await prisma.user.delete({ where: { id: alan.id } }));

// A unique-constraint violation is a PrismaClientKnownRequestError with code P2002
try {
  await prisma.user.create({ data: { email: 'ada@example.com', name: 'Ada again' } });
} catch (err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  console.log('duplicate:', err.code, err.meta?.modelName, '|', err.message.split('\n').at(-1));
}

// Updating a row that does not exist: P2025
try {
  await prisma.user.update({ where: { id: 999 }, data: { name: 'x' } });
} catch (err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  console.log('missing:', err.code, '|', err.message.split('\n').at(-1));
}
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   create: { id: 4, email: 'alan@example.com', name: 'Alan' }
//   findUnique: { id: 1, email: 'ada@example.com', name: 'Ada' }
//   findMany: [ { id: 1, title: 'Hello SQL' }, { id: 4, title: 'Streams' } ]
//   update: { id: 4, email: 'alan@example.com', name: 'Alan T.' }
//   delete: { id: 4, email: 'alan@example.com', name: 'Alan T.' }
//   duplicate: P2002 User | Unique constraint failed on the constraint: `users_email_key`
//   missing: P2025 | An operation failed because it depends on one or more records that were required but not found. No record was found for an update.
```

`contains: 'S'` is case-sensitive (`LIKE`), so "Indexes" is not matched. Use `mode: 'insensitive'` for `ILIKE`.

**Example 7 — relations with `include`, nested `select`, and a nested write through `post_tags`.**

typescript

```
// src/relations.ts
import { prisma, startCounting, queries } from './logged.ts';

// include: whole related rows come back
startCounting();
const ada = await prisma.user.findUniqueOrThrow({
  where: { email: 'ada@example.com' },
  include: { posts: { orderBy: { id: 'asc' } } },
});
console.log('include ->', ada.name, ada.posts.map((p) => [p.id, p.title, p.published]));
console.log('queries:', queries.length);

// select: only the named fields, nested through the PostTag join model
startCounting(true);
const post = await prisma.post.findUnique({
  where: { id: 1 },
  select: {
    title: true,
    author: { select: { name: true } },
    tags: {
      select: { tag: { select: { name: true } } },
      orderBy: { tag: { name: 'asc' } },
    },
  },
});
console.log(JSON.stringify(post));
console.log('queries:', queries.length);

// A nested write: attach the existing tag "intro" to post 3 (Lin's draft)
startCounting(true);
await prisma.post.update({
  where: { id: 3 },
  data: { tags: { create: { tag: { connect: { name: 'intro' } } } } },
  select: { id: true },
});
startCounting();
const draftTags = await prisma.postTag.findMany({ where: { postId: 3 }, include: { tag: true } });
console.log('post 3 tags:', draftTags.map((pt) => pt.tag.name));
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   include -> Ada [ [ 1, 'Hello SQL', true ], [ 2, 'Indexes', true ] ]
//   queries: 2
//   SQL: SELECT "public"."posts"."id", "public"."posts"."title", "public"."posts"."author_id" FROM "public"."posts" WHERE ("public"."posts"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3  params: [1,"1","0"]
//   SQL: SELECT "public"."users"."id", "public"."users"."name" FROM "public"."users" WHERE "public"."users"."id" = $1 OFFSET $2  params: [1,"0"]
//   SQL: SELECT "public"."post_tags"."post_id", "public"."post_tags"."tag_id" FROM "public"."post_tags" LEFT JOIN "public"."tags" AS "orderby_1" ON ("orderby_1"."id") = ("public"."post_tags"."tag_id") WHERE "public"."post_tags"."post_id" = $1 ORDER BY "orderby_1"."name" ASC OFFSET $2  params: [1,"0"]
//   SQL: SELECT "public"."tags"."id", "public"."tags"."name" FROM "public"."tags" WHERE "public"."tags"."id" IN ($1,$2) OFFSET $3  params: [2,1,"0"]
//   {"title":"Hello SQL","author":{"name":"Ada"},"tags":[{"tag":{"name":"intro"}},{"tag":{"name":"sql"}}]}
//   queries: 4
//   SQL: SELECT "public"."posts"."id" FROM "public"."posts" WHERE ("public"."posts"."id" = $1 AND 1=1) LIMIT $2 OFFSET $3  params: [3,"1","0"]
//   SQL: SELECT "public"."tags"."id" FROM "public"."tags" WHERE ("public"."tags"."name" = $1 AND 1=1) LIMIT $2 OFFSET $3  params: ["intro","1","0"]
//   SQL: INSERT INTO "public"."post_tags" ("post_id","tag_id") VALUES ($1,$2) RETURNING "public"."post_tags"."post_id", "public"."post_tags"."tag_id"  params: [3,2]
//   SQL: SELECT "public"."posts"."id" FROM "public"."posts" WHERE "public"."posts"."id" = $1 LIMIT $2 OFFSET $3  params: [3,"1","0"]
//   SQL: COMMIT  params: []
//   post 3 tags: [ 'intro' ]
```

One `findUnique` with a 3-level `select` became 4 SELECTs, one per relation level. The nested write ran inside a transaction: the `COMMIT` is logged, but in 7.10.0 the opening `BEGIN` is not emitted as a `query` event, so a log-based count misses it.

**Example 8 — the canonical query: published posts with author name, comment count and tag names, newest first.** `_count` asks for an aggregate on a relation without loading the rows. The `id` tie-breaker keeps the order stable if two posts share a `created_at`.

typescript

```
// src/canonical.ts
import { prisma, startCounting, queries } from './logged.ts';

// Published posts with author name, comment count and tag names, newest first.
startCounting(true);
const rows = await prisma.post.findMany({
  where: { published: true },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  select: {
    id: true,
    title: true,
    author: { select: { name: true } },
    _count: { select: { comments: true } },
    tags: {
      select: { tag: { select: { name: true } } },
      orderBy: { tag: { name: 'asc' } },
    },
  },
});

console.table(
  rows.map((p) => ({
    id: p.id,
    title: p.title,
    author: p.author.name,
    comments: p._count.comments,
    tags: p.tags.map((t) => t.tag.name).join(', '),
  })),
);
console.log('queries:', queries.length);
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   SQL: SELECT "public"."posts"."id", "public"."posts"."title", "public"."posts"."author_id", COALESCE("aggr_selection_0_Comment"."_aggr_count_comments", 0) AS "_aggr_count_comments" FROM "public"."posts" LEFT JOIN (SELECT "public"."comments"."post_id", COUNT(*) AS "_aggr_count_comments" FROM "public"."comments" WHERE 1=1 GROUP BY "public"."comments"."post_id") AS "aggr_selection_0_Comment" ON ("public"."posts"."id" = "aggr_selection_0_Comment"."post_id") WHERE "public"."posts"."published" = $1 ORDER BY "public"."posts"."created_at" DESC, "public"."posts"."id" DESC OFFSET $2  params: [true,"0"]
//   SQL: SELECT "public"."users"."id", "public"."users"."name" FROM "public"."users" WHERE "public"."users"."id" IN ($1,$2,$3) OFFSET $4  params: [3,1,1,"0"]
//   SQL: SELECT "public"."post_tags"."post_id", "public"."post_tags"."tag_id" FROM "public"."post_tags" LEFT JOIN "public"."tags" AS "orderby_1" ON ("orderby_1"."id") = ("public"."post_tags"."tag_id") WHERE "public"."post_tags"."post_id" IN ($1,$2,$3) ORDER BY "orderby_1"."name" ASC OFFSET $4  params: [4,2,1,"0"]
//   SQL: SELECT "public"."tags"."id", "public"."tags"."name" FROM "public"."tags" WHERE "public"."tags"."id" IN ($1,$2,$3,$4,$5) OFFSET $6  params: [2,4,3,1,1,"0"]
//   ┌─────────┬────┬─────────────┬─────────┬──────────┬──────────────┐
//   │ (index) │ id │ title       │ author  │ comments │ tags         │
//   ├─────────┼────┼─────────────┼─────────┼──────────┼──────────────┤
//   │ 0       │ 4  │ 'Streams'   │ 'Grace' │ 1        │ 'node'       │
//   │ 1       │ 2  │ 'Indexes'   │ 'Ada'   │ 0        │ 'perf, sql'  │
//   │ 2       │ 1  │ 'Hello SQL' │ 'Ada'   │ 2        │ 'intro, sql' │
//   └─────────┴────┴─────────────┴─────────┴──────────┴──────────────┘
//   queries: 4
```

Four queries, a fixed number that does not grow with the row count. The comment count is computed in SQL with a grouped subquery. The authors and tags are fetched with `IN (…)` lists. The parameter lists repeat ids (`[3,1,1]` for the authors of posts 4, 2 and 1) because Prisma does not de-duplicate them.

**Example 9 — transactions: a batch, a failing batch, and an interactive transaction that rolls back.**

typescript

```
// src/transactions.ts
import { prisma, startCounting, queries } from './logged.ts';
import { Prisma } from './generated/prisma/client.ts';

// 1) Batch transaction: an array of queries, run in one BEGIN ... COMMIT.
startCounting();
const [tag, total] = await prisma.$transaction([
  prisma.tag.create({ data: { name: 'orm' } }),
  prisma.tag.count(),
]);
console.log('batch ->', tag, 'tag count:', total);
console.log('statements:', queries.map((q) => q.split(' ')[0]));

// 2) A batch where the second query fails: the first insert is rolled back too.
try {
  await prisma.$transaction([
    prisma.tag.create({ data: { name: 'testing' } }),
    prisma.tag.create({ data: { name: 'sql' } }), // duplicate name -> P2002
  ]);
} catch (err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  console.log('batch failed:', err.code);
}
console.log('"testing" exists?', (await prisma.tag.findUnique({ where: { name: 'testing' } })) !== null);

// 3) Interactive transaction: write, check a rule in JS, and roll back by throwing.
async function publishWithComment(postId: number, commenterId: number, body: string) {
  return prisma.$transaction(async (tx) => {
    const post = await tx.post.update({ where: { id: postId }, data: { published: true } });
    await tx.comment.create({ data: { postId, authorId: commenterId, body } });
    if (post.authorId === commenterId) {
      throw new Error(`user ${commenterId} cannot comment on their own post ${postId}`);
    }
    return post;
  });
}

const state = () =>
  prisma.post.findUnique({
    where: { id: 3 },
    select: { published: true, _count: { select: { comments: true } } },
  });

startCounting();
try {
  await publishWithComment(3, 2, 'Self-review'); // Lin (id 2) wrote post 3 -> throws
} catch (err) {
  console.log('interactive failed:', (err as Error).message);
}
console.log('statements:', queries.map((q) => q.split(' ')[0]));
console.log('post 3 after rollback:', await state());

await publishWithComment(3, 1, 'Ship it'); // Ada (id 1) -> commits
console.log('post 3 after commit:  ', await state());
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   batch -> { id: 5, name: 'orm' } tag count: 5
//   statements: [ 'INSERT', 'SELECT', 'COMMIT' ]
//   batch failed: P2002
//   "testing" exists? false
//   interactive failed: user 2 cannot comment on their own post 3
//   statements: [ 'UPDATE', 'INSERT', 'ROLLBACK' ]
//   post 3 after rollback: { published: false, _count: { comments: 0 } }
//   post 3 after commit:   { published: true, _count: { comments: 1 } }
```

The batch form cannot use the result of one query in the next. Use the interactive form, or a nested write, when a later step depends on an earlier one.

**Example 10 — edge case: a query that escapes the transaction, and the 5-second timeout.** Inside the callback, `prisma` and `tx` look the same and have the same types. Only `tx` is bound to the transaction's connection.

typescript

```
// src/tx-edge.ts
import { prisma } from './db.ts';
import { Prisma } from './generated/prisma/client.ts';

const countComments = () => prisma.comment.count({ where: { postId: 2 } });

// Bug: one write uses `prisma` instead of `tx` inside the callback.
try {
  await prisma.$transaction(async (tx) => {
    await tx.comment.create({ data: { postId: 2, authorId: 2, body: 'via tx' } });
    await prisma.comment.create({ data: { postId: 2, authorId: 3, body: 'via prisma' } });
    console.log('inside: outside connections see', await countComments(), 'comment(s)');
    throw new Error('abort');
  });
} catch (err) {
  console.log('transaction threw:', (err as Error).message);
}
const left = await prisma.comment.findMany({ where: { postId: 2 }, select: { body: true } });
console.log('after rollback:', left);

// The default interactive timeout is 5000 ms; slow work inside the callback hits it.
try {
  await prisma.$transaction(
    async (tx) => {
      await tx.tag.create({ data: { name: 'slow' } });
      await new Promise((r) => setTimeout(r, 300)); // e.g. an HTTP call - do not do this
      await tx.tag.create({ data: { name: 'slower' } });
    },
    { timeout: 200 },
  );
} catch (err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) throw err;
  console.log('timeout:', err.code, err.message.split('\n').at(-1));
}
console.log('"slow" saved?', (await prisma.tag.findUnique({ where: { name: 'slow' } })) !== null);
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   inside: outside connections see 1 comment(s)
//   transaction threw: abort
//   after rollback: [ { body: 'via prisma' } ]
//   timeout: P2028 Transaction API error: A query cannot be executed on an expired transaction. The timeout for this transaction was 200 ms, however … ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.
//   "slow" saved? false
```

The `prisma.comment.create` call ran on a different pool connection and autocommitted at once: another connection already saw it, and it survived the rollback. In the timeout case (the elapsed time was just over 300 ms in each run), Prisma rolled back the first insert. Keep network calls and other slow work outside the callback.

**Example 11 — raw SQL: `$queryRaw` vs `$queryRawUnsafe`, and the injection difference.**

typescript

```
// src/raw.ts
import { prisma, startCounting, queries } from './logged.ts';
import { Prisma } from './generated/prisma/client.ts';

const evil = "nobody@example.com' OR '1'='1";

// $queryRaw is a tagged template: each ${} becomes a bind parameter ($1, $2, ...).
startCounting();
const safe = await prisma.$queryRaw`SELECT id, name FROM users WHERE email = ${evil}`;
console.log('$queryRaw       ->', safe, '|', queries[0]);

// $queryRawUnsafe with string concatenation: the input becomes part of the SQL text.
startCounting();
const unsafe = await prisma.$queryRawUnsafe(
  `SELECT id, name FROM users WHERE email = '${evil}' ORDER BY id`,
);
console.log('$queryRawUnsafe ->', unsafe, '|', queries[0]);

// $queryRawUnsafe is safe again if you pass the values as parameters.
const param = await prisma.$queryRawUnsafe('SELECT id, name FROM users WHERE email = $1', evil);
console.log('Unsafe + $1     ->', param);

// Building a query from pieces: Prisma.sql, Prisma.join and Prisma.empty keep values bound.
const emails = ['ada@example.com', 'grace@example.com'];
const onlyPublished = true;
startCounting();
const rows = await prisma.$queryRaw`
  SELECT u.name, count(p.id) AS posts
  FROM users u LEFT JOIN posts p ON p.author_id = u.id
  ${onlyPublished ? Prisma.sql`AND p.published = true` : Prisma.empty}
  WHERE u.email IN (${Prisma.join(emails)})
  GROUP BY u.name ORDER BY u.name`;
console.log(rows, '|', queries[0].replace(/\s+/g, ' ').trim());

// $executeRaw returns the affected row count.
console.log('updated:', await prisma.$executeRaw`UPDATE posts SET body = body || '!' WHERE published = ${true}`);
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   $queryRaw       -> [] | SELECT id, name FROM users WHERE email = $1
//   $queryRawUnsafe -> [
//     { id: 1, name: 'Ada' },
//     { id: 2, name: 'Lin' },
//     { id: 3, name: 'Grace' }
//   ] | SELECT id, name FROM users WHERE email = 'nobody@example.com' OR '1'='1' ORDER BY id
//   Unsafe + $1     -> []
//   [ { name: 'Ada', posts: 2n }, { name: 'Grace', posts: 1n } ] | SELECT u.name, count(p.id) AS posts FROM users u LEFT JOIN posts p ON p.author_id = u.id AND p.published = true WHERE u.email IN ($1,$2) GROUP BY u.name ORDER BY u.name
//   updated: 3
```

The logged SQL shows the difference. The tagged template sent `email = $1` with the whole string as a value. The concatenated string sent `OR '1'='1'` as SQL, which returned every user. Table and column names cannot be bind parameters. If one must vary, choose it from a fixed allow-list in code and use `Prisma.raw` only on that chosen constant.

**Example 12 — edge case: `count(*)` comes back as a `BigInt`, and `res.json()` throws on it.**

typescript

```
// src/bigint.ts
import { prisma } from './db.ts';

const rows = await prisma.$queryRaw<{ title: string; comments: bigint }[]>`
  SELECT p.title, count(c.id) AS comments
  FROM posts p LEFT JOIN comments c ON c.post_id = p.id
  WHERE p.id = 1 GROUP BY p.title`;
console.log(rows, typeof rows[0].comments);
try {
  console.log(JSON.stringify(rows)); // what res.json(rows) would do
} catch (err) {
  console.log(String(err));
}

// Fix: cast in SQL (int4 fits any realistic per-post count) - or use the model API's _count.
const fixed = await prisma.$queryRaw`
  SELECT p.title, count(c.id)::int AS comments
  FROM posts p LEFT JOIN comments c ON c.post_id = p.id
  WHERE p.id = 1 GROUP BY p.title`;
console.log(JSON.stringify(fixed));
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   [ { title: 'Hello SQL', comments: 2n } ] bigint
//   TypeError: Do not know how to serialize a BigInt
//   [{"title":"Hello SQL","comments":2}]
```

PostgreSQL's `count()` returns `bigint` (int8), and Prisma maps int8 to `BigInt` so it never loses precision. The model API's `_count` (Example 8) returns a plain number. The type argument `$queryRaw<…>` is only a cast: Prisma does not check it against the real columns.

**Example 13 — `migrate status` and `migrate deploy` against another database.** This simulates a staging database: an empty database that has not had any migrations applied. `DATABASE_URL` in the shell wins over `.env`.

bash

```
$ echo 'CREATE DATABASE app_staging;' | npx prisma db execute --stdin
Loaded Prisma config from prisma.config.ts.

Script executed successfully.
$ export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:6401/app_staging
$ npx prisma migrate status; echo "exit $?"
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "app_staging", schema "public" at "127.0.0.1:6401"

1 migration found in prisma/migrations
Following migration have not yet been applied:
20261012141654_init

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.
exit 1
$ npx prisma migrate deploy; echo "exit $?"
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "app_staging", schema "public" at "127.0.0.1:6401"

1 migration found in prisma/migrations

Applying migration `20261012141654_init`

The following migration(s) have been applied:

migrations/
  └─ 20261012141654_init/
    └─ migration.sql

All migrations have been successfully applied.
exit 0
$ npx prisma migrate status; echo "exit $?"
…
1 migration found in prisma/migrations

Database schema is up to date!
exit 0
```

The exit code is the useful part for CI: a deploy pipeline can run `migrate status` and fail the job while migrations are pending. Pointed at a database that did not exist yet, `migrate status` failed with `Error: P1003: Database `app_prod` does not exist`, while `migrate deploy` printed `PostgreSQL database app_prod created at 127.0.0.1:6401` and then applied the migration. The history table, read with `$queryRaw`:

typescript

```
// src/migrations-table.ts
import { prisma } from './db.ts';

// Prisma Migrate records each applied migration in this table.
const rows = await prisma.$queryRaw`
  SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, applied_steps_count
  FROM _prisma_migrations ORDER BY started_at`;
console.log(rows);
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   [
//     {
//       migration_name: '20261012141654_init',
//       checksum: 'c9bf198c166bdf10608dea3fa5034c0f200efaa31b0a89b82a1e0e916c23d5fb',
//       finished: true,
//       applied_steps_count: 1
//     }
//   ]
```

`sha256sum prisma/migrations/20261012141654_init/migration.sql` prints the same `c9bf198c…d5fb`. When one line was appended to that file after it had been applied, `migrate status` and `migrate deploy` still reported "up to date" and "No pending migrations to apply", with nothing on stderr and exit code 0. The v7 "Development and production" page says `migrate deploy` warns with `WARNING The following migrations have been modified since they were applied`, but 7.10.0 printed no such warning in this run. Only `migrate dev` noticed the changed checksum:

bash

```
$ npx prisma migrate dev --name noop
…
The migration `20261012141654_init` was modified after it was applied.
We need to reset the "public" schema at "127.0.0.1:6401"

You may use prisma migrate reset to drop the development database.
All data will be lost.
```

**Example 14 — the N+1 trap, measured.** The script loads all posts, then each post's author and comments in a loop. The query count comes from the `query` events of `logged.ts`.

typescript

```
// src/n-plus-one.ts
import { prisma, startCounting, queries } from './logged.ts';

// 1) The trap: one query for the posts, then two more per post inside the loop.
startCounting();
const posts = await prisma.post.findMany({ orderBy: { id: 'asc' } });
const loop = [];
for (const post of posts) {
  const author = await prisma.user.findUniqueOrThrow({ where: { id: post.authorId } });
  const comments = await prisma.comment.findMany({ where: { postId: post.id } });
  loop.push(`${post.title} by ${author.name}: ${comments.length} comments`);
}
console.log(loop);
console.log('loop queries:', queries.length);

// 2) The fix: ask for the relations up front with include.
startCounting();
const withRelations = await prisma.post.findMany({
  orderBy: { id: 'asc' },
  include: { author: true, comments: true },
});
console.log(withRelations.map((p) => `${p.title} by ${p.author.name}: ${p.comments.length} comments`));
console.log('include queries:', queries.length);
for (const q of queries) console.log('  ' + q.slice(0, 110) + '…');
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
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
//   include queries: 3
//     SELECT "public"."posts"."id", "public"."posts"."author_id", "public"."posts"."title", "public"."posts"."body",…
//     SELECT "public"."users"."id", "public"."users"."email", "public"."users"."name" FROM "public"."users" WHERE "p…
//     SELECT "public"."comments"."id", "public"."comments"."post_id", "public"."comments"."author_id", "public"."com…
```

The loop sends 1 + 2 × N queries: 9 for 4 posts, and it would be 2,001 for 1,000 posts. `include` sends 1 + (number of relations), here 3, whatever N is. The `relationJoins` preview feature gets this down to one statement. It was tested with a second client generated from a copy of the schema whose generator block adds `previewFeatures = ["relationJoins"]` and `output = "../src/generated/prisma-joins"` (`npx prisma generate --schema variants/joins.prisma`):

typescript

```
// src/join-strategy.ts
// Same query, client generated from variants/joins.prisma (previewFeatures = ["relationJoins"]).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma-joins/client.ts';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  log: [{ emit: 'event', level: 'query' }],
});
const queries: string[] = [];
prisma.$on('query', (e) => queries.push(e.query));

for (const relationLoadStrategy of ['query', 'join'] as const) {
  queries.length = 0;
  const posts = await prisma.post.findMany({
    relationLoadStrategy,
    orderBy: { id: 'asc' },
    include: { author: true, comments: true },
  });
  console.log(relationLoadStrategy, '->', posts.length, 'posts,', queries.length, 'query(ies)');
}
console.log(queries[0]);
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   query -> 4 posts, 3 query(ies)
//   join -> 4 posts, 1 query(ies)
//   SELECT "t0"."id", "t0"."author_id" AS "authorId", "t0"."title", "t0"."body", "t0"."published", "t0"."created_at" AS "createdAt", "Post_author"."__prisma_data__" AS "author", "Post_comments"."__prisma_data__" AS "comments" FROM "public"."posts" AS "t0" LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT('id', "t1"."id", 'email', "t1"."email", 'name', "t1"."name") AS "__prisma_data__" FROM "public"."users" AS "t1" WHERE "t0"."author_id" = "t1"."id" LIMIT $1) AS "Post_author" ON true LEFT JOIN LATERAL (SELECT COALESCE(JSONB_AGG("__prisma_data__"), '[]') AS "__prisma_data__" FROM (SELECT "t4"."__prisma_data__" FROM (SELECT JSONB_BUILD_OBJECT('id', "t3"."id", 'postId', "t3"."post_id", 'authorId', "t3"."author_id", 'body', "t3"."body", 'createdAt', "t3"."created_at") AS "__prisma_data__" FROM (SELECT "t2".* FROM "public"."comments" AS "t2" WHERE "t0"."id" = "t2"."post_id" /* root select */) AS "t3" /* inner select */) AS "t4" /* middle select */) AS "t5" /* outer select */) AS "Post_comments" ON true ORDER BY "t0"."id" ASC
```

Fewer round trips is not automatically faster: the `join` form moves the JSON building into PostgreSQL. No timings were measured here, so measure your own queries before you choose.

**Example 15 — edge case: Prisma batches `findUnique`, but only in the same tick.** Prisma's client has a dataloader that merges `findUnique` calls started together into one `IN (…)` query. It explains why some loops look cheaper than others.

typescript

```
// src/batching.ts
import { prisma, startCounting, queries } from './logged.ts';

const posts = await prisma.post.findMany({ orderBy: { id: 'asc' } });

// findUnique calls started in the same tick are batched into one query...
startCounting();
const authors = await Promise.all(
  posts.map((p) => prisma.user.findUnique({ where: { id: p.authorId } })),
);
console.log(authors.map((a) => a?.name), 'findUnique x4 in Promise.all ->', queries.length, 'query');
console.log('  ' + queries[0]);

// ...findMany calls are not.
startCounting();
await Promise.all(posts.map((p) => prisma.comment.findMany({ where: { postId: p.id } })));
console.log('findMany x4 in Promise.all ->', queries.length, 'queries');

// And awaiting findUnique one by one gets no batching either.
startCounting();
for (const p of posts) await prisma.user.findUnique({ where: { id: p.authorId } });
console.log('findUnique x4 awaited in a loop ->', queries.length, 'queries');
await prisma.$disconnect();

// Real output (Node v24.19.0, Prisma 7.10.0, PostgreSQL 18.4):
//   [ 'Ada', 'Ada', 'Lin', 'Grace' ] findUnique x4 in Promise.all -> 1 query
//     SELECT "public"."users"."id", "public"."users"."email", "public"."users"."name" FROM "public"."users" WHERE "public"."users"."id" IN ($1,$2,$3,$4) OFFSET $5
//   findMany x4 in Promise.all -> 4 queries
//   findUnique x4 awaited in a loop -> 4 queries
```

This is what makes GraphQL resolvers that call `findUnique` per parent workable. It does nothing for the `for … await` loop in Example 14.

## Common mistakes & gotchas

- **Installing `latest` without pinning.** On 12 Oct 2026 `npm i prisma @prisma/client` gives CLI 8.0.0-rc.22 with client 7.10.0. Pin both with `-E` to the same stable version.
- **Following a Prisma 6 tutorial on v7.** `import { PrismaClient } from '@prisma/client'`, `new PrismaClient()` without an adapter, `url = env("DATABASE_URL")` in the datasource block, and expecting `migrate dev` to generate and seed all belong to v6. In v7 you import from your `output` path, pass an adapter, put the URL in `prisma.config.ts`, and run `generate` and `db seed` yourself.
- **Expecting the CLI to read `.env`.** Prisma 7 does not load it; `prisma.config.ts` must `import 'dotenv/config'`. A variable already set in the shell wins over `.env`.
- **Using `prisma` instead of `tx` inside an interactive transaction.** The query runs on another connection, commits at once, and survives the rollback (Example 10). TypeScript cannot catch it, because both have the same type.
- **Slow work inside `$transaction(async tx => …)`.** The callback holds a connection and row locks. After 5 s by default, Prisma rolls back with `P2028`. Fetch from other services before the transaction starts.
- **Concatenating input into `$queryRawUnsafe` / `$executeRawUnsafe`.** That is SQL injection (Example 11). Use the tagged template, or pass values as `$1…` arguments.
- **Sending raw `count(*)` results to `res.json()`.** They are `BigInt`s and `JSON.stringify` throws. Cast to `::int` in SQL or use `_count`.
- **Assuming `include` is one JOIN.** By default it is one query per relation level. Look at the `query` log before you guess about performance.
- **Implicit many-to-many when the table name matters.** Prisma names the join table `_PostToTag` (or `_<relation name>`) with columns `A`/`B`. Use an explicit join model with `@@map` for a named table such as `post_tags`.
- **Editing a migration that has already been applied.** In 7.10.0, `deploy` and `status` reported nothing (Example 13), so the edit silently never runs on databases that already applied the original. `migrate dev` then wants to reset your dev database. Write a new migration instead.
- **Counting queries from the log and trusting the total.** In 7.10.0 the `BEGIN` of an implicit transaction is not emitted as a `query` event, but `COMMIT`/`ROLLBACK` are.

## Best practices

- **Pin `prisma`, `@prisma/client` and `@prisma/adapter-pg` to one exact stable version,** and upgrade them together.
- **Create one `PrismaClient` per process** in a module (`src/db.ts`) and import it everywhere. Each client owns a `pg` pool; see lesson 74 for pool sizing.
- **Commit `prisma/migrations/` and `migration_lock.toml`.** Run `migrate dev` only in development and `migrate deploy` in CI or at release, and gate on `migrate status`'s exit code.
- **Review every generated `migration.sql` before you commit it,** especially for renames. Renaming `title` to `heading` in the schema produced `ALTER TABLE "posts" DROP COLUMN "title", ADD COLUMN "heading" TEXT NOT NULL;` (checked with `prisma migrate diff`). That loses the data, and on a table with rows the `NOT NULL` column cannot even be added. Generate with `migrate dev --create-only`, change it to `RENAME COLUMN`, then apply.
- **Use `select` to fetch only the columns you need,** and `_count` for counts, instead of loading whole relations to call `.length`.
- **Turn on `log: [{ emit: 'event', level: 'query' }]` in tests** and assert query counts for hot endpoints, so an N+1 regression fails a test.
- **Keep interactive transactions short and pure-database.** Pass `tx` into helper functions explicitly so nothing inside can reach for the global client.
- **Use `$queryRaw` tagged templates for SQL the client cannot express** (window functions, CTEs), and cast aggregates to the type you want to send.
- **Make the seed idempotent** (truncate or upsert), so `prisma db seed` can run any number of times.

## ⭐ Interview lens

> **Q: “What does Prisma generate, and what happens at runtime when you call `findMany` with `include`?”**  
> A: `prisma generate` writes a typed client from `schema.prisma`, in v7 into the `output` folder you choose. At runtime the client validates the arguments, an in-process WebAssembly query compiler builds SQL with bind parameters, and the driver adapter (`@prisma/adapter-pg` over `pg`) sends it. With the default `query` strategy, `include` becomes one SELECT for the parents plus one `WHERE fk IN (…)` SELECT per relation, and Prisma joins the results in JavaScript. *Trap:* saying "it does a JOIN". That is only true with the `relationJoins` preview and `relationLoadStrategy: "join"`.

> **Q: “`$transaction([…])` vs `$transaction(async tx => …)` — when do you use which?”**  
> A: The array form runs independent queries in one transaction, so all commit or none do, but no query can use another's result. The interactive form holds one connection for a callback, so you can read, branch in JS and write, and a throw rolls back. It has a 5 s default timeout, and every query must use `tx`. A query on the global client escapes the transaction. For "create a parent and its children", a nested write is simpler than either.

> **Q: “How do you prevent SQL injection with Prisma raw queries?”**  
> A: Use `$queryRaw` / `$executeRaw` as tagged templates: each `${}` becomes a bind parameter. Use `Prisma.sql`, `Prisma.join` and `Prisma.empty` to build dynamic parts. With `$queryRawUnsafe`, pass values as extra arguments for `$1, $2`, never by string concatenation. Identifiers cannot be parameters, so pick them from an allow-list.

> **Q: “How do you find and fix an N+1 problem in a Prisma app?”**  
> A: Log queries with `log: [{ emit: 'event', level: 'query' }]` and count them per request. A loop of `findMany`/`findUnique` per row shows up as 1 + N × k statements. Fix it with `include`/`select` (a constant number of queries), an `IN` query you join yourself, or `relationLoadStrategy: "join"` where the preview is enabled. Note that `findUnique` calls started together in `Promise.all` are batched by Prisma's dataloader, but sequential awaits are not.

> **Q: “What changed in Prisma 7 that breaks old setups?”**  
> A: There is a new `prisma-client` generator with a required `output`, so you import from your own path. Driver adapters are mandatory. CLI settings, including the database URL, move to `prisma.config.ts`, and `.env` is no longer auto-loaded. The package is ESM. `migrate dev` no longer runs `generate` or the seed. Pool behaviour now comes from `pg`, including no default connection timeout.

## Cheat-card

- **Versions used:** Prisma 7.10.0 (stable; npm `latest` for `prisma` is 8.0.0-rc.22), pg 8.23.1, Node v24.19.0, TypeScript 7.0.2, PostgreSQL 18.4.
- **v7 setup:** `generator client { provider = "prisma-client"  output = "../src/generated/prisma" }`; `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`; URL and seed in `prisma.config.ts` with `import 'dotenv/config'`.
- **Config file name:** 7.10.0 `init` writes `prisma7.config.ts`; `prisma.config.ts` still loads as a fallback.
- **Mapping:** `@@map("posts")` for the table, `@map("author_id")` for the column, `@db.Timestamptz` for `timestamptz`; explicit join model for `post_tags`.
- **Workflow:** `migrate dev --name x` → `generate` → `db seed`; prod: `migrate deploy`; CI gate: `migrate status` (exit 1 when pending).
- **Reads:** `include` = whole relation, `select` = named fields, `_count` = SQL aggregate; default strategy is one query per relation level.
- **Transactions:** `$transaction([a, b])` all-or-nothing; `$transaction(async tx => …)` interactive, use `tx` only, `timeout` 5000 / `maxWait` 2000 by default; timeout → `P2028`.
- **Errors:** `P2002` unique violation, `P2025` record not found; check `instanceof Prisma.PrismaClientKnownRequestError`.
- **Raw:** `` $queryRaw`… ${v}` `` = bound; `$queryRawUnsafe(str)` with concatenation = injectable; `count()` → `BigInt`.
- **N+1 measured:** loop 9 queries vs `include` 3 vs `relationLoadStrategy: "join"` 1 (4 posts, `author` + `comments`).

---

## Learn More

- [Upgrade to Prisma ORM 7 prisma.io](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
- [Generators (prisma-client) prisma.io](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators)
- [Prisma Config reference prisma.io](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference)
- [Many-to-many relations prisma.io](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/many-to-many-relations)
- [Transactions and batch queries prisma.io](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)
- [Raw queries prisma.io](https://www.prisma.io/docs/orm/v7/prisma-client/using-raw-sql/raw-queries)
- [Query optimization (n+1) prisma.io](https://www.prisma.io/docs/orm/v7/prisma-client/queries/advanced/query-optimization-performance)
- [Logging prisma.io](https://www.prisma.io/docs/orm/v7/prisma-client/observability-and-logging/logging)
- [Seeding prisma.io](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding)
- [Development and production (migrate dev / deploy) prisma.io](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production)
- [Prisma ORM 7.10.0 release notes github.com](https://github.com/prisma/orm/releases/tag/7.10.0)
