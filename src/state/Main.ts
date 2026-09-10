/**
 * Ported from Main.as.
 *
 * Main in the original Flash SWF was the application root MovieClip: it owned
 * the stage, ran the ENTER_FRAME loop, swapped screens (Logo_Armor, Loader,
 * Menu, Game) via newCurClass(), kept the Achievements overlay on top, and
 * hosted the SWF context-menu (Juice-Tin / AddisonR / Armorgames).
 *
 * In the TS port those responsibilities are split across:
 *   - main.ts        : boot, SD.init(), Engine.create(), LoaderScreen.
 *   - core/Engine.ts : fixed-timestep ticker + Screen swap.
 *   - screens/*      : individual screens.
 *   - state/SD.ts    : global game state.
 * The context menu was not preserved — there is no equivalent browser UI for
 * it, and the credits panel on the menu screen carries the authorship instead.
 */
export {};
