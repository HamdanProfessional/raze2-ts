import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import RAZE2_MAPS from "./raze2maps.json";

/**
 * Level background textures.
 *
 * The ten Raze 2 backdrops are ~23-megapixel PNGs — 90 MB on the wire and about
 * 900 MB of VRAM once decoded — for art a match uses exactly one of. Boot loads
 * only the small Raze 1 art and one baked thumbnail per Raze 2 map (~5 MB all
 * told); the full-size backdrop is fetched by `ensureLevel` before the match
 * starts, so the Arena constructor (which is synchronous) still finds a ready
 * texture in the cache.
 */

// Level id -> asset filename (relative to ASSET_BASE/bg).
const FILES: Record<string, string> = {
  city: "city.jpg",
  space: "space.jpg",
  toxic: "toxic.png",
  pit: "pit.png",
};

// Authentic full-level art (bg+foreground) extracted from the SWF, keyed
// `lvl_<id>`. Present only for levels whose collision has been matched.
const LEVEL_FILES: Record<string, string> = {
  city: "levels/city.png",
  toxic: "levels/toxic.png",
  pit: "levels/pit.png",
  space: "levels/space.png",
};

const RAZE2 = RAZE2_MAPS as unknown as Record<string, { bg?: string }>;

const cache = new Map<string, Texture>();
const pending = new Map<string, Promise<void>>();

function url(file: string): string {
  return `${ASSET_BASE}/${file}`;
}

/** Load `file` into `key` once; concurrent callers share the same request. */
function load(key: string, file: string): Promise<void> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = Assets.load<Texture>(url(file))
    .then((t) => void cache.set(key, t))
    .catch(() => {});
  pending.set(key, job);
  return job;
}

export const Backgrounds = {
  /** Boot pass: the Raze 1 level art plus every map's menu thumbnail. */
  async loadCore(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [id, file] of Object.entries(FILES)) jobs.push(load(id, `bg/${file}`));
    for (const [id, file] of Object.entries(LEVEL_FILES)) jobs.push(load(`lvl_${id}`, file));
    for (const [id, m] of Object.entries(RAZE2)) {
      if (m?.bg) jobs.push(load(`thumb_r2_${id}`, `levels/raze2/thumbs/${id}.webp`));
    }
    await Promise.all(jobs);
  },

  /**
   * Fetch the full-size backdrop `levelId` will be drawn with. Must resolve
   * before an Arena is constructed for that level. No-op for the Raze 1 levels,
   * whose art is small enough to hold from boot.
   */
  async ensureLevel(levelId: string): Promise<void> {
    if (cache.has(levelId) || !levelId.startsWith("r2_")) return;
    const bg = RAZE2[levelId.slice(3)]?.bg;
    if (bg) await load(levelId, `levels/${bg}`);
  },

  /** Cached background texture for a level, or null if none is loaded. */
  getTexture(levelId: string): Texture | null {
    return cache.get(levelId) ?? null;
  },

  /**
   * Menu-sized preview for a level: the baked thumbnail, falling back to the
   * full art if the match that needs it has already pulled it in.
   */
  getThumb(levelId: string): Texture | null {
    return cache.get(`thumb_${levelId}`) ?? cache.get(levelId) ?? null;
  },
};
