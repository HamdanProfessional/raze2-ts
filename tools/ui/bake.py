#!/usr/bin/env python3
"""Bake the original Raze 2 UI chrome out of the decompiled SWF.

The port hand-drew its whole UI layer with Pixi Graphics even though the SWF
ships the real art as vector symbols. FFDec's per-frame SVG export preserves
FLA instance names as `id="..."`, so we can:

  1. delete the dynamic pieces of a frame (text fields, portraits, debug
     overlays, damage screen) by id / href,
  2. render the rest in headless Chromium,
  3. crop to the SWF-space rect we want (content bounds for a component, the
     800x600 stage for a whole screen),
  4. write a PNG plus a manifest entry recording where the SWF registration
     point (0,0) sits inside the crop, so the runtime can place it exactly.

Output: public/assets/ui/*.png + src/assets/uiRig.json (loaded by UiArt).

Usage:  python tools/ui/bake.py [name ...]
        (no names = bake everything)
"""
import base64, json, os, re, sys

from playwright.sync_api import sync_playwright
from PIL import Image

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SPRITES = r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites"
OUT = os.path.join(REPO, "public", "assets", "ui")
RIG = os.path.join(REPO, "src", "assets", "uiRig.json")

# Stage the art was authored on (SWF header RECT).
STAGE = [800, 600]

# Dynamic content that is never part of a baked plate. Dynamic text fields are
# named `txt_*` by the FLA convention, so they can be removed by instance id.
# Static labels ("GRAPHIC PRESETS", "Credits", ...) are UNNAMED text and stay
# baked into the art on purpose — only the runtime values are stripped.
STRIP_ID = re.compile(r"^(txt|debug|fps$|tf$|bloodscreen$|hitbox$)")


def sprite_dir(symbol):
    """Resolve a symbol to its exported SVG folder (exact or `symbol_*`)."""
    hits = [d for d in os.listdir(SPRITES) if d == symbol or d.startswith(symbol + "_")]
    if len(hits) != 1:
        raise SystemExit(f"symbol {symbol!r}: {len(hits)} matches {hits}")
    return os.path.join(SPRITES, hits[0])


def header(svg):
    """(canvasW, canvasH, ox, oy): canvas size and where SWF (0,0) sits."""
    w = float(re.search(r'width="([-0-9.]+)px"', svg).group(1))
    h = float(re.search(r'height="([-0-9.]+)px"', svg).group(1))
    m = re.search(r'<g transform="matrix\(([^)]*)\)"', svg)
    nums = [float(x) for x in re.findall(r"[-0-9.eE]+", m.group(1))] if m else [1, 0, 0, 1, 0, 0]
    return w, h, nums[4], nums[5]


def strip_uses(svg, extra_ids=(), extra_chars=(), keep_ids=(),
               strip_text=False, only_text=False):
    """Remove every dynamic `<use>` (text, portraits, debug) from a frame.

    - `keep_ids`: the inverse — remove every top-level `<use>` except these.
    - `strip_text`: also remove every vectorised text field (`#text*`).
    - `only_text`: remove everything EXCEPT the vectorised text fields.
    """
    extra = re.compile("^(" + "|".join(re.escape(e) for e in extra_ids) + ")$") if extra_ids else None
    chars = set(extra_chars)
    keep = set(keep_ids) if keep_ids else None
    text = re.compile(r"^#text")

    if keep or only_text:
        i = svg.index("<defs>") if "<defs>" in svg else len(svg)
        head, defs = svg[:i], svg[i:]

        def keepfn(match):
            tag = match.group(0)
            idm = re.search(r'id="([^"]*)"', tag)
            href = re.search(r'xlink:href="([^"]*)"', tag)
            named = idm.group(1) if idm else ""
            wanted = keep is not None and named in keep
            if only_text and href and text.search(href.group(1)) and not STRIP_ID.search(named):
                wanted = True
            return tag if wanted else ""

        return re.sub(r"<use\b[^>]*/>", keepfn, head) + defs

    def drop(match):
        tag = match.group(0)
        idm = re.search(r'id="([^"]*)"', tag)
        cid = re.search(r'ffdec:characterId="([^"]*)"', tag)
        href = re.search(r'xlink:href="([^"]*)"', tag)
        if idm and (STRIP_ID.search(idm.group(1)) or (extra and extra.search(idm.group(1)))):
            return ""
        if cid and cid.group(1) in chars:
            return ""
        if strip_text and href and text.search(href.group(1)):
            return ""
        return tag

    return re.sub(r"<use\b[^>]*/>", drop, svg)


