# Systems Index (Catch-All for 100% Coverage)

## 1. Summary

This document is the catch-all for every Raze 2 system not already covered by docs 01-14:
game modes (win rules, scoring, teams) and the achievement-unlocked special modes; AI
behavior (difficulty, targeting, navigation, objective play); the kill-bonus catalog and
credits economy; achievements; the skins catalog; maps/themes; music/SFX; and
ambient/weather/blood/corpse FX. Each section cites the exact AS3 source, the current port
file, and the gap between them. Several subsections (game modes, AI, kill bonuses, maps)
are large enough to warrant a dedicated future spec — flagged in each section and summarized
in §7.

## 2. Game modes

### 2.1 Source of truth

`MatchSettings.as` (585 lines, `decompiled_swf/raze 2/scripts/MatchSettings.as`; `_2` pair is
byte-identical). Mode is a single string field `MatchSettings.type`. There is **no** separate
"Team Deathmatch" or "Team Elimination" type string — those are Deathmatch/Elimination played
with `MatchSettings.teams >= 2`. Supporting files: `Score.as` (scoring), `Menu.as` (play-setup
presets/mode list), `NodeHoldpoint.as` (Domination), `NodeCtfFlag.as` (CTF), `Unit.as`
(Juggernaut), `KillPoints.as` (bonus/credit hooks), `Arena.as` (wiring flags/nodes per mode).

| Mode (`type` string) | Win condition | Scoring | Teams | Mode entity |
|---|---|---|---|---|
| **Deathmatch** — `"Deathmatch"` (default, `MatchSettings.as:173`) | `pscore >= winScore`; default `winScore=20` (`:174`); UI presets `[15,20,25,50,100,5]` (`Menu.as:2084-2085`) | `Score.addKill()`: `pscore = kills - suicides - betrayals` (`Score.as:142-145`) | 1 (FFA) or 2-4 teams, `teamsMin/teamsMax = 1/4` (`Menu.as:1930-1931`) — "Team DM" = same mode, `teams>=2` | none |
| **Elimination** — `"Elimination"` | Lives = `winScore` per unit/team (`Score.as:95-97`); FFA unit is out at `pscore==0` (`MatchSettings.as:491-503`); team is out when shared `elimTeamScoreN` hits 0 (`:548-566`); presets `[10,15,20,25,3,5,7]` (`Menu.as:2087-2088`) | `pscore = lives`, decremented in `Score.addDeath()` (`Score.as:223-236`) | FFA or team (same axis as DM) — "Team Elim" = `teams>=2` | none |
| **Domination** — `"Domination"` | Team `pscore >= winScore`; presets `[50,75,100,150,200,250,25]` (`Menu.as:2090-2091`); forces `teamsMin=2` (`Menu.as:1957`) | Every `30*3` frames (~3s) the capturing team's `pscore += 1` (`MatchSettings.as:398-421`, `fc % (30*3) == 0`); capturer also gets `score.domCap += 1` (`NodeHoldpoint.as:64-73`) | 2-4 teams | `NodeHoldpoint`: fields `curTeam`, `unitCaptured`; `capture()` slides a gauge `-80→-35`, flips ownership once `flag.y >= -25`, decays if abandoned (`NodeHoldpoint.as:40-90`) |
| **Capture the Flag** — `"Capture the Flag"` | Exactly 2 teams (`teamsMin=teamsMax=2`, `Menu.as:1962-1963`); team `pscore >= winScore`; presets `[3,5,7,10,15,25]` (`Menu.as:2093-2094`) | `NodeCtfFlag.capture()` sets `unitCaptured` on touch (`NodeCtfFlag.as:51-72`); returning it to own stand grants `+1 pscore` and `+1 score.flagCap` (`:73-97`) | Exactly 2 | `NodeCtfFlag`: `flag`, `id`, `team`, `unitCaptured`; wired via `Arena.flag1`/`flag2`/`ctfflags`, only populated when `type=="Capture the Flag"` (`Arena.as:913-943`) |
| **Juggernaught** — `"Juggernaught"` (verbatim source spelling, not "Juggernaut") | FFA only (`teamsMax=1`, `Menu.as:1973`); `pscore = kills >= winScore`; presets `[10,15,20,25,30]` (`Menu.as:2099-2109`) | `pscore=kills`, no suicide/betrayal penalty; killing the current Juggernaut awards the `"jugKill"` bonus, 15 pts, "Juggerkill!" (`KillPoints.as:133-135`; `Stats_KillBonuses.as:63`) | Nominally 1 (FFA), but `Unit.setJug()` internally force-splits all units into two teams so friendly-fire/scoring logic works (`Unit.as:373-403`) | No separate node class — `Unit.isJug` flag (`Unit.as:59`); `setJug()` (`:351-405`) sets the flag, reassigns teams, heals to `999`, plays the jug animation; on death the killer (or a random unit on suicide) becomes the new Juggernaut (`:279-322`); initial pick at match start: `if(MatchSettings.type=="Juggernaught"){ UT.randEl(units).setJug(); }` (`Game.as:182-185`) |

**Unimplemented stub mode:** `"Protection"` is listed in the play-setup UI (`Menu.as:1965-1969,2096-2098`, description literally `"-- Not used --"`) but no code anywhere branches on it — it is a dead entry, not a real mode.

### 2.2 Special modes (achievement-unlocked modifiers)

Base always-available list is `["None","Infinite Clips"]` (`Menu.as:249`); each further entry
is appended only if its gating achievement id is in `SD.achievements` (`Menu.as:250-265`).

