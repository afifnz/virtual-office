"""Dead-on face shot + mirror-symmetry score.

The portrait camera stands 17 degrees off the face, which by itself makes one
eye look bigger than the other. This pins the lens exactly on the face normal
(?cam/?aim) and then compares the left half of the eye band with the mirrored
right half, so "the eyes are asymmetric" can be answered with a number.

    python3 face_sym.py <agentId> [port]
"""
import json
import sys
from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
who = sys.argv[1] if len(sys.argv) > 1 else "tester"
port = sys.argv[2] if len(sys.argv) > 2 else "5173"

# agent -> desk, from lib/agents.ts
DESK = {
    "default": (-6, 8, 3.14159), "dev": (-11, -9.5, 1.5708), "planner": (-18, -8.5, 0),
    "uiux": (-21, -9.5, -1.5708), "coder": (-14, -8.5, 0), "reviewer": (-18, -10.5, 3.14159),
    "tester": (-14, -10.5, 3.14159), "edu": (20, -9.5, 1.5708), "edu-designer": (17, -8.5, 0),
    "edu-writer": (17, -10.5, 3.14159), "edu-reviewer": (14, -10.5, 3.14159),
}
x, z, rot = DESK[who]
seatX = x + __import__("math").sin(rot) * 0.42
seatZ = z + __import__("math").cos(rot) * 0.42
# face normal in world: the avatar faces -Z locally, rotated by rot
fx, fz = -__import__("math").sin(rot), -__import__("math").cos(rot)
HEAD = 1.19
cam = (seatX + fx * 0.95, HEAD + 0.02, seatZ + fz * 0.95)
url = (f"http://127.0.0.1:{port}/?still=1&cam={cam[0]:.3f},{cam[1]:.3f},{cam[2]:.3f}"
       f"&aim={seatX:.3f},{HEAD:.3f},{seatZ:.3f}")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 900, "height": 900}, device_scale_factor=2)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(20000)
    pg.add_style_tag(content=".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}")
    pg.wait_for_timeout(2000)
    shot = f"{OUT}/face-sym-{who}.png"
    pg.screenshot(path=shot, timeout=240000)
    b.close()

im = Image.open(shot).convert("RGB")
w, h = im.size
# the head fills the middle of the frame; take a band across the eyes
box = (int(w * 0.24), int(h * 0.30), int(w * 0.76), int(h * 0.62))
face = im.crop(box)
face.save(f"{OUT}/face-sym-{who}-crop.png")

# mirror score on the tight eye band
ew, eh = face.size
band = face.crop((0, int(eh * 0.24), ew, int(eh * 0.52)))
mirror = band.transpose(Image.FLIP_LEFT_RIGHT)
diff = ImageChops.difference(band, mirror)
stat = ImageStat.Stat(diff)
mean = sum(stat.mean) / 3
print(json.dumps({
    "agent": who,
    "shot": shot,
    "crop": f"{OUT}/face-sym-{who}-crop.png",
    "band_size": band.size,
    "mirror_mean_abs_diff": round(mean, 2),
    "mirror_rms": round(sum(stat.rms) / 3, 2),
}))
