---
title: "crypto: Hashing, HMAC, Random & Encryption"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/crypto
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# crypto: Hashing, HMAC, Random & Encryption

*9 min read · Updated 24 Jul 2026 Topic 24 of 70 Bookmark Mark done Why it matters Security bugs are the most expensive kind of bug · Topic 24 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/crypto](https://www.geekyfrontend.in/learn/nodejs-backend-kit/crypto)

---

## Why it matters

Security bugs are the most expensive kind of bug, and cryptography is the one area where "it looks like it works" is worthless — a broken scheme runs perfectly and encrypts nothing meaningful. Node's built-in `crypto` module gives you battle-tested primitives (backed by OpenSSL) for hashing, message authentication, secure random generation, password storage, and encryption. Knowing which primitive solves which problem — and, just as important, which ones must *never* be used for a given job — is core backend competence.

Interviewers lean on `crypto` because it separates people who reach for the right tool from those who "just SHA-256 the password." The consequences of getting it wrong are concrete: leaked credentials, forgeable tokens, predictable IDs, timing attacks. You do not need to invent cryptography — you need to use these primitives correctly and know their boundaries. This topic is about exactly that judgement.

## The concept, simply

Four distinct jobs, four distinct tools. **Hashing** (`createHash`, e.g. SHA-256) turns any input into a fixed-size, one-way digest — used for integrity checks and deduplication, *not* secrecy. **HMAC** (`createHmac`) combines a hash with a secret key to prove a message came from someone who holds the key — used to sign and verify webhooks and tokens. **Secure randomness** (`randomBytes`, `randomUUID`) produces unpredictable values for tokens, salts, and IDs. **Password hashing** (`scrypt`, or argon2/bcrypt via libraries) is deliberately slow and salted, purpose-built to store passwords. **Encryption** (`createCipheriv` with AES-GCM) provides confidentiality with an authenticated tag, for data you must later read back.

![Three columns comparing SHA-256 hashing, HMAC, and scrypt password hashing by purpose](assets/i21_01_b5b96da8.svg)

Match the primitive to the job: fast digests for integrity, HMAC for authenticity, slow salted hashing for passwords. They are not interchangeable.

## How it works (deep)

A **cryptographic hash** is deterministic (same input, same digest), fixed-size (SHA-256 is always 32 bytes), one-way (you cannot reverse the digest to the input), and collision-resistant (finding two inputs with the same digest is infeasible). This makes it ideal for verifying that a file or message has not changed. It is disastrous for passwords, though, precisely *because* it is fast: an attacker with a leaked digest can try billions of guesses per second, and identical passwords produce identical digests, so rainbow tables crack them wholesale. Speed is a feature for integrity and a vulnerability for passwords.

**HMAC** fixes a subtle problem with plain hashing for authentication. You cannot simply hash `secret + message` to sign it — that construction is vulnerable to length-extension attacks against Merkle–Damgård hashes. HMAC's specific nested construction (hashing the key with inner and outer pads) is proven secure. When you receive a signed webhook, you recompute the HMAC over the raw body with your shared secret and compare it to the sender's signature. Crucially, that comparison must be **constant-time** (`crypto.timingSafeEqual`): a naive `===` returns as soon as bytes differ, leaking timing information that lets an attacker recover the signature byte by byte.

**Secure randomness** comes from the OS's cryptographically secure RNG via `crypto.randomBytes` and `crypto.randomUUID`. This is categorically different from `Math.random()`, which is fast but predictable and must *never* generate tokens, session IDs, password-reset codes, or salts. If an attacker can guess your randomness, every security guarantee downstream collapses.

**Password hashing** inverts the speed logic on purpose. `scrypt` (built in), `argon2`, and `bcrypt` are *slow* and memory-hard, with a tunable cost factor, and each password gets a unique random **salt** so identical passwords produce different stored hashes and rainbow tables are useless. You store the salt alongside the hash; on login you re-derive with the same salt and compare in constant time. The slowness is the whole point — it caps how many guesses an attacker can make per second.

**Encryption** is for data you must read back, unlike hashing. Use **AES-256-GCM**, an authenticated cipher: it needs a 32-byte key and a unique **IV** (initialisation vector) per message, and it produces both ciphertext and an authentication tag that detects tampering on decryption. The cardinal rule is *never reuse an IV with the same key* — doing so with GCM catastrophically breaks confidentiality and authenticity. Generate a fresh random IV for every encryption and store it with the ciphertext (it is not secret).

## Code examples

Hashing for integrity, and HMAC for verifying a signed webhook in constant time:

javascript

```
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Integrity digest of a payload (NOT for passwords):
const digest = createHash('sha256').update('file contents').digest('hex');

// Verify a webhook signature safely:
function verifyWebhook(rawBody, signatureHex, secret) {
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(signatureHex, 'hex');
  // Length check first — timingSafeEqual throws on length mismatch.
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

Generating unpredictable tokens and IDs the secure way:

javascript

```
import { randomBytes, randomUUID, randomInt } from 'node:crypto';

const sessionToken = randomBytes(32).toString('hex'); // 256-bit token
const requestId = randomUUID();                        // RFC 4122 v4
const otp = randomInt(0, 1_000_000).toString().padStart(6, '0'); // secure OTP
// NEVER: Math.random() for any of these — it is predictable.
```

Storing and verifying a password with the built-in `scrypt` (slow + salted):

javascript

```
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64); // 64-byte derived key
  return `${salt.toString('hex')}:${key.toString('hex')}`; // store both
}

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(actual, expected); // constant-time compare
}
```

Authenticated encryption with AES-256-GCM (fresh IV every time, store the tag):

javascript

```
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const KEY = randomBytes(32); // 256-bit key — in real code load from a secret store

