#!/usr/bin/env python3
"""Extract every map's authored AI navigation graph into raze2maps.json.

Raze 2 ships a hand-authored waypoint graph per map plus the jump zones that
make it walkable, and the port had neither for any map but the tutorial. Without
them `Arena` falls back to a fully-connected mesh over the spawn points — which
has no notion of *how* to get between two nodes — and the AI compensated by
rolling a random jump whenever its next node was higher. That is the "bot stuck
jumping" you see: it is standing under a ledge hopping on the spot, because
nothing ever told it where the route actually goes up.

Both node kinds are marker MovieClips on `DefineSprite_1341_Arena`, one frame
per map, carrying their parameters in the instance *name*:

  * `NodeWaypoint` (cid 568) — `<id>_<connections>`, e.g. `b_caqd` is node `b`
    linked to c, a, q and d. Links are one character per neighbour.
  * `NodeAiAction` (cid 585) — `<connections>_<action>`, e.g. `qd_d` is a
    double-jump box attached to *both* q and d (`Arena.as:971-981` walks each
    character of `con` and calls `setActionBox`). `action` is `j` (jump once,
    only if not already airborne) or `d` (jump again — the double jump).

The boxes are sized purely by instance scale on the 69x69 `NodeAiAction`
symbol, and `UT.inBox(x, y, box.x, box.y, box.width, box.height)` treats the
registration point as the box's TOP-LEFT, so the rect is
`[x, x + 69*scaleX] x [y, y + 69*scaleY]`.

    python tools/waypoints/extract.py            # write raze2maps.json
    python tools/waypoints/extract.py --dry-run  # just report
"""
import json, os, sys

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
sys.path.insert(0, os.path.join(REPO, "tools", "tut-map"))
import nodes  # noqa: E402  (path set above)

MAPS = os.path.join(REPO, "src", "assets", "raze2maps.json")

# Arena frame per shipped map. Established by matching each frame's spawn-point
# set against the map's already-extracted `spawns` (frames 4-14 match 100%).
# jungle/jungle2 and mines/mines2 are the same layout with different art, and
# their frames are duplicates of each other.
FRAME = {
    "jungle": 4, "jungle2": 5, "city": 6, "desert": 7, "ocean": 8,
    "mines": 9, "mines2": 10, "space": 11, "snow": 12, "tut": 13, "tutq": 14,
}

# NodeAiAction symbol bounds (DefineSprite_585, 69x69 px at scale 1).
BOX = 69.0


def build(frame):
    """(waypoints, dropped) for an Arena frame."""
    raw = nodes.arena_frame(frame)
    wps, dropped = {}, []
    for name, x, y, _sx, _sy in raw.get("waypoint", []):
        if not name or "_" not in name:
            dropped.append(("waypoint", name))
            continue
        wid, con = name.split("_", 1)
        wps[wid] = {"name": wid, "x": round(x, 1), "y": round(y, 1),
                    "connects": list(con), "actions": []}
    # Drop links to nodes that do not exist, or the AI would path into nothing.
    for w in wps.values():
        w["connects"] = [c for c in w["connects"] if c in wps and c != w["name"]]

    for name, x, y, sx, sy in raw.get("aiaction", []):
        if not name or "_" not in name:
            dropped.append(("aiaction", name))
            continue
        con, action = name.rsplit("_", 1)
        if action not in ("j", "d"):
            dropped.append(("aiaction", name))
            continue
        box = {"action": action, "x": round(x, 1), "y": round(y, 1),
               "w": round(BOX * sx, 1), "h": round(BOX * sy, 1)}
        for c in con:
            if c in wps:
                wps[c]["actions"].append(dict(box))
            else:
                dropped.append(("aiaction-target", f"{name}->{c}"))
    # Stable order so the JSON diff is readable.
    return [wps[k] for k in sorted(wps)], dropped


def main():
    dry = "--dry-run" in sys.argv
    data = json.load(open(MAPS, encoding="utf-8"))
    total_wp = total_box = 0
    for mid in sorted(FRAME):
        if mid not in data:
            print(f"  {mid:9} NOT in raze2maps.json — skipped")
            continue
        wps, dropped = build(FRAME[mid])
        boxes = sum(len(w["actions"]) for w in wps)
        links = sum(len(w["connects"]) for w in wps)
        old = len(data[mid].get("waypoints") or [])
        data[mid]["waypoints"] = wps
        total_wp += len(wps)
        total_box += boxes
        note = f"  (was {old})" if old else ""
        print(f"  {mid:9} frame {FRAME[mid]:2}  {len(wps):3} waypoints, "
              f"{links:3} links, {boxes:3} jump boxes{note}")
        for kind, what in dropped:
            print(f"      dropped {kind}: {what!r}")
    print(f"\ntotal: {total_wp} waypoints, {total_box} jump boxes")
    if dry:
        print("--dry-run: raze2maps.json not written")
        return
    with open(MAPS, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    print("wrote", os.path.normpath(MAPS))


if __name__ == "__main__":
    main()
