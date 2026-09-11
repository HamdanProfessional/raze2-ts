# 09 — AI & Bots (Raze 2)

Source of truth: `decompiled_swf/raze 2/scripts/AI.as` (639 lines, extends `Unit.as`), plus
support classes `NodeWaypoint.as`, `NodeAiAction.as`, `NodeWaypointPath.as`, `NodeSpawn.as`,
`NodeHoldpoint.as`, `NodeCtfFlag.as`, `NodePickup.as`, `MatchSettings.as`, `Game.as`,
`Guns.as`, `Unit.as`. All line numbers reference the non-`_2` (readable) copies.

**Important scope note up front:** Raze 2's `AI.as` is a single flat per-frame decision
routine, not a discrete state-machine (no `state` enum, no `idle/patrol/chase/attack/flee`
tags anywhere in the class). Behaviour is derived by reading the code in execution order.
Also: **Raze 2 has no bot personality/chatter/taunt system.** `Personality.as` and its
"gamer/military/alien/zombie/robot/angry/leet/noob" categories exist only in **Raze 1**
(`decompiled_swf/raze 1/scripts/Personality.as`) — there is no equivalent file, string, or
call anywhere in Raze 2's decompiled sources (verified via case-insensitive grep for
`personality`, `taunt`, `chatter` across all Raze 2 `.as` files). See "Personality/chatter"
section below for what Raze 2 actually has instead (a campaign-only scripted "speak" hook)
and where the port's system actually comes from.

## 1. Bot lifecycle & construction

`AI.as:74-97`

```
AI(game, botData, getTargetEvent, getTargetMax)
  getTargetEvent = param3      // this bot's target-scan phase offset
  getTargetMax   = param4      // scan cycle length shared by all bots
  diff = botData.diff          // 0..10 difficulty, comes from MatchSettings bot record
  super(game, botData)         // Unit constructor (spawns MC, gun, status, etc.)
  status.sSpawn = 0
  setDiffStats()
  path = "@@"                  // sentinel: "no CTF path currently queued"
```

Bots are created in `Game.as:176-181`:
```
for i in 0..MatchSettings.bots.length:
    createUnit(new AI(this, MatchSettings.bots[i], (i+1)*2, MatchSettings.bots.length*2))
```
So `getTargetEvent` staggers each bot's expensive target-rescan to a different frame
(`(i+1)*2`) within a shared cycle (`bots.length*2` frames) — bots do **not** all
re-evaluate targets on the same frame, spreading the O(n²) scan cost across frames.

`spawn()` override (`AI.as:99-107`): sets `aimX = x+100, aimY = y-50`, `status.sSpawn = 30`
(1 spawn-invuln second), resets `getTargetTimer = 0` and `target = null`.

`setAiSpawnNode()` (`AI.as:109-112`): on spawn, calls `getNextWaypoint(spawnNode.waypoint, true)` —
bots start walking from whatever `NodeWaypoint` is attached to their `NodeSpawn`.

## 2. Difficulty scaling — `setDiffStats()` (`AI.as:85-97`)

`diff` is an integer 0..10 stored per-bot (`MatchSettings.addBot`, see §7). All difficulty
knobs derive from it:

| Field | Formula | Effect |
|---|---|---|
| `diffRev` | `10 - diff` | "inverse difficulty", used for crouch/duck timers |
| `standNormal` | `0.01 * (diffRev * 0.3)` | per-frame chance to duck/crouch while no target, not carrying flag |
| `standTarget` | `0.03 * (diffRev * 0.3)` | per-frame chance to duck while target is set |
| `standFlag` | `0.005 * (diffRev * 0.3)` | per-frame chance to duck while carrying the flag |
| `shotChance` | `diff * 0.29 + 0.1`; **if `diff == 10` → `1000`** | multiplier on fire probability (see §6) |
| `aimSpeed` | `0.3 * (diff * 0.1 + 0.1)` | lerp factor for aim tracking toward target (higher = snaps to target faster/more accurately) |

Numeric table for all `diff` values 0..10:

| diff | diffRev | standNormal | standTarget | standFlag | shotChance | aimSpeed |
|---|---|---|---|---|---|---|
| 0 | 10 | 0.030 | 0.090 | 0.015 | 0.10 | 0.030 |
| 1 | 9 | 0.027 | 0.081 | 0.0135 | 0.39 | 0.033 |
| 2 | 8 | 0.024 | 0.072 | 0.012 | 0.68 | 0.036 |
| 3 | 7 | 0.021 | 0.063 | 0.0105 | 0.97 | 0.039 |
| 4 | 6 | 0.018 | 0.054 | 0.009 | 1.26 | 0.042 |
| 5 | 5 | 0.015 | 0.045 | 0.0075 | 1.55 | 0.045 |
| 6 | 4 | 0.012 | 0.036 | 0.006 | 1.84 | 0.048 |
| 7 | 3 | 0.009 | 0.027 | 0.0045 | 2.13 | 0.051 |
| 8 | 2 | 0.006 | 0.018 | 0.003 | 2.42 | 0.054 |
| 9 | 1 | 0.003 | 0.009 | 0.0015 | 2.71 | 0.057 |
| 10 | 0 | 0 | 0 | 0 | **1000** (guaranteed) | 0.060 |

