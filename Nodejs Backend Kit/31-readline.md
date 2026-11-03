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

## Say it in 30 seconds

`node:readline` watches a stream of text for a line ending and hands you each finished line as a string, even when a chunk cuts a line or a character in half. It exists so you can scan a huge log, or ask a question at the terminal, without loading the whole input into memory. The trade-off is that it starts reading the moment you create it, so a late listener loses lines, and a hand-written splitter can be faster when you only need lines inside a pipeline.

## Why it matters

Two jobs keep coming back. One is reading text one line at a time: a log too big for memory, standard input from a pipe, or a child process's output. You want each line as a string, and you do not want `fs.readFileSync` to load the whole file. The other is asking a person something at the terminal: a project name, a yes or no before a destructive command, or a small read-eval-print loop.

Splitting lines yourself is full of edges. A chunk can cut a line in half. A chunk can cut a multi-byte character in half. UTF-8 is the text encoding that uses one to four bytes per character. The last line often has no trailing newline. Windows files end a line with a carriage return and a line feed, written `\r\n`, instead of only a line feed, `\n`. readline handles those cases. This lesson covers line reading, promise-based prompts with a timeout, terminal history, and when a hand-written splitter is still the better tool.

## The concept, simply

`readline.createInterface(options)` builds an Interface. It sits on a Readable input, a source you read from, and optionally a Writable output, a sink you write to. It watches for end-of-line markers, `\n`, `\r`, or `\r\n`, and turns the bytes between them into complete line strings. Each finished line arrives as a `'line'` event, and also through an async iterator, so you can write `for await (const line of rl)`.

The options you actually set:

- **input** is the Readable: a file stream, `process.stdin`, or a socket. Required.
- **output** is the Writable used for prompts and for echoing what the person types. Optional.
- **crlfDelay** is how long to wait after a lone carriage return for a following line feed before treating that carriage return as its own line ending. Set it to `Infinity` so every `\r\n` is one break. That is the right choice for files. The default is 100 milliseconds, and Node raises anything smaller up to 100.
- **terminal** says whether to treat the streams as a TTY, a real terminal, with editing keys and history. The default follows `output.isTTY`.
- **history**, **historySize**, and **removeHistoryDuplicates** are the command history. They only work in terminal mode.

`node:readline` is the callback and event API: `rl.question(query, callback)`. `node:readline/promises` is the promise API: `await rl.question(query)`. Line reading with `createInterface` and `for await` is the same on both.

The interface starts consuming input as soon as you create it. If you then `await` something else before you attach `'line'` or start `for await`, lines that arrive in between are gone. Attach the consumer in the same synchronous turn as `createInterface`.

## How it works

1. You create the interface with an input stream. `createInterface` resumes the input and starts reading immediately.
2. Bytes arrive in chunks. readline decodes them to text, holds back a partial multi-byte character, appends to an internal buffer, and scans for line endings.
3. Each complete line is emitted as `'line'` and offered to the async iterator. The newline is stripped. A `\r` that sat just before `\n` is stripped too.
4. When the input ends, a final line with no trailing newline is still emitted, then `'close'` fires.
5. In terminal mode only, keystrokes are interpreted, the line is echoed to output, and completed lines go onto the history ring, which fires `'history'`.

With the default `crlfDelay` of 100 ms, a `\r` and a `\n` in the same chunk are one break. Split across chunks more than 100 ms apart, they become two breaks, and an empty line appears between them. A lone `\r`, the old classic-Mac ending, is always its own break. `crlfDelay: Infinity` means a `\r` is never its own ending if a `\n` could still follow. That is what you want for `\r\n` files.

History does nothing unless `terminal` is true, either because `output.isTTY` is true or because you passed `terminal: true`. When a pipe feeds stdin, `isTTY` is undefined, history is off, and arrow-key bytes such as `\x1b[A` arrive as plain text.

## Code examples

**Example 1: reading a file line by line with `for await`.**

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

The empty middle line comes back as an empty string, and the last line is delivered even though the file does not end in a newline. Memory stays flat because `createReadStream` feeds the interface in chunks.

**Example 2: edge case: CRLF, split line endings, lone `\r`, and a multi-byte character cut in half.**

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

A `\r` and `\n` more than `crlfDelay` apart become an empty line in the middle. `Infinity` joins them. A lone `\r` is always a break, a second trailing `\n` is a real empty line, and a split `ë` is reassembled by the internal `StringDecoder`.