| Exact string | What it modifies | Achievement gate | Key citations |
|---|---|---|---|
| `"Infinite Clips"` | `MatchSettings.creditMod -= 0.6` (credits penalty; ammo reserve is unlimited, magazines still reload) | none — always selectable | `Menu.as:2028-2031` |
| `"Infinite Ammo"` | `creditMod -= 0.9`; magazines never empty | id `"ammo"`, name **"I hate nature!"**, desc "Trim the foliage." (`Stats_Achievements.as:107-111`). Reward tuple in the achievement data is `["mode","Unlimited Ammo"]` (`:110`) — a naming mismatch vs. the `"Infinite Ammo"` string the game logic actually checks; treat `"Infinite Ammo"` as canonical. | `Menu.as:250-253,2032-2035` |
| `"lol cats"` | Alternate sky background (`Arena.as:795`); blood particle set forced to `"bloodRainbow"` regardless of skin (`Bullet.as:205`); adds a physics tilt check (`PhysActor.as:89`); kill-feed text swapped for jokes: `"Omg hax:"` prefix, `"LOL NOOB"`, random lol/lmao popups (`KillPoints.as:69,241-243,257`) | id `"cat"`, name **"Oh Hi Kitty"**, desc "'lol' at the secret lol cat." (`Stats_Achievements.as:97-101`) | `Menu.as:254-256` |
| `"4x Health"` | `Status.hpMax = 400` instead of `100` (`Status.as:81`); `creditMod -= 0.5` | id `"health"`, name **"Love is Blind"**, desc "Dance with the jolly heart." (`Stats_Achievements.as:102-106`) | `Menu.as:258-261,2049-2058` |
| `"Moon Corpses"` | `PhysWorld` gravity `y=2` instead of `10` for the whole match (`PhysWorld.as:63`) | id `"moon"`, name **"Reach for the Sky"**, desc "Until you touch the moon." (`Stats_Achievements.as:112-116`) | `Menu.as:262-265` |

Master achievement resolution order (also governs the special-modes unlock order in the UI):
`achOrder = ["cat","health","ammo","moon","humanwin","alienwin","abilities","equipment","bonus1","bonus2"]` (`Stats_Achievements.as:39`).

### 2.3 Current port state

- `raze-ts/src/screens/PlayScreen.ts:60` and `raze-ts/src/game/Campaign.ts:46` — modes ported
  as short codes `"dm" | "tdm" | "elim" | "telim" | "ctf" | "dom" | "jug"` (no `"Protection"`
  stub carried over — correctly dropped).
- DM/TDM: ranking `raze-ts/src/game/Match.ts:115-121`; score-cap check
  `raze-ts/src/screens/GameScreen.ts:1736-1774` (`checkScoreCap`).
- Elim/TElim: fully implemented — `Match.ts:81-89` (`livesLeft()`), `:92-95` (`canRespawn()`),
  FFA + team-pool variants, `endGame` calls at `:126-136,143-154`.
- CTF: `raze-ts/src/game/Objectives.ts:90-119` (`tickCtf`) — touch radius `CTF_TOUCH=46`px,
  capture increments `game.teamScore[team]`, flag auto-returns if the carrier dies (`:92-97`);
  win check `GameScreen.ts:1743-1750`.
- Domination: `Objectives.ts:121-156` (`tickDom`) — touch radius `DOM_TOUCH=62`px,
  capture-flip timer `DOM_CAPTURE=30` frames (a discrete flip, **not** the source's `-80→-35`
  gauge-slide-with-decay mechanic); tick interval `DOM_TICK=90` frames does match the source's
  `30*3` exactly.
- Juggernaut: `raze-ts/src/game/Unit.ts:386-417` (`setJug`/`removeJug`),
  `raze-ts/src/game/AI.ts:413-419` (bots target `SD.matchSettings.curJug` directly),
  `PickupItem.ts:122,147,226`, `GameScreen.ts:446,472`, `PlayScreen.ts:60,307`. **Deviates from
  source**: instead of `heal(999)` + full team reassignment, the port grants a shield
  multiplier `shMax = 1000*diffMod*shMult` (`Unit.ts:395-397`) and tracks a separate `jugTeam`
  flag rather than reshuffling all units into two teams (`Unit.as:373-403`).
- Special modes: touchpoints exist across `GameScreen.ts`, `Guns.ts`, `Status.ts`, `Unit.ts`,
  `PlayScreen.ts`, and `assets/raze2/achievements.json`, confirming the data is present, but
  they were not verified line-by-line in this pass (out of scope here — verify in the
  dedicated follow-up, §7).

### 2.4 Gap analysis

- Domination capture mechanic is a simplified discrete flip vs. source's continuous
  gauge-slide-with-decay — measurable behavior difference (instant flip at 30 frames vs.
  gradual `-80→-35` slide that can be interrupted/reversed mid-capture).
- Juggernaut team-handling differs structurally (shield multiplier vs. heal-to-999 +
  team-reassignment) — needs a decision on which model the port keeps long-term.
- "Protection" stub mode correctly not ported; no action needed.
- Special-mode wiring (`"lol cats"` sky/blood/kill-feed swaps, `"Moon Corpses"` gravity,
  `"4x Health"` hpMax, `"Infinite Ammo"`/`"Infinite Clips"` creditMod) needs a line-by-line
  port-vs-source pass; not confirmed complete here.
- `creditMod` penalty stack (weapon-set restrictions, special modes, tutorial maps) is not
  confirmed ported at all — see §3 credits economy gap.

### 2.5 Implementation checklist (future build phase)

1. Replace `Objectives.ts` Domination flip-timer with a gauge model matching
   `NodeHoldpoint.as:40-90` (slide range, decay-on-abandon).
2. Reconcile Juggernaut model: either implement full team-reassignment (`Unit.as:373-403`) or
   formally document the shield-multiplier substitute as an intentional simplification.
3. Audit `"lol cats"`/`"4x Health"`/`"Moon Corpses"`/`"Infinite Ammo"`/`"Infinite Clips"` against
   `Status.ts`, `Guns.ts`, `PhysWorld`-equivalent, and kill-feed text for completeness.
4. Port the `creditMod` penalty stack from `Menu.as:1999-2069` (weapon-set restriction, special
   mode, tutorial-map penalties) into the credits payout path.

### 2.6 Open questions

- Is the Domination gauge-slide worth preserving exactly, or is the discrete flip an accepted
  simplification? Flag for a dedicated `06b-domination.md` or fold into 06.
