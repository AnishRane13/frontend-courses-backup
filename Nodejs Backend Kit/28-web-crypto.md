---
title: "Web Crypto: crypto.subtle in Node"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Web Crypto: crypto.subtle in Node

*16 min read · Updated 10 Oct 2026 · Topic 85 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

Lesson 27 uses `node:crypto`: `createHash`, `createHmac`, `createCipheriv`, `scrypt`. That API exists only in Node. Browsers, Deno, Bun, Cloudflare Workers and other edge runtimes ship a different, standard API instead: **Web Crypto**, reached through `globalThis.crypto.subtle`. Node implements it too (added in v15.0.0, stable since v19.0.0 for everything except the Ed/X curves, `crypto` global no longer experimental in v23.0.0). So a JWT verifier, a webhook signature check or an encrypted-cookie helper written against `crypto.subtle` runs unchanged on all of them.

It also differs in ways that cause real bugs when you move code between the two APIs:

- every operation returns a promise;
- keys are opaque `CryptoKey` objects tied to one algorithm and a list of allowed usages;
- an AES-GCM auth failure is a bare `OperationError` with no details;
- ECDSA signatures use a different byte format from `node:crypto`'s default, so a signature made in one API fails to verify in the other unless you set one option.

## The concept, simply

Web Crypto is a small set of async functions on `crypto.subtle` (a `SubtleCrypto` instance) plus one key type.

- **`CryptoKey`**: a handle to key material. You cannot read the bytes through it. It has:
  - `type`: `'secret'`, `'private'` or `'public'`;
  - `algorithm`: for example `{ name: 'AES-GCM', length: 256 }`;
  - `usages`: what the key may do, such as `['encrypt', 'decrypt']`;
  - `extractable`: whether `exportKey`/`wrapKey` may ever give the bytes out.

  All four are read-only.
- **Key functions**: `generateKey(algorithm, extractable, usages)`, `importKey(format, data, algorithm, extractable, usages)` and `exportKey(format, key)`. The formats are `'raw'` (bytes), `'jwk'` (JSON Web Key object), `'spki'` (DER public key) and `'pkcs8'` (DER private key).
- **Operation functions**: `digest`, `sign`/`verify`, `encrypt`/`decrypt`, `deriveBits`/`deriveKey`, `wrapKey`/`unwrapKey`. Each takes an algorithm object such as `{ name: 'AES-GCM', iv }`, a `CryptoKey` and data (`ArrayBuffer`, any typed array, `DataView` or `Buffer`). Each resolves to an `ArrayBuffer`, except `verify`, which resolves to a boolean.
- **Two non-subtle helpers** on `crypto` itself: `crypto.getRandomValues(typedArray)` (at most 65,536 bytes per call) and `crypto.randomUUID()`.

The algorithm names are the Web Crypto spellings: `'SHA-256'`, not `'sha256'`; `'ECDSA'` with `namedCurve: 'P-256'`, not `'prime256v1'`. On Node v24.19.0 the stable set includes SHA-1/256/384/512, HMAC, AES-GCM/CBC/CTR/KW, ECDSA and ECDH (P-256/384/521), RSA-PSS, RSASSA-PKCS1-v1_5, RSA-OAEP, PBKDF2, HKDF, Ed25519 and X25519. **Ed25519 and X25519 became stable in v23.5.0 and v22.13.0** (added in v18.4.0 and v16.17.0 as experimental). `Ed448`/`X448` and the "Modern Algorithms" additions (ML-DSA, ML-KEM, ChaCha20-Poly1305, SHA-3, Argon2, AES-OCB, KMAC, all added in v24.7.0 or later) are still **Stability 1.1 – Active development**.

## How it works

1. **Get a key.** `generateKey` creates fresh key material: a `CryptoKey` for symmetric algorithms, or a `{ publicKey, privateKey }` pair for asymmetric ones. `importKey` wraps bytes or a JWK you already have. Both fix the algorithm, the usages and `extractable` for the key's whole life.
2. **Call an operation with an algorithm object.** The object names the algorithm and carries its per-call parameters: `iv` and `additionalData` for AES-GCM, `hash` for ECDSA, `saltLength` for RSA-PSS, `salt`/`iterations`/`hash` for PBKDF2, `salt`/`info`/`hash` for HKDF.
3. **The implementation checks the key against the call.** The algorithm name must match the key's, and the usage must be in `key.usages`. A mismatch rejects with `InvalidAccessError`. An unknown name rejects with `NotSupportedError`.
4. **The promise settles** with an `ArrayBuffer` (or a boolean for `verify`). Failures are `DOMException`s told apart by `name`. The examples below hit `OperationError`, `InvalidAccessError`, `NotSupportedError` and `SyntaxError`.
5. **Export only if allowed.** `exportKey` rejects for a key created with `extractable: false`. Public keys of a generated pair are always extractable, whatever you pass.

**AES-GCM in Web Crypto: the tag is inside the ciphertext.** `createCipheriv('aes-256-gcm')` in lesson 27 gives you the ciphertext and, separately, `getAuthTag()`. `subtle.encrypt({ name: 'AES-GCM', iv })` returns one `ArrayBuffer`: ciphertext followed by the tag (16 bytes by default, set with `tagLength` in bits). `subtle.decrypt` expects the same layout and checks the tag before it returns anything. On any mismatch (changed ciphertext, wrong `iv`, wrong `additionalData`, missing tag, wrong key) it rejects with a `DOMException` named `OperationError` and a generic message, and returns no partial plaintext. The `iv` must be unique for every encryption under one key (the docs: "must be unique for every encryption operation using a given key"). Use 12 random bytes per message and store the IV next to the ciphertext.

