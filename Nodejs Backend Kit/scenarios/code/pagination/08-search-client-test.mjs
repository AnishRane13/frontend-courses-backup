// Drives search-client.mjs against a server where the first query answers slowly.
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { createSearch } from './search-client.mjs';

let calls = 0;
const server = http.createServer(async (req, res) => {
  calls++;
  const q = new URL(req.url, 'http://x').searchParams.get('q');
  await sleep(q === 'an' ? 600 : 50);            // the older query is the slow one
  res.end(JSON.stringify({ q, rows: [`${q}@mail.com`] }));
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const shown = [];
const search = createSearch((url, opts) => fetch(base + url, opts), (text, body) => shown.push(body.q), 250);

for (const t of ['a', 'an']) { search(t); await sleep(40); }   // fast typing: one request
await sleep(300);                                               // pause: "an" request starts
for (const t of ['ani', 'anis', 'anish']) { search(t); await sleep(40); }
await sleep(1200);
console.log('keystrokes 5 | requests sent', calls, '| results rendered', JSON.stringify(shown));
server.close();
