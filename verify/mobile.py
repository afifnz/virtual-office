"""Re-take the three mobile panel screenshots."""
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"


def click_text(page, selector, text):
    return page.evaluate(
        """([sel, t]) => {
            const el = [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(t));
            if (el) el.click();
            return !!el;
        }""",
        [selector, text],
    )


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                      is_mobile=True, has_touch=True)
    pg = m.new_page()
    pg.set_default_timeout(240000)
    pg.goto("http://127.0.0.1:4173/", wait_until="load")
    pg.wait_for_timeout(11000)

    click_text(pg, ".mobile-bar button", "Feed")
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/mobile-390-feed.png", timeout=240000)

    click_text(pg, ".feed.is-sheet .panel-head .icon-btn", "✕")
    pg.wait_for_timeout(1200)
    click_text(pg, ".mobile-bar button", "Tugas")
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/mobile-390-taskboard.png", timeout=240000)

    click_text(pg, ".taskboard .panel-head .icon-btn", "✕")
    pg.wait_for_timeout(1000)
    click_text(pg, ".mobile-bar button", "Agen")
    pg.wait_for_timeout(2200)
    pg.screenshot(path=f"{OUT}/mobile-390-roster.png", timeout=240000)
    b.close()
print("mobile shots refreshed")
