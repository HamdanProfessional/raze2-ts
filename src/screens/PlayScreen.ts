import { Container, Graphics, Rectangle, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Backgrounds } from "../assets/Backgrounds";
import { LEVELS, preloadLevel } from "../game/Arena";
import { loadoutGuns } from "../game/Armory";
import { GameScreen } from "../game/GameScreen";
import { MenuScreen } from "./MenuScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import { MultiplayerScreen } from "./MultiplayerScreen";
import { makeBackground, makeScrim, makeVeil } from "./ui";
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

  private modeValue!: Text;
  private modeDescText!: Text;
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
  private rosterSubline!: Text;
  private addTeamBtn!: Raze2Button;
  /** Repainted slot rows (player + bots) inside the roster panel. */
  private rosterRows = new Container();
  private rosterRowW = 0;
  private rosterRowsH = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    // The reference screenshot's backdrop is a bright painted vista, not the
    // flat dark grid the port previously used here — per-level gameplay art
    // (tried and reverted) is mostly black negative space and reads worse,
    // not better, stretched fullscreen. `menu.jpg` (the same warm sunset
    // skyline the Menu/Campaign chrome uses) is the closest available asset
    // in tone/brightness, so Quick Match now shares it with a lighter scrim
    // instead of the near-opaque black wash.
    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x000000, 0.25));

    // Title and the top-right helper share one centre line (HEADER_CY) so they
    // read as a single bar; top-aligning two different font sizes did not.
    this.header("QUICK MATCH", 60, HEADER_CY);
    this.buildWhatIsThis(HEADER_CY);

    this.buildMapPreview();
    this.buildSettings();
    this.buildAddTeamAndRoster();
    this.buildBottomBar();

    this.refreshMap();
  }

  /** Screen title, vertically centred on `cy`. */
  private header(text: string, x: number, cy: number): void {
    const t = new Text({
      text,
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 30,
        fontWeight: "700",
        letterSpacing: 3,
      }),
    });
    t.anchor.set(0, 0.5);
    t.alpha = A_HEADER;
    t.x = x;
    t.y = cy;
    this.view.addChild(t);
  }

  /** Top-right "What is this ?" helper (doc 09 screenshot #4). Colour-swap
   *  only — the real dialog content could not be recovered from the
   *  decompiled AS3 (doc 09 §3, no matching Menu.as string/trigger found). */
  private buildWhatIsThis(cy: number): void {
    const help = new Text({
      text: "What is this  ?",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 15, letterSpacing: 1 }),
    });
    help.anchor.set(1, 0.5);
    help.alpha = A_LABEL;
    help.x = GAME_WIDTH - 60;
    help.y = cy;
    help.eventMode = "static";
    help.cursor = "pointer";
    help.on("pointerover", () => {
      help.style.fill = C_OPTIONS_GREEN;
      Sound.play("R2_Click");
    });
    help.on("pointerout", () => (help.style.fill = C_LABEL));
    this.view.addChild(help);
  }

  // --- map preview (left, top) --------------------------------------------

  private buildMapPreview(): void {
    const x = 60;
    const y = 90;
    const w = 440;
    const h = 230;

    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    const imgW = 400;
    const imgH = 130;
    this.mapImg = new Container();
    this.mapImg.x = x + 20;
    this.mapImg.y = y + 20;
    this.view.addChild(this.mapImg);

    // Faint Prev / Next chevrons straddling the image itself, vertically
    // centred on it (reference screenshot shows these as a subtle hover
    // affordance on the image edges, distinct from the text labels below).
    // Centred on the image's own left/right edges, so the pair is symmetric
    // about the panel instead of the left one sitting 11px further in.
    const arrowY = y + 20 + imgH / 2;
    this.view.addChild(this.arrow("‹", x + 20, arrowY, () => this.cycleMap(-1)));
    this.view.addChild(this.arrow("›", x + w - 20, arrowY, () => this.cycleMap(1)));

    // "Prev  <Map Name>  Next" row directly under the image — matches the
    // reference layout (small caps Prev/Next flanking the bold centred map
    // title), rather than just a left-aligned heading.
    // All three share `rowCy` as their vertical centre rather than each being
    // nudged by a hand-tuned offset off a common top edge.
    const rowY = y + 20 + imgH + 10;
    const rowCy = rowY + 12;
    const prevLabel = new Text({
      text: "Prev",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 13, letterSpacing: 1 }),
    });
    prevLabel.anchor.set(0, 0.5);
    prevLabel.alpha = A_LABEL;
    prevLabel.x = x + 20;
    prevLabel.y = rowCy;
    prevLabel.eventMode = "static";
    prevLabel.cursor = "pointer";
    prevLabel.on("pointertap", () => this.cycleMap(-1));
    prevLabel.on("pointerover", () => (prevLabel.style.fill = C_OPTIONS_GREEN));
    prevLabel.on("pointerout", () => (prevLabel.style.fill = C_LABEL));
    this.view.addChild(prevLabel);

    const nextLabel = new Text({
      text: "Next",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 13, letterSpacing: 1 }),
    });
    nextLabel.anchor.set(1, 0.5);
    nextLabel.alpha = A_LABEL;
    nextLabel.x = x + w - 20;
    nextLabel.y = rowCy;
    nextLabel.eventMode = "static";
    nextLabel.cursor = "pointer";
    nextLabel.on("pointertap", () => this.cycleMap(1));
    nextLabel.on("pointerover", () => (nextLabel.style.fill = C_OPTIONS_GREEN));
    nextLabel.on("pointerout", () => (nextLabel.style.fill = C_LABEL));
    this.view.addChild(nextLabel);

    this.mapTitle = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 20,
        fontWeight: "700",
        letterSpacing: 1,
      }),
    });
    this.mapTitle.anchor.set(0.5);
    this.mapTitle.alpha = A_HEADER;
    this.mapTitle.x = x + w / 2;
    this.mapTitle.y = rowCy;
    this.view.addChild(this.mapTitle);

    this.mapDesc = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_BODY,
        fontSize: 12,
        wordWrap: true,
        wordWrapWidth: imgW,
        lineHeight: 16,
      }),
    });
    this.mapDesc.alpha = A_BODY;
    this.mapDesc.x = x + 20;
    this.mapDesc.y = rowY + 30;
    this.view.addChild(this.mapDesc);
  }

  private cycleMap(dir: number): void {
    Sound.play("R2_Click");
    this.levelIdx = (this.levelIdx + dir + LEVELS.length) % LEVELS.length;
    this.refreshMap();
  }

  private refreshMap(): void {
    const lvl = LEVELS[this.levelIdx];
    const info = mapInfo(lvl.id, lvl.name);
    this.mapImg.removeChildren();
    const w = 400;
    const h = 130;
    const tex = Backgrounds.getThumb(lvl.id);
    if (tex) {
      const s = new Sprite(tex);
      s.width = w;
      s.height = h;
      this.mapImg.addChild(s);
    } else {
      const g = new Graphics();
      g.rect(0, 0, w, h).fill({ color: 0x101820, alpha: 0.9 });
      this.mapImg.addChild(g);
    }
    const frame = new Graphics();
    frame.rect(0, 0, w, h).stroke({ color: C_OPTIONS_GREEN, width: 1, alpha: 0.6 });
    this.mapImg.addChild(frame);
    this.mapTitle.text = info.title;
    this.mapDesc.text = info.desc;
  }

  // --- match settings (left, below map preview) ---------------------------

  private buildSettings(): void {
    const x = 60;
    const y = 330;
    const w = 440;
    const h = GAME_HEIGHT - 52 - 20 - y;

    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    const title = new Text({
      text: "MATCH SETTINGS",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 2,
      }),
    });
    title.alpha = A_HEADER;
    title.x = x + 20;
    title.y = y + 14;
    this.view.addChild(title);

    const lx = x + 20;
    const lw = w - 40;

    // Six rows plus the italic rules line, spread evenly over the panel's
    // usable height instead of stacked on a fixed 27px pitch that left a hole
    // at the bottom.
    const rowsTop = y + 44;
    const rowsBottom = y + h - 14;
    const DESC_H = 28;
    const step = Math.floor((rowsBottom - rowsTop - DESC_H) / 6);
    let ly = rowsTop;

    this.modeValue = this.stepper(lx, ly, lw, "Match Type", () => this.mt.label,
      () => this.cycleMode(-1), () => this.cycleMode(1));

    this.modeDescText = new Text({
      text: this.mt.desc,
      style: new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_BODY,
        fontStyle: "italic",
        fontSize: 11,
        wordWrap: true,
        wordWrapWidth: lw,
        lineHeight: 13,
      }),
    });
    this.modeDescText.alpha = A_BODY;
    this.modeDescText.x = lx;
    this.modeDescText.y = ly + ROW_H + 2;
    this.view.addChild(this.modeDescText);
    ly += step + DESC_H;

    // Kills to Win / Lives / Points to Win (label + value both vary by type).
    this.scoreLabel = this.rowLabel(this.mt.scoreLabel, lx, ly);
    this.scoreValue = this.stepperValue(lx, ly, lw,
      () => this.cycleLimit(-1), () => this.cycleLimit(1));
    ly += step;

    this.weaponsValue = this.stepper(lx, ly, lw, "Weapons", () => WEAPONS[this.weaponsIdx],
      () => this.cyclePicker("weaponsIdx", WEAPONS.length, -1, this.weaponsValue, WEAPONS),
      () => this.cyclePicker("weaponsIdx", WEAPONS.length, 1, this.weaponsValue, WEAPONS));
    ly += step;

    this.specialValue = this.stepper(lx, ly, lw, "Special Mode", () => this.specials[this.specialIdx],
      () => this.cyclePicker("specialIdx", this.specials.length, -1, this.specialValue, this.specials),
      () => this.cyclePicker("specialIdx", this.specials.length, 1, this.specialValue, this.specials));
    ly += step;

    this.abilitiesValue = this.stepper(lx, ly, lw, "Abilities", () => ONOFF[this.abilitiesIdx],
      () => this.cyclePicker("abilitiesIdx", ONOFF.length, -1, this.abilitiesValue, ONOFF),
      () => this.cyclePicker("abilitiesIdx", ONOFF.length, 1, this.abilitiesValue, ONOFF));
    ly += step;

    this.equipsValue = this.stepper(lx, ly, lw, "Equipment", () => ONOFF[this.equipsIdx],
      () => this.cyclePicker("equipsIdx", ONOFF.length, -1, this.equipsValue, ONOFF),
      () => this.cyclePicker("equipsIdx", ONOFF.length, 1, this.equipsValue, ONOFF));

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
  }

  // --- add team + roster (right) ------------------------------------------

  private buildAddTeamAndRoster(): void {
    const x = 560;
    const w = GAME_WIDTH - x - 60;

    // "Add Team" cycles the team count within the current type's
    // teamsMin/teamsMax bounds (doc 09 §2.4); disabled where those bounds
    // collapse to a single value (Juggernaught = FFA-only, CTF = locked at 2).
    // (Labelled without the "+" glyph — the embedded BlairMdITC subset renders
    // that codepoint as a stray "1" — see the button label, not a logic bug.)
    const addTeam = new Raze2Button("Add Team", {
      width: 220,
      height: 32,
      onClick: () => this.addTeam(),
    });
    addTeam.view.x = x;
    addTeam.view.y = 90;
    addTeam.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(addTeam.view);
    this.addTeamBtn = addTeam;

    // The roster panel runs to the same baseline as the left column's Match
    // Settings panel; it used to stop at 368 and leave a 200px hole above the
    // bottom bar.
    const rosterY = 138;
    const rosterH = GAME_HEIGHT - 52 - 20 - rosterY;
    const panel = new Raze2Panel(w, rosterH, { accent: C_TEAM1 });
    panel.view.x = x;
    panel.view.y = rosterY;
    this.view.addChild(panel.view);

    const title = new Text({
      text: "FREE FOR ALL",
      style: new TextStyle({
        fill: 0x00ccff,
        fontFamily: FONT_HEADER,
        fontSize: 16,
        fontWeight: "700",
        letterSpacing: 2,
      }),
    });
    // Title and count sit on one shared centre line; they used to be top-
    // aligned at different font sizes, which read as a 3px stagger.
    const headCy = rosterY + 25;
    title.anchor.set(0, 0.5);
    title.x = x + 20;
    title.y = headCy;
    this.view.addChild(title);
    this.rosterTitle = title;

    const count = new Text({
      text: "",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    count.anchor.set(1, 0.5);
    count.alpha = A_VALUE;
    count.x = x + w - 20;
    count.y = headCy;
    this.view.addChild(count);
    this.rosterCount = count;

    const subline = new Text({
      text: "",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_BODY, fontSize: 13 }),
    });
    subline.alpha = A_BODY;
    subline.x = x + 20;
    subline.y = rosterY + 46;
    this.view.addChild(subline);
    this.rosterSubline = subline;

    // Slot list: one row per body in the match, filling the panel between the
    // header and the stepper row.
    this.rosterRows.x = x + 20;
    this.rosterRows.y = rosterY + 78;
    this.view.addChild(this.rosterRows);
    this.rosterRowW = w - 40;

    // Players | Difficulty twin stepper row, pinned to the panel's bottom on
    // the same 20px margin the rest of the panel uses.
    const rowY = rosterY + rosterH - 20 - ROW_H;
    this.rosterRowsH = rowY - 16 - this.rosterRows.y;
    const rowW = w - 40;
    const halfW = rowW / 2 - 10;
    this.playersValue = this.stepper(x + 20, rowY, halfW, "Players:", () => String(this.opponents),
      () => this.stepOpponents(-1), () => this.stepOpponents(1), 130);
    this.diffValue = this.stepper(x + 20 + halfW + 20, rowY, halfW, "Difficulty:", () => DIFFS[this.diffIdx].label,
      () => this.cycleDiff(-1), () => this.cycleDiff(1), 130);

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

  /** Reflect the current type's team model + roster counts (doc 09 §4). */
  private refreshRoster(): void {
    const mt = this.mt;
    if (this.teamsCount <= 1) {
      this.rosterTitle.text = mt.key === "jug" ? "JUGGERNAUGHT (FFA)" : "FREE FOR ALL";
    } else {
      this.rosterTitle.text = `${this.teamsCount} TEAMS`;
    }
    const total = Math.min(12, this.opponents + 1);
    this.rosterCount.text = `${total} / 12 PLAYERS`;
    this.rosterSubline.text = this.opponents > 0 ? `Player (with ${this.opponents} bot${this.opponents === 1 ? "" : "s"})` : "Player";
    // Dim "+ Add Team" where the type's bounds leave no room to change teams.
    this.addTeamBtn.view.alpha = mt.teamsMin === mt.teamsMax ? 0.4 : 1;
    this.paintRosterRows();
  }

  /**
   * One row per body in the match: the player first, then each bot, tagged with
   * the team they'd be drafted into (round-robin, as `Match` seats them), then
   * dim placeholders for the slots the Players stepper could still fill. Fills
   * the roster panel, which used to be a 200px hole above the bottom bar.
   */
  private paintRosterRows(): void {
    this.rosterRows.removeChildren();
    const w = this.rosterRowW;
    // The Players stepper tops out at 7 opponents, so 8 seats is the ceiling.
    // Stretch the pitch to fill the panel rather than leaving a 65px hole
    // under a fixed 30px one.
    const capacity = 8;
    const pitch = Math.max(28, Math.min(40, Math.floor(this.rosterRowsH / capacity)));
    const rowH = pitch - 4;
    const teams = Math.max(1, this.teamsCount);
    const slots = Math.min(capacity, this.opponents + 1);

    for (let i = 0; i < capacity; i++) {
      const taken = i < slots;
      const team = teams > 1 ? (i % teams) + 1 : 0;
      const color = !taken ? C_DIM : teams > 1 ? TEAM_COLORS[(team - 1) % TEAM_COLORS.length] : 0x00ccff;

      const row = new Container();
      row.y = i * pitch;

      const bg = new Graphics();
      bg.rect(0, 0, w, rowH).fill({ color, alpha: !taken ? 0.04 : i === 0 ? 0.16 : 0.07 });
      bg.rect(0, 0, 3, rowH).fill({ color, alpha: taken ? 0.9 : 0.3 });
      row.addChild(bg);

      const name = new Text({
        text: !taken ? "Empty" : i === 0 ? (SD.profile?.name ?? "Player") : `Bot ${i}`,
        style: new TextStyle({
          fill: !taken ? C_DIM : i === 0 ? C_VALUE : C_LABEL,
          fontFamily: FONT_VALUE,
          fontSize: 14,
          fontStyle: taken ? "normal" : "italic",
        }),
      });
      name.anchor.set(0, 0.5);
      name.alpha = !taken ? 0.45 : i === 0 ? A_VALUE : A_LABEL;
      name.x = 14;
      name.y = rowH / 2;
      row.addChild(name);

      const tag = new Text({
        text: !taken ? "" : teams > 1 ? `TEAM ${team}` : i === 0 ? "YOU" : "BOT",
        style: new TextStyle({ fill: color, fontFamily: FONT_VALUE, fontSize: 11, letterSpacing: 1 }),
      });
      tag.anchor.set(1, 0.5);
      tag.alpha = 0.85;
      tag.x = w - 12;
      tag.y = rowH / 2;
      row.addChild(tag);

      this.rosterRows.addChild(row);
    }
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
  }

  // --- stepper widgets ------------------------------------------------------

  /** Label on the left of a stepper row, vertically centred in {@link ROW_H}. */
  private rowLabel(text: string, x: number, y: number): Text {
    const t = new Text({
      text,
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    t.anchor.set(0, 0.5);
    t.alpha = A_LABEL;
    t.x = x;
    t.y = y + ROW_H / 2;
    this.view.addChild(t);
    return t;
  }

  /** A full stepper row: label on the left, [‹ value ›] on the right.
   *  `clusterW` narrows the arrow/value cluster for half-width twin rows. */
  private stepper(
    x: number,
    y: number,
    w: number,
    label: string,
    getValue: () => string,
    onPrev: () => void,
    onNext: () => void,
    clusterW = CLUSTER_W,
  ): Text {
    this.rowLabel(label, x, y);
    const value = this.stepperValue(x, y, w, onPrev, onNext, clusterW);
    value.text = getValue();
    return value;
  }

  /**
   * Just the [‹ value ›] cluster, right-aligned within the row width.
   *
   * Everything in the row shares one vertical centre (`y + ROW_H / 2`) and the
   * value sits at the exact midpoint of the two arrow centres, so a row reads
   * as one horizontal band rather than three separately-offset pieces.
   */
  private stepperValue(
    x: number,
    y: number,
    w: number,
    onPrev: () => void,
    onNext: () => void,
    clusterW = CLUSTER_W,
  ): Text {
    const cy = y + ROW_H / 2;
    const rightX = x + w;
    const narrow = clusterW < CLUSTER_W;
    // Inset each arrow by half a hit box so the cluster ends exactly on the
    // row's right edge instead of overhanging it.
    const prevCx = rightX - clusterW + ARROW_BOX / 2;
    const nextCx = rightX - ARROW_BOX / 2;
    this.view.addChild(this.arrow("‹", prevCx, cy, onPrev, narrow ? 16 : 18));
    this.view.addChild(this.arrow("›", nextCx, cy, onNext, narrow ? 16 : 18));

    const value = new Text({
      text: "",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: narrow ? 13 : 15 }),
    });
    value.anchor.set(0.5);
    value.x = (prevCx + nextCx) / 2;
    value.y = cy;
    value.alpha = A_VALUE;
    this.view.addChild(value);
    return value;
  }

  /** A clickable chevron centred on (`cx`, `cy`), with a hit box big enough to
   *  actually aim at — the bare glyph is only a few px wide. */
  private arrow(glyph: string, cx: number, cy: number, onClick: () => void, size = 22): Container {
    const c = new Container();
    c.x = cx;
    c.y = cy;
    const t = new Text({
      text: glyph,
      style: new TextStyle({
        fill: C_OPTIONS_GREEN,
        fontFamily: FONT_HEADER,
        fontSize: size,
        fontWeight: "700",
      }),
    });
    t.anchor.set(0.5);
    c.addChild(t);
    const box = Math.max(ARROW_BOX, size + 6);
    c.hitArea = new Rectangle(-box / 2, -box / 2, box, box);
    c.eventMode = "static";
    c.cursor = "pointer";
    c.on("pointerover", () => (t.alpha = 1));
    c.on("pointerout", () => (t.alpha = 0.8));
    c.on("pointertap", onClick);
    t.alpha = 0.8;
    return c;
  }

  // --- bottom bar --------------------------------------------------------

  private buildBottomBar(): void {
    const y = GAME_HEIGHT - 52;

    const back = new Raze2Button("Back to Menu", {
      width: 200,
      height: 40,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    back.view.x = 60;
    back.view.y = y;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);

    // Secondary path: keep the online lobby reachable, tucked next to Back.
    const online = new Raze2Button("Online Match", {
      width: 180,
      height: 40,
      accent: C_ACCENT_SECONDARY,
      onClick: () => {
        Sound.play("R2_Click");
        this.engine.setScreen(MultiplayerScreen, undefined, "slideLeft");
      },
    });
    online.view.x = 300;
    online.view.y = y;
    online.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(online.view);

    // Right-hand pair is pinned to the same 60px margin the left column uses,
    // so the bar reads as symmetric rather than crowding the stage edge.
    const startW = 240;
    const upgradesW = 180;
    const startX = GAME_WIDTH - 60 - startW;

    const upgrades = new Raze2Button("Upgrades", {
      width: upgradesW,
      height: 40,
      accent: C_ACCENT_UPGRADE,
      onClick: () => {
        Sound.play("R2_Click");
        this.engine.setScreen(ArmoryScreen, undefined, "slideLeft");
      },
    });
    upgrades.view.x = startX - 20 - upgradesW;
    upgrades.view.y = y;
    upgrades.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(upgrades.view);

    const start = new Raze2Button("Start Game", {
      width: startW,
      height: 40,
      accent: C_OPTIONS_GREEN,
      onClick: () => void this.start(),
    });
    start.view.x = startX;
    start.view.y = y;
    start.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(start.view);
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