function encrypt(plaintext) {
  const iv = randomBytes(12);                       // unique per message!
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();                  // detects tampering
  return { iv: iv.toString('hex'), tag: tag.toString('hex'), data: enc.toString('hex') };
}

function decrypt({ iv, tag, data }) {
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));     // throws if tampered
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}
```

## Common mistakes & gotchas

- **Hashing passwords with SHA-256/MD5.** Fast hashes are trivially brute-forced. Passwords need slow, salted `scrypt`/argon2/bcrypt. This is the single most common crypto mistake.
- **Comparing secrets with `===`.** String/Buffer equality short-circuits on the first differing byte, leaking timing. Use `crypto.timingSafeEqual` on equal-length buffers.
- **Using `Math.random()` for anything security-sensitive.** It is predictable. Tokens, salts, IVs, OTPs, and IDs must come from `crypto.randomBytes`/`randomUUID`.
- **Reusing an IV (nonce) with AES-GCM.** Nonce reuse under the same key destroys GCM's security entirely. Generate a fresh random IV per message and store it with the ciphertext.
- **Confusing encoding with encryption.** Base64 is not encryption — it is reversible by anyone. Encoding hides nothing.
- **Encrypting without authentication.** Plain AES-CBC without a MAC lets attackers tamper undetected. Prefer AES-GCM (built-in authentication) and always verify the tag on decrypt.
- **Hardcoding keys in source.** Keys in the repo are compromised the moment the repo is. Load them from environment/secret managers and rotate them.
- **Rolling your own crypto.** Custom schemes are almost always broken. Use standard primitives with standard modes.

## Best practices

- **Passwords → `scrypt`/argon2/bcrypt with a unique per-user salt,** never a plain hash.
- **Compare all secrets with `timingSafeEqual`** on equal-length buffers.
- **Generate every token, salt, IV, and ID with `crypto.randomBytes`/`randomUUID`.**
- **Encrypt with AES-256-GCM,** a fresh IV per message, and always verify the auth tag on decrypt.
- **Store the salt/IV/tag alongside the ciphertext** — they are not secret, and you need them to verify/decrypt.
- **Keep keys out of source;** load from a secret manager and support rotation.
- **Verify webhooks with HMAC over the raw body** (not the parsed/re-serialised body) and constant-time comparison.
- **Use standard primitives and modes; do not invent your own.**

## ⭐ Interview lens

> **Q: Why can't you store passwords with SHA-256?** Because SHA-256 is fast and unsalted by default: an attacker with the digests can try billions of guesses per second, and identical passwords hash identically, so rainbow tables crack them en masse. Passwords need a deliberately slow, salted, memory-hard function like `scrypt`, argon2, or bcrypt.

> **Q: What is the difference between a hash and an HMAC?** A plain hash is keyless — anyone can compute it, so it proves integrity but not origin. An HMAC mixes in a secret key with a proven construction, so a valid HMAC proves the message came from someone holding the key. HMAC is what you use to sign and verify webhooks and tokens.

> **Q: Why use `timingSafeEqual` instead of `===` for a signature?** `===` returns as soon as two bytes differ, so the comparison time reveals how many leading bytes matched. An attacker can exploit that timing to reconstruct the secret byte by byte. `timingSafeEqual` always compares the full length in constant time.

> **Q: What breaks if you reuse an IV with AES-GCM?** Nonce reuse under the same key is catastrophic for GCM: it leaks the XOR of plaintexts and, worse, allows forging the authentication tag, breaking both confidentiality and integrity. Every message needs a fresh, unique IV.

> **Q: Is base64 a form of encryption?** No. Base64 is a reversible encoding with no key — anyone can decode it. It provides zero confidentiality; it only makes binary data safe to transport as text.

> **Q: Why not `Math.random()` for a session token?** `Math.random()` is a fast PRNG seeded predictably and not designed for security; its output can be predicted, which would let an attacker guess valid tokens. Security-sensitive randomness must come from `crypto.randomBytes`/`randomUUID`, backed by the OS CSPRNG.

## Cheat-card

- Integrity → `createHash('sha256')` (fast, keyless, one-way).
- Authenticity → `createHmac('sha256', secret)` + `timingSafeEqual`.
- Passwords → `scrypt`/argon2/bcrypt, unique salt, slow on purpose. Never SHA/MD5.
- Randomness → `randomBytes` / `randomUUID` / `randomInt`. Never `Math.random()`.
- Encryption → AES-256-GCM, fresh IV per message, verify the auth tag.
- Store salt/IV/tag next to ciphertext (not secret); keep *keys* in a secret manager.
- Base64 = encoding, not encryption.
- Compare secrets in constant time; never `===`.
- Use standard primitives — never roll your own.
- Key pairs → `generateKeyPair('ed25519' | 'ec' | 'rsa', opts, cb)`; `publicKeyEncoding: { type: 'spki', format: 'pem' }`, `privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher?, passphrase? }`; avoid the Sync form in servers.
- Signatures → `crypto.sign(alg | null, data, key)` / `crypto.verify(...)`; `null` for Ed25519; `createSign`/`createVerify` for streamed data (single-use, no Ed25519).
- ECDSA → DER by default; `dsaEncoding: 'ieee-p1363'` for JWT/Web Crypto.
- HKDF → `hkdfSync(digest, ikm, salt, info, keylen)` returns an `ArrayBuffer`; for random secrets, never passwords.
- PBKDF2 → `pbkdf2(pw, salt, iterations, keylen, digest, cb)`; OWASP: 600,000 iterations for SHA-256; store the count with the hash.
- Web Crypto (`crypto.subtle`) equivalents → [lesson 28](28-web-crypto.md).

---

## Learn More

- [Crypto | Node.js Documentation nodejs.org](https://nodejs.org/api/crypto.html)
- [Web Crypto API | Node.js Documentation nodejs.org](https://nodejs.org/api/webcrypto.html)
- [Web Crypto API | MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [7 Cryptography Concepts EVERY Developer Should Know Fireship](https://www.youtube.com/watch?v=NuyzuNBFWxQ)

---

## Additional topics

*Added 10 Oct 2026 · examples verified on Node v24.19.0*

### `generateKeyPair` and `generateKeyPairSync`

`crypto.generateKeyPair(type, options, callback)` and `crypto.generateKeyPairSync(type, options)` (both added in v10.12.0) create a new asymmetric key pair: a private key you keep secret and a public key you hand out. You need one for anything where the verifier must not be able to sign: JWTs signed with `ES256`/`EdDSA`/`RS256`, webhook signatures checked by third parties, TLS, SSH. An HMAC key from the main lesson cannot do that, because whoever can check an HMAC can also create one. `type` selects the algorithm: `'rsa'`, `'rsa-pss'`, `'ec'`, `'ed25519'`, `'x25519'` and others. Ed25519 and X25519 generation was added in v12.0.0.

How it works:

1. Pick the type and its parameters: `modulusLength` (bits) and `publicExponent` (default `0x10001`) for RSA, `namedCurve` (`'P-256'`, `'P-384'`…) for EC, nothing for Ed25519.
2. Without encoding options you get two `KeyObject`s (since v11.6.0), which you pass straight to `sign`/`verify` or export later with `keyObject.export()`.
3. With `publicKeyEncoding: { type: 'spki', format: 'pem' }` and `privateKeyEncoding: { type: 'pkcs8', format: 'pem' }`, Node calls `export()` for you and returns PEM strings. Add `cipher` and `passphrase` to the private key encoding to get an `ENCRYPTED PRIVATE KEY` PEM. The docs recommend `'spki'`, and `'pkcs8'` with encryption, for long-term storage.
4. `generateKeyPairSync` returns `{ publicKey, privateKey }` and blocks the thread until it is done. `generateKeyPair` calls `callback(err, publicKey, privateKey)` later, and `util.promisify(generateKeyPair)` resolves to `{ publicKey, privateKey }`.

**Example — key types, PEM output and sync vs async.**

javascript

```
import { generateKeyPair, generateKeyPairSync } from 'node:crypto';
import { promisify } from 'node:util';