class Asset:
    """
    One baked image.

    symbol/frame: source SVG.
    crop: "content" (tight bbox) or [x, y, w, h] in SWF coordinates.
    scale: output pixels per SWF pixel (render is 2x that; downsample LANCZOS).
    strip: extra instance ids to delete on top of the defaults.
    """

    def __init__(self, name, symbol, frame, crop="content", scale=2.0, strip=(),
                 strip_chars=(), keep=(), strip_text=False, only_text=False):
        self.name, self.symbol, self.frame = name, symbol, frame
        self.crop, self.scale, self.strip = crop, scale, tuple(strip)
        self.strip_chars = tuple(strip_chars)
        self.keep = tuple(keep)
        self.strip_text = strip_text
        self.only_text = only_text


def frame_svg(asset):
    path = os.path.join(sprite_dir(asset.symbol), f"{asset.frame}.svg")
    if not os.path.exists(path):
        raise SystemExit(f"missing {path}")
    return strip_uses(open(path, encoding="utf-8").read(), asset.strip, asset.strip_chars,
                      asset.keep, asset.strip_text, asset.only_text)


def render(pg, svg, viewport, left, top, scale):
    """Screenshot the (already stripped) SVG at `scale`, windowed to viewport."""
    w, h, _, _ = header(svg)
    b64 = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    pg.set_viewport_size({"width": max(8, viewport[0]), "height": max(8, viewport[1])})
    pg.set_content(
        '<body style="margin:0;background:transparent;overflow:hidden">'
        f'<img src="data:image/svg+xml;base64,{b64}" width="{w}" height="{h}" '
        f'style="position:absolute;left:{left}px;top:{top}px;'
        f'transform:scale({scale});transform-origin:0 0">'
        "</body>")
    pg.wait_for_selector("img")
    tmp = os.path.join(OUT, "_raw.png")
    pg.screenshot(path=tmp, omit_background=True)
    return tmp


def bake(pg, asset):
    svg = frame_svg(asset)
    cw, ch, ox, oy = header(svg)
    render_scale = min(asset.scale * 2, 4.0)

    if asset.crop == "content":
        # Small component: render the whole canvas, then trim to the ink.
        vw = min(8192, max(8, round(cw * render_scale)))
        vh = min(8192, max(8, round(ch * render_scale)))
        eff = min(vw / cw, vh / ch)
        tmp = render(pg, svg, (vw, vh), 0, 0, eff)
        im = Image.open(tmp).convert("RGBA")
        os.remove(tmp)
        bbox = im.getbbox()
        if bbox:
            im = im.crop(bbox)
        # SWF-space geometry of the cropped image: image px = (SWF + origin) * eff.
        crop_x = bbox[0] / eff - ox if bbox else -ox
        crop_y = bbox[1] / eff - oy if bbox else -oy
        w, h = im.width / eff, im.height / eff
        ax, ay = -crop_x, -crop_y
        out_w, out_h = max(1, round(w * asset.scale)), max(1, round(h * asset.scale))
        im = im.resize((out_w, out_h), Image.LANCZOS)
    else:
        # Fixed SWF-space window (screen plates): render only that window.
        x, y, w, h = asset.crop
        vw = max(8, round(w * render_scale))
        vh = max(8, round(h * render_scale))
        left = -(x + ox) * render_scale
        top = -(y + oy) * render_scale
        tmp = render(pg, svg, (vw, vh), left, top, render_scale)
        im = Image.open(tmp).convert("RGBA")
        os.remove(tmp)
        ax, ay = -x, -y
        out_w, out_h = max(1, round(w * asset.scale)), max(1, round(h * asset.scale))
        if (out_w, out_h) != im.size:
            im = im.resize((out_w, out_h), Image.LANCZOS)

    if im.getbbox() is None:
        print(f"  !! {asset.name}: rendered EMPTY — check strip rules")
    path = os.path.join(OUT, f"{asset.name}.png")
    im.save(path)
    return {
        "file": f"ui/{asset.name}.png",
        "w": round(w, 2), "h": round(h, 2),
        "ax": round(ax, 2), "ay": round(ay, 2),
        "scale": asset.scale,
        "symbol": f"{asset.symbol} frame {asset.frame}",
    }


