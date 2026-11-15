"""Draw-call / triangle probe for the office scene, with a mocked API.

    python3 verify/layout_probe.py http://127.0.0.1:4173/?spot=tampak&still=1
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]

STATUS = [
    ("default", "working", ["telegram"]),
    ("dev", "reviewing", ["github"]),
    ("planner", "working", ["read_file"]),
    ("uiux", "idle", []),
    ("coder", "working", ["terminal"]),
    ("reviewer", "blocked", ["ast_grep"]),
    ("tester", "idle", []),
    ("edu", "working", ["write_file"]),
    ("edu-designer", "idle", []),
    ("edu-writer", "working", ["read_file"]),
    ("edu-reviewer", "idle", []),
]


def payload():
    now = time.time()
    agents = []
    for i, (aid, st, tools) in enumerate(STATUS):
        agents.append({
            "id": aid,
            "status": st,
            "last_active": now - (5 if st != "idle" else 400),
            "current": {"kind": "tool", "tools": tools} if tools else None,
            "today": {"sessions": 3 + i, "messages": 40 + i * 7, "tool_calls": 22 + i * 5,
                      "tokens": 120000 + i * 9000, "hourly": [0, 1, 2, 3, 5, 8, 6, 4, 3, 2, 1, 0]},
            "total": {"sessions": 120 + i, "messages": 2400 + i * 30},
            "task": "rapikan tata letak kantor" if st != "idle" else None,
            "source": "telegram" if i % 2 == 0 else "cli",
            "blocked": {"reason": "menunggu review", "since": now - 120, "tools": 4} if st == "blocked" else None,
        })
    return {
        "now": now,
        "gateway": {"state": "online", "version": "2.0.0", "updated_at": "2026-11-15T09:00:00Z"},
        "agents": agents,
        "feed": [],
        "tasks": [],
        "comms": [],
    }


PROBE = """async () => {
  const r = window.__officeRenderer, s = window.__officeScene;
  let skinned = 0, bones = 0, meshes = 0, lights = 0;
  s.traverse((o) => {
    if (o.isSkinnedMesh) { skinned++; meshes++; }
    else if (o.isMesh) meshes++;
    if (o.isBone) bones++;
    if (o.isLight) lights++;
  });
  const info = r ? { calls: r.info.render.calls, tris: r.info.render.triangles,
                     geoms: r.info.memory.geometries, tex: r.info.memory.textures,
                     programs: r.info.programs ? r.info.programs.length : -1 } : null;
  return JSON.stringify({ info, skinned, meshes, bones, lights });
}"""

url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg.set_default_timeout(240000)
    body = json.dumps(payload())
    pg.route("**/api/status", lambda route: route.fulfill(status=200, content_type="application/json", body=body))
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(18000)
    print(pg.evaluate(PROBE))
    b.close()
