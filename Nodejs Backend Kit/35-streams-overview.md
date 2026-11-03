---
title: "Streams Overview"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/streams-overview
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Streams Overview

*11 min read · Updated 24 Jul 2026 Topic 26 of 70 Bookmark Mark done Why it matters Imagine a user uploads a 4 GB video and your server has to hash it · Topic 26 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/streams-overview](https://www.geekyfrontend.in/learn/nodejs-backend-kit/streams-overview)

---

## Say it in 30 seconds

A stream moves data in small pieces, called chunks, so you can start work before the whole input has arrived and you only keep a small buffer in memory. It exists because loading a multi-gigabyte upload or file into one Buffer will exhaust the process, and because HTTP, files, sockets, compression, and crypto already move data this way. The trade-off is that a chunk is a slice of bytes, not a whole line or JSON record, and you have to let a slow consumer pause a fast producer or memory grows without a bound.

## Why it matters

A user uploads a 4 GB video and the server must hash it, make a thumbnail, and store it. `fs.readFileSync('video.mp4')` pulls all four gigabytes into one Buffer before you touch a byte. Ten users at once is 40 GB, and the process dies with `JavaScript heap out of memory`. The file was not the problem. Reading it all at once was.

A stream lets you work on each chunk and then let it go. Memory stays a small buffer whether the file is 4 KB or 4 TB. HTTP requests and responses, file I/O, TCP sockets, child-process output, compression, and crypto are streams. "How would you process a file too big to fit in memory?" is a stream question.

## The concept, simply

A stream is a sequence of data that is not available all at once and does not have to fit in memory. You start work after the first chunks arrive, and you only hold a buffer, the way a video starts playing before the file has finished downloading.

![Diagram comparing buffering a whole 4 GB file in RAM against streaming it in small chunks](assets/i23_01_537b76f3.svg)

Buffering loads everything into memory before you start. Streaming moves small chunks through a pipeline, and memory stays small.

Two properties matter. Memory stays bounded by the chunk and a small buffer, not by the size of the data. And you can produce output before the input has all arrived. A gzip stream emits compressed bytes while it is still reading. An HTTP server can start the response body before the whole body exists.

Every stream you meet is one of four kinds:

- **Readable:** a source you read from. `fs.createReadStream()`, an incoming HTTP request (`req`), `process.stdin`, a child process's stdout.
- **Writable:** a sink you write to. `fs.createWriteStream()`, an HTTP response (`res`), `process.stdout`, a socket.
- **Duplex:** readable and writable, and the two sides are independent. A TCP socket is the classic case. What you write and what you read are separate flows that share one object.
- **Transform:** a Duplex whose output is computed from its input. Bytes go in, transformed bytes come out. `zlib.createGzip()`, a crypto cipher, a CSV parser.

![The four Node stream types: Readable, Writable, Duplex, and Transform with example use cases for each](assets/i23_02_ec427c97.svg)

Readable is a source, Writable is a sink, Duplex is both with independent sides, and Transform is a Duplex whose output is computed from its input.

## How it works

Under every stream is an internal buffer and a threshold called the `highWaterMark`. When a Readable produces data faster than you consume it, the extra bytes queue in that buffer. The `highWaterMark` is the size, in bytes for binary streams or in objects for object mode, at which the stream stops asking the source for more. The default is 64 KiB for byte streams and 16 objects in object mode. Read `readableHighWaterMark` or `writableHighWaterMark` on the stream instead of memorising it:

javascript

```
import { Readable, Writable, getDefaultHighWaterMark } from 'node:stream';
import { createReadStream } from 'node:fs';

console.log(getDefaultHighWaterMark(false));                          // byte streams
console.log(getDefaultHighWaterMark(true));                           // object mode
console.log(new Writable({ write(c, e, cb) { cb(); } }).writableHighWaterMark);
console.log(new Readable({ objectMode: true, read() {} }).readableHighWaterMark);
console.log(createReadStream('package.json').readableHighWaterMark);

// Real output (Node v24.19.0):
//   65536
//   16
//   65536
//   16
//   65536
```

It is a soft target, not a hard cap. A single `push` larger than the mark is still accepted. It is the dial for how much memory a stream is willing to hold.

That buffer is what makes backpressure possible. Backpressure is a slow consumer telling a fast producer to slow down. On a Writable, `write(chunk)` returns a boolean. `true` means the buffer has room. `false` means the buffer is at or over the highWaterMark, so stop. A careful producer then waits for the `'drain'` event before writing again. On a Readable in paused mode, you only pull what you can handle. When you connect them with `.pipe()` or `pipeline()`, Node pauses the source when the destination is full and resumes it after a drain. The last topic of this chapter covers that in depth.

Streams extend `EventEmitter`, so they talk in events:

- `'data'` on a Readable means a chunk is available. Attaching this listener switches the stream into flowing mode and starts pushing data at you.
- `'readable'` means data is buffered and ready to pull with `read()`. That is paused-mode consumption.
- `'end'` means the Readable will produce nothing more.
- `'drain'` means a Writable's buffer has dropped below the highWaterMark after `write()` returned `false`. It is safe to write again.
- `'finish'` means `end()` was called and every buffered chunk has been flushed to the underlying resource.
- `'close'` means the stream and its underlying resource, a file descriptor or a socket, have been closed.
- `'error'` means something failed. An `'error'` with no listener throws, and the process can crash.

A chunk is a Buffer of raw bytes by default. Set an encoding and you get strings. Put the stream in object mode and each chunk can be any JavaScript value, such as a parsed record. Object mode counts the highWaterMark in objects, not bytes.

## Code examples

**1. Copy a file with constant memory.** This copies a file of any size while holding about one buffer at a time.

javascript

```
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// pipeline() reads chunks from the source and writes them to the
// destination, handling backpressure and errors for you.
await pipeline(
  createReadStream('big-input.bin'),
  createWriteStream('copy-output.bin')
);
console.log('Copied without ever holding the whole file in RAM.');
```

**2. Consume a Readable and watch its events.** Count bytes chunk by chunk instead of building one giant string.

javascript

```
import { createReadStream } from 'node:fs';

const stream = createReadStream('big-input.bin', { highWaterMark: 64 * 1024 });
let bytes = 0;
let chunks = 0;

stream.on('data', (chunk) => {   // Buffer of up to 64 KB
  bytes += chunk.length;
  chunks++;
});
stream.on('end', () => {
  console.log(`Done: ${chunks} chunks, ${bytes} bytes total`);
});
stream.on('error', (err) => {    // ALWAYS handle this
  console.error('Read failed:', err.message);
});
```

**3. An HTTP server is streams.** `req` is a Readable. `res` is a Writable. Streaming a file to the client never holds the file in the server.

javascript

```
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

createServer(async (req, res) => {
  // req: Readable (the request body)  |  res: Writable (the response)
  res.setHeader('Content-Type', 'video/mp4');
  try {
    await pipeline(createReadStream('./movie.mp4'), res);
  } catch (err) {
    if (!res.headersSent) res.statusCode = 500;
    res.end();               // client disconnect or read error
  }
}).listen(3000);
```

## Common mistakes & gotchas

- **`readFile` or `readFileSync` on large or unbounded data.** It works on a 2 KB fixture and fails on a 2 GB upload. If the user controls the size, stream it.
- **Concatenating every chunk into one string or Buffer.** `data += chunk` rebuilds the "hold everything" problem.
- **No `'error'` listener.** An unhandled `'error'` is thrown and can take the process down. Every stream in a chain can emit it.
- **Treating a chunk as a line or a JSON object.** A chunk ends on a byte boundary. One chunk can hold half a line, and a multi-byte character can be split. Do not `JSON.parse` a raw chunk.
- **Treating `highWaterMark` as a hard limit.** It decides when the stream stops pulling. One oversized `push` still goes through.

## Best practices

- **Stream any I/O whose size you do not control:** uploads, proxied responses, exports, logs.
- **Prefer `pipeline()`**, ideally the promise form from `node:stream/promises`. It handles backpressure, forwards errors, and cleans up every stream on failure.
- **Attach an `'error'` handler** to every stream, or let `pipeline()` collect those errors in one place.
- **Set `highWaterMark` only when you have a reason:** larger for a fast file copy, smaller when many streams are open at once.
- **Use object mode** when the pipeline passes records rather than bytes. Backpressure still applies, counted in objects.

## ⭐ Interview lens

> **Q: What problem do streams solve that `fs.readFile` does not?**  
A: Streams process data in chunks, so memory stays bounded and you can emit output before the input has all been read. `fs.readFile` waits until the whole payload is one Buffer, so peak memory grows with the data and you cannot start until that Buffer exists. For a 4 GB upload, ten concurrent `readFile` calls ask for tens of gigabytes and the process dies with a heap error. A stream holds a small buffer, on the order of the highWaterMark, whether the file is tiny or huge. The limit is that you no longer have one complete value in hand. A chunk is not a record, and a slow consumer must be allowed to pause the producer.

> **Q: Name the four stream types and give a real example of each.**  
A: A Readable is a source you read from, such as `fs.createReadStream` or an HTTP request. A Writable is a sink you write to, such as a file write stream or an HTTP response. A Duplex is both, and the two sides are independent. A TCP socket is the usual example: bytes you write and bytes you read are unrelated. A Transform is a Duplex whose readable output is computed from what you write, such as gzip or a cipher. The limit of that last distinction is easy to miss in an interview. A Transform is not "only a Writable" or "only a Readable". You write into it and read the result from it.

> **Q: What is the `highWaterMark`?**  
A: `highWaterMark` is the threshold of a stream's internal buffer. For byte streams the default is 64 KiB. In object mode the default is 16 objects. Check `readableHighWaterMark` or `writableHighWaterMark` on the actual stream. When a Readable's buffer reaches the mark, it stops pulling from the source. When a Writable's buffer reaches the mark, `write()` starts returning `false`, which is the signal to wait for `'drain'`. That is the knob behind backpressure. The limit is that the mark is a soft target. One `push` bigger than the mark is still accepted, so it is not a hard memory ceiling.

> **Q: Which event, if unhandled, will crash your process, and why?**  
A: The `'error'` event. Streams are EventEmitters, and an `'error'` with no listener is rethrown as an exception, which can crash the process. Any stream in a chain can emit it: the file, the gzip transform, the socket. `pipeline()` is the usual fix because it destroys the other streams and delivers that failure to one callback or one rejected promise. The limit is that attaching the listener late does not help. The event has to have a listener at the moment it fires, or you use `pipeline()` so you are not racing each stream yourself.

## Cheat-card

- **Stream:** process chunks, bounded memory, start before the input ends.
- **Types:** Readable (from), Writable (to), Duplex (both, independent), Transform (output is a function of input).
- **Buffer and highWaterMark:** internal queue. Default 64 KiB for byte streams, 16 objects in object mode. Drives backpressure. Soft target.
- **Events:** `data`, `readable`, `end` on a Readable. `drain`, `finish` on a Writable. `close` and `error` on both.
- **Chunk:** a Buffer by default, a string if you set an encoding, any value in object mode. Not a logical record.
- **Always:** handle `'error'`, prefer `pipeline()`, stream anything whose size is unbounded.

## Good to know

- Before Node 22, generic streams defaulted to a 16 KiB highWaterMark, while `fs.createReadStream` was already 64 KiB. Node 22 uses 64 KiB for every byte stream.
- Is a Transform a Readable or a Writable? Both. It is a Duplex. You write input on the writable side and read transformed output on the readable side. A plain Duplex's two sides are unrelated. A Transform's output is computed from its input.
- Why can a chunk not be treated as a complete line or JSON object? Chunks split on byte boundaries. A record can span chunks, one chunk can hold several partial records, and one UTF-8 character can be split. Reassemble logical units yourself, usually in a Transform.
## Learn More

- [Stream | Node.js Documentation nodejs.org](https://nodejs.org/api/stream.html)
- [How To Use Streams | Node.js Learn nodejs.org](https://nodejs.org/en/learn/modules/how-to-use-streams)
- [Streams API | MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
- [How to use "Streams" to improve performance in Node.js? Software Developer Diaries](https://www.youtube.com/watch?v=VSBq9Q7QrGk)
- [Everything You Should Know about Node.js Streams Erick Wendel](https://www.youtube.com/watch?v=BdePYKgrMh0)
