# Quick Match / Play Setup Screen

## 1. Summary

The Quick Match screen is Raze 2's single-player match-configuration hub, reached from the
main menu ("Quick Match" button) and also used as the setup step before pressing
"Start Game" → Loadout → in-game. It lets the player pick a map (Prev/Next carousel with
name + flavour text), configure a roster (Free-For-All bot count + AI difficulty, or up to
4 teams via Add/Remove Team), and dial in match rules via a stack of `‹ value ›` stepper rows
(Match Type, Kills-to-Win/Lives/Points, Weapons, Special Mode, Abilities, Equipment). A
warning line reports the credit-earning penalty for restrictive settings. All state lives on
the static `MatchSettings` class and is consumed by `Game`/`Hud` at match start.

**Session caveat:** reference screenshot `4.png` and doc `08-menu-ui-theme.md` were not
present on disk when this doc was written (the image-cache directory and doc 08 did not
exist in this workspace). This doc is therefore built entirely from `MatchSettings.as`,
`Stats_Maps.as`/its FFDec p-code disassembly (the decompiled AS3 source for `getMap()` is
corrupted — see §2.3), `Menu.as`, and the current TS port. Exact on-screen pixel positions,
fonts and colours for the *native* Raze 2 widgets (`menfr.txt_maptitle`, `menfr.mc_bots`,
etc.) live in the FLA/SWF stage, not in ActionScript, and could not be recovered without the
screenshot or doc 08. Layout/colour values below for the **port** are cited from
`PlayScreen.ts` directly; the shared button/panel/font tokens are cited from
`src/ui/raze2/*` (the doc-08 design system) without re-deriving them, per the assignment.

## 2. Raze 2 source of truth

### 2.1 `MatchSettings.as` — the static match-config model

File: `decompiled_swf/raze 2/scripts/MatchSettings.as`. All Quick Match UI reads/writes these
static fields directly (no local screen state):

| Field | Type | Meaning |
|---|---|---|
| `type` | String | One of the 5 selectable match types (§2.4) — default `"Deathmatch"` (line 173) |
| `teams` | int | 1 = FFA, 2–4 = team count |
| `team0amt..team4amt` | int | Bot count per team slot (team0 = FFA bots; team1..4 = team rosters) |
| `team0diff..team4diff` | int | Per-team AI difficulty, 0–10 scale (§2.5) |
| `winScore` | uint | Kills/Lives/Points target, default 20 (line 174) |
| `map` | Object | Result of `Stats_Maps.getMap(id)` — `{id, map, bg1, bg2, sky, particles, name, desc}` |
| `specialMode` | String | Default `"None"` (line 175) |
| `weaponsUsed` | String | Default `"All"` (line 176) |
| `abilitiesOn` / `equipsOn` | Boolean | Both default `true` (lines 177–178) |
| `creditMod` | Number | Multiplier applied to end-of-match credits, recomputed every settings change (§2.6) |
| `bots` | Array | Generated bot roster (`setQuickmatchBots()` / `addBot()`) |
| `qmBackup` | Object | Snapshot used to restore Quick Match state after a campaign detour (`backupQm`/`restoreQm`) |

`Init()` (line 141) seeds the defaults above, sets `map = Stats_Maps.getMap(Stats_Maps.mapOrder[0])`
(i.e. `"jungle"` → **Dome**, see §2.3), and calls `updatePlayer()` to copy the player's
equipped loadout (`SD.name/skin/gunList/ability/equips`) into `MatchSettings.player`.

`addBot(diff, team)` (line 241) picks a random unused bot name from a ~60-entry
`botnames` pool (line 143), a random skin (excluding cost `-1` / reserved slot 12–13 unless
the name is the two special bots `"AddisonR"`→skin 12 or `"Juice-Tin"`→skin 13), a random
weapon loadout via `getRandGuns()` (random index per weapon category from `Stats_Armory.gunsAr`),
a random ability from `["static","heal","cloak","sword","mine","grenade"]`, and gates
equipment slots by difficulty: `equip0` unlocked at `diff>=7`, `equip1` at `diff>=5`, `equip2`
at `diff>=9` (lines 302–304).

