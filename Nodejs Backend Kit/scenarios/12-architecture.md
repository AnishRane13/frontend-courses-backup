# 12. Architecture

> **Remember this**
> 1. Start with one app split into clean modules. Split a module out only for a real reason: a team that must ship alone, a part that must scale alone, or a different release pace.
> 2. Each module or service owns its own tables. Others call its API, never its tables.
> 3. Saving to the database and then publishing an event is a dual write. A crash between the two steps loses the event.
> 4. Outbox: save the order row and the event row in one transaction. A relay publishes the event later, with no transaction open while it publishes.
> 5. Events can arrive more than once, so consumers remember the ids they already handled. Sagas undo work with compensating steps, not rollbacks.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Monolith | One application that holds every feature and is deployed as one unit. |
| Modular monolith | Still one app and one deploy, but split inside into modules with clear borders and their own tables. |
| Microservice | A small separate app that owns one business area and talks to others over the network. |
| Module boundary | The line around a module. Other code may only use its public entry file, not its internals or tables. |
| Database per service | Each service has its own tables that no other service reads or writes directly. |
| Distributed monolith | Services that are split apart but still have to change and deploy together. It has the costs of both styles. |
| Distributed transaction | One transaction that spans several databases or systems. It is hard to run and often not supported. |
| Two-phase commit | A way to run a distributed transaction: a coordinator asks every side to get ready, then tells them all to commit. |
| Dual write | Writing to two systems one after the other, such as the database and then the broker. A crash in between leaves them out of step. |
| Message broker | A server that receives events and delivers them to the services that listen, such as Kafka or RabbitMQ. |
| Transactional outbox | A table where you save the event in the same transaction as the business data, so both are saved or neither is. |
| Relay | A separate loop that reads unsent rows from the outbox, publishes them to the broker and marks them sent. |
| Lease | A time limit on a claim. If the relay that claimed a row dies, the row becomes free again when the lease ends. |
| At least once delivery | Every event is delivered, but some may be delivered twice. |
| Idempotent consumer | A consumer that gives the same result if it gets the same event twice, usually by saving the ids it has handled. |
| Eventual consistency | The other service catches up a little later instead of at the same instant. |
| Saga | A business flow made of local steps across services, where a failed step is undone by running compensations. |
| Compensation | A new step that undoes an earlier one, such as cancelling an order or refunding a payment. |
| Circuit breaker | A guard that stops calling a failing service for a while, so callers fail fast instead of waiting. |

