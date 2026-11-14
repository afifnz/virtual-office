"""Frontal portrait evidence: tight face shot, then a centre crop with PIL.

    python3 verify/portrait.py galuh [front]

`front` asks the rig for a straight-on shot (?front=1) so left/right symmetry
can actually be judged; without it the portrait keeps the 28-degree 3/4 view.

The scene renders in software (swiftshader) at ~1-3 fps, so the script waits for
several real frames to be presented before it grabs the screenshot — otherwise
it can catch a frame from mid-flight and photograph the back of a chair.
"""
import subprocess
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
who = sys.argv[1] if len(sys.argv) > 1 else "galuh"
front = len(sys.argv) > 2 and sys.argv[2] == "front"
query = f"?face={who}" + ("&front=1" if front else "")

FIND_HEAD = """() => {
  const s = window.__officeScene, c = window.__officeCamera;
  if (!s || !c) return null;
  let best = null, bd = 99;
  s.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const h = bb.max.y - bb.min.y;
    if (h < 0.18 || h > 0.24 || bb.max.x > 0.09) return;
    const p = new (o.position.constructor)();
    o.getWorldPosition(p);
    const d = Math.hypot(p.x - c.position.x, p.z - c.position.z);
    if (d < bd) { bd = d; best = [p.x, p.y, p.z]; }
  });
  return best ? { head: best, d: bd } : null;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.on("console", lambda m: print("CONSOLE:", m.type, m.text) if m.type == "error" else None)
    pg.goto(f"http://127.0.0.1:4173/{query}", wait_until="load")
    pg.wait_for_timeout(40000)
    print(pg.evaluate(
        "() => { const c=window.__officeCamera; return c ? {p:[+c.position.x.toFixed(2),"
        "+c.position.y.toFixed(2),+c.position.z.toFixed(2)],fov:+c.fov.toFixed(1)} : null }"))
    pg.add_style_tag(content=".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}")
    # agents wander: wait until the avatar's head is actually in front of the
    # lens (0.75-1.6 m away) instead of photographing whoever walks past
    for _ in range(10):
        info = pg.evaluate(FIND_HEAD)
        if info and 0.45 < info["d"] < 1.6 and 0.85 < info["head"][1] < 1.05:
            print("head at", [round(v, 2) for v in info["head"]], "d", round(info["d"], 2))
            break
        pg.wait_for_timeout(3000)
    # software rendering runs at well under one frame a second: give the tween
    # time to finish and a couple more frames to be presented
    pg.wait_for_timeout(5000)
    shot = f"{OUT}/portrait-{who}.png"
    # a colleague can walk through the shot: retake until the middle of the
    # frame is skin rather than a shirt, a chair or the back of someone's head
    for attempt in range(3):
        pg.screenshot(path=shot, timeout=240000)
        im = Image.open(shot).convert("RGB")
        w, h = im.size
        px = im.crop((w // 2 - 40, h // 2 - 40, w // 2 + 40, h // 2 + 40)).resize((1, 1)).getpixel((0, 0))
        if px[0] > 100 and px[0] - px[2] > 30 and px[1] - px[2] > 10:
            print("centre pixel", px, "ok")
            break
        print("centre pixel", px, "blocked, retrying")
        pg.wait_for_timeout(15000)
    b.close()

# crop the centre square (the camera aims at the head) and upscale to 900px
crop = f"{OUT}/portrait-{who}-crop.png"
subprocess.run([
    "convert", shot, "-gravity", "center", "-crop", "900x900+0+70", "+repage",
    "-resize", "900x900", crop,
], check=True)
print("cropped ->", crop)
