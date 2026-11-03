# React Problem-Solving Guide
*A methodology and reference for solving unfamiliar React problems live, under time pressure — not a syntax refresher*

This document is for someone who already knows React, has shipped production apps, and can explain what `useEffect` does in the abstract — but who freezes the moment an interviewer says "build a debounced search box" and the blank page starts feeling like a countdown. The gap being addressed here isn't knowledge of React's API; it's a repeatable **process** for turning an unfamiliar prompt into working code without panicking. Every hook and pattern below is treated the same way: the theory of what breaks without it, the full mental model (not just the syntax), a fully narrated worked example, the real bugs people write with it, a spot-the-bug exercise, and what an interviewer is actually evaluating when they reach for this topic.

---

## PART 0: Rules & Methodology for Solving Unfamiliar React Problems

**Read this section before anything else in this document. Every worked problem later on explicitly follows this methodology — it's not a one-time pep talk, it's the actual repeatable process.**

### 0.1 The 5-Step Approach to Any Unfamiliar Problem

**Step 1 — Clarify requirements out loud, before writing a single line of code.**

The instinct under time pressure is to start typing immediately, because typing feels like progress and silence feels like failure. This is backwards — writing code before you know what you're building produces a first draft you'll have to half-rewrite once you realize what was actually being asked, which costs *more* time than 60 seconds of questions up front. Before touching the editor, say out loud (literally, in the interview):

- **What are the inputs?** Props? User interaction? Both?
- **What should trigger a re-render, specifically?** Every user keystroke? Only after a delay? Only on submit?
- **What are the edge cases the interviewer cares about, even if unstated?** Empty state (no data yet), loading state (request in flight), error state (request failed), and — very commonly missed — what happens on **rapid repeated actions** (double-clicking a submit button, typing faster than a debounce window, re-triggering a fetch before the last one resolves).

Asking these questions isn't stalling — in a live interview, it's the single highest-signal thing you can do in the first two minutes, because it visibly demonstrates the exact skill that separates "knows React syntax" from "can build correct systems with it."

**Step 2 — Identify what STATE the component actually needs, before writing any JSX.**

For every piece of data the component touches, explicitly classify it into one of three buckets, and be ready to justify the classification out loud:

- **State** (`useState`/`useReducer`) — a value that changes over the component's lifetime *and* whose change must cause the UI to re-render. Test: "if this value changes, does something on screen need to look different right now?" If yes, it's state.
- **Ref** (`useRef`) — a value that needs to persist across renders (survive the component function re-running) but whose change should **not** cause a re-render on its own. Common examples: a `setInterval` ID you need to clear later, a "have I already fired this fetch" flag, a reference to a DOM node.
- **Plain variable / derived value** — a value fully computable, on the spot, from existing state and props during render. This should never be stored in state at all (Step 3 below goes deeper on this, since it's one of the single most common interview mistakes).

**Step 3 — Identify what's DERIVED vs what's STORED.**

**The rule, stated precisely**: *if a value can be calculated during render purely from state and/or props you already have, do not put it in its own `useState` call.* Storing it redundantly creates two problems: first, you now have two sources of truth that can drift out of sync (the classic bug where a "total" field in state silently goes stale because someone updated the underlying items array but forgot to also update the separately-stored total); second, it's genuinely unnecessary code and unnecessary re-render triggers.

```jsx
// WRONG — filteredTodos is redundant, derived state that can desync from todos/filter
function TodoList({ todos, filter }) {
  const [filteredTodos, setFilteredTodos] = useState([]);

  useEffect(() => {
    setFilteredTodos(todos.filter(t => filter === 'all' || t.status === filter));
  }, [todos, filter]);
  // ...
}

// RIGHT — computed directly during render, every single render, always in sync by construction
function TodoList({ todos, filter }) {
  const filteredTodos = todos.filter(t => filter === 'all' || t.status === filter);
  // ...
}
```

The corrected version needs no `useEffect`, no extra state variable, and can never go stale — because it's recomputed fresh, from the current values, every single time the component renders. This exact pattern — "I don't need an Effect for this, I can just compute it during render" — is one of the highest-value instincts you can develop, and it comes up constantly in Part 3.

**Step 4 — Sketch the component's data flow before coding.**

In plain language, trace the causal chain: *user types → local state updates on every keystroke → an effect watches the debounced value → after the delay, an API call fires → response arrives → data state updates → component re-renders with results.* Saying this sentence out loud, before writing code, is what prevents the mid-solution moment of "wait, what was supposed to trigger the fetch again?"

**Step 5 — Write the skeleton first, then wire up state, then wire up effects/handlers.**

Concretely, in this order:
1. **JSX skeleton with hardcoded/dummy data** — get something rendering on screen immediately, with fake values standing in for real state (`const results = ['Result A', 'Result B']` as a placeholder, before any state or fetching exists at all).
2. **Wire up state** — replace the hardcoded values with real `useState`/`useReducer` calls, and wire up the event handlers that update them (typing, clicking, etc.) — verify the UI now responds correctly to interaction, still with no side effects yet.
3. **Wire up effects and async logic last** — only once the state layer is confirmed working, add the `useEffect` that talks to the outside world (fetch, timers, subscriptions).

**Why this order specifically reduces panic under time pressure**: at every single step, there is something visibly working on screen. You are never staring at a blank page for the entire allotted time trying to get everything correct simultaneously — you have a skeleton within the first 2 minutes, interactive state within the first 10, and you're only debugging the hardest part (async/effects) once everything else is already known-good, which means when something breaks at that point, you know with certainty it's in the effect, not somewhere else in a large pile of code you wrote all at once.

### 0.2 The Rules-of-Thumb Checklist — Run This Mentally on Every Problem

- **Does this need to be state, a ref, or a derived value?** (Step 2/3 above.)
- **If I'm using `useEffect`, what EXACTLY am I synchronizing with an external system?** If the honest answer is "nothing external, I'm just computing something from props/state," you probably don't need an Effect at all — compute it during render instead. This is explicitly called "You Might Not Need an Effect" in React's own documentation, and it's the single most common *overuse* pattern experienced developers still fall into: reaching for `useEffect` to derive state, to respond to a prop change by setting more state, or to handle an event that actually happened inside a specific event handler (a click, a submit) rather than as a generic side effect of rendering.
- **Does my dependency array include everything referenced inside the effect/callback?** In a real codebase, `eslint-plugin-react-hooks`'s `exhaustive-deps` rule would flag any mismatch automatically — but a live interview typically has no linter running, so you need to be able to reason about this by hand: read every variable referenced inside the effect body, and ask "does this specific effect need to re-run if THIS particular value changes?" If yes, it belongs in the array.
- **Am I mutating state directly anywhere** — pushing into an array, setting a property directly on an object — **instead of creating a new reference?** (Full theory in Part 2.4 and Part 6.5's reducer section — this is the single most common bug pattern across both `useState` and `useReducer`.)
- **If this list/array can change, do my keys make sense** — stable, unique, and specifically **not** the array index if the list can reorder, filter, or have items removed from the middle? (Full theory and a concrete broken example in Part 1.4.)
- **If I have async operations** (`fetch`, `setTimeout`, `setInterval`), **have I handled what happens if the component unmounts, or the relevant input changes, before the operation resolves?** This is the cleanup/race-condition category of bug, covered in full in Part 3.
- **Am I over-using `useMemo`/`useCallback`** in places where the wrapped computation is cheap and no memoized child or dependency array is actually consuming the stable reference? Memoization itself has a cost (extra memory to store the cached value, extra comparison work every render) — wrapping everything "just in case" is a real, if lower-severity, mistake (full discussion in Part 5.4).

### 0.3 How to Handle Being Stuck or Blanking Mid-Interview

**The single biggest silent mistake is going silent.** An interviewer evaluating a live coding round is watching your *reasoning process* far more than they're grading the final diff — a candidate who narrates a structured, if imperfect, train of thought consistently reads as stronger than one who goes quiet for two minutes and then produces a correct answer out of nowhere, because the interviewer has no way to distinguish "silently reasoning correctly" from "silently guessing and got lucky," and has to default to assuming the less generous interpretation.

**A concrete script for what to actually say, out loud, when stuck:**

- *"Let me back up and think about what state this component actually needs, rather than jumping straight into JSX — I want to make sure I'm not missing a piece of state or introducing something redundant."*
- *"I'm not 100% sure if this needs to be an effect or if I can just compute it during render — let me think through whether anything external is actually involved here."*
- *"I think there might be a stale closure issue here, since this callback is referencing a value from the render it was created in — let me check whether I need the functional update form, or whether this belongs in a ref instead."*
- *"I want to make sure I'm handling the case where the user clicks this twice quickly, or where the component unmounts before this promise resolves — let me address that explicitly before moving on."*

None of these statements require you to already know the answer — they demonstrate that you know **which question to ask**, which is the actual skill being tested. Silence demonstrates nothing; a wrong guess spoken out loud at least gives the interviewer something to redirect.

### 0.4 Time Management for a Typical 30–45 Minute Live Coding Round

| Phase | Rough budget | What's actually happening |
|---|---|---|
| Clarify requirements + plan out loud | 3–5 min | Step 1–4 of the methodology above |
| JSX skeleton with dummy data | 5 min | Something visible on screen; confirms the basic shape is right before any logic exists |
| Core state + event handlers | 10–15 min | The interactive heart of the problem — the part that's usually actually being evaluated |
| Effects / async logic | 5–10 min | Wiring up the external-system synchronization, once the state layer is proven correct |
| Edge cases + polish | 5–10 min | Loading/error/empty states, cleanup, accessibility basics — see 0.5 below |

**It is fine, and genuinely expected, to not finish a "perfectly polished" solution in this window.** Interviewers weight **correct reasoning and clean, visibly-incremental progress** far more heavily than a fully complete, edge-case-proof final product — a candidate who runs out of time with a clearly-structured, mostly-correct component and a clear verbal explanation of exactly what's left to do ("I'd still want to add a loading spinner here and debounce this input, but I ran low on time") is a stronger signal than a candidate who rushed to "finish" and produced a tangled, bug-riddled component with no narration at all.

### 0.5 Edge Cases to Always Consider and Mention Out Loud — Even If Not Asked

- **Empty/initial state** — what does the component render before any data exists at all?
- **Loading state** — what does the user see while an async operation is in flight?
- **Error state** — what does the user see if a request fails, and can they retry?
- **Rapid/duplicate user actions** — double-clicking a submit button, typing faster than a debounce window, re-triggering a fetch before the previous one resolves.
- **Unmounting mid-async-operation** — does a `setState` call fire after the component is already gone, and does the code guard against it?
- **Very large lists** — would this approach visibly degrade with 10,000 items, and is virtualization (Part 7.10) worth mentioning even if not implementing it?
- **Accessibility basics** — can this be reached and operated via keyboard (Tab, Enter, Escape)? Does a modal trap focus inside itself while open? Do interactive elements have accessible labels?

Mentioning these unprompted — even just as a spoken list of "things I'd want to handle given more time" — is a low-cost, high-signal move: it costs seconds to say, and it demonstrates production-level thinking regardless of whether you have time to actually implement all of it.

---

## PART 1: Foundational Mental Models (Before Any Hooks)

### 1.1 How React Actually Re-Renders

**Theory first.** A React component is, mechanically, just a JavaScript function. "Rendering" means React calling that function again and using its return value (the JSX) to figure out what the UI should now look like. A re-render is triggered by exactly three things: the component's own state changing (`useState`/`useReducer`'s setter being called with a genuinely different value), its parent re-rendering (by default, a re-render cascades to every child, regardless of whether that child's own props actually changed — this is the specific problem `React.memo` exists to address, in Part 5), or a Context value it subscribes to changing.

**Why "the component function runs again" matters for reasoning about bugs**: every single variable, every function defined inside the component body, is recreated from scratch on every render. A `const handleClick = () => console.log(count)` defined inside the component is a **brand new function object** every render — it is not the "same" `handleClick` persisting and being mutated; it's thrown away and a fresh one is created each time, capturing whatever `count` value existed *during that specific render*. This single fact — that the entire function body re-executes, and everything inside it is fresh each time — is the seed of nearly every confusing React bug a working developer encounters, and it's why "closures" (1.3, below) deserve dedicated, careful attention rather than being treated as a JavaScript detail unrelated to React.

### 1.2 The Render Phase vs. the Commit Phase

**Theory first.** React's work happens in two conceptually distinct phases. The **render phase** is where React calls your component functions to figure out what the new UI *should* look like — this phase is meant to be pure and side-effect-free; nothing here should touch the actual DOM. The **commit phase** is where React takes the result of the render phase and actually applies it to the real DOM, and only after the commit phase completes does the browser paint the updated screen.

**Why you can't reliably read updated DOM immediately after calling a state setter**: calling `setCount(count + 1)` does not synchronously update the DOM on that same line — it schedules a re-render, which happens (and commits) on React's own timing, not immediately, in-line, at the exact point `setState` was called. This is precisely why the following is a common, confusing bug for developers coming from a more "immediate mode" mental model:

```jsx
function Example() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(count + 1);
    console.log(count); // logs the OLD value, not the just-set new one — this render's `count` never changes
  }
  // ...
}
```
`count` inside `handleClick` is a constant captured from *this specific render* — it will never change within this one invocation of the function, no matter how many lines run after `setCount` is called. The updated value only exists once React re-renders the component and this function is torn down and rebuilt fresh with the new `count` baked in.

### 1.3 Closures in JavaScript, in the Context of React

**Theory first.** A closure is simply a function that "remembers" the variables from the scope it was created in, even after that outer scope has technically finished executing. In React specifically, every component render creates a **brand new scope** — every function defined inside the component body (event handlers, effect callbacks, anything) closes over that specific render's props and state values, frozen at whatever they were at that moment.

**Why this causes the #1 source of React bugs**: if a function created during Render #1 is somehow still being invoked later — most commonly because it was captured inside a `setTimeout`, a `setInterval`, or an event listener that wasn't properly re-created or cleaned up — it will keep referencing Render #1's variables forever, even while the component has since re-rendered many times with entirely new values. This is called a **stale closure**, and it's the root cause behind an enormous fraction of "why does my interval always show the initial value" and "why does my callback use an old value" bugs — covered concretely, with broken code and fixes, in Parts 2, 3, and 4.

### 1.4 Reconciliation and Keys

**Theory first.** When a list of elements re-renders, React needs to figure out which DOM nodes to reuse, which to update in place, and which to create or destroy — this comparison process is called **reconciliation**, and `key` is the identifier React uses to match up elements from the previous render to the new render. Without a stable key, React falls back to matching by position/index, which silently breaks the moment the list's *order* or *membership* changes — because "the element that used to be at index 2" is not the same thing as "the same logical item that's now at index 2" once items are inserted, removed, or reordered.

**A concrete broken example** — a list of input fields, one per item, using the array index as the key:

```jsx
// BROKEN — using array index as key
function EditableList({ items, onRemove }) {
  const [inputs, setInputs] = useState(items.map(() => ''));

  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>
          {item.label}
          <input
            value={inputs[index]}
            onChange={e => {
              const next = [...inputs];
              next[index] = e.target.value;
              setInputs(next);
            }}
          />
          <button onClick={() => onRemove(item.id)}>Remove</button>
        </li>
      ))}
    </ul>
  );
}
```

Type something into the input next to the *second* item, then remove the *first* item. Instead of the input's typed value staying attached to the item it was actually typed into, it appears to "jump" and stay attached to whatever is now at index 1 — because React, matching purely by index, sees "the element at index 1 still exists" and reuses that DOM `<input>` node (including whatever the browser is currently displaying inside it) for whatever new item has shifted into that position, rather than recognizing that the *actual item* the user was typing about has been removed and a *different* item has taken its old numeric slot.

**The fix**: key by the item's own stable, unique identifier, never its position:
```jsx
<li key={item.id}>
```
Now, removing the first item correctly removes exactly that `<li>`/`<input>` DOM node, and every remaining item's input correctly stays attached to the item it actually belongs to, since each key is tied to the item's true identity rather than its transient position in the array.

**Rule of thumb, stated precisely**: array index as `key` is acceptable *only* when the list is genuinely static and will never be reordered, filtered, or have items inserted/removed from anywhere but the very end — which, in practice, is a fairly narrow set of real cases. When in doubt, use a real, stable, unique identifier from the data itself.

---

## PART 2: useState — Deep Dive

### 2.1 Theory: Why State Must Be Updated Through `setState`, Not Mutated Directly

**What problem this solves.** React needs a reliable signal that says "something changed, please re-render." If you could freely mutate a state variable in place (`user.name = 'New Name'`), React would have no event to hook into — no function call it could intercept to know a re-render is needed. `useState`'s setter function is that signal: calling it is what schedules a re-render. Beyond just "signaling," React also uses **referential equality** (`Object.is` comparison) between the old and new state value to decide whether a re-render is even necessary at all — if you mutate an object in place and then pass that *same* object reference back into `setState`, React sees `oldValue === newValue` (they're literally the same object in memory) and may skip the re-render entirely, even though the data inside it did change. This is precisely why "I mutated the object, but the screen didn't update" is such a common, specific bug — not a fluke, but the direct, correct consequence of how React's change-detection actually works.

**What breaks without correct usage**: silently stale UI (state changed in memory, but the screen wasn't told to re-render because the reference didn't change), and — in more complex scenarios involving multiple state updates in one handler — updates that get lost or applied against outdated values (2.3, batching).

**Full syntax:**
```jsx
const [state, setState] = useState(initialValue);
```
- **`initialValue`** — the value `state` holds on the component's very first render. On every render after that, this argument is simply ignored (React already knows the current state) — this is exactly why passing an expensive computation directly here is wasteful (2.4 covers the lazy-initializer fix).
- **`state`** — the current value, returned fresh on every render call. It is a plain value (a number, string, object, array — whatever type you initialized it as), read-only from the component's perspective; you never assign to it directly (`state = 5` does nothing useful and isn't how updates happen).
- **`setState`** — the function used to request a state change. It accepts either a **plain new value** (`setState(5)`) or a **function that receives the current state and returns the next state** (`setState(prev => prev + 1)`) — the "functional update" form, covered in full in 2.2. Calling it schedules a re-render; it does not update `state` synchronously in place on the same line (Part 1.2).
- **Array destructuring, not an object**: `useState` returns a two-element array (`[state, setState]`), not a named object — which is exactly why you're free to name the two variables anything you like at the call site (`const [count, setCount] = useState(0)`, `const [isOpen, setIsOpen] = useState(false)`), unlike a fixed object shape where the property names would be locked in by the hook itself.
- **Calling it more than once in one component is normal and expected**: each `useState` call manages one independent piece of state — a component with `count`, `isOpen`, and `query` state calls `useState` three separate times, and (per the Rules of Hooks, Part 6.1) React tracks each by its call order, not by variable name.

