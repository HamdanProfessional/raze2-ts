import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import HEAD_RIG from "./headRig.json";

/**
 * Separate, rotatable costume-head layer for the live character.
 *
 * The original placed the head as its own MovieClip (chid 757, `animMC.head`)
 * over the body and rotated it toward the aim (`head.rotation = aim*0.5 - 45`),
 * so the character visibly turns to look where they aim. The TS port baked the
 * head into the body frames; `AnimNoHead` supplies a headless body and this
 * module supplies the head textures (heads/<id>.png, id = costume.head, 1..84)
 * plus the neck rig used to weld + pivot the head each frame.
 *
 * headRig.json (from the SWF): rootY (shared with armRig), headPivot (the neck
 * joint as a fraction of the head PNG — the rotation centre) and per-state
 * per-frame `neck[]` attach points (native px, same clip-local basis as
 * armRig's arm[]).
 */

export interface HeadRig {
  rootY: number;
  headPivot: { px: number; py: number };
  states: Record<string, { neck: [number, number][] }>;
}

export const HEAD_COUNT = 84;

const rig = HEAD_RIG as unknown as HeadRig;
const cache = new Map<number, Texture>();

function url(id: number): string {
  return `${ASSET_BASE}/heads/${id}.png`;
}

export const HeadArt = {
  loaded: false,
  rig,

  /** Head-instance attach point (native px, clip-local) for a state/frame. */
  neck(state: string, frame: number): [number, number] {
    const s = rig.states[state] ?? rig.states.idle;
    const arr = s.neck;
    return arr[Math.min(frame, arr.length) - 1] ?? arr[0];
  },

  pivot(): { px: number; py: number } {
    return rig.headPivot;
  },

  async load(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (let id = 1; id <= HEAD_COUNT; id++) {
      jobs.push(
        Assets.load<Texture>(url(id))
          .then((t) => void cache.set(id, t))
          .catch(() => {}),
      );
    }
    await Promise.all(jobs);
    this.loaded = cache.size > 0;
  },

  /** Head texture for a costume head id, wrapping into the available range. */
  getTexture(id: number): Texture | null {
    if (cache.has(id)) return cache.get(id)!;
    // Team costumes are +30 / +60; fall back to the base head if that art is
    // absent, then to head 1 so a head always renders.
    const base = ((id - 1) % HEAD_COUNT) + 1;
    return cache.get(base) ?? cache.get(1) ?? null;
  },
};
