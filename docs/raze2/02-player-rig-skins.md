# Raze 2 — Player rig, animation & skins

Source: `UnitMC.as` (SWF symbol 441, `DefineSpriteTag spriteId="441"`, `frameCount="230"`), `Unit.as`, `Movement.as`, `Stats_Skins.as`, all under `decompiled_swf/raze 2/scripts/`. Frame-label/frame-count ground truth was pulled with FFDec (`-swf2xml`) directly from the sprite's `FrameLabelTag`/`ShowFrameTag` records, not guessed from the compiled frame-script list. SWF-wide `frameRate="30.0"` (`raze-2.swf` header) — all timelines below run at **30 fps**.

## 1. Part rig

`UnitMC` (`scripts/UnitMC.as:29`) extends `MovieClip` and declares these instance fields, each a nested symbol placed on the `UnitMC` timeline:

| Field | Declared type | SWF symbol id | Sprite name | Notes |
|---|---|---|---|---|
| `body` | `PhysBody` | 279 | `DefineSprite_279_PhysBody` | Torso; hosts the `ability` sub-clip (`body.ability`, `UnitMC.as:205`) |
| `head` | `PhysHead` | 313 | `DefineSprite_313_PhysHead` | Independently rotated, repositioned every frame (§2) |
| `headhold` | `PhysHead` | 313 | same symbol as `head` | Invisible marker instance baked into the body's walk/run/jump art; supplies `head`'s target x/y each frame. `visible=false` set in the constructor (`UnitMC.as:93`) |
| `arm1` | `MovieClip` (generic) | container: `DefineSprite_387_..._Unit_Arms1_27` | Front (aiming) arm assembly | Contains `armup`, `armlow`, `hand1`, `hand2` |
| `arm2` | `MovieClip` (generic) | container: `DefineSprite_136_..._Unit_Arms2_14` | Back arm assembly | Contains `armup`, `armlow` (no separate hand skin call — see §4) |
| `arm1hold` | `MovieClip` | — | Invisible marker baked into the body art (`visible=false` set in constructor, `UnitMC.as:100`) | Supplies both `arm1` and `arm2`'s target x/y (shoulder point) |
| `legup1`, `legup2` | `PhysUpperLeg` | 226 | `DefineSprite_226_PhysUpperLeg` | Thigh, front/back leg |
| `leglow1`, `leglow2` | `PhysLowerLeg` | 196 | `DefineSprite_196_PhysLowerLeg` | Shin |
| `foot1`, `foot2` | `PhysFoot` | 166 | `DefineSprite_166_PhysFoot` | |

Sub-parts of the arm assemblies (verified against `sprites/` directory, no dedicated `.as` class — placed by symbol name on the `arm1`/`arm2` timelines):

| Field (child of `arm1`/`arm2`) | SWF symbol id | Sprite name |
|---|---|---|
| `armup` | 132 | `DefineSprite_132_PhysUpperArm` |
| `armlow` | 102 | `DefineSprite_102_PhysLowerArm` |
| `hand1`, `hand2` (arm1 only) | 342 | `DefineSprite_342_PhysHand` (class `PhysHand`, `scripts/PhysHand.as:5`) |

Despite the "Phys" naming (`PhysBody`, `PhysHead`, `PhysUpperLeg`, `PhysLowerLeg`, `PhysFoot`, `PhysHand`), **legs, feet, body and (baseline) head/arm poses are plain hand-keyframed Flash animation** — there is no per-frame Box2D synchronization of these clips in `Unit.as`/`Movement.as` for the on-screen rig (Box2D in this file is used for other systems — bullets/world — not the character skeleton). The "Phys" classes are just typed wrappers so `setPart()`/`gotoAndStop()` can be called on them.

`UnitMC(param1:Unit)` constructor (`UnitMC.as:62-101`): stores the owning `Unit`, hides `headhold` and `arm1hold`, and registers the frame scripts covering the state machine (see §3).

## 2. Holder logic & aim tracking (per-`EnterFrame`)

