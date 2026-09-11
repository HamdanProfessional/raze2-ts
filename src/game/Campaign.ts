/**
 * Ported from Campaign.as / Stats_Campaign.as.
 *
 * The 30 single-player missions (15 Human, 15 Alien) are extracted verbatim
 * from the decompiled Raze 2 `Stats_Campaign.as` into
 * `assets/raze2/campaign.json` (see tools / the extraction step): each mission
 * carries its map, mode, score cap, scripted bot roster (name / team / skin /
 * level / weapon / equip / ability / spawn), briefing text, scripted dialogue
 * and cutscene music.
 *
 * This module adapts that data to the shapes the menu (CampaignScreen) and the
 * match runtime (GameScreen) already consume:
 *   - getCamp(num)      → { num, settings, ai } for the stage-select screen and
 *                         the roster GameScreen spawns.
 *   - campaignMap(id)   → the port's namespaced level id for a Raze 2 map name,
 *                         collapsing "2"/"tut" variants onto the geometries we
 *                         actually shipped.
 */

import CAMPAIGN_DATA from "../assets/raze2/campaign.json";
import { DEFAULT_LIVES } from "./Match";
import { resolveEquipIndices } from "./Equipment";

/** Raze 2 map geometries we extracted (see raze2maps.json). */
const AVAILABLE = new Set([
  "jungle", "jungle2", "city", "desert", "ocean", "mines", "mines2", "space", "snow", "tut", "tutq",
]);

/**
 * Map a campaign map name to a shipped level id. The "2" background variants
 * (space2, city2, …) share geometry with their base; `tutq2` is the Quarantine
 * map's second dressing. `tut` is the walkthrough's own geometry — the same art
 * as Quarantine plus the barriers the tutorial opens one at a time — so it is a
 * level of its own, not a re-skin.
 */
export function campaignMap(id: string): string {
  if (AVAILABLE.has(id)) return `r2_${id}`;
  if (id === "tutq2") return "r2_tutq";
  const base = id.replace(/2$/, "");
  if (AVAILABLE.has(base)) return `r2_${base}`;
  return "r2_jungle";
}

/** Campaign mode name → the port's short mode code. The mission data spells it
 *  "Juggernaught"; both spellings map so neither has to fall through. */
const MODE_CODE: Record<string, string> = {
  Deathmatch: "dm",
  "Team Deathmatch": "tdm",
  "Capture the Flag": "ctf",
  Domination: "dom",
  Juggernaut: "jug",
  Juggernaught: "jug",
  Elimination: "elim",
  "Team Elimination": "telim",
};

export interface CampaignAi {
  /** Personality: gamer, military, alien, zombie, robot, angry, leetnoob. */
  pers: string;
  /** Difficulty modifier 0..2 (typical). */
  diff: number;
  /** Display name (some missions name their bots). */
  name?: string;
  /** Team (1/2) for objective missions; 0 in free-for-all. */
  team?: number;
  /** Character preset 1..20 (looks up head/body/legs in ProfileUnit). */
  preset?: number;
  /** Menu-cosmetic Raze 2 skin id the bot represents (live rig unchanged). */
  skin?: string;
  /** Gun they spawn holding, if the script named a real weapon id. */
  gun?: string;
  /** 7-slot tier array from the mission's weapon kit (`WEAPON_SETS`), resolved
   *  to concrete guns by `resolveLoadout` at spawn. */
  weapons?: number[];
  /** Passive `equips[type] = value` map from the mission's equipment kit. */
  equips?: Record<string, number>;
  /** F-key ability id, if any. */
  ability?: string;
  /** Named equipment loadout preset from the mission script. */
  equip?: string;
  /** Fixed spawn override {x,y} from the mission script. */
  spawn?: { x?: number; y?: number; node?: string };
  /** Scripted flag: focus fire on the player. */
  aimPlayer?: boolean;
  /** Constructed inert and parked off-map until a script cue spawns it. */
  noSpawn?: boolean;
  /** Waypoint the unit holds station at, playing its `speak_<id>` pose. */
  speak?: string;
}

