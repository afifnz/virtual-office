"""Final verification shots.

    python3 final_shots.py

  final-overview.png  the "tampak" spot, HUD hidden, every agent pinned to its desk
  final-closeup.png   one seated agent in profile: knees, feet, hands on the keyboard
"""
import subprocess
import sys
from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"
HIDE = ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip,.chip,.top,.tabs,.brand{display:none!important}"


def shot(url, path, viewport, dpr=1, wait=17000):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
        pg = b.new_page(viewport=viewport, device_scale_factor=dpr)
        pg.set_default_timeout(240000)
        pg.on("pageerror", lambda e: print("PAGEERROR:", e))
        pg.goto(url, wait_until="load")
        pg.wait_for_timeout(wait)
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(2500)
        pg.screenshot(path=path, timeout=240000)
        b.close()
    print("saved", path, Image.open(path).size)


# overview: the "tampak" preset (front elevation of the whole floor)
shot(f"http://127.0.0.1:{PORT}/?spot=tampak&still=1", f"{OUT}/final-overview.png", {"width": 1440, "height": 900})

# closeup: Dimas (coder) at (-14, -8.5) rot 0, seated at (-14, 0, -8.08) facing -Z.
# Stand 2 m off his left shoulder, a touch above the desk: the profile shows the
# level thigh, the knee under the desk, the sole on the floor and the hand on
# the keys.
shot(
    f"http://127.0.0.1:{PORT}/?still=1&cam=-11.85,0.86,-8.42&aim=-14.02,0.58,-8.30",
    f"{OUT}/_final-closeup-raw.png",
    {"width": 1200, "height": 800},
    dpr=2,
)
raw = Image.open(f"{OUT}/_final-closeup-raw.png")
w, h = raw.size
raw.crop((int(w * 0.18), int(h * 0.10), int(w * 0.82), int(h * 0.92))).save(f"{OUT}/final-closeup.png")
print("saved", f"{OUT}/final-closeup.png", Image.open(f"{OUT}/final-closeup.png").size)
