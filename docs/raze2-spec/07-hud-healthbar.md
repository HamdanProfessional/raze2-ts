# HUD — Health/Shield Bars, Ammo, Crosshair, Minimap, Kill Feed, Streaks

## 1. Summary

Raze 2's "HUD" is really two separate systems that the reference screenshots (#1
player bar, #2 alien bar) conflate at first glance:

1. **The corner HUD** (`Hud.as`, symbol **1568**) — built once per match, anchored
   to the 800×600 stage, and it only ever shows the **local human player's**
   vitals: an animated ECG "heartbeat" health readout, a vertical yellow shield
   bar, a horizontal purple ability-energy bar, the ammo/weapon strip, credits,
   score header and the kill feed.
2. **The per-unit floating nameplate** (`Unit.as`, symbol **73**) — a small name
   tag + continuous health bar that hovers above **every** unit's head, human or
   AI, coloured by that unit's team. **This is what screenshots #1 and #2 are
   showing** — "player" (blue, team 1) and "Alien" (orange/gold, team 2) are two
   instances of the exact same nameplate widget, just on units of different
   teams. It carries no shield indicator at all (shield is corner-HUD-only, and
   only for the local player).

The brief's "restyle the health bar to Raze 2" therefore targets item 2 first —
it is the thing visible over both the player and every AI "alien" in the arena
— with item 1 (the corner vitals cluster) as the secondary, already-fairly-
faithful target.

## 2. Raze 2 source of truth

### 2.1 Files

