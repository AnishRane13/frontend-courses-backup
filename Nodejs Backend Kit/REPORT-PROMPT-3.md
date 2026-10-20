# REPORT — Prompt 3 (core modules, streams, HTTP, networking and Web APIs, 2026-10-10)

**Scope:**
- 11 new lessons, 75–85, continuing the numbering.
- `## Additional topics` sections appended to lessons 21, 22, 23, 24, 27, 28, 29, 30, 31, 32 and 33, with Cheat-card bullets added to each.
- One Learn More link added to lessons 12, 25 and 69, pointing back to lesson 75. Those lessons already call `fetch` without explaining it.
- The README.md index updated to list all 85 lessons.

**Environment:**
- **Node:** v24.19.0, with V8 13.6.233.17-node.51, libuv 1.52.1, c-ares 1.34.6, bundled undici 7.29.0 and bundled OpenSSL 3.5.7. npm 11.17.0. Linux x64 (7.0.0-38-generic).
- **Where code ran:** every example was run in a scratch directory outside the kit, and the outputs are pasted from those runs. Version marks come from the History tables in `nodejs.org/docs/latest-v24.x`; `nodejs.org/api` now serves v26.

**Libraries and tools:**

| Kind | Name and version |
|---|---|
| npm libraries | undici 8.11.2 (side checks with 7.29.0 and 7.30.0), busboy 1.6.0, Express 5.2.1 (proxy-addr 2.0.8) |
| npm metadata only | isolated-vm 7.0.1 (not buildable here), multer 2.4.0 |
| Compression | zlib 1.3.2.1, brotli 1.2.0, zstd 1.5.7 |
| Command-line tools | curl 8.18.0, system OpenSSL 3.5.5, strace 6.19, ss 6.19.0, OpenBSD netcat 1.234, dig 9.20.24, util-linux `script` 2.41.3 |
| System | systemd-resolved 259.5, glibc 2.43 |
| Comparison runtimes | `npx node@20`, `@22` (v22.23.3), `@23` (v23.11.1), `@24.0.0`, `@24.17.0`, `@24.18.0`, `@25` (v25.9.0) |

## Files

