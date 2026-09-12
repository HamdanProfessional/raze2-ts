#!/usr/bin/env python3
"""
Bake the AUTHENTIC Raze 2 arms — idle, recoil and reload, per SKIN and per GUN.

    python tools/arm-reload/build_arms.py                # everything
    python tools/arm-reload/build_arms.py --skins raze   # just one skin
    python tools/arm-reload/build_arms.py --no-render    # SVG + manifest only

Supersedes the earlier per-weapon bake and folds in build_arms2.py's back arm.

Why it is split this way
------------------------
`UnitMC` carries two arm assemblies, and `Guns.as:234-249` drives both off one
playhead:

    arm1  DefineSprite_387 (Unit_Arms1)  armup + armlow + hand1 + gun + hand2
    arm2  DefineSprite_136 (Unit_Arms2)  armup + armlow

Of those children only `gun` is weapon-specific — it is the 37-frame
DefineSprite_380 strip, indexed by `curGun.sprite`. Every other child is a SKIN
strip, frame-selected at runtime exactly like the body (`UnitMC.setSkin` ->
`part.gotoAndStop(skinFrame)`). Baking the gun into the arm therefore forced one
fixed skin on every unit: a green mutant wore the Raze Soldier's dark arm and
red hand. The arm parts genuinely differ per skin — colour, glove, armour — so
that reads as a bug.

So the two axes are separated:

    skin sheet   one per (skin, pose)   the arm/hand art, no gun
    gun sheet    one per weapon         the gun art, no arm

31 skins x 6 poses + 36 weapons = 222 sheets, versus 36 x 31 = 1116 if the gun
were baked in against every skin. The gun art is stored once instead of 31
times.

The skin sheet holds THREE bands of `count` cells, because the gun sits between
`hand1` and `hand2` in the draw order and the forward hand has to grip over the
weapon:

    band 0  BACK   armup + armlow + hand1   (arm1, behind the gun)
    band 1  FRONT  hand2                    (arm1, in front of the gun)
    band 2  ARM2   armup + armlow           (the back arm, behind the body)

Cell index for band b, frame f is `b * count + f`.

One cell geometry and one anchor serve all four layers: `UnitMC.as:103-109` sets
`arm1.x = arm2.x = arm1hold.x`, so both clips share the shoulder origin, and the
cell is the union over every part, every skin frame and every gun frame. That
means the runtime can place all four sprites at one point with one rotation.
"""
import os, re, sys, json, math
from PIL import Image
from playwright.sync_api import sync_playwright

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
DEC = os.path.normpath(os.path.join(ROOT, "..", "decompiled_swf", "raze 2"))
SPR = os.path.join(DEC, "sprites")
ARM1 = os.path.join(SPR, "DefineSprite_387_Raze2_fla.Unit_Arms1_27")
ARM2 = os.path.join(SPR, "DefineSprite_136_Raze2_fla.Unit_Arms2_14")
OUT_SVG = os.path.join(SC, "sheets")
OUT_PNG = os.path.join(ROOT, "public", "assets", "arms-r2")
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "armAnim.json")

# Pose bands, 1-based inclusive SWF frames. Labels from the clips' FrameLabelTags;
# the band ends from Unit_Arms1_27.as's doneShoot()/doneReload() frame scripts.
# Both clips share these labels.
BANDS = {
    "pistol":  {"idle": 1,   "fire": (2, 16),    "reload": (17, 54)},
    "rifle":   {"idle": 55,  "fire": (56, 59),   "reload": (60, 98)},
    "shotgun": {"idle": 99,  "fire": (100, 119), "reload": (120, 181)},
    "sniper":  {"idle": 182, "fire": (183, 196), "reload": (197, 241)},
    "heavy":   {"idle": 242, "fire": (243, 247), "reload": (248, 285)},
    "rocket":  {"idle": 286, "fire": (287, 299), "reload": (300, 355)},
}

