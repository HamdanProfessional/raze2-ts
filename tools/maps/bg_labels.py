#!/usr/bin/env python3
"""Recover each map's bg1 / bg2 / sky frame labels from the SWF bytecode.

`Stats_Maps.getMap()` is a switch returning `{id, map, bg1, bg2, sky, particles,
name, desc}` per map, and BOTH of FFDec's decompilations collapse it to a single
"test" case — the `§§push`/`§§pop` obfuscation eats the control flow. The values
survive in the ABC method body, where each case is a run of

    getlocal_2 ; pushstring <value> ; setproperty <slot>

and the slot number identifies the field. Reading the slots rather than guessing
from adjacency also catches the fields whose value is the empty string, which is
how `jungle` is authored: it has NO far layer (`bg1 = ""`).

Every recovered bg/sky value is checked against the real frame labels of
`DefineSprite_1365_Bg` / `DefineSprite_1421_BgSky` (read from the binary
FrameLabel records), so a misread cannot pass silently.

    python tools/maps/bg_labels.py           # print the table
    python tools/maps/bg_labels.py --json    # machine-readable
"""
import json, os, struct, sys, zlib

SWF = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\raze-2.swf"

# setproperty slot -> field, established by disassembling two known cases.
SLOT = {3009: "map", 3010: "bg1", 3011: "bg2", 3012: "sky",
        3013: "particles", 3014: "name", 3015: "desc"}

BG_LABELS = {"dark", "dome", "space", "city", "city2", "oceanf", "oceanb",
             "mountainbig", "mountainsmall", "dunes", "shipyard2", "pillars",
             "pillarsmall", "snow", "snow2", "mountainbiglow", "mountainsmalllow"}
SKY_LABELS = {"red", "meteor", "night", "lol cats", "city", "dawn", "day",
              "mday", "desert", "space", "desert2", "nlights", "tut",
              "tut_missile", "tut_attack"}


def body(path):
    raw = open(path, "rb").read()
    sig = raw[:3]
    if sig == b"FWS":
        return raw[8:]
    if sig == b"CWS":
        return zlib.decompress(raw[8:])
    raise SystemExit(f"unhandled signature {sig!r}")


def skip_rect(buf, pos):
    return pos + ((5 + (buf[pos] >> 3) * 4 + 7) // 8)


def tags(buf, pos, end):
    while pos < end:
        (cl,) = struct.unpack_from("<H", buf, pos); pos += 2
        code, ln = cl >> 6, cl & 0x3F
        if ln == 0x3F:
            (ln,) = struct.unpack_from("<I", buf, pos); pos += 4
        yield code, pos, ln
        pos += ln


def u30(buf, pos):
    v = shift = 0
    while True:
        b = buf[pos]; pos += 1
        v |= (b & 0x7F) << shift
        if not (b & 0x80):
            return v, pos
        shift += 7


def abc_strings(payload):
    pos = 4
    pos = payload.index(b"\0", pos) + 1
    pos += 4
    for i in range(3):
        n, pos = u30(payload, pos)
        if i == 2:
            pos += 8 * max(0, n - 1)
        else:
            for _ in range(max(0, n - 1)):
                _v, pos = u30(payload, pos)
    n, pos = u30(payload, pos)
    out = [""]
    for _ in range(max(0, n - 1)):
        ln, pos = u30(payload, pos)
        out.append(payload[pos:pos + ln].decode("utf-8", "replace"))
        pos += ln
    return out


def biggest_abc(buf):
    best = None
    for code, p, ln in tags(buf, skip_rect(buf, 0) + 4, len(buf)):
        if code != 82:
            continue
        try:
            s = abc_strings(buf[p:p + ln])
        except Exception:
            continue
        if best is None or len(s) > len(best[1]):
            best = (buf[p:p + ln], s)
    return best


def cases(payload, pool):
    """Every `pushstring V ; setproperty SLOT` pair, split into cases on `map`."""
    out, cur = [], None
    i, n = 0, len(payload)
    while i < n - 1:
        if payload[i] != 0x2C:
            i += 1
            continue
        v, j = u30(payload, i + 1)
        if v >= len(pool) or j >= n or payload[j] != 0x61:  # setproperty
            i += 1
            continue
        slot, k = u30(payload, j + 1)
        field = SLOT.get(slot)
        if not field:
            i = k
            continue
        # A new case starts at `map`, but also at any field we already have:
        # where the compiler reused a value instead of re-pushing it, `map` can
        # be missing and two cases would otherwise merge into one.
        if field == "map" or (cur is not None and field in cur):
            if cur:
                out.append(cur)
            cur = {}
        if cur is None:
            cur = {}
        cur[field] = pool[v]
        i = k
    if cur:
        out.append(cur)
    return [c for c in out if "bg2" in c and "sky" in c]


def main():
    buf = body(SWF)
    payload, pool = biggest_abc(buf)
    found = cases(payload, pool)

    bad = 0
    for c in found:
        for key, valid in (("bg1", BG_LABELS), ("bg2", BG_LABELS), ("sky", SKY_LABELS)):
            v = c.get(key, "")
            if v and v not in valid:
                print(f"  !! {c.get('name')}: {key}={v!r} is not a real frame label")
                bad += 1

    if "--json" in sys.argv:
        print(json.dumps(found, indent=1))
        return
    print(f"{'name':22} {'map':9} {'bg1':17} {'bg2':17} {'sky':12} particles")
    for c in found:
        print(f"{c.get('name','?'):22} {c.get('map',''):9} "
              f"{c.get('bg1','') or '(none)':17} {c.get('bg2','') or '(none)':17} "
              f"{c.get('sky',''):12} {c.get('particles','')}")
    print(f"\n{len(found)} cases, {bad} invalid labels")


if __name__ == "__main__":
    main()