// 1. No encoding options: you get KeyObjects back
const ed = generateKeyPairSync('ed25519');
console.log('ed25519 :', ed.publicKey.constructor.name, ed.publicKey.type, ed.privateKey.asymmetricKeyType);

// 2. With publicKeyEncoding / privateKeyEncoding: you get PEM strings back
const ec = generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
console.log('ec      :', typeof ec.publicKey, ec.publicKey.split('\n')[0], '|', ec.privateKey.split('\n')[0]);

// 3. Encrypt the private key PEM with a passphrase
const enc = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'top secret' },
});
console.log('encrypted private key:', enc.privateKey.split('\n')[0]);

// 4. Sync vs async: RSA generation takes long enough to see the difference
const rsaOpts = { modulusLength: 3072, publicExponent: 0x10001,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } };
async function ticksDuring(fn) {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  await fn();
  await new Promise((r) => setImmediate(r));      // give an overdue tick its chance
  clearInterval(timer);
  return ticks;
}
console.log('interval ticks during generateKeyPairSync:', await ticksDuring(() => generateKeyPairSync('rsa', rsaOpts)));
const generateKeyPairAsync = promisify(generateKeyPair);  // resolves to { publicKey, privateKey }
let rsa;
const asyncTicks = await ticksDuring(async () => { rsa = await generateKeyPairAsync('rsa', rsaOpts); });
console.log('interval ticks during generateKeyPair     :', asyncTicks > 1 ? 'more than 1' : asyncTicks, '|', rsa.publicKey.split('\n')[0]);

