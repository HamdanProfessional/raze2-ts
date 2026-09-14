import { Container, Graphics, Rectangle, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Backgrounds } from "../assets/Backgrounds";
import { LEVELS, preloadLevel } from "../game/Arena";
import { loadoutGuns } from "../game/Armory";
import { creditMod } from "../game/KillBonus";
import { GameScreen } from "../game/GameScreen";
import { MenuScreen } from "./MenuScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import { MultiplayerScreen } from "./MultiplayerScreen";
import {
  makeBackground, makeScrim, addScreenChrome, type ScreenChrome, makeVeil,
  TITLE_SIZE, TITLE_Y,
} from "./ui";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_LABEL,
  C_VALUE,
  C_DIM,
  C_OPTIONS_GREEN,
  C_ACCENT_SECONDARY,
  C_ACCENT_UPGRADE,
  C_TEAM1,
  A_HEADER,
  A_LABEL,
  A_VALUE,
  A_BODY,
} from "../ui/raze2";

/**
 * Quick Match set-up, restyled to match Raze 2's actual Quick Match screen
 * (docs/raze2-spec/09-quickmatch-play.md + reference screenshot #4):
 *
 *  - Left column: the map preview (Prev/Next carousel, name, description)
 *    stacked ABOVE the match-settings `‹ value ›` steppers (Match Type — with
 *    its one-line rules description — Kills to Win / Lives / Points to Win,
 *    Weapons, Special Mode, Abilities, Equipment).
 *  - Right column: "Add Team" above the roster panel (Free For All / N
 *    Teams header with a live player count, Players + Difficulty steppers).
 *  - Top-right: "What is this ?". Bottom bar: Back to Menu, Upgrades, Start
 *    Game (the port's existing Online Match secondary path is kept, tucked
 *    next to Back to Menu).
 *
 * The five selectable match types, their descriptions and per-type
 * win-condition cycle arrays are lifted verbatim from doc 09 §2.4 (`Menu.as`'s
 * cycle array + `setQuickmatchSettings`/`setWinScore`). This is a visual/data
 * restyle only — the engine wiring is untouched: Deathmatch/Elimination
 * resolve to the existing "dm"/"tdm" and "elim"/"telim" engine types
 * depending on the team count, and Domination/CTF/Juggernaught map straight
 * to the existing "dom"/"ctf"/"jug" engine types that `Match`/`GameScreen`/
 * `AI`/`Objectives` already implement in full.
 */

/** Global AI difficulty multiplier (separate axis from Raze 2's per-team 0-10
 *  `team*diff` scale, doc 09 §2.2/§6 open question) — unchanged from before. */
const DIFFS: { label: string; value: number }[] = [
  { label: "Easy", value: 0.8 },
  { label: "Medium", value: 1.2 },
  { label: "Hard", value: 2 },
  { label: "Ego", value: 2.8 },
];

/** The 5 real Raze 2 match types (doc 09 §2.4), exact labels, descriptions,
 *  score/lives cycle arrays and team-count bounds. */
interface MatchTypeDef {
  key: "dm" | "elim" | "dom" | "ctf" | "jug";
  label: string;
  desc: string;
  scoreLabel: string;
  scores: number[];
  teamsMin: number;
  teamsMax: number;
}

const MATCH_TYPES: MatchTypeDef[] = [
  {
    key: "dm",
    label: "Deathmatch",
    desc: "Score points by Killing enemies.",
    scoreLabel: "Kills to Win",
    scores: [15, 20, 25, 50, 100, 5],
    teamsMin: 1,
    teamsMax: 4,
  },
  {
    key: "elim",
    label: "Elimination",
    desc: "Kill off all the Lives of your enemies and be the last standing.",
    scoreLabel: "Lives",
    scores: [10, 15, 20, 25, 3, 5, 7],
    teamsMin: 1,
    teamsMax: 4,
  },
  {
    key: "dom",
    label: "Domination",
    desc: "Capture Flag areas and earn points based on how many you control.",
    scoreLabel: "Points to Win",
    scores: [50, 75, 100, 150, 200, 250, 25],
    teamsMin: 2,
    teamsMax: 4,
  },
  {
    key: "ctf",
    label: "Capture the Flag",
    desc: "Capture the enemy's Flag and return it to your base.",
    scoreLabel: "Points to Win",
    scores: [3, 5, 7, 10, 15, 25],
    teamsMin: 2,
    teamsMax: 2,
  },
  {
    key: "jug",
    label: "Juggernaught",
    desc: "Kill the Juggernaught to become him, and then kill everyone else.",
    scoreLabel: "Kills to Win",
    scores: [10, 15, 20, 25, 30],
    teamsMin: 1,
    teamsMax: 1,
  },
];

