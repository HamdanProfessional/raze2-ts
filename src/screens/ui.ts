import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { Texture } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, onStageResize } from "../core/Config";
import { UiArt } from "../assets/UiArt";
import { Tween, Ease } from "../core/Tween";
import { FONT_HEADER, C_LABEL, C_BTN_OUTLINE, A_LABEL } from "../ui/raze2";

/** How far a button grows under the cursor, and how long the growth takes. */
const HOVER_SCALE = 1.05;
const HOVER_MS = 110;

/**
 * Shared front-end widgets used by the Title / Menu / Play screens: a
 * full-frame background sprite (with a solid-colour fallback) and a styled,
 * hover-aware button. Kept deliberately small — Pixi v8 primitives only.
 *
 * Buttons prefer the original SWF button art (a translucent pill lifted from
 * DefineButton2_1315: neutral when idle, gold on hover, dark when pressed) and
 * fall back to a drawn rounded rectangle when the textures are unavailable.
 */

/**
 * Size `owner` to the whole window now and on every stage resize, until it is
 * destroyed.
 *
 * Screens are rebuilt when the window changes shape, but that is debounced to
 * the end of a drag; keeping the backdrop live means the empty edges never
 * flash through while the drag is in progress.
 */
function bleedToStage(owner: Container, fit: (w: number, h: number) => void): void {
  const apply = () => fit(GAME_WIDTH, GAME_HEIGHT);
  apply();
  const off = onStageResize(apply);
  owner.on("destroyed", off);
}

/** Full-frame background: the texture stretched over the stage, or a solid panel. */
export function makeBackground(tex: Texture | null, fallback = 0x0d1014): Container {
  const c = new Container();
  if (tex) {
    const s = new Sprite(tex);
    c.addChild(s);
    bleedToStage(c, (w, h) => {
      s.width = w;
      s.height = h;
    });
  } else {
    const g = new Graphics();
    c.addChild(g);
    bleedToStage(c, (w, h) => {
      g.clear();
      g.rect(0, 0, w, h).fill({ color: fallback });
    });
  }
  return c;
}

/**
 * A flat wash over the whole window, used to knock a backdrop back so the
 * chrome on top of it stays readable.
 */
export function makeScrim(color: number, alpha: number): Graphics {
  const g = new Graphics();
  bleedToStage(g, (w, h) => {
    g.clear();
    g.rect(0, 0, w, h).fill({ color, alpha });
  });
  return g;
}

/** A semi-transparent rounded panel to sit behind text for legibility. */
export function makePanel(
  x: number,
  y: number,
  w: number,
  h: number,
  color = 0x000000,
  alpha = 0.45,
): Graphics {
  const g = new Graphics();
  g.roundRect(0, 0, w, h, 10).fill({ color, alpha });
  g.x = x;
  g.y = y;
  return g;
}

export interface ButtonOpts {
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: number;
  base?: number;
  hover?: number;
}

/** The three SWF button state textures, or null when art has not loaded. */
function buttonTextures(): { up: Texture; over: Texture; down: Texture } | null {
  const up = UiArt.getTexture("btn_up");
  const over = UiArt.getTexture("btn_over");
  const down = UiArt.getTexture("btn_down");
  if (up && over && down) return { up, over, down };
  return null;
}

/**
 * A clickable button: prefers the original SWF button art (up/over/down states
 * swapped on pointer events) with a centred text-label overlay, and falls back
 * to a drawn rounded rectangle when the art is unavailable. Returns a Container
 * positioned by its centre at (x, y).
 */
