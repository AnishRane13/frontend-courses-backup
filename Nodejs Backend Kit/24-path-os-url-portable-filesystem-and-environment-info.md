---
title: "path, os & URL: Portable Filesystem and Environment Info"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/path-os-url
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# path, os & URL: Portable Filesystem and Environment Info

*10 min read · Updated 24 Jul 2026 Topic 22 of 70 Bookmark Mark done Why it matters Code that hand · Topic 22 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/path-os-url](https://www.geekyfrontend.in/learn/nodejs-backend-kit/path-os-url)

---

## Say it in 30 seconds

path, os, and URL are the built-ins for file-path strings, facts about the machine, and web addresses: path joins and splits paths without touching the disk, os reports CPUs, memory, and the temp directory, and URL parses an address into parts the same way a browser does. They exist so you do not glue paths with slashes or split query strings by hand, both of which break across operating systems and on hostile input. The trade-off is that path only edits strings, so a joined path can still point outside a folder unless you check the result.

## Why it matters

Hand-built paths, strings glued with a slash, break on Windows, on a trailing slash, or on a .. in user input. path joins, resolves, and takes paths apart correctly on every operating system. os tells you about the machine you are on: CPU count, free memory, platform, temp directory. You need those to size worker pools, pick scratch space, and log diagnostics. The WHATWG URL class parses and builds URLs safely. WHATWG is the group whose URL standard browsers implement. It replaces string splitting that leads to security holes.

These three show up in almost every backend. One path.join is the difference between code that behaves the same on macOS, Linux, and Windows.

## The concept, simply

path manipulates path strings. It never touches the disk. join concatenates segments with the correct separator and collapses extra slashes. resolve produces an absolute path by walking the arguments from right to left until it has one. basename, dirname, extname, and parse pull a path apart.

os reports facts about the host: os.cpus, os.freemem, os.platform, os.tmpdir, os.hostname.

URL is a global. No import is needed. It parses a URL string into protocol, hostname, pathname, and searchParams, and it lets you change a URL without escaping by hand.

![A file path broken into dirname, basename, name, and ext parts](assets/i19_01_425594bf.svg)

path.parse splits a path into dir, base, name, and ext in one call.

## How it works (deep)

path is platform-aware. On POSIX systems the separator is a forward slash. POSIX means Linux, macOS, and the other Unix-like systems. On Windows the separator is a backslash, and both are accepted on input. path.join('a', 'b') yields a/b on Linux and a\b on Windows. If you must force one behaviour, path.posix and path.win32 are the platform-specific variants. Use path.posix when you are building a URL-style path that must always use forward slashes.

join versus resolve is the trip-up. join concatenates and normalises. path.join('/a', 'b', '..', 'c') gives /a/c. resolve builds an absolute path by processing arguments from right to left, and it prepends process.cwd only if it has not yet reached an absolute segment. process.cwd is the process's current working directory. path.resolve('b', 'c') gives the current directory plus /b/c. path.resolve('/a', 'b') gives /a/b, because /a is already absolute and stops the walk. Use join to stitch known relative pieces. Use resolve when you need a guaranteed absolute path.

os reads the operating system at call time. os.cpus returns one entry per logical core, which is the usual way to size a cluster or a worker pool. os.tmpdir returns the scratch directory for the platform, honouring TMPDIR or TEMP, so temp files land somewhere writable. os.platform returns linux, darwin, or win32. Prefer a cross-platform API before you branch on that string.

URL implements the WHATWG URL Standard, the same parser browsers use. new URL(str) throws on an invalid absolute URL, which is useful: it fails loudly instead of mis-parsing. searchParams is a live URLSearchParams object that percent-encodes for you. get returns the decoded value. set and append re-encode. The legacy querystring module and the old url.parse still exist, but they are superseded. URL and URLSearchParams are the choice for new code.

Smaller path helpers. path.normalize collapses dot, dot-dot, and duplicate separators without making the path absolute. path.isAbsolute answers the platform question. On Windows, C:\x and \\server\share are absolute, and a bare /x is not. path.relative(from, to) computes the dot-dot hop from one location to another. Two constants matter. path.sep is the segment separator, slash or backslash. path.delimiter is the list separator inside variables such as PATH: a colon on POSIX, a semicolon on Windows. Splitting process.env.PATH on a hard-coded colon is a classic Windows bug.

The two joiners diverge on the same inputs. This table assumes the current directory is /home/app on a POSIX host:

| Call | Result | Why |
| --- | --- | --- |
| `path.join('a', 'b', 'c')` | `a/b/c` | Concatenates; stays relative. |
| `path.join('/a', '/b')` | `/a/b` | A leading slash on a later arg is just a separator, not a reset. |
| `path.resolve('a', 'b')` | `/home/app/a/b` | Prepends `cwd` to reach an absolute path. |
| `path.resolve('/a', 'b')` | `/a/b` | The absolute `/a` short-circuits the right-to-left walk. |
| `path.resolve('/a', '/b')` | `/b` | The *last* absolute arg wins; earlier ones are discarded. |
| `path.normalize('a//b/../c')` | `a/c` | Cleans separators and `..` without going absolute. |

## Code examples

Building paths portably and anchoring to the current module's directory:

javascript

```
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// import.meta.dirname (Node 20.11+) is the folder THIS file lives in.
const dataFile = path.join(import.meta.dirname, 'data', 'users.json');

const users = JSON.parse(await readFile(dataFile, 'utf8'));

// join vs resolve
path.join('/var', 'log', '..', 'www');   // '/var/www'
path.resolve('src', 'index.js');          // '/abs/cwd/src/index.js'
path.resolve('/etc', 'src');              // '/etc/src' (abs arg short-circuits)
```

Decomposing a path and safely swapping an extension:

javascript

```
import path from 'node:path';

const p = '/home/app/reports/q3.csv';
path.basename(p);          // 'q3.csv'
path.basename(p, '.csv');  // 'q3'  (strips the given suffix)
path.dirname(p);           // '/home/app/reports'
path.extname(p);           // '.csv'
path.parse(p);
// { root:'/', dir:'/home/app/reports', base:'q3.csv', name:'q3', ext:'.csv' }

// Change the extension the correct way:
const asJson = path.format({ ...path.parse(p), base: undefined, ext: '.json' });
// '/home/app/reports/q3.json'
```

Reading machine info to size a worker pool and pick scratch space:

javascript

```
import os from 'node:os';
import path from 'node:path';

const workers = os.cpus().length;                 // one per logical core
const scratch = path.join(os.tmpdir(), 'myapp');  // correct temp dir per OS

console.log({
  platform: os.platform(),      // 'linux' | 'darwin' | 'win32'
  cores: workers,
  freeMemMB: Math.round(os.freemem() / 1024 / 1024),
  home: os.homedir(),
});
```

Parsing and building URLs with the WHATWG API instead of string surgery:

javascript

```
const u = new URL('https://api.example.com/v2/search?q=node+fs&page=2');

u.protocol;                    // 'https:'
u.hostname;                    // 'api.example.com'
u.pathname;                    // '/v2/search'
u.searchParams.get('q');       // 'node fs'  (decoded automatically)
u.searchParams.get('page');    // '2'

// Mutate safely — encoding is handled for you:
u.searchParams.set('page', '3');
u.searchParams.append('sort', 'date');
u.toString(); // '...?q=node+fs&page=3&sort=date'

// Resolve a relative URL against a base (great for API clients):
new URL('../users', 'https://api.example.com/v2/search').href;
// 'https://api.example.com/users'
```

## Common mistakes & gotchas

- Concatenating paths with a slash or a template string breaks on Windows and mishandles a trailing slash and dot-dot. Use path.join or path.resolve.
- join concatenates. resolve guarantees an absolute path and stops at the first absolute argument, reading right to left. The wrong one gives a subtly wrong path.
- path.join(uploadDir, req.body.name) where name is ../../etc/passwd escapes the directory. Resolve the full path and verify it still starts inside the base directory before you touch it.
- ES modules have no __dirname and no __filename. Use import.meta.dirname and import.meta.filename, or derive them from import.meta.url.
- url.parse is lenient in unsafe ways and predates the WHATWG standard. Prefer new URL, which rejects malformed input.
- Hand-rolled encodeURIComponent chains drift from the spec. URLSearchParams encodes and decodes, including repeated keys and spaces.
- os.freemem is not "available" memory. On Linux, free memory excludes cache the kernel can reclaim, so it can look low while the system is healthy. It is a rough signal, not a capacity plan.
- Splitting PATH on a hard-coded colon mangles Windows drive letters such as C:. Split on path.delimiter, and join segments with path.sep.
- The active path API follows the host. To parse a Windows path on a Linux CI runner, call path.win32 or path.posix explicitly.
- new URL('/v2/users') throws because it is not absolute. Pass a base as the second argument.

## Best practices

- Never build a path by hand. Use path.join or path.resolve.
- Anchor file access to import.meta.dirname, or to __dirname in CommonJS, not to process.cwd.
- Validate a resolved user path against the base directory before you read or write.
- Size pools from os.cpus().length instead of a hard-coded worker count.
- Write temp files under os.tmpdir, not inside the project.
- Use new URL and URLSearchParams for URL work.
- Use path.posix when you need forward slashes regardless of the host, such as URL paths built on Windows.

## ⭐ Interview lens

> **Q: Why use `path.join` instead of just writing `dir + '/' + file`?** Portability and correctness. `join` uses the OS-correct separator (`\` on Windows), collapses duplicate slashes, and resolves `.`/`..` segments. String concatenation breaks across platforms and mishandles trailing slashes.
> Portability and correctness. path.join uses the separator the operating system expects, a backslash on Windows and a forward slash elsewhere, collapses duplicate separators, and normalises dot and dot-dot segments. dir + '/' + file breaks on Windows, and it mishandles a trailing slash on dir. For example, path.join('/uploads', 'a.png') is a safe stitch of two pieces you already trust. The limit is that join does not check the disk and does not jail the result. If the second piece is user input containing .., join will happily walk upward. You still have to resolve and compare against a base directory.

> **Q: What is the difference between `path.join` and `path.resolve`?** `join` concatenates and normalises segments, staying relative if the inputs are relative. `resolve` always produces an absolute path, processing arguments right-to-left and prepending `process.cwd()` only until it hits an absolute segment, which short-circuits the rest.
> join concatenates and normalises, and it stays relative if the inputs are relative. path.join('a', 'b') is a/b, not an absolute path. resolve always produces an absolute path. It processes arguments from right to left and prepends the current working directory only until it hits an absolute segment, which stops the walk. path.resolve('/a', 'b') is /a/b. path.resolve('/a', '/b') is /b, because the last absolute argument wins. Use join for known relative pieces. Use resolve when a later API requires an absolute path. The limit of resolve is that it depends on process.cwd when nothing in the arguments is absolute, so launching the process from another directory changes the result.

> **Q: How do you prevent a path-traversal attack when joining user input?** Resolve the final absolute path, then confirm it is still inside the intended base directory (e.g. `resolved.startsWith(baseDir + path.sep)`). If it escaped via `..`, reject it. Never trust the raw filename.
> Resolve the final path to an absolute path, then confirm it is still inside the intended base. A common check is that the resolved path starts with the base directory plus path.sep, so a sibling folder with a similar prefix does not pass. If the user sent .. and the path escaped, reject it. Never open the raw filename. For example, join of an uploads directory with ../../etc/passwd must fail the prefix check before any read. The limit is a sloppy prefix. startsWith(baseDir) without the separator can accept /uploads-evil when the base is /uploads. Include the separator, and resolve both sides so symlinks and dot segments are normalised the same way.

> **Q: How do you get the current file's directory in an ES module?** Use `import.meta.dirname` (Node 20.11+). There is no `__dirname` in ESM; older code derived it from `fileURLToPath(import.meta.url)`.
> Use import.meta.dirname. There is no __dirname in an ES module, and there is no __filename either. import.meta.filename is the file, and import.meta.dirname is its folder. Anchor reads and writes to that folder so the path does not depend on the directory the process was started from. Older code built the same value from fileURLToPath of import.meta.url. The limit is CommonJS. In a require-based file you still use __dirname, and import.meta is not available there. Also, import.meta.dirname itself is a newer Node addition, so a very old runtime needs the fileURLToPath form.

## Cheat-card

- path.join concatenates and normalises. path.resolve forces an absolute path, right to left.
- basename, dirname, extname, parse, and format take paths apart and rebuild them.
- path only edits strings. It never touches the disk.
- In ES modules, use import.meta.dirname and import.meta.filename. There is no __dirname.
- os.cpus().length sizes pools. os.tmpdir is scratch space. os.platform is the branch.
- new URL throws on a bad absolute URL. searchParams decodes and encodes for you.
- For user paths: resolve, then check the result still starts with the base directory plus the separator.
- Prefer URL and URLSearchParams over url.parse and querystring.
- path.sep joins segments. path.delimiter splits PATH. path.posix and path.win32 force a platform.

## Good to know

- Why prefer the `URL` class over `querystring` or `url.parse()`? URL and URLSearchParams implement the WHATWG standard browsers use, so parsing matches and encoding is handled. url.parse is legacy and lenient in unsafe ways. querystring is superseded by URLSearchParams.

- How would you decide how many worker processes to spawn? Base it on os.cpus().length, typically one worker per logical core for CPU-bound work, rather than a hard-coded number, so it scales with the host.

- import.meta.dirname and import.meta.filename need Node 20.11 or newer. Older code derives the directory from fileURLToPath(import.meta.url).
- Additional examples: 10 Oct 2026, examples verified on Node v24.19.0.
- os.availableParallelism() was added in v19.4.0 and v18.14.0.
- os.EOL was added in v0.7.8. It is a newline on POSIX and a carriage return plus a newline on Windows.
- `URL.canParse(input[, base])`: added in v19.9.0 and v18.17.0.
- `URL.parse(input[, base])`: added in v22.1.0.

---

## Learn More

- [Path | Node.js Documentation nodejs.org](https://nodejs.org/api/path.html)
- [OS | Node.js Documentation nodejs.org](https://nodejs.org/api/os.html)
- [URL | Node.js Documentation nodejs.org](https://nodejs.org/api/url.html)
- [Node.js File Paths nodejs.org](https://nodejs.org/en/learn/manipulating-files/nodejs-file-paths)
- [Node JS Path Module | path.resolve | path.join | path.normalize Tech Altum Tutorial](https://www.youtube.com/watch?v=BapA-vG9HZI)

---

## Additional topics

### `os.availableParallelism()` and `os.EOL`

`os.availableParallelism()` returns an estimate of how many CPUs **this process** can use. It wraps libuv's `uv_available_parallelism()`, which on Linux counts the CPUs in the process's affinity mask and lowers that to the cgroup CPU quota if there is one. `os.cpus().length` counts the logical CPUs of the **machine**. The two differ inside a CPU-limited container or under `taskset`, and a pool sized from `cpus()` there starts more CPU-bound workers than it has CPUs. So where this lesson says to size pools with `os.cpus().length`, prefer `os.availableParallelism()`. Lesson 07's appendix, [`os.availableParallelism()` vs `os.cpus().length`](07-libuv-the-thread-pool.md), shows the affinity and cgroup cases in detail.

`os.EOL` is the line ending of the host OS: `'\n'` on POSIX, `'\r\n'` on Windows. It is a constant string. Node does not translate line endings for you when it reads or writes files.

How it works:

1. `availableParallelism()` reads the affinity mask (`sched_getaffinity`) and the cgroup's `cpu.max`, and returns the smaller count, never less than 1.
2. `cpus()` reads one entry per logical CPU from `/proc` on Linux, and ignores affinity and quotas.
3. Neither changes the libuv thread pool, which stays at 4 threads unless `UV_THREADPOOL_SIZE` is set.
4. `os.EOL` is set once from the platform (`isWindows ? '\r\n' : '\n'` in `lib/os.js`) and is read-only. Use it when you **write** text meant for local tools on this OS. When you **read** text that may come from any OS, split on `/\r?\n/`.

**Example — CPU counts under `taskset`, and line endings.**

javascript

```
// osinfo.mjs — the CPU count to size pools with, and the line ending
import os from 'node:os';

console.log('availableParallelism():', os.availableParallelism(), '| cpus().length:', os.cpus().length);
console.log('EOL:', JSON.stringify(os.EOL), '| platform:', os.platform());

// joining lines for a file meant for this OS vs splitting text that came from anywhere
const report = ['id,total', '1,10', '2,20'].join(os.EOL) + os.EOL;
console.log('bytes written with EOL:', Buffer.byteLength(report));
const fromWindows = 'id,total\r\n1,10\r\n2,20\r\n';
console.log('split on os.EOL :', fromWindows.split(os.EOL));
console.log('split on /\\r?\\n/:', fromWindows.split(/\r?\n/));
```

bash

```
$ node osinfo.mjs
availableParallelism(): 8 | cpus().length: 8
EOL: "\n" | platform: linux
bytes written with EOL: 19
split on os.EOL : [ 'id,total\r', '1,10\r', '2,20\r', '' ]
split on /\r?\n/: [ 'id,total', '1,10', '2,20', '' ]
$ taskset -c 0-1 node osinfo.mjs
availableParallelism(): 2 | cpus().length: 8
EOL: "\n" | platform: linux
bytes written with EOL: 19
split on os.EOL : [ 'id,total\r', '1,10\r', '2,20\r', '' ]
split on /\r?\n/: [ 'id,total', '1,10', '2,20', '' ]
```

`taskset -c 0-1` limited the process to two CPUs: `availableParallelism()` followed, `cpus().length` did not. Splitting a Windows file on `os.EOL` (`'\n'` on Linux) left a `'\r'` at the end of every line.

### `URL.canParse()`

`URL.canParse(input[, base])` runs the same WHATWG URL parser as `new URL()` and returns `true` or `false` instead of throwing. It replaces the `try { new URL(s) } catch {}` pattern when you only need a yes/no answer. Its companion `URL.parse(input[, base])` returns the `URL` object, or `null` when parsing fails.

How it works:

1. If `base` is given, it is parsed first. A relative `input` is resolved against it, and an absolute `input` ignores it.
2. The parser applies the WHATWG rules. A scheme followed by `:` makes the input absolute, so `mailto:` and `javascript:` URLs pass. Spaces in a host, an invalid port, or a relative input with no base fail.
3. `canParse` returns whether step 2 succeeded. It does not check the scheme, the host or anything else about what you meant.

**Example — absolute, relative and invalid inputs.**

javascript

```
// canparse.mjs — validate a URL without try/catch, then parse it
const inputs = ['https://api.example.com/v1?x=1', 'api.example.com', '/v1/users', 'http://[::1]:8080/', 'https://exa mple.com', 'mailto:ada@example.com'];

for (const s of inputs) {
  console.log(s.padEnd(32), URL.canParse(s), '| with base:', URL.canParse(s, 'https://api.example.com'));
}

// URL.parse (added in v22.1.0) returns null instead of throwing
console.log(URL.parse('/v1/users', 'https://api.example.com')?.href, URL.parse('nope'));

// Real output (Node v24.19.0):
//   https://api.example.com/v1?x=1   true | with base: true
//   api.example.com                  false | with base: true
//   /v1/users                        false | with base: true
//   http://[::1]:8080/               true | with base: true
//   https://exa mple.com             false | with base: false
//   mailto:ada@example.com           true | with base: true
//   https://api.example.com/v1/users null
```

### `URLPattern`

`URLPattern` matches a URL against a pattern with named groups, per component (protocol, hostname, port, pathname, search, hash). It was added in v23.8.0, became a global in v24.0.0, and is **Stability 1, Experimental**. [Lesson 96](96-modern-node-features-tour.md) (Examples 12 and 13) covers the syntax, the string-plus-base form and how a base pins the host. The example here uses it as a small router table.

How it works:

1. You give a pattern per component. `:name` is a named group, `:name(regex)` constrains it, and `*` is an unnamed wildcard reported as group `"0"`.
2. Components you leave out of the object form match anything, and also show up as group `"0"`.
3. `exec(url)` returns `null` or a result with `.groups` per component. `test(url)` returns a boolean.
4. The options object `{ ignoreCase: true }` makes matching case-insensitive.

**Example — routes by extension, by subdomain and by query.**

javascript

```
// pattern.mjs — a tiny router table built on URLPattern (global since v24.0.0, experimental)
const routes = [
  ['image',  new URLPattern({ pathname: '/static/*.:ext(png|jpe?g|webp)' }, { ignoreCase: true })],
  ['tenant', new URLPattern({ hostname: ':tenant.example.com', pathname: '/dashboard' })],
  ['order',  new URLPattern({ pathname: '/orders/:id(\\d+)', search: 'expand=:what' })],
];

function match(url) {
  for (const [name, p] of routes) {
    const m = p.exec(url);
    if (m) return { name, path: m.pathname.groups, host: m.hostname.groups, search: m.search.groups };
  }
  return null;
}

for (const url of [
  'https://cdn.test/static/img/Logo.PNG',
  'https://acme.example.com/dashboard',
  'https://example.com/dashboard',
  'https://shop.test/orders/42?expand=items',
  'https://shop.test/orders/42',
  'https://shop.test/orders/42?expand=items&page=2',
  'https://shop.test/orders/42?page=2&expand=items',
]) console.log(url.padEnd(48), JSON.stringify(match(url)));

// Real output (Node v24.19.0):
//   https://cdn.test/static/img/Logo.PNG             {"name":"image","path":{"0":"img/Logo","ext":"PNG"},"host":{"0":"cdn.test"},"search":{"0":""}}
//   https://acme.example.com/dashboard               {"name":"tenant","path":{},"host":{"tenant":"acme"},"search":{"0":""}}
//   https://example.com/dashboard                    null
//   https://shop.test/orders/42?expand=items         {"name":"order","path":{"id":"42"},"host":{"0":"shop.test"},"search":{"what":"items"}}
//   https://shop.test/orders/42                      null
//   https://shop.test/orders/42?expand=items&page=2  {"name":"order","path":{"id":"42"},"host":{"0":"shop.test"},"search":{"what":"items&page=2"}}
//   https://shop.test/orders/42?page=2&expand=items  null
```

A `search` pattern is matched against the whole query string, as text. `/orders/42` without `?expand=` does not match the `order` route. `?expand=items&page=2` does match, but `what` captured `items&page=2`, and the same two parameters in the other order do not match at all. For query parameters, match the pathname only and read `url.searchParams`.

### Common mistakes & gotchas (additional topics)

- **Sizing pools with `os.cpus().length` in containers.** It reports the host's CPUs. `os.availableParallelism()` follows affinity and the cgroup quota.
- **Splitting input on `os.EOL`.** It is the line ending of the machine you run on, not of the file. Split on `/\r?\n/`.
- **Treating `URL.canParse(x) === true` as "safe to fetch".** `javascript:alert(1)` and `//evil.test` both pass (see below). Check `protocol` and `origin` after parsing.
- **Using `URLPattern` in production code without pinning Node.** It is experimental in v24, so its behaviour can change between releases.
- **Using a `URLPattern` `search` pattern to read query parameters.** It matches the whole query string as text, so parameter order matters and a group can swallow `&page=2`. Use `url.searchParams`.

### Edge case worked through: `canParse` against a base accepts other origins

An API client takes a path from configuration and resolves it against its base URL. `URL.canParse(input, base)` looks like the right validation. It isn't:

javascript

```
// edge.mjs — canParse says "parsable", not "what you meant"
const base = 'https://api.example.com/v1/';
for (const input of ['users', '/users', 'api.example.com', '//evil.test/users', 'javascript:alert(1)']) {
  const ok = URL.canParse(input, base);
  const u = URL.parse(input, base);
  console.log(input.padEnd(20), ok, '->', u.href, '| same origin:', u.origin === new URL(base).origin);
}

// Real output (Node v24.19.0):
//   users                true -> https://api.example.com/v1/users | same origin: true
//   /users               true -> https://api.example.com/users | same origin: true
//   api.example.com      true -> https://api.example.com/v1/api.example.com | same origin: true
//   //evil.test/users    true -> https://evil.test/users | same origin: false
//   javascript:alert(1)  true -> javascript:alert(1) | same origin: false
```

Every input "can be parsed". `'api.example.com'` became a path segment, not a host. `'//evil.test/users'` is a *scheme-relative* URL: it keeps the base's `https:` and replaces the host, so a request built from it goes to another server. `'javascript:alert(1)'` has its own scheme and ignores the base completely. The check you want is to parse first, then compare `url.origin` (and `url.protocol`) with what you expect.

### ⭐ Interview lens (additional topics)

> **Q: “How many worker threads should a CPU-bound pool start in a container?”**  
> A: `os.availableParallelism()`, not `os.cpus().length`. The first counts the CPUs the process may use: its affinity mask, capped by the cgroup quota. The second counts the host's CPUs, so in a 2-CPU container on an 8-core host it says 8. *Trap:* neither one changes the libuv thread pool size.

> **Q: “How do you validate that a user-supplied URL points to your own API?”**  
> A: Parse it with `URL.parse(input, base)` (or `new URL` in a `try`), then compare `url.origin` with the expected origin and check `url.protocol`. `URL.canParse` only says the string is syntactically a URL. `//evil.test/x` and `javascript:...` both pass it.
