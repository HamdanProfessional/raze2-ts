import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import ABILITY_RIG from "./abilityRig.json";

/**
 * The character's back-attachment slot — `MC.body.ability` (`DefineSprite_249`),
 * baked by `tools/ability/bake.py`.
 *
 * Raze 2 hangs exactly one thing off a unit's back, and it is the same layer
 * either way: normally the equipped ability's kit (`gotoAndStop(ability.sprite)`
 * — the medkit, the grenade bandolier, the katana…), and while carrying a flag
 * `NodeCtfFlag.capture` overrides it with `gotoAndStop("flag" + team)`, with
 * `reset()` restoring the kit. Backpack and flag are therefore mutually
 * exclusive by construction, which is why this is one sprite and not two.
 *
 * Every frame was rendered on the clip's full canvas rather than cropped, so
 * they all share one `anchor` — the clip registration point as a fraction of
 * the canvas. Anchor a sprite there, drop it on the per-frame attach point from
 * `skinAnim.json`'s `ability[]`, and it lands where the SWF puts it.
 */

export interface AbilityRig {
  canvas: [number, number];
  anchor: [number, number];
  frames: string[];
}

const rig = ABILITY_RIG as unknown as AbilityRig;
const cache = new Map<string, Texture>();

export const AbilityArt = {
  loaded: false,
  rig,

  async load(): Promise<void> {
    await Promise.all(
      rig.frames.map((f) =>
        Assets.load<Texture>(`${ASSET_BASE}/ability/${f}.png?v=${ASSET_V}`)
          .then((t) => void cache.set(f, t))
          .catch(() => {}),
      ),
    );
    this.loaded = cache.size > 0;
  },

  /**
   * Texture for a back-slot sprite name, or null when there is nothing to show.
   *
   * `none` is a real frame in the clip but an empty one, so it is not baked and
   * not shipped — the caller just hides the layer.
   */
  getTexture(name: string | undefined): Texture | null {
    if (!name || name === "none") return null;
    return cache.get(name) ?? null;
  },

  /** Registration point as a fraction of the frame, for Sprite.anchor. */
  anchor(): [number, number] {
    return rig.anchor;
  },
};
