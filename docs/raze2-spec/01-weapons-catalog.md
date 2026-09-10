# Weapons Catalog

## 1. Summary

Raze 2 has **42 weapon-catalog entries**: 36 purchasable guns spread across 7 armory
"slots" (type `0`–`6`, one owned gun per slot per unit) plus 6 non-purchasable
type-`7` utility/consumable weapons (environment damage, fire DoT, the melee
Katana, the thrown Grenade, the Land Mine, and the Assault Bouncer's sub-munition).
Every entry is a single `Stats_Guns.addGun(...)` call built at boot by
`Stats_Guns.Init()`. A gun's stats drive damage/rate/spread/reload directly; its
*visual + physics* behaviour (homing, bounce, pierce, arc, burrow, flame, mine,
beam) is delegated to a `Bullet_*` class reference (`cls` field) — those bullet
classes are the domain of **doc 02** and are only named/cross-referenced here,
not re-documented.

## 2. Raze 2 source of truth

- **`Stats_Guns.as`** (package-level singleton) — the entire catalog.
  - Field list: `id, sprite, name, race, cost, dmg, mults[head,crotch,butt], force, splash, splashMult, clipSize, clipMax, range, recoil, autoFire, shootDelay, xOff, yOff, effShoot, effHit, effShell, frameIdle, frameFire, frameReload, shotSound, hitSound, cls, params[], extra{}, special, desc` (class fields: `Stats_Guns.as:35–99`).
  - `addGun(...)` signature (32 positional params, in call order — `type,id,sprite,name,race,cost,dmg,mults,force,splash,splashMult,clipSize,clipMax,range,recoil,autoFire,shootDelay,xOff,yOff,effShoot,effHit,effShell,frameIdle,frameFire,frameReload,shotSound,hitSound,cls,params,extra,special,desc`): `Stats_Guns.as:756–802`.
  - `Init()` builds `gunAr`/`gunOb` from 42 `addGun()` calls: `Stats_Guns.as:106–754`. The file is AVM2-obfuscated for roughly two-thirds of the entries (stack-shuffled `§§push`/`§§pop` sequences wrapped in dead `if(false){return}` guards); push order equals the original argument order 1:1, so the values below were reconstructed by reading each block's push sequence top-to-bottom. Verified against the already-fully-literal calls (`pistol`, `mauser`, `sparkgun`, `shotgun`, `tshotgun`, `sniper`, `railgun`, `asniper`, `rocket`, `hrocket`, `spitter`, `hrocket2`, `env`, `fire`, `sword`) which match the pattern exactly.
  - Weapon category names + slot indices (used by `weaponsUsed` match-setting restriction): `["All","Starters","Sidearms","Close Range","Automatics","Long Range","Heavies","Explosives"]` — `Guns.as:78`, index `−1` maps to `type` 0–6 (`Guns.as:79`).
  - `Stats_Guns.Init()` also sums all `cost > 0` entries and traces the armory total: `Stats_Guns.as:743–753`.
- **Already-extracted catalog (authoritative, machine-readable):** `raze-ts/src/assets/raze2/weapons.json` — a 1:1 field-for-field extraction of all 42 `addGun()` calls (0-indexed array, same order as `Init()`). This file is treated as ground truth below rather than re-transcribing every literal.
- Colors in `params[]` arrays are decimal `0xRRGGBB` (e.g. `16777156` = `0xFFFFC4`).
- `range`/`splash`/`xOff` are in Raze 2's native ~30px-per-unit-figure world scale (Box2D twips → world, see doc 02); `shootDelay` is in **seconds**; frame-based systems (`FIRE_DELAY`, port) run at 30fps.

## 3. Current port state

- **Source-of-truth mirror:** `raze-ts/src/assets/raze2/weapons.json` (42 entries, verbatim `Stats_Guns` fields) + `raze-ts/src/assets/raze2/index.ts` (typed loader, exports `RAZE2_WEAPONS: Raze2Weapon[]`).
- **Port weapon table:** `raze-ts/src/game/weapons.ts`.
  - **10 "native" hand-tuned weapons** (`WEAPONS` object literal, `weapons.ts:192–283`): `pistol, sniper, railgun, rifle, uzi, plasma, shotgun, grenade, chaingun, rocket`. These are Raze-1-holdover defs with matched Raze 2 art/sound (`NATIVE_WIRING`, `weapons.ts:289–316`) but **hand-tuned numeric stats balanced against a ~1000 HP base**, not machine-derived from `Stats_Guns`. Of the 10, only 7 share an exact `id` with a `Stats_Guns` entry (`pistol, sniper, railgun, uzi, shotgun, chaingun, rocket`); `rifle` is an explicit alias for Raze 2's `arifle` (`ALIAS_SKIP`, `weapons.ts:330`); **`plasma` and `grenade` do not correspond to any single Raze 2 catalog id** — they are original composite/placeholder weapons (see Gap Analysis).
  - **28 "generated" weapons** (`RAZE2_GUN_IDS` loop, `weapons.ts:546–552`): every remaining Raze 2 gun with `type <= 6` is auto-converted via `raze2ToDef()` (`weapons.ts:468–543`) from `weapons.json`, using deterministic formulas (below). These are playable via pickups + the sandbox, but are **not** in `GUN_ORDER` (`weapons.ts:592–595`) so they don't yet appear in the default hotkey bar / spawn arsenal — reachable only through `SLOT_GUNS` loadout selection (`weapons.ts:563–571`) or pickups.
  - The 6 type-`7` utility weapons (`env, fire, sword, grenade, mine, bouncer`) are **not represented at all** in `weapons.ts` — no melee (Katana), no player-thrown grenade-as-catalog-item (the port's native `grenade` id is a rocket-launcher-class weapon, not this melee/thrown utility set), no land mine, no standalone environment-damage or fire-DoT gun stub.
- **Conversion formulas** (`raze2ToDef`, `weapons.ts:468–543`):
  - `damage = round(dmg * 10)` — port HP base is ~10× Raze 2's (~1000 vs ~100).
  - `maxRange = round(range * 10)` (melee floors at 70).
  - `recoil = max(2, round(recoil * 2))`.
  - `maxClip = clipSize`; `oneClip = clipSize >= 60` (chaingun/zapper/beamer/flamethrower/icegun-style huge clips become "the reserve IS the clip"); else `maxAmmo = clipSize * clipMax`.
  - `headMult/crotchMult/buttMult` = `mults[0]/[1]/[2]` verbatim (no scaling).
  - `fireDelay = round(shootDelay * 30)` (30fps).
  - `pellets = extra.extraShots + 1` → `multiShot`, and forces `rayType = "spread"`.
  - `piercing` = true for `Bullet_Line_Effect` / `Bullet_Line_Electric` / `extra.pierce`.
  - Tracer look derived from `cls` → `TracerStyle` (`CLS_TRACER`, `weapons.ts:350–354`) and the `params[]` colour/width layers (`tracerFromParams`, `weapons.ts:367–392`).
  - Projectile motion/behaviour per `cls` (`projMotion`/`projBehavior`, `weapons.ts:395–443`): homing only wired when `params[3]` and `params[4]` are both numeric (flags `alienrifle` and `arifl2` as **latent no-ops** in the original — their "Homing"/"Bounce" specials never actually engage because those two entries carry no seek-radius/turn-rate params).
- **Fire control / damage application:** `raze-ts/src/game/Guns.ts` — `FIRE_DELAY` overrides `def.fireDelay` for the 10 natives only (`Guns.ts:40–43`); `doHitUnit` (`Guns.ts:562–626`) applies `headMult/crotchMult/buttMult` by hit region, `setFire`, `arc`-chain (railgun2), and `percAmmo`.

## 4. Gap analysis

| # | Raze 2 target | Port today | Severity |
|---|---|---|---|
| 1 | 36 purchasable guns, all in `GUN_ORDER`/armory rotation | Only the 10 natives are in `GUN_ORDER` (`weapons.ts:592–595`); the 28 generated guns exist as data but are outside the default hotkey bar / spawn loadout unless picked via `SLOT_GUNS`/pickup | Medium — data exists, UX wiring incomplete |
| 2 | `plasma` (port native) traces to a real `Stats_Guns` entry | No 1:1 source; closest analogues are `zapper` (`dmg 3.5, splash 0, clipSize 100, autoFire, Bullet_Line_Zapper`) or `beamer` (`dmg 3, clipSize 70, Bullet_Line_Laser`) — port's `plasma` (`dmg 80, maxRange 190, oneClip@400, piercing`) matches neither numerically | High — this native weapon is an invented hybrid, not a port of anything |
| 3 | `grenade` (port native) traces to a real `Stats_Guns` entry | No 1:1 source; the only Raze 2 entries literally named "grenade"/"Grenade Launcher" are the type-7 utility `grenade` (`Bullet_Proj_Bounce`, dmg 45, no ammo/clip — a thrown consumable) and `sticklaunch`/"Grenade Launcher" (`Bullet_Proj_Stick`, dmg 40, sticky fuse). Port's native `grenade` (`dmg 800, maxRange 700, Bullet_Proj_NadeLauncher` art) is closer in spirit to `sticklaunch` but isn't sticky and isn't generated from it | High |
| 4 | `rocket` (port native) numeric fidelity | Raze 2 `rocket`: `dmg 112 → ×10 = 1120`, `range 70 → ×10 = 700`, `splashMult 0.9`. Port native `rocket`: `damage 1500, maxRange 900, splashMult 0.7` (`weapons.ts:274–282`) — hand-tuned, diverges from the generator's own ×10/×10 formula it uses for every other gun | Low (documented as intentional balance, but worth flagging as a numeric mismatch) |
| 5 | `chaingun` numeric fidelity | Raze 2 `chaingun`: `dmg 3.5 → ×10=35`, `clipSize 100 (oneClip), extra.useAmmo:0.5` (ammo drains at half rate). Port native `chaingun`: `damage 30, maxClip 400, curAmmo 0, maxAmmo 0` — clip size and damage both diverge from formula, and `useAmmo`/`percAmmo` half-rate drain is not represented at all (`percAmmo` isn't set on the native chaingun) | Medium |
| 6 | Type-7 utility weapons: `env` (0-dmg placeholder), `fire` (DoT tick, dmg 1), `sword`/"Katana" (melee, dmg 75, range 7, `Bullet_Melee_Basic`, `S_Whip`), `grenade` (thrown, dmg 45, splash 79/0.7), `mine`/"Land Mine" (dmg 55, splash 79/0.7, `Bullet_Proj_Mine` param `[30]` = 30-tick arm/life), `bouncer` (Assault Bouncer sub-munition, dmg 10, `setFire:0.5`) | None exist in `weapons.ts`/`WEAPONS` — no melee weapon at all in the port, no standalone mine/thrown-grenade/fire-tick/environment-damage catalog entries | High — melee and mine are entirely missing mechanics, not just missing data rows |
| 7 | `alienrifle` "Homing" special and `arifl2` "Bounce/Fire" special function in-fiction | Port's own code comments (`weapons.ts:426–429`) document that in the *original* AS3 these are latent no-ops (params arrays lack seek-radius/turn params) and the port **faithfully reproduces the bug** (no homing wired for either) | None — documented parity, not a gap |
| 8 | 4 human/alien race pairs per slot for cosmetic race-lock reference (`race: "Human"/"Alien"/"Unknown"/"Unknoen"`) | `raze2ToDef` drops `race` entirely — not surfaced anywhere in `WeaponDef` | Low — cosmetic/unlock-gating data, not yet needed |
| 9 | `hrocket2`/"Frozen Death" has `cost: -1` (likely an unlock-only/non-purchasable weapon, e.g. achievement reward) | Generated normally like any purchasable gun; the `cost === -1` semantic is not interpreted anywhere in the port (cost/economy is out of this doc's scope — see doc 11) | Low — flag for doc 11 |
| 10 | `useCredits` extra (creditsgun/"Credit Cannon" drains credits instead of ammo) | `extraBehavior()` (`weapons.ts:446–454`) does not read `extra.useCredits` — the generated `creditsgun` gets a normal ammo pool instead of draining the credits economy | Medium |
| 11 | `useHp`/`stealHp` extras (`blood`/"Vamp Charger": ammo costs HP, hits heal the wielder) | Not read by `extraBehavior()` — generated `blood` gun has a normal ammo pool and no lifesteal-on-hit | Medium |
| 12 | `mauser` extra `{"mauser":true}` (bonus credits on kill) | `mauser` is a native id with hand-tuned stats; the credit-bonus-on-kill special is not wired in either path | Low |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Add the 28 generated guns to a full `GUN_ORDER`/armory-slot rotation so they're reachable via hotkeys and default spawn loadouts, not just pickups (`weapons.ts:592–595`, `Guns.ts` `gunOrder`).
2. Decide whether `plasma` and `grenade` (port natives) should be **replaced** by proper generated ports of specific `Stats_Guns` ids (candidates: `plasma`→`zapper` or a new dedicated conversion; `grenade`→`sticklaunch`, keeping the thrown type-7 `grenade` as a separate "Grenade" ability/consumable item, distinct from the Grenade Launcher gun) or **kept** as intentional non-canonical variants and clearly labelled as such.
3. Reconcile `rocket`/`chaingun` native stats against the `×10` damage / `×10` range / clip-size formulas the generator uses for every other weapon, or document the departure as deliberate balance (update the code comment at `weapons.ts:274` / `weapons.ts:265` to state the departure explicitly either way).
4. Implement the 6 type-7 utility weapons as their own catalog entries / subsystems:
   - `sword` (Katana): melee swing, `Bullet_Melee_Basic` (doc 02), range 7 (world units), dmg 75, `S_Whip` sound — likely an ability-slot or pickup melee weapon, not a gun-slot weapon.
   - `mine` (Land Mine): `Bullet_Proj_Mine` with a 30-tick arm timer, dmg 55, splash 79/0.7 — cross-ref doc 14 (equipment/abilities) since Raze 2 mines are typically an equipment-slot deployable, not a purchased gun.
   - `grenade` (thrown, type-7): `Bullet_Proj_Bounce`, dmg 45, splash 79/0.7 — likely also an equipment/ability throwable, separate from the `sticklaunch` gun.
   - `fire`/`env`: verify whether these are ever independently "equipped" or are purely internal damage-source markers (`Status.doDamage` attacker stand-ins) before building UI/pickup support — may not need a `WeaponDef` at all.
   - `bouncer` (Assault Bouncer sub-munition): confirm this is only ever spawned by `arifl2`'s hit effect (never player-selectable) before deciding whether it needs a `WeaponDef`.
5. Wire the unread `extra` flags into `extraBehavior()`/`doHitUnit`: `useCredits` (creditsgun drains `SD`/player credits per shot instead of ammo), `useHp`/`stealHp` (blood gun costs HP per shot, heals wielder per hit), `mauser` (bonus credits on kill).
6. Surface `race` on `WeaponDef` (even if unused today) so future unlock/cosmetic-gating work (doc 11) doesn't have to re-derive it from `weapons.json` separately.
7. Decide the `cost: -1` (`hrocket2`) semantic (likely "not purchasable, reward-only") and gate it in the armory (doc 11), not here.
8. Re-verify the obfuscated-block hand-reconstruction in this doc's data (§2) against `weapons.json` field-by-field before building anything off numbers quoted directly in prose — treat `weapons.json` as the executable source of truth, this doc as the narrative index.

## 6. Full weapon table

All damage/range/recoil figures below are the **raw Raze 2 values** from `weapons.json`
(= `Stats_Guns`), not the port's ×10-scaled numbers. `mults` = `[head, crotch, butt]`
locational crit multipliers. `Port` column: **N**ative hand-tuned, **G**enerated
(`raze2ToDef`), or **✗** missing entirely. Bullet class full mechanics are doc 02.

### Slot 0 — Starters (Sidearms, pistols)

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `pistol` | M9 Barret | Human | 0 | 12 | 1.2/2/1.2 | 3 | 18/10 | 60 | 5 | no | 0.25 | `Bullet_Line_Basic` | Crotchshot+ | **N** (id match) |
| `plaspistol` | Plasma Pistol | Alien | 850 | 10 | 1.2/1/1 | 3 | 14/10 | 45 | 5 | yes | 0.2 | `Bullet_Proj_Follow` (homing, seek 200px, turn 7) | Homing | **G** |
| `burster` | Ripper | Human | 850 | 4 | 1.2/1.2/1.2 | 3 | 18/10 | 30 | 5 | yes | 0.15 | `Bullet_Line_Basic` | Multi-Shot (`extraShots:1` → 2 bullets) | **G** |
| `mauser` | Golden Mauser | Human | 600 | 9 | 1.2/1.2/1.2 | 1 | 12/10 | 45 | 5 | no | 0.25 | `Bullet_Line_Sniper` | Credits+ (`extra.mauser:true`) | **N** (id match, credit-bonus special not wired) |

### Slot 1 — Sidearms (heavy pistols/SMG)

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `uzi` | Uzi | Human | 0 | 12 | 1.5/1.2/1.2 | 5 | 28/3 | 38 | 9 | yes | 0.15 | `Bullet_Line_Bend` | None | **N** (id match) |
| `magnum` | Magnum | Human | 900 | 25 | 2.5/1.2/1.2 | 10 | 6/3 | 60 | 2 | no | 0.4 | `Bullet_Line_Basic` | Headshot++ | **G** |
| `sparkgun` | Burst Torch | Alien | 1300 | 10 | 1.2/1.2/1.2 | 7 | 10/3 | 70 | 3 | no | 0.25 | `Bullet_Proj_Basic` | Fire+ (`setFire:1`); splash 60/0.1 | **G** |
| `blaster` | Photon Blaster | Alien | 1800 | 4 | 1.2/1.2/1.2 | 3 | 18/3 | 50 | 5 | yes | 0.2 | `Bullet_Proj_Basic` | Multi-Shot (`extraShots:2` → 3 shots) | **G** |
| `blood` | Vamp Charger | Unknown | 2600 | 9 | 0/0/0 | 0 | 20/3 | 60 | 6 | no | 0.25 | `Bullet_Proj_Basic` | Lifesteal (`useHp:3` ammo cost, `stealHp`) — **not wired in port** | **G** (lifesteal special unimplemented) |

### Slot 2 — Close Range (shotguns)

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `shotgun` | Shotgun | Human | 0 | 22 | 1.2/1.2/1.2 | 4 | 4/3 | 23 | 10 | no | 0.8 | `Bullet_Line_Basic` | Multi-Shot (`extraShots:4` → 5 pellets) | **N** (id match) |
| `pshotgun` | Plasma Shot | Alien | 900 | 7 | 1.2/1.2/1.2 | 2 | 12/3 | 28 | 6 | yes | 0.2 | `Bullet_Line_Bend` | Multi-Shot (`extraShots:2` → 3) | **G** |
| `zapper` | Zapper | Alien | 1300 | 3.5 | 0/0/0 | 0 | 100/3 (oneClip) | 20 | 0 | yes | 0.05 | `Bullet_Line_Zapper` | Laser — distance falloff up to 2× point-blank | **G** |
| `tshotgun` | Terminator | Human | 1800 | 15 | 1.2/1.2/1.2 | 5 | 5/3 | 43 | 5 | no | 0.7 | `Bullet_Line_Sniper` | Multi-Shot (`extraShots:3` → 4) | **G** |
| `pcanon` | Particle Cannon | Alien | 2600 | 10 | 1.2/1.2/1.2 | 5 | 5/3 | 23 | 9 | no | 0.8 | `Bullet_Proj_Bounce` | Fire/Multi (`extraShots:4`→5, `setFire:0.5`) | **G** |

### Slot 3 — Automatics (rifles)

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `arifle` | Assault Rifle | Human | 0 | 9 | 1.2/1.2/1.2 | 6 | 24/3 | 80 | 4 | yes | 0.15 | `Bullet_Line_Basic` | None | **N** (aliased → port id `rifle`) |
| `alienrifle` | Bubble Blaster | Alien | 900 | 8 | 1/1/1 | 3 | 20/3 | 60 | 7 | yes | 0.15 | `Bullet_Proj_Follow` (params=`"bubble_shot",8` only — **no seek/turn params**) | Homing — **latent no-op in original** | **G** (homing correctly not wired, matching the bug) |
| `laserrifle` | Precision Laser | Alien | 1300 | 7 | 2.7/2.5/2.5 | 6 | 24/3 | 70 | 1 | yes | 0.2 | `Bullet_Line_Basic` | Critical++ (extreme crit mults) | **G** |
| `icegun` | Hail Storm | Human | 1800 | 9.5 | 1.2/1.2/1.2 | 4 | 100/2 (oneClip) | 90 | 2 | yes | 0.2 | `Bullet_Proj_Bounce` | Bounce | **G** |
| `arifl2` | Assault Bouncer | Human | 2600 | 5 | 0/0/0 | 1 | 14/3 | 45 | 5 | yes | 0.2 | `Bullet_Proj_Follow` (params=`"ember",10,1` only — **no seek/turn params**) | Bounce/Fire (`bounceShots:3, setFire:0.5`) — homing is a **latent no-op**; bounce sub-munitions spawn the type-7 `bouncer` weapon | **G** |

### Slot 4 — Long Range (snipers)

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `sniper` | .50 Cal Sniper | Human | 0 | 45 | 2.5/1.2/1.2 | 15 | 4/3 | 300 | 1 | no | 0.6 | `Bullet_Line_Sniper` | Headshot+ | **N** (id match) |
| `railgun` | Railgun | Human | 1300 | 55 | 1.5/1/1 | 15 | 3/3 | 300 | 1 | no | 0.8 | `Bullet_Line_Effect` | Pierces (`extra.pierce:true`) | **N** (id match) |
| `asniper` | Pulsator | Alien | 1800 | 70 | 1.2/1/1 | 15 | 5/3 | 300 | 2 | no | 0.7 | `Bullet_Proj_Basic` | Splash (60/1.0 — full splash mult) | **G** |
| `sniper2` | Holy Grail | Alien | 2600 | 110 | 0/0/0 | 20 | 1/6 | 300 | 0 | no | 2.0 | `Bullet_Line_Sniper` | Fire (`setFire:0.5`) | **G** |
| `railgun2` | Electro Bolt | Alien | 3400 | 45 | 0/0/0 | 1 | 6/3 | 300 | 1 | no | 0.5 | `Bullet_Line_Electric` | Arcs (`extra.arc:400` → chains to 3 enemies through walls at 50% dmg) | **G** — arc-chain implemented in `Guns.ts:536–559` |

### Slot 5 — Heavies

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `chaingun` | Laser Minigun | Human | 0 | 3.5 | 0/0/0 | 1 | 100/2 (oneClip) | 50 | 7 | yes | 0.05 | `Bullet_Line_Basic` | Huge Clip (`extra.useAmmo:0.5` — ammo drains at half rate) | **N** (id match; `useAmmo` half-drain **not wired**) |
| `sawgun` | Shredder | Human | 1300 | 40 | 1.2/1.2/2.5 | 10 | 12/3 | 300 | 6 | no | 0.6 | `Bullet_Proj_Basic` | Burrows (`extra.burrow:true` — burrow doubles damage) | **G** |
| `beamer` | Focus Beam | Alien | 1800 | 3 | 0/0/0 | 2 | 70/3 (oneClip) | 50 | 0 | yes | 0.05 | `Bullet_Line_Laser` | Laser (continuous beam), `soundFrames:16` | **G** |
| `destroyer` | Destroyer | Alien | 2600 | 26 | 1.2/0/0 | 10 | 10/3 | 60 | 3 | yes | 0.3 | `Bullet_Line_Sniper` | None | **G** |
| `flamethrower` | Flamethrower | Human | 4200 | 2 | 0/0/0 | 0 | 100/3 (oneClip) | 50 | 0 | yes | 0.05 | `Bullet_Proj_Frames` | Fire++ (`setFire:3`, splash 60/0.7, `soundFrames:16`) | **G** |

### Slot 6 — Explosives

| id | name | race | cost | dmg | mults H/C/B | force | clip/max | range | recoil | auto | delay(s) | bullet cls | special | port |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `rocket` | Rocket Launcher | Human | 0 | 112 | 1/1/1 | 20 | 3/3 | 70 | 4 | no | 0.5 | `Bullet_Proj_Basic` | None; splash 120/0.9 | **N** (id match, but stats hand-tuned, diverge from ×10 formula) |
| `icannon` | Ion Cannon | Human | 1800 | 65 | 1/1/1 | 25 | 6/3 | 90 | 3 | no | 0.7 | `Bullet_Line_Sniper` | Fire (`setFire:0.5`); splash 120/0.8 | **G** |
| `sticklaunch` | Grenade Launcher | Alien | 2600 | 40 | 0/0/0 | 15 | 8/3 | 60 | 3 | no | 0.3 | `Bullet_Proj_Stick` | Sticky (fuse 1s); splash 100/0.7 | **G** |
| `hrocket` | Ice Hunter | Human | 3200 | 45 | 1/1/1 | 20 | 5/3 | 70 | 4 | yes | 0.3 | `Bullet_Proj_Follow` (seek 180px, turn 7) | Homing; splash 120/0.6 | **G** |
| `spitter` | Acid Hound | Alien | 5000 | 30 | 0/0/0 | 15 | 24/2 | 60 | 6 | yes | 0.2 | `Bullet_Proj_Basic` | None; splash 100/0.4 | **G** |
| `creditsgun` | Credit Cannon | Unknown* | 6300 | 30 | 1.2/1.2/1.2 | 30 | 1/1 | 55 | 2 | yes | 0.2 | `Bullet_Line_Sniper` | Credit Drain (`extra.useCredits:4` — drains credits instead of ammo, **not wired**); splash 60/0.5 | **G** (credit-drain unimplemented — falls back to a normal 1-round ammo pool) |
| `hrocket2` | Frozen Death | Human | **-1** (reward-only?) | 30 | 1/1/1 | 20 | 14/6 | 75 | 6 | yes | 0.2 | `Bullet_Proj_Follow` (seek 180px, turn 8) | Homing; splash 120/0.6 | **G** |

\* `race` field is literally the typo `"Unknoen"` in `Stats_Guns.as:644` / `weapons.json:1540`.

### Slot 7 — Special / non-purchasable (utility weapons)

Not part of the 7 armory gun-slots; spawned internally (environment damage, DoT
ticks, melee, thrown consumables) rather than equipped from a loadout.

| id | name | dmg | force | range | bullet cls | params | extra | port |
|---|---|---|---|---|---|---|---|---|
| `env` | Environment | 0 | 0 | 0 | — | — | — | ✗ missing (likely just an attacker-stand-in for hazard damage, may not need a `WeaponDef`) |
| `fire` | Fire | 1 | 0 | 0 | — | — | — | ✗ missing (per-tick DoT damage source stand-in) |
| `sword` | Katana | 75 | 15 | 7 | `Bullet_Melee_Basic` | — | — | ✗ missing — **no melee weapon exists in the port at all** |
| `grenade` | Grenade | 45 | 15 | 0 | `Bullet_Proj_Bounce` | `["grenade",3,3,2]` | splash 79/0.7 | ✗ missing as a distinct thrown consumable (port's *native* id `grenade` is a different, gun-slot rocket-class weapon — naming collision, see Gap #3) |
| `mine` | Land Mine | 55 | 15 | 0 | `Bullet_Proj_Mine` | `[30]` (30-tick arm/life) | splash 79/0.7 | ✗ missing entirely |
| `bouncer` | Assault Bouncer (sub-munition) | 10 | 1 | 0 | `Bullet_Proj_Bounce` | `["ember",1,5,1]` | `setFire:0.5` | ✗ missing — only ever spawned by `arifl2`'s bounce-shots effect, likely doesn't need standalone `WeaponDef` support |

## 7. Open questions / data still missing

1. **`plasma`/`grenade` native provenance.** No commit/comment in `weapons.ts` explains which (if any) Raze 2 gun these two natives were meant to represent — need a design decision (replace with real generated ports, or keep and relabel as original content) before doc 11 (armory) can reconcile the purchasable roster 1:1 against `Stats_Guns`.
2. **`hrocket2` (`cost: -1`) unlock condition.** Not found in `Stats_Guns.as` itself; likely gated elsewhere (achievement/campaign reward) — needs a search of `Stats_Armory.as`/`Achievements.as` (out of scope for this doc, flag for doc 11 / doc 15).
2b. Note the same for `SLOT_GUNS[2]`/`SLOT_GUNS[6]` port-only additions of `plasma`/`grenade` as "keep reachable" — confirm doc 11 accounts for these as non-Raze-2-canonical slot fillers.
3. **Thrown `grenade` (type 7) vs `sticklaunch` (Grenade Launcher gun) vs equipment-slot grenades (doc 14).** Raze 2 appears to have three separate "grenade" concepts (a gun-fired sticky projectile, a hand-thrown bouncing one, and possibly an ability/equipment throwable) — doc 14 should clarify whether the type-7 `grenade` is actually the ability-slot throwable or something else again.
4. **Mine's `[30]` param semantics** — is `30` frames, ticks, or seconds until armed/live? `Bullet_Proj_Mine` internals are doc 02's job to pin down exactly; flagging here since it affects whether `mine` belongs in doc 06 (map nodes/hazards) instead of/in addition to this catalog.
5. **`useCredits`/`useHp`/`stealHp`/`mauser`-credit-bonus economy hooks** — these all reach into the credits/HP economy (doc 11's domain); this doc only flags that they exist and are unread by `extraBehavior()` today.
