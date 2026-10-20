# Node.js Backend Kit — Index

All 117 lessons in reading order, grouped by topic. The 67 lessons from the original course and the 50 lessons written for this kit are interleaved so each topic is covered in one place. **new** marks lessons written for this kit, and **+ additional topics** marks original lessons with an appended `## Additional topics` section. Matching PDFs (for the original lessons) are in [PDF/](PDF/) and use the same numbers.

Reports and maps: [CORRECTIONS.md](CORRECTIONS.md) · [ASSET_MAP.md](ASSET_MAP.md) · [ASSET_ISSUES.md](ASSET_ISSUES.md) · [MISSING_DIAGRAMS.md](MISSING_DIAGRAMS.md) · [REPORT-PROMPT-1.md](REPORT-PROMPT-1.md) · [REPORT-PROMPT-2.md](REPORT-PROMPT-2.md) · [REPORT-PROMPT-3.md](REPORT-PROMPT-3.md) · [REPORT-PROMPT-4.md](REPORT-PROMPT-4.md) · [REPORT-PROMPT-5.md](REPORT-PROMPT-5.md) · [REPORT-PROMPT-7.md](REPORT-PROMPT-7.md)

## Foundations

1. [What Node.js Is: Runtime, Layers and Lifecycle](01-what-nodejs-is.md) — **new**
2. [V8: How Node Runs Your JavaScript](02-v8-the-javascript-engine.md) — **new**
3. [Installing and Managing Node](03-installing-and-managing-node.md) — **new**
4. [The Global Object, process, and Environment](04-the-global-object-process-and-environment.md) — **+ additional topics**
5. [Running Node: Scripts, the REPL, the CLI, and nvm](05-running-node-scripts-the-repl-the-cli-and-nvm.md) — **+ additional topics**

## Event loop internals

6. [The Event Loop Phases](06-the-event-loop-phases.md) — **+ additional topics**
7. [libuv & the Thread Pool](07-libuv-the-thread-pool.md) — **+ additional topics**
8. [process.nextTick vs setImmediate](08-processnexttick-vs-setimmediate.md)
9. [Microtasks vs Macrotasks](09-microtasks-vs-macrotasks.md) — **+ additional topics**
10. [Blocking the Event Loop](10-blocking-the-event-loop.md) — **+ additional topics**

## Modules, npm and workspaces

11. [CommonJS Modules](11-commonjs-modules.md) — **+ additional topics**
12. [ES Modules](12-es-modules.md) — **+ additional topics**
13. [Module Resolution](13-module-resolution.md) — **+ additional topics**
14. [package.json & Semantic Versioning](14-packagejson-semantic-versioning.md) — **+ additional topics**
15. [npm & Scripts](15-npm-scripts.md) — **+ additional topics**
16. [Monorepos and Workspaces](16-monorepos-and-workspaces.md) — **new**

## Async patterns and cancellation

17. [Callbacks](17-callbacks.md) — **+ additional topics**
18. [Promises](18-promises.md) — **+ additional topics**
19. [Async / Await](19-async-await.md) — **+ additional topics**
20. [Error Handling in Async Code](20-error-handling-in-async-code.md) — **+ additional topics**
21. [EventEmitter](21-eventemitter.md) — **+ additional topics**
22. [AbortController and AbortSignal: Cancellation in Node](22-abortcontroller-and-abortsignal.md) — **new**

## Core modules and Web APIs

23. [The fs Module: Reading & Writing Files](23-the-fs-module-reading-writing-files.md) — **+ additional topics**
24. [path, os & URL: Portable Filesystem and Environment Info](24-path-os-url-portable-filesystem-and-environment-info.md) — **+ additional topics**
25. [Buffer: Working with Binary Data](25-buffer-working-with-binary-data.md) — **+ additional topics**
26. [Binary Web APIs: TextEncoder, Blob, File, atob/btoa and structuredClone](26-binary-web-apis.md) — **new**
27. [crypto: Hashing, HMAC, Random & Encryption](27-crypto-hashing-hmac-random-encryption.md) — **+ additional topics**
28. [Web Crypto: crypto.subtle in Node](28-web-crypto.md) — **new**
29. [Timers: setTimeout, setInterval, setImmediate & the Event Loop](29-timers-settimeout-setinterval-setimmediate-the-event-loop.md) — **+ additional topics**
30. [util: inspect, format, types and More](30-util-module.md) — **new**
31. [readline: Lines, Prompts and History](31-readline.md) — **new**
32. [zlib: gzip, deflate and Brotli](32-zlib-compression.md) — **new**
33. [dns: lookup vs resolve](33-dns-module.md) — **new**
34. [The vm Module (and Why It Is Not a Sandbox)](34-vm-module.md) — **new**

