import { Assets, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";

/**
 * Power-up floater icons, baked from the SWF by `tools/pickups/bake.py`.
 *
 * `NodePickup.EnterFrame` paints each floor power-up with
 * `bitscreen.paint(..., "pickups0", id, 1)`, and `BH.setup` builds that atlas
 * from `DefineSprite_1719`, keying every frame by its label — the labels being
 * the pickup ids themselves (sshield / bshield / shealth / bhealth / invin /
 * damage / mirror / rapid). Each is cropped to content and stored at
 * public/assets/pickups/<port kind>.png.
 *
 * `fade` is not in that atlas (Raze 2 has no fade pickup — cloak is an ability)
 * and keeps its earlier art. The Juggernaut crown has no frame either — it is a
 * match object, not a floor item — so it falls through to the drawn glyph.
 */

const KINDS = [
  "shield",
  "shieldBig",
  "health",
  "healthBig",
  "ddamage",
  "fade",
  "invin",
  "rapid",
] as const;

const cache = new Map<string, Texture>();

export const PickupArt = {
  loaded: false,

  async load(): Promise<void> {
    await Promise.all(
      KINDS.map((k) =>
        Assets.load<Texture>(`${ASSET_BASE}/pickups/${k}.png?v=${ASSET_V}`)
          .then((t) => void cache.set(k, t))
          .catch(() => {}),
      ),
    );
    this.loaded = cache.size > 0;
  },

  /** Texture for a power-up kind, or null (crown / not yet loaded). */
  getTexture(kind: string): Texture | null {
    return cache.get(kind) ?? null;
  },
};
