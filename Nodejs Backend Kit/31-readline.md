---
title: "readline: Lines, Prompts and History"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# readline: Lines, Prompts and History

*14 min read · Updated 10 Oct 2026 · Topic 78 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

Two jobs come up again and again, and `node:readline` is Node's built-in answer to both. The first is reading a text stream one line at a time — a log file too big to hold in memory, `stdin` from a Unix pipe, a child process's output — where you want each line as a string and you do not want to load the whole thing with `fs.readFileSync`. The second is asking a person a question at the terminal: a scaffolding CLI that prompts for a project name, a `y/n` confirmation before a destructive command, a REPL-like loop.

Without it you end up re-implementing a line splitter by hand, and line splitting has more edge cases than it looks: a chunk can cut a line in half, a chunk can cut a multi-byte UTF-8 character in half, the last line often has no trailing newline, and Windows files end lines with `\r\n` instead of `\n`. `readline` handles all of those. This lesson shows the line-reading side, the promise-based prompt side (with a timeout), the history that terminal mode keeps, and where a hand-written stream splitter is still the better tool.

## The concept, simply

`readline.createInterface(options)` builds an **Interface** object that sits on top of a Readable `input` stream (and optionally a Writable `output`). It watches the input for end-of-line markers (`\n`, `\r`, or `\r\n`) and turns the bytes between them into complete-line strings. Each finished line is delivered two ways: as a `'line'` event, and through an async iterator so you can write `for await (const line of rl)`.

The real parts are:

- **`input`** — the Readable to read from (a file stream, `process.stdin`, a socket). Required.
- **`output`** — the Writable to echo to, used for prompts and for terminal editing. Optional.
- **`crlfDelay`** — how long to wait after a lone `\r` for a following `\n` before treating the `\r` as its own line ending. Set it to `Infinity` so every `\r\n` is always one break (the right choice for files). **Default:** `100` (coerced to at least `100`).
- **`terminal`** — whether to treat the streams as a TTY, with ANSI editing and history. **Default:** whether `output.isTTY` is true.
- **`history`**, **`historySize`**, **`removeHistoryDuplicates`** — the command history, which only exists in terminal mode.

There are two module entry points. `node:readline` is the callback/event API (`rl.question(query, cb)`). `node:readline/promises` is the promise API (`await rl.question(query)`), which was marked stable in v24.0.0. The line-reading side (`createInterface` + `for await`) is the same on both.

Line reading with `for await` is one producer feeding one consumer, so there is a flow rule worth stating up front: **the interface starts consuming the input as soon as you create it.** If you create the interface and then `await` something else before attaching your `'line'` listener or starting the `for await`, lines that arrive in the meantime are gone. Attach the consumer in the same synchronous turn as `createInterface`.

## How it works

1. **You create the interface** with an `input` stream. `createInterface` immediately resumes the input and starts reading.
2. **Bytes arrive in chunks.** readline decodes them to text (holding back a partial multi-byte character), appends to its internal buffer, and scans for end-of-line markers.
3. **Each complete line is emitted** as a `'line'` event and offered to the async iterator. The newline itself is stripped; a trailing `\r` before `\n` is stripped too.
4. **The input ends.** If the last bytes had no trailing newline, readline emits them as one final line anyway, then emits `'close'`.
5. **In terminal mode only**, keystrokes are interpreted (arrows, backspace), the line is echoed to `output`, and completed lines are pushed onto the history ring, which fires a `'history'` event.

**Line endings, concretely.** With the default `crlfDelay` of 100 ms, a `\r` and a `\n` that arrive in the same chunk are one break, but a `\r` and `\n` split across chunks more than 100 ms apart become two breaks (an empty line appears between them). A lone `\r` with no following `\n` — the old classic-Mac line ending — is always its own break. Setting `crlfDelay: Infinity` means "a `\r` is never its own line ending if a `\n` could still follow", which is what you want for reading `\r\n` files reliably.

