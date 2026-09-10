import { Container, Graphics } from "pixi.js";
import { Quality } from "../state/Quality";

/**
 * Per-weapon tracer / impact visual effects. Ported from the Effect_*.as
 * MovieClips (Bullet / Assault / Lazer / Sniper / Shotgun / Plasma / Boss
 * / Proj_Uzi / Proj_Rocket / Proj_NadeLauncher).
 *
 * Each AS class constructed a `Sprite` and drew a jagged or smooth line
 * through a snapshot of the gun's previous trajectory points (a small
 * history of (x,y) positions kept by the firing Unit). On the next
 * EnterFrame the effect removed itself. The TS port exposes a single
 * `WeaponTracer` with a per-weapon style (colour, glow, jitter, fade),
 * and the GameScreen dispatches to it via `addTracer(x1,y1,x2,y2,beam)`
 * for hitscans or via `addProjectileTrail(...)` for travelling projectiles.
 *
 * The persistent blood-on-wall decal (Effect with gotoAndStop("blood"))
 * is rendered as the red ring in GameScreen.addEffect("blood").
 */

export type TracerStyle =
  | "bullet"
  | "assault"
  | "lazer"
  | "sniper"
  | "shotgun"
  | "plasma"
  | "boss"
  | "uzi"
  | "rocket"
  | "grenade";

interface StyleSpec {
  color: number;
  /** Stroke width for the core line. */
  width: number;
  /** Optional glow stroke (drawn behind the core). */
  glow?: { color: number; width: number; alpha: number };
  /** If true, tracer fades out over `life` ticks. */
  life: number;
  /** Initial alpha (also the peak alpha). */
  alpha: number;
}

const STYLES: Record<TracerStyle, StyleSpec> = {
  bullet: { color: 0xfff266, width: 1, life: 4, alpha: 0.9 },
  assault: {
    color: 0xfe2fab,
    width: 1.5,
    glow: { color: 0xfe2fab, width: 8, alpha: 0.35 },
    life: 4,
    alpha: 0.95,
  },
  lazer: { color: 0xccddff, width: 2, life: 5, alpha: 0.9 },
  sniper: {
    color: 0xffffff,
    width: 1,
    glow: { color: 0xffffff, width: 6, alpha: 0.55 },
    life: 6,
    alpha: 1,
  },
  shotgun: {
    color: 0xff5060,
    width: 1.2,
    glow: { color: 0xff8030, width: 10, alpha: 0.3 },
    life: 5,
    alpha: 0.95,
  },
  plasma: {
    color: 0xd68264,
    width: 1.5,
    glow: { color: 0x4950a7, width: 12, alpha: 0.45 },
    life: 7,
    alpha: 0.95,
  },
  boss: {
    color: 0xffffff,
    width: 1.2,
    glow: { color: 0xff2030, width: 8, alpha: 0.5 },
    life: 8,
    alpha: 1,
  },
  uzi: { color: 0x88ccff, width: 1, life: 4, alpha: 0.9 },
  rocket: {
    color: 0xffaa33,
    width: 1.5,
    glow: { color: 0xff5a4d, width: 10, alpha: 0.45 },
    life: 6,
    alpha: 1,
  },
  grenade: {
    color: 0x88dd66,
    width: 1.2,
    glow: { color: 0x44aa33, width: 8, alpha: 0.35 },
    life: 6,
    alpha: 1,
  },
};

/**
 * A short-lived weapon tracer. The original AS Effect_* classes rendered
 * the bullet's path as a series of lineTo() calls through the trajectory
 * history (with random jumps so the line looked broken / electric). The
 * TS port keeps it visually close: a straight line from (x1,y1) to
 * (x2,y2), drawn with a glowing wider stroke behind a thinner core, then
 * faded and removed after `life` ticks.
 */
export class WeaponTracer {
  readonly view = new Container();
  private g = new Graphics();
  private style: StyleSpec;
  private x1: number;
  private y1: number;
  private x2: number;
  private y2: number;
  private age = 0;

  constructor(
    parent: Container,
    style: TracerStyle,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) {
    this.style = STYLES[style] ?? STYLES.bullet;
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.g = new Graphics();
    this.redraw(this.style.alpha);
    this.view.addChild(this.g);
    parent.addChild(this.view);
  }

  enterFrame(): boolean {
    this.age++;
    if (this.age >= this.style.life) {
      this.view.destroy({ children: true });
      return false;
    }
    const a = this.style.alpha * (1 - this.age / this.style.life);
    this.redraw(a);
    return true;
  }

  private redraw(alpha: number): void {
    const g = this.g;
    g.clear();
    // The wide low-alpha stroke behind the core stands in for the original's
    // GlowFilter — and, exactly as in the AS3 build, it is skipped entirely
    // when the player has glow turned off (SD.noGlow) or is on Low quality.
    if (this.style.glow && Quality.glow) {
      g.moveTo(this.x1, this.y1)
        .lineTo(this.x2, this.y2)
        .stroke({
          color: this.style.glow.color,
          width: this.style.glow.width,
          alpha: this.style.glow.alpha * alpha,
        });
    }
    g.moveTo(this.x1, this.y1)
      .lineTo(this.x2, this.y2)
      .stroke({ color: this.style.color, width: this.style.width, alpha });
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}

/**
 * Short-lived impact ring at (x,y) — the analog of Effect.gotoAndStop("blood")
 * or the per-weapon hit-effect. Original drew a tinted sprite frame for
 * `wallEff`/`unitEff`; here we draw an expanding circle with a fading
 * outline.
 */
export class ImpactRing {
  readonly view = new Container();
  private g = new Graphics();
  private age = 0;
  private max = 10;
  private color: number;
  private x: number;
  private y: number;

  constructor(parent: Container, x: number, y: number, color = 0xffcc66) {
    this.x = x;
    this.y = y;
    this.color = color;
    this.view.x = x;
    this.view.y = y;
    this.view.addChild(this.g);
    parent.addChild(this.view);
  }

  enterFrame(): boolean {
    this.age++;
    const t = this.age / this.max;
    this.g.clear();
    this.g.circle(0, 0, 4 + t * 16).stroke({
      color: this.color,
      width: 2,
      alpha: Math.max(0, 1 - t),
    });
    if (this.age >= this.max) {
      this.view.destroy({ children: true });
      return false;
    }
    return true;
  }
}

/** Map from the original `wallEff` / `unitEff` string to a tracer style. */
export function tracerStyleFromEff(eff: string | undefined): TracerStyle {
  switch (eff) {
    case "sniper":
      return "sniper";
    case "uzi":
      return "uzi";
    case "plasma":
      return "plasma";
    case "lazer":
      return "lazer";
    case "lightning":
      return "plasma";
    case "bulletExplode":
    case "rocketExplode":
    case "grenadeExplode":
      return "rocket";
    default:
      return "bullet";
  }
}
