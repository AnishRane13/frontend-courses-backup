---
title: "Docker Compose: App, Postgres and Redis"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Docker Compose: App, Postgres and Redis

*22 min read · Updated 12 Oct 2026 · Topic 108 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Docker Compose v5.6.0 (standalone binary, `docker-compose config` only), PostgreSQL 18.4 and Redis 8.0.5 run locally without Docker, Express 5.3.0, pg 8.23.1, ioredis 6.0.0. No Docker daemon was available, so no container was started.

---

## Say it in 30 seconds

Docker Compose starts the whole stack from one YAML file: the app, Postgres, and Redis, on a private network where the app reaches the database by the service name. It exists so every developer and CI get the same versions, in an order where the database is actually accepting connections before the app starts. The trade-off is that "started" is not "ready", and `depends_on` only orders `docker compose up`. If Postgres restarts later, the app still needs its own retries and a readiness check.

## Why it matters

The orders API from lesson 103 needs PostgreSQL and Redis. Without Compose, every developer installs both by hand, at whatever versions their package manager has, with whatever passwords they picked. The README grows a list of `docker run` commands that must be typed in order. The app starts before the database accepts connections and crashes, or keeps running and returns 500s. The schema is missing, or three app instances migrate at once. Data disappears because it lived inside a container that was removed, or the volume was mounted at the wrong path. One laptop has Postgres 16 and Redis 7 while CI has 18 and 8.

**Docker Compose** describes the stack in one file, `compose.yaml`: images, environment, ports, volumes, networks, health checks, and start order. `docker compose up` creates it. `docker compose down` removes it and leaves named volumes unless you add `-v`.

## The concept, simply

Each entry under `services:` becomes one or more containers. Compose puts them on a private network. Each service is reachable by its name, so the app connects to `db:5432` and `cache:6379`, not to `localhost`. Data that must survive a recreated container goes in a **named volume**.

The important part is start order. "Started" is not "ready". A Postgres container is running long before it accepts connections. Each dependency gets a **health check**, and the app's `depends_on` waits for it.

text

```
docker compose up
  │
  ├─ 1. start db (postgres:18.4) and cache (redis:8.0.5) in parallel
  │       db health check:    pg_isready -h 127.0.0.1 -U postgres -d app
  │       cache health check: redis-cli ping
  │       … wait until both report "healthy"            (condition: service_healthy)
  │
  ├─ 2. start migrate (same image as app) as soon as db is healthy; it does not wait for cache
  │       runs node dist/migrate.js once
  │       … wait until it exits with code 0   (condition: service_completed_successfully)
  │       exit code ≠ 0 → app is never started
  │
  ├─ 3. start app (node dist/server.js)
  │       app health check: fetch http://127.0.0.1:3000/readyz
  │       "healthy" once SELECT 1 and PING both succeed
  ▼
stack ready
```

The migration runs once, in its own short-lived container, before any app container starts. The app never migrates the schema itself.

## How it works

What `docker compose up` does, from the Compose specification and Docker's documentation. The merge and interpolation steps are shown in Examples 3 to 5. The rest could not be run here.

1. **Find the files.** Without `-f`, Compose reads `compose.yaml` and, if it is in the same directory, `compose.override.yaml`. With `-f a.yaml -f b.yaml`, it reads exactly those, in that order.
2. **Interpolate each file.** `${VAR}`, `${VAR:-default}`, and `${VAR:?error}` are replaced from the shell environment, then from a `--env-file`, or from `.env` in the project directory when you did not pass `--env-file`. This happens per file, before merging.
3. **Merge the files.** Later files override earlier ones.
4. **Create the network and volumes.** Names are prefixed with the project name. `name: orders` gives the network `orders_backend` and the volume `orders_pgdata`.
5. **Build or pull.** Services with `build:` are built. The others are pulled.
6. **Start in dependency order.** `db` and `cache` first. Compose runs each health check every `interval` and waits for `healthy`. Failures during `start_period` do not count toward `retries`. Then `migrate` runs and Compose waits for exit code 0. Then `app` starts. If a dependency becomes unhealthy, or `migrate` exits non-zero, Compose does not start `app` and `up` fails.
7. **Keep watching.** The app's health check keeps running. `restart: unless-stopped` restarts the app if its process exits. `migrate` has `restart: "no"`, so it stays exited.

> ⚠️ Unverified: steps 4 to 7, including the health-check timing, the exact error messages Compose prints, and restart behaviour. They need a Docker daemon, which was not available. The ordering logic itself is reproduced without Docker in Examples 6 and 7.

**Health checks** run inside the container. Exit code 0 is healthy. Exit code 1 is unhealthy. `test` is `["CMD", …]`, run directly, or `["CMD-SHELL", "…"]`, run through `/bin/sh`.

Postgres must be checked over TCP. On first start the image's entrypoint runs a temporary server with `listen_addresses` empty, so it listens only on the Unix socket. `pg_isready` with no `-h` can report ready during that phase, and then the server restarts. `pg_isready -h 127.0.0.1` checks TCP, which only the real server listens on. Redis is `redis-cli ping`, which prints `PONG` and exits 0. The app image is `node:24-slim`, which has no curl, because the Dockerfile installs curl to download Node and then purges it. The check uses Node's `fetch` against `/readyz`, which returns 200 only when both `SELECT 1` and `PING` succeed. Keep `/healthz` free of dependencies, as lesson 102 explains.

**`depends_on` conditions.** `service_started` is what the short syntax means: the container has been started, which is not ready. `service_healthy` waits until the health check reports healthy. This lesson uses that for `db` and `cache`. `service_completed_successfully` waits until the dependency has exited 0. This lesson uses that for `migrate`. `depends_on` only orders `docker compose up`. It does nothing when Postgres restarts while the app is already running, so the app still needs connection retries and a readiness endpoint.