| # | Scenario | Tag |
|---|---|---|
| AR1 | [The CTO wants to split an eight-developer monolith into microservices](#ar1-the-cto-wants-to-split-an-eight-developer-monolith-into-microservices) | Likely |
| AR2 | [An order is saved but inventory never hears about it](#ar2-an-order-is-saved-but-inventory-never-hears-about-it) | Must know |

---

## AR1. The CTO wants to split an eight-developer monolith into microservices
**Tag: Likely**

### Before you speak
- **Today:** one Node app, one database, eight developers. Everything ships in one deploy, and any part of the code can read any table.
- **What goes wrong:** the pain comes from tangled code, not from having one app. When the orders code reads inventory tables directly, a change in one area quietly breaks another, so every deploy feels risky.
- **Why microservices alone do not fix it:** they turn function calls into network calls that can fail or be slow. You lose transactions across areas, and you gain many deploys, dashboards and alerts to watch. A small team pays all of that at once.
- **The fix:** a modular monolith. Each business area, like orders, inventory and payments, becomes a module with one public entry file and its own tables. A check in the build fails if code reaches into another module's internals.
- **When to split later:** only when one module has a real reason, such as a team that must release on its own or a part that must scale differently. The boundary already exists, so the split is mostly moving code and giving it its own database.
- **The trade-off to mention:** the team needs discipline to keep the boundaries clean, and the app still deploys as one unit.

### Scenario
"Our e-commerce startup runs one Node monolith with eight developers. Deploys are getting scary and features step on each other, and the CTO wants to move to microservices. What would you recommend?"

### Questions to ask back
- **What hurts today?** Slow deploys, teams blocking each other and one overloaded endpoint each have a different fix, so I want the real pain first.
- **Do we have automated builds, monitoring, tracing and someone on call?** Without them, every new service adds more pain than it removes.
- **Which part changes or scales differently from the rest?** That part is the first one worth splitting, if any is.
- **How tangled is the database?** If every feature joins across every table, I have to draw the boundaries before any split is possible.

### Spoken answer
> I would not start with a big split. At this team size, microservices mostly add cost: network calls that fail, no shared transactions, and many deploys to watch. First I would make the monolith modular. Each business area, like orders, inventory and payments, becomes a module with a small public interface and its own tables. Other modules call that interface, never the tables, and a check in the build enforces it. That removes most of the tangle and keeps one deploy. Then I would split a module out only for a real reason. A team that needs to ship on its own, a part that must scale differently, or a different release pace. Because the boundary already exists, the split is mostly moving code and giving it its own database. The trade-off is discipline now instead of infrastructure, and the monolith still deploys as one unit.

### Say it in 5 beats
1. Microservices add network and running costs.
2. First, a modular monolith.
3. Modules own tables, share small APIs.
4. Split only for a real reason.
5. Trade-off: discipline now, one deploy.

### Case variations
- **"Black Friday traffic only hits the product catalog."**
  > First I would run more copies of the whole monolith, which is often the cheapest fix. If the catalog then needs a different setup, like heavy caching or its own database, that is a real reason to split it out first.
- **"Two teams keep breaking each other's code."**
  > That is a boundary problem before it is a deployment problem. I would give each module a clear owner and one public interface, and add a boundary check to the build. If the teams also need separate release days, that module is the first one to split.
- **"We already split, and every request now calls five services in a row."**
  > That is a distributed monolith: the services are separate but still depend on each other for every request. I would merge services that always change together. For work that does not need an answer right away, I would send an event instead of waiting on a call.
- **"Can the services share one database to keep it simple?"**
  > They can share a database server, but not tables. If two services write the same table, one schema change breaks both. Then the split loses its main benefit, which is changing one service without touching the other.

### Follow-up questions
- **How do you enforce boundaries inside a monolith?** Each module exports one entry file. A lint rule or a small script fails the build if a file imports another module's internals. Each table has one owning module, ideally in its own database schema, which is a named group of tables.
- **How do modules talk to each other?** Through plain function calls on the public interface, or through in-process events, which are messages sent inside the same app, for side effects. After a split, those become network calls or broker messages.
- **What do you lose when you split?** Transactions across the two parts, simple joins and simple debugging. In return you now need timeouts, retries, tracing and eventual consistency, meaning the other side catches up a little later. That is what AR2 is about.
- **Optional: senior. How do you move a module out without a big-bang rewrite?** I would use the strangler approach, which means replacing a piece step by step while the old path still works. The module already sits behind its interface. I put a client in front of it that can call in process or over the network, move its tables to a new database with a period of syncing, then switch the client. Each step can be rolled back.

### Common wrong answers and red flags
- "Microservices, because the big tech companies use them." Choose an architecture for a problem you actually have.
- Splitting by technical layer, such as an API service and a database service, instead of by business area.
- Services that read and write the same tables.
- Long chains of calls that wait on each other for one request. Any one slow or failing service breaks the whole request.
- A circuit breaker whose half-open state lets every waiting call through. Half-open should let one test call through and fail the rest fast until that call returns.

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

### Before you speak
- **Today:** the order service saves the order and commits. Then it sends an "order placed" event to a message broker, and the inventory service listens for it and reserves stock.
- **What goes wrong:** these are two separate writes to two systems, with no shared transaction. If the process crashes, or the broker is down, after the commit but before the publish, the order exists and the event is gone. Nothing remembers to retry it. That is the dual write problem.
- **The fix:** a transactional outbox. In the same transaction as the order, insert an event row into an outbox table. It is one database, so both rows are saved or neither is.
- **The relay:** a separate loop claims unsent outbox rows and commits that claim. Only then does it publish and mark each row sent. No transaction stays open while it waits on the broker.
- **Duplicates are normal:** if the relay crashes after publishing but before marking, the row goes out again. So the inventory consumer saves each event id in the same transaction as the stock change, and skips ids it has already seen.
- **When inventory can say no:** use a saga, a chain of local steps where a failure triggers a compensating step, such as cancelling the order and refunding.
- **The trade-off to mention:** inventory catches up a moment later, which is called eventual consistency, and there is one more process to run and watch.

### Scenario
"Our order service saves an order in its database, then publishes an order placed event so the inventory service can reserve stock. Sometimes an order exists but stock was never reserved. How do you keep the two services consistent without a shared transaction?"

### Questions to ask back
- **Can inventory refuse, for example when stock runs out?** Then reliable delivery is not enough. I also need a saga with a step that undoes the order.
- **How fast must inventory catch up?** A delay of a few seconds suits an outbox relay. If the user must see the reservation right away, that part needs a direct call that waits for the answer.
- **Does the broker keep events in order for each order id?** That decides how the relay publishes and whether consumers must handle events that arrive out of order.
- **Does the consumer already ignore duplicates?** If not, delivering some events twice will reserve stock twice.

### Spoken answer
> This is the dual write problem. The service commits the order, then publishes, and a crash between the two loses the event for good. I would use a transactional outbox. In the same database transaction as the order, I insert an event row into an outbox table, so both commit or neither does. A separate relay claims unsent rows, commits that claim, publishes, then marks them sent. It never keeps a transaction open while it publishes. If the relay dies after publishing but before marking, the row goes out again, so delivery is at least once. The inventory consumer records each event id in a processed messages table, in the same transaction as the stock change, and skips ids it has seen. If inventory can refuse, a saga cancels the order as a compensating step. The trade-off is eventual consistency and one more process to run.

### Say it in 5 beats
1. Commit, then publish, loses events.
2. Outbox row in the same transaction.
3. Relay claims, publishes, then marks sent.
4. Consumer skips event ids it saw.
5. Trade-off: eventual consistency, extra relay.

### Case variations
- **"Why not publish first, then commit?"**
  > Then a failed commit leaves an event for an order that does not exist. Both orders of a dual write are wrong, just in different ways. Only one local transaction that saves both rows is safe.
- **"Inventory is out of stock after the order was accepted."**
  > That is a saga. Inventory publishes a reservation failed event, and the order service runs a compensating step: cancel the order and refund the payment. Each step and each compensation must be safe to run twice, because those events can be delivered twice too.
- **"Can we use change data capture instead of a polling relay?"**
  > Yes. Change data capture means reading every change from the database's own log. A tool like Debezium reads the outbox table from that log and publishes it, so nothing polls. It is more infrastructure, and it is still at least once.
  > Unverified: needs Debezium and Kafka.
- **"Payment is in the flow too, and it takes several seconds."**
  > Then I would orchestrate the saga, meaning one order process is in charge. It tracks the state, calls payment and inventory, and on failure runs the compensations in reverse order. A timeout becomes a state the process handles, not a crash.

### Follow-up questions
- **Why not a distributed transaction across both services?** That would need two-phase commit, where a coordinator asks both sides to get ready and then to commit. Most brokers and many managed databases do not support it. It also blocks when the coordinator fails, and it ties the uptime of both services together.
- **How do you run several relays?** Each relay claims a batch in one short statement that skips rows other relays have locked, and sets a lease, which is a time limit on the claim. So each row goes to one relay at a time, and a crashed relay's rows come back when the lease ends.
- **Does the outbox keep events in order?** One relay publishes in id order, but with several relays or retries, order is not guaranteed. I would partition by order id in the broker, so events for one order go through one line, and make consumers ignore old events, for example with a version number check.
- **Optional: senior. A relay locks rows, publishes them and marks them sent, all inside one open transaction. What is wrong with it?** During every publish, the database connection sits idle inside a transaction. It holds row locks and holds back vacuum, the background cleanup of old row versions, and a slow broker stretches all of that. A short claim statement with a lease avoids it. The local script shows one session idle in a transaction during publish with the one-transaction shape, and none with the claim and lease shape.

### Common wrong answers and red flags
- "Just retry the publish." After a crash, nothing is left in memory to retry from.
- Publishing before the commit. An order that rolls back still sends its event.
- A relay that keeps a transaction open while it publishes, holding row locks the whole time.
- Consumers that assume every event arrives exactly once.
- Saving the processed event id in a different transaction from the stock change. A crash between them either loses the change or applies it twice.
- Never deleting sent outbox rows, so the table grows forever.

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
