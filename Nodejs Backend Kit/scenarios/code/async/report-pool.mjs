// report-worker.mjs runs buildReport and posts back { result } or { error }
import { Worker } from 'node:worker_threads';
const idle = [], queue = [];
for (let i = 0; i < 2; i++) idle.push(new Worker(new URL('./report-worker.mjs', import.meta.url)));
export const runReport = (input) => new Promise((resolve, reject) => { queue.push({ input, resolve, reject }); pump(); });
function pump() {
  while (idle.length && queue.length) {
    const worker = idle.pop(), job = queue.shift();
    worker.once('message', ({ result, error }) => {
      idle.push(worker); pump();
      error ? job.reject(new Error(error)) : job.resolve(result);
    });
    worker.postMessage(job.input);
  }
}

// Not in the sketch: stops the threads for a test or a graceful shutdown. Call it when no job is running.
export const closePool = () => Promise.all(idle.map((w) => w.terminate()));
