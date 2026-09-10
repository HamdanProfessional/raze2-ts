/**
 * Ported from Effect.as.
 *
 * Effect in the original was the MovieClip base class for the 11 per-weapon
 * tracer / impact effects (Effect_Bullet, Effect_Assault, …). It was
 * instantiated with (game, x, y, type), then `gotoAndStop(type)` to pick a
 * frame label like "blood" / "spawn" / "getShield". A random rotation was
 * applied at construction; certain frame scripts called
 * `rotation = 0` to "reset" the sprite mid-animation. removeEffect() asked
 * the owning Game screen to drop it from its display list.
 *
 * In the TS port this class doesn't exist — short-lived weapon visuals are
 * handled inline:
 *   - bullet/beam tracers  -> game/effects.ts -> WeaponTracer
 *   - impact rings         -> game/effects.ts -> ImpactRing
 *   - blood splatter ring  -> GameScreen.addEffect(x, y, "blood")
 *   - "spawn" / "getShield" / power-up rings -> GameScreen.addEffect
 *
 * The muzzle-end of a shot is handled separately, driven from Guns.fire()
 * off the per-weapon fields in weapons.ts rather than off an Effect frame
 * label:
 *   - muzzle flash    -> GameScreen.addMuzzleFlash (weapon `muzzleColor` /
 *                        `muzzleSize`, positioned `muzzleLen` down the barrel)
 *   - barrel smoke    -> GameScreen.addSmoke (weapon `smoke` budget)
 *   - shell casings   -> GameScreen.addShell (weapon `shell`)
 * Impact colour is likewise per-weapon: Guns passes `sparkColor` into
 * GameScreen.addEffect, so a rail hit sparks cyan, plasma purple, a rocket
 * orange and plain bullets yellow.
 */
export {};
