# 16 — UI Asset Import Audit (SWF art into the port)

The port imported characters, weapons, maps and audio from the decompiled SWF, but the
whole UI layer (menus, HUD, pause/options/scores) was **recreated from scratch** with
Pixi `Graphics` (`src/ui/raze2/*`, `src/game/Hud.ts`, `src/screens/*`). The original art
exists in the SWF as vector symbols and can be rasterised at high resolution.

This doc is the map: every visible UI element -> its SWF symbol/frame -> what we strip
(dynamic text, portraits) -> the baked asset -> the runtime consumer. Bake tool:
`tools/ui/bake.py`; runtime manifest: `src/assets/uiRig.json`, served through
`src/assets/UiArt.ts`.

## 1. Source facts (verified)

- SWF stage: **800×600** (header RECT 0..16000 × 0..12000 twips, `raze-2.swf`).
- FFDec exports each sprite frame as SVG at 1:1 with:
  - nested symbols as `<use ffdec:characterId/characterName xlink:href="#spriteN">`,
  - **FLA instance names preserved as `id="..."`** (e.g. `id="txt_word"`, `id="heartbeat"`,
    `id="bar_hp"`), which makes per-element stripping possible,
  - text fields as `<use xlink:href="#textN">` referencing vectorised glyph defs
    (`font_*`), i.e. **no `<text>` elements**; stripping `#text*` uses removes the copy.
- SVG root `<g transform="matrix(1,0,0,1,ox,oy)">` — `(ox,oy)` is where SWF (0,0) sits in
  the canvas, so any SWF-space crop can be mapped exactly.
- The port keeps SWF pixel scale for chrome (verified: `Raze2Button` default width 240 vs
  original `MenuButton` shape span ≈ 239.6px; HUD rack pitch 58+7 = 65 = original).
  World camera zoom is 1; the wider stage simply reveals more world, so UI stays 1:1.

## 2. Dynamic content to strip at bake time

Default strip rules in `tools/ui/bake.py`:

| Pattern | What it removes |
|---|---|
| `id` starts with `txt` | every dynamic text field (`txt_word`, `txt_health`, `txt_points`, …) |
| `xlink:href` starts with `#text` or `#font_` | vectorised placeholder strings ("WORDZ", "100%", "Respawn 3") |
| `id="debug*"`, `id="fps"`, `id="tf"` | debug/fps overlays |
| `id="bloodscreen"` | full-screen red damage bitmap (runtime `Hud` opacity ramp does this) |
| `id in {body, head, arm, weapon}` | per-unit portraits / weapon glyph fills (drawn at runtime) |
| asset-specific extras | e.g. `hitbox` variants, `Timeline_*` when a backdrop is not wanted |

## 3. Inventory: buttons & panels

| Port element | SWF source | Frames / labels | Bake output | Consumer |
|---|---|---|---|---|
| Nav/menu button (large) | `DefineSprite_482_Raze2_fla.MenuButton_34` | 1 `up`, 2 `over`, 6 `on` | `ui/btn_menu_{up,over,on}.png` | `src/ui/raze2/Raze2Button.ts` |
| Mirrored nav button | `DefineSprite_498_Raze2_fla.MenuButtonReverse_37` | 1/2/6 | `ui/btn_menu_rev_{up,over,on}.png` | Campaign/Armory back rows |
| Small black button | `DefineSprite_977_Raze2_fla.BlackButton_82` | 1..3 | `ui/btn_black_{up,over,on}.png` | tooltips / small actions |
| Armory weapon row | `DefineSprite_1009_Raze2_fla.Weapon_ButtonList_BlackButton_84` | 1..3 | `ui/row_weapon_{up,over,on}.png` | armory list |
| Armory ability row | `DefineSprite_1026_Raze2_fla.Ability_ButtonList_BlackButton_85` | 1..3 | `ui/row_ability_{up,over,on}.png` | armory list |
| Pause backdrop dim + vignette | `DefineSprite_562_PauseScreen` chars 463/464 | part of every frame | included in screen bakes below | Pause/Options |
| Pause "Start Pause" screen | `DefineSprite_562_PauseScreen` frame 10 | last frame of range 2–10 | `ui/pause_start.png` (800×600) | `GameScreen` pause |
| View Scores backdrop | `DefineSprite_562_PauseScreen` frame 11 | label `View Scores` | `ui/pause_scores.png` | pause scoreboard |
| Quit confirm | `DefineSprite_562_PauseScreen` frame 12 | label `Quit Game` | `ui/pause_quit.png` | pause |
| Options screen | `DefineSprite_562_PauseScreen` frame 13 | label `Options` | `ui/pause_options.png` | options tab |
| Victory/Defeat | `DefineSprite_562_PauseScreen` frame 88+ | label `gamedone` | `ui/pause_done.png` | round end |
| Scoreboard row (each state) | `DefineSprite_462_ScoreBoardBar` | 1 `h0`, 5 `p0`, 9 `a0`, 16/20/24 h1/p1/a1 … | `ui/score_{h,p,a}{0..4}.png` | pause View Scores |
| Scoreboard status icon | child `mc_skull` (char 461) | frames None/Juggernaught/Domination/Deathmatch/CTF | `ui/skull_{0..4}.png` | scoreboard rows |