**History lives only in terminal mode.** The `history`, `historySize` and `removeHistoryDuplicates` options do nothing unless `terminal` is true (checked from `output.isTTY`, or forced with `terminal: true`). When a pipe feeds `stdin`, `isTTY` is undefined, so history is off and arrow-key bytes like `\x1b[A` are delivered as plain text instead of recalling a previous line.

## Code examples

**Example 1 — reading a file line by line with `for await`.**

javascript

```
import { createReadStream } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';

// A small log file: an empty line in the middle, and NO newline after the last line.
await writeFile('access.log', 'GET /a 200\nPOST /b 500\n\nGET /c 404');

const rl = createInterface({
  input: createReadStream('access.log'),
  crlfDelay: Infinity,           // treat every \r\n as one line break
});

let n = 0;
for await (const line of rl) {
  n++;
  console.log(`${n}: ${JSON.stringify(line)}`);
}
console.log('lines:', n);
await rm('access.log');

// Real output (Node v24.19.0):
//   1: "GET /a 200"
//   2: "POST /b 500"
//   3: ""
//   4: "GET /c 404"
//   lines: 4
```

The empty middle line comes back as `""`, and the last line (`GET /c 404`) is delivered even though the file does not end in a newline. Memory stays flat because `createReadStream` feeds the interface in chunks; the whole file is never held at once.

**Example 2 — edge case: CRLF, split line endings, lone `\r`, and a multi-byte character cut in half.**

javascript

```
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';

async function lines(chunks, opts = {}) {
  // A stream that delivers each chunk 150 ms after the previous one
  const input = Readable.from((async function* () {
    for (const c of chunks) { yield Buffer.from(c); await sleep(150); }
  })());
  const out = [];
  for await (const line of createInterface({ input, ...opts })) out.push(line);
  return JSON.stringify(out);
}

console.log('CRLF in one chunk, default crlfDelay :', await lines(['a\r\nb\r\n']));
console.log('\\r and \\n split, 150 ms apart, default:', await lines(['a\r', '\nb\r\n']));
console.log('\\r and \\n split, crlfDelay: Infinity  :', await lines(['a\r', '\nb\r\n'], { crlfDelay: Infinity }));
console.log('lone \\r (old Mac line ending)         :', await lines(['a\rb\rc']));
console.log('trailing \\n at the end of input       :', await lines(['a\nb\n']));
console.log('two trailing \\n                       :', await lines(['a\nb\n\n']));
console.log('UTF-8 char split across chunks        :', await lines([Buffer.from('zoë\n').subarray(0, 3), Buffer.from('zoë\n').subarray(3)]));

// Real output (Node v24.19.0):
//   CRLF in one chunk, default crlfDelay : ["a","b"]
//   \r and \n split, 150 ms apart, default: ["a","","b"]
//   \r and \n split, crlfDelay: Infinity  : ["a","b"]
//   lone \r (old Mac line ending)         : ["a","b","c"]
//   trailing \n at the end of input       : ["a","b"]
//   two trailing \n                       : ["a","b",""]
//   UTF-8 char split across chunks        : ["zoë"]
```

The second line is the gotcha: a `\r` and `\n` that arrive more than `crlfDelay` apart produce an extra empty line (`["a","","b"]`). `crlfDelay: Infinity` fixes it. A lone `\r` is always its own break. A trailing `\n` does not create a phantom empty final line, but a *second* trailing `\n` does — because the text between the two newlines really is an empty line. The `ë` (two UTF-8 bytes) is cut across the two chunks, and readline still reassembles it: it decodes with an internal `StringDecoder`, so a split multi-byte character is held back until its second byte arrives.

**Example 3 — a prompt with `readline/promises` and a per-question timeout.**

javascript

```
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = createInterface({ input, output });

const name = await rl.question('Project name? ');
const port = await rl.question('Port [3000]? ');
console.log(`-> name=${JSON.stringify(name)} port=${Number(port || 3000)}`);

try {
  // Give up on this question after 2 s
  const ok = await rl.question('Create it (y/n)? ', { signal: AbortSignal.timeout(2000) });
  console.log(`-> confirmed: ${ok.trim().toLowerCase() === 'y'}`);
} catch (err) {
  console.log(`\n-> no answer: ${err.name} (${err.code}), cause: ${err.cause?.name}`);
}
rl.close();
```

