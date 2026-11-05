// GET /orders?limit=20&after=<cursor>  keyset pagination, newest first. The handler body is the P1 Code sketch.
import express from 'express';
import { z } from 'zod';

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  after: z.string().max(200).optional(),
});
const Cursor = z.tuple([z.string(), z.string().regex(/^\d+$/)]); // [created_at text, id]
const encodeCursor = (row) => Buffer.from(JSON.stringify([row.ts, row.id])).toString('base64url');
const decodeCursor = (s) => { try { return Cursor.parse(JSON.parse(Buffer.from(s, 'base64url'))); } catch { return null; } };

const ORDER = 'ORDER BY created_at DESC, id DESC';
const FIRST_PAGE = `SELECT id, total, created_at::text AS ts FROM orders ${ORDER} LIMIT $1`;
const NEXT_PAGE = `SELECT id, total, created_at::text AS ts FROM orders
  WHERE (created_at, id) < ($1::timestamptz, $2::bigint) ${ORDER} LIMIT $3`;

export function ordersApp(pool) {
  const app = express();
  app.get('/orders', async (req, res) => {
    const q = Query.safeParse(req.query);                  // limit 1 to 100, default 20; cursor string
    const cur = q.success && q.data.after ? decodeCursor(q.data.after) : null; // [ts text, id] or null
    if (!q.success || (q.data.after && !cur)) return res.status(422).json({ error: 'Invalid query' });
    const { limit } = q.data;
    const { rows } = cur ? await pool.query(NEXT_PAGE, [...cur, limit + 1]) : await pool.query(FIRST_PAGE, [limit + 1]);
    const page = rows.slice(0, limit);
    res.json({ data: page, nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null });
  });
  return app;
}
