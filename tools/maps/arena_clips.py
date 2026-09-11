#!/usr/bin/env python3
"""Which map frame each authored Arena helper clip sits on.

`DefineSprite_1341_Arena` is one frame per map, and a level author drops helper
clips onto the frames that need them:

  waterMC        the water rectangle `Water.setWater` simulates
  reflectTake1/2 the rectangle whose contents are captured
  reflectShow1/2 where that capture is drawn back (flipped/skewed by the author)
  reflectCam2    the follow target for the moving reflection

None of that is recoverable from the exported frame SVGs — the placements only
exist in the tag stream — so this walks it, counting ShowFrame (tag 1) to
attribute each placement to a frame, and prints the matrix.

Frame -> map is the mapping established by matching spawn sets (see the
waypoint extractor): 4 jungle, 5 jungle2, 6 city, 7 desert, 8 ocean, 9 mines,
10 mines2, 11 space, 12 snow, 13 tut, 14 tutq.

    python tools/maps/arena_clips.py
"""
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_place as B  # noqa: E402  (shares the tag walker + matrix reader)

ARENA_CID = 1341
WANT = {"waterMC", "reflectTake1", "reflectShow1",
        "reflectTake2", "reflectShow2", "reflectCam2"}
FRAME_MAP = {
    4: "jungle", 5: "jungle2", 6: "city", 7: "desert", 8: "ocean", 9: "mines",
    10: "mines2", 11: "space", 12: "snow", 13: "tut", 14: "tutq",
}


# Both marker symbols are ~52x52 with their origin at the top-left, so an
# instance's world rectangle is (tx, ty, 52*scaleX, 52*scaleY).
MARKER = {475: (51.95, 52.0), 1180: (52.0, 51.95)}
MAPS_JSON = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "..", "src", "assets", "raze2maps.json"))


def rect(clip):
    w, h = MARKER.get(clip["cid"], (52.0, 52.0))
    return {"x": clip["x"], "y": clip["y"],
            "w": round(w * clip["sx"], 1), "h": round(h * clip["sy"], 1)}


def write(found):
    """Fold `waterMC` / `reflectTake1` / `reflectShow1` into raze2maps.json."""
    data = json.load(open(MAPS_JSON, encoding="utf-8"))
    by_map = {}
    for c in found:
        by_map.setdefault(c["map"], {})[c["name"]] = c
    touched = []
    for mid, clips in by_map.items():
        if mid not in data:
            continue                       # frames the port does not ship
        entry = data[mid]
        entry.pop("water", None)
        entry.pop("reflect", None)
        if "waterMC" in clips:
            entry["water"] = rect(clips["waterMC"])
            touched.append(f"{mid}.water")
        if "reflectTake1" in clips and "reflectShow1" in clips:
            take = rect(clips["reflectTake1"])
            show = clips["reflectShow1"]
            entry["reflect"] = {"take": take,
                                "show": {"x": show["x"], "y": show["y"],
                                         "sx": show["sx"], "sy": show["sy"]}}
            touched.append(f"{mid}.reflect")
    json.dump(data, open(MAPS_JSON, "w", encoding="utf-8"), indent=1)
    print("wrote", ", ".join(touched) or "nothing", "->", MAPS_JSON)


def main():
    buf = B.body(B.SWF)
    found = []
    for code, p, ln in B.tags(buf, B.skip_rect(buf, 0) + 4, len(buf)):
        if code != 39:
            continue
        if struct.unpack_from("<H", buf, p)[0] != ARENA_CID:
            continue
        frame = 1
        for c2, p2, l2 in B.tags(buf, p + 4, p + ln):
            if c2 == 1:            # ShowFrame
                frame += 1
                continue
            if c2 not in (26, 70):
                continue
            out = []
            try:
                B.WANT = WANT
                B.scan_place(buf, p2, l2, c2, frame, out)
            except Exception:
                continue
            for f, name, m, cid in out:
                found.append({"frame": f, "map": FRAME_MAP.get(f, f"frame{f}"),
                              "name": name, "cid": cid,
                              "x": None if m is None else round(m[0], 1),
                              "y": None if m is None else round(m[1], 1),
                              "sx": None if m is None else round(m[2], 4),
                              "sy": None if m is None else round(m[3], 4)})
        break

    if "--json" in sys.argv:
        print(json.dumps(found, indent=1))
        return

    if "--write" in sys.argv:
        write(found)
        return
    print(f"{'map':9} {'clip':14} {'cid':>5} {'x':>9} {'y':>9} {'scaleX':>9} {'scaleY':>9}")
    for f in found:
        print(f"{f['map']:9} {f['name']:14} {f['cid'] or '-':>5} "
              f"{f['x']:9} {f['y']:9} {f['sx']:9} {f['sy']:9}")
    print(f"\n{len(found)} authored clips")


if __name__ == "__main__":
    main()
