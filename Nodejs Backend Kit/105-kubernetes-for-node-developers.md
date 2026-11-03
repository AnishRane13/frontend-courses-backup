---
title: "Kubernetes for Node Developers"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Kubernetes for Node Developers

*30 min read · Updated 12 Oct 2026 · Topic 109 of 117 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0 and Express 5.3.0, kubectl v1.37.1, kubeconform v0.8.0 (schemas for Kubernetes 1.37.1), systemd 259 (`systemd-run --user --scope` for cgroup memory limits). No cluster was available: the manifests were validated, not applied, and the app was run as a plain process.

---

## Say it in 30 seconds

Kubernetes keeps a set of Node containers running, sends them traffic only when a readiness check passes, and replaces them on each deploy by sending SIGTERM to the old ones. You describe that desired state in YAML, and controllers keep fixing the gap between what you asked for and what is running. The trade-off is that the cluster only knows what your probes, memory limit, and signal handler tell it: a liveness check that calls the database restarts every pod together, and a heap set larger than the memory limit gets the process killed with no JavaScript error.

## Why it matters

Kubernetes decides where your Node process runs, restarts it when it hangs, sends traffic only when it says it is ready, kills it when it uses too much memory, and replaces every copy on each deploy. Each decision is driven by something you write: a probe endpoint, a memory limit, a signal handler, a number in YAML. If those do not match how Node behaves, the cluster does the wrong thing.

A liveness probe that checks the database restarts every Pod when the database has a slow minute. A memory limit of 512 MiB with the default V8 heap stops the heap around half of that limit, so you run out of heap while memory is still free. A heap set too large is worse: the kernel kills the process and there is no JavaScript error. A SIGTERM handler that closes the server at once drops requests on every rolling update, because traffic keeps arriving for a few seconds after Kubernetes decides to stop the Pod.

This lesson is the objects a Node developer writes, how probes and shutdown fit lesson 102, and how the memory limit interacts with `--max-old-space-size`. The Node side was run. The manifests were validated with kubeconform and `kubectl --dry-run=client`. Cluster behaviour comes from the Kubernetes docs.

## The concept, simply

You describe the state you want in YAML and send it to the API server. Controllers compare that with what is running and fix the difference.

- A **Pod** is one or more containers that run together on one node and share an IP. Your Node process runs in a container in a Pod. Pods are disposable. You rarely create them yourself.
- A **Deployment** means "keep this many Pods of this template running". It creates a ReplicaSet per template version and, on a change, rolls Pods from the old ReplicaSet to the new one.
- A **Service** is a stable virtual IP and DNS name in front of Pods whose labels match its selector and that are currently ready. Clients inside the cluster call `http://orders-api`, not a Pod IP.
- An **Ingress** is HTTP routing from outside the cluster, by host and path, to a Service. An Ingress controller you install does the work. The docs say the Ingress API has been frozen and recommend the Gateway API. Ingress remains generally available, and the docs say there are no plans to remove it.
- A **ConfigMap** and a **Secret** are key-value settings injected as environment variables or files. Secrets are, by default, stored unencrypted in etcd, the API server's data store.
- A **HorizontalPodAutoscaler**, the HPA, changes the Deployment's replica count from a metric such as CPU.

How they point at each other:

text

```
 internet
    │  Host: api.example.com
    ▼
 ┌──────────┐ backend.service.name ┌─────────────┐ selector: app.kubernetes.io/name=orders-api
 │ Ingress  │ ───────────────────► │  Service    │ ─────────────────────┐
 └──────────┘                      │ orders-api  │                      │ only Pods that are READY
                                   └─────────────┘                      ▼ (listed in EndpointSlices)
 ┌───────────────┐ scaleTargetRef ┌─────────────┐ owns ┌────────────┐ owns ┌───────┐ ┌───────┐ ┌───────┐
 │ HPA           │ ─────────────► │ Deployment  │ ───► │ ReplicaSet │ ───► │ Pod 1 │ │ Pod 2 │ │ Pod 3 │
 │ cpu 70% of    │ sets replicas  │ orders-api  │      │ (template  │      │ node  │ │ node  │ │ node  │
 │ the request   │                └─────────────┘      │  hash)     │      └───────┘ └───────┘ └───────┘
 └───────────────┘                                     └────────────┘          ▲  envFrom / secretKeyRef
                                                        ┌───────────┐ ┌────────┴──┐
                                                        │ ConfigMap │ │  Secret   │
                                                        └───────────┘ └───────────┘
```

Three probes tell the kubelet, the agent on each node, how the process is doing.

- **Startup:** has it finished starting? Until this succeeds, the other two probes do not run.
- **Liveness:** is it stuck? Failure restarts the container.
- **Readiness:** should it get traffic right now? Failure removes the Pod from the Service and does not restart it.

## How it works

From `kubectl apply` to a request reaching Node:

1. The API server stores the Deployment. The Deployment controller creates a ReplicaSet, and the ReplicaSet creates the Pods. This lesson's example keeps 3.
2. The scheduler picks a node using **requests** only, here 250m CPU and 512Mi memory, not actual usage.
3. The kubelet pulls the image and starts the container. Your `CMD` is PID 1, the process that will receive SIGTERM. Run `node server.mjs` directly, not `npm start`. Node as PID 1 gets no default signal handling, so install a SIGTERM handler or run under an init such as tini.
4. The startup probe is `GET /healthz` every 2 seconds, up to 30 failures, so about 60 seconds to start. Liveness and readiness wait until it passes.
5. The readiness probe is `GET /readyz` every 5 seconds. Only a ready Pod is listed in the Service's EndpointSlices, and only then do kube-proxy and the Ingress controller send traffic.
6. The liveness probe is `GET /healthz` every 10 seconds, with a 2 second timeout and 3 failures. If the event loop is blocked longer than about 30 seconds, three probes time out and the kubelet restarts the container.

Readiness runs for the whole life of the container, so a Pod can leave the Service and come back without a restart. That is what a 503 from `/readyz` is for. Liveness restarts the process, so it must check only the process, never the database. Readiness only stops traffic, so it may check critical dependencies, and it must report not-ready once shutdown begins.

**Rolling update and SIGTERM.** When a Pod is deleted, two things happen together. On the node, the kubelet runs `preStop` if there is one, then sends SIGTERM to PID 1. If the container is still running when `terminationGracePeriodSeconds` ends, the default is 30 seconds, the runtime sends SIGKILL. The grace period covers both the `preStop` hook and the normal stop. In the control plane, the endpoint is marked terminating, and terminating endpoints are not ready, so load balancers should not use them for regular traffic.

