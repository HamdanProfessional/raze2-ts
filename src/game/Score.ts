import { SD } from "../state/SD";
import { Achievements } from "./Achievements";
import { GUN_ORDER } from "./weapons";

/**
 * Per-unit scoreboard record. Ported from `Score.as`.
 *
 * Two things beyond the obvious counters live here, both straight out of
 * `Score.addKill`:
 *
 *  - **Multikill.** Every kill sets `killTimer` to 3.5 s and bumps `multikill`;
 *    letting the timer run out resets it. 2-5 kills inside that window are
 *    Double/Triple/Quadra/Monster Kill, and past 5 it is "Monster Kill x N".
 *  - **Spree.** A running kill count that a death zeroes, with callouts at
 *    exactly 5/10/15/20/25 — the thresholds only fire on the nose, so a long
 *    run gives a series of escalating announcements rather than one per kill.
 *
 * The stat counters below `kills` exist because `KillPoints.addBonus`
 * increments them as each bonus is awarded (`KillPoints.as:196-260`); they are
 * what the achievement checks read.
 *
 * `value` is what Match ranks by. In deathmatch the original scores
 * `kills - suicides - betrayals`; in the elimination modes it biases by lives
 * remaining via `lifeMod`.
 */

/**
 * A callout earned by a kill. `credits` is real: `Hud.setDisplay(n, text)`
 * pays `n` (through `creditMod`) as well as shouting the line, so multikills
 * and sprees are a genuine income stream, not just flavour.
 */
export interface Callout {
  label: string;
  credits: number;
  /** Kill-feed lead-in ("on a ", "clearly a "); empty for multikills. */
  lead: string;
}

/** Frames a kill keeps the multikill window open (`Score.as`: 3.5 * 30). */
const MULTIKILL_WINDOW = Math.round(3.5 * 30);

/**
 * Spree ladder, verbatim from `Score.as:addKill`. Note there is no
 * "Dominating" tier in Raze 2 and the first rung is 5, not 3.
 */
export const SPREE_TIERS: { at: number; label: string; lead: string; credits: number }[] = [
  { at: 5, label: "Killing Spree!", lead: "on a ", credits: 6 },
  { at: 10, label: "Rampage!", lead: "on a ", credits: 8 },
  { at: 15, label: "Unstoppable!", lead: "", credits: 10 },
  { at: 20, label: "Godlike!", lead: "", credits: 12 },
  { at: 25, label: "Hacker!", lead: "clearly a ", credits: 14 },
];

/** Multikill ladder, `Score.as:addKill`. Index 0 is two kills in the window. */
const MULTI_TIERS: { label: string; credits: number }[] = [
  { label: "Double Kill!", credits: 4 },
  { label: "Triple Kill!", credits: 5 },
  { label: "Quadra Kill!", credits: 6 },
  { label: "Monster Kill!", credits: 7 },
];
/** Past the named rungs it keeps counting, at a flat 8 credits. */
const MONSTER_CREDITS = 8;

/** A kill counts as a spree-ender once the victim is at or past this rung. */
export const SPREE_ENDER_AT = SPREE_TIERS[0].at;

export class Score {
  kills = 0;
  deaths = 0;
  suicides = 0;
  /** Team kills. Deathmatch scoring subtracts these along with suicides. */
  betrayals = 0;

  // --- locational hits ---
  headshots = 0;
  crotchshots = 0;
  buttshots = 0;

  // --- who you killed (the campaign/achievement counters) ---
  killedAlien = 0;
  killedHuman = 0;
  killedRobot = 0;
  killedZombie = 0;

  // --- bonus counters, incremented by KillBonus as each award lands ---
  reflections = 0;
  flagCap = 0;
  domCap = 0;
  jugKills = 0;
  mauser = 0;
  sword = 0;
  fire = 0;
  mine = 0;
  steal = 0;
  juice = 0;
  rad = 0;
  speed = 0;
  corpsestick = 0;

