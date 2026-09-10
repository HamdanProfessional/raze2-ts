
# Raze 2 — Player Movement & Physics (live kinematic controller)

Scope: the **live** unit's custom kinematic movement (not the Box2D corpse
ragdoll — that is a separate system, out of scope here; see `PhysWorld.as`).

Source files:
- `scripts/Movement.as` (the controller itself — one instance per `Unit`, held
  as `unit.mov`)
- `scripts/Unit.as` (`UnitEnterFrame()` drives per-frame terrain/surface
  sampling and facing; `KeyDown`/`KeyUp` live in `Player.as`)
- `scripts/Player.as` (`KeyDown`/`KeyUp` — input edges that call `mov.doJump()`)

All constants below are **per simulation tick**, and the game runs the logic
loop at a fixed **30 fps** (`msgTimer = 2*30`, `respawnTimer = 30*5`, etc.,
throughout `Unit.as`). There is no delta-time scaling — one call to
`Movement.EnterFrame()` = one 1/30s tick.

## 1. Constants (`Movement.as:36-98`)

| Constant | Value | Units | Meaning |
|---|---|---|---|
| `xAcc` | 2.1 | px/tick² | Ground horizontal acceleration |
| `xBrake` | 1.7 | px/tick² | Ground deceleration (friction) when no L/R held |
| `xCrouchBrake` | 0.5 | px/tick² | Deceleration while crouched and no L/R held |
| `xAirAcc` | 1.5 | px/tick² | Air horizontal acceleration |
| `xAirBrake` | 0.4 | px/tick² | Air deceleration when no L/R held |
| `xMax` | 11 | px/tick | Base max horizontal speed |
| `yGrav` | 0.8 | px/tick² | Gravity |
| `yMax` | 20 | px/tick | Terminal fall speed |
| `yJump` | 13 | px/tick | Base jump impulse (subtracted from `yVel`) |
| `yJumpBoost` | 6 | px | One-time instant upward position nudge (`unit.y -= 6`) applied only on the **first** jump of a jump cycle |
| `yDjump` | 10 | px/tick | Double-jump impulse (subtracted from the *already-halved* `yVel`) |

All of these are `Number` constants on `Movement` (`unit.mov.xAcc` etc.) and
are never themselves changed at runtime; per-frame **modifiers** (`modSpeed`,
`modMax`, `modBrake`, `modJump`, `modSideJump`, `modSlide`, `modMove`,
`modGrav`, `modMegaJump`) are multiplied/added on top of them and are reset to
neutral every frame by `resetMods()` (`Movement.as:107-124`), then re-derived
by `Unit.as` from the terrain color under the unit (§5).

## 2. Horizontal movement (`Movement.as:201-291`, ground/air accel + friction)

Only runs while `unit.game.gameStarted`.

```
crouching = jumping ? false : (keys & DOWN)

if (keys & LEFT && !crouching && xVel > -(xMax+3)):
    nextAnim = flip ? "run" : "runback"
    xVel += (jumping ? -xAirAcc : -xAcc) * modSpeed
    xVel = max(xVel, -xMax * modMax)          // clamp

elif (keys & RIGHT && !crouching && xVel < xMax+3):
    nextAnim = flip ? "runback" : "run"
    xVel += (jumping ? xAirAcc : xAcc) * modSpeed
    xVel = min(xVel, xMax * modMax)           // clamp

else:                                          // no directional input
    nextAnim = "idle"
    brake = (jumping ? xAirBrake
             : (!crouching ? xBrake : xCrouchBrake)) * modBrake
    if (!jumping && |xVel| > xMax): brake *= 2.5   // faster bleed-off of over-speed
    if (xVel >  brake): xVel -= brake
    if (xVel < -brake): xVel += brake
    if (|xVel| < brake + 0.1): xVel = 0

unit.x += xVel
unit.x += modMove                              // conveyor-style constant push, see §5
if (!modSlide): xVel += xVelSlide              // merge slope-slide back into main velocity
xVelSlide = round(unit.MC.rotation) * modSlide // slope-slide component, driven by body-lean angle
xVelSlide -= 0.05 * sign(xVelSlide) (clamped to 0 inside ±0.1)
unit.x += xVelSlide
unit.y += yVel
```

