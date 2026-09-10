import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import type { Engine } from "../core/Engine";

/**
 * A real `<input>` element floated over the WebGL canvas, positioned in the
 * game's logical coordinate space. PixiJS has no text-entry primitive, so the
 * multiplayer lobby (name / room name / join code) borrows the DOM for it.
 *
 * The canvas fills the window and is rendered at device pixels, so a logical
 * (x, y) has to be mapped through the canvas's on-screen rect each frame (the
 * rect moves on window resize). Screens call `update()` from their `enterFrame` and
 * `destroy()` from their destructor.
 */
export interface DomInputOpts {
  x: number;
  y: number;
  width: number;
  height?: number;
  placeholder?: string;
  value?: string;
  maxLength?: number;
  fontSize?: number;
  /** Border/caret accent colour (CSS colour string). Default matches the
   *  legacy dark-UI orange (`#ff5533`) so existing callers are unaffected;
   *  the Raze 2-restyled screens pass the kit's teal (`#57DEB0`) instead. */
  accent?: string;
  onEnter?: () => void;
  onInput?: (value: string) => void;
}

export class DomInput {
  readonly el: HTMLInputElement;
  private engine: Engine;
  private opts: Required<Pick<DomInputOpts, "x" | "y" | "width" | "height" | "fontSize">>;
  private destroyed = false;

  constructor(engine: Engine, opts: DomInputOpts) {
    this.engine = engine;
    this.opts = {
      x: opts.x,
      y: opts.y,
      width: opts.width,
      height: opts.height ?? 40,
      fontSize: opts.fontSize ?? 20,
    };

    const el = document.createElement("input");
    el.type = "text";
    el.value = opts.value ?? "";
    if (opts.placeholder) el.placeholder = opts.placeholder;
    if (opts.maxLength) el.maxLength = opts.maxLength;
    el.autocomplete = "off";
    el.spellcheck = false;
    Object.assign(el.style, {
      position: "fixed",
      margin: "0",
      boxSizing: "border-box",
      border: `2px solid ${opts.accent ?? "#ff5533"}`,
      borderRadius: "6px",
      background: "rgba(8,11,16,0.92)",
      color: "#ffffff",
      fontFamily: "monospace",
      outline: "none",
      textAlign: "center",
      letterSpacing: "1px",
      zIndex: "50",
    } as CSSStyleDeclaration);

    if (opts.onEnter) {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          opts.onEnter!();
        }
      });
    }
    if (opts.onInput) {
      el.addEventListener("input", () => opts.onInput!(el.value));
    }

    document.body.appendChild(el);
    this.el = el;
    this.update();
  }

  get value(): string {
    return this.el.value;
  }
  set value(v: string) {
    this.el.value = v;
  }

  focus(): void {
    // Deferred so the element is laid out before the focus takes.
    setTimeout(() => {
      if (!this.destroyed) this.el.focus();
    }, 0);
  }

  /** Reposition/scale to track the letterboxed canvas. Call each frame. */
  update(): void {
    if (this.destroyed) return;
    const canvas = (this.engine as any).app?.canvas as HTMLCanvasElement | undefined;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width / GAME_WIDTH;
    const sy = rect.height / GAME_HEIGHT;
    const { x, y, width, height, fontSize } = this.opts;
    // (x, y) is the input's centre in logical space.
    this.el.style.left = `${rect.left + (x - width / 2) * sx}px`;
    this.el.style.top = `${rect.top + (y - height / 2) * sy}px`;
    this.el.style.width = `${width * sx}px`;
    this.el.style.height = `${height * sy}px`;
    this.el.style.fontSize = `${fontSize * sy}px`;
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? "" : "none";
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.el.remove();
  }
}
