# React Interview Theory
*Every core React & Redux concept, explained the way you'd actually say it out loud — not a textbook*

This is a rewrite of the full React theory reference, restructured specifically so you can **read it once, understand it immediately, and repeat it in an interview in your own words**. Every topic uses the same lightweight format:

- **In plain terms** — the actual definition, no jargon pileup, no circular restating of the name.
- **How I'd say it in an interview** — a real, spoken-style answer, written in first person, exactly the way you'd say it out loud.
- **Quick example** — just enough code to make it click, using one running app throughout.
- **Watch out for** — the one mistake or gotcha that actually trips people up.

---

## The Running Example

Every example below refers back to this same small app: a `<Dashboard>` with a Redux-backed task list.

```
<Dashboard>                    - holds local state: which modal is open, sidebar collapsed?
 |- <Sidebar>                  - nav; gets "collapsed" as a prop
 |- <TaskList>                 - reads tasks from Redux (useSelector), renders <TaskItem>s
 |   `- <TaskItem>              - one row; has its OWN local "isEditing" state
 `- <Modal>                    - portal-rendered; open only when a modal is active
     `- <TaskForm>              - controlled form, used for both creating and editing a task
```

Redux slice, `tasksSlice`, built with Redux Toolkit — holds `items: []`, with `addTask`, `editTask`, `deleteTask`, `toggleComplete` reducers.

---

## PART A: HOW REACT ACTUALLY WORKS UNDER THE HOOD

### A1. What React Actually Is

**In plain terms:** React is split into two pieces that do completely different jobs. **React itself** figures out *what changed* — it runs your component functions and compares the result to what was there before. **A renderer** (react-dom for the browser, react-native for mobile) takes that "what changed" answer and actually *does* something about it — updates a real DOM node, or a real native view. React never touches the screen directly; it just decides what needs to happen.

**How I'd say it in an interview:**
> "React's core job is figuring out what the UI *should* look like given the current state, and diffing that against what's already there — it doesn't know or care whether it's talking to a browser DOM or a native mobile view. That's the renderer's job. React-dom is the piece that actually knows how to create a `<div>` or update an attribute. That separation is why the same component logic can run in a browser, on mobile, or even inside a canvas — only the renderer changes."

**Quick example:** Calling `setSidebarCollapsed(true)` in `<Dashboard>` doesn't touch the DOM at all by itself — it just tells React "re-run this component function." React gets new JSX back, compares it to the old JSX, and *only then* tells react-dom "go change this one class attribute."

**Watch out for:** Assuming "component re-rendered" means "the DOM changed." It usually doesn't — most re-renders end up changing nothing on screen at all.

---

### A2. Elements, Components, Fibers, and DOM Nodes — Four Different Things

**In plain terms:** People say "component" to mean four genuinely different things, and mixing them up is where most confusion comes from.
- A **component** is just the function you wrote — a recipe, not a running thing.
- An **element** is the plain JS object `{ type, props }` that JSX compiles into every time that function runs. Cheap, thrown away every render.
- A **fiber** is React's own internal record for one specific on-screen instance — this is where its actual state lives, and it *survives* across re-renders.
- A **DOM node** is the real thing the browser shows you.

**How I'd say it in an interview:**
> "When people say 'component,' they usually conflate the function definition with the actual running instance. The function is just a recipe — every time it runs, it produces a brand-new element object, which is cheap and thrown away immediately. What actually persists across renders is the fiber — that's where React stores this specific instance's state. So if `<TaskItem>` re-renders because I toggled its edit mode, a new element object gets created every time, but it's the *same* fiber underneath holding onto `isEditing`, and the *same* DOM node getting updated — nothing is torn down and rebuilt just because the function ran again."

**Quick example:** Click "edit" on a `<TaskItem>` twice: two new element objects get created (thrown away instantly), but it's the exact same fiber and exact same `<li>` DOM node the whole time — that's why the state (and your typed draft text) sticks around.

**Watch out for:** If `<TaskItem>` ever stops being rendered for even one render (say, a filter hides it) and comes back later, it's a brand-new fiber — its state resets to the initial value, even though visually it looks like "the same row" to a user.

---

### A3. The Virtual DOM

**In plain terms:** The "Virtual DOM" is just the informal name for the tree of plain JS element objects React builds on each render — before anything is compared to the real page at all.

**How I'd say it in an interview:**
> "I'd actually push back a little on 'Virtual DOM makes React fast' — a perfectly hand-written direct DOM update is always faster than React diffing and patching. The real value isn't raw speed, it's that creating plain JS objects is *cheap* compared to touching the real DOM, so React can afford to figure out the minimal set of real changes needed instead of me hand-writing that logic for every possible state change myself. It also enables batching — multiple state changes across different components can get resolved into one minimal set of DOM writes instead of one DOM write per change."

**Quick example:** Toggling the sidebar re-runs every component function in the tree, technically — but the diff finds that `<TaskList>`'s output didn't actually change at all, so none of its DOM ever gets touched.

**Watch out for:** Believing Virtual DOM is a performance trick in isolation. It's really a trade: cheap comparison work now, to avoid expensive DOM work later — and that comparison itself isn't free either.

---

### A4. Fiber Architecture

**In plain terms:** A Fiber is a plain JS object — one per component instance — holding its type, its current props/state, a pointer to its actual DOM node, and pointers to its child/sibling/parent fibers. That's it: a linked-list-shaped tree, sitting in memory, that React can walk a little bit at a time.

**How I'd say it in an interview:**
> "Before React 16, reconciliation was just plain recursive function calls mirroring your component tree — which meant once it started, it had to run to completion, because you can't pause a native call stack partway through. Fiber replaced that with an explicit data structure sitting in memory instead of the call stack — so React can literally stop walking the tree, go handle something more urgent like a keystroke, and come back later and pick up exactly where it left off. React also keeps two of these trees at once — the one currently on screen, and a work-in-progress one being built for the next update — and only swaps them in one atomic step, so you never see a half-updated screen."

**Quick example:** If React is midway through a big re-render of `<TaskList>` and the user types into `<TaskForm>`, React can pause the list work, handle the keystroke first, then resume the list — instead of the keystroke being stuck waiting behind the whole list update.

**Watch out for:** Thinking "Fiber" is just a rebrand of the diffing algorithm. It's specifically the data structure that makes *pausing and resuming* rendering possible — the diffing rules themselves are a separate topic (A6).

---

### A5. Render Phase vs. Commit Phase

**In plain terms:** Rendering happens in two phases. **Render** is where your component functions run and React figures out what should change — this can be paused, and must never have side effects. **Commit** is where React actually writes to the DOM — this always runs start-to-finish with no pausing, because a half-updated screen would look broken.

**How I'd say it in an interview:**
> "This is exactly why you can't read updated DOM state right after calling a setter. `setIsEditing(true)` just *schedules* a re-render — it doesn't run render and commit synchronously on that line. So if the very next line tries to read something off the DOM, it's still reading the old, pre-update DOM, because render hasn't even started yet, let alone commit. If I actually need the new DOM state, I have to read it inside a `useEffect` — that's guaranteed to run after commit."

**Quick example:**
```js
setIsEditing(true);
console.log(inputRef.current?.offsetHeight); // stale — the input doesn't even exist in the DOM yet
```

**Watch out for:** Assuming state setters are synchronous. They schedule work; they don't do the work inline.

---

### A6. Reconciliation — How React Decides What to Reuse

**In plain terms:** When React compares old vs. new output at one spot in the tree: same type → reuse the existing instance, just update its props. Different type → throw the whole thing away and mount a fresh one. For a *list* of children, React uses each item's `key` to match old items to new ones — not their position in the array.

**How I'd say it in an interview:**
> "Keys exist because React needs *some* way to know 'is this the same logical item as before, just moved,' versus 'this is a genuinely new item.' If you use the array index as the key, React can't actually tell those two apart — it just matches by position. So if I have a list where one row is mid-edit and I reorder the list, using index as key means React reuses whatever fiber happens to sit at that same index now — which means the in-progress edit state gets attached to the wrong row entirely. Using a real, stable ID as the key fixes this because React can now correctly say 'this specific task moved, its state should move with it' instead of guessing based on position."

**Quick example:** Reorder `<TaskList>` while task `'2'` is being edited. With `key={index}`, the edit box visually "jumps" to a different task. With `key={task.id}`, it correctly follows task `'2'` wherever it moved.

**Watch out for (the specific edge case):** Same type, but a *different* key → React treats it as a totally different element and remounts it from scratch, discarding all its state — even though the type never changed. This is actually a useful trick: giving `<TaskForm key={editingTaskId}>` a key tied to which task is being edited forces a clean reset every time you switch tasks.

---

### A7. Lanes — How React Prioritizes Work

**In plain terms:** Not all updates are equally urgent. A lane is just a label React attaches to a piece of pending work saying how urgent it is — a keystroke gets an urgent lane, a background data refresh gets a low-priority lane. When multiple updates are pending, React can work on the urgent one first instead of strictly first-in-first-out.

**How I'd say it in an interview:**
> "Lanes are React's answer to 'what happens when I have a low-priority update in progress and the user does something urgent, like typing?' Older versions of React just processed things in order they were scheduled. With lanes, every update carries a priority, so a user-typed keystroke can jump ahead of a big list re-render that was already queued, get shown immediately, and the big re-render resumes right after. It's what makes `useTransition` possible — that hook is really just a way for me to say 'this specific state update isn't urgent, put it on a low-priority lane.'"

**Quick example:** Typing in a search box while `<TaskList>` filters 10,000 items — with `useTransition` wrapping the filter update, keystrokes stay instant because they're on a higher-priority lane than the filtering work.

**Watch out for:** Assuming "priority" means "runs first no matter what." Lanes affect *scheduling order under contention*, not correctness — low-priority work still always eventually finishes and every update is still applied.

---

### A8. Concurrent Rendering and Time Slicing

**In plain terms:** Time slicing is React breaking up big render work into small chunks (roughly one per Fiber unit), checking after each chunk whether something more urgent showed up, and yielding back to the browser if so. "Concurrent rendering" is the general term for this ability to interrupt, prioritize, and even abandon in-progress render work.

**How I'd say it in an interview:**
> "Before concurrent rendering, a big render was one long synchronous block — the browser literally couldn't do anything else, including responding to a click, until it finished. Time slicing chops that work into small units, and after each unit React checks: is there anything more urgent waiting? If yes, it pauses the current work-in-progress tree, handles the urgent thing, and resumes later. It's important that this is opt-in in React 18 — it doesn't affect things wrapped in an urgent update, only things explicitly marked non-urgent through `startTransition` or similar."

**Quick example:** Filtering a huge `<TaskList>` can be interrupted mid-way if the user clicks the sidebar toggle — React finishes the sidebar click's render first, then goes back to finish the filtering.

**Watch out for:** Concurrent rendering can throw away render work that was in progress if a newer update supersedes it before commit — which is exactly why render-phase code must have zero side effects. If it did something like push to an array during render, an abandoned render would leave a corrupted side effect behind.

---

### A9. Automatic Batching

**In plain terms:** Batching means React groups multiple `setState` calls that happen close together into a single re-render instead of one re-render per call. "Automatic" batching (React 18+) means this happens everywhere — inside promises, timeouts, and native event handlers — not just inside React's own event handlers like it used to.

**How I'd say it in an interview:**
> "Before React 18, if I called two setters inside a `setTimeout` callback, I'd get two separate re-renders — batching only worked inside React's own synthetic event handlers. That was a really easy trap: code that looked identical would batch inside an `onClick` but not inside a `fetch().then()`. React 18 made batching automatic everywhere, so now calling multiple setters together — regardless of where the call happens — always collapses into one re-render. If I truly need to force a synchronous, unbatched update, that's what `flushSync` is for, though it's rare that I'd actually need it."

**Quick example:**
```js
async function handleSave() {
  setIsSaving(true);
  await api.saveTask(task);
  setIsSaving(false);
  setLastSaved(Date.now());   // React 18: batches with the line above into ONE re-render
}
```

**Watch out for:** Code written assuming pre-18 behavior (manually splitting updates to force separate renders) silently stops working that way after an upgrade — it just quietly batches now instead of erroring.

---

### A10. Effects — `useEffect` Timing and Cleanup

**In plain terms:** An effect is code that runs *after* the DOM has been updated, meant for anything that reaches outside of React — network calls, subscriptions, manually touching a DOM node. Its cleanup function runs right before the *next* effect run, and once more on unmount — that's how it prevents subscribing twice or leaking a listener.

**How I'd say it in an interview:**
> "The reason effects run after the DOM update, not during render, is that render is supposed to be a pure calculation of 'what should this look like' — pushing a network request in there would mean an abandoned or repeated render (which concurrent rendering does deliberately) could fire that request multiple times unpredictably. Effects also don't just run once — they re-run whenever anything in their dependency array changes, and *before* they re-run, React always calls the cleanup function from the previous run. That's the mechanism that makes something like a WebSocket subscription safe: subscribe in the effect, unsubscribe in cleanup, and switching from watching task A to task B cleanly unsubscribes from A before subscribing to B — instead of silently accumulating listeners."

**Quick example:**
```js
useEffect(() => {
  const sub = subscribeToTask(taskId, handleUpdate);
  return () => sub.unsubscribe();   // runs before next effect AND on unmount
}, [taskId]);
```

**Watch out for (the mandatory edge case — Strict Mode double-invoke):** In development, Strict Mode deliberately runs mount → cleanup → mount again for every effect, specifically to surface effects that aren't safely repeatable. If an effect breaks under that double-run, it was never actually safe — Strict Mode just made the bug visible instead of letting it hide until production.

---

### A11. Context — How Values Propagate Without Prop Drilling

**In plain terms:** Context lets a value be read directly by any descendant component, no matter how deep, without it being passed down as a prop at every level. A `Provider` sets the value for the whole subtree beneath it; any component in that subtree calling `useContext` reads the nearest Provider's value.

**How I'd say it in an interview:**
> "Context solves prop drilling, but it comes with a real cost that's easy to miss: when a Provider's value changes, *every* component that consumes that context re-renders — regardless of whether the specific piece of data that component cares about actually changed. If I stuff a big object with lots of unrelated fields into one context, updating any one field re-renders every single consumer of that whole context. That's why for anything that changes often, I'd either split it into several smaller, more focused contexts, or reach for a proper state manager with selector-based subscriptions instead of one giant context."

**Quick example:** A `ThemeContext` holding `{ theme, toggleTheme }` — every component reading `useContext(ThemeContext)` re-renders on every toggle, even ones that only display the theme name and never call `toggleTheme`.

**Watch out for:** Context is not a replacement for a state manager, and it's not itself "global state management" — it's a propagation mechanism. It doesn't do anything to prevent unrelated re-renders like a selector-based store does.

---

### A12. Portals

**In plain terms:** A portal renders a component's output into a *different* DOM node than the one its parent lives in, while it still stays logically part of the same React tree for everything else — props, context, event bubbling.

**How I'd say it in an interview:**
> "Portals exist because of CSS stacking and overflow — a modal nested deep inside a scrollable, `overflow: hidden` container can visually get clipped or trapped behind other elements no matter what z-index I throw at it, because it's still a descendant of that container in the DOM. A portal renders that modal's actual DOM node somewhere else entirely — usually directly under `<body>` — so none of the parent's CSS constraints apply. But logically, in React's tree, it's still a child of wherever I rendered it: it still gets context from the same providers, and a click inside it still bubbles up through the same React event handlers as if it were nested normally, because React's event system follows the React tree, not the actual DOM tree."

**Quick example:**
```jsx
function Modal({ children }) {
  return ReactDOM.createPortal(children, document.getElementById('modal-root'));
}
```
`<Modal>` is rendered inside `<Dashboard>` in the JSX, but its DOM ends up under a totally separate `#modal-root` div next to `<body>`.

