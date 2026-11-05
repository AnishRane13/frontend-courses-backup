# 04. Authentication, JWT and security basics

> **Remember this**
> 1. Browser app: a server session behind an HttpOnly, Secure cookie with an explicit SameSite. Native mobile app: a short access token in the Authorization header.
> 2. Access tokens live minutes. Refresh tokens are stored hashed, rotated on every use, and a reused one revokes its whole family.
> 3. Passwords get a slow, salted hash compared in constant time. An unknown email still runs a real dummy hash, so both failures take the same time.
> 4. Rate limit login per account and per IP. A hard lockout lets an attacker lock out the real user.
> 5. CORS only decides who may read a response. It does not stop a forged request, so cookie routes also need an origin check or a CSRF token.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| S1 | [Login for a web app and a mobile app: sessions or tokens](#s1-login-for-a-web-app-and-a-mobile-app-sessions-or-tokens) | Must know |
| S2 | [A JWT leaked: short access tokens and refresh rotation](#s2-a-jwt-leaked-short-access-tokens-and-refresh-rotation) | Must know |
| S3 | [Storing passwords and stopping brute force on login](#s3-storing-passwords-and-stopping-brute-force-on-login) | Must know |
| S4 | [Security review of a cookie-authenticated API](#s4-security-review-of-a-cookie-authenticated-api) | Likely |

---

## S1. Login for a web app and a mobile app: sessions or tokens
**Tag: Must know**

### Scenario
"Our SaaS dashboard needs login for a web app and a new mobile app, both calling the same Node API. Admins must be able to log a user out of everything at once. Would you use sessions or JWTs, and how would you set it up?"

### Questions to ask back
- **Are the web app and the API on the same site?** If yes, a first-party cookie is simple. If they are on different sites, I need CORS with credentials and SameSite None, which widens the CSRF surface.
- **How fast must a forced logout take effect?** Instantly means a server-side check on every request. A few minutes allows short stateless tokens.
- **How many API instances run?** More than one means sessions need a shared store, not process memory.
- **Will other services verify the identity too?** If yes, signed tokens with an issuer and audience fit better than a session lookup.

### Spoken answer
> I would pick per client, not one answer for everything. For the web app, I would use a server session. The browser holds only a random id in a cookie that scripts cannot read, sent only over HTTPS, with an explicit same site setting. I create a fresh id at login, and logout deletes the server record, so it takes effect at once. The mobile app has no browser cookie jar, so it gets a short access token in the authorization header, plus a refresh token in the phone's secure storage. Both paths share one password check and one user table. Sessions need a shared store across servers. Tokens skip the lookup but stay valid until they expire. So the trade-off is instant revocation and simplicity for sessions, against stateless checks and native client support for tokens.

### Say it in 5 beats
1. Choose per client, not one answer.
2. Web: session id in a hardened cookie.
3. Regenerate at login, destroy at logout.
4. Mobile: short token, refresh in secure storage.
5. Trade-off: revocation versus stateless checks.

### Case variations
- **"We run six API instances behind a load balancer."**
  > Sessions then need a shared store, usually Redis, so every instance sees the same session. The default in-process store is for development only.
- **"Can't we just use JWTs everywhere? It's simpler."**
  > It is simpler until an admin needs to log someone out now. A JWT stays valid until it expires, so I would need short tokens plus a refresh token I can delete, and that is state again.
- **"Our web app lives on a different domain from the API."**
  > Then the cookie is cross-site, so it needs SameSite None and Secure, and CORS must name the exact origin with credentials. Because the browser now sends it cross-site, I add an origin check or a CSRF token on every state-changing route.
- **"We add Sign in with Google."**
  > Google proves the identity through OpenID Connect, and I still create my own session or tokens afterwards. I map the provider's subject id to my user row, not the email alone.

Unverified: no Redis on this machine, so the script uses the default memory store; the shared-store claim is not run.

### Follow-up questions
- **Where should a browser keep a JWT if you use one?** In an HttpOnly, Secure cookie, not localStorage, because any injected script can read localStorage. The cookie then needs CSRF defense.
- **Why regenerate the session id at login?** Otherwise an attacker who planted a known id before login gets an authenticated session after it. That is session fixation.
- **Why does a Secure cookie disappear behind a load balancer?** TLS ends at the proxy, so Express sees plain HTTP and will not send a Secure cookie. Set trust proxy to the number of proxies.
- **Optional: senior. How do you verify a JWT safely across several services?** Pin the algorithm list, check expiry, issuer and audience, and prefer an asymmetric key so services can verify but not mint tokens. A token minted for the billing service must fail at the mobile API because its audience differs.

### Common wrong answers and red flags
- "JWTs are more secure than sessions." They are a different trade-off, and revocation is harder.
- Storing the token in localStorage for a browser app.
- Shipping the default in-memory session store to production.
- Lesson 84 calls SameSite Lax "the modern browser default". That is Chrome and Edge behaviour, not every browser. Always set SameSite explicitly.
- Lesson 83's verify middleware pins the algorithm and issuer but never checks the audience. Pass the audience too.
- Clearing the cookie on logout but leaving the session row, so a copied cookie still works.

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

### Scenario
"A customer's access token from our chat app showed up in a public bug report with full logs. Our tokens currently last thirty days and we have no logout on the server. How would you limit the damage now, and redesign so a leaked token matters less?"

### Questions to ask back
- **What does the token carry and how long has it been exposed?** That decides whether I must rotate the signing key for everyone or only kill one user's tokens.
- **Is there any server-side state today?** If not, the only instant fix is rotating the signing secret, which logs everyone out.
- **Which clients refresh, and can two of them refresh at once?** Several tabs or devices change how strict rotation can be.
- **Do we log tokens anywhere else?** The leak path matters as much as the token. Logs must redact the Authorization header.

### Spoken answer
> If a token leaks, the damage depends on how long it lives, so I keep access tokens to minutes. They are checked without a database, so a leaked one works until it expires, unless I add its token id to a small denylist. The refresh token is the long lived one, so it lives on the server. I store only its hash, like a password, so a database leak gives nothing usable. Every refresh rotates it. The old one is marked used and a new one joins the same family. If a used token ever comes back, either the thief or the real user is replaying it, so I revoke the whole family and force a new login. The trade-off is a database write on every refresh, and honest clients that refresh twice at once can be logged out.

### Say it in 5 beats
1. Damage equals token lifetime.
2. Access tokens last minutes.
3. Refresh tokens stored hashed, server side.
4. Rotate; reuse revokes the whole family.
5. Trade-off: writes, and false reuse alarms.

### Case variations
- **"Right now, today, with thirty-day tokens and no state."**
  > The only instant lever is rotating the signing secret, which logs everyone out. If that is too harsh, I add a short denylist for that token id and ship the short-token design next.
- **"Two browser tabs refresh at the same moment."**
  > With strict rotation, the second one looks like reuse and kills the session. I make the client refresh through a single shared call, or allow a few seconds of grace where the just-used token returns the same new token.
- **"An admin demotes a user, but their token still says admin."**
  > The role in a token is stale until it expires. For sensitive actions I check the role in the database, or keep a user version number and reject older tokens.
- **"The refresh token itself is stolen from the device."**
  > Rotation does not stop the first use, but as soon as both parties use it, reuse detection fires and the whole family dies. Binding tokens to a device key goes further.

Unverified: a denylist shared across instances needs a store like Redis, which is not on this machine; the script uses an in-process set.

### Follow-up questions
- **Why hash a refresh token but not an access token?** The refresh token is long-lived and stored in your database, so a database leak would hand out valid tokens. A fast hash such as SHA-256 is enough because the token is long and random, unlike a password.
- **What goes in the denylist key?** The token id claim. The token must actually carry one, which in jsonwebtoken means passing a jwtid when you sign.
- **How do you make the refresh step safe under concurrency?** Lock the row in a transaction, so two requests with the same token cannot both pass. Exactly one wins.
- **Optional: senior. How would you rotate the signing key without logging everyone out?** Give each key an id in the token header, publish the new key, sign new tokens with it, and keep verifying the old key until the longest access token has expired. Then retire the old key.

### Common wrong answers and red flags
- "Just make the token expire sooner" without any refresh flow, so users log in every few minutes.
- Lesson 83 denylists by a token id it never issues: its sign call has no jwtid, so the id is undefined and the check never matches. It also never checks the audience.
- Lesson 83 stores refresh tokens raw and rotates with a find, then a save, so two concurrent refreshes can both succeed. Store a hash, and lock the row.
- Long-lived tokens in localStorage.
- Revoking only the reused token instead of the whole family.

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

### Scenario
"Our e-commerce app stores passwords as SHA-256 hashes, and the login endpoint has no limits. A security audit also found that login answers much faster for unknown emails. What would you change?"

### Questions to ask back
- **Can we rehash existing users?** Only at their next login, when we have the plaintext. Until then I can wrap the old hash inside the new slow one.
- **How many instances serve login?** More than one means the rate limit counters need a shared store.
- **Do we already have a reset email and a captcha?** Those are the softer alternatives to a hard lockout.
- **Are business users behind one office IP?** Then a strict per-IP limit would block a whole company.

### Spoken answer
> I never store passwords, only a hash from a slow password hashing function, with a unique random salt per user, compared in constant time. A plain fast hash is wrong, because attackers can try guesses at enormous speed. At login, I return one generic message for an unknown email and a wrong password. That is not enough, because an unknown email returns instantly while a real one pays for the hash. So when the user is missing, I still verify against a dummy hash made with the same settings. The slow hash protects a leaked database. Rate limits protect the live login. I limit failures per account, which stops guessing from many addresses, and per IP, which stops spraying across many accounts. I prefer delays, a captcha and a reset email over hard lockouts. The trade-off is that strict account limits let an attacker lock out a real user.

### Say it in 5 beats
1. Slow, salted hash, constant-time compare.
2. One message for every failure.
3. Dummy hash keeps unknown emails slow.
4. Limit per account and per IP.
5. Trade-off: lockouts can be weaponized.

### Case variations
- **"Migrate millions of SHA-256 hashes without a forced reset."**
  > I wrap each old hash in the slow function right away, so the database is safe today. At each user's next login I verify through the wrapper and replace it with a direct slow hash.
- **"An attacker uses one password against thousands of accounts."**
  > That is password spraying. Per-account limits never trip, so the per-IP limit and checks against known breached passwords do the work.
- **"The signup form says 'email already registered'."**
  > That leaks accounts just like login timing. I answer the same way either way and send the details by email.
- **"Hashing is slowing our servers under load."**
  > The cost is per login, not per request, because sessions or tokens carry the identity afterwards. I tune it to a fraction of a second, and rate limits stop attackers from turning the hash into a denial of service.

Unverified: no Redis here; the script's limiter counts in process memory, so the shared counter across instances is not run.

### Follow-up questions
- **Why does the salt not need to be secret?** Its job is uniqueness, so equal passwords get different hashes and precomputed tables are useless. A pepper is the optional secret part, kept outside the database.
- **Why compare with timingSafeEqual and not equals?** A normal compare stops at the first different byte, which leaks how much matched. The constant-time compare always reads every byte.
- **Why limit per account and per IP both?** Per account stops credential stuffing from a botnet of addresses. Per IP stops one address spraying many accounts.
- **Optional: senior. Which hashing function and cost would you choose?** Argon2id for new systems, scrypt or bcrypt where those are what the platform offers, PBKDF2 only when FIPS requires it. I tune the cost so one hash takes a few hundred milliseconds on production hardware and store the parameters in the hash string, so I can raise them later.

### Common wrong answers and red flags
- SHA-256 or MD5 for passwords, or one global salt.
- Comparing secrets with a plain equals.
- Lesson 82 uses a 38-character string as its bcrypt dummy hash. A real bcrypt hash is 60 characters, so a library may reject it without doing the slow work, and the timing leak returns. Generate the dummy at startup with your real hash function and cost.
- Lesson 85's register route reads the password length before checking it exists, so a request without a password crashes with a TypeError instead of a 400. Check the type first.
- Different messages for "no such user" and "wrong password".
- A permanent lockout after a few failures.

Unverified: bcrypt is not installed here, so how it treats lesson 82's short dummy string was not run; the script only checks its length.

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

### Scenario
"You are asked to review our notification service's API before launch. The web dashboard logs in with a session cookie, the CORS config is currently origin star with credentials, and users can post comments and upload avatars. Walk me through what you would check and fix."

### Questions to ask back
- **Which origins really need to call this API?** That list becomes the CORS allowlist and the CSRF origin check.
- **Do any non-browser clients use the same routes?** Server-to-server callers send no Origin header, so they need token auth on a separate path.
- **Is any user content rendered as HTML?** That decides how strict the escaping and the content security policy must be.
- **Where do uploads end up?** Serving them from our own origin is riskier than a separate storage domain.

### Spoken answer
> I would walk the request path in order. First, security headers, including a content security policy, so injected script cannot run. For cross site scripting, I escape all output for its context and never insert user text as raw HTML. Auth cookies are HTTP only, secure, and same site lax. Because the browser sends cookies by itself, every state changing route checks that the origin header is ours, or uses a CSRF token. CORS is separate. It only controls which sites may read responses, so I use an allowlist with credentials, never a wildcard, and it does not stop a forged request. Rate limits sit on the API, stricter on login. Finally, I validate types to block injection, and use parameterized queries. The trade-off is that each layer adds configuration, but no single control covers everything.

### Say it in 5 beats
1. Headers first, with a content policy.
2. Escape output; never raw HTML.
3. Hardened cookies plus an origin check.
4. CORS allowlist; it is not CSRF defense.
5. Trade-off: more layers, no single fix.

### Case variations
- **"A login form sends the email as a JSON object, not a string."**
  > That is operator injection against a document database. I validate that every field is the type I expect, so an object is rejected before it reaches the query.
- **"Users upload avatars."**
  > I set a file size limit, check the first bytes for the real format instead of trusting the name or the declared type, rename the file, and serve it from a separate storage domain.
- **"Why not just keep origin star? It works."**
  > Browsers reject a wildcard with credentials, so someone will "fix" it by echoing any origin. That lets every site read authenticated responses, so I keep an explicit allowlist.
- **"The comment field needs bold and links."**
  > Then I sanitize with an allowlist of tags and attributes instead of escaping everything, and keep the content security policy as the second line of defense.

Unverified: browser enforcement of CORS, SameSite and the content security policy needs a real browser; the script checks only the response headers and the server-side checks.

### Follow-up questions
- **Why is SameSite not enough on its own?** Older browsers ignore it, Lax still sends the cookie on top-level GET navigations, and sibling subdomains count as same site. An origin check or a CSRF token closes the gap.
- **What does helmet give you?** A content security policy, nosniff, frame protection, HSTS and a referrer policy, and it removes the X-Powered-By header. The content security policy usually needs tuning for your scripts.
- **How do you stop SQL injection?** Parameterized queries, always. Identifiers like a sort column come from an allowlist, never from string building.
- **Optional: senior. Where should rate limiting live when you run many instances?** In a shared store, or at the gateway, keyed by user id with the IP as a fallback, and with stricter budgets on login and password reset. Per-process counters multiply the real limit by the instance count.

### Common wrong answers and red flags
- "We have CORS, so we are safe from CSRF." CORS hides responses, but the forged request still reaches the handler.
- Echoing any Origin back with credentials.
- Trusting the file name or declared content type of an upload.
- Lesson 84 says SameSite Lax is the browser default. Only Chrome and Edge default to it, so set it explicitly.
- Returning stack traces or SQL errors to the client.
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
