import { Graphics } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { UT } from "../core/UT";
import { Quality } from "../state/Quality";
import type { WallMask } from "./WallMask";
import { EMITTERS, type Emitter, type Spawn } from "./mapEmitters";

/**
 * The authored per-map ambient particles. Ported from `Particle.as` and
 * `Stats_MapParticles.as`.
 *
 * Every Raze 2 map has a hand-placed set of ambient life: fairies hovering over
 * the jungle pools, fish circling under the water line, waterfalls throwing
 * droplets that splash off the rock, leaves blowing across the ocean map,
 * embers puffing out of the mine vents, snow falling, and columns of rising
 * motes over the vents. `Stats_MapParticles` holds all of it as two blocks per
 * map — a one-time `mapInit` placement and a per-frame emitter run — and
 * `Particle` gives each of the eight kinds its own motion.
 *
 * Two things make it feel authored rather than decorative:
 *
 *  - Particles collide with the level. `Particle.hitTest` samples the map's
 *    wall bitmap and only counts a pixel whose alpha byte is `ff`, so droplets
 *    splash on solid rock but pass through the soft edges of the art.
 *  - Density is the player's "Particles" setting, used as a literal number:
 *    it is the loop bound on the waterfalls, the modulus on the snowfall and
 *    leaf rate, and at 0 the rising motes stop entirely.
 *
 * The original drew each particle as a pre-baked bitmap frame through
 * `BH.getBitAniStats` / `bitscreen.paint`. That atlas is not extracted yet, so
 * the shapes here are drawn procedurally to match each kind's colour and size.
 * Everything goes into one `Graphics`, cleared and repainted per frame.
 */

/** The eight motions in `Particle.EnterFrame`'s switch. */
export type Behave =
  | "fairy"
  | "water"
  | "snow"
  | "shell"
  | "spark"
  | "leaf"
  | "raise"
  | "fish";

/** `Game.createParticle` only spawns within this much of the view. */
const SPAWN_MARGIN = 300;
/** `raise` particles live exactly this long (`fc == 20`). */
const RAISE_LIFE = 20;
/** A splashed droplet counts up to this and is gone. */
const SPLASH_LIFE = 20;

const xMoveToRot = (deg: number, d: number) => Math.cos((deg * Math.PI) / 180) * d;
const yMoveToRot = (deg: number, d: number) => Math.sin((deg * Math.PI) / 180) * d;

interface Extra {
  min?: number;
  max?: number;
  hitframe?: number;
  spd?: number;
  xspd?: number;
  rot1?: number;
  rot2?: number;
}

class Particle {
  remove = false;
  fc = 0;
  xSpd = 0;
  ySpd = 0;
  rotation = 0;
  hitCount = 0;
  /** Frame within the kind's animation; `held` pins it (the `frame` argument). */
  frame: number;
  private held: boolean;

  constructor(
    public x: number,
    public y: number,
    public behave: Behave,
    public extra: Extra,
    /** Art variant, e.g. `leaf3`. Kept for the sprite atlas port. */
    public sub: string,
    frame: number,
  ) {
    this.held = frame > 0;
    this.frame = frame > 0 ? frame : 1;

    switch (behave) {
      case "fairy":
      case "fish":
        extra.rot1 = Math.random() * 360;
        extra.rot2 = Math.random() * 360;
        break;
      case "water":
        this.xSpd = UT.rand(extra.min ?? 0, extra.max ?? 0);
        this.ySpd = UT.rand(-1, 3);
        break;
      case "snow":
        this.xSpd = UT.rand(0, 1);
        this.ySpd = UT.rand(3, 5);
        break;
      case "spark":
        this.xSpd = UT.rand(-2, 2);
        this.ySpd = UT.rand(-1, 3);
        break;
      case "leaf":
        extra.hitframe = 10;
        this.xSpd = UT.rand(0, 1);
        this.ySpd = UT.rand(0.5, 3);
        this.rotation = Math.random() * 360;
        break;
      case "raise":
        this.ySpd = UT.rand(1, 3) * (extra.spd ?? 1);
        // `!(ySpd * xspd) ? 0 : xspd` — no drift unless both are non-zero.
        this.xSpd = !(this.ySpd * (extra.xspd ?? 0)) ? 0 : (extra.xspd ?? 0);
        break;
    }
  }
}

