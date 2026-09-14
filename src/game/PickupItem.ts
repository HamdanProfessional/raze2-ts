import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { SD } from "../state/SD";
import { PickupArt } from "../assets/PickupArt";

/**
 * Ported from Pickup_Item.as.
 *
 * Pickup_Item was a small floor-spawning item MovieClip that granted
 * power-ups on touch:
 *   shield       → +50 % shield
 *   shieldBig    → +100 % shield
 *   health       → +50 % HP
 *   healthBig    → +100 % HP
 *   ddamage      → double-damage timer + "DDAMAGE" banner
 *   fade         → cloak/phase timer + "FADE" banner
 *   invin        → invulnerability timer + "INVIN" banner
 *
 * After pickup it had a `respawnTime` (10 * seconds * 30 frames) before it
 * reappeared. In the TS port the pickups are an enumerable list
 * (id, kind, x, y, respawnSecs) — when a Unit touches one, the matching
 * status effect is applied via Status helpers and the pickup is hidden for
 * `respawnSecs` ticks. Power-up callouts surface via TopText on the unit.
 */

export type PickupKind =
  | "shield"
  | "shieldBig"
  | "health"
  | "healthBig"
  | "ddamage"
  /** Rapid Fire: 2x fire rate, no ammo drain, every gun full-auto, 6.5 s. */
  | "rapid"
  | "fade"
  | "invin"
  /** King-of-the-hill crown: makes whoever grabs it the Juggernaut. */
  | "jug";

export interface PickupItemSpec {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  /** Seconds before respawn after pickup. */
  respawnSecs: number;
}

const COLORS: Record<PickupKind, number> = {
  shield: 0x4aa3ff,
  shieldBig: 0x88c8ff,
  health: 0x53c65a,
  healthBig: 0x9ee37d,
  ddamage: 0xff5a4d,
  // The glow filter Status.as:477 puts on a rapid-fire unit (0xffbf00).
  rapid: 0xffbf00,
  fade: 0xb887ff,
  invin: 0xffd45a,
  jug: 0xffcc33,
};

const LETTERS: Record<PickupKind, string> = {
  shield: "S",
  shieldBig: "S+",
  health: "H",
  healthBig: "H+",
  ddamage: "D",
  rapid: "R",
  fade: "F",
  invin: "I",
  jug: "J",
};

const FRAMES_PER_SEC = 30;

/**
 * Logical px per baked px for the power-up floater — 1:1.
 *
 * `NodePickup.EnterFrame` hands the atlas bit to `BitScreen.paint`, which is a
 * `copyPixels` blit: no scaling, so a floater is exactly the size of the
 * `DefineSprite_1719` art. That art measures 52x52 at 1x (rendered and
 * measured, not inferred), and `tools/pickups/bake.py` supersamples by 4 and
 * downsamples again before saving — so the shipped PNGs are already 1x.
 *
 * This used to normalise every icon to ~26px tall, i.e. half size. See
 * PickupWeapon's `GUN_ART_SCALE` for the one pickup bake that isn't 1x.
 */
const ICON_ART_SCALE = 1;

interface StatusLike {
  addShield(frac: number): void;
  heal(frac: number): void;
  startStatus(name: string): void;
}

interface UnitLike {
  x: number;
  y: number;
  human: boolean;
  status: StatusLike;
  /** Present on Unit; the crown pickup calls it. */
  setJug?(): void;
  game: {
    addEffect(x: number, y: number, type: string): void;
    hud?: { announce?(text: string, color?: number): void };
  };
}

/** Centre-banner callouts for the human, matching Pickup_Item.bigText. */
const BANNER: Partial<Record<PickupKind, [string, number]>> = {
  ddamage: ["DOUBLE DAMAGE", 0xff5a4d],
  invin: ["INVINCIBLE", 0xffd45a],
  rapid: ["RAPID FIRE", 0xffbf00],
};

/**
 * A live pickup instance. Tracks its respawn timer, exposes `tryTouch(unit)`,
 * and renders a small icon at its position when visible.
 */
export class PickupItem {
  readonly view = new Container();
  readonly spec: PickupItemSpec;

  private respawnTicks = 0;
  /**
   * Bobbing wrapper holding the vector fallback *and* the art sprite. Pixi v8
   * deprecates parenting children to a Graphics, so the icon cannot hang off
   * `g` — and it still has to rise and fall with it, hence a Container the bob
   * is applied to rather than moving the two pieces separately.
   */
  private bobC = new Container();
  private g = new Graphics();
  private label!: Text;
  private icon: Sprite | null = null;
  private pickedUp = false;
  /** Free-running counter driving the idle bob. */
  private bob = 0;

