import { Container, Graphics } from "pixi.js";

/**
 * The water surface, ported from `Water.as`.
 *
 * It is a spring-mass line, not a texture: one dot every 20px along the top of
 * each pool, each pulled back toward its rest height and coupled to its two
 * neighbours, so a disturbance anywhere spreads outward and rebounds off the
 * banks. Units walking, landing and jumping through it kick individual dots
 * (`startWaveAtPos`), and an idle pulse from both ends and the middle every 20
 * frames keeps it alive when nobody is in it.
 *
 * The whole thing draws as one `hard-light` shape — a stroked, smoothed curve
 * across the dots closed down to the bottom of the pool — which is what makes
 * it read as water over the map art rather than as a blue rectangle.
 */

/** Physics constants, all verbatim from `Water.EnterFrame`. */
const SPACING = 20;      // px between dots
const MASS = 10;
const SPRING = 5;        // rest-pull divisor: the restoring term is SPREAD/SPRING
const DAMP = 1.05;       // velocity is divided by this every frame
const SPREAD = 0.7;      // neighbour coupling
/** Frames between the idle pulses that keep an untouched pool moving. */
const IDLE_PERIOD = 20;

const LINE_COLOR = 0x66ccff;
const LINE_ALPHA = 0.7;
const FILL_ALPHA = 0.5;

interface Dot {
  x: number;
  /** Rest height. */
  oy: number;
  y: number;
  toY: number;
  yVel: number;
}

/** One pool: a rectangle whose top edge is the simulated surface. */
export interface WaterBody {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pool extends WaterBody {
  dots: Dot[];
}

/** What the simulation needs to know about a unit standing in it. */
export interface WaterUnit {
  x: number;
  y: number;
  status?: { dead?: boolean };
  jumping?: { vel: number } | null;
  moving?: { vel: number };
  crouching?: boolean;
}

export class Water {
  readonly view = new Container();
  private pools: Pool[] = [];
  private g = new Graphics();
  private fc = 0;

  constructor(bodies: WaterBody[]) {
    // `hardlight` in the original: the surface tints what is behind it rather
    // than covering it, so the map art still reads through the pool.
    this.g.blendMode = "hard-light";
    this.view.addChild(this.g);
    for (const b of bodies) {
      const dots: Dot[] = [];
      const n = Math.max(2, Math.floor(b.w / SPACING));
      for (let i = 0; i < n; i++) {
        const x = b.x + i * SPACING;
        dots.push({ x, oy: b.y, y: b.y, toY: b.y, yVel: 0 });
      }
      this.pools.push({ ...b, dots });
    }
  }

  get empty(): boolean {
    return this.pools.length === 0;
  }

  /** Is this point inside any pool? (`Water.inWater`, an inclusive box test.) */
  inWater(x: number, y: number): boolean {
    for (const p of this.pools) {
      if (x > p.x && x < p.x + p.w && y > p.y && y < p.y + p.h) return true;
    }
    return false;
  }

  /** Kick the dot nearest `x` with vertical velocity `vel` (down is positive). */
  startWaveAtPos(x: number, vel: number): void {
    for (const p of this.pools) {
      if (x < p.x || x > p.x + p.w) continue;
      this.kick(p, Math.round((x - p.x) / SPACING), vel);
      return;
    }
  }

  private kick(p: Pool, i: number, vel: number): void {
    if (i < 0 || i >= p.dots.length) return;
    p.dots[i].yVel = vel;
  }

  enterFrame(units: WaterUnit[]): void {
    if (!this.pools.length) return;
    this.fc++;

    for (const p of this.pools) {
      // Idle pulse: both banks and the middle, every 20 frames.
      if (this.fc % IDLE_PERIOD === 0) {
        this.kick(p, 0, 2);
        this.kick(p, p.dots.length - 1, 2);
        this.kick(p, Math.floor(p.dots.length / 2), 1);
      }

      for (const u of units) {
        if (u.status?.dead) continue;
        if (!(u.x > p.x && u.x < p.x + p.w && u.y > p.y && u.y < p.y + p.h)) continue;
        const i = Math.round((u.x - p.x) / SPACING);
        const vy = u.jumping?.vel ?? 0;
        const vx = u.moving?.vel ?? 0;
        if (u.jumping && vy > 0) {
          // Falling in — one big downward splash where they land.
          this.kick(p, i, 4);
        } else if (u.jumping && vy < 0) {
          // Launching out — the surface is dragged up behind them.
          this.kick(p, i, -5);
        } else if (vx < 0) {
          // Wading left: a bow wave ahead, a trough behind.
          this.kick(p, i - 1, 2);
          this.kick(p, i - 3, -2);
          this.kick(p, i + 1, -1);
        } else if (vx <= 0) {
          // Standing still barely ripples; crouching dips the surface.
          if (u.crouching) this.kick(p, i, 0.5);
        } else {
          this.kick(p, i + 1, 2);
          this.kick(p, i + 3, -2);
          this.kick(p, i - 1, -1);
        }
      }

      // Integrate. Each dot is pulled toward its rest height and toward both
      // neighbours; `toY` accumulates so no dot sees a half-updated neighbour.
      const d = p.dots;
      for (let i = 0; i < d.length; i++) {
        let force = 0;
        if (i > 0) force += (d[i - 1].y - d[i].y) * -SPREAD;
        if (i < d.length - 1) force += (d[i].y - d[i + 1].y) * SPREAD;
        force += (SPREAD / SPRING) * (d[i].y - d[i].oy);
        d[i].yVel += -force / MASS;
        d[i].toY += d[i].yVel;
        d[i].yVel /= DAMP;
      }
      for (const dot of d) dot.y = dot.toY;
    }

    this.draw();
  }

  /**
   * One closed shape per pool: a smoothed curve across the dots, then down the
   * far bank, along the bottom and back up. `curveTo` through the midpoints is
   * the original's smoothing — it keeps the crest of a wave rounded instead of
   * showing the 20px facets.
   */
  private draw(): void {
    const g = this.g;
    g.clear();
    for (const p of this.pools) {
      const d = p.dots;
      if (d.length < 2) continue;
      g.moveTo(d[0].x, d[0].y);
      for (let i = 1; i < d.length; i++) {
        if (i === 1) {
          g.lineTo((d[0].x + d[1].x) / 2, (d[0].y + d[1].y) / 2);
        } else if (i < d.length - 1) {
          g.quadraticCurveTo(
            d[i - 1].x, d[i - 1].y,
            (d[i - 1].x + d[i].x) / 2, (d[i - 1].y + d[i].y) / 2,
          );
        }
      }
      g.lineTo(d[d.length - 1].x, d[d.length - 1].y);
      g.lineTo(p.x + p.w, p.y + p.h);
      g.lineTo(p.x, p.y + p.h);
      g.lineTo(d[0].x, d[0].y);
      g.fill({ color: LINE_COLOR, alpha: FILL_ALPHA });
      g.stroke({ width: 2, color: LINE_COLOR, alpha: LINE_ALPHA });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
