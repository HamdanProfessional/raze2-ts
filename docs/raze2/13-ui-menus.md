# 13 — UI Menus (Raze 2 SWF reference)

Documents the visual design and exact layout of six Raze 2 menu screens, sourced from the decompiled
ActionScript in `decompiled_swf/raze 2/scripts/` and from an FFDec `-swf2xml` export of
`decompiled_swf/raze 2/raze-2.swf`. Coordinates below are converted from SWF twips (1 px = 20 twips)
found in `PlaceObject2`/`PlaceObject3` `matrix` tags. Pause/Options/Scores/HUD screens are out of scope.

All six screens are frames on **one single timeline**: the `Menu` symbol (linked to `Menu.as`,
`public class Menu extends Sprite`, instance referred to in code as `menfr`). Frame switches happen via
`menfr.gotoAndStop("<Frame Label>")` / `Transition.slideLeft/slideRight(menfr, "<label>")`
(`Menu.as:106,764,780-861`). There is **no** separate SWF symbol per screen — "Menu", "Quick Match",
"Armory", "Achievements" and "Credits" are all `FrameLabelTag`s inside the same `DefineSprite`.

Frame-label → XML line ranges found in the swf2xml export (`raze2.xml`, ~137 MB, not checked into the
repo — regenerate with `ffdec.bat -swf2xml raze-2.swf out.xml` if you need to re-derive this):

| Frame label | swf2xml line (FrameLabelTag) |
|---|---|
| Menu | 352017 |
| Campaign Select | 352183 |
| Human Campaign | 352257 |
| Alien Campaign | 352369 |
| Challenges (not documented here — not one of the 6 target screens) | 352377 |
| Login | 352419 |
| Quick Match | 352445 |
| Armory | 352663 |
| Profile | 352901 |
| ... | ... |
| Achievements | 353995 |
| Options | 354107 |
| Changelog | 354343 |
| Credits | 354385 |
| Checking Purchase | 354477 |
| Purchase Confirmation | 354500 |

## Fonts used across all six screens

Verified by cross-referencing `DefineEditTextTag`/`DefineText2Tag` `fontId` attributes in the swf2xml
export against `DefineFont3Tag`/`DefineFontNameTag` `fontName` attributes, and matching those IDs to
filenames in `decompiled_swf/raze 2/fonts/`:

| Font ID | Font file | Font name (from SWF) | Weight | Used for |
|---|---|---|---|---|
| 485 | `485_BlairMdITC TT.ttf` | BlairMdITC TT | Regular (`fontFlagsBold="false"`) | Screen headers (`txt_title`, "Game saves to:") — 26pt (`fontHeight="520"` twips) / 22pt for the login helper text |
| 465 | `465_BlairMdITC TT.ttf` | BlairMdITC TT | **Bold** (`fontFlagsBold="true"`) | Nav / generic button labels (`txt_word` inside every `btn_*`/`btnl_*` instance) — 20pt (`fontHeight="400"`) |
| 6 | `6_QTypeSquare-Book.ttf` | QTypeSquare-Book | Regular | Short value/label fields: map title (`txt_maptitle`), match-type value (`txt_type`), score value (`txt_score`), on/off toggle words (`txt_abilities`/`txt_equips`/`txt_weaps`), profile name (`txt_name`) — 12-15pt (`fontHeight` 240-300 twips) |
| 487 | (no local `.ttf` — system font) | **Calibri** | Regular | Longer wrapping body copy: map description (`txt_mapdesc`), match-type description (`txt_typedesc`), warning text (`txt_warning`), ability description (`txt_ability` on Armory) — 12pt, `multiline="true" wordWrap="true"` |

No font could be positively identified for the achievement-row `txt_name`/`txt_desc`/`txt_rew` fields or
the Credits-screen name/role text — those `DefineEditTextTag`/`DefineText2Tag` records were not
individually resolved in this pass; treat as **QTypeSquare-Book family, unverified size**, consistent
with the rest of the UI, rather than a confirmed fact.

## Color palette (global, verified from source)

