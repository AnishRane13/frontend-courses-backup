---
title: "Template Engines and Server-Side Rendering"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Template Engines and Server-Side Rendering

*24 min read · Updated 10 Oct 2026 · Topic 88 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0

---

## Say it in 30 seconds

A template engine takes an HTML file with placeholders and a data object, and returns a finished HTML string, escaping a less-than sign so user text cannot become markup. Express does not include an engine. When a route renders a view named home, Express finds the file under the views setting, calls the engine you registered, and sends the string as HTML. Server-side rendering here means the server does that on each request and sends a complete page. It exists for admin pages, emails, and anywhere the browser should show HTML before any script runs. The trade-off is escaping. It protects text between tags, and it does nothing for a javascript colon link or a value you paste inside a script.

## Why it matters

Lessons 47 to 51 and 63 to 66 answer with JSON. Plenty of Express apps answer with HTML instead: an admin panel, an account page, a docs site, an order email, the login form in front of an API. Building that HTML by gluing strings in a handler breaks as soon as you forget to escape one value. A user named with a `<script>` tag runs code in every visitor's browser.

A template engine does the gluing, and Express has a fixed way to plug one in: `res.render()`, `app.engine()`, and the settings `views`, `view engine`, and `view cache`. Miss that protocol and you hit these:

- **"Failed to lookup view" in production only.** `views` defaults to `process.cwd()` plus `/views`. Start the app from another directory and every page breaks.
- **Templates that never update.** `view cache` turns on when `NODE_ENV` is `production`, so an edited template is ignored until you restart. Example 5 shows it. One engine even ignores the per-render switch. Example 6 shows it.
- **XSS through a template that "escapes everything".** HTML escaping protects text between tags. It does nothing for a `javascript:` URL in an `href`, or a value pasted into a `<script>`. Example 4 shows each.
- **User input steering the engine.** Some local names are engine options. Spreading `req.query` into the locals lets a visitor pick which layout file is read. Example 8 shows it.

## The concept, simply

A template is a text file of HTML with placeholders and a little control flow: loops, conditionals, and includes. A template engine is a function that takes that file and a data object and returns HTML. Engines differ in syntax and share two jobs. They replace placeholders, and they HTML-escape those values by default, turning `<` into `&lt;` and `&` into `&amp;`, so data cannot become markup.

Server-side rendering here means the classic kind. The server runs the engine for each request and sends a complete HTML page. Frameworks such as Next.js also say SSR when they render React on the server. That is a different stack, and this lesson does not cover it.

Express does not ship an engine. It defines a contract and calls whatever you register.

- `app.set('views', dir)` is where template files live. It can be an array of directories.
- `app.set('view engine', 'ejs')` is the extension to assume when `res.render('home')` has none.
- An engine is a function `(filePath, options, callback)`. Express gets it from `app.engine(ext, fn)` or, if nothing is registered for that extension, from `require(ext).__express`.
- `res.render(name, locals)` finds the file, calls the engine with the merged data, and sends the string as `Content-Type: text/html; charset=utf-8`.

The three engines in this lesson:

| Engine | Package (version used) | Placeholder (escaped / raw) | Layouts | Partials |
| --- | --- | --- | --- | --- |
| EJS | `ejs` 7.0.1 | `<%= x %>` / `<%- x %>` | none built in: include a header and a footer | `<%- include('file', data) %>` (runtime) |
| Pug | `pug` 3.0.4 | `#{x}` or `p= x` / `!{x}` or `p!= x` | `extends layout` + `block content` | `include file` (compile time) |
| Handlebars | `express-handlebars` 9.0.2 (on `handlebars` 4.7.10) | `{{x}}` / `{{{x}}}` | `views/layouts/main.hbs` with `{{{body}}}` | `{{> name}}` from `views/partials/` |

EJS and Pug export `__express`, so Express loads them from the extension with no `app.engine` call. express-handlebars does not, so you register it with `app.engine('hbs', engine({ extname: '.hbs' }))`. This lesson uses express-handlebars rather than the `hbs` package because its layout and partial directories are conventions you do not wire by hand.

## How it works

What `res.render('guestbook', { title: 'Guestbook' })` does in Express 5.3.0:

1. `res.render` stores `res.locals` as `options._locals` and supplies a default callback. Success calls `res.send(html)`. Failure calls `next(err)`.
2. `app.render` merges `{ ...app.locals, ...res.locals, ...options }`. A later source wins on the same key. `app.locals.settings` is always included.
3. If the merged object has no `cache` key, Express sets `cache` from `app.enabled('view cache')`. When `cache` is true and a `View` for this name is already in `app.cache`, the lookup steps are skipped.
4. The extension comes from the name, such as `guestbook.pug`, or from `view engine` when the name has none. The engine function is `app.engines[ext]`, or `require` of the extension's package, then `.__express`, the first time. With no extension and no `view engine`, Express throws `No default engine was specified and no extension was provided.`
5. For each directory in `views`, in order, it tries `<dir>/<name><ext>` and then `<dir>/<name>/index<ext>`. If none exists, the error is `Failed to lookup view "guestbook" in views directory "…"`.
6. The engine reads and compiles the file, or reuses its compiled copy when `cache` is set, runs it, and calls `callback(null, html)` or `callback(err)`.
7. Express 5 always delivers that callback asynchronously, even if the engine called it synchronously. That changed in v5.0.0. Example 9 shows it. `res.send(html)` then sets `Content-Type`, `Content-Length`, and an `ETag`.

No SVG in the kit shows this flow.

text

