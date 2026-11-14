"""Portrait at the dev server, cropped square: eye symmetry check.

    python3 face_shot.py <agentId> [port] [tag]
"""
import subprocess
import sys
from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
who = sys.argv[1] if len(sys.argv) > 1 else "tester"
port = sys.argv[2] if len(sys.argv) > 2 else "5173"
tag = sys.argv[3] if len(sys.argv) > 3 else "face"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(f"http://127.0.0.1:{port}/?face={who}&front=1", wait_until="load")
    pg.wait_for_timeout(22000)
    pg.add_style_tag(content=".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}")
    pg.wait_for_timeout(2500)
    shot = f"{OUT}/_{tag}-{who}.png"
    pg.screenshot(path=shot, timeout=240000)
    b.close()

crop = f"{OUT}/{tag}-{who}.png"
subprocess.run(["convert", shot, "-gravity", "center", "-crop", "760x760+0+40", "+repage", crop], check=True)
print("saved", crop, Image.open(crop).size)