/** Default index into `MATCH_TYPES` (Deathmatch) and its default score index
 *  (20, `MatchSettings.Init()`'s `winScore = 20`, doc 09 §2.4). */
const DEFAULT_MODE_IDX = 0;
const DEFAULT_SCORE_IDX = 1;

const WEAPONS = ["All", "Starters", "Sidearms", "Close Range", "Automatics", "Long Range", "Heavies", "Explosives"];
const ONOFF = ["Off", "On"];

/** Roster slot tint per team index (blue / orange / yellow / green), matching
 *  the team colour family the scoreboard and HUD use. */
const TEAM_COLORS = [0x5aa0ff, 0xff8a3a, 0xf2d16b, 0x7fd39a];

/** `txt_playername` — the roster box's name row: pale yellow, panel-local
 *  (41.8, 92.4), i.e. `mc_bots` (467.3, 111.8) + the field's (9.5, 36.6). */
const C_PLAYERNAME = 0xffff99;
const ROSTER_NAME_X = 41.8;
const ROSTER_NAME_Y = 92.4;

/** `txt_warning` ink colour (#ff9999 in the source). */
const C_WARNING = 0xff9999;

/** Real Raze 2 map names + descriptions (doc 09 §2.3, recovered from
 *  `Stats_Maps.as`'s p-code) for the `LEVELS` entries that correspond to
 *  canonical Raze 2 arenas. The Raze-1-only / sandbox entries have no Raze 2
 *  source of truth, so they keep a generic description. */
const MAP_INFO: Record<string, { title: string; desc: string }> = {
  r2_jungle: {
    title: "Dome",
    desc: "A jungle preserved in a giant glass dome. Built to sustain the last remaining wildlife on earth from it's now uninhabital climate. It's now used for various tests.",
  },
  r2_jungle2: {
    title: "Dome (Night)",
    desc: "A jungle preserved in a giant glass dome. Built to sustain the last remaining wildlife on earth from it's now uninhabital climate. It's now used for various tests.",
  },
  r2_city: {
    title: "Judgement",
    desc: "A city that once flourished with human life, now inhabited only by creatures of the night.",
  },
  r2_desert: {
    title: "Shipyard",
    desc: "Originally built for human ships, the shipyards have been taken over by aliens for their own air force.",
  },
  r2_ocean: {
    title: "Facility",
    desc: "An underwater testing facility. Used as a means of creating new equipment for battle, while being hidden underwater from enemies.",
  },
  r2_mines: {
    title: "Mines",
    desc: "A mining facility rich in minerals. It's high concentration of elements makes it a key area fought over by many forces.",
  },
  r2_mines2: {
    title: "Mines (Day)",
    desc: "A mining facility rich in minerals. It's high concentration of elements makes it a key area fought over by many forces.",
  },
  r2_space: {
    title: "Crash Landing",
    desc: "A space battle with a persuing enemy ship has resulted in the Echo-1 crash landing on an unknown planet.",
  },
  r2_snow: {
    title: "Frostbite",
    desc: "A look out post situated high atop a mountain pass. It's servers hold high amounts of sensitive information, sought out by enemies.",
  },
  r2_tutq: {
    title: "Headquarters",
    desc: "Home of the Raze Task Force, and the training grounds for new recruits. (Very small map, -100% credits)",
  },
};

function mapInfo(id: string, fallbackName: string): { title: string; desc: string } {
  return MAP_INFO[id] ?? { title: fallbackName, desc: "Pick your arena, then set the rules of engagement." };
}

/**
 * Special-mode dropdown (doc 11 §2). "None" and "Infinite Clips" are always
 * selectable; the rest are gated on achievement unlocks stored in
 * `SD.modesUnlocked`. Note the achievement reward table stores the *ammo* unlock
 * as the string "Unlimited Ammo", but the runtime gameplay flag the game checks
 * everywhere is "Infinite Ammo" — so it is remapped here (doc 11 §2 naming quirk).
 */
function buildSpecials(): string[] {
  const list = ["None", "Infinite Clips"];
  const unlocked = SD.modesUnlocked ?? [];
  if (unlocked.includes("Unlimited Ammo") || unlocked.includes("Infinite Ammo")) list.push("Infinite Ammo");
  if (unlocked.includes("lol cats")) list.push("lol cats");
  if (unlocked.includes("4x Health")) list.push("4x Health");
  if (unlocked.includes("Moon Corpses")) list.push("Moon Corpses");
  return list;
}

/** Resolve a match type + team count to the engine's `matchSettings.type`
 *  string (doc 09 §2.4). `Match`/`GameScreen`/`AI`/`Objectives` already
 *  implement all five of these engine types; nothing there needs to change. */
