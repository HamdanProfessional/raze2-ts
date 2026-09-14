import { Assets, Rectangle, Sprite, Texture } from "pixi.js";
import { ASSET_BASE, ASSET_V } from "../core/Config";
import RAGDOLL_RIG from "./raze2/ragdollRig.json";

/**
 * Corpse limb art — the eight `Phys*` clips `PhysActor` builds a ragdoll from,
 * baked by `tools/ragdoll/build_ragdoll.py`.
 *
 * These are the SAME clips the live character is assembled from (see
 * `SkinArt`/`skinAnim.json`): Raze 2 costumes a unit by pushing ONE index —
 * `unit.MC.curSkin` — into every part clip, and `PhysActor` re-reads that same
 * index when it builds the corpse. So a ragdoll is not a separate costume
 * system; it is the living character's own parts, cut loose.
 *
 * One strip per part, one cell per reachable skin frame. `ox`/`oy` are the SWF
 * registration point inside a cell: `PhysWorld` sets `sprite.x/y` straight from
 * the body position and rotates the clip about that registration point, so
 * anchoring there is what makes a limb pivot where it was jointed rather than
 * swinging around its own centre.
 */

export type PartKind =
  | "body" | "head" | "hand" | "foot"
  | "upperArm" | "lowerArm" | "upperLeg" | "lowerLeg";

interface PartDef {
  cid: number;
  /** Cell size in SWF px (the strip is baked at `supersample` times this). */
  cell: [number, number];
  ox: number;
  oy: number;
  /** Per-skin rendered content size, the input to the original's hitbox. */
  hit: [number, number][];
}

interface Rig {
  supersample: number;
  frames: number[];
  abilityOffset: [number, number];
  parts: Record<PartKind, PartDef>;
}

const rig = RAGDOLL_RIG as unknown as Rig;

/**
 * The original's collision shapes are derived, never authored:
 *   SetAsBox(clip.width * 0.8 / 60, clip.height * 0.8 / 60)
 * i.e. a box 0.8x the art, centred on the registration point.
 */
export const HIT_SHRINK = 0.8;

const strips = new Map<PartKind, Texture>();
const frames = new Map<string, Texture>();

export const RagdollArt = {
  loaded: false,
  rig,

  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(rig.parts) as PartKind[]).map((kind) =>
        Assets.load<Texture>(`${ASSET_BASE}/ragdoll/${kind}.png?v=${ASSET_V}`)
          .then((t) => void strips.set(kind, t))
          .catch(() => {}),
      ),
    );
    this.loaded = strips.size === Object.keys(rig.parts).length;
  },

  /**
   * Column for a skin frame. Frames are sparse (1..14, 50..55, 100..104,
   * 150..155), so an unknown frame falls back to the first column rather than
   * indexing off the end — a corpse in the wrong costume beats no corpse.
   */
  column(skinFrame: number): number {
    const i = rig.frames.indexOf(skinFrame);
    return i < 0 ? 0 : i;
  },

  /** Whether this skin frame has real art (vs. falling back to column 0). */
  has(skinFrame: number): boolean {
    return rig.frames.indexOf(skinFrame) >= 0;
  },

  /** Sub-texture for one part in one costume. */
  texture(kind: PartKind, skinFrame: number): Texture | null {
    const strip = strips.get(kind);
    if (!strip) return null;
    const col = this.column(skinFrame);
    const key = `${kind}:${col}`;
    const cached = frames.get(key);
    if (cached) return cached;

    const s = rig.supersample;
    const def = rig.parts[kind];
    const w = Math.round(def.cell[0] * s);
    const h = Math.round(def.cell[1] * s);
    const tex = new Texture({
      source: strip.source,
      frame: new Rectangle(col * w, 0, w, h),
    });
    frames.set(key, tex);
    return tex;
  },

  /** Art size in SWF px for this costume — what the hitbox is derived from. */
  artSize(kind: PartKind, skinFrame: number): [number, number] {
    const def = rig.parts[kind];
    return def.hit[this.column(skinFrame)] ?? def.cell;
  },

  /** Where the back-slot (backpack / CTF flag) hangs off the torso origin. */
  abilityOffset(): [number, number] {
    return rig.abilityOffset;
  },

  /**
   * A limb sprite anchored on its registration point, at 1:1 with the SWF.
   *
   * `flip` mirrors about that anchor, matching `clip.scaleX = flip`.
   */
  sprite(kind: PartKind, skinFrame: number, flip: number): Sprite | null {
    const tex = this.texture(kind, skinFrame);
    if (!tex) return null;
    const def = rig.parts[kind];
    const sp = new Sprite(tex);
    sp.anchor.set(def.ox / def.cell[0], def.oy / def.cell[1]);
    sp.scale.set((flip < 0 ? -1 : 1) / rig.supersample, 1 / rig.supersample);
    return sp;
  },
};
