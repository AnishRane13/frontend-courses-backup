# 01. Pagination, filtering and sorting

> **Remember this**
> 1. Offset walks every row it skips. Keyset jumps to "after this row" through an index, so depth costs nothing.
> 2. A cursor holds every sort column plus the unique id, built from the database's exact value, and is validated like any input.
> 3. Every sort ends with the id as a tiebreaker. Without it, pages overlap.
> 4. Sort and filter only through an allow-list mapped to indexed columns. Values are parameters. Column names never come from the client.
> 5. Exact totals on big tables are expensive. Show an estimate or "more than N" unless someone truly needs the exact number.

Run the scripts listed in each Code sketch once before saying "in a local test".

| # | Scenario | Tag |
|---|---|---|
| P1 | [The orders endpoint gets slow at 5 million rows](#p1-the-orders-endpoint-gets-slow-at-5-million-rows) | Must know |
| P2 | [The admin table needs page numbers and a total](#p2-the-admin-table-needs-page-numbers-and-a-total) | Likely |
| P3 | [Users choose the sort column and add filters](#p3-users-choose-the-sort-column-and-add-filters) | Must know |
| P4 | [A type-ahead admin search over 2 million users](#p4-a-type-ahead-admin-search-over-2-million-users) | Likely |

---

## P1. The orders endpoint gets slow at 5 million rows
**Tag: Must know**

### Scenario
"Our e-commerce orders endpoint uses page and limit. It was fine at launch, but the table now has five million rows, and customers who scroll deep into their history wait more than a second. How would you fix the pagination?"

### Questions to ask back
- **Do users need to jump to a page number, or only go next and previous?** Only next means keyset. A real need for page 47 means I keep offset for shallow pages and cap the depth.
- **What is the list sorted by?** Keyset needs a sort that ends in a unique column. Newest first becomes created at, then id.
- **Is page one slow too?** Then the problem is a missing index, not offset.
- **Do other clients call this API?** Then the cursor is a contract change, so I add it next to page, or version it.

### Spoken answer
> I would move from offset to keyset pagination. Offset tells the database to skip a number of rows and then return a page. It still walks every skipped row, so deep pages keep getting slower. Keyset asks for the rows that come after the last row the user saw. The client sends that position back as a cursor, which holds the last row's time and id. With an index on those two columns, the database jumps straight to that spot, so a deep page costs the same as the first one. For a small admin table, offset is still fine. The trade off is that you lose page numbers, so you can only move forward or back. That suits feeds and infinite scroll.

### Say it in 5 beats
1. Offset walks every skipped row.
2. Keyset: rows after the last one seen.
3. Cursor is time plus id, opaque, validated.
4. Index on the same columns as the sort.
5. Trade-off: no page numbers.

### Case variations
- **"Rows are inserted while the user pages."**
  > With offset, a new row at the top pushes everything down by one, so the next page repeats a row. Keyset is anchored to a real row, so new rows above it change nothing.
- **"Product says users must jump to page 50."**
  > Then I keep offset on that screen, cap how deep you can go, and make sure the sort is indexed. Shallow pages are cheap. It is the very deep pages that hurt.
- **"The data is in MongoDB."**
  > Same idea. Skipping still walks every index entry it throws away. The cursor becomes a range on the sort field and the id, with a compound index in the same order, written as an "or" of two cases because Mongo has no row comparison.
- **"The table is partitioned by month."**
  > Keyset still works. I add a plain "created before the cursor time" condition next to the row comparison, because the row comparison alone does not let the database skip the newer partitions.

### Follow-up questions
- **Why fetch one extra row?** To know whether a next page exists without running a count. Ask for twenty one, return twenty.
- **Should the client be able to read the cursor?** Treat it as opaque. Encode it, validate it when it comes back, and never trust it as SQL.
- **How does "previous page" work?** Flip the comparison and the sort direction, then reverse the rows before returning them.
- **Optional: senior. Users report missing orders, and the cursor is built from a JavaScript date. Why?** A JavaScript date keeps milliseconds, but Postgres keeps microseconds. The rounded cursor sits just before the real row, so rows in the same millisecond are skipped. Build the cursor from the database's own text value of the timestamp.

### Common wrong answers and red flags
- "Add an index." It helps page one. Offset still walks every skipped row.
- "Cache the pages." Deep pages are rarely hit twice, and every insert makes them stale.
- A cursor with only the timestamp, so ties are skipped or repeated.
- A cursor built from a JavaScript `Date`, or parsed with no validation. Lesson 65's own example does both.
- No ceiling on `limit`.
- One catch-all query such as `WHERE $1 IS NULL OR …` for first and later pages.

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

### Scenario
"Our SaaS dashboard has an admin orders screen with numbered pages and 'showing 1 to 20 of 5,000,000'. The count query alone takes hundreds of milliseconds, and the ops team says the screen feels slow. What would you do?"

### Questions to ask back
- **Does anyone need the exact total?** If it is only a label, an estimate or "more than ten thousand" is enough.
- **How deep do admins really go?** If they stay in the first few pages, offset with a depth cap is fine.
- **Are there filters?** A filtered total cannot use the table-wide estimate, so I cap the count instead.
- **How fresh must the number be?** If a minute old is fine, I cache it.

### Spoken answer
> I would keep page numbers, because admins want them and rarely go deep. The slow part is the exact total. Postgres cannot keep one stored count, because transactions running at the same time can see different rows, so it has to visit them all. So I stop counting exactly on every request. For the whole table, I read the planner's own row estimate, which is almost free. With filters, I count only up to a cap, and past it I show "more than" that cap. The Next button needs no count at all, because I fetch one extra row. The trade off is that the total is no longer exact. If someone needs an exact number for billing, that is a report, not a list screen.

### Say it in 5 beats
1. Keep page numbers, cap the depth.
2. An exact count visits every row.
3. Whole table: the planner's estimate.
4. With filters: a capped count.
5. Exact numbers belong in reports.

### Case variations
- **"The count has a status filter."**
  > The table estimate knows nothing about filters, so I use the capped count. A filtered exact count is the slowest variant, because it reads every row to check the status.
- **"An admin jumps to the last page."**
  > That is the deepest offset, the worst case. I cap the page number, or offer "oldest first", so the last page becomes the first page of a reversed sort.
- **"The data is in MongoDB."**
  > Mongo has the same split. The exact count scans the matching documents. The estimated count reads collection metadata, takes no filter, and is almost instant.
- **"The number must be exact for billing."**
  > Then I compute it in a job or a report query, or keep a counter table updated in the same transaction as the insert. The list screen stays fast either way.

### Follow-up questions
- **Why can't Postgres just store the row count?** An open transaction keeps seeing the rows that existed when it started, while another one already sees a new insert. There is no single true count to store.
- **How fresh is the planner estimate?** Only as fresh as the last statistics run. After a big import it keeps the old number until statistics are refreshed, which autovacuum normally does.
- **Can I run the count and the page query in parallel?** Yes, lesson 65 does that. It saves wall time, not database work.
- **Optional: senior. You need an exact, fast count per customer, and big customers create orders constantly.** A counter table updated in the same transaction as each insert. One row per customer becomes a hot spot, because every insert waits for its lock. Split it into several slot rows, pick a slot at random in the application on each insert, and sum the slots when reading.

### Common wrong answers and red flags
- An exact `count(*)` on every page load "because the UI shows it".
- "Add an index so count is fast." An unfiltered count still visits every row.
- No cap on `page`, so one request can ask for a ten-million-row offset.
- Comparing the count with `<` in JavaScript without noticing pg returned it as a string.
- Picking the slot with `random()` inside the `UPDATE`'s `WHERE`. It runs once per row, can hit several rows, and deadlocked in a local test.

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

### Scenario
"Our orders API now accepts `?status=paid&sort=-total`. A customer notices the same order on page one and page two, and a security review flags the sort parameter. Walk me through both problems."

### Questions to ask back
- **Which sort fields does the UI really need?** Each one needs an index, so the list should be short.
- **Which filters go with which sorts?** The index puts the equality filter first, then the sort columns.
- **Offset or cursor on this screen?** Ties break both. A cursor also has to carry the sort column.

### Spoken answer
> There are really separate bugs here. The first is ties. Many orders share the same total, and if you sort only by total, the database may return tied rows in a different order each time. So page one and page two can overlap. The fix is to always add the id as the last sort column. Then the order is fixed. The second bug is security. The sort value from the URL must never go into the query text. I keep an allow list that maps public names to real columns, and reject anything else. Every allowed sort gets an index that starts with the filter, then the sort columns, so the database reads one page instead of sorting everything. The trade off is one index per allowed sort, so the list stays short.

### Say it in 5 beats
1. Ties make pages overlap.
2. Always end the sort with the id.
3. Never put the sort string into SQL.
4. Allow-list of public names to columns.
5. Index: filter first, then sort columns.

### Case variations
- **"Sort by customer name, which lives in another table."**
  > Then the database must join and sort everything before it can return a page, and it falls back to a full scan. I would copy the name onto the order, or allow that sort only with tight filters.
- **"Ten filters in any combination."**
  > You cannot index every combination. I index the common ones, require at least one selective filter, and cap the page size. Beyond that, a search engine is the better tool.
- **"Sort ascending as well as descending."**
  > One index can be read backwards, so it serves both directions as long as every column flips together. If the directions are mixed, the database needs an extra sort step.
- **"The client sends the sort parameter twice."**
  > Express 5 turns a repeated key into an array. The schema must expect a single string and reject the array.

### Follow-up questions
- **Does a query builder make the sort safe?** It makes values safe. Column names still have to come from your own allow list.
- **Can I pass the sort column as a query parameter?** It runs, but it sorts by a constant string, so the order is meaningless. Column names cannot be parameters.
- **What does "index only scan" mean in a plan?** Every column the query needs is in the index, so the table itself was never read.
- **Optional: senior. The sort column allows NULLs.** In descending order Postgres puts NULLs first. A row comparison with a NULL is never true, so a cursor that lands on a NULL row returns nothing after it, and the rest of the list disappears. Make the column not null, or use the same fallback value in the index, the sort and the cursor.

### Common wrong answers and red flags
- Template-stringing `req.query.sort` into `ORDER BY`.
- A sort with no unique tiebreaker.
- "Index every column." Single-column indexes do not serve `WHERE status = … ORDER BY total`.
- Copying lesson 65's `SORTABLE` map as is. It is defined there but never used.

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

### Scenario
"Support staff on our SaaS admin panel search users by email in a type-ahead box. Each keystroke calls the API, and with two million users a search takes about a third of a second. The box feels laggy, and sometimes it shows results for an older query. How would you fix it, on the API and on the client?"

### Questions to ask back
- **Starts-with or contains?** Starts-with can use an ordered index. Contains needs a trigram index or a search engine.
- **Case-insensitive?** Then I index the lowercased email and query it the same way.
- **How many results does the dropdown show?** Usually ten, so pagination is "show more", not page numbers.

### Spoken answer
> I would fix both sides. On the client, I wait until the person stops typing for a moment before calling the API, and I cancel the previous request whenever a new one starts. That stops the flicker, because an old, slow answer can never replace a newer one. On the API, I return a small page and use a cursor for show more. The big win is the index. For a starts-with search, I index the lowercased email in plain character order. Then one index serves the prefix match, the sort and the cursor, so even a single letter reads just one page. For a contains search, a normal index does nothing, so I add an index built for searching inside words. The trade off is that such indexes are big and make writes slower.

### Say it in 5 beats
1. Debounce on the client.
2. Cancel the stale request.
3. Small page plus a cursor.
4. One plain-order index: match, sort, cursor.
5. Trigram index only for contains.

### Case variations
- **"Results flicker, or show the list for an older query."**
  > That is a race. An older request finished after a newer one. Cancelling the old request fixes it, and I also check that the answer belongs to the current text before rendering.
- **"A one-letter search is still slow."**
  > With the usual pattern index, the database finds the matches fast but then sorts all of them in language order before returning ten. When the index, the sort and the cursor all use plain character order, it reads ten entries and stops.
- **"The admin types a percent sign."**
  > Without escaping, it becomes a wildcard, and a lone percent matches every user. I escape percent and underscore so they are literal characters.
- **"Search by name or email."**
  > Two indexes can work, but it gets messy fast. Past two or three fields, I move search to a search engine and keep Postgres as the source of truth.

### Follow-up questions
- **Why does a normal index not help a starts-with search?** With a language-aware collation like English, a normal index is ordered by language rules, not raw characters, so the planner cannot use it for a prefix match. A pattern index or a plain character order index compares character by character, so it can.
- **Is plain character order a problem for emails?** Not after lowercasing, because emails are mostly plain letters and digits. For people's names with accents, the order would look wrong to users.
- **Debounce or throttle?** Debounce. One call after typing pauses, not one call every interval while typing.
- **Optional: senior. The trigram index slows down sign-ups.** By default the index buffers new entries in a pending list, which keeps inserts fast, but searches must scan that list until a vacuum merges it. If sign-ups are heavy, tune vacuum for that table, or move search to its own service.

### Common wrong answers and red flags
- `ILIKE '%' || $1 || '%'` on two million rows with no trigram index.
- A pattern index with an `ORDER BY` in the database's default collation. Short prefixes then sort every match.
- One API call per keystroke, no debounce, no cancellation.
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
