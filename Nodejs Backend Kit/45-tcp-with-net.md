---
title: "TCP with net: Sockets, Framing and a Chat Server"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# TCP with net: Sockets, Framing and a Chat Server

*20 min read · Updated 10 Oct 2026 · Topic 76 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

`node:net` gives you a TCP socket, which is a reliable ordered stream of bytes, and a server that accepts those connections. HTTP, Postgres, Redis, and a chat protocol all sit on that stream. The trade-off is that TCP does not keep your message boundaries. Two `write` calls can arrive as one `data` event, or one write can arrive as many chunks, so you have to frame messages yourself, and `write` returning false is the only sign to stop or the process will buffer without a limit.

## Why it matters

HTTP, PostgreSQL, Redis, MySQL, SMTP, and WebSocket all run on TCP. Under `http.createServer`, each request is a `net.Socket` that the HTTP parser reads. A database driver, a proxy, a custom protocol, or a test double for a TCP service uses that socket through `node:net`.

TCP gives you ordered bytes and nothing else. If the client writes `hello` and then `world`, the server might see one `data` event with `helloworld`, or `hel` and then `loworld`. Code that treats one `data` event as one message works on a quiet laptop and breaks under load, on a slow link, or when a message is larger than about 64 KiB. The other common breaks are ignoring `write` returning false, expecting `setTimeout` to close the socket, closing with `destroy` and losing queued bytes, and crashing on an unhandled `ECONNRESET`.

## The concept, simply

`node:net` has two classes.

`net.Server` is the listening socket. `server.listen(port, host)` asks the kernel to accept TCP connections. Each accepted connection emits `connection` with a new `net.Socket`.

`net.Socket` is one connection, from either side. `net.createConnection({ host, port })`, also called `net.connect`, starts the client's handshake. The server gets the same kind of object for its end.

A socket is a Duplex stream. The readable side is what the peer sent you. The writable side is what you send. The sides are independent, each with its own buffer and its own `highWaterMark`, 64 KiB by default. The readable side ends when the peer sends FIN, the `end` event. The writable side ends when you call `end()`, which sends your FIN. TCP allows a half-open connection, one direction closed and the other still carrying data.

![The four Node stream types; the Duplex panel shows a TCP socket with independent read and write channels](assets/i23_02_ec427c97.svg)
*Figure: Readable, Writable, Duplex and Transform streams. Look at: the Duplex panel, "TCP socket — two channels, in and out unrelated", which is exactly what a `net.Socket` is.*

Under the socket is a file descriptor that libuv watches with epoll on Linux, kqueue on macOS, or IOCP on Windows. Socket I/O does not use a thread-pool thread. When the kernel has bytes, libuv reads up to 64 KiB into a Buffer and the socket emits `data`. A write tries to hand bytes to the kernel send buffer and queues what does not fit.

## How it works

1. `server.listen(0, '127.0.0.1')` binds. Port 0 asks the kernel for a free port. Read it back from `server.address().port`. `listening` fires when the socket is ready.
2. The client resolves the host with `dns.lookup` (lesson 33), then sends SYN. The server's kernel finishes the handshake and queues the connection before Node calls `accept`.
3. libuv accepts it. The server emits `connection` with a `net.Socket`. The client emits `connect`, then `ready`.
4. `socket.write(data)` copies bytes toward the kernel. The peer reads whatever has arrived and emits `data` with a chunk from 1 byte up to 64 KiB. Write boundaries are not kept.
5. `socket.end()` sends FIN, meaning "I will write nothing more". The peer gets `end` on its readable side. With `allowHalfOpen: false`, the default, the peer then ends its own writable side on the next tick.
6. When both directions are finished, or someone calls `destroy()`, the descriptor closes and `close` fires once. `hadError` is true if an error caused it.

The handshake, the data, and the two ways to finish:

text

```
 client (net.connect)                                server (net.createServer)
   │ ── SYN ─────────────────────────────────────────► │  kernel: half-open queue
   │ ◄──────────────────────────────────── SYN+ACK ─── │
   │ ── ACK ─────────────────────────────────────────► │  kernel: accept queue
   │ 'connect'                                         │  'connection' (socket)
   │ ══ bytes in both directions, no message edges ═══ │  'data' chunks of any size
   │ ── FIN ─────────────────────────────────────────► │  client.end()  → server 'end'
   │ ◄──────────────── bytes still allowed (half-open) │  only if server allowHalfOpen
   │ ◄──────────────────────────────────────── FIN ─── │  server.end()  → client 'end'
   │ 'close' (hadError=false)                          │  'close' (hadError=false)

 abortive close instead of FIN:
   │ ── RST ─────────────────────────────────────────► │  resetAndDestroy()
   │                                                   │  'error' ECONNRESET, 'close' (hadError=true)
```

**Framing is your job.** A protocol on TCP has to mark where each message ends.

Length-prefixed: a fixed header holds the body length, often 4 bytes as an unsigned big-endian integer. The reader waits for the header, reads the length, then waits for that many body bytes. The body may contain any bytes. PostgreSQL's wire protocol is this shape: a 1-byte type, then a 4-byte length.

Delimiter: the message ends with a byte that cannot appear inside it, usually a newline, as in SMTP, IRC, and line-delimited JSON. The reader keeps the unfinished tail and puts it in front of the next chunk. Text only, unless you escape the delimiter.

Both readers need a buffer for leftover bytes, a loop that emits every complete message, and a maximum size, so a client that never sends the delimiter, or that claims a 4 GB length, cannot make you buffer forever. A text reader also needs a `StringDecoder`, because a chunk can end in the middle of a UTF-8 character.

text