PART_DIR = {
    380: "DefineSprite_380",
    342: "DefineSprite_342_PhysHand",
    102: "DefineSprite_102_PhysLowerArm",
    132: "DefineSprite_132_PhysUpperArm",
}
# Each band's children, listed back to front. The frame SVGs list them
# front-to-back, so these are reversed from document order.
BAND_BACK = [("armup", 132), ("armlow", 102), ("hand1", 342)]
BAND_FRONT = [("hand2", 342)]
BAND_ARM2 = [("armup", 132), ("armlow", 102)]
BAND_ORDER = ["back", "front", "arm2"]

GUN_FRAME = {
    "chaingun": 1, "rocket": 2, "icannon": 3, "sawgun": 4, "railgun": 5,
    "shotgun": 6, "pshotgun": 7, "arifle": 8, "pistol": 9, "magnum": 10,
    "blood": 11, "bubrifle": 12, "uzi": 13, "asniper": 14, "plasmapistol": 15,
    "tshotgun": 16, "sparkgun": 17, "mauser": 18, "sniper": 19, "katana": 20,
    "destroyer": 21, "beamer": 22, "zapper": 23, "pcanon": 24, "burster": 25,
    "blaster": 26, "laserrifle": 27, "arifle2": 28, "sniper2": 29, "icegun": 30,
    "stickylauncher": 31, "railgun2": 32, "spitter": 33, "hrocket": 34,
    "flamethrower": 35, "hrocket2": 36, "creditsgun": 37,
}
MARGIN = 4.0
QUANT_COLORS = 255
# Palette-quantising anti-aliased vector art costs edge quality for size. Off
# with --no-quant, which keeps full RGBA.

args = sys.argv[1:]
DO_RENDER = "--no-render" not in args
only_skins = None
if "--skins" in args:
    only_skins = set(args[args.index("--skins") + 1].split(","))
only_guns = None
if "--guns" in args:
    only_guns = set(args[args.index("--guns") + 1].split(","))
# Supersample factor. The source is vector, so this is free detail: the game
# renders at `scale * devicePixelRatio` (Engine.setupScaling), which on an
# ordinary 1080p window is already ~1.7x and on a hi-dpi panel up to 4x. Baking
# at 1x meant every gun and hand was being magnified from a 1x raster.
QUANT = "--no-quant" not in args
SCALE = 1
if "--scale" in args:
    SCALE = max(1, int(args[args.index("--scale") + 1]))

weapons = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "weapons.json")))
skins = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "skins.json")))
SKIN_FRAMES = {s["id"]: s["frame"] for s in skins}

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
mat1 = {f: read_use_matrices(open(os.path.join(ARM1, f"{f}.svg"), encoding="utf-8").read())
        for f in needed}
mat2 = {f: read_use_matrices(open(os.path.join(ARM2, f"{f}.svg"), encoding="utf-8").read())
        for f in needed}


def part_header(text):
    w = float(re.search(r'width="([-0-9.]+)px"', text).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', text).group(1))
    g = re.search(r'<g transform="matrix\(([^)]*)\)"', text)
    mm = parse_matrix(g.group(1)) if g else [1, 0, 0, 1, 0, 0]
    return w, h, mm[4], mm[5]


def part_inner_and_defs(text, tag):
    """Symbol art + its <defs>, ids namespaced so symbols can share a document."""
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


def union(boxes):
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


# --- one cell for every layer -------------------------------------------------
# Part bboxes are unioned over ALL skin frames (skins differ in art size) and the
# gun over all 37 frames, so a single cell + anchor is valid for every
# (skin, pose, weapon) combination and the runtime never re-anchors.
all_skin_frames = sorted(set(SKIN_FRAMES.values()))
part_bb = {cid: union([sym_bbox(cid, f) for f in all_skin_frames])
           for cid in (342, 102, 132)}
part_bb[380] = union([sym_bbox(380, f) for f in set(GUN_FRAME.values())])

minx = miny = math.inf
maxx = maxy = -math.inf
for f in needed:
    for mats, children in ((mat1, BAND_BACK + BAND_FRONT + [("gun", 380)]),
                           (mat2, BAND_ARM2)):
        for sid, cid in children:
            m = mats[f].get(sid)
            if not m:
                continue
            b = part_bb[cid]
            for cx, cy in ((b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3])):
                x, y = apply(m, cx, cy)
                minx, maxx = min(minx, x), max(maxx, x)
                miny, maxy = min(miny, y), max(maxy, y)

