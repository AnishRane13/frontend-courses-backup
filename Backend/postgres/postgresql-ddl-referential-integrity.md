# PostgreSQL Database & Table Creation, Constraints, and Referential Integrity
*A deep-dive reference: the theory behind every constraint, not just the syntax for writing one*

This document is written for a developer who already knows how to write `REFERENCES` and `NOT NULL` in a `CREATE TABLE` statement, and wants to go further: to actually understand *why* these mechanisms exist, *how* Postgres enforces them internally, and to be able to defend a schema design decision out loud, the way you would in a system design interview. Every concept below is treated with the same seven-part structure: the underlying theory, the full syntax, a runnable example, what Postgres actually does internally, a real failing query with its real error message, when to choose this over an alternative, and the mistakes developers actually make with it in production.

The running example throughout this document is a small **company/HR system**: `departments`, `employees` (with a self-referencing `manager_id`), `projects`, and a junction table `employee_projects`. The schema is built up piece by piece as each concept is introduced, and assembled in full in Section 9.

---

## 1. Relational Database Theory Primer

Before any SQL syntax, it's worth being precise about what a relational database actually *is* — the vocabulary here isn't academic decoration; it's what lets you reason correctly about why constraints behave the way they do.

### 1.1 What a "Relation" Actually Means

**Theory first.** In relational database theory (formalized by Edgar F. Codd in 1970), a **relation** is a mathematical concept: a *set of tuples*, where a tuple is an ordered collection of attribute values, and every tuple in the set has the same attributes (the same "shape"). In everyday terms: a **relation is a table**, a **tuple is a row**, and an **attribute is a column**. The word "relational" in "relational database" refers to this mathematical structure — it does *not* refer to the fact that tables can relate to each other via foreign keys, which is a common but incorrect assumption. The *relationships between tables* are a separate, later concept (built on top of relations via foreign keys); the *relation* itself is just the formal name for one table's data.

Two properties fall directly out of this mathematical definition, and both have concrete SQL consequences:

- **A set has no inherent order.** Mathematically, a set of tuples has no defined sequence. This is exactly why SQL guarantees **no result ordering unless you explicitly write `ORDER BY`** — a `SELECT * FROM employees` with no `ORDER BY` may return rows in a different order from one execution to the next (in practice, usually reflecting physical storage order or index scan order, but this is never a guarantee you should rely on).
- **A set contains no duplicate elements.** A true mathematical relation cannot contain the same tuple twice. SQL tables, as actually implemented, *don't* enforce this by default — a plain `CREATE TABLE` can absolutely contain fully duplicate rows. This is one of several places SQL deliberately diverges from strict relational theory for practical reasons. The concept of **entity integrity** (Section 3) is precisely what reintroduces the "no duplicates, uniquely identifiable" guarantee, but only for whichever column(s) you nominate as the primary key — not automatically for the whole row.

**Common mistake**: assuming "relational" means "has relationships/foreign keys between tables." It doesn't — it means "the data itself is modeled as mathematical relations (tables of tuples)." Foreign keys are how relations *reference* each other, a related but distinct concept covered fully in Section 5.

### 1.2 The Full Hierarchy: Server -> Database -> Schema -> Table

A single running Postgres **server process** (also called a "cluster" in Postgres terminology, listening on one port, e.g. 5432) manages one shared set of configuration and one shared set of *roles* (users), but can host **multiple, fully isolated databases**.

```
Postgres server / cluster (one process, e.g. localhost:5432)
  |
  +-- database: hr_system
  |     +-- schema: public (the default)
  |     |     +-- table: departments
  |     |     +-- table: employees
  |     |     +-- table: projects
  |     |     +-- table: employee_projects
  |     +-- schema: audit
  |           +-- table: employee_change_log
  |
  +-- database: hr_system_test
        +-- schema: public
              +-- (same table structure, separate data, entirely separate storage)
```

**Theory first.** Each **database** is a fully separate namespace with its own system catalog (the internal tables Postgres uses to track every table, column, constraint, index, and type that exists) — you genuinely **cannot** run a query that joins a table in `hr_system` with a table in `hr_system_test` in a single statement. This is a hard architectural boundary, not a permissions restriction. A **schema**, by contrast, is a namespace *within* one database — a lighter-weight grouping mechanism, and you *can* freely join or foreign-key across schemas within the same database (Section 8 covers this in depth). A **table** lives inside exactly one schema, inside exactly one database.

**Where this shows up in a connection string** — the full addressing hierarchy is directly visible:
```
postgresql://user:password@host:5432/hr_system?options=-csearch_path%3Dpublic
                                     \_______/                    \____/
                                      database                     schema (via search_path)
```
The server/port identifies the cluster; the path segment after the port (`/hr_system`) identifies the database; the schema is either explicitly qualified per-query (`public.employees`) or resolved implicitly via the connection's `search_path` setting (Section 8.2). There is no equivalent path segment for "table" in a connection string, because which table you're querying is decided per-statement, in the SQL itself, not at connection time.

**Common mistake**: writing `hr_system.employees` expecting to reference a table in a different database from within a query connected to another database — this syntax doesn't do what it looks like it does in Postgres (unlike SQL Server, where cross-database dotted references are directly supported). Postgres requires either connecting directly to the target database, or using the `postgres_fdw`/`dblink` extensions to bridge across databases explicitly — there's no native cross-database query.

### 1.3 What "Integrity" Means in a Database System

**Theory first.** In database theory, "integrity" doesn't mean "security" or "not being hacked" — it means **the data in the database accurately and consistently reflects the rules of the real-world thing it's modeling, at all times, regardless of what queries are run against it.** A database with strong integrity guarantees means an application developer never has to defensively re-check "wait, could this row actually be missing a required field, or reference something that doesn't exist?" — the database itself refuses to ever get into that state in the first place. This is the entire philosophical justification for pushing validation into the database layer via constraints, rather than relying solely on application-code validation (which can be bypassed by a bug, a different application connecting to the same database, or a manual `psql` session).

There are three formally recognized types of integrity, and the rest of this document is essentially organized around them:

- **Entity integrity** (Section 3) — every row in a table must be uniquely, unambiguously identifiable. In practice: every table should have a primary key, and a primary key column can never be `NULL` (if it could be, two different rows could both have an "unknown" identity, which defeats the entire purpose of the identifier).
- **Domain integrity** (Section 4) — every value in a column must belong to that column's defined **domain**: its data type, its nullability rule, and any additional business-rule constraints (a `salary` cannot be negative; a `department_id` must be a valid integer). "Domain" here is the formal relational-theory term for "the set of all legal values a column may hold" — which is also, not coincidentally, the origin of the SQL `CREATE DOMAIN` statement (Section 4.5).
- **Referential integrity** (Section 5) — every reference from one table to another must point to something that actually exists. If `employees.department_id` claims to reference department `7`, department `7` must genuinely exist in the `departments` table — or the reference must be explicitly `NULL`, meaning "no reference," never a dangling pointer to nowhere.

**Why this framing matters practically**: when you're designing a schema, or defending one in an interview, "which constraint should I use here?" is really the question "which type of integrity am I protecting, and which SQL feature enforces that type?" — entity integrity questions point you toward primary keys and uniqueness; domain integrity questions point you toward `NOT NULL`/`CHECK`/data types; referential integrity questions point you toward foreign keys and their `ON DELETE`/`ON UPDATE` behaviors. Keeping this three-way split in mind is what turns "I know these SQL keywords" into "I can explain why my schema is correct."

---

## 2. `CREATE DATABASE` -- Full Theory and Rules

### 2.1 What Happens Internally When You Create a Database

**Theory first.** A new Postgres database is never built from nothing — it is always created as a **byte-for-byte copy of an existing template database**. Postgres ships with two built-in templates:

- **`template1`** — the default template used by `CREATE DATABASE` when no `TEMPLATE` is specified. It's a normal, connectable database that you (or extensions/tools) can modify — anything added to `template1` (an extension, a default role, a default schema object) will appear in every subsequently created database that uses it as a template. This is the mechanism, for instance, behind installing an extension "for every future database" by adding it to `template1` first.
- **`template0`** — a pristine, untouched, unmodifiable snapshot of what a brand-new Postgres installation looked like, with no local additions and (critically) no encoding-specific data that could conflict with a different encoding/locale choice. `template0` is the correct template to use specifically when you need to create a database with a `LC_COLLATE`/`LC_CTYPE`/`ENCODING` combination different from `template1`'s — because `template1` may already contain locale-dependent data that can't be safely re-interpreted under a different collation.

```sql
CREATE DATABASE hr_system_special_locale
    TEMPLATE template0
    ENCODING 'UTF8'
    LC_COLLATE 'C'
    LC_CTYPE 'C';
```

Internally, `CREATE DATABASE` copies the template's entire file-system directory (its data files) and registers a new row in the cluster-wide system catalog table `pg_database`, which every database in the cluster can see (this is one of the very few catalog tables shared across the whole cluster rather than being per-database) — which is exactly what lets `\l` in `psql` list every database on the server even before you've connected to any of them individually.

### 2.2 Every Configuration Option, Explained

**Full syntax:**
```sql
CREATE DATABASE database_name
    [ WITH ]
    [ OWNER              [=] role_name ]
    [ TEMPLATE           [=] template_name ]
    [ ENCODING           [=] encoding ]
    [ LC_COLLATE         [=] locale ]
    [ LC_CTYPE           [=] locale ]
    [ TABLESPACE         [=] tablespace_name ]
    [ CONNECTION LIMIT   [=] max_concurrent_connections ]
    [ IS_TEMPLATE        [=] boolean ];
```

- **`OWNER`** — the role that owns the new database, and therefore has full administrative rights over it (renaming it, dropping it, changing its permissions) by default. If omitted, the role executing `CREATE DATABASE` becomes the owner.
- **`TEMPLATE`** — which template database to clone (`template0` or `template1`, or in principle any existing database, though this requires no other users to be connected to it at the time).
- **`ENCODING`** — the character encoding used to store text in this database (almost always `UTF8` today). This determines how raw bytes on disk are interpreted as characters — get it wrong and non-ASCII text (accented characters, emoji, non-Latin scripts) can be silently corrupted.
- **`LC_COLLATE`** — controls **sort order** for text comparison and `ORDER BY` (e.g., whether accented characters sort near their unaccented equivalents, whether case affects sort position). Set **once**, permanently, at database creation.
- **`LC_CTYPE`** — controls **character classification**: what counts as a letter, digit, or whitespace character for functions like `UPPER()`/`LOWER()` and regex character classes. Also set once, permanently, at creation.
- **`TABLESPACE`** — the physical disk location where this database's files are stored, if you've configured multiple tablespaces (e.g., to put a specific database on faster SSD storage). Defaults to the cluster's default tablespace (`pg_default`) if omitted.
- **`CONNECTION LIMIT`** — the maximum number of concurrent connections allowed to this specific database (`-1`, the default, means unlimited, bounded only by the server-wide `max_connections` setting).
- **`IS_TEMPLATE`** — if `true`, marks this database as usable as a template for future `CREATE DATABASE` calls by any user with `CREATEDB` privilege, not just the owner.

**Full worked example, every option in use:**
```sql
CREATE DATABASE hr_system
    WITH
    OWNER = hr_admin
    TEMPLATE = template0
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    CONNECTION LIMIT = 100
    IS_TEMPLATE = false;
```

### 2.3 Identifier Naming Rules, in Full

**Theory first.** Every name in Postgres -- a database, schema, table, column, constraint, or index name -- is called an **identifier**, and identifiers follow specific rules baked into the SQL standard and Postgres's parser.

**Case sensitivity**: an unquoted identifier is automatically **folded to lowercase** by the parser, before it's ever stored. `CREATE TABLE Employees (...)` and `CREATE TABLE employees (...)` create the *exact same table* — both get folded to `employees`. This is why `SELECT * FROM Employees` and `SELECT * FROM EMPLOYEES` and `SELECT * FROM employees` all work identically and refer to the same table: the parser lowercases all three before resolving them.

