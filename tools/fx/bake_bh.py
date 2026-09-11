#!/usr/bin/env python3
"""Bake effects out of the BH atlas into sprite sheets the port can play.

`Effect.as` is 62 lines because every visual effect in Raze 2 is the same thing:
look a name up in `BH.BITS`, pick one of its pre-baked rotations at random, and
blit its frames.

    stats = BH.getBitAniStats(name + 0, sub);
    rotation = UT.irand(0, stats.rotAmt - 1);
    game.bitscreen.paint(x + game.arena.x, y + game.arena.y, true, name, sub, frame);

`BH` itself is a 58-frame clip whose frames hold one child each (`MC`) plus a
frame script setting `rotate`. `setup()` walks it once at load, drawing every
child frame at every rotation into one big BitmapData array — so what the game
blits is the child *as placed on the BH timeline*, transform, colour transform
and filters included. Read only the child and you get the wrong thing: the same
grey splat for all six `blood*` names, un-desaturated gas where smoke belongs.

What that placement carries, and how it is reproduced here:

  scale          often non-uniform (`smoke_big` is 0.71 x 2.49) — baked in, since
                 with a rotation a non-uniform scale does not commute with it
  rotation       `rotAmt` copies at 360/rotAmt apart, baked for the same reason
  colour xform   `mult=(0,0,0,1) add=(r,g,b,0)` on the five skin bloods: throw the
                 art's RGB away, substitute a flat colour. Baked as ONE white
                 mask plus a per-name tint, so five names share one atlas
  filters        blur / glow / colour matrix, replayed as the equivalent SVG
                 filter chain. `smoke_big` and `smoke_med` are gas clouds under a
                 luminance matrix — without it they come out coloured, not smoke

    python tools/fx/bake_bh.py                 # the default WANT list
    python tools/fx/bake_bh.py --name smoke_big --name shieldbreak
    python tools/fx/bake_bh.py --all           # the whole 58-frame atlas
"""
import base64
import hashlib
import json
import math
import os
import struct
import sys

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
sys.path.insert(0, os.path.join(SC, "..", "maps"))
sys.path.insert(0, SC)
import bg_place as B  # noqa: E402
import bh_dump as D  # noqa: E402
from bake_props import header, shelf_pack, sprite_dir  # noqa: E402

OUT = os.path.join(REPO, "public", "assets", "fx")
RIG = os.path.join(REPO, "src", "assets", "fxRig.json")

# The effects `Game.createEffect` asks for that the port had no art for. Every
# one of them currently falls through `Fx.createEffect`'s `default:` and renders
# as a generic ring, so a shield break, a mud splash and a flag reset all look
# identical.
WANT = [
    "smoke_big",     # Movement.as:157 jump pad, Unit.as:1292/1299 teleport
    "smoke_med",     # Movement.as:179 double jump
    "mud_splash",    # Bullet.as:363/445, Unit.as:989
    "sand_splash",   # Unit.as:1025/1053
    "leaf_splash",   # Bullet.as:458
    "shieldbreak",   # Status.as:354, shield hits zero
    "bloodShield",   # Bullet.as:209, impact on a shielded target
    "bloodRainbow",  # Bullet.as:205/311 under the "lol cats" special mode
    "flagReset1",    # Unit.as:331, CTF return — the name is "flagReset" + team
    "flagReset2",
]

SWF_GLOW, SWF_BLUR, SWF_GRADGLOW, SWF_COLORMATRIX = 2, 1, 4, 6

# How many even steps a Flash gradient is resampled to for an SVG transfer
# table. The gradients here are 6 stops over a third of the ramp; 32 steps
# reproduces them without a visible staircase.
GRADIENT_STEPS = 32


def fixed(payload, off):
    """SWF FIXED (16.16, little-endian) at a byte offset."""
    return struct.unpack_from("<i", payload, off)[0] / 65536.0


