---
title: "util: inspect, format, types and More"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# util: inspect, format, types and More

*15 min read · Updated 10 Oct 2026 · Topic 79 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

node:util is a drawer of small functions the rest of Node is built on: inspect turns a value into the string console.log prints, format fills in percent placeholders, types checks what a value really is across realms, and deprecate, styleText, and promisify cover warnings, terminal color, and callback-to-promise. It exists so you do not add a package for each of those jobs. The trade-off is that inspect output is for humans, not for tests or for hiding secrets, and instanceof lies about values that came from another realm.

## Why it matters

Every time you console.log an object and see a nested value replaced by [Object], that string came from util.inspect. Every console.log with a percent placeholder runs through util.format. When you need to know whether a value is actually a Date, including one that crossed a realm boundary, util.types answers where instanceof lies. A realm is a separate JavaScript environment, such as a vm context, a worker, or an iframe, with its own built-in prototypes. util.deprecate emits a warning once. util.styleText colors terminal output and respects NO_COLOR, so a tool does not dump escape codes into a log file.

Using these directly, instead of a dependency for color, formatting, or an is-promise check, means fewer packages and output you can shape when an object is confusing.

## The concept, simply

util is a collection of functions, not one object with a single theme. The ones worth knowing:

- util.inspect(value, options) turns any value into a readable string, the way console.log does. Options include depth, colors, compact, breakLength, sorted, showHidden, maxArrayLength, and getters. An object can customise its own output with the util.inspect.custom symbol.
- util.format(fmt, ...args) is printf-style substitution: percent s, d, i, f, j, o, O, c, and a doubled percent for a literal percent sign.
- util.types holds predicates such as isPromise, isDate, and isProxy. They check an object's internal V8 slot, not its prototype, so they stay correct across realms.
- util.deprecate(fn, msg, code) wraps a function so the first call prints one deprecation warning.
- util.inherits(ctor, superCtor) is the pre-class way to set up prototype inheritance. The docs mark it legacy and discourage it.
- util.styleText(format, text, options) wraps text in ANSI color codes and skips them when the output cannot show color.
- util.promisify(fn) turns an error-first callback function into one that returns a promise.
- util.parseArgs(config) is a built-in command-line flag parser. Lessons 96 and 04 cover it.

## How it works

1. Import it with import util from 'node:util', or pull out pieces, such as inspect and format from require('node:util').
2. inspect walks the value. It recurses up to depth levels, default 2, and replaces anything deeper with [Object] or [Array]. It respects a custom inspect method, marks circular references, and truncates long arrays and strings. console.log of an object is inspect with the stream's color setting.
3. format scans the format string left to right and consumes one argument per specifier. Extra arguments are appended, separated by spaces. A missing argument leaves the specifier in place.
4. types predicates call into C++ and read the object's internal type tag. They ignore the prototype chain, which is why they survive vm contexts and faked prototypes.
5. deprecate tracks codes. The first call with a given code emits one DeprecationWarning through the warning event. Later calls with the same code are silent. The flags --no-deprecation and --throw-deprecation change that.

Why types and instanceof disagree. instanceof checks whether a constructor's prototype sits anywhere on the value's prototype chain. That chain is per realm. A Date made inside a vm context has that context's Date.prototype, not yours, so value instanceof Date is false even though it is a genuine Date. Object.create(Date.prototype) can fake the chain the other way. util.types.isDate reads the internal DateValue slot, which only a real Date has and which no prototype trick can forge, so it is right in both cases.

## Code examples

**Example 1 — `inspect`: depth, sorting, compact, breakLength, maxArrayLength, colors.**

javascript

