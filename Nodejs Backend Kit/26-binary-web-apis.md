---
title: "Binary Web APIs: TextEncoder, Blob, File, atob/btoa and structuredClone"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Binary Web APIs: TextEncoder, Blob, File, atob/btoa and structuredClone

*14 min read · Updated 10 Oct 2026 · Topic 84 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

The binary web APIs are the globals browsers and Node share for bytes and text: TextEncoder and TextDecoder turn strings into UTF-8 bytes and back, Blob and File are immutable byte sequences with a type, atob and btoa do legacy base64 on one-byte characters, and structuredClone deep-copies data the way postMessage does. They exist so the same code can run in Node, a browser, or an edge worker without Buffer. The trade-off is that each one has a sharp edge: a split character becomes two replacement characters, btoa throws on characters above one byte, and structuredClone drops a class's methods.

## Why it matters

Lesson 25 covers Buffer, Node's own byte type. Node also has the byte and text APIs that browsers, Deno, Bun, and Cloudflare Workers share: TextEncoder, TextDecoder, Blob, File, atob, btoa, and structuredClone. They are globals, so no import is needed. fetch, FormData, Request, and Response return and accept them, so you meet them as soon as you await res.blob or read an upload from formData.

Code that uses only these APIs runs unchanged in a browser, a worker, or an edge runtime. Code that reaches for Buffer does not. Each API has a sharp edge that causes real bugs. Decoding chunks one at a time without stream true turns a split character into two replacement characters. btoa of a euro sign throws instead of encoding. structuredClone silently turns a class instance into a plain object, and turns a Buffer into a plain Uint8Array.

## The concept, simply

All of these APIs work on the same raw material: an ArrayBuffer, a fixed block of bytes, seen through a Uint8Array view. Buffer is a Uint8Array subclass, so every API below also accepts a Buffer.

TextEncoder turns a JavaScript string into UTF-8 bytes, a Uint8Array. It only knows UTF-8. encodeInto writes into an array you already have.

TextDecoder turns bytes back into a string, UTF-8 by default or any WHATWG encoding label. WHATWG is the group whose encoding standard browsers follow. It can throw on bad bytes with fatal, keep or strip a byte order mark with ignoreBOM, and hold back an incomplete character between calls when you pass stream true.

Blob is an immutable, sized sequence of bytes with a MIME type label. MIME is the type string such as text/plain. You read a Blob with promises, text, arrayBuffer, or bytes, or as a web ReadableStream from stream, and you cut it with slice.

File is a Blob with a name and a lastModified timestamp. Uploaded form fields arrive as Files.

atob and btoa convert between base64 and a binary string, meaning a string with one character per byte, code points 0 through 255. The Node docs mark them Legacy.

structuredClone(value, { transfer }) makes a deep copy using the HTML structured clone algorithm, the same one postMessage uses between worker threads. transfer moves an ArrayBuffer instead of copying it.

## How it works

1. Text to bytes. new TextEncoder().encode(str) walks the string's UTF-16 code units and writes each character as 1 to 4 UTF-8 bytes into a new Uint8Array. encodeInto(str, dest) writes into dest and stops before a character that does not fit. It returns read and written: UTF-16 code units consumed, and bytes written.
2. Bytes to text. new TextDecoder(label, { fatal, ignoreBOM }) creates a decoder with internal state. decode turns the bytes into a string. An invalid sequence becomes the replacement character U+FFFD, or throws a TypeError if fatal is true.
3. Chunks. decode(chunk, { stream: true }) decodes what it can and keeps the bytes of a character cut off at the end. The next decode puts those bytes in front of its input. A final decode with no arguments flushes. A leftover incomplete sequence comes out as the replacement character, and the decoder resets.
4. Blobs. new Blob(parts, { type }) copies the parts into one immutable byte sequence. Strings are encoded as UTF-8. slice(start, end, type) synchronously returns a new Blob for a byte range. text, arrayBuffer, and bytes return promises. stream returns a WHATWG ReadableStream of Uint8Array chunks.
5. Files. new File(parts, name, { type, lastModified }) adds two read-only properties. lastModified defaults to the current time in milliseconds.
6. Base64 the legacy way. btoa checks that every character is at or below U+00FF, treats each one as a byte, and base64-encodes those bytes. Anything above that throws a DOMException named InvalidCharacterError. atob returns one character per decoded byte, so it does not give you UTF-8 text back.
7. Cloning. structuredClone walks the value and copies each supported type, keeping shared references and cycles. Functions and symbols cannot be copied and throw DataCloneError. Prototypes are not copied, so class instances lose theirs. With transfer set to a list of ArrayBuffers, the bytes are moved, and the original ArrayBuffer is detached, length 0.

