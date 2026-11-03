---
title: "Mocking &amp; Coverage"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/mocking-coverage
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Mocking &amp; Coverage

*13 min read · Updated 24 Jul 2026 Topic 60 of 70 Bookmark Mark done Why it matters Real code has dependencies you cannot or should not call for real in a test · Topic 60 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/mocking-coverage](https://www.geekyfrontend.in/learn/nodejs-backend-kit/mocking-coverage)

---

## Say it in 30 seconds

A test double is a stand-in that lets a test control a dependency it should not call for real, such as a payment API, and record how that dependency was called. Coverage then counts which lines and branches actually ran, so you can see the error path nobody tested. The trade-off is that doubles and a high coverage number can both look healthy while proving little: if you replace your own logic, or if a test asserts nothing, the suite stays green and production still breaks.

## Why it matters

Real code calls things you should not call in a test: a payment API that charges money, an email service, a clock that changes the result by the day, a database you want out of a pure unit test. Test doubles, the family of spies, stubs, and mocks, cut those out so the test can run fast, offline, and can force a timeout or a 500 that is hard to trigger for real.

Coverage is a map of which lines and branches ran. Its best use is the untested error path. A junior treats 100% as the goal. The number measures execution, not correctness.

Flaky tests pass and fail with no code change. Once people re-run until green, they stop trusting red. The usual causes are real time, shared state, order, and async work nobody waited for.

## The concept, simply

A **spy** records how a function was called, arguments and call count, and can still let the real function run. It observes. A **stub** replaces a function with a canned return value so you control what a dependency gives back. A **mock** is a stub plus expectations about how it should be called. It controls the input and verifies the interaction.

![Three cards Spy records calls Stub returns canned values Mock stub plus expectations with a note that jest.fn is all three](assets/i57_01_d5bd1b3d.svg)

Spies observe calls, stubs control return values, and mocks add expectations. Jest's `jest.fn()` does all three.

Jest blurs the three on purpose. One `jest.fn()` records every call in `.mock.calls`, returns what you set with `mockReturnValue`, and can be checked with `toHaveBeenCalledWith`. You should still be able to define the three. Libraries such as Sinon keep them separate.

**Coverage** reports four numbers: statement, branch, function, and line. Branch coverage asks whether both sides of every `if` ran. The untested `else` is where bugs hide.

![Four boxes Statement each line ran Branch both if else sides Function each function called Line source lines executed with a note that coverage proves lines ran not correctness](assets/i57_02_c113eff1.svg)

The four coverage metrics. Branch coverage, checking both sides of every decision, is the one that matters most.

## How it works

`jest.fn()` makes a standalone mock function. `jest.spyOn(object, 'method')` wraps an existing method so you can observe it and restore the original. By default `spyOn` calls through to the real implementation until you add `mockReturnValue`. `jest.mock('./module')` replaces a whole module with generated mock functions, which is how you neutralise a payments client or `fs`.

**Module mocks are hoisted.** Jest lifts `jest.mock()` above the imports, so the mock exists before the code under test loads its dependency. That is why a mock written below the import still works. In Vitest, `vi.mock()` is also hoisted, and in ES modules you sometimes need `vi.hoisted()` for values used inside the factory.

**Fake timers** replace real timers and `Date.now()`. `jest.useFakeTimers()`, then `jest.advanceTimersByTime(1000)` skips a second instantly, and `jest.setSystemTime(date)` pins now. A 30-minute delay runs in microseconds. Call `jest.useRealTimers()` afterward so the fake does not leak.

**Coverage** is measured by instrumentation: the runner rewrites your code to increment counters, runs the suite, and tallies them. Jest uses `--coverage` on top of Istanbul. Vitest uses `--coverage` with v8 or Istanbul. node:test uses `--experimental-test-coverage`. You can set a threshold, for example fail the build under 80% branch coverage. That is a floor, not a target. A test that calls a function and checks nothing still marks the lines it touched.

**A flaky test** is non-deterministic. Usual causes: real time, shared state, dependence on test order, a promise nobody awaited, a real network call, or a time-zone assumption. Remove the source and control it. Do not re-run until green.

## Code examples

The three faces of `jest.fn()` — spy, stub, and verification — in one place:

javascript

```
const fn = jest.fn();          // a mock function

fn.mockReturnValue(42);        // STUB: control what it returns
const out = fn('a', 'b');

expect(out).toBe(42);
expect(fn).toHaveBeenCalledTimes(1);            // SPY: it recorded the call
expect(fn).toHaveBeenCalledWith('a', 'b');      // MOCK: verify the interaction
expect(fn.mock.calls[0]).toEqual(['a', 'b']);   // raw record of arguments
```

Mocking a whole module so the code under test never touches the real service. Here we test that our code reacts correctly to a gateway *failure* — a condition that's hard to trigger for real:

javascript

```
// jest.mock is hoisted above the imports, so the mock is ready first
jest.mock('./services/payments');
const payments = require('./services/payments');
const { placeOrder } = require('./orders');

describe('placeOrder()', () => {
  afterEach(() => jest.clearAllMocks()); // reset call history between tests

  it('returns a friendly error when the gateway declines', async () => {
    // STUB: force the dependency to reject
    payments.charge.mockRejectedValue(new Error('card_declined'));

    const result = await placeOrder({ item: 'book', amount: 500 });

    expect(result).toEqual({ ok: false, reason: 'payment_failed' });
    // MOCK: verify we called the gateway with the right amount
    expect(payments.charge).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500 })
    );
  });
});
```

`spyOn` to observe a real method, and to restore it afterward so nothing leaks:

javascript

```
it('logs a warning on a retry', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

  retryOnce(() => { throw new Error('boom'); });

  expect(warn).toHaveBeenCalledWith(expect.stringContaining('retrying'));
  warn.mockRestore(); // put the real console.warn back
});
```

Mocking time with fake timers — a debounce that fires after 300ms is tested in microseconds:

javascript

```
it('calls the handler once after the debounce window', () => {
  jest.useFakeTimers();
  const handler = jest.fn();
  const debounced = debounce(handler, 300);

  debounced();
  debounced();                       // called twice in quick succession
  expect(handler).not.toHaveBeenCalled();

  jest.advanceTimersByTime(300);     // fast-forward, no real waiting
  expect(handler).toHaveBeenCalledTimes(1);

  jest.useRealTimers();              // always restore
});

// Pinning "now" for a date-dependent function:
it('stamps the fixed current time', () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  expect(makeTimestamp()).toBe('2026-01-01T00:00:00.000Z');
  jest.useRealTimers();
});
```

Enforcing a coverage floor in `jest.config.js` so coverage can't silently rot — a gate, not a vanity number:

javascript

```
// jest.config.js
module.exports = {
  collectCoverage: true,
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
};
// Run: jest --coverage  ->  build FAILS if branch coverage drops below 80%.
// Note: branches is set lower on purpose — it is the hardest and most useful.
```

## Common mistakes & gotchas

- **Not resetting mocks between tests.** Call history and canned returns persist in the file. Use `clearAllMocks` or `resetAllMocks` in `beforeEach`, or `clearMocks: true`.
- **Not restoring `spyOn` or fake timers.** A leftover spy or fake clock leaks into later tests. Call `mockRestore()` and `useRealTimers()`.
- **Replacing so much that the test never runs your logic.** It passes no matter what the real code does.
- **Treating 100% as well tested.** High coverage with weak assertions is false confidence.
- **Ignoring branch coverage.** Line coverage can look fine while an `else` never ran.
- **Re-running a flaky test until it passes.** That hides real time, shared state, or a floating promise.
- **Mocking the function under test.** Mock its collaborators.
- **A hand-written mock that no longer matches the real dependency.** Tests stay green and production breaks. Prefer auto-mocks and keep them honest.

## Best practices

- **Reset mocks between tests** with `clearMocks: true` or `jest.clearAllMocks()` in `beforeEach`.
- **Restore spies and real timers** so a double cannot leak.
- **Replace the network, the clock, and the payment gateway.** Leave your own decisions real.
- **Use fake timers** for debounce, retry, and expiry.
- **Read the uncovered-lines report,** especially branches, and look for the error path you forgot.
- **Set a coverage floor in CI.** Do not chase 100%.
- **Treat every flaky test as a bug.** Find the non-determinism and fix it.

## ⭐ Interview lens

> **Q: "Difference between a mock, a stub, and a spy?"**  
> A: A spy observes. It records arguments and how many times a function was called, and the real function can still run. A stub replaces the function with a canned return so you control what a dependency gives back. A mock is a stub plus an expectation you verify, such as "it was called with this amount." In Jest one `jest.fn()` is all three: `.mock.calls` is the spy, `mockReturnValue` or `mockRejectedValue` is the stub, and `toHaveBeenCalledWith` is the mock check. `jest.spyOn` wraps a real method and calls through until you override it. `jest.mock('./module')` replaces a whole module, and Jest hoists that call above the imports. For example, stub `payments.charge` to reject with `card_declined`, then expect your order function to return `payment_failed` and to have called `charge` with the amount. The limit is that Jest's one function blurs the words. Sinon keeps them separate, and interviewers still want the three definitions. Also reset call history between tests, or one test sees another's calls.

> **Q: "Does 100% coverage mean your code is well tested?"**  
> A: Coverage counts which statements, branches, functions, and lines executed. The runner rewrites the code to bump counters, runs the suite, and prints the percentages and the uncovered lines. One hundred percent means every counted line ran. It does not mean any test checked the result. A call with no `expect` still paints those lines covered. Branch coverage is the useful one, because line coverage can be high while an `else` or an error path never ran. For example, a threshold of 80% branches in `coverageThreshold` fails the build when that floor drops, which stops silent erosion. The limit is using the number as the goal. One hundred percent with weak assertions is worse than a lower number with strong checks. Coverage finds forgotten code. It is not proof of correctness.

> **Q: "How do you test code that depends on the current time or a timer?"**  
> A: Fake timers replace `setTimeout`, the clock, and `Date.now()` with versions you control. `jest.useFakeTimers()` installs them, `advanceTimersByTime(300)` skips the wait instantly, and `setSystemTime` pins now. A debounce of 300 milliseconds, or a job that fires after 30 minutes, then finishes in microseconds and gives the same result every run. The other approach is to pass the clock in as a parameter so the function never reads the real time. For example, call a debounced handler twice, assert it has not run, advance 300 milliseconds, and assert it ran once. The limit is leakage. Fake timers left on will break later tests that expect real time, so you always call `jest.useRealTimers()` before the test ends. The same restore rule applies to `spyOn`.

> **Q: "Which coverage metric matters most and why?"**  
> A: Branch coverage. Statement, function, and line coverage ask whether a line or a function ran. Branch coverage asks whether both outcomes of a decision ran, the `if` and the `else`, the error path and the guard. A file can show high line coverage while the negative case never executed, and that missing side is where bugs hide. Jest, Vitest, and node:test can all emit the four numbers. Jest's report lists the exact uncovered lines, and a `coverageThreshold` on `branches` can fail the build. For example, set branches at 80 and lines a bit higher, because branches are harder and more useful. The limit is the same as any coverage number: a branch that ran is not a branch whose result you asserted. Read the uncovered branches to find the missing case. Do not treat the percentage as proof.

## Cheat-card

- **Spy** observes calls. **Stub** returns a canned value. **Mock** is a stub plus a check that it was called the right way.
- **`jest.fn()`** is all three. **`spyOn`** wraps a real method. **`jest.mock()`** replaces a module and is hoisted.
- **Reset between tests** with `clearMocks` or `jest.clearAllMocks()`. Restore spies with `mockRestore()`.
- **Fake time:** `useFakeTimers()`, then `advanceTimersByTime()` or `setSystemTime()`. Always `useRealTimers()` after.
- **Four coverage numbers:** statement, branch, function, line. Branch matters most.
- **Coverage counts lines that ran.** Use a floor in CI, not a target of 100%.
- **Replace boundaries** such as network, clock, and third parties. Keep your own logic real.
- **Flaky causes:** real time, shared state, order, a promise nobody awaited, a real network. Fix the cause.

## Good to know

- **A test that fails about one run in twenty** is a real bug. The cause is almost always real time, shared state, order dependence, or a promise that resolves after the test ends. Reproduce it, remove that source, and do not retry until green.
- **Over-mocking** means the test passes no matter what the real logic does, breaks when internal calls change, and can drift from the real dependency so production fails while the suite stays green. Replace only true boundaries.
- **`jest.mock()` written below the import still works** because Jest hoists it above the imports. A factory cannot use variables declared later in the file unless you use the hoist-aware helpers. Vitest's `vi.mock()` is hoisted too, and ES modules sometimes need `vi.hoisted()`.

---

## Learn More

- [Jest: Mock Functions jestjs.io](https://jestjs.io/docs/mock-functions)
- [Jest: Configuring code coverage (collectCoverage, coverageThreshold) jestjs.io](https://jestjs.io/docs/configuration)
- [Node.js test runner: mocking & code coverage nodejs.org](https://nodejs.org/api/test.html)
- [Testing with Jest - Mock Function Piotr N](https://www.youtube.com/watch?v=sVX6LNiNAeA)