**Watch out for (the mandatory edge case):** A click inside the portal's content still triggers an `onClick` handler on a logical *React* ancestor (like `<Dashboard>`) via bubbling — even though in the actual DOM, the portal's node isn't nested inside that ancestor at all. This trips people up when they add a "click outside to close" handler using real DOM position checks instead of React's event system.

---

### A13. Hydration

**In plain terms:** Hydration is what happens when React is handed HTML that was already rendered somewhere else (usually the server) and needs to "attach" to it — walking the existing DOM, comparing it to what client-side render would produce, and wiring up event listeners and internal state, ideally without throwing any of that existing DOM away.

**How I'd say it in an interview:**
> "The whole point of hydration is to avoid a flash where the server-rendered page gets thrown away and rebuilt from scratch on the client. Instead, React walks the DOM it was handed, and as long as what it *would have* rendered on the client matches what's already there, it just reuses those existing DOM nodes and attaches event listeners to them — the visible content never disappears. The catch is that this only works if server and client output actually match. If they don't — say, because I used `Date.now()` or read `window` directly during render — React logs a hydration mismatch warning and falls back to throwing away the mismatched part and re-rendering it client-side, which is exactly the flash we were trying to avoid."

**Quick example:** `<Dashboard>` rendered server-side shows the correct task count immediately; hydration then attaches the click handlers to the existing buttons instead of re-rendering the whole page and briefly showing an unresponsive UI.

**Watch out for:** Any render-time output that legitimately differs between server and client — timestamps, random IDs, `typeof window !== 'undefined'` checks — causes hydration mismatches. The fix is to make that value stable at first render (e.g., render a placeholder, then set the real value inside a `useEffect`, which only runs client-side after hydration completes).