- Does the port need "Protection" as a placeholder for a future mode, or should it stay absent?

**This subsystem (2.1-2.2) is large enough to deserve its own future spec** (`XX-game-modes.md`)
covering full win/scoring/team rules and every special-mode effect in exhaustive detail — this
section is a compressed index of it.

---

## 3. AI behavior

### 3.1 Source of truth

`AI.as` (639 lines, `class AI extends Unit`; `AI_2.as` is identical).

**Difficulty scaling** — `setDiffStats()` (`AI.as:85-97`), driven by a single `diff` int
0-10 (`:78`):

| Constant | Formula | Line |
|---|---|---|
| `diffRev` | `10 - diff` | 87 |
| `standNormal` | `0.01*(diffRev*0.3)` | 88 |
| `standTarget` | `0.03*(diffRev*0.3)` | 89 |
| `standFlag` | `0.005*(diffRev*0.3)` | 90 |
| `shotChance` | `diff*0.29+0.1`; forced to `1000` when `diff==10` | 91-95 |
| `aimSpeed` | `0.3*(diff*0.1+0.1)` | 96 |

Fire-rate gate (`:620-632`): `shootSpd = 0.05 + (1 - min(gun.curGun.shootDelay,0.9))*0.2;
shootSpd *= shotChance; if(status.sRapid) shootSpd *= 2;` and only fires
`if(game.gameStarted && target && diff)` — **`diff==0` bots never shoot at all.**

**Targeting** (`:386-455`): nearest-visible-enemy re-evaluated on a staggered cadence
(`getTargetTimer==getTargetEvent`, per-bot stagger `(i+1)*2` frames, `:74-77,386`). Filters:
skip self/dead/same-team/invisible units; require `dist < min(gun.curGun.range*10, 450)`
(`:390-412`). Line-of-sight is a 20px-step raycast via `mov.hitTest`, skipped entirely for
burrow weapons (`gun.curGun.extra.burrow`, `:419-445`). Closest surviving candidate wins
(`:447-455`). Aim direction lerps at `aimSpeed`; idle look-around uses fixed `0.4`/`0.3`
constants (`:457-474`). Campaign special-case: if `!matchInfo.extra.aimPlayer`, ignore
`target` and aim at `game.player` at a fixed `0.8` rate instead (`:365-383`).

**Navigation** — waypoint graph + DFS pathfinding, no steering/flowfield:
- `NodeWaypoint.connects` adjacency lists populate `Arena.waypoints` (`AI.as:168,232,250,267`).
- `getNextWaypoint()` (`:143-224`) follows a computed path or a random `connects` pick.
- `getClosestWp()` (`:226-252`) does a same-row nearest-x search, triggered when stuck
  (`wpTimer >= 30*4`, `:340-343`).
- `pathFind()` (`:263-284`) + recursive `searchNode()` (`:286-313`) run an exhaustive DFS
  building `NodeWaypointPath` objects sorted by `dist`, picking randomly among the top
  `spread+1` candidates.
- Movement toward the target waypoint uses threshold steering (`nextWp.x ± 30`); jump/duck
  decided via `actionBoxes[i].action` values `"j"`/`"d"` (`:548-565,598-618`).

**Objective behavior**:
- CTF: `moveToObjective()` pathfinds to the enemy flag waypoint (30% chance per re-evaluation
  when not carrying it, always when carrying it home) (`:114-141,158-161`); flag-defense
  stand/duck near own stand for `irand(2,5)*30` frames (`:496-523`).
- Domination: camp/contest inside a static `240x200` box centered on each holdpoint for
  `irand(1,8)*30` frames if it isn't already owned by the bot's own team (`:479-495`).
- Elimination: `if(MatchSettings.type=="Elimination" && !score.lives) return;` — a dead-out AI
  simply stops updating; no respawn logic branch needed (`:351`).
- Juggernaught: no explicit branch — behavior falls out naturally from the team-reassignment
  done in `Unit.setJug()`, since normal targeting/aggression logic already treats the
  Juggernaut as an enemy of the reassigned opposing team.

**Personalities/chatter**: none exist. Only generic HUD kill-feed strings fire on events
(flag/hold/juggernaut/kill-streak messages in `NodeCtfFlag.as:70,89`, `NodeHoldpoint.as:61`,
`Unit.as:404`, `Score.as:183,219`), plus two hardcoded name-joke kill-bonus checks for players
named `"Juice-Tin"`/`"AddisonR"` in `KillPoints.as:201-208`. Bot names are drawn from a fixed
pool `MatchSettings.botnames` (`MatchSettings.as:143-149`); difficulty (`diff` 0-10) is the
**only** per-bot behavioral axis — there is no personality/archetype system.

### 3.2 Current port state

`raze-ts/src/game/AI.ts` (641 lines).

- `setDiffStats()` formulas ported verbatim **except** `aimSpeed`: the port implements
  `0.3*(diff*0.01+0.1)` (`AI.ts:167`) with an inline comment calling the source's `diff*0.1`
  term "a typo." The decompiled source literally reads `aimSpeed = 0.3*(diff*0.1+0.1)`
  (`AI.as:96`) — this is a real 10x scale discrepancy the port's own comment disputes without
  citing evidence. Needs reconciliation: play-test both to determine which produces
  Raze-2-authentic aim tracking speed.
- Targeting/objective-goal logic (`raze-ts/src/game/Objectives.ts:160-194`,
  `ctfGoal`/`domGoal`, consumed by `AI.ts:420-422`) is functionally analogous to source but
  uses different geometry: circular 62px/30-frame Domination contest zone vs. source's static
  240x200 box (see §2.3/§2.4 above — same discrepancy as the Domination capture mechanic).
- Elimination's zero-lives AI freeze (`AI.as:351`) is handled generically via
  `Match.canRespawn()`/`livesLeft()` for both player and AI (`Match.ts:81-99`), rather than as
  an AI-local early-return — functionally equivalent, structured differently.
