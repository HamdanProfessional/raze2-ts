import { Container, Graphics, Sprite } from "pixi.js";
import { RagdollArt, type PartKind } from "../assets/RagdollArt";
import { AbilityArt } from "../assets/AbilityArt";

export type { PartKind };

/**
 * One ragdoll body-part's display object. Ported from the `userData` Sprite
 * `PhysActor.createPart` hangs off each b2Body.
 *
 * `PhysWorld.EnterFrame` writes `sprite.x/y = body.GetPosition() * 30` and
 * `sprite.rotation = body.GetAngle()`, so this container's origin IS the part's
 * registration point and everything inside is positioned relative to it. The
 * art sprite carries that anchor; nothing here offsets it.
 */

/** Everything needed to draw one part. */
export interface PartSpec {
  kind: PartKind;
  /** `unit.MC.curSkin` — ONE index shared by every part of a costume. */
  skinFrame: number;
  /** ±1, mirroring `clip.scaleX = flip`. */
  flip: number;
  /** Back-slot sprite name, torso only (`unit.ability.sprite`). */
  ability?: string;
}

/** Fallback block colours, used only if the strips failed to load. */
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
  readonly kind: PartKind;
  /** The costume index this part was built at — one value shared by the rig. */
  readonly skinFrame: number;

  constructor(spec: PartSpec) {
    super();
    this.kind = spec.kind;
    this.skinFrame = spec.skinFrame;

    // The back slot is a child of the torso clip in the SWF (`PhysBody.ability`),
    // so it rides the torso's rotation for free by being a child here too. Added
    // first: the pack sits behind the body.
    if (spec.kind === "body" && spec.ability) this.addAbility(spec.ability, spec.flip);

    const art = RagdollArt.sprite(spec.kind, spec.skinFrame, spec.flip);
    this.addChild(art ?? this.buildPlaceholder(spec));
  }

  private addAbility(name: string, flip: number): void {
    const tex = AbilityArt.getTexture(name);
    if (!tex) return;
    const [ax, ay] = AbilityArt.anchor();
    const [ox, oy] = RagdollArt.abilityOffset();
    const sp = new Sprite(tex);
    sp.anchor.set(ax, ay);
    sp.scale.x = flip < 0 ? -1 : 1;
    sp.x = ox * (flip < 0 ? -1 : 1);
    sp.y = oy;
    this.addChild(sp);
  }

  private buildPlaceholder(spec: PartSpec): Graphics {
    const [w, h] = RagdollArt.artSize(spec.kind, spec.skinFrame);
    const g = new Graphics();
    if (spec.kind === "head" || spec.kind === "hand") g.circle(0, 0, w / 2);
    else g.rect(-w / 2, -h / 2, w, h);
    g.fill({ color: PLACEHOLDER_COLORS[spec.kind], alpha: 0.95 });
    return g;
  }
}
