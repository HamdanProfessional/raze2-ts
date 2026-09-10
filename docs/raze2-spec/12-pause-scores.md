# Pause Menu + View Scores Scoreboard

## 1. Summary

In Raze 2 the in-match Pause menu and the "View Scores" scoreboard are **one single
timeline-driven `MovieClip` class**, `PauseScreen` (symbol562), not two separate screens.
Pressing P (or the match ending) sends the clip to a frame labelled `"countdown"` / the
paused idle frame; the four persistent left-column buttons (**Resume Game / View Scores /
Options / Quit Game**) are always present and always active — clicking one does
`gotoAndStop(label)` on the *same* clip, swapping the right-hand content area while the
button column and the mission title/blurb stay on screen. `View Scores` populates a
`barsCont` holder with one `ScoreBoardBar` (symbol462) instance per header/player row —
a header banner per team plus one tinted row per unit, sorted by score, with a small
status icon (jug/point-defence/dead-skull/flag-carrier) per row. `Quit Game` opens a
`Yes`/`No` confirm sub-state before actually leaving. `Options` (graphics quality /
particles/glow/rage-vision/lights/sound/music/screen-blood/pause-blur) shares the same
clip and button column but is out of scope here (see doc 13).

## 2. Raze 2 source of truth

### 2.1 Files

| File | Role |
|---|---|
| `decompiled_swf/raze 2/scripts/PauseScreen.as` (symbol562, `[Embed(symbol="symbol562")]`) | The whole pause/scores/options/quit clip. |
| `decompiled_swf/raze 2/scripts/ScoreBoardBar.as` (symbol462, `[Embed(symbol="symbol462")]`) | One scoreboard row (header or data). |
| `decompiled_swf/raze 2/sprites/DefineSprite_562_PauseScreen/*.svg` | 288 exported timeline frames of symbol562 (FFDec). |
| `decompiled_swf/raze 2/sprites/DefineSprite_462_ScoreBoardBar/*.svg` | 75 exported timeline frames of symbol462 (FFDec). |
| `decompiled_swf/raze 2/sprites/DefineSprite_461/*.svg` | The `mc_skull` per-row status-icon sub-clip (8 frames). |

### 2.2 PauseScreen (`PauseScreen.as`) — structure

- Exposed fields (`PauseScreen.as:37-121`): `txt_title`, `txt_mode`, `txt_desc`,
  `txt_credits`, `barsCont` (scoreboard row container), `mc_sponsor`, the four button
  clips `btn_Resume_Game` / `btn_View_Scores` / `btn_Options` / `btn_Quit_Game` (+ their
  `btnl_*` "locked/ghost" twins), `btn_Yes` / `btn_No` (quit confirm), and the whole
  `Options` panel's toggle text fields.
- `init()` (`:153-258`) scans `numChildren` for any child whose name starts with `"btn"`:
  - Name prefix `"btn_..."` → **active** button: pushed into `buttons[]`, label text set from
    the name (`_` → space, e.g. `btn_View_Scores` → "View Scores"), `gotoAndStop(1)`
    (idle visual state).
  - Name prefix `"btnl_..."` → **ghost/disabled** twin for the tab you're already on:
    `alpha = 0.5`, `gotoAndStop(1)`, **not** pushed into `buttons[]` (so it doesn't
    respond to clicks). This is how the reference screenshot shows the left button
    column present on every sub-screen with the current tab dimmed instead of the whole
    column disappearing.
  - `switch(currentLabel)` then does per-frame setup: on `"View Scores"` it sets
    `txt_mode.text` = `MatchSettings.isCampaign ? MatchSettings.matchName : "Quick Match"`
    (the **mission title**), `txt_desc.text` = `MatchSettings.matchDesc` for campaign only
    (empty in Quick Match) (the **story blurb**), then `displayScoreBars()`.
- `EnterFrame()` (`:260-312`): per-button hover state machine — `hitbox.hitTestPoint` →
  `gotoAndPlay("over")` / `"out"` (SWF-internal button-symbol timeline crossfade, not a
  simple alpha tween).
