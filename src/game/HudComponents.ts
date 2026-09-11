import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, FPS } from "../core/Config";
import { teamColor } from "../ui/raze2/palette";

/**
 * Shared HUD building blocks: the palette, the panel chrome routines, the
 * monospace text helpers, and the one self-contained widget big enough to
 * deserve its own class (the directional damage indicator).
 *
 * Hud.ts owns layout and game-state binding; everything here is stateless
 * drawing or a widget that only knows about its own little box. Keeping the
 * split means the layout file stays readable at a glance.
 *
 * Every Graphics call in this module is restricted to the primitive set the
 * headless test stub implements (rect / roundRect / circle / moveTo / lineTo /
 * fill / stroke), so arcs and wedges are drawn as short polylines rather than
 * with `arc()`. That is also cheaper: an eight-segment polyline is one path.
 */

export const FONT = "Consolas, 'Courier New', monospace";

// --- palette ---------------------------------------------------------------
/** Panel fill. Near-black with a blue cast so it reads as glass, not a hole. */
export const C_PANEL = 0x0a0f15;
/** Panel border. */
export const C_PANEL_LINE = 0x2d3a47;
/** Brighter rule used for the accent bar along a panel's top edge. */
export const C_PANEL_EDGE = 0x53667a;
/** Empty portion of any bar. */
export const C_TRACK = 0x0f151b;
export const C_HP = 0x53c65a;
export const C_HP_MID = 0xe0c13a;
export const C_HP_LOW = 0xe0503a;
export const C_SHIELD = 0x4aa3ff;
export const C_TEXT = 0xe7edf3;
export const C_DIM = 0x8b98a5;
export const C_FAINT = 0x5b6773;
export const C_ACCENT = 0xffcc33;
export const C_DANGER = 0xff4b3a;
/** Win state. Pairs with {@link C_DANGER} on the match-result banner. */
export const C_VICTORY = 0x6de07a;
export const C_ICON_BOX = 0x161d25;

// --- authentic Raze 2 vitals colours (docs/raze2/14-hud-chrome.md §1.1) -----
/** Shield bar baked tint add (255,255,0) → yellow. */
export const C_SHIELD_YELLOW = 0xffff00;
/** Energy bar baked tint add (204,153,255) → lavender/purple. */
export const C_ENERGY_PURPLE = 0xcc99ff;
/** Selected weapon-slot highlight (Hud_WeaponHolder ammo-bar `colTransOn`). */
export const C_SLOT_SELECTED = 0xffff00;
/** Unselected weapon-slot ammo-bar tint (`colTransOff`). */
export const C_SLOT_UNSELECTED = 0xcccccc;
/**
 * Selected-weapon "oscilloscope" ammo-bar fill (doc 11 §2.3, `Hud.as`
 * `setAmmoBar()`). The grid-line colour (`0x333333`) is a confirmed source
 * constant; the fill itself lives on the SWF library symbol rather than in
 * ActionScript, so this bright HUD green is the doc's best-guess stand-in for
 * the "green oscilloscope/EKG-style graph" the reference screenshot shows.
 */
export const C_AMMO_GRID_GREEN = 0x33ff66;
/** Ammo-bar tick/segment divider colour (`Hud.as` `ammoOutline`, exact source value). */
export const C_AMMO_GRID_LINE = 0x333333;
/** Centre of the dark-glass panel gradient (char 1448, doc 14 §5). */
export const C_GLASS = 0x2b2b2b;
/** The mid-grey frame a `Hud_WeaponHolder` tile is cut from, and its lit edge. */
export const C_BEZEL = 0x4a4a4a;
export const C_BEZEL_HI = 0x8a8a8a;
/** Ammo fill — baked tint add (255,255,255) on `bar_ammo0..3` (doc 14 §1.2). */
export const C_AMMO_WHITE = 0xffffff;
/** Credit glow strip, char 1478 (doc 14 §1.4). */
export const C_GLOW_CYAN = 0x00cccc;
/** Gametype caption teal (doc 14 §5). */
export const C_TEAL = 0x57deb0;

/**
 * Team tint for a unit-ish object, falling back to plain text white for
 * free-for-all (where nobody has a side).
 *
 * This used to key off a local `C_TEAM1 = 0xe05a44` / `C_TEAM2 = 0x4a8ee0` pair
 * — a red-vs-blue table that shadowed the identically-named authentic constants
 * in `ui/raze2/palette`. Raze 2 has no red team, so the ramp comes from there.
 */