BUTTON_STATES = [("up", 1), ("over", 2), ("on", 6)]

ASSETS = []
for state, frame in BUTTON_STATES:
    ASSETS.append(Asset(f"btn_menu_{state}", "DefineSprite_482", frame))
    ASSETS.append(Asset(f"btn_menu_rev_{state}", "DefineSprite_498", frame))
for i, frame in enumerate((1, 2, 3)):
    state = ("up", "over", "on")[i]
    ASSETS.append(Asset(f"row_weapon_{state}", "DefineSprite_1009", frame))
    ASSETS.append(Asset(f"row_ability_{state}", "DefineSprite_1026", frame))

# Whole pause-screen plates: strip every dynamic field, keep the dim + vignette
# + panel chrome for this state. The 800x600 window includes the backdrop dim.
# `pause_start` also drops char 471, an unnamed authoring-time text block that
# holds all four button labels in the FLA (the runtime replaces it).
for name, frame, chars in (("pause_start", 10, ("471",)), ("pause_scores", 11, ()),
                           ("pause_quit", 12, ()), ("pause_options", 13, ()),
                           ("pause_done", 88, ())):
    ASSETS.append(Asset(name, "DefineSprite_562", frame, crop=[0, 0, 800, 600],
                        scale=1.5, strip_chars=chars))

# Scoreboard rows, one per team state (h=header, p=player, a=AI).
SCORE_FRAMES = {
    "h0": 1, "p0": 5, "a0": 9, "h1": 16, "p1": 20, "a1": 24, "h2": 31, "p2": 35,
    "a2": 39, "h3": 46, "p3": 50, "a3": 54, "h4": 61, "p4": 65, "a4": 69,
}
for label, frame in SCORE_FRAMES.items():
    ASSETS.append(Asset(f"score_{label}", "DefineSprite_462", frame,
                        strip=("mc_skull",)))

# Achievement icons (10 labelled frames).
ACH = {
    1: "ammo", 2: "equipment", 3: "bonus1", 4: "moon", 5: "humanwin",
    6: "bonus2", 7: "alienwin", 8: "cat", 9: "health", 10: "abilities",
}
for frame, label in ACH.items():
    ASSETS.append(Asset(f"ach_{label}", "DefineSprite_1082", frame))

# HUD widgets. The heartbeat plate is the monitor's static furniture: the
# glass sheen (1455, a white gradient topping out at 0.3 alpha) and the tick
# rule (1458, opaque). Keep those alphas as authored — `Hud.setHealth` tints
# the clip with `ColorTransform.color`, which zeroes the RGB multipliers and
# offsets in the health colour but leaves alphaMultiplier at 1, so the sheen
# stays a translucent wash rather than becoming a solid bar.
for state, frame in (("full", 1), ("half", 61), ("low", 121), ("empty", 181)):
    ASSETS.append(Asset(f"hud_heart_{state}", "DefineSprite_1467", frame, scale=1.5))

# Heartbeat monitor trace: sprite 1467 is four 60-frame shape-morph animations
# (full/half/low/empty at frames 1/61/121/181) that sweep the EKG spike across
# the monitor. Bake the morph alone — the static bar (1455) and tick rule
# (1458) are already in `hud_heart_*` — on the plate's exact crop, so the HUD
# can overlay the pulse frame by frame. 30 samples per band at 15fps keep the
# original 2s loop (60 frames at 30fps).
HEART_BANDS = {"full": 1, "half": 61, "low": 121, "empty": 181}
for band, start in HEART_BANDS.items():
    for i in range(30):
        ASSETS.append(Asset(f"beat_{band}_{i:02d}", "DefineSprite_1467", start + i * 2,
                            crop=[-0.42, 0.98, 130.33, 23.67], scale=2.0,
                            strip_chars=("1455", "1458")))