- `MouseDown()` (`:314-523`): dispatch on `buttons[i].txt_word.text`:
  `"Resume Game"` → `game.togglePause()`; `"Yes"` → `destroy(true)` (rage-quit path,
  logs `RageQuits` metric); `"No"` → `gotoAndStop("View Scores")` (quit-confirm cancels
  back to scores, **not** to the main button screen); anything else → `gotoAndStop(label)`
  (i.e. clicking "View Scores"/"Options"/"Quit Game" just changes frame label on the same
  clip — button column persists).
- `selCol = 5758640` (`0x57DEB0`, teal-green) — the shared "this option is selected" tint,
  reused by the Options sub-panel (see doc 13); not scoreboard-specific.

### 2.3 `displayScoreBars()` (`PauseScreen.as:525-698`) — exact row-building algorithm

```
rowY = -30
if MatchSettings.teams in {0, 1}:           // FFA / single "team"
    header label = "Lives" col if MatchSettings.type == "Elimination" else "Score"
    barsCont.addChild(ScoreBoardBar(true, rowY+=30, "h0", "#", "Name", <header label>, "Kills", "Deaths"))
    units = game.units filtered to exclude matchInfo.extra.noSpawn
    units.sortOn("pscore", NUMERIC | DESCENDING)
    for i, u in enumerate(units):
        iconFrame = "None"
        if u.isJug: iconFrame = "Juggernaught"
        if u.onPoint or u.defendingFlag: iconFrame = "Domination"
        if u.dead: iconFrame = "Deathmatch"
        if u.hasFlag: iconFrame = "Capture the Flag"
        barsCont.addChild(ScoreBoardBar(false, rowY+=30, (u.human?"p":"a")+u.team,
                                         i+1, u.name, u.pscore, u.score.kills, u.score.deaths, iconFrame))
else:  // teams in {2,3,4}
    header row same as above but colId "h0"
    teamsSorted = teams 1..MatchSettings.teams sorted by game.matchSettings["team"+n+"score"] DESC
    for teamIdx in teamsSorted (max 4):
        rowY += 30
        barsCont.addChild(ScoreBoardBar(true, rowY, "h"+team, teamIdx, UT.getEl(team-1,["Blue","Orange","Yellow","Green"])+" Team",
                                         teamScore, "", ""))     // team header banner, Kills/Deaths blank
        rows = units on that team, sortOn("pscore", NUMERIC|DESCENDING)
        for i, u in rows:
            iconFrame = same 4-state logic as above
            rowY += 30
            barsCont.addChild(ScoreBoardBar(false, rowY, (u.human?"p":"a")+u.team,
                                             i+1, u.name, u.pscore, u.score.kills, u.score.deaths, iconFrame))
        rowY += 5   // extra gap after each team block
```

Key numeric facts: **row pitch = 30px** (`_loc1_ += 30` throughout); **+5px extra gap**
after each team's block in team modes; row index restarts at 1 per team (not
continuous across teams); `"Elimination"` matches show **Lives** instead of **Score** in
the header cell (units array), same instantiation pattern.

### 2.4 `ScoreBoardBar` (`ScoreBoardBar.as`) — one row

```ts
ScoreBoardBar(isHeader: Boolean, y: Number, colorFrameLabel: String,
              pos, name, col3 /*score|teamScore|lives*/, kills, deaths,
              iconFrame: String = "None")
```
- `alpha = 0.7` iff **not header AND `colorFrameLabel.charAt(0) != "p"`** — i.e. **AI/bot
  rows are dimmed to 70% opacity**; header rows and the local human player's row are full
  opacity (`ScoreBoardBar.as:26-41`).
- `y = param2` (absolute, set by caller — the 30px pitch above).
- `gotoAndStop(colorFrameLabel)` — selects the row's **art/colour frame**: `"h0"`..`"h4"`
  (headers, 0=FFA/col-titles, 1-4=team banner), `"p1"`..`"p4"` (human row, tinted by
  team), `"a1"`..`"a4"` (bot row, same tint, later dimmed via the `alpha=0.7` above).
- Text fields set verbatim to `pos`/`name`/`col3`/`kills`/`deaths` + `"" ` (string coerce).
- `mc_skull.gotoAndStop(iconFrame)` — the per-row status icon slot (see 2.6), **not**
  merely a dead/skull toggle: it also shows Juggernaught / Domination(point-or-flag-guard)
  / Capture-the-Flag badges, defaulting to a blank ("None") frame.