**ECDSA signature format.** Web Crypto ECDSA signatures are raw `r || s` (IEEE P1363), 64 bytes for P-256. `node:crypto`'s `sign`/`verify` default to DER (ASN.1, 70–72 bytes). Pass `dsaEncoding: 'ieee-p1363'` on the Node side to interoperate (Example 8). JWTs (`ES256`) also use the raw `r || s` form.

**Web Crypto vs `node:crypto` (lesson 27).**

| Job | `node:crypto` (lesson 27) | `crypto.subtle` | Notes |
|---|---|---|---|
| Hash | `createHash('sha256').update(d).digest()` (sync, streaming `update`) | `await subtle.digest('SHA-256', d)` | Web Crypto has no incremental `update`: you pass the whole input at once |
| HMAC | `createHmac('sha256', secret)` | `importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, …)` → `sign('HMAC', key, d)` / `verify` | `subtle.verify` compares for you; with `createHmac` you call `timingSafeEqual` yourself |
| AES-GCM | `createCipheriv('aes-256-gcm', key, iv)` + `getAuthTag()` / `setAuthTag()` | `encrypt({ name: 'AES-GCM', iv, additionalData }, key, d)` | Web Crypto appends the tag to the ciphertext; Node keeps it separate |
| Sign / verify | `crypto.sign(alg, d, key)` / `crypto.verify`, `createSign` / `createVerify` | `subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, d)`, `'RSA-PSS'`, `'RSASSA-PKCS1-v1_5'`, `'Ed25519'` | ECDSA: Node DER by default, Web Crypto P1363 |
| PBKDF2 | `pbkdf2(pw, salt, iters, keylen, 'sha256', cb)` / `pbkdf2Sync` | `importKey('raw', pw, 'PBKDF2', false, ['deriveBits'])` → `deriveBits({ name: 'PBKDF2', salt, iterations, hash }, key, bits)` | Length in **bytes** for Node, in **bits** for Web Crypto |
| HKDF | `hkdf(digest, ikm, salt, info, keylen, cb)` / `hkdfSync` | `deriveBits({ name: 'HKDF', hash, salt, info }, key, bits)` | Both return an `ArrayBuffer`; same output for the same inputs |
| Key pairs | `generateKeyPair('ec' / 'rsa' / 'ed25519', opts, cb)` → `KeyObject` or PEM | `generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, …)` → `CryptoKeyPair` | Web Crypto keys are bound to one algorithm and usage list |
| Key format | `KeyObject`, PEM or DER strings/Buffers, JWK | `CryptoKey`; `raw`/`jwk`/`spki`/`pkcs8` (DER, no PEM) | Convert with `KeyObject.from(cryptoKey)` / `keyObject.toCryptoKey(…)` |
| scrypt | `scrypt` / `scryptSync` | not available | Web Crypto has PBKDF2 (and Argon2 as Stability 1.1 in v24.8.0+) |
| Streaming / sync | streams and `*Sync` variants exist | promises only | Use `node:crypto` for streaming hashes of large files |

## Code examples

**Example 1 — `subtle.digest` next to `createHash`.**

javascript

```
import { createHash, webcrypto } from 'node:crypto';

const { subtle } = globalThis.crypto;
console.log('globalThis.crypto === require("node:crypto").webcrypto:', globalThis.crypto === webcrypto);

const data = new TextEncoder().encode('file contents');
const digest = await subtle.digest('SHA-256', data);          // resolves to an ArrayBuffer
console.log(digest.constructor.name, digest.byteLength);

const hex = Buffer.from(digest).toString('hex');
console.log('subtle.digest :', hex);
console.log('createHash    :', createHash('sha256').update('file contents').digest('hex'));

// The object form and a Node Buffer as input work too
const d512 = await subtle.digest({ name: 'SHA-512' }, Buffer.from('file contents'));
console.log('SHA-512 bytes :', d512.byteLength);

// Names are the WebCrypto spellings, not OpenSSL ones
try { await subtle.digest('sha256', data); console.log('lower-case name accepted'); }
catch (err) { console.log('sha256 ->', err.name, '-', err.message); }
try { await subtle.digest('MD5', data); }
catch (err) { console.log('MD5    ->', err.name, '-', err.message); }

// Real output (Node v24.19.0):
//   globalThis.crypto === require("node:crypto").webcrypto: true
//   ArrayBuffer 32
//   subtle.digest : 7bb6f9f7a47a63e684925af3608c059edcc371eb81188c48c9714896fb1091fd
//   createHash    : 7bb6f9f7a47a63e684925af3608c059edcc371eb81188c48c9714896fb1091fd
//   SHA-512 bytes : 64
//   sha256 -> NotSupportedError - Unrecognized algorithm name
//   MD5    -> NotSupportedError - Unrecognized algorithm name
```

