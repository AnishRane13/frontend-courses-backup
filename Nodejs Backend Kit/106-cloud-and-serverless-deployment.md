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

## Say it in 30 seconds

A serverless function, here AWS Lambda, is code the platform starts when an event arrives, freezes between events, and may throw away at any time. You export one async function, the handler. The platform calls it with the event and a context object, and whatever you return is the response. Code at the top of the file runs once per environment, a small sandbox that holds the runtime and your loaded code, so a database client created there is reused on later calls to that same sandbox. The trade-off is the cold start: the first call that has to create a new environment is slower, and with no extensions you get no shutdown signal to flush work.

## Why it matters

Lessons 101 and 102 end with a container image and a process that shuts down cleanly. The next question is where that code runs, and the choice changes how you write it.

On a function platform such as AWS Lambda, there is no long-running server. The platform starts your code for an event, may freeze it, and may throw it away. Code at module scope runs once per environment, not once per request. A database pool of 10 connections per instance becomes 10 connections per concurrent request, because each concurrent request gets its own environment.

On a container platform such as ECS on Fargate, Render, or Fly, your Express app runs as it does on your laptop, but the platform stops it with a signal on every deploy. If the app ignores the signal, in-flight requests fail on every release.

On Vercel, which turns the app into functions, some Express features stop working. Vercel's docs say `express.static()` is ignored there.

None of these platforms can be tested from this machine. This lesson does what you can do before deploying: run the handler locally with the same event shape the platform sends, bundle it, and validate the deployment template. The rest comes from each platform's current docs and is marked as such.

## The concept, simply

A Lambda function is a module that exports one async function, the handler. Lambda calls it with two arguments. The event is what happened: an HTTP request, a queue message, or a file upload. The context is facts about this invocation: the request ID and how much time is left. Whatever the handler returns becomes the response.

Lambda runs that code inside an execution environment: a small isolated sandbox with the Node runtime and your code loaded. The first request that needs a new environment pays for creating it. That wait is the cold start. Later requests that land on the same environment reuse everything already loaded. That is a warm start. Each environment handles one request at a time. The AWS docs say: "For each concurrent request, Lambda provisions a separate instance of your execution environment."

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

A container service is the opposite model. You give the platform an image or a repo. It keeps several copies of your server running behind a load balancer, and on deploy it starts new ones, switches traffic, then sends the old ones a stop signal. Your Express app does not change. Your shutdown code from lesson 102 decides whether deploys drop requests.

## How it works

One invocation, from the AWS Lambda Developer Guide pages "Lambda execution environment lifecycle" and "Define Lambda function handler in Node.js":

1. An event arrives. Lambda looks for a frozen environment for this function version. If none is free, it creates one.
2. Init phase. Lambda starts extensions, bootstraps the runtime, and loads your module, which runs everything at the top of the file. The docs say: "The Init phase is limited to 10 seconds." If it does not finish, Lambda retries it during the first invocation, under the function's own timeout.
3. Invoke phase. The runtime calls the exported handler. The Handler setting names the file and the export, separated by a dot. The default is `index.handler`, the `handler` export of `index.js` or `index.mjs`.
4. The handler returns, or its promise resolves. That value is the response. If the handler throws, the invocation fails.
5. Lambda freezes the environment. Timers and open sockets stop. Module-scope variables keep their values.
6. A later event may thaw the same environment and go straight to step 3. Or Lambda may shut the environment down. With no extensions, the Shutdown phase has a 0 ms limit, so your code gets no signal to clean up.

On Node 24 the runtime identifier is `nodejs24.x`. Only async handlers are supported. The AWS docs say: "Callback-based function handlers are only supported up to Node.js 22. Starting from Node.js 24, asynchronous tasks should be implemented using async function handlers." The shape is:

javascript

```
export const handler = async (event, context) => {
  return { statusCode: 200, body: 'ok' };
};
```

The `context` object carries `awsRequestId`, `functionName`, `functionVersion`, `memoryLimitInMB`, and `getRemainingTimeInMillis()`, which returns "the number of milliseconds left before the execution times out". `context.callbackWaitsForEmptyEventLoop` only applies to callback handlers, so on Node 24 it does nothing for you.

