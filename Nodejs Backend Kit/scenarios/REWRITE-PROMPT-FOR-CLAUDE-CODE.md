# Prompt for Claude Code: rewrite the scenario bank so a mid-level developer can actually understand it

Copy everything below the line into Claude Code.

---

You are editing only the Node.js **scenario interview bank**. Do **not** touch the Node.js lessons (`01-what-nodejs-is.md` … `117-…md`), `PDF/`, `assets/`, or any file outside `Nodejs Backend Kit/scenarios/`.

## Where the files are

Folder:

`/home/anish.r/codes/Frontend-Notes/Nodejs Backend Kit/scenarios/`

Edit these Markdown files:

- `00-how-to-answer.md`
- `README.md`
- `mock-rounds.md`
- `PROGRESS.md` (only clarify wording; keep facts)
- `01-pagination.md`
- `02-api-design.md`
- `03-validation-errors.md`
- `04-auth-jwt-security.md`
- `05-databases-indexing.md`
- `06-streams.md`
- `07-websockets.md`
- `08-async-event-loop.md`
- `09-caching-redis.md`
- `10-queues-scheduled-jobs.md`
- `11-deployment.md`
- `12-architecture.md`
- `13-production-debugging.md`

Do **not** change scripts under `scenarios/code/` except if a Markdown link path is wrong. Prefer leaving `code/` alone.

## What is wrong today

I am a developer with about 3 years of experience preparing for Node backend interviews. The scenario bank is still hard for me.

Problems:

1. Terms appear without enough explanation (offset, keyset, cursor, TTL, stampede, backpressure, outbox, and similar).
2. Spoken answers are tight, but the surrounding text is still dense, so I cannot build the mental model before I try to speak.
3. I need more teaching around each scenario: what the problem really is, why the bad approach fails, why the good approach works, and what I should say out loud.
4. Language should stay simple and normal. Use technical words only when needed, and explain them the first time.

Goal: after reading one scenario, I should understand it and be able to say the answer in an interview in my own words.

## What “better” means

For **every** scenario in every topic file:

### A. Add a topic glossary near the top of each `01`–`13` file

After the Remember-this card and the run-scripts note, and before the index table, add:

```md
## Words you need

| Term | Plain meaning |
| --- | --- |
| … | … |
```

Rules for the glossary:

- Include every important term used in that file.
- Plain meaning in one short sentence a human can say.
- Keep technical accuracy. Do not invent new facts.
- Example style: `Offset | Skip N rows, then return a page. The database still walks the skipped rows.`

### B. Add a short “Before you speak” block under each scenario title

Right after `**Tag: Must know**` or `**Tag: Likely**`, and before `### Scenario`, add this exact heading:

```md
### Before you speak
```

Write 4–7 short bullets that teach the idea:

1. What the system is doing today (the broken or naive approach).
2. What goes wrong, in plain words.
3. The main fix, in plain words.
4. The one trade-off you must mention.
5. Any term in this scenario that needs a one-line definition.

This section is for reading and learning. It can be a bit more elaborate than the spoken answer.

Important: `scenarios/code/check-bank.mjs` currently expects a fixed list of `###` headings. After you add `### Before you speak`, update `check-bank.mjs` so the required section order becomes:

1. Before you speak
2. Scenario
3. Questions to ask back
4. Spoken answer
5. Say it in 5 beats
6. Case variations
7. Follow-up questions
8. Common wrong answers and red flags
9. Numbers to quote
10. Code sketch
11. Source

Keep every other check (word limits, beats, verified-by, and so on).

### C. Rewrite for understanding, then speaking

Rewrite these parts with easy language:

- Remember this (still exactly 5 lines)
- Questions to ask back
- Spoken answer
- Say it in 5 beats
- Case variations
- Follow-up questions
- Common wrong answers and red flags

Style rules:

- Short sentences.
- Everyday words first.
- Technical terms when needed, explained on first use in that file.
- No stacked parentheses.
- No em dashes.
- No “lesson archaeology” like “lesson 65’s example does X”. State the wrong pattern in plain words.
- Keep the voice: “I would…”, “The trade off is…”.

Spoken answer rules (still enforced by the checker):

- Blockquote starting with `>`
- 60–90 seconds when read aloud
- At most 150 words
- At most 2 number-words
- No code names, camelCase, snake_case, backticks, SQL keywords, or version pins in the spoken answer
- Must end with a clear trade-off sentence

Do **not** make the spoken answer longer by stuffing teaching into it. Put the teaching in **Before you speak**, the glossary, case variations, and follow-ups.

### D. Make case variations and follow-ups actually teach

For each case variation:

- Keep the bold interviewer line.
- Make the `>` reply 2–5 plain sentences: what changes, what you would do, why.

For each follow-up:

- Answer like a patient senior engineer.
- If a term appears, define it in one clause the first time.

### E. Keep these unchanged

- Scenario IDs and titles (`P1`, `A1`, anchors, index links)
- Tags (`Must know` / `Likely`)
- `Verified by …` links
- `Unverified:` lines
- `### Source` lesson numbers
- All fenced code blocks, byte for byte
- Facts, measured numbers, and “In a local test …” claims
- Do not invent benchmarks, APIs, or behaviors

If you are unsure of a claim, leave the existing wording and do not invent a replacement.

### F. Also improve the helper docs

- `00-how-to-answer.md`: keep the five steps, but add a short example of bad vs good phrasing for one clarify question and one trade-off.
- `README.md`: keep the practise path obvious: glossary → Before you speak → beats → spoken answer → mock rounds.
- `mock-rounds.md`: keep all rounds and links; make the instructions clearer.
- `PROGRESS.md`: keep facts; keep the Watch outs list accurate.

## Hard format rules (must still pass)

After editing, run:

```bash
cd "/home/anish.r/codes/Frontend-Notes/Nodejs Backend Kit/scenarios/code"
node check-bank.mjs
```

You must end at `checker: 0 flags`.

Also confirm:

```bash
cd "/home/anish.r/codes/Frontend-Notes"
git status --short
```

No lesson files under `Nodejs Backend Kit/[0-9]*` should be modified.

## Quality bar

A good rewrite of P1 means:

- The glossary explains offset, keyset, cursor, and index.
- **Before you speak** makes me understand why deep pages get slow before I read the spoken answer.
- The spoken answer is something I can say almost as written.
- Case variations feel like real interviewer pushes, not compressed notes.
- I finish the page feeling “I get this,” not “I memorized a paragraph.”

Do every scenario in every topic file to that bar. Do not stop after one file.

## Work order

1. Read `scenarios/code/check-bank.mjs` and update its section list for `Before you speak`.
2. Rewrite `00-how-to-answer.md` and `README.md`.
3. Rewrite topic files `01` through `13`, one file at a time.
4. Touch `mock-rounds.md` and `PROGRESS.md`.
5. Run `node check-bank.mjs` until 0 flags.
6. Spot-read P1, S1, C1, and DP1 yourself. If any still feels dense, simplify again.

## When you are done

Tell me:

- which files changed
- that `check-bank.mjs` is 0 flags
- one before/after example of a spoken answer or Before-you-speak block
- confirm Node.js lesson files were not touched

Start now.
