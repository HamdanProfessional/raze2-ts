#!/usr/bin/env python3
"""Composite a baked arm onto a baked body exactly as the game welds them.

Everything here is 1:1 native px out of the same SWF, and the shoulder track was
read off UnitMC's `arm1hold` placeholder, so pasting each layer's shoulder anchor
onto the body's shoulder point reproduces the original's geometry with no scale
freedom left. Draw order matches Unit.drawFigure:

    arm2  ->  body  ->  arm1 back  ->  gun  ->  arm1 front

    python tools/arm-reload/check_weld.py                    # skins x one gun
    python tools/arm-reload/check_weld.py --gun sniper       # pick the weapon
    python tools/arm-reload/check_weld.py --guns pistol,rocket --skin raze
"""
import os, sys, json
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
R2 = os.path.join(ROOT, "src", "assets", "raze2")
skin_man = json.load(open(os.path.join(R2, "skinAnim.json")))
arm_man = json.load(open(os.path.join(R2, "armAnim.json")))

args = sys.argv[1:]


def opt(name, default=None):
    return args[args.index(name) + 1] if name in args else default


GUNS = (opt("--guns") or opt("--gun") or "sniper").split(",")
SKINS = (opt("--skin") or "raze,rambo,amarine,ajungle,mutate,zbiker,girl,space").split(",")
FRAME = int(opt("--frame", "0"))          # 0-based cell within the band

BCW, BCH = skin_man["cell"]
BCOLS = skin_man["cols"]
SAX, SAY = skin_man["anchor"]
idle = skin_man["states"]["idle"]

ACW, ACH = arm_man["cell"]
ACOLS = arm_man["cols"]
AAX, AAY = arm_man["anchor"]
BANDS = arm_man["bands"]


def cell(sheet, i, cw, ch, cols):
    x, y = (i % cols) * cw, (i // cols) * ch
    return sheet.crop((x, y, x + cw, y + ch))


PAD = 150
TW, TH = BCW + PAD * 2, BCH + PAD * 2
cols = SKINS if len(SKINS) > 1 else GUNS
rows = GUNS if len(SKINS) > 1 else SKINS
out = Image.new("RGBA", (TW * len(cols), TH * len(rows)), (24, 26, 32, 255))

for ri, rname in enumerate(rows):
    for ci, cname in enumerate(cols):
        skin, gun = (cname, rname) if len(SKINS) > 1 else (rname, cname)
        pose = arm_man["weapons"].get(gun)
        if not pose:
            print(f"  skip {gun}: no arm band")
            continue
        n = arm_man["poses"][pose]["count"]
        f = max(0, min(FRAME, n - 1))

        body_sheet = Image.open(
            os.path.join(ROOT, "public", "assets", "skins", "anim", f"{skin}.png")).convert("RGBA")
        body = cell(body_sheet, idle["start"], BCW, BCH, BCOLS)
        shx, shy = idle["shoulder"][0]

        skin_sheet = Image.open(
            os.path.join(ROOT, "public", "assets", "arms-r2", "skin", skin, f"{pose}.png")).convert("RGBA")
        gun_sheet = Image.open(
            os.path.join(ROOT, "public", "assets", "arms-r2", "gun", f"{gun}.png")).convert("RGBA")

        tile = Image.new("RGBA", (TW, TH), (0, 0, 0, 0))
        feet = (PAD + SAX * BCW, PAD + SAY * BCH)
        sh = (feet[0] + shx, feet[1] + shy)
        at = (int(round(sh[0] - AAX * ACW)), int(round(sh[1] - AAY * ACH)))

        def paste(img):
            tile.paste(img, at, img)

        paste(cell(skin_sheet, BANDS["arm2"] * n + f, ACW, ACH, ACOLS))
        tile.paste(body, (PAD, PAD), body)
        paste(cell(skin_sheet, BANDS["back"] * n + f, ACW, ACH, ACOLS))
        paste(cell(gun_sheet, f, ACW, ACH, ACOLS))
        paste(cell(skin_sheet, BANDS["front"] * n + f, ACW, ACH, ACOLS))
        out.paste(tile, (ci * TW, ri * TH), tile)

dest = os.path.join(SC, "_weld.png")
out.save(dest)
print(f"cols={cols}\nrows={rows}\nframe={FRAME}")
print("wrote", dest, out.size)