```
const { inspect } = require('node:util');

const order = {
  id: 42,
  customer: { name: 'Ada', address: { city: 'London', geo: { lat: 51.5, lng: -0.12 } } },
  zeta: true,
  alpha: 'first',
};

console.log('1 default (depth 2):');
console.log(inspect(order));
console.log('2 depth: Infinity, sorted: true:');
console.log(inspect(order, { depth: Infinity, sorted: true }));
console.log('3 compact: false (every key and element on its own line):');
console.log(inspect({ a: 1, b: [1, 2] }, { compact: false }));
console.log('4a breakLength: Infinity with the default compact: 3:');
console.log(inspect(order, { depth: Infinity, breakLength: Infinity }));
console.log('4b breakLength: Infinity with compact: true:');
console.log(inspect(order, { depth: Infinity, breakLength: Infinity, compact: true }));
console.log('5 maxArrayLength: 3 on 120 items:');
console.log(inspect(Array.from({ length: 120 }, (_, i) => i), { maxArrayLength: 3 }));
console.log('6 colors: true (escape codes made visible):');
console.log(JSON.stringify(inspect({ n: 1, s: 'x' }, { colors: true })));

// Real output (Node v24.19.0):
//   1 default (depth 2):
//   {
//     id: 42,
//     customer: { name: 'Ada', address: { city: 'London', geo: [Object] } },
//     zeta: true,
//     alpha: 'first'
//   }
//   2 depth: Infinity, sorted: true:
//   {
//     alpha: 'first',
//     customer: {
//       address: { city: 'London', geo: { lat: 51.5, lng: -0.12 } },
//       name: 'Ada'
//     },
//     id: 42,
//     zeta: true
//   }
//   3 compact: false (every key and element on its own line):
//   {
//     a: 1,
//     b: [
//       1,
//       2
//     ]
//   }
//   4a breakLength: Infinity with the default compact: 3:
//   {
//     id: 42,
//     customer: { name: 'Ada', address: { city: 'London', geo: { lat: 51.5, lng: -0.12 } } },
//     zeta: true,
//     alpha: 'first'
//   }
//   4b breakLength: Infinity with compact: true:
//   { id: 42, customer: { name: 'Ada', address: { city: 'London', geo: { lat: 51.5, lng: -0.12 } } }, zeta: true, alpha: 'first' }
//   5 maxArrayLength: 3 on 120 items:
//   [ 0, 1, 2, ... 117 more items ]
//   6 colors: true (escape codes made visible):
//   "{ n: \u001b[33m1\u001b[39m, s: \u001b[32m'x'\u001b[39m }"
```

`depth` is the single most useful option: the default `2` hides `geo` behind `[Object]`; `Infinity` shows it all. `sorted` reorders keys (note `alpha` moves to the front). `compact: false` puts every key and array element on its own line. `breakLength` is the width at which a value is split across lines — but with the default `compact: 3`, a few short inner objects still wrap, so you need `compact: true` as well (4b) to truly force one line. `maxArrayLength` truncates long arrays (default 100). `colors: true` wraps values in ANSI codes (visible here as `\u001b[33m` for the number).

**Example 2 — `inspect`: `showHidden`, `getters`, and `util.inspect.custom`.**

javascript

```
const { inspect } = require('node:util');

class User {
  #password = 'hunter2';                       // private field
  constructor(name, email) {
    this.name = name;
    Object.defineProperty(this, 'internalId', { value: 7, enumerable: false });
    this._email = email;
  }
  get email() { return this._email.replace(/^(.).*@/, '$1***@'); }  // getter on the prototype
  get domain() { return this._email.split('@')[1]; }
}
const u = new User('Ada', 'ada@example.com');
Object.defineProperty(u, 'masked', { get() { return u.email; }, enumerable: true });

console.log('default          :', inspect(u));
console.log('showHidden: true :', inspect(u, { showHidden: true }));
console.log('getters: true    :', inspect(u, { getters: true }));

// util.inspect.custom: the object decides how it is printed
class Secret {
  constructor(value) { this.value = value; }
  [inspect.custom](depth, options, inspect) {
    return options.stylize(`Secret(<${this.value.length} chars hidden>)`, 'special');
  }
}
const cfg = { db: 'postgres://app@db/app', token: new Secret('s3cr3t-t0ken') };
console.log('custom inspect   :', inspect(cfg));
console.log('JSON.stringify does not:', JSON.stringify(cfg));
console.log('customInspect: false:', inspect(cfg, { customInspect: false }));
console.log('global symbol    :', inspect.custom === Symbol.for('nodejs.util.inspect.custom'));

const a = { name: 'a' }; a.self = a;           // circular reference
console.log('circular         :', inspect(a));

// Real output (Node v24.19.0):
//   default          : User { name: 'Ada', _email: 'ada@example.com', masked: [Getter] }
//   showHidden: true : User {
//     name: 'Ada',
//     [internalId]: 7,
//     _email: 'ada@example.com',
//     masked: [Getter],
//     [email]: [Getter],
//     [domain]: [Getter]
//   }
//   getters: true    : User {
//     name: 'Ada',
//     _email: 'ada@example.com',
//     masked: [Getter: 'a***@example.com']
//   }
//   custom inspect   : { db: 'postgres://app@db/app', token: Secret(<12 chars hidden>) }
//   JSON.stringify does not: {"db":"postgres://app@db/app","token":{"value":"s3cr3t-t0ken"}}
//   customInspect: false: {
//     db: 'postgres://app@db/app',
//     token: Secret { value: 's3cr3t-t0ken' }
//   }
//   global symbol    : true
//   circular         : <ref *1> { name: 'a', self: [Circular *1] }
```

