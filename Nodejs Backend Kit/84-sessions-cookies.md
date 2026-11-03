---
title: "Sessions & Cookies"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/sessions-cookies
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Sessions & Cookies

*11 min read · Updated 24 Jul 2026 Topic 50 of 70 Bookmark Mark done Why it matters Cookies are the oldest and still the most widely used way to keep a user logged in across the stateless HTTP protocol · Topic 50 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/sessions-cookies](https://www.geekyfrontend.in/learn/nodejs-backend-kit/sessions-cookies)

---

## Say it in 30 seconds

A session keeps the user's data on the server and puts only a random id in a cookie, which the browser sends back automatically so the server can look that user up. HTTP itself forgets every request, and the cookie is how the browser carries the id. You need a shared store if you run more than one process, and the cookie flags decide whether a script, a plain HTTP hop, or another website can use that id.

## Why it matters

Cookies are still how most server-rendered apps and admin panels stay logged in. A stolen or forgeable session cookie is a full account takeover, with no password required. Three flags, HttpOnly, Secure, and SameSite, are one configuration line that closes or opens script theft, network sniffing, and cross-site requests. Interviewers ask about them because each flag stops a different attack.

## The concept, simply

A **cookie** is a small name and value the server asks the browser to store and send back on later requests to that site. The server sets it with a Set-Cookie response header. The browser returns it in the Cookie request header on its own. That automatic send is why cookies work for sessions, and why a malicious site can try to ride them.

A **session** is server-side state for one user across requests. Store the real data, user id, roles, cart, on the server. Put only a random, unguessable session id in the cookie. The cookie is a claim ticket. The server holds the data.

![A request carrying a session cookie being looked up in a server-side store to rehydrate the user](assets/i47_01_853bd6a9.svg)

The browser sends an opaque session id. express-session looks it up in Redis or Mongo, fills req.session, and the route knows the user. The real data never leaves the server.

Because the cookie is only a pointer, it stays small, sensitive data stays off the client, and logout is instant: delete the session row and the id is worthless.

## How it works

On login the server sends a Set-Cookie for the session id, with flags such as HttpOnly, Secure, SameSite=Lax, Path=/, and a Max-Age. The browser stores it and later sends Cookie with that id. The flags are instructions to the browser. They are not sent back as data. They control when the browser is willing to attach the cookie.

The id is looked up in a store. The default in-memory store is for development only: it leaks memory, it dies on restart, and other processes cannot see it. Production uses Redis, MongoDB, or a SQL table so sessions survive restarts and are shared across instances. That shared store is the cost of stateful sessions, and it is why some teams pick stateless tokens instead.

There are two flavors. In the usual server-side session, the cookie holds a random id and the data lives in the store. The id is signed with HMAC so the server can see tampering. In a client-side cookie session, the whole payload is serialized into the cookie and signed, sometimes encrypted. That skips the store, but the cookie grows, the client can read the data, and you cannot revoke it by deleting a row. In both cases the signature stops a user editing the cookie to raise their own role.

Each flag stops a specific attack:

- **HttpOnly.** JavaScript cannot read the cookie, so a script injection cannot steal the session. Every auth cookie should set this.
- **Secure.** The browser sends the cookie only over HTTPS. Without it, the cookie can leak on plain HTTP.
- **SameSite.** Controls cross-site sending, which is the main CSRF defense. Strict never sends the cookie on a cross-site request, which is safest, but a link from another site arrives logged out. Lax, the modern browser default, sends it on top-level GET navigations and not on cross-site POSTs. None sends it on every cross-site request, requires Secure, and is for real third-party embeds.
- **Domain and Path.** Which hosts and paths receive the cookie. Keep them narrow. A parent domain shares the cookie with every subdomain.
- **Max-Age or Expires.** How long it lives. No expiry means it dies when the browser closes. An explicit age makes it persistent. Shorter is safer.

**Session fixation.** If the server keeps the same session id before and after login, an attacker who plants a known id in the victim's browser can use that id after the victim logs in. Regenerate the id at login with `req.session.regenerate()`.

## Code examples

express-session with a Redis store and hardened cookie flags. These options are the difference between a dev setup and a production one.

javascript

```
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.connect();

app.set('trust proxy', 1); // trust the reverse proxy so Secure cookies work behind it

app.use(session({
  store: new RedisStore({ client: redisClient }), // NOT the default MemoryStore
  secret: process.env.SESSION_SECRET,             // signs the session id cookie
  name: 'sid',                                    // don't advertise the framework
  resave: false,                                  // don't rewrite unchanged sessions
  saveUninitialized: false,                       // don't create sessions for anon visitors
  cookie: {
    httpOnly: true,        // JS can't read it -> XSS can't steal it
    secure: true,          // HTTPS only
    sameSite: 'lax',       // CSRF defense for top-level navigation
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  },
}));
```


Login writes the session, and regenerates the id first so a pre-login id cannot become authenticated.

javascript

```
app.post('/login', async (req, res, next) => {
  const user = await authenticate(req.body);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  // Regenerate the session id on privilege change to defeat fixation
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.save((err2) => {   // ensure it's persisted before responding
      if (err2) return next(err2);
      res.json({ ok: true });
    });
  });
});
```


Protected routes read the session. Logout destroys the server-side record, not only the cookie.

javascript

```
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {          // deletes the record from the store
    res.clearCookie('sid');               // and drop the cookie client-side
    res.json({ ok: true });
  });
});
```


A raw cookie, outside the session library, shows the same flags. This example is a non-sensitive preference.

javascript

```
app.get('/set-theme', (req, res) => {
  res.cookie('theme', 'dark', {
    httpOnly: false,      // this one is fine for JS to read; it's not a credential
    secure: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 365,
    path: '/',
  });
  res.json({ ok: true });
});
```


## Common mistakes & gotchas

- **Shipping MemoryStore to production.** It leaks memory, wipes everyone on restart, and is not shared across instances. Use a real store.
- **No HttpOnly on the session cookie.** Any injected script can read document.cookie and steal the session.
- **No Secure, or a proxy that hides HTTPS.** The cookie can travel in clear text. Behind a load balancer, set `trust proxy` or the framework thinks the connection is insecure and drops the Secure cookie.
- **No explicit SameSite.** Browser defaults differ. Set Lax or Strict yourself.
- **Same session id across login.** That is session fixation. Call `req.session.regenerate()` when privileges change.
- **Clearing the cookie and leaving the store row.** A copied cookie still works. Logout must destroy the server record.
- **A wide Domain.** Scoping the session cookie to `.example.com` shares it with every subdomain.

## Best practices

- **Set HttpOnly, Secure, and an explicit SameSite** on every auth cookie.
- **Use a production store,** commonly Redis, so sessions survive restarts and more than one instance.
- **Regenerate the id on login, and destroy the session on logout.**
- **Keep the cookie to the id.** Store the data on the server. Rename the cookie so it does not advertise the framework. Set `saveUninitialized: false` so anonymous visitors do not get a session.
- **Keep lifetimes short,** including idle and absolute timeouts, so a stolen cookie is worth less.
- **Behind a proxy, set `trust proxy`** so Secure cookies and client IPs are correct.
- **Pair cookie sessions with CSRF protection.** SameSite plus a token on state-changing requests, because the browser sends cookies by itself.

## ⭐ Interview lens

> **Q: What do HttpOnly, Secure, and SameSite each protect against?**  
> A: HttpOnly, Secure, and SameSite are three instructions to the browser, and each closes a different attack. HttpOnly means JavaScript cannot read the cookie, so a cross-site scripting bug cannot steal the session id with document.cookie. Secure means the browser attaches the cookie only on HTTPS, so it does not leak on a plain network. SameSite decides whether the cookie is sent on a request that started on another site, which is the main defense against cross-site request forgery, where a malicious page submits a form to your app and the browser attaches the victim's cookie. You set all three on an auth cookie because passing one check does not cover the other two. The limit is that flags are browser rules, not server checks. You still regenerate the id at login, destroy the store row on logout, and keep a real session store in production.

> **Q: Why not store the session data directly in the cookie? (trap)**  
> A: The usual session cookie holds only a random id. The user id, roles, and cart live in a server store, and the server looks the id up on each request. You can put the whole payload in a signed cookie instead, and that avoids a store, but the cookie then rides on every request, the client can read the fields even if it cannot edit a valid signature, and logout is hard because the state is on the client until the cookie expires. A server-side row deletes in one call and the next request fails. For example, a signed cookie that contains role admin stays admin until it expires even after you demote the user, unless you add a version check. The limit of the pointer model is the store: MemoryStore is per process and dies on restart, so production needs something shared, usually Redis.

> **Q: What is session fixation and how do you prevent it?**  
> A: Session fixation is planting a session id you already know, then waiting for the victim to log in on that same id. If the server keeps the id across login, your cookie is now an authenticated session and you did not need the password. It works because the id was valid before login and the server never replaced it when the privilege changed. The fix is to regenerate the id at login, `req.session.regenerate()`, so the pre-login id no longer points at anything. Do the same on any privilege change, not only the first login. The limit is that regeneration does not replace the other cookie flags. A new id that is readable by script, or sent on a cross-site POST, is still stealable. Fixation defense and the flags solve different problems.

> **Q: Why is the default express-session MemoryStore unsafe for production?**  
> A: SameSite tells the browser when a cookie may be attached to a request that did not start on your site. Strict never sends it cross-site, which blocks the most CSRF, but a user who follows a link from email or another site arrives logged out because the cookie was withheld. Lax is the usual choice and the modern browser default: the cookie is sent on a top-level GET navigation, so those links still look logged in, and it is not sent on a cross-site POST or a subresource load, which is how a forged form attack works. None sends the cookie on every cross-site request, which you need for a legitimate third-party embed, and the browser requires Secure alongside it. The limit is that Lax is not a complete CSRF story for every app. State-changing GET routes would still carry the cookie, so keep changes on POST and add a CSRF token where the cookie is the credential.

## Cheat-card

- **Cookie:** server sets it with Set-Cookie. The browser sends it back on the Cookie header.
- **Session:** opaque id in the cookie, real data in a server store. Redis in production, not MemoryStore.
- **HttpOnly** blocks script theft. **Secure** means HTTPS only. **SameSite** is the CSRF control.
- **SameSite:** Strict sends nothing cross-site. Lax sends top-level GETs. None sends all cross-site requests and needs Secure.
- **Fixation:** regenerate the session id on login.
- **Logout:** `req.session.destroy()`, not only clearCookie.
- Behind a proxy, `app.set('trust proxy', 1)` so Secure cookies stick.
- `saveUninitialized: false`, rename the cookie, and keep it to the id.

## Good to know

- **Why is the default express-session MemoryStore unsafe in production?** It keeps sessions in the Node process, leaks old ones, wipes them on restart, and is not shared, so a second instance does not see the session. Use an external store such as Redis.
- **The user logged out but the old cookie still works.** Logout only cleared the cookie and left the store row. A copy of the cookie still resolves. Logout must call `req.session.destroy()` and then clear the cookie.

---

## Learn More

- [Using HTTP cookies — MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
- [Session Management Cheat Sheet — OWASP cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [Set-Cookie header — MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)
- [Session vs Token Authentication in 100 Seconds Fireship](https://www.youtube.com/watch?v=UBUNrFtufWo)
