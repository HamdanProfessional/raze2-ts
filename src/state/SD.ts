import { Log } from "./Log";
import { Achievements } from "../game/Achievements";
import {
  Quality,
  normalizeQuality,
  QUALITY_LEVELS,
  type QualityLevel,
} from "./Quality";

/**
 * SD ("Saved Data" / shared game state). Ported from SD.as.
 *
 * A global static holding: persistent player data (profile, stats, medals,
 * progression), transient session flags (paused, scores, ssMode), and the
 * current match configuration. Persistence uses localStorage instead of Flash's
 * SharedObject. Screen/URL side effects use window.open.
 *
 * `game` is the live Game screen; it's typed loosely here because Game/Hud are
 * ported in later modules and SD only pokes a handful of their members.
 */

export interface Profile {
  name: string;
  pers: string;
  prof_action: string;
  prof_preset: number;
  prof_head: number;
  prof_body: number;
  prof_legs: number;
  /** Equipped Raze 2 skin id (see raze2/skins.json). Menu/preview cosmetic. */
  prof_skin?: string;
  /** Equipped equipment ids per slot (up to 3, one per class 0-2); "" = none.
   *  Mirrors the SWF `SD.equips` loadout. See game/Equipment.ts. */
  prof_equips?: string[];
  /** Selected ability id (see raze2 abilities / game/Abilities.ts). */
  prof_ability?: string;
  /** Weapon ids the player spawns carrying (on top of native starters).
   *  Index 0 is the primary — the gun held at spawn. See game/Armory.ts. */
  prof_guns?: string[];
}

export interface Stats {
  kills: number;
  deaths: number;
  suicides: number;
  headshots: number;
  won: number;
  lost: number;
  killstreak: number;
  shots: number;
  shotsHit: number;
  /** Total seconds spent holding the Juggernaut crown. */
  jugTime: number;
  /** Kills taken off a Juggernaut. */
  jugKills: number;
}

/** Per-match configuration built by the menu before a game starts. */
export interface MatchSettings {
  [key: string]: any;
  won?: boolean;
  campaign?: number;
  level?: any;
  music?: any;
}

// Minimal shape of the live Game screen that SD touches.
interface GameLike {
  gameOver: boolean;
  gameStarted: boolean;
  main: any;
  hud: any;
  units: any[];
  setPause(showMenu: boolean): void;
  setUnPause(): void;
  /** Optional: hide/show every piece of on-screen chrome (screenshot mode). */
  applySSmode?(on: boolean): void;
}

const SAVE_KEY = "DkjdsJfjhdJe342J";

class SDState {
  matchSettings: MatchSettings = {};
  sound = true;
  stats!: Stats;
  curStage = 1;
  showUnlock = "";
  profile!: Profile;
  music = true;
  /** Index into QUALITY_LEVELS — what the options panel selector shows. */
  menuQual = 2;
  /** Graphics quality level. Kept in sync with `menuQual` by setQuality(). */
  qual: QualityLevel = "high";
  language = "English";
  medals: Record<string, any> = {};
  noGlow = false;
  curCampaign = "human";

  // --- Raze 2 economy (credits + unlock ownership) ----------------------
  /** Soft currency earned from kills / kill-bonuses; spent in the armory. */
  credits = 0;
  /** Owned weapon ids (armory purchases). Native starter guns are free. */
  gunsOwned: string[] = [];
  /** Owned skin ids (Stats_Skins). The two free skins are granted on new game. */
  skinsOwned: string[] = [];
  /** Owned equipment ids ("<slot>:<name>"). */
  equipsOwned: string[] = [];
  /** Owned ability ids (Stats_Abilities). "ammo" is the free default. */
  abilitiesOwned: string[] = [];
  /** Special-mode modifiers unlocked via achievements (e.g. "Unlimited Ammo"). */
  modesUnlocked: string[] = [];
  /** Distinct kill-bonus ids ever earned (drives the bonus1/bonus2 medals). */
  bonusesUnlocked: string[] = [];

