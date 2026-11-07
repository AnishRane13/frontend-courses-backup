# 07. WebSockets

> **Remember this**
> 1. A WebSocket stays connected to one server. Sticky sessions keep a user on the same server, but they do not let the servers talk to each other.
> 2. Put a shared message bus between the servers, such as Redis pub/sub. Each server listens only to rooms its own users joined, and sends to its own sockets.
> 3. Give every event a number that only goes up. On reconnect, the client sends its last number, and the server replays newer events and subscribes it in the same step.
> 4. Reconnect with exponential backoff plus random jitter, so a deploy does not make every client reconnect at the same moment.
> 5. WebSockets have no CORS, so check the Origin header and log the user in during the upgrade. A ping and pong heartbeat finds dead connections.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| WebSocket | A long-lived, two-way connection between a browser and a server, so either side can send at any time. |
| Connection upgrade | The first HTTP request that asks the server to switch the connection over to a WebSocket. |
| Load balancer | A component that spreads incoming connections across several servers. |
| Sticky session | A load balancer setting that sends the same user to the same server every time. |
| Pub/sub | Publish and subscribe. Senders publish messages to a named channel, and everyone subscribed to that channel receives them. |
| Broadcast bus | A shared pub/sub system that every server connects to, so a message from one server reaches all the others. |
| Room | A named group of sockets, such as everyone in one chat, that should all get the same messages. |
| Fan-out | Sending one incoming message on to many receivers, here to every local socket in a room. |
| Heartbeat | A small check sent on a timer to confirm the other side is still there. |
| Ping/pong | The WebSocket heartbeat. One side sends a ping, and a live peer answers with a pong. |
| Half-open socket | A connection that still looks open on the server, although the other side is gone, for example after a pulled cable. |
| Origin header | The header a browser adds to say which website started the request. |
| CORS | The browser rule that stops a page from reading another site's responses unless that site allows it. It does not apply to WebSockets. |
| Cross-site WebSocket hijacking | Another website opens a socket to your server, and the browser attaches your user's cookie to it. |
| Exponential backoff | Waiting longer after each failed try, for example doubling the wait each time, up to a ceiling. |
| Jitter | A random part added to the wait, so clients do not all retry at the same moment. Full jitter picks a random wait between zero and the current ceiling. |
| Event id | An increasing number given to each event, so a client can say "I have everything up to here". |
| Replay window | The short list of recent events the server keeps, so a client that reconnects can catch up. |
| Resync | A message telling the client it is too far behind, so it reloads the full current state over HTTP. |
| Server-Sent Events | A one-way stream from server to browser over plain HTTP. The browser reconnects by itself and sends back the last event id it saw. |

