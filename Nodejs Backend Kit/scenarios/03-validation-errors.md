# 03. Validation and error handling

> **Remember this**
> 1. Check the body, the query and the URL params with a schema as soon as a request arrives. Fields the schema does not list are rejected or dropped, never saved.
> 2. Copy fields one by one by name, and set fields the server owns, like role, on the server. Never pass the whole body to the database.
> 3. One error middleware, one error shape. Expected errors show their message. Bugs show a generic server error, and the details go to the logs.
> 4. Newer Express versions pass errors from async routes to the error handler on their own. Older Express could crash the process on the same code.
> 5. An unhandled rejection means unknown state. Log it, let current requests finish with a time limit, exit with failure, and let a supervisor restart. Never swallow it.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Validation | Checking that incoming data has the right fields, types and limits before the code uses it. |
| Schema | A written description of the data you accept, such as "email is a string, name is at most eighty characters". |
| The edge | The first code that touches a request, before any business logic runs. |
| Mass assignment | Saving every field the client sent, so the client can set columns it should never control, such as role. |
| Allow-list | A list of the fields you accept. Anything not on it is rejected. |
| Deny-list | A list of fields you block. It is weak, because the next sensitive field gets forgotten. |
| Strict schema | A schema that treats any unknown key as an error instead of ignoring it. |
| Bad Request (400) | The status for a request that cannot even be parsed, such as broken JSON. |
| Unprocessable (422) | The status for a request that parses fine but breaks a rule, such as an email that is not an email. |
| Response locals | A per-request object on the response where middleware can store data, such as the validated input, for later handlers. |
| Operator injection | Sending an object with a database query operator where a plain string was expected, so a lookup matches more than it should. |
| Prototype | The object another object inherits properties from. Copying a key named proto carelessly can change it. |
| Error middleware | An Express function with four parameters that receives every error passed on by the routes. |
| Operational error | An expected failure in a correct program, such as bad input, not found or a timeout. You handle it. |
| Programmer error | A bug, such as reading a property of undefined. You log it and return a generic server error. |
| Problem Details | A standard JSON error format with a type, a title and a status, sent with its own content type. |
| Unhandled rejection | A promise that failed when nothing was waiting for it or catching it. |
| Uncaught exception | An error that was thrown and never caught by any try and catch. |
| Supervisor | Something that restarts a process when it dies, such as Docker's restart policy, Kubernetes or PM2. |
| Draining | Stopping new connections but letting requests already in progress finish before exiting. |
| Exit code | The number a process reports when it ends. Zero means success, anything else means failure. |
| Floating promise | An async call that nobody awaits or catches, so its failure goes nowhere. |

