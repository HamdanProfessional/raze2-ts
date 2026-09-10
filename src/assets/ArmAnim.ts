import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
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
  cell: [number, number];
  cols: number;
  anchor: [number, number];
  bands: Record<ArmBand, number>;
  note: string;
  poses: Record<string, ArmPose>;
  weapons: Record<string, string>;
  skins: string[];
}

const manifest = ARM_ANIM as unknown as ArmAnimManifest;
const [CW, CH] = manifest.cell;
const COLS = manifest.cols;

/** The skin every unit falls back to until its own sheet has arrived. */
const DEFAULT_SKIN = "raze";

const gunSheets = new Map<string, Texture>();
const skinSheets = new Map<string, Texture>();
const frames = new Map<string, Texture>();
const pending = new Set<string>();

const GUN_IDS = Object.keys(manifest.weapons);

const gunUrl = (id: string) => `${ASSET_BASE}/arms-r2/gun/${id}.png`;
const skinUrl = (skin: string, pose: string) =>
  `${ASSET_BASE}/arms-r2/skin/${skin}/${pose}.png`;

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
