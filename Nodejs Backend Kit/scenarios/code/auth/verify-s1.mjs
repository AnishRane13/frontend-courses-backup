// S1: cookie session login (web) versus short JWT in a header (mobile).
// Uses express-session's default MemoryStore, which is for local tests only.
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { randomBytes } from 'node:crypto';

// Plain password compare only to keep this file short; S3 covers real hashing.
const users = new Map([['ana@example.com', { id: 'u1', password: 'right-pass' }]]);
const SECRET = randomBytes(32).toString('hex');

const app = express();
app.set('trust proxy', 1);                       // behind a TLS proxy, so Secure cookies work
app.use(express.json());
app.use(session({
  name: 'sid', secret: SECRET, resave: false, saveUninitialized: true,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 8 * 3600e3 },
}));
app.get('/whoami', (req, res) => req.session.userId ? res.json({ id: req.session.userId }) : res.status(401).end());
app.post('/login', (req, res, next) => {
  const user = users.get(req.body?.email);
  if (!user || user.password !== req.body?.password) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.regenerate((err) => {              // new id at login: defeats session fixation
    if (err) return next(err);
    req.session.userId = user.id;
    res.json({ ok: true });
  });
});
app.post('/logout', (req, res) => req.session.destroy(() => res.clearCookie('sid').end()));
app.post('/token', (req, res) => {               // mobile: short access token in the body, sent back in a header
  const user = users.get(req.body?.email);
  if (!user || user.password !== req.body?.password) return res.status(401).end();
  res.json({ accessToken: jwt.sign({ sub: user.id }, SECRET, { algorithm: 'HS256', expiresIn: '15m', issuer: 'api', audience: 'mobile' }) });
});

const https = (r) => r.set('X-Forwarded-Proto', 'https');
const sid = (res) => res.headers['set-cookie']?.find((c) => c.startsWith('sid='));

// 1. Cookie flags: HttpOnly, Secure, SameSite set explicitly.
const pre = await https(request(app).get('/whoami'));
const preCookie = sid(pre).split(';')[0];
const login = await https(request(app).post('/login')).set('Cookie', preCookie).send({ email: 'ana@example.com', password: 'right-pass' });
const cookie = sid(login);
assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);

// 2. Session id changes at login, so a planted pre-login id is useless.
const postCookie = cookie.split(';')[0];
assert.notEqual(postCookie, preCookie);
assert.equal((await https(request(app).get('/whoami')).set('Cookie', preCookie)).status, 401);
assert.equal((await https(request(app).get('/whoami')).set('Cookie', postCookie)).status, 200);

// 3. Over plain HTTP with no proxy header, a Secure cookie is not sent at all.
const plain = await request(app).post('/login').send({ email: 'ana@example.com', password: 'right-pass' });
assert.equal(plain.status, 200);
assert.equal(sid(plain), undefined);

// 4. Logout deletes the server row: a copied cookie stops working at once.
await https(request(app).post('/logout')).set('Cookie', postCookie);
assert.equal((await https(request(app).get('/whoami')).set('Cookie', postCookie)).status, 401);

// 5. JWT: verify pins algorithm, issuer and audience.
const { body: { accessToken } } = await request(app).post('/token').send({ email: 'ana@example.com', password: 'right-pass' });
const opts = { algorithms: ['HS256'], issuer: 'api', audience: 'mobile' };
assert.equal(jwt.verify(accessToken, SECRET, opts).sub, 'u1');
const otherAud = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: '15m', issuer: 'api', audience: 'billing' });
assert.throws(() => jwt.verify(otherAud, SECRET, opts), /audience invalid/);
const unsigned = jwt.sign({ sub: 'u1' }, null, { algorithm: 'none', issuer: 'api', audience: 'mobile' });
assert.throws(() => jwt.verify(unsigned, SECRET, opts));

// 6. A JWT cannot be logged out: it still verifies until it expires (15 minutes later it fails).
const { iat } = jwt.decode(accessToken);
assert.equal(jwt.verify(accessToken, SECRET, { ...opts, clockTimestamp: iat + 14 * 60 }).sub, 'u1');
assert.throws(() => jwt.verify(accessToken, SECRET, { ...opts, clockTimestamp: iat + 16 * 60 }), /jwt expired/);

console.log('S1 ok: cookie flags, id regenerated at login, Secure needs HTTPS, logout revokes session, JWT pinned and lives until expiry');
