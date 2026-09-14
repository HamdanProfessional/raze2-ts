import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { UiArt } from "../../assets/UiArt";
import { FONT_HEADER } from "./fonts";
import { C_LABEL, C_LABEL_ON, C_BTN_OUTLINE } from "./palette";

export interface Raze2ButtonOpts {
  /** Button width in px. Default 240 (matches the menu button bar). */
  width?: number;
  /** Button height in px. Default 32 (the ~26.5px source bar + a little pad). */
  height?: number;
  /**
   * Label point size, in the same units as `width`/`height`. Default
   * {@link LABEL_SIZE}, which is sized for a bar drawn at screen scale; a
   * caller that renders the bar at the SWF's own 245x28 (and scales the view
   * instead) wants the source's ~14, or the label comes out a third too big.
   */
  fontSize?: number;
  /** Mirror variant: gradient fades from the RIGHT and the label is right-
   *  anchored (source `MenuButtonReverse_37`). Used for right-aligned rows. */
  reverse?: boolean;
  /** Retained for call-site compatibility; the authentic button has no accent
   *  bar, so this is ignored. */
  accent?: number;
  /** Click handler. Wired to `pointertap`; suppressed while disabled. */
  onClick?: () => void;
}

const DEFAULT_W = 240;
const DEFAULT_H = 32;
const LABEL_SIZE = 18; // BlairMdITC, sized to the ~26.5px bar (doc 08 §2.4).
const LABEL_MIN_SIZE = 10; // Below this the small-caps label stops being legible.
const LABEL_PAD = 14; // Inset from the leading edge on a full-width bar.
const LABEL_ALPHA = 204 / 255; // ~0.8, both idle and hover (doc 08 §2.5).
const OUTLINE_ALPHA = 0.2;
const BANDS = 24; // stepped approximation of the source's linear gradient.

/**
 * The authentic Raze 2 menu button (`MenuButton_34` / `DefineSprite_482`,
 * doc 08 §2.4).
 *
 * A ~240×26.5px horizontal bar with a left-heavy BLACK gradient (alpha
 * 0.6 → 0.4 → 0.0 across its width) and a white label. A constant 1.5px mint
 * (`#66CC99`) hairline at ~0.2 alpha outlines it in every state. The `reverse`
 * variant fades from the right for right-aligned rows.
 *
 * **The dark↔light polarity swap belongs to `on`, not `over`.** Measured off
 * the baked frames: `btn_menu_up` and `btn_menu_over` are both black bars (mean
 * RGB 7), and only `btn_menu_on` — frame 6, the selected state — is white (237).
 * Hover brightens the bar's own gradient and nothing else, so the label stays
 * white through it; it was flipping to black over a still-black bar, which made
 * the label vanish under the cursor. Only `on` gets the dark label.
 *
 * The source's linear gradient is approximated with stepped vertical bands so
 * the button renders identically under the headless test stub (no gradient
 * fills). Interaction is a small pointer state machine rather than the SWF's
 * frame-label morph.
 */
export class Raze2Button {
  readonly view = new Container();

  private bg = new Graphics();
  /** Baked SWF skins (up/over/on), shown in place of the Graphics fallback. */
  private bgTex = new Sprite();
  private label: Text;
  private w: number;
  private h: number;
  private labelSize: number;
  private reverse: boolean;
  private onClick?: () => void;

  private text: string;
  private hovering = false;
  private selected = false;
  private enabled = true;