// 5. The callback form
generateKeyPair('ec', { namedCurve: 'P-384' }, (err, publicKey, privateKey) => {
  if (err) throw err;
  console.log('callback:', publicKey.asymmetricKeyDetails, privateKey.type);
});

// Real output (Node v24.19.0):
//   ed25519 : PublicKeyObject public ed25519
//   ec      : string -----BEGIN PUBLIC KEY----- | -----BEGIN PRIVATE KEY-----
//   encrypted private key: -----BEGIN ENCRYPTED PRIVATE KEY-----
//   interval ticks during generateKeyPairSync: 1
//   interval ticks during generateKeyPair     : more than 1 | -----BEGIN PUBLIC KEY-----
//   callback: { namedCurve: 'secp384r1' } private
```

The 5 ms interval could not run while `generateKeyPairSync` built a 3072-bit RSA key. Its one tick is the overdue timer firing after the call returned. During `generateKeyPair` it kept ticking. Use the async form in a server. Ed25519 and EC generation is fast. RSA generation is the one that takes long enough to matter. Node prints the curve as `secp384r1`, its OpenSSL name, even when you ask for `P-384`.

### `crypto.sign` / `crypto.verify` and `createSign` / `createVerify`

A digital signature is a value computed over data with a private key, which anyone holding the matching public key can check. Changing a single byte of the data or the signature makes verification fail. Node offers two shapes. **One-shot** `crypto.sign(algorithm, data, key[, callback])` and `crypto.verify(algorithm, data, key, signature[, callback])` (both added in v12.0.0, optional callback added in v15.12.0) take all the data at once. **Streaming** `crypto.createSign(algorithm)` / `crypto.createVerify(algorithm)` return `Sign`/`Verify` objects (writable streams) that you feed with `update()` and finish with `sign(key)` / `verify(key, signature)`.

How it works:

1. `algorithm` is the hash name (`'sha256'`), or `null`/`undefined` for Ed25519 and Ed448, which hash internally.
2. `key` is a `KeyObject`, a PEM string, or an object `{ key, padding, saltLength, dsaEncoding }`. `padding: crypto.constants.RSA_PKCS1_PSS_PADDING` selects RSA-PSS. Without it RSA uses PKCS#1 v1.5.
3. ECDSA signatures are DER-encoded by default (an ASN.1 `SEQUENCE`, first byte `0x30`, variable length). `dsaEncoding: 'ieee-p1363'` gives the fixed-size `r || s` form that JWTs and Web Crypto use (supported since v13.2.0 and v12.16.0).
4. `verify` returns `true` or `false`. It throws only on bad arguments, not on a bad signature.
5. A `Sign` or `Verify` object is single-use. A second `sign()` throws (`ERR_CRYPTO_INVALID_STATE`).

**Example — Ed25519, ECDSA, RSA-PSS one-shot, and streaming RSA.**

javascript

```
import { generateKeyPairSync, sign, verify, createSign, createVerify, constants } from 'node:crypto';

