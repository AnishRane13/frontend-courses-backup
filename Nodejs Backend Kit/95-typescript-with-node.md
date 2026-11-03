---
title: "TypeScript with Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# TypeScript with Node

*16 min read · Updated 7 Oct 2026 · Topic 71 of 74 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

TypeScript on Node is two jobs: a compiler named tsc checks your type annotations, and something else has to turn the file into JavaScript because Node only runs JavaScript. You can let Node strip the types and run the file directly, or compile first with tsc. The trade-off is that stripping is instant and checks nothing, so a project that never runs tsc ships type errors and meets them later as a TypeError in the logs.

## Why it matters

TypeScript adds a static type layer on top of JavaScript. The compiler, `tsc`, reads your annotations, checks every call, property access, and return value, and reports mismatches before the code runs. Node only executes JavaScript, so a `.ts` file is turned into JavaScript by Node itself, by a loader package, or by a build step. That choice decides how the app starts, which syntax you may write, how imports look, and whether anything type-checks the code at all.

Getting it wrong looks unrelated to types: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on an `enum`, `ERR_MODULE_NOT_FOUND` for an import the editor accepted, `does not provide an export named 'User'` for an interface, and `__filename is not defined in ES module scope` in a file that compiled cleanly. The expensive mistake is silent. Every runtime option below removes types without checking them.

## The concept, simply

Two jobs stay separate.

1. **Type checking.** Only `tsc` does this, and `ts-node` does it unless you set `transpileOnly`. `tsc` reads `tsconfig.json`, loads type definitions such as `@types/node`, and exits non-zero on a type error. It can write `.js` files, or you can pass `--noEmit` and only check.
2. **Running.** Something must hand Node plain JavaScript. The choices differ in syntax and in whether a build step exists.

`node file.ts` replaces type annotations with spaces and runs the file. It does not type-check, it does not read `tsconfig.json`, and it throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on syntax that has to generate JavaScript, such as `enum`, unless you add `--experimental-transform-types`.

`tsx` registers module hooks and compiles each file with esbuild as it loads. It does not type-check. It accepts `enum`, namespaces, and parameter properties. It reads some `tsconfig` options, such as `paths`. It writes no build output.

`ts-node` compiles each file with the TypeScript compiler API as it loads. It type-checks unless `transpileOnly` is set, it accepts that same syntax, and it reads `tsconfig.json`. It writes no build output. It calls the classic compiler API, so it crashes against TypeScript 7, which is a native compiler without that API.

`tsc` writing `dist/` type-checks, accepts that syntax, reads `tsconfig.json`, and you run the `.js` files with plain `node`.

A bundler such as esbuild strips types and joins files into one output. It does not type-check. It accepts `enum`. It reads some `tsconfig` options.

Only `tsc` and `ts-node` check types. Run `tsc --noEmit` in continuous integration no matter how you run the code.

## How it works

**What `node file.ts` does.** On Node v24.19.0 this needs no flag.

1. Node sees `.ts`, `.mts`, or `.cts`. It picks ESM or CommonJS the same way as `.js`. `.mts` is always ESM. `.cts` is always CommonJS. `.ts` follows the nearest `package.json` `"type"` field.
2. A bundled parser, Amaro, which wraps SWC, replaces type-only syntax with whitespace of the same length: annotations, `interface`, `type`, `import type`, `satisfies`, `as`, and generics.
3. Line and column numbers do not move, so Node generates no source map.
4. The JavaScript runs. Nothing checks the types, and `tsconfig.json` is never read.
5. Syntax that generates JavaScript cannot be expressed as whitespace: `enum`, a `namespace` with values, constructor parameter properties, and `import x = require()`. Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

Node will not strip `.ts` files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so packages must publish JavaScript. `tsconfig` `paths` aliases are not applied. Subpath imports that start with `#` are the closest Node feature. `.tsx` is unsupported, and so is TypeScript in the REPL and in `node --check`.

**The `tsconfig.json` that matches stripping** exists for `tsc --noEmit` and for the editor, so `tsc` rejects what Node would reject.

