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

## Say it in 30 seconds

A cookie is a name and a value the server asks the browser to store and send back on later requests. Express writes that with `res.cookie`, which adds one Set-Cookie header, and `res.clearCookie` asks the browser to drop it. The cookie-parser package reads the Cookie header into `req.cookies`, and into `req.signedCookies` when you give it a secret. You use this for preferences, a "remember this device" token, or a short-lived step in a flow. The trade-off is that the browser only deletes a cookie when the name, the domain, and the path all match, and a signed cookie can still be read by the client. Signing detects edits. It does not hide the value.

## Why it matters

Lesson 84 explains what the cookie flags defend against, and how `express-session` keeps state on the server. This lesson is the layer under that. Express writes `Set-Cookie` with `res.cookie` and `res.clearCookie`. The `cookie-parser` middleware reads the `Cookie` header back. You use them directly for preference cookies, "remember this device" tokens, CSRF double-submit tokens, A/B buckets, and short-lived flow state. `express-session` builds its cookie with the same machinery.

The bugs show up when the details are skipped.

- **Logout that does not log out.** `res.clearCookie('token')` sends `Path=/`. If the cookie was set with `Path=/admin`, the browser keeps it. Example 5 shows it.
- **An Express 4 "clear" that sets a 24-hour cookie.** Reusing the original options, including `maxAge`, makes `clearCookie` send an empty cookie with `Max-Age=86400` on Express 4. Express 5 ignores `maxAge` and `expires` in `clearCookie`. Example 6 shows it.
- **Trusting a cookie the user edited.** A plain cookie is text the client sends. A signed cookie detects edits, but only if you read `req.signedCookies` and treat `false` as tampered. Example 2 shows it.
- **Rotating the signing secret logs everybody out**, unless you know cookie-parser signs with the first secret and verifies with all of them. Example 4 shows it.

## The concept, simply

A cookie is a name=value pair the server asks the client to store and send back. The server sends one `Set-Cookie` response header per cookie: the pair, then attributes such as `Path`, `Domain`, `Expires`, `Max-Age`, `HttpOnly`, `Secure`, `SameSite`, `Partitioned`, and `Priority`. The client keeps a cookie jar. On a later request it sends the cookies whose domain, path, `Secure`, and `SameSite` rules match, all in one `Cookie` header, as name=value pairs only. The attributes never come back.

In Express, `res.cookie(name, value, options)` builds one `Set-Cookie` line and appends it. It is built in. It calls the `cookie` package's `serialize`. The version here is cookie 0.7.2. `res.clearCookie(name, options)` sends the same name with an empty value and `Expires` set to `Thu, 01 Jan 1970 00:00:00 GMT`. The client deletes a cookie only when the new line matches the stored name, domain, and path. `cookie-parser`, version 1.4.7 here, parses the `Cookie` header into `req.cookies`. With a secret it also verifies signed cookies and moves them to `req.signedCookies`. Express itself has no `req.cookies`. Example 1 shows that.

A signed cookie is the prefix `s:`, the value, a dot, and an HMAC-SHA256 of the value keyed by your secret. The HMAC is base64 with the `=` padding removed. That is the `cookie-signature` package. The client can still read the value. It is not encrypted. The client cannot change it without the secret. If the client must not see the value, keep it on the server in a session.

The cycle looks like this. No SVG in the kit shows it. `i47_01` is about server-side session lookup.

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

What `res.cookie('uid', '42', { signed: true, maxAge: 60000 })` does in Express 5.3.0, in `lib/response.js`:

1. Copy the options so your object is not modified.
2. With `signed: true` and no `req.secret`, which `cookieParser(secret)` sets, throw `cookieParser("secret") required for signed cookies`.
3. Turn the value into a string. An object becomes `'j:'` plus `JSON.stringify`. Anything else goes through `String()`.
4. If `signed`, the value becomes `'s:'` plus `sign(value, req.secret)`, which looks like `s:42.<base64 HMAC-SHA256>`.
5. Convert `maxAge`. Express takes milliseconds, sets `expires` to now plus that many milliseconds, and sets `maxAge` to `Math.floor(maxAge / 1000)`, so both `Max-Age` in seconds and `Expires` are sent.
6. Default the path to `/` when you gave none.
7. `cookie.serialize` encodes the value with `encodeURIComponent` unless you pass `encode`. The result must be legal cookie characters, or serialize throws `argument val is invalid`. `res.append('Set-Cookie', ...)` adds a new header line, so several `res.cookie` calls give several lines.

What `cookieParser(secret)` does on each request:

1. A string secret becomes a one-element array. An array is used as given. `req.secret` is `secrets[0]`, and that is what `res.cookie` signs with.
2. `cookie.parse` splits the header on `;` and `=` and URL-decodes each value. If the same name appears twice, the first one is kept.
3. Each value that starts with `s:` is checked against every secret, in order. The first match gives the original value. No match gives `false`. Signed cookies are removed from `req.cookies` and put in `req.signedCookies`.
4. Values that start with `j:` are `JSON.parse`d, in both objects. A `j:` value that is not valid JSON is left as the raw string.

**Every `res.cookie` option.** This is the Express 5 response API list, checked against what cookie 0.7.2 serializes. Example 3 prints the real header for each.

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

**Clearing.** The client identifies a stored cookie by name, domain, and path. `res.clearCookie` sets path `/` unless you override it, forces `expires` to a date of 1 millisecond, deletes `maxAge`, and calls `res.cookie`. To delete a cookie you must pass the same `path` and `domain` it was set with. `httpOnly`, `secure`, and `sameSite` do not identify the cookie, but passing the same options minus the lifetime is the safe habit. On Express 4.22.3, `clearCookie` merged your options on top of the expired date, so your `maxAge` or `expires` won, and Express printed a deprecation warning. Express 5 forces the 1970 date and drops `maxAge`. That changed in v5.0.0.

**Secret rotation.** `cookieParser(['new', 'old'])` signs new cookies with `'new'`, because `req.secret` is `secrets[0]`, and accepts cookies signed with either. Put the new secret first and keep the old one for as long as old cookies can live, their longest `maxAge`, then remove it. Putting the new secret second keeps signing with the old one. Example 4 shows that.

**Sessions.** `express-session` writes its cookie, `connect.sid` by default, with the same serializer and the same `s:` plus HMAC. The cookie holds only the session id. The data stays in the store. Since express-session 1.5.0 it parses cookies itself, so it does not need cookie-parser. If you use both, give them the same secret. Lesson 84 covers stores, fixation, and logout. Example 7 shows the cookie it sends.

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

- **Reading `req.cookies` with no parser.** Express has no `req.cookies`. It is `undefined` until cookie-parser runs. Example 1 shows it.
- **Reading a signed cookie from `req.cookies`.** Signed cookies move to `req.signedCookies`. A same-named value still in `req.cookies` is an unsigned cookie the client made up. Example 2 shows it.
- **Treating `false` like "missing".** `req.signedCookies.x === false` means the signature did not match.
- **Expecting signing to hide the value.** `s:42.<hmac>` shows `42` to anyone who looks. Signing only detects changes.
- **Clearing with a different `path` or `domain`.** The client keeps the original. Example 5 shows it. The response can still be 200.
- **Passing `maxAge` or `expires` to `clearCookie` on Express 4.** The cleared cookie lives on. Example 6 shows a 24-hour empty cookie, `Max-Age=86400`. Express 5 ignores those two options.
- **A custom `encode` that produces illegal characters.** `serialize` throws `argument val is invalid`, and the response becomes an error. Example 3 shows a space.
- **Rotating secrets in the wrong order.** `['old', 'new']` keeps signing with the old secret. Removing the old secret too early turns every existing signed cookie into `false`.
- **`sameSite: 'none'` or `partitioned` without `secure`.** Express sends what you ask. Both are documented to require `Secure`.
- **Assuming `maxAge` is seconds.** `res.cookie` takes milliseconds and writes seconds. `maxAge: 3600` is 3.6 seconds, so `Max-Age=3`.
- **Trusting a docs note that object cookies are parsed by bodyParser.** cookie-parser decodes `j:` values. A body parser does not.

## Best practices

- Mount `cookieParser(secrets)` once, early, and read cookies only after it.
- Sign any cookie whose value you act on, such as a user id, a plan, or a role. Better, keep the value on the server and put only a random id in the cookie.
- Use `HttpOnly`, `Secure`, and an explicit `SameSite` on anything that matters for security. Lesson 84 explains each flag.
- Keep one options object per cookie, and pass it to `clearCookie` without `maxAge` and `expires`, so path and domain match.
- Leave `domain` unset unless subdomains really need the cookie. Host-only is the narrower scope.
- Rotate secrets as `['new', 'old']`. Keep `old` for the longest cookie lifetime, then drop it. Load the secrets from configuration, not from source.
- Keep cookies small. Every matching request carries every matching cookie.
- Test with a real cookie jar, `curl -c` and `-b`, or supertest's `agent()`. Reading `Set-Cookie` alone misses a path or domain mistake.

## ⭐ Interview lens

