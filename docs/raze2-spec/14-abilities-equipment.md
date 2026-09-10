# Abilities & Equipment

## 1. Summary

Raze 2 gives every unit one **F-key ability** (offense/defense/utility/relocation, chosen
from a pool of 8 + "none") and up to **3 passive equipment items** (one per slot: Armor,
Perk, Weapon-mod). Abilities are powered by a per-unit **energy bar** (0-100) that recharges
every frame at a fixed rate derived from the ability's `rechargeSec`; pressing the ability
key spends `usedEnergy` and runs a hard-coded effect switch in `Unit.doAbility()`. Equipment
has no energy cost or cooldown — each item is a single `(type, value)` pair merged into a
per-unit `equips` map at spawn, and every other system (`Status`, `Guns`, `Bullet`,
`KillPoints`) reads `unit.equips.<type>` directly wherever that stat matters. Both catalogs
are pure data tables (`Stats_Abilities.as`, `Stats_Equipment.as`); all *behavior* lives in
the consuming systems.

## 2. Raze 2 source of truth

### 2.1 Files or the ability/equipment domain

| File | Role |
|---|---|
| `Stats_Abilities.as` | Ability catalog: `getAbility(id)` builds one ability's stat object; `abilityOrder` (selection-index array) |
| `Stats_Equipment.as` | Equipment catalog: `equip0Ar` / `equip1Ar` / `equip2Ar` (one array per slot), `getEquipment(cls, idx)` |
| `Unit.as` | `doAbility()` (:1151-1308) runs the effect; `abilityExtra()` (:1335), `abilityDone()` (:1344); `equips` map construction (:186-199) |
| `Status.as` | Energy bar (`enCur`/`enMax`, `hasEnergy`/`useEnergy`, :194-202); recharge rate setup `setAbility()` (:119-136); passive equip effects in `damage()`, `heal()`, `shield()`, `EnterFrame()`, ctor |
| `Bullet.as` / `Bullet_Line_Effect.as` | Static Field's `sMirror` projectile-reflect check; `equips.range` extends `maxDist` (Bullet.as:101-104) |
| `Guns.as` | `equips.recoil` (spread), `equips.rof` (fire delay), `equips.ammo` (pickup refill) |
| `KillPoints.as` | `equips.credits` flat per-kill bonus (:73-82) |

### 2.2 Ability catalog (`Stats_Abilities.as:39-291`)

`abilityOrder = ["ammo","cloak","static","heal","sword","grenade","mine","teleport"]` — this
array's index is what gets persisted per-profile (`getAbilityByNum`). `getAbility(id)`
returns an object per switch-case; every case also gets `.num = abilityOrder.indexOf(id)`
and `.recharge = 3.3 / rechargeSec` appended (line 289) after the switch. "none" (case 0,
not in `abilityOrder`) is the default/no-ability state.

| id | name | type | rechargeSec | usedEnergy | cost (credits) | effect (flavor) | extra |
|---|---|---|---:|---:|---:|---|---|
| none | Nothing | N/A | 0 | 100 | 0 | None | — |
| static | Static Field | Defensive | 10 | 100 | 1300 | Invincibility + Reflection | `duration=1.5`s |
| heal | Emergency Heal | Defensive | 15 | 100 | 1500 | Heals 60 HP | `heal=60` self, `healTeam=30` allies |
| cloak | Cloak | Utility | 10 | 100 | 500 | Invisibility | `duration=4`s |
| ammo | Resupply | Utility | 20 | 100 | 0 (free default) | Adds 1 ammo clip | — |
| sword | Katana | Offense | 2 | 100 | 2200 | Melee attack | — |
| grenade | Grenade | Offense | 5 | 100 | 2800 | Throw a grenade | "Detonation: 1 second" (flavor text only — actual fuse is 2s, see §2.4) |
| mine | Land Mine | Offense | 7 | 100 | 3500 | Drop a mine | Detonation: proximity |
| teleport | Teleport | Relocation | 7 | 30 | 4600 | Teleports Player | "3 per Recharge" (30 energy × 3 = 90 of the 100 bar; a full bar buys 3 blinks) |

