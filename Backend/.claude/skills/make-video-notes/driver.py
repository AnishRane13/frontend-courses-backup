#!/usr/bin/env python3
"""
driver.py - Render a lightweight Markdown dialect into a styled .docx note file.

Usage:
    python3 driver.py <input.md> <output.docx>

Markdown dialect supported (line-oriented, one construct per line unless noted):

    # Title line              -> Document title (Heading 0, centered)
    *Italic subtitle line*    -> Must be the line right after the title; rendered as
                                 a centered, italic, gray subtitle
    ## Heading                -> Heading 1
    ### Heading                -> Heading 2
    #### Heading                -> Heading 3
    - item / * item            -> Bullet list (indent with 2 spaces for sub-bullet)
    1. item                    -> Numbered list (any leading number works, Word re-numbers)
    > quoted text              -> Callout / note paragraph (italic, indented, gray rule)
    | a | b |                  -> Table row; a row of |---|---| under the header marks
                                  the header separator
    ```lang                    -> Fenced code block: everything up to the closing ```
    ...code...                   is rendered verbatim (line breaks preserved, no inline
    ```                           markdown parsing inside) in a shaded monospace block
    ---  (on its own line)     -> Horizontal divider
    blank line                 -> Paragraph break
    anything else              -> Normal paragraph

Inline formatting works inside paragraphs, list items, blockquotes and table cells:
    **bold**   *italic* / _italic_   `code`

This is intentionally a small, predictable dialect -- not full CommonMark -- so the
docx output stays consistent and clean.
"""
import re
import sys
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

INLINE_RE = re.compile(
    r"\*\*(?P<bold>.+?)\*\*"
    r"|\*(?P<italic1>.+?)\*"
    r"|_(?P<italic2>.+?)_"
    r"|`(?P<code>.+?)`"
)

TABLE_ROW_RE = re.compile(r"^\s*\|(.+)\|\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")
HEADING_RE = re.compile(r"^(#{1,4})\s+(.*)$")
BULLET_RE = re.compile(r"^(\s*)[-*]\s+(.*)$")
NUMBERED_RE = re.compile(r"^\s*\d+\.\s+(.*)$")
QUOTE_RE = re.compile(r"^>\s?(.*)$")
HR_RE = re.compile(r"^(-{3,}|\*{3,})\s*$")
FENCE_RE = re.compile(r"^```(\w*)\s*$")


def add_inline_runs(paragraph, text):
    """Parse **bold** / *italic* / _italic_ / `code` and add formatted runs."""
    pos = 0
    for m in INLINE_RE.finditer(text):
        if m.start() > pos:
            paragraph.add_run(text[pos:m.start()])
        if m.group("bold") is not None:
            r = paragraph.add_run(m.group("bold"))
            r.bold = True
        elif m.group("italic1") is not None:
            r = paragraph.add_run(m.group("italic1"))
            r.italic = True
        elif m.group("italic2") is not None:
            r = paragraph.add_run(m.group("italic2"))
            r.italic = True
        elif m.group("code") is not None:
            r = paragraph.add_run(m.group("code"))
            r.font.name = "Consolas"
            r.font.size = Pt(10)
            r.font.color.rgb = RGBColor(0xC7, 0x25, 0x4E)
        pos = m.end()
    if pos < len(text):
        paragraph.add_run(text[pos:])


def add_code_block(doc, lines):
    """Render fenced code block lines verbatim: shaded, monospace, no inline parsing."""
    # Drop a single fully-blank line at the very start/end (common after fence markers)
    while lines and lines[0].strip() == "":
        lines = lines[1:]
    while lines and lines[-1].strip() == "":
        lines = lines[:-1]
    if not lines:
        return
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Pt(14)
    pf.space_before = Pt(4)
    pf.space_after = Pt(10)
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), "F2F2F2")
    pPr.append(shd)
    for idx, line in enumerate(lines):
        r = p.add_run(line if line.strip() else " ")
        r.font.name = "Consolas"
        r.font.size = Pt(9.5)
        r.font.color.rgb = RGBColor(0x33, 0x33, 0x33)
        if idx < len(lines) - 1:
            r.add_break()


def add_divider(doc):
    p = doc.add_paragraph()
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "BFBFBF")
    pBdr.append(bottom)
    pPr.append(pBdr)


def setup_styles(doc):
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    colors = {1: (0x1F, 0x4E, 0x79), 2: (0x2E, 0x74, 0xB5), 3: (0x3E, 0x8E, 0xC7)}
    for level, rgb in colors.items():
        try:
            doc.styles[f"Heading {level}"].font.color.rgb = RGBColor(*rgb)
        except KeyError:
            pass


