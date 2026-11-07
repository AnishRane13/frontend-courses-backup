# 06. Streams and buffers

> **Remember this**
> 1. Reading a whole file into memory costs its full size, for every request. Streaming keeps only a small piece in memory, however big the file is.
> 2. Connect streams with pipeline, not bare pipe. Pipeline pauses the source for a slow reader and closes every stream if one fails or the client leaves.
> 3. When a write returns false, it means "stop for now". Wait for the drain event before writing more, or let pipeline do it for you.
> 4. Every upload needs a hard size limit that is checked while the bytes arrive. Delete the half-written file when you reject it.
> 5. Turn bytes into text with a decoder that holds back half characters. Converting each chunk on its own breaks characters split across two chunks.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Stream | Data handled piece by piece as it arrives, instead of all at once. |
| Readable stream | A source you read pieces from, such as a file or an incoming request body. |
| Writable stream | A destination you write pieces to, such as a file or an HTTP response. |
| Buffer | Node's object for holding raw bytes in memory. |
| Chunk | One piece of data that a stream hands over at a time. |
| Memory, or RSS | RSS means resident set size. It is how much memory the operating system says the process is really using. |
| Out of memory | The process needs more memory than it is allowed to have, so it crashes. |
| Pipe | The older way to connect a readable stream to a writable one. It pauses the source correctly, but it does not close the other streams when one fails. |
| Pipeline | A helper that connects streams in a chain, pauses the source when needed, and destroys every stream if any one fails. |
| Backpressure | A slow reader telling a fast source to pause until it catches up. |
| High water mark | The buffer size at which a stream says "I am full, please pause". A file read stream uses 64 KB by default. |
| Drain | The event a writable stream sends when its buffer has emptied and it is ready for more. |
| Abort | The client closes the connection before the response is finished. |
| Destroy | Closing a stream for good and releasing what it holds, such as an open file or a database cursor. |
| Multipart upload | The format a browser form uses to send files. The body is split into parts, one per field or file. |
| Payload too large | The HTTP status 413. It tells the client that the body is over the size limit. |
| Signed URL | A link to a file in object storage that works without logging in, but only for a short time. |
| Range request | A request for only part of a file, used to resume a download where it stopped. |
| Database cursor | A way to read query results a few rows at a time instead of loading them all at once. |
| String decoder | A Node tool that turns bytes into text and keeps an incomplete character until the next chunk arrives. |

