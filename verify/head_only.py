"""Render only Galuh's head (everything else hidden) to see the geometry alone.

    python3 head_only.py [url_suffix]
"""
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
CAM = sys.argv[2] if len(sys.argv) > 2 else "-6.996,1.165,9.397&aim=-6.996,1.153,8.802"

JS = """
() => {
  const s = window.__officeScene
  let head = null
  s.traverse(o => { if (o.name === 'galuhHead') head = o })
  s.traverse(o => { if (o.isMesh || o.isSprite) o.visible = false })
  head.traverse(o => { if (o.isMesh) o.visible = true })
  // keep the hijab visible: it lives in the head group already
  return head.children.length
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 900, "height": 900})
    pg.set_default_timeout(240000)
    pg.goto(f"http://127.0.0.1:5173/?still=1&front=1&cam={CAM}", wait_until="load")
    pg.wait_for_timeout(15000)
    n = pg.evaluate(JS)
    print("head children", n)
    pg.wait_for_timeout(800)
    path = f"{OUT}/_headonly.png"
    pg.screenshot(path=path)
    b.close()
print("saved", path)
