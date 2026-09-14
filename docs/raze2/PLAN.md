# Raze 2 Full-Parity Plan

> **Status 2026-09-14:** Phase 0 documentation is complete (docs 01-16), and Phases 1-5
> have largely landed — movement constants + terrain mods, the full weapon/projectile/
> raycast rebuild, abilities/equipment/economy/AI/campaign/modes, maps+props+particles,
> HUD chrome and audio. The remaining known items are small and listed in each doc's
> Port status; the map variants (`city2` etc.) are source-limited (no Arena frames).
> Every subsystem's Port status has been spot-corrected where it was stale.

Goal: bring the TypeScript/PixiJS port to **100% Raze 2 parity** — every screen, system,
weapon, and visual matching the original SWF. This file is the master plan. **Phase 0
(documentation) runs first and blocks everything else**: we gather 100% of the game's data
into `docs/raze2/*.md` before writing any feature code, so implementation is
transcription, not rediscovery.

## Working rule
- **Do not implement during Phase 0.** Agents only read the decompiled SWF + the port and
  write reference docs. Implementation (Phase 1+) starts only after the docs land and are reviewed.
- Every doc must include a **Port status** section: what `raze-ts` already has (cross-referenced
  to real files/lines) vs. what is missing, wrong, or incomplete against the original.

## Sources of truth
- Decompiled original: `decompiled_swf/raze 2/` (`scripts/`, `sprites/`, `shapes/`, `images/`, `sounds/`, `frames/`, `fonts/`, `raze-2.swf`).
  - Decompiler caveats: `.as`/`_2.as` pairs (read the non-`_2`); `§§push`/`§§pop` stack artifacts; `if(false){}` dead guards; some data lives in gutted lazy `switch` getters, not `Init()`.
- FFDec: `C:\Program Files (x86)\FFDec\ffdec.bat` (`-swf2xml`, `-export sprite/shape/frame/image`, `-selectid`, `-zoom`).
- Port: `raze-ts/` (already-extracted data under `src/assets/raze2/`, maps in `src/assets/raze2maps.json`).

---

## Phase 0 — Documentation (15 agents, IN PROGRESS)
Each agent owns one subsystem and writes `docs/raze2/NN-topic.md`. See `INDEX.md`.

01 player-movement · 02 player-rig-skins · 03 weapons-guns · 04 projectiles-bullets ·
05 raycast-fx · 06 abilities · 07 equipment · 08 economy · 09 ai-bots · 10 campaign ·
11 modes-match · 12 maps-environment · 13 ui-menus · 14 hud-chrome · 15 audio-music

---

## Phase 1 — Visual language & chrome (from docs 13, 14)
The user's screenshots define the target look. Build the shared UI kit first so every screen
reuses it.
1. **Button + panel style system** — the beveled dark-glass button with the amber/blue
   accent bar and the small-caps serif label (pause-menu buttons). One reusable widget.
2. **Health/shield nameplate bars** — the segmented player (blue) / alien (orange) bars with
   the name plate, glow, and the little EKG/graph strip. Replace the current HUD bars.
3. **In-game loadout weapon strip** — the bottom weapon bar with slot thumbnails, selected
   highlight, ammo pip, credits bar (Earned / Credits / Total).
4. Restyle **Menu (start)**, **Campaign select**, **Quick Match**, **Options**, **Pause**,
   **View Scores** to match images 3–8 (layout, fonts, palette, backdrop, "Armor Games" chrome, `v2.0`).

## Phase 2 — Player feel (from docs 01, 02, 12)
5. **Raze 2 movement** — swap the kinematic controller constants/behavior to the documented
   accel/friction/jump/double-jump/gravity/air-control values.
6. **Raze 2 jump pads** — geometry + launch force + animation from the maps doc.

## Phase 3 — Weapons overhaul (from docs 03, 04, 05)
7. **Replace all Raze 1 weapons with the Raze 2 arsenal** — the full gun set becomes the
   canonical loadout (not pickup-only add-ons); per-gun stats, categories, unlocks.
8. **Per-weapon projectile physics** — each weapon's own bullet class (homing/bounce/sticky/
   mine/arc/pierce/zapper/burrow/beam/flame) with its physics, design, and colors.
9. **Raycast look** — reproduce Raze 2's tracer/beam rendering, including the intentionally
   "incomplete / half-missing" raycast segments (image 9), muzzle flashes, and impact FX.

## Phase 4 — Systems parity (from docs 06–11)
10. Abilities, equipment, economy/achievements, AI behavior, campaign scripting, modes &
    special modes — reconcile each against its doc's Port-status gap list.

## Phase 5 — Environment & audio (from docs 12, 15)
11. Water/reflections/particles, per-screen/map music and full SFX coverage.

Each phase ends with `npx tsc --noEmit` + `npx vite build` green and a Playwright visual check.