### 2.2 Functional Updates vs. Direct Updates

**Theory first.** `setCount(count + 1)` computes the next value using `count` as captured in **this specific render's closure** (recall Part 1.3) — it's a fixed number, frozen at render time. `setCount(prev => prev + 1)`, the **functional update** form, instead hands React a function; React guarantees it will call that function with the **actual, most current state value at the moment the update is actually applied**, not whatever was captured in the closure that scheduled it. This distinction is invisible in the simple case, but becomes a real, concrete bug the moment multiple updates to the same state are queued before a re-render has had a chance to happen in between.

**A broken example — a rapid-fire increment button that skips updates:**
```jsx
// BROKEN
function Counter() {
  const [count, setCount] = useState(0);

  function handleTripleIncrement() {
    setCount(count + 1);
    setCount(count + 1);
    setCount(count + 1);
  }

  return <button onClick={handleTripleIncrement}>Count: {count}</button>;
}
```
Clicking this button once increments `count` by only **1**, not 3 — because all three calls read the *same* closed-over `count` from this one render (say, `0`), so all three effectively compute `setCount(0 + 1)`, three times in a row. React doesn't apply each one sequentially against the *previous call's result* — it applies the last one that "wins" against the same stale base value.

**The fix — functional updates:**
```jsx
// FIXED
function handleTripleIncrement() {
  setCount(prev => prev + 1);
  setCount(prev => prev + 1);
  setCount(prev => prev + 1);
}
```
Now each call receives the genuinely current value at the moment it's actually processed — the first call gets `0` and produces `1`, the second call gets `1` (the result of the first) and produces `2`, the third gets `2` and produces `3`. Clicking the button once now correctly increments by 3.

**Rule of thumb**: whenever a state update depends on the *previous* value of that same state — which is true of essentially all increment/toggle/append operations — use the functional update form. It costs nothing and eliminates an entire category of "why did this only apply once" bugs.

### 2.3 State Batching

**Theory first.** React groups ("batches") multiple `setState` calls that happen within the same event handler into a **single** re-render, rather than re-rendering after each individual call — this is a deliberate performance optimization: re-rendering three times for three state updates that all happen in the same click handler would be wasteful, since only the final combined result actually needs to reach the screen.

**What changed in React 18 — automatic batching**: prior to React 18, this batching only reliably happened inside React's own event handlers (`onClick`, `onChange`, etc.) — state updates inside a `setTimeout` callback, a native `addEventListener` callback, or a `Promise.then()` were each processed as **separate** re-renders, one per call. React 18 introduced **automatic batching**, extending this same batched behavior to *all* of those previously-unbatched contexts as well — meaning multiple `setState` calls inside a `setTimeout` or a fetch's `.then()` now also collapse into one re-render, by default, with no special API required to opt into it.

```jsx
// In React 18+, this is now ALSO batched into a single re-render, even inside a setTimeout —
// this was NOT the case pre-React-18, where each setState here would have triggered its own render
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
}, 1000);
```

### 2.4 Lazy Initial State

**Theory first.** `useState(expensiveComputation())` re-invokes `expensiveComputation()` on **every single render**, even though its result is only ever actually *used* on the very first render (every render after that, `useState` simply discards the argument and returns the already-established current state). If `expensiveComputation()` is genuinely costly (parsing a large JSON blob, reading and processing `localStorage`, running a non-trivial calculation), this is wasted work on every subsequent render, for no benefit.

**The fix — the lazy initializer form**: pass a **function** instead of a value; React calls it exactly once, on mount, and never again.
```jsx
// Runs expensiveComputation() on EVERY render, wastefully — the result is thrown away after mount
const [value, setValue] = useState(expensiveComputation());

// Runs expensiveComputation() exactly ONCE, on mount only
const [value, setValue] = useState(() => expensiveComputation());
```

