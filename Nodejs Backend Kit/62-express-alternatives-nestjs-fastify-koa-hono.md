---
title: "Alternatives to Express: NestJS, Fastify, Koa and Hono"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Alternatives to Express: NestJS, Fastify, Koa and Hono

*28 min read · Updated 10 Oct 2026 · Topic 96 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0 (also NestJS 12.1.2, Fastify 5.12.5, Koa 3.2.1, Hono 4.13.13)

---

## Say it in 30 seconds

NestJS, Fastify, Koa, and Hono are other Node web frameworks that do the same job as Express: match a method and path, run code around the handler, and turn a throw into a response. They differ in where validation lives, what a default error looks like, and whether the app is tied to Node. You meet them when a codebase is not Express, or when you are choosing one. The trade-off is that the same JSON body can be rejected by one framework and accepted by another, because their validators do not share rules.

## Why it matters

Lessons 47 to 61 and 63 to 66 use Express. Real codebases also use NestJS, Fastify, Koa, and Hono. Each one chooses four things: where validation lives, what an error response looks like, how code wraps a handler, and whether the app is tied to Node. Those choices show up as bugs when you switch frameworks without knowing them. Measured in this lesson:

- **Unknown routes get different answers.** With no custom handler, Express answers with an HTML page, Koa with the text `Not Found`, Hono with the text `404 Not Found`, and Fastify and Nest with two different JSON shapes (Example 7).
- **Default 500s can leak.** Fastify's default 500 body includes the thrown error's message. Express's default 500 page includes the full stack trace unless `NODE_ENV=production` (Example 7).
- **The same payload gets different verdicts.** `{"qty":"2"}` is rejected by zod and by class-validator, and **accepted as the number 2** by Fastify, because Fastify's JSON Schema validator coerces types by default (Example 12). Coercion means the validator converts a string into a number instead of rejecting it.
- **A forgotten `await` in Koa gives a 404.** The route ran, but nothing had set the body when the middleware chain finished (Example 10).

This lesson builds the same tiny API five times and runs the same curl script against all five.

## The concept, simply

All five sit on Node's `http` server (lesson 40). Each adds a router that matches method plus path, a request and response object, a way to run code around the handler, and an error path.

- **Express 5** (`express` 5.3.0). Middleware is a list of `(req, res, next)` functions run in order (lesson 49). Express has no built-in validation, so you bring a library such as zod. Errors go to a function with four arguments, `(err, req, res, next)`. Express 5 also forwards a throw inside an async handler there (lesson 50).
- **Fastify** (`fastify` 5.12.5). A route can declare a JSON Schema for its body, query, params, headers, and response. When the route is registered, Fastify compiles the input schema into a validation function with **Ajv**, and the response schema into a serializer with **fast-json-stringify**. Both are dependencies in Fastify's `package.json`. Errors go to `setErrorHandler`. Unknown routes go to `setNotFoundHandler`.
- **Koa** (`koa` 3.2.1). There is one context object, `ctx`, per request. Middleware is `async (ctx, next) => {}`, and `next()` returns a promise that settles when everything downstream has finished. Code after `await next()` runs after the handler. That is the onion. Koa's core has no router and no body parser. You add `@koa/router` 15.7.0 and `@koa/bodyparser` 6.1.0.
- **Hono** (`hono` 4.13.13). Handlers receive a context `c` and return a Web-standard `Response`. The app itself is `app.fetch(request)`, the same shape as the Fetch API. On Node, `@hono/node-server` 2.1.4 adapts Node's request and response to that function. Validation is middleware, such as `zValidator` from `@hono/zod-validator` 0.9.1.
- **NestJS** (`@nestjs/core` 12.1.2). This is a structure layer on an HTTP library. The default here is Express, through `@nestjs/platform-express` 12.1.2, which installs Express 5.2.1. You can use Fastify instead. You write TypeScript classes with decorators. A decorator is a marker on a class or method that records metadata. Modules group the parts. Controllers hold the routes. Providers are services the dependency-injection container creates and passes into constructors. Pipes validate or transform arguments. Exception filters turn thrown errors into responses.

## How it works

The same `POST /items` goes through these steps in every framework. The names change.

1. **Node's `http` server** parses the request line and headers and emits a request with a readable body stream.
2. **The router matches** method plus path. Express 5 uses the `router` package (path-to-regexp). Fastify uses `find-my-way`, a radix tree. Koa uses `@koa/router`. Hono uses its own router. Nest registers each decorated controller method on the underlying Express or Fastify app at startup.
3. **The body is read and parsed as JSON.** Express uses `express.json()`. Fastify uses its built-in content-type parser. Koa uses `@koa/bodyparser`. Hono uses `c.req.json()`, which `zValidator('json', …)` calls for you. Nest uses Express's parser. Malformed JSON fails here, and each framework reports it differently (request 4 in Example 6).
4. **Validation runs.** Express and Koa: you call `schema.safeParse()` yourself. Fastify: the Ajv function compiled from `schema.body`. Hono: `zValidator` before the handler. Nest: `ValidationPipe`. It uses class-transformer to turn the plain body into an instance of the DTO class, then runs the class-validator decorators on that instance. A DTO is the class that describes the body.
5. **The handler returns data.** Express calls `res.json()`. Fastify returns an object or calls `reply.send()`. Koa assigns `ctx.body`. Hono returns `c.json()`. Nest returns a value that Nest serializes.
6. **The response is serialized.** Fastify uses the compiled response schema when the route has one, and drops fields the schema does not list (Example 13). The other four call `JSON.stringify`.
7. **Errors.** A throw in steps 3 to 6 goes to the error path: Express's four-argument middleware, Fastify's `setErrorHandler`, a Koa middleware that wraps `await next()` in try/catch, Hono's `app.onError`, or a Nest exception filter. A request that matches no route goes to the 404 path: a final Express `app.use()`, Fastify's `setNotFoundHandler`, Koa when no body was set, Hono's `app.notFound`, or a Nest `NotFoundException` that reaches the filter.

**What `next()` returns.** In Express 5, `next()` returns `undefined`. `await next()` does not wait for an async handler. Koa builds its chain with `koa-compose`. Each `next()` returns the promise of the rest of the chain, so code after `await next()` runs after the handler. Example 9 shows both orders. That is why one outer Koa middleware can time the request, catch errors, and set a default body.

**Async handlers.** The `/boom` route in every server is an async function that throws. In the versions used here, all five await the promise and send the rejection to their error hook. Express 4 did not. The rejection was unhandled and the process crashed (lesson 50).

**Fastify compiles schemas when the route is registered.** Ajv turns `schema.body` into a function once, not on each request. Fastify's default Ajv options, in `node_modules/@fastify/ajv-compiler/lib/default-ajv-options.js`, are `coerceTypes: 'array'`, `useDefaults: true`, `removeAdditional: true`, and `allErrors: false`. So `"2"` becomes `2` for an integer field, and only the first error is reported. zod and class-validator list every failure.

