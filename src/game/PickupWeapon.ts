import { Container, Graphics, Sprite } from "pixi.js";
import { GUN_ORDER, WEAPONS } from "./weapons";
import { droppableGuns } from "./Armory";
import { ArmArt } from "../assets/ArmArt";
import { PickupWeaponArt } from "../assets/PickupWeaponArt";

/**
 * Ported from Pickup_Weapon.as.
 *
 * Pickup_Weapon was a floor-spawning weapon MovieClip with two modes:
 *   - fixed      → carries the named weapon type ("uzi", "railgun", …).
 *   - random     → on spawn + every respawn picks one weapon from a pool
 *     dictated by SD.matchSettings.weapons (0 = full arsenal, 1 = SMG
 *     rack, 2 = explosive rack, …, 10..19 = single-weapon).
 * On touch the unit's arsenal gains that weapon (guns.arsenal[id] gets
 * stock ammo) and the pickup hides for `respawnTime` ticks.
 *
 * In the TS port the weapon pool table is preserved verbatim; the visual
 * icon is the weapon-arm sprite from assets/ArmArt.getTexture(id) (so the
 * floating pickup matches the held weapon).
 */

export interface PickupWeaponSpec {
  id: string;
  /** Either a fixed weapon id or "random" / "flip". */
  type: string;
  x: number;
  y: number;
  /** Seconds before respawn after pickup. */
  respawnSecs: number;
}

/**
 * Weapon pools keyed by SD.matchSettings.weapons (0..9 are themed sets;
 * 10..19 are single-weapon indexes that map to GUN_ORDER).
 * Reconstructed from the giant nested switch in Pickup_Weapon.getWeapArray().
 */
const WEAPON_POOLS: Record<number, string[]> = {
  // Pool 0 = the default drop pool. Resolved dynamically in pickFromPool to the
  // player's droppable set (native + unlocked); this literal is only a fallback.
  0: [...GUN_ORDER],
  1: ["pistol", "arifle", "shotgun", "sniper", "rocket"],
  2: ["uzi", "zapper", "railgun", "sticklaunch", "uzi", "zapper", "railgun", "sticklaunch", "chaingun"],
  3: ["sniper", "railgun"],
  4: ["zapper", "shotgun"],
  5: ["uzi", "arifle", "zapper", "chaingun"],
  6: ["pistol", "arifle", "shotgun", "sniper", "chaingun"],
  7: ["uzi", "sticklaunch", "rocket"],
  8: ["pistol", "uzi", "arifle", "zapper", "shotgun"],
  9: ["sniper", "railgun", "sticklaunch", "chaingun", "rocket"],
};

function pickFromPool(pool: number): string {
  // Pool 0 reflects what the player has unlocked (buy-to-unlock drops); the
  // themed pools 1..9 stay fixed. Sandbox uses fixed specs, not this path.
  const set = pool === 0 ? droppableGuns() : (WEAPON_POOLS[pool] ?? droppableGuns());
  return set[Math.floor(Math.random() * set.length)];
}

function fixedFromIndex(idx: number): string {
  return GUN_ORDER[idx] ?? "pistol";
}

const FRAMES_PER_SEC = 30;

/** How far above its stand the gun floats, and the bob around that height.
 *  `NodePickup.EnterFrame`: `y - 40 - UT.yMoveToRot(yRot, 4)` with `yRot += 5`
 *  each frame, i.e. a 4px swing on a 72-frame cycle. */
const FLOAT_Y = 40;
const BOB_AMPLITUDE = 4;
const BOB_DEG_PER_FRAME = 5;

interface UnitLike {
  x: number;
  y: number;
  gun: { pickUpGun(id: string): void; selectGun?(id: string): void };
}

export class PickupWeapon {
  readonly view = new Container();
  readonly spec: PickupWeaponSpec;

  private respawnTicks = 0;
  private g = new Graphics();
  private icon: Sprite | null = null;
  private base: Sprite | null = null;
  /** `yRot`: free-running degrees driving the float bob. */
  private bob = 0;
  private currentType = "";
  private pickedUp = false;

  constructor(spec: PickupWeaponSpec, private weaponsMode: number) {
    this.spec = spec;
    this.resolveType();
    this.draw();
    this.view.addChild(this.g);
    this.view.x = spec.x;
    this.view.y = spec.y;
  }