## 4. Inventory: HUD (`Hud.as`, symbol 1568, frame 6 `hud`)

Bake the HUD as **one transparent 800×600 chrome layer** with dynamic pieces stripped,
plus individual textures for everything that animates/fills at runtime.

| Element (instance id) | Source | Bake | Notes |
|---|---|---|---|
| Ammo panel + outline | shape 1448 / sprite 1454, 1450 | part of `ui/hud_chrome.png` | static |
| Deathmatch/bottom framing | shapes 1430/1432/1437/1453… | part of `ui/hud_chrome.png` | static |
| `heartbeat` | `DefineSprite_1467` labels `full`(1)/`half`(61)/`low`(121)/`empty`(181) | `ui/hud_heart_{full,half,low,empty}.png` | tint ramp at runtime; `txt_health` stripped |
| `bar_shield`, `bar_en` | sprite 44 (tinted rect) | `ui/hud_bar.png` (white, 1×N) | tint `#FFFF00` / `#CC99FF` |
| `bar_ammo0..3`, `bar_ammo` | sprite 44 | same texture | white fill |
| `gun0..6` holder | `DefineSprite_1447_Hud_WeaponHolder` | `ui/hud_holder.png` + `ui/hud_highlight.png` (sprite 1439) | glyph is dynamic |
| Weapon glyphs | `DefineSprite_1003` labels: chaingun, rocket, icannon, sawgun, railgun, shotgun, pshotgun, arifle, pistol, magnum, blood, bubrifle, uzi, asniper, plasmapistol, tshotgun, sparkgun, mauser, sniper, katana, destroyer, beamer, zapper, pcanon, burster, blaster, laserrifle, arifle2, sniper2, icegun, stickylauncher, railgun2, spitter, hrocket, flamethrower, hrocket2, creditsgun | `ui/glyph_<label>.png` (37) | replaces ArmArt icons in the HUD strip |
| `scorebars` | `DefineSprite_1495` (`bar1`/`bar2` = sprite 1494) | `ui/hud_scorebar.png` + `ui/hud_scorefill.png` | width-driven |
| `flag1..3` | `DefineSprite_1509` | `ui/hud_flag_{ctf1,ctf1gone,dom0..dom4}.png` | CTF/Domination states |
| `display_num`, `display_text` | sprites 1472/1475 (+ glow 1478) | `ui/hud_num.png`, `ui/hud_text_msg.png`, `ui/hud_glow.png` | credit popups |
| `mc_msg` | `DefineSprite_1523_HudMsg_157` | `ui/hud_msgbox.png` | portrait + `txt_name`/`txt_msg` stripped |
| Crosshair | `DefineSprite_1571_Aimer` | `ui/crosshair.png` | 4 line segments, bloom at runtime |
| Nameplate (over units) | `DefineSprite_73_Unit` frame 1 children `backbar_hp`(46), `bar_hurt`/`bar_hp`(48), `bar_en`(44), `navarrow`(55) | `ui/pl_name_bg.png`, `ui/pl_name_arrow.png`, bars reuse `ui/hud_bar.png` | text stripped |

## 5. Inventory: front-end screens (`Timeline_60`, symbol 1164)

Every front-end screen is a **labelled frame on one timeline** (`Menu` 1,
`Campaign Select` 7, `Human Campaign` 13, `Alien Campaign` 19, `Quick Match` 37,
`Armory` 44, `Achievements` 99, `Credits` 122; the earlier doc's `Menu.as`/1177 wording
was wrong — 1177 is a wrapper, 1164 carries the screens). Because the port's stage is
dynamic, each frame is baked as **edge-anchored regions**, not one 800×600 plate:

| Screen | Regions baked | Port target |
|---|---|---|
| Campaign Select | `cs_human` (left), `cs_mid` (stretched), `cs_alien` (right) | `src/screens/CampaignScreen.ts` |
| Human/Alien Campaign | `campaign_header` (stretched), `campaign_left`; list rows span panel→right margin as drawn bars (cap/alpha states from `but_list` sprite 754) + baked `row_lock`, preview uses `map_*` (`img_map`, sprite 739) + `type_icon_*` (`mc_type`, sprite 461) | `src/screens/CampaignScreen.ts` |
| Quick Match | `qm_header_l/r`, `qm_left`, `qm_right_{l,m,r}` (roster stretches to the stage edge); buttons anchored bottom corners | `src/screens/PlayScreen.ts` |
| Armory overview | `armory_header_l/r`, `armory_left`, `armory_mid`, `armory_right_{l,m,r}` (weapon list stretches) | `src/screens/ArmoryScreen.ts` |
| Achievements grid | panel + hint re-drawn; 10 rows spread across the stage; `ach_*` icons | `src/screens/AchievementsScreen.ts` |
| Credits | `credits_panel` (stretched), `credits_text` (native, centred) | `src/screens/InfoScreen.ts` |
| Menu backdrop + nav buttons | `MenuButton_34` skins; MenuScreen layout is already edge-anchored | `src/screens/MenuScreen.ts` |

## 6. Bake pipeline

`tools/ui/bake.py` (Playwright + Pillow, same pattern as `tools/ability/bake.py`):

1. read `sprites/DefineSprite_*/<frame>.svg`;
2. delete stripped `<use>` elements (rules in §2 + per-asset extras; `only_text`
   keeps just the vectorised text, `strip_text` removes it);
3. render the SVG in headless Chromium at `4×` viewport (except full-screen frames at
   `1×` to keep memory sane), screenshot with transparent background;
4. crop to the requested SWF-space rect (component: content bbox; screen: a region
   rect) and downsample to 1×/2× depending on `SCALE` per asset;
5. write `public/assets/ui/<name>.png` and a record in `src/assets/uiRig.json`:
   `{ file, w, h, ax, ay }` where `(ax, ay)` is the SWF registration point inside the PNG
   (negative when the art hangs left/top of origin, like the sky).

### Dynamic stage chrome

The port's stage fills the window (1136×639 floor), so the front-end screens are
**not** baked as one 800×600 plate. `Timeline_60` frames are decomposed into
edge-anchored regions (`tools/ui/bake.py` + `addScreenChrome()` in
`src/screens/ui.ts`):