## Streams

35. [Streams Overview](35-streams-overview.md)
36. [Readable & Writable Streams](36-readable-writable-streams.md) — **+ additional topics**
37. [Transform & Duplex Streams](37-transform-duplex-streams.md) — **+ additional topics**
38. [Backpressure, pipe & pipeline](38-backpressure-pipe-pipeline.md) — **+ additional topics**
39. [Web Streams in Node](39-web-streams.md) — **new**

## Raw HTTP and networking

40. [The http module & createServer](40-the-http-module-createserver.md) — **+ additional topics**
41. [Parsing requests & writing responses](41-parsing-requests-writing-responses.md) — **+ additional topics**
42. [Manual routing & serving JSON](42-manual-routing-serving-json.md) — **+ additional topics**
43. [HTTP vs HTTPS, TLS, HTTP/2 & CORS](43-http-vs-https-tls-http2-cors.md) — **+ additional topics**
44. [Outbound HTTP: fetch, undici and http.request](44-outbound-http-fetch-undici-and-http-request.md) — **new**
45. [TCP with net: Sockets, Framing and a Chat Server](45-tcp-with-net.md) — **new**
46. [UDP with dgram](46-udp-with-dgram.md) — **new**

## Express

47. [Express basics: what it is and why a framework](47-express-basics-what-it-is-and-why-a-framework.md) — **+ additional topics**
48. [Routing: params, query, and Routers](48-routing-params-query-and-routers.md) — **+ additional topics**
49. [Middleware: the pipeline, next(), and order](49-middleware-the-pipeline-next-and-order.md) — **+ additional topics**
50. [Error handling: the 4-arg handler and async errors](50-error-handling-the-4-arg-handler-and-async-errors.md) — **+ additional topics**
51. [The req and res objects: reading and responding](51-the-req-and-res-objects-reading-and-responding.md) — **+ additional topics**
52. [Express App Settings and Locals](52-express-app-settings-and-locals.md) — **new**
53. [Express Routing Extras](53-express-routing-extras.md) — **new**
54. [Express req and res: Complete API Reference](54-express-request-response-api-reference.md) — **new**
55. [Serving Static Files with express.static](55-express-serving-static-files.md) — **new**
56. [File Responses: sendFile, download and attachment](56-express-file-responses.md) — **new**
57. [Cookies in Express](57-cookies-in-express.md) — **new**
58. [File Uploads in Express](58-file-uploads-in-express.md) — **new**
59. [Template Engines and Server-Side Rendering](59-template-engines-and-server-side-rendering.md) — **new**
60. [Structuring an Express Project](60-express-project-structure.md) — **new**
61. [Migrating from Express 4 to Express 5](61-express-4-to-5-migration-guide.md) — **new**
62. [Alternatives to Express: NestJS, Fastify, Koa and Hono](62-express-alternatives-nestjs-fastify-koa-hono.md) — **new**

## REST API design

63. [REST Principles: Constraints, Resources & Statelessness](63-rest-principles-constraints-resources-statelessness.md) — **+ additional topics**
64. [CRUD, HTTP Verbs, Status Codes & Idempotency](64-crud-http-verbs-status-codes-idempotency.md) — **+ additional topics**
65. [Validation, Pagination, Filtering & Sorting](65-validation-pagination-filtering-sorting.md) — **+ additional topics**
66. [API Versioning, Error Shape, Rate Limiting & Docs](66-api-versioning-error-shape-rate-limiting-docs.md) — **+ additional topics**

## Databases: MongoDB, SQL, ORMs and migrations

