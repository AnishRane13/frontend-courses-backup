import request from 'supertest';
import { versionedApp } from './versioning.mjs';
for (const [label, app] of [['deprecation before v1', versionedApp()], ['deprecation after v1 (bug)', versionedApp({ deprecationFirst: false })]]) {
  const r = await request(app).get('/v1/users/7');
  console.log(label.padEnd(28), r.status, JSON.stringify(r.body), '| Deprecation:', r.headers.deprecation ?? null, '| Sunset:', r.headers.sunset ?? null);
}
const r2 = await request(versionedApp()).get('/v2/users/7');
console.log('v2'.padEnd(28), r2.status, JSON.stringify(r2.body), '| Deprecation:', r2.headers.deprecation ?? null);