### 2.5 Row geometry, fonts and colours (FFDec export of symbol462, frames 1–75)

Each of the 75 timeline frames is `473.6px × 28.3px`. Column x-offsets (local units,
relative to the row's own transform origin — i.e. *relative spacing*, not absolute
screen px; use these for column **proportions**, re-derive absolute px against the final
row width when implementing) and field widths, read directly off `<use>` transforms in
e.g. `sprites/DefineSprite_462_ScoreBoardBar/20.svg`:

| Field | x offset | width | fill | font |
|---|---|---|---|---|
| `txt_pos` (#) | -61.45 | 23.0 | `#ffffff` | Arial, glyph-path embedded (no dynamic font in FLA) |
| `txt_name` | -14.6 | 198.5 | `#ffffff` | Arial |
| `txt_score` | 163.3 | 72.0 | **`#fefdb4`** (pale gold) | Arial |
| `txt_kills` | 239.6 | 58.0 | `#ffffff` | Arial |
| `txt_deaths` | 322.45 | 72.5 | `#ffffff` | Arial |
| `mc_skull` (status icon) | 443.75, y -0.35 | 18.25×17.85 (scale 1.3418) | icon-native | — |

Column deltas (for proportion): pos→name +46.85, name→score +177.9, score→kills +76.3,
kills→deaths +82.85, deaths→skull +121.3. The Score column is the **only** column not
drawn white — it's pale gold (`0xFEFDB4`), matching the credits/currency colour used
elsewhere in the UI (worth reusing for consistency).

The row background is two stacked flat fills (`fill-opacity` 0.298 and 0.498) plus a
`linearGradient` (same hue, alpha 0.298→0.498) over the middle band, plus a 1px stroke in
the same colour as the flat fill — i.e. a soft vertical gradient banner with a hairline
border, not a flat rect.

### 2.6 Team header / row tint colours — `0xRRGGBB` (measured from every frame's fill)

The 75 frames are five 15-frame blocks (frames 1–15, 16–30, 31–45, 46–60, 61–75 = team
`0`(FFA/header-only) `1`(Blue) `2`(Orange) `3`(Yellow) `4`(Green)). Within each block the
saturated bar colour steps through **exactly three shades at 100% / 80% / 50% value** of
the same hue (4 + 4 + 7 frames respectively) — i.e. a lit/mid/settled tri-tone, not a
single flat colour:

| Team | "Bright" (100%, ×4 frames) | "Mid" (80%, ×4 frames) | "Settled/row" (50%, ×7 frames — majority/steady-state) |
|---|---|---|---|
| 0 — FFA / header-only | `0x000000` (frames 1-4) | `0x806600` (frames 5-8, anomalous — see §6) | `0x1A1A1A` (frames 9-15) |
| 1 — Blue | `0x3399FF` | `0x297ACC` | `0x1A4D80` |
| 2 — Orange | `0xFF9900` | `0xCC7A00` | `0x804D00` |
| 3 — Yellow | `0xFFFF00` | `0xCCCC00` | `0x808000` |
| 4 — Green | `0x00FF00` | `0x00CC00` | `0x008000` |

`0x806600` is not a straight ⅓-value step of black and doesn't fit the pattern the other
four teams follow — flagged as an open question in §6 (possibly a leftover
authoring-time placeholder colour, or an unused 5th "gold/FFA-leader-highlight" tint).
Practical read for implementation: **team header banner = the bright/100% shade**,
**team member rows = the settled/50% shade** (matches the reference screenshot's "header
band saturated, rows underneath a muted tint of the same colour" look). All shades share
one `fill-opacity` ramp (0.298 → 0.498) regardless of team.

### 2.7 `mc_skull` per-row status icon (`sprites/DefineSprite_461`)

8 timeline frames; frame 8 is a **blank/empty** frame (`iconFrame = "None"`, the default —
most rows show nothing). Frames 1–7 each reference a distinct shape (`characterId`
454–460) — more icon states than the 4 named triggers in `displayScoreBars()`
(`"Juggernaught"`, `"Domination"`, `"Deathmatch"`, `"Capture the Flag"`); the exact
frame↔label mapping wasn't recoverable from the exported SVGs alone (FFDec strips frame
*labels* from per-frame SVG export — only `gotoAndStop(labelString)` calls in the AS3 are
authoritative). Recommend re-deriving the mapping with FFDec's SWF-XML/timeline view
before implementing (see §6).

### 2.8 PauseScreen frame/label colours (`sprites/DefineSprite_562_PauseScreen`)

Sampled frames 1, 20, 74, 87: only two non-white/black fills recur across the whole
clip — `#000000` (panel/backdrop fills) and `#ffff66` (a warm yellow used on at least the
paused-idle and "gamedone" states — likely the flashing "PAUSED"/credits highlight text,
consistent with the reference screenshot's warm-tinted title treatment). No blue/orange
team colours appear in the PauseScreen clip itself — all team tinting lives in the nested
`ScoreBoardBar` rows (§2.6), confirming the left button column + title/blurb chrome is
team-neutral dark glass, same language as every other Raze 2 panel (doc 08).

### 2.9 Reference screenshot (#7, "View Scores")

**Not available in this session** — the reference image path given for this task
(`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\7.png`) does
not exist on disk (`~/.claude/image-cache/` itself is absent; only `paste-cache` and
`cache` exist, neither containing this screenshot). This doc's layout/colour claims are
therefore derived entirely from the AS3 source (§2.2–2.3) and the FFDec SVG timeline
export (§2.5–2.8), which do independently corroborate a two-column layout (persistent
left button stack with mission title/blurb above it; right-hand scoreboard with
team-tinted header bands) — but the **exact** proportions, background art, and font
faces should be re-verified against the screenshot once it's available (flagged in §6).

## 3. Current port state

Current implementation lives in `src/game/GameScreen.ts` (in-match pause overlay,
`buildPauseOverlay()` at lines 1208–1354 and helpers through line 1437) and
`src/screens/ScoresScreen.ts` (standalone "View Scores" menu screen reusing the same
`ScoreBoard` component), backed by `src/ui/raze2/{Raze2Button.ts,Raze2Panel.ts,palette.ts}`.

- **Button column persistence — gap.** `showPauseSub()` (`GameScreen.ts:1376-1383`) does
  `this.pauseMain.visible = sub === "main"`, i.e. it **hides the entire button stack**
  when switching to Scores or Options. Raze 2 keeps all four buttons visible always,
  showing only the *current* tab as a dimmed `btnl_*` ghost (§2.2). The port has no
  ghost/ "you are here" button state at all.
- **Mission title + blurb — missing.** Raze 2's `View Scores` frame shows `txt_mode`
  (mission/"Quick Match" title) and `txt_desc` (campaign blurb) alongside the button
  column (§2.2, §2.3). Neither `GameScreen.ts`'s pause-scores sub-screen (just a
  "SCORES" header, `:1270-1279`) nor `ScoresScreen.ts` (just "VIEW SCORES", `:138-152`)
  render this.
- **Quit confirmation — missing.** The port's Quit Game button (`GameScreen.ts:1243-1248`)
  navigates straight to `MenuScreen`. Raze 2 gates this behind a `Yes`/`No` confirm frame
  (`PauseScreen.as:511-516`, `RageQuits` stat increment on confirm) — no confirm dialog,
  no rage-quit-cancels-to-scores behaviour, exists in the port.
  `GameScreen.ts:1240-1248`) also skips the `game.togglePause()` semantics nuance where
  `Resume Game` is the only button that doesn't `gotoAndStop`.
