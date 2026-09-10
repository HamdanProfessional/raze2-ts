import { Container, Graphics } from "pixi.js";

/**
 * A single ragdoll body-part's display object. Ported from RdContainer.as (a
 * Sprite that held a costume MovieClip and could re-select its frame).
 *
 * The physics engine sets this container's x/y/rotation each frame from the
 * body. The actual limb art lives as a child, positioned by the art provider.
 * Until the real sprite pipeline is wired up (task 7), a placeholder Graphic
 * sized to exactly match the physics fixture is drawn instead, so the ragdoll
 * is visible and debuggable.
 */

export type PartKind =
  | "body"
  | "head"
  | "upperArm"
  | "lowerArm"
  | "hand"
  | "upperLeg"
  | "lowerLeg"
  | "foot";

/** Everything needed to draw one part, in pixel space. */
export interface PartSpec {
  kind: PartKind;
  /** Costume frame group (unit.costume.body/head/legs). */
  costume: number;
  /** Full width (box) or diameter (circle), in px, already scaled. */
  widthPx: number;
  /** Full height in px (== widthPx for circles), already scaled. */
  heightPx: number;
  isCircle: boolean;
  /** Shape centre offset from the body origin, in px (already scaled/flipped). */
  offsetXPx: number;
  offsetYPx: number;
  scale: number;
  flip: number;
}

/**
 * Injected by the asset pipeline to supply real limb sprites. Returns a
 * display object to add as the part's art, or null to fall back to placeholder.
 */
export type PartArtProvider = (spec: PartSpec) => Container | null;

let artProvider: PartArtProvider = () => null;
export function setPartArtProvider(p: PartArtProvider): void {
  artProvider = p;
}

// Placeholder colours per part kind (temporary art only).
const PLACEHOLDER_COLORS: Record<PartKind, number> = {
  body: 0x3a4a5a,
  head: 0xd8b090,
  upperArm: 0x4a5a6a,
  lowerArm: 0x556575,
  hand: 0xd8b090,
  upperLeg: 0x35424f,
  lowerLeg: 0x3f4c59,
  foot: 0x222222,
};

export class RdContainer extends Container {
  readonly costume: number;

  constructor(spec: PartSpec) {
    super();
    this.costume = spec.costume;

    const art = artProvider(spec);
    if (art) {
      this.addChild(art);
    } else {
      this.addChild(this.buildPlaceholder(spec));
    }
  }

  private buildPlaceholder(spec: PartSpec): Graphics {
    const g = new Graphics();
    const color = PLACEHOLDER_COLORS[spec.kind];
    if (spec.isCircle) {
      const r = spec.widthPx / 2;
      g.circle(spec.offsetXPx, spec.offsetYPx, r);
    } else {
      g.rect(
        spec.offsetXPx - spec.widthPx / 2,
        spec.offsetYPx - spec.heightPx / 2,
        spec.widthPx,
        spec.heightPx,
      );
    }
    g.fill({ color, alpha: 0.95 });
    g.stroke({ color: 0x000000, width: 1, alpha: 0.4 });
    return g;
  }
}
