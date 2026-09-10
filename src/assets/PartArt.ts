import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import PART_RIG from "./partRig.json";

/**
 * Layered, per-costume character parts — the authentic SWF rig.
 *
 * The original assembled each character from separately-costumed MovieClips
 * (neck 456, body 681, upper/lower legs 616/550, feet 486), each frame of a part
 * clip being one costume variant, positioned every animation frame by the master
 * clip's matrices. The earlier TS port baked the whole body into flat frames,
 * which forced a single fixed costume. This module restores the layered rig so
 * body/legs customization (and the robot/zombie idle poses) render for real.
 *
 * partRig.json (extracted from the SWF):
 *   parts   — depthClipId -> partName
 *   pivots  — clipId -> { px, py } (the part-clip origin as a fraction of its
 *             exported texture; the rotation/placement centre)
 *   states  — animState -> { frames: PartPlacement[][] } where each frame lists
 *             the visible parts with their per-frame affine matrix
 *             m = [scaleX, rotateSkew0, rotateSkew1, scaleY, txPx, tyPx].
 *   rootY   — clip origin height above the feet (shared with armRig/headRig).
 */

export interface PartPlacement {
  d: number;          // depth (z-order; ascending = back to front)
  cid: number;        // part clip id
  m: [number, number, number, number, number, number]; // sx,r0,r1,sy,txPx,tyPx
}
export interface PartRig {
  parts: Record<string, string>;
  pivots: Record<string, { px: number; py: number; name: string }>;
  states: Record<string, { frames: PartPlacement[][] }>;
  rootY: number;
}

const rig = PART_RIG as unknown as PartRig;

// Costume type per part: neck + body follow costume.body; legs/feet follow legs.
const BODY_PARTS = new Set([456, 681]);

// Frame counts as exported (costume variants, 1..N).
const COUNT: Record<number, number> = { 456: 83, 486: 84, 550: 83, 616: 83, 681: 101 };
const NAME: Record<number, string> = { 456: "neck", 486: "foot", 550: "leglow", 616: "legup", 681: "body" };

const cache = new Map<string, Texture>();

function url(cid: number, frame: number): string {
  return `${ASSET_BASE}/body-parts/${NAME[cid]}/${frame}.png`;
}

export const PartArt = {
  loaded: false,
  rig,

  async load(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const cidStr of Object.keys(COUNT)) {
      const cid = Number(cidStr);
      for (let f = 1; f <= COUNT[cid]; f++) {
        jobs.push(
          Assets.load<Texture>(url(cid, f))
            .then((t) => void cache.set(`${cid}:${f}`, t))
            .catch(() => {}),
        );
      }
    }
    await Promise.all(jobs);
    this.loaded = cache.size > 0 && !!rig.states?.idle;
  },

  /** Whether a part draws with the body costume (else the legs costume). */
  isBodyCostume(cid: number): boolean {
    return BODY_PARTS.has(cid);
  },

  /** Texture for a part at a costume index (wraps into the available range). */
  getTexture(cid: number, costume: number): Texture | null {
    const n = COUNT[cid] ?? 1;
    const c = ((Math.max(1, costume) - 1) % n) + 1;
    return cache.get(`${cid}:${c}`) ?? cache.get(`${cid}:1`) ?? null;
  },

  pivot(cid: number): { px: number; py: number } {
    return rig.pivots[String(cid)] ?? { px: 0.5, py: 0.5 };
  },

  /** Placement list for a state/frame (empty if unknown). */
  frame(state: string, frame: number): PartPlacement[] {
    const s = rig.states[state];
    if (!s || !s.frames.length) return [];
    const f = ((frame % s.frames.length) + s.frames.length) % s.frames.length;
    return s.frames[f];
  },

  frameCount(state: string): number {
    return rig.states[state]?.frames.length ?? 0;
  },

  hasState(state: string): boolean {
    return !!rig.states[state]?.frames.length;
  },
};
