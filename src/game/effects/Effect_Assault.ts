/**
 * Ported from Effect_Assault.as.
 *
 * Effect_Assault in the original was a magenta tracer (#fe2fab) with a soft
 * magenta GlowFilter (blur 10, strength 1). The line was drawn through the
 * trajectory points with random thickness 0..2 and alpha 0.3..0.8. When
 * SD.noGlow was true the GlowFilter was skipped.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "assault" (magenta core + magenta glow, life 4 ticks). Used by
 * the rifle. The GlowFilter becomes a wider, low-alpha stroke drawn behind
 * the core line (Pixi v8 doesn't ship GlowFilter).
 */
export {};