```
res.render('guestbook', { title })
  │  options._locals = res.locals; default callback = res.send / next(err)
  ▼
app.render(name, options, done)
  │  data  = { ...app.locals, ...res.locals, ...options }     later wins
  │  cache = data.cache ?? app.enabled('view cache')
  │  cache && app.cache['guestbook'] ? ── yes ──────────────────────┐
  ▼                                                                 │
new View(name, { defaultEngine: 'ejs', root: views, engines })      │
  │  ext    = extname(name) || '.' + view engine         → '.ejs'   │
  │  engine = app.engines['.ejs'] ?? require('ejs').__express       │
  │  path   = first of <views>/guestbook.ejs, <views>/guestbook/index.ejs
  │  cache ? app.cache['guestbook'] = view                          │
  ▼                                                                 │
engine(path, data, callback)  ◄─────────────────────────────────────┘
  │  read file → compile (engine keeps its own compiled cache when data.cache)
  │  → run with data → HTML string
  ▼
callback(err, html)   always async in Express 5
  ├── err  → next(err) → your error handler
  └── html → res.send(html) → 200, text/html; charset=utf-8, ETag
```

**Two caches, not one.** `view cache` makes Express keep the `View`, the resolved path and the engine, in `app.cache`, and it passes `cache: true` into the engine. EJS, Pug, and express-handlebars then keep compiled functions in memory, keyed by file path, and stop reading the file. That is why an edited template is ignored in production until you restart. Example 5 shows it. The default is in `lib/application.js`: when `env` is `'production'`, Express enables `view cache`. `env` is `process.env.NODE_ENV` or `'development'`. The check is case-sensitive, so `NODE_ENV=PRODUCTION` leaves caching off. Express 4.22.3 has the same check.

**Layouts and partials.** A layout is the page frame shared by every page. A partial is a fragment reused inside pages.

- EJS has only `include`. `<%- include('partials/entry', { entry }) %>` runs the other file at render time, with paths relative to the current file. You use `<%-`, the raw form, so the included HTML is not escaped a second time. EJS has no layout inheritance. The usual pattern is a header include at the top and a footer include at the bottom.
- Pug has inheritance. A page starts with `extends layout` and fills `block content`. `include` pastes the other file in at compile time, so it sees the variables in scope, such as a loop variable. A fragment that takes arguments can be a `mixin`.
- express-handlebars renders the page first, then the layout, with the page HTML as `{{{body}}}`. The layout comes from `layoutsDir`, default `<views>/layouts/`, and `defaultLayout`, default `main`. Partials come from `partialsDir`, default `<views>/partials/`, and are used as `{{> entry}}`. A local named `layout` overrides the layout for that render. `layout: false` turns it off.

**What escaping does.** Escaped output replaces the characters that let text become markup. In the runs here, EJS replaces `& < > " '` with `&amp; &lt; &gt; &#34; &#39;`. Handlebars also replaces a backtick and `=`. Pug replaces only `& < > "`, so a single quote passes through. That is enough for text between tags and for an attribute value inside double quotes. It is not enough in three places. Example 4 shows each.

- A URL attribute such as `href`, `src`, or `action`. `javascript:alert(1)` contains no character an escaper touches, and the browser runs it when the link is clicked. You need an allowlist of schemes.
- An unquoted attribute. A space ends the value, so `x onerror=alert(1)` adds an `onerror` attribute. Always quote attributes.
- Inside `<script>`. The browser does not decode `&#39;` and similar entities in script text, so escaping is either useless or it corrupts the value. Put data in a script as JSON with `<` escaped, or in a `data-` attribute the script reads.

**Locals.** `app.locals` is one object for the life of the app: the site name, helpers, an asset base URL. `res.locals` is a fresh object per request: the signed-in user, a CSRF token, flash messages. Middleware fills `res.locals` so every template can read them without each route passing them again. Lesson 52 covers `app.set` and `app.locals`. For rendering, the order is `app.locals`, then `res.locals`, then the object passed to `res.render`. Later wins.

**Reserved names.** The merged data object is also the engine's options. Express reads `cache` from it. express-handlebars reads `layout`. Templates can read `settings`, which is all app settings, including `env` and `views`. Pass named values, such as `{ q: req.query.q }`. Never spread `req.query` or `req.body`. Example 8 shows why.

**When HTML beats a JSON API.** No benchmarks were run for this lesson, so this is about how each one works, not about speed.

- An HTML response is a complete document. The browser can show it before any script loads, and it works with scripts disabled. A crawler that skips scripts, a link-preview bot that reads `og:` meta tags, and an email client can all read it. For email, render with `app.render`.
- A server-rendered app has fewer parts. There is no client router, no client state store, and no API version between your own front end and back end. A form POSTs, the server redirects, and the next page is rendered. Escaping happens in one place, the engine.
- JSON wins when there are several clients, such as a mobile app or a partner, or when the page is an application whose state lives in the browser.
- One route can do both. `res.format()` picks HTML or JSON from the `Accept` header. Example 10 shows it.

Measure before you pick for speed. Look at time to first byte and Largest Contentful Paint on your real pages.

## Code examples

Set up one folder for every example (the file names below are the names used in the commands):

bash

```
npm init -y
npm install express@5.3.0 ejs@7.0.1 pug@3.0.4 express-handlebars@9.0.2 supertest@7.3.1 parse5@8.0.1
npm install express4@npm:express@4.22.3 ejs6@npm:ejs@6.0.1   # only for the comparisons in Examples 6 and 9
```

Most examples drive the app with supertest (7.3.1), which starts the Express app on a random port and sends real HTTP requests to it. Examples 5, 6 and 10 call `app.listen()` and use `fetch` or `curl`.

**Example 1 — a custom engine: the `(filePath, options, callback)` contract and how Express finds the file.**

javascript