  paused = false;
  scores = false;
  introSkip = false;
  ssMode = false;

  private game: GameLike | null = null;

  init(): void {
    this.curCampaign = "human";
    this.load();
  }

  setGame(g: GameLike): void {
    this.game = g;
  }

  removeGame(): void {
    this.game = null;
  }

  /** Toggle in-game pause. Returns false if paused isn't currently allowed. */
  togglePause(): boolean {
    const g = this.game;
    if (!g || g.gameOver || !g.gameStarted) return false;

    if (this.scores || this.ssMode) {
      this.scores = false;
      g.setPause(true);
      this.setSSmode(false);
    } else if (!this.paused) {
      this.paused = true;
      g.setPause(true);
    } else {
      this.paused = false;
      g.setUnPause();
    }
    return true;
  }

  /** Toggle the scoreboard overlay (also pauses). */
  toggleScores(): boolean {
    const g = this.game;
    if (!g || g.gameOver || !g.gameStarted) return false;

    if (!this.scores) {
      this.scores = true;
      this.paused = true;
      g.setPause(true);
      this.setSSmode(false);
    } else {
      this.scores = false;
      this.paused = false;
      g.setUnPause();
    }
    return true;
  }

  /** Screenshot mode: hide all HUD chrome so the arena can be captured clean. */
  setSSmode(on: boolean): void {
    const g = this.game;
    if (!g) return;
    const hud = g.hud;
    if (this.ssMode === on) return;

    // Bump render quality while capturing, restore afterwards.
    if (g.main && g.main._stage) {
      g.main._stage.quality = on ? "best" : Quality.stageQuality;
    }
    this.ssMode = on;

    // Preferred path: the screen knows about every piece of chrome it owns
    // (HUD, unit name tags, crosshair) and hides them in one go.
    if (typeof g.applySSmode === "function") {
      g.applySSmode(on);
      return;
    }

    const vis = !on;
    if (hud) {
      const fields = [
        "hpBar", "shBar", "gunBox", "pos1Box", "pos2Box",
        "score1Box", "score2Box", "score1Bar", "score2Bar",
        "hpBox", "shBox", "nameBox", "timeBox", "matchBox",
        // Pixi-port HUD fields.
        "nameText", "hpText", "shText", "gunName", "gunAmmo",
        "modeText", "timerText", "jugText", "streakText", "banner",
      ];
      for (const f of fields) if (hud[f]) hud[f].visible = vis;
      if (hud.bigText) hud.bigText.visible = vis;
      for (let i = 0; i < 10; i++) {
        if (hud["gun" + i]) hud["gun" + i].visible = vis;
      }
      if (hud.msgRoll) {
        for (const m of hud.msgRoll) if (m) m.visible = vis;
      }
    }
    for (const u of g.units) {
      if (u && u.topText) u.topText.visible = vis;
    }
  }

  /**
   * Flip screenshot/spectator mode. Returns the new state, or false when there
   * is no live game (or the scoreboard/pause overlay owns the screen).
   */
  toggleSSmode(): boolean {
    const g = this.game;
    if (!g || !g.gameStarted) return false;
    // The scoreboard and pause menu are modal — leave them alone.
    if (this.paused || this.scores) return false;
    this.setSSmode(!this.ssMode);
    return this.ssMode;
  }

  // --- graphics settings -------------------------------------------------

  /** Set the graphics quality level, apply it live, and persist. */
  setQuality(level: QualityLevel): void {
    this.qual = level;
    this.menuQual = Math.max(0, QUALITY_LEVELS.indexOf(level));
    this.applyQuality();
    this.save();
  }

  /** Advance to the next quality step, wrapping Max -> Low. */
  cycleQuality(): QualityLevel {
    this.setQuality(Quality.nextLevel());
    return this.qual;
  }

