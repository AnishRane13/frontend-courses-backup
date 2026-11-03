---
title: "EventEmitter"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/eventemitter
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# EventEmitter

*10 min read · Updated 24 Jul 2026 Topic 20 of 70 Bookmark Mark done Why it matters Promises and async · Topic 20 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/eventemitter](https://www.geekyfrontend.in/learn/nodejs-backend-kit/eventemitter)

---

## Say it in 30 seconds

An EventEmitter is an object that keeps a list of functions per event name and, when you call emit, runs those functions immediately, in the order they were added, on the current stack. It exists for things that happen many times, such as socket data or a new connection, which a promise cannot model because a promise settles once. The trade-off is that a slow or throwing listener blocks or interrupts the others, and an error event with no listener throws and can crash the process.

## Why it matters

Promises model one future result. A lot of Node is things that happen repeatedly: a socket receiving chunks, a server accepting connections, a stream emitting data and then end, a file watcher firing on every change. EventEmitter is the tool for that, and streams, servers, sockets, and the process object itself are built on it.

You read Node's own APIs with it, such as req.on('data') and server.on('connection'). Interviews ask whether emit is synchronous, what the error event does with no listener, and what the too-many-listeners warning means.

## The concept, simply

An EventEmitter lets you publish named events and subscribe to them. That is the observer pattern, also called publish and subscribe, built into Node's core. You register a listener with emitter.on(event, handler). Later something calls emitter.emit(event, ...args), which runs every handler for that name, in order, and passes the arguments along. The emitter and the listeners do not need to know each other's internals.

![One emitter calling emit('data') which fans out synchronously to three registered listeners A, B, and a once-listener C, in registration order](assets/i17_01_18b4f9c1.svg)

One emit runs every listener for that event immediately, in the order they were added.

on, also called addListener, registers a handler that runs on every emit. once registers one that runs only the first time and then removes itself. You unsubscribe with off, also called removeListener. Streams, servers, and sockets are EventEmitters, or they inherit from one.

## How it works

An emitter keeps a map from event name to an array of listener functions. emit looks up that array and calls each function synchronously, on the current stack, before emit returns. Emitting is not asynchronous. A listener that does slow synchronous work blocks. A listener that throws propagates out of emit and can stop later listeners from running. Listeners run in registration order. emit returns true if there were listeners and false if there were none.

once wraps your handler. The wrapper removes itself from the array before it calls your function, so it runs once. off removes a function by reference, which is why you must pass the same function you registered. An inline arrow function cannot be removed, because you no longer hold that reference.

Two special cases are worth remembering. First, the error event is special. If you emit error and nobody is listening, Node throws that error, which typically crashes the process. Any long-lived emitter needs an error listener. Second, there is a leak guard. If you add more than defaultMaxListeners, which is 10, listeners for one event, Node prints a MaxListenersExceededWarning. It is a warning, not an error. It usually means you are adding listeners in a loop and forgetting to remove them.

A promise is a value. It settles once, it remembers the result, and a consumer that subscribes after it settles still receives the value. An event is a notification. emit fans out to whoever is listening at that moment, keeps no history, and a listener that arrives late misses it. Repeated occurrences, several independent subscribers, or "tell me each time" point to events. "Give me the one result" points to a promise.

listenerCount tells you how many handlers are registered. eventNames lists events that currently have any. prependListener adds a handler at the front so it runs before the others. setMaxListeners raises the warning threshold for one emitter. EventEmitter.defaultMaxListeners changes it for emitters created after that. Because listeners run synchronously, the true or false that emit returns is known immediately.

| Method | Effect |
| --- | --- |
| `on(name, fn)` / `addListener` | Subscribe; fires on every emission |
| `once(name, fn)` | Subscribe; fires once, then self-removes |
| `off(name, fn)` / `removeListener` | Unsubscribe by function reference |
| `emit(name, ...args)` | Invoke every listener synchronously; returns `true` if any ran |
| `prependListener(name, fn)` | Subscribe at the front of the queue |
| `removeAllListeners(name?)` | Drop all listeners for one event, or for every event |
| `listenerCount(name)` / `eventNames()` | Introspect current subscriptions |
| `setMaxListeners(n)` | Raise this instance's leak-warning threshold |

A listener that uses await does not make emit wait. emit returns as soon as the synchronous part of every listener has run, long before async work inside them settles. The contract has no "all listener work finished". If you need that, collect the listeners' promises yourself, or model the flow with a promise. The same shared stack is why a throw in one listener can skip the listeners registered after it.

## Code examples

Basic pub/sub with `on`, `once`, and `emit`. Note the once-listener fires a single time:

javascript

```
const { EventEmitter } = require('node:events');
const bus = new EventEmitter();

bus.on('order', (id, total) => console.log('order', id, 'for', total));
bus.once('ready', () => console.log('ready — fires only once'));

bus.emit('ready');           // logs
bus.emit('ready');           // nothing — once already removed itself
bus.emit('order', 42, 999);  // logs: order 42 for 999
```

Building your own emitter by extending the class — the idiomatic way to give an object an event API:

javascript

```
class Job extends EventEmitter {
  async run() {
    this.emit('start');
    try {
      const result = await doWork();
      this.emit('done', result); // listeners run synchronously here
    } catch (err) {
      this.emit('error', err);   // MUST have an 'error' listener
    }
  }
}

const job = new Job();
job.on('start', () => console.log('started'));
job.on('done', (r) => console.log('finished', r));
job.on('error', (e) => console.error('failed', e.message)); // required
job.run();
```

Removing listeners correctly (keep the reference) and proving emission is synchronous:

javascript

```
function onData(chunk) { console.log('got', chunk); }
bus.on('data', onData);
bus.off('data', onData);      // works — same reference
// bus.off('data', (c) => {}); // would NOT remove anything

console.log('before emit');
bus.on('sync', () => console.log('during emit'));
bus.emit('sync');
console.log('after emit');
// Order: before emit → during emit → after emit  (synchronous!)
```

Bridging an event-based flow to a promise with `events.once` — useful when you want to `await` the next occurrence of an event:

javascript

```
const { once } = require('node:events');

async function waitForConnect(server) {
  server.listen(3000);
  await once(server, 'listening'); // resolves on the event, rejects on 'error'
  console.log('server is up');
}
```

## Common mistakes & gotchas

- An error event with no listener is thrown and usually crashes the process. Attach an error listener on long-lived emitters such as streams, sockets, and servers.
- emit is synchronous. Slow work in a listener blocks. If the work is async, schedule it inside the listener. emit will not wait for it.
- Adding a listener per request and never removing it grows the array without bound. The warning at more than 10 listeners is Node telling you that.
- You can only off a function you still hold. An inline arrow cannot be removed. Keep a named reference, or use once.
- A throw in one synchronous listener propagates out of emit and can skip later listeners. Keep listeners from throwing.
- Raising setMaxListeners to silence the warning hides a leak. Fix the add and remove logic, and raise the limit only when you truly need that many listeners.
- For something that happens once and whose value you need, a promise is clearer than wiring up listeners and tearing them down.

## Best practices

- Always register an error listener on an emitter that can emit error.
- Use once for one-time events so the listener removes itself.
- Keep a reference to any listener you will need to remove, and remove it when the subscriber goes away.
- Keep listeners fast and non-throwing. Schedule heavy or async work instead of doing it inline.
- Treat MaxListenersExceededWarning as a leak to investigate.
- Use events.once when you want to await the next occurrence, and events.on when you want a loop of them.
- Use events for repeated or broadcast notifications. Use a promise for a single result.

## ⭐ Interview lens

> **Q: Is `emit` synchronous or asynchronous?**  
> emit is synchronous. It looks up the array of listeners for that name and calls each one, in registration order, on the current stack, before emit returns. It is not queued on the event loop. If a listener does a long synchronous loop, every other listener and the rest of your request wait. If a listener throws, the exception comes out of emit and listeners registered after that one may not run. For example, emitter.emit('data', chunk) will have already run the handlers by the next line. The limit is that this says nothing about async work inside a listener. If the listener is an async function, emit still returns immediately and ignores the promise it got back, so a rejection there is not handled by emit itself.

> **Q: What happens if you emit `'error'` with no listener? (trap)**  
> Node throws that error as an exception, which typically crashes the process. The error event is the one name with this special case, so a failure is not silent. Streams, sockets, and servers all use it. Any long-lived emitter you create needs an error listener, even if that listener only logs. For example, a stream with no error listener will take the process down on a read failure. The limit is that adding the listener changes the outcome: emit then calls your listener instead of throwing. If your listener itself throws, that throw still propagates out of emit.

> **Q: Difference between `on` and `once`?**  
> on registers a listener that runs on every emit of that name and stays registered. once registers a listener that runs on the next emit and then removes itself. once is implemented as a wrapper that unsubscribes before it calls your function, so you still see the arguments of that one event. Use on for data chunks or connection events. Use once for "the next ready" or "the next end" so you do not leak a listener. The limit of once is that it really is only the next occurrence. If you needed the one after that, you have to subscribe again. And off still requires the same function reference if you want to cancel a once listener early.

> **Q: When would you use an EventEmitter over a promise?**  
> Use an EventEmitter when the thing happens more than once, or when several independent subscribers all need to hear it: streaming chunks, connection events, progress ticks. A promise models one eventual value. It settles once, remembers the result, and a late subscriber still receives it. An event does not remember. A listener that subscribes after the emit misses it. For example, a file download's chunks are events, and the final "here is the whole buffer" can be a promise. The limit of events is the missing history and the synchronous fan-out: one throwing listener can interrupt the others, and there is no built-in result value.

## Cheat-card

- Subscribe with on or once. Publish with emit. Unsubscribe with off and the same function reference.
- emit is synchronous, in registration order, on the current stack. It returns true if any listener ran.
- once runs once and removes itself.
- error with no listener throws and can crash the process. Always handle it.
- More than 10 listeners on one event prints MaxListenersExceededWarning. Fix the leak before you raise the limit.
- Events are for many or broadcast occurrences. A promise is for one result.

## Good to know

- What causes the MaxListenersExceededWarning and is it an error? Adding more than 10 listeners for one event name prints MaxListenersExceededWarning. It is a warning, not a throw. It usually means listeners were added in a loop and not removed.

- Why can't you remove an inline arrow-function listener? off and removeListener match by function reference. An inline arrow is a new function you do not still hold, so there is nothing to pass back. Keep a named reference.
- Additional examples: 7 Oct 2026, examples verified on Node v24.19.0.
- `events.on(emitter, eventName[, options])`: added in v13.6.0 and v12.16.0.
- `events.errorMonitor`: added in v13.6.0 and v12.17.0.

---

## Learn More

- [Events (EventEmitter) API nodejs.org](https://nodejs.org/api/events.html)
- [The Node.js Event emitter nodejs.org](https://nodejs.org/en/learn/asynchronous-work/the-nodejs-event-emitter)
- [Node JS Tutorial for Beginners #8 - The Node Event Emitter Net Ninja](https://www.youtube.com/watch?v=NtrnaTKqFPQ)
- [Node.js "Event Emitters" Explained Software Developer Diaries](https://www.youtube.com/watch?v=wINRm5arVlM)

---

## Additional topics

### `events.on`: consuming events with `for await`

`events.on(emitter, eventName[, options])` returns an **async iterator**. Each `await` of it gives you the argument array of the next `eventName` emission. It turns "call me back on every event" into a loop you can write top to bottom, with `try/catch`, `break` and sequential `await`s inside. Without it, a consumer that must process events one at a time has to manage its own queue and its own "am I busy?" flag inside a listener. `events.once` (shown above) covers a single event; `events.on` covers a stream of them.

How it works:

1. Calling `on()` immediately adds listeners to the emitter: one for `eventName`, one for `'error'`, and one for each name in `options.close` (the `close` option was added in v20.0.0).
2. Every emission is pushed into an internal queue, or handed straight to a pending `next()` if the loop is already waiting. While your loop body is busy (for example awaiting a database write), new events wait in that queue, so the body handles one event at a time, in order.
3. An `'error'` event makes the next `next()` reject, so the `for await` throws. An aborted `options.signal` throws an `AbortError`.
4. A `close` event, `break`, `return` or a throw removes all of those listeners. Events already in the queue are still delivered first.
5. With no `close`, no `signal` and no `break`, the iterator never finishes, because an emitter has no built-in "end" (see the edge case below).
6. `highWaterMark` / `lowWaterMark` (supported since v20.0.0 under the spelling `highWatermark`; renamed in v22.0.0 and v20.13.0) call `pause()`/`resume()` on emitters that have them, such as readable streams, to bound the queue.

**Example — `for await` with `close`, and a slow consumer.**

javascript

```
// on-iter.mjs: consume events with for await; stop on 'end'; buffer while busy.
import { EventEmitter, on } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

const feed = new EventEmitter();
const rows = on(feed, 'row', { close: ['end'] });   // listeners are added here
console.log('listening to:', feed.eventNames());

setTimeout(() => {
  feed.emit('row', 1);
  feed.emit('row', 2);     // the loop body has not even started yet
  feed.emit('row', 3);
  feed.emit('end');        // removes the listeners at once...
  console.log('after end, listening to:', feed.eventNames());
}, 10);

for await (const [n] of rows) {
  console.log('row', n);   // ...but rows already queued are still delivered
  await sleep(20);
}
console.log('loop finished');

// Real output (Node v24.19.0):
//   listening to: [ 'row', 'error', 'end' ]
//   after end, listening to: []
//   row 1
//   row 2
//   row 3
//   loop finished
```

**Example — `'error'` and `AbortSignal` end the loop by throwing.**

javascript

```
// on-error.mjs: an 'error' event ends the loop by throwing; an AbortSignal does too.
import { EventEmitter, on } from 'node:events';

const a = new EventEmitter();
setTimeout(() => { a.emit('row', 1); a.emit('error', new Error('socket closed')); }, 10);
try {
  for await (const [n] of on(a, 'row')) console.log('row', n);
} catch (err) {
  console.log('loop threw:', err.message, '| listeners left:', a.eventNames());
}

const b = new EventEmitter();
const ac = new AbortController();
setTimeout(() => { b.emit('row', 1); ac.abort(); }, 10);
try {
  for await (const [n] of on(b, 'row', { signal: ac.signal })) console.log('row', n);
} catch (err) {
  console.log('loop threw:', err.name, err.code);
}

// Real output (Node v24.19.0):
//   row 1
//   loop threw: socket closed | listeners left: []
//   row 1
//   loop threw: AbortError ABORT_ERR
```

### `captureRejections`: async listeners that reject

`emit()` calls listeners synchronously and ignores what they return. If a listener is an `async` function and throws, it returns a rejected promise that nobody holds. That is an unhandled rejection, which by default crashes the process even though you registered an `'error'` listener. `captureRejections` (the constructor option added in v13.4.0 and v12.16.0, no longer experimental since v17.4.0 and v16.14.0; default `false`) makes the emitter attach a rejection handler to each promise a listener returns.

How it works:

1. Create the emitter with `new EventEmitter({ captureRejections: true })`, or set `EventEmitter.captureRejections = true` to change the default for all emitters created afterwards.
2. On `emit()`, if a listener returns a promise, the emitter attaches `.then(undefined, handler)` to it.
3. When the promise rejects, the handler runs asynchronously, after `emit()` has returned. It calls `this[Symbol.for('nodejs.rejection')](err, eventName, ...args)` if the object defines that method (exported as `events.captureRejectionSymbol`). Otherwise it emits `'error'` with the rejection reason.
4. Rejections from `'error'` listeners themselves are not captured, to avoid an infinite loop. The docs recommend not using `async` functions as `'error'` listeners.

**Example — the same throwing async listener, with and without the option.**

javascript

```
// capture.cjs: an async listener that rejects, with and without captureRejections.
const { EventEmitter } = require('node:events');

const plain = new EventEmitter();
const captured = new EventEmitter({ captureRejections: true });

for (const [name, ee] of [['plain', plain], ['captured', captured]]) {
  ee.on('order', async (id) => {
    throw new Error(`charge failed for order ${id}`);
  });
  ee.on('error', (err) => console.log(`${name}: 'error' listener got:`, err.message));
}

process.on('unhandledRejection', (reason) => {
  console.log('process unhandledRejection:', reason.message);
});

console.log('captured emit returned', captured.emit('order', 1));
console.log('plain emit returned', plain.emit('order', 2));

// Real output (Node v24.19.0):
//   captured emit returned true
//   plain emit returned true
//   captured: 'error' listener got: charge failed for order 1
//   process unhandledRejection: charge failed for order 2
```

The `plain` emitter's `'error'` listener never ran: its rejection went to the process. Without the `process.on('unhandledRejection')` line, a separate run of the `plain` case printed `Error: boom` and exited with code 1, even though an `'error'` listener was registered.

**Example — a class that handles its own listeners' rejections.**

javascript

```
// capture-symbol.cjs: a class decides what to do with its own listeners' rejections.
const { EventEmitter, captureRejectionSymbol } = require('node:events');

class Job extends EventEmitter {
  constructor() { super({ captureRejections: true }); }
  [captureRejectionSymbol](err, eventName, ...args) {
    console.log(`rejection from '${eventName}' listener (args ${JSON.stringify(args)}):`, err.message);
  }
}

const job = new Job();
job.on('done', async (result) => { throw new Error('could not save ' + result); });
job.emit('done', 'report.pdf');
console.log('emit returned synchronously; the rejection is routed later');
console.log('captureRejectionSymbol is', captureRejectionSymbol.toString());

// Real output (Node v24.19.0):
//   emit returned synchronously; the rejection is routed later
//   captureRejectionSymbol is Symbol(nodejs.rejection)
//   rejection from 'done' listener (args ["report.pdf"]): could not save report.pdf
```

### `errorMonitor`: observing errors without handling them

`events.errorMonitor` is a symbol you can use as an event name. A listener registered with `emitter.on(errorMonitor, fn)` runs on every `'error'` emission **before** the regular `'error'` listeners, and it does **not** count as handling the error. It is meant for instrumentation (metrics, tracing, logging) added by code that does not own the emitter. If that code added a normal `'error'` listener instead, an emitter that used to crash on an unexpected error would quietly carry on.

How it works:

1. `emit('error', err)` first calls every listener registered under `errorMonitor`, in order.
2. It then looks for regular `'error'` listeners. If there are some, they run as usual.
3. If there are none, `emit` throws `err`, exactly as it would without the monitor. `listenerCount('error')` does not include monitor listeners.

**Example — monitor first, handler second; no handler still throws.**

javascript

```
// monitor.cjs: errorMonitor sees every 'error' first and does not handle it.
const { EventEmitter, errorMonitor } = require('node:events');

const conn = new EventEmitter();
conn.on(errorMonitor, (err) => console.log('monitor (metrics/log):', err.message));
conn.on('error', (err) => console.log('handler (recovery):', err.message));
conn.emit('error', new Error('ECONNRESET'));

const bare = new EventEmitter();
bare.on(errorMonitor, (err) => console.log('monitor saw:', err.message));
try {
  bare.emit('error', new Error('no handler'));
} catch (err) {
  console.log('emit still threw:', err.message);
}
console.log('listenerCount("error"):', bare.listenerCount('error'));

// Real output (Node v24.19.0):
//   monitor (metrics/log): ECONNRESET
//   handler (recovery): ECONNRESET
//   monitor saw: no handler
//   emit still threw: no handler
//   listenerCount("error"): 0
```

### `EventTarget` and how it differs from `EventEmitter`

`EventTarget` is Node's implementation of the web platform's event API (added in v14.5.0, a global since v15.0.0, no longer experimental since v15.4.0). Node APIs that follow web standards use it: `AbortSignal` is an `EventTarget`, and so are `MessagePort` and `BroadcastChannel`. Code written against `addEventListener` therefore runs in both browsers and Node. You need to know it because some Node objects you will meet are not EventEmitters. They have no `on`/`emit`, and their error behaviour is different.

How it works:

1. `target.addEventListener(type, listener, options)` registers a function, or an object with a `handleEvent` method. Options include `once` and `signal`; aborting the signal removes the listener.
2. `target.dispatchEvent(event)` takes a single `Event` object (or a subclass such as `CustomEvent`, whose `detail` carries data; global since v19.0.0 and stable since v22.1.0 and v20.13.0). It calls the listeners synchronously in the order they were added, then returns `false` only if a cancelable event had `preventDefault()` called.
3. Node's `EventTarget` has no hierarchy, so there is no capture or bubble propagation through parent targets as in the DOM.

| | `EventEmitter` | `EventTarget` |
| --- | --- | --- |
| Register / fire | `on(name, fn)` / `emit(name, ...args)` | `addEventListener(type, fn)` / `dispatchEvent(event)` |
| What listeners receive | any number of plain arguments | one `Event` object |
| Same function added twice | called twice | ignored the second time |
| `'error'` with no listener | `emit` throws | no special meaning |
| A listener throws | the throw leaves `emit`; later listeners do not run | other listeners still run; the error is reported as an uncaught exception on `process.nextTick` |
| A listener's promise rejects | unhandled rejection unless `captureRejections` | captured and treated like a sync throw |
| Removal | `off(name, sameFn)` | `removeEventListener(type, sameFn)` or `{ signal }` |
| Extras | `prependListener`, `errorMonitor`, `newListener` event | `once` / `signal` options, `handleEvent` objects |

**Example — the same situations on both.**

javascript

```
// target.cjs: the same three situations on an EventTarget and on an EventEmitter.
const { EventEmitter } = require('node:events');

// 1. Payload: one Event object vs any number of plain arguments.
const target = new EventTarget();
target.addEventListener('order', (event) => {
  console.log('EventTarget got', event.constructor.name, event.type, event.detail);
});
target.dispatchEvent(new CustomEvent('order', { detail: { id: 7 } }));

const ee = new EventEmitter();
ee.on('order', (id, total) => console.log('EventEmitter got', id, total));
ee.emit('order', 7, 999);

// 2. The same function added twice.
let t = 0, e = 0;
const countT = () => t++;
const countE = () => e++;
target.addEventListener('ping', countT);
target.addEventListener('ping', countT);   // ignored: already registered
target.dispatchEvent(new Event('ping'));
ee.on('ping', countE);
ee.on('ping', countE);                      // added a second time
ee.emit('ping');
console.log('calls: EventTarget', t, '| EventEmitter', e);

// 3. 'error' has no special meaning on an EventTarget.
console.log('dispatch error with no listener returns', target.dispatchEvent(new Event('error')));
try { ee.emit('error', new Error('boom')); } catch (err) { console.log('EventEmitter threw:', err.message); }

// 4. Removal through an AbortSignal (an AbortSignal is itself an EventTarget).
const ac = new AbortController();
target.addEventListener('tick', () => console.log('tick'), { signal: ac.signal });
target.dispatchEvent(new Event('tick'));
ac.abort();
target.dispatchEvent(new Event('tick'));    // listener already removed
console.log('AbortSignal is an EventTarget:', ac.signal instanceof EventTarget);

// Real output (Node v24.19.0):
//   EventTarget got CustomEvent order { id: 7 }
//   EventEmitter got 7 999
//   calls: EventTarget 1 | EventEmitter 2
//   dispatch error with no listener returns true
//   EventEmitter threw: boom
//   tick
//   AbortSignal is an EventTarget: true
```

**Example — a throwing listener on each.**

javascript

```
// target-throw.cjs: a throwing listener on each kind of emitter.
const { EventEmitter } = require('node:events');

process.on('uncaughtException', (err) => console.log('uncaughtException:', err.message));

const target = new EventTarget();
target.addEventListener('save', () => { throw new Error('listener A failed'); });
target.addEventListener('save', () => console.log('EventTarget: listener B still ran'));
console.log('dispatchEvent returned', target.dispatchEvent(new Event('save')));
console.log('-- sync code after dispatchEvent continues');

const ee = new EventEmitter();
ee.on('save', () => { throw new Error('listener A failed'); });
ee.on('save', () => console.log('EventEmitter: listener B still ran'));
try { ee.emit('save'); } catch (err) { console.log('emit threw:', err.message, '(listener B never ran)'); }

// Real output (Node v24.19.0):
//   EventTarget: listener B still ran
//   dispatchEvent returned true
//   -- sync code after dispatchEvent continues
//   emit threw: listener A failed (listener B never ran)
//   uncaughtException: listener A failed
```

The `EventTarget` error cannot be caught with `try/catch` around `dispatchEvent`, because it surfaces later as an uncaught exception. Without an `uncaughtException` listener, the docs say it terminates the process.

### Common mistakes & gotchas (additional topics)

- **`async` listeners on a plain emitter.** A throw inside becomes an unhandled rejection, not an `'error'` event, and crashes the process by default. Use `captureRejections: true`, or `try/catch` inside the listener.
- **An `async` `'error'` listener.** Its own rejections are never captured, so it can crash the process while handling an error. Keep `'error'` listeners synchronous.
- **Using a normal `'error'` listener just to log.** It also marks errors as handled, so an emitter that should crash keeps running. Use `errorMonitor` for observation.
- **`for await (… of on(…))` with no way to end.** Without `close`, `signal` or `break`, the loop never finishes (edge case below).
- **Assuming `events.on` drops events while you are busy.** It buffers them all. A fast producer and a slow loop body grow that queue without limit unless the emitter supports `pause()`/`resume()` and you set `highWaterMark`.
- **Expecting `EventEmitter` habits on an `EventTarget`.** There is no `emit`, listeners get one `Event`, the same function cannot be added twice, `'error'` is not special, and `try/catch` around `dispatchEvent` does not catch a listener's throw.

### Edge case worked through: the loop that never ends, and the process that exits anyway

`events.on` cannot know that an emitter is "done". In an ES module, a top-level `for await` over it with no `close` or `signal` waits for the next event forever. When nothing else keeps the event loop alive (the timer has fired, nothing else is open), Node exits **in the middle of the loop**. The code after it never runs, and the exit code is 13, Node's code for an unsettled top-level `await`:

javascript

```
// on-hang.mjs: no 'close' event and no signal, so the loop can never end.
import { EventEmitter, on } from 'node:events';

const feed = new EventEmitter();
setTimeout(() => feed.emit('row', 1), 10);

for await (const [n] of on(feed, 'row')) {
  console.log('row', n);
}
console.log('never printed');

// Real output (Node v24.19.0), then `echo $?` printed 13:
//   row 1
//   Warning: Detected unsettled top-level await at file:///…/on-hang.mjs:7
//   for await (const [n] of on(feed, 'row')) {
//                      ^
```

With a socket or server open instead, the same loop would keep the process alive forever without printing anything. Give every `events.on` loop an exit: a `close` event (`{ close: ['end'] }`), an `AbortSignal`, or a `break` on a sentinel value.

### ⭐ Interview lens (additional topics)

> **Q: “An `async` listener throws, and the emitter has an `'error'` listener. Why does the process still crash?”**  
> A: `emit` calls listeners synchronously and discards their return values, so the rejected promise from the `async` listener has no handler and becomes an unhandled rejection (fatal by default). The `'error'` listener is only called by `emit('error')`. Enable `captureRejections: true` so the emitter attaches a rejection handler and routes the error to `'error'` (or to `Symbol.for('nodejs.rejection')`), or catch inside the listener.

> **Q: “What is the difference between `EventEmitter` and `EventTarget` in Node?”**  
> A: `EventEmitter` is Node's own API: `on`/`emit` with any number of arguments, duplicate registrations allowed, and `'error'` with no listener throws. `EventTarget` is the web API used by `AbortSignal` and similar objects: `addEventListener`/`dispatchEvent` with one `Event` object, each function registered at most once, no special `'error'`, and a throwing listener does not stop the others but surfaces as an uncaught exception. Node's `EventTarget` has no DOM-style propagation.