---


## PART B: THE HOOKS, ONE BY ONE

### B1. useState

**In plain terms:** `useState` gives a component a piece of memory that survives across re-renders, plus a function to update it. Calling the setter doesn't mutate anything in place — it tells React "here's the new value, schedule a re-render with it."

**How I'd say it in an interview:**
> "The thing that trips people up first is that the setter doesn't update the variable immediately — `count` inside the current render is a constant, captured at the top of that function call, and it stays that value for the rest of that render no matter how many times I call `setCount`. The second thing is the functional-update form: `setCount(c => c + 1)` versus `setCount(count + 1)`. If I call the setter multiple times in a row using the plain value form, every call is still referencing the same stale `count` from this render, so they don't stack — I need the functional form to guarantee each update builds on the true latest value, especially under batching."

**Full syntax:**
```js
const [state, setState] = useState(initialValue);
// initialValue can also be a function — called ONCE, on mount only, useful when
// computing the initial value is expensive:
const [tasks, setTasks] = useState(() => loadTasksFromStorage());
```

**Quick example:**
```js
setCount(count + 1);
setCount(count + 1); // still using the stale `count` — ends up +1, not +2

setCount(c => c + 1);
setCount(c => c + 1); // correctly ends up +2
```

**Watch out for:** Calling the setter with the same value it already holds (by `Object.is` comparison) does *not* trigger a re-render — React bails out early. This matters for objects/arrays: replacing an array with a new array containing identical items still re-renders, because it's a new reference, even though nothing "changed" semantically.

---

### B2. useEffect

**In plain terms:** `useEffect` schedules a function to run after the browser has painted the update, for anything that needs to reach outside the component — fetching data, subscribing to something, manually reading/writing a DOM node. Its second argument, the dependency array, controls how often it re-runs: omitted → every render, `[]` → mount/unmount only, `[a, b]` → re-runs whenever `a` or `b` changes.

**How I'd say it in an interview:**
> "The rule I actually follow is: if a value from the component's scope is used inside the effect, it belongs in the dependency array — full stop, no picking and choosing. The temptation to leave something out usually comes from wanting the effect to *not* re-run on every render, but the right fix for that is almost never lying to the dependency array — it's restructuring the effect, or moving the changing piece into a ref if it genuinely shouldn't trigger a re-run. An effect isn't for computing derived data during render, either — if I can compute a value directly from props/state while rendering, I should just do that, not stash it in state and sync it with an effect."

**Quick example:**
```js
useEffect(() => {
  document.title = `${incompleteCount} tasks left`;
}, [incompleteCount]); // re-runs only when incompleteCount actually changes
```

**Watch out for:** Fetching data directly in an effect with no cancellation. If `taskId` changes quickly (user clicks between tasks fast), an older, slower request can resolve *after* a newer one and overwrite it with stale data. Fix: track a flag or use `AbortController` in the cleanup function to ignore/cancel outdated requests.

---

### B3. useLayoutEffect

**In plain terms:** Same signature as `useEffect`, but it runs synchronously right after the DOM is updated and *before* the browser paints anything on screen — versus `useEffect`, which runs after the paint.

**How I'd say it in an interview:**
> "The only reason to reach for `useLayoutEffect` over `useEffect` is when I need to measure or adjust the DOM in a way that the user would otherwise briefly see flicker — for example, measuring an element's height and immediately repositioning something based on it. If I did that in a regular `useEffect`, the browser might paint the pre-adjustment layout first, then flash to the corrected one a frame later. `useLayoutEffect` blocks the paint until it's done, so the user only ever sees the final, correct layout — the tradeoff is that it's blocking, so heavy work in there can visibly delay the paint."

**Quick example:** Positioning `<Modal>` so it never overflows the viewport — measuring its rendered height in `useLayoutEffect` and adjusting its `top` offset before the browser ever shows it in the wrong spot.

**Watch out for:** Reaching for `useLayoutEffect` by default "just in case." It blocks painting, so using it where a normal `useEffect` would've been invisible to the user just adds unnecessary jank for no benefit.

---

### B4. useRef

**In plain terms:** `useRef` gives you a mutable box — `{ current: value }` — that survives across re-renders but, unlike state, changing it never triggers a re-render and reading it never triggers the "used during render, must be a dependency" implications that state has.

**How I'd say it in an interview:**
> "I think about `useRef` as having two completely separate uses that happen to share one hook. One is holding a reference to an actual DOM node — `<input ref={inputRef} />` — so I can imperatively call `.focus()` on it. The other is holding *any* mutable value across renders that I specifically don't want to cause a re-render when it changes — like a timer ID, a previous-value snapshot, or a flag for 'has this effect already run.' The key mental model is: reading or writing `.current` never schedules a re-render and never gets picked up by React's own tracking, so it's the escape hatch when I genuinely want something to be mutable but invisible to the render cycle."

**Full syntax:**
```js
const ref = useRef(initialValue);   // ref.current starts as initialValue, mutate directly: ref.current = x
const inputRef = useRef(null);      // typical DOM-node pattern
<input ref={inputRef} />
```

**Quick example:** Storing the previous task count to detect "did a task just get completed" without causing an extra render just to track that comparison.

**Watch out for:** Reading or writing `ref.current` *during render* (not inside an effect or event handler) is unsafe — because render can be paused, abandoned, or re-run under concurrent rendering, and a ref mutation during render is exactly the kind of stray side effect that corrupts an abandoned render.

---

### B5. useMemo

**In plain terms:** `useMemo` caches the *result* of an expensive calculation between renders, only re-running the calculation when one of its listed dependencies actually changes — otherwise it just hands back the previous result.

**How I'd say it in an interview:**
> "`useMemo` is specifically a performance tool, not a correctness tool — a component that never used `useMemo` at all would still behave correctly, just possibly slower. I only reach for it in two situations: the calculation is genuinely expensive — sorting or filtering a big list, say — and it would otherwise re-run on every render including ones unrelated to that data; or I need referential stability, meaning the *same object reference* across renders, because I'm passing that value into something like a dependency array or into a memoized child that does an identity check on its props."

**Full syntax:**
```js
const sortedTasks = useMemo(() => {
  return [...tasks].sort((a, b) => a.dueDate - b.dueDate);
}, [tasks]); // only re-sorts when `tasks` reference changes
```

**Quick example:** Sorting a 5,000-item task list only when `tasks` or the sort order actually changes, instead of re-sorting on every keystroke in an unrelated search box in the same component.

**Watch out for:** Wrapping cheap calculations in `useMemo` "for performance" — the memoization bookkeeping itself (comparing dependencies, storing the cached result) has a real cost, and for a trivial calculation that cost can exceed just recalculating it plainly every time.

---

### B6. useCallback

**In plain terms:** `useCallback` is `useMemo`, specifically for function values — it returns the *same function reference* across renders as long as its dependencies haven't changed, instead of creating a brand-new function every render.

**How I'd say it in an interview:**
> "On its own, `useCallback` doesn't actually save any work — creating a new function on every render is cheap. It only matters when that function is being passed as a prop into a child wrapped in `React.memo`, or used inside another hook's dependency array. Without `useCallback`, a new function reference gets created every render, which means a memoized child sees 'a new prop' every time by reference — even though the function does exactly the same thing — and re-renders anyway, silently defeating the whole point of memoizing that child."

**Full syntax:**
```js
const handleToggle = useCallback((taskId) => {
  dispatch(toggleComplete(taskId));
}, [dispatch]); // dispatch from Redux is stable, so this reference never changes
```

**Quick example:** Passing `onToggle={handleToggle}` into a `React.memo`-wrapped `<TaskItem>` — without `useCallback`, every parent re-render hands `<TaskItem>` a "new" function prop, defeating its memoization.

**Watch out for:** Using `useCallback` without also memoizing the component receiving that function. If the child isn't wrapped in `React.memo`, it re-renders on every parent render regardless of whether the function prop reference is stable — so `useCallback` alone accomplishes nothing there.

---

### B7. useReducer

**In plain terms:** `useReducer` is an alternative to `useState` for when state updates follow real logic rather than "just set a new value" — you dispatch a plain object describing *what happened*, and a pure function (the reducer) decides how state should change in response.

**How I'd say it in an interview:**
> "I reach for `useReducer` over multiple `useState` calls when the state updates are related to each other and I keep finding myself updating several state variables together in response to the same event — that's usually a sign they're really one piece of state with several fields, and the transitions between them are actual business logic worth naming, like `'complete'`, `'delete'`, `'edit'`. Centralizing that in a reducer means the update logic lives in one pure, testable function instead of being scattered across every event handler that happens to touch that state — and this is the exact same mental model Redux itself is built on, just scoped to one component instead of the whole app."

