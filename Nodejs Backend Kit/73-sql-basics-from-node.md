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

## Say it in 30 seconds

A relational database stores rows in tables with fixed, typed columns, and you ask for data with SQL, a language where you describe the set you want and the planner decides how to fetch it. Tables point at each other with keys: a primary key identifies a row, and a foreign key is a column that must match a primary key in another table. From Node you send the SQL text and the values separately, through a driver such as `pg`. The trade-off against a document store is that you join at read time and you get the database to enforce those relationships for you.

## Why it matters

A large share of backends, anything with money, reporting, or strict relationships, runs on PostgreSQL or MySQL. As a Node developer you talk to them through `pg` or `mysql2`. "SQL or a document store, and why?" is a standard system-design opener. "Mongo is faster" ends the conversation. A useful answer names consistency, joins, and the shape of the data.

SQL also forces schemas as contracts, joins, foreign keys, and multi-row transactions. Even if your day job is Mongo, that model makes you more careful about data everywhere.

## The concept, simply

A relational database stores **tables** of **rows** and fixed **columns**, each column with a declared type. A **primary key** identifies a row. A **foreign key** in one table points at the primary key of another, and the database rejects a row that points at nothing. **SQL**, structured query language, is declarative: you say what set you want, and the query planner chooses indexes and join strategies.

![Relational tables with users and orders joined by a foreign key on the left versus a nested MongoDB document on the right](assets/i42_01_2e6040e8.svg)

SQL splits data into typed tables joined by keys. A document store nests related data into one document.

The contrast: SQL enforces a fixed schema and resolves relationships with joins at query time, which gives you integrity and strong consistency. A document store keeps related data together and stays flexible, and it leaves more of that integrity to your application.

## How it works (deep)

`SELECT` reads. `WHERE` filters, `ORDER BY` sorts, `LIMIT` and `OFFSET` page, and `GROUP BY` with `COUNT` or `SUM` summarises. `INSERT`, `UPDATE`, and `DELETE` write. `CREATE TABLE` and `ALTER TABLE` define structure. You do not write a loop. You state a condition on a set.

A **join** combines rows from two tables on a match. `INNER JOIN` keeps only rows that match on both sides. `LEFT JOIN` keeps every row from the left table and fills `NULL` where the right side has no match. That is how you list users and their orders, including users with zero orders. `RIGHT JOIN` and `FULL OUTER JOIN` are the mirror. The wrong join silently drops rows.

From Node, `pg` gives you a `Pool`. `pool.query()` borrows a connection, runs the SQL, and returns the connection. The safety rule is **parameterised queries**. You never build SQL by gluing strings. You pass placeholders, `$1` and `$2` in Postgres, `?` in mysql2, and a separate array of values. The driver sends the text and the data separately, so a value such as `' OR 1=1 --` is data, not code. That is how you prevent **SQL injection**, which is user input executed as SQL.

Reach for SQL when the data has clear relationships, you need multi-row transactions (money, inventory, bookings), you do a lot of ad-hoc reporting, or a foreign key must be enforced. Reach for a document store when the data is a self-contained aggregate, the schema changes often, you need to scale writes across shards, or the shape is naturally a tree of varying attributes. Many systems use both. Postgres also has `jsonb`, so a relational database can store a document-shaped column.

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

- **Gluing user input into SQL.** That is SQL injection. Use `$1` or `?` placeholders.
- **`INNER JOIN` when you meant `LEFT JOIN`.** Users with zero orders vanish from the report.
- **`UPDATE` or `DELETE` with no `WHERE`.** `DELETE FROM users` wipes the table.
- **Treating `rows` as one object.** `pg` returns `{ rows: [...] }`. Read `rows[0]` for one record.
- **Comparing with `= NULL`.** That comparison is never true. Use `IS NULL` or `IS NOT NULL`. `SUM` ignores nulls, so wrap it in `COALESCE`.
- **`SELECT *` everywhere.** You fetch columns you do not need, and you block a covering index. Name the columns.
- **A query per row.** Looping over users and querying orders for each is the N+1 problem. Use one join or one `IN` list.

## Best practices

- Parameterised queries only. A concatenated SQL string is a review bug.
- Use a `Pool`, not a new `Client` per request (lesson 74).
- Name columns instead of `SELECT *`.
- Index foreign keys and the columns you filter or sort on. Read plans with `EXPLAIN ANALYZE`.
- Use `INSERT ... RETURNING` to get generated ids in the same round trip.
- Filter, sort, and aggregate in SQL. Do not pull the table into Node to do it.
- Pick the database from the problem. Integrity and transactions point to SQL. Flexible aggregates and horizontal write scale point to a document store. Often you want both.

## ⭐ Interview lens

