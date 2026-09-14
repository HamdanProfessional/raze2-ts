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

/**
 * Place a baked front-end screen plate (`menu_campaign`, `menu_quickmatch`,
 * `menu_armory`, `menu_achievements`, `menu_credits`...) on a screen.
 *
 * Plates are the authentic SWF screens authored on an 800x600 stage. The plate
 * is fitted to the live stage (uniform scale, centred) and a content root is
 * returned at the same transform, so callers add their interactive controls in
 * the plate's SWF coordinates as if the stage were 800x600.
 */
export interface MenuPlate {
  /** Add controls here using the original SWF coordinates. */
  root: Container;
  /** Group holding both the plate sprite and `root`; toggle/destroy this. */
  layer: Container;
  /** Plate scale (live px per SWF px). */
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function addMenuPlate(view: Container, name: string): MenuPlate | null {
  const meta = UiArt.meta(name);
  const tex = UiArt.r2(name);
  if (!meta || !tex) return null;
  const scale = Math.min(GAME_WIDTH / 800, GAME_HEIGHT / 600);
  const offsetX = Math.round((GAME_WIDTH - 800 * scale) / 2);
  const offsetY = Math.round((GAME_HEIGHT - 600 * scale) / 2);

  const layer = new Container();
  const sp = new Sprite(tex);
  sp.scale.set(scale / meta.scale);
  sp.position.set(offsetX, offsetY);
  layer.addChild(sp);

  const root = new Container();
  root.scale.set(scale);
  root.position.set(offsetX, offsetY);
  layer.addChild(root);
  view.addChild(layer);
  return { root, layer, scale, offsetX, offsetY };
}

/**
 * Screen title (`txt_title`) point size and field top, in SWF px.
 *
 * Measured off `DefineSprite_1164` frame 37: the field is placed at y 25.7 and
 * scaled 0.7183, and its glyphs are drawn at 0.0271em — 0.0271 * 1024 * 0.7183
 * = 19.93px with the baseline 19.25px below the field top.
 *
 * These go into `headerRoot`, which is **already scaled by `chrome.s`**, so
 * they are the SWF's own numbers. Scaling them by `s` a second time is what
 * made every screen title render ~40% oversized.
 */
export const TITLE_SIZE = 20;
export const TITLE_Y = 28;

/**
 * Edge-anchored screen chrome for the front-end screens.
 *
 * The port's stage is dynamic (fills the window, 1136x639 floor), so a
 * 800x600 plate would sit boxed in the middle. Instead each original screen is
 * baked as regions — a header strip, a left panel, a right panel — and placed
 * here: the header stretches across the stage, the left panel pins to the left
 * edge, the right panel to the right edge, and the background shows through
 * between them exactly as the source did over the menu backdrop. Interactive
 * content is added to the returned roots using each crop's SWF-local
 * coordinates.
 */
export interface ScreenChrome {
  /** Scale (live px per SWF px), capped so 800*scale fits the stage width. */
  s: number;
  /** Width the layout is built against — the stage, or `maxW` if it was capped. */
  stageW: number;
  stageH: number;
  /**
   * Left edge of the layout box in screen px, 0 unless `maxW` capped it.
   *
   * Everything the chrome itself builds is already inside a container shifted
   * by this. A screen that positions its own children against `stageW` — the
   * bottom-bar buttons, typically — has to add it.
   */
  ox: number;
  /** Height of the header strip in screen px. */
  headerH: number;
  leftX: number; leftY: number; leftW: number; leftH: number;
  midX: number; midY: number; midW: number; midH: number;
  rightX: number; rightY: number;
  /** Right column width in SWF units (its root's local space). */
  rightW: number; rightH: number;
  /** Top of the bottom bar band (84 SWF px above the stage bottom). */
  bottomY: number;
  leftRoot: Container;
  midRoot: Container;
  rightRoot: Container;
  headerRoot: Container;
}

export function addScreenChrome(
  view: Container,
  spec: {
    headerL?: string;
    headerR?: string;
    header?: string;
    left?: string;
    mid?: string;
    right?: string;
    /**
     * A right column that stretches to fill the stage instead of hanging off
     * the right edge: `l`/`r` are the fixed end pieces, `m` a flat 1px-tall
     * band stretched between them. `from` picks where the column starts —
     * after the left panel (default) or after the mid column.
     */
    rightStretch?: { l: string; m: string; r: string; from?: "left" | "mid" };
    /**
     * Cap the layout width at this many SWF px and centre it, instead of
     * spreading to the window edges.
     *
     * Most of these screens are columns of lists and are happy to be pulled
     * wide — a wider Options is three wider columns. The ones that want this
     * are the screens whose right column *stretches*: past the authored 800 the
     * band becomes a long empty bar, and anything pinned to its right end (the
     * Quick Match difficulty stepper, the player count) drifts hundreds of px
     * away from the controls it belongs with. Pass 800 to keep the SWF's own
     * composition and let the backdrop take the slack.
     */
    maxW?: number;
  },
): ScreenChrome {
  const s = Math.min(GAME_HEIGHT / 600, GAME_WIDTH / 800);
  const stageW = spec.maxW ? Math.min(GAME_WIDTH, spec.maxW * s) : GAME_WIDTH;
  const ox = Math.round((GAME_WIDTH - stageW) / 2);
  const stageH = GAME_HEIGHT;
  const headerH = 56 * s;
  const bottomY = stageH - 84 * s;

  // Everything below lays out in box-local coordinates; the box is what moves.
  const box = new Container();
  box.x = ox;
  view.addChild(box);
  view = box;

  const addSprite = (name: string | undefined, x: number, y: number): Sprite | null => {
    if (!name) return null;
    const meta = UiArt.meta(name);
    const tex = UiArt.r2(name);
    if (!meta || !tex) return null;
    const sp = new Sprite(tex);
    sp.scale.set(s / meta.scale);
    sp.position.set(Math.round(x), Math.round(y));
    view.addChild(sp);
    return sp;
  };

  // Header: left piece stretches, optional right piece keeps native scale.
  if (spec.header) {
    const meta = UiArt.meta(spec.header);
    const sp = addSprite(spec.header, 0, 0);
    if (sp && meta) {
      sp.width = stageW;
      sp.height = 56 * s;
    }
  } else if (spec.headerL) {
    const meta = UiArt.meta(spec.headerL);
    const sp = addSprite(spec.headerL, 0, 0);
    if (sp && meta) {
      const rightW = spec.headerR ? (UiArt.meta(spec.headerR)?.w ?? 0) * s : 0;
      sp.width = stageW - rightW;
      sp.height = 56 * s;
    }
    addSprite(spec.headerR, stageW - (UiArt.meta(spec.headerR ?? "")?.w ?? 0) * s, 0);
  }

  // Panels.
  const leftMeta = spec.left ? UiArt.meta(spec.left) : null;
  const midMeta = spec.mid ? UiArt.meta(spec.mid) : null;
  const rightMeta = !spec.rightStretch && spec.right ? UiArt.meta(spec.right) : null;
  if (leftMeta) addSprite(spec.left, 0, headerH);
  // Mid panel sits just after the left column (the source's 5px gutter).
  const midX = leftMeta ? leftMeta.w * s + 6 * s : 0;
  if (midMeta) addSprite(spec.mid, midX, headerH);
  if (rightMeta) addSprite(spec.right, stageW - rightMeta.w * s, headerH);

  // Stretchable right column: fixed ends, the flat band between them fills.
  let rightX = rightMeta ? stageW - rightMeta.w * s : stageW;
  let rightW = rightMeta?.w ?? 0;
  if (spec.rightStretch) {
    const { l, m, r } = spec.rightStretch;
    const lM = UiArt.meta(l);
    const mM = UiArt.meta(m);
    const rM = UiArt.meta(r);
    rightX = spec.rightStretch.from === "mid" ? midX + (midMeta?.w ?? 0) * s
      : leftMeta ? leftMeta.w * s : 0;
    rightW = (stageW - rightX) / s;
    addSprite(l, rightX, headerH);
    addSprite(r, stageW - (rM?.w ?? 0) * s, headerH);
    const band = addSprite(m, rightX + (lM?.w ?? 0) * s, headerH);
    if (band && mM) {
      band.width = Math.max(1, stageW - (rM?.w ?? 0) * s - rightX - (lM?.w ?? 0) * s);
      band.height = mM.h * s;
    }
  }

  const mkRoot = (x: number, y: number): Container => {
    const c = new Container();
    c.scale.set(s);
    c.position.set(Math.round(x), Math.round(y));
    view.addChild(c);
    return c;
  };

  const leftRoot = mkRoot(0, headerH);
  const midRoot = mkRoot(midX, headerH);
  const rightRoot = mkRoot(rightX, headerH);
  const headerRoot = mkRoot(0, 0);

  return {
    s, stageW, stageH, ox, headerH,
    leftX: 0, leftY: headerH,
    leftW: (leftMeta?.w ?? 0) * s, leftH: (leftMeta?.h ?? 0) * s,
    midX, midY: headerH,
    midW: (midMeta?.w ?? 0) * s, midH: (midMeta?.h ?? 0) * s,
    rightX, rightY: headerH,
    rightW,
    rightH: ((UiArt.meta(spec.right ?? spec.rightStretch?.l ?? "")?.h) ?? 0) * s,
    bottomY,
    leftRoot, midRoot, rightRoot, headerRoot,
  };
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
