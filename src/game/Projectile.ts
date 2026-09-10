import { Container, Graphics } from "pixi.js";
import { UT } from "../core/UT";
import { Sound } from "../audio/Sounds";
import { SD } from "../state/SD";
import { canHarm } from "./Match";
import { Achievements } from "./Achievements";
import type { WeaponDef } from "./weapons";
import type { GameScreen } from "./GameScreen";
import type { Unit } from "./Unit";

/**
 * A travelling projectile (uzi bolt, grenade, rocket). Ported from the
 * Effect_Proj_* behaviour: moves under its own velocity plus gravity
 * (fallSpeed), and on hitting a wall or enemy deals direct or splash damage.
 *
 * Registered with Game.frameEff so its enterFrame runs each tick.
 */
/** Frames a grenade clings to its victim before detonating (~0.8s at 30fps). */
const STICK_FUSE = 25;

/**
 * Hearing range for a detonation, in arena pixels (see Sound.playAt). Larger
 * than any map so a blast is never silently culled — it still attenuates and
 * pans, it just always reaches you.
 */
const BLAST_RANGE = 2600;

export class Projectile {
  readonly view = new Container();
  private g = new Graphics();
  private trailG = new Graphics();
  private trail: { x: number; y: number }[] = [];
  private readonly kind: "rocket" | "grenade" | "flame" | "other";
  private spin = 0;
  /** Core / glow body tints, from the weapon's Raze 2 trail effect (doc 04). */
  private readonly core: number;
  private readonly glowC: number;
  /** Saw blades keep travelling through the ground at 2× damage (extra.burrow). */
  private burrowing = false;
  private dmgMult = 1;

  private x: number;
  private y: number;
  private vx: number;
  private vy: number;
  private life = 0;
  /** Travel distance before the shell expires. Base `def.maxRange` plus the
   *  Spiral Chamber equip (owner.equips.range → flat +value*10), mirroring the
   *  SWF `maxDist += unit.equips.range` (Bullet.as:100-104). */
  private readonly maxDist: number;

  /** Grenades only: the unit this shell is stuck to while its fuse burns. */
  private stuckTo: Unit | null = null;
  private stuckDX = 0;
  private stuckDY = 0;
  private fuse = 0;
  /** Wall bounces so far (Bullet_Proj_Bounce). */
  private bounceCount = 0;
  /** A mine that has landed and armed (Bullet_Proj_Mine). */
  private settled = false;

  constructor(
    private game: GameScreen,
    private owner: Unit,
    private def: WeaponDef,
    x: number,
    y: number,
    angleDeg: number,
  ) {
    this.x = x;
    this.y = y;
    const rad = (angleDeg * Math.PI) / 180;
    const speed = (def.speed ?? 3) * 4;
    this.vx = Math.cos(rad) * speed;
    this.vy = Math.sin(rad) * speed;
    // Spiral Chamber (owner.equips.range): flat +value*10 to travel distance.
    this.maxDist = (def.maxRange ?? 300)
      + (owner.equips?.range ? owner.equips.range * 10 : 0);

    // Body art follows how the round behaves, not which gun fired it: a lobbed
    // munition that sticks or bounces tumbles as a ball, a big-blast round under
    // thrust flies as a missile, and everything else is an energy bolt.
    const lobbed = def.stick || def.bounce;
    this.kind =
      def.flame ? "flame" :
      lobbed ? "grenade" :
      (def.splashRadius ?? 0) >= 100 ? "rocket" : "other";
    this.core = def.projColor ?? 0xffaa33;
    this.glowC = def.projGlow ?? this.core;

    this.view.addChild(this.trailG);
    this.view.addChild(this.g);
    this.drawBody();
    this.view.x = x;
    this.view.y = y;
  }

