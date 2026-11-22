"""Build docs/rnd/RnD-Office-Glassmorphism.docx from the R&D markdown.

One source of truth: docs/rnd/office-glass-city.md is parsed into blocks and
rendered with python-docx (A4, 2.5 cm margins, 11 pt body, bold headings, thin
table borders, page numbers in the footer, clickable bibliography links).

Run:  python3 docs/rnd/build_rnd_docx.py
Then: soffice --headless --convert-to pdf --outdir docs/rnd docs/rnd/RnD-Office-Glassmorphism.docx
"""
from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor, Emu

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
MD = HERE / "office-glass-city.md"
MOCK = REPO / "docs/design/mockups"
OUT = HERE / "RnD-Office-Glassmorphism.docx"

BODY_FONT = "Liberation Sans"
MONO_FONT = "DejaVu Sans Mono"
INK = RGBColor(0x16, 0x20, 0x2E)
ACCENT = RGBColor(0xA9, 0x74, 0x1F)
MUTED = RGBColor(0x55, 0x63, 0x77)
RULE = "C9D2DE"

# images inserted at the end of the section whose heading contains the key
IMAGES: list[tuple[str, list[tuple[Path, str, float]]]] = [
    ("6.1 Sky Lobby", [(MOCK / "sky-lobby.png", "Gambar 1 — Sky Lobby, L3 Tim Dev, 1280×800. Band jendela kota dusk di atas dinding utara; kaca hanya di HUD, tab, roster, dan zoom.", 15.5)]),
    ("6.2 Daylight Atrium", [(MOCK / "daylight-atrium.png", "Gambar 2 — Daylight Atrium, L3 Tim Dev, 1280×800. Kaca putih susu, aksen biru, outline furnitur untuk memisahkan putih dari lantai terang.", 15.5)]),
    ("6.3 Neon Metro", [(MOCK / "neon-metro.png", "Gambar 3 — Neon Metro, L3 Tim Dev, 1280×800. Kaca hitam, tepi cyan, glow dibatasi satu lapis.", 15.5)]),
    ("5.3 Dampak", [(MOCK / "scene-tech-compare.png", "Gambar 4 — Tiga tingkat non-pixel pada crop L3 yang sama: (a) avatar vector di atas scene pixel, (b) seluruh scene vector, (c) scene vector + kaca & kota penuh.", 15.5)]),
    ("5.6.4", [(MOCK / "avatar-before-after.png", "Gambar 5 — Avatar sebelum/sesudah: 12×16 pixel (atas) dan clean vector 150 px (bawah) untuk delapan look L3 yang sama.", 15.5)]),
    ("7. Matriks", [(MOCK / "sky-lobby-mobile.png", "Gambar 6 — Sky Lobby di 390×844: bottom sheet kaca, tab lantai di atas sheet, scene tetap terlihat.", 7.6)]),
]

MOBILE = (MOCK / "sky-lobby-mobile.png", "Gambar 6 — Sky Lobby di 390×844: bottom sheet kaca, tab lantai di atas sheet, scene tetap terlihat.", 7.6)


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


def add_toc(doc, blocks):
    h = doc.add_paragraph()
    r = h.add_run("Daftar isi")
    r.font.size = Pt(15)
    r.bold = True
    r.font.name = BODY_FONT
    r.font.color.rgb = INK
    h.paragraph_format.space_after = Pt(10)
    for b in blocks:
        if b[0] == "h" and b[1] == 2:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(3)
            p.paragraph_format.left_indent = Cm(0)
            run = p.add_run(b[2])
            run.font.size = Pt(10.5)
            run.font.name = BODY_FONT
            run.font.color.rgb = INK
        elif b[0] == "h" and b[1] == 3:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.left_indent = Cm(0.6)
            run = p.add_run(b[2])
            run.font.size = Pt(9.5)
            run.font.name = BODY_FONT
            run.font.color.rgb = MUTED
    p = doc.add_paragraph()
    r = p.add_run("Nomor halaman mengikuti render akhir; daftar ini sengaja tanpa nomor agar tidak "
                  "menyesatkan bila isi berubah.")
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


def build():
    md = MD.read_text()
    blocks = parse(md)
    doc = Document()

    st = doc.styles["Normal"]
    st.font.name = BODY_FONT
    st.font.size = Pt(11)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
    st.paragraph_format.space_after = Pt(6)
    st.paragraph_format.line_spacing = 1.15

    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin = sec.bottom_margin = sec.left_margin = sec.right_margin = Cm(2.5)
    add_footer_page_numbers(sec)

    add_cover(doc, {"author": "Tim R&D — Hermes (profil dev)", "date": "22 November 2026", "version": "1.0"})
    add_toc(doc, blocks)

    # skip the md's own H1 + metadata block (already on the cover)
    started = False
    num = 0
    pending_images: list[tuple] = []
    current_section = ""

    for idx, b in enumerate(blocks):
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
            lvl, text = b[1], b[2]
            if lvl == 2:
                current_section = text
                new_page = text.startswith("6.")
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(2)
                p.paragraph_format.space_after = Pt(8)
                p.paragraph_format.keep_with_next = True
                if new_page:
                    p.paragraph_format.page_break_before = True
                r = p.add_run(text)
                r.font.size = Pt(16)
                r.bold = True
                r.font.name = BODY_FONT
                r.font.color.rgb = INK
                # rule under H1
                pPr = p._p.get_or_add_pPr()
                pbdr = OxmlElement("w:pBdr")
                bottom = OxmlElement("w:bottom")
                bottom.set(qn("w:val"), "single")
                bottom.set(qn("w:sz"), "6")
                bottom.set(qn("w:color"), RULE)
                pbdr.append(bottom)
                pPr.append(pbdr)
            else:
                p = doc.add_paragraph()
                p.paragraph_format.space_before = Pt(12 if lvl == 3 else 9)
                p.paragraph_format.space_after = Pt(4)
                p.paragraph_format.keep_with_next = True
                r = p.add_run(text)
                r.font.size = Pt(13 if lvl == 3 else 11.5)
                r.bold = True
                r.font.name = BODY_FONT
                r.font.color.rgb = INK if lvl == 3 else ACCENT
            continue

        if kind != "li" and kind != "h":
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

    for path, cap, w in pending_images:
        add_image(doc, path, cap, w)

    doc.save(OUT)
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    build()