The global `crypto` is the same object as `require('node:crypto').webcrypto`. `digest` resolves to a 32-byte `ArrayBuffer` with the same bytes `createHash` gives, and `Buffer.from(arrayBuffer)` turns it into hex. Algorithm names are matched without regard to case (in a separate run `'sha-256'` and `{ name: 'aes-gcm' }` were accepted), but `'sha256'` without the hyphen is not a Web Crypto name, so it rejects with `NotSupportedError`. `MD5` is not offered at all.

**Example 2 — HMAC sign and verify.**

javascript

```
import { createHmac } from 'node:crypto';
const { subtle } = globalThis.crypto;
const enc = new TextEncoder();

// Import an existing shared secret (e.g. a webhook secret from the environment)
const secret = enc.encode('whsec_test_secret');
const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
console.log(key.type, key.algorithm, key.extractable, key.usages);

const body = enc.encode('{"event":"paid","id":42}');
const sig = await subtle.sign('HMAC', key, body);
console.log('subtle.sign :', Buffer.from(sig).toString('hex'));
console.log('createHmac  :', createHmac('sha256', 'whsec_test_secret').update('{"event":"paid","id":42}').digest('hex'));

// verify() recomputes and compares; it resolves to a boolean and never throws on a mismatch
console.log('verify ok      :', await subtle.verify('HMAC', key, sig, body));
const tampered = enc.encode('{"event":"paid","id":43}');
console.log('verify tampered:', await subtle.verify('HMAC', key, sig, tampered));

// A key may only do what its usages allow
const signOnly = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
try { await subtle.verify('HMAC', signOnly, sig, body); }
catch (err) { console.log('no "verify" usage ->', err.name, '-', err.message); }

// Or let Web Crypto generate a random HMAC key (length defaults to the hash block size)
const gen = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign', 'verify']);
console.log('generated length:', gen.algorithm.length, 'bits');

// Real output (Node v24.19.0):
//   secret { name: 'HMAC', length: 136, hash: { name: 'SHA-256' } } false [ 'sign', 'verify' ]
//   subtle.sign : c943724c56e1f89b5ca21b9f07a8df3d87126e3e674ac7835fbd2c6bf78bb4ab
//   createHmac  : c943724c56e1f89b5ca21b9f07a8df3d87126e3e674ac7835fbd2c6bf78bb4ab
//   verify ok      : true
//   verify tampered: false
//   no "verify" usage -> InvalidAccessError - Unable to use this key to verify
//   generated length: 512 bits
```

The imported 17-byte secret shows up as `length: 136` bits. The MAC is byte-for-byte the `createHmac` result. `subtle.verify` resolves to `false` for a tampered body instead of throwing, and does the comparison for you, so there is no `===` on secrets to get wrong. A key imported without the `'verify'` usage cannot verify: `InvalidAccessError`. A generated HMAC key with no `length` gets the hash's block size, 512 bits for SHA-256.

**Example 3 — AES-GCM: tag in the ciphertext, tamper detection.**

javascript

```
const { subtle } = globalThis.crypto;
const enc = new TextEncoder();

const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const plaintext = enc.encode('card ending 4242');           // 16 bytes
const aad = enc.encode('user:42');                          // authenticated, not encrypted

// 1. A fresh 12-byte IV for every encryption with this key
const iv = crypto.getRandomValues(new Uint8Array(12));   // call it on crypto: a destructured copy throws ERR_INVALID_THIS
const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, plaintext);
console.log('plaintext', plaintext.byteLength, 'bytes -> ciphertext', ct.byteLength, 'bytes (16-byte tag appended)');

// 2. Decrypt with the same iv and additionalData
const pt = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct);
console.log('decrypted:', new TextDecoder().decode(pt));

// 3. Flip one bit of the ciphertext: the tag check fails and decrypt rejects
const bad = new Uint8Array(ct.slice(0));   // copy first: new Uint8Array(ct) alone would be a view over ct
bad[0] ^= 1;
for (const [label, params, data] of [
  ['flipped bit  ', { name: 'AES-GCM', iv, additionalData: aad }, bad],
  ['wrong AAD    ', { name: 'AES-GCM', iv, additionalData: enc.encode('user:43') }, ct],
  ['wrong IV     ', { name: 'AES-GCM', iv: new Uint8Array(12), additionalData: aad }, ct],
  ['tag cut off  ', { name: 'AES-GCM', iv, additionalData: aad }, ct.slice(0, -16)],
]) {
  try { await subtle.decrypt(params, key, data); console.log(label, 'decrypted?!'); }
  catch (err) { console.log(label, '->', err.constructor.name, err.name, '-', err.message); }
}

// 4. Store iv + ciphertext together; the IV is not secret
const packed = Buffer.concat([iv, Buffer.from(ct)]).toString('base64');
const raw = Buffer.from(packed, 'base64');
const again = await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: aad }, key, raw.subarray(12));
console.log('from storage:', new TextDecoder().decode(again));

// Real output (Node v24.19.0):
//   plaintext 16 bytes -> ciphertext 32 bytes (16-byte tag appended)
//   decrypted: card ending 4242
//   flipped bit   -> DOMException OperationError - The operation failed for an operation-specific reason
//   wrong AAD     -> DOMException OperationError - The operation failed for an operation-specific reason
//   wrong IV      -> DOMException OperationError - The operation failed for an operation-specific reason
//   tag cut off   -> DOMException OperationError - The operation failed for an operation-specific reason
//   from storage: card ending 4242
```

