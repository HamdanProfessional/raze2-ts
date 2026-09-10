# Projectile Physics

## 1. Summary

Every shot in Raze 2 — hitscan pistol round, homing plasma bolt, bouncing grenade, mine, flamethrower
gout — is an instance of a `Bullet` subclass. `Bullet` (the shared base, `Bullet.as`) owns muzzle-offset
placement, the world/unit/corpse hit-test (`hitTestAll`), the universal hit-resolution pipeline
(`doHitEffect`) that applies damage, splash, wall-material FX and (for a handful of guns) chain-arcing
or self-replicating sub-munitions, and distance/lifetime bookkeeping (`maxDist`/`curDist`). Each concrete
subclass overrides only `EnterFrame()` (per-tick motion) and sometimes the constructor (initial flight),
giving 12 distinct *mechanics* built from one shared collision/damage core:

`Bullet_Proj_Basic` (plain arcing shot), `Bullet_Proj_Follow` (homing), `Bullet_Proj_Bounce`
(wall-bouncing timed shell), `Bullet_Proj_Stick` (sticks + timed fuse), `Bullet_Proj_Mine` (drops, arms,
proximity-detonates), `Bullet_Proj_Frames` (animation-driven flame gout), `Bullet_Melee_Basic` (instant
melee swing), and the five `Bullet_Line_*` hitscan/beam variants (`Basic`, `Bend`, `Sniper`, `Effect`
[pierce], `Electric` [arc-chain], `Laser`, `Zapper`) which resolve instantly but still carry physics-relevant
mechanics (falloff, chaining, piercing) that this doc owns; their *rendering* (dashes, curves, jitter,
fade) is doc 04's job. Two cross-cutting `stats.extra` flags — `bounceShots` (spawn N radial sub-munitions
on any impact) and `burrow`/`arc` — layer on top of the base classes rather than being classes of their
own.

The engine runs at a fixed 30 fps logic tick; every constant below (`*30`, `*0.1`, etc.) is expressed
against that tick.

## 2. Raze 2 source of truth

### 2.0 Files

