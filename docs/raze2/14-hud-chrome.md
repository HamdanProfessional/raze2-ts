# 14 — HUD + Chrome (Pause / Options / Scores) — Raze 2

Source of truth: decompiled `raze 2/scripts/*.as` (behaviour) cross-checked against
`raze 2/scripts/_assets/assets.swf` (geometry/colour, dumped with FFDec `-swf2xml`).
All Hud/PauseScreen/ScoreBoardBar/Unit visuals live in **`_assets/assets.swf`**, not
`raze-2.swf` — every class below carries `[Embed(source="/_assets/assets.swf", symbol="symbolN")]`,
and `symbolN` maps to a numeric character ID via `scripts/symbolClass/symbols.csv`
(e.g. `symbol1568` → character **1568** → `Hud`). All twip coordinates from the
swf2xml dump are converted to pixels by `/20`; the stage is **800×600**.

Font families found in `fonts/` and confirmed by `DefineEditTextTag.fontId` lookups:

| Font file | Used for |
|---|---|
| `465_BlairMdITC TT.ttf` (**BlairMdITC TT**, serif, small-caps look from all-caps labels) | Pause-menu button labels ("Resume Game", "View Scores", …), scoreboard headers |
| `1433_QTypeSquare-Book_11pt_st.ttf` / `442/444/1441/1484/1499_QTypeSquare-*` | HUD numeric read-outs (ammo "x2" multiplier, clip count, credits, timer, scores) — a squarish grotesque, the main "sci-fi HUD" font |
| `557/564/566/50_QTypeSquare-Bold_*` | HUD headers / large digits (kill-feed, big numbers) |
| `1811/1814_Calibri_*`, `1865_Consolas.ttf` | Debug/FPS overlay text only (not player-facing) |

---

## 1. In-game HUD (`Hud.as`, symbol **1568**, embed class `Hud`)

`Hud` is built once per match (`Hud(param1:Game)`, `Hud.as:152`) and owns every
on-screen element below. Layout below is the frame‑1 placement of symbol 1568,
in pixels, top-left origin of the 800×600 stage.

### 1.1 Health / Shield / Ammo cluster (bottom-left, ~x:60‑300, y:540‑600)

| Element | Instance | Position (px) | Notes |
|---|---|---|---|
| Heartbeat/health readout | `heartbeat` (MovieClip, char 1467) | x≈134, y≈550 | Animated ECG/oscilloscope-style clip. `Hud.setHeartBeat()` (`Hud.as:609-627`) selects a labelled frame — `"empty"` (hp=0), `"low"` (hp<0.35), `"half"`, `"full"` (hp≥0.71) — i.e. **the waveform itself is the EKG strip**, not a separate graph. |
| Health % text | `heartbeat.txt_health` | inside heartbeat clip | `heartbeat.txt_health.text = Math.ceil(hp) + "%"` (`Hud.as:363`) |
| Health tint | dynamic `ColorTransform` on `heartbeat` | — | `Hud.setHealth()` (`Hud.as:340-364`): red channel = `hp<=0.5 ? 255 : (1-hp*2)*255`, green = `hp>=0.5 ? 255 : hp*2*255`, blue fixed **80 (0x50)** — a continuous green→yellow→red ramp, e.g. full health ≈ `#00FF50`‑ish, mid ≈ `#FFFF50`, critical ≈ `#FF0050`. |
| Shield bar | `bar_shield` (char 44, generic rect) | x≈123, y≈583 | `bar_shield.height = shPerc * 33` (`Hud.as:356`) — **vertical** bar, max height 33px. Baked tint add = `(255,255,0)` → **`#FFFF00` yellow**, not blue. |
| Energy bar | `bar_en` (char 44) | x≈134, y≈578 | `bar_en.width = enPerc * 130` (`Hud.as:369`) — horizontal, max width 130px. Baked tint add = `(204,153,255)` → **`#CC99FF` lavender/purple** (used by classes with an energy-cost ability). |
| Blood-screen overlay | `bloodscreen` (char 1431, full-stage) | x=400, y=284.5 (centred) | `bloodscreen.alpha = (0.4 - hp*0.4) * 0.8` (`Hud.as:354`), i.e. fades in as health drops, alpha=1 at hp=0 (`Hud.as:350`). Mirrored randomly each `reset()` (`Hud.as:276-277`). Frame 1/2 = on/off per `SD.sblood` option. |

