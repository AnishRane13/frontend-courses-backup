---
title: "Error Handling Patterns"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/error-handling-patterns
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Error Handling Patterns

*11 min read · Updated 24 Jul 2026 Topic 53 of 70 Bookmark Mark done Why it matters Every non · Topic 53 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/error-handling-patterns](https://www.geekyfrontend.in/learn/nodejs-backend-kit/error-handling-patterns)

---

## Say it in 30 seconds

Error handling in Node means catching failures from four places, a throw, a rejected promise, an error-first callback, and an error event, and then deciding whether to recover or crash. Most of a service's life is the unhappy path, and a try catch only sees errors that are still on the current stack. Expected failures, such as a timeout or bad input, should be handled. Bugs should crash the process so a supervisor can restart it clean.

## Why it matters

A database timeout, a 502 from a payment gateway, garbage JSON, a downstream blip: that is the real code. The happy path is the small part. Node makes this harder than a synchronous language because errors travel on different channels, and each one is caught differently. A throw inside a callback that runs later is not caught by a try catch that has already returned.

## The concept, simply

An error is normally an instance of `Error`. It has `name`, such as TypeError, `message`, and `stack`. The stack is captured when the Error is constructed, not when it is thrown. Since ES2022 it can also carry a `cause`, so you can wrap a low-level error without losing the original.

![An Error object with its name, message, stack, cause and custom fields such as code and statusCode](assets/i50_01_c76af59d.svg)

An Error is an object with known fields. A subclass can add a code or an HTTP status and still keep the stack.

Two kinds matter. **Operational errors** are expected in a correct program: a timeout, a missing record, bad input, a full disk. You handle them: retry, return a 4xx, degrade. **Programmer errors** are bugs: reading a property of undefined, a wrong type, a forgotten await. You do not "handle" a bug. You fix it. Until then, the safe response is to crash and restart with clean state.

![Two columns contrasting operational errors handled gracefully against programmer errors that should crash and restart](assets/i50_02_ee5dc2c2.svg)

Recover from operational errors. Crash on programmer errors.

## How it works

Errors arrive on four channels. Mixing them up is most Node error bugs.

**1. Synchronous throw.** The error unwinds until the nearest try catch. That only works while you are still on that same call stack. Once control returns to the event loop, a timer, an I/O callback, a then continuation, the original try catch has already finished.

**2. Rejected promises.** An async function that throws returns a rejected promise. You catch it with try catch around an await in another async function, or with `.catch()`. await is what puts the rejection back on your current stack. That is why try catch around await works, and try catch around a bare callback does not.

**3. Error-first callbacks.** The Node habit is `callback(err, result)`. The first argument is an Error or null. Nothing in the language forces you to check err. That is why promises replaced most callbacks.

**4. Error events.** Streams, sockets, and servers report failure by emitting `error`. If nobody is listening, Node throws that as an uncaught exception and the process dies. Forgetting `stream.on('error', ...)` is a common crash.

The practical move is to **funnel everything into promises and one error boundary**. In an HTTP server that boundary is usually one error-handling middleware. Route handlers throw. The boundary picks the status code and writes the log.

## Code examples

A custom error stays a real Error, so it keeps a stack, and adds fields a handler can read.

javascript

```
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL', cause } = {}) {
    super(message, { cause });        // ES2022: preserves the original error
    this.name = this.constructor.name; // 'AppError' instead of generic 'Error'
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;         // this is an expected error, not a bug
    Error.captureStackTrace(this, this.constructor); // trim ctor from the stack
  }
}

class NotFoundError extends AppError {
  constructor(resource) {
    super(resource + ' not found', { statusCode: 404, code: 'NOT_FOUND' });
  }
}

const err = new NotFoundError('User');
console.log(err instanceof Error, err.statusCode, err.code); // true 404 NOT_FOUND
```


Why try catch misses an async error, and the two ways to catch it. This is the idea the rest of the topic hangs on.

javascript

```
// BROKEN: the throw happens on a LATER tick, after try/catch returned.
try {
  setTimeout(() => {
    throw new Error('boom'); // uncaught — crashes the process
  }, 10);
} catch (e) {
  console.log('never runs'); // the stack here is long gone
}

// FIX A: promisify, then await so the error re-enters this stack.
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
async function run() {
  try {
    await delay(10);
    throw new Error('boom');
  } catch (e) {
    console.log('caught:', e.message); // 'caught: boom'
  }
}
run();
```


`cause` lets you throw a useful message at this layer and still keep the root failure.

javascript

```
import { readFile } from 'node:fs/promises';

async function loadConfig(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    // Add context; keep the original error reachable via err.cause
    throw new AppError('Failed to load config at ' + path, {
      code: 'CONFIG_LOAD', cause,
    });
  }
}

try {
  await loadConfig('/nope.json');
} catch (e) {
  console.log(e.message);       // Failed to load config at /nope.json
  console.log(e.cause.code);    // 'ENOENT' — the underlying fs error survives
}
```


One Express error middleware. Handlers stay small. Every error lands here and is treated as operational or unknown.

javascript

```
// Route: just throw. No local error plumbing. This relies on Express 5, which forwards
// async rejections to the error boundary; on Express 4 wrap the handler with an
// asyncHandler (see the Express error-handling topic) or the process crashes.
app.get('/users/:id', async (req, res) => {
  const user = await db.users.find(req.params.id);
  if (!user) throw new NotFoundError('User');
  res.json(user);
});

// Central boundary — the LAST middleware, with 4 args.
app.use((err, req, res, next) => {
  const operational = err.isOperational === true;
  req.log.error({ err, requestId: req.id }, 'request failed');
  res.status(operational ? err.statusCode : 500).json({
    code: operational ? err.code : 'INTERNAL',
    message: operational ? err.message : 'Something went wrong',
  });
  // Unknown (non-operational) errors mean our state may be corrupt.
  // Log, respond, and let a crash policy decide whether to exit.
});
```


## Common mistakes & gotchas

- **Expecting try catch to catch every async error.** It catches synchronous throws on this stack, and rejections you await. A throw inside setTimeout, an event callback, or a promise you did not await escapes it.
- **Throwing a string or a plain object.** No stack, and `instanceof Error` fails. Throw an Error.
- **Empty catch.** Swallowing turns a failure into silent wrong behavior. Handle it or rethrow.
- **No error listener on a stream or emitter.** The emitted error becomes an uncaught exception.
- **A subclass that never sets `name`.** Logs say Error for every type.
- **Wrapping and dropping the original.** Use the `cause` option.
- **Treating a bug as operational.** Catching your own TypeError and returning 400 hides corruption and keeps a bad process serving.
- **Returning from a promise catch when you meant to rethrow.** The chain then succeeds with undefined.

## Best practices

- **Throw Error or a subclass,** never a string or a plain object.
- **A small set of domain errors,** such as validation, not found, and auth, with `statusCode`, `code`, and `isOperational`.
- **Mark operational versus programmer,** and let that decide recover or crash.
- **async/await with one boundary,** instead of a catch on every call. One place maps errors to responses and logs.
- **Chain context with `cause`** so the top log shows the business message and the root failure.
- **Promisify old callback APIs** with `node:util` `promisify`, so failures arrive as rejections.
- **Add an error handler the moment you create a stream, socket, or server.**
- **Do not send internal messages or stacks to clients.** Return a generic message and a code. Log the detail with a request id.

## ⭐ Interview lens

> **Q: "Why doesn't `try/catch` catch an error thrown inside a `setTimeout` callback?"**  
> A: try catch only guards the synchronous stack it wraps. setTimeout registers a callback and returns immediately, so the try block has finished before the callback ever runs. When the timer fires, that throw has no try frame above it, and it becomes an uncaught exception. The same is true of a promise you do not await, and of an error event with no listener. await is different because it pauses your async function and, if the promise rejects, resumes you inside the try. For example, try catch around `await readFile(...)` catches a missing file, and try catch around `setTimeout(() => { throw e }, 0)` does not. The limit is that awaiting is a choice at each call. One missing await anywhere in the chain puts you back in the uncaught path.

> **Q: "What is the difference between an operational error and a programmer error?"**  
> A: An operational error is an expected failure in a correct program: the database timed out, the id does not exist, the JSON was garbage. You handle it, with a retry, a 4xx, or a degraded response. A programmer error is a bug: a TypeError, a forgotten await, a broken invariant. You do not paper over a bug with a friendly response, because the process may already be inconsistent, a lock held, a structure half updated. The safe move is to log, exit, and let a supervisor start clean. For example, "user not found" is operational and should be a 404. "Cannot read property id of undefined" in your own handler is a bug. The limit of the split is honesty about which one you are looking at. Catching every Error and returning 400 turns bugs into quiet data corruption.

> **Q (trap): "So you should always use `process.on('uncaughtException')` to keep the server from crashing?"**  
> A: `uncaughtException` is a last-resort hook, not a way to keep serving. By the time it fires, an error escaped every boundary you wrote, and you do not know what state it left. A listener that only logs and returns disables Node's default, which is to print the stack and exit. The process then keeps accepting traffic with locks, transactions, or connections in whatever shape the throw left them. Use the hook to log, flush, and `process.exit(1)`, and let systemd, PM2, Docker, or Kubernetes start a new process. For example, a timeout you expected belongs in try catch inside the route. A TypeError that reached the process hook does not. The limit is that crash-only design needs a supervisor. A bare `node server.js` with no restarter just stays down.

> **Q: "What does the `cause` option do and why use it?"**  
> A: Streams, sockets, and servers are EventEmitters, and they report failure by emitting `error` instead of rejecting a promise. If you have not attached a listener, Node takes that error and throws it as an uncaught exception, which kills the process. Attach `stream.on('error', handler)` as soon as you create the stream, not later when you remember. For a pipeline, `pipeline()` from `node:stream` is the better tool because it forwards the error and destroys every stream in the chain for you. For example, a file read piped to a response with no error listener crashes the process when the file is missing. The same pipe wrapped in pipeline rejects, and your error middleware can turn it into a 500. The limit is that the listener has to exist before the error is emitted. An emitter does not buffer the way a promise does. Miss the subscription and the event is already fatal.

## Cheat-card

- **Four channels:** synchronous throw, rejected promise, error-first callback, `error` event.
- **try catch** catches synchronous throws and awaited rejections. It does not catch a bare async callback.
- **Operational** means expected, so handle it. **Programmer** means a bug, so crash and restart.
- **Custom error:** extend Error, set `name`, add `code`, `statusCode`, and `isOperational`.
- **Chain context** with `new Error(msg, { cause })`.
- Throw real Errors. Do not swallow. Add an `error` listener to every emitter.
- **One error boundary** turns errors into responses and logs.

## Good to know

- **What does the `cause` option do?** `new Error(msg, { cause })` attaches the original error as `err.cause`, so a higher-level message keeps the root failure and its stack instead of a hand-built string.
- **Why is throwing a string bad?** A string has no stack, no name, and fails `instanceof Error`, which middleware and libraries rely on. Throw an Error instance.

---

## Learn More

- [Errors (Node.js API) nodejs.org](https://nodejs.org/api/errors.html)
- [try...catch — JavaScript (MDN) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/try...catch)
- [Error Handling in NodeJS (Complete Guide) | Node Tutorial Nikita Dev](https://www.youtube.com/watch?v=mGPj-pCGS2c)