stream true is the web version of StringDecoder from lesson 37. TextDecoderStream wraps the same idea as a TransformStream for web streams. Use one decoder per byte stream, for its whole life. A new decoder per chunk is the bug.

What structuredClone copies. Primitives except symbols, including BigInt. Plain objects and arrays. Date, RegExp, Map, Set, ArrayBuffer, and all typed arrays. DataView. Error types. Blob and File. Cyclic or shared references. For plain objects it copies only own enumerable string-keyed properties. It runs getters and stores the values. It drops symbol keys and non-enumerable properties. The prototype is not copied, so a class instance comes back as a plain object with the same own data, and a Buffer comes back as a plain Uint8Array.

When to use these instead of Buffer. Buffer is still the right tool inside Node-only code: binary protocol parsing such as readUInt16BE, hex and base64url, and fs and net results. The web APIs win when the code must also run elsewhere, or when the API you call already speaks them.

| Task | Use | Why not just Buffer |
| --- | --- | --- |
| String to UTF-8 bytes in shared code | `new TextEncoder().encode(s)` | Buffer does not exist in browsers or most edge runtimes |
| Fill a preallocated array without allocating | `encoder.encodeInto(s, u8)` | `buf.write(s)` works too, but only on a Buffer |
| Bytes to string, rejecting invalid UTF-8 | `new TextDecoder('utf-8', { fatal: true })` | `buf.toString()` replaces bad bytes and never throws |
| Decode a chunked byte stream | one TextDecoder with `{ stream: true }`, or TextDecoderStream | per-chunk toString is wrong in Node and in the browser |
| Bytes with a MIME type, for fetch, FormData, or Response | Blob or File | a Buffer has no type or name |
| Base64 in Node | `Buffer.from(s).toString('base64')` | atob and btoa are Legacy and Latin-1 only |
| Deep copy of Date, Map, Set, and cycles | `structuredClone(v)` | JSON turns a Date into a string, a Map into an empty object, and throws on cycles |
| Hand off a large byte array without copying | `structuredClone(v, { transfer: [ab] })` | a pooled Buffer's ArrayBuffer cannot be transferred |

## Code examples

**Example 1 — `TextEncoder`, `encodeInto` and the default `TextDecoder`.**

javascript

```
const enc = new TextEncoder();
console.log('encoding:', enc.encoding);           // always 'utf-8'

const bytes = enc.encode('héllo €');
console.log(bytes.constructor.name, bytes.length, bytes);
console.log('string length:', 'héllo €'.length);

// encodeInto writes into an array you already own and reports how far it got
const target = new Uint8Array(6);
const r = enc.encodeInto('héllo €', target);
console.log('encodeInto:', r, target);

// The decoder turns bytes back into a string
const dec = new TextDecoder();                   // default 'utf-8'
console.log('decoded:', dec.decode(bytes));
console.log('from a Buffer too:', dec.decode(Buffer.from('ok')));

// Real output (Node v24.19.0):
//   encoding: utf-8
//   Uint8Array 10 Uint8Array(10) [
//     104, 195, 169, 108,
//     108, 111,  32, 226,
//     130, 172
//   ]
//   string length: 7
//   encodeInto: { read: 5, written: 6 } Uint8Array(6) [ 104, 195, 169, 108, 108, 111 ]
//   decoded: héllo €
//   from a Buffer too: ok
```

The string has 7 UTF-16 code units but 10 UTF-8 bytes (`é` is 2, `€` is 3). `encodeInto` filled the 6-byte target with `h`, `é` (2 bytes), `l`, `l`, `o`, and stopped: `read: 5` code units, `written: 6` bytes. It never writes half a character: in a separate run, `encodeInto('aé', new Uint8Array(2))` returned `{ read: 1, written: 1 }`, leaving the second byte unused. If `read < str.length`, the string did not fit and you need a bigger array.

**Example 2 — `fatal`, `ignoreBOM` and other encodings.**

javascript

