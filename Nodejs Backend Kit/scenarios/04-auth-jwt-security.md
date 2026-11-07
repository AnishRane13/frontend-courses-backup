# 04. Authentication, JWT and security basics

> **Remember this**
> 1. For a browser app, keep the login on the server and give the browser only a random id in a cookie that scripts cannot read. A phone app sends a short-lived token in a header instead.
> 2. Access tokens last minutes. Refresh tokens are stored as hashes, swapped for a new one on every use, and if an old one comes back, its whole family is cancelled.
> 3. Store passwords with a slow, salted hash and compare in constant time. For an unknown email, still check a dummy hash, so both failures take the same time.
> 4. Rate limit login per account and per IP address. A hard lockout lets an attacker lock out the real user.
> 5. CORS only decides which sites may read a response. It does not stop a forged request, so cookie routes also need an origin check or a CSRF token.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Session | A record on the server that says "this visitor is logged in as this user". The browser holds only its random id. |
| Cookie | A small value the browser stores and sends back to the same site on every request, without any code asking for it. |
| HttpOnly | A cookie flag that hides the cookie from page scripts, so injected script cannot steal it. |
| Secure cookie | A cookie the browser only sends over HTTPS. |
| SameSite | A cookie setting that tells the browser whether to send the cookie on requests that start on another site. |
| JWT | A JSON Web Token: a signed piece of data, such as a user id and an expiry time, that a server can check without a database lookup. |
| Access token | A short-lived token sent with each API call to prove who the caller is. |
| Refresh token | A longer-lived token used only to get a new access token. The server keeps a record of it, so it can be cancelled. |
| Rotation | Giving out a new refresh token every time one is used, and marking the old one as used. |
| Token family | All the refresh tokens that came from one login, one after another through rotation. |
| Denylist | A short list of token ids the server must reject, even though their signature is still valid. |
| Hashing | Turning a value into a fixed-length fingerprint that cannot be turned back into the original. |
| Salt | A random value stored next to each password hash, so two users with the same password get different hashes. |
| Slow password hash | A hash function built to be expensive, such as scrypt, bcrypt or Argon2, so guessing millions of passwords takes too long. |
| Timing attack | Learning a secret by measuring how long the server takes to answer. |
| Constant-time compare | A comparison that always checks every byte, so its duration says nothing about how much matched. |
| Rate limit | A cap on how many requests a key, such as an account or an IP address, may make in a time window. |
| Password spraying | Trying one common password against many accounts, so no single account sees many failures. |
| XSS | Cross-site scripting: an attacker gets their own script to run inside your page. |
| CSRF | Cross-site request forgery: another site makes the user's browser send a request to your API, and the browser attaches your cookie. |
| CORS | Browser rules that decide which other sites may read your API's responses. |
| Content security policy | A response header that tells the browser which scripts and sources a page may load and run. |