CW = math.ceil(maxx - minx + 2 * MARGIN)
CH = math.ceil(maxy - miny + 2 * MARGIN)
# The shoulder both clips are rotated about, inside a cell.
OX, OY = -minx + MARGIN, -miny + MARGIN
print(f"cell {CW}x{CH}  shoulder ({OX:.2f},{OY:.2f}) -> anchor ({OX/CW:.4f},{OY/CH:.4f})")

MAXCELLS = max(len(band_frames(p)) for p in BANDS) * len(BAND_ORDER)
COLS = max(1, math.ceil(math.sqrt(MAXCELLS * CH / CW)))
while math.ceil(MAXCELLS / COLS) * CH > 4096 or COLS * CW > 4096:
    COLS += 1
    if COLS * CW > 4096:
        raise SystemExit(f"cannot fit {MAXCELLS} cells of {CW}x{CH} under 4096px")
print(f"cols {COLS}, longest band {MAXCELLS // len(BAND_ORDER)} frames "
      f"x {len(BAND_ORDER)} bands = {MAXCELLS} cells")

poses = {}
for p, b in BANDS.items():
    start = b["idle"]
    n = len(band_frames(p))
    poses[p] = {
        "count": n,
        "idle": 0,
        "fire": [b["fire"][0] - start, b["fire"][1] - start],
        "reload": [b["reload"][0] - start, b["reload"][1] - start],
        "rows": math.ceil(n * len(BAND_ORDER) / COLS),
        "gunRows": math.ceil(n / COLS),
    }


def defs_for(parts):
    """<defs> for a {cid: frame} mapping."""
    out = []
    for cid, fr in parts.items():
        inner, d = part_inner_and_defs(
            open(sym_path(cid, fr), encoding="utf-8").read(), f"s{cid}")
        out += [d, f'<g id="P_{cid}">{inner}</g>']
    return "".join(out)


def draw(mats, f, children, cx, cy):
    out = []
    for sid, cid in children:
        m = mats[f].get(sid)
        if m:
            out.append(f'<use xlink:href="#P_{cid}" transform="matrix('
                       f'{m[0]},{m[1]},{m[2]},{m[3]},{m[4]+cx},{m[5]+cy})"/>')
    return "".join(out)


