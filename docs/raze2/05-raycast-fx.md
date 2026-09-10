# 05 — Raycast / Tracer / Muzzle / Impact FX

Source: `decompiled_swf/raze 2/scripts/Bullet*.as`, `Game.as`, `Effect.as`, `BH.as`,
`Stats_Guns.as`. Effect artwork lives in the embedded `_assets/assets.swf`
(`scripts/_assets/assets.swf`, `DefineSpriteTag spriteId="1809"`, the class `BH`
embeds it at `BH.as:30`); colors below for the pre-rendered effects were pulled
from that sprite's per-frame `GLOWFILTER`/`colorTransform` tags via
`ffdec -swf2xml`, cross-referenced against frame labels (`gas_small`,
`bloodHuman`, ...). Frame/line numbers cited below are all in the decompiled
`.as` files unless noted otherwise.

## 1. Why the tracer looks "half-missing" — root cause

This is **not** a bug in the decompile, it is exactly what the original code
draws. Two independent mechanisms combine to produce it:

1. **The line container is wiped every single logic tick**, before bullets are
   asked to redraw (`Game.as:235`, inside `EnterFrame`, called *before* the
   `bullets[i].EnterFrame()` loop at `Game.as:256-259`):
   ```
   lineCont.graphics.clear();
   ```
   `game.lineCont` (`Game.as:59`, instantiated `Game.as:139`, added to
   `arena.midCont` at `Game.as:153`) is a single shared `Shape` that **every**
   tracer bullet draws into. Anything drawn to it during a bullet's own
   `EnterFrame()` (or constructor, for the shot that just fired) survives to
   be rendered for exactly one frame (1/30s at the game's frame rate), then is
   erased before the next tick's bullets get a chance to redraw — *unless*
   that specific bullet class's `EnterFrame()` re-issues the draw calls itself
   every tick (several do, with a fading `alpha`; see the class table below).
   For classes whose `EnterFrame()` is empty (`Bullet_Line_Basic.as:84-86`) or
   which call `removeMe()` at the end of their one and only draw
   (`Bullet_Line_Laser.as:102`, `Bullet_Line_Zapper.as:130`), **the tracer is
   a single-frame flash and nothing more** — most weapons in the game
   (pistol, shotgun, assault rifle, mauser, terminator shotgun) fall in this
   bucket.

2. **`Bullet_Line_Basic` intentionally dashes the line it draws**
   (`Bullet_Line_Basic.as:32-45`), when `stats.params[0]` is `true`:
   ```as3
   _loc9_ = uint(UT.irand(0,100));           // random start offset 0-100px
   while(_loc9_ < curDist) {
     linePath.push(new Point(ox + UT.xMoveToRot(rotation,_loc9_),
                              oy + UT.yMoveToRot(rotation,_loc9_)));
     _loc9_ += UT.irand(50,250);             // random gap 50-250px to next point
   }
   ```
   then draws it (`:60-81`) by walking `linePath` and **alternating**
   `moveTo`/`lineTo` on every point (`newLine = !newLine` each iteration):
   point 0 is a `moveTo` (pen up), point 1 is a `lineTo` (draws a segment from
   0→1), point 2 is a `moveTo` again (pen lifts, no segment 1→2), point 3 is a
   `lineTo` (draws 2→3), etc. Because the points themselves are already
   spaced 50-250px apart at random, half of those already-sparse segments are
   *also* skipped by the pen-up/pen-down alternation — the net result is a
   scattered run of short drawn dashes separated by two kinds of gaps (the
   natural point spacing, doubled up by every other segment never being
   stroked at all). When `stats.params[0]` is `false` (used by the "Headshot"
   pistol / Terminator shotgun via `Bullet_Line_Sniper`, see below, not
   `Bullet_Line_Basic`), the fallback path is a single `Point(ox,oy)`, i.e. a
   single dash-less segment from origin straight to the hit point.

   Combined with (1), the common-case tracer (pistol/shotgun/rifle) is:
   **a randomly-dashed line, visible for one 1/30s frame, then gone** — by
   design, not an oversight. It reads as a "muzzle-flash-to-impact streak"
   rather than a persistent laser beam.

## 2. Bullet class hierarchy relevant to raycasts

`Bullet.as` is the shared base (`decompiled_swf/raze 2/scripts/Bullet.as`):
constructor advances the shot origin a few px forward of the muzzle
(`:112-121`), then for hitscan subclasses the *subclass* constructor marches
`x/y` forward in 10px steps (`xVel/yVel` normalized to 10px/tick) up to
`maxDist` calling `hitTestAll()` each step (`Bullet.as:484-703`; wall pixel
test via `game.arena.wall.getPixel32`, then per-unit hitbox boxes, then
corpse ragdolls). `doHitEffect()` (`Bullet.as:147-482`) fires the impact
effect/sound/damage once a hit (or max range) is found. All of the
`Bullet_Line_*` classes below extend `Bullet` and pass `isProjectile=false`
(or `true` for `Basic`) to the super constructor; they differ only in how
they *draw* the ray, not in how it hit-tests.

| Class | File | Used by (from `Stats_Guns.as`) | Redraws every frame? | Lifetime |
|---|---|---|---|---|
| `Bullet_Line_Basic` | `Bullet_Line_Basic.as` | pistol, shotgun, assault rifle, uzi-alt, headshot pistol (parts) | No — `EnterFrame` is empty (`:84-86`) | 1 frame |
| `Bullet_Line_Sniper` | `Bullet_Line_Sniper.as` | mauser, terminator shotgun, .50 cal sniper, destroyer, ion cannon, credit cannon | Yes, fades `alpha -= 0.03`/tick (`:136`) | ~33 frames (≈1.1s) |
| `Bullet_Line_Bend` | `Bullet_Line_Bend.as` | uzi, "tentacle" shotgun | Yes, fades `alpha -= 0.1`/tick (`:103`) | 10 frames (≈0.33s) |
| `Bullet_Line_Electric` | `Bullet_Line_Electric.as` | discharger (arc-splitting sniper variant) | Yes, fades `alpha -= 0.03`/tick (`:214`) | ~33 frames |
| `Bullet_Line_Laser` | `Bullet_Line_Laser.as` | Focus Beam (continuous laser, `autoFire:true`) | Draws once in `EnterFrame`, then `removeMe()` immediately (`:74-103`) — a *new* bullet instance is spawned every tick while firing | 1 frame per instance, re-fired continuously |
| `Bullet_Line_Zapper` | `Bullet_Line_Zapper.as` | Zapper (alien continuous beam, `autoFire:true`) | Same one-shot-then-remove pattern (`:107-131`) | 1 frame per instance, re-fired continuously |
| `Bullet_Line_Effect` | `Bullet_Line_Effect.as` | Railgun ("Pierces") | Yes, fades `alpha -= 0.03`/tick, plus spawns a chasing particle effect (`:104-153`) | ~33 frames for the line; effect trail runs until it reaches the impact |

## 3. Per-class draw mechanics

### 3.1 `Bullet_Line_Basic` — dashed, single-frame (§1 above)

Draw loop (`:46-81`): for each *pass* `i` in `stats.params` (grouped in
triples after the leading dash-flag), calls
`lineCont.graphics.lineStyle(width, color, alpha)` once, then strokes the
*same* dashed `linePath` with that style. Guns with two triples (e.g. pistol:
`[true, 3.5,0xFFFFC4,0.3, 1.5,0xFFFFC4,0.6]`) draw the dashed path **twice** —
a fat, translucent "glow" pass (3.5px @ alpha 0.3) followed by a thin, bright
"core" pass (1.5px @ alpha 0.6) in the same color. This two-pass thick+thin
same-color layering is used by essentially every hitscan gun's tracer, not
just Basic.

### 3.2 `Bullet_Line_Sniper` — continuous, persistent, "heat shimmer"

Not dashed — `linePath` is a dense polyline (one point every 30px,
`:74-88`), each point carrying a random `lift` value
(`UT.rand(lo, hi)`, where `lo/hi` come from `stats.params[0]`: `[0.2,0.5]` if
dashed-style flag true, else `[-0.2,0.2]`). Every subsequent `EnterFrame`
tick (`:133-166`) every point's `y` is nudged by its own `lift` (so the whole
line visibly drifts/warps vertically, a "heat haze" look) while `alpha` decays
`0.03`/tick and the stroke alpha is scaled by it. This is the persistent,
lingering tracer look (mauser, sniper rifle, ion cannon, credit cannon,
destroyer, terminator shotgun).