def flush_table(doc, rows):
    if not rows:
        return
    ncols = len(rows[0])
    table = doc.add_table(rows=1, cols=ncols)
    table.style = "Light Grid Accent 1"
    hdr = table.rows[0].cells
    for i, cell_text in enumerate(rows[0]):
        p = hdr[i].paragraphs[0]
        add_inline_runs(p, cell_text)
        for r in p.runs:
            r.bold = True
    for row_cells in rows[1:]:
        cells = table.add_row().cells
        for i, cell_text in enumerate(row_cells):
            if i < ncols:
                add_inline_runs(cells[i].paragraphs[0], cell_text)
    doc.add_paragraph()


def flush_paragraph_buffer(doc, buf):
    text = " ".join(buf).strip()
    if text:
        p = doc.add_paragraph()
        add_inline_runs(p, text)
    buf.clear()


def render(md_text, doc):
    setup_styles(doc)
    lines = md_text.splitlines()
    i = 0
    para_buf = []
    title_seen = False
    quote_buf = []

    def flush_quote():
        if quote_buf:
            text = " ".join(quote_buf).strip()
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Pt(18)
            add_inline_runs(p, text)
            for r in p.runs:
                r.italic = True
                r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
            quote_buf.clear()

    while i < len(lines):
        line = lines[i]

        # Fenced code block - consume verbatim until the closing fence
        if FENCE_RE.match(line.strip()):
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            i += 1
            code_lines = []
            while i < len(lines) and not FENCE_RE.match(lines[i].strip()):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip the closing ``` fence line
            add_code_block(doc, code_lines)
            continue

        # Table block
        if TABLE_ROW_RE.match(line):
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            table_lines = []
            while i < len(lines) and TABLE_ROW_RE.match(lines[i]):
                table_lines.append(lines[i])
                i += 1
            rows = []
            for tl in table_lines:
                if TABLE_SEP_RE.match(tl):
                    continue
                cells = [c.strip() for c in tl.strip().strip("|").split("|")]
                rows.append(cells)
            flush_table(doc, rows)
            continue

        stripped = line.strip()

        if not stripped:
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            i += 1
            continue

        if HR_RE.match(stripped):
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            add_divider(doc)
            i += 1
            continue

        m = HEADING_RE.match(line)
        if m:
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            hashes, text = m.group(1), m.group(2).strip()
            level = len(hashes)
            if level == 1 and not title_seen:
                h = doc.add_heading("", level=0)
                add_inline_runs(h, text)
                h.alignment = WD_ALIGN_PARAGRAPH.CENTER
                title_seen = True
                # Look ahead: subtitle line right after title
                if i + 1 < len(lines):
                    nxt = lines[i + 1].strip()
                    sub_m = re.match(r"^\*(.+)\*$", nxt)
                    if sub_m:
                        sp = doc.add_paragraph()
                        sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
                        r = sp.add_run(sub_m.group(1))
                        r.italic = True
                        r.font.size = Pt(13)
                        r.font.color.rgb = RGBColor(0x59, 0x59, 0x59)
                        i += 1
            else:
                # map heading levels: ## -> Heading 1, ### -> Heading 2, #### -> Heading 3
                mapped = max(1, min(3, level - 1))
                h = doc.add_heading("", level=mapped)
                add_inline_runs(h, text)
            i += 1
            continue

        qm = QUOTE_RE.match(line)
        if qm:
            flush_paragraph_buffer(doc, para_buf)
            quote_buf.append(qm.group(1))
            i += 1
            continue

        bm = BULLET_RE.match(line)
        if bm:
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            indent, text = bm.group(1), bm.group(2)
            style = "List Bullet 2" if len(indent) >= 2 else "List Bullet"
            p = doc.add_paragraph(style=style)
            add_inline_runs(p, text)
            i += 1
            continue

        nm = NUMBERED_RE.match(line)
        if nm:
            flush_paragraph_buffer(doc, para_buf)
            flush_quote()
            p = doc.add_paragraph(style="List Number")
            add_inline_runs(p, nm.group(1))
            i += 1
            continue

        # Normal paragraph text - accumulate
        flush_quote()
        para_buf.append(stripped)
        i += 1

    flush_paragraph_buffer(doc, para_buf)
    flush_quote()


def main():
    if len(sys.argv) != 3:
        print("Usage: python3 driver.py <input.md> <output.docx>", file=sys.stderr)
        sys.exit(1)
    md_path, out_path = sys.argv[1], sys.argv[2]
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    doc = Document()
    render(md_text, doc)
    doc.save(out_path)
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
