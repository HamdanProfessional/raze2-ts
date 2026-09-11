#!/usr/bin/env python3
"""Bake the authentic Raze 2 power-up icons from the SWF.

`NodePickup.EnterFrame` paints each floor power-up with
`bitscreen.paint(..., "pickups0", id, 1)`, and `BH.setup` builds that atlas by
walking a clip and keying every frame by its **frame label**. That clip is
`DefineSprite_1719`, whose 8 labels are exactly the pickup ids:

    1 sshield   2 bshield   3 shealth   4 bhealth
    5 invin     6 damage    7 mirror    8 rapid

The port had been showing icons lifted from a *Raze 1* symbol instead, which is
why `rapid` had no art at all. FFDec drops frame labels on export, so the
label->frame map above comes from `tools/ability/frame_labels.py` reading the
binary FrameLabel (tag 43) records.

Rasterised through Chromium rather than cairosvg — same approach as
`tools/ability/render_frames.py`, and it avoids a native cairo dependency on
Windows. Writes public/assets/pickups/<port kind>.png, cropped to content.
"""
import base64, os

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SRC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites\DefineSprite_1719"
# Set RZ_PICKUP_OUT to bake somewhere else first and eyeball the result before
# replacing the shipped icons.
OUT = os.environ.get("RZ_PICKUP_OUT") or os.path.join(REPO, "public", "assets", "pickups")

# SWF frame -> the port's PickupKind. `s`/`b` are small/big, not super/big
# (NodePickup.as:168+: sshield=shield(50), bshield=shield(100),
# shealth=heal(50), bhealth=heal(100)).
FRAMES = {
    1: "shield",      # sshield - shield(50)
    2: "shieldBig",   # bshield - shield(100)
    3: "health",      # shealth - heal(50)
    4: "healthBig",   # bhealth - heal(100)
    5: "invin",
    6: "ddamage",     # damage
    7: "mirror",      # reflect - see SKIP below
    8: "rapid",
}

# Frame 7 is a real atlas entry (the reflect power-up) but no map in the game
# places one, and the port has no matching PickupKind — so it is listed above to
# document the atlas, and skipped here rather than shipped as a dead asset.
SKIP = {"mirror"}

# `fade` deliberately has no entry: Raze 2 has no fade/cloak *pickup* (cloak is
# an ability), so public/assets/pickups/fade.png stays as it is.

# Render oversized and downsample: the atlas art is authored small and the
# floater is drawn at roughly authored size, so this keeps the edges clean.
SCALE = 4


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 400, "height": 400})
        for frame, kind in sorted(FRAMES.items()):
            if kind in SKIP:
                print(f"frame {frame} -> {kind}: skipped (unused by any map)")
                continue
            svg = open(os.path.join(SRC, f"{frame}.svg"), encoding="utf-8").read()
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
            tmp = os.path.join(OUT, f"_{kind}.raw.png")
            pg.screenshot(path=tmp, omit_background=True)

            im = Image.open(tmp).convert("RGBA")
            bbox = im.getbbox()
            if bbox:
                im = im.crop(bbox)
            im = im.resize((max(1, round(im.width / SCALE)),
                            max(1, round(im.height / SCALE))), Image.LANCZOS)
            im.save(os.path.join(OUT, f"{kind}.png"))
            os.remove(tmp)
            print(f"frame {frame} -> {kind}.png  {im.width}x{im.height}")
        b.close()


if __name__ == "__main__":
    main()
