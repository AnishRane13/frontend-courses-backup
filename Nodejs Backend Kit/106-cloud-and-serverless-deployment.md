---
title: "Cloud and Serverless Deployment"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Cloud and Serverless Deployment

*28 min read · Updated 12 Oct 2026 · Topic 110 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, @codegenie/serverless-express 5.0.0, esbuild 0.28.2, cfn-lint 1.57.2. Every handler was run locally with sample events; nothing in this lesson called AWS, Vercel, Render or Fly.

---

## Why it matters

Lessons 101 and 102 end with a container image and a process that shuts down cleanly. The next question is where that code runs, and the choice changes how you write it:

- **On a function platform (AWS Lambda),** there is no long-running server. The platform starts your code when an event arrives, may freeze it between events, and may throw it away at any time. Code at module scope runs once per environment, not once per request. A database pool of 10 connections per instance becomes 10 connections per *concurrent request*.
- **On a container platform (ECS on Fargate, Render, Fly),** your Express app runs as it does on your laptop, but the platform stops it with a signal on every deploy. If the app ignores the signal, in-flight requests fail on every release.
- **On a platform that turns your app into functions (Vercel),** some Express features stop working: Vercel's docs say `express.static()` is ignored there.

None of these platforms can be tested from this machine, so this lesson does what you can do before deploying: run the handler locally with the same event shape the platform sends, bundle it, and validate the deployment template. The rest comes from each platform's current docs and is marked as such.

## The concept, simply

A Lambda function is a module that exports one async function, the **handler**. Lambda calls it with two arguments: the **event** (what happened: an HTTP request, a queue message, a file upload) and the **context** (facts about this invocation: request ID, time left). Whatever the handler returns becomes the response.

Lambda runs your code inside an **execution environment**: a small isolated sandbox with the Node runtime and your code loaded. The first request that needs a new environment pays for creating it. This is the **cold start**. Later requests that land on the same environment reuse everything that was already loaded. This is a **warm start**. Each environment handles one request at a time. The AWS docs: "For each concurrent request, Lambda provisions a separate instance of your execution environment."

The Lambda invocation lifecycle, from the AWS "execution environment lifecycle" page:

text

```
 event arrives, no free environment                     event arrives, a frozen environment exists
            │                                                       │
            ▼                                                       │
 ┌─ INIT (cold start, limit 10 s) ──────────────────┐               │
 │ 1. start extensions                              │               │
 │ 2. bootstrap the Node runtime                    │               │
 │ 3. load your module: run top-level code          │               │
 │    (imports, new S3Client(), DB pool, app setup) │               │
 └──────────────────────────────────────────────────┘               │
            │                                                       │
            ▼                                                       ▼
 ┌─ INVOKE ──────────────────────────┐               ┌─ INVOKE (warm start) ─────────┐
 │ handler(event, context) runs      │               │ same module, same variables,  │
 │ returned value = response         │               │ same open connections         │
 └───────────────────────────────────┘               └───────────────────────────────┘
            │                                                       │
            ▼                                                       ▼
   environment FROZEN until the next event  ──────────────►  (thawed for the next event)
            │
            ▼  (Lambda decides; you cannot predict when)
 ┌─ SHUTDOWN ─────────────────────────────────────────┐
 │ extensions get a Shutdown event; 0 ms if none      │
 └────────────────────────────────────────────────────┘
```

A **container service** is the opposite model: you give the platform an image or a repo, it keeps N copies of your server running behind a load balancer, and it replaces them on deploy by starting new ones, switching traffic, then sending the old ones a stop signal. Your Express app does not change. Your shutdown code (lesson 102) is what decides whether deploys drop requests.

## How it works

**What a Lambda invocation looks like, step by step** (AWS Lambda Developer Guide, "Lambda execution environment lifecycle" and "Define Lambda function handler in Node.js"):

1. An event arrives. Lambda looks for a frozen environment for this function version. If none is free, it creates one.
2. **Init phase.** Lambda starts extensions, bootstraps the runtime, and loads your module, which runs everything at the top level of the file. The docs: "The Init phase is limited to 10 seconds." If it does not finish, Lambda retries it during the first invocation, under the function's own timeout.
3. **Invoke phase.** The runtime calls the exported handler. The **Handler** setting names the file and the export, separated by a dot. The default is `index.handler`, meaning the `handler` export of `index.js` or `index.mjs`.
4. The handler returns (or its promise resolves). The return value is the response. If the handler throws, the invocation fails.
5. Lambda freezes the environment. Timers and open sockets stop. Module-scope variables keep their values.
6. A later event may thaw the same environment and go straight to step 3. Or Lambda may shut the environment down; with no extensions, the Shutdown phase has a 0 ms limit, so your code gets no signal to clean up.

**The handler shape on Node 24.** The runtime identifier is `nodejs24.x` (Amazon Linux 2023). The AWS runtimes table, read on 12 Oct 2026, lists its deprecation date as Apr 30, 2028, "subject to change". It also lists `nodejs26.x` as a public preview that "should not be used for production workloads". On Node 24, only async handlers are supported (changed in `nodejs24.x`). The AWS docs: "Callback-based function handlers are only supported up to Node.js 22. Starting from Node.js 24, asynchronous tasks should be implemented using async function handlers." So the shape is:

javascript

```
export const handler = async (event, context) => {
  return { statusCode: 200, body: 'ok' };
};
```

