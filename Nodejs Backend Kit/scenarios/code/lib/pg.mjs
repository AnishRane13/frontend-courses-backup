// Runs fn(pool) against a throwaway PostgreSQL (embedded-postgres, no Docker),
// then always stops the server and deletes its data folder, even if fn throws.
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export async function withPg(port, fn) {
  // On disk under code/.pgdata, not /tmp: /tmp here is a RAM-backed tmpfs that large seeds can fill
  const base = join(import.meta.dirname, '..', '.pgdata');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'scen-pg-'));
  const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'pw', persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'pw', database: 'postgres' });
  pool.on('error', () => {}); // idle clients are terminated when the server stops
  let failed = null;
  try {
    return await fn(pool);
  } catch (err) {
    failed = err;
    console.error('FAILED:', err.message);
  } finally {
    await pool.end();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
  // Exit explicitly: embedded-postgres registers exit hooks that otherwise end the process with code 0
  if (failed) process.exit(1);
}
