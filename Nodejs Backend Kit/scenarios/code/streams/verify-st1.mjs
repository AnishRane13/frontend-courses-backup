// Verifies ST1: a buffered download raises peak memory by about the file size, a streamed one stays flat,
// pipeline closes the file stream when the client aborts, and uploads over the limit get 413 with no file left.
// Each memory variant runs in its own child process so the peaks are not mixed.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { buildApp } from './file-routes.mjs';

const MB = 1024 * 1024;

async function listen(app) {
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

// Downloads a URL and throws the bytes away. Returns the byte count.
function download(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', path }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve(n));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Writes a CSV-like file of sizeMB megabytes.
async function writeCsv(filePath, sizeMB) {
  const out = createWriteStream(filePath);
  const row = Buffer.from('1234567,widget,blue,19.99,2026-01-01T00:00:00Z,shipped\n'.padEnd(128, ' '));
  const block = Buffer.concat(Array(8192).fill(row)); // 1 MB
  for (let i = 0; i < sizeMB; i++) if (!out.write(block)) await once(out, 'drain');
  out.end();
  await once(out, 'finish');
}

// Starts a fresh child server, downloads one route from the parent, returns bytes and the child's peak RSS growth.
async function serveOnce(filePath, route) {
  const child = fork(import.meta.filename, ['child', filePath, route]);
  const [{ port }] = await once(child, 'message');
  const bytes = await download(port, route);
  child.send('done');
  const [{ growthMB }] = await once(child, 'message');
  await once(child, 'exit');
  return { bytes, growthMB };
}

if (process.argv[2] === 'child') {
  // Child: serve the file once through one route and report how much the peak RSS grew.
  const [, , , filePath, route] = process.argv;
  const server = await listen(buildApp({ filePath, uploadDir: join(filePath, '..', 'child-uploads'), maxUpload: MB }));
  // The client runs in the parent, so this peak is the server's alone.
  const before = process.resourceUsage().maxRSS * 1024;
  process.send({ port: server.address().port });
  await once(process, 'message');
  const growth = process.resourceUsage().maxRSS * 1024 - before;
  process.send({ growthMB: growth / MB });
  server.close();
  process.disconnect();
} else {
  await main();
}

async function main() {
  // Big files go on disk under .pgdata, not in the shared RAM-backed /tmp.
  const scratch = join(import.meta.dirname, '..', '.pgdata');
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'scen-st1-'));
  try {
    const filePath = join(dir, 'export.csv');
    const peaks = {};
    for (const sizeMB of [50, 200]) {
      await writeCsv(filePath, sizeMB);
      const buffered = await serveOnce(filePath, '/export-buffered');
      const streamed = await serveOnce(filePath, '/export');
      assert.equal(buffered.bytes, sizeMB * MB);
      assert.equal(streamed.bytes, sizeMB * MB);
      peaks[sizeMB] = { buffered: buffered.growthMB, streamed: streamed.growthMB };
      console.log(`${sizeMB} MB file: peak RSS growth buffered +${buffered.growthMB.toFixed(0)} MB, streamed +${streamed.growthMB.toFixed(0)} MB`);
    }
    // Reading the whole file: peak memory grows by about the file size.
    assert.ok(peaks[200].buffered > 170, 'buffered 200 MB should add at least 170 MB');
    assert.ok(peaks[200].buffered - peaks[50].buffered > 120, 'buffered peak should grow with the file size');
    // Streaming: a fixed ceiling, far below the file size, that barely moves when the file grows four times.
    assert.ok(peaks[200].streamed < 80, 'streamed 200 MB should stay under 80 MB');
    assert.ok(peaks[200].streamed - peaks[50].streamed < 50, 'streamed peak should not grow with the file size');

    await writeCsv(filePath, 100);
    const FILE_MB = 100;
    // Client abort: read one chunk, then hang up. pipeline must reject and destroy the file stream.
    let fileStream;
    let done;
    const finished = new Promise((r) => { done = r; });
    const uploadDir = join(dir, 'uploads');
    const server = await listen(buildApp({ filePath, uploadDir, maxUpload: MB,
      hooks: { onFileStream: (s) => { fileStream = s; }, onDone: done } }));
    const port = server.address().port;
    await new Promise((resolve) => {
      const req = http.get({ port, host: '127.0.0.1', path: '/export' }, (res) => {
        res.once('data', () => { req.destroy(); resolve(); });
      });
      req.on('error', () => {});
    });
    const err = await finished;
    assert.ok(err, 'pipeline should reject when the client aborts');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(fileStream.destroyed, true, 'file stream should be destroyed');
    assert.ok(fileStream.bytesRead < 5 * MB, 'the server stopped reading the file early');
    console.log(`client abort: pipeline rejected with ${err.code}, file stream destroyed after ${(fileStream.bytesRead / MB).toFixed(1)} MB`);

    // Upload limit: 1 MB limit. A small file is stored, a 3 MB file gets 413 and leaves nothing on disk.
    const post = async (size) => {
      const form = new FormData();
      form.append('file', new Blob([Buffer.alloc(size, 97)]), 'data.csv');
      const res = await fetch(`http://127.0.0.1:${port}/uploads`, { method: 'POST', body: form });
      return { status: res.status, body: await res.json() };
    };
    const ok = await post(200 * 1024);
    assert.equal(ok.status, 201);
    assert.equal(ok.body.size, 200 * 1024);
    assert.deepEqual(await readdir(uploadDir), [ok.body.id]);
    const big = await post(3 * MB);
    assert.equal(big.status, 413);
    assert.equal(big.body.error, 'LIMIT_FILE_SIZE');
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await readdir(uploadDir), [ok.body.id], 'the partial oversized file must be removed');
    console.log('upload limit: small file stored (201), oversized file rejected (413), no partial file left');
    server.close();
    server.closeAllConnections();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  console.log('ST1 claims hold');
}