If you **quote** an identifier with double quotes, case is preserved exactly, and the identifier becomes case-*sensitive* from that point forward: `CREATE TABLE "Employees" (...)` creates a table that must *always* be referenced as `"Employees"` (with the exact capitalization and the quotes) — `SELECT * FROM Employees` (unquoted) will fail, because the parser folds the unquoted reference to lowercase `employees`, which is a different, non-existent identifier from the quoted `"Employees"`.

**Practical rule**: always use lowercase, unquoted, `snake_case` identifiers, and never introduce mixed-case or quoted identifiers into a schema -- this sidesteps an entire, entirely self-inflicted category of "table not found" confusion.

**The 63-byte truncation limit**: Postgres identifiers have a hard maximum length, controlled by the compile-time constant `NAMEDATALEN`, which defaults to `64` bytes -- one of which is reserved for a null terminator internally, leaving **63 usable bytes** for the actual name. This exists because Postgres, like most C-based database engines, stores identifiers in fixed-size internal structures for performance (fixed-size fields are faster to compare and hash than variable-length ones) -- an intentional, deliberate trade-off of "unlimited identifier length" in exchange for faster catalog lookups.

**What happens if you exceed it -- silently, not as an error**:
```sql
CREATE TABLE this_is_a_very_long_table_name_that_goes_on_and_on_and_exceeds_the_limit_by_quite_a_lot (
    id INTEGER
);
```
Postgres does **not** raise an error here. It silently truncates the identifier to the first 63 bytes, and that truncated name is what actually gets created. This is a genuinely dangerous gotcha: two long identifiers differing only after byte 63 will silently collide and error with "already exists" the second time, and a single long identifier used inconsistently (sometimes typed in full, sometimes copy-pasted from a truncated reference) can lead to confusing "relation does not exist" errors that look like a typo but are actually a truncation mismatch.

**Reserved words**: certain identifiers (`SELECT`, `TABLE`, `ORDER`, `USER`, `PRIMARY`, and many more) are reserved by the SQL grammar and cannot be used unquoted as a table/column name without confusing the parser. `CREATE TABLE order (id INTEGER)` fails outright, since `order` is a reserved keyword; `CREATE TABLE "order" (id INTEGER)` works, by quoting it -- but this is generally poor practice, since it forces every future reference to that table to also be quoted. **Practical rule**: avoid naming a table or column after a SQL keyword in the first place (prefer `orders` over `order`, `user_role` over `role` if `role` is contextually ambiguous, etc.).

### 2.4 Why You Can't Drop or Recreate a Database You're Connected To

**Theory first.** Postgres cannot drop, rename, or use as a fresh `CREATE DATABASE ... TEMPLATE` source, any database that currently has **active connections** to it. This isn't an arbitrary restriction -- it exists because dropping a database means physically deleting its on-disk files, and Postgres cannot safely delete files that another active backend process might be mid-read or mid-write on. Every live connection holds an internal reference (and, transiently, catalog-level locks) to the database's metadata; `DROP DATABASE` needs an exclusive claim on that database with zero other sessions present to proceed safely.

**Failure example, with the real error message:**
```sql
-- Connected to hr_system in one session, from a DIFFERENT session:
DROP DATABASE hr_system;
```
```
ERROR:  database "hr_system" is being accessed by other users
DETAIL:  There is 1 other session using the database.
```

**The fix**: connect to a *different* database first (commonly the default `postgres` maintenance database), then drop the target:
```sql
\c postgres
DROP DATABASE hr_system;
```
Or, forcibly terminate other sessions first (Postgres 13+ supports this directly via `WITH (FORCE)`):
```sql
DROP DATABASE hr_system WITH (FORCE);
```

**Common mistake**: running a migration or seed script that tries to `DROP DATABASE`/recreate the same database the script's own connection is currently using -- this always fails with the exact error above; the correct pattern is for the script to connect to a maintenance database (e.g. `postgres`) to issue the `DROP`/`CREATE DATABASE` commands, then reconnect to the target database for everything after.

---

## 3. Entity Integrity -- Primary Keys

### 3.1 What Entity Integrity Means, and Why a Primary Key Can Never Be NULL

**Theory first.** Entity integrity is the rule that **every row in a table must be uniquely and unambiguously identifiable** -- there must exist at least one column (or combination of columns) whose value is guaranteed distinct across every row, so that any given row can always be addressed precisely, with no ambiguity about which row is being referred to. Without this guarantee, an `UPDATE`/`DELETE` targeting "the row where id = 5" could, in principle, match zero, one, or many rows -- and a system that can't reliably say "this specific row, and only this one" cannot support foreign keys (Section 5), cannot support reliable application-level "fetch this record by ID" logic, and cannot guarantee that two people looking at "customer 5" are looking at the same actual entity.

**Why NULL is fundamentally incompatible with this**: `NULL` represents "unknown" or "absent," not a real, comparable value. If a primary key column allowed `NULL`, then two different rows could both have a `NULL` primary key -- and because `NULL` is never considered equal to another `NULL` (Section 4.1 covers this in full), the database could never actually verify whether those two `NULL`-keyed rows are "the same identity" or "two different rows that both happen to lack an identity." This directly breaks the "unambiguously identifiable" requirement at its root -- which is exactly why the SQL standard, and Postgres's implementation of `PRIMARY KEY`, make the constraint **implicitly `NOT NULL`** on every column it covers, with no way to opt out.

### 3.2 Full Syntax and a Runnable Example

**Full syntax** (as a column constraint, or as a table-level constraint -- required for composite keys):
```sql
-- Column-level (single-column primary key)
column_name data_type PRIMARY KEY

-- Table-level (required for composite primary keys, Section 3.5)
CONSTRAINT constraint_name PRIMARY KEY (column_name [, ...])
```

**Runnable example**, introducing the `departments` table for the running HR schema:
```sql
CREATE TABLE departments (
    id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    budget NUMERIC(12, 2) NOT NULL DEFAULT 0
);
```

### 3.3 What Postgres Actually Does Internally

**Internals.** Declaring `PRIMARY KEY` causes Postgres to perform two distinct actions behind the scenes, neither of which is optional or separately configurable:
1. It marks the column(s) `NOT NULL` at the catalog level (visible in `pg_attribute.attnotnull`).
2. It **automatically creates a unique B-tree index** on the column(s) -- the exact same physical structure you'd get from manually running `CREATE UNIQUE INDEX`. This is the actual enforcement mechanism: every `INSERT`/`UPDATE` that would touch the primary key column(s) triggers a check against this unique index, and a duplicate value is rejected at the index level before the row is ever considered "written." You can see this index directly:

```sql
\d departments
```
```
                                   Table "public.departments"
 Column |         Type          | Collation | Nullable |               Default
--------+------------------------+-----------+----------+---------------------------------------
 id     | integer                |           | not null | generated always as identity
 name   | text                   |           | not null |
 budget | numeric(12,2)          |           | not null | 0
Indexes:
    "departments_pkey" PRIMARY KEY, btree (id)
    "departments_name_key" UNIQUE CONSTRAINT, btree (name)
```

This is also *why* a primary key lookup (`WHERE id = 5`) is fast by default with no extra work: the index backing entity integrity doubles as a performance-critical lookup structure, at essentially no extra cost, since it would have to exist anyway to enforce the constraint.

### 3.4 Failure Example

```sql
INSERT INTO departments (id, name) VALUES (1, 'Engineering');
INSERT INTO departments (id, name) VALUES (1, 'Sales');   -- duplicate id
```
```
ERROR:  duplicate key value violates unique constraint "departments_pkey"
DETAIL:  Key (id)=(1) already exists.
```

```sql
INSERT INTO departments (id, name) VALUES (NULL, 'Marketing');
```
```
ERROR:  null value in column "id" of relation "departments" violates not-null constraint
DETAIL:  Failing row contains (null, Marketing, 0.00).
```

### 3.5 `SERIAL` vs. `BIGSERIAL` vs. `GENERATED ALWAYS AS IDENTITY` vs. `GENERATED BY DEFAULT AS IDENTITY`

**Theory first, with history.** `SERIAL` and `BIGSERIAL` predate the SQL standard's own auto-increment syntax and are **Postgres-specific syntactic sugar**, not a distinct data type at all. Writing `id SERIAL PRIMARY KEY` is literally rewritten by the parser into three separate underlying actions:
1. Create the column as `INTEGER` (or `BIGINT` for `BIGSERIAL`).
2. Create a separate sequence object (e.g. `departments_id_seq`) to generate incrementing values.
3. Set the column's `DEFAULT` to `nextval('departments_id_seq')`.

This is a real historical wart: because `SERIAL` is just sugar over "a plain integer column with a default expression," Postgres has **no formal way of knowing the column was ever intended to be an identity column** at the catalog level -- it looks, to the system, exactly like any other integer column that happens to have a sequence-based default. This has real, practical consequences (below).

