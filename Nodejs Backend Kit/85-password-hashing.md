---
title: "Password Hashing"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/password-hashing
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Password Hashing

*12 min read · Updated 24 Jul 2026 Topic 51 of 70 Bookmark Mark done Why it matters Storing passwords is one of the few pieces of code where a single wrong decision can harm millions of people · Topic 51 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/password-hashing](https://www.geekyfrontend.in/learn/nodejs-backend-kit/password-hashing)

---

## Say it in 30 seconds

Password hashing stores a one-way result of the password mixed with a unique random salt and run through a deliberately slow function, and at login you hash the guess the same way and compare. A database leak should not hand out usable passwords, because people reuse them. The trade-off is speed: slow enough that guessing millions of passwords is expensive, and still quick enough for one real login.

## Why it matters

Breaches are routine. The question is what an attacker can do with the dump. Plaintext passwords mean they log in as every user, including on other sites. A proper password hash means they spend years and still fail. Interviewers use this to see whether you know a fast hash such as SHA-256 is the wrong tool, and whether you can explain salt, cost, and timing-safe compare.

## The concept, simply

You should not be able to recover the password from what you store, not even as the operator. Store a **one-way hash**. At login, hash the submitted password the same way and compare. Easy to compute forward, infeasible to reverse.

A plain hash is not enough. Identical passwords produce identical hashes, so an attacker can precompute common passwords, a rainbow table, and match them in bulk. A **salt** is a unique random value mixed in before hashing, so the same password looks different for every user and the table is useless. General-purpose hashes such as SHA-256 are also fast. GPUs compute billions per second. A password **key derivation function** such as bcrypt or argon2 is deliberately expensive, and you can raise the cost as hardware gets faster.

![Password combined with a random salt then run through a slow KDF to produce a stored hash, contrasted with fast unsalted hashes](assets/i48_01_656eb6b4.svg)

A password plus a unique salt goes through a slow, cost-tuned function, bcrypt or argon2, and that string is what you store. Fast unsalted hashes such as MD5 or SHA-256 fall to rainbow tables and GPU guessing.

Salt kills precomputation. Slowness kills mass guessing. bcrypt and argon2 do both, and they embed the salt and the cost in the output string so you do not store them in extra columns.

## How it works

**Plaintext is indefensible.** If the database leaks, every password is immediately usable, and reuse turns your breach into the user's email and bank. Reversible encryption is the same class of mistake for authentication passwords. You can recover the original.

**Fast hashes fail here.** MD5, SHA-1, and SHA-256 were built to be fast for file integrity. That speed is the problem. An attacker with the dump runs a wordlist at billions of guesses a second. Unsalted, they also fall to rainbow tables. SHA-256 is a fine hash. It is the wrong tool for passwords because it is not slow and it has no salt built in.

**Salt.** A random value, often 16 bytes, is generated per user and stored with the hash. The function hashes salt plus password. Two users with the password hunter2 get different stored strings, so shared passwords are not obvious, and a rainbow table would have to be rebuilt per salt. The salt is not secret. Its job is uniqueness. A **pepper** is an optional extra secret, stored outside the database, mixed in on top.

**bcrypt** is built on the Blowfish cipher with a cost factor, also called work factor or rounds. Cost 12 means 2 to the 12, or 4096, iterations of key setup. Each increment doubles the work. Raise the cost as hardware speeds up so an attacker stays slow and one real login stays a fraction of a second. bcrypt generates the salt and embeds everything in one string: algorithm, cost, salt, and digest, in the shape `$2b$12$` plus the salt and the hash. One column, no separate salt column. It silently truncates input past 72 bytes.

**argon2id** won the 2015 Password Hashing Competition and is the recommendation for new systems. It is slow, and it is memory-hard: it needs a configurable amount of RAM, which hurts GPUs and custom chips that have lots of parallel compute and little memory per core. You tune time, memory, and parallelism. bcrypt is still acceptable and heavily used. argon2id is the better new design when memory hardness matters. scrypt is another memory-hard option. PBKDF2 is older, not memory-hard, and still used where FIPS compliance requires it.

**Timing.** The library compare function checks the digests in constant time. A naive byte-by-byte compare returns faster when the first mismatch is early, which leaks how much of a guess was right. Use `bcrypt.compare`, `argon2.verify`, or `crypto.timingSafeEqual`, never `===`, for secrets. A related leak is the account level: responding faster when the email does not exist tells attackers which emails are registered. Always run a hash compare, against a dummy hash if the user is missing, and return one generic error.

## Code examples

Hash on registration with bcrypt. You pass a cost. The library generates the salt and embeds it.

javascript

```
const bcrypt = require('bcrypt');
const COST = 12; // work factor — tune so one hash takes ~200-300ms on your hardware

app.post('/register', async (req, res) => {
  const { email, password } = req.body ?? {}; // Express 5: req.body is undefined when no JSON body was sent
  if (password.length < 8) return res.status(400).json({ error: 'Too short' });

  // Salt is generated automatically and stored inside the hash string
  const passwordHash = await bcrypt.hash(password, COST);

  await User.create({ email, passwordHash });
  res.status(201).json({ ok: true });
});
```


`bcrypt.compare` pulls the salt and cost out of the stored string and compares in constant time. The dummy hash keeps the work similar when the user is missing.

javascript

```
// A fixed dummy hash so we do equal work whether or not the user exists
const DUMMY = '$2b$12$C6UzMDM.H6dfI/f/IKcEeOjHVQz.iC1p1w1z8m3M0nJ0oQ8qKx8Iu';

app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  const user = await User.findOne({ email });

  // Always run compare (against DUMMY if no user) to keep timing uniform
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY);

  if (!user || !ok) {
    return res.status(401).json({ error: 'Invalid credentials' }); // one generic message
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Server error' });
    req.session.userId = user.id;
    res.json({ ok: true });
  });
});
```


argon2id for a new system, with memory and time set explicitly.

javascript

```
const argon2 = require('argon2');

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,  // ~19 MiB — memory-hardness defeats GPU/ASIC attackers
    timeCost: 2,        // iterations
    parallelism: 1,
  });
}

async function verifyPassword(hash, password) {
  return argon2.verify(hash, password); // timing-safe; reads params from the hash
}
```


The same constant-time idea for other secrets, such as an API key or an HMAC.

javascript

```
const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match first; timingSafeEqual throws on unequal lengths
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB); // does NOT short-circuit on first diff
}
```


Because the stored string records its own parameters, you can re-hash with a higher cost the next time that user logs in.

javascript

```
async function loginAndMaybeUpgrade(user, password) {
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return false;

  // If the stored cost is below our current target, re-hash now (we have the plaintext)
  const currentCost = Number(user.passwordHash.split('$')[2]);
  if (currentCost < COST) {
    user.passwordHash = await bcrypt.hash(password, COST);
    await user.save();
  }
  return true;
}
```


## Common mistakes & gotchas

- **Plaintext or reversible passwords.** If you can recover the original, a breach is a full compromise. Authentication passwords are one-way hashes.
- **MD5, SHA-1, or SHA-256 as the password store.** Fast means brute force. Unsalted means rainbow tables. Use bcrypt, argon2, or scrypt.
- **One global salt, or no salt.** Precomputation and cross-user matching work again. Salts are unique per user. The libraries do this.
- **Comparing with `===`.** That leaks timing. Use the library compare or `crypto.timingSafeEqual`.
- **A cost frozen in 2013.** Pick a cost that takes a few hundred milliseconds now, and raise it later.
- **Telling attackers which emails exist.** Skipping the hash when the user is missing makes "no such user" faster. Always compare, and return one error.
- **bcrypt's 72-byte cap.** Input past 72 bytes is silently truncated. argon2 has no such cap.
- **Hashing in the browser and sending the hash.** The hash becomes the password. Hash on the server, over TLS.

## Best practices

- **argon2id for new systems. bcrypt where you already have it.** Both are salted, slow, and vetted. Do not use MD5 or SHA for passwords.
- **Let the library make the salt** and embed it. Do not invent a salting scheme.
- **Tune cost so one hash is about 200 to 300 milliseconds,** and raise it as hardware improves. Re-hash on login to upgrade old hashes.
- **Constant-time compare** via the library, and `crypto.timingSafeEqual` for other secrets.
- **One response for unknown user and wrong password,** and always run a hash compare.
- **Hash on the server over HTTPS.** Prefer a minimum length and checks against breached-password lists over clever composition rules.
- **A pepper is optional defense in depth,** stored outside the database. Rate-limit login to slow online guessing.

## ⭐ Interview lens

> **Q: Why not just hash passwords with SHA-256? (trap)**  
> A: SHA-256 is a fast integrity hash, and password storage needs the opposite. Attackers with a dumped hash database guess on GPUs at billions of hashes a second, so a fast function makes a wordlist cheap. SHA-256 also has no salt, so the same password always produces the same hash and falls to a precomputed rainbow table. A password key derivation function, bcrypt or argon2, mixes in a unique salt and is deliberately slow, with a cost you can raise. SHA-256 is not "broken" as a hash. It is the wrong tool for this job. For example, two users who both picked the same common password would be obvious in a SHA-256 column and not in a bcrypt column. The limit of switching algorithms is the hashes you already stored: you re-hash on the next successful login, because you cannot reverse the old SHA-256 either.

> **Q: What is a salt and what problem does it solve?**  
> A: A salt is a unique random value mixed into each password before hashing, and you store it with the hash. Its job is uniqueness, not secrecy, so it does not need to be encrypted. Two users who chose hunter2 then get different stored strings, which does two things: an attacker cannot see that they share a password, and a rainbow table built for unsalted hashes does not match. Rebuilding that table once per salt is not practical. bcrypt and argon2 generate the salt and embed it in the output string, which is why you keep one column. For example, the bcrypt string starts with the algorithm and the cost, then the salt, then the digest, and compare reads those back. The limit is that salt does not make guessing slow. A unique salt on a fast hash still falls to a GPU. You need the slow function as well. A pepper, if you add one, is the secret that stays outside the database.

> **Q: What does the bcrypt cost factor do, and how do you pick it?**  
> A: The bcrypt cost factor sets the work. Cost N means 2 to the N iterations of the key setup, so each step up doubles the time. You pick the highest cost a real login can tolerate, commonly aiming at about 200 to 300 milliseconds on your servers. One user waits a blink. An attacker guessing offline multiplies that cost by every guess. Because it is a parameter, you raise it when hardware gets faster, and you can re-hash an old password on the next good login because the stored string records the cost it was made with. For example, cost 12 is 4096 iterations, and cost 13 is twice that. The limit is bcrypt's 72-byte input cap: bytes past that are silently dropped, which matters for very long passwords or for schemes that pre-hash. argon2 does not have that cap.

> **Q: bcrypt vs argon2 — which and why?**  
> A: Both bcrypt and argon2 are salted, slow, and appropriate password hashes. bcrypt is older, heavily reviewed, and fine to keep. argon2id is the modern default for a new system because it is also memory-hard: computing it needs a configurable amount of RAM, which removes the advantage of GPUs and custom chips that have huge parallel compute and little memory per core. You tune argon2's time, memory, and parallelism. bcrypt only tunes the cost factor. For example, a new service would call argon2 with an explicit memory setting and store the one string it returns. The limit of "always migrate everything to argon2 tomorrow" is operational. Existing bcrypt hashes stay valid, and you upgrade a user when they next log in. Also remember bcrypt truncates at 72 bytes and argon2 does not.

## Cheat-card

- Never store plaintext or reversible passwords. Hash one way.
- Not MD5 or SHA for passwords. Fast and unsalted means GPU guessing and rainbow tables.
- Salt kills precomputation. Slowness kills mass guessing.
- **bcrypt:** cost is 2 to the N, salt embedded, output starts `$2b$12$`, 72-byte input cap.
- **argon2id:** modern default, memory-hard, tune memory and time.
- Salt is unique, public, per user. A pepper is an optional secret stored outside the database.
- Compare with `bcrypt.compare`, `argon2.verify`, or `crypto.timingSafeEqual`.
- Tune toward about 200 to 300 milliseconds, raise it over time, re-hash on login, and do not reveal which accounts exist.

## Good to know

- **What is a timing attack on a password or token compare?** A naive compare returns as soon as one byte differs, so the time leaks how many leading bytes were correct. Constant-time compare, `bcrypt.compare` or `crypto.timingSafeEqual`, always looks at the whole value.
- **Where is the salt stored, and should it be encrypted?** It sits inside the bcrypt or argon2 string next to the hash. It is not a secret. An extra secret stored outside the database is a pepper, not the salt.

---

## Learn More

- [Password Storage Cheat Sheet cheatsheetseries.owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [bcrypt for Node.js (node.bcrypt.js) github.com](https://github.com/kelektiv/node.bcrypt.js)
- [Crypto — scrypt & pbkdf2 (Node.js API) nodejs.org](https://nodejs.org/api/crypto.html)
- [Node Password Hashing with bcrypt WittCode](https://www.youtube.com/watch?v=esa_t_-PJ6A)