  shots = 0;
  shotsHit = 0;
  killStreak = 0;
  /** Longest streak this match — killStreak itself is reset by every death. */
  bestStreak = 0;
  /** Lives already spent (elimination modes). */
  lifeMod = 0;
  /** Frames spent holding the Juggernaut crown this match. */
  jugTicks = 0;

  /** Kills inside the current multikill window (1 = just the one). */
  multikill = 0;
  /** Frames left on that window; 0 closes it. */
  killTimer = 0;

  /** Weapons used to get a kill this match (for the "Indecisive" medal). */
  private usedGuns = new Set<string>();
  private onlyPistol = true;

  constructor(public unit: any) {}

  /** Runs the multikill window down. Called once per logic tick. */
  enterFrame(): void {
    if (this.killTimer > 0) this.killTimer--;
    else this.multikill = 0;
  }

  /**
   * Record a kill. Returns the callouts this kill earned so the caller can
   * announce them — `Score.as` talks to the HUD directly, but the port keeps
   * the announcement styling in the HUD, so they come back as data.
   */
  addKill(gunId: string, headshot: boolean): { multi: Callout | null; spree: Callout | null } {
    this.kills++;
    this.killStreak++;
    this.multikill++;
    this.killTimer = MULTIKILL_WINDOW;
    if (this.killStreak > this.bestStreak) this.bestStreak = this.killStreak;
    if (headshot) this.headshots++;
    this.usedGuns.add(gunId);
    if (gunId !== "pistol") this.onlyPistol = false;
    // "Indecisive": a kill with every weapon inside a single match.
    if (this.unit?.human && this.usedGuns.size >= GUN_ORDER.length) {
      Achievements.addAch("guns");
    }

    let multi: Callout | null = null;
    if (this.multikill >= 2) {
      const named = MULTI_TIERS[this.multikill - 2];
      multi = named
        ? { label: named.label, credits: named.credits, lead: "" }
        : { label: `Monster Kill x ${this.multikill - 4}!`, credits: MONSTER_CREDITS, lead: "" };
    }
    const tier = SPREE_TIERS.find((t) => t.at === this.killStreak);
    return { multi, spree: tier ? { ...tier } : null };
  }

  addDeath(): void {
    this.deaths++;
    this.killStreak = 0;
  }

  addSuicide(): void {
    this.suicides++;
    this.killStreak = 0;
  }

  addBetrayal(): void {
    this.betrayals++;
  }

  addShot(): void {
    this.shots++;
  }
  addHit(): void {
    this.shotsHit++;
  }

  /** Tally the locational band of a killing blow (`head` is counted above). */
  addRegion(region: string | undefined): void {
    if (region === "crotch") this.crotchshots++;
    else if (region === "butt") this.buttshots++;
  }

  /**
   * Tally the victim's race. `Unit.as:317` is literally
   * `++killer.score["killed" + skin.race]`, and the skin table's four values
   * are `Human` / `Alien` / `Robot` / `Zombie`. An unskinned unit (the Raze 1
   * levels have no Raze 2 skin) counts as human, which is what the fallback
   * `raze` skin is anyway.
   */
  addKilledRace(race: string | undefined): void {
    if (race === "Alien") this.killedAlien++;
    else if (race === "Robot") this.killedRobot++;
    else if (race === "Zombie") this.killedZombie++;
    else this.killedHuman++;
  }

  /**
   * Ranking value used by Match / HUD, i.e. the original's `pscore`.
   * `Score.addKill`/`addSuicide` recompute it per mode: deathmatch subtracts
   * self-inflicted losses, Juggernaut counts raw kills. Elimination ranks by
   * lives, which `Match` derives from `deaths` instead.
   */
  get value(): number {
    if (SD.matchSettings?.type === "jug") return this.kills;
    return this.kills - this.suicides - this.betrayals;
  }

  /** Distinct weapons used for kills — 10+ triggers the "Indecisive" medal. */
  get gunKillCount(): number {
    return this.usedGuns.size;
  }

  get pistolOnly(): boolean {
    return this.onlyPistol && this.kills > 0;
  }
}
