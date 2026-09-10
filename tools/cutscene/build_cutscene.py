#!/usr/bin/env python3
"""Bake the Raze 2 campaign comic panels out of the SWF decompile.

The original's cutscenes are a single 42-frame MovieClip (`DefineSprite_2111`,
class `Cutscene`). `Stats_Campaign.as` hands it an array of frame indices
(`preCutFrames` / `postCutFrames`) and it walks them with gotoAndStop while the
player clicks Next / Previous. Every frame is a complete 800x600 stage:

    1852  full-frame painted background (embedded JPEG pattern)
    ----  the comic panel itself, clipped to (138,79)-(666.95,452.95)
    1859  txt_title      -- dynamic TextField, holds MatchSettings.matchName
    1860  panel border stroke
    1863  BlackFade_201  -- a fade-in overlay, 75% black on frame 1
    1864  invisible bounds marker
    ----  the caption (static text, Consolas outlines, different char per frame)
    482   but_prev / 498 but_next -- the navigation buttons

Everything except the four *chrome* layers is art we want, so the bake keeps the
background, the panel, the border and the caption and drops txt_title (the port
draws the live mission name itself), the two buttons (the port draws real
Raze2Buttons) and the BlackFade (a transition, not artwork -- left in it would
darken every panel by 75%).

FFDec exports each frame into a huge canvas (1966x4327) because frame 41 parks
the end-credits roll off-stage; the root <g> transform is the stage origin, so
the viewBox is reset to (tx, ty, 800, 600) to crop back to the visible stage.

Rasterised with Chromium via Playwright like the arm / skin sheets, then written
as WebP: these are painted, photographic panels with no transparency, which is
the one case where PNG is the wrong container (the level backdrops and map
thumbs already ship as .jpg/.webp for the same reason).

Usage:  python build_cutscene.py [frame ...]     (default: all 42)
"""
import os, re, sys, json, zipfile

from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
OUT = os.path.join(ROOT, "public", "assets", "cutscene")
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "cutscene.json")

# The FFDec decompile. Overridable so the bake can be re-run from another copy.
ZIP = os.environ.get("RAZE2_SWF_ZIP",
                     os.path.normpath(os.path.join(ROOT, "..", "raze 2.zip")))
SPRITE = "raze 2/sprites/DefineSprite_2111_Cutscene"
TEXTS = "raze 2/texts"

FRAMES = 42
# Stage size of the Cutscene clip, in the SWF's own pixels.
STAGE_W, STAGE_H = 800, 600

# Frame 22 is the Human campaign's finale. It holds no still art at all: the
# panel is empty and a 510-frame nested clip (EndingText_224) fades four blocks
# of copy through it, re-showing but_next only when it reaches the last one. The
# four beats are baked here as their own panels, composited over frame 22's
# plate, and the player walks them with Next like any other page — so the ending
# reads in full instead of as a blank frame.
#
# `place` is the frame-22 transform of the nested clip; the standalone export
# carries its own bounds offset, and the difference is the crop.
ENDING = {
    22: {
        "sprite": "raze 2/sprites/DefineSprite_2053_Raze2_fla.EndingText_224",
        "place": (235.25, 254.15),
        # inner frame -> panel id. Picked mid-hold, clear of the cross-fades.
        "beats": [(80, "22a"), (240, "22b"), (380, "22c"), (510, "22d")],
    },
}
# 2x the stage, so the panel still resolves on a hi-dpi letterbox (the engine
# renders up to 4x but the source art is 800x600 vector-over-JPEG; past 2x the
# extra pixels are interpolation, not detail).
OUT_W, OUT_H = STAGE_W * 2, STAGE_H * 2
WEBP_QUALITY = 86

# Chrome the port re-draws itself, keyed by the `id` FFDec puts on the <use>.
DROP_IDS = ("txt_title", "but_prev", "but_next")
# BlackFade_201: the fade-in overlay, exported at its opaque first frame.
DROP_CHARS = ("1863",)

os.makedirs(OUT, exist_ok=True)


def origin(svg: str) -> tuple[float, float]:
    """The root <g> translate: where the clip's own (0,0) sits on the canvas."""
    m = re.search(r'<g transform="matrix\(1\.0, 0\.0, 0\.0, 1\.0, '
                  r'(-?[\d.]+), (-?[\d.]+)\)"', svg)
    if not m:
        raise SystemExit("could not locate the root transform")
    return float(m.group(1)), float(m.group(2))