**Example 3: a prompt with `readline/promises` and a per-question timeout.**

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

`rl.question` returns a promise, so each prompt is a plain `await`. `{ signal: AbortSignal.timeout(2000) }` cancels the question after two seconds. The rejection is an `AbortError` with code `ABORT_ERR`, and `err.cause` is a `TimeoutError`, the same shape lesson 22 documents for signal-aware core APIs.

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

The empty port answer falls back to 3000. The timed-out answer rejects as an `AbortError`.

**Example 4: a pipe-safe prompt loop that does not lose lines.**

The prompt above assumes a person. If you pipe every answer at once, the input can arrive and end before the next prompt is issued. Pulling one line at a time from the async iterator queues every line, so the same code works for a TTY and for a pipe:

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

The prompts run back to back because the piped input is already waiting. Each line still matches the right question, and a short input ends with a clear error instead of hanging.

**Example 5: history: the `'history'` event, `historySize`, and keeping a secret out of history.**

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

History is newest-first and capped at `historySize`, so `pwd` drops off at 3. Duplicates move to the front. The `'history'` listener gets the live array, and `shift()` drops `secret-token` before it is kept. The up-arrow bytes recall a previous line.

**Example 6: edge case: attaching the `'line'` listener one tick too late.**

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

Awaiting real I/O before `'line'` yields 0 of 1000 lines. Attaching in the same turn yields all 1000. A `for await` started after that await hangs. A microtask or `setImmediate` is early enough. A timer or I/O wait is not.

**Example 7: readline vs a hand-written stream splitter.**

A Transform can split lines the same way readline does internally: a `StringDecoder`, a carried tail, and a `flush`, which is the shape of lesson 37's CSV parser.

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

They agree everywhere except a lone `\r`. readline treats a bare `\r` as a line break. The splitter above only breaks on `\n`. Use readline when you want a line reader with TTY editing and history. Use the Transform when line splitting has to sit inside a `pipeline` next to other transforms, when the delimiter is not a newline, or when you measured readline as the bottleneck.

## Common mistakes & gotchas

- **Forgetting `crlfDelay: Infinity` for files.** A `\r` and `\n` that land in separate chunks become two breaks and insert empty lines. Pass `Infinity` for any file that might use Windows line endings.
- **Attaching `'line'` late.** The interface starts reading when you create it. An `await` of real I/O before `'line'` or `for await` drops the lines that arrive in between (Example 6). Attach the consumer in the same synchronous turn.
- **Expecting history from a pipe.** History needs `terminal: true`. When stdin is a pipe, `isTTY` is undefined, so history is off and arrow-key bytes arrive as text.
- **Not handling the input stream's `'error'`.** `createInterface` does not swallow errors on `input`. A missing file surfaces as a rejection from `for await`, so wrap it in `try/catch`, or as a readline `'error'` event in the callback style.
- **Confusing `readline` and `readline/promises`.** `rl.question(q, cb)` is the callback module. `await rl.question(q)` is the promises module. The wrong import gives you the wrong `question` shape.
- **Dropping a last line that has no newline.** readline emits that final line (Example 1). A splitter that only emits when it sees `\n` will silently drop it.

## Best practices

- **Use `for await (const line of rl)` for files and pipes.** It is the clearest form and it slows the source when you are slow. The docs note it is a little slower than the `'line'` event. Use the event when a measurement says line throughput is the bottleneck.
- **Pass `crlfDelay: Infinity` when the source may be a file.**
- **Prefer `readline/promises` for prompts**, and pass `{ signal }` for deadlines, matching the AbortSignal pattern from lesson 22.
- **Pull from the async iterator for scripted prompts**, as in Example 4, so a person and a pipe both work.
- **Scrub secrets in the `'history'` listener**, or set `historySize: 0`, so a password is not recalled with the up arrow.
- **Call `rl.close()`** when you are done prompting, or the process stays alive waiting on stdin.

## ⭐ Interview lens

> **Q: “How would you process a 10 GB log file line by line in Node?”**  
A: I would not load the file with `fs.readFile` or `readFileSync`. Those build one Buffer for the whole file, and 10 GB will exhaust the heap. `readline.createInterface` takes a Readable input, here `fs.createReadStream(path)`, and turns the bytes into complete lines. I pass `crlfDelay: Infinity` so a Windows carriage return plus line feed is always one break, even when those two bytes land in different chunks. Then `for await (const line of rl)` pulls one line, runs the handler, and pulls the next, so the file stream pauses when the handler is slow. Memory stays about the size of the stream buffer plus the current line. The limit is timing: the interface starts reading the moment you create it, so the loop has to start in that same turn, or the early lines are already gone.