`showHidden` surfaces non-enumerable properties (`[internalId]`) and prototype getters in `[brackets]`; it does *not* show the `#password` private field, which is invisible to inspection. `getters: true` actually calls the getters and prints their values (so beware side effects). Defining `[util.inspect.custom]` lets an object print itself — here a `Secret` hides its contents in `console.log` output, though note `JSON.stringify` ignores the custom method and leaks the raw value, so a custom inspect is not a security control. `customInspect: false` turns the custom method off. The symbol is globally registered, so the same technique works without importing `util`. Circular references get a `[Circular *1]` marker instead of looping forever.

**Example 3 — `format`: every specifier.**

javascript

```
const { format } = require('node:util');

const obj = { id: 1, tags: ['a'], nested: { deep: { deeper: 1 } } };
const show = (f, ...args) => console.log(`${f.padEnd(11)} -> |${format(f, ...args)}|`);

show('%s', 'text');
show('%s', 42n);                    // BigInt keeps its n
show('%s', obj);                    // object: inspect with depth 0
show('%d', '42.9px');               // Number('42.9px') -> NaN
show('%i', '42.9px');               // parseInt -> 42
show('%f', '42.9px');               // parseFloat -> 42.9
show('%d', 10n);
show('%j', obj);                    // JSON.stringify
const circ = { a: 1 }; circ.me = circ;
show('%j', circ);                   // circular -> '[Circular]'
show('%o', [1]);                    // like inspect with showHidden + showProxy
show('%O', obj);                    // like inspect with defaults
show('%c done', 'color: red');      // the CSS argument is consumed and dropped
show('100%% %s', 'sure');           // %% -> %, consumes no argument
show('100%% sure');                 // ONE argument only: returned untouched
show('%s:%s', 'only-one');          // missing argument: specifier left as is
show('%s', 'a', 'extra', 3);        // extra arguments appended with spaces
console.log(`${"(no format)".padEnd(11)} -> |${format(1, 2, { x: 1 })}|`);  // joined with spaces

// Real output (Node v24.19.0):
//   %s          -> |text|
//   %s          -> |42n|
//   %s          -> |{ id: 1, tags: [Array], nested: [Object] }|
//   %d          -> |NaN|
//   %i          -> |42|
//   %f          -> |42.9|
//   %d          -> |10n|
//   %j          -> |{"id":1,"tags":["a"],"nested":{"deep":{"deeper":1}}}|
//   %j          -> |[Circular]|
//   %o          -> |[ 1, [length]: 1 ]|
//   %O          -> |{ id: 1, tags: [ 'a' ], nested: { deep: { deeper: 1 } } }|
//   %c done     -> | done|
//   100%% %s    -> |100% sure|
//   100%% sure  -> |100%% sure|
//   %s:%s       -> |only-one:%s|
//   %s          -> |a extra 3|
//   (no format) -> |1 2 { x: 1 }|
```

`%s` stringifies (objects via `inspect` at depth 0, so nested parts become `[Object]`). `%d` coerces with `Number` (hence `NaN`), `%i` with `parseInt`, `%f` with `parseFloat`. `%j` is JSON with `[Circular]` for cycles. `%o` is `inspect` with hidden properties shown (note `[length]: 1`); `%O` is plain `inspect`. `%c` consumes and discards a CSS argument (browser-only). `%%` is a literal `%` and consumes nothing — but watch the `100%% sure` line: when there is **only one argument and no other specifier to satisfy**, `format` returns the string untouched, so `%%` is *not* reduced. A missing argument leaves the specifier, and extras are appended with spaces.

**Example 4 — edge case: `util.types` vs `instanceof` across a `vm` realm.**

javascript