**Full syntax:**
```js
function tasksReducer(state, action) {
  switch (action.type) {
    case 'added': return [...state, action.task];
    case 'toggled': return state.map(t => t.id === action.id ? {...t, done: !t.done} : t);
    default: return state;
  }
}
const [tasks, dispatch] = useReducer(tasksReducer, initialTasks);
dispatch({ type: 'toggled', id: 3 });
```

**Quick example:** `<TaskList>` managing add/edit/delete/toggle all through one `dispatch`, instead of four separate `useState` setters each needing to know how to correctly update the array.

**Watch out for:** The reducer function must stay pure — no API calls, no mutating the existing state array/object in place, always return a new one. A reducer that mutates in place can silently break because React compares old vs. new state by reference to decide whether to re-render.

---

### B8. useContext

**In plain terms:** `useContext(SomeContext)` reads the current value provided by the nearest matching `<SomeContext.Provider>` above it in the tree — no matter how many component layers are in between.

**How I'd say it in an interview:**
> "The hook itself is simple — it just subscribes this component to whatever value the nearest Provider above it is holding, and re-renders it whenever that value changes. The subtlety is entirely on the Provider side, not the hook: if the value passed to the Provider is a fresh object literal created on every render of the Provider's parent, every consumer re-renders every time too, even if the fields they actually read never changed. So the real skill isn't calling `useContext` — it's making sure the Provider's value is stable (memoized) so consumers only re-render when something meaningful actually changed."

**Quick example:** `const { theme, toggleTheme } = useContext(ThemeContext);` inside `<Sidebar>` — no props threaded through `<Dashboard>` at all.

**Watch out for:** Calling `useContext` outside of any matching Provider silently returns the `defaultValue` given to `createContext(defaultValue)` rather than throwing — which can hide a "forgot to wrap this in a Provider" bug behind seemingly-working fallback data.

---

### B9. useTransition

**In plain terms:** `useTransition` marks a specific state update as "not urgent" — React will still render it, but it's allowed to be interrupted by anything more urgent (like a keystroke), and a `isPending` flag tells you it's still in flight.

**How I'd say it in an interview:**
> "This hook is really the direct, ergonomic entry point into lanes and concurrent rendering I mentioned earlier. Say a user types in a filter box that re-renders a huge list on every keystroke — without a transition, that big re-render blocks the input from feeling responsive, because it's all one urgent update. Wrapping the list-filtering `setState` call in `startTransition` tells React 'this one can wait its turn' — so React keeps the input itself snappy on the urgent lane, and finishes the heavy list re-render on a lower-priority lane right after, showing `isPending` in the meantime so I can render a subtle loading indicator."

**Full syntax:**
```js
const [isPending, startTransition] = useTransition();
function handleFilterChange(value) {
  setFilterText(value);           // urgent: keeps the input responsive
  startTransition(() => {
    setFilteredTasks(filterTasks(tasks, value)); // non-urgent: can be interrupted
  });
}
```

**Watch out for:** `startTransition` doesn't make the update itself faster — the big list render still takes just as long. It only changes scheduling priority so *other, more urgent* updates aren't stuck waiting behind it.

---

### B10. useDeferredValue

**In plain terms:** `useDeferredValue(value)` gives you a version of `value` that "lags behind" the real one under load — React tries to keep it in sync immediately, but allows it to fall behind temporarily when there's more urgent work to do.

**How I'd say it in an interview:**
> "Where `useTransition` marks a *state update* as low priority, `useDeferredValue` marks a *value* as okay-to-be-stale, which is useful when I don't control where the value is being set — like a prop coming from a parent — so wrapping the setter in `startTransition` isn't an option. I use the deferred value for the expensive part of the render, like the actual list of filtered results, while the input itself keeps rendering the real, up-to-the-keystroke text — so typing always feels instant, and the expensive list visually catches up a beat behind."

**Quick example:**
```js
const deferredFilter = useDeferredValue(filterText);
const filtered = useMemo(() => filterTasks(tasks, deferredFilter), [tasks, deferredFilter]);
// input shows `filterText` (instant); the heavy filtered list uses `deferredFilter` (can lag)
```

**Watch out for:** Confusing this with debouncing. Debouncing is a fixed time delay regardless of system load; `useDeferredValue` has no fixed delay at all — it only lags when there's actually competing urgent work, and matches immediately otherwise.

---

### B11. useSyncExternalStore

**In plain terms:** A hook for safely subscribing a component to any state that lives *outside* React (a browser API, a custom store, a third-party library) — it guarantees the value read stays consistent even under concurrent rendering's tearing risk.

**How I'd say it in an interview:**
> "This one exists to solve a subtle bug that concurrent rendering introduced. If a component reads external state directly (say, `window.innerWidth`) during render, and that value changes *while* React is in the middle of a paused, concurrent render pass, different parts of the tree could end up reading different values of the same external source in the same commit — visually inconsistent, called 'tearing.' `useSyncExternalStore` forces the external source to be read through a subscribe/getSnapshot contract that React can coordinate against its own rendering, guaranteeing every consumer sees the same consistent snapshot within one commit. In practice, I don't usually write raw calls to this myself — it's what libraries like Redux's `useSelector` or Zustand are built on internally."

**Quick example:** `useSyncExternalStore(store.subscribe, store.getSnapshot)` is literally the mechanism `react-redux`'s `useSelector` uses under the hood to read Redux state safely.

**Watch out for:** Assuming this hook is something app code reaches for often. It's a low-level primitive mainly meant for library authors — most app code should use the higher-level API (`useSelector`, a Zustand hook, etc.) built on top of it.

---

### B12. useImperativeHandle + forwardRef

**In plain terms:** `forwardRef` lets a parent attach a `ref` to a child *function* component (which normally can't receive a `ref` as a prop at all). `useImperativeHandle` then lets that child control exactly what the parent's ref actually exposes — instead of exposing the raw underlying DOM node.

**How I'd say it in an interview:**
> "By default, function components can't receive a `ref` — refs only attach to actual DOM elements or class components — so `forwardRef` exists purely to pass a ref *through* a function component down to something inside it. On its own that would just expose the raw inner DOM node to the parent, which is often more than I want to expose. `useImperativeHandle` lets me define a custom, deliberately limited object instead — like only a `focus()` method — so the parent gets a clean imperative API without reaching into implementation details it shouldn't touch."

**Quick example:**
```js
const TaskForm = forwardRef((props, ref) => {
  const inputRef = useRef(null);
  useImperativeHandle(ref, () => ({
    focusFirstField: () => inputRef.current.focus(),
  }));
  return <input ref={inputRef} />;
});
// parent: formRef.current.focusFirstField()  — not formRef.current.querySelector(...)
```

**Watch out for:** Reaching for this as a first instinct for parent-child communication. It's an escape hatch for genuinely imperative needs (focus, scroll, play/pause) — for anything expressible as data, passing props down and calling functions up is still the default, more React-idiomatic approach.

---

### B13. useId

**In plain terms:** `useId` generates a unique, stable string ID for accessibility attributes (like linking a `<label>` to an `<input>`) that's guaranteed to match between server-rendered HTML and the client's hydration pass.

**How I'd say it in an interview:**
> "The reason this hook exists at all, instead of just using a running counter or `Math.random()`, is hydration. If a component generates its own ID using a module-level counter, that counter's value depends on render order and can easily end up different between the server render and the client's first render — causing a hydration mismatch. `useId` is specifically coordinated by React so the same component in the same position in the tree gets the exact same ID on both server and client, without me having to think about it."

**Quick example:**
```js
const id = useId();
<label htmlFor={id}>Task name</label>
<input id={id} />
```

**Watch out for:** Using `useId` to key a list, or as a value with actual business meaning. It's explicitly documented as being for accessibility attribute wiring only — it's not guaranteed to be meaningful or stable in the ways a real data ID would be.

---

### B14. Custom Hooks

**In plain terms:** A custom hook is just a regular function, named starting with `use`, that calls other hooks inside it — a way to extract and reuse *stateful logic* between components, as opposed to reusing markup (which is what a regular component does).

**How I'd say it in an interview:**
> "The important distinction is that a custom hook doesn't share *state* between the components that use it — it shares the *logic* for managing that state. Two components each calling `useTaskFilter()` get two completely independent copies of whatever state and effects live inside it, the same way two components rendering the same JSX component get independent instances. What it does let me do is take a chunk of related `useState`/`useEffect`/`useMemo` logic that's duplicated or awkward to read inline, and give it one clear name and a clean return interface, without changing anything about how React itself treats that logic."

**Quick example:**
```js
function useTaskFilter(tasks) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => tasks.filter(t => t.title.includes(query)), [tasks, query]);
  return { query, setQuery, filtered };
}
// <TaskList> and any other component can both call useTaskFilter(tasks) independently
```

**Watch out for:** The Rules of Hooks still fully apply inside a custom hook — no calling it conditionally, no calling it inside a loop. Because it's "just a function" under the hood, it's tempting to treat it like a normal utility function and break those rules, which silently corrupts hook state ordering.

---

### B15. React.memo

**In plain terms:** `React.memo(Component)` wraps a component so that, before re-rendering it, React first does a shallow comparison of its new props against its previous props — and skips re-rendering entirely if none of them changed.

**How I'd say it in an interview:**
> "`React.memo` only helps when a component's parent re-renders often for reasons unrelated to that specific child's props, and re-rendering that child is actually expensive enough to matter. The comparison it does is shallow — it checks whether each prop is `===` to its previous value, not a deep equality check — which is exactly why it silently fails to help if you're passing inline objects, arrays, or functions as props, because a brand-new object literal is never `===` to the previous one even if its contents are identical. That's the direct link to `useMemo`/`useCallback` — they exist largely to give `React.memo` something stable to actually compare against."

**Quick example:**
```js
const TaskItem = React.memo(function TaskItem({ task, onToggle }) { ... });
// only skips re-rendering if `task` AND `onToggle` are both the same reference as last time
```

**Watch out for:** Wrapping every component in `React.memo` reflexively. The shallow-comparison check itself has a cost on every render; for a cheap component that re-renders rarely anyway, that comparison overhead can outweigh any savings.

---

### B16. Suspense

**In plain terms:** `<Suspense fallback={...}>` lets a component "pause" rendering by throwing a promise, and shows the `fallback` UI until that promise resolves — instead of the component needing to manually track its own `isLoading` state.

**How I'd say it in an interview:**
> "The mental shift with Suspense is that loading states become a structural, declarative thing handled by a boundary in the tree, rather than manual `if (isLoading) return <Spinner />` logic duplicated inside every component that fetches data. A data-fetching mechanism that's 'Suspense-enabled' throws a promise when data isn't ready yet; the nearest `<Suspense>` boundary above it catches that, shows its fallback, and automatically re-renders the real content once the promise resolves. It composes naturally too — nested Suspense boundaries let different parts of a page show their own loading state independently instead of one all-or-nothing spinner for the whole page."

**Quick example:**
```jsx
<Suspense fallback={<TaskListSkeleton />}>
  <TaskList /> {/* internally uses a Suspense-enabled data source */}
</Suspense>
```

**Watch out for:** Assuming any async code "just works" with Suspense automatically. Plain `fetch` inside a `useEffect` doesn't integrate with Suspense at all — it needs a Suspense-compatible data layer (React Query, Relay, or React's own `use` API) that actually throws the pending promise in the way Suspense expects.