ASSETS.append(Asset("hud_holder", "DefineSprite_1447", 1, strip=("highlight", "weapon", "txt_num")))
ASSETS.append(Asset("hud_highlight", "DefineSprite_1439", 2))
ASSETS.append(Asset("hud_msgbox", "DefineSprite_1523", 1, strip=("body", "head", "arm")))
ASSETS.append(Asset("crosshair", "DefineSprite_1571", 1, scale=4.0))
ASSETS.append(Asset("hud_glow", "DefineSprite_1478", 1))
ASSETS.append(Asset("pl_frame", "DefineSprite_73", 1, strip=("bar_en", "backbar_hp", "bar_hurt",
                                                             "bar_hp", "txt_name", "txt_msg",
                                                             "navarrow")))
ASSETS.append(Asset("pl_arrow", "DefineSprite_73", 1, strip=("bar_en", "backbar_hp", "bar_hurt",
                                                             "bar_hp", "txt_name", "txt_msg")))

# Weapon glyphs for the HUD slot strip (sprite 1003 is label-addressed per gun).
GLYPHS = {
    1: "chaingun", 2: "rocket", 3: "icannon", 4: "sawgun", 5: "railgun", 6: "shotgun",
    7: "pshotgun", 8: "arifle", 9: "pistol", 10: "magnum", 11: "blood", 12: "bubrifle",
    13: "uzi", 14: "asniper", 15: "plasmapistol", 16: "tshotgun", 17: "sparkgun",
    18: "mauser", 19: "sniper", 20: "katana", 21: "destroyer", 22: "beamer", 23: "zapper",
    24: "pcanon", 25: "burster", 26: "blaster", 27: "laserrifle", 28: "arifle2",
    29: "sniper2", 30: "icegun", 31: "stickylauncher", 32: "railgun2", 33: "spitter",
    34: "hrocket", 35: "flamethrower", 36: "hrocket2", 37: "creditsgun",
}
for frame, label in GLYPHS.items():
    ASSETS.append(Asset(f"glyph_{label}", "DefineSprite_1003", frame))

# HUD chrome: the whole `hud` frame with every animated/dynamic element removed.
# What stays is the static framing (ammo panel, bottom bars, outlines, rules).
HUD_DYNAMIC = (
    "bloodscreen", "feedbox", "gun0", "gun1", "gun2", "gun3", "gun4", "gun5", "gun6",
    "txt_clip", "bar_en", "bar_shield", "bar_ammo0", "bar_ammo1", "bar_ammo2",
    "bar_ammo3", "ammoOutline", "heartbeat", "weapon", "txt_points", "display_num",
    "display_text", "txt_respawn", "txt_pointsearn", "txt_time", "scorebars",
    "txt_gametype", "mc_gametype", "txt_playerscore", "txt_enemyscore", "flag1",
    "flag2", "flag3", "txt_flagscore", "txt_pause", "txt_songname", "txt_songplay",
    "mc_msg", "fps", "debug1", "debug2", "debug3", "txt_num", "txt_text", "txt_health",
    "iBar", "tf", "highlight", "body", "head", "arm", "ability",
)
ASSETS.append(Asset("hud_chrome", "DefineSprite_1568", 6,
                    crop=[0, 0, 800, 600], scale=1.5, strip=HUD_DYNAMIC))

