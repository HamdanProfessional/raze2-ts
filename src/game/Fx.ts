import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { FxArt, type FxDef } from "../assets/FxArt";
import { Quality } from "../state/Quality";
import { WEAPONS } from "./weapons";

/**
 * Self-animating combat effect library. Each effect is a small Container
 * (already positioned at the impact point and added to a parent by the
 * caller) plus an `enterFrame()` that redraws it for the current age and
 * returns `done` — true once the effect has finished and can be destroyed.
 *
 * These replace the single generic "expanding ring" that GameScreen used to
 * draw for every `wallEff` — each weapon now gets a distinct look, matching
 * the flavour of its Effect_*.as MovieClip in the original SWF (spark burst,
 * blood spray, energy flash, fireball + shockwave, teleport flash, ...).
 *
 * Kept deliberately cheap: a single Graphics per effect, cleared and
 * redrawn from a small particle array every tick. Nothing here throws if
 * Graphics drawing calls are no-ops (the headless test stub), since state is
 * tracked in plain arrays/numbers, not read back from the display object.
 */

export interface FxObject {
  readonly view: Container;
  /** Advance one tick; returns true once the effect is finished. */
  enterFrame(): boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: number;
  life: number;
  maxLife: number;
  fade?: boolean;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

/**
 * Spawns a burst of small particles that fly outward, fall, and fade.
 *
 * `count` is the "High" density; the requested amount is scaled by the current
 * graphics-quality profile (Low thins bursts to roughly a third, Max fattens
 * them), so every effect in the library follows the setting for free.
 */
function makeBurst(
  count: number,
  opts: {
    colors: number[];
    speed: [number, number];
    size: [number, number];
    gravity?: number;
    life: [number, number];
    spreadDeg?: [number, number];
  },
): Particle[] {
  const particles: Particle[] = [];
  const [aMin, aMax] = opts.spreadDeg ?? [0, 360];
  const n = Quality.count(count);
  for (let i = 0; i < n; i++) {
    const ang = (rand(aMin, aMax) * Math.PI) / 180;
    const speed = rand(opts.speed[0], opts.speed[1]);
    particles.push({
      x: 0,
      y: 0,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      gravity: opts.gravity ?? 0,
      size: rand(opts.size[0], opts.size[1]),
      color: pick(opts.colors),
      life: 0,
      maxLife: rand(opts.life[0], opts.life[1]),
    });
  }
  return particles;
}

/** Generic particle-burst effect: drives an array of Particle through their life. */
class ParticleFx implements FxObject {
  readonly view = new Container();
  private g = new Graphics();
  private age = 0;

  constructor(
    private particles: Particle[],
    private maxAge: number,
    /** Extra per-frame draw hook (flashes, rings) layered under the particles. */
    private drawExtra?: (g: Graphics, t: number, age: number) => void,
  ) {
    this.view.addChild(this.g);
  }