| File | Role |
|---|---|
| `decompiled_swf/raze 2/scripts/Unit.as` | Per-unit nameplate: `txt_name`, `backbar_hp`, `bar_hurt`, `bar_hp`, `bar_en`, `navarrow`; team colour table; `changeTeam()`. |
| `decompiled_swf/raze 2/scripts/Status.as` | Health/shield/energy state machine; `setBars()` drives `bar_hp`/`bar_hurt`/`bar_en` widths every frame and also feeds the corner HUD (`unit.game.hud.setHealth(...)`, `setEnergy(...)`) when `unit.human`. |
| `decompiled_swf/raze 2/scripts/Hud.as` (symbol **1568**) | Corner HUD: heartbeat/shield/energy cluster, ammo bar, weapon strip, score header, kill feed, message box. |
| `decompiled_swf/raze 2/scripts/Hud_WeaponHolder.as` (symbol **1447**) | One weapon-loadout slot (`gun0..gun6`). |
| `decompiled_swf/raze 2/scripts/Aimer.as` (symbol **1571**) | Crosshair: `line1..line4`, no other state. |
| `decompiled_swf/raze 2/scripts/Player.as:118-151` | Drives `game.aimer` position + spread math every frame. |
| `decompiled_swf/raze 2/scripts/KillPoints.as` (symbol **446**) | World-space floating kill-bonus popup (the closest thing to a "streak banner"). |
| `decompiled_swf/raze 2/sprites/DefineSprite_73_Unit/1.svg` | FFDec per-frame SVG render of symbol 73 — used below for exact nameplate geometry/colour (the numbers Status.as/Unit.as don't carry, e.g. the bevel frame). |
| `raze-ts/docs/raze2/14-hud-chrome.md` | An earlier, independent pass over the same sources (symbol IDs, fonts, corner-HUD layout). Cross-checked against the primary sources above; no discrepancies found, so its numbers are reused/cited directly where confirmed. |

### 2.2 Per-unit nameplate — exact geometry (symbol 73, frame 1 SVG dump)

All coordinates are **local to the unit's registration point**, y negative = above
the character (in Flash, +y is down). Extracted directly from
`DefineSprite_73_Unit/1.svg` (`<use id="...">` transforms), not just the AS3
variable names:

| Child (`instance id` in SVG / AS3) | x range (px) | y range (px) | Source shape |
|---|---|---|---|
| Backing plate (`character 42`, unnamed, depth 1) | full nameplate width | y ≈ ‑95.3 to ‑61.3 (34px tall) | Flat black rect, `fill="#000000" fill-opacity="0.2"` — a soft dark backdrop behind the whole cluster (text + bars), not a shaped frame. |
| `txt_name` | ‑38.0 to +41.7 (79.7 wide, only ~46px of glyphs drawn in this frame) | ‑97.0 (top) | 8pt **QTypeSquare-Bold**, `fill="#ffffff" fill-opacity="0.8"`, plus a **black glow filter** (`feGaussianBlur stdDeviation≈0.816`, i.e. a ~1.6px soft black outline — the same "etched on glass" glow every HUD text field in Raze 2 uses). |
| Nameplate bevel frame (unnamed shape6, siblings of the bars, no instance name — pure decoration) | x ‑39.5 to +39.5 (79px wide) | y ‑97.3 to ‑84.1 (13.2px tall) | Two picture-frame strips forming a hollow bevel box: **top/inner edge `#cccccc` (light grey) 49.8% alpha**, **bottom/outer edge `#999999` (dark grey) 49.8% alpha**, each ~5.75–6.75px thick, with a fully transparent centre (no team-colour fill under the name — team colour lives only in the bars below). 1px black outline strokes at ~30–50% alpha finish the bevel. |
| `backbar_hp` | x 0 to 46.5 (base shape), scaled ×1.6142 → **75px** rendered width | y ‑95.3 to ‑87.7 (7.6px tall) | See §2.3 for the 3‑band bevel fill. |
| `bar_hurt` | same slot as `backbar_hp` | same, 7.6px tall | Red damage-flash sliver, see §2.3. |
| `bar_hp` | same slot | same, 7.6px tall | Bright team-tint front fill, see §2.3. Z-order (back→front): `backbar_hp` → `bar_hurt` → `bar_hp`, so the red sliver only shows in the strip between the current and previous fill widths. |
| `bar_en` | x ‑37.5 + (0..75px scaled), width scales the same way as `bar_hp`/`backbar_hp` | y ‑87.65 (8.65px **below** the health bar's top, i.e. its own row directly under the health bar) | Ability-energy bar. Base shape fill `#ff66ff` (magenta/pink), `fill-opacity="1.0"` — **no back-track shape exists for `bar_en`** (unlike `bar_hp`, which always has `backbar_hp` under it); it is a bare fill with no visible "track" when empty. |
| `navarrow` | x ≈ +1.6, y ≈ ‑42.0 (well below the bars, near the character's shoulder) | 25.95×11.95px | Small red downward-pointing triangle (`fill="#ff0000" fill-opacity="0.6"`, `stroke="#620000" width=1.5`) — the objective/flag-carrier pointer, hidden unless `Unit.focusArrow()` is armed (`Unit.as:407-419`). Not part of the health-bar cluster proper. |

### 2.3 Health-bar fill — the 3-band "bevel by opacity" trick

Both `backbar_hp` and `bar_hurt`/`bar_hp` are **not flat-fill rects**. Each is a
7.6px-tall shape sliced into three horizontal bands sharing one hue but two
opacities, which reads as a subtle top-highlight/body/bottom-shadow bevel
without an actual gradient:

| Band | y range (of 7.6px height) | `backbar_hp` opacity | `bar_hurt` / `bar_hp` opacity |
|---|---|---|---|
| Top edge | 0 – 1.4px | 0.298 | 0.647 |
| Body | 1.4 – 4.9px (3.5px) | 0.400 | 0.847 |
| Bottom edge | 4.9 – 7.6px | 0.298 | 0.647 |

Base hue is swapped wholesale by team via `ColorTransform.color` (a flat
multiply, `Unit.as:240-255`, applied in `changeTeam()` at `Unit.as:421-450`) —
the SWF-authored template colour is plain green (`#00ff00` front / `#006600`
back), and Flash's colour-transform tint just overrides that RGB outright per
team, so the 3-band alpha structure survives the recolour untouched:

| Team | `bar_hp` (front) | `backbar_hp` (back) | AS3 constant |
|---|---|---|---|
| 0 / 4 — FFA / no team | `0x00FF00` green | `0x006600` dark green | `greenBar` / `greenBarBack`, `Unit.as:240-243` |
| **1 — Blue ("player")** | **`0x00CCFF`** cyan-blue | `0x003399` navy | `blueBar` / `blueBarBack`, `Unit.as:244-247` |
| **2 — "red"-named but actually orange ("Alien"/enemy AI)** | **`0xFF9900`** orange/gold | `0x663300` brown | `redBar` / `redBarBack`, `Unit.as:248-251` (misleadingly named `redBar` in source; the literal colour value is orange, matching the "orange/gold Alien bar" in screenshot #2) |
| 3 — Yellow | `0xFFFF00` yellow | `0x996600` olive | `yellowBar` / `yellowBarBack`, `Unit.as:252-255` |

This exactly matches the two reference screenshots: #1's blue-tinted "player"
nameplate is team 1 (`0x00CCFF`/`0x003399`), #2's orange/gold "Alien" nameplate
is team 2 (`0xFF9900`/`0x663300`). Neither screenshot needs a special "alien"
palette — it is the ordinary team-2 tint applied to an AI unit.

### 2.4 Bar width / dynamics (`Status.as`)

- `bar_width = 75` (`Status.as:103`, set once in the `Status` constructor) — the
  **full-health** pixel width of both `bar_hp` and `bar_en`. `hpMax` is normally
  100 (400 in the "4x Health" special mode, `Status.as:71`), so 1 HP ≈ 0.75px.
- `setBars()` (`Status.as:379-393`), called every `EnterFrame`:
  - `unit.bar_hp.width = hpCur / hpMax * bar_width`
  - `unit.bar_hurt.width += (unit.bar_hp.width - unit.bar_hurt.width) * 0.05` —
    a 5%-per-frame ease **toward** the current `bar_hp` width. Because `bar_hp`
    sits on top of `bar_hurt` in the z-order, this only becomes visible as a red
    sliver when `bar_hurt` is **wider** than `bar_hp` (i.e. right after taking
    damage); healing snaps the catch-up instantly (`Status.as:106`,
    `unit.bar_hurt.width = unit.bar_hp.width` inside `heal()`), so a heal never
    shows a red sliver.
  - `unit.bar_en.width = enCur / enMax * bar_width`, `bar_en.alpha = enCur >=
    unit.ability.usedEnergy ? 1 : 0.6` — the energy bar itself dims when the
    unit can't currently afford its ability, an "ability off cooldown but can't
    afford it" tell that has no equivalent on `bar_hp`.
- There is **no shield representation anywhere on the per-unit nameplate**.
  Shield (`shCur`/`shMax`) only reaches the screen via the corner HUD
  (`unit.game.hud.setHealth(hpCur, hpCur/hpMax, shCur/shMax)`, `Status.as:381`,
  guarded by `if(unit.human)`), so only the local player ever sees a shield bar,
  and it isn't on this nameplate at all.
- Bars are **continuous fills, not segmented/pip bars** — there are no tick
  marks or notches baked into `bar_hp`/`backbar_hp` art (unlike the corner HUD's
  ammo bar, which is explicitly segmented, §3.2). "Segmented-looking" in a
  screenshot is an optical effect of the 3-band bevel (§2.3), not real segments.

## 3. Corner HUD (`Hud.as`, symbol 1568) — the local player's own vitals

Cross-checked against `docs/raze2/14-hud-chrome.md` §1.1–§1.9 (an earlier,
independent extraction of the same files); all figures below were re-verified
against `Hud.as` directly and match that doc exactly, so its line numbers are
cited alongside the source lines found here.

### 3.1 Heartbeat / shield / energy cluster

| Element | Behaviour | Source |
|---|---|---|
| `heartbeat` (MovieClip, char **1467** per doc 14) | Animated ECG waveform clip; `setHeartBeat()` picks a frame label by hp band: `"empty"` (hp=0), `"low"` (hp<0.35), `"half"`, `"full"` (hp≥0.71) — **the waveform itself is the health widget**, no separate bar. | `Hud.as:609-627` |
| `heartbeat.txt_health` | `Math.ceil(hp) + "%"` | `Hud.as:363` |
| Heartbeat tint | `ColorTransform.color` set per frame: `red = hp<=0.5 ? 255 : (1-hp*2)*255`, `green = hp>=0.5 ? 255 : hp*2*255`, `blue` fixed **`0x50` (80)**. Full health ≈ `#00FF50`, mid ≈ `#FFFF50`, critical ≈ `#FF0050`. | `Hud.as:357-362` |
| `bar_shield` (char 44, generic rect) | **Vertical**, `height = shPerc * 33` (33px max height). Baked tint `(255,255,0)` → `#FFFF00` yellow. | `Hud.as:356` |
| `bar_en` (char 44) | **Horizontal**, `width = enPerc * 130` (130px max width). Baked tint `(204,153,255)` → `#CC99FF` lavender. | `Hud.as:369` |
| `bloodscreen` (char 1431, full-stage) | `alpha = (0.4 - hp*0.4) * 0.8`; alpha 1 at hp=0. Mirrored randomly on `reset()`. Frame 1/2 toggled by the `SD.sblood` option. | `Hud.as:350-354`, `276-277` |

### 3.2 Ammo readout (bottom, segmented reserve bar)

`setAmmoBar(cur, max, gunId)` (`Hud.as:451-552`):

- Segment count by max reserve: `>75` → 4 segments, `>50` → 3, `>25` → 2, else 1
  (`Hud.as:454-470`).
- `bar_ammo0..3` (4× char-44 rects), each up to **58px wide, 14px tall**, filled
  left→right in reserve order; segments beyond the current gun's segment count
  are hidden (`this["bar_ammo"+i].visible = false`).
- `ammoOutline` (runtime `Graphics`): **dark-grey `#333333` (`0x333333`), 1px**
  lines (`lineStyle(1, 3355443, 1)`) drawn as vertical dividers between clip
  boundaries within a segment and as the 14px-tall segment outline box
  (`Hud.as:486-509`) — this is the actual source of the "segmented" look the
  ammo bar has (the health bars, §2.4, do not have this).
- Fill colour is baked white (`#FFFFFF`) on all four bars — not team/health
  coloured.
- `txt_clip` shows the current clip count as plain text.

### 3.3 Weapon loadout strip (`Hud_WeaponHolder`, symbol 1447)

7 slots `gun0..gun6`, 65px pitch, `txt_num` = `"1".."7"` set once
(`Hud.as:167-175`). Selection state (`setMiniAmmoBars()`, `Hud.as:554-607`):

- Unselected slot: `bar_ammo` tinted `colTransOff` → `0xCCCCCC`; `weapon.alpha`
  drops to `0.3` when that weapon's ammo is exhausted.
- Selected slot: `bar_ammo` tinted `colTransOn` → `0xFFFF00` (`Hud.as:176-184`).
- Fill width: `(ammo.cur + ammo.clip*clipSize) / (clipMax*clipSize) * 56px`.

### 3.4 Crosshair (`Aimer.as`, symbol 1571)

- 4 independent line segments (`line1..line4`), one shared reticle for every
  weapon — no per-weapon crosshair art or colour anywhere in `Aimer.as`.
- `Player.EnterFrame()` (`Player.as:118-151`) recentres it on the mouse every
  frame, then spreads the ticks by a **chord-length formula**: given `dist` =
  distance from the arm socket to the aim point, `gap = sqrt(2·dist² −
  2·dist²·cos(dynRecoilMod·π/180))` — the chord subtended by the gun's current
  recoil-angle at that distance. `line1.y = -gap`, `line2.x = gap`, `line3.y =
  gap`, `line4.x = -gap` (a symmetric N/E/S/W spread, not per-side).
- There is **no reload-progress ring, no per-weapon tint, and no empty-clip
  colour change** anywhere in `Aimer.as` or the `Player`/`Guns` call sites found
  — those would be pure additions if a port includes them (see §4).

### 3.5 Kill feed, score header, streaks, damage indicator

Re-verified directly against `Hud.as` (matches `docs/raze2/14-hud-chrome.md`
§1.5–§1.9 exactly):

- **Kill feed** (`feedbox`, `addKillFeed()` `Hud.as:721-760`, `processFeed()`
  `Hud.as:776-825`): 3-part string `"{victim} ({weapon})> {killer}"`. Colours:
  same-team name `0x99FFFF`... — wait, actually **cyan for the local player's
  team**, `0xFF9999` salmon for enemy team, `0x33FFFF` bright cyan when the name
  *is* the local player, weapon/separator run always `0xCCCCCC`, and a
  special-cased `"Suicide"` label in `0xFF99FF` pink (`Hud.as:748-751`). Caps at
  **13 visible lines** (`Hud.as:780`), 15px row height, grows upward.
- **Score header**: `txt_time` clock, `txt_playerscore`/`txt_enemyscore`
  (`setScore()`, `Hud.as:372-433`) — solo/FFA player text `0xFFFF99`, on-a-team
  player text `0xA3CFFF`; opponent text indexed by team
  `["FFA"=0xFFFFFF,"Blue"=0xA3CFFF,"Orange"=0xFF9966,"Yellow"=0xFFFF99,"Green"=0x99FF99]`
  (`Hud.as:412`); whoever is ahead gets a `"> "` prefix. `scorebars` mask width
  = `score / winScore * 124px` per side.
- **Streak banners**: **do not exist** in `Hud.as` as a dedicated widget — no
  method or MovieClip resembling a kill-streak ladder was found anywhere in the
  file (confirmed by a full read of all 862 lines, not just a grep). The nearest
  equivalents are (a) `display_text`/`display_num` — a generic "+credits" /
  short-text popup any bonus can trigger (`setDisplay()`, `Hud.as:435-449`), and
  (b) the world-space `KillPoints` popup (symbol **446**) that spawns at the
  kill location with bonus labels sourced from `Stats_KillBonuses` (e.g.
  "Headshot!", "Juggerkill!"). There is no "3 kills = Killing Spree" style
  ladder anywhere in the decompile.
- **Damage indicator**: **does not exist**. No minimap/radar class and no
  screen-edge or directional damage-from-indicator was found anywhere in
  `scripts/` (exhaustive grep for `radar|minimap|damage.*indicat`, corroborated
  by the full `Hud.as` read here finding no such member). The only "where is
  the threat" affordance in the entire game is `navarrow` (§2.2), which points
  at a flag/objective, not an attacker.
- `mc_msg` (§1.7 in doc 14) is the campaign/kill-quip announcer box (portrait +
  name + line), unrelated to streaks.

## 4. Current port state

### 4.1 Per-unit nameplate — `raze-ts/src/game/Unit.ts`

The port **already has** a from-scratch nameplate implementation, and it is
already team-colour-accurate:

- `Unit.ts:111-112` — `NAMEPLATE_BAR_W = Math.round(75 * UNIT_SCALE)` (≈32px at
  `UNIT_SCALE = 0.42`, `Unit.ts:82`), `NAMEPLATE_BAR_H = 3.5`. Correctly derived
  from the authentic 75px `bar_width` (`Status.as:103`), scaled down for the
  port's smaller on-screen character.
- `Unit.ts:419-428` (`teamColor()`) and `:434-445` (`barColors()`) hard-code the
  **exact** hex values from §2.3's table: team 1 `[0x00ccff, 0x003399]`, team 2
  `[0xff9900, 0x663300]`, team 3 `[0xffff00, 0x996600]`, team 4
  `[0xcc66ff, 0x4d2673]` (a colour Raze 2 doesn't define at all — see §5), FFA
  `0x00ff00`/`0x006600`, plus a Jug override `[0xffcc33, 0x664d00]` (also not in
  the source team table — Jug uses `isJug` art/glow elsewhere in Raze 2, not a
  distinct nameplate palette).
- `Unit.ts:951-992` (`drawHealthBar()`) draws exactly the three-layer
  back→hurt→front stack in the right z-order, and **the 5%-per-frame ease is
  already correct** (`Unit.ts:966-971`, comment cites `Status.as:384` verbatim
  — note the correct line is `Status.as:384` only in that older doc's line
  numbering; in this file it's `Status.as:390`, `bar_hurt.width += (bar_hp.width
  - bar_hurt.width) * 0.05` — same formula, confirmed independently above in
  §2.4) — including the "heal snaps the sliver up instantly" behaviour implicit
  in `if (frontW >= this.hurtW) this.hurtW = frontW;` (`Unit.ts:970`).
- `Unit.ts:864-899` (`buildNameBox()`) builds `nameBar` (a **solid team-colour
  filled rect** behind the name, 85% alpha + black stroke, `Unit.ts:924-927`)
  and `nameText` (`Arial, sans-serif`, size 9, white, no stroke/glow,
  `Unit.ts:865-873`).
- `jugCrown` (`Unit.ts:887-894`) — a hand-drawn 5-point gold crown icon toggled
  by `isJug`, shown above the name. **Not in Raze 2 at all** — the source
  signals Jug status via `unit.MC.filters` glow effects on the character body
  (`Status.as` `EnterFrame()`, the `isJug` `GlowFilter` block) and the
  `gotoAndStop("aJug")` frame, not a nameplate icon.
- **No `bar_en` equivalent.** The port never draws an ability-energy bar above
  any unit's head — only the corner-HUD energy bar (§4.2) exists, and that is
  local-player-only, matching the source's local-player-only restriction, but
  the source *does* also draw `bar_en` above every unit's head (§2.2), which the
  port omits entirely.
- **No `navarrow` equivalent** anywhere in `Unit.ts` (confirmed by grep — no
  match for `navarrow`/`focusArrow` in the port at all).
- **No bevel-frame or per-band opacity structure.** `nameBar` is one flat fill;
  `healthBar` layers are flat single-alpha rects (`Unit.ts:981-991`) rather than
  the 3-band top/body/bottom alpha bevel from §2.3.
- **No text glow.** `txt_name`'s black `GLOWFILTER` (§2.2) has no port
  equivalent; `nameText` is a plain fill.

### 4.2 Corner HUD — `raze-ts/src/game/Hud.ts` + `HudComponents.ts`

This is a deliberate, documented **reinterpretation**, not a 1:1 port (see the
file-header comment, `Hud.ts:38-69`), but the numeric constants that matter are
already lifted from the source with citations:

- `SH_MAX_H = 33` (`Hud.ts:80`) matches `Hud.as:356`'s 33px shield-bar max
  exactly; `EN_MAX_W = 130` (`Hud.ts:84`) matches `Hud.as:369`'s 130px energy
  max exactly.
- `healthTint()` (`HudComponents.ts:200-207`) reproduces the `Hud.as:357-361`
  red/green/blue-0x50 ramp formula verbatim.
- `drawHeartbeat()` (`HudComponents.ts:216-257`) is an **invented** ECG-style
  waveform generator (a synthetic PQRST spike curve) standing in for the
  original's hand-animated `heartbeat` MovieClip frames — conceptually matched
  ("the waveform is the health widget") but not visually identical, since the
  original's exact waveform art (per hp band `"empty"/"low"/"half"/"full"`) was
  not extracted into this port.
- Shield bar is drawn **vertical, yellow** (`C_SHIELD_YELLOW = 0xffff00`,
  `Hud.ts:916-924`) — correct per §3.1. Energy bar is **horizontal, purple**
  (`C_ENERGY_PURPLE = 0xcc99ff`, `Hud.ts:926-947`) — correct per §3.1, and only
  shown for classes with an ability (`hasAbility`), which the source does not
  explicitly gate this way (the source always shows `bar_en`; it just stays at
  0 width with no ability). Minor behavioural difference, not a colour/shape one.
- Weapon strip (`drawLoadoutStrip()`, `Hud.ts:1126-1207`): selected-slot
  highlight uses `C_SLOT_SELECTED = 0xffff00` and unselected
  `C_SLOT_UNSELECTED = 0xcccccc` (`HudComponents.ts:49-51`) — both correct per
  §3.3. Layout is re-centred/dynamic rather than the source's fixed 7-slot,
  65px-pitch strip (`Hud.ts` comment at `:1119-1125` documents this as an
  intentional adaptive-count change).
- Ammo bar is **not segmented** in the port at all — `drawAmmoReadout()`
  (`Hud.ts:1214-1270`) shows one big clip number + reserve number as text, with
  no `bar_ammo0..3` segment rects, no `ammoOutline` divider lines, and no
  58px/14px segment geometry from §3.2. This is the single largest visual gap
  in the ammo readout specifically.
- Kill feed colours (`Hud.ts:149-157`: `KF_TEAMMATE = 0x99ffff`, `KF_ENEMY =
  0xff9999`, `KF_SELF = 0x33ffff`, `KF_WEAPON = 0xcccccc`) match §3.5 exactly,
  including the 13-line cap (`KF_MAX = 13`, `Hud.ts:141`). The "Suicide" pink
  special-case (`0xFF99FF`) is **not implemented** — suicides fall through to
  the generic `addMessage()` path with no colour override found in `Hud.ts`.
- Streak banners (`STREAK_TIERS`, `Hud.ts:201-207`: Killing Spree/Rampage/
  Dominating/Unstoppable/Godlike at 3/5/7/10/15 kills) are an **out-of-source
  invention** — §3.5 confirms Raze 2 has no such ladder at all. Not wrong to
  keep (it's good game feel), but it should not be described as a "port" of
  anything; it is new content layered on top of the credit-popup system.
- `DamageIndicator` (`HudComponents.ts:314-375`) and `Minimap`
  (`HudComponents.ts:413-497`) are **both out-of-source inventions** — §3.5
  confirms neither exists anywhere in Raze 2. `Hud.ts`'s own header comment
  already flags the minimap as "a deliberate port addition" (`Hud.ts:52-53`);
  the damage indicator carries no such disclaimer but is equally absent from
  the source.
- Crosshair (`raze-ts/src/game/Crosshair.ts`) matches §3.4's "one shared white
  reticle, four ticks, spreads with recoil" model in spirit
  (`C_RETICLE = 0xffffff`, `Crosshair.ts:6`), but the spread math is a tuned
  approximation (`BASE_GAP`/`RECOIL_GAIN`/`SPREAD_GAIN`/`MOVE_GAIN` constants,
  `Crosshair.ts:29-39`) rather than the source's exact chord formula (§3.4), and
  it adds a **reload progress ring** (`Crosshair.ts:118-126`) and an
  **empty-clip red tint** (`Crosshair.ts:97`) — both confirmed absent from
  `Aimer.as` (§3.4).

## 5. Gap analysis

Per-unit nameplate (the actual "restyle the health bar" target):

| Aspect | Raze 2 target | Port today | Gap |
|---|---|---|---|
| Bar width | 75px at 1:1 scale (≈32px at port's `UNIT_SCALE=0.42`) | `NAMEPLATE_BAR_W ≈ 32px` | **None** — already correct. |
| Team colours (front/back) | Team 1 `0x00ccff`/`0x003399`, team 2 `0xff9900`/`0x663300`, team 3 `0xffff00`/`0x996600`, FFA `0x00ff00`/`0x006600` | Exact match, plus non-canonical team 4 and Jug entries | **None for teams 0-3** — already correct. Team-4/Jug colours are invented (harmless, since Raze 2 doesn't define team 4 as a playable colour and Jug doesn't reskin the nameplate at all). |
| Bar fill shading | 3-band alpha bevel (top 0.298/0.647, mid 0.4/0.847, bottom 0.298/0.647) | Flat single-alpha rects | **Gap** — bars read flatter/more saturated than source. |
| `bar_hurt` red sliver | Eases 5%/frame toward `bar_hp`, instant snap-up on heal, drawn behind front fill | Implemented with the same 5%/frame ease and instant-heal snap, same z-order | **None** — already correct. |
| Ability-energy bar (`bar_en`) above every unit | Magenta `#ff66ff`, same 75px scale, sits directly under the health bar, dims to 0.6 alpha when unaffordable | **Not implemented at all** on the nameplate (only exists, differently coloured, in the corner HUD for the local player) | **Gap** — every AI/other-player nameplate is missing its energy row entirely. |
| Nameplate background | Hollow bevel frame (light-grey top edge, dark-grey bottom edge, transparent centre, no team-colour fill) | Solid team-colour-filled rect at 85% alpha + black stroke | **Gap** — the port's name tag looks like a colour-coded pill; source looks like a grey metal window with white text and no fill. |
| Name text style | 8pt QTypeSquare-Bold, white 80% alpha, black glow-filter outline | Arial 9px, white, no stroke/glow | **Gap** — font family and the signature glow outline are both missing. |
| Shield on nameplate | Does not exist (shield is corner-HUD/local-player only) | Does not exist | **None** — port correctly has no shield here; worth calling out explicitly since the brief's "health vs shield representation" phrasing could otherwise be misread as "the nameplate needs a shield segment." |
| Objective pointer (`navarrow`) | Small red triangle, armed via `focusArrow()`, sits below the bars near the shoulder | **Not implemented** (no `navarrow`/`focusArrow` anywhere in `Unit.ts`) | **Gap** — out of scope for the health-bar restyle itself, but flagged since it's part of the same nameplate cluster in source. |
| Jug crown icon | Not part of the nameplate at all (Jug status shown via body glow + animation frame) | Hand-drawn crown icon above the name | **Deviation** — not a "missing" feature, but it's an invented nameplate element that has no source counterpart; keep or cut is a style call, not a fidelity fix. |

Corner HUD, ammo, crosshair, minimap, kill feed, streaks (secondary, for
completeness):

| Aspect | Raze 2 target | Port today | Gap |
|---|---|---|---|
| Health/shield/energy max sizes | 33px shield, 130px energy | Same constants | **None.** |
| Health colour ramp | Continuous R/G ramp, B fixed `0x50` | Same formula (`healthTint`) | **None.** |
| Heartbeat waveform art | Hand-animated clip, 4 discrete hp-band frames | Synthetic generated ECG curve | **Deviation** — same concept, different concrete waveform; original per-band art was not extracted. |
| Ammo reserve bar | Segmented (1-4 chunks by max reserve), `0x333333` divider lines, 58×14px chunks, white fill | Single numeric read-out, no segments/dividers | **Gap** — the segmented look called out in the brief lives here, not on the health bar, and it's entirely unimplemented. |
| Weapon-slot selection colours | `0xffff00` selected / `0xcccccc` unselected | Same | **None.** |
| Kill-feed colours + 13-line cap | Teammate `0x99ffff`, enemy `0xff9999`, self `0x33ffff`, weapon `0xcccccc`, suicide `0xff99ff`, cap 13 | All match except the suicide pink special-case | **Minor gap** — suicide colour-coding missing. |
| Crosshair spread | Exact chord formula off `dynRecoilMod` + aim distance | Tuned approximation with extra reload-ring/empty-tint states | **Deviation** — good UX, not source-accurate; the ring/tint are additions. |
| Minimap / radar | Does not exist in Raze 2 | Implemented, already self-labelled as a port addition | **None to fix** — documented deviation, working as intended. |
| Directional damage indicator | Does not exist in Raze 2 | Implemented, **not** labelled as an addition anywhere in the port | **Documentation gap only** — should be flagged the same way the minimap is, so nobody goes looking for a source spec that doesn't exist. |
| Streak banners | Does not exist in Raze 2 (uses `KillPoints` world popups + generic credit popup instead) | Implemented 5-tier streak ladder | **Documentation gap only** — same as above; it's new content, not a port, and should be labelled as such. |

## 6. Implementation checklist (for the LATER build phase — do NOT do it now)

Ordered by leverage (biggest visual delta for least risk first). All work is in
`raze-ts/src/game/Unit.ts` unless noted.

1. **Nameplate background → bevel frame, not a colour pill.** Replace
   `nameBar`'s solid team-colour fill (`Unit.ts:924-927`) with a two-tone hollow
   frame: light-grey top strip (`#cccccc`, ~40-50% alpha) over a dark-grey
   bottom strip (`#999999`, ~40-50% alpha), transparent centre, thin black
   outline. Move the team colour off the name tag entirely — per §2.2/§5, the
   source never tints the name plate itself.
2. **Health bar 3-band shading.** In `drawHealthBar()` (`Unit.ts:951-992`),
   split each of `backbar_hp`'s look-alike and `bar_hp`/`bar_hurt`'s rect into
   three stacked bands (top 20%, mid 60%, bottom 20% of the 3.5px height is a
   reasonable pixel-scale approximation of the source's 1.4/3.5/1.4-of-7.6
   split) using the exact alpha pairs from §2.3 (0.298/0.4/0.298 for the back
   track, 0.647/0.847/0.647 for the front/hurt fills).
3. **Add the per-unit ability-energy row (`bar_en`).** New thin magenta
   (`0xff66ff`) bar directly under the health bar on every unit (not just the
   local player), same 32px-scaled width, driven by the unit's existing
   `status.getEnPer()` (already used for the corner HUD, `Hud.ts:931`), with the
   same `alpha = ready ? 1 : 0.6` affordability dim from `Status.as:392`.
   Requires reading each non-player unit's ability-affordability, which should
   already be tracked by `Status` for AI decision-making — verify before adding
   new state.
4. **Name text: font + glow.** Swap `nameText`'s style
   (`Unit.ts:865-873`) to whatever this port's QTypeSquare-equivalent HUD font
   is (`FONT_VALUE`, already used in `Hud.ts`, is the closest existing match)
   and add a black drop-shadow/glow (Pixi `dropShadow` with a small blur, same
   trick `Hud.ts`'s `mkValueText()` uses via `stroke`, `Hud.ts:245-256`) so the
   nameplate matches the "etched on glass" look every other HUD text field
   already has.
5. **(Optional, explicitly out of the health-bar's own scope but same
   cluster) `navarrow`.** Small red-triangle objective pointer, shown/hidden by
   whatever flag-carrier/objective-focus signal the port's CTF/Domination code
   already tracks. Skip if those modes aren't wired up yet.
6. **Ammo segmentation (corner HUD, not the nameplate).** In `Hud.ts`'s
   `drawAmmoReadout()`/`drawLoadoutStrip()` area, add the segmented reserve bar
   from §3.2: 1-4 chunks by max-reserve thresholds (25/50/75), `0x333333`
   divider lines, white fill. This is the actual source of a "segmented bar"
   look in Raze 2 and is currently 0% implemented.
7. **Suicide kill-feed colour.** One-line addition in `Hud.ts`'s kill/suicide
   message path: use `0xff99ff` for the "Suicide" keyword per `Hud.as:748-751`.
8. **Documentation-only housekeeping.** Add a one-line comment (matching the
   minimap's existing disclaimer style, `Hud.ts:52-53`) to `DamageIndicator`
   and the streak-banner system noting they are port additions with no Raze 2
   source counterpart (§3.5), so future contributors don't go hunting for a
   spec that doesn't exist.
9. Leave the Jug crown icon, the synthetic ECG waveform, the adaptive-width
   weapon strip, the minimap and the tuned crosshair spread as intentional,
   already-good deviations — nothing to "fix" there, just keep them out of any
   future "must match source" audit.

## 7. Open questions / data still missing

- **Reference screenshots could not be opened directly by this pass** — the
  image paths under `C:\Users\Hamdan\.claude\image-cache\...\1.png` /
  `2.png` were outside this sub-agent's accessible filesystem (resolved as
  "does not exist" even via `Glob`/`Bash ls` on the parent directory). Every
  colour/geometry claim above was instead derived from the decompiled SWF
  (AS3 + the FFDec-rendered SVG frame of symbol 73), which is the more
  reliable ground truth anyway per this domain's own template rule ("colors as
  0xRRGGBB", "SWF symbol ids"), and it happens to match the brief's own
  screenshot description ("blue-tinted player" = team 1, "orange/gold Alien" =
  team 2) exactly. A future pass with direct image access should still
  eyeball the two screenshots once to confirm no runtime-only effect (e.g. a
  drop shadow cast by the nameplate onto the arena, or an in-game font hinting
  difference) was missed by the static SWF frame dump used here.
- **`heartbeat` clip's exact per-band waveform art** (the 4 frame labels
  `"empty"/"low"/"half"/"full"`) was not extracted — only the frame-selection
  logic (`Hud.as:609-627`) and the tint formula are confirmed. Symbol/character
  ID for `heartbeat` (**1467**) is carried over from `docs/raze2/14-hud-chrome.md`
  and was not independently re-derived from a fresh symbol-table lookup in this
  pass; low risk (nothing else in this doc depends on that exact number) but
  worth a quick confirm before anyone embeds it in code.
- **`Unit.as` backing-plate shape** (`character 42`, the soft black rect behind
  the whole name+bars cluster, §2.2) has no AS3 instance name and no scripted
  behaviour — its exact extent (34px tall, full nameplate width) comes from
  reading the SVG transform directly; worth a second look in FFDec's GUI if a
  pixel-perfect backing plate is wanted, since the SVG frame only captures one
  authored pose.
- **AI-unit ability affordability signal** for the proposed `bar_en` rollout
  (checklist item 3) — confirm whether `Status` already exposes a per-unit
  "can afford ability now" boolean/fraction for bots, or whether that would be
  new plumbing.
