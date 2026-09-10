import { World, Vec2, Box } from "planck";
import type { Body } from "planck";
import { Container } from "pixi.js";
import { PTM, FPS } from "../core/Config";
import { UT } from "../core/UT";
import { SD } from "../state/SD";
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
}

const TIME_STEP = 1 / FPS;
const VELOCITY_ITERS = 10;
const POSITION_ITERS = 8;

export class Phys {
  readonly world: World;
  /** Display container holding all ragdoll/gun sprites. */
  readonly view = new Container();

  actors: RdActor[] = [];
  guns: RdGun[] = [];

  private ground: Body;

  constructor(walls: WallRect[]) {
    this.world = new World(new Vec2(0, 10));
    this.ground = this.world.createBody();
    this.createGround(walls);
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
    if (impulse.headShot) {
      actor.detachHead();
      this.applyForce(actor.part_head, impulse.x * 35, impulse.y * 20 - 50);
    } else {
      const limb = actor.limbs[Math.floor(Math.random() * actor.limbs.length)];
      this.applyForce(limb, impulse.x * 15, impulse.y * 15);
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

    // Corpse upkeep: settle fade + severed-head blood trail.
    for (const actor of this.actors) actor.advance();

    this.cleanupGuns();
    this.cleanupActors();
  }

  /** Remove dropped guns once they come to rest. */
  private cleanupGuns(): void {
    this.guns = this.guns.filter((gun) => {
      if (!gun.body.isAwake()) {
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
   * Remove settled ragdolls whose unit has already respawned. In lives-mode,
   * an eliminated unit (getScore == 0) keeps its corpse on the field.
   */
  private cleanupActors(): void {
    this.actors = this.actors.filter((actor) => {
      const keepCorpse = SD.matchSettings.lives && !actor.unit.getScore;
      // Retire once the owner is back in play and the body has come to rest.
      // `settled` is the reliable half of that test — see RdActor.settled.
      const atRest = !actor.part_body.isAwake() || actor.settled;
      if (!keepCorpse && actor.respawned && atRest) {
        for (const part of actor.allParts) {
          const view = part.getUserData() as Container | null;
          if (view) view.destroy();
          part.setUserData(null);
          this.world.destroyBody(part);
        }
        return false;
      }
      return true;
    });
  }

  /** Tear down the whole world (screen teardown). */
  destroy(): void {
    this.view.destroy({ children: true });
  }
}