| Region | Anchor | Asset(s) |
|---|---|---|
| Header strip | stretched across the stage (right piece native scale so "CONTROLS ?" / "WHAT IS THIS ?" don't smear) | `qm_header_l/r`, `armory_header_l/r`, `campaign_header` |
| Left column | pinned left, uniform scale | `qm_left`, `campaign_left`, `armory_left` |
| Ability/equipment column | just after the left column (5px source gutter) | `armory_mid` |
| Right column | pinned right, uniform scale — or stretched to the stage edge via `rightStretch` (`qm_right_*`, `armory_right_*`: fixed ends, flat band stretched between) | `qm_right`, `armory_right` |
| Campaign Select | two faces pinned to the sides, connector strip stretched between | `cs_human`, `cs_mid`, `cs_alien` |
| Credits | panel band stretched; text grid centred at native scale | `credits_panel`, `credits_text` |
| Achievements | panel + hint drawn in code; 2×5 rows spread across the stage | — |
| Bottom bar | buttons anchored bottom-left / bottom-right of the live stage | re-created `Raze2Button`s |

### 6.1 Two rules the heartbeat monitor broke

**Scale is per asset, never per group.** Every rig entry carries its own `scale`
(output px per SWF px), chosen for what that art needs: the heartbeat plate is a
soft gradient and bakes at 1.5, the EKG trace over it is a 1px stroke and bakes at
2.0. A sprite must be scaled by `1 / meta.scale` of **its own** entry. `Hud.ts`
scaled the trace by the plate's factor, which stretched it to 4/3 size and ran the
flat tail out past the monitor's right edge — visible in-game as a green line
escaping the console.

**A tint must not be faked by normalising alpha at bake time.** `Hud.setHealth`
recolours the monitor with `heartbeat.transform.colorTransform.color = rgb`. The
AS3 `ColorTransform.color` setter zeroes `red/green/blueMultiplier` and puts the
colour in the offsets — it does **not** touch `alphaMultiplier`. So translucent
source art stays translucent under the tint. The plate's sheen (char 1455) is a
white gradient topping out at 0.3 alpha; the bake used to multiply that alpha by
3.3 "so a plain Pixi tint reproduces the opaque transform", which turned a glass
highlight into a solid colour bar that read as a full health meter at 47% health.
Bake the alpha as authored and let the tint do only what the source's does.

Runtime side: `UiArt.loadAll()` reads `uiRig.json`, preloads every PNG, and exposes
`getTexture(name)` / `r2(name)` / `r2Sprite(name)` / `meta(name)`; the screens fall
back to the old Graphics drawing when the rig is not loaded (headless tests use the
Pixi stub, so the fallback must stay).

## 7. Implementation status

| Step | Status |
|---|---|
| Audit (this doc) | **done** |
| `tools/ui/bake.py` | **done** — strips `txt_*`/`debug`/`bloodscreen` etc., keeps unnamed static labels; outputs `public/assets/ui/*.png` + `src/assets/uiRig.json` (w/h/ax/ay/scale per asset) |
| Runtime loader | **done** — `UiArt.loadAll()` preloads the rig; `UiArt.r2/r2Sprite/meta`; `glyphIdFor()` maps port gun ids to SWF glyph labels |
| Button skins | **done** — `Raze2Button` uses `btn_menu_{up,over,on}` / `btn_menu_rev_*` with the Graphics fallback kept for the Pixi stub |
| Pause / Options / View Scores / Quit | **done** — baked `pause_*` plates on an 800×600 plate root (scaled/centred by `GameScreen.resize`); buttons, mission text and options toggles placed at the original `PauseScreen` coordinates |
| HUD weapon glyphs | **done** — rack + current-gun glyph use the `DefineSprite_1003` art (37 guns) |
| HUD heartbeat | **done, animated** — `hud_heart_{full,half,low,empty}` plate plus the real 60-frame EKG shape-morph (`beat_<band>_00..29`, the source's `gotoAndPlay(band)`) overlaid on the plate's exact crop at 15fps for the original 2s loop; colour-ramped like `Hud.setHealth()`; drawn EKG kept as fallback. Two gotchas, both of which shipped as visible bugs — see §6.1 |
| HUD chrome (ammo panel, holders, highlight, msgbox, score bars, flags, glow) | **baked, partly wired** — `hud_chrome`/`hud_holder`/`hud_highlight`/`hud_msgbox`/`hud_glow`/`crosshair`/`pl_frame`/`pl_arrow` are in the rig; holders/nameplate/crosshair/msgbox still draw their port Graphics |
| Scoreboard rows | **done** — `ScoreBoard` (pause View Scores + victory/defeat card) paints the baked `score_{h,p,a}{0..4}` row per team/kind, with the Graphics slab kept as fallback |
| Victory/defeat card | **done** — the round-end overlay now uses the baked `gamedone` plate with the standings at the original `barsCont` coordinates |
| Armory row skins / achievement icons / preview anim | **overview done** — the Armory overview uses the authentic text rows (`N "Gun"`, equipment names, ability) at the `txt_weap*/txt_equip*` coordinates; achievement icons are wired on both the Stats screen and the new `AchievementsScreen`; `row_weapon_*`/`row_ability_*`/`UnitPreview_80` remain unused because the browse views keep the port's tiles |
| Front-end menus (Campaign Select, Human/Alien Campaign, Quick Match, Armory overview, Achievements, Credits) | **done, dynamic** — rebuilt on edge-anchored region crops from `Timeline_60` (header stretches, columns fill the stage — the QM roster and Armory weapon list use `rightStretch` split bakes, Campaign rows span panel→right margin), buttons anchor to the bottom corners; controls sit at the extracted coordinates (`src/assets/menuLayout.json`) offset into their region |
| Stats / Options / Customize / Browse screens | **done, full-width** — the stats/awards columns split the stage (24px margins), the options columns sit edge to edge, and Customize/Browse already sized off `GAME_WIDTH`; no side gutters on wide windows |
| Campaign mission list | **done, source-faithful** — rows reproduce the `but_list` states (normal/hover black alpha 0.2/0.65, selected 0.4 + the `#66cc99` frame glow, baked `row_lock` padlock) at the live width so the list fills the stage; text drawn at the exported ink positions; the preview uses the authentic per-map stills (`img_map` frame labels = `Stats_Maps` ids), the `mc_type` badge and the local `Beat level N` locked copy (`Menu.as` writes the row index, not the absolute stage) |
| Armory browse sub-screens (Weapons / Abilities / Equipment / Kill Bonuses) | **done** — the plates are `browse_weapons`/`browse_abilities`/`browse_equipment`/`browse_killbonuses` (`Timeline_60` frames 70/78/85/92, 800×600, dynamic lists/stat bars/previews/text stripped). `ArmoryShopScreen` consumes them at the `menuLayout.json` coordinates with the `row_weapon_*`/`row_ability_*` row skins for the lists; the older tile browser is kept only for the port-only Skins tab. *(This row previously claimed `menu_*` plates existed — wrong names, and nothing consumed them.)* |
| In-game chrome still drawn by the port | `hud_msgbox`, `pl_frame`/`pl_arrow` (nameplate), `crosshair`, `hud_holder`/`hud_highlight` (rack tiles) — baked and available, deliberately kept because the port's in-game layout is edge-anchored and already matches the source proportions |
| Front-end menus (Campaign / Quick Match / Armory / Achievements / Credits / Menu frame) | **partial** — all buttons wear the original skin; screen layouts are still the port's from-scratch designs (docs 13 §Port status) and the `Menu` frame bake is not done |