  enterFrame(): boolean {
    this.age++;
    const t = this.maxAge > 0 ? this.age / this.maxAge : 1;
    const g = this.g;
    g.clear();
    if (this.drawExtra) this.drawExtra(g, t, this.age);

    let anyAlive = false;
    for (const p of this.particles) {
      p.life++;
      if (p.life > p.maxLife) continue;
      anyAlive = true;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      const lt = p.life / p.maxLife;
      const alpha = Math.max(0, 1 - lt);
      g.circle(p.x, p.y, Math.max(0.4, p.size * (1 - lt * 0.5))).fill({
        color: p.color,
        alpha,
      });
    }

    return this.age >= this.maxAge && !anyAlive;
  }
}

// --- individual effect builders --------------------------------------------

/**
 * Bullet-class wall impact: bright flash + radiating sparks + a couple of debris
 * bits. When `angleDeg` is given, the sparks spray in a cone about that heading
 * (the direction back off the surface — i.e. toward where the shot came from)
 * instead of a symmetric ring; omit it for an omnidirectional burst.
 */
function bulletSpark(color: number, sparkLen: number, big = false, angleDeg?: number): FxObject {
  const directional = angleDeg !== undefined;
  const CONE = 55; // half-angle of the spray cone, degrees
  const particles = makeBurst(big ? 10 : 6, {
    colors: [0xffe08a, 0xfff2c0, color],
    speed: [1.5, big ? 5 : 3.5],
    size: [0.6, big ? 2 : 1.4],
    gravity: 0.15,
    life: [6, 12],
    spreadDeg: directional ? [angleDeg! - CONE, angleDeg! + CONE] : [0, 360],
  });
  const maxAge = 12;
  const base = ((angleDeg ?? 0) * Math.PI) / 180;
  const coneRad = (CONE * Math.PI) / 180;
  return new ParticleFx(particles, maxAge, (g, t) => {
    // Bright core flash that collapses quickly (a glow — skipped when off).
    if (Quality.glow) {
      const flashT = Math.min(1, t * 4);
      g.circle(0, 0, (1 - flashT) * (big ? 7 : 4.5)).fill({
        color: 0xffffff,
        alpha: Math.max(0, 1 - flashT),
      });
    }
    // Radiating spark lines — fanned across the cone when directional, else a
    // full ring.
    if (Quality.detail && t < 0.5) {
      const a = 1 - t * 2;
      const n = big ? 8 : 5;
      const len = sparkLen * (0.4 + t);
      for (let i = 0; i < n; i++) {
        const ang = directional
          ? base + (n > 1 ? (i / (n - 1) - 0.5) * 2 * coneRad : 0)
          : (i / n) * Math.PI * 2 + t * 2;
        g.moveTo(0, 0)
          .lineTo(Math.cos(ang) * len, Math.sin(ang) * len)
          .stroke({ color, width: 1, alpha: a });
      }
    }
  });
}

/**
 * Muzzle flash: the bright cone of burning propellant at the barrel tip.
 *
 * Lives ~5 ticks (0.15s at the fixed 30Hz logic rate) — a pop, not a glow.
 * `angleDeg` is the shot direction so the cone stretches down the barrel;
 * `size` is the flash radius (pistol ~8, shotgun ~22, sniper ~18).
 */
function muzzleFlash(color: number, size: number, angleDeg: number): FxObject {
  const maxAge = 5;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Perpendicular, for the cone's base and the cross-flare.
  const nx = -sin;
  const ny = cos;
  // Forward-spitting sparks — the first thing dropped on the Low profile.
  const particles = Quality.detail
    ? makeBurst(Math.round(2 + size * 0.25), {
        colors: [color, 0xfff2c0, 0xffffff],
        speed: [1.2, 1.2 + size * 0.22],
        size: [0.5, 0.8 + size * 0.06],
        gravity: 0.08,
        life: [3, 8],
        spreadDeg: [angleDeg - 22, angleDeg + 22],
      })
    : [];
  return new ParticleFx(particles, maxAge, (g, t) => {
    const k = Math.max(0, 1 - t);
    // Cone stretches forward while it collapses in width.
    const len = size * (0.9 + t * 0.9);
    const w = size * 0.5 * k;
    g.moveTo(nx * w, ny * w)
      .lineTo(cos * len, sin * len)
      .lineTo(-nx * w, -ny * w)
      .fill({ color, alpha: 0.85 * k });
    // Hot white core right at the barrel.
    g.circle(0, 0, size * 0.4 * k).fill({ color: 0xffffff, alpha: k });
    if (Quality.glow) {
      g.circle(0, 0, size * 0.85 * k).fill({ color, alpha: 0.3 * k });
      // Cross-flare across the barrel axis.
      const fl = size * 0.7 * k;
      g.moveTo(-nx * fl, -ny * fl)
        .lineTo(nx * fl, ny * fl)
        .stroke({ color, width: Math.max(1, size * 0.12), alpha: 0.5 * k });
    }
  });
}

/**
 * One puff of barrel smoke: a soft grey blob that expands, curls upward and
 * thins out. Guns.ts emits two or three of these per shot (more on sustained
 * fire), staggered a few ticks apart.
 */
function smokePuff(size: number, vx: number, vy: number): FxObject {
  const maxAge = Math.round(rand(18, 30));
  let age = 0;
  let x = 0;
  let y = 0;
  let dx = vx;
  let dy = vy;
  const drift = rand(-0.04, 0.04);
  const tone = pick([0xdedede, 0xc6c6c6, 0xb0b0b0]);
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      x += dx;
      y += dy;
      dx = dx * 0.93 + drift;
      dy = dy * 0.93 - 0.035; // buoyancy: smoke always ends up rising
      g.clear();
      g.circle(x, y, size * (0.5 + t * 1.7)).fill({
        color: tone,
        // Fades in over the first fifth of its life, then out.
        alpha: 0.3 * Math.min(1, t * 5) * (1 - t),
      });
      return age >= maxAge;
    },
  };
}