# ---------------------------------------------------------------------------
# Front-end screens (the `Timeline_60` symbol, 1164, carries all of them as
# labelled frames). The port's stage is dynamic (fills the window, 1136x639
# floor), so each screen is baked as edge-anchored REGIONS rather than one
# 800x600 plate: a stretched header strip, a left panel, a right panel and a
# stretched bottom bar. Static text that must not stretch ("CONTROLS ?" etc.)
# is baked at native scale into the right-hand header piece.
# ---------------------------------------------------------------------------
MENU_LISTS = tuple(f"but_list{i}" for i in range(15))
ASSETS += [
    # Campaign Select (frame 7): two faces pinned to the stage sides with the
    # connector chrome stretched between them.
    Asset("cs_human", "DefineSprite_1164", 7, crop=[0, 0, 420, 600], scale=1.25),
    Asset("cs_mid", "DefineSprite_1164", 7, crop=[320, 0, 160, 600], scale=1.25),
    Asset("cs_alien", "DefineSprite_1164", 7, crop=[380, 0, 420, 600], scale=1.25),
    # Human/Alien Campaign (frame 13).
    Asset("campaign_header", "DefineSprite_1164", 13, crop=[0, 0, 800, 56], scale=1.25),
    Asset("campaign_left", "DefineSprite_1164", 13, crop=[0, 56, 435, 460], scale=1.25,
          strip=("img_map", "mc_diff", "mc_type") + MENU_LISTS),
    # Quick Match (frame 37). Header is split so "CONTROLS ?" keeps its size.
    Asset("qm_header_l", "DefineSprite_1164", 37, crop=[0, 0, 640, 56], scale=1.25,
          strip=("helpinfo",)),
    Asset("qm_header_r", "DefineSprite_1164", 37, crop=[640, 0, 160, 56], scale=1.25),
    Asset("qm_left", "DefineSprite_1164", 37, crop=[0, 56, 435, 460], scale=1.25,
          strip=("img_map",)),
    # The roster column is split so it can stretch to the live stage width:
    # left piece (Add Team + box head + players stepper), a dark band clear of
    # both the chevrons and the "Difficulty:" label, right piece (Remove Team +
    # box tail).
    Asset("qm_right_l", "DefineSprite_1164", 37, crop=[435, 56, 168, 205], scale=1.25),
    Asset("qm_right_m", "DefineSprite_1164", 37, crop=[603, 56, 8, 205], scale=1.25),
    Asset("qm_right_r", "DefineSprite_1164", 37, crop=[611, 56, 189, 205], scale=1.25),
    # Armory (frame 44).
    Asset("armory_header_l", "DefineSprite_1164", 44, crop=[0, 0, 640, 56], scale=1.25,
          strip=("helpinfo",)),
    Asset("armory_header_r", "DefineSprite_1164", 44, crop=[640, 0, 160, 56], scale=1.25),
    Asset("armory_left", "DefineSprite_1164", 44, crop=[0, 56, 275, 460], scale=1.25,
          strip=("mc_preview", "mc_ability")),
    Asset("armory_mid", "DefineSprite_1164", 44, crop=[275, 56, 255, 215], scale=1.25,
          strip=("mc_ability",)),
    # Equipped-weapons column, split to stretch (flat band between the gun-name
    # column and the right-aligned slot labels).
    Asset("armory_right_l", "DefineSprite_1164", 44, crop=[530, 56, 150, 215], scale=1.25),
    Asset("armory_right_m", "DefineSprite_1164", 44, crop=[680, 56, 8, 215], scale=1.25),
    Asset("armory_right_r", "DefineSprite_1164", 44, crop=[688, 56, 112, 215], scale=1.25),
    # Credits (frame 122): the static 3-column grid is split so it can fill a
    # dynamic stage — a stretchable panel band plus the text grid at native
    # scale (centred).
    Asset("credits_panel", "DefineSprite_1164", 122, crop=[86, 52, 628, 508],
          scale=1.25, strip_text=True),
    Asset("credits_text", "DefineSprite_1164", 122, crop="content", scale=1.25,
          only_text=True),
]

# Campaign mission rows: `but_list0..14` all instance the same 4-state sprite
# (754) — 1 normal, 2 hover, 3 selected (green frame), 4 locked (padlock). The
# bar itself is a plain translucent rect (drawn in code so it can stretch to
# the live stage width); only the padlock is real detail, so bake it alone.
ASSETS.append(Asset("row_lock", "DefineSprite_754", 4, scale=4.0,
                    strip_chars=("749", "42")))