```
// engine.cjs: a 15-line template engine. {{key}} is HTML-escaped, {{{key}}} is raw.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function tplEngine(filePath, options, callback) {   // the contract Express calls
  console.log('engine got filePath:', path.relative(__dirname, filePath));
  console.log('engine got option keys:', Object.keys(options).join(', '));
  fs.readFile(filePath, 'utf8', (err, src) => {
    if (err) return callback(err);                     // error -> next(err)
    const html = src
      .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => String(options[k] ?? ''))
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => esc(options[k] ?? ''));
    callback(null, html);                              // string -> res.send(html)
  });
}

fs.mkdirSync(path.join(__dirname, 'views'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'views', 'hello.tpl'),
  '<h1>Hello {{name}}</h1><p>{{{note}}}</p>\n');

const app = express();
app.engine('tpl', tplEngine);                 // register for the .tpl extension
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'tpl');                // lets res.render('hello') omit .tpl
app.locals.site = 'Demo';
app.get('/', (req, res) => {
  res.locals.user = 'ada';
  res.render('hello', { name: '<Ada>', note: '<i>raw</i>' });
});
app.get('/missing', (req, res) => res.render('nope'));
app.get('/notinstalled', (req, res) => res.render('page.liquid')); // require('liquid')
app.get('/notengine', (req, res) => res.render('page.path'));       // require('path')
app.use((err, req, res, next) => res.status(500).send(err.message.split('\n')[0]));

(async () => {
  for (const url of ['/', '/missing', '/notinstalled', '/notengine']) {
    const r = await request(app).get(url);
    console.log(url, r.status, JSON.stringify(r.text.replace(__dirname, '<dir>')));
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   engine got filePath: views/hello.tpl
//   engine got option keys: settings, site, user, name, note, _locals, cache
//   / 200 "<h1>Hello &lt;Ada&gt;</h1><p><i>raw</i></p>\n"
//   /missing 500 "Failed to lookup view \"nope\" in views directory \"<dir>/views\""
//   /notinstalled 500 "Cannot find module 'liquid'"
//   /notengine 500 "Module \"path\" does not provide a view engine."
```

The option keys show the merge order: `settings` and `site` from `app.locals`, `user` from `res.locals`, `name` and `note` from the render call, then `_locals` and `cache` added by Express. `res.render('page.path')` really did `require('path')` and found no `__express`, which is why the view name must never come from the user. Express's `debug` output shows the file lookup (timestamps removed by the `sed`):

bash

```
$ DEBUG=express:view node engine.cjs 2>&1 | grep 'express:view' | sed "s#$PWD#.#; s/^[^ ]* //"
express:view lookup "hello.tpl"
express:view stat "./views/hello.tpl"
express:view render "./views/hello.tpl"
express:view lookup "nope.tpl"
express:view stat "./views/nope.tpl"
express:view stat "./views/nope/index.tpl"
express:view require "liquid"
express:view require "path"
```

**Example 2 — the same page in EJS, Pug and Handlebars: a layout, a partial, and a list with user input.**

Create these files (this listing is `tail` printing each file with its name):

bash

```
$ tail -n +1 views/ejs/guestbook.ejs views/ejs/partials/*.ejs
==> views/ejs/guestbook.ejs <==
<%- include('partials/header', { title }) -%>
<h1><%= title %></h1>
<ul>
<% for (const entry of entries) { -%>
<%- include('partials/entry', { entry }) -%>
<% } -%>
</ul>
<%- include('partials/footer') -%>

==> views/ejs/partials/entry.ejs <==
<li><b><%= entry.name %></b>: <%= entry.msg %></li>

==> views/ejs/partials/footer.ejs <==
<footer>Signed in as <%= user %></footer>
</body>
</html>

==> views/ejs/partials/header.ejs <==
<!doctype html>
<html>
<head><title><%= title %> · <%= siteName %></title></head>
<body>
$ tail -n +1 views/pug/layout.pug views/pug/guestbook.pug views/pug/partials/entry.pug
==> views/pug/layout.pug <==
doctype html
html
  head
    title #{title} · #{siteName}
  body
    block content
    footer Signed in as #{user}

==> views/pug/guestbook.pug <==
extends layout

block content
  h1= title
  ul
    each entry in entries
      include partials/entry

==> views/pug/partials/entry.pug <==
li
  b= entry.name
  | : #{entry.msg}
$ tail -n +1 views/hbs/layouts/main.hbs views/hbs/guestbook.hbs views/hbs/partials/entry.hbs
==> views/hbs/layouts/main.hbs <==
<!doctype html>
<html>
<head><title>{{title}} · {{siteName}}</title></head>
<body>
{{{body}}}
<footer>Signed in as {{user}}</footer>
</body>
</html>

==> views/hbs/guestbook.hbs <==
<h1>{{title}}</h1>
<ul>
{{#each entries}}
{{> entry}}
{{/each}}
</ul>

==> views/hbs/partials/entry.hbs <==
<li><b>{{name}}</b>: {{msg}}</li>
```

The `-%>` in EJS removes the newline after a tag, so loops don't leave blank lines. One app per engine renders the same data:

javascript

```
// ssr.cjs: the same page, three engines, one Express 5 app per engine.
const path = require('node:path');
const express = require('express');
const { engine } = require('express-handlebars');
const request = require('supertest');

const data = {
  title: 'Guestbook',
  entries: [
    { name: 'Ada', msg: 'Hello from <b>bold</b> land' },
    { name: '<script>alert(1)</script>', msg: 'Tom & "Jerry"' },
  ],
};

function makeApp(kind) {
  const app = express();
  app.set('views', path.join(__dirname, 'views', kind));
  if (kind === 'hbs') app.engine('hbs', engine({ extname: '.hbs' })); // ejs and pug load via __express
  app.set('view engine', kind);
  app.locals.siteName = 'Demo';                 // app-wide local
  app.use((req, res, next) => { res.locals.user = 'ada'; next(); }); // per-request local
  app.get('/', (req, res) => res.render('guestbook', data));
  return app;
}

(async () => {
  for (const kind of ['ejs', 'pug', 'hbs']) {
    const res = await request(makeApp(kind)).get('/');
    console.log(`--- ${kind}: ${res.status} ${res.headers['content-type']}`);
    console.log(res.text);
  }
})();
```

