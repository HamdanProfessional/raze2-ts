import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { RAZE2_WEAPON_BY_ID } from "../assets/raze2";
import { canHarm } from "./Match";
import type { KillCause } from "./KillBonus";

/** One tick of burn damage: the `fire` pseudo-gun's `dmg`, on the port's ×10
 *  HP scale (`Stats_Guns` row `fire`, dmg 1 → 10 here). */
const FIRE_DAMAGE = (RAZE2_WEAPON_BY_ID.fire?.dmg ?? 1) * 10;

/**
 * Health, shield, damage resolution and death. Distilled from Status.as.
 *
 * Base HP and max shield are a flat 1000 for every unit (HP further scaled by
 * extra.hpMod); difficulty is applied to a bot's outgoing damage instead, so no
 * enemy is a bullet sponge. Damage is soaked by shield first, then health. Reaching 0 HP triggers the unit's
 * death (which spawns the ragdoll via the physics layer).
 *
 * Power-up timers at 30 fps (frame counts, NOT on the x10 HP scale):
 *   ddamage — double outgoing damage for 210 frames (7s)
 *   rapid   — halved shot delay / free ammo for 195 frames (6.5s)
 *   invin   — full invulnerability for 165 frames (5.5s)
 *   fade    — 60% alpha cloak + reduced hit radius; port-only (Raze 2 has no
 *             fade pickup, cloak is an ability), so its 450 is not from the SWF
 */
export class Status {
  hpMax: number;
  hpCur: number;
  shMax: number;
  shCur = 0;
  dead = false;
  /** Frames of spawn-invulnerability remaining. */
  private invuln = 0;

  ddamageTimer = 0;
  /** Frames left of Rapid Fire (`sRapid`). While >0 the gun's between-shot
   *  delay is halved, no ammo is spent, and semi-auto guns repeat on a held
   *  trigger. See `Guns.as:365/406/416`. */
  rapidTimer = 0;
  fadeTimer = 0;
  invinTimer = 0;
  /** Frames left of Static Field's projectile-reflect window (sMirror in the
   *  original). While >0, incoming enemy projectiles near this unit are turned
   *  back on their sender (see enterFrame). Set by the `static` ability. */
  reflectTimer = 0;
  /** Frames left burning (`sFire`). A weapon whose `extra.setFire` is N sets
   *  this to N*30 on hit; every third frame it deals the `fire` pseudo-gun's
   *  damage, credited to whoever lit you. Ablative Plating (`equips.critdef`)
   *  makes you immune, and wading into water puts it out. */
  fireTimer = 0;
  /** Who set this unit alight — kill credit for the burn (`sFireUnit`). */
  fireBy: any = null;

  // --- ability energy (Status.as enCur/enMax) ----------------------------
  /** Ability energy, 0..enMax. Spawns full (matches the SWF). */
  enCur = 100;
  enMax = 100;
  /** Per-frame energy gain: the ability's recharge rate, scaled by the
   *  Cooling Packs equipment (equips.recharge). 0 when no ability equipped. */
  abilityCharge = 0;
  /** Adrenaline Boost (equips.final) one-shot guard: true once it has saved the
   *  unit, cleared again after healing back above the 1% floor. */
  private finalSpent = false;