---

### B17. Error Boundaries

**In plain terms:** A class component implementing `static getDerivedStateFromError` (and typically `componentDidCatch`) that catches JavaScript errors thrown anywhere in its child tree *during rendering*, and renders fallback UI instead of letting the error crash the whole app.

**How I'd say it in an interview:**
> "There's no hook-based equivalent for this — it has to be a class component, because the mechanism relies on class lifecycle methods that hooks don't have an equivalent for. It's also important to be precise about what it actually catches: rendering errors in its children, yes — but not errors inside event handlers, not errors in asynchronous code like a `setTimeout` or a rejected promise, and not errors during server-side rendering. Those need to be handled with a normal `try/catch` at the point they happen, because by the time they'd reach an error boundary, React's rendering process has already moved on."

**Quick example:**
```js
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <FallbackUI />;
    return this.props.children;
  }
}
// wraps <TaskList> — a bug in one TaskItem's render doesn't take down the whole Dashboard
```

**Watch out for (the specific edge case):** An error thrown inside a button's `onClick` handler does *not* get caught by a wrapping Error Boundary — it's not a rendering error. That needs its own `try/catch` right in the handler.

---

### B18. Strict Mode

**In plain terms:** `<StrictMode>` doesn't render anything itself — it's a development-only tool that intentionally runs certain things twice (component function bodies, and effect mount/cleanup/mount) purely to surface code that isn't actually safe to run more than once, before that bug reaches production.

**How I'd say it in an interview:**
> "Strict Mode is deliberately trying to break code that's silently relying on assumptions React doesn't actually guarantee — like a component body having side effects, or an effect not being safely repeatable. It only runs this double-invocation in development, and only calls each function pair back-to-back without anything visibly changing in between, so a well-behaved component or effect shows no difference at all. If double-invoking an effect actually breaks something — like a subscription firing twice with no corresponding cleanup — that was already a real bug; concurrent rendering could cause a component to genuinely be invoked more than once in production too (an abandoned, re-attempted render), so Strict Mode is just making an existing risk visible early instead of introducing a new one."

**Quick example:** An effect that subscribes to a WebSocket without a cleanup function that unsubscribes will visibly show two active subscriptions under Strict Mode in development — a real bug Strict Mode is designed to expose, not cause.

**Watch out for:** Assuming Strict Mode's double-invoke behavior is itself a bug in React, and disabling Strict Mode to "fix" the doubled console logs or effect runs — that hides the warning without fixing the underlying non-idempotent code, which can still misbehave in production under concurrent rendering.

---

## PART C: COMPONENT COMPOSITION PATTERNS

### C1. Why React Favors Composition Over Inheritance

**In plain terms:** Instead of building component variants by extending a base class (like traditional OOP inheritance), React components are built by combining smaller components together — passing components as props (often as `children`) to other components.

**How I'd say it in an interview:**
> "Inheritance creates a rigid, single hierarchy fixed at compile time — a `SpecialButton extends Button` is locked into being a kind of `Button` forever. Composition instead just passes components around as values — as `children`, or as regular props — so relationships between components can be assembled flexibly at the call site, and a component doesn't need to know in advance every possible variant it might need to support. `<Modal>` doesn't need a `TaskFormModal` subclass and a `ConfirmDeleteModal` subclass — it just renders whatever `children` it's given."

**Quick example:** `<Modal>` accepts any `children` — sometimes `<TaskForm>`, sometimes a delete-confirmation dialog — without `Modal` ever needing to know or import either of them.

**Watch out for:** Reaching for class inheritance between components as a first instinct out of habit from other languages — in React, that need almost always signals "this should be composition instead."

---

### C2. The `children` Prop

**In plain terms:** `children` is just a regular prop, automatically populated with whatever JSX is nested between a component's opening and closing tags — React passes it through no differently than any other prop.

**How I'd say it in an interview:**
> "There's nothing magical about `children` mechanically — it's exactly as if I'd written `<Modal children={<TaskForm />} />` by hand; JSX's nested-tag syntax is just sugar for that. What makes it powerful is that it lets a wrapper component stay completely agnostic about what's inside it. `<Modal>` handles the overlay, the portal, the close button — and has zero knowledge of, or dependency on, what's actually being shown inside it."

**Quick example:**
```jsx
<Modal onClose={closeModal}>
  <TaskForm task={editingTask} />
</Modal>
// Modal's own code: function Modal({ children, onClose }) { return <div className="overlay">{children}</div>; }
```

**Watch out for:** Assuming `children` is always a single element. It can be `undefined`, a string, an array of elements, or deeply nested fragments — code that assumes exactly one child element (like calling `.props` directly on it) breaks the moment a consumer passes multiple children or plain text.

---

### C3. Render Props

**In plain terms:** A component accepts a prop whose value is a *function*, and calls that function during its own render to produce the actual output — letting the consumer control what's rendered while the component itself controls the underlying behavior/state.

**How I'd say it in an interview:**
> "The render props pattern is really a way to share behavior — like tracking a mouse position, or exposing loading/error state — without dictating the exact markup that gets rendered from it. The component owns the logic and state; the caller owns the presentation, receiving whatever the component wants to expose as function arguments. In practice, custom hooks have replaced most of the reasons to reach for this pattern in modern React, since a hook can expose that same state/behavior without needing an extra wrapping component and the JSX nesting that comes with it — but it still shows up in some libraries, and it's worth recognizing."

**Quick example:**
```jsx
<TaskFetcher taskId={id}>
  {({ task, isLoading }) => isLoading ? <Spinner /> : <TaskDetail task={task} />}
</TaskFetcher>
// TaskFetcher owns the fetching logic; the caller decides exactly what to render with the result
```

**Watch out for:** Deep render-prop nesting ("render prop hell") when several are combined — this is exactly the readability problem custom hooks solve, since hook calls compose by just being additional lines instead of additional JSX nesting levels.

---

### C4. Higher-Order Components (HOCs)

**In plain terms:** A function that takes a component and returns a *new* component, wrapping the original with extra props or behavior — the classic shape is `withSomething(WrappedComponent) => EnhancedComponent`.