`rl.question` returns a promise, so each prompt is a plain `await`. Passing `{ signal }` lets you cancel a question; with `AbortSignal.timeout(2000)` it rejects after two seconds. The rejection is Node's `AbortError` (`code 'ABORT_ERR'`) with a `TimeoutError` in `err.cause` — the same shape lesson 22 documents for every signal-aware core API.

This is interactive, so it is driven here with `script -qec` to give it a real TTY. First a full run where all three answers come in time, with the terminal escape codes stripped for readability:

bash

```
$ (sleep 0.5; printf 'shop-api\r'; sleep 0.3; printf '\r'; sleep 0.3; printf 'y\r'; sleep 0.5) \
    | script -qec "node ask.mjs" /dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\r'
Project name? shop-api
Port [3000]?
-> name="shop-api" port=3000
Create it (y/n)? y
-> confirmed: true
```

Then a run where the last answer never comes, so the 2-second timeout fires:

bash

```
$ (sleep 0.5; printf 'shop-api\r'; sleep 0.3; printf '8080\r'; sleep 3) \
    | script -qec "node ask.mjs" /dev/null | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' | tr -d '\r'
Project name? shop-api
Port [3000]? 8080
-> name="shop-api" port=8080
Create it (y/n)?

-> no answer: AbortError (ABORT_ERR), cause: TimeoutError
```

The empty `Port [3000]?` answer falls back to `3000`; the timeout answer rejects as an `AbortError`.

**Example 4 — a pipe-safe prompt loop that does not lose lines.**

The prompt above assumes a human. If you drive a script non-interactively by piping all the answers at once (`printf 'a\nb\nc\n' | node ...`), the input can arrive and end faster than the prompts are issued. Pulling one line at a time from the async iterator keeps every line queued, so it works for both a TTY and a pipe:

javascript

```
import { createInterface } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';

// Works for a human at a TTY and for piped input: the async iterator
// queues every line that arrives, so none is lost between prompts.
const rl = createInterface({ input, output, terminal: false });
const lines = rl[Symbol.asyncIterator]();

async function ask(q) {
  output.write(q);
  const { value, done } = await lines.next();
  if (done) throw new Error(`input ended before an answer to "${q.trim()}"`);
  return value;
}

try {
  const name = await ask('Project name? ');
  const port = await ask('Port [3000]? ');
  const ok = await ask('Create it (y/n)? ');
  console.log(`\n-> name=${JSON.stringify(name)} port=${Number(port || 3000)} confirmed=${ok === 'y'}`);
} catch (err) {
  console.log(`\n-> ${err.message}`);
} finally {
  rl.close();
}
```

Driven by a pipe, with three answers and then with only two:

bash

```
$ printf 'shop-api\n8080\ny\n' | node ask-lines.mjs
Project name? Port [3000]? Create it (y/n)?
-> name="shop-api" port=8080 confirmed=true

$ printf 'shop-api\n\n' | node ask-lines.mjs
Project name? Port [3000]? Create it (y/n)?
-> input ended before an answer to "Create it (y/n)?"
```

The prompts run back to back because the piped input is already waiting; every line is still matched to the right question, and a short input ends with a clear error instead of hanging.

**Example 5 — history: the `'history'` event, `historySize`, and keeping a secret out of history.**

javascript

