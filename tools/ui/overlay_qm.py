#!/usr/bin/env python3
"""
Render the SWF's own Quick Match frame and diff the port against it.

`DefineSprite_1164` (Timeline_60) frame 37 IS the authored screen, text fields
and all, at the 800x600 stage. Drive the port at a viewport that resolves to
s=1 / stageW=800 / ox=0 and the two images are directly comparable, so every
offset shows up as a displaced edge instead of something to eyeball.

Usage:  python tools/ui/overlay_qm.py [frame] [--url http://localhost:5199/]
"""
import os
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2"
SRC = os.path.join(DEC, "sprites", "DefineSprite_1164_Raze2_fla.Timeline_60")
SC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(SC, "_qm")
os.makedirs(OUT, exist_ok=True)

FRAME = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else "37"
URL = "http://localhost:5199/"
if "--url" in sys.argv:
    URL = sys.argv[sys.argv.index("--url") + 1]

W, H = 800, 600

DUMP = """
() => { const out=[]; const walk=(n)=>{ if(!n) return;
  if (typeof n.text==='string' && n.text.trim()) { const b=n.getBounds();
    let vis=n.visible,p=n.parent; while(p){ if(!p.visible) vis=false; p=p.parent; }
    out.push({t:n.text,vis,x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}); }
  for(const c of (n.children||[])) walk(c); }; walk(window.__raze.app.stage); return out; }
"""


def render_swf(page):
    """Rasterise the authored frame at the 800x600 stage."""
    path = os.path.join(SRC, f"{FRAME}.svg")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    tree = ET.parse(path)
    root = tree.getroot()
    num = re.compile(r"-?\d+(?:\.\d+)?")
    sw = float(num.search(root.get("width", "0")).group())
    sh = float(num.search(root.get("height", "0")).group())
    # FFDec exports the frame on its own content bounds and wraps it in a
    # <g translate(ox, oy)>, so an SVG point is stage + (ox, oy). To frame the
    # 800x600 stage the viewBox origin is therefore +(ox, oy), not -.
    ox = oy = 0.0
    for g in root.iter("{http://www.w3.org/2000/svg}g"):
        n = num.findall(g.get("transform", ""))
        if len(n) >= 6:
            ox, oy = float(n[4]), float(n[5])
        break
    root.set("width", f"{W}px")
    root.set("height", f"{H}px")
    root.set("viewBox", f"{ox} {oy} {W} {H}")
    svg = ET.tostring(root, encoding="unicode")
    page.set_content(
        "<!doctype html><html><head><style>html,body{margin:0;padding:0;"
        "background:#000}svg{display:block}</style></head><body>" + svg + "</body></html>",
        wait_until="load")
    dest = os.path.join(OUT, "swf.png")
    page.screenshot(path=dest, clip={"x": 0, "y": 0, "width": W, "height": H})
    print(f"  swf frame {FRAME}: content {sw:.0f}x{sh:.0f}, origin ({ox:.1f},{oy:.1f})")
    return dest


def render_port(page):
    import time
    page.goto(URL, timeout=90000)
    page.wait_for_function("() => !!window.__raze", timeout=90000)
    page.wait_for_function(
        "() => window.__raze.current?.constructor?.name === 'MenuScreen'", timeout=300000)
    page.wait_for_timeout(1500)

    def box():
        return page.evaluate("""() => { const c=window.__raze.app.canvas.getBoundingClientRect();
          const r=window.__raze.app.renderer; return {l:c.left,t:c.top,sx:c.width/r.width,sy:c.height/r.height}; }""")

    end = time.time() + 25
    while time.time() < end:
        hits = [h for h in page.evaluate(DUMP) if h["vis"] and re.search("quick match", h["t"], re.I)]
        if hits:
            h, bx = hits[0], box()
            page.mouse.click(bx["l"] + h["x"] * bx["sx"], bx["t"] + h["y"] * bx["sy"])
            break
        page.wait_for_timeout(250)
    page.wait_for_function(
        "() => window.__raze.current?.constructor?.name === 'PlayScreen'", timeout=60000)
    page.wait_for_timeout(2500)

    print("  port chrome:", page.evaluate(
        "() => { const c = window.__raze.current.chrome;"
        "return { s: +c.s.toFixed(3), stageW: Math.round(c.stageW), ox: c.ox,"
        "leftW: Math.round(c.leftW), rightX: Math.round(c.rightX), rightW: Math.round(c.rightW) }; }"))
    dest = os.path.join(OUT, "port.png")
    page.screenshot(path=dest, clip={"x": 0, "y": 0, "width": W, "height": H})
    return dest


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle"])
    pg = b.new_page(viewport={"width": W, "height": H})
    swf = render_swf(pg)
    pg.close()
    pg2 = b.new_page(viewport={"width": W, "height": H})
    port = render_port(pg2)
    b.close()

a = Image.open(swf).convert("RGB")
c = Image.open(port).convert("RGB")
Image.blend(a, c, 0.5).save(os.path.join(OUT, "blend.png"))

# Edge-difference: structure, not colour — the port re-tints everything, so a
# raw pixel diff is noise. Compare local contrast instead.
def edges(im):
    g = im.convert("L")
    return ImageChops.difference(g, g.transform(
        g.size, Image.AFFINE, (1, 0, 1, 0, 1, 0), resample=Image.NEAREST))

d = ImageChops.difference(edges(a), edges(c)).point(lambda v: 255 if v > 34 else 0)
d.save(os.path.join(OUT, "edgediff.png"))

side = Image.new("RGB", (W * 2 + 12, H), (20, 20, 24))
side.paste(a, (0, 0)); side.paste(c, (W + 12, 0))
side.save(os.path.join(OUT, "side.png"))
print(f"\nwrote {OUT}\\swf.png, port.png, blend.png, edgediff.png, side.png")
