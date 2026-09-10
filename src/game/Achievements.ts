import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import R2_ACHIEVEMENTS from "../assets/raze2/achievements.json";

/**
 * Achievement / medal system. Ported from Achievements.as.
 *
 * The original class was both the data table AND a MovieClip that animated the
 * "medal earned" popup. Here the data + award logic live in this module; the
 * animated popup is a display concern handled by the Pixi overlay, which
 * registers itself via `Achievements.popup`. Sound (S_Medal) is triggered
 * through the same hook once the audio system is wired up.
 */

export interface Medal {
  name: string;
  desc: string;
  /** 1-based icon frame index in the original medal spritesheet. */
  icon: number;
  /**
   * Raze 2 achievement reward, if any. `["credits", n]` grants credits;
   * `["mode", label]` unlocks a special-mode modifier (recorded in
   * SD.modesUnlocked). Raze 1 medals carry no reward.
   */
  rew?: [string, string | number];
}

/** Popup renderer, injected by the UI layer (task 7). */
export interface MedalPopup {
  show(medal: Medal): void;
}

// key -> medal data. Ported verbatim from getAch()'s switch table.
const MEDALS: Record<string, Medal> = {
  rank: {
    name: "Like a Boss",
    desc: "Get the top score in a deathmatch on the hardest difficulty.",
    icon: 1,
  },
  nodie: {
    name: "Untouchable",
    desc: "Complete a quick match on medium or harder with twice as many kills as deaths.",
    icon: 2,
  },
  human: { name: "Hero of War", desc: "Complete the human campaign", icon: 3 },
  alien: {
    name: "Conqueror of Races",
    desc: "Complete the alien campaign.",
    icon: 4,
  },
  headshot: { name: "Boom, Headshot!", desc: "Get 50 headshot kills.", icon: 5 },
  addicted: { name: "Addicted", desc: "Play a total of 50 matches.", icon: 6 },
  pistol: {
    name: "Mmmm, Pistol Whip",
    desc: "Complete a match using only the pistol.",
    icon: 7,
  },
  gravekill: {
    name: "Death from Beyond the Grave",
    desc: "Kill an enemy while waiting to respawn.",
    icon: 8,
  },
  guns: {
    name: "Indecisive",
    desc: "Get a kill with every weapon in 1 game.",
    icon: 9,
  },
  return: {
    name: "Return to Sender",
    desc: "Kill an enemy with his own sticky grenade that is stuck to you.",
    icon: 10,
  },
  railgun: {
    name: "Knockout",
    desc: "Kill 3 enemies with 1 shot from the railgun.",
    icon: 11,
  },
  complete: { name: "Achievements are complete!", desc: "LOLOLZ", icon: 12 },
};

// Raze 2 achievement set (extracted from Achievements.as / achievements.json).
// These carry `rew` payloads — credit grants or special-mode unlocks — applied
// in addAch(). They share the generic medal icon (no per-achievement art was
// extracted).
for (const a of R2_ACHIEVEMENTS as Array<{
  id: string;
  name: string;
  desc: string;
  rew: [string, string | number];
}>) {
  MEDALS[a.id] = { name: a.name, desc: a.desc, icon: 12, rew: a.rew };
}

// Ordered list used by the medals menu. Note: matches getName() in the original,
// which omits "railgun". The Raze 2 achievements follow the Raze 1 set.
const NAMES = [
  "rank", "nodie", "human", "alien", "headshot", "addicted",
  "pistol", "gravekill", "guns", "return",
  ...(R2_ACHIEVEMENTS as Array<{ id: string }>).map((a) => a.id),
  "complete",
];

export const Achievements = {
  /** UI popup, registered by the overlay. Null in headless contexts. */
  popup: null as MedalPopup | null,

  /** Return the medal key at a 1-based menu index. */
  getName(index: number): string {
    return NAMES[index - 1];
  },

  /** Look up medal data for a key. Pure — does not award. */
  getAch(key: string): Medal {
    return MEDALS[key] ?? MEDALS.complete;
  },

  /**
   * Award a medal (unless already earned, or we're in the tutorial level where
   * achievements are suppressed). Fires the popup + medal sound.
   */
  addAch(key: string): void {
    const suppressed =
      SD.medals[key] || (SD.matchSettings.level && SD.matchSettings.level == 1);
    if (suppressed) return;

    SD.medals[key] = true;

    // Apply the Raze 2 reward payload, if any.
    const medal = this.getAch(key);
    if (medal.rew) {
      const [kind, val] = medal.rew;
      if (kind === "credits" && typeof val === "number") {
        SD.addCredits(val); // addCredits persists
      } else if (kind === "mode" && typeof val === "string") {
        if (!SD.modesUnlocked.includes(val)) SD.modesUnlocked.push(val);
      }
    }

    SD.save();
    Sound.play("Medal");
    this.popup?.show(medal);
  },
} as const;
