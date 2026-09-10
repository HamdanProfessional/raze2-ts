/**
 * Weapon economy (hybrid buy-to-unlock model). The default arsenal is always
 * available; the rest of the Raze 2 catalog must be bought with credits before
 * it'll drop for the player as pickups. Purchases persist in SD.gunsOwned. See
 * KillBonus.ts for how credits are earned.
 */
import { SD } from "../state/SD";
import { WEAPONS, GUN_ORDER } from "./weapons";
import { RAZE2_WEAPON_BY_ID, RAZE2_SKINS } from "../assets/raze2";

const SKIN_BY_ID = Object.fromEntries(RAZE2_SKINS.map((s) => [s.id, s]));

/**
 * The default arsenal — always available, never bought. It is `GUN_ORDER`, so
 * the guns on the hotkey bar are exactly the guns the player starts owning, and
 * all seven are Raze 2's own cost-0 base gun for their slot.
 */
export const STARTER_GUNS = new Set(GUN_ORDER);

/** Whether a gun is available to the player (starter or purchased). */
export function isGunUnlocked(id: string): boolean {
  return STARTER_GUNS.has(id) || SD.gunsOwned.includes(id);
}

/** Credit cost to buy a gun; 0 for starters, Infinity for reward/unbuyable guns. */
export function gunCost(id: string): number {
  if (STARTER_GUNS.has(id)) return 0;
  const w = RAZE2_WEAPON_BY_ID[id];
  if (!w || w.cost < 0) return Infinity; // -1 = campaign/reward, not in the shop
  return w.cost;
}

/** Whether a gun can be bought right now (buyable, unowned, affordable). */
export function canBuyGun(id: string): boolean {
  if (isGunUnlocked(id)) return false;
  const c = gunCost(id);
  return isFinite(c) && SD.credits >= c;
}

/** Buy a gun. Returns true on success (credits spent, ownership recorded). */
export function buyGun(id: string): boolean {
  if (!canBuyGun(id)) return false;
  SD.addCredits(-gunCost(id)); // addCredits persists
  if (!SD.gunsOwned.includes(id)) SD.gunsOwned.push(id);
  SD.save();
  return true;
}

// --- spawn loadout ----------------------------------------------------------

/** Loadout capacity — the number row (1-7) and the HUD rack hold seven guns. */
export const LOADOUT_MAX = 7;

/** Guns the player spawns carrying (index 0 = primary, held at spawn).
 *  Filtered to only guns still owned + defined. */
export function equippedGuns(): string[] {
  return (SD.profile.prof_guns ?? []).filter((id) => isGunUnlocked(id) && WEAPONS[id]);
}

/**
 * The arsenal the player actually spawns with. An empty loadout means the
 * player has never been to the armory, so they get the default seven; otherwise
 * what they equipped is exactly what they carry.
 */
export function loadoutGuns(): string[] {
  const equipped = equippedGuns();
  // A profile saved when the rack was larger can still hold more guns than the
  // number row can address, so carry only what the player can actually select.
  return equipped.length ? equipped.slice(0, LOADOUT_MAX) : [...GUN_ORDER];
}

/** Whether a gun is in the player's spawn loadout. */
export function isGunEquipped(id: string): boolean {
  return (SD.profile.prof_guns ?? []).includes(id);
}

/** Toggle a gun in the spawn loadout (must be owned). Returns true on change. */
export function equipGun(id: string): boolean {
  if (!isGunUnlocked(id)) return false;
  const list = SD.profile.prof_guns ?? (SD.profile.prof_guns = []);
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else if (list.length >= LOADOUT_MAX) return false;
  else list.push(id);
  SD.save();
  return true;
}

/** Whether the loadout has room for another gun. */
export function loadoutFull(): boolean {
  return (SD.profile.prof_guns ?? []).length >= LOADOUT_MAX;
}

/**
 * Seed an untouched profile with the default seven. Without this the armory would
 * open showing nothing equipped while the player is in fact carrying GUN_ORDER,
 * and equipping their first purchase would silently drop the other six.
 */
export function ensureLoadout(): void {
  const list = SD.profile.prof_guns ?? (SD.profile.prof_guns = []);
  if (list.length) return;
  list.push(...GUN_ORDER);
  SD.save();
}

/** Random-drop pool for a match: the default arsenal + the player's purchases. */
export function droppableGuns(): string[] {
  const out = [...GUN_ORDER];
  for (const id of SD.gunsOwned) {
    if (WEAPONS[id] && !out.includes(id)) out.push(id);
  }
  return out;
}

// --- skins (cosmetic) -------------------------------------------------------

/** Whether a skin is available to equip (free, owned, or reward-granted). */
export function isSkinUnlocked(id: string): boolean {
  const s = SKIN_BY_ID[id];
  if (!s) return false;
  return s.cost === 0 || SD.skinsOwned.includes(id);
}

/** Credit cost to buy a skin; 0 for free skins, Infinity for reward skins. */
export function skinCost(id: string): number {
  const s = SKIN_BY_ID[id];
  if (!s) return Infinity;
  if (s.cost < 0) return Infinity; // -1 = campaign/reward (e.g. mutate)
  return s.cost;
}

export function canBuySkin(id: string): boolean {
  if (isSkinUnlocked(id)) return false;
  const c = skinCost(id);
  return isFinite(c) && SD.credits >= c;
}

/** Buy a skin. Returns true on success. */
export function buySkin(id: string): boolean {
  if (!canBuySkin(id)) return false;
  SD.addCredits(-skinCost(id));
  if (!SD.skinsOwned.includes(id)) SD.skinsOwned.push(id);
  SD.save();
  return true;
}

/** Equip an owned skin. Returns true on success. */
export function equipSkin(id: string): boolean {
  if (!isSkinUnlocked(id)) return false;
  SD.profile.prof_skin = id;
  SD.save();
  return true;
}
