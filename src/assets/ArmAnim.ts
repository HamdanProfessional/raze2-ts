import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import ARM_ANIM from "./raze2/armAnim.json";

/**
 * Authentic Raze 2 aiming-arm animation — idle, recoil and reload.
 *
 * `Guns.setFrame()` drives the arm clip (`DefineSprite_387`, `Unit_Arms1`) and
 * the clip's own frame scripts drive it back:
 *
 *     setFrame("idle")   -> arm1.gotoAndStop(curGun.frameIdle)
 *     setFrame("fire")   -> arm1.gotoAndPlay(curGun.frameFire + "_fire")
 *     setFrame("reload") -> arm1.gotoAndPlay(curGun.frameReload + "_reload")
 *     ...frame script at the end of each band -> doneShoot() / doneReload(),
 *        both of which call setFrame("idle").
 *
 * So a weapon's *recoil* and its *reload* are both keyframed animation bands,
 * not scripted transforms — which is why `Unit.as:1123` can set the arm's
 * rotation to nothing but aim + reload dip (`MC.arm1.rotation = rotReload +
 * rotArm`) and still show a kicking gun.
 *
 * `tools/arm-reload/build_arms.py` bakes those bands per weapon: the shared
 * pose animation composited with that weapon's own gun art from the 37-frame
 * `DefineSprite_380` strip, exactly as `arm1.gun.gotoAndStop(curGun.sprite)`
 * layers them at runtime. Each weapon gets `idle.png` (one cell, preloaded for
 * the HUD/loadout/pickups) and `anim.png` (its whole band, loaded on equip),
 * both from the same bake so swapping between them cannot pop.
 *
 * armAnim.json:
 *   cell   — [w,h] native px of every cell.
 *   cols   — cells per sheet row; cell n of a band is SWF frame bandStart + n.
 *   anchor — the arm clip's shoulder origin as a fraction of the cell. Set it as
 *            the sprite anchor and rotate there to aim. Baked facing right.
 *   poses  — pose -> { count, idle, fire:[a,b], reload:[a,b] } as 0-based cells.
 *   weapons— weapon id -> pose name.
 */

export interface ArmPose {
  count: number;
  idle: number;
  fire: [number, number];
  reload: [number, number];
  rows: number;
}
interface ArmAnimManifest {
  cell: [number, number];
  cols: number;
  anchor: [number, number];
  skinFrame: number;
  note: string;
  poses: Record<string, ArmPose>;
  weapons: Record<string, string>;
}

const manifest = ARM_ANIM as unknown as ArmAnimManifest;
const [CW, CH] = manifest.cell;
const COLS = manifest.cols;

/** Per-weapon idle texture (preloaded) and full band sheet (lazy). */
const idles = new Map<string, Texture>();
const sheets = new Map<string, Texture>();
const frames = new Map<string, Texture>();
const loading = new Set<string>();

const IDS = Object.keys(manifest.weapons);

function idleUrl(id: string): string {
  return `${ASSET_BASE}/arms-r2/${id}/idle.png`;
}
function animUrl(id: string): string {
  return `${ASSET_BASE}/arms-r2/${id}/anim.png`;
}

export const ArmAnim = {
  loaded: false,
  manifest,

  /** Shoulder origin as a sprite anchor — the point the arm rotates about. */
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

  /** Kick off the lazy load of a weapon's full band sheet. Safe to call often. */
  ensure(id: string): void {
    if (!this.has(id) || sheets.has(id) || loading.has(id)) return;
    loading.add(id);
    void Assets.load<Texture>(animUrl(id))
      .then((t) => void sheets.set(id, t))
      .catch(() => {})
      .finally(() => void loading.delete(id));
  },

  /** The rest pose. Available as soon as `load()` has resolved. */
  idleTexture(id: string): Texture | null {
    return idles.get(id) ?? null;
  },

  /**
   * Sub-texture for a 0-based cell of this weapon's band. Falls back to the
   * idle texture until the sheet has loaded, so a weapon picked up mid-fight
   * still renders rather than blinking out.
   */
  getCell(id: string, cell: number): Texture | null {
    const sheet = sheets.get(id);
    const pose = this.pose(id);
    if (!sheet || !pose) return this.idleTexture(id);
    const i = Math.max(0, Math.min(Math.round(cell), pose.count - 1));
    const key = `${id}:${i}`;
    let tex = frames.get(key);
    if (!tex) {
      tex = new Texture({
        source: sheet.source,
        frame: new Rectangle((i % COLS) * CW, Math.floor(i / COLS) * CH, CW, CH),
      });
      frames.set(key, tex);
    }
    return tex;
  },

  /** Preload every weapon's idle cell. Band sheets load on equip via `ensure`. */
  async load(): Promise<void> {
    await Promise.all(
      IDS.map((id) =>
        Assets.load<Texture>(idleUrl(id))
          .then((t) => void idles.set(id, t))
          .catch(() => {}),
      ),
    );
    this.loaded = idles.size > 0;
  },
};
