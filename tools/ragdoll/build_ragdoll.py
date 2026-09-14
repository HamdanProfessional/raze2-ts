#!/usr/bin/env python3
"""
Bake the eight PhysActor ragdoll part clips, one strip per part.

Why this exists
---------------
The port was drawing corpses from `public/assets/parts/<kind>/<frame>.png`, a
bake whose docstring credits "SsHead/SsBody/..." symbols that do not exist in
this SWF. The real ragdoll art is the same eight `Phys*` clips the LIVE
character is built from (see tools/skin-anim/build_anim.py), each with 200
costume frames selected by one index -- `unit.MC.curSkin` -- applied to every
part. Only the 31 frames named by skins.json are reachable, so that is what we
bake.

Geometry is not guessed. FFDec exports every frame of a part at one fixed
canvas, with the symbol origin carried in the frame-level <g> translate; that
origin is the part's registration point, which is exactly where PhysActor pivots
it. The manifest records it so the runtime anchors on it instead of on a
hand-tuned fraction.

Hit sizes come from the rendered alpha, because the original derives them from
the clip's own measured bounds:

    SetAsBox(clip.width * 0.8 / 60, clip.height * 0.8 / 60)

The torso's `ability` child (backpack/flag, cid 249) is REMOVED before render:
FFDec bakes such overlays at frame 1, so leaving it in welds one arbitrary
backpack onto every corpse. PhysActor sets that slot at runtime and the port
rigs it separately.

Usage (from raze-ts/, needs Pillow + Playwright chromium):
    python tools/ragdoll/build_ragdoll.py [--scale 2]
"""
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

from PIL import Image
from playwright.sync_api import sync_playwright

DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2"
SPRITES = os.path.join(DEC, "sprites")
SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "assets", "ragdoll")
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "ragdollRig.json")

# part name -> character id.  Order is the z-order PhysActor pushes them in.
PARTS = {
    "body": 279, "head": 313, "hand": 342, "foot": 166,
    "upperArm": 132, "lowerArm": 102, "upperLeg": 226, "lowerLeg": 196,
}
SVG_NS = "http://www.w3.org/2000/svg"
FFDEC_NS = "https://www.free-decompiler.com/flash"
NUM = re.compile(r"-?\d+(?:\.\d+)?")

SCALE = 2
if "--scale" in sys.argv:
    SCALE = max(1, int(sys.argv[sys.argv.index("--scale") + 1]))


def sprite_dir(cid):
    for d in os.listdir(SPRITES):
        if d.startswith(f"DefineSprite_{cid}_") or d == f"DefineSprite_{cid}":
            return os.path.join(SPRITES, d)
    raise SystemExit(f"no sprite export for cid {cid}")


def load_frame(path, drop_ids=()):
    """Return (svg_text, canvas_w, canvas_h, origin_x, origin_y)."""
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")
    ET.register_namespace("ffdec", FFDEC_NS)
    tree = ET.parse(path)
    root = tree.getroot()
    w = float(NUM.search(root.get("width", "0")).group())
    h = float(NUM.search(root.get("height", "0")).group())

    ox = oy = 0.0
    for g in root.iter(f"{{{SVG_NS}}}g"):
        n = NUM.findall(g.get("transform", ""))
        if len(n) >= 6:
            ox, oy = float(n[4]), float(n[5])
        break

    dropped = {}
    if drop_ids:
        for parent in root.iter():
            for child in list(parent):
                if child.get("id") in drop_ids:
                    # Keep where it sat: the translate is the child clip's own
                    # origin relative to the part's registration point, which is
                    # where the runtime must re-attach it.
                    n = NUM.findall(child.get("transform", ""))
                    if len(n) >= 6:
                        dropped[child.get("id")] = (float(n[4]), float(n[5]))
                    parent.remove(child)
    load_frame.dropped = dropped

    root.set("width", f"{w * SCALE}px")
    root.set("height", f"{h * SCALE}px")
    root.set("viewBox", f"0 0 {w} {h}")
    return ET.tostring(root, encoding="unicode"), w, h, ox, oy


