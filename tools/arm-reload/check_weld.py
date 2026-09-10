#!/usr/bin/env python3
"""Composite a baked arm onto a baked body exactly as the game welds them.

Both bakes are 1:1 native px out of the same SWF, and the shoulder track was
read off UnitMC's `arm1hold` placeholder — so pasting the arm's shoulder anchor
onto the body's shoulder point should reproduce the original's proportions with
no scale freedom left. If a weapon looks oversized in game, it should look
oversized here too; if it looks right here, the bake and the anchors are right
and any in-game discrepancy is a render-scale problem instead.

    python tools/arm-reload/check_weld.py [skin] [weapon ...]
"""
import os, sys, json
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
skin_man = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "skinAnim.json")))
arm_man = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "armAnim.json")))

SKIN = sys.argv[1] if len(sys.argv) > 1 else "raze"
WEAPONS = sys.argv[2:] or ["pistol", "shotgun", "sniper", "chaingun", "rocket"]

CW, CH = skin_man["cell"]
COLS = skin_man["cols"]
SAX, SAY = skin_man["anchor"]
idle = skin_man["states"]["idle"]

ACW, ACH = arm_man["cell"]
AAX, AAY = arm_man["anchor"]

FRAME = 1
sheet = Image.open(os.path.join(ROOT, "public", "assets", "skins", "anim", f"{SKIN}.png")).convert("RGBA")
idx = idle["start"] + (FRAME - 1)
body = sheet.crop(((idx % COLS) * CW, (idx // COLS) * CH, (idx % COLS + 1) * CW, (idx // COLS + 1) * CH))
# Shoulder track: clip px measured from the feet origin, y up = negative.
shx, shy = idle["shoulder"][FRAME - 1]

PAD = 130
out = Image.new("RGBA", ((CW + PAD * 2) * len(WEAPONS), CH + PAD * 2), (24, 26, 32, 255))
for i, wid in enumerate(WEAPONS):
    ox = i * (CW + PAD * 2)
    tile = Image.new("RGBA", (CW + PAD * 2, CH + PAD * 2), (0, 0, 0, 0))
    tile.paste(body, (PAD, PAD), body)
    # Feet origin inside the tile, then the shoulder relative to it.
    feet = (PAD + SAX * CW, PAD + SAY * CH)
    sh = (feet[0] + shx, feet[1] + shy)
    arm = Image.open(os.path.join(ROOT, "public", "assets", "arms-r2", wid, "idle.png")).convert("RGBA")
    tile.paste(arm, (int(round(sh[0] - AAX * ACW)), int(round(sh[1] - AAY * ACH))), arm)
    out.paste(tile, (ox, 0), tile)

dest = os.path.join(SC, "_weld.png")
out.save(dest)
print(f"skin={SKIN} body cell {CW}x{CH} shoulder=({shx},{shy})  arm cell {ACW}x{ACH}")
print("wrote", dest, out.size)
