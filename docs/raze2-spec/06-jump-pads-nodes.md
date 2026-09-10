# Jump Pads + Map Interactive Nodes

## 1. Summary

Raze 2 has **no discrete "jump pad" game object**. What players call a jump pad is a
region of the map's invisible per-pixel collision bitmap (`wallMC` → `Arena.wall`)
painted with one of 16 reserved "surface" colors (`00fff1`–`00fff9` straight, `00ccff`/
`00ccf3`/`00ccf9`/`00ccf4`/`00ccf8` diagonal, plus `f00007` a damaging variant). Every
frame, each unit samples the pixel just below its feet; if the color matches, `Movement`
gets a one-frame-only jump-force multiplier (`modJump`) and, for diagonal pads, a
horizontal-velocity override (`modSideJump`). The multiplier only does anything if the
unit *also* presses Jump that same frame — walking onto a pad does not auto-launch you.

Besides pads, Raze 2's map "nodes" are a family of 7 `Node*` Flash-timeline objects
(`NodeSpawn`, `NodeCtfFlag`, `NodeHoldpoint`, `NodePickup`, `NodeWaypoint`,
`NodeAiAction`, `NodePhysBox`) placed by hand in each map's authored Arena subclass.
`Arena.init()` walks the display list once, buckets children by `instanceof` into typed
arrays, and wires cross-references (spawn→nearest waypoint, waypoint→waypoint graph,
waypoint→action box). There is no runtime id-based dispatch table; the embedded SWF
symbol ids exist purely as library-linkage ids for the class `[Embed]` tags.

## 2. Raze 2 source of truth