export function teamColorOf(u: { team?: number } | null | undefined): number {
  return u?.team ? teamColor(u.team) : C_TEXT;
}

// --- text ------------------------------------------------------------------

/** A HUD label in the shared monospace face. */
export function mkText(size: number, fill: number, bold = false): Text {
  return new Text({
    text: "",
    style: new TextStyle({
      fill,
      fontFamily: FONT,
      fontSize: size,
      fontWeight: bold ? "bold" : "normal",
    }),
  });
}

/**
 * Width of `text` at `size`, without asking the renderer.
 *
 * The HUD font is monospace, so a fixed advance ratio is exact enough to lay
 * out multi-coloured runs (the kill feed stitches killer / verb / victim from
 * three separately-tinted Texts). Doing it arithmetically also means the
 * layout is identical in the headless test stub, which has no font engine and
 * reports no text width at all.
 */
export const MONO_ADVANCE = 0.6;
export function measureMono(text: string, size: number): number {
  return text.length * size * MONO_ADVANCE;
}

// --- panel chrome ----------------------------------------------------------

export interface PanelOpts {
  /** Colour of the 2px accent rule along the panel's top edge. */
  accent?: number;
  /** Panel background opacity. */
  alpha?: number;
  /** Draw the short corner ticks. Off for tiny panels where they'd be noise. */
  corners?: boolean;
}

/**
 * The one panel look shared by every HUD zone: a translucent slab, a hairline
 * border, a coloured rule along the top edge that identifies the zone, and
 * clipped corner ticks for the military-console feel.
 */
export function panel(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: PanelOpts = {},
): void {
  const alpha = opts.alpha ?? 0.72;
  g.rect(x, y, w, h)
    .fill({ color: C_PANEL, alpha })
    .stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.95 });

  if (opts.accent !== undefined) {
    g.rect(x, y, w, 2).fill({ color: opts.accent, alpha: 0.85 });
  }

  if (opts.corners !== false) {
    const t = 7;
    const col = opts.accent ?? C_PANEL_EDGE;
    // Four L-shaped ticks, one per corner.
    g.moveTo(x, y + t).lineTo(x, y).lineTo(x + t, y)
      .moveTo(x + w - t, y).lineTo(x + w, y).lineTo(x + w, y + t)
      .moveTo(x, y + h - t).lineTo(x, y + h).lineTo(x + t, y + h)
      .moveTo(x + w - t, y + h).lineTo(x + w, y + h).lineTo(x + w, y + h - t)
      .stroke({ color: col, width: 1.5, alpha: 0.75 });
  }
}

/**
 * The dark-glass slab every Raze 2 HUD panel is cut from (char 1448): a radial
 * `#2B2B2B` centre falling to `#000000` at the edge under a 1px black stroke.
 * The stub-safe primitive set has no gradients, so the falloff is three
 * concentric inset rects — indistinguishable at HUD scale and one path each.
 */
export function razeGlass(g: Graphics, x: number, y: number, w: number, h: number, alpha = 1): void {
  g.rect(x, y, w, h).fill({ color: 0x000000, alpha });
  const step = Math.min(4, Math.min(w, h) / 10);
  for (let i = 1; i <= 3; i++) {
    const k = i * step;
    if (w - k * 2 <= 0 || h - k * 2 <= 0) break;
    g.rect(x + k, y + k, w - k * 2, h - k * 2).fill({ color: C_GLASS, alpha: alpha * 0.3 });
  }
  g.rect(x, y, w, h).stroke({ color: 0x000000, width: 1, alpha });
}

/** One `Hud_WeaponHolder` tile: mid-grey bezel, lit top edge, glass recess. */
export function bezelTile(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h).fill({ color: C_BEZEL, alpha: 0.95 });
  g.rect(x, y, w, 2).fill({ color: C_BEZEL_HI, alpha: 0.7 });
  g.rect(x, y, 2, h).fill({ color: C_BEZEL_HI, alpha: 0.3 });
  g.rect(x, y, w, h).stroke({ color: 0x000000, width: 1, alpha: 0.9 });
  razeGlass(g, x + 4, y + 4, w - 8, h - 8, 0.95);
}

