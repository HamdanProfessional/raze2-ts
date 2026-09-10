/**
 * Ported from BigText.as.
 *
 * BigText in the original was the giant centred banner ("Get Ready", "Victory!",
 * "Defeat", "Paused") MovieClip with two text fields (textBox + textBox2 for
 * a double-stroke effect). doText("pause", "PAUSED") would jump to the named
 * frame and rewrite both text fields. The visible effect was a fade/scale-in.
 *
 * The TS equivalent is the simpler setBanner(text) call on the HUD
 * (game/Hud.ts), which writes a single styled Text element. That covers every
 * banner the game shows (intro countdown, pause, victory, defeat, debug). If
 * the double-stroke effect is wanted later, layer two Text elements here.
 */
export {};