  /** Touch attempt by `unit`; returns true if it was picked up. */
  tryTouch(unit: UnitLike): boolean {
    if (this.pickedUp) return false;
    // Match the SWF touch test: a ~51x53 box (half-extents ~26) checked at
    // chest height, not the feet (Unit.as: hitTest(pickup.hitBox, 0, -30)).
    if (Math.abs(unit.x - this.spec.x) > 26 || Math.abs(unit.y - 20 - this.spec.y) > 26) {
      return false;
    }
    if (this.currentType && WEAPONS[this.currentType]) {
      // Grant the weapon into the arsenal but do NOT auto-switch — swapping the
      // held gun every time you walk over a pickup is disorienting mid-fight.
      unit.gun.pickUpGun(this.currentType);
    }
    this.pickedUp = true;
    this.view.visible = false;
    this.respawnTicks = this.spec.respawnSecs * FRAMES_PER_SEC;
    return true;
  }

  enterFrame(): void {
    if (!this.pickedUp) {
      this.bob = (this.bob + BOB_DEG_PER_FRAME) % 360;
      if (this.icon) {
        this.icon.y = -FLOAT_Y - Math.sin((this.bob * Math.PI) / 180) * BOB_AMPLITUDE;
      }
      return;
    }
    if (this.respawnTicks <= 0) return;
    this.respawnTicks--;
    if (this.respawnTicks === 0) {
      this.pickedUp = false;
      this.view.visible = true;
      this.resolveType();
      this.draw();
    }
  }

  private resolveType(): void {
    if (this.spec.type === "random" || this.spec.type === "flip") {
      if (this.weaponsMode >= 10) {
        this.currentType = fixedFromIndex(this.weaponsMode - 10);
      } else {
        this.currentType = pickFromPool(this.weaponsMode);
      }
    } else {
      this.currentType = this.spec.type;
    }
  }

  private draw(): void {
    this.g.clear();
    if (this.icon) {
      this.icon.destroy();
      this.icon = null;
    }
    if (this.base) {
      this.base.destroy();
      this.base = null;
    }
    // Authentic weapon-pickup art. `NodePickup` is two things at once: the node
    // clip is the lit STAND (`gotoAndStop(2)`, NodePickup.as:118) and the gun is
    // painted 40px above it with a bob (`EnterFrame`'s bitscreen.paint at
    // `y - 40 - yMoveToRot(yRot, 4)`). The port drew only the gun, lying flat on
    // the floor — dark art on dark floor, which is why floor weapons read as
    // not being there at all.
    const btex = PickupWeaponArt.getBase();
    if (btex) {
      this.base = new Sprite(btex);
      this.base.anchor.set(0.5, 1);
      this.view.addChild(this.base);
    }
    const wtex = PickupWeaponArt.getTexture(this.currentType);
    if (wtex) {
      if (!btex) {
        // No stand art: keep a soft ground glow so the pickup still reads.
        this.g.ellipse(0, 10, 20, 6).fill({ color: 0xffcc33, alpha: 0.18 });
      }
      this.icon = new Sprite(wtex);
      this.icon.anchor.set(0.5);
      // Size the gun so its longest side reads clearly on the map (~2x the old
      // 30px icon), keeping the aspect ratio of the authentic Raze 2 gun art.
      const s = 56 / Math.max(wtex.width || 56, wtex.height || 56);
      this.icon.scale.set(s);
      this.icon.y = -FLOAT_Y;
      // Onto `view`, not `g`: Pixi v8 deprecates parenting children to a
      // Graphics. `g` is already in `view`, so the icon still lands on top of
      // the ground glow it draws.
      this.view.addChild(this.icon);
      return;
    }
    // Fallback: the held weapon-arm sprite on a small rack (art not loaded yet).
    this.g.roundRect(-16, -6, 32, 12, 3).fill({ color: 0x1c232b, alpha: 0.95 }).stroke({
      color: 0xffcc33,
      width: 1.5,
      alpha: 0.9,
    });
    const tex = ArmArt.getIcon(this.currentType);
    if (tex) {
      this.icon = new Sprite(tex);
      this.icon.anchor.set(0.5);
      this.icon.scale.set(Math.min(28 / (tex.width || 28), 10 / (tex.height || 10), 1));
      this.view.addChild(this.icon);
    }
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}
