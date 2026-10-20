---
title: "SQL Basics from Node"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/sql-basics
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# SQL Basics from Node

*9 min read · Updated 24 Jul 2026 Topic 45 of 70 Bookmark Mark done Why it matters Not every backend should use MongoDB · Topic 45 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/sql-basics](https://www.geekyfrontend.in/learn/nodejs-backend-kit/sql-basics)

---

## Why it matters

Not every backend should use MongoDB. A huge share of the industry — banking, e-commerce, anything with money, reporting, or strict relationships — runs on **relational (SQL) databases** like PostgreSQL and MySQL. As a Node developer you will absolutely be asked to talk to one, usually through the `pg` (node-postgres) or `mysql2` driver. And in interviews, "SQL vs NoSQL — which would you pick and why?" is one of the most common system-design openers there is. A weak answer ("Mongo is faster") tanks the conversation; a strong one shows you understand tradeoffs.

SQL also forces you to confront things a document store lets you gloss over: schemas as contracts, JOINs across tables, foreign keys, and real ACID transactions. Even if your day job is Mongo, understanding the relational model makes you a sharper data modeler everywhere. This topic gives you the working knowledge to query Postgres from Node safely and to reason about which database fits a problem.

## The concept, simply

A relational database stores data in **tables** made of **rows** and fixed **columns**, each column with a declared type. Tables relate to each other through **keys**: a *primary key* uniquely identifies a row, and a *foreign key* in one table points at the primary key of another. You retrieve and combine data with **SQL** (Structured Query Language) — a declarative language where you describe *what* you want and the database's query planner figures out *how*.

![Relational tables with users and orders joined by a foreign key on the left versus a nested MongoDB document on the right](assets/i42_01_2e6040e8.svg)

SQL splits data into typed tables joined by keys; document stores nest related data into one flexible aggregate.

The essential contrast with NoSQL: SQL enforces a **fixed schema** and pushes relationships into **JOINs** resolved at query time, giving you strong consistency and integrity. Document stores keep related data together and stay flexible, trading some integrity for scale and developer speed.

## How it works (deep)

SQL has a handful of core statement types. `SELECT` reads (with `WHERE` to filter, `ORDER BY` to sort, `LIMIT`/`OFFSET` to page, `GROUP BY` plus aggregates like `COUNT`/`SUM` to summarise). `INSERT`, `UPDATE`, and `DELETE` write. `CREATE TABLE` and `ALTER TABLE` define structure. The declarative nature matters: you never write loops; you state a set-based condition and the planner picks indexes and join strategies.

A **JOIN** combines rows from two tables on a matching condition. `INNER JOIN` keeps only rows with a match on both sides. `LEFT JOIN` keeps every row from the left table and fills `NULL` where the right side has no match (essential for "users and their orders, including users with zero orders"). `RIGHT` and `FULL OUTER` joins mirror that. Understanding INNER vs LEFT is a near-guaranteed interview question because the wrong one silently drops rows.

From Node, you connect with a driver. `pg` gives you a `Pool` (recommended) whose `pool.query()` borrows a connection, runs your SQL, and returns it automatically. The single most important safety rule is **parameterised queries**: never build SQL by string concatenation. You pass placeholders (`$1`, `$2` in Postgres; `?` in mysql2) and an array of values; the driver sends the query text and the data *separately*, so a value like `' OR 1=1 --` is treated as data, not code. This is how you prevent **SQL injection**, the most classic and dangerous web vulnerability.

**When to use which?** Reach for SQL when you have well-structured data with clear relationships, need strong consistency and multi-row ACID transactions (money, inventory, bookings), do a lot of ad-hoc reporting/aggregation, or must guarantee referential integrity. Reach for a document store when your data is self-contained aggregates, the schema evolves fast, you need to scale writes horizontally across shards, or the shape is naturally hierarchical (a product with wildly varying attributes). Modern reality: many systems use **both** (polyglot persistence), and Postgres even has a strong `jsonb` type that blurs the line.

## Code examples

Setting up a pool and running a safe, parameterised query with node-postgres:

javascript

```
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  database: 'shop',
  max: 10,                 // pool size
  idleTimeoutMillis: 30000
});

// PARAMETERISED - safe from SQL injection.
async function findUser(email) {
  const { rows } = await pool.query(
    'SELECT id, name, email FROM users WHERE email = $1',
    [email]                // values passed separately from SQL text
  );
  return rows[0] ?? null;  // rows is an array
}
```

The SQL itself — schema, insert, and a JOIN across two tables:

sql

```
CREATE TABLE users (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL
);

CREATE TABLE orders (
  id      SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),  -- foreign key
  total   NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Every user with their order count (LEFT JOIN keeps users with 0 orders)
SELECT u.id, u.name, COUNT(o.id) AS order_count, COALESCE(SUM(o.total), 0) AS spent
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.name
ORDER BY spent DESC
LIMIT 20;
```

INSERT returning the new row, plus UPDATE and DELETE from Node:

javascript

```
// INSERT ... RETURNING gives you the generated id back in one round trip
const { rows } = await pool.query(
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email',
  ['Ada', 'ada@x.com']
);
const newId = rows[0].id;   // rows[0] → { id: 1, name: 'Ada', email: 'ada@x.com' }
// (RETURNING may only name columns the table has — `users` above has no created_at;
//  asking for it fails with: column "created_at" does not exist, code 42703)

await pool.query(
  'UPDATE orders SET total = total * 1.1 WHERE user_id = $1',
  [newId]
);

const res = await pool.query('DELETE FROM users WHERE id = $1', [newId]);
console.log(res.rowCount);   // how many rows were affected
```

The wrong way — string concatenation — and why it is dangerous:

javascript

```
// NEVER DO THIS - open to SQL injection:
const email = req.query.email; // e.g. "x' OR '1'='1"
const bad = await pool.query(
  `SELECT * FROM users WHERE email = '${email}'` // injectable!
);
// The attacker's input becomes part of the SQL and can dump the table.
// Always use $1 placeholders instead (see findUser above).
```

## Common mistakes & gotchas

- **String-concatenating user input into SQL.** This is the #1 web vulnerability (SQL injection). Always use `$1`/`?` parameterised placeholders.
- **Using `INNER JOIN` when you meant `LEFT JOIN`.** Inner join silently drops parent rows that have no children (users with zero orders vanish from the report).
- **Forgetting `WHERE` on `UPDATE`/`DELETE`.** `DELETE FROM users;` wipes the whole table. There is no undo without a backup.
- **Assuming `rows` is a single object.** `pg` returns `{ rows: [...] }` — an array. Read `rows[0]` for a single record.
- **Mishandling `NULL`.** `column = NULL` is never true; use `IS NULL`/`IS NOT NULL`. Aggregates like `SUM` ignore NULLs, so wrap with `COALESCE`.
- **Selecting `*` everywhere.** It fetches columns you do not need, breaks when the schema changes, and prevents covering indexes. Name your columns.
- **N+1 queries.** Looping over users and querying orders per user is slow; do one JOIN or an `IN (...)` query.

## Best practices

- Always use parameterised queries; treat any concatenated SQL as a security bug in review.
- Use a `Pool`, not one-off `Client` connections per request, and let it manage reuse (covered in the next topic).
- Prefer explicit column lists over `SELECT *`; it is faster, clearer, and index-friendly.
- Add indexes on foreign keys and columns you filter/sort on; check plans with `EXPLAIN ANALYZE`.
- Use `INSERT ... RETURNING` to get generated ids in one round trip instead of a follow-up SELECT.
- Push filtering, sorting, and aggregation into SQL rather than pulling rows into Node and processing them — the database is far better at it.
- Pick the database from the problem: relational integrity and transactions → SQL; flexible self-contained aggregates and horizontal scale → document store; often both.

## ⭐ Interview lens

> **Q: SQL vs NoSQL — when would you choose each?**  
> SQL for structured, related data needing strong consistency, multi-row ACID transactions, and rich ad-hoc queries/joins (finance, inventory, bookings). Document/NoSQL for self-contained aggregates, rapidly evolving schemas, hierarchical data, and horizontal write scale. The mature answer notes it is not either/or — polyglot persistence is common, and Postgres `jsonb` gives document-style flexibility inside a relational engine.

> **Q: What is SQL injection and how do you prevent it?**  
> An attack where user input is concatenated into SQL and executed as code, letting an attacker read or destroy data. Prevention is parameterised queries: send the SQL text and the values separately (`$1` in pg, `?` in mysql2) so values are always treated as data. ORMs/query builders do this for you; never build SQL with template strings around user input.

> **Q: INNER JOIN vs LEFT JOIN?**  
> INNER JOIN returns only rows with a match in both tables. LEFT JOIN returns every row from the left table and NULLs where the right has no match. The classic trap: "list all users and their order totals" — INNER JOIN silently omits users with zero orders, so you need LEFT JOIN (plus `COALESCE` to turn NULL sums into 0).

> **Q: What is a foreign key and what does it give you?**  
> A column that references another table's primary key, declaring a relationship the database enforces — you cannot insert an order for a non-existent user, and (with cascade rules) deletes can propagate. It provides *referential integrity*, a guarantee document stores generally leave to application code.

> **Q: Why prefer a Pool over creating a Client per request?**  
> Opening a TCP connection and authenticating to Postgres is expensive (tens of milliseconds). A pool keeps a set of connections open and hands them out, so requests reuse warm connections instead of paying setup cost each time, and it caps total connections so you do not overwhelm the database. Per-request clients exhaust connection limits under load.

> **Q: How does NULL behave in SQL comparisons and aggregates?**  
> NULL means "unknown", so any comparison with it (`= NULL`, `<> NULL`) yields NULL (not true) — you must use `IS NULL`/`IS NOT NULL`. Aggregates like `COUNT(col)`, `SUM`, and `AVG` skip NULLs, which is why a sum over no rows returns NULL and you wrap it in `COALESCE(..., 0)`.

## Cheat-card

- **Model:** tables → rows → typed columns; primary key + foreign key relate tables.
- **Drivers:** `pg` (Postgres, `$1` params), `mysql2` (`?` params).
- **Safety:** parameterised queries always — never concatenate user input.
- **Joins:** INNER = matches only; LEFT = keep all left rows, NULL the rest.
- **pg result:** `{ rows: [...], rowCount }`; use `RETURNING` for new ids.
- **NULL:** use `IS NULL`; wrap aggregates in `COALESCE`.
- **Choose SQL** for integrity + transactions; **document** for flexible aggregates + scale.
- **Next lessons:** 101 Prisma, 102 Drizzle, 103 Sequelize + TypeORM, 104 Knex, 105 migrations and seeding, 106 choosing raw SQL vs builder vs ORM.
- **RETURNING:** one row per row written; `ON CONFLICT DO NOTHING` on a duplicate returns `rows: []`; an unknown column fails the whole statement (`42703`).

---

## Learn More

- [node-postgres — PostgreSQL client for Node.js node-postgres.com](https://node-postgres.com/)
- [The SQL Language (PostgreSQL Tutorial, Chapter 2) www.postgresql.org](https://www.postgresql.org/docs/current/tutorial-sql.html)
- [MySQL 8.0 Reference Manual: Tutorial dev.mysql.com](https://dev.mysql.com/doc/refman/8.0/en/tutorial.html)
- [SQL Tutorial - Full Database Course for Beginners freeCodeCamp.org](https://www.youtube.com/watch?v=HXV3zeQKqGY)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and PostgreSQL 18.4 (run locally via the embedded-postgres npm package, no Docker), pg 8.23.1*

### Where to go next: lessons 76–81

This lesson talks to PostgreSQL through the `pg` driver: you write the SQL text and pass the values separately. Real projects add two more things on top. The first is a **data-access layer**: a query builder or an ORM that writes some of the SQL for you. The second is **migrations**: versioned files that change the schema the same way in every environment. Without migrations, `CREATE TABLE` and `ALTER TABLE` get run by hand, and your laptop, staging and production end up with different schemas. Lessons 76–81 build one shared blog schema (users, posts, comments, tags) with each tool and run the same query in each, so you can compare them directly.

How it works (what each lesson covers):

1. [Prisma ORM](77-prisma-orm.md) (101): a `schema.prisma` file, the generated type-safe client, relations and Prisma Migrate.
2. [Drizzle ORM](78-drizzle-orm.md) (102): the schema written in TypeScript, a SQL-like query builder with inferred types, and drizzle-kit migrations.
3. [Sequelize and TypeORM](79-sequelize-and-typeorm.md) (103): models and entities, associations, and their migration tools (sequelize-cli/Umzug, TypeORM migrations).
4. [Knex query builder](76-knex-query-builder.md) (104): building SQL from function calls, transactions, Knex migrations and seed files.
5. [Database Migrations and Seeding](80-database-migrations-and-seeding.md) (105): migration history tables, up and down migrations with node-pg-migrate, and safe production changes on a 2-million-row table: `NOT VALID` + `VALIDATE`, `CREATE INDEX CONCURRENTLY`, `lock_timeout` and expand-and-contract. Also seed data vs test fixtures.
6. [Choosing Between Raw SQL, a Query Builder and an ORM](81-choosing-raw-sql-query-builder-or-orm.md) (106): a decision table covering type safety, SQL visibility, migrations and escape hatches; the canonical query in raw `pg`; and `node:sqlite` as a zero-dependency option.

All of them still send parameterised SQL like the examples above. The rules from this lesson (placeholders, explicit columns, `RETURNING`, `LEFT JOIN` vs `INNER JOIN`) apply whichever layer you pick.

**Example — this lesson's schema and INSERT … RETURNING block, run through `pg`.**

javascript

```
// returning.mjs — this lesson's schema and INSERT … RETURNING block, run once (pg 8.23.1)
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

await pool.query(`
  DROP TABLE IF EXISTS orders, users;
  CREATE TABLE users  (id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL);
  CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
                       total NUMERIC(10,2) NOT NULL, created_at TIMESTAMPTZ DEFAULT now());`);

// INSERT ... RETURNING gives you the generated id back in one round trip
const { rows } = await pool.query(
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email',
  ['Ada', 'ada@x.com']
);
console.log('inserted:', rows[0]);
const newId = rows[0].id;

const upd = await pool.query('UPDATE orders SET total = total * 1.1 WHERE user_id = $1', [newId]);
console.log('UPDATE rowCount:', upd.rowCount, '(Ada has no orders yet)');

// RETURNING may only name columns the table has: users has no created_at.
try {
  await pool.query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, created_at', ['Lin', 'lin@x.com']);
} catch (e) { console.log('RETURNING created_at:', e.message, `(code ${e.code})`); }

const res = await pool.query('DELETE FROM users WHERE id = $1', [newId]);
console.log('DELETE rowCount:', res.rowCount);
await pool.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   inserted: { id: 1, name: 'Ada', email: 'ada@x.com' }
//   UPDATE rowCount: 0 (Ada has no orders yet)
//   RETURNING created_at: column "created_at" does not exist (code 42703)
//   DELETE rowCount: 1
```

bash

```
$ npm install pg@8.23.1
$ DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6651/shop node returning.mjs
```

The failed `RETURNING created_at` insert did not add Lin. PostgreSQL rejects the statement while it is still checking column names, before any row is written.

### Common mistakes & gotchas (additional topics)

- **Naming a column in `RETURNING` that the table does not have.** The whole `INSERT` fails with `42703`, not just the `RETURNING` part. `RETURNING *` avoids the typo but sends every column, including ones added later.
- **Assuming `RETURNING` always returns a row.** It returns one row per row actually written. An `UPDATE`/`DELETE` that matches nothing, or an `INSERT … ON CONFLICT DO NOTHING` that hits a duplicate, returns `rows: []` (see the edge case below).
- **Picking an ORM before knowing the SQL it should produce.** Lessons 76–79 all log their generated SQL. Compare it with the SQL you would write by hand, using the patterns from this lesson.

### Edge case worked through: `ON CONFLICT DO NOTHING RETURNING` gives no row on a duplicate

Run after the example above, on the same `shop` database.

javascript

```
// returning-conflict.mjs — RETURNING with ON CONFLICT DO NOTHING returns no row on a duplicate
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const insert = (name, email) => pool.query(
  'INSERT INTO users (name, email) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING id, name, email',
  [name, email]);

const first = await insert('Grace', 'grace@x.com');
console.log('first :', first.rows, 'rowCount', first.rowCount);
const second = await insert('Grace H', 'grace@x.com');
console.log('second:', second.rows, 'rowCount', second.rowCount);
try { console.log(second.rows[0].id); } catch (e) { console.log('second.rows[0].id ->', e.constructor.name, e.message); }

// Fix: upsert-and-return, or fall back to a SELECT when nothing came back.
const row = second.rows[0] ??
  (await pool.query('SELECT id, name, email FROM users WHERE email = $1', ['grace@x.com'])).rows[0];
console.log('existing row:', row);
await pool.end();

// Real output (Node v24.19.0, pg 8.23.1, PostgreSQL 18.4):
//   first : [ { id: 2, name: 'Grace', email: 'grace@x.com' } ] rowCount 1
//   second: [] rowCount 0
//   second.rows[0].id -> TypeError Cannot read properties of undefined (reading 'id')
//   existing row: { id: 2, name: 'Grace', email: 'grace@x.com' }
```

1. The first insert writes Grace, and `RETURNING` gives back her row.
2. The second insert hits the UNIQUE constraint on `email`. `DO NOTHING` skips it without an error, so no row is written and none is returned.
3. Code that assumes `rows[0]` exists then throws a `TypeError` far from the SQL. Check `rowCount`, or fall back to a `SELECT` as shown.

Grace's id is 2, not 3: Lin's insert failed before it reached the `serial` sequence, so it did not use up an id. The skipped duplicate did not change the existing row either. To write the new name, use `ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING …`, which returns the updated row.

### ⭐ Interview lens (additional topics)

> **Q: “Why use `INSERT … RETURNING` instead of an INSERT followed by a SELECT?”**  
> A: It is one round trip, and it returns exactly the row that statement wrote, including generated values such as the `serial` id and defaults. A follow-up `SELECT … ORDER BY id DESC LIMIT 1` can pick up another session's row under concurrency. Name the columns you need (`RETURNING id, name, email`). *Trap:* with `ON CONFLICT DO NOTHING`, a duplicate returns no row at all.

> **Q: “Your team is choosing between raw SQL, Knex, Drizzle and Prisma. What do you compare?”**  
> A: Type safety (does the compiler check columns and results?), whether you can see the SQL that runs, how migrations are written and applied, the learning cost, and the raw-SQL escape hatch for queries the tool cannot express. Lesson 81 has the table, and lessons 76–80 show each tool on the same schema.
