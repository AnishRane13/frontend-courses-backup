# REPORT — Prompt 7 (scaling, deployment, observability and advanced topics, 2026-10-13)

**Scope:**
- 11 new lessons (107–117).
- `## Additional topics` sections appended to lessons 61–70, with Cheat-card bullets added to each.
- README.md updated with a new "Production" group; it now lists 117 lessons.

Prompt 6 is still paused: nothing in the kit was changed for it. Its pre-edit snapshots of lessons 48–60 are kept in `~/.cache/nodekit-repair-tools/snapshot6/`. If it is run later with the reduced scope, its new lessons will be numbered 118 and up.

**Environment:**
- Node v24.19.0, npm 11.17.0, Express 5.3.0, Linux x64 (Ubuntu 26.04).
- **Unavailable:** Docker, a Kubernetes cluster, cloud accounts and vendor accounts. No real credentials were used anywhere.
- **Run locally for real:**
  - PostgreSQL 18.4 (embedded-postgres)
  - MongoDB 8.2.6, Redis 8.0.5 (standalone, a 3-master Cluster, and Sentinel)
  - nginx 1.28.3 (Ubuntu package, extracted without root)
  - otelcol-contrib 0.162.0 and Jaeger 2.22.0
  - the fauxqs 2.12.2 SQS/SNS emulator
  - k6 v2.3.0, autocannon 8.0.0 and 0x 6.0.0
  - Bun 1.4.3 and Deno 2.9.7
- **Validated but not run:**
  - actionlint 1.7.12 (with ShellCheck 0.11.0)
  - docker compose v5.6.0 (`config` only)
  - kubeconform 0.8.0 with Kubernetes 1.36/1.37 schemas
  - kubectl v1.37.1. `apply --dry-run=client` cannot run without an API server, so only `--local` commands worked.
  - cfn-lint 1.57.2
- **Checksums:** every downloaded binary's checksum was verified wherever the project publishes one.
- **Library versions:** each lesson lists them. The main ones:

  | Area | Packages |
  |---|---|
  | OpenTelemetry | @opentelemetry/sdk-node 0.223.0 (auto-instrumentations-node 0.81.0) |
  | Error tracking | @sentry/node 11.7.0 |
  | Jobs and queues | node-cron 4.6.0, bullmq 6.3.13, @aws-sdk/client-sqs and client-sns 3.1149.0 |
  | Caching | lru-cache 11.5.3 |
  | Real-time | eventsource 5.1.2, ws 8.22.0 |
  | GraphQL | graphql-ws 6.3.0, @apollo/server 5.5.1, @apollo/gateway 2.14.4, @graphql-codegen/cli 7.4.6 |
  | gRPC | @grpc/grpc-js 1.14.6 |
  | i18n | i18next 26.4.4, i18next-http-middleware 3.9.9 |
  | Logging | pino 10.4.0 |
  | Bundling and Lambda | esbuild 0.28.2, @codegenie/serverless-express 5.0.0 |

## Files

