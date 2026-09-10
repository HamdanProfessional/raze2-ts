#!/usr/bin/env python3
"""
Bake the AUTHENTIC Raze 2 aiming-arm animation — idle, recoil and reload — for
every weapon, straight out of the decompiled SWF.

    python tools/arm-reload/build_arms.py      # -> sheets/ + src/assets/raze2/armAnim.json
    python tools/arm-reload/render_arms.py     # -> public/assets/arms-r2/<id>/{idle,anim}.png

Why this exists
---------------
The aiming arm is `DefineSprite_387` (`Raze2_fla.Unit_Arms1_27`), a 384-frame
timeline carved by FrameLabelTags into six weapon-class bands. `Guns.setFrame()`
drives it and the clip's own frame scripts drive it back:

    setFrame("idle")   -> arm1.gotoAndStop(curGun.frameIdle)
    setFrame("fire")   -> arm1.gotoAndPlay(curGun.frameFire + "_fire")
    setFrame("reload") -> arm1.gotoAndPlay(curGun.frameReload + "_reload")

    frame16  doneShoot()  -> setFrame("idle")      # end of the pistol recoil
    frame17  reloadSound()                          # start of the pistol reload
    frame54  doneReload() -> setFrame("idle") + reloaded()

So the recoil ("fire") band is a real keyframed animation, not a scripted kick,
and every band's exact length is pinned by a `doneShoot`/`doneReload` frame
script. `BANDS` below is read straight off those scripts + the frame labels.

Each SWF frame carries the absolute placement matrix of the clip's five children
— `armup`(132), `armlow`(102), `hand1`/`hand2`(342) and `gun`(380) — so a frame
is reproduced exactly by drawing those symbols under those matrices. `gun` is a
37-frame strip indexed by the weapon's `sprite` field, exactly as
`arm1.gun.gotoAndStop(curGun.sprite)` does at runtime; the arm and hand symbols
are skin strips, drawn at the default skin's frame.

Output: one sheet per weapon holding its whole contiguous band (idle, then
recoil, then reload), packed densely across `cols`. Cell `n` of the sheet is SWF
frame `bandStart + n`, so playback is a straight index walk.
"""
import os, re, json, math

DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2"
SPR = os.path.join(DEC, "sprites")
ARM = os.path.join(SPR, "DefineSprite_387_Raze2_fla.Unit_Arms1_27")
SC = os.path.dirname(os.path.abspath(__file__))
OUT_SVG = os.path.join(SC, "sheets")
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
MANIFEST = os.path.join(ROOT, "src", "assets", "raze2", "armAnim.json")
os.makedirs(OUT_SVG, exist_ok=True)

# Per-pose bands, 1-based inclusive SWF frames.
#   idle          : the single `gotoAndStop` rest frame (the pose label)
#   fire  a..b    : `<pose>_fire` label .. the frame whose script calls doneShoot()
#   reload a..b   : `<pose>_reload` label .. the frame whose script calls doneReload()
# Labels from sprite 387's FrameLabelTags; the b's from Unit_Arms1_27.as.
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
# Back to front. The frame SVGs list children front-to-back, so this is reversed.
DRAW_ORDER = [("armup", 132), ("armlow", 102), ("hand1", 342),
              ("gun", 380), ("hand2", 342)]

# `gun` (380) frame per weapon-sprite name, from its FrameLabelTags. This is the
# value `curGun.sprite` holds, so weapons.json's `sprite` indexes it directly.
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
# The arm/hand symbols are 200-frame skin strips; 3 is `raze` (Raze Soldier),
# the default skin (skins.json, cost 0).
SKIN_FRAME = 3
MARGIN = 4.0