16 bytes of plaintext became 32 bytes: 16 of ciphertext plus the 16-byte tag. All four tampering cases reject the same way: a `DOMException` named `OperationError` with the message "The operation failed for an operation-specific reason". You cannot tell which input was wrong, and that is deliberate. Two traps came up while writing this example:

- **`new Uint8Array(ct)` is a view, not a copy.** Flipping a bit in it changed `ct` itself, so every later decrypt failed. `ct.slice(0)` copies the bytes.
- **`const { getRandomValues } = crypto` breaks.** Calling the destructured function threw `TypeError [ERR_INVALID_THIS]: Value of "this" must be of type Crypto`. Call it as `crypto.getRandomValues(...)`.

**Example 4 — edge case: reusing an IV leaks the plaintext.**

javascript

```
const { subtle } = globalThis.crypto;
const enc = new TextEncoder();
const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);

const iv = crypto.getRandomValues(new Uint8Array(12));      // the bug: one IV reused for two messages
const m1 = enc.encode('transfer $100 to alice');
const m2 = enc.encode('transfer $999 to mallo');
const c1 = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, m1));
const c2 = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, m2));

// GCM encrypts by XOR-ing the plaintext with a keystream derived from (key, iv).
// Same key + same iv = same keystream, so XOR of the ciphertexts = XOR of the plaintexts.
const xor = (a, b) => a.map((x, i) => x ^ b[i]);
const ctXor = xor(c1.subarray(0, m1.length), c2.subarray(0, m2.length));
console.log('c1 ^ c2 equals m1 ^ m2:', Buffer.from(ctXor).equals(Buffer.from(xor(m1, m2))));

// An attacker who knows (or guesses) m1 recovers m2 without the key:
console.log('recovered m2:', new TextDecoder().decode(xor(ctXor, m1)));

// Real output (Node v24.19.0):
//   c1 ^ c2 equals m1 ^ m2: true
//   recovered m2: transfer $999 to mallo
```

Nothing failed and no warning appeared, yet the second message was recovered without the key:

1. AES-GCM is counter mode plus a tag. The cipher turns `(key, iv)` into a keystream and XORs it with the plaintext.
2. The same key and the same `iv` produce the same keystream for both messages.
3. So `c1 ⊕ c2 = (m1 ⊕ k) ⊕ (m2 ⊕ k) = m1 ⊕ m2`. The keystream cancels out.
4. Anyone who knows or guesses one plaintext (a fixed JSON prefix is enough) XORs it in and reads the other. Reuse also leaks enough to forge tags.

The API cannot stop this, because it never sees your previous IVs. Generate 12 fresh random bytes per message. NIST SP 800-38D, Sec. 8.3, caps random-IV GCM at 2³² encryptions per key ("The total number of invocations of the authenticated encryption function shall not exceed 2³²"), so rotate keys before that.

**Example 5 — ECDSA P-256, RSA-PSS, RSASSA-PKCS1-v1_5 and Ed25519.**

javascript

```
const { subtle } = globalThis.crypto;
const data = new TextEncoder().encode('order 42: ship it');
const tampered = new TextEncoder().encode('order 43: ship it');

const algs = [
  // [label, generateKey params, sign/verify params]
  ['ECDSA P-256      ', { name: 'ECDSA', namedCurve: 'P-256' }, { name: 'ECDSA', hash: 'SHA-256' }],
  ['RSA-PSS 2048     ', { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
                        { name: 'RSA-PSS', saltLength: 32 }],
  ['RSASSA-PKCS1-v1_5', { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
                        { name: 'RSASSA-PKCS1-v1_5' }],
  ['Ed25519          ', { name: 'Ed25519' }, { name: 'Ed25519' }],
];

for (const [label, genParams, signParams] of algs) {
  const { publicKey, privateKey } = await subtle.generateKey(genParams, false, ['sign', 'verify']);
  const sig = await subtle.sign(signParams, privateKey, data);
  const ok = await subtle.verify(signParams, publicKey, sig, data);
  const bad = await subtle.verify(signParams, publicKey, sig, tampered);
  console.log(`${label} sig ${String(sig.byteLength).padStart(3)} bytes | verify: ${ok} | tampered: ${bad} | public extractable: ${publicKey.extractable}`);
}

// ECDSA and RSA-PSS use random values, so two signatures of the same data differ; Ed25519 and PKCS1-v1_5 do not
const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
const s1 = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ec.privateKey, data));
const s2 = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ec.privateKey, data));
const ed = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
const e1 = Buffer.from(await subtle.sign('Ed25519', ed.privateKey, data));
const e2 = Buffer.from(await subtle.sign('Ed25519', ed.privateKey, data));
console.log('ECDSA signatures identical:', s1.equals(s2), '| Ed25519 signatures identical:', e1.equals(e2));

// A public key cannot sign
try { await subtle.sign('Ed25519', ed.publicKey, data); }
catch (err) { console.log('sign with public key ->', err.name, '-', err.message); }

// Real output (Node v24.19.0):
//   ECDSA P-256       sig  64 bytes | verify: true | tampered: false | public extractable: true
//   RSA-PSS 2048      sig 256 bytes | verify: true | tampered: false | public extractable: true
//   RSASSA-PKCS1-v1_5 sig 256 bytes | verify: true | tampered: false | public extractable: true
//   Ed25519           sig  64 bytes | verify: true | tampered: false | public extractable: true
//   ECDSA signatures identical: false | Ed25519 signatures identical: true
//   sign with public key -> InvalidAccessError - Unable to use this key to sign
```