- No bot personality/chatter-trigger system in the port — correctly matches source, which has
  none beyond generic kill-feed text.
- Waypoint/pathfinding DFS logic was not verified line-by-line against `AI.as:143-313` in this
  pass; presence of an `AI.ts` waypoint system is confirmed but fidelity is unverified.

### 3.3 Gap analysis

- `aimSpeed` formula discrepancy (10x) — highest-priority reconciliation item, directly affects
  gameplay feel/difficulty curve.
- Domination contest geometry (circular vs. box) — same fix as game-modes gap.
- Pathfinding fidelity unverified — needs a dedicated read-through of `AI.ts` waypoint code vs.
  `AI.as:143-313`.

### 3.4 Implementation checklist (future build phase)

1. Resolve the `aimSpeed` constant: read `AI.ts:159-167` in full context, test both formulas
   in-engine, pick one, and remove the disputing comment either way (document the decision).
2. Verify `AI.ts` waypoint/DFS pathfinding against `AI.as:143-313` for the same-row nearest-x
   search, stuck-detection timer (`30*4` frames), and top-`spread+1` random pick behavior.
3. Align Domination AI camp geometry with whatever model §2.5 step 1 lands on (box vs. circle).

### 3.5 Open questions

- Confirm intended `aimSpeed` scale with a play-test comparison against original SWF (FFDec or
  Flash Player emulation) before committing to a fix.

**This subsystem is large enough to deserve its own future spec** (`XX-ai-behavior.md`)
covering the full waypoint/pathfinding algorithm, per-mode objective state machine, and a
complete difficulty-constant table — this section is a compressed index of it.

---

## 4. Kill-bonus catalog and credits economy

### 4.1 Source of truth

`Stats_KillBonuses.as` (byte-identical to `Stats_KillBonuses_2.as`), data built in `Init()`
(lines 29-91) via `addBonus(id, worth, name, desc)`. Extracted catalog:
`raze-ts/src/assets/raze2/killBonuses.json` — verified as a 30-entry array matching the AS3
order and values exactly, no discrepancies found.

| # | Name | Points | Internal id | AS3 line |
|---|---|---|---|---|
| 1 | Headshot! | 4 | `headMult` | 36 |
| 2 | Crotch Shot! | 5 | `crotchMult` | 43 |
| 3 | Butt Shot! | 12 | `buttMult` | 44 |
| 4 | Assassin! | 10 | `assassin` | 45 |
| 5 | Suprise! | 8 | `burrowMult` | 46 |
| 6 | Direct Hit! | 3 | `splashDirect` | 53 |
| 7 | Splish Splash! | 5 | `splashIndirect` | 54 |
| 8 | Spree Ender! | 10 | `spreeEnd` | 61 |
| 9 | Reflection! | 4 | `reflect` | 62 |
| 10 | Juggerkill! | 15 | `jugKill` | 63 |
| 11 | Show Stopper! | 10 | `hasFlag` | 64 |
| 12 | Slasher! | 4 | `sword` | 65 |
| 13 | Hot Hot Hot! | 2 | `fire` | 66 |
| 14 | Haunted! | 5 | `dead` | 67 |
| 15 | Embarrassing! | 2 | `mauser` | 68 |
| 16 | Chill Pill! | 4 | `chill` | 69 |
| 17 | Kill Steal! | 2 | `steal` | 70 |
| 18 | Disco Inferno! | 3 | `onfire` | 78 |
| 19 | Mine your step! | 3 | `mine` | 79 |
| 20 | Capture King! | 5 | `domKill2` | 80 |
| 21 | Defender! | 5 | `domKill` | 81 |
| 22 | Juiced! | 2 | `juice` | 82 |
| 23 | Rad! | 2 | `rad` | 83 |
| 24 | Survivor! | 3 | `survive` | 84 |
| 25 | Speed Shot! | 5 | `speed` | 85 |
| 26 | Show Off! | 5 | `hasFlag2` | 86 |
| 27 | What Shield? | 5 | `noShield` | 87 |
| 28 | What was that? | 12 | `invis` | 88 |
| 29 | Corpslosion! | 15 | `corpsestick` | 89 |
| 30 | Thanks! | 10 | `refBounce` | 90 |

### 4.2 Credits economy hooks

- Base kill value: `points = 4 + victim.diff * 0.8` (`KillPoints.as:55`).
- Each triggered bonus adds `bonusOb[id].worth` directly onto `points` (`KillPoints.as:343-344`)
  — 1:1 point-to-credit, no separate currency conversion.
- CTF/Domination modes halve the total: `points = Math.ceil(points * 0.5)` (`KillPoints.as:220-230`).
- Global multiplier: `points = Math.ceil(points * MatchSettings.creditMod)` (`:231`).
- `creditMod` starts at `1` and is penalized by match settings (`Menu.as:1999-2069`), e.g.
  `weaponsUsed=="Starters"` → `-0.1`, `"Long Range"` → `-0.35`,
  special mode `"Infinite Ammo"` → `-0.9`, `"Infinite Clips"` → `-0.6`, `"4x Health"` → `-0.5`,
  `map.id=="tutq"/"tutq2"` → `-1` (tutorial maps pay zero credits), clamped to a minimum of `0`;
  the play-setup UI warns "you will earn -X% credits."
- Equipment "Point Allocator" (`Stats_Equipment.as:67`, cost 600) adds a flat `+2` credits per
  kill (`KillPoints.as:73-81`).
- Payout is immediate per-kill (`SD.credits += points`, `Hud.as:713-719`), not an end-of-match
  batch conversion. No dedicated `Credits.as`/`Economy.as` class exists — the economy is spread
  across `KillPoints.as`, `Menu.as`, and `Stats_Equipment.as`.

### 4.3 Current port state

`raze-ts/src/game/KillBonus.ts` (74 lines):
- Imports `RAZE2_KILL_BONUS_BY_ID` from `raze-ts/src/assets/raze2` — catalog is fully ported.
- `BASE_POINTS = 4` constant present, but the file's own header comment states the formula is
  "4 + diff*0.8" while only the flat `4` constant is defined at top level — verify the `*0.8`
  scaling term is actually applied where `BASE_POINTS` is consumed (not confirmed in this
  pass; file was only partially read).
