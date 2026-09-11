#!/usr/bin/env python3
"""Where the SWF actually places `bgSky` / `bg1` / `bg2` on the Game timeline.

The parallax formula in `Arena.as` moves `bg1.x` / `bg2.x` — i.e. each clip's
REGISTRATION POINT, not the left edge of its art. `bgSky` is never moved at all,
so whatever the author placed it at is where it stays. Neither number is
recoverable from the exported frame SVGs, which are drawn in symbol-local space.

This walks the raw tag stream, finds every PlaceObject2/3 that names one of the
three instances, and prints the placement matrix (translate + 16.16 scale) plus
the enclosing DefineSprite, so the port can reproduce the rest position exactly.

    python tools/maps/bg_place.py
"""
import struct, sys, zlib

SWF = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\raze-2.swf"
WANT = {"bgSky", "bg1", "bg2", "arena", "wall"}


def body(path):
    raw = open(path, "rb").read()
    if raw[:3] == b"FWS":
        return raw[8:]
    if raw[:3] == b"CWS":
        return zlib.decompress(raw[8:])
    raise SystemExit(f"unhandled signature {raw[:3]!r}")


def skip_rect(buf, pos):
    return pos + ((5 + (buf[pos] >> 3) * 4 + 7) // 8)


def tags(buf, pos, end):
    while pos < end:
        (cl,) = struct.unpack_from("<H", buf, pos)
        pos += 2
        code, ln = cl >> 6, cl & 0x3F
        if ln == 0x3F:
            (ln,) = struct.unpack_from("<I", buf, pos)
            pos += 4
        yield code, pos, ln
        pos += ln


class Bits:
    def __init__(self, buf, pos):
        self.b, self.p, self.n = buf, pos, 0

    def read(self, count, signed=False):
        v = 0
        for _ in range(count):
            v = (v << 1) | ((self.b[self.p] >> (7 - self.n)) & 1)
            self.n += 1
            if self.n == 8:
                self.n, self.p = 0, self.p + 1
        if signed and count and v >= 1 << (count - 1):
            v -= 1 << count
        return v

    def align(self):
        if self.n:
            self.n, self.p = 0, self.p + 1
        return self.p


def matrix6(buf, pos):
    """MATRIX -> (tx, ty, a, d, b, c) — the whole thing. Scale is 16.16 fixed.

    SWF names the four non-translate fields ScaleX/ScaleY and RotateSkew0/1, and
    they are the `a`/`d` and `b`/`c` of the usual 2x3:

        x' = a*x + c*y + tx
        y' = b*x + d*y + ty

    Rotation is NOT optional decoration here: every one of the tutorial's eight
    conveyor treads is authored at a 22 degree tilt, and the mine's belts carry a
    rotation combined with a flip. tx/ty/a/d lead so callers that only wanted
    {@link matrix}'s four values keep indexing the same fields.
    """
    r = Bits(buf, pos)
    a = d = 1.0
    b = c = 0.0
    if r.read(1):
        nb = r.read(5)
        a = r.read(nb, True) / 65536.0
        d = r.read(nb, True) / 65536.0
    if r.read(1):
        nb = r.read(5)
        b = r.read(nb, True) / 65536.0
        c = r.read(nb, True) / 65536.0
    nb = r.read(5)
    tx = r.read(nb, True) / 20.0
    ty = r.read(nb, True) / 20.0
    return (tx, ty, a, d, b, c), r.align()


def matrix(buf, pos):
    """MATRIX -> (tx, ty) in px and (sx, sy), dropping rotation/skew."""
    m, p = matrix6(buf, pos)
    return m[:4], p


def cxform_read(buf, pos):
    """CXFORMWITHALPHA -> (mult, add, next). mult is 0..1 per RGBA, add is -255..255.

    Not decoration on this timeline: every coloured light is ONE red symbol
    placed with `mult=(0,0,0,1)` and `add=(r,g,b,0)`, i.e. throw the art's colour
    away and substitute a flat authored one. Drop the cxform and all of them come
    out red. The tutorial's nav arrow is likewise authored at alpha 0 and raised
    by the script, so ignoring it leaves the arrow on screen for the whole level.
    """
    r = Bits(buf, pos)
    has_add, has_mult = r.read(1), r.read(1)
    nb = r.read(4)
    mult = [r.read(nb, True) / 256.0 for _ in range(4)] if has_mult else [1.0] * 4
    add = [r.read(nb, True) for _ in range(4)] if has_add else [0] * 4
    return mult, add, r.align()


def cxform(buf, pos):
    """CXFORMWITHALPHA — position only, for callers that do not want the values."""
    return cxform_read(buf, pos)[2]


def cstr(buf, pos):
    e = buf.index(b"\0", pos)
    return buf[pos:e].decode("utf-8", "replace"), e + 1


def scan_place(buf, p, ln, code, owner, out):
    flags = buf[p]
    p += 1
    flags2 = 0
    if code == 70:  # PlaceObject3 carries a second flags byte
        flags2 = buf[p]
        p += 1
    p += 2  # depth
    if flags2 & 0x08:  # HasClassName
        _cn, p = cstr(buf, p)
    cid = None
    if flags & 0x02:  # HasCharacter
        cid = struct.unpack_from("<H", buf, p)[0]
        p += 2
    m = None
    if flags & 0x04:  # HasMatrix
        m, p = matrix(buf, p)
    if flags & 0x08:  # HasColorTransform
        p = cxform(buf, p)
    if flags & 0x10:  # HasRatio
        p += 2
    if flags & 0x20:  # HasName
        name, p = cstr(buf, p)
        if not WANT or name in WANT:
            out.append((owner, name, m, cid))


def main():
    buf = body(SWF)
    out = []
    # top level
    for code, p, ln in tags(buf, skip_rect(buf, 0) + 4, len(buf)):
        if code in (26, 70):
            scan_place(buf, p, ln, code, "main", out)
        elif code == 39:  # DefineSprite
            cid = struct.unpack_from("<H", buf, p)[0]
            for c2, p2, l2 in tags(buf, p + 4, p + ln):
                if c2 in (26, 70):
                    scan_place(buf, p2, l2, c2, f"sprite {cid}", out)
    if not out:
        print("no named placements found")
        return
    print(f"{'owner':14} {'name':8} {'cid':>6} {'tx':>10} {'ty':>10} {'sx':>8} {'sy':>8}")
    for owner, name, m, cid in out:
        if m is None:
            print(f"{owner:14} {name:8} {cid or '-':>6} {'(no matrix)':>10}")
        else:
            print(f"{owner:14} {name:8} {cid or '-':>6} {m[0]:10.2f} {m[1]:10.2f} {m[2]:8.4f} {m[3]:8.4f}")


if __name__ == "__main__":
    main()