That endpoint change is not instant on every node. Until kube-proxy and the Ingress controller notice, new connections still arrive. The Pod must keep serving for a few seconds, then stop accepting. This Deployment's `preStop` is a `sleep` of 5 seconds, which runs before SIGTERM. `DRAIN_DELAY_MS` is 0 in the ConfigMap so the two waits do not add up. On SIGTERM the app flips `/readyz` to 503, calls `server.close()`, finishes in-flight requests, closes pools, and exits 0. A forced-exit timer of 20 seconds fires first if a request hangs, so 5 seconds plus 20 seconds stays inside the 30 second grace period.

![Graceful Shutdown on SIGTERM: the orchestrator sends SIGTERM, the app flips its readiness probe to not ready, server.close() stops new connections, in-flight requests drain, resources close, and the process exits, with a forced-exit timer as a safety net](assets/i63_01_85ccfa6f.svg)
*Figure: the shutdown sequence lesson 102's handler runs on SIGTERM, which is what the kubelet sends after `preStop`. Look at: step 2, readiness flips to not ready before `server.close()`, so the Pod keeps serving while traffic moves away.*

The timeline for this lesson's manifests:

text

```
t=0s   Pod marked Terminating (e.g. rolling update)
       ├─ control plane: endpoint ready=false → kube-proxy / Ingress controller start removing it
       └─ kubelet: runs preStop sleep 5s — the app is still serving normally
t=5s   kubelet sends SIGTERM to PID 1 (node server.mjs)
       app: /readyz → 503, server.close(), in-flight requests finish, pools close, exit(0)
t≤25s  app's forced-exit timer (FORCE_EXIT_MS=20000) fires if something hangs → exit(1)
t=30s  terminationGracePeriodSeconds ends → SIGKILL to anything still running
```

> ⚠️ Unverified: how long endpoint removal takes to reach kube-proxy and Ingress controllers in a real cluster, and therefore whether 5 s of `preStop` is enough. No cluster was available. The local run in Example 2 shows only the Node side.

The `preStop` `sleep` action is run by the kubelet, so the image needs no `sleep` binary. That matters for distroless images. On older clusters the form is an `exec` of `sleep`, which does need the binary.

**Requests and limits.** A request is what the scheduler reserves, and it is what HPA CPU utilisation is measured against. A limit is enforced by the kernel through cgroups. CPU over the limit is throttled, which shows up as event-loop lag and slow probes. Memory over the limit is an out-of-memory kill: SIGKILL, no chance to log or drain, and not always immediate, because it happens when the kernel detects pressure. This Deployment sets a CPU request, no CPU limit, and a memory request equal to the memory limit, 512Mi, so the memory is reserved and the limit is a known point.

**The V8 heap and the memory limit.** Node's memory is the heap plus everything outside it: Buffers, compiled code, stacks, and native libraries. The limit applies to all of it. V8's own ceiling is `heap_size_limit`. When the heap reaches it, Node aborts with a fatal JavaScript heap out of memory error, exit code 134. One re-run printed "Ineffective mark-compacts near heap limit" instead, so match on `JavaScript heap out of memory`. On Node 24, V8 reads the cgroup limit. With no flag, the default heap in this lesson's measurements was about half the limit: 259 MiB under 512 MiB. `--max-old-space-size=384` leaves room under a 512 MiB limit for off-heap use. `--max-old-space-size-percentage` sets the old space as a percentage of available memory, which here followed the cgroup limit, not the host. The docs say the percentage flag takes precedence when both are set, and it works in `NODE_OPTIONS`. A heap larger than the limit is the dangerous case. V8 never runs out of heap, the kernel kills the process with exit code 137, which is 128 plus signal 9, and there is no Node error. In Kubernetes that status is `OOMKilled`. The full measurements are in Good to know.

> ⚠️ Unverified: the `OOMKilled` status and restart count as shown by `kubectl describe pod`. The kill itself (exit 137 under a 512 MiB cgroup limit) was reproduced with `systemd-run`, not with a kubelet.

**HPA.** The controller runs every 15 seconds by default. It reads CPU from the `metrics.k8s.io` API, usually from Metrics Server, which you install separately. Utilisation is a percentage of the resource request, so a Deployment with no CPU request cannot scale on CPU. The formula is `desiredReplicas = ceil(currentReplicas × currentMetricValue / desiredMetricValue)`.

text

```
desiredReplicas = ceil( currentReplicas × currentMetricValue / desiredMetricValue )

3 Pods averaging 140% of their 250m request, target 70%:  ceil(3 × 140 / 70) = 6
6 Pods averaging  35%,                     target 70%:  ceil(6 ×  35 / 70) = 3  (after the 300 s window)
```

Scale-up has no stabilisation window by default. It may add 4 pods or 100% of the currently running replicas every 15 seconds, whichever is more. Scale-down uses a 300 second window and takes the highest recommendation in that window, so a short dip does not remove Pods. `minReplicas: 3` keeps capacity for a rolling update and a node failure.

> ⚠️ Unverified: actual scaling events and timing. No cluster and no Metrics Server were available. The arithmetic above is the docs' formula, worked by hand.

**`maxSurge` and `maxUnavailable`.** On a template change the Deployment moves Pods within two limits. `maxSurge` is how many Pods may exist above `replicas`. `maxUnavailable` is how many may be missing. Both default to 25%, as a number or a percentage. The docs' example with 3 replicas and the defaults keeps at least 3 Pods available and at most 4 in total. This lesson sets `maxSurge: 1` and `maxUnavailable: 0`: start one new Pod, wait until it is ready, then terminate one old Pod, and repeat. A new Pod counts as available only after readiness passes, plus `minReadySeconds`, which defaults to 0. A readiness endpoint that returns 200 before the database is connected will replace working Pods with broken ones.

text

```
3 replicas (HPA minimum), maxSurge: 1, maxUnavailable: 0  ready old  ready new  total
start                                                        3          0      3
create new-1 (surge)                                         3          0      4
new-1 passes startup + readiness → terminate old-1           2          1      4 → 3
create new-2 …                                               2          1      4
… until                                                      0          3      3
```

