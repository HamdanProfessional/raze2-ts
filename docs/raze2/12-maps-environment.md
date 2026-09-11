# Raze 2 — Maps & Environment

Sources: `scripts/Stats_Maps.as`, `scripts/Stats_Maps_2.as`, `scripts/Arena.as`,
`scripts/Bg.as`, `scripts/BgSky.as`, `scripts/Stats_MapParticles.as`,
`scripts/Unit.as`, `scripts/Movement.as`, `scripts/MatchSettings.as`,
`scripts/Node*.as`, `scripts/S_Jumppad.as`, plus the port's own extracted
`src/assets/raze2maps.json` (which already contains ground-truth per-map
geometry — spawns/CTF/hold/pickups/jump-pad rects — presumably lifted by
running the SWF or walking `DefineSprite_1341_Arena`'s child instances, since
`Stats_Maps.getMap()` itself is gutted in this decompile; see §1).

Both `Stats_Maps.as` and `Stats_Maps_2.as` are byte-identical (the "_2" variant
is not a different build), so `Stats_Maps_2.as` is not cited separately below.

## 1. Map roster (`Stats_Maps.mapOrder`)

`scripts/Stats_Maps.as:41`:

```
mapOrder = ["jungle","jungle2","city","city2","desert","desert2","ocean","ocean2",
            "mines","mines2","space","space2","snow","snow2","tutq","tutq2"];
```

16 map ids, 8 "themes" × a base/"2" pair. **There is no "toxic" map id in Raze 2**
— the task brief's "toxic" is a Raze‑1 level name; Raze 2's tutorial/quarantine
theme is `tutq`/`tutq2` (Toxic-styled visually per `S_MapParticles` swap to
`toxicsizzle`/green surface effects on some maps, but the id itself is `tutq`).

`getMap(id)` (`Stats_Maps.as:44-67`) is **gutted by the obfuscator**: the real
`switch(id) { case "jungle": ... }` body has been replaced with
`§§push("test"); §§push(id); switch(§§pop()) { case §§pop(): }` — a stack-based
no-op that never matches, so the decompiled source only shows the fallback
`"test"` map object (`id`, `map:"test"`, `bg1:""`, `bg2:""`, `sky:""`,
`particles:"test"`, `name:"Test Map"`, `desc:"For devs only!"`). Only the shape
of the returned object (`id, map, bg1, bg2, sky, particles, name, desc`) and the
`mapOrder` list survive **the decompiled source**.

