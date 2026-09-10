#!/usr/bin/env python3
"""Bake the Raze 2 tutorial map's 11 wall frames into level assets.

The tutorial is a guided walkthrough: `Arena.changeWallFrame(n)` swaps the whole
collision layer as the player clears each step, which is what opens the path and
removes the trigger they just tripped. Each frame is a single whole-map
DefineShape (cids 1320..1330, all 2805.55 x 2023), exported standalone by FFDec.

Two layers come out of each frame, both read from the same shape:
  * `_mask.png` — solidity. The SWF tests `getPixel32(...) >> 24 == 0xff`, so a
    fill authored at 50% alpha is a walk-through volume, not a wall.
  * `_special.png` — surface/trigger colour, read with `getPixel` (alpha-blind),
    so the translucent trigger volumes have to survive into this layer.

The shapes are flat polygons — only M, L and a handful of Q segments — so they
are rasterised here directly rather than through a browser. That keeps the edges
hard, which matters: an antialiased boundary between two authored colours blends
into a third palette entry, and `9900ff` over `ff0000` lands on `ff00ff`, i.e. a
phantom tutorial trigger on a frame that should have none.
"""
import io, os, re, sys, zipfile
import numpy as np
from PIL import Image, ImageDraw

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
ZIP = os.path.normpath(os.path.join(REPO, "..", "raze 2.zip"))
OUT = os.path.join(REPO, "public", "assets", "levels", "raze2")

# Wall MC `Raze2_fla.Tutorial_Wall_122` (cid 1331) frames 1..11, exported as
# standalone shapes. Index i here is sEvent i+1.
SHAPES = list(range(1320, 1331))
W, H = 2806, 2023

# A 4x1px speck present from frame 6 on. It matches no surface case in the SWF,
# so it is simply solid plain ground — but it is one bit off `ff00ff`, so it must
# not be allowed to read as a trigger.
NOISE = "#ff00f1"
PLAIN = "#ffffff"

PATH_RE = re.compile(r"<path\b([^>]*)/>")
ATTR_RE = re.compile(r'(\S+)="([^"]*)"')
TOKEN_RE = re.compile(r"([MLQ])|(-?[\d.]+)")


def subpaths(d):
    """Flatten one `d` attribute into a list of polygons (lists of (x, y))."""
    out, cur, pen, mode = [], [], (0.0, 0.0), "L"
    nums, want = [], 2

    def flush_cmd():
        nonlocal pen
        if len(nums) < want:
            return
        if mode == "Q":
            (cx, cy), (x, y) = (nums[0], nums[1]), (nums[2], nums[3])
            # 12 steps is well under a pixel of chord error at this scale.
            for i in range(1, 13):
                t = i / 12
                u = 1 - t
                cur.append((u * u * pen[0] + 2 * u * t * cx + t * t * x,
                            u * u * pen[1] + 2 * u * t * cy + t * t * y))
            pen = (x, y)
        else:
            pen = (nums[0], nums[1])
            cur.append(pen)
        nums.clear()

    for m in TOKEN_RE.finditer(d):
        if m.group(1):
            flush_cmd()
            if m.group(1) == "M":
                if len(cur) > 2:
                    out.append(cur[:])
                cur.clear()
            mode = m.group(1)
            want = 4 if mode == "Q" else 2
        else:
            nums.append(float(m.group(2)))
            if len(nums) == want:
                flush_cmd()
    flush_cmd()
    if len(cur) > 2:
        out.append(cur)
    return out


def fill_evenodd(polys):
    """Rasterise subpaths under the even-odd rule, hard-edged.

    Each subpath is simple here, so filling them independently and XOR-ing is
    exactly even-odd — which the art relies on: the big `ff0000` path carries its
    inner rooms as counter-subpaths, and filling non-zero would seal the map.
    """
    acc = np.zeros((H, W), bool)
    for poly in polys:
        im = Image.new("1", (W, H), 0)
        ImageDraw.Draw(im).polygon([(round(x), round(y)) for x, y in poly], fill=1)
        acc ^= np.array(im, bool)
    return acc


def build(cid):
    """Composite one frame's paths into (colour index-free) RGB + alpha planes."""
    svg = zipfile.ZipFile(ZIP).read(f"raze 2/shapes/{cid}.svg").decode("utf-8")
    rgb = np.zeros((H, W, 3), np.uint8)
    alpha = np.zeros((H, W), np.uint8)
    counts = {}

    for m in PATH_RE.finditer(svg):
        a = dict(ATTR_RE.findall(m.group(1)))
        fill = a.get("fill", "#000000").lower()
        if fill == "none":
            continue
        if fill == NOISE:
            fill = PLAIN
        op = float(a.get("fill-opacity", 1))
        hit = fill_evenodd(subpaths(a.get("d", "")))
        if not hit.any():
            continue
        rgb[hit] = tuple(int(fill[i:i + 2], 16) for i in (1, 3, 5))
        alpha[hit] = round(op * 255)
        counts[fill] = counts.get(fill, 0) + int(hit.sum())

    return rgb, alpha, counts


def bake(frame):
    cid = SHAPES[frame - 1]
    rgb, alpha, counts = build(cid)

    painted = alpha > 0
    # Colour is read alpha-blind, so translucent triggers keep their entry.
    spec = np.dstack([rgb, np.where(painted, 255, 0).astype(np.uint8)])
    # Solidity is alpha-exact: authored translucency is walk-through.
    mask = np.zeros((H, W, 4), np.uint8)
    mask[:, :, 3] = np.where(alpha == 255, 255, 0)

    base = os.path.join(OUT, f"tut{frame}")
    Image.fromarray(mask).save(base + "_mask.png", optimize=True, compress_level=9)
    Image.fromarray(spec).save(base + "_special.png", optimize=True, compress_level=9)
    top = sorted(counts.items(), key=lambda kv: -kv[1])
    print(f"  frame {frame} (cid {cid}): " + "  ".join(f"{c}x{n}" for c, n in top), flush=True)


def bake_bg():
    """Crop the map backdrop bitmap into the wall frames' coordinate space.

    Arena frame 13 places `images/736.png` at local (-11.45, 0) and `wallMC` at
    the identity, and the port's world coords are wallMC's — so the backdrop's
    first 11 columns sit at negative x and its last row past the map floor.
    """
    im = Image.open(io.BytesIO(zipfile.ZipFile(ZIP).read("raze 2/images/736.png")))
    out = im.convert("RGBA").crop((11, 0, 11 + W, H))
    out.save(os.path.join(OUT, "tut_bg.png"), optimize=True, compress_level=9)
    print(f"  bg: {im.size} -> {out.size}", flush=True)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    args = sys.argv[1:]
    for f in [int(a) for a in args if a != "bg"] or ([] if args else range(1, len(SHAPES) + 1)):
        bake(f)
    if not args or "bg" in args:
        bake_bg()
    print("done ->", OUT)