> ⚠️ Unverified: the rollout sequence above was not observed with `kubectl rollout status` on a cluster. It follows the Deployment docs.

**ConfigMap changes** consumed as environment variables are not updated automatically. The docs say you need a Pod restart. `kubectl rollout restart deployment/orders-api` replaces Pods with the same rolling-update rules.

## Code examples

**Example 1 — an Express 5 app with startup, liveness and readiness endpoints and a SIGTERM drain.**

This is lesson 102's shutdown sequence with two settings read from the environment: the drain delay (0 in the cluster, where `preStop` does the waiting) and the forced-exit timer.

javascript

```
// server.mjs — an Express 5 app shaped for Kubernetes: probes, readiness flip, drain, exit
import express from 'express';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = Number(process.env.PORT ?? 3000);
const DRAIN_DELAY_MS = Number(process.env.DRAIN_DELAY_MS ?? 5000);    // 0 when a preStop sleep does the wait
const FORCE_EXIT_MS = Number(process.env.FORCE_EXIT_MS ?? 20000);     // keep below terminationGracePeriodSeconds
const t0 = Number(process.env.T0 ?? Date.now());                      // shared clock with the demo client
const log = (msg) => console.log(`[server +${String(Date.now() - t0).padStart(5)}ms] ${msg}`);

let ready = false;          // false until warm-up is done, false again once SIGTERM arrives
let shuttingDown = false;

const app = express();
app.use((req, res, next) => {                                          // once draining, close each keep-alive
  res.on('finish', () => {                                             // socket as soon as its response ends
    if (shuttingDown) setImmediate(() => server.closeIdleConnections());
  });
  next();
});
app.get('/healthz', (req, res) => res.send('ok'));                     // liveness: no dependency checks
app.get('/readyz', (req, res) => {                                     // readiness: may this pod get traffic?
  if (!ready || shuttingDown) return res.status(503).send('not ready');
  res.send('ready');
});
app.get('/work', async (req, res) => {                                  // a request that takes a while
  await sleep(Number(req.query.ms ?? 1000));
  res.json({ done: true, ms: Number(req.query.ms ?? 1000) });
});

const server = app.listen(PORT, async () => {
  log(`listening on ${PORT}, not ready yet`);
  await sleep(1000);                                                    // stands in for warm-up: DB pool, caches
  ready = true;
  log('warm-up done, /readyz -> 200');
});
server.keepAliveTimeout = 5000;

async function shutdown(signal) {
  if (shuttingDown) return;                                             // signals can repeat
  shuttingDown = true;
  log(`${signal} received, /readyz -> 503, still serving for ${DRAIN_DELAY_MS} ms`);
  setTimeout(() => { log('drain timed out, forcing exit'); process.exit(1); }, FORCE_EXIT_MS).unref();

  await sleep(DRAIN_DELAY_MS);                                          // keep serving while routing catches up
  log('server.close(): no new connections, waiting for in-flight requests');
  server.close(async () => {
    // close DB pools, Redis, queue consumers here (lesson 102)
    log('all connections closed, exit 0');
    process.exit(0);
  });
  server.closeIdleConnections();                                        // idle keep-alive sockets
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

**Example 2 — a real SIGTERM: readiness flips, requests drain, the process exits 0.**

The driver starts the server, waits for it to become ready, starts a 3-second request, sends a real `SIGTERM` with `child.kill('SIGTERM')`, and keeps probing. Locally there is no `preStop`, so the app's own `DRAIN_DELAY_MS=2000` plays that part. Both processes print milliseconds since the same start time.

javascript

```
// sigterm-demo.mjs — start server.mjs, send it a real SIGTERM mid-request, watch the probes
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 7101;
const base = `http://127.0.0.1:${PORT}`;
const t0 = Date.now();
const log = (msg) => console.log(`[client +${String(Date.now() - t0).padStart(5)}ms] ${msg}`);
const get = async (path) => {
  try { const r = await fetch(base + path); return `${r.status} ${await r.text()}`; }
  catch (err) { return `failed: ${err.cause?.code ?? err.message}`; }
};

const child = spawn(process.execPath, [process.argv[2] ?? 'server.mjs'], {
  env: { ...process.env, T0: String(t0), PORT: String(PORT), DRAIN_DELAY_MS: '2000', FORCE_EXIT_MS: '10000' },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));

await sleep(300);
log(`GET /healthz -> ${await get('/healthz')}`);
log(`GET /readyz  -> ${await get('/readyz')}`);
await sleep(1000);
log(`GET /readyz  -> ${await get('/readyz')}`);