```
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';

const input = new PassThrough();
const output = new PassThrough();      // we ignore the echoed escape codes
output.resume();

const rl = createInterface({
  input, output,
  terminal: true,                       // history only exists in terminal mode
  history: ['ls', 'pwd'],               // newest first, as in a saved history file
  historySize: 3,
  removeHistoryDuplicates: true,
});

rl.on('history', (h) => {
  // The listener gets the live array: mutating it changes what is kept.
  if (h[0]?.startsWith('secret-')) h.shift();
  console.log('history event:', JSON.stringify(h));
});
rl.on('line', (line) => console.log('line:', JSON.stringify(line)));

const UP = '\x1b[A';                    // the bytes an up-arrow key sends
input.write('git status\r');
input.write('npm test\r');
input.write('git status\r');            // duplicate: the older copy is removed
input.write(UP + UP + '\r');            // recall the 2nd most recent entry
input.write('secret-token\r');          // removed by the listener
input.write('whoami\r');
rl.close();

// Real output (Node v24.19.0):
//   history event: ["git status","ls","pwd"]
//   line: "git status"
//   history event: ["npm test","git status","ls"]
//   line: "npm test"
//   history event: ["git status","npm test","ls"]
//   line: "git status"
//   history event: ["npm test","git status","ls"]
//   line: "git status"
//   history event: ["npm test","git status"]
//   line: "secret-token"
//   history event: ["whoami","npm test","git status"]
//   line: "whoami"
```

History is newest-first and capped at `historySize` (3 here, so `pwd` drops off). `removeHistoryDuplicates` moves a repeated `git status` back to the front instead of keeping two copies. The `'history'` event (added in v15.8.0, v14.18.0) hands you the live array; mutating it changes what is stored, which is how you keep a secret out of history — here `shift()` drops `secret-token` before it is kept, so the next entry (`whoami`) pushes a clean list. The up-arrow (`\x1b[A`) recalls a previous line, which is why `git status` is submitted twice.

**Example 6 — edge case: attaching the `'line'` listener one tick too late.**

javascript

```
import { createReadStream } from 'node:fs';
import { writeFile, readFile, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';

await writeFile('nums.txt', Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n'));

// A: 'line' listener attached after an await
{
  const rl = createInterface({ input: createReadStream('nums.txt'), crlfDelay: Infinity });
  const closed = once(rl, 'close');      // registered early, so we can still see the end
  await readFile('nums.txt');            // any real I/O wait lets the input start flowing
  let count = 0;
  rl.on('line', () => count++);
  await closed;
  console.log(`A  'line' attached after an await : ${count} of 1000 lines`);
}

// C: listener attached in the same synchronous turn as createInterface
{
  const rl = createInterface({ input: createReadStream('nums.txt'), crlfDelay: Infinity });
  let count = 0;
  rl.on('line', () => count++);
  await once(rl, 'close');
  console.log(`C  'line' attached right away      : ${count} of 1000 lines`);
}
await rm('nums.txt');

// Real output (Node v24.19.0):
//   A  'line' attached after an await : 0 of 1000 lines
//   C  'line' attached right away      : 1000 of 1000 lines
```

In case A, awaiting a real I/O operation (`readFile`) before attaching the `'line'` listener lets the file stream flow and the lines are emitted to nobody — the handler sees **0 of 1000**. In case C the listener is attached in the same tick, so it catches all 1000. (A `for await (const line of rl)` started after the same await hangs forever instead, because the iterator is still waiting for lines that already went by.) Not every await loses data: awaiting a microtask or `setImmediate` is early enough; it is a real timer or I/O wait that lets the stream drain first. The safe rule is to attach the consumer immediately.

**Example 7 — readline vs a hand-written stream splitter.**

readline is not the only way to split a byte stream into lines, and it is not always the best. Lesson 37's corrected `createCsvParser()` shows the hand-written pattern: a `StringDecoder` to hold back a split multi-byte character, a carried `tail` string for the incomplete last line, and a `flush` that emits whatever is left when the input ends. That is exactly what readline does internally — so a Transform built the same way gives the same lines:

javascript