def fixed8(payload, off):
    """SWF FIXED8 (8.8, little-endian)."""
    return struct.unpack_from("<h", payload, off)[0] / 256.0


def gradient_glow(payload):
    """GRADIENTGLOWFILTER -> the SVG chain that reproduces it.

    Flash blurs the source's alpha and uses it to index a colour gradient. The
    SVG equivalent is: copy alpha into RGB so it can drive a transfer function,
    then map each channel through a table sampled from that gradient.

    `bloodRainbow` is exactly this and nothing else — it is the ordinary blood
    splat with a six-stop rainbow ramp and the KNOCKOUT bit set, so the glow
    replaces the art rather than haloing it. Skip the filter and the "lol cats"
    secret just bleeds normal red.
    """
    n = payload[0]
    p = 1
    cols = [tuple(payload[p + i * 4 : p + i * 4 + 4]) for i in range(n)]
    p += n * 4
    ratios = list(payload[p : p + n])
    p += n
    blur = fixed(payload, p)
    strength = fixed8(payload, p + 16)
    flags = payload[p + 18]
    knockout = bool(flags & 0x40)
    on_top = bool(flags & 0x10)

    def sample(t):
        """The gradient at t in 0..255, clamping outside the authored stops."""
        if t <= ratios[0]:
            return cols[0]
        for i in range(1, n):
            if t <= ratios[i]:
                span = max(1, ratios[i] - ratios[i - 1])
                f = (t - ratios[i - 1]) / span
                return tuple(cols[i - 1][c] + (cols[i][c] - cols[i - 1][c]) * f
                             for c in range(4))
        return cols[-1]

    steps = [sample(i * 255 / (GRADIENT_STEPS - 1)) for i in range(GRADIENT_STEPS)]
    chan = lambda c, scale=255.0: " ".join(f"{s[c] / scale:.4f}" for s in steps)  # noqa: E731
    body = (
        f'<feGaussianBlur in="SourceAlpha" stdDeviation="{blur / 4:.3f}" result="gg"/>'
        # Alpha -> RGB, so the transfer tables below have something to act on.
        f'<feColorMatrix in="gg" type="matrix" result="gd" values="'
        f'0 0 0 1 0  0 0 0 1 0  0 0 0 1 0  0 0 0 1 0"/>'
        f'<feComponentTransfer in="gd" result="gr">'
        f'<feFuncR type="table" tableValues="{chan(0)}"/>'
        f'<feFuncG type="table" tableValues="{chan(1)}"/>'
        f'<feFuncB type="table" tableValues="{chan(2)}"/>'
        f'<feFuncA type="table" tableValues="{chan(3, 255.0 / min(1.0, strength))}"/>'
        f'</feComponentTransfer>'
    )
    if knockout:
        return body  # glow only; the source art is discarded
    order = ("SourceGraphic", "gr") if on_top else ("gr", "SourceGraphic")
    return body + (f'<feMerge><feMergeNode in="{order[0]}"/>'
                   f'<feMergeNode in="{order[1]}"/></feMerge>')


