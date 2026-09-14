#!/usr/bin/env python3
"""Dump the original front-end screen layouts (Timeline_60, symbol 1164).

The port rebuilds the Campaign / Quick Match / Armory / Achievements / Credits
screens on the baked `menu_*` plates, but every interactive control has to sit
where the FLA put it. FFDec's SVG export preserves instance names as `id="..."`,
so this walks each screen frame and writes every named instance's placement
(SWF stage coordinates, top-left origin) to src/assets/menuLayout.json.

Usage:  python tools/ui/layout.py
"""
import json, os, re

SC = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(SC, "..", ".."))
SRC = os.path.join(SPRITES := r"C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\sprites",
                   "DefineSprite_1164_Raze2_fla.Timeline_60")
OUT = os.path.join(REPO, "src", "assets", "menuLayout.json")

# frame label -> frame number (from the binary FrameLabel scan).
SCREENS = {
    "menu": 1,
    "campaign_select": 7,
    "campaign": 13,
    "quickmatch": 37,
    "armory": 44,
    "armory_weapons": 70,
    "armory_abilities": 78,
    "armory_equipment": 85,
    "armory_killbonuses": 92,
    "achievements": 99,
    "options": 107,
    "credits": 122,
}

# Not layout: internal pattern/filter/gradient defs and nested vector art.
SKIP = re.compile(r"^(font_|PatternID|filter\d|gradient\d|text\d|shape\d|sprite\d|morphshape\d|button\d)")


def elements(frame):
    svg = open(os.path.join(SRC, f"{frame}.svg"), encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"<use ([^>]*)/>", svg):
        a = m.group(1)
        idm = re.search(r'id="([^"]*)"', a)
        if not idm or SKIP.search(idm.group(1)):
            continue
        name = idm.group(1)
        t = re.search(r'transform="matrix\(([^)]*)\)"', a)
        n = [float(x) for x in re.findall(r"[-0-9.eE]+", t.group(1))] if t else [1, 0, 0, 1, 0, 0]
        out[name] = {
            "x": round(n[4], 1), "y": round(n[5], 1),
            "sx": round(n[0], 3), "sy": round(n[3], 3),
        }
    return out


def main():
    data = {"stage": [800, 600], "symbol": "DefineSprite_1164", "screens": {}}
    for name, frame in SCREENS.items():
        els = elements(frame)
        data["screens"][name] = {"frame": frame, "elements": els}
        print(f"{name:16} frame {frame:3}  {len(els)} named elements")
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
