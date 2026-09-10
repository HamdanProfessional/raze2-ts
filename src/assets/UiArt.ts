import { Assets, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";

/**
 * Front-end (menu/title/play) background art.
 *
 * These full-frame backdrops are lifted from the original SWF art and served
 * from public/assets/ui. They are preloaded in the Loader so each screen's
 * synchronous constructor can pull a ready texture from the cache, falling back
 * to a solid colour panel when a texture is unavailable.
 */

// Logical key -> asset filename (relative to ASSET_BASE/ui).
const FILES: Record<string, string> = {
  title: "title.jpg",
  menu: "menu.jpg",
  play: "play.png",
};

// Original SWF button state art (from DefineButton2_1315), relative to
// ASSET_BASE/buttons. The idle pill turns gold on hover and dark on press.
const BUTTON_FILES: Record<string, string> = {
  btn_up: "btn_up.png",
  btn_over: "btn_over.png",
  btn_down: "btn_down.png",
};

const cache = new Map<string, Texture>();

function url(file: string): string {
  return `${ASSET_BASE}/ui/${file}`;
}

function buttonUrl(file: string): string {
  return `${ASSET_BASE}/buttons/${file}`;
}

export const UiArt = {
  loaded: false,

  async loadAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [id, file] of Object.entries(FILES)) {
      jobs.push(
        Assets.load<Texture>(url(file))
          .then((t) => void cache.set(id, t))
          .catch(() => {}),
      );
    }
    for (const [id, file] of Object.entries(BUTTON_FILES)) {
      jobs.push(
        Assets.load<Texture>(buttonUrl(file))
          .then((t) => void cache.set(id, t))
          .catch(() => {}),
      );
    }
    await Promise.all(jobs);
    this.loaded = cache.size > 0;
  },

  /** Cached UI texture for a key, or null if none is loaded. */
  getTexture(key: string): Texture | null {
    return cache.get(key) ?? null;
  },
};