| Role | Hex | Source |
|---|---|---|
| Header text (`txt_title`) | `#FFFFFF` @ alpha 177/255 (~69%) | swf2xml `characterID="680"` `textColor` |
| Nav/button label (`txt_word`) | `#FFFFFF` @ alpha 204/255 (~80%) | swf2xml `characterID="477"` `textColor` |
| "Game saves to:" text | `#FFFFFF` @ alpha 204/255 (~80%), font 485 22pt | swf2xml `characterID="644"`/`645` |
| Body/description text (Calibri fields) | `#FFFFFF` @ alpha 204/255 (~80%) | swf2xml `characterID="771"`,`848`,`853` |
| Value/label text (QType fields) | `#FFFFFF` @ alpha 177/255 (~69%) | swf2xml `characterID="772"`,`831`,`833`,`891` |
| Warning text (Quick Match credit-penalty notice) | `#FF9999` @ alpha 177/255 (~69%) | swf2xml `characterID="849"` |
| Campaign list — normal/unselected row | `#FFFFFF` (`16777215`) | `Menu.as:1650,1668` |
| Campaign list — selected/current row | `#FFFFCC` (`16777164`) | `Menu.as:216 (initial), 1678` |
| Campaign list — locked row | `#CCCCCC` (`13421772`) | `Menu.as:216,233` |
| Purchase/status text — green ("owned/equipped") | `#CCFFCC` (`13434828`) | `Menu.as:1769,2321,2504` |
| Purchase/status text — cyan ("can afford") | `#CCFFFF` (`13434879`) | `Menu.as:1798,2315,2514` |
| Purchase/status text — pink ("selected/new") | `#FFCCCC` (`16764108`) | `Menu.as:1305,1785,1820` |
| Purchase/status text — purple ("locked/other") | `#CEA6E7` (`13543143`) | `Menu.as:2309,2524` |
| Options — disabled label | `#999999` (`10066329`) | `Menu.as:2226` |

These are **runtime** `TextField.textColor` assignments in `Menu.as`, so they are exact, not estimated.
No solid-color panel-fill or background hex values could be extracted — panel/box art on this timeline is
built from `DefineShape`/gradient fills (see below), not flat `TextField`/`Graphics` colors, and the
gradient definitions found (e.g. near swf2xml line 351900) use black-alpha ramps (`RGBA 0,0,0` at 60-80%
alpha) for panel shading rather than a single flat hex — call this **"black gradient overlay, alpha
~0.3-0.8, exact stops not fully catalogued"** rather than inventing a flat color.

## Shared background / chrome

No single shared "cityscape backdrop" bitmap symbol could be confirmed by name in this pass — the six
frames share the *same* `DefineSprite` (`menfr`) but the visible backdrop children were not individually
identified by symbol/class name (would require walking `images/`/`shapes/` exports keyed to the specific
character IDs placed at low depths on each frame, not done here). Do not assume a specific background
asset path; treat the backdrop as **"same Menu timeline, background layer present, exact symbol id not
verified."**

Chrome confirmed on the **Menu** frame only (see table 1):
- `mc_sponsor` — Armor Games logo (character 472, `AGI.urlSponsor()` on click, `Menu.as:924`).
- `mc_twitter` (character 650) / `mc_facebook` (character 653) — social icons, `AGI.urlTwitter()` /
  `AGI.urlFacebook()` (`Menu.as:926,936`).
- `helpinfo` (character 678) — the "Controls ?" tooltip trigger; text content confirmed via FFDec text
  export (`text_export/656.txt` = "Controls"); `menfr.helpinfo.gotoAndStop(menfr.currentLabel + "_")`
  shows every frame has a matching help-tooltip sub-state (`Menu.as:166-167,579-583`).
- `mc_loginhelper` (character 647) — container for the "Game saves to: This Website" / "Game saves to:
  Online Profile" text pair (characters 644/645), switched by login state.
- `newsbox` (character 642) — announcement box, populated from `Main.GAMEVARS.NewsTitle`/`NewsDesc`
  (`Menu.as:172-187`).
- No literal `"v2.0"` string was found anywhere in the decompiled scripts or the FFDec text export; a
  version tag may be baked into art (not text) or may not exist in this build — **not verified**.
