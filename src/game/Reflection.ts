import { Container, Matrix, RenderTexture, Sprite } from "pixi.js";
import type { Renderer } from "pixi.js";
import { Quality } from "../state/Quality";

/**
 * The authored per-map reflection, ported from `Arena.doReflections`.
 *
 * The level author drops two clips on the map's Arena frame: `reflectTake1`
 * marks a rectangle of the world, and `reflectShow1` marks where a copy of
 * whatever is in it gets redrawn (with the author's own scale, so the copy can
 * be squashed or flipped). `Arena.doReflections` clears a BitmapData, draws
 * `unitCont`, `lineCont` and `bitscreen` into it through a translate, and shows
 * the result — so it reflects the **actors and their effects**, never the map
 * art or the backdrop.
 *
 * Here that is a `RenderTexture`: render the same layers into it each frame
 * with the take rectangle translated to the origin, and draw it back through a
 * sprite at the show transform.
 *
 * It is gated on `SD.graphLights` in the original — the port's "Lights &
 * Reflections" option, which is `Quality.glow`.
 *
 * Only `snow` ships one among the Raze 2 maps (a 781x305 window over the ice,
 * redrawn 12px to the right and 5% shorter, which reads as figures showing
 * through the sheet).
 */

export interface ReflectSpec {
  take: { x: number; y: number; w: number; h: number };
  show: { x: number; y: number; sx: number; sy: number };
}

export class Reflection {
  readonly view: Sprite;
  private tex: RenderTexture;
  private readonly xf = new Matrix();

  constructor(private spec: ReflectSpec) {
    // A render target the size of the captured window. Rounded up: a fractional
    // texture size is a wasted half-pixel row on every frame.
    this.tex = RenderTexture.create({
      width: Math.max(1, Math.ceil(spec.take.w)),
      height: Math.max(1, Math.ceil(spec.take.h)),
      antialias: false,
    });
    this.view = new Sprite(this.tex);
    this.view.x = spec.show.x;
    this.view.y = spec.show.y;
    this.view.scale.set(spec.show.sx, spec.show.sy);
    this.xf.translate(-spec.take.x, -spec.take.y);
  }

  /**
   * Re-capture. `sources` are the world-space layers to reflect, in draw order.
   * Everything is rendered through the same translate, so a unit standing in
   * the take rectangle lands at the matching spot in the texture.
   */
  update(renderer: Renderer | null | undefined, sources: Container[]): void {
    if (!renderer) return;
    // Off with the lights: leave the last frame rather than paying for a
    // capture nobody asked for. The sprite is hidden so it does not linger.
    if (!Quality.glow) {
      this.view.visible = false;
      return;
    }
    this.view.visible = true;
    let clear = true;
    for (const src of sources) {
      if (!src) continue;
      renderer.render({ container: src, target: this.tex, transform: this.xf, clear });
      clear = false;
    }
  }

  destroy(): void {
    this.view.destroy();
    this.tex.destroy(true);
  }
}