- `MAX_BONUSES = 3` cap documented as "matches Raze 2" (not independently verified against
  `KillPoints.as` in this pass).
- Header comment explicitly states: "Only the bonuses detectable from the port's current
  mechanics are wired up; the rest (fire/mine/sticky/reflect/flag/domination) light up
  automatically as those systems are ported" — i.e. the port author already flags that several
  of the 30 bonuses (`onfire`, `mine`, `reflect`, `hasFlag`, `hasFlag2`, `domKill`, `domKill2`,
  `corpsestick`, `refBounce`, etc.) are **not yet triggered** even though their data exists.

### 4.4 Gap analysis

- `creditMod` penalty stack (weapon-set restriction, special-mode penalty, tutorial-map zero)
  not confirmed ported anywhere — likely missing entirely (no `creditMod` hits were found in
  the port research pass).
- CTF/Domination half-credits rule (`* 0.5`) not confirmed ported.
- "Point Allocator" equipment flat +2/kill bonus not confirmed ported.
- Per the port's own comment, roughly 9 of 30 kill-bonus triggers (fire/mine/sticky/reflect/
  flag-carrier/domination-related) are stubs waiting on their owning systems (fire status,
  mines, sticky projectiles, CTF/Domination) to land — track against docs 02/06/15§2 as those
  systems complete.

### 4.5 Implementation checklist (future build phase)

1. Port the `creditMod` calculation (`Menu.as:1999-2069`) into match setup and apply it in the
   kill-payout path.
2. Apply the CTF/Domination `*0.5` credit halving in `KillBonus.ts` or wherever total points
   are finalized.
3. Wire the remaining bonus detectors (`onfire`, `mine`, `reflect`, `hasFlag`, `hasFlag2`,
   `domKill`, `domKill2`, `corpsestick`, `refBounce`) as their prerequisite systems (fire DoT,
   mines, CTF, Domination, reflect projectiles) land — cross-ref docs 01/02/06 and §2 above.
4. Port "Point Allocator" equipment's flat +2 credits/kill hook.

### 4.6 Open questions

- Confirm whether `BASE_POINTS` in `KillBonus.ts` actually applies the `victim.diff * 0.8` term
  or only the flat `4` — requires reading the full 74-line file, not done in this pass.

---

## 5. Achievements

### 5.1 Source of truth

`Stats_Achievements.as`; `achOrder` (line 39):
`["cat","health","ammo","moon","humanwin","alienwin","abilities","equipment","bonus1","bonus2"]`.
Extracted catalog: `raze-ts/src/assets/raze2/achievements.json` — verified identical
field-for-field (`id`, `name`, `desc`, `rew:[type,value]`).

| Name | Condition | Reward | AS3 line |
|---|---|---|---|
| Oh Hi Kitty | Click the secret lol cat | Mode: "lol cats" | 98-100 |
| Love is Blind | Dance with the jolly heart | Mode: "4x Health" | 103-105 |
| I hate nature! | Trim the foliage | Mode: "Unlimited Ammo" | 108-110 |
| Reach for the Sky | Touch the moon | Mode: "Moon Corpses" | 113-115 |
| A New Hope | Complete human campaign | +500 credits | 118-120 |
| A New Era | Complete alien campaign | +1000 credits | 123-125 |
| Versatile | Purchase 4 abilities | +300 credits | 128-130 |
| Toolkit | Purchase 3 equipment (per category) | +300 credits | 133-135 |
| Stylish | Unlock 15 kill bonuses | +500 credits | 138-140 |
| Kill Enthusiast | Unlock 30 kill bonuses | +800 credits | 143-145 |

`setAchievement()` (`Stats_Achievements.as:178-237`) guards duplicate unlocks via
`SD.achievements.indexOf`, plays `S_Medal`, and applies `SD.credits += rew[1]` when
`rew[0]=="credits"` (line 225). The `bonus1`/`bonus2` triggers fire externally from
`KillPoints.as:348-355` (`SD.bonusesOwned.length >= 15/30`).

### 5.2 Current port state

`raze-ts/src/game/Achievements.ts` (143 lines): data + award logic ported into a `MEDALS`
record keyed by achievement id, `Medal` interface carries `name/desc/icon/rew`, sourced from
`raze-ts/src/assets/raze2/achievements.json`. Header comment notes the original class was both
data table and MovieClip popup animation; the port splits popup rendering out to a
`MedalPopup` interface injected by the UI layer, with `S_Medal` sound wired through the same
hook. Cross-ref: rewards of type `"mode"` should map onto the special-modes table in §2.2 (this
was the mechanism recorded as `SD.modesUnlocked` per the port's own comment at
`Achievements.ts:23-24`).

### 5.3 Gap analysis

- Not independently re-verified against the 10-row table above beyond the JSON diff already
  confirmed; treat as low-risk/complete pending a full playtest of all 10 unlock conditions.

### 5.4 Implementation checklist

1. Confirm all 10 unlock *conditions* (not just data) are actually detected somewhere in the
   port (e.g. is "Toolkit" — 3 equipment per category — actually checked, or only the reward
   table ported?). Not verified in this pass.

---

## 6. Skins catalog

### 6.1 Source of truth

`Stats_Skins.as` (identical `_2.as`), single `Init()` block (lines 58-117), fields
`frame/id/cost/blood/race/name`. Extracted catalog: `raze-ts/src/assets/raze2/skins.json` —
verified identical, 31 entries, same order/values. `blood` is literally a field named `blood`
(`Stats_Skins.as:39`) with values `bloodHuman`/`bloodAlien`/`bloodRobot`/`bloodZombie` — a
gore-particle-palette key, functioning as a blood type even though it isn't a literal
medical blood type.