| # | Scenario | Tag |
|---|---|---|
| S1 | [Login for a web app and a mobile app: sessions or tokens](#s1-login-for-a-web-app-and-a-mobile-app-sessions-or-tokens) | Must know |
| S2 | [A JWT leaked: short access tokens and refresh rotation](#s2-a-jwt-leaked-short-access-tokens-and-refresh-rotation) | Must know |
| S3 | [Storing passwords and stopping brute force on login](#s3-storing-passwords-and-stopping-brute-force-on-login) | Must know |
| S4 | [Security review of a cookie-authenticated API](#s4-security-review-of-a-cookie-authenticated-api) | Likely |

---

## S1. Login for a web app and a mobile app: sessions or tokens
**Tag: Must know**

### Before you speak
- **Today:** there is no login yet. The team has to choose between server sessions and JWTs, and the same API serves a browser app and a phone app.
- **Sessions in plain words:** the server keeps a row that says "this id belongs to this user". The browser only holds the random id in a cookie. Logout deletes the row, so it works at once.
- **JWTs in plain words:** the server signs a token holding the user id and an expiry time. Any server can check the signature without a database. The catch is that you cannot take a signed token back before it expires.
- **Why pick per client:** a browser stores and sends cookies by itself and can hide them from scripts. A native phone app has no browser cookie store, so it sends a token in the authorization header and keeps a refresh token in the phone's secure storage.
- **The admin logout rule:** "log out everywhere now" needs something on the server you can delete. Sessions give that directly. For the phone, a short access token plus a refresh token you can delete gives it within minutes.
- **The trade-off to mention:** sessions need a shared store and a lookup on every request. Tokens skip the lookup but stay valid until they expire.
- **Session fixation:** an attacker plants a session id they know before the user logs in. Creating a fresh id at login stops it.

### Scenario
"Our SaaS dashboard needs login for a web app and a new mobile app, both calling the same Node API. Admins must be able to log a user out of everything at once. Would you use sessions or JWTs, and how would you set it up?"

### Questions to ask back
- **Are the web app and the API on the same site?** If yes, a normal first-party cookie is simple. If not, the cookie must be sent cross-site, which needs extra CORS setup and makes forged requests easier.
- **How fast must a forced logout work?** "Instantly" means a server check on every request. "Within a few minutes" allows short tokens that need no lookup.
- **How many API servers run?** With more than one, sessions must live in a shared store, not in one server's memory.
- **Will other services check the user's identity too?** If yes, signed tokens fit better, because each service can check them without calling a session store.

### Spoken answer
> I would pick per client, not one answer for everything. For the web app, I would use a server session. The browser holds only a random id in a cookie that scripts cannot read, sent only over HTTPS, with an explicit same site setting. I create a fresh id at login, and logout deletes the server record, so it takes effect at once. The mobile app has no browser cookie jar, so it gets a short access token in the authorization header, plus a refresh token in the phone's secure storage. Both paths share one password check and one user table. Sessions need a shared store across servers. Tokens skip the lookup but stay valid until they expire. The trade off is instant logout and simplicity for sessions, against checks with no lookup and native app support for tokens.

### Say it in 5 beats
1. Choose per client, not one answer.
2. Web: session id in a locked-down cookie.
3. New id at login, delete at logout.
4. Mobile: short token, refresh in secure storage.
5. Trade-off: instant logout versus no lookup.

### Case variations
- **"We run six API instances behind a load balancer."**
  > Then sessions must live in a shared store, usually Redis, so every instance sees the same session. Otherwise a user logs in on one instance and looks logged out on the next. The default in-memory store is only for development.
- **"Can't we just use JWTs everywhere? It's simpler."**
  > It is simpler until an admin needs to log someone out right now. A JWT stays valid until it expires, and nothing on the server can cancel it. So I would need short tokens plus a refresh token I can delete, and that is server state again.
- **"Our web app lives on a different domain from the API."**
  > Then the cookie is sent cross-site, so it needs SameSite None and Secure. CORS must name the exact web origin and allow credentials. Because the browser now sends the cookie from other sites too, I add an origin check or a CSRF token on every route that changes data.
- **"We add Sign in with Google."**
  > Google proves who the user is, through a standard called OpenID Connect. After that I still create my own session or tokens. I link the user by Google's own user id, called the subject, not by email alone, because emails can change.

Unverified: no Redis on this machine, so the script uses the default memory store; the shared-store claim is not run.

### Follow-up questions
- **Where should a browser keep a JWT if you use one?** In an HttpOnly, Secure cookie, not in localStorage, the browser storage any script on the page can read. One injected script could copy a token from localStorage. The cookie then needs CSRF protection, because the browser sends it automatically.
- **Why create a new session id at login?** Otherwise an attacker who planted a known id before login would share the logged-in session after it. That attack is called session fixation.
- **Why does a Secure cookie stop being sent behind a load balancer?** HTTPS ends at the proxy, so Express sees a plain HTTP request and refuses to set a Secure cookie. Setting trust proxy to the number of proxies in front tells Express to believe the proxy's "this was HTTPS" header.
- **Optional: senior. How do you check a JWT safely across several services?** Fix the list of allowed signing algorithms, and check the expiry, the issuer, meaning who made the token, and the audience, meaning who it is for. A token made for the billing service must then fail at the mobile API. I also prefer a key pair, so services can check tokens with the public key but cannot create them.

### Common wrong answers and red flags
- "JWTs are more secure than sessions." They are a different trade-off, and cancelling them is harder.
- Keeping the token in localStorage in a browser app, where any injected script can read it.
- Shipping the default in-memory session store to production.
- Calling SameSite Lax "the browser default". Only Chrome and Edge behave that way, not every browser, so always set it explicitly.
- Checking a token's algorithm and issuer but not its audience, so a token made for another service is accepted.
- Clearing the cookie on logout but leaving the session record on the server, so a copied cookie still works.

### Numbers to quote
No figures needed.

### Code sketch
```js
// app is an Express app, session is express-session, sharedStore is a session store, findUser checks the password as in S3
app.set('trust proxy', 1);                       // TLS ends at the proxy, so Secure cookies still work
app.use(session({ name: 'sid', secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  store: sharedStore,                            // production: a shared store; memory store only in tests
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 8 * 3600e3 } }));
app.post('/login', express.json(), async (req, res, next) => {
  const user = await findUser(req.body?.email, req.body?.password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  req.session.regenerate((err) => {              // new id at login defeats session fixation
    if (err) return next(err);
    req.session.userId = user.id;
    res.json({ ok: true });
  });
});
```

```js
// jwt is jsonwebtoken, user is the logged-in user, token comes from the Authorization header
const accessToken = jwt.sign({ sub: user.id }, process.env.ACCESS_SECRET,
  { algorithm: 'HS256', expiresIn: '15m', issuer: 'api', audience: 'mobile' });
const claims = jwt.verify(token, process.env.ACCESS_SECRET,
  { algorithms: ['HS256'], issuer: 'api', audience: 'mobile' });   // pin alg, check iss and aud
```

Verified by [code/auth/verify-s1.mjs](code/auth/verify-s1.mjs)

### Source
Lessons 82, 83, 84, 57.

---

## S2. A JWT leaked: short access tokens and refresh rotation
**Tag: Must know**

### Before you speak
- **Today:** the app gives out one token that lasts thirty days, and the server keeps no record of it. Logout only deletes it on the device.
- **What goes wrong:** a leaked token works for anyone until it expires. With thirty days and nothing on the server to cancel it, the leak lasts up to a month.
- **The fix, part one:** make access tokens last minutes. A leak then has a small window. To avoid logging users in every few minutes, add a refresh token that gets new access tokens.
- **The fix, part two:** the refresh token lives longer, so the server keeps a record of it, stored only as a hash. Every use swaps it for a new one, which is called rotation.
- **Why rotation catches theft:** each refresh token works once. If a used one comes back, two parties hold it, the real user and a thief. The server cannot tell which is which, so it cancels the whole token family, meaning every token from that login, and asks the user to log in again.
- **The trade-off to mention:** a database write on every refresh. Also, an honest app that refreshes twice at the same moment can look like theft and get logged out.

### Scenario
"A customer's access token from our chat app showed up in a public bug report with full logs. Our tokens currently last thirty days and we have no logout on the server. How would you limit the damage now, and redesign so a leaked token matters less?"

### Questions to ask back
- **What does the token contain, and how long has it been public?** That decides whether I must change the signing key for everyone, or can cancel just this user's tokens.
- **Is there any server state today?** If not, the only instant fix is changing the signing secret, which logs everyone out.
- **Which apps refresh, and can several refresh at once?** Several tabs or devices refreshing together changes how strict rotation can be.
- **Do we log tokens anywhere else?** How the token leaked matters as much as the token. Logs must hide the authorization header.

### Spoken answer
> If a token leaks, the damage depends on how long it lives, so I keep access tokens to minutes. They are checked without a database, so a leaked one works until it expires, unless I add its token id to a small denylist. The refresh token is the long lived one, so it lives on the server. I store only its hash, like a password, so a database leak gives nothing usable. Every refresh rotates it. The old one is marked used and a new one joins the same family. If a used token ever comes back, either the thief or the real user is replaying it, so I revoke the whole family and force a new login. The trade off is a database write on every refresh, and honest clients that refresh twice at once can be logged out.

### Say it in 5 beats
1. Damage equals token lifetime.
2. Access tokens last minutes.
3. Refresh tokens stored hashed, on the server.
4. Rotate; reuse cancels the whole family.
5. Trade-off: writes, and false theft alarms.

### Case variations
- **"Right now, today, with thirty-day tokens and no state."**
  > The only instant lever is changing the signing secret, which logs everyone out. If that is too harsh, I put that one token's id on a short denylist until it expires. Then I ship the short-token design as the real fix.
- **"Two browser tabs refresh at the same moment."**
  > With strict rotation, the second refresh looks like reuse and kills the session. I make the app refresh through one shared call, so only one request goes out. Or I allow a few seconds of grace, where the token that was just used returns the same new token.
- **"An admin demotes a user, but their token still says admin."**
  > The role inside a token is a copy, and it stays old until the token expires. For sensitive actions I check the role in the database. Another option is a version number on the user, bumped on every change, so tokens with an older version are rejected.
- **"The refresh token itself is stolen from the device."**
  > Rotation cannot stop the thief's first use. But as soon as both the thief and the real user have used it, the second use looks like reuse, and the whole family is cancelled. Tying tokens to a key that only the device holds goes further.

Unverified: a denylist shared across instances needs a store like Redis, which is not on this machine; the script uses an in-process set.

### Follow-up questions
- **Why hash a refresh token but not an access token?** The refresh token lives long and sits in your database, so a database leak would hand out working tokens. A fast hash such as SHA-256 is enough here, because the token is long and random. Passwords need a slow hash only because people pick guessable ones.
- **What goes in the denylist?** The token id claim, a unique id written into each token, often called the jti. The server must actually put that id into the token when it signs it, or the denylist never matches.
- **How do you make the refresh step safe when two requests arrive together?** Read the token row with a row lock inside a transaction, so the second request waits for the first. Exactly one of them wins.
- **Optional: senior. How would you change the signing key without logging everyone out?** Give each key an id and put that key id in the token header. Start signing new tokens with the new key, but keep accepting the old key until the longest access token signed with it has expired. Then remove the old key.

### Common wrong answers and red flags
- "Just make the token expire sooner" with no refresh flow, so users must log in every few minutes.
- Denylisting by a token id the server never puts into the token, so the check never matches. Also skipping the audience check.
- Storing refresh tokens as plain text, or rotating with a read then a separate save, so two refreshes at once can both succeed. Store a hash, and lock the row.
- Long-lived tokens in localStorage.
- Cancelling only the reused token instead of the whole family.

### Numbers to quote
In a local test, two refreshes sent at the same moment with one token gave one success and one rejection, and that rejection revoked the whole family, including the winner's new token.

### Code sketch
```js
// client is a pg client after BEGIN, token is the raw refresh token, res the response, sha256 and issue as in the script
const { rows: [row] } = await client.query(
  'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [sha256(token)]);
if (!row) { await client.query('ROLLBACK'); return res.status(401).end(); }
if (row.used_at || row.revoked_at || row.expires_at < new Date()) {   // reuse: kill the family
  await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1', [row.family_id]);
  await client.query('COMMIT');
  return res.status(401).end();
}
await client.query('UPDATE refresh_tokens SET used_at = now() WHERE token_hash = $1', [row.token_hash]);
const next = await issue(client, row.user_id, row.family_id);         // new random token, stored hashed
await client.query('COMMIT');
```

```sql
CREATE TABLE refresh_tokens (token_hash text PRIMARY KEY, family_id uuid NOT NULL,
  user_id text NOT NULL, used_at timestamptz, revoked_at timestamptz, expires_at timestamptz NOT NULL);
```

Verified by [code/auth/verify-s2.mjs](code/auth/verify-s2.mjs)

### Source
Lessons 83, 82, 27.

---

## S3. Storing passwords and stopping brute force on login
**Tag: Must know**

### Before you speak
- **Today:** passwords are stored as SHA-256 hashes, there is no limit on login attempts, and login answers faster when the email does not exist.
- **Problem one, fast hash:** SHA-256 is built to be fast. If the database leaks, an attacker can try billions of guesses quickly. Without a unique salt per user, equal passwords also share the same hash.
- **Fix for problem one:** a slow password hash such as scrypt, bcrypt or Argon2, with a random salt per user. Each guess then costs real time. Compare the result in constant time, so the compare itself leaks nothing.
- **Problem two, timing:** for an unknown email the code returns at once, but for a real email it pays for the slow hash. An attacker can time the answers to learn which emails have accounts.
- **Fix for problem two:** when the user is missing, still check the password against a dummy hash made with the same settings. Both failures then take about the same time and show one generic message.
- **Problem three, unlimited guessing:** rate limit failures per account, which stops guessing from many addresses, and per IP address, which stops one address trying many accounts.
- **The trade-off to mention:** strict per-account limits let an attacker lock out the real user on purpose. Prefer delays, a captcha and a reset email over a hard lockout.

### Scenario
"Our e-commerce app stores passwords as SHA-256 hashes, and the login endpoint has no limits. A security audit also found that login answers much faster for unknown emails. What would you change?"

### Questions to ask back
- **Can we rehash existing users?** Only at their next login, when we have the real password. Until then I can wrap the old hash inside the new slow one.
- **How many servers handle login?** With more than one, the rate limit counters need a shared store, or each server counts on its own.
- **Do we already have a reset email and a captcha?** Those are the softer options instead of a hard lockout.
- **Do business users share one office IP address?** Then a strict per-IP limit would block a whole company.

### Spoken answer
> I never store passwords, only a hash from a slow password hashing function, with a unique random salt per user, compared in constant time. A plain fast hash is wrong, because attackers can try guesses at enormous speed. At login, I return one generic message for an unknown email and a wrong password. That is not enough, because an unknown email returns instantly while a real one pays for the hash. So when the user is missing, I still verify against a dummy hash made with the same settings. The slow hash protects a leaked database. Rate limits protect the live login. I limit failures per account, which stops guessing from many addresses, and per IP, which stops spraying across many accounts. I prefer delays, a captcha and a reset email over hard lockouts. The trade off is that strict account limits let an attacker lock out a real user.

### Say it in 5 beats
1. Slow, salted hash, constant-time compare.
2. One message for every failure.
3. Dummy hash keeps unknown emails slow.
4. Limit per account and per IP.
5. Trade-off: lockouts can be abused.

### Case variations
- **"Migrate millions of SHA-256 hashes without a forced reset."**
  > I wrap each old hash in the slow function right away, so the stored data is safe today. At each user's next login, I check the password through the wrapper. If it matches, I replace the entry with a direct slow hash of the password.
- **"An attacker uses one password against thousands of accounts."**
  > That is password spraying. Each account sees only one failure, so per-account limits never trigger. The per-IP limit and a check against lists of known leaked passwords do the work here.
- **"The signup form says 'email already registered'."**
  > That tells an attacker which emails have accounts, just like the login timing gap. I show the same answer either way. The real details go to the email address, which only its owner can read.
- **"Hashing is slowing our servers under load."**
  > The cost is paid once per login, not per request, because a session or token proves the identity after that. I tune the cost so one hash takes a fraction of a second. Rate limits stop attackers from using the slow hash to overload the servers.

Unverified: no Redis here; the script's limiter counts in process memory, so the shared counter across instances is not run.

### Follow-up questions
- **Why does the salt not need to be secret?** Its job is to be unique, so equal passwords get different hashes and tables of precomputed hashes become useless. A pepper is the optional secret part, a key kept outside the database.
- **Why compare with timingSafeEqual and not a plain equals?** A plain compare stops at the first different byte, so its speed leaks how much matched. Node's timingSafeEqual always reads every byte.
- **Why limit per account and per IP?** Per account stops credential stuffing, where many addresses try leaked passwords against one account. Per IP stops one address spraying many accounts.
- **Optional: senior. Which hashing function and cost would you choose?** Argon2id for new systems, scrypt or bcrypt where those are what the platform offers, and PBKDF2 only when a compliance standard called FIPS requires it. I tune the cost so one hash takes a few hundred milliseconds on production hardware. The settings are stored inside the hash string, so I can raise them later.

### Common wrong answers and red flags
- SHA-256 or MD5 for passwords, or one salt shared by every user.
- Comparing secrets with a plain equals.
- A dummy hash string that is too short for the real hash function. The library rejects it without doing the slow work, so the timing gap comes back. Create the dummy at startup with the real hash function and cost.
- A register route that reads the password length before checking the password exists, so a missing password crashes the route instead of returning bad request. Check the type first.
- Different messages for "no such user" and "wrong password".
- A permanent lockout after a few failures.

Unverified: bcrypt is not installed here, so how it treats a short dummy string was not run; the script only checks its length.

### Numbers to quote
In a local test, an unknown email checked against a dummy hash took within a factor of two of a wrong password, while skipping the dummy made the unknown email answer more than 20 times faster.

### Code sketch
```js
import { scrypt as cb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(cb), P = { N: 16384, r: 8, p: 1 };
export async function hashPassword(pw) {
  const salt = randomBytes(16), key = await scrypt(pw, salt, 64, P);
  return ['scrypt', P.N, P.r, P.p, salt.toString('base64'), key.toString('base64')].join('$');
}
export async function verifyPassword(stored, pw) {
  const [, N, r, p, salt, key] = stored.split('$'), expected = Buffer.from(key, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(got, expected);
}
export const DUMMY = await hashPassword(randomBytes(16).toString('hex'));   // real hash, same cost
```

```js
// app and express from Express, rateLimit from express-rate-limit, users.findByEmail returns a user or null
const perIp = rateLimit({ windowMs: 15 * 60e3, limit: 20 });
const perAccount = rateLimit({ windowMs: 15 * 60e3, limit: 5, skipSuccessfulRequests: true,
  keyGenerator: (req) => 'acct:' + String(req.body?.email ?? '').trim().toLowerCase() });
app.post('/login', express.json(), perIp, perAccount, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') return res.status(400).end();
  const user = await users.findByEmail(email.trim().toLowerCase());
  const ok = await verifyPassword(user ? user.hash : DUMMY, password);   // same work either way
  if (!user || !ok) return res.status(401).json({ error: 'Invalid email or password' });
  res.json({ ok: true });                                                // then start a session as in S1
});
```

Verified by [code/auth/verify-s3.mjs](code/auth/verify-s3.mjs)

### Source
Lessons 85, 82, 27, 66, 86.

---

## S4. Security review of a cookie-authenticated API
**Tag: Likely**

### Before you speak
- **Today:** the dashboard logs in with a session cookie. CORS is set to "any origin, with credentials". Users can post comments and upload avatars.
- **Why cookies need extra care:** the browser attaches the cookie to every request to your API, even one started by another site. That is CSRF. So every route that changes data must check where the request came from.
- **CORS is not CSRF protection:** CORS only decides which sites may read your responses. A forged request still reaches your handler and runs. And "any origin with credentials" is so unsafe that browsers reject it.
- **XSS:** if user text is shown as raw HTML, an attacker's script runs in your page. Escape all output, and add a content security policy so injected script cannot run.
- **Uploads and input:** never trust a file's name or declared type. Check every input's type, and use parameterized queries, so user values are never pasted into the query text.
- **The trade-off to mention:** each layer adds setup work, but no single control covers everything.

### Scenario
"You are asked to review our notification service's API before launch. The web dashboard logs in with a session cookie, the CORS config is currently origin star with credentials, and users can post comments and upload avatars. Walk me through what you would check and fix."

### Questions to ask back
- **Which sites really need to call this API?** That list becomes both the CORS allow-list and the list the origin check uses.
- **Do any non-browser clients use the same routes?** Server-to-server callers send no Origin header, so they need token auth on a separate path.
- **Is any user content shown as HTML?** That decides how strict the escaping and the content security policy must be.
- **Where do uploaded files end up?** Serving them from our own domain is riskier than serving them from a separate storage domain.

### Spoken answer
> I would walk the request path in order. First, security headers, including a content security policy, so injected script cannot run. For cross site scripting, I escape all output for its context and never insert user text as raw HTML. Auth cookies are HTTP only, secure, and same site lax. Because the browser sends cookies by itself, every state changing route checks that the origin header is ours, or uses a CSRF token. CORS is separate. It only controls which sites may read responses, so I use an allowlist with credentials, never a wildcard, and it does not stop a forged request. Rate limits sit on the API, stricter on login. Finally, I validate types to block injection, and use parameterized queries. The trade off is that each layer adds configuration, but no single control covers everything.

### Say it in 5 beats
1. Headers first, with a content policy.
2. Escape output; never raw HTML.
3. Locked-down cookies plus an origin check.
4. CORS allow-list; it is not CSRF defense.
5. Trade-off: more layers, no single fix.

### Case variations
- **"A login form sends the email as a JSON object, not a string."**
  > That is operator injection against a document database like MongoDB. An object such as "not equal to empty" can match any user. I check that every field is the type I expect, so an object is rejected before it reaches the query.
- **"Users upload avatars."**
  > I set a file size limit and check the first bytes of the file for its real format, instead of trusting the name or the declared type. I give the file a new name. Then I serve it from a separate storage domain, so a harmful file cannot run as part of our site.
- **"Why not just keep origin star? It works."**
  > Browsers reject a wildcard together with credentials, so someone will "fix" it by echoing back whatever origin asks. That lets every site read logged-in responses. I keep an explicit allow-list instead.
- **"The comment field needs bold and links."**
  > Then escaping everything would break the formatting. I sanitize with an allow-list of tags and attributes, which keeps safe tags and strips the rest. The content security policy stays as the second line of defense.

Unverified: browser enforcement of CORS, SameSite and the content security policy needs a real browser; the script checks only the response headers and the server-side checks.

### Follow-up questions
- **Why is SameSite not enough on its own?** Older browsers ignore it. Lax still sends the cookie when the user follows a normal link to your site with a GET. And sibling subdomains count as the same site. An origin check or a CSRF token closes those gaps.
- **What does helmet give you?** It is Express middleware that sets safe headers: a content security policy, nosniff, which stops the browser guessing file types, frame protection, HSTS, which forces HTTPS, and a referrer policy. It also removes the X-Powered-By header. The content security policy usually needs tuning for your own scripts.
- **How do you stop SQL injection?** Parameterized queries, always, so values travel separately from the query text. Names like a sort column come from an allow-list, never from string building.
- **Optional: senior. Where should rate limiting live when you run many instances?** In a shared store, or at the API gateway, keyed by user id with the IP address as a fallback, and with stricter limits on login and password reset. Counters inside each process multiply the real limit by the number of instances.

### Common wrong answers and red flags
- "We have CORS, so we are safe from CSRF." CORS hides the response, but the forged request still reaches the handler.
- Echoing back any Origin with credentials allowed.
- Trusting an upload's file name or declared content type.
- Calling SameSite Lax the browser default. Only Chrome and Edge default to it, so set it explicitly.
- Returning stack traces or database errors to the client.
- Only hiding buttons in the frontend instead of checking permissions on the server.

### Numbers to quote
No figures needed.

### Code sketch
```js
// app and express from Express; helmet, cors and rateLimit (express-rate-limit) are imported
const ALLOWED = new Set(['https://app.example.com']);
app.use(helmet());                                       // CSP, nosniff, no X-Powered-By
app.use(cors({ origin: (o, cb) => cb(null, ALLOWED.has(o)), credentials: true }));
app.use((req, res, next) => {                            // CSRF: CORS does not block the request itself
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!ALLOWED.has(req.get('Origin'))) return res.status(403).json({ error: 'Bad origin' });
  next();
});
app.use('/api', rateLimit({ windowMs: 60e3, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use(express.json());
```

Verified by [code/auth/verify-s4.mjs](code/auth/verify-s4.mjs)

### Source
Lessons 86, 43, 84, 57, 58, 66.