They do survive the **bytecode**, though (`tools/maps/bg_labels.py`). Each case
in `getMap`'s ABC method body is a run of `getlocal_2 ; pushstring <value> ;
setproperty <slot>`, and the slot number names the field — 3009 `map`, 3010
`bg1`, 3011 `bg2`, 3012 `sky`, 3013 `particles`, 3014 `name`, 3015 `desc`.
Reading the slot rather than guessing from adjacency is what catches the fields
whose value is the empty string, which is how `jungle` is authored: it has **no
`bg1` layer at all**. The recovered table is in §3.5; every bg/sky value in it
was checked against the real frame labels, so a misread could not pass silently.

What *is* recoverable, from `Arena.as:792-795` (`Arena` constructor):

```as
gotoAndStop(MatchSettings.map.map);                      // Arena timeline -> wallMC/collision frame
game.bg1.gotoAndStop(MatchSettings.map.bg1);              // parallax layer 1 frame
game.bg2.gotoAndStop(MatchSettings.map.bg2);              // parallax layer 2 frame
game.bgSky.gotoAndStop(MatchSettings.specialMode=="lol cats" ? "lol cats" : MatchSettings.map.sky); // sky frame
```

So each `getMap()` result is 4 frame keys (`map`, `bg1`, `bg2`, `sky`, all
presumably frame **labels**, since they're passed straight to
`gotoAndStop`) plus a particle-system key (`particles`, used as a `switch`
selector string in `Stats_MapParticles`, see §5) and a `name`/`desc` pair shown
on the map-select screen. `specialMode == "lol cats"` is an April-Fools/joke
override that forces `bgSky` to a `"lol cats"` frame regardless of map.

### 1.1 What the port already extracted (`src/assets/raze2maps.json`)

The port ships ground-truth geometry for **10 of the 16** map ids — the full
`jungle`/`jungle2`/`mines`/`mines2` pairs but only the base half of the other
four theme pairs:

| id | w×h (px) | spawns | ctf | hold | pickups | jump pads | mask/bg assets |
|---|---|---|---|---|---|---|---|
| `jungle` | 2874×2025 | 30 | 2 | 3 | 21 | 4 | `raze2/jungle_{mask,bg}.png` |
| `jungle2` | 2874×2025 (identical geometry to `jungle`) | 30 | 2 | 3 | 21 | 4 | `raze2/jungle2_{mask,bg}.png` |
| `city` | 2867×1867 | 26 | 2 | 3 | 19 | 4 | `raze2/city_{mask,bg}.png` |
| `desert` | 2757×1335 | 26 | 2 | 3 | 11 | 1 | `raze2/desert_{mask,bg}.png` |
| `ocean` | 2161×1921 | 30 | 2 | 3 | 14 | 2 | `raze2/ocean_{mask,bg}.png` |
| `mines` | 2351×1965 | 30 | 2 | 3 | 16 | 3 | `raze2/mines_{mask,bg}.png` |
| `mines2` | 2351×1965 (identical geometry to `mines`) | 30 | 2 | 3 | 16 | 3 | `raze2/mines2_{mask,bg}.png` |
| `space` | 2849×2848 | 33 | 2 | 3 | 16 | 2 | `raze2/space_{mask,bg}.png` |
| `snow` | 2809×2018 | 27 | 2 | 3 | 14 | 2 | `raze2/snow_{mask,bg}.png` |
| `tutq` | 2806×2023 | 27 | 2 | 3 | 9 | 1 | `raze2/tutq_{mask,bg}.png` |

`city2`, `desert2`, `ocean2`, `space2`, `snow2`, `tutq2` are **absent** from
`raze2maps.json` and have no mask/bg PNGs on disk
(`src/assets/raze2/*.png` only has the 10 base names above + `jungle2`/`mines2`)
— confirmed by `Backgrounds.ts` (`r2_<id>` cache keys) and `WallMasks.loadAll`
(`src/game/WallMask.ts:131-145`), both of which only iterate whatever keys
exist in `raze2maps.json`.

`jungle`/`jungle2` and `mines`/`mines2` having byte-identical spawn/ctf/hold/
pickup/jump-pad arrays confirms the design pattern implied by `Arena.as`: a
"2" map reuses the **same `wallMC` collision frame and node layout** as its
base map, and differs only in `bg1`/`bg2`/`sky` (a palette/time-of-day
reskin — e.g. night version), not geometry. This means `city2`/`desert2`/
`ocean2`/`space2`/`snow2`/`tutq2` can very likely be approximated for the port
by reusing the base map's `raze2maps.json` entry verbatim (mask, spawns, ctf,
hold, pickups, jumpPads) and only need a distinct background/sky texture —
they are not missing geometry, just missing art.

Pickup id format in `pickups`: `"{p|w}_{kind}_{respawnSecs}"` (`p_` = static
item pickup, `w_` = weapon pickup, `w_rand_10` = random weapon, `_15`/`_20`
etc = respawn seconds) — matches `NodePickup`'s own name-parsing in §4.3.

## 2. Arena structure (`DefineSprite_1341_Arena`, `scripts/Arena.as`)

`Arena extends MovieClip`, embedded from `assets.swf` symbol `symbol1341`
(`Arena.as:34-35`). `DefineSprite_1341_Arena` has 36 exported timeline-frame
SVGs in the decompile, but only frames **2–14** get an `addFrameScript` (13
frames wired to `init()`; `Arena.as:761-790`); frame 1 has no script (likely
the `"test"` map / default state). Given `mapOrder` pairs 8 themes into
frames and `jungle`/`mines` pairs share one frame (per §1.1), 13 scripted
non-default frames is consistent with **not every one of the 16 ids owning a
distinct frame** — most "2" variants reuse their base's frame.

### 2.1 Per-frame node/container fields

The `Arena` class body is almost entirely typed instance fields injected by
the SWF's symbol timeline — one field per named child instance on whichever
frame is active. Categories seen in `Arena.as:38-756`:

| Field pattern | Type | Meaning |
|---|---|---|
| `<letter(s)>[_<n>]` e.g. `f`, `d_1`, `k_2` | `NodeSpawn` | spawn points (see §4.1) |
| `<letters>_<con>` e.g. `b_qce`, `g_zbd` | `NodeWaypoint` | AI waypoint graph nodes (see §4.4) |
| `<con>_<action>` e.g. `ik_d`, `s_j` | `NodeAiAction` | AI action trigger boxes (see §4.5) |
| `<id>__<team>` e.g. `a__1`, `s__2` | `NodeCtfFlag` | CTF flag stands (see §4.2) |
| `p_<kind>_<secs>` / `w_<num‖rand>_<secs>` | `NodePickup` | item/weapon pickups (see §4.3) |
| `wallMC` | `MovieClip` | collision-geometry vector art, rasterized into `wall` |
| `waterMC` | `MovieClip` | water surface geometry, handed to `game.water.setWater()` |
| `reflectTake1`/`reflectTake2` | `MovieClip` | source regions captured into `refData1`/`refData2` reflections |
| `reflectShow1`/`reflectShow2`, `reflectCam2` | `MovieClip` | on-screen reflection display planes |
| `bridge`, `bridge2`, `bridge3`, `tread1..8`, `gear1..5`, `light`, `heart`, `arrow` | `MovieClip` | per-map decoration/animated set-pieces (tutorial map specifically — `bridge*`, `gear*`, `arrow`, `heart` strongly suggest the `tutq` tutorial map's scripted intro) |
| `midCont`, `botCont`, `topCont` | `MovieClip` | z-order layering containers for AI-debug graphics (`botCont` is drawn into by `NodeWaypoint.setConnectors`/`setActionBox`) |

`Arena(game:Game)` constructor (`Arena.as:758-796`): wires all 13 frame
scripts to `init()`, stores `game`, then calls
`gotoAndStop(MatchSettings.map.map)` and sets `game.bg1`/`game.bg2`/
`game.bgSky` frames per §1.

### 2.2 `wall: BitmapData` — the collision model

`init()` (`Arena.as:809-1031`), always run once per map load (from whichever
frame's `init()` frame-script fires):

```as
wall = new BitmapData(wallMC.width, wallMC.height, true, 0);  // ARGB, transparent
wall.draw(wallMC);                                             // rasterize the vector wall art
wallMC.visible = false;                                        // hide the source art
```

`changeWallFrame(frame, relative)` (`Arena.as:798-807`) re-draws `wall` from a
different `wallMC` frame (used for the tutorial's scripted sequence,
`sEvent`-driven, `Unit.as:904`: `game.arena.changeWallFrame(sEvent)`), by
clearing the bitmap and re-`draw()`-ing.

**Collision test (`Movement.hitTest`, `scripts/Movement.as:471-479`):**

```as
public function hitTest(dx:Number=0, dy:Number=0):uint {
   var px:uint = unit.game.arena.wall.getPixel32(unit.x+dx, unit.y+dy);
   if (px) return px.toString(16).substring(0,2) == "ff" ? px : 0;
   return px;
}
```

Only pixels with **full alpha (`ff`)** count as solid — this is the actual
wall/ground/ceiling collision test used all over `Movement.EnterFrame` (feet
at `(0,1)`/`(0,9)`, head at `(0,-1)`, side probes at `(±17,-20/-25/-35/-45)`
for ledge grabs, tilt probes at `(±10, tiltL/tiltR)` for slope-following
rotation). So `wallMC` art must be drawn with **opaque (alpha=255) fills for
anything solid** and any other alpha for terrain-effect overlays (§2.3) or
pure decoration.

**Terrain-effect surface read (`Unit.EnterFrame`, `scripts/Unit.as:635-642,
1369-1372`):**

```as
protected function getPixel(dx:Number=0, dy:Number=0):uint {
   return game.arena.wall.getPixel32(x+dx, y+dy);
}
...
surface = getPixel(0,1).toString(16).substring(2);   // full 32-bit ARGB hex, drop the 2 alpha digits -> 6-digit RGB
```

This samples the **same** `wall` bitmap one pixel below the unit's feet, but
keeps the *color* (RGB), not the alpha — so a semi-transparent colored region
in the `wallMC` art can carry a terrain identity (jump pad, mud, water, lava,
…) at a pixel `hitTest` treats as non-solid (alpha≠ff), letting a unit stand
*on top of* the solid ground below while a color-only decal marks the tile.

### 2.3 Wall-color → surface-effect table (`Unit.as:648-1079`)

The color hex string is first mapped to a small integer index, then that
index selects a `Movement`-mod bundle applied every frame the unit's feet are
over that pixel (`mov.resetMods()` runs first each frame, so effects are not
sticky — leaving the colored zone reverts to defaults):

| RGB hex | idx | Effect | Notes |
|---|---|---|---|
| `ffff02` | 0 | `Stats_Achievements.setAchievement("cat")` | one-off event tile |
| `ffff04` | 1 | `Stats_Achievements.setAchievement("health")` | one-off event tile |
| `ff00ff` | 2 | tutorial `sEvent` HUD/dialogue sequencer | `tutq` scripted intro only |
| `""` (no pixel / fully transparent) | 3 | no-op | open air / plain floor |
| `ff0000` | 4 | no-op | reserved / unused in this switch |
| `ffffcd` | 5 | `modBrake = 10` | strong stick/anti-slide surface |
| `00fff1` | 6 | `modMegaJump=true; modJump=1.2` | **jump pad tier 1** |
| `00fff2` | 7 | `modMegaJump=true; modJump=1.4` | **jump pad tier 2** |
| `00fff3` | 8 | `modMegaJump=true; modJump=1.6` | **jump pad tier 3** |
| `00fff4` | 9 | `modMegaJump=true; modJump=1.75` | **jump pad tier 4** |
| `00fff5` | 10 | `modMegaJump=true; modJump=1.9` | **jump pad tier 5** |
| `00fff6` | 11 | `modMegaJump=true; modJump=2.2` | **jump pad tier 6** |
| `00fff7` | 12 | `modMegaJump=true; modJump=2.65` | **jump pad tier 7** |
| `00fff8` | 13 | `modMegaJump=true; modJump=2.8` | **jump pad tier 8** |
| `00fff9` | 14 | `modMegaJump=true; modJump=3.3` | **jump pad tier 9 (strongest)** |
| `00ccff` | 15 | `modJump=1.8; modSideJump=-28` | **diagonal jump pad** (kick left) |
| `00ccf3` | 16 | `modJump=0.9; modSideJump=37` | **diagonal jump pad** (weak, kick right) |
| `00ccf9` | 17 | `modJump=1.2; modSideJump=-40` | **diagonal jump pad** (kick left) |
| `00ccf4` | 18 | `modJump=1.3; modSideJump=55; modBrake=3` | **diagonal jump pad** (kick right, braked) |
| `00ccf8` | 19 | `modJump=1.3; modSideJump=-55; modBrake=3` | **diagonal jump pad** (kick left, braked) |
| `993300` | 20 | `modSpeed=.3; modBrake=.25; modSlide=.2` + `mud_splash` fx | mud |
| `ccffff` | 21 | `modSpeed=.3; modBrake=1; modSlide=.3` | ice (slide, no footstep fx coded) |
| `ffffff` | 22 | `modBrake=3` + `footprint`/`snow_splash` fx | snow |
| `cccccc` | 23 | `footprint`/`sand_splash` fx only | sand (no speed change) |
| `650065` | 24 | `modJump=.3; modGrav=.6` | low-gravity zone |
| `6699ff` | 25 | `status.sFire=0; modMax=.75; modJump=.3; modGrav=.6; modBrake=2` | water (shallow — douses fire, floaty) |
| `000099` | 26 | `status.sFire=0; modMax=.75; modJump=.75; modBrake=2` + `sand_splash` fx | water (deep) |
| `00ff00` | 27 | `modMax=.6; modJump=.6; modBrake=2` + `toxicsizzle` fx | toxic sludge |
| `666666` | 28 | `modMove=8` | conveyor (right) |
| `999999` | 29 | `modMove=-8` | conveyor (left) |
| `320000` | 30 | `status.damage(9999, ...)` | instant-death zone |
| `300000` | 31 | `status.damage(0.5, ...)` | damage-over-time (lava/hazard) |
| `f00007` | 32 | `status.damage(0.5,...); modMegaJump=true; modJump=2.6` | hazard **+ jump pad combo** |
| *(default)* | 33 | no-op | any other color |

**Jump pads in Raze 2 are therefore not a distinct sprite/node class** —
there is no `NodeJumppad`. They are pure *color-coded regions of the `wallMC`
vector art* (alpha < 255 so `hitTest` doesn't treat them as solid, RGB one of
the `00fffN`/`00ccfN` values above), read once per frame from `wall` under
the unit's feet. `S_Jumppad` (`scripts/S_Jumppad.as`, embeds
`2138_S_Jumppad.mp3`) is the pad launch sound.

**Activation is not automatic on contact** — `modMegaJump`/`modJump`/
`modSideJump` are recomputed every frame while standing on the color, but the
actual launch impulse only fires inside `Movement.doJump()`
(`scripts/Movement.as:126-158`), which is only invoked by:
- `Player.as:354` — the player's jump key press, or
- `AI.as:610-616` — a bot executing a `NodeAiAction` waypoint action-box with
  `action == "j"`/`"d"` while inside that box's rect (level designers place an
  AI action box over each pad so bots know to press jump there).

So a human player must **actively press Jump while standing on the pad**
to get the boosted launch; walking onto a pad without jumping does nothing
extra (`Movement.EnterFrame`'s per-frame color-mod recompute is the only
"passive" effect, and mud/ice/etc. terrain mods *are* passive since they only
change acceleration/friction, not launch state).

`doJump()` launch math when `modMegaJump`:
```as
if (modSideJump) xVel = modSideJump;         // instant, not additive — snaps horizontal vel
game.playScreenSound(S_Jumppad, x, y);
jumping = true; manualJump = true; dJump = true;   // consumes the double-jump too
yVel -= yJump * modJump;                      // yJump = 13 (Movement.as:58)
unit.MC.goto("tuck");
game.createEffect(x, y-20, "smoke_big");
```
So launch velocity = `-13 * modJump` (straight tiers 6–14, 32) or
`-13 * modJump` plus a hard-set `xVel = modSideJump` (diagonal tiers 15–19).
Base normal jump is `yJump=13` (`modJump` defaults to 1), double-jump adds
`yDjump=10` (`Movement.as:62`), gravity `yGrav=0.8` (`:54`), terminal fall
`yMax=20` (`:56`).

## 3. Camera, parallax backgrounds, water/reflections (`Arena.as`)

### 3.1 Camera (`focus`, `EnterFrame`, `Arena.as:1055-1196`)

- `focus(target, useAim=true, intensity=0.5)` sets `camFocus`; `useAim` toggles
  mouse-relative aim-lead framing vs. straight dead-center-on-target.
- Each frame: if `!useAim`, camera target = `(WIDTH*0.5 - targetX, HEIGHT*0.5
  - targetY + 20)`; if `useAim`, subtracts
  `(mouseX-WIDTH*0.5)*camIntenseX` / `(mouseY-HEIGHT*0.5)*camIntenseY` for a
  parallax "look-ahead" toward the cursor.
- Screen shake: `setShake(x,y)` raises `shakeX`/`shakeY` (only if higher than
  current), decayed `-0.2`/frame; per-frame offset is `UT.rand(-shakeX,
  shakeX)` (re-rolled every frame, not eased).
- Camera position eases toward target at `0.7` (`x += (target-x)*0.7`), then
  is clamped: `x` in `[-(wall.width-WIDTH), 0]`, `y` in
  `[-(wall.height-HEIGHT)+45, 5]` (`Arena.as:1149-1170`) — i.e. the world
  never scrolls past its edges, with a slight top/bottom margin.

### 3.2 Parallax background offsets (`Arena.as:1172-1175`)

```as
game.bg1.x = (WIDTH  - bg1.width)  * (arena.x / (WIDTH  - wall.width));
game.bg1.y = (HEIGHT - bg1.height) * (arena.y / (HEIGHT - wall.height));
game.bg2.x = (WIDTH  - bg2.width)  * (arena.x / (WIDTH  - wall.width));
game.bg2.y = (HEIGHT - bg2.height) * (arena.y / (HEIGHT - wall.height));
```
Both layers are driven by the **same** ratio of camera position to world size,
scaled by each layer's own oversize (`bgN.width/height` > screen size, so as
`arena.x/y` sweeps its clamped range, each `bgN` sweeps the *remaining* slack in
its own oversize). Because `bg1`/`bg2` share the formula and only differ by
their own embedded art size (`Bg`, symbol `1365`, per §3.4), **the parallax
"depth" difference between bg1 and bg2 comes entirely from how much bigger each
layer's source art is than the screen** — there's no separate speed multiplier
constant. `bgSky` is not offset at all in `EnterFrame` (it's a static backdrop
behind everything, only its *frame* changes per map/`"lol cats"`).

`Game.as:105-110` fixes the depth order, and it is the opposite of what the
names suggest:

```as
bgSky = new BgSky(); addChild(bgSky);
bg2   = new Bg();    addChild(bg2);     // FAR layer  — added first, drawn behind
bg1   = new Bg();    addChild(bg1);     // NEAR layer — drawn in front of bg2
arena = new Arena(this); addChild(arena);
```

So **`bg1` is the near layer**, which is why it is nearly always the bigger
piece of art and sweeps further. (`jungle2` is the exception that proves the
rule: its `bg1` is `dark`, a flat 801×600 backdrop with ~zero slack that simply
does not move.)

All three are constructed with **no placement**, so each clip's registration
point sits at stage (0,0) and the art hangs off it — `bgN.x` moves the
registration point, not the corner of the art. That offset is not small: the
ruined-city skies overhang 134px to the left of the origin, and the `red` sky's
actual gradient is exactly 800 wide (the stage) with the skyline silhouettes
spilling past it on both sides. FFDec writes the offset into each frame SVG's
root `<g transform="matrix(...)">` translate; `tools/maps/bake_bg.py` records it
as `lx/ly` in `src/assets/bgRig.json`.

### 3.5 Per-map layer assignment

Recovered by `tools/maps/bg_labels.py` (§1) and checked against the frame labels
of `DefineSprite_1365_Bg` / `DefineSprite_1421_BgSky`:

| map | bg1 (near) | bg2 (far) | sky |
|---|---|---|---|
| jungle | *(none)* | dome | red |
| jungle2 | dark | dome | night |
| city | city | city2 | city |
| desert | dunes | shipyard2 | desert |
| ocean | oceanf | oceanb | day |
| mines | mountainbig | mountainsmall | city |
| mines2 | mountainbig | mountainsmall | mday |
| space | pillars | pillarsmall | space |
| snow | snow | snow2 | day |
| tut / tutq | mountainbiglow | mountainsmalllow | tut |

### 3.3 Water & reflections

- `waterMC` (per-map instance field): if present, handed to
  `game.water.setWater(waterMC)` in `init()` — the actual wave simulation
  lives in a separate `Water`/`Stats_MapParticles`-adjacent system, not
  documented further here (out of scope: no `Water.as` file surfaced in this
  decompile pass; `Stats_MapParticles` calls `game.water.startWaveAtPos(...)`
  for the `city` map, `EnterFrame` case 2, `Stats_MapParticles.as:466-469`).
- `reflectTake1`/`reflectTake2` (source capture regions) +
  `reflectShow1`/`reflectShow2` (display planes) + `reflectCam2` (a second
  camera-follow plane): if present, `init()` allocates
  `refData1`/`refData2 : BitmapData` sized to the take region and appends a
  `Bitmap(refDataN)` into the matching `reflectShowN`.
- `doReflections()` (`Arena.as:1198-1256`), called once per frame (from
  `Game`, not shown in `Arena.as` itself): if `SD.graphLights` (graphics
  quality gate), clears `refDataN`, then draws `game.unitCont` +
  `game.lineCont` (units/tracer lines) offset by `-reflectTakeN.{x,y}`, then
  `game.bitscreen` (pickup icons/HUD-world sprites) offset by
  `-(arena.x+reflectTakeN.x, arena.y+reflectTakeN.y)` — i.e. a **live
  mirrored re-render of the gameplay layer** into the reflection bitmap, not
  a shader/flip trick.
  - `refData2`'s show/cam planes additionally **track the player** with
    lerp `0.15` (position) then `0.05` (camera plane), plus a slow
    `reflectRot += 10`/frame bob via `UT.yMoveToRot(reflectRot, 10)` — this
    is a **floating/bobbing reflection** (e.g. a puddle or lens that trails
    the player), distinct from `refData1`'s presumably fixed water-plane
    reflection.
- `destroy()` disposes `wall`/`refData1`/`refData2` `BitmapData`s on arena
  teardown.

### 3.4 `Bg` / `BgSky` classes

`scripts/Bg.as`, `scripts/BgSky.as`: both are trivial `dynamic class ... extends
MovieClip` wrappers around embedded symbols (`Bg` = `symbol1365`, `BgSky` =
`symbol1421`) whose only script is `frame1(){ stop(); }`. All map-specific
behavior is just `gotoAndStop(frameLabel)` from `Arena`'s constructor — there
is no per-map logic inside `Bg`/`BgSky` themselves. The exported sprite
folders (`DefineSprite_1365_Bg`, `DefineSprite_1421_BgSky`) contain 18 and 16
frame SVGs respectively, one per art variant. `Arena.as` requests frame
*labels*, not indices, and **FFDec's SVG export drops the labels** — but they
are in the binary FrameLabel (tag 43) records, so a raw tag walk recovers the
label→frame map without needing a live player:

- `Bg` 2 `dark`, 3 `dome`, 4 `space`, 5 `city`, 6 `city2`, 7 `oceanf`,
  8 `oceanb`, 9 `mountainbig`, 10 `mountainsmall`, 11 `dunes`, 12 `shipyard2`,
  13 `pillars`, 14 `pillarsmall`, 15 `snow`, 16 `snow2`, 17 `mountainbiglow`,
  18 `mountainsmalllow`.
- `BgSky` 2 `red`, 3 `meteor`, 4 `night`, 5 `lol cats`, 6 `city`, 7 `dawn`,
  8 `day`, 9 `mday`, 10 `desert`, 11 `space`, 12 `desert2`, 13 `nlights`,
  14 `tut`, 15 `tut_missile`, 16 `tut_attack`.

## 4. Node classes

All are children of the `Arena` sprite, named by convention
`<encoded-name>` where `NodeXxx()`'s constructor parses `this.name`.
`visible = SD.debug` is the pattern for every node with debug-only visuals
(spawns, waypoints, AI actions) — they're invisible in a normal match and only
drawn when the debug flag is set.

### 4.1 `NodeSpawn` (symbol `571`, `scripts/NodeSpawn.as`)
- `extends Sprite`. Fields: `id`, `team` (parsed from `name.split("_")` — 
  `[0]`=id, `[1]`=team, defaults `team=0` if no second token), `waypoint`
  (set via `setWaypoint()`), `initialSpawned`.
- `Arena.init()` (`Arena.as:870-885`) buckets every `NodeSpawn` child into
  `arena.spawns` (team 0 = FFA/either), `arena.spawnsT1`/`spawnsT2` — team
  numbers are **randomly swapped** each match (`Arena.as:846-858`: 50/50
  chance to flip which literal team-1 spawns count as `spawnsT1` vs
  `spawnsT2`), so team home-spawn sides aren't fixed per map.

### 4.2 `NodeCtfFlag` (symbol `588`, `scripts/NodeCtfFlag.as`)
- `extends MovieClip`. Fields: `flag` (child MC), `id`, `team`,
  `unitCaptured`. Name format `"<id>__<team>"` (double underscore).
- `setTeam(t)`: sets `team`, `gotoAndStop(t)` (visual per team).
- `capture(unit)`: if `unit.team != this.team` → picks up the flag (hides
  `flag`, sets `unit.status.sInvis=0`, `unit.hasFlag=this`, plays
  `S_Equip`, HUD feed "has taken the Flag!"); if `unit.team == this.team`
  and `unit.hasFlag` → scores the capture (`score.flagCap++`, HUD "Flag
  Captured!", resets the carried flag, `pscore++`, plays `S_Jumppad` sound
  — reused as the "score" stinger, not just pad-launch), calls
  `matchSettings.updateScores()`.
- `reset()`: returns the flag to its stand, clears `unitCaptured.hasFlag`.
- `Arena.init()` only activates CTF flags when `MatchSettings.type ==
  "Capture the Flag"` (otherwise hidden); the two ids become `arena.flag1`/
  `arena.flag2` keyed by team (which may be pre-swapped per §4.1's random
  team flip), and `Arena.EnterFrame` spawns an idle "fairy" particle rising
  from each un-captured flag every frame (`Arena.as:1182-1195`).

### 4.3 `NodePickup` (symbol `579`, `scripts/NodePickup.as`)
- `extends MovieClip`. Name format `"{p|w}_{kind}_{respawnSecs}"`:
  - `p_...` → `type="pickups0"`, `id = kind` (e.g. `sshield`, `bshield`,
    `shealth`, `bhealth`, `invin`, `damage`, `rapid`), starts hidden
    (`stop(); visible=false` — the icon is painted separately, see below).
  - `w_...` → `type="weapons0"`, resolves a starting gun id via
    `setWeapon()`.
- `RotateNum` (static): a shared rotating index so consecutive `"rand"`
  weapon pickups across the map cycle through different guns rather than all
  offering the same one; seeded once from `MatchSettings.weaponsUsed` if not
  `"All"`.
- `EnterFrame()`: while not `taken`, bobs (`yRot+=5`, `UT.yMoveToRot`) and is
  actually drawn via `game.bitscreen.paint(...)` — pickups render through a
  shared world-space icon-painting surface, not their own MovieClip frame,
  which is why the MC itself starts `visible=false`.
- `getPickup(unit)`: applies the effect by `id` (durations: `sshield`+50,
  `bshield`+100 shield; `shealth`+50, `bhealth`+100 heal; `invin` = 5.5s×30
  frames scaled by `unit.equips.powerup`; `damage` (double damage) = 7s×30;
  `rapid` = 6.5s×30; default (a weapon id) calls
  `gun.addClip(num, ceil(clipMax/2))` — pickups grant a **half-clip refill**,
  not a full reload, plus HUD text/sounds per kind), then sets
  `taken = spawnTime*30` (frames) as a respawn timer, matching the `_N`
  suffix in the pickup's name (seconds × 30fps).
- Player proximity check happens in `Unit.EnterFrame`
  (`scripts/Unit.as:596-606`): `UT.inBox(x, y, pickup.x-40, pickup.y-80, 80,
  150)` — an 80×150 box centered horizontally on the pickup and extending
  80px above/70px below its anchor.

### 4.4 `NodeWaypoint` (symbol `568`, `scripts/NodeWaypoint.as`)
- `extends Sprite`. Name format `"<id>_<connections>"`: `con` is a string of
  single-character ids this node links to (`setConnectors` resolves each
  char through the `wpOb` id→node map built in `Arena.init()`).
- `setActionBox(NodeAiAction)`: registers an AI action trigger tied to this
  waypoint (pushed into `actionBoxes`).
- Debug-mode draws yellow lines to connected waypoints and pink/magenta lines
  to owned action boxes into `arena.botCont`.

### 4.5 `NodeAiAction` (symbol `585`, `scripts/NodeAiAction.as`)
- `extends Sprite`. Name format `"<con>_<action>"`: `con` = the waypoint id
  this action box is wired to (via `Arena.init()`'s
  `wpOb[con].setActionBox(this)`, `Arena.as:972-980`); `action` = `"j"`
  (single jump, debug label "Jump") or `"d"` (double-jump, debug label
  "Double"). AI checks `UT.inBox(unit.x, unit.y, box.x, box.y, box.width,
  box.height)` and calls `mov.doJump()` while inside (`AI.as:598-618`) — this
  is exactly the mechanism bots use to trigger jump pads (§2.3) and clear
  gaps, by design placement rather than automatic terrain reaction.

### 4.6 `NodeHoldpoint` (symbol `627`, `scripts/NodeHoldpoint.as`)
- `extends Sprite`. Fields: `gear` (rotating capture-progress wheel MC),
  `flag`, `curTeam` (0 = neutral). Only active for `MatchSettings.type ==
  "Domination"` (otherwise hidden, `Arena.init():902-912`); `Arena.holdpoints`
  is sorted by `x` ascending (`Arena.as:947`), i.e. left-to-right for HUD
  ordering.
- `capture(unit)`: if attacker's team differs from `curTeam`, animates the
  flag pole up (`flag.y += 0.5` toward `-25`) and spins `gear` +5°/frame while
  contested; on reaching `-25` flips `curTeam`, HUD feed "has captured a Flag
  Point!", `score.domCap++`. If the holder's own team re-enters, the flag
  retracts (`flag.y -= 0.5` back to `-80`) and `gear` spins the other way — a
  **decay/defend mechanic**, not an instant swap.
- `Unit.EnterFrame` proximity: `UT.inBox(x, y, hold.x-120, hold.y-150, 240,
  200)` (`Unit.as:610-618`) — sets `onPoint`/`capturing` and calls
  `capture(unit)` every frame the unit is inside.

### 4.7 `NodePhysBox` (symbol `581`, `scripts/NodePhysBox.as`)
- `extends Sprite`, always `visible=false` — purely a placement marker.
  `Arena.init()` collects every instance into `arena.physboxes` and hands the
  whole array to `game.physWorld.generateWorld(physboxes)` (`Arena.as:1011`).
- **These are not props.** `PhysWorld.generateWorld` (`PhysWorld.as:73-99`) walks
  the array and, for each marker, creates a **static** Box2D body — a `b2BodyDef`
  with no type set (so `b2_staticBody`), `SetAsBox(width/60, height/60)`,
  `friction 0.3`, **`density = 0`** — reusing the marker's own rotation. Nothing
  is drawn and nothing is spawned; the boxes are the invisible collision world
  that **ragdolls** fall onto (`createCorpse` → `PhysActor`), which is the only
  thing the Box2D world is used for. A map with no `NodePhysBox` markers simply
  has corpses that pass through its geometry.

  *(An earlier revision of this doc guessed these spawned "destructible/dynamic
  physics props (crate, barrel, etc.)". They do not — the class sets
  `visible = false` and the bodies are static and massless.)*

## 5. Particle systems per map theme (`Stats_MapParticles.as`)

`Stats_MapParticles(game, mapId)` is instantiated per match; `mapInit()` runs
**once** at load to scatter static ambient particles, `EnterFrame()` runs
every frame for continuous/random ambient effects. Both are `switch(map)` on
the *same* map-id strings as `Stats_Maps.mapOrder` — but note the "2" variant
ids are **not always separately cased**:

### 5.1 `mapInit()` one-time scatter (`Stats_MapParticles.as:57-311`)
Only 4 cases have any body: `"test"`, `"jungle"`, `"jungle2"`, and the
combined `case "ocean": case "ocean2":`. All other map ids (`city`, `desert`,
`mines`, `mines2`, `space`, `snow`, `tutq`, and their untested "2" siblings)
fall through to **no static scatter** at load. Effects used: `"fairy"`
particles (idle firefly/ambient motes, jungle-specific swarm positions
hardcoded per-coordinate) and `"fish"` particles (swimming loops in fixed
rectangular bands, jungle's two river bands and all of ocean/ocean2's several
bands).

### 5.2 `EnterFrame()` continuous per-map effects (`Stats_MapParticles.as:313-851`)
Maps to a 0–12 index by `switch(map)`; **`"jungle2"`, `"mines2"`, `"snow2"`
are the only "2" ids explicitly cased** (indices 3, 7, 11 — sharing most
logic with their base map but note `jungle2`'s block, index 3, only carries
the raise/"fairy" ambient bursts and *not* jungle's water/graphPart droplets,
whereas `mines2`/`snow2` fall through into their base's exact case body via
switch fallthrough or duplicate case content). `city2`, `desert2`, `ocean2`,
`space2`, `tutq2` are **not cased** and fall to `default` (index 12, empty —
no continuous particles at all).

| idx | map(s) | Continuous effects |
|---|---|---|
| 0 | `tut` | water droplets scaled by `SD.graphPart` (1–3, a particle-density quality setting) + rising "fairy" motes along a line, gated on `game.player.sEvent<=4` |
| 1 | `test` | water splashes + rare falling snow + rare ember burst |
| 2 | `jungle` | two water-drip clusters scaled by `graphPart1`/`graphPart2`, plus `game.water.startWaveAtPos(...)` |
| 3 | `jungle2` | rising "fairy" motes along 3 fixed line segments (no water/graphPart droplets) |
| 4 | `ocean` | falling "leaf" along a line + two water-splash points scaled by `graphPart1` + rising fairies at two spots |
| 5 | `city` | rising fairies at 4 spots/lines + rare ember sparks (3 spots) + water splashes |
| 6 | `mines` | rising fairies at 2 lines/1 spot + rare ember sparks (2 spots) |
| 7 | `mines2` | same shape as `mines` (fairies + embers), same coordinates |
| 8 | `space` | rising fairies (2 lines) + ember sparks at 4 spots |
| 9 | `desert` | ember sparks at 3 spots + a single rising-fairy spot |
| 10 | `snow` | rising fairies at 2 lines only |
| 11 | `snow2` | falling snow (rate scaled by `4 - SD.graphPart`) + rising fairies at 2 lines |
| 12 | *(default: `city2`,`desert2`,`ocean2`,`space2`,`tutq2`, anything unmatched)* | none |

`SD.graphPart` is a global particle-density/quality setting (0–3-ish) that
scales most of the loops above (`graphPart1`/`graphPart2` local caches per
case) — a low-end-hardware graphics setting, not a per-map value.

## Port status

| Area | Status | Notes |
|---|---|---|
| Map roster / ids | Wrong-incomplete | Port's `LEVELS` (`src/game/Arena.ts:101-121`) lists all 10 base ids as `r2_<id>` but **omits `city2`/`desert2`/`ocean2`/`space2`/`snow2`/`tutq2`** entirely — only `jungle2`/`mines2` are present, matching what's in `raze2maps.json`. |
| Per-map geometry (spawns/CTF/hold/pickups) | Correct (for the 10 present ids) | `raze2maps.json` + `Arena.buildRaze2Map()` faithfully places spawns, CTF stands (leftmost=team1 by x-sort, matching the `id__team` convention closely enough), hold points, and pickups from extracted node data. |
| Wall collision model | Correct | Binary alpha mask for solidity plus a second colour-keyed `<map>_special.png` layer decoded by `SURFACE_TABLE` (`WallMask.ts:58-87`), which carries the whole §2.3 vocabulary: mud/ice/snow/sand friction, low-gravity, shallow/deep water, toxic, both conveyor directions, instant-death and damage-over-time strips, the 9 straight jump-pad tiers and 5 diagonal ones. |
| Jump pads — geometry | Correct-ish | `raze2maps.json`'s `jumpPads: [x,y,w,h]` bands look like they were extracted from exactly the `00fffN`/`00ccfN` colored regions in `wallMC` (§2.3), giving the port real pad rectangles per map. |
| Jump pads — launch force | Correct | The authentic tier + diagonal kick are extracted from the `00fffN`/`00ccfN` wall colours and carried on each pad as `power`/`dirX`. |
| Jump pads — activation | Correct | The contact launch is gone. `modJump`/`modSideJump`/`modMegaJump` are surface mods spent *inside* the jump (`Movement.as:128-165`), so a pad only fires when you jump on it. The bot-only contact launch survives solely on the Raze‑1 rect levels, which have no authored `NodeAiAction` graph to jump from. |
| Jump pads — as a class | N/A (correct in spirit) | There is no dedicated pad sprite/node in the source (they're wall-color regions, §2.3); the port's separate `JumpPad` visual (`Arena.ts` `drawPads()`) is a reasonable authored stand-in since the original pads are invisible collision-only color zones with no unique on-screen sprite of their own (visual cue was presumably baked into the `wallMC`/background art itself). |
| Parallax bg1/bg2/sky | Correct | `Arena.buildBackdrop()` builds all three authentic layers in the `Game.as` depth order and `updateBackdrop()` runs §3.2's formula verbatim, including the registration-point offset. Art is baked by `tools/maps/bake_bg.py` and scaled by `max(WIDTH/800, HEIGHT/600)` so the 800-wide sky gradient still reaches both edges of this port's wider viewport. The procedural gradient survives only as the fallback for the Raze‑1 rect levels, which have no authored layers. |
| Water — wave surface | Correct | `game/Water.ts` is the spring-mass surface verbatim: one dot per 20px, spring 5 / damping 1.05 / spread 0.7, the same unit-interaction ladder (falling in kicks 4, rising −5, wading spreads to the neighbours at −2/−1, a still crouch 0.5), the 20-frame idle pulse and the `hard-light` draw. The pool comes from the author's own `waterMC` rather than the mask, so ocean simulates the thin sea-floor strip the SWF does instead of the whole blue mass, which is map art. |
| Water / reflections | Correct | `game/Reflection.ts` ports `Arena.doReflections`: the author's `reflectTake1` rectangle is captured into a `RenderTexture` each frame (actor and effect layers only — never the map art or backdrop) and redrawn at `reflectShow1`'s own transform. Both rectangles are extracted by `tools/maps/arena_clips.py`; among the shipped maps only snow has a pair. Gated on "Lights & Reflections" (`Quality.glow`), which now also gates the shimmer only where there is no simulated surface. |
| CTF flag capture mechanics | Partially covered elsewhere | Node placement is correct (this doc's scope); flag pickup/capture/score logic (§4.2) lives in gameplay code outside `Arena.ts` — not verified here. |
| Hold-point (Domination) capture animation | Unknown/not verified here | The gradual gear-spin/flag-slide contest mechanic (§4.6) wasn't checked against the port's Domination mode implementation (out of this doc's file scope). |
| Ambient particle systems per map | Correct (art pending) | The invented dust/ember/snow/bubble themes are gone. `game/mapEmitters.ts` is `Stats_MapParticles` transcribed — every `mapInit` placement (21 fairies + 16 fish on jungle, 35 fairies on jungle2, 15 fish on ocean) and every per-frame emitter, including the `case 2` fall-through that gives jungle jungle2's vents as well as its own waterfalls. `game/MapParticles.ts` is `Particle.as`: all eight kinds, the wall-mask `hitTest`, the `onScreen(300)` spawn gate, and `SD.graphPart` used as the literal loop bound / modulus it is. The pre-baked `BH` sprite frames are not extracted yet, so each kind is drawn as a matching procedural shape. |
| AI jump-action boxes (`NodeAiAction`) | Correct | All 186 waypoints + 262 action boxes are extracted per map into `raze2maps.json`; `AI.patrol` fires `j`/`d` only inside a box, exactly as `AI.as:598-618` does, and `Arena.authoredWaypoints` reports which maps have a real graph. |
| Ragdoll evaporation (`PhysVap`) | Correct | `physics/PhysVap.ts` ports it whole: at four seconds (`PhysActor.EnterFrame`, `fc == 4*30`) the corpse is rasterised into one shared 100x100 bitmap anchored on the torso, its bodies are dropped, and 40 random pixels lift off per frame at `rand(2,7)` px until each has risen `rand(5,30)`. One corpse at a time; queued ones that leave the view are destroyed with no effect. The "Ragdoll evaporating" toggle is now a real `SD.graphRagev` / `Quality.ragev`. Pixi ships no `GlowFilter`, so the `0xFF6600` glow is a blurred tinted copy under the sharp one, per the port's existing effect convention. |
| Authored animated props | Correct for `tut`, missing elsewhere | A map's Arena frame carries live MovieClips alongside the nodes, and the port — whose map art is one baked PNG — drew **none** of them. `tools/maps/arena_props.py` walks `DefineSprite_1341_Arena` and resolves every placement through SymbolClass; `tools/maps/bake_props.py` renders each clip's FFDec frame SVGs, trims and shelf-packs them into `public/assets/props/` with `src/assets/propRig.json`. `game/MapProps.ts` is a minimal MovieClip (playhead + authored stops + loop range) so the mission script can use the source's own verbs. **The depth split is the load-bearing detail**: `midCont` — what `Game.as:152` fills with the units, bullets and physics world — sits at depth 1663, and `tut`'s props straddle it, so the bridges/heart/arrow (depths 2..189) draw behind the player and the conveyor treads, gears and lights (1667..1788) draw in front of him. `tut` has all 28; **`city` (1+3), `desert` (8+2), `ocean` (2+2), `mines` (12+13), `space` (9) are still unbaked** — see the follow-up task. `Tutorial_Wall` (cid 1331) is deliberately excluded: it is `visible=false` and is the collision layer, not art. |
| Tutorial prop cues | Correct | `Game.tutBombHit` and `Game.tutShootWall` are reproduced in `game/Tutorial.ts`: the strike plays `bridge`+`bridge2`, sends the heart to its `dance` label, stops all 5 gears and 8 treads for good, and swaps the sky to `tut_attack` (`Game.as:554`, the only runtime `bgSky.gotoAndStop` in the game besides the "lol cats" override — `Arena.setSky`). Step 8 hides the nav arrow and starts `bridge2`+`bridge3`; step 9 finishes `bridge3`. Each `play()` runs to exactly the next authored stop — verified live halting on 21 / 36 / 60 / 90. |
| Ragdoll collision (`NodePhysBox`) | Correct | Was silently broken: Raze 2 maps leave `Arena.walls` empty (live units use the pixel mask), so the corpse world had no ground at all and every ragdoll and dropped gun free-fell out of the level. `tools/maps/physboxes.py` extracts the authored boxes — 57 jungle, 29 mines, 7 snow, none elsewhere, exactly as the SWF has them — and `Arena.corpseGeometry` hands those to `Phys` instead of `walls`. |