def svg(w, h, defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>')


def cell_xy(i):
    return (i % COLS) * CW + OX, (i // COLS) * CH + OY


# --- skin sheets: one per (skin, pose), three bands ---------------------------
skin_ids = [s for s in SKIN_FRAMES if not only_skins or s in only_skins]
jobs = []   # (svg_path, png_path, w, h, label)
for sk in skin_ids:
    sf = SKIN_FRAMES[sk]
    defs = defs_for({342: sf, 102: sf, 132: sf})
    for p in BANDS:
        frames = band_frames(p)
        n = len(frames)
        body = []
        for bi, band in enumerate(BAND_ORDER):
            mats, children = ((mat1, BAND_BACK) if band == "back" else
                              (mat1, BAND_FRONT) if band == "front" else
                              (mat2, BAND_ARM2))
            for i, f in enumerate(frames):
                cx, cy = cell_xy(bi * n + i)
                body.append(draw(mats, f, children, cx, cy))
        d = os.path.join(OUT_SVG, "skin", sk)
        os.makedirs(d, exist_ok=True)
        sp = os.path.join(d, f"{p}.svg")
        open(sp, "w", encoding="utf-8").write(
            svg(CW * COLS, CH * poses[p]["rows"], defs, "".join(body)))
        od = os.path.join(OUT_PNG, "skin", sk)
        jobs.append((sp, os.path.join(od, f"{p}.png"),
                     CW * COLS, CH * poses[p]["rows"], f"{sk}/{p}"))

# --- gun sheets: one per weapon ----------------------------------------------
by_id, skipped = {}, []
for w in weapons:
    wid = w["id"]
    pose = w.get("frameIdle") or w.get("frameReload")
    gf = GUN_FRAME.get(w.get("sprite"))
    if pose not in BANDS or not gf:
        skipped.append(f"{wid}(pose={pose!r},sprite={w.get('sprite')!r})")
        continue
    frames = band_frames(pose)
    body = "".join(draw(mat1, f, [("gun", 380)], *cell_xy(i))
                   for i, f in enumerate(frames))
    if only_guns is not None and wid not in only_guns:
        continue
    d = os.path.join(OUT_SVG, "gun")
    os.makedirs(d, exist_ok=True)
    sp = os.path.join(d, f"{wid}.svg")
    open(sp, "w", encoding="utf-8").write(
        svg(CW * COLS, CH * poses[pose]["gunRows"], defs_for({380: gf}), body))
    jobs.append((sp, os.path.join(OUT_PNG, "gun", f"{wid}.png"),
                 CW * COLS, CH * poses[pose]["gunRows"], f"gun/{wid}"))
    by_id[wid] = pose

print(f"{len(skin_ids)} skins x {len(BANDS)} poses + {len(by_id)} guns "
      f"= {len(jobs)} sheets")
if skipped:
    print("no arm band (expected for throwables / non-gun equipment):")
    for s in skipped:
        print("   ", s)

json.dump({
    # `cell` is in TEXTURE pixels so the runtime slices correctly; `scale` is the
    # multiplier that takes the sprite back to its logical on-screen size, the
    # same convention skinAnim.json uses. `anchor` is normalised, so it is
    # resolution-independent and does not change with the supersample factor.
    "cell": [CW * SCALE, CH * SCALE],
    "cols": COLS,
    "scale": round(1.0 / SCALE, 6),
    "supersample": SCALE,
    "anchor": [round(OX / CW, 5), round(OY / CH, 5)],
    "bands": {b: i for i, b in enumerate(BAND_ORDER)},
    "note": ("Authentic Raze 2 arms baked from DefineSprite_387 (arm1) and "
             "DefineSprite_136 (arm2). Split on the two axes the SWF itself "
             "splits on: the arm/hand parts are SKIN strips, the gun is the "
             "DefineSprite_380 strip indexed by curGun.sprite. So a skin sheet "
             "(skin/<skin>/<pose>.png) carries the arm art for every weapon "
             "sharing that pose, and a gun sheet (gun/<weapon>.png) carries "
             "just the weapon. A skin sheet holds three bands of `count` cells "
             "-- back (armup+armlow+hand1), front (hand2), arm2 -- because the "
             "gun draws between hand1 and hand2; cell index is band*count+frame. "
             "All four layers share one cell and one `anchor` (the shoulder), "
             "since UnitMC.as:103-109 gives arm1 and arm2 the same origin."),
    "poses": poses,
    "weapons": by_id,
    "skins": sorted(SKIN_FRAMES),
}, open(MANIFEST, "w"), indent=1)
print("wrote", os.path.normpath(MANIFEST))

if not DO_RENDER:
    print("--no-render: stopping before rasterisation")
    raise SystemExit(0)

total = 0
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--use-gl=swiftshader"])
    pg = br.new_page(viewport={"width": 64, "height": 64}, device_scale_factor=SCALE)
    for i, (src, dest, w, h, label) in enumerate(jobs):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        pg.set_viewport_size({"width": w, "height": h})
        pg.set_content('<!doctype html><html><head><style>'
                       'html,body{margin:0;padding:0;background:transparent}'
                       'svg{display:block}</style></head><body>'
                       + open(src, encoding="utf-8").read() + '</body></html>',
                       wait_until="networkidle")
        pg.screenshot(path=dest, omit_background=True,
                      clip={"x": 0, "y": 0, "width": w, "height": h})
        im = Image.open(dest).convert("RGBA")
        if QUANT:
            im = im.quantize(colors=QUANT_COLORS, method=Image.FASTOCTREE,
                             dither=Image.Dither.NONE)
        im.save(dest, optimize=True, compress_level=9)
        total += os.path.getsize(dest)
        if i % 20 == 0 or i == len(jobs) - 1:
            print(f"  [{i+1}/{len(jobs)}] {label:<24} {os.path.getsize(dest)//1024}K")
    br.close()
print(f"done -> {OUT_PNG}   total {total/1048576:.1f} MB")