### 2.1 UnitMC.EnterFrame — weld head/arms to the body's baked pose

```
UnitMC.as:103-109
public function EnterFrame() : void {
   head.x = headhold.x;
   head.y = headhold.y;
   arm1.x = arm2.x = arm1hold.x;
   arm1.y = arm2.y = arm1hold.y;
}
```

`headhold` and `arm1hold` are invisible instances baked directly into the body/leg walk-cycle art at whatever position the shoulder/neck should be for that exact frame (bob, lean, crouch offset, jump tuck, etc.). Every frame, the actually-visible `head`/`arm1`/`arm2` clips are snapped onto those markers' *current* local x/y. This decouples "where the shoulder sits this frame of the run cycle" (driven by the body timeline, art-authored) from "which way the head/arm is rotated" (driven by code, aim-authored) — the body can bob and lean freely while the aiming rig stays welded to the right anchor point.

### 2.2 Unit — aim rotation, arm/head angle, facing flip

All of this runs in `Unit`'s per-frame update (`scripts/Unit.as:1080-1136`), after `MC.goto(nextAnim)` has already been called for the current movement state:

```
Unit.as:1096-1097   flip = (jumping) ? (aimX < x) : (UT.fixRotation(aimRoation - MC.rotation) < 0)
                     MC.scaleX = flip ? -1 : 1
Unit.as:1098         rotArm = UT.getRotation(x + MC.arm1.x + MC.rotation*1.2, y + MC.arm1.y, aimX, aimY) - 90
Unit.as:1099-1102    if abilityPause: rotArm = (flip?180:0) + MC.rotation   // frozen pose during e.g. armor-lock ability
Unit.as:1103         aimRoation = UT.fixRotation(rotArm + 90) + spinMC.rotation
Unit.as:1104-1113    if flip: rotArm = -rotArm + 180                        // mirror the arm angle when facing left
Unit.as:1114         rotArm = UT.fixRotation(rotArm - rotation) + (flip ? MC.rotation : -MC.rotation)
Unit.as:1115-1122    rotReload += ((gun.reloading && rotArm<30 ? 30:0) - rotReload) * 0.2   // reload recoil-dip lerp
Unit.as:1123         MC.arm1.rotation = rotReload + rotArm
Unit.as:1129         MC.arm2.rotation = rotReload + rotArm
Unit.as:1130-1136    MC.head.rotation = rotReload + rotArm * 0.6            // head tracks aim at 0.6x arm rate
```