/**
 * A flame lick from a burning unit (`fexpand`, the `fire` pseudo-gun's hit
 * effect). Rises and narrows as it cools from white through orange to smoke.
 * Status.burnTick spawns one every third frame somewhere on the body.
 */
function flameLick(): FxObject {
  const maxAge = 14;
  let age = 0;
  const drift = rand(-0.6, 0.6);
  const rise = rand(1.2, 2.2);
  const size = rand(5, 9);
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      view.x += drift;
      view.y -= rise * (1 - t * 0.5);
      // White-hot core to deep orange to nothing.
      const color = t < 0.3 ? 0xfff0c0 : t < 0.65 ? 0xffa32a : 0xd2461a;
      g.clear();
      g.circle(0, 0, size * (1 - t * 0.6)).fill({ color, alpha: 0.85 * (1 - t) });
      return age >= maxAge;
    },
  };
}

/**
 * A tumbling brass casing kicked out of the ejection port. Falls under
 * gravity, bounces once off the ground plane and fades out inside a second.
 */
function shellCasing(vx: number, vy: number): FxObject {
  const maxAge = 34;
  let age = 0;
  let x = 0;
  let y = 0;
  let dx = vx;
  let dy = vy;
  let rot = rand(0, Math.PI * 2);
  const spin = rand(-0.5, 0.5);
  let bounced = false;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      dy += 0.55;
      x += dx;
      y += dy;
      rot += spin;
      // A single cheap bounce: the casing has fallen roughly a body height.
      if (!bounced && y > 46) {
        y = 46;
        dy = -dy * 0.35;
        dx *= 0.5;
        bounced = true;
      }
      // Draw the casing as a rotated 4x2 brass sliver.
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const hw = 2.2;
      const hh = 1;
      const alpha = Math.max(0, 1 - t * t);
      g.clear();
      g.moveTo(x + (-hw * c - -hh * s), y + (-hw * s + -hh * c))
        .lineTo(x + (hw * c - -hh * s), y + (hw * s + -hh * c))
        .lineTo(x + (hw * c - hh * s), y + (hw * s + hh * c))
        .lineTo(x + (-hw * c - hh * s), y + (-hw * s + hh * c))
        .fill({ color: 0xd8a94a, alpha });
      return age >= maxAge;
    },
  };
}

/**
 * Blood spray when a unit is hit. `big` for sniper/pistol headshots etc.
 *
 * `tint` is the victim's blood colour (human red / alien purple / robot black /
 * zombie green / shield gold — doc 07). A single tinted particle system stands
 * in for the original's five recoloured clips; defaults to human red.
 */
function bloodSpray(big: boolean, tint = 0xc21818): FxObject {
  // Blend the tint with a couple of darker shades of itself for depth.
  const dark = (c: number, f: number) => {
    const r = ((c >> 16) & 0xff) * f;
    const g = ((c >> 8) & 0xff) * f;
    const b = (c & 0xff) * f;
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  };
  const particles = makeBurst(big ? 14 : 8, {
    colors: [tint, dark(tint, 0.7), dark(tint, 0.5)],
    speed: [0.8, big ? 4.5 : 3],
    size: [1, big ? 3.2 : 2.2],
    gravity: 0.25,
    life: [10, big ? 22 : 16],
    spreadDeg: [0, 360],
  });
  const blot = dark(tint, 0.55);
  return new ParticleFx(particles, big ? 22 : 16, (g, t) => {
    // A dark splat blot that lingers a touch under the particles.
    if (t < 0.85) {
      g.circle(0, 0, (big ? 6 : 4) * (0.6 + t * 0.5)).fill({
        color: blot,
        alpha: 0.35 * (1 - t),
      });
    }
  });
}