**Hono is a function from Request to Response.** `app.fetch` takes a Web `Request` and returns a `Response`. You can call it in a test with no server (Example 8). On Node, `@hono/node-server`'s `serve({ fetch: app.fetch })` does the conversion.

**Nest records types with decorators.** `@Controller()`, `@Get()`, `@Body()`, `@Injectable()`, and class-validator decorators such as `@IsInt()` are TypeScript experimental decorators. They record metadata with `reflect-metadata`. With `emitDecoratorMetadata`, `tsc` also writes constructor parameter types into the output, and Nest reads that metadata for two jobs: which provider to inject, and which DTO class `ValidationPipe` should validate. Turn the metadata off and both fail silently (Common mistakes). Node's built-in type stripping (lesson 95) cannot run this code. It fails on a parameter property with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, and a decorator alone fails with `SyntaxError: Invalid or unexpected token`. The Nest project is compiled with `tsc`, and the compiled JavaScript is what runs.

## Code examples

All five servers implement the same contract:

| Request | Expected |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `POST /items` with `{"name":"pen","qty":2}` | `201 {"id":1,"name":"pen","qty":2}` |
| `POST /items` where `name` is empty or `qty` is not a positive integer | `400` with an error body |
| `POST /items` with malformed JSON | `400` |
| any unknown route | `404 {"error":"Not Found","path":…}` |
| `GET /boom` (throws `Error('db password is hunter2')`) | `500 {"error":"Internal Server Error"}`; the message and stack go only to the server log |

The 400 body for a validation failure is left in each library's own shape so that you can see the differences.

Setup used for Express, Fastify, Koa and Hono (one ESM project):

bash

```
npm init -y && npm pkg set type=module
npm install express@5 zod fastify koa @koa/router @koa/bodyparser hono @hono/node-server @hono/zod-validator autocannon
# installed: express 5.3.0, zod 4.6.5, fastify 5.12.5, koa 3.2.1, @koa/router 15.7.0,
#            @koa/bodyparser 6.1.0, hono 4.13.13, @hono/node-server 2.1.4,
#            @hono/zod-validator 0.9.1, autocannon 8.0.0
```

**Example 1 — Express 5 baseline: zod, a 404 fallback and a 4-argument error handler.**

javascript

```
// express-app.js — Express 5 + zod
import express from 'express';
import { z } from 'zod';

const Item = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
});

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/items', (req, res) => {
  const result = Item.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Bad Request',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  res.status(201).json({ id: 1, ...result.data });
});

app.get('/boom', async () => {
  throw new Error('db password is hunter2'); // Express 5 forwards async throws
});

// 404: runs only when no route above matched
app.use((req, res) => res.status(404).json({ error: 'Not Found', path: req.path }));

// Centralized error handler: 4 arguments
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {           // set by express.json()
    return res.status(400).json({ error: 'Bad Request', message: 'Malformed JSON' });
  }
  console.error(err);                                   // full error stays in the log
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(Number(process.env.PORT ?? 0), () =>
  console.log(`express listening on ${server.address().port}`));
```

**Example 2 — Fastify: a JSON-schema `schema` on the route, `setNotFoundHandler`, `setErrorHandler`.**

Fastify sets `err.validation` on schema failures. It reports malformed JSON as a 400 error (`FST_ERR_CTP_INVALID_JSON_BODY`, `statusCode` 400) that also reaches `setErrorHandler`.

javascript

```
// fastify-app.js — Fastify 5, JSON-schema validation
import Fastify from 'fastify';

const app = Fastify();

app.get('/health', async () => ({ status: 'ok' }));

app.post('/items', {
  schema: {
    body: {
      type: 'object',
      required: ['name', 'qty'],
      additionalProperties: false,
      properties: {
        name: { type: 'string', minLength: 1 },
        qty: { type: 'integer', minimum: 1 },
      },
    },
  },
}, async (request, reply) => {
  reply.code(201);
  return { id: 1, ...request.body };
});

app.get('/boom', async () => {
  throw new Error('db password is hunter2');
});

app.setNotFoundHandler((request, reply) => {
  reply.code(404).send({ error: 'Not Found', path: request.url });
});

app.setErrorHandler((err, request, reply) => {
  if (err.validation) {                                 // schema failure
    return reply.code(400).send({ error: 'Bad Request', message: err.message });
  }
  if (err.statusCode && err.statusCode < 500) {         // e.g. malformed JSON body
    return reply.code(err.statusCode).send({ error: 'Bad Request', message: err.message });
  }
  console.error(err);
  reply.code(500).send({ error: 'Internal Server Error' });
});

const address = await app.listen({ port: Number(process.env.PORT ?? 0), host: '127.0.0.1' });
console.log(`fastify listening on ${new URL(address).port}`);
```

**Example 3 — Koa: `@koa/router`, `@koa/bodyparser`, zod, and an outermost try/catch middleware.**

The error handler is just the first middleware. It wraps everything that runs after it, because `await next()` waits for the whole chain.

javascript

```
// koa-app.js — Koa 3 + @koa/router + @koa/bodyparser + zod
import Koa from 'koa';
import Router from '@koa/router';
import { bodyParser } from '@koa/bodyparser';
import { z } from 'zod';

const Item = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
});

const app = new Koa();
const router = new Router();

// Centralized error handler: the OUTERMOST middleware wraps everything in try/catch
app.use(async (ctx, next) => {
  try {
    await next();
    if (ctx.status === 404 && ctx.body === undefined) {  // nothing set a body
      ctx.status = 404;
      ctx.body = { error: 'Not Found', path: ctx.path };
    }
  } catch (err) {
    if (err.status && err.status < 500) {                // e.g. bodyparser's 400
      ctx.status = err.status;
      ctx.body = { error: 'Bad Request', message: err.message };
      return;
    }
    console.error(err);
    ctx.status = 500;
    ctx.body = { error: 'Internal Server Error' };
  }
});

app.use(bodyParser());

router.get('/health', (ctx) => { ctx.body = { status: 'ok' }; });

router.post('/items', (ctx) => {
  const result = Item.safeParse(ctx.request.body);
  if (!result.success) {
    ctx.status = 400;
    ctx.body = {
      error: 'Bad Request',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
    return;
  }
  ctx.status = 201;
  ctx.body = { id: 1, ...result.data };
});

router.get('/boom', async () => {
  throw new Error('db password is hunter2');
});

app.use(router.routes());
app.use(router.allowedMethods());

const server = app.listen(Number(process.env.PORT ?? 0), () =>
  console.log(`koa listening on ${server.address().port}`));
```