The real HTML each engine sent:

bash

```
$ node ssr.cjs
--- ejs: 200 text/html; charset=utf-8
<!doctype html>
<html>
<head><title>Guestbook · Demo</title></head>
<body>
<h1>Guestbook</h1>
<ul>
<li><b>Ada</b>: Hello from &lt;b&gt;bold&lt;/b&gt; land</li>
<li><b>&lt;script&gt;alert(1)&lt;/script&gt;</b>: Tom &amp; &#34;Jerry&#34;</li>
</ul>
<footer>Signed in as ada</footer>
</body>
</html>

--- pug: 200 text/html; charset=utf-8
<!DOCTYPE html><html><head><title>Guestbook · Demo</title></head><body><h1>Guestbook</h1><ul><li><b>Ada</b>: Hello from &lt;b&gt;bold&lt;/b&gt; land</li><li><b>&lt;script&gt;alert(1)&lt;/script&gt;</b>: Tom &amp; &quot;Jerry&quot;</li></ul><footer>Signed in as ada</footer></body></html>
--- hbs: 200 text/html; charset=utf-8
<!doctype html>
<html>
<head><title>Guestbook · Demo</title></head>
<body>
<h1>Guestbook</h1>
<ul>
<li><b>Ada</b>: Hello from &lt;b&gt;bold&lt;/b&gt; land</li><li><b>&lt;script&gt;alert(1)&lt;/script&gt;</b>: Tom &amp; &quot;Jerry&quot;</li></ul>
<footer>Signed in as ada</footer>
</body>
</html>
```

All three escaped the `<script>` name and the `<b>` in the message, so a browser shows them as text. They differ in whitespace (Pug writes no whitespace between tags unless you ask for it) and in the entity they use for `"` (`&#34;` vs `&quot;`, which a browser treats the same).

**Example 3 — escaped vs raw output, with a cookie-stealing payload.**

javascript

```
// escape.cjs: escaped vs raw output in each engine, rendered by Express 5 with one payload.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { engine } = require('express-handlebars');
const request = require('supertest');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
const templates = {
  'escaped.ejs': '<p><%= bio %></p>',
  'raw.ejs':     '<p><%- bio %></p>',
  'escaped.pug': 'p #{bio}',
  'raw.pug':     'p !{bio}',
  'escaped.hbs': '<p>{{bio}}</p>',
  'raw.hbs':     '<p>{{{bio}}}</p>',
};
for (const [file, src] of Object.entries(templates)) fs.writeFileSync(path.join(views, file), src);

const app = express();
app.set('views', views);
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: false }));
const bio = `<script>fetch('/steal?c='+document.cookie)</script>`;
for (const file of Object.keys(templates)) {
  app.get('/' + file, (req, res) => res.render(file, { bio })); // fixed view name per route
}

(async () => {
  for (const file of Object.keys(templates)) {
    const r = await request(app).get('/' + file);
    console.log(file.padEnd(12), r.text);
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   escaped.ejs  <p>&lt;script&gt;fetch(&#39;/steal?c=&#39;+document.cookie)&lt;/script&gt;</p>
//   raw.ejs      <p><script>fetch('/steal?c='+document.cookie)</script></p>
//   escaped.pug  <p>&lt;script&gt;fetch('/steal?c='+document.cookie)&lt;/script&gt;</p>
//   raw.pug      <p><script>fetch('/steal?c='+document.cookie)</script></p>
//   escaped.hbs  <p>&lt;script&gt;fetch(&#x27;/steal?c&#x3D;&#x27;+document.cookie)&lt;/script&gt;</p>
//   raw.hbs      <p><script>fetch('/steal?c='+document.cookie)</script></p>
```

The raw forms (`<%-`, `!{}`, `{{{ }}}`) pass the payload through untouched; in a browser it would send the visitor's cookies to `/steal`. Use them only for HTML you produced yourself (an include, a sanitised Markdown render), never for a user's value. Notice that Pug left the `'` unescaped; Example 4 shows where that matters.

**Example 4 — where HTML escaping is not enough: URL attributes, unquoted attributes and inline scripts.**

javascript