```
 app writes:      write("alpha")      write("beta")      write("héllo")
 bytes on wire:   a l p h a b e t a h é é l l o           (é is 2 bytes; no edges)
 'data' events:   [a l p h a b e] [t a h é] [é l l o]     (any cut is possible)

 length-prefixed: [00 00 00 05] a l p h a [00 00 00 04] b e t a [00 00 00 06] h é é l l o
 line-delimited:  a l p h a \n b e t a \n h é é l l o \n
```

**Backpressure.** `socket.write()` returns true if the bytes fit in the kernel send buffer, and false if some had to be queued in Node and that queue is at or above `writableHighWaterMark` (64 KiB). The kernel buffers come first. On loopback the send buffer and the peer's receive buffer hold a few megabytes, so `write` stays true long after the reader stopped. Once those are full, further writes grow `socket.writableLength`, the bytes queued in Node. `write` never refuses data. If you keep going after false, memory grows without a limit. Stop on false and continue on `drain`. `pipe` and `pipeline` do this.

![A fast readable pushes into a slow writable; write() returns false, the source pauses, the buffer empties, 'drain' fires and the source resumes](assets/i26_01_e8e417ed.svg)
*Figure: the backpressure loop between a fast producer and a slow sink. Look at: the `write() → false` → pause → `'drain'` → resume cycle; on a socket the "slow sink" is the network plus the peer that is not reading.*

**Closing.** `end()` sends FIN after every queued byte, so the peer receives all of it. `destroy()` closes the descriptor now and drops bytes still queued in Node. The kernel sends FIN for what it already holds. `resetAndDestroy()` sends RST. The peer gets `ECONNRESET`, and data still in the kernel buffers is discarded too. With `allowHalfOpen: false`, a socket that receives FIN ends its writable side on the next tick. Set `allowHalfOpen: true` when you must reply after the peer has finished sending, for example a client that signals "end of request" with `end()`.

**Timeouts and keepalive are different.** `socket.setTimeout(ms)` is a Node timer that restarts on every read or write. When it fires, the socket emits `timeout` and nothing else happens. The connection stays open until you `end` or `destroy`. `socket.setKeepAlive(true, initialDelay)` sets kernel options so the kernel sends probes on an idle connection and reports it dead if the probes go unanswered. That finds a peer that vanished. It is not how you close idle clients.

**Nagle.** By default the kernel holds small writes while earlier data is unacknowledged, and merges them. `socket.setNoDelay(true)` sends each write as soon as it can. That lowers latency for small interactive messages. It does not preserve message boundaries. The receiver can still merge or split segments.

**Errors.** A socket emits `error` and then `close` with `hadError === true`. With no `error` listener, the error is thrown and the process can crash. `ECONNREFUSED` means nothing was listening and the peer answered with RST. `ECONNRESET` means the peer reset an open connection. `ETIMEDOUT` means the kernel gave up on the handshake or on keepalive probes. `EPIPE` means you wrote after the peer had closed. A clean close is `end` and then `close` with `hadError === false`.

## Code examples

**Example 1 — a server, a client, and the socket as a Duplex.**

javascript

```
import net from 'node:net';
import { Duplex } from 'node:stream';

// Server: uppercase every chunk it receives and send it back.
const server = net.createServer((socket) => {
  console.log('server: connection from', socket.remoteAddress);
  console.log('server: socket is a Duplex?', socket instanceof Duplex);
  socket.on('data', (chunk) => socket.write(chunk.toString().toUpperCase()));
  socket.on('end', () => console.log('server: client sent FIN'));
});

server.listen(0, '127.0.0.1', () => {          // port 0: the OS picks a free port
  const { port } = server.address();

  const client = net.createConnection({ port, host: '127.0.0.1' }, () => {
    console.log('client: connected, readyState =', client.readyState);
    client.write('hello over tcp');
  });
  client.setEncoding('utf8');
  client.on('data', (text) => {
    console.log('client: got', JSON.stringify(text));
    client.end();                       // send FIN: "I have nothing more to write"
  });
  client.on('close', (hadError) => {
    console.log('client: closed, hadError =', hadError);
    server.close(() => console.log('server: closed'));
  });
});

// Real output (Node v24.19.0):
//   server: connection from 127.0.0.1
//   server: socket is a Duplex? true
//   client: connected, readyState = open
//   client: got "HELLO OVER TCP"
//   server: client sent FIN
//   client: closed, hadError = false
//   server: closed
```

The client's `end()` sends FIN; the server's socket gets `'end'` and, because `allowHalfOpen` is `false`, ends its own side, which lets the client see `'close'`.

**Example 2 — edge case: writes merge and messages split.** The server below only counts what arrives. Run A makes five `write()` calls in the same tick; run B makes them 20 ms apart with Nagle disabled; run C makes one 1 MiB `write()`.

javascript

```
import net from 'node:net';
import { once } from 'node:events';

// The server only counts what arrives: how many 'data' events, how many bytes.
const server = net.createServer((socket) => {
  const sizes = [];
  socket.on('data', (chunk) => sizes.push(chunk.length));
  socket.on('end', () => {
    const shown = sizes.length > 6 ? `${sizes.slice(0, 5).join(', ')}, …` : sizes.join(', ');
    console.log(`  server saw ${sizes.length} 'data' event(s), ${sizes.reduce((a, b) => a + b, 0)} bytes: [${shown}]`);
    socket.end();
  });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

async function run(label, send) {
  console.log(label);
  const c = net.createConnection({ port, host: '127.0.0.1' });
  await once(c, 'connect');
  await send(c);
  c.end();
  await once(c, 'close');
}

// A: five separate write() calls in the same tick, 10 bytes each
await run('A: 5 writes of 10 bytes, same tick', async (c) => {
  for (let i = 0; i < 5; i++) c.write(`message-${i}`.padEnd(10, '.'));
});

// B: the same five writes, 20 ms apart, with Nagle disabled
await run('B: 5 writes of 10 bytes, 20 ms apart, setNoDelay(true)', async (c) => {
  c.setNoDelay(true);
  for (let i = 0; i < 5; i++) {
    c.write(`message-${i}`.padEnd(10, '.'));
    await new Promise((r) => setTimeout(r, 20));
  }
});

// C: ONE write() of 1 MiB
await run('C: 1 write of 1 MiB', async (c) => { c.write(Buffer.alloc(1024 * 1024, 'x')); });

server.close();

// Real output (Node v24.19.0):
//   A: 5 writes of 10 bytes, same tick
//     server saw 1 'data' event(s), 50 bytes: [50]
//   B: 5 writes of 10 bytes, 20 ms apart, setNoDelay(true)
//     server saw 5 'data' event(s), 50 bytes: [10, 10, 10, 10, 10]
//   C: 1 write of 1 MiB
//     server saw 18 'data' event(s), 1048576 bytes: [65536, 65536, 64485, 65536, 65536, …]
```