The SQL-standard-compliant, modern alternative, added in Postgres 10, is `GENERATED ... AS IDENTITY`:
```sql
-- Modern, recommended syntax
id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
id BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

**`GENERATED ALWAYS AS IDENTITY` vs. `GENERATED BY DEFAULT AS IDENTITY`** -- the difference is specifically about whether an explicit value can be supplied on `INSERT`:
- **`GENERATED ALWAYS AS IDENTITY`** -- the database generates the value; an application **cannot** override it with an explicit `INSERT INTO departments (id, name) VALUES (999, 'X')` without special syntax (`OVERRIDING SYSTEM VALUE`). This is the stricter, generally recommended default -- it prevents an accidental or malicious explicit ID from silently colliding with a future auto-generated one.
- **`GENERATED BY DEFAULT AS IDENTITY`** -- behaves like the old `SERIAL`: the identity value is used only if no explicit value is supplied; an application *can* override it freely. This is the right choice specifically when you need to **migrate existing data with pre-existing IDs** into a table that should otherwise auto-generate new IDs going forward.

**What actually differs under the hood -- sequence ownership and override capability**: with `GENERATED ... AS IDENTITY`, Postgres formally records, at the catalog level, that the underlying sequence is an **identity sequence owned by this specific column** (visible via `\d departments` showing `generated always as identity` directly in the column's default, rather than a separate, generic `nextval(...)` default). This has two concrete practical benefits `SERIAL` never had:
- `DROP TABLE departments` automatically and correctly drops its identity sequence too, with no separate cleanup needed (a `SERIAL` column's sequence can, in some edge cases involving manual sequence creation, be left orphaned).
- Tools inspecting the schema (ORMs, migration generators, `pg_dump`) can reliably detect "this is an identity column" as a first-class catalog fact, rather than having to pattern-match on a `nextval(...)` default expression to guess that a column is probably auto-incrementing.

**Why modern Postgres recommends `IDENTITY` over `SERIAL`**: it's the SQL-standard syntax (portable in *specification*, if not always in exact dialect, across other SQL databases), it's more explicit about override intent (`ALWAYS` vs. `BY DEFAULT`), and it avoids the sequence-ownership ambiguity described above. `SERIAL` still works today and is not deprecated, but essentially every current Postgres style guide and the official documentation itself now favor `IDENTITY` for new schemas.

**Decision guidance ("I'd use X here because Y")**: "I'd use `GENERATED ALWAYS AS IDENTITY` for a brand-new table's primary key, because it's the SQL-standard syntax and prevents accidental ID collisions from explicit inserts. I'd switch to `GENERATED BY DEFAULT AS IDENTITY` specifically during a data migration, where I need to preserve the original IDs from a legacy system while still letting the database generate new IDs for rows created after the cutover. I'd reach for `SERIAL`/`BIGSERIAL` only when working against an existing codebase or ORM that generates that syntax by convention -- I wouldn't introduce it fresh today."

**Common mistake**: mixing explicit-ID inserts into a `GENERATED ALWAYS AS IDENTITY` column during a data migration without `OVERRIDING SYSTEM VALUE`, and being surprised by the error:
```sql
INSERT INTO departments (id, name) VALUES (500, 'Legacy Dept');
```
```
ERROR:  cannot insert a non-DEFAULT value into column "id"
DETAIL:  Column "id" is an identity column defined as GENERATED ALWAYS.
HINT:  Use OVERRIDING SYSTEM VALUE to override.
```
The fix, when genuinely needed:
```sql
INSERT INTO departments OVERRIDING SYSTEM VALUE (id, name) VALUES (500, 'Legacy Dept');
```
A second, very common mistake: after a bulk import that inserts explicit ID values (even with `OVERRIDING SYSTEM VALUE` or under `BY DEFAULT`), forgetting that the **underlying sequence does not automatically know about those manually-inserted values** -- the sequence's internal counter keeps advancing from wherever it last was, unaware that IDs above its current position were just claimed manually. The very next auto-generated insert can then collide:
```sql
SELECT setval('departments_id_seq', (SELECT MAX(id) FROM departments));
```
This resynchronizes the sequence to continue *after* the highest existing ID -- a step that should always follow any bulk import of explicit ID values.

### 3.6 Natural Keys vs. Surrogate Keys

**Theory first.** A **natural key** is a column (or set of columns) that already exists in the real-world data and is inherently, meaningfully unique -- e.g. an ISO-3166 two-letter country code (`US`, `IN`, `GB`), a national tax ID, or an already-unique product SKU. A **surrogate key** is an artificial identifier with no business meaning whatsoever, created purely to serve as a stable primary key -- an auto-incrementing integer or a randomly generated UUID.

**The theoretical debate, both sides:**

*In favor of natural keys*: they carry real meaning, avoid an extra "meaningless" column, and can make certain queries more directly readable (`WHERE country_code = 'US'` is more self-documenting than `WHERE country_id = 42` with no context). They also naturally prevent a specific class of duplicate-data bug: since the "identifier" *is* the meaningful business value, you cannot accidentally end up with two different rows both claiming to represent "the United States" under different surrogate IDs.

*In favor of surrogate keys*: they are **guaranteed stable for the lifetime of the row**, independent of any real-world value that might need to change. This is the decisive argument in the overwhelming majority of real schemas: real-world "unique" attributes turn out, again and again in practice, to change or turn out not to be as unique as assumed (an employee's email address changes when they get married; a product's SKU gets reissued after a supplier change; even national ID numbers can, in rare administrative cases, be reissued). If a natural key is used as a primary key and referenced by foreign keys elsewhere, *any* change to that value requires either an `ON UPDATE CASCADE` propagating the change everywhere (Section 5.6) or, in a system without that set up, a very risky manual multi-table update. A surrogate key never has this problem, because it never needs to change -- it was never meaningful in the first place.

**When you'd genuinely choose a natural key**: for reference/lookup tables of genuinely stable, standardized, externally-governed codes -- ISO country codes, ISO currency codes, US state abbreviations -- where the "natural key" is maintained by an external standards body specifically to *never* change, and where using it directly (rather than inventing a surrogate integer) makes every join and every piece of data noticeably more self-explanatory, with essentially zero risk of the value ever needing to change.

**Decision guidance**: "For `departments.id` and `employees.id` in this schema, I'd always use a surrogate key (an identity column), because department names *do* change (reorganizations, rebranding) and I never want a rename to cascade into rewriting foreign keys across every table that references it. But if I were adding a `countries` lookup table to store ISO country codes for `departments.country`, I'd seriously consider using the two-letter ISO code itself as the primary key, precisely because it's externally standardized and effectively guaranteed never to change."

**Common mistake**: choosing a natural key that only *appears* stable at design time -- e.g. using an employee's `email` as a primary key referenced by other tables, then encountering the very real, very common event of an employee changing their email address, and discovering that the "immutable" primary key is not actually immutable at all.

### 3.7 Composite Primary Keys -- Correct Modeling Choice vs. Code Smell

**Theory first.** A **composite primary key** spans multiple columns, where no single column is unique on its own, but the *combination* is. This is not an exotic or discouraged feature -- it is the textbook-correct modeling choice for exactly one specific situation: a table whose rows genuinely represent **the pairing itself**, most commonly a many-to-many junction table (fully covered in Section 9, via `employee_projects`).

```sql
CREATE TABLE employee_projects (
    employee_id      INTEGER NOT NULL,
    project_id       INTEGER NOT NULL,
    role             TEXT NOT NULL,
    hours_allocated  NUMERIC(5, 1) NOT NULL DEFAULT 0,
    PRIMARY KEY (employee_id, project_id)
);
```

Here, `(employee_id, project_id)` together are the *entity itself* -- "this specific employee's assignment to this specific project" -- and the constraint directly encodes the real business rule "an employee cannot be assigned to the same project twice," which a single surrogate `id` column alone could never express (a surrogate `id` would happily allow the same `(employee_id, project_id)` pair to appear on two different rows, silently violating the actual business rule unless you separately added a `UNIQUE (employee_id, project_id)` constraint anyway -- at which point you have two overlapping unique constraints doing the same job, one of them redundant).

**When a composite primary key is a code smell instead**: when it's used on a table representing a genuinely independent entity that just happens to be *looked up* by two columns together -- e.g. modeling `orders` with a composite key of `(customer_id, order_sequence_number)` instead of a plain surrogate `order_id`. This is a smell because an order is conceptually a single, independent thing (it has its own lifecycle, its own foreign keys pointing to it from `order_items`, its own meaning outside the context of "this customer's Nth order") -- forcing every foreign key elsewhere in the schema that needs to reference "this order" to carry *both* columns (Section 5.7, composite foreign keys) adds real complexity for no corresponding modeling benefit. The correct test: **if the table represents a relationship/pairing itself, a composite key is correct; if the table represents an independent entity that merely happens to have two columns forming a natural key, prefer a surrogate key instead**, even if a composite natural key would technically work.

**Common mistake**: defaulting to composite keys "because the data naturally has two identifying columns," without asking whether the table actually represents a relationship (correct use) or an independent entity that's simply looked up by two fields (should get its own surrogate key instead).

---

## 4. Domain Integrity -- Column Constraints

### 4.1 `NOT NULL`, Three-Valued Logic, and Why `NULL = NULL` Is Not True

**Theory first.** SQL does not use ordinary two-valued (`TRUE`/`FALSE`) Boolean logic -- it uses **three-valued logic**: `TRUE`, `FALSE`, and `UNKNOWN`. `NULL` represents "the value is missing or not applicable," and critically, **any comparison involving `NULL` evaluates to `UNKNOWN`, not `TRUE` or `FALSE`** -- including comparing `NULL` to itself. `NULL = NULL` does not evaluate to `TRUE`; it evaluates to `UNKNOWN`, because the database has no way of knowing whether two "unknown" values happen to represent the same real-world fact or two entirely unrelated unknowns. In a `WHERE` clause, only rows where the condition evaluates to `TRUE` are returned -- `UNKNOWN` is treated the same as `FALSE` for filtering purposes, which is exactly why `WHERE column = NULL` **never matches any row**, even rows that do have a `NULL` value in that column; you must use `IS NULL`/`IS NOT NULL`, which are special-purpose predicates designed specifically to test for `NULL` directly rather than comparing against it.

**`NOT NULL` as a domain-integrity constraint**: declaring a column `NOT NULL` removes `UNKNOWN`/"missing" as a legal value for that column's domain entirely -- it's the most basic form of domain integrity, restricting the domain from "any value of this type, plus the possibility of being unknown" down to "any value of this type, full stop."

**Full syntax:**
```sql
column_name data_type NOT NULL
```

**Runnable example**, extending the schema with `employees`:
```sql
CREATE TABLE employees (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    manager_id    INTEGER,               -- deliberately nullable -- the CEO has no manager
    salary        NUMERIC(10, 2) NOT NULL,
    hire_date     DATE NOT NULL
);
```

**What Postgres does internally**: a `NOT NULL` constraint is stored directly as a boolean flag (`attnotnull`) in the `pg_attribute` catalog row for that column -- it is checked at every `INSERT`/`UPDATE` before the row is written, and unlike most other constraints, it does **not** require a supporting index of any kind to enforce; it's a direct, per-row check against the incoming value.

**Failure example:**
```sql
INSERT INTO employees (first_name, last_name, email, department_id, salary, hire_date)
VALUES ('Alice', NULL, 'alice@company.com', 1, 85000, '2024-01-15');
```
```
ERROR:  null value in column "last_name" of relation "employees" violates not-null constraint
DETAIL:  Failing row contains (1, Alice, null, alice@company.com, 1, null, 85000.00, 2024-01-15).
```

**Decision guidance**: "I make `manager_id` nullable deliberately, because it needs to represent a genuinely optional relationship -- the most senior employee in the org has no manager, and forcing a `NOT NULL` there would mean inventing a fake self-referencing or sentinel value just to satisfy the constraint, which would be worse than allowing a real, meaningful `NULL`."

### 4.2 `UNIQUE` Constraints

**Theory first.** A `UNIQUE` constraint enforces that no two rows share the same value in the constrained column(s) -- but, unlike `PRIMARY KEY`, a table may have **any number** of `UNIQUE` constraints, and a `UNIQUE` column is **not** implicitly `NOT NULL`.

**Full syntax:**
```sql
-- Column-level
column_name data_type UNIQUE

-- Table-level (required for a multi-column/composite UNIQUE constraint)
CONSTRAINT constraint_name UNIQUE (column_name [, ...])
```

**Runnable example:**
```sql
ALTER TABLE employees ADD CONSTRAINT employees_email_key UNIQUE (email);
```

**Internals**: exactly like `PRIMARY KEY`, `UNIQUE` is enforced by Postgres **automatically creating a unique B-tree index** behind the scenes -- there is no separate "uniqueness-checking" mechanism distinct from the index itself. `\d employees` will show this as `"employees_email_key" UNIQUE CONSTRAINT, btree (email)`, structurally identical to how a primary key's backing index appears.

**Why multiple NULLs are allowed in a UNIQUE column, proven directly**: because uniqueness is checked via an index, and because (per Section 4.1) `NULL` is never considered *equal* to another `NULL`, a unique index simply never flags two `NULL` entries as a collision -- there is nothing to compare that could ever evaluate to `TRUE`.

```sql
CREATE TABLE employees_test (id INTEGER, ssn TEXT UNIQUE);

INSERT INTO employees_test VALUES (1, NULL);
INSERT INTO employees_test VALUES (2, NULL);   -- succeeds -- NOT a duplicate, despite both being NULL

SELECT * FROM employees_test;
```
```
 id | ssn
----+------
  1 | null
  2 | null
(2 rows)
```
Both inserts succeed without error, directly demonstrating that `UNIQUE` never rejects multiple `NULL`s.

**Failure example, with an actual duplicate non-NULL value:**
```sql
INSERT INTO employees (first_name, last_name, email, department_id, salary, hire_date)
VALUES ('Bob', 'Smith', 'alice@company.com', 1, 72000, '2024-02-01');
```
```
ERROR:  duplicate key value violates unique constraint "employees_email_key"
DETAIL:  Key (email)=(alice@company.com) already exists.
```

**Decision guidance**: "I'd add `UNIQUE` to `employees.email` because an email address is meant to identify one person, even though it's not the table's primary key -- the primary key stays a stable surrogate `id`, while `UNIQUE` on `email` protects a separate, genuine business rule (no two employee records should share a login/contact email) without conflating that rule with row identity."

### 4.3 `CHECK` Constraints

**Theory first.** A `CHECK` constraint is the most general-purpose domain-integrity tool: an arbitrary boolean expression, evaluated per row, that must hold `TRUE` (or `UNKNOWN` -- notably, `CHECK` constraints pass on `UNKNOWN`, only failing on an explicit `FALSE`, a subtlety worth knowing precisely) for every row in the table.

**Full syntax:**
```sql
-- Column-level, single-column
column_name data_type CHECK (condition)

