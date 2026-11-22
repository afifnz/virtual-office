"""Build docs/rnd/RnD-Office-Glassmorphism.docx from the R&D markdown.

One source of truth: docs/rnd/office-glass-city.md is parsed into blocks and
rendered with python-docx (A4, 2.5 cm margins, 11 pt body, thin table borders,
page numbers in the footer, clickable bibliography links).

Headings use real Word styles — md H2 -> 'Heading 1', H3 -> 'Heading 2',
H4 -> 'Heading 3' (the md's H1 title stays on the cover, not as a heading) —
so the PDF export carries a bookmark outline per heading.

'Daftar isi' is a real Word TOC field (fldChar begin/instrText/separate/end)
whose cached result lists every heading with dot leaders and REAL page
numbers. The numbers are measured in a two-pass build: pass 1 renders blank
numbers, the exported PDF outline maps each heading title to its page, pass 2
bakes the numbers in and asserts the pagination did not move.

Run:  python3 docs/rnd/build_rnd_docx.py            # two-pass build + verify
      python3 docs/rnd/build_rnd_docx.py --verify   # verify existing artifacts
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

import pymupdf
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MD = HERE / "office-glass-city.md"
OUT = HERE / "RnD-Office-Glassmorphism.docx"
PDF = HERE / "RnD-Office-Glassmorphism.pdf"

BODY_FONT = "Liberation Sans"
MONO_FONT = "DejaVu Sans Mono"
INK = RGBColor(0x16, 0x20, 0x2E)
ACCENT = RGBColor(0xA9, 0x74, 0x1F)
MUTED = RGBColor(0x55, 0x63, 0x77)
RULE = "C9D2DE"

# md heading level -> (Word style, size pt, colour, space before pt, space after pt)
HEADING_SPECS: dict[int, tuple[str, float, RGBColor, float, float]] = {
    2: ("Heading 1", 16.0, INK, 2, 8),
    3: ("Heading 2", 13.0, INK, 12, 4),
    4: ("Heading 3", 11.5, ACCENT, 9, 4),
}

# TOC entry look per md level: (indent cm, size pt, colour)
TOC_SPECS: dict[int, tuple[float, float, RGBColor]] = {
    2: (0.0, 10.5, INK),
    3: (0.6, 9.5, MUTED),
    4: (1.2, 9.0, MUTED),
}

TOC_INSTR = ' TOC \\o "1-3" \\h \\z \\u '


# ------------------------------------------------------------------ markdown
def parse(md: str) -> list[tuple]:
    lines = md.split("\n")
    blocks: list[tuple] = []
    i = 0
    while i < len(lines):
        ln = lines[i]
        s = ln.strip()
        if not s:
            i += 1
            continue
        if s.startswith("```"):
            buf = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", "\n".join(buf)))
            continue
        if s.startswith("#"):
            lvl = len(s) - len(s.lstrip("#"))
            blocks.append(("h", lvl, s[lvl:].strip()))
            i += 1
            continue
        m_img = re.match(r"^!\[(.*?)\]\((.*?)\)$", s)
        if m_img:
            cap, target = m_img.groups()
            bits = [x.strip() for x in target.split(",")]
            blocks.append(("img", cap, bits[0], float(bits[1]) if len(bits) > 1 else 15.5))
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip().strip("|")
                cells = [c.strip() for c in raw.split("|")]
                if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            blocks.append(("table", rows))
            continue
        if s.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(("quote", " ".join(buf)))
            continue
        m = re.match(r"^(\d+)\.\s+(.*)$", s)
        if m:
            blocks.append(("li", m.group(2), True))
            i += 1
            continue
        if s.startswith("- "):
            blocks.append(("li", s[2:], False))
            i += 1
            continue
        if s == "---":
            blocks.append(("hr",))
            i += 1
            continue
        # paragraph: join until blank / block start
        buf = [s]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||>|- |\d+\.\s|```|---$|!\[)", lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        blocks.append(("p", " ".join(buf)))
    return blocks


INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?://[^\s)]+)")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def plain(text: str) -> str:
    """Inline markup (bold/italic/code/link) reduced to its visible text."""
    out = []
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            out.append(part[2:-2])
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            out.append(part[1:-1])
        elif part.startswith("`") and part.endswith("`"):
            out.append(part[1:-1])
        elif part.startswith("[") and "](" in part:
            out.append(re.match(r"\[([^\]]+)\]\(([^)]+)\)", part).group(1))
        else:
            out.append(part)
    return "".join(out)


def add_runs(par, text: str, size: float = 11, color: RGBColor = INK, bold: bool = False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = par.add_run(part[2:-2])
            r.bold = True
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            r = par.add_run(part[1:-1])
            r.italic = True
        elif part.startswith("`") and part.endswith("`"):
            r = par.add_run(part[1:-1])
            r.font.name = MONO_FONT
            r._element.rPr.rFonts.set(qn("w:eastAsia"), MONO_FONT)
            r.font.size = Pt(size - 1.2)
            r.font.color.rgb = color
            # skip the shared tail below, which would reset the run to the body
            # font/size and silently undo the mono formatting
            continue
        elif part.startswith("http://") or part.startswith("https://"):
            add_hyperlink(par, part, part, size - 0.6)
            continue
        elif part.startswith("[") and "](" in part:
            label, url = re.match(r"\[([^\]]+)\]\(([^)]+)\)", part).groups()
            add_hyperlink(par, url, label, size)
            continue
        else:
            r = par.add_run(part)
            if bold:
                r.bold = True
        r.font.size = Pt(size)
        r.font.name = BODY_FONT
        r.font.color.rgb = color


def add_hyperlink(par, url: str, text: str, size: float = 11):
    part = par.part
    r_id = part.relate_to(url, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", is_external=True)
    hl = OxmlElement("w:hyperlink")
    hl.set(qn("r:id"), r_id)
    run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "1D4ED8")
    u = OxmlElement("w:u")
    u.set(qn("w:val"), "single")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), str(int(size * 2)))
    rPr.append(color)
    rPr.append(u)
    rPr.append(sz)
    run.append(rPr)
    t = OxmlElement("w:t")
    t.text = text
    run.append(t)
    hl.append(run)
    par._p.append(hl)


# ------------------------------------------------------------------ document
def set_cell_borders(cell, color: str = RULE, sz: int = 4):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), str(sz))
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), color)
        borders.append(el)
    tcPr.append(borders)


def shade(cell, hex_fill: str):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tcPr.append(shd)


def add_table(doc, rows: list[list[str]]):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=cols)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    for ri, row in enumerate(rows):
        for ci in range(cols):
            cell = t.cell(ri, ci)
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            txt = row[ci] if ci < len(row) else ""
            add_runs(p, txt, size=8.6 if cols >= 6 else 9.2,
                     color=INK, bold=(ri == 0))
            set_cell_borders(cell)
            if ri == 0:
                shade(cell, "EEF2F7")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def add_footer_page_numbers(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("R&D Kantor 2D Glassmorphism · v1.0   ·   halaman ")
    r.font.size = Pt(8.5)
    r.font.name = BODY_FONT
    r.font.color.rgb = MUTED
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), "PAGE")
    run = OxmlElement("w:r")
    rPr = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "17")
    rPr.append(sz)
    run.append(rPr)
    t = OxmlElement("w:t")
    t.text = "1"
    run.append(t)
    fld.append(run)
    p._p.append(fld)


def add_cover(doc, meta: dict):
    for _ in range(3):
        doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("R&D DESAIN")
    r.font.size = Pt(11)
    r.font.bold = True
    r.font.name = BODY_FONT
    r.font.color.rgb = ACCENT
    p.paragraph_format.space_after = Pt(4)

    p = doc.add_paragraph()
    r = p.add_run("Kantor 2D Glassmorphism")
    r.font.size = Pt(30)
    r.font.bold = True
    r.font.name = BODY_FONT
    r.font.color.rgb = INK
    p.paragraph_format.space_after = Pt(2)

    p = doc.add_paragraph()
    r = p.add_run("dengan pemandangan kota metropolitan")
    r.font.size = Pt(17)
    r.font.name = BODY_FONT
    r.font.color.rgb = MUTED
    p.paragraph_format.space_after = Pt(24)

    # a thin rule
    pr = doc.add_paragraph()
    pPr = pr._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:color"), "A9741F")
    pbdr.append(bottom)
    pPr.append(pbdr)
    pr.paragraph_format.space_after = Pt(24)

    rows = [("Penyusun", meta["author"]), ("Tanggal", meta["date"]), ("Versi", meta["version"]),
            ("Status", "Riset & spesifikasi desain (bukan implementasi produksi)"),
            ("Branch", "rnd/office-glass-city"),
            ("Lingkup", "frontend/src/scene2d, components, styles — dibahas, tidak diubah")]
    t = doc.add_table(rows=len(rows), cols=2)
    for i, (k, v) in enumerate(rows):
        c0, c1 = t.cell(i, 0), t.cell(i, 1)
        c0.text = ""
        c1.text = ""
        p0 = c0.paragraphs[0]
        r0 = p0.add_run(k)
        r0.font.size = Pt(10)
        r0.font.bold = True
        r0.font.name = BODY_FONT
        r0.font.color.rgb = MUTED
        p1 = c1.paragraphs[0]
        r1 = p1.add_run(v)
        r1.font.size = Pt(10)
        r1.font.name = BODY_FONT
        r1.font.color.rgb = INK
        for c in (c0, c1):
            set_cell_borders(c, color="E2E8F0")
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run("Dokumen ini menyertakan tiga arah desain dengan mockup 1280×800, analisis biaya blur yang "
                  "diukur, matriks keputusan berbobot, dan rencana implementasi bertahap yang bisa dihentikan "
                  "tanpa mengganggu produksi.")
    r.font.size = Pt(10)
    r.font.name = BODY_FONT
    r.font.color.rgb = MUTED
    p.paragraph_format.space_before = Pt(18)

    doc.add_page_break()


# ------------------------------------------------------------- heading styles
def setup_styles(doc: Document):
    """Normal + real Heading 1-3 styles (design preserved, theme fonts stripped)."""
    st = doc.styles["Normal"]
    st.font.name = BODY_FONT
    st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.line_spacing = 1.15

    for lvl, (name, size, color, before, after) in HEADING_SPECS.items():
        h = doc.styles[name]
        h.font.name = BODY_FONT
        h.font.size = Pt(size)
        h.font.bold = True
        h.font.color.rgb = color
        # replace theme font refs with explicit fonts, else Word falls back to Calibri Light
        rfonts = h.element.get_or_add_rPr().get_or_add_rFonts()
        for theme_attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
            key = qn("w:" + theme_attr)
            if key in rfonts.attrib:
                del rfonts.attrib[key]
        for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
            rfonts.set(qn("w:" + attr), BODY_FONT)
        h.paragraph_format.space_before = Pt(before)
        h.paragraph_format.space_after = Pt(after)
        h.paragraph_format.keep_with_next = True
        h.paragraph_format.line_spacing = 1.1
        # explicit outline level -> LibreOffice exports a PDF bookmark per heading
        ppr = h.element.get_or_add_pPr()
        for el in ppr.findall(qn("w:outlineLvl")):
            ppr.remove(el)
        ol = OxmlElement("w:outlineLvl")
        ol.set(qn("w:val"), str(lvl - 2))
        ppr.append(ol)


def add_heading(doc, lvl: int, text: str):
    """Heading paragraph on the real Word style; runs via add_runs (inline markup)."""
    name, size, color, _before, _after = HEADING_SPECS[lvl]
    p = doc.add_paragraph(style=name)
    if lvl == 2 and text.startswith("6."):
        p.paragraph_format.page_break_before = True
    if lvl == 2:
        # thin bottom rule under level-1 headings (kept from the previous design)
        pPr = p._p.get_or_add_pPr()
        pbdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        bottom.set(qn("w:val"), "single")
        bottom.set(qn("w:sz"), "6")
        bottom.set(qn("w:color"), RULE)
        pbdr.append(bottom)
        pPr.append(pbdr)
    add_runs(p, text, size=size, color=color, bold=True)
    return p


# ------------------------------------------------------------------ TOC field
def fld_char(kind: str, dirty: bool = False):
    r = OxmlElement("w:r")
    fld = OxmlElement("w:fldChar")
    fld.set(qn("w:fldCharType"), kind)
    if dirty:
        fld.set(qn("w:dirty"), "true")
    r.append(fld)
    return r


def instr_run(instr: str):
    r = OxmlElement("w:r")
    it = OxmlElement("w:instrText")
    it.set(qn("xml:space"), "preserve")
    it.text = instr
    r.append(it)
    return r


def lookup(page_map: dict[str, int], title: str) -> int | None:
    if title in page_map:
        return page_map[title]
    for key, page in page_map.items():
        if key.startswith(title[:20]) or title.startswith(key[:20]):
            return page
    return None


def add_toc(doc, headings: list[tuple[int, str]], page_map: dict[str, int] | None = None):
    """Real TOC field: begin+instrText+separate on the first entry paragraph,
    one paragraph per heading, fldChar end after the last entry's page number.
    A short italic note sits AFTER the field so Word never overwrites it."""
    h = doc.add_paragraph()
    r = h.add_run("Daftar isi")
    r.font.size = Pt(15)
    r.bold = True
    r.font.name = BODY_FONT
    r.font.color.rgb = INK
    h.paragraph_format.space_after = Pt(10)

    entries = [(lvl, plain(text)) for lvl, text in headings]
    page_map = page_map or {}
    last = len(entries) - 1
    for i, (lvl, text) in enumerate(entries):
        indent, size, color = TOC_SPECS[lvl]
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(indent)
        p.paragraph_format.space_after = Pt(3 if lvl == 2 else 2)
        p.paragraph_format.tab_stops.add_tab_stop(Cm(15.5), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)
        if i == 0:
            p._p.append(fld_char("begin", dirty=True))
            p._p.append(instr_run(TOC_INSTR))
            p._p.append(fld_char("separate"))
        r = p.add_run(text)
        r.font.size = Pt(size)
        r.font.name = BODY_FONT
        r.font.color.rgb = color
        tab = p.add_run("\t")
        tab.font.size = Pt(size)
        tab.font.name = BODY_FONT
        tab.font.color.rgb = color
        page = lookup(page_map, norm(text))
        r2 = p.add_run(str(page) if page else "")
        r2.font.size = Pt(size)
        r2.font.name = BODY_FONT
        r2.font.color.rgb = color
        if i == last:
            p._p.append(fld_char("end"))

    note = doc.add_paragraph()
    r = note.add_run("Nomor halaman di atas diambil dari render final. Bila isi dokumen berubah, "
                     "perbarui daftar ini dengan F9 atau klik kanan → Update Field.")
    r.font.size = Pt(8.5)
    r.italic = True
    r.font.name = BODY_FONT
    r.font.color.rgb = MUTED
    doc.add_page_break()


def add_image(doc, path: Path, caption: str, width_cm: float):
    if not path.exists():
        print("!! missing image", path)
        return
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(3)
    p.add_run().add_picture(str(path), width=Cm(width_cm))
    if caption:
        c = doc.add_paragraph()
        c.alignment = WD_ALIGN_PARAGRAPH.CENTER
        c.paragraph_format.space_after = Pt(12)
        r = c.add_run(caption)
        r.font.size = Pt(8.6)
        r.italic = True
        r.font.name = BODY_FONT
        r.font.color.rgb = MUTED


def body_headings(blocks) -> list[tuple[int, str]]:
    """Headings the body actually renders, in order (same cover-skip logic)."""
    headings = []
    started = False
    for b in blocks:
        kind = b[0]
        if kind == "h" and b[1] == 1 and "R&D — Kantor 2D" in b[2]:
            started = "meta"
            continue
        if started == "meta":
            if kind == "hr":
                started = True
            continue
        if not started:
            continue
        if kind == "h" and b[1] in HEADING_SPECS:
            headings.append((b[1], b[2]))
    return headings


# ------------------------------------------------------------------ build
def build_doc(page_map: dict[str, int] | None = None) -> Document:
    blocks = parse(MD.read_text())
    doc = Document()
    setup_styles(doc)

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin = sec.bottom_margin = sec.left_margin = sec.right_margin = Cm(2.5)
    add_footer_page_numbers(sec)

    add_cover(doc, {"author": "Tim R&D — Hermes (profil dev)", "date": "22 November 2026", "version": "1.0"})
    add_toc(doc, body_headings(blocks), page_map)

    # skip the md's own H1 + metadata block (already on the cover)
    started = False
    num = 0
    for b in blocks:
        kind = b[0]
        if kind == "h" and b[1] == 1:
            if "R&D — Kantor 2D" in b[2]:
                started = "meta"
                continue
        if started == "meta":
            if kind == "hr":
                started = True
            continue
        if not started:
            continue

        if kind == "h":
            if b[1] in HEADING_SPECS:
                add_heading(doc, b[1], b[2])
            continue

        if kind != "li":
            num = 0
        if kind == "p":
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            add_runs(p, b[1])
        elif kind == "li":
            if b[2]:
                num += 1
                p = doc.add_paragraph()
                p.paragraph_format.left_indent = Cm(0.8)
                p.paragraph_format.first_line_indent = Cm(-0.8)
                p.paragraph_format.space_after = Pt(2)
                r = p.add_run(f"{num}. ")
                r.font.size = Pt(10.5)
                r.font.name = BODY_FONT
                r.font.color.rgb = INK
                add_runs(p, b[1], size=10.5)
            else:
                try:
                    p = doc.add_paragraph(style="List Bullet")
                except KeyError:
                    p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(2)
                add_runs(p, b[1], size=10.5)
        elif kind == "quote":
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(8)
            add_runs(p, b[1], size=10.5, color=MUTED, bold=False)
        elif kind == "code":
            for line in b[1].split("\n"):
                p = doc.add_paragraph()
                p.paragraph_format.space_after = Pt(0)
                p.paragraph_format.left_indent = Cm(0.4)
                r = p.add_run(line if line else " ")
                r.font.name = MONO_FONT
                r._element.rPr.rFonts.set(qn("w:eastAsia"), MONO_FONT)
                r.font.size = Pt(8.5)
                r.font.color.rgb = INK
            doc.add_paragraph().paragraph_format.space_after = Pt(2)
        elif kind == "table":
            add_table(doc, b[1])
        elif kind == "img":
            add_image(doc, REPO / b[2], b[1], b[3])
        elif kind == "hr":
            p = doc.add_paragraph()
            pPr = p._p.get_or_add_pPr()
            pbdr = OxmlElement("w:pBdr")
            bottom = OxmlElement("w:bottom")
            bottom.set(qn("w:val"), "single")
            bottom.set(qn("w:sz"), "4")
            bottom.set(qn("w:color"), RULE)
            pbdr.append(bottom)
            pPr.append(pbdr)

    return doc


# ------------------------------------------------------------- pdf plumbing
def convert_pdf(bookmarks: bool = False) -> Path:
    fmt = 'pdf:writer_pdf_Export:{"ExportBookmarks":{"type":"boolean","value":"true"}}' if bookmarks else "pdf"
    cmd = ["soffice", "--headless", "-env:UserInstallation=file:///tmp/lo_rnd_build",
           "--convert-to", fmt, "--outdir", str(HERE), str(OUT)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if proc.returncode != 0 or not PDF.exists():
        raise RuntimeError(f"soffice conversion failed ({proc.returncode}): {proc.stdout} {proc.stderr}")
    return PDF


def outline_info(path: Path = PDF) -> tuple[list, int]:
    with pymupdf.open(path) as f:
        return f.get_toc(), f.page_count


def build_two_pass() -> dict:
    wanted = [norm(plain(t)) for _lvl, t in body_headings(parse(MD.read_text()))]

    print(f"pass 1: {len(wanted)} headings, TOC page numbers blank")
    build_doc().save(OUT)
    convert_pdf()
    toc1, pages1 = outline_info()
    if not toc1:
        print("outline empty on first export; retrying with ExportBookmarks=true")
        convert_pdf(bookmarks=True)
        toc1, pages1 = outline_info()
    if not toc1:
        raise RuntimeError("PDF outline is empty — LibreOffice did not export bookmarks")

    page_map = {norm(title): page for _lvl, title, page in toc1}
    missing = [t for t in wanted if lookup(page_map, t) is None]
    if missing:
        raise RuntimeError(f"headings not found in the PDF outline: {missing}")

    print(f"pass 2: baking real page numbers (e.g. {wanted[0]} -> hal {lookup(page_map, wanted[0])})")
    build_doc(page_map).save(OUT)
    convert_pdf()
    toc2, pages2 = outline_info()

    if pages1 != pages2:
        raise RuntimeError(f"pagination moved between passes: {pages1} -> {pages2} pages")
    if len(toc2) < 25:
        raise RuntimeError(f"PDF outline has only {len(toc2)} entries (need >= 25)")
    bad = [(title, lookup(page_map, norm(title)), page) for _lvl, title, page in toc2
           if lookup(page_map, norm(title)) != page]
    if bad:
        raise RuntimeError(f"printed TOC numbers disagree with the PDF outline: {bad}")
    print(f"two-pass OK: {pages2} pages, {len(toc2)} outline entries, printed numbers match the outline")
    return {"pages": pages2, "outline": len(toc2)}


# ------------------------------------------------------------------ verify
def pdf_text_lines(page) -> list[str]:
    """Visual text lines of a PDF page (spans merged by y-coordinate)."""
    rows: list[tuple[float, float, str]] = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            text = "".join(span["text"] for span in line["spans"]).strip()
            if text:
                rows.append((round(line["bbox"][1], 1), line["bbox"][0], text))
    rows.sort()
    merged: list[list] = []
    for y, _x, text in rows:
        if merged and abs(merged[-1][0] - y) <= 2.5:
            merged[-1][1].append(text)
        else:
            merged.append([y, [text]])
    return ["  ".join(parts).strip() for _y, parts in merged]


def verify() -> dict:
    doc = Document(OUT)
    hist = Counter(p.style.name for p in doc.paragraphs)
    print("== verify:", OUT.relative_to(REPO), "/", PDF.relative_to(REPO))
    print("style histogram:", dict(sorted(hist.items(), key=lambda kv: (-kv[1], kv[0]))))

    heads = [p.style.name for p in doc.paragraphs if p.style.name.startswith("Heading")]
    print(f"heading paragraphs: {len(heads)} | first 8: {heads[:8]}")

    first = last = None
    for i, p in enumerate(doc.paragraphs):
        kinds = {fc.get(qn("w:fldCharType")) for fc in p._p.findall(".//" + qn("w:fldChar"))}
        if "begin" in kinds and first is None:
            first = i
        if "end" in kinds and first is not None and last is None:
            last = i
    toc_entries = (last - first + 1) if (first is not None and last is not None) else 0
    print("TOC field entry paragraphs:", toc_entries)

    with pymupdf.open(PDF) as f:
        pg = f[0]
        is_a4 = abs(pg.rect.width - 595) < 3 and abs(pg.rect.height - 842) < 3
        print(f"PDF: {f.page_count} pages, {pg.rect.width:.0f}x{pg.rect.height:.0f} pt ({'A4' if is_a4 else 'NOT A4!'})")
        toc = f.get_toc()
        print("PDF outline entries:", len(toc))
        for lvl, title, pno in toc[:5]:
            print(f"   {lvl}: {title}  ->  hal {pno}")
        toc_page = next((p for p in f if "Daftar isi" in p.get_text()), None)
        if toc_page is None:
            print("TOC page: NOT FOUND")
            numbered = []
        else:
            lines = [l for l in pdf_text_lines(toc_page) if "halaman" not in l]
            numbered = [l for l in lines if re.search(r"\d+$", l.strip())]
            print(f"TOC page (pdf page {toc_page.number + 1}): {len(numbered)} lines ending in a page number; sample:")
            for l in numbered[:10]:
                print("   ", l)
        pages = f.page_count
    return {"headings": len(heads), "toc_entries": toc_entries, "outline": len(toc),
            "pages": pages, "toc_numbered": len(numbered)}


if __name__ == "__main__":
    if "--verify" in sys.argv[1:]:
        verify()
    else:
        build_two_pass()
        print()
        verify()