const slow = get('/work?ms=3000').then((r) => log(`in-flight GET /work?ms=3000 -> ${r}`));
await sleep(200);
log('sending SIGTERM');
child.kill('SIGTERM');
await sleep(100);
log(`GET /readyz  -> ${await get('/readyz')}`);
log(`GET /healthz -> ${await get('/healthz')}`);
log(`GET /work?ms=50 (arrives during the drain delay) -> ${await get('/work?ms=50')}`);
await sleep(2200);
log(`GET /healthz (after server.close) -> ${await get('/healthz')}`);
await slow;
const { code, sig } = await exited;
log(`server exited: code=${code} signal=${sig}`);
```

bash

```
$ node sigterm-demo.mjs
[server +  151ms] listening on 7101, not ready yet
[client +  351ms] GET /healthz -> 200 ok
[client +  355ms] GET /readyz  -> 503 not ready
[server + 1152ms] warm-up done, /readyz -> 200
[client + 1359ms] GET /readyz  -> 200 ready
[client + 1559ms] sending SIGTERM
[server + 1560ms] SIGTERM received, /readyz -> 503, still serving for 2000 ms
[client + 1663ms] GET /readyz  -> 503 not ready
[client + 1667ms] GET /healthz -> 200 ok
[client + 1720ms] GET /work?ms=50 (arrives during the drain delay) -> 200 {"done":true,"ms":50}
[server + 3561ms] server.close(): no new connections, waiting for in-flight requests
[client + 3922ms] GET /healthz (after server.close) -> failed: ECONNREFUSED
[server + 4361ms] all connections closed, exit 0
[client + 4362ms] in-flight GET /work?ms=3000 -> 200 {"done":true,"ms":3000}
[client + 4366ms] server exited: code=0 signal=null
```

Reading it against the timeline in How it works:

- **Before warm-up** (+351 ms), liveness was already 200 but readiness was 503. The startup and liveness probes pass, but the Pod is not yet in the Service.
- **On SIGTERM** (+1559 ms), `/readyz` turned 503 within the next request. `/healthz` stayed 200, so a liveness probe would not restart the Pod while it drains.
- **During the 2 s drain delay,** a new request (`/work?ms=50`) was still served, as it would be while kube-proxy catches up.
- **After `server.close()`** (+3561 ms), new connections were refused (`ECONNREFUSED`). The request that was in flight when SIGTERM arrived still completed with 200.
- **The exit:** the process exited 0 at +4361 ms, right after the last response and long before the 10 s forced-exit timer.

**Example 3 — edge case: an idle keep-alive socket delays the exit by 3 seconds.**

`server-v1.mjs` is Example 1 without the `res.on('finish', …)` middleware. Lesson 102 calls `server.closeIdleConnections()` once, right after `server.close()`. Here the 3-second request was still active at that moment, so its socket was not idle and stayed open. When the response finished, the socket became an idle keep-alive connection, and nothing closed it:

bash

```
$ node sigterm-demo.mjs server-v1.mjs
[server +  101ms] listening on 7101, not ready yet
[client +  349ms] GET /healthz -> 200 ok
[client +  353ms] GET /readyz  -> 503 not ready
[server + 1102ms] warm-up done, /readyz -> 200
[client + 1357ms] GET /readyz  -> 200 ready
[client + 1557ms] sending SIGTERM
[server + 1557ms] SIGTERM received, /readyz -> 503, still serving for 2000 ms
[client + 1660ms] GET /readyz  -> 503 not ready
[client + 1663ms] GET /healthz -> 200 ok
[client + 1717ms] GET /work?ms=50 (arrives during the drain delay) -> 200 {"done":true,"ms":50}
[server + 3559ms] server.close(): no new connections, waiting for in-flight requests
[client + 3919ms] GET /healthz (after server.close) -> failed: ECONNREFUSED
[client + 4360ms] in-flight GET /work?ms=3000 -> 200 {"done":true,"ms":3000}
[server + 7363ms] all connections closed, exit 0
[client + 7368ms] server exited: code=0 signal=null
```

The response arrived at +4360 ms, but the exit came 3 s later (+7363 ms). The 3 s is the client's doing. Node's `fetch` (undici 7.29.0, bundled with v24.19.0) keeps an idle socket for the server's `Keep-Alive: timeout=5` hint minus its `keepAliveTimeoutThreshold` (default 2 s), then closes it. A load balancer or another Node service holding a pool of keep-alive connections may hold them longer, up to the server's own `keepAliveTimeout` or until the forced-exit timer fires. The fix in Example 1 is to call `closeIdleConnections()` again whenever a response finishes during shutdown. With it, the exit followed the last response at once (+4361 ms in Example 2).

**Example 4 — the manifests.**

None of these was applied to a cluster. Example 5 validates them.

yaml

```
# k8s/configmap.yaml — non-secret settings, injected as environment variables
apiVersion: v1
kind: ConfigMap
metadata:
  name: orders-api-config
data:
  NODE_ENV: "production"
  LOG_LEVEL: "info"
  DRAIN_DELAY_MS: "0"
  FORCE_EXIT_MS: "20000"
```

yaml

```
# k8s/secret.yaml — placeholder only; real values come from your secret manager, never from git
apiVersion: v1
kind: Secret
metadata:
  name: orders-api-secrets
type: Opaque
stringData:
  DATABASE_URL: "postgres://app:CHANGE_ME@postgres:5432/app"
```

yaml

```
# k8s/deployment.yaml — the Express app: probes, resources, rolling update, shutdown
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
  labels:
    app.kubernetes.io/name: orders-api
spec:
  # no spec.replicas: the HPA in hpa.yaml owns the count (minReplicas: 3)
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app.kubernetes.io/name: orders-api
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: api
          image: registry.example.com/orders-api:1.4.2
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - configMapRef:
                name: orders-api-config
          env:
            - name: PORT
              value: "3000"
            - name: NODE_OPTIONS
              value: "--max-old-space-size=384"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: orders-api-secrets
                  key: DATABASE_URL
          resources:
            requests:
              cpu: 250m
              memory: 512Mi
            limits:
              memory: 512Mi
          startupProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 2
            failureThreshold: 30
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          lifecycle:
            preStop:
              sleep:
                seconds: 5
```

yaml

```
# k8s/service.yaml — a stable virtual IP and DNS name in front of the ready Pods
apiVersion: v1
kind: Service
metadata:
  name: orders-api
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: orders-api
  ports:
    - name: http
      port: 80
      targetPort: http
```

yaml

```
# k8s/ingress.yaml — HTTP routing from outside the cluster to the Service
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: orders-api
spec:
  ingressClassName: example
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: orders-api
                port:
                  name: http
