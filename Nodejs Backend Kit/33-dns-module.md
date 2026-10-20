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

## Why it matters

Every `fetch('https://api.example.com')`, `http.get`, `net.connect({ host })` and database driver that is given a host name turns that name into an IP address before it opens a socket. Node has two different machines for that job inside one module. `dns.lookup()` asks the operating system and runs on the libuv thread pool. `dns.resolve*()` sends DNS packets itself from the event loop. They can return different answers for the same name, they fail differently, and only one of them competes with `fs`, `crypto` and `zlib` for the four pool threads.

That difference causes real incidents:

- A service that hashes passwords with `crypto.pbkdf2` suddenly takes a second to open outgoing HTTP connections, because `lookup()` is queued behind the hashes.
- A name in `/etc/hosts` works with `curl` and `fetch` but fails with `dns.resolve4`.
- A container's DNS server drops one UDP packet, and requests that normally take 20 ms take 5 seconds.

Lookups are also not cached by Node itself, so a client that connects per request pays for name resolution on every request.

## The concept, simply

- **`dns.lookup(hostname, options, callback)`** calls the C library function `getaddrinfo(3)`. That is the same code path `ping`, `curl` and almost every other program use. On Linux with glibc, `getaddrinfo` follows `/etc/nsswitch.conf`. Its `hosts:` line usually reads `files … dns`: first `/etc/hosts`, then DNS, using the servers in `/etc/resolv.conf`. `getaddrinfo` is a blocking call, so Node runs it on a **libuv thread-pool thread** (4 threads by default, `UV_THREADPOOL_SIZE`) and calls you back on the main thread when it returns. `net`, `http`, `https`, `fetch` (undici), `tls` and `dgram` all use `lookup()` by default.
- **`dns.resolve4()`, `resolve6()`, `resolveMx()`, … and `dns.reverse()`** use **c-ares**, a DNS client library bundled with Node (1.34.6 in v24.19.0). c-ares builds DNS query packets, sends them over UDP (TCP for large answers) to the servers it read from `/etc/resolv.conf` or that you set with `setServers()`, and lets libuv watch those sockets like any other socket. No thread-pool thread is used, `/etc/hosts` is never read, and the `search` domains from `/etc/resolv.conf` are not appended to the name (Example 2 shows both). These functions can also ask for record types that `getaddrinfo` cannot: MX, TXT, SRV, NS, CAA, SOA and more.

![Two columns: work the kernel does asynchronously, including dns.resolve() via c-ares, and work that occupies a thread-pool slot, including dns.lookup() via getaddrinfo](assets/i04_02_51406ab8.svg)
*Figure: which Node APIs use the kernel's async I/O and which occupy one of the four thread-pool threads. Look at: `dns.resolve() (uses c-ares)` in the kernel column and `dns.lookup() (getaddrinfo)` in the thread-pool column, next to `crypto.pbkdf2`, which is what Example 3 uses to fill the pool.*

## How it works

