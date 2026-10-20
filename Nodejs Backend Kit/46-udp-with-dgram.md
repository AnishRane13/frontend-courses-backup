---
title: "UDP with dgram"
source: written for this kit (not from geekyfrontend.in)
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# UDP with dgram

*14 min read · Updated 10 Oct 2026 · Topic 77 of 85 · added to this kit, not part of the original course*

**Source:** written for this kit — examples verified on Node v24.19.0

---

## Why it matters

TCP (lesson 45) spends a round trip on the handshake before the first byte, and it holds back later data until a lost segment has been resent. That is the right trade for files and API calls, and the wrong one for traffic where a late answer is worth nothing. DNS queries, metrics sent to StatsD, syslog, game state updates, voice and video, service discovery (mDNS) and DHCP all use UDP, and HTTP/3 runs QUIC on top of UDP. In Node you reach UDP through `node:dgram`.

UDP gives you almost nothing beyond the IP layer. A datagram can be lost, arrive twice or arrive out of order, and the sender is not told. Code written against loopback, where loss is rare, tends to assume every `send()` arrives. On a real network that code hangs waiting for replies that never come, or reports metrics that are quietly too low.

## The concept, simply

A **datagram** is one self-contained packet: an 8-byte UDP header (source port, destination port, length, checksum) followed by your payload, inside one IP packet. UDP has:

- **No connection.** There is no handshake and no shared state. The first `send()` is the first packet.
- **Message boundaries kept.** One `send()` becomes one datagram, and the receiver gets it whole in one `'message'` event, or does not get it at all. This is the opposite of TCP's byte stream.
- **No delivery guarantee.** Nothing acknowledges a datagram or resends it. If a router queue, a firewall or the receiver's full socket buffer drops it, it is gone.
- **No ordering.** Each datagram travels on its own and can overtake an earlier one.
- **No flow control.** A fast sender can flood a slow receiver; the receiver's kernel drops what does not fit in its receive buffer.
- **A size limit.** The IPv4 total-length field is 16 bits, so one datagram carries at most 65,507 bytes of payload (65,535 − 20 IP header − 8 UDP header). On a normal Ethernet path (MTU 1500), payloads over 1,472 bytes are split into IP fragments, and losing any fragment loses the whole datagram.

`dgram.createSocket('udp4')` returns a `dgram.Socket`. It is an `EventEmitter`, **not** a stream: there is no `pipe()`, no `highWaterMark` and no `'drain'`. You call `send()` for each datagram and listen for `'message'`.

text

```
 TCP (net.Socket): one byte stream, acknowledged, resent, in order
   write("A") write("B") write("C")  ──►  'data' "AB"  'data' "C"   (edges lost, nothing lost)

 UDP (dgram.Socket): separate datagrams, no acks, no resend, no order
   send("A")   send("B")   send("C")
       │           │           │
       ▼           ✗ dropped   ▼
   'message' "A"           'message' "C"        (edges kept, B is gone, sender not told)
```

## How it works

1. **Create.** `dgram.createSocket('udp4')` (or `'udp6'`, or an options object such as `{ type: 'udp4', reuseAddr: true }`) creates the JavaScript object. The OS socket does not exist yet.
2. **Bind.** `socket.bind(port, address)` attaches the socket to a local port, so others can send to it. `'listening'` fires when it is ready. A socket that only sends does not have to bind: the first `send()` binds it to a random port on all interfaces. Until then, `socket.address()` and the multicast and broadcast setters throw.
3. **Send.** `socket.send(msg, port, address, callback)` resolves `address` with `dns.lookup()` if it is a host name, then hands the datagram to the kernel. The callback reports local errors only: a bad argument, `EMSGSIZE` (too large), `EACCES` (broadcast without permission). A `null` error means "the kernel accepted it", not "it arrived".
4. **Travel.** The kernel builds the IP packet and sends it. Routers forward it or drop it.
5. **Receive.** The receiving kernel puts the datagram in that socket's receive buffer (`SO_RCVBUF`, 208 KiB by default on this Linux machine). If the buffer is full, the kernel drops the datagram and increments a counter. libuv reads datagrams one at a time with `recvmsg` and Node emits `'message'` with `(msg, rinfo)`. `msg` is a Buffer; `rinfo` holds `address`, `family` (the string `'IPv4'` or `'IPv6'`; changed in v18.4.0), `port` and `size`.
6. **Reply.** There is no connection, so a server replies by sending to `rinfo.address` and `rinfo.port`.

