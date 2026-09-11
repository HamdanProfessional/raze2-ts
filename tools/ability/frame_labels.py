#!/usr/bin/env python3
"""Dump FrameLabel tags for a DefineSprite, straight from the SWF.

FFDec's SVG export drops frame labels, and `NodeCtfFlag`/`Stats_Abilities`
address this clip purely by label (gotoAndStop("flag1"), gotoAndStop(sprite)),
so the label->frame map has to come from the binary.
"""
import struct, sys, zlib

SWF = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\raze-2.swf"
WANT = int(sys.argv[1]) if len(sys.argv) > 1 else 249


def body_bytes(path):
    raw = open(path, "rb").read()
    sig, ver, _len = raw[:3], raw[3], struct.unpack("<I", raw[4:8])[0]
    if sig == b"FWS":
        return raw[8:]
    if sig == b"CWS":
        return zlib.decompress(raw[8:])
    if sig == b"ZWS":
        import lzma
        # SWF LZMA: 4-byte compressed length, 5-byte props, then the stream.
        props = raw[12:17]
        d = lzma.LZMADecompressor(format=lzma.FORMAT_RAW,
                                  filters=[{"id": lzma.FILTER_LZMA1, "preset": None,
                                            "dict_size": struct.unpack("<I", props[1:5])[0]}])
        return d.decompress(raw[17:])
    raise SystemExit(f"unknown signature {sig!r}")


def skip_rect(buf, pos):
    nbits = buf[pos] >> 3
    total = 5 + nbits * 4
    return pos + (total + 7) // 8


def tags(buf, pos, end):
    while pos < end:
        (cl,) = struct.unpack_from("<H", buf, pos); pos += 2
        code, ln = cl >> 6, cl & 0x3F
        if ln == 0x3F:
            (ln,) = struct.unpack_from("<I", buf, pos); pos += 4
        yield code, pos, ln
        pos += ln


buf = body_bytes(SWF)
pos = skip_rect(buf, 0) + 4  # RECT + frameRate(UI16) + frameCount(UI16)
for code, p, ln in tags(buf, pos, len(buf)):
    if code != 39:  # DefineSprite
        continue
    sid, fcount = struct.unpack_from("<HH", buf, p)
    if sid != WANT:
        continue
    print(f"DefineSprite {sid}: {fcount} frames")
    frame = 1
    for c2, p2, l2 in tags(buf, p + 4, p + ln):
        if c2 == 43:  # FrameLabel
            s = buf[p2:p2 + l2].split(b"\x00")[0].decode("utf-8", "replace")
            print(f"  frame {frame:2d}  {s}")
        elif c2 == 1:  # ShowFrame
            frame += 1
        elif c2 == 0:
            break
    break
