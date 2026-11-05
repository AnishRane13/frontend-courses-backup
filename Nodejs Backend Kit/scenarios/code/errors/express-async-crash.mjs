// The same async route on Express 4 and Express 5. Run: node express-async-crash.mjs express4|express
const express = (await import(process.argv[2])).default;
const app = express();
app.get('/bug', async () => { throw new Error('db down'); });
app.use((err, req, res, next) => res.status(500).json({ handled: err.message }));
const server = app.listen(0, async () => {
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/bug`, { signal: AbortSignal.timeout(2000) });
    console.log(process.argv[2], 'response:', r.status, await r.text());
  } catch (e) { console.log(process.argv[2], 'client error:', e.cause?.code ?? e.name); }
  server.close();
});