All paths under `C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\scripts\` unless noted.

### 2.1 Jump pads — mechanism, not a class

- **No `NodeJumpPad` class exists anywhere in the decompiled tree.** Confirmed via
  recursive search of the whole `raze 2` folder, not just `scripts`.
- Surface sampling: `Unit.as:635-642`, inside `UnitEnterFrame`:
  ```as
  surface = game.arena.wall.getPixel32(x, y+1).toString(16).substring(2)
  ```
  (decompiler-mangled stack form in source; reconstructed above) — samples 1px below
  the unit's feet on `Arena.wall`, a `BitmapData` drawn once from `wallMC`
  (`Arena.as:815-817`: `wall = new BitmapData(wallMC.width, wallMC.height, true, 0); wall.draw(wallMC); wallMC.visible = false;`).
  `getPixel(dx,dy)` helper: `Unit.as:1369-1372` → `game.arena.wall.getPixel32(x+dx, y+dy)`.
- Debug surfacing for human players: `game.hud.setDebug(3, "Surface ID = " + surface)` (`Unit.as:645`).
- Color → behavior switch: `Unit.as:648-767`, a 34-case (0–33) switch on the hex string.
  All `mod*` fields live on `Movement` and are **reset to neutral every frame**
  (`Movement.as:107-124` `resetMods()`, called from `Unit.as:634`) — the effect is not
  sticky; you must be standing on the pixel *this exact frame*.

  | Hex color | Case | Effect |
  |---|---|---|
  | `00fff1` | 6 | `modMegaJump=true; modJump=1.2` |
  | `00fff2` | 7 | `modJump=1.4` |
  | `00fff3` | 8 | `modJump=1.6` |
  | `00fff4` | 9 | `modJump=1.75` |
  | `00fff5` | 10 | `modJump=1.9` |
  | `00fff6` | 11 | `modJump=2.2` |
  | `00fff7` | 12 | `modJump=2.65` |
  | `00fff8` | 13 | `modJump=2.8` |
  | `00fff9` | 14 | `modJump=3.3` (strongest straight pad) |
  | `00ccff` | 15 | diagonal: `modJump=1.8, modSideJump=-28` |
  | `00ccf3` | 16 | diagonal: `modJump=0.9, modSideJump=37` |
  | `00ccf9` | 17 | diagonal: `modJump=1.2, modSideJump=-40` |
  | `00ccf4` | 18 | diagonal: `modJump=1.3, modSideJump=55, modBrake=3` |
  | `00ccf8` | 19 | diagonal: `modJump=1.3, modSideJump=-55, modBrake=3` |
  | `f00007` | 32 | `status.damage(0.5,...)` **+** `modMegaJump=true, modJump=2.6` (damaging pad) |

  (Full 0–33 table including mud/ice/snow/water/toxic/conveyor/death surfaces is
  out of scope for this doc; see `06`'s sibling terrain doc if/when written — flagged
  in §6.)

- **Trigger requires an active jump-key press.** `modMegaJump` only matters inside
  `Movement.doJump()` (`Movement.as:126-198`), and `doJump()` is only invoked from
  key-press edges, never from contact alone:
  - `Player.as:354`: `mov.doJump()` on the "jump just pressed" branch.
  - `AI.as:612` / `AI.as:616`: bot equivalent.
  Standing on the pixel merely arms the multiplier for that frame; the unit must also
  press Jump the same frame. There is no "walk onto pad → auto-launch."

- **Launch force**, `Movement.as:144-158` (mega-jump branch of `doJump()`):
  ```as
  if (modSideJump) { xVel = modSideJump; }      // HARD OVERRIDE, not additive
  if (modMegaJump) {
    unit.game.playScreenSound(S_Jumppad, unit.x, unit.y);
    jumping = true; manualJump = true; dJump = true;   // consumes double-jump
    yVel -= yJump * modJump;                            // yJump = 13 (Movement.as:58)
    unit.MC.goto("tuck");
    ...createEffect(unit.x, unit.y - 20, "smoke_big");
  }
  ```
  - Vertical impulse: `yVel -= 13 * modJump` (`yJump` const = 13, `Movement.as:58`).
    Effective range **-15.6** (1.2×) to **-42.9** (3.3×).
  - Horizontal: straight pads (`modSideJump=0`) leave `xVel` untouched — **existing
    horizontal momentum is preserved**. The 5 diagonal pads **hard-set** `xVel` to
    `modSideJump` (±28/37/40/55/55), **overriding** whatever momentum the unit had.
  - Double jump is consumed (`dJump=true`) — no stacking a manual double-jump on a pad launch.
  - Forces `"tuck"` pose, spawns `smoke_big` FX at `(x, y-20)`, plays `S_Jumppad` sound
    at the unit's position.
  - **No cooldown/re-trigger timer** exists anywhere in the pad code. Re-triggering is
    naturally gated only by needing to leave and re-enter the color band and press
    Jump again.

- **Bots don't use the pad-color mechanism to decide when to jump.** They rely on
  hand-placed `NodeAiAction` trigger boxes (§3.6) wired onto the waypoint graph to know
  when to press jump/double-jump while pathing — see §3.6.

- **Art**: there is no jump-pad sprite/animation symbol at all. The only related SWF
  asset is a sound: `S_Jumppad` (`S_Jumppad.as`, `S_Jumppad_2.as`) —
  `[Embed(source="/_assets/2138_S_Jumppad.mp3")] public dynamic class S_Jumppad extends Sound`,
  backing file `_assets/2138_S_Jumppad.mp3`, **symbol/asset id 2138**. Visually, a pad
  is just whatever prop art the level artist drew (fan, machine, puddle, etc.); the
  color band painted into the invisible `wallMC` layer is the only actual "hitbox" —
  there is no separate collision-rectangle class for it.

### 2.2 Node classes — catalog

All 7 confirmed via inline `[Embed(source="/_assets/assets.swf", symbol="symbolNNN")]`
tags (no centralized id table/enum exists anywhere in the decompiled tree):

| Class | File | Symbol id | Type |
|---|---|---|---|
| `NodeSpawn` | `NodeSpawn.as:7` | `symbol571` | `Sprite` |
| `NodeWaypoint` | `NodeWaypoint.as:29` | `symbol568` | `Sprite` |
| `NodePickup` | `NodePickup.as:29` | `symbol579` | `MovieClip` |
| `NodePhysBox` | `NodePhysBox.as:5` | `symbol581` | `Sprite` |
| `NodeAiAction` | `NodeAiAction.as:9` | `symbol585` | `Sprite` |
| `NodeCtfFlag` | `NodeCtfFlag.as:16` | `symbol588` | `MovieClip` |
| `NodeHoldpoint` | `NodeHoldpoint.as:14` | `symbol627` | `Sprite` |
| `NodeWaypointPath` | `NodeWaypointPath.as:1-32` | *(none — plain data class, not a `DisplayObject`)* | — |

All 7 numeric ids given in the task brief (571, 588, 579, 627, 568, 585, 581) are
**confirmed exact matches** against the source. No `NodeJumpPad`, `NodeTeleporter`, or
`NodeHazard` class exists — teleport is folded into `Unit.as`'s ability system
(`Unit.as:1285-1305`, `"teleport"` case) and hazards are folded into the surface-color
switch above (§2.1, cases 30/31/32), not separate node types.

#### `NodeSpawn` (`symbol571`, `NodeSpawn.as:1-42`)
- Map-data: instance `name = "<id>_<team>"` (`team=0` → neutral spawn pool).
- Fields: `id: String`, `team: uint`, `waypoint: NodeWaypoint` (assigned post-hoc), `initialSpawned: Boolean`.
- Behavior: pure data marker + debug label (`txt_id`); `visible = SD.debug` (hidden in
  normal play). `setWaypoint()` called once by `Arena.init()` (`Arena.as:983-1010`) to
  link each spawn to its nearest `NodeWaypoint` via `wpOb[id]`.

#### `NodeCtfFlag` (`symbol588`, `NodeCtfFlag.as:1-110`)
- Map-data: `name = "<id>__<team>"`.
- Fields: `flag: MovieClip`, `id`, `team: uint`, `unitCaptured: *`.
- Behavior: `setTeam()` → `flag.gotoAndStop(team)` (frame per team color). `capture(unit)`:
  enemy-team touch → pickup (`unitCaptured=unit`, hide `flag`, give unit `hasFlag`,
  ability-slot MC swaps to `"flag"+team`, HUD feed message); own-team touch while
  carrying enemy flag → score capture, reset flag, play `S_Jumppad` (reused as score
  cue) + `S_Powerup`. Arena only populates `ctfflags` when
  `MatchSettings.type == "Capture the Flag"`.

#### `NodeHoldpoint` (`symbol627`, `NodeHoldpoint.as:1-92`)
- Fields: `gear: MovieClip`, `flag: MovieClip`, `curTeam: uint`, `unitCaptured: *`.
- Behavior: `capture(unit)` — enemy touch nudges `flag.y` up `0.5`/frame and rotates
  `gear` 5°/frame until `flag.y < -25`, then flips `curTeam`, awards `domCap` score,
  HUD feed "has captured a Flag Point!"; same-team re-touch decays `flag.y` back down
  (floor `-80`). Only active for `MatchSettings.type == "Domination"` (else hidden,
  `Arena.as:902-912`).
- Trigger box, read from `Unit.as:610-619`:
  `UT.inBox(x, y, holdpoint.x-120, holdpoint.y-150, 240, 200)` — a **240×200** box.

#### `NodePickup` (`symbol579`, `NodePickup.as:1-276`)
- Map-data: `name = "{p|w}_<kind|weapNum>_<respawnSecs>"` — matches `raze2maps.json`'s
  `pickups` entries exactly.
- Fields: `type: String` (`"pickups0"`/`"weapons0"`), `id: String`, `num: int`
  (weapon index, `-1` for items), `taken: uint` (respawn countdown, frames), static
  `RotateNum: uint` (shared rotation counter for `"rand"` weapon pickups).
- Behavior: `getPickup(unit)` switches on `id`: `sshield`→+50 shield, `bshield`→+100
  shield, `shealth`→+50 heal, `bhealth`→+100 heal, `invin`→`sInvin = 5.5*30` frames,
  `damage`→`sDamage = 7*30` frames, `rapid`→`sRapid = 6.5*30` frames; default → grants
  the weapon clip. `taken = spawnTime * 30` (respawn timer in frames @30fps).
- Trigger box, `Unit.as:596-606`: `UT.inBox(x, y, pickup.x-40, pickup.y-80, 80, 150)` —
  an **80×150** box.

#### `NodeWaypoint` (`symbol568`, `NodeWaypoint.as:1-115`)
- Map-data: `name = "<id>_<connections>"`, `connections` a string whose chars are other waypoint ids.
- Fields: `id`, `con: String`, `connects: Array` (resolved refs), `actionBoxes: Array`
  (linked `NodeAiAction`s), `arena` ref for debug drawing.
- Behavior: `setConnectors(allNodesById)` resolves `con` into the AI navmesh graph
  edges; `setActionBox()` attaches action triggers. Debug-line graph drawing gated by `SD.debug`.

#### `NodeWaypointPath` (no symbol, `NodeWaypointPath.as:1-32`)
- Plain data class (not a `DisplayObject`): constructor takes a path string + node
  lookup, computes `nodes = path.length` and cumulative `dist` (sum of
  `UT.getDist()` between consecutive waypoints). Used by AI route planning to pick
  shortest multi-hop paths.

#### `NodeAiAction` (`symbol585`, `NodeAiAction.as:1-39`)
- Map-data: `name = "<con>_<action>"`; `action` is `"j"` (Jump) or `"d"` (Double jump).
- Fields: `con: String` (waypoint id it's attached to), `action: String`.
- Behavior: debug-visible trigger-zone marker read by `AI.as` pathing logic to decide
  when a bot should manually press jump/double-jump while following a waypoint route.
  **This — not the pad surface color — is the actual mechanism bots use to clear jump
  pads and gaps**, since bots don't sample `Arena.wall` for pad "hints."

#### `NodePhysBox` (`symbol581`, `NodePhysBox.as:1-15`)
- No custom fields; `visible = false`. Pure placeholder `Sprite` whose bounding box
  seeds `game.physWorld.generateWorld(physboxes)` (`Arena.as:1011`) — defines a Box2D
  prop's shape+position (crates/debris) without gameplay logic on the node itself.

### 2.3 Arena node dispatch (authentic)

`Arena.as:809-1018`, `protected function init()`:
- `Arena.as:815-817`: builds `wall` bitmap from `wallMC` (see §2.1).
- `Arena.as:798-807`: `changeWallFrame(frame, relative)` — scripted events can advance
  `wallMC` to a new frame and redraw `wall`, changing pad/surface state at runtime
  (used by the speak-event path, `Unit.as:904`: `game.arena.changeWallFrame(sEvent)`).
- `Arena.as:836-846`: resets `spawns/spawnsT1/spawnsT2/waypoints/aiactions/physboxes/pickups/holdpoints/ctfflags/lights` to `[]`.
- `Arena.as:860-945`: single loop `while (_loc4_ < numChildren) { if (getChildAt(_loc4_) is NodeXxx) ... }`
  — nodes are simply **named children on the Arena's Flash-authored timeline**, bucketed
  by `instanceof`. No id-based runtime dispatch table exists; the embedded symbol ids
  are library-linkage ids only.
- `Arena.as:947-1018`: post-process — sorts `holdpoints` by x, builds `wpOb` (id→waypoint
  map), wires `setConnectors`/`setActionBox`/`setWaypoint`, calls
  `game.physWorld.generateWorld(physboxes)`, assigns `pickups[i].game = game`.

The per-map compiled `Arena` subclass (~1200 hardcoded `public var xxx:NodeWaypoint`-
style declarations) shows concrete instance-name examples matching the conventions
above, e.g. `f_1: NodeSpawn`, `a__1: NodeCtfFlag`, `p_rapid_15: NodePickup`.

## 3. Current port state

### 3.1 Jump pads — `raze-ts/src/game/Arena.ts` and `WallMask.ts`

The port has **two parallel jump-pad code paths**:

1. **Pixel-accurate surface table** — `WallMask.ts:58-80`, `SURFACE_TABLE`, a
   near-verbatim port of `Unit.as:648-767`'s color switch, including the exact tier
   multipliers and the 5 diagonal `±28/37/40/55/55` kicks:
   ```ts
   // WallMask.ts:74-79
   0x00fff1: pad(1.2, 0), 0x00fff2: pad(1.4, 0), 0x00fff3: pad(1.6, 0),
   0x00fff4: pad(1.75, 0), 0x00fff5: pad(1.9, 0), 0x00fff6: pad(2.2, 0),
   0x00fff7: pad(2.65, 0), 0x00fff8: pad(2.8, 0), 0x00fff9: pad(3.3, 0),
   0x00ccff: pad(1.8, -28), 0x00ccf3: pad(0.9, 37), 0x00ccf9: pad(1.2, -40),
   0x00ccf4: pad(1.3, 55), 0x00ccf8: pad(1.3, -55),
   ```
   `WallMask.jumpPadAt(x, y)`, `WallMask.ts:148-151`, is the pixel-based lookup used
   for terrain-mod purposes.

2. **Rectangle-based pad list** — `Arena.ts` extracts pads offline into explicit
   rectangle objects instead of sampling the live bitmap every frame:
   - `Raze2MapDef.jumpPads`, `Arena.ts:30-45`: `[x, y, w, h, power?, dirX?][]`.
   - Legacy (`LevelDef.jumpPads`), `Arena.ts:61-63`: `[x, y, w, h, power?][]` — no
     `dirX`, straight-only (older Raze-1-style maps).
   - `JumpPad` interface, `Arena.ts:66-76`: `{ x, y, w, h, power, dirX }`.
   - Arena fields, `Arena.ts:153-165`: `jumpPads: JumpPad[]`, plus `padGfx`/`padTick`
     for a pulsing-chevron visual overlay.
   - Built in `buildRaze2Map()`, `Arena.ts:355-358`: from map JSON, grounded via
     `groundSpawn()`, defaults `power ?? 2.2, dirX ?? 0` when a data entry omits them.
     Legacy non-Raze2 path has an analogous block at `Arena.ts:251-258`.
   - `Arena.jumpPadAt(px, feetY)`, `Arena.ts:1021-1028`: AABB test
     `px ∈ [p.x, p.x+p.w] && feetY ∈ [p.y-8, p.y+p.h+8]` — an **8px-padded rectangular
     trigger zone**, unlike the AS3 single-pixel color sample.
   - `Arena.drawPads()`, `Arena.ts:1042+`: pure visual — amber glow plate + pulsing
     chevrons. Inline comment notes this is deliberately **not** cyan (the authentic
     pads are invisible wall-color zones with no dedicated art at all; the amber
     overlay is a visibility improvement over the source material, not a port of any
     original asset). Driven each tick from `Arena.ts:1013-1017` (`padTick++; drawPads();`).

Consumers in `Unit.ts`:
- `Unit.ts:1117` and `Unit.ts:1353` both call `this.game.arena.jumpPadAt?.(this.x, this.y)`
  (the rectangle-based Arena path) — the **`WallMask.jumpPadAt` pixel path and the
  `Arena.jumpPadAt` rectangle path are not obviously unified**; worth checking whether
  both are live simultaneously or one has superseded the other (see §4).
- `Unit.ts:1109-1153`'s `doJump()` reproduces the AS3 "must press jump while standing
  on pad" rule (`Player.as:346-357`/`Movement.as:144-158`), including the `yJump=13`
  constant, `dJump` consumption, and diagonal pads hard-overriding horizontal velocity
  (`Unit.ts:1163`: `if (dirX) this.moving.vel = dirX;`) vs. straight pads preserving momentum.
- **Deviation (documented in-code)**: `Unit.ts:1348-1355` adds a **bot-only
  contact-launch fallback** — bots auto-launch on grounded pad contact with no
  jump-press required, because the port has no `NodeAiAction` cue graph wired into
  Raze 2 maps to tell bots when to press jump. The in-code comment at `Unit.ts:1348-1351`
  calls this out explicitly as a deliberate deviation from the AS3 source (§2.1's
  `NodeAiAction`-driven bot behavior).
- Neither AS3 nor the port implement an explicit cooldown/re-trigger timer; re-trigger
  in both is gated only by leaving and re-entering the trigger zone/pixel.

### 3.2 Other nodes — port coverage

- `ctfNodes: {x,y,team}[]` and `holdNodes: {x,y}[]`, `Arena.ts:153-165`; built in
  `buildRaze2Map()` at `Arena.ts:386-389` from `m.ctf` (sorted by x, team 1 = leftmost)
  and `m.hold`. No capture-progress meter, team-flip logic, or trigger-box AABB
  matching `NodeHoldpoint`/`NodeCtfFlag`'s 240×200 / capture-radius behavior was found
  in this pass — flagged as a gap, see §4.
- `spawnNodes`, `wayNodes` fields exist (`Arena.ts:153-165`) but no evidence of a
  waypoint graph, `NodeAiAction` boxes, or `NodePhysBox`→Box2D wiring was found for
  the Raze 2 port (the port's physics/AI systems are custom-built, not a Box2D port).
- `itemPickups`, `weapPickups` built by `spawnRaze2Pickups()` (`Arena.ts:481+`), which
  parses `p|w_kind_secs` pickup strings the same way the AS3 `NodePickup` constructor does.

### 3.3 `raze2maps.json` structure

File: `raze-ts/src/assets/raze2maps.json` (2537 lines). 10 maps: `jungle, jungle2,
city, desert, ocean, mines, mines2, space, snow, tutq`.

Per-map schema (matches `Raze2MapDef`, `Arena.ts:30-45`):
```json
{
  "w": number, "h": number, "mask": "string.png", "bg": "string",
  "spawns": [[x,y], ...],
  "ctf": [[x,y], [x,y]],
  "hold": [[x,y], [x,y], [x,y]],
  "pickups": [[x, y, "p_<kind>_<respawnSecs>"], ...],
  "jumpPads": [[x, y, w, h, power, dirX], ...]
}
```

Jump-pad counts per map: `jungle`/`jungle2`/`city` = 4, `desert`/`tutq` = 1,
`ocean`/`space`/`snow` = 2, `mines`/`mines2` = 3. `ctf` always length 2, `hold`
always length 3, across all 10 maps.

Verbatim examples:
- `jungle.jumpPads`: `[[350,1844,124,8,3.3,0],[530,1948,124,8,1.6,0],[2008,1626,126,6,1.9,0],[2444,1836,124,6,3.3,0]]`
- `city.jumpPads`: `[[266,1454,122,32,2.2,0],[628,1058,126,40,1.9,0],[2538,1514,132,40,3.3,0], ...]`
- `jungle.ctf`: `[[1294.7,1659.5],[1304.5,969.9]]`
- `jungle.hold`: `[[2074.2,782.6],[1293.5,1661.3],[1111,1141.2]]`
- `jungle.pickups` (first 5): `[[2455.6,916.5,"p_bshield_15"],[2225.4,1243.2,"p_damage_10"],[579.1,1199.3,"p_invin_20"],[1546.1,1024.3,"p_rapid_15"],[1855.9,784.1,"w_rand_10"]]`

Note: every sampled `jumpPads` entry across the 10 maps has `dirX = 0` — i.e. current
extracted map data appears to contain **only straight pads**, even though
`WallMask.SURFACE_TABLE` supports all 5 diagonal variants. This needs a full scan
(not just samples) to confirm no non-zero `dirX` exists anywhere — flagged in §6.

### 3.4 `src/assets/raze2/*.json` catalogs

Checked `campaign.json`, `skinAnim.json`, `skinArt.json`, `skins.json`, `weapons.json`,
`equipment.json`, `killBonuses.json`, `achievements.json` — **none contain node/pad
data**. Incidental matches only (`campaign.json`'s narrative `"node"` dialogue-tree
field, `modeCode: "ctf"` game-mode metadata; `skinAnim.json`'s unrelated `"jump"`
animation-state key).

## 4. Gap analysis

| Area | Raze 2 (authentic) | Port today | Gap |
|---|---|---|---|
| Pad detection | Per-pixel color sample of `Arena.wall`, every frame | Two systems: `WallMask.jumpPadAt` (pixel, faithful) **and** `Arena.jumpPadAt` (8px-padded rectangle, coarser) | Two parallel detection paths not obviously reconciled; determine which is authoritative at each `Unit.ts` call site (`Unit.ts:1117`, `Unit.ts:1353`) |
| Pad trigger | Requires active jump-key press while standing on the color; no auto-launch | Player path matches; **bots auto-launch on contact** (`Unit.ts:1348-1355`) | Documented intentional deviation — no `NodeAiAction` graph ported for Raze 2 bots |
| Pad cooldown | None (re-trigger gated by leaving/re-entering pixel) | None (same gating, via rectangle zone) | Match — no gap |
| Pad horizontal momentum | Straight pads preserve `xVel`; diagonal pads hard-override `xVel = modSideJump` | Matches (`Unit.ts:1163`) | Match — no gap |
| Pad vertical force | `yVel -= 13 * modJump`, `modJump` 1.2–3.3× (2.6× for damaging variant) | `power` field per pad entry (2.2 default), values observed 1.6–3.3 in map data | Need to confirm port's force formula exactly reproduces `yJump=13` scaling, not just a renamed multiplier |
| Pad art | None — no sprite/animation symbol exists; only a sound (`S_Jumppad`, id 2138) | Amber glow + pulsing chevron overlay (deliberate, documented as non-authentic) | By design; no authentic asset to match against |
| Diagonal pads | 5 variants with distinct `modSideJump` kicks | `dirX` field supported in code/schema, but **no extracted map data currently has non-zero `dirX`** | Either (a) diagonal pads exist in the real maps and weren't extracted, or (b) the 10 ported maps genuinely don't use them — needs verification against wall-mask PNGs |
| `NodeCtfFlag` capture logic | Team-tagged pickup/return/capture state machine with HUD feed messages | `ctfNodes: {x,y,team}[]` — position/team only found in this pass | Capture logic, trigger-box sizing, HUD feed strings not located — likely elsewhere in game-mode code, needs a follow-up pass outside `Arena.ts` |
| `NodeHoldpoint` capture logic | 240×200 trigger box, gradual capture meter (`flag.y` -80→-25), team flip + score | `holdNodes: {x,y}[]` — position only found in this pass | Same as above — capture meter/trigger-box logic not located in `Arena.ts`; may live in a mode-controller file not covered here |
| `NodeWaypoint`/`NodeAiAction` | Full AI navmesh graph + jump/double-jump trigger boxes | No evidence of a ported waypoint graph for Raze 2 maps | Port's bot AI is presumably custom (not a navmesh port) — confirms the bot-pad-autolaunch deviation above |
| `NodePhysBox` | Seeds Box2D `generateWorld()` for physics props | No Box2D/physics-prop system found in this pass | Port doesn't appear to have physics-prop placeholders; likely out of scope unless the port has its own equivalent elsewhere |
| `NodePickup` respawn/effects | `taken` frame-countdown, `sInvin`/`sDamage`/`sRapid` timers in frames @30fps | `spawnRaze2Pickups()` parses the same `p|w_kind_secs` strings | Appears aligned in format; exact timer/frame-scaling fidelity not verified line-by-line in this pass |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Reconcile `WallMask.jumpPadAt` (pixel-accurate) vs `Arena.jumpPadAt` (rectangle) —
   pick one authoritative path per call site in `Unit.ts:1117`/`Unit.ts:1353`, or
   confirm both are needed for different purposes (e.g. rectangle for visuals/bot
   fallback, pixel for exact player physics) and document the split explicitly in code.
2. Verify `power` field semantics in `raze2maps.json`/`Arena.ts` map 1:1 to
   `modJump` × `yJump(13)`, not an independently-tuned value; add a comment citing
   `Movement.as:58,150` if so.
3. Scan the full `jumpPads` arrays (not samples) across all 10 maps in
   `raze2maps.json` for any non-zero `dirX`; if none exist, either re-extract from the
   wall-mask PNGs to check for missed diagonal pads, or explicitly document that the
   ported map set has no diagonal pads and the `dirX` code path is untested.
4. Locate (or build) the `NodeCtfFlag`/`NodeHoldpoint` capture state machines in the
   port — current `ctfNodes`/`holdNodes` only carry position/team, not the capture
   meter, trigger-box size (240×200 for holdpoints), or scoring/HUD-feed hooks from
   `NodeCtfFlag.as`/`NodeHoldpoint.as`. Affected: `Arena.ts:153-165`, `Arena.ts:386-389`,
   plus whatever mode-controller file owns match scoring (not covered by this doc).
5. Decide whether the port needs a `NodeAiAction`-equivalent cue system for bots
   (waypoint-attached jump/double-jump trigger boxes) to retire the
   contact-auto-launch fallback at `Unit.ts:1348-1355`, or keep the fallback as a
   permanent simplification — document the decision either way.
6. If a `NodePhysBox`/Box2D-prop equivalent is wanted, scope it as a separate task —
   not found anywhere in the current port.
7. Double-check `NodePickup` timer fields (`sInvin=5.5*30`, `sDamage=7*30`,
   `sRapid=6.5*30` frames @30fps, respawn `taken=spawnTime*30`) against
   `spawnRaze2Pickups()`'s implementation for exact frame-scaling parity.

## 6. Open questions / data still missing

- No centralized symbol-id enum/table exists in the AS3 source (ids are inline
  `[Embed]` tags only) — confirmed 571/588/579/627/568/585/581 all resolve correctly;
  no additional hidden node types found.
- The full 0–33 surface-color switch (`Unit.as:648-767`) covers many non-pad surfaces
  (mud/ice/snow/sand/water/toxic/conveyor/instant-death/dot-damage) that are outside
  this doc's jump-pad/node scope but are part of the same mechanism and may deserve
  their own terrain/surfaces spec if not already covered elsewhere (e.g. doc `05` or
  a future terrain doc) — flagged per the README's "flag anything large enough for a
  follow-up spec" rule.
- Whether any Raze 2 map actually uses the 5 diagonal pad colors is unverified from
  `raze2maps.json` samples alone (all-zero `dirX` observed); needs a full-array scan
  or a check against the raw wall-mask PNGs referenced by each map's `"mask"` field.
- The exact capture-radius/trigger-box code for `NodeCtfFlag` (analogous to
  `NodeHoldpoint`'s 240×200) was not located in `NodeCtfFlag.as` during this pass —
  likely proximity-based via `Unit.as`'s per-frame node-scan loop rather than a fixed
  box constant; worth a follow-up read of `Unit.as`'s CTF-adjacent code if a future
  doc covers CTF gameplay in depth.
- `Arena.as` as read is a single per-map compiled subclass (with ~1200 hardcoded node
  instance vars) rather than a generic engine file — confirm whether all 10 ported
  maps' original Arena subclasses were cross-checked, or only one was used as the
  representative source for this doc's node-behavior claims (this research pass
  primarily cited one Arena.as instance for the dispatch-loop mechanism, which is
  expected to be identical across maps since it's compiler-generated boilerplate, but
  per-map instance data like exact node names naturally differs).