const data = Buffer.from('order 42: ship it');
const tampered = Buffer.from('order 43: ship it');

// One-shot crypto.sign / crypto.verify ---------------------------------------
// Ed25519: the algorithm argument is null (the curve fixes the hash)
const ed = generateKeyPairSync('ed25519');
const edSig = sign(null, data, ed.privateKey);
console.log('ed25519   sig', edSig.length, 'bytes | ok:', verify(null, data, ed.publicKey, edSig), '| tampered:', verify(null, tampered, ed.publicKey, edSig));

// ECDSA: name the hash; the signature is DER by default, or r||s with dsaEncoding
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const der = sign('sha256', data, ec.privateKey);
const p1363 = sign('sha256', data, { key: ec.privateKey, dsaEncoding: 'ieee-p1363' });
console.log('ecdsa     DER starts 0x' + der[0].toString(16), '(ASN.1 SEQUENCE, length varies) | ieee-p1363', p1363.length, 'bytes | ok:', verify('sha256', data, ec.publicKey, der));

// RSA-PSS through the padding option, with PEM strings as keys
const rsa = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const pss = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
const rsaSig = sign('sha256', data, { key: rsa.privateKey, ...pss });
console.log('rsa-pss   sig', rsaSig.length, 'bytes | ok:', verify('sha256', data, { key: rsa.publicKey, ...pss }, rsaSig));

// One-shot with a callback runs asynchronously
sign('sha256', data, ec.privateKey, (err, sig) => console.log('callback sign  :', err, sig.length > 60));

// Streaming createSign / createVerify: feed the data in pieces ---------------
const signer = createSign('sha256');
signer.update('order 42: ');
signer.update('ship it');
const streamSig = signer.sign(rsa.privateKey, 'base64');      // output encoding optional
const verifier = createVerify('sha256');
verifier.update(data);                                         // all at once on this side
console.log('createSign/createVerify (PKCS#1 v1.5):', verifier.verify(rsa.publicKey, streamSig, 'base64'));

// A Sign object is single-use
try { signer.sign(rsa.privateKey); } catch (err) { console.log('second sign() ->', err.code, '-', err.message); }

// createSign does not support Ed25519: use crypto.sign(null, ...)
try { createSign('sha256').update(data).sign(ed.privateKey); }
catch (err) { console.log('createSign + ed25519 ->', err.code ?? err.name, '-', err.message); }

