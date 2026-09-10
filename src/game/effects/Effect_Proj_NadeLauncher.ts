/**
 * Ported from Effect_Proj_NadeLauncher.as.
 *
 * Effect_Proj_NadeLauncher was the grenade projectile: a green (#88dd66)
 * circle trailing a darker green glow, exploding on contact or after
 * `maxRange` ticks (explodenade sound + grenadeExplode wall-effect). The
 * grenade stuck to whichever surface or unit it hit for a moment before
 * detonating, which let skilled players "return to sender" — the medal.
 *
 * In the TS port the grenade is fired through game/Projectile.ts with id
 * "grenade"; game/effects.ts -> WeaponTracer style "grenade" provides the
 * short tail. The splash logic is in Projectile.explode(). The "stuck"
 * behaviour isn't reproduced — direct impact explodes immediately.
 */
export {};
