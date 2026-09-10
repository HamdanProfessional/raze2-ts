# Player / Unit Movement — Physics, Feel & Animation State Machine

## 1. Summary

Raze 2's unit is **not** a Box2D body. Box2D exists in the SWF only for the death ragdoll
(`PhysActor`/`PhysBody`/dropped guns). The live, controllable character is a small **custom
kinematic controller**: `Movement.as` holds all constants and per-frame integration
(`EnterFrame()`), `Unit.as` owns input flags (`keys`, the `UP/DOWN/LEFT/RIGHT` bitmask) and
per-frame bookkeeping (surface sampling, arm/head aim, flip), and `UnitMC.as` is the timeline
MovieClip that plays the baked body animation (`idle/run/runback/jump/fall/tuck/crouch(duck)`)
and fires frame-script callbacks back into `Unit`. Collision against the level is **pixel-mask
hit-testing** against the arena's wall bitmap (`getPixel32`), not polygon physics — the unit
probes a handful of fixed offsets around its origin every frame rather than sweeping an AABB
against a shape list.

The TS port (`raze-ts/src/game/Unit.ts`) already models this as a from-scratch kinematic
controller with the exact same constants and integration order, but swaps the SWF's
pixel-getPixel probing for a precomputed `WallMask` (`solidAt`/`surfaceUnder`), which is
functionally equivalent but not identical pixel-for-pixel. This document is the full
constant-for-constant and state-for-state comparison.

## 2. Raze 2 source of truth

### 2.1 Files

| File | Role |
|---|---|
| `decompiled_swf/raze 2/scripts/Movement.as` | All movement constants + `doJump()` + `EnterFrame()` (integration, collision probes) + `hitTest()` |
| `decompiled_swf/raze 2/scripts/Unit.as` | Input bitmask, per-frame surface-type lookup + terrain mods, arm/head aim rotation, flip trigger, `UnitEnterFrame()` orchestration |
| `decompiled_swf/raze 2/scripts/UnitMC.as` | Timeline `MovieClip` (`DefineSprite_441`, 230 frames) — `goto()` state-transition guard + frame-script callbacks |
| `decompiled_swf/raze 2/scripts/UT.as` | `fixRotation`, `getRotation`, `getDist`, `inBox`, `rand` helpers used by the above |
| `decompiled_swf/raze 2/sprites/DefineSprite_441_UnitMC/*.svg` | 230 exported frames of the body timeline (confirms frame count; FrameLabel names were not recoverable from the SVG export — see §6) |

`Unit_2.as` / `Movement_2.as` / `UnitMC_2.as` are the raw (more-obfuscated) decompiler twins of
the same classes; logic is identical, so only the cleaned files are cited below.

### 2.2 Movement constants (`Movement.as:36-98`)

| Constant | Value | Meaning |
|---|---|---|
| `xAcc` | **2.1** | Ground horizontal acceleration, px/frame² |
| `xBrake` | **1.7** | Ground idle brake (no input), px/frame² |
| `xCrouchBrake` | **0.5** | Idle brake while crouched — much softer, so crouch preserves momentum |
| `xAirAcc` | **1.5** | Air horizontal acceleration |
| `xAirBrake` | **0.4** | Air idle brake |
| `xMax` | **11** | Ground/air max horizontal speed, px/frame |
| `yGrav` | **0.8** | Gravity accel, px/frame² |
| `yMax` | **20** | Terminal fall speed, px/frame |
| `yJump` | **13** | Jump impulse magnitude (`yVel -= yJump * modJump`) |
| `yJumpBoost` | **6** | One-off instant upward hop applied *in addition to* the jump impulse, only on the **first** (non-double) jump — masks the launch-frame ground clip |
| `yDjump` | **10** | Double-jump impulse subtracted after halving current `yVel` |

All are `Number` constants on `Movement`, frame-rate-relative at the SWF's fixed 30fps logic tick
(`Game` steps `UnitEnterFrame()` once per frame; there is no delta-time scaling anywhere in this
class).

Per-instance modifiable state (also on `Movement`): `xVel`, `yVel`, `xVelSlide` (surface-lean
slide, see §2.6), `jumping`, `crouching`, `dJump` (double-jump used), `manualJump` (jump was
player-initiated, gates the double-jump spin), `spinning`/`spinCur`/`spinNew` (double-jump 360°
spin), `tiltL`/`tiltR` (ground-slope lean sample angles), and the eight terrain modifiers
`modSpeed/modMax/modBrake/modJump/modSideJump/modSlide/modMove/modGrav/modMegaJump`, all reset to
neutral (`resetMods()`, `Movement.as:107-124`) every frame **before** the surface lookup re-applies
them — i.e. terrain effects are **non-sticky**, re-sampled every tick, not latched.

### 2.3 Horizontal integration (`Movement.as:201-291`, inside `EnterFrame()`)

