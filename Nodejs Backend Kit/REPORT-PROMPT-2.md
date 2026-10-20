# REPORT — Prompt 2 (foundations extension, 2026-10-07)

**Scope:**
- 7 new lessons: the missing intro slots 01–03, and 71–74 continuing the numbering.
- `## Additional topics` sections appended to 17 existing lessons, with new bullets added to each of their Cheat-cards.
- A new `README.md` index linking all 74 lessons. The kit had no index; creating one was approved.

**Environment:** Node **v24.19.0** (V8 13.6.233.17-node.51, libuv 1.52.1, undici 7.29.0), npm 11.17.0, Linux x64. Every code example was run in a scratch directory outside the kit, and outputs are pasted from those runs. Native tools went in `~/.cache/nodekit-repair-tools/pass2/`, because `/tmp` is noexec. Comparison runtimes were run through `npx node@…`.

**Libraries and tools:**

| Area | Versions |
|---|---|
| Comparison runtimes | Node 10.24.1, 12.22.12, 20.20.2, 21.0.0, 21.7.3, 22.0.0, 22.9.0, 22.10.0, 22.11.0, 22.12.0, 22.13.0, 22.23.3, 23.0.0, 24.21.0 |
| Package managers and version managers | pnpm 10.34.6, Yarn 4.18.1, Corepack 0.35.0, nvm 0.40.8, fnm 1.39.0, Volta 2.0.2 |
| TypeScript tooling | TypeScript 7.0.2 (5.6–6.0 for option checks only), tsx 4.23.15, ts-node 10.9.2, @types/node 24.19.1, @types/express 5.0.6, esbuild 0.28.2 |
| Libraries | Express 5.2.1, dotenv 18.0.6, zod 4.6.5, ws 8.22.0, piscina 5.3.2, http-errors 2.0.1 / 1.8.1, debug 4.4.3, ms 2.1.3 / 2.1.2 |
| Profiling | 0x 6.0.0, clinic 13.0.0 |
| Build and monorepo tools | postject 1.0.0-alpha.6, turbo 2.11.7, @changesets/cli 3.0.3, ESLint 10.12.0, cross-env 10.1.0 |
| Other | GnuPG / gpgv 2.4.8, strace 6.19 |

## Files