weapons = json.load(open(os.path.join(ROOT, "src", "assets", "raze2", "weapons.json")))

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
    """Symbol art + its <defs>, with every id/href namespaced so several symbols
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

# --- one cell size + shoulder pivot shared by every weapon and every frame ---
gun_bbs = [sym_bbox(380, f) for f in set(GUN_FRAME.values())]
part_bb = {
    380: (min(b[0] for b in gun_bbs), min(b[1] for b in gun_bbs),
          max(b[2] for b in gun_bbs), max(b[3] for b in gun_bbs)),
    342: sym_bbox(342, SKIN_FRAME),
    102: sym_bbox(102, SKIN_FRAME),
    132: sym_bbox(132, SKIN_FRAME),
}

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
print(f"cell {CW}x{CH}  shoulder ({OX:.2f},{OY:.2f}) -> anchor "
      f"({OX/CW:.4f},{OY/CH:.4f})")

MAXLEN = max(len(band_frames(p)) for p in BANDS)
COLS = max(1, math.ceil(math.sqrt(MAXLEN * CH / CW)))
print(f"cols {COLS}, longest band {MAXLEN} frames")

def defs_for(gun_frame):
    out = []
    for cid, fr in {380: gun_frame, 342: SKIN_FRAME,
                    102: SKIN_FRAME, 132: SKIN_FRAME}.items():
        inner, d = part_inner_and_defs(
            open(sym_path(cid, fr), encoding="utf-8").read(), f"s{cid}")
        out += [d, f'<g id="P_{cid}">{inner}</g>']
    return "".join(out)

def draw_frame(f, cx, cy):
    out = []
    for sid, cid in DRAW_ORDER:
        m = frame_mat[f].get(sid)
        if m:
            out.append(f'<use xlink:href="#P_{cid}" transform="matrix('
                       f'{m[0]},{m[1]},{m[2]},{m[3]},{m[4]+cx},{m[5]+cy})"/>')
    return "".join(out)

def svg(w, h, defs, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" '
            f'viewBox="0 0 {w} {h}"><defs>{defs}</defs>{body}</svg>')

poses = {}
for p, b in BANDS.items():
    start = b["idle"]
    poses[p] = {
        "count": len(band_frames(p)),
        "idle": 0,
        "fire": [b["fire"][0] - start, b["fire"][1] - start],
        "reload": [b["reload"][0] - start, b["reload"][1] - start],
        "rows": math.ceil(len(band_frames(p)) / COLS),
    }

by_id, skipped = {}, []
for w in weapons:
    wid, pose, spr = w["id"], w.get("frameReload"), w.get("sprite")
    # `frameIdle`/`frameFire`/`frameReload` are the same pose name in the
    # catalogue; prefer frameIdle and fall back, so a weapon with only one set
    # still resolves.
    pose = w.get("frameIdle") or pose
    gun_frame = GUN_FRAME.get(spr)
    if pose not in BANDS or not gun_frame:
        skipped.append(f"{wid}(pose={pose!r},sprite={spr!r})")
        continue
    frames = band_frames(pose)
    rows = poses[pose]["rows"]
    defs = defs_for(gun_frame)
    body = "".join(draw_frame(f, (i % COLS) * CW + OX, (i // COLS) * CH + OY)
                   for i, f in enumerate(frames))
    d = os.path.join(OUT_SVG, wid)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, "anim.svg"), "w", encoding="utf-8").write(
        svg(CW * COLS, CH * rows, defs, body))
    open(os.path.join(d, "idle.svg"), "w", encoding="utf-8").write(
        svg(CW, CH, defs, draw_frame(BANDS[pose]["idle"], OX, OY)))
    by_id[wid] = pose

print(f"built {len(by_id)} weapon arm sheets -> {OUT_SVG}")
if skipped:
    print("no arm band (expected for throwables / non-gun equipment):")
    for s in skipped:
        print("   ", s)

json.dump({
    "cell": [CW, CH],
    "cols": COLS,
    "anchor": [round(OX / CW, 5), round(OY / CH, 5)],
    "skinFrame": SKIN_FRAME,
    "note": ("Authentic Raze 2 aiming-arm animation baked from DefineSprite_387 "
             "(Unit_Arms1) composited with the weapon's own gun art from "
             "DefineSprite_380, exactly as Guns.as layers them at runtime. One "
             "sheet per weapon holding that weapon's whole pose band packed "
             "densely across `cols`: cell n is band frame n, with `idle`, "
             "`fire` (the recoil animation) and `reload` giving 0-based cell "
             "ranges into it. `anchor` is the arm clip's shoulder origin as a "
             "fraction of a cell -- set it as the sprite anchor and rotate "
             "there to aim."),
    "poses": poses,
    "weapons": by_id,
}, open(MANIFEST, "w"), indent=1)
print("wrote", os.path.normpath(MANIFEST))