| Name | Race | Cost | Blood | AS3 line |
|---|---|---|---|---|
| Raze Soldier | Human | 0 | bloodHuman | 58 |
| Covert Ops | Human | 0 | bloodHuman | 59 |
| Cpt. Biggs | Human | 50 | bloodHuman | 60 |
| Space | Human | 50 | bloodHuman | ~63-67 |
| Camouflage | Human | 50 | bloodHuman | 73 |
| Soldier | Human | 50 | bloodHuman | 74 |
| Soldier (Alt) | Human | 50 | bloodHuman | 75 |
| Johnny Rockit | Human | 100 | bloodHuman | 76 |
| Johnny Rambo | Human | 100 | bloodHuman | 77 |
| Miner | Human | 100 | bloodHuman | 78 |
| Dani | Human | 100 | bloodHuman | 79 |
| Dani (Helmet) | Human | 100 | bloodHuman | 80 |
| AddisonR | Human | 250 | bloodHuman | 81 |
| Juice-Tin | Human | 250 | bloodHuman | ~82-91 |
| Albino Alien | Alien | 150 | bloodAlien | 92 |
| Desert Alien | Alien | 150 | bloodAlien | 93 |
| Marine Alien | Alien | 150 | bloodAlien | 94 |
| Space Alien | Alien | 150 | bloodAlien | 95 |
| Jungle Alien | Alien | 150 | bloodAlien | 96 |
| Commander Alien | Alien | 200 | bloodAlien | ~97-106 |
| Desert Bot | Robot | 150 | bloodRobot | 107 |
| Space Bot | Robot | 150 | bloodRobot | 108 |
| Mining Bot | Robot | 150 | bloodRobot | 109 |
| Snow Bot | Robot | 200 | bloodRobot | 110 |
| Jungle Bot | Robot | 200 | bloodRobot | 111 |
| Urban Zombie | Zombie | 150 | bloodZombie | 112 |
| Beach Zombie | Zombie | 150 | bloodZombie | 113 |
| Elderly Zombie | Zombie | 150 | bloodZombie | 114 |
| Biker Zombie | Zombie | 200 | bloodZombie | 115 |
| Biker Zombie (Alt) | Zombie | 200 | bloodZombie | 116 |
| Mutate | Human | -1 (not purchasable — special unlock) | bloodZombie | 117 |

(Lines marked `~` are obfuscated push/pop blocks in the decompile; exact line pinned to the
nearest unambiguous statement — re-run FFDec on `Stats_Skins.as` if exact line numbers are
needed for those rows.)

### 6.2 Current port state / gap

Not independently re-verified beyond the JSON diff (already confirmed identical to source).
Cross-ref doc 05 (player movement/rig) and 03 (visuals) for how `blood` keys map to particle
color; not confirmed whether the port's blood particle system reads this field per-skin or
uses a single global blood color. **Flag for verification** in a build-phase pass.

---

## 7. Maps and themes

### 7.1 Source of truth

`Stats_Maps.as`/`Stats_Maps_2.as` — **both decompiler-corrupted**: the `getMap()` switch body
(lines 44-67) collapsed to only a `"test"` fallback case, so per-map name/theme/description
string data is lost from the decompile. Recoverable field names: `id, map, bg1, bg2, sky,
particles, name, desc`. `mapOrder` (line 41) confirms **16 intended maps**:
`jungle, jungle2, city, city2, desert, desert2, ocean, ocean2, mines, mines2, space, space2,
snow, snow2, tutq, tutq2`.

Port geometry: `raze-ts/src/assets/raze2maps.json` has entries for only **10 of the 16** map
keys (`jungle, jungle2, city, desert, ocean, mines, mines2, space, snow, tutq`) — missing
`city2, desert2, ocean2, snow2, tutq2`. Its fields are `w, h, mask, bg, spawns[], ctf[],
hold[], pickups[], jumpPads[]` — there is no `theme`/`sky`/size-label field; "size" must be
inferred from `w × h`.

| Map | w × h | bg asset | Spawns | CTF pts | Jump pads |
|---|---|---|---|---|---|
| jungle / jungle2 | 2874×2025 | jungle_bg.png / jungle2_bg.png | 30 | 2 | 4 |
| city | 2867×1867 | city_bg.png | 26 | 2 | 4 |
| desert | 2757×1335 | desert_bg.png | 26 | 2 | 1 |
| ocean | 2161×1921 | ocean_bg.png | 30 | 2 | 2 |
| mines / mines2 | 2351×1965 | mines_bg.png / mines2_bg.png | 30 | 2 | 3 |
| space | 2849×2848 | space_bg.png | 33 | 2 | 2 |
| snow | 2809×2018 | snow_bg.png | 27 | 2 | 2 |
| tutq | 2806×2023 | tutq_bg.png | 27 | 2 | 1 |

**Water/reflection**: no per-map `water`/`reflection` field exists; instead `Water.as` is a
runtime wave-simulation `Shape` (`blendMode = "hardlight"`, line 48) attached per-map via
`game.water`, driven by `Stats_MapParticles.as`'s per-map switch — e.g. case `2` (jungle,
lines 423-469) spawns `"water"` splash particles at fixed coordinates and calls
`game.water.startWaveAtPos(...)`; case `4` (ocean, lines 492-534) does the same.

**Sky/ambient**: driven entirely by `Stats_MapParticles.as`'s per-map-id switch in `mapInit()`
(lines 60-310) and per-frame in `EnterFrame()` (lines 313-851) — e.g. jungle spawns "fairy"
idle lights + "fish" particles at named coordinates; ocean/ocean2 (lines 277-310) spawn only
"fish"; snow/snow2 (lines 782-849) spawn `"snow"` fall particles, gated behind the
`SD.graphPart` graphics-quality setting.

### 7.2 Current port state

- `raze-ts/src/assets/raze2maps.json` — 10/16 maps have full geometry (spawns/CTF
  points/holdpoints/pickups/jump pads); the 6 missing (`city2, desert2, ocean2, snow2, tutq2`)
  need extraction, presumably as variants reusing the base map's geometry with different
  visual dressing.
