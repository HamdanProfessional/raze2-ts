#!/usr/bin/env python3
"""Bake the parallax background layers (`Bg`) and sky (`BgSky`) from the SWF.

`Arena`'s constructor picks three frame *labels* per map:

    game.bg1.gotoAndStop(map.bg1)    // far parallax layer   (DefineSprite_1365)
    game.bg2.gotoAndStop(map.bg2)    // near parallax layer  (DefineSprite_1365)
    game.bgSky.gotoAndStop(map.sky)  // static backdrop      (DefineSprite_1421)

The label->frame map comes from the binary FrameLabel records and the per-map
label assignment from `Stats_Maps.getMap`'s bytecode — see tools/maps/bg_labels.py,
both decompilations of that switch collapse it to a single "test" case.

Only the labels the shipped maps actually use are baked. `jungle` is authored
with `bg1 = ""` — no far layer at all — so nothing is emitted for it.

Writes public/assets/bg/<label>.png (parallax) and .../sky/<label>.png, plus
src/assets/bgRig.json recording, per frame:

  w/h   the content bounds — this is Flash's `bg.width`/`.height`, which is
        what the parallax formula divides by. Not the SVG canvas size.
  lx/ly where that content sits relative to the symbol's REGISTRATION POINT.
        `Game.as:105-110` does `new Bg()` / `new BgSky()` with no placement, so
        the registration point is stage (0,0) and the art hangs off it — the
        sky's ruined skyline overhangs left of 0 by ~133px. Drop this offset and
        every layer slides sideways and leaves a void at one edge.

FFDec writes the symbol origin into the root `<g transform="matrix(...)">`, so
the offset is (rendered bbox) - (that translate).
"""
import base64, json, os, re, sys
from collections import Counter

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites"
BG_DIR = os.path.join(DEC, "DefineSprite_1365_Bg")
SKY_DIR = os.path.join(DEC, "DefineSprite_1421_BgSky")
OUT_BG = os.path.join(REPO, "public", "assets", "bg")
OUT_SKY = os.path.join(REPO, "public", "assets", "sky")
RIG = os.path.join(REPO, "src", "assets", "bgRig.json")

# label -> frame, from the binary FrameLabel (tag 43) records.
BG_FRAME = {
    "dark": 2, "dome": 3, "space": 4, "city": 5, "city2": 6, "oceanf": 7,
    "oceanb": 8, "mountainbig": 9, "mountainsmall": 10, "dunes": 11,
    "shipyard2": 12, "pillars": 13, "pillarsmall": 14, "snow": 15, "snow2": 16,
    "mountainbiglow": 17, "mountainsmalllow": 18,
}
SKY_FRAME = {
    "red": 2, "meteor": 3, "night": 4, "lol cats": 5, "city": 6, "dawn": 7,
    "day": 8, "mday": 9, "desert": 10, "space": 11, "desert2": 12,
    "nlights": 13, "tut": 14, "tut_missile": 15, "tut_attack": 16,
}

# Per-map assignment recovered from getMap's bytecode, for the maps the port
# ships. "" = no layer (jungle genuinely has no far layer).
MAPS = {
    "jungle":  {"bg1": "",               "bg2": "dome",             "sky": "red"},
    "jungle2": {"bg1": "dark",           "bg2": "dome",             "sky": "night"},
    "city":    {"bg1": "city",           "bg2": "city2",            "sky": "city"},
    "desert":  {"bg1": "dunes",          "bg2": "shipyard2",        "sky": "desert"},
    "ocean":   {"bg1": "oceanf",         "bg2": "oceanb",           "sky": "day"},
    "mines":   {"bg1": "mountainbig",    "bg2": "mountainsmall",    "sky": "city"},
    "mines2":  {"bg1": "mountainbig",    "bg2": "mountainsmall",    "sky": "mday"},
    "space":   {"bg1": "pillars",        "bg2": "pillarsmall",      "sky": "space"},
    "snow":    {"bg1": "snow",           "bg2": "snow2",            "sky": "day"},
    "tut":     {"bg1": "mountainbiglow", "bg2": "mountainsmalllow", "sky": "tut"},
    "tutq":    {"bg1": "mountainbiglow", "bg2": "mountainsmalllow", "sky": "tut"},
}

# Sky frames no map *starts* on but the game still swaps to at runtime:
#   "lol cats"    `Arena.as:795` overrides every map's sky in that special mode
#   "tut_missile" `Unit.as` tutorial step 3 — the missile is already overhead
#                 while the escort is still talking, two steps before it lands
#   "tut_attack"  `Game.as:554` turns the tutorial's sky over when the missile
#                 lands, so it has to be resident before the beat fires
EXTRA_SKY = ["lol cats", "tut_missile", "tut_attack"]

# The art is authored for the SWF's 800x600 stage; the port records that so it
# can keep the same oversize ratio against its own (larger) viewport.
STAGE = [800, 600]


def slug(label):
    """Filename for a frame label. Only "lol cats" has a space in it."""
    return label.replace(" ", "")


