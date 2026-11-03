---
title: "Structuring an Express Project"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Structuring an Express Project

*22 min read · Updated 10 Oct 2026 · Topic 95 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0 (Express 4.22.3 for the comparison runs), Zod 4.6.5, supertest 7.3.1

---

## Say it in 30 seconds

A structured Express app is built by a function, usually `createApp`, that wires routes, controllers, services, and a repository, and returns the app without opening a port. `server.js` is the only file that reads the environment and calls `listen`. Each layer may call the one inside it, and not the other way around. The split exists so a test can build the app with an in-memory database and send a real HTTP request, without fighting over port 3000. The trade-off is more files up front. A single file is fine at about a hundred lines, and it gets expensive once SQL, error JSON, and startup all live in the route handlers.

## Why it matters

Express gives you no folder layout. `express()` returns a function, and you decide where routes, database calls, and error handling live. A one-file app is fine at about 100 lines. At about 3,000 lines that layout costs you in three places.

- **Tests.** Importing `server.js` also opens a port, reads the real environment, and connects to the real database. Two test files then fight over port 3000.
- **Change.** When SQL sits inside a route handler, swapping the database or adding a cache means editing every handler.
- **Errors.** Every handler invents its own error JSON, so the client sees several shapes for "not found".

This lesson builds a small notes API that fixes those three. A config module validates the environment and refuses to start on bad values. An error module has one central handler. `createApp()` returns an app tests can import without opening a port. Controllers, services, and repositories are wired by hand. Every file in the lesson is code that was built and run. The test output and the curl session are copied from those runs.

## The concept, simply

Three decisions.

1. **Where files go.** Group by kind, with `controllers/`, `services/`, and `models/` at the top. Or group by feature, with `notes/`, `users/`, and `billing/` at the top, each holding its own controller, service, and repository.
2. **Who may import whom.** Routes map a URL to a handler. The controller translates between HTTP and a function call. The service holds the business rules. The repository reads and writes storage. Imports point one way: routes, then controller, then service, then repository. A service never touches `req`. A repository never decides the HTTP status.
3. **Where the pieces are connected.** One file, the composition root, is `server.js`. It reads the environment, picks the real implementations, such as "store notes in this JSON file", and passes them in. Everything else receives its dependencies as function arguments. That is dependency injection by hand. There is no container and no decorators. Because the app is built by `createApp(deps)`, a test calls that function with an in-memory repository and gets a working app back, without opening a port.

## How it works

What happens at startup, and then on one request, in the project below.

1. `node src/server.js` runs. `loadConfig()` parses `process.env` with a Zod schema. If any variable is invalid, it throws one error that lists every bad variable. `server.js` prints that error and calls `process.exit(1)` before any port is opened.
2. `server.js` creates the concrete repository, `createFileNotesRepository(config.dataFile)`, and calls `createApp({ notesRepository })`.
3. `createApp` builds the chain by hand. `createNotesService({ notesRepository })`, then `createNotesController({ notesService })`, then `createNotesRouter({ notesController })`. It registers `express.json()`, the routes, the 404 forwarder, and the central error handler, in that order, and returns `app`. It does not call `listen`.
4. `server.js` calls `app.listen(config.port, cb)`. On Express 5 a listen error such as `EADDRINUSE` is passed to that callback. That changed in v5.0. Express 4 did not pass it.
5. A request arrives, for example `POST /notes`. `express.json()` parses the body. The `validate(CreateNoteSchema)` middleware runs Zod and stores the result on `res.locals.validated.body`.
6. The controller reads `res.locals.validated.body` and calls `notesService.createNote`. The service checks that titles are unique. A clash throws `ConflictError`. Then it calls `notesRepository.create`.
7. The controller sends 201 and a `Location` header. If a step threw, or an `await` rejected, Express 5 passes the error to the error middleware. The 404 forwarder is skipped. The central handler maps the error to `{ error: { code, message, details? } }` with the right status.

**Folders.** The same three resources, laid out both ways. These trees are illustrative. They are not the built project.

text

```
layer-based (group by kind)          feature-based (group by feature)
src/                                 src/
  controllers/                         notes/
    notes.controller.js                  notes.routes.js
    users.controller.js                  notes.controller.js
    billing.controller.js                notes.service.js
  services/                              notes.repository.js
    notes.service.js                     notes.schema.js
    users.service.js                   users/
    billing.service.js                   users.routes.js
  repositories/                          users.controller.js
    notes.repository.js                  ...
    users.repository.js                billing/
    billing.repository.js                ...
  routes/                              errors/          (shared)
    notes.routes.js                    middleware/      (shared)
    users.routes.js                    config/          (shared)
    billing.routes.js                  app.js
  middleware/                          server.js
  config/
  app.js
  server.js
```