-- Table-level, can reference multiple columns from the SAME row
CONSTRAINT constraint_name CHECK (condition)
```

**Runnable example -- a single-column CHECK:**
```sql
ALTER TABLE employees ADD CONSTRAINT employees_salary_positive CHECK (salary > 0);
```

**A multi-column CHECK, referencing more than one column from the same row** -- extending the schema with `projects`, ensuring a project's end date is never before its start date:
```sql
CREATE TABLE projects (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    start_date    DATE NOT NULL,
    end_date      DATE,
    budget        NUMERIC(12, 2) NOT NULL CHECK (budget >= 0),
    CONSTRAINT projects_valid_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);
```

**The critical limitation, precisely stated**: a `CHECK` constraint can reference **only columns of the single row currently being inserted/updated** -- it has no mechanism to compare against other rows in the same table, or against any other table entirely. `CHECK (salary < (SELECT AVG(salary) FROM employees))` is **not valid** -- Postgres will reject a `CHECK` constraint containing a subquery outright, because enforcing it would require re-evaluating it against a constantly-changing aggregate over the whole table on every single insert, which breaks the constraint model's assumption of a fast, row-local, self-contained check. Cross-row or cross-table validation of this kind requires a trigger (briefly noted here, covered in the broader Postgres reference material's section on triggers) or, in some cases, a genuine referential-integrity foreign key if the "other data" is really a lookup relationship rather than an aggregate.

**Failure example:**
```sql
INSERT INTO projects (name, department_id, start_date, end_date, budget)
VALUES ('Website Redesign', 1, '2026-06-01', '2026-01-01', 50000);
```
```
ERROR:  new row for relation "projects" violates check constraint "projects_valid_date_range"
DETAIL:  Failing row contains (1, Website Redesign, 1, 2026-06-01, 2026-01-01, 50000.00).
```

**Decision guidance**: "I'd reach for a `CHECK` constraint over an `ENUM` type when the valid values are numeric ranges, string patterns, or a cross-column rule an `ENUM` couldn't express at all -- like the date-range rule above. I'd reach for `ENUM` instead when the valid set is a small, fixed, named list of discrete states, like a project's `status`, because an `ENUM` is more self-documenting in `\d` output and slightly cheaper to store and compare than an equivalent `CHECK (status IN (...))` on a text column."

**Common mistake**: attempting to write a `CHECK` constraint that references another table or aggregates across rows, then being confused by the resulting parse-time error, rather than recognizing the constraint model's row-local-only limitation up front and reaching for a trigger instead.

### 4.4 `DEFAULT` -- When It Applies, and Expression Defaults

**Theory first.** A `DEFAULT` clause specifies a value to be used **only when an `INSERT` statement does not explicitly supply a value for that column** -- it is not a general "fallback value" applied at any other time. This is a precise and commonly misunderstood point: `DEFAULT` has **no effect whatsoever on `UPDATE`** -- running `UPDATE employees SET hire_date = DEFAULT WHERE id = 5` (the one syntax where `DEFAULT` *is* meaningful inside an `UPDATE`, used explicitly as a value) resets the column back to its declared default; but an ordinary `UPDATE employees SET salary = 90000 WHERE id = 5` that doesn't mention `hire_date` at all leaves `hire_date` completely untouched -- there is no scenario where an omitted column in an `UPDATE` silently reverts to its default the way an omitted column in an `INSERT` does.

**Full syntax:**
```sql
column_name data_type DEFAULT default_expression
```

`default_expression` can be a literal constant, or a function call evaluated fresh at the moment of each insert:
```sql
CREATE TABLE employee_change_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),   -- function-generated default, unique per row
    employee_id  INTEGER NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),           -- function-generated default, current at insert time
    change_type  TEXT NOT NULL DEFAULT 'update'                -- constant default
);
```

**Runnable example, applying `DEFAULT` to `employees`:**
```sql
ALTER TABLE employees ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

**Proving the "only on INSERT without an explicit value" rule directly:**
```sql
INSERT INTO employees (first_name, last_name, email, department_id, salary, hire_date)
VALUES ('Carla', 'Nguyen', 'carla@company.com', 1, 95000, '2024-03-10');
-- created_at is populated automatically via DEFAULT now()

UPDATE employees SET salary = 98000 WHERE email = 'carla@company.com';
-- created_at is completely untouched -- DEFAULT played no role in this UPDATE at all
```

**Decision guidance**: "I'd use `DEFAULT now()` for `created_at` because it should reflect exactly when the row was inserted and should never be settable by application code, but I'd deliberately avoid `DEFAULT now()` for `updated_at` -- a default only fires on insert, so it can't keep a column current on every subsequent update; that requires a trigger instead, which is the correct tool specifically because the requirement is 'run on every write,' not 'only when a value is omitted.'"

**Common mistake**: assuming `DEFAULT now()` on an `updated_at` column will keep it automatically current across updates -- it will not; it only sets the initial value at insert time and is silently irrelevant to every subsequent `UPDATE` unless a trigger is separately added.

### 4.5 `CREATE DOMAIN` -- Reusable Constrained Types

**Theory first.** A **domain**, in the formal relational sense (Section 1.3), is "the full set of legal values a column may hold" -- and `CREATE DOMAIN` is Postgres's direct SQL realization of that concept: a named, reusable type that bundles an underlying data type together with constraints (`NOT NULL`, `CHECK`), so the same validation rule can be applied consistently across many columns and tables without retyping the `CHECK` expression every time.

**Full syntax:**
```sql
CREATE DOMAIN domain_name AS underlying_type
    [ DEFAULT default_expression ]
    [ NOT NULL ]
    [ CHECK (condition using the keyword VALUE to refer to the domain's own value) ];
```

**Runnable example**, a reusable "non-negative currency amount" domain applied across the HR schema:
```sql
CREATE DOMAIN non_negative_money AS NUMERIC(12, 2)
    NOT NULL
    CHECK (VALUE >= 0);

-- Used in place of repeating "NUMERIC(12,2) NOT NULL CHECK (... >= 0)" everywhere:
ALTER TABLE projects ALTER COLUMN budget TYPE non_negative_money;
```
(In practice, a domain is usually chosen at initial `CREATE TABLE` time, e.g. `budget non_negative_money`, rather than retrofitted -- shown here as an `ALTER` purely to demonstrate it can also convert an existing column.)

**Failure example -- the domain's constraint is enforced exactly like an inline CHECK would be:**
```sql
UPDATE projects SET budget = -500 WHERE id = 1;
```
```
ERROR:  value for domain non_negative_money violates check constraint "non_negative_money_check"
```

**Why domains are underused in practice, honestly assessed**: three real reasons. First, most developers simply don't know the feature exists, since it's less commonly taught than inline `CHECK`/`NOT NULL`. Second, changing a domain's constraint later requires `ALTER DOMAIN ... DROP CONSTRAINT` / `ADD CONSTRAINT`, and Postgres will **re-validate every existing column using that domain, across every table**, against the new rule -- a potentially large, locking operation on a live system, which makes domains feel riskier to evolve than they first appear. Third, most ORMs have incomplete or no first-class support for domains, generating a plain underlying-type column instead and silently dropping the domain-level semantics -- which pushes many teams back toward repeating inline constraints per-column, purely for tooling compatibility, even when a domain would be the theoretically cleaner choice.

**Decision guidance**: "I'd reach for a domain specifically when the exact same validation rule needs to be enforced identically across many columns/tables and I want a single point of change -- like a `non_negative_money` type used for every currency column in a financial schema. I'd stick with an inline `CHECK` for a rule that's genuinely specific to one column, since a one-off domain just adds an extra layer of indirection with no real reuse benefit."

---

## 5. Referential Integrity -- Foreign Keys (The Core Section)

### 5.1 Full Theoretical Explanation

**Theory first.** Referential integrity is the formal rule that **a foreign key value must either be `NULL`, or match an existing value in the referenced table's key column** -- there is no third option. A foreign key column can never hold a value that *looks like* a reference but points at nothing (a "dangling reference"). This is the mechanism that upgrades a schema from "tables that happen to share similarly-named columns, by convention" to "tables whose relationships are actively, continuously enforced by the database itself" -- without it, `employees.department_id = 999` pointing at a `department` that was deleted six months ago is not just possible, it's *inevitable* over the lifetime of any real system, unless every single piece of application code that could ever delete a department also remembers to check for, and handle, every table that might reference it -- a maintenance burden that reliably fails at scale, across a large enough codebase, over a long enough time horizon.

**Why this matters beyond "avoiding orphaned rows"**: a query joining `employees` to `departments` (`... JOIN departments d ON e.department_id = d.id`) implicitly assumes every `department_id` value has a matching department -- if referential integrity isn't enforced, that join can silently and invisibly drop legitimate employee rows whose department was deleted, with no error, no warning, and no obvious symptom beyond "the report total looks slightly wrong" -- exactly the kind of bug that's brutal to trace back to its root cause days or weeks later.

### 5.2 Full Syntax

```sql
-- Column-level
column_name data_type REFERENCES referenced_table (referenced_column)
    [ MATCH FULL | MATCH PARTIAL | MATCH SIMPLE ]
    [ ON DELETE referential_action ]
    [ ON UPDATE referential_action ]
    [ DEFERRABLE | NOT DEFERRABLE ]
    [ INITIALLY DEFERRED | INITIALLY IMMEDIATE ]

-- Table-level (required for composite foreign keys, Section 5.7)
CONSTRAINT constraint_name FOREIGN KEY (column_name [, ...])
    REFERENCES referenced_table (referenced_column [, ...])
    [ ...same clauses as above... ]
```

**Runnable example**, connecting `employees` to `departments`:
```sql
ALTER TABLE employees
    ADD CONSTRAINT employees_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES departments (id);
```

### 5.3 The Complete Mechanics of Enforcement

**What Postgres actually does internally.** A foreign key constraint is enforced via a pair of **implicit constraint triggers** attached to both tables involved -- this is directly visible in Postgres's own system catalogs (`pg_trigger`), even though you never write `CREATE TRIGGER` yourself; declaring `REFERENCES` causes Postgres to generate these triggers automatically, invisibly, behind the `FOREIGN KEY` syntax:

- On the **referencing table** (`employees`): an `AFTER INSERT OR UPDATE` constraint trigger checks that the new `department_id` value exists in `departments.id` (or is `NULL`).
- On the **referenced table** (`departments`): an `AFTER DELETE OR UPDATE` constraint trigger checks (or acts on, per the `ON DELETE`/`ON UPDATE` clause) whatever rows in `employees` currently reference the row being deleted/updated.

**Why "AFTER," not "BEFORE," and why this matters**: the check runs **after** the statement's row-level change has already been applied within the current transaction, then verifies the *end result* is consistent -- rather than trying to validate before the change happens, which would be far more complex given multi-row statements. This "check after the fact, within the same transaction, before any external observer can see the change" design is exactly what makes **deferred constraint checking** (Section 5.4) possible at all -- since the check is already structured as a discrete, separately-timed trigger action, Postgres can choose to run it either immediately after each individual statement, or postpone it until the whole transaction is about to commit.

### 5.4 `DEFERRABLE` and `INITIALLY DEFERRED`/`INITIALLY IMMEDIATE`

**Theory first, and why this matters.** By default, a foreign key constraint is checked **immediately after each statement** that could violate it -- which is fine for the overwhelming majority of real-world writes, but creates a genuine, unavoidable problem for one specific case: **inserting two rows that reference each other**, within a single transaction, where neither row can be validly inserted first without briefly violating the constraint. Postgres solves this by letting a constraint be marked `DEFERRABLE`, meaning its check can optionally be postponed until the transaction actually attempts to `COMMIT` -- at which point, and only then, the *final* state of every affected row is checked, not the intermediate state after each individual statement.

