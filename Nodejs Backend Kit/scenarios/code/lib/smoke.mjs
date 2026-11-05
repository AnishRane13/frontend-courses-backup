import { withPg } from './pg.mjs';
await withPg(7600, async (pool) => {
console.log((await pool.query('select version()')).rows[0].version);
});
