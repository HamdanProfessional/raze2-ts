/**
 * Ported from Effect_Bullet.as.
 *
 * Effect_Bullet in the original was a yellow tracer (#fff266) drawn with
 * random line thickness 0..2 and alpha 0.3..0.8 through the bullet's
 * trajectory points (a jagged line that looked like multiple stuttering
 * tracers). It removed itself on the first EnterFrame after construction.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "bullet" (yellow, 1px, life 4 ticks). Used by the pistol and any
 * hitscan ray that doesn't get a more specific style.
 */
export {};
