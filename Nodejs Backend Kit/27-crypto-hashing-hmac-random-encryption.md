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

## Say it in 30 seconds

The crypto module is Node's OpenSSL-backed toolbox, and each job has its own tool: a hash such as SHA-256 for integrity, an HMAC for a signature that proves a shared secret, randomBytes for unpredictable tokens, a slow salted function such as scrypt for passwords, and AES-GCM for encryption you can read back. It exists so you use a reviewed primitive instead of inventing one. The trade-off is that the fast tools are the wrong tools for passwords, and reusing an IV with AES-GCM breaks the encryption.

## Why it matters

Security bugs are the expensive kind, and cryptography is the area where "it looks like it works" is worthless. A broken scheme runs and encrypts nothing meaningful. crypto gives you hashing, message authentication, secure random bytes, password storage, and encryption. Knowing which primitive solves which problem, and which ones must never be used for a given job, is the skill. You do not invent cryptography. You use these primitives correctly and you know their boundaries.

## The concept, simply

Five jobs, five tools. Hashing, createHash with something like SHA-256, turns any input into a fixed-size one-way digest. Use it for integrity checks and deduplication, not for secrecy. HMAC, createHmac, combines a hash with a secret key so you can prove a message came from someone who holds the key. Use it to sign webhooks and tokens. Secure randomness, randomBytes and randomUUID, produces unpredictable values for tokens, salts, and IDs. Password hashing, scrypt, or argon2 and bcrypt from libraries, is deliberately slow and salted, built to store passwords. Encryption, createCipheriv with AES-GCM, hides data and adds an authentication tag, for data you must later read back.

![Three columns comparing SHA-256 hashing, HMAC, and scrypt password hashing by purpose](assets/i21_01_b5b96da8.svg)

Match the tool to the job. A fast digest is for integrity. HMAC is for authenticity. A slow salted hash is for passwords. They are not interchangeable.

## How it works (deep)

A cryptographic hash is deterministic: the same input always gives the same digest. It is fixed-size: SHA-256 is always 32 bytes. It is one-way: you cannot reverse the digest to the input. It is collision-resistant: finding two inputs with the same digest is not feasible. That makes it right for checking that a file has not changed. It is disastrous for passwords because it is fast. An attacker with a leaked digest can try billions of guesses per second, and identical passwords produce identical digests, so a rainbow table, a precomputed list of hashes, cracks them in bulk. Speed is a feature for integrity and a weakness for passwords.

HMAC fixes a subtle problem with hashing a secret plus a message. That construction is vulnerable to length-extension attacks against Merkle-Damgard hashes, the family SHA-256 belongs to. HMAC's nested construction, hashing the key with inner and outer pads, is the proven one. When a signed webhook arrives, you recompute the HMAC over the raw body with your shared secret and compare it to the sender's signature. The comparison must be constant-time, crypto.timingSafeEqual. A plain === returns as soon as two bytes differ, which leaks how many leading bytes matched.

Secure randomness comes from the operating system's cryptographically secure generator, through randomBytes and randomUUID. That is a different category from Math.random, which is fast and predictable. Never use Math.random for tokens, session IDs, password-reset codes, or salts. If an attacker can guess the randomness, everything downstream collapses.

Password hashing inverts the speed on purpose. scrypt, which is built in, and argon2 and bcrypt, are slow and memory-hard, with a tunable cost, and each password gets a unique random salt so identical passwords produce different stored hashes. You store the salt next to the hash. On login you derive again with the same salt and compare in constant time. The slowness is the point. It caps how many guesses an attacker can try per second.

Encryption is for data you must read back. Hashing is not. Use AES-256-GCM, an authenticated cipher. It needs a 32-byte key and a unique IV, an initialisation vector, per message. It produces ciphertext and an authentication tag that detects tampering. Never reuse an IV with the same key. With GCM that breaks confidentiality and authenticity. Generate a fresh random IV for every encryption and store it with the ciphertext. The IV is not secret.

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

- Hashing passwords with SHA-256 or MD5. Fast hashes are brute-forced. Passwords need slow, salted scrypt, argon2, or bcrypt.
- Comparing secrets with ===. Equality stops at the first differing byte and leaks timing. Use timingSafeEqual on equal-length buffers.
- Math.random for anything security-sensitive. It is predictable. Tokens, salts, IVs, one-time codes, and IDs come from randomBytes or randomUUID.
- Reusing an IV, also called a nonce, with AES-GCM under the same key destroys GCM's security. A fresh random IV per message, stored with the ciphertext.
- Base64 is not encryption. Anyone can reverse it. Encoding hides nothing.
- AES-CBC without a MAC lets attackers tamper undetected. Prefer AES-GCM, which authenticates, and always check the tag on decrypt.
- Keys in source are compromised when the repo is. Load them from the environment or a secret manager, and rotate them.
- Custom schemes are almost always broken. Use standard primitives and standard modes.