/**
 * How many stacked rows the magazine read-out splits into
 * (`Hud.setAmmoBar()`, `Hud.as:453-468`): one row up to 25 rounds, then one
 * more per 25, capped at 4. Splitting is how the original keeps a 100-round
 * drum at one tick per round instead of down-sampling the strip.
 */
export function clipRows(rounds: number): number {
  if (rounds > 75) return 4;
  if (rounds > 50) return 3;
  if (rounds > 25) return 2;
  return 1;
}

/**
 * The magazine read-out (`bar_ammo0..3`): one vertical tick per round, lit for
 * rounds still chambered and near-black for spent ones, stacked into 1-4 rows
 * once the magazine passes 25 rounds.
 *
 * The rows drain top-first — `bar_ammo0` (the top one) holds only what spills
 * over the rows below it (`Hud.as:520-545`), so the bottom row is the last to
 * empty. Surprising, but it is what the original does.
 */
export function drawClipTicks(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  per: number,
  rounds: number,
  color: number = C_AMMO_WHITE,
): void {
  razeGlass(g, x, y, w, h);
  const total = Math.max(1, Math.round(rounds) || 1);
  const rows = clipRows(total);
  // `Hud.as:471` coerces `clipSize / rows` to uint, so a 35-round magazine is
  // two rows of 17 and the odd round never gets a tick of its own.
  const perRow = Math.max(1, Math.floor(total / rows));
  const lit = Math.round(clamp01(per) * total);
  const rowH = h / rows;
  const pitch = w / perRow;
  const tw = Math.max(1, pitch - 1);
  const inset = rows > 1 ? 1 : 3;
  for (let r = 0; r < rows; r++) {
    const rowLit = Math.max(0, Math.min(perRow, lit - (rows - 1 - r) * perRow));
    const ty = y + r * rowH;
    for (let i = 0; i < perRow; i++) {
      const on = i < rowLit;
      g.rect(x + i * pitch + (pitch - tw) / 2, ty + inset, tw, rowH - inset * 2)
        .fill({ color: on ? color : C_AMMO_GRID_LINE, alpha: on ? 0.95 : 0.85 });
    }
    // Row divider, drawn in `ammoOutline`'s own 1px #333333 (`Hud.as:486`).
    if (r > 0) {
      g.moveTo(x, ty).lineTo(x + w, ty)
        .stroke({ color: C_AMMO_GRID_LINE, width: 1, alpha: 0.9 });
    }
  }
}

/** The `mc_gametype` skull, drawn from primitives (no glyph font on the HUD). */
export function drawSkull(g: Graphics, cx: number, cy: number, r: number, color = 0xf2f2f2): void {
  g.circle(cx, cy - r * 0.12, r * 0.74).fill({ color });
  g.rect(cx - r * 0.34, cy + r * 0.3, r * 0.68, r * 0.46).fill({ color });
  g.circle(cx - r * 0.29, cy - r * 0.14, r * 0.21).fill({ color: 0x000000 });
  g.circle(cx + r * 0.29, cy - r * 0.14, r * 0.21).fill({ color: 0x000000 });
  g.rect(cx - r * 0.07, cy + r * 0.16, r * 0.14, r * 0.16).fill({ color: 0x000000 });
  g.rect(cx - r * 0.13, cy + r * 0.34, r * 0.05, r * 0.42).fill({ color: 0x000000 });
  g.rect(cx + r * 0.08, cy + r * 0.34, r * 0.05, r * 0.42).fill({ color: 0x000000 });
}

/**
 * Closed polygon from a flat x,y list. The headless stub implements moveTo /
 * lineTo / closePath but not `poly`, so every angled shape below is built the
 * long way round.
 */
function polyPath(g: Graphics, pts: number[]): void {
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
}