**Connected UDP sockets.** `socket.connect(port, address)` (added in v12.0.0) fixes the peer. After that, `send(msg)` needs no address, and the socket only receives datagrams from that peer. It also changes error reporting. When a datagram reaches a host where nothing listens on that port, the host answers with an ICMP "port unreachable" message. The kernel passes that on as `ECONNREFUSED` only to a **connected** socket. An unconnected socket gets nothing back (Example 2).

**Broadcast.** A broadcast address (the last address of a subnet, such as `192.168.1.255` for `192.168.1.0/24`, or `255.255.255.255`) delivers one datagram to every host on the local network segment. The kernel refuses with `EACCES` unless you set `SO_BROADCAST` with `socket.setBroadcast(true)` after binding. Routers do not forward broadcasts.

**Multicast.** A multicast group is an address in `224.0.0.0/4` (IPv4). Receivers join the group with `socket.addMembership(group, interfaceAddress)`, which sets `IP_ADD_MEMBERSHIP` so the kernel (and, on a real network, the switches, through IGMP) delivers packets for that group to them. A sender does not have to join. It sends to the group address and can choose the outgoing interface (`setMulticastInterface`), the hop limit (`setMulticastTTL`; a TTL of 1 keeps packets on the local link, and 1 is the usual default), and whether its own host receives a copy (`setMulticastLoopback`). Addresses in `239.0.0.0/8` are administratively scoped, meant for use inside one organisation, like private IPv4 ranges.

**Loss, duplicates and order are your job.** If an application needs any of them, it builds them on top:

- a request id, to match replies to requests and to drop duplicates;
- a timeout plus a retry, to recover from loss;
- a sequence number, to detect gaps and reordering;
- a size limit (about 1,200 bytes is a common safe payload), to avoid fragmentation.

DNS clients do exactly this (see `33-dns-module.md`). If you need all of them, use TCP or QUIC instead.

## Code examples

**Example 1 — bind, send, receive, reply; one `send()` = one `'message'`.**

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';