Five writes in one tick arrived as **one** 50-byte `'data'` event. Spacing the same writes out produced five events, but that came from timing, not from TCP: on a busy network or a busy receiver they merge again. One 1 MiB write arrived as many chunks of at most 64 KiB, and the count changes from run to run (17 and 18 in two runs on this machine). Any protocol that maps one `'data'` event to one message fails in cases A and C.

**Example 3 — length-prefixed framing that survives both cases.**

javascript

```
import net from 'node:net';
import { once } from 'node:events';

// Frame = 4-byte unsigned big-endian length + that many bytes of payload.
function encodeFrame(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

// Decoder: keeps leftover bytes between 'data' events and emits whole frames only.
function createFrameDecoder(onFrame, maxFrame = 1024 * 1024) {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 4) {
      const len = pending.readUInt32BE(0);
      if (len > maxFrame) throw new Error(`frame of ${len} bytes is over the limit`);
      if (pending.length < 4 + len) break;          // body not complete yet: wait
      onFrame(pending.subarray(4, 4 + len).toString('utf8'));
      pending = pending.subarray(4 + len);
    }
  };
}

const server = net.createServer((socket) => {
  let chunks = 0;
  const decode = createFrameDecoder((msg) => console.log(`  frame: ${JSON.stringify(msg)}`));
  socket.on('data', (chunk) => { chunks++; decode(chunk); });
  socket.on('end', () => { console.log(`  (${chunks} 'data' events)`); socket.end(); });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

async function run(label, send) {
  console.log(label);
  const c = net.createConnection({ port, host: '127.0.0.1', noDelay: true });
  await once(c, 'connect');
  await send(c);
  c.end();
  await once(c, 'close');
}

// 1. Three frames glued into one write
await run('three frames in one write():', async (c) => {
  c.write(Buffer.concat(['alpha', 'beta', 'héllo, wörld'].map(encodeFrame)));
});

// 2. One frame sent 3 bytes at a time, 5 ms apart: the header and a 2-byte
//    UTF-8 character are cut across 'data' events
await run('one frame dripped 3 bytes at a time:', async (c) => {
  const bytes = encodeFrame('héllo');
  for (let i = 0; i < bytes.length; i += 3) {
    c.write(bytes.subarray(i, i + 3));
    await new Promise((r) => setTimeout(r, 5));
  }
});

server.close();

// Real output (Node v24.19.0):
//   three frames in one write():
//     frame: "alpha"
//     frame: "beta"
//     frame: "héllo, wörld"
//     (1 'data' events)
//   one frame dripped 3 bytes at a time:
//     frame: "héllo"
//     (4 'data' events)
```

Three frames in one chunk come out as three messages, and one frame cut into four chunks (with the 4-byte header and the 2-byte `é` both split) comes out as one message. The decoder decodes UTF-8 only after the whole body has arrived, so a split character cannot be corrupted. It checks the declared length against `maxFrame` before it waits for the body, so a client that sends a huge length is rejected at once.

**Example 4 — delimiter-based framing: the naive split versus a line splitter.**

javascript

```
import net from 'node:net';
import { once } from 'node:events';
import { StringDecoder } from 'node:string_decoder';

// Correct: decode bytes safely, keep the unfinished tail, cap the line length.
function createLineSplitter(onLine, maxLine = 8 * 1024) {
  const decoder = new StringDecoder('utf8');  // holds a split multi-byte char
  let tail = '';
  return (chunk) => {
    const parts = (tail + decoder.write(chunk)).split('\n');
    tail = parts.pop();                          // last piece has no '\n' yet
    if (tail.length > maxLine) throw new Error('line too long');
    for (const line of parts) onLine(line.replace(/\r$/, ''));
  };
}

const server = net.createServer((socket) => {
  const split = createLineSplitter((line) => console.log(`  fixed: ${JSON.stringify(line)}`));
  socket.on('data', (chunk) => {
    // Wrong: treat every chunk as whole lines
    for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
      console.log(`  naive: ${JSON.stringify(line)}`);
    }
    split(chunk);
  });
  socket.on('end', () => socket.end());
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const c = net.createConnection({ port: server.address().port, host: '127.0.0.1', noDelay: true });
await once(c, 'connect');
const bytes = Buffer.from('first line\nsecond line\ncafé\n', 'utf8');
// cut after "second li" and in the middle of the 2-byte "é"
for (const piece of [bytes.subarray(0, 20), bytes.subarray(20, 27), bytes.subarray(27)]) {
  c.write(piece);
  await new Promise((r) => setTimeout(r, 10));
}
c.end();
await once(c, 'close');
server.close();

// Real output (Node v24.19.0):
//     naive: "first line"
//     naive: "second li"
//     fixed: "first line"
//     naive: "ne"
//     naive: "caf�"
//     fixed: "second line"
//     naive: "�"
//     fixed: "café"
```