```
const bad = new Uint8Array([0x68, 0x69, 0xff, 0x21]);   // 'hi', an invalid byte, '!'

// Default: invalid bytes become U+FFFD and decoding carries on
console.log('default :', JSON.stringify(new TextDecoder().decode(bad)));

// fatal: true makes the same input throw
try {
  new TextDecoder('utf-8', { fatal: true }).decode(bad);
} catch (err) {
  console.log('fatal   :', err.name, err.code, '-', err.message);
}

// A UTF-8 byte order mark (EF BB BF) in front of 'id'
const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x69, 0x64]);
const a = new TextDecoder().decode(withBom);
const b = new TextDecoder('utf-8', { ignoreBOM: true }).decode(withBom);
console.log('BOM stripped (default):', a.length, JSON.stringify(a), a === 'id');
console.log('ignoreBOM: true keeps it:', b.length, JSON.stringify(b), b === 'id');

// Other labels work too
console.log('latin1 label ->', new TextDecoder('latin1').encoding,
  new TextDecoder('utf-16le').decode(new Uint8Array([0x68, 0, 0x69, 0])));

// Real output (Node v24.19.0):
//   default : "hi�!"
//   fatal   : TypeError ERR_ENCODING_INVALID_ENCODED_DATA - The encoded data was not valid for encoding utf-8
//   BOM stripped (default): 2 "id" true
//   ignoreBOM: true keeps it: 3 "﻿id" false
//   latin1 label -> windows-1252 hi
```

Without `fatal`, the `0xff` byte became `�` and decoding carried on. With `fatal: true` the decoder threw a `TypeError` with code `ERR_ENCODING_INVALID_ENCODED_DATA`. Use this when the input must be valid UTF-8 (a JSON body, a username), because a replacement character hides corruption. The BOM case shows the default: the 3-byte BOM is removed, so the result `=== 'id'`. `ignoreBOM: true` keeps it as an invisible U+FEFF at index 0, and the equality check fails. The label `'latin1'` maps to `windows-1252`, as the WHATWG Encoding Standard requires. Non-UTF encodings need a full-ICU build; this binary reports `process.config.variables.icu_small === false` (ICU 78.3).

**Example 3 — edge case: a multibyte character split across chunks.**

javascript

```
// The same bytes lesson 37 uses: '2,Zoë' where 'ë' is 2 bytes (c3 ab),
// split so the first chunk ends with only the first byte of 'ë'.
const bytes = new TextEncoder().encode('2,Zoë,2500\n');
const chunks = [bytes.subarray(0, 5), bytes.subarray(5)];
console.log('chunk 1 ends with', chunks[0].at(-1).toString(16), '| chunk 2 starts with', chunks[1][0].toString(16));

// Wrong: a fresh decode per chunk, each call treats its chunk as complete
const naive = chunks.map((c) => new TextDecoder().decode(c)).join('');
console.log('per-chunk decode :', JSON.stringify(naive));

// Right: one decoder, { stream: true } on every chunk, then a final decode() to flush
const dec = new TextDecoder();
let out = '';
for (const c of chunks) {
  const piece = dec.decode(c, { stream: true });
  console.log('  stream piece   :', JSON.stringify(piece));
  out += piece;
}
out += dec.decode();               // no argument, no stream flag: flush what is left
console.log('stream: true     :', JSON.stringify(out));

// Forgetting the final decode() loses an incomplete tail silently
const d2 = new TextDecoder();
const lost = d2.decode(bytes.subarray(0, 5), { stream: true });
console.log('no final flush   :', JSON.stringify(lost), '(the held byte is never emitted)');
console.log('flush on a cut-off stream:', JSON.stringify(d2.decode()));

// Real output (Node v24.19.0):
//   chunk 1 ends with c3 | chunk 2 starts with ab
//   per-chunk decode : "2,Zo��,2500\n"
//     stream piece   : "2,Zo"
//     stream piece   : "ë,2500\n"
//   stream: true     : "2,Zoë,2500\n"
//   no final flush   : "2,Zo" (the held byte is never emitted)
//   flush on a cut-off stream: "�"
```

This is the same failure that lesson 37's old CSV parser had, now with the web API:

1. Chunk 1 ends with `c3`, the first byte of `ë`. A fresh decoder sees an incomplete sequence at the end of its input and emits `�`.
2. Chunk 2 starts with `ab`, a continuation byte with no lead byte. A second fresh decoder emits another `�`. One character became **two** replacement characters.
3. With one decoder and `{ stream: true }`, the first call returns `"2,Zo"` and keeps `c3`. The second call puts `c3` in front of `ab` and returns `"ë,2500\n"`.
4. The final `decode()` flushes. If the stream really ended in the middle of a character, the flush returns `�`. If you skip it, the held byte is silently dropped.

**Example 4 — `Blob`: building, slicing and reading.**

javascript

