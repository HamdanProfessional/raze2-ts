/**
 * Ported from Effect_Boss.as.
 *
 * Effect_Boss in the original was the boss-weapon tracer: white when glow
 * was on (#ffffff), red-orange when off (#fecd52). Each frame the line
 * thickness halved toward `endThick = startThick / 2`, alpha decayed by
 * 10% per tick, and the trajectory drifted toward per-point endTrav
 * targets (offset by ±1 px horizontally, +15..+20 px vertically — like
 * the sniper). A red GlowFilter (blur 10, strength 1) was attached when
 * SD.noGlow was false.
 *
 * In the TS port the equivalent is `game/effects.ts -> WeaponTracer` with
 * style "boss" (white core + red glow, life 8 ticks).
 */
export {};