**Example 4 — Hono on Node: `zValidator` with a hook, `app.notFound`, `app.onError`.**

The third argument to `zValidator` is a hook that receives the parse result. Return a response from the hook to replace the default 400 body (the default is shown in Example 7). Malformed JSON never reaches the hook: Hono's validator throws an `HTTPException` with status 400, and `app.onError` handles it.

javascript

```
// hono-app.js — Hono 4 on Node via @hono/node-server + @hono/zod-validator
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

const Item = z.object({
  name: z.string().min(1),
  qty: z.number().int().positive(),
});

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.post('/items',
  zValidator('json', Item, (result, c) => {             // hook: shape the 400 yourself
    if (!result.success) {
      return c.json({
        error: 'Bad Request',
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }, 400);
    }
  }),
  (c) => c.json({ id: 1, ...c.req.valid('json') }, 201));

app.get('/boom', async () => {
  throw new Error('db password is hunter2');
});

app.notFound((c) => c.json({ error: 'Not Found', path: c.req.path }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException && err.status < 500) { // e.g. malformed JSON
    return c.json({ error: 'Bad Request', message: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 0) }, (info) =>
  console.log(`hono listening on ${info.port}`));
```

**Example 5 — NestJS: `ValidationPipe` + class-validator, a provider injected by DI, a catch-all exception filter.**

Validation choice for Nest: `ValidationPipe` + class-validator 0.15.1 + class-transformer 0.5.1. This is the approach in the Nest validation docs, and it needs no extra package. A zod pipe would also work.

TypeScript 7.0.2's `tsc` ships as a native binary (`@typescript/typescript-linux-x64`), so this project lives on a filesystem that allows exec. `/tmp` here is mounted noexec. The Nest CLI was not used.

bash

```
npm init -y && npm pkg set type=module
npm install @nestjs/core @nestjs/common @nestjs/platform-express reflect-metadata rxjs class-validator class-transformer
npm install -D typescript @types/node @types/express
# installed: @nestjs/core, @nestjs/common, @nestjs/platform-express 12.1.2 (Express 5.2.1 inside),
#            reflect-metadata 0.2.2, rxjs 7.8.2, class-validator 0.15.1, class-transformer 0.5.1,
#            typescript 7.0.2, @types/node 26.6.5, @types/express 5.0.6
node node_modules/typescript/bin/tsc -p .   # compiles src/*.ts to dist/*.js
PORT=6140 node dist/main.js
```

json

```
{
  "compilerOptions": {
    "target": "es2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  }
}
```

typescript

```
// src/main.ts — NestJS 12 (Express adapter) + ValidationPipe + class-validator
import 'reflect-metadata';
import {
  Module, Controller, Injectable, Get, Post, Body, HttpCode, ValidationPipe,
  Catch, HttpException, HttpStatus,
  type ExceptionFilter, type ArgumentsHost,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsString, MinLength, IsInt, IsPositive } from 'class-validator';
import type { Request, Response } from 'express';

class CreateItemDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() @IsPositive() qty: number;
}

@Injectable()                              // a provider: Nest creates one and injects it
class ItemsService {
  private nextId = 1;
  create(dto: CreateItemDto) { return { id: this.nextId++, ...dto }; }
}

@Controller()
class ItemsController {
  constructor(private readonly items: ItemsService) {} // resolved from the constructor type

  @Get('health')
  health() { return { status: 'ok' }; }

  @Post('items')
  @HttpCode(201)
  create(@Body() dto: CreateItemDto) { return this.items.create(dto); }

  @Get('boom')
  async boom() { throw new Error('db password is hunter2'); }
}

@Catch()                                   // no argument = catch everything
class AllExceptionsFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    if (err instanceof HttpException) {
      const status = err.getStatus();
      if (status === HttpStatus.NOT_FOUND) {
        return res.status(404).json({ error: 'Not Found', path: req.path });
      }
      return res.status(status).json(err.getResponse()); // keeps ValidationPipe's body
    }
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

@Module({ controllers: [ItemsController], providers: [ItemsService] })
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: ['error'] });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
app.useGlobalFilters(new AllExceptionsFilter());
await app.listen(Number(process.env.PORT ?? 0), '127.0.0.1');
console.log(`nest listening on ${new URL(await app.getUrl()).port}`);
```

**The five side by side.**

| | Express 5.3.0 | Fastify 5.12.5 | Koa 3.2.1 | Hono 4.13.13 | NestJS 12.1.2 |
|---|---|---|---|---|---|
| Handler shape | `(req, res) => res.json(x)` | `async (request, reply) => x` | `(ctx) => { ctx.body = x }` | `(c) => c.json(x)` | class method returning `x` |
| Middleware model | `(req, res, next)`; `next()` returns `undefined` | hooks + plugins (`register`) | `async (ctx, next)`; `await next()` waits for downstream | `async (c, next)`; `await next()` waits for downstream | middleware, guards, interceptors, pipes, filters |
| Validation used here | zod `safeParse` in the handler | route `schema.body` (Ajv) | zod `safeParse` in the handler | `zValidator('json', schema, hook)` | `ValidationPipe` + class-validator DTO |
| Malformed JSON | `express.json()` error, `err.type === 'entity.parse.failed'` | `FST_ERR_CTP_INVALID_JSON_BODY`, `err.statusCode` 400 | `@koa/bodyparser` throws, `err.status` 400 | `HTTPException` 400 | `BadRequestException` (from the Express adapter) |
| 404 hook | last `app.use()` | `setNotFoundHandler` | no body set after `await next()` | `app.notFound` | `NotFoundException` in a filter |
| Error hook | `app.use((err, req, res, next) => …)` | `setErrorHandler` | outer `try { await next() } catch` | `app.onError` | `@Catch()` filter |
| Core includes router / body parser | yes / yes | yes / yes | no / no | yes / yes | yes / yes (from Express) |
| Language | JS | JS (types included) | JS | TS-first, runs as JS | TypeScript + decorators, compiled |

**Example 6 — the same curl script against all five servers.**

bash

```
#!/usr/bin/env bash
# test.sh BASE_URL — the same six requests against any of the five servers
B=$1
req() {
  local shown="curl -s"; for a in "$@"; do
    case $a in *[\ \"{}]*) shown+=" '$a'";; *) shown+=" $a";; esac; done
  echo "\$ $shown"; curl -s -w '  -> HTTP %{http_code}\n' "$@"
}
req "$B/health"
req -X POST "$B/items" -H 'content-type: application/json' -d '{"name":"pen","qty":2}'
req -X POST "$B/items" -H 'content-type: application/json' -d '{"name":"","qty":0}'
req -X POST "$B/items" -H 'content-type: application/json' -d '{"name":'
req "$B/nope"
req "$B/boom"
```

