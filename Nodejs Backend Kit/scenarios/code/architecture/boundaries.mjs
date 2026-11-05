// boundaries.mjs: a file may import another module only through that module's index.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
export function findViolations(root) {
  const out = [];
  for (const mod of readdirSync(root)) {
    for (const file of readdirSync(join(root, mod)).filter((f) => f.endsWith('.mjs'))) {
      for (const [, spec] of readFileSync(join(root, mod, file), 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const [target, ...rest] = relative(root, resolve(dirname(join(root, mod, file)), spec)).split(sep);
        if (target !== mod && rest.join('/') !== 'index.mjs') out.push(`${mod}/${file} -> ${target}/${rest.join('/')}`);
      }
    }
  }
  return out;
}