// Server: answer each datagram with its uppercase version, to whoever sent it.
const server = dgram.createSocket('udp4');
server.on('message', (msg, rinfo) => {
  console.log(`server: ${rinfo.size} bytes from ${rinfo.address} (${rinfo.family}): ${msg}`);
  server.send(msg.toString().toUpperCase(), rinfo.port, rinfo.address);
});
server.bind(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

// Client: five send() calls -> five separate 'message' events. Boundaries are kept.
const client = dgram.createSocket('udp4');
let replies = 0;
client.on('message', (msg) => {
  console.log(`client: reply ${JSON.stringify(msg.toString())}`);
  if (++replies === 5) { client.close(); server.close(); }
});
for (let i = 1; i <= 5; i++) client.send(`ping ${i}`, port, '127.0.0.1');

// Real output (Node v24.19.0):
//   server: 6 bytes from 127.0.0.1 (IPv4): ping 1
//   server: 6 bytes from 127.0.0.1 (IPv4): ping 2
//   server: 6 bytes from 127.0.0.1 (IPv4): ping 3
//   server: 6 bytes from 127.0.0.1 (IPv4): ping 4
//   server: 6 bytes from 127.0.0.1 (IPv4): ping 5
//   client: reply "PING 1"
//   client: reply "PING 2"
//   client: reply "PING 3"
//   client: reply "PING 4"
//   client: reply "PING 5"
```

Unlike Example 2 of lesson 45, five sends arrived as five separate messages of 6 bytes each, and `rinfo` told the server where to reply. Run on loopback, all five arrived in order. Over a network that is not guaranteed.

**Example 2 — edge case: sending into the void, and the size limit.**

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';

// Find a UDP port that nobody uses: bind, read the port, close.
const probe = dgram.createSocket('udp4');
probe.bind(0, '127.0.0.1');
await once(probe, 'listening');
const deadPort = probe.address().port;
probe.close();

// 1. Unconnected socket: send to a dead port
const a = dgram.createSocket('udp4');
a.on('error', (err) => console.log('unconnected: error event', err.code));
a.send('anyone?', deadPort, '127.0.0.1', (err) => console.log('unconnected: send callback err =', err));
await new Promise((r) => setTimeout(r, 100));
a.send('anyone?', deadPort, '127.0.0.1', (err) => console.log('unconnected: 2nd send callback err =', err));
await new Promise((r) => setTimeout(r, 100));
console.log('unconnected: nothing else happened');
a.close();

// 2. Connected socket: the kernel reports the ICMP "port unreachable" it got back
const b = dgram.createSocket('udp4');
b.on('error', (err) => console.log('connected:   error event', err.code, err.syscall));
b.connect(deadPort, '127.0.0.1');
await once(b, 'connect');
b.send('anyone?', (err) => console.log('connected:   send callback err =', err?.code ?? null));
await new Promise((r) => setTimeout(r, 100));
b.send('anyone?', (err) => console.log('connected:   2nd send callback err =', err?.code ?? null));
await new Promise((r) => setTimeout(r, 100));
b.close();

// 3. Size limit: 65,507 bytes of payload is the IPv4 maximum
const c = dgram.createSocket('udp4');
c.bind(0, '127.0.0.1');
await once(c, 'listening');
c.on('message', (msg) => console.log(`size: received a ${msg.length}-byte datagram`));
for (const size of [65507, 65508]) {
  c.send(Buffer.alloc(size), c.address().port, '127.0.0.1',
    (err) => console.log(`size: send(${size}) ->`, err ? `${err.code} (${err.syscall})` : 'ok'));
}
await new Promise((r) => setTimeout(r, 100));
c.close();

// Real output (Node v24.19.0):
//   unconnected: send callback err = null
//   unconnected: 2nd send callback err = null
//   unconnected: nothing else happened
//   connected:   send callback err = null
//   connected:   error event ECONNREFUSED recvmsg
//   connected:   2nd send callback err = null
//   connected:   error event ECONNREFUSED recvmsg
//   size: send(65507) -> ok
//   size: send(65508) -> EMSGSIZE (send)
//   size: received a 65507-byte datagram
```

The unconnected socket sent twice to a port where nothing listens and got no error at all: `send()` only tells you that the kernel accepted the datagram. The connected socket learned about the ICMP "port unreachable" reply, but not from `send()`: the error came later as an `'error'` event from `recvmsg`, while the send callbacks still said `null`. Without an `'error'` listener that `ECONNREFUSED` would crash the process. A payload of 65,507 bytes is the IPv4 maximum; one more byte fails locally with `EMSGSIZE`. The same test on a `udp6` socket over `::1` accepted 65,527 bytes and rejected 65,528, because the IPv6 header is not counted in its 16-bit payload length.

**Example 3 — real loss on loopback: the receive buffer overflows.** No loss is faked here. One burst of 5,000 sends of 1,000 bytes runs on the same thread as the receiver, so the receiver cannot read until the burst is over.

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

// Real loss on loopback: one burst of sends overflows the receiver's kernel
// buffer (SO_RCVBUF) before its 'message' callbacks get a chance to run.
const rcvbufErrors = () => {                     // Linux kernel counter, system-wide
  const [names, values] = readFileSync('/proc/net/snmp', 'utf8').split('\n').filter((l) => l.startsWith('Udp:'));
  return Number(values.split(' ')[names.split(' ').indexOf('RcvbufErrors')]);
};
const before = rcvbufErrors();

const rx = dgram.createSocket('udp4');
let got = 0;
rx.on('message', () => { got++; });
rx.bind(0, '127.0.0.1');
await once(rx, 'listening');
console.log('receive buffer (SO_RCVBUF):', rx.getRecvBufferSize(), 'bytes');

const tx = dgram.createSocket('udp4');
const payload = Buffer.alloc(1000);
let sent = 0;
for (let i = 0; i < 5000; i++) {
  tx.send(payload, rx.address().port, '127.0.0.1', (err) => { if (!err) sent++; });
}

await new Promise((r) => setTimeout(r, 300));    // let everything that survived arrive
console.log(`sent ${sent} datagrams without error, received ${got}, lost ${sent - got}`);
console.log('kernel RcvbufErrors grew by', rcvbufErrors() - before);
tx.close(); rx.close();

// Real output (Node v24.19.0):
//   receive buffer (SO_RCVBUF): 212992 bytes
//   sent 5000 datagrams without error, received 92, lost 4908
//   kernel RcvbufErrors grew by 4908
```

Every `send()` succeeded, and 98% of the datagrams were still lost. The receiver's 208 KiB kernel buffer filled with the first 92 datagrams; each datagram costs the buffer more than its 1,000 payload bytes, because the kernel also counts its own bookkeeping memory against `SO_RCVBUF`. The kernel then dropped the rest, and its `RcvbufErrors` counter rose by the same number (the counter is system-wide, so other traffic on a busy host can add to it). This is the most common UDP loss on a server: a receiver that is busy (a blocked event loop, a GC pause) or too slow for its senders. `createSocket({ type: 'udp4', recvBufferSize })` or `setRecvBufferSize()` raise the buffer, but only a receiver that keeps up fixes the cause. The kernel caps the request at `net.core.rmem_max` and then doubles it: here `setRecvBufferSize(8 MiB)` with `rmem_max` = 4 MiB gave `getRecvBufferSize()` = 8388608.

**Example 4 — broadcast on the loopback network.**

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';

// Listener bound to all IPv4 addresses (0.0.0.0) so it also sees broadcast datagrams.
const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
listener.on('message', (msg, rinfo) => console.log(`listener: "${msg}" from ${rinfo.address}`));
listener.bind(0);
await once(listener, 'listening');
const { port } = listener.address();

const sender = dgram.createSocket('udp4');
sender.bind(0);
await once(sender, 'listening');
const send = (msg, addr) => new Promise((resolve) =>
  sender.send(msg, port, addr, (err) => { console.log(`send to ${addr}:`, err ? `${err.code}` : 'ok'); resolve(); }));

await send('no flag', '127.255.255.255');      // broadcast address of 127.0.0.0/8
sender.setBroadcast(true);                    // SO_BROADCAST
await send('with flag', '127.255.255.255');
await new Promise((r) => setTimeout(r, 100));
sender.close(); listener.close();

// Real output (Node v24.19.0):
//   send to 127.255.255.255: EACCES
//   send to 127.255.255.255: ok
//   listener: "with flag" from 127.0.0.1
```

`127.255.255.255` is the broadcast address of the `127.0.0.0/8` loopback network, so this test never leaves the machine. Without `setBroadcast(true)` the kernel refused with `EACCES`; with it, the listener bound to `0.0.0.0` received the datagram. On a LAN you would send to the subnet's broadcast address, such as `192.168.1.255`, and every host listening on that port would get a copy.

**Example 5 — multicast: two members join a group on loopback.**

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';

const GROUP = '239.255.42.99';        // administratively scoped (site-local) group
const IFACE = '127.0.0.1';            // join and send on the loopback interface only

// Two members of the group, both bound to the same port (reuseAddr)
const members = [];
let port = 0;
for (const name of ['m1', 'm2']) {
  const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  s.on('message', (msg, rinfo) => console.log(`${name}: "${msg}" from ${rinfo.address}`));
  s.bind(port);
  await once(s, 'listening');
  port = s.address().port;
  try {
    s.addMembership(GROUP, IFACE);     // IP_ADD_MEMBERSHIP
    console.log(`${name}: joined ${GROUP} on ${IFACE}`);
  } catch (err) {
    console.log(`${name}: addMembership failed: ${err.code} ${err.message}`);
  }
  members.push(s);
}

const sender = dgram.createSocket('udp4');
sender.bind(0);
await once(sender, 'listening');
sender.setMulticastInterface(IFACE);   // send out of loopback
sender.setMulticastTTL(1);             // 1 hop: never routed beyond the local link
sender.setMulticastLoopback(true);     // deliver to members on this host
sender.send('hello group', port, GROUP, (err) => console.log('send:', err ? err.code : 'ok'));
await new Promise((r) => setTimeout(r, 200));
for (const s of [sender, ...members]) s.close();

// Real output (Node v24.19.0):
//   m1: joined 239.255.42.99 on 127.0.0.1
//   m2: joined 239.255.42.99 on 127.0.0.1
//   send: ok
//   m1: "hello group" from 127.0.0.1
//   m2: "hello group" from 127.0.0.1
```

Both members are bound to the same port (`reuseAddr: true`) and joined `239.255.42.99` on the `127.0.0.1` interface. One `send()` to the group reached both. The sender used `setMulticastInterface('127.0.0.1')` and TTL 1 so the test stayed on this machine. On a LAN, members join on their real interface address; on a switched network IGMP snooping decides which ports get the traffic. That part was not tested here.

**Example 6 — a request/response client with ids, timeout and retry.** Loopback almost never loses a datagram by itself, so this server **simulates** loss in code: it ignores every third datagram it receives, and says so.

javascript

```
import dgram from 'node:dgram';
import { once } from 'node:events';

// ---- server: answers "<id> <n>" with "<id> <n*n>".
// SIMULATED LOSS: it ignores every 3rd datagram it receives, on purpose,
// because loopback almost never drops anything by itself.
const server = dgram.createSocket('udp4');
let received = 0;
server.on('message', (msg, rinfo) => {
  received++;
  if (received % 3 === 0) return console.log(`  server: (simulated loss) dropped "${msg}"`);
  const [id, n] = msg.toString().split(' ');
  server.send(`${id} ${Number(n) ** 2}`, rinfo.port, rinfo.address);
});
server.bind(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();

// ---- client: every request carries an id; we match replies by id,
// time out after 100 ms and resend up to 3 times.
const client = dgram.createSocket('udp4');
const pending = new Map();                     // id -> resolve
client.on('message', (msg) => {
  const [id, value] = msg.toString().split(' ');
  pending.get(id)?.(Number(value));            // a late duplicate finds no entry: ignored
  pending.delete(id);
});
let nextId = 1;
async function square(n, { timeoutMs = 100, tries = 3 } = {}) {
  const id = String(nextId++);
  for (let attempt = 1; attempt <= tries; attempt++) {
    const reply = new Promise((resolve) => pending.set(id, resolve));
    client.send(`${id} ${n}`, port, '127.0.0.1');
    let t;
    const timer = new Promise((resolve) => { t = setTimeout(resolve, timeoutMs, 'timeout'); });
    const result = await Promise.race([reply, timer]);
    clearTimeout(t);
    if (result !== 'timeout') return { n, result, attempt };
    console.log(`  client: id ${id} timed out (attempt ${attempt})`);
  }
  pending.delete(id);
  throw new Error(`no answer for ${n} after ${tries} tries`);
}

for (const n of [2, 3, 4, 5, 6]) console.log(await square(n));
client.close(); server.close();

// Real output (Node v24.19.0):
//   { n: 2, result: 4, attempt: 1 }
//   { n: 3, result: 9, attempt: 1 }
//     server: (simulated loss) dropped "3 4"
//     client: id 3 timed out (attempt 1)
//   { n: 4, result: 16, attempt: 2 }
//   { n: 5, result: 25, attempt: 1 }
//     server: (simulated loss) dropped "5 6"
//     client: id 5 timed out (attempt 1)
//   { n: 6, result: 36, attempt: 2 }
```

The client tags each request with an id, waits 100 ms, and resends with the same id if no reply came. The requests with ids 3 and 5 (for `n` = 4 and 6) hit the simulated loss and succeeded on the second attempt. A reply that arrives after its retry already succeeded finds no entry in `pending` and is ignored, which is how the id also removes duplicates. The server must be safe to call twice with the same request (here it only squares a number). A server that charges a card would also have to remember the ids it has already processed.

## Common mistakes & gotchas

- **Reading `send()`'s callback as "delivered".** `err === null` means the local kernel accepted the datagram. Loss on the network or at the receiver is never reported to the sender.
- **Expecting `ECONNREFUSED` on an unconnected socket.** Only a `connect()`ed socket hears about ICMP port unreachable, and it arrives as an `'error'` event from `recvmsg`, not in the send callback (Example 2).
- **No `'error'` listener.** An `ECONNREFUSED` or `EMSGSIZE` without a listener crashes the process, like any other `'error'` on an `EventEmitter`.
- **Datagrams larger than the path MTU.** 65,507 bytes works on loopback (MTU 65,536) but turns into ~45 IP fragments on Ethernet; losing any fragment loses the datagram. Keep payloads near 1,200 bytes or less.
- **Assuming loopback behaviour holds on a network.** Loopback does not reorder and drops only when a receive buffer is full. Test loss handling by injecting it on purpose (Example 6), or with `tc netem` on Linux.
- **Treating `dgram.Socket` as a stream.** There is no backpressure: `send()` never says "slow down". Rate-limit senders yourself and size `recvBufferSize` for bursts.
- **Calling `setBroadcast`, `setMulticastTTL` or `setMulticastLoopback` before the socket is bound.** They throw `EBADF` on an unbound socket; call them in the `bind()` callback or after `'listening'`. (`addMembership` is different: on an unbound socket it binds to a random port first.)
- **Retrying a non-idempotent request without an id.** A lost *reply* looks the same as a lost request, so the server sees the request twice.

## Best practices

- **Put a request id in every message** and match replies by id; use it to drop duplicates on both sides.
- **Use a timeout plus a bounded retry** (with backoff on a real network) and fail clearly after the last try.
- **Add a sequence number to streams of updates** (metrics, game state) so the receiver can count gaps and drop stale packets that arrive late.
- **Keep payloads small**, about 1,200 bytes, to stay under the MTU on every path, including IPv6 and VPN tunnels.
- **Bind servers to an explicit address** (`'127.0.0.1'` for local-only tools) and use port `0` in tests. In v24.19.0, `socket.bindSync({ address, port })` (added in v24.19.0) binds immediately and throws on `EADDRINUSE`; on older versions use `bind()` and `'listening'`.
- **Use `connect()` for a client that talks to one server.** It filters out datagrams from other hosts and surfaces `ECONNREFUSED`.
- **Pick TCP or QUIC when you need every byte in order.** If you find yourself adding acks, windows and retransmit timers, you are rebuilding TCP.

## ⭐ Interview lens

> **Q: “When would you choose UDP over TCP?”**  
> A: When a late packet is useless or the exchange is one small request and one small reply: DNS, metrics, telemetry, real-time audio, video and games, discovery by broadcast or multicast. UDP has no handshake, no head-of-line blocking and keeps message boundaries. You pay with no delivery, ordering or flow-control guarantees, so the application adds ids, timeouts and retries if it needs them.

> **Q: “`socket.send()` called back with no error. Did the datagram arrive?”**  
> A: You cannot know. The callback means the local kernel accepted it. It can still be dropped by a router, by a firewall, or by the receiver's full receive buffer, and none of those report back. Only an application-level reply proves delivery. *Trap:* even `ECONNREFUSED` shows up only on a connected socket, and as a later `'error'` event.

> **Q: “Why do UDP payloads over about 1,400 bytes cause trouble even though the limit is 65,507?”**  
> A: Anything larger than the path MTU (1,500 on Ethernet, less through tunnels) is split into IP fragments. Losing any fragment loses the whole datagram, so loss grows with size, and some firewalls drop fragments outright.

> **Q: “How do you build reliable request/response over UDP?”**  
> A: Give each request an id, start a timer when you send, resend with the same id on timeout up to N times, match replies by id and ignore replies whose id is no longer pending. Make the server's handling of a repeated id safe (idempotent or deduplicated), because a lost reply causes a resend of a request the server already processed.

## Cheat-card

- **Create / bind:** `dgram.createSocket('udp4')` → `bind(port, addr)` → `'listening'`; unbound senders auto-bind on first `send()`.
- **Send:** `send(msg, port, addr, cb)`; `cb(null)` = kernel accepted it, not delivered.
- **Receive:** `'message' (msg, rinfo)`: `rinfo.address`, `.port`, `.family` (`'IPv4'`/`'IPv6'` string since v18.4.0), `.size`.
- **Boundaries:** one `send()` = one `'message'`, whole or not at all.
- **Limits:** IPv4 payload ≤ 65,507 bytes (`EMSGSIZE` above); IPv6 ≤ 65,527; keep ~1,200 for real networks.
- **Not a stream:** no backpressure; receiver overflow = silent drop (`RcvbufErrors`).
- **Connected:** `connect(port, addr)` (v12.0.0) → `send(msg)`, peer filter, `ECONNREFUSED` as `'error'`.
- **Broadcast:** `setBroadcast(true)` after bind, else `EACCES`.
- **Multicast:** `addMembership(group, iface)`, `setMulticastInterface`, `setMulticastTTL(1)`, `setMulticastLoopback(true)`; `239.0.0.0/8` = organisation-local.
- **Reliability kit:** id + timeout + retry + dedupe; sequence numbers for order.

---

## Learn More

- [UDP/datagram sockets | Node.js v24 Documentation nodejs.org](https://nodejs.org/docs/latest-v24.x/api/dgram.html)
- [RFC 768: User Datagram Protocol rfc-editor.org](https://www.rfc-editor.org/rfc/rfc768.html)
- [RFC 8085: UDP Usage Guidelines rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8085.html)
- [udp(7) — Linux manual page manpages.debian.org](https://manpages.debian.org/bookworm/manpages/udp.7.en.html)
- [ip(7) — Linux manual page (multicast options) manpages.debian.org](https://manpages.debian.org/bookworm/manpages/ip.7.en.html)