Layer-based folders are easy to start with, and the folder name shows the rule. Everything in `services/` must not import `express`. The cost shows up as the app grows. One change to notes touches four directories, and nothing stops `billing.service.js` from importing `users.repository.js`. Feature-based folders keep one feature's files together, so a change or a review stays in one directory, and you can delete or extract a feature by moving one folder. The cost is that the layer rules are no longer visible from the folder names, so you need a naming convention such as `*.service.js`, and a check. Example 10 is that check. Code shared by several features, `errors/`, `middleware/`, and `config/`, still sits at the top in both layouts. The project below is feature-based, with shared modules at the top. A common path is to start layer-based and switch once there are more than a handful of resources.

**Who may import what.** Nothing points back up.

text

```
server.js  ── composition root: loadConfig(), picks concrete repository, listen()
   │
   ▼
app.js  createApp({ notesRepository })   ── builds the chain, registers middleware
   │
   ▼
notes.routes.js ──► notes.controller.js ──► notes.service.js ──► notes.repository.js
 (URL + method,      (req/res in,            (business rules,      (storage only:
  validate())         JSON out)               throws AppErrors)     fs, SQL, HTTP)
   │                                            │
   ▼                                            ▼
middleware/validate.js                       errors/app-error.js  ◄── also imported by
                                                                       error-handler.js
```

- Routes may import `express` for `Router`, the schemas, and the validation middleware. They receive the controller as an argument.
- The controller imports nothing from storage. It receives the service as an argument and uses only `req`, `res`, and `res.locals`.
- The service may import the error classes. It must not import `express` or a concrete repository. It receives the repository as an argument.
- A repository may import `node:fs`, a database driver, or an HTTP client. It must not import services, controllers, or `express`, and it does not throw HTTP errors. A missing row comes back as `null`. The service decides that `null` means 404.

The service depends only on the shape `{ list, findById, findByTitle, create }`. A file-backed object, an in-memory object, and a future PostgreSQL object all fit.

**Config.** `process.env` values are strings or `undefined`. If ten places read `process.env.PORT`, they parse it ten times, and a typo such as `PORT=80O` shows up only when that path runs. The config module reads the environment once, at startup. Zod coerces each value. `z.coerce.number()` turns `'6001'` into `6001`. `.int().min(0).max(65535)` checks it. Defaults are filled in. The result is frozen. On failure, `z.prettifyError`, added in Zod 4, formats every issue with its path, and the process exits before it binds a port. Only `server.js` calls `loadConfig()`. `createApp` receives the values it needs as arguments, so tests never depend on the shell environment.

**Errors.** This follows lesson 50. One base class, `AppError(message, status, code, details)`, and small subclasses: `NotFoundError` at 404, `ValidationError` at 422, the same status lesson 65 uses, and `ConflictError` at 409. A `notFound` middleware after all routes forwards a `NotFoundError`. One four-argument handler sits last, and it is the only place that turns errors into responses. An `AppError` uses its `status`, `code`, and `details`. Body-parser's bad JSON, `err.type === 'entity.parse.failed'`, is 400. Everything else is 500 with a generic message, and the real error is logged on the server only. If headers were already sent, it calls `next(err)` so Express's default handler can close the connection. The controllers are `async` and contain no try/catch. Express 5 forwards a rejected promise to the error middleware. That changed in v5.0. The same async controller on Express 4 does not reach the handler. Example 9 shows that inside a test run.

**`createApp` does not listen.** `app.js` exports a function that builds and returns the app. It does not read `process.env`, does not create a real database client, and does not call `listen`. `listen` belongs to `server.js`, the file that is only run, never imported. `app.listen()` opens a socket. Every test that imported a listening module would need its own free port, and the process would not exit until that server closed. An Express `app` is itself a request handler, `(req, res) => ...`, so a test does not need a listening server of its own. supertest takes the app, wraps it in `http.createServer(app)`, listens on port 0 so the operating system picks a free port, sends a real HTTP request over loopback, and closes the server after the response.

![How supertest drives your API: the test file calls request(app).post('/users'), supertest binds the app to a random free port on an ephemeral server, sends a real HTTP request through your routes and middleware, and the response comes back for .expect(201) and assertions on res.body, with no manual listen() and no hardcoded port](assets/i56_01_dc096a03.svg)
*Figure: How supertest drives your API. Look at: the "Ephemeral server" box — supertest opens and closes the port itself, which is why `createApp()` must hand back an app that is not yet listening.*

**Dependency injection by hand.** Each factory takes one object of dependencies and returns functions that close over them. `createNotesService({ notesRepository })` is the whole mechanism. There is no registry and no `new Container()`. To use different storage, pass a different object. The tests in Example 7 pass `createMemoryNotesRepository(seed)`, which is fast, needs no files, and starts each test from a known state. The 500-path test passes an object whose `list()` rejects, which is hard to arrange with a real database. Because the service only sees the argument, nothing has to be patched at the module level.

**What changes on Express 4.** The same files run on Express 4.22.3, and two behaviors differ. Example 9 ran both.

