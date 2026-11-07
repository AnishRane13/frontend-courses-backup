# 01. Pagination, filtering and sorting

> **Remember this**
> 1. Offset skips rows by walking past them, so deep pages get slow. Keyset jumps straight to "the rows after this one" through an index.
> 2. A cursor is a bookmark: the sort values and the id of the last row the user saw. Treat it as user input and check it.
> 3. Always finish the sort with the unique id. Without that tiebreaker, rows with equal values can move between pages.
> 4. Users pick sorts and filters from a fixed list that you map to real, indexed columns. Their text never goes into the query itself.
> 5. Counting every row of a big table is slow. Show an estimate or "more than N" unless someone really needs the exact number.

Run the scripts listed in each Code sketch once before saying "in a local test".

## Words you need

| Term | Plain meaning |
| --- | --- |
| Pagination | Returning a big list one page at a time instead of all at once. |
| Offset | "Skip N rows, then return a page." The database still has to walk past the N skipped rows. |
| Keyset pagination | "Give me the rows that come after this exact row." The database jumps there through an index, so deep pages are as cheap as the first. |
| Cursor | A small token the API returns with each page. It records where the page ended, and the client sends it back to get the next page. |
| Opaque cursor | A cursor the client must not read or edit. The server encodes it and checks it when it comes back. |
| Index | A sorted copy of some columns that lets the database find rows without reading the whole table. |
| Composite index | An index on several columns in a set order, such as status, then total, then id. |
| Tiebreaker | A unique column, usually the id, added at the end of a sort so that equal values always come back in the same order. |
| Allow-list | A fixed list of values you accept. Anything not on the list is rejected. |
| Query plan | The database's description of how it will run a query, for example "read the whole table, then sort" or "read the index". |
| Planner estimate | The database's own rough guess of how many rows a table has. It is almost free to read but not exact. |
| Capped count | Counting only up to a limit, such as ten thousand, and showing "more than ten thousand" past it. |
| Hot row | A single row that many requests try to update at the same moment, so they queue up behind its lock. |
| Collation | The rules a database uses to order text. A language-aware collation follows dictionary rules. Plain character order compares raw character codes. |
| Trigram index | An index that breaks text into three-letter pieces, so "contains" searches can use it. |
| Debounce | Waiting until the user stops typing for a moment before sending a request. |
| Race condition | A bug where the result depends on which of two things finishes first. |