  constructor(public unit: any) {
    const hpMod = unit.extra?.hpMod ?? 1;
    const equips: Record<string, number> = unit.equips ?? {};
    // "4x Health" special mode (doc 11 §2.1): quadruple the base pool. This
    // scales the base *before* the flat Combat Armor add below, so a 4x unit is
    // 4000 + 500 (not (1000+500)*4) — matching the SWF ordering (hpMax = 400
    // then += equips.health).
    const hpMult = Number(SD.matchSettings.hpMult) || 1;
    // Every combatant gets the same pool regardless of skill: difficulty is
    // expressed in how hard a bot hits (see dmgPlayerMod), not in how much it
    // can absorb, so a hard bot is a threat rather than a bullet sponge.
    this.hpMax = this.hpCur = 1000 * hpMod * hpMult;
    // Combat Armor: despite the "+50% max health" flavour text, the SWF adds a
    // FLAT value to hpMax (Status.as:81 `hpMax += equips.health`, value 50) — it
    // only reads as "+50%" because the base pool is 100. It stays a flat +50 in
    // "4x Health" mode (there +50 on a 400 base is only +12.5%). Port HP is ×10,
    // so add value*10 (Combat Armor => +500 on the 1000 base).
    if (equips.health) this.hpMax = this.hpCur = this.hpMax + equips.health * 10;
    this.shMax = 1000;

    // Ability recharge rate (Status.as setAbility): the ability's own rate,
    // multiplied by Cooling Packs when equipped.
    this.abilityCharge = (unit.ability?.recharge ?? 0) * (equips.recharge || 1);
    // AI-only difficulty scalar (Status.as:132-135): non-human units recharge
    // slower at low difficulty and ramp up with it, so higher-difficulty bots
    // reuse abilities faster. Humans always charge at the base rate. The
    // original's `unit.diff` (0..5) is `diffMod` here — the port's difficulty
    // scalar — so the formula reads `diffMod*0.1+0.5`, clamped to never exceed
    // the human base rate.
    if (!unit.human) {
      this.abilityCharge *= Math.min(1, (unit.diffMod ?? 1) * 0.1 + 0.5);
    }

    // Shield Battery: spawn with a slice of shield already up (value is a %).
    if (equips.spspawn) this.addShield(equips.spspawn / 100, false);
  }

  // --- ability energy helpers ---------------------------------------------
  getEnPer(): number {
    return this.enMax ? this.enCur / this.enMax : 0;
  }
  hasEnergy(n: number): boolean {
    return this.enCur >= n;
  }
  useEnergy(n: number): void {
    this.enCur = Math.max(0, this.enCur - n);
  }
  /** Bonus energy on a kill (a port addition on top of the timed charge). */
  addEnergy(n: number): void {
    this.enCur = Math.min(this.enMax, this.enCur + n);
  }

  getHpPer(): number {
    return this.hpCur / this.hpMax;
  }
  getShPer(): number {
    return this.shMax ? this.shCur / this.shMax : 0;
  }

  /** Restore `fraction` of max HP (0..1). Pickup Booster scales the amount
   *  (it only applies to actual pickups — pass `boosted=false` for ability /
   *  passive-regen heals, which the item's "from pickups" text doesn't cover). */
  heal(fraction: number, boosted = true): void {
    const boost = boosted ? this.unit.equips?.pcboost || 1 : 1;
    this.hpCur = Math.min(this.hpMax, this.hpCur + this.hpMax * fraction * boost);
  }
  /** Restore a flat HP amount (Emergency Heal's original fixed 60/30 HP, ×10
   *  under the port's HP convention). Independent of hpMax, so a Combat-Armor
   *  unit heals the same absolute amount as a base unit — matching the original
   *  (Status.as heal(60)/heal(30)) rather than a percentage of the pool. */
  healFlat(amount: number, boosted = false): void {
    const boost = boosted ? this.unit.equips?.pcboost || 1 : 1;
    this.hpCur = Math.min(this.hpMax, this.hpCur + amount * boost);
  }
  /** Add `fraction` of max shield (0..1). Pickup Booster scales the amount
   *  (pickups only — see `heal`). */
  addShield(fraction: number, boosted = true): void {
    const boost = boosted ? this.unit.equips?.pcboost || 1 : 1;
    this.shCur = Math.min(this.shMax, this.shCur + this.shMax * fraction * boost);
  }

