#!/usr/bin/env python3
"""Attach each spawn point's TEAM to raze2maps.json.

`NodeSpawn.as:24-33` parses the marker's instance name: `name.split("_")`, and
if there is a suffix it is the team (`k_2` is team 2), otherwise team 0.
`Arena.as:846-881` then sorts the markers into three lists — `spawns` (team 0),
`spawnsT1` and `spawnsT2` — and `Unit.getSpawnNode()` picks from `spawnsT<team>`
in Capture the Flag and from the **neutral** `spawns` list in every other mode.

The port dropped the suffix when the spawn sets were first extracted, so every
map ends up with one flat pool: CTF teams can spawn in the enemy base, and every
other mode draws from nodes the original never uses for free-for-all.

Rather than re-extract the spawn sets (they are already grounded, de-duplicated
and hand-checked), this matches each existing `[x, y]` against the nearest
`NodeSpawn` placement on that map's Arena frame and appends the team, writing
`[x, y, team]` only where the team is non-zero.

    python tools/maps/spawn_teams.py            # report only
    python tools/maps/spawn_teams.py --write
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_place as B  # noqa: E402
import arena_props as A  # noqa: E402

MAPS_JSON = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "..", "src", "assets", "raze2maps.json"))

# How far a stored spawn may sit from its marker and still be the same node.
# The stored sets were grounded onto the collision mesh after extraction, so a
# few px of drift is expected; anything past this is a different node.
TOL = 12.0


def markers(buf):
    """map -> [(x, y, team)] for every NodeSpawn on that map's frame.

    This has to read the simulated display list, not the raw placements: half
    the maps inherit their markers from the previous frame and only *move* them
    (tutq places 11 objects and moves 72), so a placement walk sees almost
    nothing on jungle2/mines2/tutq and undercounts the rest. With the list
    simulated, the per-map totals match the port's existing spawn arrays exactly
    on all 11 maps, which is the cross-check that this is reading it right.
    """
    cls = A.symbol_classes(buf)
    timeline = A.arena_timeline(buf)
    out = {}
    for frame, mp in A.FRAME_MAP.items():
        for _depth, (cid, name, m, _cx) in timeline.get(frame, {}).items():
            if cls.get(cid) != "NodeSpawn" or m is None:
                continue
            parts = (name or "").split("_")
            team = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
            out.setdefault(mp, []).append((m[0], m[1], team))
    return out


def main():
    write = "--write" in sys.argv
    buf = B.body(B.SWF)
    marks = markers(buf)
    data = json.load(open(MAPS_JSON, encoding="utf-8"))

    print(f"{'map':9} {'spawns':>6} {'t0':>4} {'t1':>4} {'t2':>4} {'unmatched':>10}")
    total_t = 0
    for mid, entry in data.items():
        spawns = entry.get("spawns")
        if not spawns:
            continue
        ms = marks.get(mid, [])
        # Greedy 1:1 assignment, closest pair first. A plain nearest-marker
        # lookup is not a bijection: the stored spawns were snapped down onto
        # the floor, so a node can drift past a neighbour and two of them end up
        # claiming the same marker. On tut that mislabelled three team-2 nodes
        # as neutral while leaving the totals looking plausible.
        pairs = []
        for si, s in enumerate(spawns):
            for mi, (mx, my, _t) in enumerate(ms):
                d = ((mx - s[0]) ** 2 + (my - s[1]) ** 2) ** 0.5
                if d <= TOL:
                    pairs.append((d, si, mi))
        pairs.sort()
        taken_s, taken_m, assign = set(), set(), {}
        for d, si, mi in pairs:
            if si in taken_s or mi in taken_m:
                continue
            taken_s.add(si)
            taken_m.add(mi)
            assign[si] = ms[mi][2]

        counts = {0: 0, 1: 0, 2: 0}
        unmatched = 0
        out = []
        for si, s in enumerate(spawns):
            x, y = s[0], s[1]
            best = assign.get(si)
            if best is None:
                unmatched += 1
                best = 0
            counts[best] = counts.get(best, 0) + 1
            out.append([x, y, best] if best else [x, y])
        total_t += counts.get(1, 0) + counts.get(2, 0)
        print(f"{mid:9} {len(spawns):6} {counts.get(0,0):4} {counts.get(1,0):4} "
              f"{counts.get(2,0):4} {unmatched:10}")
        entry["spawns"] = out

    print(f"\n{total_t} spawn points recovered a team")
    if not write:
        print("REPORT ONLY — pass --write to update raze2maps.json")
        return
    json.dump(data, open(MAPS_JSON, "w", encoding="utf-8"), indent=1)
    print("wrote", MAPS_JSON)


if __name__ == "__main__":
    main()
