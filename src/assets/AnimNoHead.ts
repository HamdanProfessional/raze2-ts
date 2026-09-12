import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import type { AnimState } from "./Anim";

/**
 * Headless + armless body animation frames.
 *
 * Same baked SWF poses as `AnimNoArm`, but with the head layer ALSO removed (its
 * colour-transform zeroed at export, so the canvas/registration is byte-for-byte
 * identical to AnimNoArm — 81x124). This lets the live character wear a separate,
 * rotatable head layer (see `HeadArt`) that turns toward the aim like the
 * original rig, instead of the head being frozen in the baked pose.
 *
 * If these frames fail to load, Unit falls back to AnimNoArm (baked head).
 */

const FRAME_COUNT: Record<AnimState, number> = {
  idle: 20,
  run: 19,
  runback: 19,
  jump: 20,
  fall: 25,
  crouch: 25,
  tuck: 34,
};

const cache = new Map<string, Texture>();

function url(state: AnimState, frame: number): string {
  return `${ASSET_BASE}/anim-nohead/${state}/${frame}.png?v=${ASSET_V}`;
}

export const AnimNoHead = {
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
