/**
 * Ported from Effect_Lazer.as.
 *
 * Effect_Lazer in the original was the chaingun's tracer: pale blue
 * (#ccddff), line thickness 1..2, alpha 0.3..0.8, drawn through the bullet's
 * trajectory with random jump gaps. It removed itself on the first
 * EnterFrame after construction.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "lazer". The chaingun also fires one tracer per trigger pull (auto
 * fire, fast cadence) so the effect stack builds up a chain.
 */
export {};
