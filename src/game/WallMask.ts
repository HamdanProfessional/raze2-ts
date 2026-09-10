import { Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import RAZE2_MAPS from "../assets/raze2maps.json";

/**
 * Per-tick movement modifiers for a terrain surface (doc 12 §2.3 / doc 01 §7).
 * All multipliers default neutral (1) / additive default 0; `resetMods()` in the
 * unit restores these each frame, so a surface's effect is not sticky. Values
 * are the authentic Raze 2 `Movement` mods keyed off the wall-bitmap RGB.
 */
export interface SurfaceMods {
  /** Debug/identification name (mud/ice/snow/…). */
  type: string;
  modSpeed: number; // ground/air accel multiplier
  modMax: number; // top-speed multiplier
  modBrake: number; // idle-brake multiplier
  modJump: number; // jump-impulse multiplier
  modGrav: number; // gravity accel + terminal-velocity multiplier
  modSlide: number; // slope-slide coefficient (× body lean)
  modMove: number; // constant horizontal push (conveyor), px/tick
  /** Self-damage per tick (0 = none; 9999 = instant-death zone). */
  damage: number;
  /** Douses fire status on water surfaces (no-op if the port has no fire DoT). */
  douseFire: boolean;
  /** Mega-jump tile: a pressed jump launches with `modJump` like a pad (f00007). */
  mega: boolean;
}

/** A jump pad the feet are over: tiered launch power + horizontal kick. */
export interface PadHit {
  power: number;
  dirX: number;
}

/** Neutral surface bundle (no colour under the feet). */
const NEUTRAL: Readonly<SurfaceMods> = Object.freeze({
  type: "none", modSpeed: 1, modMax: 1, modBrake: 1, modJump: 1, modGrav: 1,
  modSlide: 0, modMove: 0, damage: 0, douseFire: false, mega: false,
});

/** A decoded special-layer entry: either a terrain surface or a jump pad. */
type SpecialEntry = { pad: null; surf: SurfaceMods } | { pad: PadHit; surf: null };

/** Build a terrain entry from partial overrides on the neutral bundle. */
function surf(type: string, o: Partial<SurfaceMods>): SpecialEntry {
  return { pad: null, surf: { ...NEUTRAL, type, ...o } };
}
function pad(power: number, dirX: number): SpecialEntry {
  return { pad: { power, dirX }, surf: null };
}

/**
 * Wall-bitmap RGB → special-surface entry (doc 12 §2.3). Terrain colours carry
 * the authentic `Movement` mod bundle; the `00fff*`/`00ccf*` cyan family are the
 * jump-pad tiers (straight) and diagonal (kicking) variants. `f00007` is the
 * hazard+megajump combo (damage tile that also boosts a pressed jump). Keyed by
 * packed 0xRRGGBB so decode is an exact lookup (the special PNG is crisp). */
const SURFACE_TABLE: Record<number, SpecialEntry> = {
  // --- terrain ---
  0x993300: surf("mud", { modSpeed: 0.3, modBrake: 0.25, modSlide: 0.2 }),
  0xccffff: surf("ice", { modSpeed: 0.3, modBrake: 1, modSlide: 0.3 }),
  0xffffff: surf("snow", { modBrake: 3 }),
  0xcccccc: surf("sand", {}),
  0x650065: surf("lowgrav", { modJump: 0.3, modGrav: 0.6 }),
  0x6699ff: surf("waterShallow", { modMax: 0.75, modJump: 0.3, modGrav: 0.6, modBrake: 2, douseFire: true }),
  0x000099: surf("waterDeep", { modMax: 0.75, modJump: 0.75, modBrake: 2, douseFire: true }),
  0x00ff00: surf("toxic", { modMax: 0.6, modJump: 0.6, modBrake: 2 }),
  0x666666: surf("conveyorR", { modMove: 8 }),
  0x999999: surf("conveyorL", { modMove: -8 }),
  0x320000: surf("death", { damage: 9999 }),
  0x300000: surf("dot", { damage: 0.5 }),
  0xf00007: surf("hazardPad", { damage: 0.5, modJump: 2.6, mega: true }),
  // --- tutorial markers: no movement effect, read by the walkthrough script ---
  // A volume the player walks into to clear a step; painted over walk-through
  // (translucent) geometry, so it is found by `surfaceTypeAt`, not `surfaceUnder`.
  0xff00ff: surf("tutStep", {}),
  // A wall the player has to shoot open; painted on solid geometry, so it is
  // only ever found by a bullet's impact test.
  0x9900ff: surf("tutWall", {}),
  // --- jump pads: straight tiers ---
  0x00fff1: pad(1.2, 0), 0x00fff2: pad(1.4, 0), 0x00fff3: pad(1.6, 0),
  0x00fff4: pad(1.75, 0), 0x00fff5: pad(1.9, 0), 0x00fff6: pad(2.2, 0),
  0x00fff7: pad(2.65, 0), 0x00fff8: pad(2.8, 0), 0x00fff9: pad(3.3, 0),
  // --- jump pads: diagonal (horizontal kick) ---
  0x00ccff: pad(1.8, -28), 0x00ccf3: pad(0.9, 37), 0x00ccf9: pad(1.2, -40),
  0x00ccf4: pad(1.3, 55), 0x00ccf8: pad(1.3, -55),
};

/**
 * Pixel-mask collision for the Raze 2 maps.
 *
 * Raze 2 (unlike the rect-built Raze 1 levels in this port) collided units
 * against a per-map `wall` BitmapData — a solid silhouette of the level
 * geometry, transparent where a unit may stand/move. We reproduce that: the
 * extracted `<map>_mask.png` is decoded once into a 1-bit-per-pixel solidity
 * grid, and the kinematic controller (Unit) samples it directly. World
 * coordinates map 1:1 onto mask pixels (the SWF used arena-space pixels), so
 * no camera/zoom transform is needed.
 */
export class WallMask {
  readonly width: number;
  readonly height: number;
  /** 1 = solid, 0 = empty, row-major (y*width + x). */
  private readonly solid: Uint8Array;

  /** Lazily-built white-on-transparent silhouette of the solid pixels, cached.
   *  Used by the debug hitbox overlay and the minimap — one pixel-perfect
   *  texture beats a blocky cell grid (slopes read as slopes). Tint/alpha are
   *  applied by the consuming Sprite. */
  private silTex: Texture | null = null;

  /** Special-surface layer, decoded from `<map>_special.png`. Each cell holds a
   *  code (0 = plain, else 1-based index into `specialEntries`). Null until a
   *  special layer is attached (maps without one degrade to plain terrain). */
  private special: Uint8Array | null = null;
  private specialEntries: SpecialEntry[] = [];

  constructor(width: number, height: number, solid: Uint8Array) {
    this.width = width;
    this.height = height;
    this.solid = solid;
  }

  /** Attach a decoded special-surface layer (same dimensions as the mask). */
  setSpecial(codes: Uint8Array, entries: SpecialEntry[]): void {
    this.special = codes;
    this.specialEntries = entries;
  }

  private specialAt(x: number, y: number): SpecialEntry | null {
    if (!this.special) return null;
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return null;
    const code = this.special[yi * this.width + xi];
    return code === 0 ? null : this.specialEntries[code - 1] ?? null;
  }

  /**
   * Terrain surface under a world point (feet at `y+1`), or null if none. Returns
   * the authentic per-tick `Movement` mod bundle (mud/ice/snow/sand/water/toxic/
   * conveyor/low-grav/damage). Jump-pad pixels return null here — use
   * `jumpPadAt` for those.
   */
  surfaceTypeAt(x: number, y: number): SurfaceMods | null {
    const e = this.specialAt(x, y);
    return e && e.surf ? e.surf : null;
  }

  /**
   * Jump pad under a world point, or null. `power` is the launch multiplier on
   * the base jump impulse (tiers 1.2×–3.3×); `dirX` is the hard horizontal
   * velocity snap for the 5 diagonal variants (0 for straight pads).
   */
  jumpPadAt(x: number, y: number): PadHit | null {
    const e = this.specialAt(x, y);
    return e && e.pad ? e.pad : null;
  }

  /** A cached Texture whose opaque-white pixels trace the solid silhouette
   *  (everything else transparent). World coords map 1:1 onto it. */
  silhouetteTexture(): Texture {
    if (this.silTex) return this.silTex;
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d");
    if (ctx) {
      const img = ctx.createImageData(this.width, this.height);
      const d = img.data;
      for (let i = 0; i < this.solid.length; i++) {
        if (this.solid[i] === 1) {
          const o = i * 4;
          d[o] = 255;
          d[o + 1] = 255;
          d[o + 2] = 255;
          d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    this.silTex = Texture.from(c);
    return this.silTex;
  }

  /** Solid at a world point? Out-of-bounds reads as empty (arena bounds rects
   *  guard the edges so units can't leave the world). */
  solidAt(x: number, y: number): boolean {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return false;
    return this.solid[yi * this.width + xi] === 1;
  }

  /**
   * Topmost walking surface in column `x`, searched over [feet-band, feet+band]:
   * the highest y whose pixel is solid while the pixel above it is empty (an
   * air→solid boundary the feet can rest on). Null if nothing in range.
   */
  surfaceUnder(x: number, feet: number, band: number): number | null {
    const xi = x | 0;
    if (xi < 0 || xi >= this.width) return null;
    const yTop = Math.max(1, (feet - band) | 0);
    const yBot = Math.min(this.height - 1, (feet + band) | 0);
    for (let y = yTop; y <= yBot; y++) {
      if (this.solid[y * this.width + xi] === 1 && this.solid[(y - 1) * this.width + xi] === 0) {
        return y;
      }
    }
    return null;
  }

  /** Any solid pixel in the vertical span [y0,y1] at column x? Used for
   *  side-wall tests (leading edge of a horizontal move). */
  solidColumn(x: number, y0: number, y1: number): boolean {
    const xi = x | 0;
    if (xi < 0 || xi >= this.width) return false;
    const a = Math.max(0, Math.min(y0, y1) | 0);
    const b = Math.min(this.height - 1, Math.max(y0, y1) | 0);
    for (let y = a; y <= b; y++) if (this.solid[y * this.width + xi] === 1) return true;
    return false;
  }

  /** Decode a mask PNG into a solidity grid (alpha > 128 = solid). */
  static fromUrl(url: string): Promise<WallMask> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return reject(new Error("no 2d context"));
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, img.width, img.height);
        const n = img.width * img.height;
        const solid = new Uint8Array(n);
        for (let i = 0; i < n; i++) solid[i] = data[i * 4 + 3] > 128 ? 1 : 0;
        resolve(new WallMask(img.width, img.height, solid));
      };
      img.onerror = () => reject(new Error(`mask load failed: ${url}`));
      img.src = url;
    });
  }

  /**
   * Decode a `<map>_special.png` into this mask's special-surface layer. Each
   * opaque pixel's exact RGB is matched against `SURFACE_TABLE`; unmatched or
   * transparent pixels are plain (code 0). The PNG is rendered crisp (no
   * anti-aliasing) at 1:1 world scale, so an exact colour lookup is reliable.
   */
  loadSpecial(url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width;
        const h = img.height;
        // The special layer must line up 1:1 with the collision mask.
        if (w !== this.width || h !== this.height) {
          resolve();
          return;
        }
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve();
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, w, h);
        const n = w * h;
        const codes = new Uint8Array(n);
        const entries: SpecialEntry[] = [];
        const codeByRgb = new Map<number, number>();
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          if (data[o + 3] < 128) continue;
          const rgb = (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
          let code = codeByRgb.get(rgb);
          if (code === undefined) {
            const entry = SURFACE_TABLE[rgb];
            if (!entry) {
              codeByRgb.set(rgb, 0); // unknown colour → plain
              continue;
            }
            entries.push(entry);
            code = entries.length; // 1-based
            codeByRgb.set(rgb, code);
          }
          if (code !== 0) codes[i] = code;
        }
        this.setSpecial(codes, entries);
        resolve();
      };
      img.onerror = () => resolve(); // graceful: map keeps plain terrain
      img.src = url;
    });
  }
}