```
// contexts.cjs: HTML escaping is right for text between tags, and not enough anywhere else.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const request = require('supertest');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
fs.writeFileSync(path.join(views, 'unsafe.ejs'), [
  '<a href="<%= website %>">website</a>',                 // 1. URL attribute
  '<img alt=<%= nick %>>',                                 // 2. unquoted attribute
  '<script>const greeting = `Hi <%= nick %>`;</script>',  // 3. template literal in a script
  '<script>const pageSize = <%= size %>;</script>',        // 4. bare value in a script
].join('\n'));
fs.writeFileSync(path.join(views, 'unsafe.pug'),
  "script.\n  const nick = '#{nick}';\n");                  // 5. Pug leaves ' unescaped
fs.writeFileSync(path.join(views, 'safe.ejs'), [
  '<a href="<%= httpUrl(website) %>">website</a>',
  '<img alt="<%= nick %>">',
  '<script>const greeting = <%- toScript("Hi " + nick) %>;</script>',
  '<script>const pageSize = <%= Number.parseInt(size, 10) || 20 %>;</script>',
].join('\n'));

const app = express();
app.set('views', views);
app.locals.httpUrl = (u) => {                       // allow only http(s) links
  try { return ['http:', 'https:'].includes(new URL(u).protocol) ? u : '#'; }
  catch { return '#'; }
};
app.locals.toScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c'); // JSON, and no "</script>"
const evil = {
  website: 'javascript:alert(document.cookie)',
  nick: 'x onerror=alert(1) src=nope ${alert(2)}',
  size: '10; alert(3)',
};
app.get('/unsafe', (req, res) => res.render('unsafe.ejs', evil));
app.get('/pug', (req, res) => res.render('unsafe.pug', { nick: "'; alert(4); '" }));
app.get('/safe', (req, res) => res.render('safe.ejs', evil));

async function inspect(label, html) {
  const { parseFragment } = await import('parse5');   // the HTML5 parsing algorithm
  console.log(`--- ${label}\n${html}`);
  const walk = (n) => {
    if (n.tagName === 'a') console.log('a href:', n.attrs[0].value);
    if (n.tagName === 'img') console.log('img attributes:', n.attrs.map((a) => a.name).join(', '));
    if (n.tagName === 'script') {
      const calls = [];
      vm.runInNewContext(n.childNodes[0].value, { alert: (x) => calls.push(x) }); // fake alert()
      console.log('script called alert with:', calls);
    }
    (n.childNodes || []).forEach(walk);
  };
  walk(parseFragment(html));
}

(async () => {
  for (const url of ['/unsafe', '/pug', '/safe']) await inspect(url, (await request(app).get(url)).text);
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   --- /unsafe
//   <a href="javascript:alert(document.cookie)">website</a>
//   <img alt=x onerror=alert(1) src=nope ${alert(2)}>
//   <script>const greeting = `Hi x onerror=alert(1) src=nope ${alert(2)}`;</script>
//   <script>const pageSize = 10; alert(3);</script>
//   a href: javascript:alert(document.cookie)
//   img attributes: alt, onerror, src, ${alert(2)}
//   script called alert with: [ 2 ]
//   script called alert with: [ 3 ]
//   --- /pug
//   <script>const nick = ''; alert(4); '';</script>
//   script called alert with: [ 4 ]
//   --- /safe
//   <a href="#">website</a>
//   <img alt="x onerror=alert(1) src=nope ${alert(2)}">
//   <script>const greeting = "Hi x onerror=alert(1) src=nope ${alert(2)}";</script>
//   <script>const pageSize = 10;</script>
//   a href: #
//   img attributes: alt
//   script called alert with: []
//   script called alert with: []
```

There is no browser here, so the example checks what a browser would do in two ways. parse5 (8.0.1) implements the WHATWG HTML parsing algorithm, so its attribute list is the list a browser builds: the unquoted `alt` became four attributes, one of them `onerror`. Each `<script>` body runs in a `vm` context with a fake `alert`, which proves the attacker's code is now part of the script. In every unsafe case the escaper did its job, and the output is still exploitable, because the danger is in the *context*, not in `<` or `>`. The safe template fixes each context separately: a scheme allowlist for the URL, quotes around the attribute, `JSON.stringify` with `<` turned into `<` for script data (so a value cannot contain `</script>`), and a parsed number. Add a Content-Security-Policy header (lesson [52](86-web-security-owasp.md)) as a second layer.

**Example 5 — `view cache`: on only when `NODE_ENV` is exactly `production`, shown by editing templates between requests.**

javascript

```
// cache.cjs: does Express cache views? Run with different NODE_ENV values and edit templates between requests.
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { engine } = require('express-handlebars');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
const write = (v) => {
  fs.writeFileSync(path.join(views, 'v.ejs'), `<p>ejs ${v}</p>`);
  fs.writeFileSync(path.join(views, 'v.pug'), `p pug ${v}`);
  fs.writeFileSync(path.join(views, 'v.hbs'), `<p>hbs ${v}</p>`);
};

const app = express();
app.set('views', views);
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: false }));
app.get('/:ext', (req, res) => {
  if (!['ejs', 'pug', 'hbs'].includes(req.params.ext)) return res.sendStatus(404);
  res.render('v.' + req.params.ext);
});

(async () => {
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async () => (await Promise.all(['ejs', 'pug', 'hbs'].map(
    async (e) => (await fetch(`${base}/${e}`)).text()))).join(' ');

  write('v1'); const first = await get();
  write('v2'); const second = await get();          // template edited on disk between requests
  console.log(`NODE_ENV=${JSON.stringify(process.env.NODE_ENV)} env=${app.get('env')} ` +
    `view cache=${app.get('view cache')}\n  1st: ${first}\n  2nd: ${second}`);
  server.close();
})();
```

bash

```
$ node cache.cjs; for e in development test production PRODUCTION; do NODE_ENV=$e node cache.cjs; done
NODE_ENV=undefined env=development view cache=undefined
  1st: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
  2nd: <p>ejs v2</p> <p>pug v2</p> <p>hbs v2</p>
NODE_ENV="development" env=development view cache=undefined
  1st: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
  2nd: <p>ejs v2</p> <p>pug v2</p> <p>hbs v2</p>
NODE_ENV="test" env=test view cache=undefined
  1st: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
  2nd: <p>ejs v2</p> <p>pug v2</p> <p>hbs v2</p>
NODE_ENV="production" env=production view cache=true
  1st: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
  2nd: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
NODE_ENV="PRODUCTION" env=PRODUCTION view cache=undefined
  1st: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
  2nd: <p>ejs v2</p> <p>pug v2</p> <p>hbs v2</p>
```

Only the exact string `production` turns caching on, and then all three engines keep serving `v1` after the file says `v2`. The default is "undefined", not `false`, in every other environment, which `app.enabled('view cache')` treats as off. To force it either way, call `app.enable('view cache')` or `app.disable('view cache')` after creating the app.

**Example 6 — edge case: the per-render `cache` local is not honoured the same way by every engine.**