- An `async` controller that rejects is not forwarded to the error handler. Without the `asyncHandler` wrapper from lesson 50, no response is written.
- `req.body` is `{}` instead of `undefined` when no body is sent, so the validation error points at `title` instead of the root.
- Express 4's `app.listen` ignores the error-first callback. Its source returns `server.listen.apply(server, arguments)`, so `EADDRINUSE` is an `'error'` event on the server, not an argument to your callback.

## Code examples

**Example 1 — the built project tree and its manifest.** This is the real file list of the project the rest of the examples come from (`node_modules` pruned). `package.json` sets `"type": "module"`, so every `.js` file is ESM.

bash

```
$ find . -path ./node_modules -prune -o -type f -print | sort
./package.json
./package-lock.json
./src/app.js
./src/config/index.js
./src/errors/app-error.js
./src/errors/error-handler.js
./src/middleware/validate.js
./src/notes/notes.controller.js
./src/notes/notes.repository.js
./src/notes/notes.routes.js
./src/notes/notes.schema.js
./src/notes/notes.service.js
./src/server.js
./test/config.test.js
./test/layers.test.js
./test/notes.test.js
$ npm ls
notes-api@1.0.0 …/notes-api
├── express@5.3.0
├── supertest@7.3.1
└── zod@4.6.5
```

json

```
{
  "name": "notes-api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^5.3.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "supertest": "^7.3.1"
  }
}
```

**Example 2 — a config module with schema-validated env, failing fast.** `loadConfig` takes the env object as a parameter (defaulting to `process.env`), so a test can pass a plain object. `server.js` (Example 6) catches the error, prints it and exits with code 1.

javascript

```
// src/config/index.js — read process.env once, validate it, export a frozen object
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(6000),
  DATA_FILE: z.string().min(1).default('./data/notes.json'),
});

export function loadConfig(env = process.env) {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    // one error that lists every bad variable, not just the first
    throw new Error('Invalid environment:\n' + z.prettifyError(result.error));
  }
  const e = result.data;
  return Object.freeze({
    env: e.NODE_ENV,
    port: e.PORT,
    dataFile: e.DATA_FILE,
  });
}
```

bash

```
$ PORT=eighty NODE_ENV=prod node src/server.js; echo "exit code: $?"
Invalid environment:
✖ Invalid option: expected one of "development"|"test"|"production"
  → at NODE_ENV
✖ Invalid input: expected number, received NaN
  → at PORT
exit code: 1
```

Both bad variables are reported in one run, and no port was opened.

**Example 3 — the error module: AppError classes and one central handler.**

javascript

```
// src/errors/app-error.js — errors that carry an HTTP status and a stable code
export class AppError extends Error {
  constructor(message, status = 500, code = 'INTERNAL', details) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found') { super(message, 404, 'NOT_FOUND'); }
}

export class ValidationError extends AppError {
  constructor(details) { super('Validation failed', 422, 'VALIDATION_FAILED', details); }
}

export class ConflictError extends AppError {
  constructor(message) { super(message, 409, 'CONFLICT'); }
}
```

javascript

```
// src/errors/error-handler.js — the 404 forwarder and the ONE central error handler
import { AppError, NotFoundError } from './app-error.js';

export function notFound(req, res, next) {
  next(new NotFoundError(`Not Found: ${req.method} ${req.originalUrl}`));
}

export function createErrorHandler({ log = console.error } = {}) {
  // four parameters: Express recognises error middleware by arity
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err); // let Express close the connection

    let status = 500;
    let body = { code: 'INTERNAL', message: 'Internal Server Error' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message };
      if (err.details) body.details = err.details;
    } else if (err.type === 'entity.parse.failed') {
      // body-parser (express.json) sets status 400 and this type on bad JSON
      status = 400;
      body = { code: 'BAD_JSON', message: 'Request body is not valid JSON' };
    }

    if (status >= 500) log(err); // log the real error server-side only
    res.status(status).json({ error: body });
  };
}
```

`createErrorHandler({ log })` is a factory so a test can capture what gets logged instead of printing it (the last test in Example 7).

**Example 4 — validation at the edge: schema plus middleware.** The middleware writes to `res.locals.validated`, not back onto `req`. In Express 5, `req.query` is a getter, so writing to `req` is not safe (see the correction in lesson 65).

javascript

```
// src/notes/notes.schema.js — the shape of input this feature accepts
import { z } from 'zod';

export const CreateNoteSchema = z.object({
  title: z.string().trim().min(1).max(100),
  body: z.string().max(10_000).default(''),
});

export const NoteIdParams = z.object({
  id: z.coerce.number().int().positive(),
});
```

javascript

```
// src/middleware/validate.js — zod gate; validated data goes in res.locals
import { ValidationError } from '../errors/app-error.js';

export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    return next(new ValidationError(details));
  }
  res.locals.validated = { ...res.locals.validated, [source]: result.data };
  next();
};
```

**Example 5 — repository, service, controller and routes.** Each file is a factory that receives its dependency as an argument. Notice what each one does *not* import.

