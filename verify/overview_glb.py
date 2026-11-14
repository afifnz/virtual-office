"""Overview: the whole office with every agent, HUD hidden."""
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
url = sys.argv[1]
wait = int(sys.argv[2]) if len(sys.argv) > 2 else 30000
tag = sys.argv[3] if len(sys.argv) > 3 else "glb-overview"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.on("console", lambda m: print("CONSOLE:", m.type, m.text[:300]) if m.type == "error" else None)
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(wait)
    pg.add_style_tag(
        content=".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip,.chip,.top,.tabs,.brand{display:none!important}"
    )
    pg.wait_for_timeout(2500)
    pg.screenshot(path=f"{OUT}/{tag}.png", timeout=240000)
    b.close()
print("saved", f"{OUT}/{tag}.png")
