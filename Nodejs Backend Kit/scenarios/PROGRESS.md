# Progress

## Environment
- Node v24.19.0, npm 11.17.0, Express 5.3.0 (Express 4.22.3 installed as `express4` for one comparison).
- PostgreSQL 18.4 via embedded-postgres 18.4.0-beta.17, MongoDB 8.2.6 via mongodb-memory-server 11.3.0. Test databases live in `code/.pgdata/` on disk, because `/tmp` here is a RAM-backed tmpfs.
- Not on this machine: Docker, Kubernetes, Redis, NGINX or another load balancer, a browser, a real payment or email provider, RabbitMQ, SQS, Kafka, a C compiler.

## Done
- [x] 00-how-to-answer.md, mock-rounds.md (5 rounds of 6 chained questions, pointers only), this file and README.md.
- [x] 01-pagination.md: P1 (Must know), P2 (Likely), P3 (Must know), P4 (Likely)
- [x] 02-api-design.md: A1 (Must know), A2 (Likely), A3 (Likely)
- [x] 03-validation-errors.md: V1 (Must know), V2 (Must know), V3 (Likely)
- [x] 04-auth-jwt-security.md: S1 (Must know), S2 (Must know), S3 (Must know), S4 (Likely)
- [x] 05-databases-indexing.md: D1 (Must know), D2 (Must know), D3 (Likely)
- [x] 06-streams.md: ST1 (Must know), ST2 (Likely)
- [x] 07-websockets.md: W1 (Must know), W2 (Likely)
- [x] 08-async-event-loop.md: E1 (Must know), E2 (Must know)
- [x] 09-caching-redis.md: C1 (Must know), C2 (Likely)
- [x] 10-queues-scheduled-jobs.md: Q1 (Must know), Q2 (Likely)
- [x] 11-deployment.md: DP1 (Must know), DP2 (Likely)
- [x] 12-architecture.md: AR1 (Likely), AR2 (Must know)
- [x] 13-production-debugging.md: PD1 (Must know), PD2 (Likely)
- [x] 33 scenarios, 19 Must know. 33 of 33 have a "Verified by" script that passed in the last `verify-all.mjs` run.
- [x] Rewrite for understanding: every topic file now has a "Words you need" glossary after the run-scripts note, and every scenario has a "Before you speak" section before the question. Questions, beats, variations, follow-ups and red flags were rewritten in plain words. Code blocks, Verified and Unverified lines, numbers, sources, IDs, titles and tags were kept byte for byte.
- [x] `code/check-bank.mjs` checks every rule: section order (now starting with "Before you speak"), the glossary, 4 to 7 "Before you speak" bullets, 2 to 5 sentences per case-variation reply, word and number limits, code names in spoken answers, snippet length, banned phrases, em dashes, pasted output, and "in a local test" claims backed by a passing script.

## To do
- Nothing open. To refresh the checks: `cd code && node verify-all.mjs && node check-bank.mjs`.
- Do not run `code/build-index.mjs` any more. It regenerates README.md and PROGRESS.md from a template and would overwrite the hand-written practice guide and Watch outs.

## Unverified (needs infrastructure this machine lacks)
| File | Scenario | What was not run |
|---|---|---|
| 01-pagination.md | P4 | the client was run with Node's built-in fetch, not in a browser. |
| 02-api-design.md | A1 | the provider side needs a real payment provider account. The local script covers only our own table. |
| 04-auth-jwt-security.md | S1 | no Redis on this machine, so the script uses the default memory store; the shared-store claim is not run. |
| 04-auth-jwt-security.md | S2 | a denylist shared across instances needs a store like Redis, which is not on this machine; the script uses an in-process set. |
| 04-auth-jwt-security.md | S3 | no Redis here; the script's limiter counts in process memory, so the shared counter across instances is not run. |
| 04-auth-jwt-security.md | S3 | bcrypt is not installed here, so how it treats lesson 82's short dummy string was not run; the script only checks its length. |
| 04-auth-jwt-security.md | S4 | browser enforcement of CORS, SameSite and the content security policy needs a real browser; the script checks only the response headers and the server-side checks. |
| 07-websockets.md | W1 | needs a Redis server. The Redis version was not run; the script runs the same design with PostgreSQL LISTEN and NOTIFY as the bus. |
| 09-caching-redis.md | C1 | needs a Redis server. The same calls ran against an in-process cache, not Redis. |
| 09-caching-redis.md | C2 | needs a Redis server. SET NX PX and the Lua release were not run; the script checks the same acquire and token-checked release on an in-process stand-in. |
| 10-queues-scheduled-jobs.md | Q1 | needs Redis. The local script uses a PostgreSQL advisory lock. |
| 10-queues-scheduled-jobs.md | Q1 | needs a real email provider that honours idempotency keys. The local script covers only the database side. |
| 10-queues-scheduled-jobs.md | Q2 | needs Redis to run BullMQ. |
| 10-queues-scheduled-jobs.md | Q2 | needs RabbitMQ and SQS. |
| 11-deployment.md | DP1 | needs Kubernetes and Docker. The pre stop hook, how fast endpoint removal reaches the balancer, the grace period's SIGKILL, and signal forwarding when a wrapper is PID 1 were not run on this machine. |
| 11-deployment.md | DP2 | needs Docker. The kernel kill with exit 137, the platform's out-of-memory reason, and how Node sizes its default heap from a container limit were not run on this machine. |
| 12-architecture.md | AR2 | needs Debezium and Kafka. |
| 13-production-debugging.md | PD2 | needs a real load balancer. The exact same-moment race and the 502 the balancer returns were not reproduced; the script proves the close timing and that a request sent on the connection after the close gets no answer. |