| # | Scenario | Tag |
|---|---|---|
| W1 | [Chat messages are lost across servers](#w1-chat-messages-are-lost-across-servers) | Must know |
| W2 | [A live order feed misses updates after reconnects](#w2-a-live-order-feed-misses-updates-after-reconnects) | Likely |

---

## W1. Chat messages are lost across servers
**Tag: Must know**

### Before you speak
- **Today:** with one server, every socket is on that server. When a message arrives, the server loops over its own sockets in the room and sends it to each. That works.
- **What goes wrong:** with two servers, user A may be on server one and user B on server two. Server one only knows its own sockets, so B never gets A's message.
- **Why sticky sessions do not help:** they only make sure each user keeps landing on the same server. The users are still split across servers, and the servers still do not talk to each other.
- **The fix:** a shared bus, Redis pub/sub in production. Every server publishes each chat message to a channel for that room. Every server subscribes to the rooms its own users joined, and sends what it receives to its local members.
- **No duplicates:** the sender's server does not deliver locally first. It waits for the message to come back from the bus, like every other server, so each member gets it exactly once.
- **Dead sockets:** a ping and pong heartbeat finds connections that died without a goodbye and removes them from their rooms.
- **The trade-off to mention:** the bus is a new moving part. Pub/sub does not store messages, so if the bus is down, chat between servers stops. Monitor it, and save messages to the database first if they must never be lost.

### Scenario
"Our chat app runs on one server. We added a second server behind a load balancer, and now users connected to different servers stop seeing each other's messages. How do you fix it?"

### Questions to ask back
- **Are we on raw WebSockets or socket.io?** With socket.io I use its Redis adapter, a plug-in that does the same bus work. Its long-polling fallback, which uses repeated HTTP requests when WebSockets are blocked, also needs sticky sessions.
- **Must every message survive a crash of a server or of the bus?** If yes, I save messages to the database first and use the bus only to notify. Clients can then fetch what they missed.
- **How big are rooms, and how many messages per second?** Big rooms make each server's local send loop the costly part, and they limit how much I can put in each bus message.
- **Do we already run Redis?** If not, PostgreSQL LISTEN and NOTIFY can carry modest traffic before we add a new system.

### Spoken answer
> A WebSocket lives on exactly one server. When a message arrives, the server loops over its own sockets, so users on the other server never see it. Sticky sessions do not fix this. They keep each user on one server, but the users are still split. I would add a shared bus, Redis pub sub in production. Every server publishes chat messages to the bus, and subscribes to the rooms its own users have joined. When a message comes back from the bus, each server sends it only to its local members of that room. The sender's server delivers it that way too, so nobody gets it twice. I would also run a ping and pong heartbeat, so dead sockets are dropped and leave their rooms. The trade off is a new moving part. If the bus is down, chat across servers stops, so I monitor it.

### Say it in 5 beats
1. A socket lives on one server.
2. Sticky sessions do not connect servers.
3. Shared bus: publish, subscribe per room.
4. Each server sends to local members only.
5. Trade-off: the bus is a new dependency.

### Case variations
- **"We use socket.io, not raw ws."**
  > Then I plug in its Redis adapter, which does the same publish and subscribe per room. If the long-polling fallback is on, I also need sticky sessions. The first handshake and every later poll must reach the same server, or that server does not know the session.
- **"Messages must not be lost if the bus blips."**
  > Pub/sub is fire and forget, meaning a message sent while a server is not listening is simply gone. So I save each message to the database first, then publish it. A client that reconnects asks for everything after its last message id, so a lost notification only delays a message.
- **"Can we skip Redis and use PostgreSQL?"**
  > For modest traffic, yes. LISTEN and NOTIFY work as a bus, but each server needs one dedicated connection just for listening. Payloads are capped at about 8000 bytes, so I send ids or short text, not whole documents.
- **"One room has a huge number of members."**
  > The bus still carries only one copy per server. The cost moves to each server's loop over its local sockets. I turn the message into text once, not once per socket, and I watch each socket's buffered amount, the bytes still waiting to go out, so I can drop or slow very slow clients.

### Follow-up questions
- **Why are sticky sessions not enough?** They pin each user to one server, which long polling needs. But a message on server B still only reaches the sockets that server B holds.
- **How does a server know what to subscribe to?** It subscribes to a room when its first local member joins, and unsubscribes when the last one leaves. So a server never receives traffic for rooms it does not serve.
- **How do you stop the sender seeing its message twice?** The server publishes to the bus and does not also deliver locally. Every server, including the sender's, delivers only what comes back from the bus.
- **Optional: senior. A deploy restarts a server and drops thousands of sockets at once. What happens?** Every client on that server reconnects to the remaining servers. Without jitter they would all arrive in the same instant, a reconnect storm, so clients use exponential backoff with full jitter, meaning a random wait up to a growing ceiling. During graceful shutdown the server closes sockets with a restart close code, and clients resume from their last message id, so nothing is missed.

### Common wrong answers and red flags
- "Turn on sticky sessions." That keeps each user on one server. It does not connect the servers.
- Broadcasting every message to every client on every server, instead of only to the room's members.
- Delivering locally and also through the bus, so local members get each message twice.
- Putting whole documents on the bus. NOTIFY rejects payloads that are too big, and big Redis messages slow down every subscriber.
- No heartbeat, so half-open sockets stay in rooms forever and leak memory.
- Allowing any Origin, or putting the auth token in the query string. Check the Origin against an allow-list, and authenticate with a cookie or a short-lived ticket.

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

### Before you speak
- **Today:** the server pushes each order status change to the sockets that are open right now. When a laptop sleeps or the network drops, the socket closes, and events sent during that gap go nowhere.
- **What goes wrong:** after reconnecting, the client only gets new events. Everything sent while it was away is missing, so the screen shows old statuses.
- **The fix:** give every event an increasing id per room, and keep a short replay window of recent events on the server. The client remembers its last id and sends it on reconnect. The server sends only newer events and adds the client to live delivery in the same step, so no event falls into a gap.
- **Too far behind:** if the client's last id is older than the window, the server sends a resync message, and the client reloads the full state over HTTP.
- **Reconnect politely:** exponential backoff with full jitter, so thousands of clients dropped by one deploy do not all come back in the same instant.
- **Security:** browsers do not apply CORS to WebSockets, and they do send cookies on the upgrade. So during the upgrade, check the Origin header against an allow-list and authenticate with the session cookie, not a token in the URL. A ping and pong heartbeat drops dead connections.
- **The trade-off to mention:** the server spends memory on the replay window, and the client needs more logic to track ids and skip duplicates.

### Scenario
"Our SaaS dashboard shows live order status over a WebSocket. When a laptop sleeps or the network drops, users come back and some status changes are missing, and our security review asks how we stop other sites from opening the socket. What do you change?"

### Questions to ask back
- **Does the client need every event, or only the latest state?** If only the latest state, a reconnect can simply refetch a snapshot over HTTP, and no replay is needed.
- **Does the browser ever send anything on this socket?** If not, Server-Sent Events, a one-way stream over plain HTTP, give the same resume with less code.
- **How long can a client be offline?** That decides how many events the replay window must keep per room.
- **How do users log in today, with a cookie or a bearer token?** A browser WebSocket cannot set custom headers, so it is either a cookie plus an Origin check, or a short-lived ticket.

### Spoken answer
> I would assume the socket will drop. Every event gets an increasing id per room, and the server keeps a short window of recent events. The client remembers the last id it saw. On reconnect it sends that id, and the server replays only newer events and subscribes it in the same step, so nothing slips between. The client also ignores any id it has already seen. If it is too far behind, the server tells it to reload the current state over HTTP. Reconnects use exponential backoff with random jitter, so a deploy does not cause a reconnect storm. During the upgrade, I check the Origin against an allow list and authenticate with the session cookie, never a token in the URL, because URLs end up in logs. A ping and pong heartbeat drops dead peers. The trade off is memory for the replay window and more client logic.

### Say it in 5 beats
1. Every event gets an increasing id.
2. Client resumes from its last id.
3. Too far behind: reload over HTTP.
4. Backoff with jitter, Origin check, heartbeat.
5. Trade-off: replay memory, more client code.

### Case variations
- **"The dashboard only receives, it never sends."**
  > Then I would use Server-Sent Events. The server sends an id with each event. The browser reconnects by itself and sends the last id back in a header, and the server replays the same way.
- **"We run several servers."**
  > The replay window cannot live in one server's memory, because the client may reconnect to a different server. I take ids from a database sequence and keep recent events in the database or a Redis stream. A shared bus then makes sure every server pushes the live events.
- **"The mobile app has a bearer token, not a cookie."**
  > The app fetches a short-lived, single-use ticket over HTTPS and sends it as the first message on the socket. The server closes the socket if no valid ticket arrives within a few seconds. This keeps the long-lived token out of URLs and logs.
- **"A user's session is revoked while the socket stays open for days."**
  > Checking the user at the upgrade is only the start. I record the session expiry on the socket and check it on a timer. When the session is revoked or expired, I close the socket with a policy violation close code.

### Follow-up questions
- **Why jitter and not only exponential backoff?** Clients dropped by the same deploy would still retry at exactly the same moments, just further apart. Full jitter picks a random wait between zero and the backoff ceiling, which spreads them out.
- **Why replay and subscribe in the same step?** If there is an await, a pause where other code can run, between them, events published in that gap are neither replayed nor delivered live. Doing both without a pause, or subscribing first and skipping duplicate ids, closes the gap.
- **Why check Origin at all?** Browsers do not apply CORS to WebSockets, and they send cookies on the upgrade. Without an Origin check, any website can open a logged-in socket as your user. That is called cross-site WebSocket hijacking.
- **Optional: senior. How does the heartbeat work, and what about browsers?** On a timer, the server pings every socket and marks it not alive. A pong marks it alive again. A socket still not alive at the next round is terminated at once, without waiting for a close handshake that a dead peer can never answer. Browsers answer pings automatically, but browser code cannot send pings, so if the client must detect a dead server it sends its own small application message.

### Common wrong answers and red flags
- Reconnecting immediately in a loop, or on a fixed interval, so every client hits the server at the same time.
- Replaying the whole history on every reconnect, instead of only the events after the last id.
- Trusting the close event. A pulled cable can leave a socket that looks open for minutes.
- Putting the auth token in the query string. URLs end up in access logs and proxy logs.
- Rejecting the upgrade with a badly formed HTTP response. Each line must end with a carriage return and a line feed, or the client cannot read it.
- Allowing any Origin on the socket server. Use an allow-list of your own sites.

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
