import { SD } from "../state/SD";

/**
 * Match rules / win-condition checker. Ported from Match.as.
 *
 * Runs once per frame while a game is active. It maintains the score-ordered
 * ranking used by the HUD/scoreboard and, for the elimination modes, decides
 * when the game ends and who is still allowed back into the arena.
 *
 * Modes:
 *   dm    — free-for-all deathmatch; ranking only, score cap handled in Game.
 *   tdm   — team deathmatch; ranking only, team score cap handled in Game.
 *   elim  — free-for-all elimination; every unit gets `lives` respawns of its
 *           own. Run out and you stay down. Last side standing wins.
 *   telim — team elimination; each team shares one pool of `lives`. A team is
 *           wiped when its pool is empty and its last member falls.
 */

/**
 * Whether `attacker` may damage `target` under the current match rules.
 *
 * Teammates are immune to each other unless the Friendly Fire toggle
 * (SD.matchSettings.ff, set on the play screen) is on. Self-damage — rocket
 * jumping, standing in your own splash — always lands.
 */
export function canHarm(attacker: { team: number }, target: { team: number }): boolean {
  if (attacker === target) return true;
  if (!attacker.team || attacker.team !== target.team) return true;
  return !!SD.matchSettings.ff;
}

interface UnitLike {
  getScore: number;
  spawnOrder: number;
  team: number;
  ai: boolean;
  score: { deaths: number };
  status: { dead: boolean };
}

interface GameLike {
  units: UnitLike[];
  player: { team: number };
  endGame(playerWon: boolean): void;
}

/** Respawns each combatant gets in the elimination modes. Everyone — player,
 *  allies and enemies — draws from the same number, so a mission's length is
 *  set by how many enemies it fields rather than by a per-bot allowance. */
export const DEFAULT_LIVES = 5;

/** Whether `a` and `b` are on opposing sides. Team 0 is free-for-all, where
 *  everyone is hostile to everyone. */
function hostile(a: { team: number }, b: { team: number }): boolean {
  return !a.team || !b.team || a.team !== b.team;
}

export class Match {
  scoreOrder: UnitLike[] = [];
  maxScore: number;
  /** Respawns allowed per unit (elim) or per team (telim). 0 = unlimited. */
  readonly lives: number;
  private game: GameLike;

  constructor(game: GameLike) {
    this.game = game;
    this.maxScore = SD.matchSettings.score;
    this.lives = Number(SD.matchSettings.lives) || 0;
  }

  /** Snapshot the unit list into the rankable score order array. */
  setPlayers(): void {
    this.scoreOrder = this.game.units.slice();
  }

  get type(): string {
    return String(SD.matchSettings.type ?? "dm");
  }
  get isElim(): boolean {
    const t = this.type;
    return t === "elim" || t === "telim";
  }
  get isTeamMode(): boolean {
    const t = this.type;
    return t === "tdm" || t === "telim";
  }

  /**
   * Respawns still banked for `u` — its own in `elim`, its team's shared pool in
   * `telim`. Infinity outside the elimination modes.
   */
  livesLeft(u: UnitLike): number {
    if (!this.lives || !this.isElim) return Infinity;
    if (this.type === "telim") {
      let spent = 0;
      for (const o of this.scoreOrder) if (o.team === u.team) spent += o.score.deaths;
      return Math.max(0, this.lives - spent);
    }
    return Math.max(0, this.lives - u.score.deaths);
  }

  /**
   * Kills still standing between `me` and an elimination win — every respawn
   * banked by every hostile side, summed. Since each life is exactly one kill,
   * this is a straight countdown to victory and is what the HUD shows in place
   * of a score cap. Infinity when the mode has no elimination rules.
   */
  killsToClear(me: UnitLike): number {
    if (!this.isElim || !this.lives) return Infinity;
    // `telim` pools lives per team, so a team is counted once, not per member.
    const counted = new Set<number>();
    let total = 0;
    for (const u of this.scoreOrder) {
      if (!u.ai || !hostile(u, me)) continue;
      if (this.type === "telim") {
        if (counted.has(u.team)) continue;
        counted.add(u.team);
      }
      total += this.livesLeft(u);
    }
    return total;
  }

  /** Whether a downed unit is allowed back into the arena. */
  canRespawn(u: UnitLike): boolean {
    if (!this.isElim) return true;
    return this.livesLeft(u) > 0;
  }

  /** Still in the fight: on the field, or down but with a respawn banked. */
  private stillIn(u: UnitLike): boolean {
    return !u.status.dead || this.livesLeft(u) > 0;
  }

  /** How many members of `team` are still in the fight. */
  private teamStanding(team: number): number {
    let n = 0;
    for (const u of this.scoreOrder) if (u.team === team && this.stillIn(u)) n++;
    return n;
  }

  enterFrame(): void {
    // Rank by score desc, then by spawn order as a stable tiebreaker.
    this.scoreOrder.sort(
      (a, b) => b.getScore - a.getScore || b.spawnOrder - a.spawnOrder,
    );

    switch (this.type) {
      case "tdm":
      case "dm":
      default:
        // Deathmatch / team deathmatch: ranking only; the score-cap victory is
        // handled where scores are incremented.
        return;

      case "elim": {
        // Elimination: the player loses the moment their own lives run out, and
        // wins once every *hostile* AI has been counted out. Campaign missions
        // field scripted allies who can't be shot, so counting them here would
        // make the mission unwinnable.
        const me = this.game.player as unknown as UnitLike;
        if (!this.stillIn(me)) {
          this.game.endGame(false);
          return;
        }
        let remaining = 0;
        for (const u of this.scoreOrder) {
          if (u.ai && hostile(u, me) && this.stillIn(u)) remaining++;
        }
        if (remaining === 0) this.game.endGame(true);
        return;
      }

      case "telim": {
        // Team elimination: the player's team losing all its members loses the
        // match; if every other active team is wiped, the player wins. Supports
        // 2-4 teams (doc 11 §3).
        const teams = Math.max(2, Number(SD.matchSettings.teams) || 2);
        const myTeam = this.game.player.team;
        if (this.teamStanding(myTeam) === 0) {
          this.game.endGame(false);
          return;
        }
        let othersLeft = 0;
        for (let t = 1; t <= teams; t++) {
          if (t !== myTeam && this.teamStanding(t) > 0) othersLeft++;
        }
        if (othersLeft === 0) this.game.endGame(true);
        return;
      }
    }
  }
}
