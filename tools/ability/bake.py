#!/usr/bin/env python3
"""Bake the character's back-attachment slot (`MC.body.ability`, symbol 249).

Raze 2 hangs **one** thing off the character's back, and it is the same layer
either way:

  * normally the equipped ability's kit — `UnitMC` does
    `MC.body.ability.gotoAndStop(ability.sprite)`;
  * while carrying a flag, `NodeCtfFlag.capture` overrides it with
    `MC.body.ability.gotoAndStop("flag" + team)`, and `reset()` puts the kit
    back. So backpack and flag are mutually exclusive by construction.

`DefineSprite_249` has 11 label-addressed frames. FFDec's SVG export drops frame
labels, so the map below comes from `tools/ability/frame_labels.py` reading the
binary FrameLabel (tag 43) records:

    1 heal   2 static  3 cloak  4 sword   5 mine  6 grenade
    7 none   8 flag1   9 flag2  10 ammo  11 teleport

Every frame shares one canvas (65.15 x 76.95) with the clip registration point
at (43.85, 39.0), so the frames are rendered **uncropped** and all share a
single anchor — that keeps the runtime placement a plain "put the registration
point on the attach point" with no per-frame offset table.

Writes public/assets/ability/<label>.png plus abilityRig.json (canvas + anchor).
Rasterised through Chromium, like tools/pickups/bake.py.
"""
import base64, json, os, re

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SRC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites\DefineSprite_249"
OUT = os.environ.get("RZ_ABILITY_OUT") or os.path.join(REPO, "public", "assets", "ability")
RIG = os.path.join(REPO, "src", "assets", "abilityRig.json")

LABELS = {
    1: "heal", 2: "static", 3: "cloak", 4: "sword", 5: "mine", 6: "grenade",
    7: "none", 8: "flag1", 9: "flag2", 10: "ammo", 11: "teleport",
}
# Frame 7 is a genuinely empty frame (no ability equipped) — nothing to ship.
SKIP = {"none"}

SCALE = 4  # render big, downsample: the kit items are small and detailed


def header(svg):
    """(w, h, ox, oy) — canvas size and where the clip origin sits in it."""
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))] if m else [1, 0, 0, 1, 0, 0]
    return w, h, nums[4], nums[5]


def main():
    os.makedirs(OUT, exist_ok=True)
    canvas = anchor = None
    written = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 400, "height": 400})
        for frame, label in sorted(LABELS.items()):
            svg = open(os.path.join(SRC, f"{frame}.svg"), encoding="utf-8").read()
            w, h, ox, oy = header(svg)
            if canvas is None:
                canvas, anchor = [w, h], [round(ox / w, 5), round(oy / h, 5)]
            elif [w, h] != canvas:
                raise SystemExit(f"frame {frame} canvas {w}x{h} != {canvas}; "
                                 "the shared-anchor assumption no longer holds")
            if label in SKIP:
                print(f"frame {frame:2d} {label:9} skipped (empty frame)")
                continue

            b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
            pg.set_viewport_size({"width": max(8, round(w * SCALE)),
                                  "height": max(8, round(h * SCALE))})
            # Rendered at the full canvas size — NOT cropped to content, so the
            # registration point stays at the same fraction in every frame.
            pg.set_content(
                f'<body style="margin:0;background:transparent">'
                f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
                f'width="{w}" height="{h}" '
                f'style="transform:scale({SCALE});transform-origin:0 0"></body>')
            pg.wait_for_selector("#i")
            tmp = os.path.join(OUT, f"_{label}.raw.png")
            pg.screenshot(path=tmp, omit_background=True)
            im = Image.open(tmp).convert("RGBA")
            im = im.resize((round(w), round(h)), Image.LANCZOS)
            im.save(os.path.join(OUT, f"{label}.png"))
            os.remove(tmp)
            written.append(label)
            print(f"frame {frame:2d} {label:9} -> {label}.png  {im.width}x{im.height}")
        b.close()

    json.dump({
        "note": ("Back-attachment slot (MC.body.ability, DefineSprite_249). All "
                 "frames share one canvas; `anchor` is the clip registration "
                 "point as a fraction of it, so a sprite anchored there and "
                 "placed on skinAnim's per-frame `ability` point lands right."),
        "canvas": canvas,
        "anchor": anchor,
        "frames": sorted(written),
    }, open(RIG, "w"), indent=1)
    print("wrote", os.path.normpath(RIG))


if __name__ == "__main__":
    main()