`"module": "nodenext"` and `"moduleResolution": "nodenext"` make `tsc` use Node's rules. It reads `"type"` to decide ESM or CommonJS, honours package `"exports"`, and requires file extensions on relative ESM imports. The error for a missing extension is TS2835.

`"target"` sets which JavaScript syntax `tsc` emits and which built-in library types it assumes. Node 24 implements the ES2025 built-ins that this lesson checked, so `"es2025"` emits your code unchanged. Type stripping ignores `target`.

`"strict": true` turns on the strict family, including `strictNullChecks` and `noImplicitAny`.

`"verbatimModuleSyntax": true` makes `tsc` keep every import as written, except imports marked `type`. Node does the same. An interface imported without `type` becomes TS1484 at check time instead of a runtime crash.

`"erasableSyntaxOnly": true` makes `tsc` reject syntax stripping cannot handle, reported as TS1294.

`"rewriteRelativeImportExtensions": true` lets you write `import './env.ts'` and makes `tsc` emit `import './env.js'` in `dist/`. It only rewrites relative specifiers, `./` and `../`. A subpath import such as `#lib/v.ts` is emitted unchanged, and `tsc` reports TS2877. `allowImportingTsExtensions` alone is not enough: it must sit with `noEmit`, `emitDeclarationOnly`, or `rewriteRelativeImportExtensions`, or `tsc` reports TS5096, because emitted `.js` would otherwise import `.ts` files.

`"types": ["node"]` loads `@types/node`. Pin that package's major to your Node major. A bare install can pull types for a newer Node than you run, and the compiler will accept APIs your runtime lacks.

**Import extensions.** Node's ESM loader never guesses extensions, and stripping does not rewrite specifiers. Under stripping you write `./env.ts`. `./env.js` looks for a file that is not there. When `tsc` builds `dist/`, `rewriteRelativeImportExtensions` turns the relative `.ts` specifier into `.js`, so the same source works both ways. `require('./file.ts')` also needs the extension.

**Source maps.** Stripping keeps positions, so stack traces point at the `.ts` line with no map. A `tsc` build moves code, so line numbers in `dist/*.js` no longer match. `"sourceMap": true` writes a `.js.map`, and `node --enable-source-maps` makes stack traces use it. `node --inspect src/price.ts` starts the inspector with positions that match the `.ts` file.

## Code examples

**Example 1 — running a `.ts` file directly.** `hello.ts`, in a folder whose `package.json` is `{"type":"module"}`:

typescript

```
interface User { id: number; name: string }
type Role = 'admin' | 'user';

function greet(user: User, role: Role = 'user'): string {
  return `${user.name} (#${user.id}) is ${role}`;
}

