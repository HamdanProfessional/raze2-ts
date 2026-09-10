# Weapon Visuals & FX

## 1. Summary

This doc covers what a weapon *looks like* going off, independent of the physics that
resolve the hit (doc 02) or how a hitscan ray is rendered as a beam/tracer (doc 04). For
every one of Raze 2's 38 guns (10 native/port-tuned + 28 "generated" alien/human
variants across armory type-slots 0–6, plus 6 ability/environment pseudo-weapons in
slot 7) it catalogs: the held-gun sprite id, the muzzle-flash effect key, the
in-flight projectile/tracer look and its exact colour, the ejected-shell behaviour,
and the wall/unit impact effect it spawns. It also catalogs the shared effect
"vocabulary" — the named bitmap-animation keys (`gas_small`, `purple_fire`,
`plasma_shot`, …) the original wires every gun to, the wall-material palette that
picks a secondary splash effect from the pixel colour of what got hit, and the
procedural particle-effect classes (`Fx.ts`) the TS port substitutes for them.

**Key architectural fact:** Raze 2 does *not* draw its projectiles/impacts with
vector `Graphics` calls and hex colours (except the seven `Bullet_Line_*` tracer
classes — see doc 04). Every muzzle flash, projectile trail, shell casing, blood
splash, explosion, etc. is a **pre-rendered bitmap sprite-sheet**, baked at runtime
by `BH.as` from one giant embedded MovieClip (`assets.swf` symbol `1809`) that has a
frame label per effect name (`"gas_small"`, `"purple_fire"`, `"plasma_shot"`, ...),
1–3 baked rotations per label (`rotAmt`), and N frames per rotation. `Effect.as` /
`Particle.as` just blit `BH.getBit(name+rotation, sub, frame)` into `game.bitscreen`
every tick — there is no hex colour to cite for those, only the frame-label *name*
and its behaviour (`spark`, `shell`, `snow`, `raise`, ...). The **only** raw
`0xRRGGBB` colours in the entire weapon-visuals system are the `Bullet_Line_*`
tracer `params` arrays (tracer stroke colours — doc 04) and the projectile *trail*
tint implied by which named bitmap a `Bullet_Proj_*` cites (`ember` = orange fire,
`plasma_shot` = cyan/purple, etc. — inferred, not literal, since the actual bitmap
was never re-rendered for the port). This is called out per-weapon below and is the
single biggest gap between "what Raze 2 shows" and "what we can cite a hex value
for" — see §6.

## 2. Raze 2 source of truth

### 2.1 Files

