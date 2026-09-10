/**
 * Ported from Loader.as.
 *
 * Loader in the original was the SWF "loading…" MovieClip with a progress bar
 * (loadbar.bar scaled by bytesLoaded / bytesTotal) and a small set of rotating
 * tips ("Overpopulation", "Distant Travels", …) populated by getNewText().
 * Clicking bt_start advanced to Logo_Armor.
 *
 * In the TS port the equivalent screen is `screens/LoaderScreen.ts`, which
 * decodes audio and preloads art (Anim, ArmArt, Parts, Backgrounds, UiArt) and
 * then advances straight to `screens/MenuScreen.ts`; the splash screens the
 * original sat in between were dropped. The rotating tips and progress bar
 * share the same look as the original.
 */
export {};