# Armory browse sub-tabs (Timeline_60 frames 70/78/85/92): the shop's panel
# chrome, one 800x600 plate per tab. The dynamic half of each screen — the
# equipped list, the available-item rows, the stat bars, the previews and every
# text field — is stripped; the screens redraw those from real data at the
# `menuLayout.json` coordinates, using the baked `row_weapon_*`/`row_ability_*`
# row skins for the lists.
BROWSE_STRIP = (
    "helpinfo", "hitbox", "mc_icon", "mc_ability",
    "mc_curpow", "mc_currng", "mc_curacc", "mc_currof", "mc_curclip",
    "mc_curweap",
    "mc_weap0", "mc_weap1", "mc_weap2", "mc_weap3", "mc_weap4",
    "mc_weap5", "mc_weap6",
    "but_list0", "but_list1", "but_list2", "but_list3", "but_list4",
    "but_list5", "but_list6", "but_list7", "but_list8", "but_list9",
    "but_list_0_0", "but_list_0_1", "but_list_0_2", "but_list_0_3",
    "but_list_0_4", "but_list_0_5",
    "but_list_1_0", "but_list_1_1", "but_list_1_2", "but_list_1_3",
    "but_list_1_4", "but_list_1_5",
    "but_list_2_0", "but_list_2_1", "but_list_2_2", "but_list_2_3",
    "but_list_2_4", "but_list_2_5",
)
for _name, _frame in (("browse_weapons", 70), ("browse_abilities", 78),
                      ("browse_equipment", 85), ("browse_killbonuses", 92)):
    ASSETS.append(Asset(_name, "DefineSprite_1164", _frame,
                        crop=[0, 0, 800, 600], scale=1.5, strip=BROWSE_STRIP))

# Match-type badge for the preview panel (DefineSprite_461 frame labels:
# Deathmatch, Elimination, Capture the Flag, Domination, Protection,
# Juggernaught, Bang yo' Mama, None).
for i in range(1, 9):
    ASSETS.append(Asset(f"type_icon_{i}", "DefineSprite_461", i, scale=4.0))

# Map previews (`img_map`, DefineSprite_739). Frame labels are the
# `Stats_Maps` ids; the dev "test" frame (13) and the unlabeled frame 14 are
# skipped. `mc_flash` (the play-through flash) is stripped so the still is
# clean.
MAP_FRAMES = {
    1: "jungle", 2: "jungle2", 3: "ocean", 4: "ocean2", 5: "mines", 6: "mines2",
    7: "space", 8: "space2", 9: "city", 10: "city2", 11: "desert", 12: "desert2",
    15: "snow", 16: "snow2", 17: "tut", 18: "tutq", 19: "tutq2",
}
for frame, label in MAP_FRAMES.items():
    ASSETS.append(Asset(f"map_{label}", "DefineSprite_739", frame,
                        crop=[0, 0, 360.44, 128], scale=2.0, strip=("mc_flash",)))


def main():
    os.makedirs(OUT, exist_ok=True)
    want = sys.argv[1:]
    todo = [a for a in ASSETS if not want or a.name in want]
    if not todo:
        raise SystemExit(f"no assets match {want}")
    rig_path = RIG if os.path.exists(RIG) else None
    rig = json.load(open(rig_path)) if rig_path else {"stage": STAGE, "assets": {}}
    rig.pop("note", None)
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": 800, "height": 600})
        for a in todo:
            info = bake(pg, a)
            rig["assets"][a.name] = info
            print(f"  {a.name:22} {info['w']:7.1f}x{info['h']:<7.1f} "
                  f"anchor ({info['ax']:7.1f},{info['ay']:<7.1f})  {info['symbol']}")
        b.close()
    rig["note"] = ("UI chrome baked from the decompiled SWF (tools/ui/bake.py). "
                   "w/h are SWF pixels; ax/ay is where the SWF registration point "
                   "(top-left of the 800x600 stage for screen plates) sits inside "
                   "the PNG, in SWF pixels; scale is output px per SWF px.")
    with open(RIG, "w") as f:
        json.dump(rig, f, indent=1, sort_keys=True)
    print("wrote", os.path.normpath(RIG))


if __name__ == "__main__":
    main()
