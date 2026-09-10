# 03 — Weapons: Gun Data (the full arsenal)

Source of truth for every gun statistic in Raze 2. All numbers are read directly from
`Stats_Guns.as` (data table) and `Guns.as` / `Stats_Armory.as` (runtime plumbing). The
decompiled AS3 is obfuscated with a stack-machine (`§§push`/`§§pop`/`§§findproperty`)
control-flow flattener; every `addGun(...)` call below was manually re-linearized back
into normal argument order and cross-checked byte-for-byte against
`raze-ts/src/assets/raze2/weapons.json`, which the port already generated from the same
source and which matches exactly.

## 1. Where the data lives

| File | Role |
|---|---|
| `scripts/Stats_Guns.as` (`raze 2`) | The master data table. `Init()` (lines 106–753) calls `addGun(...)` once per gun (36 real guns, type 0–6) plus 6 ability/hazard pseudo-weapons (type 7). `addGun` signature at line 756; field assignment at 758–801. |
| `scripts/Guns.as` | Per-unit runtime: holds 7 gun slots (`gunSet[0..6]`, one per type/category), ammo, fire timing, reload, gun switching. Constructor at lines 57–105; `shoot()` at 329–445; `changeGun` at 252–322. |
| `scripts/Stats_Armory.as` | Buckets every `Stats_Guns` entry by `.type` into `gunsAr[type]` (all guns of that type, including unowned) and `gunsArmoryAr[type]` (only `cost >= 0`, i.e. purchasable/ownable — excludes the `cost: -1` secret `hrocket2`). `getGun(type, index)` (line 47) is how a `Guns` instance resolves `matchInfo.weapons[type]` → an actual `Stats_Guns` object. |
| `scripts/MatchSettings.as` | `weaponsUsed:String` match setting (line 101), default `"All"` (line 176). |
| `raze-ts/src/assets/raze2/weapons.json` | Port's pre-extracted array of all 42 `Stats_Guns` records (36 real guns + 6 type-7 pseudo-weapons), verified identical to the decoded AS3 below. |
| `raze-ts/src/game/weapons.ts` | Port's weapon defs: 10 hand-tuned "native" guns + all others auto-generated from `weapons.json` via `raze2ToDef()`. |
| `raze-ts/src/game/Guns.ts` | Port's per-unit gun controller (fire/reload/switch), with `FIRE_SOUND`/`RELOAD_SOUND` tables for the native 10 only. |

## 2. `addGun()` field layout

```
addGun(
  type, id, sprite, name, race, cost, dmg, mults[head,crotch,butt],
  force, splash, splashMult, clipSize, clipMax, range, recoil, autoFire,
  shootDelay, xOff, yOff, effShoot, effHit, effShell,
  frameIdle, frameFire, frameReload, shotSound, hitSound, cls, params[],
  extra{}, special, desc
)
```
(`Stats_Guns.as:756`, field writes `Stats_Guns.as:758-801`.)

