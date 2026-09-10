# 08 — Economy: Kill Bonuses, Credits, Shop, Achievements

Source classes (decompiled, non-`_2` originals):
- `Stats_KillBonuses.as` — kill-bonus table (id/name/desc/worth).
- `KillPoints.as` — per-kill credit calculation + bonus detection/award (the floating "+N" popup).
- `Stats_Achievements.as` — achievement table + `setAchievement()` award logic.
- `SD.as` — persisted player state (`credits`, starting balance, save list).
- `MatchSettings.as` / `Menu.as` (custom-game screen) — `creditMod` (match credit multiplier).
- `Stats_Equipment.as`, `Stats_Guns.as`, `Stats_Abilities.as`, `Stats_Skins.as` — shop pricing tables.
- `Bullet.as`, `Unit.as` — hidden trigger logic for the 4 easter-egg achievements.

## (a) Kill bonuses — full table (30)

All from `Stats_KillBonuses.as:34-90` (`Init()`, via `addBonus(id, worth, name, desc)`). `num` = array index (0-based), used by the `bonus1`/`bonus2` achievement thresholds.

| # | id | Worth | Name | Trigger condition | Awarded from (`KillPoints.as`) |
|---|----|------:|------|--------------------|----------------------------------|
| 0 | `headMult` | 4 | Headshot! | Kill by shooting the head | `param4.headMult` truthy (only if not `assassin`) — L105-108 |
| 1 | `crotchMult` | 5 | Crotch Shot! | Kill by shooting the crotch | `param4.crotchMult` — L117-120 |
| 2 | `buttMult` | 12 | Butt Shot! | Kill by shooting the butt | `param4.buttMult` — L109-116 |
| 3 | `assassin` | 10 | Assassin! | Kill by shooting the back of the head | `param4.assassin` (takes priority over `headMult`) — L95-104 |
| 4 | `burrowMult` | 8 | Suprise! | Kill by burrowing a saw through the ground (Shredder gun) | `param4.burrowMult` — L121-124 |
| 5 | `splashDirect` | 3 | Direct Hit! | Direct hit from an explosive weapon | `param4.splashDirect` — L125-128 |
| 6 | `splashIndirect` | 5 | Splish Splash! | Splash damage from a non-explosive weapon | `param4.splashIndirect` — L129-132 |
| 7 | `spreeEnd` | 10 | Spree Ender! | Victim was on a kill spree (+5 kills without dying) | `param4.spreeEnd` — L83-86 |
| 8 | `reflect` | 4 | Reflection! | Kill by reflecting an attack off Katana/Static Field | `param4.reflect` truthy and reflect target === killer — L91-94 |
| 9 | `jugKill` | 15 | Juggerkill! | Kill and become the Juggernaut | `param4.jugKill` — L133-136 |
| 10 | `hasFlag` | 10 | Show Stopper! | Victim was carrying the flag | `param4.hasFlag` — L137-140 |
| 11 | `sword` | 4 | Slasher! | Kill with the Katana | `param3.id == "sword"` (gun used) — L153-156 |
| 12 | `fire` | 2 | Hot Hot Hot! | Set enemy on fire, they die from the burn | `param3.id == "fire"` — L157-160 |
| 13 | `dead` | 5 | Haunted! | Killer scores a kill after already being dead (`_killer.dead.fc >= 2`) | L173-176 |
| 14 | `mauser` | 2 | Embarrassing! | Kill with the Golden Mauser pistol | `param4.mauser` — L141-144 |
| 15 | `chill` | 4 | Chill Pill! | Kill with a double-bounced shot from the Hail Storm (icegun, `bounce >= 2`) | `param3.id == "icegun" && param4.bounce >= 2` — L165-172 |
| 16 | `steal` | 2 | Kill Steal! | Victim was low HP (≤20) and fighting someone other than the killer | `param1.target && param1.target != _killer && param1.status.hpCur <= 20` — L197-200 |
| 17 | `onfire` | 3 | Disco Inferno! | Killer was on fire when they got the kill | `_killer.status.sFire` — L181-184 |
| 18 | `mine` | 3 | Mine your step! | Kill with a land mine | `param3.id == "mine"` — L161-164 |
| 19 | `domKill2` | 5 | Capture King! | Kill while capturing a flag in Domination | `MatchSettings.type == "Domination" && _killer.capturing` — L215-218 |
| 20 | `domKill` | 5 | Defender! | Kill an enemy capturing your flag in Domination | `MatchSettings.type == "Domination" && param1.capturing` — L211-214 |
| 21 | `juice` | 2 | Juiced! | Victim's name is "Juice-Tin" (secret/joke unit) | `param1.name == "Juice-Tin"` — L201-204 |
| 22 | `rad` | 2 | Rad! | Victim's name is "AddisonR" (dev joke unit) | `param1.name == "AddisonR"` — L205-208 |
| 23 | `survive` | 3 | Survivor! | Killer has exactly 1 HP remaining | `_killer.status.hpCur == 1` — L177-180 |
| 24 | `speed` | 5 | Speed Shot! | Killer traveling ≥ `xMax` speed (35 mph) | `abs(_killer.mov.xVel) > _killer.mov.xMax` — L185-188 |
| 25 | `hasFlag2` | 5 | Show Off! | Killer was carrying the flag | `_killer.hasFlag` — L189-192 |
| 26 | `noShield` | 5 | What Shield? | Victim had >20% shield, killed in one hit | `param4.noShield` — L145-148 |
| 27 | `invis` | 12 | What was that? | Victim was invisible | `param1.status.sInvis` — L193-196 |
| 28 | `corpsestick` | 15 | Corpslosion! | Kill with a sticky grenade attached to a corpse | `param4.corpseStick` — L149-152 |
| 29 | `refBounce` | 10 | Thanks! | Enemy kills someone else off your Katana/Static Field reflect | `param4.reflect` truthy and reflect target != killer — L87-90 |

