/**
 * Stub modules for the visual-asset MovieClips that lived in the SWF but have
 * no logic in the TypeScript port — they were frame-script-only shells whose
 * art is now served as PNGs/JPGs by the asset pipeline (Anim/ArmArt/Parts/
 * Backgrounds/UiArt) and drawn by Pixi where needed.
 *
 * The original files (Background, Electricity, Logo_Armor, Logo_Juice,
 * ScoreBoard_Row) corresponded to the following textures / live equivalents:
 *
 *   decompiled_swf/scripts/Background.as   → full-frame arena backdrop;
 *                                             replaced by Backgrounds.getTexture(level)
 *                                             (game/Arena.ts).
 *   decompiled_swf/scripts/Electricity.as  → the sparking electricity effect
 *                                             overlaid on zombified/robotic
 *                                             characters in ProfileUnit. No
 *                                             behavioural port — the visual is
 *                                             baked into the character costume.
 *   decompiled_swf/scripts/Logo_Armor.as    → the Armor Games splash screen. Not
 *                                             ported; boot goes straight from the
 *                                             loader to the menu.
 *   decompiled_swf/scripts/Logo_Juice.as    → the Juice-Tin / original-game
 *                                             splash screen. Replaced by the
 *                                             credits panel inside MenuScreen.
 *   decompiled_swf/scripts/ScoreBoard_Row.as → a single row of the post-game
 *                                             scoreboard. The current HUD
 *                                             scoreboard lives in game/Hud.ts
 *                                             (top-left 1st/2nd box).
 *
 * None of these carried any logic beyond an init frame-script in the original,
 * so the TypeScript port exposes no functional replacement.
 */
export {};
