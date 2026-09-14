import { Vec2, Box, Circle, RevoluteJoint } from "planck";
import type { Body, Joint } from "planck";
import type { Container } from "pixi.js";
import { PTM } from "../core/Config";
import { Quality } from "../state/Quality";
import { RdContainer, type PartSpec } from "./RdContainer";
import { RagdollArt, HIT_SHRINK, type PartKind } from "../assets/RagdollArt";
import { RAZE2_SKINS } from "../assets/raze2";
import type { Phys } from "./Phys";

/** Skin id -> the single costume index every part clip is set to. */
const SKIN_FRAME = new Map<string, number>(
  (RAZE2_SKINS as { id: string; frame: number }[]).map((s) => [s.id, Number(s.frame)]),
);

// A detached head trails blood for this many frames, one drop every few.
const HEAD_TRAIL_FRAMES = 24;
const HEAD_TRAIL_INTERVAL = 4;

/**
 * The death ragdoll. Ported from `PhysActor.as`.
 *
 * Fourteen bodies — torso, head, and two three-link arms and legs — chained by
 * revolute joints, all sharing `filter.groupIndex = -1` so they pass through
 * each other.
 *
 * Three things about the original are easy to get wrong, and the port had all
 * three wrong:
 *
 *  1. **Nothing is authored in this rig.** `createPart` takes no size. It
 *     instantiates the part clip, `gotoAndStop(skin)`, and derives the fixture
 *     from the clip's own measured bounds (`clip.width * 0.8 / 60`). So the
 *     hitbox follows the art, per costume, and sizes cannot be guessed — see
 *     `ragdollRig.json`, baked from the same clips.
 *  2. **There is no scale factor.** Coordinates below are raw SWF pixels over
 *     PTM, exactly as authored. Multiplying them by the unit's `scale` (0.42)
 *     shrank every corpse to under half size.
 *  3. **One costume index drives every part.** `skin = unit.MC.curSkin` is
 *     pushed into torso, head, arms, hands, legs and feet alike; there is no
 *     per-part costume and no fallback table.
 *
 * Coordinates are in SWF pixels relative to the actor origin (`unit.x`,
 * `unit.y - 50`); `createPart` and `vec` convert to metres. `flip` (±1) mirrors
 * x, and joint limits swap-and-negate when flipped so a mirrored corpse folds
 * the right way.
 */
export class RdActor {
  unit: any;

  part_body!: Body;
  part_head!: Body;
  part_armUpp1!: Body;
  part_armUpp2!: Body;
  part_armLow1!: Body;
  part_armLow2!: Body;
  part_hand1!: Body;
  part_hand2!: Body;
  part_legUpp1!: Body;
  part_legUpp2!: Body;
  part_legLow1!: Body;
  part_legLow2!: Body;
  part_foot1!: Body;
  part_foot2!: Body;

  /** All 14 bodies, in `PhysActor.parts` order (also the draw order). */
  allParts: Body[] = [];
  /** The 12 limb bodies (no torso/head), used for death impulses. */
  limbs: Body[] = [];

  /** Neck joint, kept so a headshot can sever it. Null once detached. */
  headJoint: Joint | null = null;
  /** True once the head has been severed — drives the blood trail. */
  headOff = false;
  /** Frames since this ragdoll spawned; drives the four-second vaporise. */
  age = 0;

  private rdPhys: Phys;
  private collideIndex: number;
  private flip: number;
  private skinFrame: number;
  private ability?: string;
  private x: number;
  private y: number;

