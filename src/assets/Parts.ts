import { Assets, Sprite, Texture } from "pixi.js";
import { ASSET_BASE } from "../core/Config";
import { setPartArtProvider, type PartKind, type PartSpec } from "../physics/RdContainer";

/**
 * Real character-limb art pipeline.
 *
 * The decompiler rendered every costume frame of each body-part symbol
 * (SsHead/SsBody/…) to a PNG. Those are served from public/assets/parts/<kind>/
 * <frame>.png (frame == the costume value, which already encodes the team
 * colour offset). Frames within a part share one canvas size, so a single
 * anchor per part registers every costume at its joint pivot.
 *
 * Each part's ANCHOR is the pivot point (as a fraction of the PNG) where the
 * limb attaches to its parent — i.e. where the physics body's origin sits. With
 * the sprite anchored there and placed at the RdContainer origin, the ragdoll
 * limb renders correctly and rotates about its joint. flip is handled by a
 * negative scale.x (mirrors about the anchor). Tune ANCHORS if a limb looks
 * offset from its joint.
 */

const ANCHORS: Record<PartKind, { ax: number; ay: number }> = {
  body: { ax: 0.5, ay: 0.5 },
  head: { ax: 0.5, ay: 0.85 },
  upperArm: { ax: 0.5, ay: 0.12 },
  lowerArm: { ax: 0.5, ay: 0.12 },
  hand: { ax: 0.5, ay: 0.2 },
  upperLeg: { ax: 0.5, ay: 0.1 },
  lowerLeg: { ax: 0.5, ay: 0.1 },
  foot: { ax: 0.35, ay: 0.2 },
};

const cache = new Map<string, Texture>();
let ready = false;

function url(kind: PartKind, frame: number): string {
  return `${ASSET_BASE}/parts/${kind}/${frame}.png`;
}
function key(kind: PartKind, frame: number): string {
  return `${kind}:${frame}`;
}

export const Parts = {
  /** Preload a specific set of (kind, frame) textures. Failures are ignored. */
  async load(specs: { kind: PartKind; frame: number }[]): Promise<void> {
    await Promise.all(
      specs.map(async ({ kind, frame }) => {
        const k = key(kind, frame);
        if (cache.has(k)) return;
        try {
          const tex = await Assets.load<Texture>(url(kind, frame));
          cache.set(k, tex);
        } catch {
          /* missing costume frame — provider will fall back to placeholder */
        }
      }),
    );
  },

  /** Preload every costume frame of every part (≈2 MB total). */
  async loadAll(): Promise<void> {
    const counts: Record<PartKind, number> = {
      body: 101, head: 84, upperArm: 84, lowerArm: 83,
      hand: 83, upperLeg: 83, lowerLeg: 83, foot: 84,
    };
    const specs: { kind: PartKind; frame: number }[] = [];
    for (const kind of Object.keys(counts) as PartKind[]) {
      for (let f = 1; f <= counts[kind]; f++) specs.push({ kind, frame: f });
    }
    await this.load(specs);
    ready = true;
  },

  /** True once the limb art is loaded and rigs can be built. */
  ready(): boolean {
    return ready;
  },

  getTexture(kind: PartKind, frame: number): Texture | null {
    return cache.get(key(kind, frame)) ?? null;
  },

  /** The frames a single unit costume needs (head/body/legs groups). */
  costumeSpecs(costume: { head: number; body: number; legs: number }): {
    kind: PartKind;
    frame: number;
  }[] {
    return [
      { kind: "head", frame: costume.head },
      { kind: "body", frame: costume.body },
      { kind: "upperArm", frame: costume.body },
      { kind: "lowerArm", frame: costume.body },
      { kind: "hand", frame: costume.body },
      { kind: "upperLeg", frame: costume.legs },
      { kind: "lowerLeg", frame: costume.legs },
      { kind: "foot", frame: costume.legs },
    ];
  },

  /** Build an anchored, scaled limb sprite for a spec, or null if not loaded. */
  makeSprite(spec: PartSpec): Sprite | null {
    const tex = this.getTexture(spec.kind, spec.costume);
    if (!tex) return null;
    const sp = new Sprite(tex);
    const a = ANCHORS[spec.kind];
    sp.anchor.set(a.ax, a.ay);
    sp.scale.set(spec.scale * spec.flip, spec.scale);
    return sp;
  },

  /** Register as the ragdoll/limb art provider. */
  install(): void {
    setPartArtProvider((spec) => this.makeSprite(spec));
  },
};
