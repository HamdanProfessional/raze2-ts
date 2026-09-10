import { Graphics } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { Quality } from "../state/Quality";

/**
 * Per-map-theme ambient particle systems for the Raze 2 maps.
 *
 * A lightweight stand-in for the authentic `Stats_MapParticles` per-theme
 * ambient loops (doc 12 §5): floating dust motes (jungle/mines/city/tutq),
 * rising embers (desert/space), falling snow (snow) and rising bubbles (ocean).
 *
 * Everything is drawn into a single `Graphics` that is cleared and repainted
 * each frame, so the whole system is one display object regardless of the live
 * particle count. Density scales with the graphics-quality particle setting
 * (`Quality.particleScale`), and particles only ever live inside the camera's
 * visible world rect (plus a margin), so we never pay for motes off-screen.
 */

export type ParticleTheme = "dust" | "ember" | "snow" | "bubble" | "none";

/** Map a level id (`r2_<theme>[2]`) onto its ambient particle theme. */
export function themeForMap(level: string): ParticleTheme {
  const t = level.replace(/^r2_/, "").replace(/2$/, "");
  switch (t) {
    case "jungle":
    case "mines":
    case "city":
    case "tutq":
      return "dust";
    case "desert":
    case "space":
      return "ember";
    case "snow":
      return "snow";
    case "ocean":
      return "bubble";
    default:
      return "dust";
  }
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 0..1 phase used for sw/flicker, advanced each frame. */
  phase: number;
  /** per-particle drift frequency. */
  freq: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class AmbientParticles {
  readonly view = new Graphics();
  private ps: Particle[] = [];
  private t = 0;

  /** Base particle count per theme at full quality (scaled by particleScale). */
  private static readonly DENSITY: Record<ParticleTheme, number> = {
    dust: 34,
    ember: 26,
    snow: 72,
    bubble: 26,
    none: 0,
  };

  constructor(
    private readonly theme: ParticleTheme,
    private readonly worldW: number,
    private readonly worldH: number,
  ) {}

  private target(): number {
    const base = AmbientParticles.DENSITY[this.theme];
    if (base === 0) return 0;
    return Quality.count(base);
  }

  /** Spawn a fresh particle somewhere inside the visible rect. `edge` biases
   *  the spawn to the incoming side for directional themes so the flow is
   *  continuous rather than popping in mid-air. */
  private spawn(vx0: number, vy0: number, vw: number, vh: number, edge: boolean): Particle {
    let x = rand(vx0, vx0 + vw);
    let y = rand(vy0, vy0 + vh);
    if (edge) {
      if (this.theme === "snow") y = vy0 - 4; // snow enters from the top
      else if (this.theme === "ember" || this.theme === "bubble") y = vy0 + vh + 4; // rise from below
    }
    switch (this.theme) {
      case "snow":
        return { x, y, vx: rand(-0.4, 0.4), vy: rand(0.7, 1.8), r: rand(1.3, 3), phase: Math.random(), freq: rand(0.02, 0.06) };
      case "ember":
        return { x, y, vx: rand(-0.3, 0.3), vy: rand(-1.3, -0.4), r: rand(0.8, 1.8), phase: Math.random(), freq: rand(0.08, 0.2) };
      case "bubble":
        return { x, y, vx: rand(-0.25, 0.25), vy: rand(-1.4, -0.5), r: rand(1.4, 3.2), phase: Math.random(), freq: rand(0.05, 0.12) };
      case "dust":
      default:
        return { x, y, vx: rand(-0.35, 0.35), vy: rand(-0.25, 0.15), r: rand(1, 2.2), phase: Math.random(), freq: rand(0.02, 0.05) };
    }
  }

  /**
   * Advance and repaint. `camX`/`camY` are the arena view's screen translation
   * (`Arena.x`/`.y`), `zoom` the camera zoom, so we can resolve the visible
   * world rect and keep particles clustered around what the player sees.
   */
  update(camX: number, camY: number, zoom: number): void {
    const g = this.view;
    const target = this.target();
    if (target === 0) {
      if (this.ps.length) this.ps.length = 0;
      g.clear();
      return;
    }
    this.t++;

    const margin = 70;
    const vw = GAME_WIDTH / zoom;
    const vh = GAME_HEIGHT / zoom;
    const vx0 = -camX / zoom - margin;
    const vy0 = -camY / zoom - margin;
    const rw = vw + margin * 2;
    const rh = vh + margin * 2;

    while (this.ps.length < target) this.ps.push(this.spawn(vx0, vy0, rw, rh, false));
    if (this.ps.length > target) this.ps.length = target;

    g.clear();
    for (const p of this.ps) {
      p.phase += p.freq;
      // Gentle lateral sway on top of the base velocity.
      const sway = Math.sin(p.phase) * (this.theme === "snow" ? 0.6 : 0.3);
      p.x += p.vx + sway;
      p.y += p.vy;

      // Recycle when it leaves the (extended) visible rect.
      if (p.x < vx0 - 8 || p.x > vx0 + rw + 8 || p.y < vy0 - 8 || p.y > vy0 + rh + 8) {
        Object.assign(p, this.spawn(vx0, vy0, rw, rh, true));
      }

      let color = 0xffffff;
      let alpha = 0.5;
      switch (this.theme) {
        case "snow":
          color = 0xffffff;
          alpha = 0.65;
          break;
        case "ember":
          color = 0xffb347;
          alpha = 0.35 + 0.35 * Math.max(0, Math.sin(p.phase * 3)); // flicker
          break;
        case "bubble":
          color = 0x9fd8ff;
          alpha = 0.35;
          break;
        case "dust":
        default:
          color = 0xf3ecc8;
          alpha = 0.3 + 0.12 * Math.sin(p.phase);
          break;
      }
      g.circle(p.x, p.y, p.r).fill({ color, alpha });
      if (this.theme === "bubble") {
        // A faint rim so bubbles read as bubbles, not dots.
        g.circle(p.x, p.y, p.r).stroke({ color: 0xdff3ff, width: 0.6, alpha: 0.4 });
      }
    }
  }

  destroy(): void {
    this.ps.length = 0;
    this.view.destroy();
  }
}
