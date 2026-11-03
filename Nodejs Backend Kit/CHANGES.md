# Changes

Spoken-edit pass on all 117 lessons. No new claims were added. Every code fence, command, and recorded output is unchanged. Titles, existing section headings, and image links are unchanged. `README.md`, `CORRECTIONS.md`, `ASSET_MAP.md`, the report prompts, `PDF/`, and `assets/` were not edited.

Each lesson now has **Say it in 30 seconds** before Why it matters, interview answers written to be spoken, and a **Good to know** list for version dates, extra questions, and one-off numbers.

## Unverified lines

These warnings were already in the lessons. They were kept, not introduced. None of the rewritten sentences needed a new warning.

| Lesson | What was not run |
| --- | --- |
| 01 | Node 27 LTS date is missing from `schedule.json`. Thread names were measured on Linux only. |
| 02 | `Buffer.alloc` resident memory was measured on Linux only. Snapshot-build sieve timing is not in the docs. |
| 03 | fnm and Volta on Windows, macOS checksum and PATH, Windows PATH, and two `docker run` commands. |
| 07 | `UV_USE_IO_URING` is not on the Node CLI docs. Docker and Kubernetes CPU limits were not run. |
| 10 | CPU profile was not opened in DevTools. Flame graph HTML was not opened in a browser. |
| 15 | Windows `cross-env` result. npm provenance and trusted publishing. |
| 16 | Nx behaviour is from nx.dev. `changeset publish` was not run. |
| 33 | Cause of one 2050 ms DNS call. c-ares retry multiplier. |
| 34 | `isolated-vm` did not compile here (`make` is missing). |
| 43 | HTTP/3 and `--experimental-quic` on platforms other than this Linux build. |
| 55 | CDN cache-key behaviour. |
| 62 | Hono on Cloudflare Workers, Deno, or Bun. |
| 77 | Prisma `migrate reset` no longer seeding. Taken from the upgrade guide. The command was not run. |
| 80 | Whether Prisma wraps `migration.sql` in a transaction, and so whether `CREATE INDEX CONCURRENTLY` inside one works. |
| 96 | macOS and Windows single-executable steps. |
| 97 | nginx `sticky` and keepalive defaults newer than 1.28.3. The close race was not reproduced. |
| 99 | Windows `'overlapped'` stdio. |
| 100 | How specific CDNs treat cache directives. |
| 101 | Docker image was linted, not built. |
| 103 | GitHub Actions protection rules, cache hits, and the workflow run. actionlint only. |
| 104 | Compose health, restart, and volume behaviour. No Docker daemon. |
| 105 | Endpoint propagation, `OOMKilled` from kubelet, HPA, rollout, and live `kubectl apply`. |
| 106 | Platform table, Lambda cold start, layer import, and template deploy. Docs and cfn-lint only. |
| 108 | Datadog and New Relic delivery. |
| 109 | Flame graph on screen. Why autocannon's corrected median differs from k6. |
| 112 | GraphOS Router and Rover were not run. |
| 113 | Consul and cluster DNS. SRV queries went to a test server. |
| 114 | Real AWS versus the local SQS emulator. |
| 115 | A live API server rejecting bad CronJob fields. |
