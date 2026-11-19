"""Full screenshot + layout verification.

Needs the Go API on :8131 and `vite preview` on :4173, plus a fresh fixture:

    python3 deploy/make-fixture.py /tmp/hermes-demo
    python3 verify/shoot.py

Writes PNGs to verify/ and prints a JSON report (console errors, rect checks).
"""
import json
import subprocess

from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = [
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu-sandbox",
]
BASE = "http://127.0.0.1:4173/"
OUT = "/workspace/virtual-office/verify"
HIDE_UI = ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}"


def click_text(page, selector, text):
    return page.evaluate(
        """([sel, t]) => {
            const els = [...document.querySelectorAll(sel)];
            const el = els.find(e => e.textContent.trim().includes(t));
            if (el) el.click();
            return !!el;
        }""",
        [selector, text],
    )


def rects(page, selectors):
    return page.evaluate(
        """(sels) => {
            const out = {};
            for (const s of sels) {
                const el = document.querySelector(s);
                if (!el) { out[s] = null; continue; }
                const r = el.getBoundingClientRect();
                out[s] = {x: Math.round(r.x), y: Math.round(r.y),
                          w: Math.round(r.width), h: Math.round(r.height),
                          bottom: Math.round(r.bottom), right: Math.round(r.right)};
            }
            out.viewport = {w: innerWidth, h: innerHeight};
            out.overflowX = document.documentElement.scrollWidth > innerWidth;
            return out;
        }""",
        selectors,
    )


def overlap(a, b):
    if not a or not b:
        return 0
    x = max(0, min(a["right"], b["right"]) - max(a["x"], b["x"]))
    y = max(0, min(a["bottom"], b["bottom"]) - max(a["y"], b["y"]))
    return x * y


def main():
    report = {"desktop": {}, "mobile": {}, "errors": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)

        # ---------------- desktop ----------------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.set_default_timeout(240000)
        pg.on("pageerror", lambda e: report["errors"].append(f"desktop PAGEERROR: {e}"))
        pg.on(
            "console",
            lambda m: report["errors"].append(f"desktop console: {m.text}")
            if m.type == "error" and "favicon" not in m.text
            else None,
        )
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(12000)
        pg.screenshot(path=f"{OUT}/desktop-1280-overview.png", timeout=240000)
        pg.add_style_tag(content=HIDE_UI)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/desktop-1280-overview-clean.png", timeout=240000)
        report["desktop"]["overview_camera"] = pg.evaluate(
            "() => { const c=window.__officeCamera; return c ? "
            "[+c.position.x.toFixed(1), +c.position.y.toFixed(1), +c.position.z.toFixed(1)] : null }"
        )
        ctx.close()

        # close-up: ?face= deep link frames the head with a 30-degree lens
        fctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        fp = fctx.new_page()
        fp.set_default_timeout(240000)
        fp.on("pageerror", lambda e: report["errors"].append(f"portrait PAGEERROR: {e}"))
        fp.goto(BASE + "?face=ndoro-kakung", wait_until="load")
        fp.wait_for_timeout(12000)
        fp.add_style_tag(content=HIDE_UI)
        fp.wait_for_timeout(1500)
        fp.screenshot(path=f"{OUT}/desktop-1280-face-closeup.png", timeout=240000)
        report["desktop"]["portrait_camera"] = fp.evaluate(
            "() => { const c=window.__officeCamera; return c ? "
            "{p:[+c.position.x.toFixed(2),+c.position.y.toFixed(2),+c.position.z.toFixed(2)],"
            "fov:+c.fov.toFixed(1)} : null }"
        )
        fctx.close()

        # ---------------- mobile ----------------
        mctx = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        )
        mp = mctx.new_page()
        mp.set_default_timeout(240000)
        mp.on("pageerror", lambda e: report["errors"].append(f"mobile PAGEERROR: {e}"))
        mp.on(
            "console",
            lambda m: report["errors"].append(f"mobile console: {m.text}") if m.type == "error" else None,
        )
        mp.goto(BASE, wait_until="load")
        mp.wait_for_timeout(12000)
        mp.screenshot(path=f"{OUT}/mobile-390-default.png", timeout=240000)
        report["mobile"]["default_rects"] = rects(
            mp, [".hud", ".mobile-bar", ".dpad", ".prox-chip", ".feed", ".taskboard"]
        )

        click_text(mp, ".mobile-bar button", "Feed")
        mp.wait_for_timeout(2500)
        mp.screenshot(path=f"{OUT}/mobile-390-feed.png", timeout=240000)
        report["mobile"]["feed_rects"] = rects(mp, [".feed.is-sheet", ".mobile-bar", ".dpad", ".hud"])

        click_text(mp, ".feed.is-sheet .panel-head .icon-btn", "✕")
        mp.wait_for_timeout(1200)
        click_text(mp, ".mobile-bar button", "Tugas")
        mp.wait_for_timeout(2500)
        mp.screenshot(path=f"{OUT}/mobile-390-taskboard.png", timeout=240000)
        report["mobile"]["taskboard_rects"] = rects(mp, [".taskboard.is-full", ".column", ".filters"])

        click_text(mp, ".taskboard .panel-head .icon-btn", "✕")
        mp.wait_for_timeout(1000)
        click_text(mp, ".mobile-bar button", "Agen")
        mp.wait_for_timeout(2200)
        mp.screenshot(path=f"{OUT}/mobile-390-roster.png", timeout=240000)
        report["mobile"]["roster_rects"] = rects(mp, [".roster.is-drawer"])

        mctx.close()
        browser.close()

    d = report["mobile"].get("default_rects", {})
    f = report["mobile"].get("feed_rects", {})
    t = report["mobile"].get("taskboard_rects", {})
    checks = {
        "dpad_inside_viewport": bool(d.get(".dpad"))
        and d[".dpad"]["right"] <= d["viewport"]["w"]
        and d[".dpad"]["bottom"] <= d["viewport"]["h"],
        "bar_inside_viewport": bool(d.get(".mobile-bar"))
        and d[".mobile-bar"]["bottom"] <= d["viewport"]["h"]
        and d[".mobile-bar"]["right"] <= d["viewport"]["w"],
        "dpad_bar_overlap_px2": overlap(d.get(".dpad"), d.get(".mobile-bar")),
        "dpad_hud_overlap_px2": overlap(d.get(".dpad"), d.get(".hud")),
        "no_horizontal_overflow": not d.get("overflowX", False),
        "feed_sheet_covers_controls": overlap(f.get(".feed.is-sheet"), f.get(".dpad")),
        "pad_hidden_while_sheet_open": f.get(".dpad") is None,
        "feed_sheet_height_px": f.get(".feed.is-sheet", {}).get("h"),
        "taskboard_fullscreen": (t.get(".taskboard.is-full") or {}).get("h") == t.get("viewport", {}).get("h"),
        "taskboard_columns_stacked": (t.get(".column") or {}).get("w") is not None
        and t[".column"]["w"] > 300,
    }
    report["mobile"]["checks"] = checks

    # crop the face close-up for review
    subprocess.run(
        ["convert", f"{OUT}/desktop-1280-face-closeup.png", "-gravity", "center",
         "-crop", "1100x1100+0+40", "+repage", "-resize", "900x900",
         f"{OUT}/desktop-1280-face-crop.png"],
        check=True,
    )
    print(json.dumps(report, indent=1))


main()
