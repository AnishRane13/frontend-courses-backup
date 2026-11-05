// Download and upload routes for scenario ST1. Used by verify-st1.mjs.
import express from 'express';
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

// hooks lets the verifier watch the file stream and the pipeline result.
export function buildApp({ filePath, uploadDir, maxUpload, hooks = {} }) {
  const app = express();

  // Wrong: the whole file sits in memory for every concurrent download.
  app.get('/export-buffered', async (req, res) => {
    res.type('text/csv').send(await readFile(filePath));
  });

  // Right: stream with pipeline, so backpressure holds and a client abort closes the file.
  app.get('/export', async (req, res) => {
    const { size } = await stat(filePath);
    res.set({ 'Content-Type': 'text/csv', 'Content-Length': String(size) });
    const file = createReadStream(filePath);
    hooks.onFileStream?.(file);
    try {
      await pipeline(file, res);
      hooks.onDone?.(null);
    } catch (err) {
      hooks.onDone?.(err); // client left; pipeline already destroyed the file stream
    }
  });

  // Uploads stream to disk through multer with a hard size limit.
  const upload = multer({ dest: uploadDir, limits: { fileSize: maxUpload, files: 1 } });
  app.post('/uploads', upload.single('file'), (req, res) => {
    res.status(201).json({ id: req.file.filename, size: req.file.size });
  });
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code });
    }
    next(err);
  });
  return app;
}
