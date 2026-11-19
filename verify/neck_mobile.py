"""Mobile 390x844 proof shot for the Ndoro Kakung neck fix.

    python3 neck_mobile.py before 5173
    python3 neck_mobile.py after  5188
"""
import sys
from playwright.sync_api import sync_playwright

CHROME = "/opt/playwright/chromium-1255/chrome-linux64/chrome"
ARGS = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"]
OUT = "/workspace/.gotmp/wt-neck/verify/neck"
tag = sys.argv[1] if len(sys.argv) > 1 else "before"
PORT = sys.argv[2] if len(sys.argv) > 2 else "5173"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=ARGS, headless=True)
    m = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                      is_mobile=True, has_touch=True)
    pg = m.new_page()
    pg.set_default_timeout(300000)
    pg.on("pageerror", lambda e: print("PAGEERROR:", e))
    pg.goto(f"http://127.0.0.1:{PORT}/?still=1&face=default&front=1", wait_until="load")
    pg.wait_for_timeout(16000)
    pg.screenshot(path=f"{OUT}/{tag}-mobile.png", timeout=300000)
    print("saved", f"{OUT}/{tag}-mobile.png")
    b.close()
