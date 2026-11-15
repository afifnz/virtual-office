import json
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"

JS = r"""
() => {
  const scene = window.__officeScene
  const cam = window.__officeCamera
  const heads = []
  scene.traverse(o => { if (o.name === 'galuhHead') heads.push(o) })
  const out = { heads: heads.length, cam: [cam.position.x, cam.position.y, cam.position.z], camQ: [cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w] }
  if (heads.length) {
    const h = heads[0]
    const chain = []
    let o = h
    while (o) {
      const e = o.matrixWorld.elements
      chain.push({ name: o.name || o.type, world: [e[12], e[13], e[14]].map(n => +n.toFixed(3)), rotY: +o.rotation.y.toFixed(3) })
      o = o.parent
    }
    out.chain = chain
    // project the head origin into NDC with a manual view/proj multiply
    const p = { x: chain[0].world[0], y: chain[0].world[1] + 0.09, z: chain[0].world[2] }
    cam.updateMatrixWorld(true)
    const inv = cam.matrixWorldInverse.elements
    const v = [
      inv[0]*p.x + inv[4]*p.y + inv[8]*p.z + inv[12],
      inv[1]*p.x + inv[5]*p.y + inv[9]*p.z + inv[13],
      inv[2]*p.x + inv[6]*p.y + inv[10]*p.z + inv[14],
    ]
    const pr = cam.projectionMatrix.elements
    const c = [
      pr[0]*v[0] + pr[4]*v[1] + pr[8]*v[2] + pr[12],
      pr[1]*v[0] + pr[5]*v[1] + pr[9]*v[2] + pr[13],
      pr[3]*v[0] + pr[7]*v[1] + pr[11]*v[2] + pr[15],
    ]
    out.ndc = [c[0]/c[3], c[1]/c[3]].map(n => +n.toFixed(2))
  }
  return out
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1100, "height": 900})
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(f"http://127.0.0.1:{PORT}/?still=1&front=1&cam=-6.0,1.20,8.20&aim=-6.0,1.185,7.58", wait_until="load")
    pg.wait_for_timeout(18000)
    print(json.dumps(pg.evaluate(JS), indent=1))
    b.close()