```
// A Blob is built from parts: strings (UTF-8 encoded), typed arrays, ArrayBuffers, other Blobs
const parts = ['id,name\n', new Uint8Array([0x31, 0x2c]), 'Zoë\n'];
const blob = new Blob(parts, { type: 'text/csv' });
console.log('size:', blob.size, '| type:', JSON.stringify(blob.type));

// The source array can change afterwards: the Blob took a copy
parts[1][0] = 0x39;
console.log('text():', JSON.stringify(await blob.text()));

// slice(start, end, type) returns a new Blob for a byte range, synchronously
const header = blob.slice(0, 7);
const rest = blob.slice(8, undefined, 'text/plain');
console.log('slice 0-7:', JSON.stringify(await header.text()), '| type:', JSON.stringify(header.type));
console.log('slice 8- :', JSON.stringify(await rest.text()), '| type:', JSON.stringify(rest.type));

// arrayBuffer() and bytes() give the raw bytes
const ab = await blob.arrayBuffer();
console.log('arrayBuffer():', ab.constructor.name, ab.byteLength);
console.log('bytes():', await blob.slice(-4).bytes());

// stream() returns a WHATWG ReadableStream of Uint8Array chunks
const textStream = blob.stream().pipeThrough(new TextDecoderStream());
for await (const chunk of textStream) console.log('stream chunk:', JSON.stringify(chunk));

// type is a label only; nothing checks it against the content
console.log(new Blob(['not really a png'], { type: 'image/png' }).type);

// Real output (Node v24.19.0):
//   size: 15 | type: "text/csv"
//   text(): "id,name\n1,Zoë\n"
//   slice 0-7: "id,name" | type: ""
//   slice 8- : "1,Zoë\n" | type: "text/plain"
//   arrayBuffer(): ArrayBuffer 15
//   bytes(): Uint8Array(4) [ 111, 195, 171, 10 ]
//   stream chunk: "id,name\n"
//   stream chunk: "1,"
//   stream chunk: "Zoë\n"
//   image/png
```

`size` is in bytes (15, because `ë` is 2). The constructor copied the parts, so changing `parts[1]` afterwards had no effect. `slice()` uses byte offsets, accepts negative values like `Array.prototype.slice`, and gives an empty `type` unless you pass one. In this run `stream()` produced one chunk per original part. Do not rely on chunk sizes: pipe through `TextDecoderStream` (as here) so a character split between chunks still decodes correctly. `type` is only a label. Nothing checks it against the bytes, so never trust an uploaded file's `type` for security decisions.

**Example 5 — `File`, and where you get one on a server.**

javascript

```
import { File as BufferFile, Blob as BufferBlob } from 'node:buffer';

// File = Blob + name + lastModified
const file = new File(['hello\n'], 'notes.txt', { type: 'text/plain', lastModified: 1760054400000 });
console.log(file.name, file.size, file.type, file.lastModified, new Date(file.lastModified).toISOString());
console.log('File is a Blob:', file instanceof Blob, '| global is node:buffer export:', File === BufferFile, Blob === BufferBlob);
console.log('text():', JSON.stringify(await file.text()));

// lastModified defaults to the current time
const now = Date.now();
console.log('default lastModified ~ now:', Math.abs(new File([], 'x').lastModified - now) < 1000);

// The usual source of a File on a server: FormData from fetch / Request / Response
const form = new FormData();
form.append('upload', new Blob(['a,b\n1,2\n'], { type: 'text/csv' }), 'data.csv');
const req = new Request('http://localhost/upload', { method: 'POST', body: form });
const parsed = await req.formData();          // parses the multipart body again
const up = parsed.get('upload');
console.log(up.constructor.name, up.name, up.type, up.size, JSON.stringify(await up.text()));

// Real output (Node v24.19.0):
//   notes.txt 6 text/plain 1760054400000 2025-10-10T00:00:00.000Z
//   File is a Blob: true | global is node:buffer export: true true
//   text(): "hello\n"
//   default lastModified ~ now: true
//   File data.csv text/csv 8 "a,b\n1,2\n"
```

The global `File` and `Blob` are the same classes that `node:buffer` exports. `File` adds only `name` and `lastModified`. Everything else (`text()`, `slice()`, `stream()`) is inherited from `Blob`. `FormData.append(name, blob, filename)` wraps a `Blob` in a `File`, and `Request.formData()` parses a multipart body back into `File` objects. A `fetch`-style handler receives uploads this way.

**Example 6 — `atob`/`btoa` fail on non-Latin-1 text; what to use instead.**

