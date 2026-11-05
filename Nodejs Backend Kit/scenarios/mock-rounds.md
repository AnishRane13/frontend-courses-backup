# Mock interview rounds

Five rounds of six chained questions. Each question follows from the answer a candidate would give to the one before, the way a real interviewer drills down. There are no new answers here: each question points to the scenario to review. Answer out loud, timed, then check yourself against that scenario's spoken answer, beats and follow-ups.

How to use a round:
1. Read only the interviewer line. Answer in 60 to 90 seconds using the five steps in [00-how-to-answer.md](00-how-to-answer.md).
2. After each answer, read the next question. It assumes you gave a reasonable answer, so do not peek ahead.
3. When the round is done, review each listed scenario and note which beats you missed.

---

## Round 1: E-commerce order API

1. "Our orders endpoint uses page and limit, and deep pages take over a second on five million rows. How would you fix it?" Review [P1](01-pagination.md).
2. "You said you would add an index on time and id. How do you check the database actually uses it, and what would you look for in the plan?" Review [D1](05-databases-indexing.md).
3. "Customers now want to sort by order total and filter by status. What could go wrong with your pagination?" Review [P3](01-pagination.md).
4. "Checkout calls a payment endpoint. On a bad mobile network the app retries and some customers are charged twice. What do you do?" Review [A1](02-api-design.md).
5. "Payments also move money between two wallets in our database. How do you make sure a transfer never loses or creates money?" Review [D2](05-databases-indexing.md).
6. "You need to ship all of this without dropping in-flight checkouts. How do you deploy?" Review [DP1](11-deployment.md).

## Round 2: SaaS dashboard performance

1. "Our admin screen shows numbered pages and a total count, and the count alone takes hundreds of milliseconds. What would you do?" Review [P2](01-pagination.md).
2. "The dashboard's stats query is also expensive. You suggest caching it. How exactly, and how do you avoid showing stale numbers?" Review [C1](09-caching-redis.md).
3. "That cached stats key expires at the busiest moment of the day, and hundreds of requests miss at once. What happens, and how do you stop it?" Review [C2](09-caching-redis.md).
4. "A report endpoint does heavy computation, and while it runs every other request stalls. Why, and what is your fix?" Review [E1](08-async-event-loop.md).
5. "After deploying that fix, memory grows steadily until the process restarts, and latency is up. How do you investigate?" Review [PD1](13-production-debugging.md).
6. "The container itself keeps getting killed for memory. How do Node's heap limit and the container limit interact?" Review [DP2](11-deployment.md).

## Round 3: Authentication and security

1. "We need login for a web app and a mobile app. Sessions or tokens, and why?" Review [S1](04-auth-jwt-security.md).
2. "You chose short-lived access tokens with refresh tokens. A refresh token leaks. What limits the damage?" Review [S2](04-auth-jwt-security.md).
3. "How do you store passwords, and how do you stop someone guessing them or learning which emails exist?" Review [S3](04-auth-jwt-security.md).
4. "A researcher signs up with a role field in the body and becomes an admin. What went wrong?" Review [V1](03-validation-errors.md).
5. "Do a quick security review of the same API: cross-site scripting, cross-site request forgery, CORS and rate limits." Review [S4](04-auth-jwt-security.md).
6. "During that review you notice error responses include stack traces, in different shapes per endpoint. How do you fix error handling across the API?" Review [V2](03-validation-errors.md).

## Round 4: Real-time features and background work

1. "Our chat app works on one server. We add a second behind a load balancer and users stop seeing each other's messages. Why, and what do you change?" Review [W1](07-websockets.md).
2. "Mobile users drop off the network and come back. How do they get the messages they missed, without duplicates?" Review [W2](07-websockets.md).
3. "When a message mentions many users, the notification service sends thousands of pushes. It either crawls or overwhelms the provider. How do you send them?" Review [E2](08-async-event-loop.md).
4. "Some of those notification jobs fail on bad addresses and retry forever, blocking the queue. What should happen instead?" Review [Q2](10-queues-scheduled-jobs.md).
5. "There is also a daily digest scheduled inside the app. After scaling to three servers, users get three digests. How do you make it run once?" Review [Q1](10-queues-scheduled-jobs.md).
6. "One night the worker dies with an unhandled promise rejection from a cache refresh. A teammate wants to catch it and keep running. What do you say?" Review [V3](03-validation-errors.md).

## Round 5: Files, architecture and production

1. "Our file service crashes with out of memory when users download large exports. How do you serve big files?" Review [ST1](06-streams.md).
2. "Exports go out as a streamed CSV, and some clients are very slow. What happens on the server, and how do you keep memory bounded?" Review [ST2](06-streams.md).
3. "Some exports take two minutes to build, and the load balancer cuts the request at sixty seconds. How do you redesign it?" Review [A3](02-api-design.md).
4. "The product is growing and the CTO wants to split the monolith into microservices. What is your advice?" Review [AR1](12-architecture.md).
5. "If orders and inventory do become separate services, how do you keep them consistent without one shared transaction?" Review [AR2](12-architecture.md).
6. "After the split, a few requests a minute fail with a 502 behind the load balancer, and nothing shows in the app logs. Where do you look?" Review [PD2](13-production-debugging.md).

---

Not used in a round, worth practising on their own: [P4](01-pagination.md) type-ahead search, [A2](02-api-design.md) versioning, [D3](05-databases-indexing.md) schema change on a live table.