**There is no separate "EKG strip beside the bar"** in Raze 2 — the heartbeat monitor
*is* the health widget (animated waveform + tinted colour + % text all in one MovieClip).

### 1.2 Ammo readout (clip multiplier + segmented reserve bar)

Reference shape **char 1448** (the ammo-panel background, see §5 "shared panel style"):
dark radial gradient fill **`#2B2B2B → #000000`**, 1px black stroke, ~166×33px box
at local (56,34)–(264,66) inside the weapon-holder clip.

| Element | Instance | Notes |
|---|---|---|
| Clip text | `txt_clip` | x≈72, y≈550. Shows current-clip count as plain text. |
| Multiplier label | inside char 1449 (`DefineEditTextTag`) | Example baked string `"x2"`, font **QTypeSquare-Book 11pt**, color `#CCCCCC`. |
| Reserve-ammo bar | `bar_ammo0..3` (char 44 ×4) | `Hud.setAmmoBar()` (`Hud.as:451-552`) splits the reserve into **1–4 horizontal segments** depending on max reserve (`>25`→2 segs, `>50`→3, `>75`→4), each segment max 58px wide, 14px tall. Segment count is why the task brief calls this "segmented" — the segments represent whole reload-clips of reserve ammo, not shield pips. |
| Segment tick lines | `ammoOutline` (Graphics, drawn at runtime) | `Hud.as:486-509`: `lineStyle(1, 0x333333, 1)` — dark-grey 1px divider lines drawn between segments and as the 14px-tall outline box. |
| Fill colour | all 4 bars share tint add `(255,255,255)` | **`#FFFFFF` white** ammo fill (baked; not team/health colour). |

### 1.3 Weapon loadout strip (bottom, 7 slots)

`Hud_WeaponHolder.as` (symbol **1447**, embed class `Hud_WeaponHolder`) is
instantiated 7× as `gun0..gun6` (`Hud.as:36,46,52,106,112,114,118`), laid out
left→right with **65px pitch**, y≈569:

| Slot | x (px) | Slot | x (px) |
|---|---|---|---|
| gun0 | 365 | gun4 | 625 |
| gun1 | 430 | gun5 | 690 |
| gun2 | 495 | gun6 | 755 |
| gun3 | 560 | | |

Each `Hud_WeaponHolder` (per swf2xml, char 1447 sprite, `hud_sprite` dump) contains:

- `highlight` (child MC, char 1439) — the slot's highlight/selection frame, `gotoAndStop(1)` = off by default (`Hud.as:173`).
- `weapon` (child MC, char 1003) — the weapon glyph, rotated **‑23.4°** (`rotateSkew0=-0.408`) and scaled 0.951 to fit the slot icon.
- `txt_num` — the 1‑based slot number ("1".."7"), set once at HUD build (`Hud.as:172`).
- `bar_ammo` (char 44) — a small in-slot clip-fill bar, tinted by `colTransOff`/`colTransOn`.

Selection state (`Hud.setMiniAmmoBars()`, `Hud.as:554-607`):