- **Scoreboard row style diverges from source.** `ScoreBoard.buildRow()`
  (`ScoresScreen.ts:73-123`) draws a flat `teamBackColor(team)` fill at alpha 0.5 plus a
  **3px left accent stripe** (`:81-82`) — a different visual language from Raze 2's
  **full-width gradient banner + hairline border, no left stripe** (§2.5). Header rows use
  `drawRaze2Panel` (dark-glass chrome, `:78-79`) rather than the black/`0x1A1A1A` `"h0"`
  tone measured in §2.6.
- **Team colour values partially diverge** (`src/ui/raze2/palette.ts:63,69,75,79`):

  | Team | Port `teamColor()` | Measured Raze 2 bright shade (§2.6) | Match? |
  |---|---|---|---|
  | 1 Blue | `0x00CCFF` | `0x3399FF` | ✗ (port is more cyan) |
  | 2 Orange | `0xFF9900` | `0xFF9900` | ✓ exact |
  | 3 Yellow | `0xFFFF00` | `0xFFFF00` | ✓ exact |
  | FFA/4 Green | `0x00FF00` | `0x00FF00` (team 4) | ✓ exact, but port conflates "FFA" with "team 4/green"; source has FFA = no tint (`h0`/black, §2.6) and Green is a distinct 4th team, not a stand-in for FFA. |

  `teamBackColor()` (`palette.ts:98-109`) values (`0x003399`, `0x663300`, `0x996600`,
  `0x006600`) also don't match the measured 50%-value "settled" shades in §2.6
  (`0x1A4D80`, `0x804D00`, `0x808000`, `0x008000`) — they're a different, hand-picked
  "back track" family (reused from the HUD health-bar back-colour convention) rather than
  a half-value derivation of the bright shade.