  constructor(rdPhys: Phys, unit: any, collideIndex: number) {
    this.rdPhys = rdPhys;
    this.unit = unit;
    unit.ragActor = this;

    this.x = unit.x;
    this.y = unit.y - 50;
    this.flip = unit.animMC?.scaleX === -1 ? -1 : 1;
    this.collideIndex = collideIndex;
    this.skinFrame = SKIN_FRAME.get(String(unit.skinId)) ?? RagdollArt.rig.frames[0];
    this.ability = unit.ability?.sprite;

    // (x, y, angle, kind, isBox) — call order and arguments from PhysActor.as:80+
    const body = this.createPart(0, 0, 0, "body", true);
    const head = this.createPart(0, -15, 0, "head", false);
    this.headJoint = this.joint(body, head, 0, 0, -0.2, 0.02);

    const legUpp1 = this.createPart(-2, 20, 0, "upperLeg", true);
    this.joint(body, legUpp1, -1, 10, -0.5, 0.2);
    const legLow1 = this.createPart(-5, 38, 0, "lowerLeg", true);
    this.joint(legUpp1, legLow1, -3, 26, 0, 0.5);
    const foot1 = this.createPart(-2, 48, 0, "foot", true);
    this.joint(legLow1, foot1, -3, 48, -0.1, 0.2);

    const legUpp2 = this.createPart(-2, 20, 0, "upperLeg", true);
    this.joint(body, legUpp2, -1, 10, -0.5, 0.2);
    const legLow2 = this.createPart(-5, 38, 0, "lowerLeg", true);
    this.joint(legUpp2, legLow2, -3, 26, 0, 0.5);
    const foot2 = this.createPart(-2, 48, 0, "foot", true);
    this.joint(legLow2, foot2, -3, 48, -0.1, 0.2);

    // The arms start folded: 0.4pi at the shoulder, 0.5pi at elbow and wrist.
    // Dropping these left every corpse T-posing out of the gate.
    const armUpp1 = this.createPart(0, 0, 0.4, "upperArm", true);
    this.joint(body, armUpp1, -3, -5, 0, 0);
    const armLow1 = this.createPart(0, 15, 0.5, "lowerArm", true);
    this.joint(armUpp1, armLow1, -3, 10, -0.8, 0);
    const hand1 = this.createPart(3, 20, 0.5, "hand", false);
    this.joint(armLow1, hand1, -2, 18, -0.2, 0.2);

    const armUpp2 = this.createPart(0, 0, 0.4, "upperArm", true);
    this.joint(body, armUpp2, -3, -5, 0, 0);
    const armLow2 = this.createPart(0, 15, 0.5, "lowerArm", true);
    this.joint(armUpp2, armLow2, -3, 10, -0.8, 0);
    const hand2 = this.createPart(3, 20, 0.5, "hand", false);
    this.joint(armLow2, hand2, -2, 18, -0.2, 0.2);

    Object.assign(this, {
      part_body: body, part_head: head,
      part_armUpp1: armUpp1, part_armLow1: armLow1, part_hand1: hand1,
      part_armUpp2: armUpp2, part_armLow2: armLow2, part_hand2: hand2,
      part_legUpp1: legUpp1, part_legLow1: legLow1, part_foot1: foot1,
      part_legUpp2: legUpp2, part_legLow2: legLow2, part_foot2: foot2,
    });

    unit.ragDoll = body.getUserData();

    // `PhysActor.parts` push order, which is also the addChild order: the far
    // arm and far leg go behind the torso, the near arm in front of it.
    this.allParts = [
      hand2, armLow2, armUpp2,
      foot2, legLow2, legUpp2,
      foot1, legLow1, legUpp1,
      body,
      head,
      hand1, armLow1, armUpp1,
    ];
    this.limbs = [
      armUpp1, armUpp2, armLow1, armLow2, hand1, hand2,
      legUpp1, legUpp2, legLow1, legLow2, foot1, foot2,
    ];

    for (const b of this.allParts) {
      const view = b.getUserData() as RdContainer | null;
      if (view) this.rdPhys.view.addChild(view);
    }
  }

