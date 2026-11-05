// POST /exports answers 202 at once; the client polls the status URL.
import express from 'express';
import { randomUUID } from 'node:crypto';

export function exportsApp(runJob) {
  const jobs = new Map(); // in production: a jobs table or a queue, not memory
  const app = express();
  app.post('/exports', (req, res) => {
    const id = randomUUID();
    jobs.set(id, { status: 'queued' });
    runJob(id)
      .then((url) => jobs.set(id, { status: 'done', url }))
      .catch((err) => jobs.set(id, { status: 'failed', error: err.message }));
    res.status(202).location(`/exports/${id}`).json({ id, status: 'queued' });
  });
  app.get('/exports/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown export' });
    if (job.status === 'queued') res.set('Retry-After', '2');
    res.json({ id: req.params.id, ...job });
  });
  return app;
}