export class MapParticles {
  readonly view = new Graphics();
  private ps: Particle[] = [];
  private fc = 0;
  private emitter: Emitter;

  /**
   * @param map     the map's particle-set id (its geometry id in this port)
   * @param mask    the level's wall bitmap, for `Particle.hitTest`
   * @param splash  fires the `snow_splash` effect where a droplet lands
   */
  constructor(
    map: string,
    private mask: WallMask | null,
    private splash: (x: number, y: number) => void,
  ) {
    this.emitter = EMITTERS[map] ?? { init: [], frame: () => [] };
    for (const s of this.emitter.init) this.spawn(s, true);
  }

  /** Live particle count — the smoke test's handle on density. */
  get count(): number {
    return this.ps.length;
  }

  /**
   * `Game.createParticle`: off-screen emitters do not spawn at all, which is
   * why a map's full set only ever costs what is near the camera. `mapInit`
   * placements pass `force`, so the fairies and fish are there from frame one
   * wherever you happen to arrive.
   */
  private spawn(s: Spawn, force: boolean, cam?: { x: number; y: number }): void {
    const { x, y } = s.pos();
    if (!force && cam && !onScreen(x, y, cam, SPAWN_MARGIN)) return;
    this.ps.push(new Particle(x, y, s.behave, { ...s.extra }, s.sub ?? "idle", s.frame ?? 0));
  }

  /**
   * `game.arena.wall.getPixel32` — solid only where the wall bitmap's alpha
   * byte is `ff`. A half-transparent pixel is the feathered edge of the art and
   * does not stop anything.
   */
  private hitTest(p: Particle): boolean {
    return !!this.mask?.solidAt(p.x, p.y);
  }

  /** One logic tick: run the map's emitters, then move everything. */
  enterFrame(cam: { x: number; y: number }, water?: { startWaveAtPos(x: number, amp: number): void }): void {
    this.fc++;
    for (const s of this.emitter.frame(this.fc, Quality.graphPart, water)) {
      this.spawn(s, s.force ?? false, cam);
    }
    for (const p of this.ps) this.advance(p);
    if (this.ps.some((p) => p.remove)) this.ps = this.ps.filter((p) => !p.remove);
    this.draw();
  }

  /** `Particle.EnterFrame` — one case per behaviour, in the original's order. */
  private advance(p: Particle): void {
    if (p.remove) return;
    p.fc++;
    switch (p.behave) {
      case "fairy":
        p.extra.rot1! += 1;
        p.extra.rot2! += 2;
        p.x += xMoveToRot(p.extra.rot1!, 1);
        p.y += yMoveToRot(p.extra.rot2!, 0.6);
        break;

      case "water":
        p.x += p.xSpd;
        p.y += p.ySpd;
        p.ySpd += 0.5;
        if (!p.hitCount) {
          if (p.fc >= (p.extra.hitframe ?? 0) && this.hitTest(p)) p.hitCount = 1;
        }
        if (p.hitCount === 1) {
          // Kick sideways, back the vertical step out and bounce short.
          p.xSpd *= 3;
          p.y -= p.ySpd;
          p.ySpd *= -UT.rand(0.2, 0.5);
          this.splash(p.x, p.y);
        }
        if (p.hitCount) {
          p.hitCount++;
          if (p.hitCount === SPLASH_LIFE) p.remove = true;
        }
        break;

      case "snow":
        p.x += p.xSpd;
        p.y += p.ySpd;
        // Five seconds of falling before it is allowed to land, so flakes
        // spawned at the top of the map don't stick to the first ledge.
        if (p.fc > 150 && p.fc % 3 === 0 && this.hitTest(p)) {
          this.splash(p.x, p.y);
          p.remove = true;
        }
        break;

      case "shell":
        p.x += p.xSpd;
        p.y += p.ySpd;
        p.ySpd += 1;
        if (this.hitTest(p)) p.remove = true;
        break;

      case "spark":
        p.x += p.xSpd;
        p.y += p.ySpd;
        p.ySpd += 0.5;
        if (!p.hitCount && this.hitTest(p)) {
          p.xSpd *= 3;
          p.y -= p.ySpd;
          p.ySpd *= -UT.rand(0.2, 0.5);
          p.hitCount = 1;
        }
        if (p.hitCount) {
          p.hitCount++;
          if (p.hitCount === SPLASH_LIFE) p.remove = true;
        }
        break;

      case "leaf":
        // The rotation drives the sideways flutter as well as the sprite.
        p.rotation += 5;
        p.x += xMoveToRot(p.rotation, 2) + p.xSpd;
        p.y += p.ySpd;
        if (p.fc >= (p.extra.hitframe ?? 0) && this.hitTest(p)) p.remove = true;
        break;

      case "raise":
        p.x += p.xSpd;
        p.y -= p.ySpd;
        if (p.fc === RAISE_LIFE) p.remove = true;
        break;

      case "fish":
        p.extra.rot1! += 0.4;
        p.extra.rot2! += 2;
        p.x += xMoveToRot(p.extra.rot1!, 1);
        p.y += yMoveToRot(p.extra.rot2!, 0.1);
        // Frame 1 swims right, frame 2 left.
        p.frame = xMoveToRot(p.extra.rot1!, 1) > 0 ? 1 : 2;
        break;
    }
  }

