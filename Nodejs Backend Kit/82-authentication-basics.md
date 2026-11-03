---
title: "Authentication Basics"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/authentication-basics
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Authentication Basics

*11 min read · Updated 24 Jul 2026 Topic 48 of 70 Bookmark Mark done Why it matters Almost every backend you will ever write has to answer two questions on every request · Topic 48 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/authentication-basics](https://www.geekyfrontend.in/learn/nodejs-backend-kit/authentication-basics)

---

## Say it in 30 seconds

Authentication checks who someone is by verifying a credential, and authorization checks whether that proven identity may do this specific action. HTTP forgets each request, so after login the server hands the client a session or a token to present next time. A session keeps the real user data on the server, which means you can revoke it instantly. A token carries the proof on the client, which scales without a lookup, but you cannot take it back before it expires without extra machinery.

## Why it matters

Almost every backend answers two questions on every request: who is this, and are they allowed to do this. Get the first wrong and a stranger acts as your user. Get the second wrong and a logged-in user reads someone else's data. Broken access control and authentication failures sit near the top of the OWASP Top 10, the shared list of risks that actually cause breaches. The rest of this chapter slots into six words: credential, identity, session, token, claim, and scope.

## The concept, simply

**Authentication** answers "who are you?". The user presents a credential, such as a password, a one-time code, a Google login, or a passkey. The server checks it against something it trusts. Success means a proven identity: this request belongs to user 42.

**Authorization** answers "what are you allowed to do?". Given that identity, the server decides whether this user may do this action on this resource. The result is yes or no.

You authenticate once, at login, and authorize on every protected request. "Is the user logged in?" does not mean they may edit this post. They may only edit posts they own.

![Two side-by-side panels contrasting authentication and authorization](assets/i45_01_9a0bb0ae.svg)

Authentication proves identity at login. Authorization checks permission on every request. Status 401 means not authenticated. Status 403 means authenticated but not allowed.

The name "401 Unauthorized" is old HTTP wording. In practice, 401 means "I do not know who you are, log in". 403 means "I know who you are, and you may not do this".

## How it works

Every scheme has three phases. **Identification:** the user claims a username or email. **Verification:** they prove it with something they know (a password), something they have (a phone receiving a one-time code, or a hardware key), or something they are (a biometric). **Session establishment:** because HTTP is stateless, the server issues a portable proof so the user does not retype the password on every click.

**Stateful sessions.** The server creates a random session id that cannot be guessed, stores the real data (user id, roles, cart) in memory, Redis, or a database, and sends only that id in a cookie. The browser sends the cookie back. The server looks up the id. The id by itself is only a pointer.

**Stateless tokens.** The server packs the identity and its claims into a signed token, usually a JSON Web Token, and gives the whole token to the client. On each request the server checks the signature with a secret or a public key. Nothing is stored on the server. Tampering breaks the signature.

![Comparison of server-side sessions versus self-contained JWT tokens](assets/i45_02_2d02dd9c.svg)

Sessions keep state on the server behind an opaque cookie id, so logout is deleting one row. Tokens carry signed claims and need no lookup, but they stay valid until they expire.

That is the trade-off: where the state lives, and who can revoke it. Sessions cost a store lookup per request and are a bit harder to spread across many servers. Tokens spread easily, and you pay with revocation work and a larger credential. Revoking a token early needs a denylist, or short-lived access tokens plus refresh tokens.

A third pattern is federated login, OAuth 2.0 and OpenID Connect. Your app does not check the password. A provider such as Google, GitHub, or a company single sign-on authenticates the user and gives your app a token that says this is user X. OAuth itself is delegated authorization: permission to act on a resource. OpenID Connect adds an identity token on top. "Sign in with Google" is that identity layer.

## Code examples

A login route checks the credential and starts a session. The password is never stored or compared as plaintext. Hashing is its own lesson. The shape of the flow is what matters here.

javascript

```
const express = require('express');
const bcrypt = require('bcrypt');
const app = express();
app.use(express.json());

app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {}; // Express 5: req.body is undefined when no JSON body was sent

  // 1. Identification: find the claimed user
  const user = await User.findOne({ email });

  // 2. Verification: compare credential against stored hash.
  //    Always run the compare even if user is missing, to avoid
  //    leaking which emails exist via response timing.
  const hash = user ? user.passwordHash : '$2b$12$invalidinvalidinvalidinvalidinv';
  const ok = await bcrypt.compare(password, hash);

  if (!user || !ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // 3. Session establishment (stateful example)
  req.session.userId = user.id;
  req.session.role = user.role;
  res.json({ ok: true });
});
```


Authorization is separate from authentication. `requireAuth` only checks identity. `requireRole` checks permission. Splitting them stops the bug where "logged in" is treated as "allowed".

javascript

```
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// authN first, then authZ
app.get('/admin/stats', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ users: 1234 });
});
```


An ownership check depends on this resource, not a static role. That stops an insecure direct object reference: user A guesses user B's order id.

javascript

```
app.get('/orders/:id', requireAuth, async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  // AuthZ: the user must OWN this resource (or be admin).
  // Never trust the id in the URL to belong to the caller.
  if (order.userId !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(order);
});
```


## Common mistakes & gotchas

- **Treating "logged in" as "allowed".** Every protected resource needs its own check. Ownership needs a per-object check, not only a role.
- **Trusting a client-supplied id.** A `userId` in the body or a hidden form field is attacker-controlled. Identity comes from the verified session or token.
- **Leaking which accounts exist.** Different messages for "no such user" and "wrong password", or a faster response when the email is unknown, lets attackers list valid emails. Use one message and similar work for both.
- **Inventing session ids.** Use a vetted library and `crypto.randomBytes`, not `Math.random()`.
- **Swapping 401 and 403.** A 401 for a known user who is forbidden, or a 403 for someone who simply needs to log in, confuses clients and can hint that a resource exists.
- **Checking permission only in the browser.** Hiding a button is interface, not security. The server enforces every check.

## Best practices

- **Separate the two checks.** One middleware proves identity. Another, or the handler, checks permission.
- **Keep the access rule in one place,** a policy function or a middleware factory, so copies do not drift.
- **Use proven pieces:** Passport, express-session, jsonwebtoken, and an OAuth or OpenID Connect provider.
- **Pick sessions or tokens for the shape of the app.** One server-rendered backend: sessions are simpler and revocable. A public API, a mobile client, or many services: short-lived tokens fit better.
- **Fail closed.** If the store is down or the token will not parse, deny.
- **Log logins, failures, and denials.** Do not log the credentials.

## ⭐ Interview lens

> **Q: What is the difference between authentication and authorization?**  
> A: Authentication answers who the caller is. The user presents a credential, a password, a one-time code, a Google login, or a passkey, and the server checks it against something it trusts. The output is a proven identity, for example this request belongs to user 42. Authorization answers what that identity may do to one resource. The output is allow or deny. You authenticate once at login and authorize on every protected request, because being logged in does not mean the user may edit every post. HTTP uses the same split. A 401 means the server does not know who you are and wants a login. A 403 means the identity is known and the action is forbidden. The limit is using a role as a stand-in for ownership. "Is this an editor?" does not answer "does this user own this post?"

> **Q: Sessions or tokens — how do you choose? (trap)**  
> A: A session is server-side state. The browser holds only a random id in a cookie, and the server looks that id up in a store such as Redis. Delete the row and the next request fails, so logout and bans are instant. A token, usually a JWT, is a signed packet of claims the client sends back. Any server that has the key can check it with no shared store, which is why tokens fit a public API or several services. The limit is revocation. A token stays valid until it expires, so an early logout needs a denylist or a short access token plus a refresh token you can delete. For one server-rendered app, sessions are usually the simpler and safer choice. For mobile clients and many services, short-lived tokens fit better. "Stateless is modern" is not a reason by itself.

> **Q: A user reports they can view another user's invoice by changing the id in the URL. What went wrong?**  
> A: This is broken access control, specifically an insecure direct object reference. The route authenticated the caller, so it knew who they were, but it never checked that this user may see this invoice. The id in the URL is just input. Anyone can change it. The fix is an ownership check in the handler: load the invoice, and allow it only if the owner matches the identity from the session or token, or the caller is an admin. Otherwise return 403, or 404 if you do not want to reveal that the id exists. A role such as "customer" is not enough, because every customer would pass it. The limit is that the check has to use the identity the server proved, never a user id sent in the body or the query string.

> **Q: Why is 401 called "Unauthorized" if it means unauthenticated?**  
> A: The HTTP spec named 401 "Unauthorized" even though the meaning is "you have not proved who you are". Clients are expected to authenticate, and the response often includes a WWW-Authenticate header that says how. 403 Forbidden is the real authorization failure: the server knows the identity and still refuses the action. In an API, use 401 when there is no session or the token is missing, invalid, or expired. Use 403 when the token is valid and this user may not touch this resource. The limit of the names is that they are easy to swap, and a wrong code can leak whether a resource exists. Pick the code from the concept, not from the English word in the label.

## Cheat-card

- **Authentication** = who are you. Check a credential, get a proven identity, once at login.
- **Authorization** = what may you do on this resource, on every request.
- **401** = not authenticated. **403** = authenticated but not allowed.
- **Sessions:** state on the server, opaque cookie id, instant revoke, one lookup per request.
- **Tokens:** signed claims on the client, no lookup, hard to revoke before expiry.
- **OAuth** = delegated authorization. **OpenID Connect** = the identity layer on top of it.
- Identity comes from the verified session or token, never from the request body.
- Ownership checks are per object, not only per role.

## Good to know

- **What does OAuth 2.0 give you, and is it authentication?** OAuth 2.0 is delegated authorization, not login by itself. OpenID Connect adds the identity token, which is what "Sign in with Google" uses.
- **Why is client-side authorization not enough?** The caller controls the browser, so they can skip any button you hide. The server must decide allow or deny on every request.

---

## Learn More

- [Authentication Cheat Sheet — OWASP cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Authorization Cheat Sheet — OWASP cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [HTTP authentication — MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication)
- [Auth0 in 100 Seconds // And beyond with a Next.js Authentication Tutorial Fireship](https://www.youtube.com/watch?v=yufqeJLP1rI)