/** Blend two packed RGB colours, `t` 0..1. */
function mixRGB(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

// --- score race bars (char 1494) -------------------------------------------
/**
 * Track geometry, measured off the symbol's own shape record: the art is
 * 126.95 x 8.5 with the top edge sitting 2.95 to the right of the bottom, and
 * `Hud.as:425` slides its mask across exactly 124px. So the *track* is 124 wide
 * and the extra 2.95 is the lean.
 */
export const SCORE_BAR_W = 124;
export const SCORE_BAR_H = 9;
const SB_SKEW = 3;
/** Steps in the banded vertical ramp (see `scoreBar`). */
const SB_BANDS = 5;

/** One horizontal slice of the leaning bar, `t0`..`t1` down its height. */
function sbSlice(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  t0: number,
  t1: number,
): void {
  const l0 = x + SB_SKEW * (1 - t0);
  const l1 = x + SB_SKEW * (1 - t1);
  polyPath(g, [l0, y + h * t0, l0 + w, y + h * t0, l1 + w, y + h * t1, l1, y + h * t1]);
}

/**
 * `scorebars.bar1` / `bar2` — the one bar in the HUD that is not a plain rect: a
 * right-leaning parallelogram under a two-stop vertical gradient. `top`/`bot`
 * are the symbol's own gradient stops (see `BAR_GRAD` in Hud).
 *
 * The stub-safe primitive set has no gradient fills, so the ramp is banded into
 * `SB_BANDS` slices — the same trade `razeGlass` makes, and invisible at 9px.
 */
export function scoreBar(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  per: number,
  top: number,
  bot: number,
): void {
  // Unfilled track. Deliberately no outline: the original floats these over the
  // level with nothing behind them, and a stroke is what made them read as a
  // widget rather than part of the scene.
  sbSlice(g, x, y, w, h, 0, 1);
  g.fill({ color: 0x000000, alpha: 0.5 });

  const fw = clamp01(per) * w;
  if (fw < 0.5) return;
  for (let i = 0; i < SB_BANDS; i++) {
    // Overlap into the next band so the seams never show as hairlines.
    const t1 = i === SB_BANDS - 1 ? 1 : (i + 1) / SB_BANDS + 0.03;
    sbSlice(g, x, y, fw, h, i / SB_BANDS, t1);
    g.fill({ color: mixRGB(top, bot, (i + 0.5) / SB_BANDS) });
  }
  // Lit top edge, as on the symbol's lighter upper stop.
  sbSlice(g, x, y, fw, h, 0, 0.18);
  g.fill({ color: 0xffffff, alpha: 0.18 });
}

// --- gametype icon (`mc_gametype`) -----------------------------------------
/**
 * `mc_gametype.mc_type` has a frame per gametype (`Hud.as:186` does
 * `gotoAndStop(MatchSettings.type)`), but FFDec flattens nested clips to their
 * first frame, so the individual glyphs could not be lifted out of the SWF.
 * These are redrawn in the same solid-silhouette language as the CTF flag badge
 * (char 1509), which did export.
 */
export function drawModeGlyph(
  g: Graphics,
  mode: string,
  cx: number,
  cy: number,
  r: number,
  color = 0x14161c,
): void {
  switch (mode) {
    case "ctf": {
      // Pole leaning right, banner off its top-left with the original's wavy hem.
      polyPath(g, [
        cx + 0.30 * r, cy - 0.95 * r,
        cx + 0.52 * r, cy - 0.95 * r,
        cx + 0.30 * r, cy + 0.95 * r,
        cx + 0.08 * r, cy + 0.95 * r,
      ]);
      g.fill({ color });
      polyPath(g, [
        cx + 0.34 * r, cy - 0.86 * r,
        cx - 0.90 * r, cy - 0.58 * r,
        cx - 0.82 * r, cy - 0.02 * r,
        cx - 0.34 * r, cy - 0.18 * r,
        cx + 0.06 * r, cy + 0.04 * r,
        cx + 0.16 * r, cy - 0.42 * r,
      ]);
      g.fill({ color });
      break;
    }
    case "dom":
      // The capture node (`NodePickup`): a ring around a solid core.
      g.circle(cx, cy, r * 0.78).stroke({ color, width: r * 0.26 });
      g.circle(cx, cy, r * 0.30).fill({ color });
      break;
    case "jug":
      // Crown — the juggernaut is the one everyone is hunting.
      polyPath(g, [
        cx - 0.90 * r, cy + 0.62 * r,
        cx - 0.90 * r, cy - 0.66 * r,
        cx - 0.42 * r, cy - 0.08 * r,
        cx, cy - 0.80 * r,
        cx + 0.42 * r, cy - 0.08 * r,
        cx + 0.90 * r, cy - 0.66 * r,
        cx + 0.90 * r, cy + 0.62 * r,
      ]);
      g.fill({ color });
      break;
    case "elim":
    case "telim":
      // Heart: elimination is the only mode scored in lives.
      g.circle(cx - 0.36 * r, cy - 0.26 * r, r * 0.46).fill({ color });
      g.circle(cx + 0.36 * r, cy - 0.26 * r, r * 0.46).fill({ color });
      polyPath(g, [cx - 0.80 * r, cy - 0.04 * r, cx + 0.80 * r, cy - 0.04 * r, cx, cy + 0.90 * r]);
      g.fill({ color });
      break;
    default:
      drawSkull(g, cx, cy, r, color);
  }
}

/**
 * The `mc_gametype` badge: a light rounded plate carrying the mode glyph. The
 * original reads as a bright chip against the level, not a dark disc — it is the
 * only light element in the corner and that is what makes it findable.
 */
export function modePlate(g: Graphics, x: number, y: number, size: number, mode: string): void {
  g.roundRect(x - 1, y - 1, size + 2, size + 2, size * 0.22).fill({ color: 0x000000, alpha: 0.5 });
  g.roundRect(x, y, size, size, size * 0.2).fill({ color: 0xe6e8ea, alpha: 0.94 });
  g.roundRect(x, y, size, size * 0.42, size * 0.2).fill({ color: 0xffffff, alpha: 0.5 });
  drawModeGlyph(g, mode, x + size / 2, y + size / 2, size * 0.3);
}

/** A bar track plus its fill. `per` is clamped to 0..1. */
export function bar(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  per: number,
  color: number,
  alpha = 1,
): void {
  g.rect(x, y, w, h).fill({ color: C_TRACK, alpha: 0.9 });
  const p = clamp01(per);
  if (p > 0) {
    g.rect(x, y, Math.max(2, w * p), h).fill({ color, alpha });
    // A lighter top sliver gives the fill a little dimension without a gradient.
    g.rect(x, y, Math.max(2, w * p), Math.max(1, h * 0.28))
      .fill({ color: 0xffffff, alpha: 0.16 * alpha });
  }
  g.rect(x, y, w, h).stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.9 });
}

