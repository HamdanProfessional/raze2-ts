import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";

/**
 * Power-up floater icons, lifted from the SWF Pickup_Item clip (symbol 1672).
 *
 * The original showed a per-type floater graphic on its own timeline frame
 * (shield / shieldBig / health / healthBig / ddamage / fade / invin). We render
 * each labelled frame, crop it to its content and store it at
 * public/assets/pickups/<kind>.png, so the floor pickup shows the authentic icon
 * instead of a placeholder disc. The Juggernaut crown has no Pickup_Item frame
 * (it is a match object, not a floor item), so it keeps its drawn glyph.
 */

const KINDS = [
  "shield",
  "shieldBig",
  "health",
  "healthBig",
  "ddamage",
  "fade",
  "invin",
] as const;

const cache = new Map<string, Texture>();

export const PickupArt = {
  loaded: false,

  async load(): Promise<void> {
    await Promise.all(
      KINDS.map((k) =>
        Assets.load<Texture>(`${ASSET_BASE}/pickups/${k}.png`)
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
