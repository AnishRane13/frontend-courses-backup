---
title: "dns: lookup vs resolve"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# dns: lookup vs resolve

*16 min read · Updated 10 Oct 2026 · Topic 81 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Say it in 30 seconds

`dns.lookup` asks the operating system to turn a host name into an address, on a worker thread, the same way `ping` and `curl` do. `dns.resolve` and its siblings send DNS queries themselves from the main thread and never read the hosts file. Node has both because connecting to a service should follow the machine's name rules, while mail records and a chosen DNS server are a different job. The trade-off is that `lookup` shares a small thread pool with file and crypto work, so a busy pool makes new connections wait, and Node itself does not cache either answer.

## Why it matters

Every `fetch`, `http.get`, `net.connect({ host })`, and database driver turns a host name into an IP before it opens a socket. Node has two machines for that job in one module. `dns.lookup()` asks the operating system and runs on the libuv thread pool. `dns.resolve` and the other `resolve*` functions send DNS packets from the event loop. They can disagree on the same name, they fail differently, and only `lookup` competes with `fs`, `crypto`, and `zlib` for the four pool threads.

That shows up as real incidents. Password hashing with `crypto.pbkdf2` makes outgoing HTTP slow, because `lookup` waits behind the hashes. A name in `/etc/hosts` works with `curl` and `fetch` and fails with `dns.resolve4`. One dropped UDP packet turns a 20 ms lookup into about 5 seconds. Node does not cache lookups, so a client that connects per request pays for the name every time.

## The concept, simply

`dns.lookup(hostname, options, callback)` calls the C function `getaddrinfo`. That is the path `ping`, `curl`, and most other programs use. On Linux with glibc it follows `/etc/nsswitch.conf`. The `hosts` line usually says `files` then `dns`: `/etc/hosts` first, then the servers in `/etc/resolv.conf`. `getaddrinfo` blocks, so Node runs it on a libuv pool thread. The default pool has 4 threads, set with `UV_THREADPOOL_SIZE`. `net`, `http`, `https`, `fetch`, `tls`, and `dgram` all use `lookup()` by default.

`dns.resolve4`, `resolve6`, `resolveMx`, the rest of `resolve*`, and `dns.reverse` use c-ares, a DNS library bundled with Node. c-ares builds query packets, sends them by UDP, or by TCP when the answer is large, to the servers from `/etc/resolv.conf` or from `setServers()`, and libuv watches those sockets. No pool thread is used. `/etc/hosts` is never read. Search domains from `resolv.conf` are not appended. These functions can ask for record types `getaddrinfo` cannot: MX, TXT, SRV, NS, CAA, SOA, and more.

![Two columns: work the kernel does asynchronously, including dns.resolve() via c-ares, and work that occupies a thread-pool slot, including dns.lookup() via getaddrinfo](assets/i04_02_51406ab8.svg)
*Figure: which Node APIs use the kernel's async I/O and which occupy one of the four thread-pool threads. Look at: `dns.resolve() (uses c-ares)` in the kernel column and `dns.lookup() (getaddrinfo)` in the thread-pool column, next to `crypto.pbkdf2`, which is what Example 3 uses to fill the pool.*

## How it works

1. `dns.lookup('api.example.com')` queues `getaddrinfo` on the libuv thread pool. If every pool thread is busy, the call waits.
2. A pool thread runs `getaddrinfo`. glibc reads `nsswitch.conf` and tries each source: `files` (`/etc/hosts`), sometimes multicast DNS for `.local`, then `dns`. The DNS source sends A and AAAA queries, waits `timeout` seconds per try (default 5), and tries `attempts` times (default 2). On Ubuntu that server is often `127.0.0.53`, the systemd-resolved stub, which caches and forwards misses.
3. glibc sorts results with the RFC 3484 rules, which `/etc/gai.conf` can change. Node then applies `order`. The default `verbatim` keeps glibc's order. The callback gets the first address, or every address when `all: true`.
4. `dns.resolve4('api.example.com')` sends one A query from the main thread. When the answer arrives, c-ares parses it. `{ ttl: true }` includes the record TTL, the time the answer may be cached. If nothing comes back, c-ares resends, up to `tries` (default 4), then fails with `ETIMEOUT`.
5. With several addresses, `net.connect` can try them in turn. `autoSelectFamily` has been on by default since v20.0.0. It alternates IPv6 and IPv4 and gives each attempt 250 ms. That is Happy Eyeballs, RFC 8305.

One name, from your call to the server that owns it:

text

```
 dns.lookup('api.example.com')                    dns.resolve4('api.example.com')
        │ queue on libuv thread pool (4 threads)          │ c-ares, on the main thread
        ▼                                                 │ (no /etc/hosts, no search list)
 getaddrinfo(3) in a pool thread                          │
        │ /etc/nsswitch.conf  "hosts: files … dns"        │
        ├─► files: /etc/hosts ── match? done              │
        └─► dns: /etc/resolv.conf (timeout:5 attempts:2)  │ servers from resolv.conf
                  │                                       │ or resolver.setServers()
                  ▼                                       ▼
           stub resolver, e.g. systemd-resolved 127.0.0.53 (local cache)
                  │ cache miss
                  ▼
           recursive resolver (home router, ISP, 1.1.1.1, VPC DNS)  ── cache by TTL
                  │ cache miss
                  ▼
           root servers ─► .com TLD servers ─► example.com authoritative servers
                  │
                  ▼
           answer (A / AAAA records + TTL) travels back up the same chain
```

**Where the answer comes from.** On the machine used for these examples, Ubuntu with systemd-resolved, `/etc/hosts` maps `localhost` to `127.0.0.1` only, so `lookup('localhost')` returns only that. `resolve6('localhost')` asks `127.0.0.53`, and systemd-resolved synthesizes `::1`. `resolvectl query localhost` labels those records synthetic. A public resolver such as `1.1.1.1` knows neither name and answers `ENOTFOUND`. That is the proof `resolve*` does not read `/etc/hosts`.

**Caching.** The Node docs say `resolve*` always performs a DNS query on the network, and `lookup` hands every call to `getaddrinfo`. Example 4 shows four `resolve4` calls to `1.1.1.1` sent four packets. Caching lives outside Node: a local stub such as systemd-resolved, nscd, or dnsmasq, and the recursive resolver. A minimal container with no stub sends every `lookup` over the network. An in-process cache, an HTTP agent's connection pool, or a caching `lookup` passed to `net.connect` or `http.Agent` is how you avoid repeating it.

**IPv4 and IPv6.** `family` is `4`, `6`, or `0` for any. `all: true` returns every address. `order` is `'verbatim'`, `'ipv4first'`, or `'ipv6first'`. The default order is `verbatim`, since v17.0.0. Before that, Node put IPv4 first, so moving to v17 made some `localhost` clients hit `::1` and get `ECONNREFUSED` from a server bound only to `127.0.0.1`. Happy Eyeballs hides most of those by trying the next address after 250 ms (`autoSelectFamilyAttemptTimeout`).

**Why DNS shows up as latency.** A cache miss walks from the root to the authoritative server and can take tens or hundreds of milliseconds. DNS is mostly UDP, so one lost packet costs a full retry. glibc's default `timeout` of 5 seconds is why "exactly 5 seconds slower" is a classic DNS symptom. Example 7 reproduces it. `lookup` also waits for a free pool thread, behind `fs`, `pbkdf2`, `scrypt`, and `zlib`. A name with fewer dots than `ndots` (default 1) is tried with each search domain appended. Kubernetes pods often use `ndots: 5`, so a name like `api.example.com` is tried inside the cluster first, and every miss adds a round trip. An AAAA answer you cannot route costs a connect timeout unless Happy Eyeballs moves on.

## Code examples

Examples that query real names were run on 10 Oct 2026 from a home network behind systemd-resolved. Addresses, TTLs, and timings will differ. Examples 3, 6, and 7 stay local, and Example 6 replaces DNS with a fixed `lookup`.

**Example 1: the same name through `lookup`, `resolve*`, and a public resolver.**

javascript

```
import dns from 'node:dns/promises';

// A Resolver that skips this machine's stub resolver and asks a public server
const publicDns = new dns.Resolver();
publicDns.setServers(['1.1.1.1']);

const show = async (label, promise) => {
  try { console.log(label.padEnd(34), JSON.stringify(await promise)); }
  catch (err) { console.log(label.padEnd(34), err.code); }
};

for (const name of ['localhost', 'ip6-localhost']) {
  await show(`lookup('${name}', all)`, dns.lookup(name, { all: true }));
  await show(`resolve4('${name}')`, dns.resolve4(name));
  await show(`resolve6('${name}')`, dns.resolve6(name));
  await show(`1.1.1.1 resolve6('${name}')`, publicDns.resolve6(name));
}
console.log('resolve*() asks:', dns.getServers(), '| c-ares', process.versions.ares);

// Real output (Node v24.19.0):
//   lookup('localhost', all)           [{"address":"127.0.0.1","family":4}]
//   resolve4('localhost')              ["127.0.0.1"]
//   resolve6('localhost')              ["::1"]
//   1.1.1.1 resolve6('localhost')      ENOTFOUND
//   lookup('ip6-localhost', all)       [{"address":"::1","family":6}]
//   resolve4('ip6-localhost')          ENODATA
//   resolve6('ip6-localhost')          ["::1"]
//   1.1.1.1 resolve6('ip6-localhost')  ENOTFOUND
//   resolve*() asks: [ '127.0.0.53' ] | c-ares 1.34.6
```