```

yaml

```
# k8s/hpa.yaml — 3 to 10 replicas, aiming at 70% of the CPU request
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: orders-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: orders-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
```

Notes on the choices:

- **Image tag:** `image` uses a fixed tag, never `latest`, so a rollout is triggered by changing the tag and can be rolled back.
- **Ingress class:** `ingressClassName: example` stands for whatever IngressClass your cluster's controller registers.
- **Ports by name:** `targetPort: http` and the probes' `port: http` refer to the container port by name, so the number lives in one place.

**Example 5 — validating without a cluster: kubeconform and `kubectl apply --dry-run=client`.**

Both binaries were downloaded from their official release locations and checked against the published SHA-256 sums. They were run from a directory under `~/.cache`, not installed system-wide. The kubectl download stalled once and was resumed with `curl -C -` before the check.

bash

```
$ curl -LO "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl"
$ curl -LO "https://dl.k8s.io/release/v1.37.1/bin/linux/amd64/kubectl.sha256"
$ echo "$(cat kubectl.sha256)  kubectl" | sha256sum --check
kubectl: OK
$ chmod +x kubectl && ./kubectl version --client
Client Version: v1.37.1
Kustomize Version: v5.8.1
$ curl -LO https://github.com/yannh/kubeconform/releases/download/v0.8.0/kubeconform-linux-amd64.tar.gz
$ curl -LO https://github.com/yannh/kubeconform/releases/download/v0.8.0/CHECKSUMS
$ grep linux-amd64.tar.gz CHECKSUMS | sha256sum --check
kubeconform-linux-amd64.tar.gz: OK
$ tar xzf kubeconform-linux-amd64.tar.gz kubeconform && ./kubeconform -v
v0.8.0
```

kubeconform validates each object against the JSON schema generated from the Kubernetes OpenAPI spec for a given version. `-strict` rejects fields that the schema does not define, and `-summary` prints the totals. The schemas are downloaded from GitHub on first use, so `-cache` keeps them for the next run:

bash

```
$ kubeconform -strict -summary -kubernetes-version 1.37.1 -cache …/kcache k8s/; echo "exit=$?"
Summary: 6 resources found in 6 files - Valid: 6, Invalid: 0, Errors: 0, Skipped: 0
exit=0
```

Then `kubectl apply --dry-run=client`, with no cluster and no kubeconfig (`$HOME` pointed at an empty directory, so kubectl fell back to `localhost:8080`):

bash

```
$ kubectl apply --dry-run=client -f k8s/; echo "exit=$?"
error validating "k8s/configmap.yaml": error validating data: failed to download openapi: Get "http://localhost:8080/openapi/v2?timeout=32s": dial tcp 127.0.0.1:8080: connect: connection refused; if you choose to ignore these errors, turn validation off with --validate=false
…
exit=1
```

The first failure is validation. kubectl validates against the OpenAPI schema it downloads *from the API server*, and the error message itself suggests `--validate=false`. That gets one step further, and fails again:

bash

```
$ kubectl apply --dry-run=client --validate=false -f k8s/; echo "exit=$?"
E1012 23:39:45.874865 2289348 memcache.go:381] "Couldn't get current server API group list" err="Get \"http://localhost:8080/api?timeout=32s\": dial tcp 127.0.0.1:8080: connect: connection refused"
…
unable to recognize "k8s/configmap.yaml": Get "http://localhost:8080/api?timeout=32s": dial tcp 127.0.0.1:8080: connect: connection refused
…
exit=1
```

`apply` needs the server's discovery API (`/api`) to map each `kind` to a REST resource, even in client dry-run mode, and fails with "unable to recognize" when it cannot reach it. So `kubectl apply --dry-run=client` cannot be used without a reachable API server, with or without `--validate=false`. The kubectl command that does run offline is a `--local` one, which only parses the files and recognises the kinds:

bash

```
$ kubectl label --local -f k8s/ team=orders -o name; echo "exit=$?"
configmap/orders-api-config
deployment.apps/orders-api
horizontalpodautoscaler.autoscaling/orders-api
ingress.networking.k8s.io/orders-api
secret/orders-api-secrets
service/orders-api
exit=0
```

That proves the YAML parses and every `kind`/`apiVersion` pair is one kubectl knows. Example 6 shows it does not check field types or names. Against a real cluster, `kubectl apply --dry-run=server -f k8s/` adds the server's own validation and admission checks.

> ⚠️ Unverified: `kubectl apply --dry-run=client` and `--dry-run=server` against a live API server. No cluster was available.

**Example 6 — edge case: a broken manifest, and what each validator catches.**

yaml

```
# broken/deployment-broken.yaml — three deliberate mistakes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orders-api
spec:
  replicas: "3"                      # mistake 1: a string, not an integer
  selector:
    matchLabels:
      app.kubernetes.io/name: orders-api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: orders-api
    spec:
      containers:
        - name: api
          image: registry.example.com/orders-api:1.4.2
          ports:
            - containerport: 3000    # mistake 2: wrong case (containerPort)
          readinessprobe:            # mistake 3: wrong case (readinessProbe)
            httpGet:
              path: /readyz
              port: 3000
```

bash

```
$ kubeconform -strict -summary -kubernetes-version 1.37.1 -cache …/kcache broken/; echo "exit=$?"
broken/deployment-broken.yaml - Deployment orders-api is invalid: problem validating schema. Check JSON formatting: jsonschema validation failed with 'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.37.1-standalone-strict/deployment-apps-v1.json#' - at '/spec/replicas': got string, want null or integer - at '/spec/template/spec/containers/0': validation failed   - at '/spec/template/spec/containers/0/ports/0': validation failed     - at '/spec/template/spec/containers/0/ports/0': missing property 'containerPort'     - at '/spec/template/spec/containers/0/ports/0': additional properties 'containerport' not allowed   - at '/spec/template/spec/containers/0': additional properties 'readinessprobe' not allowed
Summary: 1 resource found in 1 file - Valid: 0, Invalid: 1, Errors: 0, Skipped: 0
exit=1
$ kubeconform -summary -kubernetes-version 1.37.1 -cache …/kcache broken/; echo "exit=$?"
broken/deployment-broken.yaml - Deployment orders-api is invalid: problem validating schema. Check JSON formatting: jsonschema validation failed with 'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.37.1-standalone/deployment-apps-v1.json#' - at '/spec/template/spec/containers/0/ports/0': missing property 'containerPort' - at '/spec/replicas': got string, want null or integer
Summary: 1 resource found in 1 file - Valid: 0, Invalid: 1, Errors: 0, Skipped: 0
exit=1
$ kubectl label --local -f broken/ team=orders -o name; echo "exit=$?"
deployment.apps/orders-api
exit=0
```

What each check caught:

| Mistake | `kubeconform -strict` | `kubeconform` (no `-strict`) | `kubectl label --local` |
|---|---|---|---|
| `replicas: "3"` (string) | caught | caught | not caught |
| `containerport` (wrong case) | caught twice: unknown field and missing `containerPort` | caught only as missing `containerPort` | not caught |
| `readinessprobe` (wrong case) | caught: "additional properties 'readinessprobe' not allowed" | **not caught** | not caught |

The third row is the dangerous one. Without `-strict`, the validator accepts the misspelled probe. If the cluster's field validation also lets the unknown field through (ignore or warn), it is dropped, and the Pod runs with no readiness probe, receiving traffic before it is ready.

> ⚠️ Unverified: what a live API server does with the unknown `readinessprobe` field (warn, or reject under strict field validation). No cluster was available.

**Example 7 — the V8 heap under a cgroup memory limit.**

`systemd-run --user --scope -p MemoryMax=…` runs a command in a new cgroup with a memory limit. This is the same kernel mechanism the kubelet uses for a container's memory limit, and it needs no root. The script prints what Node sees:

javascript

```
// heap.mjs — which heap limit did V8 pick, and which memory limit does Node see?
import v8 from 'node:v8';
import os from 'node:os';

