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

## Why it matters

Express gives you no folder layout. `express()` returns a function, and where your routes, database calls and error handling live is up to you. A one-file app is fine at 100 lines. At 3,000 lines the single-file layout costs you in three places:

- **Tests.** A test that has to `import './server.js'` also opens a port, reads real environment variables and connects to the real database. Two test files then fight over port 3000.
- **Change.** When SQL sits inside a route handler, swapping the database or adding a cache means editing every handler.
- **Errors.** Every handler invents its own error JSON, so the client sees five different shapes for "not found".

This lesson builds a small notes API with a layout that fixes these three problems:

- a config module that validates the environment and refuses to start on bad values;
- an error module with one central handler;
- a `createApp()` factory that tests can import without opening a port;
- controllers, services and repositories wired together by hand.

Every file in this lesson is the code that was built and run. The test output and the curl session are copied from those runs.

## The concept, simply

A structured Express project comes down to three decisions.

1. **Where files go.** Group by *kind*, with `controllers/`, `services/` and `models/` at the top. Or group by *feature*, with `notes/`, `users/` and `billing/` at the top, each holding its own controller, service and repository.
2. **Who may import whom.** Code is split into layers, and each layer has one job:
   - the **routes** map a URL to a handler;
   - the **controller** translates between HTTP and plain function calls;
   - the **service** holds the business rules;
   - the **repository** reads and writes storage.

   Imports point one way only: routes → controller → service → repository. A service never touches `req`, and a repository never decides what status to send.
3. **Where the pieces are connected.** One small file, the *composition root* (`server.js`), reads the environment, picks the real implementations, such as "store notes in this JSON file", and passes them in. Everything else receives its dependencies as function arguments. This is dependency injection by hand: no container, no decorators, just arguments. Because the app is built by a function, `createApp(deps)`, a test can call that function with an in-memory repository and get a fully working app back without opening a port.

## How it works

What happens at startup, and then on each request, in the project built below:

1. `node src/server.js` runs. `loadConfig()` parses `process.env` with a Zod schema. If any variable is invalid, it throws one error that lists every bad variable. `server.js` prints that error and calls `process.exit(1)` before any port is opened.
2. `server.js` creates the concrete repository, `createFileNotesRepository(config.dataFile)`, and calls `createApp({ notesRepository })`.
3. `createApp` builds the chain by hand: `createNotesService({ notesRepository })` → `createNotesController({ notesService })` → `createNotesRouter({ notesController })`. It then registers `express.json()`, the routes, the 404 forwarder and the central error handler, in that order, and returns the `app`. It does **not** call `listen`.
4. `server.js` calls `app.listen(config.port, cb)`. In Express 5 a listen error such as `EADDRINUSE` is passed to `cb` (changed in v5.0; Express 4 did not pass it).
5. A request arrives, for example `POST /notes`. `express.json()` parses the body. The `validate(CreateNoteSchema)` middleware runs Zod and stores the result in `res.locals.validated.body`.
6. The controller method reads `res.locals.validated.body` and calls `notesService.createNote(...)`. The service checks the rule "titles are unique" (it throws `ConflictError` on a clash), then calls `notesRepository.create(...)`.
7. The controller sends `201` with a `Location` header. If any step threw, or an `await` rejected, Express 5 passes the error to the error middleware: the 404 forwarder is skipped, and the central handler maps the error to `{ error: { code, message, details? } }` with the right status.

**Layer-based vs feature-based folders.** Here are the same three resources laid out both ways (illustrative trees, not the built project):

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

Layer-based folders are easy to start with and make each layer's rules visible: everything in `services/` must not import `express`. The cost shows up as the app grows. One change to "notes" touches four directories, and nothing stops `billing.service.js` from reaching into `users.repository.js`. Feature-based folders keep one feature's files side by side, so a change or a code review stays inside one directory. You can also delete or extract a feature by moving one folder. The cost is that the layer rules are no longer visible from the folder names, so you need a naming convention (`*.service.js`) and a check (Example 10). Code shared by several features (`errors/`, `middleware/`, `config/`) still sits at the top in both layouts. The project below is feature-based with shared modules at the top. A common path is to start layer-based and switch once there are more than a handful of resources.

**The dependency rule.** The arrows show which file may import which. Nothing points back up or to the left.

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

What each layer may import:

- **Routes** may import `express` (for `Router`), the schemas and the validation middleware. They receive the controller as an argument.
- **The controller** may import nothing from storage. It receives the service as an argument and uses only `req`, `res` and `res.locals`.
- **The service** may import the error classes. It must not import `express` or a concrete repository; it receives the repository as an argument.
- **A repository** may import `node:fs`, a database driver or an HTTP client. It must not import services, controllers or `express`, and it does not throw HTTP errors. A missing row comes back as `null`, and the service decides that `null` means 404.

The rule is what makes a swap cheap. The service depends only on the shape `{ list, findById, findByTitle, create }`, so a file-backed object, an in-memory object, or a PostgreSQL-backed one in the future all fit.