  /** Body art per projectile kind — drawn once and re-oriented as it flies. */
  private drawBody(): void {
    const g = this.g;
    g.clear();
    switch (this.kind) {
      case "rocket":
        // Small missile body: dark fuselage + orange nose + fin.
        g.rect(-6, -1.6, 10, 3.2).fill({ color: 0x445055 });
        g.circle(5, 0, 2).fill({ color: 0xff6a2a });
        g.moveTo(-6, -1.6).lineTo(-9, 0).lineTo(-6, 1.6).fill({ color: 0x2a3236 });
        break;
      case "grenade":
        g.circle(0, 0, 3.4).fill({ color: this.core });
        g.circle(-1, -1, 1.1).fill({ color: this.glowC, alpha: 0.6 });
        break;
      case "flame":
        // Billowing flame: a hot core inside a softer glow.
        g.circle(0, 0, 5).fill({ color: this.glowC, alpha: 0.45 });
        g.circle(0, 0, 3).fill({ color: this.core, alpha: 0.85 });
        g.circle(0, 0, 1.4).fill({ color: 0xffffcc, alpha: 0.9 });
        break;
      default:
        // Energy bolt: glow halo + bright core.
        g.circle(0, 0, 4).fill({ color: this.glowC, alpha: 0.4 });
        g.circle(0, 0, 2.6).fill({ color: this.core });
        break;
    }
  }

  enterFrame(): void {
    this.life++;

    // Stuck grenade: ride the carrier until the fuse burns out.
    if (this.stuckTo) {
      const host = this.stuckTo;
      this.x = host.x + this.stuckDX;
      this.y = host.y + this.stuckDY;
      this.view.x = this.x;
      this.view.y = this.y;
      this.spin += 0.15;
      this.g.rotation = this.spin;
      // Blink faster as it is about to blow.
      this.g.alpha = this.fuse % 8 < 4 ? 1 : 0.45;
      if (--this.fuse <= 0) this.explode();
      return;
    }

    // Armed mine sitting on a surface: proximity + lifetime, no movement.
    if (this.settled) {
      this.mineTick();
      return;
    }

    // Homing rounds steer toward the nearest enemy before moving.
    if (this.def.homing) this.steerHoming();

    if (this.def.flame) {
      // Flamethrower: the flame billows *upward* rather than falling
      // (Bullet_Proj_Frames, params[2] = -2), and fans out as it rises.
      this.vy -= 0.18;
      this.vx *= 0.97;
    } else {
      this.vy += (this.def.fallSpeed ?? 0) * 0.8; // gravity per fallSpeed
    }
    this.x += this.vx;
    this.y += this.vy;
    this.view.x = this.x;
    this.view.y = this.y;
    this.view.rotation = Math.atan2(this.vy, this.vx);
    if (this.kind === "grenade") {
      this.spin += 0.3;
      this.g.rotation = this.spin;
    }

    // Trail: a short fading history of recent positions.
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 8) this.trail.shift();
    this.trailG.clear();
    if (this.trail.length > 1) {
      const local = this.trail.map((p) => ({
        x: p.x - this.x,
        y: p.y - this.y,
      }));
      // Rotate trail points into local (unrotated) space since view.rotation
      // is applied to the whole container.
      const cos = Math.cos(-this.view.rotation);
      const sin = Math.sin(-this.view.rotation);
      for (let i = 0; i < local.length - 1; i++) {
        const a = local[i];
        const b = local[i + 1];
        const ax = a.x * cos - a.y * sin;
        const ay = a.x * sin + a.y * cos;
        const bx = b.x * cos - b.y * sin;
        const by = b.x * sin + b.y * cos;
        const alpha = (i / local.length) * 0.5;
        const color = this.glowC;
        this.trailG
          .moveTo(ax, ay)
          .lineTo(bx, by)
          .stroke({ color, width: 2, alpha });
      }
    }

    // Wall / floor collision.
    const hitSurface = this.game.arena.pointInWall(this.x, this.y) || this.y >= this.game.arena.floorY;
    if (hitSurface) {
      if (this.def.mine) { this.settle(); return; }
      if (this.def.burrow) {
        // Shredder saw blades keep travelling *through* the ground at 2× damage
        // instead of stopping (extra.burrow, doc 04 §1.2). Nudge upward so the
        // blade rides the surface, and leave a dirt spurt.
        if (!this.burrowing) { this.burrowing = true; this.dmgMult = 2; }
        this.vy -= 0.2;
        if (this.life % 3 === 0) this.game.addEffect(this.x, this.y, "bullet", this.glowC);
        // fall through to the unit-hit scan below (no explode / no return).
      } else if (this.def.bounce != null) {
        this.doBounce();
        this.bounceCount++;
        if (this.bounceCount > this.def.bounce || this.life > (this.def.bounceLife ?? 90)) this.explode();
        return;
      } else {
        this.explode();
        return;
      }
    }

