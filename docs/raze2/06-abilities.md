# 06 — Abilities (F-key) + Energy System

Source files: `Stats_Abilities.as` (definitions/costs), `Unit.as` `doAbility()`/`abilityExtra()`/`abilityDone()` (effects, lines 1151-1367), `Status.as` (energy bank, lines 45-136, 194-202, 393-425), `AI.as` (lines ~566-597, AI ability triggers), `Player.as:383-386` (F/Ctrl input), `Stats_Guns.as` (the sword/grenade/mine sub-weapons the abilities fire).

Game runs at **30 fps** throughout (confirmed by every `duration * 30` frame-count pattern below and by `03-weapons-guns.md:46`).

## 1. Energy resource

Each `Unit` has a private energy bank in `Status.as`:

| Field | Value | Source |
|---|---|---|
| `enMax` | 100 (fixed, not affected by `4x Health` or Combat Armor) | `Status.as:102` |
| `enCur` | starts at 100 (full) on spawn | `Status.as:102` |
| Per-frame gain | `abilityCharge` | `Status.as:413` (`enCur += abilityCharge` in `EnterFrame`, only while `enCur < enMax`) |

`abilityCharge` (the per-frame regen rate) is computed once in `setAbility()` (`Status.as:119-136`), called on construction and whenever the equipped ability changes:

```
abilityCharge = unit.ability.recharge                     // base rate for the equipped ability
if (unit.equips.recharge)  abilityCharge *= unit.equips.recharge   // Cooling Packs equipment multiplier
if (!unit.human)           abilityCharge *= unit.diff * 0.1 + 0.5  // AI-only difficulty scalar
```

`unit.ability.recharge` itself is derived once per ability in `Stats_Abilities.getAbility()` (`Stats_Abilities.as:289`):

```
recharge = 3.3 / rechargeSec
```

At 30 fps this is exact: `rechargeSec` seconds × 30 frames/s × `3.3/rechargeSec` energy/frame = **99 ≈ 100 energy**, i.e. `rechargeSec` is literally "seconds to refill a full 100-energy bar from empty," independent of the ability's actual `usedEnergy` cost. For the AI-only diff scalar: at `diff=0` bots recharge at 0.5× player rate, at `diff=5` at 1.0×, so higher-difficulty bots reuse abilities noticeably faster (`Status.as:134`).

