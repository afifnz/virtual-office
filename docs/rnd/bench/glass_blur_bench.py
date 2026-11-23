"""Glass-panel cost benchmark for the 2D office (R&D, not production code).

The production app draws a procedural pixel-art office into a single <canvas>.
A glassmorphism panel needs a blurred backdrop. This script measures the
candidate strategies on a *software* rasteriser (Pillow, which uses the same
three-pass box approximation of a Gaussian that Skia's CPU path uses) so the
numbers are an honest upper bound, not a browser measurement:

  A. per-frame blur          — crop + blur the backdrop region every frame
  B. cached blur             — the blurred plate is built once per (floor, size);
                               each frame only composites it
  C. fake glass              — 3 alpha fills + a pre-baked noise tile, no convolution
  D. half-res blur           — blur at 50 % then upscale (the usual GPU trick)
  E. whole frame             — 1280x800 scene + the panel on top, one frame

Run:  python3 docs/rnd/bench/glass_blur_bench.py
Writes docs/rnd/bench/glass_blur_bench.json and prints a markdown table.
"""
from __future__ import annotations

import json
import os
import platform
import statistics
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
PANEL = (280, 640)          # CSS px — the roster sidebar, the widest glass surface
SCENE = (1000, 688)         # CSS px — canvas box on a 1280x800 laptop viewport
FRAME = (1280, 800)         # CSS px — the whole viewport
RADII = (8, 12, 20)         # CSS px of blur
ITERS = 60


def backdrop(w: int, h: int, dpr: int) -> Image.Image:
    """A stand-in for the moving scene: skyline gradient + lit window blocks."""
    W, H = w * dpr, h * dpr
    y = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, W, dtype=np.float32)[None, :]
    sky = np.stack([
        18 + 60 * (1 - y) + 25 * x,
        24 + 48 * (1 - y) + 10 * x,
        40 + 70 * (1 - y) + 18 * x,
    ], axis=-1)
    img = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8), "RGB")
    rng = np.random.default_rng(7)
    d = ImageDraw.Draw(img)
    for _ in range(40):  # high-frequency detail the blur has to eat
        bx = int(rng.integers(0, W - 20))
        by = int(rng.integers(0, H - 30))
        d.rectangle([bx, by, bx + int(rng.integers(6, 18)), by + int(rng.integers(4, 14))],
                    fill=(200, 180, 130))
    return img


def noise_tile(size: tuple[int, int]) -> Image.Image:
    rng = np.random.default_rng(3)
    a = rng.normal(0, 6, (size[1], size[0], 1)).repeat(3, axis=2) + 128
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def timeit(fn, iters: int = ITERS) -> dict:
    ts: list[float] = []
    for _ in range(iters):
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000.0)
    ts.sort()
    return {
        "mean_ms": round(statistics.fmean(ts), 3),
        "p95_ms": round(ts[int(len(ts) * 0.95) - 1], 3),
        "min_ms": round(ts[0], 3),
    }


def main() -> None:
    results: dict = {
        "host": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
            "pillow": Image.__version__,
            "numpy": np.__version__,
        },
        "note": (
            "Software rasteriser (Pillow) reference numbers, single core. Browser Canvas2D blur "
            "runs on the GPU (Skia) and is faster in absolute terms; use these as an upper bound "
            "and as the ratio between strategies, which is what the design decision depends on."
        ),
        "panel_css": list(PANEL),
        "scene_css": list(SCENE),
        "frame_css": list(FRAME),
        "rows": [],
    }

    for dpr in (1, 2):
        scene = backdrop(*SCENE, dpr=dpr)
        bd = backdrop(*PANEL, dpr=dpr)
        full = backdrop(*FRAME, dpr=dpr)
        w, h = PANEL[0] * dpr, PANEL[1] * dpr
        nz = noise_tile((w, h))
        for radius in RADII:
            r = radius * dpr

            def a_per_frame() -> None:
                region = bd.crop((0, 0, w, h)).filter(ImageFilter.GaussianBlur(r))
                Image.blend(region, Image.new("RGB", (w, h), (16, 22, 33)), 0.55)

            plate = bd.crop((0, 0, w, h)).filter(ImageFilter.GaussianBlur(r))
            out = bd.copy()

            def b_cached() -> None:
                out.paste(plate, (0, 0))
                out.paste((255, 255, 255), (0, 0, w, max(1, dpr)))

            def d_half_res() -> None:
                small = bd.crop((0, 0, w, h)).resize((max(1, w // 2), max(1, h // 2)), Image.BILINEAR)
                small = small.filter(ImageFilter.GaussianBlur(max(1.0, r / 2)))
                small.resize((w, h), Image.BILINEAR)

            def e_frame() -> None:
                frame = full.copy()
                frame.paste(plate, (0, 0))
                frame.paste((255, 255, 255), (0, 0, w, max(1, dpr)))

            results["rows"].append({
                "dpr": dpr,
                "radius_css": radius,
                "panel_px": w * h,
                "a_blur_per_frame": timeit(a_per_frame),
                "b_cached_blur_composite": timeit(b_cached),
                "d_half_res_blur": timeit(d_half_res),
                "e_scene_plus_panel": timeit(e_frame),
            })

        def c_fake() -> None:
            frame = bd.copy()
            for alpha, col in ((0.45, (14, 20, 31)), (0.30, (22, 30, 44)), (0.10, (90, 120, 150))):
                frame.paste(Image.blend(frame.crop((0, 0, w, h)), Image.new("RGB", (w, h), col), alpha), (0, 0))
            frame.paste(Image.blend(frame.crop((0, 0, w, h)), nz, 0.04), (0, 0))
            frame.paste((255, 255, 255), (0, 0, w, max(1, dpr)))

        results["rows"].append({
            "dpr": dpr,
            "radius_css": None,
            "panel_px": w * h,
            "c_fake_glass": timeit(c_fake),
        })

    (OUT / "glass_blur_bench.json").write_text(json.dumps(results, indent=2) + "\n")

    print("| DPR | radius | panel px | A blur/frame | B cached | C fake glass | D half-res | E frame 1280×800 |")
    print("|---|---|---|---|---|---|---|---|")
    for row in results["rows"]:
        if row["radius_css"] is None:
            print(f"| {row['dpr']}× | — | {row['panel_px']:,} | — | — | "
                  f"{row['c_fake_glass']['mean_ms']:.2f} ms | — | — |")
        else:
            print(f"| {row['dpr']}× | {row['radius_css']} px | {row['panel_px']:,} | "
                  f"{row['a_blur_per_frame']['mean_ms']:.2f} ms (p95 {row['a_blur_per_frame']['p95_ms']:.2f}) | "
                  f"{row['b_cached_blur_composite']['mean_ms']:.2f} ms | — | "
                  f"{row['d_half_res_blur']['mean_ms']:.2f} ms | "
                  f"{row['e_scene_plus_panel']['mean_ms']:.2f} ms |")


if __name__ == "__main__":
    main()