  /** Grant a timed status effect or spawn protection. Power Extender
   *  (equips.powerup) stretches the timed power-ups (not spawn protection). */
  startStatus(kind: string): void {
    const pu = this.unit.equips?.powerup || 1;
    switch (kind) {
      case "spawn":  this.invuln = 30; break;
      // `NodePickup.as:222` — 7 s (7*30), stretched by Power Extender.
      case "ddamage": this.ddamageTimer = Math.round(210 * pu); break;
      // `NodePickup.as:245` — 6.5 s, stretched by Power Extender like the rest.
      case "rapid":   this.rapidTimer = Math.round(195 * pu); break;
      // No SWF counterpart — see the class doc. Port-only value.
      case "fade":    this.fadeTimer = Math.round(450 * pu); break;
      // `NodePickup.as:203` — 5.5 s (5.5*30), the shortest of the three.
      case "invin":   this.invinTimer = Math.round(165 * pu); break;
    }
  }

  /**
   * Outgoing damage multiplier: 2x while the ddamage power-up is running, and
   * a further 1.5x on top while this unit holds the Juggernaut crown.
   */
  get damageMult(): number {
    let mult = this.ddamageTimer > 0 ? 2 : 1;
    if (this.unit?.isJug) mult *= 1.5;
    return mult;
  }

  /**
   * Fraction of a weapon's listed damage this unit lands on the human player.
   * Bots shoot the same guns the player does, so difficulty is applied here
   * instead: a level-4 enemy deals 60% of what its rifle says, a level-9 boss
   * 110%. Nothing scales the player's own damage.
   *
   * `unit.diff` is the authentic 0..10 skill rating; the player carries 10 and
   * never reads these, so the fallback is only for damage with no live shooter.
   */
  get dmgPlayerMod(): number {
    return (this.unit?.diff ?? 10) * 0.1 + 0.2;
  }

  /** The same scalar for a bot shooting another bot — a flatter curve, so a
   *  weak bot is not completely harmless to its peers. */
  get dmgAiMod(): number {
    return (this.unit?.diff ?? 10) * 0.09 + 0.3;
  }

  /**
   * Apply damage. `info` carries the attacker + hit direction for the ragdoll.
   * Returns true if this blow killed the unit.
   */
  doDamage(
    amount: number,
    info: {
      attacker?: any;
      x: number;
      y: number;
      headShot?: boolean;
      region?: string;
      /** Killing weapon's Raze 2 `force`, used to scale the death ragdoll kick. */
      force?: number;
      /**
       * Ignore spawn invulnerability and the invincibility power-up — the
       * `param5` of `Status.as:204`, which skips the `sSpawn` / `sInvin` /
       * `sMirror` guards. Only the arena-containment kill sets it, exactly as
       * in the original: lava and the other hazards go through the normal path,
       * so being invincible really does protect you from them.
       */
      bypass?: boolean;
      /** What landed the blow — see `KillBonus.KillCause`. Carried through to
       *  the kill so the bonus dispatch can read it. */
      cause?: KillCause;
    },
  ): boolean {
    if (this.dead) return false;
    if (!info.bypass && (this.invuln > 0 || this.invinTimer > 0)) return false;

    const equips: Record<string, number> = this.unit.equips ?? {};

    // Juggernaught perk (doc 11 §1.5 / §2): the crowned unit takes only 40% of
    // incoming damage (60% reduction). Applied first, before shield/equipment
    // soak, exactly like the SWF `Status.damage()` x0.4 multiplier.
    if (this.unit?.isJug) amount *= 0.4;

    // Difficulty scaling lives on the shooter's output, not on anyone's health
    // pool. Self-damage and the player's own shots are untouched.
    const from = info.attacker;
    if (from && from !== this.unit && !from.human) {
      amount *= this.unit?.human ? from.status.dmgPlayerMod : from.status.dmgAiMod;
    }

    // Friendly fire lands at 30% and is flagged as a betrayal, which costs the
    // shooter the kill entirely (`Status.as:232-234`).
    if (from && from !== this.unit && from.team && from.team === this.unit.team) {
      amount *= 0.3;
      info.cause = { ...info.cause, teamkill: true };
    }

    // "What Shield?" is decided here because it is the only place that can see
    // the shield pool *before* the blow spends it: 20%+ up, and still fatal.
    if (this.shCur >= this.shMax * 0.2) {
      info.cause = { ...info.cause, noShield: true };
    }

    // A weapon that sets you alight does so on every hit, fatal or not.
    if (info.cause?.setFire) this.setFire(info.cause.setFire, from);

    // Flux Capacitor: while any shield is up, all incoming damage is reduced
    // (value 0.8 = -20%) before it is soaked / carried to health.
    if (this.shCur > 0 && equips.shield) amount *= equips.shield;

    // Kept for the feedback below: `amount` is consumed by the shield pass.
    const dealt = amount;

    // Shield first, remainder to health.
    if (this.shCur > 0) {
      const soak = Math.min(this.shCur, amount);
      this.shCur -= soak;
      amount -= soak;
      // `Status.as:354`: the blow that empties the pool pops the shield, at
      // torso height rather than at the feet. Only on the transition to zero —
      // shooting someone whose shield is already down does nothing.
      if (this.shCur <= 0 && this.unit) {
        this.unit.game?.addEffect?.(this.unit.x, this.unit.y - 40, "shieldbreak");
      }
    }
    this.hpCur -= amount;

    // Adrenaline Boost: a blow that would be fatal instead leaves you at 1% of
    // max HP — once, until you heal back above that floor (SWF finalChance).
    if (equips.final && this.hpCur <= 0 && !this.finalSpent) {
      this.hpCur = this.hpMax * 0.01;
      this.finalSpent = true;
      this.hitFeedback(dealt, info.attacker);
      return false;
    }

    if (this.hpCur <= 0) {
      this.hpCur = 0;
      this.die(info);
      return true;
    }
    this.hitFeedback(dealt, info.attacker);
    return false;
  }