The four JS servers each start with `PORT=<port> node <file>`, and the Nest server with `PORT=6140 node dist/main.js`. Then the script runs against each one:

bash

```
$ bash test.sh http://127.0.0.1:6100      # Express 5.3.0
$ curl -s http://127.0.0.1:6100/health
{"status":"ok"}  -> HTTP 200
$ curl -s -X POST http://127.0.0.1:6100/items -H 'content-type: application/json' -d '{"name":"pen","qty":2}'
{"id":1,"name":"pen","qty":2}  -> HTTP 201
$ curl -s -X POST http://127.0.0.1:6100/items -H 'content-type: application/json' -d '{"name":"","qty":0}'
{"error":"Bad Request","issues":[{"path":"name","message":"Too small: expected string to have >=1 characters"},{"path":"qty","message":"Too small: expected number to be >0"}]}  -> HTTP 400
$ curl -s -X POST http://127.0.0.1:6100/items -H 'content-type: application/json' -d '{"name":'
{"error":"Bad Request","message":"Malformed JSON"}  -> HTTP 400
$ curl -s http://127.0.0.1:6100/nope
{"error":"Not Found","path":"/nope"}  -> HTTP 404
$ curl -s http://127.0.0.1:6100/boom
{"error":"Internal Server Error"}  -> HTTP 500

$ bash test.sh http://127.0.0.1:6110      # Fastify 5.12.5 (echoed "$ curl" lines trimmed from here on …)
{"status":"ok"}  -> HTTP 200
{"id":1,"name":"pen","qty":2}  -> HTTP 201
{"error":"Bad Request","message":"body/name must NOT have fewer than 1 characters"}  -> HTTP 400
{"error":"Bad Request","message":"Body is not valid JSON but content-type is set to 'application/json'"}  -> HTTP 400
{"error":"Not Found","path":"/nope"}  -> HTTP 404
{"error":"Internal Server Error"}  -> HTTP 500

$ bash test.sh http://127.0.0.1:6120      # Koa 3.2.1
{"status":"ok"}  -> HTTP 200
{"id":1,"name":"pen","qty":2}  -> HTTP 201
{"error":"Bad Request","issues":[{"path":"name","message":"Too small: expected string to have >=1 characters"},{"path":"qty","message":"Too small: expected number to be >0"}]}  -> HTTP 400
{"error":"Bad Request","message":"Unexpected end of JSON input"}  -> HTTP 400
{"error":"Not Found","path":"/nope"}  -> HTTP 404
{"error":"Internal Server Error"}  -> HTTP 500

$ bash test.sh http://127.0.0.1:6130      # Hono 4.13.13
{"status":"ok"}  -> HTTP 200
{"id":1,"name":"pen","qty":2}  -> HTTP 201
{"error":"Bad Request","issues":[{"path":"name","message":"Too small: expected string to have >=1 characters"},{"path":"qty","message":"Too small: expected number to be >0"}]}  -> HTTP 400
{"error":"Bad Request","message":"Malformed JSON in request body"}  -> HTTP 400
{"error":"Not Found","path":"/nope"}  -> HTTP 404
{"error":"Internal Server Error"}  -> HTTP 500

$ bash test.sh http://127.0.0.1:6140      # NestJS 12.1.2
{"status":"ok"}  -> HTTP 200
{"id":1,"name":"pen","qty":2}  -> HTTP 201
{"message":["name must be longer than or equal to 1 characters","qty must be a positive number"],"error":"Bad Request","statusCode":400}  -> HTTP 400
{"message":"Unexpected end of JSON input","error":"Bad Request","statusCode":400}  -> HTTP 400
{"error":"Not Found","path":"/nope"}  -> HTTP 404
{"error":"Internal Server Error"}  -> HTTP 500
```

Here is what the runs show:

- **Rows 1, 2, 5 and 6 match on all five servers.** Those rows are the routes and the custom 404 and error hooks.
- **Row 3 (the validation 400) has three shapes:**
  - zod gives a list of issues;
  - Fastify gives a single message (`allErrors: false`);
  - Nest gives `{"message":[…],"error":"Bad Request","statusCode":400}`.
- **Row 4 (malformed JSON) has a different message on every server.** The message comes from whichever parser rejected the body.

The thrown message `db password is hunter2` never reaches the client. It appears only in the server log, for example `Error: db password is hunter2` followed by the stack from `express-app.js:27:9`.

**Example 7 — the same routes with NO custom 404 or error handler: each framework's default shapes.**

javascript

```
// defaults.js — the same /items, /nope and /boom with NO custom 404 or error handler
import express from 'express';
import Fastify from 'fastify';
import Koa from 'koa';
import Router from '@koa/router';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const Item = z.object({ name: z.string().min(1), qty: z.number().int().positive() });
const boom = async () => { throw new Error('db password is hunter2'); };

const ex = express();                                     // Express 5
ex.use(express.json());
ex.get('/boom', boom);

const fy = Fastify();                                     // Fastify 5
fy.post('/items', { schema: { body: { type: 'object', required: ['name', 'qty'],
  properties: { name: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1 } } } } },
  async (req) => req.body);
fy.get('/boom', boom);

const koa = new Koa();                                    // Koa 3
koa.silent = true;                                        // skip Koa's default stderr dump
const kr = new Router();
kr.get('/boom', boom);
koa.use(kr.routes());

const hono = new Hono();                                  // Hono 4
hono.post('/items', zValidator('json', Item), (c) => c.json(c.req.valid('json')));
hono.get('/boom', boom);

const listen = (start) => new Promise((resolve) => { const s = start(() => resolve(s)); });
const servers = {
  express: await listen((cb) => ex.listen(0, cb)),
  koa: await listen((cb) => koa.listen(0, cb)),
  hono: await listen((cb) => serve({ fetch: hono.fetch, port: 0 }, cb)),
};
await fy.listen({ port: 0, host: '127.0.0.1' });
servers.fastify = fy.server;

const origError = console.error; console.error = () => {}; // hide Express/Hono default logging
for (const [name, s] of Object.entries(servers)) {
  const base = `http://127.0.0.1:${s.address().port}`;
  const show = async (label, path, init) => {
    const r = await fetch(base + path, init);
    let body = (await r.text()).replace(/\s*\n\s*/g, ' ');
    if (body.length > 160) body = body.slice(0, 160) + '…';
    console.log(`${name.padEnd(8)} ${label.padEnd(4)} ${r.status} ${r.headers.get('content-type')}\n         ${body}`);
  };
  if (name === 'fastify' || name === 'hono') {
    await show('400', '/items', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"name":"","qty":0}' });
  }
  await show('404', '/nope');
  await show('500', '/boom');
}
console.error = origError;
for (const s of Object.values(servers)) s.close();
await fy.close();