| File | What it defines |
|---|---|
| `Stats_Guns.as` (`decompiled_swf/raze 2/scripts`) | `Stats_Guns.addGun()` — the full per-gun stat+visual table (38 calls). Fields relevant here: `sprite` (held-gun/HUD icon clip label), `effShoot` (muzzle-flash bitmap key), `effHit` (wall/unit impact bitmap key), `effShell` (shell-casing bitmap key, `""` = no shell), `frameIdle`/`frameFire`/`frameReload` (arm-rig silhouette shared by several guns, e.g. `"pistol"`, `"rifle"`, `"shotgun"`, `"sniper"`, `"heavy"`, `"rocket"`), `cls` (bullet behaviour class, doc 02), `params` (tracer stroke colours for `Bullet_Line_*`, or `[trailBitmapKey, ...motionArgs]` for `Bullet_Proj_*`). |
| `Guns.as` | `Guns.shoot()` L399–406: spawns the ejected-shell particle (`game.createParticle(..., "shell", {rot, flip}, "shell", curGun.effShell)`) only `if (curGun.effShell && SD.graphPart)` — shells are gated by the graphics-quality "particle" setting. `Guns.makeBullet()` L447–463 constructs the bullet object itself. |
| `Bullet.as` (base class) | Constructor L141–144: fires `game.createEffect(ox, oy, stats.effShoot)` once, at the muzzle, the instant the bullet spawns — this **is** the muzzle flash. `doHitEffect()` L147–482: on a unit hit, spawns `hitObject.skin.blood` (per-skin blood bitmap, not per-weapon — see doc 07) or `"bloodShield"` if the target has an active shield; on a wall hit, spawns `stats.effHit` **plus** a wall-material-dependent secondary effect keyed off the wall pixel's hex colour (§2.3); on a corpse hit, `stats.effHit` again. `stats.hitSound` also plays here. |
| `Bullet_Line_Basic.as` | Draws the tracer stroke(s) straight into `game.lineCont.graphics` using `params` as `[dashed, w1, color1, a1, w2, color2, a2, ...]` triples (doc 04). No bitmap effect of its own beyond the shared `effShoot`/`effHit`. |
| `Bullet_Proj_Basic.as` L39/44 | Every tick (twice, for sub-stepping), calls `game.createEffect(x, y, stats.params[0])` — `params[0]` is the trail-bitmap key (`"ember"`, `"plasma_shot"`, `"blood_shot"`, `"saw_shot"`, ...). This *is* the projectile's visible body/trail; there is no separate "bullet sprite" beyond this repeating effect stamp. |
| `Particle.as` | Generic particle actor with 8 `behave` modes (`fairy`, `water`, `snow`, `shell`, `spark`, `leaf`, `raise`, `fish`). `"shell"` (L116–119, L238–247) is what `effShell` drives: launched at `rot - 110*flip + rand(-15,15)`, speed 8, falls under gravity (`ySpd += 1`/tick), removed on ground hit. `"spark"` is the wall-material spark-shower behaviour (case 5/`993300` mud, etc., §2.3). |
| `Effect.as` (`Effect_2.as` in the non-obfuscated pass is the one with real code; `Effect.as` in `sprites`/`scripts` is a thin bitmap-blit wrapper — see file header) | One-shot bitmap animation: plays `frame..stats.frames` of `BH.getBit(name+rotation, sub, frame)` then self-removes. This is what backs `game.createEffect(x, y, name, sub?)` for muzzle flashes, hit effects, and explosions (`gas_big` = rocket explosion, `plasma_explode`, `fexpand` = fire flash, etc.). |
| `BH.as` | Runtime sprite-sheet baker. `getBitAniStats(name, sub)` / `getBit(name, sub, frame)` L179–223 — every effect referenced by `effShoot`/`effHit`/`effShell`/`Bullet_Proj_*` params is a *label on this one embedded clip* (symbol `1809`, `[Embed(source="/_assets/assets.swf", symbol="symbol1809")]`), not a standalone SWF symbol; there is no separate art asset to point FFDec at per effect name — reading the actual pixels requires rendering that embedded clip through each frame label, which was **not done for this pass** (§6). |
| `S_plasmaFire.as`, `S_rocketExplode.as` | Sound-only wrapper classes for `shotSound`/`hitSound` (doc 03 audio is out of scope here — see the port's `SHOT_SOUND` map in `weapons.ts` L333–339). |
| `Pickup_Weapon.as` — **not present** in the decompiled scripts folder under this name; the equivalent floor-pickup logic lives inside `NodePickup.as` (weapon-drop nodes) and the Armory's `Stats_Armory.gunsAr[type]` per-slot pool. The port's `PickupWeapon.ts` header comment citing `Pickup_Weapon.as` is aspirational — that exact class was not found under either name in `decompiled_swf/raze 2/scripts`; treat the class name as the *port's* label for this behaviour, not a confirmed decompile source (§6). |

### 2.2 The 38-gun roster (`Stats_Guns.addGun`, verified against `raze-ts/src/assets/raze2/weapons.json` which is byte-for-byte the decompiled call arguments)

Columns: **slot** (armory type 0–6, matches `SLOT_GUNS` in `weapons.ts`), **id**, **name**, **sprite** (held-gun/HUD clip label — also the arm-rig silhouette unless noted), **cls** (bullet behaviour, doc 02), **effShoot** (muzzle bitmap), **effHit** (impact bitmap), **effShell** (shell bitmap, blank = none), **tracer/trail colour(s)** where the source actually carries a raw `0xRRGGBB` (`Bullet_Line_*` `params`) — for `Bullet_Proj_*` guns the "colour" column instead names the trail bitmap key, whose colour is inferred (not literal, see §1).

**Slot 0 — Sidearms (pistols)**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `pistol` | M9 Barret | `pistol` | Line_Basic | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFFC4` (dashed, w1 3.5 a.3 / w2 1.5 a.6) |
| `plaspistol` | Plasma Pistol | `plasmapistol` | Proj_Follow (homing) | `plasmapistol_hit` | `plasmapistol_hit` | — | trail `plasmapistol_shot` → port tint `[0x00CCFF, 0x9900FF]` |
| `burster` | Ripper | `burster` | Line_Basic | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFFC4` (w1 2.5 a.3 / w2 0.5 a.6); fires 2 bullets (`extraShots:1`) |
| `mauser` | Golden Mauser | `mauser` | Line_Sniper | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFF00` gold (w1 1.5 a.3 / w2 0.5 a.6) |

**Slot 1 — Pistols (autos)**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `uzi` | Uzi | `uzi` | Line_Bend | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFFC4` (w1 1.5 a.3 / w2 0.5 a.6) |
| `magnum` | Magnum | `magnum` | Line_Basic | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFFC4` (w1 5.5 a.3 / w2 1.5 a.8), uses sniper fire sound |
| `sparkgun` | Burst Torch | `sparkgun` | Proj_Basic | `gas_small` | `fexpand` | — | trail `ember` (orange fire); `setFire:1`, splash 60/0.1 |
| `blaster` | Photon Blaster | `blaster` | Proj_Basic | `purple_fire` | `purple_fire` | — | trail `photon_shot` → port tint `[0x9999FF, 0x6666FF]`; `extraShots:2` |
| `blood` | Vamp Charger | `blood` | Proj_Basic | `chain_hit` | `bloodHuman` | — | trail `blood_shot` → port tint `[0xCC0000, 0x880000]`; lifesteal (`useHp`) |

**Slot 2 — Close Range (shotguns)**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `shotgun` | Shotgun | `shotgun` | Line_Basic | `gas_small` | `gas_small` | `shotgun` | tracer `0xFFFFC4` (w1 3.5 a.3 / w2 1.5 a.6); `extraShots:4` (5-pellet spread) |
| `pshotgun` | Plasma Shot | `pshotgun` | Line_Bend | `purple_fire` | `purple_fire` | — | tracer `0x9999FF`→`0xDD6AEA` (w1 5.5 a.3 / w2 2.5 a.7); `extraShots:2` |
| `zapper` | Zapper | `zapper` | Line_Zapper | — | `purple_fire` | — | no `params` — hardcoded in the draw code, port uses `0xCC00FF`/`0x9900FF` (doc 05); range-scaled damage |
| `tshotgun` | Terminator | `tshotgun` | Line_Sniper | `gas_small` | `gas_small` | `shotgun` | tracer `0xFFCC66` (w1 3.5 a.2 / w2 1.5 a.3); `extraShots:3` |
| `pcanon` | Particle Cannon | `pcanon` | Proj_Bounce | `gas_small` | `gas_small` | — | trail `ember`; bounces, `extraShots:4`, `setFire:0.5` |

**Slot 3 — Automatics (rifles)**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `arifle` (native `rifle`) | Assault Rifle | `arifle` | Line_Basic | `gas_small` | `gas_small` | `pistol` | tracer `0xFFFFC4` (w1 3.5 a.3 / w2 1.5 a.6) |
| `alienrifle` | Bubble Blaster | `bubrifle` | Proj_Follow | `plasmapistol_hit` | `plasmapistol_hit` | — | trail `bubble_shot` → port tint `[0x9999FF, 0x6666FF]`; **`params` carries no seek/turn args** — homing perk is a latent no-op in the original (see `weapons.ts` L426–431 comment) |
| `laserrifle` | Precision Laser | `laserrifle` | Line_Basic | `green_shot` | `green_shot` | `pistol` | tracer `0x69E058`→`0xFFFFFF` (w1 3.5 a.4 / w2 1.5 a.9), not dashed; huge crit mults `[2.7,2.5,2.5]` |
| `icegun` | Hail Storm | `icegun` | Proj_Bounce | `snow_splash` | `snow_splash` | — | trail `snow_fall` → port tint `[0xE6F4FF, 0xAADDFF]`; bounces |
| `arifl2` | Assault Bouncer | `arifle2` | Proj_Follow | `gas_small` | — | — | trail `ember`; `bounceShots:3` sub-munitions + `setFire:0.5` |

**Slot 4 — Long Range (snipers)**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `sniper` | .50 Cal Sniper | `sniper` | Line_Sniper | `gas_small` | `spark_big` | `sniper` | tracer `0xCCCCCC`→`0xEEEEEE` (w1 3.5 a.3 / w2 1.5 a.6) |
| `railgun` | Railgun | `railgun` | Line_Effect (pierces) | `chain_hit` | `getweapon` | — | tracer `0xDB0202`→`0xFFFFFF` (w1 5.5 a.6 / w2 2.5 a.8); trail-key `chain_fire` |
| `asniper` | Pulsator | `asniper` | Proj_Basic | `purple_fire` | `plasma_explode` | — | trail `plasma_shot` → port tint `[0x66E0FF, 0x9933CC]`; splash 60/1.0 |
| `sniper2` | Holy Grail | `sniper2` | Line_Sniper | `orange_shot` | `orange_shot` | `sniper` | tracer `0xFFCC00` both passes (w1 7 a.2 / w2 4 a.3); `setFire:0.5` |
| `railgun2` | Electro Bolt | `railgun2` | Line_Electric | `chain_hit` | `getweapon` | — | **3-strand** tracer `0x00CCFF` / `0x0099FF` / `0xCCFFFF`; `arc:400` (chains to 3 targets through walls) |

**Slot 5 — Heavies**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `chaingun` | Laser Minigun | `chaingun` | Line_Basic (piercing rig, one-clip) | `chain_fire` | `chain_hit` | — | tracer `0xDB0202`→`0xFFFFFF` (w1 3.5 a.6 / w2 1 a.8); `useAmmo:0.5` |
| `sawgun` | Shredder | `sawgun` | Proj_Basic (`burrow`) | `spark_big` | `spark_small` | `rocket` | trail `saw_shot`; burrows through ground, 2× dmg while burrowed |
| `beamer` | Focus Beam | `beamer` | Line_Laser (continuous beam) | `green_shot` | `green_shot` | — | tracer `0x66CC00`→`0x96CC01` (w1 8 a.5 / w2 4 a.8) |
| `destroyer` | Destroyer | `destroyer` | Line_Sniper | `chain_hit` | `getweapon` | — | tracer `0xDB0202`→`0xFFFFFF` (w1 6.5 a.8 / w2 4.5 a.8) |
| `flamethrower` | Flamethrower | `flamethrower` | Proj_Frames (animation-driven flame cone) | — (none) | `fexpand` | — | trail `flame`; splash 60/0.7, `setFire:3` (fire DoT), continuous |

**Slot 6 — Explosives**

| id | name | sprite | cls | effShoot | effHit | effShell | colour |
|---|---|---|---|---|---|---|---|
| `rocket` (native) | Rocket Launcher | `rocket` | Proj_Basic | `gas_small` | `gas_big` (hitSound `S_rocketExplode`) | — | trail `gas_small`; splash 120/0.9 |
| `icannon` | Ion Cannon | `icannon` | Line_Sniper | `gas_small` | `gas_big` | — | tracer `0xFFCC00`→`0xFFFFC4` (w1 8.5 a.5 / w2 3.5 a.6); splash 120/0.8, `setFire:0.5` |
| `sticklaunch` | Grenade Launcher | `stickylauncher` | Proj_Stick | `gas_small` | `gas_bred` | `rocket` | trail `chain_fire`; sticks to target, fused |
| `hrocket` | Ice Hunter | `rocket` sprite `hrocket` | Proj_Follow (homing) | `gas_small` | `gas_bblue` | — | trail `gas_sblue` → port tint `[0x99DDFF, 0x66CCFF]` |
| `spitter` | Acid Hound | `spitter` | Proj_Basic | `green_shot` | `gas_big2` | — | trail `gas_med` → port tint `[0x99CC33, 0x66CC00]`; splash 100/0.4 |
| `creditsgun` | Credit Cannon | `creditsgun` | Line_Sniper | `plasmapistol_hit` | `gas_bigblue` | `pistol` | tracer `0x006699`→`0x66CCFF` (w1 7.5 a.5 / w2 2.5 a.6); drains credits (`useCredits:4`) not ammo |
| `hrocket2` | Frozen Death | `rocket` sprite `hrocket2` | Proj_Follow (homing) | `gas_small` | `gas_bblue` | — | trail `gas_sblue`; negative shop `cost:-1` (reward-only) |

**Slot 7 — Ability/environment pseudo-weapons** (excluded from the port's playable roster — `weapons.ts` skips `w.type > 6`; these back melee/grenade-throw/mine abilities, doc 14)

| id | name | cls | effHit | notes |
|---|---|---|---|---|
| `env` | Environment | — | — | zero-stat placeholder used for environmental damage sources |
| `fire` | Fire | — | `fexpand` | standing fire-DoT tick source |
| `sword` | Katana | Melee_Basic | — | melee ability swing, `S_Whip` sound |
| `grenade` | Grenade | Proj_Bounce | `gas_big` (hitSound `S_rocketExplode`) | the *ability* grenade-throw, not the slot-6 rocket-family weapon |
| `mine` | Land Mine | Proj_Mine | `gas_big` (hitSound `S_rocketExplode`) | 30-tick(?) proximity mine |
| `bouncer` | Assault Bouncer sub-munition | Proj_Bounce | — | the fragment spawned by `arifl2`'s `bounceShots` and any weapon's `stats.extra.bounceShots` path (`Bullet.doHitEffect` L169–172) |

### 2.3 Wall-material impact palette (`Bullet.as` L365–475)

On a wall hit, *every* weapon's `stats.effHit` plays, but the wall's pixel colour
(read from `game.arena.wall.getPixel32`, the collision mask — doc 06) additionally
selects a **material-specific secondary effect**, independent of which gun fired:

| Wall pixel hex | Material | Secondary effect | Notes |
|---|---|---|---|
| `ffff06` | (space/void trim) | none | sniper headshot-from-orbit achievement check (`"moon"`) if `unit.human && stats.type==4` |
| `9900ff` | tutorial marker | none | fires `unit.game.tutShootWall(stats)` (tutorial-only hook) |
| `` (empty) | default/none | none | |
| `ff0000` | (reserved) | none | |
| `00ffff` | (reserved) | none | |
| `993300` | mud | `mud_splash` | gated by `SD.graphPart` (particle quality) |
| `670067` | (reserved) | none | |
| `6699ff` | (reserved) | none | |
| `ffffff` | snow | `snow_splash` | gated by `SD.graphPart` |
| `006600` | foliage/leaves | `leaf_splash` + N `"leaf"`-behaviour `Particle`s (falling leaf sprites `leaf1`–`leaf4`), and increments `unit.treeShoot` (achievement `"ammo"` at 400 tree-shots) |
| anything else | generic | none | |
| `burrow` weapons (sawgun) | — | `mud_splash` always | independent of the actual wall colour — burrowing always kicks mud |

This is a **map-material** system, not a per-weapon one — it belongs conceptually
next to doc 06 (map/wall data) but is documented here because it modifies every
weapon's wall-impact visual. The port's `Fx.ts` has no equivalent (§4/§5).

### 2.4 Shared effect-key vocabulary

The `effShoot`/`effHit`/`effShell`/trail keys above resolve to bitmap-animation
labels baked by `BH.as`. Grouping the ones actually used by weapons:

| Category | Keys | Implied look (name-inferred, not pixel-verified — §6) |
|---|---|---|
| Ballistic muzzle/spark | `gas_small`, `gas_big`, `gas_big2`, `gas_bred`, `gas_bblue`, `gas_bigblue`, `gas_sblue`, `gas_med` | small/large gas-puff muzzle flash and explosion flashes, colour-suffixed variants (red/blue/"big blue") for elemental rounds |
| Plasma/energy | `purple_fire`, `plasmapistol_hit`, `plasma_shot`, `plasma_explode`, `photon_shot`, `chain_fire`, `chain_hit`, `green_shot`, `orange_shot` | alien-tech bolts and their hit flashes; colour implied by name (`purple_fire` violet, `green_shot`/`orange_shot` self-descriptive) |
| Elemental | `ember`, `fexpand`, `snow_fall`, `snow_splash`, `bubble_shot` | fire embers / fire-expand flash / falling & splashing snow / water bubble trail |
| Blood | `blood_shot` (Vamp Charger trail only — regular hits use `hitObject.skin.blood`, doc 07), `bloodHuman`, `bloodShield`, `bloodRainbow` (special-mode) | |
| Terrain | `mud_splash`, `snow_splash`, `leaf_splash` | wall-material secondary effects (§2.3), not weapon-specific |
| Mechanical | `spark_big`, `spark_small`, `saw_shot`, `getweapon` (railgun/destroyer's odd `effHit` — likely a placeholder/mislabel in source, since `getweapon` elsewhere means "pickup a weapon"; port ignores it and substitutes `lightning`/`lazer`) | |

### 2.5 Reference screenshots

No dedicated weapon-visuals screenshot was provided in this pass's reference set
(shots #1–#9 are HUD/menu/tracer, doc 01/04/07-09); shot #9 (raycast/tracer look)
is covered in doc 04. No new visual reference is added here — colours above come
from `Stats_Guns.as` numeric literals, not screenshot sampling.

## 3. Current port state

The TS port already tracks this domain closely, split across four files:

- **`raze-ts/src/game/weapons.ts`** — `WeaponDef` (L54–190) carries the full visual
  surface per weapon: `sparkColor` (wall/ground impact tint), `muzzleColor`/
  `muzzleSize`/`muzzleLen`/`muzzleDy` (muzzle-flash geometry), `smoke` (barrel-smoke
  puff rate), `shell` (boolean — eject a casing), `wallEff`/`unitEff` (which `Fx.ts`
  effect key to build on impact), `projColor`/`projGlow` (projectile trail tint),
  `tracerColor`/`tracerColor2`/`tracerStyle`/etc. (doc 04). The 10 native weapons
  (L192–283) are hand-tuned with these values matched to the SWF's `Stats_Guns`
  entries (e.g. pistol `sparkColor: 0xfff2a0` reads as a warm off-white close to the
  `0xFFFFC4` tracer literal above). `NATIVE_WIRING` (L289–313) layers the *exact*
  Raze 2 tracer colours (`0xFFFFC4`, `0xCCCCCC`/`0xEEEEEE`, `0xDB0202`/`0xFFFFFF`,
  `0xCC00FF`/`0x9900FF`) onto those 10 weapons.
- **28 generated (non-native) Raze 2 guns** (L468–552, `raze2ToDef()`) are derived
  live from `assets/raze2/weapons.json` (the extracted `Stats_Guns` table, confirmed
  byte-identical to the decompile in §2.2): `tracerFromParams()` (L367–392) pulls the
  literal tracer colours straight out of `Bullet_Line_*` `params`; `PROJ_TINT`
  (L356–364) hand-maps the 13 projectile trail-bitmap keys actually used
  (`plasmapistol_shot`, `plasma_shot`, `photon_shot`, `blood_shot`, `bubble_shot`,
  `ember`, `snow_fall`, `saw_shot`, `gas_med`, `gas_small`(as `gas_sblue`? — no,
  separate `gas_sblue` entry), `gas_sblue`, `chain_fire`, `flame`) to an
  **inferred** `[core, glow]` hex pair, since the real bitmap was never re-rendered
  (§1/§6). `effectsFor()` (L457–465) picks a generic `wallEff`/`unitEff` bucket by
  ray type (`rocketExplode`/`bulletExplode`/`lightning`/`pistol`+`blood`) rather than
  a per-weapon bespoke look — every generated projectile/beam gun currently reuses
  one of 4 shared looks, tinted by `muzzleColor`/`sparkColor` = the tracer/trail
  colour (L502, L531).
- **`raze-ts/src/game/Fx.ts`** — the procedural particle-effect library that
  substitutes for Raze 2's baked bitmap animations. `createEffect(type, color?, angleDeg?)`
  (L637–682) switches on the `wallEff`/`unitEff` string and builds one of 16 named
  looks (`bulletSpark`, `bloodSpray`, `plasmaFlash`, `lightningFlash`, `explosion`
  (3 scales), `lazerImpact`, `sparkRain`, `critFlash`, `spawnFlash`, `genericRing`
  ×5 pickup tints); `addMuzzleFlash`/`emitSmoke`/`ejectShell` (L696–705) are the
  weapon-feel primitives driven directly from `WeaponDef` fields rather than a
  `wallEff` string. Every look is a hand-authored particle system with hard-coded
  hex colours chosen to *evoke* the Raze 2 effect name (e.g. `explosion()` L414–451
  goes orange→red→dark fireball + white shockwave ring for `rocketExplode`/
  `grenadeExplode`/`bulletExplode`; `plasmaFlash()` L350–371 defaults `0x66e0ff`
  cyan-blue matching the alien plasma family) — not sampled from the original
  bitmap, since that bitmap was never rendered out (§6).
- **`raze-ts/src/assets/ArmArt.ts`** + **`weaponArtAlias.ts`** — held-arm sprite
  system. `ArmArt` (L63–130) loads baked PNG frame-sequences from
  `public/assets/arms-anim/<gunid>/<frame>.png` (idle = frame 1, reload = the
  `armMeta.json`-recorded label range) for the **10 native weapons only**.
  `weaponArtAlias.ts` (L30–43) maps every one of the 28 generated Raze 2 guns onto
  the *nearest native weapon's* art by armory slot (`BASE_BY_TYPE`, L20–28) with a
  few bullet-class refinements (`Bullet_Line_Effect`/`Electric` → railgun art,
  `Bullet_Line_Laser`/`Zapper` → chaingun art, `Bullet_Proj_Stick` → grenade art,
  any slot-6 projectile → rocket art) — **no bespoke art exists yet for any of the
  28 generated guns**; they all borrow a native silhouette.
- **`raze-ts/src/assets/PickupWeaponArt.ts`** + **`raze-ts/src/game/PickupWeapon.ts`**
  — floor-pickup icon. `PickupWeaponArt` loads baked PNGs from
  `public/assets/pickups/weapons/<type>.png`, one per **native** weapon type +
  `"random"`, sourced (per its header comment) from SWF symbol chain
  `1650 → 1648 → 1647` (a labelled-frame weapon-silhouette clip) — again, only the
  10 native ids have real art; `artIdFor()` aliases the rest. `PickupWeapon.draw()`
  (L133–164) draws a soft amber ground-glow ellipse behind the icon when real art
  loaded, or falls back to a small dark rack-panel with a shrunk arm-sprite icon
  when it hasn't.

## 4. Gap analysis

- **No per-weapon bespoke wall/unit impact effect for the 28 generated guns.**
  `effectsFor()` buckets every projectile gun into `bulletExplode`/`rocketExplode`
  and every beam gun into `lightning`, regardless of whether the source is fire
  (`ember`/`fexpand`), ice (`snow_fall`/`snow_splash`), acid (`gas_med`), water
  (`bubble_shot`), or blood (`blood_shot`) — Raze 2 gives each of these a distinct
  bitmap; the port currently gives them a re-tinted generic shape only.
- **No bitmap ground-truth for any effect key.** §1/§2.4's "implied look" column is
  inferred from the effect-key *name*, not pixel-sampled — the actual colours,
  shapes, particle counts and frame timings of `gas_small`, `purple_fire`,
  `plasma_shot`, `ember`, etc. live inside one embedded clip (`BH` symbol `1809`)
  that was never rendered frame-by-frame through FFDec for this pass. Every hex
  value quoted for a `Bullet_Proj_*` trail in §2.2/`weapons.ts` `PROJ_TINT` is an
  editorial guess, not a citation.
- **No wall-material secondary-splash system** (§2.3: mud/snow/leaf splashes keyed
  off the wall pixel colour, independent of the firing weapon) — `Fx.ts`/`Arena`
  has nothing analogous; every wall hit in the port looks the same regardless of
  surface material.
- **`effShell` is per-weapon in Raze 2 but binary in the port.** Source: every gun
  either shares the `"pistol"`, `"shotgun"`, `"sniper"`, or `"rocket"` shell-bitmap
  key (4 distinct shell art variants, presumably differing in casing size/colour)
  or has none (`""`). Port: `WeaponDef.shell` (`weapons.ts` L183) is a plain
  boolean — `Fx.ts`'s `shellCasing()` (L268–312) draws one universal brass sliver
  for every weapon that ejects, with no size/colour variation by weapon family.
- **Bullet-class-specific muzzle-flash-suppression not modelled.** Raze 2's
  `flamethrower` has `effShoot: ""` (no discrete muzzle-flash bitmap — it *is* the
  continuous flame) and `zapper` likewise has `effShoot: ""`. The port's
  `muzzleFlash()` (`Fx.ts` L186–225) always fires from `WeaponDef.muzzleColor`/
  `muzzleSize` for every weapon; there's no per-weapon flag to suppress it for
  continuous-effect weapons (though the generated defs for these two do carry a
  `muzzleColor`/`muzzleSize` derived from their tracer/trail tint, so a flash still
  pops on every "tick" of fire — arguably harmless but not a faithful 1:1).
- **28 generated guns have no bespoke held-gun/pickup art** (§3, `weaponArtAlias.ts`)
  — this is flagged there as a known, intentional stand-in pending real art
  extraction, not a bug, but is a real visual gap vs. Raze 2 (each of the 28 has a
  unique `sprite` clip label in `Stats_Guns.as`, e.g. `plasmapistol`, `burster`,
  `mauser`, `sparkgun`, `blaster`... none of which have been exported to
  `public/assets/arms-anim/`).
- **`railgun`/`railgun2`/`destroyer`'s `effHit: "getweapon"` is almost certainly a
  data mistake or placeholder reused from the "weapon pickup glow" effect** (that
  string elsewhere in the codebase means "you picked up a weapon") rather than a
  bespoke railgun-impact bitmap; the port correctly ignores it and substitutes
  `lightning`/`lazer` procedurally — flag this as confirmed-intentional divergence,
  not a bug to "fix" by chasing the literal string.
- **`railgun2`'s 3-strand tracer colour set (`0x00CCFF`/`0x0099FF`/`0xCCFFFF`) is not
  wired into the port.** `weapons.ts`'s `tracerFromParams()` "electric" case only
  reads `params[1..6]` (2 strands); `railgun2`'s `params` array has a 3rd pair at
  indices 7–8 (`1.5, 13434879, 0.4`) that is silently dropped — the port's
  `Bullet_Line_Electric` visual (doc 04/05) only ever draws 2 colours where Raze 2
  draws 3.
- **Grenade-ability `grenade`/`mine`/`bouncer`/`sword`/`fire`/`env` (slot 7) are
  entirely un-catalogued in the port's `WEAPONS` table** — by design (`weapons.ts`
  skips `type > 6`), but their visuals (doc 14 abilities) are a genuine follow-up
  domain, not covered by anything above.

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. **Render the `BH` embedded clip (SWF symbol `1809`, `assets.swf`) through FFDec**,
   frame-label by frame-label, for every effect key referenced in §2.2/§2.4
   (`gas_small`, `gas_big`, `purple_fire`, `plasma_shot`, `ember`, `snow_fall`,
   `bubble_shot`, `blood_shot`, `saw_shot`, `chain_fire`, `mud_splash`,
   `leaf_splash`, etc. — ~30 keys). Export each label's frames as PNG sequences so
   real colours/shapes/sizes can be sampled and cited, replacing the "inferred from
   name" caveat throughout this doc. This unblocks everything else below.
2. Once real bitmaps are sampled, extend `PROJ_TINT` (`weapons.ts` L356–364) from
   editorial guesses to sampled hex pairs, and expand `effectsFor()` (L457–465) from
   4 generic buckets to a full per-trail-key `wallEff`/`unitEff` mapping (fire, ice,
   acid, water, blood, mechanical spark) with matching new `Fx.ts` builders (one new
   `createEffect` case + particle-burst function per bucket, following the existing
   `plasmaFlash`/`bloodSpray` pattern).
3. Add the wall-material secondary-splash system (§2.3) to `Arena`/`Fx.ts`: sample
   the wall/collision-mask pixel colour at the impact point (doc 06 has the
   authoritative wall-mask representation), map `993300`→mud, `ffffff`→snow,
   `006600`→leaves (+ falling-leaf particle spawn, `Particle.as` `"leaf"` behaviour),
   and layer that effect under/alongside the weapon's own `wallEff`.
4. Extend `WeaponDef.shell` from boolean to a shell-variant key (`"pistol"` /
   `"shotgun"` / `"sniper"` / `"rocket"` / none, per §2.2's `effShell` column) and
   give `Fx.ts`'s `shellCasing()` (L268–312) 2–3 size/colour variants instead of one
   universal brass sliver.
5. Add a `noMuzzleFlash` (or reuse `muzzleSize: 0`) escape hatch for `flamethrower`
   and `zapper` (both have Raze 2 `effShoot: ""`) so `Fx.ts`'s `muzzleFlash()` is
   skipped for them, matching the source's "the projectile/beam IS the muzzle
   effect" design.
6. Fix `Bullet_Line_Electric`'s dropped 3rd strand: extend `tracerFromParams()`'s
   `"electric"` (in practice the `"basic"`/fallback path used for it, verify against
   `CLS_TRACER`) to read `params[7..9]` when present and add a 3rd jittered strand
   in the doc-04/05 line-drawing code, so `railgun2` renders its authentic
   cyan/blue/pale-cyan triple-strand arc instead of 2 strands.
7. Once step 1's art is available, export bespoke held-arm + pickup-icon art for
   the 28 generated Raze 2 guns (mirroring the existing `arms-anim`/`pickups/weapons`
   pipeline for the 10 natives) and retire the `weaponArtAlias.ts` fallback map
   (keep it as the *loading* fallback for guns whose art extraction hasn't landed
   yet, rather than a permanent stand-in).
8. Investigate `railgun`/`railgun2`/`destroyer`'s `effHit: "getweapon"` against a
   rendered FFDec capture to confirm it's a dead/placeholder value before spending
   more effort trying to "restore" a bespoke railgun impact bitmap that may not
   exist.

## 6. Open questions / data still missing

- **No pixel-verified colour/shape exists for any `effShoot`/`effHit`/`effShell`/
  trail bitmap key** — every "implied look" in §2.2/§2.4 is inferred from the
  effect-key *name* (e.g. assuming `purple_fire` is violet), not sampled from the
  actual embedded `BH` clip. This is the single largest gap in this doc and blocks
  real fidelity comparisons; needs the FFDec render pass in checklist step 1.
- **`Pickup_Weapon.as` does not exist under that name** in
  `decompiled_swf/raze 2/scripts` (confirmed absent — only `NodePickup.as` was
  found). The port's `PickupWeapon.ts` docstring citing it should be treated as the
  port's own naming, not a verified decompile source, until/unless the actual
  floor-pickup class is located under a different name.
- **`blood` (Vamp Charger)'s exact `extra` object** (`{"useHp":3, ...}`) was
  reconstructed from heavily control-flow-flattened bytecode (`Stats_Guns.as`
  L264–306) and may be missing a second flag (`stealHp`-related) that didn't
  survive the obfuscated push/pop reconstruction cleanly — worth re-checking against
  `weapons.json`'s extracted value directly rather than this doc's manual read.
- **`getweapon` as an `effHit` value** (railgun/railgun2/destroyer) is flagged as
  probably-a-placeholder in §4 but not confirmed either way — needs the FFDec render
  to settle whether `BH` actually has a frame label called `"getweapon"` with unique
  content, or whether it silently falls through to `BH`'s `"error"` bitmap
  (`getBit()` L218–222 catches missing keys and substitutes `BITS["error"]`).
- **Shell-casing bitmap variants** (`pistol`/`shotgun`/`sniper`/`rocket` — do these
  differ in size, colour, or just animation-frame count?) are unverified pending
  step 1.
- **Whether any of the 28 generated guns' `sprite` clips already exist, unused, in
  the current `raze-2.swf`** (as opposed to needing fresh art) was not checked in
  this pass — `decompiled_swf/raze 2/sprites` and `/images` were spot-checked for
  the effect-key *names* used as filenames and found nothing (filenames there are
  numeric symbol ids, not semantic labels), but a `symbolClass/symbols.csv` lookup
  by class name (only spot-checked for sound classes) could plausibly resolve
  `sprite` labels like `"plasmapistol"`/`"burster"` to concrete symbol ids for
  direct FFDec export — worth trying before assuming new art must be drawn from
  scratch.