Notes:
- Bonus IDs and order above match `Stats_KillBonuses.Init()` exactly (`num` = position in that call sequence, 0-29).
- `KillPoints.addBonus()` (`KillPoints.as:261-358`) is capped: only the first `remaining` (=3, `KillPoints.as:53`) bonuses per kill are applied/priced — additional qualifying flags are ignored once `remaining` hits 0 (L332-334). So **max 3 kill bonuses stack per kill**.
- `assassin` and `headMult` are mutually exclusive (assassin checked first, `else if` for headMult) — `KillPoints.as:95-108`.
- First time a bonus id is earned it's pushed to `SD.bonusesOwned` (`KillPoints.as:345-347`), driving achievements `bonus1` (≥15 distinct bonuses) and `bonus2` (≥30, i.e. all of them) — `KillPoints.as:348-355`.
- Several bonuses also increment permanent per-player stat counters (`_killer.score.reflections/jugKill/sword/fire/mauser/steal/mine/juice/rad/speed/corpsestick`) — `KillPoints.as:263-322`. These are lifetime stats, not economy, but ride along in the same function.

## (b) Credit economy

### Base credits per kill

`KillPoints.as:55`:
```
points = 4 + param1.diff * 0.8
```
- `param1` = **victim** unit; `param1.diff` is the victim's per-unit difficulty rating (`Unit.as:133`, `uint`), set per-unit in campaign scripts (e.g. `Stats_Campaign.as:2001-2041` sets `diff` to 0 or 9 for scripted units). In quick-match, AI difficulty presumably sets this per bot.
- So base ranges **4 (diff 0) to ~11.2 (diff 9)** before bonuses, then everything is `Math.ceil`'d only at final payout (`L231`), not at this base-computation step.
- **Credits are only awarded when the killed unit (`param1`) is not the human player** — the branch `if(param1.human) { …; return; }` (`KillPoints.as:67-72`) shows a "Killed by: X" message and exits with **no credit calculation** when the local player is the one who died. Credits accrue to `_killer` (`param2`) only in the `else` (victim is AI/enemy) path. Suicide (`param1 == _killer`) and teamkills also award nothing (`KillPoints.as:57-64, 248-258`).

### Difficulty / mode scaling — `MatchSettings.creditMod`

