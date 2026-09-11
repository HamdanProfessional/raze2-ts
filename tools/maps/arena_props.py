#!/usr/bin/env python3
"""Every character placed on a map's Arena frame, resolved to its AS3 class.

`arena_clips.py` only reports the handful of *named* helper clips the port
already consumes. The authored animated props (Tutorial_Wall, ExplodingBridge,
FlyShip, Light_Pulse, ...) are mostly placed WITHOUT an instance name, so a
name-filtered walk never sees them — they exist only as a character id in the
tag stream plus a SymbolClass entry binding that id to a class.

This walks `DefineSprite_1341_Arena`, counts ShowFrame to attribute each
placement to a map frame, and resolves every character id through SymbolClass
(tag 76) and through the DefineSprite nesting, so a whole map's prop inventory
comes out in one pass.

    python tools/maps/arena_props.py            # tut (frame 13)
    python tools/maps/arena_props.py --map city
    python tools/maps/arena_props.py --all
    python tools/maps/arena_props.py --map tut --json
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_place as B  # noqa: E402  (shares the tag walker + matrix reader)

ARENA_CID = 1341
FRAME_MAP = {
    4: "jungle", 5: "jungle2", 6: "city", 7: "desert", 8: "ocean", 9: "mines",
    10: "mines2", 11: "space", 12: "snow", 13: "tut", 14: "tutq",
}
MAP_FRAME = {v: k for k, v in FRAME_MAP.items()}


def symbol_classes(buf):
    """cid -> AS3 class name, from every SymbolClass (tag 76) in the file."""
    out = {}
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 76:
            continue
        (count,) = struct.unpack_from("<H", buf, p)
        q = p + 2
        for _ in range(count):
            (cid,) = struct.unpack_from("<H", buf, q)
            q += 2
            name, q = B.cstr(buf, q)
            out[cid] = name
    return out


def sprite_frame_counts(buf):
    """cid -> number of frames, for every DefineSprite. >1 means it animates."""
    out = {}
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39:
            continue
        cid, frames = struct.unpack_from("<HH", buf, p)
        out[cid] = frames
    return out


def place_all(buf, p, ln, code, out):
    """Like bg_place.scan_place but keeps UNNAMED placements too.

    Depth is captured as well: it is the display-list z-order, and it is the
    only thing that says whether a prop draws behind or in front of `midCont`
    (the container Game.as drops the units, bullets and physics world into), and
    so is the colour transform, which is what tells the lights apart.
    """
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == 70:
        flags2 = buf[p]
        p += 1
    (depth,) = struct.unpack_from("<H", buf, p)
    p += 2
    if flags2 & 0x08:
        _cn, p = B.cstr(buf, p)
    cid = None
    if flags & 0x02:
        cid = struct.unpack_from("<H", buf, p)[0]
        p += 2
    m = None
    if flags & 0x04:
        m, p = B.matrix6(buf, p)
    cx = None
    if flags & 0x08:
        mult, add, p = B.cxform_read(buf, p)
        cx = (mult, add)
    if flags & 0x10:
        p += 2
    name = None
    if flags & 0x20:
        name, p = B.cstr(buf, p)
    if cid is not None:
        out.append((cid, name, m, depth, cx))


def arena_placements(buf):
    """[(frame, cid, name, matrix, depth, cxform)] for every Arena placement.

    `matrix` is the full six-value transform (see `bg_place.matrix6`); rotation
    is load-bearing on these props, not decoration.
    """
    found = []
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39 or struct.unpack_from("<H", buf, p)[0] != ARENA_CID:
            continue
        frame = 1
        for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
            if c2 == 1:
                frame += 1
                continue
            if c2 not in (26, 70):
                continue
            out = []
            try:
                place_all(buf, p2, l2, c2, out)
            except Exception:
                continue
            for cid, name, m, depth, cx in out:
                found.append((frame, cid, name, m, depth, cx))
        break
    return found


def arena_timeline(buf):
    """frame -> {depth: (cid, name, matrix, cxform)}, by simulating the display list.

    `arena_placements` only sees placements that carry a character id, which is
    enough for props but wrong for anything inherited: Flash keeps a depth
    occupied across frames until something removes it, and a PlaceObject with no
    character id *moves* what is already there. The Arena leans on this hard —
    jungle2 (frame 5) places 2 objects of its own and moves 1, inheriting the
    rest of jungle's frame; tutq (frame 14) places 11 and moves 72. Reading
    those frames without simulating the list finds almost nothing.
    """
    state, frames = {}, {}
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39 or struct.unpack_from("<H", buf, p)[0] != ARENA_CID:
            continue
        frame = 1
        for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
            if c2 == 1:                                  # ShowFrame
                frames[frame] = dict(state)
                frame += 1
            elif c2 in (26, 70):                         # PlaceObject2/3
                try:
                    got = place_one(buf, p2, c2)
                except Exception:
                    continue
                if got is None:
                    continue
                depth, cid, name, m, cx = got
                old = state.get(depth)
                if cid is None and old:                  # move: keep identity
                    cid = old[0]
                    name = name if name is not None else old[1]
                    m = m if m is not None else old[2]
                    cx = cx if cx is not None else old[3]
                state[depth] = (cid, name, m, cx)
            elif c2 == 5:                                # RemoveObject
                state.pop(struct.unpack_from("<HH", buf, p2)[1], None)
            elif c2 == 28:                               # RemoveObject2
                state.pop(struct.unpack_from("<H", buf, p2)[0], None)
        break
    return frames


def place_one(buf, p, code):
    """(depth, cid|None, name|None, matrix|None, cxform|None) for a PlaceObject2/3."""
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == 70:
        flags2 = buf[p]
        p += 1
    (depth,) = struct.unpack_from("<H", buf, p)
    p += 2
    if flags2 & 0x08:
        _cn, p = B.cstr(buf, p)
    cid = None
    if flags & 0x02:
        cid = struct.unpack_from("<H", buf, p)[0]
        p += 2
    m = None
    if flags & 0x04:
        m, p = B.matrix6(buf, p)
    cx = None
    if flags & 0x08:
        mult, add, p = B.cxform_read(buf, p)
        cx = (mult, add)
    if flags & 0x10:
        p += 2
    name = None
    if flags & 0x20:
        name, p = B.cstr(buf, p)
    return depth, cid, name, m, cx


def main():
    argv = sys.argv[1:]
    want = None
    if "--map" in argv:
        want = argv[argv.index("--map") + 1]
    elif "--all" not in argv:
        want = "tut"

    buf = B.body(B.SWF)
    classes = symbol_classes(buf)
    frames = sprite_frame_counts(buf)
    rows = []
    for frame, cid, name, m, depth, _cx in arena_placements(buf):
        mp = FRAME_MAP.get(frame, f"frame{frame}")
        if want and mp != want:
            continue
        rows.append({
            "map": mp, "frame": frame, "cid": cid, "depth": depth,
            "cls": classes.get(cid, ""), "name": name or "",
            "nframes": frames.get(cid, 1),
            "x": None if m is None else round(m[0], 1),
            "y": None if m is None else round(m[1], 1),
            "sx": None if m is None else round(m[2], 4),
            "sy": None if m is None else round(m[3], 4),
        })

    if "--json" in argv:
        print(json.dumps(rows, indent=1))
        return

    print(f"{'map':8} {'cid':>5} {'fr':>3} {'class / instance':34} "
          f"{'x':>9} {'y':>9} {'sx':>7} {'sy':>7}")
    for r in rows:
        label = r["cls"] or (f"[{r['name']}]" if r["name"] else "")
        if r["cls"] and r["name"]:
            label = f"{r['cls']} ({r['name']})"
        mark = "*" if r["nframes"] > 1 else " "
        x = "-" if r["x"] is None else f"{r['x']:.1f}"
        y = "-" if r["y"] is None else f"{r['y']:.1f}"
        sx = "-" if r["sx"] is None else f"{r['sx']:.3f}"
        sy = "-" if r["sy"] is None else f"{r['sy']:.3f}"
        print(f"{r['map']:8} {r['cid']:5} {r['nframes']:3}{mark}{label:34} "
              f"{x:>9} {y:>9} {sx:>7} {sy:>7}")
    print(f"\n{len(rows)} placements   (* = multi-frame, i.e. it animates)")


if __name__ == "__main__":
    main()