- No dedicated "Global Stats" entry/screen: `MenuGlobalStats.as` (360 lines) implements this panel, but no
  frame label or button named "Global Stats" was found in the Menu timeline's nav list (see table 1) —
  it is likely a `MenuGlobalStats` MovieClip instance placed directly on the `Menu` frame, not one of the
  eight `btn_*` nav rows. Not further verified in this pass.

---

## 1. Menu / start screen

**Symbol/class**: `Menu` (`Menu.as`), frame label `"Menu"` (swf2xml line 352017). Init logic:
`Menu.as:170-187` (`case "Menu":`).

### Nav list (left-aligned, all `btn_*` instances of the shared button symbol, character 482)

All nav buttons share `x = 3213 twips = 160.65px`; only `y` differs (converted from swf2xml matrix
`translateX`/`translateY`, lines 352018-352066):

| Button (`name=`) | x (px) | y (px) | Menu.as click target |
|---|---|---|---|
| `btn_Campaign` | 160.65 | 341.50 | `Transition.slideLeft(menfr,"Campaign Select")` (`:871`) |
| `btn_Quick_Match` | 160.65 | 367.85 | default case → `Transition.slideLeft(menfr,"Quick Match")` (`:851`) |
| `btn_Armory` | 160.65 | 399.95 | `Transition.slideLeft(menfr,"Armory")` (`case 2`, `:762-766`) |
| `btn_Achievements` | 160.65 | 432.05 | default case → `Transition.slideLeft(menfr,"Achievements")` |
| `btn_Options` | 160.65 | 457.90 | default case → `Transition.slideLeft(menfr,"Options")` |
| `btn_Credits` | 160.65 | 484.25 | default case → `Transition.slideLeft(menfr,"Credits")` (no dedicated case; plain frame) |
| `btn_Play_More_Games` | 160.65 | 515.85 | `AGI.urlSponsor()` (`case 23`, `:840-843`) |
| `btn_Play_Raze_1` | 160.65 | 542.85 | `AGI.urlRaze1()` (`case 24`, `:845-847`) |

Button label text (`txt_word`, font 465 Bold 20pt) is auto-derived from the instance name by
`init()` (`Menu.as:115-149`): the `btn_` prefix is stripped and remaining `_`-joined words become the
label, e.g. `btn_Quick_Match` → "Quick Match". "Back to X" buttons (`btn_Back_to`) substitute in
`cameFrom` at runtime (`Menu.as:137-141`).

Click routing for the Menu frame is generic: any `buttons[i]` hit test falls to the `default:` case,
which does `Transition.slideLeft(menfr, buttons[i].txt_word.text)` (`Menu.as:851-852`) — i.e. it
navigates to whichever frame label matches the button's own text. This is why "Achievements", "Options",
and "Credits" have **no dedicated case** in the click-handling switch (`Menu.as:629-853`) — they're the
generic fallthrough.

### Other chrome on this frame (positions, twips→px)

| Element | Character ID | x (px) | y (px) | Notes |
|---|---|---|---|---|
| `newsbox` | 642 | 36.75 | 142.20 | Announcement box |
| `mc_sponsor` (Armor Games) | 472 | 86.20 | 96.05 | scale 0.846 |
| `mc_twitter` | 650 | 54.90 | 70.55 | |
| `mc_facebook` | 653 | 54.90 | 98.50 | |
| `helpinfo` ("Controls ?") | 678 | 785.15 | 141.55 | top-right of the 800px-wide stage |
| `mc_loginhelper` ("Game saves to:") | 647 | 476.00 | 407.35 | contains characters 644/645 |
| `txt_title` (header, reads "Menu" via `currentLabel`) | 680 | — | — | dynamic text = `menfr.currentLabel` (`Menu.as:125`); NOT a static "RAZE 2" logo — the "RAZE 2" wordmark, if present, is separate baked art not individually identified in this pass |

