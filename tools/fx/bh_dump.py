#!/usr/bin/env python3
"""Enumerate the BH effect atlas: what every frame of DefineSprite_1809 holds.

`BH` is a 58-frame MovieClip whose only job is to be walked once at load. Each
frame carries a FrameLabel (the effect NAME the game asks for) and a single
placed child clip (`MC`, the animation itself). `BH.setup()` then renders that
child to BitmapData frame by frame:

    _loc2_ = rotate ? uint(rotate) : 1;      // `rotate` comes from the frame script
    _loc3_ = 360 / _loc2_;
    while (_loc4_ < _loc2_) {                // ...so rotate=3 bakes 0/120/240 deg
       MC.rotation = _loc4_ * _loc3_;
       while (_loc7_ <= MC.totalFrames) {
          MC.gotoAndStop(_loc7_);
          if (MC.currentLabel != _loc6_) { ... }   // a label starts a new SUB-animation
          BitAr.push(draw(this));
       }
       BITS[currentLabel + _loc4_] = {sub: ..., rotAmt: _loc2_};
    }

So the lookup key is `<label><rotIndex>` and the sub-key is the child's own frame
label. `Effect.as` picks the rotation at random (`UT.irand(0, rotAmt - 1)`), which
is why a blood splat never looks like the last one.

This prints the table the baker needs: frame -> label, child cid, rotate, and the
child's own sub-animations with their frame counts.

    python tools/fx/bh_dump.py
"""
import os, struct, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "maps"))
from bg_place import body, cstr, cxform_read, matrix6, skip_rect, tags  # noqa: E402

SWF = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\raze-2.swf"
BH_CID = 1809

DEFINE_SPRITE = 39
FRAME_LABEL = 43
SHOW_FRAME = 1
PLACE2, PLACE3 = 26, 70


def sprites(buf):
    """cid -> (body_start, body_end) for every DefineSprite in the file."""
    out = {}
    pos = skip_rect(buf, 0) + 4  # frame rate + frame count
    for code, p, ln in tags(buf, pos, len(buf)):
        if code == DEFINE_SPRITE:
            cid = struct.unpack_from("<H", buf, p)[0]
            out[cid] = (p + 4, p + ln)  # skip cid + frame count
    return out


# Fixed-size FILTER payloads, keyed by the leading UI8 filter id. The three
# variable-length ones (gradient glow/bevel, convolution) are sized on the fly.
FILTER_LEN = {0: 23, 1: 9, 2: 15, 3: 27, 6: 80}


def filters(buf, p):
    """Parse a PlaceObject3 FILTERLIST -> [(id, payload_bytes)], and the next pos.

    Not skippable: `gas_bblue` / `gas_bred` / `smoke_big` / `smoke_med` /
    `leaf_splash` carry no colour transform at all — their recolour is a
    ColorMatrixFilter (id 6), a 4x5 matrix applied to the clip. Read only the
    CXFORM and those five come out as the untinted base clip.
    """
    n = buf[p]
    p += 1
    out = []
    for _ in range(n):
        fid = buf[p]
        p += 1
        if fid in FILTER_LEN:
            ln = FILTER_LEN[fid]
        elif fid in (4, 7):  # gradient glow / bevel
            nc = buf[p]
            ln = 1 + nc * 5 + 19
        elif fid == 5:  # convolution
            ln = 2 + 8 + buf[p] * buf[p + 1] * 4 + 5
        else:
            raise ValueError(f"unknown filter id {fid}")
        out.append((fid, buf[p : p + ln]))
        p += ln
    return out, p


def color_matrix(payload):
    """The 4x5 matrix of a ColorMatrixFilter, row-major, as 20 floats.

    Little-endian. Read big-endian it decodes to values like -1.4e11, which look
    enough like "garbage filter, skip it" to be worth naming: the real matrix on
    `smoke_big`/`smoke_med` is the standard luminance row 0.3086/0.6094/0.0820
    repeated three times, i.e. desaturate the gas cloud to grey smoke.
    """
    return list(struct.unpack_from("<20f", payload, 0))


