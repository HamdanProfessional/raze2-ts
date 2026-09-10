# 11 — Game Modes & Match Settings

Source of truth: `scripts/MatchSettings.as`, `scripts/Menu.as` (Quick Match UI + `setQuickmatchSettings`/`setTeams`/`setWinScore`/`setBotList`), `scripts/Game.as`, `scripts/Score.as`, `scripts/Unit.as`, `scripts/NodeCtfFlag.as`, `scripts/NodeHoldpoint.as`, `scripts/AI.as`, `scripts/Guns.as`, `scripts/Status.as`, `scripts/PhysActor.as`, `scripts/PhysWorld.as`, `scripts/UnitMC.as`, `scripts/Bullet.as`, `scripts/KillPoints.as`, `scripts/Hud.as`, `scripts/Stats_Achievements.as`, `scripts/Stats_Campaign.as`. All line numbers refer to the non-`_2` files under `decompiled_swf/raze 2/scripts/`; the `_2` duplicates are byte-identical for everything cited here.

## 1. The mode set (`MatchSettings.type`)

`MatchSettings.type` is a plain `String`. The Quick Match UI cycles it through exactly this array — there is no numeric mode enum anywhere in the game:

```
["Deathmatch", "Elimination", "Domination", "Capture the Flag", "Juggernaught"]
```
`Menu.as:1071`, `Menu.as:1077`

Note the spelling **"Juggernaught"** (not "Juggernaut") — every reference to the mode string in the codebase uses this spelling (`Game.as:182`, `Unit.as:357/404`, `AI.as`, `Score.as:146`, `Menu.as`).

There is a **sixth, dead mode string** — `"Protection"` — handled in the switch statements of `setQuickmatchSettings()` (`Menu.as:1965-1969`) and `setWinScore()` (`Menu.as:2096-2098`), but it is never added to the `bt_type_prev`/`bt_type_next` cycle array, so a player can never actually select it from the UI. Its own description text literally reads `"-- Not used --"` (`Menu.as:1967`). Treat it as a cut/leftover mode, not a real one.

There is **no separate "Team Deathmatch" or "Team Elimination" mode string.** Instead, Deathmatch and Elimination are parameterized by the separate `MatchSettings.teams` count (see §3) — `teams == 1` is the free-for-all form, `teams >= 2` is the team form of the *same* `type` string. Domination and Capture the Flag are inherently team modes (`teamsMin = 2` is forced, `Menu.as:1957`, `Menu.as:1962`); Juggernaught forces `teamsMax = 1` (`Menu.as:1973`), i.e. its team-count UI is locked to solo/FFA even though internally two Box2D "teams" (1 = the Juggernaught, 2 = everyone else) are assigned by `Unit.setJug()`.

### 1.1 Deathmatch
- **Rule**: kill enemies for points. `Score.addKill()` sets `unit.pscore = kills - suicides - betrayals` (`Score.as:142-145`).
- **Win condition**: FFA (`teams` 0/1) — first unit whose `pscore >= winScore` wins (checked every score update in `MatchSettings.updateScores()`, `MatchSettings.as:505-513`). Team (`teams` 2-4) — first team whose summed `pscore` (`team{N}score`) reaches `winScore` wins (`MatchSettings.as:568-580`).
- **Score cap choices** (win-score cycle values shown in the UI): `[15, 20, 25, 50, 100, 5]`, default `15` (`Menu.as:2085`, `MatchSettings.as:174` sets the baseline default of `20` before any Quick Match screen interaction).
- **UI label**: "Kills to Win" (`Menu.as:1935`/`1700`). Type description: *"Score points by Killing enemies."* (`Menu.as:1936`).

