#!/usr/bin/env python3
"""Bake the Raze 2 Intro timeline (DefineSprite_1846) to a looping-free video.

The original `Intro` is a 393-frame MovieClip: the Juice-Tin swords drop (frame
1 plays `S_CamelJizz`), the sponsor/developer logos hold, and frame 40 starts
`M_MenuIntro`. The port removed the splash, which is why `R2_CamelJizz` had no
trigger (docs/raze2/15-audio-music.md).

FFDec exports each frame as SVG on a 2767x1349 canvas with the SWF stage at
(ox, oy); this script renders every frame cropped to the 800x600 stage and hands
the sequence to ffmpeg for a VP9 WebM the runtime plays in `IntroScreen`.

Usage:  python tools/ui/bake_intro.py
Output: public/assets/intro/intro.webm + src/assets/introRig.json
"""
import base64
import json
import os
import shutil
import subprocess
import sys

from playwright.sync_api import sync_playwright

from bake import header, sprite_dir

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
OUT = os.path.join(REPO, "public", "assets", "intro")
RIG = os.path.join(REPO, "src", "assets", "introRig.json")
FRAMES = os.path.join(REPO, "public", "assets", "intro", "_frames")

SYMBOL = "DefineSprite_1846_Intro"
STAGE = (800, 600)
FPS = 30
CAMEL_FRAME = 1
MENU_INTRO_FRAME = 40


def main():
    src = os.path.join(sprite_dir(SYMBOL), "{n}.svg")
    total = len([f for f in os.listdir(os.path.dirname(src)) if f.endswith(".svg")])
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(FRAMES, exist_ok=True)

    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": STAGE[0], "height": STAGE[1]})
        for n in range(1, total + 1):
            svg = open(src.format(n=n), encoding="utf-8").read()
            _, _, ox, oy = header(svg)
            b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
            pg.set_content(
                '<body style="margin:0;background:#000;overflow:hidden">'
                f'<img src="data:image/svg+xml;base64,{b64}" '
                f'style="position:absolute;left:{-ox}px;top:{-oy}px">'
                "</body>")
            pg.wait_for_selector("img")
            pg.screenshot(path=os.path.join(FRAMES, f"f_{n:04d}.png"))
            if n % 50 == 0 or n == total:
                print(f"  frame {n}/{total}")
        b.close()

    out_video = os.path.join(OUT, "intro.webm")
    subprocess.run(
        ["ffmpeg", "-y", "-framerate", str(FPS),
         "-i", os.path.join(FRAMES, "f_%04d.png"),
         "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0",
         "-deadline", "realtime", "-cpu-used", "5", "-row-mt", "1",
         "-pix_fmt", "yuv420p", out_video],
        check=True,
    )
    shutil.rmtree(FRAMES, ignore_errors=True)

    rig = {
        "file": "intro/intro.webm",
        "frames": total,
        "fps": FPS,
        "w": STAGE[0],
        "h": STAGE[1],
        "camelFrame": CAMEL_FRAME,
        "menuIntroFrame": MENU_INTRO_FRAME,
        "note": ("Baked from DefineSprite_1846_Intro by tools/ui/bake_intro.py. "
                 "Frame numbers are the SWF timeline's (1-based)."),
    }
    with open(RIG, "w") as f:
        json.dump(rig, f, indent=1, sort_keys=True)
    size = os.path.getsize(out_video) / 1024 / 1024
    print(f"wrote {out_video} ({size:.1f} MB), {total} frames")


if __name__ == "__main__":
    sys.exit(main())
