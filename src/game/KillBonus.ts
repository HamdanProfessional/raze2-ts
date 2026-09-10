/**
 * Raze 2 kill-bonus scoring. On a kill we inspect the killer, victim and the
 * shot info and award the qualifying bonuses (Headshot!/Crotch Shot!/Butt
 * Shot!/Juggerkill!/…), each worth the credits from the Stats_KillBonuses table
 * (src/assets/raze2). Points are shown as a floating popup and paid into
 * SD.credits.
 *
 * Only the bonuses detectable from the port's current mechanics are wired up;
 * the rest (fire/mine/sticky/reflect/flag/domination) light up automatically as
 * those systems are ported — just add a detector below keyed to the same id.
 */
import { RAZE2_KILL_BONUS_BY_ID } from "../assets/raze2";

export interface AwardedBonus {
  id: string;
  name: string;
  worth: number;
}

/** Max bonuses counted toward a single kill's payout (matches Raze 2). */
const MAX_BONUSES = 3;
/** Base credits for any enemy kill (Raze 2: 4 + diff*0.8). */
const BASE_POINTS = 4;

/** Velocity (px/tick) above which a kill counts as a "Speed Shot!". */
const SPEED_THRESHOLD = 8;

function make(id: string): AwardedBonus | null {
  const b = RAZE2_KILL_BONUS_BY_ID[id];
  return b ? { id, name: b.name, worth: b.worth } : null;
}

/**
 * Compute the bonuses earned for a kill. `info.region` is the locational hit
 * band ("head"/"crotch"/"butt"/"body") set by Guns.doHitUnit.
 */
export function computeKillBonuses(
  killer: any,
  victim: any,
  info: { region?: string; headShot?: boolean },
): AwardedBonus[] {
  const out: AwardedBonus[] = [];
  const add = (id: string) => {
    const b = make(id);
    if (b) out.push(b);
  };

  const region = info.region ?? (info.headShot ? "head" : "body");
  if (region === "head") add("headMult");
  else if (region === "crotch") add("crotchMult");
  else if (region === "butt") add("buttMult");

  if (victim?.isJug) add("jugKill");
  // Haunted!: the killer was already dead (ragdoll/last-shot kill).
  if (killer?.status?.dead) add("dead");
  // Survivor!: killer scored the kill at a sliver of health.
  const hp = killer?.status?.getHpPer?.() ?? 1;
  if (hp > 0 && hp <= 0.05) add("survive");
  // Speed Shot!: killer was moving fast when they fired.
  if (Math.abs(killer?.moving?.vel ?? 0) >= SPEED_THRESHOLD) add("speed");
  // Embarrassing!: killed with the Golden Mauser.
  if (killer?.gun?.curGun?.id === "mauser") add("mauser");

  return out.slice(0, MAX_BONUSES);
}

/** Total credits for a kill = base (scaled by killer difficulty) + bonuses.
 *  Point Allocator (killer.equips.credits) adds a flat per-kill bonus. */
export function killPoints(killer: any, bonuses: AwardedBonus[]): number {
  const base = BASE_POINTS + (killer?.diffMod ?? 1) * 0.8;
  const bonus = bonuses.reduce((s, b) => s + b.worth, 0);
  const equipCredits = killer?.equips?.credits ?? 0;
  return Math.round(base + bonus + equipCredits);
}