// Real output (Node v24.19.0):
//   ed25519   sig 64 bytes | ok: true | tampered: false
//   ecdsa     DER starts 0x30 (ASN.1 SEQUENCE, length varies) | ieee-p1363 64 bytes | ok: true
//   rsa-pss   sig 256 bytes | ok: true
//   createSign/createVerify (PKCS#1 v1.5): true
//   second sign() -> ERR_CRYPTO_INVALID_STATE - Not initialised
//   createSign + ed25519 -> ERR_CRYPTO_UNSUPPORTED_OPERATION - Unsupported crypto operation
//   callback sign  : null true
```

The callback form of `sign` ran last, after all the synchronous code. `createSign` cannot do Ed25519 (`ERR_CRYPTO_UNSUPPORTED_OPERATION`), so use one-shot `crypto.sign(null, …)` for EdDSA. Use `createSign`/`createVerify` when the data arrives in pieces (`update()` twice above), and one-shot `sign`/`verify` otherwise.

### `hkdf` and `hkdfSync`

HKDF (RFC 5869; `crypto.hkdf` and `crypto.hkdfSync` added in v15.0.0) turns one secret that is already high-entropy into as many independent keys as you need. It takes four inputs:

- `ikm`, the input keying material (the master secret);
- `salt`, which may be empty;
- `info`, a label that makes each output different (at most 1024 bytes);
- `keylen`, the output length in bytes.

Without it, teams reuse one secret for cookies, CSRF tokens and encryption, so a leak or a cross-protocol attack in one place breaks all of them. HKDF is **not** a password hash: it is fast on purpose, so a guessable input stays guessable.

How it works:

1. *Extract*: HMAC-hash `ikm` with `salt` into a fixed-size pseudorandom key.
2. *Expand*: HMAC that key repeatedly with `info` and a counter until `keylen` bytes exist.
3. The same inputs always give the same output. A different `info` gives an unrelated key.
4. `keylen` may be at most 255 × the digest size (8,160 bytes for SHA-256). The result is an **`ArrayBuffer`**, not a `Buffer`.

**Example — two subkeys from one master secret.**

javascript

```
import { hkdf, hkdfSync } from 'node:crypto';

// --- HKDF: one high-entropy master secret -> independent subkeys ---------------
const master = Buffer.from('0123456789abcdef0123456789abcdef');   // 32 bytes from your secret store
const salt = Buffer.alloc(32);                                      // fixed zeros so the output is reproducible
const cookieKey = Buffer.from(hkdfSync('sha256', master, salt, 'session-cookie-signing', 32));
const csrfKey = Buffer.from(hkdfSync('sha256', master, salt, 'csrf-token', 32));
console.log('hkdfSync returns:', hkdfSync('sha256', master, salt, 'x', 32).constructor.name);
console.log('cookie key:', cookieKey.toString('hex').slice(0, 32) + '…');
console.log('csrf key  :', csrfKey.toString('hex').slice(0, 32) + '…');

hkdf('sha256', master, salt, 'session-cookie-signing', 32, (err, ab) => {
  console.log('async hkdf same as sync:', Buffer.from(ab).equals(cookieKey));
});

try { hkdfSync('sha256', master, salt, 'x', 255 * 32 + 1); }
catch (err) { console.log('keylen too big ->', err.code, '-', err.message); }