/** Plasma bolt impact: a searing flash with a short energy ripple. */
function plasmaFlash(color = 0x66e0ff): FxObject {
  const particles = makeBurst(8, {
    colors: [color, 0xffb060, 0xffffff],
    speed: [1, 4],
    size: [0.8, 2],
    gravity: 0,
    life: [6, 10],
  });
  const maxAge = 10;
  return new ParticleFx(particles, maxAge, (g, t) => {
    if (Quality.detail) {
      const r = 3 + t * 14;
      g.circle(0, 0, r).stroke({ color, width: 2, alpha: 1 - t });
    }
    if (Quality.glow) {
      g.circle(0, 0, Math.max(0, 6 * (1 - t * 2))).fill({
        color: 0xffffff,
        alpha: Math.max(0, 1 - t * 2),
      });
    }
  });
}

/** Lightning / railgun impact: flickering jagged arcs converging on the point. */
function lightningFlash(color = 0xaeefff): FxObject {
  const maxAge = 8;
  let age = 0;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      g.clear();
      if (t < 1) {
        if (Quality.glow) {
          g.circle(0, 0, 5 + t * 6).fill({ color: 0xdaf0ff, alpha: (1 - t) * 0.8 });
        }
        const arcs = Quality.count(5);
        for (let i = 0; i < arcs; i++) {
          const baseAng = (i / arcs) * Math.PI * 2;
          const dist = rand(14, 30);
          let x = 0;
          let y = 0;
          g.moveTo(x, y);
          const segs = 3;
          for (let s = 1; s <= segs; s++) {
            const ang = baseAng + rand(-0.6, 0.6);
            const d = (dist / segs) * s;
            x = Math.cos(ang) * d + rand(-3, 3);
            y = Math.sin(ang) * d + rand(-3, 3);
            g.lineTo(x, y);
          }
          g.stroke({ color, width: 1.4, alpha: (1 - t) * 0.9 });
        }
      }
      return age >= maxAge;
    },
  };
}

/** Fireball + shockwave ring + flying debris — shotgun/grenade/rocket explosions. */
function explosion(scale: number): FxObject {
  const maxAge = Math.round(16 + scale * 10);
  const debris = makeBurst(Math.round(6 + scale * 6), {
    colors: [0x333333, 0x555555, 0x222222],
    speed: [1, 3 + scale * 3],
    size: [1, 1.5 + scale],
    gravity: 0.3,
    life: [maxAge * 0.6, maxAge],
  });
  const fireParticles = makeBurst(Math.round(6 + scale * 8), {
    colors: [0xffcc55, 0xff8822, 0xff5522],
    speed: [0.5, 2.5 + scale * 2],
    size: [1.5, 3 + scale * 2],
    gravity: -0.05,
    life: [maxAge * 0.4, maxAge * 0.8],
  });
  const particles = [...debris, ...fireParticles];
  const fireballR = 8 + scale * 20;
  const ringR = 14 + scale * 36;
  return new ParticleFx(particles, maxAge, (g, t) => {
    // Fireball: fast expand then fade, orange -> red -> dark.
    const fbT = Math.min(1, t * 2.2);
    const fbR = fireballR * (0.3 + fbT * 0.7) * (1 - t * 0.2);
    const fbColor = fbT < 0.5 ? 0xffdd66 : fbT < 0.8 ? 0xff6a2a : 0x552211;
    g.circle(0, 0, Math.max(0, fbR)).fill({
      color: fbColor,
      alpha: Math.max(0, 1 - t * 1.1),
    });
    // Shockwave ring expanding outward, thin and bright, fading fast.
    if (Quality.detail) {
      g.circle(0, 0, ringR * t).stroke({
        color: 0xffffff,
        width: Math.max(0.6, 3 * (1 - t)),
        alpha: Math.max(0, 0.9 - t * 1.2),
      });
    }
  });
}

/** Chaingun/lazer beam impact: quick bright puncture with a couple of sparks. */
function lazerImpact(color = 0xccddff): FxObject {
  const particles = makeBurst(4, {
    colors: [color, 0xffffff],
    speed: [1, 3],
    size: [0.6, 1.4],
    gravity: 0.1,
    life: [5, 9],
  });
  return new ParticleFx(particles, 9, (g, t) => {
    if (Quality.glow) {
      g.circle(0, 0, (1 - t) * 3.5).fill({ color: 0xeaffff, alpha: 1 - t });
    }
  });
}