  private draw(): void {
    const g = this.view;
    g.clear();
    for (const p of this.ps) {
      switch (p.behave) {
        case "fairy":
          g.circle(p.x, p.y, 3).fill({ color: 0xd8ffa0, alpha: 0.28 });
          g.circle(p.x, p.y, 1.2).fill({ color: 0xf6ffd8, alpha: 0.95 });
          break;
        case "raise":
          // Fades as it climbs, so a column thins out rather than cutting off.
          g.circle(p.x, p.y, 1.6).fill({
            color: 0xcfe6ff,
            alpha: 0.5 * (1 - p.fc / RAISE_LIFE),
          });
          break;
        case "water":
          if (p.hitCount) {
            const t = p.hitCount / SPLASH_LIFE;
            g.circle(p.x, p.y, 1 + t * 4).stroke({
              color: 0xbfe4ff, width: 1, alpha: 0.5 * (1 - t),
            });
          } else {
            g.ellipse(p.x, p.y, 1, 2).fill({ color: 0xbfe4ff, alpha: 0.75 });
          }
          break;
        case "snow":
          g.circle(p.x, p.y, 1.6).fill({ color: 0xffffff, alpha: 0.85 });
          break;
        case "spark":
          if (p.hitCount) {
            const t = p.hitCount / SPLASH_LIFE;
            g.circle(p.x, p.y, 1.4).fill({ color: 0xff8a3d, alpha: 0.8 * (1 - t) });
          } else {
            g.circle(p.x, p.y, 1.2).fill({ color: 0xffc46b, alpha: 0.95 });
          }
          break;
        case "shell":
          g.rect(p.x - 1, p.y - 2, 2, 4).fill({ color: 0xd8b45a, alpha: 0.9 });
          break;
        case "leaf": {
          const c = Math.cos((p.rotation * Math.PI) / 180) * 3;
          g.ellipse(p.x, p.y, Math.max(0.6, Math.abs(c)), 2)
            .fill({ color: 0x5e8f3a, alpha: 0.9 });
          break;
        }
        case "fish": {
          const dir = p.frame === 1 ? 1 : -1;
          g.moveTo(p.x - 4 * dir, p.y - 1.5)
            .lineTo(p.x + 4 * dir, p.y)
            .lineTo(p.x - 4 * dir, p.y + 1.5)
            .fill({ color: 0x2b4a5e, alpha: 0.75 });
          break;
        }
      }
    }
  }

  destroy(): void {
    this.view.destroy();
  }
}

/** `Game.onScreen(x, y, buffer)`. */
function onScreen(
  x: number,
  y: number,
  cam: { x: number; y: number },
  margin: number,
): boolean {
  const sx = x + cam.x;
  const sy = y + cam.y;
  return (
    sx > -margin && sx < GAME_WIDTH + margin &&
    sy > -margin && sy < GAME_HEIGHT + margin
  );
}
