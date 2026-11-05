// A stand-in for CPU-heavy work such as building a report: it hashes in a loop for input.ms milliseconds.
// Time-bounded so the test behaves the same on a fast or a busy machine; the thread is fully busy either way.
import { createHash } from 'node:crypto';

export function buildReport({ ms = 1500, id = 'r1' } = {}) {
  const end = performance.now() + ms;
  let digest = id;
  let rounds = 0;
  while (performance.now() < end) {
    digest = createHash('sha256').update(digest).digest('hex');
    rounds++;
  }
  return { id, rounds, digest };
}