```
import { Readable, Transform } from 'node:stream';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';

// Hand-written splitter, same shape as lesson 37's createCsvParser()
function createLineSplitter() {
  const decoder = new StringDecoder('utf8');
  let tail = '';
  const clean = (l) => (l.endsWith('\r') ? l.slice(0, -1) : l);   // accept CRLF
  return new Transform({
    readableObjectMode: true,
    transform(buf, _e, cb) {
      const lines = (tail + decoder.write(buf)).split('\n');
      tail = lines.pop();                  // maybe half a line: keep it
      for (const l of lines) this.push(clean(l));
      cb();
    },
    flush(cb) {
      const last = tail + decoder.end();
      if (last) this.push(clean(last));    // last line without a trailing newline
      cb();
    },
  });
}

const collect = async (it) => { const out = []; for await (const l of it) out.push(l); return JSON.stringify(out); };
const src = (s) => Readable.from([Buffer.from(s)]);

for (const s of ['a\nb', 'a\r\nb\r\n', 'a\n\n', 'a\rb', '']) {
  const viaReadline = await collect(createInterface({ input: src(s), crlfDelay: Infinity }));
  const viaSplitter = await collect(src(s).pipe(createLineSplitter()));
  console.log(`${JSON.stringify(s).padEnd(13)} readline=${viaReadline.padEnd(14)} splitter=${viaSplitter}`);
}

// Real output (Node v24.19.0):
//   "a\nb"        readline=["a","b"]      splitter=["a","b"]
//   "a\r\nb\r\n"  readline=["a","b"]      splitter=["a","b"]
//   "a\n\n"       readline=["a",""]       splitter=["a",""]
//   "a\rb"        readline=["a","b"]      splitter=["a\rb"]
//   ""            readline=[]             splitter=[]
```

They agree everywhere except the lone `\r`: readline treats a bare `\r` as a line break, the splitter above only breaks on `\n`. That is the one behavioural difference to know. Choose readline when you want a drop-in line reader with TTY editing and history for free. Choose a hand-written Transform when you need to plug line splitting into a `pipeline` next to other transforms (as lesson 37 does with CSV), when you want a different delimiter, or when you measured readline as the bottleneck.

**And it can be the bottleneck.** On this machine (Node v24.19.0, 8-core i5-1135G7), splitting a 102 MiB, 2-million-line log file into lines and summing their lengths, best of several runs:

text

```
method            time (best)   peak RSS
readline 'line'     ~0.47 s      72 MiB
readline for await  ~0.64 s      78 MiB
Transform splitter  ~0.34 s      65 MiB
readFile + split    ~0.44 s     344 MiB
```

The hand-written Transform was the fastest and leanest; `for await` over readline was the slowest, matching the docs' own note that iteration lags the `'line'` event. Reading the whole file and `split('\n')` was competitive on speed but held the entire file plus the array of lines in memory (344 MiB vs tens of MiB), which is the memory blow-up streams exist to avoid. Numbers will differ on other hardware; measure your own before optimizing.

## Common mistakes & gotchas

- **Forgetting `crlfDelay: Infinity` for files.** Without it, a `\r` and `\n` that land in separate chunks (which happens on large files) become two line breaks, inserting phantom empty lines. For any file that might be CRLF, pass `Infinity`.
- **Attaching `'line'` late.** The interface starts reading when you create it. An `await` of real I/O before you attach `'line'` or start `for await` drops the lines that arrive in between (Example 6). Attach the consumer in the same synchronous turn.
- **Expecting history from a pipe.** History needs `terminal: true`. When `stdin` is a pipe, `isTTY` is undefined, so history is off and `\x1b[A` arrives as literal text instead of recalling a line.
- **Not handling the input stream's `'error'`.** `createInterface` does not swallow errors on `input`. A missing file makes the readable emit `'error'`, which surfaces as a rejection from `for await` (so wrap it in `try/catch`) or as a `readline` `'error'` event (added in v16.0.0) in the callback style.
- **Confusing `readline` and `readline/promises`.** `rl.question(q, cb)` is the callback module; `await rl.question(q)` is the promises module. Importing the wrong one gives you the wrong `question` shape.
- **Assuming the last line needs a trailing newline.** readline emits a final line with no trailing newline (Example 1). A hand-written `split('\n')` on a buffered read also does this, but a naive chunk-by-chunk splitter that only emits on `\n` will silently drop it.

## Best practices

