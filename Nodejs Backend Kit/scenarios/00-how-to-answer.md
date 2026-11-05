# 00. How to answer a scenario question

A scenario question is not a quiz. The interviewer wants to hear how you think: what you ask, what you would build first, what it costs, and how you would know it works. Use the same five steps every time. Each step is one or two sentences when you speak.

## The five steps

1. **Clarify.** Ask one or two questions that change the design. "Do users need page numbers, or only next and previous?" is a good question. "What database do you use?" usually is not, unless the answer changes your plan. Each scenario in this bank lists "Questions to ask back" with how each answer changes the design. If the interviewer says "you decide", state your assumption out loud and continue.
2. **Name the problem.** Say what is actually going wrong, in plain words. "Offset still walks every row it skips, so deep pages get slower" shows you understand the cause, not just the fix.
3. **Give the simple solution.** Start with the approach most teams would ship, then add detail only if asked. One example beats three abstractions.
4. **Say the trade-off.** Every answer ends with what the solution costs: "The trade off is that you lose page numbers." This is the sentence interviewers remember. The spoken answers in this bank all end this way.
5. **Say how you would verify it.** "I would check the query plan before and after, and load test the deep pages." This turns an opinion into an engineering answer.

Then stop. Let the interviewer pick the next direction. The "Case variations" and "Follow-up questions" sections prepare you for where they usually go.

## Saying "I would" without claiming experience

Answer as the approach a competent developer would take: "I would start by...", "The first thing I check is...", "My default is...". This is honest and it is what the question asks for.

Do not invent history. Never describe past projects, systems you worked on, or production incidents unless they are true. If the interviewer asks "have you done this?", answer directly: "Not at this scale. Here is how I would approach it, and here is what I would watch for." A clear approach plus honest limits scores better than a story that falls apart under the next question.

## Using numbers

Quote at most one or two figures, and only ones you can back up. The "Numbers to quote" lines come from local scripts in [code/](code/). Run the script once before saying "in a local test", so the number is yours to defend. Otherwise describe the shape: "much slower on deep pages", "flat memory instead of growing".

## When you do not know

1. Say so briefly: "I have not used that directly."
2. Reason from what you do know: "It sounds like a cache in front of the database. If so, I would worry about stale data and stampedes."
3. Say how you would find out: "I would check the docs for its consistency guarantees and test it with a small script."

Never bluff a specific API, flag or number. Interviewers probe exactly there.

## Worked example: P1, the slow orders endpoint

> "Our orders endpoint uses page and limit. With five million rows, deep pages take more than a second. How would you fix it?"

1. **Clarify:** "Do customers need to jump to a page number, or do they only go next? And what is the list sorted by?" Suppose they say only next, newest first.
2. **Name the problem:** "Offset tells the database to skip rows, but it still walks every skipped row, so deep pages keep getting slower."
3. **Simple solution:** "I would switch to keyset pagination. The client sends a cursor with the last row's time and id, and I ask for rows after that point, with an index on the same two columns. A deep page then costs the same as the first page."
4. **Trade-off:** "The trade off is losing page numbers. You can only move forward or back, which suits a feed. For a small admin table, offset is still fine."
5. **Verify:** "I would compare the query plan for a deep offset page and a deep keyset page, and check that no rows repeat or go missing when new orders arrive while paging."

The full scenario, with variations and follow-ups, is [P1 in 01-pagination.md](01-pagination.md#p1-the-orders-endpoint-gets-slow-at-5-million-rows).