/**
 * The Raze 2 selected-weapon "oscilloscope" ammo bar (`Hud.as` `setAmmoBar()`,
 * doc 11 §2.3): a green fill cross-hatched by dark `0x333333` 1px grid lines
 * that mark clip-segment boundaries (thick dividers) and per-round ticks
 * within each segment (thin dividers), which is what reads as an EKG/graph
 * texture rather than a plain filled bar.
 */
export function drawAmmoGrid(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fillFrac: number,
  segments: number,
  ticksPerSegment: number,
  color: number = C_AMMO_GRID_GREEN,
): void {
  g.rect(x, y, w, h).fill({ color: C_TRACK, alpha: 0.9 });
  const p = clamp01(fillFrac);
  if (p > 0) {
    g.rect(x, y, Math.max(1, w * p), h).fill({ color, alpha: 0.5 });
    g.rect(x, y, Math.max(1, w * p), Math.max(1, h * 0.3))
      .fill({ color: 0xffffff, alpha: 0.12 });
  }
  const segN = Math.max(1, segments);
  const segW = w / segN;
  const tickN = Math.max(1, ticksPerSegment);
  const tickW = segW / tickN;
  for (let s = 0; s < segN; s++) {
    for (let t = 1; t < tickN; t++) {
      const tx = x + s * segW + t * tickW;
      g.moveTo(tx, y).lineTo(tx, y + h).stroke({ color: C_AMMO_GRID_LINE, width: 1, alpha: 0.55 });
    }
  }
  for (let s = 1; s < segN; s++) {
    const sx = x + s * segW;
    g.moveTo(sx, y).lineTo(sx, y + h).stroke({ color: C_AMMO_GRID_LINE, width: 1.5, alpha: 0.9 });
  }
  g.rect(x, y, w, h).stroke({ color: C_PANEL_LINE, width: 1, alpha: 0.9 });
}

/** A short horizontal rule, used to separate rows inside a panel. */
export function rule(g: Graphics, x: number, y: number, w: number, alpha = 0.5): void {
  g.moveTo(x, y).lineTo(x + w, y).stroke({ color: C_PANEL_LINE, width: 1, alpha });
}

export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Health colour ramp: green -> amber under 55%, red under 30%. */
export function healthColor(per: number): number {
  if (per <= 0.3) return C_HP_LOW;
  if (per <= 0.55) return C_HP_MID;
  return C_HP;
}