// Real output (Node v24.19.0, Express 5.3.0, Fastify 5.12.5, Koa 3.2.1, Hono 4.13.13):
//   express  404  404 text/html; charset=utf-8
//            <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Cannot GET /nope</pre> </body> </html> 
//   express  500  500 text/html; charset=utf-8
//            <!DOCTYPE html> <html lang="en"> <head> <meta charset="utf-8"> <title>Error</title> </head> <body> <pre>Error: db password is hunter2<br> &nbsp; &nbsp;at boom (…
//   koa      404  404 text/plain; charset=utf-8
//            Not Found
//   koa      500  500 text/plain; charset=utf-8
//            Internal Server Error
//   hono     400  400 application/json
//            {"success":false,"error":{"name":"ZodError","message":"[\n  {\n    \"origin\": \"string\",\n    \"code\": \"too_small\",\n    \"minimum\": 1,\n    \"inclusive\"…
//   hono     404  404 text/plain; charset=UTF-8
//            404 Not Found
//   hono     500  500 text/plain; charset=UTF-8
//            Internal Server Error
//   fastify  400  400 application/json; charset=utf-8
//            {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body/name must NOT have fewer than 1 characters"}
//   fastify  404  404 application/json; charset=utf-8
//            {"message":"Route GET:/nope not found","error":"Not Found","statusCode":404}
//   fastify  500  500 application/json; charset=utf-8
//            {"statusCode":500,"error":"Internal Server Error","message":"db password is hunter2"}
```

The Nest equivalent (`src/defaults.ts`, compiled with the same `tsc` command) keeps `ValidationPipe` but drops the filter:

typescript

```
// src/defaults.ts — Nest with ValidationPipe but NO custom exception filter
import 'reflect-metadata';
import { Module, Controller, Get, Post, Body, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IsString, MinLength, IsInt, IsPositive } from 'class-validator';

class CreateItemDto {
  @IsString() @MinLength(1) name: string;
  @IsInt() @IsPositive() qty: number;
}

@Controller()
class C {
  @Post('items') create(@Body() dto: CreateItemDto) { return dto; }
  @Get('boom') async boom() { throw new Error('db password is hunter2'); }
}

@Module({ controllers: [C] })
class M {}

const app = await NestFactory.create(M, { logger: false });
app.useGlobalPipes(new ValidationPipe());
await app.listen(0, '127.0.0.1');
const base = await app.getUrl();
for (const [label, path, init] of [
  ['400', '/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"","qty":0}' }],
  ['404', '/nope', undefined],
  ['500', '/boom', undefined],
] as const) {
  const r = await fetch(base + path, init);
  console.log(`nest     ${label.padEnd(4)} ${r.status} ${r.headers.get('content-type')}\n         ${await r.text()}`);
}
await app.close();

// Real output (Node v24.19.0, NestJS 12.1.2):
//   nest     400  400 application/json; charset=utf-8
//            {"message":["name must be longer than or equal to 1 characters","qty must be a positive number"],"error":"Bad Request","statusCode":400}
//   nest     404  404 application/json; charset=utf-8
//            {"message":"Cannot GET /nope","error":"Not Found","statusCode":404}
//   nest     500  500 application/json; charset=utf-8
//            {"statusCode":500,"message":"Internal server error"}
```

What the defaults show:

- **Express 5's default 500 includes the stack trace.** It is printed in an HTML page. Re-running Express's `/boom` with `NODE_ENV=production` gave `500 <!DOCTYPE html> … <pre>Internal Server Error</pre> …`.
- **Fastify's default 500 includes `err.message`.** Here that is `"db password is hunter2"`.
- **Koa, Hono and Nest send a generic 500.** Koa and Hono send plain text; Nest sends JSON.

**Example 8 — a Hono app is a function from `Request` to `Response`; no server needed.**

javascript

```
// fetch-direct.js — a Hono app is a function from Request to Response; no server needed
import { Hono } from 'hono';

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));

const res = await app.fetch(new Request('http://localhost/health'));
console.log(res instanceof Response, res.status, res.headers.get('content-type'), await res.text());

// Real output (Node v24.19.0, Hono 4.13.13):
//   true 200 application/json {"status":"ok"}
```

**Example 9 — the onion: `await next()` waits in Koa, not in Express.**

javascript

```
// onion.js — "await next()" in Koa waits for the handler; in Express it does not
import express from 'express';
import Koa from 'koa';
import { setTimeout as sleep } from 'node:timers/promises';

const log = [];
const ex = express();
ex.use(async (req, res, next) => {
  log.push('express: before next');
  const r = next();                       // Express 5: what does next() return?
  log.push(`express: next() returned ${r}`);
  await r;
  log.push('express: after next');        // runs before the handler finished
});
ex.get('/', async (req, res) => { await sleep(20); log.push('express: handler sends'); res.send('ok'); });

const koa = new Koa();
koa.use(async (ctx, next) => {
  log.push('koa: before next');
  const r = next();
  log.push(`koa: next() returned ${Object.prototype.toString.call(r)}`);
  await r;
  log.push('koa: after next');            // runs after the handler finished
});
koa.use(async (ctx) => { await sleep(20); log.push('koa: handler sets body'); ctx.body = 'ok'; });

for (const app of [ex, koa]) {
  const s = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  await fetch(`http://127.0.0.1:${s.address().port}/`).then((r) => r.text());
  await sleep(30);
  s.close();
}
console.log(log.join('\n'));

// Real output (Node v24.19.0, Express 5.3.0, Koa 3.2.1):
//   express: before next
//   express: next() returned undefined
//   express: after next
//   express: handler sends
//   koa: before next
//   koa: next() returned [object Promise]
//   koa: handler sets body
//   koa: after next
```

**Example 10 — edge case: Koa returns 404 when nothing has set `ctx.body` by the time the chain ends.**

Koa starts every response as `ctx.status = 404`. Assigning `ctx.body` changes the status to 200, unless you already set a status yourself. When the composed middleware promise settles, Koa writes whatever `ctx` holds at that moment. If a handler starts async work but does not `await` it, the promise settles first. Koa then sends `404 Not Found`, and the later `ctx.body = item` assignment has no effect on the response. Setting only a status, such as 204, is fine: Koa sends that status with no body.

javascript

```
// edge-koa.js — Koa answers 404 when nothing sets ctx.body before the chain finishes
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();
const lookup = (id) => new Promise((r) => setTimeout(() => r({ id }), 20));

router.get('/broken/:id', (ctx) => {             // not awaited: the chain ends first
  lookup(ctx.params.id).then((item) => { ctx.body = item; });
});
router.get('/fixed/:id', async (ctx) => {
  ctx.body = await lookup(ctx.params.id);         // awaited: body set before the chain ends
});
router.get('/status-only', (ctx) => { ctx.status = 204; }); // a status with no body is fine