Key semantics, read from `Guns.as`:
- `type` (uint 0–6) is the weapon **category/slot** (pistol/sidearm/shotgun/rifle/sniper/heavy/explosive). A unit always carries exactly one gun per slot (`gunSet[0..6]`), chosen from `matchInfo.weapons[type]` (`Guns.as:108-127`). Type 7 is not a slot — those are ability/hazard "guns" (fire DoT, katana melee, thrown grenade, land mine, the credits' `env` no-op, the Assault Bouncer's ember sub-munition) instantiated directly by other systems, never equipped from a slot.
- `dmg` — per-hit base damage at 1× multiplier (Raze 2's own HP scale, enemies/players ~100 HP). The port **scales all damage ×10** (`Math.round(w.dmg * 10)`, `weapons.ts:305`) because its `Status` HP base is ~1000. Table below lists both.
- `mults` = `[headMult, crotchMult, buttMult]` — locational crit multipliers, applied in `Unit`/`Status` damage resolution (region hit detection lives outside this doc's scope; the port re-implements it in `Guns.ts:436-491` `doHitUnit`, mapping head/crotch/butt 1:1 from `mults[0..2]`).
- `force` — knockback impulse applied to the target on hit.
`splash` / `splashMult` — explosion radius and damage falloff multiplier for splash-capable classes (0 = no splash).
- `clipSize` / `clipMax` — rounds per magazine, and max number of *spare* magazines the unit can carry (i.e. total ammo = `clipSize * clipMax`, except `useAmmo`/`oneClip` guns, see §5).
- `range` — max travel range in Raze 2 world units (bullet lifetime / hitscan length). Port doc note: `weapons.ts:284` treats this as tens-of-px (`range*10`) for its own scale.
- `recoil` — spread cone radius in degrees-ish (feeds `dynRecoil`/`dynRecoilMod` in `Guns.as:43-45,196-232`, which grows per shot up to `recoil*1.7` and decays 0.05/frame; crouching ×0.6, jumping ×1.2, moving ×1.1).
- `autoFire` (bool) — held-trigger full-auto vs click-to-fire semi-auto.
- `shootDelay` — seconds between shots at `unit.equips.rof` = 1 (`Guns.as:406`: `shootDelay * 30` frames at 30fps, `*15` under the "Rapid Fire" status, `*rof*30` with the Hair-Trigger equip).
- `xOff`/`yOff` — held-gun muzzle offset from the shoulder pivot (art alignment only).
- `effShoot`/`effHit`/`effShell` — particle-effect symbol names for muzzle/impact/ejected-shell-casing effects (symbols live in `sprites/`/`images/`, resolution belongs to the FX doc, not this one).
- `frameIdle`/`frameFire`/`frameReload` — **held-arm animation labels**. `Guns.as:239-248` does `unit.MC.arm1/arm2.gotoAndStop(frameIdle)`, `gotoAndPlay(frameFire + "_fire")`, `gotoAndPlay(frameReload + "_reload")`. These are shared arm-rig labels (`pistol`, `shotgun`, `rifle`, `sniper`, `heavy`, `rocket`), **not** per-gun unique animations — many guns of the same silhouette share one arm rig.
- `sprite` — the **pickup/HUD weapon-icon symbol** id, shown via `hud.weapon.gotoAndStop(curGun.sprite)` and `hud.weapHolders[n].weapon.gotoAndStop(...)` (`Guns.as:73,277,316`). This is the per-gun unique art (distinct from the shared arm-rig frame labels above).
- `shotSound`/`hitSound` — AS3 `Sound` subclass references (resolved at `Guns.as:373-387` for fire, and inside each `Bullet_*` class for impact/explosion).
- `cls` — the `Bullet_*` subclass used to simulate the shot; determines hitscan vs projectile vs beam vs melee. See doc 04 for per-class simulation details; this doc only records which class each gun uses.
- `params[]` — class-specific tuning array (bullet speed/homing radius/bounce count/tracer line style, etc. — fully specified in doc 04). For the two hitscan line classes (`Bullet_Line_Basic`, `Bullet_Line_Sniper`) `params = [randomizeStartPoint:Boolean, width1, color1(uint), alpha1, width2, color2(uint), alpha2, ...]`: each triple after the leading bool draws one more tracer-line layer (outer glow, inner core), confirmed in `Bullet_Line_Basic.as:44-64`. The **first color in that list is the closest analog to "muzzle-flash/tracer tint"** and is what the port's `muzzleColor` mirrors.
- `extra{}` — grab-bag of special-case flags consumed ad hoc by `Guns.as` and the `Bullet_*` classes: `extraShots` (fires N extra pellets per trigger pull, `Guns.as:390-397`), `useAmmo` (fractional ammo cost per shot, e.g. chaingun 0.5, `Guns.as:424`), `useCredits` (drains SD.credits instead of ammo, `Guns.as:346-350,418-421`), `useHp`/`stealHp` (Vamp Charger lifesteal, `Guns.as:369-371`), `mauser` (bonus-credit-on-kill flag), `setFire` (ignite chance/duration), `pierce`/`arc` (railgun variants), `burrow`, `bounceShots`, `soundFrames` (throttles repeat-fire sound spam for beam weapons, `Guns.as:375-381`).
- `special` — the one-line perk name shown in the shop/loadout UI (e.g. "Homing", "Multi-Shot", "Headshot+").
- `desc` — shop/loadout flavor text.

## 3. Master gun table (all 36 real guns, type 0–6)

Damage columns: **Dmg** = Raze 2 raw `dmg`; **Dmg×10** = the port's scaled value (`Math.round(dmg*10)`, `weapons.ts:305`) for cross-reference.

| Type | Id | Name | Race | Cost | Dmg | Dmg×10 | Mults H/C/B | Force | Clip/Spare | Range | Recoil | Auto | Delay(s) | Splash | Class |
|---|---|---|---|---:|---:|---:|---|---:|---|---:|---:|:-:|---:|---|---|
| 0 | pistol | M9 Barret | Human | 0 | 12 | 120 | 1.2/2/1.2 | 3 | 18×10 | 60 | 5 | N | 0.25 | – | Bullet_Line_Basic |
| 0 | plaspistol | Plasma Pistol | Alien | 850 | 10 | 100 | 1.2/1/1 | 3 | 14×10 | 45 | 5 | Y | 0.20 | – | Bullet_Proj_Follow |
| 0 | burster | Ripper | Human | 850 | 4 | 40 | 1.2/1.2/1.2 | 3 | 18×10 | 30 | 5 | Y | 0.15 | – | Bullet_Line_Basic |
| 0 | mauser | Golden Mauser | Human | 600 | 9 | 90 | 1.2/1.2/1.2 | 1 | 12×10 | 45 | 5 | N | 0.25 | – | Bullet_Line_Sniper |
| 1 | uzi | Uzi | Human | 0 | 12 | 120 | 1.5/1.2/1.2 | 5 | 28×3 | 38 | 9 | Y | 0.15 | – | Bullet_Line_Bend |
| 1 | magnum | Magnum | Human | 900 | 25 | 250 | 2.5/1.2/1.2 | 10 | 6×3 | 60 | 2 | N | 0.40 | – | Bullet_Line_Basic |
| 1 | sparkgun | Burst Torch | Alien | 1300 | 10 | 100 | 1.2/1.2/1.2 | 7 | 10×3 | 70 | 3 | N | 0.25 | 60 / 0.1 | Bullet_Proj_Basic |
| 1 | blaster | Photon Blaster | Alien | 1800 | 4 | 40 | 1.2/1.2/1.2 | 3 | 18×3 | 50 | 5 | Y | 0.20 | – | Bullet_Proj_Basic |
| 1 | blood | Vamp Charger | Unknown | 2600 | 9 | 90 | 0/0/0 | 0 | 20×3 | 60 | 6 | N | 0.25 | – | Bullet_Proj_Basic |
| 2 | shotgun | Shotgun | Human | 0 | 22 | 220 | 1.2/1.2/1.2 | 4 | 4×3 | 23 | 10 | N | 0.80 | – | Bullet_Line_Basic |
| 2 | pshotgun | Plasma Shot | Alien | 900 | 7 | 70 | 1.2/1.2/1.2 | 2 | 12×3 | 28 | 6 | Y | 0.20 | – | Bullet_Line_Bend |
| 2 | zapper | Zapper | Alien | 1300 | 3.5 | 35 | 0/0/0 | 0 | 100×3 | 20 | 0 | Y | 0.05 | – | Bullet_Line_Zapper |
| 2 | tshotgun | Terminator | Human | 1800 | 15 | 150 | 1.2/1.2/1.2 | 5 | 5×3 | 43 | 5 | N | 0.70 | – | Bullet_Line_Sniper |
| 2 | pcanon | Particle Cannon | Alien | 2600 | 10 | 100 | 1.2/1.2/1.2 | 5 | 5×3 | 23 | 9 | N | 0.80 | 3 / 1.5 | Bullet_Proj_Bounce |
| 3 | arifle | Assault Rifle | Human | 0 | 9 | 90 | 1.2/1.2/1.2 | 6 | 24×3 | 80 | 4 | Y | 0.15 | – | Bullet_Line_Basic |
| 3 | alienrifle | Bubble Blaster | Alien | 900 | 8 | 80 | 1/1/1 | 3 | 20×3 | 60 | 7 | Y | 0.15 | – | Bullet_Proj_Follow |
| 3 | laserrifle | Precision Laser | Alien | 1300 | 7 | 70 | 2.7/2.5/2.5 | 6 | 24×3 | 70 | 1 | Y | 0.20 | – | Bullet_Line_Basic |
| 3 | icegun | Hail Storm | Human | 1800 | 9.5 | 95 | 1.2/1.2/1.2 | 4 | 100×2 | 90 | 2 | Y | 0.20 | 3 / 1.5 | Bullet_Proj_Bounce |
| 3 | arifl2 | Assault Bouncer | Human | 2600 | 5 | 50 | 0/0/0 | 1 | 14×3 | 45 | 5 | Y | 0.20 | – | Bullet_Proj_Follow |
| 4 | sniper | .50 Cal Sniper | Human | 0 | 45 | 450 | 2.5/1.2/1.2 | 15 | 4×3 | 300 | 1 | N | 0.60 | – | Bullet_Line_Sniper |
| 4 | railgun | Railgun | Human | 1300 | 55 | 550 | 1.5/1/1 | 15 | 3×3 | 300 | 1 | N | 0.80 | – | Bullet_Line_Effect |
| 4 | asniper | Pulsator | Alien | 1800 | 70 | 700 | 1.2/1/1 | 15 | 5×3 | 300 | 2 | N | 0.70 | 60 / 1.0 | Bullet_Proj_Basic |
| 4 | sniper2 | Holy Grail | Alien | 2600 | 110 | 1100 | 0/0/0 | 20 | 1×6 | 300 | 0 | N | 2.00 | – | Bullet_Line_Sniper |
| 4 | railgun2 | Electro Bolt | Alien | 3400 | 45 | 450 | 0/0/0 | 1 | 6×3 | 300 | 1 | N | 0.50 | – | Bullet_Line_Electric |
| 5 | chaingun | Laser Minigun | Human | 0 | 3.5 | 35 | 0/0/0 | 1 | 100×2 | 50 | 7 | Y | 0.05 | – | Bullet_Line_Basic |
| 5 | sawgun | Shredder | Human | 1300 | 40 | 400 | 1.2/1.2/2.5 | 10 | 12×3 | 300 | 6 | N | 0.60 | – | Bullet_Proj_Basic |
| 5 | beamer | Focus Beam | Alien | 1800 | 3 | 30 | 0/0/0 | 2 | 70×3 | 50 | 0 | Y | 0.05 | – | Bullet_Line_Laser |
| 5 | destroyer | Destroyer | Alien | 2600 | 26 | 260 | 1.2/0/0 | 10 | 10×3 | 60 | 3 | Y | 0.30 | – | Bullet_Line_Sniper |
| 5 | flamethrower | Flamethrower | Human | 4200 | 2 | 20 | 0/0/0 | 0 | 100×3 | 50 | 0 | Y | 0.05 | 60 / 0.7 | Bullet_Proj_Frames |
| 6 | rocket | Rocket Launcher | Human | 0 | 112 | 1120 | 1/1/1 | 20 | 3×3 | 70 | 4 | N | 0.50 | 120 / 0.9 | Bullet_Proj_Basic |
| 6 | icannon | Ion Cannon | Human | 1800 | 65 | 650 | 1/1/1 | 25 | 6×3 | 90 | 3 | N | 0.70 | 120 / 0.8 | Bullet_Line_Sniper |
| 6 | sticklaunch | Grenade Launcher | Alien | 2600 | 40 | 400 | 0/0/0 | 15 | 8×3 | 60 | 3 | N | 0.30 | 100 / 0.7 | Bullet_Proj_Stick |
| 6 | hrocket | Ice Hunter | Human | 3200 | 45 | 450 | 1/1/1 | 20 | 5×3 | 70 | 4 | Y | 0.30 | 120 / 0.6 | Bullet_Proj_Follow |
| 6 | spitter | Acid Hound | Alien | 5000 | 30 | 300 | 0/0/0 | 15 | 24×2 | 60 | 6 | Y | 0.20 | 100 / 0.4 | Bullet_Proj_Basic |
| 6 | creditsgun | Credit Cannon | "Unknoen"[sic] | 6300 | 30 | 300 | 1.2/1.2/1.2 | 30 | 1×1 | 55 | 2 | Y | 0.20 | 60 / 0.5 | Bullet_Line_Sniper |
| 6 | hrocket2 | Frozen Death | Human | **-1** (unlisted) | 30 | 300 | 1/1/1 | 20 | 14×6 | 75 | 6 | Y | 0.20 | 120 / 0.6 | Bullet_Proj_Follow |

Full field-by-field detail (offsets, effect symbols, sounds, params) for every gun above is in `raze-ts/src/assets/raze2/weapons.json` (verified byte-identical to the decoded `Stats_Guns.as`); the table below pulls out the columns the JSON doesn't make obvious.

## 4. Art symbols, sounds, tracer color, special perk, arm rig

| Id | Pickup/HUD sprite | Arm rig (idle/fire/reload) | Fire sound (class → mp3) | Hit/explode sound | Tracer/1st color | Special perk |
|---|---|---|---|---|---|---|
| pistol | `pistol` | pistol | S_pistolFire → `2133_S_pistolFire.mp3` | – (effect `gas_small`, no explode sound) | 0xFFFFC4 | Crotchshot+ |
| plaspistol | `plasmapistol` | pistol | S_plasmaFire → `2121_S_plasmaFire.mp3` | – | n/a (`Bullet_Proj_Follow`, homing plasma bolt) | Homing |
| burster | `burster` | pistol | S_pistolFire | – | n/a (`params:null`) | Multi-Shot (extraShots:1) |
| mauser | `mauser` | pistol | S_pistolFire | – | 0xFFFF00 | Credits+ (extra.mauser) |
| uzi | `uzi` | pistol | S_uziFire → `2144_S_uziFire.mp3` | – | 0xFFFFC4 | None |
| magnum | `magnum` | pistol | S_sniperFire → `2142_S_sniperFire.mp3` | – | 0xFFFFC4 | Headshot++ |
| sparkgun | `sparkgun` | pistol | S_plasmaFire | – | n/a (proj `ember`) | Fire+ (extra.setFire:1) |
| blaster | `blaster` | pistol | S_plasmaFire | – | n/a (proj `photon_shot`) | Multi-Shot (extraShots:2) |
| blood | `blood` | pistol | S_plasmaFire | – | n/a (proj `blood_shot`) | Lifesteal (extra.useHp/stealHp) |
| shotgun | `shotgun` | shotgun | S_shotgunFire → `2140_S_shotgunFire.mp3` | – | 0xFFFFC4 | Multi-Shot (extraShots:4, 5 pellets) |
| pshotgun | `pshotgun` | shotgun | S_laserBig → `2131_S_laserBig.mp3` | – | 0x9999FF | Multi-Shot (extraShots:2) |
| zapper | `zapper` | rifle | S_Zapper → `2145_S_Zapper.mp3` | – | n/a (`Bullet_Line_Zapper`, `params:[]`) | Laser (extra.soundFrames:9 throttles fire-sound spam) |
| tshotgun | `tshotgun` | shotgun | S_shotgunFire | – | 0xFFCC66 | Multi-Shot (extraShots:3) |
| pcanon | `pcanon` | shotgun | S_shotgunFire | – | n/a (proj `ember`, bounces) | Fire/Multi (extraShots:4, setFire:0.5) |
| arifle | `arifle` | rifle | S_assaultFire → `2120_S_assaultFire.mp3` | – | 0xFFFFC4 | None |
| alienrifle | `bubrifle` | rifle | S_plasmaFire | – | n/a (proj `bubble_shot`, homing) | Homing |
| laserrifle | `laserrifle` | rifle | S_assaultFire | – | 0x69E058 | Critical++ (huge H/C/B mults) |
| icegun | `icegun` | rocket | S_plasmaFire | – | n/a (proj `snow_fall`, bounces) | Bounce |
| arifl2 | `arifle2` | rifle | S_plasmaFire | – | n/a (proj `ember`, follow+bounceShots:3) | Bounce/Fire (setFire:0.5) |
| sniper | `sniper` | sniper | S_sniperFire | – | 0xCCCCCC | Headshot+ |
| railgun | `railgun` | sniper | S_alienSniper → `2118_S_alienSniper.mp3` | – | 0xDB0202 | Pierces (extra.pierce, `Bullet_Line_Effect`) |
| asniper | `asniper` | sniper | S_alienSniper | – | n/a (proj `plasma_shot`, splash) | Splash |
| sniper2 | `sniper2` | sniper | S_sniperFire | – | 0xFFCC00 | Fire (setFire:0.5) |
| railgun2 | `railgun2` | sniper | S_alienSniper | – | 0x00CCFF | Arcs (extra.arc:400, `Bullet_Line_Electric`, hits through walls) |
| chaingun | `chaingun` | heavy | S_plasmaFire | – | 0xDB0202 | Huge Clip (extra.useAmmo:0.5 → half ammo drain/shot) |
| sawgun | `sawgun` | heavy | S_ripperFire → `2126_S_ripperFire.mp3` | – | n/a (proj `saw_shot`, burrows) | Burrows (extra.burrow, doubles dmg) |
| beamer | `beamer` | rocket | S_Laser → `2132_S_Laser.mp3` | – | 0x66CC00 | Laser (continuous beam, extra.soundFrames:16) |
| destroyer | `destroyer` | heavy | S_laserBig | – | 0xDB0202 | None |
| flamethrower | `flamethrower` | heavy | S_Fire → `2135_S_Fire.mp3` | – | n/a (proj `flame`, frames-based) | Fire++ (setFire:3, soundFrames:16) |
| rocket | `rocket` | rocket | S_rocketFire → `35_S_rocketFire.mp3` | S_rocketExplode → `2125_S_rocketExplode.mp3` | n/a (proj `gas_small`) | None |
| icannon | `icannon` | rocket | S_laserBig | S_rocketExplode | 0xFFCC00 | Fire (setFire:0.5) |
| sticklaunch | `stickylauncher` | rifle | S_ripperFire | S_rocketExplode | n/a (proj `chain_fire`, sticks+fuse) | Sticky |
| hrocket | `hrocket` | rocket | S_rocketFire | S_rocketExplode | n/a (proj `gas_sblue`, homing) | Homing |
| spitter | `spitter` | heavy | S_laserBig | S_rocketExplode | n/a (proj `gas_med`) | None |
| creditsgun | `creditsgun` | rifle | S_laserBig | – | 0x666600-ish (0x6699) | Credit Drain (extra.useCredits:4, no ammo use) |
| hrocket2 | `hrocket2` | rocket | S_rocketFire | S_rocketExplode | n/a (proj `gas_sblue`, homing) | Homing |

Type-7 pseudo-weapons (not player-selectable, no slot): `env` (no-op environment damage source), `fire` (burn DoT tick, dmg 1), `sword`/Katana (`S_Whip` → `41_S_Whip.mp3`, `Bullet_Melee_Basic`, dmg 75, range 7, force 15 — this is the melee/ability weapon, not shop-purchasable), `grenade` (thrown-ability grenade, dmg 45, splash 79/0.7, `Bullet_Proj_Bounce`, hit sound `S_rocketExplode`), `mine` (Land Mine ability, dmg 55, `Bullet_Proj_Mine`, params:[30] = 30-frame arm/lifetime), `bouncer` (the Assault Bouncer's ember sub-munition, dmg 10, spawned by `arifl2`'s hit, not directly fired).

## 5. Ammo / clip economy edge cases (`Guns.as`)

- Ammo total = `clipSize * clipMax`, except:
  - `extra.useAmmo` (chaingun: 0.5) — ammo drains at that fraction per shot instead of 1 (`Guns.as:424`).
  - `extra.useCredits` (Credit Cannon: 4) — drains `SD.credits` instead of ammo; if credits are insufficient the gun dry-fires (`S_GunClick`) and does not shoot (`Guns.as:346-350,418-421`).
  - `extra.useHp` (Vamp Charger) — costs unit HP per shot via `unit.status.damage(...)`, in addition to normal ammo use (`Guns.as:369-371`).
  - Very large `clipSize` (≥ ~70, e.g. zapper 100, beamer 70, chaingun 100, icegun 100, flamethrower 100, spitter 24 is the exception) act as a single big reserve rather than magazine+spares in practice; the port formalizes this as `oneClip` for `clipSize >= 60` (`weapons.ts:281`).
  - `MatchSettings.specialMode === "Infinite Clips"` skips clip decrement on reload (`Guns.as:183-186`); `"Infinite Ammo"` skips ammo decrement on shot (`Guns.as:416`).
  - `unit.equips.ammo` (Extra Clips equip) forces `addClip` to always grant 999 spare clips (`Guns.as:130-135`).
- Reload is automatic (`checkReload`, `Guns.as:465-487`) when the current clip hits 0 and spares remain; `manualReload()` (R key) tops off early. Reload duration is **not** stored in `Stats_Guns` — it is driven entirely by the `frameReload` arm animation's own timeline (`_reload` label), so exact reload time-in-seconds is an animation-authored value, not a data field. (The port instead hardcodes a flat `RELOAD_FRAMES = 40` for all weapons — see §6.)

## 6. Weapon-set / "weaponsUsed" groups

`MatchSettings.weaponsUsed` (`MatchSettings.as:101`, default `"All"`, `:176`) is a **match-settings string**, consumed in `Guns.as:78-93`:

```as3
var _loc2_:Array = ["All","Starters","Sidearms","Close Range","Automatics","Long Range","Heavies","Explosives"];
var _loc3_:int = _loc2_.indexOf(MatchSettings.weaponsUsed) - 1;
if (_loc3_ == -1) _loc3_ = 0;
addClip(_loc3_, 999);
changeGun(_loc3_);
```

**This is not an availability filter** — every unit still owns one gun per type-slot 0–6 regardless of setting. `weaponsUsed` only picks which type-slot (0–6) the unit **starts the match holding**, by name:

| `weaponsUsed` string | Resolves to slot (type) | Slot's category |
|---|---:|---|
| "All" (or unmatched) | 0 | Pistols (type 0) |
| "Starters" | 0 | Pistols |
| "Sidearms" | 1 | Uzi/Magnum-tier (type 1) |
| "Close Range" | 2 | Shotguns (type 2) |
| "Automatics" | 3 | Rifles (type 3) |
| "Long Range" | 4 | Snipers (type 4) |
| "Heavies" | 5 | Heavy (type 5) |
| "Explosives" | 6 | Rocket/explosive (type 6) |

`unit.matchInfo.extra.startWeap`, when present (campaign scripting), overrides this slot index directly (`Guns.as:89-92`). `unit.matchInfo.extra.noAmmo` additionally zeroes that slot's clip/ammo on spawn (`Guns.as:95-105`).

The actual per-type gun catalog (which ids exist in each type/slot) is fixed by `addGun`'s first argument and enumerated at runtime by `Stats_Armory.Init()` (`Stats_Armory.as:18-45`) into `gunsAr[type]` (all guns) and `gunsArmoryAr[type]` (only `cost >= 0`, i.e. shop-purchasable — this is what excludes the secret `hrocket2`, `cost:-1`, from the armory/shop UI while still letting it exist as a `Stats_Guns` entry reachable via campaign/debug scripting). A player's/bot's actual 7 owned guns are their per-type index picks, stored in `SD.gunList` / `bots[i].weapons` (`MatchSettings.as:234`, `:300` `getRandGuns()`).

## 7. Raze 1 holdovers vs genuine Raze 2 guns

Raze 1's arsenal (`decompiled_swf/raze 1/scripts/SideShooterSWF_fla/Weapon_*`) is exactly: Pistol, Assault Rifle, Chain Gun, Glove (melee), Grenader, Plasma Rifle, Plasma Uzi, Rail Gun, Rocket, Shotgun, Sniper — 10 silhouettes. In Raze 2's `Stats_Guns`, the **base-tier, zero-cost, Human-race gun in each type slot is the direct Raze‑1 holdover**, re-skinned/re-tuned into the new stat table:

| Raze 1 weapon | Raze 2 holdover id | Notes |
|---|---|---|
| Pistol | `pistol` (M9 Barret) | type 0 base |
| Plasma Uzi | `uzi` | type 1 base (now ballistic "Uzi", not plasma-named, but shares the burst/spray identity) |
| Shotgun | `shotgun` | type 2 base |
| Assault Rifle | `arifle` | type 3 base |
| Sniper | `sniper` (.50 Cal Sniper) | type 4 base |
| Chain Gun | `chaingun` (Laser Minigun) | type 5 base |
| Rocket | `rocket` (Rocket Launcher) | type 6 base |
| Rail Gun | `railgun` | present in Raze 1 art but costed (1300) in Raze 2, i.e. an unlock, not the free starter — still the same weapon concept carried over |
| Grenader | `grenade`, `sticklaunch` (Grenade Launcher) | ability-thrown grenade is the type-7 pseudo-weapon; the type-6 `sticklaunch` is the shop gun version |
| Glove | `sword` (Katana) | melee holdover, reskinned as a blade; type-7 ability weapon, not shop-purchasable |

Every other id — **26 of the 36 real guns** — is a genuine Raze 2 addition: `plaspistol`, `burster`, `mauser`, `magnum`, `sparkgun`, `blaster`, `blood`, `pshotgun`, `zapper`, `tshotgun`, `pcanon`, `alienrifle`, `laserrifle`, `icegun`, `arifl2`, `asniper`, `sniper2`, `railgun2`, `sawgun`, `beamer`, `destroyer`, `flamethrower`, `icannon`, `hrocket`, `spitter`, `creditsgun`, `hrocket2`. These are the alien-race / credit-shop unlocks that give Raze 2 its "buy an upgrade in every category" economy, absent from Raze 1.

## Port status

**Correct**
- `raze-ts/src/assets/raze2/weapons.json` — byte-for-byte accurate extraction of all 42 `Stats_Guns` records (36 real + 6 type-7), independently re-verified against the decoded `Stats_Guns.as` in this doc field-by-field (id, sprite, name, race, cost, dmg, mults, force, splash, splashMult, clipSize, clipMax, range, recoil, autoFire, shootDelay, offsets, effect keys, frame labels, sound class names, bullet class, params, extra, special, desc).
- `raze-ts/src/game/weapons.ts` — correctly documents its own damage ×10 rescale, correctly derives `rayType`/`piercing`/`multiShot`/projectile-motion from the Raze 2 `cls`+`extra`+`params` fields for every non-native gun (`raze2ToDef`, `weapons.ts:267-319`), correctly reproduces the locational `mults` as `headMult/crotchMult/buttMult`, and correctly treats large clip sizes as `oneClip` reserves.
- The 10 "native" hand-tuned guns (`pistol, sniper, railgun, rifle, uzi, plasma, shotgun, grenade, chaingun, rocket`) map onto the 10 Raze‑1‑holdover weapon identities identified in §7 (with `plasma` standing in for the `zapper`/energy-weapon niche and `uzi` given `rayType:"projectile"` rather than the source's `Bullet_Line_Bend` hitscan-with-bend — a deliberate reinterpretation, not a data error).

**Wrong / incomplete**
- **Weapon-set restriction misdocumented as a filter** if read casually: `MatchSettings.weaponsUsed` is a *starting-slot selector*, not an availability restriction (§6). No inspection of the port found any consumer of an equivalent "weaponsUsed" match setting — confirm this is intentionally out of scope before porting match-settings UI.
- **Reload time is not a data field** in Raze 2 (driven by animation length per `frameReload`); the port hardcodes a single flat `RELOAD_FRAMES = 40` (`Guns.ts:49`) for every weapon regardless of source silhouette (pistol vs rocket vs minigun would authentically differ). This is a known simplification, not a bug, but doc-worthy since a later balance pass may want per-weapon reload frames.
- **Fire/reload sound tables only cover the 10 native guns** (`Guns.ts:11-31` `FIRE_SOUND`/`RELOAD_SOUND`/`RELOAD_END_SOUND`); all 26 generated (non-native) guns have no fire/reload sound wired up at all — `Guns.ts`'s `tryShoot()` looks up `FIRE_SOUND[this.curGun.id]` and just silently plays nothing if absent. Table in §4 above gives the correct `S_*` sound class → mp3 filename for every gun to fill this gap.
- **Muzzle-flash color / tracer color is hand-authored per native gun** in `weapons.ts` (`muzzleColor` field) rather than derived from the source `params[]` tracer-line colors documented in §4; the 26 generated guns get no `muzzleColor` at all (falls back to a default in `Guns.ts:299`, `gun.muzzleColor ?? 0xffd86b`), so none of the alien/upgrade guns' distinct tracer colors (plasma purple, laser green, rail red, etc.) currently show up in the port's muzzle flash.
- **No shop/armory/cost system found in the port.** `cost`, `race`, `special`, and `desc` fields exist in `weapons.json` but are not consumed anywhere in `weapons.ts`/`Guns.ts` — there is no loadout-purchase, credits-shop, or per-type "armory list" (`Stats_Armory.gunsArmoryAr`) equivalent yet. Per the comment at `weapons.ts:204-211`, this is deliberate/deferred to a later "economy phase," and the 26 generated guns are consequently reachable only via pickups/sandbox, not the normal spawn loadout (`RAZE2_GUN_IDS` is tracked but excluded from `GUN_ORDER`).
- **Type-7 pseudo-weapons are only partially represented**: `grenade`, `sword`(as a to-be-confirmed ability) and `rocket`-style splash exist as native port guns, but `fire` (burn DoT), `mine` (Land Mine), `env`, and `bouncer` (Assault Bouncer sub-munition) have no confirmed equivalent found in the port's ability/status system — flag for the abilities doc, not necessarily a weapons-doc gap, but the `Bullet_Proj_Mine`/`Bullet_Proj_Bounce` classes they use are shared with real guns (`sticklaunch`, `pcanon`, `icegun`, `arifl2`) so their simulation code is at least partly exercised.
- **`hrocket2` (Frozen Death, cost -1)** is a debug/secret gun excluded from the shop by design (`Stats_Armory.as:39-41` only lists `cost >= 0`); the port's `weapons.json` correctly preserves `cost: -1`, but since there's no shop system yet this distinction currently has no effect either way — worth remembering once the economy phase lands so this gun isn't accidentally made purchasable.
