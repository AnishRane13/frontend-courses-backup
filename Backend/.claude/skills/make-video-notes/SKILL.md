---
name: make-video-notes
description: Turn a course/playlist video's title and transcript into an in-depth, well-formatted Word document (.docx) note file, numbered to match the playlist (e.g. "7. Serialization and Deserialization for backend engineers.docx"). Use when the user pastes a video title + transcript and asks to make notes, create notes for a video, turn a transcript into notes, or add notes to a course/playlist notes collection (e.g. the "Backend from First Principles" playlist).
---

Paths below are relative to the repo root (`/home/anish/codes/Backned`), not to
this skill directory.

## What this does

Given a video's **number**, **title**, and **transcript**, produce one
`.docx` note file named `<number>. <Video Title>.docx` in the repo root,
matching the style of `What_is_Backend.docx` (title, colored headings,
bullet/numbered lists, tables, bold/italic, blockquote callouts).

The notes are **not** a reformatted transcript. Rewrite the transcript into
clear, in-depth notes: fix rambling/spoken phrasing, add structure (headings,
lists, tables where useful).

**Always supplement with your own knowledge, not just what's in the
transcript.** The transcript is a starting point, not a ceiling. If the
video glosses over something, states it imprecisely, or skips a detail a
learner would need, add it — better explanations, correct terminology,
extra examples, edge cases, comparisons to related concepts, common
pitfalls, or context the instructor assumed but didn't say. Where the
transcript's phrasing is already accurate and clear, keep it; where it's
thin, incomplete, or slightly off, don't just clean up the grammar —
actually improve and extend the explanation. The goal is for each doc to
stand alone as a proper reference someone could learn from even without
watching the video, not a polished transcript. Use judgment on how much
to add — enough to make the topic genuinely well-explained, without
padding or going off on tangents unrelated to the video's scope.

Length depends on the material: long enough to genuinely explain it, no
fluff.

## Run (agent path)

1. Draft the notes as Markdown in the small dialect the driver understands
   (see below). Write it to a scratch file, e.g.
   `/tmp/claude-*/scratchpad/notes.md`.
2. Render it to the final docx:

   ```bash
   python3 .claude/skills/make-video-notes/driver.py \
     /tmp/claude-*/scratchpad/notes.md \
     "<N>. <Video Title>.docx"
   ```

   This writes the docx directly into the repo root (cwd), matching where
   `What_is_Backend.docx` already lives.
3. Sanity-check the result before telling the user it's done:

   ```bash
   python3 -c "
   from docx import Document
   d = Document('<N>. <Video Title>.docx')
   print(d.paragraphs[0].text)   # should be the title
   print(len(d.paragraphs), 'paragraphs,', len(d.tables), 'tables')
   "
   ```

### Markdown dialect the driver understands

```
# Title line              -> Document title (large, centered)
*Italic line right after* -> Subtitle (must immediately follow the title line)
## Heading                -> Heading 1
### Heading                -> Heading 2
#### Heading                -> Heading 3
- item                      -> Bullet
  - item                    -> Sub-bullet (indent 2+ spaces)
1. item                     -> Numbered list (any number works, Word renumbers)
> text                      -> Callout paragraph (indented, italic, gray)
| a | b |                   -> Table row
|---|---|                   -> Header separator row (required under the header)
```lang                      -> Fenced code block: verbatim, shaded, monospace,
...code, multi-line ok...       line breaks preserved, NO inline parsing inside
```
---                         -> Horizontal divider
blank line                  -> Paragraph break
```

Inline, anywhere in the above: `**bold**`, `*italic*` / `_italic_`, single
backtick `code`. Use a fenced block (triple backtick) instead of inline
backticks for anything multi-line — request/response examples, JSON
payloads, pseudocode. Inline single-backtick code is for short, one-line
snippets only.

This is intentionally a small dialect, not full CommonMark — stick to these
constructs and the output stays clean and consistent.

## Prerequisites

```bash
pip3 install --user python-docx
```

Already verified installed in this environment (`python-docx 1.2.0`).

## Verified example

Ran against a smoke-test note covering every construct (title/subtitle,
3 heading levels, nested bullets, numbered list, blockquote, table, divider,
inline bold/italic/code):

```bash
python3 .claude/skills/make-video-notes/driver.py test_note.md test_note.docx
# -> Saved test_note.docx
```

Inspecting the result confirmed correct output: `[Title]`, `[Heading 1]`,
`[List Bullet]` / `[List Bullet 2]`, `[List Number]` styles all applied, the
table round-tripped with the right cells, and the divider paragraph carries
a `pBdr` (bottom border) XML element.

Separately, real usage on video notes (HTTP, routing, serialization —
each with multi-line JSON/pseudocode examples) surfaced a real bug: fenced
` ```json ... ``` ` blocks weren't in the original dialect at all, so they
silently fell through to paragraph handling and got mangled — multi-line
code collapsed onto one line and misparsed by the inline single-backtick
regex. Fixed by adding real fence handling (`FENCE_RE` + `add_code_block`)
that consumes lines verbatim between fences into one shaded, monospace
paragraph with preserved line breaks — confirmed by re-rendering all three
affected docs and checking for the `F2F2F2` shading fill on each code
block, with zero leftover ` ``` ` markers in the output.

## Gotchas

- **The subtitle line only works immediately after the `#` title line.**
  If you put a blank line between them, it renders as a normal paragraph
  instead of the centered italic subtitle.
- **Table rows need the separator (`|---|---|`) right under the header**,
  or the first data row gets treated as the header instead.
- **Don't mix `---` dividers with table separator rows** — a bare `---`
  line is only treated as a divider when it's *not* immediately inside a
  block of `|`-prefixed lines; keep dividers on their own, away from tables.
- **Numbered list markers don't have to be sequential** (`1. 1. 1.` works
  fine) since Word auto-numbers `List Number` style — don't waste time
  hand-numbering.
- **Filenames with `.` in the number** (e.g. `7.`) are fine on Linux/ext4;
  no escaping needed, just quote the whole filename in the shell command
  since it contains spaces.
- **Any multi-line example (JSON, request/response shapes, pseudocode)
  must use a triple-backtick fence, never inline single backticks** —
  inline code is single-line only. Mixing this up used to silently mangle
  the output (see Verified example above) before fence support was added.

## Troubleshooting

- `ModuleNotFoundError: No module named 'docx'` → `pip3 install --user python-docx`.
- Table looks wrong / header duplicated as data → check the separator row
  (`|---|---|`) is present and directly under the header row.
- Subtitle shows as a normal paragraph, not centered/italic → it wasn't the
  line immediately after the `#` title line.
- Multi-line JSON/code renders squashed onto one line with a stray
  leading/trailing backtick → it was written with inline `` ` `` backticks
  instead of a triple-backtick fence; wrap it in ` ``` `/` ``` ` instead.
