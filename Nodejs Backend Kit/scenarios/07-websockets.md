# 07. WebSockets

> **Remember this**
> 1. A WebSocket lives on one server. Sticky sessions keep a user there, but they do not connect users on different servers.
> 2. Put a shared bus between servers (Redis pub/sub in production). Each server subscribes only to rooms its own users joined, and fans out locally.
> 3. Give every event an increasing id. The client resumes from its last id; the server replays newer events and subscribes it in the same step.
> 4. Reconnect with exponential backoff and full jitter, so a deploy does not cause a reconnect storm.
> 5. Check `Origin` and authenticate during the upgrade (WebSockets have no CORS), and run a ping/pong heartbeat to drop dead peers.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| W1 | [Chat messages are lost across servers](#w1-chat-messages-are-lost-across-servers) | Must know |
| W2 | [A live order feed misses updates after reconnects](#w2-a-live-order-feed-misses-updates-after-reconnects) | Likely |

---

## W1. Chat messages are lost across servers
**Tag: Must know**

### Scenario
"Our chat app runs on one server. We added a second server behind a load balancer, and now users connected to different servers stop seeing each other's messages. How do you fix it?"

### Questions to ask back
- **Are we on raw WebSockets or socket.io?** With socket.io I use its Redis adapter, and its long-polling fallback also needs sticky sessions.
- **Must every message survive a server or bus failure?** If yes, I store messages in the database first and use the bus only to notify, so clients can refetch.
- **How big are rooms, and how many messages per second?** Large rooms change the fan-out cost per server and how big a payload I put on the bus.
- **Do we already run Redis?** If not, PostgreSQL LISTEN and NOTIFY can carry modest traffic before adding a new system.

### Spoken answer
> A WebSocket lives on exactly one server. When a message arrives, the server loops over its own sockets, so users on the other server never see it. Sticky sessions do not fix this. They keep each user on one server, but the users are still split. I would add a shared bus, Redis pub sub in production. Every server publishes chat messages to the bus, and subscribes to the rooms its own users have joined. When a message comes back from the bus, each server sends it only to its local members of that room. The sender's server delivers it that way too, so nobody gets it twice. I would also run a ping and pong heartbeat, so dead sockets are dropped and leave their rooms. The trade-off is a new moving part. If the bus is down, chat across servers stops, so I monitor it.

### Say it in 5 beats
1. A socket lives on one server.
2. Sticky sessions do not connect servers.
3. Shared bus: publish, subscribe per room.
4. Fan out locally, heartbeat drops dead sockets.
5. Trade-off: bus is a new dependency.

### Case variations
- **"We use socket.io, not raw ws."**
  > Then I plug in the Redis adapter, which does the same publish and subscribe for rooms. If the long-polling fallback is on, I also need sticky sessions, because the handshake and every poll must reach the same server.
- **"Messages must not be lost if the bus blips."**
  > Pub/sub is fire and forget, so I save each message to the database first, then publish it. A client that reconnects asks for everything after its last message id, so a lost notification only delays a message.
- **"Can we skip Redis and use PostgreSQL?"**
  > For modest traffic, yes. LISTEN and NOTIFY work as a bus, but each server needs one dedicated connection, and payloads are capped at about 8000 bytes, so I send ids or short text, not documents.
- **"One room has a huge number of members."**
  > The bus still carries one message per server. The cost moves to each server's local fan-out, so I serialize the message once and watch each socket's buffered amount to drop or slow very slow clients.

### Follow-up questions
- **Why are sticky sessions not enough?** They pin each user to one server, which helps long polling, but a message on server B still only reaches sockets held by server B.
- **How does a server know what to subscribe to?** It subscribes to a room when its first local member joins and unsubscribes when the last one leaves, so servers do not receive traffic for rooms they do not serve.
- **How do you stop the sender seeing its message twice?** The server publishes to the bus and does not also deliver locally. Every server, including the sender's, delivers only what comes back from the bus.
- **Optional: senior. A deploy restarts a server and drops thousands of sockets at once. What happens?** Every client reconnects to the remaining servers. Without jitter they all arrive in the same instant, so clients use exponential backoff with full jitter. The server closes sockets with a restart close code during graceful shutdown, and clients resume from their last message id so nothing is missed.

### Common wrong answers and red flags
- "Turn on sticky sessions." That keeps users on one server; it does not connect servers.
- Broadcasting every message to every client on every server instead of per room.
- Delivering locally and also through the bus, so local members get duplicates.
- Putting whole documents on the bus. NOTIFY rejects payloads over its limit, and big Redis messages slow every subscriber.
- No heartbeat, so half-open sockets stay in rooms forever and leak memory.
- Copying lesson 111's socket.io example with `cors: { origin: '*' }`. Its own gotcha says to validate `Origin`. Use an allow-list: `cors: { origin: ['https://app.example.com'] }`.
- Copying lesson 111's upgrade example: its 401 string lost its `\r\n` escapes (they became real line breaks), and it reads the token from the query string. Write `socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')` and authenticate with a cookie or a short-lived ticket (see W2).

### Numbers to quote
In a local test, a message sent by a client on server B reached a client on server A only when the PostgreSQL bus was on, arrived exactly once for each member, never reached a member of another room, and an 8000 byte NOTIFY payload was rejected while 7999 bytes went through.

### Code sketch
```js
// pool is a pg Pool; LISTEN/NOTIFY stands in for Redis pub/sub; rooms is a Map of room -> Set of local sockets
const listener = await pool.connect();                      // LISTEN needs its own connection
listener.on('notification', (n) => {
  const msg = JSON.parse(n.payload);
  for (const ws of rooms.get(msg.room) ?? []) ws.send(JSON.stringify(msg));   // local members only
});
async function join(ws, room) {
  if (!rooms.has(room)) {                                    // first local member: subscribe
    rooms.set(room, new Set());
    await listener.query(`LISTEN ${listener.escapeIdentifier('room_' + room)}`);
  }
  rooms.get(room).add(ws);
}
const publish = (msg) =>                                      // never deliver locally as well
  pool.query('SELECT pg_notify($1, $2)', ['room_' + msg.room, JSON.stringify(msg)]);
```

```js
// pub and sub are ioredis clients (a subscribed client cannot run other commands); deliver sends to local room members
await sub.subscribe(`room:${room}`);                          // when the first local member joins
sub.on('message', (_channel, payload) => deliver(JSON.parse(payload)));
await pub.publish(`room:${msg.room}`, JSON.stringify(msg));
```

Unverified: needs a Redis server. The Redis version was not run; the script runs the same design with PostgreSQL LISTEN and NOTIFY as the bus.
Verified by [verify-w1.mjs](code/realtime/verify-w1.mjs)

### Source
Lessons 97, 100, 111.

---

## W2. A live order feed misses updates after reconnects
**Tag: Likely**

### Scenario
"Our SaaS dashboard shows live order status over a WebSocket. When a laptop sleeps or the network drops, users come back and some status changes are missing, and our security review asks how we stop other sites from opening the socket. What do you change?"

### Questions to ask back
- **Does the client need every event, or only the latest state?** If only the latest state, a reconnect can simply refetch a snapshot over HTTP.
- **Does the browser ever send anything on this socket?** If not, Server-Sent Events with `Last-Event-ID` give the same resume with less code.
- **How long can a client be offline?** That sizes the replay window the server keeps per room.
- **How do users authenticate today, cookie or bearer token?** A browser WebSocket cannot set headers, so it is a cookie plus an Origin check, or a short-lived ticket.

### Spoken answer
> I would assume the socket will drop. Every event gets an increasing id per room, and the server keeps a short window of recent events. The client remembers the last id it saw. On reconnect it sends that id, and the server replays only newer events and subscribes it in the same step, so nothing slips between. The client also ignores any id it has already seen. If it is too far behind, the server tells it to reload the current state over HTTP. Reconnects use exponential backoff with random jitter, so a deploy does not cause a reconnect storm. During the upgrade, I check the Origin against an allow list and authenticate with the session cookie, never a token in the URL, because URLs end up in logs. A ping and pong heartbeat drops dead peers. The trade-off is memory for the replay window and more client logic.

### Say it in 5 beats
1. Every event gets an increasing id.
2. Client resumes from its last id.
3. Too far behind: reload over HTTP.
4. Backoff with jitter, Origin check, heartbeat.
5. Trade-off: replay memory, more client code.

### Case variations
- **"The dashboard only receives, it never sends."**
  > Then I would use Server-Sent Events. The server sends an id with each event, the browser reconnects by itself and sends the last id back, and the server replays the same way.
- **"We run several servers."**
  > The replay window cannot live in one server's memory. I take ids from a database sequence and store recent events in the database or a Redis stream, and use a shared bus so every server pushes live events.
- **"The mobile app has a bearer token, not a cookie."**
  > It fetches a short-lived, single-use ticket over HTTPS and sends it as the first message. The server closes the socket if no valid ticket arrives within a few seconds.
- **"A user's session is revoked while the socket stays open for days."**
  > Authentication at the upgrade is only the start. I record the session expiry on the socket, check it on a timer, and close with a policy violation code when it is revoked.

### Follow-up questions
- **Why jitter and not only exponential backoff?** Clients dropped by the same deploy would retry at exactly the same moments. Full jitter picks a random delay up to the backoff ceiling, which spreads them out.
- **Why replay and subscribe in the same step?** If there is an await between them, events published in that gap are neither replayed nor delivered live. Doing both synchronously, or subscribing first and deduplicating by id, closes the gap.
- **Why check Origin at all?** Browsers do not apply CORS to WebSockets, and they send cookies on the upgrade. Without an Origin check, any website can open an authenticated socket as your user. That is cross-site WebSocket hijacking.
- **Optional: senior. How does the heartbeat work, and what about browsers?** The server pings every interval and marks each socket not alive; a pong marks it alive again. A socket still marked not alive at the next pass is terminated, without waiting for a close handshake a dead peer cannot answer. Browsers answer protocol pings automatically, but the browser API cannot send pings, so client-side liveness needs an application message.

### Common wrong answers and red flags
- Reconnecting immediately in a loop, or on a fixed interval, so every client hits the server together.
- Replaying the whole history on every reconnect instead of only events after the last id.
- Trusting the close event. A yanked cable can leave a socket that looks open for minutes.
- Putting the auth token in the query string, as lesson 111's upgrade example does. URLs land in access logs and proxy logs.
- Lesson 111's rejection string: its `\r\n` escapes became real line breaks. Use `'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'`.
- Lesson 111's socket.io example with `cors: { origin: '*' }`. Use an allow-list of your own origins.

### Numbers to quote
In a local test, a client dropped after event 3 reconnected and received events 4 to 7 exactly once with nothing sent twice, a client too far behind the 5 kept events was told to resync, a wrong Origin got 403 and a missing session got 401, and a peer that stopped answering 100 ms pings was terminated within 450 ms while a healthy peer stayed open.

### Code sketch
```js
// server is an http.Server, wss = new WebSocketServer({ noServer: true }), ALLOWED is a Set of origins, sessions a Map of sid -> user
const reject = (socket, code, text) => { socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
server.on('upgrade', (req, socket, head) => {
  if (!ALLOWED.has(req.headers.origin)) return reject(socket, 403, 'Forbidden');
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const user = sid && sessions.get(sid);
  if (!user) return reject(socket, 401, 'Unauthorized');
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
});
setInterval(() => {                                         // heartbeat; 'pong' sets ws.isAlive = true
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30_000);
```

```js
// r is the room: { lastId, log: recent events with increasing ids, subs: Set of sockets }
ws.on('message', (raw) => {
  const { lastId } = JSON.parse(raw);                       // { type: 'subscribe', room, lastId }
  const oldest = r.log[0]?.id ?? r.lastId + 1;
  if (lastId != null && lastId < oldest - 1) ws.send(JSON.stringify({ type: 'resync' }));   // reload over HTTP
  else for (const e of r.log) if (lastId != null && e.id > lastId) ws.send(JSON.stringify(e));
  r.subs.add(ws);                                           // same tick as the replay: no gap
});
// client: wait Math.random() * Math.min(5000, 200 * 2 ** attempt) ms, then resubscribe with lastId; skip ids <= lastId
```

Verified by [verify-w2.mjs](code/realtime/verify-w2.mjs)

### Source
Lesson 111.
