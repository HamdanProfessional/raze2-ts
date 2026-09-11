#!/usr/bin/env python3
"""The authored ragdoll-collision rectangles for each Raze 2 map.

Live units collide against the pixel wall mask, but the *corpse* world is
Box2D: `Arena.as:894` collects every `NodePhysBox` dropped on the map's frame
into `physboxes`, and `PhysWorld.generateWorld` (`:73`) turns each into a static
box — `SetAsBox(width / 60, height / 60)` at `(x / 30, y / 30)`, `angle` from
the clip's rotation, friction 0.3, density 0.

Those clips are unnamed instances, so unlike `arena_clips.py` this matches on
character id rather than instance name, and it needs the rotate/skew terms the
shared matrix reader throws away.

    python tools/maps/physboxes.py            # table
    python tools/maps/physboxes.py --json
    python tools/maps/physboxes.py --write    # fold into raze2maps.json
"""
import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_place as B  # noqa: E402  (shares the tag walker)

ARENA_CID = 1341
FRAME_MAP = {
    4: "jungle", 5: "jungle2", 6: "city", 7: "desert", 8: "ocean", 9: "mines",
    10: "mines2", 11: "space", 12: "snow", 13: "tut", 14: "tutq",
}
MAPS_JSON = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "..", "src", "assets", "raze2maps.json"))


def full_matrix(buf, pos):
    """MATRIX -> ((a, b, c, d), (tx, ty)) with the rotate/skew terms kept."""
    r = B.Bits(buf, pos)
    a = d = 1.0
    b = c = 0.0
    if r.read(1):                       # HasScale
        nb = r.read(5)
        a = r.read(nb, True) / 65536.0
        d = r.read(nb, True) / 65536.0
    if r.read(1):                       # HasRotate
        nb = r.read(5)
        b = r.read(nb, True) / 65536.0
        c = r.read(nb, True) / 65536.0
    nb = r.read(5)
    tx = r.read(nb, True) / 20.0
    ty = r.read(nb, True) / 20.0
    return (a, b, c, d), (tx, ty), r.align()


def symbol_classes(buf):
    """cid -> AS3 class name, from SymbolClass (tag 76)."""
    out = {}
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 76:
            continue
        n = struct.unpack_from("<H", buf, p)[0]
        q = p + 2
        for _ in range(n):
            cid = struct.unpack_from("<H", buf, q)[0]
            name, q = B.cstr(buf, q + 2)
            out[cid] = name
    return out


def rect_tag(buf, pos):
    """A leading RECT, in px."""
    r = B.Bits(buf, pos)
    nb = r.read(5)
    xmin = r.read(nb, True) / 20.0
    xmax = r.read(nb, True) / 20.0
    ymin = r.read(nb, True) / 20.0
    ymax = r.read(nb, True) / 20.0
    return xmin, xmax, ymin, ymax


def char_bounds(buf, want):
    """Natural bounds of a character: shapes carry them, sprites delegate."""
    shapes, sprites = {}, {}
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code in (2, 22, 32, 83):     # DefineShape 1-4
            cid = struct.unpack_from("<H", buf, p)[0]
            shapes[cid] = rect_tag(buf, p + 2)
        elif code == 39:
            cid = struct.unpack_from("<H", buf, p)[0]
            kids = []
            for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
                if c2 in (26, 70):
                    out = []
                    saved, B.WANT = B.WANT, None
                    try:
                        B.scan_place(buf, p2, l2, c2, cid, out)
                    except Exception:
                        pass
                    B.WANT = saved
                    # scan_place only reports named placements, so re-read the
                    # character id directly.
                    kid = place_cid(buf, p2, c2)
                    if kid:
                        kids.append(kid)
            sprites[cid] = kids
    seen = set()

    def resolve(cid):
        if cid in seen:
            return None
        seen.add(cid)
        if cid in shapes:
            return shapes[cid]
        for kid in sprites.get(cid, []):
            r = resolve(kid)
            if r:
                return r
        return None

    return resolve(want)