app.use(router.routes());
const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const p of ['/broken/7', '/fixed/7', '/status-only']) {
    const r = await fetch(base + p);
    console.log(p.padEnd(12), r.status, JSON.stringify(await r.text()));
  }
  server.close();
});

// Real output (Node v24.19.0, Koa 3.2.1, @koa/router 15.7.0):
//   /broken/7    404 "Not Found"
//   /fixed/7     200 "{\"id\":\"7\"}"
//   /status-only 204 ""
```

Look at the first line: the route matched and ran, but the client got a 404. In Express the same mistake gives a different symptom. `res.json()` is called later and still works, because the Express response stays open until you end it. If you never call it, the request just hangs. So code ported from Express to Koa must `await` every async step before the handler returns.

**Example 11 — edge case: Hono's `c.req.json()` throws on malformed JSON, so an unguarded handler turns a client error into a 500.**

`zValidator('json', …)` catches this for you (Example 6, request 4 gives a 400). A handler that reads the body itself gets a `SyntaxError` thrown into `app.onError`.

javascript

```
// edge-hono.js — c.req.json() throws on bad JSON; without a guard it becomes a 500
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();
app.post('/raw', async (c) => c.json({ got: await c.req.json() }));   // throws SyntaxError
app.post('/guarded', async (c) => {
  let body;
  try { body = await c.req.json(); }
  catch (err) { return c.json({ error: 'Bad Request', message: `Malformed JSON (${err.name})` }, 400); }
  return c.json({ got: body });
});
app.onError((err, c) => {
  console.log('onError saw:', err.name, '-', err.message);
  return c.json({ error: 'Internal Server Error' }, 500);
});

const server = serve({ fetch: app.fetch, port: 0 }, async ({ port }) => {
  for (const p of ['/raw', '/guarded']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":',
    });
    console.log(p.padEnd(9), r.status, await r.text());
  }
  server.close();
});

// Real output (Node v24.19.0, Hono 4.13.13, @hono/node-server 2.1.4):
//   onError saw: SyntaxError - Unexpected end of JSON input
//   /raw      500 {"error":"Internal Server Error"}
//   /guarded  400 {"error":"Bad Request","message":"Malformed JSON (SyntaxError)"}
```

**Example 12 — edge case: one payload, five verdicts (type coercion and unknown fields).**

bash

```
# extra.sh BASE_URL — qty sent as a string, plus a field the schema does not know
curl -s -w '  -> HTTP %{http_code}\n' -X POST "$1/items" -H 'content-type: application/json' -d '{"name":"pen","qty":"2","admin":true}'
```

text

```
$ bash extra.sh http://127.0.0.1:<port>     # run against each server from Examples 1–5
express  {"error":"Bad Request","issues":[{"path":"qty","message":"Invalid input: expected number, received string"}]}  -> HTTP 400
fastify  {"id":1,"name":"pen","qty":2}  -> HTTP 201
koa      {"error":"Bad Request","issues":[{"path":"qty","message":"Invalid input: expected number, received string"}]}  -> HTTP 400
hono     {"error":"Bad Request","issues":[{"path":"qty","message":"Invalid input: expected number, received string"}]}  -> HTTP 400
nest     {"message":["property admin should not exist","qty must be a positive number","qty must be an integer number"],"error":"Bad Request","statusCode":400}  -> HTTP 400
```

Each server reached its verdict differently:

- **Fastify accepted the string `"2"`.** Its default Ajv options coerce types, so `"2"` became the number `2`.
- **Fastify silently removed `admin`.** It did not reject the request, even though the schema says `additionalProperties: false`, because `removeAdditional: true` strips extra properties instead.
- **zod rejected the string.** It does not coerce unless you use `z.coerce.number()`. It would also have stripped `admin`: `z.object` drops unknown keys unless you use `z.strictObject`.
- **Nest rejected both problems.** `forbidNonWhitelisted: true` made it reject `admin` too.

None of these is wrong, but a client that works against one server can fail against another. Write the rule into your schema rather than relying on defaults.

**Example 13 — edge case: Fastify's response schema drops fields, and its failures still reach `setErrorHandler`.**

You may read that Fastify's error handler does not see serialization errors. On Fastify 5.12.5 it does, both for a response-schema failure and for a `BigInt` that `JSON.stringify` cannot handle:

javascript

```
// edge-fastify.js — a response schema filters output, and its failures reach setErrorHandler
import Fastify from 'fastify';

const app = Fastify();
const userOut = {
  response: {
    200: {
      type: 'object',
      required: ['id', 'name'],
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    },
  },
};

app.get('/user', { schema: userOut }, async () => ({ id: 1, name: 'Ada', passwordHash: 'x' }));
app.get('/missing', { schema: userOut }, async () => ({ id: 1 }));   // no "name"
app.get('/bigint', async () => ({ n: 10n }));                        // no schema; JSON.stringify fails

app.setErrorHandler((err, request, reply) => {
  console.log('  setErrorHandler saw:', err.message);
  reply.code(500).send({ error: 'Internal Server Error' });
});

