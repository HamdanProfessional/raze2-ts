#!/usr/bin/env python3
"""
Bake the AUTHENTIC Raze 2 BACK arm (`arm2`) — idle, recoil and reload.

    python tools/arm-reload/build_arms2.py   # -> public/assets/arms2-r2/<pose>/*.png
                                             #    + src/assets/raze2/armAnim2.json

`UnitMC` carries two arm assemblies. `arm1` (`DefineSprite_387`, baked by
build_arms.py) is the front, aiming arm: `armup` + `armlow` + `hand1`/`hand2` +
the `gun` strip. `arm2` (`DefineSprite_136`, `Raze2_fla.Unit_Arms2_14`) is the
back arm — the same 384-frame timeline carved into the same six pose bands, but
carrying ONLY `armup`(132) and `armlow`(102). No hands, no gun.

    UnitMC.as:103-109   arm1.x = arm2.x = arm1hold.x
                        arm1.y = arm2.y = arm1hold.y
    Unit.as:1123/1129   MC.arm1.rotation = MC.arm2.rotation = rotReload + rotArm
    Guns.as:239-248     unit.MC.arm1/arm2.gotoAndStop(frameIdle) / gotoAndPlay(...)

So the back arm shares the front arm's shoulder, rotation and playhead exactly —
it just draws behind the body. And because no gun is composited into it, every
weapon sharing a pose shares one bake: six sheets, not thirty-six.

Cell geometry is computed tight to arm2's own art rather than inherited from
arm1's (which is sized around the gun). The band frame -> cell index mapping is
identical either way, since both clips use the same labels.
"""
import os, re, json, math
from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
DEC = os.path.normpath(os.path.join(ROOT, "..", "decompiled_swf", "raze 2"))
SPR = os.path.join(DEC, "sprites")
ARM = os.path.join(SPR, "DefineSprite_136_Raze2_fla.Unit_Arms2_14")
OUT_SVG = os.path.join(SC, "sheets2")
OUT_PNG = os.path.join(ROOT, "public", "assets", "arms2-r2")
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "armAnim2.json")
os.makedirs(OUT_SVG, exist_ok=True)
os.makedirs(OUT_PNG, exist_ok=True)

# Identical to build_arms.py's BANDS — the two clips share frame labels.
BANDS = {
    "pistol":  {"idle": 1,   "fire": (2, 16),    "reload": (17, 54)},
    "rifle":   {"idle": 55,  "fire": (56, 59),   "reload": (60, 98)},
    "shotgun": {"idle": 99,  "fire": (100, 119), "reload": (120, 181)},
    "sniper":  {"idle": 182, "fire": (183, 196), "reload": (197, 241)},
    "heavy":   {"idle": 242, "fire": (243, 247), "reload": (248, 285)},
    "rocket":  {"idle": 286, "fire": (287, 299), "reload": (300, 355)},
}

PART_DIR = {102: "DefineSprite_102_PhysLowerArm", 132: "DefineSprite_132_PhysUpperArm"}
# Back to front. The frame SVGs list children front-to-back, so this is reversed.
DRAW_ORDER = [("armup", 132), ("armlow", 102)]
SKIN_FRAME = 3  # `raze` (Raze Soldier), the default skin — matches build_arms.py
MARGIN = 4.0
QUANT_COLORS = 255

NUMRE = r"[-0-9.eE]+"


def parse_matrix(s):
    return [float(x) for x in re.findall(NUMRE, s)]


def read_use_matrices(text):
    out = {}
    for m in re.finditer(r'<use\b([^>]*?)/?>', text):
        a = m.group(1)
        i = re.search(r'\bid="([^"]+)"', a)
        t = re.search(r'transform="matrix\(([^)]*)\)"', a)
        if i and t:
            out[i.group(1)] = parse_matrix(t.group(1))
    return out


def band_frames(pose):
    """Every SWF frame of a pose, idle -> recoil -> reload, contiguous."""
    b = BANDS[pose]
    return list(range(b["idle"], b["reload"][1] + 1))


needed = sorted({f for p in BANDS for f in band_frames(p)})
frame_mat = {f: read_use_matrices(open(os.path.join(ARM, f"{f}.svg"), encoding="utf-8").read())
             for f in needed}


def part_header(text):
    w = float(re.search(r'width="([-0-9.]+)px"', text).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', text).group(1))
    g = re.search(r'<g transform="matrix\(([^)]*)\)"', text)
    mm = parse_matrix(g.group(1)) if g else [1, 0, 0, 1, 0, 0]
    return w, h, mm[4], mm[5]


def part_inner_and_defs(text, tag):
    """Symbol art + its <defs>, with every id/href namespaced so both symbols
    can share one sheet document without colliding."""
    g = re.search(r'<g transform="matrix\([^)]*\)">(.*?)</g>\s*<defs>', text, re.S)
    inner = g.group(1) if g else ""
    d = re.search(r'<defs>(.*)</defs>', text, re.S)
    defs = d.group(1) if d else ""
    pre = f"{tag}_"

    def fix(s):
        s = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{pre}{m.group(1)}"', s)
        s = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{pre}{m.group(1)}"', s)
        return re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{pre}{m.group(1)})', s)

    return fix(inner), fix(defs)


def sym_path(cid, frame):
    return os.path.join(SPR, PART_DIR[cid], f"{frame}.svg")


def sym_bbox(cid, frame):
    w, h, ox, oy = part_header(open(sym_path(cid, frame), encoding="utf-8").read())
    return (-ox, -oy, w - ox, h - oy)


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


