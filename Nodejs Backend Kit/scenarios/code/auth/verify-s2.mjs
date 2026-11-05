// S2: short access tokens, refresh token rotation with reuse detection, tokens stored hashed.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { withPg } from '../lib/pg.mjs';

const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const SECRET = randomBytes(32);

await withPg(7700, async (pool) => {
  await pool.query(`CREATE TABLE refresh_tokens (token_hash text PRIMARY KEY, family_id uuid NOT NULL,
    user_id text NOT NULL, used_at timestamptz, revoked_at timestamptz, expires_at timestamptz NOT NULL)`);

  async function issue(client, userId, familyId) {
    const token = randomBytes(32).toString('base64url');
    await client.query(`INSERT INTO refresh_tokens (token_hash, family_id, user_id, expires_at)
      VALUES ($1, $2, $3, now() + interval '30 days')`, [sha256(token), familyId, userId]);
    return token;
  }
  const login = (userId) => issue(pool, userId, randomUUID());

  async function refresh(token) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: [row] } = await client.query(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
      if (!row) { await client.query('ROLLBACK'); return { status: 401 }; }
      if (row.used_at || row.revoked_at || row.expires_at < new Date()) {         // reuse: revoke the family
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [row.family_id]);
        await client.query('COMMIT');
        return { status: 401, reuse: Boolean(row.used_at) };
      }
      await client.query('UPDATE refresh_tokens SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
      const next = await issue(client, row.user_id, row.family_id);
      await client.query('COMMIT');
      const accessToken = jwt.sign({ sub: row.user_id }, SECRET, { algorithm: 'HS256', expiresIn: '10m', jwtid: randomUUID() });
      return { status: 200, refreshToken: next, accessToken };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }

  // 1. Only the hash is stored; the raw token never appears in the table.
  const t1 = await login('u1');
  const { rows: stored } = await pool.query('SELECT token_hash FROM refresh_tokens');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, sha256(t1));
  assert.notEqual(stored[0].token_hash, t1);

  // 2. Rotation: each refresh returns a new refresh token and marks the old one used.
  const r1 = await refresh(t1);
  assert.equal(r1.status, 200);
  assert.notEqual(r1.refreshToken, t1);

  // 3. Reuse of the old token (the thief, or the victim after the thief) revokes the whole family.
  const reuse = await refresh(t1);
  assert.deepEqual(reuse, { status: 401, reuse: true });
  assert.equal((await refresh(r1.refreshToken)).status, 401);       // the newest token died too
  const { rows: [{ alive }] } = await pool.query('SELECT count(*)::int AS alive FROM refresh_tokens WHERE revoked_at IS NULL');
  assert.equal(alive, 0);

  // 4. Another user's family is untouched.
  const other = await login('u2');
  assert.equal((await refresh(other)).status, 200);

  // 5. Two refreshes with the same token at the same moment: the row lock lets exactly one win.
  const t3 = await login('u3');
  const both = await Promise.all([refresh(t3), refresh(t3)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 401]);
  // ...and the loser looks like reuse, so strict rotation logs out an honest client that refreshed twice.
  const winner = both.find((r) => r.status === 200);
  assert.equal((await refresh(winner.refreshToken)).status, 401);

  // 6. Access token: short-lived; and a jti exists only if you issue one (lesson 83 denylists a jti it never sets).
  const { accessToken } = await refresh(await login('u4'));
  const p = jwt.verify(accessToken, SECRET, { algorithms: ['HS256'] });
  assert.equal(p.exp - p.iat, 600);
  assert.equal(typeof p.jti, 'string');
  const noJti = jwt.verify(jwt.sign({ sub: 'u4' }, SECRET, { expiresIn: '10m' }), SECRET, { algorithms: ['HS256'] });
  assert.equal(noJti.jti, undefined);
  const denylist = new Set([p.jti]);                                 // in production, a shared store with a TTL
  assert.equal(denylist.has(p.jti), true);

  // 7. A leaked access token stays valid until exp unless denylisted.
  assert.doesNotThrow(() => jwt.verify(accessToken, SECRET, { algorithms: ['HS256'], clockTimestamp: p.iat + 540 }));
  assert.throws(() => jwt.verify(accessToken, SECRET, { algorithms: ['HS256'], clockTimestamp: p.iat + 660 }), /jwt expired/);

  console.log('S2 ok: hashed storage, rotation, reuse revokes family, concurrent refresh one winner, short access token, jti denylist');
});