The `context` object carries, among others, `awsRequestId`, `functionName`, `functionVersion`, `memoryLimitInMB` and the method `getRemainingTimeInMillis()`, which returns "the number of milliseconds left before the execution times out". `context.callbackWaitsForEmptyEventLoop` only applies to callback handlers, so on Node 24 it does nothing for you.

**Cold starts: what you control.** The Init phase runs your top-level code, so its length is your import graph plus whatever you do at module scope. Things that make it longer: a large `node_modules` tree that has to be read file by file, top-level `await` on a slow network call, and SDK clients for services you rarely use. Ways to make it shorter:

- **Bundle** (Example 4). The AWS Node packaging page says bundling with esbuild or rollup "results in improved performance due to the reduction in I/O operations".
- **Load rarely used code lazily** with `await import()` inside the code path that needs it.
- **Provisioned concurrency:** pre-initialised environments that are "ready to respond immediately to incoming function requests". The AWS concurrency docs say "interactive workloads benefit the most".
- **SnapStart is not available for Node.** The SnapStart page lists "Java 11 and later, Python 3.12 and later, .NET 8 and later".

**Connection reuse.** Because module scope survives between warm invocations, the AWS handler guide puts SDK clients outside the handler: "This causes Lambda to run this code during the initialization phase, and the client is preserved for reuse across multiple invocations." The same applies to a database pool or an `undici` agent. Example 2 shows the mechanism locally: one loaded module keeps its counter and its client object across calls, and a second module instance (a second environment) starts from zero. Two consequences:

- **Pool size.** One environment handles one request at a time, so a `pg` pool with `max: 10` inside a Lambda function opens connections that are never used concurrently, and 200 concurrent requests mean 200 environments, each with its own pool. Keep `max` at 1 or 2 per environment, and put a connection proxy (such as Amazon RDS Proxy) or a pooler such as PgBouncer in front of the database (lesson [46](74-connection-pooling.md)).
- **Stale sockets.** The AWS best-practices list warns: "Lambda purges idle connections over time. Attempting to reuse an idle connection when invoking a function will result in a connection error." Use keep-alive, as the docs advise, and retry once on a reset connection. Node's `http.globalAgent` has used keep-alive by default since v19.0.0.

**Bundling.** Lambda accepts a .zip archive of your code. You can zip `node_modules` as it is, or bundle the code into one file with esbuild and ship only that. Example 4 does the second: 66 installed production packages (4.5 MB on disk) became one 811 KB file, 277 KB zipped. Two settings matter:

- `--platform=node --target=node24` keeps Node built-ins (`node:http`, `util`) as imports.
- `--format=esm` produces an ES module, which needs a `require` shim when the bundled packages are CommonJS (Example 5).

**Layers.** A layer is a separate .zip that Lambda "extracts … into the `/opt` directory" of the execution environment. For Node, the layer must put packages under `nodejs/node_modules` or `nodejs/nodeXX/node_modules` so the runtime finds them. The docs allow "up to five layers per function", and only for functions deployed as a .zip file archive, not as container images. Layers suit native binaries, shared internal packages and Lambda extensions. If you bundle with esbuild, a package that comes from a layer must be marked `--external:<name>`, or esbuild will copy it into the bundle anyway.

**API Gateway HTTP API, payload format 2.0.** An HTTP API turns each HTTP request into a Lambda event. You choose the payload format version on the integration. The docs say the console defaults to the latest, and with the AWS CLI, CloudFormation or an SDK "you must specify a `payloadFormatVersion`". The supported values are `1.0` and `2.0`. Format 2.0 (the sample in Example 1 is copied from the AWS docs page):

- **Request line:** `requestContext.http.method`, `rawPath`, `rawQueryString`.
- **Headers and query:** `headers` and `queryStringParameters` with duplicates "combined with commas"; there is no `multiValueHeaders` in 2.0.
- **Cookies:** a separate `cookies` array.
- **Body:** `body` is a string, with `isBase64Encoded` telling you whether to decode it.
- **Response:** `{ statusCode, headers, cookies, body, isBase64Encoded }`. If the function returns valid JSON with no `statusCode`, API Gateway assumes status 200, `content-type: application/json`, and uses the return value as the body.

**Wrapping an Express 5 app.** Two maintained adapters translate API Gateway events into Node `req`/`res` objects and back. Both were checked on 12 Oct 2026:

| Package (version checked) | Latest release | Last commit to the repo | `engines` | Notes |
|---|---|---|---|---|
| `@codegenie/serverless-express` 5.0.0 | 16 Apr 2026 | 16 Apr 2026 | `node >=24` | The former `aws-serverless-express`; its README says that package "will be deprecated in favor of @codegenie/serverless-express". Supports API Gateway v1 and v2, ALB, Lambda@Edge and VPC Lattice. Used in Example 3. |
| `serverless-http` 4.0.0 | 1 Sep 2025 | 7 Sep 2026 | `node >=12.0` | Not run in this lesson. |

The adapter is created once, at module scope, so the Express app is built during Init and reused by every warm invocation.

**ECS on Fargate, in outline.** These facts come from the Amazon ECS Developer Guide, and none was run here. Amazon ECS runs containers from a **task definition**, which lists the image, CPU, memory, ports, environment, health check and `stopTimeout`. A **service** keeps `desiredCount` copies of a task running, optionally behind an Application Load Balancer, and replaces them on deploy. **Fargate** is the launch type with no servers to manage: "Each Fargate task has its own isolation boundary and does not share the underlying kernel, CPU resources, memory resources, or elastic network interface with another task." Fargate tasks use the `awsvpc` network mode. For a Node app, the parts that touch your code are:

