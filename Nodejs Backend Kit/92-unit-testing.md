---
title: "Unit Testing"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/unit-testing
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Unit Testing

*11 min read · Updated 24 Jul 2026 Topic 58 of 70 Bookmark Mark done Why it matters Unit tests are the workhorses of any healthy suite · Topic 58 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/unit-testing](https://www.geekyfrontend.in/learn/nodejs-backend-kit/unit-testing)

---

## Say it in 30 seconds

A unit test calls one function with known inputs and checks the return value, after you have replaced anything that would touch a database, the network, the clock, or the file system. It exists so a failure names the exact function, and so code that is hard to test gets split into pure decisions you can call with plain data. The trade-off is that a passing unit test says the function is correct on its own, and says nothing about whether the route, the middleware, and the database are wired together.

## Why it matters

Unit tests are the wide base of the pyramid. You run them hundreds of times a day, they finish immediately, and a red one names the function you just broke. That localisation of failure is why they earn their keep. An integration failure says the orders endpoint returned 500. A unit failure says `calculateDiscount()` returned 0 for a 10% coupon.

They also pressure the design. Code that is hard to unit-test usually does too much, reaches for globals, or builds its own dependencies. "How would you make this testable?" in an interview is really "do you understand passing dependencies in, and pure functions?" A pure function's output depends only on its inputs and it causes no side effects.

## The concept, simply

A unit test feeds one function or method known inputs and checks the output. Every external collaborator is replaced or absent, so the test is deterministic, the same input always gives the same result, and fast, because there is no input or output to wait on.

The skeleton is Arrange, Act, Assert. Arrange sets up the inputs. Act calls the one thing under test. Assert checks the observable result. Blank lines between the three make the intent obvious.

![Three boxes left to right Arrange set up inputs Act call the unit under test Assert check the observable result with arrows between them](assets/i55_01_429a8718.svg)

Every unit test is Arrange, then Act, then Assert: set up, do the one thing, check the result.

The assertion is the heart: `expect(result).toBe(5)`. If reality disagrees, it throws and the runner marks the test failed. `toBe` is for primitives, using strict equality. `toEqual` is deep equality for objects and arrays. `toThrow` is for an expected error. A test with no assertion only proves the code did not crash.

## How it works

The runner finds your test files. For each `it()` it runs the callback inside a try/catch. If the callback returns without throwing, the test passes. A failed `expect` throws, and the runner records the message and moves on. One failure does not stop the other tests. Jest runs separate test files in parallel worker processes, which is why tests must not share mutable global state.

What counts as a unit is a judgement. A useful definition is a piece of behaviour you would want to check on its own, often one function, sometimes a few pure helpers that only make sense together. The line that matters is the boundary. The moment the code would reach for input or output, a database call, an HTTP request, the clock, or the file system, a unit test stops. You pass in a fake, or you split the logic out.

Three techniques make code testable.

**Prefer pure functions.** Pass input, check output, no setup. Separate the decision, such as which discount applies, from the effect, such as saving the order.

**Pass dependencies in instead of creating them inside.** If the function builds its own database client, a test cannot replace it. If it receives the client as a parameter, the test hands it a fake. That is dependency injection.

**Pin anything that changes between runs.** `Date.now()`, `Math.random()`, and `process.env` should come in as a parameter or a small wrapper, so the test can fix the value.

## Code examples

A pure function and its unit tests, in clean AAA form. Notice the blank lines splitting the three phases and the one-behaviour-per-test discipline:

javascript

```
// discount.js
function calculateDiscount(price, coupon) {
  if (price <= 0) throw new Error('price must be positive');
  if (!coupon) return price;
  if (coupon.type === 'percent') {
    return price - (price * coupon.value) / 100;
  }
  return Math.max(0, price - coupon.value);
}
module.exports = { calculateDiscount };
```

javascript

```
// discount.test.js
const { calculateDiscount } = require('./discount');

describe('calculateDiscount()', () => {
  it('applies a percentage coupon', () => {
    // Arrange
    const price = 200;
    const coupon = { type: 'percent', value: 10 };

    // Act
    const result = calculateDiscount(price, coupon);

    // Assert
    expect(result).toBe(180);
  });

  it('never returns a negative price for a large flat coupon', () => {
    const result = calculateDiscount(50, { type: 'flat', value: 80 });
    expect(result).toBe(0);
  });

  it('returns the full price when there is no coupon', () => {
    expect(calculateDiscount(99, null)).toBe(99);
  });

  it('throws on a non-positive price', () => {
    // note: pass a FUNCTION to toThrow, or the throw escapes the assertion
    expect(() => calculateDiscount(0, null)).toThrow('price must be positive');
  });
});
```

Untestable versus testable, side by side. The first function reaches for the clock and a hard-wired dependency; the second receives them, so a test can control both:

javascript

```
// HARD to unit-test: hidden clock + self-created dependency
const db = require('./db');
async function createTrialUser(email) {
  const expiresAt = new Date(Date.now() + 7 * 864e5); // real clock
  return db.users.insert({ email, expiresAt });        // real DB
}

// EASY to unit-test: dependencies injected
function makeTrialUser({ now }) {
  return function build(email) {
    const expiresAt = new Date(now + 7 * 864e5);
    return { email, expiresAt }; // pure: returns data, no I/O
  };
}
```

javascript

```
// makeTrialUser.test.js — a fixed clock makes the result deterministic
const { makeTrialUser } = require('./trial');

it('sets a 7-day expiry from the injected clock', () => {
  const now = new Date('2026-01-01T00:00:00Z').getTime();
  const build = makeTrialUser({ now });

  const user = build('a@b.com');

  expect(user.expiresAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
});
```

Choosing the right matcher matters — `toBe` compares by identity, so it fails on two distinct-but-equal objects:

javascript

```
const a = { id: 1, tags: ['x'] };

expect(a).toBe({ id: 1, tags: ['x'] });   // FAILS: different references
expect(a).toEqual({ id: 1, tags: ['x'] }); // PASSES: deep structural equality
expect(a.id).toBe(1);                       // OK: primitives compare by value
```

## Common mistakes & gotchas

- **Not awaiting an async check.** The test finishes and passes before the assertion runs. A rejection then shows up as an unhandled rejection. `await` the expectation, or return it.
- **Passing a value to `toThrow`.** `expect(fn()).toThrow()` calls `fn` immediately, so the error escapes. Use `expect(() => fn()).toThrow()`.
- **`toBe` on objects or arrays.** `toBe` is `Object.is`, reference identity. Use `toEqual` for contents.
- **No real assertion.** Calling the function and checking nothing inflates coverage and confidence.
- **Mocking your own logic.** If every collaborator is fake, you are checking the fakes. Replace boundaries, and leave your decision code real.
- **Real `Date.now()` or `Math.random()` inside the function.** The test passes today and fails on a date boundary or one run in a thousand.
- **Five unrelated checks in one test.** The first failure hides the rest.

## Best practices

- **Show Arrange, Act, Assert** with blank lines between them.
- **One behaviour per test,** named as a sentence.
- **Push decisions into pure functions** so most of the system needs no setup.
- **Pass in the database, the clock, randomness, and config.**
- **Check return values and observable effects,** so a refactor that keeps the behaviour stays green.
- **Cover zero, empty, negative, boundary, and thrown-error cases.**
- **Each test arranges its own world.** No test should need another test to run first.

## ⭐ Interview lens

> **Q: "What exactly is a 'unit', and what do you mock in a unit test?"**  
> A: A unit is the smallest piece of behaviour you would check on its own, usually a function or a method. The test calls it with known inputs and checks the return value. Anything that crosses a boundary gets replaced: the database, network calls, the clock, the file system, and randomness. Your own pure logic stays real, because faking it would mean the test only checks the fake. Jest runs each test so that a throw fails that test and the others still run, and it runs files in parallel, so tests cannot share mutable globals. For example, `calculateDiscount(200, { type: 'percent', value: 10 })` should return 180, with no database involved. The limit is the boundary. The moment the code would do input or output, you pass a fake or split the decision out. A test that hits a real database is no longer a unit test, and it will not stay in the millisecond range.

> **Q: "What is Arrange-Act-Assert?"**  
> A: Arrange, Act, Assert is the shape of one test. Arrange sets up the inputs and any state. Act calls the single thing under test, once. Assert checks the observable result, with `expect` and a matcher such as `toBe`, `toEqual`, or `toThrow`. Blank lines between the three make the test readable, and they keep you to one action and one expectation. The runner treats a throw from the assert as a failure and moves on to the next test. For example, arrange a price of 200 and a 10% coupon, act by calling `calculateDiscount`, and assert that the result is 180. The limit shows up when you need a second act. That is usually a second test. A test that asserts five unrelated things hides every failure after the first.

> **Q: "This function is hard to test — how would you fix it?"**  
> A: Hard to test almost always means the function builds its own dependencies or reaches for the clock or randomness inside itself. Dependency injection fixes the first part: the function receives the database client, the current time, or the config as a parameter, and the test passes a fake. The second part is splitting a pure decision, output depends only on inputs and there are no side effects, away from the effect such as saving a row. After that, the test is pass fakes, check the output. For example, a trial-user helper that calls `Date.now()` and inserts into a real database cannot be pinned down. The same helper that receives `now` and returns `{ email, expiresAt }` can be checked against a fixed date. The limit is that you still have not proved the route writes the row. That wiring belongs in an integration test. The unit test only owns the decision.

> **Q: "toBe vs toEqual?"**  
> A: `toBe` uses `Object.is`, which for normal values is strict equality, `===`. It is the right matcher for numbers, strings, booleans, and for asserting that two variables are the same object. `toEqual` walks objects and arrays and compares their contents, so two different objects with the same fields pass. Jest fails the test when the matcher throws. For example, `expect({ id: 1 }).toBe({ id: 1 })` fails because the objects are different references, and `toEqual` passes. `expect(a.id).toBe(1)` is fine because `1` is a primitive. The limit is using `toBe` on values that look equal and are not the same reference. That is a false failure. The matching trap on errors is `toThrow`: you must pass a function, `expect(() => fn()).toThrow()`, or the error escapes before `expect` can catch it.

## Cheat-card

- **Unit test =** one function, known input, check the output, no waiting on input or output.
- **Arrange, Act, Assert:** set up, call once, check the result.
- **Matchers:** `toBe` for identity, `toEqual` for deep contents, `toThrow` with a function wrapper.
- **Testable code** is pure functions, injected dependencies, and a clock or random source you can pin.
- **Async:** `await` the check, or the test passes before it runs.
- **`toThrow`:** pass `() => fn()`, never `fn()`.
- **Check behaviour,** so a refactor that keeps the result stays green.
- **One behaviour per test.** Cover edges and errors.
- **Hard to test means badly decoupled.** Pass dependencies in.

## Good to know

- **How do you test code that uses the current date or a random value?** Pass the clock or the random source in as a parameter, or freeze time with the runner's fake timers, `jest.useFakeTimers()` or `vi.setSystemTime()`, so the same test gives the same result on every machine.
- **A test can pass while the code is buggy** when it has no real assertion, when an async check runs after the test already finished, or when it asserts on a fake instead of the observable output. Green means no assertion threw.

---

## Learn More

- [Node.js Test Runner (node:test) nodejs.org](https://nodejs.org/api/test.html)
- [Discovering Node.js's test runner nodejs.org](https://nodejs.org/en/learn/test-runner/introduction)
- [Jest: Getting Started jestjs.io](https://jestjs.io/docs/getting-started)
- [Jest Crash Course - Unit Testing in JavaScript Traversy Media](https://www.youtube.com/watch?v=7r4xVDI2vho)