def svg_filter(filters, cx):
    """The SWF filter list + colour transform as one SVG <filter> body.

    Flash applies a display object's filters in its OWN coordinate space and
    transforms the result; CSS `filter` then `transform` on one element has the
    same order, so the chain can be handed to the browser as-is.

    Returns (filter_body, tint) where a non-None tint means the chain threw the
    art's RGB away — the caller bakes a white mask and tints at runtime instead.
    """
    parts, tint = [], None
    for fid, payload in filters:
        if fid == SWF_BLUR:
            bx, by = fixed(payload, 0), fixed(payload, 4)
            parts.append(f'<feGaussianBlur stdDeviation="{bx / 4:.3f} {by / 4:.3f}"/>')
        elif fid == SWF_GLOW:
            r, g, b, a = payload[0], payload[1], payload[2], payload[3]
            bx = fixed(payload, 4)
            strength = fixed8(payload, 12)
            # A Flash glow is a blurred, strength-scaled, flat-coloured copy of
            # the alpha channel composited UNDER the source.
            parts.append(
                f'<feFlood flood-color="rgb({r},{g},{b})" flood-opacity="{a / 255:.3f}" '
                f'result="gc"/>'
                f'<feComposite in="gc" in2="SourceAlpha" operator="in" result="gm"/>'
                f'<feGaussianBlur in="gm" stdDeviation="{bx / 4:.3f}" result="gb"/>'
                f'<feComponentTransfer in="gb" result="gs">'
                f'<feFuncA type="linear" slope="{min(3.0, strength):.3f}"/>'
                f'</feComponentTransfer>'
                f'<feMerge><feMergeNode in="gs"/><feMergeNode in="SourceGraphic"/></feMerge>'
            )
        elif fid == SWF_COLORMATRIX:
            m = D.color_matrix(payload)
            # SWF stores offsets in 0..255; SVG wants them normalised.
            vals = []
            for row in range(4):
                vals += [f"{v:.5f}" for v in m[row * 5 : row * 5 + 4]]
                vals.append(f"{m[row * 5 + 4] / 255.0:.5f}")
            parts.append(f'<feColorMatrix type="matrix" values="{" ".join(vals)}"/>')
        elif fid == SWF_GRADGLOW:
            parts.append(gradient_glow(payload))
        else:
            print(f"  !! filter id {fid} not reproduced")
    if cx:
        mult, add = cx
        if max(mult[:3]) < 0.01 and any(add[:3]):
            # Pure substitution. Bake white, tint at runtime — one atlas then
            # serves every name that reuses this clip under a different colour.
            tint = (int(add[0]) << 16) | (int(add[1]) << 8) | int(add[2])
        elif any(add[:3]) or min(mult[:3]) < 0.99:
            vals = []
            for row in range(3):
                vals += ["0"] * row + [f"{mult[row]:.4f}"] + ["0"] * (3 - row)
                vals.append(f"{add[row] / 255.0:.4f}")
            vals += ["0", "0", "0", f"{mult[3]:.4f}", f"{add[3] / 255.0:.4f}"]
            parts.append(f'<feColorMatrix type="matrix" values="{" ".join(vals)}"/>')
    return "".join(parts), tint


def transformed_box(w, h, ox, oy, sx, sy, deg):
    """Where the placed+rotated frame lands, measured from the registration point.

    Flash's `MC.rotation = t` on a placement whose 2x2 is a pure scale yields
    [sx*cos, sx*sin, -sy*sin, sy*cos] — that is R(t) . S(sx,sy), scale first. The
    corners are mapped through it so the viewport is sized to the rotated art
    rather than to the axis-aligned original.
    """
    t = math.radians(deg)
    co, si = math.cos(t), math.sin(t)
    xs, ys = [], []
    for px, py in ((-ox, -oy), (w - ox, -oy), (-ox, h - oy), (w - ox, h - oy)):
        qx, qy = px * sx, py * sy
        xs.append(qx * co - qy * si)
        ys.append(qx * si + qy * co)
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def render(pg, path, sx, sy, deg, fbody, bake):
    """One BH frame -> (trimmed RGBA, lx, ly) with the placement fully applied.

    lx/ly come back in AUTHORED pixels regardless of `bake`, so the runtime never
    needs to know what resolution the sheet was rendered at.
    """
    svg = open(path, encoding="utf-8").read()
    w, h, ox, oy = header(svg)
    bx, by, bw, bh = transformed_box(w, h, ox, oy, sx, sy, deg)
    vw, vh = max(8, math.ceil(bw * bake) + 8), max(8, math.ceil(bh * bake) + 8)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    fdef = (
        f'<svg width="0" height="0" style="position:absolute"><filter id="fx" '
        f'x="-75%" y="-75%" width="250%" height="250%" '
        f'color-interpolation-filters="sRGB">{fbody}</filter></svg>'
        if fbody else ""
    )
    # With `transform-origin` at the registration point, that point is the one
    # spot the transform leaves alone — so it stays at the img's LAYOUT position
    # plus (ox, oy), and the layout offset alone aims it. Do not also translate
    # by (-ox, -oy) inside `transform`: the origin has already accounted for it,
    # and the extra shift gets rotated along with everything else, which walks
    # the art out of the viewport at anything but 0 degrees.
    px, py = 4 - bx * bake - ox, 4 - by * bake - oy
    pg.set_viewport_size({"width": vw, "height": vh})
    pg.set_content(
        f'<body style="margin:0;background:transparent">{fdef}'
        f'<img id="i" src="data:image/svg+xml;base64,{b64}" width="{w}" height="{h}" '
        f'style="position:absolute;left:{px}px;top:{py}px;'
        f'transform-origin:{ox}px {oy}px;'
        f'transform:scale({bake}) rotate({deg}deg) scale({sx},{sy});'
        f'{f"filter:url(#fx);" if fbody else ""}"></body>'
    )
    pg.wait_for_selector("#i")
    tmp = os.path.join(OUT, "_raw.png")
    pg.screenshot(path=tmp, omit_background=True)
    im = Image.open(tmp).convert("RGBA")
    os.remove(tmp)
    box = im.getbbox()
    if not box:
        return None, 0, 0
    return (im.crop(box),
            round((box[0] - 4) / bake + bx, 1),
            round((box[1] - 4) / bake + by, 1))