`setQuickmatchBots()` (line 317) fills `bots[]` from the `team*amt`/`team*diff` fields based on
`teams` (1 = FFA using team0, 2 = only team4 used, 3 = teams {1,3}, 4 = teams {1,2,3}... — the
decompiled switch is stack-obfuscated but resolves to: FFA fills team0; 2 teams uses team1 vs
team4; 3+ teams add team2/team3). `player.team` is set to `0` for FFA, `1` for team modes.

### 2.2 12-player cap and the roster UI clip

The team-roster panel is the embedded MovieClip `Quickmatch_player_holder_73`
(`decompiled_swf/raze 2/scripts/Raze2_fla/Quickmatch_player_holder_73.as`), symbol `symbol824`.
It exposes **5** parallel slot groups (`txt0_players`../`bt0_bots_prev`/`bt0_diff_next`… through
`txt4_*`/`bt4_*`), one per team (0 = FFA slot, 1–4 = team slots), and has 4 timeline frames
(1 team layout .. 4 team layout) — `frameN()` calls back into `Menu.setBotList()` on each
`gotoAndStop`.

`Menu.setBotList()` (Menu.as:2148) computes the player-count label. The whole match is capped
at **12 total combatants**:
- FFA (`teams == 1`): `txt0_players.text = (team0amt + 1) + " / 12 Players"` — bot count + the
  human player.
- Team modes (`teams` 2–4): each team's label is `team{n}amt + " / " + (12 / teams) + " Players"`
  (team 1 gets `+1` for the human player). So 2 teams → 6 slots each; 3 → 4 each; 4 → 3 each.

`Menu.setTeams()` (Menu.as:1881) clamps `MatchSettings.teams` to `[teamsMin, teamsMax]` and, for
every team `1..4`, clamps `team{n}amt` to `12 / teams - (n>1 ? 0 : 1)` — i.e. the per-team bot
cap always leaves one seat open for the human on team 1. It also toggles
`bt_addteam.enabled`/`mc_addteam.visible` when `teams < teamsMax`, and a **separate**
`bt_removeteam`/`mc_removeteam` when `teams > teamsMin` (the source has independent Add and
Remove buttons, not one cycling control).

`getBotDiffString(n)` (Menu.as:2253) maps the 0–10 numeric AI difficulty to a label:

```
["Test","Very Easy","Very Easy","Easy","Easy","Medium","Medium","Hard","Hard","Insane","Insane"]
```

Default per-team difficulty seeded in `MatchSettings.Init()` is `6` → **"Medium"**.

### 2.3 Maps — `Stats_Maps.as` (decompiled AS3 is corrupted; recovered via FFDec p-code)

`Stats_Maps.mapOrder` (Stats_Maps.as:41), the Prev/Next cycle order, is 16 ids:

```
["jungle","jungle2","city","city2","desert","desert2","ocean","ocean2",
 "mines","mines2","space","space2","snow","snow2","tutq","tutq2"]
```

`getMap(id)` (Stats_Maps.as:44) is a giant `switch` that the JPEXS AS3 decompiler failed to
reconstruct (it renders as broken stack `§§push`/`§§pop` pseudo-ops that always fall through to
a dummy `"Test Map"` object). The real per-map data was recovered by exporting the method as
raw AVM2 p-code (`ffdec-cli -export script:pcode`) and reading the `lookupswitch` string
constants directly. Recovered table (all 16 `mapOrder` entries; `tut`/`jungle3` are unreachable
dead cases not in `mapOrder`):