export interface CampaignSettings {
  campaign: number;
  /** dm | tdm | ctf | dom | jug. */
  type: string;
  level: string;
  curJug: any;
  jugSh: number;
  score: number;
  lives: number;
  dmgMod: number;
  egoMode: boolean;
  /** 0 = full arsenal, 1 = SMG, 2 = explosives, … (see Pickup_Weapon.as). */
  weapons: number;
  team: boolean;
  /** Side count when the mission fields more than two (alien 4 is a 3-way).
   *  Undefined leaves the match runtime to derive it from `team`. */
  teams?: number;
  /** Briefing shown at mission start. */
  matchName?: string;
  matchDesc?: string;
  music?: string;
}

/** One scripted story line, resolved to what the HUD box needs to draw it. */
export interface CampaignMessage {
  /** Roster slot speaking the line (0 = the player), or null for radio chatter. */
  unit: number | null;
  /** Raze 2 skin id whose baked figure is the portrait, or null. */
  portrait: string | null;
  /** Name shown beside the portrait, or null. */
  speaker: string | null;
  text: string;
  /** Seconds the line stays up (`setCampMsg`'s `time` argument). */
  hold: number;
}

export interface CampaignEntry {
  num: number;
  settings: CampaignSettings;
  ai: CampaignAi[];
  /** Scripted in-match dialogue (setCampMsg), in script order. */
  messages: CampaignMessage[];
  /** Pre/post cutscene music + the comic frames each scene pages through.
   *  Resolved to baked panels by `Cutscene.getCutscene()`. */
  cutscene?: any;
}

/** `Hud.setCampMsg(who, text, time=4, speakerName="")` — the default hold. */
const MSG_HOLD = 4;

/**
 * `Stats_Campaign.setWeapon()` — a mission's `weapon: "zombie"` names a *class
 * kit*, not a gun. Each entry is the 7-slot tier array Raze 2 hands to
 * `Guns.setGuns()`, which resolves `gunSet[slot] = getGun(slot, tier)`. So the
 * zombies' `[0,4,0,0,0,0,0]` is the tier-4 SMG (`blood`), the aliens' kit is
 * alien-race guns across the board, and the Raze soldiers' all-zeros is the
 * stock seven.
 *
 * The port already resolves this shape via `resolveLoadout(extra.weapons)`;
 * before this table the set name was passed through as if it were a gun id, so
 * `WEAPONS["zombie"]` missed and every scripted bot in the campaign silently
 * fell back to the default arsenal.
 */
const WEAPON_SETS: Record<string, number[]> = {
  raze: [0, 0, 0, 0, 0, 0, 0],
  raze2: [0, 0, 0, 0, 0, 0, 0],
  raze3: [0, 0, 0, 0, 0, 0, 0],
  johnny: [2, 1, 3, 0, 0, 0, 1],
  medic: [0, 1, 0, 3, 0, 0, 3],
  explosives: [0, 2, 4, 4, 3, 4, 1],
  zombie: [0, 4, 0, 0, 0, 0, 0],
  alien: [1, 3, 1, 1, 2, 2, 2],
  commander: [1, 3, 2, 2, 3, 3, 4],
  robot: [2, 0, 0, 0, 1, 1, 1],
  robot2: [2, 0, 0, 0, 1, 1, 1],
};

/**
 * `Stats_Campaign.setEquip()` — one item index per equipment class (0/1/2),
 * fed to `Stats_Equipment.getEquipment(cls, index)`. These are what make the
 * scripted cast feel different beyond their guns: zombies take the +100 health
 * body and no gadgets, aliens spawn on a shield battery, the Commander gets the
 * boss-tier pair, and the final Raze soldier carries the +400 health body.
 *
 * `robot2`'s third index is obfuscated in the decompile (only `6, 4` survive as
 * stack pushes). It shares `robot`'s weapon kit exactly, so it takes `robot`'s
 * cls-2 item; the two differ only in the tankier cls-0 body.
 */
const EQUIP_SETS: Record<string, number[]> = {
  raze: [5, 2, 3],
  raze2: [6, 2, 3],
  raze3: [7, 2, 3],
  johnny: [5, 2, 2],
  medic: [2, 4, 1],
  explosives: [3, 3, 4],
  zombie: [6, 0, 0],
  alien: [0, 5, 0],
  commander: [1, 6, 4],
  robot: [4, 4, 1],
  robot2: [6, 4, 1],
};

