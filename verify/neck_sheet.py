"""Before/after contact sheets for the Galuh neck fix.

    python3 verify/neck_sheet.py

Reads verify/neck/{before,after}-{macro,front,three,side}.png and writes
verify/neck/compare-<view>.png plus verify/neck/compare-all.png.
"""
from PIL import Image, ImageDraw

OUT = "/workspace/.gotmp/wt-neck/verify/neck"
VIEWS = ["macro", "front", "three", "side"]
LABEL = 34


def pair(view):
    a = Image.open(f"{OUT}/before-{view}.png").convert("RGB")
    b = Image.open(f"{OUT}/after-{view}.png").convert("RGB")
    w, h = a.size
    canvas = Image.new("RGB", (w * 2 + 8, h + LABEL), "#1c1a19")
    canvas.paste(a, (0, LABEL))
    canvas.paste(b, (w + 8, LABEL))
    d = ImageDraw.Draw(canvas)
    d.text((8, 9), f"{view}  —  BEFORE (main c323899)", fill="#e8ded4")
    d.text((w + 16, 9), "AFTER (fix/galuh-neck)", fill="#e8ded4")
    canvas.save(f"{OUT}/compare-{view}.png", optimize=True)
    return canvas


sheets = [pair(v) for v in VIEWS]
w = max(s.width for s in sheets)
h = sum(s.height for s in sheets) + 8 * (len(sheets) - 1)
allp = Image.new("RGB", (w, h), "#1c1a19")
y = 0
for s in sheets:
    allp.paste(s, (0, y))
    y += s.height + 8
allp.resize((w // 2, h // 2), Image.LANCZOS).save(f"{OUT}/compare-all.png", optimize=True)
print("wrote", f"{OUT}/compare-all.png", allp.size)