| id | name | bg1 | bg2 | sky | particles | desc |
|---|---|---|---|---|---|---|
| `jungle` | Dome | `""` | `dome` | `red` | `jungle` | "A jungle preserved in a giant glass dome. Built to sustain the last remaining wildlife on earth from it's now uninhabital climate. It's now used for various tests." |
| `jungle2` | Dome (Night) | `dark` | `dome` | `night` | `jungle2` | *(same desc as jungle)* |
| `city` | Judgement | `city` | `city2` | `city` | `city` | "A city that once flourished with human life, now inhabited only by creatures of the night." |
| `city2` | Judgement (Day) | `city` | `city2` | `mday` | `city` | *(same desc)* |
| `desert` | Shipyard | `dunes` | `shipyard2` | `desert` | `desert` | "Originally built for human ships, the shipyards have been taken over by aliens for their own air force." |
| `desert2` | Shipyard (Day) | `dunes` | `shipyard2` | `desert2` | `desert` | *(same desc)* |
| `ocean` | Facility | `oceanf` | `oceanb` | `day` | `ocean` | "An underwater testing facility. Used as a means of creating new equipment for battle, while being hidden underwater from enemies." |
| `ocean2` | Facility (Night) | `oceanf` | `oceanb` | `space` | `ocean` | *(same desc)* |
| `mines` | Mines | `mountainbig` | `mountainsmall` | `city` | `mines` | "A mining facility rich in minerals. It's high concentration of elements makes it a key area fought over by many forces." |
| `mines2` | Mines (Day) | `mountainbig` | `mountainsmall` | `mday` | `mines2` | *(same desc)* |
| `space` | Crash Landing | `pillars` | `pillarsmall` | `space` | `space` | "A space battle with a persuing enemy ship has resulted in the Echo-1 crash landing on an unknown planet." (`moon=true`) |
| `space2` | Crash Landing (Dawn) | `pillars` | `pillarsmall` | `dawn` | `space` | *(same desc, `moon=true`)* |
| `snow` | Frostbite | `snow` | `snow2` | `day` | `snow` | "A look out post situated high atop a mountain pass. It's servers hold high amounts of sensitive information, sought out by enemies." |
| `snow2` | Frostbite (Night) | `snow` | `snow2` | `nlights` | `snow2` | *(same desc)* |
| `tutq` | Headquarters | `mountainbiglow` | `mountainsmalllow` | `tut` | `""` | "Home of the Raze Task Force, and the training grounds for new recruits. (Very small map, -100% credits)" |
| `tutq2` | Headquarters (Invasion) | `mountainbiglow` | `mountainsmalllow` | `tut_attack` | `""` | *(same desc as tutq)* |

`Menu.setMap(id, flash)` (Menu.as:2128) calls `getMap`, stores it on `MatchSettings.map`,
sets `menfr.img_map.gotoAndStop(id)` (a per-map frame in a symbol clip), flashes
`img_map.mc_flash` on manual navigation, and writes `txt_maptitle.text = map.name` /
`txt_mapdesc.text = map.desc`, then calls `setQuickmatchSettings()` (because `tutq`/`tutq2`
affect `creditMod`, §2.6).

Prev/Next wraps via `UT.getNextEl(current, forward, Stats_Maps.mapOrder)`
(Menu.as:1058/1062).

### 2.4 Match Type — cycle list, descriptions, score fields, team bounds

Cycle array, exactly (Menu.as:1071/1077), **5 selectable types** (note British-English spelling
`"Juggernaught"`, and that `"Protection"` exists in `setQuickmatchSettings`'s switch but is
**not** in this cycle array — it's dead/unused, its description literally reads `"-- Not used --"`,
Menu.as:1967):

```
["Deathmatch","Elimination","Domination","Capture the Flag","Juggernaught"]
```

Per-type description (`txt_typedesc`), score-field label (`txt_scoretype`), team bounds
(`teamsMin`/`teamsMax`, reset to 1/4 at the top of `setQuickmatchSettings()`, Menu.as:1926-1974),
and the winScore/lives cycle values (`setWinScore()`, Menu.as:2079-2110):

| Type | Description | Score label | teamsMin | teamsMax | Cycle values |
|---|---|---|---|---|---|
| Deathmatch | "Score points by Killing enemies." | Kills to Win | 1 | 4 | `[15,20,25,50,100,5]` |
| Elimination | "Kill off all the Lives of your enemies and be the last standing." | Lives | 1 | 4 | `[10,15,20,25,3,5,7]` |
| Domination | "Capture Flag areas and earn points based on how many you control." | Points to Win | 2 | 4 | `[50,75,100,150,200,250,25]` |
| Capture the Flag | "Capture the enemy's Flag and return it to your base." | Points to Win | 2 | **2** | `[3,5,7,10,15,25]` |
| Juggernaught | "Kill the Juggernaught to become him, and then kill everyone else." | Kills to Win | 1 | **1** (forced FFA) | `[10,15,20,25,30]` |
| *(Protection — unused)* | "-- Not used --" | Kills to Win | 2 | 4 | `[10,15,20,25,50,100,5]` |