`lookup('localhost')` returned only `127.0.0.1` because that is all `/etc/hosts` lists. `resolve6('localhost')` returned `::1`, which systemd-resolved made up. `1.1.1.1` has neither name. `resolve4('ip6-localhost')` returned `ENODATA`: the stub knows the name and has no A record.

**Example 2: `strace` shows who reads `/etc/hosts`, and on which thread.**

javascript

```
const dns = require('node:dns');
console.log('main thread id =', process.pid);
dns.lookup('ip6-localhost', (err, address) => console.log('lookup ->', address));
```

bash

```
$ strace -f -e trace=openat,connect node trace-lookup.cjs 2>&1 | grep -E 'hosts|htons\(53\)|->|main thread'
main thread id = 714341
[pid 714363] openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 21
lookup -> ::1
```

`trace-resolve.cjs` is the same script with `dns.resolve6('ip6-localhost', …)` instead of `lookup`:

bash

```
$ strace -f -e trace=openat,connect node trace-resolve.cjs 2>&1 | grep -E 'hosts|htons\(53\)|->|main thread'
main thread id = 714374
[pid 714374] connect(21, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0
resolve6 -> [ '::1' ]
```

`lookup` opened `/etc/hosts` from a pool thread and found `::1` without a packet. `resolve6` never opened `/etc/hosts`. It sent UDP to port 53 of the stub from the main thread. Thread ids change every run.

This machine's `/etc/resolv.conf` has `search lan`, and a single-label name has fewer dots than `ndots` (1):

javascript

```
const dns = require('node:dns');
// a single-label name: fewer dots than ndots (1), so search domains apply
dns.lookup('nosuchhostzz', (err) => {
  console.log('lookup   ->', err.code);
  dns.resolve4('nosuchhostzz', (err2) => console.log('resolve4 ->', err2.code));
});
```

bash

```
$ strace -f -e trace=sendto,sendmmsg node trace-search.cjs 2>&1 | grep -oE '"[^"]*nosuchhostzz[^"]*"|(lookup|resolve4) +-> [A-Z_]+' | sed -E 's/^"[^"]*\\fnosuchhostzz/query: nosuchhostzz/; s/\\0\\0\\1.*/ (A)/; s/\\0\\0\\34.*/ (AAAA)/; s/\\3lan/.lan/'
query: nosuchhostzz.lan (A)
query: nosuchhostzz.lan (AAAA)
query: nosuchhostzz (A)
query: nosuchhostzz (AAAA)
query: nosuchhostzz (A)
query: nosuchhostzz (AAAA)
lookup   -> EAI_AGAIN
query: nosuchhostzz (A)
resolve4 -> EREFUSED
```

`getaddrinfo` queried `nosuchhostzz.lan` and then the bare name: six packets for one `lookup`. `resolve4` sent one A query for the exact name. The stub refused the single-label query. `lookup` reports `EAI_AGAIN`. c-ares reports `EREFUSED`.

**Example 3: a full thread pool slows `lookup` and not `resolve4`.**

javascript