- **Rolling deploys.** `maximumPercent` (default 200% for a REPLICA service) and `minimumHealthyPercent` bound how many tasks may run during a deploy. They play the same role as `maxSurge` and `maxUnavailable` in lesson [109](105-kubernetes-for-node-developers.md).
- **Stopping a task.** ECS sends the image's `STOPSIGNAL`, "default to SIGTERM", then SIGKILL after the timeout. The container's `stopTimeout` defaults to 30 seconds, maximum 120. Your forced-exit timer (lesson [66](102-graceful-shutdown-monitoring.md)) must be shorter.
- **`healthCheckGracePeriodSeconds`** (default 0) tells the scheduler to ignore failing load-balancer health checks while a slow-starting task warms up.

The image itself is the one from lesson 101 (`node:24-slim`, non-root user).

**Vercel, Render and Fly for a Node app.** Facts from each platform's docs, read on 12 Oct 2026. Nothing was deployed, and pricing is left out on purpose:

| | Vercel | Render | Fly.io |
|---|---|---|---|
| What runs your Express app | "your Express application becomes a single Vercel Function and uses Fluid compute by default" | A web service: your server process, built from a repo or an image | Fly Machines, "fast-launching VMs", from a Docker image (`fly launch` sets up the app and `fly.toml`, `fly deploy` deploys it) |
| How the app is wired | `export default app`, or an ordinary `app.listen(port)` | Bind to `0.0.0.0` on `PORT` ("The default value of `PORT` is 10000") | `[http_service] internal_port` in `fly.toml` must match the port the app listens on |
| Concurrency per instance | Fluid compute "allows multiple invocations to share a single function instance" | A normal long-running process | A normal long-running process; `[http_service.concurrency]` sets soft and hard limits |
| Node version | "24.x (default)" and "22.x"; only major versions can be chosen | New services default to Node 24.21.0; override with `NODE_VERSION`, `.node-version`, `.nvmrc` or `engines.node` (the docs warn an unbounded range like `>=20` "always resolves to the latest release") | Whatever your Dockerfile installs |
| Shutdown on deploy | Not described for Express on the pages checked | After the new instance takes traffic, "After 60 seconds, Render sends a SIGTERM", then SIGKILL after the shutdown delay ("default 30 seconds") | `kill_signal` is **SIGINT by default**; `kill_timeout` "default is 5 seconds", maximum 300 |
| Things that differ from your laptop | `express.static()` "will be ignored"; put files in `public/**`; 250 MB bundle size limit | Ephemeral filesystem; a persistent disk "disables zero-downtime deploys" | `auto_stop_machines` can stop or suspend idle Machines; `min_machines_running` keeps some running |

> ⚠️ Unverified: every row of this table and the ECS outline come from the platforms' documentation (the main pages are in Learn More), read on 12 Oct 2026. No app was deployed to Vercel, Render, Fly, ECS or Lambda, so actual cold-start times, shutdown timing and limits were not observed.

## Code examples

The project for Examples 1–6 (an npm project with `"type": "module"`):

bash

```
$ npm install express@5.3.0 @codegenie/serverless-express@5.0.0
$ npm install -D esbuild@0.28.2
$ npm ls
lambda@1.0.0 /…/lambda
├── @codegenie/serverless-express@5.0.0
├── esbuild@0.28.2
└── express@5.3.0
```

esbuild ships a native binary (`@esbuild/linux-x64` here). npm 11.17.0 printed `npm warn allow-scripts   esbuild@0.28.2 (postinstall: node install.js)` and skipped the install script. The binary still came in through the optional dependency, and `npx esbuild --version` printed `0.28.2`.

**Example 1 — a plain handler, invoked locally with the AWS docs' HTTP API 2.0 sample event.**

`events/aws-docs-v2.json` is the "2.0" request example from the API Gateway page "Create AWS Lambda proxy integrations for HTTP APIs", copied unchanged: `POST /my/path`, two cookies, `parameter1=value1&parameter1=value2`, a JWT authorizer block and a body.

javascript

```
// handler.mjs — a plain Lambda handler for an API Gateway HTTP API (payload format 2.0)
import { randomUUID } from 'node:crypto';

// Init phase: this runs once per execution environment (on a cold start).
const initId = randomUUID().slice(0, 8);
const client = { createdAt: new Date().toISOString(), queries: 0 }; // stands in for a DB/SDK client
let invocations = 0;
console.log(`init: module loaded, client created (env ${initId})`);

// Invoke phase: this runs once per event.
export const handler = async (event, context) => {
  invocations += 1;
  client.queries += 1;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      env: initId,
      invocation: invocations,
      clientCreatedAt: client.createdAt,
      method: event.requestContext.http.method,
      path: event.rawPath,
      query: event.queryStringParameters,
      cookies: event.cookies,
      requestId: context.awsRequestId,
      remainingMs: context.getRemainingTimeInMillis(),
    }),
  };
};
```

The harness plays the part of the Lambda runtime: it loads the module once, builds a context object with the documented field names, and awaits the handler.

javascript

```
// invoke.mjs — call a handler the way the Lambda runtime would, with no AWS involved
// usage: node invoke.mjs <handler-module> <event.json>
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [modulePath, eventPath] = process.argv.slice(2);
const event = JSON.parse(await readFile(eventPath, 'utf8'));

// A local stand-in for the Lambda context object (field names from the AWS docs).
function makeContext(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  return {
    functionName: 'local-fn', functionVersion: '$LATEST', memoryLimitInMB: '512',
    awsRequestId: randomUUID(),
    getRemainingTimeInMillis: () => deadline - Date.now(),
  };
}

const { handler } = await import(pathToFileURL(modulePath).href);
const result = await handler(event, makeContext());
const parse = (b) => { try { return JSON.parse(b); } catch { return b; } };
console.log({ ...result, body: parse(result.body) });
```

