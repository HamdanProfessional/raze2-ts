import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";

/**
 * Full-body character animation frames.
 *
 * The original composed the character from limb symbols on pose timelines
 * (Idle/WalkForward/WalkBack/Jump/Fall/Crouch). The decompiler baked each pose
 * to a sequence of full-body PNGs (default costume), which we play back directly
 * for the live character — authentic motion posed by the original animators.
 * Per-costume colouring survives on the death ragdoll, which uses the per-frame
 * limb art (see Parts.ts).
 */

export type AnimState =
  | "idle"
  | "run"
  | "runback"
  | "jump"
  | "fall"
  | "crouch"
  | "tuck";

// Frame counts as exported (frames are 1..N). The head-baked variant has no tuck
// track (the layered nohead rig supplies it); 0 disables loading here.
const FRAME_COUNT: Record<AnimState, number> = {
  idle: 20,
  run: 19,
  runback: 19,
  jump: 20,
  fall: 25,
  crouch: 25,
  tuck: 0,
};

const cache = new Map<string, Texture>();

function url(state: AnimState, frame: number): string {
  return `${ASSET_BASE}/anim/${state}/${frame}.png?v=${ASSET_V}`;
}

export const Anim = {
  loaded: false,

  frameCount(state: AnimState): number {
    return FRAME_COUNT[state];
  },

  async load(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const state of Object.keys(FRAME_COUNT) as AnimState[]) {
      for (let f = 1; f <= FRAME_COUNT[state]; f++) {
        jobs.push(
          Assets.load<Texture>(url(state, f))
            .then((t) => void cache.set(`${state}:${f}`, t))
            .catch(() => {}),
        );
      }
    }
    await Promise.all(jobs);
    this.loaded = cache.size > 0;
  },

  getFrame(state: AnimState, frame: number): Texture | null {
    return cache.get(`${state}:${frame}`) ?? null;
  },
};