| File | New or appended | Topics | SVGs embedded | Verification run | Unverified items |
|---|---|---|---|---|---|
| 44-outbound-http-fetch-undici-and-http-request.md | new (Topic 75 of 85) | fetch on undici (bundled 7.29.0 vs npm 8.11.2); `http.Agent` keepAlive/maxSockets, proven with client ports; undici `request`/`Pool`/`Agent`/`MockAgent` (with `node --test`); `https.request`; connect/headers/body timeouts (undici checks them on a ~1 s ticker, so a 300 ms setting fires at ~1000 ms); `AbortSignal.timeout`; retries with full-jitter backoff and RFC 9110 idempotency, `RetryAgent`; streaming with `duplex: 'half'`; FormData/Blob/File uploads; safe JSON reading; redirects; a local CONNECT proxy with `ProxyAgent`/`EnvHttpProxyAgent` and `NODE_USE_ENV_PROXY`; an error catalogue (12 codes produced for real) | assets/i30_02_0d3eb5e7.svg | 16 JS blocks re-run with an automatic output comparison; the ETIMEDOUT block re-run (133 s) | none |
| 45-tcp-with-net.md | new (Topic 76) | net server/client; the socket as a Duplex; framing demonstrated (5 writes → 1 chunk; 1 MiB → 17–18 chunks), length-prefixed and delimiter decoders; backpressure (`write()` false, `'drain'`); half-open and `allowHalfOpen`; `end`/`destroy`/`resetAndDestroy`; `setTimeout`; `setKeepAlive` (options form traced with strace, v24 vs v22); a line-protocol chat server with a 3-client transcript | assets/i23_02_ec427c97.svg, assets/i26_01_e8e417ed.svg | 9 output blocks re-run (chunk counts vary, as stated); chat transcript identical over 5 runs | none |
| 46-udp-with-dgram.md | new (Topic 77) | createSocket/bind/send/rinfo; dead-port behaviour (unconnected socket: silent; connected socket: ECONNREFUSED); EMSGSIZE limits; real loopback loss (4,908 of 5,000, matching the kernel's RcvbufErrors); broadcast (EACCES without `setBroadcast`); multicast on loopback; request/response with retry over explicitly simulated loss | none | All 6 output blocks match | none (multicast tested on loopback only; said in the text) |
| 31-readline.md | new (Topic 78) | Line-by-line reading with `for await`, `crlfDelay`; `readline/promises` with an AbortSignal timeout; prompts driven by pipes and by a real TTY (`script`); history options and the `'history'` event; the late-`'line'`-listener gotcha; CRLF / missing-newline / multibyte edge cases; readline vs a StringDecoder + tail splitter (consistent with lesson 28), with a measured table | none | All examples plus a benchmark on a 102 MiB file | none |
| 30-util-module.md | new (Topic 79) | `inspect` options and `util.inspect.custom`; `format` specifiers; `types` vs `instanceof` across a vm realm; `deprecate` and its flags; `inherits` (legacy); `styleText` (TTY, NO_COLOR and FORCE_COLOR all captured); `promisify` and `.custom`; `parseArgs` (links to 72 and 04) | none | All 9 examples run as saved | none |
| 32-zlib-compression.md | new (Topic 80) | gzip/deflate/deflateRaw (+18 / +6 bytes framing), Brotli, zstd (Experimental, v23.8.0 / v22.15.0); one-shot vs stream APIs; HTTP negotiation with `Vary` against a local server; zip bomb (100 MiB → 101,941 B; `maxOutputLength` → `ERR_BUFFER_TOO_LARGE`; stream guard trips at 10 MiB; `createGunzip` ignores `maxOutputLength`); measured level/quality tuning | assets/i25_01_8f41e854.svg | All blocks re-run; sizes and codes identical, timings vary | none |
| 33-dns-module.md | new (Topic 81) | `lookup` (getaddrinfo on the pool, /etc/hosts, search domains) vs `resolve*` (c-ares, main thread), proven with strace; thread-pool saturation (lookup 847–1126 ms vs resolve 0–1 ms); no caching in Node; `family`/`all`/`order`/`--dns-result-order`; happy eyeballs (`autoSelectFamily`); a local DNS server that drops packets to show a spike; `dns.promises` and `Resolver` | assets/i04_02_51406ab8.svg | 7 output blocks re-run (timings and round-robin order vary, as stated) | 2: the c-ares retry timing; the cause of one 2050 ms spike |
| 34-vm-module.md | new (Topic 82) | Contexts, `vm.Script` reuse; timeouts and how async code escapes them; `microtaskMode: 'afterEvaluate'`; a real escape to the host `process` (why vm is not a sandbox), with the docs quoted; `worker_threads` with `resourceLimits` as a crash and resource boundary; isolated-vm | none | Context, timeout, escape and worker examples run | 1: isolated-vm runtime behaviour (no C/C++ toolchain to build it; the real `gyp` error is shown) |
| 39-web-streams.md | new (Topic 83) | ReadableStream / WritableStream / TransformStream; readers and writers (`desiredSize` going to −3, `ready`); queuing strategies; `pull()` vs `push()`; `Readable/Writable.toWeb/fromWeb`, `Duplex.toWeb` (the 128 KiB `toWeb` read-ahead is shown from the source and a run); fetch bodies with a streamed upload; async iteration and `preventCancel`; `pipeThrough`/`pipeTo`/`tee`/`TextDecoderStream`/`CompressionStream`; edge case: `tee()` buffering | none (fenced text diagram) | 12 blocks re-run, identical over 3 builds | none |
| 26-binary-web-apis.md | new (Topic 84) | TextEncoder/TextDecoder (`stream: true` vs the lesson 28 split-character problem); Blob; File (global since v20.0.0); atob/btoa (Legacy; `InvalidCharacterError`; `Uint8Array.prototype.toBase64` is not on V8 13.6, but is on Node 25.9); structuredClone (prototype loss, DataCloneError, transfer, pooled Buffers not transferable); a decision table vs Buffer | none | 8 examples re-run | none |
| 28-web-crypto.md | new (Topic 85) | digest; HMAC; AES-GCM (tampering → `OperationError`; edge case: IV reuse recovering the plaintext); ECDSA P-256, RSA-PSS, RSASSA-PKCS1-v1_5, Ed25519 (stable since v23.5.0 / v22.13.0); PBKDF2 and HKDF (cross-checked against node:crypto); generateKey/importKey/exportKey in raw, jwk, spki and pkcs8; `extractable: false`; interop with `KeyObject` both ways; a comparison table against lesson 24 | none | 9 examples re-run | none |
| 23-the-fs-module-reading-writing-files.md | appended (+9 Cheat-card bullets) | stat/lstat; readdir `withFileTypes`/`recursive`; rm/unlink; copyFile/cp; `fs.glob` (stable v24.0.0); FileHandle and file descriptors (GC warning, `await using`); symlinks; chmod/EACCES; recursive watch caveats (real duplicate events); edge case: a broken symlink | none | 10 blocks match; strace confirms the internals described | none |
| 24-path-os-url-portable-filesystem-and-environment-info.md | appended (+4) | `os.availableParallelism` (links to 07; `taskset` shows 2 vs 8); `os.EOL`; `URL.canParse`/`URL.parse`; a `URLPattern` router (links to 72); edge case: `canParse` with a base accepts `//evil.test` and `javascript:` | none | All blocks match | none |
| 25-buffer-working-with-binary-data.md | appended (+5) | Bridge to lesson 84; Buffer vs Uint8Array with proofs (subclass, pool and byteOffset, `slice` view vs copy, `toString`/JSON, shared ArrayBuffer); edge case: `buf.buffer` exposing another Buffer's bytes | none | 4 blocks match | none |
| 27-crypto-hashing-hmac-random-encryption.md | appended (+6) | generateKeyPair (rsa/ec/ed25519, PEM and encrypted PEM); `crypto.sign`/`verify` and createSign/createVerify; hkdf; pbkdf2 (OWASP counts, verified); link to lesson 85; edge case: `hkdfSync` returns an ArrayBuffer | none | 6 blocks match | none |
| 36-readable-writable-streams.md | appended (+6) | destroy/`errored`/`closed`; `finished` (callback, promise, cleanup); `_final`; cork/uncork with real `_writev` batching (one `writev` syscall in strace); `map`/`filter`/`take`/`toArray` (Experimental, `concurrency`); link to 83 | none | 7 blocks match | none |
| 37-transform-duplex-streams.md | appended (+4) | PassThrough; `Duplex.from` with every input kind the docs list; `stream.compose` (reuses the corrected `createCsvParser()`); async generators as pipeline stages (throw, early return, later-stage failure); edge case: yielding `null` | assets/i23_02_ec427c97.svg | 5 blocks match | none |
| 38-backpressure-pipe-pipeline.md | appended (+3) | pipeline `signal` (`AbortError` with the reason in `cause`, which streams are destroyed); `{ end: false }` with pipe and pipeline (the promise form only; a failed pipeline does not destroy the destination); edge case: resolving before the destination flushes | none | 7 blocks match | none |
| 40-the-http-module-createserver.md | appended (+2) | Client side: this lesson's server called by `fetch`, linking to 75; edge case: back-to-back fetches alternating between two sockets | none | 2 blocks match | none |
| 41-parsing-requests-writing-responses.md | appended (+5) | urlencoded with a size cap; a hand-written multipart parser fed a real FormData body (why it is fragile); busboy 1.6.0 limits; ETag / If-None-Match → 304, Range → 206 single and multipart, 416; X-Forwarded-For trust (right-most untrusted hop), Express `trust proxy` run 5 ways; edge case: a quoted boundary plus `filename*` breaks the hand parser | none | 6 scripts plus a 13-command curl transcript match | none |
| 42-manual-routing-serving-json.md | appended (+4) | Static files (MIME map, charset, nosniff, pipeline, 400/403/404/405); a traversal guard attacked with `curl --path-as-is` (a naive server leaks 3 ways; the guarded one blocks all of them); what `new URL` normalizes; a URLPattern router (Experimental; links to 72); edge case: a `public-old` sibling directory passing `startsWith(root)` | none | Servers and 3 transcripts re-run | none |
| 43-http-vs-https-tls-http2-cors.md | appended (+6) | `tls` in depth (minVersion, ALPN, SNICallback, getPeerCertificate); mTLS with an openssl CA and real rejections; `setSecureContext` reload (serial 1001 → 1002); HSTS; `Vary: Origin` with a toy cache; HTTP/3 and QUIC overview (the v24.19.0 Linux binary has no `node:quic`, even with `--experimental-quic`); edge case: a rejected client still gets `'secureConnect'` under TLS 1.3 | none (fenced mTLS diagram) | Scripts, servers and 3 transcripts re-run | 1: QUIC build flags on other platforms; HTTP/3 support in proxies, CDNs and browsers |
| 12-es-modules.md, 25-timers-…, 113-microservices-in-node.md | one Learn More bullet each | Link back to lesson 75 | none | Append-only check | none |
| README.md | updated | New "Outbound HTTP, networking, core modules and Web APIs" group listing 75–85; 21–24 and 27–33 marked "+ additional topics"; REPORT-PROMPT-3 linked | — | Diffed against the previous version: additions only | — |

**Totals:**
- 4 `> ⚠️ Unverified` lines, each next to the claim it qualifies.
- No output was pasted without being run.
- All Learn More URLs returned HTTP 200.

**Coordinator checks:**
- **Append-only:** a script diffed the 14 touched existing lessons against snapshots taken before writing. The only changes are inserted Cheat-card bullets, the single Learn More bullet and the appended tail; no existing line changed.
- **Template:** all 11 new lessons have the 9 template sections in order, with 4–5 Q&A each. Lessons 78 and 79 each had an extra `##` section; I folded both into Code examples as Example 7 and Example 9.
- **Line endings:** CRLF everywhere.
- **Marketing words:** none.
- **Independent re-run:** I re-ran 8 sample blocks myself, from lessons 79, 84, 85, 80, 82 and the 22, 23 and 28 appendices. All 81 expected output lines were found verbatim.

**Assignment correction:** the coordinator's brief named `assets/i30_02_76f1c6dd.svg`, which does not exist. Writer H found the correct file, `assets/i30_02_0d3eb5e7.svg` (the "HTTP/1.1 vs HTTP/2 over one connection" figure), and embedded that.

## ASSET_ISSUES rows added

None. Every embedded figure agrees with its text. The existing `i24_02` issue ("default 16 KB") was left alone in lesson 27 and was not re-embedded.

## MISSING_DIAGRAMS rows added (9)

| Lesson | Concept |
|---|---|
| 75 | undici dispatcher hierarchy |
| 76 | TCP connection lifecycle |
| 76 | Message framing over a byte stream |
| 77 | UDP datagrams vs the TCP stream |
| 80 | HTTP content negotiation |
| 81 | Full DNS resolution path |
| 83 | Web Streams vs Node streams |
| 32 (appendix) | Path-traversal guard pipeline |
| 33 (appendix) | Mutual TLS handshake (TLS 1.3) |

The full "what the diagram should show" text for each row is in MISSING_DIAGRAMS.md.

## Found but not changed (outside this prompt)

This prompt only allowed appending, so these original lines were left as they are. Where an appendix covers the point, it says so.

- **23:** says the Buffer pool is 8 KB with a 4 KB threshold. Since v24.18.0 the default `Buffer.poolSize` is 65536, so the threshold is 32 KiB. I checked this myself: v24.17.0 prints 8192 and v24.19.0 prints 65536, and the docs History confirms it. The Cheat-card line "`slice`/`subarray` share memory" is true only for Buffer.
- **22:** recommends `os.cpus().length` for sizing pools, which contradicts the 07 and 22 appendices (`availableParallelism()`).
- **Scrape-broken string literals:** `'\n'` literals broken across lines remain in 27 (Examples 1–4, plus stray lines after a `// prints 1` comment), 30 and 33. Lesson 28's Interview lens Q3 is missing a `\n` in "when you see a , so".
- **31:**
  - It implies `req.text()` / `req.json()` exist on `IncomingMessage`; they do not.
  - "You cannot `setHeader` after `writeHead`" is imprecise.
- **21:** an Interview lens answer says "a reader ever sees"; it should be "only ever sees".
- **Outdated header and link text:**
  - Lessons 21–33 still have scraped header junk.
  - Their Learn More links point at `nodejs.org/api`, which now serves v26.
  - Lesson 73's header says "Topic 73 of 74", which is now out of date.
- **Bundled undici (not in any lesson):** `npm audit` flags undici 7.0.0–7.29.0 as high severity. That range includes the copy bundled in Node 24.19.0. Whether Node backported the fixes was not checked.

## Side effects outside the kit

- **Throwaway tools and downloaded docs:** `~/.cache/nodekit-repair-tools/pass3/`.
- **Unchanged:** the real npm prefix, `~/.npmrc`, shell rc files and git config.
- **Processes:** none left running.

## Step 6 verification output

```
PASS  12-es-modules.md  (1 image link(s))
PASS  23-the-fs-module-reading-writing-files.md  (2 image link(s))
PASS  24-path-os-url-portable-filesystem-and-environment-info.md  (1 image link(s))
PASS  25-buffer-working-with-binary-data.md  (2 image link(s))
PASS  27-crypto-hashing-hmac-random-encryption.md  (1 image link(s))
PASS  29-timers-settimeout-setinterval-setimmediate-the-event-loop.md  (1 image link(s))
PASS  36-readable-writable-streams.md  (2 image link(s))
PASS  37-transform-duplex-streams.md  (2 image link(s))
PASS  38-backpressure-pipe-pipeline.md  (2 image link(s))
PASS  40-the-http-module-createserver.md  (2 image link(s))
PASS  41-parsing-requests-writing-responses.md  (1 image link(s))
PASS  42-manual-routing-serving-json.md  (1 image link(s))
PASS  43-http-vs-https-tls-http2-cors.md  (2 image link(s))
PASS  113-microservices-in-node.md  (1 image link(s))
PASS  44-outbound-http-fetch-undici-and-http-request.md  (1 image link(s))
PASS  45-tcp-with-net.md  (2 image link(s))
PASS  46-udp-with-dgram.md  (0 image link(s))
PASS  31-readline.md  (0 image link(s))
PASS  30-util-module.md  (0 image link(s))
PASS  32-zlib-compression.md  (1 image link(s))
PASS  33-dns-module.md  (1 image link(s))
PASS  34-vm-module.md  (0 image link(s))
PASS  39-web-streams.md  (0 image link(s))
PASS  26-binary-web-apis.md  (0 image link(s))
PASS  28-web-crypto.md  (0 image link(s))
PASS  README.md  (0 image link(s))
PASS  ASSET_MAP.md  (0 image link(s))
PASS  MISSING_DIAGRAMS.md  (0 image link(s))
PASS  REPORT-PROMPT-3.md  (0 image link(s))
PASS  index links 44-outbound-http-fetch-undici-and-http-request.md
PASS  index links 45-tcp-with-net.md
PASS  index links 46-udp-with-dgram.md
PASS  index links 31-readline.md
PASS  index links 30-util-module.md
PASS  index links 32-zlib-compression.md
PASS  index links 33-dns-module.md
PASS  index links 34-vm-module.md
PASS  index links 39-web-streams.md
PASS  index links 26-binary-web-apis.md
PASS  index links 28-web-crypto.md
PASS  index links REPORT-PROMPT-3.md

26 image links checked in 29 files; 12 new files index-checked: 0 failure(s)
```
