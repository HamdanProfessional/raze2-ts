import { Vec2, Box, Circle, RevoluteJoint } from "planck";
import type { Body, Joint } from "planck";
import type { Container } from "pixi.js";
import { PTM } from "../core/Config";
import { Quality } from "../state/Quality";
import { RdContainer, type PartKind, type PartSpec } from "./RdContainer";
import type { Phys } from "./Phys";

// Corpse settling, in 30Hz frames. A ragdoll holds full opacity while it is
// still tumbling and interesting, then relaxes into the background so a long
// match doesn't accumulate a field of equally-bright bodies.
const SETTLE_START = 60; // ~2s
const SETTLE_FADE = 45; // ~1.5s to reach SETTLE_ALPHA
const SETTLE_ALPHA = 0.45;

// A detached head trails blood for this many frames, one drop every few.
const HEAD_TRAIL_FRAMES = 24;
const HEAD_TRAIL_INTERVAL = 4;

/**
 * The ragdoll. Ported from RdActor.as.
 *
 * Builds a torso plus 13 jointed limbs (head, two upper/lower arms + hands, two
 * upper/lower legs + feet) as planck bodies connected by revolute joints. Every
 * fixture shares filterGroupIndex = collideIndex (-1 for a normal guy) so the
 * parts never collide with each other.
 *
 * Coordinate conventions preserved from the original AS3:
 *  - world units are meters; PTM (30) px per meter.
 *  - a body's origin coincides with its joint pivot; the fixture is offset from
 *    there so the limb's mass hangs off the pivot.
 *  - `flip` (±1) mirrors the character; joint angle limits swap+negate when
 *    flipped so a mirrored ragdoll bends correctly.
 */
export class RdActor {
  unit: any;
  respawned = false;

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

  /** All 14 bodies (torso + limbs), used for cleanup. */
  allParts: Body[] = [];
  /** The 12 limb bodies (no torso/head), used for death impulses. */
  limbs: Body[] = [];

  /** Neck joint, kept so a headshot can sever it. Null once detached. */
  headJoint: Joint | null = null;
  /** True once the head has been severed — drives the blood trail. */
  headOff = false;
  /** Frames since this ragdoll spawned; drives the settle fade. */
  age = 0;
  /** Joint created by the most recent createBodyPart() call. */
  private lastJoint: Joint | null = null;

  private rdPhys: Phys;
  private collideIndex: number;
  private scale: number;
  private flip: number;
  private x: number;
  private y: number;

  constructor(rdPhys: Phys, unit: any, collideIndex: number) {
    this.rdPhys = rdPhys;
    this.unit = unit;
    unit.ragActor = this;

    this.x = unit.x / PTM;
    this.y = (unit.y - 50) / PTM;
    this.scale = unit.scale;
    this.flip = unit.animMC.scaleX;
    this.collideIndex = collideIndex;

    const c = unit.costume;

    // torso, then limbs chained off it. Parameters match the AS3 call sites.
    this.part_body = this.createBody("body", c.body);
    // (parent, w, h(-1=circle), density, jx, jy, ox, oy, loAng, hiAng, costume, kind)
    this.part_head = this.createBodyPart(this.part_body, 18, -1, 1, 5, -20, 0, -17, -0.2, 0.25, c.head, "head");
    this.headJoint = this.lastJoint;
    this.part_armUpp1 = this.createBodyPart(this.part_body, 8, 30, 1, -3, -13, 0, 20, 0, 0, c.body, "upperArm");
    this.part_armUpp2 = this.createBodyPart(this.part_body, 8, 30, 1, -3, -13, 0, 20, 0, 0, c.body, "upperArm");
    this.part_armLow1 = this.createBodyPart(this.part_armUpp1, 7, 20, 1, -2.5, 10, 0, 20, -0.75, 0, c.body, "lowerArm");
    this.part_armLow2 = this.createBodyPart(this.part_armUpp2, 7, 20, 1, -2.5, 10, 0, 20, -0.75, 0, c.body, "lowerArm");
    this.part_hand1 = this.createBodyPart(this.part_armLow1, 6, 9, 1, 0, 28, 0, 10, -0.25, 0.25, c.body, "hand");
    this.part_hand2 = this.createBodyPart(this.part_armLow2, 6, 9, 1.5, 0, 28, 0, 10, -0.25, 0.25, c.body, "hand");
    this.part_legUpp1 = this.createBodyPart(this.part_body, 13, 37, 1, -2, 15, 0, 20, -0.5, 0.25, c.legs, "upperLeg");
    this.part_legUpp2 = this.createBodyPart(this.part_body, 13, 37, 1, -2, 15, 0, 20, -0.5, 0.25, c.legs, "upperLeg");
    this.part_legLow1 = this.createBodyPart(this.part_legUpp1, 12, 37, 1, -1.5, 44, 0, 20, 0, 0.85, c.legs, "lowerLeg");
    this.part_legLow2 = this.createBodyPart(this.part_legUpp2, 12, 37, 1, -1.5, 44, 0, 20, 0, 0.85, c.legs, "lowerLeg");
    this.part_foot1 = this.createBodyPart(this.part_legLow1, 20, 10, 1, 0, 72, 8, 2, -0.15, 0.25, c.legs, "foot");
    this.part_foot2 = this.createBodyPart(this.part_legLow2, 20, 10, 1, 0, 72, 8, 2, -0.15, 0.25, c.legs, "foot");

    unit.ragDoll = this.part_body.getUserData();

    // Ordered back-to-front for correct draw layering (matches AS3 addChild order).
    this.allParts = [
      this.part_armLow2, this.part_armUpp2, this.part_hand2, this.part_foot2,
      this.part_legLow2, this.part_legUpp2, this.part_foot1, this.part_legLow1,
      this.part_legUpp1, this.part_body, this.part_head, this.part_armLow1,
      this.part_armUpp1, this.part_hand1,
    ];
    this.limbs = [
      this.part_armUpp1, this.part_armUpp2, this.part_armLow1, this.part_armLow2,
      this.part_hand1, this.part_hand2, this.part_legUpp1, this.part_legUpp2,
      this.part_legLow1, this.part_legLow2, this.part_foot1, this.part_foot2,
    ];

    // Add limb display objects to the physics layer in the same z-order.
    for (const b of this.allParts) {
      const view = b.getUserData() as RdContainer | null;
      if (view) this.rdPhys.view.addChild(view);
    }
  }