- **Score/Kills/Deaths column order and skull correct in spirit.** Port's
  `#/Name/Score/Kills/Deaths` order (`ScoresScreen.ts:58-61`) and dead→skull glyph
  (`:112-116`) match Raze 2's column order and the `"Deathmatch"` iconFrame case, but the
  port only implements the dead-skull state — it has no Juggernaught / Domination /
  Capture-the-Flag status-icon states (§2.4, §2.7) and no `ai` alpha-0.7 vs `isHeader`
  distinction beyond a simple boolean (source dims **AI specifically**, not "any
  non-header row" — the port's `row.ai ? 0.7 : 1` at `:88` does get this right, matching
  §2.4's `charAt(0) != "p"` rule).
- **No team-header banner rows / no Elimination "Lives" header swap.** `refreshPauseScores()`
  (`GameScreen.ts:1386-1403`) always builds one flat, un-teamed list sorted by
  `score.value` with no per-team header banners (§2.3's `"h"+team` banner rows) and no
  `MatchSettings.type === "Elimination"` → "Lives" column-label swap.
  `ScoresScreen.ts`'s standalone demo similarly has no team-banner rows.
- **Doc-reference drift in comments.** Several `GameScreen.ts` comments cite "doc 14 §3
  / §4 / §5" for pause-menu behaviour (`:1202`, `:1319`, `:1406`) and `ScoreBoard`'s
  comments cite "doc 14 §5" (`ScoresScreen.ts:36,45`) — doc 14 is *Abilities & Equipment*,
  not Pause/Scores. These should point at this doc (12) once it exists.
- **Button chrome itself (`Raze2Button`/`Raze2Panel`) is a reasonable, if invented,
  dark-glass language** — left accent bar, hover crossfade, `C_SELECTED` pale-yellow —
  but is **not** derived from `PauseScreen`'s actual button-symbol timeline
  (`gotoAndPlay("over"/"out")`, §2.2) since that timeline's frame art wasn't traced for
  this doc; cross-check against doc 08's menu-button findings once written, and reconcile
  any conflicting button-chrome numbers between the two docs.

## 4. Gap analysis

| # | Raze 2 target | Port today | Delta |
|---|---|---|---|
| 1 | Button column (Resume/Scores/Options/Quit) always visible; current tab shown as dimmed 50%-alpha ghost, others fully active | Button column hidden entirely on non-"main" sub-screens | Add persistent column + ghost/"selected" state to non-active tab |
| 2 | Mission title (`txt_mode`) + campaign blurb (`txt_desc`) shown above/alongside scoreboard | Not rendered anywhere | Add title+blurb text block, sourced from match/campaign state |
| 3 | Quit Game → Yes/No confirm sub-frame before actually quitting; cancel returns to View Scores | Immediate `MenuScreen` transition | Add confirm dialog + rage-quit stat hook |
| 4 | Row = full-width vertical-gradient banner (2 flat fills @ α0.298/0.498 + gradient band + hairline stroke, all one hue), no left accent stripe | Flat 50%-alpha rect + 3px left accent stripe | Redraw `ScoreBoard.buildRow()` background per §2.5 |
| 5 | Header row per team ("`h`+team", bright/100%-value shade) *and* one "h0" neutral header for column titles / FFA | Single dark-glass header row only, no per-team banner rows | Add team-banner row type distinct from the column-title header |
| 6 | Team bright colours: Blue `0x3399FF`, Orange `0xFF9900`, Yellow `0xFFFF00`, Green `0x00FF00`; row/settled colours at exactly 50% value of each | `teamColor`/`teamBackColor` hand-picked, Blue and all "back" values off-spec | Recompute `teamBackColor` as `bright × 0.5` per channel; fix Blue to `0x3399FF` |
| 7 | FFA (`teams` 0/1) = no team tint, black/grey `h0`/`0x1A1A1A` rows | Port treats "FFA" as team-4/green | Separate FFA (neutral) styling from Team 4 (Green) |
| 8 | Score column text is pale gold `0xFEFDB4`; Name/Kills/Deaths/# are white | All columns render in a single computed `fill` (team colour or header colour) | Force Score column fill to `0xFEFDB4` always |
| 9 | Row status icon (`mc_skull`) has ≥5 states: None / Juggernaught / Domination (on-point or defending flag) / Deathmatch (dead) / Capture the Flag | Only a dead→skull glyph | Add `isJug`/`onPoint`/`defendingFlag`/`hasFlag` → icon state mapping; source real icon art (currently a Unicode ☠ placeholder, `ScoresScreen.ts:42`) |
| 10 | Elimination-type matches show "Lives" instead of "Score" in the header | Header always says "SCORE" | Branch header label on `MatchSettings.type` |
| 11 | Row pitch 30px, +5px extra gap after each team block, row restarts index at 1 per team | Port uses `ROW_H = 30` (matches pitch) but single flat list, no per-team index reset / extra gap | Rework row-layout loop for team matches |
| 12 | AI rows dimmed to α0.7, human/header rows full — keyed off `human` flag matching frame-label's `charAt(0) === "p"` | Port's `row.ai ? 0.7 : 1` already matches this rule | No change needed — already correct |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Rework `GameScreen.showPauseSub()` to keep `pauseMain` always visible; add a
   `setSelected`/ghost-alpha treatment (reuse `Raze2Button.setSelected`/`setEnabled`,
   already present at `Raze2Button.ts:97-108`) to the button matching the active sub-screen
   instead of toggling the whole column's visibility. Content panels (`pauseScores`,
   `pauseOptions`) become an overlay/inset region beside the column, not a full replace.
2. Add a title/blurb text block (mission name + campaign description, falling back to
   "Quick Match" / empty per §2.3) to both `GameScreen`'s pause-scores sub-screen and
   `ScoresScreen`, sourced the same way `PauseScreen.as:236-237` does
   (`MatchSettings.isCampaign ? MatchSettings.matchName : "Quick Match"` /
   `MatchSettings.matchDesc`).
3. Add a Quit-confirm mini-dialog (Yes/No) gating the existing Quit Game action in
   `GameScreen.ts:1243-1248`; "No" returns to the Scores sub-screen per source
   (`PauseScreen.as:514-516`), not to "main".
4. Rewrite `ScoreBoard.buildRow()`'s background draw (`ScoresScreen.ts:77-85`) to the
   two-flat-fill + gradient-band + hairline-stroke look in §2.5, dropping the 3px accent
   stripe. Force the Score column's text fill to `0xFEFDB4` regardless of team/header
   (`ScoresScreen.ts:118`).
5. Add a `TeamHeaderRow` variant (bright/100%-value team colour, showing team name +
   team total score, Kills/Deaths blank) distinct from the neutral `#/Name/Score/Kills/
   Deaths` column-title header, and wire `refreshPauseScores()`/`ScoresScreen` to emit one
   per team in team-mode matches, mirroring the `displayScoreBars()` control flow in §2.3
   (including the per-team index reset and +5px block gap).
6. Recompute `src/ui/raze2/palette.ts`'s `teamBackColor()` as an exact 50%-per-channel
   value of `teamColor()` (i.e. `(c >> 1) & 0x7f7f7f` style halving) instead of the current
   hand-picked values; correct `C_TEAM1` to `0x3399FF` (currently `0x00CCFF`). Separate the
   "FFA / team 0" path (neutral black/grey, §2.6) from "Team 4 / Green" — they are
   currently conflated via the `default:` branch in `teamColor()`/`teamBackColor()`
   (`palette.ts:84-109`).
7. Extend `ScoreRow` (`ScoresScreen.ts:28-39`) with the four status flags
   (`isJug`, `onPoint`/`defendingFlag`, `hasFlag`, in addition to existing `dead`) and
   replace the Unicode `☠` (`:42`) with real icon art once symbol461's frames are traced
   (see §6 — frame↔label mapping still unresolved).
8. Branch the header cell label ("Score" vs "Lives") on match type, per §2.3.
9. Fix the stray "doc 14" comment references (`GameScreen.ts:1202,1319,1406`;
   `ScoresScreen.ts:36,45`) to point at this doc.
10. Cross-check `Raze2Button`/`Raze2Panel` chrome numbers against doc 08 once written;
    reconcile any conflicts (button label font/size, alpha constants) rather than keeping
    two independently-invented sources of truth for the same dark-glass button look.

## 6. Open questions / data still missing

- **Reference screenshot #7 is missing from disk** for this session (see §2.9). Every
  layout/proportion claim here comes from AS3 + FFDec SVG frame data, not a visual
  render; re-verify column widths, exact panel background art, and font faces against the
  screenshot (or a fresh FFDec/SWF render) once available.
- **`ScoreBoardBar` frame↔label mapping is inferred from block/shade counting, not
  authoritative frame labels** — FFDec's per-frame SVG export doesn't carry `FrameLabel`
  tags. The 15-frames-per-team / 4+4+7-shade grouping in §2.6 is a strong pattern match
  but the *exact* frame ranges for `"h1"` vs `"p1"` vs `"a1"` within each 15-frame block
  weren't individually confirmed. Recommend opening `raze-2.swf` in FFDec's GUI (frame
  panel shows labels directly) or dumping the SWF tag stream for `DoABC`/`FrameLabel` tags
  on symbol462 to pin this down before implementing per-state row art.
- **`mc_skull` (symbol461, 8 frames) frame↔iconFrame-label mapping is completely
  unresolved** (§2.7) — need the same FFDec frame-label trace for symbol461's 8 frames
  to know which of the 7 non-blank shapes is Juggernaught/Domination/Deathmatch/
  Capture-the-Flag (there are 3 more shapes than named states; likely leftover/unused
  art, but unconfirmed).
- **`0x806600` in the FFA/neutral block (§2.6, frames 5-8) doesn't fit the 100/80/50%
  tri-tone pattern the four numbered teams follow** — possibly a stray authoring
  placeholder, possibly a genuine 5th UI state (e.g. an FFA "leader"/first-place row
  highlight) never wired to an AS3 label in the traced code. Needs the same FFDec
  frame-label trace to resolve.
- **Absolute (not relative) pixel positions for `ScoreBoardBar`'s columns** weren't
  derivable from the exported SVGs alone — the `<use>` transforms for text fields sit in
  a different local coordinate space than the background bar's `<use>` transform (the
  bar is flipped/scaled, the text isn't). §2.5's offsets are safe for column *order and
  proportion* but should be re-measured (e.g. via a quick FFDec stage render) before
  hard-coding pixel values.
- **`PauseScreen`'s button-symbol `"over"`/`"out"` timeline animation** (§2.2,
  `EnterFrame()`) wasn't traced frame-by-frame — the port's hover crossfade in
  `Raze2Button.redraw()` is an invented approximation, not a measured one. Low priority
  (doc 08 likely covers the canonical button hover look for the whole UI system) but
  flagged so the eventual doc-08/doc-12 reconciliation (checklist item 10) doesn't miss it.
- **`gamedone`/win-loss credit-bonus frame** (`PauseScreen.as:213-233`, `txt_credits`,
  `Match Bonus`/`Win Bonus` text, `UT.rand` credit formula) shares this same clip but is
  arguably its own end-of-match-reward domain — not covered here; flag for doc 15
  (systems index) or a follow-up spec if it needs its own doc.
