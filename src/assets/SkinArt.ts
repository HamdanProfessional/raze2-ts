import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import SKIN_ART from "./raze2/skinArt.json";

/**
 * Raze 2 character SKINS as baked, feet-anchored idle figures.
 *
 * Raze 2's character (`UnitMC`, SWF symbol 441) is a layered part rig — body
 * (PhysBody 279), head (313), two arms (each armup 132 / armlow 102 / hand 342)
 * and legs (legup 226 / leglow 196 / foot 166). `UnitMC.setSkin(n)` simply does
 * `part.gotoAndStop(skinFrame)` on every part clip, so a "skin" is a single
 * frame index shared across all part timelines (see Stats_Skins.as → skins.json
 * `frame`).
 *
 * The Raze 2 rig does NOT match the port's Raze 1 partRig (different SWF,
 * proportions and registration), and FFDec cannot bake an AS3-selected skin
 * (nested clips play, they don't `gotoAndStop`). So each skin was composited
 * offline from the decompiler's per-part SVGs: the UnitMC idle frame supplies
 * the exact per-part placement matrices, each part's skin-frame PNG supplies the
 * texture, and the head/arms are snapped to their runtime holder positions
 * (`headhold` / `arm1hold`, per UnitMC.EnterFrame) so the figure rests coherently
 * instead of showing the raw timeline's split aim pose. The result is one
 * feet-anchored idle PNG per skin under `assets/skins/<id>.png`.
 *
 * skinArt.json (the bake manifest):
 *   canvas — [w,h] native px of every skin texture (all share one crop box).
 *   feet   — [x,y] native px of the ground-contact point inside that canvas.
 *   anchor — feet as a fraction of the texture (set sprite.anchor to this and the
 *            character's feet sit exactly on the unit origin).
 *   skins  — id -> { frame, name, race }.
 */

export interface SkinInfo {
  frame: number;
  name: string;
  race: string;
}
export interface SkinManifest {
  canvas: [number, number];
  feet: [number, number];
  anchor: [number, number];
  note: string;
  skins: Record<string, SkinInfo>;
}

const manifest = SKIN_ART as unknown as SkinManifest;
const cache = new Map<string, Texture>();

function url(id: string): string {
  return `${ASSET_BASE}/skins/${id}.png?v=${ASSET_V}`;
}

export const SkinArt = {
  loaded: false,
  manifest,

  /** Native pixel size of every skin texture. */
  get canvas(): [number, number] {
    return manifest.canvas;
  },

  /** Feet (ground-contact) as a fraction of the texture — use as sprite anchor. */
  anchor(): { x: number; y: number } {
    return { x: manifest.anchor[0], y: manifest.anchor[1] };
  },

  /** All known skin ids (in catalogue order). */
  ids(): string[] {
    return Object.keys(manifest.skins);
  },

  /** Whether a skin id has baked art. */
  has(id: string): boolean {
    return !!manifest.skins[id];
  },

  info(id: string): SkinInfo | null {
    return manifest.skins[id] ?? null;
  },

  async load(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of Object.keys(manifest.skins)) {
      jobs.push(
        Assets.load<Texture>(url(id))
          .then((t) => void cache.set(id, t))
          .catch(() => {}),
      );
    }
    await Promise.all(jobs);
    this.loaded = cache.size > 0;
  },

  /**
   * Baked idle figure for a skin id, or null if unknown / not yet loaded.
   * Anchor the sprite at `SkinArt.anchor()` and scale to taste; the figure is
   * drawn facing right, so mirror with a negative x-scale to face left.
   */
  getTexture(id: string): Texture | null {
    return cache.get(id) ?? null;
  },
};
