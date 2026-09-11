import { World, Vec2, Box } from "planck";
import type { Body } from "planck";
import { Container } from "pixi.js";
import { PTM, FPS } from "../core/Config";
import { UT } from "../core/UT";
import { PhysVap } from "./PhysVap";
import { RdActor } from "./RdActor";
import { RdGun } from "./RdGun";

/**
 * Physics world + display sync. Ported from RdPhys.as onto planck.js.
 *
 * The original used Box2D 2.0.x (world AABB bounds, single iteration count,
 * ApplyForce, IsSleeping). planck is the modern Box2D 2.3 API, so:
 *  - the world needs no AABB bounds;
 *  - Step(dt, iters) -> step(dt, velocityIters, positionIters);
 *  - m_userData is a Pixi Container synced each frame (rotation in radians).
 */

/** A wall rectangle for the static ground body (supplied by Arena). */
export interface WallRect {
  width: number;
  height: number;
  x: number;
  y: number;
  /** Rotation in degrees, matching the Flash display object. */
  rotation: number;
}

/** Impulse descriptor passed to makeGuy(): where/how the killing blow landed. */
export interface DeathImpulse {
  x: number;
  y: number;
  headShot?: boolean;
  /** Raze 2 `force` stat of the killing weapon (3..30). Defaults to the median. */
  force?: number;
}

const TIME_STEP = 1 / FPS;
const VELOCITY_ITERS = 10;
const POSITION_ITERS = 8;
/** Frames a dropped gun may stay awake before it is retired anyway (~15s). A
 *  gun that lands normally sleeps within a second or two, so this only ever
 *  catches the bodies that would otherwise never be cleaned up. */
const GUN_MAX_AGE = 15 * FPS;
/** `PhysActor.EnterFrame`: at `fc == 4 * 30` the corpse is handed to PhysVap. */
const CORPSE_LIFE = 4 * FPS;

export class Phys {
  readonly world: World;
  /** Display container holding all ragdoll/gun sprites. */
  readonly view = new Container();

  actors: RdActor[] = [];
  guns: RdGun[] = [];

  /** Turns four-second-old corpses into a rising ember cloud. */
  readonly vap = new PhysVap();

  /** The camera, so PhysVap can drop queued corpses that left the view. */
  arena: { x: number; y: number } | null = null;

  private ground: Body;

  constructor(walls: WallRect[]) {
    this.world = new World(new Vec2(0, 10));
    this.ground = this.world.createBody();
    this.createGround(walls);
    this.view.addChild(this.vap.view);
  }

  // --- construction ------------------------------------------------------

  private createGround(walls: WallRect[]): void {
    for (const w of walls) {
      this.createGroundShape(w.width, w.height, w.x, w.y, w.rotation, 0.3);
    }
  }

  private createGroundShape(
    width: number,
    height: number,
    x: number,
    y: number,
    rotationDeg: number,
    friction: number,
  ): void {
    const hw = width / 60;
    const hh = height / 60;
    const center = new Vec2(x / PTM, y / PTM);
    const angle = (rotationDeg * Math.PI) / 180;
    this.ground.createFixture({
      shape: new Box(hw, hh, center, angle),
      density: 0,
      friction,
    });
  }

  // --- spawning ----------------------------------------------------------

  /** Spawn a death ragdoll for `unit`, kicked by the killing `impulse`. */
  makeGuy(unit: any, impulse: DeathImpulse): void {
    const actor = new RdActor(this, unit, -1);
    this.actors.push(actor);

    // Carry over the unit's motion so the corpse keeps its momentum.
    const jumpVel = unit.jumping ? unit.jumping.vel * 40 : 0;
    this.applyForce(actor.part_body, unit.moving.vel * 40, jumpVel);

    // Random jitter on every limb.
    for (const limb of actor.limbs) {
      this.applyForce(limb, UT.rand(-20, 20), UT.rand(-20, 20));
    }

    // Directional blow: headshots take the head clean off and throw it; every
    // other killing blow just kicks a random limb.
    //
    // The body kick scales with the weapon's `force` stat but the head pop does
    // not — `PhysWorld.as:144` impulses the body by `param3.force` and then
    // :155 impulses the head by a flat 8 whatever killed it. 15 is the arsenal's
    // median force, so it is the value that leaves a mid-weight weapon feeling
    // as it did while restoring the 3..30 spread between a pistol and a rocket.
    if (impulse.headShot) {
      actor.detachHead();
      this.applyForce(actor.part_head, impulse.x * 35, impulse.y * 20 - 50);
    } else {
      const limb = actor.limbs[Math.floor(Math.random() * actor.limbs.length)];
      const force = impulse.force ?? 15;
      this.applyForce(limb, impulse.x * force, impulse.y * force);
    }
  }