```
const vm = require('node:vm');
const { types } = require('node:util');

// Values created inside another V8 context (another "realm")
const other = vm.runInNewContext(`({
  date: new Date(0),
  promise: Promise.resolve(1),
  array: [1, 2],
  error: new TypeError('boom'),
  map: new Map(),
})`);

for (const [name, value] of Object.entries(other)) {
  const Ctor = { date: Date, promise: Promise, array: Array, error: Error, map: Map }[name];
  console.log(`${name.padEnd(8)} instanceof ${Ctor.name.padEnd(7)}: ${value instanceof Ctor}`);
}
console.log('types.isDate      :', types.isDate(other.date));
console.log('types.isPromise   :', types.isPromise(other.promise));
console.log('types.isMap       :', types.isMap(other.map));
console.log('Array.isArray     :', Array.isArray(other.array));
console.log('Error.isError     :', Error.isError(other.error));

// A thenable is not a promise; a Proxy is invisible to instanceof
const thenable = { then(r) { r(1); } };
const proxied = new Proxy(new Date(0), {});
console.log('isPromise(thenable):', types.isPromise(thenable));
console.log('proxy instanceof Date:', proxied instanceof Date, '| isProxy:', types.isProxy(proxied), '| isDate:', types.isDate(proxied));

// instanceof follows the prototype chain, which you can fake; types.* checks the internal slot
const fake = Object.create(Date.prototype);
console.log('fake instanceof Date:', fake instanceof Date, '| types.isDate(fake):', types.isDate(fake));

// Real output (Node v24.19.0):
//   date     instanceof Date   : false
//   promise  instanceof Promise: false
//   array    instanceof Array  : false
//   error    instanceof Error  : false
//   map      instanceof Map    : false
//   types.isDate      : true
//   types.isPromise   : true
//   types.isMap       : true
//   Array.isArray     : true
//   Error.isError     : true
//   isPromise(thenable): false
//   proxy instanceof Date: true | isProxy: true | isDate: false
//   fake instanceof Date: true | types.isDate(fake): false
```

Every `instanceof` check fails on the cross-realm values even though they are genuine built-ins, because each realm has its own prototypes. The `types.*` predicates read the internal slot and return the truth. `types.isProxy` sees through a `Proxy` that `instanceof` cannot detect (the proxy reports `true` for `instanceof Date`, but `types.isDate` on it is `false` because a proxy has no `[[DateValue]]` slot). A `thenable` object is not a real promise. And a faked prototype fools `instanceof` but not `types`. (Note `util.types.isNativeError` is deprecated as of v24.2.0 in favor of the new global `Error.isError`, shown here, which is also cross-realm correct.)

**Example 5 — `deprecate`: one warning per code, and the `--no-deprecation` / `--throw-deprecation` flags.**

javascript

```
const { deprecate } = require('node:util');

// Codes for your own package: pick a prefix that is not Node's DEP0xxx range
const oldConnect = deprecate(
  (url) => `connected to ${url}`,
  'oldConnect() is deprecated. Use connect() instead.',
  'MYLIB001',
);
const oldConnectAlias = deprecate(() => 'alias', 'alias message', 'MYLIB001'); // same code

process.on('warning', (w) => console.log(`[warning event] ${w.name} ${w.code}: ${w.message}`));

console.log(oldConnect('db://a'));
console.log(oldConnect('db://b'));      // second call: no new warning
console.log(oldConnectAlias());         // same code: no warning either
console.log('end of sync code');
```

Run three ways:

bash

```
$ node dep.js
connected to db://a
connected to db://b
alias
end of sync code
(node:602455) [MYLIB001] DeprecationWarning: oldConnect() is deprecated. Use connect() instead.
(Use `node --trace-deprecation ...` to show where the warning was created)
[warning event] DeprecationWarning MYLIB001: oldConnect() is deprecated. Use connect() instead.

$ node --no-deprecation dep.js
connected to db://a
connected to db://b
alias
end of sync code

$ node --throw-deprecation dep.js
connected to db://a
connected to db://b
alias
end of sync code
node:internal/process/warning:176
        throw warning;
        ^
DeprecationWarning: oldConnect() is deprecated. Use connect() instead.
    at Object.<anonymous> (…/dep.js:13:13)
  ...
  code: 'MYLIB001'
}
Node.js v24.19.0
```

The warning prints **once** per `code`, no matter how many wrapped functions or calls share it (so `oldConnectAlias` is silent). It arrives through the `'warning'` event, and it fires asynchronously — notice it prints *after* `end of sync code`. `--no-deprecation` suppresses it entirely; `--throw-deprecation` turns it into a thrown error (exit 1). Because the throw also happens asynchronously via the warning mechanism, it surfaces as an `uncaughtException`, not something a surrounding `try/catch` around the call can catch.