Base = 1.0 (`MatchSettings.as:172`; reset to 1 each time the custom-game screen is opened, `Menu.as:1999`). Then reduced by loadout/mode restrictions chosen for the match (`Menu.as:2000-2058`), each independently subtracted:

| Setting | Penalty |
|---|---|
| Weapons Used = "Starters" | −0.1 |
| Weapons Used = "Sidearms" | −0.1 |
| Weapons Used = "Close Range" | −0.2 |
| Weapons Used = "Automatics" | −0.2 |
| Weapons Used = "Long Range" | −0.35 |
| Weapons Used = "Heavies" | −0.3 |
| Weapons Used = "Explosives" | −0.35 |
| Special Mode = "Infinite Clips" | −0.6 |
| Special Mode = "Infinite Ammo" | −0.9 |
| Map id == "tutq" (tutorial) | −1.0 |
| Map id == "tutq2" (tutorial 2) | −1.0 |
| Special Mode = "4x Health" | −0.5 |

Clamped to `>= 0` (`Menu.as:2059-2067`); a UI warning shows if `creditMod < 1`: `"Warning: With these settings, you will earn -N% credits."` (`Menu.as:2069-2071`). Applied at final payout: `points = Math.ceil(points * MatchSettings.creditMod)` (`KillPoints.as:231`), and also used identically in `Hud.as:442` and `PauseScreen.as:220` (assist/end-of-match credit displays) and reset to 1 for campaign play (`Stats_Campaign.as:2470`, i.e. **campaign missions always pay full credits**).

### Other adjustments in the payout formula (`KillPoints.as:209-231`, in order)
1. Base + victim-diff (`L55`).
2. `+ _killer.equips.credits` if the killer has the "Point Allocator" equipment equipped (`L73-82`; adds a flat `+2` per kill — see equipment table below).
3. `+= bonus.worth` for each of up to 3 qualifying kill bonuses (`addBonus`, `L261-358`).
4. If match type is Capture the Flag or Domination: `points = ceil(points * 0.5)` — **all objective-mode kills are worth half** before the creditMod multiplier (`L220-229`).
5. `points = ceil(points * MatchSettings.creditMod)` (`L231`) — final value shown in the popup and added via `_killer.game.hud.addPoints(points)` (`L245`).

### Other credit sources
- **Achievement rewards** (`credits` reward type) — see achievement table below; awarded once via `SD.credits = SD.credits + rew[1]` (`Stats_Achievements.as:218-226`).
- No other credit sources found in the decompiled scripts (no daily bonus, no ad-watch bonus, no currency purchase — this is a browser Flash game with a single soft currency).

### Starting balance
`SD.as:143`: `credits = 500` — set in `SD.Init()` (fresh profile). Persisted field `SD.credits:int` (`SD.as:53`), included in the save list (`SD.as:107`) and restored from save data (`SD.as:228`).

## (c) Shop pricing model

There is **no runtime cost formula** — every item in every shop table (guns, skins, abilities, equipment) has a **hardcoded `cost` value** baked into its `add*()` call at init time. Full item-by-item pricing lives in the guns/skins/abilities/equipment docs; this section documents the *shape* of each pricing table only.

- **Guns** (`Stats_Guns.as`, `addGun(class, id, ..., cost, ...)`): cost is the 6th positional arg. Costs roughly scale with weapon `class` tier (0=pistol .. 6=heavy): observed range **0–6300**. `cost == 0` marks native/starter guns (free, always owned); `cost == -1` marks campaign/reward-only guns that are **not purchasable in the shop** (e.g. `hrocket2`, `Stats_Guns.as:645`). `Stats_Armory.as:39` filters the buyable list with `cost >= 0`.
- **Skins** (`Stats_Skins.as`, `addSkin(id, name, cost, ...)`): flat tiers observed at **0, 50, 100, 150, 200, 250**; `cost == -1` = unlock-only (not purchasable — e.g. "Mutate" skin, `Stats_Skins.as:117`, presumably an achievement/campaign unlock).
- **Equipment** (`Stats_Equipment.as`, `addEquipment(cls, name, type, value, cost, desc)`): 3 slots (`cls` 0/1/2, 6 items each incl. "Nothing"). Cost climbs roughly linearly per slot: slot 0 → 400/800/1200/1600/2000; slot 1 → 600/900/1200/1500/1800; slot 2 → 1000/1200/1400/1600/1800. `cost == 0` = the always-available "Nothing" (no equipment) option. Init logs `"Total Equipment costs:"` (`Stats_Equipment.as:112`) summing all non-zero costs — purely a debug trace, not used for pricing.
- **Abilities** (`Stats_Abilities.as`): observed `cost` values 0, 500, 1300, 1500, 2200, 2800, 3500, 4600 — again flat per-item, increasing with ability power tier; 0 = starter ability.

