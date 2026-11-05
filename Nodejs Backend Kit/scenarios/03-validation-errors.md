# 03. Validation and error handling

> **Remember this**
> 1. Validate body, query and params at the edge with a schema. Unknown keys are rejected or dropped, never saved.
> 2. Pick fields by name and set server-owned fields like `role` on the server. Never spread `req.body` into the database.
> 3. One error middleware, one shape (`application/problem+json`). Expected errors show their message. Bugs show "Internal Server Error" and go to the logs.
> 4. Express 5 forwards async errors on its own. Express 4 crashed the process on the same code.
> 5. An unhandled rejection means unknown state: log, drain with a timeout, exit non-zero, and let a supervisor restart. Never swallow it.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| V1 | [A user signs up as an admin](#v1-a-user-signs-up-as-an-admin) | Must know |
| V2 | [Every endpoint returns errors differently](#v2-every-endpoint-returns-errors-differently) | Must know |
| V3 | [The server dies at 3 a.m. with an unhandled rejection](#v3-the-server-dies-at-3-am-with-an-unhandled-rejection) | Likely |

---

## V1. A user signs up as an admin
**Tag: Must know**

### Scenario
"A security researcher sent our SaaS signup endpoint a body with `role: "admin"`, and the new account really was an admin. The handler saves `req.body` straight into the users table. What went wrong, and how do you fix it properly?"

### Questions to ask back
- **Which fields should signup accept at all?** That becomes the schema.
- **Should unknown fields be rejected or silently dropped?** Rejecting is safer and easier to debug. Dropping is kinder to old clients.
- **Are other endpoints built the same way?** Profile updates are the usual second hole.

### Spoken answer
> This is mass assignment. The handler trusted the whole body, so the client could set any column, including the role. I would fix it at the edge with a schema. The schema lists exactly the fields signup accepts, with types and limits, and rejects unknown keys. Then the handler picks those fields by name and sets the role itself on the server. So even if someone loosens validation later, the role still cannot come from the client. Bad input gets a validation error with the field names, and broken JSON gets a bad request error. I also cap the body size. The trade off is that a strict schema rejects new fields from old clients, so I decide per endpoint whether to reject or drop unknown keys.

### Say it in 5 beats
1. Mass assignment: the body was trusted.
2. Schema at the edge, unknown keys rejected.
3. Pick fields by name, server sets role.
4. Clear errors, capped body size.
5. Trade-off: strict versus dropping unknown keys.

### Case variations
- **"Why not just drop unknown keys silently?"**
  > Dropping also blocks the attack, because the role simply disappears. But the client never learns its field was ignored, which hides bugs. I reject on sensitive endpoints and may drop on harmless ones.
- **"Now the profile update endpoint has the same problem."**
  > A partial update gets its own schema where every field is optional, and the role is not in it at all. Changing a role is a separate admin endpoint with its own permission check.
- **"The data is in MongoDB."**
  > Mass assignment is the same, plus operator injection. A field like the password can arrive as an object with a query operator instead of a string. The schema demands a string, and the Mongoose option that sanitizes filters adds a second layer.
- **"Query parameters, not the body."**
  > Validate and coerce them too, because they always arrive as strings. In Express 5 you cannot write the parsed values back onto the request query, so I keep them on the response locals.

### Follow-up questions
- **400 or 422?** 400 when the request cannot be parsed, like broken JSON. 422 when it parses but breaks a rule. Lesson 65 says either is fine if you are consistent.
- **Where does validated data live?** On the response locals, because Express 5 makes the request query a getter.
- **Why cap the body size?** A huge body costs memory and parse time before any of your code runs. The JSON parser answers 413 on its own.
- **Optional: senior. Someone sends a key named proto in the JSON body. Is the strict schema enough?** The JSON parser keeps it as a plain key, and a strict schema rejects it. The danger is code that copies the body into another object with a plain assign, which turns that key into the copy's prototype, so a check like "is admin" becomes true on the copy. Validate first, pick fields by name, and never merge raw bodies.

### Common wrong answers and red flags
- `User.create(req.body)`, or an `INSERT` built from `Object.keys(req.body)`.
- A deny-list ("remove `role` and `isAdmin`") instead of an allow-list. The next sensitive column gets forgotten.
- Validating the body but not the query.
- Returning a 500 for broken JSON.

### Numbers to quote
No figures needed.

### Code sketch
```js
// app is an Express app, z is zod, users.create saves a row, hash is a slow password hash
const Signup = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(80),
}).strict();                                                    // unknown keys such as role are an error

app.use(express.json({ limit: '10kb' }));
app.post('/signup', async (req, res) => {
  const parsed = Signup.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(422).json({ error: 'Validation failed', issues: parsed.error.issues });
  const { email, password, name } = parsed.data;                // pick fields by name
  const user = await users.create({ email, passwordHash: await hash(password), name, role: 'user' });
  res.status(201).json({ id: user.id, email, name });
});
```

Verified by [verify-v1.mjs](code/errors/verify-v1.mjs)

### Source
Lessons 65, 67, 85, 86.

---

## V2. Every endpoint returns errors differently
**Tag: Must know**

### Scenario
"The frontend team on our e-commerce API says errors come back in five different shapes: sometimes a string, sometimes an HTML page, sometimes a stack trace. One async route even took a server down last month. Design the error handling for the whole API."

### Questions to ask back
- **Which Express version are we on?** Express 5 forwards async errors. Express 4 needs a wrapper on every async route.
- **Does the frontend branch on error types?** Then I need stable machine codes, not just messages.
- **Do we have structured logging?** The error handler is where bugs get logged with their stack.

### Spoken answer
> I want every error to leave through a single place, with a single shape. In the routes, I throw typed errors for expected cases, like not found or conflict, each with a status and a stable code. One error middleware at the end turns any error into the standard problem format. Expected errors show their message. Anything unexpected is a bug, so the client sees only a generic server error, and the full stack goes to the logs. Parser errors like broken JSON use the same shape. Newer Express versions forward errors from async routes on their own. On older versions, the same throw can crash the whole process, so there you need a wrapper. The trade off is a little ceremony, but the frontend can handle errors by code.

### Say it in 5 beats
1. One exit, one shape.
2. Typed errors with status and code.
3. Bugs: generic message out, stack to logs.
4. Parser errors mapped too.
5. Newer Express catches async throws.

### Case variations
- **"A database unique violation shows up as a 500."**
  > I map known driver errors at the data layer. A unique violation in Postgres has its own error code, so I turn it into a conflict with a code like "email taken". I never pass the driver's detail text through, because it contains the user's data.
- **"The error happens halfway through a streamed response."**
  > The headers are already sent, so I cannot send an error body. The handler passes the error on, and Express closes the connection, so the client sees a broken response instead of a short one that looks complete.
- **"Validation errors need a list of fields."**
  > The problem format allows extra members, so I add an errors list with field and message. Clients that do not know it just ignore it.
- **"Some clients only accept plain JSON."**
  > The body stays the same. Only the content type changes, based on what the client says it accepts.

### Follow-up questions
- **Operational error versus programmer error?** An operational error is an expected failure in a correct program, like bad input or a timeout. You handle it. A programmer error is a bug, like reading a property of undefined. You log it and return a generic 500.
- **How does Express know a middleware is an error handler?** It has four parameters. Express counts them, so do not drop the unused `next`.
- **Why not show the error message on a 500?** It can leak table names, file paths or user data.
- **Optional: senior. How would you roll this out to a big Express 4 codebase?** First add the error middleware and a 404 handler, so the shape is consistent. Then wrap async routes, or move to Express 5, which removes the wrapper. Then replace ad hoc error responses route by route, with a test per route that checks the shape.

### Common wrong answers and red flags
- `res.status(500).send(err.stack)`.
- A try and catch in every route, each building its own error body.
- An error middleware with three parameters. Express treats it as normal middleware.
- Writing a second response when `res.headersSent` is already true.
- Using messages as the contract instead of stable codes.
- Copying lesson 66's mapping of "email taken" to 422. It is a conflict with existing data, so 409, as lesson 64 says.

### Numbers to quote
No figures needed.

### Code sketch
```js
export class AppError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code, isOperational: true }); }
}

export const errorHandler = (log) => (err, req, res, next) => {
  if (res.headersSent) return next(err);                       // too late for a body
  const known = err.isOperational || err.type?.startsWith('entity.'); // ours, or a body-parser error
  const status = known ? err.status : 500;
  if (!known) log.error({ err, path: req.path }, 'unexpected error');
  res.status(status).type('application/problem+json').json({
    type: 'about:blank', status,
    title: known ? err.message : 'Internal Server Error',      // never echo a bug's message
    code: err.code ?? (known ? err.type : 'INTERNAL'),
  });
};
```

Verified by [verify-v2.mjs](code/errors/verify-v2.mjs)

### Source
Lessons 50, 64, 66, 87.

---

## V3. The server dies at 3 a.m. with an unhandled rejection
**Tag: Likely**

### Scenario
"At 3 a.m. our notification service process died. The only log line is an unhandled promise rejection from a cache refresh. A teammate suggests adding a handler that logs the error and keeps the server running. What do you think, and what would you do instead?"

### Questions to ask back
- **What restarts the process today?** Docker, Kubernetes, PM2 or nothing? Without a supervisor, a crash is an outage.
- **Did requests fail while it was down, or did another instance take over?** That decides how urgent the fix is.
- **Is the failing code inside a request, or a background timer?** Background work is where promises nobody awaits usually hide.

### Spoken answer
> In current Node versions, an unhandled rejection crashes the process with a failure exit code, and that is the right default. After an error nobody handled, the process may be half way through something, so it should not keep serving. My last resort handler logs the error with context, stops accepting new connections, lets in flight requests finish, and exits with a failure code. A timer forces the exit if draining hangs. A supervisor, like a container restart policy, starts a fresh process. Then I fix the real bug, which is usually a fire and forget call nobody awaited. I would never catch the event and carry on, because that keeps a broken process serving. The trade off is a short restart, which several instances behind a load balancer hide.

### Say it in 5 beats
1. Crashing is the right default.
2. State is unknown, so stop serving.
3. Log, drain, exit non-zero, with a timer.
4. A supervisor restarts it.
5. Fix the promise nobody awaited.

### Case variations
- **"It now restarts in a loop."**
  > A crash loop means the bug fires on every start, so restarting will not fix it. The supervisor's backoff keeps it from spinning, and an alert on restarts tells a human. Then I fix the code or roll back.
- **"Can't we start Node with the warn flag?"**
  > That flag turns the crash into a warning, and the process keeps running with a success exit code. It hides the bug and leaves unknown state behind.
- **"The failing code is a background cache refresh."**
  > I give that job its own try and catch, log the failure, and keep the old cache. That is an expected failure with a plan, so it is handled. The last resort handler is only for what I did not foresee.
- **"We run several workers with the cluster module."**
  > One worker dies and the primary forks a new one, while the others keep serving. The same rule applies inside each worker.

### Follow-up questions
- **Uncaught exception versus unhandled rejection?** The first is a throw nobody caught. The second is a rejected promise with no handler. Both should end in exit and restart.
- **Why not exit immediately in the handler?** In-flight requests would be cut off, and logs might not flush. Drain briefly, with a timer as the hard limit.
- **Why is that timer unref'd?** So the timer itself does not keep the process alive if everything else finishes first.
- **Optional: senior. How do you stop these bugs reaching production?** A lint rule that flags promises nobody awaits, a wrapper for every background job that catches and logs, and a test that runs the process with a rejected promise and checks it exits non-zero. Lesson 88 names the lint rule.

### Common wrong answers and red flags
- `process.on('unhandledRejection', console.error)` and nothing else.
- Starting production with `--unhandled-rejections=warn` or `none`.
- No supervisor, so the crash is a long outage.
- A shutdown with no time limit, so a stuck connection keeps a broken process alive.

### Numbers to quote
No figures needed.

### Code sketch
```js
export function installCrashHandlers(server, log) {
  let crashing = false;
  const crash = (kind) => (err) => {
    if (crashing) return;                                      // second error while shutting down
    crashing = true;
    log(`${kind}: ${err?.message ?? err}`);
    process.exitCode = 1;
    server.close(() => log('server closed, exiting'));         // finish in-flight requests
    setTimeout(() => process.exit(1), 5000).unref();           // never hang forever
  };
  process.on('uncaughtException', crash('uncaughtException'));
  process.on('unhandledRejection', crash('unhandledRejection'));
}
```

Verified by [verify-v3.mjs](code/errors/verify-v3.mjs)

### Source
Lessons 20, 50, 87, 88, 97, 102.