The Init phase is your import graph plus whatever you do at module scope. It gets longer with a large `node_modules` tree read file by file, a top-level `await` on a slow network call, or SDK clients for services you rarely use. You shorten your share of it by bundling (Example 4; the AWS packaging page says esbuild or rollup "results in improved performance due to the reduction in I/O operations"), by loading rare code with `await import()` on the path that needs it, or by paying for provisioned concurrency: pre-initialised environments that are "ready to respond immediately to incoming function requests". The concurrency docs say "interactive workloads benefit the most". SnapStart, which snapshots a started environment, is not available for Node. Its page lists "Java 11 and later, Python 3.12 and later, .NET 8 and later".

Module scope survives warm invocations, so the AWS handler guide puts SDK clients outside the handler: "This causes Lambda to run this code during the initialization phase, and the client is preserved for reuse across multiple invocations." The same applies to a database pool or an `undici` agent. Example 2 shows it locally: one loaded module keeps its counter and client, and a second module instance starts from zero. Because one environment handles one request at a time, a `pg` pool with `max: 10` opens connections that are never used together, and 200 concurrent requests mean 200 environments. Keep `max` at 1 or 2, and put a proxy such as Amazon RDS Proxy or a pooler such as PgBouncer in front of the database (lesson [46](74-connection-pooling.md)). Idle sockets go stale. The AWS best-practices list warns: "Lambda purges idle connections over time. Attempting to reuse an idle connection when invoking a function will result in a connection error." Use keep-alive and retry once on a reset. Node's `http.globalAgent` has used keep-alive by default since v19.0.0.

Lambda accepts a .zip of your code. You can zip `node_modules` as it is, or bundle into one file with esbuild. Example 4 did the second: 66 production packages, 4.5 MB on disk, became one 811 KB file, 277 KB zipped. `--platform=node --target=node24` keeps Node built-ins such as `node:http` and `util` as imports. `--format=esm` needs a `require` shim when the bundled packages are CommonJS (Example 5).

A layer is a separate .zip that Lambda "extracts … into the `/opt` directory". For Node, packages must sit under `nodejs/node_modules` or `nodejs/nodeXX/node_modules`. The docs allow "up to five layers per function", and only for .zip functions, not container images. Layers suit native binaries, shared packages, and extensions. If you also bundle with esbuild, mark a layer package `--external:<name>`, or esbuild copies it into the bundle anyway.

An API Gateway HTTP API turns each HTTP request into a Lambda event. You choose the payload format on the integration. The console defaults to the latest. With the AWS CLI, CloudFormation, or an SDK, "you must specify a `payloadFormatVersion`". The values are `1.0` and `2.0`. Format 2.0, the sample in Example 1, copied from the AWS docs:

- Request line: `requestContext.http.method`, `rawPath`, `rawQueryString`.
- Headers and query: `headers` and `queryStringParameters`, with duplicates "combined with commas". There is no `multiValueHeaders` in 2.0.
- Cookies: a separate `cookies` array.
- Body: `body` is a string, and `isBase64Encoded` tells you whether to decode it.
- Response: `{ statusCode, headers, cookies, body, isBase64Encoded }`. If the function returns valid JSON with no `statusCode`, API Gateway assumes status 200, `content-type: application/json`, and uses the return value as the body.

Two maintained adapters turn those events into Node `req` and `res` and back. Both were checked on 12 Oct 2026:

| Package (version checked) | `engines` | Notes |
|---|---|---|
| `@codegenie/serverless-express` 5.0.0 | `node >=24` | The former `aws-serverless-express`; its README says that package "will be deprecated in favor of @codegenie/serverless-express". Supports API Gateway v1 and v2, ALB, Lambda@Edge and VPC Lattice. Used in Example 3. |
| `serverless-http` 4.0.0 | `node >=12.0` | Not run in this lesson. Release dates are in Good to know. |

The adapter is created once, at module scope, so the Express app is built during Init and reused by every warm invocation.

