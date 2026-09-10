# Hitscan / Raycast Tracer Rendering

## 1. Summary

Raze 2 never draws a hitscan shot as one clean straight line. Every gun's shot is a
`Bullet` subclass named `Bullet_Line_*`, and each subclass owns its own draw recipe onto a
single shared `Shape` (`game.lineCont`) that the game clears **once per logic frame**. Most
guns (pistol, rifle, shotgun — `Bullet_Line_Basic`) build a *randomized, gapped* polyline —
literally skipping every other segment — and draw it exactly once, so the tracer is a single
30fps-frame flash of a broken/dashed line, never a persistent beam. A second family
(sniper/heavy rounds — `Bullet_Line_Sniper`, and the railgun-arc `Bullet_Line_Electric`)
persists for about a second, redrawing every frame while it fades out (`alpha -= 0.03`) and
its vertices drift ("heat shimmer"/"crawl"). A third family (continuous beams —
`Bullet_Line_Laser`, `Bullet_Line_Zapper`) re-fires every single frame while the trigger is
held, each instance living for exactly one frame with per-frame jitter, producing a
buzzing/crackling double-line beam. Every style is a **two-(or-three)-layer stroke**: a wider,
lower-alpha "glow" pass underneath a narrower, higher-alpha "core" pass, both driven by a
`[flag, w1, color1, a1, w2, color2, a2, ...]` params array that is per-weapon data, not a
single hardcoded look. The "deliberately incomplete" tracer the user is describing is
`Bullet_Line_Basic`'s dash algorithm (§2.1) — it is the look used by the most common guns
(pistol, rifle, shotgun, assault rifle, chaingun).

