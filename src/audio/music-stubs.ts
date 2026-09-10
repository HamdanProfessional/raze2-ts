/**
 * Stub modules for the music-track MovieClips that lived in the SWF. The
 * actual audio is extracted and served from `public/assets/sounds/`. The
 * audio system (audio/Sounds.ts) loads them by key; the menu picks
 * "M_Menu" and each match randomly picks from MATCH_MUSIC.
 *
 *   decompiled_swf/scripts/M_Acid.as   → "M_Acid"   (level music)
 *   decompiled_swf/scripts/M_Baby.as   → "M_Baby"   (level music)
 *   decompiled_swf/scripts/M_Boss.as   → "M_Boss"   (boss fight music)
 *   decompiled_swf/scripts/M_Crowd.as  → "M_Crowd"  (level music)
 *   decompiled_swf/scripts/M_Dnb.as    → "M_Dnb"    (level music)
 *   decompiled_swf/scripts/M_Menu.as   → "M_Menu"   (menu loop)
 *   decompiled_swf/scripts/M_Protos.as → "M_Protos" (level music)
 *   decompiled_swf/scripts/M_Rocket.as → "M_Rocket" (level music)
 *
 * Each was an empty MovieClip in the SWF; the audio is decoded by the
 * Web Audio context on first play.
 */
export {};
