/**
 * F-key abilities. Ported from Stats_Abilities.as (definitions) and Unit.as
 * `doAbility` (effects), Status.as (the energy resource).
 *
 * Each unit carries an energy bank (0..100) that charges every frame at
 * `recharge = 3.3 / rechargeSec` per tick — so a full bar takes `rechargeSec`
 * seconds at 30fps (the Cooling Packs equipment multiplies this by 1.3). The
 * Cooling Packs "recharge" equipment and a small on-kill bonus feed it too.
 * Pressing F spends the ability's `usedEnergy` (100 for all but Teleport, which
 * costs 30 so a full bar is three jumps) and runs its effect on the live unit.
 *
 * Effects are adapted to the port's systems: heal/shield/invin/cloak map onto
 * Status timers and helpers, the thrown grenade / dropped mine reuse Projectile,
 * the katana is a short melee arc, and teleport relocates to a spawn node.
 * Static Field grants invulnerability + action-lock AND, via `status.reflectTimer`
 * (the original's `sMirror`), turns incoming enemy projectiles back on their
 * sender for the shield's duration.
 */
import { UT } from "../core/UT";
import { Sound } from "../audio/Sounds";
import { SD } from "../state/SD";
import { Achievements } from "./Achievements";
import { WEAPONS, type WeaponDef } from "./weapons";
import { Projectile } from "./Projectile";
import { canHarm } from "./Match";

export interface AbilityDef {
  id: string;
  name: string;
  type: string;
  /** Seconds to charge a full 100-energy bar. */
  rechargeSec: number;
  /** Energy spent per activation. */
  usedEnergy: number;
  /** Per-frame energy gain = 3.3 / rechargeSec (Stats_Abilities.as:289). */
  recharge: number;
  /** Credit cost in the shop (0 = free default). */
  cost: number;
  shortDesc: string;
}

/** Selection order — the index persisted in the profile maps into this list. */
export const ABILITY_ORDER = [
  "ammo", "cloak", "static", "heal", "sword", "grenade", "mine", "teleport",
] as const;

/** Raw defs verbatim from Stats_Abilities.as (recharge derived in build()). */
const RAW: Record<string, Omit<AbilityDef, "recharge">> = {
  none: { id: "none", name: "Nothing", type: "N/A", rechargeSec: 0, usedEnergy: 100, cost: 0, shortDesc: "No ability equipped." },
  ammo: { id: "ammo", name: "Resupply", type: "Utility", rechargeSec: 20, usedEnergy: 100, cost: 0, shortDesc: "Refill the current weapon's ammo." },
  cloak: { id: "cloak", name: "Cloak", type: "Utility", rechargeSec: 10, usedEnergy: 100, cost: 500, shortDesc: "Turn invisible for 4 seconds." },
  static: { id: "static", name: "Static Field", type: "Defensive", rechargeSec: 10, usedEnergy: 100, cost: 1300, shortDesc: "Invulnerable but locked down for 1.5s (grounded)." },
  heal: { id: "heal", name: "Emergency Heal", type: "Defensive", rechargeSec: 15, usedEnergy: 100, cost: 1500, shortDesc: "Heal yourself and nearby allies." },
  sword: { id: "sword", name: "Katana", type: "Offense", rechargeSec: 2, usedEnergy: 100, cost: 2200, shortDesc: "A quick melee slash." },
  grenade: { id: "grenade", name: "Grenade", type: "Offense", rechargeSec: 5, usedEnergy: 100, cost: 2800, shortDesc: "Throw a bouncing grenade." },
  mine: { id: "mine", name: "Land Mine", type: "Offense", rechargeSec: 7, usedEnergy: 100, cost: 3500, shortDesc: "Drop a proximity mine." },
  teleport: { id: "teleport", name: "Teleport", type: "Relocation", rechargeSec: 7, usedEnergy: 30, cost: 4600, shortDesc: "Blink to a random spawn (3 per charge)." },
};

function build(raw: Omit<AbilityDef, "recharge">): AbilityDef {
  return { ...raw, recharge: raw.rechargeSec > 0 ? 3.3 / raw.rechargeSec : 0 };
}

/** Resolve an ability id to its full def; unknown / unset ids -> "none". */
export function getAbility(id: string | undefined): AbilityDef {
  return build(RAW[id ?? "none"] ?? RAW.none);
}

/** Every selectable ability (in selection order). */
export function allAbilities(): AbilityDef[] {
  return ABILITY_ORDER.map((id) => build(RAW[id]));
}