| File | Role |
|---|---|
| `Bullet.as` / `Bullet_2.as` | Base class: constructor (muzzle placement, `maxDist`), `hitTestAll` (wall/unit/corpse hit-test + hitbox geometry), `doHitEffect` (damage/splash/chain/bounceShots/wall-material dispatch), `checkSplash`, `hitTestWall` |
| `Bullet_Proj_Basic.as` | Plain arcing projectile (gravity, no special behaviour) |
| `Bullet_Proj_Follow.as` | Homing: fixed-degree-per-frame turn toward nearest enemy in range |
| `Bullet_Proj_Bounce.as` | Bounces off floor/ceiling/walls with velocity damping; timed auto-detonate |
| `Bullet_Proj_Stick.as` | Embeds in whatever it first touches (unit/corpse/**wall**); timed fuse |
| `Bullet_Proj_Mine.as` | Free-falls, settles on a surface, arms, proximity-detonates or times out |
| `Bullet_Proj_Frames.as` | Flamethrower gout: bitmap-animation-driven lifetime, rises instead of falling |
| `Bullet_Melee_Basic.as` | Instant single-tick melee swing (no `EnterFrame`) |
| `Bullet_Line_Basic.as` | Instant hitscan ray, optional dashed midpoints (`params[0]`) |
| `Bullet_Line_Bend.as` | Instant hitscan ray, drawn as a settling quadratic curve (visual only) |
| `Bullet_Line_Sniper.as` | Instant hitscan ray, drifting/fading polyline (visual only) |
| `Bullet_Line_Effect.as` | Instant hitscan ray with **pierce** (`stats.extra.pierce`): keeps testing past each hit, dedupes hit units, stops at first non-unit/corpse hit or a mirror shield |
| `Bullet_Line_Electric.as` | Instant hitscan ray; pairs with **arc-chain** (`stats.extra.arc`) resolved in the base class |
| `Bullet_Line_Laser.as` | Instant *continuous* ray, re-fired fresh every tick (no travel-time, no `maxDist` stepping loop like the others — always full range) |
| `Bullet_Line_Zapper.as` | Instant ray with **distance-based damage falloff** |
| `Stats_Guns.as` | `addGun()` table: per-weapon `dmg`, `mults` (head/crotch/butt), `force`, `splash`, `splashMult`, `range`, `params` (bullet-class-specific numeric array), `extra` (flag object), `cls` (bullet class) |
| `raze-ts/src/assets/raze2/weapons.json` | Already-extracted, clean JSON mirror of every `addGun()` call (used for the tables below) |

### 2.1 Shared mechanics (`Bullet.as`, all classes)

**Muzzle placement & range** (`Bullet` ctor, lines 75–144):
- Spawn point offset from the firer by `stats.yOff` along `rotation+90°`.
- `maxDist = (extra.range ?? stats.range) + (fixedDist ? 0 : irand(-3,3))`, then **`maxDist *= 10`**
  (line 106) — so all the `range` values in the tables below are in "native ×10" units once loaded.
  `unit.equips.range` (Spiral Chamber) adds flat extra distance before the ×10.
- Muzzle "walk-out" loop: steps `xVel,yVel` (magnitude 10, i.e. `UT.xMoveToRot(rotation,10)`) up to
  `param6+1` times doing a hit-test each step, so the shot doesn't spawn already inside a wall at the
  barrel tip.

**Hit-test geometry** (`hitTestAll`, lines 484–703) — shared by every class, hitscan and projectile alike:
- Wall test: `arena.wall.getPixel32(x,y)`; a hit requires alpha byte `== 0xff` (opaque collision layer).
  The low 3 bytes (RGB) select a **wall-material** effect switch in `doHitEffect` (moon dust / mud splash
  / snow splash / leaf splash+particles, by hex: `9900ff`→tutorial hint, `670067`/`00ffff`/`ff0000`→no FX,
  `993300`→mud, `ffffff`→snow, `006600`→leaves).
- Unit test: coarse broad-phase `inBox(x,y, u.x-25, u.y-80, 50, 80)`, then fine per-limb hitboxes (all in
  local unit space, non-crouching / crouching / spinning variants):
  | Zone | Standing box (w×h @ offset) | Crouching box | Spinning box |
  |---|---|---|---|
  | Head | 40×17 @ (-20,-80) | 40×17 @ (-20,-60) | — |
  | Crotch/Butt | 40×10 @ (-20,-37) | 40×7 @ (-20,-25) | — |
  | Body | 40×80 @ (-20,-80) | 40×60 @ (-20,-60) | 50×70 @ (x,-70) |
  A unit is "spinning" (immune to headshot zoning, one big box instead) when `mov.spinning &&
  |mov.spinCur| > 30`. Head/crotch/butt hits set `extra.headMult`/`crotchMult`/`buttMult` from
  `stats.mults` (doc 01 owns the multiplier table); `stats.splash >= 80` additionally flags
  `extra.splashDirect = true` on any hitbox hit.
- Corpse test: `getDist(x,y, actor.x,actor.y) < 30` against `game.physWorld.actors` (ragdolls).
- `extra.ignoreAll` skips *both* the wall test and the corpse loop (used by arc-chain sub-shots).

**Hit resolution** (`doHitEffect`, lines 147–482), in priority order:
1. **Mirror shield** (`hitObject.status.sMirror`): reflects the shot back at the shooter via
   `UT.rotBounceOff` (± `rand(-10,10)` degrees) unless `extra.reflect` is already set (prevents infinite
   ping-pong). New reflected bullet is a full re-instantiation of the same `stats.cls`.
2. **`stats.extra.bounceShots`** (Assault Bouncer / native `bouncer`): on **any** hit type, if `hitType
   == "unit"` apply `stats.dmg*dmgMod` directly first, then step the position back
   `x -= xVel*3; y -= yVel*3` and spawn `bounceShots` copies of gun id `"bouncer"` (`Bullet_Proj_Bounce`)
   at uniform-random angles (`rand(0,360)`) from that point; the parent projectile is removed. This
   **returns immediately** — no splash pass runs for the parent hit itself.
3. Normal **unit hit**: blood/shield-block FX, direct damage (`stats.dmg*dmgMod`, `pierce` shots don't
   remove themselves), then **arc-chain** (`stats.extra.arc`, railgun2 only): for every *other* living,
   non-teammate unit within `arc` px of the hit point (ignoring walls — `ignoreAll:true`), up to 3 chained
   targets, spawn a copy of the same gun at half damage (`dmgMod:0.5`) aimed at that unit
   (`noArc:true` prevents re-chaining).
4. **Corpse hit**: blood FX + `game.physWorld.hitCorpse(...)` (ragdoll impulse; damage-independent).
5. **Wall hit**: for projectiles, steps back one tick and removes itself — **unless `stats.extra.burrow`**
   (Shredder), in which case it does **not** remove: `extra.burrowMult = 2` (2× damage flag) and
   `yVel -= stats.params[2]*0.1` (one extra upward nudge) so it keeps travelling through the ground toward
   the far side, spawning `"mud_splash"` each tick instead of the normal wall-hit FX.
6. **`checkSplash()`** always runs last if `stats.splash > 0`: for every living unit (other than the one
   already hit directly) within `stats.splash` px of the impact point *with clear line-of-sight* (a single
   10px ray-step wall check toward that unit), apply `stats.dmg` with `extra.splashMult = stats.splashMult`
   passed through to `Status.damage` (the falloff/reduction math itself is doc 01/Status territory, out of
   scope here). `stats.splash < 80` additionally flags `extra.splashIndirect = true` for these secondary
   hits (`>= 80` was already flagged `splashDirect` at hit-test time).

### 2.2 `Bullet_Proj_Basic` — plain arcing projectile

`params = [effectKey, speedFactor, gravity]`. Ctor halves the base 10px direction vector to
`xVel,yVel` (magnitude 5). Each `EnterFrame` (`Bullet_Proj_Basic.as:23-67`):
```
yVel += params[2] * 0.1                         // gravity, once per tick
for i in 0..<params[1]:                          // "speed factor" substeps
    x += xVel; y += yVel                         // move 1
    x += xVel; y += yVel                         // move 2 (unconditional; SD.graphPart only gates an extra trail-effect draw between them)
    countDist += |xVel|*2 (x and y separately, combined via getPythagorean)
    if hitTestAll(): break
removeMe() if countDist >= maxDist, or off-arena (x/y outside [0,3000])
```
So **speed = `params[1] * 10` native px/frame** (≈ `params[1] * 300` px/s), **gravity accel =
`params[2] * 0.1` native px/frame²** added to `yVel` once per tick, and **lifetime ≈ `stats.range /
params[1]` frames** if it never hits anything sooner (falls out from `maxDist = range*10` vs. per-frame
`countDist += params[1]*10`).

| Weapon (id) | dmg | range | params `[fx, speedFactor, gravity]` | speed (px/frame) | gravity (px/frame²) | ≈lifetime (frames) | extra |
|---|---|---|---|---|---|---|---|
| Burst Torch (`sparkgun`) | 10 | 70 | `["ember",14,0.5]` | 140 | 0.05 | 5 | `setFire:1` |
| Photon Blaster (`blaster`) | 4 | 50 | `["photon_shot",7,0.5]` | 70 | 0.05 | 7 | `extraShots:2` (3-pellet spread) |
| Vamp Charger (`blood`) | 9 | 60 | `["blood_shot",4,3]` | 40 | 0.3 | 15 | lifesteal (Status territory) |
| Pulsator (`asniper`) | 70 | 300 | `["plasma_shot",8,0.5]` | 80 | 0.05 | 37.5 | `splash:60, splashMult:1` |
| Shredder (`sawgun`) | 40 | 300 | `["saw_shot",2,2]` | 20 | 0.2 | 150 | `burrow:true` (2× dmg while burrowing) |
| Rocket Launcher (`rocket`) | 112 | 70 | `["gas_small",7,0.5]` | 70 | 0.05 | 10 | `splash:120, splashMult:0.9` |
| Acid Hound (`spitter`) | 30 | 60 | `["gas_med",4,4]` | 40 | 0.4 | 15 | `splash:100, splashMult:0.4` |

### 2.3 `Bullet_Proj_Follow` — homing

`params = [effectKey, speedFactor, gravity, seekRadius, turnDegPerFrame]`. Identical motion loop to
`Bullet_Proj_Basic` plus, **before** moving each tick (`Bullet_Proj_Follow.as:46-92`):
```
rotation = angle(vx,vy)                                   // current heading
for u in units: if u is enemy, alive, dist(u) < params[3]:
    rotation += rotateDirection(rotation, angleTo(u)) * params[4]   // ±1 * fixed degrees, NOT proportional
xVel,yVel = vectorFromAngle(rotation, 5)
```
Every enemy within `seekRadius` nudges the heading by exactly `±turnDegPerFrame` degrees toward it each
tick (last enemy processed in the units-array loop wins if several are in range — no distance-weighting).
Weapons whose `params` array is `null`/too short (no index 3/4) get **no homing at all** — a latent no-op
in the original engine (`typeof undefined < number` fails closed):

| Weapon (id) | dmg | range | params | seekRadius | turn/frame | homing? |
|---|---|---|---|---|---|---|
| Plasma Pistol (`plaspistol`) | 10 | 45 | `["plasmapistol_shot",2,0,200,7]` | 200 | 7° | yes |
| Bubble Blaster (`alienrifle`) | 8 | 60 | `null` | — | — | **no** (labelled "Homing" in-game but inert) |
| Assault Bouncer (`arifl2`) | 5 | 45 | `["ember",10,1]` | — | — | **no** (params too short; real behaviour is `bounceShots:3` below) |
| Ice Hunter (`hrocket`) | 45 | 70 | `["gas_sblue",2,1,180,7]` | 180 | 7° | yes |
| Frozen Death (`hrocket2`) | 30 | 75 | `["gas_sblue",3,1,180,8]` | 180 | 8° | yes |

`arifl2` also carries `extra.bounceShots:3, setFire:0.5` (base-class mechanic §2.1.2): every impact spawns
3 `bouncer` sub-munitions (`Bullet_Proj_Bounce`, dmg 10, `params:["ember",1,5,1]`, speed 10px/frame,
gravity 0.5, 1s auto-timer, `setFire:0.5`) radiating at random angles.

### 2.4 `Bullet_Proj_Bounce` — wall-bouncing timed shell

`params = [effectKey, speedFactor, gravity, lifetimeSeconds]`. Per substep
(`Bullet_Proj_Bounce.as:46-130`), after the same double-move as Basic:
- Unit hit (`hitTestAll(0,0,true)` — wall-hit-type suppressed) → break out and `doHitEffect()` immediately
  (explodes on unit contact; **does not stick**).
- Wall hit (`hitTestWall(0,0)`) → up to **all four** of these independently apply (not mutually exclusive,
  each increments `extra.bounce`):
  | Probe offset | Meaning | Response |
  |---|---|---|
  | `(0, +15)` | floor below | `y -= yVel*4; yVel *= -0.5; xVel *= 0.8` |
  | `(0, -15)` | ceiling above | `y -= yVel*4; yVel *= -0.5; xVel *= 0.8` |
  | `(+10, -10)` | wall to the right | `x -= xVel*2; xVel *= -0.6; yVel *= 0.7` |
  | `(-10, -10)` | wall to the left | `x -= xVel*2; xVel *= -0.6; yVel *= 0.7` |
- **Auto-detonate**: `if (fc == params[3]*30) doHitEffect(true)` — `fc` counts *EnterFrame calls since
  spawn* (not since first bounce), checked with `==` (a one-shot trigger on that exact tick). No cap on
  bounce *count* exists anywhere in the source — a shell can bounce indefinitely until its timer runs out
  or it touches a unit.

| Weapon (id) | dmg | range | params `[fx, speedFactor, gravity, lifetimeSec]` | speed | gravity | timer (frames) | extra |
|---|---|---|---|---|---|---|---|
| Particle Cannon (`pcanon`) | 10 | 23 | `["ember",4,3,1.5]` | 40 | 0.3 | 45 | `extraShots:4` (5-pellet), `setFire:0.5` |
| Hail Storm (`icegun`) | 9.5 | 90 | `["snow_fall",4,3,1.5]` | 40 | 0.3 | 45 | — |
| Grenade (native `grenade`, thrown ability) | 45 | 0 (fixedDist likely; see §6) | `["grenade",3,3,2]` | 30 | 0.3 | 60 | `splash:79, splashMult:0.7` |
| Assault-Bouncer sub-shot (`bouncer`) | 10 | 0 | `["ember",1,5,1]` | 10 | 0.5 | 30 | `setFire:0.5` |

### 2.5 `Bullet_Proj_Stick` — embeds + timed fuse

`params = [effectKey, speedFactor, gravity, fuseSeconds]`. Flies exactly like Basic until
`hitTestAll()` returns **any** hit type (`Bullet_Proj_Stick.as:36-119`):
- `unit` → records `xOff/yOff` relative to the unit and rides it every frame afterward (re-sticks to the
  corpse, keeping the same offset, the instant that unit dies — `extra.corpseStick = true`).
- `corpse` → records offset relative to the ragdoll body, same as above.
- **`wall`** → simply stops (no offset target; `x,y` stay frozen at the wall surface). This *is* a valid,
  intentional stick target in the source.
- Fuse: `fc` counts ticks since sticking; `if (fc == params[3]*30) doHitEffect()` — one-shot detonation at
  the exact fuse tick, whichever surface it's stuck to.

| Weapon (id) | dmg | range | params `[fx, speedFactor, gravity, fuseSec]` | speed | gravity | fuse (frames) | extra |
|---|---|---|---|---|---|---|---|
| Grenade Launcher (`sticklaunch`) | 40 | 60 | `["chain_fire",3,3,1]` | 30 | 0.3 | 30 (1s) | `splash:100, splashMult:0.7` |

### 2.6 `Bullet_Proj_Mine` — drop, arm, proximity-detonate

`params = [lifetimeSeconds]` (only one param). No `EnterFrame` gravity constant from `params[2]` — it's
hardcoded (`Bullet_Proj_Mine.as:41-89`):
```
yVel = 0 at spawn
while not hitWall:
    yVel = min(yVel + 2, 15); y += yVel        // free-fall, capped terminal velocity 15px/frame
    if hitTestWall(0, 8):                       // probe 8px below
        nudge y -= 3 (up to 100 times) until clear of the wall, then hitWall = true  // "landed" / armed
once armed (hitWall):
    hitObject = hitTestAll(0, -10, true)         // full per-limb hitbox test each tick, offset 10px up, ignoreAll suppressed so it still respects extra.ignoreAll but NOT wall-hit typing
    detonate if: (hitType=="unit" && hitObject!=unit && (unit.team ? hitObject.team!=unit.team : true))
              or fc == params[0]*30
```
Visual blink: sprite frame alternates `off`/`on` (or team-tinted `team`) every `2` ticks once armed
(`fc/2 % 2 == 0`). Team-aware trigger — a mine will **not** detonate on its own team in team modes, only
FFA units or enemies. Auto-timeout at `params[0]*30` frames regardless of whether it ever triggers.

| Weapon (id) | dmg | params | timeout (frames) | splash |
|---|---|---|---|---|
| Land Mine (native `mine`, ability/pickup) | 55 | `[30]` | 900 (30 s) | `splash:79, splashMult:0.7` |

### 2.7 `Bullet_Proj_Frames` — flamethrower gout

`params = [animBaseName, speedFactor, gravity, hitWindow]`. Motion is the plain Basic double-move loop,
but lifetime is **animation-frame-driven, not distance-driven** (`Bullet_Proj_Frames.as:45-111`):
```
yVel += params[2] * 0.1     // gravity; flamethrower uses -2 → rises upward, doesn't fall
frame += 1 each tick; removeMe() once frame > bitstats.frames   // bitstats = BH.getBitAniStats(animBaseName+variant, "idle")
for i in 0..<params[1]: move, paint frame-of-animation at (x,y)
    if frame < bitstats.frames - params[3]:   // can only register a hit before the last `params[3]` anim frames
        if hitTestAll(): doHitEffect(); break
```
`bitstats.frames` is the sprite-sheet's authored frame count for the `idle` animation of
`"flame" + irand(0, rotAmt-1)` (a random pre-baked rotation variant chosen once at spawn) — **not present
in any numeric stat table**; it's baked into the flame animation asset (doc 03/06 asset territory, flagged
as missing data in §6).

| Weapon (id) | dmg (per tick, splash) | params `[fx, speedFactor, gravity, hitWindow]` | speed | gravity | extra |
|---|---|---|---|---|---|
| Flamethrower (`flamethrower`) | 2 | `["flame",2,-2,4]` | 20 (rising) | -0.2/frame | `splash:60, splashMult:0.7, setFire:3, soundFrames:16` |

### 2.8 `Bullet_Melee_Basic` — instant swing

No `EnterFrame` at all — resolves entirely in the constructor (`Bullet_Melee_Basic.as`): steps
`xVel,yVel` (magnitude 5, from the halved base vector — wait, actually **not halved**: this class calls
`super(...)` directly without touching `xVel`/`yVel`, so its step is the *un-halved* magnitude-10 vector)
up to `maxDist/10` times, hit-testing each step, then immediately calls `doHitEffect()` and `removeMe()`
in the same tick — a same-frame instant swing with a range check but no travel time or persistence.

| Weapon (id) | dmg | range | extra |
|---|---|---|---|
| Katana (`sword`, ability) | 75 | 7 | `force:15` (knockback only) |

### 2.9 `Bullet_Line_*` — instant rays (physics-relevant mechanics only; rendering is doc 04)

All five step a virtual point at the un-halved magnitude-10 vector up to `maxDist/10` times
(`uint(maxDist/10)` iterations — note `Bullet_Line_Laser` is the one exception: it does the same stepping
loop but is re-run from scratch **every single tick** with no persistent flight, i.e. it behaves as a
continuous always-current-frame ray rather than a one-shot travelling shot).

- **Pierce** (`Bullet_Line_Effect`, `stats.extra.pierce`): keeps stepping past a hit instead of stopping;
  maintains a `hitObjects` array so the same unit is never damaged twice by one shot; stops only on a
  non-unit/non-corpse hit (wall) or a mirrored unit. Used by Railgun (`railgun`) — `extra.pierce:true`.
- **Arc-chain** (`Bullet_Line_Electric` pairs with `stats.extra.arc`, resolved in the shared base-class
  hit-resolution, §2.1.3): Electro Bolt (`railgun2`), `extra.arc: 400` — chains to up to 3 other living
  non-teammates within 400px of the hit point, through walls, at half damage each.
- **Distance-based damage falloff** (`Bullet_Line_Zapper` ctor, `Bullet_Line_Zapper.as:70-104`):
  `dmgMod = (maxDist - curDist) / maxDist * 1.5 + 0.5` — ranges from **2.0×** at point-blank
  (`curDist≈0`) down to **0.5×** at max range (`curDist≈maxDist`), applied as `stats.dmg * dmgMod` in the
  base class's normal unit-hit damage line. Zapper (`zapper`) is the only user; this is exactly the "up to
  2x damage up close" described in its in-game tooltip.
- All other `Bullet_Line_*` classes (`Basic`, `Bend`, `Sniper`) have no travel-time-relevant mechanic
  beyond the shared base-class hit resolution; their `params` arrays are purely stroke width/color/alpha
  (doc 04/05).

## 3. Current port state

`raze-ts/src/game/Projectile.ts` implements one unified `Projectile` class driven by flags on `WeaponDef`
(`raze-ts/src/game/weapons.ts`) rather than one subclass per Raze 2 bullet class. `weapons.ts`'s
`projBehavior()` (lines 422-443) and `extraBehavior()` (lines 446-454) translate each Raze 2 weapon's
`cls`/`params`/`extra` into those flags at catalog-build time (`raze2ToDef`, lines 468-543).

| Raze 2 mechanic | Port flag(s) | Wired in |
|---|---|---|
| Gravity (`params[2]*0.1`) | `fallSpeed` | `projMotion()` weapons.ts:395-407; applied `Projectile.ts:159` (`vy += fallSpeed*0.8`) |
| Speed (`params[1]*10`) | `speed` | `projMotion()`; applied as `speed = (def.speed??3)*4` px/frame, `Projectile.ts:73` |
| Homing (`Bullet_Proj_Follow`) | `homing`, `homingTurn`, `seekRadius` | `projBehavior()` weapons.ts:424-431, `hasHomingParams()` guard reproduces the "no seek params ⇒ inert" latent bug faithfully; steering in `Projectile.steerHoming()` Projectile.ts:245-269 |
| Bounce (`Bullet_Proj_Bounce`) | `bounce`, `bounceLife` | `projBehavior()` weapons.ts:432-433; `Projectile.doBounce()` Projectile.ts:272-289 |
| Stick (`Bullet_Proj_Stick`) | `stick`, `stickFuse` | `projBehavior()` weapons.ts:434-435; `Projectile.stickTo()` Projectile.ts:317-326 |
| Mine (`Bullet_Proj_Mine`) | `mine`, `mineLife` | `projBehavior()` weapons.ts:436-437; `Projectile.settle()`/`mineTick()` Projectile.ts:292-314 |
| Flame (`Bullet_Proj_Frames`) | `flame` | `projBehavior()` weapons.ts:438-439; rise motion `Projectile.ts:153-157` |
| Burrow (`extra.burrow`) | `burrow` | `extraBehavior()` weapons.ts:449; handled `Projectile.ts:204-211` |
| Arc-chain (`extra.arc`) | `arc` | `extraBehavior()` weapons.ts:448; **not consumed anywhere in `Projectile.ts`** (only stored on `WeaponDef` — railgun2 is hitscan/beam, not `Projectile`-routed, so this flag is presumably read by the hitscan path instead; not in scope of this file) |
| bounceShots (Assault Bouncer) | `bounceShots` | `extraBehavior()` weapons.ts:450; `Projectile.spawnBouncers()` Projectile.ts:333-352, called from `explode()` line 357 |
| setFire | `setFire` | `extraBehavior()` weapons.ts:451; applied in `explode()` Projectile.ts:379-381, 397-399 |
| Melee | *(not projectile-routed; likely a separate instant-hit path outside this file)* | out of scope |
| Splash | `splashMult`, fixed **radius 90px** | `explode()` Projectile.ts:359-389 |
| Direct unit-hit radius | fixed **22px** single-circle test | `enterFrame()` Projectile.ts:230-241 |
| Mine proximity radius | fixed **34px** single-circle test | `mineTick()` Projectile.ts:306-314 |
| Off-arena cull | `x/y` vs. arena bounds via `pointInWall`/`floorY` | `enterFrame()` Projectile.ts:201 (no literal `[0,3000]` bound check — uses the port's actual arena geometry instead) |

## 4. Gap analysis

Concrete, measurable divergences from the source, most-impactful first:

1. **Stick/grenade wall-embed is missing.** `Bullet_Proj_Stick` in the source embeds into **walls** just
   as readily as units/corpses (§2.5) and only detonates on its fuse timer. In the port, `enterFrame()`'s
   wall-collision branch (Projectile.ts:202-221) only special-cases `mine`/`burrow`/`bounce`; a `stick`
   weapon falls into the generic `else { this.explode(); return; }` and detonates **instantly on wall
   contact** instead of embedding and waiting out `stickFuse`. This affects the Grenade Launcher
   (`sticklaunch`) once it's wired as a playable weapon.
2. **Native "Grenade" is the wrong bullet class entirely.** Source: the throwable ability grenade uses
   `Bullet_Proj_Bounce` (`params:["grenade",3,3,2]`) — it **bounces** off floors/walls (damped, per §2.4)
   and auto-detonates after a fixed 2s (60-frame) timer, exploding immediately only on direct unit contact;
   it never sticks to anything. Port: `WEAPONS.grenade` (weapons.ts:256-264) has no `bounce` flag at all,
   and `Projectile.ts` special-cases `kind === "grenade"` (Projectile.ts:33, 82-83, 236) to make it
   **stick** to whatever it hits with a `STICK_FUSE` of 25 frames (Projectile.ts:19) — a materially
   different weapon (sticky bomb vs. bouncing timed grenade), and it does not bounce off walls at all
   (any wall touch detonates it immediately, since `bounce` is unset).
3. **Bounce damping constants and bounce-count cap don't match.** Source uses four independent surface
   probes with damping `yVel*=-0.5, xVel*=0.8` (floor/ceiling) and `xVel*=-0.6, yVel*=0.7` (side walls),
   with **no cap on bounce count** — only the `params[3]*30`-frame timer ends an un-triggered shell. Port's
   `doBounce()` (Projectile.ts:272-289) uses a single two-branch damping of `*0.6`/`*0.7` and — more
   importantly — invents a `bounceCount > this.def.bounce` cap (hardcoded to `4` in `projBehavior()`,
   weapons.ts:433) that doesn't exist in the source; a Raze 2 Hail Storm/Particle Cannon shell can bounce
   indefinitely until its 45-frame timer fires, the port's stops after 5 bounces (or the timer, whichever
   first).
4. **Mine proximity test is a distance circle, not the real per-limb hitbox.** Source arms and then tests
   the full `hitTestAll(0,-10,true)` hitbox geometry (§2.1's head/body/crotch boxes) every tick once
   landed, and is **team-aware** (never triggers on a teammate). Port's `mineTick()` (Projectile.ts:306-314)
   uses a flat `UT.getDist(...) < 34` circle via `canHarm()` — functionally similar for FFA but a coarser
   hit shape, and worth confirming `canHarm()` actually reproduces the "unit.team ? … : true" logic (a mine
   with no owning team should trigger on *everyone*, including the placer, per source's `unit.team ? … :
   true` fallback — need to verify this edge case against `canHarm`).
5. **Flamethrower motion is hand-tuned, not param-driven.** Source: `yVel += params[2]*0.1` where
   `params[2] = -2` (i.e. -0.2 px/frame² accel) is the *only* vertical-motion change; horizontal velocity
   is untouched. Port hardcodes `vy -= 0.18; vx *= 0.97` (Projectile.ts:156-157) — a different rise rate and
   an invented horizontal drag with no source equivalent.
6. **Flamethrower lifetime is arbitrary.** Source ties the flame's life to the *authored animation frame
   count* of the `"flame"+variant` sprite (`bitstats.frames`, unknown numeric value — see §6), not a
   distance/`maxDist` check. Port has no animation-driven lifetime concept at all; it falls back to the
   same generic `maxDist`/wall/off-arena rules as every other projectile (Projectile.ts:224-227), which is
   a reasonable stand-in but not sourced from real data.
7. **Splash/direct-hit/mine radii are flat constants, not derived from `stats.splash`/hitbox geometry.**
   Port's splash radius is hardcoded to **90px** (Projectile.ts:362) regardless of the weapon's actual
   `stats.splash` value (source varies 60–120 per weapon, §2.2–§2.7 tables) — e.g. the Rocket Launcher's
   true blast radius is 1200 native-×10 px (`splash:120`) vs. the sniper-class `asniper`'s 600
   (`splash:60`); the port currently applies the same 90px to both (before the port's own ×10-ish world
   scale is accounted for — needs reconciling either way). Direct-hit acquisition (22px) and mine
   proximity (34px) are likewise single magic numbers rather than derived from the boxed hitzones in
   §2.1.
8. **`Bullet_Proj_Bounce`'s per-substep multi-probe collision (4 independent offset checks, can trigger
   several at once) is collapsed to a single directional test** (`vSurface`/`hSurface` via
   `pointInWall` at `-vx`/`-vy`, Projectile.ts:278-282) — a reasonable approximation but not the same
   shape (source probes fixed ±10/±15px offsets in four cardinal-diagonal directions every substep, not
   just once per frame).
9. **`extra.arc` (chain-lightning) is parsed onto `WeaponDef.arc` but never consumed by `Projectile.ts`.**
   Not necessarily a bug (railgun2 is a hitscan/beam weapon, not physically instantiated via `Projectile`),
   but worth confirming the arc-chain behaviour is implemented somewhere in the hitscan/beam path — it is
   out of this file's scope to verify that, flagged here so it isn't silently dropped.
10. **Bullet_Proj_Basic's true per-frame substep count (`params[1]`) isn't reproduced** — the port moves
    once per frame at a flat `speed` derived from `params[1]*10`/4 (Projectile.ts:73), which nets out to
    the same *average* displacement per tick but loses the sub-stepped hit-testing (source tests collision
    up to `params[1]*2` times per tick, so it can catch a thin wall/unit that a single big per-frame step
    would tunnel through at high `params[1]` values like the Burst Torch's 14).

## 5. Implementation checklist (future build phase — do NOT do now)

1. Add a `stickToWall` behaviour to `Projectile.enterFrame`'s wall-collision branch: when `def.stick` and
   the projectile hits a wall (not a unit), freeze position/velocity there (mirroring `Bullet_Proj_Stick`'s
   wall case, §2.5) instead of calling `explode()`, and let the existing fuse countdown (already used for
   unit-sticks) handle detonation uniformly.
2. Split the native `grenade` weapon from the `sticklaunch` weapon's mechanic: give `WEAPONS.grenade` a
   real `bounce` value (Raze 2: unbounded bounces, 60-frame/2s hard timer, `bounceLife: 60`) and remove the
   `kind === "grenade"` special-cased stick behaviour from `Projectile.ts`; let `sticklaunch` (once wired
   as a playable/pickup weapon) use the genuine `stick`+`stickFuse` path from item 1.
3. Replace the single `bounceCount > def.bounce` cap with a pure timer (`bounceLife` already exists; drop
   the count cap or make it optional per-weapon) to match the source's "bounce forever until the timer"
   behaviour; match damping constants exactly: `0.5`/`0.8` (floor/ceiling) and `0.6`/`0.7` (side walls),
   and consider reproducing the four-probe-per-substep shape if wall-tunneling at high speed becomes
   visible.
4. Derive splash/direct/mine radii from `stats.splash` (already available as `def.splashMult`'s sibling —
   plumb the raw `splash` value through from `raze2ToDef`, not just `splashMult`) instead of the flat
   90/22/34px constants; scale by whatever native→port world-unit ratio the rest of the port uses (check
   against how `range` is scaled, `weapons.ts:485`).
5. Reproduce mine's real per-limb hitbox test (reuse whatever hit-box helper the hitscan path already has
   for head/body/crotch/butt zones, §2.1) and confirm/fix its team-exemption logic against `unit.team ?
   hitObject.team != unit.team : true`.
6. Tie flamethrower's vertical accel to `params[2]*0.1` (already captured as `fallSpeed`, just apply it the
   same way Basic/Follow do instead of the hardcoded `-0.18`) and drop the invented `vx *= 0.97` drag
   unless a deliberate design decision keeps it.
7. Once real `bitstats.frames` values for the flame animation are known (§6), wire an animation-frame
   lifetime for `flame` projectiles instead of relying on the generic `maxDist` fallback.
8. Confirm arc-chain (`def.arc`) is implemented in the hitscan/beam resolution path (outside this file) for
   railgun2; if not, port §2.1.3/§2.9's arc-chain algorithm there.
9. Consider sub-stepping high-`speed` projectiles' collision test (2 half-steps per tick, mirroring
   `params[1]`'s substep loop) to avoid tunneling through thin geometry at the Burst Torch's effective
   140px/frame.

## 6. Open questions / data still missing

- **Flamethrower `bitstats.frames`**: the authored frame count of the `"flame0"`/`"flame1"`/…
  idle-animation bitmap clip (from `BH.getBitAniStats`) isn't in any stat table — it lives in the compiled
  sprite-sheet asset data. Needed to give the flame gout its real lifetime instead of the generic
  `maxDist` fallback. Cross-check with doc 03/06 (assets) once that survey runs.
- **Native "Grenade" `range`**: `Stats_Guns` gives it `range: 0` (from `addGun(7,"grenade",...,0,0,0,...)`
  at the `range` argument position) — a thrown/lobbed ability projectile likely uses a fixed toss
  arc/velocity set elsewhere (ability-cast code, not `Stats_Guns`/`Bullet`), not the normal muzzle-velocity
  path documented here. Needs the ability-cast call site (doc 14, Grenade ability) to find the actual
  launch speed/angle if it differs from `Bullet_Proj_Bounce`'s generic `xVel,yVel` from `rotation`.
- **`canHarm()` team-exemption parity for mines**: needs a direct read of `raze-ts/src/game/Match.ts`'s
  `canHarm` to confirm it reproduces `unit.team ? hitObject.team != unit.team : true` (mines with no team
  should threaten *everyone*, including their placer) — not read as part of this survey.
- **World-unit scale reconciliation**: this doc reports all distances/speeds in Raze 2's *native* pixel
  units (before the port's `×10` range conversion, `weapons.ts:485`). A future pass should settle one
  canonical scale (native vs. port-world) across docs 01/02/04 so implementers don't have to re-derive the
  ×10 factor per document.
