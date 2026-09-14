import { Container, Graphics, Sprite } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { UT } from "../core/UT";
import { Quality } from "../state/Quality";
import { FxArt, type FxDef } from "../assets/FxArt";
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
 * The art comes from the baked `BH` atlas (`FxArt`, entries `fairy`/`water`/
 * `ember`/`leaves`/`snow_fall`): every `Particle` paints a named clip's sub-
 * animation at a rotation rolled once per spawn, exactly as
 * `BitScreen.paint(x, y, true, name, sub, frame)` does. Only sprites with no
 * baked entry (the unused `shell`), or a headless run where the atlas has not
 * decoded, fall back to the procedural shapes.
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

/** Art clip + sub-animation per behaviour, from the `createParticle` calls in
 *  `Stats_MapParticles.as`: the fairies and both the fish and rising motes are
 *  the `fairy` clip ("fish"/"idle" subs), the sparks are `ember`, the leaves
 *  are `leaves` and the snowfall `snow_fall`. */
const ART: Record<Behave, { name: string; sub: string }> = {
  fairy: { name: "fairy", sub: "idle" },
  fish: { name: "fairy", sub: "fish" },
  water: { name: "water", sub: "idle" },
  spark: { name: "ember", sub: "idle" },
  leaf: { name: "leaves", sub: "leaf1" },
  snow: { name: "snow_fall", sub: "idle" },
  raise: { name: "fairy", sub: "idle" },
  shell: { name: "shell", sub: "idle" },
};

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
  held: boolean;

  // --- baked BH clip (BitScreen.paint's name/sub/frame) ---------------------
  artName = "";
  artSub = "idle";
  artDef: FxDef | null = null;
  /** First cell of this particle's sub-animation within a rotation's frames. */
  subBase = 0;
  /** Frames in that sub-animation, for the non-held wrap. */
  subFrames = 1;
  /** Rotation variant, rolled once here like `UT.irand(0, stats.rotAmt - 1)`. */
  rot = 0;

  constructor(
    public x: number,
    public y: number,
    public behave: Behave,
    public extra: Extra,
    /** Art variant, e.g. `leaf3`. */
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

    const art = ART[behave];
    this.artName = art.name;
    this.artSub = behave === "leaf" ? sub : art.sub;
    this.artDef = FxArt.def(this.artName);
    if (this.artDef) {
      this.rot = (Math.random() * this.artDef.rotAmt) | 0;
      const subs = this.artDef.subs;
      if (subs) {
        let base = 0;
        for (const [key, n] of Object.entries(subs)) {
          if (key === this.artSub) {
            this.subBase = base;
            this.subFrames = n;
            break;
          }
          base += n;
        }
      } else {
        this.subFrames = this.artDef.frames;
      }
    }
  }
}

export class MapParticles {
  readonly view = new Container();
  /** Procedural shapes, used only for particles with no baked entry. */
  private fallbackG = new Graphics();
  /** One pooled sprite per live particle; repositioned/retextured each frame. */
  private sprites: Sprite[] = [];
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
    this.view.addChild(this.fallbackG);
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
    // Paint before the cull: the original sets `remove` inside `EnterFrame`
    // *after* the paint call, so a droplet's final splash frame is drawn.
    this.draw();
    if (this.ps.some((p) => p.remove)) this.ps = this.ps.filter((p) => !p.remove);
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

    // `if(!holdFrame) { frame++; if(frame > stats.frames) frame = 1; }` — the
    // sub-animation loops; it never ends the particle.
    if (!p.held) {
      p.frame++;
      if (p.frame > p.subFrames) p.frame = 1;
    }
  }

  /**
   * `BitScreen.paint`'s cell selection: the sub-animation's own frames, offset
   * into this spawn's rotation block, with the splash/trail frames the water
   * and spark cases compute (`uint(hitCount / 10) + 2`).
   */
  private cellIndex(p: Particle): number {
    const def = p.artDef!;
    let frame = p.frame;
    if ((p.behave === "water" || p.behave === "spark") && p.hitCount) {
      frame = Math.trunc(p.hitCount / 10) + 2;
    }
    const local = Math.max(0, Math.min(p.subFrames - 1, frame - 1));
    return p.rot * def.frames + p.subBase + local;
  }

  private draw(): void {
    const g = this.fallbackG;
    g.clear();

    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      const idx = p.artDef ? this.cellIndex(p) : 0;
      const cell = p.artDef && FxArt.loaded ? p.artDef.cells[idx] : null;
      const tex = p.artDef && FxArt.loaded ? FxArt.cell(p.artName, idx) : null;

      let spr = this.sprites[i];
      if (!spr) {
        spr = new Sprite();
        this.sprites[i] = spr;
        this.view.addChild(spr);
      }

      if (tex && cell) {
        spr.visible = true;
        spr.texture = tex;
        spr.scale.set(1 / (p.artDef?.bakeScale ?? 1));
        // `paint(x, y, true, …)` centres the blit on (x, y); the cell's trim
        // offset puts it back against the origin the same way.
        spr.x = p.x + cell.lx;
        spr.y = p.y + cell.ly;
        // The rising motes fade as they climb, so a column thins out rather
        // than cutting off (a readability cue over the original's constant).
        spr.alpha = p.behave === "raise" ? 0.5 * (1 - p.fc / RAISE_LIFE) : 1;
      } else {
        spr.visible = false;
        this.drawProcedural(g, p);
      }
    }
    for (let i = this.ps.length; i < this.sprites.length; i++) this.sprites[i].visible = false;
  }

  /** Hand-drawn stand-ins for a run with no decoded atlas (or no baked entry). */
  private drawProcedural(g: Graphics, p: Particle): void {
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

  destroy(): void {
    this.view.destroy({ children: true });
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
