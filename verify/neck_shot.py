"""Neck proof shots + model-space neck measurements for Galuh.

    python3 neck_shot.py before 5173     # writes verify/neck/before-*.png + JSON
    python3 neck_shot.py after  5174

Measures in model space (the unscaled pack space galuh.ts authors in), so the
numbers are comparable between builds regardless of camera:
  * chin->hem        : jaw bottom to the front hem of the drape (mm)
  * neck column      : jaw bottom to where the cloth first flares to shoulder
                       width (>= 1.55x the jaw half-width); this is the span
                       the eye reads as "neck" (mm)
  * jaw clearance    : closest cloth vertex to the chin point (mm)
"""
import json
import os
import sys
from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/.gotmp/wt-neck/verify/neck"
HIDE = ".app > *:not(.canvas-wrap){display:none!important} .canvas-wrap{inset:0!important}"

tag = sys.argv[1] if len(sys.argv) > 1 else "before"
PORT = sys.argv[2] if len(sys.argv) > 2 else "5173"
BASE = f"http://127.0.0.1:{PORT}"

PROBE = r"""
() => {
  const scene = window.__officeScene
  let head = null
  scene.traverse(o => { if (o.name === 'galuhHead') head = o })
  if (!head) return null
  head.updateWorldMatrix(true, true)
  let skull = null, cloth = null
  head.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return
    if (o.material && o.material.vertexColors) cloth = o
    if (o.name === 'galuhSkull') skull = o
  })
  if (!skull || !cloth) return { err: 'missing mesh' }
  const sp = skull.geometry.attributes.position
  let chinY = Infinity, topY = -Infinity
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (let i = 0; i < sp.count; i++) {
    const y = sp.getY(i)
    if (y < chinY) chinY = y
    if (y > topY) topY = y
    const x = sp.getX(i), z = sp.getZ(i)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const jawHalf = (maxX - minX) / 2

  const cp = cloth.geometry.attributes.position
  const bands = new Map()
  let hemFrontY = Infinity, hemLowY = Infinity
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i)
    const hw = Math.abs(x - cx)
    const b = Math.round(y / 0.002) * 0.002
    const cur = bands.get(b)
    if (cur === undefined || hw > cur) bands.set(b, hw)
    if (y < hemLowY) hemLowY = y
    if (z > cz + 0.045 && y < hemFrontY) hemFrontY = y
  }
  const prof = [...bands.entries()].sort((a, b) => b[0] - a[0])
  const flareTarget = jawHalf * 1.55
  let flareY = null
  for (const [y, hw] of prof) {
    if (y > chinY) continue
    if (hw >= flareTarget) { flareY = y; break }
  }
  let jawClear = Infinity
  for (let i = 0; i < cp.count; i++) {
    const dx = cp.getX(i) - cx, dy = cp.getY(i) - chinY, dz = cp.getZ(i) - cz
    const d = Math.hypot(dx, dy, dz)
    if (d < jawClear) jawClear = d
  }

  // world -> head-local helper, without needing a THREE global
  const V3 = window.__officeCamera.position.constructor
  const e = head.matrixWorld.elements
  const toWorld = (x, y, z) => [
    e[0]*x + e[4]*y + e[8]*z + e[12],
    e[1]*x + e[5]*y + e[9]*z + e[13],
    e[2]*x + e[6]*y + e[10]*z + e[14],
  ]
  const bone = (n) => {
    const o = scene.getObjectByName(n)
    if (!o) return null
    const p = new V3(); o.getWorldPosition(p)
    const m = new V3(0,0,0); m.copy(p)
    return [p.x, p.y, p.z]
  }
  const fl = Math.hypot(e[8], e[9], e[10]) || 1
  return {
    chinY, topY, cx, cz, jawHalf, hemFrontY, hemLowY, flareY, jawClear, flareTarget,
    neckCol: (chinY - (flareY ?? hemLowY)) * 1000,
    chinToHem: (chinY - hemFrontY) * 1000,
    chinToHemLow: (chinY - hemLowY) * 1000,
    profile: prof.filter((_, i) => i % 3 === 0).map(([y, hw]) => [+(y * 1000).toFixed(0), +(hw * 1000).toFixed(1)]),
    head: toWorld(cx, 1.647, cz), fwd: [e[8]/fl, e[9]/fl, e[10]/fl],
    chinWorld: toWorld(cx, chinY, cz),
    neckWorld: bone('Neck'), chestWorld: bone('Chest'),
  }
}
"""