def place_cid(buf, p, code):
    """(cid, matrix6, cxform) for a PlaceObject2/3, or None if it installs nothing.

    The matrix and colour transform are load-bearing on this timeline, not
    decoration: `gas_small`/`gas_med` are the SAME clip at two scales, and all six
    `blood*` names are one clip under six colour transforms. Read the placement
    and you get six distinct effects out of one animation; drop it and you get the
    same grey splat six times.
    """
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == PLACE3:
        flags2 = buf[p]
        p += 1
        p += 2  # depth
        if flags2 & 0x08:  # HasClassName
            _cn, p = cstr(buf, p)
    else:
        p += 2  # depth
    if not flags & 0x02:  # HasCharacter
        return None
    cid = struct.unpack_from("<H", buf, p)[0]
    p += 2
    m = None
    if flags & 0x04:  # HasMatrix
        m, p = matrix6(buf, p)
    cx = None
    if flags & 0x08:  # HasColorTransform
        mult, add, p = cxform_read(buf, p)
        cx = (mult, add)
    if flags & 0x10:  # HasRatio
        p += 2
    if flags & 0x20:  # HasName
        _nm, p = cstr(buf, p)
    if flags & 0x40:  # HasClipDepth
        p += 2
    fl = []
    if flags2 & 0x01:  # HasFilterList
        fl, p = filters(buf, p)
    return cid, m, cx, fl


def timeline(buf, span):
    """[(frame, label, cid)] for one sprite's own tag stream.

    A FrameLabel belongs to the frame that the NEXT ShowFrame closes, so labels
    and placements are accumulated and flushed together.
    """
    start, end = span
    frame, label, place, out = 1, None, None, []
    for code, p, ln in tags(buf, start, end):
        if code == FRAME_LABEL:
            label = cstr(buf, p)[0]
        elif code in (PLACE2, PLACE3):
            pl = place_cid(buf, p, code)
            if pl is not None:
                place = pl
        elif code == SHOW_FRAME:
            out.append((frame, label, place))
            frame, label, place = frame + 1, None, None
    return out


def subanims(buf, span):
    """The child clip's own [(sub_label, frames)], in frame order.

    `setup()` opens a new sub whenever `MC.currentLabel` CHANGES — an unlabelled
    run before the first label inherits `null`, which the game then looks up as
    the empty sub. Mirrored here so the frame counts line up with BitAr.
    """
    start, end = span
    subs, cur, frames = [], None, 0
    for code, p, ln in tags(buf, start, end):
        if code == FRAME_LABEL:
            lbl = cstr(buf, p)[0]
            if lbl != cur:
                if cur is not None or frames:
                    subs.append((cur, frames))
                cur, frames = lbl, 0
        elif code == SHOW_FRAME:
            frames += 1
    if cur is not None or frames:
        subs.append((cur, frames))
    return subs


def rotate_table(path):
    """frameN() -> rotate, straight out of the decompiled frame scripts."""
    import re

    src = open(path, encoding="utf-8", errors="replace").read()
    return {
        int(m.group(1)): int(m.group(2))
        for m in re.finditer(
            r"function frame(\d+)\(\)\s*:\s*\*\s*\{\s*rotate\s*=\s*(-?\d+)", src
        )
    }


def main():
    buf = body(SWF)
    sp = sprites(buf)
    if BH_CID not in sp:
        raise SystemExit(f"DefineSprite_{BH_CID} not found")
    rot = rotate_table(
        r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\scripts\BH.as"
    )
    for frame, label, place in timeline(buf, sp[BH_CID]):
        cid, m, cx, fl = place if place else (None, None, None, [])
        r = rot.get(frame, 0)
        subs = subanims(buf, sp[cid]) if cid in sp else []
        desc = ", ".join(f"{s or '-'}x{n}" for s, n in subs) or "(leaf shape)"
        xf = ""
        if m and (abs(m[2] - 1) > 1e-3 or abs(m[3] - 1) > 1e-3):
            xf += f" scale={m[2]:.2f},{m[3]:.2f}"
        if cx:
            mult, add = cx
            xf += f" cx=m{[round(v, 2) for v in mult]}+a{add}"
        for fid, payload in fl:
            if fid == 6:
                xf += f" cmat={[round(v, 2) for v in color_matrix(payload)]}"
            else:
                xf += f" filter{fid}"
        print(f"{frame:3d}  {label or '?':<18} cid={cid}  rot={r}  {desc}{xf}")


if __name__ == "__main__":
    main()
