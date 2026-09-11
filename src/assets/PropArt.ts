import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import rig from "./propRig.json";

/**
 * The Arena's authored animated props, baked by `tools/maps/bake_props.py`.
 *
 * A Raze 2 map is not only a wall bitmap plus a still backdrop — the author
 * drops live MovieClips straight onto the Arena frame. The tutorial map has 28
 * of them (five gears, eight conveyor treads, three exploding bridges, nine
 * lights, a dancing heart, a nav arrow), and the port drew none of them because
 * its map art is a single baked PNG.
 *
 * Every frame is trimmed to its own content box and shelf-packed, spilling to
 * numbered pages at 2048² — a 90-frame bridge packs to ~2048x22000 as one sheet,
 * past the max texture size on most GPUs. `bakeScale` is the resolution the art
 * was baked at relative to authored size; `lx`/`ly` are always in AUTHORED
 * units, so placement maths never has to know about it.
 */

export interface PropFrame {
  /** Atlas page, absent for a single-page prop. */
  p?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Content offset from the symbol's registration point, in authored px. */
  lx: number;
  ly: number;
}

export interface PropDef {
  cid: number;
  files: string[];
  bakeScale: number;
  frames: PropFrame[];
  /** `[from, to]` for a clip that just cycles. */
  loop?: [number, number];
  /** Frames the clip halts on; `play()` runs to the next one. */
  stops?: number[];
  /** Seed a random frame so copies of one clip run out of phase. */
  randStart?: boolean;
  /** Re-roll that random frame on every pass, not just at birth. The flicker
   *  light's `gotoAndPlay(irand(1,10))` sits on frame 1, *inside* its own cycle,
   *  so it fires every time round and the flicker never settles into a pattern. */
  randLoop?: boolean;
  /** The art is a flat white alpha mask, to be coloured by the placement's
   *  `tint`. The four light symbols are drawn once in red and recoloured per
   *  placement by the SWF — one symbol, eight colours. */
  whitened?: boolean;
  /** The colour the art was actually drawn in, for a whitened prop whose
   *  placement carries no transform of its own. */
  nativeTint?: number;
  labels?: Record<string, number>;
}

export interface PropPlacement {
  prop: string;
  name: string;
  /** Display-list depth. `midCont` is 1663, so anything below that draws
   *  behind the units and anything above draws in front of them. */
  depth: number;
  x: number;
  y: number;
  /** The authored transform's 2x2, straight off the SWF placement matrix:
   *  `x' = a*x + c*y + tx`, `y' = b*x + d*y + ty`. Rotation and flips are both
   *  in use here — every tutorial conveyor tread is tilted 22°, and the mine's
   *  belts are rotated *and* mirrored — so it is applied as a matrix rather
   *  than decomposed into scale/rotation/skew. */
  a: number;
  b: number;
  c: number;
  d: number;
  /** Flat colour from the placement's `mult=(0,0,0,1) add=(r,g,b,0)` transform,
   *  which throws the art's own colour away. Absent when it is drawn as-is. */
  tint?: number;
  /** Authored alpha, absent when opaque. The tutorial's nav arrow is placed at
   *  0 and raised by the walkthrough script (`Unit.as:876`). */
  alpha?: number;
}

interface Rig {
  props: Record<string, PropDef>;
  maps: Record<string, PropPlacement[]>;
}

const RIG = rig as unknown as Rig;

/** `midCont`'s depth on the Arena timeline (`Game.as:152` fills it with the
 *  units, bullets and physics world). */
export const MID_CONT_DEPTH = 1663;

/** Loaded atlas pages, keyed `<prop>#<page>`. */
const pages = new Map<string, Texture>();
/** Per-frame sub-textures, built lazily and keyed `<prop>#<frame>`. */
const frames = new Map<string, Texture>();

export const PropArt = {
  loaded: false,

  /** Which props a map needs, or none if it has no authored props. */
  placements(mapId: string): PropPlacement[] {
    return RIG.maps[mapId.replace(/^r2_/, "")] ?? [];
  },

  def(prop: string): PropDef | null {
    return RIG.props[prop] ?? null;
  },

  /** Load only the atlases a map actually uses — the tut set alone is ~73 MB
   *  of resident RGBA, so it is not something every level should pay for. */
  async loadForMap(mapId: string): Promise<void> {
    const want = new Set(this.placements(mapId).map((p) => p.prop));
    if (!want.size) return;
    const jobs: Promise<unknown>[] = [];
    for (const prop of want) {
      const def = RIG.props[prop];
      if (!def) continue;
      def.files.forEach((file, page) => {
        const key = `${prop}#${page}`;
        if (pages.has(key)) return;
        jobs.push(
          Assets.load<Texture>(`${ASSET_BASE}/props/${file}`)
            .then((t) => void pages.set(key, t))
            .catch(() => {}),
        );
      });
    }
    await Promise.all(jobs);
    this.loaded = pages.size > 0;
  },

  /** Texture for one 1-based Flash frame, or null if the art is missing. */
  frame(prop: string, frame: number): Texture | null {
    const key = `${prop}#${frame}`;
    const hit = frames.get(key);
    if (hit) return hit;

    const def = RIG.props[prop];
    const f = def?.frames[frame - 1];
    if (!def || !f || !f.w || !f.h) return null;
    const page = pages.get(`${prop}#${f.p ?? 0}`);
    if (!page) return null;

    const tex = new Texture({
      source: page.source,
      frame: new Rectangle(f.x, f.y, f.w, f.h),
    });
    frames.set(key, tex);
    return tex;
  },
};
