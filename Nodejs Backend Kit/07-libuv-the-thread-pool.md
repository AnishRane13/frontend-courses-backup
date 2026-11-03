---
title: "libuv & the Thread Pool"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/libuv-thread-pool
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# libuv & the Thread Pool

*9 min read · Updated 24 Jul 2026 Topic 7 of 70 Bookmark Mark done Why it matters · Topic 7 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/libuv-thread-pool](https://www.geekyfrontend.in/learn/nodejs-backend-kit/libuv-thread-pool)

---

## Say it in 30 seconds

libuv is the C library inside Node that runs the event loop on your one JavaScript thread, and that also keeps a pool of four background worker threads by default. Network sockets do not use those workers. The operating system watches them and wakes the loop. File reads, some crypto, compression, and `dns.lookup` do use a worker, because the operating system call would otherwise block.

The pool exists so those blocking calls can look asynchronous. The trade-off is the size. Four slow jobs fill the pool, and the next file read waits in line behind them.

A thread here is a worker the operating system can run at the same time as your JavaScript. The event loop is the scheduler on the JavaScript thread.

## Why it matters

"Node is single-threaded" describes your JavaScript, not the process. libuv owns the event loop and a small thread pool, and it hands network I/O to the kernel. That split is why four concurrent file reads can fall into two batches, why `crypto.pbkdf2` stalls on the fifth call, and why a DNS lookup can be slow while an HTTP request to the same host is not. Some operations are really asynchronous in the kernel and cost no thread. Others are only asynchronous because a worker thread blocks on your behalf.

## The concept, simply

Three layers. **V8** runs your JavaScript on one thread. **libuv**, in the middle, runs the event loop on that same thread and manages the thread pool, four workers by default. The **kernel** underneath has its own readiness systems: `epoll` on Linux, `kqueue` on macOS and BSD, IOCP on Windows.

![Layered diagram showing the single main JS thread with the event loop, libuv bridging to the OS kernel for network I/O and to a four-worker thread pool for file and crypto work](assets/i04_01_4d0a93cc.svg)

Asynchronous work takes one of two paths.

- **Kernel path.** TCP, UDP, HTTP, and HTTPS sockets are non-blocking in the operating system. libuv registers interest. The kernel notifies the poll phase when data arrives. No pool thread is used. Tens of thousands of idle connections are cheap.
- **Thread pool path.** Some calls have no non-blocking kernel version. The file system is the usual case. libuv gives the call to a worker, the worker blocks, then posts the result back. Only four such calls run at once unless you change the pool size.

## How it works

**What uses the pool.** File system calls such as `readFile`, `writeFile`, and `stat`. CPU-heavy async crypto: `crypto.pbkdf2`, `crypto.scrypt`, `crypto.randomBytes`, and key generation. Async zlib, including gzip, deflate, and brotli. And `dns.lookup`, because it calls the blocking system resolver `getaddrinfo`. `http.get('http://example.com')` uses that lookup to resolve the host.

![Two columns comparing kernel-async operations like TCP, HTTP, pipes and dns.resolve against thread-pool operations like fs, crypto.pbkdf2, zlib and dns.lookup](assets/i04_02_51406ab8.svg)

**What does not use the pool.** Network I/O. A thousand HTTP requests are not a thousand threads. They are watched by the kernel and handled in poll. `dns.resolve` is the confusing twin. It queries DNS itself through the bundled c-ares library over a socket, so it does not touch the pool. `dns.lookup` does.

**Four slots.** `UV_THREADPOOL_SIZE` sets the count, maximum 1024, and it must be set before the pool is created. In practice, set it in the environment before Node starts. Five `crypto.pbkdf2` calls at once means four run and the fifth waits. Latency stays flat up to four concurrent operations, then steps up.

**What "single-threaded" gets right.** Your JavaScript never runs on two threads at once, so you do not lock your own objects. What it gets wrong is "Node cannot do parallel work." Network I/O is parallel in the kernel. File, crypto, and zlib work is parallel up to the pool size. Your own CPU-bound JavaScript is not parallel. A tight loop blocks the one JavaScript thread. That belongs in `worker_threads`, which are separate V8 isolates, not pool workers.

## Code examples

**Example 1. The four-slot ceiling is visible.**

javascript

```
const crypto = require('crypto');
const start = Date.now();

// Fire six identical CPU-bound hashes concurrently.
for (let i = 1; i <= 6; i++) {
  crypto.pbkdf2('secret', 'salt', 100000, 64, 'sha512', () => {
    console.log(`hash ${i} done in ${Date.now() - start}ms`);
  });
}

// Typical output (4-core machine, default pool of 4):
//   hash 1 done in ~180ms
//   hash 2 done in ~180ms
//   hash 3 done in ~180ms
//   hash 4 done in ~180ms   <- first four finish together
//   hash 5 done in ~360ms
//   hash 6 done in ~360ms   <- next two wait for a free worker
```

The first four run together. Calls five and six start only when a worker is free, so they finish in about twice the time.

**Example 2. Raise the ceiling with `UV_THREADPOOL_SIZE`.**

javascript

```
// Run with: UV_THREADPOOL_SIZE=8 node app.js
console.log(process.env.UV_THREADPOOL_SIZE); // '8'

// Now all six hashes above start immediately and finish together,
// because there are enough workers. Set it BEFORE any pool work;
// setting process.env.UV_THREADPOOL_SIZE at runtime is too late
// once the pool has been created.
```


**Example 3. Network I/O ignores the pool.**

javascript

```
const https = require('https');
const start = Date.now();

// 50 concurrent requests — served via the kernel, not 50 threads.
for (let i = 0; i < 50; i++) {
  https.get('https://example.com', (res) => {
    res.on('data', () => {});
    res.on('end', () => console.log(`req ${i}: ${Date.now() - start}ms`));
  });
}
// All 50 progress concurrently regardless of UV_THREADPOOL_SIZE;
// the pool default of 4 does not cap network concurrency.
```


**Example 4. The hidden DNS cost.**

javascript

```
const dns = require('dns');

dns.lookup('example.com', () => {});   // uses a thread-pool worker
dns.resolve4('example.com', () => {}); // uses c-ares over a socket, no worker

// Under heavy fs load, dns.lookup can queue behind file operations
// on the pool. If DNS feels slow, dns.resolve() often sidesteps it.
```


## Common mistakes & gotchas

- **All async work is not pool work.** Network I/O does not use the pool. Raising `UV_THREADPOOL_SIZE` does not serve more HTTP connections.
- **The pool is not unlimited.** The default is four workers. Heavy `fs`, `crypto`, and zlib compete for the same slots.
- **`dns.lookup` uses the pool.** A burst of outbound HTTP can fill the pool with `getaddrinfo` and slow unrelated file reads.
- **Setting `UV_THREADPOOL_SIZE` too late.** Change it in the environment before the first pool operation. Setting `process.env` after the pool exists does nothing.
- **The libuv pool is not `worker_threads`.** The pool runs native I/O-style work inside libuv. `worker_threads` are extra V8 isolates for your own JavaScript.
- **`fs` is not free like a socket.** The call blocks a worker. Concurrency is the pool size, not "as many as the disk allows" for free.

## Best practices

- Set `UV_THREADPOOL_SIZE` for the workload you measured. Heavy concurrent `fs`, crypto, or zlib may want 8 or 16. Measure before and after.
- Prefer `dns.resolve()` when you need many lookups and want them off the pool.
- Put your own CPU-bound JavaScript on `worker_threads` or in another process. The pool is not a place to run that JavaScript.
- Flat latency that then steps up under load usually means the pool is full.
- To serve more sockets, tune the app and the operating system limits. The pool size is the wrong knob.

## ⭐ Interview lens

> **Q: Is Node.js single-threaded?**  
> Your JavaScript runs on one main thread, one callback at a time, so your objects do not race. The process is not single-threaded. libuv runs a thread pool, four workers by default, for blocking native work such as `fs` and `crypto.pbkdf2`. Network sockets do not take a worker. The kernel watches them. The limit of the slogan is a tight JavaScript loop. That still blocks every connection, because it occupies the only thread that can run your callbacks.

> **Q: Which operations use the libuv thread pool?**  
> Almost all of `fs`, CPU-heavy async crypto (`pbkdf2`, `scrypt`, `randomBytes`, key generation), async zlib, and `dns.lookup`, because `getaddrinfo` blocks. TCP, UDP, and HTTP sockets do not. `dns.resolve` does not either. It speaks DNS over a socket through c-ares. The limit is assuming "async" means "pool." Async only means the JavaScript callback returned. The wait might be a kernel registration or a worker.

> **Q: You run 6 `pbkdf2` calls concurrently and the last two are twice as slow. Why?**  
> The default pool has four workers. The first four run together. The fifth and sixth sit in a queue until a worker finishes, so they complete in about twice the time. Setting `UV_THREADPOOL_SIZE` to at least 6 lets all six start, if the machine has the CPU. The limit is that the variable must be set before the pool is created. Assigning `process.env.UV_THREADPOOL_SIZE` after the first pool job does nothing. And a bigger pool does not make network sockets faster.

> **Q: Does increasing `UV_THREADPOOL_SIZE` let my server handle more concurrent HTTP connections?**  
> No. HTTP and TCP are handled by the kernel in the poll phase. They do not take pool threads. The pool size only changes throughput of `fs`, crypto, zlib, and `dns.lookup`. The limit of that answer is the hidden lookup. `http.get` to a hostname uses `dns.lookup`, so a burst of new hosts can fill the pool even though the sockets themselves do not.

## Cheat-card

- One JavaScript thread, plus libuv (event loop and thread pool), plus the kernel.
- **No pool thread:** TCP, UDP, HTTP, pipes, `dns.resolve`.
- **Pool, four by default:** `fs`, `crypto.pbkdf2`, `scrypt`, `randomBytes`, zlib, `dns.lookup`.
- `UV_THREADPOOL_SIZE`, maximum 1024. Set it before any pool work.
- A bigger pool does not mean more sockets.
- JavaScript parallelism is `worker_threads`, not the pool.

## Good to know

- Q: What is the difference between `dns.lookup` and `dns.resolve`? `dns.lookup` calls blocking `getaddrinfo` on the thread pool. `dns.resolve` queries DNS through c-ares over a socket and does not use the pool. Under pool load, `lookup` queues and `resolve` stays fast.
- Q: Thread pool vs `worker_threads`, same thing? No. The pool is internal, for native I/O-style work, and you cannot put arbitrary JavaScript on it. `worker_threads` are separate V8 isolates you create for your own CPU-bound JavaScript, using message passing or `SharedArrayBuffer`.
- On Node 24, file I/O still uses the thread pool. The only io_uring ring is a non-SQPOLL ring that batches `epoll_ctl`. `UV_USE_IO_URING=1` has no effect. That default is the CVE-2024-22017 fix. libuv 1.45 (Node 20.3) had turned SQPOLL file I/O on. Node 20.11.1 and 21.6.2 turned it off on 14 Feb 2024. libuv 1.49 (Sept 2024) made SQPOLL off the upstream default.
- `os.availableParallelism()` was added in v19.4.0 and v18.14.0. It respects the affinity mask and the cgroup CPU quota. `os.cpus()` was added in v0.3.3 and reports the whole machine. A quota of 1.5 CPUs rounds down to 1. Neither function changes `UV_THREADPOOL_SIZE`, which stays 4 unless you set it.
- `setuid` and the related calls throw `ERR_INVALID_STATE` only when the linked libuv is from 1.45.0 up to but not including 1.49.0. Node 24's bundled libuv 1.52.1 does not throw.

---

## Learn More

- [Thread pool work scheduling docs.libuv.org](https://docs.libuv.org/en/v1.x/threadpool.html)
- [Don't Block the Event Loop (or the Worker Pool) nodejs.org](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop)
- [Node.js Tutorial - 39 - Thread Pool Codevolution](https://www.youtube.com/watch?v=I1sqnbJ1Fno)
- [This is how the Node.js Event Loop really works Software Developer Diaries](https://www.youtube.com/watch?v=paI6J8my3Yw)

---

---

## Additional topics

*Added 7 Oct 2026 · examples verified on Node v24.19.0*

### io_uring on Linux: what Node 24 actually uses

io_uring is a Linux kernel interface, from 5.1 on, made of two shared ring buffers. The process writes requests to a submission queue. The kernel posts results to a completion queue. In SQPOLL mode a kernel thread polls the submission queue, so the process does not make a syscall per request. For files, that would be real kernel-async I/O and could replace a worker blocked in `read()`.

libuv 1.45.0, May 2023, shipped in Node 20.3.0, started sending file operations through an SQPOLL ring. Kernel bugs followed. The libuv ChangeLog records disabling it on 32-bit ARM, on kernels before 5.10.186, and on ppc64 and ppc64le. Then a security hole. CVE-2024-22017, rated High, fixed in the 14 Feb 2024 releases, Node 20.11.1 and 21.6.2. A ring created before `process.setuid()` kept the old credentials, so file operations could still run as root after the process had dropped them. Node disabled io_uring in libuv by default, and disabled `setuid` and the related calls if io_uring was enabled. libuv 1.49.0, September 2024, made "SQPOLL off by default" the upstream behavior.

On Node v24.19.0, libuv 1.52.1, from that source:

1. Every libuv loop creates one small io_uring ring without SQPOLL and uses it only to batch `epoll_ctl`. libuv 1.50.0 says it always uses io_uring for epoll batching. File I/O does not go through it.
2. The SQPOLL ring that would carry files is created lazily, and only if the embedder calls `uv_loop_configure(loop, UV_LOOP_USE_IO_URING_SQPOLL)` and `UV_USE_IO_URING` is a positive number. That loop option was added in libuv 1.49.0.
3. Node v24.19.0 calls `uv_loop_configure` only with `UV_LOOP_BLOCK_SIGNAL` and `UV_METRICS_IDLE_TIME`. So on Node 24, `fs` always uses the thread pool, and `UV_USE_IO_URING=1` changes nothing.
4. `process.setuid()`, `setgid()`, `seteuid()`, `setegid()`, `setgroups()`, and `initgroups()` check `uv_version()`. They throw `ERR_INVALID_STATE` ("io_uring may be enabled. See CVE-2024-22017.") only for libuv from 1.45.0 up to but not including 1.49.0. That guards a Node build linked to such a shared libuv. With the bundled 1.52.1 they work.

> ⚠️ Unverified: `UV_USE_IO_URING` is not documented on https://nodejs.org/api/cli.html (searched on 7 Oct 2026: the v24.x and current v26.10.0 pages mention `UV_THREADPOOL_SIZE` only). The points above come from the libuv ChangeLog, libuv v1.52.1 `src/unix/linux.c`, Node v24.19.0 `src/node.cc` and `src/node_credentials.cc`, and the strace run below, not from a Node doc page.

**Example. strace shows no SQPOLL ring, and file reads on four pool threads, with or without the variable.**

javascript

```
// uring.js — 20 concurrent async reads of this file
const fs = require('node:fs');
let n = 0;
for (let i = 0; i < 20; i++) fs.readFile(__filename, () => { if (++n === 20) console.log('20 reads done'); });
```


bash

```
$ cat run.sh
node -p "process.versions.uv"
for v in 0 1; do
  echo "--- UV_USE_IO_URING=$v"
  UV_USE_IO_URING=$v strace -f -o trace$v.txt -e trace=io_uring_setup,openat node uring.js
  echo "rings created: $(grep -c 'io_uring_setup(' trace$v.txt), with SQPOLL: $(grep -c 'IORING_SETUP_SQPOLL' trace$v.txt)"
  echo "threads that opened uring.js (count, thread id):"
  grep 'uring.js' trace$v.txt | awk '{print $1}' | sort | uniq -c
done
$ sh run.sh
1.52.1
--- UV_USE_IO_URING=0
20 reads done
rings created: 3, with SQPOLL: 0
threads that opened uring.js (count, thread id):
      1 107378
      5 107385
      5 107386
      5 107387
      5 107388
--- UV_USE_IO_URING=1
20 reads done
rings created: 3, with SQPOLL: 0
threads that opened uring.js (count, thread id):
      1 107398
      5 107405
      5 107406
      5 107407
      5 107408
$ grep -o 'io_uring_setup(256, {flags=[A-Z_|]*' trace0.txt | sort | uniq -c
      3 io_uring_setup(256, {flags=IORING_SETUP_NO_SQARRAY
```

The single open on the main thread, the lowest id, is the CommonJS loader reading the script. The 20 async opens spread over four other thread ids, the default pool workers. This run was 5, 5, 5, and 5. A rerun gave 6, 4, 6, 4 and 3, 2, 6, 9, always four threads. The three rings have 256 entries and no SQPOLL flag. Those are the `epoll_ctl` batching rings. The shape is the same with `UV_USE_IO_URING=1`. Linux 7.0.0, `kernel.io_uring_disabled = 0`, strace 6.19. Thread ids change every run.

### `os.availableParallelism()` vs `os.cpus().length`

`os.cpus()` returns one object per logical CPU the machine has, read from `/proc` on Linux. `os.availableParallelism()` wraps libuv's `uv_available_parallelism()`, an estimate of how many CPUs this process may actually use. On Linux it counts the CPUs in the affinity mask from `sched_getaffinity`, then lowers that to the cgroup CPU quota if there is one. libuv 1.49.0 lists the cgroup fix.

`os.cpus()` still reports the whole machine inside a container or a CPU pin. Size a worker pool from that number inside a `--cpus=2` container on a 64-core host and you start 64 CPU-bound workers onto 2 CPUs of quota. Piscina's default `maxThreads` uses `os.availableParallelism()` for this reason. Lesson 10 covers the pool.

1. `uv_available_parallelism()` calls `sched_getaffinity` and counts the bits. `taskset -c 0` limits that mask to one CPU.
2. It reads the process cgroup and its `cpu.max`. A quota of `200000 100000` means 2 CPUs.
3. It returns the smaller of the two, and never less than 1. A fractional quota rounds down. 1.5 CPUs gives 1.
4. Neither value changes the libuv thread pool. `UV_THREADPOOL_SIZE` still defaults to 4.

**Example. The same machine, three restrictions.**

javascript

```
// par.js
const os = require('node:os');
console.log(`availableParallelism=${os.availableParallelism()} cpus().length=${os.cpus().length}`);
```


bash

```
$ node par.js
availableParallelism=8 cpus().length=8
$ taskset -c 0 node par.js
availableParallelism=1 cpus().length=8
$ taskset -c 0-2 node par.js
availableParallelism=3 cpus().length=8
$ systemd-run --user --scope -q -p CPUQuota=200% node par.js
availableParallelism=2 cpus().length=8
```

`systemd-run --user --scope` runs the command in a temporary cgroup whose `cpu.max` was `200000 100000`, quota and period in microseconds. The cgroup is removed when the command exits.

> ⚠️ Unverified: that `docker run --cpus=2` and Kubernetes CPU limits write the same `cpu.max` file, so they give the same result. No Docker daemon or cluster was available to run it.

### Common mistakes & gotchas (additional topics)

- **"Node 20 and later uses io_uring for files."** That was only true between 20.3.0 and 20.11.1. Node 24 sends `fs` through the thread pool. `UV_USE_IO_URING=1` does not change that, because Node never enables the SQPOLL loop option.
- **Seeing `io_uring_setup` in strace and concluding files use it.** Those rings have no SQPOLL flag and only batch `epoll_ctl`. Look at which thread made the `openat` and `read` calls.
- **Setting `UV_USE_IO_URING=0` "for security" on Node 24.** It is harmless and it does nothing. The CVE fix is the libuv default plus the `setuid()` guard.
- **Sizing pools from `os.cpus().length` in containers.** That is the host's CPU count. Use `os.availableParallelism()`.
- **Assuming `availableParallelism()` sets `UV_THREADPOOL_SIZE`.** It does not. The pool stays at 4 unless you set the variable.

### Edge case worked through: a fractional CPU quota

A quota of 1.5 CPUs (`CPUQuota=150%`, `cpu.max` of `150000 100000`) rounds down:

bash

```
$ systemd-run --user --scope -q -p CPUQuota=150% node par.js
availableParallelism=1 cpus().length=8
```

So `Math.max(1, os.availableParallelism() - 1)`, meant to leave one core for the main thread, returns 1 under a 1.5 CPU limit and also under a 1 CPU limit. If you want the extra half CPU, size the pool yourself, for example from an environment variable set by the deployment, and measure it.

### ⭐ Interview lens (additional topics)

> **Q: “Does Node use io_uring for file I/O today?”**  
> Not for files, on Node 24. libuv added an SQPOLL file path in 1.45, which shipped in Node 20.3. After kernel bugs and CVE-2024-22017, a ring created before `setuid()` kept root's credentials, Node 20.11.1 turned it off, and libuv 1.49 made SQPOLL off the upstream default. On Node 24, `fs` still runs on the four-thread pool. The only io_uring left is a non-SQPOLL ring that batches `epoll_ctl`. The trap is citing `UV_USE_IO_URING=1` as the switch. Node 24 never sets the loop option that variable needs. The variable is also absent from the Node CLI docs. See the unverified note above.

> **Q: “Why use `os.availableParallelism()` instead of `os.cpus().length`?”**  
> `cpus()` lists the machine's logical CPUs. `availableParallelism()` counts the CPUs in this process's affinity mask, then caps that by the cgroup CPU quota. In a container limited to 2 CPUs on an 8-core host it returns 2, while `cpus().length` returns 8. The limit is that it does not resize libuv's pool, and a fractional quota such as 1.5 rounds down to 1.
