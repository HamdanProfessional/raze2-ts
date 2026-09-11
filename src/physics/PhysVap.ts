import { BlurFilter, Container, Matrix, RenderTexture, Sprite, Texture } from "pixi.js";
import type { Renderer } from "pixi.js";
import { PTM, GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { UT } from "../core/UT";
import { Quality } from "../state/Quality";
import type { RdActor } from "./RdActor";

/**
 * Ragdoll evaporation. Ported from `PhysVap.as` + `Pixel.as`.
 *
 * A corpse does not simply disappear in Raze 2: at four seconds
 * (`PhysActor.EnterFrame`, `fc == 4 * 30`) it is handed to the vaporiser, which
 * rasterises the whole ragdoll into one 100x100 bitmap, throws the bodies away,
 * and then lifts the silhouette off the ground forty pixels at a time until
 * nothing is left. The bitmap carries a `GlowFilter(0xFF6600, ...)`, so what you
 * actually see is the corpse coming apart into a rising orange ember cloud.
 *
 * Faithful details worth keeping in mind:
 *  - There is exactly one 100x100 canvas, so only one corpse vaporises at a
 *    time. Everything else queues, and anything in the queue that leaves the
 *    screen is destroyed outright with no effect.
 *  - The capture is anchored on the torso: the clip sits at
 *    `(rdBody.x - 50, rdBody.y - 50)`, which is also why a corpse sprawled
 *    wider than 100px gets its extremities clipped off. That is the original's
 *    behaviour, not a porting bug.
 *  - Each pixel rises at `rand(2,7)` px/frame and stops after `rand(5,30)` px,
 *    so the cloud thins from the bottom rather than drifting away as a sheet.
 *  - With the effect switched off (`SD.graphRagev`), the corpse is destroyed on
 *    the spot — the four-second lifetime is the same either way.
 *
 * Pixi v8 ships no `GlowFilter`, so the glow follows the convention the effect
 * ports already use: a second, blurred, orange-tinted copy of the same texture
 * drawn underneath the sharp one. With glow off the blur is dropped, and the
 * tinted copy ends up exactly occluded by the copy on top of it.
 */

/** Side of the capture bitmap, in px. `PhysVap` hard-codes 100. */
const SIZE = 100;
const HALF = SIZE / 2;
/** Pixels that lift off per frame. */
const LEAVE_PER_FRAME = 40;
/** Once the sheet is gone, the last few stragglers are not worth waiting for. */
const DONE_LEAVERS = 20;
const GLOW_COLOR = 0xff6600;
/** `GlowFilter(16737792, 1, 4, 4, 1)` — the 4px blur, as a Pixi blur strength. */
const GLOW_BLUR = 4;
/** Queued corpses this far outside the view are dropped without the effect. */
const OFFSCREEN_MARGIN = 100;

/** One lifted-off pixel of the corpse. Ported from `Pixel.as`. */
interface VapPixel {
  x: number;
  y: number;
  /** Packed RGBA, in the byte order the canvas buffer uses. */
  col: number;
  /** Distance risen so far (negative is up). */
  ymov: number;
  /** How far this pixel rises before it is dropped. */
  ymax: number;
  /** Rise per frame. */
  yspd: number;
}

export class PhysVap {
  /** Holds the glow copy and the sharp copy, positioned over the corpse. */
  readonly view = new Container();

  /** Corpses waiting their turn. Only ever one is vaporising. */
  private queue: RdActor[] = [];
  private target: RdActor | null = null;

  /** Still lying in place, waiting to be picked. */
  private pixels: VapPixel[] = [];
  /** Lifted off, on their way up. */
  private leavers: VapPixel[] = [];

  /** Supplied by `Phys` once the screen is up; null in a headless run. */
  renderer: Renderer | null = null;

  // Rendering. All of it is optional so a headless run (no `document`, no
  // renderer) still drives the simulation.
  private ctx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  /** 32-bit view over `img.data`, so a pixel is one store instead of four. */
  private buf: Uint32Array | null = null;
  private texture: Texture | null = null;
  private glowSprite: Sprite | null = null;
  private blur: BlurFilter | null = null;
  private capture: RenderTexture | null = null;
  private readonly xf = new Matrix();

  constructor() {
    this.view.visible = false;
    if (typeof document === "undefined") return;

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) return;

    this.ctx = ctx;
    this.img = ctx.createImageData(SIZE, SIZE);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.texture = Texture.from(canvas);

    // Glow underneath, sharp copy on top — see the class doc.
    this.glowSprite = new Sprite(this.texture);
    this.glowSprite.tint = GLOW_COLOR;
    this.blur = new BlurFilter({ strength: GLOW_BLUR, quality: 2 });
    this.view.addChild(this.glowSprite);
    this.view.addChild(new Sprite(this.texture));
  }

  // --- queueing ----------------------------------------------------------

  /** Hand a corpse over. It vaporises now if nothing else is. */
  vaporize(actor: RdActor): void {
    this.queue.push(actor);
    if (!this.target) this.doVaporize();
  }

  /**
   * Take the next corpse: rasterise it, harvest its pixels, drop its bodies.
   *
   * With the effect off (or with nothing able to render it) the corpse is just
   * destroyed, which is what `SD.graphRagev == 0` does in the original.
   */
  private doVaporize(): void {
    const actor = this.queue.shift();
    if (!actor) return;

    if (!Quality.ragev || !this.grab(actor)) {
      actor.destroy();
      this.target = null;
      this.view.visible = false;
      if (this.queue.length) this.doVaporize();
      return;
    }

    this.target = actor;
    actor.destroy();
  }

  /**
   * Rasterise the ragdoll into the capture texture and read it back as a pixel
   * list. Returns false when there is nothing to render with.
   *
   * Each part gets a matrix built from its own position and rotation, which is
   * what the original does per limb in `PhysVap.doVaporize`. Both shortcuts are
   * wrong here: a container rendered as a render root has its own x/y/rotation
   * ignored (so the bare translate stacks all fourteen limbs in the corner),
   * and `Container.localTransform` is a cache Pixi only rebuilds during its own
   * render pass, so mid-tick it still holds the previous frame's pose.
   */
  private grab(actor: RdActor): boolean {
    const renderer = this.renderer;
    if (!renderer || !this.buf || !this.texture) return false;

    const c = actor.part_body.getPosition();
    const originX = c.x * PTM - HALF;
    const originY = c.y * PTM - HALF;

    this.capture ??= RenderTexture.create({ width: SIZE, height: SIZE, antialias: false });

    let clear = true;
    for (const part of actor.allParts) {
      const view = part.getUserData() as Container | null;
      if (!view) continue;
      // Pixi's scale/rotate/translate each post-multiply, so this composes to
      // translate . rotate . scale — the limb's own pose, then the shift that
      // puts the torso at the middle of the bitmap.
      this.xf.identity();
      this.xf.scale(view.scale.x, view.scale.y);
      this.xf.rotate(view.rotation);
      this.xf.translate(view.x - originX, view.y - originY);
      renderer.render({ container: view, target: this.capture, transform: this.xf, clear });
      clear = false;
    }
    if (clear) return false; // nothing was drawable

    const out = renderer.extract.pixels(this.capture);
    const data: Uint8ClampedArray = (out as any).pixels ?? (out as any);
    const src = new Uint32Array(data.buffer, data.byteOffset, (data.byteLength / 4) | 0);
    if (!this.harvest(src)) return false;

    this.view.x = originX;
    this.view.y = originY;
    this.view.visible = true;
    if (this.blur && this.glowSprite) {
      this.glowSprite.filters = Quality.glow ? [this.blur] : [];
    }
    return true;
  }

  /**
   * Turn a captured SIZE x SIZE ARGB buffer into the pixel list. Every
   * non-zero texel becomes one ember with its own rise speed and ceiling, as
   * in `Pixel.as`. Returns false when the capture came back empty.
   */
  private harvest(src: Uint32Array): boolean {
    this.pixels = [];
    this.leavers = [];
    for (let i = 0; i < src.length; i++) {
      const col = src[i];
      if (!col) continue;
      this.pixels.push({
        x: i % SIZE,
        y: (i / SIZE) | 0,
        col,
        ymov: 0,
        ymax: UT.rand(5, 30),
        yspd: UT.rand(2, 7),
      });
    }
    return this.pixels.length > 0;
  }

  // --- per-frame ---------------------------------------------------------

  /**
   * Lift the next batch off, advance everything already in the air, and redraw.
   * Also culls queued corpses that have drifted off screen.
   */
  enterFrame(arena?: { x: number; y: number } | null): void {
    if (this.target) {
      for (let i = 0; i < LEAVE_PER_FRAME && this.pixels.length; i++) {
        this.leavers.push(this.pixels.splice(UT.irand(0, this.pixels.length - 1), 1)[0]);
      }
      for (let i = 0; i < this.leavers.length; i++) {
        const p = this.leavers[i];
        p.ymov -= p.yspd;
        if (p.ymov < -p.ymax) {
          this.leavers.splice(i, 1);
          i--;
        }
      }
      this.draw();
      if (!this.pixels.length && this.leavers.length < DONE_LEAVERS) this.doneVap();
    }

    // A corpse queued behind a long evaporation may well have left the screen
    // by the time its turn comes; the original drops those silently.
    if (arena) {
      for (let i = 0; i < this.queue.length; i++) {
        const actor = this.queue[i];
        const p = actor.part_body.getPosition();
        if (!onScreen(p.x * PTM, p.y * PTM, arena, OFFSCREEN_MARGIN)) {
          actor.destroy();
          this.queue.splice(i, 1);
          i--;
        }
      }
    }
  }

  /** Repaint the bitmap: the sheet still on the ground, then the risers. */
  private draw(): void {
    const buf = this.buf;
    if (!buf || !this.ctx || !this.img || !this.texture) return;
    buf.fill(0);
    for (const p of this.pixels) buf[p.y * SIZE + p.x] = p.col;
    for (const p of this.leavers) {
      // A pixel that has risen past the top of the bitmap simply stops being
      // drawn — `setPixel32` outside the bitmap is a no-op in Flash too.
      const y = Math.trunc(p.y + p.ymov);
      if (y < 0 || y >= SIZE) continue;
      buf[y * SIZE + p.x] = p.col;
    }
    this.ctx.putImageData(this.img, 0, 0);
    this.texture.source.update();
  }

  /** Clear down and start on whatever is next in the queue. */
  private doneVap(): void {
    this.target = null;
    this.pixels = [];
    this.leavers = [];
    this.buf?.fill(0);
    this.view.visible = false;
    if (this.queue.length) this.doVaporize();
  }

  destroy(): void {
    this.capture?.destroy(true);
    this.capture = null;
    this.texture?.destroy(true);
    this.texture = null;
  }
}

/** `Game.onScreen` — is this world point within `margin` of the view? */
function onScreen(
  x: number,
  y: number,
  arena: { x: number; y: number },
  margin: number,
): boolean {
  const sx = x + arena.x;
  const sy = y + arena.y;
  return (
    sx > -margin && sx < GAME_WIDTH + margin && sy > -margin && sy < GAME_HEIGHT + margin
  );
}