def whiten(im):
    """RGB -> white, alpha kept. For clips the placement recolours wholesale."""
    out = Image.new("RGBA", im.size, (255, 255, 255, 0))
    out.putalpha(im.getchannel("A"))
    return out


def bake_effect(pg, name, cid, rot_amt, sx, sy, fbody, tint, subs, bake):
    """Bake every frame x every rotation of one BH entry into a packed atlas."""
    d = sprite_dir(cid)
    if not d:
        print(f"  !! no sprite export for cid {cid}")
        return None
    nframes = len([f for f in os.listdir(d) if f.endswith(".svg")])
    step = 360.0 / rot_amt
    imgs, meta, seen = [], [], {}
    for r in range(rot_amt):
        for i in range(1, nframes + 1):
            im, lx, ly = render(pg, os.path.join(d, f"{i}.svg"), sx, sy, r * step,
                                fbody, bake)
            if im is None:
                imgs.append(None)
                meta.append({"x": 0, "y": 0, "w": 0, "h": 0, "lx": 0, "ly": 0})
                continue
            if tint is not None:
                im = whiten(im)
            key = (im.tobytes(), lx, ly)
            meta.append({"w": im.width, "h": im.height, "lx": lx, "ly": ly})
            if key in seen:
                imgs.append(None)
                meta[-1]["same"] = seen[key]
            else:
                seen[key] = len(meta) - 1
                imgs.append(im)

    solid = [(i, im) for i, im in enumerate(imgs) if im is not None]
    pos, pages = shelf_pack([(im.width, im.height) for _, im in solid])
    sheets = [Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0)) for w, h in pages]
    for (i, im), (page, x, y) in zip(solid, pos):
        sheets[page].paste(im, (x, y))
        meta[i]["p"], meta[i]["x"], meta[i]["y"] = page, x, y
    for m in meta:
        if "same" in m:
            src = meta[m.pop("same")]
            m["p"], m["x"], m["y"] = src["p"], src["x"], src["y"]

    files, kb = [], 0.0
    for page, sheet in enumerate(sheets):
        fn = f"{name}.png" if len(sheets) == 1 else f"{name}_{page}.png"
        sheet.save(os.path.join(OUT, fn))
        kb += os.path.getsize(os.path.join(OUT, fn)) / 1024
        files.append(fn)
    print(f"  {name:14} {nframes:2}f x{rot_amt}rot ({nframes * rot_amt - len(solid):2} dup)"
          f"  {len(sheets)} page(s)  {kb:6.0f} KB")

    rig = {"cid": cid, "files": files, "bakeScale": round(bake, 4),
           "rotAmt": rot_amt, "frames": nframes, "cells": meta}
    if tint is not None:
        rig["whitened"] = True
    if subs and not (len(subs) == 1 and subs[0][0] in (None, "idle")):
        rig["subs"] = {s or "idle": n for s, n in subs}
    return rig


