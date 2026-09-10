# Options Screen + Graphics Quality/Preset System

## 1. Summary

Raze 2's Options screen (reachable from the pause menu's `Options` label, and
from a menu-side `Options` panel that shares the exact same code path) lets the
player pick one of five **Graphic Presets** (Ultra/High/Medium/Low/Custom)
that bulk-set five **Graphic Detail** knobs (Quality, Particles, Glows,
Lights & Reflections, Ragdoll evaporating), plus four **Other Options**
toggles (Sounds, Music, Bloody Screen, Pause Blur) that are independent of the
preset system. There is no slider or checkbox widget anywhere on this screen —
every control is plain text that changes color: grey when unselected, white
on hover, and teal-green (`0x57DEB0`) when active/selected. All ten graphics
values plus 2 audio flags are int/bool fields on the global static `SD` class
and are persisted verbatim into the SharedObject save file.

## 2. Raze 2 source of truth

### 2.1 AS3 files

| File | Role |
|---|---|
| `SD.as` (lines 71-97, 104-189, 217, 254-263, 382-403) | Declares & persists the 10 settings fields; `newGame()` sets Raze 2's shipped defaults; `saveList2` is the exact persisted-field order |
| `Menu.as` lines 389-404, 793-797, 903-906, 1420-1615, 2182-2256 | The Options screen embedded as one frame/label (`"Options"`) inside the shared `Menu` movieclip; owns `changeGraphType()`, the big button-name `switch`, and `setGraphicsText()` (repaint) |
| `PauseScreen.as` lines 242-258, 314, 350-498, 700-757 | The in-game pause-menu twin of the exact same Options UI — **byte-for-byte duplicated logic** from `Menu.as` (same field names, same case numbers, same `selCol`), confirming both are the same screen reused in two shells |
| `Status.as` lines 431, 487, 504, 528 | `SD.graphGlow` gates 3 of the 5 status-glow-filter call sites (shield/spawn/mirror auras use a heavier 3-layer `GlowFilter` stack when glow is on, a single cheap one when off) |
| `Bullet.as` lines 443, 452, 460 | `SD.graphPart` gates ground-impact splash/leaf particle spawns (also used as a literal particle-count multiplier at line 460: `while(_loc2_ < SD.graphPart)`) |
| `Bullet_Proj_Basic.as:42`, `Bullet_Proj_Bounce.as:61`, `Bullet_Proj_Follow.as:99`, `Bullet_Proj_Stick.as:56`, `Bullet_Proj_Frames.as:76` | Same `SD.graphPart` truthiness gate on trail/impact particles per projectile type |
| `Guns.as:399` | Shell-casing eject particle gated on `SD.graphPart` truthiness |
| `Stats_MapParticles.as` (10+ call sites, e.g. 374-808) | Per-map ambient particle systems (dust/leaves/snow/embers) use `SD.graphPart` both as a boolean gate and as a **direct numeric multiplier** (`graphPart1 = 2 * SD.graphPart`, `graphPart2 = 6 - SD.graphPart`, etc.) — so the 0-3 value literally scales spawn rate/count per map theme, not just an enum |
| `Arena.as` lines 1038, 1206, 1245 | `SD.graphLights` toggles dynamic point-light `visible` flags and gates whether reflection/light render passes run at all |
| `PhysVap.as:77` | `SD.graphRagev` gates the ragdoll "vaporize" effect (corpse dissolve-into-pixels transition) — off means corpses just disappear/pop instead of the particle dissolve |
| `Hud.as:187` | `SD.sblood` selects blood-screen-overlay clip frame 1 (on) vs frame 2 (off, i.e. blank) |
| `Game.as` lines 145, 219, 528 | `SD.graphQual` maps to Flash's real `stage.quality` (`"low"/"medium"/"high"` — only 3 steps, not 4, see gap below); `SD.pblur` gates whether the pause `BlurFilter` is actually applied to `bitscreen` (still computes `pauseBlur` ease each frame either way) |
| `SH.as` lines 91, 96, 116, 125, 148, 166 | `SD.sound` gates whether any `SoundChannel` plays at all; `SD.music` gates the music channel volume/fade |

### 2.2 The `SD` fields (exact names + semantics)