`recharge = 3.3 / rechargeSec` is a **per-frame energy delta** at 30 fps, so real-world
seconds to fill a 0→100 bar = `100 / (3.3/rechargeSec) / 30 = rechargeSec × 100/99 ≈
rechargeSec × 1.0101`. i.e. `rechargeSec` is *approximately* (not exactly) the real recharge
time; the ≈1% slack is a side effect of the `3.3` constant rather than `3.0`.

Total ability cost (`Init()` trace, line 39-55) sums `abilityOrder` costs: 1300+1500+500+0+
2200+2800+3500+4600 = **20400** credits to own everything.

### 2.3 Equipment catalog (`Stats_Equipment.as:40-113`)

Three parallel arrays, `equip0Ar`/`equip1Ar`/`equip2Ar`, index 0 in each slot is always
"Nothing" (cost 0, empty `type`, so it contributes no key to the runtime `equips` map).
`addEquipment(cls, name, type, value, cost, desc)` signature; `getEquipment(cls, idx)`
indexes into the array for that slot.

**Slot 0 — Armor:**

| idx | name | type | value | cost | desc / effect |
|---:|---|---|---:|---:|---|
| 0 | Nothing | "" | 0 | 0 | None |
| 1 | Flux Capacitor | `shield` | 0.8 | 400 | "-20% all damage when you have a shield" |
| 2 | Medipack | `hprecover` | 0.2 | 800 | "Quickly regenerate health when under 40%" |
| 3 | Armor Plating | `critdef` | 1 | 1200 | "Immune to fire and critical hits to head/butt/crotch" |
| 4 | Combat Armor | `health` | 50 | 1600 | "+50% max health" (flavor text is misleading — see §4) |
| 5 | Adrenaline Boost | `final` | 1 | 2000 | "Fatal attacks will reduce you to 1% health" |
| 6 | *(unnamed, cost 0)* | `health` | 100 | 0 | desc `"6"` — dead/unused catalog slot, never shown or reachable in the shop UI (see §6) |
| 7 | *(unnamed, cost 0)* | `health` | 400 | 0 | desc `"7"` — same |

**Slot 1 — Perk:**

| idx | name | type | value | cost | desc / effect |
|---:|---|---|---:|---:|---|
| 0 | Nothing | "" | 0 | 0 | None |
| 1 | Point Allocator | `credits` | 2 | 600 | "+2 Credits earned per kill" |
| 2 | Pickup Booster | `pcboost` | 1.6 | 900 | "+60% health/shield from pickups" |
| 3 | Power Extender | `powerup` | 1.4 | 1200 | "+40% powerup duration" |
| 4 | Cooling Packs | `recharge` | 1.3 | 1500 | "+30% faster ability recharge" |
| 5 | Shield Battery | `spspawn` | 25 | 1800 | "Spawn with 25% Shield" |
| 6 | *(unnamed, cost 0)* | `spspawn` | 50 | 0 | desc `"6"` — dead/unused catalog slot |

**Slot 2 — Weapon mod:**

| idx | name | type | value | cost | desc / effect |
|---:|---|---|---:|---:|---|
| 0 | Nothing | "" | 0 | 0 | None |
| 1 | Stabilizer | `recoil` | 0.6 | 1000 | "+40% weapon accuracy" |
| 2 | Spiral Chamber | `range` | 10 | 1200 | "Weapons fire further" |
| 3 | Target Marker | `critical` | 1.2 | 1400 | "+20% damage to heads, crotches, and butts" |
| 4 | Hair Trigger | `rof` | 0.8 | 1600 | "+20% weapon fire speed" |
| 5 | Extra Clips | `ammo` | 1 | 1800 | "Pick up weapons with full ammo" |