bash

```
$ node invoke.mjs handler.mjs events/aws-docs-v2.json
init: module loaded, client created (env c55c60e3)
{
  statusCode: 200,
  headers: { 'content-type': 'application/json' },
  body: {
    env: 'c55c60e3',
    invocation: 1,
    clientCreatedAt: '2026-10-12T17:13:57.618Z',
    method: 'POST',
    path: '/my/path',
    query: { parameter1: 'value1,value2', parameter2: 'value' },
    cookies: [ 'cookie1', 'cookie2' ],
    requestId: '52ed00b3-792b-4c18-9269-87f3b4d0a745',
    remainingMs: 2999
  }
}
```

The IDs and timestamps change on every run. Note `parameter1: 'value1,value2'`: the repeated query key arrives already joined with a comma, as the 2.0 format describes. If a value can itself contain a comma, parse `event.rawQueryString` instead.

**Example 2 — module scope survives warm invocations; a new environment starts from zero.**

A single loaded ES module is the local equivalent of one warm execution environment. Importing the same file with a different query string (`?env=b`) creates a second, independent module instance, standing in for a second environment.

javascript

```
// warm.mjs — one loaded module = one warm execution environment
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const event = JSON.parse(await readFile('events/aws-docs-v2.json', 'utf8'));
const ctx = () => ({ awsRequestId: randomUUID(), getRemainingTimeInMillis: () => 3000 });
const show = (label, r) => {
  const b = JSON.parse(r.body);
  console.log(`${label}: env=${b.env} invocation=${b.invocation} clientCreatedAt=${b.clientCreatedAt}`);
};

const envA = await import('./handler.mjs');            // cold start of environment A
for (let i = 0; i < 3; i++) show('A', await envA.handler(event, ctx()));

const envB = await import('./handler.mjs?env=b');      // a new module instance = a second environment
show('B', await envB.handler(event, ctx()));
show('A', await envA.handler(event, ctx()));            // A kept its state
```

bash

```
$ node warm.mjs
init: module loaded, client created (env 2ee036b6)
A: env=2ee036b6 invocation=1 clientCreatedAt=2026-10-12T17:13:57.542Z
A: env=2ee036b6 invocation=2 clientCreatedAt=2026-10-12T17:13:57.542Z
A: env=2ee036b6 invocation=3 clientCreatedAt=2026-10-12T17:13:57.542Z
init: module loaded, client created (env 123b2227)
B: env=123b2227 invocation=1 clientCreatedAt=2026-10-12T17:13:57.546Z
A: env=2ee036b6 invocation=4 clientCreatedAt=2026-10-12T17:13:57.542Z
```

The `init:` line printed once per environment, and the client was created once per environment. The counter kept counting in A while B had its own. On Lambda this is how a client created at module scope is reused. It also means any per-request data you put in a module-scope variable leaks into the next request on that environment.

**Example 3 — an Express 5 app behind `@codegenie/serverless-express`.**

The app is ordinary Express and knows nothing about Lambda:

javascript

```
// app.mjs — an ordinary Express 5 app; it knows nothing about Lambda
import express from 'express';

export const app = express();
app.use(express.json());

app.get('/users/:id', (req, res) => {
  res.cookie('seen', '1');
  res.json({ id: req.params.id, query: req.query });
});

app.post('/orders', (req, res) => {
  const { item } = req.body ?? {};               // Express 5: undefined when there is no body
  if (!item) return res.status(400).json({ error: 'item is required' });
  res.status(201).json({ created: item });
});

app.get('/boom', async () => {
  throw new Error('db down');                     // Express 5 forwards async errors
});

app.use((err, req, res, next) => {
  console.error('request failed:', err.message);
  res.status(500).json({ error: 'internal error' });
});
```

The Lambda entry point wraps it once, at module scope:

javascript

```
// lambda.mjs — the Lambda entry point: wrap the Express app once, at init
import serverlessExpress from '@codegenie/serverless-express';
import { app } from './app.mjs';

export const handler = serverlessExpress({ app });
```

Test events are built from the AWS docs sample by changing the method, path, query, headers and body:

javascript

```
// make-events.mjs — derive test events from the AWS docs sample (payload format 2.0)
import { readFile, writeFile } from 'node:fs/promises';

const base = JSON.parse(await readFile('events/aws-docs-v2.json', 'utf8'));
function make({ method, path, query = '', body = null, headers = {} }) {
  const e = structuredClone(base);
  delete e.requestContext.authentication;        // no mTLS on this API
  e.routeKey = e.requestContext.routeKey = '$default';
  e.rawPath = e.requestContext.http.path = path;
  e.requestContext.http.method = method;
  e.rawQueryString = query;
  e.queryStringParameters = query ? Object.fromEntries(new URLSearchParams(query)) : undefined;
  e.headers = { host: e.requestContext.domainName, ...headers };
  e.body = body;
  return e;
}
await writeFile('events/get-user.json', JSON.stringify(make({ method: 'GET', path: '/users/42', query: 'expand=orders' }), null, 2));
await writeFile('events/post-order.json', JSON.stringify(make({
  method: 'POST', path: '/orders', body: JSON.stringify({ item: 'book' }),
  headers: { 'content-type': 'application/json' },
}), null, 2));
await writeFile('events/post-empty.json', JSON.stringify(make({ method: 'POST', path: '/orders' }), null, 2));
await writeFile('events/boom.json', JSON.stringify(make({ method: 'GET', path: '/boom' }), null, 2));
console.log('wrote 4 events');
```