**A config module.** `process.env` values are all strings or `undefined`. If code reads `process.env.PORT` in ten places, it parses the value ten times, and a typo such as `PORT=80O` shows up only when that code path runs. The config module reads the environment once, at startup. Zod coerces each value (`z.coerce.number()` turns `'6001'` into `6001`), checks it (`.int().min(0).max(65535)`), fills in defaults and returns a frozen object. On failure, `z.prettifyError` (added in Zod 4) formats every issue with its path, and the process exits before it binds a port. Only `server.js` calls `loadConfig()`. `createApp` receives the values it needs as arguments, so tests never depend on the shell's environment.

**An error module.** This follows the pattern from [lesson 50](50-error-handling-the-4-arg-handler-and-async-errors.md). There is one base class, `AppError(message, status, code, details)`, and small subclasses: `NotFoundError` (404), `ValidationError` (422, the same status [lesson 65](65-validation-pagination-filtering-sorting.md) uses), and `ConflictError` (409). A `notFound` middleware sits after all routes and forwards a `NotFoundError`. One four-argument handler sits last of all, and it is the only place that turns errors into responses:

- for an `AppError`, it uses `status`, `code` and `details`;
- for body-parser's bad-JSON error (`err.type === 'entity.parse.failed'`), it responds `400`;
- for everything else, it responds `500` with a generic message and logs the real error on the server only.

If headers were already sent, it calls `next(err)` so Express's default handler can close the connection, as the Express error-handling guide requires. The controllers are `async` and contain no `try/catch`: **Express 5 forwards a rejected promise to the error middleware** (changed in v5.0). As lesson 50's correction records, the same async controller on Express 4 does not reach the handler at all. Example 9 shows what that looks like inside a test run.

**A `createApp()` factory, no `listen`.** `app.js` exports a function that builds and returns the Express app. That function does not read `process.env`, does not create a real database client and does not call `listen`. Calling `listen` belongs to `server.js`, the one file that is only run, never imported. The split exists because `app.listen()` opens a socket. Every test file that imported a listening module would need its own free port, and it would have to close the server or the test process never exits. An Express `app` is itself a request handler, `(req, res) => …`, so a test does not need a listening server at all. supertest takes the `app`, wraps it in `http.createServer(app)`, listens on port 0 (the OS picks a free port), sends a real HTTP request over loopback and closes the server after the response.

![How supertest drives your API: the test file calls request(app).post('/users'), supertest binds the app to a random free port on an ephemeral server, sends a real HTTP request through your routes and middleware, and the response comes back for .expect(201) and assertions on res.body, with no manual listen() and no hardcoded port](assets/i56_01_dc096a03.svg)
*Figure: How supertest drives your API. Look at: the "Ephemeral server" box — supertest opens and closes the port itself, which is why `createApp()` must hand back an app that is not yet listening.*

**Dependency injection by hand.** Each factory takes its dependencies as one object argument and returns plain functions that close over them: `createNotesService({ notesRepository })`. This is the whole mechanism. There is no registry, and you never call `new Container()`. To use a different storage you pass a different object. The tests in Example 7 pass `createMemoryNotesRepository(seed)`, which is fast, needs no files, and starts each test from a known state. The 500-path test passes an object whose `list()` rejects, which would be hard to arrange with a real database. Because the service only ever sees the argument, nothing has to be patched or mocked at the module level.

**What changes on Express 4.** The layout works on Express 4.22.3 too, but the same files behave differently in two places. Both were run (Example 9):

- **Async errors.** An `async` controller that rejects is not forwarded to the error handler. Without an `asyncHandler` wrapper (lesson 50), no response is written.
- **Missing body.** `req.body` is `{}` instead of `undefined` when no body is sent, so the validation error points at `title` instead of the root.

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

- **Calling `listen()` in the module that tests import.** Every test file then opens a port, two files clash on `EADDRINUSE`, and the test process does not exit while the server is open. Return the app from `createApp()` and call `listen` only in `server.js`.
- **Reading `process.env` deep inside services.** It hides a dependency, and a typo shows up only on the code path that reads it. Read it once in the config module and pass the values down.
- **Parsing env without coercion.** `process.env.PORT` is the string `'6001'`. `z.number()` rejects it; `z.coerce.number()` converts it. Coercion has its own trap: `z.coerce.number()` turns `''` into `0`, so an empty `PORT=` is accepted as port 0 (any free port) unless you add `.min(1)` or reject empty strings first.
- **Services that take `req` and `res`.** A service that calls `res.status(404)` cannot be reused from a queue worker or a CLI, and it can only be tested with a fake response object. Throw `NotFoundError` from the service and let the central handler decide the status.
- **Repositories that throw HTTP errors.** "Not found" is a business decision. Return `null` from storage and let the service turn it into `NotFoundError`.
- **More than one place formats errors.** If a controller sends `res.status(400).json({ msg })` itself, clients see two shapes. Throw, and let the single handler format the response.
- **Leaving out the four-argument signature or `res.headersSent`.** A three-argument "error handler" is treated as normal middleware and never sees errors. Without the `headersSent` check, an error after a partial response throws "Cannot set headers after they are sent".
- **Assuming Express 5 behaviour on Express 4.** The `async` controllers here rely on Express 5 forwarding rejections. On Express 4 they leave requests without a response (Example 9).
- **Sharing one in-memory repository between tests.** Notes created in one test leak into the next. Build a fresh app with a fresh repository in each test, as `build()` does.

