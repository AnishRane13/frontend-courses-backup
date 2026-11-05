// Runs a lab script in a child process and returns { status, stdout, stderr }.
// Output is cached for an hour per script and arguments (keyed on the script's mtime), so a
// heavy seed shared by several verify scripts runs once per verification session.
import { spawnSync } from 'node:child_process';
import { statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

export function run(script, args = [], { node = [], cwd = root, cacheMinutes = 60 } = {}) {
  const key = [...node, script, ...args].join(' ').replace(/[^\w.-]+/g, '_');
  const cacheDir = join(root, '.run-cache');
  const cacheFile = join(cacheDir, key + '.json');
  const mtime = statSync(join(root, script)).mtimeMs;
  if (existsSync(cacheFile)) {
    const c = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (c.mtime === mtime && Date.now() - c.at < cacheMinutes * 60_000) return c;
  }
  const r = spawnSync(process.execPath, [...node, join(root, script), ...args], { cwd, encoding: 'utf8', timeout: 15 * 60_000 });
  const out = { mtime, at: Date.now(), status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  mkdirSync(cacheDir, { recursive: true });
  if (r.status === 0) writeFileSync(cacheFile, JSON.stringify(out));   // never cache a failure
  return out;
}

// First capture group of re in text, as a number. Throws if missing.
export function grab(text, re) {
  const m = text.match(re);
  if (!m) throw new Error(`pattern not found: ${re}\n--- output ---\n${text.slice(0, 2000)}`);
  return Number(m[1]);
}