const u = { id: 1, name: 'Ada' } satisfies User;
console.log(greet(u, 'admin'));
console.log(greet(u as User));
```

bash

```
$ node hello.ts
Ada (#1) is admin
Ada (#1) is user
```

No flag, no warning, no build step. The `interface`, the annotations, `satisfies` and `as` became whitespace.

**Example 2 — what stripping rejects, and the transform flag.** Three small files: `enum.ts` (`enum Status { Active, Banned }` then `console.log(Status.Active);`), `ns.ts` (`namespace Config { export const port = 3000; }`) and `param.ts` (a class with `constructor(public x: number, public y: number) {}`).

bash

```
$ node enum.ts
…
file:///…/enum.ts:1
enum Status { Active, Banned }
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
console.log(Status.Active);

SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
…
$ node ns.ts
…
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript namespace declaration is not supported in strip-only mode
…
$ node param.ts
…
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
…
$ node --experimental-transform-types enum.ts
(node:107603) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
0
```

A namespace that only contains types (`namespace Types { export type Id = string; }`) is erasable and runs fine. The usual replacements are a `const` object with `as const` for an `enum`, and a module for a `namespace`. For a parameter property, declare the field and assign it in the constructor yourself.

**Example 3 — the project files.** `package.json`:

json

```
{
  "name": "users-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.ts",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "start": "node --enable-source-maps dist/server.js"
  },
  "dependencies": {
    "express": "^5.2.1"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^24.19.1",
    "typescript": "^7.0.2"
  }
}
```

`tsconfig.json`:

json

```
{
  "compilerOptions": {
    "target": "es2025",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "rewriteRelativeImportExtensions": true,
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true
  },
  "include": ["src"]
}
```

Add a file that breaks all three stripping rules, `src/legacy.ts`, and see `tsc` catch them before Node does:

typescript

```
import { Env } from './env.ts';            // Env is an interface (a type)

enum Level { Debug, Info }                // enum: generates runtime code

class Repo {
  constructor(private readonly table: string) {}   // parameter property
}

export const env: Env | undefined = undefined;
export const level = Level.Info;
export const repo = new Repo('users');
```

bash

```
$ npx tsc --noEmit
src/legacy.ts(1,10): error TS1484: 'Env' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.
src/legacy.ts(3,6): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
src/legacy.ts(6,15): error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.
$ node src/legacy.ts
…
file:///…/src/legacy.ts:3
…
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
…
```

Node stops at the first problem it meets. `tsc` lists all of them, with file and position.

**Example 4 — typing `process.env` safely.** `process.env` is typed `NodeJS.ProcessEnv`, a dictionary of `string | undefined`. Read it once at startup, validate it, and export a typed object. `src/env.ts`:

typescript

```
// src/env.ts — read process.env once, validate, export a typed object.
export interface Env {
  port: number;
  nodeEnv: 'development' | 'production' | 'test';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source.PORT ?? '4300');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer 0-65535, got ${JSON.stringify(source.PORT)}`);
  }
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'production' && nodeEnv !== 'test') {
    throw new Error(`NODE_ENV must be development|production|test, got ${nodeEnv}`);
  }
  return { port, nodeEnv };
}
```

Taking `source` as a parameter lets tests pass a plain object instead of mutating the real environment. If you skip the validation, `tsc` flags the raw value (this line was in a scratch `src/index.ts`):

typescript

```
const port: number = process.env.PORT;
```

bash

```
$ npm run typecheck

> typecheck
> tsc --noEmit

src/index.ts(1,7): error TS2322: Type 'string | undefined' is not assignable to type 'number'.
  Type 'undefined' is not assignable to type 'number'.
$ echo $?
1
```

That non-zero exit code is what fails a CI job.

**Example 5 — a typed Express 5 handler, type-checked and run.** `src/server.ts` (Express 5.2.1, `@types/express` 5.0.6):

typescript

```
// src/server.ts — Express 5 with typed handlers.
import express, { type Request, type Response, type NextFunction } from 'express';
import { loadEnv } from './env.ts';

interface User { id: number; name: string }
interface CreateUserBody { name?: unknown }
interface ErrorBody { error: string }

const users = new Map<number, User>([[1, { id: 1, name: 'Ada' }]]);
const app = express();
app.use(express.json());

// Request<Params, ResBody, ReqBody, Query>
app.get('/users/:id', (req: Request<{ id: string }>, res: Response<User | ErrorBody>) => {
  const user = users.get(Number(req.params.id));
  if (!user) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(user);
});

app.post('/users', async (req: Request<{}, User | ErrorBody, CreateUserBody | undefined>, res: Response<User | ErrorBody>) => {
  const name = req.body?.name;            // Express 5: req.body is undefined without a JSON body
  if (typeof name !== 'string' || name === '') {
    res.status(400).json({ error: 'name (string) is required' });
    return;
  }
  const user: User = { id: users.size + 1, name };
  users.set(user.id, user);
  res.status(201).json(user);
});

app.get('/boom', async () => {
  throw new Error('db down');             // Express 5 forwards the rejection to the error handler
});

app.use((err: unknown, _req: Request, res: Response<ErrorBody>, _next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

const { port } = loadEnv();
const server = app.listen(port, () => {
  const addr = server.address();
  console.log('listening on', typeof addr === 'object' && addr ? addr.port : addr);
});
```

bash

```
$ npx tsc --noEmit
$ echo $?
0
$ PORT=4301 node src/server.ts
listening on 4301
$ curl -s -w ' %{http_code}\n' localhost:4301/users/1
{"id":1,"name":"Ada"} 200
$ curl -s -w ' %{http_code}\n' localhost:4301/users/9
{"error":"not found"} 404
$ curl -s -w ' %{http_code}\n' -X POST -H content-type:application/json -d '{"name":"Lin"}' localhost:4301/users
{"id":2,"name":"Lin"} 201
$ curl -s -w ' %{http_code}\n' -X POST localhost:4301/users
{"error":"name (string) is required"} 400
$ curl -s -w ' %{http_code}\n' localhost:4301/boom
{"error":"db down"} 500
$ PORT=abc node src/server.ts
file:///…/src/env.ts:10
    throw new Error(`PORT must be an integer 0-65535, got ${JSON.stringify(source.PORT)}`);
          ^

Error: PORT must be an integer 0-65535, got "abc"
…

Node.js v24.19.0
```

The generic parameters are what make it typed. `Request<{ id: string }>` types `req.params`. `Response<User | ErrorBody>` restricts what `res.json()` accepts. The third `Request` parameter types `req.body`, and it includes `undefined` because Express 5 leaves `req.body` `undefined` when no body was parsed. `import express, { type Request, … }` mixes a value import (the default export) with type-only names, which `verbatimModuleSyntax` requires. Now break it, in a scratch `src/bad.ts`:

typescript

```
import express, { type Request, type Response } from 'express';

interface User { id: number; name: string }
const app = express();

app.get('/users/:id', (req: Request<{ id: string }>, res: Response<User>) => {
  const id = Number(req.params.userId);         // typo in the param name
  res.json({ id, nmae: 'Ada' });                // typo in the response shape
});

const port: number = process.env.PORT;          // string | undefined is not number
app.listen(port);
```

bash

```
$ npx tsc --noEmit
src/bad.ts(7,32): error TS2339: Property 'userId' does not exist on type '{ id: string; }'.
src/bad.ts(8,18): error TS2353: Object literal may only specify known properties, and 'nmae' does not exist in type 'User'.
src/bad.ts(11,7): error TS2322: Type 'string | undefined' is not assignable to type 'number'.
  Type 'undefined' is not assignable to type 'number'.
$ PORT=4302 node src/bad.ts &
$ curl -s -w ' %{http_code}\n' localhost:4302/users/1
{"id":null,"nmae":"Ada"} 200
```

Node ran the file with three type errors in it and served a wrong response. That is the whole case for `tsc --noEmit` in CI.

**Example 6 — building to `dist/` and the extension rewrite.** With the tsconfig above, `src/server.ts` imports `./env.ts`:

bash

```
$ npx tsc
$ ls dist
env.js
env.js.map
server.js
server.js.map
$ grep -n import dist/server.js
2:import express, {} from 'express';
3:import { loadEnv } from './env.js';
$ PORT=4304 node dist/server.js
listening on 4304
```

`./env.ts` became `./env.js`, and the type-only names left an empty `{}` behind, because `verbatimModuleSyntax` keeps the import statement exactly as written. These are the errors from the other extension choices. They come from a scratch project with the same `tsconfig.json` and only `src/helper.ts` plus a `src/main.ts` that imports it:

bash

```
$ npx tsc --noEmit            # import { helper } from './helper';
src/main.ts(1,24): error TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'. Did you mean './helper.js'?
$ npx tsc --noEmit --rewriteRelativeImportExtensions false     # import ... from './helper.ts'
src/main.ts(1,24): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
$ npx tsc --rewriteRelativeImportExtensions false --allowImportingTsExtensions
tsconfig.json(2,3): error TS5096: Option 'allowImportingTsExtensions' can only be used when one of 'noEmit', 'emitDeclarationOnly', or 'rewriteRelativeImportExtensions' is set.
$ node src/main.ts           # with './helper' (no extension)
…
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/…/src/helper' imported from /…/src/main.ts
…
$ cat dist/main.js           # written by the TS5096 run anyway
import { helper } from './helper.ts';
console.log(helper());
//# sourceMappingURL=main.js.map
```

The TS5096 run still wrote `dist/main.js` (with exit code 2), and that file imports `./helper.ts`, which is the broken output the error warns about.

A bundler is the other build route. esbuild strips the types, follows the imports and writes one file. It does not type-check:

bash

```
$ npx esbuild src/server.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/server.js

  dist/server.js      1.6kb
  dist/server.js.map  3.9kb

⚡ Done in 2ms
$ PORT=4303 node --enable-source-maps dist/server.js
listening on 4303
```

`--packages=external` leaves `express` as an `import` from `node_modules` instead of copying it into the bundle.

**Example 7 — source maps in stack traces.** `src/price.ts`:

typescript

```
interface LineItem {
  sku: string;
  qty: number;
  unitCents: number;
}

type Cart = LineItem[];

export function total(cart: Cart): number {
  return cart.reduce((sum, item) => {
    if (item.qty < 0) throw new Error(`negative qty for ${item.sku}`);
    return sum + item.qty * item.unitCents;
  }, 0);
}

console.log(total([{ sku: 'a', qty: 2, unitCents: 150 }]));
total([{ sku: 'b', qty: -1, unitCents: 99 }]);
```

bash

```
$ node src/price.ts
300
file:///…/src/price.ts:11
    if (item.qty < 0) throw new Error(`negative qty for ${item.sku}`);
…
Error: negative qty for b
    at file:///…/src/price.ts:11:29
…
$ npx tsc && node dist/price.js
300
file:///…/dist/price.js:4
            throw new Error(`negative qty for ${item.sku}`);
…
    at file:///…/dist/price.js:4:19
…
$ node --enable-source-maps dist/price.js
300
/…/src/price.ts:11
    if (item.qty < 0) throw new Error(`negative qty for ${item.sku}`);
…
    at <anonymous> (/…/src/price.ts:11:29)
…
```

Stripping reports `price.ts:11:29` directly. The compiled file reports `price.js:4:19`, a line that does not exist in your source, until `--enable-source-maps` maps it back to `price.ts:11:29`. `tsx` also reports `src/price.ts:11`, because it generates source maps as it compiles.

**Example 8 — edge case: a `ProcessEnv` augmentation that lies.** A common shortcut is to declare the variables you expect on the global `NodeJS.ProcessEnv` interface. `src/process-env.d.ts`:

typescript

```
// src/process-env.d.ts — a declaration-merging "shortcut" that only changes the TYPE.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL: string;   // claims it always exists
    }
  }
}
export {};
```

`src/db.ts`:

typescript

```
const url = process.env.DATABASE_URL;           // type: string (by our claim)
console.log('postgres?', url.startsWith('postgres://'));
```

bash

```
$ npx tsc --noEmit
$ echo $?
0
$ node src/db.ts
file:///…/src/db.ts:2
console.log('postgres?', url.startsWith('postgres://'));
                             ^

TypeError: Cannot read properties of undefined (reading 'startsWith')
…

Node.js v24.19.0
$ DATABASE_URL=postgres://x node src/db.ts
postgres? true
```

`tsc` passes because the declaration says the variable always exists. The variable is not set, so the code crashes. The `declare global` block is ambient (type-only), so `erasableSyntaxOnly` allows it, and that is why nothing warns you. Declaring `DATABASE_URL?: string` (optional) is honest. A validating `loadEnv()` like Example 4 is better, because it fails at startup with a message that names the variable.

**Example 9 — edge case: a package without `"type": "module"`.** Same `tsconfig.json`, but the `package.json` has no `"type"` field, and `src/app.ts` contains:

typescript

```
import { readFileSync } from 'node:fs';
console.log(readFileSync(__filename, 'utf8').length > 0);
```

bash

```
$ npx tsc --noEmit
src/app.ts(1,10): error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'. Adjust the 'type' field in the nearest 'package.json' to make this file an ECMAScript module, or adjust your 'verbatimModuleSyntax', 'module', and 'moduleResolution' settings in TypeScript.
$ node src/app.ts
(node:89589) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///…/src/app.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /…/package.json.
…
ReferenceError: __filename is not defined in ES module scope
…
```

`tsc` and Node disagree about the file. Under `nodenext`, `tsc` reads the missing `"type"` as CommonJS, where `__filename` exists. Node sees `import`, re-parses the file as ESM, and `__filename` is gone. Writing CommonJS in TypeScript is no escape either. `import fs = require('node:fs')` is rejected by both `erasableSyntaxOnly` (TS1294) and Node (`TypeScript import equals declaration is not supported in strip-only mode`), and a plain `const path = require('node:path')` in a `.cts` file is typed `any`, so `const n: number = path.sep` compiles and prints `/`. With type stripping, use ESM: set `"type": "module"` (or name files `.mts`) and replace `__dirname` with `import.meta.dirname`.

## Common mistakes & gotchas

- **Thinking `node file.ts` or `tsx` checks types.** Neither does. Example 5 served `{"id":null,"nmae":"Ada"}` from a file with three type errors. Only `tsc` (or `ts-node` without `transpileOnly`) checks.
- **Importing a type without `type`.** `import { User } from './user.ts'` where `User` is an interface crashes at runtime with `SyntaxError: The requested module './user.ts' does not provide an export named 'User'`, because Node keeps the import and finds no runtime export. `verbatimModuleSyntax` turns it into TS1484 at check time.
- **Writing `enum`, value `namespace`s or parameter properties.** Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Turn on `erasableSyntaxOnly` so `tsc` reports TS1294 first.
- **Upgrading to TypeScript 7 with ts-node in the toolchain.** ts-node 10.9.2 with typescript 7.0.2 crashes before running anything:

  text

  ```
  $ npx ts-node src/main.ts
  …/node_modules/ts-node/dist/configuration.js:91
      const { fileExists = ts.sys.fileExists, readFile = ts.sys.readFile, …
                                  ^

  TypeError: Cannot read properties of undefined (reading 'fileExists')
  …
  ```

  With typescript 5.9.3 in a `"type": "module"` project, `npx ts-node src/bad.ts` printed `x` for `const n: number = "x"`. Node's built-in stripping ran the ESM file and ts-node never type-checked it. With `NODE_OPTIONS=--no-strip-types` the same command failed with `ERR_UNKNOWN_FILE_EXTENSION`.
- **Leaving out `"types": ["node"]` on TypeScript 6 or 7.** `process` becomes `TS2591: Cannot find name 'process'` even with `@types/node` installed, because `types` now defaults to `[]`.
- **Installing the newest `@types/node` for an older runtime.** `npm i -D @types/node` installed 26.6.4 (Node 26 types) on this Node 24 machine. The compiler will happily accept APIs your runtime lacks.
- **Expecting `tsconfig` `paths` to work at runtime.** With `"paths": {"@lib/*": ["./src/lib/*"]}`, `tsx` and esbuild resolved `@lib/v.ts`, but `node src/main.ts` failed with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@lib/v.ts'`, because Node never reads `tsconfig.json`. Use `package.json` `"imports": {"#lib/*": "./src/lib/*"}` instead. Both Node and `tsc` (under `nodenext`) resolve `#lib/v.ts`. This works when you run the source with stripping. If you also build to `dist/`, `tsc` does not rewrite the `.ts` extension in `#` imports (TS2877, see How it works).
- **Naming a declaration file after a source file.** The same augmentation saved as `src/env.d.ts`, next to `src/env.ts`, was silently ignored. `tsc --listFilesOnly` did not list it, and `src/db.ts` failed with `TS18048: 'url' is possibly 'undefined'`. `tsc` treats `env.d.ts` as the declaration output of `env.ts` and leaves it out of `include`. Give hand-written `.d.ts` files names that no `.ts` file uses.
- **Publishing `.ts` in a package.** Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Publish compiled `.js` plus `.d.ts`.

## Best practices

- **Run `tsc --noEmit` in CI and in a pre-push hook.** Its non-zero exit is the only type gate if you run by stripping.
- **Use `erasableSyntaxOnly` and `verbatimModuleSyntax`** so the same source can run under `node`, `tsx`, esbuild, and `tsc`.
- **Use ESM.** Set `"type": "module"` and import relative files with their real `.ts` extension. Add `rewriteRelativeImportExtensions` if you also build `dist/`.
- **Pin `@types/node` to your Node major** and set `"types": ["node"]`.
- **Validate the environment once, at startup,** into a typed object. Do not widen `NodeJS.ProcessEnv` with non-optional fields.
- **Type Express handlers with the generics** `Request<Params, ResBody, ReqBody, Query>` and `Response<Body>`, and include `undefined` in the body type on Express 5.
- **In production, run `.ts` with stripping or run the build with `--enable-source-maps`.** Either way, stack traces point at source lines.
- **Avoid `--experimental-transform-types` for new code.** It is still a release candidate on the Node version this lesson used, and the v26 docs record its removal.

## ⭐ Interview lens

> **Q: “Node can run `.ts` files now. Why do we still need `tsc`?”**  
> A: Node's type stripping finds type-only syntax and replaces it with spaces of the same length, so the remaining JavaScript runs and the line numbers do not move. It uses a bundled parser, it never checks that your types are right, and it never reads `tsconfig.json`. `tsc --noEmit` is the step that loads the config and `@types/node` and exits non-zero on a mismatch, so that step belongs in continuous integration. `tsx` and esbuild also strip or compile without checking. For example, a file can say a field is a string and still return null at runtime, and `node file.ts` will serve it. The limit is syntax that has to generate code. An `enum`, a namespace with values, parameter properties, and `import x = require()` cannot be turned into spaces, so Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Saying "Node compiles TypeScript" is the trap. With the default settings it strips, and it refuses anything that needs real code generation.

> **Q: “Why does `enum` fail under `node file.ts` but an `interface` works?”**  
> A: An interface is erasable. Delete it and the program behaves the same, so replacing it with whitespace is safe. An `enum` produces a runtime object. Turning it into spaces would break every `Status.Active` reference, so Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` instead of guessing. The same rule hits a namespace that holds values, constructor parameter properties, and `import x = require()`. Stripping keeps line and column positions because each removed type is replaced by spaces of the same length. For example, a status enum fails under `node file.ts`, and an interface next to it runs. The limit of "just avoid enum" is that `tsc` will still accept it unless you set `erasableSyntaxOnly`, which reports TS1294. `--experimental-transform-types` can convert enums, and it is the wrong default for new code because this lesson's Node still treats it as a release candidate and the v26 docs record the flag's removal.

> **Q: “What does `verbatimModuleSyntax` do and why does type stripping need it?”**  
> A: `verbatimModuleSyntax` tells `tsc` to keep every import and export exactly as written, and to drop only the ones marked `type`. That matches Node. Node cannot know `User` is an interface unless the import says `type`. If you write `import { User } from './user.ts'` and `User` is only a type, Node keeps the import, finds no runtime export, and throws a syntax error that the module does not provide an export named `User`. With the option on, `tsc` reports that case as TS1484 before you run anything. For example, a type-only `User` used in a function signature must be `import { type User }` or `import type`. The limit is that this option is a check-time rule. It does not change Node's loader. You still need it, together with `erasableSyntaxOnly`, if you want `tsc --noEmit` to reject the files stripping cannot run. It also pairs with writing the real `.ts` extension on relative imports, because stripping does not rewrite specifiers.

> **Q: “How do you type `process.env`?”**  
> A: Leave `NodeJS.ProcessEnv` as values that are `string | undefined`. At startup, read the variables once, convert numbers, check enumerations, and throw a clear error if something required is missing or malformed. The result is a typed config object the rest of the app uses. Augmenting `ProcessEnv` so `DATABASE_URL` is typed as a plain `string` only changes the type the compiler sees. `tsc` passes, and the process still crashes when the variable is missing, because nothing checked it at runtime. For example, a boot function that requires the URL and the port, and refuses to listen until both parse, fails the deploy in a way you can log. The limit is declaration merging that makes the type lie. Types are erased before Node runs, so a non-optional annotation is not a default and not a presence check. On TypeScript 6 and 7 you also need `"types": ["node"]`, or `process` itself is an unknown name.

## Cheat-card

- **Run:** `node file.ts` strips types and never checks them. On this lesson's Node it is on by default.
- **Stripping rejects:** `enum`, value `namespace`, parameter properties, `import =`.
- **Check:** `tsc --noEmit` in CI. Nothing else in the run path checks types, except ts-node without `transpileOnly`.
- **tsconfig for stripping:** `module` and `moduleResolution` set to `nodenext`, `target` `es2025`, `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, `"types": ["node"]`.
- **Imports:** `import './env.ts'` while running source. Mark type imports with `type`.
- **ESM:** set `"type": "module"`, or `tsc` and Node can disagree about the file.
- **`@types/node`:** pin the major to your Node major.
- **Env:** validate once into a typed object. Widening `ProcessEnv` does not check anything at runtime.
- **Express 5:** `Request<Params, ResBody, ReqBody, Query>`, `Response<Body>`, and `req.body` may be `undefined`.
- **Stack traces:** stripping keeps positions. Builds need `"sourceMap": true` and `node --enable-source-maps`.
- **ts-node 10.9.2** crashes on TypeScript 7. Run with tsx or stripping, and check with `tsc`.

## Good to know

- **Your stack traces point at `dist/server.js:212`.** Emit source maps with `"sourceMap": true` and start Node with `--enable-source-maps`, or run the `.ts` source with stripping, which keeps line and column positions and needs no map.
- **Type stripping was added in v22.6.0** behind `--experimental-strip-types`.
- **`--experimental-transform-types` was added in v22.7.0.** It also converts `enum`, namespaces, and parameter properties, and it turns on `--enable-source-maps`.
- **Type stripping is enabled by default** as of v23.6.0 and v22.18.0.
- **The ExperimentalWarning for stripping stopped** as of v24.3.0 and v22.18.0.
- **Stripping is Stability 2, Stable,** as of v24.12.0 and v25.2.0. The opt-out was renamed from `--no-experimental-strip-types` to `--no-strip-types`. On v24.19.0 both spellings still work.
- **`--experimental-transform-types` is Stability 1.2, release candidate,** on v24.19.0 and prints an ExperimentalWarning. The docs this lesson used list its removal in v26.0.0.
- **`process.features.typescript`** is `'strip'` by default, `'transform'` with the transform flag, and `false` with `--no-strip-types`.
- **Versions in the comparison:** tsx 4.23.15, ts-node 10.9.2 published on 8 Dec 2023, esbuild 0.28.2, and TypeScript 7.0.2 was `latest` on npm when this lesson was written.
- **`"strict": true` became the default in TypeScript 6.0.** Writing it keeps older compilers in agreement.
- **`erasableSyntaxOnly` was added in TypeScript 5.8.** TypeScript 5.7.3 rejects it with TS5023. 5.8.3, 6.0.3, and 7.0.2 accept it.
- **`rewriteRelativeImportExtensions` was added in TypeScript 5.7.** It implies `allowImportingTsExtensions`. `tsc --showConfig` lists both.
- **Since TypeScript 6.0, `types` defaults to `[]`.** TypeScript 5.9.3 and older still loaded every `@types` package automatically.
- **A bare `npm i -D @types/node` installed 26.6.4** on the Node 24 machine used here. `npm i -D @types/node@24` installed 24.19.1.
- **Node 24 ES2025 built-ins checked here:** `Promise.try`, `Iterator.prototype.map`, `Set.prototype.union`, and `RegExp.escape` all exist on v24.19.0.
- **In the `node inspect` command-line debugger,** the source listing showed the stripped code, with blank lines where the interface had been.
- **With typescript 5.9.3 in a `"type": "module"` project,** `npx ts-node src/bad.ts` printed `x` for `const n: number = "x"` because Node's stripping ran the file. With `NODE_OPTIONS=--no-strip-types` the same command failed with `ERR_UNKNOWN_FILE_EXTENSION`.
- **CommonJS escape hatches fail under stripping.** `import fs = require('node:fs')` is rejected by `erasableSyntaxOnly` (TS1294) and by Node. A plain `require` in a `.cts` file is typed `any`.

---

## Learn More

- [Modules: TypeScript nodejs.org](https://nodejs.org/api/typescript.html)
- [Running TypeScript Natively nodejs.org](https://nodejs.org/en/learn/typescript/run-natively)
- [TSConfig Reference typescriptlang.org](https://www.typescriptlang.org/tsconfig/)
- [Modules - Reference typescriptlang.org](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [TypeScript 6.0 release notes typescriptlang.org](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [tsx documentation tsx.hirok.io](https://tsx.hirok.io/)
- [esbuild API esbuild.github.io](https://esbuild.github.io/api/)
