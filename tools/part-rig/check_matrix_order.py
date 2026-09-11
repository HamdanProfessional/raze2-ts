#!/usr/bin/env python3
"""Which matrix convention does partRig.json use?

`Unit.updateParts` and `PartFigure.update` both feed the stored affine to Pixi as
`Matrix(m[0], m[2], m[1], m[3], m[4], m[5])` — swapping b and c, which transposes
the 2x2 and therefore mirrors every limb's rotation. The stored matrices are
clean rotations ([c,-s,s,c]), so both readings look plausible in isolation and
only a render tells them apart.

This composites the layered rig BOTH ways and puts the flat baked body
(anim-nohead, the same character in the same state) beside them as ground truth.

    python tools/part-rig/check_matrix_order.py [state] [frame]
"""
import os, sys, json, base64
from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
rig = json.load(open(os.path.join(ROOT, "src", "assets", "partRig.json")))

STATE = sys.argv[1] if len(sys.argv) > 1 else "idle"
FRAME = int(sys.argv[2]) if len(sys.argv) > 2 else 0
COSTUME = 1
NAME = {456: "neck", 486: "foot", 550: "leglow", 616: "legup", 681: "body"}

W, H = 260, 260
OX, OY = W / 2, H * 0.78          # feet origin inside the canvas
ROOTY = rig["rootY"]

parts = sorted(rig["states"][STATE]["frames"][FRAME], key=lambda p: p["d"])


def part_png(cid):
    return os.path.join(ROOT, "public", "assets", "body-parts", NAME[cid], f"{COSTUME}.png")


def build(swap: bool) -> str:
    body = []
    for p in parts:
        cid = p["cid"]
        path = part_png(cid)
        if not os.path.exists(path):
            continue
        with Image.open(path) as im:
            iw, ih = im.size
        piv = rig["pivots"][str(cid)]
        m = p["m"]
        a, b, c, d = (m[0], m[2], m[1], m[3]) if swap else (m[0], m[1], m[2], m[3])
        # The container sits at the clip origin, ROOTY above the feet.
        tx, ty = m[4] + OX, m[5] + OY + ROOTY
        # Inlined, not file:/// — a set_content page is treated as opaque and
        # Chromium refuses to fetch local files from it.
        b64 = base64.b64encode(open(path, "rb").read()).decode()
        href = f"data:image/png;base64,{b64}"
        body.append(
            f'<g transform="matrix({a},{b},{c},{d},{tx},{ty})">'
            f'<image href="{href}" x="{-piv["px"] * iw}" y="{-piv["py"] * ih}" '
            f'width="{iw}" height="{ih}"/></g>'
        )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">{"".join(body)}</svg>')


shots = {}
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-gl=swiftshader"])
    pg = br.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    for label, swap in (("direct", False), ("swapped", True)):
        pg.set_content('<!doctype html><body style="margin:0;background:transparent">'
                       + build(swap) + "</body>", wait_until="networkidle")
        dest = os.path.join(SC, f"_{label}.png")
        pg.screenshot(path=dest, omit_background=True,
                      clip={"x": 0, "y": 0, "width": W, "height": H})
        shots[label] = Image.open(dest).convert("RGBA")
    br.close()

# Ground truth: the flat baked body, same state, arms and head removed.
ref_path = os.path.join(ROOT, "public", "assets", "anim-nohead", STATE, f"{FRAME + 1}.png")
ref = Image.open(ref_path).convert("RGBA") if os.path.exists(ref_path) else None

Z = 3
cols = ["direct", "swapped"] + (["baked ref"] if ref else [])
out = Image.new("RGBA", (W * Z * len(cols), H * Z), (26, 28, 34, 255))
for i, name in enumerate(cols):
    im = shots.get(name) or ref
    if name == "baked ref":
        # Sit the reference on the same feet origin for a like-for-like read.
        canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        canvas.paste(ref, (int(OX - ref.width / 2), int(OY - ref.height)), ref)
        im = canvas
    im = im.resize((W * Z, H * Z), Image.NEAREST)
    out.paste(im, (i * W * Z, 0), im)

dest = os.path.join(SC, "_matrix_order.png")
out.save(dest)
print(f"state={STATE} frame={FRAME} parts={len(parts)}")
print("columns:", " | ".join(cols))
print("wrote", dest, out.size)

# --- score each reading against the baked body ------------------------------
# Silhouette overlap after aligning on the alpha bounding box, which cancels out
# the different canvas origins. The assembled rig and the flat bake are the same
# character in the same pose, so the correct convention should win clearly.
if ref:
    def mask(im):
        a = im.getchannel("A")
        bb = a.getbbox()
        return a.crop(bb).point(lambda v: 255 if v > 40 else 0) if bb else None

    rm = mask(ref)
    print("\nsilhouette agreement with the baked body:")
    scores = {}
    for name in ("direct", "swapped"):
        cm = mask(shots[name])
        if not cm or not rm:
            continue
        # Match on the reference's grid; IoU is scale/translation stable here.
        cm2 = cm.resize(rm.size, Image.NEAREST)
        cp, rp = cm2.load(), rm.load()
        inter = union = 0
        for y in range(rm.size[1]):
            for x in range(rm.size[0]):
                a_, b_ = cp[x, y] > 0, rp[x, y] > 0
                inter += a_ and b_
                union += a_ or b_
        scores[name] = inter / union if union else 0
        print(f"  {name:<8} IoU {scores[name]:.3f}   (bbox {cm.size} vs ref {rm.size})")
    if len(scores) == 2:
        win = max(scores, key=scores.get)
        margin = abs(scores["direct"] - scores["swapped"])
        print(f"\n  -> {win} matches better, margin {margin:.3f}"
              + ("  (TOO CLOSE TO CALL)" if margin < 0.02 else ""))
