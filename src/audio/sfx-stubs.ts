/**
 * Stub modules for the weapon/feedback SFX MovieClips that lived in the SWF.
 * The actual audio is extracted from the SWF and served from
 * `public/assets/sounds/`; the audio system (audio/Sounds.ts) loads them by
 * key. This module maps each AS file to its logical key:
 *
 *   decompiled_swf/scripts/Assault_Clipin.as  → "Assault_Clipin"   (rifle reload)
 *   decompiled_swf/scripts/Assault_Clipout.as → "Assault_Clipout"  (rifle empty)
 *   decompiled_swf/scripts/Assault_Slide.as   → "Assault_Slide"    (rifle cock)
 *   decompiled_swf/scripts/SGClip.as          → "SGClip"           (shotgun shell)
 *   decompiled_swf/scripts/S_Arifle2.as       → "Arifle2"          (rifle fire)
 *   decompiled_swf/scripts/S_Beep.as          → "Beep"             (UI click)
 *   decompiled_swf/scripts/S_BossFire.as      → "BossFire"         (boss weapon)
 *   decompiled_swf/scripts/S_Chainfire.as     → "Chainfire"        (chaingun)
 *   decompiled_swf/scripts/S_explodenade.as   → "explodenade"      (grenade boom)
 *   decompiled_swf/scripts/S_GunClick.as      → "GunClick"         (empty mag)
 *   decompiled_swf/scripts/S_Headshot1.as     → "Headshot1"        (kill feed)
 *   decompiled_swf/scripts/S_Headshot2.as     → "Headshot2"        (kill feed)
 *   decompiled_swf/scripts/S_Headshot3.as     → "Headshot3"        (kill feed)
 *   decompiled_swf/scripts/S_Lightning.as     → "Lightning"        (railgun fire)
 *   decompiled_swf/scripts/S_Medal.as         → "Medal"            (achievement)
 *   decompiled_swf/scripts/S_nadeClipin.as    → "nadeClipin"       (grenade reload)
 *   decompiled_swf/scripts/S_nadeClipout.as   → "nadeClipout"      (grenade empty)
 *   decompiled_swf/scripts/S_Nadeout.as       → "Nadeout"          (grenade fire)
 *   decompiled_swf/scripts/S_PistolFire.as    → "PistolFire"
 *   decompiled_swf/scripts/S_PistolReload.as  → "PistolReload"
 *   decompiled_swf/scripts/S_Pull.as          → "Pull"             (sniper bolt)
 *   decompiled_swf/scripts/S_RailReload.as    → "RailReload"
 *   decompiled_swf/scripts/S_Rocket.as        → "Rocket"
 *   decompiled_swf/scripts/S_rocketexplode.as → "rocketexplode"
 *   decompiled_swf/scripts/S_ShotgunFire.as   → "ShotgunFire"
 *   decompiled_swf/scripts/S_ShotgunPump.as   → "ShotgunPump"
 *   decompiled_swf/scripts/S_ShotgunShell.as  → "ShotgunShell"
 *   decompiled_swf/scripts/S_SniperFire.as    → "SniperFire"
 *   decompiled_swf/scripts/S_Uzi1.as          → "Uzi1"             (uzibolt 1)
 *   decompiled_swf/scripts/S_Uzi2.as          → "Uzi2"             (uzibolt 2)
 *   decompiled_swf/scripts/S_winddown.as      → "winddown"         (chaingun wind-down)
 *   decompiled_swf/scripts/S_windup.as        → "windup"           (chaingun wind-up)
 *   decompiled_swf/scripts/S_Zapper.as        → "Zapper"           (plasma fire)
 *
 * The MANIFEST in audio/Sounds.ts is the single source of truth for key→file
 * mappings. These AS files were empty MovieClip shells (init frame-script
 * only) and have no functional counterpart in the TS port.
 */
export {};