```
import dns from 'node:dns';
import crypto from 'node:crypto';

const ms = (t0) => `${Math.round(performance.now() - t0)} ms`;
const time = (label, fn) => new Promise((resolve) => {
  const t0 = performance.now();
  fn((err, result) => { console.log(`${label.padEnd(30)} ${ms(t0).padStart(7)}  ${err ? err.code : JSON.stringify(result)}`); resolve(); });
});

// Warm up both paths once so first-call setup is not measured
await time('warm-up lookup', (cb) => dns.lookup('localhost', cb));
await time('warm-up resolve4', (cb) => dns.resolve4('localhost', cb));

console.log('--- idle thread pool');
await time('lookup("localhost")', (cb) => dns.lookup('localhost', cb));
await time('resolve4("localhost")', (cb) => dns.resolve4('localhost', cb));

console.log(`--- 4 pbkdf2 jobs occupy the ${process.env.UV_THREADPOOL_SIZE ?? 4} pool threads`);
const t0 = performance.now();
let done = 0;
for (let i = 0; i < 4; i++) {
  crypto.pbkdf2('pw', 'salt', 1_000_000, 64, 'sha512', () => {
    if (++done === 4) console.log(`${'(all 4 pbkdf2 jobs done)'.padEnd(30)} ${ms(t0).padStart(7)}`);
  });
}
await Promise.all([
  time('lookup("localhost")', (cb) => dns.lookup('localhost', cb)),
  time('resolve4("localhost")', (cb) => dns.resolve4('localhost', cb)),
]);

// Real output (Node v24.19.0):
//   warm-up lookup                   12 ms  "127.0.0.1"
//   warm-up resolve4                  1 ms  ["127.0.0.1"]
//   --- idle thread pool
//   lookup("localhost")               3 ms  "127.0.0.1"
//   resolve4("localhost")             1 ms  ["127.0.0.1"]
//   --- 4 pbkdf2 jobs occupy the 4 pool threads
//   resolve4("localhost")             0 ms  ["127.0.0.1"]
//   lookup("localhost")             847 ms  "127.0.0.1"
//   (all 4 pbkdf2 jobs done)       1197 ms
```

With an idle pool both calls took a few milliseconds. With four `pbkdf2` jobs holding the four pool threads, `resolve4` still answered in about 1 ms and `lookup` waited about 0.9 s. Five runs of that wait landed between 847 ms and 926 ms. `UV_THREADPOOL_SIZE=8` brought `lookup` back to 1 ms, because four threads were free. Every `http.get`, `fetch`, and `net.connect({ host })` takes this path.

**Example 4: Node does not cache.**

javascript

```
import dns from 'node:dns/promises';

const name = process.argv[2] ?? 'nodejs.org';
async function timed(label, fn) {
  const row = [];
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    await fn();
    row.push(`${(performance.now() - t0).toFixed(1)} ms`);
  }
  console.log(label.padEnd(36), row.join('  '));
}

const remote = new dns.Resolver();
remote.setServers(['1.1.1.1']);            // a public resolver: no cache on this host

await timed(`lookup('${name}')`, () => dns.lookup(name));
await timed(`resolve4('${name}') via 127.0.0.53`, () => dns.resolve4(name));
await timed(`resolve4('${name}') via 1.1.1.1`, () => remote.resolve4(name));
console.log('TTL seen by 1.1.1.1:', (await remote.resolve4(name, { ttl: true }))[0].ttl, 's');

// Real output (Node v24.19.0):
//   lookup('nodejs.org')                 66.9 ms  4.1 ms  1.2 ms  1.2 ms
//   resolve4('nodejs.org') via 127.0.0.53 1.1 ms  0.6 ms  0.5 ms  0.4 ms
//   resolve4('nodejs.org') via 1.1.1.1   50.3 ms  2050.1 ms  39.1 ms  39.9 ms
//   TTL seen by 1.1.1.1: 80 s
```

The first `lookup` hit the network. The next three were a few milliseconds because systemd-resolved cached the answer. `resolve4` through `1.1.1.1` paid a round trip every time: three calls took 39 to 50 ms, and one took 2050 ms.

> ⚠️ Unverified: the cause of the single 2050 ms call in the timing run above. The packets of that run were not captured, so a lost UDP packet followed by a c-ares retry is the likely explanation, not a proven one.

Counting packets:

javascript

```
const { Resolver } = require('node:dns').promises;
const r = new Resolver(); r.setServers(['1.1.1.1']);
(async () => { for (let i = 0; i < 4; i++) await r.resolve4('example.net'); console.log('4 resolve4 calls done'); })();
```

bash

```
$ strace -f -e trace=sendto node d3b.cjs 2>&1 | grep -c 'example\\3net'
4
```

Four calls, four DNS query packets.

**Example 5: `family`, `all`, and `order`.**

javascript

