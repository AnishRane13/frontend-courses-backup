// Worker side of the report pool: one long-lived thread, one job per message.
import { parentPort } from 'node:worker_threads';
import { buildReport } from './cpu.mjs';

parentPort.on('message', (input) => {
  try {
    parentPort.postMessage({ result: buildReport(input) });
  } catch (err) {
    parentPort.postMessage({ error: err.message });
  }
});