/**
 * Authentic Raze 2 heartbeat tint (`Hud.setHealth()`, `Hud.as:357-361`): a
 * continuous green→yellow→red ramp with a fixed blue floor of 0x50. Full health
 * ≈ #00FF50, mid ≈ #FFFF50, critical ≈ #FF0050 — the exact formula the ECG
 * widget colour-transforms with.
 */
export function healthTint(per: number): number {
  const p = clamp01(per);
  // red = full at/below half health, ramping down to 0 at full health.
  const red = p <= 0.5 ? 255 : Math.round((1 - (p - 0.5) * 2) * 255);
  // green = full at/above half health, ramping down to 0 at zero health.
  const green = p >= 0.5 ? 255 : Math.round(p * 2 * 255);
  return (red << 16) | (green << 8) | 0x50;
}

/**
 * One cardiac cycle as `(u, v)` vertices — `u` runs 0→1 through the beat, `v` is
 * in R-wave heights (positive = up). P and T are rounded (raised-cosine); the
 * QRS is three straight segments so it stays a needle at any width.
 */
const ECG_BEAT: [number, number][] = (() => {
  const pts: [number, number][] = [[0, 0]];
  const bump = (centre: number, halfW: number, height: number, segs: number): void => {
    for (let i = 0; i <= segs; i++) {
      const u = centre - halfW + (2 * halfW * i) / segs;
      pts.push([u, height * 0.5 * (1 - Math.cos((i / segs) * Math.PI * 2))]);
    }
  };
  bump(0.16, 0.055, 0.17, 8); // P wave
  pts.push([0.29, 0]); // PR segment
  pts.push([0.315, -0.14]); // Q
  pts.push([0.35, 1]); // R
  pts.push([0.385, -0.32]); // S
  pts.push([0.42, 0]); // J point
  bump(0.57, 0.1, 0.3, 10); // T wave
  pts.push([1, 0]); // diastole
  return pts;
})();

function ecgAt(u: number): number {
  for (let i = 1; i < ECG_BEAT.length; i++) {
    const [u1, v1] = ECG_BEAT[i];
    if (u <= u1) {
      const [u0, v0] = ECG_BEAT[i - 1];
      return u1 === u0 ? v1 : v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
    }
  }
  return 0;
}

/**
 * Draw an ECG/oscilloscope heartbeat trace across a box — the Raze 2 `heartbeat`
 * MovieClip (char 1467). The waveform amplitude/complexity keys off `per`
 * ("full"/"half"/"low"/"empty" bands in the original) and scrolls with `phase`.
 * Colour is the caller's health tint. Drawn as polylines so it works in the
 * headless stub.
 */
export function drawHeartbeat(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  per: number,
  phase: number,
  color: number,
): void {
  const p = clamp01(per);
  const midY = y + h / 2;
  const pts: [number, number][] = [];

  // Amplitude collapses toward a flatline as health drops; beats thin out too.
  const amp = (h / 2 - 4) * (0.35 + 0.65 * p);
  const beats = p <= 0 ? 0 : 2 + Math.round(p);
  if (beats === 0) {
    pts.push([x, midY], [x + w, midY]);
  } else {
    // Beat-to-beat amplitude wobble — steady when healthy, ragged when dying.
    const wobble = (1 - p) * 0.4;
    const ampOf = (n: number): number => {
      const k = (n * 0.6180339887) % 1;
      return amp * (1 - wobble * (k < 0 ? k + 1 : k));
    };
    const bAt = (b: number): number => x + ((b + phase) / beats) * w;
    const fract = (v: number): number => {
      const f = v % 1;
      return f < 0 ? f + 1 : f;
    };
    const b0 = -phase;
    const b1 = beats - phase;
    pts.push([x, midY - ampOf(Math.floor(b0)) * ecgAt(fract(b0))]);
    for (let n = Math.floor(b0); n <= Math.ceil(b1); n++) {
      const a = ampOf(n);
      for (const [u, v] of ECG_BEAT) {
        const b = n + u;
        if (b > b0 && b < b1) pts.push([bAt(b), midY - a * v]);
      }
    }
    pts.push([x + w, midY - ampOf(Math.floor(b1)) * ecgAt(fract(b1))]);
  }

  // Two soft passes under the crisp one give the phosphor bloom of a CRT scope.
  for (const [width, alpha] of [[6, 0.1], [3.5, 0.22], [1.6, 1]]) {
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) g.moveTo(pts[0][0], pts[0][1]);
      else g.lineTo(pts[i][0], pts[i][1]);
    }
    g.stroke({ color, width, alpha });
  }
}