**Stage width evidence**: `helpinfo` sits at x≈785px, consistent with an ~800×600 stage (matches the
project's known 800×600 canvas convention).

---

## 2. Campaign select (`Stats_Campaign.as` for mission data; UI switch lives in `Menu.as`)

**Frame labels**: `"Campaign Select"` (352183, a pass-through frame — `Menu.as:196-201` immediately calls
`menfr.nextFrame()` if `SD.campStage < 15`), `"Human Campaign"` (352257) and `"Alien Campaign"` (352369).
Mission data (name/description/bots/cutscenes per stage) is defined in `Stats_Campaign.as`
(`setMatch()`, `setStats()`, 2502 lines of per-level data — no UI layout code). Row/panel UI logic is in
`Menu.as`.

### Mission list (right side, `but_list0`..`but_list14`, 15 rows per campaign)

Built in `Menu.as:202-247` (`case "Human Campaign"` / `case "Alien Campaign"`):
- Unlocked row: `txt_num.text = "N."`, `txt_title.text = MatchSettings.matchName` (from
  `Stats_Campaign.setMatch()`).
- Locked row: `txt_title.textColor = 0xCCCCCC`, `gotoAndStop(4)` (frame 4 of the row's own button MC —
  presumably the padlock-icon visual state), `txt_num.text = ""`,
  `txt_title.text = "Beat level " + N + " to unlock"`.
- Row states (`setCampaign()`, `Menu.as:1641-1716`): frame 1 = normal, frame 2 = "just picked" transient,
  frame 3 = selected/current (`txt_title.textColor = 0xFFFFCC`), frame 4 = locked.

Exact per-row pixel coordinates for `but_list0..14` were **not extracted** in this pass (would require
locating each `PlaceObject2` for those 15 instances inside the "Human Campaign"/"Alien Campaign" frame
ranges, lines 352257-352445 and 352369-... — not done due to time; the Quick Match/Armory/Menu frames
were prioritized instead). Treat row Y-spacing as unverified.

### Left preview panel

Populated by `setCampaign()` (`Menu.as:1641-1716`):

| Field | Set from |
|---|---|
| `menfr.img_map` | `gotoAndStop(MatchSettings.map.id)` — map screenshot, flashes via `mc_flash.gotoAndPlay(2)` on selection |
| `menfr.txt_maptitle` | `MatchSettings.map.name` |
| `menfr.txt_matchtitle` | `MatchSettings.matchName` |
| `menfr.txt_desc` | `MatchSettings.matchDesc` |
| `menfr.txt_type` / `mc_type` | `MatchSettings.type` (also drives a type icon `mc_type.gotoAndStop(type)`) |
| `menfr.txt_score` | `MatchSettings.winScore` |
| `menfr.txt_scoretype` | Label text varies by type: "Kills to Win" (Deathmatch/Protection/Juggernaught), "Lives" (Elimination), "Points to Win" (Domination/CTF) — `Menu.as:1697-1716` |
| `menfr.txt_extra` | `MatchSettings.matchExtra` (e.g. "Weapon: Shotgun") |
| `menfr.mc_diff` | `gotoAndStop(MatchSettings.overallDiff)` — Difficulty dots/icon |

### Buttons

`btn_Back_to_Menu`, `btn_Back_to_Campaign_Select` (from the mission-detail sub-view back to the list),
`btn_Start_Game` (character 498, launches `Game`/`Cutscene` — `Menu.as:733-741`), `btn_Upgrades`
(navigates to `"Armory"`, `case 1`, `:761`).

---

## 3. Quick Match

**Frame label**: `"Quick Match"` (swf2xml line 352445-352663). Fully implemented as a sub-mode of
`Menu.as` — `case "Quick Match":` (`Menu.as:248-276`) plus a large block of `MouseDown` handling
(`Menu.as:1056-1211`). No separate class/file exists for it (the task brief's guess that it might live in
its own class was wrong — it's entirely inside `Menu.as`, sharing `MatchSettings.as` for the underlying
data model).

### Element positions (twips→px, from swf2xml lines 352445-352663)

| Element | x (px) | y (px) | Purpose |
|---|---|---|---|
| `img_map` | 49.90 | 75.10 | Map preview thumbnail |
| `bt_map_prev` / `bt_map_next` | 69.60 / 391.15 | 174.00 | Map cycle (mirrored button, `scaleX=-1`) |
| `txt_maptitle` | 66.40 | 207.20 | |
| `txt_mapdesc` | -4.40 | 227.45 | Calibri 12pt wrapping description |
| `mc_bots` | 467.30 | 111.80 | Team roster box (see below) |
| `mc_addteam` ("+ Add Team") | 528.30 | 81.95 | Container for `bt_addteam` |
| `bt_addteam` | 471.00 | 71.80 | Hit area, `MatchSettings.teams < teamsMax` gate (`Menu.as:1201-1206`) |
| `mc_removeteam` | 721.30 | 81.95 | Container for `bt_removeteam` |
| `bt_removeteam` | 661.00 | 71.80 | `MatchSettings.teams > teamsMin` gate (`Menu.as:1208-1211`) |
| `txt_type` / `mc_type` | 221.70 / 228.80 | 295.55 / 291.60 | Match-type value + icon |
| `bt_type_prev` / `bt_type_next` | 194.20 / 410.45 | 290.45 | Cycles `["Deathmatch","Elimination","Domination","Capture the Flag","Juggernaught"]` |
| `txt_typedesc` | 1.25 | 319.45 | Calibri description of current match type |
| `txt_weaps` | 221.70 | 379.55 | Weapons-used value |
| `bt_weaps_prev` / `bt_weaps_next` | 194.20 / 410.45 | 374.45 | Cycles `["All","Starters","Sidearms","Close Range","Automatics","Long Range","Heavies","Explosives"]` |
| `txt_scoretype` / `txt_score` | 18.40 / 221.70 | 350.55 / 351.55 | "Kills to Win" label + value |
| `bt_score_prev` / `bt_score_next` | 194.20 / 410.45 | 346.45 | |
| `txt_special` | 221.70 | 407.55 | Special-mode value |
| `bt_special_prev` / `bt_special_next` | 194.20 / 410.45 | 402.45 | Cycles `specialModes` array — base `["None","Infinite Clips"]` plus achievement-gated extras: "Infinite Ammo", "lol cats", "4x Health", "Moon Corpses" (`Menu.as:249-262`) |
| `txt_abilities` | 221.70 | 435.55 | "On"/"Off" — `MatchSettings.abilitiesOn` toggle (`Menu.as:1135-1143`) |
| `bt_abilities_prev` / `bt_abilities_next` | 194.20 / 410.45 | 430.45 | |
| `txt_equips` | 221.70 | 463.55 | Equipment on/off value |
| `bt_equips_prev` / `bt_equips_next` | 194.20 / 410.45 | 458.45 | |
| `txt_warning` | 1.25 | 487.30 | Credit-penalty warning, color `#FF9999` — "Warning: With these settings, you will earn -N% credits." (`Menu.as:2071`) |
| `btn_Back_to_Menu` | 160.65 | 543.85 | |
| `btn_Upgrades` | 640.65 | 521.85 | |
| `btn_Start_Game` | 640.65 | 548.85 | |

`mc_bots` is the team-roster box: per-team controls are addressed dynamically as
`mc_bots["bt" + i + "_bots_next/prev"]` (player count) and `mc_bots["bt" + i + "_diff_next/prev"]`
(difficulty, step of 2, clamped 2-10) — `Menu.as:1156-1196`. Each team's bot amount is capped at
`12 / MatchSettings.teams` (`Menu.as:1166`). No explicit "Free For All" / "Players" / "Difficulty" text
child instances were resolved to exact sub-coordinates inside `mc_bots` in this pass (its internal timeline
wasn't walked) — confirmed to exist as plain-text strings via FFDec text export
(`text_export/775.txt` = "Free For All") but not tied to a specific x/y offset here.

"What is this ?" tooltip text was confirmed present in the FFDec text export (`text_export/663.txt` =
"What is this") but its trigger icon/instance name and target field were not identified in this pass.

---

## 4. Armory

**Frame label**: `"Armory"` (swf2xml line 352663-352901). Logic: `Menu.as:277-317`
(`case "Armory":`) for populating fields; `Stats_Armory.as` (53 lines) is a thin data accessor only
(`getGun(type, index)` — no layout code, confirming the task brief's suspicion that Armory UI logic lives
in `Menu.as`, not in `Stats_Armory.as`).

### Element positions (twips→px, swf2xml lines 352663-352906)

| Element | x (px) | y (px) | Notes |
|---|---|---|---|
| `txt_name` (player name) | 29.90 | 113.50 | font 6 (QType Book), 15pt |
| `mc_preview` (character preview) | 102.25 | 159.40 | `gotoAndStop(2)`, plays "stand" anim |
| `bt_profile` | 59.35 | 131.60 | large hit area over the name/preview column |
| `txt_credits` | 293.40 | 59.65 | "N credits" — `UT.addNumCommas(SD.credits) + " credits"` |
| `mc_ability` / `txt_ability` | 286.50 / 368.90 | 137.05 / 153.35 | Current equipped ability icon + name |
| `bt_ability` | 282.10 | 113.50 | |
| `txt_weap0`..`txt_weap6` | 546.50 | 139.50, 157.00, 175.55, 194.10, 213.00, 248.00, 264.50 | 7 weapon-slot rows: `N " + Stats_Armory.getGun(N,SD.gunList[N]).name` |
| `bt_weapons` | 537.10 | 111.75 | |
| `txt_equip0`/`1`/`2` | 288.45 | 213.90, 231.40, 249.95 | 3 equipment-slot rows |
| `bt_equipment` | 282.10 | 188.50 | |
| `btn_Weapons`/`Equipment`/`Abilities`/`Profile` (sub-tab nav, scale 0.8) | 136.15 | 469.10, 379.55, 399.70, 428.10 | Sub-nav column, smaller scale than main nav |
| `btnl_Armory_Overview` (disabled-style "l" variant) | 136.15 | 399.55 | |
| `btn_Kill_Bonuses` | 136.15 | 510.70 | |
| `mc_purchase` / `bt_purchase1`/`2`/`3` | 862.85 / 863.60,1028.80,1193.00 | 305.00 / 402.35,401.95,402.35 | Credit-pack purchase buttons; hidden when `!AGI.isLoggedIn()` (`Menu.as:302-317`) |
| `btn_Back_to` | 160.65 | 543.85 | |

Layout reads as: left column = player name/preview/stats tabs (Weapons/Equipment/Abilities/Profile/Kill
Bonuses sub-nav at x≈136px), right side = 7-row weapon list + 3-row equipment list + ability slot,
credits readout top-right, purchase-pack buttons far right (x≈860-1190px — outside the likely 800px
stage width, suggesting this row scrolls/overflows or the stage is wider on this frame; not reconciled
in this pass).

---

## 5. Achievements (`Stats_Achievements.as` = the "achievement unlocked" toast, NOT the grid screen)

**Important correction to the task brief's assumption**: `Stats_Achievements.as` (251 lines) implements
the small **pop-up toast** shown when an achievement is earned mid-game (`mc_icon`, `txt_name`, `txt_rew`,
a 2-frame `frame1()`/`frame2()` show/hide animation, `Stats_Achievements.setAchievement()`). It is a
separate embedded symbol (`[Embed(source="/_assets/assets.swf", symbol="symbol1816")]`), not the full
Achievements **screen**.

The Achievements **screen** (grid of all achievements, frame label `"Achievements"`, swf2xml line
353995-354107) is implemented by `Menu.as:showAchievements()` (`Menu.as:2585-2601`):

```
but_list0 .. but_list9   (10 rows)
  .txt_name  = Stats_Achievements.getAchievementNum(i).name
  .txt_desc  = Stats_Achievements.getAchievementNum(i).desc
  .txt_rew   = Stats_Achievements.getAchievementNum(i).rewtxt
  .mc_icon   = gotoAndStop(sprite id)
  .gotoAndStop(2) if SD.achievements.indexOf(i) != -1   // unlocked visual state, else frame 1 (locked)
```

The 10 achievements (`Stats_Achievements.achOrder`, `Stats_Achievements.as:37`): "cat", "health", "ammo",
"moon", "humanwin", "alienwin", "abilities", "equipment", "bonus1", "bonus2" — with names like "Oh Hi
Kitty", "Love is Blind", "A New Hope", "A New Era", "Versatile", "Toolkit", "Stylish", "Kill Enthusiast"
(`Stats_Achievements.as:60-134`). Rewards are either a special game mode unlock (rewtxt = "X mode") or a
credit grant (rewtxt = "+N credits").

Per-row pixel coordinates for `but_list0..9` were **not extracted** in this pass — locked/unlocked visual
states are child-MC frame changes (`gotoAndStop(1)`/`gotoAndStop(2)`), not runtime color/text changes, so
no `textColor` hex is available for this screen's rows the way there is for the Campaign list.

Header text: `txt_title.text = "Achievements"` (generic header mechanism shared by all frames,
`Menu.as:125`), same font/color as documented globally (BlairMdITC TT 485, 26pt, `#FFFFFF`@69%).

---

## 6. Credits

**Frame label**: `"Credits"` (swf2xml line 354385-354477). This is a **plain, static frame** — it has no
entry in either of `Menu.as`'s two big `switch(menfr.currentLabel)` blocks (init at `:168-410` or click
handling at `:863-911`), meaning it needs no runtime logic beyond the generic nav-button setup that every
frame gets in `init()`. Reached via the "Credits" `btn_Credits` nav item on the Menu frame's default
click case (`Transition.slideLeft(menfr,"Credits")`).

Confirmed text content, via FFDec `-export text` on the full SWF:
- `"Credits"` (heading, `text_export/1480.txt`)
- `"Armor Games | Addison Rodomista | Justin Goncalves"` (`text_export/1513.txt`)

Body content is 21 unlabeled `DefineText`/`DefineEditText` instances (character IDs 1137-1157) arranged
in what reads as a **3-column grid** based on their `translateX` values (twips→px): column A ≈ x=110-124,
column B ≈ x=320, column C ≈ x=535-630, across 8 distinct row Y-positions (≈99, 126, 155, 182, 213, 240,
411, 439px) — consistent with paired role/name credits (e.g. "Programming — Kevin Gerhke" style rows) but
the individual string contents of characters 1137-1157 were not resolved to specific role/name pairs in
this pass; only the two strings above were positively matched to a screen location. No unique
header/body font or color was found beyond the global palette (assume BlairMdITC TT header 485,
QTypeSquare/Calibri family body, `#FFFFFF`@69-80% — unverified for this specific frame).

No "Back" button placement was captured for this frame within the extracted line range (352663-354477
region checked, none named `btn_Back*` fell inside lines 354385-354477) — likely reuses the generic
nav-row `btn_*` mechanism common to all frames but not individually confirmed.

---

## Port status

| Screen | Status | Notes |
|---|---|---|
| Menu / start screen | mostly-correct | **Row rewritten 2026-09-11 — it previously described a since-replaced screen.** `src/screens/MenuScreen.ts:36-47,181-188` now renders the original's single left-aligned 8-item vertical nav (Campaign, Quick Match, Armory, Achievements, Options, Credits, Play More Games, Play Raze 1) over the cityscape backdrop, with the Armor Games sponsor line + Twitter/Facebook handles top-left (`:125-126`), the "Controls ?" helper top-right (`:139`), the "Game saves to:" line, version tag and "Global Stats" corner entry. Verified live. Remaining differences: no news box, and the online-lobby entry (`:268-276`) is an addition the SWF has no equivalent for. |
| Campaign select | wrong-incomplete | `src/screens/CampaignScreen.ts:29-411` implements a 15-column × 2-row tile grid (`COLS=15`, `TILE=36px`) with lock/current/completed states and a single shared info panel — a reasonable *functional* analog but visually unrelated to the original's per-row list ("Beat level N to unlock" text + padlock icon) with a left-side screenshot preview panel (`img_map`/`txt_maptitle`/`txt_desc`/Match Type/Kills to Win/Map/Extra/Difficulty dots, `Menu.as:1641-1716`). No mission screenshot thumbnails, no "Upgrades"/"Start Game" button pair styled like the original, no `#CCFFCC`-family status color coding. |
| Quick Match | wrong-incomplete | `src/screens/MultiplayerScreen.ts` + `src/screens/LobbyScreen.ts` implement an **online** room browser/lobby (name entry, public party list, join-by-code) — this is a different feature built for the port's netcode, not a port of the original's local bot-team "+ Add Team" / Free-For-All roster + map/type/score/special-mode/abilities/equipment prev-next rows (`Menu.as:1056-1211`, all documented above with exact coordinates). None of `bt_addteam`/`bt_removeteam`/`mc_bots` team-difficulty stepper/`bt_map_prev`/`bt_type_prev` etc. have a port equivalent — the original's local Quick Match setup screen appears to have no direct port counterpart at all. |
| Armory | wrong-incomplete | `src/screens/ArmoryScreen.ts:44-83` uses a WEAPONS/SKINS/EQUIPMENT/ABILITIES tab toggle + item grid — functionally broader than the original (which has no in-menu Skins tab visible in `Menu.as`'s Armory case) but visually unrelated: no player-preview-on-left layout, no 7-slot weapon list + 3-slot equipment list column matching `txt_weap0..6`/`txt_equip0..2` positions, no credit-pack purchase button row. Header font/color again `Impact`/`#FF5533` vs. the source's BlairMdITC TT/white-alpha. |
| Achievements | missing | No dedicated screen file exists. `src/screens/StatsScreen.ts:7,181` (`import { Achievements } from "../game/Achievements"`, `Achievements.getAch(key)`) folds achievement/medal display into the Stats screen instead of a standalone Achievements grid matching `Menu.as:2585-2601`'s 10-row `but_list0..9` layout (icon + name + desc + reward per row, locked/unlocked state). |
| Screen transitions (`Transition.as`) | correct | `src/core/Transition.ts` ports all five modes verbatim — `slideLeft`/`slideRight` (snapshot pair eased at `x += (toX-x)*0.3` with the `±5` px snap), `zoomIn`/`zoomOut` (`±0.05` scale plus the matching `alphCh` cross-fade), `fallOff` (`rotation += rot`, `velY += 4`), each preceded by the source's 2-frame `WAIT_FRAMES` hold and capped at `ZOOM_FRAMES=10`. `src/core/Engine.ts` `setScreen(Ctor, arg, kind)` renders the outgoing screen to a `RenderTexture`, swaps, captures the arriving one, and hides `root` until the slide lands. Every menu navigation is wired to the source's direction convention — forward is `slideLeft`, Back is `slideRight`, and anything entering or leaving a match keeps the plain fade. |
| Credits | wrong-incomplete (renamed) | `src/screens/InfoScreen.ts:12-60` is the closest equivalent ("About / credits screen", title "ABOUT RAZE", `Impact` font) but is a scrollable prose column (version number, changelog, port notes) rather than the original's static 3-column name/role grid. It does preserve the spirit of crediting "Juice-Tin / AddisonR / Armor Games" per its own doc comment, echoing the SWF's `"Armor Games | Addison Rodomista | Justin Goncalves"` string, but the visual form (scrolling text vs. a fixed credits grid) is unrelated. |

> **Caveat on this table**: it was written before the menu rework. The Menu row above has been
> re-verified against the live build and corrected; the remaining five rows (Campaign select, Quick
> Match, Armory, Achievements, Credits) have **not** been re-checked and may describe screens that
> have since changed. Re-audit them before trusting them.

**Overall gap**: the port's menu screens are a from-scratch UI redesign (Impact-font wordmarks, flat
saturated accent colors, monospace body text, card/tile-based layouts) rather than a pixel-faithful port
of the SWF's BlairMdITC TT / QTypeSquare / Calibri typography, white-alpha text, and list-plus-preview-
panel layouts documented above. Every one of the six screens differs in both typography and layout; two
(Achievements, Credits-as-grid) have no structurally matching screen at all. The *motion* between them is
now authentic even though the screens themselves are not — `Transition.ts` reproduces the SWF's slide /
zoom / fall-off exactly, so navigation feels like the original regardless of what is being slid.