/**
 * "Spark rain": the secondary shower a hitscan round throws off a hard
 * surface. Where `bulletSpark` is the instant of the strike, this is the
 * half-second afterwards — a handful of embers arcing out and falling under
 * gravity, which is what actually reads as "the bullet hit *there*" once the
 * tracer has gone.
 */
function sparkRain(color: number): FxObject {
  const particles = makeBurst(7, {
    colors: [color, 0xffe08a, 0xffffff],
    speed: [1, 4],
    size: [0.5, 1.3],
    // Heavier than the strike sparks so they visibly arc down.
    gravity: 0.42,
    life: [10, 22],
    // Biased upward and outward — nothing sprays into the surface it hit.
    spreadDeg: [190, 350],
  });
  return new ParticleFx(particles, 22);
}

/**
 * Critical-hit indicator: the bright white pop on a headshot. Deliberately
 * louder and shorter than any weapon impact — a single frame-and-a-half of
 * white with a four-point star, so it never gets lost in the blood spray it
 * lands on top of.
 */
function critFlash(): FxObject {
  const maxAge = 9;
  let age = 0;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      const k = Math.max(0, 1 - t);
      g.clear();
      // Core pop.
      g.circle(0, 0, 3 + k * 9).fill({ color: 0xffffff, alpha: k });
      // Four-point star flare, stretching as it fades.
      const arm = 10 + t * 22;
      const wide = 2.5 * k;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        g.moveTo(-dx * arm, -dy * arm)
          .lineTo(dy * wide, dx * wide)
          .lineTo(dx * arm, dy * arm)
          .lineTo(-dy * wide, -dx * wide)
          .fill({ color: 0xfff6d0, alpha: 0.9 * k });
      }
      // Expanding ring so the hit reads even against a white wall.
      g.circle(0, 0, 6 + t * 20).stroke({ color: 0xffcc44, width: 2 * k, alpha: k });
      return age >= maxAge;
    },
  };
}

/** Teleport-in flash used when a unit spawns. */
function spawnFlash(): FxObject {
  const maxAge = 16;
  let age = 0;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      g.clear();
      // Collapsing bright ring.
      const r = 26 * (1 - t) + 4;
      g.circle(0, 0, r).stroke({ color: 0x8be6ff, width: 3, alpha: 1 - t });
      // Vertical light beam that fades out.
      const beamAlpha = Math.max(0, 0.6 - t * 0.6);
      if (Quality.detail && beamAlpha > 0) {
        g.rect(-3, -60, 6, 60).fill({ color: 0xbdf3ff, alpha: beamAlpha });
      }
      // Core flash.
      if (Quality.glow) {
        g.circle(0, 0, Math.max(0, 8 * (1 - t * 1.5))).fill({
          color: 0xffffff,
          alpha: Math.max(0, 1 - t * 1.5),
        });
      }
      return age >= maxAge;
    },
  };
}

/** Fallback ring for pickups / unmapped effect types, tinted per type. */
function genericRing(color: number): FxObject {
  const maxAge = 10;
  let age = 0;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      g.clear();
      g.circle(0, 0, 4 + t * 16).stroke({ color, width: 2, alpha: Math.max(0, 1 - t) });
      return age >= maxAge;
    },
  };
}

/**
 * The little splash a waterfall droplet or a landing snowflake makes
 * (`Particle.EnterFrame` fires `snow_splash` on every impact). It has to be
 * much smaller and shorter than a weapon's ring: on a map like jungle there can
 * be a dozen a frame, so this is a 6px crown that is gone in a fifth of a
 * second rather than a 20px expanding hoop.
 */