  /**
   * Non-lethal hit response, scaled by how big the blow was relative to this
   * unit's own health pool (so it reads the same for a buffed Juggernaut as a
   * plain bot).
   *
   * The player gets a red screen edge — the only reliable "you are being shot
   * from off-screen" cue. Everyone gets stagger on a heavy hit, which is what
   * makes a shotgun blast feel like it connected rather than just ticking a
   * health bar down.
   */
  private hitFeedback(dealt: number, attacker?: any): void {
    const frac = this.hpMax > 0 ? dealt / this.hpMax : 0;
    if (this.unit?.human) {
      // The attacker's position (when there is one) drives the HUD's
      // directional wedge; splash and fall damage have no bearing to show.
      const from =
        attacker && attacker !== this.unit
          ? { x: attacker.x, y: attacker.y - 45 * (attacker.scale ?? 1) }
          : undefined;
      this.unit.game?.flashDamage?.(Math.min(1, frac / 0.35), from);
    }
    // ~20% of a health bar in one blow is the threshold for a visible stagger.
    if (frac >= 0.2) {
      this.unit?.applyHitStun?.(Math.round(3 + Math.min(1, frac) * 7));
    }
  }

  private die(info: {
    attacker?: any;
    x: number;
    y: number;
    headShot?: boolean;
    region?: string;
    cause?: KillCause;
  }): void {
    this.dead = true;
    this.fireTimer = 0;
    this.unit.killGuy(info);
  }

