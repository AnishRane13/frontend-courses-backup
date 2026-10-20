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

## Why it matters

TypeScript adds a static type layer on top of JavaScript: a compiler (`tsc`) reads your annotations, checks every call, property access and return value against them, and reports mismatches before the code runs. Node itself only executes JavaScript, so a `.ts` file has to be turned into JavaScript somewhere: by Node, by a loader package, or by a build step. Which of these you choose decides how your app starts, what syntax you may write, how your imports must look, and whether anything type-checks your code at all.

Getting it wrong produces errors that look unrelated to types: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on an `enum`, `ERR_MODULE_NOT_FOUND` for an import that the editor accepted, `does not provide an export named 'User'` for an interface, `__filename is not defined in ES module scope` in a file that compiled cleanly. The most expensive mistake is silent. Every runtime option below **removes** types without checking them, so a project that never runs `tsc` ships type errors to production and learns about them from a `TypeError` in the logs.

## The concept, simply

TypeScript on Node has two separate jobs:

1. **Type checking.** Only `tsc` does this (TypeScript's own compiler). It reads `tsconfig.json`, loads type definitions such as `@types/node`, and exits non-zero on any type error. It can also write `.js` files, or be told not to (`--noEmit`).
2. **Running.** Something has to hand Node plain JavaScript. The choices differ in what syntax they accept and whether a build step exists.

| Option | What it is | Type-checks? | Accepts `enum`, `namespace`, parameter properties? | Reads `tsconfig.json`? | Build output |
|---|---|---|---|---|---|
| Built-in type stripping (`node file.ts`) | Node replaces type annotations with spaces before running the file | No | No (throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`), unless you add `--experimental-transform-types` | No | None |
| `tsx` 4.23.15 (`npx tsx file.ts` or `node --import tsx file.ts`) | A package that registers module hooks and compiles each file with esbuild as it loads | No | Yes | Partly (esbuild reads some options, such as `paths`) | None |
| `ts-node` 10.9.2 | A package that compiles each file with the TypeScript compiler API as it loads | Yes, unless `transpileOnly` | Yes | Yes | None |
| `tsc` to `dist/` | The TypeScript compiler writes `.js` (and `.js.map`) files that you run with plain `node` | Yes | Yes | Yes | `dist/*.js` |
| A bundler such as `esbuild` 0.28.2 | Strips types and joins your files into one output file; no type checking | No | Yes | Partly | One bundle file |

Two facts from this table drive the rest of the lesson. First, only `tsc` and `ts-node` check types, so you run `tsc --noEmit` in CI no matter how you run the code. Second, `ts-node` 10.9.2 was published on 8 Dec 2023 and calls the classic TypeScript compiler API. TypeScript 7 (7.0.2 is `latest` on npm today) is a native compiler without that API, and ts-node crashes against it. See the gotchas section for the output.

## How it works

**What `node file.ts` does (type stripping).** On Node v24.19.0 this works with no flag:

1. Node sees the `.ts`, `.mts` or `.cts` extension. It decides ESM or CommonJS the same way it does for `.js`: `.mts` is always ESM, `.cts` is always CommonJS, and `.ts` follows the nearest `package.json` `"type"` field.
2. It parses the file with a bundled TypeScript parser (Amaro, which wraps SWC) and replaces every piece of type-only syntax with whitespace: annotations, `interface`, `type`, `import type`, `satisfies`, `as`, generics.
3. Because each type is replaced by spaces of the same length, line and column numbers do not move. Node generates no source map and needs none.
4. The resulting JavaScript runs as normal. Nothing checks the types and `tsconfig.json` is never read.
5. If the file contains TypeScript syntax that *generates* JavaScript (`enum`, a `namespace` with values, constructor parameter properties, `import x = require()`), stripping cannot express it with whitespace, so Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.

**Version history and stability** (from the docs' History tables):

- Type stripping was added in v22.6.0 behind `--experimental-strip-types`.
- `--experimental-transform-types` (added in v22.7.0) also converts `enum`, namespaces and parameter properties, and turns on `--enable-source-maps`.
- Changed in v23.6.0 / v22.18.0: type stripping is enabled by default.
- Changed in v24.3.0 / v22.18.0: it no longer prints an `ExperimentalWarning`.
- Changed in v24.12.0 / v25.2.0: **Stability: 2 - Stable**. The opt-out flag was renamed from `--no-experimental-strip-types` to `--no-strip-types`; on v24.19.0 both spellings still work.
- `--experimental-transform-types` is still **Stability 1.2 - Release candidate** on v24.19.0 and prints an `ExperimentalWarning`. The current docs list "v26.0.0: Removed `--experimental-transform-types` flag", so do not build on it.
- `process.features.typescript` reports the mode: `'strip'` by default, `'transform'` with the transform flag, `false` with `--no-strip-types`.

**What stripping refuses beyond `enum`.** Node will not strip `.ts` files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so packages must still publish JavaScript. `tsconfig` `paths` aliases are not applied (subpath imports starting with `#` are the closest Node feature). `.tsx` is unsupported, and so is TypeScript in the REPL and in `node --check`.

**The `tsconfig.json` that matches stripping.** When Node runs the source directly, `tsconfig.json` exists only for `tsc --noEmit` and for your editor. Its job is to make `tsc` reject anything Node would reject:

- **`"module": "nodenext"` and `"moduleResolution": "nodenext"`.** `tsc` applies Node's own rules: it reads `"type"` from `package.json` to decide whether each file is ESM or CommonJS, honours package `"exports"`, and requires file extensions on relative ESM imports (error TS2835).
- **`"target"`** sets which JavaScript syntax `tsc` emits and which built-in library types it assumes. Node 24 implements the ES2025 built-ins (`Promise.try`, `Iterator.prototype.map`, `Set.prototype.union`, `RegExp.escape` all exist on v24.19.0), so `"es2025"` emits your code unchanged. Type stripping ignores `target` entirely.
- **`"strict": true`** turns on the strict family of checks (`strictNullChecks`, `noImplicitAny`, …). It became the default in TypeScript 6.0, but writing it explicitly keeps older compilers and readers in agreement.
- **`"verbatimModuleSyntax": true`** makes `tsc` keep every import exactly as written, except those marked `type`. That is how Node behaves, so an interface imported without `type` becomes a compile error (TS1484) instead of a runtime crash.
- **`"erasableSyntaxOnly": true`** (added in TypeScript 5.8) makes `tsc` reject the syntax that stripping cannot handle (TS1294). TypeScript 5.7.3 rejects the option with `TS5023: Unknown compiler option 'erasableSyntaxOnly'`; 5.8.3, 6.0.3 and 7.0.2 accept it.
- **`"rewriteRelativeImportExtensions": true`** (added in TypeScript 5.7) lets you write `import './env.ts'` and makes `tsc` emit `import './env.js'` when it builds `dist/`. It implies `allowImportingTsExtensions` (`tsc --showConfig` lists both). `allowImportingTsExtensions` alone permits `.ts` specifiers but only together with `noEmit`, `emitDeclarationOnly` or `rewriteRelativeImportExtensions` (TS5096), because emitted `.js` files would otherwise import `.ts` files.
- **`"types": ["node"]`** loads `@types/node`. Since TypeScript 6.0, `types` defaults to `[]`, so without this line `process`, `Buffer` and `node:fs` are unknown (TS2591). TypeScript 5.9.3 and older still loaded every `@types/*` package automatically.

**`@types/node`.** Node's API types are not bundled with TypeScript. They come from the `@types/node` package (DefinitelyTyped), whose major version follows the Node major. A bare `npm i -D @types/node` installed 26.6.4 here, the types for Node 26, which describe APIs that Node 24 does not have. Pin the major to your runtime: `npm i -D @types/node@24` installed 24.19.1.

**Import extensions.** Node's ESM loader never guesses extensions, and type stripping does not rewrite specifiers. So under stripping you write the real file name, `./env.ts`. Writing `./env.js` would make Node look for a file that does not exist. When `tsc` builds `dist/`, `rewriteRelativeImportExtensions` turns `./env.ts` into `./env.js`, so the same source works both ways. It only rewrites relative specifiers (`./`, `../`). A subpath import such as `#lib/v.ts` is emitted unchanged, and `tsc` reports `error TS2877: This import uses a '.ts' extension to resolve to an input TypeScript file, but will not be rewritten during emit because it is not a relative path.` The Node docs add that `require('./file.ts')` also needs the extension.

**Source maps and debugging.** Stripping keeps positions, so stack traces point at the right `.ts` line with no map. A `tsc` build moves code around (interfaces disappear, lines are re-wrapped), so the line numbers in `dist/*.js` no longer match your source. `"sourceMap": true` writes a `.js.map` next to each file, and `node --enable-source-maps` makes stack traces use it. `node --inspect src/price.ts` starts the inspector as usual, and positions match the `.ts` file. In the `node inspect` command-line debugger, the source listing showed the stripped code, with blank lines where the `interface` had been.

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

- **Run `tsc --noEmit` in CI and in a pre-push hook.** Make it a `typecheck` script. Its non-zero exit code is the only type gate you have.
- **Use stripping-compatible settings even if you build.** `erasableSyntaxOnly` and `verbatimModuleSyntax` keep the code runnable by `node`, `tsx`, esbuild and `tsc` alike, so you can switch runners later without rewriting code.
- **Use ESM for TypeScript on Node.** Set `"type": "module"` and import relative files with their real `.ts` extension. Add `rewriteRelativeImportExtensions` if you also build to `dist/`.
- **Pin `@types/node` to your Node major** and add `"types": ["node"]` explicitly.
- **Validate the environment once, at startup,** into a typed object (Example 4). Do not widen `NodeJS.ProcessEnv` with non-optional fields.
- **Type Express handlers with the generics** `Request<Params, ResBody, ReqBody, Query>` and `Response<Body>`, and include `undefined` in the body type on Express 5.
- **In production, either run `.ts` with stripping or run the build with `--enable-source-maps`.** Either way, stack traces point at source lines.
- **Avoid `--experimental-transform-types` for new code.** It is a release candidate that prints a warning on v24, and the v26 docs record its removal.

## ⭐ Interview lens

> **Q: “Node can run `.ts` files now. Why do we still need `tsc`?”**  
> A: Node's type stripping only replaces type syntax with whitespace so the remaining JavaScript can run. It never checks types and never reads `tsconfig.json`. `tsc --noEmit` is the step that finds type errors, so it runs in CI. The same is true of tsx and esbuild. *Trap:* saying "Node 24 compiles TypeScript". It strips, and with the default settings it refuses anything that needs real code generation.

> **Q: “Why does `enum` fail under `node file.ts` but an `interface` works?”**  
> A: An interface is erasable: delete it and the program behaves the same. An `enum` produces a runtime object, so turning it into whitespace would break every `Status.Active` reference, and Node throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` instead. The same applies to value namespaces, parameter properties and `import x = require()`. `erasableSyntaxOnly` makes `tsc` reject them too.

> **Q: “What does `verbatimModuleSyntax` do and why does type stripping need it?”**  
> A: It makes `tsc` keep every import and export as written and drop only those marked `type`. Node behaves the same way: it cannot know `User` is an interface unless the import says `type`, so an unmarked type import fails at link time with "does not provide an export named". The option makes `tsc` report that case as TS1484.

> **Q: “How do you type `process.env`?”**  
> A: Leave `NodeJS.ProcessEnv` as `string | undefined` values. Parse it once at startup into a typed config object, convert numbers, check enumerations and throw a clear error on bad input. Augmenting `ProcessEnv` with `DATABASE_URL: string` only changes the type. `tsc` passes and the app crashes when the variable is missing.

> **Q: “Your stack traces point at `dist/server.js:212`. How do you get TypeScript lines?”**  
> A: Emit source maps (`"sourceMap": true`) and start Node with `--enable-source-maps`, or run the `.ts` source with type stripping, which keeps line and column positions unchanged and needs no map.

## Cheat-card

- **Run:** `node file.ts` (stable since v24.12.0 / v25.2.0, on by default since v23.6.0 / v22.18.0). It strips types and never checks them.
- **Rejected by stripping:** `enum`, value `namespace`, parameter properties, `import =`. `--experimental-transform-types` allows them (RC, warns, removed in v26).
- **Check:** `tsc --noEmit` in CI. Nothing else in the run path checks types.
- **tsconfig:** `module`/`moduleResolution: nodenext`, `target: es2025`, `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (TS ≥ 5.8), `rewriteRelativeImportExtensions` (TS ≥ 5.7), `types: ["node"]` (needed on TS ≥ 6).
- **Imports:** `import './env.ts'` plus `rewriteRelativeImportExtensions` for builds, and `import { type X }` for types.
- **ESM:** set `"type": "module"`, otherwise `tsc` and Node disagree about the file.
- **`@types/node`:** pin it to your Node major.
- **Env:** validate once into a typed object. `ProcessEnv` augmentation does not check anything at runtime.
- **Express 5:** `Request<Params, ResBody, ReqBody, Query>`, `Response<Body>`, and `req.body` may be `undefined`.
- **Stack traces:** stripping keeps positions. Builds need `sourceMap` plus `node --enable-source-maps`.
- **ts-node 10.9.2** crashes with TypeScript 7. Use tsx or stripping to run, and `tsc` to check.

---

## Learn More

- [Modules: TypeScript nodejs.org](https://nodejs.org/api/typescript.html)
- [Running TypeScript Natively nodejs.org](https://nodejs.org/en/learn/typescript/run-natively)
- [TSConfig Reference typescriptlang.org](https://www.typescriptlang.org/tsconfig/)
- [Modules - Reference typescriptlang.org](https://www.typescriptlang.org/docs/handbook/modules/reference.html)
- [TypeScript 6.0 release notes typescriptlang.org](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
- [tsx documentation tsx.hirok.io](https://tsx.hirok.io/)
- [esbuild API esbuild.github.io](https://esbuild.github.io/api/)