  constructor(spec: PickupItemSpec) {
    this.spec = spec;
    this.view.x = spec.x;
    this.view.y = spec.y;
    this.bobC.addChild(this.g);
    this.view.addChild(this.bobC);
    this.draw();
  }

  /** Touch attempt by `unit`; returns true if it was picked up. */
  tryTouch(unit: UnitLike): boolean {
    if (this.pickedUp) return false;
    // Only one crown may exist at a time, and only Units can carry it.
    if (this.spec.kind === "jug" && (SD.matchSettings.curJug || !unit.setJug)) {
      return false;
    }
    // Match the SWF touch test: a ~51x53 box (half-extents ~26) checked at
    // chest height, not the feet (Unit.as: hitTest(pickup.hitBox, 0, -30)).
    if (Math.abs(unit.x - this.spec.x) > 26 || Math.abs(unit.y - 20 - this.spec.y) > 26) {
      return false;
    }
    this.applyTo(unit);
    this.pickedUp = true;
    this.view.visible = false;
    this.respawnTicks = this.spec.respawnSecs * FRAMES_PER_SEC;
    return true;
  }

  enterFrame(): void {
    if (!this.pickedUp) {
      // Idle bob so the floor pickup reads as a floating collectable.
      this.bob = (this.bob + 1) % 360;
      this.bobC.y = Math.sin(this.bob * 0.08) * 2.5;
      return;
    }
    if (this.respawnTicks <= 0) return;
    // The crown does not re-arm while somebody is still wearing it — its timer
    // only starts once the current Juggernaut has been put down.
    if (this.spec.kind === "jug" && SD.matchSettings.curJug) return;
    this.respawnTicks--;
    if (this.respawnTicks === 0) {
      this.pickedUp = false;
      this.view.visible = true;
    }
  }

  private draw(): void {
    this.g.clear();
    // Only ever called from the constructor today, but a second call would
    // otherwise stack a fresh sprite on the old one.
    if (this.icon) {
      this.icon.destroy();
      this.icon = null;
    }
    // Authentic SWF floater icon when one exists (all items but the crown).
    const tex = PickupArt.getTexture(this.spec.kind);
    if (tex) {
      this.icon = new Sprite(tex);
      this.icon.anchor.set(0.5);
      this.icon.scale.set(ICON_ART_SCALE);
      this.bobC.addChild(this.icon);
      return;
    }
    // Fallback disc + letter (the Juggernaut crown).
    const r = 9;
    const c = COLORS[this.spec.kind];
    this.g.circle(0, 0, r).fill({ color: c, alpha: 0.9 }).stroke({
      color: 0x000000,
      width: 1.5,
      alpha: 0.6,
    });
    this.label = new Text({
      text: LETTERS[this.spec.kind],
      style: new TextStyle({
        fill: 0xffffff,
        fontSize: 9,
        fontWeight: "bold",
        fontFamily: "Arial, sans-serif",
      }),
    });
    this.label.anchor.set(0.5);
    this.bobC.addChild(this.label);
  }

  private applyTo(unit: UnitLike): void {
    const s = unit.status;
    // Centre-screen callout for the human on the timed power-ups (the original
    // only announced ddamage / invin via hud.bigText).
    if (unit.human) {
      const banner = BANNER[this.spec.kind];
      if (banner) unit.game.hud?.announce?.(banner[0], banner[1]);
    }
    switch (this.spec.kind) {
      case "shield":
        s.addShield(0.5);
        unit.game.addEffect(unit.x, unit.y, "getShield");
        break;
      case "shieldBig":
        s.addShield(1);
        unit.game.addEffect(unit.x, unit.y, "getShield");
        break;
      case "health":
        s.heal(0.5);
        unit.game.addEffect(unit.x, unit.y, "getHealth");
        break;
      case "healthBig":
        s.heal(1);
        unit.game.addEffect(unit.x, unit.y, "getHealth");
        break;
      case "ddamage":
        s.startStatus("ddamage");
        unit.game.addEffect(unit.x, unit.y, "getDdamage");
        break;
      case "rapid":
        s.startStatus("rapid");
        unit.game.addEffect(unit.x, unit.y, "getDdamage");
        break;
      case "fade":
        s.startStatus("fade");
        unit.game.addEffect(unit.x, unit.y, "getFade");
        break;
      case "invin":
        s.startStatus("invin");
        unit.game.addEffect(unit.x, unit.y, "getInvin");
        break;
      case "jug":
        // Unit.setJug applies the buff, tints the name bar and announces it.
        unit.setJug?.();
        unit.game.addEffect(unit.x, unit.y, "getJug");
        break;
    }
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}