The Express docs say the local `cache` "is reserved for enabling view cache. Set it to true, if you want to cache view during development". Express does read it (step 3 above), but each engine decides for itself whether to cache compiled code:

javascript

```
// override.cjs: edge case, the per-render `cache` local is not honoured the same way by every engine.
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { engine } = require('express-handlebars');

const views = path.join(__dirname, 'views2');
fs.mkdirSync(views, { recursive: true });
const write = (v) => {
  for (const [ext, src] of [['ejs', `<p>ejs ${v}</p>`], ['pug', `p pug ${v}`], ['hbs', `<p>hbs ${v}</p>`]]) {
    fs.writeFileSync(path.join(views, `v.${ext}`), src);
  }
};

const cacheLocal = JSON.parse(process.argv[2]);     // true or false, passed per render
const ejsPkg = process.argv[3] || 'ejs';            // 'ejs' (7.0.1) or the alias 'ejs6' (6.0.1)
const app = express();
app.set('views', views);
app.engine('ejs', require(ejsPkg).__express);
app.engine('hbs', engine({ extname: '.hbs', defaultLayout: false }));
app.get('/:ext', (req, res) => {
  if (!['ejs', 'pug', 'hbs'].includes(req.params.ext)) return res.sendStatus(404);
  res.render('v.' + req.params.ext, { cache: cacheLocal });
});

(async () => {
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async () => (await Promise.all(['ejs', 'pug', 'hbs'].map(
    async (e) => (await fetch(`${base}/${e}`)).text()))).join(' ');
  write('v1'); await get();
  write('v2');
  console.log(`${ejsPkg} view cache=${app.get('view cache')} render({ cache: ${cacheLocal} }) after edit: ${await get()}`);
  server.close();
})();
```

bash

```
$ node override.cjs true; NODE_ENV=production node override.cjs false
ejs view cache=undefined render({ cache: true }) after edit: <p>ejs v2</p> <p>pug v1</p> <p>hbs v1</p>
ejs view cache=true render({ cache: false }) after edit: <p>ejs v1</p> <p>pug v2</p> <p>hbs v2</p>
$ node override.cjs true ejs6; NODE_ENV=production node override.cjs false ejs6
ejs6 view cache=undefined render({ cache: true }) after edit: <p>ejs v1</p> <p>pug v1</p> <p>hbs v1</p>
ejs6 view cache=true render({ cache: false }) after edit: <p>ejs v2</p> <p>pug v2</p> <p>hbs v2</p>
```

Pug and express-handlebars follow the `cache` local in both directions. EJS 7.0.1 ignores it: its `renderFile` only looks at `settings['view cache']`, so `cache: true` in development does not cache, and `cache: false` in production does **not** stop it serving the stale `v1`. EJS 6.0.1 copied `cache` from the data (its `_OPTS_PASSABLE_WITH_DATA_EXPRESS` list), so it behaved like the other two (changed in EJS 7.0.x). The reliable switch for all three is the app setting, `app.disable('view cache')`. The EJS 7.0.1 release on GitHub has no release notes, so this comes from reading both versions' source and from the runs above.

**Example 7 — `app.locals`, `res.locals` and render data: which one wins.**

javascript

```
// locals.cjs: where template variables come from, and which source wins.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
fs.writeFileSync(path.join(views, 'who.ejs'),
  'site=<%= site %> user=<%= user %> theme=<%= theme %> ' +
  'year=<%= year() %> env=<%= settings.env %>');

const app = express();
app.set('views', views);
app.set('view engine', 'ejs');
app.locals.site = 'Demo';                 // 1. app.locals: every render in this app
app.locals.theme = 'light';
app.locals.year = () => 2026;             //    functions work too (helpers)

app.use((req, res, next) => {             // 2. res.locals: this request only
  res.locals.user = req.get('x-user') ?? 'anonymous';
  res.locals.theme = 'dark';              //    overrides app.locals.theme
  next();
});

app.get('/', (req, res) => res.render('who'));
app.get('/override', (req, res) => res.render('who', { theme: 'contrast' })); // 3. render arg wins

(async () => {
  console.log((await request(app).get('/').set('x-user', 'ada')).text);
  console.log((await request(app).get('/')).text);
  console.log((await request(app).get('/override')).text);
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   site=Demo user=ada theme=dark year=2026 env=development
//   site=Demo user=anonymous theme=dark year=2026 env=development
//   site=Demo user=anonymous theme=contrast year=2026 env=development
```

`res.locals.user` from the first request did not leak into the second, because `res.locals` is created per request. `settings.env` shows that every template can read the app settings.

**Example 8 — spreading `req.query` into the locals lets the client choose the layout file.**

javascript

```
// spread.cjs: never spread user input into render locals.
const path = require('node:path');
const express = require('express');
const { engine } = require('express-handlebars');
const request = require('supertest');

const app = express();
app.set('views', path.join(__dirname, 'views', 'hbs'));     // the Example 2 views
app.engine('hbs', engine({ extname: '.hbs' }));
app.set('view engine', 'hbs');
app.get('/', (req, res) => res.render('guestbook', { title: 'Guestbook', entries: [], ...req.query }));
app.use((err, req, res, next) => res.status(500).send(err.message.replace(__dirname, '<dir>')));

(async () => {
  for (const q of ['', '?layout=../guestbook', '?layout=nope']) {
    const r = await request(app).get('/' + q);
    console.log(q || '(none)', r.status, JSON.stringify(r.text.slice(0, 160)));
  }
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   (none) 200 "<!doctype html>\n<html>\n<head><title>Guestbook · </title></head>\n<body>\n<h1>Guestbook</h1>\n<ul>\n</ul>\n<footer>Signed in as </footer>\n</body>\n</html>"
//   ?layout=../guestbook 200 "<h1>Guestbook</h1>\n<ul>\n</ul>"
//   ?layout=nope 500 "ENOENT: no such file or directory, open '<dir>/views/hbs/layouts/nope.hbs'"
```

