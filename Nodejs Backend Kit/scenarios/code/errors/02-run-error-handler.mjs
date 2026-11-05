import request from 'supertest';
import express from 'express';
import { AppError, notFound, errorHandler } from './error-handler.mjs';
const logged = [];
const app = express();
app.use(express.json({ limit: '1kb' }));
app.get('/orders/:id', async (req) => { throw new AppError(404, 'ORDER_NOT_FOUND', `Order ${req.params.id} not found`); });
app.get('/bug', async () => { const user = undefined; return user.name; });       // a programmer error in an async route
app.post('/echo', (req, res) => res.json(req.body));
app.use(notFound);
app.use(errorHandler({ error: (o, m) => logged.push(`${m}: ${o.err.message}`) }));
const show = (label, r) => console.log(label.padEnd(24), r.status, r.headers['content-type'].split(';')[0], JSON.stringify(r.body));
show('known 404 (async)', await request(app).get('/orders/42'));
show('bug in async route', await request(app).get('/bug'));
show('broken JSON', await request(app).post('/echo').set('Content-Type', 'application/json').send('{"a":'));
show('body too large', await request(app).post('/echo').send({ a: 'x'.repeat(5000) }));
show('unknown route', await request(app).get('/nope'));
console.log('server log:', logged);
