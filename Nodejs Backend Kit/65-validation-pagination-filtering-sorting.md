---
title: "Validation, Pagination, Filtering & Sorting"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/validation-pagination
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Validation, Pagination, Filtering & Sorting

*10 min read · Updated 24 Jul 2026 Topic 41 of 70 Bookmark Mark done Why it matters Every input to your API is a potential attack · Topic 41 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/validation-pagination](https://www.geekyfrontend.in/learn/nodejs-backend-kit/validation-pagination)

---

## Say it in 30 seconds

Validation checks body, query, and path values for the right types and limits before business code runs, and pagination returns one bounded page instead of every row. A page is either skip this many rows, or rows after a cursor, and a cursor is a bookmark of the last row you saw. Filtering and sorting narrow that page only on fields you have listed, so a bad or huge request never reaches the database. The trade-off is that cursor pages cannot jump to page 47, only forward or back from where you are.

## Why it matters

Every input is a possible crash, a bad write, or an attack. An endpoint that stores `req.body.age` with no check will accept `"banana"`, `-5`, or a huge string. Validation at the boundary is what makes the handler able to trust its input.

Pagination is the scale problem. `GET /users` that returns every row is fine at 100 rows and takes the database down at 10 million. Offset pagination, skip this many rows, has a flaw that shows up only at volume. Cursor pagination is the alternative.

Filtering and sorting are the rest of a real list endpoint: `?status=active&sort=-createdAt`. The craft is doing that without letting a client string become SQL, and without sorting a huge table by a column that has no index.

## The concept, simply

Validation means you declare a schema, a description of the shape, and a library checks the request against it. Example rules: email must be an email, age must be an integer from 0 to 150, role must be `admin` or `user`.

![Request flowing through validate step into controller with a fail branch to 422](assets/i38_01_5fdc1a01.svg)

Validate at the edge. Typed data reaches the controller. Invalid input stops at 422.

Three libraries dominate. **Joi** is mature, chainable, and not tied to a framework. **Zod** is TypeScript-first and infers static types from the schema. It is the usual pick in new code. **express-validator** is middleware around validator.js. You define the schema once, validate, and get coerced data out. Coercion means `"25"` becomes the number `25`.

**Pagination** returns a bounded chunk. Offset pagination uses `?page=3&limit=20`. Cursor pagination uses `?after=<opaque-cursor>`. An opaque cursor is a token the client treats as meaningless and sends back. **Filtering** narrows by field (`?status=active`). **Sorting** orders (`?sort=-createdAt` for newest first).

## How it works (deep)

**Validation is middleware that runs before the controller.** It parses the request against the schema. On success it stores the coerced value, with unknown keys removed, on `res.locals.validated`. It does not write back onto `req`. In Express 5, `req.query` is a getter and cannot be reassigned (changed in v5). On failure it answers 422 with a list of what was wrong. The controller then trusts the input. The rules live in one schema instead of in scattered `if` checks.

Validate query and path params too, not only the body. `?limit=999999` and `?limit=abc` have to be caught. A common bug is a careful JSON schema and a `req.query.limit` passed straight through as SQL `LIMIT`. Coerce pagination params and clamp them. A clamp is a hard maximum.

**Offset pagination** is `LIMIT 20 OFFSET 40`: skip 40 rows, return the next 20. Clients can jump to any page. It has two flaws at scale.

![Side by side of offset pagination and cursor pagination with pros and cons](assets/i38_02_a09365f2.svg)

Offset is simple and drifts at scale. A cursor stays fast and stable, and it cannot jump to an arbitrary page.

Flaw one is performance. `OFFSET 1000000` makes the database walk and discard a million rows before it returns twenty. It gets slower the deeper you page. Flaw two is drift. If a row is inserted while the user pages, the offsets shift, so a row can appear twice or disappear. For a stable high-volume feed that is unacceptable.

**Cursor pagination, also called keyset pagination,** says "give me rows after this point." The point is often a base64 encoding of the last row's sort key and id. The query is `WHERE (created_at, id) < (cursor time, cursor id) ORDER BY created_at DESC, id DESC LIMIT 20`. It seeks an index instead of scanning and discarding, so depth does not slow it down. Inserts do not skip or repeat rows, because you are anchored to a real row, not to a count. You cannot jump to page 47. You can only move from where you are. That fits infinite scroll. Twitter, Slack, and the GitHub API use cursors.

**Filter and sort through an allow-list.** Never paste `req.query.sort` into raw SQL. That is injection. Map `?sort=-createdAt` to a known column and direction, and reject anything else. Validate filter fields the same way, and send values as parameters or through the ORM. Sort only indexed columns. Letting a client sort ten million rows by an unindexed field is a denial of service you handed them.

## Code examples

A reusable Zod validation middleware — declare the schema once, get clean data or a 422.

javascript

```
const { z } = require('zod');

// Generic middleware: validate a chosen part of the request
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(422).json({
        error: 'Validation failed',
        details: result.error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    // coerced + stripped — controller trusts this. Don't write it back to req[source]:
    // in Express 5 req.query is a getter, so the assignment throws (ESM/strict) or is ignored.
    res.locals.validated = { ...res.locals.validated, [source]: result.data };
    next();
  };
}

const createUserSchema = z.object({
  email: z.string().email(),
  age: z.coerce.number().int().min(0).max(150),
  role: z.enum(['admin', 'user']).default('user'),
}).strict(); // reject unknown keys

router.post('/users', validate(createUserSchema), createUser); // createUser reads res.locals.validated.body
```

Validating and clamping pagination query params so a client can never demand a million rows:

javascript

```
const pageQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20), // hard ceiling
  sort:  z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

router.get('/users', validate(pageQuerySchema, 'query'), listUsers);

// Real output, GET /users with no query string (Express 5.2.1, Zod 4.6.5, Node v24.19.0):
//   old `req[source] = result.data`, CommonJS → 200 {"skip":null,"typeofPage":"undefined"}  (assignment silently ignored)
//   old `req[source] = result.data`, ESM      → 500 "Cannot set property query of #<IncomingMessage> which has only a getter"
//   res.locals.validated                      → 200 {"page":1,"limit":20,"skip":0,"typeofPage":"number"}
```

> **Why this was wrong:** the earlier version wrote the parsed data back with `req[source] = result.data`. That worked for `req.query` in Express 4, but Express 5 defines `req.query` as a getter, so the defaults and coercion were lost (or the request crashed in strict-mode code).

Offset pagination with a metadata envelope so clients know how to navigate:

javascript

```
async function listUsers(req, res) {
  const { page, limit, status } = res.locals.validated.query; // numbers, defaults applied
  const filter = status ? { status } : {};

  const [items, total] = await Promise.all([
    User.find(filter).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    data: items,
    pagination: {
      page, limit, total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
    },
  });
}
```

Cursor pagination with safe, allow-listed sorting — the version you reach for at scale:

javascript

```
// Allow-list maps client tokens to real, indexed columns + direction
const SORTABLE = { createdAt: 'created_at', name: 'name' };

async function feed(req, res) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const cursor = req.query.after
    ? JSON.parse(Buffer.from(req.query.after, 'base64').toString())
    : null;

  // Keyset: fetch rows strictly "after" the cursor's (createdAt, id)
  const rows = await Post.findAfter(cursor, limit + 1); // +1 to detect more
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const last = page[page.length - 1];
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64')
    : null;

  res.json({ data: page, nextCursor });
}
```

## Common mistakes & gotchas

- **Validating only the body.** Query and path are input too. `?limit=99999999` and a hostile id have to be checked.
- **No ceiling on `limit`.** `?limit=1000000` can exhaust memory and stall the database. Clamp it.
- **Deep offsets.** `OFFSET 500000` is slow and drifts when rows are inserted. Use cursors for large or fast-changing lists.
- **Pasting sort or filter fields into SQL.** That is injection. Allow-list the names. Parameterize the values.
- **Sorting on a column with no index.** The client can force a full-table sort.
- **Trusting query types.** `req.query.limit` is a string. Coerce it.
- **Returning stack traces or database text.** Return which fields failed.
- **Hand-written checks inside the controller.** The rules drift. Keep them in the schema.

## Best practices

- Validate body, query, and params with a schema in middleware, before the controller. Zod, Joi, or express-validator all fit.
- Coerce types and strip unknown keys so the controller can trust the object.
- Return 422 with a list of field errors, not a stack trace.
- Default `limit`, cap it, and require `page` to be at least 1.
- Use cursors for large or fast-changing feeds. Offset is enough for a small, stable admin table.
- Allow-list sortable and filterable fields, map them to indexed columns, and parameterize values.
- Return one envelope, `{ data, pagination }` or `{ data, nextCursor }`, so every list works the same way.

## ⭐ Interview lens

> **Q: Where should validation happen, and why there?**  
> Validation happens at the edge, in middleware that runs before the controller. Middleware here is a function in the request chain. The schema parses body, query, and params, coerces types, and strips unknown keys. On success the clean object goes on `res.locals.validated`. On failure the response is 422 and the controller never runs, so bad input never reaches business rules or the database. For example, a user schema can require an email, coerce age from the string `"25"` to the number 25, and reject role `superuser` before `User.create` is called. The limit in Express 5 is that you must not write the result back with `req.query = parsed`. `req.query` is a getter that reparses the URL, so the assignment throws in strict code or is ignored. `res.locals` is the place you own.

> **Q: Offset vs cursor pagination — when and why?**  
> Offset pagination is `page` and `limit`, implemented as skip N rows and take a page. It is simple, and the client can jump to page 47. It gets slower as N grows, because the database walks and throws away every skipped row, and it drifts: an insert while the user is paging can show a row twice or skip one. Cursor pagination, also called keyset, says "rows after this sort key and id," and the client carries that point as an opaque token. The query seeks an index and stops after one page, so depth stays cheap, and new inserts do not shift the window. For example, a feed ordered by `createdAt` then `id` uses `WHERE (createdAt, id) < (cursor time, cursor id)`. The limit is that a cursor cannot jump to an arbitrary page. Use offset for a small stable admin table, and cursors for a large or live feed.

> **Q: A client sends `?sort=passwordHash`. What's the risk and the fix?**  
> If you paste that string into a query, you have two problems. The string can be SQL injection, and even a safe identifier can sort on a secret column or on a column with no index, which makes the database sort the whole table. The fix is an allow-list: a map from the tokens you publish, such as `createdAt` and `name`, to real indexed columns and a direction. Anything else is a 422. Values, as opposed to column names, go in as parameters or through the query builder. For example, `?sort=-createdAt` becomes `ORDER BY created_at DESC`, and `?sort=passwordHash` is rejected before any SQL is built. The limit is that the allow-list has to match the indexes. A listed column with no index is still a slow sort the client can trigger on every request.

> **Q: Why cap `limit`, and what happens if you don't?**  
> `limit` is how many rows one response may contain. Without a ceiling, a client sends `?limit=1000000`, the database tries to produce that many rows, and the process holds them in memory. That is a denial of service with one query string, and it passes tests on a tiny dev database. Always coerce `limit` to an integer, default it, and clamp it, for example default 20 and maximum 100. The same clamp belongs on cursor endpoints, not only on `page`. For example, a missing `limit` becomes 20, and `500` becomes 100, before the query runs. The limit of a cap is that a legitimate export may need more than a page. Give that job its own endpoint with its own control, rather than raising the public maximum.

## Cheat-card

- Validate body, query, and params in middleware before the controller.
- Coerce types, strip unknown keys, and bound `limit`.
- Validation failure is 422 with field details, not a stack trace.
- Offset is `page` and `limit`: simple, can jump pages, slow and unstable at depth.
- Cursor, or keyset, means "rows after X": fast at any depth, stable under inserts, no random page jumps.
- Allow-list sort and filter fields, map them to indexed columns, and parameterize values.
- Return `{ data, pagination }` or `{ data, nextCursor }`.
- Zod is TypeScript-first. Joi is mature and framework-agnostic. express-validator is Express middleware.

## Good to know

- The same list endpoint in three libraries stores clean data on `res.locals.validated.query`: Zod `safeParse`, Joi `validate` with `abortEarly: false` and `stripUnknown: true`, and express-validator chains plus `validationResult` and `matchedData`.
- On Express 5, express-validator `.toInt()` updates `matchedData()` and does not update `req.query`, because `req.query` reparses. The write-back is lost with no error. Body and params sanitizers still write back.
- A repeated key such as `?page=1&page=2` arrives as an array. In express-validator, guard it with `.not().isArray().bail()`.
- Q: 400 or 422 for a validation failure? 422 means the request parsed and failed a semantic rule. 400 means it did not parse, such as broken JSON. Either is fine if you use it consistently. 422 shows you know the split.
- Q: Zod, Joi, or express-validator? All three validate in middleware and can answer 422. Zod infers TypeScript types from the schema. Joi is a chainable API with no framework. express-validator is Express middleware around validator.js. The edge cases differ, so pick one per API.
- Q: What breaks when express-validator `.toInt()` moves from Express 4 to Express 5? Nothing throws. `req.query` stays a string, because Express 5 reparses the URL on every read and the write lands on a throwaway object. Read `matchedData(req)` or `res.locals`. The throw "Cannot set property query" happens only if your own code assigns `req.query` in strict mode.
- Q: Do Zod, Joi, and express-validator accept the same inputs? Not exactly. In these runs `?page=` was rejected by Zod and Joi and defaulted to 1 by express-validator. `?limit=1e1` was accepted by Zod and Joi and rejected by express-validator. A repeated key passed express-validator as an array. The pattern is the same. The edges are not.

---

## Learn More

- [express-validator - Getting Started express-validator.github.io](https://express-validator.github.io/docs/)
- [cursor.skip() - MongoDB Manual (Pagination) www.mongodb.com](https://www.mongodb.com/docs/manual/reference/method/cursor.skip/)
- [Mongoose Queries (limit, skip, sort) mongoosejs.com](https://mongoosejs.com/docs/queries.html)
- [Create A Paginated API With Node.js - Complete Tutorial Web Dev Simplified](https://www.youtube.com/watch?v=ZX3qt0UWifc)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Express 5.3.0 (Express 4.22.3 for one comparison run), Zod 4.6.5, Joi 18.2.9, express-validator 7.3.2, supertest 7.3.1*

### The same endpoint in Zod, Joi and express-validator

The Code examples above validate `GET /users` query parameters with Zod. Here the same endpoint is written with Joi and with express-validator, and the same inputs go through all three. All three versions follow the Express 5 rule from the "Validation as a gate" paragraph: the validated, coerced data goes to `res.locals.validated.query`, and nothing is written back to `req.query`.

The libraries differ in where the clean data comes from:

- **Zod:** `schema.safeParse(input)` returns `{ success, data | error }`. `z.coerce.number()` runs `Number(value)` before the checks. Unknown keys are dropped by default (`.strict()` rejects them instead).
- **Joi:** `schema.validate(input, options)` returns `{ value, error }`. `Joi.number()` converts numeric strings by default (`convert: true`). Unknown keys are an **error** by default (`"role" is not allowed`), so pass `stripUnknown: true` to match Zod. Pass `abortEarly: false` to get every failing field, not just the first.
- **express-validator:** each `query('page')…` call is a middleware *chain*. It records validators and sanitizers (`.default()`, `.toInt()`) and runs them on its own copy of each field. `validationResult(req)` returns the errors and `matchedData(req)` returns the sanitized values of the fields the chains declared. The chains also try to write the sanitized value back into `req.query`. On Express 5 that write is lost, as the second example shows.

How it works:

1. The Zod and Joi middlewares read `req.query` once, validate, and either answer 422 or store the result in `res.locals.validated.query`.
2. The express-validator version is an array: the four chains, then one middleware that calls `validationResult(req)`. On success it stores `matchedData(req, { locations: ['query'] })`.
3. The controller `listUsers` is shared. It reads only `res.locals.validated.query`, and also prints what `req.query.page` still holds.

**Example — Zod, Joi and express-validator on identical inputs.**

javascript

```
// three-validators.cjs: the lesson's GET /users query validation in Zod, Joi and express-validator.
// All three put the result in res.locals.validated.query and never write to req.query.
const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const Joi = require('joi');
const { query, validationResult, matchedData } = require('express-validator');

// The same 422 body for all three libraries.
const fail = (res, details) => res.status(422).json({ error: 'Validation failed', details });
const store = (res, data) => { res.locals.validated = { ...res.locals.validated, query: data }; };

// --- Zod (the schema from the Code examples above)
const pageQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort:  z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});
const zodQuery = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.query);
  if (!r.success) return fail(res, r.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })));
  store(res, r.data);
  next();
};

// --- Joi: Joi.number() converts "2" to 2 by default (convert: true)
const pageQueryJoi = Joi.object({
  page:  Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort:  Joi.string(),
  status: Joi.string().valid('active', 'inactive'),
});
const joiQuery = (schema) => (req, res, next) => {
  // abortEarly:false -> report every field; stripUnknown -> drop extra keys like Zod does
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) return fail(res, error.details.map((d) => ({ field: d.path.join('.'), message: d.message })));
  store(res, value);
  next();
};

// --- express-validator: a list of chains, then one middleware that reads the result
const pageQueryChains = [
  query('page').default(1).isInt({ min: 1 }).withMessage('page must be an integer >= 1').toInt(),
  query('limit').default(20).isInt({ min: 1, max: 100 }).withMessage('limit must be an integer 1-100').toInt(),
  query('sort').optional().isString(),
  query('status').optional().isIn(['active', 'inactive']).withMessage('status must be active or inactive'),
];
const evQuery = (chains) => [...chains, (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) return fail(res, result.array().map((e) => ({ field: e.path, message: e.msg })));
  store(res, matchedData(req, { locations: ['query'] })); // only the fields the chains validated
  next();
}];

// The controller is identical for all three.
function listUsers(req, res) {
  const { page, limit } = res.locals.validated.query;
  res.json({ ...res.locals.validated.query, skip: (page - 1) * limit, typeofPage: typeof page,
             reqQueryPage: req.query.page ?? null }); // what req.query still holds
}

const app = express();
app.get('/zod/users', zodQuery(pageQuerySchema), listUsers);
app.get('/joi/users', joiQuery(pageQueryJoi), listUsers);
app.get('/ev/users',  evQuery(pageQueryChains), listUsers);

const inputs = ['', '?page=2&limit=50&status=active&role=admin', '?limit=500', '?page=abc&status=deleted',
                '?page=', '?limit=1e1', '?page=1&page=2'];
(async () => {
  for (const qs of inputs) {
    console.log(`GET /users${qs || ' (no query)'}`);
    for (const lib of ['zod', 'joi', 'ev']) {
      const r = await request(app).get(`/${lib}/users${qs}`);
      console.log(`  ${lib.padEnd(3)} ${r.status} ${r.text}`);
    }
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, Zod 4.6.5, Joi 18.2.9, express-validator 7.3.2):
//   GET /users (no query)
//     zod 200 {"page":1,"limit":20,"skip":0,"typeofPage":"number","reqQueryPage":null}
//     joi 200 {"page":1,"limit":20,"skip":0,"typeofPage":"number","reqQueryPage":null}
//     ev  200 {"page":1,"limit":20,"skip":0,"typeofPage":"number","reqQueryPage":null}
//   GET /users?page=2&limit=50&status=active&role=admin
//     zod 200 {"page":2,"limit":50,"status":"active","skip":50,"typeofPage":"number","reqQueryPage":"2"}
//     joi 200 {"page":2,"limit":50,"status":"active","skip":50,"typeofPage":"number","reqQueryPage":"2"}
//     ev  200 {"page":2,"limit":50,"status":"active","skip":50,"typeofPage":"number","reqQueryPage":"2"}
//   GET /users?limit=500
//     zod 422 {"error":"Validation failed","details":[{"field":"limit","message":"Too big: expected number to be <=100"}]}
//     joi 422 {"error":"Validation failed","details":[{"field":"limit","message":"\"limit\" must be less than or equal to 100"}]}
//     ev  422 {"error":"Validation failed","details":[{"field":"limit","message":"limit must be an integer 1-100"}]}
//   GET /users?page=abc&status=deleted
//     zod 422 {"error":"Validation failed","details":[{"field":"page","message":"Invalid input: expected number, received NaN"},{"field":"status","message":"Invalid option: expected one of \"active\"|\"inactive\""}]}
//     joi 422 {"error":"Validation failed","details":[{"field":"page","message":"\"page\" must be a number"},{"field":"status","message":"\"status\" must be one of [active, inactive]"}]}
//     ev  422 {"error":"Validation failed","details":[{"field":"page","message":"page must be an integer >= 1"},{"field":"status","message":"status must be active or inactive"}]}
//   GET /users?page=
//     zod 422 {"error":"Validation failed","details":[{"field":"page","message":"Too small: expected number to be >=1"}]}
//     joi 422 {"error":"Validation failed","details":[{"field":"page","message":"\"page\" must be a number"}]}
//     ev  200 {"page":1,"limit":20,"skip":0,"typeofPage":"number","reqQueryPage":""}
//   GET /users?limit=1e1
//     zod 200 {"page":1,"limit":10,"skip":0,"typeofPage":"number","reqQueryPage":null}
//     joi 200 {"limit":10,"page":1,"skip":0,"typeofPage":"number","reqQueryPage":null}
//     ev  422 {"error":"Validation failed","details":[{"field":"limit","message":"limit must be an integer 1-100"}]}
//   GET /users?page=1&page=2
//     zod 422 {"error":"Validation failed","details":[{"field":"page","message":"Invalid input: expected number, received NaN"}]}
//     joi 422 {"error":"Validation failed","details":[{"field":"page","message":"\"page\" must be a number"}]}
//     ev  200 {"page":[1,2],"limit":20,"skip":null,"typeofPage":"object","reqQueryPage":["1","2"]}
```

Reading the table:

- **No query, and normal input:** all three produce the same numbers (`page` and `limit` as numbers, defaults applied, `role` dropped). `reqQueryPage` is still the string `"2"` in every case: `req.query` keeps raw strings, and only `res.locals.validated.query` holds numbers.
- **`?limit=500`, `?page=abc&status=deleted`:** all three answer 422 with every failing field. Only the messages differ (the express-validator ones come from `.withMessage()`).
- **`?page=` (empty):** Zod coerces `""` to `0` (Too small) and Joi refuses an empty string as a number. express-validator's `.default(1)` replaces "an empty string, `null`, `undefined`, or `NaN`" (its docs), so it accepts the request as page 1.
- **`?limit=1e1`:** `Number('1e1')` is `10`, so Zod and Joi accept it. express-validator's `isInt` checks the string's characters and rejects it.
- **`?page=1&page=2`:** Express 5's simple query parser turns a repeated key into an array (lesson 48). Zod and Joi reject an array where a number is expected. express-validator runs standard validators and sanitizers on each array item, so the request passes with `page: [1, 2]` and `skip` becomes `NaN`, which JSON prints as `null`. The edge case below fixes it.

### express-validator sanitizers and the read-only `req.query` in Express 5

In Express 5, `req.query` is a getter on the request prototype: each read parses the URL's query string again and returns a **new** object (changed in v5; Express 4 parsed once and stored the object). express-validator 7 writes sanitized values back with lodash `_.set(req[location], path, value)`. For `query`, `req[location]` is a fresh, temporary object, so the write succeeds without an error and is then discarded. The value inside express-validator's own context is correct, and `matchedData()` returns it.

How it works:

1. The chain reads `req.query.page` (`'2'`) into its context.
2. `isInt` passes and `.toInt()` sets the context value to `2`.
3. It compares that with `req.query.page`, sees a difference and runs `_.set(req.query, 'page', 2)`. On Express 5 this sets `page` on the temporary object returned by that one read.
4. The next `req.query` read parses the URL again and returns `{ page: '2' }`.
5. `matchedData(req)` builds its result from the context, so it holds `2`.

**Example — does `.toInt()` change `req.query` on Express 5?**

javascript

```
// toint-writeback.cjs: does express-validator's .toInt() change req.query on Express 5?
const express = require('express');
const request = require('supertest');
const { query, matchedData } = require('express-validator');

const app = express();
app.get('/users',
  (req, res, next) => { res.locals.before = req.query; next(); },
  query('page').isInt({ min: 1 }).toInt(),   // sanitizer: '2' -> 2, then tries _.set(req.query, 'page', 2)
  (req, res) => res.json({
    express: require('express/package.json').version,
    sameObjectEachRead: req.query === req.query,
    before: res.locals.before,
    reqQueryAfter: req.query,
    typeofReqQueryPage: typeof req.query.page,
    matchedData: matchedData(req),
  }));

request(app).get('/users?page=2').then((r) => console.log(r.status, r.text));

// Real output (Node v24.19.0, Express 5.3.0, express-validator 7.3.2):
//   200 {"express":"5.3.0","sameObjectEachRead":false,"before":{"page":"2"},"reqQueryAfter":{"page":"2"},"typeofReqQueryPage":"string","matchedData":{"page":2}}
```

Observed result: `.toInt()` does not throw and does not report anything. It works inside express-validator (`matchedData` has the number), but its write to `req.query` is silently lost. `req.query` returns a different object on every read (`sameObjectEachRead: false`) and still holds the string `"2"`. Running the same file on Express 4.22.3 prints `{"express":"4.22.3","sameObjectEachRead":true,"before":{"page":2},"reqQueryAfter":{"page":2},"typeofReqQueryPage":"number","matchedData":{"page":2}}`. There, the cached object really was mutated, including the `before` reference taken earlier. Code that relied on `req.query.page` being a number after `.toInt()` therefore breaks when moving to Express 5 without any error. Read `matchedData(req)` instead, as the shared example does. Sanitizers on `body` and `params` are not affected: `req.body` and `req.params` are ordinary properties in Express 5.

### Common mistakes & gotchas (additional topics)

- **Reading `req.query` after express-validator sanitizers on Express 5.** The values are still the original strings. Use `matchedData(req)`.
- **Joi rejecting harmless extra keys.** Joi forbids unknown keys by default. Pass `stripUnknown: true` (or `.unknown(true)` on the schema) if you want Zod's strip behaviour.
- **`abortEarly` left at its default.** Joi stops at the first error, so clients fix one field per round trip. Pass `abortEarly: false`.
- **express-validator `.default()` swallowing empty values.** `?page=` becomes the default, while Zod and Joi reject it. Decide which behaviour you want and keep it the same across endpoints.
- **Different "integer" rules.** Zod/Joi coerce with `Number()` (accepting `1e1`, ` 2 `); express-validator's `isInt` checks the text. Pick one library per API so the same input gets the same answer.

### Edge case worked through: a repeated query key with express-validator

With Express 5's default `"simple"` query parser, `?page=1&page=2` yields `page: ['1', '2']`. express-validator validates and sanitizes each array element, so `isInt().toInt()` succeeds and hands the controller an array. Guard single-value fields with `.not().isArray()` and `.bail()`, so later validators do not run once that check fails:

javascript

```
// ev-repeated.cjs: ?page=1&page=2 through express-validator, without and with a "single value" guard.
const express = require('express');
const request = require('supertest');
const { query, validationResult, matchedData } = require('express-validator');

const loose = query('page').default(1).isInt({ min: 1 }).toInt();
const strict = query('page').not().isArray().withMessage('page must appear once').bail()
  .default(1).isInt({ min: 1 }).withMessage('page must be an integer >= 1').toInt();

const report = (req, res) => {
  const errors = validationResult(req).array().map((e) => e.msg);
  res.status(errors.length ? 422 : 200).json(errors.length ? { errors } : matchedData(req));
};

const app = express();
app.get('/loose', loose, report);
app.get('/strict', strict, report);

(async () => {
  for (const qs of ['?page=1&page=2', '?page=3', '']) {
    for (const path of ['/loose', '/strict']) {
      const r = await request(app).get(path + qs);
      console.log(`${(path + qs).padEnd(22)} ${r.status} ${r.text}`);
    }
  }
})();

// Real output (Node v24.19.0, Express 5.3.0, express-validator 7.3.2):
//   /loose?page=1&page=2   200 {"page":[1,2]}
//   /strict?page=1&page=2  422 {"errors":["page must appear once"]}
//   /loose?page=3          200 {"page":3}
//   /strict?page=3         200 {"page":3}
//   /loose                 200 {"page":1}
//   /strict                200 {"page":1}
```

The guard turns the array into a 422 and leaves single values and the default unchanged. Zod and Joi need no guard, because an array is not a number to them (the `?page=1&page=2` row of the first example).

### ⭐ Interview lens (additional topics)

The questions from this section are under Good to know, one line each.