    // Out of range: bouncers/mines expire in place, everything else detonates.
    if (this.life * (this.def.speed ?? 3) * 4 > this.maxDist) {
      this.explode();
      return;
    }

    // Direct unit hit.
    for (const u of this.game.units) {
      if (u === this.owner || u.status.dead) continue;
      if (!canHarm(this.owner, u)) continue;
      if (UT.getDist(this.x, this.y, u.x, u.y - 40) < 22) {
        // Sticky shells (the Grenade Launcher) cling and cook off; mines only
        // trigger by proximity once armed, so ignore fly-through.
        if (this.def.stick) this.stickTo(u);
        else if (this.def.mine) continue;
        else this.explode(u);
        return;
      }
    }
  }

  /** Steer the velocity toward the nearest harmable enemy within seek radius. */
  private steerHoming(): void {
    const R = this.def.seekRadius ?? 180;
    let best: Unit | null = null;
    let bestD = R;
    for (const u of this.game.units) {
      if (u === this.owner || u.status.dead) continue;
      if (!canHarm(this.owner, u)) continue;
      const d = UT.getDist(this.x, this.y, u.x, u.y - 40);
      if (d < bestD) { bestD = d; best = u; }
    }
    if (!best) return;
    const speed = Math.hypot(this.vx, this.vy) || 1;
    const cur = Math.atan2(this.vy, this.vx);
    const want = Math.atan2(best.y - 40 - this.y, best.x - this.x);
    let d = want - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // Turn rate: Raze 2 stores it in degrees/frame (params[4]); convert.
    const turn = this.def.homingTurn != null
      ? (this.def.homingTurn * Math.PI) / 180
      : (this.def.homing ?? 0.12);
    const a = cur + Math.max(-turn, Math.min(turn, d));
    this.vx = Math.cos(a) * speed;
    this.vy = Math.sin(a) * speed;
  }

  /** Reflect off the surface just hit, damping the velocity. */
  private doBounce(): void {
    const arena = this.game.arena;
    if (this.y >= arena.floorY) {
      this.vy = -Math.abs(this.vy) * 0.6;
      this.y = arena.floorY - 1;
    } else {
      const vSurface = arena.pointInWall(this.x - this.vx, this.y); // vertical wall
      const hSurface = arena.pointInWall(this.x, this.y - this.vy); // horizontal ceiling/floor
      if (vSurface && !hSurface) this.vx = -this.vx * 0.7;
      else if (hSurface && !vSurface) this.vy = -this.vy * 0.7;
      else { this.vx = -this.vx * 0.7; this.vy = -this.vy * 0.7; }
    }
    // Step out of the surface so we don't re-collide next frame.
    this.x += this.vx;
    this.y += this.vy;
    this.view.x = this.x;
    this.view.y = this.y;
  }

  /** Arm as a stationary proximity mine on the surface it landed on. */
  private settle(): void {
    this.settled = true;
    this.vx = 0;
    this.vy = 0;
    if (this.y >= this.game.arena.floorY) this.y = this.game.arena.floorY - 2;
    this.view.x = this.x;
    this.view.y = this.y;
    this.trail.length = 0;
    this.trailG.clear();
    this.g.clear();
    this.g.circle(0, 0, 3).fill({ color: 0xff5544 }).stroke({ color: 0x882222, width: 1 });
  }

  /** Per-frame logic for an armed mine: blink, proximity trigger, lifetime. */
  private mineTick(): void {
    this.g.alpha = this.life % 20 < 10 ? 1 : 0.4;
    if (this.life > (this.def.mineLife ?? 300)) { this.explode(); return; }
    for (const u of this.game.units) {
      if (u === this.owner || u.status.dead) continue;
      if (!canHarm(this.owner, u)) continue;
      if (UT.getDist(this.x, this.y, u.x, u.y - 20) < 34) { this.explode(u); return; }
    }
  }

  /** Attach to `u` and start the fuse. The carrier is dragged along with it. */
  private stickTo(u: Unit): void {
    this.stuckTo = u;
    this.stuckDX = this.x - u.x;
    this.stuckDY = this.y - u.y;
    this.fuse = this.def.stickFuse ?? STICK_FUSE;
    this.vx = 0;
    this.vy = 0;
    this.trail.length = 0;
    this.trailG.clear();
  }

  /**
   * Spawn `n` radial "bouncer" ember sub-munitions from the impact point
   * (Assault Bouncer / bouncer, Bullet_Proj_Bounce). Each is a short-lived,
   * bouncing, direct-hit ember. Guarded so a bouncer can't recursively split.
   */
  private spawnBouncers(n: number): void {
    if (this.def.id === "bouncer") return;
    const sub: WeaponDef = {
      id: "bouncer",
      msg: this.def.msg,
      maxClip: 1, curAmmo: 0, maxAmmo: 0,
      maxRange: 260, recoil: 0, reDuck: 0, reJump: 0,
      damage: 100, // Raze 2 bouncer dmg 10 ×10
      projectile: true, speed: 1.4, fallSpeed: 3,
      bounce: 5, bounceLife: 30,
      projColor: 0xff9933, projGlow: 0xff5522,
      setFire: this.def.setFire,
      wallEff: "bulletExplode", unitEff: "bulletExplode",
    };
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * 360;
      const b = new Projectile(this.game, this.owner, sub, this.x, this.y, ang);
      this.game.addFrameEffect(b);
    }
  }

  private explode(direct?: Unit): void {
    // Assault Bouncer: on ANY impact, split into radial ember sub-munitions
    // (extra.bounceShots, doc 04 §1.2) before resolving this hit.
    if (this.def.bounceShots) this.spawnBouncers(this.def.bounceShots);

    const splash = this.def.splashMult ?? 0;
    const dmgMod = (Number(SD.matchSettings.dmgMod) || 1) * this.dmgMult;
    if (splash > 0) {
      const radius = this.def.splashRadius ?? 90;
      for (const u of this.game.units) {
        if (u.status.dead) continue;
        if (u !== this.owner && !canHarm(this.owner, u)) continue;
        const d = UT.getDist(this.x, this.y, u.x, u.y - 40);
        if (d < radius) {
          const dmg = this.def.damage * splash * (1 - d / radius) * dmgMod;
          const dir = UT.getRotation(this.x, this.y, u.x, u.y);
          const rad = (dir * Math.PI) / 180;
          const killed = u.status.doDamage(dmg, {
            attacker: this.owner,
            x: Math.cos(rad),
            y: Math.sin(rad),
          });
          // "Return to Sender": the thrower is killed by their own shell after
          // it stuck to somebody else. Armor Plating (equips.critdef) is
          // fireproof, so it never ignites.
          if (this.def.setFire && !u.equips?.critdef) {
            (u.status as any).setFire?.(this.def.setFire, this.owner);
          }
          if (
            killed && u === this.owner && this.stuckTo && this.stuckTo !== this.owner &&
            (this.stuckTo as any).human
          ) {
            Achievements.addAch("return");
          }
        }
      }
    } else if (direct) {
      const rad = Math.atan2(this.vy, this.vx);
      direct.status.doDamage(this.def.damage * dmgMod, {
        attacker: this.owner,
        x: Math.cos(rad),
        y: Math.sin(rad),
      });
      if (this.def.setFire && !direct.equips?.critdef) {
        (direct.status as any).setFire?.(this.def.setFire, this.owner);
      }
    }
    // At the blast, with a range to match: an explosion is heard map-wide.
    if (this.kind === "rocket") Sound.playAt("rocketexplode", this.x, this.y, 1, BLAST_RANGE);
    else if (this.kind === "grenade") Sound.playAt("explodenade", this.x, this.y, 1, BLAST_RANGE);
    // Bullet-type impacts spray back along the flight path (explosion effects
    // ignore the angle and stay radial).
    const backDeg = (Math.atan2(-this.vy, -this.vx) * 180) / Math.PI;
    this.game.addEffect(this.x, this.y, this.def.wallEff ?? "bullet", this.def.sparkColor, backDeg);
    this.game.removeFrameEffect(this);
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}
