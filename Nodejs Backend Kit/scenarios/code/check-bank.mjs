// Checks every scenario file against the bank's format rules. Exit code 1 if anything is flagged.
// Usage: node check-bank.mjs [file prefixes...]
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = import.meta.dirname;
const bankDir = join(root, '..');
const only = process.argv.slice(2);
mkdirSync(join(root, 'verify-results'), { recursive: true });
const results = Object.assign({}, ...readdirSync(join(root, 'verify-results')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(root, 'verify-results', f), 'utf8'))));
const BANNED = [/my own tie-in/i, /\btie-in\b/i, /in my project/i, /\bI built\b/, /in my test/i, /\bI tested\b/i, /\bI measured\b/i,
  /\bat my company\b/i, /\bin production I\b/, /Mactores|Water Street|Boeing|Aedeon|Marketing Genie|\bAAF\b|MyDaulat/];
const SECTIONS = ['Scenario', 'Questions to ask back', 'Spoken answer', 'Say it in 5 beats', 'Case variations',
  'Follow-up questions', 'Common wrong answers and red flags', 'Numbers to quote', 'Code sketch', 'Source'];
const NUMWORD = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred|hundreds|thousand|thousands|million|millions|billion|\d+(\.\d+)?)\b/gi;
let flags = 0;
const flag = (file, where, msg) => { flags++; console.log(`FLAG ${file} ${where}: ${msg}`); };

