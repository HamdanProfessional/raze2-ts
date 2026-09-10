#!/usr/bin/env python3
"""Rasterise skin sheet SVGs to transparent PNGs with Chromium (Playwright).

Sheets are palette-quantised on the way out. The characters are flat-shaded over
a large transparent field, so 255 colours is visually indistinguishable from the
full-colour render (checked at 3x zoom across idle/run/tuck) while cutting each
sheet ~5x — which matters because all 31 preload at boot.
"""
import os, sys, glob, json
from PIL import Image
from playwright.sync_api import sync_playwright

# 255 leaves a slot for the fully-transparent entry.
QUANT_COLORS = 255

SC = os.path.dirname(__file__)
SHEETS = os.path.join(SC, "sheets")
OUT = os.path.normpath(os.path.join(SC, "..", "..", "public", "assets", "skins", "anim"))
os.makedirs(OUT, exist_ok=True)

man = json.load(open(os.path.join(SC, "..", "..", "src", "assets", "raze2", "skinAnim.json")))
SW, SH = man["sheet"]

ids = sys.argv[1:] or [os.path.splitext(os.path.basename(p))[0]
                       for p in glob.glob(os.path.join(SHEETS, "*.svg"))]

with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader"])
    pg = b.new_page(viewport={"width": SW, "height": SH}, device_scale_factor=1)
    for i, sid in enumerate(ids):
        svg = open(os.path.join(SHEETS, f"{sid}.svg"), encoding="utf-8").read()
        html = ('<!doctype html><html><head><style>'
                'html,body{margin:0;padding:0;background:transparent}'
                f'svg{{display:block}}</style></head><body>{svg}</body></html>')
        pg.set_content(html, wait_until="networkidle")
        dest = os.path.join(OUT, f"{sid}.png")
        pg.screenshot(path=dest, omit_background=True,
                      clip={"x": 0, "y": 0, "width": SW, "height": SH})
        raw = os.path.getsize(dest)
        im = Image.open(dest).convert("RGBA")
        im.quantize(colors=QUANT_COLORS, method=Image.FASTOCTREE,
                    dither=Image.Dither.NONE).save(dest, optimize=True, compress_level=9)
        print(f"[{i+1}/{len(ids)}] {sid}.png  {raw//1024}K -> {os.path.getsize(dest)//1024}K")
    b.close()
print("done ->", OUT)
