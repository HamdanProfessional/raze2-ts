/**
 * Ported from Effect_Sniper.as.
 *
 * Effect_Sniper in the original was a white tracer (#ffffff) with a tight
 * white GlowFilter. Each tick it drifted slightly toward a per-point
 * "endTrav" target (offset by ±1 px horizontally, +15..+20 px vertically)
 * — giving the visible tracer a slow downward-sag effect as if the bullet
 * was being pulled by gravity over its travel. The line thickness started
 * at 1..3 and halved each tick; alpha decayed by 3% per tick until it
 * dropped below 0.05, at which point the effect removed itself.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "sniper" (white core + white glow, life 6 ticks). The downward
 * drift isn't reproduced; the per-frame decay is.
 */
export {};
