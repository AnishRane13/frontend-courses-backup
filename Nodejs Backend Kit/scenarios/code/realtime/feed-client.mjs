// A reconnecting feed client: full-jitter exponential backoff, resume from the last id it saw,
// and drop anything it has already seen.
import WebSocket from 'ws';

export const backoff = (attempt, base = 200, cap = 5_000) => Math.random() * Math.min(cap, base * 2 ** attempt);

export function connectFeed({ url, headers, room, onEvent, onResync, base = 200 }) {
  let lastId = null, attempt = 0, stopped = false, ws;
  const stats = { connects: 0, raw: [] };
  function open() {
    ws = new WebSocket(url, { headers });
    ws.on('open', () => {
      attempt = 0; stats.connects++;
      ws.send(JSON.stringify({ type: 'subscribe', room, lastId }));
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.type === 'resync') return onResync?.();
      stats.raw.push(m.id);
      if (lastId !== null && m.id <= lastId) return;         // duplicate: already seen
      lastId = m.id;
      onEvent(m);
    });
    ws.on('error', () => {});
    ws.on('close', () => { if (!stopped) setTimeout(open, backoff(attempt++, base)); });
  }
  open();
  return { stats, lastId: () => lastId, close: () => { stopped = true; ws.close(); } };
}