// Real output (Node v24.19.0):
//   hkdfSync returns: ArrayBuffer
//   cookie key: 511bc7a7e7eefac9824b23e4a388c597…
//   csrf key  : 8d8bb846452bdaf44e5abe0b6d1b0efd…
//   keylen too big -> ERR_CRYPTO_INVALID_KEYLEN - Invalid key length
//   async hkdf same as sync: true
```

These are the same bytes that `crypto.subtle.deriveBits({ name: 'HKDF', … })` produced for the same inputs in [lesson 28](28-web-crypto.md), Example 6.

### `pbkdf2` and `pbkdf2Sync`

PBKDF2 (`crypto.pbkdf2`, added in v0.5.5) derives a key from a password by running HMAC `iterations` times over the password and a salt. Each guess an attacker makes costs the same number of HMACs, so the iteration count sets how expensive brute force is. Unlike `scrypt` (main lesson) or Argon2, it is not memory-hard, and OWASP ranks it below both. Use it when a standard requires it (FIPS-140) or when it is the only KDF available, as in Web Crypto. The OWASP Password Storage Cheat Sheet (checked 10 Oct 2026) recommends **600,000 iterations for PBKDF2-HMAC-SHA256**, 220,000 for PBKDF2-HMAC-SHA512, and 1,400,000 for PBKDF2-HMAC-SHA1 ("legacy only"). It ranks Argon2id first and scrypt second.

How it works:

1. Generate a random salt of at least 16 bytes per password.
2. `pbkdf2(password, salt, iterations, keylen, digest, callback)` runs on libuv's thread pool (the docs say so; see lesson 07). `pbkdf2Sync` blocks the event loop for the whole computation. `keylen` is in bytes, and the result is a `Buffer`.
3. Store the algorithm, the iteration count, the salt and the key together, so you can raise the count later and still verify old hashes.
4. To verify, re-derive with the stored salt and count and compare with `timingSafeEqual`.

**Example — storing and checking a password with PBKDF2.**

javascript

```
import { pbkdf2, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// --- PBKDF2: password -> key, slowed down by iterations ------------------------
const pbkdf2Async = promisify(pbkdf2);
async function hashPassword(password) {
  const s = randomBytes(16);
  const iterations = 600_000;                                       // OWASP figure for PBKDF2-HMAC-SHA256
  const key = await pbkdf2Async(password, s, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${s.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  const [, iter, s, k] = stored.split('$');
  const expected = Buffer.from(k, 'base64');
  const actual = await pbkdf2Async(password, Buffer.from(s, 'base64'), Number(iter), expected.length, 'sha256');
  return timingSafeEqual(actual, expected);
}
const stored = await hashPassword('correct horse');
console.log('stored format:', stored.split('$').slice(0, 2).join('$') + '$<salt>$<key>');
console.log('right password:', await verifyPassword('correct horse', stored));
console.log('wrong password:', await verifyPassword('Correct horse', stored));

// Cost grows linearly with iterations
for (const n of [1_000, 600_000]) {
  const t0 = performance.now();
  pbkdf2Sync('pw', 'salt', n, 32, 'sha256');
  console.log(`pbkdf2Sync ${String(n).padStart(7)} iterations: ${performance.now() - t0 > 50 ? 'over 50 ms' : 'under 50 ms'}`);
}

try { pbkdf2Sync('pw', 'salt', 0, 32, 'sha256'); }
catch (err) { console.log('iterations 0 ->', err.code, '-', err.message); }

// Real output (Node v24.19.0):
//   stored format: pbkdf2-sha256$600000$<salt>$<key>
//   right password: true
//   wrong password: false
//   pbkdf2Sync    1000 iterations: under 50 ms
//   pbkdf2Sync  600000 iterations: over 50 ms
//   iterations 0 -> ERR_OUT_OF_RANGE - The value of "iterations" is out of range. It must be >= 1 && <= 2147483647. Received 0
```

The stored string keeps everything needed to verify, so the iteration count can be raised for new hashes later. `iterations` must be at least 1 (changed in v14.0.0: earlier releases treated other values as 1).

### Web Crypto: the same primitives in `crypto.subtle` (lesson 28)

Node also implements the standard Web Crypto API on `globalThis.crypto.subtle`, the version browsers, Deno, Bun and edge runtimes share. [Lesson 28](28-web-crypto.md) covers it in full. It has a table mapping every function in this lesson to its Web Crypto equivalent, and it explains the differences that break code moved between the two: promises only, `CryptoKey` objects with fixed usages, the AES-GCM tag appended to the ciphertext, and ECDSA signatures in `r || s` form.

How it works:

1. Import or generate a `CryptoKey` with `crypto.subtle.importKey` / `generateKey`.
2. Call `crypto.subtle.sign`, `encrypt`, `deriveBits` and so on. Each returns a promise of an `ArrayBuffer` (a boolean for `verify`).
3. Convert keys between the APIs with `KeyObject.from(cryptoKey)` and `keyObject.toCryptoKey(algorithm, extractable, usages)` (added in v23.0.0 and v22.10.0).

**Example — the two APIs agree.**

javascript

```
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

// The same HMAC through both APIs
const secret = Buffer.from('whsec_test_secret');
const body = Buffer.from('{"event":"paid"}');
const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const webMac = Buffer.from(await crypto.subtle.sign('HMAC', key, body));
console.log('createHmac === subtle.sign:', webMac.equals(createHmac('sha256', secret).update(body).digest()));

// A node:crypto key pair used by Web Crypto
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const sig = sign(null, body, privateKey);
const cryptoKey = publicKey.toCryptoKey('Ed25519', false, ['verify']);
console.log('subtle.verify(node signature):', await crypto.subtle.verify('Ed25519', cryptoKey, sig, body));

// Real output (Node v24.19.0):
//   createHmac === subtle.sign: true
//   subtle.verify(node signature): true
```

### Common mistakes & gotchas (additional topics)

- **Using `generateKeyPairSync('rsa', …)` inside a request handler.** It blocks the event loop for the whole generation. Generate keys at deploy time, or use the async `generateKeyPair`.
- **Passing `'sha256'` as the algorithm for Ed25519.** Ed25519 and Ed448 need `null` or `undefined`, and `createSign` does not support them at all (`ERR_CRYPTO_UNSUPPORTED_OPERATION`).
- **Sending a DER ECDSA signature to a JWT or Web Crypto verifier.** They expect `r || s`. Sign with `dsaEncoding: 'ieee-p1363'`.
- **Calling `sign()` twice on one `Sign` object.** It is single-use and throws `ERR_CRYPTO_INVALID_STATE`.
- **Using HKDF on a password.** HKDF is fast and adds no work factor. Passwords need `scrypt`, Argon2id or PBKDF2 with a high iteration count.
- **Treating `hkdfSync`'s result as a Buffer.** It is an `ArrayBuffer`; see the edge case below.
- **A fixed PBKDF2 iteration count baked into code.** Store the count with each hash, so you can raise it without breaking old logins.

### Edge case worked through: `hkdfSync` returns an `ArrayBuffer`

`pbkdf2Sync`, `scryptSync` and `randomBytes` return `Buffer`s, so it is natural to call `.toString('hex')` on the result of `hkdfSync` too. It does not throw. It silently gives you the wrong string:

javascript

```
import { hkdfSync, pbkdf2Sync } from 'node:crypto';

const master = Buffer.from('0123456789abcdef0123456789abcdef');
const key = hkdfSync('sha256', master, Buffer.alloc(32), 'csrf-token', 32);

// hkdfSync returns an ArrayBuffer, which has no Buffer encodings
console.log('typeof result:', key.constructor.name);
console.log('key.toString("hex") ->', key.toString('hex'));
try { console.log(key.equals(master)); } catch (err) { console.log('key.equals ->', err.name, '-', err.message); }

// Wrap it (no copy) to get Buffer methods
const buf = Buffer.from(key);
console.log('Buffer.from(key).toString("hex") ->', buf.toString('hex').slice(0, 32) + '…');

// pbkdf2Sync, by contrast, already returns a Buffer
console.log('pbkdf2Sync returns:', pbkdf2Sync('pw', 'salt', 1, 32, 'sha256').constructor.name);

// Real output (Node v24.19.0):
//   typeof result: ArrayBuffer
//   key.toString("hex") -> [object ArrayBuffer]
//   key.equals -> TypeError - key.equals is not a function
//   Buffer.from(key).toString("hex") -> 8d8bb846452bdaf44e5abe0b6d1b0efd…
//   pbkdf2Sync returns: Buffer
```

`ArrayBuffer.prototype` has no `toString(encoding)`, so the call falls through to `Object.prototype.toString` and returns `"[object ArrayBuffer]"`. Stored as a key or compared as hex, that string is the same for every input. `Buffer.from(arrayBuffer)` wraps the bytes without copying (lesson 25) and gives you the Buffer methods back. The async `hkdf` callback also receives an `ArrayBuffer`.

### ⭐ Interview lens (additional topics)

> **Q: “When do you need a key pair and signatures instead of an HMAC?”**  
> A: When the party that verifies must not be able to create valid tags. With HMAC, anyone who can verify holds the secret and can forge. With signatures, the issuer keeps the private key and gives everyone the public key: JWTs consumed by many services, webhooks checked by customers, software updates. In Node: `generateKeyPair('ed25519')`, then `crypto.sign(null, data, privateKey)` and `crypto.verify(null, data, publicKey, sig)`.

> **Q: “What is the difference between HKDF and PBKDF2?”**  
> A: Both derive keys, but from different inputs. HKDF expands a secret that is already random (a master key, a Diffie-Hellman shared secret) into several keys, quickly, using `info` labels. PBKDF2 stretches a low-entropy password with a salt and many iterations, so each guess is slow. OWASP recommends 600,000 iterations for PBKDF2-HMAC-SHA256. Using HKDF on a password gives no protection against guessing.
