import json
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
PORT = sys.argv[1] if len(sys.argv) > 1 else "5173"

JS = r"""
() => {
  const scene = window.__officeScene
  let head = null
  scene.traverse(o => { if (o.name === 'galuhHead') head = o })
  if (!head) return { error: 'no head' }
  const apply = (m, x, y, z) => {
    const e = m.elements
    return [
      e[0]*x + e[4]*y + e[8]*z + e[12],
      e[1]*x + e[5]*y + e[9]*z + e[13],
      e[2]*x + e[6]*y + e[10]*z + e[14],
    ]
  }
  const out = []
  head.traverse(o => {
    if (!o.isMesh) return
    o.geometry.computeBoundingBox()
    const bb = o.geometry.boundingBox
    const c = apply(o.matrixWorld, (bb.min.x+bb.max.x)/2, (bb.min.y+bb.max.y)/2, (bb.min.z+bb.max.z)/2)
    const e = o.matrixWorld.elements
    const sx = Math.hypot(e[0], e[1], e[2])
    const sy = Math.hypot(e[4], e[5], e[6])
    const sz = Math.hypot(e[8], e[9], e[10])
    out.push({
      name: o.name || o.type,
      mat: o.material?.type,
      color: o.material?.color ? '#' + o.material.color.getHexString() : null,
      vcol: !!o.material?.vertexColors,
      map: !!o.material?.map,
      tris: Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3),
      world: c.map(n => +n.toFixed(3)),
      size: [ (bb.max.x-bb.min.x)*sx, (bb.max.y-bb.min.y)*sy, (bb.max.z-bb.min.z)*sz ].map(n => +n.toFixed(3)),
      visible: o.visible,
    })
  })
  let calls = 0
  scene.traverse(o => { if (o.isMesh && o.visible) calls++ })
  return { cam: window.__officeCamera ? ['x','y','z'].map((k,i)=>+window.__officeCamera.position[k].toFixed(3)) : null, drawCalls: calls, meshes: out }
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1100, "height": 900})
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(f"http://127.0.0.1:{PORT}/?still=1&front=1&cam=-6.0,1.20,8.20&aim=-6.0,1.185,7.58", wait_until="load")
    pg.wait_for_timeout(20000)
    data = pg.evaluate(JS)
    b.close()

print(json.dumps(data, indent=1))
