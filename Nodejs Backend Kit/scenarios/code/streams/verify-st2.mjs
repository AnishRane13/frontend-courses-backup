// Verifies ST2: with a slow client, ignoring backpressure buffers the whole export in the server's memory,
// while the drain loop and pipeline keep the buffered bytes small. Each variant runs in its own child process.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import { ROW_BYTES, ROWS_PER_CHUNK, csvChunks, exportIgnoring, exportWithDrain, exportWithPipeline } from './csv-export.mjs';

const MB = 1024 * 1024;
const EXPORT_MB = 120;
const variants = { ignoring: exportIgnoring, drain: exportWithDrain, pipeline: exportWithPipeline };

if (process.argv[2] === 'child') {
  // Child: one server, one variant. Samples how many bytes wait in the response buffer.
  const handler = variants[process.argv[3]];
  let maxBuffered = 0;
  const server = http.createServer(async (req, res) => {
    const timer = setInterval(() => { maxBuffered = Math.max(maxBuffered, res.writableLength); }, 5);
    res.on('close', () => clearInterval(timer));
    res.setHeader('Content-Type', 'text/csv');
    await handler(res, csvChunks(EXPORT_MB));
    maxBuffered = Math.max(maxBuffered, res.writableLength);
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const before = process.resourceUsage().maxRSS * 1024;
  process.send({ port: server.address().port });
  await once(process, 'message');
  const growthMB = (process.resourceUsage().maxRSS * 1024 - before) / MB;
  process.send({ growthMB, maxBufferedMB: maxBuffered / MB });
  server.close();
  process.disconnect();
} else {
  const results = {};
  for (const name of Object.keys(variants)) {
    const child = fork(import.meta.filename, ['child', name]);
    const [{ port }] = await once(child, 'message');
    // A slow client: it reads nothing for 1.5 seconds, then reads everything.
    const bytes = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/export.csv' }, (res) => {
        let n = 0;
        res.pause();
        setTimeout(() => res.on('data', (c) => { n += c.length; }).resume(), 1500);
        res.on('end', () => resolve(n));
      }).on('error', reject);
    });
    child.send('done');
    const [stats] = await once(child, 'message');
    await once(child, 'exit');
    results[name] = { bytes, ...stats };
    console.log(`${name}: max buffered ${stats.maxBufferedMB.toFixed(1)} MB, peak RSS growth ${stats.growthMB.toFixed(0)} MB`);
  }
  const expected = results.pipeline.bytes;
  assert.equal(expected, 'id,name,email,total\n'.length + EXPORT_MB * ROWS_PER_CHUNK * ROW_BYTES, 'the whole export arrives');
  for (const r of Object.values(results)) assert.equal(r.bytes, expected, 'every variant sends the same bytes');

  assert.ok(results.ignoring.maxBufferedMB > EXPORT_MB * 0.7, 'ignoring backpressure queues most of the export in memory');
  assert.ok(results.ignoring.growthMB > EXPORT_MB * 0.7, 'and peak memory grows by about the export size');
  for (const name of ['drain', 'pipeline']) {
    assert.ok(results[name].maxBufferedMB < 4, `${name}: buffered bytes stay bounded`);
    assert.ok(results[name].growthMB < results.ignoring.growthMB / 2, `${name}: peak memory well below the ignoring variant`);
  }

  // Lesson 37's line splitter turns each Buffer chunk into a string on its own. A character split across
  // two chunks is corrupted. A StringDecoder keeps the partial bytes until the rest arrives.
  const bytes = Buffer.from('café,crème\n');
  const chunks = [bytes.subarray(0, 4), bytes.subarray(4)]; // splits the two bytes of é
  assert.equal(chunks.map((c) => '' + c).join(''), 'caf\uFFFD\uFFFD,crème\n', 'per-chunk decoding corrupts é');
  const decoder = new StringDecoder('utf8');
  assert.equal(chunks.map((c) => decoder.write(c)).join('') + decoder.end(), 'café,crème\n', 'StringDecoder keeps it whole');
  console.log('ST2 claims hold');
}
