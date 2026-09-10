#!/usr/bin/env python3
"""
Bake per-skin ANIMATED Raze 2 character art from the decompiled SWF.

Usage (from raze-ts/, needs Python + Pillow + Playwright chromium):
    python tools/skin-anim/build_anim.py           # writes sheets/ + skinAnim.json
    python tools/skin-anim/render.py               # rasterises -> public/.../anim/*.png
    python tools/skin-anim/build_anim.py raze2      # single skin (debug)


Pipeline (see Unit.ts / SkinArt.ts for the render side):
  * A Raze 2 skin is a single frame index applied to every part clip
    (UnitMC.setSkin -> part.gotoAndStop(skinFrame)). Animation (per-frame part
    placement) is skin-INDEPENDENT and lives on the UnitMC (symbol 441) timeline.
  * FFDec exported each UnitMC timeline frame as an SVG whose <use> elements carry
    the ABSOLUTE per-part placement matrix in clip-local coords (id=body/headhold/
    legup1.. etc). It also exported every part symbol's per-frame art as its own
    SVG (sprites/DefineSprite_<cid>_*/<skinFrame>.svg), origin at the part-clip
    registration.
  * For each skin we compose ONE spritesheet SVG: parts are defined once (at that
    skin's frame) in <defs>, then <use>d per (state,frame) cell under the UnitMC
    placement matrix, offset to a fixed cell origin so the feet stay planted.
  * Chromium (Playwright) rasterises each sheet to a PNG. A shared manifest
    records the cell grid + per-state frame counts + the feet anchor.

We bake body + head + both legs/feet (all direct skin-framed Phys clips). We do
NOT bake the aiming front arm (arm1) - the live rig keeps its own aim-tracking
arm+gun overlay on top, like the Raze-1 armless-body rig. The head is placed at
the runtime holder (headhold) matrix, matching UnitMC.EnterFrame.
"""
import os, re, json, math

DEC = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2"
SPR = os.path.join(DEC, "sprites")
UNIT = os.path.join(SPR, "DefineSprite_441_UnitMC")
PART_DIR = {166: "DefineSprite_166_PhysFoot", 196: "DefineSprite_196_PhysLowerLeg",
            226: "DefineSprite_226_PhysUpperLeg", 279: "DefineSprite_279_PhysBody",
            313: "DefineSprite_313_PhysHead"}
SC = os.path.dirname(__file__)
OUT_SVG = os.path.join(SC, "sheets")            # intermediate composite SVGs
MANIFEST = os.path.join(SC, "..", "..", "src", "assets", "raze2", "skinAnim.json")
os.makedirs(OUT_SVG, exist_ok=True)

# Frame ranges are the UnitMC (symbol 441) FrameLabelTag positions, 1-based and
# inclusive — see docs/raze2/02-player-rig-skins.md §3. All 13 labels are listed;
# `armorlock` (184-230) is deliberately NOT baked: at 47 frames it would widen
# every sheet to ~4700px, past the 4096px max texture size a lot of GPUs report,
# and no ability the port implements uses that pose.
STATES = [
    ("idle",        1,   20),
    ("run",         21,  41),
    ("landrun",     42,  55),
    ("jump",        56,  69),
    ("fall",        70,  84),
    ("land",        85,  99),
    ("tuck",        100, 127),   # double jump / jump-pad mega jump flip
    ("runback",     128, 145),
    ("landrunback", 146, 160),
    ("duck",        161, 163),   # crouch entry, falls through to duckloop
    ("crouch",      164, 179),   # duckloop
    ("getup",       180, 183),   # crouch exit
]
# draw order back->front; (svg id to read matrix from, part clip id)
PARTS = [
    ("foot2", 166), ("leglow2", 196), ("legup2", 226),
    ("foot1", 166), ("leglow1", 196), ("legup1", 226),
    ("body", 279), ("headhold", 313),   # head placed at headhold matrix
]
MARGIN = 5.0

skins = json.load(open(os.path.join(
    r"C:\Users\Hamdan\Desktop\mc\raze\raze-ts\src\assets\raze2\skins.json")))

NUMRE = r"[-0-9.eE]+"
def parse_matrix(s):
    return [float(x) for x in re.findall(NUMRE, s)]

def read_use_matrices(svg_text):
    """id -> [a,b,c,d,e,f] for every <use id=...> in a UnitMC frame SVG."""
    out = {}
    for m in re.finditer(r'<use\b([^>]*?)/?>', svg_text):
        attrs = m.group(1)
        idm = re.search(r'\bid="([^"]+)"', attrs)
        tm = re.search(r'transform="matrix\(([^)]*)\)"', attrs)
        if idm and tm:
            out[idm.group(1)] = parse_matrix(tm.group(1))
    return out