Every algorithm verifies the original and rejects the tampered data. The parameters sit in different places:

- **RSA**: `hash` goes into the key at `generateKey`/`importKey` time, and `saltLength` (bytes) into each RSA-PSS `sign` call (32 = the SHA-256 output size is the usual choice). `publicExponent` is a big-endian `Uint8Array` (`[1, 0, 1]` = 65537).
- **ECDSA**: `hash` goes into each `sign` call.
- **Ed25519**: needs nothing besides its name.

The pair was generated with `extractable: false`, yet the public key reports `extractable: true`, because public keys are always exportable. ECDSA signatures are randomized, so two signatures of the same data differ. Ed25519 is deterministic.

**Example 6 — PBKDF2 for passwords, HKDF for subkeys.**

javascript

```
import { pbkdf2Sync, hkdfSync } from 'node:crypto';
const { subtle } = globalThis.crypto;
const enc = new TextEncoder();

// --- PBKDF2: password -> key bits. The password is imported as a non-extractable "key".
const salt = enc.encode('16-byte-salt-abc');               // use crypto.getRandomValues in real code
const pwKey = await subtle.importKey('raw', enc.encode('correct horse'), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
console.log('PBKDF2 key:', pwKey.type, pwKey.algorithm, pwKey.extractable);

const t0 = performance.now();
const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, pwKey, 256);
const ms = performance.now() - t0;
console.log('deriveBits :', Buffer.from(bits).toString('hex'));
console.log('pbkdf2Sync :', pbkdf2Sync('correct horse', salt, 600_000, 32, 'sha256').toString('hex'));
console.log('600k iterations took', ms > 50 ? 'more than 50 ms' : 'under 50 ms');

// deriveKey = deriveBits + importKey in one step: here straight to an AES-GCM key
const aes = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
  pwKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
console.log('deriveKey  :', aes.algorithm, aes.usages);

// A KDF key must be imported with extractable: false
try { await subtle.importKey('raw', enc.encode('x'), 'PBKDF2', true, ['deriveBits']); }
catch (err) { console.log('extractable PBKDF2 key ->', err.name, '-', err.message); }

// --- HKDF: high-entropy secret -> several independent subkeys (salt + info)
const master = enc.encode('0123456789abcdef0123456789abcdef');   // e.g. 32 random bytes from a secret store
const hk = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits']);
const hsalt = new Uint8Array(32);                                   // 32 zero bytes, for a reproducible demo
for (const info of ['session-cookie-signing', 'csrf-token']) {
  const out = await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: hsalt, info: enc.encode(info) }, hk, 256);
  const node = Buffer.from(hkdfSync('sha256', master, hsalt, info, 32));
  console.log(`HKDF ${info.padEnd(22)}`, Buffer.from(out).toString('hex').slice(0, 32) + '…', '| same as hkdfSync:', node.equals(Buffer.from(out)));
}

// HKDF and PBKDF2 need length; leaving it out is an error
try { await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: hsalt, info: new Uint8Array() }, hk); }
catch (err) { console.log('no length ->', err.name, '-', err.message); }

// Real output (Node v24.19.0):
//   PBKDF2 key: secret { name: 'PBKDF2' } false
//   deriveBits : 888533d92b8a4c554a4973bc2f0d5949cc55d0da40d67aeca2e2d680f12dd3e4
//   pbkdf2Sync : 888533d92b8a4c554a4973bc2f0d5949cc55d0da40d67aeca2e2d680f12dd3e4
//   600k iterations took more than 50 ms
//   deriveKey  : { name: 'AES-GCM', length: 256 } [ 'encrypt', 'decrypt' ]
//   extractable PBKDF2 key -> SyntaxError - PBKDF2 keys are not extractable
//   HKDF session-cookie-signing 511bc7a7e7eefac9824b23e4a388c597… | same as hkdfSync: true
//   HKDF csrf-token             8d8bb846452bdaf44e5abe0b6d1b0efd… | same as hkdfSync: true
//   no length -> OperationError - length cannot be null
```

A password or master secret enters Web Crypto as a `'PBKDF2'` or `'HKDF'` key that can only be used for derivation. The docs require `extractable: false` for KDF keys, and `true` rejects with `SyntaxError`. `deriveBits` takes the output length in **bits** (256) and must be given one. `pbkdf2Sync` and `hkdfSync` take **bytes** (32). The outputs match `node:crypto` exactly. 600,000 iterations of PBKDF2-HMAC-SHA256 is the OWASP Password Storage Cheat Sheet figure (it lists 220,000 for SHA-512). OWASP ranks Argon2id first and scrypt second, and recommends PBKDF2 when FIPS-140 compliance is required. HKDF is not for passwords. It turns a secret that is already random into several independent keys, one per `info` label.

**Example 7 — `exportKey` / `importKey` formats and `extractable: false`.**

javascript