### 1.2 Elimination (a.k.a. Last-Man / Team Elimination via `teams`)
- **Rule**: each unit starts with a bank of lives equal to `winScore` (`Score.as:97`, `winScore` is repurposed as the lives count for this mode) unless `unit.matchInfo.extra.lives` overrides it (used for scripted campaign fights, `Score.as:107-112`). `pscore` **is** the live life count (`Score.as:113`, updated again on every death at `Score.as:230`). Dying decrements `lives`; the unit stays on the sideline once `lives == 0` (its `AI.as:351` idle/give-up branch fires: `if(MatchSettings.type == "Elimination" && !score.lives)`).
- **Team life pool**: for team Elimination, each unit's starting lives are also added into `MatchSettings.elimTeamScore{team}` (`Score.as:114-117`) — but that accumulator is used **only** to size the HUD score-bar denominator (`Hud.as:430-431`), not for win-condition math. Win/lose per-team math re-derives the "any life left" check live off each unit's own `pscore` every frame.
- **Win condition (FFA)**: `MatchSettings.updateScores()` — if the player's `pscore == 0`, the game ends in a loss; else if the best-scoring *other* unit's `pscore == 0`, the game ends in a win (`MatchSettings.as:491-502`). Note this is inverted from Deathmatch: for Elimination, **lower reaching zero first loses**, not higher reaching a cap.
- **Win condition (team)**: your team (`team1score`) reaching `<= 0` total lives loses; if every other active team's total is `<= 0`, you win (`MatchSettings.as:548-566`).
- **Lives choices** (win-score cycle re-purposed as lives): `[10, 15, 20, 25, 3, 5, 7]`, default `10` (`Menu.as:2087-2088`).
- **UI label**: "Lives" (`Menu.as:1939`/`1703`). Description: *"Kill off all the Lives of your enemies and be the last standing."* (`Menu.as:1941`).

### 1.3 Domination
- **Rule**: capture and hold `NodeHoldpoint` control points. Standing alone on a point owned by the enemy (or unowned) slides `flag.y` from `-80` toward `-25` (`NodeHoldpoint.as:44-56`); reaching the threshold flips `curTeam` to the capturing unit's team, records `unitCaptured`, bumps that human player's `score.domCap`, and fires a HUD "Flag Point Captured!" callout (`NodeHoldpoint.as:57-74`). Standing on your own already-owned point instead nudges the marker back toward neutral if contested from the other side (`NodeHoldpoint.as:78-89`) — there's no instant "decapture," only a slow tug-of-war.
- **Scoring tick**: every 3 seconds (`fc % (30*3) == 0` in `MatchSettings.EnterFrame()`, `MatchSettings.as:402-420`) each held point adds **+1** to its `unitCaptured.pscore` (the specific unit that captured it, not the team pool directly — team totals are then summed the normal way in `updateScores()`).
- **Win condition**: same team-score-cap logic as team Deathmatch (`MatchSettings.as:568-580`); Domination is always played with `teams >= 2` (`teamsMin = 2` forced, no FFA form despite `teamsMax` staying at the default `4`).
- **Score cap choices**: `[50, 75, 100, 150, 200, 250, 25]`, default `50` (`Menu.as:2091`).
- **UI label**: "Points to Win". Description: *"Capture Flag areas and earn points based on how many you control."* (`Menu.as:1950-1951`).

### 1.4 Capture the Flag
- **Rule**: `NodeCtfFlag` — touching the enemy's flag (`team != param1.team`, flag not already held) picks it up: sets `unitCaptured`, hides the flag mesh, tags the carrier's ability-slot sprite to `"flag" + team`, and posts a "has taken the Flag!" feed message (`NodeCtfFlag.as:38-53`). Returning to your **own** stand while carrying gives `+1 pscore`, `+1 score.flagCap` (only tallied for the human player, `NodeCtfFlag.as:63-70`), resets the enemy flag back to its stand (`NodeCtfFlag.as:74`, calling `reset()`), and triggers `MatchSettings.updateScores()` immediately (not on the 3-second Domination tick).
- **Flag drop-on-death**: not handled inside `NodeCtfFlag` itself — `Unit.die()` checks `hasFlag` and marks the kill extra (`param3.hasFlag = true`, `Unit.as:319`); the actual flag-reset-on-carrier-death path lives in the corpse/respawn handling (the carrier's `hasFlag` reference is cleared and the flag's `reset()` is invoked once the body is cleaned up).
- **Spawn behavior**: CTF has team-specific spawn pools — `getSpawnNode()` picks from `game.arena["spawnsT" + team]` instead of the shared `arena.spawns` list whenever `MatchSettings.type == "Capture the Flag"` and the unit has a nonzero team (`Unit.as:536-543`).
- **Team count**: locked to exactly 2 (`teamsMin = teamsMax = 2`, `Menu.as:1962-1963`) — CTF is never played with 3-4 sides.
- **Win condition**: standard team-score-cap path (`MatchSettings.as:568-580`).
- **Score cap choices**: `[3, 5, 7, 10, 15, 25]`, default `3` (`Menu.as:2094`).
- **UI label**: "Points to Win". Description: *"Capture the enemy's Flag and return it to your base."* (`Menu.as:1960-1961`).