/**
 * A polyline arc from `a0` to `a1` radians at `radius`, centred on (cx, cy).
 * Used for the damage wedges and the crosshair's reload ring.
 */
export function arcPath(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  a0: number,
  a1: number,
  segments = 8,
): void {
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
}

// --- directional damage indicator -----------------------------------------

/** Frames a damage wedge lives for (~1s at the fixed 30Hz logic tick). */
const DMG_LIFE = FPS;
/** Wedges within this many radians of each other are merged, not stacked. */
const DMG_MERGE = 0.4;
/** How far from screen centre the wedges sit. */
const DMG_RADIUS = 132;
/** Half-width of one wedge, in radians. */
const DMG_SPAN = 0.33;

interface DmgHit {
  /** Direction the damage came FROM, in screen radians (0 = right). */
  angle: number;
  life: number;
  /** 0..1 severity; drives thickness and opacity. */
  power: number;
}

/**
 * Directional damage indicator: a red wedge pointing at whoever just shot you,
 * fading over about a second.
 *
 * The screen-edge red vignette (GameScreen.flashDamage) answers "am I being
 * hurt"; this answers "from where", which is the difference between turning
 * around and dying facing the wrong way. Hits from roughly the same bearing
 * are merged into one wedge and re-armed rather than drawn on top of each
 * other, so a chaingun burst produces one strengthening marker instead of a
 * solid red ring.
 *
 * The whole widget lives inside the HUD container, so screenshot mode hides it
 * along with everything else.
 */
export class DamageIndicator {
  readonly view = new Container();
  private g = new Graphics();
  private hits: DmgHit[] = [];
  private cx = 0;
  private cy = 0;

  constructor() {
    this.view.addChild(this.g);
    this.relayout();
  }

  /** Re-centre on the stage after a resize; the ring is drawn around the player. */
  relayout(): void {
    this.cx = GAME_WIDTH / 2;
    this.cy = GAME_HEIGHT / 2;
  }

  /**
   * Register a hit arriving from `angle` (screen radians, 0 = from the right).
   * `power` is 0..1 and behaves like flashDamage's intensity.
   */
  add(angle: number, power: number): void {
    const p = clamp01(power);
    for (const h of this.hits) {
      if (Math.abs(angleDelta(h.angle, angle)) < DMG_MERGE) {
        h.angle = angle;
        h.life = DMG_LIFE;
        h.power = Math.min(1, h.power + p * 0.5);
        return;
      }
    }
    // Four concurrent bearings is already more than anyone can read; the
    // oldest is retired rather than dropping the newest (freshest = useful).
    if (this.hits.length >= 4) this.hits.shift();
    this.hits.push({ angle, life: DMG_LIFE, power: Math.max(0.25, p) });
  }

  clear(): void {
    this.hits.length = 0;
    this.g.clear();
  }

  enterFrame(): void {
    if (!this.hits.length) return;

    for (let i = this.hits.length - 1; i >= 0; i--) {
      if (--this.hits[i].life <= 0) this.hits.splice(i, 1);
    }

    const g = this.g;
    g.clear();
    for (const h of this.hits) {
      // Ease-out fade: holds readable for the first half, then drops away.
      const k = h.life / DMG_LIFE;
      const a = k * k * (0.45 + h.power * 0.55);
      const span = DMG_SPAN * (0.7 + h.power * 0.5);
      // The wedge slides very slightly outward as it dies, which reads as
      // "this already happened" rather than "this is happening now".
      const r = DMG_RADIUS + (1 - k) * 14;
      const width = 4 + h.power * 8;
      arcPath(g, this.cx, this.cy, r, h.angle - span, h.angle + span);
      g.stroke({ color: C_DANGER, width, alpha: a });
      // A thin bright core keeps the marker legible over a busy arena.
      arcPath(g, this.cx, this.cy, r, h.angle - span * 0.55, h.angle + span * 0.55);
      g.stroke({ color: 0xffd0c4, width: 1.5, alpha: a * 0.8 });
    }
  }
}

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