**How I'd say it in an interview:**
> "An HOC is a way to reuse cross-cutting logic — like injecting a piece of context as a prop, or gating rendering behind an auth check — across many components without duplicating that logic in each one. The tradeoffs are real, though: wrapping a component changes what shows up in the React DevTools tree and can obscure prop flow, since props get merged in by the HOC rather than declared explicitly where the component is used, and nesting several HOCs gets hard to trace ('wrapper hell'). Like render props, custom hooks have taken over most of the use cases this pattern used to be reached for, precisely because a hook doesn't introduce an extra layer in the component tree at all."

**Quick example:**
```js
function withAuth(WrappedComponent) {
  return function AuthenticatedComponent(props) {
    const user = useContext(AuthContext);
    if (!user) return <LoginPrompt />;
    return <WrappedComponent {...props} user={user} />;
  };
}
const ProtectedDashboard = withAuth(Dashboard);
```

**Watch out for:** Creating the wrapped component *inside* another component's render function — that produces a brand-new component type on every render, causing React to unmount and remount the whole subtree instead of just updating it. HOC definitions belong outside, at module scope.

---

### C5. Controlled vs. Uncontrolled Components

**In plain terms:** A controlled input's value lives in React state — every keystroke calls a handler that updates state, and the input's displayed value is whatever that state says. An uncontrolled input just manages its own value internally in the DOM, and React only reads it on demand (usually via a ref), not on every keystroke.

**How I'd say it in an interview:**
> "The real distinction is about *who owns the source of truth* for that value at any given instant. Controlled means React state is the single source of truth, and the DOM input is just a reflection of it — which is what makes things like 'disable submit until this field is valid' or 'format this as the user types' straightforward, since I see and can react to every keystroke. Uncontrolled means the DOM itself is the source of truth, and I only reach in and read the current value when I actually need it, like on form submit — which trades away that per-keystroke control for simpler code and, for very large forms, fewer re-renders."

**Quick example:**
```jsx
// controlled
<input value={title} onChange={e => setTitle(e.target.value)} />
// uncontrolled
<input ref={titleRef} defaultValue="" />
// later: titleRef.current.value
```

**Watch out for (the mandatory edge case):** Switching an input from controlled to uncontrolled (or back) across renders — e.g., a `value` prop that's `undefined` on the first render but a real string afterward — makes React log a warning and can cause the input to behave unpredictably. Always initialize controlled state to `''`, never `undefined`, to avoid this.

---

### C6. Compound Components

**In plain terms:** A set of components designed to be used together as a family — a parent that manages shared state, and children that implicitly read that state (usually through context) without the caller having to wire props between them manually.

**How I'd say it in an interview:**
> "The goal of this pattern is an API that reads declaratively, close to plain HTML — think `<select><option/><option/></select>`, where `<option>` doesn't need `<select>` to explicitly pass it every prop it needs. Under the hood, the parent component sets up a context with whatever shared state and setters the children need, and each child just calls `useContext` to read it. The caller gets to freely rearrange, omit, or add children without the parent needing an ever-growing list of configuration props to account for every possible arrangement."

**Quick example:**
```jsx
<Tabs defaultTab="details">
  <Tabs.List>
    <Tabs.Tab id="details">Details</Tabs.Tab>
    <Tabs.Tab id="history">History</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel id="details"><TaskDetail /></Tabs.Panel>
  <Tabs.Panel id="history"><TaskHistory /></Tabs.Panel>
</Tabs>
// Tabs shares "activeTab" state via context; Tab/Panel children read it, no manual prop wiring
```

**Watch out for:** A compound component's children only work correctly when rendered as actual descendants inside the parent's context — pulling `<Tabs.Tab>` out and rendering it somewhere else entirely breaks it, since there's no parent Provider above it supplying the shared state.

---

## PART D: REDUX AND STATE MANAGEMENT

### D1. Why Global State Management Exists

**In plain terms:** As an app grows, pieces of state need to be read and updated by components that aren't directly related in the tree — passing it down as props through every intermediate layer ("prop drilling") gets unwieldy, and Context alone doesn't give fine-grained control over which components re-render on which changes.

**How I'd say it in an interview:**
> "The problem isn't really 'where does the data live' — it's coordination. If `<Sidebar>` and `<TaskList>` both need to know the task count, and they're siblings, that state has to live in a shared ancestor and get threaded down as props through every component in between, even ones that don't care about it at all. A global store solves this by giving any component, anywhere in the tree, direct read/write access to shared state without threading it through props — the tradeoff is you're introducing a layer of indirection, so it's worth reaching for only once prop drilling or plain Context is actually causing real pain, not by default from day one."

**Quick example:** `tasksSlice` state needs to be read by `<TaskList>`, updated by `<TaskForm>`, and its count displayed in `<Sidebar>` — three components with no direct parent-child relationship to each other.

**Watch out for:** Reaching for a global store for state that's genuinely local to one component or one small subtree (like whether a single dropdown is open) — that just adds indirection with no benefit; `useState` there is simpler and correct.

---

### D2. Redux Core Concepts — Store, Actions, Reducers

**In plain terms:** Redux keeps all shared state in one object (the store). The *only* way to change it is to `dispatch` a plain object describing what happened (an action), which a pure function (a reducer) uses to compute the next state — never mutating the old state directly.

**How I'd say it in an interview:**
> "The whole design rests on unidirectional data flow: dispatch an action, the reducer computes a brand-new state object, the store notifies subscribers, components re-render off the new state. Nothing is ever allowed to mutate state directly — every update goes through this exact same pipeline, which is what makes state changes traceable and predictable: I can log every action and know exactly what changed and why, in order. It's also what makes time-travel debugging possible in Redux DevTools — since every state is just 'previous state plus this one action,' you can literally step backward and forward through them."

**Quick example:** Clicking "complete" on a task dispatches `{ type: 'tasks/toggleComplete', payload: taskId }` — the reducer returns a new array with that one task's `done` flipped, never mutating the old array.

**Watch out for:** Mutating state directly inside a plain (non-Toolkit) reducer, like `state.push(newTask)`. Redux compares old vs. new state by reference to decide whether to notify subscribers — mutating in place means the reference never changes, so components silently fail to re-render even though the data did change.

---

### D3. Redux Toolkit — `createSlice`

**In plain terms:** Redux Toolkit is the now-standard way to write Redux, wrapping the same core store/action/reducer model in a much less verbose API — `createSlice` generates action creators and action types for you from a set of reducer functions you write.

**How I'd say it in an interview:**
> "Redux Toolkit doesn't change what Redux fundamentally *is* — it's still the same dispatch-action-through-a-pure-reducer model underneath. What it removes is the boilerplate that used to make plain Redux painful: hand-writing action type string constants, action creator functions, and a switch statement reducer for every single slice of state. `createSlice` takes an object of reducer functions, and generates the action creators and the combined reducer automatically, matched by name — so I write `addTask(state, action)` once, and get both the `addTask` action creator and the case in the reducer that handles it, for free."

**Full syntax:**
```js
const tasksSlice = createSlice({
  name: 'tasks',
  initialState: { items: [] },
  reducers: {
    addTask: (state, action) => { state.items.push(action.payload); }, // looks mutating — see D4
    toggleComplete: (state, action) => {
      const task = state.items.find(t => t.id === action.payload);
      if (task) task.done = !task.done;
    },
  },
});
export const { addTask, toggleComplete } = tasksSlice.actions;
export default tasksSlice.reducer;
```

**Watch out for:** Assuming `createSlice` reducers can only be written the "mutating" way. They *look* like they mutate state directly (`state.items.push(...)`), but that's only safe because of Immer running underneath — see D4 for why that's not actually breaking Redux's own rules.

---

### D4. Immer and "Mutating" State Safely

**In plain terms:** Immer lets `createSlice` reducers be written using normal-looking mutation syntax (`state.items.push(x)`) while actually producing a brand-new, correctly-immutable state object underneath — you write mutating code against a proxy "draft," and Immer produces the real next state by comparing that draft to the original.

**How I'd say it in an interview:**
> "This resolves what looks like a contradiction: Redux requires reducers to never mutate state, but Redux Toolkit's reducer code looks exactly like mutation. What's actually happening is Immer hands the reducer a proxy object — a 'draft' — that records every mutation performed on it without touching the real, original state at all. When the reducer function returns, Immer uses those recorded changes to build a genuinely new state object via structural sharing: any part of the tree I didn't touch is literally the same reference as before; only the parts I 'mutated' on the draft become new objects. So Redux's actual immutability guarantee is fully intact — Immer is just giving me much more readable syntax to describe the change."

**Quick example:** `state.items.find(t => t.id === action.payload).done = !task.done` inside a slice reducer looks like direct mutation, but Immer intercepts it and returns a new `items` array with only that one task object replaced — every other task in the array keeps the exact same reference as before.

