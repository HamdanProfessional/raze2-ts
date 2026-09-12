import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import META from "./armMeta.json";

/**
 * Static weapon-arm poses: the rest frame of each weapon on a fixed per-weapon
 * canvas, at `public/assets/arms-anim/<gunid>/1.png`, with `armMeta.json` giving
 * that canvas's size and the shoulder pivot as a fraction of it.
 *
 * This is no longer what the live in-game arm uses — `ArmAnim` supersedes it
 * with the full animated Raze 2 bands (idle + recoil + reload) for all 36 real
 * guns. What is left here serves flat icons, where a single texture is all that
 * is wanted: the HUD weapon strip, the loadout and armory tiles, weapon pickups
 * and dropped guns.
 *
 * `armMeta.json` still carries `reloadStart`/`reloadEnd` fields; they are null
 * for every weapon and nothing reads them — the authentic reload frames live in
 * `armAnim.json` instead.
 */

export type ArmPivot = { ax: number; ay: number };
export interface ArmMeta {
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Opaque content box `[x, y, w, h]` within the canvas. See `getIcon`. */
  trim?: number[];
}

const meta = META as Record<string, ArmMeta>;

const IDS = Object.keys(meta);
import { artIdFor } from "./weaponArtAlias";

const cache = new Map<string, Texture>();
const iconCache = new Map<string, Texture>();

function key(id: string, frame: number): string {
  return `${id}:${frame}`;
}
function url(id: string, frame: number): string {
  return `${ASSET_BASE}/arms-anim/${id}/${frame}.png?v=${ASSET_V}`;
}

export const ArmArt = {
  loaded: false,

  pivot(id: string): ArmPivot {
    const m = meta[artIdFor(id)] ?? meta.pistol;
    return { ax: m.ax, ay: m.ay };
  },

  /** Load every weapon's rest pose. */
  async load(): Promise<void> {
    await Promise.all(
      IDS.map((id) =>
        Assets.load<Texture>(url(id, 1))
          .then((t) => void cache.set(key(id, 1), t))
          .catch(() => {}),
      ),
    );
    this.loaded = cache.size > 0;
  },

  /** The rest texture — used by the HUD, loadout, customize and pickups. */
  getTexture(id: string): Texture | null {
    id = artIdFor(id);
    return cache.get(key(id, 1)) ?? cache.get(key("pistol", 1)) ?? null;
  },

  /**
   * The rest texture cropped to its opaque pixels.
   *
   * Every arm canvas is 183x183 but the gun itself occupies only 1-5% of it,
   * the rest being the transparent margin the arm needs to swing through. Any
   * caller that scales the whole canvas to fit a box therefore renders the gun
   * as a speck. Use this for flat icons; use `getTexture` where the `ax`/`ay`
   * pivot matters, since that pivot is a fraction of the untrimmed canvas.
   */
  getIcon(id: string): Texture | null {
    id = artIdFor(id);
    const hit = iconCache.get(id);
    if (hit) return hit;

    const full = this.getTexture(id);
    if (!full) return null;
    const t = meta[id]?.trim;
    if (!t) return full;

    const cropped = new Texture({
      source: full.source,
      frame: new Rectangle(t[0], t[1], t[2], t[3]),
    });
    iconCache.set(id, cropped);
    return cropped;
  },
};