def skin_frames():
    """[(frame, [skinId, ...])] for every distinct frame skins.json can select."""
    data = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "skins.json"),
                          encoding="utf-8"))
    arr = data if isinstance(data, list) else data.get("skins", list(data.values()))
    by_frame = {}
    for s in arr:
        by_frame.setdefault(int(s["frame"]), []).append(s["id"])
    return sorted(by_frame.items())


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    frames = skin_frames()
    order = [f for f, _ in frames]
    print(f"{len(order)} distinct skin frames: {order}")

    manifest = {
        "note": ("PhysActor ragdoll parts. One strip per part, one cell per skin "
                 "frame. `ox`/`oy` are the SWF registration point inside a cell, "
                 "in cell pixels at supersample=1 — anchor the sprite there and "
                 "the limb pivots exactly where PhysActor jointed it. `hit` is "
                 "the per-skin rendered content size the original derives its "
                 "collision box from (clip.width*0.8/60)."),
        "supersample": SCALE,
        "frames": order,
        "parts": {},
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader"])
        for name, cid in PARTS.items():
            d = sprite_dir(cid)
            drop = ("ability",) if name == "body" else ()
            cells, bboxes = [], []
            page = None
            for fr in order:
                svg, w, h, ox, oy = load_frame(os.path.join(d, f"{fr}.svg"), drop)
                cw, ch = round(w * SCALE), round(h * SCALE)
                if page is None:
                    page = browser.new_page(viewport={"width": cw, "height": ch})
                    canvas = (w, h, ox, oy)
                html = ("<!doctype html><html><head><style>"
                        "html,body{margin:0;padding:0;background:transparent}"
                        f"svg{{display:block}}</style></head><body>{svg}</body></html>")
                page.set_content(html, wait_until="load")
                buf = page.screenshot(omit_background=True,
                                      clip={"x": 0, "y": 0, "width": cw, "height": ch})
                im = Image.open(__import__("io").BytesIO(buf)).convert("RGBA")
                cells.append(im)
                bboxes.append(im.getbbox())
            page.close()
            w, h, ox, oy = canvas

            # Crop every cell to the union of content across skins, so the strip
            # carries no dead margin but each cell still shares one origin.
            live = [b for b in bboxes if b]
            ux0 = min(b[0] for b in live); uy0 = min(b[1] for b in live)
            ux1 = max(b[2] for b in live); uy1 = max(b[3] for b in live)
            cw, ch = ux1 - ux0, uy1 - uy0

            strip = Image.new("RGBA", (cw * len(cells), ch), (0, 0, 0, 0))
            hit = []
            for i, im in enumerate(cells):
                strip.paste(im.crop((ux0, uy0, ux1, uy1)), (i * cw, 0))
                b = bboxes[i]
                hit.append([round((b[2] - b[0]) / SCALE, 2),
                            round((b[3] - b[1]) / SCALE, 2)] if b else [0, 0])

            dest = os.path.join(OUT_DIR, f"{name}.png")
            strip.quantize(colors=255, method=Image.FASTOCTREE,
                           dither=Image.Dither.NONE).save(dest, optimize=True,
                                                          compress_level=9)
            if name == "body" and getattr(load_frame, "dropped", None):
                ax, ay = load_frame.dropped["ability"]
                manifest["abilityOffset"] = [round(ax, 2), round(ay, 2)]
            manifest["parts"][name] = {
                "cid": cid,
                "cell": [round(cw / SCALE, 2), round(ch / SCALE, 2)],
                # origin moves with the crop
                "ox": round((ox * SCALE - ux0) / SCALE, 2),
                "oy": round((oy * SCALE - uy0) / SCALE, 2),
                "hit": hit,
            }
            print(f"  {name:<9} cid={cid} cell={cw//SCALE}x{ch//SCALE} "
                  f"origin=({manifest['parts'][name]['ox']},{manifest['parts'][name]['oy']}) "
                  f"-> {os.path.getsize(dest)//1024}K")
        browser.close()

    json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), indent=1)
    print(f"\nwrote {MANIFEST}")


if __name__ == "__main__":
    main()
