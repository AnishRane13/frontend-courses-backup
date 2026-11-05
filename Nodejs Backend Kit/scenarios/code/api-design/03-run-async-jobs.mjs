import request from 'supertest';
import { setTimeout as sleep } from 'node:timers/promises';
import { exportsApp } from './async-jobs.mjs';
const app = exportsApp(async (id) => { await sleep(300); return `/files/${id}.csv`; });
const created = await request(app).post('/exports');
console.log('POST /exports      ', created.status, '| Location:', created.headers.location.replace(/[0-9a-f-]{36}/, '<id>'), JSON.stringify({ ...created.body, id: '<id>' }));
for (const wait of [0, 400]) {
  await sleep(wait);
  const s = await request(app).get(created.headers.location);
  console.log(`GET status +${wait}ms`.padEnd(19), s.status, JSON.stringify({ ...s.body, id: '<id>', url: s.body.url?.replace(/[0-9a-f-]{36}/, '<id>') }), '| Retry-After:', s.headers['retry-after'] ?? null);
}
