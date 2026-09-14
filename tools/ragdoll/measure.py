"""
Measure the eight PhysActor ragdoll part symbols.

`PhysActor.createPart` never passes a size: it instantiates the part clip,
`gotoAndStop(skin)`, and derives the collision shape from the clip's own
measured bounds --

    SetAsBox(clip.width * 0.8 / 60, clip.height * 0.8 / 60)   # box parts
    b2CircleShape(clip.width * 0.8 / 60)                      # head, hand

so the authentic hitbox is 0.8x the ART, and the art size is the only input.
This prints, per part: the exported canvas size, the symbol origin inside that
canvas (FFDec's frame-level <g transform> translate), and how much those vary
across the 200 costume frames.
"""

import os
import re
import sys
import xml.etree.ElementTree as ET

SWF = "C:/Users/Hamdan/Desktop/mc/raze/decompiled_swf/raze 2"
SPRITES = os.path.join(SWF, "sprites")

PARTS = {
    "body": 279, "head": 313, "hand": 342, "foot": 166,
    "upperArm": 132, "lowerArm": 102, "upperLeg": 226, "lowerLeg": 196,
}

NUM = re.compile(r"-?\d+(?:\.\d+)?")


def sprite_dir(cid):
    for d in os.listdir(SPRITES):
        if d.startswith(f"DefineSprite_{cid}_") or d == f"DefineSprite_{cid}":
            return os.path.join(SPRITES, d)
    return None


def frame_geom(path):
    """(canvas_w, canvas_h, origin_x, origin_y, child_ids) for one frame SVG."""
    tree = ET.parse(path)
    root = tree.getroot()
    w = float(NUM.search(root.get("width", "0")).group())
    h = float(NUM.search(root.get("height", "0")).group())
    ns = "{http://www.w3.org/2000/svg}"
    ffns = "{https://www.free-decompiler.com/flash}"
    ox = oy = 0.0
    kids = []
    for g in root.iter(f"{ns}g"):
        t = g.get("transform", "")
        n = NUM.findall(t)
        if len(n) >= 6:
            ox, oy = float(n[4]), float(n[5])
        for u in g.iter(f"{ns}use"):
            kids.append((u.get(f"{ffns}characterId"), u.get("id"),
                         float(u.get("width", 0)), float(u.get("height", 0))))
        break
    return w, h, ox, oy, kids


def main():
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    print(f"{'part':<10} {'cid':>4} {'canvas w x h':>16} {'origin x,y':>16}  variation across frames")
    for name, cid in PARTS.items():
        d = sprite_dir(cid)
        if not d:
            print(f"{name:<10} {cid:>4}  MISSING")
            continue
        sizes, origins, kidsets = set(), set(), set()
        for i in range(1, frames + 1):
            p = os.path.join(d, f"{i}.svg")
            if not os.path.exists(p):
                continue
            w, h, ox, oy, kids = frame_geom(p)
            sizes.add((round(w, 2), round(h, 2)))
            origins.add((round(ox, 2), round(oy, 2)))
            kidsets.add(tuple(sorted(k[0] for k in kids)))
        w, h = sorted(sizes)[0]
        ox, oy = sorted(origins)[0]
        var = f"{len(sizes)} sizes, {len(origins)} origins"
        print(f"{name:<10} {cid:>4} {w:>7.2f} x {h:<6.2f} {ox:>7.2f},{oy:<7.2f}  {var}")
        if len(sizes) > 1:
            print(f"           sizes: {sorted(sizes)[:4]} ... {sorted(sizes)[-2:]}")
        if len(kidsets) > 1:
            print(f"           child sets differ across frames: {len(kidsets)}")


if __name__ == "__main__":
    main()
