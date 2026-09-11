/**
 * Graphics quality + glow settings, derived from the persisted `SD.qual` /
 * `SD.noGlow` fields.
 *
 * The original Flash build exposed a 4-step quality selector that mapped onto
 * `stage.quality` ("low" / "medium" / "high" / "best") plus a separate
 * "no glow" switch that skipped the GlowFilter on effects and UI chrome. Both
 * values were saved in the SharedObject but the TS port never surfaced them.
 *
 * This module is the single place that turns those two saved values into the
 * concrete knobs the renderer reads:
 *
 *   - `particleScale`  multiplier on every particle burst spawned by Fx.ts
 *   - `detail`         whether decorative sub-draws (spark fans, shockwave
 *                      rings, beam cores) are drawn at all
 *   - `maxFx`          cap on concurrent effect objects. Each live effect is
 *                      its own Graphics, so this is effectively a draw-call
 *                      budget: the oldest effect is retired when the cap is hit
 *   - `glow`           bright additive-looking flashes, tracer glow layers and
 *                      text drop-shadows
 *   - `ragev`          whether a corpse evaporates into embers (PhysVap) at the
 *                      end of its four seconds, or just vanishes
 *   - `maxFps`         render frame-rate cap (game logic always ticks at 30)
 *   - `stageQuality`   legacy value poked into `main._stage.quality`
 *
 * Deliberately has NO import of SD: SD pushes into `Quality.set()` after every
 * load / change, which keeps the dependency one-way and avoids a cycle.
 */

export type QualityLevel = "low" | "medium" | "high" | "max";

/** Selector order, low -> high. Index doubles as the saved `SD.menuQual`. */
export const QUALITY_LEVELS: QualityLevel[] = ["low", "medium", "high", "max"];

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export interface QualityProfile {
  /** Multiplier applied to particle counts (rounded, always >= 1 particle). */
  particleScale: number;
  /** Draw decorative extras: spark fans, shockwave rings, lightning arcs. */
  detail: boolean;
  /** Max simultaneous effect objects (== max effect draw calls). */
  maxFx: number;
  /** Frames a bullet tracer lingers for. */
  tracerLife: number;
  /** Renderer FPS cap; 0 means uncapped (logic is always a fixed 30/s). */
  maxFps: number;
  /** Value pushed to the legacy `main._stage.quality` slot. */
  stageQuality: string;
}

const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    particleScale: 0.35,
    detail: false,
    maxFx: 12,
    tracerLife: 3,
    maxFps: 30,
    stageQuality: "low",
  },
  medium: {
    particleScale: 0.6,
    detail: true,
    maxFx: 24,
    tracerLife: 4,
    maxFps: 45,
    stageQuality: "medium",
  },
  high: {
    particleScale: 1,
    detail: true,
    maxFx: 40,
    tracerLife: 5,
    maxFps: 60,
    stageQuality: "high",
  },
  max: {
    particleScale: 1.4,
    detail: true,
    maxFx: 80,
    tracerLife: 6,
    maxFps: 0,
    stageQuality: "best",
  },
};

/** Coerce anything (old saves, hand-edited storage) to a valid level. */
export function normalizeQuality(v: unknown): QualityLevel {
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if ((QUALITY_LEVELS as string[]).includes(s)) return s as QualityLevel;
    // Flash's stage.quality used "best" for the top step.
    if (s === "best") return "max";
    if (s === "med") return "medium";
  }
  if (typeof v === "number" && v >= 0 && v < QUALITY_LEVELS.length) {
    return QUALITY_LEVELS[v | 0];
  }
  return "high";
}

type Listener = () => void;

class QualityState {
  level: QualityLevel = "high";
  /** False when the player asked for no glow (or on the Low profile). */
  glow = true;
  /**
   * "Ragdoll evaporating" — whether a corpse comes apart into a rising ember
   * cloud (PhysVap) or is simply removed. Independent of the quality level in
   * the original: the presets set it, but the toggle overrides them.
   */
  ragev = true;
  /**
   * "Particles", 0..3 (Low/Medium/High/Ultra) — `SD.graphPart`. The per-map
   * ambient emitters in `Stats_MapParticles` read this number directly: it is
   * the literal loop bound for the waterfalls, the modulus for the leaf and
   * snowfall rates, and the gate that switches the rising motes off at 0. It is
   * NOT `particleScale`, which is the port's own multiplier on effect bursts.
   */
  graphPart = 2;

  particleScale = PROFILES.high.particleScale;
  detail = PROFILES.high.detail;
  maxFx = PROFILES.high.maxFx;
  tracerLife = PROFILES.high.tracerLife;
  maxFps = PROFILES.high.maxFps;
  stageQuality = PROFILES.high.stageQuality;

  private listeners: Listener[] = [];

  /** Zero-based index into QUALITY_LEVELS (mirrors SD.menuQual). */
  get index(): number {
    return QUALITY_LEVELS.indexOf(this.level);
  }

  get label(): string {
    return QUALITY_LABELS[this.level];
  }

  /** Visual indicator for the options panel, e.g. "***-" at High. */
  stars(filled = "*", empty = "-"): string {
    const n = this.index + 1;
    return filled.repeat(n) + empty.repeat(QUALITY_LEVELS.length - n);
  }

  /** The level one step up the ladder, wrapping back to Low after Max. */
  nextLevel(): QualityLevel {
    return QUALITY_LEVELS[(this.index + 1) % QUALITY_LEVELS.length];
  }

  /**
   * Recompute every derived knob. Called by SD after load / newGame / any
   * settings change; notifies subscribers so live screens re-apply.
   */
  set(level: QualityLevel, noGlow: boolean, ragev = true, graphPart = 2): void {
    this.level = level;
    this.ragev = ragev;
    this.graphPart = Math.max(0, Math.min(3, graphPart | 0));
    const p = PROFILES[level];
    this.particleScale = p.particleScale;
    this.detail = p.detail;
    this.maxFx = p.maxFx;
    this.tracerLife = p.tracerLife;
    this.maxFps = p.maxFps;
    this.stageQuality = p.stageQuality;
    // Low never glows regardless of the toggle — it is the "make it cheap" step.
    this.glow = !noGlow && level !== "low";
    for (const l of this.listeners.slice()) l();
  }

  /** Subscribe to quality changes. Returns an unsubscribe function. */
  onChange(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Scale a particle count by the current profile (never below 1). */
  count(n: number): number {
    return Math.max(1, Math.round(n * this.particleScale));
  }
}

export const Quality = new QualityState();
