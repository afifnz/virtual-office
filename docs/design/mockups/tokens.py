"""Design tokens for the three R&D directions (docs only, no production import).

Every colour pair the documents quote is computed here, so the DOCX, the
markdown source and the mockups cannot drift apart. Contrast follows WCAG 2.x
relative luminance (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio).

Glass surfaces are translucent, so a text ratio is only meaningful against the
*composited* result. Each direction therefore declares two backdrops — the
darkest and the brightest thing that can sit behind its panels — and the table
reports the worse of the two.

Run: python3 docs/design/mockups/tokens.py  -> prints a markdown table and
writes tokens.json next to this file.
"""
from __future__ import annotations

import json
from pathlib import Path

OUT = Path(__file__).resolve().parent


# ------------------------------------------------------------------ colour math
def _srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def luminance(h: str) -> float:
    r, g, b = (v / 255 for v in hex_rgb(h))
    return 0.2126 * _srgb_to_lin(r) + 0.7152 * _srgb_to_lin(g) + 0.0722 * _srgb_to_lin(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


def over(fg: str, alpha: float, bg: str) -> str:
    """Composite a translucent surface colour over a backdrop, in sRGB."""
    fr, fg_, fb = hex_rgb(fg)
    br, bg_, bb = hex_rgb(bg)
    return "#%02X%02X%02X" % (
        round(fr * alpha + br * (1 - alpha)),
        round(fg_ * alpha + bg_ * (1 - alpha)),
        round(fb * alpha + bb * (1 - alpha)),
    )


# ------------------------------------------------------------------ directions
SKY = {
    "id": "sky-lobby",
    "name": "Sky Lobby",
    "tagline": "dusk metropolis, frosted dark glass, amber accent",
    "mode": "dark",
    "surface": ("#141B2E", 0.62),      # glass fill
    "surface_solid": "#141B2E",         # fallback / reduced-transparency
    "backdrops": ["#0B1020", "#3A2A33"],  # darkest room, brightest dusk sky
    "border": "#FFFFFF", "border_a": 0.16,
    "highlight": "#FFFFFF", "highlight_a": 0.30,
    "ink": "#F2F5FA",
    "ink_dim": "#C6D0E0",
    "muted": "#93A0B6",
    "accent": "#F0B45A",
    "accent_deep": "#A9741F",
    "accent_ink": "#1A1206",
    "page": "#080C16",
    "floor": "#1A2230",
    "wall": "#121A29",
    "desk": "#243044",
    "desk_top": "#39485F",
    "status": {
        "working": "#F2B434", "reviewing": "#A98CE0", "idle": "#6FB1E8",
        "blocked": "#FFC93B", "offline": "#8B93A5", "ok": "#7FC08C", "danger": "#E2705F",
    },
    "status_ink": {
        "working": "#1A1206", "reviewing": "#120A22", "idle": "#061421",
        "blocked": "#1A1206", "offline": "#0D1119", "ok": "#07150A", "danger": "#1B0705",
    },
    "city": {
        "sky_top": "#0C1222", "sky_mid": "#2B3350", "sky_low": "#8A5560", "horizon": "#E0A06A",
        "layers": ["#0E1626", "#16203A", "#1D2A47", "#26344F"],
        "window": "#F3C57B", "window_cool": "#9FD8E8",
    },
    "type": {"family": "system-ui / Inter", "body": 12.5, "label": 11, "title": 15, "display": 22},
}

DAY = {
    "id": "daylight-atrium",
    "name": "Daylight Atrium",
    "tagline": "bright daylight, milky white glass, blue accent, the cleanest of the three",
    "mode": "light",
    "surface": ("#FFFFFF", 0.66),
    "surface_solid": "#F7FAFD",
    "backdrops": ["#E9EFF6", "#B9CBDA"],
    "border": "#0F2440", "border_a": 0.20,
    "highlight": "#FFFFFF", "highlight_a": 0.85,
    "ink": "#16202E",
    "ink_dim": "#41506A",
    "muted": "#556377",
    "accent": "#1D4ED8",
    "accent_deep": "#1D4ED8",
    "accent_ink": "#FFFFFF",
    "page": "#EEF3F8",
    "floor": "#E3EAF2",
    "wall": "#DDE6F0",
    "desk": "#FFFFFF",
    "desk_top": "#F2F6FA",
    "status": {
        "working": "#A16207", "reviewing": "#6D28D9", "idle": "#1D4ED8",
        "blocked": "#B45309", "offline": "#5F6A7D", "ok": "#15803D", "danger": "#B91C1C",
    },
    "status_ink": {
        "working": "#FFFFFF", "reviewing": "#FFFFFF", "idle": "#FFFFFF",
        "blocked": "#FFFFFF", "offline": "#FFFFFF", "ok": "#FFFFFF", "danger": "#FFFFFF",
    },
    "city": {
        "sky_top": "#A9CBE8", "sky_mid": "#CFE3F3", "sky_low": "#E8F3FB", "horizon": "#F7FBFF",
        "layers": ["#B9CBDE", "#A6BACF", "#93A9C1", "#7F97B1"],
        "window": "#FBFDFF", "window_cool": "#EAF3FB",
    },
    "type": {"family": "system-ui / Inter", "body": 13, "label": 11, "title": 15, "display": 22},
}

NEON = {
    "id": "neon-metro",
    "name": "Neon Metro",
    "tagline": "night city, neon reflections, black glass with glowing edges",
    "mode": "dark",
    "surface": ("#0B0E1C", 0.70),
    "surface_solid": "#0B0E1C",
    "backdrops": ["#05060E", "#241033"],
    "border": "#22D3EE", "border_a": 0.45,
    "highlight": "#67E8F9", "highlight_a": 0.40,
    "ink": "#EAF2FF",
    "ink_dim": "#B9C6E0",
    "muted": "#8493B0",
    "accent": "#22D3EE",
    "accent_deep": "#0E7490",
    "accent_ink": "#04141A",
    "page": "#04050B",
    "floor": "#0C1020",
    "wall": "#0A0C18",
    "desk": "#141A30",
    "desk_top": "#1E2742",
    "status": {
        "working": "#F2B434", "reviewing": "#C084FC", "idle": "#38BDF8",
        "blocked": "#FDE047", "offline": "#7A8499", "ok": "#4ADE80", "danger": "#FB7185",
    },
    "status_ink": {
        "working": "#1A1206", "reviewing": "#160A2B", "idle": "#04141A",
        "blocked": "#1A1206", "offline": "#0A0D14", "ok": "#04140A", "danger": "#1B0709",
    },
    "city": {
        "sky_top": "#04040C", "sky_mid": "#0B0B22", "sky_low": "#2A0F3A", "horizon": "#7A1E5A",
        "layers": ["#080A14", "#0D1022", "#141833", "#1C2145"],
        "window": "#67E8F9", "window_cool": "#F472B6",
    },
    "type": {"family": "system-ui / Inter + mono numerics", "body": 12.5, "label": 10.5, "title": 15, "display": 22},
}

DIRECTIONS = [SKY, DAY, NEON]


def surface_hex(d: dict, backdrop: str) -> str:
    fill, a = d["surface"]
    return over(fill, a, backdrop)


def contrast_rows() -> list[dict]:
    rows = []
    for d in DIRECTIONS:
        for key in ("ink", "ink_dim", "muted", "accent"):
            worst = min(contrast(d[key], surface_hex(d, b)) for b in d["backdrops"])
            rows.append({"direction": d["name"], "pair": f"{key} on glass", "ratio": worst})
        for st, col in d["status"].items():
            worst = min(contrast(col, surface_hex(d, b)) for b in d["backdrops"])
            rows.append({"direction": d["name"], "pair": f"status {st} (dot, 3:1)", "ratio": worst})
        for st, col in d["status"].items():
            rows.append({"direction": d["name"], "pair": f"status {st} chip text", "ratio": contrast(d["status_ink"][st], col)})
        rows.append({"direction": d["name"], "pair": "accent button text", "ratio": contrast(d["accent_ink"], d["accent"])})
    return rows


def main() -> None:
    rows = contrast_rows()
    payload = {"directions": DIRECTIONS, "contrast": rows}
    (OUT / "tokens.json").write_text(json.dumps(payload, indent=2) + "\n")
    print("| Direction | Pair | Ratio | AA |")
    print("|---|---|---|---|")
    for r in rows:
        need = 3.0 if "dot" in r["pair"] else 4.5
        print(f"| {r['direction']} | {r['pair']} | {r['ratio']}:1 | {'pass' if r['ratio'] >= need else 'FAIL'} |")


if __name__ == "__main__":
    main()
