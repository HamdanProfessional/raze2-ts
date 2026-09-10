#!/usr/bin/env python3
"""Read the level nodes off an Arena frame straight out of the SWF tag stream.

`raze2maps.json`'s spawn / pickup / flag coordinates live in PlaceObject tags on
`DefineSprite_1341_Arena`, one frame per map — FFDec's SVG export rasterises the
art but throws the placements away, so they have to come from the binary.

Nodes are marker MovieClips (invisible at runtime) whose instance *name* carries
their parameters, e.g. a pickup `p_shealth_9999` is health/9999-frame respawn and
a waypoint `i_hok` links node `i` to `h`, `o`, `k`. The Arena places `wallMC` at
the identity, so Arena-local coordinates are already world/mask coordinates.

    python tools/tut-map/nodes.py 13        # tut
    python tools/tut-map/nodes.py 14        # tutq (cross-check vs shipped JSON)
"""
import os, sys, json, zlib, struct, zipfile

SC = os.path.dirname(os.path.abspath(__file__))
ZIP = os.path.normpath(os.path.join(SC, "..", "..", "..", "raze 2.zip"))

ARENA = 1341
# Marker cids, from the `symbolClass` export.
KINDS = {568: "waypoint", 571: "spawn", 579: "pickup", 585: "aiaction",
         588: "ctf", 627: "hold", 581: "physbox"}


class Bits:
    """MSB-first bit reader over a bytes buffer, as the SWF spec defines them."""

    def __init__(self, buf, pos=0):
        self.buf, self.pos, self.bit = buf, pos, 0

    def align(self):
        if self.bit:
            self.pos += 1
            self.bit = 0

    def ub(self, n):
        v = 0
        for _ in range(n):
            v = (v << 1) | ((self.buf[self.pos] >> (7 - self.bit)) & 1)
            self.bit += 1
            if self.bit == 8:
                self.pos += 1
                self.bit = 0
        return v

    def sb(self, n):
        v = self.ub(n)
        return v - (1 << n) if n and (v >> (n - 1)) else v

    def matrix(self):
        """Returns (translateX, translateY) in twips; scale/rotate are skipped."""
        if self.ub(1):
            n = self.ub(5)
            self.sb(n), self.sb(n)
        if self.ub(1):
            n = self.ub(5)
            self.sb(n), self.sb(n)
        n = self.ub(5)
        x, y = self.sb(n), self.sb(n)
        self.align()
        return x, y

    def cxform(self):
        add, mult = self.ub(1), self.ub(1)
        n = self.ub(4)
        for _ in range(4 * mult + 4 * add):
            self.sb(n)
        self.align()

    def u16(self):
        self.align()
        v = struct.unpack_from("<H", self.buf, self.pos)[0]
        self.pos += 2
        return v

    def string(self):
        self.align()
        end = self.buf.index(b"\0", self.pos)
        s = self.buf[self.pos:end].decode("utf-8", "replace")
        self.pos = end + 1
        return s


def tags(buf, pos=0, end=None):
    """Walk a tag stream, yielding (code, payload)."""
    end = len(buf) if end is None else end
    while pos + 2 <= end:
        h = struct.unpack_from("<H", buf, pos)[0]
        pos += 2
        code, ln = h >> 6, h & 0x3F
        if ln == 0x3F:
            ln = struct.unpack_from("<I", buf, pos)[0]
            pos += 4
        if code == 0:
            return
        yield code, buf[pos:pos + ln]
        pos += ln


def place(payload, po3):
    """Parse PlaceObject2/3 into (depth, characterId|None, name|None, xy|None)."""
    b = Bits(payload)
    f = b.ub(8)
    f2 = b.ub(8) if po3 else 0
    depth = b.u16()
    if po3 and (f2 & 0x08 or (f2 & 0x10 and f & 0x02)):
        b.string()  # class name
    cid = b.u16() if f & 0x02 else None
    xy = b.matrix() if f & 0x04 else None
    if f & 0x08:
        b.cxform()
    if f & 0x10:
        b.u16()  # ratio
    name = b.string() if f & 0x20 else None
    return depth, cid, name, xy


def read_swf():
    raw = zipfile.ZipFile(ZIP).read("raze 2/raze-2.swf")
    sig = raw[:3]
    body = zlib.decompress(raw[8:]) if sig == b"CWS" else raw[8:]
    b = Bits(body)
    n = b.ub(5)
    b.ub(4 * n)  # frame rect
    b.align()
    return body[b.pos + 4:]  # skip frameRate + frameCount


def arena_frame(frame):
    """Every node on the Arena's display list once `frame` has been reached.

    A frame's nodes are not all placed on that frame — the timeline carries
    depths forward and only rewrites what changed — so the display list has to
    be simulated tag by tag rather than filtered by frame.
    """
    for code, payload in tags(read_swf()):
        if code != 39 or struct.unpack_from("<H", payload, 0)[0] != ARENA:
            continue
        stage, cur = {}, 1
        for c, p in tags(payload, 4):
            if c == 1:
                if cur == frame:
                    break
                cur += 1
            elif c in (26, 70):
                depth, cid, name, xy = place(p, c == 70)
                slot = stage.setdefault(depth, [None, None, None])
                if cid is not None:
                    slot[:] = [cid, None, None]
                if name is not None:
                    slot[1] = name
                if xy is not None:
                    slot[2] = (xy[0] / 20, xy[1] / 20)
            elif c == 5:
                stage.pop(struct.unpack_from("<H", p, 2)[0], None)
            elif c == 28:
                stage.pop(struct.unpack_from("<H", p, 0)[0], None)

        out = {}
        for _, (cid, name, xy) in sorted(stage.items()):
            if cid in KINDS and xy:
                out.setdefault(KINDS[cid], []).append((name, round(xy[0], 1), round(xy[1], 1)))
        return out
    return {}


if __name__ == "__main__":
    for f in [int(a) for a in sys.argv[1:]] or [13]:
        nodes = arena_frame(f)
        print(f"--- Arena frame {f} ---")
        for kind, items in sorted(nodes.items()):
            print(f" {kind} ({len(items)}):")
            for name, x, y in items:
                print(f"   {name!r:28} {x:8.1f} {y:8.1f}")
        print(json.dumps({k: [[x, y] for _, x, y in v] for k, v in nodes.items()}))