ECS on Fargate, from the Amazon ECS Developer Guide, and none of it was run here. A task definition lists the image, CPU, memory, ports, environment, health check, and `stopTimeout`. A service keeps `desiredCount` copies running, optionally behind a load balancer, and replaces them on deploy. Fargate is the launch type with no servers to manage: "Each Fargate task has its own isolation boundary and does not share the underlying kernel, CPU resources, memory resources, or elastic network interface with another task." Tasks use the `awsvpc` network mode. For a Node app, three settings touch your code. `maximumPercent` (default 200% for a REPLICA service) and `minimumHealthyPercent` bound how many tasks may run during a deploy, the same role as `maxSurge` and `maxUnavailable` in lesson [109](105-kubernetes-for-node-developers.md). ECS sends the image's `STOPSIGNAL`, "default to SIGTERM", then SIGKILL after `stopTimeout` (default 30 seconds, maximum 120). Your forced-exit timer from lesson [66](102-graceful-shutdown-monitoring.md) must be shorter. `healthCheckGracePeriodSeconds` (default 0) ignores failing load-balancer checks while a slow task warms up. The image is the one from lesson 101 (`node:24-slim`, non-root user).

Vercel, Render, and Fly, from each platform's docs, read on 12 Oct 2026. Nothing was deployed, and pricing is left out on purpose. Say the row that matches the question: what runs the process, which port it binds, how it is stopped, and what differs from your laptop.

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

`npx esbuild --version` printed `0.28.2`. The install-script warning is in Good to know.

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

