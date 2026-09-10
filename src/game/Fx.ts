import { Container, Graphics, Text, TextStyle } from "pixi.js";
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

/**
 * Kill announcement: a small card that rises off the victim and fades, with
 * the killing weapon's silhouette next to the word. Shown in world space at
 * the body so the player's eye is already looking at it.
 */
function killPopup(weaponId: string, headshot: boolean): FxObject {
  const maxAge = 52;
  const fade = 16;
  let age = 0;
  const view = new Container();
  // GameScreen owns `view`'s position (it drops the effect at the body), so the
  // rise animates an inner container instead of fighting it.
  const inner = new Container();
  view.addChild(inner);
  const g = new Graphics();
  const label = new Text({
    text: headshot ? "HEADSHOT" : (WEAPONS[weaponId]?.msg ?? "KILL").toUpperCase(),
    style: new TextStyle({
      fill: headshot ? 0xffcc33 : 0xffffff,
      fontFamily: "monospace",
      fontSize: 11,
      fontWeight: "bold",
      letterSpacing: 1,
    }),
  });
  label.anchor.set(0, 0.5);
  label.x = 12;
  inner.addChild(g, label);
  return {
    view,
    enterFrame(): boolean {
      age++;
      // Rises fast then eases to a stop, so it settles where it can be read.
      const rise = 26 * (1 - Math.pow(1 - Math.min(1, age / 22), 3));
      inner.y = -rise;
      inner.alpha = age > maxAge - fade ? Math.max(0, (maxAge - age) / fade) : 1;
      // Draw the weapon glyph once; it does not animate.
      if (age === 1) {
        const col = headshot ? 0xffcc33 : 0xdddddd;
        g.rect(-16, -3, 20, 4).fill({ color: col });
        g.rect(-4, 0, 5, 7).fill({ color: col });
      }
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
 * Build the effect display object for a given `wallEff`/misc effect type
 * string (as used by Guns.ts / Projectile.ts / Unit.ts / PickupItem.ts).
 * The caller is responsible for positioning `view` and adding it to a
 * parent container.
 *
 * `color` optionally overrides the impact tint — Guns.ts passes the firing
 * weapon's `sparkColor` so a railgun scars the wall cyan, plasma purple and a
 * rocket orange, instead of every hit looking the same.
 */
export function createEffect(type: string, color?: number, angleDeg?: number): FxObject {
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
    default:
      return genericRing(0xffcc66);
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
 * A rising "X killed Y" card at the victim's body, with the killing weapon's
 * silhouette. Shown only for the human player's kills.
 */
export const addKillPopup = killPopup;

/**
 * Floating kill-bonus popup: a stack of bonus names (Headshot!/Juggerkill!/…)
 * over a "+N" credits line, rising and fading at the kill location. Positioned
 * by the caller like killPopup.
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
