import { Achievements } from "./Achievements";
import { GUN_ORDER } from "./weapons";

/**
 * Per-unit scoreboard record. Distilled from Score.as.
 *
 * `getScore` is the value Match ranks by. In deathmatch it is kills; in the
 * elimination modes the game biases it by lives remaining via `lifeMod`.
 */
export class Score {
  kills = 0;
  deaths = 0;
  suicides = 0;
  headshots = 0;
  shots = 0;
  shotsHit = 0;
  killStreak = 0;
  /** Longest streak this match — killStreak itself is reset by every death. */
  bestStreak = 0;
  /** Lives already spent (elimination modes). */
  lifeMod = 0;
  /** Frames spent holding the Juggernaut crown this match. */
  jugTicks = 0;
  /** Kills taken off whoever was holding the crown. */
  jugKills = 0;
  /** Weapons used to get a kill this match (for the "Indecisive" medal). */
  private usedGuns = new Set<string>();
  private onlyPistol = true;

  constructor(public unit: any) {}

  addKill(gunId: string, headshot: boolean): void {
    this.kills++;
    this.killStreak++;
    if (this.killStreak > this.bestStreak) this.bestStreak = this.killStreak;
    if (headshot) this.headshots++;
    this.usedGuns.add(gunId);
    if (gunId !== "pistol") this.onlyPistol = false;
    // "Indecisive": a kill with every weapon inside a single match.
    if (this.unit?.human && this.usedGuns.size >= GUN_ORDER.length) {
      Achievements.addAch("guns");
    }
  }

  addDeath(): void {
    this.deaths++;
    this.killStreak = 0;
  }

  addSuicide(): void {
    this.suicides++;
    this.killStreak = 0;
  }

  addShot(): void {
    this.shots++;
  }
  addHit(): void {
    this.shotsHit++;
  }

  /** Ranking value used by Match / HUD. */
  get value(): number {
    return this.kills;
  }

  /** Distinct weapons used for kills — 10+ triggers the "Indecisive" medal. */
  get gunKillCount(): number {
    return this.usedGuns.size;
  }

  get pistolOnly(): boolean {
    return this.onlyPistol && this.kills > 0;
  }
}