const mib = (n) => `${Math.round(n / 1024 / 1024)} MiB`;
console.log('flags              :', process.execArgv.join(' ') || process.env.NODE_OPTIONS || '(none)');
console.log('os.totalmem()      :', mib(os.totalmem()));
console.log('constrainedMemory():', process.constrainedMemory(), 'bytes');
console.log('heap_size_limit    :', mib(v8.getHeapStatistics().heap_size_limit));
```

bash

```
$ node heap.mjs
flags              : (none)
os.totalmem()      : 15179 MiB
constrainedMemory(): 18446744073709552000 bytes
heap_size_limit    : 2240 MiB
$ systemd-run --user --scope -q -p MemoryMax=512M node heap.mjs
flags              : (none)
os.totalmem()      : 15179 MiB
constrainedMemory(): 536870912 bytes
heap_size_limit    : 259 MiB
$ systemd-run --user --scope -q -p MemoryMax=1G node heap.mjs
flags              : (none)
os.totalmem()      : 15179 MiB
constrainedMemory(): 1073741824 bytes
heap_size_limit    : 560 MiB
$ systemd-run --user --scope -q -p MemoryMax=2G node heap.mjs
flags              : (none)
os.totalmem()      : 15179 MiB
constrainedMemory(): 2147483648 bytes
heap_size_limit    : 1120 MiB
$ systemd-run --user --scope -q -p MemoryMax=512M node --max-old-space-size=384 heap.mjs
flags              : --max-old-space-size=384
os.totalmem()      : 15179 MiB
constrainedMemory(): 536870912 bytes
heap_size_limit    : 387 MiB
$ systemd-run --user --scope -q -p MemoryMax=512M node --max-old-space-size-percentage=75 heap.mjs
flags              : --max-old-space-size-percentage=75
os.totalmem()      : 15179 MiB
constrainedMemory(): 536870912 bytes
heap_size_limit    : 387 MiB
$ NODE_OPTIONS=--max-old-space-size-percentage=75 systemd-run --user --scope -q -p MemoryMax=512M node heap.mjs
flags              : --max-old-space-size-percentage=75
os.totalmem()      : 15179 MiB
constrainedMemory(): 536870912 bytes
heap_size_limit    : 387 MiB
$ systemd-run --user --scope -q -p MemoryMax=512M node --max-old-space-size=4096 heap.mjs
flags              : --max-old-space-size=4096
os.totalmem()      : 15179 MiB
constrainedMemory(): 536870912 bytes
heap_size_limit    : 4099 MiB
$ systemd-run --user --scope -q sh -c 'cat /sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.max'
max
```

The first run shows a value that differs from the docs. With no cgroup memory limit (a scope without `MemoryMax` reads `memory.max` as `max`, as the last command shows), `process.constrainedMemory()` returned 18446744073709552000, which is 2^64 as a JavaScript number, not the `0` that the v24 docs describe for "no such constraint". Treat any value above `os.totalmem()` as "no limit".

Now fill the heap until something stops the process. `MemorySwapMax=0` keeps the kernel from swapping instead of killing, which matches a typical Kubernetes node.

javascript

```
// fill.mjs — keep allocating until something stops the process
import v8 from 'node:v8';

const mib = (n) => Math.round(n / 1024 / 1024);
console.log('heap_size_limit', mib(v8.getHeapStatistics().heap_size_limit), 'MiB');
const keep = [];
for (let i = 1; ; i++) {
  keep.push(new Array(1024 * 1024).fill(i));     // about 8 MiB of heap per step
  if (i % 16 === 0) {
    const { heapUsed, rss } = process.memoryUsage();
    console.log('heapUsed', mib(heapUsed), 'MiB, rss', mib(rss), 'MiB');
  }
}
```

bash

```
$ systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node fill.mjs; echo "exit=$?"
heap_size_limit 259 MiB
heapUsed 132 MiB, rss 175 MiB
heapUsed 260 MiB, rss 304 MiB

<--- Last few GCs --->