Activation gate (`Unit.as:1165` — checked once at the top of `doAbility()`, before the per-ability `switch`):
- `status.hasEnergy(ability.usedEnergy)` must be true (`Status.as:194-196`: `enCur >= param1`).
- Also requires: game started, unit not dead, not `hasFlag` (CTF flag carrier can't use abilities), not `permInvis`, game not paused, `unit.diff` truthy.
- On success, `status.useEnergy(ability.usedEnergy)` (`Status.as:199-202`: `enCur -= param1`, can go negative-clamped only by never being allowed below 0 via the gate, not clamped in `useEnergy` itself).

There is **no separate cooldown timer** — "cooldown" for a 100-cost ability is simply "however long it takes energy to refill to 100," i.e. `rechargeSec` seconds after a full-cost use starting from 0. Teleport costs only 30, so from a full bar it can be used **3 times in a row** instantly (`3 × 30 = 90 ≤ 100`), then needs partial refill for further uses — this is exactly the "Uses: 3 per Recharge" label in its `extraDesc` (`Stats_Abilities.as:276`).

Input: F or Ctrl (key-codes 21/22 in `Player.as:383-386`) call `unit.doAbility()` directly; every ability's `usage` string reads "Press F or Ctrl." (or "...while on the ground" for Static Field).

AI bots call the same `doAbility()` (`AI.as`, see §5) and non-human units in `Status.EnterFrame()` (`Status.as:393-406`) can also auto-trigger it as a defensive reflex (see §5).

## 2. Ability table

`Stats_Abilities.abilityOrder = ["ammo","cloak","static","heal","sword","grenade","mine","teleport"]` (`Stats_Abilities.as:41`) — this array order is also the index used by `getAbilityByNum()` and the loadout/armory selector. A ninth pseudo-entry, `"none"` (id `0` internally, not in `abilityOrder`), represents no ability equipped.

| # | id | Name | Type | `rechargeSec` | `recharge`/frame (`3.3/rechargeSec`) | `usedEnergy` | Cost (credits) | `Stats_Abilities.as` line |
|---|---|---|---|---|---|---|---|---|
| — | `none` | Nothing | N/A | 0 | 0 | 100 | 0 | 122-139 |
| 0 | `ammo` | Resupply | Utility | 20 | 0.165 | 100 | **0 (free)** | 207-225 |
| 1 | `cloak` | Cloak | Utility | 10 | 0.33 | 100 | 500 | 188-206 |
| 2 | `static` | Static Field | Defensive | 10 | 0.33 | 100 | 1300 | 140-159 |
| 3 | `heal` | Emergency Heal | Defensive | 15 | 0.22 | 100 | 1500 | 160-187 |
| 4 | `sword` | Katana | Offense | 2 | 1.65 | 100 | 2200 | 226-239 |
| 5 | `grenade` | Grenade | Offense | 5 | 0.66 | 100 | 2800 | 240-253 |
| 6 | `mine` | Land Mine | Offense | 7 | 0.4714 | 100 | 3500 | 254-267 |
| 7 | `teleport` | Teleport | Relocation | 7 | 0.4714 | **30 (only ability under 100)** | 4600 | 268-280 |

**Free default:** `ammo` (Resupply) is the only ability with `cost = 0` (`Stats_Abilities.as:224`), so it is the one every player/bot has unlocked from the start without spending shop credits; all seven others must be purchased. (`Unit.as:180-184`: if `MatchSettings.abilitiesOn` is false or not campaign, the unit's ability is forced to `"none"` regardless of loadout.)

## 3. Per-ability effect detail (`Unit.as` `doAbility()`, `abilityExtra()`, `abilityDone()`)

### Static Field (`static`) — `Unit.as:1183-1212`
- **Precondition:** only while `!mov.jumping` (grounded); if airborne the call returns immediately and **no energy is spent** (the check is inside the `case`, after the shared energy gate, but before `useEnergy`).
- On activation: cancels current reload (`gun.reloading = false`), plays `S_Static` sound, screen-shakes the arena (player: `setShake(3,8)`; visible AI: `setShake(3,5)`), sets `abilityPause = true` (freezes `Movement.EnterFrame()` for the unit — `Unit.as:591`/`Movement.as:128` — full action lock), spends `usedEnergy` (100), sets `status.sMirror = ability.duration * 30` = **1.5 s → 45 frames**, and plays the `"armorlock"` animation on body/arm1/arm2 (`MC.goto`/`arm.gotoAndPlay`).
- **Effect while `sMirror` is nonzero:** `Status.damage()` (`Status.as:216-219`) returns immediately for any non-friendly-fire hit — full invulnerability and (per the ability's own description) "reflection" of incoming projectiles (the reflect visual/behavior is driven by `sMirror`'s glow-filter state in `Status.EnterFrame()`, `Status.as:427-441`; no damage is dealt back explicitly in this file — "reflection" here means the attacker's shot is nullified against the shielded unit, not bounced back at them).
- `abilityDone()` (`Unit.as:1348-1352`, fired when the `"armorlock"` clip finishes) clears `abilityPause` and returns the gun to idle/reload.
- Icon/body frame label: `"static"`. Sound: `S_Static` (activation).

### Emergency Heal (`heal`) — `Unit.as:1213-1242`
- Plays `S_Heal` (human only). Spends 100 energy.
- `status.heal(ability.heal=60, true)` — flat **+60 HP** to self (on a 100-HP base; `heal()` multiplies by `unit.equips.pcboost` if present) — triggers the `"getHealth"` pickup VFX.
- If `unit.team` is set (team modes), loops all `game.units`, and for every other unit on the same team within `UT.getDist(...) < 150` px, calls `their.status.heal(ability.healTeam=30, true)` — flat **+30 HP** to nearby allies, each also gets the `getHealth` VFX. Enemies and the caster itself are excluded from the team loop (self already healed above).
- AI also self-triggers this ability opportunistically: `Status.EnterFrame()` — `if (unit.ability.id == "heal" && hpCur < 50 && Math.random() < 0.03) doAbility()` (`Status.as:402-405`), i.e. a bot below half HP has a 3%-per-frame (~60%-per-second) chance to heal once energy allows.
- Icon/body frame: `"heal"`.

### Cloak (`cloak`) — `Unit.as:1243-1250`
- Plays `S_Powerup` (human only). Spends 100 energy.
- `status.sInvis = ability.duration * 30` = **4 s → 120 frames** of invisibility (rendering flag consumed elsewhere; the ability file itself only sets the frame-count).
- Ability description: "Shooting any weapons during this effect will disrupt the shield, and end the invisibility" (firing cancels cloak — enforced outside this file, in the gun-fire path that resets `sInvis`).
- AI trigger: `if (!target && ability.id == "cloak" && Math.random() < 0.1) doAbility()` — a bot with no visible target has a 10%-per-frame chance to cloak (`AI.as:582-585`).
- Icon/body frame: `"cloak"`.

### Resupply (`ammo`) — `Unit.as:1253-1261`
- Plays `S_Equip` (human only). **Always spends a hardcoded 100** (`status.useEnergy(100)` — note this literal, not `ability.usedEnergy`, though they're equal for this ability).
- `gun.addClip(gun.curNum, 1)` — adds **1 spare clip** to the currently-equipped weapon; also lets the wearer "switch to any empty weapon to replenish its ammo" per the description.
- Spawns the `"getweapon"` VFX at `(x, y-45)`.
- Icon/body frame: `"ammo"`. This is the free default (§2).

### Katana (`sword`) — `Unit.as:1262-1272`, `Unit.as:1344-1361` (`abilityDone`)
- Cancels reload, spends 100 energy, fires the melee sub-weapon via `gun.makeBullet(Stats_Guns.gunOb["sword"])` — a `Bullet_Melee_Basic` instance with **`dmg=75`, `force=15`, `range=7`** (`Stats_Guns.as:676`; `range` here is gun-range units, ×10 in the port's own px convention per `03-weapons-guns.md:43`). `Bullet_Melee_Basic` steps forward each frame up to `maxDist/10` iterations doing hit tests, plays a headshot-type sound on a unit/corpse hit, then applies its hit effect and self-removes the same frame it fires — the slash is effectively instant, single-target-in-line, in front of the unit.
- Sets `shootPause = true` (blocks the normal gun's fire input while the swing animation plays), plays the `"sword"` arm animation, sets `status.sMirror = 5` — a **5-frame parry window** reusing the same `sMirror` flag that Static Field uses for reflection, i.e. swinging the Katana at the right moment can no-sell / reflect an incoming hit for those 5 frames (the ability's own description: "It is also possible to reflect attacks by swinging the Katana at the precise moment.").
- Hides the body's idle ability icon during the swing (`MC.body.ability.gotoAndStop("none")`), plays `S_Whip`.
- `abilityDone()` (on animation end): clears `shootPause`, restores idle/reload, and if the unit doesn't have the flag, restores the body ability icon to `"sword"`.
- **AI usage condition:** `if (target && ability.id=="sword" && UT.getDist(unit,target) < Stats_Guns.gunOb["sword"].range * 10) doAbility()` (`AI.as:590-593`) — bots swing when a target is within `7*10 = 70` px.
- Icon/body frame: `"sword"`.

### Grenade (`grenade`) — `Unit.as:1273-1280`, `Unit.as:1335-1341` (`abilityExtra`), `Unit.as:1362-1366` (`abilityDone`)
- Cancels reload, spends 100 energy, sets `shootPause`, plays the `"grenade"` throw animation on both arms, plays `S_Whip`. The actual thrown grenade projectile is **not** spawned here — `abilityExtra()` is invoked (presumably from an animation frame-script mid-throw) and calls `gun.makeBullet(Stats_Guns.gunOb["grenade"])`.
- Sub-weapon stats (`Stats_Guns.as:679-711`): **`dmg=45`**, `force=15`, **`splash=79`, `splashMult=0.7`**, class `Bullet_Proj_Bounce` with `params=["grenade", 3, 3, 2]`, hit sound `S_rocketExplode`.
  - `Bullet_Proj_Bounce.EnterFrame()`: bounces off walls/ground (velocity damped ×0.5–0.8 per axis per bounce, tracked in `extra.bounce`), applies gravity via `yVel += params[2]*0.1` = `+0.3/frame`, spawns `params[1]=3` trail-particle draws of effect `params[0]="grenade"` per frame, and detonates (`doHitEffect(true)`) either on unit/corpse impact (instant) or after `fc == params[3]*30` = **60 frames = 2 s** timeout. Note: the ability's own flavor text (`Stats_Abilities.as:248`, `extraDesc = "1 second"`) says a 1-second fuse — this is a **content/code mismatch in the original SWF**: the actual bytecode timeout is 2 s, not 1 s. The "instantly explodes when impacting an enemy" behavior (also stated in the desc) is accurate: any unit/corpse hit triggers immediate detonation regardless of the timer.
- `abilityDone()`: clears `shootPause`, restores idle/reload.
- **AI usage condition:** `if (target && ability.id=="grenade" && UT.getDist(unit,target) > Stats_Guns.gunOb["sword"].splash) doAbility()` (`AI.as:594-597`) — note this reads `gunOb["sword"].splash`, not `gunOb["grenade"].splash`; since the Katana entry's `splash` field is unset (`undefined`/falsy), this condition is effectively always true for any nonzero distance — **an apparent bug/typo in the original AI code** (should almost certainly reference `gunOb["grenade"].splash = 79`), meaning bots throw grenades at essentially any range rather than only from a safe outside-blast-radius distance.
- Icon/body frame: `"grenade"`.

### Land Mine (`mine`) — `Unit.as:1281-1284`
- Spends 100 energy, immediately calls `gun.makeBullet(Stats_Guns.gunOb["mine"])` (no throw animation/`shootPause` — instant drop, unlike grenade).
- Sub-weapon stats (`Stats_Guns.as:712-741`): **`dmg=55`**, `force=15`, `splash=79`, `splashMult=0.7`, class `Bullet_Proj_Mine`, `params=[30]`, hit sound `S_rocketExplode`.
  - `Bullet_Proj_Mine`: falls (`yVel` ramps to a cap of 15) until it lands on a wall/ground surface (snaps up out of the wall, `hitWall=true`), then arms and paints itself via `mine0` frame states (`"off"` blinking, `"team"`/`"on"` tinted by allegiance once triggered). Detonates (`doHitEffect(true)`) when a **non-allied unit** touches it (`hitType=="unit" && hitObject!=unit` and opposing team, or neutral) **or** after a safety timeout of `params[0]*30` = **900 frames = 30 s**. This matches the ability's own "Detonation: Proximity" label and its "can now distinguish between ally and enemy" description — allied units simply never trigger it via the team check.
- **AI usage condition:** `if (!target && ability.id=="mine" && Math.random()<0.1 && !stand && !nostand) doAbility()` (`AI.as:586-589`) — bots drop mines opportunistically (10%/frame) while patrolling with no visible target, and not while standing still/blocked.
- Icon/body frame: `"mine"`.

### Teleport (`teleport`) — `Unit.as:1285-1304`
- Spends only **30 energy** (§2). Plays a `smoke_big` effect and `S_Jumppad` at the old position, a `spawn`/`"idle"` VFX, then picks `UT.randEl(game.arena.spawns)` — **a uniformly random spawn node on the map** (not "nearby," despite the flavor text saying "short distances" — it can teleport anywhere a spawn point exists) — calls `setAiSpawnNode(node)` (re-anchors AI navigation), moves `x = node.x + UT.rand(-5,5)`, `y = node.y`, plays a second `smoke_big` + `S_Powerup` + `spawn` VFX at the new position, and zeroes `mov.xVel`, `mov.yVel`, `mov.xVelSlide` (kills all momentum on arrival).
- **AI/defensive dodge trigger** (shared with Static Field, `Status.damage()` — `Status.as:250-269`): for non-human units whose equipped ability is `"static"` or `"teleport"`, every incoming hit rolls `Math.random() < 0.05 + (1 - hpCur/hpMax) * 0.3` (5% base, up to 35% near-death) to set `attemptShield = true`, which `Status.EnterFrame()` (`Status.as:397-401`) converts into an unconditional `unit.doAbility()` call next frame — i.e. low-health bots with Static Field or Teleport equipped increasingly try to panic-dodge incoming damage (subject to having the energy).
- **AI wandering trigger:** `if (!target && ability.id=="teleport" && Math.random()<0.02) doAbility()` (`AI.as:566-580`) — 2%/frame teleport while no target is visible.
- Icon/body frame: `"teleport"`.

## 4. Icons / sounds summary

There is no separate ability-icon SWF symbol referenced from these files — the "icon" shown on a unit is the shared body part clip's `ability` sub-timeline, driven purely by frame label = `ability.sprite` (identical to `ability.id` for every entry): `unit.MC.body.ability.gotoAndStop(unit.ability.sprite)` (`Unit.as:339`, `UnitMC.as:205`, also mirrored on flag-capture in `NodeCtfFlag.as:103` and on physics ragdoll spawn in `PhysActor.as:87`). The Armory/loadout screen's `Ability_ButtonList_BlackButton_85` (`Raze2_fla/Ability_ButtonList_BlackButton_85.as`) is the shop's selectable-button chrome, not a per-ability icon asset — actual per-ability icon art lives inside the shared body-part MovieClip's `ability` timeline (out of scope for this doc; see `02-player-rig-skins.md`).

| Ability | Activation sound |
|---|---|
| Static Field | `S_Static` |
| Emergency Heal | `S_Heal` (human only) |
| Cloak | `S_Powerup` (human only) |
| Resupply | `S_Equip` (human only) |
| Katana | `S_Whip` (swing) + randomized `S_Headshot1/2/3` on unit hit |
| Grenade | `S_Whip` (throw) + `S_rocketExplode` (detonation) |
| Land Mine | `S_rocketExplode` (detonation only; no throw sound) |
| Teleport | `S_Jumppad` (depart) + `S_Powerup` (arrive) |

## 5. AI ability usage (brief — see `09-ai-bots.md` for full AI behavior)

All triggers live in `AI.as` (~lines 566-597) plus one shared reactive trigger in `Status.as`:

| Condition | Ability | Chance | Line |
|---|---|---|---|
| No target visible | `teleport` | 2%/frame | `AI.as:566-580` |
| No target visible | `cloak` | 10%/frame | `AI.as:582-585` |
| No target, not standing/blocked | `mine` | 10%/frame | `AI.as:586-589` |
| Target within `sword.range*10` = 70px | `sword` | always (on condition) | `AI.as:590-593` |
| Target beyond `sword.splash` (bugged — see §3) | `grenade` | always (on condition) | `AI.as:594-597` |
| HP < 50 | `heal` | 3%/frame | `Status.as:402-405` |
| Hit while equipped `static`/`teleport`, non-human | dodge (either) | `5% + (1 - hp/hpMax)*30%` per hit | `Status.as:250-269`, consumed in `Status.as:397-401` |

All AI triggers still pass through the same `doAbility()` energy/state gate as the player (§1) — a bot "wanting" to use an ability with insufficient energy simply no-ops that frame.

## Port status

Ported in `raze-ts/src/game/Abilities.ts` (definitions/activation) and `raze-ts/src/game/Status.ts` (energy bank).

### Correct
- All 8 ability ids, names, `rechargeSec`, `usedEnergy` (incl. Teleport's 30), and shop costs match `Stats_Abilities.as` exactly (`Abilities.ts:48-56`).
- `recharge = 3.3/rechargeSec` formula reproduced verbatim (`Abilities.ts:60`).
- Energy gate (`hasEnergy`/`useEnergy`, 0..100 bank) matches (`Status.ts:59-63`).
- Cooling Packs (`equips.recharge`) multiplier on `abilityCharge` reproduced (`Status.ts:49`).
- Static Field grounded-only restriction reproduced (`Abilities.ts:125`).
- Cloak duration (4s→120 frames) and Emergency Heal's 150px ally radius match exactly.
- Katana's 5-frame invulnerable window is reproduced as `invinTimer = 5` (parry timing correct, though see below for the reflect/no-damage distinction).
- Teleport's "random spawn node, zero all velocity" behavior matches.
- `ammo` (Resupply) correctly modeled as the sole free (`cost=0`) default ability (`Abilities.ts:76`, `isAbilityOwned`).

### Wrong / incomplete
- **AI difficulty energy-regen scalar missing:** original `Status.setAbility()` multiplies `abilityCharge` by `unit.diff*0.1+0.5` for non-human units (`Status.as:132-135`); the port's `Status.ts:49` only applies the Cooling Packs multiplier, never the AI diff scalar — bots at every difficulty recharge abilities at the same (human) rate in the port, whereas the original slows low-difficulty bots to 50% and ramps up with difficulty.
- **Static Field has no projectile-reflect**, only invulnerability + action-lock — explicitly called out as a known gap in the port's own doc-comment (`Abilities.ts:15-16`); the original's `sMirror`-based "reflection" (nullifying, not literally bouncing back, incoming hits) is unimplemented.
- **Katana damage scale inconsistent with the port's own established ×10 convention** (`03-weapons-guns.md:38` — the port scales all raw `Stats_Guns` `dmg` fields ×10 because its `Status` HP base is ~1000 vs Raze 2's ~100). Under that rule, `sword.dmg=75` should port to `750`; `Abilities.ts:112` instead hardcodes `SWORD_DAMAGE = 300` — the Katana is ~2.5× weaker relative to the port's own guns than in the original. `SWORD_RANGE = 90` (`Abilities.ts:111`) vs. the original's `range*10 = 70` is also inflated (~1.3×).
- **Grenade/Mine ability damage also diverges from the ×10 rule:** original `grenade.dmg=45` → expected `450`, port uses `damage: 650` (`Abilities.ts:204`); original `mine.dmg=55` → expected `550`, port uses `damage: 750` (`Abilities.ts:218`). Both are over-scaled versus the sibling ×10 convention (and versus the Katana's under-scaling above) — the three melee/thrown abilities are not damage-consistent with each other or with the shop guns.
- **Grenade fuse timer:** port uses `bounceLife: 40` frames (~1.33s); original bytecode timeout is 60 frames (2s) per `Bullet_Proj_Bounce` (`params[3]*30`) — not a large gap, but neither matches the original's own (also inaccurate) "1 second" flavor text, so there's no unambiguous "correct" target here; flag for a balance-pass decision rather than a strict bug.
- **Emergency Heal uses percentage-of-max-HP** (`0.6`/`0.3` fractions, `Abilities.ts:161,168`) rather than the original's flat `60`/`30` HP amounts. Because the port's `Status.hpMax` is a fixed ~1000 base (`Status.ts:41`) this is numerically equivalent under normal play, but it diverges from the original whenever `hpMax` is modified (Combat Armor equip, or an equivalent to the original's "4x Health" special mode) — original heal amounts stay flat (60/30 HP) regardless of max HP, so on a boosted-HP unit the port's heal is proportionally stronger than the original's.
- **AI ability-usage heuristics (§5) are documented here but not verified against `AI.ts`** — cross-check against `09-ai-bots.md` when that doc is written/reviewed, including whether the port reproduces (or intentionally fixes) the original's `grenade`-uses-`sword.splash` bug.

### Missing
- No equivalent of the tutorial-only forced-ability scripted event (`Unit.as:876-887`, campaign tutorial forces `ammo`) — out of scope unless campaign scripting is ported; note for `10-campaign.md`.
