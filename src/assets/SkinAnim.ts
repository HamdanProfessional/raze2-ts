import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import SKIN_ANIM from "./raze2/skinAnim.json";

/**
 * Per-skin ANIMATED Raze 2 character art for the live in-game unit.
 *
 * A Raze 2 skin is a single frame index applied to every part clip
 * (`UnitMC.setSkin` -> `part.gotoAndStop(skinFrame)`); the per-frame part
 * PLACEMENT (the animation) is skin-INDEPENDENT and lives on the UnitMC
 * (symbol 441) timeline. So each of the 31 skins gets the SAME motion, only its
 * textures differ. We bake, offline, one spritesheet PNG per skin
 * (`public/assets/skins/anim/<id>.png`) whose rows are animation states and
 * whose columns are that state's frames, composited from the UnitMC per-frame
 * placement matrices and each part's skin-frame art (re-runnable via
 * `tools/skin-anim/`). Body + head + both legs/feet are baked; the aiming FRONT arm
 * is NOT — the live rig keeps its own aim-tracking arm + gun overlay on top,
 * exactly like the Raze-1 armless-body rig, welded at `shoulder[frame]`.
 *
 * skinAnim.json (shared manifest, all skins share the grid):
 *   cell   — [w,h] native px of every animation cell.
 *   cols   — cells per sheet row. Cells are packed densely (state `start` +
 *            frame = a global cell index) rather than one row per state, which
 *            would pad every short state out to the longest one's width.
 *   anchor — feet/clip-origin as a fraction of the cell (sprite anchor; the feet
 *            then sit on the unit origin). Baked facing right; flip x to face left.
 *   scale  — on-screen render scale so the figure matches the Raze-1 rig height.
 *   sheet  — [w,h] of the full spritesheet PNG.
 *   states — name -> { row, count, shoulder[frame]=[x,y] } where shoulder is the
 *            weapon-arm attach point in clip px (feet origin, y up = negative).
 */

interface StateInfo {
  /** Global cell index of this state's frame 1. */
  start: number;
  count: number;
  shoulder: [number, number][];
}
interface AnimManifest {
  cell: [number, number];
  anchor: [number, number];
  origin: [number, number];
  sheet: [number, number];
  /** Cells per row in the packed grid. */
  cols: number;
  scale: number;
  note: string;
  states: Record<string, StateInfo>;
  skins: string[];
}

const manifest = SKIN_ANIM as unknown as AnimManifest;
const [CW, CH] = manifest.cell;
const COLS = manifest.cols;

// Loaded sheet TextureSource per skin id, and a cache of per-cell sub-textures.
const sheets = new Map<string, Texture>();
const frames = new Map<string, Texture>();

function url(id: string): string {
  return `${ASSET_BASE}/skins/anim/${id}.png`;
}

export const SkinAnim = {
  loaded: false,
  manifest,
  scale: manifest.scale,

  /** Feet/clip-origin as a sprite anchor (feet land on the unit origin). */
  anchor(): { x: number; y: number } {
    return { x: manifest.anchor[0], y: manifest.anchor[1] };
  },

  /** Whether a skin id has animated bakes available. */
  has(id: string): boolean {
    return !!id && sheets.has(id);
  },

  hasState(state: string): boolean {
    return !!manifest.states[state];
  },

  frameCount(state: string): number {
    return manifest.states[state]?.count ?? 0;
  },

  /** Weapon-arm shoulder attach point for a state/frame (clip px, feet origin). */
  shoulder(state: string, frame: number): { x: number; y: number } {
    const s = manifest.states[state] ?? manifest.states.idle;
    const i = Math.max(0, Math.min(frame - 1, s.shoulder.length - 1));
    const p = s.shoulder[i] ?? [0, -57];
    return { x: p[0], y: p[1] };
  },

  /**
   * Sub-texture for a skin id at (state, 1-based frame). Wraps out-of-range
   * frames into the state's count. Returns null if the skin/state is unknown.
   */
  getFrame(id: string, state: string, frame: number): Texture | null {
    const sheet = sheets.get(id);
    const st = manifest.states[state];
    if (!sheet || !st) return null;
    const f = (((frame - 1) % st.count) + st.count) % st.count;
    const idx = st.start + f;
    const key = `${id}:${idx}`;
    let tex = frames.get(key);
    if (!tex) {
      tex = new Texture({
        source: sheet.source,
        frame: new Rectangle((idx % COLS) * CW, Math.floor(idx / COLS) * CH, CW, CH),
      });
      frames.set(key, tex);
    }
    return tex;
  },

  async load(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of manifest.skins) {
      jobs.push(
        Assets.load<Texture>(url(id))
          .then((t) => void sheets.set(id, t))
          .catch(() => {}),
      );
    }
    await Promise.all(jobs);
    this.loaded = sheets.size > 0;
  },
};