`layout` is an express-handlebars option, so `?layout=../guestbook` made it read a file outside `layouts/` as the layout, and `?layout=nope` produced an error that names a server path. The same applies to `cache` in Express and to `settings`. Pass the fields you mean: `{ q: String(req.query.q ?? '') }`.

**Example 9 — Express 4 vs 5: the render callback is always asynchronous in Express 5.**

javascript

```
// sync-engine.cjs: an engine that calls back synchronously, Express 4 vs Express 5 ordering.
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
fs.writeFileSync(path.join(views, 'x.sync'), 'hi');

async function run(pkg) {
  const express = require(pkg);
  const app = express();
  app.set('views', views);
  app.engine('sync', (file, opts, cb) => cb(null, fs.readFileSync(file, 'utf8'))); // no I/O wait
  app.get('/', (req, res) => {
    const order = [];
    res.render('x.sync', (err, html) => {
      order.push('render callback');
      res.send(order.join(' -> '));
    });
    order.push('line after res.render()');
  });
  console.log(pkg.padEnd(8), (await request(app).get('/')).text);
}
(async () => { await run('express4'); await run('express'); })();

// Real output (Node v24.19.0, Express 4.22.3 and 5.3.0):
//   express4 render callback
//   express  line after res.render() -> render callback
```

In Express 4.22.3 the callback ran *inside* `res.render()`, before the next line, and the response went out without it. Express 5 wraps a synchronous callback in `process.nextTick` (`View.prototype.render`), which the migration guide lists as an improvement: code after `res.render()` now always runs first, whatever the engine does.

**Example 10 — one route, HTML for browsers and JSON for API clients.**

javascript

```
// format.cjs: one route, two representations, chosen by the Accept header.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const views = path.join(__dirname, 'views');
fs.mkdirSync(views, { recursive: true });
fs.writeFileSync(path.join(views, 'products.ejs'),
  '<ul><% for (const p of products) { %><li><%= p.name %>: $<%= p.price %></li><% } %></ul>\n');

const app = express();
app.set('views', views);
app.set('view engine', 'ejs');
const products = [{ name: 'Mug', price: 8 }, { name: 'Tee', price: 20 }];

app.get('/products', (req, res) => {
  res.format({                                   // picks a branch from the Accept header
    html: () => res.render('products', { products }),
    json: () => res.json({ products }),
    default: () => res.status(406).send('Not Acceptable'),
  });
});

app.listen(5701, () => console.log('listening on 5701'));
```

bash

```
$ curl -si -H 'Accept: text/html' localhost:5701/products
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Accept
Content-Type: text/html; charset=utf-8
Content-Length: 43
ETag: W/"2b-3kPTrXakEqQQtwA5uwY4v6Bt3iE"
Date: Sat, 10 Oct 2026 16:06:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

<ul><li>Mug: $8</li><li>Tee: $20</li></ul>
$ curl -si -H 'Accept: application/json' localhost:5701/products
HTTP/1.1 200 OK
X-Powered-By: Express
Vary: Accept
Content-Type: application/json; charset=utf-8
Content-Length: 65
ETag: W/"41-mEinr/XoZjETahWTc5pKpSBv5KQ"
Date: Sat, 10 Oct 2026 16:06:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"products":[{"name":"Mug","price":8},{"name":"Tee","price":20}]}
$ curl -si -H 'Accept: image/png' localhost:5701/products
HTTP/1.1 406 Not Acceptable
X-Powered-By: Express
Vary: Accept
Content-Type: text/html; charset=utf-8
Content-Length: 14
ETag: W/"e-dqk0oyZuM+x+D21Lq3ZqYJ94/o4"
Date: Sat, 10 Oct 2026 16:06:12 GMT
Connection: keep-alive
Keep-Alive: timeout=5

Not Acceptable
```

`res.format` added `Vary: Accept`, which tells caches that the same URL has different bodies for different `Accept` headers. Without it, a shared cache could hand the JSON to a browser.

## Common mistakes & gotchas

- **A relative `views` directory.** The default is `process.cwd() + '/views'`. Start the process from another directory and every `res.render` throws "Failed to lookup view". Set an absolute path.
- **Editing a template in production and expecting it to show up.** `view cache` is on when `NODE_ENV` is exactly `production`. The engines keep the compiled function. Restart, or the old HTML stays. Example 5 shows `v1` still served after the file says `v2`.
- **Assuming every engine honors `{ cache: false }` the same way.** Example 6 shows they do not.
- **Raw output for user text.** `<%- %>`, `!{}`, and `{{{ }}}` skip escaping. Use them only for HTML you produced, such as an include or sanitized Markdown.
- **Trusting escaping inside a URL, an unquoted attribute, or a `<script>`.** Example 4 shows each one still exploitable after escaping.
- **Spreading `req.query` into the locals.** A visitor can set `layout` or other engine options. Example 8 shows it. Pass named fields.
- **A view name from the user.** `res.render(req.params.page)` can `require` an unexpected package. Example 1 shows `page.path` loading the `path` module and finding no `__express`.

## Best practices

- Set `views` to an absolute directory, and set `view engine`, before the first render.
- Escape by default. Use the raw form only for HTML your own code produced.
- For a URL, allowlist the scheme. Quote every attribute. For data inside a script, `JSON.stringify` and escape `<`.
- Pass a specific object of locals. Do not spread the query string or the body.
- Fill `res.locals` in middleware for the user, the CSRF token, and flash messages. Keep `app.locals` for values that are the same on every request.
- Leave `view cache` on in production. Restart the process to pick up a template edit, or disable the cache only when you mean to.
- Add a Content-Security-Policy header as a second layer. Lesson 86 covers it.

