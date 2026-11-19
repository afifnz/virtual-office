"""Before/after evidence sheet for the lobby agent's avatar.

    python3 verify/ndoro_shots.py before [port] [tag]
    python3 verify/ndoro_shots.py after  [port] [tag]

Captures, in one browser run:
  front   ?face=default&front=1&still=1        (dead-on portrait)
  three   ?face=default&still=1                (3/4 portrait)
  side    ?face=default&still=1&cam=..&aim=..  (profile, lens pinned)
  body    ?face=default&still=1&cam=..&aim=..  (full body, seated)
  room    ?still=1                             (isometric room, 1280x800)
  lobby   ?spot=lobby&still=1                  (the reception corner, wider)
  mobile  ?still=1                             (390x844)

Each portrait also gets a `-crop` square, cut around the head projected into the
screenshot (2x device pixel ratio), so the face fills the frame.

The scene renders in software (swiftshader), so every navigation waits for real
frames before grabbing; budget ~1 min per shot.
"""
import json
import os
import subprocess
import sys

from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage",
        "--renderer-process-limit=1", "--disable-extensions", "--mute-audio"]
OUT = os.environ.get("SHOT_OUT", "/workspace/.gotmp/ndoro-shots")
DPR = 1.5
HIDE = ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip{display:none!important}"
BASE = "http://127.0.0.1:"

tag = sys.argv[1] if len(sys.argv) > 1 else "shot"
port = sys.argv[2] if len(sys.argv) > 2 else "5176"
suffix = sys.argv[3] if len(sys.argv) > 3 else tag
only = sys.argv[4].split(",") if len(sys.argv) > 4 else None
want = lambda name: only is None or name in only
os.makedirs(OUT, exist_ok=True)

# head centre in world space + where it lands on screen (CSS px)
HEAD_PROBE = """
() => {
  const scene = window.__officeScene, cam = window.__officeCamera;
  if (!scene || !cam) return null;
  let head = null;
  scene.traverse((o) => { if (!head && o.isBone && o.name === 'Head') head = o; });
  if (!head) return null;
  const p = head.getWorldPosition(new head.position.constructor());
  const v = p.clone().project(cam);
  return { world: [p.x, p.y, p.z],
           screen: [(v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight] };
}
"""


def head_probe(pg, tries=20):
    for _ in range(tries):
        got = pg.evaluate(HEAD_PROBE)
        if got:
            return got
        pg.wait_for_timeout(2000)
    return None


def crop_face(path, probe):
    x, y = probe["screen"]
    # the probe reports CSS pixels; the screenshot is DPR times larger
    cx, cy, half = int(x * DPR), int(y * DPR), 300
    subprocess.run(["convert", path, "-gravity", "NorthWest",
                    "-crop", f"{half * 2}x{half * 2}+{cx - half}+{cy - half}", "+repage",
                    path.replace(".png", "-crop.png")], check=True)


def shot(pg, url, name, probe=None, wait=12000, hide=True):
    pg.goto(BASE + port + "/" + url, wait_until="load")
    pg.wait_for_timeout(wait)
    if hide:
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(1500)
    path = f"{OUT}/{suffix}-{name}.png"
    pg.screenshot(path=path, timeout=240000)
    if probe is not None:
        now = head_probe(pg, tries=3)
        if now:
            crop_face(path, now)
    print("saved", path)


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 960, "height": 720}, device_scale_factor=DPR)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))

    # 3/4 first: it also tells us where the head is in world space
    pg.goto(BASE + port + "/?face=default&still=1", wait_until="load")
    pg.wait_for_timeout(12000)
    if want("three"):
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{OUT}/{suffix}-three.png", timeout=240000)
        now = head_probe(pg, tries=3)
        if now:
            crop_face(f"{OUT}/{suffix}-three.png", now)
        print("saved", f"{OUT}/{suffix}-three.png")
    probe = head_probe(pg)
    if not probe:
        raise SystemExit("no head bone in the scene")
    print("head:", json.dumps(probe))

    hx, hy, hz = probe["world"]
    side_cam = f"{hx - 0.92:.2f},{hy + 0.02:.2f},{hz + 0.10:.2f}"
    side_aim = f"{hx:.2f},{hy - 0.01:.2f},{hz:.2f}"
    body_cam = f"{hx + 0.75:.2f},1.05,{hz + 1.55:.2f}"
    body_aim = f"{hx:.2f},0.80,{hz - 0.05:.2f}"

    if want("front"):
        shot(pg, "?face=default&front=1&still=1", "front", probe=True)
    if want("side"):
        shot(pg, f"?face=default&still=1&cam={side_cam}&aim={side_aim}", "side", probe=True)
    if want("body"):
        shot(pg, f"?face=default&still=1&cam={body_cam}&aim={body_aim}", "body")

    # room, desktop 1280x800, with the roster panel visible: label + isometric proof
    pg.close()
    if want("room") or want("lobby"):
        pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
        pg.set_default_timeout(240000)
        pg.on("pageerror", lambda e: print("PAGEERROR:", e))
        if want("room"):
            pg.goto(BASE + port + "/?still=1", wait_until="load")
            pg.wait_for_timeout(16000)
            names = pg.evaluate("""() => [...document.querySelectorAll('.roster-name')]
                .map((n) => n.textContent.trim())""")
            print("roster DOM names:", json.dumps(names, ensure_ascii=False))
            pg.screenshot(path=f"{OUT}/{suffix}-room.png", timeout=240000)
            print("saved", f"{OUT}/{suffix}-room.png")
        if want("lobby"):
            shot(pg, "?spot=lobby&still=1", "lobby", wait=12000)
    b.close()

    # phone
    if want("mobile"):
        b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
        m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1,
                          is_mobile=True, has_touch=True)
        mp = m.new_page()
        mp.set_default_timeout(240000)
        mp.goto(BASE + port + "/?still=1", wait_until="load")
        mp.wait_for_timeout(16000)
        mp.screenshot(path=f"{OUT}/{suffix}-mobile.png", timeout=240000)
        print("saved", f"{OUT}/{suffix}-mobile.png")
        b.close()