**When this matters**: reading/parsing from `localStorage` at initialization (Part 6.3's `useLocalStorage`), computing a derived default from a large prop, or any other initializer that isn't a cheap literal or simple expression. For a plain `useState(0)` or `useState('')`, there's no meaningful cost either way, and the lazy form would just be unnecessary ceremony.

### 2.5 Object/Array State — Why You Must Create New References

**Theory first**, tying directly back to 2.1: React's change detection for state relies on **reference comparison**, not deep value comparison. Mutating an object or array in place and then calling the setter with that same reference means React sees "no change" at the identity level, regardless of what the actual contents now look like.

**A broken example:**
```jsx
// BROKEN — mutates the existing array in place
function TodoApp() {
  const [todos, setTodos] = useState([{ id: 1, text: 'Buy milk', done: false }]);

  function addTodo(text) {
    todos.push({ id: Date.now(), text, done: false });   // mutates the array directly
    setTodos(todos);                                       // same reference — React may skip re-rendering
  }
  // ...
}
```
This *might* appear to work in some cases (React's internal implementation details can sometimes still catch this), but it's fundamentally relying on undefined, unguaranteed behavior — it is not a reliable pattern, and will visibly break under `React.memo`, `StrictMode`, or certain React versions/configurations.

**The fix — always create a new reference:**
```jsx
// FIXED — spreads into a brand-new array reference
function addTodo(text) {
  setTodos(prevTodos => [...prevTodos, { id: Date.now(), text, done: false }]);
}

function toggleTodo(id) {
  setTodos(prevTodos =>
    prevTodos.map(todo => (todo.id === id ? { ...todo, done: !todo.done } : todo))
  );
}

function removeTodo(id) {
  setTodos(prevTodos => prevTodos.filter(todo => todo.id !== id));
}
```
Note the use of `.map()`/`.filter()`/spread — none of these mutate the original array or its objects; each produces a brand-new array (and, for the toggled item specifically, a brand-new object) every time, guaranteeing React always sees a genuinely new reference and reliably re-renders.

### 2.6 Worked Problem: A Counter, Extended to Expose the Stale Closure Trap

**The problem, as it might be asked**: "Build a counter with increment, decrement, and reset buttons. Then extend it so the increment amount is configurable via an input, and add an auto-increment toggle that increments automatically every second while enabled."

**Narrated solution, applying the Part 0 methodology:**

*"First, let me identify the state. I need `count` (the number itself — clearly state, since it's displayed and changes). I need `step` (the configurable increment amount — also state, since it's tied to a controlled input and changes the button's behavior). And I need `isAutoIncrementing` (a boolean toggle — state, since it needs to visually reflect on/off and control whether an effect is running)."*

**Skeleton first:**
```jsx
function Counter() {
  const [count, setCount] = useState(0);
  const [step, setStep] = useState(1);
  const [isAutoIncrementing, setIsAutoIncrementing] = useState(false);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + step)}>+{step}</button>
      <button onClick={() => setCount(c => c - step)}>-{step}</button>
      <button onClick={() => setCount(0)}>Reset</button>
      <input
        type="number"
        value={step}
        onChange={e => setStep(Number(e.target.value))}
      />
      <button onClick={() => setIsAutoIncrementing(a => !a)}>
        {isAutoIncrementing ? 'Stop' : 'Start'} Auto-Increment
      </button>
    </div>
  );
}
```

*"Now for the auto-increment behavior. This is genuinely synchronizing with an external system — a browser timer — so this is a legitimate use of `useEffect` (Part 3), not something I'd compute during render. Let me write the naive version first, since I want to deliberately walk through the bug it contains."*

**The naive (buggy) version:**
```jsx
useEffect(() => {
  if (!isAutoIncrementing) return;

  const id = setInterval(() => {
    setCount(count + step);   // BUG: closes over count and step from the render this effect was created in
  }, 1000);

  return () => clearInterval(id);
}, [isAutoIncrementing]);   // BUG: missing `count` and `step` from the dependency array
```

*"Wait — this has exactly the stale closure problem from Part 1.3. The `setInterval` callback closes over `count` and `step` as they were at the moment this specific effect run started. Since `count` and `step` aren't in the dependency array, this effect only re-runs when `isAutoIncrementing` changes — meaning the interval keeps calling `setCount(count + step)` using the very first `count`/`step` values forever, and the counter will increment by the same fixed amount every second, never actually reflecting the current count, and never reflecting a mid-flight change to the step value either."*

**The fix — functional update removes `count` from the dependency entirely, and `step` genuinely needs to be a dependency:**
```jsx
useEffect(() => {
  if (!isAutoIncrementing) return;

  const id = setInterval(() => {
    setCount(prevCount => prevCount + step);   // functional update — no longer depends on closed-over `count`
  }, 1000);

  return () => clearInterval(id);
}, [isAutoIncrementing, step]);   // step is genuinely used inside the effect, so it belongs here;
                                   // count is no longer referenced directly, so it's correctly omitted
```
*"This is exactly the pattern from 2.2 — using the functional update form eliminates the need to depend on `count` at all, since the interval callback now always asks React for the freshest value rather than trusting a closed-over one. `step` genuinely is read directly inside the effect body, so it correctly stays in the dependency array — if the user changes the step while auto-incrementing is on, I want the interval to restart with the new step value, which is exactly what including it here causes to happen."*

### 2.7 Common Mistakes

- Using `setCount(count + 1)` inside a loop, a rapid double-click handler, or anywhere else multiple updates to the same state could be queued together — always prefer the functional form when the new value depends on the old one.
- Mutating an array/object directly (`.push`, `.sort()` in place, direct property assignment) and passing the same reference back to the setter.
- Forgetting the lazy initializer form for a genuinely expensive `useState` initial value, silently re-running that computation on every render.
- Storing derived/computed values in their own `useState` instead of computing them during render (Part 0.1, Step 3) — this specific mistake shows up constantly across every worked problem in this guide, not just here.

### 2.8 Spot the Bug

```jsx
function LikeButton() {
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);

  function handleLike() {
    setLiked(true);
    if (!liked) {
      setLikes(likes + 1);
    }
  }

  return <button onClick={handleLike}>{likes} Likes</button>;
}
```
**What's wrong**: `liked` inside `handleLike` is the value from the render that created this specific closure — the very first time this handler runs, `liked` is `false`, so `setLikes(likes + 1)` correctly fires once. But if `handleLike` somehow gets invoked twice before a re-render occurs (e.g. a rapid double-click, or — more subtly — if this handler were ever called again from inside the same synchronous batch), `liked` would *still* read as `false` in both invocations, since neither has "seen" the update from the other yet, and `likes` would increment twice for what should be a single toggle. **The fix**: use functional updates for both, and derive the guard from the same up-to-date source rather than a closed-over boolean:
```jsx
function handleLike() {
  setLiked(prevLiked => {
    if (!prevLiked) {
      setLikes(prevLikes => prevLikes + 1);
    }
    return true;
  });
}
```

### 2.9 When Interviewers Use This to Test You

A counter problem looks trivially easy, which is exactly why interviewers use variations of it as a fast, low-setup way to check for the stale closure trap specifically — the "auto-increment" extension in particular is a very common follow-up precisely because it forces the candidate to either fall into the bug or demonstrate they already know to reach for the functional update form. What's actually being evaluated is not "can you write a counter" — it's "do you understand why closures capture stale values in React, and do you instinctively reach for the functional update form (or a ref) the moment an update depends on a previous value inside an async or repeatedly-invoked callback."

---

## PART 3: useEffect — The Hook Most People Misunderstand

### 3.1 Theory: `useEffect` Is a Synchronization Mechanism, Not a Lifecycle Method

**What problem this solves.** A React component's job is to describe *what the UI should look like* given the current state and props — but sometimes a component also needs to stay in sync with something **outside** React's own rendering system entirely: a browser API (the DOM directly, `document.title`, a timer), a network connection (a WebSocket, a fetch request), or a third-party, non-React library. `useEffect` exists specifically to express "every time these particular values change, re-synchronize with this external thing" — it is fundamentally about keeping React's world and an external system in agreement, not about "running code at a particular point in the component's life."

**Why the old "componentDidMount" mental model is actively harmful.** Developers coming from class components often translate `useEffect(() => { ... }, [])` as "the `componentDidMount` equivalent" — code that "runs once, when the component first appears." This framing is misleading in a way that causes real bugs: it encourages thinking about *when* the effect runs (a point in time) rather than *what it's synchronizing with and under what conditions that synchronization needs to be redone* (a relationship between values). The dependency array isn't a leftover implementation detail bolted onto a lifecycle hook — it **is** the actual mechanism: it's the literal list of external-system-relevant values that, if they change, mean the synchronization is now out of date and needs to be redone. Once you think in terms of "what am I synchronizing, and with what," the dependency array stops looking like a rule to memorize and starts looking like an honest, direct description of what the effect actually depends on.

**Full syntax:**
```jsx
useEffect(setupFunction, dependencyArray);
```
- **`setupFunction`** — a function React calls after the render commits (Part 1.2) — never during the render itself. This is where the actual synchronization logic lives: starting a subscription, kicking off a fetch, setting a timer.
- **`dependencyArray`** (optional) — an array of every value from the component's scope that the `setupFunction` actually reads. React compares this array, entry by entry, to the previous render's array; if anything differs, the old synchronization is torn down (via the cleanup function, 3.3) and the effect runs again with the current values. Three distinct forms, each meaning something different:
  - **Omitted entirely** — no array is passed at all, so React has nothing to compare and re-runs the effect after *every* render, unconditionally (3.2 covers why this is rarely what you actually want).
  - **`[]`** — an empty array; since there is nothing in it that could ever differ between renders, the effect runs exactly once, after the first render, and never again until unmount.
  - **`[a, b, c]`** — the effect re-runs whenever any listed value changes (by `Object.is`/reference comparison — 3.2 covers this precisely for objects/arrays/functions), and is otherwise skipped.
- **The optional return value — the cleanup function**: if `setupFunction` returns a function, React calls that returned function before running the effect again, and once more on unmount (3.3). If `setupFunction` returns nothing (or anything other than a function), there is simply no cleanup step for this effect.
- **Where `useEffect` can be called**: exactly like every other hook, only at the top level of a component or another custom hook — never inside a condition, loop, or nested function (Part 6.1's Rules of Hooks apply identically here).

### 3.2 The Dependency Array, in Full

**Theory first — why it exists at all.** Every value referenced inside an effect's body was captured from a specific render's closure (Part 1.3) — exactly like any other function defined inside the component. The dependency array tells React: "compare each of these specific values between the previous render and this one; if any of them are different, the effect's synchronization is stale, so clean up the old one and run the effect again with the current values."

**What "referential equality" means for objects/functions/arrays in the dependency array**: React compares each dependency using `Object.is` (essentially `===`) — for primitives (numbers, strings, booleans), this compares by value, exactly as expected. For objects, arrays, and functions, this compares by **reference**, not by deep equality. A new object/array/function literal created fresh on every render (e.g. `{ id: userId }` written inline as a dependency) is **never** `===` to the previous render's version, even if every property inside it is identical — which means an effect depending on such a value will re-run on literally every single render, defeating the entire purpose of the dependency array. This is a very common, subtle bug: the fix is either to depend on the primitive values *inside* the object individually (`[userId]` instead of `[{ id: userId }]`), or to memoize the object/function itself with `useMemo`/`useCallback` if it genuinely must be passed as a single unit (Part 5).

**Why `[]` means "run once"**: an empty array has nothing to compare that could ever differ between renders — there is no dependency that could ever "change" to trigger a re-run, so the effect runs after the very first render and never again (until the component unmounts, when its cleanup function fires).

**Why omitting the array entirely means "run every render"**: with no array at all, React has no basis for comparison, so it takes the safest possible default — treat the effect as depending on *everything*, and re-run it after every single render, unconditionally. This is very rarely what you actually want, and is usually a sign the dependency array was accidentally left off rather than a deliberate choice.

### 3.3 Cleanup Functions

**Theory first.** An effect can optionally `return` a function — the **cleanup function** — which React calls in two situations: **right before the effect runs again** (to tear down the previous synchronization before establishing the new one), and **when the component unmounts** (to tear down the synchronization entirely, since there's no more component around to keep it running). This exists because many external-system synchronizations create something that needs explicit teardown — a subscription, a timer, an event listener — and forgetting to tear it down means it keeps running (and, critically, keeps trying to interact with a component instance that may no longer meaningfully exist), which is a **memory/resource leak**.

**A full worked example — an interval that needs cleanup, and what leaks if you forget it:**

```jsx
// BROKEN — no cleanup
useEffect(() => {
  const id = setInterval(() => {
    console.log('tick');
  }, 1000);
  // no return statement — the interval is never cleared
}, []);
```
Every time this component mounts (e.g. it's conditionally rendered and gets mounted/unmounted repeatedly as the user navigates), a **new** interval is created, and the old one, from a previous mount, is **never cleared** — it keeps firing forever, logging `'tick'` from a component instance that no longer exists on screen, silently accumulating more and more running intervals over the component's lifetime in the app. This is a textbook memory/resource leak, and it can also cause much stranger bugs if the interval's callback tries to call a state setter belonging to an already-unmounted component.

**The fix:**
```jsx
useEffect(() => {
  const id = setInterval(() => {
    console.log('tick');
  }, 1000);

  return () => clearInterval(id);   // runs on unmount, and before any re-run of this effect
}, []);
```

The same principle applies identically to a WebSocket connection:
```jsx
useEffect(() => {
  const socket = new WebSocket(`wss://example.com/rooms/${roomId}`);
  socket.addEventListener('message', handleMessage);

  return () => {
    socket.removeEventListener('message', handleMessage);
    socket.close();
  };
}, [roomId]);   // if roomId changes, the OLD connection is torn down and a NEW one opened to the new room
```

### 3.4 The Stale Closure Problem in `useEffect`, Specifically

**A full broken example — an interval that logs a state variable but always logs the initial value:**
```jsx
// BROKEN
function LiveCounter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      console.log('current count is:', count);   // always logs 0, forever
    }, 1000);
    return () => clearInterval(id);
  }, []);   // empty array — this effect runs ONCE, so `count` is frozen at 0 forever inside this closure

  return <button onClick={() => setCount(c => c + 1)}>Increment ({count})</button>;
}
```
Clicking the button correctly updates the displayed `count` on screen (since the button's own render always reflects the latest state) — but the interval's console log is stuck printing `0` forever, because the effect only ran once, on mount, and the interval callback it created closed over `count` as it existed at that single moment.

**Two possible fixes, depending on intent:**

*Fix 1 — if the interval genuinely should re-establish itself with the current count each time it changes*, add `count` to the dependency array (this means the interval is torn down and recreated every time `count` changes, which is fine for a `console.log` but could be wasteful/undesirable for something more expensive like reopening a network connection):
```jsx
useEffect(() => {
  const id = setInterval(() => {
    console.log('current count is:', count);
  }, 1000);
  return () => clearInterval(id);
}, [count]);
```

*Fix 2 — if the interval should keep running continuously without being torn down and recreated, but still needs the current value*, use a ref to always hold the latest value without it being a dependency at all (a technique fully explored in Part 4):
```jsx
function LiveCounter() {
  const [count, setCount] = useState(0);
  const countRef = useRef(count);
  countRef.current = count;   // kept in sync with the latest count on every render

  useEffect(() => {
    const id = setInterval(() => {
      console.log('current count is:', countRef.current);   // always reads the latest value
    }, 1000);
    return () => clearInterval(id);
  }, []);   // the interval itself only needs to be set up once

  return <button onClick={() => setCount(c => c + 1)}>Increment ({count})</button>;
}
```

### 3.5 Race Conditions in Data Fetching with `useEffect`

**Theory first.** When an effect depends on a rapidly-changing value (a search term the user is typing), each keystroke can trigger a new fetch — but network requests don't resolve in the order they were sent; a request fired earlier can, for entirely mundane reasons (network variance, server load), resolve **after** a request fired later. If every resolved response is unconditionally written to state, a slower, earlier request can overwrite the results of a faster, later one — silently showing the user results for a search term they've already moved past.

**A full worked example, showing the bug, then the fix:**

```jsx
// BROKEN — classic race condition
function Search({ query }) {
  const [results, setResults] = useState([]);

  useEffect(() => {
    fetch(`/api/search?q=${query}`)
      .then(res => res.json())
      .then(data => setResults(data));   // no guard against this being a stale/outdated response
  }, [query]);

  return <ResultsList results={results} />;
}
```
Suppose the user quickly types `"re"` then `"react"`. Two fetches fire: one for `"re"`, one for `"react"`. If the `"re"` request happens to resolve *after* the `"react"` request (plausible — perhaps the `"re"` query matched a much larger, slower-to-compute set of results server-side), `setResults` is called a second time with the stale `"re"` results, overwriting the correct, already-displayed `"react"` results — the user sees search results for a query they no longer have typed in the box.

**The fix, with an ignore flag (works with any promise-based API, not just fetch):**
```jsx
useEffect(() => {
  let ignore = false;

  fetch(`/api/search?q=${query}`)
    .then(res => res.json())
    .then(data => {
      if (!ignore) {
        setResults(data);
      }
    });

  return () => {
    ignore = true;   // if `query` changes again (or the component unmounts) before this resolves,
                      // mark this specific fetch's result as stale so it's discarded on arrival
  };
}, [query]);
```
Every time `query` changes, the cleanup function from the *previous* effect run sets that previous run's `ignore` to `true` before the new effect starts — so even if the old, slower request resolves later, its `.then()` callback checks `ignore`, sees it's `true`, and simply does nothing, correctly discarding the stale result.

**The fix, with `AbortController` (the more "correct" browser-native approach, since it actually cancels the underlying network request rather than just ignoring its result):**
```jsx
useEffect(() => {
  const controller = new AbortController();

  fetch(`/api/search?q=${query}`, { signal: controller.signal })
    .then(res => res.json())
    .then(data => setResults(data))
    .catch(err => {
      if (err.name !== 'AbortError') {
        setError(err);   // a genuine error, not just "we cancelled this on purpose"
      }
    });

  return () => controller.abort();
}, [query]);
```

### 3.6 Worked Problem: Fetch Data Based on a Changing Prop, With Loading/Error States and No Race Condition

**The problem, as it might be asked**: "Build a `UserProfile` component that fetches and displays a user's data given a `userId` prop, which can change over time (e.g., navigating between user pages)."

**Narrated solution:**

*"Let me identify the state first. I need `data` (the fetched user object, or null before it arrives), `isLoading` (a boolean, true while a request is in flight), and `error` (null, or the error if the fetch fails). All three genuinely need to trigger a re-render when they change, so all three are state, not refs or derived values."*

**Skeleton first:**
```jsx
function UserProfile({ userId }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Something went wrong: {error.message}</p>;
  if (!data) return null;

  return (
    <div>
      <h2>{data.name}</h2>
      <p>{data.email}</p>
    </div>
  );
}
```

*"Now the effect. This is a genuine synchronization with an external system — the network — reacting to a prop that can change. `userId` is the only value referenced inside the effect that comes from outside it, so that's the only dependency. I need to reset `isLoading`/`error` at the start of each fetch attempt, and I need to guard against the race condition from 3.5, since `userId` changing mid-request is exactly the scenario that causes it."*

**Full working code:**
```jsx
function UserProfile({ userId }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/users/${userId}`)
      .then(res => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then(user => {
        if (!ignore) {
          setData(user);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [userId]);

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Something went wrong: {error.message}</p>;
  if (!data) return null;

  return (
    <div>
      <h2>{data.name}</h2>
      <p>{data.email}</p>
    </div>
  );
}
```

*"One thing worth saying out loud even without being asked: if `userId` changes again before the current fetch resolves, the cleanup function sets `ignore = true` for the stale request, exactly like the search example, so we never show data for the wrong user. I'd also mention that in a real production app, I'd likely reach for a dedicated data-fetching library — React Query or SWR — specifically because they solve this race-condition/loading/error/caching boilerplate once, rather than re-deriving it in every component."*

---

### 3.7 Common Mistakes

- Reaching for `useEffect` to compute a derived value from props/state, instead of just computing it inline during render (Part 0.1, Step 3) — the single most common overuse pattern.
- Missing dependency array entries, either by omitting the array entirely (re-runs every render) or by listing an incomplete set (stale closures, exactly like 3.4).
- Forgetting cleanup for anything that creates a subscription, timer, or listener — leaking resources and, in the worst case, causing a `setState` call on an unmounted component.
- Not guarding against race conditions in any effect that fires an async request keyed off a value that can change again before the request resolves.
- Using an object, array, or inline function literal directly as a dependency, not realizing it's a new reference every render and will cause the effect to re-run constantly.

### 3.8 Spot the Bug

```jsx
function Timer({ initialSeconds }) {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft(secondsLeft - 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <p>{secondsLeft}s remaining</p>;
}
```
**What's wrong**: the effect's dependency array is `[]`, so it runs exactly once, and the interval callback closes over `secondsLeft` as it was at that single moment (`initialSeconds`). Every tick computes `setSecondsLeft(initialSeconds - 1)` — the countdown will decrement once and then get stuck repeating the same value forever, never actually counting down. **The fix**: use the functional update form, which doesn't need `secondsLeft` from the closure at all:
```jsx
useEffect(() => {
  const id = setInterval(() => {
    setSecondsLeft(prev => prev - 1);
  }, 1000);
  return () => clearInterval(id);
}, []);
```

### 3.9 When Interviewers Use This to Test You

`useEffect` problems are the single most common vehicle for testing whether a candidate actually understands closures and synchronization, rather than having memorized "empty array means mount, cleanup means unmount." Any prompt involving a timer, a subscription, or a search-as-you-type fetch is implicitly checking: does the candidate reason correctly about the dependency array instead of guessing at it; do they instinctively add cleanup for anything that creates a resource; and do they recognize and guard against race conditions in fetch-on-changing-input scenarios without being explicitly told to. An interviewer who sees a candidate write `useEffect(() => { fetch(...) }, [query])` with **no** race-condition guard will very commonly ask, as a direct follow-up, "what happens if the user types quickly and an earlier request resolves after a later one?" — precisely to see whether the candidate already knows the answer or has to be walked into discovering the bug.

---

## PART 4: useRef — The Most Underused Hook in Problem-Solving

### 4.1 Theory: What Makes `useRef` Fundamentally Different From `useState`

**What problem this solves.** `useRef(initialValue)` returns a plain, mutable object of the shape `{ current: initialValue }`, and — critically — **updating `.current` does not trigger a re-render**, and the same ref object **persists, identically, across every render** of the component, exactly like an instance variable would in a class. This gives you something `useState` structurally cannot: a place to stash a value that needs to survive across renders (so it isn't reset to its initial value every time the component function re-runs) but that has no business causing the UI to update when it changes, because it isn't actually part of what's displayed.

**What breaks if you use `useState` for something that should be a ref**: an unnecessary re-render every time the value changes, even though nothing on screen actually needs to look different — at best, wasted work; at worst, an actual bug, since a state update inside certain contexts (like inside another effect's cleanup, or during an unmount) can trigger warnings or unintended re-render cascades that a ref update simply wouldn't cause at all, since refs are explicitly designed to be mutated freely, at any time, without React's rendering machinery getting involved.

**Full syntax:**
```jsx
const ref = useRef(initialValue);
```
- **`initialValue`** — the value `ref.current` holds on the first render. Unlike `useState`, there's no lazy-initializer form for `useRef` — but this matters far less here, since `initialValue` is evaluated only once regardless (the ref object itself is created once and reused, so there's no repeated-evaluation cost the way there is with `useState`'s argument on every render).
- **`ref`** — a plain, ordinary JavaScript object of the fixed shape `{ current: initialValue }`, and — this is the entire point of the hook — **the exact same object reference is returned on every render** of this component instance. Nothing else about it is special; it's not reactive, not observed, not compared by React in any way.
- **`ref.current`** — read or written directly, any time, including inside event handlers, effects, or (for reads only, generally) during render itself. Writing to `.current` (`ref.current = 5`) never schedules a re-render and never triggers any of React's machinery — it's a plain mutation on a plain object.
- **Attaching a ref to a JSX element** — passing `ref={myRef}` as a special, reserved prop on a DOM element (`<input ref={inputRef} />`) causes React to set `myRef.current` to the actual underlying DOM node once it's mounted, and back to `null` once it's unmounted — this is the mechanism behind Use Case 1 below.
- **Where `useRef` can be called**: the same Rules of Hooks as every other hook — top level only, never conditionally (Part 6.1).

### 4.2 Two Main Use Cases

**Use case 1 — accessing/manipulating a DOM node directly.** Attaching a ref to a JSX element gives you direct access to the underlying DOM node after it's mounted — needed for things React's declarative model doesn't otherwise expose an API for: calling `.focus()` on an input, measuring an element's size, or reading `.scrollHeight`.
```jsx
function SearchBox() {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current.focus();   // focus the input as soon as it mounts
  }, []);

  return <input ref={inputRef} />;
}
```

**Use case 2 — holding a mutable value that persists across renders without causing a re-render.** A `setInterval`/`setTimeout` ID you'll need later to clear it, a "have I already fired this fetch" flag, or the previous value of some prop/state (Part 4.4's `usePrevious`).

### 4.3 Why `useRef` Fixes Stale-Closure Problems `useState` Can't Cleanly Solve

As already demonstrated in Part 3.4's Fix 2: a ref can hold "the current value" and be read from inside a closure that was created much earlier (like an interval callback set up once, in an empty-dependency-array effect) — because reading `.current` always gets whatever was most recently assigned to it, regardless of which render's closure the reading code originally came from. `useState`, by contrast, has no equivalent "always read the live value" mechanism from inside an old closure — the functional-update form works specifically for *updating* state based on its previous value, but it doesn't help a callback that just needs to *read* a current value without updating it (like a plain `console.log`, or checking a condition without setting anything).

### 4.4 Worked Problem: A Stopwatch/Timer With Start/Pause/Reset

**The problem, as it might be asked**: "Build a stopwatch that displays elapsed time in seconds, with start, pause, and reset controls."

**Narrated solution:**

*"Let me classify the state first. `elapsedSeconds` — clearly state, it's displayed and needs to trigger a re-render as it changes. `isRunning` — also state, since the buttons' behavior and the display both depend on it. What about the interval ID? This is the interesting one — I need it to persist across renders so I can clear it later, but the interval ID itself is never displayed anywhere on screen, and updating it shouldn't cause a re-render at all. That's exactly the definition of a ref, not state — if I stored the interval ID in `useState`, every time I started a new interval I'd trigger an unnecessary re-render just to store a number nobody ever reads from the UI."*

**Why storing the interval ID in state would be wrong, stated explicitly**: it would cause an extra, pointless re-render every time `start()` runs (since `setState` was called), and — more subtly — since the interval ID variable would then be subject to the exact same closure-capture rules as any other state, reading it correctly from inside other event handlers (like `pause`) would require care to avoid reading a stale ID; a ref sidesteps this entirely, since `.current` is always read live.

**Full working code:**
```jsx
function Stopwatch() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalIdRef = useRef(null);

  useEffect(() => {
    if (!isRunning) return;

    intervalIdRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(intervalIdRef.current);
  }, [isRunning]);

  function handleReset() {
    setIsRunning(false);
    setElapsedSeconds(0);
  }

  return (
    <div>
      <p>{elapsedSeconds}s</p>
      <button onClick={() => setIsRunning(true)} disabled={isRunning}>Start</button>
      <button onClick={() => setIsRunning(false)} disabled={!isRunning}>Pause</button>
      <button onClick={handleReset}>Reset</button>
    </div>
  );
}
```
*"Note the effect's cleanup handles both the pause case and the unmount case identically — every time `isRunning` flips to `false` (via Pause), the cleanup fires and clears the existing interval before the effect re-runs and (since `isRunning` is now false) simply returns early without starting a new one. That's the same mechanism doing double duty for both 'stop counting' and 'don't leak the interval,' which is worth pointing out out loud as a demonstration of actually understanding what the cleanup function is for, rather than just having memorized to include one."*

### 4.5 Worked Problem: `usePrevious` — A Custom Hook Using `useRef` + `useEffect`

**The problem, as it might be asked**: "Implement a `usePrevious` hook that returns the previous value of whatever's passed to it — useful for comparing a prop or state value to what it was on the last render."

**Narrated solution**: *"I need something that persists the 'previous' value across renders, but updating it shouldn't itself cause a re-render — that's a ref. The tricky part is timing: I want the ref to reflect what the value was *before this render*, so I need to update it via an effect (which runs *after* the render commits), not during the render itself — otherwise I'd overwrite the previous value before ever having a chance to read it as 'previous' during the current render."*

```jsx
function usePrevious(value) {
  const ref = useRef();

  useEffect(() => {
    ref.current = value;   // runs AFTER this render commits — updates the ref for the NEXT render to read
  });   // no dependency array — this effect intentionally runs after every render

  return ref.current;   // during THIS render, ref.current still holds whatever was set after the PREVIOUS render
}
```

**Usage example:**
```jsx
function PriceDisplay({ price }) {
  const previousPrice = usePrevious(price);

  const direction = previousPrice == null
    ? 'initial'
    : price > previousPrice ? 'up' : price < previousPrice ? 'down' : 'same';

  return <p className={`price price-${direction}`}>${price}</p>;
}
```

*"The order of operations here is the whole trick, worth narrating explicitly: on render N, `usePrevious` returns whatever `ref.current` holds — which is the value from render N-1, because the effect that would update it to render N's value hasn't run yet (effects run after the render commits, per Part 1.2). Only after this render commits does the effect fire and overwrite `ref.current` with render N's value, ready to be read as 'previous' on render N+1."*

### 4.6 Common Mistakes

- Reading or writing `.current` **during render** for a value meant to reflect UI state — this bypasses React's render cycle entirely, and the UI will not reliably reflect the change until something else happens to trigger a re-render; if a value needs to be displayed, it needs to be state, not a ref.
- Storing something in state purely because "it needs to persist across renders," without checking whether it also needs to trigger a re-render — if it doesn't, it should be a ref, not state (this is directly the interval-ID mistake from 4.4).
- Forgetting that mutating `ref.current` does **not** trigger a re-render, and then being confused why the UI doesn't visually update after a ref-only change — the fix isn't to add more code, it's to recognize the value needed to be state in the first place.
- Attaching a ref to a DOM node and reading `.current` synchronously in the same render pass that creates the element — the ref is `null` until after the component actually mounts and React attaches it, so reading it must happen inside an effect (or an event handler that runs after mount), never directly in the render body.

### 4.7 Spot the Bug

```jsx
function ClickCounter() {
  const countRef = useRef(0);

  function handleClick() {
    countRef.current = countRef.current + 1;
  }

  return (
    <div>
      <p>Clicked {countRef.current} times</p>
      <button onClick={handleClick}>Click me</button>
    </div>
  );
}
```
**What's wrong**: this compiles and runs without any error, but clicking the button never visibly updates the displayed count. `countRef.current` genuinely does increment on every click — but mutating a ref does not trigger a re-render, so React never re-runs this component's function to reflect the new value on screen; the displayed number is frozen at whatever it was on the last render triggered by something else entirely. **The fix**: this value is clearly meant to be displayed and drive a re-render — it should be state, not a ref:
```jsx
function ClickCounter() {
  const [count, setCount] = useState(0);

  function handleClick() {
    setCount(c => c + 1);
  }

  return (
    <div>
      <p>Clicked {count} times</p>
      <button onClick={handleClick}>Click me</button>
    </div>
  );
}
```

### 4.8 When Interviewers Use This to Test You

A stopwatch/timer prompt is one of the most reliable ways an interviewer checks whether a candidate correctly distinguishes "needs to persist" from "needs to trigger a re-render" — a candidate who reaches for `useState` to hold the interval ID (a real, common instinct, since it does need to "persist") reveals they haven't internalized the state-vs-ref distinction from Part 0.1; a candidate who reaches for `useRef` specifically because "this value is never rendered, it's just bookkeeping for cleanup" demonstrates the exact classification skill the whole methodology is built around.

---

## PART 5: useMemo and useCallback — Theory Over Memorization

### 5.1 Theory: Referential Equality and Why It Matters for Re-Renders

**What problem this solves.** As established in Part 2.1 and Part 3.2, React (and `React.memo`) frequently decide "did this actually change?" using reference comparison (`===`), not deep value comparison. A crucial, easy-to-forget fact: **a new object, array, or function literal is never `===` to a previous render's version, even if every value inside it is identical** — `{} === {}` is `false`; `(() => {}) === (() => {})` is `false`; two separately-created `[1, 2, 3]` arrays are also not `===` to each other. Every render of a component re-creates every inline object/array/function literal from scratch, meaning a child component receiving one of these as a prop sees a "new" value on every single parent render, **regardless of whether the underlying data actually changed** — which is precisely the problem that breaks `React.memo`'s ability to skip re-rendering a child, and the problem `useMemo`/`useCallback` exist to solve.

### 5.2 `useMemo` — Memoizing Expensive Computed Values

**Theory first.** `useMemo(calculateValue, dependencies)` re-runs `calculateValue` only when one of the listed dependencies has actually changed since the last render; otherwise, it returns the **same cached result** from the previous render, both saving the recomputation and — just as importantly — preserving referential equality of the result across renders where nothing relevant changed.

```jsx
const sortedItems = useMemo(() => {
  return [...items].sort((a, b) => a.price - b.price);
}, [items]);
```

**Full syntax:**
```jsx
const memoizedValue = useMemo(calculateValue, dependencyArray);
```
- **`calculateValue`** — a function that takes no arguments and returns the value you want memoized. React calls this function during render, but only when it decides the cached result can no longer be trusted (see below) — otherwise it skips calling it entirely and just hands back the previous result.
- **`dependencyArray`** — same comparison rules as `useEffect`'s array (3.2): every value referenced inside `calculateValue` should be listed here, compared by reference for objects/arrays/functions. If every entry is unchanged since the last render (by `Object.is`), React returns the cached value without re-running `calculateValue` at all; if anything differs, it re-runs the function and caches the new result.
- **`memoizedValue`** — the returned value itself, not a wrapper or ref — you use it directly, exactly as if it were computed inline (`sortedItems.map(...)` works exactly the same whether `sortedItems` came from `useMemo` or a plain `const`).
- **What `useMemo` is *not***: a guarantee. React's own documentation is explicit that `useMemo` is an optimization hint, not a contract — in rare cases (e.g. certain memory-pressure scenarios) React may still discard a cached value and recompute it, so `calculateValue` must always be safe to re-run and must never have side effects, exactly like a reducer (Part 6.5.2).

**When it actually matters**: genuinely expensive computations — sorting/filtering a large array, a non-trivial calculation — where recomputing on every render would be a measurable cost, **or** when the *referential stability* of the result itself matters (e.g. it's about to be passed as a prop to a `React.memo`-wrapped child, or used as a dependency in another hook's array, where a "new" reference every render would defeat that other optimization entirely).

**When it's premature optimization**: wrapping a cheap calculation (`const doubled = useMemo(() => count * 2, [count])`) in `useMemo` adds real overhead of its own — storing the cached value, running the dependency comparison on every render — that can, for a genuinely trivial computation, cost more than simply recomputing the value directly (`const doubled = count * 2`) would have in the first place. The correct default is to **not** memoize, and only add `useMemo` once you've identified an actual, measured cost (or an actual referential-stability requirement), not preemptively on every computed value in a component.

### 5.3 `useCallback` — Memoizing Function References

**Theory first.** `useCallback(fn, dependencies)` returns the **same function reference** across renders, as long as the dependencies haven't changed — functionally, it's `useMemo` specialized for the specific case of memoizing a function rather than a computed value (`useCallback(fn, deps)` is, in fact, precisely equivalent to `useMemo(() => fn, deps)`).

**Why this matters specifically**: two concrete situations. First, when passing a callback prop down to a **`React.memo`-wrapped child** — `React.memo` skips re-rendering a child if its props are all `===` to the previous render's props; an inline function prop (`onClick={() => doSomething()}`) is a new reference every parent render, which defeats `React.memo` entirely, causing the child to re-render every single time regardless of the memo wrapper. Second, when a function is used **inside another hook's dependency array** (most commonly a `useEffect`) — if the function is recreated fresh every render, and it's listed as a dependency, that effect will re-run every render too, exactly like the object-literal-as-dependency problem from Part 3.2.

**Full syntax:**
```jsx
const memoizedFn = useCallback(fn, dependencyArray);
```
- **`fn`** — the function you want a stable reference to, written exactly as you would write it inline (`() => doSomething(id)`).
- **`dependencyArray`** — identical rules to `useMemo`/`useEffect`: list every value from the surrounding scope that `fn`'s body actually references. As long as none of them have changed since the last render, `useCallback` returns the *exact same function object* it returned last time — not a new, behaviorally-identical function, but the literal same reference in memory, which is what a reference-comparing consumer (`React.memo`, another hook's dependency array) actually needs.
- **`memoizedFn`** — the returned, stable function reference — passed to a child or another hook exactly as `fn` would have been, just with its identity preserved across renders where the dependencies haven't changed.
- **The equivalence worth remembering**: `useCallback(fn, deps)` is defined as being exactly the same as `useMemo(() => fn, deps)` — useful to know because it means every rule that applies to `useMemo`'s dependency comparison (Object.is reference equality, the "not a guaranteed cache" caveat) applies identically here, just for a function value instead of an arbitrary computed one.

### 5.4 The Common Mistake: Using `useCallback`/`useMemo` Everywhere "Just in Case"

**Why this is often net-negative.** Memoization is not free — every `useMemo`/`useCallback` call itself costs a small amount of memory (to store the cached value/function and its dependency array) and a small amount of comparison work on every render (checking whether the dependencies changed). If the wrapped value/function is never actually consumed by a `React.memo`-wrapped child or another hook's dependency array, this cost buys **nothing** — there's no re-render being prevented, no unnecessary computation being skipped, just extra bookkeeping on every render for no corresponding benefit. **The correct instinct**: reach for `useMemo`/`useCallback` specifically when you can name the concrete thing it's protecting (a specific expensive computation, a specific memoized child, a specific effect's dependency array) — not as a reflexive habit applied to every function and computed value in a component "to be safe."