**A full worked example where `DEFERRABLE` is genuinely necessary** -- suppose (a deliberately constructed but realistic scenario) `departments` has a `head_employee_id` referencing the employee who leads it, and `employees.department_id` references the department they belong to -- a case of two tables whose very first rows must reference each other:

```sql
ALTER TABLE departments ADD COLUMN head_employee_id INTEGER;

ALTER TABLE departments
    ADD CONSTRAINT departments_head_employee_id_fkey
    FOREIGN KEY (head_employee_id) REFERENCES employees (id)
    DEFERRABLE INITIALLY DEFERRED;
```

```sql
BEGIN;

-- This would normally fail immediately: department 1 doesn't exist yet, so this employee
-- can't legally reference department_id = 1 ... UNLESS the check is deferred to commit time.
INSERT INTO employees (id, first_name, last_name, email, department_id, salary, hire_date)
    VALUES (1, 'Priya', 'Sharma', 'priya@company.com', 1, 150000, '2020-01-01');

-- This would normally ALSO fail immediately: employee 1 doesn't exist in a state where
-- department 1 exists yet, from the department's perspective as it's inserted here.
INSERT INTO departments (id, name, head_employee_id) VALUES (1, 'Executive', 1);

COMMIT;   -- Only NOW are both foreign keys actually checked -- and by commit time, both rows
          -- fully exist and correctly reference each other, so the commit succeeds.
```

Without `DEFERRABLE INITIALLY DEFERRED` on at least one of these two constraints, this exact sequence is structurally impossible to express in standard SQL -- there is no valid statement order where both constraints are simultaneously satisfied at every single intermediate step, because each row's validity depends on the other row already existing.

**`DEFERRABLE` vs. `NOT DEFERRABLE`** (the default): whether the constraint is *allowed* to ever be deferred at all. **`INITIALLY DEFERRED` vs. `INITIALLY IMMEDIATE`**: for a constraint that *is* `DEFERRABLE`, whether its default timing (which can also be changed per-transaction via `SET CONSTRAINTS constraint_name DEFERRED;`) is to check immediately after each statement, or wait until commit.

**Decision guidance**: "I'd leave the vast majority of foreign keys at the default, `NOT DEFERRABLE`, immediate-checking behavior -- catching a constraint violation the instant the offending statement runs is almost always what you want, since it points directly at the exact statement that caused the problem, rather than surfacing a confusing failure only at the very end of a larger transaction. I'd reach for `DEFERRABLE INITIALLY DEFERRED` specifically for the narrow, genuinely-circular-reference case -- like a `departments.head_employee_id` pointing at an `employees` row that itself references that same department -- where no valid intermediate insert order exists otherwise."

**Common mistake**: marking every foreign key `DEFERRABLE INITIALLY DEFERRED` by default "just in case," rather than reserving it for the specific circular-dependency case it exists for -- this makes constraint violations surface much later (at `COMMIT` time, potentially after many unrelated statements), making the actual offending statement far harder to pinpoint during debugging.

### 5.5 Every `ON DELETE` Behavior, in Full Theoretical Depth

**Theory first: what happens without any `ON DELETE` clause at all.** If no `ON DELETE` clause is specified, Postgres defaults to `NO ACTION` -- which, in the common case, behaves identically to `RESTRICT`: the delete is blocked. The precise, technical distinction between `RESTRICT` and `NO ACTION` (below) only becomes observable when `DEFERRABLE` is also involved.

**`RESTRICT`** -- unconditionally blocks the delete/update of the referenced row if any referencing rows still exist, and this check happens as part of the same statement, with **no ability to ever defer it** -- `RESTRICT` cannot be combined with `DEFERRABLE` at all.
```sql
ALTER TABLE employees
    DROP CONSTRAINT employees_department_id_fkey,
    ADD CONSTRAINT employees_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE RESTRICT;
```

**`NO ACTION`** (the default when nothing is specified) -- functionally the same outcome as `RESTRICT` in the overwhelming majority of cases, but with one precise difference: **timing**. `NO ACTION` performs its check as a deferred-capable constraint trigger, meaning if the constraint is also marked `DEFERRABLE`, the check for `NO ACTION` can be postponed to transaction-commit time -- allowing a delete-then-reinsert sequence *within the same transaction* to succeed, as long as by the time the transaction commits, no dangling reference remains. `RESTRICT`, by contrast, checks immediately, always, with no deferral option under any circumstance, even if you tried to mark it `DEFERRABLE` (Postgres will reject that combination outright).
```sql
-- Only possible with NO ACTION + DEFERRABLE -- NOT possible with RESTRICT, ever:
BEGIN;
DELETE FROM departments WHERE id = 1;             -- would violate the FK immediately... but the check is deferred
INSERT INTO departments (id, name) VALUES (1, 'Engineering (Reorganized)');   -- id 1 exists again by commit time
COMMIT;   -- succeeds, because at commit time, every employees.department_id = 1 reference is once again valid
```

**`CASCADE`** -- automatically deletes every referencing row along with the deleted parent row.
```sql
ALTER TABLE employee_projects
    ADD CONSTRAINT employee_projects_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE;
```
Deleting an employee here automatically removes every one of their `employee_projects` assignment rows -- appropriate because a project-assignment row has no independent meaning once the employee it describes no longer exists.

**`SET NULL`** -- sets the referencing column to `NULL` on the referencing rows, leaving those rows themselves intact.
```sql
ALTER TABLE employees
    ADD CONSTRAINT employees_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES employees (id) ON DELETE SET NULL;
```
Deleting a manager here doesn't delete their direct reports -- it simply clears their `manager_id`, leaving them "unmanaged" but still fully present, which is the correct behavior since an employee's own record has independent meaning regardless of who currently manages them.

**`SET DEFAULT`** -- sets the referencing column to whatever its declared `DEFAULT` value is (which must itself either be `NULL` or a value that actually exists in the referenced table, or the assignment will itself fail the constraint check).
```sql
ALTER TABLE employees ALTER COLUMN department_id SET DEFAULT 1;   -- e.g. a designated "Unassigned" department
ALTER TABLE employees
    ADD CONSTRAINT employees_department_id_fkey
    FOREIGN KEY (department_id) REFERENCES departments (id) ON DELETE SET DEFAULT;
```
Deleting department `1`'s replacement path aside, this pattern is most useful when there's a genuine, sensible fallback value to reassign orphaned rows to -- e.g. an explicit "Unassigned" department that always exists, rather than leaving the column `NULL` (which might not be a valid state for that particular business rule if `department_id` needs to stay `NOT NULL`).

**Decision table, applied to this specific schema, with reasoning:**

| Relationship | Chosen behavior | Reasoning |
|---|---|---|
| `employees.department_id -> departments.id` | `RESTRICT` | A department shouldn't be deletable while employees are still assigned to it -- force an explicit reassignment first, don't silently orphan or cascade-delete real people's employment records. |
| `employee_projects.employee_id -> employees.id` | `CASCADE` | A project-assignment row has zero meaning independent of the employee it describes -- deleting the employee should delete their assignment rows. |
| `employee_projects.project_id -> projects.id` | `CASCADE` | Symmetric reasoning: an assignment row has no meaning without the project either. |
| `employees.manager_id -> employees.id` | `SET NULL` | Deleting a manager shouldn't cascade-delete their entire reporting chain -- their direct reports should survive, simply left temporarily unmanaged. |
| `projects.department_id -> departments.id` | `RESTRICT` | Same reasoning as employees -- a department with active projects shouldn't be deletable out from under them. |

### 5.6 `ON UPDATE` Behaviors

**Theory first.** The same five options (`RESTRICT`, `NO ACTION`, `CASCADE`, `SET NULL`, `SET DEFAULT`) apply symmetrically to updates of the **referenced** table's key value -- not updates to the referencing column directly, but specifically what happens to child rows when the *parent's* key value itself changes. This clause is often skipped in tutorials precisely because surrogate keys (Section 3.6) are deliberately designed to never need updating -- but it becomes directly relevant the moment any part of a schema uses a natural key as a primary key, since natural keys, unlike surrogates, sometimes do legitimately need to change.

**A concrete example where `ON UPDATE CASCADE` genuinely matters** -- imagine `departments.id` were, hypothetically, a natural-key department code (`'ENG'`, `'SALES'`) rather than a surrogate integer, and the company renames a department code during a reorg:
```sql
CREATE TABLE departments_natural (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE employees_natural (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_code TEXT NOT NULL REFERENCES departments_natural (code) ON UPDATE CASCADE
);

INSERT INTO departments_natural VALUES ('ENG', 'Engineering');
INSERT INTO employees_natural (department_code) VALUES ('ENG');

UPDATE departments_natural SET code = 'ENGR' WHERE code = 'ENG';
-- ON UPDATE CASCADE automatically propagates: employees_natural.department_code
-- is updated from 'ENG' to 'ENGR' for every affected row, in the same statement, automatically.

SELECT department_code FROM employees_natural;
```
```
 department_code
------------------
 ENGR
```
Without `ON UPDATE CASCADE` here (i.e., under the default `NO ACTION`), the `UPDATE departments_natural SET code = 'ENGR' ...` statement would instead fail outright with a foreign key violation, since it would leave `employees_natural.department_code = 'ENG'` pointing at a code that no longer exists the moment the rename takes effect.

**Decision guidance**: "For this HR schema, since every primary key is a surrogate integer that's never intended to change, `ON UPDATE` is essentially moot everywhere -- I'd leave it at the default `NO ACTION` across the board. The one scenario where I'd reach for `ON UPDATE CASCADE` deliberately is exactly the natural-key case above -- a reference table keyed by a business code that occasionally needs to be renamed, where I want that rename to propagate automatically rather than requiring a separate, error-prone manual update of every referencing table."

### 5.7 Self-Referencing Foreign Keys -- A Full Org Chart Example

**Theory first.** A **self-referencing foreign key** is a foreign key column on a table that references the *same table's own* primary key -- used whenever rows in a table can meaningfully relate to other rows of that identical type, the canonical case being an employee referencing their own manager (also an employee).

```sql
ALTER TABLE employees
    ADD CONSTRAINT employees_manager_id_fkey
    FOREIGN KEY (manager_id) REFERENCES employees (id) ON DELETE SET NULL;
```

**Full worked example, building a small org chart:**
```sql
INSERT INTO employees (id, first_name, last_name, email, department_id, manager_id, salary, hire_date)
OVERRIDING SYSTEM VALUE
VALUES
    (1, 'Priya', 'Sharma', 'priya@company.com',  1, NULL, 210000, '2018-01-10'),  -- CEO, no manager
    (2, 'Dana',  'Lee',    'dana@company.com',   1, 1,    175000, '2019-03-01'),  -- reports to Priya
    (3, 'Sam',   'Okafor', 'sam@company.com',    2, 1,    168000, '2019-06-15'),  -- reports to Priya
    (4, 'Jordan','Ruiz',   'jordan@company.com', 1, 2,    120000, '2021-02-20');  -- reports to Dana
```

**A recursive query traversing the hierarchy** (the direct payoff of modeling this as a self-referencing foreign key rather than, say, a fixed number of "manager level" columns):
```sql
WITH RECURSIVE org_chart AS (
    SELECT id, first_name, last_name, manager_id, 1 AS depth
    FROM employees
    WHERE manager_id IS NULL

    UNION ALL

    SELECT e.id, e.first_name, e.last_name, e.manager_id, oc.depth + 1
    FROM employees e
    JOIN org_chart oc ON e.manager_id = oc.id
)
SELECT id, first_name, last_name, depth FROM org_chart ORDER BY depth, id;
```

