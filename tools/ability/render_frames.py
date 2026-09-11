#!/usr/bin/env python3
"""Rasterise the 11 frames of the body's `ability` clip (DefineSprite_249).

`MC.body.ability` is the single attachment slot on the character's back: it
shows the unit's ability kit normally, and the CTF flag while carrying one
(`NodeCtfFlag.capture`: gotoAndStop("flag" + team)). FFDec flattens the clip to
frame 1 inside the body export, so it has to be rendered from its own symbol.

Writes tools/ability/frames/<n>.png plus a contact sheet for identification.
"""
import os, base64
from playwright.sync_api import sync_playwright
from PIL import Image

DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2"
SRC = os.path.join(DEC, "sprites", "DefineSprite_249")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frames")
os.makedirs(OUT, exist_ok=True)
SCALE = 3  # render big so small kit items are legible for identification

with sync_playwright() as p:
    b = p.chromium.launch(args=["--force-color-profile=srgb"])
    pg = b.new_page(viewport={"width": 400, "height": 400})
    for n in range(1, 12):
        svg = open(os.path.join(SRC, f"{n}.svg"), encoding="utf-8").read()
        b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        pg.set_content(
            f'<body style="margin:0;background:transparent">'
            f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
            f'style="image-rendering:auto;transform:scale({SCALE});transform-origin:0 0"></body>'
        )
        pg.wait_for_selector("#i")
        el = pg.query_selector("#i")
        box = el.bounding_box()
        pg.set_viewport_size({"width": max(8, int(box["width"] * SCALE) + 4),
                              "height": max(8, int(box["height"] * SCALE) + 4)})
        pg.screenshot(path=os.path.join(OUT, f"{n}.png"), omit_background=True)
    b.close()

ims = [Image.open(os.path.join(OUT, f"{n}.png")).convert("RGBA") for n in range(1, 12)]
w = max(i.width for i in ims); h = max(i.height for i in ims)
sheet = Image.new("RGBA", (w * 6, h * 2 + 24), (32, 34, 40, 255))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % 6) * w, (i // 6) * h), im)
sheet.save(os.path.join(OUT, "contact.png"))
print("frames written to", OUT)
print("sizes:", [(n + 1, ims[n].size) for n in range(11)])
