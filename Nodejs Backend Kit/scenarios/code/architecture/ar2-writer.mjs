// The order service's write path, run as its own process so it can really crash.
// Usage: node ar2-writer.mjs <port> <mode> <customer>
// Modes: naive-crash   commit the order, then die before publishing (dual write)
//        outbox-crash-before-commit   insert order and outbox row, die before COMMIT
//        outbox-crash-after-commit    commit order and outbox row, die before any relay runs
// broker_messages stands in for the message broker: a separate system, written outside the order transaction.
import pg from 'pg';

const [port, mode, customer] = process.argv.slice(2);
const pool = new pg.Pool({ host: '127.0.0.1', port: Number(port), user: 'postgres', password: 'pw', database: 'postgres' });
pool.on('error', () => {});
const c = await pool.connect();

await c.query('BEGIN');
const { rows: [o] } = await c.query(`INSERT INTO orders (customer, sku, qty) VALUES ($1, 'sku-1', 1) RETURNING id`, [customer]);
if (mode === 'naive-crash') {
  await c.query('COMMIT');
  process.exit(3);                                    // the publish below never happens
  // await publish({ type: 'order.placed', orderId: o.id });
}
await c.query(`INSERT INTO outbox (event_type, payload) VALUES ('order.placed', $1)`, [{ orderId: o.id, sku: 'sku-1', qty: 1 }]);
if (mode === 'outbox-crash-before-commit') process.exit(3);
await c.query('COMMIT');
if (mode === 'outbox-crash-after-commit') process.exit(3);