| File | New or appended | Topics | SVGs embedded | Verification run | Unverified items |
|---|---|---|---|---|---|
| 01-what-nodejs-is.md | new (Topic 1 of 74) | Purpose and origin; runtime vs language vs engine vs framework; the four layers; one JS thread plus the pool (real `/proc` thread counts); I/O-bound vs CPU-bound demo; browser vs Node; release lines with a `schedule.json` reader; the 9-step lifecycle (fenced diagram) with `beforeExit`/`exit` order; edge cases: `process.exit()` and SIGTERM skipping events | assets/i04_01_4d0a93cc.svg | All scripts run as saved (lifecycle 3×); `process.versions`/`release`; v24 API docs History; previous-releases page; Learn More URLs → 200 | 2: Node 27 LTS date not on an official page; macOS/Windows thread names |
| 02-v8-the-javascript-engine.md | new (Topic 2 of 74) | Tiers Ignition → Sparkplug → Maglev → TurboFan/Turboshaft (from `--v8-options` and a real `--trace-opt` trace); hidden classes (`%HaveSameMap`); IC states; deopt trace; GC with a `--trace-gc` excerpt; heap limits under 7 flag variants; `v8.getHeapStatistics()`; all 5 `process.memoryUsage()` fields; startup snapshot built and run; shape benchmark (cliff at 4→5 shapes, variance reported); edge cases: OOM exit 134, `Buffer.alloc` and rss | none (no V8 diagram exists) | All blocks run as saved; benchmark 10 runs × 4 sessions; snapshot blob also tried on Node 22 (exit 14, documented as "Snapshot Failure") | 2: macOS/Windows rss behaviour; why the snapshot builder runs slower |
| 03-installing-and-managing-node.md | new (Topic 3 of 74) | Installer vs OS package vs version manager; nvm/fnm/Volta table (Volta README: unmaintained); `.nvmrc`, `.node-version`, `"volta"`; Corepack (bundled 0.35.0; not distributed from v25); LTS vs Current; real checksum + GPG verification; EACCES reproduced and fixed with throwaway prefixes; PATH on Linux; upgrading safely; Docker tags; edge case: the shell's command hash | none (i02_02 has a known issue) | nvm/fnm/Volta run under a throwaway HOME; gpgv "Good signature"; `sha256sum -c` OK and a tampered copy FAILED; real `~/.npmrc` and prefix untouched | 5: Windows fnm/Volta rows; macOS `shasum`; macOS PATH; Windows PATH; `docker run` (no Docker) |
| 95-typescript-with-node.md | new (Topic 71 of 74) | Options table; how stripping works and what it rejects (enum, namespace, parameter properties), with version history up to Stable in v24.12.0; `--experimental-transform-types`; tsconfig (`nodenext`, `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `rewriteRelativeImportExtensions`, `types:["node"]`); `@types/node` pinning; import extensions; ESM/CJS pitfalls; `tsc --noEmit`; source maps; typed `process.env`; typed Express 5 handlers, type-checked and run | none | tsc 7.0.2 errors pasted verbatim; Express server run and hit with curl (200/404/201/400/500); tsx, ts-node and esbuild runs | none |
| 96-modern-node-features-tour.md | new (Topic 72 of 74) | `node --run`, `node --test`, `--watch`/`--watch-path`, `--env-file`/`loadEnvFile`, permission model (real `ERR_ACCESS_DENIED`), `node:sqlite`, `require(esm)`, JSON import attributes, `URLPattern`, a real SEA binary, `util.parseArgs`, `fetch`/`WebSocket` against a local server; every entry has its "Added in" version and an edge case | none | All 17 examples run as saved; permission-flag spelling checked across Node 20/22.12/22.13/24; watch driver script; SEA built and executed on Linux | 1: macOS/Windows SEA signing steps |
| 22-abortcontroller-and-abortsignal.md | new (Topic 73 of 74) | `abort(reason)`, `aborted`, `reason`, `throwIfAborted`, `'abort'`; `AbortSignal.timeout`/`any`/`abort`; signals with fetch, http, timers/promises, fs/promises, events.once, pipeline, child_process; a hand-written abortable function; `addAbortListener`; cancelling `Promise.race` losers; Express disconnect detection (`res.on('close')` + `!res.writableEnded`; `req.on('close')` fires at about 0 ms for POST bodies); error shapes per API | none (fenced text diagram) | 12 lesson scripts plus probes on Node 24 / Express 5.2.1, all against local servers | none |
| 16-monorepos-and-workspaces.md | new (Topic 74 of 74) | npm workspaces (`-w`, `--workspaces`, hoisting with a real layout); pnpm 10 and Yarn 4 PnP layouts; `workspace:*` rewritten on `pnpm pack`; shared tsconfig and ESLint config; root scripts; Turborepo caching (miss/hit/restore); Changesets init/version with real diffs; a real phantom dependency (works in npm, fails in pnpm/PnP); duplicate `http-errors` breaking `instanceof` | assets/i10_01_27074a5e.svg | All 11 generator scripts re-run from scratch and diffed against the lesson (only `pnpm pack` key order varies, noted in the lesson) | 2: Nx not run; `changeset publish` not run |
| 04-the-global-object-process-and-environment.md | appended (+8 Cheat-card bullets) | dotenv vs `--env-file` vs `loadEnvFile` precedence; zod startup config (exit 78); `util.parseArgs`; stdin/stdout/stderr (TTY captured with `script`); `hrtime`/`hrtime.bigint`; `beforeExit`; a complete SIGTERM handler tested with a real signal mid-request; exit codes 0/1/3/9/13/137/143; edge case: `process.exit()` truncating a pipe write at 65,536 bytes | none | All blocks as saved; SIGTERM run with and without a handler | none |
| 05-running-node-scripts-the-repl-the-cli-and-nvm.md | appended (+6) | `node --run` vs `npm run` timing; `node --test` reporters and filters; type stripping (links to 71); `NODE_OPTIONS` allow-list (exit 9 for disallowed flags); `--max-old-space-size` (limit = value + 192 MiB here; OOM exit 134); Corepack; edge case: `NODE_OPTIONS` is inherited by children | none | All blocks as saved | none |
| 06-the-event-loop-phases.md | appended (+3) | `performance.eventLoopUtilization()` (idle vs busy, delta forms, vs delay); ordering when the entry is ESM (nextTick vs promise flips only at top level; the timeout vs immediate race stays racy, counts reported); edge case: syntax detection flipping a `.js` file | none | Runs ×50 / ×200 in batches, plus 16 runs in parallel | none |
| 07-libuv-the-thread-pool.md | appended (+2) | io_uring status on Node 24 (file ops go through the thread pool; `UV_USE_IO_URING=1` has no effect; history and CVE-2024-22017); `availableParallelism()` vs `cpus().length` under `taskset` and cgroup quotas; edge case: a 1.5-CPU quota → 1 | none | strace of `io_uring_setup`; libuv/Node source; `taskset` / `systemd-run --scope` runs | 2: `UV_USE_IO_URING` undocumented on nodejs.org; Docker/K8s `cpu.max` |
| 09-microtasks-vs-macrotasks.md | appended (+3) | Thenable extra ticks measured (+0 / +1 / +2 by form); ESM ordering, consistent with lesson 08's correction; edge case: `return await` vs `return p` (Node 10 order differs) | none | `.cjs`/`.mjs` ×30–50; node@10 and node@12 comparisons | none |
| 10-blocking-the-event-loop.md | appended (+4) | piscina pool vs inline (timer lateness 515–609 ms vs 0.5–3.9 ms); `--cpu-prof` with a profile parser; 0x flame graph; clinic status (unmaintained, needs `NO_INSIGHT=1` on Node 24, 24 audit findings); edge case: a `monitorEventLoopDelay` blind spot | none | All runs real; clinic run with a throwaway HOME | 2: DevTools profile view; flame graph not viewed in a browser |
| 11-commonjs-modules.md | appended (+3) | `require.main === module` (+ `import.meta.main`, added in v24.2.0); `createRequire`; `require(esm)` with version history, namespace shape and `ERR_REQUIRE_ASYNC_MODULE`; edge case: `require.main` under an ESM entry | none (i09_01 judged incomplete; see ASSET_ISSUES) | node@22.11.0 vs 22.12.0 vs 24.19.0 | none |
| 12-es-modules.md | appended (+4) | Import attributes (removal of `assert`, JSON default-only); `module.registerHooks` and `module.register` (deprecated in docs since v24.15.0) with a working `.sql` hook; TypeScript (links to 71); `require(esm)` from the author's side (`"module.exports"`, `"module-sync"`); edge case: registering hooks in the file that needs them | none | `module-sync` package tested across 3 runtimes and flags | none |
| 13-module-resolution.md | appended (+2) | Subpath patterns (`*` across `/`, longest prefix, `null` targets, the `.js.js` trap) with real errors; symlinks and the pnpm layout (fenced diagram), realpath vs `--preserve-symlinks`; edge case: `--preserve-symlinks` breaks pnpm | none | Real pnpm 10 installs | none |
| 14-packagejson-semantic-versioning.md | appended (+5) | `overrides` (global, scoped, `EOVERRIDE` and the `$` fix); `workspaces`; `packageManager` with Corepack; `private` (`--dry-run` does **not** refuse; the real `EPRIVATE` captured against a local stand-in registry); `sideEffects` proved with esbuild. The `engines` correction is untouched. | none | All runs real | none |
| 15-npm-scripts.md | appended (+4) | Workspaces (links to 74); `npm link` with a throwaway prefix only; cross-env vs `--env-file`; provenance (real `EUSAGE` "not supported for provider: null") and trusted publishing; edge case: `npm install` silently removing a link | none | All runs real; nothing published | 2: Windows `cmd.exe`; CI provenance and OIDC flow |
| 17-callbacks.md | appended (+2) | `util.callbackify` (falsy rejection → `ERR_FALSY_VALUE_REJECTION`); AbortSignal with `fs.readFile`/`exec` (gotcha: passing a bare signal is silently ignored) | none | All blocks as saved | none |
| 18-promises.md | appended (+3) | `Promise.withResolvers` (present from Node 22.0.0), `Promise.try` (from 23.0.0, measured); cancellation (links to 73); edge case: lesson 17's `withTimeout` keeps the process alive | none | Tested across 8 Node versions | none |
| 19-async-await.md | appended (+3) | `for await`, async generators, `Symbol.asyncIterator`, Readable iteration, `break` → `return()`; timeouts with AbortSignal; edge case: `for await` over pre-started promises crashing | none | All blocks as saved | none |
| 20-error-handling-in-async-code.md | appended (+3) | `Error` `{ cause }` (non-enumerable); all 5 `--unhandled-rejections` modes in a 12-run matrix; system error codes (ENOENT/EACCES/ECONNREFUSED, `getSystemErrorName`/`Message`); edge case: `ERR_*` errors have no errno | none | All blocks as saved | none |
| 21-eventemitter.md | appended (+4) | `events.on` async iterator (`close`, error, abort); `captureRejections`; `errorMonitor`; `EventTarget` vs `EventEmitter`; edge case: an endless `events.on` loop → exit 13 | none | All blocks as saved | none |
| 25-timers-…-the-event-loop.md | appended (+3) | `refresh()` (re-arms a timer that already fired), `hasRef()`, `scheduler.wait`/`scheduler.yield` (Experimental) | none (i22_01 untouched) | All blocks as saved; scheduler order identical over 8 runs | none |
| README.md | new | Index of all 74 lessons in 16 groups, marking new and appended lessons; links the reports | — | — | — |

**Totals:**
- 18 `> ⚠️ Unverified` lines, each in the lesson next to the claim it qualifies. All are for things this machine could not run:
  - macOS or Windows commands;
  - Docker or Kubernetes;
  - a browser view;
  - CI publishing;
  - Nx;
  - `changeset publish`;
  - one reason that isn't documented.
- No output was pasted without being run.

**Coordinator checks:**
- **Append-only:** a script diffed the 17 appended lessons against snapshots taken before writing. The only changes are inserted Cheat-card bullets and the appended tail; no existing line changed.
- **Template:** all 7 new lessons have the 9 template sections in order and 5 Q&A each.
- **Line endings:** all files use CRLF.
- **Marketing words:** none, in the new lessons or the appendices.
- **Independent re-run:** I re-ran a sample of 6 blocks myself. 5 match the pasted output exactly: lessons 02, 17, 19, 25 and 73. The sixth, the `--watch` driver in lesson 72, needs its companion files; Writer D re-ran it as saved.

**Final link and index check (step 6):** see the end of this file.

## ASSET_ISSUES rows added

| File | Embedded in | Problem |
|---|---|---|
| assets/i09_01_73d3711b.svg | 12 | Low severity. "Load: import — asynchronous" and "Files: .js (default)" are now incomplete, because of `require(esm)` (v22.12.0 / v20.19.0) and ESM syntax detection (v22.7.0 / v20.19.0). It was not embedded in lesson 11 for this reason. |

## MISSING_DIAGRAMS rows added (15)

| Lesson | Concept |
|---|---|
| 01 | Process lifecycle |
| 01 | Release-line schedule |
| 02 | Compile tiers |
| 02 | Heap generations and GC |
| 02 | Hidden classes and IC states |
| 03 | PATH lookup and version switching |
| 04 (appendix) | Graceful SIGTERM shutdown timeline |
| 06/09 (appendices) | CJS vs ESM entry drain order |
| 09 (appendix) | Thenable resolution ticks |
| 13 (appendix) | Symlinks and the pnpm layout |
| 20 (appendix) | `events.on` async iterator |
| 72 | SEA build |
| 73 | One controller fanning a signal out |
| 74 | npm vs pnpm vs Yarn PnP layout |
| 74 | Turborepo cache key |

The full "what the diagram should show" text for each row is in MISSING_DIAGRAMS.md.

## Found but not changed (outside this prompt)

The writers found these in existing text. This prompt only allowed appending, so the original lines were left as they are. Where an appendix covers the point, it says so.

- **05:** "odd-numbered versions are short-lived / even = LTS". Node's previous-releases page states an annual cycle from Node 27, which makes this wrong.
- **09:**
  - "at the same scheduling point, nextTick beats promise" (and the matching interview answer) only holds for CJS top-level code and macrotask callbacks.
  - Example 4's output is correct only as a `.cjs` file.
  - The 09 appendix shows the `.mjs` results.
- **10, Example 3:** "a healthy idle service shows p99 well under a few ms" is wrong with `resolution: 20`. Measured on an idle loop: min 19.12 / p50 20.25 / max 21.00 ms. The 10 appendix explains why.
- **16:** "ahead of promise microtasks" (in How it works and in the table) is close to the nextTick wording that CORRECTIONS.md scopes.
- **04, Example 4:** a scrape-broken `'\n'` string literal, already listed in REPORT-PROMPT-1.

## Side effects outside the kit

- **Package caches:** pnpm created a store at `/tmp/.pnpm-store`. One early Yarn 4 run wrote a package cache under `~/.yarn/berry/cache` (`~/.yarn` already existed). Both are caches only and can be deleted.
- **Throwaway tools and installs:** these live under `~/.cache/nodekit-repair-tools/pass2/`.
- **Unchanged:** the real npm prefix, `~/.npmrc`, shell rc files and git config.
- **Processes:** none left running.

## Step 6 verification output

```
PASS  01-what-nodejs-is.md  (1 image link(s))
PASS  02-v8-the-javascript-engine.md  (0 image link(s))
PASS  03-installing-and-managing-node.md  (0 image link(s))
PASS  95-typescript-with-node.md  (0 image link(s))
PASS  96-modern-node-features-tour.md  (0 image link(s))
PASS  22-abortcontroller-and-abortsignal.md  (0 image link(s))
PASS  16-monorepos-and-workspaces.md  (1 image link(s))
PASS  REPORT-PROMPT-2.md  (0 image link(s))
PASS  04-the-global-object-process-and-environment.md  (1 image link(s))
PASS  05-running-node-scripts-the-repl-the-cli-and-nvm.md  (2 image link(s))
PASS  06-the-event-loop-phases.md  (2 image link(s))
PASS  07-libuv-the-thread-pool.md  (2 image link(s))
PASS  09-microtasks-vs-macrotasks.md  (2 image link(s))
PASS  10-blocking-the-event-loop.md  (2 image link(s))
PASS  11-commonjs-modules.md  (2 image link(s))
PASS  12-es-modules.md  (1 image link(s))
PASS  13-module-resolution.md  (2 image link(s))
PASS  14-packagejson-semantic-versioning.md  (1 image link(s))
PASS  15-npm-scripts.md  (1 image link(s))
PASS  17-callbacks.md  (2 image link(s))
PASS  18-promises.md  (3 image link(s))
PASS  19-async-await.md  (3 image link(s))
PASS  20-error-handling-in-async-code.md  (1 image link(s))
PASS  21-eventemitter.md  (1 image link(s))
PASS  29-timers-settimeout-setinterval-setimmediate-the-event-loop.md  (1 image link(s))
PASS  README.md  (0 image link(s))
PASS  ASSET_MAP.md  (0 image link(s))
PASS  ASSET_ISSUES.md  (0 image link(s))
PASS  MISSING_DIAGRAMS.md  (0 image link(s))
PASS  index links 01-what-nodejs-is.md
PASS  index links 02-v8-the-javascript-engine.md
PASS  index links 03-installing-and-managing-node.md
PASS  index links 95-typescript-with-node.md
PASS  index links 96-modern-node-features-tour.md
PASS  index links 22-abortcontroller-and-abortsignal.md
PASS  index links 16-monorepos-and-workspaces.md
PASS  index links REPORT-PROMPT-2.md

31 image links checked in 29 files; 8 new files index-checked: 0 failure(s)
```