def main():
    argv = sys.argv[1:]
    names = [argv[i + 1] for i, a in enumerate(argv) if a == "--name"]
    os.makedirs(OUT, exist_ok=True)

    buf = B.body(D.SWF)
    sp = D.sprites(buf)
    rot = D.rotate_table(
        r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\scripts\BH.as")

    entries = {}
    for frame, label, place in D.timeline(buf, sp[D.BH_CID]):
        if not label or not place:
            continue
        entries[label] = (frame, place)

    want = list(entries) if "--all" in argv else (names or WANT)
    missing = [n for n in want if n not in entries]
    if missing:
        raise SystemExit(f"not in the BH atlas: {', '.join(missing)}")

    rig = {"fx": {}, "note": (
        "BH atlas effects. `cells` is rotAmt*frames entries, rotation-major: cell "
        "r*frames+f is animation frame f at rotation r, and Effect.as picks r at "
        "random per spawn. Each cell is trimmed to its own content box — x/y "
        "locate it in the sheet, lx/ly place it against the effect's origin, "
        "which is the point createEffect() is called at. The placement's scale, "
        "rotation, colour transform and filters are already baked in; a "
        "`whitened` effect is a flat mask to be drawn with `tint`.")}

    # A partial re-bake keeps the effects it is not touching. Only `--all`
    # starts from scratch, since it re-renders every entry anyway.
    if os.path.exists(RIG) and "--all" not in argv:
        rig["fx"] = json.load(open(RIG, encoding="utf-8")).get("fx", {})
        for n in want:
            rig["fx"].pop(n, None)

    # One bake per distinct (clip, transform, filter chain). The five skin bloods
    # are one clip under five colour transforms, so they collapse to a single
    # white-mask atlas that each name tints differently.
    baked = {}
    print(f"baking {len(want)} effect(s)")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page()
        for name in want:
            frame, (cid, m, cx, fl) = entries[name]
            sx, sy = (m[2], m[3]) if m else (1.0, 1.0)
            fbody, tint = svg_filter(fl, cx)
            key = (cid, round(sx, 4), round(sy, 4), rot.get(frame, 0),
                   hashlib.md5(fbody.encode()).hexdigest(), tint is not None)
            if key not in baked:
                got = bake_effect(
                    pg, name, cid, max(1, rot.get(frame, 0)), sx, sy, fbody, tint,
                    D.subanims(buf, sp[cid]) if cid in sp else [], bake=1.0)
                if not got:
                    continue
                baked[key] = name
                rig["fx"][name] = got
            entry = rig["fx"].setdefault(name, {"alias": baked[key]})
            if baked[key] != name:
                entry["alias"] = baked[key]
                print(f"  {name:14} -> shares {baked[key]}'s atlas")
            if tint is not None:
                entry["tint"] = tint
            if cx and abs(cx[0][3] + cx[1][3] / 255.0 - 1.0) > 0.01:
                entry["alpha"] = round(max(0.0, min(1.0, cx[0][3] + cx[1][3] / 255.0)), 3)
        b.close()

    json.dump(rig, open(RIG, "w", encoding="utf-8"), indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f))
                for e in rig["fx"].values() for f in e.get("files", []))
    print(f"\nwrote {len(rig['fx'])} effect(s) ({total / 1e6:.2f} MB) -> {OUT}")
    print(f"wrote {RIG}")


if __name__ == "__main__":
    main()
