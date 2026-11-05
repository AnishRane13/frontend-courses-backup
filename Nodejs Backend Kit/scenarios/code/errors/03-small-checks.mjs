// __proto__ in a JSON body against a strict schema, and mapping a pg unique violation to 409.
import { z } from 'zod';
import { withPg } from '../lib/pg.mjs';

const body = JSON.parse('{"name":"Asha","__proto__":{"isAdmin":true}}');
console.log('own keys after JSON.parse:', Object.keys(body), '| body.isAdmin:', body.isAdmin);
const strict = z.object({ name: z.string() }).strict().safeParse(body);
console.log('strict schema:', strict.success ? 'accepted ' + JSON.stringify(strict.data) : 'rejected: ' + strict.error.issues[0].message);
const merged = Object.assign({}, body);
console.log('Object.assign({}, body).isAdmin:', merged.isAdmin, '| ({}).isAdmin:', ({}).isAdmin);

await withPg(7611, async (pool) => {
  await pool.query('CREATE TABLE users (id serial PRIMARY KEY, email text UNIQUE NOT NULL)');
  await pool.query(`INSERT INTO users (email) VALUES ('a@x.io')`);
  try { await pool.query(`INSERT INTO users (email) VALUES ('a@x.io')`); }
  catch (err) {
    console.log('pg error:', { code: err.code, constraint: err.constraint, detail: err.detail });
    const mapped = err.code === '23505' ? { status: 409, code: 'EMAIL_TAKEN' } : { status: 500, code: 'INTERNAL' };
    console.log('mapped to:', mapped);
  }
});