function splashCrown(color: number): FxObject {
  const maxAge = 6;
  let age = 0;
  const view = new Container();
  const g = new Graphics();
  view.addChild(g);
  const drops = Array.from({ length: 3 }, () => ({
    vx: (Math.random() - 0.5) * 3,
    vy: -1 - Math.random() * 1.5,
    x: 0,
    y: 0,
  }));
  return {
    view,
    enterFrame(): boolean {
      age++;
      const t = age / maxAge;
      g.clear();
      g.circle(0, 0, 1 + t * 5).stroke({ color, width: 1, alpha: 0.7 * (1 - t) });
      for (const d of drops) {
        d.x += d.vx;
        d.y += d.vy;
        d.vy += 0.5;
        g.circle(d.x, d.y, 0.9).fill({ color, alpha: 0.85 * (1 - t) });
      }
      return age >= maxAge;
    },
  };
}

/**
 * Plays one effect straight out of the SWF's `BH` atlas — the port of
 * `Effect.as`, which is the entire original effect system:
 *
 *     rotation = UT.irand(0, stats.rotAmt - 1);   // once, at spawn
 *     paint(x, y, true, name, sub, frame);        // then one frame per tick
 *     if (frame > stats.frames) remove = true;
 *
 * The rotation is rolled once and held, which is why two mud splashes a moment
 * apart never look like copies of each other.
 */
class BitAniFx implements FxObject {
  readonly view = new Container();
  private spr = new Sprite();
  private frame = 0;
  /** `UT.irand(0, rotAmt - 1)`, chosen at spawn and fixed for the effect's life. */
  private rot: number;

  constructor(
    private name: string,
    private def: FxDef,
    /** Frame to open on. `Game.createEffectAtFrame` — how a flamethrower jet
     *  that hits a wall mid-flight finishes its animation at the impact point
     *  instead of restarting (`Bullet_Proj_Frames.as:89`). */
    startFrame = 0,
  ) {
    this.frame = Math.max(0, Math.min(startFrame, def.frames - 1));
    this.rot = (Math.random() * def.rotAmt) | 0;
    this.spr.scale.set(1 / def.bakeScale);
    // A whitened effect is a flat mask standing in for a `mult=0` colour
    // transform, so the tint REPLACES the art's colour rather than shading it.
    if (def.whitened) this.spr.tint = def.tint ?? 0xffffff;
    this.view.alpha = def.alpha ?? 1;
    this.view.addChild(this.spr);
    this.paint();
  }

  private paint(): void {
    const idx = this.rot * this.def.frames + this.frame;
    const tex = FxArt.cell(this.name, idx);
    const cell = this.def.cells[idx];
    this.spr.visible = !!tex;
    if (!tex || !cell) return;
    this.spr.texture = tex;
    // lx/ly are authored px from the point createEffect() was called at; the
    // sprite's own scale already undoes the bake resolution.
    this.spr.x = cell.lx;
    this.spr.y = cell.ly;
  }

  enterFrame(): boolean {
    this.frame++;
    if (this.frame >= this.def.frames) return true;
    this.paint();
    return false;
  }
}

/**
 * The port's invented effect names, mapped onto the `BH` clip the original
 * would have played. These exist because the port had to name its impacts
 * before any of the art was extractable — `"rocketExplode"` is not a Raze 2
 * string, it is a description of one.
 *
 * Weapons out of `raze2/weapons.json` no longer come through here at all: they
 * carry the authored `effShoot`/`effHit`/`params[0]` names and ask for those
 * directly. This is for the call sites that still hardcode a name (the reflect
 * grenade in `Projectile.ts`, the ability bursts) and for any weapon def built
 * outside the catalog.
 *
 * Names absent from the table — `crit`, `sparkRain`, `getDdamage`, `getFade`,
 * `getInvin` — have no BH counterpart because the original draws nothing there;
 * they stay procedural rather than losing their read.
 */
const BH_ALIAS: Record<string, string> = {
  // Hitscan strike sparks. The catalog's own pistols/shotguns fire `gas_small`,
  // but a bare "a bullet hit something" wants the spark, not the smoke puff.
  bullet: "spark_small",
  pistol: "spark_small",
  uzi: "spark_small",
  sniper: "spark_big",
  lazer: "spark_big",
  lightning: "chain_hit",
  plasma: "plasma_explode",
  // Blasts. `gas_big` IS the Raze 2 explosion — every splash weapon in the
  // catalog (rocket, grenade, mine, stick launcher) hits with a `gas_*` cloud.
  bulletExplode: "spark_big",
  grenadeExplode: "gas_big",
  rocketExplode: "gas_big",
  // `Bullet.as:205` passes `hitObject.skin.blood` straight to createEffect, so
  // the skin names ARE effect names; plain "blood" is the unskinned default.
  blood: "bloodHuman",
  bloodBig: "bloodHuman",
};