# --- Load all UnitMC frame matrices we need -------------------------------
frame_mat = {}   # frame number -> {id: matrix}
needed_frames = sorted({f for _, a, b in STATES for f in range(a, b + 1)})
for f in needed_frames:
    txt = open(os.path.join(UNIT, f"{f}.svg"), encoding="utf-8").read()
    frame_mat[f] = read_use_matrices(txt)

# --- Part symbol SVG parsing ----------------------------------------------
def part_header(svg_text):
    """(width, height, ox, oy): part canvas size + origin position in it."""
    w = float(re.search(r'width="([-0-9.]+)px"', svg_text).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg_text).group(1))
    g = re.search(r'<g transform="matrix\(([^)]*)\)"', svg_text)
    ox, oy = 0.0, 0.0
    if g:
        mm = parse_matrix(g.group(1))
        ox, oy = mm[4], mm[5]
    return w, h, ox, oy

def part_inner_and_defs(svg_text, cid):
    """Return (inner_children, defs_children) of a part SVG, ids prefixed."""
    # inner = children of the first outer <g ...> ... </g>
    gm = re.search(r'<g transform="matrix\([^)]*\)">(.*?)</g>\s*<defs>',
                   svg_text, re.S)
    inner = gm.group(1) if gm else ""
    # Drop the body's "ability" emblem child (char 249) - it is the equipped
    # ability icon slot, not part of the skin, and bakes as a stray bar.
    inner = re.sub(r'<use\b[^>]*\bid="ability"[^>]*/>', '', inner)
    dm = re.search(r'<defs>(.*)</defs>', svg_text, re.S)
    defs = dm.group(1) if dm else ""
    pre = f"p{cid}_"
    def fix(s):
        s = re.sub(r'\bid="([^"]+)"', lambda m: f'id="{pre}{m.group(1)}"', s)
        s = re.sub(r'href="#([^"]+)"', lambda m: f'href="#{pre}{m.group(1)}"', s)
        s = re.sub(r'url\(#([^)]+)\)', lambda m: f'url(#{pre}{m.group(1)})', s)
        return s
    return fix(inner), fix(defs)

# part-local bbox per cid: union over ALL skin frames (robust canvas size).
part_bbox = {}
part_headers = {}   # (cid, frame) -> (w,h,ox,oy)
for cid, d in PART_DIR.items():
    minx = miny = math.inf; maxx = maxy = -math.inf
    for sk in skins:
        fr = sk["frame"]
        p = os.path.join(SPR, d, f"{fr}.svg")
        txt = open(p, encoding="utf-8").read()
        w, h, ox, oy = part_header(txt)
        part_headers[(cid, fr)] = (w, h, ox, oy)
        minx = min(minx, -ox);      maxx = max(maxx, w - ox)
        miny = min(miny, -oy);      maxy = max(maxy, h - oy)
    part_bbox[cid] = (minx, miny, maxx, maxy)

def apply(m, x, y):
    return (m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5])

# global figure bbox across all needed frames/parts (clip space).
gminx = gminy = math.inf; gmaxx = gmaxy = -math.inf
for f in needed_frames:
    mats = frame_mat[f]
    for sid, cid in PARTS:
        if sid not in mats:
            continue
        m = mats[sid]
        bx0, by0, bx1, by1 = part_bbox[cid]
        for cx, cy in ((bx0, by0), (bx1, by0), (bx0, by1), (bx1, by1)):
            x, y = apply(m, cx, cy)
            gminx = min(gminx, x); gmaxx = max(gmaxx, x)
            gminy = min(gminy, y); gmaxy = max(gmaxy, y)

W = math.ceil(gmaxx - gminx + 2 * MARGIN)
H = math.ceil(gmaxy - gminy + 2 * MARGIN)
ORIGIN_X = -gminx + MARGIN          # clip (0,0) x position inside a cell
ORIGIN_Y = -gminy + MARGIN
print(f"cell {W}x{H}  origin ({ORIGIN_X:.2f},{ORIGIN_Y:.2f})  "
      f"anchor ({ORIGIN_X/W:.4f},{ORIGIN_Y/H:.4f})")