Total equipment cost (`Init()` trace) sums every entry with `cost > 0` across all three
arrays (the two dead `health`/`spspawn` rows are cost-0 and excluded automatically) =
400+800+1200+1600+2000 + 600+900+1200+1500+1800 + 1000+1200+1400+1600+1800 = **17000**
credits for the full set (15 purchasable items, 5 per slot).

### 2.4 Equip → runtime map (`Unit.as:186-199`)

```as3
equips = {};
if (MatchSettings.isCampaign || MatchSettings.equipsOn) {
  for (i = 0; i < 3; i++) {
    equips[Stats_Equipment.getEquipment(i, param2["equip"+i]).type]
      = Stats_Equipment.getEquipment(i, param2["equip"+i]).value;
  }
}
```

So `equips` is a flat `{type: value}` dict built from whichever 3 items (one per `cls`
0/1/2) the profile has equipped (`SD.equips = [i0, i1, i2]`, indices into each array — see
`SD.as:149`, `MatchSettings.as:236-238`). Equipping "Nothing" writes `equips[""] = 0`, a key
nothing ever reads. **Gate:** if neither campaign nor the Quick-Match "Equipment" toggle is
on, `equips = {}` entirely — no item's effect applies for that match.

Every consumer below reads `unit.equips.<type>` directly; there is no other indirection
layer.

