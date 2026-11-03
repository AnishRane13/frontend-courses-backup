---
title: "Testing Fundamentals"
source: https://www.geekyfrontend.in/learn/nodejs-backend-kit/testing-fundamentals
course: Node.js Backend Kit
tags: [geeky-frontend, nodejs-backend-kit]
---

# Testing Fundamentals

*12 min read · Updated 24 Jul 2026 Topic 57 of 70 Bookmark Mark done Why it matters Tests are the only thing that lets a codebase grow without slowing down · Topic 57 of 70*

**Source:** [https://www.geekyfrontend.in/learn/nodejs-backend-kit/testing-fundamentals](https://www.geekyfrontend.in/learn/nodejs-backend-kit/testing-fundamentals)

---

## Say it in 30 seconds

A test is a small program that runs your real code with known inputs and checks that the result matches what you expect. We write them so a backend that handles money, login tokens, and other people's data can change without someone clicking through every endpoint by hand before each deploy. The trade-off is that a fast test of one function tells you exactly which function broke, while a slow test of the whole running system gives more confidence but only says that something in the flow failed.

## Why it matters

Tests are what let a codebase grow without slowing down. They are an executable specification, a description of what the code should do that the machine rechecks on every commit, and a regression net, a catch for the day a one-line fix breaks a login flow that already worked.

On a Node.js backend the code touches money, auth tokens, other people's data, and third-party APIs. A bug is a double-charged customer or a leaked record. Manual testing, clicking through Postman before each deploy, does not scale past a handful of endpoints and cannot run a thousand times a day in continuous integration, the system that runs your checks on every change. Tests turn "I think this still works" into "the machine just proved it in nine seconds."

In an interview, the shape of the suite is what shows experience: how much is a unit test versus an integration test, what you replace with a fake and why, how you keep the suite fast and free of flaky tests that pass and fail at random, and what is worth testing. This topic is the map. The next three go deep on each layer.

## The concept, simply

A test runs your real code with known inputs and asserts, meaning it checks, that the output matches what you expect. If the check holds, the test passes. If it throws, the test fails. Runners, mocks, and coverage are tools around that loop. A mock is a stand-in for a real dependency. Coverage is a count of which lines ran.

Tests come in layers, pictured as the testing pyramid. At the bottom, many small fast unit tests check one function in isolation. In the middle, fewer integration tests check that several pieces work together, such as a route, its middleware, and the database. At the top, a handful of slow end-to-end tests, often called e2e, drive the whole system the way a real user would. The shape is a recommendation: lots of cheap tests at the base, very few expensive ones at the peak.

![Pyramid with a wide green Unit base many fast tests a blue Integration middle and a small purple E2E tip few slow tests](assets/i54_01_87bb7548.svg)

Favour many fast unit tests at the base and only a few slow end-to-end tests at the tip.

The layers trade speed and precision against realism and confidence. A unit test runs in a millisecond and, when it fails, points at exactly one function, but it proves nothing about how the pieces fit together. An end-to-end test exercises the real system and gives enormous confidence, but it is slow, needs a running database and network, and when it fails you only learn that something in the checkout flow broke. You want most failures to be precise and cheap, so you weight the suite toward the bottom.

## How it works

**Unit tests** exercise one unit, usually a single function or class, with every collaborator replaced by a test double, a stand-in for the database, the network, the clock, or the file system. A unit test for `calculateTax()` passes in a cart and checks the number that comes back. There is no database, no HTTP, no clock, and no file system. It is deterministic, the same inputs always give the same result, and it can run thousands of times per second. A passing unit test says the function is internally correct. It does not say the function is wired into anything.

**Integration tests** exercise several real units together across a boundary. The usual backend version fires a real HTTP request at your Express app, lets it flow through routing, middleware, the controller, and a real test database, then checks the response and the database state. You replace only the outside world, such as a payment provider. These catch a wrong route path, a middleware order mistake, a schema mismatch, or a bad SQL query. They are slower because real input and output is involved.

**End-to-end tests** drive the fully deployed system, often through the actual UI or a public API, with every dependency real. For a backend-only service, that often means hitting a running instance over the network with its real database and downstream services. They give the most confidence, cost the most, and fail at random most often, because every real dependency can be slow or down. Keep very few, for critical paths such as sign up, log in, and pay.

A **test runner** discovers your test files, runs each test in isolation, catches failed checks, and reports a summary plus a process exit code. Zero means all passed. Any other code means something failed, which continuous integration reads. Node has three mainstream choices.

![Three cards Jest batteries included Vitest native ESM and TS node:test built into Node all sharing find run isolate report](assets/i54_02_dfd027b4.svg)

Jest, Vitest, and node:test differ in packaging but all discover, isolate, run, and report tests.

**Jest** is the long-standing default. It is batteries included: the runner, the check library called `expect`, mocking, coverage, and snapshot testing ship together, and it runs test files in parallel across worker processes. Its weak spot is native ES modules, JavaScript's `import` and `export` syntax, and TypeScript, which need extra transform setup. **Vitest** has a near-identical API but is built on Vite's transform pipeline, so it handles those natively and has a very fast watch mode. It fits Vite and modern TypeScript projects. **node:test** is built into Node, stable since Node 20. You import `test` from `node:test`, check with `node:assert`, and run with `node --test`. It adds no dependencies and has less rich mocking and fewer snapshots. The concepts match across all three. Only the imports change.

## Code examples

The anatomy of a test file in Jest. `describe` groups related tests; `it` (alias `test`) is one case; `expect(...).matcher(...)` is the assertion.

javascript

```
// sum.js — the code under test
function sum(a, b) {
  return a + b;
}
module.exports = { sum };
```

javascript

```
// sum.test.js — Jest discovers *.test.js automatically
const { sum } = require('./sum');

describe('sum()', () => {
  it('adds two positive numbers', () => {
    expect(sum(2, 3)).toBe(5);        // strict equality (===)
  });

  it('handles negatives', () => {
    expect(sum(-4, 1)).toBe(-3);
  });
});
```

The same test with the two other runners, to show the concepts transfer and only the imports move:

javascript

```
// node:test — built in, no install, run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from './sum.js';

test('adds two positive numbers', () => {
  assert.equal(sum(2, 3), 5);
});

// Vitest — near-identical to Jest, run with: vitest
import { describe, it, expect } from 'vitest';
import { sum } from './sum.js';

describe('sum()', () => {
  it('adds two positive numbers', () => {
    expect(sum(2, 3)).toBe(5);
  });
});
```

Wiring the runner into the project so CI and teammates run it the same way. This is the `package.json` that turns `npm test` into a gate:

javascript

```
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --runInBand"
  }
}
// CI runs `npm run test:ci`; a non-zero exit code fails the build
// and blocks the merge. That exit code is the whole point.
```

Choosing what layer a test belongs to is a judgement call. A quick heuristic in code comments:

javascript

```
// Pure logic, no I/O?            -> UNIT (mock nothing, it is already isolated)
// Route + middleware + real DB?  -> INTEGRATION (supertest + test database)
// Whole system over the network? -> E2E (few, critical paths only)
//
// Rule of thumb split for a typical backend: ~70% unit, ~20% integration,
// ~10% e2e. Adjust to where YOUR bugs actually come from.
```

## Common mistakes & gotchas

- **Chasing a coverage number.** Coverage means lines ran, even if the test checked nothing. Use it to find untested code.
- **Inverting the pyramid.** A suite that is mostly slow end-to-end tests takes a long time, fails at random, and never says where the bug is. Teams then ignore it.
- **Testing implementation instead of behaviour.** Checking that a private helper was called breaks the test on a refactor that left the result the same. Check the output.
- **A green suite that only tests the happy path.** Untested branches are silent. Green means no check threw, not that every path works.
- **A unit test that talks to a real database.** That is a slow integration test with the wrong label, and it drags the feedback loop down.
- **Shared mutable state.** Tests that pass alone and fail together usually share a module variable, a global, or a database row nobody reset.

## Best practices

- **Weight the suite toward the base.** Many fast unit tests, enough integration tests to prove the wiring, and a thin end-to-end layer for flows you cannot afford to break.
- **Make tests deterministic.** The same inputs must give the same result on every machine. Leave real time, randomness, network, and order assumptions out.
- **One behaviour per test,** named so a failure reads like a sentence.
- **Keep the suite fast** so people actually run it before pushing.
- **Make a red suite block the merge.** Tests that do not gate anything decay.
- **Pick one runner and standardise `npm test`.** Consistency matters more than which runner you chose.

## ⭐ Interview lens

> **Q: "What is the testing pyramid and why that shape?"**  
> A: The testing pyramid is a guideline for the mix of tests. A unit test checks one function with its collaborators replaced by stand-ins, so it finishes in about a millisecond and, when it fails, names that function. An integration test runs several real pieces together, such as a route, its middleware, and a test database, and catches wiring bugs. An end-to-end test drives the whole running system the way a user would, which gives the most confidence and costs the most time. You keep many unit tests, fewer integration tests, and only a handful of end-to-end tests, because you want most failures to be cheap and precise. For example, `calculateTax()` gets a unit test that passes a cart and checks the number, while sign up, log in, and pay are the slow tests. The limit is that the shape is a recommendation. A suite that is mostly end-to-end tests is slow, fails at random, and only says that something in the flow broke, so people stop trusting red.

> **Q: "Unit vs integration vs e2e — draw the line."**  
> A: A unit test exercises one function or class with every collaborator replaced by a test double, a stand-in for the database, network, clock, or file system. Nothing external runs, so the same inputs always give the same result, and the test can run thousands of times a second. An integration test crosses a real boundary: an HTTP request goes through routing, middleware, the controller, and a real test database, and you check the response and the rows that landed. An end-to-end test hits the deployed system with every dependency real. Confidence goes up and speed goes down as you move from unit to end-to-end. For example, a passing unit test of `calculateTax()` says the math is right, and an integration test is what catches a wrong route path or a bad SQL query. The limit is the label. A test that hits a real database is an integration test, even if the file is named like a unit test, and it will be slow.

> **Q: "Does 100% coverage mean the code is well tested?"**  
> A: Coverage is a count of which statements, branches, functions, and lines executed while the suite ran. One hundred percent means every counted line ran. It does not mean anyone checked the result. A test can call a function, assert nothing, and still paint those lines green. The runner gets the number by rewriting the code to increment counters, then tallying them. For example, you can reach a perfect score with tests that only prove the code did not crash, and you can have strong tests at a lower score. The limit is that coverage is a way to find forgotten code, especially an `else` that never ran. It is not proof the behaviour is correct, so treating the number as the goal produces tests that assert nothing.

> **Q: "Jest, Vitest, or node:test — how do you choose?"**  
> A: All three discover test files, run each test in isolation, report failures, and exit non-zero when something failed so continuous integration can block the merge. Jest is the long-standing batteries-included choice: `expect`, mocking, coverage, and snapshots ship together, and it runs files in parallel worker processes. Its weak spot is native ES modules and TypeScript, which need a transform. Vitest keeps a near-identical API and uses Vite's pipeline, so those work without that setup, and watch mode is very fast. node:test is built into Node and has been stable since Node 20: import `test` from `node:test`, check with `node:assert`, run `node --test`, and install nothing. It is leaner on rich mocking and snapshots. For example, the same "sum of 2 and 3 is 5" test changes only its import across the three. The limit is the repo you already have. Pick from its module system and tooling. The ideas, arrange then act then assert, mocks, and coverage, stay the same.

## Cheat-card

- **Test =** run real code with known input, check the output. Pass, or throw.
- **Pyramid:** many unit tests, some integration tests, few end-to-end tests.
- **Unit:** one function, stand-ins for collaborators, no input or output wait, milliseconds.
- **Integration:** route, middleware, and a real test database.
- **End-to-end:** the full system, real dependencies, critical paths only.
- **Runners:** Jest is batteries included, Vitest handles ES modules and TypeScript natively, node:test is built in since Node 20.
- **A runner** discovers, isolates, runs, reports, and sets the exit code for continuous integration.
- **Coverage counts lines that ran.** It does not prove behaviour.
- **A good test** checks one behaviour, stays deterministic and fast, and survives a refactor that keeps the same result.

## Good to know

- **Why write tests if the first line is slower?** The cost is up front. After that they document the intended behaviour and catch a break in seconds instead of in production, which matters when the code touches money and auth.
- **What makes a good test?** It checks one observable behaviour, is deterministic and fast, fails clearly when that behaviour breaks, and stays green when internals change but the result does not.

---

## Learn More

- [React Testing Library — intro testing-library.com](https://testing-library.com/docs/react-testing-library/intro)
- [Jest — official docs jestjs.io](https://jestjs.io)
- [Unit, integration & e2e tests YouTube](https://www.youtube.com/watch?v=r9HdJ8P6GQI)
- [When to unit, e2e & integration test YouTube](https://www.youtube.com/watch?v=isI1c0eGSZ0)
- [Static, unit, integration & e2e explained YouTube](https://www.youtube.com/watch?v=TLccnKIMggA)