const cache = new Map<string, WallMask>();
const pending = new Map<string, Promise<void>>();
/** Extra collision variants for maps that restage their geometry, by level id. */
const frames = new Map<string, WallMask[]>();

/** Decode one mask plus the special layer that sits alongside it by convention. */
function loadPair(mask: string): Promise<WallMask> {
  const special = mask.replace(/_mask\.png$/, "_special.png");
  return WallMask.fromUrl(`${ASSET_BASE}/levels/${mask}`).then(async (wm) => {
    await wm.loadSpecial(`${ASSET_BASE}/levels/${special}`);
    return wm;
  });
}

/**
 * Decoded Raze 2 map masks, keyed by the namespaced level id (`r2_<id>`), so
 * the (synchronous) Arena constructor can pull a ready mask from the cache.
 * Mirrors assets/Backgrounds.ts.
 */
export const WallMasks = {
  /**
   * Decode one map's collision mask, once. Each mask is a ~5-megapixel PNG
   * walked pixel by pixel twice — solidity, then the special layer — so doing
   * all ten at boot stalled the main thread for maps that are never played.
   * Must be awaited before an Arena is constructed for that level.
   */
  async ensure(id: string): Promise<void> {
    if (cache.has(id)) return;
    const inFlight = pending.get(id);
    if (inFlight) return inFlight;
    const m = (RAZE2_MAPS as Record<string, { mask?: string; frames?: string[] }>)[id.replace(/^r2_/, "")];
    if (!m?.mask) return;
    // Alongside the alpha solidity mask, load the RGB special-surface layer
    // (`<map>_special.png`) that carries the terrain-effect + jump-pad colours
    // the alpha mask discarded — additive, collision still uses the mask.
    const job = (m.frames?.length
      ? Promise.all(m.frames.map(loadPair)).then((all) => {
          frames.set(id, all);
          cache.set(id, all[0]);
        })
      : loadPair(m.mask).then((wm) => {
          cache.set(id, wm);
        })
    ).catch(() => {});
    pending.set(id, job);
    return job;
  },

  get(id: string): WallMask | null {
    return cache.get(id) ?? null;
  },

  /** One of a restaging map's collision variants, 1-based. Null if out of range
   *  or if the map has only the single mask. */
  frame(id: string, n: number): WallMask | null {
    return frames.get(id)?.[n - 1] ?? null;
  },
};
