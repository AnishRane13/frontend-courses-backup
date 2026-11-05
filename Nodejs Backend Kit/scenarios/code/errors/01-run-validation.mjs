import request from 'supertest';
import express from 'express';
import { signupApp } from './signup-validation.mjs';
const db = [];
const app = signupApp({ create: async (u) => { db.push(u); return { id: db.length, ...u }; } }, async (p) => 'hashed:' + p.length);
const post = (body, raw) => raw ? request(app).post('/signup').set('Content-Type', 'application/json').send(raw) : request(app).post('/signup').send(body);
const show = (label, r) => console.log(label.padEnd(30), r.status, JSON.stringify(r.body));
const ok = { email: 'asha@example.com', password: 'correct horse battery', name: 'Asha' };
show('valid', await post(ok));
show('extra role: admin', await post({ ...ok, role: 'admin' }));
show('bad email, short password', await post({ ...ok, email: 'nope', password: 'x' }));
show('broken JSON', await post(null, '{"email": '));
show('body too large', await post({ ...ok, name: 'a'.repeat(20000) }));
console.log('stored roles:', db.map((u) => u.role), '| stored keys:', Object.keys(db[0]));

// Strip mode instead of strict: the attack is dropped silently
const { z } = await import('zod');
console.log('strip mode output:', JSON.stringify(z.object({ name: z.string() }).parse({ name: 'Asha', role: 'admin' })));

// Express 5: req.query is a getter. Writing parsed values back throws in ESM (strict mode).
const q = express();
q.get('/x', (req, res) => { try { req.query = { page: 1 }; res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
show('assign req.query (Express 5)', await request(q).get('/x?page=1'));
const a = express();
a.get('/x', (req, res) => res.json({ page: req.query.page, type: typeof req.query.page }));
show('repeated key ?page=1&page=2', await request(a).get('/x?page=1&page=2'));
