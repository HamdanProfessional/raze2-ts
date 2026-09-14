/**
 * Raze 2 kill-bonus scoring — `KillPoints.as`, which is both the credit formula
 * and the floating "+N / Headshot!" popup. The popup lives in the HUD here; this
 * module is the dispatch and the arithmetic.
 *
 * Two details of the original are easy to miss and both are reproduced:
 *
 *  - **Only the first three bonuses pay.** `addBonus` bumps the killer's stat
 *    counter for every award, then returns early once `remaining` hits zero —
 *    so a four-bonus kill still tallies all four toward achievements but is
 *    paid, and shown, for three.
 *  - **The base is the VICTIM's difficulty**, not the killer's: `points = 4 +
 *    victim.diff * 0.8`. Killing a hard bot is worth more than killing an easy
 *    one, whoever you are.
 */
import { SD } from "../state/SD";
import { RAZE2_KILL_BONUS_BY_ID } from "../assets/raze2";

/**
 * What landed the blow. The weapon fills the first group in as it resolves the
 * hit (`Bullet.as`'s `extra`); the kill site fills the second from match state.
 */
export interface KillCause {
  /** `Stats_Guns.id` of the killing weapon — including the type-7 pseudo-guns
   *  `fire`, `sword`, `mine`, which are what several bonuses key on. */
  gun?: string;
  /** Hit the head. */
  headMult?: boolean;
  /** Hit the head *from behind* — supersedes `headMult` (`Bullet.as:554`). */
  assassin?: boolean;
  crotchMult?: boolean;
  buttMult?: boolean;
  /** The saw blade had burrowed through terrain to reach them. */
  burrowMult?: boolean;
  /** Direct impact from a weapon whose `splash >= 80` — "Direct Hit!". */
  splashDirect?: boolean;
  /** Splash from a weapon whose `splash` is set but under 80 — "Splish Splash!". */
  splashIndirect?: boolean;
  /** A grenade stuck to a corpse when it detonated. */
  corpseStick?: boolean;
  /** The victim still had 20%+ of their shield up and this one blow killed them
   *  anyway — "What Shield?". Set inside `Status.doDamage`, which is the only
   *  place that can see the shield pool before it is spent. */
  noShield?: boolean;
  /** Wall bounces the shot had made. The Hail Storm needs 2 for "Chill Pill!". */
  bounce?: number;
  /** Whose shot this originally was, if somebody reflected it back. */
  reflect?: any;
  /** Seconds of burn this weapon inflicts (`Stats_Guns` `extra.setFire`). */
  setFire?: number;
  /** This was a team kill: no kill credit, no points, just "Betrayal!". */
  teamkill?: boolean;

  // --- filled in at the kill site ---
  /** The victim's spree when they died, if they were on one (>= 5). */
  spreeEnd?: number;
  /** The victim wore the Juggernaut crown. */
  jugKill?: boolean;
  /** The victim was carrying a flag. */
  hasFlag?: boolean;
}

export interface AwardedBonus {
  id: string;
  name: string;
  worth: number;
}

/** Bonuses paid and shown per kill (`KillPoints.as`: `remaining = 3`). */
const MAX_PAID = 3;
/** `points = 4 + victim.diff * 0.8`. */
const BASE_POINTS = 4;
/** "Kill Steal!": the victim was fighting someone else and nearly dead. */
const STEAL_HP = 20 * 10; // Raze 2 HP is ×10 in the port

/** Community cameos the original hard-codes by name. */
const JUICE_NAME = "Juice-Tin";
const RAD_NAME = "AddisonR";

export interface KillAward {
  /** Every bonus that qualified, in dispatch order. Counters use all of these. */
  all: AwardedBonus[];
  /** The first three — the ones that actually pay and get shown. */
  paid: AwardedBonus[];
  /** Total credits for the kill, after the mode and settings modifiers. */
  points: number;
}

function make(id: string): AwardedBonus | null {
  const b = RAZE2_KILL_BONUS_BY_ID[id];
  return b ? { id, name: b.name, worth: b.worth } : null;
}

/**
 * Credit multiplier from the match settings (`Menu.as:1998-2068`). Every
 * restriction that makes the match easier docks your earnings, and the warning
 * on the play screen quotes exactly this number.
 */
export function creditMod(settings?: unknown): number {
  // `settings` lets the play screen quote the number for a match that has not
  // started yet — `SD.matchSettings` is not written until Start Game.
  const m: any = settings ?? SD.matchSettings ?? {};
  let mod = 1;
  const WEAPON_PENALTY: Record<string, number> = {
    Starters: 0.1, Sidearms: 0.1, "Close Range": 0.2, Automatics: 0.2,
    "Long Range": 0.35, Heavies: 0.3, Explosives: 0.35,
  };
  mod -= WEAPON_PENALTY[m.weaponsUsed] ?? 0;
  if (m.specialMode === "Infinite Clips") mod -= 0.6;
  if (m.specialMode === "Infinite Ammo") mod -= 0.9;
  if (m.specialMode === "4x Health") mod -= 0.5;
  // The quarantine tutorial maps pay nothing — they are a walkthrough.
  const map = String(m.level ?? "").replace(/^r2_/, "");
  if (map === "tutq" || map === "tutq2") mod -= 1;
  return Math.max(0, mod);
}

