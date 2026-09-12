import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import type { AnimState } from "./Anim";

/**
 * Armless body animation frames.
 *
 * Same baked SWF poses as `Anim`, but re-exported with the arm layers (arm1 =
 * chid 685, arm2 = chid 426) removed from the body clips. This lets the live
 * character use the authentic body motion while the weapon arm is drawn as a
 * separate overlay (ArmArt) that rotates to aim and swaps with the gun — the
 * original rig, without the double-arm the fused frames produced.
 *
 * Canvas/registration matches `Anim` exactly (81x124), so the same feet-anchor
 * works and the body does not shift when the arm is removed.
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
  return `${ASSET_BASE}/anim-noarm/${state}/${frame}.png?v=${ASSET_V}`;
}

export const AnimNoArm = {
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
