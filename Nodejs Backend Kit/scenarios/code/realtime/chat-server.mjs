// A ws chat server with per-room fan-out. With bus: true, every message goes through
// PostgreSQL LISTEN/NOTIFY, standing in for Redis pub/sub, so every server delivers it.
// Each server LISTENs only on rooms that have a member connected to it.
import http from 'node:http';
import { WebSocketServer } from 'ws';

const ROOM = /^[a-z0-9_]{1,40}$/;                     // room ids become channel names, so allow-list them

export async function startChatServer({ pool, bus }) {
  const rooms = new Map();                            // room -> Set of sockets on THIS server
  const deliver = ({ room, from, text }) => {
    for (const ws of rooms.get(room) ?? []) ws.send(JSON.stringify({ room, from, text }));
  };
  const listener = bus ? await pool.connect() : null; // LISTEN needs its own dedicated connection
  listener?.on('notification', (n) => deliver(JSON.parse(n.payload)));

  async function join(ws, room) {
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
      if (bus) await listener.query(`LISTEN ${listener.escapeIdentifier('room_' + room)}`);
    }
    rooms.get(room).add(ws);
  }
  async function leave(ws, room) {
    const members = rooms.get(room);
    if (!members?.delete(ws) || members.size) return;
    rooms.delete(room);
    if (bus) await listener.query(`UNLISTEN ${listener.escapeIdentifier('room_' + room)}`);
  }
  async function publish(msg) {
    if (bus) await pool.query('SELECT pg_notify($1, $2)', ['room_' + msg.room, JSON.stringify(msg)]);
    else deliver(msg);                                // no bus: only this server's sockets see it
  }

  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    const joined = new Set();
    ws.on('message', async (raw) => {
      const msg = JSON.parse(raw);
      if (!ROOM.test(msg.room)) return ws.close(1008, 'bad room');
      if (msg.type === 'join') { await join(ws, msg.room); joined.add(msg.room); ws.send(JSON.stringify({ joined: msg.room })); }
      if (msg.type === 'say' && joined.has(msg.room)) await publish({ room: msg.room, from: msg.from, text: msg.text });
    });
    ws.on('close', () => { for (const room of joined) leave(ws, room); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    listening: async () => (await listener.query('SELECT pg_listening_channels() AS c')).rows.map((r) => r.c),
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await new Promise((r) => server.close(r));
      listener?.release();
    },
  };
}