**Example 6 — `inherits` (legacy) vs a class, and the prototype it produces.**

javascript

```
const util = require('node:util');
const EventEmitter = require('node:events');

// Legacy style (what old npm packages do)
function OldStream() { EventEmitter.call(this); }
util.inherits(OldStream, EventEmitter);
OldStream.prototype.write = function (data) { this.emit('data', data); };

// Modern style
class NewStream extends EventEmitter {
  write(data) { this.emit('data', data); }
}

const o = new OldStream();
o.on('data', (d) => console.log('OldStream got', d));
o.write('x');
console.log('prototype link   :', Object.getPrototypeOf(OldStream.prototype) === EventEmitter.prototype);
console.log('instanceof       :', o instanceof EventEmitter);
console.log('super_ property  :', OldStream.super_ === EventEmitter);
console.log('static methods?  :', typeof OldStream.once, '(legacy) vs', typeof NewStream.once, '(class)');
console.log('constructor proto:', Object.getPrototypeOf(OldStream) === EventEmitter, 'vs', Object.getPrototypeOf(NewStream) === EventEmitter);

// Real output (Node v24.19.0):
//   OldStream got x
//   prototype link   : true
//   instanceof       : true
//   super_ property  : true
//   static methods?  : undefined (legacy) vs function (class)
//   constructor proto: false vs true
```

`util.inherits` sets `OldStream.prototype`'s prototype to `EventEmitter.prototype` (roughly `Object.setPrototypeOf(OldStream.prototype, EventEmitter.prototype)` with validation) and adds a `super_` back-reference. Instance methods work and `instanceof` passes. But — and this is why the docs mark it **Legacy** and say its use is discouraged — it does *not* link the constructors themselves, so **static** members are not inherited (`OldStream.once` is `undefined`, while `class extends` gives `NewStream.once`). Use `class … extends …`; reach for `inherits` only to understand old code.

**Example 7 — `styleText`: colors that respect the terminal and `NO_COLOR`.**

javascript

```
import { styleText } from 'node:util';
import { stdout } from 'node:process';

// Default: styleText checks whether stdout can show color (isTTY + NO_COLOR/FORCE_COLOR)
const auto = styleText('green', 'ok');
// validateStream: false skips that check and always emits the codes
const forced = styleText('green', 'ok', { validateStream: false });

console.log('isTTY: ' + Boolean(stdout.isTTY));
console.log('auto  :', JSON.stringify(auto));
console.log('forced:', JSON.stringify(forced));
```

Run into a pipe, into a real TTY, into a TTY with `NO_COLOR`, and into a pipe with `FORCE_COLOR`:

bash

```
$ node style.mjs | cat
isTTY: false
auto  : "ok"
forced: "\u001b[32mok\u001b[39m"

$ TERM=xterm-256color script -qec "node style.mjs" /dev/null
isTTY: true
auto  : "\u001b[32mok\u001b[39m"
forced: "\u001b[32mok\u001b[39m"

$ TERM=xterm-256color NO_COLOR=1 script -qec "node style.mjs" /dev/null
isTTY: true
auto  : "ok"
forced: "\u001b[32mok\u001b[39m"

$ FORCE_COLOR=1 node style.mjs | cat
isTTY: false
auto  : "\u001b[32mok\u001b[39m"
```

`styleText` (added in v21.7.0, v20.12.0; **stable** since v23.5.0, v22.13.0) colors by default only when it believes the output can show color: a pipe gets plain `"ok"`, a TTY gets the escape codes. This check — `validateStream`, default `true`, against `process.stdout` — honors `NO_COLOR` (strips color even at a TTY) and `FORCE_COLOR` (adds it even into a pipe), the convention documented since v22.8.0. Setting `validateStream: false` always emits the codes. It also supports format arrays (`['bold', 'red']`), hex colors (`'#ff5733'`, added in v24.16.0), and a no-op `'none'` (added in v24.2.0); an unknown format throws `ERR_INVALID_ARG_VALUE`.

**Example 8 — `promisify` recap and `util.promisify.custom`.**

javascript