**Volumes.** `pgdata:/var/lib/postgresql` mounts the named volume. For PostgreSQL 18 and later, `PGDATA` is `/var/lib/postgresql/18/docker` and the image declares `VOLUME /var/lib/postgresql`. Mounts should target that updated location. An older example that mounts `…/postgresql/data` on an 18 image leaves `PGDATA` outside the named volume, so the files go into the anonymous volume the image declares, not into `pgdata`.

> ⚠️ Unverified: what then happens to the data when the stack is removed and recreated (`docker compose down` then `up`) was not tested; the image documentation describes the same trap for 17 and earlier as mounts that "WILL NOT PERSIST database data when the container is re-created".

Redis in this lesson runs with `--save '' --appendonly no`, a pure cache with nothing to persist. A Redis that must keep data needs a volume on `/data`. The `backend` network is user-defined. Services reach each other by name. Only `ports:` entries are reachable from the host. The dev override publishes the database on `127.0.0.1` only.

**`.env` and `env_file` are different.** `.env` in the project directory is read by Compose to fill `${…}` in the YAML. Those values are not passed into containers unless the YAML puts them there, as `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?…}` does. Precedence, highest first: the shell, then the file from `--env-file`, or `.env` only when there is no `--env-file`. `${VAR:?message}` stops Compose with that message when the variable is unset or empty. `env_file:` on a service injects variables into that container. `environment:` wins over `env_file` for the same name. `docker compose config` prints the result of both, including secrets in clear text.

**Overrides.** The base file holds what every environment shares. `compose.override.yaml` loads automatically, so it is the place for a bind mount of `src/`, `node --watch`, and database ports on localhost. Production uses `-f compose.yaml -f compose.prod.yaml`, which skips the automatic override. Mappings such as `environment` merge key by key, and the later file wins. Sequences are appended. `command`, `entrypoint`, and `healthcheck.test` are replaced, not appended. `ports`, `volumes`, `secrets`, and `configs` append unless the unique key matches. For ports that key is the host IP, target, published port, and protocol together. `"80:3000"` and `"3000:3000"` differ in the published port, so a plain override publishes both. `!reset` clears an attribute, so `build: !reset null` makes production use only `image:`. `!override` replaces a sequence instead of appending it.

**Migrations.** Running them in the app's startup code means every replica runs them. With `docker compose up --scale app=3`, or three pods, three processes run the same migration together. `CREATE TABLE IF NOT EXISTS` is not safe under concurrency. In this lesson's runs, two of three unlocked runners failed with `duplicate key value violates unique constraint "pg_type_typname_nsp_index"` or `relation "orders" already exists`. A crashing replica restarts and tries again, and a slow migration delays every replica's readiness. If the migration fails, the app may serve traffic against the old schema, or crash-loop.

A one-shot `migrate` service uses the same image, runs `node dist/migrate.js`, and exits. The app depends on it with `service_completed_successfully`, so a failed migration stops the rollout before new code serves. The script still takes a PostgreSQL advisory lock, `pg_advisory_lock(108)`, so a second runner waits. node-pg-migrate in lesson 80 uses the same kind of lock. Lesson 80 also covers migrations that are safe while the old app version is still running.

## Code examples

The app is the orders API from lesson 103 (`src/app.js`, its tests, and lesson 101's Dockerfile). This lesson adds the process entry point, the migration runner and the Compose files.

**Example 1 — `src/server.js`: wiring the real clients.**

javascript

```
// src/server.js — wires real clients from the environment and starts listening
import pg from 'pg';
import { Redis } from 'ioredis';
import { createApp } from './app.js';

const { DATABASE_URL, REDIS_URL, PORT = '3000' } = process.env;
if (!DATABASE_URL || !REDIS_URL) {
  console.error('DATABASE_URL and REDIS_URL are required');
  process.exit(1);
}

const db = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2000 });
// enableOfflineQueue: false makes PING fail at once while Redis is unreachable,
// instead of waiting in ioredis's queue until it reconnects
const cache = new Redis(REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
cache.on('error', () => {}); // ioredis keeps reconnecting; /readyz reports the state

const server = createApp({ db, cache }).listen(Number(PORT), () => {
  console.log(`listening on :${server.address().port}`);
});

process.on('SIGTERM', () => {
  server.close(async () => {
    await db.end();
    cache.disconnect();
    process.exit(0);
  });
});
```

The app does not exit when Postgres or Redis are down at boot. `pg.Pool` connects lazily on the first query, and ioredis reconnects in the background, so `/readyz` reports 503 until both answer (Example 7, part 1). The SIGTERM handler is the minimal version; lesson 102 has the full graceful shutdown. Without `enableOfflineQueue: false`, ioredis would queue the `PING` until it reconnects, and `/readyz` would hang instead of answering 503.

**Example 2 — `src/migrate.js`: a one-shot runner that exits 0 when the schema is current.**

javascript

```
// src/migrate.js — one-shot migration runner: applies pending migrations, then exits.
// Exit code 0 = schema is current; any error = non-zero exit (unhandled rejection).
import pg from 'pg';

const migrations = [
  ['001_orders', `CREATE TABLE orders (
     id serial PRIMARY KEY,
     item text NOT NULL,
     qty integer NOT NULL CHECK (qty > 0))`],
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // if a second runner starts by mistake, it waits here instead of racing
  await client.query('SELECT pg_advisory_lock(108)');
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, run_at timestamptz NOT NULL DEFAULT now())`);
  for (const [name, sql] of migrations) {
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [name]);
    if (done.rowCount) {
      console.log(`skip ${name} (already applied)`);
      continue;
    }
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    await client.query('COMMIT');
    console.log(`applied ${name}`);
  }
} finally {
  // ending the session also releases the advisory lock
  await client.end();
}
```

This hand-written runner keeps the example free of extra packages. In a real project, the `migrate` service would run your migration tool instead (for example `npx node-pg-migrate up` from lesson 80). The Compose side stays the same: a command that exits 0 when the schema is current.

**Example 3 — the base file and the dev override, validated with `docker-compose config`.**

yaml

```
# compose.yaml — the base file: what every environment shares
name: orders