## Best practices

- Passwords go to scrypt, argon2, or bcrypt with a unique salt per user. Never a plain hash.
- Compare secrets with timingSafeEqual on equal-length buffers.
- Generate every token, salt, IV, and ID with randomBytes or randomUUID.
- Encrypt with AES-256-GCM, a fresh IV per message, and verify the auth tag on decrypt.
- Store the salt, the IV, and the tag next to the ciphertext. They are not secret. Keep keys in a secret manager.
- Verify webhooks with HMAC over the raw body, not a re-serialised body, and compare in constant time.
- Do not invent your own construction.

## ⭐ Interview lens

> **Q: Why can't you store passwords with SHA-256?** Because SHA-256 is fast and unsalted by default: an attacker with the digests can try billions of guesses per second, and identical passwords hash identically, so rainbow tables crack them en masse. Passwords need a deliberately slow, salted, memory-hard function like `scrypt`, argon2, or bcrypt.
> SHA-256 is a fast, unsalted hash. An attacker who steals the digests can try billions of guesses per second, and two users with the same password produce the same digest, so a precomputed rainbow table cracks them together. A password store needs the opposite properties: a unique random salt per password, so identical passwords do not match, and a function that is deliberately slow and memory-hard, so each guess is expensive. Node's built-in is scrypt. argon2 and bcrypt are the usual libraries. You store the salt with the hash and, on login, derive again and compare with timingSafeEqual. The limit of "just use SHA-256 with a salt" is that salt stops the rainbow table and does not stop the speed. A fast hash is still brute-forced.

> **Q: What is the difference between a hash and an HMAC?** A plain hash is keyless — anyone can compute it, so it proves integrity but not origin. An HMAC mixes in a secret key with a proven construction, so a valid HMAC proves the message came from someone holding the key. HMAC is what you use to sign and verify webhooks and tokens.
> A hash has no key. Anyone can compute it, so it proves the bytes did not change and it does not prove who produced them. An HMAC mixes a secret key into the hash with a specific nested construction, so a valid tag proves the message came from someone who holds that key. You use it to sign and verify webhooks and tokens. For example, you HMAC the raw request body with the shared secret and compare the result to the signature header using timingSafeEqual. The limit is the shared secret. Anyone who can verify an HMAC can also create one, so it is the wrong tool when the verifier must not be able to sign. That job needs a private key and a public key.

> **Q: Why use `timingSafeEqual` instead of `===` for a signature?** `===` returns as soon as two bytes differ, so the comparison time reveals how many leading bytes matched. An attacker can exploit that timing to reconstruct the secret byte by byte. `timingSafeEqual` always compares the full length in constant time.
> === and ordinary string or buffer equality return as soon as two bytes differ, so the time taken reveals how many leading bytes matched. An attacker who can measure that can walk the secret one byte at a time. timingSafeEqual always compares the full length, so the time does not depend on where the first difference is. You use it for HMAC tags, password hashes, and any other secret comparison. For example, a webhook handler computes the expected tag and compares it to the header with timingSafeEqual, not with ===. The limit is that the two buffers must be the same length. timingSafeEqual throws if they are not, so you check the length first without turning that check into its own leak of the secret.

> **Q: What breaks if you reuse an IV with AES-GCM?** Nonce reuse under the same key is catastrophic for GCM: it leaks the XOR of plaintexts and, worse, allows forging the authentication tag, breaking both confidentiality and integrity. Every message needs a fresh, unique IV.
> GCM builds a keystream from the key and the IV and XORs the plaintext with it. XOR means combining bits so that doing it twice returns the original. Two messages under the same key and the same IV share that keystream, so XORing the ciphertexts reveals the XOR of the plaintexts. Knowing one plaintext reveals the other. Worse, the authentication key leaks too, so an attacker can forge tags. Confidentiality and integrity both fail. Every message needs a fresh, unique IV, usually 12 random bytes, stored next to the ciphertext. The IV is not a secret. The limit is "unique", not "random-looking". A counter is unique if you never repeat it under that key. A random IV you accidentally repeat is not.