Order per frame, only while `game.gameStarted`:

1. **Crouch flag**: `crouching = keys & DOWN` — but only while `!jumping`; airborne always forces
   `crouching = false` (`Movement.as:209-216`). You cannot crouch mid-air.
2. **Input branch** (`Movement.as:217-270`), evaluated as `if LEFT … else if RIGHT … else (brake)`,
   so opposing keys held together fall through to the LEFT branch:
   - **LEFT**, not crouching, and `xVel > -(xMax+3)`: `xVel += (jumping ? -xAirAcc : -xAcc) * modSpeed`,
     clamped to `xVel >= -xMax*modMax`. Also sets `unit.nextAnim` to `"runback"` (facing right,
     moving left) or `"run"` (facing left, moving left) depending on `unit.flip`.
   - **RIGHT**, symmetric, clamped to `xVel <= xMax*modMax`.
   - **Neither** (or crouching with either held — crouching disables acceleration entirely,
     falling into the brake branch): brake `= (jumping ? xAirBrake : crouching ? xCrouchBrake : xBrake) * modBrake`;
     if grounded and `|xVel| > xMax`, brake is **multiplied by 2.5** (fast bleed-off of any
     over-speed, e.g. after a jump pad); brake is subtracted toward zero and snapped to exactly 0
     within a `±(brake+0.1)` deadzone.
   - The **`+3` over-speed slack** on the input-guard comparisons (`xVel > -(xMax+3)` /
     `xVel < xMax+3`) means a unit already faster than max (jump-pad momentum) can still take
     counter-input acceleration instead of being locked out of input entirely.