bash

```
$ node events/make-events.mjs
wrote 4 events
$ node invoke.mjs lambda.mjs events/get-user.json
{
  statusCode: 200,
  body: { id: '42', query: { expand: 'orders' } },
  isBase64Encoded: false,
  cookies: [ 'seen=1; Path=/' ],
  headers: {
    'x-powered-by': 'Express',
    'content-type': 'application/json; charset=utf-8',
    'content-length': '39',
    etag: 'W/"27-seJznTSygDOg5TQRbE1mnXQZCLw"'
  }
}
$ node invoke.mjs lambda.mjs events/post-order.json
{
  statusCode: 201,
  body: { created: 'book' },
  isBase64Encoded: false,
  headers: {
    'x-powered-by': 'Express',
    'content-type': 'application/json; charset=utf-8',
    'content-length': '18',
    etag: 'W/"12-VNKHG8AlFJrrs/ZKXL9mp3fprmo"'
  }
}
$ node invoke.mjs lambda.mjs events/post-empty.json
{
  statusCode: 400,
  body: { error: 'item is required' },
  isBase64Encoded: false,
  headers: {
    'x-powered-by': 'Express',
    'content-type': 'application/json; charset=utf-8',
    'content-length': '28',
    etag: 'W/"1c-SS/DpBUyejiau0yKLBwjjoy+8l8"'
  }
}
$ node invoke.mjs lambda.mjs events/boom.json
request failed: db down
{
  statusCode: 500,
  body: { error: 'internal error' },
  isBase64Encoded: false,
  headers: {
    'x-powered-by': 'Express',
    'content-type': 'application/json; charset=utf-8',
    'content-length': '26',
    etag: 'W/"1a-nO1SMtFqjAylRZvcD/JJ2LGv/qs"'
  }
}
```

What the adapter did:

- It detected the 2.0 event and built `req.params`, `req.query` and the JSON body from it.
- It returned the 2.0 response shape. The `Set-Cookie` header from `res.cookie()` moved into the separate `cookies` array that format 2.0 uses.
- The POST with no body reached the route with `req.body` undefined, as Express 5 does, and the `?? {}` guard turned that into a 400.
- The thrown async error reached the error handler and became a 500.

Without that last error handler, Express renders an HTML error page, and the first version of `invoke.mjs` failed with `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` when it tried to parse it.

**Example 4 — bundling with esbuild and checking the bundle runs on its own.**

bash

```
$ npx esbuild lambda.mjs --bundle --platform=node --target=node24 --format=esm --minify --outfile=dist/index.mjs "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

  dist/index.mjs  811.2kb

⚡ Done in 48ms
$ ls -l dist/index.mjs
-rw-rw-r-- 1 anish.r anish.r 830679 Oct 12 22:44 dist/index.mjs
$ cd dist && zip -q -X function.zip index.mjs && ls -l function.zip
-rw-rw-r-- 1 anish.r anish.r 277301 Oct 12 22:44 function.zip
```

For comparison, a production-only install of the same two dependencies (`npm ci --omit=dev` in a copy of the project) is 66 packages, `4.5M node_modules` by `du -sh`. To prove the bundle needs no `node_modules`, it was copied to a directory with no `node_modules` above it and invoked there:

bash

```
$ cp dist/index.mjs ../lrun/ && cd ../lrun && ls
get-user.json  index.mjs
$ node ../lambda/invoke.mjs ./index.mjs get-user.json
{
  statusCode: 200,
  body: { id: '42', query: { expand: 'orders' } },
  isBase64Encoded: false,
  cookies: [ 'seen=1; Path=/' ],
  …
}
```

`--analyze` shows where the 811 KB comes from. Most of it is data tables, not code: the MIME database and iconv-lite's encoding tables that Express's body parser pulls in.

bash

```
$ npx esbuild lambda.mjs --bundle --platform=node --target=node24 --format=esm --minify --outfile=dist/index.mjs "--banner:js=…" --analyze

  dist/index.mjs                                                                                     811.2kb  100.0%
   ├ node_modules/mime-db/db.json                                                                    146.5kb   18.1%
   ├ node_modules/iconv-lite/encodings/tables/cp936.json                                              84.9kb   10.5%
   ├ node_modules/iconv-lite/encodings/tables/cp950.json                                              80.3kb    9.9%
   ├ node_modules/iconv-lite/encodings/tables/eucjp.json                                              77.7kb    9.6%
   ├ node_modules/iconv-lite/encodings/tables/cp949.json                                              67.6kb    8.3%
   …
```

The import cost was measured on this laptop with `import-time.mjs`. It spawns a fresh `node` process 10 times per file, times `await import(file)` with `performance.now()`, and prints the median. The machine was an Intel i5-1135G7 (8 threads) shared with other writers' jobs, so the load changed between runs:

javascript

```
// import-time.mjs — median time to import a module in a fresh Node process (10 runs each)
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

function medianImportMs(file, runs = 10) {
  const url = pathToFileURL(resolve(file)).href;
  const code = `const t = performance.now(); await import(${JSON.stringify(url)}); console.log(performance.now() - t);`;
  const times = [];
  for (let i = 0; i < runs; i++) {
    times.push(Number(execFileSync(process.execPath, ['--input-type=module', '-e', code]).toString()));
  }
  times.sort((a, b) => a - b);
  return ((times[4] + times[5]) / 2).toFixed(1);
}
for (const f of process.argv.slice(2)) console.log(`${f}: median ${medianImportMs(f)} ms`);
```

