// Three ways to stream a CSV export to a client, for scenario ST2. Used by verify-st2.mjs.
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Yields the CSV in chunks of about 1 MB (8,000 rows each), like pages read from a database.
export const ROW_BYTES = 131;
export const ROWS_PER_CHUNK = 8000;
export function* csvChunks(chunkCount) {
  yield Buffer.from('id,name,email,total\n');
  for (let page = 0; page < chunkCount; page++) {
    const buf = Buffer.allocUnsafe(ROWS_PER_CHUNK * ROW_BYTES);
    for (let i = 0; i < ROWS_PER_CHUNK; i++) {
      const id = page * ROWS_PER_CHUNK + i;
      const row = `${id},customer ${id},user${id}@example.com,${(id % 997) + 0.99}`.padEnd(ROW_BYTES - 1, ' ') + '\n';
      buf.write(row, i * ROW_BYTES, 'latin1');
    }
    yield buf;
  }
}

// Wrong: ignores the boolean from write, so every chunk piles up in memory behind a slow client.
export function exportIgnoring(res, chunks) {
  for (const chunk of chunks) res.write(chunk);
  res.end();
}

// Right by hand: pause on false, wait for drain. Stop if the client has gone.
export async function exportWithDrain(res, chunks) {
  for (const chunk of chunks) {
    if (res.destroyed) return;
    if (!res.write(chunk)) await drainOrClose(res);
  }
  res.end();
}

// Resolves on drain, or on close so a client that left does not hang the loop. Removes both listeners.
function drainOrClose(res) {
  return new Promise((resolve) => {
    const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
    res.on('drain', done);
    res.on('close', done);
  });
}

// Right and shortest: pipeline does the pause and resume, and cleans up on abort.
export async function exportWithPipeline(res, chunks) {
  await pipeline(Readable.from(chunks), res);
}
