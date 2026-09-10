#!/usr/bin/env python3
"""Rasterise the Raze 2 arm sheets to transparent PNGs with Chromium (Playwright).

Emits two files per weapon into public/assets/arms-r2/<id>/:
  idle.png  one cell, the rest pose -- preloaded at boot for the HUD, loadout,
            pickups and any unequipped weapon
  anim.png  the whole band (idle + recoil + reload) -- loaded lazily on equip

Both come out of the same bake, so switching from the idle texture to the sheet
mid-fire cannot pop. Sheets are palette-quantised like the skin bakes: flat
Flash shading over a mostly-transparent field, so 255 colours is visually
indistinguishable and roughly 5x smaller.
"""
import os, sys, glob, json
from PIL import Image
from playwright.sync_api import sync_playwright

QUANT_COLORS = 255

SC = os.path.dirname(os.path.abspath(__file__))
SHEETS = os.path.join(SC, "sheets")
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "arms-r2")
os.makedirs(OUT, exist_ok=True)

man = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "armAnim.json")))
CW, CH = man["cell"]
COLS = man["cols"]
poses = man["poses"]

ids = sys.argv[1:] or sorted(
    os.path.basename(os.path.dirname(p)) for p in glob.glob(os.path.join(SHEETS, "*", "anim.svg")))

total = 0
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader"])
    pg = b.new_page(viewport={"width": 64, "height": 64}, device_scale_factor=1)

    def shoot(svg_path, dest, w, h):
        global total
        svg = open(svg_path, encoding="utf-8").read()
        pg.set_viewport_size({"width": w, "height": h})
        pg.set_content('<!doctype html><html><head><style>'
                       'html,body{margin:0;padding:0;background:transparent}'
                       f'svg{{display:block}}</style></head><body>{svg}</body></html>',
                       wait_until="networkidle")
        pg.screenshot(path=dest, omit_background=True,
                      clip={"x": 0, "y": 0, "width": w, "height": h})
        im = Image.open(dest).convert("RGBA")
        im.quantize(colors=QUANT_COLORS, method=Image.FASTOCTREE,
                    dither=Image.Dither.NONE).save(dest, optimize=True, compress_level=9)
        total += os.path.getsize(dest)
        return os.path.getsize(dest)

    for i, wid in enumerate(ids):
        pose = man["weapons"][wid]
        rows = poses[pose]["rows"]
        d = os.path.join(OUT, wid)
        os.makedirs(d, exist_ok=True)
        a = shoot(os.path.join(SHEETS, wid, "anim.svg"),
                  os.path.join(d, "anim.png"), CW * COLS, CH * rows)
        s = shoot(os.path.join(SHEETS, wid, "idle.svg"),
                  os.path.join(d, "idle.png"), CW, CH)
        print(f"[{i+1}/{len(ids)}] {wid:<16} {pose:<8} "
              f"anim {a//1024:>4}K  idle {s//1024:>3}K")
    b.close()

print(f"done -> {OUT}   total {total/1048576:.1f} MB")