def crop_to(svg: str, x: float, y: float) -> str:
    """Retarget the oversized FFDec canvas to an 800x600 window at (x, y)."""
    head = re.search(r"<svg\b[^>]*>", svg)
    tag = re.sub(r'\s(width|height|viewBox)="[^"]*"', "", head.group(0))
    tag = tag[:-1] + ' width="%d" height="%d" viewBox="%s %s %d %d">' % (
        OUT_W, OUT_H, x, y, STAGE_W, STAGE_H)
    return svg[: head.start()] + tag + svg[head.end():]


def strip_chrome(svg: str) -> str:
    """Remove the navigation/typography layers and crop to the stage."""
    for ident in DROP_IDS:
        svg = re.sub(r'<use\b[^>]*\bid="%s"[^>]*/>' % ident, "", svg)
    for char in DROP_CHARS:
        svg = re.sub(r'<use\b[^>]*characterId="%s"[^>]*/>' % char, "", svg)
    return crop_to(svg, *origin(svg))


def caption(zf: zipfile.ZipFile, svg: str) -> str:
    """The frame's narration, recovered from FFDec's text dump.

    The caption is the only <use> in a frame that is neither shared chrome nor
    the clipped panel, and FFDec writes its DefineText content out under
    texts/<characterId>.txt with a record separator between style runs.
    """
    known = {"1852", "1859", "1860", "1863", "1864", "482", "498"}
    for cid in re.findall(r'characterId="(\d+)"', svg):
        if cid in known:
            continue
        name = "%s/%s.txt" % (TEXTS, cid)
        try:
            raw = zf.read(name).decode("utf-8", "replace")
        except KeyError:
            continue
        parts = [p.strip() for p in raw.split("--- RECORDSEPARATOR ---")]
        return " ".join(p for p in parts if p)
    return ""


def main() -> None:
    if not os.path.exists(ZIP):
        raise SystemExit("decompile not found: %s (set RAZE2_SWF_ZIP)" % ZIP)
    wanted = [int(a) for a in sys.argv[1:]] or list(range(1, FRAMES + 1))
    captions: dict[str, str] = {}
    expand: dict[str, list[str]] = {}
    total = 0
    tmp = os.path.join(OUT, "_tmp.png")

    def shoot(svg: str, alpha: bool) -> Image.Image:
        page.set_content(
            "<!doctype html><html><head><style>"
            "html,body{margin:0;padding:0;background:%s}"
            "svg{display:block}</style></head><body>%s</body></html>"
            % ("transparent" if alpha else "#000", svg),
            wait_until="networkidle")
        page.screenshot(path=tmp, omit_background=alpha,
                        clip={"x": 0, "y": 0, "width": OUT_W, "height": OUT_H})
        img = Image.open(tmp).convert("RGBA")
        img.load()
        os.remove(tmp)
        return img

    def emit(img: Image.Image, name: str) -> None:
        nonlocal total
        dest = os.path.join(OUT, "%s.webp" % name)
        img.convert("RGB").save(dest, "WEBP", quality=WEBP_QUALITY, method=6)
        size = os.path.getsize(dest)
        total += size
        print("   %s.webp  %dK" % (name, size // 1024))

    with zipfile.ZipFile(ZIP) as zf, sync_playwright() as p:
        browser = p.chromium.launch(args=["--use-gl=swiftshader"])
        page = browser.new_page(viewport={"width": OUT_W, "height": OUT_H},
                                device_scale_factor=1)
        for i, n in enumerate(wanted):
            print("[%2d/%d] frame %d" % (i + 1, len(wanted), n))
            svg = zf.read("%s/%d.svg" % (SPRITE, n)).decode("utf-8", "replace")
            captions[str(n)] = caption(zf, svg)
            plate = shoot(strip_chrome(svg), False)
            emit(plate, str(n))

            end = ENDING.get(n)
            if not end:
                continue
            # The nested clip's own export is cropped so its placement inside
            # the parent lands back on the stage, then alpha-composited over the
            # plate we just took.
            px, py = end["place"]
            ids = []
            for inner, name in end["beats"]:
                over = zf.read("%s/%d.svg" % (end["sprite"], inner)) \
                         .decode("utf-8", "replace")
                ox, oy = origin(over)
                emit(Image.alpha_composite(
                    plate, shoot(crop_to(over, ox - px, oy - py), True)), name)
                captions[name] = caption(zf, over)
                ids.append(name)
            expand[str(n)] = ids

        browser.close()

    # Only rewrite the manifest on a full bake, so a single-frame re-run can't
    # drop the other 41 captions.
    if len(wanted) == FRAMES:
        json.dump({"frames": FRAMES, "size": [STAGE_W, STAGE_H],
                   "expand": expand, "captions": captions},
                  open(MANIFEST, "w", encoding="utf-8"), indent=1)
        print("manifest ->", MANIFEST)
    print("done -> %s  (%dK total)" % (OUT, total // 1024))


if __name__ == "__main__":
    main()
