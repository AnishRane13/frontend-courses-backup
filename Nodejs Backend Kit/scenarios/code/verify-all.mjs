// Runs every script named on a "Verified by" line in ../*.md and records pass or fail.
// Usage: node verify-all.mjs            (all)
//        node verify-all.mjs 04 05      (only topic files starting with these prefixes)
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = import.meta.dirname;
const bankDir = join(root, '..');
const only = process.argv.slice(2);
mkdirSync(join(root, 'verify-results'), { recursive: true });

const files = readdirSync(bankDir).filter((f) => /^\d\d-.*\.md$/.test(f) && f !== '00-how-to-answer.md')
  .filter((f) => !only.length || only.some((p) => f.startsWith(p)));
for (const f of files) {
  const resultsFile = join(root, 'verify-results', f.replace(/\.md$/, '.json'));   // one file per topic, safe in parallel
  const results = {};
  const md = readFileSync(join(bankDir, f), 'utf8');
  for (const [, rel] of md.matchAll(/^Verified by \[[^\]]+\]\((code\/[^)]+)\)/gm)) {
    const script = join(bankDir, rel);
    const t = Date.now();
    const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    const ok = r.status === 0;
    results[rel] = { ok, exit: r.status, seconds: Math.round((Date.now() - t) / 1000), at: new Date().toISOString(),
      tail: ok ? '' : (r.stderr || r.stdout || '').trim().split('\n').slice(-8).join('\n') };
    console.log(ok ? 'PASS' : 'FAIL', rel, `${results[rel].seconds}s`, ok ? '' : '\n' + results[rel].tail);
    writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  }
}