### 3.3 `Bullet_Line_Bend` — quadratic double-curve, "whip"

Builds 2 bezier `curveTo` segments through 3 anchor points
(`ox,oy → mid1 → mid → mid2 → x,y`, `:72-82`), with `mid1`/`mid2` offset by a
random `Point(rand(-50,50), rand(-50,50))` from their straight-line
positions. Each `EnterFrame` (`:101-121`) eases `mid1`/`mid2` back toward
their un-offset targets by 10%/tick while `alpha -= 0.1`, so the line visibly
"un-whips" straight and fades over 10 frames. Used by the uzi (fast/inaccurate,
so the tracer's initial kink sells the spray) and the "tentacle" shotgun
(`extraShots:2`, params `[true,5.5,0x99FFFF,0.3, 2.5,0xDD6AEA,0.7]`).

### 3.4 `Bullet_Line_Electric` — 3 independently-jittered strands

Builds three separate point arrays (`line1Path/2Path/3Path`), each vertex
carrying its own random `lift` in `[-0.3, 0.3]` (`:59-144`). If
`stats.params[0]` is true the initial lift is exaggerated 10x for the very
first draw (`:145-158`) — a wild opening spread that then settles into a
gentle multi-frame drift as each subsequent `EnterFrame` nudges every vertex
by its (un-multiplied) `lift` again (`:216-284`). Three lines are drawn with
up to 3 independent `lineStyle` triples from `stats.params` (used by the
"Discharger" arc-splitting sniper: `[true, 3.5,0x00CCFF,0.4, 2.5,0x0099FF,0.5,
1.5,0xCCFFFF,0.4]` — cyan/blue/pale-cyan three-strand arc).

### 3.5 `Bullet_Line_Laser` — continuous beam, re-spawned every tick

`stats.autoFire = true` and `shootDelay ≈ 0.05`, so `Guns.as` fires a brand
new `Bullet_Line_Laser` almost every tick while the trigger is held. Each
instance's constructor marches the hit-test forward and records two point
arrays (`line1`, `line2`) offset by ±1px random jitter per point
(`:39-64`); its *only* draw call happens in `EnterFrame` (`:74-103`), where
both arrays get an *additional* ±1px jitter applied before stroking, then
`removeMe()` fires immediately. `stats.params = [8, 0x66CC00, 0.5, 4, 0x96CC01,
0.8]` (Focus Beam): a fat, half-alpha 0x66CC00 (green) outer pass and a
thinner, near-opaque 0x96CC01 inner pass — the double per-pixel jitter (once
at spawn, once at draw) is what gives the beam its buzzing/staticky look
frame to frame, since a fresh instance (fresh jitter) replaces the old one
every tick.

### 3.6 `Bullet_Line_Zapper` — distance-scaled double-strand beam

Also continuous/re-spawned like Laser, but colors are **hardcoded** in
`EnterFrame` rather than pulled from `stats.params` (the Zapper's gun entry
has an empty `params: []`): outer stroke `3 * strength` wide, color
`0xCC00FF` (magenta), alpha `alpha * 0.5`; inner stroke `2 * strength` wide,
color `0x9900FF` (purple), alpha `alpha * 1` (`:110-129`). `strength` and
`alpha` are computed from hit distance in the constructor (`:70-104`): a
clean hit scales `strength = ((maxDist-curDist)/maxDist + 0.1) * 5` (thicker
line up close — sells "microwaving them from within" damage falloff), while
a miss (no `hitObject`) sets `alpha = 0.8`, `strength = 1.7` and additionally
scrambles every point in both line arrays by `±loopIndex` px so a whiffed
shot visibly "sprays" rather than drawing a clean miss-beam.

### 3.7 `Bullet_Line_Effect` — pierce beam + chasing particle trail (Railgun)

Draws the beam **once**, full length, in the constructor (`:92-99`) —
solid, not dashed, with 2-pass thick/thin styling from `stats.params`
(`["chain_fire", 5.5, 0xDB0202, 0.6, 2.5, 0xFFFFFF, 0.8]`: a translucent dark
red 5.5px outer glow, opaque white 2.5px inner core). This is also the only
`Bullet_Line_*` that supports **piercing**: the hit-test loop keeps going past
the first hit if `stats.extra.pierce`, tracking already-hit targets in
`hitObjects[]` to avoid double-damaging the same target (`:60-91`), and stops
early only on a wall/nothing or a mirror-shield reflect. After the initial
draw, `EnterFrame` (`:104-153`) fades the static beam's alpha `-0.03`/tick
*and*, every tick while more than 30px separate the beam's tail (`toX,toY`)
from its head, advances `toX/toY` by `xVel*3` twice and calls
`game.createEffect(toX, toY, "chain_fire")` at each step — i.e. a `chain_fire`
particle effect (`glowColor` RGBA(255,0,0) — pure red glow, matching the
beam's red tint) visibly chases down the length of the already-drawn beam
from muzzle to impact, arriving a few frames after the beam itself flashed
in. The bullet only calls `removeMe()` once both the beam has fully faded
*and* the chase effect has caught up (`toDist <= 30`).

## 4. Tracer color/width table (from `Stats_Guns.as::Init`)

`params` format for `Bullet_Line_Basic`/`Sniper`/`Bend`/`Effect` is
`[dashFlag_or_effectName, width1, color1, alpha1, width2, color2, alpha2, ...]`
(repeat triples = extra stroke passes over the same path). Colors converted
from the decimal ints in source to hex.

| Gun (`Stats_Guns.as` line) | Tracer class | params (raw) | Resolved (width/color/alpha per pass) |
|---|---|---|---|
| M9 Barret pistol (110) | Basic | `[true,3.5,16777156,0.3,1.5,16777156,0.6]` | 3.5px `#FFFFC4` @0.3, 1.5px `#FFFFC4` @0.6 |
| Golden Mauser (169) | Sniper | `[true,1.5,16776960,0.3,0.5,16776960,0.6]` | 1.5px `#FFFF00` @0.3, 0.5px `#FFFF00` @0.6 |
| Uzi (~194) | Bend | `[true,1.5,16777156,0.3,0.5,16777156,0.6]` | 1.5px `#FFFFC4` @0.3, 0.5px `#FFFFC4` @0.6 |
| Headshot pistol (~223) | Basic | `[false,5.5,16777156,0.3,1.5,16777156,0.8]` | not dashed; 5.5px `#FFFFC4` @0.3, 1.5px @0.8 |
| Shotgun (307) | Basic | `[true,3.5,16777156,0.3,1.5,16777156,0.6]` | same as pistol |
| "Tentacle" shotgun (~334) | Bend | `[true,5.5,10066431,0.3,2.5,14510826,0.7]` | 5.5px `#9999FF` @0.3, 2.5px `#DD6AEA` @0.7 |
| Zapper (343) | Zapper | `[]` (colors hardcoded, see §3.6) | 3×strength `#CC00FF` @0.5×alpha, 2×strength `#9900FF` @alpha |
| Terminator shotgun (344) | Sniper | `[false,3.5,16764006,0.2,1.5,16764006,0.3]` | 3.5px `#FFCC66` @0.2, 1.5px @0.3 |
| Assault rifle (~382) | Basic | `[true,3.5,16777156,0.3,1.5,16777156,0.6]` | same as pistol |
| .50 Cal Sniper (467) | Sniper | `[true,3.5,13421772,0.3,1.5,15658734,0.6]` | 3.5px `#CCCCCC` @0.3, 1.5px `#EEEEEE` @0.6 |
| Railgun (468) | Effect | `["chain_fire",5.5,14352898,0.6,2.5,16777215,0.8]` | 5.5px `#DB0202` @0.6, 2.5px `#FFFFFF` @0.8, + `chain_fire` chase FX |
| Discharger (arc sniper, ~521) | Electric | `[true,3.5,52479,0.4,2.5,39423,0.5,1.5,13434879,0.4]` | 3 strands: 3.5px `#00CCFF` @0.4, 2.5px `#0099FF` @0.5, 1.5px `#CCFFFF` @0.4 |
| Focus Beam (~570) | Laser | `[8,6736896,0.5,4,9882625,0.8]` | 8px `#66CC00` @0.5 (outer), 4px `#96CC01` @0.8 (inner) |
| Destroyer (~585) | Sniper | `[true,6.5,14352898,0.8,4.5,16777215,0.8]` | 6.5px `#DB0202` @0.8, 4.5px `#FFFFFF` @0.8 |
| Ion Cannon (~626) | Sniper | `[true,8.5,16763904,0.5,3.5,16777156,0.6]` | 8.5px `#FFCC00` @0.5, 3.5px `#FFFFC4` @0.6 |
| Credit Cannon (644) | Sniper | `[true,7.5,26265,0.5,2.5,6737151,0.6]` | 7.5px `#006699` @0.5, 2.5px `#66CCFF` @0.6 |

Every `Basic`/`Sniper`/`Bend`/`Electric` gun above uses the exact same two- (or
three-) layer thick-translucent + thin-opaque stroke trick in the *same*
color — none of them mix hues within one tracer; only `Electric` (3 strands)
and `Effect`/`Sniper` variants with visibly distinct color1/color2 (Ion
Cannon, Credit Cannon) break that pattern.

## 5. Muzzle flash

There is no `Effect_Muzzle`-style AS3 class; every muzzle flash is the same
generic `Effect` object (`Effect.as`) spawned with `stats.effShoot` as the
bitmap-animation name, at the shot origin (`Bullet.as:141-144`,
`game.createEffect(ox, oy, stats.effShoot)`). `effShoot` values from
`Stats_Guns.as` (2nd string literal in each `addGun(...)` call after the
race/cost/dmg block): mostly `"gas_small"` (pistol/shotgun/rifle/sniper —
i.e. a shared small gunsmoke-puff clip reused for muzzle flash across most
firearms), `"purple_fire"` (Zapper), `"green_shot"` (Focus Beam / Acid
Hound), `"plasmapistol_hit"`/`"chain_hit"` (plasma & railgun-family weapons),
`"gas_small"`→`"gas_bblue"`/`"gas_bigblue"` variants for frost/ice weapons.
`effShoot` plays back at `Effect.as:34-46` via `BH.getBitAniStats` +
`game.bitscreen.paint(...)`, advancing one baked-bitmap frame per tick until
`frame > stats.frames`, i.e. it is not parameterized by size/cone/color in
script — those live in the pre-rendered artwork inside `assets.swf`'s master
effect timeline (`DefineSpriteTag 1809`, one outer frame per named clip,
each placing a nested `MC` symbol whose *own* sub-timeline is what
`BH.setup()` bakes to bitmaps, `BH.as:225-307`). There is also a **random
rotation variant** per effect (`Effect.as:35`, `rotAmt` baked per clip in
`BH.setup()`, `:250-287`) so consecutive muzzle flashes at the same gun don't
look identical frame to frame.

Filter-derived tints for the muzzle/impact clips pulled from `assets.swf`
(`GLOWFILTER.glowColor` on the nested `MC` placement):

| Effect name | Tint (glow/colorTransform) | Used by |
|---|---|---|
| `plasma_shot` | `#9900FF` (glow) | plasma pistol projectile |
| `plasmapistol_fire` / `plasmapistol_hit` / `plasmapistol_shot` / `gas_bigblue` | `#00CCFF` (glow) | plasma-family shots/hits |
| `chain_fire` / `chain_hit` | `#FF0000` (glow, inner) | railgun beam-chase FX, grenade launcher sticky trail |
| `purple_fire` | `#CC33CC` (glow) | Zapper impact |
| `plasma_explode` | `#9933CC` (glow) | Pulsator (alien splash sniper) explosion |
| `green_shot` | `#00FF00` (glow) | Focus Beam impact |
| `gas_big2` | `#66CC00` (glow) | Acid Hound splash |
| `leaves` / `leaf_splash` | `#669900` (glow) | tree/foliage hit particles |
| `shell` | `#FFCC00` (glow) | ejected shell casing highlight |

## 6. Impact effects by surface / weapon (`effHit`, `Bullet.as:doHitEffect`)

`stats.effHit` (3rd string literal after race/cost/dmg block in `addGun`) is
played at the impact point the same way as `effShoot`
(`game.createEffect(x, y, stats.effHit)`, `Bullet.as:233-236` for unit hits,
`:327-330` for corpse hits, `:356-359` for wall hits — skipped for `burrow`
guns, which spawn `"mud_splash"` instead, `:361-364`). Common `effHit` values:
`"gas_small"` (pistol/shotgun/rifle default spark), `"spark_big"` (.50 Cal
Sniper), `"gas_big"` (rockets, ion cannon, hrocket), `"getweapon"`/`"chain_hit"`
(railgun/discharger), `"plasma_explode"` (Pulsator), `"gas_bblue"`
(frost rockets), `"fexpand"` (flamethrower/burst torch), `"gas_bigblue"`
(Credit Cannon).

### 6.1 Wall-surface material variants (`Bullet.as:365-475`)

`hitTestAll()` returns the wall pixel's color-key as a hex string when a
raycast hits a wall (`Bullet.as:503-511`, reading `game.arena.wall`'s pixel
alpha+RGB); `doHitEffect` switches on that string to add a *material*-specific
extra effect on top of the weapon's own `effHit`:

| Wall color-key | Material | Extra FX |
|---|---|---|
| `"ffff06"` | moon/space rock | none (achievement check only) |
| `"9900ff"` | tutorial marker | none (tutorial hook only) |
| `""` / `"ff0000"` / `"00ffff"` | (no extra material) | — |
| `"993300"` | mud/dirt | `"mud_splash"` (if `SD.graphPart` particle budget allows) |
| `"670067"` / `"6699ff"` | (no extra material) | — |
| `"ffffff"` | snow | `"snow_splash"` (if `SD.graphPart`) |
| `"006600"` | grass/foliage | `"leaf_splash"` + N `leaf` particles flying (`UT.irand(1,4)` sprite variant), tracked toward the "ammo" achievement at 400 tree-shots |
| anything else | generic/metal | (weapon's own `effHit` only) |

`burrow` weapons (Shredder saw blades) skip the normal wall `effHit` entirely
and spawn `"mud_splash"` unconditionally while continuing to travel through
the ground (`Bullet.as:344-364`).

## 7. Blood / hit-flesh effects

Blood is **not** a family of distinct art assets — `Bullet.as:205` calls
`game.createEffect(x, y, hitObject.skin.blood)`, where `skin.blood` is one of
5 shared string keys set per skin race in `Stats_Skins.as:58-137`
(`"bloodHuman"`, `"bloodAlien"`, `"bloodRobot"`, `"bloodZombie"`, and
`"bloodRainbow"` substituted in when `MatchSettings.specialMode == "lol
cats"`, `Bullet.as:205` / `:311`). All 5 clips in `assets.swf` place the
*same* base burst symbols (`characterId 654` for the splash + `characterId
1740` for the burst-shape MC) and differ only by an additive
`colorTransform` tint layered on top:

| Effect name | `colorTransform` add (R,G,B) | Resulting tint | Race |
|---|---|---|---|
| `bloodHuman` | `204, 0, 0` | `#CC0000` red | Human |
| `bloodAlien` | `153, 0, 255` | `#9900FF` purple | Alien |
| `bloodRobot` | mult `(0,0,0)`, no add | pure black (oil, not blood) | Robot |
| `bloodZombie` | `102, 153, 0` | `#669900` sickly green | Zombie |
| `bloodShield` | `255, 204, 51` | `#FFCC33` gold/energy spark | any race with an active shield (`sInvin`-adjacent `shCur` shield status, replaces normal blood, `Bullet.as:201-210`) |
| `bloodRainbow` | none — uses a 6-stop `GRADIENTGLOWFILTER` cycling red→cyan→magenta→yellow→magenta→white | rainbow | "lol cats" special mode only |

All 5 (6) share one `GLOWFILTER` red/blur base and only the tint (or, for
rainbow, the gradient) differs — i.e. implementing this in the port as
"one blood-splat particle system + a per-race tint color" is a faithful port,
not a simplification.

## 8. Beam / lightning / plasma special impacts

- **Railgun ("Pierces")**: handled entirely by `Bullet_Line_Effect` (§3.7) —
  solid red/white two-pass beam + a `chain_fire` (red-glow) particle that
  visibly chases from muzzle to impact after the beam flashes in, unique
  among tracers for persisting a *directional* secondary effect rather than
  just fading in place.
- **Discharger (arc-splitting sniper)**: `Bullet_Line_Electric` 3-strand cyan
  arc (§3.4) is the "beam" look; separately, `stats.extra.arc = 400` makes
  `doHitEffect` spawn up to 3 extra `bouncer`-style sub-bullets toward nearby
  enemies within 400px on unit hit (`Bullet.as:244-306`) — a literal
  "lightning arc jumping between targets" mechanic layered on top of the
  visual arc-jitter.
- **Zapper / Focus Beam**: continuous double-strand beams re-spawned every
  tick (§3.5/§3.6); these are the two "always-on laser" weapons and read as
  buzzing/flickering by construction (fresh per-pixel jitter every frame),
  which is the closest the game gets to a *stable* beam weapon — but even
  these are still drawn fresh-and-cleared every tick, never a persistent
  Shape left on screen.
- **Plasma family** (plasma pistol homing bolt, Photon Blaster, Pulsator):
  these are **not** `Bullet_Line_*` at all — they're `Bullet_Proj_*`
  (physical projectile sprites with `effShoot`/`effHit` bitmap clips, no
  drawn ray), out of scope for the raycast mechanic but relevant context:
  Pulsator's `effHit = "plasma_explode"` (`#9933CC` glow) is its splash
  explosion.

## 9. Explosion FX

Explosions are impact effects (`effHit`) on `Bullet_Proj_*` classes, not
raycasts, but are documented here since they close out the "hit" pipeline:
rocket/grenade/heavy weapons pass a *hit sound* class (`S_rocketExplode`) as
the 2nd-to-last sound param and an `effHit` of `"gas_big"` (standard
rocket/heavy), `"gas_bblue"`/`"gas_bblue"` (frost rockets — visually recolored
via the same `colorTransform` trick as blood), or `"plasma_explode"`
(`#9933CC`, Pulsator). `Bullet_Proj_Basic.EnterFrame` (`Bullet_Proj_Basic.as:23-67`)
additionally spawns the projectile's own trail effect (`stats.params[0]`,
e.g. `"ember"`, `"gas_small"`, `"saw_shot"`) at every step of flight — so a
rocket's visible flight trail and its terminal explosion are two different
named effects, not one continuously-scaled clip.

## Port status

The port's tracer/impact system lives in `src/game/Fx.ts` (effect factory +
particle/graphics builders) and `src/game/GameScreen.ts`
(`addTracer`/`drawTracer`, `:751-823`), driven from `src/game/Guns.ts`.

- **Wrong / biggest gap — tracer is not "half-missing."** `GameScreen.ts`'s
  `drawTracer` (`:778-823`) always strokes one **continuous, unbroken**
  polyline from `x1,y1` to `x2,y2` (optionally bowed for unit hits) — there is
  no dashing, no random gap generation, and critically **no equivalent of the
  global-clear-then-selectively-redraw lifetime split** described in §1: every
  port tracer is a `Tracer` object pushed into `this.tracers` and faded via
  `drawTracer(tr, k)` over `Quality.tracerLife` ticks (`GameScreen.ts:764-768`),
  i.e. the port made *all* tracers behave like the original's `Bullet_Line_Sniper`
  (persistent, fading) — none of them reproduce the single-frame flash-and-vanish
  behavior that `Bullet_Line_Basic`/`Laser`/`Zapper` use for the majority of
  guns (pistol, shotgun, rifle, uzi, Zapper, Focus Beam). This is the direct
  opposite of "half-missing": the port's tracers are strictly *more* complete
  and *more* persistent than the original's for every hitscan weapon except
  the sniper-family guns.
- **Missing — no dash/gap generation at all.** Porting `Bullet_Line_Basic`'s
  `UT.irand(0,100)` start offset + `UT.irand(50,250)` gap loop (§1, item 2)
  onto the non-`beam` branch of `drawTracer` (`GameScreen.ts:810-813`) is the
  single highest-value change to match the original look for the common guns.
- **Missing — no per-weapon tracer color/width table.** `drawTracer` hardcodes
  exactly two looks: `0xfff2a0` @1.5px (non-beam) and `0xeaffff`/`0x66ccff`
  @2px/6px (beam) (`:806-812`). None of the distinct hex colors in §4 (mauser
  yellow `#FFFF00`, discharger cyan `#00CCFF`, railgun red `#DB0202`, ion
  cannon gold `#FFCC00`, credit cannon blue `#66CCFF`, etc.) are wired through
  from `Guns.ts`/`WEAPONS`, though `createEffect()` in `Fx.ts` does already
  accept a `color` override for *impact* sparks (`Fx.ts:623-668`) — the same
  plumbing doesn't yet reach the tracer line itself.
- **Missing — no two-pass thick/translucent + thin/opaque stroke.** Every
  original tracer (§3.1-3.7) layers a fat low-alpha "glow" stroke and a
  thin high-alpha "core" stroke over the same path; the port's `drawTracer`
  draws only a single stroke per tracer (plus a separate glow-mode outer pass
  only for `beam`, `:804-807`).
- **Correct in spirit — persistence/fade for sniper-class weapons.** The
  port's fading `Tracer` with a collapsing impact-bloom circle
  (`GameScreen.ts:815-822`) is a reasonable analogue of `Bullet_Line_Sniper`'s
  alpha-decay behavior (§3.2), just applied universally rather than per-gun.
- **Correct — muzzle flash presence and directional cone.** `Fx.ts`'s
  `muzzleFlash()` (`:186-225`) draws a directional cone + hot core + optional
  cross-flare and forward sparks, matching the spirit of `effShoot` (§5)
  better than the original's single reused `"gas_small"` clip does, though it
  is generic-per-weapon-size rather than keyed to the original's distinct
  `effShoot` names (`gas_small`/`purple_fire`/`green_shot`/`plasmapistol_hit`/…).
- **Correct — wall-impact spark burst and directional cone-of-sparks.**
  `bulletSpark()` (`Fx.ts:138-177`) with an `angleDeg` cone parameter is a
  reasonable analogue of the original's material-variant wall splashes
  (§6.1), though the port does not distinguish mud/snow/leaf material
  variants — it always draws the same generic spark shape (material-specific
  extra particles like `leaf_splash`'s flying leaves are absent).
- **Correct — blood-as-one-tinted-effect.** `bloodSpray(big)` (`Fx.ts:315-333`)
  takes only a size flag, not a race/tint parameter — this **should** be
  extended with a `color` argument the same way `bulletSpark`/`plasmaFlash`
  already take one, to reproduce §7's human-red/alien-purple/robot-black/
  zombie-green/shield-gold tinting (currently every kill bleeds the same
  red-toned particle regardless of victim race).
- **Correct — plasma/lightning/lazer/explosion library breadth.**
  `plasmaFlash`, `lightningFlash`, `explosion`, `lazerImpact` (`Fx.ts:336-453`)
  cover the beam/lightning/plasma/explosion categories requested; their exact
  hex colors don't yet match the extracted values in §5/§8/§9 (e.g. port's
  `lightningFlash` default `0xaeefff` vs. original railgun/discharger reds
  and cyans; port's `plasmaFlash` default `0x66e0ff` vs. original plasma glow
  `#00CCFF`/`#9900FF`), but the effect *kinds* are all present.
- **Missing — no railgun "chasing particle" beam-to-impact trail** (§3.7,
  §8): the port's beam tracer fades in place; nothing marches a secondary
  particle from muzzle to impact after the beam flash, which is a
  distinctive part of the railgun's original look.
