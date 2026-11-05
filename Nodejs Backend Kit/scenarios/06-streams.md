# 06. Streams and buffers

> **Remember this**
> 1. Reading a whole file into memory costs its full size per request. Streaming costs a small buffer, whatever the file size.
> 2. Use `pipeline` from `node:stream/promises`, not bare `pipe`. It handles backpressure and destroys every stream when one fails or the client leaves.
> 3. `write()` returning false means "stop". Wait for `drain` before writing again, or let `pipeline` do it.
> 4. Every upload needs a hard size limit enforced while bytes flow, plus cleanup of the partial file.
> 5. Decode text with a `StringDecoder` or `setEncoding('utf8')`. Turning each Buffer chunk into a string on its own breaks characters split across chunks.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| ST1 | [Large file downloads and uploads run out of memory](#st1-large-file-downloads-and-uploads-run-out-of-memory) | Must know |
| ST2 | [A CSV export to a slow client eats server memory](#st2-a-csv-export-to-a-slow-client-eats-server-memory) | Likely |

---

## ST1. Large file downloads and uploads run out of memory
**Tag: Must know**

### Scenario
"Our file service lets users download their data exports, some of them 2 GB, and upload files to attach to records. When a few users download big exports at the same time, the process crashes with out of memory. How would you fix downloads, and what would you check on uploads?"

### Questions to ask back
- **How does the handler read the file today?** If it reads the whole file into memory before sending, that alone explains the crash, and streaming fixes it.
- **Where do files live, local disk or object storage?** Object storage lets me hand out a signed URL so the bytes never pass through our server.
- **What is the largest upload we must accept?** That number becomes the hard limit, and a very large limit pushes me toward direct uploads to storage.
- **Do clients need to resume interrupted downloads?** Then I add range requests, which a stream from a byte offset supports.

### Spoken answer
> The crash happens because the handler reads the whole file into memory before sending it. A big export then costs its full size in memory, for every user downloading at once. I would stream it instead. I open a read stream on the file and connect it to the response with pipeline. Pipeline respects backpressure, so memory stays at a small buffer however big the file is. It also destroys the file stream if the client disconnects, so we stop reading a file nobody receives. Uploads get the same idea in reverse. I stream the body straight to disk or object storage, enforce a hard size limit while the bytes arrive, answer payload too large, and delete the partial file. The trade off is that once headers are sent I cannot change the status code, so a failure halfway only cuts the connection.

### Say it in 5 beats
1. Whole file in memory, per request.
2. Stream it with pipeline instead.
3. Backpressure keeps memory at one buffer.
4. Uploads: stream, hard limit, delete partials.
5. Trade-off: no status change midway.

### Case variations
- **"The files are in object storage, not on our disk."**
  > Then the best fix is not to proxy them at all. I return a short-lived signed URL, and the client downloads straight from storage. If I must proxy, I pipe the storage response stream into our response the same way.
- **"The client's connection drops halfway through a download."**
  > Pipeline sees the response close early, rejects, and destroys the file stream, so we stop reading. I log it as an aborted download, not as a server error.
- **"Someone uploads a 20 GB file to an endpoint meant for images."**
  > The limit is enforced while the bytes stream in, so we stop at the limit, answer payload too large, and remove what was written. A reverse proxy limit in front is a cheap first wall.
- **"The export is generated on the fly, not stored."**
  > Same answer, different source. I turn the database cursor into a readable stream and pipeline it into the response, so rows flow as the client reads them.

### Follow-up questions
- **Why pipeline and not pipe?** Pipe moves data with backpressure but does not destroy the other streams on an error, so a failure or a client abort leaks a file handle. Pipeline destroys everything and gives one place to catch the error.
- **What is backpressure?** A slow consumer telling a fast producer to pause. The writable side reports that its buffer is full, the source pauses, and it resumes on the drain event, so memory stays bounded.
- **Why not just raise the memory limit?** It moves the crash to a larger file or more users. Memory per request should not grow with file size at all.
- **Optional: senior. How would you support resumable downloads?** Honour the Range header. Validate the range against the file size, answer 206 with a Content-Range header, and open the read stream with start and end offsets. Express's file sending helper already does this for files on disk.

### Common wrong answers and red flags
- Reading the whole file into memory and sending it, or collecting chunks into an array and concatenating them at the end. Both cost the full file size.
- Bare `pipe` with no error handling. A client abort leaves the file stream open.
- An upload endpoint with no size limit, or a limit checked only after the whole body is saved.
- Keeping the partial file after a rejected or aborted upload.
- Raising `highWaterMark` to "go faster". It only raises the memory ceiling. Throughput is still the slowest side's rate.
- Copying code from lessons 36, 40 and 43 as is. Some of their string literals lost the `\n` escape in a scrape, so check line endings before reuse.

### Numbers to quote
In a local test, serving a 200 MB file by reading it whole raised the server's peak memory by more than 170 MB, streaming it stayed under 80 MB and barely changed between a 50 MB and a 200 MB file, and an aborted download stopped reading the file after less than 5 MB.

### Code sketch
```js
// app is an Express app; exportPath(id) returns the path of a finished export file
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
app.get('/exports/:id', async (req, res) => {
  const path = exportPath(req.params.id);
  const { size } = await stat(path);
  res.set({ 'Content-Type': 'text/csv', 'Content-Length': String(size) });
  try {
    await pipeline(createReadStream(path), res); // backpressure, and cleanup on abort
  } catch (err) {
    console.warn('download stopped', err.code); // client left; the file stream is already closed
  }
});
```

```js
// app is an Express app; uploadDir is a writable folder
import multer from 'multer';
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
app.post('/uploads', upload.single('file'), (req, res) => {
  res.status(201).json({ id: req.file.filename, size: req.file.size });
});
app.use((err, req, res, next) => {
  if (!(err instanceof multer.MulterError)) return next(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code });
});
```

Verified by [verify-st1.mjs](code/streams/verify-st1.mjs)

### Source
Lessons 23, 35, 36, 38, 41, 56, 58.

---

## ST2. A CSV export to a slow client eats server memory
**Tag: Likely**

### Scenario
"Our SaaS dashboard has a customer export that streams a large CSV to the browser. On fast connections it is fine, but when several users on slow mobile connections export at once, server memory climbs until the process restarts. The code writes each row to the response in a loop. What is wrong, and how do you fix it?"

### Questions to ask back
- **Does the loop check what the write call returns?** If it ignores it, that is the bug, and the fix is small.
- **Where do the rows come from, one big query or a cursor?** A query that loads every row first has the same memory problem before the response even starts.
- **How long may one export run?** A slow client holds a database cursor and a connection for that long, so I may need a timeout or a background job.
- **Can the export be generated once and stored?** Then it becomes a file download from storage, which is the ST1 answer.

### Spoken answer
> A slow client cannot take data as fast as we produce it. If the loop keeps writing anyway, every row waits in the server's memory, and a few slow clients can exhaust it. The signal to stop is backpressure. When a write reports that the buffer is full, I stop producing and wait for the drain event before writing again. The simplest way is to build the export as a readable stream, for example a database cursor turned into CSV rows, and connect it to the response with pipeline. Pipeline pauses the source while the client is slow, resumes it when the buffer empties, and cleans up if the client leaves. Memory then stays at about one buffer per download. The trade off is that a slow client now holds a cursor and a connection open longer, so I add a timeout.

### Say it in 5 beats
1. Slow client, fast producer, rows pile up.
2. A full buffer means stop writing.
3. Wait for drain, then continue.
4. Easiest: readable source plus pipeline.
5. Trade-off: slow clients hold connections longer.

### Case variations
- **"We cannot use streams, the CSV library returns strings."**
  > Then I keep the loop but respect the signal. If a write reports a full buffer, I await the drain event, and I also stop if the response closes, so a client that left does not hang the loop.
- **"The client disconnects in the middle of the export."**
  > With pipeline, the response closes, the source is destroyed and the cursor is released. With a hand written loop I must check for that myself, or the loop keeps querying for nobody.
- **"Exports are huge and take minutes even on fast connections."**
  > Then streaming per request is the wrong shape. I would generate the file in a background job, store it, and email a download link.
- **"Can we just increase the buffer size so it never fills?"**
  > That only raises the ceiling. A slow enough client fills any buffer, and memory per download grows. Throughput is still set by the client.

### Follow-up questions
- **What does a write returning false actually mean?** The data was accepted, but the internal buffer is over its high water mark. It is a request to pause, not an error.
- **Why does pipeline beat a hand written drain loop?** It does the same pause and resume, and also destroys every stream on an error or abort and reports one error. The hand written loop needs extra code for the close case.
- **How would you turn database rows into a stream?** Use a cursor or a streaming query, wrap it in a readable stream, and add a transform that turns each row into a CSV line, escaping commas and quotes.
- **Optional: senior. Where else does backpressure matter in a backend?** Anywhere a fast producer feeds a slow consumer: reading a queue faster than you can process it, websockets to slow clients, writing logs to a slow disk. The fix is the same idea: bound the buffer and slow the producer, or drop and measure.

### Common wrong answers and red flags
- A loop that calls write and ignores what it returns.
- Waiting for drain without also handling close. If the client leaves, drain never comes and the loop hangs. Remove whichever listener did not fire, or listeners pile up.
- Loading all rows with one query before streaming. Memory is spent before the first byte is sent.
- Raising the buffer size to hide a slow consumer.
- Lesson 37's line splitter claims to handle chunk boundaries, but it joins each Buffer chunk as a string on its own, so a multibyte character split across two chunks turns into replacement characters. Decode with a `StringDecoder`, or call `setEncoding('utf8')` on the source, before splitting lines.

### Numbers to quote
In a local test with a client that read nothing for 1.5 seconds, ignoring backpressure queued more than 80 MB of a 120 MB export in the server, while the drain loop and pipeline never queued more than 4 MB.

### Code sketch
```js
// app is an Express app; csvChunks() yields CSV text page by page, for example from a database cursor
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
app.get('/exports/customers.csv', async (req, res) => {
  res.type('text/csv').attachment('customers.csv');
  try {
    await pipeline(Readable.from(csvChunks()), res); // pauses the source while the client is slow
  } catch (err) {
    console.warn('export stopped', err.code); // client left; the source is already destroyed
  }
});
```

```js
const drainOrClose = (res) => new Promise((resolve) => {
  const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
  res.on('drain', done);
  res.on('close', done);
});
export async function exportWithDrain(res, chunks) {
  for (const chunk of chunks) {
    if (res.destroyed) return; // client left
    if (!res.write(chunk)) await drainOrClose(res); // buffer full: wait before producing more
  }
  res.end();
}
```

Verified by [verify-st2.mjs](code/streams/verify-st2.mjs)

### Source
Lessons 25, 35, 36, 37, 38.