javascript

```
// src/notes/notes.repository.js — storage only: no HTTP, no business rules.
// Two implementations with the same async interface: list, findById, findByTitle, create.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export function createMemoryNotesRepository(seed = []) {
  const notes = seed.map((n) => ({ ...n }));
  let nextId = notes.reduce((max, n) => Math.max(max, n.id), 0) + 1;
  return {
    async list() { return notes.map((n) => ({ ...n })); },
    async findById(id) { const n = notes.find((x) => x.id === id); return n ? { ...n } : null; },
    async findByTitle(title) { const n = notes.find((x) => x.title === title); return n ? { ...n } : null; },
    async create({ title, body }) {
      const note = { id: nextId++, title, body };
      notes.push(note);
      return { ...note };
    },
  };
}

export function createFileNotesRepository(filePath) {
  async function load() {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }
  async function save(notes) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(notes, null, 2));
  }
  return {
    async list() { return load(); },
    async findById(id) { return (await load()).find((n) => n.id === id) ?? null; },
    async findByTitle(title) { return (await load()).find((n) => n.title === title) ?? null; },
    async create({ title, body }) {
      const notes = await load();
      const note = { id: notes.reduce((m, n) => Math.max(m, n.id), 0) + 1, title, body };
      notes.push(note);
      await save(notes);
      return note;
    },
  };
}
```

javascript

```
// src/notes/notes.service.js — business rules. Knows nothing about req/res.
import { NotFoundError, ConflictError } from '../errors/app-error.js';

export function createNotesService({ notesRepository }) {
  return {
    listNotes() {
      return notesRepository.list();
    },
    async getNote(id) {
      const note = await notesRepository.findById(id);
      if (!note) throw new NotFoundError(`Note ${id} not found`);
      return note;
    },
    async createNote({ title, body }) {
      if (await notesRepository.findByTitle(title)) {
        throw new ConflictError(`A note titled "${title}" already exists`);
      }
      return notesRepository.create({ title, body });
    },
  };
}
```

javascript

```
// src/notes/notes.controller.js — HTTP in, HTTP out. Async handlers, no try/catch:
// Express 5 forwards a rejected promise to the error handler.
export function createNotesController({ notesService }) {
  return {
    async list(req, res) {
      res.json({ data: await notesService.listNotes() });
    },
    async get(req, res) {
      const { id } = res.locals.validated.params;
      res.json({ data: await notesService.getNote(id) });
    },
    async create(req, res) {
      const note = await notesService.createNote(res.locals.validated.body);
      res.status(201).location(`/notes/${note.id}`).json({ data: note });
    },
  };
}
```

javascript

```
// src/notes/notes.routes.js — URL + method -> validation -> controller method
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { CreateNoteSchema, NoteIdParams } from './notes.schema.js';

export function createNotesRouter({ notesController: c }) {
  const router = Router();
  router.get('/', c.list);
  router.get('/:id', validate(NoteIdParams, 'params'), c.get);
  router.post('/', validate(CreateNoteSchema, 'body'), c.create);
  return router;
}
```

**Example 6 — `createApp(deps)` and the composition root.** `app.js` can be imported freely. Importing it has no side effects. `server.js` is the only file with side effects: it reads the env, writes to stdout, opens a port and installs a signal handler.

javascript

```
// src/app.js — build and return the app. No listen(), no process.env, no concrete DB.
import express from 'express';
import { createNotesService } from './notes/notes.service.js';
import { createNotesController } from './notes/notes.controller.js';
import { createNotesRouter } from './notes/notes.routes.js';
import { notFound, createErrorHandler } from './errors/error-handler.js';

export function createApp({ notesRepository, log = console.error }) {
  // dependency injection by hand: repository -> service -> controller -> router
  const notesService = createNotesService({ notesRepository });
  const notesController = createNotesController({ notesService });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/notes', createNotesRouter({ notesController }));

  app.use(notFound);                     // after all routes
  app.use(createErrorHandler({ log }));  // dead last
  return app;
}
```

javascript

