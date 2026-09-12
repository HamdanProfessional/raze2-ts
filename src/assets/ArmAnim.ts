import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import ARM_ANIM from "./raze2/armAnim.json";

/**
 * Authentic Raze 2 arms — idle, recoil and reload, per skin and per gun.
 *
 * `UnitMC` carries two arm assemblies and `Guns.as:234-249` drives both off one
 * playhead, so they share every bit of state — position, rotation and frame:
 *
 *     arm1  DefineSprite_387  armup + armlow + hand1 + gun + hand2
 *     arm2  DefineSprite_136  armup + armlow            (drawn behind the body)
 *
 *     setFrame("idle")   -> arm1/arm2.gotoAndStop(curGun.frameIdle)
 *     setFrame("fire")   -> arm1/arm2.gotoAndPlay(curGun.frameFire + "_fire")
 *     setFrame("reload") -> arm1/arm2.gotoAndPlay(curGun.frameReload + "_reload")
 *     UnitMC.as:103-109     arm1.x = arm2.x = arm1hold.x  (one shoulder)
 *     Unit.as:1123/1129     arm1.rotation = arm2.rotation = rotReload + rotArm
 *
 * Of all those children only `gun` is weapon-specific (the 37-frame
 * DefineSprite_380 strip, indexed by `curGun.sprite`). Everything else is a SKIN
 * strip, frame-selected at runtime like the body. The bake is split on exactly
 * that seam — `tools/arm-reload/build_arms.py`:
 *
 *     skin/<skin>/<pose>.png   arm + hand art, no gun    31 x 6 sheets
 *     gun/<weapon>.png         gun art, no arm           36 sheets
 *
 * which is why a unit's arm now matches its skin instead of every unit wearing
 * the default soldier's arm, and why the gun art is stored once rather than
 * duplicated against all 31 skins.
 *
 * A skin sheet holds three bands of `count` cells, because the gun draws
 * BETWEEN `hand1` and `hand2` — the forward hand grips over the weapon:
 *
 *     band "back"   armup + armlow + hand1   arm1, behind the gun
 *     band "front"  hand2                    arm1, in front of the gun
 *     band "arm2"   armup + armlow           the back arm
 *
 * Cell index for band b, frame f is `bands[b] * count + f`. All four layers
 * share one cell size and one `anchor`, so the renderer places them at a single
 * point with a single rotation and only the z-order differs.
 */

export interface ArmPose {
  count: number;
  idle: number;
  fire: [number, number];
  reload: [number, number];
  rows: number;
  gunRows: number;
}
export type ArmBand = "back" | "front" | "arm2";

interface ArmAnimManifest {
  /** Cell size in TEXTURE pixels (logical size x `supersample`). */
  cell: [number, number];
  cols: number;
  anchor: [number, number];
  /**
   * Multiplier back to logical on-screen size. The sheets are supersampled
   * because the renderer draws at `scale x devicePixelRatio` (Engine), which is
   * ~1.7x on a 1080p window and up to 4x hi-dpi -- a 1x bake was being magnified
   * the whole way. Same convention as skinAnim.json. Older manifests omit it.
   */
  scale?: number;
  bands: Record<ArmBand, number>;
  note: string;
  poses: Record<string, ArmPose>;
  weapons: Record<string, string>;
  /** Per-weapon bbox of the gun in its idle cell, [x, y, w, h] in texture px. */
  gunTrim?: Record<string, [number, number, number, number]>;
  skins: string[];
}

const manifest = ARM_ANIM as unknown as ArmAnimManifest;
const [CW, CH] = manifest.cell;
const COLS = manifest.cols;
const ART_SCALE = manifest.scale ?? 1;

/** The skin every unit falls back to until its own sheet has arrived. */
const DEFAULT_SKIN = "raze";

const gunSheets = new Map<string, Texture>();
const skinSheets = new Map<string, Texture>();
const frames = new Map<string, Texture>();
const pending = new Set<string>();

const GUN_IDS = Object.keys(manifest.weapons);

const gunUrl = (id: string) => `${ASSET_BASE}/arms-r2/gun/${id}.png?v=${ASSET_V}`;
const skinUrl = (skin: string, pose: string) =>
  `${ASSET_BASE}/arms-r2/skin/${skin}/${pose}.png?v=${ASSET_V}`;

/** Slice a cell out of a loaded sheet, memoised. */
function cellOf(sheet: Texture, key: string, i: number): Texture {
  let tex = frames.get(key);
  if (!tex) {
    tex = new Texture({
      source: sheet.source,
      frame: new Rectangle((i % COLS) * CW, Math.floor(i / COLS) * CH, CW, CH),
    });
    frames.set(key, tex);
  }
  return tex;
}

function loadOnce(key: string, url: string, into: Map<string, Texture>): void {
  if (into.has(key) || pending.has(key)) return;
  pending.add(key);
  void Assets.load<Texture>(url)
    .then((t) => void into.set(key, t))
    .catch(() => {})
    .finally(() => void pending.delete(key));
}