VIEWS = {
    # dist, side (fraction of dist), lift, crop fraction of viewport, aim drop
    "macro": (0.50, 0.08, 0.010, 0.70, 0.030),
    "front": (0.60, 0.0, 0.008, 0.80, 0.004),
    "three": (0.52, 0.42, 0.055, 0.80, 0.004),
    "side": (0.55, 1.0, 0.02, 0.80, 0.004),
}


def load(pg, url, wait):
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(wait)


def main():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
        pg = b.new_page(viewport={"width": 860, "height": 860}, device_scale_factor=2)
        pg.set_default_timeout(300000)
        pg.on("pageerror", lambda e: print("PAGEERROR:", e))

        load(pg, f"{BASE}/?still=1&front=1&face=default", 12000)
        info = None
        for _ in range(20):
            info = pg.evaluate(PROBE)
            if info and not info.get("err"):
                break
            pg.wait_for_timeout(2000)
        if not info or info.get("err"):
            print("probe failed", info)
            b.close()
            return
        print(json.dumps({k: v for k, v in info.items() if k != "profile"}, indent=1))
        with open(f"{OUT}/{tag}-measure.json", "w") as f:
            json.dump(info, f, indent=1)

        hx, hy, hz = info["head"]
        if os.environ.get("MEASURE_ONLY"):
            b.close()
            return
        fx, fy, fz = info["fwd"]
        rx, rz = fz, -fx
        chin = info["chinWorld"]
        for name, (dist, side, lift, cropf, drop) in VIEWS.items():
            if name == "macro":
                ax = chin[0]
                ay = chin[1] - drop
                az = chin[2]
            else:
                ax, ay, az = hx, hy - drop, hz
            cam = [ax + fx * dist + rx * side * dist, ay + lift, az + fz * dist + rz * side * dist]
            url = (
                f"{BASE}/?still=1&front=1&face=default"
                f"&cam={cam[0]:.3f},{cam[1]:.3f},{cam[2]:.3f}"
                f"&aim={ax:.3f},{ay:.3f},{az:.3f}"
            )
            load(pg, url, 15000)
            pg.add_style_tag(content=HIDE)
            pg.wait_for_timeout(1200)
            raw = f"{OUT}/_{tag}-{name}-raw.png"
            pg.screenshot(path=raw, timeout=300000)
            im = Image.open(raw)
            w, h = im.size
            side_px = int(h * cropf)
            left = (w - side_px) // 2
            top = int(h * (0.04 if name != "macro" else 0.02))
            im.crop((left, top, left + side_px, top + side_px)).resize((720, 720), Image.LANCZOS).save(
                f"{OUT}/{tag}-{name}.png", optimize=True
            )
            print("saved", f"{OUT}/{tag}-{name}.png")

        load(pg, f"{BASE}/?still=1", 16000)
        pg.add_style_tag(content=HIDE)
        pg.wait_for_timeout(1500)
        raw = f"{OUT}/_{tag}-iso-raw.png"
        pg.screenshot(path=raw, timeout=300000)
        im = Image.open(raw).resize((900, int(900 * 860 / 860)), Image.LANCZOS)
        im.save(f"{OUT}/{tag}-iso.png", optimize=True)
        print("saved", f"{OUT}/{tag}-iso.png")
        b.close()


main()
