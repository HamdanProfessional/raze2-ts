#!/usr/bin/env python3
"""Bake the Arena's authored animated props into sprite atlases.

A Raze 2 map is not just the wall bitmap plus a still backdrop: the author drops
live MovieClips straight onto the Arena frame. The tutorial map is the extreme
case — five gears, eight conveyor treads, three exploding bridges, nine pulsing
lights, a dancing heart and a nav arrow — and the port was rendering none of
them, because its map art is a single baked PNG.

Each prop is already exported by FFDec as one SVG per frame. This renders every
frame, trims it to its own content box, shelf-packs the lot into one atlas per
prop, and records where each trimmed frame sits relative to the symbol's
REGISTRATION POINT — which is what the Arena placement matrix positions. Frames
are trimmed individually rather than to a shared union box because an exploding
bridge's debris spreads over the animation: uniform cells would cost ~112 MB of
mostly-transparent pixels for `bridge` alone.

Timeline behaviour is data, not art, so it is transcribed here from each clip's
`addFrameScript` (see Raze2_fla/*.as) and written into the rig:

  stops     frames where the clip halts; `.play()` runs on to the next one
  loop      [from, to] for clips that just cycle
  randStart the lights seed `gotoAndPlay(irand(2, totalFrames))` on frame 1, so
            seven copies of the same clip are visibly out of phase

    python tools/maps/bake_props.py            # all maps that have props
    python tools/maps/bake_props.py --map tut
"""
import base64
import json
from collections import Counter
import os
import re
import struct
import sys

from playwright.sync_api import sync_playwright
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_place as B  # noqa: E402
import arena_props as A  # noqa: E402

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SPRITES = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites"
OUT = os.path.join(REPO, "public", "assets", "props")
RIG = os.path.join(REPO, "src", "assets", "propRig.json")

# One atlas page is capped at 2048 square. A single sheet is simpler, but a
# 90-frame bridge shelf-packs to ~2048x22000, which is past the max texture size
# on most GPUs and silently fails to upload — so spill into numbered pages.
ATLAS_MAX_W = 2048
ATLAS_MAX_H = 2048

# cid -> (port name, timeline behaviour). Transcribed from the clips'
# addFrameScript calls; `stops` are 1-based frame numbers like Flash's.
#
# `bake` is an extra resolution factor on top of that. Left at 1.0 a prop is
# baked at the size it is drawn; the three bridges are knocked to half because
# 90 frames of a 1023x951 collapsing gantry is 164 MB of resident RGBA on its
# own, and a soft-edged industrial set piece mid-collapse does not show the
# 2x upscale.
PROPS = {
    1225: {"name": "gear", "loop": [1, 9]},
    1333: {"name": "tread", "loop": [1, 9]},
    1311: {"name": "arrow", "loop": [1, 20]},
    # frame1 gotoAndPlay(irand(2,totalFrames)); frame57 gotoAndPlay(2)
    1210: {"name": "lightPulse", "loop": [2, 57], "randStart": True, "whiten": True},
    1336: {"name": "lightCircle", "loop": [2, 57], "randStart": True, "whiten": True},
    # frame8 gotoAndPlay(1) — idle cycle; frame21 gotoAndPlay("dance")
    1306: {"name": "heart", "loop": [1, 8], "labels": True},
    # each .play() runs on to the next stop and halts there
    1262: {"name": "bridge", "stops": [1, 21, 50], "bake": 0.5},
    1316: {"name": "bridge2", "stops": [1, 36, 60], "bake": 0.5},
    1319: {"name": "bridge3", "stops": [1, 36, 90], "bake": 0.5},
    1200: {"name": "lightStatic", "loop": [1, 1], "whiten": True},

    # --- the other maps' props -------------------------------------------
    # Light_Flicker_101 frame1: gotoAndPlay(UT.irand(1,10)). Frame 1 is INSIDE
    # the cycle here (unlike the pulse lights, which loop 2..57 and so only roll
    # the dice once), so it re-randomises every time round — an irregular
    # flicker, not an 11-frame pattern. That is `randLoop`, not `randStart`.
    1198: {"name": "lightFlicker", "loop": [1, 11], "randLoop": True, "whiten": True},
    # No SymbolClass entry -> no generated timeline class -> no addFrameScript,
    # so these just free-run their whole timeline the way Flash does by default.
    1204: {"name": "piston", "loop": [1, 115], "bake": 0.5},   # rising mine press
    1217: {"name": "lightTube", "loop": [1, 2]},               # strip light
    1222: {"name": "treadDiag", "loop": [1, 9]},               # mine belt, short
    1230: {"name": "treadDiag2", "loop": [1, 9]},              # mine belt, long
    1227: {"name": "strut", "loop": [1, 2]},                   # support column
}