const all = readdirSync(bankDir).filter((f) => f.endsWith('.md')).filter((f) => !only.length || only.some((p) => f.startsWith(p)));
for (const file of all) {
  const md = readFileSync(join(bankDir, file), 'utf8');
  for (const re of BANNED) for (const m of md.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) flag(file, 'text', `banned phrase "${m[0]}"`);
  if (!/^\d\d-/.test(file) || file === '00-how-to-answer.md') continue;

  if (!/> \*\*Remember this\*\*\n(> \d\. .+\n){5}(?!> \d)/.test(md)) flag(file, 'top', 'Remember-this card must have exactly 5 numbered lines');
  if (!md.includes(`Run the scripts listed in each Code sketch once before saying "in a local test".`)) flag(file, 'top', 'missing the run-scripts note');
  if (!/^\| # \| Scenario \| Tag \|$/m.test(md)) flag(file, 'top', 'missing index table (#, Scenario, Tag)');
  if (/```text|Execution Time|^\s*(PASS|FAIL)\b/m.test(md)) flag(file, 'text', 'looks like pasted run output');

  const parts = md.split(/\n(?=## [A-Z]{1,2}\d\. )/).slice(1);
  if (!parts.length) flag(file, 'top', 'no scenarios found');
  for (const sc of parts) {
    const id = sc.match(/^## ([A-Z]{1,2}\d)\./)[1];
    if (!/^## [A-Z]{1,2}\d\. .+\n\*\*Tag: (Must know|Likely)\*\*\n/.test(sc)) flag(file, id, 'title must be followed by **Tag: Must know** or **Tag: Likely**');
    const heads = [...sc.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim());
    if (JSON.stringify(heads) !== JSON.stringify(SECTIONS)) flag(file, id, `sections out of order or missing: ${heads.join(' | ')}`);
    const sec = (name) => (sc.split(`### ${name}\n`)[1] ?? '').split(/\n### |\n---\n/)[0].trim();

    if (!/^"[^]+"$/.test(sec('Scenario'))) flag(file, id, 'Scenario must be a quoted question');
    const qs = sec('Questions to ask back').split('\n').filter((l) => l.startsWith('- '));
    if (qs.length < 3 || qs.length > 4) flag(file, id, `questions to ask back: ${qs.length}, need 3 to 4`);

    const spoken = sec('Spoken answer');
    if (!spoken.startsWith('> ')) flag(file, id, 'spoken answer must be a blockquote');
    const sp = spoken.replace(/^> ?/gm, ' ').trim();
    const words = sp.split(/\s+/).length;
    if (words > 150) flag(file, id, `spoken answer ${words} words`);
    const nums = sp.match(NUMWORD) ?? [];
    if (nums.length > 2) flag(file, id, `spoken answer has ${nums.length} numbers: ${nums.join(', ')}`);
    const code = sp.match(/`|\b\w+_\w+\b|\b[a-z]+[A-Z]\w*\b|\w+\(\)|\b(Express|Node(\.js)?|Postgres(QL)?|Redis|Mongo(DB)?)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b|--|[—–]|\s-\s|[/%&;{}<>=]|\b(SELECT|WHERE|ORDER BY|INSERT|UPDATE|LIKE|JOIN)\b/g);
    if (code) flag(file, id, `spoken answer has code names, versions or symbols: ${[...new Set(code)].join(' ')}`);
    if (!/trade.?off/i.test(sp.split(/(?<=\.)\s+/).slice(-3).join(' '))) flag(file, id, 'spoken answer should end with the trade-off');

    const beats = sec('Say it in 5 beats').split('\n').filter((l) => /^\d\. /.test(l));
    if (beats.length !== 5) flag(file, id, `beats: ${beats.length}, need 5`);
    for (const b of beats) if (b.replace(/^\d\. /, '').split(/\s+/).length > 8) flag(file, id, `beat over 8 words: ${b}`);

    const vars = sec('Case variations').split('\n').filter((l) => l.startsWith('- '));
    if (vars.length < 3 || vars.length > 4) flag(file, id, `case variations: ${vars.length}, need 3 to 4`);
    if (sec('Case variations').split('\n').filter((l) => /^\s+> /.test(l)).length < vars.length) flag(file, id, 'each case variation needs a quoted spoken reply');

    const fus = sec('Follow-up questions').split('\n').filter((l) => l.startsWith('- '));
    const senior = fus.filter((l) => /^- \*\*Optional: senior\./.test(l));
    if (fus.length !== 4 || senior.length !== 1 || !/Optional: senior\./.test(fus[3] ?? '')) flag(file, id, `follow-ups: need 3 normal plus 1 last "Optional: senior." (have ${fus.length}, senior ${senior.length})`);

    if (!sec('Common wrong answers and red flags').split('\n').some((l) => l.startsWith('- '))) flag(file, id, 'red flags list is empty');

    const sketch = sec('Code sketch');
    for (const [i, m] of [...sketch.matchAll(/```\w*\n([^]*?)```/g)].entries()) {
      const n = m[1].replace(/\n$/, '').split('\n').length;
      if (n > 15) flag(file, id, `code snippet ${i + 1} has ${n} lines`);
    }
    const vb = sketch.split('\n').filter((l) => l.startsWith('Verified by '));
    const unv = /^Unverified: /m.test(sketch);
    let passed = false;
    if (vb.length !== 1 && !unv) flag(file, id, `Code sketch needs exactly one "Verified by" line (found ${vb.length})`);
    for (const l of vb) {
      const links = [...l.matchAll(/\]\((code\/[^)]+)\)/g)].map((m) => m[1]);
      if (links.length !== 1) flag(file, id, `"Verified by" line must link exactly one script (found ${links.length})`);
      for (const rel of links) {
        if (!existsSync(join(bankDir, rel))) flag(file, id, `verifying script missing: ${rel}`);
        else if (!results[rel]?.ok) flag(file, id, `verifying script has not passed: ${rel}`);
        else passed = true;
      }
    }
    for (const m of sc.matchAll(/\[[^\]]*\]\((code\/[^)#]+)[^)]*\)/g)) if (!existsSync(join(bankDir, m[1]))) flag(file, id, `link to missing file: ${m[1]}`);
    if (/in a local test/i.test(sc) && !passed) flag(file, id, '"in a local test" claim without a passing verifying script');
    const ntq = sec('Numbers to quote');
    if (!(ntq === 'No figures needed.' || /^In a local test/.test(ntq))) flag(file, id, 'Numbers to quote must be "No figures needed." or start with "In a local test"');
    if (!/^Lessons? \d+(, \d+)*\.$/.test(sec('Source'))) flag(file, id, `Source must be lesson numbers only: "${sec('Source').slice(0, 60)}"`);
  }
}
console.log(flags ? `\n${flags} flag(s)` : 'checker: 0 flags');
process.exit(flags ? 1 : 0);