  constructor(label: string, opts: Raze2ButtonOpts = {}) {
    this.w = opts.width ?? DEFAULT_W;
    this.h = opts.height ?? DEFAULT_H;
    this.labelSize = opts.fontSize ?? LABEL_SIZE;
    this.reverse = opts.reverse ?? false;
    this.onClick = opts.onClick;
    this.text = label;

    this.view.addChild(this.bg);
    this.bgTex.anchor.set(0, 0);
    this.view.addChild(this.bgTex);

    this.label = new Text({
      text: label.toUpperCase(),
      style: new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_HEADER,
        fontSize: this.labelSize,
        fontWeight: "700",
        letterSpacing: 1.5,
      }),
    });
    // Narrow buttons (tile actions, the 7-up sub-tab row) can't spare the full
    // bar inset, so the pad tracks the width rather than eating half of it.
    const pad = Math.min(LABEL_PAD, Math.round(this.w * 0.09));
    this.label.anchor.set(this.reverse ? 1 : 0, 0.5);
    this.label.x = this.reverse ? this.w - pad : pad;
    this.label.y = this.h / 2;
    this.view.addChild(this.label);
    this.fitLabel();

    this.view.eventMode = "static";
    this.view.cursor = "pointer";
    this.view.on("pointerover", () => {
      this.hovering = true;
      this.redraw();
    });
    this.view.on("pointerout", () => {
      this.hovering = false;
      this.redraw();
    });
    this.view.on("pointertap", () => {
      if (this.enabled) this.onClick?.();
    });

    this.redraw();
  }

  /** Mark this as the current/selected item. Renders like the hover invert
   *  (white bar) but with a pale-yellow label so the active row still reads. */
  setSelected(selected: boolean): void {
    this.selected = selected;
    this.redraw();
  }

  /** Enable/disable. Disabled buttons dim and ignore pointer taps. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.view.eventMode = enabled ? "static" : "none";
    this.view.cursor = enabled ? "pointer" : "default";
    this.redraw();
  }

  /** Change the label text (re-uppercased for the small-caps look). */
  setLabel(label: string): void {
    this.text = label;
    this.label.text = label.toUpperCase();
    this.fitLabel();
    this.redraw();
  }

  /** Shrink a too-long label so it stays inside the bar. Tracking goes first —
   *  it costs the least — then the point size, down to a legibility floor. */
  private fitLabel(): void {
    const max = this.w - Math.min(LABEL_PAD, Math.round(this.w * 0.09)) * 2;
    const style = this.label.style;
    style.fontSize = this.labelSize;
    style.letterSpacing = 1.5;
    if (this.label.width <= max) return;

    style.letterSpacing = 0;
    if (this.label.width <= max) return;

    const size = Math.max(LABEL_MIN_SIZE, Math.floor(this.labelSize * (max / this.label.width)));
    style.fontSize = size;
  }

  /** The current label text, as originally supplied. */
  getLabel(): string {
    return this.text;
  }

  /** Alpha of the gradient at fractional position `t` (0 = left … 1 = right),
   *  matching the source stops 0.6 / 0.4 (@0.66) / 0.0 (@1.0). */
  private gradientAlpha(t: number): number {
    const f = this.reverse ? 1 - t : t;
    if (f <= 0.66) return 0.6 + (0.4 - 0.6) * (f / 0.66);
    return 0.4 + (0.0 - 0.4) * ((f - 0.66) / 0.34);
  }

  private redraw(): void {
    // Prefer the baked SWF skin when the rig is loaded; the original up/over/on
    // frames already carry the bar gradient, outline and polarity swap.
    const prefix = this.reverse ? "btn_menu_rev" : "btn_menu";
    const state = this.selected ? "on" : this.hovering ? "over" : "up";
    const tex = UiArt.r2(`${prefix}_${state}`) ?? UiArt.r2(`${prefix}_up`);
    if (tex) {
      this.bg.visible = false;
      this.bgTex.visible = true;
      this.bgTex.texture = tex;
      this.bgTex.width = this.w;
      this.bgTex.height = this.h;
      this.bgTex.alpha = this.enabled ? 1 : 0.5;
      const style = this.label.style;
      style.fill = this.selected && this.enabled ? C_LABEL_ON : C_LABEL;
      this.label.alpha = this.enabled ? LABEL_ALPHA : LABEL_ALPHA * 0.5;
      return;
    }

    const g = this.bg;
    this.bg.visible = true;
    this.bgTex.visible = false;
    const { w, h } = this;
    g.clear();

    // Only `selected` inverts to the white bar (see the class note); hover just
    // lifts the black gradient so the fallback tracks the baked frames.
    const lit = this.selected && this.enabled;
    const barColor = lit ? 0xffffff : 0x000000;
    const dim = (this.enabled ? 1 : 0.5) * (this.hovering && this.enabled && !lit ? 0.7 : 1);

    // Stepped left-heavy gradient bar (black idle → white on hover).
    const bw = w / BANDS;
    for (let i = 0; i < BANDS; i++) {
      const t = (i + 0.5) / BANDS;
      const a = this.gradientAlpha(t) * dim;
      if (a <= 0.01) continue;
      g.rect(i * bw, 0, Math.ceil(bw) + 1, h).fill({ color: barColor, alpha: a });
    }

    // Constant mint hairline outline in every state.
    g.rect(0, 0, w, h).stroke({ color: C_BTN_OUTLINE, width: 1.5, alpha: OUTLINE_ALPHA * dim });

    // Label colour flips with the bar polarity — dark only over the white bar.
    const style = this.label.style;
    style.fill = lit ? C_LABEL_ON : C_LABEL;
    this.label.alpha = this.enabled ? LABEL_ALPHA : LABEL_ALPHA * 0.5;
  }
}
