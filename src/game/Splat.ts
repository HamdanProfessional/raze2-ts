/**
 * Ported from Splat.as.
 *
 * Splat in the original was the random-frame blood splatter MovieClip that
 * the Painter drew into its BitmapData on every frame-script checkpoint.
 * Each frame picked a random sub-frame of the splatter (so the streak looked
 * chunky + random) and then called painter.drawMe(this) which painted
 * itself with its affine Matrix.
 *
 * In the TS port splatter is rendered as a short-lived Graphics ring in
 * GameScreen.addEffect(x, y, "blood" / "bloodBig"). The expanding-circle
 * ring with a fading red stroke matches the original's visual feel without
 * needing persistent bitmap state.
 */
export {};