bash

```
$ node import-time.mjs lambda.mjs dist/index.mjs      # load average about 6.5
lambda.mjs: median 118.5 ms
dist/index.mjs: median 79.6 ms
$ node import-time.mjs lambda.mjs dist/index.mjs      # re-run 40 minutes later, load average about 9.7
lambda.mjs: median 78.4 ms
dist/index.mjs: median 59.2 ms
```

The absolute numbers moved by a third between runs and did not follow the load average, so they say little beyond this machine on that day. In both runs, the bundle loaded faster than the unbundled `node_modules` tree.

This is module loading on a laptop with a warm file cache, not a Lambda cold start, which also includes creating the environment and starting the runtime.

> ⚠️ Unverified: how much bundling shortens a real `nodejs24.x` cold start. No function was deployed, so no `Init Duration` from a Lambda `REPORT` log line was observed.

**Example 5 — edge case: an ESM bundle that crashes with "Dynamic require of "util" is not supported".**

Leave out the `--banner` from Example 4 and the bundle builds without an error, then crashes on load:

bash

```
$ npx esbuild lambda.mjs --bundle --platform=node --target=node24 --format=esm --outfile=dist/esm-naive/index.mjs

  dist/esm-naive/index.mjs  1.1mb ⚠️

⚡ Done in 44ms
$ node ../lambda/invoke.mjs ../lambda/dist/esm-naive/index.mjs get-user.json
file:///…/lambda/dist/esm-naive/index.mjs:11
  throw Error('Dynamic require of "' + x + '" is not supported');
        ^

Error: Dynamic require of "util" is not supported
    at file:///…/lambda/dist/esm-naive/index.mjs:11:9
    at node_modules/@codegenie/serverless-express/src/configure.js (file:///…/lambda/dist/esm-naive/index.mjs:1369:16)
    …
```

Why it happens:

1. Express and `@codegenie/serverless-express` are CommonJS. Their code calls `require('util')`, `require('http')` and so on.
2. esbuild bundles the CommonJS modules, but with `--platform=node` it leaves Node built-ins external. In CommonJS output that is fine: `require` exists.
3. In ESM output there is no `require`. esbuild replaces each call with a stub that throws if no real `require` is in scope.
4. The stub runs during the Init phase, so on Lambda every cold start would fail with this error before your handler is ever called.

There are two fixes. One is the banner from Example 4, which defines a real `require` with `createRequire(import.meta.url)` before any bundled code runs. The other is to bundle with `--format=cjs` to a `.js` file in a project without `"type": "module"`. Either way, run the bundle once locally before you upload it.

**Example 6 — a layer's directory layout.**

The Node layer layout from the AWS "Working with layers for Node.js" page, built locally. Lambda extracts this zip into `/opt`, so the package ends up in `/opt/nodejs/node_modules/orders-shared`.

bash

```
$ cat layer/nodejs/node_modules/orders-shared/package.json
{ "name": "orders-shared", "version": "1.0.0", "type": "module", "main": "index.mjs" }
$ cd layer && zip -q -r -X ../dist/layer.zip nodejs && unzip -l ../dist/layer.zip
Archive:  ../dist/layer.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
        0  2026-10-12 23:04   nodejs/
        0  2026-10-12 23:04   nodejs/node_modules/
        0  2026-10-12 23:04   nodejs/node_modules/orders-shared/
       70  2026-10-12 23:04   nodejs/node_modules/orders-shared/index.mjs
       87  2026-10-12 23:04   nodejs/node_modules/orders-shared/package.json
---------                     -------
      157                     5 files
```

The common mistake is zipping the *contents* of `nodejs/` (so the archive starts with `node_modules/`), which puts the packages in `/opt/node_modules`, outside the paths the docs list.

> ⚠️ Unverified: that the Node 24 runtime resolves `import … from 'orders-shared'` from this layer. The layout follows the AWS docs, but no layer was published or attached to a function.

**Example 7 — a CloudFormation template, validated with cfn-lint and not deployed.**

cfn-lint 1.57.2 was installed without root into a Python virtual environment under `~/.cache` (`python3 -m venv --without-pip`, then pip from `get-pip.py`). The template is plain CloudFormation: an IAM role, the function, the layer from Example 6, an HTTP API with a quick-create Lambda target, and the permission that lets API Gateway invoke the function. The function's code is the `function.zip` from Example 4, uploaded to S3.

yaml

```
# cfn/template.yaml — the bundled Express app as one function behind an HTTP API (plain CloudFormation)
AWSTemplateFormatVersion: "2010-09-09"
Description: orders-api on Lambda (validated with cfn-lint, never deployed)

Parameters:
  CodeBucket:
    Type: String
  CodeKey:
    Type: String
    Default: orders-api/function.zip
  LayerKey:
    Type: String
    Default: orders-api/layer.zip

Resources:
  SharedLayer:
    Type: AWS::Lambda::LayerVersion
    Properties:
      LayerName: orders-shared
      CompatibleRuntimes:
        - nodejs24.x
      Content:
        S3Bucket: !Ref CodeBucket
        S3Key: !Ref LayerKey

  FunctionRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

  OrdersFunction:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: nodejs24.x
      Handler: index.handler
      Role: !GetAtt FunctionRole.Arn
      MemorySize: 512
      Timeout: 10
      Layers:
        - !Ref SharedLayer
      Code:
        S3Bucket: !Ref CodeBucket
        S3Key: !Ref CodeKey

  HttpApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: orders-api
      ProtocolType: HTTP
      Target: !GetAtt OrdersFunction.Arn

  InvokePermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !Ref OrdersFunction
      Principal: apigateway.amazonaws.com
      SourceArn: !Sub "arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${HttpApi}/*"

Outputs:
  ApiUrl:
    Value: !GetAtt HttpApi.ApiEndpoint
```