/** Personality inferred from a bot's skin family (drives chatter lines). */
function persFor(skin: string | undefined, alien: boolean): string {
  if (!skin) return alien ? "alien" : "gamer";
  if (/^a|alien|space/.test(skin)) return "alien";
  if (/zomb/.test(skin)) return "zombie";
  if (/rob|bot|mech/.test(skin)) return "robot";
  if (/rambo|army|military|soldier/.test(skin)) return "military";
  return alien ? "alien" : "gamer";
}

function toAi(b: any, alien: boolean): CampaignAi {
  const level = Number(b.level) || 4;
  // `b.weapon` is a kit name ("zombie", "alien", …) in every shipped mission;
  // only pass it on as `gun` if a script ever names a literal weapon instead.
  const kit = WEAPON_SETS[b.weapon];
  return {
    pers: persFor(b.skin, alien),
    diff: Math.max(0.5, Math.min(2.4, level / 4)),
    name: b.name,
    team: b.team,
    skin: b.skin,
    gun: kit ? undefined : b.weapon,
    weapons: kit,
    equips: resolveEquipIndices(EQUIP_SETS[b.equip]),
    ability: b.ability && b.ability !== "none" ? b.ability : undefined,
    equip: b.equip,
    spawn: b.extra?.spawn,
    aimPlayer: !!b.extra?.aimPlayer,
    noSpawn: !!b.extra?.noSpawn,
    speak: b.extra?.speak,
  };
}

/**
 * Resolve one `setCampMsg` call into a drawable line.
 *
 * The original passes either a live unit (portrait + name come from that unit's
 * skin and roster name) or a raw skin key paired with an explicit display name
 * ("girl"/"Dani", "addison"/"Scientist"). `whoUnit` indexes the match roster
 * with the player at 0, so a bot's own row is `bots[whoUnit - 1]`; the player's
 * own portrait/name are only known at match time and are filled in there.
 */
function toMessage(m: any, bots: any[]): CampaignMessage {
  const unit = typeof m.whoUnit === "number" ? m.whoUnit : null;
  const bot = unit && unit > 0 ? bots[unit - 1] : null;
  return {
    unit,
    portrait: m.whoPortrait ?? bot?.skin ?? null,
    speaker: m.speaker ?? bot?.name ?? null,
    text: String(m.text ?? ""),
    hold: Number(m.time) || MSG_HOLD,
  };
}

/** Look up the mission entry for a 1..30 stage index (1-15 Human, 16-30 Alien). */
export function getCamp(num: number): CampaignEntry | null {
  const alien = num > 15;
  const arm = alien ? "alien" : "human";
  const idx = alien ? num - 16 : num - 1;
  const raw = (CAMPAIGN_DATA as any)[arm]?.[idx];
  if (!raw) return null;

  const type = MODE_CODE[raw.mode] ?? raw.modeCode ?? "dm";
  const ai = (raw.bots ?? []).map((b: any) => toAi(b, alien));
  // Team-based whenever the mode is objective/team OR the roster fields distinct
  // teams — so scripted allies (team 1, e.g. your instructor) fight alongside you
  // rather than becoming FFA targets.
  const teamMode =
    type === "ctf" ||
    type === "dom" ||
    type === "tdm" ||
    Number(raw.teams) >= 2 ||
    ai.some((a: CampaignAi) => a.team === 1);

  const settings: CampaignSettings = {
    campaign: num,
    type,
    level: campaignMap(raw.map),
    curJug: null,
    jugSh: 2,
    score: Number(raw.scoreCap) || 15,
    // Elimination is decided by wiping the enemy side, not by a score cap, so
    // the mission's cap is ignored there and everyone gets the same respawns.
    lives: type === "elim" || type === "telim" ? DEFAULT_LIVES : 0,
    dmgMod: 1,
    egoMode: false,
    weapons: 0,
    team: teamMode,
    teams: Number(raw.teams) >= 2 ? Number(raw.teams) : undefined,
    matchName: raw.title,
    matchDesc: raw.desc,
    music: raw.music,
  };

  const bots = raw.bots ?? [];
  const messages = (raw.messages ?? []).map((m: any) => toMessage(m, bots));

  return { num, settings, ai, messages, cutscene: raw.cutscene };
}