```
import dns from 'node:dns/promises';

const host = 'nodejs.org';
const short = (list) => list.map((a) => `${a.address} (v${a.family})`).join(', ');
console.log('default order:', dns.getDefaultResultOrder());
for (const order of ['verbatim', 'ipv4first', 'ipv6first']) {
  console.log(`${order.padEnd(9)} ->`, short(await dns.lookup(host, { all: true, order })));
}
console.log('family: 4  ->', short(await dns.lookup(host, { all: true, family: 4 })));
console.log('family: 6  ->', short(await dns.lookup(host, { all: true, family: 6 })));
console.log('no all     ->', await dns.lookup(host));   // only the first address

// Real output (Node v24.19.0):
//   default order: verbatim
//   verbatim  -> 104.16.212.131 (v4), 104.16.213.131 (v4), 2606:4700:8ca1:a0e6:9a7:a9b:6810:d483 (v6)
//   ipv4first -> 104.16.213.131 (v4), 104.16.212.131 (v4), 2606:4700:8ca1:a0e6:9a7:a9b:6810:d483 (v6)
//   ipv6first -> 2606:4700:8ca1:a0e6:9a7:a9b:6810:d483 (v6), 104.16.212.131 (v4), 104.16.213.131 (v4)
//   family: 4  -> 104.16.212.131 (v4), 104.16.213.131 (v4)
//   family: 6  -> 2606:4700:8ca1:a0e6:9a7:a9b:6810:d483 (v6)
//   no all     -> { address: '104.16.213.131', family: 4 }
```

bash

```
$ node --dns-result-order=ipv4first -e "require('node:dns').promises.lookup('nodejs.org').then((a) => console.log(require('node:dns').getDefaultResultOrder(), a))"
ipv4first { address: '104.16.212.131', family: 4 }
```

`verbatim` kept glibc's order. Here glibc put IPv4 first. The two IPv4 addresses swap between calls because the DNS server rotates them. `ipv6first` and `ipv4first` sort by family and keep the order inside each family. Without `all`, you get only the first address, so `order` picks the family.

**Example 6: Happy Eyeballs tries the next address.**

A fixed `lookup` stands in for DNS. `dual.test` gets `::1` where nothing listens, `10.255.255.1` which never answers, and the real server at `127.0.0.1`.

javascript

```
import net from 'node:net';
import { once } from 'node:events';

console.log('autoSelectFamily default:', net.getDefaultAutoSelectFamily(),
  '| attempt timeout:', net.getDefaultAutoSelectFamilyAttemptTimeout(), 'ms');

// A server that listens on IPv4 loopback only
const server = net.createServer((s) => s.end()).listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

// A stand-in for DNS, so the run does not depend on the network:
// "dual.test" gets an AAAA record (::1, where nothing listens) and two A records.
// 10.255.255.1 is a private address that nobody answers on this network,
// so that attempt hangs instead of failing fast.
function fakeLookup(hostname, options, cb) {
  const all = [
    { address: '::1', family: 6 },
    { address: '10.255.255.1', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];
  setImmediate(() => (options.all ? cb(null, all) : cb(null, all[0].address, all[0].family)));
}

async function attempt(autoSelectFamily) {
  console.log(`--- autoSelectFamily: ${autoSelectFamily}`);
  const t0 = performance.now();
  const at = () => `${String(Math.round((performance.now() - t0) / 50) * 50).padStart(4)} ms`;
  const s = net.connect({ host: 'dual.test', port, lookup: fakeLookup, autoSelectFamily });
  s.on('connectionAttempt', (ip) => console.log(`${at()} trying ${ip}`));
  s.on('connectionAttemptFailed', (ip, p, fam, err) => console.log(`${at()} ${ip} failed: ${err.code}`));
  s.on('connectionAttemptTimeout', (ip) => console.log(`${at()} ${ip}: no answer in 250 ms, next`));
  s.on('connect', () => { console.log(`${at()} connected to ${s.remoteAddress}`); s.destroy(); });
  s.on('error', (err) => console.log(`${at()} 'error' ${err.code}`));
  await new Promise((r) => s.on('close', r));   // not once(): it rejects on 'error'
}

await attempt(true);
await attempt(false);
server.close();

// Real output (Node v24.19.0):
//   autoSelectFamily default: true | attempt timeout: 250 ms
//   --- autoSelectFamily: true
//      0 ms trying ::1
//      0 ms ::1 failed: ECONNREFUSED
//      0 ms trying 10.255.255.1
//    250 ms 10.255.255.1: no answer in 250 ms, next
//    250 ms trying 127.0.0.1
//    250 ms connected to 127.0.0.1
//   --- autoSelectFamily: false
//      0 ms trying ::1
//      0 ms ::1 failed: ECONNREFUSED
//      0 ms 'error' ECONNREFUSED
```