- No evidence found (in this pass) of a ported water-wave simulation, sky/ambient particle
  system (fairy lights, fish, falling leaves, snow), matching `Stats_MapParticles.as`.

### 7.3 Gap analysis

- 6 of 16 maps missing entirely from the port's map data.
- Water wave simulation (`Water.as`) not confirmed ported.
- Per-map ambient particle system (`Stats_MapParticles.as`, fairy/fish/leaf/snow/spark) not
  confirmed ported — this overlaps with §8 particles/FX below.
- Because `Stats_Maps.as` itself is decompiler-corrupted, map *names/descriptions/theme labels*
  cannot be recovered from AS3 directly — may need to source from `Menu.as` map-select UI
  strings (not checked in this pass) or reference screenshots.

### 7.4 Implementation checklist (future build phase)

1. Extract geometry for the 6 missing map variants (`city2, desert2, ocean2, snow2, tutq2`) —
   likely near-identical to their base map with different `bg`/particle sets.
2. Recover map display names/theme descriptions from `Menu.as` (map-select carousel) since
   `Stats_Maps.as` itself is corrupted.
3. Port `Water.as` wave simulation for ocean/jungle/mines maps if visual fidelity matters.
4. Port `Stats_MapParticles.as` ambient effects per map (see §8).

### 7.5 Open questions

- Confirm map theme/size labels via `Menu.as` map-select screen strings or reference
  screenshots — not sourced in this pass.

**This subsystem is large enough to deserve its own future spec** (`XX-maps-catalog.md`)
enumerating all 16 maps' full geometry, particle wiring, and water usage — this section is a
compressed index of it, and the missing 6 variants + `Menu.as` name recovery should happen
before that spec is written.

---

## 8. Audio

### 8.1 Source of truth

No `Sound*.as` class family exists; the central handler is `SH.as`. Each clip is its own
`[Embed]`-wrapped `Sound` subclass named `S_*` (SFX) or `M_*` (music), e.g. `M_Menu.as:5`:
`[Embed(source="/_assets/2114_M_Menu.mp3")]`.

**Music** — `SH.as:85-86`:
`songList = [M_Rose, M_Rocket, M_Warhead, M_Throwdown, M_Necro, M_Ricochet, M_Theloop, M_Infernal]`
`songNames = ["Rose at Nightfall","Rocket Race","Warhead","Throwdown","Necromancy","Ricochet Love","The Loop that Wasn't","Infernal Signs"]`

| Track | Context | Citation |
|---|---|---|
| M_Menu | Main menu, no-play screen | `Menu.as:111`, `NoPlay.as:15` |
| M_MenuIntro | Intro screen | `Intro.as:101` |
| M_Rose / M_Rocket / M_Warhead / M_Throwdown / M_Necro / M_Ricochet / M_Theloop / M_Infernal | In-match, random or jukebox-advanced | `Hud.as:198-221` (`curSongNum = UT.irand(0,songList.length-1)`, or fixed `MatchSettings.song`) |
| M_Rose | Default/fallback match-start music | `Game.as:550`: `SH.playMusic(M_Rose,true)` |
| M_Warhead | Cutscene default + campaign story beats | `Cutscene.as:197`, `Stats_Campaign.as:1754` |
| M_Ricochet | Campaign story beats | `Stats_Campaign.as:1661,2264` |

No distinct victory/defeat jingle was found — end-of-match appears to keep match music playing
(no `playMusic` call found on the score screen).

**SFX categories** (each an `[Embed]` `Sound` subclass, one .as file per clip):

| Category | Representative classes |
|---|---|
| Weapon fire | `S_pistolFire, S_assaultFire, S_uziFire, S_shotgunFire, S_sniperFire, S_alienSniper, S_plasmaFire, S_ripperFire, S_rocketFire, S_laserBig, S_Whip` |
| Reload | `S_reloadPistol, S_reloadRifle, S_reloadShotgun, S_reloadSniper, S_reloadHeavy, S_reloadRocket` |
| Impact/feedback | `S_rocketExplode, S_GunClick, S_Headshot1/2/3, S_Medal, S_Static, S_Zapper` |
| Pickups/abilities | `S_Heal, S_Powerup, S_Jumppad, S_Equip` |
| UI | `S_Click, S_ClickGo, S_ClickBack, S_Error` (routed through `SH.playSound(...)`, e.g. `Menu.as:437,438,510,517,540,541,569`) |
| Misc/easter egg | `S_CamelJizz` (`Intro.as:95`), `S_Fire`, `S_Laser` |

`SH.as:89-97` `playSound()` gates on `SD.sound` and applies one of two `SoundTransform` volume
presets (`soundVol=0.4`, `soundVolLoud=0.7`). `SH.as:99-129` `playMusic()` cross-fades old/new
track at `0.025`/frame (`SH.as:137,152,158`).

### 8.2 Current port state

`raze-ts/src/audio/Sounds.ts` — fully ported: `MANIFEST` (lines 29-104) includes every R2
`S_*`/`M_*` asset with original numeric-prefixed filenames preserved, plus an `ALIASES` map
(lines 120-167) redirecting legacy Raze-1 play-ids onto R2 assets. `MATCH_MUSIC`
(lines 175-178) reproduces the 8-track `songList`. The port **adds** systems the original
never had: distance/pan spatialization (`spatial()`, lines 361-381), synthesized one-shots for
footsteps/landing/whoosh/fanfare (`playSynth`, lines 456-543 — net-new, no AS3 equivalent),
and a per-level procedural ambience bed (`AMBIENCE` table, lines 202-212, keyed by
`city/space/toxic/pit` — Raze 2 had no such ambient-bed system).

### 8.3 Gap analysis

- Audio is essentially at parity or ahead of source (spatialization/ambience are enhancements,
  not gaps).
- No end-of-match jingle exists in source either, so its absence in the port is not a gap.

### 8.4 Implementation checklist

- None required for parity; audio is functionally complete. Optional: confirm cross-fade timing
  (`0.025`/frame) matches port's music-transition implementation if that detail matters.

