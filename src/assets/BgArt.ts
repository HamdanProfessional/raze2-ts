import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import BG_RIG from "./bgRig.json";

/**
 * The authentic parallax backdrop: two scrolling layers plus a static sky.
 *
 * `Arena`'s constructor picks three frame *labels* per map (`Arena.as:792-795`):
 *
 *     game.bg1.gotoAndStop(map.bg1)     // near parallax layer
 *     game.bg2.gotoAndStop(map.bg2)     // far parallax layer
 *     game.bgSky.gotoAndStop(map.sky)   // static backdrop, never offset
 *
 * `Game.as:105-110` adds them sky → bg2 → bg1, so **bg1 is the near layer** —
 * it is the bigger art and sweeps further. Both use the *same* camera ratio
 * (`Arena.as:1172-1175`); the depth difference comes entirely from how much
 * bigger each layer is than the view. There is no separate speed constant.
 *
 * `jungle` is authored with `bg1 = ""`: it genuinely has no near layer, so
 * `layer()` returning null is a normal case, not a missing asset.
 *
 * Baked by `tools/maps/bake_bg.py`; the per-map label assignment was recovered
 * from `Stats_Maps.getMap`'s bytecode (`tools/maps/bg_labels.py`), since both
 * decompilations of that switch collapse to a single "test" case.
 */

/** `w/h` is the content bounds — Flash's `bg.width`, the formula's divisor.
 *  `lx/ly` is where that content hangs off the clip's registration point, which
 *  `Game.as` leaves at stage (0,0). Both in the SWF's 800x600 stage units. */
export interface Frame { w: number; h: number; lx: number; ly: number }
export interface BgRig {
  /** The SWF stage the art was authored against ([800, 600]). */
  stage: [number, number];
  maps: Record<string, { bg1: string; bg2: string; sky: string }>;
  bg: Record<string, Frame>;
  sky: Record<string, Frame>;
}

const rig = BG_RIG as unknown as BgRig;
const cache = new Map<string, Texture>();

function key(kind: "bg" | "sky", label: string): string {
  return `${kind}/${label}`;
}

/** Filename for a frame label. Only `"lol cats"` has a space in it. */
function slug(label: string): string {
  return label.replace(/ /g, "");
}

/** Levels are namespaced `r2_<map>` so they can't collide with the Raze 1 ids;
 *  the backdrop table is keyed by the bare map name, as the SWF has it. */
function mapId(level: string): string {
  return level.startsWith("r2_") ? level.slice(3) : level;
}

async function one(kind: "bg" | "sky", label: string): Promise<void> {
  if (!label || cache.has(key(kind, label))) return;
  try {
    const t = await Assets.load<Texture>(`${ASSET_BASE}/${kind}/${slug(label)}.png`);
    cache.set(key(kind, label), t);
  } catch {
    /* a missing layer just doesn't draw */
  }
}

/** `Arena.as:795` — the "lol cats" special mode replaces every map's sky. */
export const LOL_CATS_SKY = "lol cats";

export const BgArt = {
  rig,

  /**
   * Which layers a map uses, or null for a map with no authored backdrop.
   * `skyOverride` is the "lol cats" swap, which applies whatever the map says.
   */
  forMap(level: string, skyOverride?: string): { bg1: string; bg2: string; sky: string } | null {
    const m = rig.maps[mapId(level)];
    if (!m) return null;
    return skyOverride ? { ...m, sky: skyOverride } : m;
  },

  /**
   * Pull in the three layers `level` needs. Called from `preloadLevel`, so the
   * Arena constructor can read them synchronously like the rest of the map art.
   */
  async ensure(level: string, skyOverride?: string): Promise<void> {
    const m = this.forMap(level, skyOverride);
    if (!m) return;
    await Promise.all([
      one("bg", m.bg1),
      one("bg", m.bg2),
      one("sky", m.sky),
    ]);
  },

  /** Pull in a single extra frame the game swaps to mid-match (`tut_attack`). */
  async ensureLayer(kind: "bg" | "sky", label: string): Promise<void> {
    if (label) await one(kind, label);
  },

  /** Texture + authored content size, or null (not loaded, or no such layer). */
  layer(kind: "bg" | "sky", label: string): { tex: Texture; f: Frame } | null {
    if (!label) return null;
    const tex = cache.get(key(kind, label));
    const f = (kind === "bg" ? rig.bg : rig.sky)[label];
    return tex && f ? { tex, f } : null;
  },
};
