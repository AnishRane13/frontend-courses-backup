---
title: "The http module & createServer"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/http-module
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# The http module & createServer

*10 min read · Updated 24 Jul 2026 Topic 30 of 70 Bookmark Mark done Why it matters Every web framework you have ever used in Node · Topic 30 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/http-module](https://www.geekyfrontend.in/learn/nodejs-backend-kit/http-module)

---

## Say it in 30 seconds

`http.createServer` builds a long-running server that listens on a TCP port, parses each request's start line and headers, and calls your function with a readable `req` and a writable `res`. Express, Fastify, Koa, and Nest sit on this module. They add routing. They do not replace it. The trade-off is that one thread runs every callback, the body is not in memory when the callback starts, and forgetting `res.end()` leaves the client hanging.

## Why it matters

Every web framework you use in Node is a wrapper around `node:http`. When a request arrives, `http.Server` accepted the TCP connection, parsed the bytes, and handed you `req` and `res`. Frameworks add routing and middleware on top of that.

The raw module is where a hung request, a leaked socket, or a response that never flushes actually shows up. Keep-alive, header limits, and streaming live here. "Build an HTTP server without Express" is a common screening question because it shows whether you know the platform.

## The concept, simply

An HTTP server listens on a TCP port. When a client sends a request, Node calls a function you supplied with two objects: the request, and a response you write the reply into. You do not poll. The event loop calls you each time a request arrives.

The server is an EventEmitter. The callback you pass to `createServer` is a listener for `'request'`. `req` and `res` are streams. `req` is readable, so the body arrives in chunks. `res` is writable, so you push bytes out. One event, two streams.

![Diagram of a request travelling from client to http.Server to your handler and a response travelling back](assets/i27_01_9768f8c5.svg)


## How it works

`http.createServer(requestListener)` returns an `http.Server`. `server.listen(port)` binds a socket. The OS hands new TCP connections to Node. Node reads bytes and feeds them to llhttp, the HTTP parser. When the start line and headers are complete, Node builds an `IncomingMessage` (`req`) and a `ServerResponse` (`res`) and emits `'request'`.

That event fires after the headers and before the body is read. The body may still be arriving. You listen for `'data'` and `'end'` on `req`, or you pipe it. A GET with no body fires `'end'` almost immediately.

Writing the response has three steps. Set the status and headers with `res.statusCode`, `res.setHeader`, or `res.writeHead`. Write the body with `res.write`, as many times as you need. Finish with `res.end`. Headers can only be set before the first body byte. After that they are on the wire, and changing them throws `ERR_HTTP_HEADERS_SENT`.

The server also emits `'connection'` for each new TCP socket, `'listening'` when the port is bound, `'close'` when it stops, and `'clientError'` when a request cannot be parsed. `createServer(fn)` is `new http.Server().on('request', fn)`.

![Diagram showing createServer emitting request, connection, close and error events](assets/i27_02_74703027.svg)


The callback runs once per request. There is no global "current request". Each call has its own `req` and `res`. Share state across requests in module scope. Keep one request's state inside that call.

HTTP/1.1 keep-alive is on by default, so one TCP socket can carry many requests. After `res.end()`, Node keeps the connection and the parser waits for the next start line on the same socket, then emits `'request'` again with a new pair. `'connection'` fires once per socket. `'request'` can fire many times on it. Put per-request work in `'request'`. Put per-connection work, such as a socket timeout, in `'connection'`. HTTP/1.1 has no request ids, so responses go back in the order the requests arrived. That is the head-of-line limit HTTP/2 removes.

Timeouts are the first defence against a slow client:

| Property | Default (v20/22) | What it guards |
| --- | --- | --- |
| `server.headersTimeout` | 60000 ms | Time to receive the whole header block. Stops a client that dribbles headers. |
| `server.requestTimeout` | 300000 ms | Time to receive the entire request, headers and body. |
| `server.keepAliveTimeout` | 5000 ms | How long an idle keep-alive socket waits for the next request. |
| `server.timeout` | 0 (off) | Inactivity on the socket once a request is in flight. |
| `server.maxHeadersCount` | 2000 | How many headers the parser will accept. |

## Code examples

The smallest server answers every request with plain text.

javascript

```
const http = require('node:http');

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Hello from raw Node
');
});

server.listen(3000, () => {
  console.log('Listening on http://localhost:3000');
});
```

The same server, written so you can see the callback is just an event listener, plus the hooks you use in production:

javascript

```
const http = require('node:http');

const server = http.createServer();

server.on('request', (req, res) => {
  console.log(req.method, req.url);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});

server.on('clientError', (err, socket) => {
  // Malformed request line/headers — parser could not build a req.
  socket.end('HTTP/1.1 400 Bad Request\r
\r
');
});

server.on('listening', () => console.log('up'));
server.listen(3000);
```

Streaming a response. `res` is a writable stream, so a large body goes out in chunks and is never held all at once:

javascript

```
const http = require('node:http');

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  let n = 0;
  const timer = setInterval(() => {
    res.write(`line ${++n}
`);
    if (n === 5) {
      clearInterval(timer);
      res.end('done
'); // flush + close
    }
  }, 200);

  // If the client disconnects mid-stream, stop working.
  res.on('close', () => clearInterval(timer));
}).listen(3000);
```

Graceful shutdown. `server.close()` stops new connections and lets in-flight requests finish:

javascript

```
const server = http.createServer(handler).listen(3000);

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('drained, exiting');
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
});
```

## Common mistakes & gotchas

- **Forgetting `res.end()`.** The client hangs until timeout and the socket stays open. Every path, including errors, ends the response once.
- **Setting headers after the body.** `setHeader` or `writeHead` after the first `write` throws `ERR_HTTP_HEADERS_SENT`.
- **Expecting the body inside the callback.** `'request'` fires before the body arrives. There is no `req.body` on the raw object. Read the stream.
- **Blocking the event loop.** A synchronous loop or `readFileSync` in the handler stalls every other request. One thread serves them all.
- **Ignoring backpressure.** `res.write()` returns `false` when the kernel buffer is full. Use `pipeline` or wait for `'drain'`.
- **Leaving the port open in tests.** Skip `server.close()` and the next run gets `EADDRINUSE`.

## Best practices

- **Import `node:http`** so the name cannot collide with an npm package.
- **Attach `'clientError'` and `'error'`** on the server. An unhandled server error crashes the process.
- **Set `requestTimeout`, `headersTimeout`, and `keepAliveTimeout`** on purpose, even where the defaults are already safer.
- **End the response on every branch**, including the error path.
- **Call `server.close()` on `SIGTERM`** so deploys finish in-flight work.
- **Cap the body and check headers** before you act on them.

## ⭐ Interview lens

> **Q: What does `http.createServer(fn)` actually do with `fn`?**  
A: `http.createServer(fn)` builds an `http.Server`, which is an EventEmitter, and registers `fn` as the listener for `'request'`. That is the same as `new http.Server().on('request', fn)`. Each incoming HTTP request calls `fn` with a new `req` and `res`. `req` is an `IncomingMessage`, a readable stream. `res` is a `ServerResponse`, a writable stream. The server has already parsed the start line and headers with llhttp before it calls you. The limit is the body. It is not sitting in a property when `fn` runs. You still have to read the stream, and you still have to call `res.end()` or the client waits.

> **Q: When exactly does the request callback fire — before or after the body arrives?**  
A: The callback runs after the request line and the headers are parsed, and generally before the body has all arrived. llhttp emits `'request'` as soon as the header block is complete, then the rest of the socket is the body. That is why `req` is a readable stream and you listen for `'data'` and `'end'`, or pipe it, to get the bytes. A GET with no body fires `'end'` almost at once, which hides the rule until the first POST. The limit of the wrong answer, "when the whole request is in memory", is a large upload. Waiting for the whole body before your function ran would buffer it for you, and Node refuses to do that.

> **Q: Why can't you call `res.setHeader()` after `res.write()`?**  
A: `res.write()` sends the status line and the headers first, then the chunk. Once those bytes are on the socket they cannot be changed. Node enforces that by throwing `ERR_HTTP_HEADERS_SENT` if you call `setHeader` or `writeHead` after the first `write` or after `writeHead`. You set `statusCode` and headers, then you write the body, then you `end`. The same lock applies if you stream a file with `pipeline` into `res`: the headers go out with the first chunk. The limit is a value you only know at the end, such as a checksum. That is a trailer, declared up front, not a header you set after `write`.

> **Q: Trap — if a request handler runs a 2-second synchronous loop, what happens to other clients?**  
A: Every other client waits. Node runs your request callbacks on one event-loop thread. A two-second synchronous loop, or `fs.readFileSync`, does not let the loop reach the next connection, the next timer, or the next `'request'`. Ten clients that arrived during those two seconds all see the delay. The work has to be async, or it has to move to a worker thread or another process. The limit is easy to miss in a test with one request. The handler returns a correct response, and the stall only shows up when someone else is waiting on the same process.

## Cheat-card

- `require('node:http')` or `import http from 'node:http'`. Nothing to install.
- `http.createServer(fn)` is `new http.Server().on('request', fn)`.
- `server.listen(port)` binds. `'listening'` fires when the port is ready.
- `req` is an `IncomingMessage` and a readable stream. `res` is a `ServerResponse` and a writable stream.
- The callback runs after headers, before the body. Read the body with `'data'` and `'end'`.
- Order: status and headers, then `res.write`, then `res.end`, exactly once.
- Headers are frozen after the first body byte (`ERR_HTTP_HEADERS_SENT`).
- Stop cleanly with `server.close()` on `SIGTERM`.
- One thread serves every request. Do not block it.

## Good to know

- Is `req` a stream, and what kind? Yes. `req` is readable. `res` is writable. That is what makes an upload and a download stream instead of buffer.
- How do you shut a server down without dropping in-flight requests? `server.close(callback)` stops accepting new connections and runs the callback when existing ones drain. Pair it with a forced-exit timer so one stuck keep-alive socket cannot hold the process.
- `http.request` and `http.get` are the client in this same module: a writable `ClientRequest` and a readable `IncomingMessage`. Global `fetch` is bundled undici (`process.versions.undici`), not `http.request`. Lesson 44 covers both. Two requests shared a connection when `req.socket.remotePort` matches.

## Learn More

- [HTTP | Node.js Documentation nodejs.org](https://nodejs.org/api/http.html)
- [Introduction to Node.js | Node.js Learn nodejs.org](https://nodejs.org/en/learn/getting-started/introduction-to-nodejs)
- [Overview of HTTP | MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Overview)
- [How to Create a Simple HTTP Server in Node.js | HTTP Module Basics ProgrammingKnowledge](https://www.youtube.com/watch?v=qNDUQ-hLeoE)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0*

### The client side: outbound requests

This lesson is the server half. The client half is your process opening a TCP connection, writing a request, and reading the response. `http.request` and `http.get` return a writable `ClientRequest` and give you the response as a readable `IncomingMessage`. Global `fetch` is the WHATWG API, implemented by undici bundled in Node, not by `http.request`. On v24.19.0, `process.versions.undici` is `7.29.0`. Both keep sockets and reuse them, so the server sees one `'connection'` and then several `'request'` events. Timeouts, retries, and the error codes are in lesson 44.

1. `fetch(url)` uses undici's global agent, one pool per origin, meaning scheme, host, and port.
2. With no idle socket, it opens a TCP connection. Your server emits `'connection'`, then `'request'`. `req.socket.remotePort` is the client's port for that connection.
3. `fetch` resolves when the headers arrive. `res.text()` resolves when the body is done.
4. The response carries `Connection: keep-alive` and `Keep-Alive: timeout=5`, from `server.keepAliveTimeout`, 5000 ms by default. The client puts the socket back in the pool.
5. `server.close()` stops accepting connections and, since v19.0.0, also closes idle keep-alive connections.

**Example: this lesson's server, called by `fetch`.**

javascript

```
const http = require('node:http');

// The smallest server from this lesson, on port 4830
const server = http.createServer((req, res) => {
  console.log(`server: ${req.method} ${req.url} from port ${req.socket.remotePort}`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Hello from raw Node\n');
});

server.listen(4830, async () => {
  // The client side: the built-in fetch (Node 18+), no npm install
  for (const path of ['/first', '/second']) {
    const res = await fetch(`http://localhost:4830${path}`);
    console.log('client:', res.status, res.headers.get('content-type'), '|',
      res.headers.get('connection'), res.headers.get('keep-alive'), '|', JSON.stringify(await res.text()));
  }
  server.close();   // since v19.0.0 this also closes idle keep-alive sockets, so the process exits
});

// Real output (Node v24.19.0):
//   server: GET /first from port 40580
//   client: 200 text/plain; charset=utf-8 | keep-alive timeout=5 | "Hello from raw Node\n"
//   server: GET /second from port 40590
//   client: 200 text/plain; charset=utf-8 | keep-alive timeout=5 | "Hello from raw Node\n"
```

The two requests came from two client ports, so `fetch` opened a second connection even though the first was kept alive. Client ports change every run.

### Common mistakes & gotchas (additional topics)

- **Expecting `fetch` to reject on a 404 or 500.** It resolves with `res.ok === false`. Only a network failure rejects, as `TypeError: fetch failed`, with the reason on `err.cause.code`.
- **Not reading the response body.** An unread body keeps the connection busy, so the next request waits or opens another socket. Read it, or call `res.body.cancel()`.
- **Expecting `http.Agent` settings to limit `fetch`.** They are separate pools. With `http.globalAgent.maxSockets = 1`, two concurrent `http.get` calls shared one client port, and two concurrent `fetch` calls used two.

### Edge case worked through: back-to-back `fetch` calls open a second connection

You would expect sequential requests, each awaited to the end, to reuse one keep-alive socket. `req.socket.remotePort` shows they do not:

javascript

```
const http = require('node:http');

const seen = new Map();   // client port -> connection number
const server = http.createServer((req, res) => {
  const p = req.socket.remotePort;
  if (!seen.has(p)) seen.set(p, seen.size + 1);
  console.log(`  ${req.url} on connection #${seen.get(p)}`);
  res.end('Hello from raw Node\n');
});

server.listen(4831, async () => {
  const url = 'http://127.0.0.1:4831';
  console.log('back to back (next fetch starts as soon as text() resolves):');
  for (const p of ['/a1', '/a2', '/a3', '/a4']) await (await fetch(url + p)).text();

  console.log('one setImmediate between requests:');
  for (const p of ['/b1', '/b2', '/b3']) {
    await (await fetch(url + p)).text();
    await new Promise((r) => setImmediate(r));
  }
  server.close();
});

// Real output (Node v24.19.0):
//   back to back (next fetch starts as soon as text() resolves):
//     /a1 on connection #1
//     /a2 on connection #2
//     /a3 on connection #1
//     /a4 on connection #2
//   one setImmediate between requests:
//     /b1 on connection #1
//     /b2 on connection #1
//     /b3 on connection #1
```

When `await res.text()` resolves, the body is delivered and the client has not yet returned the socket to the pool. The next `fetch` starts in that gap, finds no idle socket, and opens connection 2. After that the two sockets alternate. One `setImmediate` between requests is enough for the socket to return, and then the requests reuse connection 1. The same alternating pattern showed up with `undici.request()` from the npm package at 7.30.0. Harmless in a script. A loop of sequential calls holds two sockets where you expected one.

### ⭐ Interview lens (additional topics)

> **Q: “What is the difference between `http.request` and `fetch` in Node?”**  
A: `http.request` is the client built into `node:http`. You get a writable `ClientRequest`, you read a readable `IncomingMessage`, and an `http.Agent` reuses sockets. It has no promise API. `fetch` is the WHATWG function, implemented by undici that ships inside Node, with its own pool, promises, and web-stream bodies. On v24.19.0 that copy is undici 7.29.0. Neither treats 404 or 500 as a thrown error. `fetch` resolves and you check `res.ok`. `http.request` gives you the status on the response object. The limit is thinking `fetch` is a wrapper over `http.request`. They do not share a pool, and a setting on `http.globalAgent` does not cap `fetch`.

> **Q: “How can a server tell that two requests came over the same connection?”**  
A: Compare `req.socket.remotePort`, or keep a `WeakMap` keyed by `req.socket`. The same socket object and the same remote port mean the same keep-alive connection. `'connection'` fires once when that socket is accepted. `'request'` fires once per HTTP request on it, which is how one TCP connection carries many requests under HTTP/1.1. The lesson's `fetch` demo is the counterexample to "sequential awaits always reuse one socket". The body promise resolves a moment before the socket goes back to the pool, so the next call can open a second port. The limit is reading the port from the server and assuming it is the server's listen port. `remotePort` is the client's port.