## Cheat-card

- Integrity: createHash('sha256'). Fast, no key, one-way.
- Authenticity: createHmac('sha256', secret), then timingSafeEqual.
- Passwords: scrypt, argon2, or bcrypt, a unique salt, slow on purpose. Never SHA or MD5.
- Randomness: randomBytes, randomUUID, randomInt. Never Math.random.
- Encryption: AES-256-GCM, a fresh IV per message, and check the auth tag.
- Store the salt, IV, and tag next to the ciphertext. Keep the keys in a secret manager.
- Base64 is an encoding, not encryption.
- Compare secrets in constant time. Do not roll your own scheme.

## Good to know

- Is base64 a form of encryption? No. Base64 is a reversible encoding with no key. Anyone can decode it. It provides no confidentiality. It only makes binary safe to transport as text.

- Why not `Math.random()` for a session token? Math.random is a fast generator that is not designed for security, and its output can be predicted, which would let an attacker guess tokens. Use randomBytes or randomUUID, backed by the operating system's generator.
- Additional examples: 10 Oct 2026, examples verified on Node v24.19.0.
- generateKeyPair and generateKeyPairSync were both added in v10.12.0.
- Without encoding options, generateKeyPair returns KeyObjects, and that has been true since v11.6.0.
- `crypto.verify(algorithm, data, key, signature[, callback])`: both added in v12.0.0, optional callback added in v15.12.0.
- `r || s`: supported since v13.2.0 and v12.16.0.
- `keyObject.toCryptoKey(algorithm, extractable, usages)`: added in v23.0.0 and v22.10.0.

---

## Learn More

- [Crypto | Node.js Documentation nodejs.org](https://nodejs.org/api/crypto.html)
- [Web Crypto API | Node.js Documentation nodejs.org](https://nodejs.org/api/webcrypto.html)
- [Web Crypto API | MDN developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [7 Cryptography Concepts EVERY Developer Should Know Fireship](https://www.youtube.com/watch?v=NuyzuNBFWxQ)

---

## Additional topics

### `generateKeyPair` and `generateKeyPairSync`

`crypto.generateKeyPair(type, options, callback)` and `crypto.generateKeyPairSync(type, options)` create a new asymmetric key pair: a private key you keep secret and a public key you hand out. You need one for anything where the verifier must not be able to sign: JWTs signed with `ES256`/`EdDSA`/`RS256`, webhook signatures checked by third parties, TLS, SSH. An HMAC key from the main lesson cannot do that, because whoever can check an HMAC can also create one. `type` selects the algorithm: `'rsa'`, `'rsa-pss'`, `'ec'`, `'ed25519'`, `'x25519'` and others. Ed25519 and X25519 generation was added in v12.0.0.

How it works:

1. Pick the type and its parameters: `modulusLength` (bits) and `publicExponent` (default `0x10001`) for RSA, `namedCurve` (`'P-256'`, `'P-384'`…) for EC, nothing for Ed25519.
2. Without encoding options you get two `KeyObject`s, which you pass straight to `sign`/`verify` or export later with `keyObject.export()`.
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

A digital signature is a value computed over data with a private key, which anyone holding the matching public key can check. Changing a single byte of the data or the signature makes verification fail. Node offers two shapes. **One-shot** `crypto.sign(algorithm, data, key[, callback])` and `crypto.verify(algorithm, data, key, signature[, callback])` take all the data at once. **Streaming** `crypto.createSign(algorithm)` / `crypto.createVerify(algorithm)` return `Sign`/`Verify` objects (writable streams) that you feed with `update()` and finish with `sign(key)` / `verify(key, signature)`.

How it works:

1. `algorithm` is the hash name (`'sha256'`), or `null`/`undefined` for Ed25519 and Ed448, which hash internally.
2. `key` is a `KeyObject`, a PEM string, or an object `{ key, padding, saltLength, dsaEncoding }`. `padding: crypto.constants.RSA_PKCS1_PSS_PADDING` selects RSA-PSS. Without it RSA uses PKCS#1 v1.5.
3. ECDSA signatures are DER-encoded by default (an ASN.1 `SEQUENCE`, first byte `0x30`, variable length). `dsaEncoding: 'ieee-p1363'` gives the fixed-size `r || s` form that JWTs and Web Crypto use.
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
3. Convert keys between the APIs with `KeyObject.from(cryptoKey)` and `keyObject.toCryptoKey(algorithm, extractable, usages)`.

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