### 5.5 Worked Problem: An Expensive-to-Render Child List, Fixed Step by Step

**The problem, as it might be asked**: "You have a parent component rendering a large, expensive-to-render list of items, plus an unrelated counter. Typing/clicking the counter causes the entire list to visibly re-render and lag, even though the list's own data never changed. Fix it."

**Narrated solution:**

*"First, let me confirm why this is happening at all: by default, every re-render of a parent re-renders every child, regardless of whether that child's own props changed — this is the baseline behavior, not a bug. So clicking the counter re-renders the parent, which re-renders the expensive list, even though the list's data is completely unrelated to the counter."*

**The broken (baseline) version:**
```jsx
function ExpensiveItem({ item, onSelect }) {
  // imagine this does genuinely expensive rendering work
  return <li onClick={() => onSelect(item.id)}>{item.name}</li>;
}

function App() {
  const [count, setCount] = useState(0);
  const [items] = useState(generateLargeItemList());

  function handleSelect(id) {
    console.log('selected', id);
  }

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
      <ul>
        {items.map(item => (
          <ExpensiveItem key={item.id} item={item} onSelect={handleSelect} />
        ))}
      </ul>
    </div>
  );
}
```

*"Step one: wrap `ExpensiveItem` in `React.memo`, so it only re-renders when its own props actually change by reference."*
```jsx
const ExpensiveItem = React.memo(function ExpensiveItem({ item, onSelect }) {
  return <li onClick={() => onSelect(item.id)}>{item.name}</li>;
});
```

*"But this alone won't fix it yet — `handleSelect` is a plain function defined inside `App`, recreated fresh on every render of `App`, including every click of the counter. Even though `item` itself is referentially stable (it comes from state that isn't changing), `onSelect` is a brand-new reference every time, so `React.memo`'s shallow prop comparison still sees 'a prop changed' and still re-renders every `ExpensiveItem`. I need to also memoize `handleSelect` with `useCallback` so its reference stays stable across renders where it doesn't need to change."*

**The fix:**
```jsx
function App() {
  const [count, setCount] = useState(0);
  const [items] = useState(generateLargeItemList());

  const handleSelect = useCallback(id => {
    console.log('selected', id);
  }, []);   // no dependencies — this function never actually needs to change

  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
      <ul>
        {items.map(item => (
          <ExpensiveItem key={item.id} item={item} onSelect={handleSelect} />
        ))}
      </ul>
    </div>
  );
}
```
*"Now, clicking the counter re-renders `App` (unavoidably, since `count` changed), but every `ExpensiveItem`'s props — `item` (unchanged reference, since `items` itself never changed) and `onSelect` (now a stable reference via `useCallback`) — are both `===` to the previous render's values, so `React.memo` correctly skips re-rendering every single item in the list. The counter now updates instantly, with no lag, because the expensive list is genuinely untouched by that state change."*

### 5.6 Common Mistakes

- Wrapping every function and every computed value in `useCallback`/`useMemo` reflexively, without a specific `React.memo` child or dependency array actually consuming the stable reference (Part 5.4).
- Memoizing a callback with `useCallback` but forgetting the child it's passed to also needs to be wrapped in `React.memo` — without both pieces in place, the memoization buys nothing, since the child would re-render anyway regardless of whether its props changed.
- Including a genuinely-changing value in a `useMemo`/`useCallback` dependency array but expecting the memoized result to somehow still reflect an even-more-current value than what the dependency array would trigger — memoization only ever reflects the values in its own dependency array, nothing more current.
- Forgetting that an empty dependency array (`[]`) on `useCallback` means the function will always reference whatever was captured on the *first* render — reintroducing the exact stale closure problem from Part 1.3/2.2 if the function body references state or props that can actually change over time.

### 5.7 Spot the Bug