function engineType(mt: MatchTypeDef, teams: number): string {
  if (mt.key === "dm") return teams > 1 ? "tdm" : "dm";
  if (mt.key === "elim") return teams > 1 ? "telim" : "elim";
  return mt.key; // dom / ctf / jug are always their own engine type.
}

/** Default map on entry: the reference screenshot (#4) opens on "Dome"
 *  (`r2_jungle`), a canonical Raze 2 arena — not `LEVELS[0]`, which is a
 *  Raze-1 map the port's mixed carousel happens to list first (doc 09 §3,
 *  the carousel-source rework itself is flagged "future build phase" there).
 */
const DEFAULT_LEVEL_IDX = Math.max(0, LEVELS.findIndex((l) => l.id === "r2_jungle"));

/** Shared vertical centre for the screen title and the "What is this ?" link. */
const HEADER_CY = 52;

/** Height of one `label ....... ‹ value ›` row. The label, the value and both
 *  arrows all centre on `rowY + ROW_H / 2`. */
const ROW_H = 22;

/** Square click target around a stepper chevron. The glyph itself is only a
 *  few px wide, so without this the arrows are nearly unclickable. */
const ARROW_BOX = 24;

/** Width of the `‹ value ›` cluster on a full-width settings row. Sized for
 *  the longest value any stepper shows ("Capture the Flag") so it cannot
 *  overflow into the left chevron. */
const CLUSTER_W = 220;

/** Left edge of the settings-row value fields (`txt_type`/`txt_score`/… all
 *  share SWF x 253.5), in the left panel's crop-local space. */
const VALUE_X = 253.5;

export class PlayScreen extends Screen {
  private levelIdx = DEFAULT_LEVEL_IDX;
  private modeIdx = DEFAULT_MODE_IDX;
  private scoreIdx = DEFAULT_SCORE_IDX;
  private opponents = 3;
  private diffIdx = 1;
  private friendlyFire = false;
  private dmgIdx = 1;

  private weaponsIdx = 0;
  private specialIdx = 0;
  private abilitiesIdx = 1;
  private equipsIdx = 1;
  /** Achievement-gated special-mode list, rebuilt from SD.modesUnlocked. */
  private specials: string[] = buildSpecials();
  /** Numeric team count (doc 09 §2.4): 1 = Free For All, 2-4 = team modes. */
  private teamsCount = MATCH_TYPES[DEFAULT_MODE_IDX].teamsMin;

  private mapImg!: Container;
  private mapTitle!: Text;
  private mapDesc!: Text;
  /** Edge-anchored chrome (header / left panel / right panel). */
  private chrome!: ScreenChrome;
  /** Per-team roster overlays for team modes 2..4 (team 0 uses the baked row). */
  private teamExtra = new Container();
  private rosterCover!: Graphics;