From `SD.as` lines 71-97 and `saveList2` (line 108):

| Field | Type | Range | Meaning |
|---|---|---|---|
| `graphType` | `uint` | 0-4 | Which **preset** is active; `0` = Custom (detail knobs set independently, no bulk apply), 1=Low, 2=Medium, 3=High, 4=Ultra. Any manual edit of a detail knob resets this to `0` (Custom) — see `Menu.as` case 0-12 all set `SD.graphType = 0` after the individual field write |
| `graphQual` | `uint` | 0-2 | **Quality** — maps directly to Flash `stage.quality` string via `UT.getEl(SD.graphQual,["low","medium","high"])` (`Game.as:145,528`). Only 3 real steps despite the Options UI showing "Low/Medium/High" as 3 words too (this one is NOT 4-way) |
| `graphPart` | `uint` | 0-3 | **Particles** — 4 steps (Low/Medium/High/Ultra). Used both as a boolean gate (`if (SD.graphPart)`) AND as a literal multiplier/divisor in ambient particle formulas (`Stats_MapParticles.as`) |
| `graphGlow` | `uint` (bool-like) | 0-1 | **Glows** — 2 steps (Off/On). Gates whether unit status auras (shield/spawn/mirror invuln) render the expensive 3-layer `GlowFilter` stack (`Status.as`) vs a single cheap fallback filter |
| `graphRagev` | `uint` (bool-like) | 0-1 | **Ragdoll evaporating** — 2 steps (Off/On). Gates the corpse "vaporize" pixel-dissolve transition (`PhysVap.as:77`) |
| `graphLights` | `uint` (bool-like) | 0-1 | **Lights & Reflections** — 2 steps (Off/On). Toggles map dynamic lights' visibility and reflection passes (`Arena.as`) |
| `sound` | `Boolean` | — | Master SFX on/off (`SH.as:91`) |
| `music` | `Boolean` | — | Music on/off, drives fade/volume (`SH.as:96-166`) |
| `sblood` | `Boolean` | — | "Bloody Screen" — full-screen blood overlay on hit (`Hud.as:187`) |
| `pblur` | `Boolean` | — | "Pause Blur" — `BlurFilter` on the game view while paused (`Game.as:219`) |

Defaults on `SD.newGame()` (`SD.as` lines 156-176): `graphType=3` (**High**), `graphQual=1`, `graphPart=2`, `graphGlow=1`, `graphRagev=1`, `graphLights=1`, `sound=true`, `music=true`, `sblood=true`, `pblur=true`. This matches text id `517`: High is "recommended."

### 2.3 The preset → detail mapping (`changeGraphType`, `Menu.as:2182-2218` / `PauseScreen.as:700-736`, identical in both)

`bt_graph_0..4` are 5 buttons; clicking `bt_graph_N` calls `changeGraphType(N)`:

| Button index N | Preset name | `graphQual` | `graphPart` | `graphGlow` | `graphRagev` | `graphLights` |
|---|---|---|---|---|---|---|
| 0 | **Custom** | *(untouched)* | *(untouched)* | *(untouched)* | *(untouched)* | *(untouched)* |
| 1 | **Low** | 0 | 0 | 0 | 0 | 0 |
| 2 | **Medium** | 1 | 1 | 0 | 0 | 0 |
| 3 | **High** | 1 | 2 | 1 | 1 | 1 |
| 4 | **Ultra** | 2 | 3 | 1 | 1 | 1 |

`SD.graphType = N` is always set first (line 2184/702), regardless of case. Note the on-screen top-to-bottom visual order (per the domain brief and blurb text ids) is **Ultra, High, Medium, Low, Custom** — the reverse of the internal button index order 0-4 (Custom..Ultra). `mc_graphbox.gotoAndStop(SD.graphType + 1)` (line 2229/747) drives a 5-frame movieclip that highlights whichever preset button is currently the "active" one (frame 1 = Custom highlighted ... frame 5 = Ultra highlighted); this box is NOT shown/updated when `graphType` is 0 in a meaningful sense — Custom stays "selected" any time a detail knob is hand-edited, since every hand-edit resets `graphType` to 0.

