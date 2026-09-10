import { Container, Text, TextStyle } from "pixi.js";
import { FONT_VALUE } from "./fonts";
import { C_OPTIONS_GREEN, C_DIM, C_HOVER } from "./palette";

export interface Raze2ToggleOpts {
  /** Label font size in px. Default 15 (QTypeSquare value-field size). */
  fontSize?: number;
  /** Horizontal gap between option words in px. Default 16. */
  gap?: number;
}

/**
 * The Raze 2 Options toggle / segmented option-picker.
 *
 * Faithful to the source (doc 14 §4): the Options screen has NO switch or
 * checkbox sprite — a toggle is just two-plus plain-text words laid side by
 * side, where the active word turns teal-green (`#57DEB0`), inactive words are
 * grey (`#999999`), and an inactive word under the cursor turns white. This one
 * component covers both the binary "Off / On" toggle and multi-value pickers
 * like "Low / Medium / High".
 *
 * @example
 *   // On/Off toggle:
 *   new Raze2Toggle(["Off", "On"], sd.sound ? 1 : 0, (i) => (sd.sound = i === 1));
 *   // Quality picker:
 *   new Raze2Toggle(["Low", "Medium", "High"], q, setQuality);
 */
export class Raze2Toggle {
  readonly view = new Container();

  private labels: Text[] = [];
  private selectedIndex: number;
  private onChange: (index: number) => void;
  private hovered = -1;

  constructor(
    labels: string[],
    selectedIndex: number,
    onChange: (index: number) => void,
    opts: Raze2ToggleOpts = {},
  ) {
    this.selectedIndex = selectedIndex;
    this.onChange = onChange;

    const size = opts.fontSize ?? 15;
    const gap = opts.gap ?? 16;

    let x = 0;
    labels.forEach((word, i) => {
      const t = new Text({
        text: word,
        style: new TextStyle({
          fill: C_DIM,
          fontFamily: FONT_VALUE,
          fontSize: size,
        }),
      });
      t.x = x;
      t.y = 0;
      t.eventMode = "static";
      t.cursor = "pointer";
      t.on("pointerover", () => {
        this.hovered = i;
        this.paint();
      });
      t.on("pointerout", () => {
        if (this.hovered === i) this.hovered = -1;
        this.paint();
      });
      t.on("pointertap", () => this.select(i));
      this.view.addChild(t);
      this.labels.push(t);
      // `t.width` is undefined under the headless test stub; fall back so the
      // layout stays finite there.
      x += (t.width || word.length * size * 0.6) + gap;
    });

    this.paint();
  }

  /** Programmatically set the active option WITHOUT firing `onChange`. */
  setSelected(index: number): void {
    this.selectedIndex = index;
    this.paint();
  }

  /** The active option index. */
  getSelected(): number {
    return this.selectedIndex;
  }

  /** Click-select an option: updates state, repaints, fires `onChange`. */
  private select(index: number): void {
    if (index === this.selectedIndex) {
      // Re-affirm anyway — callers may treat a click as an explicit set.
      this.onChange(index);
      return;
    }
    this.selectedIndex = index;
    this.paint();
    this.onChange(index);
  }

  private paint(): void {
    this.labels.forEach((t, i) => {
      const style = t.style;
      if (i === this.selectedIndex) style.fill = C_OPTIONS_GREEN;
      else if (i === this.hovered) style.fill = C_HOVER;
      else style.fill = C_DIM;
    });
  }
}
