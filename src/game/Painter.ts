/**
 * Raze 2 has no wall-painting pass.
 *
 * This file previously described porting a `Painter` that accumulated ragdoll
 * limbs and blood splatter into a persistent `BitmapData` — that is Raze 1
 * machinery and does not exist in the Raze 2 scripts (there is no `Painter` or
 * `Splat` class anywhere in `decompiled_swf/raze 2/scripts`). Raze 2's
 * `BitScreen` blits effects into a single bitmap that is cleared every frame
 * (`BitScreen.EnterFrame`, BitScreen.as:29-32), so blood and debris vanish with
 * their effect and never stick to the level.
 *
 * The port matches that: the death ragdoll and dropped weapon are physics
 * objects that settle and evaporate, and the splatter is the baked `blood*`
 * effect from `Fx.ts` playing out its clip. Nothing to persist.
 */
export {};