javascript

```
// btoa takes a "binary string": every character must be U+0000..U+00FF (Latin-1)
console.log(btoa('hello'), btoa('café'));        // 'é' is U+00E9: allowed, encoded as ONE byte
console.log('Buffer (UTF-8) for café:', Buffer.from('café').toString('base64'));  // two bytes for 'é'

try {
  btoa('price: €5');                             // '€' is U+20AC: outside Latin-1
} catch (err) {
  console.log(err.constructor.name, err.name, err.code, '-', err.message);
}

// atob returns a binary string (one char per byte), NOT the original UTF-8 text
const fromBuffer = Buffer.from('price: €5').toString('base64');
console.log('Buffer base64:', fromBuffer);
const bin = atob(fromBuffer);
console.log('atob of it   :', bin.length, 'chars, codes', [...bin].map((c) => c.charCodeAt(0).toString(16)).join(' '));

// atob also rejects characters that are not base64
try { atob('abc$'); } catch (err) { console.log('atob:', err.name, '-', err.message); }

// Replacements: Buffer in Node...
console.log('Buffer round trip :', Buffer.from(fromBuffer, 'base64').toString('utf8'));
console.log('base64url variant :', Buffer.from('ü?>').toString('base64url'));
// ...and the old portable workaround: go through UTF-8 bytes yourself
const bytes = new TextEncoder().encode('price: €5');
const b64 = btoa(String.fromCharCode(...bytes));
const back = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
console.log('TextEncoder+btoa  :', b64, '->', back);

console.log('Uint8Array.prototype.toBase64 on this V8:', typeof Uint8Array.prototype.toBase64);

// Real output (Node v24.19.0):
//   aGVsbG8= Y2Fm6Q==
//   Buffer (UTF-8) for café: Y2Fmw6k=
//   DOMException InvalidCharacterError 5 - Invalid character
//   Buffer base64: cHJpY2U6IOKCrDU=
//   atob of it   : 11 chars, codes 70 72 69 63 65 3a 20 e2 82 ac 35
//   atob: InvalidCharacterError - Invalid character
//   Buffer round trip : price: €5
//   base64url variant : w7w_Pg
//   TextEncoder+btoa  : cHJpY2U6IOKCrDU= -> price: €5
//   Uint8Array.prototype.toBase64 on this V8: undefined
```

Four separate problems show up here:

- `btoa('café')` works but encodes `é` as the single byte `e9` (Latin-1), while every UTF-8 consumer expects `c3 a9`. The two base64 strings differ (`Y2Fm6Q==` vs `Y2Fmw6k=`), with no error.
- `btoa('€')` throws a `DOMException` named `InvalidCharacterError` (legacy code 5).
- `atob` returns one character per byte (11 characters for 9 visible ones), so you must turn it into bytes and decode them as UTF-8 yourself.
- `atob` also throws `InvalidCharacterError` on input that is not base64.

In Node, use `Buffer.from(text).toString('base64')` and `Buffer.from(b64, 'base64')`, which is what the docs' Legacy notice says. `Buffer` also has `'base64url'`, which neither `atob` nor `btoa` support. The `String.fromCharCode(...bytes)` workaround spreads every byte as a function argument, so keep it to small inputs: in a separate run, 1,000,000 bytes threw `RangeError: Maximum call stack size exceeded` (100,000 worked).

**`Uint8Array.prototype.toBase64` and `Uint8Array.fromBase64` are not available on Node v24.19.0.** V8 13.6 has them only behind the V8 flag `--js-base-64`, which `node --v8-options` describes as "in progress / experimental". With that flag, `new TextEncoder().encode("price: €5").toBase64()` printed `cHJpY2U6IOKCrDU=`. In a separate run, Node v25.9.0 (V8 14.1) had `typeof Uint8Array.prototype.toBase64 === 'function'` with no flag. Do not use the flag in production. Use `Buffer` until your minimum Node version ships these methods by default.

**Example 7 — `structuredClone`: what survives, what is lost, what throws.**

javascript