67. [MongoDB & Mongoose](67-mongodb-amp-mongoose.md) — **+ additional topics**
68. [Schema Design & Data Modeling](68-schema-design-amp-data-modeling.md) — **+ additional topics**
69. [MongoDB Schema Patterns](69-mongodb-schema-patterns.md) — **new**
70. [MongoDB Indexes in Depth](70-mongodb-indexes-in-depth.md) — **new**
71. [MongoDB Aggregation Pipeline](71-mongodb-aggregation-pipeline.md) — **new**
72. [MongoDB Sharding](72-mongodb-sharding.md) — **new**
73. [SQL Basics from Node](73-sql-basics-from-node.md) — **+ additional topics**
74. [Connection Pooling](74-connection-pooling.md) — **+ additional topics**
75. [Transactions & ACID](75-transactions-amp-acid.md) — **+ additional topics**
76. [Knex Query Builder](76-knex-query-builder.md) — **new**
77. [Prisma ORM](77-prisma-orm.md) — **new**
78. [Drizzle ORM](78-drizzle-orm.md) — **new**
79. [Sequelize and TypeORM](79-sequelize-and-typeorm.md) — **new**
80. [Database Migrations and Seeding](80-database-migrations-and-seeding.md) — **new**
81. [Choosing Between Raw SQL, a Query Builder and an ORM](81-choosing-raw-sql-query-builder-or-orm.md) — **new**

## Auth and security

82. [Authentication Basics](82-authentication-basics.md)
83. [JSON Web Tokens (JWT)](83-json-web-tokens-jwt.md)
84. [Sessions & Cookies](84-sessions-cookies.md)
85. [Password Hashing](85-password-hashing.md)
86. [Web Security & OWASP](86-web-security-owasp.md)

## Reliability

87. [Error Handling Patterns](87-error-handling-patterns.md)
88. [Uncaught Exceptions & Unhandled Rejections](88-uncaught-exceptions-unhandled-rejections.md)
89. [Debugging Node.js](89-debugging-nodejs.md)
90. [Logging](90-logging.md)

## Testing

91. [Testing Fundamentals](91-testing-fundamentals.md)
92. [Unit Testing](92-unit-testing.md)
93. [Integration Testing](93-integration-testing.md)
94. [Mocking & Coverage](94-mocking-amp-coverage.md)

## TypeScript and modern Node

95. [TypeScript with Node](95-typescript-with-node.md) — **new**
96. [Modern Node Features: A Guided Tour](96-modern-node-features-tour.md) — **new**

## Scaling and concurrency

97. [The cluster module](97-the-cluster-module.md) — **+ additional topics**
98. [Worker threads](98-worker-threads.md) — **+ additional topics**
99. [Child processes](99-child-processes.md) — **+ additional topics**
100. [Caching with Redis](100-caching-with-redis.md) — **+ additional topics**

## Deployment and operations

101. [PM2 & Docker](101-pm2-docker.md) — **+ additional topics**
102. [Graceful shutdown & monitoring](102-graceful-shutdown-monitoring.md) — **+ additional topics**
103. [CI/CD with GitHub Actions](103-ci-cd-with-github-actions.md) — **new**
104. [Docker Compose: App, Postgres and Redis](104-docker-compose.md) — **new**
105. [Kubernetes for Node Developers](105-kubernetes-for-node-developers.md) — **new**
106. [Cloud and Serverless Deployment](106-cloud-and-serverless-deployment.md) — **new**

## Observability and performance

107. [Observability with OpenTelemetry](107-observability-with-opentelemetry.md) — **new**
108. [APM and Alerting](108-apm-and-alerting.md) — **new**
109. [Load Testing and Profiling](109-load-testing-and-profiling.md) — **new**
110. [Performance Tuning Checklist](110-performance-tuning-checklist.md) — **new**

## Advanced architecture

111. [Real-time with WebSockets](111-real-time-with-websockets.md) — **+ additional topics**
112. [GraphQL basics](112-graphql-basics.md) — **+ additional topics**
113. [Microservices in Node](113-microservices-in-node.md) — **+ additional topics**
114. [Message queues & async jobs](114-message-queues-async-jobs.md) — **+ additional topics**
115. [Scheduled Jobs](115-scheduled-jobs.md) — **new**
116. [Internationalization in Node and Express](116-internationalization.md) — **new**

## Runtimes

117. [Bun and Deno Compared with Node](117-bun-and-deno-compared-with-node.md) — **new**
