import { Container, Graphics } from "pixi.js";
import {
  C_PANEL_CENTER,
  C_PANEL_EDGE,
  C_PANEL_HAIRLINE,
  C_ACCENT_BAR,
} from "./palette";

/**
 * Raze 2 standard panel: the dark-glass slab used behind every restyled chrome
 * surface (Pause menu, Options, Scores, dialog boxes). Generalises the HUD's
 * `panel()` look into a reusable component.
 *
 * Faithful to the SWF panel (char 1448): a radial dark-glass gradient
 * `#2B2B2B` centre → `#000000` edge, a 1px border, plus the kit's shared
 * top-accent rule and clipped corner ticks. The gradient is approximated with
 * layered flat rects because the project's headless Graphics stub only supports
 * rect/roundRect/circle/moveTo/lineTo/fill/stroke (no gradient fills).
 */
export interface Raze2PanelOpts {
  /** Overall panel opacity (the glass). Default 0.88. */
  alpha?: number;
  /** Colour of the 2px top accent rule. Default teal-green. Pass `null` off. */
  accent?: number | null;
  /** Draw the four L-shaped corner ticks. Default true. */
  corners?: boolean;
  /** Corner radius. Default 0 (the SWF panels are hard-cornered). */
  radius?: number;
}

/**
 * Draw the panel chrome into an existing Graphics at (x, y, w, h). Use this
 * when you already own a Graphics and want to compose the look inline (mirrors
 * `HudComponents.panel`). Prefer the {@link Raze2Panel} class for a standalone,
 * repositionable component.
 */
export function drawRaze2Panel(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: Raze2PanelOpts = {},
): void {
  const alpha = opts.alpha ?? 0.88;
  const accent = opts.accent === undefined ? C_ACCENT_BAR : opts.accent;
  const r = opts.radius ?? 0;

  // Base slab — near-black edge colour across the whole box (the gradient's
  // outer stop).
  if (r > 0) g.roundRect(x, y, w, h, r).fill({ color: C_PANEL_EDGE, alpha });
  else g.rect(x, y, w, h).fill({ color: C_PANEL_EDGE, alpha });

  // Centre glow — an inset lighter rect approximating the radial `#2B2B2B`
  // centre stop; fades toward the edges via alpha.
  const inset = Math.min(w, h) * 0.12;
  g.rect(x + inset, y + inset, w - inset * 2, h - inset * 2).fill({
    color: C_PANEL_CENTER,
    alpha: alpha * 0.5,
  });

  // Hairline border.
  if (r > 0) {
    g.roundRect(x, y, w, h, r).stroke({ color: C_PANEL_HAIRLINE, width: 1, alpha: 0.9 });
  } else {
    g.rect(x, y, w, h).stroke({ color: C_PANEL_HAIRLINE, width: 1, alpha: 0.9 });
  }

  // Top accent rule.
  if (accent !== null) {
    g.rect(x, y, w, 2).fill({ color: accent, alpha: 0.9 });
  }

  // Corner ticks.
  if (opts.corners !== false) {
    const t = 8;
    const col = accent ?? C_PANEL_HAIRLINE;
    g.moveTo(x, y + t).lineTo(x, y).lineTo(x + t, y)
      .moveTo(x + w - t, y).lineTo(x + w, y).lineTo(x + w, y + t)
      .moveTo(x, y + h - t).lineTo(x, y + h).lineTo(x + t, y + h)
      .moveTo(x + w - t, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - t)
      .stroke({ color: col, width: 1.5, alpha: 0.7 });
  }
}

/**
 * A standalone Raze 2 panel component. Draws the dark-glass slab at (0,0) in
 * its own container; position it via `view.x` / `view.y`.
 */
export class Raze2Panel {
  readonly view = new Container();
  private g = new Graphics();
  private w: number;
  private h: number;
  private opts: Raze2PanelOpts;

  constructor(width: number, height: number, opts: Raze2PanelOpts = {}) {
    this.w = width;
    this.h = height;
    this.opts = opts;
    this.view.addChild(this.g);
    this.redraw();
  }

  /** Resize the panel and repaint. */
  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    this.redraw();
  }

  private redraw(): void {
    this.g.clear();
    drawRaze2Panel(this.g, 0, 0, this.w, this.h, this.opts);
  }
}