services:
  db:
    image: postgres:18.4
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: app
    volumes:
      # PostgreSQL 18+ images: mount /var/lib/postgresql, not .../data
      - pgdata:/var/lib/postgresql
    healthcheck:
      # -h 127.0.0.1: check over TCP; the image's first-run init server listens only on the socket
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres -d app"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 10s
    networks: [backend]

  cache:
    image: redis:8.0.5
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
    networks: [backend]

  # one-shot job: applies migrations once, then exits 0
  migrate:
    build: .
    command: ["node", "dist/migrate.js"]
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/app
    depends_on:
      db:
        condition: service_healthy
    restart: "no"
    networks: [backend]

  app:
    build: .
    init: true
    environment:
      DATABASE_URL: postgres://postgres:${POSTGRES_PASSWORD}@db:5432/app
      REDIS_URL: redis://cache:6379
      PORT: "3000"
    env_file:
      - path: ./app.env
        required: false
    ports:
      - "${APP_PORT:-3000}:3000"
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    healthcheck:
      # node:24-slim has no curl, so the check uses Node's own fetch
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 3
      start_period: 15s
    restart: unless-stopped
    networks: [backend]

volumes:
  pgdata:

networks:
  backend:
```

yaml

```
# compose.override.yaml — development only; `docker compose up` loads it automatically
services:
  app:
    environment:
      NODE_ENV: development
    # restart on file changes; src/ is bind-mounted over the image's copy
    command: ["node", "--watch", "src/server.js"]
    volumes:
      - ./src:/app/src:ro
  db:
    ports:
      - "127.0.0.1:5432:5432"
  cache:
    ports:
      - "127.0.0.1:6379:6379"
```

The two env files. `.env` is for Compose's interpolation; `app.env` is injected into the app container:

bash

```
# .env — read by Compose for ${...} interpolation in the compose files
POSTGRES_PASSWORD=devpass
APP_PORT=3000
```

bash

```
# app.env — injected into the app container as environment variables
LOG_LEVEL=debug
```

The standalone Compose binary (v5.6.0, from github.com/docker/compose releases, sha256 checked against `docker-compose-linux-x86_64.sha256`) runs as `docker-compose`. `config` loads, interpolates, merges and validates the files, then prints the final model. No Docker daemon is needed for that:

bash

```
$ docker-compose version
Docker Compose version v5.6.0
$ docker-compose config
name: orders
services:
  app:
    restart: unless-stopped
    command:
      - node
      - --watch
      - src/server.js
    environment:
      DATABASE_URL: postgres://postgres:devpass@db:5432/app
      LOG_LEVEL: debug
      NODE_ENV: development
      PORT: "3000"
      REDIS_URL: redis://cache:6379
    init: true
    networks:
      backend: null
    volumes:
      - type: bind
        source: /…/app/src
        target: /app/src
        read_only: true
        bind: {}
    build:
      context: /…/app
      dockerfile: Dockerfile
    depends_on:
      cache:
        condition: service_healthy
        required: true
      db:
        condition: service_healthy
        required: true
      migrate:
        condition: service_completed_successfully
        required: true
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - 'fetch(''http://127.0.0.1:3000/readyz'').then((r) => process.exit(r.ok ?
          0 : 1), () => process.exit(1))'
      timeout: 3s
      interval: 10s
      retries: 3
      start_period: 15s
    ports:
      - mode: ingress
        target: 3000
        published: "3000"
        protocol: tcp
  cache:
    command:
      - redis-server
      - --save
      - ""
      - --appendonly
      - 'no'
    image: redis:8.0.5
    networks:
      backend: null
    healthcheck:
      test:
        - CMD
        - redis-cli
        - ping
      timeout: 3s
      interval: 5s
      retries: 10
    ports:
      - mode: ingress
        host_ip: 127.0.0.1
        target: 6379
        published: "6379"
        protocol: tcp
  db:
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: devpass
    image: postgres:18.4
    networks:
      backend: null
    volumes:
      - type: volume
        source: pgdata
        target: /var/lib/postgresql
        volume: {}
    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -h 127.0.0.1 -U postgres -d app
      timeout: 3s
      interval: 5s
      retries: 10
      start_period: 10s
    ports:
      - mode: ingress
        host_ip: 127.0.0.1
        target: 5432
        published: "5432"
        protocol: tcp
  migrate:
    restart: 'no'
    command:
      - node
      - dist/migrate.js
    environment:
      DATABASE_URL: postgres://postgres:devpass@db:5432/app
    networks:
      backend: null
    build:
      context: /…/app
      dockerfile: Dockerfile
    depends_on:
      db:
        condition: service_healthy
        required: true
networks:
  backend:
    name: orders_backend
volumes:
  pgdata:
    name: orders_pgdata