> **Q: SQL vs NoSQL — when would you choose each?**  
> Choose a relational database when the data is structured, rows point at other rows, and a partial write would be wrong. Money, inventory, and bookings want multi-row transactions, foreign keys, and ad-hoc reports with joins. Choose a document store when one screen is one self-contained document, the shape changes often, or you need to spread writes across shards. For example, an order total that must match its line items and a payment row is a SQL transaction. A product with a different set of attributes per category is a natural document. The limit of treating this as a contest is that many systems use both, and Postgres `jsonb` stores a document-shaped value inside a relational table when only one column is flexible. "Mongo is faster" skips the question, which is about integrity and access patterns.

> **Q: What is SQL injection and how do you prevent it?**  
> SQL injection is user input concatenated into the query text so the database executes it as SQL. A value such as `' OR 1=1 --` can change a login check into a condition that is always true, or a later statement can read or delete rows. Prevention is a parameterised query: the SQL text contains placeholders, `$1` and `$2` with `pg`, `?` with mysql2, and the values travel in a separate array. The driver sends text and data apart, so the value cannot close a quote and become syntax. For example, `pool.query('SELECT * FROM users WHERE email = $1', [email])` treats whatever is in `email` as a string to compare. The limit is dynamic identifiers. A placeholder cannot be a column name or a sort field. Those still have to come from an allow-list you wrote, not from the request.

> **Q: INNER JOIN vs LEFT JOIN?**  
> An inner join returns only rows that have a match in both tables. A left join returns every row from the left table, and where the right table has no match the right-hand columns are `NULL`. The left table is the one you name first. For example, "all users and their order totals" with an inner join drops every user who has never ordered, and the report looks like those people do not exist. A left join keeps them, and `COALESCE` turns the null sum into 0. The limit is the opposite mistake: a left join when you only wanted matches inflates the report with empty rows, and a missing `WHERE` on the outer side can turn the join back into an inner join by rejecting the nulls. Say which table is preserved, and what a missing match should show.

> **Q: What is a foreign key and what does it give you?**  
> A foreign key is a column that references another table's primary key. The database checks it on write. You cannot insert an order whose `user_id` matches no user, and with a cascade rule a delete of the user can delete or block the orders. That guarantee is referential integrity: the relationship is enforced by the storage engine, not by a hope that every code path remembered the check. For example, two app instances cannot race an order in for a user who was just deleted, because the insert fails in the database. The limit is that a document store generally does not do this for you. An `ObjectId` stored on an order is a convention unless your application, or a transaction, checks that the user exists.

## Cheat-card

- Tables, rows, typed columns. A primary key identifies a row. A foreign key points at one.
- `pg` uses `$1` placeholders. `mysql2` uses `?`.
- Never concatenate user input into SQL.
- Inner join keeps matches. Left join keeps every left row and nulls the rest.
- `pg` returns `{ rows, rowCount }`. Use `RETURNING` for new ids.
- `NULL` is unknown. Compare with `IS NULL`. Wrap aggregates in `COALESCE`.
- SQL when you need integrity and transactions. A document store when the aggregate is flexible and you need to scale writes out.

## Good to know

- `RETURNING` gives one row per row actually written. `ON CONFLICT DO NOTHING` on a duplicate returns `rows: []`. An unknown column name fails the whole statement with SQLSTATE `42703`, before any row is written.
- Next lessons, on one shared blog schema: Prisma (77), Drizzle (78), Sequelize and TypeORM (79), Knex (76), migrations and seeding (80), and choosing raw SQL, a builder, or an ORM (81).
- Q: Why prefer a pool over a new client per request? Opening a TCP connection and authenticating is tens of milliseconds. A pool keeps connections open and reuses them, and it caps how many exist so you do not pass the database's connection limit. A client per request exhausts that limit under load. Lesson 74 is the detail.
- Q: How does NULL behave? NULL means unknown, so `= NULL` and `<> NULL` are not true. Use `IS NULL` and `IS NOT NULL`. `COUNT(col)`, `SUM`, and `AVG` skip nulls, which is why a sum over no rows is null and you wrap it in `COALESCE(..., 0)`.
- Q: Why `INSERT … RETURNING` instead of insert plus a select? It is one round trip, and it returns the row that statement wrote, including a `serial` id and defaults. A follow-up `SELECT … ORDER BY id DESC LIMIT 1` can pick up another session's row. Name the columns. With `ON CONFLICT DO NOTHING`, a duplicate returns no row, so check `rowCount`.
- Q: Raw SQL, Knex, Drizzle, or Prisma? Compare whether the compiler checks columns and results, whether you can see the SQL, how migrations are written, the learning cost, and the escape hatch for a query the tool cannot express. Lesson 81 has the table. Lessons 76 to 80 run the same schema on each tool.

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

The questions from this section are under Good to know, one line each.
