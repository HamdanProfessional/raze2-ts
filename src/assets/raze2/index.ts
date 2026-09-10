/**
 * Raze 2 catalog data, extracted verbatim from the decompiled AS3 `Stats_*`
 * tables (see scratchpad/raze2_extract.js). These are reference tables for the
 * Tier-1 port work (weapon roster, kill-bonus economy, skins, equipment); they
 * are the game's authored balance values, not yet wired into gameplay.
 *
 * Field names mirror the AS3 `addGun/addSkin/addBonus/addEquipment` signatures.
 * `cls` / `shotSound` / `hitSound` are identifier names (e.g. "Bullet_Line_Basic",
 * "S_pistolFire"), to be mapped to port implementations as each is ported.
 */
import weaponsJson from "./weapons.json";
import killBonusesJson from "./killBonuses.json";
import skinsJson from "./skins.json";
import equipmentJson from "./equipment.json";

/** One weapon from `Stats_Guns.addGun`. `type` is the loadout slot (0-6 = the
 *  armory categories; 7 = ability/environment-spawned). */
export interface Raze2Weapon {
  type: number;
  id: string;
  sprite: string;
  name: string;
  race: string;
  cost: number; // -1 = unlock/reward, not shop-buyable
  dmg: number;
  mults: [number, number, number]; // [head, crotch, butt] crit multipliers
  force: number;
  splash: number;
  splashMult: number;
  clipSize: number;
  clipMax: number; // spare clips
  range: number;
  recoil: number;
  autoFire: boolean;
  shootDelay: number;
  xOff: number;
  yOff: number;
  effShoot: string;
  effHit: string;
  effShell: string;
  frameIdle: string;
  frameFire: string;
  frameReload: string;
  shotSound: string | null;
  hitSound: string | null;
  cls: string; // Bullet subclass name
  params: unknown[] | null; // bullet-class params (see Bullet_* survey)
  extra: Record<string, unknown>; // extraShots / setFire / pierce / arc / ...
  special: string;
  desc: string;
}

/** One kill bonus from `Stats_KillBonuses.addBonus`. `worth` = credits added. */
export interface Raze2KillBonus {
  id: string;
  worth: number;
  name: string;
  desc: string;
}

/** One skin from `Stats_Skins.addSkin`. `frame` = frame in the character clip. */
export interface Raze2Skin {
  frame: number;
  id: string;
  cost: number; // -1 = campaign-granted (e.g. mutate)
  blood: string; // bloodHuman / bloodAlien / bloodRobot / bloodZombie
  race: string; // Human / Alien / Robot / Zombie
  name: string;
}

/** One equipment option from `Stats_Equipment.addEquipment`. `cls` = slot (0-2).
 *  `type` is the flag gameplay reads as `unit.equips.<type>`. */
export interface Raze2Equipment {
  cls: number;
  name: string;
  type: string;
  value: number;
  cost: number;
  desc: string;
}

export const RAZE2_WEAPONS = weaponsJson as Raze2Weapon[];
export const RAZE2_KILL_BONUSES = killBonusesJson as Raze2KillBonus[];
export const RAZE2_SKINS = skinsJson as Raze2Skin[];
export const RAZE2_EQUIPMENT = equipmentJson as Raze2Equipment[];

/** Weapons buyable in the armory (cost >= 0), excluding ability/env weapons. */
export const RAZE2_SHOP_WEAPONS = RAZE2_WEAPONS.filter((w) => w.type <= 6 && w.cost >= 0);

/** Lookup by id. */
export const RAZE2_WEAPON_BY_ID: Record<string, Raze2Weapon> = Object.fromEntries(
  RAZE2_WEAPONS.map((w) => [w.id, w]),
);
export const RAZE2_KILL_BONUS_BY_ID: Record<string, Raze2KillBonus> = Object.fromEntries(
  RAZE2_KILL_BONUSES.map((b) => [b.id, b]),
);