def header(svg):
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))] if m else [1, 0, 0, 1, 0, 0]
    return w, h, nums[4], nums[5]


# Classes that are a TRANSIENT overlay, not part of the backdrop. FFDec exports
# a frame with every clip on it parked at frame 1, and `whiteFlash_139` frame 1
# is an opaque 800x600 white rectangle on top of everything — it is the missile
# detonation, a 30-frame fade that stops on frame 30. Baked into a static sky it
# is not a flash, it is a permanently white sky, which is what `tut_attack`
# looked like. The flash itself is reproduced at runtime instead.
DROP_CLASSES = ("whiteFlash",)


def strip_overlays(svg):
    """Remove `<use>`s of a DROP_CLASSES character. The defs can stay: unused."""
    out, n = svg, 0
    for cls in DROP_CLASSES:
        out, hits = re.subn(
            r'<use[^>]*ffdec:characterName="[^"]*' + cls + r'[^"]*"[^>]*/>', "", out)
        n += hits
    return out, n


def bake(pg, src_dir, frame, out_path):
    svg = open(os.path.join(src_dir, f"{frame}.svg"), encoding="utf-8").read()
    svg, dropped = strip_overlays(svg)
    if dropped:
        print(f"     dropped {dropped} transient overlay(s) from frame {frame}")
    w, h, ox, oy = header(svg)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": max(8, round(w)), "height": max(8, round(h))})
    pg.set_content(
        f'<body style="margin:0;background:transparent">'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
        f'width="{w}" height="{h}"></body>')
    pg.wait_for_selector("#i")
    tmp = out_path + ".raw.png"
    pg.screenshot(path=tmp, omit_background=True)
    im = Image.open(tmp).convert("RGBA")
    bbox = im.getbbox()
    # Flash's `.width`/`.height` are the CONTENT bounds, which is what the
    # parallax formula divides by — so crop, and record where the content sits
    # relative to the symbol's registration point (the `<g>` translate).
    off = [0, 0]
    if bbox:
        off = [bbox[0], bbox[1]]
        im = im.crop(bbox)
    warn = flat_fill_warning(im)
    if warn:
        print(f"     !! {os.path.basename(out_path)}: {warn}")
    im.save(out_path)
    os.remove(tmp)
    return {"w": im.width, "h": im.height,
            "lx": round(off[0] - ox, 1), "ly": round(off[1] - oy, 1)}


def flat_fill_warning(im, share=0.6):
    """Flag a layer that came out as one flat colour over most of its area.

    A backdrop is scenery — a gradient, a skyline, a mountain. If most of it is
    a single colour, an overlay clip has almost certainly been baked in on top
    of the art (see DROP_CLASSES), which is how `tut_attack` shipped as a white
    wall. Cheap to check and it fails loudly at bake time rather than in level 1.
    """
    px = im.convert("RGBA").resize((96, 96)).get_flattened_data()
    solid = [(r, g, b) for r, g, b, a in px if a > 200]
    if len(solid) < 0.2 * len(px):
        return None
    top, n = Counter(solid).most_common(1)[0]
    if n < share * len(px):
        return None
    return (f"{100 * n // len(px)}% of it is flat #{top[0]:02x}{top[1]:02x}"
            f"{top[2]:02x} — is an overlay clip baked in?")


def main():
    os.makedirs(OUT_BG, exist_ok=True)
    os.makedirs(OUT_SKY, exist_ok=True)
    need_bg = {v for m in MAPS.values() for k in ("bg1", "bg2") if (v := m[k])}
    need_sky = {m["sky"] for m in MAPS.values()} | set(EXTRA_SKY)
    rig = {"stage": STAGE, "maps": MAPS, "bg": {}, "sky": {},
           "note": ("Parallax layers baked from DefineSprite_1365 (bg) and 1421 "
                    "(sky). w/h are the cropped CONTENT size — Flash's .width is "
                    "the bounds, which is what Arena.as:1172-1175 divides by. "
                    "lx/ly place that content against the symbol's registration "
                    "point, which Game.as leaves at stage (0,0). `stage` is the "
                    "SWF stage the art was authored against.")}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page()
        for label in sorted(need_bg):
            info = bake(pg, BG_DIR, BG_FRAME[label], os.path.join(OUT_BG, f"{slug(label)}.png"))
            rig["bg"][label] = info
            print(f"bg   {label:18} frame {BG_FRAME[label]:2}  {info['w']}x{info['h']}  at ({info['lx']}, {info['ly']})")
        for label in sorted(need_sky):
            info = bake(pg, SKY_DIR, SKY_FRAME[label], os.path.join(OUT_SKY, f"{slug(label)}.png"))
            rig["sky"][label] = info
            print(f"sky  {label:18} frame {SKY_FRAME[label]:2}  {info['w']}x{info['h']}  at ({info['lx']}, {info['ly']})")
        b.close()
    json.dump(rig, open(RIG, "w"), indent=1)
    print("wrote", os.path.normpath(RIG))


if __name__ == "__main__":
    main()