> **Q: “What does `res.cookie('uid', '42', { signed: true, maxAge: 60000 })` actually send?”**  
> A: It sends one `Set-Cookie` line. The value is signed and then URL-encoded, so it looks like `uid=s%3A42.<HMAC-SHA256 in base64>; Max-Age=60; Path=/; Expires=<now plus 60 seconds>`. Express copies your options, requires `req.secret` from `cookieParser(secret)`, turns the value into `s:` plus the value plus a dot plus the HMAC, converts `maxAge` from milliseconds to seconds, and also sends `Expires` at now plus that delay. Path defaults to `/` when you omit it. The HMAC is base64 with the padding `=` removed, from the cookie-signature package. The trap is a missing parser. `signed: true` with no `req.secret` throws `cookieParser("secret") required for signed cookies`. Signing does not encrypt. Anyone who looks can read `42`.

> **Q: “A user edits their signed cookie. What does your route see?”**  
> A: cookie-parser checks the HMAC against each secret you gave it. If none match, `req.signedCookies.uid` is `false`, not `undefined`, and the cookie is removed from `req.cookies`. `false` means tampered. A missing cookie is just absent. If the user strips the `s:` prefix entirely, it is no longer a signed cookie. It shows up as a plain value in `req.cookies.uid`. That is why code that does `req.cookies.uid ?? req.signedCookies.uid` accepts a forged `1`. Read only `req.signedCookies` for a value you signed. The limit of signing is that it is not encryption. The value sits in the cookie in the clear, and the signature only detects a change.

> **Q: “Logout calls `res.clearCookie('token')` but the user stays logged in. Why?”**  
> A: The browser identifies a stored cookie by name, domain, and path. `res.clearCookie('token')` with no options sends an empty value, `Path=/`, and `Expires` in 1970. If `token` was set with `path: '/admin'` or a `domain`, that clear targets a different cookie, the original stays, and your handler can still return 200. Pass the same `path` and `domain`. On Express 4 there is a second cause. `clearCookie` merged your options on top of the expired date, so passing the original `maxAge` set an empty cookie that lives on. Example 6 shows `Max-Age=86400`, a day, from a 24-hour `maxAge`. Express 5 ignores `maxAge` and `expires` inside `clearCookie` and forces the 1970 date.

> **Q: “How do you rotate the cookie-signing secret without logging everyone out?”**  
> A: Pass an array to cookie-parser, new secret first: `cookieParser(['new', 'old'])`. `req.secret` is the first secret, and that is what `res.cookie` signs with. Verification tries every secret in order, so a cookie signed with `old` still parses while new cookies get the new signature. Keep `old` until the longest `maxAge` you issued has passed, then remove it. Order matters. `['old', 'new']` keeps signing with the old secret, so you never rotate. Do not log `req.secret` or pass it to a template. Removing the old secret too early turns every existing signed cookie into `false`, which looks like tampering and logs people out.

## Cheat-card

- `res.cookie(name, value, opts)` writes one `Set-Cookie` line. An object becomes `j:` plus JSON. `signed` becomes `s:` plus the value plus a dot plus HMAC-SHA256, base64, with no `=`.
- Options: `domain`, `encode`, `expires`, `httpOnly`, `maxAge` in milliseconds which becomes `Max-Age` in seconds plus `Expires`, `path` default `/`, `partitioned`, `priority`, `secure`, `signed`, and `sameSite` where `true` means Strict.
- cookie-parser 1.4.7 fills `req.cookies` for plain values, with `j:` decoded, and `req.signedCookies` for verified ones. `false` means a bad signature. No parser means no `req.cookies`.
- `cookieParser([new, old])`: the first secret signs, and every secret verifies, in order.
- `res.clearCookie(name, { path, domain })` must match name, domain, and path. Express 5 ignores `maxAge` and `expires` there, changed in v5.0.0. Express 4 honored them.
- No `domain` attribute means host-only, the exact host.
- A custom `encode` that produces a space throws `argument val is invalid`.
- express-session's `connect.sid` is the same signed-cookie format and holds only an id. Lesson 84 covers the store.

## Good to know

- `priority` sends `Priority=Low`, `Medium`, or `High`, from an expired IETF draft, draft-west-cookie-priority-00. Clients may ignore it.
- `partitioned` sends `Partitioned`, for CHIPS, a cookie stored separately per top-level site. It is documented to require `Secure`, and so is `SameSite=None`.
- cookie 0.7.2 serializes. cookie-parser 1.4.7 parses. express-session has parsed its own cookie since 1.5.0 and does not need cookie-parser, but if you use both, use the same secret.

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