```
class Money {
  constructor(cents) { this.cents = cents; }
  format() { return `$${(this.cents / 100).toFixed(2)}`; }
}

const original = {
  when: new Date('2026-10-10T12:00:00Z'),
  tags: new Set(['a', 'b']),
  totals: new Map([['eur', 10n]]),          // BigInt is fine
  bytes: new Uint8Array([1, 2, 3]),
  re: /ab+c/gi,
  err: new RangeError('too big'),
  price: new Money(1999),
  nested: { deep: [1, { x: undefined }] },
};
original.self = original;                   // a cycle

const copy = structuredClone(original);
console.log('cycle kept       :', copy.self === copy, '| not the same object:', copy !== original);
console.log('Date             :', copy.when instanceof Date, copy.when.toISOString());
console.log('Set / Map        :', copy.tags instanceof Set, [...copy.tags], copy.totals.get('eur'));
console.log('Uint8Array copied:', copy.bytes, copy.bytes.buffer !== original.bytes.buffer);
console.log('RegExp           :', copy.re, '| Error:', copy.err instanceof RangeError, copy.err.message);
console.log('undefined kept   :', 'x' in copy.nested.deep[1]);

// Class instances come back as plain objects: own data survives, the prototype does not
console.log('class instance   :', copy.price, copy.price instanceof Money, typeof copy.price.format);

// Functions cannot be cloned
try {
  structuredClone({ onSave() {} });
} catch (err) {
  console.log('function         :', err.constructor.name, err.name, err.code, '-', err.message);
}
// Neither can a Symbol value
try { structuredClone(Symbol('id')); } catch (err) { console.log('symbol           :', err.name, '-', err.message); }

// Getters are run and their VALUE is copied; symbol keys and non-enumerable props are dropped
const tricky = { get now() { return 42; }, [Symbol('k')]: 1 };
Object.defineProperty(tricky, 'hidden', { value: 1, enumerable: false });
console.log('getter/symbol key:', structuredClone(tricky), Object.getOwnPropertyDescriptor(structuredClone(tricky), 'now'));

// Real output (Node v24.19.0):
//   cycle kept       : true | not the same object: true
//   Date             : true 2026-10-10T12:00:00.000Z
//   Set / Map        : true [ 'a', 'b' ] 10n
//   Uint8Array copied: Uint8Array(3) [ 1, 2, 3 ] true
//   RegExp           : /ab+c/gi | Error: true too big
//   undefined kept   : true
//   class instance   : { cents: 1999 } false undefined
//   function         : DOMException DataCloneError 25 - onSave() {} could not be cloned.
//   symbol           : DataCloneError - Symbol(id) could not be cloned.
//   getter/symbol key: { now: 42 } { value: 42, writable: true, enumerable: true, configurable: true }
```

`Date`, `Set`, `Map`, `BigInt`, typed arrays, `RegExp`, `Error` subclasses and the cycle all came through as real objects of the right type, and the `Uint8Array` got its own new `ArrayBuffer`. The `Money` instance kept `cents` but lost its prototype: `instanceof Money` is `false` and `format` is gone. Rebuild such objects yourself (`new Money(copy.price.cents)`). A function throws a `DOMException` named `DataCloneError` (legacy code 25), and so does a symbol value. The getter ran once, and the clone holds a plain data property `now: 42`. The symbol key and the non-enumerable property were dropped without an error.

**Example 8 — `transfer`, and why a `Buffer` is a poor thing to clone.**

javascript

```
// transfer: move an ArrayBuffer into the clone instead of copying its bytes
const big = new Uint8Array(16 * 1024 * 1024).fill(7);      // 16 MiB
const moved = structuredClone({ data: big }, { transfer: [big.buffer] });
console.log('clone has      :', moved.data.byteLength, 'bytes, first =', moved.data[0]);
console.log('original after :', big.byteLength, 'bytes, buffer.detached =', big.buffer.detached);
try { big.fill(1); console.log('fill on detached view is a no-op, length', big.length); }
catch (err) { console.log(err.name, err.message); }

// A Buffer goes in, a plain Uint8Array comes out
const buf = Buffer.from('hi');
const c = structuredClone(buf);
console.log('Buffer clone   :', c.constructor.name, Buffer.isBuffer(c), c);

// A pooled Buffer cannot be transferred: its ArrayBuffer is the shared 8 KiB pool
const small = Buffer.from('pooled');
console.log('small.length   :', small.length, '| small.buffer.byteLength:', small.buffer.byteLength);
try {
  structuredClone(small, { transfer: [small.buffer] });
} catch (err) {
  console.log('transfer pool  :', err.name, '-', err.message);
}

// Real output (Node v24.19.0):
//   clone has      : 16777216 bytes, first = 7
//   original after : 0 bytes, buffer.detached = true
//   TypeError Cannot perform %TypedArray%.prototype.fill on a detached ArrayBuffer
//   Buffer clone   : Uint8Array false Uint8Array(2) [ 104, 105 ]
//   small.length   : 6 | small.buffer.byteLength: 65536
//   transfer pool  : DataCloneError - Cannot transfer object of unsupported type.
```