---

## 9. Particles/FX not covered by doc 03 (ambient, weather, blood, corpse/ragdoll evaporation)

### 9.1 Source of truth

No plural `Effect_*.as` family exists — only a single generic `Effect.as` (identical `_2.as`):
a sprite-sheet animation player (`EnterFrame`, lines 40-59) that advances a frame counter and
self-removes when `frame > stats.frames` (line 55). All named ambient effects (fairy lights,
fish, leaves, embers, snow, water splashes) are dispatched through `game.createParticle(...)`
calls driven by `Stats_MapParticles.as` (see §7.1) rather than dedicated per-effect classes.

**Ragdoll/corpse physics** — `PhysWorld.as`:
- Gravity: `new b2Vec2(0, MatchSettings.specialMode=="Moon Corpses" || param2 ? 2 : 10)`
  (line 63) — `10` normal, `2` under the "Moon Corpses" special mode (§2.2).
- Solver iterations: `m_velocityIterations = 10`, `m_positionIterations = 10` (lines 38, 40).

**Corpse lifetime / evaporation trigger** — `PhysActor.as`:
- `EnterFrame()` line 197: `if(fc == 4 * 30) { physWorld.physVap.vaporize(this); ... }` — a
  corpse ragdoll persists exactly **120 frames (4 seconds @ 30fps)** before vaporization
  triggers.
- `destroy()` (line 204+) tears down all Box2D bodies/parts.

**Corpse dissolve effect** — `PhysVap.as`:
- Renders the corpse into a 100×100 `BitmapData` (lines 54, 79, 127, 189) with a `GlowFilter`
  (color ~`0x16737792`→`0xFF6600`-ish, blur 4×4, strength 1, quality 1, line 60).
- Full pixel-dissolve only triggers when `SD.graphRagev` (ragdoll-evaporation graphics
  setting) is true (line 77); otherwise `target.destroy()` fires immediately (line 117) — a
  graphics-quality gate.
- Dissolve mechanic: samples every non-transparent pixel into a `pixels` array
  (lines 100-113); each frame peels up to **40 pixels/frame**
  (`while(_loc1_ < 40 ...)`, line 129) into a `leavers` array that floats upward and fades
  (`ymov -= yspd`, line 152) until `ymov < -ymax` (line 158), then removes itself. Finishes
  (`doneVap()`) once `pixels.length==0 && leavers.length<20` (line 168).
- `vapList` queues multiple corpses; off-screen queued corpses are destroyed immediately
  without the effect (`!physWorld.game.onScreen(...,100)`, line 176).

No evidence of dedicated blood-particle or weather (rain/wind) classes beyond the
map-specific `snow`/`water`/`leaf`/`fairy`/`fish`/spark(ember) particle types spawned via
`Stats_MapParticles.as`; gore coloring is driven purely by the skin's `blood` field (§6)
feeding the generic particle system, not a separate blood-FX class.

### 9.2 Current port state

Not verified in this pass — no port-side ragdoll-evaporation or ambient-particle files were
located/confirmed. Doc 03 (weapon visuals/FX) may cover impact particles, but corpse
evaporation, per-map ambient particles (fairy/fish/leaf/snow/water-splash), and the "Moon
Corpses" gravity hook into ragdoll physics are all unconfirmed in the port.

### 9.3 Gap analysis

- Corpse evaporation (120-frame lifetime + pixel-dissolve-upward effect) — no confirmed port
  equivalent. This is a visually distinctive Raze 2 signature (bodies visibly disintegrate
  upward in floating pixels) and should not be silently dropped.
- Per-map ambient particles (§7) — no confirmed port equivalent.
- "Moon Corpses" gravity hook (§2.2) depends on whatever physics engine backs ragdolls in the
  port — needs to be wired the same way `PhysWorld.as:63` does.

### 9.4 Implementation checklist (future build phase)

1. Implement corpse lifetime timer (120 frames) + a pixel-dissolve-upward effect approximating
   `PhysVap.as` (BitmapData sample → per-frame upward-floating fading pixel peel, 40px/frame,
   graphics-quality-gated fallback to instant removal).
2. Implement per-map ambient particle spawns (fairy/fish/leaf/snow/water-splash) per
   `Stats_MapParticles.as`'s per-map switch, gated behind a graphics-quality setting
   (`SD.graphPart` equivalent).
3. Wire "Moon Corpses" special mode into whatever ragdoll gravity constant the port uses.

### 9.5 Open questions

- Does the port have a ragdoll physics system at all (Box2D or equivalent)? Not confirmed in
  this pass — if it doesn't, corpse evaporation is blocked on ragdoll physics existing first
  (cross-ref doc 05, player movement/rig, and check for any `Phys*.ts` port file).

**This subsystem (corpse evaporation + ambient particles) is large enough to deserve its own
future spec** (`XX-ambient-fx.md`) once ragdoll physics status is confirmed — this section is a
compressed index of it.

---

## 10. Summary of subsystems recommended for a dedicated future spec

| Subsystem | Why | Suggested filename |
|---|---|---|
| Game modes + special modes (§2) | 7 modes × win/score/team rules + 5 special-mode effects, each with multiple hook points across many classes | `XX-game-modes.md` |
| AI behavior (§3) | Full waypoint/DFS pathfinding algorithm + per-mode objective state machine warrants exhaustive treatment beyond this index | `XX-ai-behavior.md` |
| Maps catalog (§7) | 16 maps × geometry/theme/particles/water, 6 of which are missing from the port entirely and need re-extraction | `XX-maps-catalog.md` |
| Ambient/corpse FX (§9) | Distinctive pixel-dissolve corpse evaporation + per-map ambient particle systems, contingent on ragdoll-physics status | `XX-ambient-fx.md` |

Kill bonuses (§4), achievements (§5), skins (§6), and audio (§8) are considered adequately
covered by this index plus their existing JSON catalogs / port files and do not need dedicated
specs, aside from the specific gaps called out in each section's Gap Analysis.
