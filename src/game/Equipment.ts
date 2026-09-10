/**
 * Equipment economy + effect resolution. Ported from Stats_Equipment.as and the
 * `unit.equips` runtime map (Unit.as:186-199).
 *
 * There are 21 equipment items across three slots (`cls` 0-2). Each carries a
 * `type` string and a `value`; the game builds a per-unit map `equips[type] =
 * value` from the three equipped items and every passive effect reads
 * `unit.equips.<type>` (see Status / Guns / KillBonus / PickupItem / Unit).
 *
 * Items are bought with credits (persisted in SD.equipsOwned) and the equipped
 * loadout — one item id per slot, or "" for none — lives in
 * SD.profile.prof_equips, mirroring the SWF SD.equips array.
 */
import { SD } from "../state/SD";
import { Achievements } from "./Achievements";
import { RAZE2_EQUIPMENT, type Raze2Equipment } from "../assets/raze2";

/** Stable id for an equipment item: "<cls>:<name>". */
export function equipId(e: Raze2Equipment): string {
  return `${e.cls}:${e.name}`;
}

/** Lookup table by id (only the named, real entries). */
const BY_ID: Record<string, Raze2Equipment> = {};
for (const e of RAZE2_EQUIPMENT) {
  if (e.name) BY_ID[equipId(e)] = e;
}

/**
 * Shop/loadout items for a slot: named, positively-priced entries only. The
 * "Nothing" placeholders and the hidden 0-cost variants (blank name / numeric
 * descriptions) are excluded — "none" is represented by an empty slot id.
 */
export function equipsForSlot(cls: number): Raze2Equipment[] {
  return RAZE2_EQUIPMENT.filter(
    (e) => e.cls === cls && e.name && e.name !== "Nothing" && e.cost > 0,
  );
}

export function equipById(id: string): Raze2Equipment | undefined {
  return BY_ID[id];
}

// --- ownership / economy ----------------------------------------------------

export function isEquipOwned(id: string): boolean {
  return SD.equipsOwned.includes(id);
}

export function equipCost(id: string): number {
  const e = BY_ID[id];
  return e ? e.cost : Infinity;
}

export function canBuyEquip(id: string): boolean {
  if (isEquipOwned(id)) return false;
  const c = equipCost(id);
  return isFinite(c) && SD.credits >= c;
}

/** Buy an equipment item. Returns true on success (credits spent, recorded). */
export function buyEquip(id: string): boolean {
  if (!canBuyEquip(id)) return false;
  SD.addCredits(-equipCost(id)); // addCredits persists
  if (!SD.equipsOwned.includes(id)) SD.equipsOwned.push(id);
  SD.save();
  // "Toolkit": own at least 3 purchasable items in each of the 3 slots.
  const owned = new Set(SD.equipsOwned);
  const enough = [0, 1, 2].every(
    (cls) => equipsForSlot(cls).filter((e) => owned.has(equipId(e))).length >= 3,
  );
  if (enough) Achievements.addAch("equipment");
  return true;
}

// --- equipped loadout -------------------------------------------------------

/** The equipped item id in a slot (0-2), or "" for none. */
export function equippedInSlot(cls: number): string {
  return SD.profile.prof_equips?.[cls] ?? "";
}

/**
 * Equip (or, when passed the already-equipped id, clear) an owned item into its
 * slot. The slot is derived from the item's `cls`. Returns true on change.
 */
export function equipItem(id: string): boolean {
  const e = BY_ID[id];
  if (!e || !isEquipOwned(id)) return false;
  if (!SD.profile.prof_equips) SD.profile.prof_equips = ["", "", ""];
  const slot = e.cls;
  SD.profile.prof_equips[slot] = SD.profile.prof_equips[slot] === id ? "" : id;
  SD.save();
  return true;
}

// --- runtime effect map -----------------------------------------------------

/**
 * Build the `equips[type] = value` map the live unit reads, from a set of
 * equipped item ids. Empty / unknown ids contribute nothing (matches the SWF,
 * where "Nothing" items write a `type:""` key no code consumes).
 */
export function resolveEquips(equipIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of equipIds) {
    const e = BY_ID[id];
    if (e && e.type) out[e.type] = e.value;
  }
  return out;
}

/**
 * Match-level equipment gate. Mirrors the SWF `Unit.as:187` condition
 * `if(MatchSettings.isCampaign || MatchSettings.equipsOn)` that decides whether
 * a unit loads its 3 equipment slots at all. In campaign the loadout always
 * resolves; in quick match it honours the Equipment On/Off toggle
 * (`SD.matchSettings.equipment`). When disabled, no equipment effect applies —
 * `playerEquips()` returns an empty map so every `unit.equips.<type>` read is a
 * no-op, without any consumer or Unit.ts needing to know about the toggle.
 */
export function equipmentEnabled(): boolean {
  const ms: any = SD.matchSettings;
  if (ms.campaign) return true;
  const eq = ms.equipment;
  // Undefined defaults to "on" to match the SWF `equipsOn` default of true.
  return !(eq === false || eq === 0 || eq === "Off" || eq === "off");
}

/** The human player's equipped loadout, resolved to its effect map. Returns an
 *  empty map when equipment is disabled for the current match (see gate). */
export function playerEquips(): Record<string, number> {
  if (!equipmentEnabled()) return {};
  return resolveEquips(SD.profile.prof_equips ?? []);
}