  /** Create the torso body (a plain box centred on the spawn point). */
  private createBody(kind: PartKind, costume: number): Body {
    const hw = (20 / 60) * this.scale;
    const hh = (40 / 60) * this.scale;

    const view = new RdContainer({
      kind,
      costume,
      widthPx: 20 * this.scale,
      heightPx: 40 * this.scale,
      isCircle: false,
      offsetXPx: 0,
      offsetYPx: 0,
      scale: this.scale,
      flip: this.flip,
    });

    const body = this.rdPhys.world.createDynamicBody(new Vec2(this.x, this.y));
    body.createFixture({
      shape: new Box(hw, hh),
      density: 1,
      friction: 0.5,
      restitution: 0.2,
      filterGroupIndex: this.collideIndex,
    });
    body.setUserData(view);
    return body;
  }

  /**
   * Create one limb: a box (or circle when h == -1) offset from its pivot,
   * revolute-jointed to `parent`.
   */
  private createBodyPart(
    parent: Body,
    w: number,
    h: number,
    density: number,
    jx: number,
    jy: number,
    ox: number,
    oy: number,
    loAng: number,
    hiAng: number,
    costume: number,
    kind: PartKind,
  ): Body {
    const jxm = jx / 30;
    const jym = jy / 30;
    const s = this.scale;
    const f = this.flip;

    // Body origin sits at the pivot: torso base + (jx,jy) scaled/flipped.
    const posX = this.x + jxm * s * f;
    const posY = this.y + jym * s;

    const isCircle = h === -1;
    const offXPx = (ox / 2) * s * f; // shape centre offset in px
    const offYPx = (oy / 2) * s;

    const spec: PartSpec = {
      kind,
      costume,
      widthPx: w * s,
      heightPx: (isCircle ? w : h) * s,
      isCircle,
      offsetXPx: offXPx,
      offsetYPx: offYPx,
      scale: s,
      flip: f,
    };
    const view = new RdContainer(spec);

    const body = this.rdPhys.world.createDynamicBody(new Vec2(posX, posY));
    if (isCircle) {
      body.createFixture({
        shape: new Circle(new Vec2((ox / 60) * s * f, (oy / 60) * s), (w / 60) * s),
        density,
        friction: 0.5,
        restitution: 0.2,
        filterGroupIndex: this.collideIndex,
      });
    } else {
      body.createFixture({
        shape: new Box(
          (w / 60) * s,
          (h / 60) * s,
          new Vec2((ox / 60) * s * f, (oy / 60) * s),
          0,
        ),
        density,
        friction: 0.5,
        restitution: 0.2,
        filterGroupIndex: this.collideIndex,
      });
    }
    body.setUserData(view);

    // Revolute joint at the shared pivot (torso centre + (jx,jy)).
    const torsoCenter = this.part_body.getWorldCenter();
    const anchor = new Vec2(
      torsoCenter.x + jxm * s * f,
      torsoCenter.y + jym * s,
    );
    const jointOpts: any = {
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: 0.02,
    };
    if (loAng !== 0 || hiAng !== 0) {
      if (f !== -1) {
        jointOpts.lowerAngle = loAng * Math.PI;
        jointOpts.upperAngle = hiAng * Math.PI;
      } else {
        jointOpts.lowerAngle = hiAng * Math.PI * f;
        jointOpts.upperAngle = loAng * Math.PI * f;
      }
      jointOpts.enableLimit = true;
    }
    this.lastJoint = this.rdPhys.world.createJoint(
      new RevoluteJoint(jointOpts, parent, body, anchor),
    );

    return body;
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

  /**
   * True once the corpse has finished relaxing. Used as a cleanup trigger:
   * ragdolls resting on the arena floor rarely satisfy Box2D's sleep test (the
   * jointed limb island keeps jittering below the threshold forever), so a
   * stale corpse would otherwise never be retired.
   */
  get settled(): boolean {
    return this.age >= SETTLE_START + SETTLE_FADE;
  }

  /**
   * Per-frame corpse upkeep: the settle fade, and the blood trail off a
   * severed head. Driven by Phys.enterFrame.
   */
  advance(): void {
    this.age++;
    if (this.headOff) this.trailBlood();
    if (this.age <= SETTLE_START) return;
    const t = Math.min(1, (this.age - SETTLE_START) / SETTLE_FADE);
    const alpha = 1 - t * (1 - SETTLE_ALPHA);
    for (const b of this.allParts) {
      const view = b.getUserData() as Container | null;
      if (view) view.alpha = alpha;
    }
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
