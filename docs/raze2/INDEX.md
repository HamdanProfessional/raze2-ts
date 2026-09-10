# Raze 2 Reference Docs — Index

100% of the original game's data, one subsystem per file. Written in Phase 0 (see `PLAN.md`)
before any implementation. Each doc ends with a **Port status** section (have / missing / wrong).

| # | Doc | Scope |
|---|-----|-------|
| 01 | `01-player-movement.md` | Kinematic controller: accel, friction, jump, double-jump, gravity, air control, crouch, step/ledge, wall collision, knockback — exact constants |
| 02 | `02-player-rig-skins.md` | UnitMC rig, animation states + frame ranges, head/arm holders, aim tracking, facing; all 31 skins (frame/race/cost/blood) |
| 03 | `03-weapons-guns.md` | Every gun: damage, RoF, ammo/clip, reload, spread, recoil, range, ray type/pellets, crits, category, cost, art symbol, sounds, muzzle color |
| 04 | `04-projectiles-bullets.md` | Bullet + all Bullet_Proj_* classes; per-class physics; gun→class map; projectile design + hex colors, trails/glow |
| 05 | `05-raycast-fx.md` | Tracer/beam rendering incl. the "half-missing" raycast look; muzzle flashes; impact sparks/decals; Effect_* clips |
| 06 | `06-abilities.md` | All 8 abilities; energy bar (max/recharge/cost); effects; costs; icons; sounds |
| 07 | `07-equipment.md` | 3 slots, 21 items; passive effects + magnitudes; costs; what each modifies |
| 08 | `08-economy.md` | ~30 kill bonuses (worth/condition); credit sources; shop pricing; achievements + rewards + triggers (incl. cat/health/ammo/moon easter eggs) |
| 09 | `09-ai-bots.md` | AI states, targeting, difficulty scaling, personalities/chatter, node nav, accuracy, ability/equip use, objective behavior, bot names |
| 10 | `10-campaign.md` | All 30 missions: map/mode/cap/roster/briefing/dialogue/cutscenes/upgrades/progression/difficulty |
| 11 | `11-modes-match.md` | DM/TDM/Elim/CTF/Dom/Juggernaut rules + scoring + win; special modes; MatchSettings; teams; weapon-set restrictions; Quick Match options |
| 12 | `12-maps-environment.md` | Stats_Maps; Bg(1365)/BgSky(1421) frame→map; parallax; wall geometry char ids; nodes; jump pads; water/reflections; particles; names/descs |
| 13 | `13-ui-menus.md` | Menu/start, Campaign select, Quick Match, Armory, Achievements, Credits — layout, fonts, hex palette, backdrops, chrome, `v2.0` |
| 14 | `14-hud-chrome.md` | HUD health/shield bars, loadout strip, credits bar, minimap, crosshair, kill feed; Pause, Options, View Scores; shared BUTTON + PANEL style system |
| 15 | `15-audio-music.md` | Every SFX (id/file/trigger/volume/range); all music tracks per screen/map/campaign |
