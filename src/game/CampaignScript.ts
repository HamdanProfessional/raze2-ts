/**
 * The half of the campaign scripts that `campaign.json` does not carry.
 *
 * The extraction walked `Stats_Campaign.as` for each mission's roster, briefing
 * and dialogue *text*, but the `runScripts` blocks those lines live in were not
 * transcribed — so the trigger conditions (`fc == 30*N`, a team-score
 * threshold), the scripted mid-match spawns and the human's own overrides were
 * all lost, and the port fell back to playing the lines back-to-back.
 *
 * This module supplies those conditions for the missions that have been read
 * back out of the decompile. A mission with no entry here keeps the old
 * duration-chained pacing.
 */

/** One `runScripts` branch: a condition plus whatever that branch does. */
export interface CampaignCue {
  /** Frames on the script clock (`fc`) at which the cue fires. */
  fc?: number;
  /** Player-team score at which the cue fires. Checked once, in order. */
  score?: number;
  /** Index into the mission's `messages` to speak. */
  msg?: number;
  /** Bots to bring in (1-based roster slot). `x`/`y` place the unit at fixed
   *  world coordinates, as `units[n].spawn(x, y, dir)` does; omitting them is
   *  the bare `units[n].spawn()`, which drops the bot at a normal spawn node. */
  spawn?: { unit: number; x?: number; y?: number }[];
  /** Bots to release from their scripted aim-the-player / hold-station lock. */
  release?: number[];
}

export interface CampaignScript {
  /** Overrides Raze 2 applies to the human in `setMatch` (`player.extra`). */
  player?: {
    gun?: string;
    ability?: string;
    /** Start with empty magazines and no reserve. */
    noAmmo?: boolean;
    spawn?: { x: number; y: number };
  };
  cues: CampaignCue[];
}

export const CAMPAIGN_SCRIPTS: Record<number, CampaignScript> = {
  // "Breaking In" — Stats_Campaign.as:61-118 (setMatch) and :1179-1241
  // (runScripts case 0). The frame gates are counted from the script clock,
  // which the tutorial walkthrough zeroes when it hands over (`game.fc = 0`).
  1: {
    player: { gun: "shotgun", ability: "none", noAmmo: true, spawn: { x: 138, y: 513 } },
    cues: [
      { fc: 30 * 2, msg: 0 },
      { fc: 30 * 6, msg: 1 },
      { fc: 30 * 10, msg: 2 },
      {
        fc: 30 * 15,
        spawn: [
          { unit: 2, x: 1420, y: 1090 },
          { unit: 3, x: 2475, y: 1090 },
        ],
        release: [1],
      },
      { score: 5, msg: 3 },
      { score: 8, msg: 4 },
      { score: 12, msg: 5 },
    ],
  },

  // "Outbreak" — runScripts case 1. A timed zombie wave: the whole roster bar
  // Rockit is `noSpawn`, called in one at a time on the script clock. Without
  // these the mission fielded exactly one enemy.
  2: {
    cues: [
      { fc: 30 * 5, msg: 0 },
      { fc: 30 * 10, msg: 1 },
      { fc: 30 * 20, msg: 2, spawn: [{ unit: 2 }] },
      { fc: 30 * 30, spawn: [{ unit: 3 }] },
      { fc: 30 * 38, spawn: [{ unit: 4 }] },
      { fc: 30 * 46, msg: 3, spawn: [{ unit: 5 }] },
      { fc: 30 * 54, spawn: [{ unit: 6 }] },
      { fc: 30 * 64, spawn: [{ unit: 7 }] },
      { fc: 30 * 76, msg: 4, spawn: [{ unit: 8 }] },
      { fc: 30 * 86, spawn: [{ unit: 9 }] },
      { fc: 30 * 98, spawn: [{ unit: 10 }] },
      { fc: 30 * 110, msg: 5, spawn: [{ unit: 11 }] },
      { fc: 30 * 120, msg: 6 },
      { fc: 30 * 126, msg: 7 },
      { fc: 30 * 135, msg: 8 },
    ],
  },

  // "Search and Rescue" — runScripts case 2. Cpt. Biggs is the survivor you
  // find: he is held back until the zombie count is cleared, then joins you.
  //
  // The SWF gate is `matchSettings.team2score == 15`, and `team1score` is the
  // player's side (`MatchSettings.as:544`) with the campaign human on team 1 —
  // so read literally that is the *zombies'* score, i.e. the survivor only turns
  // up once you are losing badly. That contradicts the beat around it ("lets
  // clear out these zombies", "keep your eyes peeled for any survivors"), so
  // this gates on the player's own score instead. Revisit if the original turns
  // out to mean it.
  3: {
    cues: [
      { fc: 30 * 3, msg: 0 },
      { fc: 30 * 7, msg: 1 },
      { score: 15, spawn: [{ unit: 2 }], msg: 2 },
      { fc: 30 * 8, msg: 3 },
      { fc: 30 * 14, msg: 4 },
      { fc: 30 * 20, msg: 5 },
    ],
  },

  // "Evacuation" — runScripts case 3. Three boarding aliens drop in together on
  // the ship deck at fixed points.
  4: {
    cues: [
      { fc: 30 * 3, msg: 0 },
      { fc: 30 * 7, msg: 1 },
      { fc: 30 * 15, msg: 2 },
      { fc: 30 * 18, msg: 3 },
      {
        fc: 30 * 21,
        spawn: [
          { unit: 4, x: 800, y: 700 },
          { unit: 5, x: 1300, y: 700 },
          { unit: 6, x: 2000, y: 700 },
        ],
      },
      { fc: 30 * 22, msg: 4 },
    ],
  },

  // "Ambush" — runScripts case 8. Four cloaked aliens spring at once.
  9: {
    cues: [
      { fc: 30 * 15, msg: 0 },
      {
        fc: 30 * 20,
        msg: 1,
        spawn: [{ unit: 4 }, { unit: 5 }, { unit: 6 }, { unit: 7 }],
      },
      { fc: 30 * 30, msg: 2 },
    ],
  },

  // "Reinforcements" — runScripts case 10. Your own squad arrives late as the
  // relief wave, so these three are allies rather than a threat.
  11: {
    cues: [
      { fc: 30 * 50, msg: 0 },
      { fc: 30 * 60, msg: 1, spawn: [{ unit: 1 }, { unit: 2 }, { unit: 3 }] },
      { fc: 30 * 65, msg: 2 },
    ],
  },
};

export function getCampaignScript(num: number): CampaignScript | null {
  return CAMPAIGN_SCRIPTS[num] ?? null;
}