Notes:
- The `+3` slack on the `xVel > -(xMax+3)` / `xVel < xMax+3` guards lets a unit
  that is moving *faster* than `xMax` (e.g. via `modMax`/environmental mods,
  or momentum carried from a jump pad) still receive counter-input
  acceleration instead of being locked out, while the plain-brake path (no
  input held) has a separate `×2.5` over-speed case to bleed it off quickly
  once the player lets go.
- Acceleration/braking is **not** framerate-independent; it is a flat
  px/tick² added every 1/30s tick.
- `xVelSlide` is a *second*, independently-decaying horizontal velocity
  component driven by the current ground-lean angle (`unit.MC.rotation`,
  computed in §5's tilt/slope probe) times `modSlide` — this is the "sliding
  down an icy slope" effect. It decays toward 0 by 0.05/tick and is folded
  back into `xVel` every tick unless `modSlide` is currently non-zero (i.e.
  while actively standing on a sliding surface, the slide component stays
  separate from — and is not damped by — the normal ground brake).

## 3. Jump / double-jump (`Movement.as:126-199`, `doJump()`)

`doJump()` is **not** polled every frame — it's an edge-triggered call from
`Player.KeyDown` (`Player.as:346-357`) fired once per physical key-down of
Up/W/Space (`pressedUp` latch prevents OS key-repeat from re-firing it; the
corresponding `KeyUp` clears the latch).

```
function doJump():
  if (abilityPause) return
  if (!game.gameStarted) return
  if (crouching) return                    // cannot jump while crouched
  if (modSideJump): xVel = modSideJump      // scripted "jump pad" horizontal kick, see §5

  if (modMegaJump):                         // scripted mega-jump surfaces (tutorial pads)
    play S_Jumppad; jumping = true; manualJump = true; dJump = true
    yVel -= yJump * modJump
    MC.goto("tuck"); spawn smoke_big fx
    // (mutually exclusive with the two branches below, since jumping/dJump
    // are now already true)

  if (!jumping):                            // first jump
    unit.y -= yJumpBoost                    // 6px instant hop, masks launch-frame ground clip
    yVel -= yJump * modJump
    jumping = true; manualJump = true
    MC.goto("jump")

  elif (!dJump):                            // second (double) jump
    yVel *= 0.5                             // kill half of current vertical velocity first
    yVel -= yDjump
    dJump = true
    MC.goto("tuck"); spawn smoke_med fx
    if (manualJump):                        // only a manually-pressed 2nd jump triggers the flip
      if (keys & RIGHT && !(keys & LEFT)): spinning=true; spinCur=0; spinNew= 360
      elif (keys & LEFT):                   spinning=true; spinCur=0; spinNew=-360
      // (no L or R held: no spin, but tuck pose still applies)
```

- Effective jump impulse: **13 × modJump** px/tick, applied by *decrementing*
  `yVel` (so it must already be non-negative/falling or the jump adds on top).
- Double jump impulse is **not** simply `-yDjump`; the existing `yVel` is
  halved first, *then* `yDjump` (10) is subtracted — e.g. rising at
  `yVel = -4` (already decelerating toward the jump apex) double-jumping
  gives `-4*0.5 - 10 = -12`; falling at `yVel = +6` gives `6*0.5 - 10 = -7`.
  This makes the double jump's height fairly consistent regardless of when in
  the arc it's triggered.
- The 360° flip/spin (`spinning`/`spinCur`/`spinNew`, interpolated in
  `EnterFrame` at `spinCur += (spinNew-spinCur) * (jumping?0.15:0.3)` — i.e.
  eases in slowly while airborne, snaps quickly to finish once grounded) is
  purely cosmetic (`unit.spinMC.rotation`), driven by whichever direction key
  is held **at the instant of the double-jump key-press**, not the current
  velocity.
- There is no jump count beyond 2 (single + one double); `dJump` blocks any
  further mid-air jumps until landing resets it.
- Landing (`Movement.as:335-337`) resets `manualJump = jumping = dJump = false`
  and `yVel = 0`.
- Jump-pad interaction (`modMegaJump`, `modJump`, `modSideJump` set from the
  arena's tutorial jump-pad zones) is documented by the maps doc; only the
  consuming logic above lives in `Movement.as`.

## 4. Gravity, terminal velocity, ground/ceiling collision (`Movement.as:308-469`)

Every tick, after the horizontal-move block:

**4a. Settle-onto-ground pre-pass**
```
while ( hitTest(0, 9) && !hitTest(0, -1) ):
    unit.y += 0.5
```
`hitTest(0,9)` probes 9px below the unit's origin (feet) and `hitTest(0,-1)`
probes 1px above it. While the ground is solid just under the feet but the
origin itself is still in clear air, the origin is nudged down in 0.5px steps
until it is embedded just inside the solid mass — this stabilizes the
ground-probe below (§4b) so a unit resting exactly on a surface boundary
doesn't oscillate between "grounded"/"falling" from sub-pixel placement.

**4b. Ground / fall state**
```
if hitTest(0, 1):                     // 1px below origin is solid → grounded
    if (yVel > 0):                    // was falling → pick a landing anim
        nextAnim = "land" / "landrun" / "landrunback" (per held L/R & flip)
    manualJump = jumping = dJump = false
    yVel = 0
else:                                  // airborne
    nextAnim = "fall"
    jumping = true
    yVel += yGrav * modGrav
    yVel = min(yVel, yMax * modGrav)   // terminal velocity, ALSO scaled by modGrav
```
Terminal fall speed is **20 × modGrav** px/tick, not a flat 20 — a heavy/mud
surface (`modGrav = 0.6`, §5) both slows the fall accel *and* lowers the cap.

**4c. Ceiling bump**
```
while hitTest(0, -50):     // 50px above origin is solid
    unit.y += 1
    if (yVel < 0): yVel = 0
```
Pushes the unit down out of a ceiling and zeroes any remaining upward
velocity — an ascending jump is capped hard the instant the head probe (50px
above the origin) touches solid ground pixels.

**4d. Side-wall push-out**
```
while hitTest(17,-20) || hitTest(17,-25) || hitTest(17,-35) || hitTest(17,-45):
    unit.x -= 1        // right-side probes; step out left
while hitTest(-17,-20) || hitTest(-17,-25) || hitTest(-17,-35) || hitTest(-17,-45):
    unit.x += 1        // left-side probes; step out right
while hitTest(0, 0):
    unit.y -= 0.5       // failsafe: center-origin still embedded, lift straight up
```
Wall collision is 4 discrete point probes per side at **dx = ±17px**, heights
`-20,-25,-35,-45` relative to the origin (torso/head band only — nothing is
probed between the origin and -20, so the lower legs/feet never register as
blocked by a side wall, which combined with §4a/4b is what lets a unit stand
flush against low ledges without jamming).

**4e. Ground-tilt lean (only while grounded, i.e. `!jumping`)**
```
tiltL = tiltR = -10
while (tiltL < 30 wait it's bounded at 30 iterations) and !hitTest(-10, tiltL): tiltL++   // probe up to 30px at x=-10
(same for tiltR at x=+10)
if (tiltL < 20 && tiltR < 20):
    targetRotation = UT.getRotation(-10, tiltL, 10, tiltR) - 90
else:
    targetRotation = 0
unit.MC.rotation += (targetRotation - unit.MC.rotation) * 0.3   // 30%/tick ease
if (crouching): nextAnim = "duck"
```
While airborne, `targetRotation` is forced to 0 and the same 0.3-per-tick ease
is applied, so the body levels out over a jump/fall. This lean angle is what
feeds `xVelSlide` in §2 (`round(unit.MC.rotation) * modSlide`).

**`hitTest(dx, dy)`** (`Movement.as:471-479`): samples
`game.arena.wall.getPixel32(unit.x+dx, unit.y+dy)`; a pixel only counts as
solid if its **alpha byte is exactly `0xFF`** (`toString(16).substring(0,2) ==
"ff"`) — non-fully-opaque pixels (anti-aliased edges) are treated as empty.
The RGB of a solid pixel encodes surface type (§5) and is also used elsewhere
(`Unit.as:1369-1372`, `getPixel()`) for the terrain-color lookup.

## 5. Crouch

- Toggled purely from held input: `crouching = (!jumping) && (keys & DOWN)`
  (`Movement.as:209-216`); cannot crouch mid-air, and jumping is blocked while
  crouched (`doJump()` early-return, §3).
- Effect is **entirely on the horizontal accel/brake formula**: L/R
  acceleration is disabled while crouched (the `!crouching` guard in the
  L/R branches), and the idle-brake uses `xCrouchBrake` (0.5) instead of
  `xBrake` (1.7) — i.e. a crouched unit that lets go of L/R decelerates ~3.4×
  slower (retains momentum) rather than braking harder.
- Crouch does **not** shrink or move the wall/floor collision probes in
  `Movement.as` (§4) — the `hitTest` offsets are fixed constants regardless
  of `crouching`. (A separate, smaller *hit-scan* hurtbox for being shot while
  crouched may exist in `Status.as`/gun-hit code but is out of scope for this
  movement doc.)
- Only visual effect noted here: forces `nextAnim = "duck"` while grounded and
  not moving into a wall condition (§4e).

## 6. Facing / aim vs. movement

Facing (`unit.flip`) does **not** affect the physics constants at all — L/R
key input directly sets the sign of `xVel` regardless of which way the
character is facing/aiming. `flip` only affects which run animation name is
chosen (`"run"` vs `"runback"`, so strafing-while-aiming-behind reads as a
backpedal animation) and the visual `MC.scaleX` mirror. Facing itself is
derived in `Unit.as:1082-1096`:
```
if (mov.jumping): flip = (aimX < unit.x)             // airborne: face aim horizontally
else:              flip = fixRotation(aimRoation - MC.rotation) < 0   // grounded: face aim angle vs body lean
```
Aim also drives arm/head rotation (`rotArm`, `aimRoation`, `MC.arm1.rotation`,
etc., `Unit.as:1096-1136`) but none of that feeds back into `xVel`/`yVel`.

## 7. Terrain/surface modifiers (`Unit.as:634-1079`, `UnitEnterFrame`)

Every frame, after `mov.resetMods()` (all mods reset to neutral: `modSpeed=1,
modMax=1, modBrake=1, modJump=1, modSideJump=0, modGrav=1, modSlide=0,
modMove=0, modMegaJump=false`), the game samples the wall bitmap 1px below the
unit (`getPixel(0,1)`), reads the pixel's RGB as a hex "surface ID", and maps
known IDs to a `switch` that both fires one-off gameplay events (pickups,
achievements, scripted tutorial triggers) **and** sets the `Movement` mods
consumed in §2–§4 for that single tick. The gameplay-relevant (non-tutorial)
surface IDs are:

| Surface color (RGB) | modSpeed | modJump | modGrav | modBrake | modSlide | modMove | Effect |
|---|---|---|---|---|---|---|---|
| `993300` (id 20, mud) | 0.3 | – | – | 0.25 | 0.2 | – | Slow, sluggish braking, slight slide; spawns mud-splash fx while moving |
| `ccffff` (id 21) | 0.3 | – | – | 1 | 0.3 | – | Slow with a stronger slide component |
| `ffffff` (id 22, snow) | – | – | – | 3 | – | – | Very hard braking (near-instant stop); footprint/snow-splash fx |
| `cccccc` (id 23, sand) | – | – | – | – | – | – | Footprint/sand-splash fx only, no accel change |
| `650065` (id 24) | – | 0.3 | 0.6 | – | – | – | Weak jump, floaty-but-capped fall (lower gravity AND lower terminal velocity) |
| `6699ff` (id 25, water?) | 0.75 | 0.3 | 0.6 | 2 | – | – | Slow, weak jump, reduced gravity, hard brake; also resets `status.sFire` |
| `000099` (id 26) | 0.75 | 0.75 | – | 2 | – | – | Slow, reduced jump, hard brake; footprint/sand-splash fx; resets `sFire` |
| `00ff00` (id 27, toxic) | 0.6 | 0.6 | – | 2 | – | – | Slow, reduced jump, hard brake; toxic sizzle fx |
| `666666` (id 28, conveyor →) | – | – | – | – | – | +8 | Constant rightward push added to `unit.x` on top of `xVel` |
| `999999` (id 29, conveyor ←) | – | – | – | – | – | −8 | Constant leftward push |
| `320000` (id 30) | – | – | – | – | – | – | Instant 9999 self-damage (hazard, not a movement mod) |
| `300000` (id 31) | – | – | – | – | – | – | 0.5 self-damage per tick (hazard) |
| `f00007` (id 32) | – | 2.6 | – | – | – | – | 0.5 self-damage per tick **and** a strong mega-jump boost |

IDs 0–4 and the long run of `00fff1..00ccf8` etc. (ids 5–19) are
tutorial-only scripted triggers (dialogue advances, camera/HUD state,
one-shot `modMegaJump`/`modJump`/`modSideJump`/`modBrake` combos for the
tutorial's staged jump-pad sequence) rather than general-purpose terrain and
are out of scope for this doc (see the maps doc for jump pads specifically).

## 8. Knockback

**There is no knockback/hit-force system applied to the live unit controller
in the decompiled source.** `Stats_Guns.force` (`Stats_Guns.as:55`) exists,
but its only consumer is `PhysWorld.as:121-144,165-201`
(`createCorpse`/`impulseBody`), which applies a Box2D impulse **only to the
ragdoll created on death** — explicitly out of scope per this doc's brief.
Live units take damage (`Status.damage`, `Status.as:204+`) with no
corresponding push to `mov.xVel`/`mov.yVel` anywhere in `Status.as`,
`Bullet.as`, or `Guns.as`. Screen shake (`game.arena.setShake`) is the only
"impact feedback" for explosions on living players.

## Port status

Compared against `C:\Users\Hamdan\Desktop\mc\raze\raze-ts\src\game\Unit.ts`
(constants set in `respawn()` around line 951; logic in `doJump()`,
`moveUnit()`, `resolveAxis*()`, `updateTilt()`).

### Correct / already matching
- **Gravity accel** (`0.8`) and **terminal fall velocity cap** (`20`) match
  exactly (`Unit.ts:1178-1182` `jumping.grav`, `jumping.fallMax`).
- **Double-jump formula** matches exactly: `vel = vel/2 - 10`
  (`Unit.ts:1040`, cf. `Movement.as:169-176`).
- **Fixed 30Hz-equivalent logic tick** is preserved as the port's design
  assumption (`Unit.ts:90` comment: "fixed 30Hz logic rate"), and jump is
  correctly **edge-triggered** off a `pressed` boolean from key-down, not
  polled every frame (`Unit.ts:1034`, cf. `Player.as` `KeyDown`).
- **Crouch disables jumping and disables horizontal acceleration**, and only
  affects braking / anim, matching the source's intent
  (`Unit.ts:1130,1140,1152-1163`).
- **Facing/aim does not affect movement physics**, only animation/visual
  facing — consistent with the original (`Unit.ts:1137-1138`).
- General shape of ground/air accel vs. brake vs. max-speed with separate air
  values is present (`Unit.ts:951-957` `Moving` interface), and a step-up /
  ledge auto-climb concept exists (`tryStepUp`/`stepMax`), functionally
  analogous to the original's unguarded 0..-20 wall-probe gap (§4d) even
  though implemented completely differently.

### Present but wrong / incomplete
- **Horizontal constants are scaled down and not proportional to the
  original.** Port: `acc=1.61, brake=1.61, airAcc=1.12, airBrake=0.35,
  max=8.4` (`Unit.ts:953-957`, explicitly commented "tuned 30% slower than
  the port baseline (max 12 → 8.4)"). Original: `xAcc=2.1, xBrake=1.7,
  xAirAcc=1.5, xAirBrake=0.4, xMax=11`. This is a **deliberate gameplay
  tuning deviation**, not a bug, but it means: (a) ground brake no longer
  differs from ground accel (port sets both to `1.61`; original has
  `xBrake(1.7) < xAcc(2.1)` so coasting-to-stop is slightly softer than
  accelerating), (b) there is no separate **crouch brake** (`xCrouchBrake =
  0.5`) — the port always uses the same `m.brake` regardless of
  `this.crouching` (`Unit.ts:1159`), and (c) there is no over-speed `×2.5`
  brake multiplier for bleeding off velocity above `xMax` (§2).
- **Jump impulse magnitude differs**: port uses `-15` (`Unit.ts:1037,1193`)
  vs. the original's `-13` (`yJump`), and the one-time `yJumpBoost` (6px
  instant hop on launch, `Movement.as:161`) is not reproduced.
- **`modJump`/`modGrav`/`modMax`/`modSpeed`/`modBrake`/`modSideJump`/
  `modSlide`/`modMove`/`modMegaJump` terrain-modifier system (§5, §7) does not
  exist in the port at all.** No surface-color sampling, no mud/snow/sand/
  water/toxic/conveyor movement effects, no `xVelSlide` slope-slide component,
  no ground-lean-driven horizontal drift. `updateTilt()` (`Unit.ts:1085-1101`)
  reproduces only the *visual* lean, and does not feed back into horizontal
  velocity the way `xVelSlide` does in the original.
- **Wall-collision probe geometry differs from the source** and the port's
  own comment mis-states the original's constant: `Unit.ts:1235-1236` claims
  "Unit.as tests wall collision at dx = ±20", but the actual source value is
  **dx = ±17** (`Movement.as` `hitTest(17,…)`/`hitTest(-17,…)`), and the
  original only probes 4 discrete height bands (`-20,-25,-35,-45`) rather
  than a continuous column scan.
- **Ceiling probe differs**: original checks a fixed point 50px above the
  origin (`hitTest(0,-50)`); the port checks at the AABB's own top edge
  (`Unit.ts:1385-1390`), which will behave differently whenever the hitbox
  height (crouch-dependent in the port, fixed in the original — see below)
  doesn't happen to equal 50px.
- **Crouch shrinks the collision/hit AABB in the port**
  (`Unit.ts:1240,1256,1259`: `top`, `headY`, `lowY` all change with
  `this.crouching`), whereas in the original the *movement* collision probes
  are fixed regardless of crouch (§5) — only combat hit-scan bands would
  plausibly change, not the movement/wall probes. This is a reasonable
  gameplay improvement but is a divergence from source behavior.
- **Ground-settle pre-pass (§4a) and center-origin failsafe lift (§4d's
  `hitTest(0,0)` loop) have no direct analogue**; the port's
  `resolveAxisMask` takes a different (surface-height-lookup) approach that
  is functionally similar for landing but was not verified against the exact
  half-pixel settle behavior of the original.

### Entirely missing
- **Terrain surface-modifier table (§7)**: no mud/snow/sand/water/toxic/
  conveyor-belt effects on movement anywhere in `raze-ts` (`grep` across
  `src/game` found no surface-driven `modSpeed`/`modSlide`/`modMove`
  equivalent).
- **Slope-slide velocity component** (`xVelSlide`, driven by ground-lean
  angle × `modSlide`, §2) — not present; the port's `tilt` is purely visual.
- **`yJumpBoost`** instant 6px launch hop — not present.
- **Double-jump flip trigger condition is subtly different but intentionally
  documented as such** in the port: original triggers the spin whenever *any*
  double jump happens while L or R is held and it was a manual jump
  (regardless of vertical velocity sign); the port additionally requires
  `jumping.vel < -10` (a "strong upward" double jump) per its own code
  comment at `Unit.ts:1044-1048`. This is a **known, intentional narrowing**
  by the port author, not an oversight — flagged here for completeness since
  it changes behavior from the source.
- **Weapon/explosion knockback on live units does not exist in the original
  at all** (§8), so there is nothing from the source to "port" here. The
  port's `addKnockback`/`knockVel`/`KNOCK_DECAY` system (`Unit.ts:88-91,
  1169-1173, 1482-1484`) is an **invented feature** (shooter-recoil self-push,
  decay `0.55`/tick, clamped to ±8 px/tick) with no source counterpart — not
  a gap, but worth flagging since it has no original behavior to be faithful
  to. Likewise `hitStun` (`Unit.ts:171,1148-1150`, a movement-freezing stagger
  on taking damage) has no equivalent in `Status.as`.
