import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import rig from "./fxRig.json";

/**
 * Effects baked out of the SWF's `BH` atlas by `tools/fx/bake_bh.py`.
 *
 * `Effect.as` is the whole of Raze 2's effect system and it is 62 lines, because
 * every effect is the same thing: look a name up in `BH.BITS`, pick one of its
 * pre-baked rotations at random, and blit its frames.
 *
 *     stats = BH.getBitAniStats(name + 0, sub);
 *     rotation = UT.irand(0, stats.rotAmt - 1);
 *     game.bitscreen.paint(x + game.arena.x, y + game.arena.y, true, name, sub, frame);
 *
 * The port draws most effects procedurally instead, which is fine for a spark
 * burst but cannot invent art it does not have — so the names with no procedural
 * stand-in all fell through to a generic ring. These are the real thing.
 *
 * `cells` is rotation-major: cell `r * frames + f` is animation frame `f` at
 * rotation `r`. Every cell is trimmed to its own content box, so `lx`/`ly` place
 * it against the point `createEffect()` was called at.
 */

export interface FxCell {
  /** Atlas page, absent for a single-page effect. */
  p?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Content offset from the effect's origin, in authored px. */
  lx: number;
  ly: number;
}

export interface FxDef {
  cid: number;
  files: string[];
  bakeScale: number;
  /** How many rotations were baked; the SWF picks one at random per spawn. */
  rotAmt: number;
  /** Animation length, i.e. `cells.length / rotAmt`. */
  frames: number;
  cells: FxCell[];
  /** The art is a flat white mask to be drawn with the entry's `tint`. The five
   *  skin bloods are one clip under five `mult=0` colour transforms. */
  whitened?: boolean;
  /** Named sub-animations, for the handful of clips that have more than one. */
  subs?: Record<string, number>;
  /** Set on an entry that shares another effect's atlas. */
  alias?: string;
  tint?: number;
  alpha?: number;
}

interface Rig {
  fx: Record<string, FxDef>;
}

const RIG = rig as unknown as Rig;

/** Loaded atlas pages, keyed `<effect>#<page>`. */
const pages = new Map<string, Texture>();
/** Per-cell sub-textures, built lazily and keyed `<effect>#<cell>`. */
const cells = new Map<string, Texture>();

export const FxArt = {
  loaded: false,

  /** Every baked effect name. */
  names(): string[] {
    return Object.keys(RIG.fx);
  },

  /** The definition for `name`, following an alias to whoever owns the atlas.
   *  The tint/alpha stay on the *asking* name — that is the whole point of an
   *  alias, since the two differ only in colour. */
  def(name: string): FxDef | null {
    const e = RIG.fx[name];
    if (!e) return null;
    if (!e.alias) return e;
    const owner = RIG.fx[e.alias];
    return owner ? { ...owner, tint: e.tint, alpha: e.alpha } : null;
  },

  has(name: string): boolean {
    return !!RIG.fx[name];
  },

  /** Load every effect atlas. The whole set is ~0.3 MB, far below the per-map
   *  prop atlases, and an effect can fire on any level — so there is nothing to
   *  gain by loading it piecemeal. */
  async load(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const [name, def] of Object.entries(RIG.fx)) {
      def.files?.forEach((file, page) => {
        const key = `${name}#${page}`;
        if (pages.has(key)) return;
        jobs.push(
          Assets.load<Texture>(`${ASSET_BASE}/fx/${file}?v=${ASSET_V}`)
            .then((t) => void pages.set(key, t))
            .catch(() => {}),
        );
      });
    }
    await Promise.all(jobs);
    this.loaded = pages.size > 0;
  },

  /** Texture for one cell index, or null if the art is missing or blank. */
  cell(name: string, index: number): Texture | null {
    const e = RIG.fx[name];
    const owner = e?.alias ?? name;
    const key = `${owner}#${index}`;
    const hit = cells.get(key);
    if (hit) return hit;

    const def = RIG.fx[owner];
    const c = def?.cells[index];
    if (!def || !c || !c.w || !c.h) return null;
    const page = pages.get(`${owner}#${c.p ?? 0}`);
    if (!page) return null;

    const tex = new Texture({
      source: page.source,
      frame: new Rectangle(c.x, c.y, c.w, c.h),
    });
    cells.set(key, tex);
    return tex;
  },
};