## ⭐ Interview lens

> **Q: “What happens, step by step, when a route calls `res.render('home')`?”**  
> A: `res.render('home')` does not send HTML itself until the engine returns a string. It stores `res.locals` on the options as `_locals` and calls `app.render`. That merges `app.locals`, then `res.locals`, then the object you passed, with later keys winning, and it includes `app.locals.settings`. If `view cache` is on and this view was already resolved, Express skips the file lookup. Otherwise it adds the `view engine` extension when the name has none, loads `require(ext).__express` or the function you registered with `app.engine`, and looks in each `views` directory for `home.ejs` and then `home/index.ejs`. The engine compiles the file, or reuses a compiled copy when `cache` is true, and calls back with HTML. Express 5 runs that callback asynchronously even if the engine called it synchronously. `res.send` then sets `text/html; charset=utf-8`. The limit is the lookup. A wrong `views` path, which defaults to `cwd/views`, throws `Failed to lookup view`.

> **Q: “Your template uses `<%= %>` everywhere. Is the page safe from XSS?”**  
> A: No. `<%= %>` in EJS, and the escaped forms in Pug and Handlebars, replace the characters that would open a tag or break a quoted attribute. In the runs here, EJS turns `& < > " '` into entities. That stops a name of `<script>...` from becoming a tag, which Example 3 shows. It does not stop three other contexts. `javascript:alert(1)` in an `href` has no character the escaper touches. An unquoted attribute can be split by a space into a new `onerror` attribute. Inside `<script>`, the browser does not treat `&#39;` as a quote, so the escaping either does nothing useful or corrupts the value. Allowlist URL schemes, quote attributes, and put script data in as JSON with `<` escaped. Pug also leaves a single quote unescaped. Add Content-Security-Policy as a second layer.

> **Q: “You fixed a typo in a template and deployed by copying the file. Production still shows the typo. Why?”**  
> A: `view cache` compiled the template on the first request and kept the function in memory, keyed by file path. Copying a fixed file onto disk does not update that function. Express turns the cache on by itself when `NODE_ENV` is exactly the string `production`. `PRODUCTION` in any other case does not. EJS, Pug, and express-handlebars all stop rereading the file once `cache` is true, which is a second cache on top of Express keeping the `View` object. Example 5 edited the file from `v1` to `v2` and production kept serving `v1`. Restart the process, or call `app.disable('view cache')` when you intentionally want reads. The per-render `cache` flag is not honored the same way by every engine. Example 6 shows that.

> **Q: “`res.locals` vs `app.locals`?”**  
> A: `res.locals` is created for one request and discarded with the response. Middleware puts the signed-in user, a CSRF token, or a flash message there, and every template rendered for that request can see it, without each route passing it again. `app.locals` is one object for the life of the process. Use it for the site name or a helper that is the same for everyone. `res.render` merges app, then res, then the object you pass, and the later value wins. The limit of putting the current user on `app.locals` is sharing. Two overlapping requests write the same object, so one user can see the other's data. Lesson 52 shows that leak with two concurrent requests.

## Cheat-card

- `res.render(name, locals)` finds the file, runs the engine, and sends `text/html; charset=utf-8`.
- `views` is the directory, default `<cwd>/views`. `view engine` is the extension when the name has none. `app.engine(ext, fn)` registers `(filePath, options, callback)`.
- EJS 7.0.1 uses `<%= %>` escaped and `<%- %>` raw, and includes at runtime. Pug 3.0.4 uses `#{ }` or `!=`, and `extends` plus `include` at compile time. express-handlebars 9.0.2 uses `{{ }}` and `{{{ }}}`, a layout with `{{{body}}}`, and `{{> partial}}`.
- EJS and Pug export `__express`. express-handlebars must be registered with `app.engine`.
- Merge order is `app.locals`, then `res.locals`, then the render argument. Later wins.
- `view cache` turns on only when `NODE_ENV` is exactly `production`. The engines then keep compiled functions and ignore edits until restart.
- Escaping is not enough for a URL scheme, an unquoted attribute, or the inside of `<script>`.
- Do not spread `req.query` or `req.body` into locals. `cache`, `layout`, and `settings` are engine and app data.
- Express 5 delivers the render callback asynchronously. That changed in v5.0.0.

## Good to know

- Render HTML on the server when the browser should show a finished page before any script runs, when a crawler or a link-preview bot or an email client must read the document, or when you want one place that escapes output. Prefer JSON when several clients share the API, or when the page's state lives in the browser. One route can do both with `res.format`. No speed benchmark was run for this lesson.
- `NODE_ENV=PRODUCTION` does not enable `view cache`. The check is case-sensitive against `'production'`. In every other environment the setting starts out undefined, which `app.enabled('view cache')` treats as off.

## Learn More

- [Using template engines with Express expressjs.com](https://expressjs.com/en/5x/guide/using-template-engines)
- [Developing template engines for Express expressjs.com](https://expressjs.com/en/5x/advanced/developing-template-engines)
- [Express 5.x application API (app.engine, app.render, settings) expressjs.com](https://expressjs.com/en/5x/api/application)
- [Express 5.x response API (res.render, res.format) expressjs.com](https://expressjs.com/en/5x/api/response)
- [Moving to Express 5 expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [EJS documentation ejs.co](https://ejs.co/)
- [Pug: getting started pugjs.org](https://pugjs.org/api/getting-started.html)
- [Pug: template inheritance pugjs.org](https://pugjs.org/language/inheritance.html)
- [express-handlebars README github.com](https://github.com/express-handlebars/express-handlebars)
- [Handlebars guide handlebarsjs.com](https://handlebarsjs.com/guide/)
- [Cross Site Scripting Prevention Cheat Sheet owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)
