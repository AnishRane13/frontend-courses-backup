# Node.js Scenario Interview Bank

Scenario-based Node.js backend interview questions with model answers, for developers with about three years of experience. Every spoken answer fits in 60 to 90 seconds. The lessons in this kit are the source of truth, and every claim this machine can test was tested by a script in [code/](code/).

Start with [00-how-to-answer.md](00-how-to-answer.md). Practise with [mock-rounds.md](mock-rounds.md).

**Each scenario:** title and tag, scenario, questions to ask back, spoken answer (150 words or fewer, at most two numbers, no code names said aloud), say it in 5 beats, case variations, follow-ups (the hardest marked "Optional: senior"), common wrong answers and red flags, numbers to quote, code sketch (15 lines or fewer per snippet, plus the one script that verifies it), source lessons.

**Tags:** **Must know** comes up in almost every mid-level Node backend interview. **Likely** is common.

**Before quoting a number:** run the script on that scenario's "Verified by" line once. `cd code && npm install`, then for example `node pagination/verify-p1.mjs`. PostgreSQL 18.4 and MongoDB 8.2.6 start in-process (embedded-postgres, mongodb-memory-server), so no Docker is needed. Examples use Node v24.19.0 and Express 5.3.0. `node verify-all.mjs` runs every verifying script, and `node check-bank.mjs` checks every file against the format rules.

**Running count: 33 scenarios, 19 Must know, 33 verified by a passing script.**