  private modeValue!: Text;
  private modeDescText!: Text;
  private warningText!: Text;
  private scoreLabel!: Text;
  private scoreValue!: Text;
  private weaponsValue!: Text;
  private specialValue!: Text;
  private abilitiesValue!: Text;
  private equipsValue!: Text;
  private playersValue!: Text;
  private diffValue!: Text;
  private rosterTitle!: Text;
  private rosterCount!: Text;
  private addTeamBtn!: Raze2Button;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    // Edge-anchored chrome: the header strip stretches across the stage, the
    // map/settings column pins left, the roster pins right — so the layout
    // follows the window instead of sitting in an 800x600 box. Only the live
    // values and hit areas are created here.
    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.45));
    this.chrome = addScreenChrome(this.view, {
      headerL: "qm_header_l", headerR: "qm_header_r",
      left: "qm_left",
      rightStretch: { l: "qm_right_l", m: "qm_right_m", r: "qm_right_r" },
      // The roster column stretches, so past the authored 800 the team band
      // becomes a long empty bar and the difficulty stepper — pinned to its
      // right end — drifts away from the Players stepper it pairs with.
      maxW: 800,
    });

    this.buildHeader();
    this.buildMapPreview();
    this.buildSettings();
    this.buildAddTeamAndRoster();
    this.buildBottomBar();

    this.refreshMap();
    this.refreshLimit();
    this.refreshValues();
    this.refreshRoster();
  }

  /** Paint every runtime value from the current indices. */
  private refreshValues(): void {
    this.modeValue.text = this.mt.label;
    this.modeDescText.text = this.mt.desc;
    this.weaponsValue.text = WEAPONS[this.weaponsIdx];
    this.specialValue.text = this.specials[this.specialIdx];
    this.abilitiesValue.text = ONOFF[this.abilitiesIdx];
    this.equipsValue.text = ONOFF[this.equipsIdx];
    this.refreshWarning();
  }

  /**
   * `txt_warning`: the red line under the settings block that quotes the credit
   * penalty the current weapon/special-mode restrictions carry. `creditMod`
   * already models it (`Menu.as:1998-2068`) — the field just had no text.
   */
  private refreshWarning(): void {
    const mod = creditMod({
      weaponsUsed: WEAPONS[this.weaponsIdx],
      specialMode: this.specials[this.specialIdx],
      level: LEVELS[this.levelIdx]?.id,
    });
    const pct = Math.round((mod - 1) * 100);
    this.warningText.text = pct < 0
      ? `Warning: With these settings, you will earn ${pct}% credits.`
      : "";
  }

  /** Transparent click target (the baked chrome draws the visuals). */
  private zone(
    parent: Container,
    x: number, y: number, w: number, h: number,
    onClick: () => void, hover = true,
  ): Graphics {
    const g = new Graphics();
    g.rect(x - w / 2, y - h / 2, w, h).fill({ color: 0x000000, alpha: 0.001 });
    g.eventMode = "static";
    g.cursor = "pointer";
    if (hover) g.on("pointerover", () => Sound.play("R2_Click"));
    g.on("pointertap", onClick);
    parent.addChild(g);
    return g;
  }

  /** Screen title (`txt_title`, centred on the stretched header strip).
   *
   *  `headerRoot` is already scaled by `chrome.s`, so the point size is the
   *  SWF's own — multiplying by `s` a second time rendered the title ~40%
   *  oversized (27 SWF px against the authored 19.93). */
  private buildHeader(): void {
    const t = new Text({
      text: "QUICK MATCH",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: TITLE_SIZE,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    t.anchor.set(0.5, 0);
    t.alpha = A_HEADER;
    t.x = Math.round(this.chrome.stageW / (2 * this.chrome.s));
    t.y = TITLE_Y;
    this.chrome.headerRoot.addChild(t);
  }

  // --- map preview (left, top) --------------------------------------------

  private buildMapPreview(): void {
    // The left panel is anchored to the left edge; coordinates here are the
    // panel crop's SWF-local space (origin = SWF (0,56)).
    const root = this.chrome.leftRoot;

    this.mapImg = new Container();
    this.mapImg.x = 49.9;
    this.mapImg.y = 19.1;
    root.addChild(this.mapImg);

    this.zone(root, 69.6, 118, 34, 80, () => this.cycleMap(-1));
    this.zone(root, 391.1, 118, 34, 80, () => this.cycleMap(1));

    // `txt_maptitle`: QTypeSquare-Book 12.8, plain — the same face the "Prev" /
    // "Next" labels beside it are baked in, so it shares their baseline. It was
    // using the BlairMdITC header face at 15/700, which rendered a small-caps
    // "DOME" a line lower than the labels it sits between.
    this.mapTitle = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_VALUE, fontSize: 12.8,
      }),
    });
    this.mapTitle.alpha = A_HEADER;
    // Centred on the field (SWF x 119.8..333.0), not on the panel.
    this.mapTitle.anchor.set(0.5, 0);
    this.mapTitle.x = 226.4;
    this.mapTitle.y = 151.2;
    root.addChild(this.mapTitle);

    // `txt_mapdesc` is 365.85 wide (SWF x 49.0..414.8) and holds three lines in
    // 44px. Wrapping at 410 ran the copy past the panel's right edge.
    this.mapDesc = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_BODY, fontSize: 12,
        wordWrap: true, wordWrapWidth: 365.85, lineHeight: 14.65,
      }),
    });
    this.mapDesc.alpha = A_BODY;
    this.mapDesc.x = 49;
    this.mapDesc.y = 171.4;
    root.addChild(this.mapDesc);
  }

  private cycleMap(dir: number): void {
    Sound.play("R2_Click");
    this.levelIdx = (this.levelIdx + dir + LEVELS.length) % LEVELS.length;
    this.refreshMap();
    this.refreshWarning();
  }

  private refreshMap(): void {
    const lvl = LEVELS[this.levelIdx];
    const info = mapInfo(lvl.id, lvl.name);
    this.mapImg.removeChildren();
    // The original `img_map` still (frame label = `Stats_Maps` id) when baked,
    // the port's rendered thumb otherwise.
    const shot = UiArt.r2Sprite(`map_${String(lvl.id).replace(/^r2_/, "")}`);
    if (shot) {
      this.mapImg.addChild(shot);
    } else {
      const tex = Backgrounds.getThumb(lvl.id);
      if (tex) {
        const s = new Sprite(tex);
        s.width = 360.44;
        s.height = 128;
        this.mapImg.addChild(s);
      } else {
        const g = new Graphics();
        g.rect(0, 0, 360.44, 128).fill({ color: 0x101820, alpha: 0.9 });
        this.mapImg.addChild(g);
      }
    }
    this.mapTitle.text = info.title;
    this.mapDesc.text = info.desc;
  }

  // --- match settings (left, below map preview) ---------------------------

  /** One runtime value line, in the left panel's SWF-local coordinates. */
  private valueAt(x: number, y: number, size = 13): Text {
    const t = new Text({
      text: "",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: size }),
    });
    t.alpha = A_VALUE;
    t.x = x;
    t.y = y;
    this.chrome.leftRoot.addChild(t);
    return t;
  }

  private buildSettings(): void {
    // Values (`txt_type`, `txt_score`, `txt_weaps`, `txt_special`,
    // `txt_abilities`, `txt_equips`) and the stepper hit zones. The arrows,
    // labels and rules line are baked into the left panel. Values sit at the
    // fields' rendered ink column (origin + ~33px inset), like the campaign
    // screen.
    const root = this.chrome.leftRoot;
    this.modeValue = this.valueAt(VALUE_X, 239.6);
    // `txt_typedesc`: plain Calibri 12 in a 357.5-wide field, not an italic 11.
    this.modeDescText = new Text({
      text: "",
      style: new TextStyle({
        fill: C_LABEL, fontFamily: FONT_BODY,
        fontSize: 12, wordWrap: true, wordWrapWidth: 357.5, lineHeight: 14.65,
      }),
    });
    this.modeDescText.alpha = A_BODY;
    this.modeDescText.x = 54.6;
    this.modeDescText.y = 263.4;
    root.addChild(this.modeDescText);

    // `txt_warning` (SWF x 54.6, y 487.3, Calibri 12, #ff9999).
    this.warningText = new Text({
      text: "",
      style: new TextStyle({
        fill: C_WARNING, fontFamily: FONT_BODY,
        fontSize: 12, wordWrap: true, wordWrapWidth: 357.5, lineHeight: 14.65,
      }),
    });
    this.warningText.alpha = A_HEADER;
    this.warningText.x = 54.6;
    this.warningText.y = 431.3;
    root.addChild(this.warningText);

    this.scoreLabel = this.valueAt(52.3, 294.6);
    this.scoreValue = this.valueAt(VALUE_X, 295.6);
    this.weaponsValue = this.valueAt(VALUE_X, 323.6);
    this.specialValue = this.valueAt(VALUE_X, 351.6);
    this.abilitiesValue = this.valueAt(VALUE_X, 379.6);
    this.equipsValue = this.valueAt(VALUE_X, 407.6);

    // Stepper chevrons: `bt_<row>_prev/next` at x=194.2 / 410.4 (frame 37).
    const ZW = 44, ZH = 26;
    this.zone(root, 194.2, 234.4, ZW, ZH, () => this.cycleMode(-1));
    this.zone(root, 410.4, 234.4, ZW, ZH, () => this.cycleMode(1));
    this.zone(root, 194.2, 290.4, ZW, ZH, () => this.cycleLimit(-1));
    this.zone(root, 410.4, 290.4, ZW, ZH, () => this.cycleLimit(1));
    this.zone(root, 194.2, 318.4, ZW, ZH, () =>
      this.cyclePicker("weaponsIdx", WEAPONS.length, -1, this.weaponsValue, WEAPONS));
    this.zone(root, 410.4, 318.4, ZW, ZH, () =>
      this.cyclePicker("weaponsIdx", WEAPONS.length, 1, this.weaponsValue, WEAPONS));
    this.zone(root, 194.2, 346.4, ZW, ZH, () =>
      this.cyclePicker("specialIdx", this.specials.length, -1, this.specialValue, this.specials));
    this.zone(root, 410.4, 346.4, ZW, ZH, () =>
      this.cyclePicker("specialIdx", this.specials.length, 1, this.specialValue, this.specials));
    this.zone(root, 194.2, 374.4, ZW, ZH, () =>
      this.cyclePicker("abilitiesIdx", ONOFF.length, -1, this.abilitiesValue, ONOFF));
    this.zone(root, 410.4, 374.4, ZW, ZH, () =>
      this.cyclePicker("abilitiesIdx", ONOFF.length, 1, this.abilitiesValue, ONOFF));
    this.zone(root, 194.2, 402.4, ZW, ZH, () =>
      this.cyclePicker("equipsIdx", ONOFF.length, -1, this.equipsValue, ONOFF));
    this.zone(root, 410.4, 402.4, ZW, ZH, () =>
      this.cyclePicker("equipsIdx", ONOFF.length, 1, this.equipsValue, ONOFF));

    this.refreshLimit();
  }

  private get mt(): MatchTypeDef {
    return MATCH_TYPES[this.modeIdx];
  }

  private cycleMode(dir: number): void {
    Sound.play("R2_Click");
    this.modeIdx = (this.modeIdx + dir + MATCH_TYPES.length) % MATCH_TYPES.length;
    this.modeValue.text = this.mt.label;
    this.modeDescText.text = this.mt.desc;
    // setWinScore(true) resets to the first cycle entry on a type change
    // (doc 09 §2.4).
    this.scoreIdx = 0;
    // Clamp the team count to the new type's teamsMin/teamsMax bounds
    // (Domination forces >=2 teams, CTF locks to 2, Juggernaught forces FFA).
    this.teamsCount = Math.min(Math.max(this.teamsCount, this.mt.teamsMin), this.mt.teamsMax);
    this.refreshLimit();
    this.refreshRoster();
  }

  private cycleLimit(dir: number): void {
    Sound.play("R2_Click");
    const arr = this.mt.scores;
    this.scoreIdx = (this.scoreIdx + dir + arr.length) % arr.length;
    this.refreshLimit();
  }

  private refreshLimit(): void {
    this.scoreLabel.text = this.mt.scoreLabel;
    this.scoreValue.text = String(this.mt.scores[this.scoreIdx]);
  }

  /** Cycle one of the parity-only pickers by field name. */
  private cyclePicker(
    field: "weaponsIdx" | "specialIdx" | "abilitiesIdx" | "equipsIdx",
    len: number,
    dir: number,
    value: Text,
    labels: string[],
  ): void {
    Sound.play("R2_Click");
    this[field] = (this[field] + dir + len) % len;
    value.text = labels[this[field]];
    // Weapons and Special Mode both dock credits, so the warning re-reads.
    this.refreshWarning();
  }

  // --- add team + roster (right) ------------------------------------------

  private buildAddTeamAndRoster(): void {
    // Right panel, stretched from the left column to the stage edge (the
    // source's 435..800 roster region). Coordinates are the panel's SWF-local
    // space; the pieces that sat at its right end are pinned to `rightW`.
    const root = this.chrome.rightRoot;
    const RW = this.chrome.rightW;
    this.zone(root, 101.5, 15.8, 130, 32, () => this.addTeam());
    this.zone(root, RW - 73.5, 15.8, 130, 32, () => this.removeTeam());

    // Cover the baked "Free For All" caption (its ink sits in the box header,
    // local y ~54..80) so a team-mode title can replace it; FFA leaves the
    // baked caption untouched (we draw nothing).
    this.rosterCover = new Graphics();
    this.rosterCover.rect(30, 54, 200, 26).fill({ color: 0x1b1b1b, alpha: 0.9 });
    root.addChild(this.rosterCover);

    this.rosterTitle = new Text({
      text: "",
      style: new TextStyle({
        fill: 0x00ccff, fontFamily: FONT_HEADER, fontSize: 13,
        fontWeight: "700", letterSpacing: 1,
      }),
    });
    this.rosterTitle.alpha = A_HEADER;
    this.rosterTitle.x = 36.5;
    this.rosterTitle.y = 60.8;
    root.addChild(this.rosterTitle);

    const value = (x: number, y: number, size: number): Text => {
      const t = new Text({
        text: "",
        style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: size }),
      });
      t.alpha = A_VALUE;
      t.x = x;
      t.y = y;
      root.addChild(t);
      return t;
    };

    // `txt0_players` is right-aligned to the box's inner edge (its field ends
    // at SWF x 778.2 = RW - 21.8), not left-aligned 140px in from it.
    this.rosterCount = value(RW - 21.8, 60.8, 12);
    this.rosterCount.anchor.set(1, 0);

    this.teamExtra.x = 0;
    this.teamExtra.y = 0;
    root.addChild(this.teamExtra);

    // Players | Difficulty values sit centred between their baked chevrons
    // (`bt0_bots_*` / `bt0_diff_*`), not on top of them. Field centres are
    // `mc_bots` (467.3, 111.8) + the field's own box.
    this.playersValue = value(140.4, 119.7, 12);
    this.playersValue.anchor.set(0.5, 0);
    this.diffValue = value(RW - 67.5, 119.7, 12);
    this.diffValue.anchor.set(0.5, 0);

    // Team-0 steppers (bt0_bots_* / bt0_diff_*). The players pair stays at the
    // row's left end; the difficulty pair pins to the stretched panel's right.
    this.zone(root, 103, 115.7, 36, 22, () => this.stepOpponents(-1));
    this.zone(root, 175.7, 115.7, 36, 22, () => this.stepOpponents(1));
    this.zone(root, RW - 116, 115.2, 36, 22, () => this.cycleDiff(-1));
    this.zone(root, RW - 24.9, 115.2, 36, 22, () => this.cycleDiff(1));

    this.refreshRoster();
  }

  /** Cycle the team count within [teamsMin, teamsMax] for the current type. */
  private addTeam(): void {
    const mt = this.mt;
    if (mt.teamsMin === mt.teamsMax) {
      Sound.play("R2_Error");
      return;
    }
    Sound.play("R2_Click");
    this.teamsCount = this.teamsCount >= mt.teamsMax ? mt.teamsMin : this.teamsCount + 1;
    this.refreshRoster();
  }

  /** Cycle the team count downward (the original "Remove Team"). */
  private removeTeam(): void {
    const mt = this.mt;
    if (mt.teamsMin === mt.teamsMax) {
      Sound.play("R2_Error");
      return;
    }
    Sound.play("R2_Click");
    this.teamsCount = this.teamsCount <= mt.teamsMin ? mt.teamsMax : this.teamsCount - 1;
    this.refreshRoster();
  }

  /** Reflect the current type's team model + roster counts (doc 09 §4). */
  private refreshRoster(): void {
    const mt = this.mt;
    if (this.teamsCount <= 1) {
      // The baked "Free For All" caption already says it.
      this.rosterTitle.text = "";
      this.rosterTitle.visible = false;
      this.rosterCover.visible = false;
    } else {
      this.rosterTitle.visible = true;
      this.rosterTitle.text = mt.key === "jug" ? "JUGGERNAUGHT" : `${this.teamsCount} TEAMS`;
      // Size the cover to the title so it reads as a labelled plate rather
      // than a fixed-width band.
      this.rosterCover.visible = true;
      this.rosterCover.clear();
      this.rosterCover
        .rect(30, 54, Math.max(120, this.rosterTitle.width + 18), 26)
        .fill({ color: 0x1b1b1b, alpha: 0.9 });
    }
    const total = Math.min(12, this.opponents + 1);
    this.rosterCount.text = `${total} / 12 Players`;
    this.playersValue.text = String(this.opponents);
    this.diffValue.text = DIFFS[this.diffIdx].label;
    this.paintRosterRows();
  }

  /**
   * Team composition summary, drawn in the box's name row (`txt_playername`,
   * `mc_bots`-local (9.5, 36.6) = panel-local (41.8, 92.4), pale yellow
   * #ffff99). The SWF clones a whole team block per team (`mc_bots` frames
   * 2..4); the port keeps one compact stretched box, so two teams get a line
   * each and 3-4 share one.
   *
   * Free For All is a row too — the source shows "Player + N bots" there. The
   * port used to skip it entirely, leaving the baked name plate blank.
   */
  private paintRosterRows(): void {
    this.teamExtra.removeChildren();
    const line = (text: string, fill: number, i: number): void => {
      const t = new Text({
        text,
        style: new TextStyle({ fill, fontFamily: FONT_VALUE, fontSize: 12 }),
      });
      t.alpha = A_VALUE;
      t.x = ROSTER_NAME_X;
      t.y = ROSTER_NAME_Y + i * 13;
      this.teamExtra.addChild(t);
    };
    const diff = DIFFS[this.diffIdx].label;
    if (this.teamsCount <= 1) {
      line(`Player + ${this.opponents} bots`, C_PLAYERNAME, 0);
      return;
    }
    const teams = Math.min(4, this.teamsCount);
    const share = this.distributeBots();
    if (teams <= 2) {
      for (let i = 0; i < teams; i++) {
        line(`Team ${i + 1}:  ${share[i]} bots   ·   Diff ${diff}`,
          TEAM_COLORS[i % TEAM_COLORS.length], i);
      }
      return;
    }
    line(`${teams} TEAMS  ·  ${share.join(" / ")} bots   ·   Diff ${diff}`, TEAM_COLORS[0], 0);
  }

  /** Even bot split across the active teams (the Match draft seats them alike). */
  private distributeBots(): number[] {
    const teams = Math.max(1, Math.min(4, this.teamsCount));
    const out: number[] = [];
    let left = this.opponents;
    for (let i = 0; i < teams; i++) {
      const n = Math.round(left / (teams - i));
      out.push(n);
      left -= n;
    }
    return out;
  }

  private stepOpponents(dir: number): void {
    Sound.play("R2_Click");
    this.opponents = ((this.opponents - 1 + dir + 7) % 7) + 1;
    this.playersValue.text = String(this.opponents);
    this.refreshRoster();
  }

  private cycleDiff(dir: number): void {
    Sound.play("R2_Click");
    this.diffIdx = (this.diffIdx + dir + DIFFS.length) % DIFFS.length;
    this.diffValue.text = DIFFS[this.diffIdx].label;
    this.paintRosterRows();
  }

  // --- bottom bar --------------------------------------------------------

  private buildBottomBar(): void {
    // Anchored to the bottom of the layout box: Back bottom-left, the action
    // pair bottom-right, exactly the source order. These are the screen's own
    // children rather than the chrome's, so they carry `ox` themselves.
    // `bottomY` is SWF y 516. The three plates are 28 tall and their `btn_*`
    // placements are their *centres*, so each top is (placement y - 14):
    // Back 543.85 -> 529.85, Upgrades 521.85 -> 507.85, Start 548.85 -> 534.85.
    // Upgrades and Start were being placed at their centres, which dropped both
    // 14px and pushed Start off the bottom of the bar.
    //
    // `btn_menu_*` is baked at its native 245x28 **SWF** px, and a Raze2Button
    // lays its plate and label out in those units — but these buttons are
    // children of the unscaled screen root, so the size has to arrive through
    // `view.scale`, not by pre-multiplying width/height (which would stretch the
    // plate without growing the label). Unscaled, the 245-wide plate rendered
    // 172 SWF px wide and the right pair's labels stopped ~70px short.
    const { s, stageW, ox, bottomY } = this.chrome;
    // 245x28 and a ~14pt label are the source's own numbers (`txt_word` ink is
    // 11px tall in the frame-37 render); `view.scale` carries them to screen.
    const btnW = 245, btnH = 28, btnFont = 14;
    const place = (b: Raze2Button, x: number, y: number): void => {
      b.view.scale.set(s);
      b.view.x = x;
      b.view.y = y;
      b.view.on("pointerover", () => Sound.play("R2_Click"));
      this.view.addChild(b.view);
    };

    const back = new Raze2Button("Back to Menu", {
      width: btnW, height: btnH, fontSize: btnFont,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    place(back, ox + 37 * s, bottomY + 13.85 * s);

    // Secondary path: keep the online lobby reachable. The SWF has no online
    // screen, so this is a compact link tucked under the title strip.
    const online = new Text({
      text: "ONLINE MATCH",
      style: new TextStyle({
        fill: C_ACCENT_SECONDARY, fontFamily: FONT_HEADER, fontSize: 13 * s,
        fontWeight: "700", letterSpacing: 2,
      }),
    });
    online.alpha = A_LABEL;
    online.x = ox + 14 * s;
    online.y = 12 * s;
    online.eventMode = "static";
    online.cursor = "pointer";
    online.on("pointerover", () => (online.alpha = 1));
    online.on("pointerout", () => (online.alpha = A_LABEL));
    online.on("pointertap", () => {
      Sound.play("R2_Click");
      this.engine.setScreen(MultiplayerScreen, undefined, "slideLeft");
    });
    this.view.addChild(online);

    const rightX = ox + stageW - 281.9 * s;

    // The right pair are the mirrored plate (`MenuButtonReverse`): the bracket
    // is on the right and the label is right-aligned to it, 15px in from the
    // plate edge — measured ink x 677..748 against a plate ending at 763.
    const upgrades = new Raze2Button("Upgrades", {
      width: btnW, height: btnH, fontSize: btnFont, reverse: true,
      onClick: () => {
        Sound.play("R2_Click");
        this.engine.setScreen(ArmoryScreen, undefined, "slideLeft");
      },
    });
    place(upgrades, rightX, bottomY - 8.15 * s);

    const start = new Raze2Button("Start Game", {
      width: btnW, height: btnH, fontSize: btnFont, reverse: true,
      onClick: () => void this.start(),
    });
    place(start, rightX, bottomY + 18.85 * s);
  }

  private async start(): Promise<void> {
    Sound.resume();
    Sound.play("R2_ClickGo");
    const mt = this.mt;
    const teams = this.teamsCount;
    const value = mt.scores[this.scoreIdx];
    SD.matchSettings = {
      type: engineType(mt, teams),
      diff: DIFFS[this.diffIdx].value,
      egoMode: DIFFS[this.diffIdx].label === "Ego",
      opponents: this.opponents,
      level: LEVELS[this.levelIdx].id,
      score: mt.key === "elim" ? 0 : value,
      lives: mt.key === "elim" ? value : 0,
      team: teams > 1 ? 1 : 0,
      teams,
      ff: this.friendlyFire,
      dmgMod: [0.5, 1, 1.5, 3][this.dmgIdx] ?? 1,
      // --- wired match settings (doc 11 §2/§6/§7) ---
      specialMode: this.specials[this.specialIdx] ?? "None",
      weaponsUsed: WEAPONS[this.weaponsIdx] ?? "All",
      abilitiesOn: this.abilitiesIdx === 1,
      // Equipment gate is read by Equipment.equipmentEnabled() as `equipment`.
      equipment: this.equipsIdx === 1,
      // Spawn holding the first gun in the armory loadout; there is no
      // pre-match weapon picker.
      loadoutGun: loadoutGuns()[0] ?? "pistol",
    };
    this.view.addChild(makeVeil("LOADING MAP…"));
    await preloadLevel(String(SD.matchSettings.level));
    this.engine.setScreen(GameScreen);
  }

  enterFrame(): void {
    // Static configuration screen.
  }
}
