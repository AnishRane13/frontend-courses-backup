// Rebuilds ../README.md and ../PROGRESS.md from the topic files and verify-results/. Run after verify-all.mjs.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const bank = join(import.meta.dirname, '..');
const resDir = join(import.meta.dirname, 'verify-results');
const results = existsSync(resDir) ? Object.assign({}, ...readdirSync(resDir).map((f) => JSON.parse(readFileSync(join(resDir, f), 'utf8')))) : {};
const files = readdirSync(bank).filter((f) => /^(0[1-9]|1\d)-.*\.md$/.test(f)).sort();
const rows = [], unverified = [];
for (const f of files) {
  const md = readFileSync(join(bank, f), 'utf8');
  const topic = md.match(/^# (.+)$/m)[1];
  for (const sc of md.split(/\n(?=## [A-Z]{1,2}\d\. )/).slice(1)) {
    const [, id, title] = sc.match(/^## ([A-Z]{1,2}\d)\. (.+)$/m);
    const tag = sc.match(/\*\*Tag: (.+?)\*\*/)[1];
    const script = sc.match(/^Verified by \[[^\]]+\]\((code\/[^)]+)\)/m)?.[1];
    const status = script && results[script]?.ok ? 'Verified' : 'Not verified';
    const anchor = `${id}-${title}`.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    rows.push({ f, topic, id, title, tag, script, status, anchor });
    for (const m of sc.matchAll(/Unverified: ([^\n]+)/g)) unverified.push({ f, id, text: m[1].trim() });
  }
}
const must = rows.filter((r) => r.tag === 'Must know').length;
const verified = rows.filter((r) => r.status === 'Verified').length;

let readme = `# Node.js Scenario Interview Bank

Scenario-based Node.js backend interview questions with model answers, for developers with about three years of experience. Every spoken answer fits in 60 to 90 seconds. The lessons in this kit are the source of truth, and every claim this machine can test was tested by a script in [code/](code/).

Start with [00-how-to-answer.md](00-how-to-answer.md). Practise with [mock-rounds.md](mock-rounds.md).

**Each scenario:** title and tag, scenario, questions to ask back, spoken answer (150 words or fewer, at most two numbers, no code names said aloud), say it in 5 beats, case variations, follow-ups (the hardest marked "Optional: senior"), common wrong answers and red flags, numbers to quote, code sketch (15 lines or fewer per snippet, plus the one script that verifies it), source lessons.

**Tags:** **Must know** comes up in almost every mid-level Node backend interview. **Likely** is common.

**Before quoting a number:** run the script on that scenario's "Verified by" line once. \`cd code && npm install\`, then for example \`node pagination/verify-p1.mjs\`. PostgreSQL 18.4 and MongoDB 8.2.6 start in-process (embedded-postgres, mongodb-memory-server), so no Docker is needed. Examples use Node v24.19.0 and Express 5.3.0. \`node verify-all.mjs\` runs every verifying script, and \`node check-bank.mjs\` checks every file against the format rules.

**Running count: ${rows.length} scenarios, ${must} Must know, ${verified} verified by a passing script.**

| ID | Scenario | Tag | Verification |
|---|---|---|---|
`;
let last = '';
for (const r of rows) {
  if (r.f !== last) { readme += `| | **[${r.topic}](${r.f})** | | |\n`; last = r.f; }
  readme += `| ${r.id} | [${r.title}](${r.f}#${r.anchor}) | ${r.tag} | ${r.status}${r.script ? `: [script](${r.script})` : ''} |\n`;
}
writeFileSync(join(bank, 'README.md'), readme);

const byFile = files.map((f) => `- [x] ${f}: ${rows.filter((r) => r.f === f).map((r) => `${r.id} (${r.tag})`).join(', ')}`).join('\n');
const progress = `# Progress

## Environment
- Node v24.19.0, npm 11.17.0, Express 5.3.0 (Express 4.22.3 installed as \`express4\` for one comparison).
- PostgreSQL 18.4 via embedded-postgres 18.4.0-beta.17, MongoDB 8.2.6 via mongodb-memory-server 11.3.0. Test databases live in \`code/.pgdata/\` on disk, because \`/tmp\` here is a RAM-backed tmpfs.
- Not on this machine: Docker, Kubernetes, Redis, NGINX or another load balancer, a browser, a real payment or email provider, RabbitMQ, SQS, Kafka, a C compiler.

## Done
- [x] 00-how-to-answer.md, mock-rounds.md (5 rounds of 6 chained questions, pointers only), this file and README.md.
${byFile}
- [x] ${rows.length} scenarios, ${must} Must know. ${verified} of ${rows.length} have a "Verified by" script that passed in the last \`verify-all.mjs\` run.
- [x] \`code/check-bank.mjs\` checks every rule: section order, word and number limits, code names in spoken answers, snippet length, banned phrases, pasted output, and "in a local test" claims backed by a passing script.

## To do
- Nothing open. To refresh: \`cd code && node verify-all.mjs && node check-bank.mjs && node build-index.mjs\`.

## Unverified (needs infrastructure this machine lacks)
| File | Scenario | What was not run |
|---|---|---|
${unverified.map((u) => `| ${u.f} | ${u.id} | ${u.text.replace(/\|/g, '/')} |`).join('\n')}

## Lesson problems found while verifying
Each one is called out in the matching scenario's "Common wrong answers and red flags", with the correct version.
- **Lesson 19:** says \`return await\` costs an extra microtask. Lesson 09 measured the opposite. (E1, E2)
- **Lesson 29:** says microtasks drain "between phases". Since Node 11 they drain after each callback, as lesson 09 says. (E1)
- **Lesson 37:** its line splitter breaks a multibyte character split across chunks. Use a \`StringDecoder\` or \`setEncoding('utf8')\`. (ST2)
- **Lessons 36, 40, 43, 111:** some \`'\\n'\` and \`'\\r\\n'\` strings became real line breaks in the scrape, so the code does not run. (ST1, ST2, W2)
- **Lesson 40:** the timeouts table leaves out the 1 second \`keepAliveTimeoutBuffer\` on Node 24.19. (PD2)
- **Lesson 64:** the idempotency code saves the key after the charge, while its interview answer says to persist it before. (A1)
- **Lessons 66 vs 64:** "email taken" is 422 in lesson 66 and 409 in lesson 64. This bank uses 409. (V2)
- **Lesson 65:** the cursor is built from a JS \`Date\` (it loses microseconds and skips rows) and parsed without validation. Its \`SORTABLE\` map is never used. (P1, P3)
- **Lessons 74 and 75:** the transfer example locks only one row or none, never checks the balance (74), and reads the balance without checking that the row exists. Opposite transfers can deadlock. (D2)
- **Lesson 82:** the dummy bcrypt hash is 38 characters, not a valid 60-character hash. (S3)
- **Lesson 83:** it denylists a \`jti\` it never issues, never checks \`aud\`, stores refresh tokens raw, and rotates with a non-atomic find then save. (S1, S2)
- **Lesson 84:** it calls SameSite Lax "the browser default". That is Chrome and Edge behaviour, not every browser. (S1, S4)
- **Lesson 85:** \`password.length\` crashes when the password is missing. (S3)
- **Lesson 100:** shows the broken lock (value \`'1'\` plus a plain delete), and \`getWithLock\` retries itself with no limit. (C2)
- **Lesson 102:** says idle keep-alive sockets make \`server.close()\` hang. Since Node 19 it closes them. Its \`keepAliveTimeout = 5000\` advice causes the 502s in PD2. (DP1, PD2)
- **Lessons 02, 05, 105:** heap sizes of 700 to 768 MiB for a 1 GiB container (960 MiB real limit), and 384 MiB for 512 MiB (576 MiB real limit), leave little or no headroom. (DP2)
- **Lesson 111:** \`cors: { origin: '*' }\` contradicts its own gotcha about validating Origin, and it reads the token from the query string. (W2)
- **Lesson 113:** the circuit breaker lets every concurrent call through in half-open. (AR1)
- **Lesson 114:** the outbox relay keeps a database transaction open while publishing. (Q2, AR2)
- **Lesson 115:** says lesson 105 covers Kubernetes Jobs. It does not. (Q1)

## Surprises found while verifying (not lesson errors)
- **Pattern index for prefix search:** with a \`text_pattern_ops\` index and an \`ORDER BY\` in the default collation, a one-letter prefix sorts every match. A \`COLLATE "C"\` index serves match, sort and cursor. (P4)
- **\`random()\` in a WHERE clause:** \`UPDATE … WHERE slot = floor(random() * 16)\` evaluates \`random()\` per row and deadlocked. Pick the slot in the application. (P2)
- **MongoDB 8.2 optimizer:** it moved \`$limit\` below \`$lookup\` on its own.
- **\`Object.assign\` and \`__proto__\`:** \`Object.assign({}, body)\` with a parsed \`__proto__\` key changes the copy's prototype. (V1)
- **\`monitorEventLoopDelay\`:** in a quick check it sometimes missed a single 1.5 second stall. E1 measures timer lateness and event-loop utilization instead.
- **embedded-postgres exit code:** it registers exit hooks that turned a failing script's exit code into 0. \`lib/pg.mjs\` now calls \`process.exit(1)\` after cleanup.
`;
writeFileSync(join(bank, 'PROGRESS.md'), progress);
console.log(`README and PROGRESS rebuilt: ${rows.length} scenarios, ${must} Must know, ${verified} verified, ${unverified.length} Unverified lines`);
