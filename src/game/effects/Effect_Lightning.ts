/**
 * Ported from Effect_Lightning.as.
 *
 * Effect_Lightning was the railgun tracer: white (#ffffff) with a tight
 * white GlowFilter, drawn as a thin beam from muzzle to the impacted
 * unit. It also emitted a low-pitched "Lightning" sound and pierced all
 * units along the path.
 *
 * In the TS port the railgun's piercing hitscan lives in Guns.fireHitscan
 * with `piercing: true`; the visible beam is game/effects.ts ->
 * WeaponTracer with style "plasma" (closest visual — a wide glow over
 * a bright core). The lightning sound ("Lightning") is in
 * audio/Sounds.ts MANIFEST.
 */
export {};