```
const { subtle } = globalThis.crypto;

// Secret key: 'raw' (bytes) and 'jwk' (JSON)
const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const raw = await subtle.exportKey('raw', aes);
const jwk = await subtle.exportKey('jwk', aes);
console.log('AES raw:', raw.constructor.name, raw.byteLength, 'bytes');
console.log('AES jwk:', { ...jwk, k: `<${jwk.k.length} base64url chars>` });

// Key pair: 'spki' (public, DER), 'pkcs8' (private, DER), 'jwk', and 'raw' for EC public keys
const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = await subtle.exportKey('spki', ec.publicKey);
const pkcs8 = await subtle.exportKey('pkcs8', ec.privateKey);
const ecRaw = await subtle.exportKey('raw', ec.publicKey);
const ecJwk = await subtle.exportKey('jwk', ec.publicKey);
console.log('EC spki', spki.byteLength, '| pkcs8', pkcs8.byteLength, '| raw public', ecRaw.byteLength, 'starts 0x' + new Uint8Array(ecRaw)[0].toString(16));
console.log('EC public jwk keys:', Object.keys(ecJwk).sort().join(','));

// DER -> PEM is just base64 with header lines
const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(spki).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
console.log(pem.split('\n')[0], '…', pem.split('\n').length, 'lines');

// Import the public key back from spki (PEM body without the header lines)
const der = Buffer.from(pem.replace(/-----[^-]+-----|\n/g, ''), 'base64');
const pub = await subtle.importKey('spki', der, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
console.log('re-imported:', pub.type, pub.algorithm);

// Wrong format for the key type
try { await subtle.exportKey('raw', ec.privateKey); }
catch (err) { console.log('raw private EC ->', err.name, '-', err.message); }

// extractable: false — the key works but its bytes never leave the CryptoKey
const locked = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
console.log('locked.extractable =', locked.extractable);
try { await subtle.exportKey('raw', locked); }
catch (err) { console.log('export locked ->', err.name, '-', err.message); }
// The flag is read-only (a getter on CryptoKey.prototype)
try { locked.extractable = true; }
catch (err) { console.log('set extractable ->', err.name, '-', err.message); }

// Real output (Node v24.19.0):
//   AES raw: ArrayBuffer 32 bytes
//   AES jwk: {
//     key_ops: [ 'encrypt', 'decrypt' ],
//     ext: true,
//     alg: 'A256GCM',
//     kty: 'oct',
//     k: '<43 base64url chars>'
//   }
//   EC spki 91 | pkcs8 138 | raw public 65 starts 0x4
//   EC public jwk keys: crv,ext,key_ops,kty,x,y
//   -----BEGIN PUBLIC KEY----- … 4 lines
//   re-imported: public { name: 'ECDSA', namedCurve: 'P-256' }
//   raw private EC -> NotSupportedError - Unable to export ECDSA private key using raw format
//   locked.extractable = false
//   export locked -> InvalidAccessError - key is not extractable
//   set extractable -> TypeError - Cannot set property extractable of #<CryptoKey> which has only a getter
```

What each export format contains:

- **`'raw'`**: the bare bytes, for secret keys and EC/Ed25519 public keys. An EC public key in raw form is 65 bytes: `0x04`, then x and y.
- **`'jwk'`**: an object whose `alg`, `key_ops` and `ext` mirror the `CryptoKey`.
- **`'spki'` and `'pkcs8'`**: DER bytes. PEM is those bytes in base64 between header lines, and Web Crypto neither reads nor writes the headers.

Exporting an EC private key as `'raw'` rejects with `NotSupportedError`. A non-extractable key still works for its usages, but `exportKey` rejects with `InvalidAccessError`, and the property cannot be set (it is a getter, so assignment throws in strict-mode ES modules).

**Example 8 — interop: Web Crypto keys in `node:crypto` and back.**

javascript

```
import { KeyObject, sign, verify, generateKeyPairSync, createSecretKey, createHmac } from 'node:crypto';
const { subtle } = globalThis.crypto;
const data = Buffer.from('order 42: ship it');

// --- Web Crypto key -> node:crypto ---------------------------------------
const ec = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pubKO = KeyObject.from(ec.publicKey);                     // CryptoKey -> KeyObject
console.log('KeyObject:', pubKO.type, pubKO.asymmetricKeyType, pubKO.asymmetricKeyDetails);
console.log(pubKO.export({ type: 'spki', format: 'pem' }).split('\n')[0]);

const webSig = Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ec.privateKey, data));
// Web Crypto ECDSA signatures are r||s (IEEE P1363, 64 bytes for P-256); node:crypto defaults to DER
console.log('verify, default DER       :', verify('sha256', data, pubKO, webSig));
console.log('verify, dsaEncoding p1363 :', verify('sha256', data, { key: pubKO, dsaEncoding: 'ieee-p1363' }, webSig));

// --- node:crypto key -> Web Crypto ---------------------------------------
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const nodeSig = sign(null, data, privateKey);                   // Ed25519 takes null as the algorithm
const asCryptoKey = publicKey.toCryptoKey('Ed25519', true, ['verify']);   // KeyObject -> CryptoKey
console.log('toCryptoKey:', asCryptoKey.constructor.name, asCryptoKey.algorithm, asCryptoKey.usages);
console.log('subtle.verify of a node:crypto signature:', await subtle.verify('Ed25519', asCryptoKey, nodeSig, data));

// The portable route, no Node-specific helpers: export DER/PEM on one side, importKey on the other
const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
const imported = await subtle.importKey('spki', spkiDer, 'Ed25519', false, ['verify']);
console.log('importKey(spki) verify:', await subtle.verify('Ed25519', imported, nodeSig, data));

// Secret keys too: createSecretKey -> toCryptoKey for HMAC
const hk = createSecretKey(Buffer.from('whsec_test_secret')).toCryptoKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = Buffer.from(await subtle.sign('HMAC', hk, data));
console.log('HMAC matches createHmac:', mac.equals(createHmac('sha256', 'whsec_test_secret').update(data).digest()));

// Real output (Node v24.19.0):
//   KeyObject: public ec { namedCurve: 'prime256v1' }
//   -----BEGIN PUBLIC KEY-----
//   verify, default DER       : false
//   verify, dsaEncoding p1363 : true
//   toCryptoKey: CryptoKey { name: 'Ed25519' } [ 'verify' ]
//   subtle.verify of a node:crypto signature: true
//   importKey(spki) verify: true
//   HMAC matches createHmac: true
```