With `autoSelectFamily: true`, the default since v20.0.0, `::1` was refused at once, `10.255.255.1` was abandoned after 250 ms, and `127.0.0.1` connected. With it off, only the first address was tried and the socket failed with `ECONNREFUSED`.

**Example 7: one lost UDP packet.**

A local DNS server answers every A query with `10.0.0.7` and drops the first copy of each query.

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';
import { Resolver } from 'node:dns/promises';

// A tiny DNS server on 127.0.0.1 that answers every A query with 10.0.0.7.
// SIMULATED LOSS: it ignores the first copy of every query id, on purpose,
// so the resolver has to time out and retry (as on a lossy network).
const seen = new Set();
const server = dgram.createSocket('udp4');
server.on('message', (query, rinfo) => {
  const id = query.readUInt16BE(0);
  if (!seen.has(id)) { seen.add(id); return console.log(`  dns server: dropped the first copy of a query`); }
  const questionEnd = query.indexOf(0, 12) + 5;          // name, then QTYPE + QCLASS
  const header = Buffer.from([0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0]);
  header.writeUInt16BE(id, 0);                          // same id as the query
  const answer = Buffer.from([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 7]);
  server.send(Buffer.concat([header, query.subarray(12, questionEnd), answer]), rinfo.port, rinfo.address);
  console.log(`  dns server: answered the retry`);
});
server.bind(0, '127.0.0.1');
await once(server, 'listening');

for (const timeout of [200, 1000]) {
  const resolver = new Resolver({ timeout, tries: 3 });
  resolver.setServers([`127.0.0.1:${server.address().port}`]);
  const t0 = performance.now();
  const addrs = await resolver.resolve4('api.internal.test');
  console.log(`timeout ${timeout} ms: ${JSON.stringify(addrs)} after ${Math.round((performance.now() - t0) / 10) * 10} ms`);
}
server.close();

// Real output (Node v24.19.0):
//     dns server: dropped the first copy of a query
//     dns server: answered the retry
//   timeout 200 ms: ["10.0.0.7"] after 340 ms
//     dns server: dropped the first copy of a query
//     dns server: answered the retry
//   timeout 1000 ms: ["10.0.0.7"] after 2000 ms
```

The answer was ready in under a millisecond, and each call still took hundreds of milliseconds or seconds, because the first packet was dropped and c-ares waited for its retry. The delay was not exactly the `timeout` value (200 became about 330 to 370 ms, and 1000 became 2000 ms, over four runs). Treat `timeout` as the start of that timer, not the whole delay.

> ⚠️ Unverified: why c-ares 1.34.6 waited about 1.7–1.9× and 2× the configured `timeout` before its retry. The Node docs only describe `timeout` as "query timeout in milliseconds", and c-ares's internal retry-timer algorithm was not checked here.

glibc does the same with its own numbers. The default `timeout: 5` means one lost packet costs a `lookup` 5 seconds.

**Example 8: `dns.promises`, a private `Resolver`, and what `setServers` does not touch.**

javascript

```
import dns from 'node:dns/promises';