Notes:
- `diff == 0` is a special "dummy" case: `EnterFrame` gates most active behaviour behind
  `if(diff)` (`AI.as:330,548,620`) — a `diff` of 0 bot never walks toward waypoints, never
  uses grenade/mine/teleport abilities reactively (those checks are also behind `!diff`
  early-return in `Unit.doAbility`, `Unit.as:1159-1162`), and never shoots (`if(...&&diff)` gate
  at `AI.as:620`). It still ducks/stands per `standNormal/standTarget/standFlag` and still
  tracks aim toward the player when `matchInfo.extra` forces `aimPlayer` mode off (see §9).
- `diff == 10` bypasses the probabilistic fire gate entirely (`shotChance = 1000`, so
  `Math.random() < shootSpd` — where `shootSpd` itself is capped by gun cooldown scaling —
  is effectively always true once the gun's cooldown allows it).
- `standTarget` (crouching while actively fighting) is always **3x** `standNormal` and
  **6x** `standFlag` for the same diff — bots are much more likely to take a crouched pose
  mid-fight than while idly patrolling, and le
ast likely to crouch while flag-carrying (they want to keep moving).

## 3. Target acquisition (`AI.as:315-475`, inside `EnterFrame`)

### 3.1 Scan cadence
```
getTargetTimer wraps at getTargetMax (bots.length*2)
++getTargetTimer only if diff != 0
```
The actual target search block only runs `if(getTargetTimer == getTargetEvent)` — i.e.
once per full cycle, on this bot's assigned offset frame (`AI.as:386`).

### 3.2 Candidate filter (`AI.as:388-418`)
For every `game.units[j]` (excluding self):
1. Skip if `dead`.
2. Skip if same non-zero team (`team && team == other.team`) — FFA (`team==0`) never
   filters by team.
3. Skip if target has `status.sInvis` (cloaked).
4. Compute `dist = UT.getDist(...)`. Keep only if
   `dist < Math.min(gun.curGun.range * 10, 450)` — i.e. capped at 45 world-units
   regardless of how long-range the current gun is.
5. Store `{dist, unit, rot}` in a candidate array.

### 3.3 Line-of-sight filter (`AI.as:419-446`)
Skipped entirely if the bot's current gun has `curGun.extra.burrow` (burrowing/mine-type
weapons apparently don't need LOS to "see" a target — no wall check performed).
Otherwise, for every remaining candidate, march a ray from bot to candidate in **20-unit
steps** (`_loc5_ += 20`) calling `mov.hitTest(dx, dy-50)`; if any step hits solid geometry,
the candidate is dropped. This is a coarse, stepped raycast (not a continuous shape cast) —
gaps up to 20 world-units between samples can miss a corner.

### 3.4 Selection
Remaining candidates are sorted by `dist` ascending; **nearest visible enemy wins**,
full stop. There is **no threat-priority weighting** — no scoring for "player vs bot",
low-health targets, flag carriers, or the Juggernaut crown holder. (Confirmed no
Juggernaut-specific target code anywhere in `AI.as`; `Game.as:182-185` only picks who
*becomes* Jug at match start via `UT.randEl(units).setJug()` — from then on Jug is
targeted only if it happens to be the nearest visible enemy.)

If the candidate list is empty, `target = null`.

### 3.5 Target loss
`target` is only cleared by the next scan cycle finding nothing, or (implicitly) by the
target dying — `EnterFrame`'s dead-unit filter (`!game.units[j].dead`) means a freshly
dead target simply won't be re-picked next cycle, but nothing proactively nulls `target`
the instant it dies (the bot keeps aiming at the corpse's last position until the next
scan — see §4, `target.dead` branch).

## 4. Aim model (`AI.as:377-474`)

Aim is a smoothed 2D point (`aimX, aimY`) lerped toward a focus point every frame
(**not** a discrete "aim error cone" — the imprecision comes from lerp lag + the gun's
own recoil-spread, see §4.3).

### 4.1 `aimPlayer` — the scripted-escort override
**Target-based aim is the default. Tracking the human is the opt-in exception.**

The decompiler leaves `AI.as:365-383` as raw stack ops, and the negation is easy to drop
on the way past. The value pushed is the short-circuit
`(!matchInfo.extra || !matchInfo.extra.aimPlayer)`, and the branch guard then *negates*
it, so:
```
if ( matchInfo.extra && matchInfo.extra.aimPlayer )   // scripted escorts only
    aimX/aimY lerp 0.8 toward the human player, always (ignores `target` entirely)
else
    normal target-seeking logic (below)
```
Compare `AI.as:477`, `if(!matchInfo.extra || !matchInfo.extra.noStand)`, which guards its
body with the *same* idiom but without the extra `!` — the negation here is load-bearing.

Corroboration from the data: `campaign.json` sets `aimPlayer` on exactly one unit,
J. Rockit, the tutorial escort, and the mission script later clears it so he stops
keeping his gun on you and starts fighting normally (see doc 10). That only makes sense
if `aimPlayer` means "aim at the player".

> **Do not "fix" this back.** An earlier revision of this section argued the branches were
> inverted, and the port was briefly written as `(!campaign || extra.aimPlayer)`. That
> made every arena bot aim along a line to the human while validating the shot against a
> different unit, so bots fired into walls whenever the player was not on that line.
> Measured after the correction: bots target the human in 0/270 samples, and never fire
> without a target. 0/270 is the fix working, not a bug.

### 4.2 Target-based aim (the default for every ordinary bot)
```
focus = target.dead ? corpse ragdoll position (+10 y) : (target.x, target.y - 50)
aimX += (focusX - aimX) * aimSpeed      // aimSpeed from diff table above
aimY += (focusY - aimY) * aimSpeed
```
No target: aim drifts toward a point extrapolated from the bot's own velocity —
`focusX = x + facingOffset*50 + xVel*10`, `focusY = y - 50 + yVel*8`, lerped at fixed
`0.4`/`0.3` (not diff-scaled) — this is idle "look where I'm walking" behaviour.

### 4.3 Actual bullet spread (outside AI.as, in `Guns.as:447-462`)
This applies identically to bots and the human player — it's not AI-specific, but it's
the mechanism that turns "aim point" into "bullet direction error":
```
bulletRotation = unit.aimRoation + UT.rand(-dynRecoil, dynRecoilMod)
```
`dynRecoil` is set to `curGun.recoil` on weapon switch (`Guns.as:283`) and only
**increases further** when `unit.human` fires (`Guns.as:411-414`, `+0.3` per shot, capped
at `recoil*1.7`) — bots never build up extra recoil-heat from firing, they sit at the
gun's baseline `recoil` value, decaying by `0.05`/frame if above it. `dynRecoilMod` is a
stance multiplier: `crouch ×0.6`, `jump ×1.2`, `moving ×1.1`, `standing still ×1.0`
(`Guns.as:206-227`). Net effect: **bot accuracy per-shot is gun-recoil-bound and stance-modulated
exactly like the player's, but never degrades with sustained fire** the way a human's does.

## 5. Standing/ducking behavior (`AI.as:477-547`)

Applies only if not suppressed (`!matchInfo.extra || !matchInfo.extra.noStand`).

- **Domination**: inside a holdpoint's capture box (`±120x/±150y` around the point) and
  not already `stand`/`nostand`-locked and (`point not owned by me` OR `point.flag > -50`
  i.e. capture animation in progress) → `stand = irand(1,8)*30` frames, `duck = 50%`,
  `nostand = 0`. (`point.flag` is literally the flag-icon MovieClip's `y` offset used as a
  capture-progress proxy in `NodeHoldpoint.as:30,51` — animates from `-80` toward `-25..-35`.)
- **CTF**: inside own flag's box (`±100x/±40y`) and not carrying the flag and not already
  standing → sets `defendingFlag = true`, `stand = irand(2,5)*30`, `duck = 50%`,
  `nostand = stand + irand(0,2)*30`. Clears `defendingFlag` once `stand`/`nostand` both hit 0.
- **General probabilistic duck** (`AI.as:525-530`): if not already stand/nostand-locked,
  not jumping, roll `Math.random() < (hasFlag ? standFlag : (!target ? standNormal : standTarget))`
  → `stand = irand(2,6) * diffRev*0.1 * 30` frames, `duck = 50%`,
  `nostand = stand + irand(2,6) * diff*0.1 * 30` (cooldown before next stand-check can fire).
- While `stand`: decrements every frame; if `duck` is true, holds `DOWN` key.
- While `nostand`: just decrements (blackout window preventing re-triggering stand).

## 6. Firing (`AI.as:620-632`)
```
if game.gameStarted && target && diff:
    shootSpd = 0.05 + (1 - min(gun.curGun.shootDelay, 0.9)) * 0.2
    shootSpd *= shotChance
    if status.sRapid: shootSpd *= 2
    if Math.random() < shootSpd: gun.shoot()
```
So fire probability per frame scales inversely with the current gun's `shootDelay`
(faster guns → bigger base `shootSpd`) and directly with `shotChance` (i.e. `diff`).
`diff==10` sets `shotChance=1000`, making the `Math.random() < shootSpd` check
effectively always pass (shootSpd becomes >> 1). Actual rate-of-fire is still capped by
`Guns.as` internal `shootDelay` cooldown (`gun.shoot()` early-returns while `shootDelay`
is nonzero — `Guns.as:342`), so `diff==10` really means "fires the instant the gun is
off cooldown," not "infinite fire rate."

## 7. Movement / waypoint navigation

### 7.1 Node types (`Node*.as`)
| Class | Role |
|---|---|
| `NodeWaypoint.as` | Named node (`id_connections` from symbol instance name, e.g. `a_bc`), holds `connects: NodeWaypoint[]` and `actionBoxes: NodeAiAction[]` |
| `NodeAiAction.as` | A trigger box tied to a waypoint (`con_action` naming); `action` is `"j"` (single jump) or `"d"` (double/forced jump) |
| `NodeSpawn.as` | Spawn point (`id_team` naming), each references one `waypoint` to route the bot onto the graph after spawning |
| `NodeWaypointPath.as` | Precomputed path result: `path` (string of node-id chars), `nodes` (count), `dist` (summed Euclidean distance along the chain) |
| `NodeHoldpoint.as` | Domination point; `curTeam`, `unitCaptured`, `flag` (capture-progress proxy, see §5) |
| `NodeCtfFlag.as` | CTF flag; `team`, `unitCaptured`, `capture()`/`reset()` |
| `NodePickup.as` | Weapon/powerup spawn; auto-collected by **any** unit (player or bot) walking within `±40x/-80..+70y` of it — no bot-specific pickup-seeking logic exists (see §7.4) |

### 7.2 Waypoint-following state machine (`getNextWaypoint`, `AI.as:143-224`)
- `wpTimer` resets to 0 on any call.
- If `mov.jumping` and not forced (`param2==false`) and `|y - nextWp.y| > 30`: bail out
  (don't reroute mid-jump across a big vertical gap).
- If explicitly given a waypoint (spawn case): `curWp = nextWp; nextWp = given`.
- Otherwise (reached current waypoint naturally):
  - CTF special-case: if `path` is falsy/empty and doesn't start with `@`,
    call `moveToObjective()` to compute a new CTF path (see §7.3).
  - If close enough vertically to `curWp` (`|y-curWp.y| <= 50`, tightened check
    `< 50` inside):
    - If **no active path** (`path` empty or starts with `@`): pick
      `nextWp = UT.randEl(curWp.connects)` — **random walk** across the graph. If `path`
      started with `@`, strip that leading char.
    - Else (mid CTF path): `nextWp = arena.wpOb[path.charAt(0)]`, consume that char from
      `path`; if `path` becomes empty, reset to `"@"` (path-complete sentinel).
  - Else (too far vertically): `getClosestWp()` — resync to nearest same-height waypoint
    by raw x-distance.
- Campaign speak hook: if `curWp` exists and `matchInfo.extra.speak == curWp.id`,
  freezes the bot (`stand = 999999`) and plays `speak_<id>` animation + syncs the HUD
  dialogue box (`game.hud.gotoAndStop(matchInfo.extra.speak)`) — campaign-only scripted
  dialogue trigger, not a general chatter system (see §9).

### 7.3 CTF pathfinding (`moveToObjective`, `pathFind`, `searchNode`, `AI.as:114-141,263-313`)
- `moveToObjective()`: if not carrying the flag, 30% chance per call to check whether the
  enemy flag is still uncaptured, and if so, path to it
  (`pathFind(enemyFlag.id, 5)`); if carrying the flag, always path home
  (`pathFind(ownFlag.id, 5)`).
- `pathFind(targetId, maxRandomPick=5)`: exhaustive DFS (`searchNode`, recursive,
  visited-check via `path.indexOf(char) == -1` to avoid cycles) from every
  connection of `curWp` to `targetId`, collecting all simple paths as
  `NodeWaypointPath` objects, sorted by `dist` ascending, then **randomly picks one of the
  shortest `min(5, count)` paths** (`UT.irand(0, min(param2, len-1))`) rather than always
  the single shortest — adds route variety and unpredictability. Returns the path string
  minus the first character (already-standing-on node).
- Consumed one character per waypoint arrival in `getNextWaypoint` (§7.2).

### 7.4 Actual per-frame walking (`AI.as:548-565`)
Only runs `if(diff)` (diff-0 bots never move):
```
if nextWp.x within ±30 of x: getNextWaypoint()   // arrived, pick next
else if not stand: press LEFT or RIGHT toward nextWp.x
```
Purely horizontal chase of the target waypoint's x — **no dedicated jump decision from
distance/height here**; vertical traversal is handled entirely by `NodeAiAction` trigger
boxes (§7.5) and by `getNextWaypoint`'s jump-bail check (§7.2).

### 7.5 Jump triggers (`AI.as:598-618`)
Only evaluated `if(!stand)`. For every `NodeAiAction` box attached to `nextWp`
(`nextWp.actionBoxes`), if the bot's `(x,y)` is inside that box:
- `action == "j"`: `if(!mov.jumping) mov.doJump()` (single jump, don't stack).
- `action == "d"`: `mov.doJump()` unconditionally (used to chain a double-jump).

There is **no reactive dodge of incoming bullets** anywhere in `AI.as` — jumping is
entirely waypoint/graph-driven (scripted jump zones) plus the ability-ecosystem hooks in
§8. Bots are not aware of incoming projectiles.

### 7.6 Resync / stuck recovery (`AI.as:226-252,340-343`)
- `wpTimer` increments every frame the bot is not jumping/standing/speaking; if it
  reaches `120` frames (4s) without reaching a waypoint, `getClosestWp()` forcibly
  resyncs to the nearest waypoint at the bot's current height (avoids permanent stalls,
  e.g. if physics knocked the bot off its path).
- `getClosestWp()`: filters `game.arena.waypoints` to those within `50` y-units, sorts by
  x-distance, picks nearest; if none found (e.g. mid-air over a gap), falls back to
  `UT.randEl(curWp.connects)`.

## 8. Ability & equipment use (`AI.as:566-597`, dispatch into `Unit.doAbility`, `Unit.as:1151-1305`)

AI-side trigger conditions (all require the bot to currently have that `ability.id`):

| Ability | Trigger condition | Chance/frame |
|---|---|---|
| `teleport` | no target | 2% (`Math.random() < 0.02`) |
| `cloak` | no target | 10% |
| `mine` | no target, not currently `stand`/`nostand` | 10% |
| `sword` | has target AND `dist(bot,target) < Stats_Guns.gunOb["sword"].range * 10` | always (100%, once condition true — no extra roll) |
| `grenade` | has target AND `dist(bot,target) > Stats_Guns.gunOb["sword"].splash` (note: reuses the *sword* stat block's `splash` field as the grenade min-range gate — likely a shared/typo'd constant in the original) | always (100%, once condition true) |

No AI code exists for `static`/`heal`/`ammo`/`none` abilities being *proactively* triggered
by the bot brain — those exist in `Unit.doAbility`'s switch (`Unit.as:1181-1305`) and are
only invoked via the same generic `doAbility()` call path, but `AI.as` never rolls dice for
them, meaning bots effectively **never use `static`, `heal`, or `ammo` abilities** even if
assigned one (per `MatchSettings.addBot`, ability is `UT.randEl(["static","heal","cloak",
"sword","mine","grenade"])` — `static` and `heal` bots are silently passive on that ability).

All ability triggers gate through `Unit.doAbility()`'s own guards (`Unit.as:1151-1180`):
must not be flag-carrying, `diff` must be nonzero, must have enough energy
(`status.hasEnergy(ability.usedEnergy)`), not dead, not `permInvis`, and game must not be
paused/not-yet-started (`game.gameStarted`... actually gated one level up).

### 8.1 Equipment
Bots are assigned up to 3 equipment slots at bot-creation time (`MatchSettings.addBot`,
§9), but there is **no AI-side equipment activation logic** in `AI.as` — Raze 2 equipment
(seen in `Unit.equips` object, e.g. `equips.recoil`, `equips.powerup`, `equips.rof`) is all
**passive stat modifiers** applied automatically inside `Guns.as`/`Unit.as`/`NodePickup.as`
(e.g. `dynRecoil *= unit.equips.recoil` at `Guns.as:286`; `status.sInvin *= equips.powerup`
at `NodePickup.as:206`). There is nothing to "activate" — bots benefit from equipment
passively, identically to how the human player does, with no bot-specific branch.

### 8.2 Weapon pickups
`Unit.as:596-606` (in the shared, non-AI-specific `EnterFrame`/`UnitEnterFrame` path):
any unit standing in a pickup's box (`±40x, -80..+70y`) auto-collects it via
`NodePickup.getPickup(this)`. This runs identically for bots and the player — **bots do
not decide to path toward pickups**; they only benefit if their patrol/CTF-path/combat
movement happens to carry them over one. `NodePickup.getPickup` handles: shield
(`sshield`+50/`bshield`+100), health (`shealth`+50/`bhealth`+100), `invin` (5.5s ×
`equips.powerup`), `damage` (7s × `equips.powerup`), `rapid` (6.5s × `equips.powerup`), or
(default) a weapon clip refill (`gun.addClip(num, ceil(clipMax/2))`) plus cycling the
pickup's next weapon (`setWeapon()`).

## 9. Objective behavior by mode

| Mode (`MatchSettings.type`) | AI-specific handling |
|---|---|
| `"Deathmatch"` | None beyond default target/patrol/combat loop. |
| `"Capture the Flag"` | `moveToObjective()` + `pathFind()` route bots to enemy/home flag (§7.3); flag-defense stand-and-duck behavior near own flag (§5); `standFlag` (very low duck chance) while carrying flag; `hasFlag` gate skips the general random-duck roll's "no target" branch. |
| `"Domination"` | Stand-and-hold behavior inside holdpoint capture boxes when point is contested/not-yet-owned (§5). No explicit "which point to attack" targeting logic in `AI.as` — holdpoint stand-triggers only fire when the bot's patrol/waypoint walk happens to carry it inside a point's box; there is no dedicated "path to nearest uncontrolled point" routine analogous to `moveToObjective()` for CTF. |
| `"Elimination"` | `AI.as:351-354`: if dead and `!score.lives`, the bot's `EnterFrame` returns immediately every frame (no respawn, unit effectively benched) instead of the normal respawn-timer countdown. |
| `"Juggernaught"` | No AI-specific code in `AI.as` at all. `Game.as:182-185` randomly assigns the initial Jug via `UT.randEl(units).setJug()`; thereafter the Jug is just another `Unit` and is targeted by bots only through the ordinary nearest-visible-enemy rule (§3.4) — there is no "everyone hunts the crown" bias in the original game. |

## 10. Bot names & personality/chatter — actual Raze 2 behavior

### 10.1 Names (`MatchSettings.as:143-149`)
`botnames` is a flat array (~60 entries), picked via `UT.randEl` with a uniqueness
re-roll loop (`addBot`, `MatchSettings.as:241-264`) so no two bots in one match share a name:
```
AddisonR, Juice-Tin, ArmorGames, MaestroRage, Slevanator, Dabor, WaterFlame, zircon,
T-Free, NemesisTheory, Jon Beam, Aethos, Xelu, __M@yK__, Toxic Hazmat, Lt.Jeffery,
Tr0llTehZ0rz!, XxTalonxX, Dark_potato57, DaMhillz, XxBlackWolfxX, Tigermund3,
xX-Gamer-Xx, maxwell118, ToxiC KilleR, Mr.Mau5, Mr.Mau5 (duplicate literal entry),
NEMISIS, Dj Sonic56, ShAdOw, Noobinator, El Ducko, Tr00p3r, Lt. Boehlke, DB2016,
Darknight000, EvilSteel, Reignscythe, Da Machinima, Spartan-525, W1nn3r, Mr. Platypus,
GameBuilder15, _Maximum_, Johnny87, Yo Mamma, XxkillaxX, SonicX, Scorpio, McBain, Krum,
PROTECT ME, Mordekaiser, Ezreal, Garen, Bieber
```
Two names are special-cased for skin assignment: bot named `"AddisonR"` always gets
skin index `12`; `"Juice-Tin"` always gets skin index `13` (`MatchSettings.as:283-289`)
— these read as dev/community shout-out easter eggs, not gameplay-relevant.

### 10.2 Bot creation record (`MatchSettings.addBot`, `MatchSettings.as:241-309`)
```
bots.push({
  name:    <unique random botname>,
  diff:    param1,                                  // 0..10 difficulty
  skin:    random skin index (excluding cost<0 / locked skins, with the 2 easter-egg overrides above),
  team:    param2,
  weapons: getRandGuns(),                            // random loadout across all 7 weapon slots
  ability: UT.randEl(["static","heal","cloak","sword","mine","grenade"]),
  equip0:  diff <  7 ? 0 : irand(1,5),
  equip1:  diff >= 5 ? irand(1,5) : 0,
  equip2:  diff <  9 ? 0 : irand(1,5)
})
```
Note the equip-slot gating **by difficulty**: harder bots are more likely to carry
equipment — `equip1` unlocks at `diff>=5`, `equip0` at `diff>=7`, `equip2` (the rarest) only
at `diff>=9`. This is the only difficulty-scaling touchpoint outside `AI.setDiffStats()`.

### 10.3 Personality/chatter — does not exist in Raze 2
Exhaustive search of every Raze 2 `.as` file (case-insensitive) for `personality`,
`taunt`, `chatter`, `speak` found:
- **No `Personality.as`** file in Raze 2 at all (it exists only in `raze 1/scripts/Personality.as`,
  with categories `gamer/military/alien/zombie/robot/angry/leet/noob` and ~20 event types
  `kill/respawn/hurt/spawn/headhurt/reload/teamhurt/ammo/selfhurt/gun/shootBullets/shield/
  shootExplosives/health/shootClose/powerup/shootSniper/teamshoot/headshoot/jug`).
- The only `speak` references in Raze 2 are in `AI.as:196-224` and `Unit.as:790-889`, and
  both are **campaign cutscene plumbing**, not organic bot chatter:
  - `AI.as` checks `matchInfo.extra.speak == curWp.id` to freeze a *specific, scripted*
    bot at a *specific, scripted* waypoint and play a `speak_<id>` animation frame plus
    sync the HUD to a matching dialogue frame — this only fires for campaign levels that
    populate `matchInfo.extra.speak`.
  - `Unit.as:790-889` is tutorial-level scripted dialogue that directly indexes
    `game.units[1]` (a specific, known campaign NPC) and sets `matchInfo.extra.speak`
    to advance a linear cutscene script (`"c"`, `"d"`, `"e"`, `gotoAndStop("speak_follow")`,
    `gotoAndStop("speak_f2")`, `gotoAndStop("speak_f3")`, etc.) — this is bespoke
    per-mission scripting, not a reusable per-personality line table.
- `gamer/military/alien/zombie/robot` **do** appear in Raze 2, but only as **skin
  categories** in `Stats_Skins.as:92-117` (e.g. `addSkin(50,"asnow",150,"bloodAlien",
  "Alien","Albino Alien")`) and matching kill-counter stat fields in `Score.as:39-45`
  (`killedAlien/killedRobot/killedZombie`) — these are cosmetic/stat-tracking categories
  tied to the *skin* a unit is wearing (for blood-effect and stats purposes), unrelated to
  any dialogue/personality system.

**Conclusion: standard Raze 2 skirmish/quickmatch bots never speak.** There is no taunt,
no kill-quip, no spawn-line — only the two campaign-specific scripted hooks above.

## Port status

File: `src/game/AI.ts` (358 lines) + `src/game/Personality.ts` (109 lines).

### Correct
- Waypoint-graph patrol with a "reached → pick next connected node" loop
  (`pickNextNode`) mirrors `getNextWaypoint`'s random-walk branch (`AI.ts:132-149` vs
  `AI.as:168`).
- Waypoint jump-action boxes (`n.actions`, `a.action === "j"`) mirror `NodeAiAction`
  (`AI.ts:338-342` vs `AI.as:598-618`), though the port only implements the `"j"` case, not `"d"`.
  **Gap**: no double-jump / `"d"` action support.
  **Gap**: no equivalent of `NodeWaypointPath`/`pathFind`/`searchNode` DFS route caching — CTF
  goal-seeking is handled by a separate `objectives.ctfGoal(this)`/`domGoal(this)` module
  (`AI.ts:254-261`) rather than graph pathfinding; worth checking that module separately, but
  from `AI.ts` alone there's no analogue of the original's "random among 5 shortest DFS
  paths" route variety.
- Difficulty is a single continuous `diffMod` (jittered, clamped to `[0.5, ceiling]`)
  driving reaction delay, aim wobble, and fire probability together (`AI.ts:236-244,296-322`)
  — a reasonable continuous analogue of `AI.as`'s discrete `diff` 0..10 table, but **not a
  faithful port of the exact formulas**: original `shotChance` has a hard `diff==10 → 1000`
  (guaranteed-fire) special case and a linear `diff*0.29+0.1` ramp; original `aimSpeed` is
  `0.3*(diff*0.1+0.1)` (range 0.03..0.06); the port's analogous constants
  (`AI.ts:240-243,308,321`) are original-feeling but numerically unrelated — acceptable as a
  redesign, but should not be assumed numerically equivalent if exact difficulty parity matters.
- Weapon-range-aware weapon selection (`chooseWeapon`, `AI.ts:168-196`) is a **new** system
  with no Raze 2 analogue — original bots never switch weapons based on AI logic at all
  (nothing in `AI.as` calls `gun.changeGun`/`nextWeapon`); this is a deliberate enhancement,
  not a port gap, but should be flagged as **behavior not present in the source game**.

### Wrong / incomplete vs. source
- **Aim-at-player-by-default is missing.** The single biggest behavioral divergence:
  Raze 2's default (non-campaign) bots aim at the **human player specifically**
  (`aimX/aimY` lerp 0.8 toward `game.player`, `AI.as:377-383`) regardless of `target`,
  and only use genuine per-unit target aiming when a campaign flag (`matchInfo.extra.aimPlayer`)
  is set. The port's `combat()` always aims at `this.target` (`AI.ts:309-314`), i.e. it
  implements the *campaign* branch as if it were the default. In FFA/team matches with
  multiple bots this makes an important qualitative difference (original bots basically
  only genuinely fight the human in most match configs — bot-vs-bot combat still uses
  `target` for the *shoot gate* but always visually/mechanically aims at the player).
  This may be an intentional design change for a "real" multi-bot skirmish experience
  rather than a bug, but it is a deviation worth calling out explicitly since it changes
  core combat feel.
- **No line-of-sight raycast for target acquisition beyond the port's `gun.checkUnitHit`.**
  Need to verify `checkUnitHit`'s implementation (not read in this pass) actually performs
  the stepped wall-hit-test the original does (`AI.as:419-446`, 20-unit-step `mov.hitTest`
  march) rather than a simpler distance/angle check.
- **No `burrow` gun-extra LOS bypass** equivalent found in `AI.ts` — minor, only matters for
  guns with that flag.
- **No difficulty-gated equipment-slot assignment** (original: `equip1` at diff≥5,
  `equip0` at diff≥7, `equip2` at diff≥9, `MatchSettings.as:302-304`) — not present in
  `AI.ts`'s constructor; equipment sourcing for bots should be checked in whatever
  populates `extra` before it reaches this constructor.
- **`standNormal`/`standTarget`/`standFlag` duck/crouch probability system has no port
  equivalent** — `AI.ts` never presses `K.DOWN` to crouch/duck opportunistically; the port's
  `dodgeTimer`-gated jump-hop (`AI.ts:298-302`) is a different mechanic (jump-dodge, not
  duck) with no direct source analogue (original never jump-dodges reactively, only via
  waypoint action boxes) — this is a new behavior replacing an old one, not a bug, but a
  meaningful feel change.
- **Domination stand-and-defend near holdpoints** (`AI.as:479-495`) has no visible
  equivalent in `AI.ts`'s `combat()`/`patrol()` — worth checking the `objectives.domGoal`
  module for whether hold-and-defend behavior lives there instead.
- **Elimination "bench when out of lives"** (`AI.as:351-354`) not visible in `AI.ts`
  (likely lives in `Unit.ts`/`respawn()` instead — `AI.ts` only resets `lowHealthWarned`
  on `respawn()`, `AI.ts:109-112`); should be verified against the base class.
- **Ability triggers only partially represented.** `AI.ts` has no visible per-ability
  proactive-use logic at all (no `doAbility`-equivalent calls in the excerpt read); the
  original's specific per-ability chance table (teleport 2%, cloak 10%, mine 10% w/
  no-target gate, sword/grenade range-gated at 100%) doesn't appear ported. This is a
  **missing feature**, not present anywhere in `AI.ts` as read.