def sprite_dir(cid):
    for d in os.listdir(SPRITES):
        if d == f"DefineSprite_{cid}" or d.startswith(f"DefineSprite_{cid}_"):
            return os.path.join(SPRITES, d)
    return None


def frame_labels(buf, cid):
    """{label: frame} from the DefineSprite's FrameLabel (tag 43) records."""
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39 or struct.unpack_from("<H", buf, p)[0] != cid:
            continue
        out, frame = {}, 1
        for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
            if c2 == 1:
                frame += 1
            elif c2 == 43:
                name, _ = B.cstr(buf, p2)
                out[name] = frame
        return out
    return {}


def header(svg):
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))] if m else [1, 0, 0, 1, 0, 0]
    return w, h, nums[4], nums[5]


def render(pg, path, scale=1.0):
    """One frame -> (trimmed RGBA image, lx, ly against the registration point).

    lx/ly come back in AUTHORED units regardless of `scale`, so the runtime's
    placement maths never has to know what resolution the art was baked at.
    """
    svg = open(path, encoding="utf-8").read()
    w, h, ox, oy = header(svg)
    rw, rh = w * scale, h * scale
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": max(8, round(rw)), "height": max(8, round(rh))})
    pg.set_content(
        f'<body style="margin:0;background:transparent">'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" '
        f'width="{rw}" height="{rh}"></body>')
    pg.wait_for_selector("#i")
    tmp = os.path.join(OUT, "_raw.png")
    pg.screenshot(path=tmp, omit_background=True)
    im = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    bbox = im.getbbox()
    if not bbox:
        return None, 0, 0
    return (im.crop(bbox),
            round(bbox[0] / scale - ox, 1),
            round(bbox[1] / scale - oy, 1))


