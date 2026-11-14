"""Perf probe: draw calls, triangles, bone count, and rAF frame rate."""
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
url = sys.argv[1]

PROBE = """async () => {
  const r = window.__officeRenderer, s = window.__officeScene;
  let skinned = 0, bones = 0, meshes = 0;
  s.traverse((o) => {
    if (o.isSkinnedMesh) { skinned++; meshes++; }
    else if (o.isMesh) meshes++;
    if (o.isBone) bones++;
  });
  const info = r ? { calls: r.info.render.calls, tris: r.info.render.triangles,
                     geoms: r.info.memory.geometries, tex: r.info.memory.textures,
                     programs: r.info.programs ? r.info.programs.length : -1 } : null;
  // frame rate over 3 s of real animation
  const t0 = performance.now();
  let frames = 0;
  await new Promise((res) => {
    const tick = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const ms = (performance.now() - t0) / Math.max(1, frames);
  return JSON.stringify({ info, skinned, meshes, bones, fps: +(1000 / ms).toFixed(1), frameMs: +ms.toFixed(1) });
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.on("console", lambda m: print("CONSOLE:", m.type, m.text[:200]) if m.type == "error" else None)
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(30000)
    print(pg.evaluate(PROBE))
    b.close()
