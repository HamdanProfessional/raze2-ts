import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import { artIdFor } from "./weaponArtAlias";
import { RAZE2_WEAPONS } from "./raze2";

/**
 * Authentic gun-only weapon-pickup icons, rasterized from the decompiled
 * raze-2.swf gun clip (DefineSprite_380, one frame per `curGun.sprite`) and
 * stored at public/assets/pickups/weapons/<id>.png. Every "global" floor pickup
 * therefore shows its own real Raze 2 gun — matching the held-weapon art — rather
 * than a shared Raze 1 silhouette or the generic "random" icon.
 */

// Every weapon id that has a gun-only pickup icon: all 36 Raze 2 guns (type
// 0-6), plus the "random" mystery pickup.
const TYPES: string[] = (() => {
  const s = new Set<string>(["random"]);
  for (const w of RAZE2_WEAPONS) {
    if (w.type > 6 || !w.sprite) continue;
    s.add(w.id);
  }
  return [...s];
})();

const cache = new Map<string, Texture>();
/** The lit stand a floor weapon sits on (`NodePickup` frame 2). Separate from
 *  the gun icons: the SWF draws the stand from the node clip itself and paints
 *  the gun above it, and powerups get no stand at all. */
let baseTex: Texture | null = null;

export const PickupWeaponArt = {
  loaded: false,

  async load(): Promise<void> {
    await Promise.all([
      ...TYPES.map((t) =>
        Assets.load<Texture>(`${ASSET_BASE}/pickups/weapons/${t}.png`)
          .then((tex) => void cache.set(t, tex))
          .catch(() => {}),
      ),
      Assets.load<Texture>(`${ASSET_BASE}/pickups/base.png`)
        .then((tex) => void (baseTex = tex))
        .catch(() => {}),
    ]);
    this.loaded = cache.size > 0;
  },

  /** The lit stand, or null if it has not loaded. */
  getBase(): Texture | null {
    return baseTex;
  },

  /** Texture for a weapon type (or "random"); null until loaded. */
  getTexture(type: string): Texture | null {
    return cache.get(type) ?? cache.get(artIdFor(type)) ?? cache.get("random") ?? null;
  },
};
