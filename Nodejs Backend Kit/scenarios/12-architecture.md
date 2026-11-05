# 12. Architecture

> **Remember this**
> 1. Start with a modular monolith. Split a module out only for a real reason: team independence, a hot part to scale, or a different release pace.
> 2. A module or service owns its data. Others call its API, never its tables.
> 3. Commit to the database, then publish, is a dual write. A crash between the two loses the event.
> 4. Transactional outbox: business row and event row in one transaction, then a relay publishes after commit, with no transaction open while it publishes.
> 5. Delivery is at least once, so consumers record processed message ids. Sagas undo with compensating steps, not rollbacks.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| AR1 | [The CTO wants to split an eight-developer monolith into microservices](#ar1-the-cto-wants-to-split-an-eight-developer-monolith-into-microservices) | Likely |
| AR2 | [An order is saved but inventory never hears about it](#ar2-an-order-is-saved-but-inventory-never-hears-about-it) | Must know |

---

## AR1. The CTO wants to split an eight-developer monolith into microservices
**Tag: Likely**

### Scenario
"Our e-commerce startup runs one Node monolith with eight developers. Deploys are getting scary and features step on each other, and the CTO wants to move to microservices. What would you recommend?"

### Questions to ask back
- **What hurts today?** Slow deploys, teams blocking each other, and one hot endpoint each have a different fix.
- **Do we have CI, monitoring, tracing and on-call in place?** Without them, many services multiply the pain.
- **Which part changes or scales differently from the rest?** That is the first candidate to split, if any.
- **How tangled is the database?** If every feature joins across every table, the boundaries come first, before any split.

### Spoken answer
> I would not start with a big split. At this team size, microservices mostly add cost: network calls that fail, no shared transactions, and many deploys to watch. First I would make the monolith modular. Each business area, like orders, inventory and payments, becomes a module with a small public interface and its own tables. Other modules call that interface, never the tables, and a check in the build enforces it. That removes most of the tangle and keeps one deploy. Then I would split a module out only for a real reason. A team that needs to ship on its own, a part that must scale differently, or a different release pace. Because the boundary already exists, the split is mostly moving code and giving it its own database. The trade off is discipline now instead of infrastructure, and the monolith still deploys as one unit.

### Say it in 5 beats
1. Microservices add network and ops costs.
2. First, a modular monolith.
3. Modules own tables, expose small APIs.
4. Split only for a real reason.
5. Trade-off: discipline now, one deploy.

### Case variations
- **"Black Friday traffic only hits the product catalog."**
  > First I run more copies of the monolith, which is often cheaper. If the catalog then needs a different setup, like heavy caching or its own database, that is a real reason to split it first.
- **"Two teams keep breaking each other's code."**
  > That is a boundary problem before it is a deployment problem. Clear module owners, one interface per module, and a boundary check in the build fix most of it. If the teams also need separate release schedules, that module is the first to split.
- **"We already split, and every request now calls five services in a row."**
  > That is a distributed monolith. I would merge services that always change together, and use events for work that does not need an answer right away.
- **"Can the services share one database to keep it simple?"**
  > They can share a database server, but not tables. If two services write the same table, a schema change breaks both, and the split loses its main benefit.

### Follow-up questions
- **How do you enforce boundaries inside a monolith?** Each module exports one entry file. A lint rule or a small script fails the build if a file imports another module's internals. Each table has one owning module, ideally one schema per module.
- **How do modules talk to each other?** Plain function calls through the public interface, or in-process events for side effects. After a split, those become network calls or messages.
- **What do you lose when you split?** Transactions across the two parts, simple joins, and simple debugging. You gain timeouts, retries, tracing and eventual consistency, which is AR2.
- **Optional: senior. How do you move a module out without a big-bang rewrite?** The strangler approach. The module already sits behind its interface. I put a client in front of it that can call in process or over the network, move its tables to a new database with a period of syncing, then switch the client. Each step can be rolled back.

### Common wrong answers and red flags
- "Microservices, because the big tech companies use them." Choose for a problem you have.
- Splitting by technical layer, such as an API service and a database service, instead of by business area.
- Services that share tables.
- Long synchronous chains for one request. Any one failure or slow hop breaks the whole request.
- Copying lesson 113's toy circuit breaker. Its half-open comment says "allow one probe", but every concurrent call goes through. A correct half-open state lets one probe through and fails the rest fast until the probe returns.

### Numbers to quote
No figures needed.

### Code sketch
```js
// shop/orders/index.mjs: the orders module's public API.
import * as inventory from '../inventory/index.mjs';   // other modules only through their index
import { saveOrder, countOrders } from './repo.mjs';    // own data, private to this module

export function placeOrder({ sku, qty }) {
  const r = inventory.reserve(sku, qty);
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, order: saveOrder({ sku, qty }) };
}
export const orderCount = () => countOrders();
```

```js
// boundaries.mjs: a file may import another module only through that module's index.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
export function findViolations(root) {
  const out = [];
  for (const mod of readdirSync(root)) {
    for (const file of readdirSync(join(root, mod)).filter((f) => f.endsWith('.mjs'))) {
      for (const [, spec] of readFileSync(join(root, mod, file), 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const [target, ...rest] = relative(root, resolve(dirname(join(root, mod, file)), spec)).split(sep);
        if (target !== mod && rest.join('/') !== 'index.mjs') out.push(`${mod}/${file} -> ${target}/${rest.join('/')}`);
      }
    }
  }
  return out;
}
```

Verified by [verify-ar1.mjs](code/architecture/verify-ar1.mjs)

### Source
Lessons 113, 60.

---

## AR2. An order is saved but inventory never hears about it
**Tag: Must know**

### Scenario
"Our order service saves an order in its database, then publishes an order placed event so the inventory service can reserve stock. Sometimes an order exists but stock was never reserved. How do you keep the two services consistent without a shared transaction?"

### Questions to ask back
- **Can inventory refuse, for example when stock runs out?** Then reliable delivery is not enough. I need a saga with a compensating step.
- **How fast must inventory catch up?** A delay of seconds suits an outbox relay. If the user must see the reservation right away, that part needs a synchronous call.
- **Does the broker keep order per order id?** That decides how the relay publishes and whether consumers must handle events out of order.
- **Does the consumer already remove duplicates?** If not, at least once delivery will apply some events twice.

### Spoken answer
> This is the dual write problem. The service commits the order, then publishes, and a crash between the two loses the event for good. I would use a transactional outbox. In the same database transaction as the order, I insert an event row into an outbox table, so both commit or neither does. A separate relay claims unsent rows, commits that claim, publishes, then marks them sent. It never keeps a transaction open while it publishes. If the relay dies after publishing but before marking, the row goes out again, so delivery is at least once. The inventory consumer records each event id in a processed messages table, in the same transaction as the stock change, and skips ids it has seen. If inventory can refuse, a saga cancels the order as a compensating step. The trade off is eventual consistency and one more process to run.

### Say it in 5 beats
1. Commit, then publish, loses events.
2. Outbox row in the same transaction.
3. Relay claims, publishes, then marks sent.
4. Consumer skips event ids it saw.
5. Trade-off: eventual consistency, extra relay.

### Case variations
- **"Why not publish first, then commit?"**
  > Then a failed commit leaves an event for an order that does not exist. Both orders of a dual write are wrong. Only one local transaction for both rows is safe.
- **"Inventory is out of stock after the order was accepted."**
  > That is a saga. Inventory publishes a reservation failed event, and the order service runs a compensating step: cancel the order and refund. Each step and each compensation must be idempotent.
- **"Can we use change data capture instead of a polling relay?"**
  > Yes. A tool like Debezium reads the outbox table from the database log and publishes it, so nothing polls. It is more infrastructure, and it is still at least once.
  > Unverified: needs Debezium and Kafka.
- **"Payment is in the flow too, and it takes several seconds."**
  > Then I orchestrate the saga. One order process tracks the state, calls payment and inventory, and on failure runs the compensations in reverse order. A timeout becomes a state to handle, not an exception.

### Follow-up questions
- **Why not a distributed transaction across both services?** Most brokers and many managed databases do not support two-phase commit, it blocks when the coordinator fails, and it ties the availability of both services together.
- **How do you run several relays?** Each claims a batch in one short statement that skips rows other relays have locked, and sets a lease, so each row goes to one relay at a time. A crashed relay's rows come back after the lease.
- **Does the outbox keep events in order?** One relay publishes by id, but with several relays or retries, order is not guaranteed. Partition by order id in the broker, and make consumers tolerate old events, for example with a version check.
- **Optional: senior. Lesson 114's outbox relay looks fine. What is wrong with it?** It selects rows with locks, publishes, and marks them sent, all inside one open transaction. During every publish the connection sits idle in a transaction, holding row locks and holding back vacuum, and a slow broker stretches that. Lessons 113 and 75 claim with a short statement and a lease instead. The local script shows one session idle in a transaction during publish with lesson 114's shape, and none with the claim and lease shape.

### Common wrong answers and red flags
- "Just retry the publish." After a crash there is nothing left to retry from.
- Publishing before the commit. A rolled-back order still sends its event.
- Copying lesson 114's outbox relay, which keeps the transaction open while it publishes.
- Consumers that assume exactly once delivery.
- Recording the processed message id in a different transaction from the stock change.
- Never cleaning up sent outbox rows, so the table grows forever.

### Numbers to quote
In a local test, a process that crashed between commit and publish lost the event with dual write, the outbox kept it for the relay to publish later, a relay crash after publishing produced one duplicate, and the consumer applied 23 distinct events from 24 messages, once each.

### Code sketch
```js
// c is a pg client from pool.connect(); order and msg are plain objects
await c.query('BEGIN');                                          // order service: one transaction
const { rows: [o] } = await c.query(`INSERT INTO orders (customer, sku, qty)
  VALUES ($1, $2, $3) RETURNING id`, [order.customer, order.sku, order.qty]);
await c.query(`INSERT INTO outbox (event_type, payload) VALUES ('order.placed', $1)`,
  [{ orderId: o.id, sku: order.sku, qty: order.qty }]);
await c.query('COMMIT');                                         // both rows or neither

await c.query('BEGIN');                                          // inventory consumer: dedupe and effect together
const fresh = await c.query(`INSERT INTO processed_messages VALUES ($1)
  ON CONFLICT DO NOTHING RETURNING 1`, [msg.event_id]);
if (fresh.rowCount) await c.query('UPDATE stock SET qty = qty - $2 WHERE sku = $1',
  [msg.payload.sku, msg.payload.qty]);
await c.query('COMMIT');
```

```js
// pool is a pg Pool; publish(row) sends one event; name, leaseMs and batch configure this relay
const { rows } = await pool.query(`
  UPDATE outbox SET claimed_by = $1, claimed_until = clock_timestamp() + make_interval(secs => $2 / 1000.0)
  WHERE id IN (SELECT id FROM outbox WHERE sent_at IS NULL AND claimed_until < clock_timestamp()
               ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED)
  RETURNING id, payload`, [name, leaseMs, batch]);              // the claim commits here
for (const row of rows) {
  await publish(row);                                            // no transaction is open now
  await pool.query('UPDATE outbox SET sent_at = now() WHERE id = $1 AND claimed_by = $2', [row.id, name]);
}
```

Verified by [verify-ar2.mjs](code/architecture/verify-ar2.mjs)

### Source
Lessons 113, 114, 75.