$ echo $?
0
```

What the merged output shows:

- **The override was merged in.** `app.command` was replaced by `node --watch src/server.js`, `NODE_ENV: development` was added to the `environment` mapping, the `src/` bind mount was added, and `db` and `cache` gained ports on `127.0.0.1` only.
- **Interpolation happened.** `${POSTGRES_PASSWORD:?…}` and `${POSTGRES_PASSWORD}` became `devpass` (from `.env`), and `${APP_PORT:-3000}` became `"3000"`.
- **`env_file` was folded in.** `LOG_LEVEL: debug` from `app.env` appears in the app's `environment`, which is what the container would receive.
- **Short forms were expanded.** Each `depends_on` entry got `required: true`, ports became the long form (`target`, `published`, `host_ip`), and `build:` became an absolute `context` plus `dockerfile: Dockerfile`.
- **Names got the project prefix:** `orders_backend`, `orders_pgdata`. The healthcheck string is wrapped only by the YAML printer.

`config` also validates against the Compose schema. A typo in a condition (`service_completed` instead of `service_completed_successfully`) is caught before anything starts:

bash

```
$ docker-compose config --quiet
validating /…/typo/compose.yaml: services.app.depends_on.migrate.condition value must be one of 'service_started', 'service_healthy', 'service_completed_successfully'
$ echo $?
1
```

> ⚠️ Unverified: the files were validated with `docker-compose config`, not run. Whether the images build and start, the health checks pass, and the order holds at run time were not tested with Docker (Examples 6 and 7 test the same order without Docker).

**Example 4 — the production override with `-f`, and edge case: `ports` are appended, not replaced.**

yaml

```
# compose.prod.yaml — production: use with -f compose.yaml -f compose.prod.yaml
services:
  migrate:
    build: !reset null
    image: ghcr.io/example/orders-api:${APP_TAG:?set APP_TAG to the image tag CI pushed}
  app:
    build: !reset null
    image: ghcr.io/example/orders-api:${APP_TAG:?set APP_TAG to the image tag CI pushed}
    ports: !override
      - "80:3000"
    restart: always
```

bash

```
$ docker-compose -f compose.yaml -f compose.prod.yaml config
error while interpolating services.app.image: required variable APP_TAG is missing a value: set APP_TAG to the image tag CI pushed
error while interpolating services.migrate.image: required variable APP_TAG is missing a value: set APP_TAG to the image tag CI pushed
$ echo $?
1
$ APP_TAG=sha-860c190 docker-compose -f compose.yaml -f compose.prod.yaml config
name: orders
services:
  app:
    restart: always
    environment:
      DATABASE_URL: postgres://postgres:devpass@db:5432/app
      LOG_LEVEL: debug
      PORT: "3000"
      REDIS_URL: redis://cache:6379
    image: ghcr.io/example/orders-api:sha-860c190
    init: true
    networks:
      backend: null
    depends_on:
      cache:
        condition: service_healthy
        required: true
      db:
        condition: service_healthy
        required: true
      migrate:
        condition: service_completed_successfully
        required: true
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - 'fetch(''http://127.0.0.1:3000/readyz'').then((r) => process.exit(r.ok ?
          0 : 1), () => process.exit(1))'
      timeout: 3s
      interval: 10s
      retries: 3
      start_period: 15s
    ports:
      - mode: ingress
        target: 3000
        published: "80"
        protocol: tcp
  cache:
    …   (same as in the base file, minus the dev ports)
  db:
    …   (same as in the base file, minus the dev ports)
  migrate:
    restart: 'no'
    command:
      - node
      - dist/migrate.js
    environment:
      DATABASE_URL: postgres://postgres:devpass@db:5432/app
    image: ghcr.io/example/orders-api:sha-860c190
    networks:
      backend: null
    depends_on:
      db:
        condition: service_healthy
        required: true
networks:
  backend:
    name: orders_backend
volumes:
  pgdata:
    name: orders_pgdata
$ docker-compose -f compose.yaml -f compose.prod-append.yaml config --format json | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).services.app.ports)"
[{"mode":"ingress","target":3000,"published":"3000","protocol":"tcp"},{"mode":"ingress","target":3000,"published":"80","protocol":"tcp"}]
$ docker-compose -f compose.yaml -f compose.prod.yaml config --format json | node -p "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).services.app.ports)"
[{"mode":"ingress","target":3000,"published":"80","protocol":"tcp"}]
```

What `-f compose.yaml -f compose.prod.yaml` produced:

- **No automatic override.** With `-f`, `compose.override.yaml` was not read: no `--watch` command (so the image's `CMD ["node", "dist/server.js"]` applies), no bind mount, no database ports.
- **`build: !reset null`** removed `build:` from `app` and `migrate`, so both run the image CI pushed (`ghcr.io/example/orders-api:sha-860c190`, the `type=sha` tag from lesson 103). Both use the same image, so the migration files always match the app version.
- **`${APP_TAG:?…}`** stopped `config` with the message from the file (exit code 1) until `APP_TAG` was set.
- **`.env` was still read.** `devpass` from the development `.env` reached the production model, because Compose reads `.env` from the project directory (here the directory of the first `-f` file) whatever override files you pass. On a server, set the real value in the shell environment of the deploy (it wins over `.env`, Example 5) or pass `--env-file prod.env`, and do not ship the development `.env`.

**Edge case: `ports` are appended, not replaced.** `compose.prod-append.yaml` is the same file with `ports:` instead of `ports: !override`. The first JSON line above shows the result: the app publishes **both** `3000` (from the base file) and `80`. The two entries differ in their published port, so they have different unique keys, and the merge appends. `!override` gives only `80`. The same applies to `volumes` (unique key: the target path) and to every other sequence.

**Example 5 — `.env` interpolation: a missing variable, and the shell winning over `.env`.**

bash

```
$ : > empty.env
$ docker-compose --env-file empty.env config --quiet
time="2026-10-12T23:24:32+05:30" level=warning msg="The \"POSTGRES_PASSWORD\" variable is not set. Defaulting to a blank string."
time="2026-10-12T23:24:32+05:30" level=warning msg="The \"POSTGRES_PASSWORD\" variable is not set. Defaulting to a blank string."
error while interpolating services.db.environment.POSTGRES_PASSWORD: required variable POSTGRES_PASSWORD is missing a value: set POSTGRES_PASSWORD in .env
$ echo $?
1
$ docker-compose config --quiet; echo $?
0
$ POSTGRES_PASSWORD=from-shell docker-compose config | grep -E "POSTGRES_PASSWORD|DATABASE_URL"
      DATABASE_URL: postgres://postgres:from-shell@db:5432/app
      POSTGRES_PASSWORD: from-shell
      DATABASE_URL: postgres://postgres:from-shell@db:5432/app