| # | Scenario | Tag |
|---|---|---|
| P1 | [The orders endpoint gets slow at 5 million rows](#p1-the-orders-endpoint-gets-slow-at-5-million-rows) | Must know |
| P2 | [The admin table needs page numbers and a total](#p2-the-admin-table-needs-page-numbers-and-a-total) | Likely |
| P3 | [Users choose the sort column and add filters](#p3-users-choose-the-sort-column-and-add-filters) | Must know |
| P4 | [A type-ahead admin search over 2 million users](#p4-a-type-ahead-admin-search-over-2-million-users) | Likely |

---

## P1. The orders endpoint gets slow at 5 million rows
**Tag: Must know**

### Before you speak
- **Today:** the endpoint takes a page number and a page size, and runs a query that says "skip this many rows, then give me twenty". That is offset pagination.
- **What goes wrong:** the database cannot jump to row forty thousand. It reads rows one, two, three and onward, throws them away, and only then returns twenty. Page two is cheap. Page two thousand reads forty thousand rows to show twenty, so the deeper a customer scrolls, the slower it gets.
- **The fix:** keyset pagination. Instead of "skip N", ask "give me the twenty rows that come right after the last row I showed you". The client sends back a cursor holding that last row's time and id.
- **Why the fix is fast:** with an index on time and id, the database finds that exact spot in the sorted index and reads the next twenty entries. It never touches the rows before it, so page two thousand costs the same as page one.
- **Why the id is in the cursor:** many orders can share the same timestamp. The id breaks the tie, so no row is skipped or shown twice.
- **The trade-off to mention:** you lose page numbers. You can only go forward or back from where you are, which is fine for feeds and infinite scroll.

### Scenario
"Our e-commerce orders endpoint uses page and limit. It was fine at launch, but the table now has five million rows, and customers who scroll deep into their history wait more than a second. How would you fix the pagination?"

### Questions to ask back
- **Do users need page numbers, or only next and previous?** If they only scroll forward, keyset fits perfectly. If they really need to jump to page forty-seven, I keep offset for that screen and limit how deep it can go.
- **What is the list sorted by?** Keyset needs a sort that ends in a unique column. "Newest first" becomes "created time, then id".
- **Is page one slow too?** If even the first page is slow, the real problem is a missing index, not offset.
- **Do other clients call this API?** Switching to a cursor changes the API contract, so I add the cursor next to the page number, or ship it as a new version.

### Spoken answer
> I would switch from offset to keyset pagination. Offset means skip this many rows, then return a page. The database still walks every skipped row, so deep pages get slower. Keyset means give me the rows after the last one the user saw. The client sends that spot back as a cursor, which holds the last row's time and id. With an index on those same columns, the database jumps straight there. A deep page then costs the same as the first. For a small admin table, offset is still fine. The trade off is that you lose page numbers, so you can only move forward or back. That suits feeds and infinite scroll.

### Say it in 5 beats
1. Offset walks every skipped row.
2. Keyset: rows after the last one seen.
3. Cursor holds time plus id.
4. Index on the same columns as the sort.
5. Trade-off: no page numbers.

### Case variations
- **"New orders arrive while a customer is paging."**
  > With offset, a new order at the top pushes every row down by one. The next page then starts one row earlier, so the customer sees a row twice. Keyset is tied to a real row, the last one they saw, so new rows above it change nothing.
- **"Product says users must be able to jump to page fifty."**
  > Then that screen needs offset, because keyset cannot jump. I keep offset there, cap how deep anyone can go, and make sure the sort has an index. Shallow pages stay cheap. Only very deep pages are the problem.
- **"The data is in MongoDB, not Postgres."**
  > The idea is the same. Skipping in Mongo still walks every index entry it throws away. The cursor becomes a range on the sort field and the id, and I add a compound index in that same order.
- **"The orders table is split into one partition per month."**
  > Keyset still works. I also add a plain "created before the cursor time" condition. That lets the database skip the newer monthly partitions instead of checking each one.

### Follow-up questions
- **Why fetch one extra row?** To know if there is a next page without running a separate count. Ask for twenty one rows and return twenty. If the twenty first row exists, there is a next page.
- **Should the client be able to read the cursor?** No. Treat it as opaque, meaning the client just stores it and sends it back. Encode it, and validate it when it returns, because it is user input like anything else.
- **How does a "previous page" button work?** Flip the comparison to "before this row" and flip the sort direction. Then reverse the rows before returning them, so they still display newest first.
- **Optional: senior. Users report missing orders, and the cursor is built from a JavaScript date. Why?** A JavaScript date only keeps milliseconds, but Postgres keeps microseconds. The rounded cursor sits just before the real row, so rows created in the same millisecond get skipped. Build the cursor from the database's own text value of the timestamp, not from a date object.

### Common wrong answers and red flags
- "Just add an index." It speeds up page one, but offset still walks every skipped row on deep pages.
- "Cache the pages." Deep pages are rarely requested twice, and every new order makes cached pages stale.
- A cursor with only the timestamp. Orders with the same time get skipped or repeated.
- Building the cursor from a JavaScript `Date`, which drops microseconds, or reading the cursor without validating it.
- No upper limit on the page size, so one request can ask for a million rows.
- One combined query with a "this parameter is empty or matches" condition, such as `WHERE $1 IS NULL OR …`, for both the first and later pages. Use two separate queries so each gets a good plan.

### Numbers to quote
In a local test on five million orders, a deep offset page took more than a second, and the same depth with keyset took well under a millisecond.

### Code sketch
```js
// Query is a zod schema (limit, after); decodeCursor and encodeCursor convert [created_at text, id] to base64url and back
const ORDER = 'ORDER BY created_at DESC, id DESC';
const FIRST_PAGE = `SELECT id, total, created_at::text AS ts FROM orders ${ORDER} LIMIT $1`;
const NEXT_PAGE = `SELECT id, total, created_at::text AS ts FROM orders
  WHERE (created_at, id) < ($1::timestamptz, $2::bigint) ${ORDER} LIMIT $3`;

app.get('/orders', async (req, res) => {
  const q = Query.safeParse(req.query);                  // limit 1 to 100, default 20; cursor string
  const cur = q.success && q.data.after ? decodeCursor(q.data.after) : null; // [ts text, id] or null
  if (!q.success || (q.data.after && !cur)) return res.status(422).json({ error: 'Invalid query' });
  const { limit } = q.data;
  const { rows } = cur ? await pool.query(NEXT_PAGE, [...cur, limit + 1]) : await pool.query(FIRST_PAGE, [limit + 1]);
  const page = rows.slice(0, limit);
  res.json({ data: page, nextCursor: rows.length > limit ? encodeCursor(page.at(-1)) : null });
});
```

```sql
CREATE INDEX ON orders (created_at DESC, id DESC);
```

Verified by [verify-p1.mjs](code/pagination/verify-p1.mjs)

### Source
Lessons 65, 70, 73, 81.

---

## P2. The admin table needs page numbers and a total
**Tag: Likely**

### Before you speak
- **Today:** the screen shows page numbers and an exact total like "1 to 20 of 5,000,000". Every page load runs an exact count of the whole table.
- **What goes wrong:** Postgres cannot keep one stored row count, because transactions running at the same time can see different rows. So an exact count has to visit every row, and on millions of rows that takes hundreds of milliseconds on every request.
- **The fix, part one:** for the whole table, read the planner's estimate, a number the database already keeps for planning queries. It is almost free.
- **The fix, part two:** with filters, count only up to a cap, such as ten thousand, and show "more than ten thousand" beyond it. The Next button needs no count at all if you fetch one extra row.
- **The trade-off to mention:** the total shown is no longer exact. If someone truly needs an exact number, such as for billing, that belongs in a report or a background job, not a list screen.
- **Bonus idea for exact counts:** keep a counter table updated in the same transaction as each insert. If one customer is very busy, split their counter into several slot rows so inserts do not all wait on one row.

### Scenario
"Our SaaS dashboard has an admin orders screen with numbered pages and 'showing 1 to 20 of 5,000,000'. The count query alone takes hundreds of milliseconds, and the ops team says the screen feels slow. What would you do?"

### Questions to ask back
- **Does anyone need the exact total?** If it is only a label, an estimate or "more than ten thousand" is enough.
- **How deep do admins really go?** If they stay in the first few pages, offset with a limit on depth is fine.
- **Are there filters on the screen?** The table-wide estimate ignores filters, so a filtered total needs a capped count instead.
- **How fresh must the number be?** If a minute old is fine, I can cache it.

### Spoken answer
> I would keep page numbers, because admins want them and rarely go deep. The slow part is the exact total. The database cannot keep one stored count that every transaction agrees on, so an exact count visits the rows. I stop counting exactly on every request. For the whole table, I read the planner's row estimate, which is almost free. With filters, I count only up to a cap, and past it I show "more than" that cap. The Next button needs no count at all, because I fetch one extra row. The trade off is that the total is no longer exact. If someone needs an exact number for billing, that is a report, not a list screen.

### Say it in 5 beats
1. Keep page numbers, cap the depth.
2. An exact count visits every row.
3. Whole table: the planner's estimate.
4. With filters: a capped count.
5. Exact numbers belong in reports.

### Case variations
- **"The count has a status filter."**
  > The table estimate knows nothing about filters, so it cannot answer "how many paid orders". I use the capped count instead. A filtered exact count is actually the slowest case, because it checks every row's status.
- **"An admin clicks the last page."**
  > That is the deepest possible offset, so it is the slowest page. I cap the page number, or offer an "oldest first" sort. Then the last page becomes page one of the reversed list.
- **"The data is in MongoDB."**
  > Mongo has the same split. The exact count scans every matching document. The estimated count reads collection metadata, takes no filter, and returns almost instantly.
- **"Finance needs the exact number for billing."**
  > Then it should not come from a list screen. I compute it in a background job or a report query. Or I keep a counter table that is updated in the same transaction as each insert, so the number is always exact and cheap to read.

### Follow-up questions
- **Why can't the database just store the row count?** Because of how it handles transactions running at the same time. An open transaction keeps seeing the rows that existed when it started, while another one already sees a new insert. There is no single true count to store.
- **How fresh is the planner estimate?** Only as fresh as the last statistics run. After a big import, the estimate keeps the old number until statistics are refreshed, which normally happens automatically in the background.
- **Can I run the count and the page query in parallel?** Yes. That saves waiting time for the user, but the database still does the same amount of work.
- **Optional: senior. You need an exact, fast count per customer, and big customers create orders constantly.** I would keep a counter table updated in the same transaction as each insert. With one row per customer, every insert waits for that row's lock, so it becomes a hot row. I split each counter into several slot rows, pick a slot at random in the application on each insert, and sum the slots when reading.

### Common wrong answers and red flags
- Running an exact `count(*)` on every page load "because the UI shows it".
- "Add an index so the count is fast." Counting the whole table still visits every row.
- No limit on the page number, so one request can ask for a huge offset.
- Comparing the count with `<` in JavaScript without noticing the driver returned it as a string.
- Picking the random slot inside the database with `random()` in the `UPDATE`'s `WHERE`. It is evaluated once per row, can match several rows, and can deadlock. Pick the slot in the application.

### Numbers to quote
In a local test on five million rows, a count capped at ten thousand rows was more than five times faster than the exact count.

### Code sketch
```sql
SELECT reltuples::bigint AS n FROM pg_class WHERE relname = 'orders';      -- whole-table estimate
SELECT count(*)::int AS n FROM (SELECT 1 FROM orders WHERE status = $1 LIMIT 10001) s;  -- capped

-- hot counter split into slots; the app picks $2 at random
UPDATE order_counts SET n = n + 1 WHERE customer_id = $1 AND slot = $2;
SELECT sum(n) FROM order_counts WHERE customer_id = $1;
```

Verified by [verify-p2.mjs](code/pagination/verify-p2.mjs)

### Source
Lessons 65, 75, 81.

---

## P3. Users choose the sort column and add filters
**Tag: Must know**

### Before you speak
- **Today:** the API lets users sort and filter through query parameters, and the code puts the sort value from the URL straight into the query.
- **Bug one, ties:** many orders have the same total. When you sort only by total, the database is free to return tied rows in any order, and it can pick a different order for page one than for page two. So the same order shows up on both pages, and another one is skipped.
- **Fix for bug one:** always end the sort with the unique id. Then every row has exactly one position, and pages never overlap.
- **Bug two, injection:** column names cannot be sent as query parameters, so developers often paste the sort string into the query text. A user can then send anything, including SQL.
- **Fix for bug two:** an allow-list. The API accepts a few public names, maps each one to a real column, and rejects everything else.
- **Speed:** each allowed sort needs an index that starts with the filter column, then the sort columns, then the id. Then the database reads one page from the index instead of sorting every matching row.
- **The trade-off to mention:** one index per allowed sort. Indexes cost disk space and slow down writes, so the list of sorts stays short.

### Scenario
"Our orders API now accepts `?status=paid&sort=-total`. A customer notices the same order on page one and page two, and a security review flags the sort parameter. Walk me through both problems."

### Questions to ask back
- **Which sort fields does the UI really need?** Each one needs its own index, so I want the shortest useful list.
- **Which filters are used together with which sorts?** The index puts the filter column first, then the sort columns, so I need to know the common pairs.
- **Is this screen offset or cursor based?** Ties break both. A cursor also has to carry the sort column, not just the id.

### Spoken answer
> There are two bugs here. First, ties. Many orders share the same total. If you sort only by total, tied rows can come back in a different order each time, so page one and page two can overlap. Always add the id as the last sort column so the order is fixed. Second, security. The sort value from the URL must never go into the query text. I keep an allow list that maps public names to real columns, and reject anything else. Every allowed sort gets an index that starts with the filter, then the sort columns, so the database reads one page instead of sorting everything. The trade off is one index per allowed sort, so the list stays short.

### Say it in 5 beats
1. Ties make pages overlap.
2. Always end the sort with the id.
3. Never paste the sort string in.
4. Allow-list maps public names to columns.
5. Index: filter first, then sort columns.

### Case variations
- **"Users want to sort by customer name, which lives in another table."**
  > Then the database must join the two tables and sort every matching row before it can return one page, which is slow on a big table. I would copy the customer name onto the order row, or only allow that sort when other filters keep the result small.
- **"There are ten filters, in any combination."**
  > You cannot build an index for every combination. I index the common ones, require at least one filter that narrows the result a lot, and cap the page size. Beyond that, a search engine is the better tool.
- **"Users want ascending as well as descending."**
  > One index can be read backwards, so it serves both directions as long as every column flips together. If one column goes up while another goes down, the database needs an extra sort step.
- **"A client sends the sort parameter twice."**
  > Newer Express versions turn a repeated query key into an array. The schema must expect a single string and reject the array, otherwise the code may crash or behave oddly.

### Follow-up questions
- **Does a query builder make the sort safe?** It makes values safe, because it sends them as parameters. Column names are part of the query text, so they still have to come from your own allow-list.
- **Can I send the sort column as a query parameter?** The query runs, but it sorts by a constant string, the same for every row, so the order means nothing. Column names cannot be parameters.
- **What does "index only scan" mean in a query plan?** Every column the query needs is stored in the index, so the database answered from the index alone and never read the table.
- **Optional: senior. The sort column allows empty values, called nulls.** In descending order, nulls often come first. A comparison with a null is never true, so a cursor that lands on a null row returns nothing after it, and the rest of the list disappears. Make the column not null, or use the same fallback value in the index, the sort and the cursor.

### Common wrong answers and red flags
- Putting `req.query.sort` straight into the `ORDER BY` text with a template string.
- Sorting without a unique tiebreaker at the end.
- "Index every column separately." Separate one-column indexes do not serve a filter and a sort together.
- Writing an allow-list map but never actually using it in the real query.

### Numbers to quote
In a local test, two pages sorted only by total shared several rows, and with the id added they shared none.

### Code sketch
```js
const SORTS = { createdAt: 'created_at', total: 'total' };   // public name to real column

export function orderBy(sortParam = '-createdAt') {
  const desc = sortParam.startsWith('-');
  const column = SORTS[desc ? sortParam.slice(1) : sortParam];
  if (!column) return null;                                  // caller answers 422
  const dir = desc ? 'DESC' : 'ASC';
  return `ORDER BY ${column} ${dir}, id ${dir}`;             // id keeps pages stable
}
```

```sql
CREATE INDEX ON orders (status, total DESC, id DESC);
SELECT id, total FROM orders WHERE status = $1 ORDER BY total DESC, id DESC LIMIT 20;                       -- first page
SELECT id, total FROM orders WHERE status = $1 AND (total, id) < ($2, $3) ORDER BY total DESC, id DESC LIMIT 20; -- next
```

Verified by [verify-p3.mjs](code/pagination/verify-p3.mjs)

### Source
Lessons 65, 70, 71.

---

## P4. A type-ahead admin search over 2 million users
**Tag: Likely**

### Before you speak
- **Today:** every keystroke in the search box sends a request, and the API searches two million emails each time.
- **Client problem one:** typing "anish" sends five requests when only the last one matters. That is wasted load.
- **Client problem two:** requests can finish out of order. If the request for "an" finishes after the one for "anish", the box shows the wrong results. That is a race condition.
- **Client fix:** debounce, which means wait until typing pauses before calling the API. Then cancel the previous request whenever a new one starts, so an old answer can never overwrite a newer one.
- **Server problem:** a normal text index follows language rules, so the database cannot use it for "starts with". It reads every row instead.
- **Server fix:** index the lowercased email in plain character order. That one index serves the prefix match, the sort and the "show more" cursor, so even a one-letter search reads just one page. A "contains" search needs a trigram index instead.
- **The trade-off to mention:** trigram indexes are large and make every insert slower.

### Scenario
"Support staff on our SaaS admin panel search users by email in a type-ahead box. Each keystroke calls the API, and with two million users a search takes about a third of a second. The box feels laggy, and sometimes it shows results for an older query. How would you fix it, on the API and on the client?"

### Questions to ask back
- **Starts-with or contains?** A starts-with search can use an ordered index. A contains search needs a trigram index or a search engine.
- **Should it ignore upper and lower case?** Then I index the lowercased email and search the lowercased text the same way.
- **How many results does the dropdown show?** Usually ten, so pagination here means a "show more" link, not page numbers.

### Spoken answer
> I would fix both sides. On the client, I wait until typing pauses before calling the API, and I cancel the previous request when a new one starts. That stops flicker, because an old slow answer can never replace a newer one. On the API, I return a small page and use a cursor for show more. The big win is the index. For a starts-with search, I index the lowercased email in plain character order. Then one index serves the prefix match, the sort, and the cursor, so even a single letter reads just one page. For a contains search, a normal index does nothing, so I add an index built for searching inside words. The trade off is that such indexes are big and make writes slower.

### Say it in 5 beats
1. Wait until typing pauses.
2. Cancel the stale request.
3. Small page plus a cursor.
4. Plain-order index: match, sort, cursor.
5. Trigram index only for contains.

### Case variations
- **"Results flicker, or show the list for an older query."**
  > That is a race. An older request finished after a newer one and overwrote it. I cancel the old request when a new one starts, and I also check that the answer belongs to the current text before showing it.
- **"Searching for a single letter is still slow."**
  > With the usual pattern index, the database finds the matches quickly but then has to sort all of them in language order before returning ten. One letter matches a lot of rows, so that sort is expensive. When the index, the sort and the cursor all use plain character order, it reads ten entries from the index and stops.
- **"The admin types a percent sign."**
  > In a pattern search the percent sign is a wildcard, so a lone percent matches every user. I escape percent and underscore before building the pattern, so they are treated as normal characters.
- **"Now they want to search by name or email."**
  > Two indexes can work for two fields, but it gets messy fast. Past a few fields, I would move search to a dedicated search engine and keep the database as the source of truth.

### Follow-up questions
- **Why does a normal index not help a starts-with search?** A normal text index is ordered by language rules, called the collation, not by raw characters. The planner cannot safely use that order for a prefix match, so it reads every row. An index in plain character order can be used.
- **Is plain character order a problem for emails?** Not after lowercasing, because emails are mostly plain letters and digits. For people's names with accents, plain order can look wrong to users.
- **Debounce or throttle?** Debounce. You want one call after typing pauses. Throttle would send one call every interval while the user is still typing.
- **Optional: senior. The trigram index slows down sign-ups.** By default this kind of index buffers new entries in a pending list, which keeps inserts fast. Searches then have to scan that list too, until a vacuum merges it into the index. If sign-ups are heavy, I tune vacuum for that table, or move search to its own service.

### Common wrong answers and red flags
- A "contains" search like `ILIKE '%' || $1 || '%'` on millions of rows with no trigram index.
- A pattern index combined with an `ORDER BY` in the database's default collation. Short prefixes then sort every match.
- One API call per keystroke, with no debounce and no cancellation.
- Not escaping `%` and `_` in the user's text.

### Numbers to quote
In a local test on two million emails, a one-letter search took more than a hundred milliseconds with the pattern index and under a millisecond with the plain character order index.

### Code sketch
```js
export function createSearch(fetchFn, onResults, waitMs = 250) {
  let timer, controller;
  return (text) => {
    clearTimeout(timer);                                   // debounce
    timer = setTimeout(async () => {
      controller?.abort();                                 // cancel the stale request
      controller = new AbortController();
      try {
        const res = await fetchFn(`/admin/users?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        onResults(text, await res.json());
      } catch (err) { if (err.name !== 'AbortError') throw err; }
    }, waitMs);
  };
}
```

```sql
CREATE INDEX users_email_c ON users ((lower(email) COLLATE "C"), id);
-- $1 = escaped text || '%'
SELECT id, email FROM users WHERE lower(email) COLLATE "C" LIKE $1
  ORDER BY lower(email) COLLATE "C", id LIMIT 10;                                    -- first page
SELECT id, email FROM users WHERE lower(email) COLLATE "C" LIKE $1
  AND (lower(email) COLLATE "C", id) > ($2, $3) ORDER BY lower(email) COLLATE "C", id LIMIT 10;  -- show more
CREATE INDEX users_email_trgm ON users USING gin (lower(email) gin_trgm_ops);         -- contains search
```

Unverified: the client was run with Node's built-in fetch, not in a browser.
Verified by [verify-p4.mjs](code/pagination/verify-p4.mjs)

### Source
Lessons 22, 65, 66.