  /** Spawn a tumbling dropped weapon for `unit`. */
  makeGun(unit: any): void {
    const gun = new RdGun(this, unit, -1);
    this.guns.push(gun);
    gun.init();
  }

  /** Random kick applied to a freshly-dropped gun. Matches madeGun(). */
  madeGun(gun: RdGun): void {
    this.applyForceOffset(
      gun.body,
      UT.rand(-20, 20),
      UT.rand(-20, 20),
      UT.rand(-5, 5),
      UT.rand(-5, 5),
    );
    const unit = gun.unit;
    const jumpVel = unit.jumping ? unit.jumping.vel * 20 : 0;
    this.applyForceOffset(
      gun.body,
      unit.moving.vel * 20,
      jumpVel,
      UT.rand(-5, 5),
      UT.rand(-5, 5),
    );
  }

  // --- forces ------------------------------------------------------------

  private applyForce(body: Body, fx: number, fy: number): void {
    body.applyForce(new Vec2(fx, fy), body.getWorldCenter(), true);
  }

  private applyForceOffset(
    body: Body,
    fx: number,
    fy: number,
    ox: number,
    oy: number,
  ): void {
    const c = body.getWorldCenter();
    body.applyForce(new Vec2(fx, fy), new Vec2(c.x + ox / 30, c.y + oy / 30), true);
  }

  // --- per-frame ---------------------------------------------------------

  enterFrame(): void {
    this.world.step(TIME_STEP, VELOCITY_ITERS, POSITION_ITERS);

    // Sync every body's display object.
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const view = b.getUserData() as Container | null;
      if (view) {
        const p = b.getPosition();
        view.x = p.x * PTM;
        view.y = p.y * PTM;
        view.rotation = b.getAngle(); // radians in both planck and Pixi
      }
    }

    // Corpse upkeep: severed-head blood trail.
    for (const actor of this.actors) actor.advance();

    this.cleanupGuns();
    this.cleanupActors();
    this.vap.enterFrame(this.arena);
  }

  /**
   * Remove dropped guns once they come to rest — or once they have been around
   * long enough that they clearly never will. The age fallback matters because
   * a body wedged in a corner, jittering on a slope, or falling through a gap
   * in the geometry never satisfies Box2D's sleep test, and on `isAwake()`
   * alone it would hold its body and sprite for the whole match.
   */
  private cleanupGuns(): void {
    this.guns = this.guns.filter((gun) => {
      if (!gun.body.isAwake() || ++gun.age > GUN_MAX_AGE) {
        const view = gun.body.getUserData() as Container | null;
        if (view) view.destroy();
        gun.body.setUserData(null);
        this.world.destroyBody(gun.body);
        return false;
      }
      return true;
    });
  }

  /**
   * Retire four-second-old corpses into the vaporiser.
   *
   * `PhysActor.EnterFrame` does exactly this and nothing else — a corpse has a
   * fixed lifetime in Raze 2, whether or not its owner has respawned and
   * whether or not the body has come to rest. The port used to hold a corpse
   * until its unit respawned *and* the ragdoll settled, which meant a body
   * wedged in the geometry could stay for the whole match.
   */
  private cleanupActors(): void {
    this.actors = this.actors.filter((actor) => {
      if (actor.age < CORPSE_LIFE) return true;
      this.vap.vaporize(actor);
      return false;
    });
  }

  /** Tear down the whole world (screen teardown). */
  destroy(): void {
    this.vap.destroy();
    this.view.destroy({ children: true });
  }
}