  /**
   * Create one part at (px, py) SWF px from the actor origin, rotated
   * `angle * pi`, with the fixture centred on the registration point and sized
   * from the art. Ported from `PhysActor.createPart`.
   */
  private createPart(
    px: number,
    py: number,
    angle: number,
    kind: PartKind,
    isBox: boolean,
  ): Body {
    const f = this.flip;
    const wx = this.x + px * f;
    const wy = this.y + py;

    const spec: PartSpec = {
      kind,
      skinFrame: this.skinFrame,
      flip: f,
      ...(kind === "body" && this.ability ? { ability: this.ability } : {}),
    };
    const view = new RdContainer(spec);

    const body = this.rdPhys.world.createDynamicBody({
      position: new Vec2(wx / PTM, wy / PTM),
      angle: angle * f * Math.PI,
    });

    // clip.width/height * 0.8 / 60 — half-extents, so the shape is 0.8x the art.
    const [aw, ah] = RagdollArt.artSize(kind, this.skinFrame);
    body.createFixture({
      shape: isBox
        ? new Box((aw * HIT_SHRINK) / 60, (ah * HIT_SHRINK) / 60)
        : new Circle((aw * HIT_SHRINK) / 60),
      // PhysActor gives the torso 1.5 and everything else 1, so the corpse
      // falls torso-led instead of being dragged around by its limbs.
      density: kind === "body" ? 1.5 : 1,
      friction: 0.5,
      restitution: 0.2,
      filterGroupIndex: this.collideIndex,
    });
    body.setUserData(view);
    return body;
  }

  /**
   * Revolute joint anchored at (ax, ay) SWF px from the actor origin — an
   * absolute world point, not an offset from either body's centre. Ported from
   * `PhysActor.createJoint` + `createVec`.
   */
  private joint(
    a: Body,
    b: Body,
    ax: number,
    ay: number,
    lo: number,
    hi: number,
  ): Joint {
    const f = this.flip;
    if (f === -1) {
      const swap = lo;
      lo = hi * f;
      hi = swap * f;
    }
    const anchor = new Vec2((this.x + ax * f) / PTM, (this.y + ay) / PTM);
    return this.rdPhys.world.createJoint(
      new RevoluteJoint(
        {
          lowerAngle: lo * Math.PI,
          upperAngle: hi * Math.PI,
          enableLimit: lo !== 0 || hi !== 0,
          maxMotorTorque: 0.02,
          motorSpeed: 0,
          enableMotor: true,
        },
        a,
        b,
        anchor,
      ),
    )!;
  }

  /**
   * Sever the neck so the head comes off and tumbles as a free body.
   *
   * The head was already being kicked by the killing blow; without this it just
   * whips on its joint and snaps back, which reads as a twitch rather than a
   * decapitation. Destroying the joint is all that is needed — the head keeps
   * its fixture, its filter group (so it still ignores the rest of the corpse)
   * and its momentum.
   */
  detachHead(): void {
    if (this.headOff || !this.headJoint) return;
    this.rdPhys.world.destroyJoint(this.headJoint);
    this.headJoint = null;
    this.headOff = true;
  }

  /** Per-frame corpse upkeep: the blood trail off a severed head. */
  advance(): void {
    this.age++;
    if (this.headOff) this.trailBlood();
  }

  /** Drop every body and display object. Ported from `PhysActor.destroy`. */
  destroy(): void {
    for (const part of this.allParts) {
      const view = part.getUserData() as Container | null;
      if (view) view.destroy();
      part.setUserData(null);
      this.rdPhys.world.destroyBody(part);
    }
    this.allParts = [];
    this.limbs = [];
    this.headJoint = null;
  }

  /** Drip blood behind a severed head while it is still travelling. */
  private trailBlood(): void {
    if (!Quality.detail) return;
    if (this.age > HEAD_TRAIL_FRAMES || this.age % HEAD_TRAIL_INTERVAL !== 0) return;
    const game = this.unit?.game;
    if (!game?.addEffect) return;
    const p = this.part_head.getPosition();
    game.addEffect(p.x * PTM, p.y * PTM, "blood");
  }
}