No item's price is ever computed from a player stat (no "price increases as you own more" scaling) — it's a static, curated table.

## (d) Achievements — full table (`Stats_Achievements.as:37-171`)

`achOrder` (`L39`): `["cat","health","ammo","moon","humanwin","alienwin","abilities","equipment","bonus1","bonus2"]`. `getAchievement(id)` returns `{id, name, desc, rew, rewtxt, rewmc}`; reward is either `["credits", N]` or `["mode", "<label>"]` (unlocks a special-mode toggle in the custom-game menu, checked in `SD`/`MatchSettings`).

| id | Name | Description | Reward | Trigger condition |
|---|---|---|---|---|
| `cat` | Oh Hi Kitty | "'lol' at the secret lol cat." | mode: **lol cats** | Secret map interaction — see below |
| `health` | Love is Blind | "Dance with the jolly heart." | mode: **4x Health** | Secret map interaction — see below |
| `ammo` | I hate nature! | "Trim the foliage." | mode: **Unlimited Ammo** | Shoot 400 trees/foliage — see below |
| `moon` | Reach for the Sky | "Until you touch the moon." | mode: **Moon Corpses** | Shoot a specific wall with a specific weapon type — see below |
| `humanwin` | A New Hope | Complete the human campaign | credits: **500** | `setAchievement("humanwin")` called on human campaign completion (also logs `Log.CustomMetric("Campaign_Human","Matches")`) |
| `alienwin` | A New Era | Complete the alien campaign | credits: **1000** | `setAchievement("alienwin")` on alien campaign completion (`Log.CustomMetric("Campaign_Alien","Matches")`) |
| `abilities` | Versatile | Purchase 4 abilities | credits: **300** | Set once the player has purchased 4 distinct abilities (checked wherever abilities are bought) |
| `equipment` | Toolkit | Purchase 3 equipment in each category | credits: **300** | Set once the player owns ≥3 items in each of the 3 equipment slots |
| `bonus1` | Stylish | Unlock 15 kill bonuses | credits: **500** | `SD.bonusesOwned.length >= 15` (`KillPoints.as:348-350`) |
| `bonus2` | Kill Enthusiast | Unlock 30 kill bonuses | credits: **800** | `SD.bonusesOwned.length >= 30` — i.e. all 30 (`KillPoints.as:352-354`) |

Award mechanics (`setAchievement()`, `Stats_Achievements.as:178-237`):
- No-op if already earned: `if(SD.achievements.indexOf(num) != -1) return;` (`L181-184`).
- Always logs `Log.CustomMetric("Achievements","Matches")`; additionally logs to a `"Secrets"` metric if the id is `cat`, `health`, `ammo`, or `moon` (`L197-213`) — confirming these 4 are explicitly categorized as secrets by the devs.
- Pushes the achievement index to `SD.achievements`, plays `S_Medal` sound, and if the reward is `credits`, does `SD.credits = SD.credits + rew[1]` (`L216-226`).
- Drives the on-screen popup (`ach.mc_icon.gotoAndStop(sprite)`, `txt_name`, `txt_rew`, `ach.gotoAndPlay(2)` — `L227-236`), which is the `Stats_Achievements` MovieClip itself (`[Embed(... symbol="symbol1816")]`, `L11-12`).

### The 4 secret/easter-egg triggers — exact conditions

All 4 are gated behind **specific fill-color hit tests** against map geometry (this engine encodes special wall/object behavior as magic hex fill colors on vector shapes — consistent with the color-coded wall-collision system documented in the hitbox-extraction notes). Each color only appears once, on a purpose-built decoration placed in a specific map (identifying *which* map/x,y requires opening the map's vector art in FFDec; not done here since it's out of scope for a code-only pass — flag this as a follow-up if exact map placement is needed).