```
const { promisify } = require('node:util');

// 1. A normal error-first callback API
function readConfig(name, cb) {
  setTimeout(() => (name ? cb(null, { name }) : cb(new Error('name required'))), 10);
}
const readConfigAsync = promisify(readConfig);

// 2. A non-standard API: success and error callbacks are separate
function legacyFetch(url, onOk, onErr) {
  setTimeout(() => (url.startsWith('http') ? onOk(`body of ${url}`) : onErr(new Error('bad url'))), 10);
}
legacyFetch[promisify.custom] = (url) => new Promise((resolve, reject) => legacyFetch(url, resolve, reject));
const legacyFetchAsync = promisify(legacyFetch);

(async () => {
  console.log(await readConfigAsync('app'));
  console.log(await readConfigAsync('').catch((e) => `rejected: ${e.message}`));
  console.log('custom used:', legacyFetchAsync === legacyFetch[promisify.custom]);
  console.log(await legacyFetchAsync('http://x'));
  console.log('same symbol:', promisify.custom === Symbol.for('nodejs.util.promisify.custom'));
})();

// Real output (Node v24.19.0):
//   { name: 'app' }
//   rejected: name required
//   custom used: true
//   body of http://x
//   same symbol: true
```

`promisify` assumes the last argument is an error-first callback `(err, value) => …` and returns a promise version. For a function that does not follow that shape (here one with separate success and error callbacks), define a `[promisify.custom]` property and `promisify` returns it verbatim. The symbol is globally registered. Note that `promisify`-ing a function that already returns a promise is deprecated (`DEP0174` since v20.8.0) — if it is already async, just call it.

**Example 9 — `util.parseArgs` cross-link.**

`util.parseArgs` is Node's built-in command-line flag parser. It is covered in two other lessons, so this is only a pointer plus a minimal run:

javascript

```
const { parseArgs } = require('node:util');

const { values, positionals } = parseArgs({
  args: ['--port=8080', '-v', 'build', '--', '--not-a-flag'],   // normally process.argv.slice(2)
  options: {
    port: { type: 'string', default: '3000' },
    verbose: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
});
console.log(values, positionals);

// Real output (Node v24.19.0):
//   [Object: null prototype] { port: '8080', verbose: true } [ 'build', '--not-a-flag' ]
```

For the full treatment — detailed tokens, `allowNegative`, strict-mode error codes and where it fits among `argv` parsing — see [`96-modern-node-features-tour.md`](96-modern-node-features-tour.md) and [`04-the-global-object-process-and-environment.md`](04-the-global-object-process-and-environment.md).

## Common mistakes & gotchas

- Relying on console.log output in tests or logs. It is util.inspect with depth 2, so anything deeper is [Object]. For logs, use JSON.stringify or inspect with depth Infinity. Do not parse inspect output.
- A custom util.inspect.custom, or a custom toJSON, is not hiding. JSON.stringify still serialises the raw fields. It is a display helper, not a redaction tool.
- instanceof fails for values from a vm context, another iframe, or a worker. Use util.types, Array.isArray, or Error.isError.
- format with percent s on an object inspects at depth 0, so nested fields collapse to [Object]. Use percent O, or inspect with a depth.
- A throw from --throw-deprecation does not land in the try/catch around the call. It goes through the asynchronous warning mechanism and becomes an uncaughtException.
- util.inherits does not inherit static members and is legacy. Use class extends.
- percent d and percent i on a BigInt print it with an n, and some Symbol conversions throw. format is a debugging aid, not a numeric formatter.

## Best practices

- Reach for util before a dependency. inspect replaces a custom pretty-printer, styleText replaces chalk for simple color, types replaces is-promise and is-date, and format is the engine behind console.log percent strings.
- Pass depth explicitly. Infinity, or a generous number, when you are debugging a deep structure. depth 0 for a one-line summary.
- Define util.inspect.custom on domain objects that log noisily or hold secrets, using Symbol.for('nodejs.util.inspect.custom') if you want it without importing util. Never rely on it for security.
- Use util.types in library code that may receive values from workers, vm, or other realms.
- Give every util.deprecate call a stable code so the warning fires once and users can silence that code.
- Let styleText validate the stream, which is the default, so a pipe stays plain and NO_COLOR is honoured. Force codes only when you know the destination.

## ⭐ Interview lens

