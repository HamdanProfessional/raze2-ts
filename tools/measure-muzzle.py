#!/usr/bin/env python3
"""
Measure each weapon's barrel tip from its baked Raze 2 arm art.

    python tools/measure-muzzle.py     # -> src/assets/muzzle.json

`Unit.getMuzzle()` walks out from the shoulder along the aim by `muzzleLen`, so
tracers, muzzle flashes and projectiles leave the barrel rather than the chest.
Those numbers used to be eyeballed for ten weapons and defaulted to a flat 18px
for the rest, which put most guns' flash back at the shoulder.

The art itself knows the answer. `arms-r2/<id>/idle.png` is one arm cell drawn
in world px (Unit renders it at ARM_SCALE 1) with the shoulder at armAnim.json's
`anchor` fraction, baked facing right — so the barrel tip is just the furthest
opaque pixel from the anchor along +x, and its offset from the anchor is exactly
the muzzle vector. Alpha is thresholded to skip the bake's antialiased fringe.
"""
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, "public", "assets", "arms-r2")
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "armAnim.json")
OUT = os.path.join(ROOT, "src", "assets", "muzzle.json")

# Below this the pixel is bake fringe, not gun.
ALPHA_MIN = 40
# Columns back from the tip averaged to find the bore's height. One column is
# the very point of the barrel and too thin to locate the bore reliably.
BORE_COLS = 6


def measure(path: str, ax: float, ay: float):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    alpha = img.getchannel("A").load()

    cols = [
        [y for y in range(h) if alpha[x, y] >= ALPHA_MIN]
        for x in range(w)
    ]
    tip = max((x for x in range(w) if cols[x]), default=None)
    if tip is None:
        return None

    # Bore height: centre of the opaque span over the last few solid columns.
    ys = [y for x in range(max(0, tip - BORE_COLS + 1), tip + 1) for y in cols[x]]
    bore = sum(ys) / len(ys)

    return {
        "len": round(tip - ax * w, 1),
        "dy": round(bore - ay * h, 1),
    }


def main():
    with open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)
    ax, ay = manifest["anchor"]

    out = {}
    for gun in sorted(manifest["weapons"]):
        path = os.path.join(ART, gun, "idle.png")
        if not os.path.exists(path):
            print(f"  !! no art for {gun}")
            continue
        m = measure(path, ax, ay)
        if m:
            out[gun] = m
            print(f"  {gun:<14} len {m['len']:>6}  dy {m['dy']:>6}")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, sort_keys=True)
        f.write("\n")
    print(f"\n{len(out)} weapons -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