[1838401:0x25d53000]      604 ms: Mark-Compact 259.9 (262.6) -> 259.9 (262.6) MB, pooled: 0 MB, 28.49 / 0.00 ms  (average mu = 0.329, current mu = 0.1 …

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

…
/bin/bash: line 1: 1838401 Aborted                    (core dumped) systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node fill.mjs 2>&1
exit=134
$ systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node --max-old-space-size=384 fill.mjs; echo "exit=$?"
heap_size_limit 387 MiB
heapUsed 132 MiB, rss 175 MiB
heapUsed 260 MiB, rss 304 MiB
heapUsed 388 MiB, rss 431 MiB

<--- Last few GCs --->

[1838850:0xd2f2000]     1111 ms: Mark-Compact (reduce) 379.9 (382.7) -> 379.9 (381.7) MB, pooled: 0 MB, 396.51 / 0.00 ms  (+ 0.1 ms in 1 steps since s …

FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

…
/bin/bash: line 1: 1838850 Aborted                    (core dumped) systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node --max-old-space-size=384 fill.mjs 2>&1
exit=134
$ systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node --max-old-space-size=4096 fill.mjs; echo "exit=$?"
heap_size_limit 4099 MiB
heapUsed 132 MiB, rss 176 MiB
heapUsed 260 MiB, rss 304 MiB
heapUsed 388 MiB, rss 432 MiB
/bin/bash: line 1: 1839429 Killed                     systemd-run --user --scope -q -p MemoryMax=512M -p MemorySwapMax=0 node --max-old-space-size=4096 fill.mjs 2>&1
exit=137
```

The three runs end in three different ways:

- **Default heap:** V8 stopped at 259 MiB with a heap OOM (exit 134) while the cgroup still had about 200 MiB free.
- **`--max-old-space-size=384`:** the heap reached 388 MiB before the same heap OOM (exit 134). RSS was 431 MiB, still under the limit, and the logs get V8's `FATAL ERROR` line, its last GC lines and a native stack trace.
- **`--max-old-space-size=4096`:** V8 kept growing until the kernel killed the process at the limit, with exit code 137 and no message from Node at all.

## Common mistakes & gotchas

- **A database call in the liveness probe.** A database outage restarts every Pod, and the restarts make it worse. Liveness checks the process. Readiness checks dependencies.
- **No startup probe on a slow start.** Liveness can kill a Pod that is still loading. The startup budget is `failureThreshold` times `periodSeconds`.
- **`timeoutSeconds` of 1 on a busy Node process.** A garbage-collection pause can miss a 1 second probe. Three misses restart a healthy Pod. Use 2 to 5 seconds for liveness, and fix event-loop blocking.
- **Closing the server the moment SIGTERM arrives.** Endpoint removal takes time to reach every node. Keep serving through a short `preStop` sleep, then `server.close()`.
- **Waits that add up past the grace period.** `preStop` plus the drain delay plus the forced-exit timer must be less than `terminationGracePeriodSeconds`, and that grace includes `preStop`. Otherwise SIGKILL cuts the drain short.
- **`npm start` as PID 1.** SIGTERM goes to PID 1. Run `node` directly, or use an init such as tini.
- **A heap bigger than the memory limit.** `--max-old-space-size` above the limit turns a heap error you can log into a silent SIGKILL, exit 137. With no flag, the default heap is only about half the limit.
- **CPU utilisation on the HPA with no CPU request.** Utilisation is a percentage of the request, so there is nothing to divide by.
- **`replicas` in the Deployment fighting the HPA.** Every `kubectl apply` resets the count, and the HPA scales it back. The HPA docs say to remove `spec.replicas` once an HPA is enabled. On an existing Deployment, the first apply without it falls back to 1 Pod once, so do that step with care.
- **kubeconform without `-strict`.** A misspelled field such as `readinessprobe` can pass and then be dropped, leaving the Pod with no readiness probe.
- **Expecting a ConfigMap edit to reach environment variables.** It does not, until the Pods restart.
- **Secrets in git.** Base64 in a Secret is encoding, not encryption. The manifest in the example is a placeholder.

## Best practices

- **Three endpoints.** Startup and liveness use a cheap `/healthz`. Readiness uses `/readyz`, checks critical dependencies, and returns 503 from the first moment of shutdown.
- **Write the shutdown budget down.** A 5 second `preStop` sleep plus a 20 second forced-exit timer stays under a 30 second `terminationGracePeriodSeconds`. Log each drain step.
- **Set the heap from the limit.** `--max-old-space-size` at about 75% of the memory limit, or `--max-old-space-size-percentage=75` on Node 24.6.0 and later. Log `v8.getHeapStatistics().heap_size_limit` at startup.
- **Set memory request equal to memory limit.** Set a CPU request. Add a CPU limit only after you have measured the throttling.
- **`maxSurge: 1` and `maxUnavailable: 0`** when the service must not lose capacity during a rollout, and `minReplicas` of at least 2 on the HPA.
- **Validate in CI** with `kubeconform -strict -summary` and your cluster's Kubernetes version, plus a server-side dry run before production.
- **Pin image tags and name ports.** Config belongs in ConfigMaps. Real secrets belong in a secret manager.
- **Let the HPA own the replica count.** Leave `spec.replicas` out of a Deployment that an HPA scales.

## ⭐ Interview lens

> **Q: “Liveness, readiness and startup probes: what does each do, and what should each check in a Node app?”**  
> A: The kubelet runs three probes. Startup means the process has finished booting. Until it succeeds, liveness and readiness do not run, so a slow start is not killed. Its budget is `failureThreshold` times `periodSeconds`. In this lesson that is 30 failures at 2 seconds, about 60 seconds, on `GET /healthz`. Liveness means the process is stuck. A failure restarts the container, so the check must be only the process and the event loop: a cheap `/healthz` with no database call. This lesson runs it every 10 seconds with a 2 second timeout and 3 failures, so a blocked loop of about 30 seconds gets restarted. Readiness means the Pod should receive traffic. A failure removes it from the Service's endpoints and does not restart it, and the probe keeps running for the Pod's whole life. `/readyz` may check critical dependencies, and it must return 503 as soon as shutdown starts so the Pod leaves the Service. For example, a slow database should fail readiness on every Pod and must not fail liveness, or you restart the whole tier at once. The limit is the default timeout of 1 second. A garbage-collection pause on Node can miss it, and three misses restart a healthy process.

> **Q: “Walk me through what happens to a Pod during a rolling update, and how the Node app should behave.”**  
> A: On a template change the Deployment starts a new ReplicaSet and moves Pods within `maxSurge` and `maxUnavailable`. This lesson uses surge 1 and unavailable 0, so it adds one new Pod, waits until readiness passes, then deletes one old Pod, and never goes below the replica count. Deleting a Pod marks it terminating. At the same time the control plane sets the endpoint not ready, and the kubelet runs `preStop`, then sends SIGTERM to PID 1. Endpoint updates take a moment to reach kube-proxy and the Ingress controller, so new connections still arrive. A `preStop` sleep of 5 seconds keeps the app serving normally during that gap. The sleep action is run by the kubelet, so a distroless image does not need a `sleep` binary. On SIGTERM the app sets `/readyz` to 503, calls `server.close()`, closes idle keep-alive sockets, finishes in-flight requests, closes pools, and exits 0. `DRAIN_DELAY_MS` is 0 here so it does not add a second wait on top of `preStop`. A forced-exit timer of 20 seconds fires if something hangs. `terminationGracePeriodSeconds` defaults to 30 and includes `preStop`, so 5 plus 20 stays inside it. After that the runtime sends SIGKILL. For example, with 3 replicas the total goes 3, then 4 while the new Pod starts, then back to 3 after the old one drains. The limit is a readiness check that returns 200 before the database is connected. You then roll healthy Pods out and broken Pods in. Run `node` as PID 1, not `npm start`, or SIGTERM hits the wrong process.

> **Q: “A container has a 512Mi memory limit. How does that interact with the Node heap?”**  
> A: The memory limit is a cgroup limit on the whole process: the V8 heap, Buffers, compiled code, thread stacks, and native libraries. The scheduler uses the request, which this lesson sets equal to the limit, 512Mi, so the node reserves that much. V8 has a separate ceiling, `heap_size_limit`. On Node 24 it reads the cgroup. `process.constrainedMemory()` returned 536870912 under a 512 MiB limit, and with no flag the heap stopped at 259 MiB, about half, while roughly 200 MiB was still free. Crossing the heap limit aborts with "JavaScript heap out of memory" and exit code 134. Set `--max-old-space-size` to about 75% of the limit, 384 of 512, which measured a heap limit of 387 MiB and still left room off-heap. `--max-old-space-size-percentage=75`, added in v24.6.0, follows the cgroup rather than the host, and the docs say it wins if both flags are set. For example, 384 MiB of heap plus buffers stayed under 512 and still printed V8's fatal error, which you can log. The limit of setting the heap to 4096 under a 512 MiB cgroup is that V8 never hits its own ceiling. The kernel sends SIGKILL, exit 137, which is 128 plus signal 9, with no JavaScript stack. Kubernetes shows that as `OOMKilled`. CPU is different: over a CPU limit you are throttled, not killed.

> **Q: “How does the HPA decide how many Pods to run?”**  
> A: The HorizontalPodAutoscaler controller runs every 15 seconds by default. It reads the metric from `metrics.k8s.io`, usually provided by Metrics Server, which is a separate add-on. CPU utilisation is a percentage of the Pod's CPU request, not of the node's size, so a Deployment with no CPU request cannot be scaled on CPU. The desired count is `ceil(current replicas times current utilisation divided by the target)`. Three Pods at 140% of a 250m request, with a target of 70%, become `ceil(3 × 140 / 70)`, which is 6. Six Pods at 35% become `ceil(6 × 35 / 70)`, which is 3, and only after the scale-down window. Scale-up has no stabilisation window by default and may add 4 Pods or double the current count every 15 seconds, whichever is more. Scale-down waits 300 seconds and uses the highest recommendation in that window, so a short dip does not remove Pods. For example, `minReplicas: 3` keeps enough Pods for `maxUnavailable: 0` to roll one at a time and still survive a node failure. The limit is leaving `spec.replicas` in the Deployment. The next `kubectl apply` resets the count to the file, the HPA fights it back, and removing the field from an existing Deployment can fall back to 1 Pod on the first apply. Let the HPA own the number.

## Cheat-card

- **Objects:** Pod, then ReplicaSet, then Deployment, then HPA. A Service selects ready Pods. Ingress routes to a Service. The Ingress API is frozen. Gateway API is the recommendation. ConfigMap and Secret feed env vars, and a restart is required to pick up changes.
- **Probes:** startup gates the other two. Liveness restarts. Readiness removes traffic and keeps running. A database check belongs on readiness.
- **Shutdown:** terminating, endpoint not ready, and `preStop`, then SIGTERM to PID 1, then 503 and `server.close()` and drain, then exit 0. SIGKILL when `terminationGracePeriodSeconds` ends. The default is 30 seconds and includes `preStop`.
- **This lesson's budget:** `preStop` sleep 5 seconds, forced exit 20 seconds, grace 30 seconds, `DRAIN_DELAY_MS` 0.
- **Limits:** CPU over the limit is throttled. Memory over the limit is SIGKILL, exit 137, status `OOMKilled`.
- **Heap on Node 24 under a cgroup:** the default is about half the limit, 259 MiB of 512. `--max-old-space-size=384` measured 387 MiB. A heap above the limit is a kernel kill, not a V8 error.
- **HPA:** `ceil(current × actual / target)`, a 15 second loop, a 300 second scale-down window, Metrics Server, and CPU requests.
- **Rollout:** `maxSurge` and `maxUnavailable` default to 25%. `1` and `0` never goes below `replicas`. A new Pod counts once it is ready.
- **Run `node` as PID 1,** not `npm start`.

## Good to know

- **Probe defaults from the docs:** `initialDelaySeconds` 0, and if a startup probe exists the other delays wait until it succeeds. `periodSeconds` 10, minimum 1. `timeoutSeconds` 1. `successThreshold` 1, and it must be 1 for liveness and startup. `failureThreshold` 3. Startup budget is `failureThreshold` times `periodSeconds`.
- **`preStop` `sleep`:** stable in Kubernetes 1.34, beta and on by default from 1.30. The kubelet runs it, so the image needs no `sleep` binary. Older clusters use `exec` of `["sleep", "5"]`, which needs the binary.
- **Heap measurements on Node v24.19.0:** no cgroup limit, on a 15 GiB machine, `process.constrainedMemory()` was 18446744073709552000 and `heap_size_limit` was 2240 MiB.
- **512 MiB limit, no flag:** `constrainedMemory` 536870912, heap 259 MiB.
- **1 GiB limit, no flag:** `constrainedMemory` 1073741824, heap 560 MiB.
- **2 GiB limit, no flag:** `constrainedMemory` 2147483648, heap 1120 MiB.
- **512 MiB and `--max-old-space-size=384`:** `constrainedMemory` 536870912, heap 387 MiB.
- **512 MiB and `--max-old-space-size-percentage=75`:** `constrainedMemory` 536870912, heap 387 MiB. The percentage flag was added in v24.6.0 and takes precedence over `--max-old-space-size` when both are set.
- **512 MiB and `--max-old-space-size=4096`:** `constrainedMemory` 536870912, heap 4099 MiB, then the kernel kills the process.
- **What those runs printed:** the default heap stopped at 259 MiB with exit 134 while about 200 MiB of the cgroup was still free. `--max-old-space-size=384` reached about 388 MiB RSS 431 and still exited 134 with V8's fatal line. `--max-old-space-size=4096` exited 137 with no message from Node.
- **Offline checks:** `kubeconform -strict -summary -kubernetes-version 1.37.1`. `kubectl apply --dry-run=client` needs a reachable API server even with `--validate=false`. `kubectl label --local -f dir/ k=v -o name` only parses.
- **Versions used:** Node v24.19.0, Express 5.3.0, kubectl v1.37.1, kubeconform v0.8.0, undici 7.29.0 bundled, systemd 259. No cluster was available. The kill under a 512 MiB limit was reproduced with `systemd-run`, not with a kubelet.

---

## Learn More

- [Liveness, Readiness, and Startup Probes kubernetes.io](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/)
- [Configure Liveness, Readiness and Startup Probes kubernetes.io](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
- [Pod Lifecycle: termination of Pods kubernetes.io](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/)
- [Container Lifecycle Hooks (preStop, sleep) kubernetes.io](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/)
- [Resource Management for Pods and Containers kubernetes.io](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Horizontal Pod Autoscaling kubernetes.io](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)
- [Deployments: rolling update strategy kubernetes.io](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)
- [Ingress kubernetes.io](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [Node.js CLI: --max-old-space-size-percentage nodejs.org](https://nodejs.org/docs/latest-v24.x/api/cli.html)
- [kubeconform github.com](https://github.com/yannh/kubeconform)
