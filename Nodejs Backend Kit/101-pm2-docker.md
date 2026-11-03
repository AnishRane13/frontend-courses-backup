---
title: "PM2 & Docker"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/pm2-docker
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# PM2 & Docker

*11 min read · Updated 24 Jul 2026 Topic 65 of 70 Bookmark Mark done Why it matters node server · Topic 65 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/pm2-docker](https://www.geekyfrontend.in/learn/nodejs-backend-kit/pm2-docker)

---

## Say it in 30 seconds

PM2 is a process manager that restarts your Node app, can run one process per CPU core, and reloads code without dropping the port, and Docker packages that app plus its exact runtime into an image you can run anywhere. They exist because `node server.js` dies with your shell, uses one core, and runs differently on every machine. The trade-off is overlap: on a VM you often want PM2, and on Kubernetes you usually want one process per container so the platform, not a second supervisor, owns restarts and scaling.

## Why it matters

`node server.js` is how you run an app on a laptop. In production the process must survive crashes, use every CPU core, survive an SSH disconnect, capture logs, and roll out new versions without dropping traffic. It must also run the same way on a teammate's machine, in CI, and on the server. PM2 is the process manager. Docker is the packaging. The 12-factor method is the discipline that ties them together: config in the environment, stateless processes, and logs as streams.

Interviews ask why config belongs in environment variables, why a Docker image is built in stages, why the container should not run as root, and how PM2 cluster mode relates to Node's cluster module.

## The concept, simply

**PM2** keeps a Node app alive. It restarts the process if it crashes or runs out of memory, can run one instance per CPU core in cluster mode by wrapping the cluster module, aggregates logs, and reloads new code with zero downtime. It is the classic way to run Node on a VM.

**Docker** packages the app and its runtime, the Node version, dependencies, and system libraries, into an image. An image is a portable, immutable artifact. A container is a running instance of an image. The same image runs anywhere Docker runs, which removes "works on my machine" and lets you deploy to Kubernetes, ECS, or Cloud Run.

The Node technique is a **multi-stage build**. A builder image, with compilers and dev dependencies, installs and builds. The final image copies only the runtime artifacts. The result is smaller, with no build tools left inside.

![Two-stage Docker build where a builder stage installs deps and compiles then a slim runtime stage copies only the built output and runs as a non-root user](assets/i62_01_f49bfdf5.svg)

Multi-stage build: a fat builder stage compiles and installs everything; the slim runtime stage copies only the built artifacts and production dependencies, drops to a non-root user, and runs the app.

**12-factor** is a set of rules for services that run in these environments. The one interviews ask most is config in the environment: database URLs, secrets, and feature flags live in environment variables, not in committed files, so the same image runs in dev, staging, and production. Processes stay stateless, so sessions and files live in a backing service. Logs go to stdout and stderr and the platform collects them. Startup is fast and shutdown is graceful, so instances are disposable.

## How it works

PM2 runs a background daemon that supervises processes. `pm2 start app.js -i max` launches one worker per core in cluster mode. PM2 is the primary and forks workers the way the cluster module does, because it uses that module, so you get multi-core scaling and respawn without writing the fork logic. An ecosystem file, `ecosystem.config.js`, declares apps, instance counts, env vars per environment, a memory-restart threshold, and log paths. `pm2 reload` brings new workers up before old ones retire. `pm2 startup` and `pm2 save` bring the processes back after a reboot.

A **Dockerfile** is an ordered list of instructions. Each instruction is a cached layer. Copy `package.json` and run `npm ci` before you copy source, so a source change does not rerun the slow install. `npm ci` installs exactly the lockfile. It is the production install. `npm install` can drift. A multi-stage file has more than one `FROM`. The final stage uses `COPY --from=builder` and leaves compilers and dev dependencies behind. A `.dockerignore` keeps `node_modules`, `.git`, and secrets out of the build context.

Run as a non-root user. Official images ship a `node` user, so `USER node` means a container escape is not automatically root. Set `NODE_ENV=production`. Express and other libraries change behaviour on it, and dev dependencies stay out. Use a slim base such as `node:24-slim`, or a distroless or Alpine variant, and pin the Node major instead of `latest`.

**PID 1.** A Node process that is PID 1 in the container does not get default signal handlers, so `SIGTERM` from `docker stop` may be ignored and the runtime later sends `SIGKILL`, cutting off in-flight requests. Use `--init` or tini, and implement graceful shutdown.

You do not always need both tools. They overlap on "keep it running and use all the cores." One Node process per container, with Kubernetes restarting and scaling replicas, is the common pattern. PM2 cluster mode inside that container double-counts. PM2 fits a VM with no orchestrator.

## Code examples

A production multi-stage Dockerfile for a Node app — small, non-root, deterministic.

dockerfile

```
# ---- Stage 1: build ----
FROM node:24 AS builder
WORKDIR /app
# copy manifests first for layer caching
COPY package*.json ./
# deterministic install (dev + prod)
RUN npm ci
COPY . .
# produce dist/
RUN npm run build
# drop dev deps for the runtime copy
RUN npm prune --omit=dev

# ---- Stage 2: runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# drop root privileges
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

> **Why this was wrong:** Docker treats a line as a comment only when it *starts* with `#`; a `#` later in the line is passed to the instruction as more arguments. In the earlier version `COPY package*.json ./   # copy manifests…` asked Docker to copy files named `#`, `copy`, `manifests`, …, and `USER node   # drop root privileges` fails because `USER requires exactly one argument` (BuildKit's parser). The `RUN … # …` lines only worked by accident, because `/bin/sh` ignores the `#`. The base image was also `node:20`, which reached end of life on 2026-04-30; `node:24` is the Active LTS line as of October 2026 (Node 26 becomes LTS on 2026-10-28 — check nodejs.org/en/about/previous-releases and bump the tag when you upgrade).

Verification (no Docker daemon was available, so this was linted rather than built — hadolint 2.15.1):

```
$ hadolint Dockerfile        # earlier version
Dockerfile:4 DL3021 error: COPY with more than 2 arguments requires the last argument to end with /
Dockerfile:8 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
Dockerfile:16 DL3066 info: Non-numeric user-id may not be resolvable by host system

$ hadolint --failure-threshold warning Dockerfile   # fixed version: no errors or warnings, exit code 0
Dockerfile:12 DL3059 info: Multiple consecutive `RUN` instructions. Consider consolidation.
Dockerfile:21 DL3066 info: Non-numeric user-id may not be resolvable by host system
```

A matching `.dockerignore` keeps the build context small and secrets out of the image.

bash

```
# .dockerignore
node_modules
npm-debug.log
.git
.env
Dockerfile
dist
coverage
```

Reading config from the environment (12-factor). The same image runs everywhere; only env values change.

javascript

```
// config.js — validate env once at startup, fail fast if misconfigured
const required = ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('Missing env vars:', missing.join(', '));
  process.exit(1);                       // don't boot half-configured
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
```

A PM2 ecosystem file for VM deployments — cluster mode, per-env config, auto memory restart.

javascript

```
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api',
    script: 'dist/server.js',
    instances: 'max',            // one worker per CPU core (cluster mode)
    exec_mode: 'cluster',
    max_memory_restart: '500M',  // restart a worker if it leaks past 500MB
    env: { NODE_ENV: 'development', PORT: 3000 },
    env_production: { NODE_ENV: 'production', PORT: 8080 },
  }],
};
// pm2 start ecosystem.config.js --env production
// pm2 reload api   # zero-downtime rolling restart
```

## Common mistakes & gotchas

- **Hard-coded config or a committed `.env`.** Secrets leak, and you cannot vary them per environment. Read environment variables. Inject secrets at deploy time.
- **A single-stage image that still has compilers and dev dependencies.** Use multiple stages and copy only what you run.
- **Running as root.** Add `USER node`.
- **Copying source before `npm ci`.** Every code change reinstalls dependencies. Copy the manifest first.
- **`npm install` in the image.** It can drift from the lockfile. `npm ci` is deterministic.
- **Ignoring PID 1.** `docker stop` sends `SIGTERM`. If Node ignores it, the container is killed after the timeout. Use `--init` or tini, and shut down gracefully.
- **Forgetting `NODE_ENV=production`.** You keep dev-only cost, and some frameworks run slower.
- **PM2 cluster mode inside Kubernetes.** PM2's forks times pod replicas confuse CPU accounting and health checks. One process per container, and let the orchestrator scale.
- **State on the container filesystem.** Containers are ephemeral. Put state in a database, Redis, or object storage.
- **Log files inside the container.** Stream logs to stdout and stderr.

## Best practices

- **Config in the environment**, checked at startup so a missing variable fails fast. One image, many environments.
- **Multi-stage builds.** A fat builder, a slim runtime, and only `dist` plus production `node_modules` in the final image.
- **A slim, pinned base**, `NODE_ENV=production`, and `USER node`.
- **Order the Dockerfile for the cache:** manifests and `npm ci` before source, plus a `.dockerignore`.
- **Handle signals** with `--init` or tini, and a graceful shutdown, so a rolling deploy does not drop requests.
- **Stateless processes and logs on stdout.** Sessions live in a backing service.
- **One scaling owner.** PM2 cluster on VMs, or one process per container plus orchestrator replicas.
- **A health endpoint** wired to liveness and readiness probes.

## ⭐ Interview lens

> **Q: Why not just run `node server.js` in production?**  
> A: `node server.js` is a laptop command. It does not restart when the process crashes, it uses one core because your JavaScript is one thread, it has no zero-downtime reload, and it dies when the SSH session dies. Production needs a supervisor. On a VM that is PM2: it restarts on crash or when memory crosses a limit, `pm2 start app.js -i max` runs one worker per core by using Node's cluster module, it gathers logs, and `pm2 reload` brings new workers up before the old ones exit. `pm2 startup` and `pm2 save` bring that back after a reboot. On a container platform, Kubernetes restarts a dead container and scales with replicas, which is the same set of guarantees without PM2. For example, a leaked heap past the ecosystem file's `max_memory_restart` gets a fresh worker instead of a dead API. The limit is stacking both. PM2 cluster mode inside a pod multiplies processes the scheduler cannot see cleanly. Pick one owner.

> **Q: What is a multi-stage Docker build and why use it for Node?**  
> A: A multi-stage Dockerfile has more than one `FROM`. The builder stage has the compilers and dev dependencies, runs `npm ci`, and compiles. The runtime stage starts from a slim image and `COPY --from=builder` takes only the built output and production dependencies. Compilers, source you do not need, and dev dependencies never land in the image you ship. Each instruction is a cached layer, so you copy `package.json` and the lockfile and run `npm ci` before you copy source. A source edit then reuses the install layer. `npm ci` installs the lockfile exactly. `npm install` can resolve something else. A `.dockerignore` keeps local `node_modules`, `.git`, and secrets out of the build context. For example, the final stage is `node:24-slim`, `NODE_ENV=production`, and `USER node`. The limit is a stage that looks small and still runs as root, or a `latest` tag that changes under you. Pin the Node major. The slim image is also why a health check cannot assume curl is installed.

> **Q: Why run the container as a non-root user, and what's the PID 1 problem?**  
> A: The default user in a container is root. If something in the app is compromised, it is root inside the container, which is a bigger blast radius if the escape reaches the host. Official Node images include a `node` user. `USER node` drops to it. Separate from that is PID 1. The process that is PID 1 does not get the default signal handlers a normal process gets. `docker stop` and a rolling deploy send `SIGTERM`. If Node ignores it, the runtime waits out the timeout and sends `SIGKILL`, which cuts off in-flight requests. `--init`, or tini, puts a tiny init as PID 1 that forwards signals, and the app still needs a graceful shutdown that stops accepting, drains, and exits. For example, `docker stop` should let the current requests finish instead of dying at the timeout. The limit is init without a handler, or a handler without init. You want both, and you still do not want PM2's multi-process cluster inside a platform that already sends `SIGTERM` to one process.

> **Q: Do you need PM2 if you're deploying to Kubernetes?**  
> A: Usually not in cluster mode. Kubernetes restarts a container that exits, and it scales by running more pods. PM2's job on a VM is those two things plus one process per core. Inside a pod, `pm2 start -i max` forks extra processes the resource limits and the probes were not written for, so CPU and memory are double-counted and a health check can pass while a worker is dead. The usual pattern is one Node process per container, a liveness and readiness endpoint, and the orchestrator owning restarts and replica count. PM2 still fits when you deploy onto VMs and there is no orchestrator. For example, the same image runs `node server.js` as PID 1 under Kubernetes, and on a VM you point PM2 at that file with `-i max`. The limit is thinking the image replaces the supervisor. The image makes the runtime identical. Something still has to restart it. That something is either PM2 or the platform, not both at once. Config stays in the environment so the image does not change between dev and prod.

## Cheat-card

- **PM2** restarts on crash, `-i max` is cluster mode on top of the cluster module, `reload` is zero downtime, and `startup` plus `save` survive reboot.
- A **Docker image** is the app plus its runtime, portable and immutable. A **container** is a running instance.
- **Multi-stage:** the builder compiles, the slim stage copies `dist` and production dependencies.
- Copy `package*.json` and run `npm ci` before source, so the install layer caches. Add a `.dockerignore`. Pin a slim base.
- `NODE_ENV=production`, `USER node`, and `--init` or tini so signals arrive.
- **12-factor:** config in the environment, stateless processes, logs on stdout, fast start and graceful stop.
- One scaling owner: PM2 cluster on VMs, or one process per container plus orchestrator replicas.

## Good to know

- **Why environment variables, the 12-factor config rule?** The same image runs in dev, staging, and prod. Only the env values change, and secrets stay out of the repo and the image. Validate required variables at startup and fail fast. Hard-coded config forces a rebuild per environment.
- **How does PM2 cluster mode relate to the cluster module?** PM2 is the primary. It forks one worker per core with Node's cluster module, they share the port, and you do not write the `exit` handler yourself. You also get logs, reload, and a memory restart.
- **Node 20 is end of life** in this lesson's guidance. Pin a current major, such as the `node:24-slim` base the Dockerfile uses.
- **Next lessons:** [107](103-ci-cd-with-github-actions.md) builds and pushes this image in GitHub Actions. [108](104-docker-compose.md) runs it with Postgres and Redis. [109](105-kubernetes-for-node-developers.md) is Kubernetes. [110](106-cloud-and-serverless-deployment.md) is cloud and serverless.
- **Compose for this image:** `build: {context: ., target: runtime}` plus `init: true`, which is the same idea as `docker run --init`. `docker compose config` validates the file without a daemon and does not read the Dockerfile.

---

## Learn More

- [PM2 Quick Start pm2.keymetrics.io](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [Containerize a Node.js application (Docker guide) docs.docker.com](https://docs.docker.com/guides/nodejs/)
- [How to Use PM2 for Node.js Application Management Code With KASA](https://www.youtube.com/watch?v=_6nxB2RiSKI)
- [How to Build Node.js Apps with Docker | Dockerize Node.js and Express Apps Dipesh Malvia](https://www.youtube.com/watch?v=nH47lsxvY9c)

---

## Additional topics

*Added 12 Oct 2026 · examples verified on Node v24.19.0 and Docker Compose v5.6.0 (`docker-compose config` only; no Docker daemon was available)*

### Where this lesson continues: lessons 103–106

This lesson builds one image and runs one process. Four later lessons take that image further, from the pipeline that builds it to the platforms that run it:

- **[CI/CD with GitHub Actions](103-ci-cd-with-github-actions.md) (lesson 103)** — a workflow that runs `npm ci`, lint, tests and build on Node 22, 24 and 26, then builds *this lesson's Dockerfile* with `docker/build-push-action`, pushes it to `ghcr.io` with `GITHUB_TOKEN`, and deploys it by digest through a protected environment.
- **[Docker Compose: App, Postgres and Redis](104-docker-compose.md) (lesson 104)** — runs the same image next to PostgreSQL and Redis, with health checks, `depends_on` conditions, volumes, `.env` handling, dev and prod override files, and a one-shot `migrate` service that runs before the app.
- **[Kubernetes for Node Developers](105-kubernetes-for-node-developers.md) (lesson 105)** — the "orchestrator" this lesson mentions: the image in a Deployment with several replicas, restarted and scaled by the cluster instead of by PM2.
- **[Cloud and Serverless Deployment](106-cloud-and-serverless-deployment.md) (lesson 106)** — managed platforms that run a container or a function for you, and what changes for a Node process there.

A Compose file is the shortest step from this lesson's `docker run` to a described service. It records the build, the `--init` flag, the environment and the ports in one file, so nobody has to remember the flags.

How it works:

1. `build.context: .` sends the current directory, minus the entries in `.dockerignore`, to the builder, and `build.target: runtime` stops at the Dockerfile's second stage (`FROM node:24-slim AS runtime`).
2. `init: true` is the Compose form of `docker run --init`: a small init process runs as PID 1 and forwards `SIGTERM` to `node`, which addresses the PID 1 point in "How it works" above.
3. `environment:` sets the variables that `config.js` reads. Real secrets belong in the environment of the deploy, not in the file (lesson 104 shows `.env` and `env_file`).
4. `docker compose config` parses the file, applies defaults and validates it against the Compose schema without a Docker daemon. `docker compose up --build` would then build and start it.

**Example — the lesson's Dockerfile, described in Compose and validated.** The directory holds the corrected Dockerfile from "Code examples" above (unchanged: `node:24` builder, `node:24-slim` runtime, comments on their own lines), the `.dockerignore`, and this file:

yaml

```
# compose.yaml — lesson 101's Dockerfile, built and run by Compose
services:
  api:
    build:
      context: .
      target: runtime
    # same as `docker run --init`: a small init process is PID 1 and forwards SIGTERM to node
    init: true
    environment:
      PORT: "3000"
    ports:
      - "3000:3000"
```

bash

```
$ docker-compose version
Docker Compose version v5.6.0
$ docker-compose config
name: l65
services:
  api:
    environment:
      PORT: "3000"
    init: true
    networks:
      default: null
    build:
      context: /…/l65
      dockerfile: Dockerfile
      target: runtime
    ports:
      - mode: ingress
        target: 3000
        published: "3000"
        protocol: tcp
networks:
  default:
    name: l65_default
$ echo $?
0
```

The project name (`l65`) comes from the directory name, because the file sets no top-level `name:`. Compose added a `default` network and the `dockerfile: Dockerfile` default. The binary is the standalone `docker-compose` from github.com/docker/compose releases (v5.6.0, sha256 checked against the published `.sha256` file).

> ⚠️ Unverified: the image was not built and the container was not started (no Docker daemon). Only the Compose model was validated.

### Common mistakes & gotchas (additional topics)

- **Treating `config` as a build check.** `docker compose config` validates the YAML and the Compose schema. It does not read the Dockerfile, so a wrong stage name passes (edge case below). Only a real build checks the Dockerfile.
- **Forgetting `init: true`.** Without it, `node` is PID 1 in the container, which is the signal problem described in "How it works".
- **Putting secrets in `environment:` in a committed file.** Use interpolation from the deploy's environment (`${SESSION_SECRET:?…}`) instead; lesson 104, Example 5 shows the error when it is missing.

### Edge case worked through: a misspelled build target passes `config`

The same file with `target: runtme` (missing `i`), next to a file with an invalid `init` value:

bash

```
$ docker-compose -f typo.yaml config --quiet
$ echo $?
0
$ docker-compose -f typo2.yaml config --quiet
error while interpolating services.api.init: failed to cast to expected type: invalid boolean: yes please
$ echo $?
1
```

1. `init: yes please` is checked, because `init` is a Compose field with a type (boolean) that Compose knows.
2. `target: runtme` is only a string to Compose. Whether a stage with that name exists is decided by the builder when it reads the Dockerfile, so `config` exits 0.
3. So `config` in CI catches schema and type errors, and a build step (`docker build --target runtime .` or the `image` job in lesson 103) is still needed to catch Dockerfile errors.

> ⚠️ Unverified: the builder's error for an unknown target stage was not observed, because no build was possible.

### ⭐ Interview lens (additional topics)

> **Q: “You have a working Dockerfile. What do Compose, CI and an orchestrator each add?”**  
> A: Compose describes how to run the image with its neighbours (database, cache), its environment, ports and start order, so a whole stack starts with one command (lesson 104). CI builds the image from a clean checkout after tests pass, pushes it with an immutable tag and deploys it by digest (lesson 103). An orchestrator such as Kubernetes runs several replicas, restarts them and routes traffic to the healthy ones (lesson 105). The image itself stays the same in all three.