export const ArmAnim = {
  /** Multiplier from baked texture pixels back to logical on-screen pixels. */
  scale: ART_SCALE,

  loaded: false,
  manifest,

  /** Shoulder origin as a sprite anchor — the point both arms rotate about. */
  anchor(): { x: number; y: number } {
    return { x: manifest.anchor[0], y: manifest.anchor[1] };
  },

  /** Whether this weapon has authentic Raze 2 arm art baked. */
  has(id: string): boolean {
    return !!id && !!manifest.weapons[id];
  },

  /** The weapon's pose bands (cell indices), or null if it has no bake. */
  pose(id: string): ArmPose | null {
    const p = manifest.weapons[id];
    return p ? (manifest.poses[p] ?? null) : null;
  },

  /**
   * Start the loads this unit needs: the weapon's gun sheet and the arm sheet
   * for its skin. Safe to call every frame. Until the skin sheet lands the arm
   * renders in the default skin rather than vanishing, so a unit that spawns
   * on a cold cache never flickers a missing limb.
   */
  ensure(weaponId: string, skinId?: string): void {
    const pose = manifest.weapons[weaponId];
    if (!pose) return;
    loadOnce(weaponId, gunUrl(weaponId), gunSheets);
    const skin = skinId && manifest.poses[pose] ? skinId : DEFAULT_SKIN;
    const key = `${skin}/${pose}`;
    loadOnce(key, skinUrl(skin, pose), skinSheets);
  },

  /**
   * Load every pose sheet for one skin up front.
   *
   * `ensure` only streams a pose in when a weapon first needs it, and until it
   * lands `skinCell` draws the DEFAULT_SKIN arm over this unit's own body — so
   * a Commander-bodied bot wears the plain Raze soldier's arms for a moment.
   * Because the sheets are per *pose*, it recurs on every switch into a new
   * pose group, which is what made it look like a unit's skin was changing at
   * random rather than just loading late.
   *
   * A roster only holds a handful of distinct skins and the sheets are small,
   * so front-loading all six poses per skin is cheap insurance.
   */
  preloadSkin(skinId: string): void {
    if (!skinId || skinId === DEFAULT_SKIN) return;
    for (const p of Object.keys(manifest.poses)) {
      loadOnce(`${skinId}/${p}`, skinUrl(skinId, p), skinSheets);
    }
  },

  /**
   * The weapon alone, cropped tight, for menu chrome (armoury / loadout).
   *
   * `gunCell` hands back the whole 225x267 cell, which is mostly the empty field
   * the arm swings through -- fitting that to a plate renders the gun as a
   * speck. This trims to the art's own bbox, so a caller can size by the weapon
   * rather than by the cell. Loads the sheet on first ask and returns null until
   * it lands, so callers must be prepared to rebuild.
   */
  gunIcon(weaponId: string): Texture | null {
    const pose = this.pose(weaponId);
    if (!pose) return null;
    loadOnce(weaponId, gunUrl(weaponId), gunSheets);
    const sheet = gunSheets.get(weaponId);
    if (!sheet) return null;
    const trim = manifest.gunTrim?.[weaponId];
    const i = pose.idle;
    if (!trim) return cellOf(sheet, `g:${weaponId}:${i}`, i);
    const key = `icon:${weaponId}`;
    let tex = frames.get(key);
    if (!tex) {
      tex = new Texture({
        source: sheet.source,
        frame: new Rectangle(
          (i % COLS) * CW + trim[0],
          Math.floor(i / COLS) * CH + trim[1],
          trim[2], trim[3],
        ),
      });
      frames.set(key, tex);
    }
    return tex;
  },

  /** The weapon's gun art for a 0-based band cell. */
  gunCell(weaponId: string, cell: number): Texture | null {
    const pose = this.pose(weaponId);
    const sheet = gunSheets.get(weaponId);
    if (!pose || !sheet) return null;
    const i = Math.max(0, Math.min(Math.round(cell), pose.count - 1));
    return cellOf(sheet, `g:${weaponId}:${i}`, i);
  },

  /**
   * One arm layer for a 0-based band cell. Falls back to the default skin's
   * sheet while this unit's own is still loading.
   */
  skinCell(
    skinId: string | undefined,
    weaponId: string,
    band: ArmBand,
    cell: number,
  ): Texture | null {
    const pose = manifest.weapons[weaponId];
    const info = pose ? manifest.poses[pose] : null;
    if (!pose || !info) return null;
    const want = skinId ?? DEFAULT_SKIN;
    const sheet =
      skinSheets.get(`${want}/${pose}`) ?? skinSheets.get(`${DEFAULT_SKIN}/${pose}`);
    if (!sheet) return null;
    const used = skinSheets.has(`${want}/${pose}`) ? want : DEFAULT_SKIN;
    const f = Math.max(0, Math.min(Math.round(cell), info.count - 1));
    const i = manifest.bands[band] * info.count + f;
    return cellOf(sheet, `s:${used}:${pose}:${i}`, i);
  },

  /**
   * Preload what every match needs regardless of roster: all 36 gun sheets
   * (small, and any of them can be picked up mid-match) plus the default skin's
   * six pose sheets, which back-stop every unit until its own skin arrives.
   * Per-skin sheets stream in on demand via `ensure`.
   */
  async load(): Promise<void> {
    await Promise.all([
      ...GUN_IDS.map((id) =>
        Assets.load<Texture>(gunUrl(id))
          .then((t) => void gunSheets.set(id, t))
          .catch(() => {}),
      ),
      ...Object.keys(manifest.poses).map((p) =>
        Assets.load<Texture>(skinUrl(DEFAULT_SKIN, p))
          .then((t) => void skinSheets.set(`${DEFAULT_SKIN}/${p}`, t))
          .catch(() => {}),
      ),
    ]);
    this.loaded = gunSheets.size > 0;
  },
};
