#!/usr/bin/env python3
"""Rasterise frontend/public/favicon.svg into the icon set browsers need.

    python3 deploy/make-favicon.py            # rewrite favicon.ico + apple-touch-icon.png

Why a script: the icon is procedural (plain rects on a 32 px grid), and the
raster versions must be generated from the *same* geometry as the SVG — never
from a third-party image. ImageMagick's built-in SVG renderer blurs this
three-band mark badly at 16 px, so the script parses the rects out of the SVG
and paints them itself with 16× supersampling.

Outputs (committed, so a fresh clone has icons without running this):
    frontend/public/favicon.ico        16 + 32 + 48 px
    frontend/public/apple-touch-icon.png  180 px, opaque (iOS masks it itself)

Requires Pillow (already present in the dev sandbox; not a runtime dependency
of the app — these files are static assets).
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "frontend/public/favicon.svg"
ICO = ROOT / "frontend/public/favicon.ico"
APPLE = ROOT / "frontend/public/apple-touch-icon.png"

GRID = 32  # the SVG viewBox is 0 0 32 32
SUPERSAMPLE = 16


def rects(svg_path: Path):
    """Every <rect> in document order, as plain dicts (no transforms used)."""
    tree = ET.parse(svg_path)
    out = []
    for el in tree.iter():
        if not el.tag.endswith("rect"):
            continue
        g = el.attrib
        out.append(
            {
                "x": float(g.get("x", 0)),
                "y": float(g.get("y", 0)),
                "w": float(g.get("width", 0)),
                "h": float(g.get("height", 0)),
                "rx": float(g.get("rx", 0)),
                "fill": g.get("fill"),
                "stroke": g.get("stroke"),
                "stroke_w": float(g.get("stroke-width", 0)),
            }
        )
    return out


def rgba(colour: str):
    colour = colour.strip().lstrip("#")
    if colour.lower() in ("none", "transparent"):
        return None
    if len(colour) == 6:
        return tuple(int(colour[i : i + 2], 16) for i in (0, 2, 4)) + (255,)
    return tuple(int(colour[i : i + 2], 16) for i in (0, 2, 4, 6))


def render(size: int, shapes) -> Image.Image:
    """Paint the SVG rects at `size` px with SUPERSAMPLE× anti-aliasing."""
    s = size * SUPERSAMPLE / GRID
    canvas = Image.new("RGBA", (size * SUPERSAMPLE, size * SUPERSAMPLE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    def box(r):
        return [r["x"] * s, r["y"] * s, (r["x"] + r["w"]) * s, (r["y"] + r["h"]) * s]

    for r in shapes:
        fill = rgba(r["fill"]) if r["fill"] else None
        outline = rgba(r["stroke"]) if r["stroke"] else None
        width = max(1, round(r["stroke_w"] * s)) if outline else 1
        radius = r["rx"] * s
        if radius > 0:
            draw.rounded_rectangle(box(r), radius=radius, fill=fill, outline=outline, width=width)
        else:
            draw.rectangle(box(r), fill=fill, outline=outline, width=width)

    return canvas.resize((size, size), Image.LANCZOS)


def main() -> int:
    shapes = rects(SVG)
    if not shapes:
        print(f"{SVG} has no rects", file=sys.stderr)
        return 1

    ico_sizes = [16, 32, 48]
    frames = [render(n, shapes) for n in ico_sizes]
    frames[-1].save(ICO, format="ICO", sizes=[(n, n) for n in ico_sizes], append_images=frames[:-1])

    # iOS composites the icon on its own mask; it must not be transparent.
    bg = shapes[0]["fill"]
    apple = render(180, shapes).convert("RGBA")
    plate = Image.new("RGBA", apple.size, rgba(bg))
    plate.alpha_composite(apple)
    plate.convert("RGB").save(APPLE, format="PNG", optimize=True)

    print(f"icons written: {ICO.relative_to(ROOT)} ({', '.join(f'{n}px' for n in ico_sizes)}) + {APPLE.relative_to(ROOT)} (180px)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