## Watch outs
Same lesson bugs as before, said in plain English. Each one is also called out in that scenario's red flags.
- **Lesson 19:** claims `return await` always costs an extra microtask. Lesson 09 measured the opposite. (E1, E2)
- **Lesson 29:** says microtasks drain "between phases". Since Node 11 they drain after each callback. (E1)
- **Lesson 37:** its line splitter breaks a character split across chunks. Use a string decoder or set encoding to utf8. (ST2)
- **Lessons 36, 40, 43, 111:** some newline escapes became real line breaks in the scrape, so the code does not run. (ST1, ST2, W2)
- **Lesson 40:** the timeouts table leaves out the 1 second keep-alive buffer on Node 24.19. (PD2)
- **Lesson 64:** the idempotency code saves the key after the charge, while its interview answer says to save it before. (A1)
- **Lessons 66 vs 64:** "email taken" is 422 in one lesson and 409 in the other. This bank uses 409. (V2)
- **Lesson 65:** the cursor uses a JS Date (loses microseconds and skips rows) and is parsed without checks. Its sort map is unused. (P1, P3)
- **Lessons 74 and 75:** the transfer example locks only one row or none, never checks the balance (74), and reads a balance without checking the row exists. Opposite transfers can deadlock. (D2)
- **Lesson 82:** the dummy bcrypt hash is too short to be valid. (S3)
- **Lesson 83:** it denylists a token id it never issues, never checks audience, stores refresh tokens raw, and rotates with a non-atomic find then save. (S1, S2)
- **Lesson 84:** it calls SameSite Lax "the browser default". That is Chrome and Edge behaviour, not every browser. (S1, S4)
- **Lesson 85:** reading password length crashes when the password is missing. (S3)
- **Lesson 100:** shows a broken lock (plain value plus plain delete), and the lock helper retries itself with no limit. (C2)
- **Lesson 102:** says idle keep-alive sockets make server close hang. Since Node 19 it closes them. Its 5 second keep-alive advice causes the 502s in PD2. (DP1, PD2)
- **Lessons 02, 05, 105:** recommended heap sizes leave little or no headroom under the container limit. (DP2)
- **Lesson 111:** allows any origin, which contradicts its own Origin gotcha, and it reads the token from the query string. (W2)
- **Lesson 113:** the circuit breaker lets every concurrent call through in half-open. (AR1)
- **Lesson 114:** the outbox relay keeps a database transaction open while publishing. (Q2, AR2)
- **Lesson 115:** says lesson 105 covers Kubernetes Jobs. It does not. (Q1)

## Surprises found while verifying (not lesson errors)
- **Pattern index for prefix search:** with a `text_pattern_ops` index and an `ORDER BY` in the default collation, a one-letter prefix sorts every match. A `COLLATE "C"` index serves match, sort and cursor. (P4)
- **`random()` in a WHERE clause:** `UPDATE … WHERE slot = floor(random() * 16)` evaluates `random()` per row and deadlocked. Pick the slot in the application. (P2)
- **MongoDB 8.2 optimizer:** it moved `$limit` below `$lookup` on its own.
- **`Object.assign` and `__proto__`:** `Object.assign({}, body)` with a parsed `__proto__` key changes the copy's prototype. (V1)
- **`monitorEventLoopDelay`:** in a quick check it sometimes missed a single 1.5 second stall. E1 measures timer lateness and event-loop utilization instead.
- **embedded-postgres exit code:** it registers exit hooks that turned a failing script's exit code into 0. `lib/pg.mjs` now calls `process.exit(1)` after cleanup.