- **Unselected slot**: `bar_ammo.transform.colorTransform = colTransOff` → colour **`#CCCCCC`** (light grey), and `weapon.alpha = 0.3` if that weapon's ammo is exhausted, else `1`.
- **Selected slot**: `bar_ammo.transform.colorTransform = colTransOn` → colour **`#FFFF00` yellow** (`Hud.as:176-184`) — this is the canonical "selected-slot yellow highlight" called out in the task; it is a **fill tint on the mini ammo bar**, not a separate glow border sprite (there's no dedicated glow color/border applied via ActionScript, only a `highlight` clip whose contents come from the FLA, frame 1 = "off").
- Slot bar-fill formula: `width = (ammo.cur + ammo.clip*clipSize) / (clipMax*clipSize) * 56px` — reflects total remaining ammo including the current clip, out of a 56px-wide track.

### 1.4 Credits / points bar (right side, y≈586-600)

| Element | Instance | Position | Behaviour |
|---|---|---|---|
| Wallet total | `txt_points` | x≈715, y≈586 | `"cr"` suffix, format via `UT.addNumCommas` (`Hud.as:717`) |
| Earned this match | `txt_pointsearn` | x≈37, y≈586 | Same format, running match total (`Hud.as:718`) |
| "+N" popup | `display_num` | x≈401, y≈145 | Plays a short animation (`gotoAndPlay(2)`) each time credits are earned (`Hud.as:435-449`); also multiplies by `MatchSettings.creditMod`. |
| Bonus text popup | `display_text` | x≈404, y≈117 | e.g. "First Blood"-style strings, `display_text.txt_text.text` |
| Cyan glow bar (char 1478) | two instances, one per popup | scaleX 0.362 | `GLOWFILTER` blur (7,7) strength 1, colour `#00CCCC`-ish — a soft glow strip under the credit popups. |

The task's example string **"X1 / 100% / Earned / Credits / Total. 597 cr"** maps onto
`txt_clip` (clip count "X1"‑style via the multiplier text), `bar_ammo` (percentage bar),
`txt_pointsearn` ("Earned"), and `txt_points` ("… cr" total) — there is **no single
composited "Earned / Credits / Total" line**; they are three independent text fields.

### 1.5 Score / gametype header (top, y≈380-510)

| Element | Position | Notes |
|---|---|---|
| `txt_time` (clock) | x≈363, y≈19 | Black `GLOWFILTER` (blur 3, strength 2) — **every top HUD text field uses this same black glow-outline**, giving the "etched on glass" look. |
| `txt_gametype` / `mc_gametype` | x≈623/638, y≈484/494 | Game-mode name + icon |
| `txt_playerscore` / `txt_enemyscore` | x≈449/448, y≈494/507 | `Hud.setScore()` (`Hud.as:372-433`). Colours: solo/FFA player text = **`#FFFF99`** pale yellow; on a team, player text = **`#A3CFFF`** pale blue. Opponent text colour indexed by team: `["FFA"=#FFFFFF, "Blue"=#A3CFFF, "Orange"=#FF9966, "Yellow"=#FFFF99, "Green"=#99FF99]` (`Hud.as:412`). Leading text gets a `"> "` prefix to mark whoever is ahead (`Hud.as:415-422`). |
| `scorebars` (MovieClip) | x≈765.5, y≈507.6 | Two masked fill bars (`bar1`/`bar2`), width driven by `score / winScore * 124px` (`Hud.as:425-431`) — a horizontal race-to-target progress bar per side, frame-swapped per team colour via `gotoAndStop`. |
| `flag1/2/3` (CTF flags or Domination points) | x≈670/714/758, y≈442 (spacing 44px) | `setFlags()` (`Hud.as:235-272`) drives frame labels `"ctf1"/"ctf1gone"` or `"dom0..dom4"`. |
| `txt_flagscore` | x≈621, y≈420 | "Your flag was taken!" / "Points: N per 3 sec" style status text. |

### 1.6 Kill feed (bottom-left log)

`feedbox` (MovieClip) anchored at x≈‑4, y≈545, growing **upward** as entries are
added (`Hud.as:702-710`, `feedOY`/`feedToY` tween). `addKillFeed()` (`Hud.as:721-760`)
builds a 3-part coloured string `"{victim} ({weapon})> {killer}"`:

| Segment | Colour rule | Hex |
|---|---|---|
| Name, same team as local player | — | `#99FFFF` cyan |
| Name, enemy team | — | `#FF9999` salmon |
| Name, is the local player | — | `#33FFFF` bright cyan |
| Weapon name / separator | always | `#CCCCCC` grey |
| Suicide line | special-cased, uses `#FF99FF` pink for the "Suicide" keyword | `Hud.as:748-751` |

Feed caps at **13 visible lines** (`Hud.as:780`), 15px line height, and
`addCustomFeed()` is used for non-kill lines (e.g. "X has become the Juggernaught!",
`Unit.as` calls into it).

### 1.7 Message/announcer box (`mc_msg`, top-left, x≈269/44, y≈65/38)

Shows the killer's portrait (head/body/arm set to the correct skin frame) plus
`txt_name` / `txt_msg`, used for campaign story beats (`setCampMsg`) and
kill-quips (`setMsg`, `Hud.as:286-338`). Not a generic "streak banner" system —
Raze 2 has **no dedicated multi-kill streak banner widget**; multi-kill/bonus
credit is instead shown via the **`KillPoints`** world-space floating popup
(`KillPoints.as`, symbol 446) that appears at the kill location with bonus labels
sourced from `Stats_KillBonuses` (e.g. `"Headshot!"`, `"Assassin!"`, `"Direct Hit!"`,
full list `Stats_KillBonuses.as:29-60`+). The corner HUD's `display_text`/`display_num`
(see §1.4) is the closest thing to a "streak" indicator, purely showing `+credits`.

### 1.8 Crosshair (`Aimer.as`, symbol 1571)

Single reusable 4-line open-cross reticle (`line1..line4`), **not per-weapon art**.
`Player.EnterFrame()` (`Player.as:120-151`) recentres it on the mouse every frame and
dynamically spreads the four line segments outward based on the current gun's
`dynRecoilMod` and the angle between aim and actual bullet direction — i.e. the
crosshair **bloom widens with recoil/spread**, shared for all weapons, hidden during
non-gameplay states (`Game.as:477/515` toggle `aimer.visible`) and parked off-stage
(`x=y=-5000`) while the unit using it is dead (`Unit.as:346-347`).

### 1.9 Minimap / radar / damage indicator

**None exist in Raze 2.** There is no minimap script, no radar class, and no
screen-edge damage-direction indicator anywhere in `scripts/` (confirmed by
exhaustive grep for `radar|minimap|damage.*indicat`). The only "spatial awareness"
aid is `navarrow` — a small per-unit arrow (`Unit.as:47? / focusArrow()`,
`Unit.as:407-417`) used to point at an objective/flag-carrier, attached to the
unit's own nameplate, not a HUD-corner radar.

---

## 2. Per-unit nameplate / health bar (over player and AI heads)

This is the "segmented player bar (blue) / alien bar (orange)" from the brief.
It lives on **every `Unit`** (symbol **73**, `Unit.as:37-38`), not just the corner
HUD, and is what you see floating above both the local player and every AI/enemy.

Layout (local coords relative to the unit's registration point, y negative = above head):

| Child | y (px) | Notes |
|---|---|---|
| `txt_name` | ‑97 | Name label, black `GLOWFILTER` (blur 3, strength 3) matching the HUD's glow-outline convention. |
| `backbar_hp` | ‑95.3 | The **back track** — team-coloured, dark/desaturated variant (see table). |
| `bar_hurt` | ‑95.3 (same slot) | A **red damage-flash sliver** (`#FF0000`, `Unit.as` char 48) that eases toward `bar_hp`'s width at 5%/frame (`Status.as:384` `bar_hurt.width += (bar_hp.width - bar_hurt.width) * 0.05`) — the classic "recently lost HP" trailing chip effect. |
| `bar_hp` | ‑95.3 | Front bar, bright team colour, `width = hpCur/hpMax * 75px` (`Status.as:379`, `bar_width = 75` at `Status.as:103`). |
| `bar_en` | ‑87.65 | Ability-energy bar, baked colour ≈ `#FF66FF` magenta/pink, `width = enCur/enMax * 75px` (`Status.as:385`). |
| `navarrow` | ‑42 | Objective-pointer arrow, hidden unless `focusArrow()` is set. |

Team colour table (`Unit.as:240-255`, applied in `changeTeam()` at `Unit.as:417-448`):

| Team | Front bar (`bar_hp`) | Back bar (`backbar_hp`) |
|---|---|---|
| 0 / 4 (FFA / no-team) | `#00FF00` green | `#006600` dark green |
| 1 (Blue) | `#00CCFF` cyan-blue | `#003399` navy |
| 2 (**Orange/"alien"/enemy AI**) | `#FF9900` orange | `#663300` brown |
| 3 (Yellow) | `#FFFF00` yellow | `#996600` olive |

So the brief's "blue player bar / orange alien bar" corresponds exactly to **team 1
vs team 2** here — bars are **not visually segmented into pips** in the FLA (no tick
marks like the ammo bar); they are continuous fills whose width is driven by
health fraction, with the red `bar_hurt` sliver providing the only "layered" look.
There is a full-bar backing plate (`character 42`, depth 1, ~104×83px at that scale)
behind all of this providing a subtle background panel.

---

## 3. Pause menu (`PauseScreen.as`, symbol **562**, embed class `PauseScreen`)

A single 288-frame timeline with frame *labels* acting as sub-screens (not
separate classes): `"Start Pause"` (main pause buttons), `"View Scores"`,
`"Options"`, `"Quit Game"`, `"gamedone"` (victory/defeat), `"countdown"`.
`gotoAndStop(label)` navigates between them (`PauseScreen.as:517-518`).

### 3.1 Button art & interaction model

`init()` (`PauseScreen.as:153-258`) scans `numChildren` for instance names starting
with `"btn"`:

- `btn_*` → **active** button: label text set from the name (`"btn_Resume_Game"` → `"Resume Game"`), pushed into the `buttons` array, `gotoAndStop(1)` (frame 1 = "up"/idle state).
- `btnl_*` → **locked/disabled-look** button (e.g. sponsor tie-ins): same label extraction, but `alpha = 0.5` and **not** added to the interactive `buttons` array.

Each button clip has states as frame *labels*, driven every frame in `EnterFrame()`
(`PauseScreen.as:260-287`):

```
"up"  --hitbox.hitTestPoint--> gotoAndPlay("over")   // hover-in
"on"  --!hitbox.hitTestPoint--> gotoAndPlay("out")   // hover-out
```

i.e. each button is its own small state-machine movie clip with an internal
`hitbox` child defining the clickable region, and `over`/`on`/`out` animation
segments (a built-in crossfade/slide, not scripted tweening) — this is the
"hover glow" transition. Label text field is `txt_word`
(font **BlairMdITC TT**, `fontHeight=400` twips = **20pt**, all labels found in the
swf carry this font, confirmed via `DefineEditTextTag characterID=466 fontId=465`
for the "Resume Game" string). Two alpha variants exist baked into the font glyphs:
**`alpha=204` (≈80%)** for the normal "up" label and **`alpha=102` (≈40%)** for a
dimmer variant (locked/secondary buttons) — consistent with the `alpha=0.5` set on
`btnl_*` clips in code.

Background/glass treatment (from the swf2xml dump of chars 463/464, placed at
depth 1/2 on the `"Start Pause"` frame):

- **char 463**: a `DefineMorphShapeTag` full-stage rect (800×600) that morphs
  fill alpha from `0 → 102/255 (~40%)`, colour black — i.e. a **fade-to-40%-black
  overlay** used as the screen's dim/backdrop transition when entering pause.
- **char 464**: four soft radial-gradient rectangles anchored at the stage
  corners, alpha ramps `153→102→0` (`60%→40%→0%`) black — a **vignette** darkening
  the corners of the pause backdrop.

No unique per-button "coloured left accent bar" asset was located in the symbol
dump within the time available — the only per-button colour differentiation
confirmed from `AS` is the shared `selCol = 0x57DEB0` (teal-green) used for
**Options** toggle state, not button accents (§4). **Action item for implementers:**
open `PauseScreen` symbol 562 directly in FFDec's GUI and inspect the individual
`btn_Resume_Game` / `btn_Quit_Game` library symbols frame-by-frame to capture the
exact accent-bar colour per action (this doc's automated dump could not isolate
child-symbol art cheaply — see Port status).

### 3.2 Button roster & actions (`MouseDown()`, `PauseScreen.as:314-523`)

| Label | Action |
|---|---|
| Resume Game | `game.togglePause()` |
| View Scores | `gotoAndStop("View Scores")` |
| Options | `gotoAndStop("Options")` |
| Quit Game | `gotoAndStop("Quit Game")` |
| Yes (on Quit confirm) | `destroy(true)` — logs a rage-quit metric, ends match |
| No (on Quit confirm) | `gotoAndStop("View Scores")` |

`gamedone` frame (victory/defeat, reached automatically at match end) shows
`"Victory!"`/`"Defeat!"` in `txt_title` plus a credit bonus
(`UT.rand(8,13)`, ×5 if won, `PauseScreen.as:213-231`) in `txt_credits`, then calls
`displayScoreBars()` — same as View Scores.

---

## 4. Options screen (frame label `"Options"`)

Built from the generic `txt_*` children collected into `buttons2`
(`PauseScreen.as:243-256`), each acting as a **toggle label** (not a checkbox
widget) — clicking directly sets an `SD.*` flag and recolours:

| Category | Options (`txt_*` pairs) | Backing flag |
|---|---|---|
| Graphic Presets | `bt_graph_0..4` (Low/Med/High/Ultra/Custom buttons, `SimpleButton`) | `changeGraphType()` (`PauseScreen.as:700-737`) bulk-sets Quality/Particles/Glow/Ragdoll/Lights per preset |
| Quality | `txt_qual_low/med/high` | `SD.graphQual` (0/1/2) |
| Particles | `txt_part_low/med/high/ult` | `SD.graphPart` (0-3) |
| Glows | `txt_glow_low/high` | `SD.graphGlow` (0/1) |
| Ragdoll evaporating | `txt_ragev_off/on` | `SD.graphRagev` |
| Lights & Reflections | `txt_lights_off/on` | `SD.graphLights` |
| Sounds | `txt_sound_off/on` | `SD.sound` |
| Music | `txt_music_off/on` | `SD.music` (also calls `SH.updateMusicVolume()`) |
| Bloody Screen | `txt_sblood_off/on` | `SD.sblood` (also flips `game.hud.bloodscreen`) |
| Pause Blur | `txt_pblur_off/on` | `SD.pblur` (applies/removes a `BlurFilter(pauseBlur,pauseBlur,3)` on `game.bitscreen`) |

Any change to graphics options calls `game.arena.toggleLights()`
(`PauseScreen.as:494/736`) to apply live.

**Colour rule** (`setGraphicsText()`, `PauseScreen.as:739-757`, and the hover
handler at `PauseScreen.as:294-310`):

| State | Colour |
|---|---|
| Selected/active option | **`selCol = #57DEB0`** (teal-green) — this is the closest thing to the task's "green on/off toggle" |
| Unselected, mouse not over | `#999999` grey |
| Unselected, mouse hovering | `#FFFFFF` white |

So the "toggle" is implemented purely as **text-colour swapping between two/three/four
plain-text labels side by side** (e.g. "Off   On", the active word turns teal-green),
not a switch/checkbox graphic — there is no separate on/off pill sprite to extract.

---

## 5. View Scores (`ScoreBoardBar.as`, symbol **462**, embed class `ScoreBoardBar`)

Built by `PauseScreen.displayScoreBars()` (`PauseScreen.as:525-697`), one
`ScoreBoardBar` instance per row, stacked at **30px row pitch** starting `y=-30+30`,
added into `barsCont`.

Constructor signature: `ScoreBoardBar(isHeader, y, teamFrameLabel, pos, name, score, kills, deaths, iconFrame="None")`.

| Column (TextField) | Meaning |
|---|---|
| `txt_pos` | Rank number (`#`) |
| `txt_name` | Player/team name |
| `txt_score` | Score (or "Lives" header in Elimination mode) |
| `txt_kills` | Kills |
| `txt_deaths` | Deaths |
| `mc_skull` | Status icon, frame = `iconFrame`: `"None"`, `"Juggernaught"`, `"Domination"` (on a hold point / defending flag), `"Deathmatch"` (dead → **the skull marker**), `"Capture the Flag"` (carrying flag) |

Row colouring/state:

- `gotoAndStop(teamFrameLabel)` selects the row's background art by label —
  `"h0".."h4"` for header rows (one per team) and `"p{team}"` / `"a{team}"` for
  player/AI rows (`ScoreBoardBar.as:43`) — i.e. **row background frames are keyed
  by team number**, using the same team-colour language as §2 (team1=blue,
  team2=orange, team3=yellow, team0/4=FFA green).
- AI (non-human) rows are dimmed: `alpha = 0.7` when `param3.charAt(0) != "p"`
  (`ScoreBoardBar.as:26-41`).
- Header row for FFA/solo: `"#, Name, Score, Kills, Deaths"` (or `"#, Name, Lives, Kills, Deaths"` in Elimination). Team modes add one header bar per team showing `"{Color} Team", teamScore` before that team's player rows (`PauseScreen.as:606-696`).
- Sorting: rows within a team sort by `pscore` descending (`Array.NUMERIC | Array.DESCENDING`); teams themselves sort by total team score descending.

`View Scores` frame also shows `txt_mode` (match/campaign name) and `txt_desc`
(campaign blurb) plus a clickable `mc_sponsor` banner (`AGI.urlSponsor()`).

---

## 6. Shared panel / button visual language (cross-cutting)

Recovered concretely from the swf2xml dump; treat as the base "visual system" to
reuse for all restyled panels:

| Token | Value | Where seen |
|---|---|---|
| Panel fill (dark glass) | Radial gradient **`#2B2B2B` (center) → `#000000` (edge)**, alpha 100% | Weapon-slot ammo panel, char 1448 |
| Panel border | 1px solid **`#000000`** | char 1448 |
| Screen dim overlay | Black, alpha fades **0 → ~40% (`0x66`)** | Pause backdrop morph, char 463 |
| Corner vignette | Black radial, alpha **60%→40%→0%** | Pause backdrop, char 464 |
| Text glow (HUD readouts) | `GLOWFILTER`, blur (3,3), strength 2, colour **`#000000`** | txt_time, txt_gametype, txt_playerscore, txt_enemyscore, txt_flagscore, debug1-3, txt_respawn |
| Text glow (name tags, stronger) | `GLOWFILTER`, blur (3,3), strength **3** | Unit `txt_name` |
| Credit-popup glow | `GLOWFILTER`, blur (7,7), strength 1, colour **`#00CCCC`**-ish | char 1478, under `txt_points`/`txt_pointsearn` |
| Button label font | **BlairMdITC TT**, 20pt, white @ ~80% alpha (idle) / ~40% alpha (locked/dim) | PauseScreen buttons |
| HUD numeric font | **QTypeSquare-Book** family (multiple baked point sizes: 8/10/11/12/13/16/22pt) | ammo/clip/credits/score/time |
| Selected/active accent | **`#57DEB0`** teal-green | Options toggle selected state |
| Selected weapon-slot accent | **`#FFFF00`** yellow | Hud_WeaponHolder ammo-bar tint |
| Team palette | FFA `#00FF00`, Blue `#00CCFF`/`#A3CFFF`(text), Orange `#FF9900`/`#FF9966`(text), Yellow `#FFFF00`/`#FFFF99`(text), Green(4th) `#99FF99`(text) | Unit bars, scoreboard, HUD score text |

---

## Port status

| Area | Status | Notes |
|---|---|---|
| Health/shield/ammo cluster | **missing** | `src/game/Hud.ts` has an ammo readout and weapon strip, but no ECG-style `heartbeat` widget, no yellow shield bar, no purple energy bar, no blood-screen alpha ramp. Needs the hp→colour ramp formula from `Hud.as:357-361` and the shield/energy bar dimensions (33px / 130px max). |
| Weapon loadout strip | **partially implemented** | `Hud.ts` builds weapon slots with a "colour chip along the slot's top edge" (`src/game/Hud.ts:1165`) — this is a **port invention**, not in the original (original uses a yellow ammo-bar tint + `weapon.alpha` dimming only, no per-class colour chip). Slot pitch/count (7 slots @ 65px) should be verified against `src/game/Hud.ts` layout constants. |
| Credits bar | **present but unverified formatting** | Confirm `txt_points`/`txt_pointsearn` equivalents exist and match the "cr" suffix + comma-grouping (`UT.addNumCommas`). |
| Kill feed | **present** (`killFeedRoot`/`KillMsg` in `Hud.ts`) | Verify the 3-colour scheme (teammate `#99FFFF`, enemy `#FF9999`, self `#33FFFF`, weapon `#CCCCCC`) and 13-line cap are matched. |
| Crosshair | **present**, referenced in `Hud.ts` comments | Verify it reproduces the *dynamic bloom* (4 lines spreading with recoil) rather than a static reticle, and that it is single-style (no per-weapon crosshair — none exists in source). |
| Minimap / radar | **wrong — extra feature** | `src/game/Hud.ts:296,465-467` implements a `Minimap` class with a Low-quality profile toggle. **The original Raze 2 HUD has no minimap at all.** This is a port addition; flag for design sign-off (keep as an enhancement, or remove for pixel-fidelity). |
| Damage indicator | **missing / N/A** | Not in the original; no action needed unless intentionally adding one. |
| Streak banners | **missing / N/A (by design)** | Original has no streak-banner widget; multi-kill bonuses surface via world-space `KillPoints` popups + the corner `display_num`/`display_text` clips. If the port wants streak banners it is a new feature, not a port gap. |
| Nameplate health bar (over units) | **not found in port** | No `bar_hp`/`backbar_hp`/`bar_hurt`/`bar_en` equivalent located under `src/game/`. This is the actual source of the "blue/orange segmented bar" — needs implementing: 75px-wide continuous bar, team-coloured front + darker back + red damage-flash sliver easing at 5%/frame. |
| Pause menu | **wrong/placeholder** | `src/game/GameScreen.ts:925-991` is a generic 2-button (`RESUME`/`QUIT TO MENU`) rounded-rect panel with an orange stroke and Impact-font title — no relation to the original's dark-glass/vignette full-screen menu, no `View Scores`/`Options` buttons, no hover state-machine, wrong font (uses `monospace`/`Impact` instead of BlairMdITC TT). Needs a full rebuild per §3. |
| Options screen | **missing entirely** | No file under `src/screens/` implements Graphic Presets/Details or Other Options. `src/state/Quality.ts` may hold the underlying settings model — confirm it maps to `SD.graphQual/graphPart/graphGlow/graphRagev/graphLights` semantics in §4 before wiring UI. |
| View Scores / scoreboard | **missing entirely** | No scoreboard table implementation found. Needs the column set, team-colour row backgrounds, dimmed-AI-row alpha (0.7), and skull/status icon frames from §5. |
| Shared button/panel style | **not established** | No reusable "dark-glass panel + accent" component exists yet in the port; §6 token table should become the base style for Pause/Options/Scores and any future chrome. |