/**
 * Build the effect display object for a given `wallEff`/misc effect type
 * string (as used by Guns.ts / Projectile.ts / Unit.ts / PickupItem.ts).
 * The caller is responsible for positioning `view` and adding it to a
 * parent container.
 *
 * **The baked `BH` atlas wins.** `Effect.as` is the entire original effect
 * system and every name it answers to is now extracted, so a hand-drawn
 * stand-in only runs where the SWF genuinely has no clip. The procedural
 * library stays for those names and as the headless-stub fallback.
 *
 * `color` is honoured only on the procedural path. The baked art carries its
 * own authored colour — the SWF's `createEffect(x, y, name)` takes no tint, and
 * a weapon's `sparkColor` painted over a finished explosion fights it. The
 * exception is a `whitened` entry (the skin bloods), whose tint is part of the
 * rig rather than something the caller chooses.
 */
export function createEffect(type: string, color?: number, angleDeg?: number): FxObject {
  // `FxArt.def` answers from the rig JSON, which is bundled and so always
  // present; the atlas PNGs are not. Without this gate a failed (or not yet
  // finished) load would hand back clips whose every cell resolves to null —
  // combat would go silent-looking rather than falling back to the drawn
  // library, which is also how the headless test stub runs.
  const name = FxArt.loaded && FxArt.has(type) ? type : BH_ALIAS[type] ?? type;
  const def = FxArt.loaded ? FxArt.def(name) : null;
  if (def) return new BitAniFx(name, def);
  const drawn = procedural(type, color, angleDeg);
  if (drawn) return drawn;
  return genericRing(0xffcc66);
}

/**
 * `Game.createEffectAtFrame` — the same clip, opened partway through. Returns
 * null (rather than a stand-in) when the name has no baked art, so the caller
 * can fall back to whatever it drew before.
 */
export function createEffectAtFrame(type: string, frame: number): FxObject | null {
  if (!FxArt.loaded) return null;
  const name = FxArt.has(type) ? type : BH_ALIAS[type] ?? type;
  const def = FxArt.def(name);
  return def ? new BitAniFx(name, def, frame) : null;
}

/**
 * One BH clip whose frame the *caller* advances, for art that belongs to a
 * live object rather than to a fire-and-forget burst.
 *
 * `Bullet_Proj_Frames` (the flamethrower) is the case this exists for: the
 * round has no body of its own, it IS a `flame` clip —
 *
 *     bitstats = BH.getBitAniStats(stats.params[0], "idle");
 *     name = stats.params[0] + UT.irand(0, bitstats.rotAmt - 1);
 *
 * — rolled once at spawn and stepped one frame per tick as it flies, which is
 * why a jet visibly billows out along its length instead of every puff looking
 * alike.
 */
export class BhBody {
  readonly view = new Container();
  private spr = new Sprite();
  private def: FxDef;
  private rot: number;
  /** Animation length — the flamethrower's fuse, in the original. */
  readonly frames: number;

  private constructor(private name: string, def: FxDef) {
    this.def = def;
    this.frames = def.frames;
    this.rot = (Math.random() * def.rotAmt) | 0;
    this.spr.scale.set(1 / def.bakeScale);
    if (def.whitened) this.spr.tint = def.tint ?? 0xffffff;
    this.view.alpha = def.alpha ?? 1;
    this.view.addChild(this.spr);
    this.setFrame(0);
  }

  /** The clip for `name`, or null when it has no baked art (or none loaded —
   *  the caller then keeps whatever it drew by hand). */
  static create(name: string): BhBody | null {
    if (!FxArt.loaded) return null;
    const def = FxArt.def(name);
    return def ? new BhBody(name, def) : null;
  }

  setFrame(frame: number): void {
    const f = Math.max(0, Math.min(frame, this.frames - 1));
    const idx = this.rot * this.frames + f;
    const tex = FxArt.cell(this.name, idx);
    const cell = this.def.cells[idx];
    this.spr.visible = !!tex;
    if (!tex || !cell) return;
    this.spr.texture = tex;
    this.spr.x = cell.lx;
    this.spr.y = cell.ly;
  }
}

