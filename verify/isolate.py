"""Hide one head mesh at a time and measure what changes on the face.

    python3 isolate.py
"""
import json
from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
HIDE = ".app > *:not(.canvas-wrap){display:block!important} .hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip,.chip{display:none!important}"

LIST_JS = """
() => {
  const s = window.__officeScene
  let head = null
  s.traverse(o => { if (o.name === 'galuhHead') head = o })
  const out = []
  head.traverse(o => { if (o.isMesh) out.push({ c: o.material?.color ? '#'+o.material.color.getHexString() : '?', m: o.material?.type }) })
  return out
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 900, "height": 900})
    pg.set_default_timeout(240000)
    pg.goto("http://127.0.0.1:5173/?still=1&front=1&cam=-6.996,1.165,9.397&aim=-6.996,1.153,8.802", wait_until="load")
    pg.wait_for_timeout(16000)
    pg.add_style_tag(content=HIDE)
    pg.wait_for_timeout(1200)
    meshes = pg.evaluate(LIST_JS)
    print(json.dumps(meshes))
    pg.screenshot(path=f"{OUT}/_iso-base.png")
    base = Image.open(f"{OUT}/_iso-base.png").convert("RGB")
    w, h = base.size
    face = (int(w * 0.3), int(h * 0.22), int(w * 0.7), int(h * 0.62))
    results = []
    for i in range(len(meshes)):
        pg.evaluate(
            """(i) => {
              const s = window.__officeScene
              let head = null
              s.traverse(o => { if (o.name === 'galuhHead') head = o })
              let k = 0
              head.traverse(o => { if (o.isMesh) { o.visible = (k === i); k++ } })
            }""",
            i,
        )
        pg.wait_for_timeout(220)
        path = f"{OUT}/_iso{i}.png"
        pg.screenshot(path=path)
        im = Image.open(path).convert("RGB")
        d = ImageChops.difference(im.crop(face), base.crop(face))
        results.append((round(sum(ImageStat.Stat(d).mean) / 3, 2), i, meshes[i]))
    for r in sorted(results, reverse=True)[:8]:
        print(r)
    b.close()
