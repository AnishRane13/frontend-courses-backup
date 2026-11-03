---
title: "JSON Web Tokens (JWT)"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/jwt
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# JSON Web Tokens (JWT)

*12 min read · Updated 24 Jul 2026 Topic 49 of 70 Bookmark Mark done Why it matters JWTs are everywhere in modern backends · Topic 49 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/jwt](https://www.geekyfrontend.in/learn/nodejs-backend-kit/jwt)

---

## Say it in 30 seconds

A JSON Web Token is a signed packet of claims: the server writes facts such as the user id and the expiry into the token, signs them, and later checks that signature instead of looking the user up. Any server with the key can trust the token without a shared session store. Anyone who holds the token can read the payload, because signing is not encryption. You also cannot cancel a token before it expires unless you add a refresh token or a denylist.

## Why it matters

APIs, mobile apps, and service-to-service calls all pass JWTs around. The library call is one line, so it is easy to ship one without knowing the limits. The payload is readable by anyone who has the token. A token that says it needs no signature can be accepted by a careless verifier. You cannot un-issue a token. Putting it in localStorage exposes it to script injection. A JWT guarantees integrity, meaning the contents were not changed, and authenticity, meaning the holder of the secret signed them. It does not guarantee secrecy or that you can revoke it early.

## The concept, simply

A JWT is a signed, self-contained statement. Instead of storing "user 42 is logged in" and handing out a lookup id, the server writes that fact into the token, signs it, and gives the token to the client. When it comes back, the server rechecks the signature and trusts the contents. No database lookup is required.

A JWT has three parts joined by dots: header, payload, and signature. The header and payload are JSON encoded with Base64URL. The signature is bytes.

![The three dot-separated parts of a JWT: header, payload, and signature](assets/i46_01_b738841f.svg)

The header names the algorithm. The payload carries claims such as the subject and the expiry. The signature is an HMAC or an RSA signature over the first two parts. Base64URL is encoding, not encryption.

That last point is the one to remember. Anyone holding the token can decode the payload. The signature does not hide the contents. It only proves they were not altered and were produced by someone with the key. Do not put secrets, passwords, or sensitive personal data in the payload.

## How it works

The **header** is JSON such as algorithm HS256 and type JWT. It names the signing algorithm. The **payload** holds claims. Registered ones include `sub` for the subject or user id, `iat` for issued-at, `exp` for expiry, `iss` for the issuer, and `aud` for the audience, plus custom claims such as role. The **signature** is computed over the encoded header and payload.

For the common HMAC family, HS256, the same secret both signs and verifies. For RSA or ECDSA, RS256 or ES256, a private key signs and the matching public key verifies. Many services can then check tokens without being able to mint them.

Verification, in order:

1. Split the token on the dots into header, payload, and signature.
2. Read the algorithm, but enforce the algorithm you expect. Do not trust the token's own algorithm field.
3. Recompute the signature over header-dot-payload with your key and that expected algorithm.
4. Compare in constant time. If it differs, reject the token.
5. Only then check claims: `exp` still in the future, `nbf` (not-before) satisfied, `iss` and `aud` match this service.
6. If all of that passes, treat the request as that user.

Signature first, claims second. Reading the payload before the signature means trusting attacker-controlled data. A maintained library does this ordering. Do not hand-roll it.

**Where the browser keeps it.** localStorage is easy and works across domains, but any script on the page can read it, so one cross-site scripting bug leaks the token. An HttpOnly cookie is invisible to JavaScript, which blocks that theft, but the browser attaches the cookie automatically, which is the cross-site request forgery problem unless you set SameSite and a CSRF token. For a web app, the usual default is an HttpOnly, Secure, SameSite cookie. A native mobile app has no cookie jar, so a token in the Authorization header fits there.

**Revocation.** A JWT is valid until `exp`, and the server keeps no per-token row, so you cannot cancel one on the spot. The usual fix is two tokens. A short-lived access token, minutes, is used on every API call and simply expires. A long-lived refresh token, days or weeks, is stored on the server and is used only to mint new access tokens. Logout deletes the refresh token, so the user is locked out within one access-token lifetime.

![Sequence of login, using a short access token, expiry, and refreshing with a rotated refresh token](assets/i46_02_11d4a2da.svg)

Login returns a short access token and a long refresh token. API calls use the access token until it expires, then the refresh token is exchanged for a new one. Refresh tokens can be revoked on the server.

**Rotation** goes further. Each refresh issues a new refresh token and invalidates the old one. If a stolen refresh token is used after the real client already rotated it, the server sees a reused token and can revoke the whole family.

## Code examples

Issue an access token at login. Keep the payload small and always set an expiry.

javascript

```
const jwt = require('jsonwebtoken');
const ACCESS_SECRET = process.env.ACCESS_SECRET; // long random string from env

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role },   // claims — no secrets, no PII
    ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'api.myapp.com' }
  );
}

app.post('/login', async (req, res) => {
  const user = await authenticate(req.body); // verifies password hash
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ accessToken: issueAccessToken(user) });
});
```


Verify in middleware. The explicit algorithm list and the issuer check close the algorithm-confusion and audience gaps. `jwt.verify` throws on a bad signature or an expired token, so it sits in try/catch.

javascript

```
function requireJwt(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    const payload = jwt.verify(token, ACCESS_SECRET, {
      algorithms: ['HS256'],        // pin the algorithm — never trust token's alg
      issuer: 'api.myapp.com',      // reject tokens minted for another service
    });
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    // TokenExpiredError vs JsonWebTokenError — both mean "reject"
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```


The refresh route stores the refresh token on the server so it can be revoked and rotated. A valid one mints a new access token.

javascript

```
app.post('/refresh', async (req, res) => {
  const token = req.cookies.refreshToken; // HttpOnly cookie
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  // Look it up in our store — this is what makes it revocable
  const stored = await RefreshToken.findOne({ token, revoked: false });
  if (!stored || stored.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Rotate: invalidate the old one, issue a new pair
  stored.revoked = true;
  await stored.save();
  const user = await User.findById(stored.userId);
  const newRefresh = await RefreshToken.create({
    userId: user.id, token: crypto.randomBytes(40).toString('hex'),
    expiresAt: new Date(Date.now() + 7 * 864e5),
  });
  res
    .cookie('refreshToken', newRefresh.token, { httpOnly: true, secure: true, sameSite: 'strict' })
    .json({ accessToken: issueAccessToken(user) });
});
```


A denylist is for the rare case where you must kill an access token before it expires, for example a stolen account. Because access tokens are short-lived, the list stays small and entries expire quickly.

javascript

```
// On logout / compromise, store the token's jti until its exp passes.
async function isRevoked(jti) {
  return Boolean(await redis.get('revoked:' + jti));
}
// In requireJwt, after verify: if (await isRevoked(payload.jti)) reject.
```


## Common mistakes & gotchas

- **Secrets or personal data in the payload.** It is only Base64URL, not encrypted. Passwords, card numbers, and sensitive data are readable by anyone holding the token.
- **Trusting the token's own `alg` header.** `alg: none` claims no signature is needed. RS256 confused with HS256 lets an attacker sign with the public key as if it were an HMAC secret. Always pass an algorithm allow-list to verify.
- **No expiry, or an expiry of months.** That token is a permanent credential. Keep access tokens to minutes.
- **Assuming you can revoke a bare JWT.** It is valid until it expires. Instant logout needs a short lifetime plus a refresh token or a denylist.
- **localStorage without thinking about script injection.** Any script on the page can read it. For browser apps, prefer an HttpOnly cookie.
- **A short or committed HMAC secret.** Attackers can then forge tokens. Use a long random secret from the environment, and rotate it.
- **Skipping `iss` and `aud` across services.** A token minted for service A can be replayed at service B.

## Best practices

- **Short-lived access token, revocable refresh token.** Rotate the refresh token on each use, and treat reuse as theft.
- **Pin the algorithm.** Pass `algorithms: ['HS256']`, or whichever you chose, so a forged header cannot downgrade the check.
- **Always set and check `exp`, and `iss` and `aud` when more than one service is involved.**
- **Keep the payload to an id, a role or scopes, and the standard claims.** Tokens ride on every request.
- **Browser: HttpOnly, Secure, SameSite cookie, plus CSRF defense. Mobile: Authorization header.**
- **Prefer RS256 or ES256 across services** so verifiers hold only the public key and cannot mint tokens.
- **Use `jsonwebtoken` or `jose`.** Do not hand-roll signing or verification.

## ⭐ Interview lens

> **Q: Walk me through how a server verifies a JWT.**  
> A: Verification proves the token was signed by your key and has not been changed. Split it on the dots into header, payload, and signature. Decide the algorithm yourself, for example HS256, and do not take it blindly from the header. Recompute the signature over the header and payload with your key, and compare in constant time so timing does not leak how close a forgery was. Only if that matches do you read the claims: expiry still in the future, not-before satisfied, and issuer and audience matching this service. The order is the whole point. Signature first, claims second, because the payload is attacker-controlled until the signature passes. A library such as jsonwebtoken does this if you pass an algorithms list. The limit is that a valid signature does not mean you can cancel the token. It stays good until exp unless you add more machinery.

> **Q: Is a JWT encrypted? Can I store the user's role in it? (trap)**  
> A: A JWT is signed, not encrypted. The payload is Base64URL JSON, so anyone who copies the token can decode it and read every claim. Paste it into a decoder and the user id and role are right there. That is fine for a non-sensitive role or scope, which is what claims are for, and it is not fine for a password, a card number, or other sensitive personal data. The signature only proves integrity and that the holder of the secret produced the token. It does not hide bytes. If you need secrecy, encrypt separately. The limit of "put the role in the token" is staleness: if you demote the user, the old token still says admin until it expires, unless you keep access tokens short or check the role in a store.

> **Q: How do you log a user out or revoke a JWT immediately?**  
> A: A pure stateless JWT cannot be revoked before exp, because the server stored nothing to delete. The practical pattern is two tokens. The access token is what every API call sends, and you keep it to minutes so a leak dies quickly. The refresh token is long-lived, stored on the server, and used only to mint a new access token. Logout or a ban deletes that refresh row, and the user is locked out within one access-token lifetime. For the rare case where an access token itself must die immediately, keep a short denylist keyed by the token id, jti, with entries that expire when the access token would have. Rotation makes theft visible: each refresh replaces the refresh token, and reuse of an old one revokes the family. The limit is that you have given up a bit of the "no state" benefit. The refresh token is state on purpose.

> **Q: What is the `alg: none` / algorithm-confusion attack?**  
> A: The access token is presented on every request and checked with no database lookup, so it has to be short-lived or a leak is a long-lived credential. The refresh token is presented rarely, only to get a new access token, so you can store it server-side, rotate it, and delete it. Together you get stateless checks on the hot path and a real logout. For example, login returns both, API calls send the access token until exp, and the client then posts the refresh token to mint another access token. If you rotate on each refresh, a stolen refresh token used after the real client already rotated it shows up as reuse and you can revoke the whole set. The limit is client complexity and a storage decision: the refresh token has to live somewhere safer than a place any script can read, or the rotation scheme does not help.

## Cheat-card

- **Shape:** header, payload, signature. Header and payload are Base64URL JSON. The signature covers the first two parts.
- **Base64URL is not encryption.** The payload is public. No secrets in it.
- **Verify order:** signature, constant-time, algorithm you pinned, then claims (`exp`, `nbf`, `iss`, `aud`).
- **HS256:** one shared secret. **RS256 or ES256:** private key signs, public key verifies.
- **Cannot revoke a stateless JWT early.** Short access token plus a refresh token you can delete and rotate.
- **Pitfalls:** `alg` none, RS256 confused with HS256, no `exp`, weak or committed secret.
- **Browser:** HttpOnly, Secure, SameSite cookie, plus CSRF. **Mobile:** Authorization header.
- Always pass an `algorithms` list to verify. Use a maintained library.

## Good to know

- **What is the alg none or algorithm-confusion attack?** `alg: none` says no signature is required, and a verifier that trusts the header accepts it unsigned. Algorithm confusion signs an HS256 token with the server's public RSA key when the server expected RS256. Pin `algorithms` at verify time and never take the algorithm from the token.
- **localStorage or a cookie for the token?** localStorage is readable by any script, so one XSS leak steals it, but it is not sent automatically so it is not a CSRF problem. An HttpOnly, Secure, SameSite cookie is hidden from script and is the usual browser default. It is sent automatically, so cookie-based calls still need CSRF defense.

---

## Learn More

- [Introduction to JSON Web Tokens jwt.io](https://jwt.io/introduction)
- [JSON Web Token Cheat Sheet — OWASP cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html)
- [RFC 7519: JSON Web Token (JWT) datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc7519)
- [JWT Authentication Tutorial - Node.js Web Dev Simplified](https://www.youtube.com/watch?v=mbsmsi7l3r4)