// 1. A private Resolver that asks public servers; the global settings stay as they are.
const resolver = new dns.Resolver({ timeout: 2000, tries: 2 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);
console.log('global servers  :', dns.getServers());
console.log('resolver servers:', resolver.getServers());

const ns = await resolver.resolveNs('nodejs.org');
console.log('NS  nodejs.org  :', ns.sort().join(', '));
const mx = await resolver.resolveMx('gmail.com');
console.log('MX  gmail.com   :', mx.sort((a, b) => a.priority - b.priority)[0]);
try {
  await resolver.resolve4('no-such-host.invalid');
} catch (err) {
  console.log('A   *.invalid   :', err.code, '(dns.NOTFOUND is', JSON.stringify(dns.NOTFOUND) + ')');
}

// 2. setServers() changes resolve*() only, never lookup()
dns.setServers(['127.0.0.1:9']);              // nothing answers DNS on port 9
const t0 = performance.now();
const r4 = await dns.resolve4('nodejs.org').catch((err) => err.code);
console.log(`resolve4 with a dead server: ${r4} after ${Math.round((performance.now() - t0) / 100) * 100} ms`);
console.log('lookup still works        :', (await dns.lookup('nodejs.org', { family: 4 })).family === 4);

// Real output (Node v24.19.0):
//   global servers  : [ '127.0.0.53' ]
//   resolver servers: [ '1.1.1.1', '8.8.8.8' ]
//   NS  nodejs.org  : meera.ns.cloudflare.com, pablo.ns.cloudflare.com
//   MX  gmail.com   : { exchange: 'gmail-smtp-in.l.google.com', priority: 5, type: 'MX' }
//   A   *.invalid   : ENOTFOUND (dns.NOTFOUND is "ENOTFOUND")
//   resolve4 with a dead server: ECONNREFUSED after 0 ms
//   lookup still works        : true
```

`new dns.Resolver()` has its own server list, so `setServers(['1.1.1.1', '8.8.8.8'])` changed nothing global. `resolveNs` and `resolveMx` return record types `lookup` cannot. A name under `.invalid` fails with `ENOTFOUND`, the value of `dns.NOTFOUND`. `dns.setServers(['127.0.0.1:9'])` broke `resolve4` at once with `ECONNREFUSED`, because port 9 has no DNS server, and `lookup` kept working. `setServers` only affects `resolve*` and `reverse`.

## Common mistakes & gotchas

- **Treating `resolve*` as a faster `lookup`.** It skips `/etc/hosts`, other nsswitch sources such as mDNS, and search domains. Names that work everywhere else can fail: Docker `--add-host`, `.local`, or a short name like `db`.
- **Forgetting `lookup` shares the thread pool.** `pbkdf2`, `scrypt`, `zlib`, and `fs` delay every connection by name (Example 3). Raise `UV_THREADPOOL_SIZE` before the process starts, or move CPU work to worker threads.
- **Setting `process.env.UV_THREADPOOL_SIZE` inside the program.** The pool may already exist. Set it in the environment that starts `node`.
- **Expecting Node to cache DNS.** It does not (Example 4). Without a local stub, every new connection by name is a network round trip.
- **Calling `dns.setServers()` to change where `fetch` or `http` resolves.** They use `lookup`, which `setServers` does not affect. Pass a custom `lookup` to `net.connect`, `http.Agent`, or undici's `connect` options.
- **Assuming `localhost` means `127.0.0.1`.** With `verbatim` order, the default since v17, it can be `::1` first. Bind and connect to an explicit address in tests.
- **Reading `ENOTFOUND` as "the name does not exist".** `lookup` also reports `ENOTFOUND` for other failures, such as running out of file descriptors.
- **Ignoring TTLs on pooled connections.** A pooled socket keeps the IP it resolved at connect time. Recycle connections so a DNS failover takes effect.

## Best practices

- **Use `lookup`, the default, when you are connecting,** so names resolve the way the rest of the system does. Use `resolve*` for MX, TXT, SRV, TTLs, or a specific server.
- **Keep the pool free for `lookup`** when you open many connections. Move hashing to workers, or raise `UV_THREADPOOL_SIZE`.
- **Reuse connections** so DNS is paid once per connection, not once per request.
- **Run a caching stub** next to services that resolve often, and keep the resolver timeout short.
- **Lower `ndots`, or use a trailing dot on external names,** inside Kubernetes, so search domains are not tried first.
- **Leave `autoSelectFamily` on.** When a server is IPv4-only, bind and connect to `127.0.0.1` rather than `localhost`.
- **Use `dns.promises` and a private `Resolver`** when you must query specific servers. Do not call `setServers` while queries are in flight.

## ⭐ Interview lens

> **Q: “What is the difference between `dns.lookup()` and `dns.resolve4()`?”**  
A: `dns.lookup` calls the operating system's `getaddrinfo` on a libuv thread-pool thread. It honors `/etc/hosts`, `nsswitch.conf`, and the system resolver, which is why `ping` and `curl` agree with it. `net`, `http`, and `fetch` use it when you pass a host name. `dns.resolve4` uses the bundled c-ares library on the main thread. It sends a real DNS query to the configured servers, ignores `/etc/hosts`, and can ask for record types `getaddrinfo` cannot, such as MX or TXT. On a machine where `/etc/hosts` lists only `127.0.0.1` for localhost, `lookup` returns that and `resolve6` can still return `::1` from a local stub. The limit is the pool. Only `lookup` waits behind `fs`, `crypto`, and `zlib` for one of the four default threads. `resolve4` does not.

> **Q: “Outgoing HTTP calls slow down whenever the service hashes a lot of passwords. Why?”**  
A: `crypto.pbkdf2` and `dns.lookup` share the libuv thread pool, four threads unless you set `UV_THREADPOOL_SIZE` before startup. Hashing holds those threads, so every `lookup` for a new connection sits in the queue. In the lesson's run, four hashes made `lookup` wait about 0.9 seconds while `resolve4` still returned in about 1 ms, because c-ares does not use the pool. Outgoing `fetch`, `http.get`, and `net.connect({ host })` all call `lookup`. Raise the pool size in the environment that starts Node, move the hashing to worker threads, or reuse connections so you resolve once. The limit of "just switch to `resolve4`" is that it skips `/etc/hosts` and search domains, so a name the rest of the machine can open may fail.

> **Q: “Does Node cache DNS results?”**  
A: No. Each `lookup` calls `getaddrinfo`, and each `resolve*` sends a query. The Node docs say the resolve functions always query the network. Example 4 sent four queries to `1.1.1.1` for four calls, and none of them were served from inside Node. A local stub such as systemd-resolved can make the second call look instant, and the recursive resolver caches by TTL. You can also pass a caching `lookup` function, or hold connections in a pool so you do not resolve per request. The limit is a long-lived socket. It keeps the address it got when it connected, even after the DNS record changes, until you recycle it.

> **Q: “Some requests take exactly 5 seconds longer than usual. What do you suspect?”**  
A: Suspect a lost DNS packet. glibc's resolver waits `timeout` seconds, 5 by default, before it retries a UDP query, so the request is fine and then exactly five seconds late. The same stall happens when the first nameserver in `/etc/resolv.conf` does not answer: glibc waits out that timeout before it tries the next server. Example 7 dropped the first packet on purpose and the call waited on c-ares's retry timer even though the answer itself was ready in under a millisecond. Check `resolv.conf`, run a caching stub, and shorten the timeout. The limit is that five seconds is glibc's number. c-ares, which `resolve*` uses, has its own timeout and retry count, so the spike may be a different length on that path.

## Cheat-card

- **`lookup`:** `getaddrinfo` on the thread pool. `/etc/hosts`, nsswitch, and resolv.conf. Used by `net`, `http`, and `fetch`. Options: `family`, `all`, `order`, `hints`.
- **`resolve*`:** c-ares on the main loop. Real DNS queries. Ignores `/etc/hosts`. Any record type. `{ ttl: true }` on A and AAAA.
- **Pool:** 4 threads, shared with `fs`, `crypto.pbkdf2`, `scrypt`, `randomBytes`, and `zlib`. Set `UV_THREADPOOL_SIZE` before start.
- **Cache:** none in Node. The OS stub and recursive resolvers cache by TTL.
- **Order:** `verbatim` is the default. `dns.setDefaultResultOrder()` and `--dns-result-order` change it.
- **Happy Eyeballs:** `autoSelectFamily` defaults to true. 250 ms per attempt. `--no-network-family-autoselection` turns it off.
- **Spikes:** cache miss, UDP loss and the retry timeout (glibc `timeout` 5), pool queueing, search domains and `ndots`, broken IPv6.
- **Promises:** `import dns from 'node:dns/promises'`. `new dns.Resolver({ timeout, tries })` plus `setServers` affects only that resolver. Global `setServers` never affects `lookup`.
- **Errors:** `ENOTFOUND`, `ENODATA`, `ETIMEOUT`, `ECONNREFUSED`, `ESERVFAIL`. Codes are also `dns.NOTFOUND` and the matching constants.

## Good to know

- c-ares is 1.34.6 in Node v24.19.0. The `order` option, including `ipv6first`, was added in v22.1.0 and v20.13.0 and replaced the older `verbatim` boolean. `verbatim` has been the default since v17.0.0. Happy Eyeballs was added in v19.3.0 and v18.13.0 and became the default in v20.0.0 and v18.18.0. The `'connectionAttempt'`, `'connectionAttemptFailed'`, and `'connectionAttemptTimeout'` events were added in v21.6.0 and v20.12.0.
- What does `autoSelectFamily` do? It is Happy Eyeballs (RFC 8305). `net.connect` gets every address from `lookup`, tries them alternating IPv6 and IPv4, and starts the next attempt if the current one has not connected within 250 ms. The first success wins. If all fail you get an `AggregateError`.
## Learn More

- [DNS | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/dns.html)
- [UV_THREADPOOL_SIZE and --dns-result-order | Node.js v24 CLI Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/cli.html)
- [getaddrinfo(3) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages-dev/getaddrinfo.3.en.html)
- [resolv.conf(5) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages/resolv.conf.5.en.html)
- [RFC 8305: Happy Eyeballs Version 2 rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8305.html)
- [c-ares project c-ares.org](https://c-ares.org/)