def whiten(im, force=False):
    """Force RGB to white, keeping alpha. Returns (None, None) if art is not flat.

    The four light symbols are drawn as a flat red alpha mask and recoloured per
    placement by a `mult=(0,0,0,1) add=(r,g,b,0)` transform — one symbol, eight
    colours. A white mask reproduces that exactly with a plain tint, which a
    coloured one cannot: tinting red art can only ever yield red. `nativeTint`
    goes in the rig so a placement WITHOUT a transform still renders the colour
    the art was drawn in.

    `force` whitens shaded art too. That is lossy in general but exact for a
    `mult=0` placement, which throws the source colour away regardless — see the
    `#lit` variant in `main`.
    """
    hist = Counter((r, g, b) for r, g, b, a in im.convert("RGBA").getdata() if a > 8)
    if not hist:
        return im, None
    # Flat means one hue: anti-aliasing varies the level, not the channel mix.
    peak = hist.most_common(1)[0][0]
    if not force and len(hist) > 1 and min(min(p) for p in hist) > 8:
        return None, None             # genuinely multi-coloured art
    alpha = im.getchannel("A")
    out = Image.new("RGBA", im.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    return out, (peak[0] << 16) | (peak[1] << 8) | peak[2]


def shelf_pack(sizes, max_w=ATLAS_MAX_W, max_h=ATLAS_MAX_H):
    """Row-by-row placement, spilling to a new page at max_h.

    Returns ([(page, x, y)], [(page_w, page_h)]).
    """
    pos, pages = [], []
    page, x, y, row_h, used_w = 0, 0, 0, 0, 0

    def close_page():
        pages.append((used_w, y + row_h))

    for w, h in sizes:
        if x and x + w > max_w:                 # next shelf
            x, y, row_h = 0, y + row_h, 0
        if y and y + h > max_h:                 # next page
            close_page()
            page, x, y, row_h, used_w = page + 1, 0, 0, 0, 0
        pos.append((page, x, y))
        x += w
        row_h = max(row_h, h)
        used_w = max(used_w, x)
    close_page()
    return pos, pages


def bake_prop(pg, buf, cid, spec, scale, name=None, force_white=False):
    native = None
    name = name or spec["name"]
    d = sprite_dir(cid)
    if not d:
        print(f"  !! no sprite export for cid {cid}")
        return None
    nframes = len([f for f in os.listdir(d) if f.endswith(".svg")])
    imgs, meta = [], []
    # FFDec emits one SVG per timeline frame even across a hold, so identical
    # frames are common; pack each distinct image once and point the repeats at
    # it. Pure saving — the animation is unchanged.
    seen = {}
    for i in range(1, nframes + 1):
        im, lx, ly = render(pg, os.path.join(d, f"{i}.svg"), scale)
        if im is None:                       # a genuinely blank frame
            imgs.append(None)
            meta.append({"x": 0, "y": 0, "w": 0, "h": 0, "lx": 0, "ly": 0})
            continue
        if spec.get("whiten") or force_white:
            flat, tint = whiten(im, force_white)
            if flat is None:
                print(f"  !! {name} frame {i} is not a flat mask, left as-is")
            else:
                im, native = flat, native or tint
        key = (im.tobytes(), lx, ly)
        meta.append({"w": im.width, "h": im.height, "lx": lx, "ly": ly})
        if key in seen:
            imgs.append(None)                # repeat: reuse the first one's rect
            meta[-1]["same"] = seen[key]
        else:
            seen[key] = i - 1
            imgs.append(im)

    solid = [(i, im) for i, im in enumerate(imgs) if im is not None]
    pos, pages = shelf_pack([(im.width, im.height) for _, im in solid])
    sheets = [Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0)) for w, h in pages]
    for (i, im), (page, x, y) in zip(solid, pos):
        sheets[page].paste(im, (x, y))
        meta[i]["p"], meta[i]["x"], meta[i]["y"] = page, x, y

    files, kb = [], 0.0
    for page, sheet in enumerate(sheets):
        safe = name.replace("#", "_")
        fn = f"{safe}.png" if len(sheets) == 1 else f"{safe}_{page}.png"
        sheet.save(os.path.join(OUT, fn))
        kb += os.path.getsize(os.path.join(OUT, fn)) / 1024
        files.append(fn)
    # Resolve the de-duplicated frames to the rect their twin landed on.
    for m in meta:
        if "same" in m:
            src = meta[m.pop("same")]
            m["p"], m["x"], m["y"] = src["p"], src["x"], src["y"]

    vram = sum(p[0] * p[1] for p in pages) * 4 / 1e6
    dups = nframes - len(solid)
    print(f"  {name:12} {nframes:3} frames ({dups:2} dup)  bake {scale:.2f}  "
          f"{len(sheets)} page(s)  {kb:6.0f} KB  {vram:5.1f} MB vram")

    rig = {"cid": cid, "files": files, "bakeScale": round(scale, 4), "frames": meta}
    if native is not None and not force_white:
        rig["nativeTint"] = native
    if spec.get("whiten") or force_white:
        rig["whitened"] = True
    for k in ("loop", "stops", "randStart", "randLoop"):
        if k in spec:
            rig[k] = spec[k]
    if spec.get("labels"):
        rig["labels"] = frame_labels(buf, cid)
    return rig