/**
 * Resolve a kill into its bonuses and its credit value. Argument order follows
 * `new KillPoints(victim, killer, gun, extra)`.
 */
export function computeKillBonuses(killer: any, victim: any, cause: KillCause = {}): KillAward {
  const all: AwardedBonus[] = [];
  const add = (id: string) => {
    const b = make(id);
    if (b) all.push(b);
  };

  // A team kill scores nothing at all — the original returns before any of the
  // bonus dispatch and just prints "Betrayal!".
  if (cause.teamkill) return { all: [], paid: [], points: 0 };

  const gun = cause.gun ?? killer?.gun?.curGun?.id;
  const kStatus = killer?.status;
  const vStatus = victim?.status;

  if (cause.spreeEnd) add("spreeEnd");
  // `cause.reflect` is whose shot it originally was. Sending it back into that
  // person is "Reflection!"; bouncing it into a third party is "Thanks!".
  if (cause.reflect && cause.reflect !== victim) add("refBounce");
  else if (cause.reflect) add("reflect");

  if (cause.assassin) add("assassin");
  else if (cause.headMult) add("headMult");
  if (cause.buttMult) add("buttMult");
  if (cause.crotchMult) add("crotchMult");
  if (cause.burrowMult) add("burrowMult");
  if (cause.splashDirect) add("splashDirect");
  if (cause.splashIndirect) add("splashIndirect");
  if (cause.jugKill) add("jugKill");
  if (cause.hasFlag) add("hasFlag");
  if (gun === "mauser") add("mauser");
  if (cause.noShield) add("noShield");
  if (cause.corpseStick) add("corpsestick");

  if (gun === "sword") add("sword");
  if (gun === "fire") add("fire");
  if (gun === "mine") add("mine");
  if (gun === "icegun" && (cause.bounce ?? 0) >= 2) add("chill");

  // "Haunted!": the killer was already down when the shot landed. `dead.fc` is
  // the frames-since-death counter, which the port keeps as `respawnCount`.
  if (kStatus?.dead && (killer?.respawnCount ?? 0) >= 2) add("dead");
  // "Survivor!": Adrenaline Boost had just left the killer on its 1% floor.
  if (kStatus && kStatus.hpCur > 0 && kStatus.hpCur <= kStatus.hpMax * 0.01) add("survive");
  if (kStatus?.fireTimer > 0) add("onfire");
  // "Speed Shot!": moving faster than your own top speed, i.e. carried by a
  // jump pad, a conveyor or an explosion rather than by running.
  const mov = killer?.moving;
  if (mov && Math.abs(mov.vel) > mov.max) add("speed");
  if (killer?.hasFlag) add("hasFlag2");
  if (vStatus?.fadeTimer > 0) add("invis");
  // "Kill Steal!": they were busy with someone else and nearly finished.
  if (victim?.target && victim.target !== killer && vStatus?.hpCur <= STEAL_HP) add("steal");
  if (victim?._name === JUICE_NAME || victim?.name === JUICE_NAME) add("juice");
  if (victim?._name === RAD_NAME || victim?.name === RAD_NAME) add("rad");

  if (SD.matchSettings?.type === "dom") {
    if (victim?.capturing) add("domKill");
    if (killer?.capturing) add("domKill2");
  }

  const paid = all.slice(0, MAX_PAID);

  // Base is the victim's difficulty, plus the Point Allocator's flat per-kill
  // bonus, plus the paid bonuses' worth.
  const diff = Number(victim?.diff ?? SD.matchSettings?.diff ?? 1);
  let points = BASE_POINTS + diff * 0.8 + (killer?.equips?.credits ?? 0);
  for (const b of paid) points += b.worth;
  // Objective modes pay half per kill — the points are meant to come from the
  // objective, not the fragging.
  const type = SD.matchSettings?.type;
  if (type === "ctf" || type === "dom") points = Math.ceil(points * 0.5);
  points = Math.ceil(points * creditMod());

  return { all, paid, points: Math.max(0, points) };
}

/**
 * Tally a kill's bonuses onto the killer's stat counters
 * (`KillPoints.addBonus`, which does this for every award, paid or not).
 */
export function tallyBonuses(killer: any, all: AwardedBonus[]): void {
  const s = killer?.score;
  if (!s) return;
  for (const b of all) {
    switch (b.id) {
      case "reflect": case "refBounce": s.reflections++; break;
      case "jugKill": s.jugKills++; break;
      case "sword": s.sword++; break;
      case "fire": case "onfire": s.fire++; break;
      case "mauser": s.mauser++; break;
      case "steal": s.steal++; break;
      case "mine": s.mine++; break;
      case "juice": s.juice++; break;
      case "rad": s.rad++; break;
      case "speed": s.speed++; break;
      case "corpsestick": s.corpsestick++; break;
      case "domKill": case "domKill2": s.domCap++; break;
      default: break;
    }
  }
}