  /**
   * Static Field reflect: while the shield window is up, any in-flight enemy
   * projectile that comes within reach is turned back on its sender. We reverse
   * its velocity and re-own it to this unit, so the same shot now travels back
   * and can harm the original attacker (the `reflected` flag stops us bouncing
   * it again every frame). Settled mines and stuck grenades are left alone.
   * Reproduces the original's `sMirror` reflection (Unit.as:1183-1212).
   */
  private reflectProjectiles(): void {
    const game: any = this.unit.game;
    const list: any[] = game?.frameEff;
    if (!list || !list.length) return;
    const REFLECT_RADIUS = 70; // px around the shielded unit's torso
    const cx = this.unit.x;
    const cy = this.unit.y - 40 * (this.unit.scale ?? 1);
    for (const p of list) {
      if (!p || typeof p.vx !== "number" || typeof p.vy !== "number") continue;
      if (p.reflected || p.settled || p.stuckTo) continue;
      const owner = p.owner;
      if (!owner || owner === this.unit || !canHarm(owner, this.unit)) continue;
      if (UT.getDist(cx, cy, p.x, p.y) > REFLECT_RADIUS) continue;
      p.vx = -p.vx;
      p.vy = -p.vy;
      p.owner = this.unit;
      p.reflected = true;
      // Remember whose shot this WAS. `Bullet.as:194` passes the original
      // shooter along as `extra.reflect`, and the bonus dispatch reads it: back
      // into its sender is "Reflection!", into a third party is "Thanks!".
      p.reflectedFrom = owner;
    }
  }

  /**
   * Set this unit alight (`Status.as:236-239`). `secs` is the weapon's
   * `extra.setFire`, in seconds. Ablative Plating (`equips.critdef`) makes a
   * unit fireproof outright — the original checks it here, not on the tick.
   */
  setFire(secs: number, by: any): void {
    if (!secs || this.unit.equips?.critdef) return;
    this.fireTimer = Math.round(secs * 30);
    this.fireBy = by ?? null;
  }

  /** Put the fire out — wading into water (`Unit.as:1034/1041`). */
  douseFire(): void {
    this.fireTimer = 0;
  }

  /**
   * Burn damage, `Status.as:541-562`. Every third frame while alight: a flame
   * lick somewhere on the body and one tick of the `fire` pseudo-gun's damage,
   * credited to whoever lit the fire so the kill (and its "Hot Hot Hot!" bonus)
   * goes to them. The campaign's `dblFire` modifier trebles it.
   */
  private burnTick(): void {
    if ((this.fireTimer - 1) % 3 === 0 && !this.dead) {
      const u = this.unit;
      u.game?.addEffect?.(u.x + UT.rand(-10, 10), u.y + UT.rand(-60, -5), "fexpand");
      const mult = u.extra?.dblFire ? 3 : 1;
      this.doDamage(FIRE_DAMAGE * mult, {
        attacker: this.fireBy,
        x: 0,
        y: -1,
        cause: { gun: "fire" },
      });
    }
    this.fireTimer--;
  }

  enterFrame(): void {
    if (this.invuln > 0) this.invuln--;
    if (this.ddamageTimer > 0) this.ddamageTimer--;
    if (this.rapidTimer > 0) this.rapidTimer--;
    if (this.fadeTimer > 0) {
      this.fadeTimer--;
      this.unit.view.alpha = 0.4;
    } else if (this.fadeTimer === 0 && this.unit.view.alpha < 1) {
      this.unit.view.alpha = 1;
    }
    if (this.invinTimer > 0) this.invinTimer--;
    if (this.reflectTimer > 0) {
      this.reflectTimer--;
      this.reflectProjectiles();
    }
    if (this.fireTimer > 0) this.burnTick();

    const equips: Record<string, number> = this.unit.equips ?? {};

    // Medipack: trickle-regen while HP is under the ABSOLUTE 40-HP threshold
    // (Status.as:415 checks `hpCur < 40`, not a % of hpMax — so a Combat-Armor
    // or "4x Health" unit's threshold does not scale up). Heals a flat 0.2
    // HP/frame with no VFX. Both quantities are ×10 in the port (threshold 400,
    // heal 2 HP/frame).
    if (equips.hprecover && !this.dead && this.hpCur < 40 * 10) {
      this.healFlat(equips.hprecover * 10, false);
    }
    // Re-arm the Adrenaline Boost once healed back above its 1% floor.
    if (this.finalSpent && this.getHpPer() > 0.01) this.finalSpent = false;

    // Ability energy charges every frame toward the cap.
    if (this.enCur < this.enMax) {
      this.enCur = Math.min(this.enMax, this.enCur + this.abilityCharge);
    }
  }
}