### 1.5 Juggernaught
- **Setup**: on game start, one random unit (human or bot) is chosen via `UT.randEl(units).setJug()` (`Game.as:181-183`). `setJug()` sets the chosen unit's Box2D team to `1` and flags `isJug = true`, `gotoAndStop("pJug"/"aJug")` (player/AI skin variant), fully heals the new Juggernaught (`status.heal(999,false)`), and reassigns **every other unit** to team `2` with `isJug = false` (`Unit.as:352-403`).
- **Juggernaught perks**: incoming damage to a Jug unit is multiplied by `0.4` (60% damage reduction) in `Status.damage()` (`Status.as:245-247`).
- **Becoming the new Juggernaught**: whoever lands the kill on the current Jug immediately calls `setJug()` on themselves (`param3.jugKill = true; param1.setJug()`, `Unit.as:317-319`). If the Jug suicides, the title passes to a random *other* unit instead (`Unit.as:281-289`).
- **Scoring**: `Score.addKill()` sets `unit.pscore = kills` (cumulative kill count, no suicide/betrayal subtraction, unlike Deathmatch) whenever `MatchSettings.type == "Juggernaught"` (`Score.as:146-149`).
- **Team-count UI**: `teamsMax = 1` (`Menu.as:1973`), i.e. the Quick Match "teams" stepper is locked at `1` (FFA) even though the mode internally splits units into two Box2D teams for damage bookkeeping. Because `MatchSettings.teams` stays `1`, `updateScores()` takes the FFA branch (`case 0/1`) and scores by raw `pscore`, not team totals.
- **Win condition**: plain FFA cap check — first unit (Jug or not) whose `pscore >= winScore` wins (`MatchSettings.as:505-513`).
- **Score cap choices**: `[10, 15, 20, 25, 30]` (`Menu.as:2100-2104`, pushed onto the stack rather than built as a literal array in the decompile, but functionally the same cycle; no explicit default index push was found, effectively defaults to the first value `10` via the same `param1` branch as other modes).
- **UI label**: "Kills to Win". Description: *"Kill the Juggernaught to become him, and then kill everyone else."* (`Menu.as:1972`).

## 2. Special Mode dropdown (`MatchSettings.specialMode`)

`specialMode` is a plain `String`, default `"None"` (`MatchSettings.as:175`). The Quick Match screen builds the selectable list dynamically based on unlocked achievements every time the Quick Match panel is entered (`Menu.as:249-265`):

| Order | Value | Gate | Achievement (name / desc) | Source |
|---|---|---|---|---|
| 1 | `"None"` | always available | — | `Menu.as:249` |
| 2 | `"Infinite Clips"` | always available (**not** achievement-gated) | — | `Menu.as:249` |
| 3 | `"Infinite Ammo"` | `SD.achievements.indexOf(2) != -1` | Achievement #2 "I hate nature!" — *"Trim the foliage."* Reward string in the achievement table is `["mode","Unlimited Ammo"]` | `Menu.as:250-253`, `Stats_Achievements.as:105-108` |
| 4 | `"lol cats"` | `SD.achievements.indexOf(0) != -1` | Achievement #0 "Oh Hi Kitty" — *"'lol' at the secret lol cat."* | `Menu.as:254-257`, `Stats_Achievements.as:96-99` |
| 5 | `"4x Health"` | `SD.achievements.indexOf(1) != -1` | Achievement #1 "Love is Blind" — *"Dance with the jolly heart."* | `Menu.as:258-261`, `Stats_Achievements.as:100-103` |
| 6 | `"Moon Corpses"` | `SD.achievements.indexOf(3) != -1` | Achievement #3 "Reach for the Sky" — *"Until you touch the moon."* | `Menu.as:262-265`, `Stats_Achievements.as:109-112` |

**Naming quirk worth preserving if porting exactly**: the achievement reward table's display string for achievement #2 is `"Unlimited Ammo"` (`Stats_Achievements.as:105`), but the actual `MatchSettings.specialMode` value the game checks everywhere at runtime is `"Infinite Ammo"` (`Menu.as:252`, `Guns.as:416`). They are not the same string — this looks like an unintentional naming drift in the original game between the achievement-unlock UI text and the gameplay flag. The prompt's assumption of a mode literally named `"Unlimited Ammo"` does not match runtime code; the flag Guns.as actually branches on is `"Infinite Ammo"`.

### 2.1 Exact gameplay effect of each special mode