`KeyObject.from(cryptoKey)` (added in v15.0.0) gives a `KeyObject` you can export to PEM or pass to `crypto.sign`/`verify`. Note that Node names the curve `prime256v1`. A Web Crypto ECDSA signature fails `crypto.verify` with the default DER encoding and passes with `dsaEncoding: 'ieee-p1363'`. The reverse direction is `keyObject.toCryptoKey(algorithm, extractable, usages)` (added in v23.0.0 and v22.10.0). For code that must also run outside Node, export SPKI/PKCS#8 DER on one side and `importKey` it on the other, which works everywhere.

**Example 9 — edge case: `extractable: false` is not a hard wall inside Node.**

javascript

```
import { KeyObject } from 'node:crypto';
const { subtle } = globalThis.crypto;

const key = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const err = await subtle.exportKey('raw', key).catch((e) => e);
console.log('subtle.exportKey:', err.name, '-', err.message);

process.on('warning', (w) => console.log('warning event   :', w.name, w.code));
const ko = KeyObject.from(key);                          // still allowed in v24.19.0...
console.log('KeyObject.from  :', ko.type, ko.symmetricKeySize, 'bytes');
console.log('ko.export()     :', ko.export().length, 'raw key bytes are out');   // ...and the bytes leak

// Real output (Node v24.19.0):
//   subtle.exportKey: InvalidAccessError - key is not extractable
//   KeyObject.from  : secret 64 bytes
//   ko.export()     : 64 raw key bytes are out
//   warning event   : DeprecationWarning DEP0204
```

The same run also printed this on stderr (the PID in brackets differs per run):

text