**Watch out for:** A reducer that both mutates the draft *and* returns a new value in the same function — Immer only expects one or the other. Returning a value from a reducer that also mutated `state` directly is an error, because Immer can't reconcile "here's your finished new state" with "also, I already changed the draft."

---

### D5. React-Redux — `useSelector` and `useDispatch`

**In plain terms:** `react-redux` is the binding layer connecting a plain Redux store to React components — `useSelector` subscribes a component to a specific slice of the store (re-rendering it only when that specific slice changes), and `useDispatch` gives access to the store's `dispatch` function.

**How I'd say it in an interview:**
> "The key detail that separates this from plain Context is the selector function passed to `useSelector`. `<TaskList>` calling `useSelector(state => state.tasks.items)` only re-renders when the *result* of that specific selector function changes, by reference — not on every single store update. So if some unrelated slice of the store changes, `<TaskList>` doesn't re-render at all, which is exactly the fine-grained control that Context on its own can't give you, since a Context value change re-renders every single consumer of that context regardless of which part they actually read."

**Full syntax:**
```js
const items = useSelector(state => state.tasks.items);
const dispatch = useDispatch();
dispatch(toggleComplete(taskId));
```

**Watch out for:** A selector that returns a brand-new array or object every call — like `state => state.tasks.items.filter(t => !t.done)` — defeats the reference-equality optimization, since a new array is created every single time regardless of whether the underlying data changed, causing the component to re-render on every store update. Fix: memoize the selector (e.g., with `createSelector` from Reselect/Redux Toolkit) so it only returns a new reference when the actual inputs change.

---

### D6. RTK Query

**In plain terms:** RTK Query is Redux Toolkit's built-in data-fetching and caching layer — instead of manually dispatching actions and writing reducers for loading/success/error states around an API call, you declare an endpoint, and it auto-generates a hook that handles fetching, caching, re-fetching, and loading/error state for you.

**How I'd say it in an interview:**
> "Before RTK Query, a typical API call in Redux meant hand-writing three action types — pending, fulfilled, rejected — a reducer case for each, and a thunk to dispatch them in sequence, repeated for every single endpoint. RTK Query collapses that into declaring the endpoint once, and it generates a ready-to-use hook, like `useGetTasksQuery()`, that gives back `{ data, isLoading, error }` and handles caching automatically — including deduplicating multiple components requesting the same data at once, and invalidating/re-fetching that cache when a related mutation happens."

**Quick example:**
```js
const tasksApi = createApi({
  endpoints: (builder) => ({
    getTasks: builder.query({ query: () => '/tasks' }),
    addTask: builder.mutation({ query: (task) => ({ url: '/tasks', method: 'POST', body: task }) }),
  }),
});
const { data: tasks, isLoading } = tasksApi.useGetTasksQuery();
```

**Watch out for:** Manually managing a separate loading/error `useState` alongside RTK Query. That's exactly the duplicated bookkeeping it's designed to remove — the generated hook already exposes `isLoading`/`isError`/`error` directly.

---

### D7. Zustand and Choosing a State Manager

**In plain terms:** Zustand is a much smaller, hook-based state management library with far less ceremony than Redux — no actions, no reducers, no Provider required; a store is just a hook created directly with `create`, holding state and the functions that update it together in one place.

**How I'd say it in an interview:**
> "The way I'd frame the choice is by how much structure the app actually needs. Context is fine for state that changes rarely and doesn't need fine-grained subscriptions — like a theme. Zustand gives Redux-like global-store ergonomics — a single source of truth, selector-based subscriptions to avoid unnecessary re-renders — with a fraction of the boilerplate, since there's no actions/reducers/dispatch ceremony and no Provider wrapping the app. Redux Toolkit earns its extra structure in larger codebases, with many contributors, where the strict separation of actions/reducers, one enforced way of updating state, and the DevTools time-travel debugging pay for themselves. There isn't one universally right answer — it's a real tradeoff between structure and simplicity that scales with team size and app complexity."

**Quick example:**
```js
const useTaskStore = create((set) => ({
  items: [],
  addTask: (task) => set((state) => ({ items: [...state.items, task] })),
}));
// no Provider, no dispatch — just call the hook directly
const items = useTaskStore((state) => state.items);
```

**Watch out for:** Assuming "less boilerplate" always means "strictly better." Redux's rigidity (single dispatch pipeline, pure reducers, action logging) is a deliberate feature for large teams needing predictability and debuggability — Zustand's flexibility can turn into inconsistent update patterns across a large codebase without the same enforced discipline.

---

## PART E: ROUTING, FORMS, TESTING, PERFORMANCE

### E1. Client-Side Routing

**In plain terms:** A router (like React Router) intercepts navigation so that changing the URL doesn't trigger a full page reload from the server — instead, it uses the browser's History API to update the URL in place, and swaps which components are rendered to match.

**How I'd say it in an interview:**
> "The core trick is the History API's `pushState` — it lets JavaScript change the URL the browser shows, and add a new entry to browser history, without actually asking the server for a new page. The router listens for these URL changes (and for back/forward button presses) and re-renders whatever component tree matches the current path — so a click on a link that logically 'navigates' really just triggers a React re-render with different components mounted, keeping the whole app state, no full-page reload. That's also why deep-linking needs server support too: if someone directly requests `/tasks/42` from the server rather than clicking there from within the app, the server needs to know to serve the same app shell and let the client-side router take it from there."

**Quick example:** Clicking a task in `<TaskList>` navigates to `/tasks/42` — the URL updates, `<TaskDetail>` mounts in place of `<TaskList>`, but `<Sidebar>` and the Redux store are untouched the whole time.

**Watch out for:** Forgetting server-side routing configuration for a client-side-routed single-page app. A user refreshing on `/tasks/42` sends that exact path to the server; if the server doesn't know to respond with the same app shell (instead of a 404), a hard refresh breaks even though clicking there from inside the app works fine.

---

### E2. Controlled Forms and Validation

**In plain terms:** A form built the "React way" ties every field's value to state and validates it either on every change or on submit — versus letting the DOM manage form state natively and only reading/validating values at submit time.

**How I'd say it in an interview:**
> "The tradeoff here mirrors controlled vs. uncontrolled components generally. Fully controlling every field with `useState` and validating on every keystroke gives immediate feedback — disabling submit until required fields are valid, showing an error the moment a field becomes invalid — but it means a re-render on every keystroke across the whole form, which matters for large forms with many fields. That's exactly the performance problem libraries like React Hook Form solve: they keep field values largely uncontrolled internally, using refs instead of state, and only trigger a re-render when validation state actually needs to be shown — so typing in one field doesn't re-render the other twenty."

**Quick example:** `<TaskForm>` validating that `title` isn't empty on every keystroke to disable/enable the submit button live, versus only checking on submit and showing an error message afterward.

**Watch out for:** Validating only on submit for fields with an obvious, immediate correctness signal (like "passwords must match") — that produces a worse experience where the user only discovers the error after finishing the whole form.

---

### E3. Testing with React Testing Library

**In plain terms:** React Testing Library's guiding principle is to test components the way a user actually interacts with them — finding elements by visible text/role/label, and firing real events — rather than reaching into a component's internal state or implementation details.

**How I'd say it in an interview:**
> "The philosophy is explicitly: the more your tests resemble the way your software is actually used, the more confidence they give you. So instead of testing 'does `isEditing` state get set to `true`,' which is an implementation detail that could change without the actual user-facing behavior changing at all, I test 'after I click the edit button, does an input with the task's current title become visible on screen' — using queries like `getByRole` or `getByLabelText` that mirror what a real user or a screen reader would perceive. This means a refactor that changes *how* a component achieves something, without changing what a user sees or can do, shouldn't break the test at all — which is exactly the kind of resilience a good test suite needs."

**Quick example:**
```js
render(<TaskItem task={{ id: 1, title: 'Buy milk', done: false }} />);
fireEvent.click(screen.getByRole('checkbox'));
expect(screen.getByRole('checkbox')).toBeChecked();
// tests observable behavior, not internal state
```

**Watch out for:** Querying by CSS class name or test-only IDs as a first choice. That couples the test to implementation instead of to what a real user would actually perceive — `getByRole`/`getByLabelText` should be reached for first, with a `data-testid` as a last resort when nothing accessible distinguishes the element.

---

### E4. Profiling and Performance

**In plain terms:** The React DevTools Profiler records an actual render pass and reports exactly which components rendered, how long each took, and why — letting you find real, measured bottlenecks instead of guessing at which optimization (memo/useMemo/useCallback) is worth applying.

**How I'd say it in an interview:**
> "My approach to performance work is always measure first, optimize second — the Profiler will actually tell you why a component re-rendered (props changed, state changed, a parent re-rendered, or a context value changed), which turns 'this feels slow' into a specific, actionable finding. Reaching for `React.memo`/`useMemo`/`useCallback` without that data is essentially guessing, and each of those tools has its own overhead — so applying them to something that wasn't actually a bottleneck can make things marginally worse, not better. I'd only add those optimizations at the specific component the Profiler flagged as both re-rendering frequently and doing real, non-trivial work on each render."

