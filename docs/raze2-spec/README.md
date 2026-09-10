# Raze 2 Port — Full Specification (Documentation Phase)

**Goal:** a single, authoritative place documenting **100% of Raze 2**, extracted from the
decompiled SWF + reference screenshots, so the subsequent implementation phase is pure
"read the spec, build it" with no re-discovery.

> **This phase is DOCUMENTATION ONLY.** No game code is changed here. Each agent writes one
> `NN-*.md` spec file. Implementation happens later, in a separate pass, driven by these docs.

## Sources of truth

| What | Where |
|---|---|
| Decompiled Raze 2 AS3 | `C:\Users\Hamdan\Desktop\mc\raze\decompiled_swf\raze 2\scripts` (read the non-`_2` of each `Foo.as`/`Foo_2.as` pair) |
| Decompiled assets (sprites/shapes/images as SVG/PNG) | `…\decompiled_swf\raze 2\{sprites,shapes,images,frames}` |
| SWF (for FFDec renders) | `…\decompiled_swf\raze 2\raze-2.swf`; FFDec `C:\Program Files (x86)\FFDec\ffdec.bat` |
| Current TS/PixiJS port | `C:\Users\Hamdan\Desktop\mc\raze\raze-ts\src` |
| Already-extracted catalogs | `raze-ts/src/assets/raze2/*.json` (weapons, killBonuses, skins, equipment, abilities, achievements, campaign) |
| Reference screenshots | `C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\<n>.png` (see map below) |

### Reference screenshot map
1. In-game **player health/shield bar** · 2. **alien health bar** · 3. **Campaign screen** ·
4. **Quick Match / play-setup screen** · 5. **Menu / start screen** · 6. **in-game loadout bar** ·
7. **View Scores / pause scoreboard** · 8. **Options screen** · 9. **raycast/tracer look** (the
deliberately "incomplete / half-missing" beam).

## Documentation template (every `NN-*.md` follows this)

```
# <Domain>
## 1. Summary
One paragraph: what this system is in Raze 2.
## 2. Raze 2 source of truth
- AS3 files (exact paths) + the classes/functions that matter.
- SWF symbol ids for art/clips; exact numeric constants (speeds, sizes, colors as 0xRRGGBB, timings in frames @30fps).
- Reference screenshot(s) with a description of every visible element (layout, fonts, colors, spacing).
## 3. Current port state
- What the TS port already does (files + line refs), and how faithful it is.
## 4. Gap analysis
- Bullet list: Raze2 target vs port today. Be specific and measurable.
## 5. Implementation checklist (for the LATER build phase — do NOT do it now)
- Ordered, concrete steps a future agent can execute. Note affected port files.
## 6. Open questions / data still missing
```

Rules: cite exact file paths + line numbers + symbol ids + numeric values. Prefer tables. Colors as `0xRRGGBB`.
Do NOT edit any file outside your own `docs/raze2-spec/NN-*.md`.

## The 15 documentation domains

| # | File | Domain |
|---|---|---|
| 01 | `01-weapons-catalog.md` | Every weapon: full stat table, ammo/fire-rate/spread/recoil/damage/crits, which bullet class each uses |
| 02 | `02-projectile-physics.md` | Bullet & projectile classes: each mechanic (homing/bounce/sticky/mine/arc/pierce/zapper/burrow/beam/flame), speeds, gravity, lifetime, collision |
| 03 | `03-weapon-visuals-fx.md` | Per-weapon art/design, colors, muzzle flash, shells, impact effects, pickup art |
| 04 | `04-raycast-tracers.md` | Hitscan/raycast rendering incl. the "incomplete/half-missing" tracer look (shot #9) |
| 05 | `05-player-movement.md` | Unit movement physics & feel + animation state machine / rig |
| 06 | `06-jump-pads-nodes.md` | Jump pads (force/size/art) + all map interactive nodes (spawns, flags, holdpoints, hazards, teleporters) |
| 07 | `07-hud-healthbar.md` | In-game HUD: player + alien health/shield bars (#1/#2), ammo, crosshair, minimap, kill feed, streaks |
| 08 | `08-menu-ui-theme.md` | Menu/start screen (#5) + the global UI design system: buttons, fonts, panels, palette, chrome |
| 09 | `09-quickmatch-play.md` | Quick Match / play-setup screen (#4): map carousel, match type, options, teams, players/difficulty |
| 10 | `10-campaign.md` | Campaign screen (#3) + all 30 missions data + cutscenes/dialogue/briefings |
| 11 | `11-armory-loadout.md` | Armory shop + in-game loadout bar (#6) + credits economy + upgrades |
| 12 | `12-pause-scores.md` | Pause menu + View Scores scoreboard (#7) |
| 13 | `13-options-quality.md` | Options screen (#8) + graphics presets / quality / detail system |
| 14 | `14-abilities-equipment.md` | The 8 abilities + 3-slot equipment: effects, energy bar, costs, visuals, inputs |
| 15 | `15-systems-index.md` | Everything else for 100%: game modes (+special modes), AI behavior, kill-bonuses, achievements, skins catalog, maps/themes, audio/music, particles/FX, water/reflections, blood, corpses |

Each doc must flag anything that turns out large enough to deserve its own follow-up spec.
