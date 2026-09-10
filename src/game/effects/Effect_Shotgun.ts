/**
 * Ported from Effect_Shotgun.as.
 *
 * Effect_Shotgun in the original was an orange/red tracer (#ff5060 normally,
 * or #ff8030 when SD.noGlow was true) with random thickness 0..2 and a
 * red/orange GlowFilter (blur 10, strength 1). The line was drawn through
 * the trajectory points with random jump gaps — appropriate for the
 * shotgun's 5-pellet spread (each pellet carried a short history).
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "shotgun" (red-orange core + orange glow, life 5 ticks). The 5
 * pellets each draw their own short tracer.
 */
export {};