1. **You call `dns.lookup('api.example.com')`.** Node queues a `getaddrinfo` request on the libuv thread pool. If all pool threads are busy, the request waits in the queue.
2. **A pool thread runs `getaddrinfo`.** glibc reads `/etc/nsswitch.conf` and tries each source in order: `files` (`/etc/hosts`), possibly `mdns4_minimal` (multicast DNS for `.local`), then `dns`. The `dns` source sends A and AAAA queries to the server in `/etc/resolv.conf`, waits up to `timeout` seconds (default 5) per try, and tries `attempts` times (default 2). On Ubuntu that server is `127.0.0.53`, the systemd-resolved stub, which has its own cache and forwards cache misses to the network's resolver.
3. **glibc sorts the results** by the RFC 3484 rules, which `/etc/gai.conf` can change. Node then applies `order` (`verbatim` by default, meaning glibc's order is kept), and the callback gets the first address or, with `all: true`, all of them.
4. **You call `dns.resolve4('api.example.com')` instead.** c-ares sends one A query from the main thread to the configured server and registers the UDP socket with libuv. When the answer arrives, libuv wakes the event loop, c-ares parses the packet, and your callback gets the addresses (with `{ ttl: true }`, the record TTLs too). If no answer comes within the resolver's timeout, c-ares resends the query, up to `tries` times (default 4), then fails with `ETIMEOUT`.
5. **Either way, the caller decides what to do with several addresses.** `net.connect` asks `lookup()` for all addresses and, with `autoSelectFamily` (on by default since v20.0.0), tries them in turn, alternating IPv6 and IPv4, giving each attempt 250 ms before starting the next. This is the "Happy Eyeballs" algorithm of RFC 8305.

The full path of one name, from your call to the server that owns the name:

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

**Where each answer comes from.** On this machine (Ubuntu with systemd-resolved), `/etc/hosts` maps `localhost` to `127.0.0.1` only, so `lookup('localhost')` returns only `127.0.0.1`. `resolve6('localhost')` asks 127.0.0.53, and systemd-resolved makes up its own answer (`::1`) for `localhost`. `resolvectl query localhost` reports these records as `Data from: synthetic`. It also serves names from `/etc/hosts` this way, which is why `resolve6('ip6-localhost')` worked via the stub. A public resolver such as `1.1.1.1` knows neither name and answers `ENOTFOUND`. That is the clean proof that `resolve*()` does not read `/etc/hosts`: whatever it returns came from a DNS server.

**Caching.** The Node docs never describe a DNS cache; they say `resolve*()` "always perform a DNS query on the network", and `lookup()` hands every call to `getaddrinfo`. Example 4 confirms it: four `resolve4()` calls to `1.1.1.1` sent four query packets, and each one waited for the network. Caching happens outside Node: in a local stub (systemd-resolved, nscd, dnsmasq) if the OS has one, and in the recursive resolver. Inside a minimal container image with no stub, every `lookup()` goes over the network. If you need an in-process cache, an HTTP agent's connection pool (fewer new connections) or a caching `lookup` function passed to `net.connect` / `http.Agent` are the usual fixes.

**IPv4 vs IPv6 selection.** `lookup()` takes these options:

- **`family`**: `4`, `6` or `0` (any).
- **`all: true`**: return every address, not only the first.
- **`order`**: `'verbatim'` (keep the resolver's order), `'ipv4first'` or `'ipv6first'`. `order` was added in v22.1.0 / v20.13.0, where it replaced the older `verbatim` boolean (now deprecated). `ipv6first` arrived at the same time.

The default comes from `dns.setDefaultResultOrder()` or the `--dns-result-order` flag, and has been `verbatim` since v17.0.0. Before v17.0.0 Node put IPv4 first, so moving to v17+ made some programs that connected to `localhost` start connecting to `::1`, which caused `ECONNREFUSED` against servers listening only on `127.0.0.1`. Happy Eyeballs (`autoSelectFamily`) was added in v19.3.0 / v18.13.0 and made the default in v20.0.0 / v18.18.0. It fixes most of those cases by trying the next address when one fails or stays silent for `autoSelectFamilyAttemptTimeout` (250 ms by default; `net.setDefaultAutoSelectFamilyAttemptTimeout()` or `--network-family-autoselection-attempt-timeout` change it). `--no-network-family-autoselection` turns it off.

**Why DNS causes latency spikes.**

- **Cache miss.** When a TTL expires, the next query walks the chain above (root, TLD, authoritative) and can take tens to hundreds of milliseconds instead of under 1 ms.
- **Packet loss.** DNS is mostly UDP (lesson 46): one lost query or answer costs a full retry timeout. That is 5 s with glibc's defaults, and the reason "requests sometimes take exactly 5 seconds" is a classic DNS symptom. Example 7 reproduces it with a local server that drops the first packet.
- **Thread-pool queueing.** `lookup()` waits for a free pool thread, behind `fs`, `crypto.pbkdf2`, `scrypt` and `zlib` work (Example 3).
- **Search domains.** A name with fewer dots than `ndots` (default 1) is tried with each `search` domain in `/etc/resolv.conf` appended before, or instead of, the bare name. Kubernetes pods use `ndots:5`, so `api.example.com` may first be tried as `api.example.com.<namespace>.svc.cluster.local` and similar names, and every failed try adds a round trip.
- **IPv6 that does not work.** An AAAA answer for a host you cannot reach over IPv6 costs a connection timeout per attempt, unless Happy Eyeballs moves on after 250 ms.

## Code examples

The examples that query real names depend on the network and the date. They were run on 10 Oct 2026 from a home network behind systemd-resolved; your addresses, TTLs and timings will differ. Examples 3, 6 and 7 use only local servers, and Example 6 replaces DNS with a fixed `lookup` function.

**Example 1 — the same name through `lookup()`, `resolve*()` and a public resolver.**

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

`lookup('localhost')` returned only `127.0.0.1` because `/etc/hosts` lists only that. `resolve6('localhost')` returned `::1`, an answer systemd-resolved made up. `1.1.1.1` has neither name. `resolve4('ip6-localhost')` gave `ENODATA`: the name exists in the stub's data, but it has no A record.

**Example 2 — proof with `strace`: who reads `/etc/hosts`, and on which thread.**

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

`trace-resolve.cjs` is the same script with `dns.resolve6('ip6-localhost', …)` in place of `lookup`:

bash

```
$ strace -f -e trace=openat,connect node trace-resolve.cjs 2>&1 | grep -E 'hosts|htons\(53\)|->|main thread'
main thread id = 714374
[pid 714374] connect(21, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0
resolve6 -> [ '::1' ]
```

`lookup()` opened `/etc/hosts` from a different thread (`714363`), a libuv pool thread running `getaddrinfo`, and found `::1` there without sending a packet. `resolve6()` never opened `/etc/hosts`. It connected a UDP socket to port 53 of the stub resolver from the main thread (`714374`, the same id as the process). The ids change on every run.

The search list makes the same difference visible. This machine's `/etc/resolv.conf` has `search lan`, and a single-label name has fewer dots than `ndots` (1):

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

`getaddrinfo` sent A and AAAA queries for `nosuchhostzz.lan` first, then for the bare name: six packets for one `lookup()`. `resolve4()` sent one A query for exactly the name it was given. The stub refused the single-label query, and the two paths report that differently: `EAI_AGAIN` from `getaddrinfo`, `EREFUSED` from c-ares.

**Example 3 — edge case: a full thread pool slows `lookup()` but not `resolve4()`.**

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

With an idle pool, both calls took a few milliseconds. With four `pbkdf2` jobs holding all four pool threads, `resolve4()` still answered in about 1 ms, while `lookup()` waited about 0.9 s, until a pool thread became free. The exact numbers change from run to run (between 847 ms and 926 ms for `lookup()` in five runs). With `UV_THREADPOOL_SIZE=8 node d2.mjs` the same `lookup()` took 1 ms, because four threads were still free. Every outgoing `http.get('http://name/')`, `fetch` and `net.connect({ host })` takes this path, so a CPU-heavy pool job can delay all of them.

**Example 4 — Node does not cache: repeated timings.**

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

The first `lookup()` went to the network; the next three took a few milliseconds because systemd-resolved on this machine cached the answer. `resolve4()` via the stub at 127.0.0.53 was also served from that cache. `resolve4()` via `1.1.1.1` has no local cache in between and paid a network round trip **every time**: neither Node nor c-ares kept the answer. Three calls took 39–50 ms. One took 2050 ms: most likely a query or its answer was lost and c-ares resent it after its retry timer (this run was not traced). That is the spike Example 7 reproduces on purpose, and it happened here without any help. Counting the query packets confirms it:

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

Four calls, four DNS query packets on the wire.

> ⚠️ Unverified: the cause of the single 2050 ms call in the timing run above. The packets of that run were not captured, so a lost UDP packet followed by a c-ares retry is the likely explanation, not a proven one.

**Example 5 — IPv4/IPv6 selection with `family`, `all` and `order`.**

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

`verbatim` kept glibc's order. Here glibc put IPv4 first; its RFC 3484 sorting can rank IPv4 above IPv6 depending on which source addresses the machine has. The two IPv4 addresses swap places between calls because the DNS server rotates them. `ipv6first` and `ipv4first` sort by family and keep the order inside each family. Without `all`, you get only the first address, so `order` decides which family a plain `lookup()` returns.

**Example 6 — Happy Eyeballs: `autoSelectFamily` tries the next address.** A fixed `lookup` function stands in for DNS, so the result does not depend on the network. It gives `dual.test` one IPv6 address where nothing listens (`::1`), one IPv4 address that never answers (`10.255.255.1`, unused on this network), and the real server (`127.0.0.1`).

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

With `autoSelectFamily: true` (the default since v20.0.0), `net.connect` asked the lookup function for all addresses. `::1` was refused at once. `10.255.255.1` stayed silent and was abandoned after the 250 ms attempt timeout, and `127.0.0.1` connected. With `autoSelectFamily: false` only the first address was tried, and the socket failed with `ECONNREFUSED`. The `'connectionAttempt'`, `'connectionAttemptFailed'` and `'connectionAttemptTimeout'` events were added in v21.6.0 / v20.12.0.

**Example 7 — a latency spike from one lost UDP packet.** A small DNS server on `127.0.0.1` answers every A query with `10.0.0.7`. It **drops the first copy of each query on purpose** (simulated loss) so the client has to retry.

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

The answer was ready in under a millisecond, yet each call took hundreds of milliseconds or seconds, because the first packet was "lost" and c-ares had to wait for its retry timer. The measured delay was not exactly the `timeout` value (200 → 330–370 ms and 1000 → 2000 ms in four runs), so treat `timeout` as the starting point of c-ares's retry timer, not as the total delay.

> ⚠️ Unverified: why c-ares 1.34.6 waited about 1.7–1.9× and 2× the configured `timeout` before its retry. The Node docs only describe `timeout` as "query timeout in milliseconds", and c-ares's internal retry-timer algorithm was not checked here.

glibc behaves the same way with its own numbers. The default `timeout:5` means one lost packet costs a `lookup()` 5 seconds.

**Example 8 — `dns.promises`, a private `Resolver` with `setServers`, and what `setServers` does not touch.**

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

`new dns.Resolver()` has its own server list, so `setServers(['1.1.1.1', '8.8.8.8'])` changed nothing globally. `resolveNs` and `resolveMx` return record types that `lookup()` cannot. A name under `.invalid` (a top-level domain reserved never to exist) fails with `ENOTFOUND`, the value of `dns.NOTFOUND`. The global `dns.setServers(['127.0.0.1:9'])` broke `resolve4()` straight away (`ECONNREFUSED`, port 9 has no DNS server), while `lookup()` kept working, because `setServers` only affects `resolve*()` and `reverse()`.

## Common mistakes & gotchas

- **Thinking `resolve*()` is a faster `lookup()`.** It skips `/etc/hosts`, the other nsswitch sources such as mDNS, and the `search` domains, so names that work everywhere else on the machine can fail with it: entries that `docker run --add-host` or a VPN client writes into `/etc/hosts`, `.local` names, or short names like `db` that rely on a search domain.
- **Forgetting that `lookup()` shares the thread pool.** `pbkdf2`, `scrypt`, `zlib` and `fs` work delay every outgoing connection by host name (Example 3). Raise `UV_THREADPOOL_SIZE` before the process starts, or keep CPU-heavy work in worker threads.
- **Setting `process.env.UV_THREADPOOL_SIZE` inside the program.** The Node docs warn that this is not guaranteed to work, because the pool may already exist. Set it in the environment that starts `node`.
- **Expecting Node to cache DNS.** It does not (Example 4). Without a local stub, every new connection by name is a network round trip.
- **Calling `dns.setServers()` to change where `fetch` or `http` resolve.** They use `lookup()`, which `setServers` does not affect. Pass a custom `lookup` (to `net.connect`, `http.Agent` or undici's `connect` options) if you need that.
- **Assuming `localhost` means `127.0.0.1`.** With `verbatim` order (default since v17.0.0) it can resolve to `::1` first. A server bound to `127.0.0.1` then sees refused IPv6 attempts, which Happy Eyeballs (default since v20.0.0) usually hides. Bind and connect to an explicit address in tests.
- **Reading `ENOTFOUND` as "the name does not exist".** The docs warn that `lookup()` also reports `ENOTFOUND` for other failures, such as running out of file descriptors.
- **Ignoring TTLs on long-lived connections.** A pooled connection keeps using the IP it resolved when it opened, even after the DNS record changes. Recycle connections so failover by DNS takes effect.

## Best practices

- **Use `lookup()` (the default) for connecting**, so your program resolves names the way the rest of the system does. Use `resolve*()` for DNS-specific work: MX, TXT and SRV records, TTLs, or querying a specific server.
- **Keep the thread pool free for `lookup()`** in services that make many outgoing connections: move CPU-heavy hashing to worker threads or raise `UV_THREADPOOL_SIZE`.
- **Reuse connections** (keep-alive agents, connection pools) so DNS is paid once per connection, not once per request.
- **Run a caching stub** (systemd-resolved, dnsmasq, NodeLocal DNSCache in Kubernetes) next to services that resolve often, and keep the resolver timeout short.
- **Lower `ndots` or use fully qualified names ending in `.`** inside Kubernetes when you call external hosts, to avoid the extra search-domain queries.
- **Leave `autoSelectFamily` on**, and when a server is IPv4-only, bind and connect to `127.0.0.1` rather than `localhost`.
- **Use `dns.promises` and a private `Resolver`** for code that must query specific servers, and never call `setServers` while queries are in flight (the docs forbid it).

## ⭐ Interview lens

> **Q: “What is the difference between `dns.lookup()` and `dns.resolve4()`?”**  
> A: `lookup()` calls the OS's `getaddrinfo` on a libuv thread-pool thread, so it honours `/etc/hosts`, `nsswitch.conf` and the system resolver settings, and it is what `net`, `http` and `fetch` use. `resolve4()` uses the bundled c-ares library from the main thread, sends real DNS queries to the configured servers, ignores `/etc/hosts`, and can query any record type. *Trap:* only `lookup()` competes with `fs`, `crypto` and `zlib` for the four pool threads.

> **Q: “Outgoing HTTP calls slow down whenever the service hashes a lot of passwords. Why?”**  
> A: `crypto.pbkdf2`/`scrypt` and `dns.lookup()` share the libuv thread pool (4 threads by default). When the hashes hold all four threads, every `lookup()` for a new connection queues behind them. Fixes: raise `UV_THREADPOOL_SIZE` at startup, move hashing to worker threads, reuse connections, or resolve with c-ares and pass the IP address.

> **Q: “Does Node cache DNS results?”**  
> A: No. Each `lookup()` calls `getaddrinfo` and each `resolve*()` sends a query. Caching comes from the OS (systemd-resolved, nscd), the recursive resolver, or your own code, for example a caching `lookup` function or long-lived pooled connections.

> **Q: “Some requests take exactly 5 seconds longer than usual. What do you suspect?”**  
> A: A lost DNS packet: glibc's resolver waits `timeout:5` seconds before it retries over UDP. Another cause is an unresponsive first nameserver in `/etc/resolv.conf`: glibc waits the full timeout before it moves on to the next one. Check `/etc/resolv.conf`, run a caching stub, and lower the timeout.

> **Q: “What does `autoSelectFamily` do?”**  
> A: It is Node's Happy Eyeballs (RFC 8305). `net.connect` gets all addresses from `lookup()`, tries them alternating IPv6 and IPv4, and starts the next attempt if the current one has not connected within 250 ms (`autoSelectFamilyAttemptTimeout`). The first success wins, and if all fail you get an `AggregateError`. It was added in v19.3.0 / v18.13.0 and became the default in v20.0.0 / v18.18.0.

## Cheat-card

- **`lookup`** = `getaddrinfo` on the thread pool · `/etc/hosts` + nsswitch + resolv.conf · used by `net`/`http`/`fetch` · options `family`, `all`, `order`, `hints`.
- **`resolve*`** = c-ares on the main loop · real DNS queries · ignores `/etc/hosts` · any record type · `{ ttl: true }` on A/AAAA.
- **Pool:** 4 threads shared with `fs`, `crypto.pbkdf2/scrypt/randomBytes`, `zlib`; set `UV_THREADPOOL_SIZE` before start.
- **Cache:** none in Node; the OS stub and recursive resolvers cache by TTL.
- **Order:** `verbatim` default since v17.0.0; `order` option + `ipv6first` since v22.1.0 / v20.13.0; `--dns-result-order`, `dns.setDefaultResultOrder()`.
- **Happy Eyeballs:** `autoSelectFamily` default `true` since v20.0.0 / v18.18.0; 250 ms per attempt; `--no-network-family-autoselection`.
- **Spikes:** cache miss, UDP loss → retry timeout (glibc `timeout:5`), pool queueing, search domains / `ndots`, broken IPv6.
- **Promises:** `import dns from 'node:dns/promises'`; `new dns.Resolver({ timeout, tries })` + `setServers([...])` affects only that resolver; global `setServers` never affects `lookup`.
- **Errors:** `ENOTFOUND`, `ENODATA`, `ETIMEOUT`, `ECONNREFUSED`, `ESERVFAIL`; codes exported as `dns.NOTFOUND` etc.

---

## Learn More

- [DNS | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/dns.html)
- [UV_THREADPOOL_SIZE and --dns-result-order | Node.js v24 CLI Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/cli.html)
- [getaddrinfo(3) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages-dev/getaddrinfo.3.en.html)
- [resolv.conf(5) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages/resolv.conf.5.en.html)
- [RFC 8305: Happy Eyeballs Version 2 rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8305.html)
- [c-ares project c-ares.org](https://c-ares.org/)