```
// src/server.js — the composition root: the only file that reads env,
// picks concrete implementations and calls listen().
import { loadConfig } from './config/index.js';
import { createFileNotesRepository } from './notes/notes.repository.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1); // fail fast: never start with a bad config
}

const app = createApp({ notesRepository: createFileNotesRepository(config.dataFile) });

const server = app.listen(config.port, (err) => {
  if (err) throw err;
  console.log(`notes-api (${config.env}) listening on port ${server.address().port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

Proof that building the app opens nothing. `process.getActiveResourcesInfo()` lists the handles keeping the process alive, and here it is empty, so the process exits at once:

bash

```
$ node --input-type=module -e "
import { createApp } from './src/app.js';
const app = createApp({ notesRepository: {} });
console.log(typeof app, typeof app.listen, process.getActiveResourcesInfo());
"; echo "exit $?"
function function []
exit 0
```

**Example 7 — tests with `node --test` and supertest against `createApp(deps)`.** Each test builds its own app around a fresh in-memory repository, so tests share no state and no port. The last test injects a repository that rejects, to drive the 500 path.

javascript

```
// test/notes.test.js — supertest against createApp(deps); no listen(), no port
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryNotesRepository } from '../src/notes/notes.repository.js';

const build = (seed = []) =>
  createApp({ notesRepository: createMemoryNotesRepository(seed), log: () => {} });

test('GET /notes lists notes', async () => {
  const res = await request(build([{ id: 1, title: 'a', body: '' }])).get('/notes').expect(200);
  assert.deepEqual(res.body, { data: [{ id: 1, title: 'a', body: '' }] });
});

test('POST /notes creates a note and sets Location', async () => {
  const app = build();
  const res = await request(app).post('/notes').send({ title: ' Groceries ' }).expect(201);
  assert.deepEqual(res.body.data, { id: 1, title: 'Groceries', body: '' });
  assert.equal(res.headers.location, '/notes/1');
  await request(app).get('/notes/1').expect(200);
});

test('POST /notes with a missing title -> 422 with details', async () => {
  const res = await request(build()).post('/notes').send({ body: 'x' }).expect(422);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.equal(res.body.error.details[0].path, 'title');
});

test('POST /notes with no body at all -> 422, not a crash', async () => {
  // Express 5: req.body is undefined when no body was sent
  const res = await request(build()).post('/notes').expect(422);
  assert.equal(res.body.error.details[0].path, '');
});

test('POST /notes with broken JSON -> 400 BAD_JSON', async () => {
  const res = await request(build())
    .post('/notes').set('Content-Type', 'application/json').send('{"title":')
    .expect(400);
  assert.equal(res.body.error.code, 'BAD_JSON');
});

test('duplicate title -> 409 from the service layer', async () => {
  const app = build([{ id: 1, title: 'a', body: '' }]);
  const res = await request(app).post('/notes').send({ title: 'a' }).expect(409);
  assert.equal(res.body.error.code, 'CONFLICT');
});

test('GET /notes/99 -> 404; GET /notes/abc -> 422', async () => {
  const app = build();
  const missing = await request(app).get('/notes/99').expect(404);
  assert.equal(missing.body.error.message, 'Note 99 not found');
  await request(app).get('/notes/abc').expect(422);
});

test('unknown route -> JSON 404', async () => {
  const res = await request(build()).get('/nope').expect(404);
  assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Not Found: GET /nope' } });
});

test('a repository that rejects -> 500, message not leaked, error logged', async () => {
  const logged = [];
  const broken = { list: async () => { throw new Error('disk on fire'); } };
  const app = createApp({ notesRepository: broken, log: (e) => logged.push(e.message) });
  const res = await request(app).get('/notes').expect(500);
  assert.deepEqual(res.body, { error: { code: 'INTERNAL', message: 'Internal Server Error' } });
  assert.deepEqual(logged, ['disk on fire']);
});
```

javascript

```
// test/config.test.js — the config module is a plain function of an env object
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/index.js';

test('defaults apply and PORT is coerced to a number', () => {
  assert.deepEqual(loadConfig({ PORT: '6001' }), {
    env: 'development', port: 6001, dataFile: './data/notes.json',
  });
});

test('bad values throw one error naming every variable', () => {
  assert.throws(() => loadConfig({ PORT: 'eighty', NODE_ENV: 'prod' }), /NODE_ENV[\s\S]*PORT/);
});
```

bash

```
$ npm test

> notes-api@1.0.0 test
> node --test

✔ defaults apply and PORT is coerced to a number (3.800046ms)
✔ bad values throw one error naming every variable (1.881836ms)
✔ notes.controller.js respects the dependency rule (1.574501ms)
✔ notes.repository.js respects the dependency rule (2.667048ms)
✔ notes.service.js respects the dependency rule (0.617873ms)
✔ GET /notes lists notes (37.790829ms)
✔ POST /notes creates a note and sets Location (22.620654ms)
✔ POST /notes with a missing title -> 422 with details (5.615007ms)
✔ POST /notes with no body at all -> 422, not a crash (4.330573ms)
✔ POST /notes with broken JSON -> 400 BAD_JSON (6.068035ms)
✔ duplicate title -> 409 from the service layer (4.586708ms)
✔ GET /notes/99 -> 404; GET /notes/abc -> 422 (7.708371ms)
✔ unknown route -> JSON 404 (4.11914ms)
✔ a repository that rejects -> 500, message not leaked, error logged (3.865687ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 422.602942
```

(Durations vary from run to run. With no file arguments, `node --test` runs every file matching its default patterns, which include `**/*.test.{cjs,mjs,js}` and `**/test/**/*.{cjs,mjs,js}`, each in its own child process.)

**Example 8 — a curl session against the running server.** The server runs with the file repository (`DATA_FILE` defaulted to `./data/notes.json`, which does not exist yet). It was started with `PORT=6000 node src/server.js` and stopped with SIGTERM afterwards.

bash

```
$ curl -s localhost:6000/notes
{"data":[]}
$ curl -si localhost:6000/notes -H 'Content-Type: application/json' -d '{"title":"Groceries","body":"milk, eggs"}'
HTTP/1.1 201 Created
Location: /notes/1
Content-Type: application/json; charset=utf-8
Content-Length: 57
ETag: W/"39-NK/svJHWIlbQblFrtGoNlMiulvM"
Date: Sat, 10 Oct 2026 16:00:59 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"data":{"id":1,"title":"Groceries","body":"milk, eggs"}}
$ curl -s localhost:6000/notes/1
{"data":{"id":1,"title":"Groceries","body":"milk, eggs"}}
$ curl -s localhost:6000/notes -H 'Content-Type: application/json' -d '{"title":"Groceries"}'
{"error":{"code":"CONFLICT","message":"A note titled \"Groceries\" already exists"}}
$ curl -s localhost:6000/notes -H 'Content-Type: application/json' -d '{"title":""}'
{"error":{"code":"VALIDATION_FAILED","message":"Validation failed","details":[{"path":"title","message":"Too small: expected string to have >=1 characters"}]}}
$ curl -s -X POST localhost:6000/notes
{"error":{"code":"VALIDATION_FAILED","message":"Validation failed","details":[{"path":"","message":"Invalid input: expected object, received undefined"}]}}
$ curl -s localhost:6000/notes -H 'Content-Type: application/json' -d '{"title":'
{"error":{"code":"BAD_JSON","message":"Request body is not valid JSON"}}
$ curl -si localhost:6000/notes/99
HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8
Content-Length: 60
ETag: W/"3c-+8LNb6hmSF6zrLQEQ9TS9d+auoM"
Date: Sat, 10 Oct 2026 16:00:59 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":{"code":"NOT_FOUND","message":"Note 99 not found"}}
$ curl -s localhost:6000/notes/abc
{"error":{"code":"VALIDATION_FAILED","message":"Validation failed","details":[{"path":"id","message":"Invalid input: expected number, received NaN"}]}}
$ curl -s localhost:6000/nope
{"error":{"code":"NOT_FOUND","message":"Not Found: GET /nope"}}
$ cat data/notes.json
[
  {
    "id": 1,
    "title": "Groceries",
    "body": "milk, eggs"
  }
]
```

The same error shape (`{"error":{"code","message",…}}`) comes back for 400, 404, 409 and 422. The file at the end shows the write went through the file repository, which the tests never touch.

**Example 9 — edge case: the same project on Express 4.** This project has two routes whose behaviour depends on the Express major version: the async controller and the no-body POST. The project was copied unchanged, `express@4` (4.22.3) was installed in the copy, and the two relevant tests were run:

bash

```
$ node -p "require('express/package.json').version"
4.22.3
$ node --test --test-name-pattern="rejects|no body" --test-force-exit test/notes.test.js
✖ POST /notes with no body at all -> 422, not a crash (36.959349ms)
✖ a repository that rejects -> 500, message not leaked, error logged (9.85974ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
…
test at test/notes.test.js:30:1
✖ POST /notes with no body at all -> 422, not a crash (36.959349ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  'title' !== ''
…
test at test/notes.test.js:61:1
✖ a repository that rejects -> 500, message not leaked, error logged (9.85974ms)
  Error: disk on fire
      at Object.list (file://…/notes-api-e4/test/notes.test.js:63:46)
      at Object.listNotes (file://…/notes-api-e4/src/notes/notes.service.js:7:30)
      at list (file://…/notes-api-e4/src/notes/notes.controller.js:6:43)
      at Layer.handle [as handle_request] (…/notes-api-e4/node_modules/express/lib/router/layer.js:95:5)
…
$ timeout 20 node --test --test-name-pattern="rejects" test/notes.test.js; echo "exit $?"
✖ a repository that rejects -> 500, message not leaked, error logged (39.105727ms)

Interrupted while running:

⚠ test/notes.test.js (test/notes.test.js:1:1)
✖ test/notes.test.js (19965.200466ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 1
…
exit 124
```

What each failure means:

1. **No body.** Express 4 sets `req.body` to `{}` when nothing was sent, so Zod reports a missing `title` (path `'title'`) instead of a missing object (path `''`). Both versions still return 422, so the guard holds on both.
2. **Rejection.** On Express 4 the controller's rejected promise never reaches `next(err)`. No response is written, and the test runner reports the stray rejection (`Error: disk on fire`) against the test. Outside a test runner, Node's default `--unhandled-rejections=throw` would crash the process (lesson 50).
3. **The hang.** Without `--test-force-exit`, the supertest request stays open forever, so the test file never finishes. `timeout` killed it at 20 s (exit 124), and the runner reported the file as cancelled.

The fix on Express 4 is to wrap each controller method in lesson 50's `asyncHandler` inside `notes.routes.js`, and to stop relying on `undefined` vs `{}`. Express 5 needs neither change. Express 4's `app.listen` also ignores the error-first callback in `server.js`: its source is `return server.listen.apply(server, arguments)`, so an `EADDRINUSE` is emitted as an `'error'` event instead.

**Example 10 — enforcing the dependency rule with a test.** A rule nobody checks erodes, so this test reads each layer file's `import` lines and fails on a forbidden one:

javascript

```
// test/layers.test.js — enforce the dependency rule by reading import lines
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const imports = (file) =>
  [...readFileSync(new URL(`../src/notes/${file}`, import.meta.url), 'utf8')
    .matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);

// layer -> modules it must NOT import
const forbidden = {
  'repository': [/^express$/, /service/, /controller/, /routes/],
  'service':    [/^express$/, /repository/, /controller/, /routes/],
  'controller': [/^express$/, /repository/],
};

for (const file of readdirSync(new URL('../src/notes/', import.meta.url))) {
  const layer = file.split('.')[1]; // notes.<layer>.js
  if (!forbidden[layer]) continue;
  test(`${file} respects the dependency rule`, () => {
    for (const spec of imports(file)) {
      for (const rule of forbidden[layer]) {
        assert.ok(!rule.test(spec), `${file} imports ${spec}`);
      }
    }
  });
}
```

To check that the test bites, `import { createMemoryNotesRepository } from './notes.repository.js';` was added to the service in a scratch copy:

bash

```
$ node --test test/layers.test.js
✔ notes.controller.js respects the dependency rule (1.40375ms)
✔ notes.repository.js respects the dependency rule (0.549ms)
✖ notes.service.js respects the dependency rule (0.908088ms)
…
  AssertionError [ERR_ASSERTION]: notes.service.js imports ./notes.repository.js
```

A regex over `import` lines is a coarse check: it misses `await import()` and re-exports. Larger codebases usually move this check into a lint rule. The point is that the rule lives in the test suite, not only in a README.

## Common mistakes & gotchas

- **Calling `listen()` in the module tests import.** Every test file opens a port, two files clash on `EADDRINUSE`, and the process does not exit while the server is open. Return the app from `createApp()` and call `listen` only in `server.js`.
- **Reading `process.env` inside services.** The dependency is hidden, and a typo shows up only on the path that reads it. Read it once in config and pass the values down.
- **Parsing env without coercion.** `process.env.PORT` is the string `'6001'`. `z.number()` rejects it. `z.coerce.number()` converts it. The trap is that `z.coerce.number()` turns `''` into `0`, so an empty `PORT=` is accepted as port 0 unless you add `.min(1)` or reject empty strings first.
- **A service that takes `req` and `res`.** It cannot run from a queue worker or a CLI, and the test needs a fake response. Throw `NotFoundError` and let the central handler pick the status.
- **A repository that throws HTTP errors.** "Not found" is a business decision. Return `null` and let the service throw `NotFoundError`.
- **More than one place formatting errors.** A controller that sends its own `{ msg }` gives the client a second shape. Throw, and let the one handler format the response.
- **A three-argument "error handler", or no `res.headersSent` check.** Three parameters means normal middleware, so it never sees errors. Without the check, an error after a partial response throws "Cannot set headers after they are sent".
- **Assuming Express 5 behavior on Express 4.** These async controllers rely on Express 5 forwarding rejections. On Express 4 the request gets no response. Example 9 shows it.
- **One in-memory repository shared by tests.** Notes from one test leak into the next. Build a fresh app and a fresh repository in each test.

## Best practices

- `app.js` exports `createApp(deps)` and does nothing on import. `server.js` is the only file that reads env, opens a port, and installs signal handlers.
- Validate config at startup with a schema, freeze the result, and exit non-zero on failure, printing every bad variable at once.
- One error base class and one central handler. Stable `code` strings for clients, `status` for HTTP, and a generic message for 5xx with the real error logged on the server.
- Pass dependencies as one object per factory, `{ notesRepository }`. Named fields stay readable when you add another dependency.
- Let the repository's interface be the contract. Keep an in-memory version next to the real one and run the same behavior tests against both.
- Start layer-based while the app is small. Switch to feature folders when one change routinely touches many directories. Keep `errors/`, `middleware/`, and `config/` shared either way.
- Check the dependency rule in a test or a lint rule, not only in a diagram.
- Use supertest against `createApp()` for HTTP tests. Keep a curl or smoke check against the real `server.js` for config loading and the real repository. Lesson 93 covers that style of test.

## ⭐ Interview lens

> **Q: “Why export a `createApp()` function instead of the app that `server.js` starts?”**  
> A: Building the app and running it are different jobs. `createApp(deps)` wires the middleware, routes, and your factories, and returns the Express app. That app is a request handler, `(req, res) => ...`, and it has not called `listen`, read `process.env`, or opened a database. A test calls it with an in-memory repository and passes the app to supertest. supertest wraps it in `http.createServer`, listens on port 0 so the operating system picks a free port, sends a real request, and closes the server. `server.js` is the only file that loads config and calls `listen`, so importing the app has no side effects. The trap is answering "so tests can use port 3001". The point is that no test chooses a port at all. If `listen` lived in the imported module, two test files would clash on `EADDRINUSE`, and the process would not exit while the socket stayed open.

> **Q: “What goes in a controller, a service and a repository?”**  
> A: The controller translates HTTP into a function call. It reads input that validation already stored on `res.locals`, calls the service, and chooses the status, such as 201 plus a `Location` header. The service holds business rules, such as "titles are unique", and throws a domain error such as `ConflictError` or `NotFoundError`. It never sees `req` or `res`, so the same function can run from a test, a CLI, or a worker. The repository does storage only. It returns the row or `null`, and it does not decide that `null` means 404. Imports point one way, controller to service to repository. The limit is a service that calls `res.status`. That service can only be tested with a fake response, and it cannot be reused outside HTTP.

> **Q: “How do you do dependency injection in Express without a framework?”**  
> A: Use factory functions that take their dependencies as one object. `createNotesService({ notesRepository })` returns the service functions, which close over that object. `server.js`, the composition root, builds the real repository, passes it to the service, the service to the controller, and the controller to the router. There is no container and no decorator. A test passes `createMemoryNotesRepository(seed)`, or an object whose `list()` rejects, to drive the 500 path, which is hard to force with a real database. Nothing imports a concrete repository, so you do not mock the module. The limit is discipline. The rule is real only if something checks it. Example 10 reads each layer's `import` lines and fails on a forbidden one. That regex misses `await import()` and re-exports, so a larger codebase usually moves the check into a lint rule.

> **Q: “Your async controllers have no try/catch. Is that safe?”**  
> A: On Express 5, yes. A rejected promise from an async handler is forwarded to the error middleware, which changed in v5.0, so these controllers have no try/catch and the central handler still formats `{ error: { code, message } }`. On Express 4 it is not safe. The rejection never reaches `next(err)`, no response is written, and Node's default since Node 15, `--unhandled-rejections=throw`, crashes the process. Example 9 ran the same project on Express 4.22.3. The stray rejection was `Error: disk on fire`, and without forcing the test runner to exit the request stayed open. Express 4 needs the `asyncHandler` wrapper from lesson 50 around each handler. Express 4 also sets `req.body` to `{}` when no body was sent, where Express 5 leaves it `undefined`, so a missing-body validation error points at `title` instead of the root. Both still return 422 if the schema rejects either shape.

## Cheat-card

- The composition root is `server.js`: `loadConfig()`, the concrete dependencies, `createApp(deps)`, and `listen`. Only that file has side effects.
- `createApp(deps)` builds and returns the app. No `listen`, no `process.env`. A test is `request(createApp({ notesRepository: createMemoryNotesRepository() }))`.
- Imports point one way: routes, controller, service, repository. A service does not import `express`. A repository does not throw an HTTP error.
- Hand-rolled dependency injection is `createX({ dep })`. Swap a dependency by passing a different object.
- Config is a Zod schema over `process.env`, `z.coerce.number()` for numbers, `z.prettifyError` from Zod 4 on failure, and `process.exit(1)` before listening.
- Errors: `AppError(message, status, code, details)` and subclasses. `notFound` after the routes. One four-argument handler last. If `res.headersSent`, call `next(err)`. A 5xx is a generic message plus a server log.
- Express 5 forwards async rejections, leaves `req.body` `undefined` when there is no body, and passes listen errors such as `EADDRINUSE` to the `listen` callback. Express 4 does none of these.
- Validated input lives on `res.locals.validated.body` and `.params`. Do not assign to `req.query`.
- Start with layer-based folders while the app is small. Move to feature folders when one change spans many directories.

## Good to know

- Layer-based folders (`controllers/`, `services/`) make each layer's rule visible, and one feature change touches many directories. Feature-based folders (`notes/`, `users/`) keep a feature together, which is easier to review, delete, or extract, and they need a naming convention plus a check so the layer rules survive. Shared `errors/`, `middleware/`, and `config/` stay at the top either way.
- Versions this lesson ran: Express 5.3.0, Express 4.22.3 for the comparison, Zod 4.6.5, supertest 7.3.1, Node v24.19.0. `z.prettifyError` was added in Zod 4.
- In Example 9, killing the hung Express 4 test with `timeout` at 20 seconds exited 124, and the runner reported the file as cancelled. Outside the test runner, the unhandled rejection crashes the process.

## Learn More

- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Error handling expressjs.com](https://expressjs.com/en/guide/error-handling.html)
- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Formatting errors zod.dev](https://zod.dev/error-formatting)
- [supertest README github.com](https://github.com/forwardemail/supertest)
- [Test runner nodejs.org](https://nodejs.org/docs/latest-v24.x/api/test.html)