**Quick example:** Profiling `<Dashboard>` shows `<TaskList>` re-rendering on every sidebar toggle, and the Profiler flags the reason as "parent re-rendered" — pointing directly at wrapping `<TaskList>` in `React.memo`, rather than guessing at it.

**Watch out for:** Optimizing based on intuition about "what looks expensive" rather than actual profiler output — the most expensive re-render is often somewhere unexpected, like a deeply nested component receiving a fresh inline object prop every render.

---

## PART F: PULLING IT ALL TOGETHER

### F1. Myths Worth Actively Unlearning

**Myth: "The Virtual DOM is what makes React fast."**
Not really. A hand-written, targeted direct DOM update is always faster than React's diff-then-patch process — there's no way around that. The actual value is that it lets React figure out the *minimal* set of real DOM changes automatically, cheaply, instead of me hand-computing that for every possible state change myself. It's a productivity and correctness win, not a raw-speed trick. *(See A3.)*

**Myth: "A component re-rendering means the DOM changed."**
Re-running a component function and updating the real DOM are two separate steps — render, then commit. Reconciliation frequently finds that nothing actually needs to change and skips the DOM update step entirely, even though the function ran. *(See A1, A5.)*

**Myth: "`useEffect` and `useLayoutEffect` are basically the same thing, just named differently."**
The timing difference is the entire point: one runs after paint, one runs before paint, blocking it. Picking the wrong one either causes visible flicker (should've used layout) or unnecessarily blocks rendering (should've used the regular one). *(See B2, B3.)*

**Myth: "Keys just exist to silence a console warning — any unique value works."**
Keys are the actual mechanism React uses to match old list items to new ones across a re-render. Using array index as key actively causes wrong state to attach to the wrong row when list order changes — it's a correctness issue, not a lint nag. *(See A6.)*

**Myth: "Calling a state setter updates the value immediately."**
It schedules a re-render; it doesn't run synchronously. The variable in the current render's scope stays exactly what it was for the rest of that render, no matter how many times the setter is called. *(See B1.)*

**Myth: "Context can fully replace Redux/Zustand for global state."**
Context has no built-in mechanism to prevent unrelated consumers from re-rendering on every value change — it's a propagation tool, not a subscription-optimized store. For state that changes often and is read widely, that difference becomes a real performance problem. *(See A11, D5.)*

**Myth: "Wrapping everything in `React.memo`/`useMemo`/`useCallback` can only help."**
Each of these has its own bookkeeping cost — comparing props, comparing dependencies. Applied to cheap components or trivial calculations, that overhead can outweigh the savings. These are targeted tools for measured bottlenecks, not defaults. *(See B5, B6, B15, E4.)*

**Myth: "Strict Mode's double-invoking of effects/renders is a React bug."**
It's deliberate — a development-only tool designed to surface effects and render logic that aren't actually safe to run more than once, since concurrent rendering can legitimately do that in production too. Disabling it to silence the doubling hides the underlying bug instead of fixing it. *(See B18.)*

**Myth: "Hooks are just syntax sugar over class lifecycle methods."**
They're not a 1-to-1 remapping — `useEffect` doesn't correspond to any single class lifecycle method; it's a genuinely different mental model (synchronizing with an external system after every relevant change) that happens to *cover* what `componentDidMount`/`componentDidUpdate`/`componentWillUnmount` used to handle, combined.

---

### F2. Tracing One Full Update, Start to Finish

Walking through what actually happens when a user clicks "complete" on a task in `<TaskItem>`, naming every mechanism from the parts above:

1. **Event fires.** The click handler calls `dispatch(toggleComplete(taskId))`. *(D2, D3)*
2. **Reducer runs.** Redux Toolkit's `createSlice` reducer receives an Immer draft; the code that looks like `task.done = !task.done` is recorded against that draft, and Immer produces a new state object using structural sharing — only the touched task object and its containing array are new references; everything else in the store keeps its old reference. *(D3, D4)*
3. **Store notifies subscribers.** Every component that called `useSelector` gets its selector re-run. `<TaskList>`'s selector for the whole `items` array returns a new reference (that array *did* change) — it re-renders. `<Sidebar>`'s selector for total task count, if memoized properly, only re-renders if the count itself actually changed. *(D5)*
4. **React schedules a render.** This isn't synchronous — it's scheduled, and if other state updates fire in the same tick, they batch together into one render pass. *(A9)*
5. **Render phase.** React walks the fiber tree top-down from `<TaskList>`, re-running the function of every component that needs to update, building a new work-in-progress tree. Reconciliation compares the new `<TaskItem>` elements to the old ones — matched by `key`, same type — so it's just a props update, not a remount. This entire phase can, in principle, be paused if something more urgent shows up. *(A2, A4, A6, A8)*
6. **Commit phase.** Once the whole render pass is complete, React writes the actual, minimal DOM changes — here, just the checkbox's checked attribute and maybe a strikethrough class — all in one uninterruptible pass, so the user never sees a half-updated state. *(A5)*
7. **Layout effects run**, synchronously, before the browser paints — if any layout depends on the new state. *(B3)*
8. **Browser paints** the updated DOM.
9. **Passive effects run**, after paint — any `useEffect` depending on the changed task data fires now, cleanup-then-effect for anything whose dependencies changed. *(A10, B2)*

---

### F3. Interview Questions to Rehearse

**Part A — How React Works**
1. What's the actual difference between React and a renderer like react-dom?
2. Walk through the difference between an element, a fiber, and a DOM node.
3. Why doesn't reading updated DOM state work right after calling a setter?
4. What problem does Fiber's data structure solve that recursive rendering couldn't?
5. How does React decide whether to reuse a DOM node or remount it from scratch?
6. Why does using array index as a key cause bugs, specifically?
7. What's a lane, and why does React need priority at all?
8. What's the actual difference between `useTransition` and just debouncing?
9. Why can portal event bubbling surprise someone checking "click outside" with a DOM-position check?
10. What causes a hydration mismatch, and how would you actually fix one?

**Part B — Hooks**
11. Why does the dependency array exist, and why shouldn't you selectively omit values from it?
12. When would you actually reach for `useLayoutEffect` over `useEffect`?
13. What are the two genuinely different use cases for `useRef`?
14. When is `useMemo` actually worth the overhead it adds?
15. Why does `useCallback` do nothing on its own without `React.memo` on the receiving component?
16. Why would you reach for `useReducer` instead of several `useState` calls?
17. Why does `useContext` re-render every consumer, even ones that don't care about the changed field?
18. What's the actual difference between `useTransition` and `useDeferredValue`?
19. What problem does `useSyncExternalStore` solve that a plain `useEffect` subscription doesn't?
20. Why does `React.memo` sometimes silently fail to prevent a re-render?
21. What does Suspense actually require from a data source to work at all?
22. What can and can't an Error Boundary catch?
23. Why does Strict Mode double-invoke things, and is that a bug?

**Part C — Composition**
24. Why does React favor composition over class inheritance?
25. What's actually happening when JSX nests children inside a component tag?
26. What problem do render props solve, and what's largely replaced them?
27. What's a concrete downside of the HOC pattern beyond "extra nesting"?
28. What's the real distinction between controlled and uncontrolled components?
29. How do compound components share state without explicit prop-passing?

**Part D — Redux and State Management**
30. What specific problem does global state solve that Context alone doesn't?
31. Why must Redux reducers stay pure, and what breaks if they don't?
32. How does Redux Toolkit's `createSlice` let you write "mutating" code safely?
33. Explain what Immer's draft/proxy mechanism is actually doing under the hood.
34. Why does `useSelector` only re-render a component when its specific selector's result changes?
35. What's a selector mistake that defeats `useSelector`'s optimization entirely?
36. What manual bookkeeping does RTK Query remove compared to hand-written thunks?
37. When would you pick Zustand over Redux Toolkit, and vice versa?

**Part E — Routing, Forms, Testing, Performance**
38. How does client-side routing avoid a full page reload?
39. Why can a hard refresh break a route that works fine when clicked from inside the app?
40. What's the performance tradeoff between fully-controlled and library-managed (e.g., React Hook Form) forms?
41. What's the core philosophy behind React Testing Library's query priority?
42. Why should you reach for `getByRole` before a `data-testid`?
43. What should you check before reaching for `React.memo`/`useMemo` at all?
44. Walk through what the React DevTools Profiler actually tells you about a re-render.

**Synthesis**
45. Trace, start to finish, everything that happens between a Redux `dispatch` call and the browser paint reflecting it.
46. Name one common React performance myth and explain what's actually true instead.