/** The hand-drawn library. Returns null for a name it has no art for, so
 *  `createEffect` can fall through to the baked atlas. */
function procedural(type: string, color?: number, angleDeg?: number): FxObject | null {
  switch (type) {
    case "pistol":
      return bulletSpark(color ?? 0xfff2a0, 10, false, angleDeg);
    case "sniper":
      return bulletSpark(color ?? 0xffffff, 16, true, angleDeg);
    case "bullet":
      return bulletSpark(color ?? 0xfff2a0, 8, false, angleDeg);
    case "uzi":
      return bulletSpark(color ?? 0x88ccff, 9, false, angleDeg);
    case "blood":
      return bloodSpray(false, color);
    case "bloodBig":
      return bloodSpray(true, color);
    case "plasma":
      return plasmaFlash(color);
    case "lightning":
      return lightningFlash(color);
    case "lazer":
      return lazerImpact(color);
    case "bulletExplode":
      return explosion(0.4);
    case "grenadeExplode":
      return explosion(0.9);
    case "rocketExplode":
      return explosion(1.4);
    case "crit":
      return critFlash();
    case "fexpand":
      return flameLick();
    case "sparkRain":
      return sparkRain(color ?? 0xffe08a);
    case "spawn":
      return spawnFlash();
    case "getShield":
      return genericRing(0x66aaff);
    case "getHealth":
      return genericRing(0x66ff88);
    case "getDdamage":
      return genericRing(0xff8844);
    case "getFade":
      return genericRing(0xcc88ff);
    case "getInvin":
      return genericRing(0xffdd44);
    case "snow_splash":
      return splashCrown(color ?? 0xcceeff);
    default:
      return null;
  }
}

// --- weapon-feel effects (positioned by the caller) -------------------------
//
// Unlike the impact library above these aren't keyed off an effect-name
// string: Guns.ts builds them directly from the firing weapon's definition,
// so they take their parameters rather than a type. GameScreen wraps each one
// with the shared position + effect-cap handling.

/**
 * Muzzle flash at the barrel tip, pointing down `angleDeg`. Kept even on the
 * Low profile — it is the single strongest cue that a gun went off — though
 * its spark particles are dropped there.
 */
export const addMuzzleFlash = muzzleFlash;

/**
 * One barrel-smoke puff drifting at (vx, vy). Callers stagger several of these
 * over ~0.3s after a shot; skipped entirely on the Low profile.
 */
export const emitSmoke = smokePuff;

/** A tumbling ejected shell casing thrown at (vx, vy). */
export const ejectShell = shellCasing;

/**
 * Floating kill-bonus popup: a stack of bonus names (Headshot!/Juggerkill!/…)
 * over a "+N" credits line, rising and fading at the kill location. Positioned
 * by the caller, in world space at the kill.
 */
function bonusPopup(lines: string[], points: number): FxObject {
  const maxAge = 70;
  const fade = 20;
  let age = 0;
  const view = new Container();
  const inner = new Container();
  view.addChild(inner);

  let y = 0;
  for (const text of lines) {
    const t = new Text({
      text,
      style: new TextStyle({
        fill: 0xffcc33, fontFamily: "monospace", fontSize: 11,
        fontWeight: "bold", letterSpacing: 1,
      }),
    });
    t.anchor.set(0.5, 1);
    t.y = y;
    inner.addChild(t);
    y -= 13;
  }
  const credit = new Text({
    text: `+${points}`,
    style: new TextStyle({
      fill: 0x8bffa0, fontFamily: "monospace", fontSize: 13, fontWeight: "bold",
    }),
  });
  credit.anchor.set(0.5, 0);
  credit.y = 3;
  inner.addChild(credit);

  return {
    view,
    enterFrame(): boolean {
      age++;
      const rise = 30 * (1 - Math.pow(1 - Math.min(1, age / 26), 3));
      inner.y = -rise;
      inner.alpha = age > maxAge - fade ? Math.max(0, (maxAge - age) / fade) : 1;
      return age >= maxAge;
    },
  };
}

export const addBonusPopup = bonusPopup;