  /** Enable/disable glow + bloom rendering, apply live, and persist. */
  setNoGlow(noGlow: boolean): void {
    this.noGlow = noGlow;
    this.applyQuality();
    this.save();
  }

  toggleGlow(): boolean {
    this.setNoGlow(!this.noGlow);
    return !this.noGlow;
  }

  /**
   * Push the saved values into the Quality module, which notifies every live
   * subscriber (engine FPS cap, HUD, effects) so changes take effect without a
   * restart. Also refreshes the legacy `_stage.quality` slot if a game is up.
   */
  applyQuality(): void {
    Quality.set(this.qual, this.noGlow);
    const g = this.game;
    if (g && g.main && g.main._stage && !this.ssMode) {
      g.main._stage.quality = Quality.stageQuality;
    }
  }

  // --- progression -------------------------------------------------------

  addWin(): void {
    this.stats.won++;
    this.matchSettings.won = true;
    if (
      this.matchSettings.campaign &&
      this.matchSettings.campaign === this.curStage
    ) {
      if (this.curStage === 15) {
        this.showUnlock = "unlock_alien";
        Achievements.addAch("human");
        Achievements.addAch("humanwin"); // Raze 2: "A New Hope" (+500 cr)
        Log.CustomMetric("Completed Human Campaign");
      }
      if (this.curStage === 30) {
        this.showUnlock = "unlock_beatgame";
        Achievements.addAch("alien");
        Achievements.addAch("alienwin"); // Raze 2: "A New Era" (+1000 cr)
        Log.CustomMetric("Completed Alien Campaign");
      }
      if (this.curStage < 30) {
        this.curStage++;
      }
    }
    // getAch is a pure lookup — awarding needs addAch.
    if (this.stats.lost + this.stats.won >= 50) {
      Achievements.addAch("addicted");
    }
  }

  addLoss(): void {
    this.stats.lost++;
    this.matchSettings.won = false;
    // getAch is a pure lookup — awarding needs addAch.
    if (this.stats.lost + this.stats.won >= 50) {
      Achievements.addAch("addicted");
    }
  }

  /** The ALIEN species + alien campaign unlock once the human campaign (stage 15)
   *  is beaten — SWF: Menu_Cont gated bt_alien behind `curStage > 15`. */
  get alienUnlocked(): boolean {
    return this.curStage > 15;
  }

  unLockAll(campaign: number): void {
    this.curStage = 15 * campaign;
    this.save();
  }

  lockAll(): void {
    this.curStage = 1;
    this.save();
  }

  // --- outbound links ----------------------------------------------------

  urlTwitter(): void {
    window.open("https://twitter.com/armorgames", "_blank");
    Log.CustomMetric("Clicked Twitter link");
  }
  urlFacebook(): void {
    window.open("https://www.facebook.com/ArmorGames", "_blank");
    Log.CustomMetric("Clicked Facebook link");
  }
  urlSponsor(): void {
    window.open("https://www.armorgames.com", "_blank");
    Log.CustomMetric("Clicked Armorgames link");
  }
  urlJuice(): void {
    window.open("https://www.juice-tin.com", "_blank");
    Log.CustomMetric("Clicked Juice-Tin link");
  }
  urlAdd(): void {
    /* original was a no-op */
  }

  // --- persistence -------------------------------------------------------