| specialMode | Effect | Source |
|---|---|---|
| `"None"` | No modifiers. | — |
| `"Infinite Clips"` | Reload no longer consumes a spare clip — `reloaded()` skips `--ammo[curNum].clip` unless mode is exactly this string. Magazine size is still finite (you must still reload), only the number of *reloads* is unlimited. | `Guns.as:181-184` |
| `"Infinite Ammo"` | The per-shot ammo deduction (`ammo[curNum].cur -= …`) is skipped entirely (except when the unit already has the `sRapid` status) — effectively unlimited shots without ever reloading. | `Guns.as:415-425` |
| `"lol cats"` | Cosmetic/flavor-only reskin: player heads render as `"cat"` instead of the unit's real skin frame (`UnitMC.as:203`, `PhysActor.as:88-91` for ragdoll heads, `Hud.as:324-333` for kill-feed portraits); blood particle effect becomes `"bloodRainbow"` instead of the skin's normal blood color (`Bullet.as:205`, `Bullet.as:311`); kill-feed text is silly-fied — "Killed by" → "Omg hax:" (`KillPoints.as:69`), "Suicide!" → "LOL NOOB" (`KillPoints.as:257`), and kill-bonus text is replaced by a random `["lol!","LOL!!","omg.","lmao","LMAO!","Rofl","ROFL","BBQ","lolol!","lolz"]` line instead of the normal bonus name (`KillPoints.as:241-243`). Purely cosmetic; no stat changes. |
| `"4x Health"` | `Status.hpMax` is `400` instead of the normal `100` baseline (before any `equips.health` bonus is added on top) — every unit (player and bots) gets 4x max HP. | `Status.as:81-83` |
| `"Moon Corpses"` | Reduces Box2D world gravity from `10` to `2` (only affects the ragdoll/corpse physics world, `PhysWorld` — used for the death-flail "moon gravity" ragdoll effect, not the live-unit movement controller). | `PhysWorld.as:63` |

## 3. Team / bot roster fields

| Field | Type | Meaning |
|---|---|---|
| `teams` | `int` | Number of active sides, `1`-`4`. `1` = free-for-all (all bots + player share "team 0"); `2`-`4` = that many team slots, player always joins `team 1`. Default `1` (`MatchSettings.as:151`). |
| `team0amt`..`team4amt` | `int` | Bot headcount per team slot. Team `0` is the FFA bot pool; teams `1`-`4` are the team-mode slots (player is always an implicit extra member of team `1`, hence the `+1` seen in UI player-count math, `Menu.as:2168`/`2174`/`2178`). |
| `team0diff`..`team4diff` | `int` | Per-team-slot bot difficulty, `2`-`10` in steps of `2` (`Menu.as:1185-1196`), default `6` for the newly-revealed team when `+ Add Team` is pressed (`Menu.as:1908`). Displayed via `getBotDiffString()`: `["Test","Very Easy","Very Easy","Easy","Easy","Medium","Medium","Hard","Hard","Insane","Insane"]` indexed by the raw `0`-`10` diff value (`Menu.as:2253-2255`). |
| `bots` | `Array` | Flattened list of bot descriptor objects (`{name, diff, skin, team, weapons, ability, equip0-2}`) built by `setQuickmatchBots()`/`addBot()` right before the match launches, from the per-team amounts/diffs above. |
| `player` | `Object` | The human player's match-entry descriptor: `name`, `skin`, `weapons` (from `SD.gunList`), `ability`, `equip0-2` — snapshotted from `SD` (persistent save data) via `updatePlayer()`. |

### 3.1 `+ Add Team` / `- Remove Team` and per-mode team bounds
`teamsMin`/`teamsMax` are recomputed every time `setQuickmatchSettings()` runs (mode change, map change, etc.), defaulting to `1`/`4` and then overridden per mode (`Menu.as:1930-1974`):

| Mode | `teamsMin` | `teamsMax` |
|---|---|---|
| Deathmatch | 1 | 4 |
| Elimination | 1 | 4 |
| Domination | 2 | 4 |
| Capture the Flag | 2 | 2 (locked) |
| Protection (dead mode) | 2 | 4 |
| Juggernaught | 1 | 1 (locked) |

`bt_addteam` increments `MatchSettings.teams` (capped at `teamsMax`) and calls `setTeams(true)`, which seeds the newly revealed team slot with `1` bot at difficulty `6` (`Menu.as:1201-1207`, `Menu.as:1899-1913`). `bt_removeteam` decrements `teams` (floored at `teamsMin`) and calls `setTeams(false, true)` (`Menu.as:1208-1212`). `setTeams()` also re-clamps every team's bot amount so the roster never exceeds `12 / teams` players per side (minus 1 for the player's own team slot) (`Menu.as:1915-1920`), and toggles the add/remove button `enabled`/`visible` state at the new bounds (`Menu.as:1922-1923`).