| type key | read by | effect (exact) |
|---|---|---|
| `shield` | `Status.damage()` :345 | `shCur -= param1 * unit.equips.shield` instead of `-= param1` while shield is up → **0.8× damage while shielded** (net -20%) |
| `hprecover` | `Status.EnterFrame()` :415-424 | if `hpCur < 40`: `unit.equips.heal(unit.equips.hprecover, false)` → **regen 0.2 HP per frame** (6 HP/s @30fps) while under the flat 40-HP threshold (not a % of `hpMax`) |
| `critdef` | `Status.damage()` :236, :274, :293, :301 | disables `setFire` ignition; zeroes head/butt/crotch multiplier application (only applied `if (!unit.equips.critdef)`) |
| `health` | `Status` ctor :82-91 | `hpMax += unit.equips.health` — a **flat add**, not a percentage, despite the "+50%" flavor text (see §4) |
| `final` | `Status.damage()` :242-244, :358-361 | `finalChance = true` if `hpCur != 1`; on a would-be-lethal hit, `hpCur` is clamped to `1` instead of `0` (one-shot floor, re-arms once healed) |
| `credits` | `KillPoints.as` :73-81 | `points += killer.equips.credits` — flat add to the kill's credit payout |
| `pcboost` | `Status.shield()` :160, `Status.heal()` :181 | multiplies the healed/shielded amount from **pickups** (`param1 * pcboost`) |
| `powerup` | not read directly in `Status.as`/`Unit.as` core (powerup-duration scaling is applied at the point powerups are granted) | stretches timed power-up durations |
| `recharge` | `Status.setAbility()` :122-131 | `abilityCharge *= unit.equips.recharge` — ability energy fills 1.3× faster |
| `spspawn` | `Status.reset()` :141-143 | `if (unit.equips.spspawn) shield(unit.equips.spspawn, false)` — spawn with that many shield points already up (value is a raw amount added via `shield()`, not literally "%" despite the desc — `shMax` is 100, so `spspawn=25` does read as 25% of the 100-point shield pool) |
| `recoil` | `Guns.as` :284-286 | `if (unit.equips.recoil) dynRecoil *= unit.equips.recoil` — 0.6× spread |
| `range` | `Bullet.as` :101-104 | `if (unit.equips.range) maxDist += unit.equips.range` — flat add to bullet's max travel distance |
| `critical` | `Status.damage()` :288-311 | on a head/butt/crotch hit, `param1 *= param2.equips.critical` (extra multiplier stacked on top of the weapon's own crit multiplier) |
| `rof` | `Guns.as` :406 | `shootDelay = curGun.shootDelay * (sRapid ? 15 : (!equips.rof ? 30 : 30*equips.rof))` — 0.8× the frame delay between shots (20% faster fire) |
| `ammo` | `Guns.as` :132 (pickup) | picked-up weapons arrive with a full clip/reserve instead of the pickup's partial amount |

## 3. Ability effects (`Unit.doAbility()`, `Unit.as:1151-1308`)

Common gate (all abilities): `!hasFlag`, `diff` truthy, `game.gameStarted`,
`status.hasEnergy(ability.usedEnergy)`, `!dead`, `!permInvis`, `!game.paused`.

| id | on activation | notes |
|---|---|---|
| `static` | Only if `!mov.jumping` (else no-op, energy untouched). `gun.reloading=false`; plays `S_Static`; `game.arena.setShake(3,8)` if human else `(3,5)` if on-screen; `abilityPause=true`; `useEnergy(100)`; `status.sMirror = duration*30` (=45 frames @1.5s); `MC.goto("armorlock")` + both arm clips → `"armorlock"`. `abilityPause` blocks shooting/reloading/movement input (`Guns.as:255,332,467,491`, `Movement.as:128`) until `abilityDone()` clears it. |
| `heal` | `S_Heal` if human; `useEnergy(100)`; `status.heal(ability.heal=60, true)` (self, with FX); if `team`: loop all units, heal any teammate within `getDist < 150` by `ability.healTeam=30` (with FX) |
| `cloak` | `S_Powerup` if human; `useEnergy(100)`; `status.sInvis = duration*30` (=120 frames @4s) |
| `ammo` | `S_Equip` if human; `useEnergy(100)` (hard-coded, matches `usedEnergy`); `gun.addClip(gun.curNum, 1)`; `createEffect("getweapon")` |
| `sword` | `gun.reloading=false`; `useEnergy(100)`; `gun.makeBullet(Stats_Guns.gunOb["sword"])` (dmg 75, range 7, force 15 — a melee hitbox check via `Bullet_Melee_Basic`, not a projectile); `shootPause=true`; both arm clips → `"sword"`; `status.sMirror=5` (a tiny 5-frame reflect/glow window on the swing, not the full Static duration); `MC.body.ability.gotoAndStop("none")`; `S_Whip` |
| `grenade` | `gun.reloading=false`; `useEnergy(100)`; `shootPause=true`; both arm clips → `"grenade"`; `S_Whip`. **The throw itself is deferred**: `abilityExtra()` (called from an animation-clip frame label, `Unit_Arms1_27.as:175`) fires `gun.makeBullet(Stats_Guns.gunOb["grenade"])` — dmg 45, splash 79, splashMult 0.7, `Bullet_Proj_Bounce` with params `["grenade",3,3,2]` (3 bounces, 2s fuse: `params[3]*30`=60 frames — the "Detonation: 1 second" catalog text is stale/wrong) |
| `mine` | `useEnergy(100)`; `gun.makeBullet(Stats_Guns.gunOb["mine"])` immediately (no wind-up) — dmg 55, splash 79, splashMult 0.7, `Bullet_Proj_Mine` with params `[30]` |
| `teleport` | `useEnergy(30)`; `createEffect("smoke_big")` at old pos; `S_Jumppad`; `createEffect("spawn","idle",true)`; pick `UT.randEl(game.arena.spawns)`; `setAiSpawnNode`; `x = node.x + rand(-5,5)`, `y = node.y`; `createEffect("smoke_big")` + `S_Powerup` + `createEffect("spawn","idle",true)` at new pos; zero `mov.xVel`/`yVel`/`xVelSlide` |

`abilityDone()` (:1344-1367, called from the arm animation's end-of-clip frame label) clears
`abilityPause`/`shootPause`, resets the gun frame, and (`sword`) sets the idle body pose to
`"sword"` so the weapon shows again.

**Static Field reflection mechanic** (`sMirror`, not documented in the catalog's flavor
text): while `status.sMirror > 0`, `Status.damage()` (`:216`) returns early — **all** damage
is blocked, this *is* the invincibility. Separately, `Bullet.as:180-199` /
`Bullet_Line_Effect.as:86-89`: when a bullet's `hitObject.status.sMirror` is truthy and the
bullet doesn't already have `extra.reflect` set, the bullet is destroyed and a **new bullet
of the same stats is spawned owned by the shielded unit**, aimed back along
`UT.rotBounceOff(...)` (`± rand(-10,10)` degrees) — i.e. reflection literally re-fires the
same weapon at the original shooter, tagged `{reflect: unit}` so it can't re-reflect
infinitely.

## 4. Reference screenshot

The in-game loadout bar (screenshot #6, per the spec README's reference map) shows the
equipped ability icon + energy bar and the 3 equipment slot icons docked in the HUD; no
separate ability/equipment screenshot was provided to this domain — cross-reference
`11-armory-loadout.md` (which owns screenshot #6 and the shop UI itself) for the exact pixel
layout, fonts, and panel chrome of the Armory screen where abilities/equipment are bought
and equipped. This doc is the values/behavior source of truth; that doc is the presentation
source of truth.

## 5. Current port state

Files: `raze-ts/src/game/Abilities.ts`, `raze-ts/src/game/Equipment.ts`,
`raze-ts/src/game/Status.ts`, `raze-ts/src/assets/raze2/equipment.json` (extracted 1:1 from
`Stats_Equipment.as`, including the two dead `health`/`spspawn` rows and `desc` text —
verified byte-for-byte against §2.3 above). **There is no `abilities.json`** — the ability
catalog is inlined as the `RAW` table directly in `Abilities.ts:48-58` instead of being
data-driven from an extracted asset (inconsistent with equipment/weapons/skins, which are
all JSON-driven — see gap analysis).

### 5.1 Abilities (`Abilities.ts`)

- Catalog (`RAW`, lines 48-58) matches `Stats_Abilities.as` values exactly: ids, names,
  types, `rechargeSec`, `usedEnergy`, `cost` all agree with §2.2. `recharge = 3.3/rechargeSec`
  reproduced verbatim (line 61, comment cites `Stats_Abilities.as:289`).
- `activateAbility()`/`apply()` (lines 125-272) reimplements every `doAbility()` case:
  - `static`: sets `invinTimer` + `reflectTimer` + `unit.abilityLock` all to `1.5*30=45`
    frames, plays `R2_Static`. **Gap:** the original's ground-check gate (`!mov.jumping`) is
    preserved (line 132) but the port's static effect duration for `sMirror`/reflect and
    `invinTimer` are unified into one 45-frame window; the original's own `sMirror` set by
    `static` is also 45 frames so this matches. Arm/armorlock animation triggers are not
    reproduced (expected — the port's rig is different, tracked in doc 05).
  - `heal`: flat `HEAL_SELF=600`/`HEAL_TEAM=300` (=60/30 ×10, matching the port's ×10 HP
    convention) within `HEAL_RADIUS=150` — matches original 60/30/150 exactly.
  - `cloak`: `fadeTimer = 4*30=120` frames — matches `duration=4`.
  - `ammo`: `gun.addClip(1)` — one clip into the current weapon's reserve, matching
    `gun.addClip(curNum,1)` exactly. (Was a full refill to max; fixed — see §6.2.)
  - `sword`: melee arc, `SWORD_RANGE=70` (=7×10) and `SWORD_DAMAGE=750` (=75×10) — both cite
    and match `Stats_Guns.as` sword gun stats (dmg 75, range 7) confirmed in §3.
  - `grenade`: thrown immediately (no wind-up delay matching the original's `abilityExtra()`
    animation-frame deferral — port throws same-frame); damage 450(=45×10), splashMult 0.7,
    bounce 3, `bounceLife=60` frames — all matching §3's grenade values (dmg 45, splashMult
    0.7, 3 bounces, 60-frame fuse).
  - `mine`: damage 550(=55×10), splashMult 0.7 — matches original dmg 55/splashMult 0.7.
    `mineLife=900` (30s) is a port addition/interpretation of the original's `params=[30]`.
  - `teleport`: picks a random spawn node, zeroes velocity — matches `Unit.as:1285-1304`
    intent (port doesn't reproduce the FX/sound sequencing order precisely but uses the same
    `S_Jumppad`/`S_Powerup` sounds at the same two moments).
- **Not reproduced:** the reflected-bullet mechanic is implemented differently — the port's
  `Status.reflectProjectiles()` (see below) reverses velocity/re-owns the *existing*
  projectile in place, rather than the original's destroy-and-respawn-a-new-bullet-of-the-
  same-stats approach. Functionally similar (the shot turns around and can hit the original
  attacker) but not byte-for-byte — no `rotBounceOff` angle jitter, no `{reflect: unit}` tag
  (uses a `reflected` boolean instead).

### 5.2 Equipment (`Equipment.ts` + `Status.ts` + `Guns.ts` + `Projectile.ts` + `KillBonus.ts`)

All 15 purchasable items are wired to a live effect. Cross-checked against §2.4:

| type | port location | fidelity |
|---|---|---|
| `shield` | `Status.ts:166` | Exact: `amount *= equips.shield` only while `shCur > 0` |
| `hprecover` | `Status.ts:285-287` | Exact behavior, flat-threshold preserved (`hpCur < 40*10`), amount scaled ×10 (`equips.hprecover*10`) |
| `critdef` | `Guns.ts:586-587,597-599` | Exact: crit mult zeroed + region forced to "body"; fire immunity gated the same way |
| `health` | `Status.ts:60` | **Documented as flat**, not %, matching the real AS3 behavior despite flavor text — correctly flagged as a gap between description and mechanic in the port's own comments |
| `final` | `Status.ts:181-186` | Exact one-shot-floor mechanic (1% HP), re-arm on heal above threshold reproduced (`finalSpent`) |
| `credits` | `KillBonus.ts:72-73` | Exact flat add to kill payout |
| `pcboost` | `Status.ts:106,120` | Exact: gates on a `boosted` flag so only true pickups (not ability heals) get the multiplier — matches original's explicit `heal(x, true)` vs `heal(x, false)` call-site distinction |
| `powerup` | `Status.ts:127-133` | Exact: multiplies `ddamage`/`fade`/`invin` timer durations, not spawn protection — matches original's semantics (powerup extends timed pickups, not the `sSpawn`/spawn-invuln timer) |
| `recharge` | `Status.ts:65` | Exact: multiplies `abilityCharge` |
| `spspawn` | `Status.ts:77` | Exact: `addShield(value/100, false)` on spawn, unboosted (matches `shield(x, false)`) |
| `recoil` | `Guns.ts:283` | Exact: multiplies spread factor |
| `range` | `Guns.ts:411`, `Projectile.ts:76-78` | Same effect, but the port **multiplies by ×10** (`equips.range*10`) instead of the original's flat `+= equips.range` — consistent with the port's broader ×10 world-unit convention (matches HP/damage scaling), not a bug, but worth flagging explicitly since it deviates from the literal AS3 line |
| `critical` | `Guns.ts:590` | Exact: extra multiplier stacked on top of the region multiplier, gated on `mult > 1` |
| `rof` | `Guns.ts:265` | Functionally equivalent 0.8× cooldown scale (port uses a different base fire-delay table than the original's `shootDelay*30`, but the *equip* multiplier itself is applied the same way) |
| `ammo` | `Guns.ts:204-209` | Exact: pickup arrives at full clip/ammo |

**Ownership/shop layer** (`Equipment.ts`): `equipsForSlot()` correctly filters out "Nothing"
and the two dead cost-0 rows (health=100/400, spspawn=50) from the buyable list — matches
the fact the original SWF shop UI only ever iterates the array by index and the dead rows
are simply unreachable filler in the source array, not real catalog entries.

## 6. Gap analysis

1. **No `abilities.json` extract.** Every other catalog (weapons, equipment, skins,
   killBonuses, achievements, campaign) is a JSON asset under `src/assets/raze2/`; abilities
   is hard-coded as a TS object literal inside `Abilities.ts`. Low risk (values verified
   correct) but inconsistent with the project's own data-driven convention and harder to
   diff against the source in future re-extractions.
2. ~~**Resupply (`ammo` ability) over-fills.**~~ **FIXED.** The port used to run
   `g.curAmmo = g.maxAmmo; g.curClip = g.maxClip`, fully rearming in one activation. It now
   calls `Guns.addClip(1)` (`Guns.ts:250`), matching `gun.addClip(gun.curNum, 1)`: one clip
   into the *reserve* of the *current* weapon only, leaving the loaded magazine alone. Since
   the port counts reserve ammo in rounds, one clip is `maxClip` rounds; `oneClip` weapons
   (chaingun/zapper/flamethrower, no separate pool) top up `curClip` instead. The
   `equips.ammo` → 999-clip override lives inside `addClip` as in the original, so Extra
   Clips still fills the reserve outright — which is what makes the paid equip worth buying
   over the free default ability again. Weapon crates were over-granting the same way and
   now go through `Guns.pickUpGun` → `addClip(id, ceil(clipMax/2))`, matching
   `NodePickup.getPickup` (doc 12 §5).
3. **Static Field reflect implementation differs mechanically** from the original's
   destroy-and-respawn-new-bullet approach (see §5.1) — same player-facing result (shot
   turns around, can kill the original attacker) but no angle jitter
   (`UT.rotBounceOff(...) + rand(-10,10)`), and uses a boolean flag instead of an explicit
   `{reflect: unit}` tag. Also, the port's reflect radius (`REFLECT_RADIUS = 70`) is a port
   invention — the original has no explicit radius check, it reflects on direct bullet-unit
   collision (`Bullet.hitType == "unit"`), which is effectively "on contact," not "within
   70px." The port's proximity-based reflect is a broader/different trigger condition than
   the original's contact-based one.
4. **Katana's `status.sMirror = 5` (5-frame glow/parry window) is not reproduced.** The
   original briefly re-arms the reflect flag for 5 frames on every sword swing (a minor
   parry-adjacent detail — a bullet that hits you in the ~166ms after swinging gets
   reflected too). The port's sword case only sets `st.invinTimer = max(st.invinTimer, 5)` —
   i.e. **brief invulnerability**, not reflection. This is a distinct mechanic
   (invuln vs. reflect-with-counter-damage) and is a genuine fidelity gap worth a decision
   in the build phase: reproduce the parry-reflect, or keep the port's simpler i-frame.
5. **Grenade throw timing.** Original defers the actual bullet spawn to an animation-frame
   callback (`abilityExtra()`), i.e. there is a wind-up (the throw animation plays first,
   then the grenade leaves the hand on a specific frame). The port spawns the projectile
   immediately on ability activation. Net gameplay effect is minor (no ability-lock frame
   count changes, since `rechargeSec` governs cooldown either way) but the *visual* sync
   between animation and projectile spawn will read differently once the port's arm-swing
   animation exists (tracked under doc 05, player animation).
6. **`equips.range` scaling factor (×10) vs. original's flat add** — see §5.2 table; flagged
   as intentional-but-undocumented-as-a-decision. Should be confirmed as correct in the
   build-phase checklist rather than silently assumed.
7. **Dead catalog rows.** The two unnamed cost-0 equipment rows in slot 0 (`health` 100/400)
   and the one in slot 1 (`spspawn` 50) are preserved in `equipment.json` for fidelity but
   correctly excluded from the shop UI (`equipsForSlot`). No action needed — flagging only so
   a future data-diff doesn't mistake them for "missing content."
8. **Ability energy bar visuals** (`unit.bar_en.alpha = enCur >= ability.usedEnergy ? 1 :
   0.6` — a dimmed bar when you can't afford to activate, `Status.as:386`) — not confirmed
   present in the port's HUD; cross-reference doc 07 (HUD) for the ability-bar rendering
   spec, this doc only owns the *value* (`getEnPer()`).

## 7. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Extract `src/assets/raze2/abilities.json` from `Stats_Abilities.as` (mirror the
   `equipment.json` shape: id, name, type, rechargeSec, usedEnergy, cost, effect/desc
   strings) and switch `Abilities.ts` to load from it, matching the other catalogs'
   data-driven pattern.
2. Decide + implement the Resupply fidelity fix (gap #2): change `apply("ammo")` in
   `Abilities.ts` to add one reserve clip (`g.curAmmo = min(maxAmmo, curAmmo +
   perClipAmmo)`) instead of a full refill, or explicitly document the buff as intentional
   in a code comment + this doc.
3. Decide + implement the Katana parry-reflect (gap #4): either add a genuine 5-frame
   `reflectTimer` pulse on `sword` (matching `sMirror=5`) so a well-timed hit gets reflected,
   or keep the current i-frame-only behavior and update this doc's "intentional deviation"
   list.
4. Re-evaluate Static Field's reflect trigger (gap #3): switch from the port's
   `REFLECT_RADIUS`-based proximity check to a direct bullet-hitbox collision check to match
   the original's contact-based reflect, if strict fidelity matters more than the current
   (more forgiving) proximity behavior. Add the `rotBounceOff`-style angle jitter
   (`± rand(-10,10)`) to the reflected shot's outgoing angle.
5. When the arm-swing / throw animation lands (doc 05), move the grenade's projectile spawn
   from `activateAbility()`-time to an animation-frame-triggered callback (mirroring
   `abilityExtra()`), so the visual throw and the projectile leaving the hand are in sync.
6. Confirm/document the `equips.range` ×10 scaling decision (gap #6) as a deliberate
   world-unit-convention choice in a comment at `Guns.ts:411` and `Projectile.ts:76-78`
   (partially already commented; make it explicit that this is a deviation from the literal
   AS3 `+=` and why).
7. Cross-check doc 07 (HUD) for the ability-bar dim-when-unaffordable visual (`bar_en.alpha`
   0.6/1.0 toggle) and wire it if missing.
8. No changes needed for: the 15 equipment effects (all verified exact or acceptably
   equivalent in §5.2), the ability catalog's numeric values (verified exact in §5.1), or the
   shop's dead-row filtering (already correct).

## 8. Open questions / data still missing

- The exact `Bullet_Melee_Basic` hit-test shape/reach for the Katana (used only for its
  `range=7` param interpretation) was not traced beyond confirming the `Stats_Guns.as` gun
  stat row — if the build phase wants a pixel-exact melee hitbox, trace
  `Bullet_Melee_Basic.as` separately (out of this doc's scope, which is abilities/equipment
  values and energy/effect wiring, not melee collision geometry — that belongs with doc 02,
  projectile physics).
- `equips.powerup`'s exact call site that multiplies power-up pickup durations was not
  located inside `Status.as`/`Unit.as` (only the *semantic* — "stretches timed power-ups" —
  is documented in the equipment catalog's own desc text and confirmed indirectly via the
  port's `Status.startStatus()` which does implement it against `ddamage`/`fade`/`invin`).
  If a literal AS3 line reference is required, search the powerup-pickup grant code (likely
  `PickupItem.as` or similar, outside this doc's read files) in a follow-up pass.
- Screenshot #6 (in-game loadout bar) was not analyzed pixel-by-pixel here since it belongs
  to doc 11 (Armory/loadout) per the domain split in the README; this doc only needed it to
  confirm the ability+equipment *data* is what's displayed there, which it is.
