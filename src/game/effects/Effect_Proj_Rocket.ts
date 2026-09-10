/**
 * Ported from Effect_Proj_Rocket.as.
 *
 * Effect_Proj_Rocket was the rocket projectile: an orange (#ffaa33) circle
 * trailing a red glow, exploding on contact (rocketExplode sound +
 * rocketExplode wall-effect). Splash damage was applied to every unit in
 * a 90 px radius with falloff.
 *
 * In the TS port the rocket is fired through game/Projectile.ts with id
 * "rocket"; game/effects.ts -> WeaponTracer style "rocket" provides the
 * short tail. The splash logic is in Projectile.explode().
 */
export {};
