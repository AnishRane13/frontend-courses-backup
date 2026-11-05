// S3: scrypt password storage, equal-work login for unknown users, and per-account plus per-IP rate limits.
import assert from 'node:assert/strict';
import { scrypt as scryptCb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import request from 'supertest';

const scrypt = promisify(scryptCb);
const P = { N: 16384, r: 8, p: 1 };

async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize('NFKC'), salt, 64, P);
  return ['scrypt', P.N, P.r, P.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(stored, pw) {
  const [, N, r, p, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(got, expected);
}

// 1. Per-user salt: same password, different stored strings; both verify; wrong password fails.
const h1 = await hashPassword('correct horse'), h2 = await hashPassword('correct horse');
assert.notEqual(h1, h2);
assert.equal(await verifyPassword(h1, 'correct horse'), true);
assert.equal(await verifyPassword(h2, 'correct horse'), true);
assert.equal(await verifyPassword(h1, 'wrong horse'), false);

// 2. Login timing. A real dummy hash, made at startup with the same parameters, keeps the work equal.
const users = new Map([['ana@example.com', { id: 'u1', hash: h1 }]]);
const DUMMY = await hashPassword(randomBytes(16).toString('hex'));
async function login(email, pw, { useDummy = true } = {}) {
  const user = users.get(email);
  if (!user && !useDummy) return null;                         // the leaky version: returns early
  const ok = await verifyPassword(user ? user.hash : DUMMY, pw);
  return user && ok ? user : null;
}
async function median(fn, n = 9) {
  const t = [];
  for (let i = 0; i < n; i++) { const s = performance.now(); await fn(); t.push(performance.now() - s); }
  return t.sort((a, b) => a - b)[n >> 1];
}
const wrongPw = await median(() => login('ana@example.com', 'nope'));
const unknownDummy = await median(() => login('ghost@example.com', 'nope'));
const unknownLeaky = await median(() => login('ghost@example.com', 'nope', { useDummy: false }));
assert.ok(unknownDummy / wrongPw > 0.5 && unknownDummy / wrongPw < 2, `dummy ratio ${unknownDummy / wrongPw}`);
assert.ok(wrongPw / unknownLeaky > 20, `leaky ratio ${wrongPw / unknownLeaky}`);

// 3. Lesson bugs: a 38-char bcrypt dummy is not a valid 60-char hash; password.length crashes when password is missing.
assert.equal('$2b$12$invalidinvalidinvalidinvalidinv'.length, 38);
assert.throws(() => { const { password } = {}; return password.length < 8; }, TypeError);

// 4. HTTP login: missing password is a 400, not a crash; rate limits per account and per IP.
const app = express();
app.set('trust proxy', 1);
const perIp = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
const perAccount = rateLimit({
  windowMs: 15 * 60e3, limit: 5, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: (req) => 'acct:' + String(req.body?.email ?? '').trim().toLowerCase(),
});
app.post('/login', express.json(), perIp, perAccount, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).json({ error: 'email and password required' });
  const user = await login(email.trim().toLowerCase(), password);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ ok: true });
});
const post = (ip, body) => request(app).post('/login').set('X-Forwarded-For', ip).send(body);

assert.equal((await post('10.0.0.1', { email: 'ana@example.com' })).status, 400);
const a = await post('10.0.0.1', { email: 'ana@example.com', password: 'x' });
const b = await post('10.0.0.1', { email: 'ghost@example.com', password: 'x' });
assert.equal(a.status, 401); assert.deepEqual(a.body, b.body);                // one generic message

// Credential stuffing on one account from many IPs: the per-account limit trips.
const statuses = [];
for (let i = 2; i <= 7; i++) statuses.push((await post(`10.0.1.${i}`, { email: 'Ana@Example.com', password: 'guess' + i })).status);
assert.deepEqual(statuses, [401, 401, 401, 429, 429, 429]);                 // the 400 and 401 above count too
// Trade-off: the real user, right password, new IP, is locked out too.
assert.equal((await post('10.0.2.1', { email: 'ana@example.com', password: 'correct horse' })).status, 429);

// Password spraying from one IP across many accounts: the per-IP limit trips.
const spray = [];
for (let i = 0; i < 22; i++) spray.push((await post('10.0.3.1', { email: `user${i}@example.com`, password: 'Summer2026' })).status);
assert.equal(spray.filter((s) => s === 429).length, 2);
const limited = await post('10.0.3.1', { email: 'zed@example.com', password: 'x' });
assert.equal(limited.status, 429);
assert.ok(limited.headers['retry-after']);

console.log(`S3 ok: wrong password ${wrongPw.toFixed(1)} ms, unknown user with dummy ${unknownDummy.toFixed(1)} ms, without ${unknownLeaky.toFixed(2)} ms; limits per account and per IP`);
