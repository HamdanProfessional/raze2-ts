#!/usr/bin/env python3
"""Bake the weapon pickup's lit base plate from the SWF.

`NodePickup` is itself a MovieClip, and its own art is the *stand* the pickup
sits on — the icon is painted separately by `bitscreen.paint`. The constructor
splits on the node's prefix (NodePickup.as:108-124):

    powerup ("p_")  ->  stop(); visible = false     no stand at all
    weapon  ("w_")  ->  gotoAndStop(2)              the lit stand, frame 2

Frames 3 and 4 are the same stand in green and yellow; nothing in the shipped
game selects them, so only frame 2 is baked.

Without it a floor weapon is just the gun silhouette lying on the ground — dark
art on dark floor, easy to walk straight past, which is exactly what it did.

Writes public/assets/pickups/base.png.
"""
import base64, os

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SRC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites\DefineSprite_579_NodePickup"
OUT = os.environ.get("RZ_PICKUP_OUT") or os.path.join(REPO, "public", "assets", "pickups")

FRAME = 2          # the weapon stand
SCALE = 4          # render oversized, downsample for clean edges


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 600, "height": 600})
        svg = open(os.path.join(SRC, f"{FRAME}.svg"), encoding="utf-8").read()
        b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
        pg.set_content(
            f'<body style="margin:0;background:transparent">'
            f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
            f'style="transform:scale({SCALE});transform-origin:0 0"></body>'
        )
        pg.wait_for_selector("#i")
        box = pg.query_selector("#i").bounding_box()
        pg.set_viewport_size({"width": max(8, int(box["width"] * SCALE) + 4),
                              "height": max(8, int(box["height"] * SCALE) + 4)})
        tmp = os.path.join(OUT, "_base.raw.png")
        pg.screenshot(path=tmp, omit_background=True)
        im = Image.open(tmp).convert("RGBA")
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
        im = im.resize((max(1, round(im.width / SCALE)),
                        max(1, round(im.height / SCALE))), Image.LANCZOS)
        im.save(os.path.join(OUT, "base.png"))
        os.remove(tmp)
        print(f"frame {FRAME} -> base.png  {im.width}x{im.height}")
        b.close()


if __name__ == "__main__":
    main()