3. **Apply**: `unit.x += xVel; unit.x += modMove` (conveyor push, see §2.6).
4. **Slide surface** (`Movement.as:273-290`): if `modSlide` is 0 this frame, last frame's
   `xVelSlide` is folded into `xVel` (so it persists once you leave a slide surface — asymmetric
   with the surface application itself, which is non-sticky); `xVelSlide` is then recomputed as
   `round(MC.rotation) * modSlide` (the body's ground-tilt lean angle × the slide modifier),
   eased toward 0 by `0.05`/frame and snapped to 0 in a `±0.1` deadzone, then applied:
   `unit.x += xVelSlide`.

### 2.4 Vertical integration & ground/ceiling probes (`Movement.as:291-466`)

- `unit.y += yVel` unconditionally first.
- Double-jump spin easing (`spinCur += (spinNew-spinCur)*0.3` grounded / `*0.15` airborne),
  snapping to `spinNew` within ±1°, drives `unit.spinMC.rotation` (see §4.3).
- **Ground/ceiling test loop**: `hitTest(0,9)` (a point 9px below origin) with `!hitTest(0,-1)`
  gates "on ground"; while airborne (that test fails) it walks `unit.y += 0.5` repeatedly until
  clear, i.e. an **iterative pixel push-out**, not an analytic solve.
  - **Landed** (`hitTest(0,1)` true and `yVel > 0`): sets `nextAnim` to `"land"` /
    `"landrun"` / `"landrunback"` depending on held direction vs. facing, clears
    `manualJump/jumping/dJump`, zeroes `yVel`.
  - **Airborne**: `nextAnim = "fall"`, `jumping = true`, `yVel += yGrav*modGrav`, clamped to
    `yMax*modGrav`.
  - **Ceiling push-out**: `while(hitTest(0,-50)) { y += 1; if (yVel<0) yVel = 0; }` — headroom
    probe 50px above origin.
  - **Side-wall probes** (`Movement.as:364-462`): four discrete point tests per side at
    `dx = ±17`, `dy ∈ {-20,-25,-35,-45}` (native px above the origin). If **any** of the 4 points
    on the leading side hits solid, the unit is pushed out **1px per iteration** (`x -= 1` /
    `x += 1`) until clear. Nothing is probed between `dy=0` and `dy=-20`, so the shins/feet never
    register as blocked by a side wall — this is what lets a unit stand flush against a low ledge
    instead of catching on it.
  - **Buried-in-geometry recovery**: `while(hitTest(0,0)) unit.y -= 0.5;`.
  - **Ground-tilt lean** (grounded only, `Movement.as:406-448`): starting from `dy=-10` at both
    `dx=-10` and `dx=+10`, walks each probe outward (`tiltL`/`tiltR`, up to 30 steps) until it
    finds open air, then (if both stayed under 20) computes
    `tiltAngle = getRotation(-10,tiltL, 10,tiltR) - 90` and eases `MC.rotation` toward it at
    `0.3`/frame; airborne, the lean target is forced to `0`. This is the source angle multiplied
    by `modSlide` in §2.3's `xVelSlide`.
  - While crouching and grounded, `nextAnim` is forced to `"duck"` here, overriding whatever the
    horizontal branch set.

### 2.5 Jump / double-jump / jump-pad (`doJump()`, `Movement.as:126-199`)

Guards (early-return, no jump at all): `unit.abilityPause`, `!game.gameStarted`, `crouching`.

1. **Jump-pad kick**: if `modSideJump` is non-zero, `xVel` is **hard-set** (not added) to
   `modSideJump` — a diagonal pad snaps horizontal speed instantly.
2. **Mega-jump** (`modMegaJump`, set by hazard-surface case or a jump-pad node): plays
   `S_Jumppad`, forces `jumping = manualJump = dJump = true` (consumes the double jump up front),
   `yVel -= yJump * modJump` (`modJump` here is the pad's power multiplier, can exceed 1), goes to
   the `"tuck"` animation, spawns a `smoke_big` effect. This branch does **not** `return`, so if
   `modMegaJump` is also true it still falls into the checks below — but since `jumping` is now
   true, only the `else if (!dJump)` double-jump branch could fire next, and `dJump` was just set
   true, so nothing else happens this call.
3. **First jump** (`!jumping`): `unit.y -= yJumpBoost` (instant 6px hop), `yVel -= yJump * modJump`,
   `jumping = manualJump = true`, animation `"jump"`.
4. **Double jump** (`jumping && !dJump`): `yVel = yVel*0.5 - yDjump` (halve current vertical
   velocity, THEN subtract 10 — keeps the double-jump's added height consistent regardless of
   where in the arc it fires), `dJump = true`, animation `"tuck"`, spawns `smoke_med`. If
   `manualJump` (this is a player-triggered double jump, not e.g. a pad landing without ever
   pressing jump) **and** a horizontal direction is held, triggers the signature 360° spin:
   `spinning = true; spinCur = 0; spinNew = ±360` (sign = held direction). Note this spin trigger
   has **no vertical-velocity gate** in the source — it fires on *any* manual double jump with a
   direction held, regardless of how weak the resulting hop is.
5. Once `jumping` and `dJump` are both true, a further `doJump()` call falls through every branch
   and does nothing (no triple jump).

### 2.6 Terrain / surface modifiers (`Unit.as:634-1079`, inside `UnitEnterFrame()`)

Every frame, `resetMods()` zeroes all eight `mov.mod*` fields, then the pixel directly under the
feet (`getPixel(0,1)`, i.e. `arena.wall.getPixel32(x, y+1)`) is decoded from its RGB hex string
into a numbered surface case (`Unit.as:648-768`, a big string→int switch), which then sets the
mods for **this frame only**:

| Surface hex | Effect |
|---|---|
| `ffff02` / `ffff04` | Achievement triggers (cat / health), no movement effect |
| `ff00ff` | Tutorial scripted-event trigger tile (no movement effect) |
| `""` (no pixel) | Default open ground — no mods |
| `ff0000` | Instant death trigger tile (handled elsewhere, no movement effect here) |
| `ffffcd` | `modBrake = 10` (very slippery / heavy stop) |
| `00fff1`/`ffffcd`-adjacent low-grav band | `modMegaJump=true, modJump=1.2` |
| `00fff2..00fff9` (9 tiers) | Escalating mega-jump pad tiers: `modJump` from **1.4 up to 3.3**, some tiers also set `modSideJump` (±28..±55, diagonal launch) and `modBrake=3` |
| `00ccff` | `modJump=1.8, modSideJump=-28, modMegaJump=true` |
| `00ccf3` | `modJump=0.9, modSideJump=37, modMegaJump=true` |
| `00ccf9` | `modJump=1.2, modSideJump=-40, modMegaJump=true` |
| `00ccf4` | `modJump=1.3, modSideJump=55, modBrake=3, modMegaJump=true` |
| `00ccf8` | `modJump=1.3, modSideJump=-55, modBrake=3, modMegaJump=true` |
| `993300` (mud) | `modSpeed=0.3, modBrake=0.25, modSlide=0.2` + `mud_splash` particles while moving |
| `ccffff` (ice) | `modSpeed=0.3, modBrake=1, modSlide=0.3` |
| `ffffff` (snow) | `modBrake=3` + footprint/snow-splash particles |
| `cccccc` (sand) | footstep/sand-splash particles only, no physics mod |
| `650065` (low-grav zone) | `modJump=0.3, modGrav=0.6` |
| `6699ff` (water shallow) | `sFire=0` (extinguish), `modMax=0.75, modJump=0.3, modGrav=0.6, modBrake=2` |
| `000099` (water deep) | `sFire=0`, `modMax=0.75, modJump=0.75, modBrake=2` + sand-splash particles |
| `00ff00` (toxic) | `modMax=0.6, modJump=0.6, modBrake=2` + damage-over-time + toxicsizzle particle |
| `666666` (conveyor right) | `modMove = 8` (constant rightward push, added straight into `unit.x`) |
| `999999` (conveyor left) | `modMove = -8` |
| `320000` | instant death (`status.damage(9999,...)`) |
| `300000` | 0.5 dmg/frame hazard tick |
| `f00007` | 0.5 dmg/frame **and** `modMegaJump=true, modJump=2.6` (damaging mega-jump pad) |
| anything else | case `33`, no mods |

This switch is also what drives `MC.goto(nextAnim)` at the very end of `UnitEnterFrame()`
(`Unit.as:1080`), and the arm/head aim rotation described in §4.4.

### 2.7 Combat-relevant note: no live-unit knockback

Nowhere in `Movement.as` or `Unit.as` does taking damage perturb `xVel`/`yVel`/position. Weapon
`force` values (`Stats_Guns`) are consumed only by the Box2D **corpse** (`PhysActor`, created in
`Unit.die()` → `game.physWorld.createCorpse`). A living unit standing in gunfire never flinches,
staggers, or gets shoved — hits only drain HP/shield.

## 3. Current port state

`raze-ts/src/game/Unit.ts` reimplements this system directly in the `Unit` class (no separate
`Movement` object — the fields live on `this.moving`/`this.jumping` and the per-frame logic is
`moveUnit()`, `doJump()`, `resolveAxis*`, `tryStepUp`, `updateTilt`, `applyFlip`).

### 3.1 Constants — exact match

`Unit.ts:1025-1033` (`respawn()`), reproduced verbatim from `Movement.as:36-98`:

```
this.moving = { vel: 0, acc: 2.1, brake: 1.7, crouchBrake: 0.5, airAcc: 1.5, airBrake: 0.4, max: 11 };
```

and in `doJump()` (`Unit.ts:1109-1168`): jump impulse `-13 * modJump`, `yJumpBoost` equivalent
`this.y -= 6` (first jump only), gravity `0.8`, fall cap `20`, double-jump `vel/2 - 10`. All six
headline numbers (`xAcc, xBrake, xCrouchBrake, xAirAcc, xAirBrake, xMax`) and all five vertical
constants (`yGrav, yMax, yJump, yJumpBoost, yDjump`) match the source exactly — a code comment at
`Unit.ts:1022-1024` explicitly documents that an earlier "30% slower" tuning was removed in favour
of matching the original feel.

### 3.2 Horizontal integration — matches, with one architectural difference

`Unit.ts:1280-1301` mirrors the LEFT/RIGHT/brake branch structure exactly, including:
- the `+3` over-speed input slack (`m.vel > -(maxV + 3)` / `m.vel < maxV + 3`);
- the `×2.5` brake multiplier when grounded and over max speed;
- crouch disabling acceleration (falls to the brake branch);
- airborne forcing crouch off happens earlier, in `moveUnit()`'s `if (!(keys&DOWN)) crouching=false`.

Difference: terrain `modSpeed/modMax/modBrake` are looked up once per tick
(`this.game.arena.wallMask?.surfaceTypeAt(...)`) and applied as local multipliers
(`maxV = m.max * modMax`, etc.) — functionally equivalent to the source's `resetMods()` +
switch-case pattern, but implemented as a single `SurfaceMods` object lookup (`WallMask.ts`)
instead of a giant hex-string switch. The **specific per-tile numeric values** in `WallMask`
should be checked against §2.6's table (out of scope for this doc — cross-reference whichever
terrain/hazard doc ends up owning `WallMask`'s surface table; today that's referenced from
`Unit.ts` comments as "doc 01 §7" / "doc 12 §2.3", i.e. domains 06 and 15 in the current
numbering — **flagged as a naming mismatch to fix**, see §6).

The `xVelSlide` ground-tilt slide (§2.3 step 4) is ported as:
```
if (sm.modSlide && !this.jumping) this.x += (this.tilt * 180 / Math.PI) * sm.modSlide;
```
(`Unit.ts:1324-1327`) — converts the port's radian `tilt` to degrees to match the source's
`MC.rotation` (which is in degrees) before multiplying by `modSlide`. This is a reasonable
translation but does **not** reproduce the source's easing/deadzone on `xVelSlide` itself (the
port applies the instantaneous tilt-derived slide every tick with no persistence once the surface
is left, whereas the source's `xVelSlide` decays by 0.05/frame and folds into `xVel` after leaving
the surface). Minor feel difference on icy/muddy surfaces only.

