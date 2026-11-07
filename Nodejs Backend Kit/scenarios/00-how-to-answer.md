# 00. How to answer a scenario question

A scenario question is not a quiz. The interviewer wants to hear how you think: what you ask, what you would build first, what it costs, and how you would know it works. Use these five steps every time. Speak one or two sentences per step.

## The five steps

1. **Clarify.** Ask one or two questions that change the design. "Do users need page numbers, or only next and previous?" is useful. "What database do you use?" usually is not, unless the answer changes your plan. Each scenario lists "Questions to ask back" and why each answer matters. If they say "you decide", say your assumption out loud and keep going.
2. **Name the problem.** Say what is going wrong, in plain words. "Offset still walks every row it skips, so deep pages get slower" shows you know the cause, not just the fix.
3. **Give the simple solution.** Start with what most teams would ship. Add detail only if asked. One clear example beats three abstractions.
4. **Say the trade-off.** End with what the fix costs: "The trade off is that you lose page numbers." Interviewers remember this sentence. Every spoken answer in this bank ends this way.
5. **Say how you would verify it.** "I would check the query plan before and after, and load test the deep pages." That turns an opinion into engineering.

Then stop. Let them pick the next direction. Use "Case variations" and "Follow-up questions" to prepare for where they usually go.

## Bad and good phrasing

The same idea can sound vague or sharp. Two examples from the pagination scenario.

**A clarify question**

- Bad: "What are the requirements?" It is too broad. The interviewer has to do your thinking for you.
- Bad: "Which database version are you on?" The answer rarely changes your design, so it wastes a turn.
- Good: "Do customers need to jump to a page number, or do they only scroll forward?" Each answer leads to a different design, and the question shows you already see the two options.

**A trade-off**

- Bad: "There are some trade-offs, but it is much better." It names no cost, so it sounds like you have not found one.
- Bad: "Keyset is always better than offset." It sounds sure, but it is wrong for small tables and for screens that need page numbers.
- Good: "The trade off is that you lose page numbers. You can only move forward or back, which is fine for a feed. For a small admin table, I would keep offset." It names the cost, says when the cost does not matter, and says when you would choose differently.

## Saying "I would" without claiming experience

Answer as a competent developer would: "I would start by...", "The first thing I check is...", "My default is...". That is honest, and it matches the question.

Do not invent history. Never describe past projects or production incidents unless they are true. If asked "have you done this?", say: "Not at this scale. Here is how I would approach it, and here is what I would watch for." A clear plan plus honest limits scores better than a story that falls apart.

## Using numbers

Quote at most one or two figures, and only ones you can back up. The "Numbers to quote" lines come from local scripts in [code/](code/). Run the script once before saying "in a local test", so the number is yours to defend. Otherwise describe the shape: "much slower on deep pages", "flat memory instead of growing".

## When you do not know

1. Say so briefly: "I have not used that directly."
2. Reason from what you do know: "It sounds like a cache in front of the database. If so, I would worry about stale data and stampedes."
3. Say how you would find out: "I would check the docs for its consistency guarantees and test it with a small script."

Never bluff a specific API, flag, or number. Interviewers probe exactly there.

## Worked example: P1, the slow orders endpoint

> "Our orders endpoint uses page and limit. With five million rows, deep pages take more than a second. How would you fix it?"

1. **Clarify:** "Do customers need to jump to a page number, or do they only go next? And what is the list sorted by?" Suppose they say only next, newest first.
2. **Name the problem:** "Offset tells the database to skip rows, but it still walks every skipped row, so deep pages keep getting slower."
3. **Simple solution:** "I would switch to keyset pagination. The client sends a cursor with the last row's time and id, and I ask for rows after that point, with an index on the same two columns. A deep page then costs the same as the first page."
4. **Trade-off:** "The trade off is losing page numbers. You can only move forward or back, which suits a feed. For a small admin table, offset is still fine."
5. **Verify:** "I would compare the query plan for a deep offset page and a deep keyset page, and check that no rows repeat or go missing when new orders arrive while paging."

The full scenario, with variations and follow-ups, is [P1 in 01-pagination.md](01-pagination.md#p1-the-orders-endpoint-gets-slow-at-5-million-rows).