$ docker-compose config --environment | grep -E "^(POSTGRES_PASSWORD|APP_PORT|LOG_LEVEL)="
APP_PORT=3000
POSTGRES_PASSWORD=devpass
```

- **A required variable is checked once per place it is used.** `--env-file empty.env` replaces `.env`, so `POSTGRES_PASSWORD` is unset. The two plain `${POSTGRES_PASSWORD}` uses (in `migrate` and `app`) only printed warnings and would have become empty strings. The one `${POSTGRES_PASSWORD:?…}` (in `db`) stopped Compose with the file's message. Use `:?` on every use of a required variable, or the app gets `postgres://postgres:@db…`.
- **The shell wins over `.env`.** `POSTGRES_PASSWORD=from-shell` replaced `devpass` in all three places.
- **`--environment` shows only the interpolation inputs.** `APP_PORT` and `POSTGRES_PASSWORD` come from `.env`. `LOG_LEVEL` is not listed, because `app.env` is an `env_file:`: it goes into the container (Example 3's output) and is never used for `${…}`.

**Example 6 — proving the startup order without Docker.** The same app and migration run against a local PostgreSQL 18.4 (the embedded-postgres package) and Redis 8.0.5, in the order Compose would use. Postgres listens on port 7010, Redis on 7020 and the app on 7030. The image's `pg_isready` is not available outside the image, so a 10-line Node probe stands in for it. The Redis check is the same `redis-cli ping`, and the app check is the exact `node -e "fetch(…/readyz)…"` command from `compose.yaml`, with the port changed.

javascript

```
// pg-probe.mjs — stands in for `pg_isready`: exit 0 if Postgres accepts a query
import pg from 'pg';
const client = new pg.Client({ connectionString: process.argv[2], connectionTimeoutMillis: 1000 });
try {
  await client.connect();
  await client.query('SELECT 1');
  process.exit(0);
} catch {
  process.exit(1);
}
```

bash

```
#!/usr/bin/env bash
# startup-order.sh — the compose startup order, run by hand without Docker:
#   db healthy + cache healthy -> migrate exits 0 -> app starts -> app healthy
# usage: startup-order.sh <postgres-password-the-app-uses>
R=$HOME/.cache/nodekit-repair-tools/root/usr
export LD_LIBRARY_PATH=$R/lib/x86_64-linux-gnu
PASS=${1:-postgres}
export DATABASE_URL=postgres://postgres:$PASS@127.0.0.1:7010/app
export REDIS_URL=redis://127.0.0.1:7020 PORT=7030
T0=$(date +%s%N); t() { printf '[%5d ms] %s\n' $(( ($(date +%s%N) - T0) / 1000000 )) "$*"; }

# wait_healthy NAME CMD... — retry CMD every 0.5 s, up to 60 tries (like retries/interval)
wait_healthy() {
  local name=$1; shift
  for i in $(seq 1 60); do
    if "$@" >/dev/null 2>&1; then t "$name healthy after $i check(s)"; return 0; fi
    sleep 0.5
  done
  t "$name never became healthy"; return 1
}

t "start db and cache"
node ~/.cache/nodekit-repair-tools/pg/start-pg.mjs 7010 "$PGDATA_DIR" > pg.out 2>&1 &
PG_PID=$!
$R/bin/redis-server --port 7020 --save '' --appendonly no --daemonize yes --dir "$PWD" --logfile redis.log
wait_healthy cache $R/bin/redis-cli -p 7020 ping || exit 1
wait_healthy db node pg-probe.mjs postgres://postgres:postgres@127.0.0.1:7010/app || exit 1

t "run migrate (one-shot)"
node dist/migrate.js 2>&1 | sed 's/^/    migrate: /'
code=${PIPESTATUS[0]}
t "migrate exited with code $code"
if [ "$code" -ne 0 ]; then
  t "app not started: migrate did not complete successfully"
else
  t "start app"
  node dist/server.js > app.out 2>&1 &
  APP_PID=$!
  # the exact command from the app's healthcheck in compose.yaml (port changed)
  wait_healthy app node -e "fetch('http://127.0.0.1:7030/readyz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
  echo "    GET /readyz  -> $(curl -s localhost:7030/readyz)"
  echo "    POST /orders -> $(curl -s -X POST localhost:7030/orders -H 'content-type: application/json' -d '{"item":"pen","qty":2}')"
  echo "    GET /orders  -> $(curl -s localhost:7030/orders)"
  kill -TERM $APP_PID; wait $APP_PID 2>/dev/null
fi
$R/bin/redis-cli -p 7020 shutdown nosave >/dev/null 2>&1
kill -TERM $PG_PID; wait $PG_PID 2>/dev/null
t "stopped everything"
```

Three runs: a fresh data directory, a second start on the same data, and a migration that fails because the app's password is wrong:

bash

```
$ bash startup-order.sh            # fresh data directory
[    5 ms] start db and cache
[   30 ms] cache healthy after 1 check(s)
[ 1265 ms] db healthy after 3 check(s)
[ 1271 ms] run migrate (one-shot)
    migrate: applied 001_orders
[ 1368 ms] migrate exited with code 0
[ 1374 ms] start app
[ 2073 ms] app healthy after 2 check(s)
    GET /readyz  -> {"ready":true,"checks":{"postgres":"up","redis":"up"}}
    POST /orders -> {"id":1,"item":"pen","qty":2}
    GET /orders  -> [{"id":1,"item":"pen","qty":2}]
[ 2192 ms] stopped everything
$ bash startup-order.sh            # second start, same data directory
[    4 ms] start db and cache
[   25 ms] cache healthy after 1 check(s)
[  663 ms] db healthy after 2 check(s)
[  668 ms] run migrate (one-shot)
    migrate: skip 001_orders (already applied)
[  739 ms] migrate exited with code 0
[  744 ms] start app
[ 1410 ms] app healthy after 2 check(s)
    GET /readyz  -> {"ready":true,"checks":{"postgres":"up","redis":"up"}}
    POST /orders -> {"id":2,"item":"pen","qty":2}
    GET /orders  -> [{"id":1,"item":"pen","qty":2},{"id":2,"item":"pen","qty":2}]
[ 1529 ms] stopped everything
$ bash startup-order.sh wrongpass  # the app and migrate use a wrong password
[   12 ms] start db and cache
[   54 ms] cache healthy after 1 check(s)
[  716 ms] db healthy after 2 check(s)
[  720 ms] run migrate (one-shot)
    migrate: /…/node_modules/pg-protocol/dist/parser.js:306
    migrate:         : new messages_1.DatabaseError(messageValue, LATEINIT_LENGTH, name);
    migrate:           ^
    migrate: 
    migrate: error: password authentication failed for user "postgres"
    migrate:     at parseErrorMessage (/…/node_modules/pg-protocol/dist/parser.js:306:11)
    migrate:     …
    migrate:   code: '28P01',
    migrate:   …
    migrate: }
    migrate: 
    migrate: Node.js v24.19.0
[  789 ms] migrate exited with code 1
[  794 ms] app not started: migrate did not complete successfully
[  830 ms] stopped everything
```

What this shows:

- The order is db + cache healthy → migrate exits → app starts → app healthy. The app's first health check failed (it was still starting), and the second passed.
- On the second start, the migration is a no-op (`skip 001_orders (already applied)`), so running `migrate` on every `docker compose up` is safe.
- When `migrate` exits with code 1, the app is never started. That is what `service_completed_successfully` gives you: a failed migration stops the rollout instead of starting code against the wrong schema.

**Example 7 — edge case: what goes wrong without the ordering, and with migrations in every replica.**

bash

```
#!/usr/bin/env bash
# no-order.sh — what goes wrong without the ordering:
#   part 1: the app starts before its dependencies and before the migration
#   part 2: three replicas each run the migration at boot
R=$HOME/.cache/nodekit-repair-tools/root/usr
export LD_LIBRARY_PATH=$R/lib/x86_64-linux-gnu
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:7010/app
export REDIS_URL=redis://127.0.0.1:7020 PORT=7030

# three copies of a migration script at once, like three replicas booting
migrate_x3() {
  local pids=() i
  for i in 1 2 3; do node "$1" > "m$i.out" 2>&1 & pids+=($!); done
  for i in 1 2 3; do
    wait "${pids[$((i - 1))]}"
    echo "replica $i exit $?: $(grep -m1 -E '^(applied|skip|error)' "m$i.out")"
  done
}

echo "--- part 1: app first, dependencies later"
node dist/server.js > app.out 2>&1 & APP_PID=$!
sleep 1
echo "only the app:      /readyz $(curl -s localhost:7030/readyz)"
$R/bin/redis-server --port 7020 --save '' --appendonly no --daemonize yes --dir "$PWD" --logfile redis.log
node ~/.cache/nodekit-repair-tools/pg/start-pg.mjs 7010 "$PGDATA_DIR" > pg.out 2>&1 & PG_PID=$!
until node pg-probe.mjs "$DATABASE_URL"; do sleep 0.5; done
echo "db + cache up:     /readyz $(curl -s localhost:7030/readyz)"
echo "no migration yet:  GET /orders -> $(curl -s -o /dev/null -w '%{http_code}' localhost:7030/orders)"

echo "--- part 2: three replicas migrate at boot, without the advisory lock"
sed '/pg_advisory_lock/d' dist/migrate.js > dist/migrate-nolock.js
migrate_x3 dist/migrate-nolock.js
echo "schema_migrations: $(node sql.mjs 'SELECT name FROM schema_migrations')"

echo "--- part 2b: drop both tables, three replicas again, with the lock"
node sql.mjs 'DROP TABLE orders, schema_migrations' > /dev/null
migrate_x3 dist/migrate.js
echo "schema_migrations: $(node sql.mjs 'SELECT name FROM schema_migrations')"
echo "after migration:   GET /orders -> $(curl -s -o /dev/null -w '%{http_code}' localhost:7030/orders)"

kill -TERM $APP_PID; wait $APP_PID
$R/bin/redis-cli -p 7020 shutdown nosave > /dev/null
kill -TERM $PG_PID; wait $PG_PID
echo "--- stopped"
```

`sql.mjs` is a 7-line helper that runs one statement and prints the rows as JSON. The first of four runs:

bash

```
$ bash no-order.sh
--- part 1: app first, dependencies later
only the app:      /readyz {"ready":false,"checks":{"postgres":"down (ECONNREFUSED)","redis":"down (Stream isn't writeable and enableOfflineQueue options is false)"}}
db + cache up:     /readyz {"ready":true,"checks":{"postgres":"up","redis":"up"}}
no migration yet:  GET /orders -> 500
--- part 2: three replicas migrate at boot, without the advisory lock
replica 1 exit 1: error: duplicate key value violates unique constraint "pg_type_typname_nsp_index"
replica 2 exit 1: error: relation "orders" already exists
replica 3 exit 0: applied 001_orders
schema_migrations: [{"name":"001_orders"}]
--- part 2b: drop both tables, three replicas again, with the lock
replica 1 exit 0: applied 001_orders
replica 2 exit 0: skip 001_orders (already applied)
replica 3 exit 0: skip 001_orders (already applied)
schema_migrations: [{"name":"001_orders"}]
after migration:   GET /orders -> 200
--- stopped
```

How the four runs differed in part 2 (no lock): run 1 had two failures (`duplicate key value violates unique constraint "pg_type_typname_nsp_index"` and `relation "orders" already exists`), run 2 one, run 3 two, run 4 none. The race depends on timing, so it passes sometimes, which is why it reaches production. With the advisory lock (part 2b), all twelve runner processes across the four runs exited 0, and exactly one per run printed `applied`.

- **Part 1.** The app came up without its dependencies and reported `ready: false` with the reason for each. It became ready once both services answered, without a restart. But "ready" does not mean "migrated": `GET /orders` returned 500 because the table did not exist yet. That gap is what the `migrate` dependency closes.
- **`pg_type_typname_nsp_index`.** `CREATE TABLE` also creates a row type with the table's name in the `pg_type` catalog. `IF NOT EXISTS` checks for the table first, then creates it, and two sessions can both pass the check. The second one to insert the catalog row hits the unique index.

## Common mistakes & gotchas

- **`depends_on` with no condition.** The short form means `service_started`. The app starts while Postgres is still initialising. Add a health check and `condition: service_healthy`.
- **`pg_isready` with no `-h`.** On first start the image's init server listens only on the Unix socket, so the check can pass before TCP is open.
- **A Postgres 18 volume at `/var/lib/postgresql/data`.** For 18 and later, mount `/var/lib/postgresql`. With the old path, `PGDATA` sits outside your named volume.
- **`curl` in a slim-image health check.** `node:24-slim` has no curl. Use `node -e` with `fetch`, or install curl in the Dockerfile.
- **`localhost` in a connection string inside the container.** `localhost` is the container itself. Use the service name, `db` or `cache`.
- **Migrations in app startup.** Every replica runs them at once, and a failure leaves the app half-started. Use a one-shot `migrate` service and a lock.
- **Expecting `.env` to reach the container.** `.env` only fills `${…}` in the YAML. Put the variable in `environment:` or use `env_file:`.
- **Committing `.env` with real passwords.** Commit `.env.example`. Keep `.env` in `.gitignore` and `.dockerignore`.
- **An override that publishes both port mappings.** Sequences append. Use `!override`.
- **Pasting `docker compose config` into a ticket.** It prints interpolated secrets in clear text.
- **`docker compose down -v` on a stack with data.** `-v` removes named volumes, including `pgdata`.
- **Publishing the database on all interfaces.** `"5432:5432"` listens everywhere. In development use `"127.0.0.1:5432:5432"`. In production publish no database port.

## Best practices

- **Pin image versions**, `postgres:18.4` and `redis:8.0.5`, the same ones CI and production use.
- **Health checks on every dependency**, and `depends_on` with `service_healthy` or `service_completed_successfully`.
- **A one-shot `migrate` service** from the same image, idempotent, with an advisory lock. The app never migrates.
- **Keep the app tolerant anyway.** Lazy connections, retries, and a `/readyz` that reports each dependency, because `depends_on` only orders the first start.
- **A base file plus overrides.** Development lives in `compose.override.yaml`. Production is `-f compose.yaml -f compose.prod.yaml` with `build: !reset null` so it runs the image CI pushed.
- **Fail loudly on required variables** with `${POSTGRES_PASSWORD:?…}` instead of a silent empty default.
- **Run `docker compose config` in CI**, or `docker compose config --quiet`, before a deploy.
- **`init: true`** on the Node service so a small init process is PID 1 and forwards signals.

## ⭐ Interview lens

> **Q: “Your app container starts before Postgres is ready. How do you fix it in Compose?”**  
> A: "Started" is not "ready". Compose's short `depends_on` means `service_started`: the container process has begun, and Postgres is often still initialising. Give Postgres a health check whose command is `pg_isready -h 127.0.0.1` with the user and database, so it checks TCP. On first start the image runs a temporary server that listens only on the Unix socket, and a check with no `-h` can pass and then the real server restarts. Point the app at `depends_on` with `condition: service_healthy`. Compose runs that check on an interval, ignores failures during `start_period`, and does not start the app until the status is healthy. Redis in this lesson is `redis-cli ping`. The app's own check hits `/readyz` with Node's `fetch`, because `node:24-slim` has no curl, and `/readyz` returns 200 only when `SELECT 1` and `PING` both work. For example, `db` and `cache` become healthy, then `migrate` must exit 0, then the app starts. The limit is that `depends_on` only orders `docker compose up`. If Postgres restarts later, nothing restarts the wait. The app still needs lazy connections, retries, and a readiness route.

> **Q: “Where do you run database migrations in a containerised deployment?”**  
> A: In a one-shot job from the same image, before the new app version starts serving. In Compose that is a `migrate` service with `restart: "no"` that runs `node dist/migrate.js` and exits. The app depends on it with `condition: service_completed_successfully`, so a non-zero exit means Compose never starts the app. In Kubernetes the same idea is a Job or an init step that runs once per rollout. Do not migrate inside each replica's startup. With `--scale app=3`, three processes run the same DDL together. `CREATE TABLE IF NOT EXISTS` is not safe under that race: two sessions can both pass the existence check, and the second hits `pg_type_typname_nsp_index` or `relation "orders" already exists`. This lesson saw that in unlocked runs, and saw every runner exit 0 once they took `pg_advisory_lock(108)`. The script should be idempotent and take that lock so two deploys do not race. The limit of even a good one-shot job is a migration that is unsafe while old replicas are still running. Lesson 80 is where that expand-and-contract shape is covered. A failed migration should stop the rollout, not leave the app half-started against the old schema.

> **Q: “What is the difference between `.env` and `env_file`?”**  
> A: `.env` in the project directory is for Compose itself. It fills `${VAR}` in the YAML. The shell environment wins over `--env-file`, and `--env-file` replaces `.env` rather than merging with it. Nothing in `.env` enters a container unless a YAML key references it, such as `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set a password}`. The `:?` form makes Compose stop with your message when the variable is missing or empty. `env_file:` on a service injects that file's variables into the container. Keys under `environment:` win when the name clashes. The long form can set `required: false` so a missing file is skipped. For example, the database password is interpolated into the Postgres service, and the app receives `DATABASE_URL` through `environment`, not because `.env` magically leaks in. `docker compose config` prints the merged result of both, which is how you see what the container will get. The limit is that printout. It shows secrets in clear text, so it does not belong in a ticket. Also `$$` in the YAML is how you keep a literal dollar sign for the container.

> **Q: “How do dev and prod differ in a Compose setup?”**  
> A: One base `compose.yaml` holds the shared services, health checks, the private network, and the named volume. `compose.override.yaml` is loaded automatically when you do not pass `-f`, so it is the dev file: bind-mount `src/`, run `node --watch`, and publish Postgres on `127.0.0.1` only. Production is explicit, `-f compose.yaml -f compose.prod.yaml`, which does not load the override. It sets `build: !reset null` so Compose uses the registry `image:` CI pushed, not a local build. Merge rules: mappings merge and the later file wins, sequences append, and `command`, `entrypoint`, and `healthcheck.test` are replaced. `ports` and `volumes` append unless the unique key matches. For a port that key includes the published port, so `"80:3000"` plus `"3000:3000"` publishes both. `!override` replaces the list instead. For example, dev exposes the database on localhost for a GUI, and prod publishes no database port at all. The limit is forgetting `!override` or `!reset` and thinking the prod file replaced the dev ports or the build. `docker compose config` is the check, in CI as well, before you deploy.

## Cheat-card

- **Files:** `compose.yaml` plus automatic `compose.override.yaml`. `-f a -f b` replaces that default. `docker compose config` prints the merged, interpolated model.
- **Order:** `service_started`, `service_healthy`, or `service_completed_successfully`.
- **Health check:** `["CMD", …]` or `["CMD-SHELL", "…"]`. Exit 0 is healthy. `interval`, `timeout`, `retries`, and `start_period` control the wait.
- **Postgres 18 and later:** mount `/var/lib/postgresql`. `PGDATA` is `/var/lib/postgresql/18/docker`. Check with `pg_isready -h 127.0.0.1`.
- **Redis:** `redis-cli ping`. Persist on `/data` only if you need the data. This lesson's cache uses `--save '' --appendonly no`.
- **Interpolation:** shell, then `--env-file`, then `.env`. `${V:-default}` and `${V:?error}`. `$$` is a literal `$`.
- **`env_file:`** enters the container. `environment:` wins.
- **Merge:** mappings merge, sequences append, `command`, `entrypoint`, and `healthcheck.test` replace. Use `!reset` and `!override` when append is wrong.
- **Migrations:** one-shot service, same image, advisory lock `pg_advisory_lock(108)`, and the app waits for exit 0.
- **Do not use `localhost` inside a container** for another service. Use the service name. `down -v` deletes named volumes.

## Good to know

- **`depends_on` extras:** `restart: true` was added in Compose v2.17.0 and restarts the dependent when Compose restarts the dependency, for example `docker compose restart db`. `required: false` was added in v2.20.0 and turns a missing dependency into a warning.
- **`start_interval`** on a health check was added in Compose v2.20.2.
- **`env_file` `required: false`** was added in Compose v2.24.0 and skips a missing file.
- **Versions this lesson used:** Docker Compose v5.6.0, config only, no daemon. postgres 18.4. redis 8.0.5. node 24-slim. Express 5.3.0, pg 8.23.1, ioredis 6.0.0.
- **Unlocked migration race in this lesson:** across four runs with no lock, run 1 had two failures, run 2 one, run 3 two, and run 4 none. The errors were `pg_type_typname_nsp_index` and `relation "orders" already exists`. With the advisory lock, all twelve runner processes across four runs exited 0, and exactly one per run printed `applied`.
- **Part 1 of the ordering experiment:** the app came up without its dependencies, reported `ready: false` with a reason for each, and became ready once both answered, without a restart. `GET /orders` still returned 500 because the table did not exist. Ready is not migrated.

---

## Learn More

- [Control startup and shutdown order in Compose docs.docker.com](https://docs.docker.com/compose/how-tos/startup-order/)
- [Compose file reference: services docs.docker.com](https://docs.docker.com/reference/compose-file/services/)
- [Merge Compose files docs.docker.com](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
- [Set, use and manage variables with interpolation docs.docker.com](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- [Environment variables precedence docs.docker.com](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/)
- [postgres official image (PGDATA and volumes) hub.docker.com](https://hub.docker.com/_/postgres)
- [docker/compose releases github.com](https://github.com/docker/compose/releases)