Conveyor `modMove` is ported 1:1 (`Unit.ts:1317-1320`, added to `x` then re-resolved).

### 3.3 Vertical integration & collision — reimplemented, not probe-for-probe identical

This is the largest architectural divergence, by design (documented in the port's own comments):

| Source (`Movement.as`) | Port (`Unit.ts`) |
|---|---|
| `hitTest(dx,dy)` = single-pixel `getPixel32` sample against the arena's rendered wall bitmap, filtered to alpha=`ff` | `WallMask.solidAt(x,y)` / `surfaceUnder(x,y,band)` — a precomputed mask queried the same way, but built once from the level geometry rather than sampled from a live bitmap each call |
| Ground test: `hitTest(0,9) && !hitTest(0,-1)` | `onGround()`: solid sampled at `y+2` across three x-offsets (`x`, `l+1`, `r-1`) — a 3-point stance-width test vs. the source's single-point test |
| Side-wall: 4 point probes at `dx=±17`, `dy∈{-20,-25,-35,-45}` | Identical: `resolveAxisMask` uses `sx = 17*scale`, `probeH = [-20,-25,-35,-45]` (`Unit.ts:1521-1522`) — this one **is** probe-for-probe faithful |
| Push-out: 1px/iteration loop, uncapped | Same 1px/iteration loop, capped at 48 iterations (`Unit.ts:1542`) — a safety bound absent from the source |
| Ceiling probe: single point at `dy=-50` | `Unit.ts:1550-1557`: solid tested at the AABB top (`bounds().t`, which is `-128*scale` standing / `-104*scale` crouched) across 3 x-offsets, pushed out 1px/iter capped at 24 |
| Ground-tilt lean: 30-step outward walk from `dx=±10` | `updateTilt()` (`Unit.ts:1203-1219`): analytic — samples `groundYAt(x±26*scale)` (two point lookups, not a walk) and computes `atan2`, eased at `0.15`/frame (vs. source's `0.3`/frame) with a `0.6` rad (~34°) cutoff to ignore true cliffs — **not in the source**, which has no cliff cutoff (the tilt walk simply gives up after 30 steps and both sides being `<20` gates whether it applies at all, which has a similar effect but isn't the same test) |
| **Step-up / stairs**: none — the source's side-wall probes simply don't reach below `dy=-20`, so short risers are naturally not felt as walls | **Explicit `tryStepUp()`** (`Unit.ts:1594-1609`), capped at `STEP_UP_MAX=30` native px, added because the port's arena art is meshed as axis-aligned rect staircases where the source's original hand-placed collision was smoother. This is a **deliberate compensating feature**, called out in the port's own comments (`Unit.ts:97-106`) — not a bug, but a divergence worth flagging since it changes traversal feel on genuine short walls vs. stairs. |

### 3.4 Double jump / flip — matches with one gate difference

`doJump()` (`Unit.ts:1109-1153`) reproduces the halve-then-subtract double-jump formula and the
tuck-on-double-jump behavior. The 360° flip trigger differs from §2.5 point 4: the port requires
`this.jumping.vel < -10` (a **vertical-velocity gate not present in the source**) **and** a
direction held, whereas the source triggers the spin on any `manualJump` double jump with
direction held regardless of resulting velocity. Port comment at `Unit.ts:1147-1151`
acknowledges this as an intentional interpretation ("the full 360° spin only fires on a strong
upward double jump"), so weak/late double jumps with direction held will NOT spin in the port but
DO spin in Raze 2.

Jump-pad launch (`launchPad()`, `Unit.ts:1162-1168`) reproduces the diagonal hard-set of `xVel`
and the `-13*power` impulse, and forces `dJump=true` immediately (matching §2.5 point 2's
"consumes the double jump up front" behavior) — faithful.

### 3.5 Combat interaction — intentionally diverges, flagged in-source

`Unit.LIVE_KNOCKBACK` (`Unit.ts:149`, default `false`) and the guarded `addKnockback()` /
`applyHitStun()` (`Unit.ts:1648-1664`) are **invented port features that do not exist in Raze 2**
(§2.7) and are off by default specifically to match the source. They exist only so weapon code
compiles/has somewhere to call; flipping the switch is an explicit, documented departure from the
original if ever desired.

### 3.6 Rendering / rig — cross-reference only

The baked per-state body art + arm-welding rig (`armRig.json`, `ArmArt`/`AnimNoArm`/`AnimNoHead`/
`PartArt`/`SkinAnim`, `Unit.ts:452-860`) is a separate, already-completed extraction effort (see
the character-rig memory note / prior art) and is **not respecified here**. The only fact this doc
needs from it is the **per-state frame count**, since that is the animation half of the state
machine (§4):

`armRig.json` `states` (native px, `rootY=-61.5`):

| State | Frame count (`arm[].length`) |
|---|---|
| `idle` | 20 |
| `run` | 19 |
| `runback` | 19 |
| `jump` | 20 |
| `fall` | 25 |
| `crouch` | 25 |
| `tuck` | 34 |
| `idleRobot` | 51 |
| `idleZombie` | 51 |

`Unit.ts` state selection (`computeAnimState()`, `Unit.ts:633-643`) maps the movement flags to one
of `idle/run/runback/jump/fall/crouch/tuck` (renamed from the source's `duck`/`duckloop`/`getup` —
see §4.2) purely from `crouching`/`jumping`/`tucking`/velocity sign vs. facing — a clean,
memoized re-derivation of the source's `nextAnim` assignments scattered through §2.4/§2.6, rather
than a line-by-line port of `nextAnim`. This is a legitimate simplification since the inputs
(`crouching`, `jumping`, velocity, facing) are the same signals the source switches on.

## 4. Movement / animation state machine

### 4.1 UnitMC timeline (`UnitMC.as`, `DefineSprite_441`, 230 frames confirmed by the 230 exported
SVG frames under `sprites/DefineSprite_441_UnitMC/`)

`UnitMC` is a single 230-frame MovieClip timeline with named frame labels (`idle`, `run`, `jump`,
`fall`, `tuck`, `land`, `landrun`, `landrunback`, `runback`, `duck`, `duckloop`, `getup`,
`armorlock`) that `goto()` jumps between via `gotoAndPlay(label)`. The exact frame-number ranges
of each label were **not recoverable from the SVG frame export** (FFDec's SVG dump does not carry
`FrameLabel` tags) — only the frame-script callback points are known precisely, from
`addFrameScript` (`UnitMC.as:65-91`):

| Absolute frame | Callback | Effect |
|---|---|---|
| 1 | `frame1` | `goto("idle", true)` — force-loop restart of idle |
| 20 | `frame20` | `goto("idle", true)` |
| 41 | `frame41` | `goto("run", true)` |
| 54 | `frame54` | `goto("run", true)` |
| 69 | `frame69` | `goto("fall")` (guarded — no-op if already in `jump`/`tuck`, see §4.2) |
| 84 | `frame84` | `stop()` |
| 99 | `frame99` | `goto("idle", true)` |
| 127 | `frame127` | `stop()` |
| 145 | `frame145` | `goto("runback", true)` |
| 160 | `frame160` | `goto("runback", true)` |
| 179 | `frame179` | `goto("duckloop", true)` |
| 183 | `frame183` | `goto("idle", true)` (guarded — becomes `"getup"` if leaving `duck`/`duckloop`, see §4.2) |
| 230 | `frame230` | `abilityDone(); goto("idle", true)` — end of the `armorlock` (Static Field ability) animation |

Reading this against the frame counts in §3.6, the loop points at 20/41/54/99/145/160/179 are
consistent with: idle intro (1-19) looping into idle-loop (20-40), run intro (41-53) looping into
run-loop (54-68), a fall/jump/land block (69-98) that free-runs and stops at 127 pending an
external `goto()` (i.e. `jump`/`tuck`/`land`/`landrun`/`landrunback` all live somewhere in
69-127 as sub-labels reached directly by `gotoAndPlay`, not by falling through frame-by-frame),
idle resume at 99, runback intro (145-159) looping into runback-loop (160-178), and a
duck/duckloop/getup/armorlock block from 179-230.

### 4.2 `goto()` transition guard (`UnitMC.as:137-193`)

`goto(state, force=false)` is the only way `Unit`/`Movement` change the visible animation. With
`force=false` (the normal path from `nextAnim`), these transitions are **suppressed** (the clip
keeps playing whatever it's already doing):

| From (`curAnim`) | To requested | Result |
|---|---|---|
| `armorlock` | anything | always suppressed — the Static Field animation cannot be interrupted |
| `jump` | `fall` | suppressed — jump must finish before fall shows (avoids retriggering fall every tick while still rising) |
| `tuck` | `fall` | suppressed — same, for the double-jump tuck |
| `land` | `idle` | suppressed — let the landing recovery frame play out |
| `landrun` | `run` | suppressed |
| `landrunback` | `runback` | suppressed |
| `duckloop` | `duck` | suppressed |
| `duck` | `idle` | **redirected** to `"getup"` (stand-up animation plays instead of snapping to idle) |
| `duckloop` | `idle` | **redirected** to `"getup"` |
| `getup` | `idle` | suppressed — let getup finish |

Everything else transitions immediately. `doJump()`/`doAbility()` call `goto(label, true)` for
`jump`/`tuck`/`armorlock`, bypassing all of the above guards (force-starts the animation even if
already playing it, restarting from frame 1 of that label).

Naming note: the source's crouch states are `duck`/`duckloop`/`getup`; the port collapses these
into a single `"crouch"` render state (`armRig.json` has one `crouch` entry, not three) and has no
equivalent to the `getup` recovery animation — `computeAnimState()` returns to `"idle"` the instant
`crouching` goes false, with no stand-up transition. See §5 for whether to port this.

### 4.3 Facing & the double-jump 360° spin

`flip` (source `Unit.as:1081-1096`, port `facing`, `Unit.ts:1255`) determines which way the
character is drawn: while airborne, `flip = aimX < x` (purely horizontal — do I need to face left
to reach the cursor); while grounded, `flip = fixRotation(aimRoation - MC.rotation) < 0` (relative
to the current ground-tilt rotation, not the raw aim angle) — a subtlety the port's `facing = aimX
> x ? 1 : -1` (`Unit.ts:1255`) does not reproduce (it always uses the airborne horizontal-only
rule, grounded or not). In practice this rarely diverges since ground tilt is usually near 0, but
on a sloped/tilted stance the source's facing flip can trigger at a slightly different aim angle
than the port's.

The spin itself is a separate visual layer: `spinMC` (source, a child `Sprite` wrapping `MC`) /
`charC` (port, `Unit.ts:240`, pivoted at `TORSO_PIVOT_Y`) is rotated independently of the body's
own walk/tilt animation, eased toward `±360°` and snapped back to `0`/reset once the ease
converges (source: `Movement.as:292-307`, at `0.3`/frame grounded, `0.15` airborne — matches; the
port's `applyFlip()` instead steps a **fixed** `FLIP_STEP=0.36` rad/frame (`Unit.ts:1187`, ~2.6
frames per 15°) rather than easing exponentially toward the target, so the spin has constant
angular velocity in the port vs. an ease-out curve in the source, and always completes a full
2π regardless of jump duration whereas the source's spin can be cut short if the unit lands before
`spinCur` converges).

### 4.4 Arm/head aim (`Unit.as:1096-1140`)

Every frame (in the same `UnitEnterFrame` surface-switch tail that also sets `nextAnim`):
1. `rotArm = getRotation(x + arm1.x + MC.rotation*1.2, y + arm1.y, aimX, aimY) - 90` — angle from
   the shoulder (offset slightly by the body's ground tilt, ×1.2) to the aim point, minus 90°
   (arm art's rest pose is vertical).
2. If `abilityPause` (e.g. mid-Static-Field), `rotArm` is forced to `(flip?180:0) + MC.rotation`
   (arm snaps to the body's own facing, ignoring aim, while locked down).
3. `aimRoation = fixRotation(rotArm + 90) + spinMC.rotation` — the value used for the facing-flip
   test in §4.3 and exposed as the "aim rotation" elsewhere (HUD crosshair etc.).
4. If `flip`, `rotArm = -rotArm + 180` (mirror for the flipped body).
5. `rotArm = fixRotation(rotArm - rotation) + (flip ? MC.rotation : -MC.rotation)` — convert back
   into the body's local rotation space.
6. Reload dip: `rotReload` eases (`×0.2`/frame) toward `30°` while `gun.reloading && rotArm<30`,
   else toward `0` — an extra downward tilt of the arm while reloading, layered additively.
7. `MC.arm1.rotation = MC.arm2.rotation = rotReload + rotArm`; `MC.head.rotation = rotReload +
   rotArm*0.6` — **the head only follows the arm/aim at 60% rate**, giving the "look mostly at the
   target, don't fully commit the neck" feel.

Port equivalent: `updateHead()` (`Unit.ts:800-835`) computes a **clamped ±32° half-rate turn
relative to the facing direction** (`HEAD_FOLLOW=0.5`, `HEAD_CLAMP=32`) rather than the source's
unclamped `×0.6` of the *arm's* rotation (which itself is already the full aim angle, mirrored and
reload-dipped). The port's head therefore has a hard stop-at-90°-look-back rule the source does not
have (though the source's own geometry means the head rarely visually exceeds a similar range in
practice, since it is 60% of an arm angle that itself points at the cursor). The arm rotation logic
(`Unit.ts:776-786`, `arm.rotation = world - this.tilt` with the recoil `kick` and per-weapon `off.rot`
folded in) is a reasonable re-derivation of the same end result (arm points at cursor, mirrored by
facing, tilted by ground lean) without replicating the source's exact intermediate-space algebra —
functionally equivalent for a non-tilted stance, potential minor divergence in the small window
where ground tilt is non-zero.

## 5. Gap analysis

| # | Raze 2 target | Port today | Severity |
|---|---|---|---|
| 1 | Headline accel/brake/speed/gravity/jump constants | Exact match (`Unit.ts:1025-1033`, `1109-1168`) | None |
| 2 | Side-wall 4-point probe collision (`dx=±17`, 4 heights) | Exact match (`Unit.ts:1521-1522`) | None |
| 3 | Pixel-bitmap `hitTest` sampling | Precomputed `WallMask` — same query shape, different backing data structure | Cosmetic/architectural, not a feel bug |
| 4 | Ground-tilt lean: 30-step probe walk, eases `0.3`/frame, no cliff cutoff | Analytic two-point `atan2` sample, eases `0.15`/frame, hard 0.6 rad cliff cutoff | Low — different code path, similar visual result on stairs; slower ease may read as "floatier" tilt |
| 5 | `xVelSlide` persists (decays 0.05/frame) after leaving a slide surface | Port applies tilt×modSlide only while `sm.modSlide` truthy this tick, no persistence | Low — only visible on ice/mud edges |
| 6 | Double-jump 360° spin fires on ANY manual double jump w/ direction held | Port gates on `jumping.vel < -10` | Medium — weak/late double jumps lose the spin in the port |
| 7 | Spin eases exponentially toward ±360° (can be cut short by landing) | Fixed `0.36` rad/frame linear step, always completes | Low-Medium — spin duration/feel differs, always-full-rotation vs. source's landing-cut spin |
| 8 | Grounded facing-flip uses tilt-relative aim angle | Port always uses raw horizontal aimX vs x comparison | Very low — only diverges under nonzero ground tilt |
| 9 | Head follows `armRotation × 0.6`, unclamped | Port: `±32°` clamp, half-rate of aim-vs-facing delta | Low — visually similar, different formula |
| 10 | No live-unit knockback/hit-stun | Port has the mechanic, off by default (`LIVE_KNOCKBACK=false`) | None while default holds — flag if ever enabled |
| 11 | No step-up assist (short risers just don't register as walls, per probe gap) | Explicit `tryStepUp` (30px cap) — compensates for stair-meshed level art | Intentional, by design; verify it doesn't let the port climb ledges the source would block |
| 12 | 3 crouch states (`duck`/`duckloop`/`getup`) incl. a stand-up recovery anim | Single `crouch` render state, instant idle on release (no getup) | Medium if a stand-up animation is later baked/desired |
| 13 | Terrain modifier table keyed by wall-bitmap hex colour (§2.6, 30 cases) | `WallMask.surfaceTypeAt` — table contents not verified against this doc (out of scope; see §6) | Needs a follow-up check against whichever doc owns `WallMask`'s data |
| 14 | Exact `UnitMC` frame-label ranges for `jump/tuck/land/landrun/landrunback` (69-127 block) | Not needed by the port (it derives animation state analytically, not via a shared timeline), informational only | None — flagged only for completeness (§6) |

## 6. Implementation checklist (for the LATER build phase — do NOT do it now)

1. **Verify/port §2.6's terrain modifier table** into whichever module owns `WallMask.surfaceTypeAt`
   (today apparently `raze-ts/src/game/WallMask.ts`, referenced from `Unit.ts` comments as "doc 01
   §7"/"doc 12 §2.3" — those doc numbers predate this reorganization into 15 numbered specs;
   whoever writes the terrain/hazard doc (06 or 15) should reconcile the comment cross-references
   in `Unit.ts` to point at the correct new doc number).
2. If matching feel exactly matters: change the double-jump spin trigger in `Unit.ts:1149` to drop
   the `this.jumping.vel < -10` gate (source has no velocity gate, only "manualJump + direction
   held").
3. If matching feel exactly matters: replace the fixed `FLIP_STEP` linear spin (`Unit.ts:1177-1196`)
   with an eased approach to `±360°` (`spinCur += (spinNew-spinCur)*k`, `k=0.3` grounded / `0.15`
   airborne) so the spin can be cut short by an early landing, matching `Movement.as:292-307`.
4. Consider porting the `xVelSlide` persistence-after-leaving-surface behavior (§2.3 step 4,
   `Gap #5`) if ice/mud edge feel is ever scrutinized closely.
5. Consider adding a `getup` recovery animation state distinct from `idle` when standing up from
   crouch (`Gap #12`), if/when the animated-skin or part-rig art gets a dedicated stand-up bake;
   requires new art, not just code.
6. Low priority: align the grounded facing-flip test (`Gap #8`) to use tilt-relative aim angle
   instead of raw horizontal comparison, for exact parity on tilted stances.
7. None of the above should touch `armRig.json`, `ArmArt`, `PartArt`, `SkinAnim`, or any other
   already-completed rig/rendering asset — this doc's scope is physics/state-machine only.

## 7. Open questions / data still missing

- **Exact frame-label ranges** inside the `jump`/`tuck`/`land`/`landrun`/`landrunback` block
  (frames 69-127 of `UnitMC`'s 230-frame timeline) were not recoverable from the SVG frame export
  (FFDec's SVG dump drops `FrameLabel` tags). A full FFDec GUI open of `raze-2.swf` →
  `DefineSprite_441` → Timeline panel would show the exact labels/ranges if ever needed; not
  required by the port today since it derives animation state analytically rather than sharing
  Raze 2's single timeline.
- **`WallMask`'s actual per-tile numeric table** was not audited against §2.6 in this pass (out of
  scope per the README's single-domain-per-doc rule) — flagged in the gap analysis (#13) and
  checklist (#1) for whichever doc/agent owns terrain hazards.
- The stale "doc 01 §7" / "doc 12 §2.3" comment cross-references inside `Unit.ts` (surface mods,
  jump pads) predate the current 15-domain numbering and should be swept once the terrain/jump-pad
  doc exists, to avoid pointing future readers at the wrong file.