- **Use `for await (const line of rl)` for file and pipe reading.** It is the clearest form and backpressures naturally. The docs note it is a little slower than the `'line'` event; reach for the event only when a measurement says line throughput is the bottleneck.
- **Always pass `crlfDelay: Infinity` when the source may be a file.** It is the difference between correct and subtly-wrong on Windows-authored input.
- **Prefer `readline/promises` for prompts**, and pass `{ signal }` for deadlines and cancellation, matching the AbortSignal pattern from lesson 22.
- **Pull from the async iterator for scripted prompts**, as in Example 4, so the same code works whether a human types or a pipe supplies the answers.
- **Scrub secrets in the `'history'` event listener** (or set `historySize: 0`) so passwords are not recalled with the up arrow.
- **Call `rl.close()`** when you are done prompting, or the process stays alive waiting on `stdin`.

## ⭐ Interview lens

> **Q: “How would you process a 10 GB log file line by line in Node?”**  
> A: `createInterface({ input: fs.createReadStream(path), crlfDelay: Infinity })` and `for await (const line of rl)`. The file streams in chunks, so memory stays flat; `crlfDelay: Infinity` handles CRLF correctly. *Trap:* `fs.readFileSync` then `split('\n')` loads the whole file into memory — fine for a config, fatal for 10 GB.

> **Q: “Your `rl.on('line', …)` handler never fires. What is wrong?”**  
> A: Most likely the listener was attached after an `await` of real I/O, so the stream already flowed and the lines were emitted before anyone was listening. Attach `'line'` (or start the `for await`) in the same synchronous turn as `createInterface`. Also check the input actually has data and that you are not confusing the callback and promises modules.

> **Q: “What does `crlfDelay` do, and why `Infinity`?”**  
> A: It is the window after a lone `\r` to wait for a following `\n`. With the default 100 ms, a `\r` and `\n` split across chunks more than 100 ms apart become two line breaks (a phantom empty line). `Infinity` means a `\r` is never a break on its own when a `\n` could still follow, so every `\r\n` is one line — the correct setting for files.

> **Q: “How do you put a timeout on a terminal prompt?”**  
> A: Use `node:readline/promises` and pass `{ signal: AbortSignal.timeout(ms) }` to `rl.question`. It rejects with an `AbortError` whose `cause` is a `TimeoutError`. Catch it and fall back to a default or abort the command.

> **Q: “readline vs writing your own line splitter — when each?”**  
> A: readline for a quick line reader, especially interactive ones (it gives TTY editing and history for free). A hand-written Transform (StringDecoder + carried tail + flush, like lesson 37's CSV parser) when you need it inside a `pipeline`, a non-newline delimiter, or maximum throughput — it was the fastest and leanest in the benchmark above.

## Cheat-card

- **Line reading:** `const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity }); for await (const line of rl) {…}`.
- **crlfDelay:** default `100`; use `Infinity` for files so `\r\n` is always one break. A lone `\r` is always its own break.
- **Last line:** emitted even with no trailing newline. A second trailing `\n` yields a real empty final line.
- **Prompts:** `node:readline/promises`, `const a = await rl.question('q? ')`; add `{ signal: AbortSignal.timeout(ms) }` for a deadline (rejects `AbortError`, cause `TimeoutError`). Stable since v24.0.0.
- **Pipe-safe prompts:** pull from `rl[Symbol.asyncIterator]()` one `.next()` at a time.
- **History (terminal mode only):** `history` (newest first), `historySize` (default 30), `removeHistoryDuplicates`; `'history'` event (v15.8.0) gives the live array — mutate it to scrub secrets.
- **Gotcha:** attach `'line'` / start `for await` in the same synchronous turn as `createInterface`, or lines are lost.
- **Close:** call `rl.close()` or the process hangs on `stdin`.
- **vs splitter:** a Transform with StringDecoder + carried tail + flush (lesson 37 CSV) is faster/leaner and composes in a `pipeline`; readline breaks on a lone `\r`, the simple splitter does not.

---

## Learn More

- [Readline nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/readline.html)
- [String decoder nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/string_decoder.html)
