---
title: "Integration Testing"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/integration-testing
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Integration Testing

*13 min read · Updated 24 Jul 2026 Topic 59 of 70 Bookmark Mark done Why it matters Unit tests can all be green while your API is completely broken · Topic 59 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/integration-testing](https://www.geekyfrontend.in/learn/nodejs-backend-kit/integration-testing)

---

## Say it in 30 seconds

An integration test sends a real HTTP request through your Express app and checks both the response and what actually changed in a test database. It exists because every unit test can pass while the route, the middleware order, or the query is still wrong. The trade-off is that it is slower and needs a disposable database you reset before each test, and if parallel workers share that database the suite passes alone and fails in continuous integration.

## Why it matters

Unit tests can all be green while the API is broken. A unit test proves `createUser()` returns the right object. It says nothing about the route path, whether auth middleware runs before the handler, whether the body is parsed, whether validation rejects garbage, or whether the row lands in the database. Those are wiring bugs, and wiring is where a large share of backend bugs live.

The highest-value version for a Node API is one HTTP-level test: a real request, a real response, and the resulting database state. One green test means the vertical slice works.

In an interview, "how do you test an Express endpoint?" should name supertest, a real test database, and a clean lifecycle. Supertest is the library that sends the request. The lifecycle is when you connect, wipe, and disconnect.

## The concept, simply

An integration test runs several real components together across a boundary. You replace only the genuinely external world, such as a payment gateway or an email provider. You check two things: the response, meaning status, body, and headers, and the side effect, meaning what changed in the database.

**Supertest** takes your Express `app` object, not a URL. It starts the server on an ephemeral port, a random free port, sends a real HTTP request, and lets you assert on the response. You do not hardcode a port, call `app.listen()` in the test, or collide with a port already in use.

![Flow from a test file calling request(app) to an ephemeral server on a random port to your real app and back with the response then expect(201)](assets/i56_01_dc096a03.svg)

supertest binds your Express app to a random port, sends a real request through the full stack, and returns the response to assert on.

The database is real and dedicated to tests: an in-memory MongoDB, a disposable Docker Postgres, or a separate test schema. You do not point tests at production, and you do not mock the database, because a fake cannot catch a bad query or a schema mismatch. You reset it around each test so tests do not contaminate each other.

## How it works

The app must be importable without starting a server. Calling `app.listen()` in the same file that builds the app means a test import binds a real port and often throws `EADDRINUSE` when a second file imports it. Export a `createApp()` that returns the configured app. Call `listen()` only in a thin entry file. Tests import the app. Supertest manages the port.

Hooks shape the lifecycle.

- `beforeAll` connects to the test database once. Connecting is expensive.
- `beforeEach` puts the database in a known clean state, so every test starts from the same baseline.
- `afterEach` can clean up, and is often skipped because the next `beforeEach` already wipes.
- `afterAll` disconnects and stops what you started, so no open handle keeps the process alive.

Clean state belongs in `beforeEach`. If a test crashes, its `afterEach` may not run, and the mess leaks. The next test's setup cleans it instead. Do it per test, not once per file, because you should not rely on order.

Three isolation approaches, from simplest to strongest. Truncate between tests: delete all rows in `beforeEach`. This is the common one. Transaction rollback: wrap each test in a database transaction and roll it back, which is fast on SQL and fiddly with connection pooling. A fresh database per worker: Jest and Vitest run files in parallel processes, and two workers writing one database corrupt each other. Give each worker its own database or schema, or run integration tests serially with `--runInBand`. "Passes alone, fails in CI" is often that shared database.

Popular databases are `mongodb-memory-server`, which starts a real in-memory MongoDB, a Dockerised Postgres or MySQL via Testcontainers, or a dedicated test schema. Disposable databases start from nothing, so there is no "works on my machine because my local database has old data."

## Code examples

First, the split that makes the app importable. `app.js` builds and exports the app with no `listen()`; `server.js` starts it:

javascript

```
// app.js — no listen() here, so tests can import the app cleanly
const express = require('express');
const usersRouter = require('./routes/users');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  return app;
}
module.exports = { createApp };

// server.js — the only place that binds a port (production entry point)
const { createApp } = require('./app');
createApp().listen(3000, () => console.log('listening on 3000'));
```

The integration test itself, with a real in-memory MongoDB and a clean-per-test lifecycle. Note it asserts on both the HTTP response *and* the database state:

javascript

```
// users.integration.test.js
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createApp } = require('./app');
const User = require('./models/User');

let mongod;
const app = createApp();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();       // real Mongo, in memory
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();                       // close the connection
  await mongod.stop();                               // free the handle so Jest exits
});

beforeEach(async () => {
  await User.deleteMany({});                          // clean slate every test
});

describe('POST /users', () => {
  it('creates a user and returns 201 with the new record', async () => {
    // Act — supertest sends a real HTTP request through the whole stack
    const res = await request(app)
      .post('/users')
      .send({ email: 'a@b.com', name: 'Ann' })
      .expect(201);

    // Assert on the response
    expect(res.body).toMatchObject({ email: 'a@b.com', name: 'Ann' });
    expect(res.body.id).toBeDefined();

    // Assert on the side effect — the row really landed in the DB
    const inDb = await User.findOne({ email: 'a@b.com' });
    expect(inDb).not.toBeNull();
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app)
      .post('/users')
      .send({ name: 'no email' })
      .expect(400);

    expect(res.body.error).toMatch(/email/i);
    expect(await User.countDocuments()).toBe(0);     // nothing was written
  });
});
```

Testing an authenticated route: supertest chains header calls just like a real client, so you attach a token exactly as the app expects it:

javascript

```
it('returns the current user for a valid token', async () => {
  const token = signTestToken({ userId: 'u1' });      // helper that mints a JWT

  const res = await request(app)
    .get('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  expect(res.body.id).toBe('u1');
});

it('rejects a missing token with 401', async () => {
  await request(app).get('/users/me').expect(401);
});
```

Mocking only the genuinely external boundary — the payment provider — while everything else stays real. You test *your* code's reaction to the gateway, not the gateway itself:

javascript

```
jest.mock('./services/payments'); // auto-mock the external gateway module
const payments = require('./services/payments');

it('marks the order paid when the gateway succeeds', async () => {
  payments.charge.mockResolvedValue({ id: 'ch_1', status: 'succeeded' });

  const res = await request(app)
    .post('/orders')
    .send({ item: 'book', amount: 500 })
    .expect(201);

  expect(res.body.status).toBe('paid');
  expect(payments.charge).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 500 })
  );
});
```

## Common mistakes & gotchas

- **`app.listen()` in the file tests import.** You get `EADDRINUSE`. Hand supertest the app.
- **One test database for parallel workers.** Tests pass alone and fail in CI. One database or schema per worker, or `--runInBand`.
- **Cleaning in `afterEach` only.** A crash skips the cleanup. Reset in `beforeEach`.
- **Leaving connections open in `afterAll`.** Jest warns that it did not exit, or it hangs.
- **A test that needs a row from the previous test.** Reorder it and it breaks. Each test arranges its own data.
- **Mocking the database.** You then have a slow unit test that cannot catch schema or query bugs.
- **Pointing tests at a shared dev or production database.** Tests must own a database they can wipe.
- **Missing `await` on the supertest call.** Failures slip through as unhandled rejections.

## Best practices

- **Export the app. Start the server in a separate file.**
- **Use a real disposable database,** in-memory Mongo or Dockerised Postgres, wiped every run.
- **Connect and disconnect once. Reset data in `beforeEach`.**
- **Isolate parallel workers.** Never let two workers share writable state.
- **Check the response and the side effect,** including the error path where nothing should be written.
- **Replace only the true outside boundary,** such as payments or email.
- **Test 400, 401, and 404,** and confirm the write did not happen.

## ⭐ Interview lens

> **Q: "How do you test an Express API endpoint?"**  
> A: An integration test sends a real HTTP request through the app and checks the response and the database. I split the app so `createApp()` returns Express without calling `listen()`, because importing a file that listens binds a port and the next file hits `EADDRINUSE`. In the test, `request(app).post('/users').send(body).expect(201)` uses supertest, which binds that app to a random free port and runs routing, body parsing, middleware, and the controller. I then query the test database to confirm the row landed, and on the bad-body case I expect 400 and zero rows. The database is disposable, in-memory Mongo or a Docker Postgres, connected in `beforeAll` and wiped in `beforeEach`. The limit is everything outside our process. I still replace a payment gateway. I do not replace our database, or the test cannot catch a bad query.

> **Q: "Why hand supertest the app object instead of a running URL?"**  
> A: Supertest is a library that takes your Express app, starts it on a random free port for the request, and tears that server down afterward. You pass the app object, not a URL you already started. That means no hardcoded port, no `EADDRINUSE` when two files import the app, and no manual `listen` and close. The request is still real HTTP through routing, middleware, and the controller, in process. For example, `request(app).get('/users/me').set('Authorization', 'Bearer ' + token).expect(200)` attaches a header the same way a client would. The limit is that this does not prove a separately deployed process, a real network, or production TLS. That is an end-to-end test. Supertest also returns a thenable, so you must `await` it or a failed `.expect()` can slip through as an unhandled rejection.

> **Q: "Where do you put database setup and cleanup, and why there?"**  
> A: Connect once in `beforeAll` and disconnect in `afterAll`, because connecting is expensive and an open handle keeps Jest from exiting. Wipe rows in `beforeEach`, not only in `afterEach`. If a test crashes halfway, its `afterEach` may never run, and the next test's setup is what guarantees a clean slate. Each test also inserts the rows it needs, because runners do not promise order. For example, `beforeEach` calls `User.deleteMany({})`, then the create-user test posts a body and checks both status 201 and the row. The limit of wiping in the test process is parallel workers. Jest and Vitest run files in separate processes. If they share one database they overwrite each other. Give each worker its own database or schema, or run this file serially with `--runInBand`.

> **Q: "Your integration tests pass locally but fail in CI. First hypothesis?"**  
> A: My first guess is parallel workers sharing one test database. Jest and Vitest run test files in separate processes. Locally you might run one file, so it passes. In CI every file writes the same rows and you get order-dependent failures. The fix is a database or schema per worker, or `--runInBand` for the integration script. The close second is an open connection or server handle never closed in `afterAll`, which hangs or warns "did not exit." A third is state left behind because cleanup lived only in `afterEach` and a crashed test skipped it. The limit of blaming CI itself is that the failure is usually isolation you can reproduce by running the whole folder at once. I would not start by changing assertions until I have run two files against one database and watched them collide.

## Cheat-card

- **Integration test =** a real request through real routes, middleware, and a database. Check the response and the side effect.
- **Supertest:** `request(app)` on a random port. Pass the app, not a URL.
- **Split app from server:** export `createApp()`. Call `listen()` only in the entry file.
- **Lifecycle:** connect in `beforeAll`, wipe in `beforeEach`, disconnect in `afterAll`.
- **Wipe in `beforeEach`** so a crashed test does not leak rows.
- **Test database:** real and disposable. Do not mock it. Do not use production.
- **Parallel workers** need a database per worker, or `--runInBand`.
- **Replace only** payments, email, and other true outsiders.
- **Check 400, 401, and 404,** and confirm nothing was written.

## Good to know

- **Should you mock the database in an integration test?** No. The point is to catch schema mismatches, bad queries, and migration issues. Use a disposable database, and mock only a payment gateway or similar outsider.
- **What does an integration test catch that a unit test cannot?** A wrong route path, middleware in the wrong order, body parsing left off, a validation rule that does not fire, a schema that does not match the write, and auth that lets the wrong request through.

---

## Learn More

- [SuperTest - HTTP assertions for Node.js servers github.com](https://github.com/ladjs/supertest)
- [Node.js Test Runner (node:test) nodejs.org](https://nodejs.org/api/test.html)
- [Jest: Getting Started jestjs.io](https://jestjs.io/docs/getting-started)
- [Supertest express tutorial | Node REST API testing Jan Goebel](https://www.youtube.com/watch?v=T2sYitv2OAY)
