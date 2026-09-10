# 15 — Audio & Music (Raze 2)

Source: `decompiled_swf/raze 2/scripts/*.as`, `decompiled_swf/raze 2/sounds/*.mp3`.
Port: `raze-ts/src/audio/Sounds.ts`, `raze-ts/src/game/Guns.ts`, `raze-ts/src/game/Unit.ts`,
`raze-ts/src/game/Abilities.ts`, `raze-ts/src/game/Projectile.ts`, `raze-ts/src/game/Objectives.ts`,
`raze-ts/src/game/Achievements.ts`, screens under `raze-ts/src/screens/*`.

All linkage classes (`S_*.as`, `M_*.as`) are trivial `[Embed] extends Sound` stubs — e.g.
`scripts/S_Fire.as:1-13` embeds `2135_S_Fire.mp3`. The engine plays them by passing the *class*
(not an instance) to `SH.playSound`/`SH.playMusic`, which does `new param1().play()`
(`scripts/SH.as:78`).

## 0. The `sounds/` export directory — every asset

`decompiled_swf/raze 2/sounds/` contains exactly 46 files. Numeric prefix = SWF character/linkage id.

| File | Linkage id | Class |
|---|---|---|
| `28_M_Necro.mp3` | 28 | `M_Necro` |
| `29_M_Rose.mp3` | 29 | `M_Rose` |
| `30_M_Ricochet.mp3` | 30 | `M_Ricochet` |
| `31_M_Infernal.mp3` | 31 | `M_Infernal` |
| `32_M_Theloop.mp3` | 32 | `M_Theloop` |
| `33_M_Throwdown.mp3` | 33 | `M_Throwdown` |
| `34_M_Rocket.mp3` | 34 | `M_Rocket` |
| `35_S_rocketFire.mp3` | 35 | `S_rocketFire` |
| `36_S_CamelJizz.mp3` | 36 | `S_CamelJizz` |
| `37_M_MenuIntro.mp3` | 37 | `M_MenuIntro` |
| `38_M_Warhead.mp3` | 38 | `M_Warhead` |
| `39_S_Medal.mp3` | 39 | `S_Medal` |
| `40_S_ClickBack.mp3` | 40 | `S_ClickBack` |
| `41_S_Whip.mp3` | 41 | `S_Whip` |
| `2114_M_Menu.mp3` | 2114 | `M_Menu` |
| `2115_S_ClickGo.mp3` | 2115 | `S_ClickGo` |
| `2116_S_Equip.mp3` | 2116 | `S_Equip` |
| `2117_S_Click.mp3` | 2117 | `S_Click` |
| `2118_S_alienSniper.mp3` | 2118 | `S_alienSniper` |
| `2119_S_reloadRifle.mp3` | 2119 | `S_reloadRifle` |
| `2120_S_assaultFire.mp3` | 2120 | `S_assaultFire` |
| `2121_S_plasmaFire.mp3` | 2121 | `S_plasmaFire` |
| `2122_S_reloadHeavy.mp3` | 2122 | `S_reloadHeavy` |
| `2123_S_GunClick.mp3` | 2123 | `S_GunClick` |
| `2124_S_Error.mp3` | 2124 | `S_Error` |
| `2125_S_rocketExplode.mp3` | 2125 | `S_rocketExplode` |
| `2126_S_ripperFire.mp3` | 2126 | `S_ripperFire` |
| `2127_S_reloadPistol.mp3` | 2127 | `S_reloadPistol` |
| `2128_S_Headshot1.mp3` | 2128 | `S_Headshot1` |
| `2129_S_Headshot2.mp3` | 2129 | `S_Headshot2` |
| `2130_S_Headshot3.mp3` | 2130 | `S_Headshot3` |
| `2131_S_laserBig.mp3` | 2131 | `S_laserBig` |
| `2132_S_Laser.mp3` | 2132 | `S_Laser` (unused — grep found no call site) |
| `2133_S_pistolFire.mp3` | 2133 | `S_pistolFire` |
| `2134_S_reloadRocket.mp3` | 2134 | `S_reloadRocket` |
| `2135_S_Fire.mp3` | 2135 | `S_Fire` (unused — grep found no call site) |
| `2136_S_Heal.mp3` | 2136 | `S_Heal` |
| `2137_S_Powerup.mp3` | 2137 | `S_Powerup` |
| `2138_S_Jumppad.mp3` | 2138 | `S_Jumppad` |
| `2139_S_reloadShotgun.mp3` | 2139 | `S_reloadShotgun` |
| `2140_S_shotgunFire.mp3` | 2140 | `S_shotgunFire` |
| `2141_S_reloadSniper.mp3` | 2141 | `S_reloadSniper` |
| `2142_S_sniperFire.mp3` | 2142 | `S_sniperFire` |
| `2143_S_Static.mp3` | 2143 | `S_Static` |
| `2144_S_uziFire.mp3` | 2144 | `S_uziFire` |
| `2145_S_Zapper.mp3` | 2145 | `S_Zapper` (unused — grep found no call site; likely a leftover from Raze 1's `S_Zapper`) |

That is **8 in-match music tracks + 2 menu/intro tracks = 10 music files**, and **36 sound-effect
files** (3 of which — `S_Laser`, `S_Fire`, `S_Zapper` — have no reachable call site in the
non-`_2` scripts and appear to be dead/unused assets carried over from Raze 1).

## 1. Sound effects — id, trigger, params

The engine has exactly two entry points for one-shots, both in `scripts/SH.as:66-73`:

```as
SH.playSound(class, loud:Boolean = false)   // global volume, no position
```

`Game.playScreenSound(class, x, y, loud=false)` (`scripts/Game.as:301-310`) additionally
**gates on screen visibility** — see §3 — then calls `SH.playSound` with the same `loud` flag.
There is no distance falloff or panning; `loud` just picks between two fixed `SoundTransform`
volumes (0.4 normal / 0.7 "loud", `scripts/SH.as:60-64`).

| Linkage (file id) | Trigger | Call site | Loud? | Notes |
|---|---|---|---|---|
| `S_pistolFire` (2133) | Pistol / Mauser fire | `Stats_Guns.as:110,169` `shotSound` → `Guns.as:379,385` | no | |
| `S_shotgunFire` (2140) | Shotgun / Terminator / Particle Cannon fire | `Stats_Guns.as:307,344,349` | no | |
| `S_assaultFire` (2120) | Assault Rifle / Precision Laser fire | `Stats_Guns.as:382,437` | no | |
| `S_uziFire` (2144) | Uzi fire | `Stats_Guns.as:194` | no | |
| `S_sniperFire` (2142) | .50 Cal Sniper fire | `Stats_Guns.as:467` | no | |
| `S_alienSniper` (2118) | Railgun / Pulsator fire | `Stats_Guns.as:468,469` | no | |
| `S_plasmaFire` (2121) | Burst Torch / Assault Bouncer fire | `Stats_Guns.as:224,463` | no | |
| `S_ripperFire` (2126) | Shredder (saw launcher) fire | `Stats_Guns.as:559` | no | |
| `S_rocketFire` (35) | Rocket Launcher / Ice Hunter / Frozen Death fire | `Stats_Guns.as:599,637,645` | no | |
| `S_laserBig` (2131) | Acid Hound fire, Credit Cannon fire | `Stats_Guns.as:638`, `763` | no | |
| `S_Whip` (41) | Katana swing, Grenade throw (ability animation cue, not the explosion) | `Unit.as:1271,1279` | no | |
| `S_rocketExplode` (2125) | Rocket/grenade/mine/proximity-mine detonation; also tutorial scripted explosions | `Stats_Guns.as` `hitSound` for rocket/hrocket/hrocket2/spitter/grenade/mine → `Bullet.as:479`; `Game.as:547,595` (tutorial), `Menu.as:769` (armory preview) | no | |
| `S_GunClick` (2123) | Dry-fire click (out of ammo) and Credit Cannon fire with insufficient credits | `Guns.as:348,441` | no | |
| `S_reloadPistol` (2127) | Reload — pistol-class guns | `Unit.as:1316` (via `reloadSound()`, keyed on `gun.curGun.frameReload == "pistol"`) | **yes** | |
| `S_reloadRifle` (2119) | Reload — rifle-class guns | `Unit.as:1319` | **yes** | |
| `S_reloadShotgun` (2139) | Reload — shotgun-class guns | `Unit.as:1322` | **yes** | |
| `S_reloadSniper` (2141) | Reload — sniper-class guns | `Unit.as:1325` | **yes** | |
| `S_reloadHeavy` (2122) | Reload — heavy-class guns (Shredder, Acid Hound) | `Unit.as:1328` | **yes** | |
| `S_reloadRocket` (2134) | Reload — rocket-class guns | `Unit.as:1331` | **yes** | |
| `S_Headshot1/2/3` (2128-2130) | Headshot, crotch-shot, or butt-shot kill (random pick via `UT.randEl`); also melee kill | `Unit.as:305,310,315`; `Bullet_Melee_Basic.as:22` | no | Also reused as generic "big impact" stinger in the tutorial (`Game.as:548`). |
| `S_Static` (2143) | "Armor Lock" ability activation; tutorial EMP event | `Unit.as:1187`; `Game.as:549` | no | Also triggers a camera-shake (`arena.setShake`). |
| `S_Heal` (2136) | Heal ability (self); shield/health pickup | `Unit.as:1216`; `NodePickup.as:173,180,187,194` | no | |
| `S_Powerup` (2137) | Cloak ability, Juggernaut crown pickup, teleport-in landing, invincibility/double-damage/rapid-fire pickup, weapon-skin equip preview | `Unit.as:1246,1256(sic-see below),358,383,1300`; `NodePickup.as:201,220,242`; `Menu.as:438,511,541` | no | |
| `S_Equip` (2116) | Ammo-refill ability, weapon pickup, CTF flag pickup, weapon-skin/gun purchase confirm, killed-with-flag reset | `Unit.as:887,1256`; `NodePickup.as:265`; `NodeCtfFlag.as:64`; `Menu.as:437,510,540,1260,1271,1345,1383,1847,1859,1875,2355,2370` | no | |
| `S_Jumppad` (2138) | Jump pad, mega-jump ability, teleport ability (both legs: departure and re-spawn effect share this + `S_Powerup`), CTF flag-capture score | `Movement.as:146`; `Unit.as:1293,1316(teleport out)`; `NodeCtfFlag.as:95` | no | |
| `S_Click` (2117) | Generic UI hover/select click (menu rows, cutscene nav) | `AGI.as:351,359`; `Cutscene.as:64,76`; `Menu.as:569,1240,1683` | no | |
| `S_ClickGo` (2115) | "Forward"/confirm UI click (most buttons: Play, Next, category tabs, in-game restart) | `AGI.as:293,325`; `Hud.as:290`; `Menu.as:749,754,763(sic),781,787,809,814,824,831,843,848,852,856,942,957,962,969,980,1624` | no | |
| `S_ClickBack` (40) | "Back"/cancel UI click | `Menu.as:804,1631` | no | |
| `S_Error` (2124) | Invalid action (insufficient credits, invalid loadout selection) | `Menu.as:517,1276,1281,1388,1852,1869,2376,2381` | no | |
| `S_Medal` (39) | Achievement/medal unlocked | `Stats_Achievements.as:217` | no | |
| `S_CamelJizz` (36) | Title-screen Easter-egg click on the camel | `Intro.as:95` | **yes** | |

Notes on ambiguity: `Menu.as` has many near-duplicate `S_ClickGo` calls across weapon-purchase,
skin-purchase, and mode-select rows — they are all the same "confirm" stinger, just fired from
different UI panels; not itemized individually above.

## 2. Music tracks — id, context, looping

`SH.songList`/`SH.songNames` (`scripts/SH.as:52-53`):

```as
songList  = [M_Rose, M_Rocket, M_Warhead, M_Throwdown, M_Necro, M_Ricochet, M_Theloop, M_Infernal]
songNames = ["Rose at Nightfall","Rocket Race","Warhead","Throwdown","Necromancy",
             "Ricochet Love","The Loop that Wasn't","Infernal Signs"]
```

| Class (file id) | Context | Looping |
|---|---|---|
| `M_Menu` (2114) | Main menu, armory/customize/loadout screens (`Menu.as:111`), and the "no match" fallback state (`NoPlay.as:15`) | loop (music channel always loops until replaced — `SH.as:107-119` fades old track out over ~1s at −0.025/frame @30fps while new track fades in) |
| `M_MenuIntro` (37) | Title/intro screen (`Intro.as:101`) | loop |
| `M_Rose` (29) | In-match rotation; also the tutorial's forced track after the bridge-explosion scripted event, played **muted** (`SH.playMusic(M_Rose, true)` — `param2=true` means "start silent," `Game.as:550`, see `SH.as:96-99`) | loop |
| `M_Rocket` (34) | In-match rotation | loop |
| `M_Warhead` (38) | In-match rotation; forced track for the `Cutscene` when `MatchSettings.postCutSong`/`preCutSong` is `M_Warhead` (`Cutscene.as:39-43`), and forced during specific campaign missions (`Cutscene.as:197`) | loop |
| `M_Throwdown` (33) | In-match rotation | loop |
| `M_Necro` (28) | In-match rotation | loop |
| `M_Ricochet` (30) | In-match rotation; also forced for the Stats_Campaign "final battle" sequence (`Stats_Campaign.as:2264`) | loop |
| `M_Theloop` (32) | In-match rotation | loop |
| `M_Infernal` (31) | In-match rotation | loop |

**Selection logic:**
- Menu/armory screens: fixed `M_Menu` (`Menu.as:111`); reselecting a category or the songbook re-triggers the same call idempotently (`SH.playMusic` no-ops if the requested class already matches `musicClass`, `SH.as:87-88`).
- Title screen: fixed `M_MenuIntro`.
- Quick/skirmish match: `MatchSettings.song` is set by whichever match-setup path built it; the in-HUD song browser can override it live — `Hud.as playSong()` (`Hud.as:205-219`) either advances (`curSongNum++`, wraps at 8) or picks a random index (`UT.irand(0, songList.length-1)`) and calls `SH.playMusic(SH.songList[curSongNum])`.
- Campaign missions: each mission's music is hard-authored via `Stats_Campaign.setStats(..., param7=song, ...)` (`Stats_Campaign.as:2461-2483`). Every mission in the 27-mission campaign (`scripts/Stats_Campaign.as:62-953`) is scored to one of the 8 tracks above — e.g. mission "Breaking In" → `M_Throwdown` (`:63`), "Survivor Lookout" → `M_Necro` (`:121`), "Sweep and Clear" → `M_Warhead` (`:173`), "Cause and Effect" → `M_Infernal` (`:250`), "Retrieval" → `M_Ricochet` (`:262`), "Hold the fort" → `M_Theloop` (`:305`), "My First Mission" → `M_Rocket` (`:316`), "Strange Encounter" → `M_Rose` (`:352`), etc. (full mapping runs through line 927).
- Cutscenes (pre/post mission cinematics): `Stats_Campaign.setCutscene(preSong, preFrames, postSong, postFrames)` assigns `MatchSettings.preCutSong` / `postCutSong` (`Stats_Campaign.as:2429-2435`); `Cutscene` constructor reads `MatchSettings[type + "CutSong"]` and calls `SH.playMusic(song)` if set (`Cutscene.as:38-43`). Most missions pass `null` (silence / keep previous track); a handful force `M_Infernal`, `M_Theloop`, `M_Rose`, `M_Throwdown`, or `M_Warhead` explicitly for dramatic beats (e.g. `:335`, `:444`, `:573`, `:638`, `:893`, `:926`).
- Crossfade: switching tracks fades the old channel from full volume to 0 and the new one from 0 to full, both at ±0.025 volume/frame (`SH.as:107-119`), i.e. a ~1.2s linear crossfade at the game's 30fps tick. Toggling the music option (`SD.music`) drives the same fade rather than an instant cut (`SH.EnterFrame`, `SH.as:112-118`).

## 3. Positional audio model

There is **no true 3D/2D positional audio** (no volume-by-distance falloff, no stereo pan) in
Raze 2's engine. What exists is a **binary screen-visibility gate**:

```as
// scripts/Game.as:301-310
public function playScreenSound(sound:*, x:Number, y:Number, loud:Boolean=false):void {
   if (onScreen(x, y)) {
      SH.playSound(sound, loud);
   }
}
```

`onScreen(x, y, margin=0)` (`Game.as:311-333`) transforms the world coordinate by the arena's
current scroll offset (`arena.x/y`) and tests it against the `Main.WIDTH × Main.HEIGHT` viewport
(with an optional pixel margin, unused — always called with margin 0 from `playScreenSound`).
If the point is off-screen, the sound is **dropped entirely**; if on-screen, it plays at one of
exactly two flat volumes (0.4 normal, 0.7 "loud" — reload sounds and the camel Easter egg pass
`loud=true`). There is no per-quality/graphics-setting gating of audio anywhere in `SH.as`,
`Game.as`, or `Main.as` — the only quality knobs are `SD.sound` (SFX on/off) and `SD.music`
(music on/off), both simple booleans checked at the top of `playSound`/`playMusic`/`EnterFrame`.

Some sounds bypass the screen gate and use plain `SH.playSound` (always audible regardless of
camera position): all UI clicks, all pickups triggered directly on `NodePickup.getPickup`
(healing/shield/powerup pickups call `SH.playSound` directly, not `game.playScreenSound` — compare
`NodePickup.as:173-242` to `NodeCtfFlag.as:64,95` which do use the screen-gated call), the medal
sound, and the tutorial's scripted explosion stinger. This is an existing inconsistency in the
original game, not a doc error.

## 4. Port status — `raze-ts/src/audio/Sounds.ts` and callers

**Architecture divergence (intentional, documented in `Sounds.ts:4-21`):** the port replaced the
binary on/off screen-gate with real distance-falloff + stereo-pan spatialisation
(`SoundManager.spatial()`, `Sounds.ts:270-290`), because the port has a scrolling camera instead
of Raze 2's always-fully-visible arena. `DEFAULT_RANGE = 950`, `GUNSHOT_RANGE = 1600`,
`MECHANICAL_RANGE = 520`, `HEADSHOT_RANGE = 1600` (`Guns.ts:69-78`) roughly stand in for the
"is it worth playing" cutoff that `onScreen()` used to provide. This is a reasonable design
adaptation, not a bug, but it means volume/pan behavior does not literally match the original
(the original never fades volume with distance at all).

**Music — correctly ported (10/10 files, IDs match):**

| Original | Port key | File |
|---|---|---|
| `M_Menu` (2114) | `R2_Menu` | `r2_2114_M_Menu.mp3` |
| `M_MenuIntro` (37) | `R2_MenuIntro` | `r2_37_M_MenuIntro.mp3` |
| `M_Necro` (28) | `R2_Necro` | `r2_28_M_Necro.mp3` |
| `M_Rose` (29) | `R2_Rose` | `r2_29_M_Rose.mp3` |
| `M_Ricochet` (30) | `R2_Ricochet` | `r2_30_M_Ricochet.mp3` |
| `M_Infernal` (31) | `R2_Infernal` | `r2_31_M_Infernal.mp3` |
| `M_Theloop` (32) | `R2_Theloop` | `r2_32_M_Theloop.mp3` |
| `M_Throwdown` (33) | `R2_Throwdown` | `r2_33_M_Throwdown.mp3` |
| `M_Rocket` (34) | `R2_Rocket` | `r2_34_M_Rocket.mp3` |
| `M_Warhead` (38) | `R2_Warhead` | `r2_38_M_Warhead.mp3` |

Wiring: `MenuScreen.ts:112,189` → `R2_Menu`; `TitleScreen.ts:104` → `R2_MenuIntro`;
`GameScreen.ts:398-403` picks `MATCH_MUSIC` (all 8 tracks, `Sounds.ts:84-87`) randomly for
non-campaign matches, or `"R2_" + entry.settings.music.replace(/^M_/, "")` for campaign matches —
this is a faithful re-implementation of `Hud.playSong()`'s random pick and
`Stats_Campaign.setStats(song)`'s per-mission assignment. Crossfade behavior is **not** ported —
`Sounds.ts:318-333` `setMusic()` hard-cuts the old track (`stopMusic()`) rather than the original's
~1.2s linear fade; this is a minor fidelity gap, not a missing feature.

**Missing / not ported:**
- Cutscene pre/post music (`MatchSettings.preCutSong`/`postCutSong`, driven by
  `Stats_Campaign.setCutscene`) — there is no `Cutscene` screen in the port at all (confirmed: no
  file references `Cutscene`, `CutSong`, `preCut`, or `postCut` under `raze-ts/src`), so none of
  the mission-specific cutscene tracks (forced `M_Infernal`/`M_Theloop`/`M_Rose`/`M_Throwdown`
  overrides at dramatic story beats) ever play.
- The HUD's in-match manual song browser (`Hud.playSong()` — "Play Next Song" advance/random
  button) has no port equivalent found in `GameScreen.ts` or `Hud`-related files.