The naive version prints `"second li"` and `"ne"` as two messages, and turns the `é` that was cut across two chunks into two replacement characters. The splitter keeps the unfinished `tail`, and its `StringDecoder` holds back the first byte of `é` until the second byte arrives. This is the same fix lesson 37 applies to its CSV transform.

**Example 5 — backpressure on a socket: `write()` returns `false`, `writableLength` grows, `'drain'` fires.**

javascript

```
import net from 'node:net';
import { once } from 'node:events';

const MiB = 1024 * 1024;
let serverSocket;
const server = net.createServer((socket) => {
  serverSocket = socket;
  socket.pause();                 // a slow consumer: read nothing for now
  let got = 0;
  socket.on('data', (c) => { got += c.length; });
  socket.on('end', () => { console.log(`server: received ${(got / MiB).toFixed(2)} MiB in total`); socket.end(); });
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');

const client = net.createConnection({ port: server.address().port, host: '127.0.0.1' });
await once(client, 'connect');
console.log('client: writableHighWaterMark =', client.writableHighWaterMark);

const chunk = Buffer.alloc(64 * 1024, 'x');
let sent = 0;
// Keep writing until write() says stop. The kernel's send and receive
// buffers absorb the first megabytes, so false comes late.
while (client.write(chunk)) sent += chunk.length;
sent += chunk.length;
console.log(`client: write() returned false after ${(sent / MiB).toFixed(2)} MiB`);
console.log(`client: writableLength = ${client.writableLength} bytes queued in Node's memory`);

setTimeout(() => {
  console.log('server: resume() — start reading');
  serverSocket.resume();
}, 200);

const t0 = Date.now();
await once(client, 'drain');
console.log(`client: 'drain' after ${Math.round((Date.now() - t0) / 100) * 100} ms, writableLength = ${client.writableLength}`);
client.end();
await once(client, 'close');
server.close();

// Real output (Node v24.19.0):
//   client: writableHighWaterMark = 65536
//   client: write() returned false after 2.56 MiB
//   client: writableLength = 65536 bytes queued in Node's memory
//   server: resume() — start reading
//   client: 'drain' after 200 ms, writableLength = 0
//   server: received 2.56 MiB in total
```

The reader paused, yet the writer got `true` for about 2.5 MiB, because the kernel buffers on both sides of the loopback connection took that much. The exact amount depends on the kernel's `net.ipv4.tcp_wmem` / `tcp_rmem` settings. Only after that did 64 KiB pile up in Node (`writableLength` reached `writableHighWaterMark`) and `write()` return `false`. A loop that ignored the `false` would keep growing `writableLength`. Once the reader resumed, the queue drained and `'drain'` fired.

**Example 6 — edge case: `allowHalfOpen` and a reply that is computed after the client's FIN.**

javascript

```
import net from 'node:net';
import { once } from 'node:events';