With `transfer`, the 16 MiB of bytes moved into the clone and the original `ArrayBuffer` was detached: length 0, `detached === true`, and any typed-array method on the old view throws a `TypeError`. A cloned `Buffer` comes back as a plain `Uint8Array`, because only the `Uint8Array` part is cloneable. Wrap it again with `Buffer.from(c.buffer, c.byteOffset, c.length)` if you need `Buffer` methods. A small `Buffer` lives inside the shared allocation pool (64 KiB on this version, see lesson 25's additional topics). The `worker_threads` docs state that Node marks the pool's `ArrayBuffer`s as untransferable, so transferring one throws `DataCloneError`. To transfer, copy the bytes into their own `ArrayBuffer` first (`new Uint8Array(buf)`), or allocate with `Buffer.alloc`, which is not pooled.

## Common mistakes & gotchas

- A new TextDecoder, or a plain decode, per chunk treats each chunk as complete, so a character split across chunks becomes two replacement characters. Keep one decoder, pass stream true, and call decode once at the end.
- With stream true, bytes of an incomplete character stay inside the decoder. Without the final decode they never come out, and a truncated input is not reported as the replacement character.
- TextEncoder is UTF-8 only. encoding is always utf-8. For UTF-16 or Latin-1 bytes, use Buffer.from with utf16le or latin1.
- buf.toString never throws on bad UTF-8. Use TextDecoder with fatal true when invalid UTF-8 must be an error.
- btoa on user text throws InvalidCharacterError above U+00FF, and for characters such as é it silently writes the Latin-1 byte. In Node use Buffer. In portable code, encode to UTF-8 bytes first.
- atob output is a binary string, one character per byte. Turn it into a Uint8Array and decode with TextDecoder.
- blob.type and file.name come from the client. Check the actual bytes before you trust an upload.
- structuredClone does not keep classes. Prototypes, methods, getters as getters, symbol keys, and non-enumerable properties are lost. Functions and symbols throw DataCloneError.
- Cloning a Buffer and calling readUInt16BE on the result fails. The clone is a plain Uint8Array.
- After you transfer an ArrayBuffer, it is detached. byteLength is 0 and typed-array methods throw TypeError.

## Best practices

- Write shared browser, Node, and edge code against TextEncoder, TextDecoder, Blob, structuredClone, and crypto.subtle. Keep Buffer in Node-only modules.
- Reuse one TextEncoder and one TextDecoder per stream. The decoder is stateful, and one long-lived decoder is what makes stream true work.
- Turn on fatal true at trust boundaries where invalid UTF-8 should be rejected.
- Use Buffer for base64 in Node, including base64url for tokens and URLs, until Uint8Array toBase64 ships by default on your minimum Node version.
- Read a big Blob with stream piped through TextDecoderStream, not with text, which builds the whole string in memory.
- Use structuredClone for data, not for objects with behaviour. For class instances, write a toJSON and fromJSON pair, or a copy constructor.
- Transfer large ArrayBuffers you no longer need, and only ones you own outright, not a pooled Buffer's memory.

## ⭐ Interview lens

> **Q: “Why does `btoa('€')` throw, and how do you base64-encode Unicode text in Node?”**  
> btoa takes a binary string, one character per byte, so every character must be at or below U+00FF. The euro sign is U+20AC, so btoa throws a DOMException named InvalidCharacterError. To base64-encode Unicode in Node, turn the text into UTF-8 bytes first and encode those: Buffer.from(text).toString('base64'). In portable code, TextEncoder produces the bytes and btoa(String.fromCharCode(...bytes)) encodes them, but only for small inputs, because spreading a huge array blows the call stack. The trap is btoa of é. It does not throw. It writes the single Latin-1 byte e9, while UTF-8 consumers expect the two bytes c3 a9, so the base64 looks valid and is wrong. The limit of atob is the reverse: it returns one character per byte, not a Unicode string, so you still have to decode those bytes as UTF-8.

> **Q: “You decode a stream of UTF-8 chunks and some characters come out as `��`. What is wrong and how do you fix it?”**  
> A multibyte character was split at a chunk boundary, and each chunk was decoded as if it were finished. The lead byte and the continuation byte each became a replacement character, which is why you see two of them. Keep one TextDecoder for the whole stream. Call decode(chunk, { stream: true }) on every chunk so an incomplete character is held back, then call decode with no arguments once at the end to flush. TextDecoderStream does the same job on a web stream. In Node-only code, StringDecoder from node:string_decoder is the same idea. The limit is one decoder per stream. A second decoder, or forgetting the final flush, either splits the character again or silently drops the leftover byte.

> **Q: “What does `structuredClone` do with a class instance, a `Map`, a function and a cycle?”**  
> A class instance comes back as a plain object with its own enumerable data and no prototype, so its methods are gone. A Map is copied as a Map, not as a plain object. A function cannot be cloned and throws a DOMException named DataCloneError. A cycle is preserved: the clone points at itself, not at the original. That is the same algorithm postMessage uses between workers. For example, a Money instance keeps its cents field and loses format. You rebuild it with new Money(copy.cents). The limit is everything that is not data. Symbol keys, non-enumerable properties, and getters as getters are dropped, and a Buffer comes back as a plain Uint8Array with no Buffer methods.

> **Q: “What is the difference between `Blob` and `Buffer`?”**  
> A Buffer is a mutable Uint8Array view over memory you can read and write synchronously, including helpers such as toString and readUInt16BE. A Blob is an immutable byte sequence with a MIME type. You read it through promises, text or arrayBuffer or bytes, or through a stream, and slice returns another Blob for a byte range. fetch, FormData, and Response speak Blob and File. File adds a name and lastModified. You convert with Buffer.from(await blob.arrayBuffer()) and new Blob([buf]). The limit is that the Blob type string is only a label. Nothing checks it against the bytes, and a cloned Buffer is no longer a Buffer.

## Cheat-card

- Encode with new TextEncoder().encode. UTF-8 only. encodeInto returns read and written.
- Decode with TextDecoder. Bad bytes become the replacement character, or a TypeError if fatal is true.
- One decoder per stream. decode with stream true, then a final decode to flush.
- A byte order mark is stripped by default. ignoreBOM true keeps it.
- Blob: parts plus a type, size in bytes, slice, and text, arrayBuffer, bytes, or stream.
- File is a Blob plus name and lastModified. Uploads arrive as Files from formData.
- atob and btoa are legacy and Latin-1 only. In Node, use Buffer for base64, including base64url.
- structuredClone keeps Date, Map, Set, RegExp, BigInt, typed arrays, Error, Blob, and cycles. Functions and symbols throw DataCloneError. Prototypes are lost. A Buffer becomes a Uint8Array.
- transfer moves an ArrayBuffer and detaches the original. A pooled Buffer's memory cannot be transferred.

## Good to know

- TextEncoder and TextDecoder became globals in v11.0.0. They have been in node:util since v8.3.0.
- atob and btoa became globals in v16.0.0 and are Stability 3, Legacy.
- structuredClone was added in v17.0.0.
- Blob became a global in v18.0.0. buffer.Blob was added in v15.7.0 and left experimental status in v18.0.0.
- File became a global in v20.0.0. buffer.File was added in v19.2.0 and v18.13.0, left experimental status in v20.0.0, and has been cloneable since v23.0.0.
- blob.bytes was added in v22.3.0.
- TextDecoderStream has been stable since v23.11.0 and v22.15.0.
- Uint8Array toBase64 and fromBase64 are not on Node v24.19.0, V8 13.6, unless you pass the experimental V8 flag --js-base-64. Node v25.9.0, V8 14.1, has them with no flag. Do not use the flag in production.
- FormData.append of a Buffer stores the string, not a file. Checked on v24.19.0.
- TextDecoder label latin1 maps to windows-1252. Non-UTF encodings need a full ICU build.
- Spreading a million bytes into String.fromCharCode threw RangeError: Maximum call stack size exceeded. 100,000 bytes worked in a separate run.
- A legacy charset such as Shift_JIS or windows-1251 is new TextDecoder(label) on a full ICU build. Buffer's own encodings are utf8, utf16le, latin1, ascii, base64, base64url, and hex, plus aliases.
- Portable base64 on Node 24, for small inputs, is TextEncoder then btoa of String.fromCharCode on those bytes. Buffer is the Node answer.

---

## Learn More

- [Util: TextEncoder and TextDecoder (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/util.html)
- [Buffer: Blob and File (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/buffer.html)
- [Global objects (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/globals.html)
- [TextDecoder.decode() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode)
- [Blob developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
- [btoa() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa)
- [Uint8Array.prototype.toBase64() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array/toBase64)
- [structuredClone() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone)
- [The structured clone algorithm developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm)
