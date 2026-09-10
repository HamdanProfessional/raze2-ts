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
  /** Bots to bring in at fixed world coordinates (1-based roster slot). */
  spawn?: { unit: number; x: number; y: number }[];
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
};

export function getCampaignScript(num: number): CampaignScript | null {
  return CAMPAIGN_SCRIPTS[num] ?? null;
}