### Missing (present in source, absent from port) or deliberately reinvented
- **Personality/chatter system**: the port's `Personality.ts` (categories `gamer, military,
  alien, zombie, robot, angry, leetnoob`, events `spawn/kill/death/taunt/lowHealth`) is
  **not a Raze 2 feature at all** — it is adapted from **Raze 1's** `Personality.as`
  (which has 8 categories including `noob`/`leet` split, and ~20 event types, vs. the
  port's collapsed 7 categories / 5 events). Standard Raze 2 quickmatch bots are silent.
  This is a deliberate cross-game feature import, not a port bug — but it should be
  labeled in the port's own docs/comments as "Raze 1-derived, not in Raze 2" so a future
  maintainer doesn't go looking for it in Raze 2's `AI.as` (the current `AI.ts` doc-comment
  already says "extended with... personality chatter", which is accurate framing — just
  flagging here that the source-fidelity docs should make the cross-game origin explicit).
- **Random-among-shortest-N CTF pathfinding** (`pathFind`/`searchNode`/`NodeWaypointPath`,
  §7.3) has no visible port equivalent (routing appears delegated to `objectives.ctfGoal`,
  not reviewed in this pass).
- **wpTimer stuck-recovery** (4s timeout → `getClosestWp()`, `AI.as:340-343`) — no
  equivalent stuck-detection visible in `AI.ts`.
- **Bot name list** (`AI_NAMES`/`AI_TAGS` in `AI.ts:32-38`) is an entirely different,
  much shorter set than Raze 2's `botnames` (`MatchSettings.as:143-149`) — reinvented
  rather than ported verbatim; not a bug, but if verbatim Raze 2 names/tags are desired
  for authenticity this list should be replaced.