# Cells are packed densely into a roughly square grid rather than one row per
# state. A row-per-state grid is as wide as the LONGEST state (tuck, 28) and as
# tall as the state count, so short states like `duck` (3 frames) leave most of
# their row empty — 45% of the sheet was padding, on 31 sheets that all preload.
TOTAL_CELLS = sum(b - a + 1 for _, a, b in STATES)
GRID_COLS = max(1, math.ceil(math.sqrt(TOTAL_CELLS * H / W)))
GRID_ROWS = math.ceil(TOTAL_CELLS / GRID_COLS)
SHEET_W = W * GRID_COLS
SHEET_H = H * GRID_ROWS
assert SHEET_W <= 4096 and SHEET_H <= 4096, f"sheet {SHEET_W}x{SHEET_H} exceeds the 4096 max texture size"

# Global cell index of each state's first frame, in STATES order.
STATE_START = {}
_idx = 0
for _name, _a, _b in STATES:
    STATE_START[_name] = _idx
    _idx += _b - _a + 1

# --- Build one sheet SVG per skin -----------------------------------------
def build_sheet(skin_frame):
    defs = []
    for cid, d in PART_DIR.items():
        txt = open(os.path.join(SPR, d, f"{skin_frame}.svg"), encoding="utf-8").read()
        inner, dfs = part_inner_and_defs(txt, cid)
        defs.append(dfs)
        defs.append(f'<g id="P_{cid}">{inner}</g>')
    body = []
    for name, a, b in STATES:
        for i, f in enumerate(range(a, b + 1)):
            idx = STATE_START[name] + i
            mats = frame_mat[f]
            cx = (idx % GRID_COLS) * W + ORIGIN_X
            cy = (idx // GRID_COLS) * H + ORIGIN_Y
            for sid, cid in PARTS:
                if sid not in mats:
                    continue
                m = mats[sid]
                e = m[4] + cx
                g = m[5] + cy
                body.append(
                    f'<use xlink:href="#P_{cid}" transform="matrix('
                    f'{m[0]},{m[1]},{m[2]},{m[3]},{e},{g})"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" '
            f'xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="{SHEET_W}" height="{SHEET_H}" '
            f'viewBox="0 0 {SHEET_W} {SHEET_H}">'
            f'<defs>{"".join(defs)}</defs>{"".join(body)}</svg>')

import sys
only = sys.argv[1] if len(sys.argv) > 1 else None
built = []
for sk in skins:
    if only and sk["id"] != only:
        continue
    svg = build_sheet(sk["frame"])
    p = os.path.join(OUT_SVG, f'{sk["id"]}.svg')
    open(p, "w", encoding="utf-8").write(svg)
    built.append(sk["id"])
print(f"built {len(built)} sheets -> {OUT_SVG}")

# --- Manifest --------------------------------------------------------------
# On-screen render scale. The bake is composed from the UnitMC placement
# matrices in native clip px, and the arena now draws 1:1 (CAMERA_ZOOM = 1), so
# the figure renders at its authored size: 1.0. It was 0.66, which only looked
# right because the camera was zoomed ~1.571x to compensate.
SKIN_SCALE = 1.0

def state_shoulders(a, b):
    """Per-frame weapon-shoulder point (clip coords, feet origin) from arm1hold."""
    out = []
    for f in range(a, b + 1):
        m = frame_mat[f].get("arm1hold")
        out.append([round(m[4], 2), round(m[5], 2)] if m else [0.0, -57.0])
    return out

manifest = {
    "cell": [W, H],
    "anchor": [round(ORIGIN_X / W, 5), round(ORIGIN_Y / H, 5)],
    "origin": [round(ORIGIN_X, 3), round(ORIGIN_Y, 3)],
    "sheet": [SHEET_W, SHEET_H],
    "cols": GRID_COLS,
    "scale": SKIN_SCALE,
    "note": ("Animated Raze 2 skin bakes. Cells are packed densely across a "
             "`cols`-wide grid: a state's frame f sits at global cell index "
             "start+f, i.e. column (idx % cols), row (idx / cols). Each cell is "
             "cell[w,h] with the feet/clip-origin at anchor (fraction). "
             "Body+head+legs baked; the aim arm+gun are the live rig's overlay, "
             "welded at shoulder[frame] (clip px, feet origin, y up = negative). "
             "Draw the body anchored at anchor with feet on the unit origin, "
             "scaled by scale, flipped by facing."),
    "states": {name: {"start": STATE_START[name], "count": b - a + 1,
                      "shoulder": state_shoulders(a, b)}
               for name, a, b in STATES},
    "skins": [sk["id"] for sk in skins],
}
json.dump(manifest, open(MANIFEST, "w"), indent=1)
print("wrote", os.path.normpath(MANIFEST))