// --- ownership / economy ----------------------------------------------------

export function isAbilityOwned(id: string): boolean {
  return getAbility(id).cost === 0 || SD.abilitiesOwned.includes(id);
}

export function abilityCost(id: string): number {
  return getAbility(id).cost;
}

export function canBuyAbility(id: string): boolean {
  if (isAbilityOwned(id)) return false;
  return SD.credits >= abilityCost(id);
}

export function buyAbility(id: string): boolean {
  if (!canBuyAbility(id)) return false;
  SD.addCredits(-abilityCost(id));
  if (!SD.abilitiesOwned.includes(id)) SD.abilitiesOwned.push(id);
  SD.save();
  // "Versatile": purchase 4 abilities (the free "ammo" default doesn't count).
  if (SD.abilitiesOwned.filter((a) => a !== "ammo").length >= 4) {
    Achievements.addAch("abilities");
  }
  return true;
}

/** Equip an owned ability as the active F-key ability. */
export function equipAbility(id: string): boolean {
  if (!isAbilityOwned(id)) return false;
  SD.profile.prof_ability = id;
  SD.save();
  return true;
}

// --- activation -------------------------------------------------------------

const HEAL_RADIUS = 150; // px, ally heal reach (Unit.as heal loop)
// Emergency Heal: original flat +60 self / +30 allies (Stats_Abilities heal/healTeam),
// ×10 under the port's HP convention (1000-HP base = 100 ×10). Flat, not %-of-max.
const HEAL_SELF = 600;
const HEAL_TEAM = 300;
// Katana: original range*10 = 7*10 = 70px (Stats_Guns sword.range, per 03-weapons-guns.md:43).
const SWORD_RANGE = 70;
// Katana: original sword.dmg=75 → ×10 = 750 (matches the shop guns' ×10 raw-damage rule).
const SWORD_DAMAGE = 750;

/**
 * Try to activate `unit`'s equipped ability. Returns true when it fired
 * (energy was available and spent). Safe to call on any Unit.
 */
export function activateAbility(unit: any): boolean {
  const ab: AbilityDef = unit.ability ?? getAbility("none");
  if (ab.id === "none") return false;
  const st = unit.status;
  if (!st || st.dead) return false;
  if (!st.hasEnergy(ab.usedEnergy)) return false;
  // Static Field can only be raised while grounded (Unit.as:1183).
  if (ab.id === "static" && unit.jumping) return false;

  st.useEnergy(ab.usedEnergy);
  apply(unit, ab);
  return true;
}