// A "sum" service: the client sends numbers, then end(). The server answers
// only after it has seen the client's FIN, because only then is the input complete.
async function trial(allowHalfOpen) {
  console.log(`--- server allowHalfOpen: ${allowHalfOpen}`);
  const server = net.createServer({ allowHalfOpen }, (socket) => {
    let input = '';
    socket.setEncoding('utf8');
    socket.on('data', (d) => { input += d; });
    socket.on('end', () => {
      console.log(`server: 'end' (client FIN). readyState = ${socket.readyState}, writable = ${socket.writable}`);
      const sum = input.trim().split(/\s+/).map(Number).reduce((a, b) => a + b, 0);
      setTimeout(() => {                 // pretend the answer needs a 10 ms DB call
        console.log(`server: replying 10 ms later. readyState = ${socket.readyState}`);
        socket.end(`sum=${sum}\n`, (err) => console.log('server: end() callback, err =', err?.code ?? null));
      }, 10);
    });
    socket.on('error', (err) => console.log('server: error', err.code));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const client = net.createConnection({ port: server.address().port, host: '127.0.0.1' });
  client.setEncoding('utf8');
  let reply = '';
  client.on('data', (d) => { reply += d; });
  client.on('end', () => console.log('client: server sent FIN'));
  await once(client, 'connect');
  client.end('2 3 4');                 // write, then half-close our side
  const [hadError] = await once(client, 'close');
  console.log(`client: reply = ${JSON.stringify(reply)}, hadError = ${hadError}`);
  server.close();
}

await trial(true);
await trial(false);

// Real output (Node v24.19.0):
//   --- server allowHalfOpen: true
//   server: 'end' (client FIN). readyState = writeOnly, writable = true
//   server: replying 10 ms later. readyState = writeOnly
//   server: end() callback, err = null
//   client: server sent FIN
//   client: reply = "sum=9\n", hadError = false
//   --- server allowHalfOpen: false
//   server: 'end' (client FIN). readyState = writeOnly, writable = true
//   client: server sent FIN
//   client: reply = "", hadError = false
//   server: replying 10 ms later. readyState = closed
//   server: end() callback, err = ERR_STREAM_WRITE_AFTER_END
```

With `allowHalfOpen: true`, the server's writable side stays open after the client's FIN, so the reply sent 10 ms later arrives. With the default `false`, Node ends the writable side on the tick after `'end'`. A reply written synchronously inside the `'end'` handler still goes out, which is why this bug hides in tests. A reply that waits for anything asynchronous (a timer, a database query) finds the socket already closed: the client gets an empty reply, and the only trace on the server is `ERR_STREAM_WRITE_AFTER_END` passed to the `end()` callback.

**Example 7 — `end()` vs `destroy()` vs `resetAndDestroy()`, and `ECONNREFUSED`.** Each client writes 8 MiB, then closes in a different way.

javascript

```
import net from 'node:net';
import { once } from 'node:events';

const MiB = 1024 * 1024;
const server = net.createServer((socket) => {
  let got = 0;
  socket.on('data', (c) => { got += c.length; });
  socket.on('end', () => console.log(`  server: 'end' (FIN received)`));
  socket.on('error', (err) => console.log(`  server: 'error' ${err.code}`));
  socket.on('close', (hadError) =>
    console.log(`  server: 'close' hadError=${hadError}, received ${(got / MiB).toFixed(2)} MiB`));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

async function trial(label, finish) {
  console.log(label);
  const c = net.createConnection({ port, host: '127.0.0.1' });
  c.on('error', (err) => console.log(`  client: 'error' ${err.code}`));
  await once(c, 'connect');
  c.write(Buffer.alloc(8 * MiB));          // more than the kernel buffers hold at once
  finish(c);
  await once(c, 'close');
  await new Promise((r) => setTimeout(r, 50));   // let the server log
}

await trial('end(): flush the queue, then FIN', (c) => c.end());
await trial('destroy(): close now, drop what is still queued', (c) => c.destroy());
await trial('resetAndDestroy(): send RST', (c) => c.resetAndDestroy());
server.close();
await once(server, 'close');

// Nobody listens on this port any more
console.log('connect to a closed port');
const r = net.createConnection({ port, host: '127.0.0.1' });
r.on('error', (err) => console.log(`  client: 'error' ${err.code} (syscall=${err.syscall}, address=${err.address})`));
r.on('close', (hadError) => console.log(`  client: 'close' hadError=${hadError}`));

// Real output (Node v24.19.0):
//   end(): flush the queue, then FIN
//     server: 'end' (FIN received)
//     server: 'close' hadError=false, received 8.00 MiB
//   destroy(): close now, drop what is still queued
//     server: 'end' (FIN received)
//     server: 'close' hadError=false, received 2.51 MiB
//   resetAndDestroy(): send RST
//     server: 'error' ECONNRESET
//     server: 'close' hadError=true, received 0.12 MiB
//   connect to a closed port
//     client: 'error' ECONNREFUSED (syscall=connect, address=127.0.0.1)
//     client: 'close' hadError=true
```

`end()` delivered all 8 MiB. `destroy()` delivered only what the kernel had already accepted (2.51 MiB here): the rest was still in Node's queue and was thrown away, yet the server saw a normal FIN with `hadError=false`, so nothing told it that data was missing. `resetAndDestroy()` sent RST: the server got `ECONNRESET`, `hadError=true`, and even bytes already sitting in its kernel buffer were discarded. Connecting to a closed port fails with `ECONNREFUSED` from the `connect` syscall.

**Example 8 — `setTimeout` only warns; `setKeepAlive` is the kernel's job.**

javascript

```
import net from 'node:net';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';

const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 100) * 100).padStart(4)} ms`;

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.setTimeout(300);                       // idle timer: 300 ms without I/O
  let warned = false;
  socket.on('timeout', () => {
    if (!warned) {
      warned = true;
      console.log(`${at()} server: 'timeout' — destroyed=${socket.destroyed}, readyState=${socket.readyState}`);
      socket.write('are you still there?\n');   // the socket still works
      return;
    }
    console.log(`${at()} server: second 'timeout', closing it ourselves`);
    socket.end('bye\n');
  });
  socket.on('data', (d) => console.log(`${at()} server: got ${JSON.stringify(d)} (I/O resets the timer)`));
  socket.on('close', () => console.log(`${at()} server: 'close'`));
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

const client = net.createConnection({ port, host: '127.0.0.1' });
await once(client, 'connect');
client.setKeepAlive(true, 10_000);              // kernel probes after 10 s idle
const ss = execFileSync('ss', ['-tno', 'state', 'established', `( sport = :${client.localPort} )`], { encoding: 'utf8' });
const [, secs] = ss.match(/timer:\(keepalive,([\d.]+)sec/);   // e.g. "timer:(keepalive,9.959sec,0)"
console.log(`client: ss shows a keepalive timer, first probe in ~${Math.round(secs)} s`);

client.setEncoding('utf8');
client.on('data', (d) => {
  console.log(`${at()} client: got ${JSON.stringify(d)}`);
  if (d.startsWith('are you')) setTimeout(() => client.write('yes'), 100);
});
await once(client, 'close');
server.close();

// Real output (Node v24.19.0):
//   client: ss shows a keepalive timer, first probe in ~10 s
//    300 ms server: 'timeout' — destroyed=false, readyState=open
//    300 ms client: got "are you still there?\n"
//    400 ms server: got "yes" (I/O resets the timer)
//    700 ms server: second 'timeout', closing it ourselves
//    700 ms client: got "bye\n"
//    700 ms server: 'close'
```

After 300 ms of silence the server got `'timeout'`, yet the socket was neither destroyed nor closed, and it could still write. The client's reply reset the idle timer. The second `'timeout'` is where the server decides to close. `ss -tno` shows the kernel keepalive timer that `setKeepAlive(true, 10_000)` started on the client socket. The kernel sends those probes; Node is not involved.

To see the four kernel options that the new v24.19.0 options form sets, trace the `setsockopt` calls:

javascript

```
const net = require('node:net');
const s = net.createServer(() => {}).listen(0, '127.0.0.1', () => {
  const c = net.connect(s.address().port, '127.0.0.1', () => {
    c.setKeepAlive({ enable: true, initialDelay: 10000, interval: 2000, count: 3 });
    c.destroy(); s.close();
  });
});
```

bash

```
$ strace -f -e trace=setsockopt node ka.cjs 2>&1 | grep KEEP | sed 's/^\[pid *[0-9]*\] //'
setsockopt(22, SOL_SOCKET, SO_KEEPALIVE, [1], 4) = 0
setsockopt(22, SOL_TCP, TCP_KEEPIDLE, [10], 4) = 0
setsockopt(22, SOL_TCP, TCP_KEEPINTVL, [2], 4) = 0
setsockopt(22, SOL_TCP, TCP_KEEPCNT, [3], 4) = 0
```

The millisecond values become whole seconds (`10000` → `10`, `2000` → `2`), as the docs say. The same script on Node 22 sets only the first option, with no error:

bash

```
$ strace -f -e trace=setsockopt "$(npx -y node@22 -p process.execPath)" ka.cjs 2>&1 | grep KEEP | sed 's/^\[pid *[0-9]*\] //'
setsockopt(22, SOL_SOCKET, SO_KEEPALIVE, [1], 4) = 0
```

Node v22.23.3 has only the positional form `setKeepAlive(enable, initialDelay)`. It treats the object as a truthy `enable` and ignores the rest, so the probe delay stays at the kernel default (`net.ipv4.tcp_keepalive_time`, 7200 s on this machine). Check `process.version` before you rely on the options form.

**Example 9 — a line-protocol chat server.** One message is one line ending in `\n`. The first line a client sends is its nickname; `/who` lists who is online; `/quit` leaves; any other line goes to everyone else as `<nick> text`. The server combines the pieces above: a line splitter with a length limit, a backpressure policy (a client that falls 256 KiB behind is dropped), an idle timeout that really closes, and an `'error'` listener on every socket.

javascript

```
// chat-server.mjs — a line protocol over TCP. One line = one message, ended by '\n'.
//   first line      -> your nickname
//   /who            -> list who is online
//   /quit           -> leave
//   anything else   -> sent to everyone else as "<nick> text"
import net from 'node:net';
import { StringDecoder } from 'node:string_decoder';

const MAX_LINE = 1024;              // bytes we accept before a '\n'
const MAX_QUEUED = 256 * 1024;      // a client further behind than this is dropped
const IDLE_MS = 5 * 60_000;

export function createChatServer({ log = console.log } = {}) {
  const clients = new Map();        // socket -> nick (only after the nick is set)

  function send(socket, line) {
    if (socket.destroyed || socket.writableEnded) return;   // after end() or destroy()
    socket.write(line + '\n');
    // Backpressure policy: one slow reader must not grow our memory without bound.
    if (socket.writableLength > MAX_QUEUED) {
      log(`server: dropping ${clients.get(socket)} (slow consumer, ${socket.writableLength} bytes queued)`);
      socket.destroy();
    }
  }
  function broadcast(from, line) {
    for (const s of clients.keys()) if (s !== from) send(s, line);
  }

  function handleLine(socket, line) {
    const nick = clients.get(socket);
    if (nick === undefined) {                       // first line: the nickname
      if (!/^\w{1,16}$/.test(line)) return send(socket, '* nick must be 1-16 letters, digits or _');
      if ([...clients.values()].includes(line)) return send(socket, `* ${line} is taken`);
      clients.set(socket, line);
      log(`server: ${line} joined (${clients.size} online)`);
      send(socket, `* hi ${line}, ${clients.size} online`);
      return broadcast(socket, `* ${line} joined`);
    }
    if (line === '/who') return send(socket, `* online: ${[...clients.values()].join(', ')}`);
    if (line === '/quit') return socket.end('* bye\n');     // FIN after the goodbye
    if (line.length) broadcast(socket, `<${nick}> ${line}`);
  }

  const server = net.createServer({ noDelay: true }, (socket) => {
    const decoder = new StringDecoder('utf8');
    let tail = '';
    socket.setTimeout(IDLE_MS);
    socket.on('timeout', () => socket.end('* idle too long\n'));   // 'timeout' only warns
    send(socket, '* welcome, send your nick');

    socket.on('data', (chunk) => {
      const parts = (tail + decoder.write(chunk)).split('\n');
      tail = parts.pop();
      for (const line of parts) handleLine(socket, line.replace(/\r$/, ''));
      if (Buffer.byteLength(tail) > MAX_LINE) socket.end('* line too long\n');
    });
    socket.on('error', (err) => log(`server: socket error ${err.code}`));   // ECONNRESET etc.
    socket.on('close', (hadError) => {
      const nick = clients.get(socket);
      if (nick === undefined) return;
      clients.delete(socket);
      log(`server: ${nick} left (hadError=${hadError}, ${clients.size} online)`);
      broadcast(socket, `* ${nick} left`);
    });
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2] ?? 4900);
  createChatServer().listen(port, '127.0.0.1', function () {
    console.log(`chat server on 127.0.0.1:${this.address().port}`);
  });
}
```

The test starts the server in-process and drives three scripted clients. Each step waits for the lines it expects, so the transcript comes out in the same order on every run. Carol sends her nickname and the first half of a message in one write and the rest 20 ms later, to show that the server's framing handles both cases. Bob leaves with an RST instead of a FIN.

javascript

```
// chat-test.mjs — three scripted clients against the chat server.
import net from 'node:net';
import { once } from 'node:events';
import { createChatServer } from './chat-server.mjs';

const server = createChatServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

function client(name) {
  const socket = net.createConnection({ port, host: '127.0.0.1' });
  socket.setEncoding('utf8');
  const waiting = [];                 // resolvers waiting for the next line
  const lines = [];
  let tail = '';
  socket.on('data', (d) => {
    const parts = (tail + d).split('\n');
    tail = parts.pop();
    for (const line of parts) {
      console.log(`  ${name.padEnd(5)} <- ${line}`);
      waiting.length ? waiting.shift()(line) : lines.push(line);
    }
  });
  socket.on('error', (err) => console.log(`  ${name} error ${err.code}`));
  return {
    socket,
    next: () => (lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiting.push(r))),
    say(text) { console.log(`  ${name.padEnd(5)} -> ${text}`); socket.write(text + '\n'); },
  };
}

const alice = client('alice');
await alice.next();                    // welcome
alice.say('alice');
await alice.next();                    // hi alice

const bob = client('bob');
await bob.next();
bob.say('alice');                      // taken
await bob.next();
bob.say('bob');
await Promise.all([bob.next(), alice.next()]);   // hi bob / bob joined

// carol sends nick and first message in ONE write, split mid-word in TWO writes
const carol = client('carol');
await carol.next();
console.log('  carol -> "carol\\nhello every" + "one\\n" (two writes, 20 ms apart)');
carol.socket.write('carol\nhello every');
await new Promise((r) => setTimeout(r, 20));
carol.socket.write('one\n');
await Promise.all([carol.next(), alice.next(), bob.next(), alice.next(), bob.next()]);

bob.say('/who');
await bob.next();
alice.say('/quit');
await Promise.all([alice.next(), once(alice.socket, 'close'), bob.next(), carol.next()]);

console.log('  bob   x  (connection reset with RST)');
bob.socket.resetAndDestroy();
await carol.next();

carol.socket.end();
await once(carol.socket, 'close');
await new Promise((r) => setTimeout(r, 20));
server.close();

// Real output (Node v24.19.0):
//     alice <- * welcome, send your nick
//     alice -> alice
//   server: alice joined (1 online)
//     alice <- * hi alice, 1 online
//     bob   <- * welcome, send your nick
//     bob   -> alice
//     bob   <- * alice is taken
//     bob   -> bob
//   server: bob joined (2 online)
//     bob   <- * hi bob, 2 online
//     alice <- * bob joined
//     carol <- * welcome, send your nick
//     carol -> "carol\nhello every" + "one\n" (two writes, 20 ms apart)
//   server: carol joined (3 online)
//     carol <- * hi carol, 3 online
//     alice <- * carol joined
//     bob   <- * carol joined
//     alice <- <carol> hello everyone
//     bob   <- <carol> hello everyone
//     bob   -> /who
//     bob   <- * online: alice, bob, carol
//     alice -> /quit
//     alice <- * bye
//   server: alice left (hadError=false, 2 online)
//     bob   <- * alice left
//     carol <- * alice left
//     bob   x  (connection reset with RST)
//   server: socket error ECONNRESET
//   server: bob left (hadError=true, 1 online)
//     carol <- * bob left
//   server: carol left (hadError=false, 0 online)
```

The transcript shows the framing work: `carol\nhello every` became a nickname plus a partial line, and `one\n` 20 ms later completed `hello everyone`. Alice's `/quit` was a clean close (FIN, `hadError=false`). Bob's RST reached the server as `ECONNRESET` followed by `'close'` with `hadError=true`, and the `'error'` listener kept the server running. In a separate run with one client that joined and never read while another flooded the room with 1 KB lines, the server logged `server: dropping sloth (slow consumer, 262340 bytes queued)`, so the backpressure policy holds memory per client at about 256 KiB.

Any line-based TCP client can talk to it. Here the server runs on port 4900 and `nc` sends a nickname followed by 3,000 bytes with no newline:

bash

```
$ node chat-server.mjs 4900 &
chat server on 127.0.0.1:4900
$ (printf 'dave\n'; head -c 3000 /dev/zero | tr '\0' 'a'; sleep 0.3) | nc -q1 127.0.0.1 4900
* welcome, send your nick
server: dave joined (1 online)
* hi dave, 1 online
* line too long
server: dave left (hadError=false, 0 online)
```

The complete `dave` line was handled first; then the 3,000-byte unfinished line went over `MAX_LINE`, and the server ended the connection instead of buffering it.

## Common mistakes & gotchas

- **One `data` event is not one message.** Five writes can arrive as one chunk, and one large write can arrive as many. Frame with a length prefix or a delimiter, and keep the leftover bytes.
- **`chunk.toString()` on raw text chunks.** A multi-byte character cut across chunks becomes a replacement character. Use a `StringDecoder`, `socket.setEncoding('utf8')`, or decode only a complete frame.
- **No maximum message size.** "Until the newline" or "until `length` bytes" lets one client force an unbounded buffer.
- **Ignoring `write()` returning false.** `writableLength` grows until the process runs out of memory. Wait for `drain`, use `pipeline`, or drop the slow peer.
- **Expecting `setTimeout` to close the socket.** It only emits `timeout`. Call `end` or `destroy` in the handler.
- **Confusing `setTimeout` with `setKeepAlive`.** The first is your idle policy. The second asks the kernel to detect a dead peer.
- **Replying after `end` with the default `allowHalfOpen: false`.** The writable side is already ended, and the reply is lost.
- **`destroy()` when you meant `end()`.** `destroy` drops queued data, and the peer still sees a normal FIN, so nothing reports the loss.
- **No `error` listener.** `ECONNRESET` from one client crashes the process.
- **`setNoDelay(true)` as a framing fix.** It only stops the sender delaying small writes. The receiver can still merge or split them.

## Best practices

- **Pick a framing and write it down.** A 4-byte big-endian length for binary data, or newline-terminated lines for text. Put a maximum size on both.
- **Keep the decoder off the socket,** as a function or a Transform, and unit-test it with 1-byte chunks and with glued chunks.
- **Respect backpressure on every write.** `pipeline(source, socket)` for a one-to-one copy. For fan-out, watch `writableLength` per client and drop clients that fall behind.
- **Attach `error` on every socket and log `err.code`.** Treat `ECONNRESET` and `EPIPE` as disconnects.
- **`end()` for a graceful close.** `destroy()` when you mean to drop the connection. `resetAndDestroy()` when the peer must see an error.
- **`setTimeout` plus `end()` for idle clients.** `setKeepAlive(true, delay)` to find dead peers on long-lived connections.
- **Listen on port 0 in tests** and read `server.address().port`, so parallel runs do not collide.

## ⭐ Interview lens

> **Q: “A client sends two JSON messages with two `write()` calls. Why might the server's `JSON.parse(chunk)` fail?”**  
> A: TCP is a byte stream. It keeps order and it does not keep the boundaries of your `write` calls. Two `socket.write` calls of two JSON messages can arrive as one `data` chunk, because the kernel merged them, or one message can be split across chunks, because the payload is large, the link is slow, or Node read at most 64 KiB. `JSON.parse(chunk)` then throws, or it parses the first object and silently drops the second. You frame the stream. Newline-delimited JSON carries the unfinished tail to the next chunk. A length prefix waits until it has the header and then the declared body. `setNoDelay(true)` does not fix this. It only changes when the sender transmits. The receiver can still merge and split. The limit of a delimiter is a message that contains the delimiter, and a client that never sends it. Escape the delimiter, or use a length, and cap the size.

> **Q: “What does `socket.write()` returning `false` mean, and what happens if you ignore it?”**  
> A: `write` returning false means the bytes were accepted and queued in Node, because the kernel send buffer is full, and that Node queue, `writableLength`, is at or above `writableHighWaterMark`, 64 KiB by default. Stop writing. Continue when `drain` fires, which means the queue has been handed to the kernel. `pipeline` does that pause and resume for you. If you ignore the boolean, `write` still takes every chunk and `writableLength` grows with no error until the process runs out of memory. The limit on a local test is the kernel buffers. On loopback they hold a few megabytes, so the first false comes later than you expect, after those buffers fill, not at the first unread byte.

> **Q: “What is the difference between `end()`, `destroy()` and `resetAndDestroy()`?”**  
> A: `end()` finishes cleanly. It writes every byte still queued in Node, then sends FIN. The peer gets the whole payload and an `end` event. `destroy()` closes the descriptor now. Bytes still queued in Node are dropped, and the peer can still see a normal FIN for whatever the kernel had already accepted, so the loss is silent. `resetAndDestroy()` sends RST. The peer gets `ECONNRESET` and `close` with `hadError` true, and data still sitting in kernel buffers is discarded too. Use `end` when the peer should receive everything. Use `destroy` when you are abandoning the connection. Use the reset when the peer must treat the close as an error. The limit of `destroy` as a quick close is that in-flight `_write` work can still complete, and the peer has no signal that the tail was cut.

> **Q: “Does `socket.setTimeout(30000)` close idle connections?”**  
> A: No. `socket.setTimeout(30000)` starts a timer that resets whenever the socket reads or writes. After 30 seconds of silence it emits `timeout` and leaves the connection open. You call `end` or `destroy` in that handler if idle clients should go away. `setKeepAlive` is a different mechanism. It asks the kernel to send probe packets on a connection that has gone quiet, and to report the connection dead if the probes are not answered. That finds a peer that lost power or a NAT entry that expired. It is not your idle policy. The limit is passing `0` as the initial delay. The kernel default applies, and on the machine in this lesson `net.ipv4.tcp_keepalive_time` was 7200 seconds, so the first probe is two hours out.

## Cheat-card

- **Server:** `net.createServer(options, (socket) => ...).listen(0, host)`. Port from `server.address().port`.
- **Client:** `net.createConnection({ host, port })`. Events: `lookup`, `connect`, `ready`.
- **Socket is a Duplex.** The readable side ends on the peer's FIN (`end`). The writable side ends on your `end()`.
- **Chunks are 1 byte to 64 KiB,** merged or split. One `write` is not one `data`.
- **Framing:** a length prefix (`readUInt32BE`, then wait for 4 plus the length) or a delimiter (`split` on newline, carry `tail`, use a `StringDecoder`). Always a max size.
- **Backpressure:** `write` returning false means stop. `drain` means go. `writableLength` is bytes queued in Node. Kernel buffers absorb megabytes first.
- **Close:** `end` flushes and sends FIN. `destroy` closes now and drops the Node queue. `resetAndDestroy` sends RST.
- **Half-open:** the default `allowHalfOpen: false` ends your writable side on the tick after `end`.
- **Idle:** `setTimeout` emits `timeout` only. You close. `setKeepAlive` is the kernel's dead-peer probes.
- **Errors:** `error`, then `close` with `hadError` true. `ECONNREFUSED`, `ECONNRESET`, `EPIPE`, `ETIMEDOUT`. Always listen for `error`.

## Good to know

- What is a half-open connection, and when do you set `allowHalfOpen: true`? One direction is closed by FIN and the other still carries data. Set it true when the peer signals "request complete" with `end()` and you reply afterwards, especially after async work. With the default false, Node ends your writable side on the tick after `end`, and an async reply hits `ERR_STREAM_WRITE_AFTER_END`.
- `resetAndDestroy` was added in v18.3.0. In v24.19.0, `setKeepAlive` also takes `interval` and `count`, and an options object `{ enable, initialDelay, interval, count }`, both added in v24.19.0. The `keepAlive`, `keepAliveInitialDelay`, and `noDelay` options of `net.createServer` and `net.createConnection` were added in v17.7.0 and v16.15.0.
- With `setKeepAlive` and an `initialDelay` of 0, the kernel default applies. On the lesson's machine that was `net.ipv4.tcp_keepalive_time`, 7200 seconds.
## Learn More

- [Net | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/net.html)
- [Stream: writable.write() and backpressure | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/stream.html)
- [Backpressuring in Streams | Node.js Learn nodejs.org](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
- [RFC 9293: Transmission Control Protocol (TCP) rfc-editor.org](https://www.rfc-editor.org/rfc/rfc9293.html)
- [tcp(7) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages/tcp.7.en.html)