```jsx
function SearchBox({ onSearch }) {
  const [query, setQuery] = useState('');

  const handleSearch = useCallback(() => {
    onSearch(query);
  }, []);   // empty dependency array

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={handleSearch}>Search</button>
    </div>
  );
}
```
**What's wrong**: `handleSearch` closes over `query`, but the dependency array is empty — so `handleSearch` is only ever created once, on the first render, permanently capturing `query` as it was at that moment (an empty string). No matter what the user subsequently types, clicking "Search" always calls `onSearch('')`. **The fix**: include `query` in the dependency array, so a fresh `handleSearch` (correctly capturing the current `query`) is created whenever `query` changes:
```jsx
const handleSearch = useCallback(() => {
  onSearch(query);
}, [query]);
```
(Note this specific fix means `handleSearch`'s reference changes on every keystroke anyway, which somewhat undercuts the point of memoizing it in the first place unless it's feeding into a memoized child — worth explicitly noting out loud in an interview, since it demonstrates understanding that memoization's *value* depends on how stable the dependencies genuinely are.)

### 5.8 When Interviewers Use This to Test You

Interviewers use the "expensive child list lags when an unrelated counter updates" scenario specifically to check whether a candidate understands **why** re-renders cascade by default (not just that `React.memo` exists), and whether they can correctly diagnose that `React.memo` alone is insufficient without also stabilizing the callback prop via `useCallback` — a very common partial answer is applying `React.memo` and stopping there, then being confused when the child still re-renders, which is itself a useful diagnostic moment interviewers watch for. The deeper thing being evaluated is whether the candidate reaches for memoization as a *targeted fix for an identified, specific problem* (props defeating `React.memo`) rather than either avoiding it entirely out of unfamiliarity, or over-applying it everywhere without being able to explain what each specific instance is protecting.

---

## PART 6: Custom Hooks — The Actual Skill Interviewers Test Most

### 6.1 Theory: What a Custom Hook Actually Is, and the Rules of Hooks

**What problem this solves.** A custom hook is nothing more than a plain JavaScript function whose name starts with `use` and which calls other hooks internally — there is no special React API for "declaring" a custom hook beyond that naming convention. The entire value of a custom hook is **extracting and naming a piece of reusable stateful logic** that would otherwise be copy-pasted, near-identically, across multiple components.

**The Rules of Hooks, and why they exist:**
1. **Only call hooks at the top level** — never inside a loop, a condition, or a nested function.
2. **Only call hooks from React function components or other custom hooks** — never from a plain JavaScript function or a class component.

**Why these rules exist, precisely**: React associates each hook call's internal state with a specific **position in the sequence of hook calls** for a given component instance — not by name, but by call order. On every render, React expects the *same* hooks to be called in the *same* order as the previous render, so it can correctly match "the third `useState` call this render" to "the third `useState` call's stored state from last render." If a hook call is placed inside a conditional (`if (x) { useState(...) }`) and that condition's truthiness changes between renders, the call order shifts, and React's internal bookkeeping desyncs — silently associating the wrong stored state with the wrong hook call, corrupting component state in a way that's often very confusing to debug, since the actual error React raises ("Rendered more/fewer hooks than during the previous render") only describes the *symptom*, not the root cause.

**How to recognize when logic should be extracted into a custom hook**: whenever the same combination of `useState`/`useEffect`/`useRef` logic — not just a single value, but a genuine *behavior* — starts appearing in more than one component, or when a single component's logic would be meaningfully clearer if a self-contained piece of it (e.g. "the debouncing behavior," "the localStorage-syncing behavior") had its own name and its own isolated internal state, separate from the rest of the component's concerns.

### 6.2 Worked Problem: `useDebounce`

**Theory of debouncing, first.** Debouncing means delaying the "effect" of a rapidly-changing value until a period of inactivity has passed — the classic case being a search input, where firing an API call on every single keystroke would be wasteful (and reintroduce the exact race-condition risk from Part 3.5, at a much higher frequency) when the user is still actively typing and hasn't "settled" on a final query yet.

**Narrated build, from scratch:**

*"I need to return a value that only updates after the input value has stopped changing for a given delay. So I need internal state — the debounced value itself — separate from the raw, fast-changing value being passed in. Every time the input value changes, I need to reset a timer; if the timer completes without being reset again, I update the debounced state to match."*

```jsx
function useDebounce(value, delayMs) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timeoutId);   // if `value` changes again before the delay elapses,
                                              // this clears the PREVIOUS timer before starting a new one
  }, [value, delayMs]);

  return debouncedValue;
}
```

*"The cleanup function is doing the actual debouncing work here, worth narrating explicitly: every time `value` changes, React tears down the previous effect (clearing its pending timeout) before running the new one (which starts a fresh timeout). As long as the user keeps typing faster than `delayMs`, every new keystroke cancels the previous pending update before it ever fires — the debounced value only actually updates once keystrokes stop arriving for a full `delayMs` window."*

**Usage:**
```jsx
function SearchBox() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (!debouncedQuery) return;
    // fetch here, using the same race-condition-safe pattern from Part 3.5
  }, [debouncedQuery]);

  return <input value={query} onChange={e => setQuery(e.target.value)} />;
}
```

### 6.3 Worked Problem: `useLocalStorage`

**Narrated build:** *"I want a hook that behaves like `useState`, but automatically persists to and reads from `localStorage`. The tricky edge case: `localStorage` doesn't exist in a server-rendered environment (Node has no `window`/`localStorage`), so I need to guard against that. I'll also use the lazy initializer from Part 2.4, since reading and parsing from `localStorage` is exactly the kind of thing that shouldn't re-run on every render."*

```jsx
function useLocalStorage(key, initialValue) {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') {
      return initialValue;   // SSR guard — no localStorage exists in this environment
    }
    try {
      const stored = window.localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;   // corrupted/unparseable stored value — fall back safely
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
```

*"Usage looks identical to `useState`, which is deliberate — the whole point is that a component using this hook doesn't need to know or care that persistence is happening underneath: `const [theme, setTheme] = useLocalStorage('theme', 'light');`"*

### 6.4 Worked Problem: `useFetch`

**Narrated build:** *"This should combine everything from Part 3.6 — loading, error, and data state, plus the race-condition guard — into a single reusable hook, so every component that needs to fetch something doesn't have to re-derive that same boilerplate."*

```jsx
function useFetch(url) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!url) return;

    let ignore = false;
    setIsLoading(true);
    setError(null);

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        return res.json();
      })
      .then(json => {
        if (!ignore) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [url]);

  return { data, isLoading, error };
}
```

**Usage:**
```jsx
function UserProfile({ userId }) {
  const { data, isLoading, error } = useFetch(`/api/users/${userId}`);

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;
  return <h2>{data.name}</h2>;
}
```

### 6.5 Worked Problem: `useIntersectionObserver` / `useInfiniteScroll`

**Theory first.** The `IntersectionObserver` browser API is exactly the kind of "external system" `useEffect` is meant for — it lets you subscribe to "has this DOM element become visible in the viewport," without manually calculating scroll positions on every scroll event. The custom hook needs a ref (to attach to the DOM element being watched, per Part 4.2's first use case) and state (to reflect whether the element is currently visible, since that needs to trigger a re-render/behavior).

```jsx
function useIntersectionObserver(options = {}) {
  const targetRef = useRef(null);
  const [isIntersecting, setIsIntersecting] = useState(false);

  useEffect(() => {
    const node = targetRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, options);

    observer.observe(node);

    return () => observer.disconnect();
  }, [options]);

  return [targetRef, isIntersecting];
}
```

**Usage — an infinite-scroll list built on top of it:**
```jsx
function InfiniteList() {
  const [items, setItems] = useState(() => generateInitialItems());
  const [page, setPage] = useState(1);
  const [sentinelRef, isSentinelVisible] = useIntersectionObserver({ threshold: 1 });

  useEffect(() => {
    if (!isSentinelVisible) return;

    let ignore = false;
    fetchMoreItems(page).then(newItems => {
      if (!ignore) {
        setItems(prev => [...prev, ...newItems]);
        setPage(prev => prev + 1);
      }
    });

    return () => {
      ignore = true;
    };
  }, [isSentinelVisible, page]);

  return (
    <ul>
      {items.map(item => <li key={item.id}>{item.label}</li>)}
      <li ref={sentinelRef}>Loading more...</li>
    </ul>
  );
}
```
*"The sentinel — an otherwise-empty element at the bottom of the list — is the actual trigger mechanism: as the user scrolls close enough for it to enter the viewport, the observer fires, `isSentinelVisible` becomes true, the effect fetches the next page, and once new items are appended, the sentinel is pushed further down the page, ready to trigger the next fetch when it's approached again. This avoids manually tracking scroll position or scroll event listeners entirely, which is both simpler and more efficient than a raw `onScroll` handler recalculating on every scroll pixel."*

### 6.6 Common Mistakes Across Custom Hooks

- Violating the rules of hooks inside the custom hook itself (calling a hook conditionally, or inside a loop) — the rules apply identically inside a custom hook's own body, since it's really just another React function under the hood.
- Forgetting an SSR guard in any hook that touches browser-only globals (`window`, `document`, `localStorage`) — this crashes outright in a server-rendered environment (Next.js, etc.), not just behaves oddly.
- Not returning a cleanup function from an effect inside a custom hook that sets up a subscription/observer/timer — exactly the same leak risk as Part 3.3, just one layer removed inside the hook's own internals.
- Naming a function `useSomething` when it doesn't actually call any hooks internally — this is misleading (implies stateful behavior that isn't there) and, more importantly, if it's later refactored to include a conditional hook call, violates the rules of hooks in a way that's easy to miss precisely because the function was never meant to hold state to begin with.

### 6.7 Spot the Bug

```jsx
function useToggle(initialValue) {
  if (initialValue === undefined) {
    const [value, setValue] = useState(false);   // conditional hook call
  } else {
    const [value, setValue] = useState(initialValue);
  }
  return [value, () => setValue(v => !v)];
}
```
**What's wrong**: this doesn't even compile correctly in the first place (`value`/`setValue` are scoped inside each `if`/`else` block and unreachable outside it) — but more fundamentally, it violates the Rules of Hooks by placing `useState` inside a conditional at all. Even a corrected version of this specific example should never conditionally decide *whether* to call a hook based on a value that could differ between renders. **The fix**: call the hook unconditionally, and use the conditional logic only to determine what argument to pass in:
```jsx
function useToggle(initialValue = false) {
  const [value, setValue] = useState(initialValue);
  return [value, () => setValue(v => !v)];
}
```

### 6.8 When Interviewers Use This to Test You

Building a custom hook from scratch, live, is one of the highest-signal exercises an interviewer can ask for, precisely because it requires correctly applying nearly everything from Parts 1–5 simultaneously: correct state/ref classification, correct dependency arrays, correct cleanup, and — specifically for `useDebounce`/`useFetch`/`useInfiniteScroll` — correct handling of async race conditions, all inside a piece of code the candidate has never seen before and has to design the shape of themselves. What's being evaluated isn't "do you know `useDebounce` exists" (it's a well-known pattern) — it's whether the candidate can *derive* it from first principles by reasoning about what state is needed and what's being synchronized, which is exactly the Part 0 methodology in action.

---

## PART 6.5: useReducer — Full Deep Dive

### 6.5.1 Theory: What Problem `useReducer` Solves That `useState` Doesn't

**What breaks without it.** When a single user action needs to update **multiple, related pieces of state together, consistently, every time** — for example, "close the modal" needing to simultaneously reset a form's fields, clear a validation error, and set an "is open" flag back to false — managing this with several independent `useState` calls means every single place in the code that performs this action has to remember to call every one of those setters, in the right combination, every single time. This is fragile in a very specific way: it's easy to add a new call site for the same logical action and simply forget one of the several `setState` calls, silently producing an inconsistent state (the modal closes, but the error message is still showing the next time it opens). `useReducer` solves this by **co-locating all of the related state transitions in one place** — a single function that takes "the current state" and "what happened" and returns "the complete next state" — so every place that wants to perform the "close modal" action just dispatches one clearly-named action, and the *reducer itself* is the single place responsible for getting every piece of the transition right, consistently, every time.

### 6.5.2 The Reducer Pattern: `(state, action) => newState`

**Theory first.** A reducer is a **pure function** — given the same `state` and `action` inputs, it must always return the same output, and it must never cause any side effect (no API calls, no `setTimeout`, no mutating anything outside its own scope) while computing that output. This purity is not a stylistic preference — it's what makes reducer-based state transitions **predictable and testable**: you can call a reducer function directly, in a plain unit test, with any `state`/`action` pair you like, and assert on the exact result, with zero setup, no rendering, no mocking of timers or network calls, because the reducer itself never reaches outside its own inputs.

### 6.5.3 Full Syntax

```jsx
const [state, dispatch] = useReducer(reducerFn, initialState);

// Optionally, with lazy initialization (6.5.5):
const [state, dispatch] = useReducer(reducerFn, initialArg, init);
```

- **`reducerFn`** — a function `(state, action) => newState`, called by React every time `dispatch` is invoked.
- **`initialState`** — the state value used on the very first render.
- **`dispatch(action)`** — the function components call to trigger a state transition; `action` is conventionally an object shaped `{ type: 'SOME_ACTION', payload: ... }`, though it can technically be any value the reducer knows how to interpret.

**A minimal example:**
```jsx
function counterReducer(state, action) {
  switch (action.type) {
    case 'increment':
      return { count: state.count + 1 };
    case 'decrement':
      return { count: state.count - 1 };
    case 'reset':
      return { count: 0 };
    default:
      return state;
  }
}

function Counter() {
  const [state, dispatch] = useReducer(counterReducer, { count: 0 });

  return (
    <div>
      <p>{state.count}</p>
      <button onClick={() => dispatch({ type: 'increment' })}>+</button>
      <button onClick={() => dispatch({ type: 'decrement' })}>-</button>
      <button onClick={() => dispatch({ type: 'reset' })}>Reset</button>
    </div>
  );
}
```

### 6.5.4 Action Type Patterns

**String literals vs. named constants**: writing `'increment'` directly, as above, works, but is prone to an easy, silent bug — a typo like `dispatch({ type: 'incrment' })` produces no error at all; it simply falls through to the `default` case and silently does nothing. Defining action types as named constants converts that typo into a build-time/lint-time reference error instead of a silent runtime no-op:
```jsx
const ACTIONS = {
  INCREMENT: 'increment',
  DECREMENT: 'decrement',
  RESET: 'reset',
};

dispatch({ type: ACTIONS.INCREMENT });   // a typo here (ACTIONS.INCRMENT) is caught immediately, not silently ignored
```

**Why a `default` case that's deliberate (not accidentally silent) matters**: returning `state` unchanged for an unrecognized action type is the conventional, safe default — but it's worth being deliberate about it rather than treating it as an afterthought, since it's exactly what silently swallows a typo'd action type. In development, some teams instead choose to `throw` in the default case specifically to surface unrecognized action types loudly rather than silently — a legitimate, defensible choice to mention explicitly in an interview, weighing "fail loudly during development" against "never crash the app over an action-type mismatch in production."

### 6.5.5 Lazy Initialization — the Third Argument

**Theory first.** Exactly like `useState`'s lazy initializer (Part 2.4), `useReducer`'s optional third argument, `init`, lets you compute the initial state via a function that only ever runs once, on mount — useful when the initial state needs to be derived from props or read from an external source (like `localStorage`) rather than being a cheap, static literal.

```jsx
function init(initialCount) {
  return { count: initialCount, history: [] };
}

const [state, dispatch] = useReducer(counterReducer, initialCountProp, init);
```
Here, `initialArg` (`initialCountProp`) is passed to `init` on mount, and `init`'s return value becomes the actual starting state — useful specifically because it keeps the "how do I compute the starting shape" logic named and separate from the reducer itself, and because it can be reused independently (e.g. for a "reset to initial state" action that calls `init` again).

### 6.5.6 When `useReducer` Is the Wrong Choice

**The temptation to over-engineer.** Not every piece of state benefits from being wrapped in a reducer — a single, independent boolean toggle (`isModalOpen`), with no other related state that needs to change alongside it, gains nothing from `useReducer` and loses a real measure of simplicity: a plain `const [isOpen, setIsOpen] = useState(false)` is more directly readable than defining an entire reducer function, a set of action-type constants, and a `dispatch` call, all to express "toggle one boolean." **The rule of thumb**: reach for `useReducer` specifically when multiple pieces of state genuinely change *together*, in response to the *same* actions, in ways that are easy to get inconsistent with separate `useState` calls — not merely because a component happens to have several `useState` calls in it (having several independent pieces of state is completely normal and does not, by itself, justify a reducer).

### 6.5.7 Worked Problem: Converting a Multi-`useState` Todo App to `useReducer`

**The problem, as it might be asked**: "Here's a todo app using four separate `useState` calls — `todos`, `filter`, `editingId`, and `errorMessage`. Refactor it to use a single `useReducer`."

**Narrated solution, applying the Part 0 methodology:**

*"Let me first identify all the related state and think about what actions actually change it. `todos` is the array of todo items. `filter` is which subset to display ('all', 'active', 'completed'). `editingId` tracks which todo, if any, is currently being edited inline. `errorMessage` holds a validation error, e.g. from trying to add an empty todo. These genuinely interact — for instance, successfully saving an edit needs to both update the `todos` array AND clear `editingId` AND clear any `errorMessage`, all together, which is exactly the kind of 'several things change from one action' scenario `useReducer` is built for."*

*"Next, I'll design the action types, one per distinct user action:"*
- `ADD_TODO` — validates non-empty text, appends a new todo, clears any error.
- `TOGGLE_TODO` — flips a specific todo's `done` flag.
- `DELETE_TODO` — removes a specific todo.
- `SET_FILTER` — changes which subset is displayed.
- `START_EDIT` — sets `editingId` to a specific todo's id.
- `SAVE_EDIT` — updates a specific todo's text, clears `editingId` and any error, together.

**The starting (multi-`useState`) version, for reference:**
```jsx
function TodoApp() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  function addTodo(text) {
    if (!text.trim()) {
      setErrorMessage('Todo text cannot be empty');
      return;
    }
    setTodos(prev => [...prev, { id: Date.now(), text, done: false }]);
    setErrorMessage('');
  }

  function saveEdit(id, newText) {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, text: newText } : t)));
    setEditingId(null);
    setErrorMessage('');
  }
  // ... more handlers, each needing to remember every related setState call
}
```

**The reducer, designed around the action list above:**
```jsx
const initialState = {
  todos: [],
  filter: 'all',
  editingId: null,
  errorMessage: '',
};

function todoReducer(state, action) {
  switch (action.type) {
    case 'ADD_TODO': {
      if (!action.payload.text.trim()) {
        return { ...state, errorMessage: 'Todo text cannot be empty' };
      }
      return {
        ...state,
        todos: [...state.todos, { id: Date.now(), text: action.payload.text, done: false }],
        errorMessage: '',
      };
    }
    case 'TOGGLE_TODO':
      return {
        ...state,
        todos: state.todos.map(t =>
          t.id === action.payload.id ? { ...t, done: !t.done } : t
        ),
      };
    case 'DELETE_TODO':
      return {
        ...state,
        todos: state.todos.filter(t => t.id !== action.payload.id),
      };
    case 'SET_FILTER':
      return { ...state, filter: action.payload.filter };
    case 'START_EDIT':
      return { ...state, editingId: action.payload.id };
    case 'SAVE_EDIT':
      return {
        ...state,
        todos: state.todos.map(t =>
          t.id === action.payload.id ? { ...t, text: action.payload.text } : t
        ),
        editingId: null,
        errorMessage: '',
      };
    default:
      return state;
  }
}
```

**The component, now dispatching single, clearly-named actions:**
```jsx
function TodoApp() {
  const [state, dispatch] = useReducer(todoReducer, initialState);

  const visibleTodos = state.todos.filter(t => {
    if (state.filter === 'active') return !t.done;
    if (state.filter === 'completed') return t.done;
    return true;
  });

  return (
    <div>
      {state.errorMessage && <p className="error">{state.errorMessage}</p>}
      <AddTodoForm onAdd={text => dispatch({ type: 'ADD_TODO', payload: { text } })} />
      <ul>
        {visibleTodos.map(todo => (
          <li key={todo.id}>
            {state.editingId === todo.id ? (
              <EditForm
                initialText={todo.text}
                onSave={text => dispatch({ type: 'SAVE_EDIT', payload: { id: todo.id, text } })}
              />
            ) : (
              <>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => dispatch({ type: 'TOGGLE_TODO', payload: { id: todo.id } })}
                />
                {todo.text}
                <button onClick={() => dispatch({ type: 'START_EDIT', payload: { id: todo.id } })}>Edit</button>
                <button onClick={() => dispatch({ type: 'DELETE_TODO', payload: { id: todo.id } })}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```
*"Notice `visibleTodos` is computed directly during render — Part 0's 'derived vs. stored' rule — not stored as its own piece of reducer state, since it's fully computable from `state.todos` and `state.filter` every time."*

### 6.5.8 A Second Worked Problem: A Multi-Step Form Wizard

**The problem, as it might be asked**: "Build a 3-step signup form wizard with Next/Back navigation and per-step validation before advancing."

**Narrated solution**: *"This is a textbook case for `useReducer` — the current step, the accumulated form data across all steps, and any per-step validation error all change together in response to the same actions ('go to next step,' 'go back'), and 'advancing' specifically needs to validate the current step's data before it's allowed to happen at all — exactly the kind of related, action-driven state transition useReducer is designed for."*

```jsx
const initialWizardState = {
  step: 1,
  data: { name: '', email: '', password: '' },
  error: '',
};

function wizardReducer(state, action) {
  switch (action.type) {
    case 'UPDATE_FIELD':
      return { ...state, data: { ...state.data, [action.payload.field]: action.payload.value } };
    case 'NEXT_STEP': {
      const validationError = validateStep(state.step, state.data);
      if (validationError) {
        return { ...state, error: validationError };
      }
      return { ...state, step: state.step + 1, error: '' };
    }
    case 'PREV_STEP':
      return { ...state, step: Math.max(1, state.step - 1), error: '' };
    default:
      return state;
  }
}

function validateStep(step, data) {
  if (step === 1 && !data.name.trim()) return 'Name is required';
  if (step === 2 && !data.email.includes('@')) return 'A valid email is required';
  if (step === 3 && data.password.length < 8) return 'Password must be at least 8 characters';
  return '';
}

function SignupWizard() {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);

  return (
    <div>
      {state.error && <p className="error">{state.error}</p>}
      {state.step === 1 && (
        <input
          value={state.data.name}
          onChange={e => dispatch({ type: 'UPDATE_FIELD', payload: { field: 'name', value: e.target.value } })}
          placeholder="Name"
        />
      )}
      {state.step === 2 && (
        <input
          value={state.data.email}
          onChange={e => dispatch({ type: 'UPDATE_FIELD', payload: { field: 'email', value: e.target.value } })}
          placeholder="Email"
        />
      )}
      {state.step === 3 && (
        <input
          type="password"
          value={state.data.password}
          onChange={e => dispatch({ type: 'UPDATE_FIELD', payload: { field: 'password', value: e.target.value } })}
          placeholder="Password"
        />
      )}
      <button onClick={() => dispatch({ type: 'PREV_STEP' })} disabled={state.step === 1}>Back</button>
      <button onClick={() => dispatch({ type: 'NEXT_STEP' })}>
        {state.step === 3 ? 'Submit' : 'Next'}
      </button>
    </div>
  );
}
```
*"One thing worth calling out explicitly: the validation logic itself (`validateStep`) is a pure, standalone function, called from inside the reducer but not itself containing any side effects — this keeps the reducer honest about purity, since `validateStep` only reads its arguments and returns a string, with no API calls or timers involved."*

### 6.5.9 Common Mistakes

- **Mutating state directly inside the reducer** instead of returning a new object — the same immutability rule as `useState` (Part 2.5), but it's very easy to forget specifically inside a reducer, since the reducer "feels like" a dedicated place for state logic and can lull developers into treating it as a normal imperative function:
```jsx
// WRONG
case 'TOGGLE_TODO':
  const todo = state.todos.find(t => t.id === action.payload.id);
  todo.done = !todo.done;      // mutates the object in place, INSIDE the existing todos array
  return state;                // same state reference returned — React sees no change at all
```
- **Forgetting to spread existing state when updating one field** — `return { errorMessage: 'x' }` instead of `return { ...state, errorMessage: 'x' }` silently discards every other field in state, which is a much more severe, often confusing bug than the equivalent mistake with `useState` (since a reducer's state is very often a bigger, multi-field object where "just returning the new field" quietly wipes everything else).
- **Putting side effects (API calls) directly inside the reducer**, rather than in an effect or event handler that dispatches an action afterward — this violates the reducer's required purity and makes the state transition untestable/unpredictable in isolation; the correct pattern is to perform the side effect in an event handler or `useEffect`, then `dispatch` the *result* of that side effect as a plain action once it's known.

### 6.5.10 Spot the Bug

```jsx
function cartReducer(state, action) {
  switch (action.type) {
    case 'ADD_ITEM':
      state.items.push(action.payload);
      return state;
    default:
      return state;
  }
}
```
**What's wrong**: `state.items.push(...)` mutates the existing array in place, and `return state` returns the exact same object reference the reducer received as input. React (and `useReducer` specifically) compares the previous and next state by reference to decide whether to re-render — since `state` here is literally the same object as before, React sees no change at all, and the component will not re-render, even though `state.items` genuinely now has one more element sitting inside it in memory. This is the reducer-specific version of exactly the bug from Part 2.5. **The fix**:
```jsx
case 'ADD_ITEM':
  return { ...state, items: [...state.items, action.payload] };
```

### 6.5.11 What Interviewers Are Testing With `useReducer`

Pushing a candidate toward `useReducer` — either by directly asking for it, or by presenting a problem with enough interrelated state that a reducer is clearly the better shape — is testing three specific things: first, whether the candidate can **recognize when state transitions are genuinely related** and should be co-located, rather than defaulting to a pile of independent `useState` calls regardless of how entangled the actual logic is; second, whether the candidate's grasp of **immutability is deep enough to apply correctly inside a reducer specifically**, not just something they've memorized as a `useState` pattern (the mutating-reducer bug in 6.5.10 is an extremely common real mistake, precisely because the reducer *feels* like a safe place to write "normal" imperative code); and third, whether the candidate can **design a clean, well-named action/type API** (like the todo app's six clearly-scoped actions) rather than a single grab-bag reducer with one vague action type and a pile of conditional logic crammed inside it.

### 6.5.12 `useReducer` + `useContext` — Replacing Prop Drilling Without a Library

**Theory first, briefly.** **Prop drilling** is passing a piece of state (and the functions to update it) down through several layers of components that don't themselves use that state — they only pass it further down to some descendant that does. The **Context API** lets a value be provided once, at a high level in the tree, and read directly by any descendant that needs it, at any depth, without every intermediate component having to explicitly forward it as a prop. Combining `useReducer` (for the state and its transitions) with `useContext` (to make both the state and `dispatch` available anywhere in the subtree) is a common, genuinely effective way to get "centralized, app-wide-ish state management" without reaching for an external library at all:

```jsx
const TodoContext = createContext(null);

function TodoProvider({ children }) {
  const [state, dispatch] = useReducer(todoReducer, initialState);
  return (
    <TodoContext.Provider value={{ state, dispatch }}>
      {children}
    </TodoContext.Provider>
  );
}

function useTodoContext() {
  const context = useContext(TodoContext);
  if (!context) throw new Error('useTodoContext must be used within a TodoProvider');
  return context;
}

// Any descendant, at any depth, can now do this directly — no prop drilling required:
function DeeplyNestedDeleteButton({ todoId }) {
  const { dispatch } = useTodoContext();
  return <button onClick={() => dispatch({ type: 'DELETE_TODO', payload: { id: todoId } })}>Delete</button>;
}
```

This exact pattern is a very common interview follow-up to a `useReducer` problem — "how would you make this state available across a larger app, without prop drilling and without pulling in Redux?" — and `useReducer` + `useContext` is the direct, no-extra-dependency answer, covered further in Part 8.2's discussion of when Context is (and isn't) the right tool.

---

## PART 7: Common React Coding Interview Problem Patterns

Each pattern below follows the same shape: the problem as it would actually be asked, a narrated solution explicitly applying the Part 0 methodology, full working code, and the follow-up questions an interviewer is likely to ask next. Several of these build directly on hooks already fully derived earlier in this document — where that's true, this section gives the polished, final treatment rather than re-deriving the same reasoning twice, but the cross-reference is called out explicitly.

### 7.1 Debounced Search Input

**Problem statement**: "Build a search box that calls an API to fetch results, but only after the user has stopped typing for a short delay — not on every keystroke."

**Narrated solution**: *"Step 1 of the methodology — what are the inputs and what triggers a re-render? The raw input value changes on every keystroke (needs state, since it's a controlled input), but the actual API call should only fire after a pause. That's exactly `useDebounce` from Part 6.2 — I'll reuse it rather than re-deriving debouncing inline. Step 2 — state: `query` (raw, fast-changing), `results`/`isLoading`/`error` (fetch state, per Part 3.6's pattern). The effect that fetches should depend on the *debounced* query, not the raw one, and needs the race-condition guard from Part 3.5, since the debounced value can still change again before a slow request resolves."*

**Full working code:**
```jsx
function useDebounce(value, delayMs) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debouncedValue;
}

function DebouncedSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    let ignore = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      .then(res => res.json())
      .then(data => {
        if (!ignore) {
          setResults(data);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => { ignore = true; };
  }, [debouncedQuery]);

  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search..." />
      {isLoading && <p>Searching...</p>}
      {error && <p>Something went wrong.</p>}
      <ul>{results.map(r => <li key={r.id}>{r.title}</li>)}</ul>
    </div>
  );
}
```

**Likely follow-ups**: "What if the input is cleared entirely — should it re-fetch or clear results?" (handled above by short-circuiting on empty query); "How would you cancel the in-flight request itself, not just ignore its result?" (`AbortController`, Part 3.5); "How would you cache results for a query the user has already searched, to avoid re-fetching?" (a simple in-memory `Map` keyed by query, or reaching for React Query/SWR in production).

### 7.2 Infinite Scroll / "Load More" List

**Problem statement**: "Build a list that automatically loads more items as the user scrolls near the bottom."

**Narrated solution**: *"This is exactly `useIntersectionObserver` plus a sentinel element, fully derived in Part 6.5 — I'd build it the same way: a ref-based observer hook, a sentinel element at the list's end, and an effect that fetches the next page when the sentinel becomes visible, guarded against re-fetching while a request is already in flight."*

**Full working code** (the version from Part 6.5, with an explicit in-flight guard added):
```jsx
function InfiniteList() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [isFetching, setIsFetching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sentinelRef, isSentinelVisible] = useIntersectionObserver({ threshold: 1 });

  useEffect(() => {
    if (!isSentinelVisible || isFetching || !hasMore) return;

    let ignore = false;
    setIsFetching(true);

    fetchPage(page).then(({ newItems, hasMorePages }) => {
      if (!ignore) {
        setItems(prev => [...prev, ...newItems]);
        setPage(prev => prev + 1);
        setHasMore(hasMorePages);
        setIsFetching(false);
      }
    });

    return () => { ignore = true; };
  }, [isSentinelVisible, isFetching, hasMore, page]);

  return (
    <ul>
      {items.map(item => <li key={item.id}>{item.label}</li>)}
      {hasMore && <li ref={sentinelRef}>{isFetching ? 'Loading more...' : ''}</li>}
    </ul>
  );
}
```
*"The `isFetching`/`hasMore` guards are worth calling out explicitly, unprompted: without `isFetching`, the sentinel staying visible while a request is still in flight would trigger duplicate overlapping fetches for the same page; without `hasMore`, the component would keep trying to fetch pages past the end of the data forever."*

**Likely follow-ups**: "How would you handle the user scrolling back up and then back down — does it re-fetch already-loaded pages?" (no, since `page` only increments forward and past items remain in `items`); "How would you show a distinct error state if a page fetch fails?" (an `error` state, with a manual retry button, rather than silently getting stuck); "How does this interact with very large lists performance-wise?" (a natural segue to virtualization, Part 7.10).

### 7.3 A Todo List With Add/Remove/Toggle/Edit

**Problem statement**: "Build a todo list: add a new todo, mark it complete, delete it, and edit its text inline."

**Narrated solution**: *"Given the number of related state pieces here — the todos array, which one's being edited, any validation error — this is a strong candidate for `useReducer`, exactly as fully derived in Part 6.5.7. I'd design action types first (`ADD_TODO`, `TOGGLE_TODO`, `DELETE_TODO`, `START_EDIT`, `SAVE_EDIT`), then write the reducer, being careful about immutability at every single case — `.map()`/`.filter()`/spread, never direct mutation."*

**Full working code**: identical to Part 6.5.7's complete solution — reused here rather than duplicated, since the derivation is already fully narrated there.

**Likely follow-ups**: "How would you persist the todos across page reloads?" (`useLocalStorage`, Part 6.3, layered underneath the reducer's initial state via lazy initialization); "How would you support undo after deleting a todo?" (keep a small history/stack of previous states, or a "soft delete" flag with a timed "Undo" toast before permanently removing it); "How would this scale to hundreds of todos, performance-wise?" (`React.memo` on individual todo items, Part 5, so toggling one todo doesn't re-render every other item's DOM node).

### 7.4 A Stopwatch/Timer With Start/Pause/Reset/Lap

**Problem statement**: "Build a stopwatch with start, pause, reset, and a 'lap' button that records the current elapsed time into a list without stopping the clock."

**Narrated solution**: *"The start/pause/reset core is exactly Part 4.4's stopwatch — elapsed time and running-state as `useState`, the interval ID as a `useRef` (never displayed, shouldn't trigger a re-render). 'Lap' is new: it's simply appending the *current* elapsed time to a list at the moment the button is clicked — no new effect needed at all, since this is a plain event-driven state update, not a synchronization with anything external."*

**Full working code**, extending Part 4.4:
```jsx
function Stopwatch() {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [laps, setLaps] = useState([]);
  const intervalIdRef = useRef(null);

  useEffect(() => {
    if (!isRunning) return;
    intervalIdRef.current = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000);
    return () => clearInterval(intervalIdRef.current);
  }, [isRunning]);

  function handleReset() {
    setIsRunning(false);
    setElapsedSeconds(0);
    setLaps([]);
  }

  function handleLap() {
    setLaps(prev => [...prev, elapsedSeconds]);
  }

  return (
    <div>
      <p>{elapsedSeconds}s</p>
      <button onClick={() => setIsRunning(true)} disabled={isRunning}>Start</button>
      <button onClick={() => setIsRunning(false)} disabled={!isRunning}>Pause</button>
      <button onClick={handleLap} disabled={!isRunning}>Lap</button>
      <button onClick={handleReset}>Reset</button>
      <ol>{laps.map((lap, i) => <li key={i}>{lap}s</li>)}</ol>
    </div>
  );
}
```
*"Worth noting out loud: `laps` is keyed by index here deliberately, unlike Part 1.4's warning — laps are only ever appended, never reordered or removed from the middle, so index-as-key is one of the legitimate exceptions to that rule, not a violation of it."*

**Likely follow-ups**: "How would you make the timer accurate over long durations, given `setInterval` can drift?" (a genuinely deep follow-up — the honest answer is comparing against `Date.now()`/`performance.now()` timestamps rather than trusting a naive tick-count, since `setInterval`'s scheduling isn't guaranteed to fire at exactly the requested interval); "How would you support millisecond precision instead of whole seconds?" (a shorter interval plus formatting logic, same underlying pattern).

### 7.5 A Modal With Focus Trapping and Escape-Key Handling

**Problem statement**: "Build a modal dialog that closes on Escape, closes on clicking outside its content, and traps keyboard focus inside itself while open."

**Narrated solution**: *"State first: `isOpen`, controlled by whatever opens/closes the modal — often lifted to a parent, or local if self-contained. The Escape-key and focus-trap behavior are genuine synchronizations with an external system — the browser's document-level keyboard events and the currently-focused DOM element — so both belong in `useEffect`s that only run while the modal is actually open, with cleanup removing the listeners when it closes or unmounts, exactly like Part 3.3's subscription pattern."*

**Full working code:**
```jsx
function Modal({ isOpen, onClose, children }) {
  const contentRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !contentRef.current) return;

    const previouslyFocused = document.activeElement;
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = contentRef.current.querySelectorAll(focusableSelectors);
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    first?.focus();

    function handleTabKey(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    contentRef.current.addEventListener('keydown', handleTabKey);

    return () => {
      contentRef.current?.removeEventListener('keydown', handleTabKey);
      previouslyFocused?.focus();   // restore focus to whatever triggered the modal, on close
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" ref={contentRef} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
```
*"Two things worth narrating explicitly even without being asked: `onClick={e => e.stopPropagation()}` on the content div is what makes clicking outside (on the overlay) close the modal while clicking inside doesn't — a common thing to get backwards. And restoring focus to `previouslyFocused` on close is an accessibility detail easy to forget, but genuinely important for keyboard/screen-reader users, who'd otherwise lose their place in the page entirely once the modal closes."*

**Likely follow-ups**: "How would you prevent the page behind the modal from scrolling while it's open?" (toggling a CSS class/overflow style on `document.body` inside the same effect, with cleanup restoring it); "How would you support nested/stacked modals?" (each modal instance needs its own focus-trap scope, and Escape should only close the topmost one); "Why use a raw DOM query for focusable elements instead of tracking them in state?" (this is a legitimate direct DOM read, not something that needs to trigger a re-render — a good moment to reference Part 4's ref/DOM-access use case).

---

### 7.6 A Tabs Component (Controlled Component Pattern)

**Problem statement**: "Build a tabs component: a row of tab labels, and only the active tab's content is shown."

**Narrated solution**: *"Just one piece of state — which tab is currently active. I'd initially reach for the tab's index, but the more robust choice is a stable identifier (a `key` or `id` per tab) rather than a raw index, for the same reasons Part 1.4 covered for list keys: if tabs are ever reordered or conditionally shown/hidden, an index can point at the wrong tab, while a stable id always points at the right one regardless of position."*

**Full working code:**
```jsx
function Tabs({ tabs, defaultActiveId }) {
  const [activeId, setActiveId] = useState(defaultActiveId ?? tabs[0]?.id);
  const activeTab = tabs.find(t => t.id === activeId);

  return (
    <div>
      <div role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{activeTab?.content}</div>
    </div>
  );
}
```
*"Note `activeTab` is derived during render, not stored separately — Part 0's rule again: it's fully computable from `activeId` and the `tabs` prop, so storing it redundantly would risk desyncing if `tabs` itself ever changed while an old `activeTab` object was still cached in state."*

**Likely follow-ups**: "How would you make this a 'controlled' component, where the parent owns the active tab state instead?" (accept `activeId`/`onChange` as props instead of internal `useState`, exactly the controlled-vs-uncontrolled distinction familiar from native form inputs); "How would you support keyboard navigation between tabs with arrow keys?" (an additional `onKeyDown` handler on the tablist, moving focus and `activeId` together, echoing the modal's focus-management theme from 7.5).

### 7.7 An Accordion (Single-Open vs. Multi-Open Variants)

**Problem statement**: "Build an accordion of expandable sections. Support both a mode where only one section can be open at a time, and a mode where multiple can be open simultaneously."

**Narrated solution**: *"The state shape itself is the interesting design decision here, and it's genuinely different between the two variants — worth stating this distinction out loud immediately, since it's exactly the kind of thing that separates a strong answer from a mediocre one. Single-open: I only ever need to track *one* currently-open id (or `null` for none), since opening a new one always implies closing whatever was open before. Multi-open: I need a *set* of open ids, since opening one shouldn't affect any other."*

**Full working code, single-open variant:**
```jsx
function AccordionSingle({ sections }) {
  const [openId, setOpenId] = useState(null);

  function toggle(id) {
    setOpenId(prev => (prev === id ? null : id));   // clicking the currently-open section closes it
  }

  return (
    <div>
      {sections.map(section => (
        <div key={section.id}>
          <button onClick={() => toggle(section.id)}>{section.title}</button>
          {openId === section.id && <div>{section.content}</div>}
        </div>
      ))}
    </div>
  );
}
```

**Full working code, multi-open variant:**
```jsx
function AccordionMulti({ sections }) {
  const [openIds, setOpenIds] = useState(() => new Set());

  function toggle(id) {
    setOpenIds(prev => {
      const next = new Set(prev);   // NEW Set instance — never mutate the existing one in place
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div>
      {sections.map(section => (
        <div key={section.id}>
          <button onClick={() => toggle(section.id)}>{section.title}</button>
          {openIds.has(section.id) && <div>{section.content}</div>}
        </div>
      ))}
    </div>
  );
}
```
*"Worth calling out explicitly: `new Set(prev)` creates a fresh `Set` instance before mutating it, exactly mirroring the spread-to-copy pattern for arrays/objects from Part 2.5 — `Set`/`Map` don't have a spread shorthand the same way plain objects/arrays do, but the same 'always produce a new reference' rule applies identically."*

**Likely follow-ups**: "How would you animate the open/close transition smoothly?" (a legitimate CSS/height-transition discussion, somewhat separate from the state logic itself); "How would you support 'expand all'/'collapse all' in the multi-open variant?" (a `Set` containing every id, or an empty `Set`, set directly rather than toggled one at a time).

### 7.8 A Form With Validation (Errors Shown Only After Blur/Submit)

**Problem statement**: "Build a signup form with a name and email field. Show validation errors, but only after the user has interacted with a field (on blur) or attempted to submit — never while they're still typing into a field for the first time."

**Narrated solution**: *"The key requirement that shapes the state design is 'errors only after interaction' — this means I need to track not just the field values and their errors, but also *which fields have been touched*, separately, since a field can be invalid (empty) from the very first render without that being an error worth showing yet. Three pieces of state per field, conceptually: value, touched, and the derived error (computed from value, not stored separately, per Part 0's derived-vs-stored rule)."*

**Full working code:**
```jsx
function validateName(name) {
  return name.trim() ? '' : 'Name is required';
}
function validateEmail(email) {
  return /\S+@\S+\.\S+/.test(email) ? '' : 'A valid email is required';
}

function SignupForm() {
  const [values, setValues] = useState({ name: '', email: '' });
  const [touched, setTouched] = useState({ name: false, email: false });
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const errors = {
    name: validateName(values.name),
    email: validateEmail(values.email),
  };

  function handleChange(field, value) {
    setValues(prev => ({ ...prev, [field]: value }));
  }

  function handleBlur(field) {
    setTouched(prev => ({ ...prev, [field]: true }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!errors.name && !errors.email) {
      console.log('submitting', values);
    }
  }

  const showNameError = (touched.name || submitAttempted) && errors.name;
  const showEmailError = (touched.email || submitAttempted) && errors.email;

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={values.name}
        onChange={e => handleChange('name', e.target.value)}
        onBlur={() => handleBlur('name')}
      />
      {showNameError && <p className="error">{errors.name}</p>}

      <input
        value={values.email}
        onChange={e => handleChange('email', e.target.value)}
        onBlur={() => handleBlur('email')}
      />
      {showEmailError && <p className="error">{errors.email}</p>}

      <button type="submit">Sign Up</button>
    </form>
  );
}
```
*"Errors themselves are computed fresh on every render from `values` — never stored in their own state — which is exactly why they can never go stale relative to what's actually typed; only `touched`/`submitAttempted` control *visibility* of an already-current error, not its correctness."*

**Likely follow-ups**: "How would you generalize this to an arbitrary number of fields without repeating this pattern per field?" (a natural segue to `useReducer`, Part 6.5, or a small custom `useForm` hook generalizing the `values`/`touched`/`errors` shape); "How would you debounce an async validation check, like 'is this email already taken'?" (combining `useDebounce`, Part 6.2, with a fetch-based validator).

### 7.9 A Star Rating Widget (Hover Preview vs. Selected State)

**Problem statement**: "Build a 5-star rating widget. Hovering over a star should preview that rating; moving the mouse away should revert to the actually-selected rating, which only changes on click."

**Narrated solution**: *"This is a clean, deliberate two-piece-of-state problem, and naming both explicitly up front avoids confusing them while coding: `selectedRating` (the committed value, changes only on click) and `hoverRating` (a transient preview, changes on mouse enter/leave, unrelated to what's actually selected). The rendered fill of each star is a derived value — computed from whichever of the two is currently 'active': `hoverRating` if the mouse is currently over the widget at all, otherwise `selectedRating`."*

**Full working code:**
```jsx
function StarRating({ maxStars = 5, onRate }) {
  const [selectedRating, setSelectedRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(null);

  const displayedRating = hoverRating ?? selectedRating;

  function handleClick(star) {
    setSelectedRating(star);
    onRate?.(star);
  }

  return (
    <div onMouseLeave={() => setHoverRating(null)}>
      {Array.from({ length: maxStars }, (_, i) => i + 1).map(star => (
        <span
          key={star}
          onMouseEnter={() => setHoverRating(star)}
          onClick={() => handleClick(star)}
          style={{ cursor: 'pointer', color: star <= displayedRating ? 'gold' : 'gray' }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
```
*"`hoverRating` uses `null` specifically to mean 'not currently hovering,' distinct from `0`, which would ambiguously mean either 'not hovering' or 'hovering over a hypothetical zero-star position' — using `??` (nullish coalescing) rather than `||` here is deliberate too, since `selectedRating` being legitimately `0` (no rating yet) shouldn't be treated as falsy and overridden."*

**Likely follow-ups**: "How would you support half-star ratings?" (finer-grained mouse-position tracking within each star's width, a meaningfully harder follow-up); "How would you make this keyboard-accessible?" (arrow keys to move the selected rating, Enter/Space to confirm — another accessibility callback to Part 0.5's checklist).

### 7.10 Virtualized/Windowed List Rendering

**Conceptual explanation.** Rendering a list of, say, 50,000 items directly means creating 50,000 real DOM nodes — even if only a few dozen are ever visible in the scrollable viewport at once, the browser still has to create, lay out, and manage all 50,000, which is genuinely slow and memory-heavy. **Virtualization** (a.k.a. "windowing") solves this by rendering **only the small subset of items currently visible in (or near) the viewport**, calculating their positions manually via absolute positioning or a transform, and swapping which items are actually mounted as the user scrolls — so the DOM never holds more than a small, roughly-constant number of real nodes, regardless of how large the underlying list is.

**A simplified implementation** (production code should use a battle-tested library like `react-window` or `react-virtualized` — the goal here is understanding the mechanism, not reimplementing it wholesale):
```jsx
function VirtualizedList({ items, itemHeight, containerHeight }) {
  const [scrollTop, setScrollTop] = useState(0);

  const startIndex = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(containerHeight / itemHeight);
  const endIndex = Math.min(items.length, startIndex + visibleCount + 1);   // +1 buffer item
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      style={{ height: containerHeight, overflowY: 'auto', position: 'relative' }}
      onScroll={e => setScrollTop(e.target.scrollTop)}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        {visibleItems.map((item, i) => (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              top: (startIndex + i) * itemHeight,
              height: itemHeight,
              width: '100%',
            }}
          >
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
```
*"The outer inner `div` with `height: items.length * itemHeight` is the key trick — it gives the scrollable container the correct *total* scrollable height, even though only a handful of real item nodes actually exist inside it at any moment, which is what makes the scrollbar itself behave correctly and proportionally."*

**Likely follow-ups**: "What if items have variable, not fixed, heights?" (a meaningfully harder problem — requires either measuring rendered heights and caching them, or an estimation-and-correction approach, which is exactly why real virtualization libraries exist rather than everyone reimplementing this from scratch); "How does this interact with accessibility — can a screen reader user still navigate the full list?" (a genuine, unresolved trade-off worth naming honestly rather than glossing over).

### 7.11 A Component That Fetches and Displays Paginated Data With Page Controls

**Problem statement**: "Build a component showing a page of results at a time, with Previous/Next buttons and the current page number, fetching new data whenever the page changes."

**Narrated solution**: *"This is structurally the same fetch-on-changing-dependency pattern as Part 3.6's `UserProfile` example, with `page` playing the role `userId` played there — same loading/error state, same race-condition guard, since navigating pages quickly (double-clicking Next) is exactly the rapid-repeated-action edge case from Part 0.5."*

**Full working code:**
```jsx
function PaginatedList() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let ignore = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/items?page=${page}`)
      .then(res => res.json())
      .then(json => {
        if (!ignore) {
          setData(json);
          setIsLoading(false);
        }
      })
      .catch(err => {
        if (!ignore) {
          setError(err);
          setIsLoading(false);
        }
      });

    return () => { ignore = true; };
  }, [page]);

  if (isLoading) return <p>Loading page {page}...</p>;
  if (error) return <p>Failed to load page {page}.</p>;

  return (
    <div>
      <ul>{data.items.map(item => <li key={item.id}>{item.label}</li>)}</ul>
      <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</button>
      <span> Page {page} of {data.totalPages} </span>
      <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>Next</button>
    </div>
  );
}
```
*"Disabling the Previous/Next buttons at the boundaries — rather than letting them fire an out-of-range fetch and rely on the server to reject it — is a small but deliberate UX choice worth mentioning out loud."*

**Likely follow-ups**: "How would you sync the current page with the URL, so it survives a refresh or is shareable?" (a routing-library-specific discussion — reading/writing a query parameter instead of, or alongside, local state); "How would you prefetch the next page in the background before the user clicks Next?" (a genuinely more advanced follow-up, hinting at exactly the kind of caching/prefetching a library like React Query provides out of the box).

---

## PART 8: State Management Beyond useState — When Local State Isn't Enough

### 8.1 `useReducer`, Recapped in This Context

Part 6.5 covered `useReducer` in full theoretical and practical depth — worth restating briefly here, in context: it beats several independent `useState` calls specifically when multiple pieces of state change **together**, in response to the **same** actions, since co-locating those transitions in one reducer function eliminates the risk of a call site updating one piece of related state while forgetting another. It is not, by itself, a solution to prop drilling or cross-component sharing — that's what Context (below) adds on top of it.

### 8.2 Context API — What Problem It Solves, and When It's the Right Tool

**Theory first.** **Prop drilling** is passing a value through several layers of components purely so a distant descendant can eventually receive it — every intermediate component has to accept and forward the prop, even though it has no use for the value itself, purely acting as a relay. **Context** lets a value be provided once, at some ancestor in the tree, and read directly by any descendant via `useContext`, at any depth, without every layer in between needing to know or care that the value is being passed through.

```jsx
const ThemeContext = createContext('light');

function App() {
  const [theme, setTheme] = useState('light');
  return (
    <ThemeContext.Provider value={theme}>
      <Toolbar />   {/* Toolbar itself never touches theme directly */}
    </ThemeContext.Provider>
  );
}

function Toolbar() {
  return <ThemedButton />;   {/* neither does Toolbar's own child, here */}
}

function ThemedButton() {
  const theme = useContext(ThemeContext);   // reads directly, regardless of how many layers deep it is
  return <button className={theme}>Click me</button>;
}
```

**When Context is the right tool**: genuinely global-ish, rarely-changing values that many, arbitrarily-deep descendants need — theme, the current authenticated user, locale/i18n settings, or (combined with `useReducer`, Part 6.5.12) a moderately-sized piece of shared application state that would otherwise require prop drilling through many unrelated layers.

**When Context causes unnecessary re-renders across the app, and is the wrong tool**: **every** component that calls `useContext` for a given context re-renders whenever that context's value changes — with no built-in mechanism to subscribe to only *part* of the value. A context holding a large, frequently-changing object (e.g. `{ user, notifications, cartItems, uiState }` all bundled into one provider) means a change to just `notifications` re-renders every consumer of that context, including ones that only ever read `user` and never touch `notifications` at all. **The fix**, when this becomes a real, measured problem: split a single large context into several smaller, more narrowly-scoped ones (a `UserContext`, a separate `NotificationsContext`), so a component only re-renders when the *specific* slice of data it actually consumes changes.

### 8.3 `useReducer` + Context vs. External State Libraries

**Theory first, framed as a genuine trade-off, not a strict hierarchy.** `useReducer` + Context, built entirely from React's own built-in primitives, is a completely legitimate, real production pattern for small-to-medium apps and for state genuinely scoped to one feature/subtree — no extra dependency, no extra bundle size, no new concepts to onboard a team onto. **Redux Toolkit** and **Zustand** (and similar external libraries) earn their keep specifically once an app's state management needs grow past what the built-in primitives comfortably handle: fine-grained subscriptions (a component re-renders only when the *specific slice* of state it reads changes, without manually splitting contexts by hand), built-in devtools for time-travel debugging and inspecting every dispatched action, middleware for things like persisting state or logging every transition, and patterns purpose-built for large, deeply-shared, cross-cutting state that spans many unrelated features.

**Decision guidance, interview-ready**: "For state genuinely local to one feature or one subtree — even a fairly complex one, like the todo app or the form wizard — I'd default to `useReducer`, possibly with Context if it needs to be shared across a few components. I'd reach for an external library specifically once I'm dealing with state that's shared very broadly across a large app, needs fine-grained subscription performance that manual context-splitting becomes tedious to maintain by hand, or benefits meaningfully from dedicated devtools — I wouldn't reach for Redux by default 'just in case,' since it's real, avoidable overhead for a problem React's own primitives already solve at a smaller scale."

---

## PART 9: Debugging Methodology for Live Coding

### 9.1 A Step-by-Step Checklist, Extended With Actual Tactics

Part 0.2's checklist is about **prevention** — reasoning correctly up front. This section is about **diagnosis** — what to actually *do*, concretely, once something is already visibly broken and you need to find out why, under the same time pressure.

1. **Isolate which render is actually wrong, first.** Add a `console.log` at the very top of the component body (not inside an effect or handler) printing the relevant props/state — this tells you, directly, what values the component is actually seeing on the render that's misbehaving, rather than guessing.
2. **If the bug looks like "stale value," check the closures.** Print the specific value inside the suspect callback/effect *at the moment it fires*, and compare it to what you'd expect given the current render. A mismatch here is the direct signature of a stale closure (Part 1.3) — the fix is almost always either a functional update (Part 2.2) or moving the value into a ref (Part 4.3).
3. **If the bug looks like "state didn't update the UI at all," check for a mutation.** Log the state variable's reference (or just eyeball whether you called `.push`/direct assignment anywhere) — a value that's genuinely changing in memory but never triggering a re-render is almost always a referential-equality mutation bug (Part 2.5/6.5.10), not a "React is broken" situation.
4. **Temporarily comment out effects, one at a time, to isolate which one is responsible.** If a component has multiple effects and something's misbehaving, disabling all but one at a time (even just by commenting the `useEffect` call out entirely) quickly narrows down which specific effect is the actual source, rather than staring at all of them simultaneously trying to reason about their interaction all at once.
5. **Use React DevTools to inspect actual re-renders**, if available in the interview environment — the Profiler tab can show exactly which components re-rendered and, often, highlight *why* (which prop/state changed) — genuinely faster than manually reasoning through the whole tree by hand when it's available.
6. **Check the dependency array against every value actually referenced inside the effect/callback body, line by line**, since this is the single most common source of both "runs too often" and "runs too rarely, with stale data" bugs, and it's a completely mechanical check you can do by eye even without a linter running.

### 9.2 How to Narrate Your Debugging Process Out Loud

Exactly like Part 0.3's guidance for being stuck on the *design* of a solution, the same principle applies to debugging an existing bug: narrate the hypothesis, not just the fix.

- *"The count seems to always show the initial value inside this interval — that's the classic stale closure symptom, so let me check whether this effect's dependency array is missing something, or whether I should switch to a functional update."*
- *"The list isn't re-rendering even though I can see the array growing if I log it — let me check whether I'm mutating the existing array instead of creating a new one."*
- *"Let me comment out this second effect for a second, just to confirm whether the bug is actually coming from here or from the first one."*

This matters for the same reason as Part 0.3: an interviewer watching a candidate debug in silence, then suddenly produce a fix, cannot tell whether that fix came from genuine, structured reasoning or from a lucky guess — narrating the specific *hypothesis* being tested at each step is what makes the actual skill visible.

---

## PART 10: Interview-Ready Summary

### 10.1 Fifteen to Twenty Likely Interview Questions, With Model Spoken Answers

**1. What actually triggers a React component to re-render?**
"Three things: its own state changing via a setter, its parent re-rendering (which by default cascades to every child regardless of that child's own props), or a Context value it subscribes to changing. It's worth remembering that a re-render just means React calling the component function again — it doesn't by itself mean the DOM is touched; that only happens in the commit phase, and only for the parts that actually differ from before."

**2. Explain what a stale closure is, and give an example of when it happens.**
"A stale closure happens when a function created during one render — say, inside a `setTimeout` or an interval — keeps referencing that specific render's captured values, even after the component has since re-rendered many times with new values. The classic example is an interval set up in a `useEffect` with an empty dependency array that logs a state variable: since the effect only ran once, the interval's callback is permanently stuck referencing whatever that state variable was on that very first render."

**3. Why do functional updates (`setCount(prev => prev + 1)`) fix certain bugs that direct updates don't?**
"Because a functional update receives the actual current state at the moment it's applied, rather than whatever was captured in the closure that scheduled it. This matters most when multiple updates to the same state are queued together — like three `setCount(count + 1)` calls in one handler, which all read the same stale `count` and only net out to a single increment, versus three functional updates, which correctly chain off each other's results."

**4. Why can't you mutate state directly, even though JavaScript would technically allow it?**
"Because React detects whether state actually changed using reference equality, not deep equality. If you mutate an object or array in place and pass the same reference back into the setter, React can see the old and new values are literally the same object and may skip the re-render entirely — this is why 'I mutated it, but the screen didn't update' is such a specific, common symptom, not a random fluke."

**5. What is `useEffect` actually for, conceptually?**
"It's a synchronization mechanism between React state and something external to React — a timer, a subscription, a network request, direct DOM manipulation not otherwise expressible declaratively. It's not a lifecycle hook, and thinking of it as 'the mount/unmount hook' actively leads to bugs, because the dependency array isn't an afterthought bolted onto a lifecycle method — it's the actual, honest description of what values the synchronization depends on."

**6. When do you NOT need a `useEffect`?**
"Whenever the thing you're computing can be derived directly from existing props/state during render — filtering a list, computing a total, deriving one piece of state from another. If nothing external is actually being synchronized with, an Effect is almost always the wrong tool, and 'you might not need an Effect' is explicitly called out in React's own documentation for exactly this reason."

**7. How do you avoid a race condition in a `useEffect` that fetches data based on a changing value?**
"Use a cleanup-scoped ignore flag, or an AbortController. Every time the effect re-runs — because its dependency changed — the previous run's cleanup function marks that specific in-flight request as stale, so even if it resolves later, its result is discarded rather than overwriting a more recent, correct result."

**8. What's the difference between `useState` and `useRef`, and how do you decide which to use?**
"`useState` triggers a re-render when it changes and is torn down and recreated on unmount/remount; `useRef` persists across renders too, but changing it never triggers a re-render. I ask: does this value need to visually update the UI when it changes? If yes, it's state. If it just needs to persist quietly across renders — a timer ID, a 'have I already done this' flag, a DOM node reference — it's a ref."

**9. Why would storing a `setInterval` ID in `useState` be a mistake?**
"Two reasons: it triggers an unnecessary re-render every time you start a new interval, for a value that's never actually displayed anywhere; and reading it back correctly from other handlers is subject to the same stale-closure risk as any other state, whereas a ref is always read live, with no closure staleness concern at all."

**10. What does referential equality mean, and why does it matter for `useMemo`/`useCallback`?**
"Two separately-created objects, arrays, or functions are never `===` to each other, even with identical contents — every render creates brand-new instances of any inline literal. `useMemo`/`useCallback` return the *same* reference across renders as long as their dependencies haven't changed, which matters specifically when that reference is consumed by something that itself compares by reference — a `React.memo`-wrapped child's props, or another hook's dependency array."

**11. Why is wrapping everything in `useMemo`/`useCallback` not automatically a good idea?**
"Because memoization isn't free — it costs memory to store the cached value and comparison work on every render to check the dependencies. If nothing downstream is actually consuming the stable reference — no memoized child, no dependency array relying on it — that cost buys nothing. I'd only reach for it when I can point at the specific thing it's protecting."

**12. What are the Rules of Hooks, and why do they exist?**
"Only call hooks at the top level of a component or custom hook, never inside a condition or loop, and only from React functions. They exist because React matches each hook call to its stored state purely by the *order* hooks are called in, across renders — not by name. If that order can change between renders (because a hook call is conditionally skipped sometimes), React's internal bookkeeping gets desynced and silently associates the wrong stored state with the wrong hook."

**13. When would you reach for `useReducer` instead of several `useState` calls?**
"When multiple pieces of state need to change together, consistently, in response to the same actions — separate `useState` calls make it easy to update one piece and forget another related one. A reducer co-locates every valid state transition in one place, so every call site just dispatches a clearly-named action instead of remembering the full combination of updates by hand."

**14. What's the most common mistake people make inside a reducer specifically?**
"Mutating state directly — pushing into an existing array, or setting a property on an existing object — and then returning that same, unchanged reference. It's the exact same immutability rule as `useState`, but it's easy to forget inside a reducer specifically, since a reducer function feels like a normal place to write imperative logic, and the bug's symptom (UI doesn't update, even though you can see the underlying data changed if you log it) can look confusing if you don't immediately recognize it as a referential-equality issue."

**15. What problem does the Context API solve, and when does it become a performance problem?**
"It solves prop drilling — passing a value through many layers of components that don't themselves use it, purely to relay it further down. It becomes a performance problem when a single, large, frequently-changing context causes every consumer to re-render on every change, even ones that only read an unrelated slice of that context's value — the fix is splitting one large context into several smaller, more narrowly-scoped ones."

**16. How would you avoid prop drilling without pulling in Redux?**
"`useReducer` combined with Context — the reducer owns the state and its transitions, and a Provider makes both the current state and `dispatch` available to any descendant via `useContext`, at any depth, without threading props through every intermediate layer."

**17. Why does array index as a `key` cause bugs, specifically?**
"React uses `key` to match elements between renders during reconciliation. Index-as-key means React matches 'whatever's now at this position' rather than 'the same logical item as before' — the moment the list reorders, or an item is removed from the middle, React can reuse the wrong DOM node for the wrong item, which is especially visible with input fields, where a typed value can appear to 'jump' to a different item after a reorder or removal."

**18. Walk me through what happens, step by step, when a user clicks a button that calls `setState`.**
"React schedules a re-render rather than updating anything synchronously in place. If this is inside a React event handler, other `setState` calls in the same handler are batched together into a single re-render. React then calls the component function again during the render phase, computes the new JSX, diffs it against the previous output, and only then, in the commit phase, actually applies the necessary DOM changes — which is also why you can't reliably read updated DOM state on the very next line after calling `setState`."

**19. How would you debug a component that seems to be re-rendering far more often than expected?**
"I'd first check for unstable references being passed as props or used in dependency arrays — an inline object, array, or function literal recreated every render will look 'different' to a reference-based comparison even if it's logically unchanged. React DevTools' Profiler, if available, can directly show which components re-rendered and often why; without it, I'd add a log at the top of the suspect component and reason about which prop or state value is actually changing on each unwanted render."

**20. If you don't know how to solve a problem immediately, what do you do?**
"I say so, out loud, and narrate what I'd check first rather than going silent — whether this needs to be state or a ref, what exactly I'm synchronizing with if I reach for an effect, whether I'm about to mutate something instead of creating a new reference. A structured, narrated partial answer demonstrates the actual reasoning process being evaluated far better than either silence or a confident but unexplained guess."

### 10.2 Condensed One-Page Cheat Sheet

```
BEFORE CODING
  - Clarify: inputs? what triggers re-render? edge cases (empty/loading/error/rapid actions)?
  - Classify every value: STATE (drives UI) vs REF (persists, no re-render) vs DERIVED (compute during render)
  - Sketch the data flow in one sentence before touching the editor
  - Build order: JSX skeleton (dummy data) -> wire up state -> wire up effects/async LAST

RUNNING CHECKLIST WHILE CODING
  [ ] State, ref, or derived? (never store what you can compute during render)
  [ ] useEffect -- what EXTERNAL system am I syncing with? If none, don't use an effect.
  [ ] Dependency array -- does it include everything referenced inside, by hand-checking each line?
  [ ] Am I mutating (push/direct assignment) instead of creating a new reference?
  [ ] Are my keys stable + unique, not array index (unless append-only, never reordered/filtered)?
  [ ] Async: guarded against unmount / stale results (ignore flag or AbortController)?
  [ ] Am I memoizing (useMemo/useCallback) something nothing downstream actually consumes?

IF STUCK -- SAY IT OUT LOUD, DON'T GO SILENT
  "Let me think about what state this actually needs before writing JSX."
  "I'm not sure this needs an effect -- let me check if anything external is really involved."
  "This looks like a stale closure -- let me check the dependency array / consider a functional update or a ref."
  "I want to handle double-clicks / unmount-mid-fetch here before moving on."

TIME BUDGET (30-45 MIN ROUND)
  Clarify + plan: 3-5 min | Skeleton: 5 min | Core logic: 15-20 min | Edge cases/polish: 5-10 min
  Clean, narrated, partial progress beats a silent, rushed, fully "finished" solution.

ALWAYS MENTION, EVEN UNPROMPTED
  Empty state, loading state, error state, rapid/duplicate actions, unmount mid-async,
  large-list performance, keyboard reachability / focus trapping in modals.
```

### 10.3 If You Get Stuck — The Reasoning Script

When a problem feels genuinely unfamiliar and no clear plan is forming, work through this exact sequence out loud, in order, rather than sitting in silence waiting for the "right" answer to appear:

1. *"Let me restate the problem in my own words to make sure I understand what's being asked."*
2. *"What's the minimal state this needs — not the full solution yet, just: what changes, and what triggers a re-render?"*
3. *"Is there anything external I actually need to synchronize with — a timer, a network call, a browser API — or can everything here be computed during render?"*
4. *"Let me sketch the absolute simplest version first, even if it's missing edge cases, and get something on screen before refining it."*
5. *"Now let me walk through what happens on a rapid double-action, or if this unmounts mid-operation, and see if my current approach already handles it or needs adjusting."*

This sequence *is* the Part 0 methodology, condensed into a recovery script — the goal isn't to have a different technique for "when stuck" versus "when confident"; it's to fall back on the exact same structured process regardless of how the problem initially feels, because the process itself is what produces a plan, not confidence arriving first.