**Failure example -- an employee cannot be their own manager's manager's manager in a way that creates a cycle pointing back to themselves at insert/update time** (Postgres does not detect deep cycles automatically at the constraint level -- this is a modeling responsibility, not something the foreign key itself prevents; what the foreign key *does* prevent is an employee referencing a `manager_id` that simply doesn't exist):
```sql
INSERT INTO employees (first_name, last_name, email, department_id, manager_id, salary, hire_date)
VALUES ('Test', 'Person', 'test@company.com', 1, 9999, 100000, '2026-01-01');
```
```
ERROR:  insert or update on table "employees" violates foreign key constraint "employees_manager_id_fkey"
DETAIL:  Key (manager_id)=(9999) is not present in table "employees".
```

**Decision guidance**: "I'd model a management hierarchy with a self-referencing foreign key rather than fixed columns like `manager_level_1_id`, `manager_level_2_id`, because the hierarchy depth is unbounded and organizationally variable -- a self-reference plus a recursive query scales to any depth with zero schema changes, while fixed columns would need a schema migration every time the org grows one level deeper, and would still cap out eventually."

### 5.8 Composite Foreign Keys

**Theory first.** A composite foreign key references a **composite primary or unique key** in another table -- both sides of the reference must match on *all* columns of the pair together, not independently.

**Full syntax and example** -- suppose, for illustration, `employee_projects` needed a further table tracking time-logged entries, referenced by the *combination* of employee and project, not by a separate surrogate id of `employee_projects` itself:
```sql
CREATE TABLE employee_projects (
    employee_id     INTEGER NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    project_id      INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    hours_allocated NUMERIC(5, 1) NOT NULL DEFAULT 0,
    PRIMARY KEY (employee_id, project_id)
);

CREATE TABLE time_log_entries (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     INTEGER NOT NULL,
    project_id      INTEGER NOT NULL,
    logged_date     DATE NOT NULL,
    hours           NUMERIC(4, 1) NOT NULL CHECK (hours > 0),
    CONSTRAINT time_log_entries_assignment_fkey
        FOREIGN KEY (employee_id, project_id)
        REFERENCES employee_projects (employee_id, project_id)
        ON DELETE CASCADE
);
```
This composite foreign key guarantees a time-log entry can only exist for an `(employee_id, project_id)` pair that is an actual, existing assignment in `employee_projects` -- not merely for an employee and a project that separately exist, but for the specific, real *pairing* of the two, which is exactly the real-world business rule ("you can only log time against a project you're actually assigned to").

**Failure example:**
```sql
-- Employee 4 exists, project 2 exists, but employee 4 was never assigned to project 2
INSERT INTO time_log_entries (employee_id, project_id, logged_date, hours)
VALUES (4, 2, '2026-03-01', 6.5);
```
```
ERROR:  insert or update on table "time_log_entries" violates foreign key constraint "time_log_entries_assignment_fkey"
DETAIL:  Key (employee_id, project_id)=(4, 2) is not present in table "employee_projects".
```

**Decision guidance**: "I'd use a composite foreign key here specifically because the real-world constraint isn't 'this employee exists and this project exists independently' -- it's 'this exact pairing is an actual assignment.' A pair of separate, independent foreign keys (`employee_id -> employees.id` and `project_id -> projects.id`) would only enforce the weaker, wrong rule; only the composite reference to `employee_projects`'s own composite key enforces the actual business rule I want."

### 5.9 Foreign Keys, `COPY`, and `TRUNCATE`

**`COPY`** (Postgres's high-throughput bulk-loading command) enforces foreign key constraints exactly like `INSERT` does -- every row is checked as it's loaded, and a single violating row aborts the entire `COPY` operation by default (unless run with `ON_ERROR ignore`-style options in newer Postgres versions, which skip and report bad rows instead of aborting outright).

**`TRUNCATE`, foreign keys, and `CASCADE`** -- theory first: `TRUNCATE` removes every row from a table in one operation, bypassing row-by-row processing entirely (Section 7 covers `TRUNCATE`'s full mechanics) -- but this creates an immediate referential-integrity problem if other tables still hold foreign keys pointing at the table being truncated, since instantly removing every row would leave every referencing row dangling.

**Failure example:**
```sql
TRUNCATE TABLE departments;
```
```
ERROR:  cannot truncate a table referenced in a foreign key constraint
DETAIL:  Table "employees" references "departments".
HINT:  Truncate table "employees" too, or use TRUNCATE ... CASCADE.
```

**`TRUNCATE ... CASCADE`**, explained precisely: this does **not** mean "cascade-delete matching rows the way `ON DELETE CASCADE` does" -- it means **also truncate every table that has a foreign key referencing the truncated table**, entirely, regardless of whether specific rows would have matched anything. This is a meaningfully blunter operation than `ON DELETE CASCADE`, and worth being precise about in an interview: `ON DELETE CASCADE` on a `DELETE` removes only the rows that actually reference the deleted rows; `TRUNCATE ... CASCADE` empties the *entire* referencing table, unconditionally.
```sql
TRUNCATE TABLE departments CASCADE;
-- Also fully empties employees, projects, and any other table with a FK pointing at departments,
-- REGARDLESS of which specific rows referenced which specific department.
```

**Common mistake**: assuming `TRUNCATE ... CASCADE` behaves like `ON DELETE CASCADE` (i.e., "delete only the matching related rows") -- it does not; it empties the entire dependent table unconditionally, which is a dramatically more destructive operation than most engineers expect the first time they encounter it, and has caused real production incidents when run against a table believed to have only a small subset of "related" rows worth removing.

---

## 6. `ALTER TABLE` -- Full Theory and Every Operation

### 6.1 Why Some `ALTER TABLE` Operations Are Instant and Others Rewrite the Entire Table

**Theory first.** Every row in a Postgres table is physically stored as a fixed-layout sequence of bytes on disk, in what's called the table's **heap**. Whether an `ALTER TABLE` operation is fast (a pure **catalog metadata change**, touching only the small system tables that describe the table's structure) or slow (a **full table rewrite**, physically reading and rewriting every existing row's bytes on disk) depends entirely on whether the change can be represented *without* touching any existing row's actual stored bytes.

- **Metadata-only changes** (near-instant, regardless of table size): dropping a column (the column's storage is just marked invisible/reclaimable, not physically removed row-by-row at that moment), renaming a column or table, adding a `CHECK`/`FOREIGN KEY` constraint with `NOT VALID` (Section 6.4), and -- since Postgres 11 -- adding a column with a **constant** `DEFAULT`.
- **Full table rewrite** (locks the table, and its duration scales with table size): changing a column's data type to one that isn't provably byte-compatible with the old type, adding a column with a **non-constant** default (e.g. `DEFAULT now()`, `DEFAULT gen_random_uuid()`) prior to certain optimizations, and any operation that fundamentally changes how each row's bytes need to be laid out on disk.

**The Postgres 11+ optimization for `ADD COLUMN ... DEFAULT constant`, explained precisely**: prior to Postgres 11, adding *any* column with a `DEFAULT` required rewriting every existing row to physically store that default value in the new column, which meant a multi-minute (or longer) exclusive lock on a large table just to add one column. Since Postgres 11, when the default is a plain constant (not a function call like `now()`), Postgres instead records the default value **once, in the table's own metadata**, and simply reports that value for any existing row that predates the column -- the actual row bytes on disk are never touched, and the operation becomes a near-instant catalog update regardless of table size.
```sql
-- Fast, metadata-only, in Postgres 11+ -- a constant default:
ALTER TABLE employees ADD COLUMN is_remote BOOLEAN NOT NULL DEFAULT false;

-- NOT eligible for the fast path -- a non-constant, function-evaluated default:
ALTER TABLE employees ADD COLUMN last_login_at TIMESTAMPTZ DEFAULT now();
-- (this one is comparatively cheap too in modern Postgres if the column is nullable and the
--  default only needs to apply going forward, but a NOT NULL + non-constant default combination
--  is exactly the case most likely to trigger a real rewrite -- verify against your exact
--  Postgres version's release notes before assuming either way on a large, live table)
```

### 6.2 `ADD COLUMN`, `DROP COLUMN`, `RENAME COLUMN`

**Runnable examples:**
```sql
ALTER TABLE employees ADD COLUMN phone TEXT;

ALTER TABLE employees DROP COLUMN phone;

ALTER TABLE employees RENAME COLUMN email TO work_email;
```

**Internals on `DROP COLUMN`**: Postgres does **not** immediately, physically remove the dropped column's bytes from every existing row on disk -- it marks the column dead in the catalog (`pg_attribute.attisdropped = true`) and simply excludes it from all future query results and `\d` output. The actual disk space is reclaimed later, incrementally, as rows are naturally rewritten by ordinary `UPDATE` activity or by a subsequent `VACUUM FULL`/table rewrite -- which is exactly why `DROP COLUMN` is a near-instant, metadata-only operation even on an enormous table, unlike what many developers assume.

**Failure example -- renaming a column that's referenced by a view or a foreign key constraint requires caution but generally still succeeds automatically, whereas dropping one referenced elsewhere does not:**
```sql
ALTER TABLE departments DROP COLUMN id;
```
```
ERROR:  cannot drop column id of table departments because other objects depend on it
DETAIL:  constraint employees_department_id_fkey on table employees depends on column id of table departments
HINT:  Use DROP ... CASCADE to drop the dependent objects too.
```

### 6.3 `ALTER COLUMN TYPE`, and Why It Can Require a Full Table Rewrite

**Theory first.** Changing a column's type requires Postgres to verify -- and in most cases, physically re-encode -- every existing value's on-disk byte representation into the new type's byte representation. Some type changes are byte-compatible and provably safe without touching any row (e.g. `VARCHAR(50)` to `VARCHAR(100)` -- purely widening a length limit changes nothing about how existing values are stored) and are handled as fast metadata-only changes. Most others -- `TEXT` to `INTEGER`, `INTEGER` to `BIGINT`, changing a `NUMERIC`'s precision/scale -- require rewriting every row's actual value into the new type's storage format, which means a full table rewrite, and an `ACCESS EXCLUSIVE` lock (blocking all reads and writes) for the operation's entire duration.

**Full syntax, including an explicit conversion:**
```sql
ALTER TABLE employees ALTER COLUMN salary TYPE NUMERIC(12, 2);

-- With an explicit USING clause, needed whenever the conversion isn't automatically obvious to Postgres:
ALTER TABLE projects ALTER COLUMN budget TYPE TEXT USING budget::TEXT;
```

**Failure example -- attempting a type change Postgres cannot automatically infer a conversion for:**
```sql
ALTER TABLE employees ALTER COLUMN hire_date TYPE INTEGER;
```
```
ERROR:  column "hire_date" cannot be cast automatically to type integer
HINT:  You might need to specify "USING hire_date::integer".
```
(And even with an explicit `USING` clause supplied, this particular cast would still fail at the value level, since a `DATE` doesn't have a sensible direct numeric interpretation Postgres will perform implicitly -- illustrating that `USING` tells Postgres *how* to attempt the conversion, not that the conversion is guaranteed to make sense.)

**Decision guidance**: "On a small table, or in early development, I wouldn't think twice about a direct `ALTER COLUMN TYPE`. On a large, live production table, I'd always check whether the specific type change is one of the known byte-compatible fast paths first -- and if it isn't, I'd plan the change as an explicit, deliberate maintenance-window operation (or use the add-new-column-backfill-swap pattern from the broader Postgres reference material's zero-downtime migration section), rather than running a blocking rewrite against live traffic."

### 6.4 `ADD CONSTRAINT` / `DROP CONSTRAINT`, and the `NOT VALID` + `VALIDATE CONSTRAINT` Production Pattern

**Theory first.** Adding a `CHECK` or `FOREIGN KEY` constraint to a table that **already has data** normally requires Postgres to scan the *entire existing table*, checking every row against the new rule, before the constraint can be considered active -- and by default, this full validation scan happens while holding a lock that blocks concurrent writes, for however long the scan takes. On a small table this is invisible; on a large, high-traffic production table, this can mean minutes of blocked writes just to add a constraint.

**The production-safe two-step pattern**: add the constraint with `NOT VALID` first (an instant, metadata-only change that starts enforcing the rule for all **new** writes immediately, without scanning any existing row), then separately run `VALIDATE CONSTRAINT` afterward, which scans existing rows but takes a much less disruptive lock (allowing concurrent reads and writes to continue throughout the scan, in contrast to the full validating `ADD CONSTRAINT` path):

```sql
-- Step 1: instant. Enforced for all NEW rows from this moment forward. Existing rows unchecked so far.
ALTER TABLE employees
    ADD CONSTRAINT employees_salary_positive CHECK (salary > 0) NOT VALID;

-- Step 2: scans existing rows, but with a much lighter lock than a combined ADD CONSTRAINT would need --
-- concurrent reads/writes are NOT blocked for the scan's duration.
ALTER TABLE employees VALIDATE CONSTRAINT employees_salary_positive;
```

**Failure example -- what `VALIDATE CONSTRAINT` reports if pre-existing data actually violates the new rule:**
```sql
ALTER TABLE employees VALIDATE CONSTRAINT employees_salary_positive;
```
```
ERROR:  check constraint "employees_salary_positive" of relation "employees" is violated by some row
```
(Notably, this error does **not** identify *which* row -- a real, practical limitation of this pattern: you'll need a separate diagnostic query, e.g. `SELECT * FROM employees WHERE NOT (salary > 0);`, to actually find and fix the offending data before `VALIDATE CONSTRAINT` can succeed.)

**Decision guidance**: "For any constraint being added to a table I know is large and actively receiving production traffic, I'd always use the `NOT VALID` + `VALIDATE CONSTRAINT` two-step pattern rather than a single combined `ADD CONSTRAINT`, specifically to avoid a long-held blocking lock during the historical-data scan. For a small table, or a genuinely new one with no existing rows, the two-step pattern adds unnecessary ceremony -- a plain `ADD CONSTRAINT` validates instantly anyway, since there's no historical data to check."

**Common mistake**: forgetting that a constraint added with `NOT VALID` and never followed up with `VALIDATE CONSTRAINT` remains permanently unvalidated against pre-existing rows -- it fully protects all future writes, but the schema (and anyone querying `pg_constraint.convalidated`) will show it as still technically "not validated," which can be a genuine, silent data-quality gap if the follow-up step is simply forgotten.

---

## 7. `DROP TABLE` vs. `TRUNCATE` vs. `DELETE` -- Full Theoretical Comparison

### 7.1 MVCC, Explained at a Conceptual Level

**Theory first.** Postgres uses **Multi-Version Concurrency Control (MVCC)**: when a row is updated or deleted, Postgres does **not** overwrite or immediately remove the old row version in place. Instead, an `UPDATE` writes an entirely new row version and marks the old one as no longer current; a `DELETE` marks the existing row version as deleted, without physically erasing its bytes at that moment. Every row version carries hidden metadata (`xmin`/`xmax`, the transaction IDs that created and expired it) that determines which transactions are allowed to "see" it. This is precisely what lets a long-running read never block a concurrent write, and vice versa: a reader that started before a delete/update committed continues to see the old, consistent row version for the remainder of its own transaction, entirely unaffected by the concurrent change happening in parallel.

The direct, unavoidable consequence: **dead row versions accumulate** on disk after every `UPDATE`/`DELETE`, until a separate process (`VACUUM`, run automatically in the background by `autovacuum`) comes along and reclaims that space for reuse. This single architectural fact -- that deletion doesn't mean immediate physical removal -- is exactly what explains why `DELETE` and `TRUNCATE` behave so differently in cost and locking, covered next.

### 7.2 `DELETE`

**Theory first, mapped onto MVCC.** `DELETE` operates **row by row**: for every matching row, Postgres marks that specific row version as deleted (setting its `xmax`), writes this action to the write-ahead log (WAL) for durability and replication, and -- if any are defined -- fires row-level `DELETE` triggers once per row. Because each row is individually marked (not physically erased), and each marking is logged, `DELETE` is fully transactional and can be rolled back cleanly at any point before commit.

```sql
DELETE FROM employee_projects WHERE project_id = 3;
```

**Key properties**: supports an arbitrary `WHERE` clause; fires row-level triggers (relevant for audit logging); does **not** reset any identity/`SERIAL` sequence, even if every row is deleted (the sequence's internal counter is entirely independent bookkeeping, untouched by `DELETE`); acquires only a `ROW EXCLUSIVE` lock, which does not block concurrent reads or even most other concurrent writes to different rows.

### 7.3 `TRUNCATE`

**Theory first, mapped onto MVCC.** `TRUNCATE` takes an entirely different approach: rather than individually marking each row as deleted, it **deallocates the underlying storage pages the table occupies, directly** -- conceptually closer to "point the table at a fresh, empty set of pages" than "remove each row one at a time." This is why `TRUNCATE` is dramatically faster than `DELETE` on a large table: its cost is essentially constant, independent of how many rows the table held, whereas `DELETE`'s cost scales with row count.

Direct consequences of this different mechanism:
- **Cannot take a `WHERE` clause** -- there's no concept of "deallocate only some of the pages matching a condition"; it's all-or-nothing by table.
- **Row-level triggers do not fire by default** -- since no individual row is ever processed, there's no per-row trigger invocation point; Postgres does support **statement-level `TRUNCATE` triggers** specifically (`CREATE TRIGGER ... BEFORE TRUNCATE ...`) for cases needing to react to a truncation event itself, but ordinary `BEFORE`/`AFTER DELETE` row triggers are silently skipped entirely.
- **Resets identity/`SERIAL` sequences by default** -- via `RESTART IDENTITY`, discussed below -- a direct, deliberate design choice distinct from `DELETE`'s behavior.
- **Still fully transactional in Postgres** -- unlike some other RDBMS where `TRUNCATE` is an implicit auto-commit DDL operation, Postgres's `TRUNCATE` can be rolled back like any other statement within a transaction:
```sql
BEGIN;
TRUNCATE TABLE employee_projects;
ROLLBACK;   -- fully undoes the truncate -- the rows are back, exactly as before
```
- **Requires an `ACCESS EXCLUSIVE` lock** -- the strongest lock level in Postgres, blocking not just concurrent writes but **all concurrent reads too**, for the (typically very brief) duration of the operation. This is a meaningfully more disruptive lock than `DELETE`'s `ROW EXCLUSIVE`, even though `TRUNCATE` itself usually completes far faster.

**`RESTART IDENTITY` vs. `CONTINUE IDENTITY`:**
```sql
TRUNCATE TABLE employee_projects;                        -- default: CONTINUE IDENTITY -- sequence keeps its current value
TRUNCATE TABLE employee_projects RESTART IDENTITY;        -- explicitly resets any identity sequence back to its start value
```

**`TRUNCATE ... CASCADE`** was already covered precisely in Section 5.9 -- worth re-emphasizing here in the comparison context: it empties every dependent table unconditionally, not just "related" rows.

### 7.4 `DROP TABLE`

**Theory first.** `DROP TABLE` is categorically different from both of the above: it doesn't just remove data, it **removes the table's definition itself** from the schema entirely -- the table, its columns, its constraints, and its indexes all cease to exist. Any other database object that depends on the table (a foreign key from another table, a view selecting from it) must either not exist, or be explicitly acknowledged via `CASCADE`.

```sql
DROP TABLE employee_projects;             -- fails if anything still depends on it
DROP TABLE employee_projects CASCADE;     -- also drops dependent constraints/views/etc.
DROP TABLE IF EXISTS employee_projects;   -- no error if the table doesn't exist -- safe for idempotent scripts
```

**Failure example:**
```sql
DROP TABLE departments;
```
```
ERROR:  cannot drop table departments because other objects depend on it
DETAIL:  constraint employees_department_id_fkey on table employees depends on table departments
HINT:  Use DROP ... CASCADE to drop the dependent objects too.
```

### 7.5 Comparison Table and a Worked Example

| Aspect | `DELETE` | `TRUNCATE` | `DROP TABLE` |
|---|---|---|---|
| Removes | Selected rows | All rows | The table itself |
| Supports `WHERE` | Yes | No | N/A |
| Speed on a large table | Slow (row-by-row) | Fast (page deallocation) | Fast (metadata removal) |
| Row-level triggers fire | Yes | No (statement-level `TRUNCATE` triggers only) | N/A |
| Resets identity sequence | No | Yes, by default (`RESTART IDENTITY`) | N/A (table no longer exists) |
| Lock level | `ROW EXCLUSIVE` | `ACCESS EXCLUSIVE` | `ACCESS EXCLUSIVE` |
| Transactional / rollback-able | Yes | Yes (in Postgres specifically) | Yes |
| Table structure survives | Yes | Yes | No |

**Worked example -- choosing correctly across a realistic maintenance scenario:**
```sql
-- Scenario 1: remove only completed projects older than 5 years -- needs a WHERE clause -> DELETE
DELETE FROM projects WHERE end_date < now() - INTERVAL '5 years';

-- Scenario 2: wipe all seed/test data from employee_projects between test runs, want it fast,
-- don't care about resetting counters meaningfully (no identity column on this junction table anyway) -> TRUNCATE
TRUNCATE TABLE employee_projects;

-- Scenario 3: an entire feature is being deprecated and this table should no longer exist at all -> DROP TABLE
DROP TABLE deprecated_legacy_timesheets;
```

**Decision guidance**: "I'd reach for `DELETE` any time I need conditional removal or need row-level triggers (like audit logging) to fire. I'd reach for `TRUNCATE` specifically when I want to remove every row from a table quickly -- most commonly between automated test runs -- and don't need per-row trigger behavior. I'd only reach for `DROP TABLE` when the table itself, not just its data, should cease to exist -- and I'd always use `IF EXISTS` in any idempotent setup/teardown script to avoid an unnecessary error on a repeat run."

---

## 8. Schemas -- Full Theory

### 8.1 Schemas as Namespaces, and the `search_path`

**Theory first.** A schema is a namespace *within* a single database (Section 1.2) -- multiple schemas can each contain a table with the identical name (`public.audit_log` and `hr_archive.audit_log` can coexist without conflict), and permissions can be granted per-schema, making schemas a natural tool for logically separating concerns within one database (e.g. separating an application's core tables from an `audit`/reporting layer) or for genuine multi-tenancy (one schema per tenant, sharing the same database and connection pool).

When a query references a table **without** an explicit schema prefix (`SELECT * FROM employees` rather than `SELECT * FROM public.employees`), Postgres resolves it by searching, in order, through the schemas listed in the current connection's **`search_path`** setting -- the first schema in that list containing a matching table name wins.

```sql
SHOW search_path;
```
```
 search_path
--------------
 "$user", public
```
(`"$user"` is a special placeholder meaning "a schema named after the currently connected role, if one exists" -- checked first, before falling back to `public`.)

```sql
SET search_path TO hr_archive, public;
```
From this point in the session, an unqualified `employees` reference checks `hr_archive.employees` first, falling back to `public.employees` only if no such table exists in `hr_archive`.

### 8.2 Full Example: Multiple Schemas, Cross-Schema Foreign Keys, and Permissions

```sql
CREATE SCHEMA audit;

CREATE TABLE audit.employee_change_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id  INTEGER NOT NULL REFERENCES public.employees (id) ON DELETE CASCADE,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_type  TEXT NOT NULL,
    changed_by   TEXT
);
```

This is a genuine, fully-enforced **cross-schema foreign key**: `audit.employee_change_log.employee_id` references `public.employees.id`, and Postgres enforces it identically to a same-schema foreign key -- referential integrity is a database-wide (within one database) guarantee, not scoped to a single schema.

**Permission implications**: schema-level access is its own separate permission, distinct from table-level grants -- a role needs `USAGE` on a schema *before* any table-level `GRANT` within that schema has any effect at all (without `USAGE`, the role can't even "see into" the schema to resolve an unqualified or qualified reference to a table inside it):
```sql
GRANT USAGE ON SCHEMA audit TO reporting_role;
GRANT SELECT ON audit.employee_change_log TO reporting_role;
```

**Common mistake**: granting `SELECT` on a table inside a non-`public` schema, but forgetting the separate, required `GRANT USAGE ON SCHEMA ...` -- the role's queries will fail with a permission error that looks like the table-level grant didn't work, when the actual missing piece is schema-level `USAGE`.

---

## 9. Putting It Together -- A Complete Worked Schema

This section designs the full HR schema from a blank slate, narrating the reasoning at each step the way you'd talk through a system design interview out loud -- then presents every `CREATE TABLE` statement together, in correct dependency order.

**Narration, step by step:**

"I'll start by identifying the core entities: departments, employees, projects, and the relationship between employees and projects. Since projects can have many employees and employees can work on many projects, that's a many-to-many relationship, which means I'll need a junction table -- `employee_projects` -- rather than a foreign key on either side alone.

"I always create tables in dependency order -- a table can't have a foreign key referencing a table that doesn't exist yet. So `departments` comes first, since both `employees` and `projects` will reference it, and neither `employees` nor `projects` are referenced by anything that needs to exist before them.

"For `departments`, I'll use a surrogate `IDENTITY` primary key rather than the department name, specifically because department names get renamed during reorganizations, and I never want a rename to force cascading foreign key updates everywhere. I'll add `UNIQUE` on `name` separately, since 'no two departments share a name' is a real business rule, just not one that should double as row identity.

"For `employees`, I need a self-referencing `manager_id` for the org hierarchy -- nullable, because the most senior person has no manager, and `SET NULL` on delete, because removing a manager from the system shouldn't cascade-delete their entire reporting chain. `department_id` is `NOT NULL` -- every employee must belong to a department -- and `RESTRICT` on delete, because I don't want a department deletable while people are still assigned to it; that should require an explicit reassignment step first, not a silent cascade that could look like mass employee deletion. I'll add a `CHECK` on `salary` to keep it positive, and `UNIQUE` on `email` as a real, separate business rule from the primary key.

"For `projects`, I'll add a multi-column `CHECK` ensuring `end_date` is never before `start_date` if it's set at all -- that's a same-row, cross-column rule, exactly what `CHECK` is designed for, and it can't reference other rows or tables, which this rule doesn't need to anyway.

"Finally, `employee_projects` is the junction table -- its primary key is the composite `(employee_id, project_id)`, because the *pairing itself* is the entity being modeled here, not some separate, independently-meaningful thing that happens to have two foreign keys. Both foreign keys cascade on delete, since an assignment record has no meaning independent of either the employee or the project it connects."

**The complete, ordered schema:**

```sql
-- 1. departments -- referenced by employees and projects, so it must exist first
CREATE TABLE departments (
    id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name   TEXT NOT NULL UNIQUE,
    budget NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0)
);

-- 2. employees -- references departments (must exist), and self-references employees (fine,
--    a table can reference itself since it's the same table already being created)
CREATE TABLE employees (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    department_id INTEGER NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
    manager_id    INTEGER REFERENCES employees (id) ON DELETE SET NULL,
    salary        NUMERIC(10, 2) NOT NULL CHECK (salary > 0),
    hire_date     DATE NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. projects -- references departments, which already exists by this point
CREATE TABLE projects (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          TEXT NOT NULL,
    department_id INTEGER NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
    start_date    DATE NOT NULL,
    end_date      DATE,
    budget        NUMERIC(12, 2) NOT NULL CHECK (budget >= 0),
    CONSTRAINT projects_valid_date_range CHECK (end_date IS NULL OR end_date >= start_date)
);

-- 4. employee_projects -- the many-to-many junction table; references BOTH employees and
--    projects, so it must be created last among these four
CREATE TABLE employee_projects (
    employee_id     INTEGER NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
    project_id      INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    hours_allocated NUMERIC(5, 1) NOT NULL DEFAULT 0 CHECK (hours_allocated >= 0),
    PRIMARY KEY (employee_id, project_id)
);

-- Supporting indexes: recall from the referential-integrity discussion that Postgres does
-- NOT automatically index foreign key columns -- only primary/unique keys get an automatic
-- index. Every foreign key above that will be frequently joined/filtered on needs one explicitly:
CREATE INDEX idx_employees_department_id ON employees (department_id);
CREATE INDEX idx_employees_manager_id    ON employees (manager_id);
CREATE INDEX idx_projects_department_id  ON projects (department_id);
CREATE INDEX idx_employee_projects_project_id ON employee_projects (project_id);
-- (employee_projects.employee_id is already the leading column of the composite primary key,
--  so it's already covered by that automatically-created index -- no separate index needed for it.)
```

---

## 10. Interview-Ready Summary

**1. What's the difference between entity integrity, domain integrity, and referential integrity?**
"Entity integrity means every row must be uniquely and unambiguously identifiable -- that's what a primary key enforces, and it's why a primary key can never be `NULL`. Domain integrity means every individual column's value must belong to that column's legal set of values -- its data type, its nullability, and any `CHECK` rules. Referential integrity means a foreign key value must either be `NULL` or match something that actually exists in the table it references -- it's the rule that prevents dangling references between tables."

**2. Why can a primary key never contain `NULL`?**
"Because `NULL` represents an unknown value, and two `NULL`s are never considered equal to each other. If a primary key allowed `NULL`, two different rows could both have an 'unknown' identity, and the database would have no way to tell whether they represent the same real-world entity or two entirely different ones -- which defeats the entire purpose of a unique identifier."

**3. Why does `WHERE column = NULL` never return any rows, even rows where the column actually is `NULL`?**
"SQL uses three-valued logic -- `TRUE`, `FALSE`, and `UNKNOWN` -- not just `TRUE`/`FALSE`. Any comparison involving `NULL`, including `NULL = NULL`, evaluates to `UNKNOWN`, not `TRUE`, because the database can't know whether two unknowns represent the same thing. A `WHERE` clause only returns rows where the condition is `TRUE` -- `UNKNOWN` is treated like `FALSE` for filtering. That's why you need `IS NULL` specifically, which is a dedicated predicate for testing nullness rather than a comparison."

**4. How does Postgres actually enforce a `UNIQUE` or `PRIMARY KEY` constraint internally?**
"It automatically creates a unique B-tree index on the constrained column or columns -- there's no separate uniqueness-checking mechanism apart from the index itself. Every insert or update that touches those columns is checked against that index, and a duplicate is rejected right there. This is also why primary key lookups are fast by default with zero extra setup -- the index that enforces the constraint doubles as a performance structure."

**5. Why are multiple `NULL`s allowed in a `UNIQUE` column?**
"Because uniqueness is enforced via an index comparison, and `NULL` is never considered equal to another `NULL` -- there's simply nothing for the index to flag as a collision between two `NULL` entries. I can prove this directly: inserting two rows with `NULL` in a `UNIQUE` column both succeed without error."

**6. What's the actual mechanism behind foreign key enforcement in Postgres?**
"A foreign key constraint generates a pair of implicit constraint triggers -- one on the referencing table, checking on insert/update that the new value exists in the referenced table; and one on the referenced table, checking or acting on delete/update of the referenced row, according to whatever `ON DELETE`/`ON UPDATE` behavior is configured. These run as `AFTER` triggers, checking the end state after the statement's changes are applied, which is also what makes deferred constraint checking possible."

**7. When would you actually need a `DEFERRABLE` constraint?**
"Specifically when two rows need to reference each other within a single transaction, and neither can be validly inserted first without briefly violating the constraint -- like a department with a `head_employee_id` and an employee with a `department_id`, where the very first department and its very first head employee have to be inserted together. `DEFERRABLE INITIALLY DEFERRED` postpones the check to commit time, by which point both rows fully exist and reference each other correctly."

**8. What's the precise difference between `RESTRICT` and `NO ACTION` on a foreign key?**
"In the common case, they behave identically -- both block a delete or update that would leave a dangling reference. The precise difference is about deferral: `RESTRICT` can never be deferred, under any circumstance, even if you tried to mark it `DEFERRABLE`. `NO ACTION` is deferral-capable -- if the constraint is also marked `DEFERRABLE`, its check can be postponed to commit time, which allows a delete-then-reinsert sequence within one transaction to succeed as long as the final state is valid by commit."

**9. Explain `CASCADE` vs. `SET NULL` on delete, and how you'd choose between them.**
"`CASCADE` automatically deletes the referencing rows along with the parent; `SET NULL` clears the referencing column but keeps the row. I'd choose `CASCADE` when the dependent row has no independent meaning without its parent -- like a project-assignment row without the employee it describes. I'd choose `SET NULL` when the dependent row's own identity matters independently of the relationship -- like an employee record surviving even after their manager is deleted from the system."

**10. Why doesn't `DEFAULT` apply on `UPDATE`?**
"Because `DEFAULT` specifically means 'the value to use when an `INSERT` doesn't supply one' -- it's not a general fallback rule re-checked on every write. An ordinary `UPDATE` that doesn't mention a given column leaves that column completely untouched; there's no mechanism by which an unmentioned column in an `UPDATE` would revert to its default. If I need a column to update automatically on every write -- like `updated_at` -- I need a trigger, because that's a fundamentally different requirement: 'run on every write,' not 'only when a value is omitted.'"

**11. Why is `TRUNCATE` so much faster than `DELETE` on a large table, and what's the trade-off?**
"`DELETE` processes rows one at a time -- marking each row version as deleted under MVCC, logging each removal, and firing any row-level triggers -- so its cost scales with the number of rows. `TRUNCATE` deallocates the underlying storage pages directly, without processing individual rows at all, so its cost is roughly constant regardless of table size. The trade-off is `TRUNCATE` can't take a `WHERE` clause, doesn't fire ordinary row-level triggers, and takes a much stronger lock -- `ACCESS EXCLUSIVE`, which blocks all concurrent reads, not just writes -- versus `DELETE`'s much lighter `ROW EXCLUSIVE` lock."

**12. What does `TRUNCATE ... CASCADE` actually do, and how is it different from `ON DELETE CASCADE`?**
"They sound similar but aren't. `ON DELETE CASCADE` deletes only the specific rows in a referencing table that actually pointed at the deleted row. `TRUNCATE ... CASCADE` empties the *entire* referencing table unconditionally -- every row, regardless of what it referenced. I'd be very careful before running it, since it's a much blunter, more destructive operation than its name suggests at first glance."

**13. Why do some `ALTER TABLE` operations run instantly and others lock the table for a long time?**
"It comes down to whether the change can be represented as a pure metadata update, or requires physically rewriting every existing row's bytes on disk. Renaming a column or table, dropping a column, and -- since Postgres 11 -- adding a column with a constant default, are all metadata-only and near-instant regardless of table size. Changing a column's data type to something that isn't byte-compatible with the old type requires rewriting every row and holds an exclusive lock for the whole operation."

**14. How would you safely add a `NOT NULL` foreign key or `CHECK` constraint to a large, live production table?**
"I'd add it with `NOT VALID` first -- that's an instant, metadata-only change that starts enforcing the rule for every new write immediately, without scanning existing data. Then I'd run `VALIDATE CONSTRAINT` as a separate step, which does scan the existing rows but takes a much lighter lock that doesn't block concurrent reads and writes for its duration. Doing it as one combined `ADD CONSTRAINT` on a large table would hold a much more disruptive lock for the entire validation scan."

**15. Why would you ever choose a composite primary key over a surrogate key, and when is it actually a bad idea?**
"A composite key is the right choice when the table represents the relationship itself -- a junction table like `employee_projects`, where the combination of employee and project *is* the entity, and the composite key directly encodes the real business rule that an employee shouldn't be assigned to the same project twice. It becomes a bad idea when it's applied to a table that actually represents an independent entity that just happens to have two identifying columns -- forcing every foreign key elsewhere that needs to reference that entity to carry both columns, for no real modeling benefit over a plain surrogate key."
