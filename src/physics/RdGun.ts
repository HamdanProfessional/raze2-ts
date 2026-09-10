import { Vec2, Box } from "planck";
import type { Body } from "planck";
import { Container, Graphics } from "pixi.js";
import { PTM } from "../core/Config";
import type { Phys } from "./Phys";

/**
 * A dropped weapon that tumbles under physics until it settles. Ported from
 * RdGun.as (which used a GunFall MovieClip whose `hitBox` gave the box dims).
 *
 * GunFall art is ported with the weapon module; until then the hitbox uses a
 * default gun size and a placeholder graphic supplied via `gunArtProvider`.
 */

export interface GunView extends Container {
  hitWidth: number;
  hitHeight: number;
}

/** Injected by the weapon/asset module to supply real GunFall art. */
export type GunArtProvider = (gunId: number) => GunView | null;
let gunArtProvider: GunArtProvider = () => null;
export function setGunArtProvider(p: GunArtProvider): void {
  gunArtProvider = p;
}

const DEFAULT_HIT_W = 44;
const DEFAULT_HIT_H = 14;

export class RdGun {
  unit: any;
  body!: Body;

  private rdPhys: Phys;
  private collideIndex: number;
  private scale: number;
  private flip: number;
  private x: number;
  private y: number;
  private view: GunView;

  constructor(rdPhys: Phys, unit: any, collideIndex: number) {
    this.rdPhys = rdPhys;
    this.unit = unit;
    this.x = unit.x / PTM;
    this.y = (unit.y - 60 * unit.scale) / PTM;
    this.scale = unit.scale;
    this.flip = unit.animMC.scaleX;
    this.collideIndex = collideIndex;

    this.view =
      gunArtProvider(unit.gun?.curGun?.id ?? 0) ?? this.buildPlaceholder();
  }

  private buildPlaceholder(): GunView {
    const c = new Container() as GunView;
    c.hitWidth = DEFAULT_HIT_W;
    c.hitHeight = DEFAULT_HIT_H;
    const g = new Graphics();
    g.rect(-DEFAULT_HIT_W / 2, -DEFAULT_HIT_H / 2, DEFAULT_HIT_W, DEFAULT_HIT_H);
    g.fill({ color: 0x888c90 });
    g.stroke({ color: 0x000000, width: 1, alpha: 0.5 });
    c.addChild(g);
    return c;
  }

  /** Create the physics body + register with the world. Matches RdGun.Init(). */
  init(): void {
    const hw = (this.view.hitWidth * this.scale) / 60;
    const hh = (this.view.hitHeight * this.scale) / 60;

    this.view.scale.set(this.scale * this.flip, this.scale);

    this.body = this.rdPhys.world.createDynamicBody(new Vec2(this.x, this.y));
    this.body.createFixture({
      shape: new Box(hw, hh),
      density: 1,
      friction: 0.4,
      restitution: 0.3,
      filterGroupIndex: -1,
    });
    this.body.setUserData(this.view);
    this.rdPhys.view.addChild(this.view);
    this.rdPhys.madeGun(this);
  }
}