## Best practices

- **Keep `app.js` side-effect free.** It exports `createApp(deps)` and does nothing on import. `server.js` is the only file that reads env, opens ports and installs signal handlers.
- **Validate config at startup with a schema,** freeze the result and exit non-zero on failure, printing every bad variable at once.
- **One error base class plus one central handler.** Use stable `code` strings for clients, `status` for HTTP, and a generic message for 5xx with the real error logged server-side.
- **Pass dependencies as arguments,** one object per factory (`{ notesRepository }`). Named fields keep call sites readable and let you add a dependency without reordering parameters.
- **Let the repository's interface be the contract.** Write the in-memory version alongside the real one and run the same behaviour tests against both, so they cannot drift.
- **Start layer-based if the app is small. Switch to feature folders when one change routinely touches many directories.** Keep `errors/`, `middleware/` and `config/` shared either way.
- **Check the dependency rule automatically** (a test or a lint rule), not just in a diagram.
- **Use supertest against `createApp()` for HTTP tests** and keep a curl or smoke check against the real `server.js` for the parts tests skip, such as config loading and the file or database repository. See [lesson 93](93-integration-testing.md).

## ⭐ Interview lens

> **Q: “Why export a `createApp()` function instead of the app that `server.js` starts?”**  
> A: Building the app and running it are different jobs. `createApp(deps)` returns an Express app, which is a request handler, without opening a socket. Tests call it with fake dependencies and hand it to supertest, which listens on an ephemeral port and closes it after each request. `server.js` is the only file that reads env and calls `listen`, so importing the app has no side effects. *Trap:* "so tests can use port 3001" misses the point. The goal is that no test chooses a port at all.

> **Q: “What goes in a controller, a service and a repository?”**  
> A: The controller translates HTTP to function calls: it reads validated input from `res.locals`, calls the service and picks the status code. The service holds business rules, such as "titles are unique", and throws domain errors like `NotFoundError`. It never sees `req` or `res`. The repository does storage only and returns data or `null`. Imports point one way: controller → service → repository.

> **Q: “How do you do dependency injection in Express without a framework?”**  
> A: With factory functions that take their dependencies as arguments: `createNotesService({ notesRepository })`. The composition root builds the real objects in order and passes them in. A test passes an in-memory repository, or one that rejects to test the 500 path. No container or module mocking is needed because nothing imports a concrete dependency.

> **Q: “Layer-based or feature-based folders?”**  
> A: Layer-based (`controllers/`, `services/`) is simple and makes each layer's rules visible, but one feature change touches many folders. Feature-based (`notes/`, `users/`) keeps a feature's files together, which makes it easier to review, delete or extract. It needs a naming convention and a check to keep the layer rules. Shared `errors/`, `middleware/` and `config/` stay at the top either way.

> **Q: “Your async controllers have no try/catch. Is that safe?”**  
> A: On Express 5, yes: a rejected promise from a handler is forwarded to the error middleware. On Express 4 it is not. The request gets no response, and by default Node crashes the process on the unhandled rejection. Express 4 needs an `asyncHandler` wrapper around each handler.

## Cheat-card

- **Composition root:** `server.js` = `loadConfig()` + concrete deps + `createApp(deps)` + `listen`. Only it has side effects.
- **`createApp(deps)`:** builds and returns the app; no `listen`, no `process.env`. Tests: `request(createApp({ notesRepository: createMemoryNotesRepository() }))`.
- **Dependency rule:** routes → controller → service → repository. Services never import `express`; repositories never throw HTTP errors.
- **DI by hand:** `createX({ dep })` factories; swap a dependency by passing a different object.
- **Config:** Zod schema over `process.env`, `z.coerce.number()` for numbers, `z.prettifyError` (Zod 4) on failure, `process.exit(1)` before listening.
- **Errors:** `AppError(message, status, code, details)` + subclasses; `notFound` after routes; one 4-arg handler last; `res.headersSent` → `next(err)`; 5xx = generic message + server log.
- **Express 5:** async rejections are forwarded; `req.body` is `undefined` with no body; `app.listen(port, cb)` passes listen errors to `cb`. Express 4 does none of these.
- **Validated input:** `res.locals.validated.body` / `.params`, not `req.query =`.
- **Folders:** layer-based for small apps; feature-based when changes span many directories.
- **Versions used:** Express 5.3.0, Zod 4.6.5, supertest 7.3.1, Node v24.19.0.

---

## Learn More

- [Express 5.x API reference expressjs.com](https://expressjs.com/en/5x/api.html)
- [Error handling expressjs.com](https://expressjs.com/en/guide/error-handling.html)
- [Migrating to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Formatting errors zod.dev](https://zod.dev/error-formatting)
- [supertest README github.com](https://github.com/forwardemail/supertest)
- [Test runner nodejs.org](https://nodejs.org/docs/latest-v24.x/api/test.html)
