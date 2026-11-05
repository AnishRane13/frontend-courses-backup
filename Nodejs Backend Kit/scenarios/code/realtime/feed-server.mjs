// A live order-status feed over ws. The upgrade is checked before the handshake: Origin must be
// on an allow-list and the session cookie must be valid. Each room keeps its last `keep` events
// with increasing ids, so a reconnecting client can resume after the last id it saw.
// A ping/pong heartbeat terminates peers that stop answering.
import http from 'node:http';
import { WebSocketServer } from 'ws';

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

export async function startFeedServer({ allowedOrigins, sessions, keep = 100, pingMs = 30_000 }) {
  const rooms = new Map();                                  // room -> { lastId, log: [], subs: Set }
  const room = (name) => rooms.get(name) ?? rooms.set(name, { lastId: 0, log: [], subs: new Set() }).get(name);
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const events = { terminated: 0 };

  server.on('upgrade', (req, socket, head) => {
    if (!allowedOrigins.has(req.headers.origin)) return reject(socket, 403, 'Forbidden');
    const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const user = sid && sessions.get(sid);
    if (!user) return reject(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
  });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      const { type, room: name, lastId } = JSON.parse(raw);
      if (type !== 'subscribe') return;
      const r = room(name);
      const oldest = r.log[0]?.id ?? r.lastId + 1;
      if (lastId != null && lastId < oldest - 1) ws.send(JSON.stringify({ type: 'resync' }));  // gap too old: refetch over HTTP
      else for (const e of r.log) if (lastId != null && e.id > lastId) ws.send(JSON.stringify(e));
      r.subs.add(ws);                                        // same tick as the replay, so no gap
      ws.on('close', () => r.subs.delete(ws));
    });
  });

  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { events.terminated++; ws.terminate(); continue; }   // missed the last ping
      ws.isAlive = false;
      ws.ping();
    }
  }, pingMs);

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    events,
    clients: () => wss.clients.size,
    dropAll: () => { for (const ws of wss.clients) ws.terminate(); },   // simulate a network drop
    publish(name, data) {
      const r = room(name);
      const e = { type: 'event', id: ++r.lastId, data };
      r.log.push(e);
      if (r.log.length > keep) r.log.shift();
      for (const ws of r.subs) ws.send(JSON.stringify(e));
      return e.id;
    },
    close: async () => {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(r));
    },
  };
}