| File | New or appended | Topics | SVGs embedded | Verification run | Unverified items |
|---|---|---|---|---|---|
| 103-ci-cd-with-github-actions.md | new (Topic 107 of 117) | A complete workflow; action versions checked against GitHub releases; a Node 22/24/26 matrix; secrets vs vars; GITHUB_TOKEN permissions; environments; caching; concurrency; required checks; reading failures | none | actionlint on the real and a 6-error broken workflow. Edge case: actionlint 1.7.12 doesn't know setup-node@v7's inputs. Lint, test and build run locally on a sample Express 5 app, plus real local failures. | 6 (everything that happens on GitHub's side) |
| 104-docker-compose.md | new (Topic 108) | app + postgres:18.4 + redis:8.0.5; health checks (including why `pg_isready -h 127.0.0.1` and why curl is absent in node:24-slim); `depends_on` conditions; volumes (the PG 18 path change); networks; `.env` vs `env_file`; overrides with `!reset`/`!override`; a one-shot migrate service with an advisory lock | none | `docker-compose config` merges and errors. Startup order reproduced without Docker on local PG and Redis. Racing migrators: 3 of 4 runs failed without the lock, 0 with it. | 3 (container run-time behaviour) |
| 105-kubernetes-for-node-developers.md | new (Topic 109) | Workloads, Service/EndpointSlices, Ingress, ConfigMap/Secret; probes tied to lesson 66; the termination flow and `preStop`; requests and limits; V8 heap under real cgroup limits (default 259 MiB under a 512 MiB limit; `--max-old-space-size-percentage`, added in v24.6.0); OOM exit 134 vs 137; HPA; rolling updates | assets/i63_01_85ccfa6f.svg | Local SIGTERM drain demo; kubeconform strict (the broken manifest is caught only with `-strict`); kubectl's real no-cluster errors | 6 (cluster behaviour) |
| 106-cloud-and-serverless-deployment.md | new (Topic 110) | Lambda lifecycle, handler shape (`nodejs24.x` verified), connection reuse (module scope proven), esbuild bundle (811 KB) plus the ESM `require` edge case, layers, API Gateway payload v2, Express 5 via @codegenie/serverless-express, ECS/Fargate, a dated Vercel/Render/Fly comparison | none | Handlers invoked locally with AWS sample events; cfn-lint on a CloudFormation template. Edge case: cfn-lint misses the same mistakes in a SAM template. | 5 (anything needing AWS or the platforms) |
| 107-observability-with-opentelemetry.md | new (Topic 111) | Spans, resources and attributes; sdk-node; Express/undici/pg auto-instrumentation; CJS vs ESM loading; two services sharing a trace via `traceparent`; Collector + Jaeger; parent-based ratio sampling; edge cases: ESM without the loader hook, duplicate router spans | assets/i53_02_6cd24834.svg | A real Collector debug log and the Jaeger API span tree; 25% sampling → 250 of 1,000 traces | none |
| 108-apm-and-alerting.md | new (Topic 112) | Sentry v11 with Express 5 (`expressIntegration` captures errors; `setupExpressErrorHandler` deprecated in v11), real envelopes sent to a local fake DSN, and `beforeSend` scrubbing (edge case: the built-in denylist misses PII in messages); a Datadog/New Relic overview; SLIs, SLOs, error budgets and multiwindow burn-rate with real arithmetic; alert fatigue | none | Sentry runs and `burn.mjs` re-run; Collector vendor config validated | 1 (vendor agents and delivery) |
| 115-scheduled-jobs.md | new (Topic 113) | node-cron 4; BullMQ 6 job schedulers (`repeat` was removed in 6.0.0); OS crontab syntax; K8s CronJob; 3 real instances showing duplicate runs, fixed with a Redis lock and a PG advisory lock (edge case: a late instance gets past both locks, but not past a run key); advisory locks through a pool; DST traps on 2026-11-01 and 2026-03-08 | none | All blocks re-run; kubeconform on the CronJob | 1 (API-server rejection and controller behaviour) |
| 109-load-testing-and-profiling.md | new (Topic 114) | autocannon and k6; closed vs open load models; percentiles (mean 4 ms vs p99 199 ms); `--cpu-prof` hot line; a 0x flame graph; a measured before/after (≈215 → ≈8,500 req/s); edge case: coordinated omission (autocannon p99 1 ms vs k6 p99 283 ms) | none | Real runs, 5 per mode. The machine was shared and loaded at times, and the lesson shows that noise. | 2 (flame graph not viewed in a browser; autocannon's correction method) |
| 110-performance-tuning-checklist.md | new (Topic 115) | 8 items, each with a measurement, a runnable check, the fix and a linked lesson: event-loop delay, keep-alive, compression, cache layers, pools, N+1, payload size, logging cost; edge case: compression slower on loopback | assets/i07_02_3ff080ab.svg, assets/i43_01_0827e931.svg | Every check run twice; both runs given where the conclusion shifted | none |
| 116-internationalization.md | new (Topic 116) | Full-ICU check; `Intl` NumberFormat, DateTimeFormat, PluralRules, RelativeTimeFormat, ListFormat, Collator, Segmenter; locale detection with q-values; i18next + i18next-http-middleware (finding: it still picks a `q=0` language); ICU messages in English, Polish and Arabic; `timestamptz` vs `timestamp` across server time zones on real PG; currency rounding; Temporal (only an old version behind `--harmony-temporal` in v24) | none | 10 JS blocks and 4 shell transcripts re-run | none |
| 117-bun-and-deno-compared-with-node.md | new (Topic 117) | Architecture (Bun is now written in Rust, merged May 2026; Deno is V8/Rust/Tokio); the same Express 5 app on all three runtimes; `node:` APIs checked; TypeScript handling; test runners (edge case: each one picks up the others' files); Bun tooling; Deno permissions vs Node `--permission`; a benchmark run but reported as non-ranking because the machine was heavily loaded; a decision guide | none | Everything run through the real binaries | none |
| 97-the-cluster-module.md | appended (+5 Cheat-card bullets) | nginx upstream, keepalive, `ip_hash` and `hash $cookie_sid consistent` in front of 3 Node instances, X-Forwarded-* with `trust proxy`, nginx without root. Edge case: `ip_hash` keys on the /24. Correction to the assignment: open-source nginx gained `sticky` in 1.29.6, but Ubuntu's 1.28.3 rejects it. | none | A real nginx run: round-robin by PID; keepalive cuts upstream connections from 300 to about 15; stickiness tested | 2 (1.29.6+ behaviour; one keep-alive race) |
| 98-worker-threads.md | appended (+2) | `resourceLimits`; a real `ERR_WORKER_OUT_OF_MEMORY`, with the corrected Pool replacing the dead worker (fix kept); edge case: Buffer memory is not covered by the limit | none | All scripts re-run | none |
| 99-child-processes.md | appended (+2) | `signal` on spawn/exec/execFile/fork with the AbortError shape; every `stdio` value, including extra fd 3. Edge case: a child that ignores SIGTERM survives the abort. | none | All 5 scripts match exactly | 1 (`'overlapped'` on Windows) |
| 100-caching-with-redis.md | appended (+4) | A Map-based LRU with tests, then lru-cache 11; HTTP caching headers through a real origin and a caching proxy; a real 3-master Redis Cluster (MOVED, ASK, CROSSSLOT, hash tags) and a real Sentinel failover. The token + Lua lock fix is kept and shown working on the cluster. | none | All blocks re-run; the cluster rebuilt from the saved script | 1 (CDN-specific behaviour) |
| 101-pm2-docker.md | appended (+2) | Pointers to 107–110; a compose file built from the corrected Dockerfile (fix kept) | none | `docker-compose config` and typo cases | 2 (no image build) |
| 102-graceful-shutdown-monitoring.md | appended (+3) | Pointers to 111–112; a ConsoleSpanExporter example; edge case: `process.exit()` without `sdk.shutdown()` loses every span | none | Both blocks re-run | none |
| 111-real-time-with-websockets.md | appended (+2) | An SSE server and eventsource client with a real `Last-Event-ID` resume; a WS client with heartbeat, backoff with jitter and an outbox, surviving a frozen-then-restarted server with no loss; global WebSocket limits | none | All blocks re-run (ids and backoff delays vary, as stated) | none |
| 112-graphql-basics.md | appended (+4) | graphql-ws subscriptions on Express 5 + Apollo 5 (fix kept); a real two-subgraph Federation gateway with its query plan; codegen with real tsc results. Edge case: an `async function*` wrapper leaks a listener. | none | All blocks re-run | 1 (GraphOS Router and Rover not run) |
| 113-microservices-in-node.md | appended (+4) | gRPC (unary, streaming, NOT_FOUND, DEADLINE_EXCEEDED); an Express 5 gateway and BFF with 7 real requests; service discovery via a test-only DNS server; a transactional outbox on PG 18.4 with a relay crash producing a duplicate that the consumer de-duplicates (consistent with lessons 47 and 70) | none | All blocks re-run, 3 identical outbox runs | 1 (Consul and cluster DNS) |
| 114-message-queues-async-jobs.md | appended (+5) | SQS/SNS on the fauxqs emulator (fan-out, visibility timeout → DLQ, FIFO dedup and grouping), cron-triggered jobs (links to 113), a short outbox section (links to 69). Edge case: BullMQ `jobId` dedup ends when the job is removed. The claim → work → done fix is kept. | none | All blocks re-run | 1 (real-AWS differences) |
| README.md | updated | New group for 107–117; 61–70 marked "+ additional topics"; REPORT-PROMPT-7 linked | — | Diffed against the previous version: additions only | — |

**Totals:**
- **Unverified markers:** 33 `> ⚠️ Unverified` lines, 24 in the new lessons and 9 in the appendices. Almost all are cloud, cluster, vendor or Windows behaviour that cannot run here. The exact text is in each lesson.
- **Outputs:** none were pasted without a run.
- **Links:** all Learn More URLs returned 200.

**Coordinator checks:**
- **Append-only:** a script diffed lessons 61–70 against their pre-edit snapshots. The only changes are inserted Cheat-card bullets and the appended tail.
- **Template:** all 11 new lessons have exactly the 9 template sections in order, with 4–5 Q&A each.
- **Formatting:** CRLF line endings everywhere; no marketing words.
- **Processes:** none left running.
- **Independent re-run:** I re-ran 5 sample blocks (three from 116, plus 112 and the 62 appendix). All 69 expected lines were found verbatim.
- **Cross-check:** lesson 65's pointers, written before 109 and 110 existed, match those lessons.

**Assignment corrections made by writers (verified):**
1. Open-source nginx does have `sticky` since 1.29.6.
2. Bun is now written in Rust, not Zig.
3. `kubectl apply --dry-run=client` cannot run without an API server.

## ⚠️ Side effect to know about: Apollo gateway telemetry

`@apollo/gateway` sends anonymous deployment telemetry by default (changelog 2.14.0). Before the writer found the opt-out, a few gateway runs may have sent anonymous usage metrics to `usage-reporting.api.apollographql.com`. One run also tried the cloud metadata address `169.254.169.254`; it only logged a `MetadataLookupWarning`, since this is not a cloud host.

No credentials, kit content or personal data were involved. The lesson's example now sets `APOLLO_TELEMETRY_DISABLED=1`.

## ASSET_ISSUES rows added

None. All four embedded figures agree with their text. `i62_01` (node:20) was not embedded anywhere new.

## MISSING_DIAGRAMS rows added (22)

| Lesson | Concept |
|---|---|
| 61 (appendix) | nginx reverse proxy / load balancer |
| 64 (appendix) | Redis Cluster hash slots and redirects |
| 67 (appendix) | SSE resume with Last-Event-ID |
| 67 (appendix) | Reconnecting WS client |
| 68 (appendix) | graphql-ws subscription lifecycle |
| 69 (appendix) | Transactional outbox relay |
| 69 (appendix) | gRPC server streaming with a deadline |
| 70 (appendix) | SNS → SQS fan-out with DLQ |
| 107 | Pipeline stages |
| 108 | Compose startup order |
| 109 | Object relationships |
| 109 | Pod termination during a rolling update |
| 109 | Rolling update with maxSurge / maxUnavailable |
| 110 | Lambda invocation lifecycle |
| 111 | Span tree across two services |
| 112 | Burn-rate long and short windows |
| 113 | Duplicate cron vs lock / run key |
| 114 | Closed vs open load model |
| 116 | Locale negotiation and formatting |
| 116 | timestamptz vs timestamp across time zones |
| 117 | Runtime architecture comparison |
| 117 | Deno permission check |

Full descriptions are in MISSING_DIAGRAMS.md.

## Found but not changed (outside this prompt)

- **56:** says pino transports run in "a separate process". They run in worker threads.
- **64:** the original text uses the banned word "robust" twice.
- **66:**
  - its code examples are fragments (`app`, `pool` and `redis` are never defined);
  - a single `closeIdleConnections()` call misses sockets that go idle after `close()`. A 3 s exit delay was measured, and lesson 109 Example 3 shows the fix.
- **67:** Example 2's `'\r\n\r\n'` string is broken across lines by the scrape.
- **68:** the original DataLoader example calls `startStandaloneServer` without a port.
- **69:** the original circuit breaker lets every call through after the cooldown, not one probe.
- **70:**
  - its `jobId: 'welcome-42'` dedup only holds while the job is retained (explained in the appendix);
  - its RabbitMQ and Kafka examples were not verified.
- **All original lessons:** their headers still contain scraped "Topic NN of 70 Bookmark …" text.

## Side effects outside the kit

- **Disk space:** 3.3 GB of throwaway tools, binaries and projects are under `~/.cache/nodekit-repair-tools/pass7/` (measured with `du`). The largest are B3 at about 1.2 GB (Collector and Jaeger), B5 and B1 at about 460 MB each, B6 about 390 MB, and B2 about 370 MB. The whole `~/.cache/nodekit-repair-tools/` folder, covering all passes, is 7.8 GB. All of it can be deleted.
- **SQS emulator:** fauxqs 2.12.2 was first published on 2026-10-08. It was run only locally, on loopback.
- **Your environment:** no global installs and no edits to your npm, shell, git or Docker config. Tools that write caches were run with a throwaway HOME.

## Step 6 verification output

```
PASS  103-ci-cd-with-github-actions.md  (0 image link(s))
PASS  104-docker-compose.md  (0 image link(s))
PASS  105-kubernetes-for-node-developers.md  (1 image link(s))
PASS  106-cloud-and-serverless-deployment.md  (0 image link(s))
PASS  107-observability-with-opentelemetry.md  (1 image link(s))
PASS  108-apm-and-alerting.md  (0 image link(s))
PASS  115-scheduled-jobs.md  (0 image link(s))
PASS  109-load-testing-and-profiling.md  (0 image link(s))
PASS  110-performance-tuning-checklist.md  (2 image link(s))
PASS  116-internationalization.md  (0 image link(s))
PASS  117-bun-and-deno-compared-with-node.md  (0 image link(s))
PASS  97-the-cluster-module.md  (2 image link(s))
PASS  98-worker-threads.md  (2 image link(s))
PASS  99-child-processes.md  (1 image link(s))
PASS  100-caching-with-redis.md  (2 image link(s))
PASS  101-pm2-docker.md  (1 image link(s))
PASS  102-graceful-shutdown-monitoring.md  (1 image link(s))
PASS  111-real-time-with-websockets.md  (2 image link(s))
PASS  112-graphql-basics.md  (2 image link(s))
PASS  113-microservices-in-node.md  (1 image link(s))
PASS  114-message-queues-async-jobs.md  (2 image link(s))
PASS  README.md  (0 image link(s))
PASS  ASSET_MAP.md  (0 image link(s))
PASS  MISSING_DIAGRAMS.md  (0 image link(s))
PASS  REPORT-PROMPT-7.md  (0 image link(s))
PASS  index links 103-ci-cd-with-github-actions.md
PASS  index links 104-docker-compose.md
PASS  index links 105-kubernetes-for-node-developers.md
PASS  index links 106-cloud-and-serverless-deployment.md
PASS  index links 107-observability-with-opentelemetry.md
PASS  index links 108-apm-and-alerting.md
PASS  index links 115-scheduled-jobs.md
PASS  index links 109-load-testing-and-profiling.md
PASS  index links 110-performance-tuning-checklist.md
PASS  index links 116-internationalization.md
PASS  index links 117-bun-and-deno-compared-with-node.md
PASS  index links REPORT-PROMPT-7.md

20 image links checked in 25 files; 12 new files index-checked: 0 failure(s)
```