| # | Scenario | Tag |
|---|---|---|
| V1 | [A user signs up as an admin](#v1-a-user-signs-up-as-an-admin) | Must know |
| V2 | [Every endpoint returns errors differently](#v2-every-endpoint-returns-errors-differently) | Must know |
| V3 | [The server dies at 3 a.m. with an unhandled rejection](#v3-the-server-dies-at-3-am-with-an-unhandled-rejection) | Likely |

---

## V1. A user signs up as an admin
**Tag: Must know**

### Before you speak
- **Today:** the signup handler takes the whole request body and saves it as a new user row.
- **What goes wrong:** the client controls the body, so it can add any field it likes. Send a role of admin, and the database saves it. This is called mass assignment.
- **The fix, part one:** a schema at the edge. It lists the fields signup accepts, with types and length limits, and rejects any extra key.
- **The fix, part two:** the handler copies email, password and name by name, and sets the role itself. Even if someone loosens the schema later, the role still cannot come from the client.
- **Error answers:** broken JSON gets Bad Request. JSON that parses but breaks a rule gets Unprocessable, with the field names. A size cap on the body refuses huge requests before your code runs.
- **The trade-off to mention:** a strict schema also rejects harmless extra fields from other clients. For each endpoint, you decide whether to reject unknown keys or drop them quietly.

### Scenario
"A security researcher sent our SaaS signup endpoint a body with `role: "admin"`, and the new account really was an admin. The handler saves `req.body` straight into the users table. What went wrong, and how do you fix it properly?"

### Questions to ask back
- **Which fields should signup accept at all?** That list becomes the schema, and everything else is refused.
- **Should unknown fields be rejected or quietly dropped?** Rejecting is safer and easier to debug. Dropping is kinder to old clients that send extra fields.
- **Are other endpoints built the same way?** The profile update endpoint is the usual second hole, so I check it next.

### Spoken answer
> This is mass assignment, which means the handler trusted the whole body, so the client could set any column, including the role. I would fix it at the edge with a schema. The schema lists exactly the fields signup accepts, with types and limits, and rejects unknown keys. Then the handler picks those fields by name and sets the role itself on the server. So even if someone loosens validation later, the role still cannot come from the client. Bad input gets a validation error with the field names, and broken JSON gets a bad request. I also cap the body size. The trade off is that a strict schema rejects new fields from old clients, so I decide per endpoint whether to reject or drop unknown keys.

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
  > A partial update gets its own schema where every field is optional, and the role is not in it at all. Changing a role becomes a separate admin endpoint with its own permission check.
- **"The data is in MongoDB."**
  > Mass assignment works the same way, and there is one more risk, operator injection. A password can arrive as an object holding a query operator instead of a string, so the lookup matches more than it should. The schema demands a string, and cleaning query filters adds a second layer.
- **"Query parameters, not the body."**
  > Validate them too, and convert them to the right types, because they always arrive as strings. I keep the parsed values on response locals instead of writing them back onto the request query.

### Follow-up questions
- **Bad Request or Unprocessable?** Bad Request, status 400, when the request cannot be parsed, like broken JSON. Unprocessable, status 422, when it parses but breaks a rule. Either is fine if you stay consistent.
- **Where does validated data live?** On response locals, a per-request object for passing data between middleware. In newer Express versions the request query is read-only, so writing to it does not work.
- **Why cap the body size?** A huge body costs memory and parse time before any of your code runs. With a limit set, the JSON parser answers "payload too large" on its own.
- **Optional: senior. Someone sends a key named proto in the JSON body. Is the strict schema enough?** The JSON parser keeps it as a plain key, and a strict schema rejects it. The danger is code that copies the body into another object with a plain assign. That can turn the key into the copy's prototype, the object it inherits from. Validate first, pick fields by name, and never merge raw bodies.

### Common wrong answers and red flags
- Saving the whole request body into the user row, or building an insert from every key the client sent.
- A deny-list, such as "remove role and isAdmin", instead of an allow-list. The next sensitive column gets forgotten.
- Validating the body but not the query.
- Returning a server error for broken JSON. It is the client's mistake, so it is a Bad Request.

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

### Before you speak
- **Today:** every route builds its own error answer. Some send a string, some fall through to Express's default HTML error page, and some send the stack trace.
- **What goes wrong:** the frontend cannot handle errors in one way, and stack traces leak file paths and internal details. Older Express also does not catch an error thrown inside an async route. The promise fails with nobody handling it, and the process can crash.
- **The fix:** routes throw typed errors for expected cases, such as not found or conflict. Each one carries a status and a stable code, a short fixed name the frontend can check. One error middleware at the end turns every error into the same shape.
- **Expected versus bug:** an expected error shows its message. Anything else is a bug, so the client gets a generic server error, and the full stack goes to the logs.
- **The shape:** Problem Details, a standard JSON error format with a type, a title and a status. You may add your own fields, such as the code or a list of field errors.
- **The trade-off to mention:** a little ceremony in each route. In return, the frontend branches on codes instead of reading messages.

### Scenario
"The frontend team on our e-commerce API says errors come back in five different shapes: sometimes a string, sometimes an HTML page, sometimes a stack trace. One async route even took a server down last month. Design the error handling for the whole API."

### Questions to ask back
- **Which Express version are we on?** Newer Express passes async errors to the error handler. Older Express needs a wrapper on every async route.
- **Does the frontend act differently per error type?** Then I need stable codes it can check, not just messages that may change.
- **Do we have structured logging?** The error handler is where bugs get logged with their stack, so I want those logs searchable.

### Spoken answer
> I want every error to leave through a single place, with a single shape. In the routes, I throw typed errors for expected cases, like not found or conflict, each with a status and a stable code. One error middleware at the end turns any error into that standard problem format. Expected errors show their message. Anything unexpected is a bug, so the client sees only a generic server error, and the full stack goes to the logs. Parser errors like broken JSON use the same shape. Newer Express forwards errors from async routes on its own. On older Express, the same throw can crash the whole process, so there you need a wrapper. The trade off is a little ceremony, but the frontend can handle errors by code.

### Say it in 5 beats
1. One exit, one shape.
2. Typed errors with status and code.
3. Bugs: generic message out, stack to logs.
4. Parser errors mapped too.
5. Newer Express catches async throws.

### Case variations
- **"A database unique violation shows up as a server error."**
  > I translate known database driver errors in the data layer. A duplicate email becomes a conflict with a code like "email taken". I never pass the driver's own detail text through, because it contains the user's data.
- **"The error happens halfway through a streamed response."**
  > The headers are already sent, so I cannot send an error body any more. The handler passes the error on, and Express closes the connection. The client then sees a broken response, not a short one that looks complete.
- **"Validation errors need a list of fields."**
  > Problem Details allows extra fields, so I add an errors list with the field name and message for each problem. Clients that do not know the list simply ignore it.
- **"Some clients only accept plain JSON."**
  > The body stays exactly the same. Only the content type label changes, based on what the client says it accepts.

### Follow-up questions
- **Operational error versus programmer error?** An operational error is an expected failure in a correct program, like bad input or a timeout. You handle it. A programmer error is a bug, like reading a property of undefined. You log it and return a generic server error.
- **How does Express know a middleware is an error handler?** It has four parameters. Express counts them, so do not drop the unused next argument.
- **Why not show the error message on a server error?** A bug's message can leak table names, file paths or user data.
- **Optional: senior. How would you roll this out to a big codebase on older Express?** First add the error middleware and a not found handler, so every error has the same shape. Then wrap the async routes, or move to newer Express, which makes the wrapper unnecessary. Then replace each route's home-made error answers one by one, with a test per route that checks the shape.

### Common wrong answers and red flags
- Sending the stack trace to the client.
- A try and catch in every route, each building its own error body.
- An error middleware with three parameters. Express treats it as normal middleware and never sends it errors.
- Writing a second response when the headers are already sent.
- Using messages as the contract instead of stable codes.
- Mapping "email taken" to Unprocessable. It clashes with existing data, so it is a Conflict.

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

### Before you speak
- **Today:** a background cache refresh calls an async function without awaiting it or adding a catch. When it fails, nobody handles the failed promise.
- **What goes wrong:** current Node versions treat an unhandled rejection like an uncaught exception, and exit the process with a failure code. If nothing restarts it, the service stays down.
- **Why the teammate's idea is wrong:** a handler that only logs keeps the process alive. But the process may be halfway through something, such as holding a lock or an open transaction, so it would keep serving in an unknown state.
- **The fix:** a last resort handler that logs the error, stops taking new connections, lets in-flight requests finish, and exits with a failure code. A timer forces the exit if draining hangs. A supervisor then starts a fresh process.
- **The real fix:** find the floating promise and give that job its own try and catch, so its failure is handled where it happens.
- **The trade-off to mention:** a short restart. Several instances behind a load balancer hide it from users.

### Scenario
"At 3 a.m. our notification service process died. The only log line is an unhandled promise rejection from a cache refresh. A teammate suggests adding a handler that logs the error and keeps the server running. What do you think, and what would you do instead?"

### Questions to ask back
- **What restarts the process today?** Docker, Kubernetes, PM2, or nothing? Without a supervisor, every crash is an outage until a human steps in.
- **Did requests fail while it was down, or did another instance take over?** That decides how urgent the fix is.
- **Is the failing code inside a request, or in a background timer?** Background work is where promises nobody awaits usually hide.

### Spoken answer
> An unhandled rejection should crash the process with a failure exit code, and that is the right default. After an error nobody handled, the process may be half way through something, so it should not keep serving. My last resort handler logs the error with context, stops accepting new connections, lets in flight requests finish, and exits with a failure code. A timer forces the exit if draining hangs. A supervisor, like a container restart policy, starts a fresh process. Then I fix the real bug, which is usually a fire and forget call nobody awaited. I would never catch the event and carry on, because that keeps a broken process serving. The trade off is a short restart, which several instances behind a load balancer hide.

### Say it in 5 beats
1. Crashing is the right default.
2. State is unknown, so stop serving.
3. Log, drain, exit non-zero, with a timer.
4. A supervisor restarts it.
5. Fix the promise nobody awaited.

### Case variations
- **"It now restarts in a loop."**
  > A crash loop means the bug fires on every start, so restarting alone will not fix it. The supervisor waits longer between each restart, so it does not spin. An alert on restarts tells a human, who fixes the code or rolls back.
- **"Can't we start Node with the warn flag?"**
  > That flag turns the crash into a warning, so the process keeps running. It hides the bug and leaves the process in an unknown state.
- **"The failing code is a background cache refresh."**
  > I give that job its own try and catch, log the failure, and keep serving the old cache. That is an expected failure with a plan, so it is handled. The last resort handler is only for what I did not foresee.
- **"We run several workers with the cluster module."**
  > When one worker dies, the main process starts a new one, and the other workers keep serving. The same rule applies inside each worker: log, drain and exit.

### Follow-up questions
- **Uncaught exception versus unhandled rejection?** The first is a thrown error nobody caught. The second is a failed promise with no handler. Both should end in exit and restart.
- **Why not exit immediately in the handler?** Requests in progress would be cut off, and logs might not be written out. Drain briefly, with a timer as the hard limit.
- **Why is that timer unref'd?** Unref tells Node not to stay alive just for this timer. So if everything else finishes first, the process exits without waiting for it.
- **Optional: senior. How do you stop these bugs reaching production?** A lint rule that flags floating promises, a wrapper for every background job that catches and logs, and a test that runs the process with a failed promise and checks that it exits with a failure code.

### Common wrong answers and red flags
- Logging the unhandled rejection and doing nothing else, so the process keeps serving.
- Starting production with a "warn" or "none" setting for unhandled rejections.
- No supervisor, so one crash becomes a long outage.
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
