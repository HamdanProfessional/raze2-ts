/**
 * Ported from Effect_Proj_Uzi.as.
 *
 * Effect_Proj_Uzi was the projectile visualisation for the uzi bolts: a
 * small blue (#88ccff) travelling circle that left a fading trail. On
 * impact (or flying past max range) it removed itself and added an
 * "uzi"-tagged wall-effect at the impact point.
 *
 * In the TS port the uzi is fired through game/Projectile.ts (gravity +
 * splash), and `game/effects.ts -> WeaponTracer` with style "uzi"
 * provides the short tail tracer. Wall / unit impact uses
 * GameScreen.addEffect(x, y, "uzi").
 */
export {};