> **Q: “Your `rl.on('line', …)` handler never fires. What is wrong?”**  
A: The interface starts consuming the input as soon as `createInterface` returns. If the `'line'` listener is attached after an `await` of real file or network work, the stream can finish in that gap and emit every line to nobody. Attach `'line'`, or start `for await`, in the same synchronous turn as `createInterface`. A microtask or `setImmediate` is still early enough. A timer or an I/O wait is not. Also check that the input actually has data, and that you imported the module whose `question` shape you meant to call. The limit is that a `for await` started after the lines have already passed does not catch up. It hangs, waiting for lines that will not come.

> **Q: “What does `crlfDelay` do, and why `Infinity`?”**  
A: `crlfDelay` is the wait, in milliseconds, after a lone carriage return before readline decides that `\r` is a line ending by itself. The default is 100. A `\r` and a `\n` in the same chunk are one break. If they arrive in different chunks more than 100 ms apart, you get two breaks and a phantom empty line. `Infinity` means a `\r` is never a break on its own while a `\n` might still follow, so every `\r\n` is one line. That is the setting for files. The limit is a lone `\r` with no `\n` after it, the old Mac ending. That is always its own break, even with `Infinity`.

> **Q: “readline vs writing your own line splitter — when each?”**  
A: readline is the built-in line reader. `createInterface` splits a Readable on line endings, and in terminal mode it also gives you editing keys and a history ring. A hand-written Transform does the same split with a `StringDecoder`, a carried tail, and a `flush`, which is the shape of lesson 37's CSV parser. Use readline when you want lines quickly, especially for a person at a terminal. Use the Transform when the splitter has to sit inside a `pipeline` beside other stages, when the delimiter is not a newline, or when you measured readline as the slow part. The limit is a bare carriage return: readline breaks on it, and the simple `\n` splitter does not.

## Cheat-card

- **Line reading:** `createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity })`, then `for await (const line of rl)`.
- **crlfDelay:** default 100. Use `Infinity` for files so `\r\n` is one break. A lone `\r` is always its own break.
- **Last line:** emitted even with no trailing newline. A second trailing `\n` is a real empty line.
- **Prompts:** `node:readline/promises`, `await rl.question('q? ')`, plus `{ signal: AbortSignal.timeout(ms) }`. That rejects with `AbortError` and cause `TimeoutError`.
- **Pipe-safe prompts:** pull one `.next()` at a time from `rl[Symbol.asyncIterator]()`.
- **History, terminal mode only:** `history` is newest first, `historySize` defaults to 30, `removeHistoryDuplicates` collapses repeats. The `'history'` event hands you the live array. Mutate it to drop secrets.
- **Gotcha:** attach `'line'` or start `for await` in the same turn as `createInterface`.
- **Close:** `rl.close()`, or the process hangs on stdin.
- **vs splitter:** a Transform with `StringDecoder`, a carried tail, and `flush` composes in a `pipeline`. readline breaks on a lone `\r`. The simple splitter does not.

## Good to know

- `node:readline/promises` was marked stable in v24.0.0.
- The `'history'` event was added in v15.8.0 and v14.18.0. The readline `'error'` event was added in v16.0.0.
- On Node v24.19.0, an 8-core i5-1135G7, splitting a 102 MiB, 2-million-line log and summing lengths, best of several runs:

text

```
method            time (best)   peak RSS
readline 'line'     ~0.47 s      72 MiB
readline for await  ~0.64 s      78 MiB
Transform splitter  ~0.34 s      65 MiB
readFile + split    ~0.44 s     344 MiB
```

Numbers differ by machine. Measure before you optimize. The Transform was fastest and leanest. `for await` was slowest. `readFile` plus `split` was close on time and held the whole file, 344 MiB against tens of MiB.

- How do you put a timeout on a terminal prompt? Use `node:readline/promises` and pass `{ signal: AbortSignal.timeout(ms) }` to `rl.question`. It rejects with an `AbortError` whose `cause` is a `TimeoutError`.
## Learn More

- [Readline nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/readline.html)
- [String decoder nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/string_decoder.html)