**Screenshot #9 could not be read for this doc** — the referenced path
`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\9.png` does not
exist on disk (confirmed via `Get-ChildItem -Recurse` under `~/.claude`, no hit anywhere on
the machine). Everything below is reconstructed from the decompiled AS3 draw code, which
fully determines segment length/gaps/taper/fade/color/width/lifetime numerically — see §6 for
the one open item (visual confirmation against the actual screenshot once it's available).

## 2. Raze 2 source of truth

All in `C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\scripts\`.

| Class | File | Used by (from `Stats_Guns.as`) | Persists? |
|---|---|---|---|
| `Bullet_Line_Basic` | `Bullet_Line_Basic.as` | pistol, sniper-pistol variant, shotgun, tshotgun-alt, assault rifle, precision laser, chaingun-ish | No — 1 frame |
| `Bullet_Line_Sniper` | `Bullet_Line_Sniper.as` | mauser, terminator shotgun, .50 cal sniper, fire-sniper variant, destroyer, ion cannon, credits gun | Yes — ~33 frames, fades |
| `Bullet_Line_Bend` | `Bullet_Line_Bend.as` | uzi, laser-shotgun variant | Yes — 10 frames, fades fast |
| `Bullet_Line_Electric` | `Bullet_Line_Electric.as` | railgun-arc ("Electro Bolt") | Yes — ~33 frames, fades |
| `Bullet_Line_Laser` | `Bullet_Line_Laser.as` | Focus Beam (constant-fire beam weapon) | No — 1 frame, re-fired every tick |
| `Bullet_Line_Zapper` | `Bullet_Line_Zapper.as` | Zapper (alien atom accelerator) | No — 1 frame, re-fired every tick |
| `Bullet_Line_Effect` | `Bullet_Line_Effect.as` | Railgun (piercing beam) | Yes — fade + a chasing spark |
| base class | `Bullet.as` | all of the above extend this | — |
| frame pump / shared canvas | `Game.as` (`lineCont`, `EnterFrame`) | — | — |

Shared canvas + per-frame clear (`Game.as`):
```
57:   public var unitCont:Sprite;
59:   public var lineCont:Shape;
...
139:   lineCont = new Shape();
...
153:   arena.midCont.addChild(lineCont);
...
235:   lineCont.graphics.clear();     // called ONCE per logic frame, BEFORE...
236:   hud.EnterFrame();
...
240:   units[i].EnterFrame();          // ...guns fire from here (later in the same frame)
...
258:   bullets[i].EnterFrame();        // ...and persistent tracers redraw from here
```
This ordering is why `Bullet_Line_Basic`'s dashed line (drawn once, in its **constructor**,
when the shot is fired inside a unit's `EnterFrame`) survives exactly one visible frame: it's
drawn after that frame's `clear()`, and the class's own `EnterFrame()` is an empty no-op
(`Bullet_Line_Basic.as:84-86`), so the next frame's `clear()` erases it with nothing
redrawing it.

### 2.1 `Bullet_Line_Basic` — the "broken/dashed" look (pistol, rifle, shotgun)

`Bullet_Line_Basic.as:15-82`. Constructor:
1. Steps the ray forward in 10px increments up to `maxDist/10` steps, testing `hitTestAll()`
   each step (`:19-29`) — this *is* the hitscan resolution, fused with the draw setup.
2. `doHitEffect()` (`:30`), then `curDist = round(dist(ox,oy, x,y))` (`:31`) — the actual
   travelled distance (muzzle to wall/body/max-range).
3. **Dash-point generation** (`:33-45`), only if `stats.params[0] === true` (per-weapon flag):
   ```as3
   _loc9_ = uint(UT.irand(0, 100));           // random start offset, 0-100px
   while(_loc9_ < curDist) {
     linePath.push(new Point(ox + xMoveToRot(rotation,_loc9_), oy + yMoveToRot(rotation,_loc9_)));
     _loc9_ += UT.irand(50, 250);             // random step, 50-250px, between points
   }
   ```
   If `params[0]` is `false`, `linePath` is just `[{ox,oy}]` — a single point, which (see
   step 4) draws as one **unbroken solid line** to the endpoint. So "dashed vs solid" is a
   per-weapon authored choice, not universal.
4. **Draw** (`:46-81`), once per stroke layer (`(params.length-1)/3` layers, always 2 in the
   shipped data — see the table in §2.4):
   ```as3
   newLine = true;
   game.lineCont.graphics.lineStyle(w, color, alpha);   // params[layer*3+1..3]
   for each point in linePath:
     if (!newLine) lineTo(point) else moveTo(point);
     newLine = !newLine;                                 // ALTERNATES every point
   if (!newLine) lineTo(x, y);                            // close the final dash to the impact
   ```
   Because `newLine` flips every point, consecutive point-pairs `(0,1)`, `(2,3)`, `(4,5)`…
   each draw ONE visible segment, and the gap between pair `(1,2)` is **never drawn at all** —
   the pen lifts (`moveTo`) instead of drawing (`lineTo`). That is the literal mechanism of
   the "half missing" line: roughly half of the sampled points produce a visible dash, the
   other half a bare gap, with both dash-length and gap-length randomized per shot
   (dash ≈ one `irand(50,250)` step minus the random jitter of the next point; the *first*
   gap before the first point is `irand(0,100)`px of solid muzzle-flash-adjacent line that's
   simply never drawn — the ray "starts" invisible for up to 100px).
5. No `EnterFrame` redraw (`:84-86`) → cleared next frame, i.e. visible for exactly one
   30fps tick (~33ms).

### 2.2 `Bullet_Line_Sniper` — persistent, drifting, fading beam

`Bullet_Line_Sniper.as`. Builds `linePath` as an array of `{x,y,lift}` objects sampled every
30px along the ray (`:74-88`, plus start/end points `:69-73`, `:89-93`), where `lift` is a
per-vertex random vertical drift: `UT.rand(lo, hi)` with `lo = params[0]?0.5:-0.2`... actually
`lo = stats.params[0] ? 0.2 : -0.2` and `hi = stats.params[0]?0.5:0.2` (`:53-67`) — i.e. a
"dashed"-flagged sniper drifts upward more (0.2–0.5 px/frame) than a non-flagged one
(−0.2–0.2 px/frame, can drift either way). Constructor draws it once solid (no gaps — every
point is `lineTo`, `:94-130`). `EnterFrame` (`:133-166`) each frame:
- `alpha -= 0.03` (→ ~33 frames / 1.1s to zero),
- every vertex's `y -= lift` (accumulates — the whole beam visibly rises/shimmers over its
  lifetime),
- redraws all stroke layers at `baseAlpha * alpha`,
- `removeMe()` once `alpha <= 0`.

### 2.3 `Bullet_Line_Bend` — quadratic "whip" (uzi)

`Bullet_Line_Bend.as`. Draws a **curved** (not straight) line: two `curveTo`s through
`mid1`→`mid`→`mid2`, where `mid` is the ray's true midpoint but `mid1`/`mid2` start offset by
a random `Point(rand(-50,50), rand(-50,50))` (`:72-98`) — the tracer visibly "kinks" away from
the straight line at first. `EnterFrame` (`:101-121`) lerps the control points back toward the
straight midpoints by 10%/frame (`mid1.x += (mid1to.x-mid1.x)*0.1`, i.e. `mid1to` IS the
un-offset target) while `alpha -= 0.1` (→ 10 frames / ~0.33s to zero) — the whip visibly
un-kinks into a straight line as it fades.

### 2.4 `Bullet_Line_Electric` — three jittered/drifting strands (railgun arc)

`Bullet_Line_Electric.as`. Builds three independent polylines (`line1Path/2/3`) at 30px
sampling, each vertex jittered by its own `lift = UT.rand(-0.3, 0.3)` (`:65-144`); if
`stats.params[0]` truthy, all three start pre-offset by `lift*10` (a bigger initial "spark
scatter", `:145-158`). Drawn with 2–3 stroke layers straight off `stats.params` triples
(`:159-208`). `EnterFrame` (`:211-289`): `alpha -= 0.03` (~33 frames), and **every vertex's x
and y both accumulate their own lift every frame** (`line1Path[i].x += lift; .y += lift`) —
so unlike the sniper (which only drifts vertically), the electric arc's three strands visibly
crawl outward independently, a "buzzing static" look.

### 2.5 `Bullet_Line_Laser` and `Bullet_Line_Zapper` — continuous re-fired beams

Both are used by weapons that fire every logic tick while held (Focus Beam, Zapper — see
`extra.soundFrames` throttling the *sound* only). Each **instance** lives one frame:
- `Bullet_Line_Laser.as`: builds two parallel polylines 10px apart in travel-order at the
  original sample points, each vertex `±1px` random (`:39-70`); `EnterFrame` (`:74-103`)
  re-jitters every vertex `±1px` **again** every frame it's redrawn, strokes both layers from
  `stats.params` (6 raw numbers, no leading flag — `[w1,color1,a1,w2,color2,a2]`), then
  immediately `removeMe()` — so in practice you only ever see one jittered frame per shot, but
  since a new instance spawns every tick while firing, the beam appears to buzz continuously.
- `Bullet_Line_Zapper.as`: colors and widths are **hardcoded**, not data-driven — outer layer
  `0xCC00FF` (13369599) at `alpha*0.5`, width `3*strength`; inner `0x9900FF` (10027263) at
  `alpha*1`, width `2*strength` (`:110,120`). `strength` differs whether the ray hit a unit:
  miss → `strength=1.7`, `alpha=0.8`, and every vertex besides the first is scattered by up to
  `±index` px (bigger scatter further from the muzzle) (`:73-93`); hit → `strength =
  ((maxDist-curDist)/maxDist + 0.1) * 5` (closer hits are thicker/brighter), `alpha=1`
  (`:94-104`). Also drives hitscan damage falloff: `dmgMod = (maxDist-curDist)/maxDist*1.5 +
  0.5` (`:70-72`) — 2× point-blank down to 0.5× at max range.

### 2.6 `Bullet_Line_Effect` — solid piercing beam + chasing spark (railgun)

`Bullet_Line_Effect.as`. Unlike Basic, this draws **one continuous solid line** (`moveTo` +
`lineTo`, no dash toggling, `:92-99`) from muzzle to the (possibly pierced-through) impact —
appropriate for a "particle accelerator beam." `EnterFrame` (`:104-153`):
- `alpha -= 0.03` while `>0`, redraws the same straight solid line at decaying alpha,
- separately animates a **spark** that chases from the muzzle toward the impact point,
  2 sub-steps of `xVel*3, yVel*3` per frame, spawning `stats.params[0]`'s effect (e.g.
  `"chain_fire"`) at each sub-step (`:136-148`), stopping once within 40px of the impact,
  tracked via `toDist`,
- `removeMe()` only once **both** `alpha<=0` **and** `toDist<=30` — the beam fade and the
  spark's arrival are independent conditions that both have to finish.
- Supports `stats.extra.pierce`: on pierce, keeps stepping through multiple hit units
  (`Bullet_Line_Effect.as:66-91`, dedup'd via `hitObjects`), each getting `doHitEffect()`.

### 2.7 Exact per-weapon params (from `Stats_Guns.as`, decimal → `0xRRGGBB`)

`addGun(..., bulletClass, params, extra, ...)`. Params layout for Basic/Sniper/Bend/Electric:
`[dashFlag, w1, color1, a1, w2, color2, a2, (w3, color3, a3)...]`. For Laser: `[w1, color1,
a1, w2, color2, a2]` (no flag). Zapper: `[]` (hardcoded, §2.5).

| Weapon (id in Stats_Guns) | Class | Params (raw) | Decoded |
|---|---|---|---|
| pistol | Basic | `[true,3.5,16777156,0.3, 1.5,16777156,0.6]` | dashed; glow `w3.5 0xFFFFC4 a0.3`, core `w1.5 0xFFFFC4 a0.6` |
| mauser | Sniper | `[true,1.5,16776960,0.3, 0.5,16776960,0.6]` | drifts up; glow `w1.5 0xFFFF00 a0.3`, core `w0.5 0xFFFF00 a0.6` |
| uzi | Bend | `[true,1.5,16777156,0.3, 0.5,16777156,0.6]` | whip; glow `w1.5 0xFFFFC4`, core `w0.5 0xFFFFC4` |
| "Headshot++" pistol (`:223`) | Basic | `[false,5.5,16777156,0.3, 1.5,16777156,0.8]` | **solid** (no dash), thick `w5.5 0xFFFFC4 a0.3` + `w1.5 a0.8` |
| shotgun | Basic | `[true,3.5,16777156,0.3, 1.5,16777156,0.6]` | same dashed pale-yellow as pistol |
| "Multi-Shot" laser-shotgun (`:334`) | Bend | `[true,5.5,10066431,0.3, 2.5,14510826,0.7]` | glow `w5.5 0x9999FF a0.3`, core `w2.5 0xDD6AEA a0.7` |
| Zapper (alien) | Zapper | `[]` | hardcoded `0xCC00FF`/`0x9900FF` (§2.5) |
| Terminator shotgun | Sniper | `[false,3.5,16764006,0.2, 1.5,16764006,0.3]` | no-dash-drift variant; both layers `0xFFCC66`, low alpha |
| assault rifle | Basic | `[true,3.5,16777156,0.3, 1.5,16777156,0.6]` | dashed pale-yellow |
| Precision Laser (`:437`) | Basic | `[false,3.5,6938712,0.4, 1.5,16777215,0.9]` | **solid**; glow `w3.5 0x69E058 a0.4` (green), core `w1.5 0xFFFFFF a0.9` (near-opaque white) |
| .50 Cal Sniper | Sniper | `[true,3.5,13421772,0.3, 1.5,15658734,0.6]` | glow `0xCCCCCC`, core `0xEEEEEE` |
| Railgun (piercing) | Effect | `["chain_fire",5.5,14352898,0.6, 2.5,16777215,0.8]` | spark fx `chain_fire`; glow `w5.5 0xDB0202 a0.6` (red), core `w2.5 0xFFFFFF a0.8` |
| fire-sniper variant | Sniper | `[false,7,16764006,0.2, 4,16764006,0.3]` | thick, both `0xFFCC66`, low alpha |
| railgun-arc "Electro Bolt" | Electric | `[true,3.5,52479,0.4, 2.5,39423,0.5, 1.5,13434879,0.4]` | **3 layers**: `0x00CCFF a0.4`, `0x0099FF a0.5`, `0xCCFFFF a0.4` |
| Focus Beam | Laser | `[8,6736896,0.5, 4,9882625,0.8]` | glow `w8 0x66CC00 a0.5`, core `w4 0x96CC01 a0.8` |
| Destroyer (heavy) | Sniper | `[true,6.5,14352898,0.8, 4.5,16777215,0.8]` | thick red/white |
| Ion Cannon | Sniper | `[true,8.5,16763904,0.5, 3.5,16777156,0.6]` | thick orange→pale-yellow |
| Credit Cannon | Sniper | `[true,7.5,26265,0.5, 2.5,6737151,0.6]` | dark blue glow `0x006699`, cyan core `0x66CCFF` |

Note the Electric row has **3 stroke layers** — the current port's params reader only extracts
2 (see §4).

## 3. Current port state

Files: `raze-ts/src/game/GameScreen.ts` (rendering), `raze-ts/src/game/Guns.ts` (hitscan +
call site), `raze-ts/src/game/weapons.ts` (per-weapon tracer data).

This system is already **substantially ported and faithful** — most of the mechanism in §2 is
implemented, not just approximated.

- **Style taxonomy matches 1:1.** `weapons.ts:33-34` defines `TracerStyle = "basic" |
  "sniper" | "bend" | "electric" | "laser" | "zapper" | "effect"`, and `weapons.ts:350-354`
  (`CLS_TRACER`) maps each `Bullet_Line_*` AS3 class name directly to a style.
- **Dash algorithm is a faithful port**, `GameScreen.ts:893-911` (build) +
  `GameScreen.ts:990-1001` (draw):
  ```ts
  // GameScreen.ts:896-905 — matches Bullet_Line_Basic.as:33-45 almost exactly
  const stops: number[] = [];
  for (let d = irnd(0, 100); d < len; d += irnd(50, 250)) stops.push(d);
  stops.push(len);
  for (let i = 0; i + 1 < stops.length; i += 2) {
    const a = stops[i]; const b = stops[i + 1];
    segs.push(x1+ux*a, y1+uy*a, x1+ux*b, y1+uy*b);   // draws (0,1), skips (1,2), draws (2,3)...
  }
  ```
  This reproduces the "random start offset, random step, alternating draw/skip" mechanism
  exactly, including the same magic numbers (`irand(0,100)` start, `irand(50,250)` step).
- **Two-pass glow+core stroke** for every style, gated by `Quality.glow`
  (`GameScreen.ts:974`, e.g. `:999-1000` for basic) — matches the AS3's multi-layer
  `lineStyle` stack.
- **Persistence/lifetime per family** (`GameScreen.ts:869-878`): `sniper`/`electric`/`effect`
  get `Quality.tracerLife*5+6` frames (≈26-36 frames depending on quality — close to the AS3's
  fixed ~33-frame/`alpha-=0.03` fade), `bend` gets a fixed 10 frames (**matches** the AS3's
  `alpha -= 0.1` → exactly 10 frames, `Bullet_Line_Bend.as:103`), everything else (`basic`,
  `laser`, `zapper`) gets 2 frames.
- **Per-style redraw/drift**: sniper drifts by `-elapsed` along the normal
  (`GameScreen.ts:1006`, approximating the AS3's cumulative `y -= lift`); electric strands
  drift by `+elapsed`/`-elapsed` (`:1014-1016`); bend un-kinks via `Math.pow(0.9, elapsed)`
  (`:1022`, a closed-form version of the AS3's per-frame 10% lerp — equivalent end behavior);
  laser/zapper re-jitter every redraw call (`:1041-1074`); effect draws a solid two-pass line
  plus a chasing spark circle synced to `elapsed` (`:1076-1090`, approximating
  `Bullet_Line_Effect`'s `toX/toY` chase).
- **Per-weapon params are read out of the real `Bullet_Line_*` `params` arrays**
  (`weapons.ts:366-392`, `tracerFromParams`), not hand-picked — colors/widths/alphas/dash-flag
  come straight from the same `Stats_Guns.as` data tabulated in §2.7, via
  `raze-ts/src/assets/raze2/weapons.json`. The 10 "native" (hand-tuned Raze-1-holdover)
  weapons additionally get an explicit override table (`weapons.ts:289-313`,
  `NATIVE_WIRING`) with the same colors baked in (e.g. pistol `0xFFFFC4` dashed,
  `weapons.ts:291`; sniper `0xCCCCCC`/`0xEEEEEE`, `:292-294`; railgun `0xDB0202`/`0xFFFFFF`,
  `:295-297`; plasma-as-zapper `0xCC00FF`/`0x9900FF`, `:302-303`).
- **Call site**: `Guns.ts:405-507` (`fireHitscan`) resolves the ray in 6px steps (its own
  collision loop, separate from the draw), then calls `addTracer(m.x, m.y, hitX, hitY,
  this.tracerOpts(beam, !!unitHit))` once at `:506`. `tracerOpts` (`:514-528`) derives style/
  color/width/dash straight from the `WeaponDef` fields populated in `weapons.ts`, defaulting
  un-authored beams to `"effect"` and un-authored rays to `"basic"` with dashing on.
  Arc-chain hits (`arcChain`, `:536-558`) draw an `"electric"` tracer per chained target.

## 4. Gap analysis

Concrete, measurable differences between the AS3 target and the current port:

1. **Frame-clear semantics differ, not just numbers.** AS3 clears `lineCont` once per game
   frame and only `Bullet_Line_Basic`/`Laser`/`Zapper` fail to redraw (hence exactly 1-frame
   life); the port instead gives `basic`/`laser`/`zapper` a hardcoded `life = 2`
   (`GameScreen.ts:877`) — twice as long as the original's single tick. This was presumably a
   deliberate visibility concession (a literal single 30fps frame, ~33ms, would be nearly
   subliminal on a 60fps-rendered game with variable frame pacing), but it is a real,
   documented departure from the source and should be called out as intentional if kept.
2. **`Bullet_Line_Electric` supports N stroke layers (3 in the shipped Electro Bolt gun,
   `params` has 9 numbers after the flag → 3 triples, §2.7); `tracerFromParams`
   (`weapons.ts:384-391`) only reads 2 triples (`p[1..3]`, `p[4..6]`) — the 3rd layer
   (`0xCCFFFF`, width 1.5, alpha 0.4) is silently dropped for every weapon using this class.**
   The port's `drawTracer` "electric" case (`GameScreen.ts:1011-1017`) does draw a `s2`
   third strand, but it's a synthesized `0xccffff`/`0.4` glow-only pass
   (`GameScreen.ts:1016`), not the actual 3rd data-driven layer — coincidentally close in
   color to the real one, but not sourced from `params`.
3. **`Bullet_Line_Basic`'s "solid" (non-dashed) variant loses its distinct per-layer alpha
   asymmetry nuance.** In AS3, `params[0]===false` produces one continuous line — used by 2
   guns in §2.7 ("Headshot++" pistol, Precision Laser) specifically for a "laser-precision"
   feel distinct from the common dashed guns. The port's `tracerDashed` correctly reads
   `p[0]===true` (`weapons.ts:388`) and `dashed` correctly gates the segment builder
   (`GameScreen.ts:895,906-908`), so this **is** ported correctly — flagging it here only
   because it's easy to regress if `tracerFromParams` is ever "simplified" to assume all
   Basic-class guns are dashed.
4. **Zapper strength/alpha branching (miss vs. hit, `Bullet_Line_Zapper.as:73-104`) is not
   ported.** The port's zapper `strength` is fixed at shot-creation from `o.hitUnit ? 3 :
   1.7` (`GameScreen.ts:950`) — a flat 3 vs 1.7, whereas AS3 scales `strength` continuously
   with `(maxDist-curDist)/maxDist` on a hit (closer hits are visibly thicker/brighter, up to
   5x) and applies wider, distance-scaled positional scatter (`±index`px per vertex) on a
   miss (`Bullet_Line_Zapper.as:80-91`) that the port's flat `±1.5px` jitter
   (`GameScreen.ts:1065`) does not reproduce.
5. **`Bullet_Line_Sniper`'s dash-flag also changes drift *direction/range*
   (`Bullet_Line_Sniper.as:53`: flagged → drifts 0.2–0.5px/frame upward only; unflagged →
   drifts −0.2–0.2px/frame either way), not just dash density.** The port's sniper `hi`
   (`GameScreen.ts:914`, `o.dashed ? 0.5 : 0.2`) matches the upper bound but always uses `-0.2`
   as the lower bound regardless of the flag, so the "unflagged" sniper variants (Terminator
   shotgun, fire-sniper, Destroyer, Ion Cannon, Credit Cannon — several of the port's actual
   `NATIVE_WIRING`/generated guns) drift with a slightly different bias than AS3.
6. **Bullet_Line_Laser's per-instance re-jitter is continuous-fire-only in AS3** (a new
   `Bullet_Line_Laser` object is constructed by `Guns.as` every tick the trigger is held); the
   port's "laser" style is drawn through the same one-shot `addTracer` call as every other
   hitscan (`Guns.ts:506`), so whether the port's Focus-Beam-equivalent weapon actually
   re-fires `addTracer` every tick (producing the buzzing look) or once per discrete trigger
   pull depends on `Guns.ts`'s `autoFire`/fire-delay wiring for that weapon — not verified in
   this pass; flagged as something the implementation checklist must confirm.
7. **No screenshot to visually diff against** (§6) — every claim above is derived from
   reading the draw code, not compared to a render.

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Decide and document whether `basic`/`laser`/`zapper` should switch to a true 1-frame life
   (matching AS3 exactly) or keep the current 2-frame concession
   (`GameScreen.ts:877`) — if the latter, add a comment citing this doc so it reads as
   intentional, not a bug.
2. Extend `tracerFromParams` (`weapons.ts:366-392`) to read all `(params.length-1)/3` triples
   for `electric` (and generically for any Basic/Sniper/Bend gun that ships >2 triples,
   `Bullet_Line_Basic.as:47-55` / `Bullet.as` all loop generically) into a `layers: {w,color,
   alpha}[]` array on `WeaponDef`, and have `GameScreen.drawTracer`'s "electric" (and others)
   iterate that array instead of two hardcoded `w1/w2` fields plus a synthesized 3rd pass.
3. Port `Bullet_Line_Sniper`'s dash-flag-dependent drift bounds exactly
   (`Bullet_Line_Sniper.as:53`: `lo = flag ? 0.2 : -0.2`) into `GameScreen.ts:914`'s `poly`
   builder (currently hardcodes `-0.2` regardless of `o.dashed`).
4. Port `Bullet_Line_Zapper`'s continuous strength/scatter formulas
   (`Bullet_Line_Zapper.as:70-104`) into `GameScreen.ts`'s zapper `tr.strength` computation
   (currently a flat `950`: `o.hitUnit ? 3 : 1.7`) and jitter (`:1064-1070`, currently flat
   `±1.5`) — needs `curDist`/`maxDist` threaded through `TracerOpts` from `Guns.ts:429,448-450`
   (which already computes an equivalent `dmgMod` for damage — reuse that value for the visual
   too instead of recomputing).
5. Verify whether the port's continuous-beam weapons (Focus Beam equivalent, if/when added to
   `weapons.json`/`WEAPONS`) actually call `addTracer` every fire-tick like AS3's
   `Bullet_Line_Laser` (re-constructed every frame while firing) rather than once per discrete
   shot — check `Guns.ts` fire-delay wiring for any `tracerStyle === "laser"` weapon.
6. Once the reference screenshot (#9, listed in `docs/raze2-spec/README.md` but currently
   missing on disk — see §6) is available, do a side-by-side visual check against
   `Bullet_Line_Basic`'s dash output (dash length ≈ 50-250px minus jitter, first "gap" up to
   100px, 2-layer glow+core stroke, pale-yellow `0xFFFFC4` for the common guns) and adjust
   any of the above if the actual rendered look diverges from what the numeric analysis in §2
   implies (e.g. if antialiasing/blend-mode on the original `lineStyle` calls softens the
   dash edges in a way that isn't obvious from the draw calls alone).
7. Consider whether solid (non-dashed) Basic-class guns (`params[0]===false`: the
   "Headshot++" pistol and Precision Laser, §2.7) are represented in the current
   `weapons.json`/`NATIVE_WIRING` roster at all, and if so confirm they get `tracerDashed:
   false` rather than inheriting the `"basic"` default of `dashed: true`
   (`Guns.ts:526`: `dashed: g.tracerDashed ?? (style === "basic")`).

## 6. Open questions / data still missing

- **Reference screenshot #9 is missing from disk.** `docs/raze2-spec/README.md` lists it at
  `C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\9.png`; neither
  that file nor the parent `image-cache` directory exists anywhere under
  `C:\Users\Hamdan\.claude` on this machine (checked via recursive search). This doc is
  therefore built entirely from the AS3 draw-call analysis (§2), which is exact for
  numeric values (widths/colors/alphas/timings) but cannot confirm second-order visual
  qualities like antialiasing softness, on-screen apparent brightness under the game's
  blend mode/lighting, or exact screen-space scale of the dashes relative to a character
  sprite. Re-run a visual comparison once the screenshot is recovered or re-captured.
- **Which specific weapon (`Guns.ts`/`weapons.json` id) corresponds to each `Stats_Guns.as`
  entry in §2.7** was not cross-referenced against the port's live roster in this pass —
  the gap analysis (§4) assumes the mapping in `weapons.ts:289-313` (`NATIVE_WIRING`) and
  `weapons.ts:350-392` is complete and correctly targets the same guns, but a full audit of
  every generated (non-native) Raze 2 gun's tracer wiring against its exact `Stats_Guns.as`
  params array was out of scope here (there are 20+ guns in Stats_Guns.as; only the ones
  using `Bullet_Line_*` are tabulated above, and only a subset match the port's current
  10-native + generated-JSON roster).
- **`extra.mauser` / `Bullet.as:90-97`** applies a special flag for the "mauser" gun that
  isn't obviously tracer-related (likely feeds a different system — crit/credits bonus) but
  showed up while reading `Bullet.as`'s constructor; not investigated further as it's outside
  this doc's domain.