await app.listen({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.server.address().port}`;
for (const p of ['/user', '/missing', '/bigint']) {
  const r = await fetch(base + p);
  console.log(p.padEnd(9), r.status, await r.text());
}
await app.close();

// Real output (Node v24.19.0, Fastify 5.12.5):
//   /user     200 {"id":1,"name":"Ada"}
//     setErrorHandler saw: "name" is required!
//   /missing  500 {"error":"Internal Server Error"}
//     setErrorHandler saw: Do not know how to serialize a BigInt
//   /bigint   500 {"error":"Internal Server Error"}
```

The first line is the practical point. The handler returned `passwordHash`, but the 200 schema does not list it, so it was not sent. Fastify's response schema acts as an allow-list for output fields.

**Example 14 — a benchmark on this machine, with the method.**

These numbers apply only to these toy servers on this machine. Here is how they were measured:

- **Tool:** autocannon 8.0.0, programmatic API, 10 connections, over loopback.
- **Routes:** `GET /health`, and `POST /items` with the valid body `{"name":"pen","qty":2}`, on the exact servers from Examples 1–5.
- **Runs:** for each server and route, one 3-second warm-up run (discarded), then three 5-second runs. The table reports the median of the three.
- **Server:** each server ran as its own Node v24.19.0 process with no logger.
- **Machine:** Intel Core i5-1135G7 laptop (4 cores / 8 threads, up to 4.2 GHz), 14 GiB RAM, Linux. The load generator ran on the same machine. Other work was running at the same time: load average 2.94 before and 5.33 after. Expect run-to-run spread of 10–20 %; the raw runs are listed below.

javascript

```
// bench.js — autocannon against each server: warm-up, then 3 measured runs per route
import { spawn } from 'node:child_process';
import autocannon from 'autocannon';
import { setTimeout as sleep } from 'node:timers/promises';
import os from 'node:os';

const NEST = `${os.homedir()}/.cache/nodekit-repair-tools/pass4/V/nest/dist/main.js`;
const apps = [
  ['express', 'express-app.js', 6100], ['fastify', 'fastify-app.js', 6110],
  ['koa', 'koa-app.js', 6120], ['hono', 'hono-app.js', 6130], ['nest', NEST, 6140],
];
const routes = {
  'GET /health': { path: '/health' },
  'POST /items': { path: '/items', method: 'POST', body: '{"name":"pen","qty":2}',
    headers: { 'content-type': 'application/json' } },
};
const run = (url, r, duration) => new Promise((res, rej) =>
  autocannon({ url: url + r.path, method: r.method ?? 'GET', body: r.body, headers: r.headers,
    connections: 10, duration }, (e, out) => (e ? rej(e) : res(out))));
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

for (const [name, file, port] of apps) {
  const child = spawn(process.execPath, [file], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await sleep(2000);
  const url = `http://127.0.0.1:${port}`;
  for (const [label, r] of Object.entries(routes)) {
    await run(url, r, 3);                                   // warm-up, discarded
    const rps = [], p99 = [], bad = [];
    for (let i = 0; i < 3; i++) {
      const out = await run(url, r, 5);
      rps.push(Math.round(out.requests.average)); p99.push(out.latency.p99);
      bad.push(out.non2xx + out.errors);
    }
    console.log(`${name.padEnd(8)} ${label}  req/s runs=${rps.join(',')} median=${median(rps)}  p99 ms median=${median(p99)}  non-2xx+errors=${bad.join(',')}`);
  }
  child.kill();
  await sleep(500);
}

