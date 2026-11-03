---
title: "Web Security & OWASP"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/web-security-owasp
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Web Security & OWASP

*13 min read · Updated 24 Jul 2026 Topic 52 of 70 Bookmark Mark done Why it matters Authentication and password hashing protect the front door · Topic 52 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/web-security-owasp](https://www.geekyfrontend.in/learn/nodejs-backend-kit/web-security-owasp)

---

## Say it in 30 seconds

Web security here means stopping untrusted input from being treated as a query, as HTML, or as a command, and the OWASP Top 10 is the shared list of the risks that actually cause breaches. Login and password storage only cover the front door. No single control is enough, so a request passes headers, rate limits, authentication, authorization, and validation, and the handler still uses parameterized queries.

## Why it matters

An attacker can push on the query you run, the HTML you render, requests from other sites, the packages you install, and the secrets you ship. For Node, three flavors show up often: MongoDB operator injection from an unvalidated object, prototype pollution from an unsafe merge, and a deep dependency tree where one transitive package is vulnerable. The interview test is not reciting ten names. It is looking at a route and naming the concrete fix.

## The concept, simply

Almost every web bug is the same root: **untrusted input crosses a trust boundary and gets interpreted**. User input becomes part of a database query, part of an HTML page, part of a shell command, or part of an object you merge into config. Treat data as data. Parameterize, escape, validate, and keep it separate from code.

CSRF is a bit different. It abuses the browser's habit of attaching cookies, so a logged-in user performs an action they did not intend. A second class of problems is hygiene: leaked secrets, missing security headers, old dependencies, and no rate limit.

![A grid of six common web risks — injection, XSS, CSRF, broken access control, secrets exposure, vulnerable dependencies — each with its one-line fix](assets/i49_01_f07cd3c6.svg)

Injection, cross-site scripting, cross-site request forgery, broken access control, secret exposure, and vulnerable dependencies are the recurring Node risks. Each has a concrete mitigation, and real security stacks them.

**Defense in depth** means you assume any one layer can fail. A request should pass secure headers, rate limiting, authentication, authorization, and input validation before business logic, and the handler should still parameterize queries and escape output.

![A request passing left-to-right through helmet, rate limiting, CORS, auth, validation, and the handler before producing a safe response](assets/i49_02_4844fb21.svg)

Layered middleware filters the request before the handler. The handler still parameterizes queries and escapes output. Each layer assumes the others might fail.

## How it works

**Injection.** It happens when input is concatenated into a query or a command, so the attacker's data is parsed as code. In SQL, building the statement with string addition lets `' OR '1'='1` change the meaning. Parameterized queries, also called prepared statements, send the statement shape and the values separately, so a value cannot become SQL. In MongoDB the matching bug is passing a user object straight in: an email field that is actually `{ "$ne": null }` is an operator, not a string. Coerce to the type you expect. Command injection through `child_process.exec` with user input is avoided by skipping the shell: `execFile` or `spawn` with an argument array.

**XSS, cross-site scripting.** Attacker text is rendered as HTML and runs as script in another user's browser. It can steal cookies that are not HttpOnly, steal tokens, or act as the victim. Stored XSS is saved, for example in a comment. Reflected XSS bounces off the request. DOM-based XSS happens in the browser. Escape output for the context it lands in, do not assign untrusted data to innerHTML, sanitize HTML you must allow, and set a Content-Security-Policy header so a script that does get injected is blocked from running.

**CSRF, cross-site request forgery.** The browser attaches cookies by itself, so another site can submit a state-changing request, such as a hidden form POST to your transfer route, and your server sees a valid session. Defenses: SameSite Lax or Strict so the cookie is not sent on a cross-site POST, a CSRF token the attacker cannot read, and checking Origin or Referer. Cookie auth is the exposed case. A token you put in an Authorization header is not attached automatically, so it is less exposed to this trick.

**helmet** sets a bundle of response headers: Content-Security-Policy, Strict-Transport-Security to force HTTPS, X-Content-Type-Options nosniff, frame protections against clickjacking, Referrer-Policy, and it removes the X-Powered-By fingerprint. One line raises the baseline. The content security policy usually needs tuning for the scripts you actually load.

**Rate limiting** caps how many requests an IP or user can make in a window. That slows brute-force login, credential stuffing, scraping, and simple denial of service. `express-rate-limit`, backed by Redis when you run more than one instance, does this. Login and password reset get stricter caps. Strong hashing raises the cost of offline guessing after a leak. Rate limiting raises the cost of online guessing against the live login. You need both.

**Secrets.** API keys, database passwords, and signing secrets do not belong in source or in a client bundle. Bots scrape public repos quickly. Load them from the environment or a secret manager, keep `.env` out of git, rotate them, and treat any exposure as rotate-now. Anything shipped to the browser is not a secret.

**Dependencies.** Most of `node_modules` is code you did not write. Known vulnerabilities there are a top risk. Run `npm audit`, use Dependabot or Snyk, commit a lockfile, add fewer packages, and look at a package before you depend on it.

## Code examples

Parameterized queries stop SQL injection. NoSQL needs a type check so an object cannot smuggle operators.

javascript

```
// SQL — VULNERABLE: input becomes part of the query
db.query(`SELECT * FROM users WHERE email = '${req.body.email}'`);

// SQL — SAFE: driver sends structure and values separately
db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);

// MongoDB — VULNERABLE: an object like { $ne: null } injects an operator
await User.findOne({ email: req.body.email, password: req.body.password });

// MongoDB — SAFE: coerce to the expected type so operators can't sneak in
await User.findOne({ email: String(req.body.email) }); // then verify hash separately
```


A hardened Express app: helmet, a global limiter and a stricter login limiter, a body size limit, and CORS restricted to an allow-list.

javascript

```
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const app = express();

app.use(helmet());                         // secure headers + removes X-Powered-By
app.use(express.json({ limit: '10kb' }));  // cap body size to blunt DoS
app.use(cors({ origin: ['https://myapp.com'], credentials: true })); // allow-list only

// Global limiter
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300 })); // `limit` (was `max` before express-rate-limit v7)

// Strict limiter on auth endpoints to stop brute force / credential stuffing
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5 });
app.post('/login', loginLimiter, handleLogin);
```


Escaping output stops XSS. A Content-Security-Policy is the backstop. Auto-escaping templates cover most of this.

javascript

```
// Auto-escaping via a template engine (EJS/Pug/Handlebars escape by default):
// res.render('profile', { name: user.name });  // {{name}} is HTML-escaped

// If you must build HTML manually, escape untrusted text:
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Backstop: a CSP header so even an injected script won't run inline
app.use(helmet.contentSecurityPolicy({
  directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], objectSrc: ["'none'"] },
}));
```


A schema, zod or joi, is one choke point that rejects bad input before your logic sees it.

javascript

```
const { z } = require('zod');

const RegisterSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  age: z.number().int().min(13).max(120).optional(),
});

app.post('/register', (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  // parsed.data is now typed, trimmed of unknown keys, and correctly typed
  createUser(parsed.data);
  res.status(201).json({ ok: true });
});
```


Command injection is avoided by never passing user input through a shell. Pass arguments as an array.

javascript

```
const { execFile } = require('child_process');

// VULNERABLE: exec runs a shell, so input like "; rm -rf /" is interpreted
// exec(`convert ${req.body.file} out.png`);

// SAFE: no shell; the filename is a single, un-parsed argument
execFile('convert', [req.body.file, 'out.png'], (err, stdout) => { /* ... */ });
```


## Common mistakes & gotchas

- **Building queries by concatenating input.** Parameterize SQL. Coerce types for NoSQL.
- **Passing raw request objects into Mongo queries.** An object value enables `$ne` or `$gt`. Coerce to the primitive you expect.
- **Rendering untrusted data as HTML.** innerHTML, turning off template escaping, or unsanitized HTML is XSS. Escape, or sanitize.
- **Assuming an API is immune to CSRF.** Any cookie-authenticated state-changing route is exposed. Set SameSite and use a CSRF token.
- **Committing secrets.** A key in the repo, the client bundle, or a log is leaked. Rotate it. Deleting the commit is not enough, because history and clones still have it.
- **Trusting browser validation.** Attackers use curl. Validate on the server.
- **Ignoring `npm audit`.** A vulnerability you did not write is still yours to fix.
- **Verbose errors.** Stack traces and SQL errors help an attacker map you. Return a generic error. Log the detail on the server.
- **No rate limit on login.** Unlimited attempts mean brute force, however good the hash is.

## Best practices

- **Parameterize every query and validate every input** at one choke point, and coerce types so operator, HTML, and command injection are hard to express.
- **Escape output for its context, and set a Content-Security-Policy,** so XSS is blocked at render and again at execution.
- **SameSite cookies plus a CSRF token** on cookie-authenticated state-changing routes.
- **helmet and a body size limit** on every app. Tune the content security policy to your real script sources.
- **Rate-limit globally, and harder on login,** with a shared store when you run more than one instance.
- **Secrets in the environment or a secret manager,** never in git or the client bundle. Rotate on suspicion.
- **`npm audit`, automated scanning, a lockfile, and fewer dependencies.**
- **Least privilege** on database users and service accounts, generic client errors, HTTPS, and security-event logs.

## ⭐ Interview lens

> **Q: How do you prevent SQL/NoSQL injection in Node?**  
> A: Injection means untrusted input is parsed as code. For SQL, do not concatenate the value into the statement. Use a parameterized query, also called a prepared statement, so the driver sends the statement shape and the values separately. A value like a quote and OR 1 equals 1 stays a string, and it cannot change the WHERE. For MongoDB the matching bug is an object: if email is actually `{ "$ne": null }`, the query becomes "email is not null" and returns every user. Coerce the field to a string, or validate it with a schema, before it reaches the driver. For example, a login route that builds SQL with plus signs is injectable, and the same route with a placeholder is not. The limit is identifiers. Table and column names cannot be bind parameters, so if one of those must vary, pick it from a fixed allow-list in code.

> **Q: XSS vs CSRF — what's the difference? (trap)**  
> A: XSS and CSRF are different bugs that people mix up. XSS injects script into a page your users load, so it runs in their browser. It is an output-encoding problem: escape for the HTML context, do not use innerHTML on untrusted text, and set a Content-Security-Policy so an injected script is blocked from running. CSRF does not inject script. It makes the victim's browser send a request they did not mean to send, and the browser attaches the session cookie automatically. A hidden form on another site can POST to your transfer route and your server sees a logged-in user. SameSite cookies and a CSRF token stop that. For example, a comment that contains a script tag is XSS. A page on evil.example that posts to your bank is CSRF. The limit is that XSS can often steal what a CSRF token was protecting, so fixing XSS is the foundation, and header-token auth is naturally less exposed to CSRF than cookie auth.

> **Q: What does helmet actually do, and is it enough on its own?**  
> A: Treat the key as already stolen. Public repos are scraped quickly, and deleting the commit or force-pushing does not help, because the secret is in history and in anyone's clone. Revoke or rotate it now, then look for use of the old value. Move the new secret to the environment or a secret manager, add the file to gitignore, and add a secret scan in CI so the next commit fails if a key shows up. For example, a database password committed on Monday is a password you rotate on Monday, not after the next deploy. The limit of rotation is the clients that still have the old value. Plan a short overlap only if you must, and do not leave the old key valid "until we are sure". Anything that shipped in a frontend bundle is public even if it never hit git.

> **Q: Why is a fast password hash relevant to OWASP, and how does rate limiting relate?**  
> A: Defense in depth means independent controls, so one miss is not a breach. On an Express route that looks like this: helmet sets the security headers, a rate limiter caps bursts, CORS and a body size limit reject unexpected callers and huge payloads, authentication proves who the caller is, authorization including an ownership check decides if this caller may touch this id, and a schema validates the body. The handler still uses a parameterized query and escapes anything it renders. For example, a valid session does not skip the ownership check, and a schema that coerced email to a string does not replace the SQL placeholder. The limit is that the layers have to be real. A helmet default with an untuned content security policy, or validation only in the browser, is not a layer. Each control should still work if the one in front of it failed.

## Cheat-card

- **Root cause:** untrusted input treated as code. Parameterize, escape, validate.
- **Injection:** SQL uses prepared statements. NoSQL coerces types so `$ne` and `$gt` cannot slip in. Commands use `execFile` or `spawn` with an argument array, not a shell.
- **XSS:** escape for the context, add a Content-Security-Policy, sanitize HTML you must allow, never assign untrusted data to innerHTML.
- **CSRF:** SameSite plus a CSRF token. This hits cookie auth, not a token you set in a header yourself.
- **helmet:** CSP, HSTS, nosniff, frame protection, removes X-Powered-By. A baseline, not the whole defense.
- **Rate limit** globally, and stricter on login.
- **Secrets:** environment or a secret manager. A leak means rotate now.
- **Dependencies:** `npm audit`, Dependabot or Snyk, and a lockfile. Validate on the server. Stack the layers.

## Good to know

- **What does helmet do, and is it enough?** It sets protective response headers, including CSP, HSTS, nosniff, and frame protections, and it removes X-Powered-By. It does not parameterize queries, validate input, authorize, or rate-limit. Tune CSP for your real scripts.
- **Why does password hashing show up next to rate limiting?** Weak hashing is an authentication failure in the OWASP list and it raises the cost of offline guessing after a leak. Rate limiting and lockout raise the cost of online guessing against the live login. You need both.

---

## Learn More

- [OWASP Top Ten Web Application Security Risks owasp.org](https://owasp.org/www-project-top-ten/)
- [OWASP Cheat Sheet Series cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/)
- [Web security (MDN) developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/Security)
- [OWASP API Security Top 10 Course – Secure Your Web Apps freeCodeCamp.org](https://www.youtube.com/watch?v=YYe0FdfdgDU)