> **Q: “Why does `value instanceof Date` return false for a real Date, and how do you check reliably?”**  
> instanceof walks the prototype chain, and that chain belongs to one realm. A realm is a separate JavaScript environment, such as a vm context, a worker, or an iframe, with its own Date.prototype. A real Date created in that other realm fails instanceof Date in yours, because it does not point at your prototype. util.types.isDate reads the internal V8 slot that only a real Date has, so it returns true across realms and it cannot be faked. For example, Object.create(Date.prototype) passes instanceof and fails types.isDate. The limit is proxies. A Proxy around a Date can still pass instanceof Date, while types.isDate on the proxy is false, because a proxy has no DateValue slot of its own.

> **Q: “What is the difference between `%o` and `%O` in `util.format`?”**  
> percent O is util.inspect with the default options. percent o is inspect with showHidden and showProxy turned on, so you see non-enumerable properties, such as an array's length, and proxy internals. percent s on an object is neither of those. It inspects at depth 0, so nested fields collapse to [Object]. For example, format('%o', arr) can show [length]: 1, and format('%O', arr) looks like a normal inspect. The limit is that both are still inspect strings for humans. They are not JSON, and a circular structure is marked rather than thrown the way JSON.stringify would throw.

> **Q: “How does `util.deprecate` avoid spamming the same warning?”**  
> It emits one DeprecationWarning per code, through the process warning event, on the first call. Later calls with that same code are silent, which is how it avoids a warning per request. --no-deprecation suppresses the warning. --trace-deprecation adds a stack. --throw-deprecation turns it into an error. That throw is delivered through the warning mechanism, so a try/catch around the deprecated call does not see it. It becomes an uncaughtException. For example, deprecate(fn, 'use next()', 'DEP_EXAMPLE') prints once even if you call it in a loop. The limit is a missing or unstable code. Without a stable code you cannot tell two warnings apart, and callers cannot silence just that one.

> **Q: “Is a custom `[util.inspect.custom]` method a safe way to hide a secret?”**  
> No. The method only changes what console.log and util.inspect print. JSON.stringify ignores it and serialises the real fields, and any code that reads the property still sees the secret. Treat it as a display convenience for noisy objects. For example, a Secret class can print [Secret] in the console and still show the token under JSON.stringify. The limit of "I will also add toJSON" is the same class of mistake. toJSON changes serialisation, and direct property access still works. Keep the secret out of the object, or out of the field, if it must not be readable.

## Cheat-card

- inspect(value, { depth, colors, sorted }). Default depth is 2, and deeper values print as [Object]. compact true plus breakLength forces one line. maxArrayLength defaults to 100. showHidden shows non-enumerables. getters true runs getters.
- Custom print: assign util.inspect.custom, or Symbol.for('nodejs.util.inspect.custom'). It is not a redaction tool.
- format: percent s string, d Number, i parseInt, f parseFloat, j JSON with [Circular] for cycles, o inspect plus hidden, O inspect, c drops a CSS argument, doubled percent is a literal percent. Extra arguments are appended. Missing ones stay in the string.
- types.isPromise, isDate, isMap, isProxy, and the rest read internal slots, so they work across realms. instanceof does not.
- deprecate(fn, msg, code) warns once per code, asynchronously, through the warning event. Flags: --no-deprecation, --trace-deprecation, --throw-deprecation.
- inherits is legacy. It links prototypes and sets super_, not statics. Use class extends.
- promisify wraps an error-first callback. Override it with util.promisify.custom. Promisifying a function that already returns a promise is deprecated, DEP0174.

## Good to know

- “Your CLI prints color codes into a redirected log file. What is the fix?” Use util.styleText. By default it checks whether the target stream is a TTY and honours NO_COLOR and FORCE_COLOR, so a pipe or a file gets plain text. Do not concatenate ANSI codes by hand, and do not pass validateStream false unless you mean to force the codes.

- util.types.isNativeError is deprecated as of v24.2.0. Use the global Error.isError, which is also correct across realms.
- styleText was added in v21.7.0 and v20.12.0, and it has been stable since v23.5.0 and v22.13.0. Hex colors such as #ff5733 were added in v24.16.0. The no-op format none was added in v24.2.0. NO_COLOR and FORCE_COLOR have been honoured since v22.8.0.
- Promisifying a function that already returns a promise is deprecated as DEP0174 since v20.8.0.
- The doubled percent in a format string is not reduced when that string is the only argument and no other specifier needs satisfying. format returns the string untouched in that case.

---

## Learn More

- [Util nodejs.org v24 docs](https://nodejs.org/docs/latest-v24.x/api/util.html)
- [console.log (uses util.inspect / util.format) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/console/log_static)