def main():
    argv = sys.argv[1:]
    want = argv[argv.index("--map") + 1] if "--map" in argv else None
    os.makedirs(OUT, exist_ok=True)

    buf = B.body(B.SWF)
    classes = A.symbol_classes(buf)
    frames = A.sprite_frame_counts(buf)

    # Placements, grouped per map, keeping only the cids we know how to bake.
    #
    # Read from the simulated display list, not the raw placement tags: several
    # maps are authored as edits of the frame before them, so their props arrive
    # by inheritance and carry no character id of their own. Scanning the tags
    # alone loses mines2 and tutq's props entirely and two of the mine's.
    placements = {}
    for frame, state in A.arena_timeline(buf).items():
        mp = A.FRAME_MAP.get(frame)
        if not mp or (want and mp != want):
            continue
        for depth, (cid, name, m, cx) in sorted(state.items()):
            if cid not in PROPS or m is None:
                continue
            tx, ty, a, d, b, c = m
            place = {
                "prop": PROPS[cid]["name"], "name": name or "", "depth": depth,
                "x": round(tx, 1), "y": round(ty, 1),
                "a": round(a, 4), "b": round(b, 4),
                "c": round(c, 4), "d": round(d, 4),
            }
            if cx:
                mult, add = cx
                # Every coloured placement here is "throw the art's RGB away and
                # add a flat colour", which a tint on a white mask reproduces
                # exactly. Anything else would need a real colour matrix, so say
                # so rather than rendering it wrong and quietly.
                if max(mult[:3]) > 0.01 and any(add[:3]):
                    print(f"  !! {mp} {PROPS[cid]['name']} has a colour transform "
                          f"this cannot express: mult={mult[:3]} add={add[:3]}")
                elif any(add[:3]):
                    place["tint"] = (add[0] << 16) | (add[1] << 8) | add[2]
                elif max(mult[:3]) < 0.01:
                    place["tint"] = 0          # mult 0 with no add: a black light
                alpha = mult[3] + add[3] / 255.0
                if abs(alpha - 1.0) > 0.01:
                    place["alpha"] = round(max(0.0, min(1.0, alpha)), 3)
            placements.setdefault(mp, []).append(place)
    if not placements:
        print("no placements matched")
        return

    # A prop whose art is shaded rather than a flat mask cannot serve both a
    # plain placement and a `mult=0` recoloured one from a single atlas: tinting
    # shaded art multiplies, where Flash replaces. `lightTube` is the only case —
    # blue-white in the mines, flat orange in the ocean — so give its recoloured
    # placements a forced-white twin and leave the plain ones on the real art.
    lit = {}
    for ps in placements.values():
        for p in ps:
            spec = next(s for s in PROPS.values() if s["name"] == p["prop"])
            if "tint" in p and not spec.get("whiten"):
                p["prop"] = lit.setdefault(spec["name"], f"{spec['name']}#lit")
    for base, name in lit.items():
        print(f"  {name}: forced-white twin of {base} for its recoloured placements")

    need = {p["prop"] for ps in placements.values() for p in ps}
    todo = {cid: s for cid, s in PROPS.items()
            if s["name"] in need or lit.get(s["name"]) in need}

    # Bake each prop at the largest size it is ever drawn at, capped at 1:1.
    # The heart is placed at 0.44 and the lights at 10.7x; baking both at 1:1
    # would waste 80% of the heart's pixels and gain nothing on the lights.
    # Scale is the column magnitude, not `a`/`d` alone: a tread rotated 22 deg
    # has a=0.93 but is drawn at 1:1, and reading `a` as the scale would bake it
    # 7% small.
    drawn = {}
    for ps in placements.values():
        for p in ps:
            s = max((p["a"] ** 2 + p["b"] ** 2) ** 0.5,
                    (p["c"] ** 2 + p["d"] ** 2) ** 0.5)
            drawn[p["prop"]] = max(drawn.get(p["prop"], 0.0), s)
    print(f"baking {len(todo)} prop(s) for {', '.join(sorted(placements))}")

    rig = {"props": {}, "maps": placements,
           "note": ("Animated Arena props. frames[] are 1-based Flash frames, "
                    "each trimmed to its own content box: x/y locate it in the "
                    "atlas, lx/ly place it against the symbol registration "
                    "point that the Arena matrix positions. `stops` are frames "
                    "the clip halts on (play() runs to the next); `loop` cycles; "
                    "`randStart` seeds a random frame so copies are out of "
                    "phase, and `randLoop` re-rolls it every time round. A "
                    "placement's a/b/c/d are the authored transform's 2x2 — "
                    "rotation and flips are both in use, so it is applied whole "
                    "rather than decomposed. A `whitened` prop is a flat alpha "
                    "mask: tint it with the placement's `tint`, or with the "
                    "prop's `nativeTint` when the placement carries none.")}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page()
        for cid, spec in sorted(todo.items()):
            for name, force in ((spec["name"], False), (lit.get(spec["name"]), True)):
                if not name or name not in need:
                    continue
                scale = min(1.0, drawn.get(name, 1.0)) * spec.get("bake", 1.0)
                got = bake_prop(pg, buf, cid, spec, scale, name, force)
                if got:
                    rig["props"][name] = got
        b.close()

    json.dump(rig, open(RIG, "w", encoding="utf-8"), indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f))
                for pr in rig["props"].values() for f in pr["files"])
    print(f"\nwrote {len(rig['props'])} atlases ({total/1e6:.2f} MB) -> {OUT}")
    print(f"wrote {RIG}")
    for mp, ps in placements.items():
        print(f"  {mp}: {len(ps)} placements")


if __name__ == "__main__":
    main()
