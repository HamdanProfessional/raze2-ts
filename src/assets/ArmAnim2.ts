import { Assets, Rectangle, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import ARM_ANIM2 from "./raze2/armAnim2.json";
import { ArmAnim, type ArmPose } from "./ArmAnim";

/**
 * The back arm — `UnitMC.arm2` (`DefineSprite_136`, `Unit_Arms2`).
 *
 * The original rig has two arm assemblies, and the port only ever drew the
 * front one. `arm2` runs the same 384-frame timeline under the same pose
 * labels, but carries only `armup` + `armlow`: no hands, no gun. It is welded
 * to the same shoulder and given the same angle as `arm1`, then drawn behind
 * the body:
 *
 *     UnitMC.as:103-109  arm1.x = arm2.x = arm1hold.x
 *                        arm1.y = arm2.y = arm1hold.y
 *     Unit.as:1123/1129  MC.arm1.rotation = MC.arm2.rotation = rotReload + rotArm
 *     Guns.as:239-248    unit.MC.arm1/arm2.gotoAndStop(frameIdle) / gotoAndPlay(...)
 *
 * So it needs no state of its own — it rides `arm1`'s playhead and transform.
 * With no gun composited in, the bake is keyed by POSE rather than weapon id:
 * six sheets covering the whole roster, ~70 KB all told, so unlike `ArmAnim`
 * there is nothing to load lazily.
 */

interface ArmAnim2Manifest {
  cell: [number, number];
  cols: number;
  anchor: [number, number];
  skinFrame: number;
  note: string;
  poses: Record<string, ArmPose>;
}

const manifest = ARM_ANIM2 as unknown as ArmAnim2Manifest;
const [CW, CH] = manifest.cell;
const COLS = manifest.cols;

const idles = new Map<string, Texture>();
const sheets = new Map<string, Texture>();
const frames = new Map<string, Texture>();

const POSES = Object.keys(manifest.poses);

/** The pose band a weapon plays, shared with the front arm's manifest. */
function poseOf(weaponId: string): string | null {
  return ArmAnim.manifest.weapons[weaponId] ?? null;
}

export const ArmAnim2 = {
  loaded: false,
  manifest,

  /** Shoulder origin as a sprite anchor — the same point `arm1` rotates about. */
  anchor(): { x: number; y: number } {
    return { x: manifest.anchor[0], y: manifest.anchor[1] };
  },

  has(weaponId: string): boolean {
    const p = poseOf(weaponId);
    return !!p && !!manifest.poses[p];
  },

  /** Sub-texture for a 0-based cell of this weapon's band. */
  getCell(weaponId: string, cell: number): Texture | null {
    const p = poseOf(weaponId);
    if (!p) return null;
    const band = manifest.poses[p];
    const sheet = sheets.get(p);
    if (!sheet || !band) return idles.get(p) ?? null;
    const i = Math.max(0, Math.min(Math.round(cell), band.count - 1));
    const key = `${p}:${i}`;
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

  async load(): Promise<void> {
    await Promise.all(
      POSES.flatMap((p) => [
        Assets.load<Texture>(`${ASSET_BASE}/arms2-r2/${p}/idle.png`)
          .then((t) => void idles.set(p, t))
          .catch(() => {}),
        Assets.load<Texture>(`${ASSET_BASE}/arms2-r2/${p}/anim.png`)
          .then((t) => void sheets.set(p, t))
          .catch(() => {}),
      ]),
    );
    this.loaded = sheets.size > 0;
  },
};