function apply(unit: any, ab: AbilityDef): void {
  const game = unit.game;
  const st = unit.status;
  switch (ab.id) {
    case "ammo": {
      // Resupply: one spare clip for the current weapon — Unit.as:1256 is
      // `gun.addClip(gun.curNum, 1)`, not a full rearm. It tops up the reserve
      // only, so switching to a dry weapon replenishes it (as the catalog text
      // promises) while a resupply mid-magazine still costs you the reload.
      unit.gun?.addClip(unit.gun.curGunName, 1);
      game.addEffect(unit.x, unit.y - 40 * unit.scale, "getShield");
      // Resupply: S_Equip (human only) — Unit.as:1256.
      if (unit.human) Sound.playAt?.("R2_Equip", unit.x, unit.y);
      break;
    }
    case "cloak": {
      // 4 s of the fade/cloak (whole-unit alpha handled by Status.enterFrame).
      st.fadeTimer = Math.round(4 * 30);
      game.addEffect(unit.x, unit.y - 40 * unit.scale, "getFade");
      // Cloak buff: S_Powerup (human only) — Unit.as:1246.
      if (unit.human) Sound.playAt?.("R2_Powerup", unit.x, unit.y);
      break;
    }
    case "static": {
      // 1.5 s of invulnerability + full action-lock + the sMirror projectile-
      // reflect window (Status.reflectProjectiles turns enemy shots around).
      const frames = Math.round(1.5 * 30);
      st.invinTimer = frames;
      st.reflectTimer = frames;
      unit.abilityLock = frames;
      game.addEffect(unit.x, unit.y - 40 * unit.scale, "getInvin");
      // Static Field activation: S_Static — Unit.as:1187.
      Sound.playAt?.("R2_Static", unit.x, unit.y);
      break;
    }
    case "heal": {
      // Flat +60 self (×10 = 600); independent of hpMax (Unit.as heal=60). Not a
      // pickup, so Pickup Booster doesn't apply.
      st.healFlat(HEAL_SELF, false);
      game.addEffect(unit.x, unit.y - 40 * unit.scale, "getHealth");
      // Emergency Heal: S_Heal (human only) — Unit.as:1216.
      if (unit.human) Sound.playAt?.("R2_Heal", unit.x, unit.y);
      if (unit.team) {
        for (const other of game.units) {
          if (other === unit || other.status?.dead) continue;
          if (other.team !== unit.team) continue;
          if (UT.getDist(unit.x, unit.y, other.x, other.y) < HEAL_RADIUS) {
            other.status.healFlat(HEAL_TEAM, false); // flat +30 allies (×10 = 300)
            game.addEffect(other.x, other.y - 40 * other.scale, "getHealth");
          }
        }
      }
      break;
    }
    case "sword": {
      // A short melee arc in front of the unit; brief invuln window on the swing.
      st.invinTimer = Math.max(st.invinTimer, 5);
      const dmgMod = Number(SD.matchSettings.dmgMod) || 1;
      const reach = SWORD_RANGE;
      for (const other of game.units) {
        if (other === unit || other.status?.dead) continue;
        if (!canHarm(unit, other)) continue;
        const dx = other.x - unit.x;
        if (Math.sign(dx) !== unit.facing && Math.abs(dx) > 20) continue;
        if (UT.getDist(unit.x, unit.y - 40 * unit.scale, other.x, other.y - 40 * other.scale) < reach) {
          other.status.doDamage(SWORD_DAMAGE * dmgMod, {
            attacker: unit,
            x: unit.facing,
            y: 0,
          });
          game.addEffect(other.x, other.y - 40 * other.scale, "blood");
        }
      }
      game.addEffect(unit.x + unit.facing * 30, unit.y - 45 * unit.scale, "crit");
      // Katana swing: S_Whip — Unit.as:1271.
      Sound.playAt?.("R2_Whip", unit.x, unit.y);
      break;
    }
    case "grenade": {
      const def: WeaponDef = {
        ...WEAPONS.grenade,
        id: "grenade",
        bounce: 3,
        // Original Bullet_Proj_Bounce fuse = params[3]*30 = 60 frames = 2s
        // (Unit.as/Bullet_Proj_Bounce; the "1 second" flavor text is a SWF quirk).
        bounceLife: 60,
        // grenade.dmg=45 → ×10 = 450; splashMult 0.7 (Stats_Guns.as:679-711).
        damage: 450,
        splashMult: 0.7,
        speed: 3,
      };
      const m = unit.getMuzzle(unit.aimRotation);
      game.addFrameEffect(new Projectile(game, unit, def, m.x, m.y, unit.aimRotation));
      // Grenade throw cue: S_Whip — Unit.as:1279.
      Sound.playAt?.("R2_Whip", unit.x, unit.y);
      break;
    }
    case "mine": {
      const def: WeaponDef = {
        ...WEAPONS.grenade,
        id: "grenade",
        mine: true,
        mineLife: 900,
        // mine.dmg=55 → ×10 = 550; splashMult 0.7 (Stats_Guns.as:712-741).
        damage: 550,
        splashMult: 0.7,
        speed: 1,
        fallSpeed: 1.2,
      };
      // Tossed gently forward-and-down so it settles just in front of the unit.
      const ang = unit.facing > 0 ? 30 : 150;
      game.addFrameEffect(new Projectile(game, unit, def, unit.x, unit.y - 20 * unit.scale, ang));
      break;
    }
    case "teleport": {
      const nodes = game.arena?.spawnNodes ?? [];
      if (nodes.length) {
        const node = nodes[Math.floor(Math.random() * nodes.length)];
        game.addEffect(unit.x, unit.y - 40 * unit.scale, "spawn");
        // Teleport departure: S_Jumppad at the old position — Unit.as:1293.
        Sound.playAt?.("R2_Jumppad", unit.x, unit.y);
        unit.x = node.x + UT.rand(-5, 5);
        unit.y = node.y;
        unit.moving.vel = 0;
        if (unit.jumping) unit.jumping.vel = 0;
        game.addEffect(unit.x, unit.y, "spawn");
        // Teleport arrival: S_Powerup at the new position — Unit.as:1300.
        Sound.playAt?.("R2_Powerup", unit.x, unit.y);
      }
      break;
    }
  }
}
