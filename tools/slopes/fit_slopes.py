#!/usr/bin/env python3
"""Recover slope segments from the rect-cover level collision data.

The Raze 1 levels in `src/assets/levelData.json` were extracted by rasterizing
each level's hidden collision sprite into world space, quantizing to a 3px grid
and taking a greedy maximal-rectangle cover (see the hitbox-extraction notes).
That cover is exact for axis-aligned platforms but turns every diagonal into a
blocky 3px staircase -- 37% of all rects across the four levels are really slope
tessellation, and a unit walking one juddered up it a riser at a time.

The diagonal is still *in* the data though: the cover's top edge samples the true
surface every 3px. So this traces the top edge of each solid region, fits
polylines to it (Douglas-Peucker), and emits the sloped runs as real segments.
The rects are left alone -- they stay the body of the level for bullets and for
horizontal blocking; the segments only describe the walkable upper surface.

    python tools/slopes/fit_slopes.py [--write] [--render]

Without --write it reports what it would emit and changes nothing.
"""
import os, sys, json, math

SC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(SC, "..", ".."))
DATA = os.path.join(ROOT, "src", "assets", "levelData.json")

CELL = 3           # the grid the extraction quantized to
MAX_STEP = 3       # cells the top edge may jump between adjacent columns
DP_TOL = 2.0       # Douglas-Peucker tolerance, px
MIN_RUN = 18.0     # shortest segment worth emitting, px
MIN_DEG = 4.0      # below this a segment is flat; the rects already cover it
MAX_DEG = 60.0     # above this it is a cliff face, not a walkable slope


def build_grid(walls, w, h):
    """Solidity grid at CELL resolution; [col][row] -> bool."""
    cols, rows = int(w // CELL) + 1, int(h // CELL) + 1
    grid = [bytearray(rows) for _ in range(cols)]
    for x, y, ww, hh in walls:
        c0, c1 = int(x // CELL), int((x + ww) // CELL)
        r0, r1 = int(y // CELL), int((y + hh) // CELL)
        for c in range(max(0, c0), min(cols, c1)):
            col = grid[c]
            for r in range(max(0, r0), min(rows, r1)):
                col[r] = 1
    return grid, cols, rows


def tops(grid, cols, rows):
    """Per column, the rows that start a solid run (empty above, solid here)."""
    out = []
    for c in range(cols):
        col = grid[c]
        ts = [r for r in range(rows) if col[r] and (r == 0 or not col[r - 1])]
        out.append(ts)
    return out


def trace(top_rows, cols):
    """Chain top cells left-to-right into polylines following one surface."""
    used = [set() for _ in range(cols)]
    chains = []
    for c0 in range(cols):
        for r0 in top_rows[c0]:
            if r0 in used[c0]:
                continue
            chain = [(c0, r0)]
            used[c0].add(r0)
            c, r = c0, r0
            while c + 1 < cols:
                cand = [t for t in top_rows[c + 1]
                        if t not in used[c + 1] and abs(t - r) <= MAX_STEP]
                if not cand:
                    break
                # Follow the nearest continuation so parallel decks do not merge.
                nxt = min(cand, key=lambda t: abs(t - r))
                used[c + 1].add(nxt)
                chain.append((c + 1, nxt))
                c, r = c + 1, nxt
            if len(chain) >= 2:
                chains.append(chain)
    return chains


def rdp(pts, tol):
    """Douglas-Peucker polyline simplification."""
    if len(pts) < 3:
        return list(pts)
    x0, y0 = pts[0]
    x1, y1 = pts[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = math.hypot(dx, dy) or 1.0
    worst, wi = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * (px - x0) - dx * (py - y0)) / norm
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [pts[0], pts[-1]]
    return rdp(pts[:wi + 1], tol)[:-1] + rdp(pts[wi:], tol)


def fit(level, ld):
    walls = ld.get("walls", [])
    if not walls:
        return []
    grid, cols, rows = build_grid(walls, ld["w"], ld["h"])
    segs = []
    for chain in trace(tops(grid, cols, rows), cols):
        # Cell centres in world px. The top edge of a solid cell is its row
        # boundary, so use r*CELL, not the centre: units stand ON the surface.
        pts = [(c * CELL + CELL / 2.0, r * CELL) for c, r in chain]
        for a, b in zip(simple := rdp(pts, DP_TOL), simple[1:]):
            (xa, ya), (xb, yb) = a, b
            run = xb - xa
            if run < MIN_RUN:
                continue
            deg = math.degrees(math.atan2(yb - ya, run))
            if not (MIN_DEG <= abs(deg) <= MAX_DEG):
                continue
            segs.append([round(xa, 1), round(ya, 1), round(xb, 1), round(yb, 1)])
    return segs


def main():
    write = "--write" in sys.argv
    render = "--render" in sys.argv
    data = json.load(open(DATA, encoding="utf-8"))
    total = 0
    for level, ld in data.items():
        segs = fit(level, ld)
        total += len(segs)
        if segs:
            spans = [math.hypot(s[2] - s[0], s[3] - s[1]) for s in segs]
            degs = [abs(math.degrees(math.atan2(s[3] - s[1], s[2] - s[0]))) for s in segs]
            print(f"{level:8s} {len(segs):3d} slopes  "
                  f"len {min(spans):5.0f}-{max(spans):5.0f}px  "
                  f"angle {min(degs):4.1f}-{max(degs):4.1f}deg")
        else:
            print(f"{level:8s}   0 slopes")
        if write:
            if segs:
                ld["slopes"] = segs
            else:
                ld.pop("slopes", None)
    if write:
        # The file ships pretty-printed at 1-space indent; keep it that way so
        # the diff is the slopes and nothing else.
        with open(DATA, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1)
            f.write("\n")
        print(f"\nwrote {total} slope segments -> {DATA}")
    else:
        print(f"\n{total} segments (dry run; pass --write to save)")
    if render:
        do_render(data)


def do_render(data):
    """Overlay the fitted segments on each level's background art."""
    from PIL import Image, ImageDraw
    out = os.path.join(SC, "_fit")
    os.makedirs(out, exist_ok=True)
    for level, ld in data.items():
        segs = ld.get("slopes") or fit(level, ld)
        bg = os.path.join(ROOT, "public", "assets", "levels", f"{level}.png")
        if not os.path.exists(bg):
            continue
        im = Image.open(bg).convert("RGB")
        sx, sy = im.width / ld["w"], im.height / ld["h"]
        d = ImageDraw.Draw(im)
        for x, y, ww, hh in ld.get("walls", []):
            d.rectangle([x * sx, y * sy, (x + ww) * sx, (y + hh) * sy],
                        outline=(90, 40, 40))
        for x0, y0, x1, y1 in segs:
            d.line([x0 * sx, y0 * sy, x1 * sx, y1 * sy], fill=(0, 255, 120), width=3)
        im.save(os.path.join(out, f"{level}.png"))
        print("  rendered", level)


if __name__ == "__main__":
    main()
