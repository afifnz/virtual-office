"""Measure Galuh's neck + body shoulder in the head's model frame (mm).

    python3 neck_probe.py 5173
"""
import json
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"
BASE = f"http://127.0.0.1:{PORT}"

PROBE = r"""
() => {
  const scene = window.__officeScene
  let head = null
  scene.traverse(o => { if (o.name === 'galuhHead') head = o })
  if (!head) return null
  head.updateWorldMatrix(true, true)
  const inv = head.matrixWorld.clone().invert()
  const V3 = window.__officeCamera.position.constructor
  const local = (o) => { const p = new V3(); o.getWorldPosition(p); p.applyMatrix4(inv); return p }
  const out = {}
  for (const n of ['Head', 'Neck', 'Chest', 'Abdomen', 'UpperArmL', 'UpperArmR', 'Hips']) {
    const o = scene.getObjectByName(n)
    out[n] = o ? [+local(o).x.toFixed(4), +local(o).y.toFixed(4), +local(o).z.toFixed(4)] : null
  }
  // top of the body mesh under the head: lowest torso vertex above the hem, so
  // we know where the shoulder/cloth hem actually sits
  let body = null
  scene.traverse(o => {
    if (body) return
    if (!o.isSkinnedMesh && !(o.isMesh && o.geometry && o.geometry.attributes.skinIndex)) return
    const p = o.geometry.attributes.position
    if (p && p.count > 2000) body = o
  })
  if (body) {
    const p = body.geometry.attributes.position
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    out.bodyLocalBBox = [+minY.toFixed(3), +maxY.toFixed(3)]
    out.bodyName = body.name
  }
  // hijab cloth: front hem and widest point, in head-local mm
  let cloth = null
  head.traverse(o => { if (o.isMesh && o.material && o.material.vertexColors) cloth = o })
  const cp = cloth.geometry.attributes.position
  let hemY = Infinity, widest = 0, widestY = 0
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i), x = cp.getX(i)
    if (y < hemY) hemY = y
    const hw = Math.abs(x + 0.0134)
    if (hw > widest) { widest = hw; widestY = y }
  }
  out.clothHemY = +hemY.toFixed(4)
  out.clothWidest = [+(widest * 1000).toFixed(1), +widestY.toFixed(4)]
  return out
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 900, "height": 700})
    pg.set_default_timeout(300000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(f"{BASE}/?still=1&front=1&face=default", wait_until="load")
    pg.wait_for_timeout(14000)
    for _ in range(10):
        r = pg.evaluate(PROBE)
        if r:
            print(json.dumps(r, indent=1))
            break
        pg.wait_for_timeout(2000)
    b.close()