There is a **known inert double-write bug** at `Menu.as:2201-2202` (also `PauseScreen.as:719-720`): the Medium case sets `SD.graphLights = 0` twice in a row (harmless, but shows the source's Medium case was likely copy-pasted/edited without cleanup).

### 2.4 Button → field wiring (`Menu.as:1444-1615`, identical duplicate in `PauseScreen.as:384-492`)

Clicking any of the 21 detail-toggle text labels resolves `buttons2[i].name` to a case index 0-20, then writes the field. Every one of cases 0-12 (all 5 detail toggles) additionally sets `SD.graphType = 0` (demotes to Custom) except **Sound/Music/Bloody-Screen/Pause-Blur (cases 13-20)**, which do **not** touch `graphType` — confirming "Other Options" are outside the preset system entirely, exactly as their separate "Other Options" panel heading implies.

| Case | Button name | Effect |
|---|---|---|
| 0/1/2 | `txt_qual_low/med/high` | `graphQual = 0/1/2`, `graphType = 0` |
| 3/4/5/6 | `txt_part_low/med/high/ult` | `graphPart = 0/1/2/3`, `graphType = 0` |
| 7/8 | `txt_glow_low/high` | `graphGlow = 0/1`, `graphType = 0` |
| 9/10 | `txt_ragev_off/on` | `graphRagev = 0/1`, `graphType = 0` |
| 11/12 | `txt_lights_off/on` | `graphLights = 0/1`, `graphType = 0` |
| 13/14 | `txt_sound_off/on` | `sound = false/true` |
| 15/16 | `txt_music_off/on` | `music = false/true` (only if changed) + `SH.updateMusicVolume()` |
| 17/18 | `txt_sblood_off/on` | `sblood = false/true` (PauseScreen variant also does `game.hud.bloodscreen.gotoAndStop(2/1)` live) |
| 19/20 | `txt_pblur_off/on` | `pblur = false/true` (PauseScreen variant also live-sets/clears `game.bitscreen.filters`) |

After any of the above, `setGraphicsText()` repaints all 21 label colors and `game.arena.toggleLights()` is called (PauseScreen only — live light toggle while paused in-game; the menu-side Options screen has no arena to toggle).

### 2.5 Repaint logic (`setGraphicsText`, `Menu.as:2220-2251` / `PauseScreen.as:739-757`)

```
selCol = 0x57DEB0            // teal-green "active" color (declared PauseScreen.as:150)
inactiveCol = 0x999999        // grey (Menu.as:2222, literal 10066329)
```
Loop 1: set every tracked text label to grey (`0x999999`). Loop 2: for each of the 5 detail groups + 4 other-options toggles, `UT.getEl(fieldValue, [textfieldsInOrder]).textColor = selCol` — i.e. index into the ordered textfield array by the current numeric field value and paint only that one green. `PauseScreen.EnterFrame()` (lines 288-311) additionally does **hover-highlight**: any non-selected label under the mouse turns pure white (`0xFFFFFF`), else it stays grey — this hover behavior exists only in the in-game pause variant, not confirmed for the menu-side Options screen (its `EnterFrame`/hover code was not found beyond the shared button hit-tests already covered in §2.4).

### 2.6 Exact UI strings (from `decompiled_swf/raze 2/texts/*.txt`, DefineText tag dumps — ground truth for every visible word on screenshot #8)

| Text id | String |
|---|---|
| 513 | "Graphic Presets" |
| 514 | "Ultra" |
| 515 | "The highest settings. For only the most powerful computers!" |
| 516 | "High" |
| 517 | "For most computers (recommended)." |
| 518 | "Medium" |
| 519 | "Slightly less than High settings. Good if you experience some lag." |
| 520 | "Low" |
| 521 | "Turns off all graphics and effects. Good for low end computers." |
| 522 | "Custom" |
| 523 | "Your own custom settings." |
| 512 | "Graphic Details" |
| 524 | "Quality" |
| 525 | "Particles" |
| 526 | "Glows" |
| 527 | "Lights & Reflections" |
| 539 | "Ragdoll evaporating" |
| 528/532/535 | "Low" (repeated per-row) |
| 529/533/536 | "High" |
| 534/537 | "Medium" |
| 538 | "Ultra" (Particles' 4th step) |
| 530/540 | "Off" |
| 531/541 | "On" |
| 551 | "Other Options" |
| 509 | "Bloody Screen" |
| 542 | "Sounds" |
| 545 | "Music" |
| 548 | "Pause Blur" |
| 510/543/546/549 | "Off" |
| 511/544/547/550 | "On" |

### 2.7 Reference screenshot (#8, `image-cache/.../8.png`)

**Not available in this environment** — the file does not exist at the referenced cache path (`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\` is empty/missing). Layout below is reconstructed from the AS3 control-flow (§2.1-2.5) and exact text-tag strings (§2.6) rather than pixel-observed from the image; see §6 for what still needs a pixel pass once the screenshot is available. Reconstructed layout, left to right:

- **Left column — shared pause buttons**: the same vertical `btn_*`/`btnl_*` button stack used by every pause-screen sub-page (`Resume Game`, `View Scores`, `Options`, `Quit Game`) — see `PauseScreen.as` lines 37-121 for the full field list (`btn_Resume_Game`, `btn_Options`/`btnl_Options`, `btn_View_Scores`/`btnl_View_Scores`, `btn_Quit_Game`/`btnl_Quit_Game`). The `btnl_*` variant (alpha 0.5, frame 1, i.e. "locked/inactive-looking" per line 195-196) is shown when that label isn't the active page; the `btn_*` variant is the clickable one on the current page.
- **"Graphic Presets" column**: header text id 513, then 5 stacked buttons Ultra/High/Medium/Low/Custom (`bt_graph_0..4`), each presumably showing its one-line blurb (text ids 515/517/519/521/523) beneath or beside the name — exact sub-layout unconfirmed without the screenshot. The active preset is highlighted via the `mc_graphbox` 5-frame indicator clip (§2.3).
- **"Graphic Details" panel**: header text id 512, then 5 rows (Quality / Particles / Glows / Lights & Reflections / Ragdoll evaporating), each row a horizontal run of 2-4 words (its possible values) with the active one teal-green and the rest grey (§2.5).
- **"Other Options" panel**: header text id 551, then 4 rows (Sounds / Music / Bloody Screen / Pause Blur), each an Off/On word-pair, same green/grey scheme.
- **Colors**: active/selected word = `0x57DEB0` (teal-green, `selCol`, `PauseScreen.as:150`); inactive word = `0x999999` (grey, `Menu.as:2222`/`PauseScreen.as:744`); inactive word under mouse hover = `0xFFFFFF` (white, `PauseScreen.as:302`).

## 3. Current port state

### 3.1 `src/state/Quality.ts`

A from-scratch reinterpretation, **not a field-for-field port of `SD`'s 10 values**. It defines a single 4-step `QualityLevel` (`"low"|"medium"|"high"|"max"`) that drives derived engine knobs invented for the TS renderer (`particleScale`, `detail`, `maxFx`, `tracerLife`, `maxFps`, `stageQuality`) — none of which exist in the SWF (Raze 2 never had an FX-object cap or a renderer FPS cap; those are TS-port-only concepts, per the file's own doc comment lines 1-26). It has no equivalent of `graphPart` (particles), `graphRagev` (ragdoll evaporating), or `graphLights` (lights & reflections) as independent fields — `detail`/`glow` collapse several Raze 2 knobs into fewer derived ones.

### 3.2 `src/state/SD.ts`

Persists only `qual: QualityLevel` (line 93) and `noGlow: boolean` (line 96) — i.e. **2 of the 10** Raze 2 graphics/audio fields are modeled with real persisted state (`setQuality()`/`setNoGlow()`/`applyQuality()`, lines 232-268). `sound` (line 84) and `music` (line 89) exist and persist (`save()` lines 471-498) but are **hardcoded to `true` on every `load()`** (lines 451-452) — the saved boolean is read into `data.sound`/`data.music` but then immediately overwritten, so a saved "sound off" never survives a reload. There is no persisted `sblood`, `pblur`, `graphPart`, `graphRagev`, `graphLights`, or `graphType` (preset) field anywhere in `SD.ts`.

### 3.3 `src/screens/OptionsScreen.ts`

Already restyled to the Raze 2 look (Raze2Panel/Raze2Toggle/Raze2Button kit, teal-green `0x57DEB0` accent — matches §2.5 exactly) and already lays out the 3-panel structure (Graphic Presets / Graphic Details / Other Options, lines 64-66) with the right row labels (Quality/Particles/Glows/Lights & Reflections/Ragdoll evaporating, Sounds/Music/Bloody Screen/Pause Blur — lines 211-273). However:

- **Presets are only 4, not 5** (`PRESETS` array, lines 36-41: Ultra/High/Medium/Low) — **Custom is a no-op button** (line 176-181, `onClick: () => Sound.play(...)` — does not set any state, has no persisted `graphType`, and is never auto-selected when the user hand-edits a detail toggle, unlike the source's auto-demote-to-Custom behavior in §2.3-2.4).
- **Preset → detail mapping only touches quality+glow** (`applyPreset`, lines 188-195: `SD.setQuality(qual)` + `SD.setNoGlow(!glow)`), not the 3 other knobs (particles/lights/ragdoll), because those knobs don't exist in `SD.ts` yet.
- **Particles, Lights & Reflections, Ragdoll evaporating, Bloody Screen, and Pause Blur toggles are all cosmetic-only local instance fields** (`this.particles`, `this.lights`, `this.ragev`, `this.sblood`, `this.pblur` — lines 51-55) that reset to their hardcoded defaults every time the screen is re-opened and are never read by any renderer/gameplay code. The file's own doc comment (lines 30-33) states this plainly: "the remaining detail toggles are surfaced for parity and held in local state until the settings model is extended in a later wave."
- **Preset values differ from Raze 2's** in the Quality/Glow split: port's Low preset sets `glow: false` and Medium/High/Ultra all set `glow: true` (lines 37-40) — Raze 2's actual mapping (§2.3) turns glow on starting at **High**, not Medium (Low=off, Medium=off, High=on, Ultra=on).
- No mapping exists from `graphQual` (0-2, 3 steps) to a Flash-style `stage.quality`; the port's Quality.ts `stageQuality` field (4 steps: low/medium/high/best) is a different scale from the source's true 3-step `stage.quality` (`Game.as:145`, `["low","medium","high"]`).
- No hover-to-white behavior is confirmed absent/present — `Raze2Toggle.ts` (lines 62-69, 104-110) DOES implement the grey/white-hover/green-selected 3-state paint, matching §2.5's `PauseScreen.EnterFrame` hover logic faithfully, better than the naive port of the other fields.

## 4. Gap analysis

| # | Raze 2 target | Port today | Gap |
|---|---|---|---|
| 1 | 5 presets: Custom, Low, Medium, High, Ultra, each bulk-writing 5 fields (`graphQual/graphPart/graphGlow/graphRagev/graphLights`) | 4 presets (no Custom logic), each writing only 2 fields (`qual`, `noGlow`) | Missing: Custom preset semantics (auto-demote on manual edit), 3 of 5 bulk-set fields (particles/ragdoll/lights) |
| 2 | `graphType` (0-4) persisted, drives `mc_graphbox` highlight frame and demotes to Custom on any manual field edit | No `graphType`/preset-selection field persisted at all; no highlight state; no demote-on-edit | Full field + auto-demote behavior missing |
| 3 | `graphQual` 0-2 → real `stage.quality` low/medium/high | `qual` is a 4-step enum low/medium/high/max mapped to low/medium/high/best | Scale mismatch (3 vs 4 steps); needs realignment or documented intentional deviation |
| 4 | `graphPart` 0-3, gates AND scales particle counts across ~15 call sites (bullets, shells, ambient map particles) | No persisted particles field; `Fx`/particle code (if any) not wired to a Raze-2-accurate 0-3 scalar | Whole particle-quality axis unimplemented as a persisted/gameplay-affecting setting |
| 5 | `graphGlow` 0-1, gates 3-layer vs 1-layer `GlowFilter` stack on unit status auras (`Status.as`) | `noGlow` exists and persists, but default preset glow cutover is at Medium in the port vs High in the source | Off-by-one preset tier; also unclear whether the port's glow flag actually branches the aura *rendering complexity* (3-layer vs 1-layer) the way `Status.as` does, or just toggles glow filters generically |
| 6 | `graphRagev` 0-1, gates ragdoll "vaporize" dissolve effect (`PhysVap.as:77`) | Not modeled | Entire ragdoll-evaporation setting + behavior missing |
| 7 | `graphLights` 0-1, gates dynamic light visibility + reflection pass (`Arena.as`) | Not modeled | Entire lights/reflections setting + behavior missing |
| 8 | `sblood` persisted, gates blood-screen overlay clip frame (`Hud.as:187`) | Local instance field only, never persisted, never wired to any HUD blood-screen effect | Persistence + gameplay wiring missing |
| 9 | `pblur` persisted, gates pause `BlurFilter` (`Game.as:219`) | Local instance field only, never persisted, never wired to the port's pause screen (if a `BlurFilter`/dim equivalent exists there) | Persistence + gameplay wiring missing |
| 10 | `sound`/`music` persisted booleans, actually gate `SH.as` sound/music playback | Persisted fields exist in `SD.ts` but are hardcoded `true` on every load (lines 451-452), defeating persistence | Bug: saved off-state is discarded on reload |
| 11 | Options screen exists both as a Menu sub-page and as a byte-identical Pause-menu sub-page (in-game); pause variant additionally live-applies sblood/pblur/lights changes immediately (`game.hud.bloodscreen...`, `game.bitscreen.filters`, `game.arena.toggleLights()`) | Only one `OptionsScreen.ts` found under `src/screens`; unclear whether an equivalent options page is reachable from the port's in-game pause screen, or whether live-apply-while-paused behavior exists | Needs check against the pause-screen doc (12) for whether Options is reachable from pause and whether toggles apply live mid-match |
| 12 | Exact preset blurb copy (text ids 515/517/519/521/523) shown per preset button | Port's `Raze2Button` presets show only the preset name (`"Ultra"`, `"High"`, etc.), no blurb text found in `buildPresets()` | Missing descriptive blurb text under/beside each preset button |
| 13 | Screenshot reference #8 exists per the domain brief | File is absent from the image-cache directory in this environment | Pixel-level layout (exact column widths, spacing, panel positions, font sizes) could not be visually verified; §2.7 layout is inferred from AS3 control flow + text strings only |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Extend `src/state/SD.ts` with the 5 missing persisted fields: `graphType: number (0-4)`, `graphPart: number (0-3)`, `graphRagev: boolean`, `graphLights: boolean`, `sblood: boolean`, `pblur: boolean` (6 fields; `sblood`/`pblur` already exist as OptionsScreen locals — promote them). Include them in `save()`/`load()` (mirror the existing `qual`/`noGlow`/`sound`/`music` pattern at lines 446-461, 478-483).
2. Fix the `sound`/`music` reload bug: `load()` lines 451-452 currently hardcode `true`; change to `this.sound = data.sound ?? true; this.music = data.music ?? true;`.
3. Add a `graphType` (preset) concept to `SD.ts`: `setPreset(n: 0|1|2|3|4)` that bulk-writes the 5 detail fields per the table in §2.3, and a `demoteToCustom()` (or inline `graphType = 0`) called by every individual detail-field setter (mirroring `Menu.as` cases 0-12 all writing `SD.graphType = 0`). Sound/Music/Bloody-Screen/Pause-Blur setters must NOT touch `graphType` (cases 13-20 in source don't).
4. Re-tier `OptionsScreen.ts`'s `PRESETS` table (or replace with `SD.setPreset(n)` calls) to match §2.3 exactly: Low sets glow OFF, Medium sets glow OFF (currently port has Medium glow ON — bug per gap #5), High/Ultra set glow ON. Add the true 5th preset "Custom" that is auto-selected (no explicit click needed) whenever any individual detail knob changes, and shows no bulk-apply of its own.
5. Wire `graphPart` into the particle/effects system: audit `Fx`-equivalent code for the port and add a `Quality`-derived (or direct `SD.graphPart`) scalar to ambient/impact particle counts, matching the boolean-gate + numeric-scalar dual usage in `Bullet.as`/`Stats_MapParticles.as` (§2.1). Decide whether to keep the port's separate `Quality.particleScale` derived system or make it a pure function of `SD.graphPart`.
6. Wire `graphLights` into whatever the port's arena/map lighting system is (search for dynamic point lights / reflection draws) — toggle visibility per `Arena.as:1038,1206,1245`.
7. Wire `graphRagev` into the port's ragdoll/corpse-cleanup code (equivalent of `PhysVap.as`) — when off, corpses should NOT play a dissolve/vaporize effect (simplify to instant removal or a plain fade).
8. Wire `sblood` into the port's HUD blood-screen overlay (equivalent of `Hud.as:187`) and `pblur` into the port's pause-screen blur/dim effect (equivalent of `Game.as:219` — a `BlurFilter`-like effect while paused). If the pause screen doesn't have a blur mechanism yet, note it as a dependency on doc 12 (`12-pause-scores.md`).
9. Add the preset blurb copy under each `Raze2Button` in `buildPresets()`: "The highest settings. For only the most powerful computers!" (Ultra), "For most computers (recommended)." (High), "Slightly less than High settings. Good if you experience some lag." (Medium), "Turns off all graphics and effects. Good for low end computers." (Low), "Your own custom settings." (Custom) — exact strings from §2.6.
10. Confirm/port the hover-to-white detail-toggle interaction against `PauseScreen.as:294-311`'s per-frame mouse hit-test (the port's `Raze2Toggle` already does an event-driven equivalent via `pointerover`/`pointerout` — verify parity, no polling loop needed given Pixi's event model).
11. Confirm whether the port's Options screen is reachable from an in-game pause menu (not just the main menu) and whether pause-context toggles apply live (blood overlay, pause blur, lights) the way `PauseScreen.MouseDown` case "Options" does (`game.hud.bloodscreen.gotoAndStop(...)`, `game.bitscreen.filters = [...]`, `game.arena.toggleLights()`) vs the menu-context screen which has no live game to touch. Cross-reference doc `12-pause-scores.md` once written.
12. Once reference screenshot #8 becomes available, do a pixel pass over panel widths/positions/spacing/fonts and correct `OptionsScreen.ts` layout constants (currently hand-guessed panel sizes 300×380/280×380 etc., lines 154/200/245) against the real image.

## 6. Open questions / data still missing

- **Reference screenshot #8 is missing from the environment** (`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\` does not exist / is empty). All layout claims in §2.7 are inferred from AS3 code + text-tag strings, not pixel-observed. A future pass with the actual image must re-verify exact panel positions, blurb placement (under vs beside each preset button), font sizes, and whether preset buttons show a thumbnail/icon in addition to text.
- Whether `mc_graphbox`'s 5-frame highlight clip renders as a colored box behind the preset buttons, a border, a checkmark, or something else is unconfirmed — only the `gotoAndStop(SD.graphType + 1)` driver code was found, not the clip's visual content (would require an FFDec render of symbol `mc_graphbox` from `raze-2.swf`).
- Whether the menu-side `Options` page (inside `Menu.as`) has the same per-frame mouse-hover repaint as `PauseScreen.EnterFrame` (lines 288-311) could not be confirmed — no equivalent `EnterFrame`-driven hover block was found scoped to `Menu.as`'s `"Options"` label in the portion of the 2644-line file inspected; worth a targeted re-check if hover-in-menu behavior ever looks wrong.
- Exact pixel sizes/fonts for the preset blurb text (below the preset name) — text ids found (515/517/519/521/523) but their `TextField` symbol IDs / font/size were not traced.
- No AS3 evidence of a "Ultra" step for `graphQual` (the Quality row only ever has 3 words per §2.6 ids 528/532/535/529/533/536/534/537 — three "Low/High/Medium" triples corresponds to Quality(3), Particles(4, includes "Ultra" id 538), Glows(2), Lights(2), Ragdoll(2) — i.e. only **Particles** has a 4th "Ultra" tier; Quality genuinely tops out at "High" with only 3 steps, confirming §2.2's `graphQual` range of 0-2). This is a real, source-accurate asymmetry (Quality has fewer steps than Particles) worth preserving rather than "fixing" in the port.
