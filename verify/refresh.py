"""Refresh the three scene screenshots after a visual tweak."""
import subprocess
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
HIDE = ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
    pg.set_default_timeout(240000)
    pg.goto("http://127.0.0.1:4173/", wait_until="load")
    pg.wait_for_timeout(12000)
    pg.screenshot(path=f"{OUT}/desktop-1280-overview.png", timeout=240000)
    pg.add_style_tag(content=HIDE)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=f"{OUT}/desktop-1280-overview-clean.png", timeout=240000)
    pg.close()

    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                      is_mobile=True, has_touch=True)
    mp = m.new_page()
    mp.set_default_timeout(240000)
    mp.goto("http://127.0.0.1:4173/", wait_until="load")
    mp.wait_for_timeout(12000)
    mp.screenshot(path=f"{OUT}/mobile-390-default.png", timeout=240000)
    m.close()
    b.close()

subprocess.run(["cp", f"{OUT}/portrait-ndoro-kakung-crop.png", f"{OUT}/desktop-1280-face-crop.png"], check=True)
print("refreshed")