Important: **Elimination is not FFA-only** in the source — `teamsMin/teamsMax` stay at the
default `1/4`, and `MatchSettings.updateScores()` (MatchSettings.as:423) has full team-mode
Elimination logic (checks each `team{n}score`). Domination requires `teamsMin=2` (always at
least 2 teams). Juggernaught forces `teamsMax=1`, i.e. it cannot have teams at all.
`setWinScore(true)` (called on type change) resets to the first array element; the
prev/next steppers call `setWinScore(false, forward)` which uses `UT.getNextEl` to wrap.

The default value picked at `MatchSettings.Init()` is `winScore = 20`, which is index 1 of the
Deathmatch array — consistent.

### 2.5 Weapons preset — cycle list + credit penalty

Cycle array, exactly (Menu.as:1114/1127), 8 values:

```
["All","Starters","Sidearms","Close Range","Automatics","Long Range","Heavies","Explosives"]
```

`setQuickmatchSettings()` also builds `menfr.txt_curtype` labels for the loadout weapon-type
filter using **singular** forms (Menu.as:2481): `["Starter","Side Arm","Close Range",
"Automatic","Long Range","Heavy","Explosive"]` — a separate, singular-cased list used
elsewhere in the loadout UI, not the Quick Match stepper itself.

### 2.6 Special Mode — cycle list, achievement gating, credit penalty

Base list, always available: `["None","Infinite Clips"]` (Menu.as:249). Additional entries are
achievement-gated by **numeric achievement id**, not by name (Menu.as:250-265; ids/effects per
`Stats_Achievements.as:97-116`):

| Achievement id | Achievement name | Unlocks special mode |
|---|---|---|
| `2` | "I hate nature!" | **"Infinite Ammo"** (reward object literally stores `"Unlimited Ammo"` — naming quirk between the achievement reward string and the mode string the rest of the game checks) |
| `0` | "Oh Hi Kitty" | "lol cats" |
| `1` | "Love is Blind" | "4x Health" |
| `3` | "Reach for the Sky" | "Moon Corpses" |

Gate check is `SD.achievements.indexOf(id) != -1` — `SD.achievements` is an array of unlocked
achievement **ids** (numbers), not mode-name strings.

### 2.7 Abilities / Equipment steppers

Both are plain booleans toggled by *either* their prev or next button (Menu.as:1135-1154 —
both `bt_abilities_prev` and `bt_abilities_next` just flip `!MatchSettings.abilitiesOn`; same
for equips). Displayed as `"On"`/`"Off"` (Menu.as:1983,1989). Both default `true`.

### 2.8 Credit-mod penalty warning

`setQuickmatchSettings()` recomputes `MatchSettings.creditMod` from scratch every settings
change (Menu.as:1999-2076), starting at `1` and subtracting:

| Setting | Penalty |
|---|---|
| Weapons = Starters | −0.1 |
| Weapons = Sidearms | −0.1 |
| Weapons = Close Range | −0.2 |
| Weapons = Automatics | −0.2 |
| Weapons = Long Range | −0.35 |
| Weapons = Heavies | −0.3 |
| Weapons = Explosives | −0.35 |
| Special = Infinite Clips | −0.6 |
| Special = Infinite Ammo | −0.9 |
| Map = `tutq` | −1.0 |
| Map = `tutq2` | −1.0 |
| Special = 4x Health | −0.5 |

Clamped to `>= 0`. If `creditMod < 1`, `txt_warning.text =
"Warning: With these settings, you will earn -" + (100 - creditMod*100) + "% credits."`,
else the warning is cleared. (Multiple penalties stack — e.g. Explosives + Infinite Ammo on
map `tutq` clamps straight to 0, "-100% credits".)

### 2.9 Bottom bar / entry points (Menu.as, `case "Quick Match"` init, line 248)

Entering the Quick Match menu frame rebuilds `specialModes` from current achievements, sets
`MatchSettings.isCampaign = false`, and calls `setMap(MatchSettings.map)` to refresh all
labels. There is no separate AS3 class for this screen — it's one `case` inside `Menu.as`'s
giant frame/state switch (a single `Menu` class drives every menu screen via `curScreen`
string dispatch), operating on a `menfr` (menu-frame) MovieClip reference whose named children
(`txt_maptitle`, `mc_bots`, `bt_type_next`, etc.) are the actual on-stage widgets.

## 3. Current port state

File: `raze-ts/src/screens/PlayScreen.ts` (629 lines). Built on the doc-08 UI kit
(`Raze2Button`, `Raze2Panel`, font/colour tokens from `src/ui/raze2`).

