"""Office portrait: ?face=<id>&front=1, HUD hidden, cropped to 900px."""
import subprocess
import sys
from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
who = sys.argv[1]
wait = int(sys.argv[2]) if len(sys.argv) > 2 else 30000
tag = sys.argv[3] if len(sys.argv) > 3 else "glb"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.on("console", lambda m: print("CONSOLE:", m.type, m.text[:300]) if m.type == "error" else None)
    pg.goto(f"http://127.0.0.1:4174/?face={who}&front=1", wait_until="load")
    pg.wait_for_timeout(wait)
    pg.add_style_tag(content=".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}")
    pg.wait_for_timeout(2500)
    shot = f"{OUT}/_raw-{tag}-{who}.png"
    pg.screenshot(path=shot, timeout=240000)
    print("cam", pg.evaluate("() => { const c=window.__officeCamera; return c ? [c.position.x.toFixed(2), c.position.y.toFixed(2), c.position.z.toFixed(2), c.fov.toFixed(0)] : null }"))
    b.close()

crop = f"{OUT}/glb-portrait-{who}.png"
subprocess.run(["convert", shot, "-gravity", "center", "-crop", "900x900+0+40", "+repage", "-resize", "900x900", crop], check=True)
print("cropped ->", crop)