Bot count/difficulty steppers (`bt{N}_bots_next/prev`, `bt{N}_diff_next/prev` for `N` in `0..4`) directly mutate `team{N}amt`/`team{N}diff`, clamped to `[0 or 1, 12/teams (- 1 for team 0/1)]` for headcount and `[2, 10]` for difficulty, then call `setBotList()` to refresh both the live roster (`MatchSettings.setQuickmatchBots()`) and the on-screen player-count/difficulty text (`Menu.as:1155-1200`, `Menu.as:2148-2180`).

## 4. Full `MatchSettings` field reference

All fields are `public static` on the `MatchSettings` class (`scripts/MatchSettings.as:28-139`) unless noted as instance (`public var`, attached per-`Game`).

| Field | Type | Default (`Init()`, `MatchSettings.as:141-182`) | Purpose |
|---|---|---|---|
| `teams` | `int` | `1` | Number of sides; see §3. |
| `team0amt`..`team4amt` | `int` | `team0amt=3`, others `0` | Bot count per side. |
| `team0diff`..`team4diff` | `int` | all `6` | Bot difficulty per side (`2`-`10`). |
| `type` | `String` | `"Deathmatch"` | Mode name, one of §1's five (plus dead `"Protection"`). |
| `winScore` | `uint` | `20` | Score cap (Deathmatch/Domination/CTF/Juggernaught) **or** starting lives (Elimination) — overloaded field, meaning depends on `type`. |
| `elimTeamScore1`..`elimTeamScore4` | `uint` | `0` (instance ctor also zeroes these, `MatchSettings.as:135-138`) | Sum of starting lives per team in Elimination; used only to size the HUD score-bar denominator. |
| `bots` | `Array` | `[]` | Resolved bot roster for the upcoming match. |
| `player` | `Object` | `{}` then filled by `updatePlayer()` | Human player's match-entry descriptor. |
| `map` | `Object` | first entry of `Stats_Maps.mapOrder` | Selected map descriptor object (`id`, `name`, `desc`, etc. from `Stats_Maps`). |
| `botnames` | `Array` | curated name list | Pool `addBot()` draws unique bot names from. |
| `isCampaign` | `Boolean` | not set in `Init()` (set `true`/`false` by `Menu` when entering Campaign vs Quick Match) | Gates ability/equipment forcing — campaign always grants abilities, and equipment is opt-out (`abilitiesOn`/`equipsOn` are ignored, campaign always: abilities on, equips off unless explicitly turned on per-mission via `Stats_Campaign.setStats`). |
| `preCutSong`/`preCutFrames`/`postCutSong`/`postCutFrames` | `*`/`Array` | unset / `null` | Campaign cutscene bookkeeping (not Quick Match relevant). |
| `creditMod` | `Number` | `1` | Multiplier applied to end-of-match credit payout. Recomputed every `setQuickmatchSettings()` call by summing penalties (see §5). |
| `song` | `*` | unset | Match music override. |
| `matchName`/`matchDesc`/`matchExtra` | `String` | unset | Campaign mission flavor text (Quick Match doesn't set these beyond defaults). |
| `matchType` | `uint` | unset | Campaign track id: `0` = human campaign, `1` = alien campaign (`Stats_Campaign.as:54-56`, checked in `Game.as:641/647`). Not used by Quick Match. |
| `matchLevel` | `uint` | unset | Campaign stage index within `matchType`'s track. Not used by Quick Match. |
| `overallDiff` | `uint` | unset | Campaign per-mission difficulty rating shown as `mc_diff` frame (`Menu.as:1718`); **not** the Quick Match per-team `team{N}diff`. |
| `specialMode` | `String` | `"None"` | See §2. |
| `weaponsUsed` | `String` | `"All"` | Weapon-set restriction; see §6 — **string category name, not a numeric code**. |
| `abilitiesOn` | `Boolean` | `true` | If `false` (and not campaign), every unit's ability is forced to `Stats_Abilities.getAbility("none")` at spawn (`Unit.as:178-185`). |
| `equipsOn` | `Boolean` | `true` | If `false` (and not campaign), no unit loads any of the 3 equipment slots (`Unit.as:186-200`). |
| `qmBackup` | `Object` | unset | Snapshot used by `backupQm()`/`restoreQm()` to stash/restore Quick Match settings (`type`, `winScore`, `specialMode`, `weaponsUsed`, `abilitiesOn`, `equipsOn`, `map`, `teams`) around Campaign detours, so leaving Campaign and returning to Quick Match doesn't lose prior settings. |

Instance (per-`Game`) fields on `MatchSettings`, not persisted across matches: `canRageQuit`, `topFFaScore`, `topFFaScoreUnit`, `topTeam`, `topTeamScore`, `team1score`..`team4score`, private `fc` (frame counter driving the 3-second Domination tick).

**Fields the brief hypothesized that do not exist in Raze 2**: there is **no** `egoMode` field and **no** `dmgMod` field anywhere in `MatchSettings.as` or any other script in the decompile (`grep -rl egoMode` over the whole `scripts/` tree returns nothing). `dmgMod` does exist, but only as a **local/instance variable on `Bullet`** — a per-bullet damage multiplier baked into specific attack definitions (e.g. a bounce/reflection doing `0.5x` damage, `Bullet.as:290`) or computed from travel distance for the Zapper beam (`Bullet_Line_Zapper.as:71`), not a global match-wide damage scalar. There is no per-match "damage modifier" setting in the original game at all — the port's `dmgMod`/`egoMode` fields on `SD.matchSettings` (`PlayScreen.ts:277/285`) are **invented additions**, not ports of an original field.

Weapon-set restriction is **not** a numeric code (`0=all/1=smg/2=explosives/…` as the brief guessed) — it's the string category name from the array in §6.

## 5. Credit-mod penalties (Quick Match only)

Computed fresh every `setQuickmatchSettings()` call (`Menu.as:1999-2076`), starting from `MatchSettings.creditMod = 1` and subtracting:

| Condition | Penalty |
|---|---|
| `weaponsUsed == "Starters"` | `-0.1` |
| `weaponsUsed == "Sidearms"` | `-0.1` |
| `weaponsUsed == "Close Range"` | `-0.2` |
| `weaponsUsed == "Automatics"` | `-0.2` |
| `weaponsUsed == "Long Range"` | `-0.35` |
| `weaponsUsed == "Heavies"` | `-0.3` |
| `weaponsUsed == "Explosives"` | `-0.35` |
| `specialMode == "Infinite Clips"` | `-0.6` |
| `specialMode == "Infinite Ammo"` | `-0.9` |
| `map.id == "tutq"` | `-1` (entire tutorial-adjacent map disables credit reward) |
| `map.id == "tutq2"` | `-1` |
| `specialMode == "4x Health"` | `-0.5` |

Result is floored at `0` (`Menu.as:2059-2068`). If the final `creditMod < 1`, the settings screen shows `"Warning: With these settings, you will earn -{pct}% credits."` (`Menu.as:2069-2072`). This is a Quick Match economy deterrent, not a gameplay rule — it does not affect scoring/win conditions.

## 6. Weapon-set restriction (`weaponsUsed`)

Not a numeric code — one of these 8 strings, cycled via `bt_weaps_prev`/`bt_weaps_next` (`Menu.as:1114`, `Menu.as:1127`):

```
["All", "Starters", "Sidearms", "Close Range", "Automatics", "Long Range", "Heavies", "Explosives"]
```

- **`"All"`**: no restriction — every unit spawns with its own configured 7-slot loadout (`Guns.as:79-93` picks starting-gun index `0` unless `matchInfo.extra.startWeap` overrides it); weapon pickups on the map spawn in a rotating sequence across all 7 categories (`NodePickup.as` `RotateNum = UT.irand(1,6)` when unrestricted, `NodePickup.as:130`).
- **Any other category**: every unit is forced to start with (and pickups only spawn) the gun at `categoryIndex = arrayIndexOf(weaponsUsed) - 1` (i.e. `"Starters"`→index `0`, `"Sidearms"`→`1`, …, `"Explosives"`→`6`) unless a per-unit `matchInfo.extra.startWeap` override exists (`Guns.as:77-93`); pickups are similarly locked to that single category, logging `"Weapon <name> not found!"` if the lookup fails (`NodePickup.as:56-78`).

This numbering (`Starters=0 … Explosives=6`) does line up 1:1 with the 7 weapon-category columns already used elsewhere in the armory UI, but it's still driven off the string, not a stored numeric field — `MatchSettings.weaponsUsed` itself is always the string.

## 7. Abilities / Equipment on-off toggles

- `abilitiesOn` (`Menu.as:1137/1142`, toggled by either prev/next button — it's a pure boolean flip, "prev" and "next" do the same thing) and `equipsOn` (`Menu.as:1147/1152`, same double-bound flip) are simple booleans with **no intermediate states**. Display text: `"On"`/`"Off"` (`Menu.as:1983/1989`).
- These are global — they affect **every unit in the match** (player and all bots), not per-player. See `Unit.as:178-200` cited in §4.
- Campaign missions always ignore these two flags directly: `abilitiesOn` is effectively forced true (`MatchSettings.isCampaign || MatchSettings.abilitiesOn` short-circuits to true), and `equipsOn` is effectively forced true too by the same `||` pattern in `Unit.as:187` — meaning **in campaign, equipment always loads regardless of the flag's stored value**, even though `Stats_Campaign.setStats()` explicitly sets `MatchSettings.equipsOn = false` (`Stats_Campaign.as:2478`) as its baseline. The `isCampaign ||` guard on both lines means that stored `false` is never actually consulted for the equipment gate in campaign play — a quirk worth preserving if replicating exactly.

## 8. Quick Match screen — full option inventory

From `Menu.as` case `"Quick Match"` init (`Menu.as:248-276`) and the case-7 input handlers (`Menu.as:1055-1213`):

| Control | Cycles / toggles | Values |
|---|---|---|
| Map prev/next (`bt_map_prev`/`bt_map_next`) | `MatchSettings.map.id` through `Stats_Maps.mapOrder` | all defined arena ids |
| Mode prev/next (`bt_type_prev`/`bt_type_next`) | `MatchSettings.type` | `["Deathmatch","Elimination","Domination","Capture the Flag","Juggernaught"]` (§1) |
| Score/lives prev/next (`bt_score_prev`/`bt_score_next`) | `MatchSettings.winScore` | per-mode array, §1 subsections |
| Special Mode prev/next (`bt_special_prev`/`bt_special_next`) | `MatchSettings.specialMode` | achievement-gated list, §2 |
| Weapons prev/next (`bt_weaps_prev`/`bt_weaps_next`) | `MatchSettings.weaponsUsed` | 8-entry list, §6 |
| Abilities prev/next (`bt_abilities_prev`/`bt_abilities_next`) | `MatchSettings.abilitiesOn` | boolean flip (both buttons do the same thing) |
| Equipment prev/next (`bt_equips_prev`/`bt_equips_next`) | `MatchSettings.equipsOn` | boolean flip (both buttons do the same thing) |
| Per-team bot count (`mc_bots.bt{0-4}_bots_next/prev`) | `team{N}amt` | integer, clamped `[0 or 1, 12/teams - (0 or 1)]` |
| Per-team bot difficulty (`mc_bots.bt{0-4}_diff_next/prev`) | `team{N}diff` | integer, clamped `[2, 10]`, step `2` |
| `+ Add Team` (`bt_addteam`) | `MatchSettings.teams += 1` (capped `teamsMax`), seeds new slot: 1 bot @ diff 6 | see §3.1 |
| `- Remove Team` (`bt_removeteam`) | `MatchSettings.teams -= 1` (floored `teamsMin`) | see §3.1 |

`setQuickmatchSettings()` re-derives and displays: mode description text (`txt_typedesc`), score-type label (`txt_scoretype`, "Kills to Win"/"Lives"/"Points to Win"), special mode text, weapons text, abilities/equips On/Off text, score/lives value, add/remove-team button enabled state, and the credit-mod warning (§5) — every time any of the above controls changes (`Menu.as:1926-2076`).

## Port status

| Raze 2 concept | File(s) | Status |
|---|---|---|
| Deathmatch (FFA scoring, score cap) | `src/game/Match.ts` (`dm`), `src/game/GameScreen.ts:checkScoreCap` | **Correct** — FFA cap-based win matches `MatchSettings.updateScores()` default-case logic. |
| Team Deathmatch | `src/game/Match.ts` (`tdm`), `checkScoreCap` team-total branch | **Correct in spirit**, but modeled as its own mode string (`"tdm"`) rather than Deathmatch + `teams>=2`, so the port only supports 2 teams total, not the original's up to 4 team slots. |
| Elimination / Team Elimination | `src/game/Match.ts` (`elim`/`telim`), `livesLeft()`, `canRespawn()` | **Correct win logic** (last-standing), reasonably faithful to `Score.as`/`MatchSettings.as` semantics, but simplified: no per-unit `matchInfo.extra.lives` override, and win condition is derived from "still in the fight" bookkeeping rather than the original's raw `pscore <= 0` check on team/individual life totals — functionally equivalent for the common case. |
| Domination | `src/game/Objectives.ts` (`tickDom`) | **Correct-ish core loop**: capture-then-tick-score matches `NodeHoldpoint`/`MatchSettings.EnterFrame` (`DOM_TICK = 90` frames matches the original's `30*3`). Diverges: port hardcodes exactly 2 teams (`t1`/`t2`) where the original supports up to 4; port's capture requires *sole* occupancy and a fixed `DOM_CAPTURE = 30`-frame contest, whereas the original's capture speed is continuous (`flag.y` nudge of `0.5`/frame with no unit-count/team-mix nuance beyond "attacker present, defender not"). |
| Capture the Flag | `src/game/Objectives.ts` (`tickCtf`) | **Core loop present** (take enemy flag, return to your stand to score, drop-on-death via `status.dead` check) and reasonably matches `NodeCtfFlag.as`. Missing: no team-specific spawn points (original's `getSpawnNode()` CTF branch, `Unit.as:536-543`) — nothing found in the port's spawn selection gated on CTF; only 2-team CTF is possible in the port (matches original's 2-team lock, so this part is fine). |
| Juggernaught | `src/game/GameScreen.ts` (`jug` in `checkScoreCap`), mode listed in `PlayScreen.ts` | **Incomplete** — `jug` is only wired into the FFA score-cap check; no `Unit`-level equivalent of `setJug()`/`isJug` (random Jug assignment, 0.4x damage reduction, kill-transfers-the-title, suicide-passes-to-random-other) was found anywhere in `src/game`. The mode is selectable on the Play screen and scored FFA, but none of the actual Juggernaught mechanics appear implemented. |
| "Protection" dead/unused mode | — | Correctly absent — no reason to port a cut mode. |
| Special Mode dropdown (`lol cats`, `4x Health`, `Infinite/Unlimited Ammo`, `Infinite Clips`, `Moon Corpses`) | — | **Missing entirely.** No `specialMode` concept, no achievement-gated unlock list, and none of the 5 gameplay modifiers (infinite clips, infinite ammo, 4x max HP, lol-cats cosmetic pass, moon-gravity ragdolls) exist anywhere in `src/game`. |
| Weapon-set restriction (`weaponsUsed`) | — | **Missing entirely.** No equivalent of the 8-category string restriction, no forced starting weapon per category, no pickup-category locking. |
| Abilities on/off, Equipment on/off toggles | — | **Missing entirely.** The port always loads whatever ability/equipment the loadout screen assigned; no global disable switches were found. |
| Per-team bot count / per-team bot difficulty / `+ Add Team` up to 4 sides | `src/screens/PlayScreen.ts` (`opponents`, `DIFFS`) | **Wrong/incomplete** — the port has one global `opponents` count (`1-7`) and one global `DIFFS` selector (`Easy/Medium/Hard/Ego`) for the *entire* match, not per-team-slot amounts/difficulties, and there is no "add/remove team" control — team count is implicit in the chosen mode (`mode.team` boolean), capped at 2 teams. |
| Credit-mod economy penalties | — | **Missing** — no credit/currency economy call-out tied to match settings was found in the reviewed port files (out of scope if the port has no persistent credit economy at all; worth confirming against `SD`/save-data docs). |
| `overallDiff`, `matchType`, `matchLevel` (campaign-only) | `src/game/Campaign.ts` | Out of scope for Quick Match; not evaluated here — see the Campaign doc if one exists. |
| `egoMode` field | `src/screens/PlayScreen.ts:277` (`DIFFS` "Ego" tier) | **Invented, not a port.** No `egoMode` exists anywhere in the original `MatchSettings`/game logic; this is a port-original difficulty tier, not a documented Raze 2 mechanic. |
| `dmgMod` as a global match setting | `src/screens/PlayScreen.ts:285`, `src/game/Match.ts` (implied via `SD.matchSettings.dmgMod` though not read in the excerpted `Match.ts`) | **Invented, not a port.** The original `dmgMod` is a per-bullet local multiplier on specific attacks (`Bullet.as:290`, `Bullet_Line_Zapper.as:71`), never a global per-match damage scalar. |
| Friendly Fire toggle | `src/game/Match.ts:canHarm`, `PlayScreen.ts` (`friendlyFire`) | **Not found in the original `MatchSettings`/mode docs reviewed here** — no `MatchSettings.ff`-equivalent field surfaced in any of the files grepped for this topic. Likely a reasonable port addition, but not verified as a ported Raze 2 field (may live in a class outside this topic's scope, e.g. per-unit `matchInfo.extra.teamkill` handling in `Status.as` was seen but that's kill-attribution, not a match-wide toggle). |