// Real output (Node v24.19.0, autocannon 8.0.0):
//   express  GET /health  req/s runs=15252,12547,15988 median=15252  p99 ms median=1  non-2xx+errors=0,0,0
//   express  POST /items  req/s runs=10914,11446,11532 median=11446  p99 ms median=2  non-2xx+errors=0,0,0
//   fastify  GET /health  req/s runs=22165,21906,22174 median=22165  p99 ms median=1  non-2xx+errors=0,0,0
//   fastify  POST /items  req/s runs=16956,16724,15632 median=16724  p99 ms median=1  non-2xx+errors=0,0,0
//   koa      GET /health  req/s runs=18853,16800,19746 median=18853  p99 ms median=1  non-2xx+errors=0,0,0
//   koa      POST /items  req/s runs=11750,12122,12770 median=12122  p99 ms median=2  non-2xx+errors=0,0,0
//   hono     GET /health  req/s runs=26379,29499,28107 median=28107  p99 ms median=0  non-2xx+errors=0,0,0
//   hono     POST /items  req/s runs=16840,17934,17772 median=17772  p99 ms median=1  non-2xx+errors=0,0,0
//   nest     GET /health  req/s runs=13228,13910,11898 median=13228  p99 ms median=1  non-2xx+errors=0,0,0
//   nest     POST /items  req/s runs=8151,6875,8229 median=8151  p99 ms median=2  non-2xx+errors=0,0,0
```

The medians from this run, and from the second run, are listed under Good to know. A handler that waits on a database usually spends far longer there than in the framework, so measure your own workload before choosing on speed.

## Common mistakes & gotchas

- **Koa: not awaiting async work.** The route runs, nothing has set `ctx.body` when the chain settles, and the client gets `404 Not Found` (Example 10). `await` the async steps, or return their promise.
- **Koa: error middleware registered too late.** `try { await next() } catch` only catches errors from middleware registered after it, so register it first. Koa's core does not parse bodies or route. Without `@koa/bodyparser`, `ctx.request.body` is `undefined`.
- **Hono: calling `c.req.json()` without a guard.** Malformed JSON throws `SyntaxError`, and `onError` turns it into a 500 (Example 11). Use `zValidator('json', …)`, or catch it and return 400.
- **Fastify: trusting the default error handler.** Its 500 body includes `err.message` (Example 7: `"message":"db password is hunter2"`). Set `setErrorHandler` and send a generic body for 5xx.
- **Fastify: expecting strict types.** The default Ajv options coerce `"2"` to `2` and silently remove properties that `additionalProperties: false` forbids (Example 12). Validation messages stop at the first error.
- **Express: default error page in development.** Without your own error handler, a 500 renders the stack trace as HTML unless `NODE_ENV=production` (Example 7).
- **Nest: `emitDecoratorMetadata` turned off.** The build succeeds and the server starts. The container injects `undefined`, and `ValidationPipe` no longer knows the DTO type, so it validates nothing. A run compiled with `--emitDecoratorMetadata false` gave `500 {"error":"Internal Server Error"}` for both the valid and the invalid body, and logged `TypeError: Cannot read properties of undefined (reading 'create')`.
- **Nest: running `.ts` files with plain `node`.** Type stripping cannot handle decorators or parameter properties. `node src/main.ts` failed with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Compile with `tsc` or the Nest CLI and run `dist/`.
- **Nest: `@Catch()` with no argument catches everything.** That includes `NotFoundException` and the `BadRequestException` from `ValidationPipe`. If the filter turns every error into a 500, your 400s and 404s disappear. Check `instanceof HttpException` first, as Example 5 does.
- **Comparing 400 bodies across services.** zod returns an issue list, Ajv a single `message`, class-validator a `message` array. If several services share one client, map them to one error shape (lesson 66).

## Best practices

| If you need… | Pick | Why |
|---|---|---|
| The largest middleware ecosystem and the least surprise for new hires | **Express 5** | `(req, res, next)` is what most Node packages target. Lessons 47 to 61 and 63 to 66. |
| Request validation and response filtering from one JSON Schema per route | **Fastify** | Ajv compiles `schema.body`. fast-json-stringify compiles `schema.response`, which also allow-lists output fields (Example 13). |
| Modules, dependency injection, and testable providers for a large team | **NestJS** | The container builds providers from constructor types recorded by `emitDecoratorMetadata`. It runs on Express or Fastify. |
| A small core where one outer middleware can wrap the whole request | **Koa** | `await next()` waits for downstream (Example 9). |
| The same handler shape on Node and on a runtime that calls `fetch(request)` | **Hono** | The app is `app.fetch` (Example 8). `@hono/node-server` adapts it to Node. |
| Plain Node | none | Lessons 40 and 42: `http.createServer` and your own routing. |

- Pin versions. Nest 12, Fastify 5, Koa 3, Hono 4, and Express 5 all changed behaviour across majors (lesson 61 for Express).
- Install your own 404 and error hooks. The five defaults differ, and two can leak details (Example 7). Log the original error on the server.
- State coercion, unknown-field handling, and whether you report every error or only the first.
- Keep business logic in plain functions. Switching frameworks then rewrites only the route layer.
- Benchmark your own workload before choosing on speed. Example 14 shows the method: same route, same payload, a warm-up, several runs, and the machine noted.
- When migrating, run the same black-box script (Example 6).

## ⭐ Interview lens

> **Q: “What concretely is the difference between Koa's middleware and Express's?”**  
> Koa middleware is an async function of `(ctx, next)`. `ctx` is the one object for the request and the response. `next()` returns a promise, built by `koa-compose`, that settles when the rest of the chain has finished. Code after `await next()` therefore runs after the handler, so one outer middleware can time the request and wrap it in try/catch. Express 5 middleware is `(req, res, next)`, and `next()` returns `undefined`. Code after `next()` runs before an async handler finishes, and errors go to a separate function with four arguments. For example, an outer Koa middleware can set a default body if the handler set none. The limit shows up when you forget `await`: the chain ends with no `ctx.body`, and Koa answers 404 even though the route ran (Example 10).

> **Q: “How does Fastify validate a request body, and what defaults should you know?”**  
> You put a JSON Schema on the route as `schema.body`. When the route is registered, Fastify compiles that schema with Ajv into a function, so the check is not rebuilt on every request. A failure becomes an error with `err.validation` and status 400. The defaults in Fastify's Ajv options are `coerceTypes: 'array'`, `removeAdditional: true`, `useDefaults: true`, and `allErrors: false`. So the string `"2"` passes an integer field, extra properties are removed rather than rejected, and the 400 lists only the first problem. Example 12 shows `{"qty":"2"}` accepted by Fastify and rejected by zod. The limit is the response schema: fields you return that the schema does not list are dropped, which is useful as an allow-list and surprising if you expected them in the JSON (Example 13).

> **Q: “What makes Hono portable across runtimes?”**  
> A Hono app is a function from a Web `Request` to a Web `Response`, exposed as `app.fetch`. Anything that can hand you a `Request` and take a `Response` can call that function. On Node, `@hono/node-server` converts Node's request and response objects to and from that pair, with `serve({ fetch: app.fetch })`. Example 8 calls `app.fetch(new Request(url))` in a test with no server listening. The limit is any Node-only API inside a handler, such as `fs`. That call works on Node and breaks on a runtime that does not have it. So the portable part is the handler that only sees `c` and returns a `Response`. The moment the handler opens a file or reads `process`, that file is a Node program again.

> **Q: “Which of these frameworks leak error details by default?”**  
> A default error response is what you get when you have not installed your own error hook. In these runs, Fastify's default 500 body includes `err.message`, and Example 7 shows that message containing `db password is hunter2`. Express's default final handler renders the stack trace as HTML unless `NODE_ENV=production`. Koa, Hono, and Nest return a generic body. The fix is the same everywhere: log the real error on the server and send a fixed body for 5xx. The limit of that fix is 4xx. You still want the validation message in a 400, so the hook has to tell a client error from a server error before it hides the text.

## Cheat-card

- Express answers with `res.json`. Fastify returns the value. Koa sets `ctx.body`. Hono returns `c.json`. Nest returns from the controller method.
- Validation: zod `safeParse` in Express and Koa, Ajv from the route schema in Fastify, `zValidator` in Hono, `ValidationPipe` plus a class-validator DTO in Nest.
- 404: last Express `app.use`, Fastify `setNotFoundHandler`, Koa when no body was set, Hono `app.notFound`, Nest `NotFoundException` in a filter.
- Errors: Express four-argument middleware, Fastify `setErrorHandler`, Koa `try { await next() } catch`, Hono `app.onError`, Nest `@Catch()` filter.
- Koa: `await next()` waits. No body means 404. The core has no router or body parser.
- Fastify defaults: coerce types, strip extra properties, report the first error, and include `err.message` in the default 500.
- Hono: `app.fetch(Request)` returns a `Response`. `c.req.json()` throws on bad JSON.
- Nest: needs `experimentalDecorators` and `emitDecoratorMetadata`, and a real `tsc` compile. Without the metadata, injection and validation silently do nothing.

## Good to know

- Benchmark method: autocannon 8.0.0, 10 connections, over loopback, one 3-second warm-up discarded, then three 5-second runs, median of the three. Each server was its own Node v24.19.0 process with no logger, on an Intel Core i5-1135G7 (4 cores / 8 threads, up to 4.2 GHz) with 14 GiB RAM. Load average 2.94 before and 5.33 after. Expect 10 to 20 percent spread.
- `GET /health` median requests per second: Hono 4.13.13 = 28,107; Fastify 5.12.5 = 22,165; Koa 3.2.1 = 18,853; Express 5.3.0 = 15,252; NestJS 12.1.2 on Express = 13,228.
- `POST /items` median requests per second: Hono 17,772; Fastify 16,724; Koa 12,122; Express 11,446; NestJS 8,151.
- Second full run, load average 4.36 before and 6.03 after, GET medians 24,466 / 22,456 / 18,889 / 12,806 / 12,522 and POST medians 16,268 / 17,349 / 12,375 / 11,394 / 8,601, in that column order. Fastify edged Hono on POST, so treat those two as tied.
- Adding JSON parsing and validation cut each server's median throughput by 25 to 38 percent in the table's run. p99 latency was 0 to 2 ms everywhere.
- Q: Why can't you run a NestJS app with Node's type stripping? Type stripping only removes type annotations. Nest needs decorators, parameter properties, and `emitDecoratorMetadata`, which writes `design:paramtypes` for the container and `ValidationPipe`. Only a compiler such as `tsc` emits that. Node v24 fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
> ⚠️ Unverified: running the Hono app on Cloudflare Workers, Deno or Bun. Only Node is installed on this machine; the list of supported runtimes comes from hono.dev.

---

## Learn More

- [Error handling expressjs.com](https://expressjs.com/en/guide/error-handling.html)
- [Validation and Serialization fastify.dev](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
- [Errors fastify.dev](https://fastify.dev/docs/latest/Reference/Errors/)
- [Koa koajs.com](https://koajs.com/)
- [@koa/router github.com](https://github.com/koajs/router)
- [Node.js getting started hono.dev](https://hono.dev/docs/getting-started/nodejs)
- [Validation hono.dev](https://hono.dev/docs/guides/validation)
- [@hono/zod-validator github.com](https://github.com/honojs/middleware/tree/main/packages/zod-validator)
- [Validation docs.nestjs.com](https://docs.nestjs.com/techniques/validation)
- [Exception filters docs.nestjs.com](https://docs.nestjs.com/exception-filters)
- [autocannon github.com](https://github.com/mcollina/autocannon)