1. **`cat` → "Oh Hi Kitty"** (`Unit.as` ~L751, case `0`, fill color **`"ffff02"`**):
   - Triggered inside a large color-keyed `switch` on a hit-tested object's fill color performed on the **player unit** (not a bullet) — i.e. the player must physically touch/collide with an object painted `#FFFF02` in the map.
   - `Stats_Achievements.setAchievement("cat")` fires unconditionally once that color is hit (`Unit.as:772`).
   - Matches the description: a hidden "lol cat" decoration somewhere in a map that you `'lol'` at by touching it.

2. **`health` → "Love is Blind"** (`Unit.as` ~L752, case `1`, fill color **`"ffff04"`**):
   - Same unit-touch switch as `cat`, next color in the table.
   - `Stats_Achievements.setAchievement("health")` fires unconditionally on touch (`Unit.as:775`).
   - Matches "Dance with the jolly heart" — a hidden heart decoration touched by the player.

3. **`ammo` → "I hate nature!"** (`Bullet.as`, fill color **`"006600"`**, case `9` in the bullet-hit-object switch, `Bullet.as:415-474`):
   - This color is the **foliage/tree fill color** — hit by any bullet, it spawns `"leaf_splash"` effect + leaf particles (cosmetic, happens on every tree shot).
   - Only for **human** shooters: increments a per-unit counter `unit.treeShoot++` (`Bullet.as:465-470`).
   - When `unit.treeShoot == 400` (i.e., the human player has shot foliage exactly 400 times, cumulative within... likely per-life or per-session counter on the `Unit` instance — check `Unit.as` for where `treeShoot` is initialized/reset), `Stats_Achievements.setAchievement("ammo")` fires (`Bullet.as:471-474`).
   - So the real trigger is **"shoot any tree/foliage decoration 400 times."**

4. **`moon` → "Reach for the Sky"** (`Bullet.as`, fill color **`"ffff06"`**, case `0` in the bullet-hit-object switch, `Bullet.as:366-431`):
   - Condition: `if(unit.human && stats.type == 4) { setAchievement("moon"); }` (`Bullet.as:426-430`).
   - `stats.type == 4` corresponds to weapon class 4 in `Stats_Guns.as` (the sniper-class weapons: `sniper`/`railgun`/`asniper`/etc., `Stats_Guns.as:467-521` — `addGun(4, ...)`).
   - So the trigger is: **a human-controlled shooter hits a specific object (fill `#FFFF06`, presumably a "moon" graphic placed very high up on a map) using a class-4 (sniper-tier) weapon.** No shot count required — it's a single successful hit.
   - Matches "Reach for the Sky... Until you touch the moon" — you must snipe a moon decal placed at the top of some map's skybox.

