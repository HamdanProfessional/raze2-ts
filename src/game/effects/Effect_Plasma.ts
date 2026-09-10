/**
 * Ported from Effect_Plasma.as.
 *
 * Effect_Plasma in the original was a two-layer tracer: an outer salmon
 * line (#d68264, or #c88aff when noGlow) and an inner blue line (#4950a7
 * or #864f9f when noGlow), each with random thickness 1..3 and alpha
 * 0.3..0.8. Each layer drifted toward its own per-point endTrav target
 * (with horizontal/vertical jitter proportional to its index along the
 * path) and decayed independently. After the alpha dropped below 0.05
 * the effect removed itself.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "plasma" (salmon core + indigo glow). The dual-layer drift is
 * approximated by a single tracer with a wide glow stroke.
 */
export {};
