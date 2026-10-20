---
title: "Cookies in Express"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Cookies in Express

*18 min read · Updated 10 Oct 2026 · Topic 90 of 96 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0

---

## Why it matters

Lesson [50 — Sessions & Cookies](84-sessions-cookies.md) explains what the cookie flags defend against and how `express-session` keeps state on the server. This lesson covers the layer under it: the Express API that writes `Set-Cookie` headers (`res.cookie`, `res.clearCookie`) and the `cookie-parser` middleware that reads the `Cookie` header back. You use them directly for preference cookies, "remember this device" tokens, CSRF double-submit tokens, A/B test buckets and short-lived flow state. `express-session` also produces its cookie through the same machinery.

These bugs show up when the API is used without knowing the details:

- **Logout that doesn't log out.** `res.clearCookie('token')` sends `Path=/`. If the cookie was set with `Path=/admin`, the browser keeps it (Example 5).
- **An Express 4 "clear" that sets a 24-hour cookie.** Reusing the original options object, with its `maxAge`, in `clearCookie` sends an empty cookie with `Max-Age=86400` on Express 4. Express 5 ignores `maxAge` and `expires` in `clearCookie` (Example 6).
- **Trusting a cookie the user edited.** Plain cookies are just text the client sends. Signed cookies detect edits, but only if you read `req.signedCookies` and treat `false` as "tampered" (Example 2).
- **Rotating the signing secret logs everybody out**, unless you know that cookie-parser signs with the first secret and verifies with all of them (Example 4).

## The concept, simply

A **cookie** is a name=value pair that a server asks the client to store and send back. The server sends one `Set-Cookie` response header per cookie, made of the pair followed by **attributes** (`Path`, `Domain`, `Expires`, `Max-Age`, `HttpOnly`, `Secure`, `SameSite`, `Partitioned`, `Priority`). The client keeps a **cookie jar**. On each later request it picks the cookies whose domain, path, `Secure` and `SameSite` rules match that request and sends them all in a single `Cookie` request header, as `name=value` pairs only. The attributes never come back to the server.

In Express:

- **`res.cookie(name, value, options)`** builds one `Set-Cookie` line and appends it to the response. It is built into Express (it calls the `cookie` package's `serialize`; `cookie` 0.7.2 here).
- **`res.clearCookie(name, options)`** sends the same name with an empty value and `Expires=Thu, 01 Jan 1970 00:00:00 GMT`. A client deletes a cookie only when the new line matches the stored cookie's name, domain and path.
- **`cookie-parser`** (a separate package, 1.4.7 here) parses the `Cookie` header into `req.cookies`. With a secret, it also verifies **signed cookies** and moves them into `req.signedCookies`. Express itself has no `req.cookies` (Example 1).

A **signed cookie** is `s:` + value + `.` + an HMAC-SHA256 of the value keyed by your secret, base64-encoded with the `=` padding removed (the `cookie-signature` package). The client can still read the value, since it is not encrypted, but cannot change it without the secret. If you need the client not to see the value, keep it on the server (a session) instead.

The full cycle, as text (no SVG in the kit shows it; `i47_01` is about server-side session lookup):

text

```
 Client (cookie jar)                                 Express app
 ───────────────────                                 ───────────
 GET /login ───────────────────────────────────────► res.cookie('uid', '42', { signed: true, httpOnly: true })
                                                       cookie.serialize() → one Set-Cookie line
 ◄──────────── 200  Set-Cookie: uid=s%3A42.HGZc…; Path=/; HttpOnly
 jar stores key (name=uid, host-only localhost, path=/)
   → value, HttpOnly, no expiry = deleted when the browser session ends

 GET /me  — jar picks cookies that match host, path,
            Secure, SameSite and are not expired
 Cookie: uid=s%3A42.HGZc…  ────────────────────────► cookieParser(secret)
   (name=value pairs only, no attributes)              cookie.parse() + decodeURIComponent
                                                       "s:…" → unsign with each secret → req.signedCookies.uid = '42' | false
                                                       "j:…" → JSON.parse        → req.cookies.prefs = { … }
                                                       route reads req.signedCookies / req.cookies

 GET /logout ──────────────────────────────────────► res.clearCookie('uid')   (path '/' must match)
 ◄──────────── Set-Cookie: uid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
 same key (uid, localhost, /) → replaced by an expired entry → removed
```

## How it works

What `res.cookie('uid', '42', { signed: true, maxAge: 60_000 })` does in Express 5.3.0 (`lib/response.js`):

1. **Copy the options** so your object is not modified.
2. **Check for a secret.** With `signed: true` and no `req.secret` (set by `cookieParser(secret)`), it throws `cookieParser("secret") required for signed cookies`.
3. **Turn the value into a string.** An object becomes `'j:' + JSON.stringify(value)`; anything else goes through `String()`.
4. **Sign it.** With `signed`, the value becomes `'s:' + sign(value, req.secret)`, which is `s:42.<base64 HMAC-SHA256>`.
5. **Convert `maxAge`.** Express takes milliseconds, sets `expires = now + maxAge` and `maxAge = Math.floor(maxAge / 1000)`, so both `Max-Age` (seconds) and `Expires` are sent.
6. **Default the path** to `/` when you gave none.
7. **Serialize and append.** `cookie.serialize(name, value, opts)` encodes the value with `encode` (default `encodeURIComponent`), checks that the result contains only legal cookie characters, and adds the attributes. `res.append('Set-Cookie', …)` adds a new header line, so several `res.cookie` calls give several lines.

What `cookieParser(secret)` does on each request (`cookie-parser/index.js`):

1. **Normalise the secrets.** A string becomes a one-element array; an array is used as is. `req.secret = secrets[0]`, which is the secret `res.cookie` will sign with.
2. **Parse the header.** `cookie.parse(req.headers.cookie)` splits on `;` and `=` and URL-decodes each value. If the same name appears twice, the first one is kept.
3. **Separate signed cookies.** Each value that starts with `s:` is checked against every secret in order. The first match gives the original value; no match gives `false`. Signed cookies are **removed** from `req.cookies` and put in `req.signedCookies`.
4. **Decode JSON cookies.** Values that start with `j:` are `JSON.parse`d, in both objects. A `j:` value that is not valid JSON is left as the raw string.

**Every `res.cookie` option.** This is the list in the Express 5 response API (https://expressjs.com/en/5x/api/response; the old `api.html#res.cookie` address now opens an index page), checked against what `cookie` 0.7.2 serializes. Example 3 shows the real header for each.

| Option | Type | Header produced | Notes |
| --- | --- | --- | --- |
| `domain` | String | `Domain=example.com` | Without it, no `Domain` is sent and the cookie is *host-only* (exact host only). The docs' wording, "Defaults to the domain name of the app", describes that, but no attribute is written. With it, subdomains receive the cookie too. |
| `encode` | Function | the encoded value | Default `encodeURIComponent`. Must be synchronous. The result must still be legal cookie characters, or `serialize` throws `argument val is invalid`. |
| `expires` | Date | `Expires=<GMT date>` | Not set (or `0`) → a session cookie. |
| `httpOnly` | Boolean | `HttpOnly` | The client hides it from `document.cookie`. |
| `maxAge` | Number (ms) | `Max-Age=<s>` and `Expires=<now + ms>` | Express sends both. Clients that support `Max-Age` give it precedence. |
| `path` | String | `Path=/admin` | Default `/`. The cookie is sent for that path and everything below it. |
| `partitioned` | Boolean | `Partitioned` | CHIPS: the cookie is stored separately for each top-level site that embeds you. Per MDN it must be sent with `Secure`. |
| `priority` | String | `Priority=Low/Medium/High` | From an expired IETF draft (draft-west-cookie-priority-00) that defines a retention priority for when the client evicts cookies. Clients may ignore it. |
| `secure` | Boolean | `Secure` | Sent back only over `https:` (MDN notes the localhost exception). |
| `signed` | Boolean | value becomes `s:…` | Needs `cookieParser(secret)`. Read it from `req.signedCookies`. |
| `sameSite` | Boolean or String | `SameSite=Strict/Lax/None` | `true` → `Strict`, `false` → attribute not sent, `'lax'`, `'strict'`, `'none'`. MDN: `None` also needs `Secure`. |

**Clearing a cookie.** A client identifies a stored cookie by name, domain and path (RFC 6265 §5.3, step 11). `res.clearCookie(name, options)` sets `{ path: '/', ...options, expires: new Date(1) }` and deletes `maxAge` before calling `res.cookie`. To delete a cookie you must therefore pass the same `path` and `domain` it was set with. `httpOnly`, `secure` and `sameSite` don't identify the cookie, but passing the same options object (minus lifetime) is the simplest habit. In Express 4.22.3, `clearCookie` merged your options on top of `{ expires: new Date(1), path: '/' }`, so your `maxAge` or `expires` won, and Express printed a deprecation warning. Express 5 forces the 1970 date and drops `maxAge` (changed in v5.0.0; listed in the migration guide).

**Secret rotation.** `cookieParser(['new', 'old'])` signs new cookies with `'new'` (`req.secret = secrets[0]`) and accepts cookies signed with either. To rotate: put the new secret first and keep the old one second for as long as old cookies can live (their longest `maxAge`), then remove it. Putting the new secret *second* keeps signing with the old one, which defeats the rotation (Example 4).

**How this relates to sessions.** `express-session` writes its cookie (`connect.sid` by default) with the same `cookie` serializer and the same `s:` + HMAC signing. It holds only the session id, and the data stays in the store. Since express-session 1.5.0 it parses cookies itself, so it does not need cookie-parser. If you use both, the express-session README says to give them the same secret. Lesson [50](84-sessions-cookies.md) covers stores, fixation and logout; Example 7 shows the cookie it sends.

## Code examples

Install everything used below in one folder:

bash

```
npm init -y
npm install express@5.3.0 cookie-parser@1.4.7 supertest@7.3.1 express-session@1.19.0
npm install express4@npm:express@4.22.3   # only for the comparison in Example 6
```

Most examples use supertest (7.3.1), which runs the app on a random port and sends real requests. Examples 3 and 5 start a server and use curl 8.18.0.

**Example 1 — Express alone writes cookies but does not parse them.**

javascript

```
// bare.cjs: Express alone. res.cookie() writes headers, but nothing parses the Cookie header.
const express = require('express');
const request = require('supertest');

const app = express();
app.get('/set', (req, res) => res.cookie('theme', 'dark').cookie('lang', 'en').end());
app.get('/read', (req, res) => res.json({
  cookieHeader: req.get('cookie'),        // the raw request header
  reqCookies: String(req.cookies),        // no parser installed
}));
app.get('/sign', (req, res) => res.cookie('uid', '42', { signed: true }).end());
app.use((err, req, res, next) => res.status(500).send(err.message));

(async () => {
  console.log((await request(app).get('/set')).headers['set-cookie']);
  console.log((await request(app).get('/read').set('Cookie', 'theme=dark; lang=en')).text);
  console.log((await request(app).get('/sign')).text);
})();

// Real output (Node v24.19.0, Express 5.3.0):
//   [ 'theme=dark; Path=/', 'lang=en; Path=/' ]
//   {"cookieHeader":"theme=dark; lang=en","reqCookies":"undefined"}
//   cookieParser("secret") required for signed cookies
```

Two `res.cookie` calls gave two `Set-Cookie` lines. The client sent both back in one `Cookie` header, and without a parser all you have is that raw string.

**Example 2 — cookie-parser: JSON cookies, signed cookies and what tampering looks like.**

javascript

```
// signed.cjs: cookie-parser with plain, JSON and signed cookies, and what tampering looks like.
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const app = express();
app.use(cookieParser('s3cret-signing-key'));
app.get('/login', (req, res) => {
  res.cookie('uid', '42', { signed: true, httpOnly: true });
  res.cookie('prefs', { theme: 'dark' });            // stored as j:{"theme":"dark"}
  res.end();
});
app.get('/me', (req, res) => res.json({ cookies: req.cookies, signedCookies: req.signedCookies }));

(async () => {
  const login = await request(app).get('/login');
  const setCookies = login.headers['set-cookie'];
  console.log(setCookies);
  const uid = setCookies[0].split(';')[0];           // "uid=s%3A42.<hmac>"
  const prefs = setCookies[1].split(';')[0];

  const send = async (label, cookie) =>
    console.log(label.padEnd(10), (await request(app).get('/me').set('Cookie', cookie)).text);
  await send('genuine', `${uid}; ${prefs}`);
  await send('tampered', uid.replace('s%3A42.', 's%3A1.'));   // change the value, keep the old HMAC
  await send('unsigned', 'uid=1');                             // no "s:" prefix at all
})();

// Real output (Node v24.19.0, Express 5.3.0, cookie-parser 1.4.7):
//   [
//     'uid=s%3A42.HGZcQlcrsK2YNs8SuUJKvNX34rQM0kbhhXKNY2EZyQc; Path=/; HttpOnly',
//     'prefs=j%3A%7B%22theme%22%3A%22dark%22%7D; Path=/'
//   ]
//   genuine    {"cookies":{"prefs":{"theme":"dark"}},"signedCookies":{"uid":"42"}}
//   tampered   {"cookies":{},"signedCookies":{"uid":false}}
//   unsigned   {"cookies":{"uid":"1"},"signedCookies":{}}
```

You can check the signature by hand: `crypto.createHmac('sha256', 's3cret-signing-key').update('42').digest('base64')` without the trailing `=` is `HGZcQlcrsK2YNs8SuUJKvNX34rQM0kbhhXKNY2EZyQc`. A wrong signature gives `false`, not `undefined`, so `if (req.signedCookies.uid)` treats it as "no cookie", while `=== false` tells you it was tampered with. The last line is the trap: a cookie without the `s:` prefix is not "a signed cookie that failed". It is a plain cookie, and it appears in `req.cookies.uid`. Code that reads `req.cookies.uid ?? req.signedCookies.uid` accepts the forged `1`.

**Example 3 — every `res.cookie` option and the real `Set-Cookie` header it produces.**

javascript

```
// options.cjs: one route per res.cookie() option, so each Set-Cookie header can be read on its own.
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cookieParser('s3cret-signing-key'));     // needed only for `signed`

const url = 'http://sub.example.com';
const cases = {
  plain:        [url, {}],                        // default encode = encodeURIComponent
  domain:       ['v', { domain: 'example.com' }],
  encode:       [url, { encode: String }],        // value sent as-is
  encodeSpace:  ['a b', { encode: String }],      // a space is not a legal cookie octet
  expires:      ['v', { expires: new Date(Date.UTC(2027, 0, 1)) }],
  httpOnly:     ['v', { httpOnly: true }],
  maxAge:       ['v', { maxAge: 60_000 }],        // milliseconds in, seconds out
  path:         ['v', { path: '/admin' }],
  partitioned:  ['v', { partitioned: true, secure: true, sameSite: 'none' }],
  priority:     ['v', { priority: 'high' }],
  secure:       ['v', { secure: true }],
  signed:       ['v', { signed: true }],
  sameSite:     ['v', { sameSite: 'lax' }],
  sameSiteTrue: ['v', { sameSite: true }],        // true means Strict
  object:       [{ cart: [1, 2] }, {}],           // an object value becomes "j:" + JSON
};
for (const [name, [value, opts]] of Object.entries(cases)) {
  app.get('/' + name, (req, res) => res.cookie(name, value, opts).end());
}
app.use((err, req, res, next) => res.status(500).set('X-Error', err.message).end());
app.listen(5710, () => console.log('listening on 5710'));
```

With `node options.cjs` running in another terminal:

bash

```
$ for n in plain domain encode encodeSpace expires httpOnly maxAge path partitioned priority secure signed sameSite sameSiteTrue object; do printf '%-13s ' $n; curl -s -D - -o /dev/null localhost:5710/$n | grep -i 'set-cookie\|x-error' | tr -d '\r'; done
plain         Set-Cookie: plain=http%3A%2F%2Fsub.example.com; Path=/
domain        Set-Cookie: domain=v; Domain=example.com; Path=/
encode        Set-Cookie: encode=http://sub.example.com; Path=/
encodeSpace   X-Error: argument val is invalid
expires       Set-Cookie: expires=v; Path=/; Expires=Fri, 01 Jan 2027 00:00:00 GMT
httpOnly      Set-Cookie: httpOnly=v; Path=/; HttpOnly
maxAge        Set-Cookie: maxAge=v; Max-Age=60; Path=/; Expires=Sat, 10 Oct 2026 16:07:46 GMT
path          Set-Cookie: path=v; Path=/admin
partitioned   Set-Cookie: partitioned=v; Path=/; Secure; Partitioned; SameSite=None
priority      Set-Cookie: priority=v; Path=/; Priority=High
secure        Set-Cookie: secure=v; Path=/; Secure
signed        Set-Cookie: signed=s%3Av.%2Fxv%2F3b3vM8lx1KcEavYROcS0CD2Wra9Aq3MGOYctK5c; Path=/
sameSite      Set-Cookie: sameSite=v; Path=/; SameSite=Lax
sameSiteTrue  Set-Cookie: sameSiteTrue=v; Path=/; SameSite=Strict
object        Set-Cookie: object=j%3A%7B%22cart%22%3A%5B1%2C2%5D%7D; Path=/
```

That is the full Express 5 option list, plus `sameSite: true` and an object value. Things to notice:

- `plain` has no `Domain`, so it is host-only.
- `maxAge: 60_000` became `Max-Age=60` *and* an `Expires` one minute after the request (the run was at 16:06:46 UTC).
- `encode: String` with a space threw inside `res.cookie`, and Express sent it to the error handler, so no cookie was written.
- The signed value is URL-encoded too (`s:` became `s%3A`, `/` became `%2F`).

**Example 4 — secret rotation: the first secret signs, every secret verifies.**

javascript

```
// rotate.cjs: secret rotation. Which secret signs, and which secrets can still verify?
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

function makeApp(secrets) {
  const app = express();
  app.use(cookieParser(secrets));
  app.get('/sign', (req, res) => res.cookie('uid', '42', { signed: true }).end());
  app.get('/read', (req, res) => res.json({ secretUsedToSign: req.secret, uid: req.signedCookies.uid }));
  return app;
}
const signWith = async (secrets) =>
  (await request(makeApp(secrets)).get('/sign')).headers['set-cookie'][0].split(';')[0];
const readWith = async (secrets, cookie) =>
  (await request(makeApp(secrets)).get('/read').set('Cookie', cookie)).text;

(async () => {
  const oldCookie = await signWith('old-secret');               // issued before the rotation
  const newCookie = await signWith(['new-secret', 'old-secret']); // issued after
  console.log('signed by [new, old]  ->', newCookie === await signWith('new-secret')
    ? 'same bytes as signing with new-secret' : 'different');

  console.log('[new, old] reads old cookie:', await readWith(['new-secret', 'old-secret'], oldCookie));
  console.log('[new, old] reads new cookie:', await readWith(['new-secret', 'old-secret'], newCookie));
  console.log('[old, new] signs with:      ', await readWith(['old-secret', 'new-secret'], newCookie));
  console.log('[new] only reads old cookie:', await readWith(['new-secret'], oldCookie));
})();

// Real output (Node v24.19.0, Express 5.3.0, cookie-parser 1.4.7):
//   signed by [new, old]  -> same bytes as signing with new-secret
//   [new, old] reads old cookie: {"secretUsedToSign":"new-secret","uid":"42"}
//   [new, old] reads new cookie: {"secretUsedToSign":"new-secret","uid":"42"}
//   [old, new] signs with:       {"secretUsedToSign":"old-secret","uid":"42"}
//   [new] only reads old cookie: {"secretUsedToSign":"new-secret","uid":false}
```

`req.secret` is the signing secret. Don't log it or pass it to a template.

**Example 5 — edge case: `clearCookie` with a different path leaves the cookie alive, shown with a real cookie jar.**

javascript

```
// clear.cjs: res.clearCookie() only removes the cookie whose name, path and domain match.
const express = require('express');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cookieParser());
app.get('/admin/login', (req, res) => res.cookie('token', 'abc', { path: '/admin', httpOnly: true }).send('ok\n'));
app.get('/admin/whoami', (req, res) => res.send(`token=${req.cookies.token}\n`));
app.get('/admin/logout-wrong', (req, res) => res.clearCookie('token').send('cleared?\n'));          // path defaults to "/"
app.get('/admin/logout-right', (req, res) => res.clearCookie('token', { path: '/admin', httpOnly: true }).send('cleared\n'));
app.listen(5711, () => console.log('listening on 5711'));
```

With `node clear.cjs` running, curl stores cookies in `jar.txt` (`-c`) and sends matching ones back (`-b`), like a browser does. Headers other than the status line and `Set-Cookie` are filtered out:

bash

```
$ curl -s -b jar.txt -c jar.txt -D - localhost:5711/admin/login | grep -iv '^\(x-powered\|content-\|etag\|date\|connection\|keep-alive\)' | tr -d '\r'
HTTP/1.1 200 OK
Set-Cookie: token=abc; Path=/admin; HttpOnly

ok
$ curl -s -b jar.txt -c jar.txt -D - localhost:5711/admin/logout-wrong | grep -iv '^\(x-powered\|content-\|etag\|date\|connection\|keep-alive\)' | tr -d '\r'
HTTP/1.1 200 OK
Set-Cookie: token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT

cleared?
$ curl -s -b jar.txt -c jar.txt -D - localhost:5711/admin/whoami | grep -iv '^\(x-powered\|content-\|etag\|date\|connection\|keep-alive\)' | tr -d '\r'
HTTP/1.1 200 OK

token=abc
$ grep token jar.txt
#HttpOnly_localhost	FALSE	/admin	FALSE	0	token	abc
$ curl -s -b jar.txt -c jar.txt -D - localhost:5711/admin/logout-right | grep -iv '^\(x-powered\|content-\|etag\|date\|connection\|keep-alive\)' | tr -d '\r'
HTTP/1.1 200 OK
Set-Cookie: token=; Path=/admin; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly

cleared
$ curl -s -b jar.txt -c jar.txt -D - localhost:5711/admin/whoami | grep -iv '^\(x-powered\|content-\|etag\|date\|connection\|keep-alive\)' | tr -d '\r'
HTTP/1.1 200 OK

token=undefined
$ grep -c token jar.txt
0
```

The wrong logout answered 200 and sent a perfectly valid expired cookie, but for the key (token, localhost, `/`). Nothing was stored under that key, so nothing was deleted, and the `/admin` cookie kept working. The jar line shows the stored key: domain `localhost` (host-only, `FALSE` in the second column), path `/admin`, expiry `0` (a session cookie). Only the clear with `path: '/admin'` removed it. If you set `domain`, you must pass the same `domain` when clearing, for the same reason.

**Example 6 — Express 4 vs 5: `clearCookie` with the original `maxAge`.**

javascript

```
// clear45.cjs: res.clearCookie('sid', { maxAge }) in Express 4 vs Express 5.
const request = require('supertest');

async function run(pkg) {
  const express = require(pkg);
  const app = express();
  // A common pattern: reuse the options object you used to set the cookie.
  const cookieOpts = { path: '/', httpOnly: true, maxAge: 86_400_000 };
  app.get('/logout', (req, res) => res.clearCookie('sid', cookieOpts).end());
  const res = await request(app).get('/logout');
  console.log(`${pkg} ${require(pkg + '/package.json').version}:`, res.headers['set-cookie'][0]);
}

(async () => {
  await run('express4');   // npm install express4@npm:express@4
  await run('express');
})();

// Real output (Node v24.19.0, Express 4.22.3 and 5.3.0):
//   express4 4.22.3: sid=; Max-Age=86400; Path=/; Expires=Sun, 11 Oct 2026 16:07:38 GMT; HttpOnly
//   express 5.3.0: sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly
//   (stderr, Express 4) Sat, 10 Oct 2026 16:07:38 GMT express deprecated res.clearCookie: Passing "options.maxAge" is deprecated. In v5.0.0 of Express, this option will be ignored, as res.clearCookie will automatically set cookies to expire immediately. Please update your code to omit this option. at clear45.cjs:9:40
```

On Express 4.22.3, this "logout" replaced the cookie with an empty one that lives for another 24 hours. The user is logged out only if your code treats an empty value as "no cookie". Express 5 ignores `maxAge` and `expires` in `clearCookie`, so reusing the options object is safe there. When you migrate (lesson [94](61-express-4-to-5-migration-guide.md)), search for `clearCookie(` calls that pass lifetime options. Their behaviour changes.

**Example 7 — how the session cookie relates: express-session's cookie is a signed cookie holding only an id.**

javascript

```
// session-link.cjs: express-session's cookie is an ordinary signed cookie that holds only an id.
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const secret = 'one-secret-for-both';
const app = express();
app.use(session({ secret, resave: false, saveUninitialized: false, cookie: { httpOnly: true } }));
app.use(cookieParser(secret));                      // only to look inside the cookie; sessions don't need it
app.get('/login', (req, res) => { req.session.userId = 42; res.end(); });
app.get('/peek', (req, res) => res.json({
  idLength: req.sessionID.length,
  signedCookieIsSessionID: req.signedCookies['connect.sid'] === req.sessionID, // same HMAC scheme as signed: true
  userIdInCookie: String(req.cookies['connect.sid']).includes('42'),
  userIdInSession: req.session.userId,
}));

(async () => {
  const login = await request(app).get('/login');
  const cookie = login.headers['set-cookie'][0];
  console.log(cookie.replace(/s%3A[^.;]+\.[^;]+/, 's%3A<id>.<hmac>'));
  console.log((await request(app).get('/peek').set('Cookie', cookie.split(';')[0])).body);
})();

// Real output (Node v24.19.0, Express 5.3.0, express-session 1.19.0, cookie-parser 1.4.7):
//   connect.sid=s%3A<id>.<hmac>; Path=/; HttpOnly
//   {
//     idLength: 32,
//     signedCookieIsSessionID: true,
//     userIdInCookie: false,
//     userIdInSession: 42
//   }
```

cookie-parser, given the same secret, unsigned `connect.sid` into exactly `req.sessionID`. The user id is not in the cookie (`req.cookies['connect.sid']` is `undefined` here, because cookie-parser moved the signed cookie into `req.signedCookies`); it lives in the session store. Everything about stores, `regenerate()` and `destroy()` is in lesson [50](84-sessions-cookies.md).

## Common mistakes & gotchas

- **Reading `req.cookies` with no parser.** Express has no `req.cookies`; it is `undefined` until `cookie-parser` runs (Example 1).
- **Reading a signed cookie from `req.cookies`.** Signed cookies are moved to `req.signedCookies`. A same-named cookie in `req.cookies` is an unsigned one the client made up (Example 2).
- **Treating `false` like "missing".** `req.signedCookies.x === false` means the signature did not match. Log it if you want to spot tampering.
- **Expecting signing to hide the value.** `s:42.<hmac>` shows `42` to anyone who looks. Signing only detects changes.
- **Clearing with a different `path` or `domain`.** The client keeps the original (Example 5). The response still says 200, so nothing tells you it failed.
- **Passing `maxAge`/`expires` to `clearCookie` on Express 4.** The "cleared" cookie lives on (Example 6). Express 5 ignores them.
- **A custom `encode` that produces illegal characters.** `serialize` throws `argument val is invalid` and the response becomes an error (Example 3).
- **Rotating secrets in the wrong order.** `[old, new]` keeps signing with the old secret (Example 4). Removing the old secret too early turns every existing signed cookie into `false`.
- **`sameSite: 'none'` or `partitioned` without `secure`.** Express sends what you ask for, but MDN documents that both require `Secure`.
- **Assuming `maxAge` is seconds.** `res.cookie` takes milliseconds and writes seconds. `maxAge: 3600` is 3.6 seconds (`Max-Age=3`).
- **Trusting the Express docs' note that object cookies are "parsed by bodyParser()".** It is cookie-parser that decodes `j:` values (`JSONCookies`), not a body parser.

## Best practices

- **Mount `cookieParser(secrets)` once, early,** and read cookies only after it.
- **Sign any cookie whose value you act on** (user id, plan, role, bucket). Better still, keep the value on the server and put only a random id in the cookie (a session).
- **Use `HttpOnly`, `Secure` and an explicit `SameSite`** on anything security-relevant. Lesson [50](84-sessions-cookies.md) explains why each one matters.
- **Keep one options object per cookie** and pass it, minus `maxAge`/`expires`, to `clearCookie`. Then path and domain always match.
- **Leave `domain` unset** unless subdomains really need the cookie. Host-only is the narrower scope.
- **Rotate secrets as `[new, old]`,** keep `old` for the longest cookie lifetime, then drop it. Load them from configuration, not source code.
- **Keep cookies small.** Every matching request carries every matching cookie in its `Cookie` header.
- **Test with a real cookie jar** (`curl -c/-b`, or supertest's `agent()`), not just by reading `Set-Cookie`. That is the only way to catch path and domain mistakes.

## ⭐ Interview lens

> **Q: “What does `res.cookie('uid', '42', { signed: true, maxAge: 60000 })` actually send?”**  
> A: One `Set-Cookie` header line: `uid=s%3A42.<HMAC-SHA256 base64>; Max-Age=60; Path=/; Expires=<now + 60 s>`. Express converts `maxAge` from milliseconds to seconds, sends both `Max-Age` and `Expires`, defaults `Path` to `/`, and signs with `req.secret`, the first secret given to cookie-parser. The value is URL-encoded, so `s:` appears as `s%3A`. *Trap:* without `cookieParser(secret)` it throws.

> **Q: “A user edits their signed cookie. What does your route see?”**  
> A: cookie-parser checks the HMAC against each secret. None match, so `req.signedCookies.uid` is `false`, and the cookie is removed from `req.cookies`. If the user removes the `s:` prefix entirely, it is a plain cookie and shows up in `req.cookies.uid`. That is why you read only `req.signedCookies` for signed values. *Trap:* signing is not encryption; the value is readable.

> **Q: “Logout calls `res.clearCookie('token')` but the user stays logged in. Why?”**  
> A: The client identifies a cookie by name, domain and path. If `token` was set with `path: '/admin'` or a `domain`, a clear with the default `Path=/` and no `Domain` targets a different cookie, so the original survives. Pass the same `path` and `domain`. On Express 4 there is a second cause: passing the original `maxAge` makes the clear set a cookie that lives on. Express 5 ignores `maxAge` and `expires` there.

> **Q: “How do you rotate the cookie-signing secret without logging everyone out?”**  
> A: Use `cookieParser(['new', 'old'])`. The first secret signs and all of them are tried for verification, so old cookies keep working while new ones get the new signature. Remove `'old'` after the longest cookie lifetime has passed. Order matters: `['old', 'new']` keeps signing with the old secret.

## Cheat-card

- **Write:** `res.cookie(name, value, opts)` → one `Set-Cookie` line; objects become `j:` + JSON; `signed` → `s:` + value + `.` + HMAC-SHA256 (base64, no `=`).
- **Options (Express 5 docs):** `domain`, `encode`, `expires`, `httpOnly`, `maxAge` (ms → `Max-Age` s + `Expires`), `path` (default `/`), `partitioned`, `priority`, `secure`, `signed`, `sameSite` (`true` = Strict).
- **Read:** `cookie-parser` 1.4.7 → `req.cookies` (plain + `j:` decoded) and `req.signedCookies` (verified; `false` = bad signature). No parser → no `req.cookies`.
- **Secrets:** `cookieParser([new, old])`: `secrets[0]` signs (`req.secret`), all verify, in order.
- **Clear:** `res.clearCookie(name, { path, domain })` must match name + domain + path. Express 5 ignores `maxAge`/`expires` there (changed in v5.0.0); Express 4 honoured them.
- **Host-only:** no `domain` → no `Domain` attribute → exact host only.
- **Illegal value:** custom `encode` producing a space → `argument val is invalid`.
- **Sessions:** express-session's `connect.sid` is the same signed-cookie format with only an id; see lesson 84.

---

## Learn More

- [Express 5.x response API (res.cookie, res.clearCookie) expressjs.com](https://expressjs.com/en/5x/api/response)
- [cookie-parser middleware expressjs.com](https://expressjs.com/en/resources/middleware/cookie-parser.html)
- [cookie-parser repository github.com](https://github.com/expressjs/cookie-parser)
- [cookie (serialize and parse) repository github.com](https://github.com/jshttp/cookie)
- [Moving to Express 5 (res.clearCookie) expressjs.com](https://expressjs.com/en/guide/migrating-5.html)
- [Set-Cookie header developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Using HTTP cookies developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [Cookies Having Independent Partitioned State (CHIPS) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Privacy_sandbox/Partitioned_cookies)
- [RFC 6265 HTTP State Management Mechanism rfc-editor.org](https://www.rfc-editor.org/rfc/rfc6265.html)
- [Cookie Priority Attribute (draft-west-cookie-priority-00) datatracker.ietf.org](https://datatracker.ietf.org/doc/html/draft-west-cookie-priority-00)