```
(node:613463) [DEP0204] DeprecationWarning: Passing a non-extractable CryptoKey to KeyObject.from() is deprecated.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

`subtle.exportKey` refuses the non-extractable key, but `KeyObject.from` converts it anyway and `export()` hands out all 64 key bytes. The deprecations page lists DEP0204 as a documentation-only deprecation (changed in v24.15.0) that "will throw an error in a future version", yet v24.19.0 already emitted a runtime `DeprecationWarning` here. So in Node, `extractable: false` protects against your own code exporting a key by accident. It is not a security boundary against code running in the same process, and keys still need a secret store (lesson 27).

## Common mistakes & gotchas

- **Node spellings in Web Crypto.** `'sha256'`, `'aes-256-gcm'` and `'prime256v1'` are `node:crypto` names. Web Crypto wants `'SHA-256'`, `{ name: 'AES-GCM' }` with a 256-bit key, and `namedCurve: 'P-256'`. A wrong name rejects with `NotSupportedError`.
- **Looking for the GCM tag separately.** `subtle.encrypt` appends it, and `subtle.decrypt` expects it at the end. Moving data between Node's `getAuthTag()` and Web Crypto means concatenating or splitting the last 16 bytes yourself.
- **Reusing an IV.** Same key + same IV leaks `m1 ⊕ m2` and allows tag forgery (Example 4). Fresh random 12-byte IV per message.
- **Expecting a useful error from `decrypt`.** Every authentication failure is the same `OperationError`. Log context (key id, message id) yourself.
- **Bits vs bytes.** `deriveBits(…, 256)` and `{ length: 256 }` are bits. `pbkdf2Sync(…, 32, …)`, `hkdfSync(…, 32)` and `saltLength: 32` are bytes.
- **Destructuring `getRandomValues`.** It needs `this === crypto` and throws `ERR_INVALID_THIS` when detached. Call `crypto.getRandomValues(u8)`, which also caps each call at 65,536 bytes.
- **Mixing ECDSA signature formats.** Web Crypto produces 64-byte `r || s`. `node:crypto` defaults to DER. Pass `dsaEncoding: 'ieee-p1363'` on the Node side.
- **Expecting `extractable: false` to hide a key inside Node.** `KeyObject.from()` still exports it in v24 (with DEP0204). It guards against accidents, not against hostile code in the process.
- **Wrong usages.** A key created with `['sign']` cannot `verify` (`InvalidAccessError`). For key pairs the private key gets `sign` and the public key `verify`.
- **Hashing large files with `subtle.digest`.** It takes the whole input as one buffer, with no streaming. Use `createHash` with a stream in Node.

## Best practices

- **Write portable crypto against `crypto.subtle`** (JWT verification, webhook HMACs, encrypted cookies) and keep `node:crypto` for Node-only needs: streaming hashes, `scrypt`, PEM handling, `timingSafeEqual` on raw buffers.
- **Generate keys with `extractable: false`** unless you really must export them, and give each key only the usages it needs.
- **Store `iv || ciphertext+tag` together** (for example base64 of the concatenation) and pass `additionalData` to bind the ciphertext to its context (user id, record id).
- **Import a shared secret once** and reuse the `CryptoKey`, instead of calling `importKey` on every request.
- **For passwords, prefer Argon2id or scrypt** (lesson 85). If you must use PBKDF2 (FIPS, or Web-Crypto-only runtimes), use at least the current OWASP iteration count (600,000 for SHA-256 when this lesson was written) and a 16-byte random salt per password.
- **Move keys between the two APIs with `KeyObject.from` / `toCryptoKey`,** or with SPKI/PKCS#8 DER when the other side is not Node.

## ⭐ Interview lens

> **Q: “How does AES-GCM in Web Crypto report tampering, and where is the tag?”**  
> A: `subtle.encrypt` returns the ciphertext with the authentication tag appended (16 bytes by default). `subtle.decrypt` checks the tag first. If the ciphertext, IV, additional data or key is wrong, it rejects with a `DOMException` named `OperationError` and returns no plaintext. *Trap:* in `node:crypto` the tag is separate (`getAuthTag`/`setAuthTag`), so moving data between the two APIs means splitting or joining the last 16 bytes.

> **Q: “Why must the IV be unique per encryption with AES-GCM?”**  
> A: GCM XORs the plaintext with a keystream derived from the key and IV. Two messages under the same key and IV share the keystream, so XOR-ing the ciphertexts gives the XOR of the plaintexts. Knowing one plaintext reveals the other, and the tag's authentication key leaks too, which allows forgeries. Use a random 12-byte IV per message and store it with the ciphertext.

> **Q: “A signature made with `crypto.subtle` (ECDSA P-256) fails `crypto.verify` in Node. Why?”**  
> A: Web Crypto emits the 64-byte IEEE P1363 `r || s` form, and `crypto.verify` expects DER by default. Pass `{ key, dsaEncoding: 'ieee-p1363' }`. The key itself converts with `KeyObject.from(cryptoKey)`.

> **Q: “What does `extractable: false` guarantee?”**  
> A: That `subtle.exportKey` and `wrapKey` refuse to give out the key bytes, while the key still works for its usages. Public keys of a generated pair are always extractable. In Node it is not a hard boundary: `KeyObject.from()` on a non-extractable key still works in v24 (deprecated as DEP0204), so treat it as protection against mistakes, not against code in the same process.

> **Q: “When would you use `crypto.subtle` instead of `createHash`/`createHmac`?”**  
> A: When the code must run outside Node too (browser, edge workers, Deno, Bun), or when keys should be non-extractable handles bound to one algorithm. Stay with `node:crypto` for streaming hashes of large inputs, scrypt, and synchronous APIs.

## Cheat-card

- **Access:** `globalThis.crypto.subtle` (= `require('node:crypto').webcrypto.subtle`); everything returns a promise.
- **Digest:** `subtle.digest('SHA-256', data)` → `ArrayBuffer`; names `'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'`.
- **HMAC:** `importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])`; `verify` returns a boolean.
- **AES-GCM:** `{ name: 'AES-GCM', iv /* 12 random bytes */, additionalData? }`; output = ciphertext + 16-byte tag; failure = `OperationError`.
- **Signatures:** `ECDSA` + `namedCurve: 'P-256'` + per-call `hash`; `RSA-PSS` + `saltLength` (bytes); `RSASSA-PKCS1-v1_5`; `Ed25519` (stable since v23.5.0 / v22.13.0).
- **KDFs:** `importKey('raw', secret, 'PBKDF2' | 'HKDF', false, ['deriveBits'])`; `deriveBits(params, key, bits)`; length in bits.
- **Formats:** `raw` (secret, EC/Ed public), `jwk` (all), `spki` (public DER), `pkcs8` (private DER); no PEM headers.
- **extractable:false:** `exportKey` → `InvalidAccessError`; public keys always extractable; `KeyObject.from` still exports (DEP0204).
- **Interop:** `KeyObject.from(cryptoKey)` (v15.0.0); `keyObject.toCryptoKey(alg, ext, usages)` (v23.0.0 / v22.10.0); ECDSA needs `dsaEncoding: 'ieee-p1363'` in `node:crypto`.
- **Random:** `crypto.getRandomValues(u8)` (≤ 65,536 bytes, don't destructure), `crypto.randomUUID()`.

---

## Learn More

- [Web Crypto API (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/webcrypto.html)
- [Crypto: KeyObject, sign, verify (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/crypto.html)
- [Deprecated APIs: DEP0204 (v24) nodejs.org](https://nodejs.org/docs/latest-v24.x/api/deprecations.html)
- [SubtleCrypto developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
- [SubtleCrypto.encrypt() developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [Web Cryptography API w3.org](https://www.w3.org/TR/WebCryptoAPI/)
- [Password Storage Cheat Sheet owasp.org](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [NIST SP 800-38D: GCM (PDF) nist.gov](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