export function makeButton(
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): Container {
  const w = opts.width ?? 220;
  const h = opts.height ?? 52;

  const c = new Container();
  c.x = x;
  c.y = y;
  c.pivot.set(w / 2, h / 2);

  const tex = buttonTextures();
  if (tex) {
    // Real SWF art stretched to the requested size (the source pill has a very
    // small corner radius, so a straight scale reads cleanly).
    const bg = new Sprite(tex.up);
    bg.width = w;
    bg.height = h;
    c.addChild(bg);

    let hovering = false;
    const apply = (pressed: boolean) => {
      bg.texture = pressed ? tex.down : hovering ? tex.over : tex.up;
    };
    c.on("pointerover", () => {
      hovering = true;
      apply(false);
    });
    c.on("pointerout", () => {
      hovering = false;
      apply(false);
    });
    c.on("pointerdown", () => apply(true));
    c.on("pointerup", () => apply(false));
    c.on("pointerupoutside", () => {
      hovering = false;
      apply(false);
    });
  } else {
    // Drawn fallback styled to resemble the SWF pill.
    const base = opts.base ?? 0x1b2129;
    const hover = opts.hover ?? 0x2a333f;
    const bg = new Graphics();
    const paint = (color: number) => {
      bg.clear();
      bg.roundRect(0, 0, w, h, 8).fill({ color, alpha: 0.92 });
      bg.roundRect(0, 0, w, h, 8).stroke({ color: C_BTN_OUTLINE, width: 1.5, alpha: 0.5 });
    };
    paint(base);
    c.addChild(bg);
    c.on("pointerover", () => paint(hover));
    c.on("pointerout", () => paint(base));
  }

  const t = new Text({
    text: label,
    style: new TextStyle({
      fill: opts.fill ?? C_LABEL,
      fontFamily: FONT_HEADER,
      fontSize: opts.fontSize ?? 20,
      fontWeight: "700",
      letterSpacing: 1,
    }),
  });
  t.anchor.set(0.5);
  t.x = w / 2;
  t.y = h / 2;
  c.addChild(t);

  c.eventMode = "static";
  c.cursor = "pointer";
  c.on("pointertap", onClick);

  // Hover growth, on top of whatever the art/fallback path does with colour.
  // The container is pivoted at its centre, so scaling grows it symmetrically
  // in place rather than pushing it down and to the right.
  const scaleTo = (target: number) => {
    const from = c.scale.x;
    if (from === target) return;
    Tween.to(
      HOVER_MS,
      (t) => c.scale.set(from + (target - from) * t),
      { ease: Ease.outBack },
    );
  };
  c.on("pointerover", () => scaleTo(HOVER_SCALE));
  c.on("pointerout", () => scaleTo(1));
  c.on("pointerupoutside", () => scaleTo(1));

  // Expose the label so callers can update toggle text.
  (c as Container & { btnText: Text }).btnText = t;
  return c;
}

/**
 * Explicit image-button constructor. Identical to makeButton (which already
 * prefers the SWF art) but named for callers that want to make the intent
 * clear; kept as a thin wrapper so both entry points stay in sync.
 */
export function makeImageButton(
  x: number,
  y: number,
  label: string,
  onClick: () => void,
  opts: ButtonOpts = {},
): Container {
  return makeButton(x, y, label, onClick, opts);
}

/**
 * Full-screen dim with a centred label, and it swallows input. Covers the beat
 * between "go" and the match while `preloadLevel` fetches the chosen map's
 * backdrop and collision mask — the only assets no longer held from boot.
 */
export function makeVeil(label: string): Container {
  const c = new Container();
  const g = new Graphics();
  c.addChild(g);

  const t = new Text({
    text: label,
    style: new TextStyle({
      fill: C_LABEL,
      fontFamily: FONT_HEADER,
      fontSize: 22,
      fontWeight: "700",
      letterSpacing: 3,
    }),
  });
  t.alpha = A_LABEL;
  t.anchor.set(0.5);
  c.addChild(t);

  bleedToStage(c, (w, h) => {
    g.clear();
    g.rect(0, 0, w, h).fill({ color: 0x05080b, alpha: 0.85 });
    t.position.set(w / 2, h / 2);
  });

  c.eventMode = "static";
  return c;
}

/** Set the text of a button created by makeButton. */
export function setButtonLabel(btn: Container, text: string): void {
  const t = (btn as Container & { btnText?: Text }).btnText;
  if (t) t.text = text;
}
