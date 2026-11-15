"""Layout screenshots for the new floor plan.

    python3 verify/layout_shots.py stills   # overview + one shot per room
    python3 verify/layout_shots.py walk     # frames of an idle agent mid-errand
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/virtual-office/verify"
import os

BASE = os.environ.get("OFFICE_URL", "http://127.0.0.1:4173/")
HIDE = ".hud,.roster,.feed,.card,.mobile-bar,.dpad,.prox-chip,.chip,.top,.tabs,.brand{display:none!important}"

AGENTS = [
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


def payload(all_idle=False):
    now = time.time()
    agents = []
    for i, (aid, st, tools) in enumerate(AGENTS):
        if all_idle:
            st, tools = "idle", []
        agents.append({
            "id": aid,
            "status": st,
            "last_active": now - 300,
            "current": {"kind": "tool", "tools": tools} if tools else None,
            "today": {"sessions": 3 + i, "messages": 40 + i * 7, "tool_calls": 22 + i * 5,
                      "tokens": 120000 + i * 9000, "hourly": [0, 1, 2, 3, 5, 8, 6, 4, 3, 2, 1, 0]},
            "total": {"sessions": 120 + i, "messages": 2400 + i * 30},
            "task": "rapikan tata letak kantor" if st != "idle" else None,
            "source": "telegram" if i % 2 == 0 else "cli",
            "blocked": {"reason": "menunggu review", "since": now - 120, "tools": 4} if st == "blocked" else None,
        })
    return {"now": now, "gateway": {"state": "online", "version": "2.0.0", "updated_at": "2026-11-15T09:00:00Z"},
            "agents": agents, "feed": [], "tasks": [], "comms": []}


def shot(pg, url, path, wait=14000):
    body = json.dumps(payload())
    pg.unroute("**/api/status")
    pg.route("**/api/status", lambda route: route.fulfill(status=200, content_type="application/json", body=body))
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(wait)
    pg.add_style_tag(content=HIDE)
    pg.wait_for_timeout(2000)
    pg.screenshot(path=path, timeout=240000)
    print("saved", path)


mode = sys.argv[1] if len(sys.argv) > 1 else "stills"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    pg = b.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    pg.set_default_timeout(240000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))

    if mode == "stills":
        shot(pg, BASE + "?spot=tampak&still=1", f"{OUT}/layout-overview.png")
        shot(pg, BASE + "?spot=lobby&still=1", f"{OUT}/layout-pendopo.png")
        shot(pg, BASE + "?spot=dev&still=1", f"{OUT}/layout-dev.png")
        shot(pg, BASE + "?spot=edu&still=1", f"{OUT}/layout-edu.png")
    else:
        body = json.dumps(payload(all_idle=True))
        pg.route("**/api/status", lambda route: route.fulfill(status=200, content_type="application/json", body=body))
        pg.goto(BASE + "?cam=-4.0,6.5,5.0&aim=-10.0,0.2,-7.0", wait_until="load")
        pg.wait_for_timeout(12000)
        pg.add_style_tag(content=HIDE)
        for t, name in [(14, "walk-a"), (12, "walk-b"), (12, "walk-c"), (12, "walk-d")]:
            pg.wait_for_timeout(t * 1000)
            pg.screenshot(path=f"{OUT}/_layout-{name}.png", timeout=240000)
            print("saved", f"{OUT}/_layout-{name}.png")
    b.close()