| ID | Scenario | Tag | Verification |
|---|---|---|---|
| | **[01. Pagination, filtering and sorting](01-pagination.md)** | | |
| P1 | [The orders endpoint gets slow at 5 million rows](01-pagination.md#p1-the-orders-endpoint-gets-slow-at-5-million-rows) | Must know | Verified: [script](code/pagination/verify-p1.mjs) |
| P2 | [The admin table needs page numbers and a total](01-pagination.md#p2-the-admin-table-needs-page-numbers-and-a-total) | Likely | Verified: [script](code/pagination/verify-p2.mjs) |
| P3 | [Users choose the sort column and add filters](01-pagination.md#p3-users-choose-the-sort-column-and-add-filters) | Must know | Verified: [script](code/pagination/verify-p3.mjs) |
| P4 | [A type-ahead admin search over 2 million users](01-pagination.md#p4-a-type-ahead-admin-search-over-2-million-users) | Likely | Verified: [script](code/pagination/verify-p4.mjs) |
| | **[02. API design: idempotent POST, versioning, long-running work](02-api-design.md)** | | |
| A1 | [A retried payment charges the customer twice](02-api-design.md#a1-a-retried-payment-charges-the-customer-twice) | Must know | Verified: [script](code/api-design/verify-a1.mjs) |
| A2 | [You must change a response shape the mobile app depends on](02-api-design.md#a2-you-must-change-a-response-shape-the-mobile-app-depends-on) | Likely | Verified: [script](code/api-design/verify-a2.mjs) |
| A3 | [An export takes two minutes and the request times out](02-api-design.md#a3-an-export-takes-two-minutes-and-the-request-times-out) | Likely | Verified: [script](code/api-design/verify-a3.mjs) |
| | **[03. Validation and error handling](03-validation-errors.md)** | | |
| V1 | [A user signs up as an admin](03-validation-errors.md#v1-a-user-signs-up-as-an-admin) | Must know | Verified: [script](code/errors/verify-v1.mjs) |
| V2 | [Every endpoint returns errors differently](03-validation-errors.md#v2-every-endpoint-returns-errors-differently) | Must know | Verified: [script](code/errors/verify-v2.mjs) |
| V3 | [The server dies at 3 a.m. with an unhandled rejection](03-validation-errors.md#v3-the-server-dies-at-3-am-with-an-unhandled-rejection) | Likely | Verified: [script](code/errors/verify-v3.mjs) |
| | **[04. Authentication, JWT and security basics](04-auth-jwt-security.md)** | | |
| S1 | [Login for a web app and a mobile app: sessions or tokens](04-auth-jwt-security.md#s1-login-for-a-web-app-and-a-mobile-app-sessions-or-tokens) | Must know | Verified: [script](code/auth/verify-s1.mjs) |
| S2 | [A JWT leaked: short access tokens and refresh rotation](04-auth-jwt-security.md#s2-a-jwt-leaked-short-access-tokens-and-refresh-rotation) | Must know | Verified: [script](code/auth/verify-s2.mjs) |
| S3 | [Storing passwords and stopping brute force on login](04-auth-jwt-security.md#s3-storing-passwords-and-stopping-brute-force-on-login) | Must know | Verified: [script](code/auth/verify-s3.mjs) |
| S4 | [Security review of a cookie-authenticated API](04-auth-jwt-security.md#s4-security-review-of-a-cookie-authenticated-api) | Likely | Verified: [script](code/auth/verify-s4.mjs) |
| | **[05. Databases and indexing](05-databases-indexing.md)** | | |
| D1 | [The order history query got slow](05-databases-indexing.md#d1-the-order-history-query-got-slow) | Must know | Verified: [script](code/db/verify-d1.mjs) |
| D2 | [A wallet transfer must never lose or create money](05-databases-indexing.md#d2-a-wallet-transfer-must-never-lose-or-create-money) | Must know | Verified: [script](code/db/verify-d2.mjs) |
| D3 | [Change the schema of a large live table without downtime](05-databases-indexing.md#d3-change-the-schema-of-a-large-live-table-without-downtime) | Likely | Verified: [script](code/db/verify-d3.mjs) |
| | **[06. Streams and buffers](06-streams.md)** | | |
| ST1 | [Large file downloads and uploads run out of memory](06-streams.md#st1-large-file-downloads-and-uploads-run-out-of-memory) | Must know | Verified: [script](code/streams/verify-st1.mjs) |
| ST2 | [A CSV export to a slow client eats server memory](06-streams.md#st2-a-csv-export-to-a-slow-client-eats-server-memory) | Likely | Verified: [script](code/streams/verify-st2.mjs) |
| | **[07. WebSockets](07-websockets.md)** | | |
| W1 | [Chat messages are lost across servers](07-websockets.md#w1-chat-messages-are-lost-across-servers) | Must know | Verified: [script](code/realtime/verify-w1.mjs) |
| W2 | [A live order feed misses updates after reconnects](07-websockets.md#w2-a-live-order-feed-misses-updates-after-reconnects) | Likely | Verified: [script](code/realtime/verify-w2.mjs) |
| | **[08. Async and the event loop](08-async-event-loop.md)** | | |
| E1 | [A CPU-heavy report freezes the whole server](08-async-event-loop.md#e1-a-cpu-heavy-report-freezes-the-whole-server) | Must know | Verified: [script](code/async/verify-e1.mjs) |
| E2 | [Sending 10,000 notifications is too slow or too fast](08-async-event-loop.md#e2-sending-10000-notifications-is-too-slow-or-too-fast) | Must know | Verified: [script](code/async/verify-e2.mjs) |
| | **[09. Caching and Redis](09-caching-redis.md)** | | |
| C1 | [Customers see the old price after a price change](09-caching-redis.md#c1-customers-see-the-old-price-after-a-price-change) | Must know | Verified: [script](code/cache/verify-c1.mjs) |
| C2 | [A hot dashboard key expires and floods the database](09-caching-redis.md#c2-a-hot-dashboard-key-expires-and-floods-the-database) | Likely | Verified: [script](code/cache/verify-c2.mjs) |
| | **[10. Queues and scheduled jobs](10-queues-scheduled-jobs.md)** | | |
| Q1 | [A daily billing email goes out three times after scaling to three servers](10-queues-scheduled-jobs.md#q1-a-daily-billing-email-goes-out-three-times-after-scaling-to-three-servers) | Must know | Verified: [script](code/queues/verify-q1.mjs) |
| Q2 | [A notification job fails forever and blocks the queue](10-queues-scheduled-jobs.md#q2-a-notification-job-fails-forever-and-blocks-the-queue) | Likely | Verified: [script](code/queues/verify-q2.mjs) |
| | **[11. Deployment](11-deployment.md)** | | |
| DP1 | [Every deploy causes 502s and cut off checkouts](11-deployment.md#dp1-every-deploy-causes-502s-and-cut-off-checkouts) | Must know | Verified: [script](code/deploy/verify-dp1.mjs) |
| DP2 | [A Node service in a 512 MB container restarts every few hours](11-deployment.md#dp2-a-node-service-in-a-512-mb-container-restarts-every-few-hours) | Likely | Verified: [script](code/deploy/verify-dp2.mjs) |
| | **[12. Architecture](12-architecture.md)** | | |
| AR1 | [The CTO wants to split an eight-developer monolith into microservices](12-architecture.md#ar1-the-cto-wants-to-split-an-eight-developer-monolith-into-microservices) | Likely | Verified: [script](code/architecture/verify-ar1.mjs) |
| AR2 | [An order is saved but inventory never hears about it](12-architecture.md#ar2-an-order-is-saved-but-inventory-never-hears-about-it) | Must know | Verified: [script](code/architecture/verify-ar2.mjs) |
| | **[13. Production debugging](13-production-debugging.md)** | | |
| PD1 | [Memory and latency climb after a deploy](13-production-debugging.md#pd1-memory-and-latency-climb-after-a-deploy) | Must know | Verified: [script](code/debugging/verify-pd1.mjs) |
| PD2 | [Intermittent 502s behind the load balancer](13-production-debugging.md#pd2-intermittent-502s-behind-the-load-balancer) | Likely | Verified: [script](code/debugging/verify-pd2.mjs) |