  newGame(): void {
    this.introSkip = false;
    this.language = "English";
    this.profile = {
      name: "Player",
      pers: "gamer",
      prof_action: "idle",
      prof_preset: 1,
      prof_head: 1,
      prof_body: 1,
      prof_legs: 1,
      prof_skin: "raze",
      prof_equips: ["", "", ""],
      prof_ability: "ammo",
      prof_guns: [],
    };
    this.stats = {
      kills: 0,
      deaths: 0,
      suicides: 0,
      headshots: 0,
      won: 0,
      lost: 0,
      killstreak: 0,
      shots: 0,
      shotsHit: 0,
      jugTime: 0,
      jugKills: 0,
    };
    this.noGlow = false;
    this.qual = "high";
    this.menuQual = QUALITY_LEVELS.indexOf("high");
    this.applyQuality();
    this.curStage = 1;
    this.sound = true;
    this.music = true;
    this.medals = {};
    this.credits = 500; // Raze 2 starting balance
    this.gunsOwned = [];
    this.skinsOwned = ["raze", "raze2"]; // two free starter skins
    this.equipsOwned = [];
    this.abilitiesOwned = ["ammo"]; // Resupply is the free default ability
    this.modesUnlocked = [];
    this.bonusesUnlocked = [];
    this.save();
  }

  /** Award (or spend, if negative) credits and persist. */
  addCredits(n: number): void {
    this.credits = Math.max(0, this.credits + n);
    this.save();
  }

  /**
   * Wipe combat statistics and earned medals, leaving everything else alone:
   * the profile (name, personality, preset, head/body/legs), campaign
   * progression, language and audio/graphics settings all survive. Used by the
   * "RESET STATS" button on the stats screen.
   */
  resetStats(): void {
    this.stats = {
      kills: 0,
      deaths: 0,
      suicides: 0,
      headshots: 0,
      won: 0,
      lost: 0,
      killstreak: 0,
      shots: 0,
      shotsHit: 0,
      jugTime: 0,
      jugKills: 0,
    };
    this.medals = {};
    this.save();
    Log.CustomMetric("Reset statistics");
  }

  load(): void {
    let data: any = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch {
      data = null;
    }
    if (data && data.savedBefore) {
      this.introSkip = data.introSkip;
      this.language = data.language;
      this.profile = data.profile;
      this.stats = data.stats;
      // Fields added after the save format shipped — backfill for old saves.
      this.stats.jugTime ??= 0;
      this.stats.jugKills ??= 0;
      // Graphics settings. Old saves may hold Flash's "best", a bare index, or
      // nothing at all — normalizeQuality folds all of those onto a real level.
      this.noGlow = !!data.noGlow;
      this.qual = normalizeQuality(data.qual ?? data.menuQual);
      this.menuQual = Math.max(0, QUALITY_LEVELS.indexOf(this.qual));
      this.applyQuality();
      this.curStage = data.curStage;
      this.sound = true;
      this.music = true;
      this.medals = data.medals;
      // Economy — backfill for saves from before the Raze 2 armory.
      this.credits = data.credits ?? 0;
      this.gunsOwned = data.gunsOwned ?? [];
      this.skinsOwned = data.skinsOwned ?? [];
      this.equipsOwned = data.equipsOwned ?? [];
      this.abilitiesOwned = data.abilitiesOwned ?? ["ammo"];
      this.modesUnlocked = data.modesUnlocked ?? [];
      this.bonusesUnlocked = data.bonusesUnlocked ?? [];
      // Loadout fields added with Tier 3 — backfill for older profiles.
      this.profile.prof_equips ??= ["", "", ""];
      this.profile.prof_ability ??= "ammo";
      this.profile.prof_guns ??= [];
    } else {
      this.newGame();
    }
  }

  save(): void {
    const data = {
      savedBefore: true,
      introSkip: true,
      profile: this.profile,
      stats: this.stats,
      language: this.language,
      noGlow: this.noGlow,
      qual: this.qual,
      menuQual: this.menuQual,
      curStage: this.curStage,
      sound: this.sound,
      music: this.music,
      medals: this.medals,
      credits: this.credits,
      gunsOwned: this.gunsOwned,
      skinsOwned: this.skinsOwned,
      equipsOwned: this.equipsOwned,
      abilitiesOwned: this.abilitiesOwned,
      modesUnlocked: this.modesUnlocked,
      bonusesUnlocked: this.bonusesUnlocked,
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode) — ignore */
    }
  }
}

export const SD = new SDState();
