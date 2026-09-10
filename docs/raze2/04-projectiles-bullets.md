# 04 — Projectile & Bullet Mechanics (Raze 2)

Source: `decompiled_swf/raze 2/scripts/Bullet.as` (base class) and every
`Bullet_Proj_*.as` / `Bullet_Line_*.as` / `Bullet_Melee_*.as` subclass, plus
`Stats_Guns.as` (per-gun `addGun()` table) and the already-extracted
`raze-ts/src/assets/raze2/weapons.json`.

There is **no `docs/raze2/03-*.md`** in the repo yet (only `INDEX.md` and
`PLAN.md` exist under `docs/raze2/`) — the gun-stat doc this file would
normally cross-reference has not been written. The gun → bullet-class mapping
table in §3 below is authoritative in its place.

Every "bullet" in Raze 2 — hitscan line, homing projectile, mine, melee swing
— is a subclass of the single `Bullet` class. There are **14** concrete
subclasses actually present in the SWF (grepped `scripts/Bullet_*.as`, non
`_2` copies):

| Class | Category | Used by (see §3) |
|---|---|---|
| `Bullet_Proj_Basic` | travelling projectile, gravity, no special behavior | sparkgun, blaster, blood, asniper, sawgun (burrow), rocket, spitter |
| `Bullet_Proj_Bounce` | travelling, bounces off walls, self-detonates after N seconds | pcanon, icegun, grenade, bouncer |
| `Bullet_Proj_Follow` | travelling, homing (steers toward nearest enemy in radius) | plaspistol, alienrifle, arifl2 (+bounceShots), hrocket, hrocket2 |
| `Bullet_Proj_Frames` | travelling, driven by a baked bitmap-animation clip instead of physics-per-frame draw | flamethrower |
| `Bullet_Proj_Mine` | drops straight down, lands, arms, proximity/timer detonates | mine |
| `Bullet_Proj_Stick` | travelling, sticks to first unit/corpse hit, fuse-detonates | sticklaunch (grenade launcher) |
| `Bullet_Line_Basic` | instant hitscan ray, single straight line(s), stops at first hit | pistol, burster, uzi\*(no, see Bend), magnum, shotgun, arifle, laserrifle, chaingun |
| `Bullet_Line_Bend` | instant hitscan, quadratic-bezier "tentacle" line that animates/settles post-hit | uzi, pshotgun |
| `Bullet_Line_Effect` | instant hitscan **beam that pierces** every unit in its path | railgun |
| `Bullet_Line_Electric` | instant hitscan, 3 jittery parallel arcs (visual only — the arc-chain damage logic lives in `Bullet.doHitEffect`'s `stats.extra.arc` branch) | railgun2 |
| `Bullet_Line_Laser` | instant hitscan, continuous jittering double-line beam, 1-frame life | beamer |
| `Bullet_Line_Sniper` | instant hitscan, single line that "lifts"/fades away after impact | mauser, tshotgun, sniper, sniper2, destroyer, icannon, creditsgun |
| `Bullet_Line_Zapper` | instant hitscan, distance-based damage falloff, double-line electric look | zapper |
| `Bullet_Melee_Basic` | instant, very short range, plays a headshot stinger sound | sword (Katana) |

No `Bullet_Proj_Sticky` (it's `Bullet_Proj_Stick`), no `Bullet_Proj_Pierce`,
`Bullet_Proj_Beam`, `Bullet_Proj_Burrow`, `Bullet_Proj_Zapper` classes exist —
those behaviors (pierce, beam, burrow, arc) are implemented as **`stats.extra`
flags** consumed by the shared `Bullet.doHitEffect()` / `hitTestAll()` logic,
not as separate bullet subclasses. See §2.0.

---

## 1. Bullet base class (`Bullet.as`)

### 1.1 Constructor / spawn (`Bullet.as:75-145`)

```
Bullet(game, unit, rotation, x, y, param6(uint "pre-advance steps"), gunId, isProjectile, extra=null)
```

- `dmgMod = extra.dmgMod || 1` (`:88`).
- `stats = Stats_Guns.gunOb[gunId]` (`:89`) — pulls the full per-gun stat block (dmg, range, params[], cls, extra{}...).
- **Range / lifetime**: `maxDist = (extra.range || stats.range) + (fixedDist ? 0 : UT.irand(-3,3))` then `+= unit.equips.range` if the unit has a range-boosting equip, then **`maxDist *= 10`** (`:100-111`). So `stats.range` is stored in "tiles of 10px" and jittered by ±3 tiles (±30px) per shot unless `fixedDist`.
- **Muzzle / spawn offset** (`:113-114`):
  ```as
  x = spawnX + UT.xMoveToRot(rotation + 90*unit.MC.scaleX, stats.yOff)
  y = spawnY + UT.yMoveToRot(rotation + 90*unit.MC.scaleX, stats.yOff)
  ```
  i.e. the bullet's true origin is the aim origin (barrel tip, computed by the
  caller/`Unit`) offset **perpendicular to the aim direction** by `stats.yOff`
  (mirrored by `unit.MC.scaleX`, the unit's facing). `stats.xOff` is not used
  here — it's consumed by the gun-hold/visual code (arm/weapon positioning),
  not by the bullet spawn math.
- **Initial velocity**: `xVel = UT.xMoveToRot(rotation, 10)`, `yVel = UT.yMoveToRot(rotation, 10)` — a unit vector of length 10 along the aim angle (`:120-121`).
- **Pre-advance / muzzle clearance**: loops `param6+1` times, each step moving the bullet half a `xVel/yVel` step and running `hitTestAll()`, breaking early on a hit (`:122-132`). This is how multi-pellet shotguns (`extraShots`) stagger pellet start points along the barrel and immediately catch point-blank hits.
- `ox, oy` = the final spawn point after pre-advance (`:133-140`) — this is what visuals (line origin, muzzle flash) key off.
- Fires `stats.effShoot` at `(ox, oy)` if set (`:141-144`) — the muzzle-flash/shell-eject particle.

### 1.2 Hit resolution — `doHitEffect()` (`:147-482`)

Central damage/impact dispatcher, called by every subclass once a hit is
found (or forced with `param1=true` to force a synthetic "wall" hit, used by
bounce/mine/stick timers).

- **`bounceShots` extra** (`:160-179`): if the gun's `stats.extra.bounceShots`
  is set (Assault Bouncer `arifl2`, `bouncer`), on ANY hit it deals damage
  (if unit) then spawns `bounceShots` copies of the `"bouncer"` gun
  (`Bullet_Proj_Bounce`, radial 360° random angle) from the impact point, and
  removes the original if it was a projectile. This is the "splits into
  embers" behavior.
- **Unit hit** (`hitType=="unit"`, `:180-308`):
  - **Mirror reflect**: if the target has `status.sMirror` and the shot
    doesn't already have `extra.reflect`, the shot bounces back at the
    shooter — computed via `UT.rotBounceOff` and re-spawned as the same
    `stats.cls` aimed at the original shooter with `{reflect: unit}` so it
    can't re-reflect (`:182-200`).
  - Otherwise spawns blood effect (`hitObject.skin.blood`, or `"bloodShield"`
    if `shCur` shielded, or `"bloodRainbow"` in the "lol cats" special mode)
    unless the target is invincible (`:201-211`).
  - Hitscan bullets (`!isProjectile`) back the ray up half a step; projectiles
    back up a full step and are removed unless `stats.extra.pierce` is set
    (`:212-232`) — **this is the actual pierce implementation**, reused for
    both projectile and line/beam classes that set `extra.pierce`.
  - Fires `stats.effHit` (`:233-236`).
  - If `stats.splash` is set, records `extra.hitX/hitY` for `checkSplash()`
    (`:237-241`).
  - Applies direct damage via `hitObject.status.damage(stats.dmg*dmgMod, unit, stats, extra)` (`:242`), where hit-location multipliers
    (`extra.headMult`/`crotchMult`/`buttMult`/`assassin`) were already set by
    `hitTestAll()`'s hit-box checks.
  - **`arc` extra** (railgun2, `:244-307`): if `stats.extra.arc` and not
    `extra.noArc`, scans all other living, non-team units within
    `stats.extra.arc` px of the impact (ignoring walls — "arcs through
    walls"), picks up to **3** targets, and for each spawns a new
    `stats.cls` bullet aimed at them from the impact point with
    `{noArc:true, dmgMod:0.5, ignoreAll:true, range: stats.extra.arc}` — a
    50%-damage chain arc that itself ignores further collision (`ignoreAll`)
    so it always lands.
- **Corpse hit** (`hitType=="corpse"`, `:309-337`): spawns blood, removes
  projectile unless piercing, forwards to `game.physWorld.hitCorpse(...)` for
  ragdoll impulse + splash bookkeeping.
- **Wall hit** (`hitType=="wall"`, `:338-476`): removes projectile unless
  `stats.extra.burrow` (in which case it doesn't get removed — instead
  `extra.burrowMult = 2` and `yVel -= stats.params[2]*0.1`, i.e. it keeps
  moving *through* the ground surface, applying its own gravity term as an
  upward "burrow" nudge, and spawns `"mud_splash"` instead of the normal
  `effHit`). The hex color byte returned by `hitTestAll()` (see §1.3) is then
  switch-cased to per-material behavior: moon dust (`"ffff06"` → tutorial
  achievement check), tutorial wall (`"9900ff"` → `tutShootWall`), plain
  materials (no-op), mud/grass (`"ff0000"`/default → optional
  `mud_splash` "graphics quality" particle), snow (`"ffffff"` →
  `snow_splash`), leaves (`"006600"` → `leaf_splash` + leaf particles +
  `treeShoot` counter → `"ammo"` achievement at 400).
- **`checkSplash()`** (`:715-767`): if `stats.splash>0`, iterates all living
  units within `stats.splash` px of the *bullet's current x/y* (not
  necessarily the impact point for burrow bullets), skips the directly-hit
  unit, skips targets if a wall sits between blast and target (checked with a
  single ray-step of 10px toward the target), and calls
  `status.damage(stats.dmg, unit, stats, extra)` with `extra.splashMult =
  stats.splashMult` — i.e. **splash damage uses `stats.dmg`, scaled inside
  `Status.damage` by `splashMult`, not a separate splash-damage stat.** No
  distance falloff curve is applied in `Bullet.as` itself — falloff (if any)
  lives inside `Status.damage`'s use of `extra.splashIndirect`/`splashMult`
  (out of scope for this doc; see Status doc). `extra.splashDirect` is set by
  `hitTestAll()` when a hit lands in a body region and `stats.splash>=80`,
  presumably to tell `Status.damage` "this was already a direct hit, don't
  double count."

### 1.3 Collision — `hitTestAll()` (`:484-703`)

Called every advance step by all subclasses. Priorities, in order:

1. **Water**: `game.water.inWater(x,y)` triggers a ripple (`startWaveAtPos`).
2. **Wall** (unless `extra.ignoreAll`): reads `game.arena.wall.getPixel32(x,y)`
   (the wall collision **BitmapData**, alpha-channel-coded). A hit requires
   the pixel's alpha byte (`toString(16).substring(0,2)`) to equal `"ff"`
   (fully opaque = solid). The **RGB bytes encode wall material** and are
   returned as the hit "color" string, later switched on in `doHitEffect()`
   (§1.2). `param3` lets callers (bounce) suppress the wall check for a
   sub-probe.
3. **Units**: iterates `game.units`, skipping self and same-team (if
   `unit.team` is truthy). Uses a coarse `UT.inBox(...,50,80)` broad-phase,
   then, depending on `crouching`/`spinning` state, checks stacked hit-boxes
   in order — **head** (`y-80,40,17` standing / `y-60,40,17` crouched) →
   **crotch/butt** (`y-37,40,10` standing / `y-25,40,7` crouched, split by
   which side of the target the shooter is on) → **torso/full body**
   (`y-80,40,80` / `y-60,40,60`) → special **spinning** hitbox
   (`x-25..+25,y-70,50,70`) when the target is spinning fast (`|spinCur|>30`).
   Head/crotch/butt hits set `extra.headMult`/`crotchMult`/`buttMult` from
   `stats.mults[0..2]`, and a headshot from behind sets `extra.assassin`
   too. `stats.splash>=80` on any body hit sets `extra.splashDirect`.
4. **Corpses** (unless `ignoreAll`): checked against `game.physWorld.actors`
   (ragdoll Box2D bodies) with a flat 30px radius circle test.
5. Otherwise `hitType=""`, returns `null` (no hit this step).

`hitTestWall(dx,dy)` (`:705-713`) is the same opaque-alpha check used
standalone by the bounce class to probe 4 offset points around the bullet for
directional wall-reflection.

---

## 2. Per-class mechanics

### 2.0 Behavior flags carried in `stats.extra` (not separate classes)

| Flag | Effect | Consumed in |
|---|---|---|
| `pierce: true` | projectile/beam is not removed/stopped on a unit hit | `Bullet.doHitEffect` `:228,322` |
| `arc: <px>` | on unit hit, chain to up to 3 more nearby units (through walls) at 50% dmg | `Bullet.doHitEffect` `:244-307` |
| `burrow: true` | projectile keeps moving through ground instead of stopping, at 2× dmg mult intent (`burrowMult`) | `Bullet.doHitEffect` `:344-352`, `Bullet_Proj_Basic` gravity term |
| `bounceShots: N` | on any hit, spawn N `"bouncer"` sub-bullets radially | `Bullet.doHitEffect` `:160-179` |
| `setFire: N` | ignites target (fire-DoT strength `N`) — handled in `Status`, not `Bullet` | referenced via `stats.extra.setFire` passed through `extra`/`stats`; damage application is in `Status.damage` |
| `mauser: true` | flags the shot as the Mauser's "embarrassing kill" bonus-credit gun | `Bullet.as:90-97` |

### 2.1 `Bullet_Proj_Basic` (`Bullet_Proj_Basic.as`)

- `isProjectile = true`. Halves `xVel/yVel` right after `super()` (`:17-18`) — the constructor's unit-length-10 velocity becomes length 5 (the actual per-substep travel speed).
- **Gravity/arc**: `yVel += stats.params[2] * 0.1` every frame (`:25`) — `params[2]` is the gun's arc/fall coefficient (e.g. sparkgun `0.5`, rocket `0.5`, sawgun `2`, blood-gun `3`).
- **Per-frame substep loop**: runs `stats.params[1]` sub-steps per `EnterFrame` (e.g. sparkgun 14, rocket 7, sawgun 2, spitter 4) — this both increases effective speed and multiplies visual-trail particle spawns (`game.createEffect(x,y,stats.params[0])` — the travelling sprite/particle key, called every half-step, twice under "graphPart" high quality).
- **Lifetime**: tracked as accumulated absolute-value distance (`countDistX/Y`), removed once Pythagorean distance ≥ `maxDist` (`:59-62`), or if it flies outside the 0–3000 arena bounds (`:63-66`).
- No homing, no bounce, no stick — pure ballistic arc + wall/unit/corpse hit via `hitTestAll()`.

### 2.2 `Bullet_Proj_Bounce` (`Bullet_Proj_Bounce.as`)

- `extra.bounce = 0` counter (`:40`).
- Same gravity term (`stats.params[2]*0.1`) and `stats.params[1]` substeps/frame as Basic.
- **Bounce mechanics** (`:73-113`): after moving, if `hitTestWall(0,0)` is true, probes 4 offsets:
  - `(0,+15)` floor-ish: `yVel *= -0.5`, `xVel *= 0.8`, backs up `y -= yVel*4`.
  - `(0,-15)` ceiling-ish: same y-bounce math.
  - `(10,-10)` / `(-10,-10)` side walls: `xVel *= -0.6`, `yVel *= 0.7`, backs up `x -= xVel*2`.
  - Each bounce increments `extra.bounce`. Restitution: **~0.5–0.6** vertical, **~0.6–0.7** horizontal (asymmetric damping, not a single COR).
- **Lifetime / self-detonate**: `fc` (frame counter) increments every frame; when `fc == stats.params[3]*30` (params[3] is seconds, ×30fps) it force-triggers `doHitEffect(true)` (synthetic wall hit) — e.g. pcanon/icegun `1.5s`, grenade `2s`, bouncer (ember) `1s`.
- Also removed if it exits the 0–3000 arena box.
- No explicit bounce-count cap wired here — bounce count only matters for whatever `Status`/scoring reads `extra.bounce`; the class itself relies purely on the timer to end life. (The port's `Projectile.ts` caps bounce count via `def.bounce` — see §Port status, that's a port-only addition not present in the original.)

### 2.3 `Bullet_Proj_Follow` (homing) (`Bullet_Proj_Follow.as`)

- Halves velocity like Basic; tracks `countDistX/Y` for `maxDist` lifetime same as Basic.
- **Homing steering** (`:46-92`, every frame before moving):
  1. `rotation = UT.getRotation(x,y, x+xVel, y+yVel)` — current heading.
  2. For every living, non-team unit within `stats.params[3]` px (**seek radius**) of the bullet, `rotation += UT.rotateDirection(rotation, angleToTarget) * stats.params[4]` (**turn rate**, applied per-frame, per-qualifying-target — if multiple enemies are in radius each nudges the heading further that frame).
  3. Rebuilds `xVel/yVel = UT.xMoveToRot(rotation,5)/yMoveToRot(rotation,5)` — i.e. **speed is fixed at 5px/substep regardless of turning**.
- Params by gun: plaspistol `["plasmapistol_shot", 2, 0, seekRadius:200, turnRate:7]`; alienrifle `params:null` → falls back to defaults (no seek/turn tuning shown, uses `Object` undefined → effectively `stats.params[3]/[4]` are `undefined`, so `NaN` comparisons fail closed = **no homing effect actually triggers** for alienrifle, a de facto non-homing "Homing"-labeled gun, likely a latent balance bug in the original); hrocket `["gas_sblue",2,1,180,7]`; hrocket2 `["gas_sblue",3,1,180,8]`; arifl2 `["ember",10,1]` (no seek/turn params either — same latent no-op homing, but arifl2 additionally carries `extra.bounceShots:3` so its signature "bounce into embers on impact" behavior still fires via `Bullet.doHitEffect`).
- Substep loop count = `stats.params[1]` (plaspistol/hrocket/hrocket2: 2; arifl2: 10).

### 2.4 `Bullet_Proj_Frames` (flamethrower) (`Bullet_Proj_Frames.as`)

- Not driven by a discrete sprite/particle call per substep like the others — instead it drives a **baked bitmap animation** clip (`BH.getBitAniStats(stats.params[0]+0, "idle")`, e.g. `"flame0"`), picking a random rotation variant `name = params[0] + irand(0, rotAmt-1)` at spawn (`:41-43`).
- Each `EnterFrame`, `frame++` and the class paints the current animation frame directly via `game.bitscreen.paint(x,y,true,name,"idle",frame)` — i.e. **the "bullet" IS the flame sprite's own animation timeline**, not a physics body with a separate visual. Gravity: `yVel += stats.params[2]*0.1` (flamethrower `params[2] = -2`, i.e. **rises** rather than falls — the flame billows upward).
- Hit test only runs once the animation is past `bitstats.frames - stats.params[3]` frames from the end (flamethrower `params[3]=4`) — i.e. **collision is only checked in the tail of the animation**, letting the flame visually engulf its area before it can actually land damage, and removed once `frame > bitstats.frames`.
- `stats.params[1]` substeps per frame (flamethrower: 2).
- Splash-based damage (flamethrower `splash:60, splashMult:0.7`) is what actually spreads the fire to nearby units on hit, per `checkSplash()`.

### 2.5 `Bullet_Proj_Mine` (`Bullet_Proj_Mine.as`)

- `yVel = 0` at spawn — mines are lobbed by the caller with whatever initial velocity `Bullet`'s ctor gave them (unit-length-10 vector along aim angle at drop), and only gravity moves them after.
- **Drop phase**: `hitWall=false` until `hitTestWall(0,8)` (footprint 8px below) is true. While falling, `yVel += 2`/frame capped at `15`, `y += yVel` (`:70-84`).
- **Landing**: once it detects ground, it steps back up out of the wall pixel-by-pixel (`while hitTestWall(0,8) && iter<100: y -= 3`) to settle exactly on the surface (`:47-56`), then `hitWall = true` — from here it's a **static** proximity mine, no further movement.
- **Arming visual**: every frame paints `bitscreen` sprite `"mine0"` with state `"off"` (falling, or not yet blinking), or blinking `"team"`/`"on"` at a `fc/2 % 2` (visible ~every other 2 frames once armed) — `"team"` if `unit.human || unit.team==1`, else `"on"` (`:61-69`).
- **Trigger**: once landed, every frame re-probes `hitTestAll(0,-10,true)` (10px above itself, ignoring the wall check per the `param3=true` arg) for a **unit or corpse**. It detonates (`doHitEffect(true)`) if it hits an enemy unit (`hitObject != unit` and, if teams are on, different team) **OR** its lifetime `fc == stats.params[0]*30` elapses — mine's own `params:[30]` = **30-second fuse/lifetime**.
- `removeMe()` is overridden to just set `remove=true` (no functional difference from base — likely present to guard against a subclass-specific cleanup that was never needed).
- No stated trigger *radius* beyond the shared `hitTestAll` unit hit-box tests (crotch/head/body boxes ~40×80px) probed 10px above the mine's position — so effectively "unit standing on/near the mine."

### 2.6 `Bullet_Proj_Stick` (grenade launcher) (`Bullet_Proj_Stick.as`)

- Flies ballistically (gravity `stats.params[2]*0.1`, `stats.params[1]` substeps/frame — sticklaunch `params:["chain_fire",3,3,1]` → 3 substeps, gravity coefficient 3) until `hitTestAll()` returns a hit.
- **Stick-to-what**: on hit, if `hitType=="unit"`, records the offset from the unit's origin (`xOff = x - hitObject.x`, `yOff = y - hitObject.y`) so it rides along with that unit every frame after; if `hitType=="corpse"`, records offset from the ragdoll's `userData.x/y` and sets `extra.corpseStick = true`.
- **While stuck** (`:80-114`): re-parents its position to `hitObject.x/y + xOff/yOff` each frame (or the corpse's body position). If the stuck unit uses the `"static"` ability and is mid-`abilityPause` (a freeze/block ability), the grenade detonates immediately (`doHitEffect()`, no `true` arg — i.e. **not forced**, meaning if `hitType` was already a valid hit it still resolves as a normal hit) — this is a "can't cheese a stuck grenade with your invuln ability" rule. If the stuck-to unit dies while carrying it, it re-parents onto the resulting corpse (`hitObject = hitObject.dead`, `hitType="corpse"`, `extra.corpseStick=true`).
- **Fuse**: `fc` increments every frame while stuck; detonates (`doHitEffect()`) once `fc == stats.params[3]*30` — sticklaunch `params[3]=1` → **30-frame (1s) fuse** after sticking.
- Continuously spawns `stats.params[0]` particle (`"chain_fire"`) at its current position every frame regardless of stuck state — a persistent glow/spark trail.

### 2.7 `Bullet_Line_Basic` (`Bullet_Line_Basic.as`)

- **Instant hitscan**: constructed with `isProjectile=false`... actually passes `true` as 8th ctor arg (`Bullet_Line_Basic.as:18` → `super(...,true,...)`), then in its own constructor body advances up to `maxDist/10` steps calling `hitTestAll()` each step and breaking on hit, i.e. it resolves fully **inside the constructor** (single frame) rather than over multiple `EnterFrame` calls — `EnterFrame()` is a no-op (`:84-86`). This makes it visually instantaneous.
- `curDist = round(dist(ox,oy,x,y))` — the actual line length drawn.
- **Multi-segment scatter path** (`stats.params[0] === true`): if the gun's first param is `true` (pistol, shotgun, arifle, chaingun all set `true`), the drawn line is chopped into **random dash segments**: starting at a random offset `irand(0,100)`, pushes a `Point` every `irand(50,250)` px along the ray up to `curDist`, alternating `moveTo`/`lineTo` — producing a **dashed tracer** look rather than one continuous line. If `params[0]` is falsy (magnum, laserrifle), it draws one continuous line from `ox,oy` to `x,y`.
- **Line style layers**: iterates `(params.length-1)/3` style passes, each consuming a `(width, color, alpha)` triplet starting at `params[1]` — i.e. up to two concentric strokes (an outer glow + inner core), e.g. pistol: pass 1 `width 3.5, color 0xFFFFC4, alpha 0.3`; pass 2 `width 1.5, color 0xFFFFC4, alpha 0.6` (same hex, layered translucency = soft glow around a brighter core).
- Removed immediately after drawing (single-frame line; no fade-out — contrast with `Bullet_Line_Sniper`/`_Effect` which persist and fade).

### 2.8 `Bullet_Line_Bend` (`Bullet_Line_Bend.as`)

- Resolves the ray the same way (advance-until-hit in ctor) but is spawned with `isProjectile=false` (5th ctor param) properly this time (`:47`).
- **Curve geometry**: computes `mid` (ray midpoint), `mid1`/`mid2` (quarter points), then a **single random 2D offset** `rand(-50,50)` applied as `mid1to = mid1 + offset`, `mid2to = mid2 - offset` (mirrored) — the two bezier control-point *targets* the curve animates toward.
- Initial draw is a **quadratic double-curve** (`curveTo(mid1, mid) then curveTo(mid2, end)`) starting straight (control points = the actual midpoints, not yet offset).
- **`EnterFrame`** (`:101-121`): each frame, `mid1`/`mid2` lerp 10% toward their `to` targets (`+= (to - cur)*0.1`) — so the line visibly **whips/bends** into an S-curve over ~10-15 frames — while `alpha -= 0.1` fades it out over 10 frames, then `removeMe()`. This is the "gooey tentacle" look (used by uzi, pshotgun).
- Same 2-pass line-style-triplet system as `Line_Basic`.

### 2.9 `Bullet_Line_Effect` (piercing beam — railgun) (`Bullet_Line_Effect.as`)

- Advances up to `maxDist/10` steps; **on each hit**, if `stats.extra.pierce` is NOT set it stops at the first hit (`doHitEffect()` then implicit break via the loop's own hit consumption); if pierce **is** set (railgun always sets `extra.pierce:true`), it keeps advancing through the same target only once (`hitObjects` array dedupes so a target isn't repeatedly damaged as the ray "sits" one more step inside their hitbox), and stops entirely only on a non-unit/non-corpse hit (i.e. a wall) or if the hit unit has `sMirror` (mirror reflect isn't compatible with a multi-hit pierce ray, so it stops there) (`:60-91`).
- `cleanExtra()` is called after each pierced hit — resets `extra` to just `{corpseStick, reflect}`, clearing any accumulated `headMult`/`splashDirect`/etc. so each subsequent pierced target gets a fresh, independent hit-location roll next `hitTestAll()` call.
- Draws a single straight `ox,oy → x,y` line (no dashing) with the params triplets, then in `EnterFrame` **fades it out** (`alpha -= 0.03`, ~33 frames ≈ 1.1s) while a **traveling spark** effect (`toX/toY`, `stats.params[0]` = `"chain_fire"`) chases from the origin to the impact point at `xVel*3/frame` speed, visually "catching up" to where the beam already landed — this is the railgun's signature travelling-spark-along-a-static-beam effect.
- Removed once both the line has fully faded (`alpha<=0`) and the chase-spark has caught up (`toDist<=30`).

### 2.10 `Bullet_Line_Electric` (railgun2 arc gun) (`Bullet_Line_Electric.as`)

- Advances to first hit like Basic (no pierce logic of its own — the actual chain-to-3-enemies "arc" behavior is `stats.extra.arc` handled centrally in `Bullet.doHitEffect`, §1.2/§2.0; this class is purely the **visual**).
- Builds **3 independent jittered polylines** (`line1/2/3Path`) sampled every 30px along the ray, each point carrying a random `"lift"` value in `[-0.3, 0.3]` (or halved to `[-0.2,0.2]`-ish; actual range is `rand(-0.3,0.3)`, applied `*10` once at spawn if `stats.params[0]` truthy — railgun2's `params[0]=true`, so points get an initial random 0-10px scatter perpendicular-ish jitter).
- 3 line-style triplets are used (railgun2 `params` has **9** entries = 3 triplets: width 3.5/color 0x00CCFF/alpha 0.4, width 2.5/color 0x0099FF/alpha 0.5, width 1.5/color 0xCCFFFF/alpha 0.4) — layered core+glow+highlight across all 3 paths.
- **`EnterFrame`**: each path point's `x/y += lift` every frame (continual drift, not lerp-to-target like Bend) and `alpha -= 0.03`; removed when `alpha<=0` (~33 frames).

### 2.11 `Bullet_Line_Laser` (continuous beam — beamer/Focus Beam) (`Bullet_Line_Laser.as`)

- Advances to first hit in the constructor, building **two parallel jittered point lists** (`line1`, `line2`) with per-point `rand(-1,1)` jitter baked in at creation.
- **`EnterFrame`** draws both lines (2 style pairs: `params[0-2]` = width 8/color 0x66CC00 (0x6736896? recompute)/alpha 0.5 and `params[3-5]` = width 4/color/alpha 0.8), re-jittering every point by another `rand(-1,1)` every frame (constant "electric shimmer"), then **immediately calls `removeMe()`** — i.e. **this instance only ever renders one frame**. Since the gun (`beamer`) autofires every `shootDelay=0.05s` (≈ every 1-2 frames) with `soundFrames:16` continuous-fire sound handling, the *appearance* of a sustained beam is produced by re-spawning a fresh single-frame `Bullet_Line_Laser` every tick the trigger is held, not by one persistent beam object.
- No fade — pops in and out at full alpha every frame it's re-fired.

### 2.12 `Bullet_Line_Sniper` (`Bullet_Line_Sniper.as`)

- Advances to first hit; builds one jittered polyline sampled every 30px, `"lift"` range `[-0.2,0.5]` if `params[0]` true, else `[-0.2,0.2]` (mauser/tshotgun/sniper2/creditsgun use `false`/no-lift-boost; sniper/destroyer/icannon use `true`).
- Draws with the style-triplet system (1-2 passes depending on params length: 7 entries = 1 pass + base = actually `(7-1)/3=2` passes) using `moveTo`/`lineTo` per point (continuous, not dashed).
- **`EnterFrame`**: each point's `y -= lift` (rises/drifts upward like heat shimmer or smoke), `alpha -= 0.03` (~33-frame fade), redraws every frame until `alpha<=0` → `removeMe()`.
- This is the most common "beefy single-shot line" class — used for the whole sniper family, the Mauser, Terminator/Ion Cannon shotguns-that-fire-lines, and the Credit Cannon.

### 2.13 `Bullet_Line_Zapper` (`Bullet_Line_Zapper.as`)

- Advances toward `maxDist`, but **keeps going even after a hit is found** in its own scan loop is NOT true — actually it does `break` on `hitObject = hitTestAll()` like the others (`:62-68`), so it stops at first hit; it just doesn't call `doHitEffect` mid-loop, deferring to after the loop.
- **Damage falloff formula** (`:70-71`, computed once, before `doHitEffect`):
  `dmgMod = (maxDist - curDist) / maxDist * 1.5 + 0.5` — ranges from **0.5×** at max range down to **2.0×** at point-blank (`curDist≈0`), i.e. the "up to 2x damage up close" described in the gun's own tooltip. This is a straight linear falloff over the gun's max range (`stats.range*10`, zapper `range:20` → `maxDist≈200px` before jitter).
- **No-hit case**: if nothing was hit (shot into empty space/max range), jitters every point of both line arrays by `rand(-i,i)` (increasing jitter the farther along the line) for a more chaotic "fizzled out" look, `alpha=0.8`, `strength=1.7`.
- **Hit case**: `strength = ((maxDist-curDist)/maxDist + 0.1) * 5` — thicker/brighter line the closer the hit (0.5 at max range up to 5.5 point-blank).
- **`EnterFrame`**: draws two lines every frame — outer `width 3*strength, color 0xCC00FF (13369599), alpha*0.5` and inner `width 2*strength, color 0x9900FF (10027263), alpha*1` — with continuous `rand(-1,1)` per-point jitter (same "single frame then remove" pattern as `Line_Laser`; zapper autofires at `shootDelay:0.05`, `soundFrames:9`, so a held trigger looks like a sustained crackling laser made of back-to-back single-frame zaps).

### 2.14 `Bullet_Melee_Basic` (Katana) (`Bullet_Melee_Basic.as`)

- Advances to `maxDist/10` steps (sword `range:7` → `maxDist≈70px` before jitter — a very short hitscan "swing" reach) via the same `hitTestAll()` loop, entirely inside the constructor.
- On a unit or corpse hit, plays one of 3 random headshot stinger sounds (`S_Headshot1/2/3`) **regardless of where it actually hit** (flavor sound, not a real headshot check) via `UT.randEl(...)`.
- Calls `doHitEffect()` then immediately `removeMe()` — no visuals of its own beyond whatever `stats.effShoot`/`effHit` particles the base class fires (Katana's gun entry has all effect keys empty, so it is functionally silent/invisible aside from the swing weapon-arm animation, which lives outside `Bullet`).

---

## 3. Gun → bullet-class mapping

Source: `raze-ts/src/assets/raze2/weapons.json` (already extracted 1:1 from
`Stats_Guns.as` `addGun()` calls). `type` = weapon-slot tier (0 pistol … 6
heavy, 7 = ability/environment-spawned, not player-selectable). Colors are
computed from the literal `params` decimal color ints
(`printf "%06X" <int>`).

| type | id | name | cls | params (bullet-specific) | dmg | splash / mult | range | notes |
|---|---|---|---|---|---|---|---|---|
| 0 | pistol | M9 Barret | Line_Basic | `[true,3.5,0xFFFFC4,0.3,1.5,0xFFFFC4,0.6]` | 12 | – | 60 | crotch mult 2× |
| 0 | plaspistol | Plasma Pistol | Proj_Follow | `["plasmapistol_shot",2,0,200,7]` | 10 | – | 45 | seek 200px, turn 7 |
| 0 | burster | Ripper | Line_Basic | `null` | 4 | – | 30 | `extraShots:1` (2 pellets) |
| 0 | mauser | Golden Mauser | Line_Sniper | `[true,1.5,0xFFFF00,0.3,0.5,0xFFFF00,0.6]` | 9 | – | 45 | `extra.mauser` bonus-credit flag |
| 1 | uzi | Uzi | Line_Bend | `[true,1.5,0xFFFFC4,0.3,0.5,0xFFFFC4,0.6]` | 12 | – | 38 | |
| 1 | magnum | Magnum | Line_Basic | `[false,5.5,0xFFFFC4,0.3,1.5,0xFFFFC4,0.8]` | 25 | – | 60 | continuous line, not dashed |
| 1 | sparkgun | Burst Torch | Proj_Basic | `["ember",14,0.5]` | 10 | splash 60, mult 0.1 | 70 | `extra.setFire:1` |
| 1 | blaster | Photon Blaster | Proj_Basic | `["photon_shot",7,0.5]` | 4 | – | 50 | `extraShots:2` (3 pellets) |
| 1 | blood | Vamp Charger | Proj_Basic | `["blood_shot",4,3]` | 9 | – | 60 | lifesteal (Status-side) |
| 2 | shotgun | Shotgun | Line_Basic | `[true,3.5,0xFFFFC4,0.3,1.5,0xFFFFC4,0.6]` | 22 | – | 23 | `extraShots:4` (5 pellets) |
| 2 | pshotgun | Plasma Shot | Line_Bend | `[true,5.5,0x9999FF,0.3,2.5,0xDD6AEA,0.7]` | 7 | – | 28 | `extraShots:2` (3 pellets) |
| 2 | zapper | Zapper | Line_Zapper | `[]` | 3.5 | – | 20 | distance falloff 0.5×–2× |
| 2 | tshotgun | Terminator | Line_Sniper | `[false,3.5,0xFFCC66,0.2,1.5,0xFFCC66,0.3]` | 15 | – | 43 | `extraShots:3` (4 pellets) |
| 2 | pcanon | Particle Cannon | Proj_Bounce | `["ember",4,3,1.5]` | 10 | – | 23 | `extraShots:4`, `setFire:0.5`, 1.5s life |
| 3 | arifle | Assault Rifle | Line_Basic | `[true,3.5,0xFFFFC4,0.3,1.5,0xFFFFC4,0.6]` | 9 | – | 80 | port's native "rifle" |
| 3 | alienrifle | Bubble Blaster | Proj_Follow | `null` | 8 | – | 60 | **params null → no seek/turn tuning (latent no-homing bug)** |
| 3 | laserrifle | Precision Laser | Line_Basic | `[false,3.5,0x69E058,0.4,1.5,0xFFFFFF,0.9]` | 7 | – | 70 | crit mults 2.7/2.5/2.5 |
| 3 | icegun | Hail Storm | Proj_Bounce | `["snow_fall",4,3,1.5]` | 9.5 | – | 90 | 1.5s life |
| 3 | arifl2 | Assault Bouncer | Proj_Follow | `["ember",10,1]` | 5 | – | 45 | `bounceShots:3`,`setFire:0.5`; **params has no seek/turn (no-op homing)** |
| 4 | sniper | .50 Cal Sniper | Line_Sniper | `[true,3.5,0xCCCCCC,0.3,1.5,0xEEEEEE,0.6]` | 45 | – | 300 | head mult 2.5× |
| 4 | railgun | Railgun | Line_Effect | `["chain_fire",5.5,0xDB0202,0.6,2.5,0xFFFFFF,0.8]` | 55 | – | 300 | `pierce:true` |
| 4 | asniper | Pulsator | Proj_Basic | `["plasma_shot",8,0.5]` | 70 | splash 60, mult 1 | 300 | |
| 4 | sniper2 | Holy Grail | Line_Sniper | `[false,7,0xFFCC00,0.2,4,0xFFCC00,0.3]` | 110 | – | 300 | `setFire:0.5` |
| 4 | railgun2 | Electro Bolt | Line_Electric | `[true,3.5,0x00CCFF,0.4,2.5,0x0099FF,0.5,1.5,0xCCFFFF,0.4]` | 45 | – | 300 | `arc:400` (chains to 3) |
| 5 | chaingun | Laser Minigun | Line_Basic | `[true,3.5,0xDB0202,0.6,1,0xFFFFFF,0.8]` | 3.5 | – | 50 | `useAmmo:0.5` (half-ammo-per-shot) |
| 5 | sawgun | Shredder | Proj_Basic | `["saw_shot",2,2]` | 40 | – | 300 | `burrow:true` |
| 5 | beamer | Focus Beam | Line_Laser | `[8,0x66CC00,0.5,4,0x96C001,0.8]`* | 3 | – | 50 | continuous re-fire beam, `soundFrames:16` |
| 5 | destroyer | Destroyer | Line_Sniper | `[true,6.5,0xDB0202,0.8,4.5,0xFFFFFF,0.8]` | 26 | – | 60 | |
| 5 | flamethrower | Flamethrower | Proj_Frames | `["flame",2,-2,4]` | 2 | splash 60, mult 0.7 | 50 | rises (`yVel-=2*0.1`), `setFire:3` |
| 6 | rocket | Rocket Launcher | Proj_Basic | `["gas_small",7,0.5]` | 112 | splash 120, mult 0.9 | 70 | |
| 6 | icannon | Ion Cannon | Line_Sniper | `[true,8.5,0xFFCC00,0.5,3.5,0xFFFFC4,0.6]` | 65 | splash 120, mult 0.8 | 90 | `setFire:0.5` |
| 6 | sticklaunch | Grenade Launcher | Proj_Stick | `["chain_fire",3,3,1]` | 40 | splash 100, mult 0.7 | 60 | 1s fuse |
| 6 | hrocket | Ice Hunter | Proj_Follow | `["gas_sblue",2,1,180,7]` | 45 | splash 120, mult 0.6 | 70 | seek 180, turn 7 |
| 6 | spitter | Acid Hound | Proj_Basic | `["gas_med",4,4]` | 30 | splash 100, mult 0.4 | 60 | |
| 6 | creditsgun | Credit Cannon | Line_Sniper | `[true,7.5,0x006699,0.5,2.5,0x66CCFF,0.6]` | 30 | splash 60, mult 0.5 | 55 | `useCredits:4` (drains currency, not ammo) |
| 6 | hrocket2 | Frozen Death | Proj_Follow | `["gas_sblue",3,1,180,8]` | 30 | splash 120, mult 0.6 | 75 | seek 180, turn 8 |
| 7 | sword | Katana | Melee_Basic | `[]` | 75 | – | 7 | ability-granted melee |
| 7 | grenade | Grenade | Proj_Bounce | `["grenade",3,3,2]` | 45 | splash 79, mult 0.7 | 0 | thrown ability, 2s life |
| 7 | mine | Land Mine | Proj_Mine | `[30]` | 55 | splash 79, mult 0.7 | 0 | 30s fuse/lifetime |
| 7 | bouncer | Assault Bouncer (sub) | Proj_Bounce | `["ember",1,5,1]` | 10 | – | 0 | spawned by `bounceShots` extra, 1s life |

\* `beamer` color ints `6736896`/`9882625` → hex `0x66CC00`/`0x96CC01` (recomputed: `6736896=0x66CC00`, `9882625=0x96CC01`).

Not in this table: `type 7` `env`/`fire` (`cls:null`, non-bullet damage-over-time/environmental hazard entries, not fired bullets).

---

## 4. Visual design summary

Two distinct visual systems are in play:

- **Line/beam classes** (`Line_*`) draw their own vector strokes at runtime
  using the literal `(width, color, alpha)` triplets in `stats.params` — §3's
  table gives the exact hex core/glow colors per gun. No external sprite
  asset is used for the bolt itself; only the muzzle flash (`effShoot`) and
  impact (`effHit`) are separate particle/effect symbols.
- **Projectile classes** (`Proj_*`) render via `game.createEffect(x, y,
  stats.params[0])` every substep (or, for `Proj_Frames`, via
  `game.bitscreen.paint(..., name, "idle", frame)` — a baked bitmap
  animation). `stats.params[0]` is a **string key** into the effect/particle
  library (`Effect.as`/`Particle.as`/`BH.as`), e.g. `"ember"`, `"plasma_shot"`,
  `"saw_shot"`, `"gas_sblue"`, `"snow_fall"`, `"chain_fire"`, `"blood_shot"`,
  `"photon_shot"`, `"gas_med"`, `"flame"`, `"grenade"`. **These are compiled
  MovieClip/bitmap symbols in the SWF library, not literal AS color
  constants** — grepping `scripts/*.as` and `symbolClass/symbols.csv` for
  these names found no top-level linkage class or inline hex color (only
  `Stats_MapParticles.as` uses `"ember"` as a decorative map particle, unrelated
  to the bullet visual). Getting their exact fill hex requires an FFDec shape
  export of the relevant `DefineSprite_*`/image asset (not attempted here —
  out of scope for a script-only read; flagged in Port status).
- **Muzzle/spawn offset**: every bullet's true origin is
  `barrelPoint + perpendicular(aimAngle) * stats.yOff` (see §1.1) — per-gun
  `yOff` values are in `weapons.json` (`xOff`/`yOff` fields), e.g. pistol
  `yOff:0`, rocket `yOff:-5`, chaingun `yOff:7`, sawgun `yOff:10`. `xOff` is a
  separate hand/weapon-hold visual offset (barrel length along the aim axis),
  not consumed by `Bullet.as`.
- **Sizes/frame counts**: not encoded in `Stats_Guns.as` at all — they live
  inside the referenced `BH`/`Effect` bitmap-animation definitions
  (`bitstats.frames`, `bitstats.rotAmt` for `Proj_Frames`) or the sprite's own
  authored dimensions for `Proj_Basic`/`Proj_Bounce`/etc. Not extractable from
  the `.as` scripts alone.

---

## Port status

**Correct**

- Ballistic arc (gravity term), wall/floor collision, and basic direct-hit
  damage for `Proj_Basic`-style weapons (`Projectile.ts:129-181`).
- Homing steer-toward-nearest-enemy-in-radius concept
  (`Projectile.steerHoming`, `Projectile.ts:205-226`) — directionally matches
  `Bullet_Proj_Follow`'s per-frame nudge-toward-target model, though the port
  uses a single best-target + clamped turn each frame rather than Raze 2's
  "every qualifying target nudges the heading" accumulation.
- Bounce-then-detonate lifecycle (`doBounce`/`bounceCount`/`bounceLife`,
  `Projectile.ts:173-176,229-246`) captures the "bounce N times or expire
  after T frames" shape of `Bullet_Proj_Bounce`.
- Sticky-then-fuse lifecycle for the grenade launcher/native grenade
  (`stickTo`/`fuse`, `Projectile.ts:196,273-283`) matches `Bullet_Proj_Stick`.
- Splash damage with linear distance falloff on explosion
  (`Projectile.explode`, `Projectile.ts:288-312`) is a **reasonable
  simplification** of `checkSplash()` — note Raze 2 itself has **no
  falloff curve in `Bullet.as`** (flat `stats.dmg` to everyone in radius,
  scaled only by `splashMult` inside `Status.damage`); the port's `(1 -
  d/radius)` falloff is a port-only addition, not a 1:1 port of the original
  formula. Worth a comment/flag if exact-parity matters later.
- Gun → projectile-class dispatch (`weapons.ts` `projMotion`/`projBehavior`)
  correctly special-cases `Bullet_Proj_Follow/Bounce/Stick/Mine/Frames` vs.
  default `Proj_Basic`, and pulls gravity from `params[2]` for Basic — matches
  §2.1–2.6.

**Wrong / incomplete**

- **Homing turn rate is hardcoded** to `0.13` for every `Bullet_Proj_Follow`
  gun (`weapons.ts:243`) regardless of `stats.params[4]` (plaspistol=7,
  hrocket=7, hrocket2=8 — these are per-frame **degrees**, not radians, in
  the original; the port's constant doesn't scale with the source data at
  all). Seek radius IS read from `params[3]` correctly.
- **Mine trigger has no explicit radius constant tied to source** — port uses
  a flat `34px` (`Projectile.ts:269`) vs. Raze 2's actual hitbox-based test
  (§2.5); close enough visually but not derived from `stats`.
- **Bounce restitution is a single flat 0.6/0.7** pair
  (`Projectile.ts:232-239`) vs. Raze 2's asymmetric per-surface values
  (vertical ~0.5, horizontal ~0.6-0.8 depending on hit direction, §2.2).
- **`Bullet_Line_*` hitscan/beam classes have no dedicated port module** —
  `weapons.ts` only derives `rayType: "hitscan" | "spread" | "beam"` labels
  and hands off to whatever ray-casting code renders those (not
  `Projectile.ts`, which is projectile-only). This doc doesn't cover that
  ray-casting implementation; if it exists it should be audited separately
  against §2.7–2.13 (dashed vs. continuous line style, bend/curve animation,
  pierce-with-dedup, arc-chain-to-3, zapper's distance-based dmgMod curve,
  laser/zapper's single-frame-repeated-fire illusion). Nothing in the current
  `Projectile.ts` reproduces the bend curve, the electric 3-line jitter, the
  chase-spark-along-beam effect, or the zapper falloff formula
  `(maxDist-curDist)/maxDist*1.5+0.5`.
- **`Proj_Frames` (flamethrower) has no bitmap-animation equivalent** — the
  port's `projMotion` maps `Bullet_Proj_Frames` to a generic straight-line
  `speed:4, fallSpeed:0` (`weapons.ts:225`) with no note of the *actual*
  behavior: rising flame, tail-only hit window, and animation-driven
  lifetime (§2.4). Not reflected in `Projectile.ts` at all (no "flame" kind
  in its `kind` union, `Projectile.ts:33`).
- **`burrow` (sawgun) and `arc`-chain (railgun2) and `bounceShots`
  (arifl2/bouncer) extras are entirely unimplemented** — no equivalent
  fields exist on `WeaponDef` or logic in `Projectile.ts`/hitscan code for
  "keep moving through ground," "chain to 3 nearby enemies through walls,"
  or "spawn N sub-bullets on impact."
- **Wall-material color dispatch** (moon/tutorial/snow/leaf special-case
  effects + achievements, §1.2 wall-hit switch) has no described equivalent;
  out of scope for `Projectile.ts` alone but worth flagging for whichever
  system owns wall-impact effects/achievements in the port.
- **Mirror-reflect-shot-back** and **pierce-with-per-target-hitbox-reroll**
  (`cleanExtra()`) are not present anywhere in `Projectile.ts`.

**Missing entirely**

- No port representation of `Bullet_Line_Zapper`'s falloff-based `dmgMod`,
  `Bullet_Line_Effect`'s chase-spark visual, `Bullet_Line_Electric`'s 3-path
  jitter, or `Bullet_Line_Bend`'s animated bezier "tentacle."
- No `setFire` ignition-DoT hookup visible from the `Bullet`/`Projectile`
  layer (may live correctly in `Status`/`Unit` — not checked, out of scope
  for this doc, flagged for the Status/DoT doc to confirm).
- No mapping at all yet for the 30 non-native Raze 2 guns' bullet-specific
  quirks beyond the generic `projMotion`/`projBehavior` switch — e.g.
  `alienrifle`'s and `arifl2`'s **actual** no-op homing (missing seek/turn
  params in the original) is not reproduced; the port instead gives them a
  working homing behavior via the hardcoded `0.13` turn + `paramNum(...,
  3, 180)` fallback radius, which is a **behavioral divergence** from the
  original (better gameplay, but not accurate to source).