def place_cid(buf, p, code):
    """Character id of a PlaceObject2/3, or None when it only mutates a depth."""
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == 70:
        flags2 = buf[p]
        p += 1
    p += 2                              # depth
    if flags2 & 0x08:                   # HasClassName
        _cn, p = B.cstr(buf, p)
    if not (flags & 0x02):              # HasCharacter
        return None
    return struct.unpack_from("<H", buf, p)[0]


def scan_boxes(buf, want_cid, base):
    """Every placement of `want_cid` on the Arena timeline, as world rects."""
    bw = base[1] - base[0]
    bh = base[3] - base[2]
    found = []
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39 or struct.unpack_from("<H", buf, p)[0] != ARENA_CID:
            continue
        frame = 1
        for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
            if c2 == 1:                 # ShowFrame
                frame += 1
                continue
            if c2 not in (26, 70):
                continue
            if place_cid(buf, p2, c2) != want_cid:
                continue
            q = p2 + 1 + (1 if c2 == 70 else 0) + 2
            flags = buf[p2]
            flags2 = buf[p2 + 1] if c2 == 70 else 0
            if flags2 & 0x08:
                _cn, q = B.cstr(buf, q)
            q += 2                      # character id
            if not (flags & 0x04):      # HasMatrix
                continue
            (a, b, c, d), (tx, ty), _ = full_matrix(buf, q)
            sx = math.hypot(a, b)
            sy = math.hypot(c, d)
            rot = math.degrees(math.atan2(b, a))
            found.append({
                "frame": frame, "map": FRAME_MAP.get(frame, f"frame{frame}"),
                # `generateWorld` reads the clip's x/y (its registration point)
                # and its post-scale width/height.
                "x": round(tx, 1), "y": round(ty, 1),
                "w": round(bw * sx, 1), "h": round(bh * sy, 1),
                "rot": round(rot, 2),
            })
        break
    return found


def write(found):
    data = json.load(open(MAPS_JSON, encoding="utf-8"))
    by_map = {}
    for c in found:
        by_map.setdefault(c["map"], []).append(c)
    touched = []
    for mid in data:
        boxes = by_map.get(mid, [])
        data[mid].pop("physBoxes", None)
        if boxes:
            data[mid]["physBoxes"] = [
                [b["x"], b["y"], b["w"], b["h"]] if not b["rot"]
                else [b["x"], b["y"], b["w"], b["h"], b["rot"]]
                for b in boxes
            ]
            touched.append(f"{mid}:{len(boxes)}")
    json.dump(data, open(MAPS_JSON, "w", encoding="utf-8"), indent=1)
    print("wrote", ", ".join(touched) or "nothing", "->", MAPS_JSON)


def main():
    buf = B.body(B.SWF)
    classes = symbol_classes(buf)
    cid = next((c for c, n in classes.items() if n.endswith("NodePhysBox")), None)
    if cid is None:
        raise SystemExit("NodePhysBox has no SymbolClass entry")
    base = char_bounds(buf, cid)
    if not base:
        raise SystemExit(f"no bounds for character {cid}")
    print(f"NodePhysBox = character {cid}, natural bounds "
          f"x[{base[0]}, {base[1]}] y[{base[2]}, {base[3]}]", file=sys.stderr)

    found = scan_boxes(buf, cid, base)
    if "--json" in sys.argv:
        print(json.dumps(found, indent=1))
        return
    if "--write" in sys.argv:
        write(found)
        return
    print(f"{'map':9} {'x':>9} {'y':>9} {'w':>9} {'h':>9} {'rot':>8}")
    for f in found:
        print(f"{f['map']:9} {f['x']:9} {f['y']:9} {f['w']:9} {f['h']:9} {f['rot']:8}")
    by = {}
    for f in found:
        by[f["map"]] = by.get(f["map"], 0) + 1
    print(f"\n{len(found)} boxes: " + ", ".join(f"{k} {v}" for k, v in sorted(by.items())))


if __name__ == "__main__":
    main()