Caveat: exact map(s) containing the `ffff02`/`ffff04`/`ffff06`/`006600` decoration objects were not identified in this pass (would require FFDec inspection of each map's vector shapes/fill colors, which is out of scope for a code-only economy doc). The trigger *mechanism* (color + condition) above is exact and copy-pasted from source.

## Port status

**Kill bonuses** (`src/game/KillBonus.ts`, `src/assets/raze2/killBonuses.json`):
- Correct: all 30 bonus ids/names/worths/descs ported verbatim into `killBonuses.json` (matches `Stats_KillBonuses.as` exactly, including `num` order).
- Wrong/incomplete:
  - `computeKillBonuses()` only detects 6 of 30 conditions (headMult/crotchMult/buttMult, jugKill, dead, survive, speed, mauser) — explicitly documented in the file's own header as intentional (the rest "light up automatically... as those systems are ported").
  - `MAX_BONUSES = 3` is correctly ported (matches `remaining = 3` in `KillPoints.as:53`), but the *last-writer-wins vs. first-N-only* cap semantics should double check `.slice(0,3)` vs original's incremental-decrement-until-0 (functionally equivalent here since detection order is fixed).
  - `killPoints()` formula: `BASE_POINTS(4) + diffMod*0.8 + bonuses + equipCredits`, rounded — reasonably matches `4 + diff*0.8` (`KillPoints.as:55`) plus equip credits (`L73-82`) plus bonus worths, but is **missing**: the CTF/Domination 0.5x halving (`L220-229`) and the `MatchSettings.creditMod` multiplier (`L231`) entirely — no difficulty/mode-based credit scaling exists in the port yet.
  - `assassin` / `refBounce` / `noShield` bonuses require reflect/flag/shield systems not yet wired.
- Missing: `spreeEnd`, `reflect`, `hasFlag`/`hasFlag2`, `sword`, `fire`, `mauser` is present but `chill`, `steal`, `onfire`, `mine`, `domKill`/`domKill2`, `juice`, `rad`, `noShield`, `invis`, `corpsestick`, `refBounce`, `assassin`, `burrowMult`, `splashDirect`/`splashIndirect` detectors — all await their respective gameplay systems.

**Credits / economy** (`src/state/SD.ts`, `src/game/Armory.ts`, `src/game/Equipment.ts`):
- Correct: starting balance `500` (`SD.ts:387`, matches `SD.as:143`); `addCredits()` clamps at 0 like the original never goes negative in practice; gun/skin cost tables (`-1` = unbuyable, `0` = free/native) correctly modeled in `gunCost()`/`skinCost()`.
- Missing: `MatchSettings.creditMod` (difficulty/loadout-restriction credit penalty table) is not ported anywhere — no equivalent of the −0.1..−1.0 penalty stack or the UI warning text.
- Missing: the CTF/Domination 50%-credit-halving rule.
- Missing: the "victim must not be the human player" gate on credit payout — worth confirming `killPoints()` callers only invoke it for AI-victim kills, since the port's version doesn't structurally enforce this the way `KillPoints.as:67-72`'s early-return does.

**Achievements** (`src/game/Achievements.ts`, `src/assets/raze2/achievements.json`):
- Correct: all 10 Raze 2 achievement ids/names/descs/rewards ported verbatim; `bonus1`/`bonus2` thresholds correctly wired to `SD.bonusesUnlocked.length >= 15/30` in `Unit.ts:1624-1625`; reward application (`addCredits` for credits, `SD.modesUnlocked` push for mode unlocks) matches `Stats_Achievements.as:218-226` semantics; `humanwin` wired in `SD.ts:282`.
- Missing (confirmed via grep — no references anywhere in `src/`):
  - The **4 easter-egg triggers** (`cat`, `health`, `ammo`, `moon`) have **no in-map interaction wired at all** — no color-hit-test equivalent, no `treeShoot` counter, no weapon-class-4-vs-special-object check. This is the single biggest gap: the reward data exists but nothing in the port can ever fire `addAch("cat"|"health"|"ammo"|"moon")`.
  - `alienwin` reward wiring not confirmed in this pass (grep only found `humanwin` referenced in `SD.ts:282`) — verify alien-campaign completion also calls `Achievements.addAch("alienwin")`.
  - `abilities` (purchase 4 abilities) and `equipment` (3-per-category) achievement triggers: `equipment` achievement call found (`src/game/Equipment.ts:72`, `Achievements.addAch("equipment")` — but verify it checks "3 in each of 3 categories" not just "3 total"); no confirmed trigger found for `abilities` (purchase 4 abilities) in this pass — needs verification in `src/game/Abilities.ts`.
  - Note `Achievements.ts` mixes in a full parallel *Raze 1* medal set (`rank`,`nodie`,`human`,`alien`,`headshot`,`addicted`,`pistol`,`gravekill`,`guns`,`return`,`railgun`,`complete`) not covered by this doc (Raze 2 scope only) — flagged so a future pass doesn't confuse the two systems.

**Shop pricing model**: guns/skins tables ported with correct sentinel semantics (`0`=free/native, `-1`=unbuyable); equipment table ported (`src/assets/raze2/equipment.json`, `src/game/Equipment.ts`) — costs not spot-checked here against `Stats_Equipment.as` line values, recommend a follow-up diff pass. Abilities pricing table existence confirmed (`src/game/Abilities.ts`) but not verified against `Stats_Abilities.as` cost values in this pass.