**Sound effects — 0/36 originals ported with matching audio.** `Sounds.ts`'s `MANIFEST`
(`Sounds.ts:24-81`) contains only **Raze 1** sound effects (ids 162-200, 1-2, from the original
Raze), reused wholesale for Raze 2 gameplay. Every Raze-2-specific effect id (2114-2145 range,
plus legacy 35/36/39/40/41) has **no corresponding file** under `public/assets/sounds/` and no
manifest key — only the `r2_*` **music** files were extracted. Concretely:

| Raze 2 original | Port's stand-in (Raze 1 asset, wrong game) | Call site |
|---|---|---|
| `S_pistolFire` | `PistolFire` (`184_S_PistolFire.mp3`) | `Guns.ts:11-15 FIRE_SOUND.pistol` |
| `S_shotgunFire` | `ShotgunFire` (`180_S_ShotgunFire.mp3`) | `FIRE_SOUND.shotgun` |
| `S_assaultFire` | `Arifle2` (`165_S_Arifle2.mp3`) | `FIRE_SOUND.rifle` |
| `S_uziFire` | `Uzi1`/`Uzi2` (`173_`/`174_S_Uzi*.mp3`) | `tryShoot()` — `Guns.ts:225` |
| `S_sniperFire` | `SniperFire` (`164_S_SniperFire.mp3`) | `FIRE_SOUND.sniper` |
| `S_alienSniper` | `Lightning` (`186_S_Lightning.mp3`) | `FIRE_SOUND.railgun` |
| `S_plasmaFire` | `Zapper` (`194_S_Zapper.mp3`) | `FIRE_SOUND.plasma` |
| `S_ripperFire` | `Chainfire` (`183_S_Chainfire.mp3`) | `FIRE_SOUND.chaingun` |
| `S_rocketFire` | `Rocket` (`187_S_Rocket.mp3`) | `FIRE_SOUND.rocket` |
| `S_Whip` (grenade throw) | `Nadeout` (`192_S_Nadeout.mp3`) | `FIRE_SOUND.grenade` |
| `S_rocketExplode` | `rocketexplode` (`171_S_rocketexplode.mp3`) / `explodenade` (`175_`) | `Projectile.ts:322-323` |
| `S_GunClick` | `GunClick` (`162_S_GunClick.mp3`) | `Guns.ts:207`, `Player.ts:87` |
| `S_reloadPistol` etc. (6 variants) | `PistolReload`/`Assault_Clipin`/`RailReload`/`ShotgunPump`/`nadeClipin`/`windup` | `RELOAD_SOUND` map, `Guns.ts:16-20` |
| (no original "reload-end" sound — engine has no second reload stinger) | `Assault_Slide`/`SGClip`/`Pull`/`nadeClipout` | `RELOAD_END_SOUND` map, `Guns.ts:27-31` — **port invention**, not in the original at all |
| `S_Headshot1/2/3` | `Headshot1/2/3` (`177-179_S_Headshot*.mp3`) | `HEADSHOT_SOUNDS`, `Guns.ts:32` |
| `S_Medal` | `Medal` (`163_S_Medal.mp3`) | `Achievements.ts:140`, `Objectives.ts:114` |
| `S_Jumppad`, teleport whoosh | synthesized `"whoosh"` (`playSynth`, `Sounds.ts:413-432`) | `Abilities.ts:144,238`, `Unit.ts:989,1195` |
| landing thump (no Raze-2-original — see below) | synthesized `"land"` | `Unit.ts:1219` |
| `S_Click`/`S_ClickGo`/`S_ClickBack`/`S_Equip`/`S_Error` (5 distinct UI stingers) | single generic `"Beep"` (`172_S_Beep.mp3`, Raze 1 asset) for **every** UI interaction across all menu/screen files | dozens of call sites, e.g. `MenuScreen.ts:182` etc. |
| `S_Heal`, `S_Powerup` (pickup/ability feedback) | not ported — no call sites found for pickup/heal/powerup audio in `NodePickup`-equivalent or `Unit.ts` ability code | — |
| `S_Static` (armor-lock ability) | not ported | — |
| `S_CamelJizz` (title Easter egg) | not applicable — no camel Easter egg feature in the port | — |

**Biggest gaps, summarized:**
1. Every one of the 36 Raze-2-specific sound effects is **missing as an asset** — the port never
   extracted `2114-2145`/`35/36/39/40/41` from `raze-2.swf`'s `sounds/` folder into
   `public/assets/sounds/`, so all weapon fire, reload, headshot, pickup, and UI-click audio in
   the Raze 2 mode is either borrowed from the unrelated Raze 1 game or synthesized from scratch.
2. Distinct UI feedback (`S_Click`, `S_ClickGo`, `S_ClickBack`, `S_Equip`, `S_Error`) is collapsed
   to one generic `"Beep"` — errors, confirms, and back-navigation all sound identical.
3. Ability/pickup sounds (`S_Heal`, `S_Powerup`, `S_Static`, `S_Equip`) have no port implementation
   at all for their trigger contexts (healing, shields, cloak, armor-lock, ammo pickup).
4. Cutscene pre/post music and the HUD's manual song-browser have no port equivalent (the
   `Cutscene` screen itself doesn't exist yet).
5. Music crossfade (~1.2s linear fade in the original) is a hard cut in the port.