| # | Scenario | Tag |
|---|---|---|
| ST1 | [Large file downloads and uploads run out of memory](#st1-large-file-downloads-and-uploads-run-out-of-memory) | Must know |
| ST2 | [A CSV export to a slow client eats server memory](#st2-a-csv-export-to-a-slow-client-eats-server-memory) | Likely |

---

## ST1. Large file downloads and uploads run out of memory
**Tag: Must know**

### Before you speak
- **Today:** the download handler reads the whole export file into memory and then sends it. Uploads are handled the same way: the whole body is collected first.
- **What goes wrong:** a 2 GB export costs about 2 GB of memory while it is being sent. A few users downloading at once each need their own copy, so the process passes its memory limit and crashes.
- **The fix:** stream the file. Open a read stream on the file and connect it to the response with pipeline. The file is read in small chunks, and each chunk is sent before more is read.
- **Why the fix works:** pipeline respects backpressure. If the client is slow, the response buffer fills and the file read pauses, so only a small buffer sits in memory whatever the file size. If the client leaves, pipeline destroys the file stream, so the server stops reading.
- **Uploads:** stream the body straight to disk or storage and count bytes as they arrive. Past the limit, stop, answer 413 payload too large, and delete the partial file.
- **The trade-off to mention:** once the headers and the first bytes are sent, the status code is fixed. If something fails halfway, the server can only cut the connection.

### Scenario
"Our file service lets users download their data exports, some of them 2 GB, and upload files to attach to records. When a few users download big exports at the same time, the process crashes with out of memory. How would you fix downloads, and what would you check on uploads?"

### Questions to ask back
- **How does the handler read the file today?** If it loads the whole file before sending, that alone explains the crash, and streaming fixes it.
- **Where do the files live, on our disk or in object storage?** With object storage I can hand out a signed URL, so the bytes never pass through our server at all.
- **What is the largest upload we must accept?** That number becomes the hard limit. A very large limit pushes me toward uploads that go straight to storage.
- **Do clients need to resume broken downloads?** Then I add range requests. A read stream can start at any byte, so this fits well.

### Spoken answer
> The crash happens because the handler reads the whole file into memory before sending it. A big export then costs its full size in memory, for every user downloading at once. I would stream it instead. I open a read stream on the file and connect it to the response with pipeline. Pipeline respects backpressure, meaning a slow client pauses the read, so memory stays at a small buffer however big the file is. It also destroys the file stream if the client disconnects, so we stop reading a file nobody receives. Uploads get the same idea in reverse. I stream the body straight to disk or object storage, enforce a hard size limit while the bytes arrive, answer payload too large, and delete the partial file. The trade off is that once headers are sent I cannot change the status code, so a failure halfway only cuts the connection.

### Say it in 5 beats
1. Whole file in memory, per request.
2. Stream it with pipeline instead.
3. A slow client pauses the read.
4. Uploads: stream, hard limit, delete partials.
5. Trade-off: status is fixed once sending starts.

### Case variations
- **"The files are in object storage, not on our disk."**
  > Then the best fix is to not send them through our server at all. I return a signed URL, a link that works for a few minutes, and the client downloads straight from storage. If we must pass the file through, I pipeline the storage response stream into our response the same way.
- **"The client's connection drops halfway through a download."**
  > The response closes early, so pipeline rejects and destroys the file stream. We stop reading a file nobody will receive. I log it as an aborted download, not as a server error, because the client chose to leave.
- **"Someone uploads a 20 GB file to an endpoint meant for images."**
  > The limit is checked while the bytes stream in, so we stop at the limit, not after the whole file. We answer 413 payload too large and delete what was already written. I would also set a body size limit on the reverse proxy in front, which is a cheap first wall.
- **"The export is generated on the fly, not stored."**
  > The source changes, but the answer stays the same. I read the rows through a database cursor, which fetches a few rows at a time, and turn it into a readable stream. Then I pipeline it into the response, so rows are only fetched as fast as the client reads them.

### Follow-up questions
- **Why pipeline and not pipe?** Pipe pauses the source correctly, but when one stream fails it does not close the others. A client abort then leaves the file stream open, which leaks a file handle, an open file the process never closes. Pipeline destroys every stream in the chain and gives you one place to catch the error.
- **What is backpressure?** A slow reader telling a fast source to pause. The writable side reports that its buffer is full, the source stops, and it starts again when the drain event fires. So memory stays bounded.
- **Why not just raise the memory limit?** It only moves the crash to a bigger file or more users. With streaming, memory per request does not grow with the file size at all.
- **Optional: senior. How would you support resumable downloads?** Support range requests, where the client asks for only some bytes through the Range header. Check the range against the file size, answer 206 partial content with a Content-Range header, and open the read stream with start and end offsets. Express's file sending helper already does this for files on disk.

### Common wrong answers and red flags
- Reading the whole file into memory and sending it, or collecting all chunks in an array and joining them at the end. Both cost the full file size.
- Using bare pipe with no error handling. A client abort leaves the file stream open.
- An upload endpoint with no size limit, or a limit checked only after the whole body is saved.
- Keeping the partial file after an upload was rejected or aborted.
- Raising the high water mark to "go faster". It only raises how much memory each download may use. The speed is still set by the slowest side.
- Copying stream examples without running them once. A broken line break inside a string is easy to miss, and the code will not run.

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

### Before you speak
- **Today:** the export handler loops over the rows and writes each CSV line to the response. It never looks at what the write call returns.
- **What goes wrong:** a client on a slow mobile connection takes bytes much slower than the loop produces them. Every write is still accepted and queued in the server's memory. With a few slow clients at once, memory climbs until the process restarts.
- **The signal that was ignored:** write returns false when the response buffer is over its high water mark. That means "stop for now". The drain event later means "ready for more".
- **The fix:** build the export as a readable stream, for example rows from a database cursor turned into CSV text, and connect it to the response with pipeline. Pipeline pauses the source while the client is slow and resumes it when the buffer drains.
- **If you keep the loop:** when write returns false, wait for drain or close, whichever comes first, before writing again. Waiting only for drain hangs forever if the client leaves.
- **The trade-off to mention:** a slow client now keeps a database cursor and a connection open for longer, so add a timeout, or move very large exports to a background job.

### Scenario
"Our SaaS dashboard has a customer export that streams a large CSV to the browser. On fast connections it is fine, but when several users on slow mobile connections export at once, server memory climbs until the process restarts. The code writes each row to the response in a loop. What is wrong, and how do you fix it?"

### Questions to ask back
- **Does the loop check what the write call returns?** If it ignores it, that is the bug, and the fix is small.
- **Where do the rows come from, one big query or a cursor?** A query that loads every row first has the same memory problem before the response even starts.
- **How long may one export run?** A slow client holds a database cursor and a connection for that whole time, so I may need a timeout or a background job.
- **Can the export be built once and stored?** Then it becomes a plain file download from storage, like the stored export case.

### Spoken answer
> A slow client cannot take data as fast as we produce it. If the loop keeps writing anyway, every row waits in the server's memory, and a few slow clients can exhaust it. The signal to stop is backpressure. When a write reports that the buffer is full, I stop producing and wait for the drain event before writing again. The simplest way is to build the export as a readable stream, for example a database cursor turned into CSV rows, and connect it to the response with pipeline. Pipeline pauses the source while the client is slow, resumes it when the buffer empties, and cleans up if the client leaves. Memory then stays at about one buffer per download. The trade off is that a slow client now holds a cursor and a connection open longer, so I add a timeout.

### Say it in 5 beats
1. Slow client, fast loop, rows pile up.
2. Write returns false: stop writing.
3. Wait for drain, then continue.
4. Easiest: readable source plus pipeline.
5. Trade-off: slow clients hold connections longer.

### Case variations
- **"We cannot use streams, the CSV library returns strings."**
  > Then I keep the loop but obey the signal. When a write returns false, I wait for the drain event before writing more. I also stop waiting if the response closes, because a client that left will never trigger drain and the loop would hang.
- **"The client disconnects in the middle of the export."**
  > With pipeline, the response closes, the source is destroyed and the database cursor is released. With a hand written loop, I must check for the close myself. Otherwise the loop keeps querying the database for nobody.
- **"Exports are huge and take minutes even on fast connections."**
  > Then streaming inside one request is the wrong shape. I would build the file in a background job, store it, and email a download link. The download is then a plain file stream with a small, steady memory cost.
- **"Can we just increase the buffer size so it never fills?"**
  > That only raises the ceiling. A slow enough client fills any buffer, and each download now uses more memory. The speed is still set by the client, not by the buffer.

### Follow-up questions
- **What does a write returning false actually mean?** The data was accepted, but the buffer is now over its high water mark, the size at which the stream asks you to pause. It is a request to wait, not an error.
- **Why does pipeline beat a hand written drain loop?** It does the same pause and resume. It also destroys every stream on an error or a client abort, and reports one error. A hand written loop needs extra code for the close case.
- **How would you turn database rows into a stream?** Read them with a cursor or a streaming query and wrap that in a readable stream. Then add a transform stream, a step that changes each chunk as it passes, to turn each row into a CSV line, escaping commas and quotes.
- **Optional: senior. Where else does backpressure matter in a backend?** Anywhere a fast producer feeds a slow consumer: pulling from a queue faster than you can process the jobs, sending on WebSockets to slow clients, or writing logs to a slow disk. The fix is the same idea. Put a limit on the buffer, then either slow the producer or drop data and count what you dropped.

### Common wrong answers and red flags
- A loop that calls write and ignores what it returns.
- Waiting for drain without also handling close. If the client leaves, drain never comes and the loop hangs. Remove whichever listener did not fire, or listeners pile up.
- Loading all rows with one query before streaming. The memory is spent before the first byte is sent.
- Raising the buffer size to hide a slow consumer.
- Turning each chunk of bytes into text on its own before splitting lines. A character made of several bytes can be cut across two chunks and turns into garbage. Use a string decoder, or set the source's encoding to utf8, before splitting lines.

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