`cfn/template-broken.yaml` is the same file with two deliberate mistakes: `Runtime: nodejs24` (missing `.x`) and `Timeout: 1000`.

bash

```
$ cfn-lint --version
cfn-lint 1.57.2
$ cfn-lint cfn/template.yaml; echo "exit=$?"
exit=0
$ cfn-lint cfn/template-broken.yaml; echo "exit=$?"
E3030 'nodejs24' is not one of ['dotnet10', 'dotnet6', … 'nodejs22.x', 'nodejs24.x', 'nodejs26.x', … 'ruby4.0']
cfn/template-broken.yaml:42:7

E3717 1000 is greater than the maximum of 900 for functions without 'CapacityProviderConfig' (Lambda Managed Instances)
cfn/template-broken.yaml:46:7

exit=2
```

cfn-lint's runtime list includes `nodejs24.x` and `nodejs26.x`, matching the AWS runtimes page. Its Timeout rule knows the 900-second (15-minute) maximum for ordinary functions.

**Edge case found while validating: a SAM template that "passes" without being checked.** The first version of this example was a SAM template (`Transform: AWS::Serverless-2016-10-31`, `AWS::Serverless::Function`) with the same two mistakes. cfn-lint reported nothing and exited 0:

bash

```
$ cfn-lint sam/template-broken.yaml; echo "exit=$?"
exit=0
```

Run with `-D`, cfn-lint logged the "Transformed template" still containing `AWS::Serverless::Function`. The result was the same after installing `aws-sam-translator` 1.114.0 into the same environment: both mistakes passed, exit 0. The reason is in cfn-lint's own source (`cfnlint/template/transforms/transform.py` in 1.57.2), which no longer runs the SAM transform:

text

```
# Merge SAM Globals into resources before validation.
# This replaces the full SAM transform — we validate the
# SAM template directly using SAM schemas instead.
```

In this version, the SAM-level checks did not cover `Runtime` or `Timeout` on `AWS::Serverless::Function`, which the CloudFormation-level rules E3030 and E3717 catch on `AWS::Lambda::Function`. If you write SAM, keep a deliberately broken template in CI to see what your linter version actually checks.

> ⚠️ Unverified: whether other cfn-lint versions, or the AWS SAM CLI (not installed here), check these SAM properties.

> ⚠️ Unverified: that this template deploys. It was validated with cfn-lint 1.57.2 only; no `aws cloudformation deploy` was run, and nothing called AWS.

## Common mistakes & gotchas

- **Doing per-request work at module scope, or per-environment work in the handler.** A request ID or user stored in a module-scope variable leaks into the next request on that warm environment (Example 2). Creating the SDK client or DB pool inside the handler pays its connection cost on every invocation.
- **A normal-sized DB pool per function.** Each environment serves one request at a time, so `max: 10` per environment multiplies connections without adding throughput. Keep the pool at 1–2 and use a proxy or a pooler in front of the database.
- **Writing a callback handler on `nodejs24.x`.** Callback handlers are supported only up to Node 22. Use `async (event, context)`.
- **Background work after `return`.** Once the handler returns, the environment can be frozen, so a fire-and-forget `fetch()` or log flush may never finish, or may finish during a later invocation. `await` it before returning.
- **Assuming a shutdown hook.** With no extensions, the Shutdown phase lasts 0 ms. Do not rely on `SIGTERM` handlers to flush data on Lambda. On ECS, Render and Fly you do get a signal, and lesson 102's handler applies. On Fly the default `kill_signal` is SIGINT, so handle both signals.
- **ESM bundles of CommonJS dependencies without a `require` shim.** The build succeeds and every cold start crashes (Example 5).
- **Trusting `queryStringParameters` for repeated keys.** In format 2.0, `?tag=a&tag=b` arrives as `"a,b"`, and a single value `"a,b"` looks the same. Parse `rawQueryString` when it matters.
- **Mixing payload formats.** Adapters detect the event version. A test event in 1.0 shape against a 2.0 integration (or the reverse) passes locally and fails in AWS. Build test events from the docs sample for the format you configure.
- **`express.static()` on Vercel.** The Vercel Express guide says it "will be ignored". Static files go in `public/**`.
- **Unbounded `engines` ranges on Render.** `>=20` "always resolves to the latest release of Node.js", which moves to a new major on its own.

## Best practices

- **Keep the handler thin.** Parse the event, call your service code, map the result. The same service code can then run under Express, a queue consumer or a test.
- **Create clients once, at module scope,** with keep-alive on, and retry once on a reset connection.
- **Bundle with esbuild for Lambda,** target `node24`, run the bundle locally before uploading, and keep a size budget (`--analyze`).
- **Keep the Init phase short and deterministic:** no slow network calls at the top level; load rare paths with `await import()`.
- **Test with real event shapes:** copy the sample from the AWS docs for each trigger (HTTP API 2.0, SQS, S3) and invoke the handler directly in unit tests, as Examples 1–3 do.
- **On container platforms, reuse lesson 102 unchanged:** handle SIGTERM and SIGINT, drain, and exit before the platform's timeout (ECS `stopTimeout` 30 s by default, Render's shutdown delay 30 s by default, Fly `kill_timeout` 5 s by default).
- **Validate templates in CI** (cfn-lint for CloudFormation and SAM) so a typo in `Runtime` fails the build, not the deploy. With SAM templates, cfn-lint 1.57.2 missed a bad `Runtime` and `Timeout` (Example 7), so keep a deliberately broken template in the suite.
- **Choose by workload shape:** spiky, event-driven, short requests suit Lambda. Steady traffic, WebSockets, long requests and connection-heavy database work suit a container service.