part_bb = {cid: sym_bbox(cid, SKIN_FRAME) for cid in PART_DIR}

minx = miny = math.inf
maxx = maxy = -math.inf
for f in needed:
    for sid, cid in DRAW_ORDER:
        m = frame_mat[f].get(sid)
        if not m:
            continue
        b = part_bb[cid]
        for cx, cy in ((b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])):
            x, y = apply(m, cx, cy)
            minx, maxx = min(minx, x), max(maxx, x)
            miny, maxy = min(miny, y), max(maxy, y)

CW = math.ceil(maxx - minx + 2 * MARGIN)
CH = math.ceil(maxy - miny + 2 * MARGIN)
# The arm clip's own origin — the shoulder it is rotated about — inside a cell.
OX, OY = -minx + MARGIN, -miny + MARGIN
print(f"cell {CW}x{CH}  shoulder ({OX:.2f},{OY:.2f}) -> anchor ({OX/CW:.4f},{OY/CH:.4f})")

MAXLEN = max(len(band_frames(p)) for p in BANDS)
COLS = max(1, math.ceil(math.sqrt(MAXLEN * CH / CW)))
print(f"cols {COLS}, longest band {MAXLEN} frames")

DEFS = "".join(
    part for cid in PART_DIR
    for inner, d in [part_inner_and_defs(open(sym_path(cid, SKIN_FRAME), encoding="utf-8").read(), f"s{cid}")]
    for part in (d, f'<g id="P_{cid}">{inner}</g>')
)


def draw_frame(f, cx, cy):
    out = []
    for sid, cid in DRAW_ORDER:
        m = frame_mat[f].get(sid)
        if m:
            out.append(f'<use xlink:href="#P_{cid}" transform="matrix('
                       f'{m[0]},{m[1]},{m[2]},{m[3]},{m[4]+cx},{m[5]+cy})"/>')
    return "".join(out)


def svg(w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}"><defs>{DEFS}</defs>{body}</svg>')


poses = {}
for p, b in BANDS.items():
    start = b["idle"]
    frames = band_frames(p)
    rows = math.ceil(len(frames) / COLS)
    poses[p] = {
        "count": len(frames),
        "idle": 0,
        "fire": [b["fire"][0] - start, b["fire"][1] - start],
        "reload": [b["reload"][0] - start, b["reload"][1] - start],
        "rows": rows,
    }
    body = "".join(draw_frame(f, (i % COLS) * CW + OX, (i // COLS) * CH + OY)
                   for i, f in enumerate(frames))
    d = os.path.join(OUT_SVG, p)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "anim.svg"), "w", encoding="utf-8").write(svg(CW * COLS, CH * rows, body))
    open(os.path.join(d, "idle.svg"), "w", encoding="utf-8").write(svg(CW, CH, draw_frame(b["idle"], OX, OY)))

print(f"built {len(poses)} back-arm sheets -> {OUT_SVG}")

total = 0
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-gl=swiftshader"])
    pg = br.new_page(viewport={"width": 64, "height": 64}, device_scale_factor=1)

    def shoot(src, dest, w, h):
        global total
        pg.set_viewport_size({"width": w, "height": h})
        pg.set_content('<!doctype html><html><head><style>'
                       'html,body{margin:0;padding:0;background:transparent}'
                       'svg{display:block}</style></head><body>'
                       + open(src, encoding="utf-8").read() + '</body></html>',
                       wait_until="networkidle")
        pg.screenshot(path=dest, omit_background=True,
                      clip={"x": 0, "y": 0, "width": w, "height": h})
        im = Image.open(dest).convert("RGBA")
        im.quantize(colors=QUANT_COLORS, method=Image.FASTOCTREE,
                    dither=Image.Dither.NONE).save(dest, optimize=True, compress_level=9)
        total += os.path.getsize(dest)
        return os.path.getsize(dest)

    for i, p in enumerate(poses):
        d = os.path.join(OUT_PNG, p)
        os.makedirs(d, exist_ok=True)
        a = shoot(os.path.join(OUT_SVG, p, "anim.svg"), os.path.join(d, "anim.png"),
                  CW * COLS, CH * poses[p]["rows"])
        s = shoot(os.path.join(OUT_SVG, p, "idle.svg"), os.path.join(d, "idle.png"), CW, CH)
        print(f"[{i+1}/{len(poses)}] {p:<8} anim {a//1024:>4}K  idle {s//1024:>3}K")
    br.close()

json.dump({
    "cell": [CW, CH],
    "cols": COLS,
    "anchor": [round(OX / CW, 5), round(OY / CH, 5)],
    "skinFrame": SKIN_FRAME,
    "note": ("Authentic Raze 2 BACK arm baked from DefineSprite_136 (Unit_Arms2): "
             "armup + armlow only, no hands and no gun. Keyed by POSE rather than "
             "weapon id -- with no gun composited in, every weapon sharing a pose "
             "shares one bake. Band frame -> cell index matches armAnim.json "
             "exactly, so the back arm rides the front arm's playhead. `anchor` is "
             "the arm clip's shoulder origin as a fraction of a cell: it is the "
             "SAME shoulder point arm1 uses (UnitMC.as:103-109), so both arms are "
             "placed at one position and share one rotation."),
    "poses": poses,
}, open(MANIFEST, "w"), indent=1)
print("wrote", os.path.normpath(MANIFEST), f"  total {total/1048576:.2f} MB")