The adapter detected the 2.0 event, built `req.params`, `req.query`, and the JSON body, and returned the 2.0 shape, moving `Set-Cookie` into the `cookies` array. The empty POST arrived with `req.body` undefined, as Express 5 does, and the `?? {}` guard made a 400. The thrown async error reached the error handler and became a 500. Without that handler, Express renders an HTML error page, and the first `invoke.mjs` failed with `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

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

`import-time.mjs` times `await import(file)` in a fresh Node process, 10 runs, and prints the median. The laptop was an Intel i5-1135G7 shared with other jobs, so the load changed between runs:

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

The medians moved by about a third between runs and did not follow the load average. In both runs the bundle loaded faster than the `node_modules` tree. This is a warm file cache on a laptop, not a Lambda cold start, which also creates the environment and starts the runtime. The four medians are listed in Good to know.

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

The template is plain CloudFormation: an IAM role, the function, the layer from Example 6, an HTTP API with a quick-create Lambda target, and the permission that lets API Gateway invoke the function. The function's code is the `function.zip` from Example 4, uploaded to S3.

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

- **Per-request data at module scope, or a new client inside the handler.** A user or request id stored on the module leaks into the next request on that warm environment (Example 2). A client created inside the handler reconnects on every call.
- **A normal-sized pool per function.** One environment serves one request at a time, so `max: 10` multiplies connections. Keep the pool at 1 or 2 and put a proxy or pooler in front.
- **A callback handler on `nodejs24.x`.** Callback handlers stop at Node 22. Use `async (event, context)`.
- **Work after `return`.** The environment can freeze as soon as the handler returns, so a fire-and-forget `fetch()` or log flush may never finish, or may finish on a later invocation. Await it first.
- **Expecting SIGTERM on Lambda.** With no extensions, Shutdown is 0 ms. On ECS, Render, and Fly you do get a signal. Fly's default `kill_signal` is SIGINT, so handle both.
- **An ESM bundle of CommonJS packages with no `require` shim.** The build succeeds and every cold start crashes (Example 5).
- **Trusting `queryStringParameters` for repeated keys.** In format 2.0, `?tag=a&tag=b` arrives as `"a,b"`, and a real value `"a,b"` looks the same. Parse `rawQueryString` when it matters.
- **A 1.0 test event against a 2.0 integration.** Adapters detect the shape. Build the event from the docs sample for the format you configure.
- **`express.static()` on Vercel.** The Express guide says it "will be ignored". Put files in `public/**`.
- **An unbounded `engines` range on Render.** `>=20` "always resolves to the latest release of Node.js".

## Best practices

- **Keep the handler thin.** Parse the event, call service code, map the result, so the same code can run under Express, a queue, or a test.
- **Create clients once, at module scope,** with keep-alive on, and retry once on a reset connection.
- **Bundle for Lambda,** target `node24`, run the bundle locally, and check size with `--analyze`.
- **Keep Init short:** no slow network calls at the top level. Load rare paths with `await import()`.
- **Test with the docs' event shape** for each trigger, and call the handler directly, as Examples 1 to 3 do.
- **On containers, reuse lesson 102:** handle SIGTERM and SIGINT, drain, and exit before the platform timeout (ECS `stopTimeout` 30 s, Render shutdown delay 30 s, Fly `kill_timeout` 5 s).
- **Lint templates in CI.** cfn-lint 1.57.2 caught a bad `Runtime` and `Timeout` on `AWS::Lambda::Function` and missed both on a SAM template (Example 7), so keep a deliberately broken SAM file in the suite.
- **Pick by shape.** Spiky, short, event-driven work suits Lambda. Steady traffic, WebSockets, long requests, and many database connections suit a container service.

## ⭐ Interview lens

> **Q: “What is a Lambda cold start, and what can you do about it in Node?”**  
> A: A cold start is the Init phase of a new execution environment. An event arrives, no frozen environment is free, so Lambda creates a sandbox, starts extensions, bootstraps the Node runtime, and loads your module. Everything at the top of the file runs then, before the first call to the handler. Later calls on that same environment skip Init. That is a warm start. You cannot remove the first cold start on each environment, but you control how long your part takes. Bundle with esbuild so Lambda reads one file instead of a `node_modules` tree. In this lesson, 66 production packages, 4.5 MB on disk, became an 811 KB file, 277 KB zipped. Do not await a slow network call at the top level, and load rare paths with `await import()`. If the first request must be as fast as the rest, use provisioned concurrency, which keeps environments already initialised. SnapStart, the snapshot feature, does not support Node. Its page lists Java, Python, and .NET. A timer that pings one environment does not help when many requests arrive together, because each concurrent request gets its own environment.

> **Q: “Why create the database client outside the handler?”**  
> A: The handler runs on every event. Code at the top of the file runs once, during Init, and those variables stay while Lambda freezes and thaws that environment. The AWS handler guide says putting the client there "causes Lambda to run this code during the initialization phase, and the client is preserved for reuse across multiple invocations." Example 2 shows the same thing locally. One loaded module keeps its counter and its client object, and a second module instance, standing in for a second environment, starts from zero. If you construct the client inside the handler, you pay the connection on every call. The limit is the pool. One environment handles one request at a time, so `max: 10` opens connections that never run together, and 200 concurrent requests mean 200 pools. Keep `max` at 1 or 2 and put something like RDS Proxy or PgBouncer in front. Lambda also drops idle connections, so turn keep-alive on and retry once if a socket was reset. Do not store a user or a request id in that same module-scope variable. The next request on the environment would see it.

> **Q: “What does an API Gateway HTTP API event look like for Lambda?”**  
> A: Payload format 2.0 is the JSON an HTTP API sends to your handler. The method is `requestContext.http.method`, the path is `rawPath`, and the query string is still there as `rawQueryString`. Headers are lower case. If the same header or query key appears twice, the values are joined with a comma, and there is no `multiValueHeaders` field. Cookies are their own array. The body is a string, and `isBase64Encoded` tells you whether to decode it. You return `{ statusCode, headers, cookies, body, isBase64Encoded }`. In Example 1, `parameter1=value1&parameter1=value2` arrived as the single string `value1,value2`. If a real value can contain a comma, parse `rawQueryString` yourself, because you cannot tell them apart. If you return plain JSON with no `statusCode`, API Gateway assumes 200 and `application/json`. The limit of a local test is the format. A 1.0 event against a 2.0 integration can pass in your harness and fail in AWS, so copy the sample for the format you configure.

> **Q: “Lambda, Fargate or a PaaS such as Render or Fly for an Express API?”**  
> A: Lambda fits spiky or low traffic and short requests. Capacity follows the requests, one environment per concurrent call, and you do not run a server. You live with cold starts, one request per environment, no shutdown signal when there are no extensions, and a timeout cap of 900 seconds, which is 15 minutes. cfn-lint's rule E3717 enforces that maximum. A container service, Fargate, Render, or Fly, fits steady traffic, long requests, WebSockets, or an app that holds many database connections. The Express process runs as it does on your laptop. On deploy the platform sends a stop signal. ECS sends SIGTERM, then SIGKILL after `stopTimeout`, default 30 seconds, maximum 120. Render sends SIGTERM 60 seconds after the new instance takes traffic, then SIGKILL after a shutdown delay that defaults to 30 seconds. Fly's `kill_signal` is SIGINT by default, and `kill_timeout` defaults to 5 seconds. Your shutdown handler has to finish before that. Vercel sits between them. The docs say the Express app becomes one function, and Fluid compute lets several invocations share one instance, but `express.static()` is ignored. Nothing here was deployed, so those timings are from the docs, not from a measured shutdown.

## Cheat-card

- **Handler (Node 24):** `export const handler = async (event, context) => …`; runtime `nodejs24.x`; callback handlers only up to Node 22; default Handler setting `index.handler`.
- **Lifecycle:** Init (at most 10 s: extensions, runtime, your top-level code), then Invoke, then freeze, then reuse or shutdown (0 ms with no extensions).
- **One request per environment.** Module scope persists across warm invocations. Clients go outside the handler. Pools stay at 1 or 2.
- **Cold-start levers:** bundle, slim top-level code, lazy `import()`, provisioned concurrency. No SnapStart for Node.
- **esbuild:** `--bundle --platform=node --target=node24 --format=esm` plus a `createRequire` banner, or `--format=cjs`. Run the bundle locally first.
- **Layers:** zip with `nodejs/node_modules/…` at the root, which lands in `/opt/nodejs/node_modules`. Up to 5. Zip functions only. Mark layer packages `--external`.
- **HTTP API 2.0:** `rawPath`, `rawQueryString`, `requestContext.http.method`, `cookies[]`, comma-joined duplicates. Response `{ statusCode, headers, cookies, body, isBase64Encoded }`.
- **Express on Lambda:** `serverlessExpress({ app })` from `@codegenie/serverless-express` 5.0.0 (needs Node 24 or newer), or `serverless-http` 4.0.0.
- **Containers:** ECS stops with SIGTERM then SIGKILL after `stopTimeout` (30 s default, 120 max). Render sends SIGTERM 60 s after cut-over, then SIGKILL after 30 s. Fly uses SIGINT by default and a 5 s `kill_timeout`.
- **Versions used:** Node v24.19.0, Express 5.3.0, @codegenie/serverless-express 5.0.0, esbuild 0.28.2, cfn-lint 1.57.2. serverless-http 4.0.0 was checked, not run.

## Good to know

- AWS runtimes table on 12 Oct 2026: `nodejs24.x` deprecation listed as Apr 30, 2028, "subject to change"; `nodejs26.x` was a public preview that "should not be used for production workloads".
- npm 11.17.0 printed `npm warn allow-scripts esbuild@0.28.2 (postinstall: node install.js)` and skipped the install script; the `@esbuild/linux-x64` optional dependency still arrived, and `npx esbuild --version` printed `0.28.2`.
- Laptop import medians on an Intel i5-1135G7, warm file cache, not a Lambda cold start: first run `lambda.mjs` 118.5 ms and `dist/index.mjs` 79.6 ms (load average about 6.5); 40 minutes later 78.4 ms and 59.2 ms (load average about 9.7).
- Adapter dates checked 12 Oct 2026: `@codegenie/serverless-express` 5.0.0 released and last committed 16 Apr 2026, `engines` `node >=24`; `serverless-http` 4.0.0 released 1 Sep 2025, last commit 7 Sep 2026, `engines` `node >=12.0`, not run here.
- cfn-lint 1.57.2 was installed without root into a venv under `~/.cache` (`python3 -m venv --without-pip`, then pip from `get-pip.py`). On the broken template it exited 2 (E3030 for runtime `nodejs24`, E3717 because timeout 1000 is over the 900 second maximum). The same two mistakes in a SAM template exited 0, including after `aws-sam-translator` 1.114.0, because this cfn-lint no longer runs the full SAM transform.

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