Key points to port:
- **Facing (`flip`)**: while airborne, facing is derived from `aimX` vs. `x` (purely which side the cursor/target is on); while grounded, it's derived from whether the aim angle relative to the body's current ground-tilt rotation (`MC.rotation`, set by slope-detection in `Movement.as`) is negative. `MC.scaleX = flip ? -1 : 1` — a straight horizontal mirror of the whole `UnitMC`, not a per-part flip.
- **Arm rotation base**: `UT.getRotation(shoulderWorldX, shoulderWorldY, aimX, aimY) - 90`, where the shoulder world position factors in `MC.arm1.x` (i.e. `arm1hold`'s baked x) and a lean term `MC.rotation * 1.2`.
- **Ability freeze**: during `abilityPause` (e.g. the armor-lock ability, see §3.6) the arm angle is pinned to `0`/`180` + body rotation instead of tracking the aim.
- **Mirroring math**: when `flip` is true the raw `rotArm` is re-expressed as `-rotArm + 180` before the final `fixRotation(rotArm - rotation) + (flip ? MC.rotation : -MC.rotation)` step, so the arm continues to point at the aim point correctly under horizontal mirroring and under ground-tilt (`rotation`, the body's slope-follow angle, separate from `MC.rotation`).
- **Reload dip**: `rotReload` is a small (`~30`) lerped-in offset added to the arm/head rotation while `gun.reloading` is true and the arm isn't already raised past 30°, giving a slight dip-and-recover motion during reloads — smoothed at `0.2` per frame (not a hard cut).
- **Head lag**: head rotation = `rotReload + rotArm * 0.6` — the head is welded to the same base angle as the arm but scaled to 60%, so it turns less far than the arm (a look/lean rather than a full point).
- **Navigation arrow** (`navarrow`, bot pathing UI only, not part of the visible rig): `rotation = UT.getRotation(x,y,navFocus.x,navFocus.y)` (`Unit.as:1139`) — unrelated to the player-facing rig, included here only to avoid confusing it with `aimRoation` if grepping nearby lines.

## 3. Animation states — exact frame ranges

`UnitMC.goto(anim:String, force:Boolean=false)` (`UnitMC.as:137-193`) is the sole entry point for changing animation. Unless `force` is true it runs a table of "ignore this request" guards before doing `curAnim = anim; gotoAndPlay(curAnim)`:

| Guard (current → requested) | Effect |
|---|---|
| `curAnim == requested` | no-op (unless forced) |
| `curAnim == "armorlock"` | **any** request ignored — ability pose can't be interrupted by movement |
| `"jump" → "fall"` | ignored (jump plays out fully before fall can take over) |
| `"tuck" → "fall"` | ignored (tuck — the double-jump flip — holds until it naturally stops, see §3.7) |
| `"land" → "idle"` | ignored |
| `"landrun" → "run"` | ignored |
| `"landrunback" → "runback"` | ignored |
| `"duckloop" → "duck"` | ignored |
| `"duck" → "idle"` | **redirected** to `"getup"` |
| `"duckloop" → "idle"` | **redirected** to `"getup"` |
| `"getup" → "idle"` | ignored (getup must finish) |

Frame labels and lengths, extracted from the compiled sprite (`FrameLabelTag` positions, `frameRate=30`; frame count of a label = next label's start frame − this label's start frame, 1-based, inclusive):

| Label | Start frame | End frame | Length (frames) | Length @30fps |
|---|---|---|---|---|
| `idle` | 1 | 20 | 20 | 0.667s |
| `run` | 21 | 41 | 21 | 0.700s |
| `landrun` | 42 | 55 | 14 | 0.467s |
| `jump` | 56 | 69 | 14 | 0.467s |
| `fall` | 70 | 84 | 15 | 0.500s |
| `land` | 85 | 99 | 15 | 0.500s |
| `tuck` | 100 | 127 | 28 | 0.933s |
| `runback` | 128 | 145 | 18 | 0.600s |
| `landrunback` | 146 | 160 | 15 | 0.500s |
| `duck` | 161 | 163 | 3 | 0.100s |
| `duckloop` | 164 | 179 | 16 | 0.533s |
| `getup` | 180 | 183 | 4 | 0.133s |
| `armorlock` | 184 | 230 | 47 | 1.567s |

There is no separate `crouch`/`runback`-labeled species-idle variant on this timeline — those are the only 13 labels in symbol 441.

### 3.1 Frame-script wiring (confirms the table above)

`UnitMC`'s constructor registers `addFrameScript` at 0-based frame indices (`UnitMC.as:65-91`); converted to 1-based frame numbers and cross-referenced against the label ranges:

| Frame (1-based) | Falls in label | Script | Behavior |
|---|---|---|---|
| 1 | `idle` (start) | `goto("idle", true)` | Sets `curAnim` on construction |
| 20 | `idle` (end) | `goto("idle", true)` | Loop `idle` (1↔20) |
| 41 | `run` (end) | `goto("run", true)` | Loop `run` (21↔41) |
| 54 | `landrun` (2nd-to-last) | `goto("run", true)` | `landrun` plays once (42-54) then snaps into the `run` loop |
| 69 | `jump` (end) | `goto("fall")` | `jump` plays once then falls through to `fall` (unforced — but `fall` has no guard blocking a `jump`-originated call since the guard only blocks the reverse direction being re-requested externally) |
| 84 | `fall` (end) | `stop()` | `fall` holds its last pose until `Movement` calls `land`/`landrun`/`landrunback` |
| 99 | `land` (end) | `goto("idle", true)` | `land` plays once then returns to `idle` |
| 127 | `tuck` (end) | `stop()` | `tuck` (double-jump flip pose) holds its last frame until landing |
| 145 | `runback` (end) | `goto("runback", true)` | Loop `runback` (128↔145) |
| 160 | `landrunback` (end) | `goto("runback", true)` | `landrunback` plays once then snaps into `runback` loop |
| 179 | `duckloop` (end) | `goto("duckloop", true)` | Loop `duckloop` (164↔179); `duck` (161-163) plays once first, falling straight through into `duckloop` with no script needed |
| 183 | `getup` (end) | `goto("idle", true)` | `getup` plays once then returns to `idle` |
| 230 | `armorlock` (end) | `abilityDone(); goto("idle", true)` | Ability pose ends, notifies `Unit.abilityDone()`, returns to `idle` |

### 3.2 Movement → animation-state mapping

`Movement.as` sets `unit.nextAnim`, then `Unit.as:1080` calls `MC.goto(nextAnim)` every frame:

| Condition (`Movement.as`) | `nextAnim` |
|---|---|
| Holding move-into-facing key while grounded/airborne, not crouching (`:217-243`) | `"run"` (moving with facing) or `"runback"` (moving against facing) — mirrored by `unit.flip` |
| No horizontal input (or crouching) (`:252`) | `"idle"` |
| Airborne and just touched ground (`yVel>0`), holding a move key (`:322-329`) | `"landrun"` / `"landrunback"` (direction-dependent, mirrored by `flip`) |
| Airborne and just touched ground, no move key (`:332`) | `"land"` |
| Not touching ground (`:346`) | `"fall"` |
| Grounded, holding Down, resting against a wall/slope check (`:451`) | `"duck"` |

`Movement.doJump()` (`Movement.as:126-179`) additionally forces the animation directly (bypassing `nextAnim`) via `unit.MC.goto(...)`:

| Jump case | Call |
|---|---|
| Jump-pad-boosted mega jump (`modMegaJump`) (`:144-151`) | `MC.goto("tuck")` |
| Normal single jump (`:160-165`) | `MC.goto("jump")` |
| Double jump (`!dJump`) (`:167-178`) | `MC.goto("tuck")` |

So `"tuck"` (the 28-frame flip/spin pose) is used both for a jump-pad mega-jump and for the manual double jump; `"jump"` is the plain first-jump pose.

### 3.3 Ability pose (`armorlock`)

`Unit.doAbility()` (`Unit.as:1151` onward) sets `abilityPause = true` and calls `MC.goto("armorlock", true)` plus `MC.arm1.gotoAndPlay("armorlock")` / `MC.arm2.gotoAndPlay("armorlock")` for at least one ability variant (`Unit.as:1203-1208`) — the arms have their own independent `"armorlock"` labels so the whole rig (body + both arms) enters the frozen ability pose together. While `curAnim=="armorlock"`, `goto()`'s first guard rejects every other movement-driven `goto()` call (§3), and the aim-tracking code in §2.2 substitutes a fixed arm angle instead of tracking the cursor. Frame 230's script (`abilityDone(); goto("idle", true)`) is what ends it.

### 3.4 Species idles

`UnitMC`/`Stats_Skins` (this SWF revision) do **not** define separate idle timelines per race — `setSkin()` (§4) simply reskins every part via `gotoAndStop(frame)`; the pose/animation timeline (idle/run/etc., §3) is identical for Human/Alien/Robot/Zombie skins. The only skin-conditional pose logic found is the "lol cats" easter-egg mode (`UnitMC.as:203`): `setPart(head, MatchSettings.specialMode != "lol cats" ? curSkin : "cat")` — in that mode the head ignores the skin's frame and always shows a `"cat"`-labeled frame instead.

## 4. Skins (`Stats_Skins.as`)

`Stats_Skins.Init()` (`Stats_Skins.as:54-129`) populates `skinAr` (array, index = registration order) and `skinOb` (id-keyed lookup) via `addSkin(frame, id, cost, blood, race, name)` (`Stats_Skins.as:131-143`). All 31 skins, in registration order:

| # | `frame` | `id` | Name | Race | Blood type | Cost |
|---|---|---|---|---|---|---|
| 0 | 3 | `raze` | Raze Soldier | Human | `bloodHuman` | 0 |
| 1 | 4 | `raze2` | Covert Ops | Human | `bloodHuman` | 0 |
| 2 | 152 | `raze3` | Cpt. Biggs | Human | `bloodHuman` | 50 |
| 3 | 1 | `space` | Space | Human | `bloodHuman` | 50 |
| 4 | 2 | `camo` | Camouflage | Human | `bloodHuman` | 50 |
| 5 | 6 | `soldier` | Soldier | Human | `bloodHuman` | 50 |
| 6 | 5 | `soldier2` | Soldier (Alt) | Human | `bloodHuman` | 50 |
| 7 | 7 | `rambo` | Johnny Rockit | Human | `bloodHuman` | 100 |
| 8 | 8 | `rambo2` | Johnny Rambo | Human | `bloodHuman` | 100 |
| 9 | 9 | `mine` | Miner | Human | `bloodHuman` | 100 |
| 10 | 10 | `girl` | Dani | Human | `bloodHuman` | 100 |
| 11 | 11 | `girl2` | Dani (Helmet) | Human | `bloodHuman` | 100 |
| 12 | 12 | `addison` | AddisonR | Human | `bloodHuman` | 250 |
| 13 | 13 | `justin` | Juice-Tin | Human | `bloodHuman` | 250 |
| 14 | 50 | `asnow` | Albino Alien | Alien | `bloodAlien` | 150 |
| 15 | 51 | `adesert` | Desert Alien | Alien | `bloodAlien` | 150 |
| 16 | 52 | `amarine` | Marine Alien | Alien | `bloodAlien` | 150 |
| 17 | 53 | `aspace` | Space Alien | Alien | `bloodAlien` | 150 |
| 18 | 54 | `ajungle` | Jungle Alien | Alien | `bloodAlien` | 150 |
| 19 | 55 | `acommander` | Commander Alien | Alien | `bloodAlien` | 200 |
| 20 | 100 | `bdesert` | Desert Bot | Robot | `bloodRobot` | 150 |
| 21 | 101 | `bspace` | Space Bot | Robot | `bloodRobot` | 150 |
| 22 | 102 | `bmine` | Mining Bot | Robot | `bloodRobot` | 150 |
| 23 | 103 | `bsnow` | Snow Bot | Robot | `bloodRobot` | 200 |
| 24 | 104 | `bjungle` | Jungle Bot | Robot | `bloodRobot` | 200 |
| 25 | 150 | `zurban` | Urban Zombie | Zombie | `bloodZombie` | 150 |
| 26 | 151 | `zbeach` | Beach Zombie | Zombie | `bloodZombie` | 150 |
| 27 | 153 | `zelderly` | Elderly Zombie | Zombie | `bloodZombie` | 150 |
| 28 | 154 | `zbiker` | Biker Zombie | Zombie | `bloodZombie` | 200 |
| 29 | 155 | `zbiker2` | Biker Zombie (Alt) | Zombie | `bloodZombie` | 200 |
| 30 | 14 | `mutate` | Mutate | Human (labelled) | `bloodZombie` | **−1** |

Notes:
- **Four races**, not two: `Human`, `Alien`, `Robot`, `Zombie` (`race` field literal strings). The task brief's "Human/Alien" is only part of the picture — document all four.
- **`blood` is independent of `race`**: e.g. `mutate` is `race="Human"` but `blood="bloodZombie"` (presumably a Human skin that spawns zombie-colored blood/gore for a joke/mode). Blood type strings seen: `bloodHuman`, `bloodAlien`, `bloodRobot`, `bloodZombie`.
- **`cost` of `-1`** on `mutate` is a sentinel (likely "not purchasable / unlock-only" rather than a real price) — the cost-summing loop at `Stats_Skins.as:118-127` explicitly only adds costs `> 0`, skipping both the two free starter skins (cost `0`) and the sentinel (`-1`).
- `num` (`Stats_Skins.as:140`, `_loc7_.num = skinAr.length` before push) is just the registration index — identical to the `#` column above, and to array position in `skinAr`.
- `frame` values are **not** unique per race band in a simple way — they were clearly assigned by an internal numbering scheme (Human loosely 1-14, Alien 50-55, Robot 100-104, Zombie 150-155) but are not contiguous/sequential within a race (e.g. Human has `1,2,3,4,5,6,7,8,9,10,11,12,13,152` — `raze3`/Cpt. Biggs breaks the pattern at 152, inside the Zombie-numbered band).

### 4.1 The "skin = shared frame index" model

`UnitMC.setSkin(param1:uint)` (`UnitMC.as:195-222`):

```
unit.skin = Stats_Skins.skinAr[param1];       // param1 is the registration index (#/num), not `frame`
curSkin   = unit.skin.frame;                  // the frame index to apply everywhere
setPart(head,  specialMode!="lol cats" ? curSkin : "cat");
setPart(body,  curSkin);
setPart(body.ability, unit.ability.sprite);   // NOT skin-driven — this is the equipped-ability icon
setPart(arm1.armup,  curSkin);  setPart(arm1.armlow, curSkin);
setPart(arm1.hand1,  curSkin);  setPart(arm1.hand2,  curSkin);
setPart(arm2.armup,  curSkin);  setPart(arm2.armlow, curSkin);
setPart(legup1, curSkin); setPart(legup2, curSkin);
setPart(leglow1,curSkin); setPart(leglow2,curSkin);
setPart(foot1,  curSkin); setPart(foot2,  curSkin);
```

`setPart(clip, frame)` (`UnitMC.as:224-227`) is just `clip.gotoAndStop(frame)`. So **every part symbol** (`PhysHead`, `PhysBody`, `PhysUpperArm`×2, `PhysLowerArm`×2, `PhysHand`×2, `PhysUpperLeg`×2, `PhysLowerLeg`×2, `PhysFoot`×2 — 13 clips total) is authored as its own independent multi-frame timeline where **frame N on every part's timeline draws that same part in the same skin's colors/costume**. Selecting a skin is nothing more than telling all 13 clips to stop on the same shared frame number (`curSkin`, from `Stats_Skins.frame`) — there is no per-part remapping table; the frame-index vocabulary is common across the whole rig by authoring convention. `arm2` only has `armup`/`armlow` reskinned (no `hand1`/`hand2` on the back arm — consistent with it being the un-aimed rear arm, likely rendered without a visible hand or reusing a baked hand texture already on `armlow`).

Two skin-adjacent things are explicitly **not** part of this shared-frame mechanism:
- `body.ability` is skinned by `unit.ability.sprite` (the equipped ability's own icon id), independent of the character skin.
- The "lol cats" special mode overrides only the `head` part to a `"cat"`-labeled frame, ignoring `curSkin` for that one clip.

## Port status

Port files: `src/game/Unit.ts`, `src/assets/raze2/skins.json`, `src/assets/SkinArt.ts`, `src/assets/raze2/skinAnim.json`.

**Correct:**
- Skin catalogue (`skins.json`) — all 31 skins present with matching `frame`/`id`/`cost`/`blood`/`race`/`name` (spot-checked against `Stats_Skins.as`; counts match, 31 entries).
- Part-symbol IDs are documented in `SkinArt.ts`'s header comment (body 279, head 313, armup 132, armlow 102, hand 342, and implicitly legs/feet) and correctly describe the "one shared frame index across all parts" model in prose.
- Core state list `idle/run/jump/fall/crouch/runback` is present in `skinAnim.json` with baked shoulder-position tracks (`SkinAnim.shoulder`), and `Unit.ts` picks among them via a `moveState()`-equivalent (`Unit.ts:566-580`).
- Aim tracking is ported at a conceptual level: `Unit.ts` tracks `aimRotation`, welds the arm to a per-frame `shoulder()` track, and turns the head "at roughly half-rate" toward the aim (`Unit.ts:733-765`) — matches the spirit of `rotArm`/`head.rotation = rotReload + rotArm*0.6`, though the port uses a smoothed/clamped turn rather than the SWF's direct `*0.6` multiply every frame (worth a closer diff if exact head-lag feel matters).
- Facing flip via horizontal mirror is present (`Unit.ts:657`, "flipped by facing").
- Double-jump → tuck pose is ported (`Unit.ts:1038-1046`), including gating the full 360° spin on `vel < -10 && L/R held`, matching `doSpin` semantics referenced in the port's own comment.

**Wrong / incomplete:**
- **Rig architecture is fundamentally different from the SWF.** The port does not implement a live per-part rig (13 independently-skinned clips + `headhold`/`arm1hold` welding). Instead it uses **pre-baked composite sprite sheets** per skin per state (`skinAnim.json`: body+head+legs baked into one texture per frame; only the aim arm+gun stay as a live overlay welded to a baked `shoulder` track). This is a deliberate, documented simplification (see `SkinArt.ts:6-31` comment) driven by FFDec's inability to bake an AS3-`gotoAndStop`-selected skin automatically — but it means per-part skin swapping, the `headhold`/`arm1hold` two-tier weld, and independent leg/foot clips do not exist in the port; they're flattened into raster frames.
- **Missing animation states**: `landrun`, `land`, `landrunback`, `duck` (distinct 3-frame lead-in), `getup`, and `armorlock` (ability-freeze pose) have no equivalent in `skinAnim.json`'s 6-state list. `tuck` has no dedicated bake either — `Unit.ts:566-567,669-671` explicitly falls back to the `jump` art for `tuck`, so the double-jump flip currently reuses the jump pose rather than the SWF's distinct 28-frame tuck/spin animation.
- **No landing-transition animations**: the SWF's `land`/`landrun`/`landrunback` (played once on touchdown before returning to `idle`/`run`/`runback`) are absent; the port likely snaps directly between `fall` and `idle`/`run`/`runback` with no landing frame.
- **No duck vs. duckloop distinction**: the SWF has a 3-frame `duck` lead-in that free-falls into a 16-frame looping `duckloop`, plus a 4-frame `getup` played once when leaving crouch. The port's single `crouch` state (`Unit.ts:572`) likely collapses this into one loop with no lead-in/lead-out.
- **No ability/`armorlock` freeze pose or the `goto()` guard table**: the SWF's extensive "ignore this transition" rules in `UnitMC.goto()` (§3, e.g. `armorlock` blocking all other requests, `jump`→`fall` ignored, `duck`/`duckloop`→`idle` redirected to `getup`) do not appear to have a ported equivalent; the port's `moveState()`-style function (`Unit.ts:562-580`) picks a state fresh each frame from current physics flags rather than reproducing the SWF's stateful transition-guard machine, so some of the SWF's "commit to an animation until it naturally finishes" behavior (e.g. `land` can't be cut short by input) may not be reproduced.
- **`body.ability` skin-frame** (equipped-ability icon shown on the torso, independent of the character skin) has no obviously named counterpart found in the port files reviewed — verify separately if the ability icon overlay is a planned/existing feature elsewhere in the codebase.
- **"lol cats" head override** is a very low-priority easter egg; not expected to be ported, noting only for completeness.
- Exact reload-dip (`rotReload`, lerp at `0.2`/frame, triggered when `gun.reloading && rotArm<30`) and the precise mirrored-angle algebra in §2.2 (`rotArm = -rotArm+180` under flip, then `fixRotation(rotArm-rotation) + (flip?MC.rotation:-MC.rotation)`) should be diffed line-by-line against `Unit.ts`'s aiming code if exact-feel parity is required — the port's comments suggest a broadly equivalent but not necessarily bit-identical formula.
