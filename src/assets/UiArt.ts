import { Assets, Sprite, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import RIG from "./uiRig.json";

/**
 * Front-end backdrop art + the baked Raze 2 UI rig.
 *
 * The backdrops (title/menu/play) and one legacy button atlas are SWF art
 * served from public/assets. `uiRig.json` is produced by tools/ui/bake.py: it
 * rasterises the original SWF UI symbols (buttons, pause plates, HUD widgets,
 * scoreboard rows, weapon glyphs...) after stripping their dynamic text and
 * portraits, and records where each symbol's SWF registration point sits inside
 * the PNG so screens can place them in SWF coordinates.
 *
 * Everything is preloaded by the Loader screen. Screens keep their old
 * Graphics-drawn fallbacks for the headless tests (the Pixi stub resolves
 * `Assets.load` but never reads pixels).
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

/** One baked rig entry (see tools/ui/bake.py). */
export interface UiMeta {
  /** Path under ASSET_BASE, e.g. "ui/btn_menu_up.png". */
  file: string;
  /** Size in SWF pixels. */
  w: number;
  h: number;
  /** SWF registration point inside the PNG, in SWF pixels. */
  ax: number;
  ay: number;
  /** Output pixels per SWF pixel (texture is supersampled for crispness). */
  scale: number;
  symbol?: string;
}

/** Baked rig catalog, keyed by asset name ("btn_menu_up", "hud_heart_full"...). */
export const UI_RIG = (RIG as { assets: Record<string, UiMeta> }).assets;

/**
 * Port weapon id -> SWF fuel-glyph label. The catalog ids drifted from the
 * `DefineSprite_1003` frame labels in a few places; utility weapons (thrown
 * abilities etc.) have no HUD glyph at all — the original never shows them in
 * the weapon strip.
 */
const GLYPH_ALIAS: Record<string, string | null> = {
  plaspistol: "plasmapistol",
  alienrifle: "bubrifle",
  arifl2: "arifle2",
  sticklaunch: "stickylauncher",
  sword: "katana",
  grenade: null,
  mine: null,
  bouncer: null,
  env: null,
  fire: null,
};

/** Baked HUD weapon-glyph name for a gun id, or null when it has none. */
export function glyphIdFor(id: string): string | null {
  if (UI_RIG[`glyph_${id}`]) return `glyph_${id}`;
  const alias = GLYPH_ALIAS[id];
  if (alias && UI_RIG[`glyph_${alias}`]) return `glyph_${alias}`;
  return null;
}

const cache = new Map<string, Texture>();

function url(file: string): string {
  return `${ASSET_BASE}/${file}?v=${ASSET_V}`;
}

function buttonUrl(file: string): string {
  return `${ASSET_BASE}/buttons/${file}?v=${ASSET_V}`;
}

export const UiArt = {
  loaded: false,

  async loadAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [id, file] of Object.entries(FILES)) {
      jobs.push(
        Assets.load<Texture>(url(`ui/${file}`))
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
    for (const [id, meta] of Object.entries(UI_RIG)) {
      jobs.push(
        Assets.load<Texture>(url(meta.file))
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

  /** Baked rig metadata for an asset, or null when it wasn't baked. */
  meta(name: string): UiMeta | null {
    return UI_RIG[name] ?? null;
  },

  /** Baked rig texture for an asset, or null when it isn't loaded. */
  r2(name: string): Texture | null {
    return cache.get(name) ?? null;
  },

  /**
   * Build a Sprite for a rig asset, pre-scaled to SWF pixels and anchored so
   * the SWF registration point lands on the sprite's position. Callers set
   * `position` to the original SWF coordinates and add it to the display list.
   */
  r2Sprite(name: string): Sprite | null {
    const tex = cache.get(name);
    const meta = UI_RIG[name];
    if (!tex || !meta) return null;
    const sp = new Sprite(tex);
    sp.anchor.set(meta.w ? meta.ax / meta.w : 0, meta.h ? meta.ay / meta.h : 0);
    sp.scale.set(1 / meta.scale);
    return sp;
  },
};