## ⭐ Interview lens

> **Q: “What is a Lambda cold start, and what can you do about it in Node?”**  
> A: It is the Init phase for a new execution environment: Lambda starts extensions and the runtime, then loads your module and runs its top-level code, before the first handler call. You cannot avoid it for the first request on each environment, but you control your own share: bundle so there are fewer files to read, avoid slow top-level work, and lazy-load rare paths. If latency must be flat, buy provisioned concurrency. SnapStart does not support Node. *Trap:* "keep it warm with a ping" only keeps one environment warm; concurrent requests still create new ones.

> **Q: “Why create the database client outside the handler?”**  
> A: Module scope runs once per execution environment, during Init, and persists while the environment is reused. A client created there keeps its connection across warm invocations. Inside the handler you would reconnect on every call. Because each environment handles one request at a time, the pool should be tiny (1–2), and many environments may exist, so you usually add a connection proxy in front of the database.

> **Q: “What does an API Gateway HTTP API event look like for Lambda?”**  
> A: Payload format 2.0: `version: "2.0"`, `routeKey`, `rawPath`, `rawQueryString`, `headers` with lowercase names and duplicates comma-joined, `queryStringParameters` (also comma-joined), a separate `cookies` array, `requestContext.http.method`, `body` as a string with `isBase64Encoded`. You return `{ statusCode, headers, cookies, body }`. If you return plain JSON with no `statusCode`, API Gateway assumes 200 and `application/json`.

> **Q: “Lambda, Fargate or a PaaS such as Render or Fly for an Express API?”**  
> A: Lambda when traffic is spiky or low and requests are short. Capacity follows requests one environment at a time, but you live with cold starts, one request per environment, no shutdown signal and a 15-minute cap. A container service (Fargate, Render, Fly) when traffic is steady, requests are long, you need WebSockets, or the app keeps many DB connections. There the app runs unchanged and you own graceful shutdown. Vercel sits between them: your Express app becomes one function, but with Fluid compute several invocations share an instance.

## Cheat-card

- **Handler (Node 24):** `export const handler = async (event, context) => …`; runtime `nodejs24.x`; callback handlers only up to Node 22; default Handler setting `index.handler`.
- **Lifecycle:** Init (≤ 10 s: extensions, runtime, your top-level code) → Invoke → freeze → reuse or shutdown (0 ms with no extensions).
- **One request per environment;** module scope persists across warm invocations; clients go outside the handler; pools stay at 1–2.
- **Cold-start levers:** bundle, slim top-level code, lazy `import()`, provisioned concurrency; no SnapStart for Node.
- **esbuild:** `--bundle --platform=node --target=node24 --format=esm` plus a `createRequire` banner, or `--format=cjs`; run the bundle locally first.
- **Layers:** zip with `nodejs/node_modules/…` at the root → `/opt/nodejs/node_modules`; up to 5; .zip functions only; mark layer packages `--external`.
- **HTTP API 2.0:** `rawPath`, `rawQueryString`, `requestContext.http.method`, `cookies[]`, comma-joined duplicates; response `{ statusCode, headers, cookies, body, isBase64Encoded }`.
- **Express on Lambda:** `serverlessExpress({ app })` from `@codegenie/serverless-express` 5.0.0 (needs Node ≥ 24), or `serverless-http` 4.0.0.
- **Containers:** ECS stop = SIGTERM then SIGKILL after `stopTimeout` (30 s default, 120 max); Render SIGTERM 60 s after cut-over, SIGKILL after 30 s; Fly SIGINT by default, 5 s `kill_timeout`.
- **Versions used:** Node v24.19.0, npm 11.17.0, Express 5.3.0, @codegenie/serverless-express 5.0.0, esbuild 0.28.2, cfn-lint 1.57.2; serverless-http 4.0.0 checked, not run.

---

## Learn More

- [Lambda runtimes (identifiers and deprecation dates) docs.aws.amazon.com](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
- [Define Lambda function handler in Node.js docs.aws.amazon.com](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html)
- [Understanding the Lambda execution environment lifecycle docs.aws.amazon.com](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)
- [Deploy Node.js Lambda functions with .zip file archives docs.aws.amazon.com](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
- [Working with layers for Node.js Lambda functions docs.aws.amazon.com](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-layers.html)
- [Create AWS Lambda proxy integrations for HTTP APIs (payload format 2.0) docs.aws.amazon.com](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html)
- [Architect for AWS Fargate for Amazon ECS docs.aws.amazon.com](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [@codegenie/serverless-express github.com](https://github.com/CodeGenieApp/serverless-express)
- [esbuild API: platform, format, banner esbuild.github.io](https://esbuild.github.io/api/)
- [Express on Vercel vercel.com](https://vercel.com/docs/frameworks/backend/express)
- [Render: deploys and zero-downtime deploys render.com](https://render.com/docs/deploys)
- [Fly.io app configuration (fly.toml) fly.io](https://fly.io/docs/reference/configuration/)