- **Layout** (`GAME_WIDTH=1136, GAME_HEIGHT=639`, `Config.ts:5-6`): header "QUICK MATCH" at
  `(60,34)`. Map preview panel at `(60,90)`, `440×300`, teal-green (`C_OPTIONS_GREEN =
  0x57deb0`) accent; map image `400×180` at `(80,110)`; Prev/Next glyph arrows at
  `(68,200)`/`(472,200)`; title at `(80,305)`; description at `(80,335)`. Roster panel at
  `(60,400)`, `440×160`, cyan (`0x00ccff`) accent, title "FREE FOR ALL" / "`N` TEAMS" /
  "JUGGERNAUT (FFA)", Players + Difficulty steppers, "+ Add Team" button. Settings panel at
  `(560,90)`, `516×470` (`GAME_WIDTH-x-60`), teal accent, title "MATCH SETTINGS", 6 stepper
  rows (Match Type, Kills to Win, Weapons, Special Mode, Abilities, Equipment) at 52px
  vertical spacing starting `y+58`, then a "What is this ?" hover label (colour-swap only, no
  actual tooltip/popup content wired). Bottom bar at `y = GAME_HEIGHT-52`: Back to Menu (60),
  Online Match (310, cyan accent — not in the domain's required control list, kept as a
  secondary path per the file's top comment), Upgrades (`GAME_WIDTH-460`, yellow accent),
  Start Game (`GAME_WIDTH-260`, teal accent).
- **Map carousel**: cycles `LEVELS` from `game/Arena.ts:116-135` — **15 entries mixing Raze 1
  and Raze 2 levels** plus `sandbox`, not the Raze-2-only 16-map `Stats_Maps.mapOrder`. Titles
  are the port's own placeholder names (`"Jungle"`, `"City (Raze 2)"`, `"Desert"`, `"Ocean"`,
  `"Space (Raze 2)"`, `"Snow"`, `"Quarantine"`), not the real Raze 2 names recovered in §2.3
  (`Dome`, `Judgement`, `Shipyard`, `Facility`, `Crash Landing`, `Frostbite`, `Headquarters`).
  No map description is shown per-map — `mapDesc` is a single static string ("Pick your arena,
  then set the rules of engagement.") that never updates in `refreshMap()` (dead field).
  Night variants (`city2/desert2/space2/snow2/tutq2`) are entirely absent from `LEVELS`.
- **Match Type** (`MODES`, lines 54-61): 6 entries — `dm, tdm, elim, ctf, dom, jug` — splitting
  Deathmatch into separate "Deathmatch"/"Team Deathmatch" labels (not a distinct type in the
  source) and using US spelling "Juggernaut" (source: "Juggernaught"). No type description
  text is rendered anywhere (source's `txt_typedesc` has no port equivalent).
  `cycleLimit`/`refreshLimit` use flat 5-value `SCORES=[10,15,20,30,50]` / 4-value
  `LIVES=[1,3,5,10]` arrays shared across *all* modes, not the source's per-type cycle arrays
  from §2.4.
- **Weapons** (`WEAPONS`, line 63): matches the source's 8-value list **exactly**, same order.
- **Special Mode** (`buildSpecials()`, lines 66-81): gates on `SD.modesUnlocked` (an array of
  *mode-name strings* the port already maintains) rather than the source's
  `SD.achievements.indexOf(id)` numeric-id gate (§2.6). The port's code comment already
  documents the "Unlimited Ammo" vs "Infinite Ammo" naming quirk correctly.
- **Abilities / Equipment**: `ONOFF=["Off","On"]`, cycled either direction — matches source
  behaviour (both buttons toggle, doesn't matter which arrow is pressed).
- **Roster / teams**: `opponents` is a flat `1..7` counter (`stepOpponents`, line 318,
  `%7 + 1`) with **no 12-player cap or per-team split** — nothing like the source's 5-slot
  `team0..4amt` model or the `12 / teams` per-team cap (§2.2). `diffIdx` picks from a **4-value**
  `DIFFS` array (`Easy/Medium/Hard/Ego`, values `0.8/1.2/2/2.8`, lines 44-49) that is a
  *difficulty multiplier* model, entirely different from the source's **11-level** AI
  difficulty scale (0–10, `getBotDiffString`, §2.2) — these aren't reconcilable 1:1 without a
  design decision. `addTeam()` (line 292) cycles a single team-count int 2↔max via one button,
  rather than the source's separate Add/Remove buttons with independent enable state.
- **Start Game** (`start()`, line 598): builds `SD.matchSettings` with `type, diff, egoMode,
  opponents, level, score, lives, team, teams, ff, dmgMod` plus the wired
  `specialMode/weaponsUsed/abilitiesOn/equipment` fields (comment cites doc 11 §2/§6/§7 — this
  doc does not re-verify that wiring). No credit-mod warning line is computed or shown
  anywhere in the port (§2.8 has no equivalent).
- **"What is this ?"** (lines 392-407): pure hover colour-swap; the actual explanatory content
  it would show could not be identified in the decompiled AS3 (Menu.as has no matching
  string/dialog trigger near the Quick Match case) — likely a native SWF tooltip whose text
  lives only in the FLA, unreachable without doc 08 / the reference screenshot (see §6).

## 4. Gap analysis

| # | Raze 2 target | Port today | Severity |
|---|---|---|---|
| 1 | 16-map Raze-2-only carousel with real names/descs (§2.3) | 15-entry mixed Raze1+Raze2 `LEVELS` list, placeholder names, static non-updating description | High |
| 2 | Night/day map variants (`city2`,`desert2`,`space2`,`snow2`,`tutq2`) | Absent entirely | Medium |
| 3 | 5 match types, exact source spelling, each with a one-line description + own score cycle array | 6 types (splits DM/TDM, no descriptions, shared score arrays) | High |
| 4 | Elimination playable as FFA or teams | Hardcoded `team:false` (FFA-only) | Medium |
| 5 | Domination forces `teamsMin=2`; Juggernaught forces `teamsMax=1` (no teams) | Not enforced as min/max; only max-side clamping via `maxTeams()` | Low-Medium |
| 6 | 12-total-player cap, split `12/teams` per team, 5 named team slots (0=FFA,1-4) | Flat 1–7 "opponents" counter, no cap tied to team count | High |
| 7 | 11-level AI difficulty (0–10, `getBotDiffString` labels) per team | 4-value difficulty *multiplier* (Easy/Medium/Hard/Ego) — different axis entirely | High (model mismatch, needs design call) |
| 8 | Separate Add-Team / Remove-Team buttons, each independently enabled | Single "+ Add Team" cycling button | Low |
| 9 | Special-mode gate = achievement id (`SD.achievements.indexOf(n)`) | Gate = mode-name string in `SD.modesUnlocked` | Low (different but equivalent data model — verify `modesUnlocked` is actually populated from achievement unlocks elsewhere) |
| 10 | Credit-mod penalty computation + warning line (§2.8) | Not implemented — no warning text, no `creditMod` field on `SD.matchSettings` | Medium |
| 11 | Match-type description line (`txt_typedesc`) | No equivalent text element | Low |
| 12 | "What is this?" real tooltip content | Colour-swap only, no content (source dialog/content unidentified) | Unknown — needs doc 08 / screenshot |
| 13 | Pixel-exact layout/colour/font for native widgets | Port uses its own doc-08-consistent layout, not verified against the real screen | Unknown — needs screenshot |

## 5. Implementation checklist (future build phase — do NOT do it now)

1. Replace `PlayScreen`'s map source: build a Raze-2-only 16-entry list from
   `Stats_Maps.mapOrder` (§2.3) with the real `name`/`desc` strings recovered above; wire
   `mapDesc.text` to update per-map in `refreshMap()` (currently dead). Decide whether to
   surface the 5 night/day pairs as separate carousel entries or as a per-map "time of day"
   toggle. Affected: `PlayScreen.ts` (`buildMapPreview`, `cycleMap`, `refreshMap`), and either
   extend `game/Arena.ts:LEVELS` or introduce a Raze-2-specific map table sourced from
   `src/assets/raze2maps.json` (already has geometry for the 8 unique base ids — note it does
   *not* yet have separate entries for the `*2` night variants, which currently alias the base
   map's geometry 1:1; confirm whether night variants need distinct collision data or just a
   different `bg`/`sky` skin).
2. Rebuild `MODES` to the 5 source types (`Deathmatch, Elimination, Domination, Capture the
   Flag, Juggernaught`) with per-type `desc` (§2.4) rendered as a new `typeDescValue` text row,
   and per-type score-cycle arrays (§2.4) replacing the shared `SCORES`/`LIVES` arrays. Remove
   the port-invented "Team Deathmatch" entry (or keep it as an explicit port extension, but
   flag it as non-canonical in a comment). Make Elimination team-capable (drop `team:false`).
   Affected: `PlayScreen.ts` (`MODES`, `cycleLimit`, `refreshLimit`, `buildSettings`).
3. Enforce `teamsMin`/`teamsMax` per type (Domination min 2, CTF min=max=2, Juggernaught
   max 1) in `cycleMode`/`addTeam`/`maxTeams`, and split Add Team / Remove Team into two
   buttons with independent `enabled` state mirroring `bt_addteam`/`bt_removeteam`.
4. Redesign the roster box around the 12-player-cap, 5-slot (`team0..4`) model: replace the
   flat `opponents` counter with per-team bot counts (`teamNamt`) clamped to
   `12/teams - (n>1?0:1)`, and a per-team difficulty stepper using the 11-level
   `getBotDiffString` scale (§2.2) instead of (or alongside — needs a design decision) the
   existing Easy/Medium/Hard/Ego multiplier, since the two are different axes (AI skill level
   vs global damage/health multiplier — Raze 2 has both `team*diff` *and* a separate difficulty
   multiplier elsewhere; confirm against `01-weapons-catalog.md`/`Stats_Armory` AI-scaling code
   in a follow-up rather than conflating them here).
5. Wire the special-mode gate to real achievement ids: either change `SD.modesUnlocked` to be
   derived from `SD.achievements.indexOf([2,0,1,3][i])` at build time, or keep the string list
   but ensure it's populated exactly when those 4 achievement ids unlock (cross-check
   `14-abilities-equipment.md`/achievements doc for where `SD.achievements` is mutated in the
   port).
6. Implement the `creditMod` penalty table (§2.8) and the warning line, surfaced on
   `SD.matchSettings` so the post-match credit award can apply it (check whichever doc owns
   the end-of-match credit award for the actual multiply-in point).
7. Investigate "What is this?" — likely needs the reference screenshot or an SWF-stage render
   (FFDec GUI, or `-export frame:png` around the Quick Match frame) to identify what dialog it
   opens; not resolvable from AS3 logic alone since it's a static SWF button with no
   accompanying script found in `Menu.as`.
8. Once the reference screenshot becomes available, re-audit `PlayScreen.ts`'s exact
   coordinates/colors/fonts against it (this doc's §3 layout notes are "as coded," not
   verified pixel-for-pixel against a real capture).

## 6. Open questions / data still missing

- Reference screenshot `4.png` and doc `08-menu-ui-theme.md` did not exist in this workspace
  run — re-verify §3's layout claims and the "What is this?" tooltip content once both are
  available.
- Whether the 5 `*2` night-map variants need distinct Box2D collision/spawn geometry or are a
  pure re-skin of their base map (the extracted `raze2maps.json` currently only has 8 unique
  geometry blocks reused verbatim for `jungle`/`jungle2` and `mines`/`mines2`; `city2`,
  `desert2`, `ocean2`, `space2`, `snow2`, `tutq2` aren't present in `raze2maps.json` at all —
  confirm against the SWF's `img_map` frame list whether they're genuinely separate playable
  maps or just alternate lighting used only for the *background art*, not gameplay).
  `Stats_MapParticles.as` (referenced in Menu.as) likely holds the per-map particle-set
  definitions keyed by the `particles` field above — not read for this doc; worth a follow-up
  if `03-weapon-visuals-fx.md` or a maps-specific doc doesn't already cover it.
- The exact relationship (if any) between the AI's 0–10 `team*diff` scale and the separate
  global difficulty-multiplier mechanic the port already has (`DIFFS` in `PlayScreen.ts`) —
  are these two independent Raze 2 systems both meant to be exposed, or did the port conflate
  a single source concept? Not resolved by this doc; needs a source-wide difficulty-system
  search (likely touches `AI.as`/`AGI.as`).
- `Stats_Campaign.setMatch()` is called from the same `Menu.as` frame-switch machinery for the
  Campaign screen's near-identical match-summary panel (`txt_matchtitle`, `txt_desc`,
  `txt_extra`) — out of scope here (owned by `10-campaign.md`) but noted because it shares
  several of the same `menfr` fields as Quick Match.
