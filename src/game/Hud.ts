import { CanvasTextMetrics, Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, FPS } from "../core/Config";
import { ArmArt } from "../assets/ArmArt";
import { SkinArt } from "../assets/SkinArt";
import { GUN_ORDER, WEAPONS } from "./weapons";
import { SPREE_TIERS } from "./Score";
import { SD } from "../state/SD";
import { Quality } from "../state/Quality";
import type { GameScreen } from "./GameScreen";
import { FONT_VALUE } from "../ui/raze2";
import {
  FONT,
  C_TEXT,
  C_DIM,
  C_FAINT,
  C_ACCENT,
  C_DANGER,
  C_VICTORY,
  C_SHIELD_YELLOW,
  C_ENERGY_PURPLE,
  C_SLOT_SELECTED,
  C_SLOT_UNSELECTED,
  C_AMMO_WHITE,
  C_GLOW_CYAN,
  C_TEAL,
  C_BEZEL,
  C_BEZEL_HI,
  DamageIndicator,
  SCORE_BAR_W,
  SCORE_BAR_H,
  bezelTile,
  clamp01,
  drawClipTicks,
  drawHeartbeat,
  healthTint,
  measureMono,
  mkText,
  modePlate,
  panel,
  razeGlass,
  rule,
  scoreBar,
  teamColorOf,
} from "./HudComponents";

/**
 * Heads-up display, laid out after the authentic Raze 2 `Hud.as` frame-1
 * placement (docs/raze2/14-hud-chrome.md). The original is authored on an
 * 800x600 stage, so every figure below is that geometry re-proportioned onto
 * this port's 1136x639 stage — the original's relative arrangement, not its raw
 * pixels.
 *
 *   - **BOTTOM-LEFT — "am I alive, can I shoot?"** One dark-glass slab closed
 *     off by the angled tail that runs it into the weapon rack, holding (left to
 *     right) the current weapon's glyph, the magazine tick bar with its "xN"
 *     spare-clip multiplier, the vertical shield and energy columns, and the
 *     animated ECG heartbeat monitor with the "N%" read-out.
 *   - **BOTTOM-RIGHT — "what else have I got?"** Seven fixed `gun0..gun6`
 *     weapon-holder tiles, right-aligned; owned weapons fill them left to right,
 *     the selected one takes the #FFFF00 accent (doc 14 §1.3).
 *   - **BOTTOM STRIP — "how rich am I?"** The full-width credits footer:
 *     "Earned: N cr", the cyan char-1478 glow bars flanking the "Credits"
 *     caption, and the wallet "Total: N cr".
 *   - **TOP-RIGHT — "who is winning?"** The score header (doc 14 §1.5): the
 *     gametype caption and its skull disc over two `score / winScore` race rows,
 *     the leader marked with the original's `"> "` prefix.
 *   - **TOP-LEFT** — the campaign story box (`mc_msg`, doc 14 §1.7): portrait,
 *     speaker and one scripted line while a mission talks to you.
 *   - **RIGHT EDGE — "what just happened?"** The kill feed (doc-accurate
 *     colours, 13-line cap), under the Juggernaut banner.
 *   - **CENTRE** — the match clock, banner, announcements, the directional
 *     damage indicator and the respawn prompt.
 *
 * There is deliberately no minimap and no always-on leaderboard: neither exists
 * in the original, and full standings are one Tab away on the score overlay.
 *
 * The single, weapon-agnostic crosshair with recoil-driven bloom lives in
 * Crosshair.ts (owned by GameScreen, drawn above this HUD).
 *
 * Static chrome is drawn once into `chromeG`; only fills, bars and glyphs are
 * redrawn per frame into `dynG`. Weapon glyphs use the real trimmed weapon-arm
 * sprite (`ArmArt.getIcon`) at the original's -0.408 rad tilt.
 */

const M = 12; // screen margin

// --- bottom credits strip (doc 14 §1.4) ------------------------------------
// A full-width footer rather than the original's two loose text fields, since
// on a 1136-wide stage the pair would otherwise float in open space.
const CRED_H = 22;
const CRED_BAR_H = 8;
const EARN_LABEL_X = 8;
const EARN_VALUE_X = 170;
const CRED_BAR1_X = 188;

// --- bottom row: vitals slab + weapon rack ---------------------------------
const ROW_H = 60;

const VIT_W = 406;
/** The angled grey wedge that closes the slab off toward the weapon rack. */
const VIT_TAIL = 74;

const GUN_X = 8;
const GUN_W = 64;
const GUN_H = 40;

const CLIP_X = 84;
const CLIP_W = 94;
const CLIP_H = 28;

/** Shield: vertical, 33px max (`bar_shield.height = shPerc * 33`, doc 14 §1.1). */
const SH_W = 8;
const SH_X = 184;
const SH_MAX_H = 33;
/** The original's energy bar is horizontal and 130px wide, which will not fit
 *  this slab, so it rides beside the shield as a second column of the same
 *  height — same information, same purple, a quarter of the width. */
const EN_X = 194;

const EKG_X = 206;
const EKG_W = 192;
const EKG_H = 46;
/** Left column of the monitor is the "N%" read-out; the trace starts after it. */
const EKG_TEXT_W = 54;

// --- weapon rack (doc 14 §1.3) --------------------------------------------
// Seven `gun0..gun6` holders, one per armory slot and per number-row key.
const RACK_SLOTS = 7;
/** 58 + 7 = the original's 65px slot pitch (`gun0..gun6`, doc 14 §1.3). */
const SLOT_GAP = 7;
const SLOT_W = 58;
const SLOT_H = 62;
const RACK_W = RACK_SLOTS * SLOT_W + (RACK_SLOTS - 1) * SLOT_GAP;

// --- top-right score header (doc 14 §1.5) ----------------------------------
/** `mc_gametype`: a light plate carrying the mode glyph, hard against the right. */
const ICON_SZ = 34;
const ICON_Y = M + 15;
/** `scorebars`: two stacked race bars, `score / winScore` of the track. */
const SB_W = SCORE_BAR_W;
const SB_H = SCORE_BAR_H;
/** Drops the 9px bar onto the optical centre of the 13px text row beside it. */
const SB_DY = 3;
const SC_ROW0_Y = M + 18;
const SC_ROW_PITCH = 16;
const HDR_BOT = SC_ROW0_Y + 2 * SC_ROW_PITCH + 6;

// Juggernaut banner, its own panel beneath the score header.
const JUG_H = 20;
const JUG_W = 220;

/**
 * Edge-anchored geometry, recomputed by `measureStage()` whenever the window
 * changes shape. The HUD is the one screen that takes the whole window rather
 * than a centred design box, so a wider window has to push the weapon rack,
 * score header, kill feed and credits footer out to the real edges instead of
 * leaving them stranded 1136px in.
 *
 * These are `let` rather than derived constants for the same reason
 * `GAME_WIDTH` is: a `const` computed at import freezes at the boot size.
 * Values that only depend on fixed sizes stay `const` above.
 */
let CRED_Y = 0;
let CRED_TEXT_Y = 0;
let CRED_BAR_Y = 0;
/** Cyan glow bars flanking the "Credits" caption; they take up the slack. */
let CRED_BAR1_W = 0;
let CRED_LABEL_X = 0;
let CRED_BAR2_X = 0;
let CRED_BAR2_W = 0;
let TOTAL_LABEL_X = 0;
let TOTAL_VALUE_X = 0;
let ROW_BOT = 0;
let ROW_Y = 0;
/** Small caption row over the slab (ability readiness, reload/empty state). */
let ROW_LABEL_Y = 0;
let GUN_Y = 0;
let CLIP_Y = 0;
let SH_BOTTOM = 0;
let EKG_Y = 0;
let RACK_X = 0;
let RACK_Y = 0;
let HDR_RIGHT = 0;
let ICON_X = 0;
let SB_X = 0;
/** `txt_playerscore` / `txt_enemyscore` are right-aligned onto the bar track. */
let SC_TEXT_RIGHT = 0;
let JUG_X = 0;
let KF_X = 0;

function measureStage(): void {
  CRED_Y = GAME_HEIGHT - CRED_H;
  CRED_TEXT_Y = CRED_Y + 4;
  CRED_BAR_Y = CRED_Y + (CRED_H - CRED_BAR_H) / 2;
  // Footer: "Earned" pinned left, "Total" pinned right, the caption centred,
  // and the two glow bars stretched to fill whatever is left between them.
  CRED_LABEL_X = Math.round(GAME_WIDTH / 2) - 12;
  CRED_BAR1_W = CRED_LABEL_X - 12 - CRED_BAR1_X;
  CRED_BAR2_X = CRED_LABEL_X + 70;
  TOTAL_LABEL_X = GAME_WIDTH - 146;
  CRED_BAR2_W = TOTAL_LABEL_X - 12 - CRED_BAR2_X;
  TOTAL_VALUE_X = GAME_WIDTH - 8;

  ROW_BOT = CRED_Y - 2;
  ROW_Y = ROW_BOT - ROW_H;
  ROW_LABEL_Y = ROW_Y - 16;
  GUN_Y = ROW_Y + (ROW_H - GUN_H) / 2;
  CLIP_Y = ROW_Y + 22;
  SH_BOTTOM = CLIP_Y + CLIP_H;
  EKG_Y = ROW_Y + 7;

  RACK_X = GAME_WIDTH - M - RACK_W;
  RACK_Y = ROW_BOT - SLOT_H;

  HDR_RIGHT = GAME_WIDTH - M;
  ICON_X = HDR_RIGHT - ICON_SZ;
  SB_X = ICON_X - 10 - SB_W;
  SC_TEXT_RIGHT = SB_X - 8;
  JUG_X = HDR_RIGHT - JUG_W;
  KF_X = HDR_RIGHT;
}

measureStage();

/**
 * Raze 2 team palette, indexed by team: 0 = free-for-all. The names and the
 * text colours are `Hud.as:394` / `:412` verbatim — there is no red team in
 * Raze 2, the sides are Blue / Orange / Yellow / Green.
 */
const TEAM_NAMES = ["FFA", "Blue", "Orange", "Yellow", "Green"];
const TEAM_TEXT = [0xffffff, 0xa3cfff, 0xff9966, 0xffff99, 0x99ff99];
/**
 * The two gradient stops of each colour frame of the score-bar symbol (char
 * 1494), in `gotoAndStop(team + 2)` order. These are the real muted stops, not
 * saturated primaries — the reason the original bars sit into the scene.
 */
const BAR_GRAD: [number, number][] = [
  [0xababab, 0xe8e8e8], // frame 2 — FFA rival
  [0x4385ab, 0x4ac9e8], // frame 3 — Blue
  [0xab7d46, 0xe8a948], // frame 4 — Orange
  [0xaba043, 0xe8d84a], // frame 5 — Yellow
  [0x48ab40, 0x67e84a], // frame 6 — Green
];
/** Frame 1: the local player's own bar in a free-for-all. */
const BAR_SELF_FFA: [number, number] = [0xaba043, 0xe8d84a];
/** The local player's own score text: pale yellow in FFA, pale blue on a team. */
const SELF_TEXT_FFA = 0xffff99;
const SELF_TEXT_TEAM = 0xa3cfff;

// --- kill feed -------------------------------------------------------------
const KF_LINE_H = 18;
const KF_SIZE = 12;
/** Feed caps at 13 visible lines (doc 14 §1.6, `Hud.as:780`). */
const KF_MAX = 13;
/** Lifetime of a kill-feed line, in frames (~5s @ 30fps). */
const KF_LIFE = 5 * FPS;
/** Frames spent fading out at the end of a line's life. */
const KF_FADE = Math.round(0.6 * FPS);
/** Gap between the killer / verb / victim runs. */
const KF_PAD = 8;

// Kill-feed name colours (doc 14 §1.6).
/** Name on the local player's team. */
const KF_TEAMMATE = 0x99ffff;
/** Name on an enemy team. */
const KF_ENEMY = 0xff9999;
/** The local player's own name. */
const KF_SELF = 0x33ffff;
/** Weapon name / separator run. */
const KF_WEAPON = 0xcccccc;

// --- campaign story box (`mc_msg`, doc 14 §1.7) ----------------------------
// Portrait + speaker name + one scripted line, held for as long as the mission
// script asked for, parked in the top-left corner as the original does.
const DLG_X = M;
const DLG_Y = M;
const DLG_W = 268;
/** Thickness of the mid-grey bezel the box is cut from, as on a weapon holder. */
const DLG_FRAME = 4;
const DLG_PAD = 11;
/** Portrait plate: a head-and-shoulders crop of the speaker's baked figure. */
const DLG_FACE = 54;
/** Native px of the baked figure (86x96, feet-anchored) the plate shows. */
const DLG_FACE_CROP = 40;
const DLG_TEXT_X = DLG_X + DLG_PAD + DLG_FACE + DLG_PAD;
const DLG_TEXT_W = DLG_W - (DLG_TEXT_X - DLG_X) - DLG_PAD;
const DLG_NAME_H = 15;
const DLG_LINE_H = 15;
const DLG_MIN_H = DLG_PAD * 2 + DLG_FACE;
/** Frames the box spends fading out once its hold has elapsed. */
const DLG_FADE = Math.round(0.5 * FPS);
/** Frames the box spends sliding in and flashing when a line lands. */
const DLG_IN = Math.round(0.2 * FPS);
/** How far left of its resting place the box starts the slide. */
const DLG_SLIDE = 24;
/** Typewriter floor, in characters per frame. */
const DLG_TYPE_MIN = 1.6;
/** Blink period, in frames, for the caret and the end-of-line chevron. */
const DLG_BLINK = 16;
/** Column the caret occupies; the wrap reserves it so it can never overhang. */
const DLG_CARET = "_";

// --- walkthrough instruction card -----------------------------------------
// The tutorial's `Hud.gotoAndStop("b"/"c"/"d"/"ability"/"g")` frames, which sit
// centred under the match clock and name the control the current step wants.
const TUT_Y = M + 34;
const TUT_PAD = 8;
const TUT_TITLE_H = 18;
const TUT_LINE_H = 15;

// --- full scoreboard overlay ----------------------------------------------
const SC_W = 580;
const SC_ROW_H = 22;
const SC_HEADER_H = 52;
const SC_COL_POS = -SC_W / 2 + 18;
const SC_COL_NAME = SC_COL_POS + 42;
const SC_COL_KD = SC_W / 2 - 18;
const SC_COL_DEATHS = SC_COL_KD - 84;
const SC_COL_KILLS = SC_COL_DEATHS - 84;


/** Reserve fraction below which the ammo readout starts flashing. */
const LOW_AMMO = 0.15;

/** Frames a big centre announcement stays fully visible before fading. */
const ANN_HOLD = Math.round(1.5 * FPS);
const ANN_FADE = Math.round(0.4 * FPS);

/** Top-right mode readout, keyed by SD.matchSettings.type. */
const MODE_LABELS: Record<string, string> = {
  dm: "Deathmatch",
  // Campaign missions tag themselves with the long form.
  deathmatch: "Deathmatch",
  tdm: "Team Deathmatch",
  elim: "Elimination",
  telim: "Team Elimination",
  ctf: "Capture the Flag",
  dom: "Domination",
  jug: "Juggernaut",
};

/**
 * Callout colours, escalating with the rung. The ladder itself (and its credit
 * payouts) lives in `Score`, since `Score.addKill` is what decides it; this is
 * only how loud each one looks.
 */
const CALLOUT_COLORS = [0xffdd55, 0xffa63d, 0xff5a4d, 0xff3ddc, 0xff3ddc];

/** Kill-feed line colour (`Hud.addCustomFeed`): you, a teammate, an enemy. */
const FEED_SELF = 0x33ffff;
const FEED_ALLY = 0x99ffff;
const FEED_ENEMY = 0xffa599;

/** Extra context a caller can attach to a kill-feed line for colouring. */
export interface KillInfo {
  killerTeam?: number;
  victimTeam?: number;
  killerIsPlayer?: boolean;
  victimIsPlayer?: boolean;
  headshot?: boolean;
}

/** One live kill-feed row: a right-aligned container of tinted runs. */
interface KillMsg {
  view: Container;
  age: number;
}

/** One full-scoreboard row (Tab overlay). */
interface ScRow {
  pos: Text;
  name: Text;
  kills: Text;
  deaths: Text;
  kd: Text;
}

/**
 * A HUD numeric read-out in the authentic QTypeSquare-Book face (`FONT_VALUE`),
 * with the source-accurate black glow-outline every HUD number carries
 * ("etched on glass" look, doc 14 §6).
 */
function mkValueText(size: number, fill: number = C_TEXT): Text {
  return new Text({
    text: "",
    style: new TextStyle({
      fill,
      fontFamily: FONT_VALUE,
      fontSize: size,
      fontWeight: "bold",
      stroke: { color: 0x000000, width: Math.max(2, size * 0.12) },
    }),
  });
}

/** Comma-group an integer (Raze 2 `UT.addNumCommas`). */
function addNumCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export class Hud {
  readonly view = new Container();
  gunOrder = GUN_ORDER.slice();

  /** Static chrome (panels / tracks / labels drawn once). */
  private chromeG = new Graphics();
  /** Everything that changes per frame (bar fills, wheel, weapon glyph). */
  private dynG = new Graphics();

  /** True for tdm / telim / ctf / dom: the score header races team totals. */
  private readonly teamMode: boolean;
  /** True for elim / telim: the objective line reports lives, not a cap. */
  private readonly elimMode: boolean;
  /** Y of the Juggernaut panel, beneath the score header. */
  private readonly jugY: number;
  /** Y at which the kill feed starts, beneath the Juggernaut panel. */
  private readonly kfY: number;

  // Bottom-left vitals slab.
  /** Current weapon's glyph, in the slab's left-hand recess. */
  private gunGlyph = new Sprite(Texture.EMPTY);
  /** Weapon id currently textured into `gunGlyph`, to re-texture on swap. */
  private glyphId: string | null = null;
  /** Spare-clip multiplier over the magazine ticks ("x9"). */
  private clipMult: Text;
  private hpText: Text;
  private enText: Text;
  private streakText: Text;
  private ammoState: Text;
  /** Free-running phase for the ECG scroll. */
  private ekgPhase = 0;

  // Top-right score header.
  private gtText: Text;
  private timerText: Text;
  private objText: Text;
  private scoreRows: Text[] = [];
  private jugText: Text;
  private jugPanel = new Container();
  private jugG = new Graphics();

  // Bottom-right weapon rack (RACK_SLOTS fixed tiles).
  private slotIcons: Sprite[] = [];
  /** Weapon id currently textured into each slot sprite, to re-texture on swap. */
  private slotIconId: (string | null)[] = [];
  /** Hotkey digit labels. */
  private slotNums: Text[] = [];

  // Credits footer.
  private credEarned: Text;
  private credTotal: Text;
  /** "Earned:" / "Credits" / "Total:" — footer captions, placed by relayout. */
  private credLabels: Text[] = [];
  /** SD.credits captured at match start, so "earned" is the running delta. */
  private creditBaseline = 0;

  // Centre.
  private banner: Text;
  private announceText: Text;
  /** Frames remaining before the announcement is fully gone, or 0 when idle. */
  private announceTicks = 0;
  private statusText: Text;
  readonly damage = new DamageIndicator();

  // Campaign story box (top-left, beneath the radar).
  private campBox = new Container();
  private campG = new Graphics();
  private campFace = new Sprite();
  private campFaceClip = new Container();
  private campName!: Text;
  private campLine!: Text;

  // Walkthrough instruction card (top-centre, under the clock).
  private tutCard = new Container();
  private tutCardG = new Graphics();
  private tutCardTitle!: Text;
  private tutCardBody!: Text;
  /** Animated overlay (entrance flash, caret, chevron, hold bar). */
  private campFxG = new Graphics();
  /** Frames left before the story box is fully gone, or 0 when idle. */
  private campTicks = 0;
  /** Frames the current line was held for, ignoring the fade. */
  private campSpan = 1;
  /** The line pre-wrapped to explicit newlines; the typewriter reveals a prefix. */
  private campFull = "";
  /** Characters revealed so far (fractional — advances by `campRate`). */
  private campChars = 0;
  private campRate = DLG_TYPE_MIN;
  /** Frames left of the slide-in, or 0 once the box has settled. */
  private campInTicks = 0;
  private campBlink = 0;
  /** Panel height of the current line, for the per-frame overlay pass. */
  private campH = 0;
  /** Resting scale of the portrait plate, before the entrance pop. */
  private campFaceScale = 1;

  /** Live kill-feed lines. */
  private killFeedRoot = new Container();
  private killFeed: KillMsg[] = [];

  /** Live kill-feed lines from RollMsg.ts (world-event messages). */
  private rollMsgs: any[] = [];

  // Full scoreboard overlay (Tab).
  private scoreOverlay = new Container();
  private scoreOverlayG = new Graphics();
  private scoreOverlayTitle!: Text;
  private scoreOverlaySub!: Text;
  private scHeaders: Text[] = [];
  private scoreOverlayRows: ScRow[] = [];

  /** Elapsed match time, in frames. A match ends on its win condition, never
   *  on the clock, so this only ever counts up. */
  private timerTicks = 0;

  /** The SWF's `Hud.gameTime`: frames of live match time, paused excluded.
   *  Mission 15 of either campaign is scored against it (`Hud.as:648-676`). */
  get gameTime(): number {
    return this.timerTicks;
  }
  /** Free-running frame counter, for the Juggernaut pulse and ammo flash. */
  private tick = 0;

  constructor(private game: GameScreen) {
    const type = String(SD.matchSettings?.type ?? "dm");
    this.teamMode = type === "tdm" || type === "telim" || type === "ctf" || type === "dom";
    this.elimMode = type === "elim" || type === "telim";
    this.jugY = HDR_BOT + 6;
    // Baseline with no Juggernaut banner. The strip its banner needs used to be
    // reserved unconditionally, leaving a permanent 32px hole above the kill
    // feed in every match without one — layoutKillFeed adds it back only while
    // the banner is actually up (the crown spawns in quick match generally, not
    // just in Juggernaut mode, so this cannot be decided here).
    this.kfY = this.jugY + 4;

    this.view.addChild(this.chromeG);
    this.view.addChild(this.dynG);

    // --- bottom-left vitals slab ---
    // Current weapon glyph, at the authentic Hud_WeaponHolder tilt.
    this.gunGlyph.anchor.set(0.5);
    this.gunGlyph.rotation = -0.408;
    this.gunGlyph.x = GUN_X + GUN_W / 2;
    this.gunGlyph.y = GUN_Y + GUN_H / 2;
    this.gunGlyph.visible = false;
    this.view.addChild(this.gunGlyph);

    // "xN" spare-clip multiplier, over the right end of the magazine ticks.
    this.clipMult = mkValueText(12, C_SLOT_UNSELECTED);
    this.clipMult.anchor.set(1, 0);
    this.clipMult.x = CLIP_X + CLIP_W;
    this.clipMult.y = ROW_Y + 4;
    this.view.addChild(this.clipMult);

    // Health percentage, in the monitor's left-hand column.
    this.hpText = mkValueText(19);
    this.hpText.anchor.set(0, 0.5);
    this.hpText.x = EKG_X + 6;
    this.hpText.y = EKG_Y + EKG_H / 2;
    this.view.addChild(this.hpText);

    // Captions over the slab: ability readiness on the left, ammo state beside
    // it. Both are short and only up when they have something to say.
    this.enText = mkText(10, C_ENERGY_PURPLE, true);
    this.enText.x = GUN_X;
    this.enText.y = ROW_LABEL_Y;
    this.view.addChild(this.enText);

    this.ammoState = mkText(11, C_ACCENT, true);
    this.ammoState.x = EKG_X;
    this.ammoState.y = ROW_LABEL_Y;
    this.view.addChild(this.ammoState);

    // The streak sits over the weapon rack.
    this.streakText = mkText(13, C_ACCENT, true);
    this.streakText.x = RACK_X;
    this.streakText.y = ROW_LABEL_Y;
    this.view.addChild(this.streakText);

    // --- top-right score header ---
    // `txt_gametype` is plain white in the original, not an accent colour: the
    // caption is a label, and the only thing meant to catch the eye up here is
    // whichever bar is winning.
    this.gtText = mkText(12, C_TEXT, true);
    this.gtText.anchor.set(1, 0);
    this.gtText.x = SB_X + SB_W;
    this.gtText.y = M;
    this.view.addChild(this.gtText);

    for (let i = 0; i < 2; i++) {
      const t = mkValueText(13);
      t.anchor.set(1, 0);
      t.x = SC_TEXT_RIGHT;
      t.y = SC_ROW0_Y + i * SC_ROW_PITCH;
      this.scoreRows.push(t);
      this.view.addChild(t);
    }

    // Only elimination needs a written objective — every other mode's race
    // bars already say "first side to fill the track wins".
    this.objText = mkText(10, C_DIM, false);
    this.objText.anchor.set(1, 0);
    this.objText.x = SB_X + SB_W;
    this.objText.y = SC_ROW0_Y + 2 * SC_ROW_PITCH;
    this.objText.visible = this.elimMode;
    this.view.addChild(this.objText);

    // Match clock (`txt_time`), top centre as in the original.
    this.timerText = mkValueText(22);
    this.timerText.anchor.set(0.5, 0);
    this.timerText.x = GAME_WIDTH / 2;
    this.timerText.y = M;
    this.view.addChild(this.timerText);

    // --- Juggernaut banner (its own panel so it can glow independently) ---
    this.jugPanel.visible = false;
    this.jugPanel.addChild(this.jugG);
    this.jugText = mkText(10, 0x1a1305, true);
    this.jugText.anchor.set(0.5, 0);
    this.jugText.x = JUG_X + JUG_W / 2;
    this.jugText.y = this.jugY + 4;
    this.jugPanel.addChild(this.jugText);
    this.view.addChild(this.jugPanel);

    // --- kill feed ---
    this.view.addChild(this.killFeedRoot);

    // --- weapon rack: one pooled glyph + hotkey label per fixed slot ---
    for (let i = 0; i < RACK_SLOTS; i++) {
      const x = RACK_X + i * (SLOT_W + SLOT_GAP);

      const icon = new Sprite(Texture.EMPTY);
      icon.anchor.set(0.5);
      icon.visible = false;
      icon.rotation = -0.408;
      icon.x = x + SLOT_W / 2;
      icon.y = RACK_Y + SLOT_H / 2 - 4;
      this.slotIcons.push(icon);
      this.slotIconId.push(null);
      this.view.addChild(icon);

      const num = mkValueText(11);
      num.anchor.set(1, 1);
      num.visible = false;
      num.x = x + SLOT_W - 7;
      num.y = RACK_Y + SLOT_H - 12;
      this.slotNums.push(num);
      this.view.addChild(num);
    }

    // --- credits footer ---
    for (const text of ["Earned:", "Credits", "Total:"]) {
      const t = mkText(12, C_DIM, true);
      t.text = text;
      this.credLabels.push(t);
      this.view.addChild(t);
    }

    this.creditBaseline = SD.credits;
    this.credEarned = mkValueText(13, C_TEXT);
    this.credEarned.anchor.set(1, 0);
    this.credEarned.x = EARN_VALUE_X;
    this.credEarned.y = CRED_TEXT_Y;
    this.view.addChild(this.credEarned);

    this.credTotal = mkValueText(13, C_TEXT);
    this.credTotal.anchor.set(1, 0);
    this.credTotal.x = TOTAL_VALUE_X;
    this.credTotal.y = CRED_TEXT_Y;
    this.view.addChild(this.credTotal);

    // --- top-left campaign story box (hidden until a line is spoken) ---
    this.buildCampBox();

    // --- top-centre walkthrough instruction card (hidden outside mission 1) ---
    this.buildTutCard();

    // --- centre: damage indicator, banner, announcement, status ---
    this.view.addChild(this.damage.view);

    this.banner = new Text({
      text: "",
      style: new TextStyle({
        fill: C_ACCENT,
        fontFamily: FONT,
        fontSize: 34,
        fontWeight: "bold",
        align: "center",
        letterSpacing: 1,
        stroke: { color: 0x000000, width: 5 },
      }),
    });
    this.banner.anchor.set(0.5);
    this.banner.x = GAME_WIDTH / 2;
    this.banner.y = 140;
    this.view.addChild(this.banner);

    this.announceText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: FONT,
        fontSize: 44,
        fontWeight: "bold",
        align: "center",
        letterSpacing: 2,
        stroke: { color: 0x000000, width: 6 },
      }),
    });
    this.announceText.anchor.set(0.5);
    this.announceText.x = GAME_WIDTH / 2;
    this.announceText.y = GAME_HEIGHT / 2 - 70;
    this.announceText.alpha = 0;
    this.view.addChild(this.announceText);

    this.statusText = mkText(18, C_TEXT, true);
    this.statusText.anchor.set(0.5, 0);
    this.statusText.x = GAME_WIDTH / 2;
    this.statusText.y = GAME_HEIGHT / 2 + 70;
    this.view.addChild(this.statusText);

    // --- full scoreboard overlay (hidden until SD.scores) ---
    this.buildScoreOverlay();

    this.relayout();
    this.applyQuality();
  }

  /**
   * Re-anchor everything the stage edges own, then redraw the static chrome.
   * Runs once at construction and again on every window resize.
   *
   * Only positions move — the kill feed's contents, the story box and the
   * streak state are all untouched, so this is safe to call mid-match.
   */
  relayout(): void {
    measureStage();

    this.gunGlyph.y = GUN_Y + GUN_H / 2;
    this.clipMult.y = ROW_Y + 4;
    this.hpText.y = EKG_Y + EKG_H / 2;
    this.enText.y = ROW_LABEL_Y;
    this.ammoState.y = ROW_LABEL_Y;
    this.streakText.position.set(RACK_X, ROW_LABEL_Y);

    this.gtText.x = SB_X + SB_W;
    for (const t of this.scoreRows) t.x = SC_TEXT_RIGHT;
    this.objText.x = SB_X + SB_W;
    this.timerText.x = GAME_WIDTH / 2;
    this.jugText.x = JUG_X + JUG_W / 2;
    this.killFeedRoot.x = KF_X;

    for (let i = 0; i < RACK_SLOTS; i++) {
      const x = RACK_X + i * (SLOT_W + SLOT_GAP);
      this.slotIcons[i].position.set(x + SLOT_W / 2, RACK_Y + SLOT_H / 2 - 4);
      this.slotNums[i].position.set(x + SLOT_W - 7, RACK_Y + SLOT_H - 12);
    }

    this.credEarned.y = CRED_TEXT_Y;
    this.credTotal.position.set(TOTAL_VALUE_X, CRED_TEXT_Y);

    this.tutCardTitle.x = GAME_WIDTH / 2;
    this.tutCardBody.x = GAME_WIDTH / 2;

    this.banner.x = GAME_WIDTH / 2;
    this.announceText.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 70);
    this.statusText.position.set(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 70);
    this.damage.relayout();

    this.drawChrome();
  }

  // --- construction helpers ------------------------------------------------

  /**
   * The campaign story box: portrait plate, speaker name, one wrapped line.
   *
   * Raze 2 draws the portrait from the speaker's own part rig (head + body +
   * arm at that skin's frame). The port only bakes each skin as a whole
   * feet-anchored idle figure, so the plate shows the top slice of that figure
   * — anchored on the manifest's standing axis and masked below the shoulders,
   * which lands on a head-and-shoulders bust without needing per-skin head
   * rects.
   */
  private buildCampBox(): void {
    this.campBox.visible = false;
    this.campBox.addChild(this.campG);

    const plateX = DLG_X + DLG_PAD;
    const plateY = DLG_Y + DLG_PAD;
    const clip = new Graphics();
    clip.rect(plateX, plateY, DLG_FACE, DLG_FACE).fill({ color: 0xffffff });
    this.campBox.addChild(clip);
    this.campFaceClip.mask = clip;
    this.campFace.anchor.set(SkinArt.anchor().x, 0);
    this.campFace.x = plateX + DLG_FACE / 2;
    this.campFace.y = plateY;
    this.campFaceClip.addChild(this.campFace);
    this.campBox.addChild(this.campFaceClip);

    this.campName = mkText(12, C_TEAL, true);
    this.campName.x = DLG_TEXT_X;
    this.campName.y = DLG_Y + DLG_PAD;
    this.campBox.addChild(this.campName);

    this.campLine = new Text({
      text: "",
      style: new TextStyle({
        fill: C_TEXT,
        fontFamily: FONT,
        fontSize: 12,
        lineHeight: DLG_LINE_H,
        wordWrap: false,
        wordWrapWidth: DLG_TEXT_W,
      }),
    });
    this.campLine.x = DLG_TEXT_X;
    this.campLine.y = DLG_Y + DLG_PAD + DLG_NAME_H;
    this.campBox.addChild(this.campLine);

    this.campBox.addChild(this.campFxG);
    this.view.addChild(this.campBox);
  }

  /**
   * The walkthrough's instruction card. The original's frames are key diagrams
   * built from nested art clips; the port draws the same strings as a titled
   * panel, which reads at this stage size and needs no per-key sprite.
   */
  private buildTutCard(): void {
    this.tutCard.visible = false;
    this.tutCard.addChild(this.tutCardG);

    this.tutCardTitle = mkText(13, C_ACCENT, true);
    this.tutCardTitle.anchor.set(0.5, 0);
    this.tutCardTitle.x = GAME_WIDTH / 2;
    this.tutCardTitle.y = TUT_Y + TUT_PAD;
    this.tutCard.addChild(this.tutCardTitle);

    this.tutCardBody = mkText(12, C_TEXT, false);
    this.tutCardBody.anchor.set(0.5, 0);
    this.tutCardBody.style.align = "center";
    this.tutCardBody.style.lineHeight = TUT_LINE_H;
    this.tutCardBody.x = GAME_WIDTH / 2;
    this.tutCardBody.y = TUT_Y + TUT_PAD + TUT_TITLE_H;
    this.tutCard.addChild(this.tutCardBody);

    this.view.addChild(this.tutCard);
  }

  /** Show the walkthrough's instruction card, or clear it with null. */
  setTutCard(card: { title: string; body: string[] } | null): void {
    this.tutCard.visible = !!card;
    if (!card) return;
    this.tutCardTitle.text = card.title;
    this.tutCardBody.text = card.body.join("\n");

    const w =
      Math.max(measureMono(card.title, 13), ...card.body.map((l) => measureMono(l, 12))) +
      TUT_PAD * 6;
    const h = TUT_PAD * 2 + TUT_TITLE_H + card.body.length * TUT_LINE_H;
    this.tutCardG.clear();
    panel(this.tutCardG, (GAME_WIDTH - w) / 2, TUT_Y, w, h, { accent: C_ACCENT, alpha: 0.8 });
  }

  private buildScoreOverlay(): void {
    this.scoreOverlay.visible = false;
    this.scoreOverlay.addChild(this.scoreOverlayG);

    this.scoreOverlayTitle = mkText(17, C_ACCENT, true);
    this.scoreOverlayTitle.anchor.set(0.5, 0);
    this.scoreOverlayTitle.y = 9;
    this.scoreOverlay.addChild(this.scoreOverlayTitle);

    this.scoreOverlaySub = mkText(12, C_DIM, false);
    this.scoreOverlaySub.anchor.set(0.5, 0);
    this.scoreOverlaySub.y = 29;
    this.scoreOverlay.addChild(this.scoreOverlaySub);

    const cols: [string, number, number][] = [
      ["POS", SC_COL_POS, 0],
      ["NAME", SC_COL_NAME, 0],
      ["KILLS", SC_COL_KILLS, 1],
      ["DEATHS", SC_COL_DEATHS, 1],
      ["K/D", SC_COL_KD, 1],
    ];
    for (const [label, x, anchor] of cols) {
      const t = mkText(10, C_FAINT, true);
      t.text = label;
      t.anchor.set(anchor, 0);
      t.x = x;
      t.y = SC_HEADER_H - 16;
      this.scHeaders.push(t);
      this.scoreOverlay.addChild(t);
    }

    this.view.addChild(this.scoreOverlay);
  }

  // --- public API ----------------------------------------------------------

  addRollMsg(msg: any): void {
    this.rollMsgs.push(msg);
    this.view.addChild(msg.view);
  }
  removeRollMsg(msg: any): void {
    const i = this.rollMsgs.indexOf(msg);
    if (i >= 0) {
      this.rollMsgs.splice(i, 1);
      this.view.removeChild(msg.view);
      msg.destructor?.();
    }
  }

  /**
   * Screenshot / spectator mode. Every HUD element is a child of `view`, so a
   * single visibility flip hides the lot — bars, weapon rack, scoreboard,
   * timer, kill feed, damage indicator, banners and announcements — with no
   * per-field list to keep in sync. Logic keeps ticking underneath.
   */
  setSSmode(on: boolean): void {
    this.view.visible = !on;
    if (on) this.damage.clear();
  }

  /**
   * Re-apply quality-dependent styling.
   *
   * The banner and centre announcement use a blurred drop shadow, which is the
   * expensive "glow" on this screen; it is dropped entirely when glow is off.
   */
  applyQuality(): void {
    const shadow = Quality.glow;
    this.banner.style.dropShadow = shadow
      ? { color: 0x000000, blur: 4, distance: 2, alpha: 0.6, angle: Math.PI / 2 }
      : false;
    this.announceText.style.dropShadow = shadow
      ? { color: 0x000000, blur: 5, distance: 3, alpha: 0.7, angle: Math.PI / 2 }
      : false;
  }

  setBanner(text: string): void {
    this.banner.text = text;
    this.banner.style.fill = C_ACCENT;
  }

  /**
   * The match ended. The outcome itself is presented by GameScreen's round-end
   * card, which fades in over the still-running arena, so the HUD's job here is
   * just to get its own banner and centre line out from under it.
   */
  setResult(_won: boolean): void {
    this.banner.text = "";
    this.statusText.text = "";
  }

  /**
   * Kill-feed line for one kill. Built from three separately-tinted runs
   * (killer / weapon verb / victim) laid out right-to-left with the monospace
   * advance, so the player's own name and their team's colours pop out of the
   * feed without having to read it.
   */
  addKillMessage(
    killerName: string,
    weaponId: string,
    victimName: string,
    headshot = false,
    info: KillInfo = {},
  ): void {
    const verb = WEAPONS[weaponId]?.msg ?? "Killed";
    // Name colours (doc 14 §1.6): self = bright cyan, teammate = cyan, enemy =
    // salmon; the weapon/separator run is always grey.
    const myTeam = (this.game.player as any)?.team ?? 0;
    const nameCol = (isPlayer?: boolean, team?: number) =>
      isPlayer ? KF_SELF : myTeam && team === myTeam ? KF_TEAMMATE : KF_ENEMY;

    const runs: [string, number, number][] = [
      [killerName.slice(0, 16), nameCol(info.killerIsPlayer, info.killerTeam), KF_SIZE],
      [`»${verb}»`, KF_WEAPON, KF_SIZE],
      [victimName.slice(0, 16), nameCol(info.victimIsPlayer, info.victimTeam), KF_SIZE],
    ];
    if (headshot) runs.push(["HS", C_ACCENT, KF_SIZE - 1]);
    this.pushFeedRow(runs);
  }

  /** Generic kill-feed / message-roll line (world events, pickups, suicides). */
  addMessage(text: string, color: number = C_TEXT): void {
    this.pushFeedRow([[text, color, KF_SIZE]]);
  }

  /**
   * `Hud.addCustomFeed`: one kill-feed line about a unit, coloured by their
   * relationship to the player rather than by the event.
   */
  addCustomFeed(unit: { _name?: string; name?: string; team?: number; human?: boolean },
                text: string): void {
    const mine = this.game?.player;
    const color = unit.human
      ? FEED_SELF
      : unit.team && mine && unit.team === mine.team
        ? FEED_ALLY
        : FEED_ENEMY;
    this.pushFeedRow([[`${unit._name ?? unit.name ?? "?"}${text}`, color, KF_SIZE]]);
  }

  /**
   * Multikill callout — `Score.addKill`'s first ladder. Only the player gets
   * the big centre-screen shout (and its credits); everyone gets a feed line.
   */
  announceKill(unit: any, label: string, isPlayer: boolean): void {
    if (isPlayer) this.announce(label.toUpperCase(), CALLOUT_COLORS[0]);
    this.addCustomFeed(unit, ` got a ${label}`);
  }

  /**
   * Spree callout. The thresholds only fire on the nose (`Score.SPREE_TIERS`),
   * so a long run escalates through the ladder rather than shouting every kill.
   */
  announceSpree(unit: any, label: string, streak: number, isPlayer: boolean): void {
    const rung = SPREE_TIERS.findIndex((t) => t.at === streak);
    const color = CALLOUT_COLORS[Math.max(0, rung)] ?? CALLOUT_COLORS[0];
    if (isPlayer) this.announce(label.toUpperCase(), color);
    const lead = SPREE_TIERS[rung]?.lead ?? "";
    this.addCustomFeed(unit, ` is ${lead}${label}`);
  }

  /**
   * Campaign story line (`Hud.setCampMsg`, doc 10 §5 / doc 14 §1.7). Shows the
   * speaker's portrait and name beside one scripted line for `seconds`, then
   * fades. A new line replaces whatever is up, as in the original — nothing
   * queues here, the mission script owns the pacing.
   *
   * The box grows to fit the line, so a long mission briefing reads as a
   * paragraph instead of overflowing a fixed slab.
   */
  setCampMsg(portraitSkin: string | null, speaker: string | null, text: string, seconds = 4): void {
    const tex = portraitSkin ? SkinArt.getTexture(portraitSkin) : null;
    this.campFaceClip.visible = !!tex;
    if (tex) {
      this.campFace.texture = tex;
      // Fit the figure's head-and-shoulders slice to the plate.
      this.campFaceScale = DLG_FACE / DLG_FACE_CROP;
    }

    // Radio lines with no portrait art reclaim the plate's column.
    const tx = tex ? DLG_TEXT_X : DLG_X + DLG_PAD;
    this.campName.text = speaker ?? "";
    this.campName.visible = !!speaker;
    this.campName.x = tx;
    this.campLine.x = tx;
    this.campLine.y = DLG_Y + DLG_PAD + (speaker ? DLG_NAME_H : 0);

    // Wrap once, up front. The panel has to be its final size from the first
    // frame, and the typewriter reveals a prefix of already-wrapped text so no
    // word ever jumps to the next line as it completes. The caret column is
    // held back from the wrap width so the caret can never overhang the panel.
    const style = this.campLine.style;
    style.wordWrapWidth = DLG_X + DLG_W - DLG_PAD - tx - 8;
    this.campFull = CanvasTextMetrics.measureText(text, style, undefined, true).lines.join("\n");
    this.campLine.text = "";

    const h = Math.max(
      tex ? DLG_MIN_H : 0,
      DLG_PAD * 2 + (speaker ? DLG_NAME_H : 0) + this.campFull.split("\n").length * DLG_LINE_H,
    );
    // Chrome: the same mid-grey bezel around a dark-glass recess that every
    // Raze 2 HUD holder is cut from, so the story box belongs to the same
    // console as the weapon rack rather than floating over it.
    const g = this.campG;
    g.clear();
    g.rect(DLG_X, DLG_Y, DLG_W, h).fill({ color: C_BEZEL, alpha: 0.95 });
    g.rect(DLG_X, DLG_Y, DLG_W, 2).fill({ color: C_BEZEL_HI, alpha: 0.7 });
    g.rect(DLG_X, DLG_Y, 2, h).fill({ color: C_BEZEL_HI, alpha: 0.3 });
    g.rect(DLG_X, DLG_Y, DLG_W, h).stroke({ color: 0x000000, width: 1, alpha: 0.9 });
    razeGlass(g, DLG_X + DLG_FRAME, DLG_Y + DLG_FRAME, DLG_W - DLG_FRAME * 2, h - DLG_FRAME * 2, 0.95);
    if (tex) {
      const px = DLG_X + DLG_PAD;
      const py = DLG_Y + DLG_PAD;
      // The portrait sits in its own recess, cut into the glass the same way a
      // weapon glyph is: black seat, then the lit hairline along its top edge.
      g.rect(px - 1, py - 1, DLG_FACE + 2, DLG_FACE + 2).fill({ color: 0x000000, alpha: 0.95 });
      razeGlass(g, px, py, DLG_FACE, DLG_FACE, 0.95);
      g.rect(px, py, DLG_FACE, 1).fill({ color: C_BEZEL_HI, alpha: 0.45 });
    }

    // Type the line out over the first half of its hold, so even a long
    // briefing has settled well before the box starts to fade.
    const span = Math.round(Math.max(1, seconds) * FPS);
    this.campH = h;
    this.campSpan = span;
    this.campChars = 0;
    this.campRate = Math.max(DLG_TYPE_MIN, this.campFull.length / (span * 0.5));
    this.campInTicks = DLG_IN;
    this.campBlink = 0;
    this.campBox.visible = true;
    this.campTicks = span + DLG_FADE;
    this.updateCampAnim();
  }

  private advanceCampMsg(): void {
    if (this.campTicks <= 0) return;
    this.campTicks--;
    if (this.campTicks <= 0) {
      this.campBox.visible = false;
      this.campFxG.clear();
      return;
    }
    if (this.campInTicks > 0) this.campInTicks--;
    this.campBlink++;
    this.campChars += this.campRate;
    this.updateCampAnim();
  }

  /**
   * Per-frame life of the story box. A line lands with a slide and a wash of
   * accent over the panel, types itself out behind a blinking caret, then holds
   * under a draining bar — so a line replacing another mid-mission reads as an
   * update rather than silently swapping text the player never saw change.
   */
  private updateCampAnim(): void {
    const inP = this.campInTicks > 0 ? 1 - this.campInTicks / DLG_IN : 1;
    const ease = 1 - (1 - inP) ** 3;
    this.campBox.x = -DLG_SLIDE * (1 - ease);
    this.campFace.scale.set(this.campFaceScale * (1 + 0.22 * (1 - ease)));

    const fade = this.campTicks < DLG_FADE ? this.campTicks / DLG_FADE : 1;
    this.campBox.alpha = Math.min(fade, 0.15 + 0.85 * ease);

    const shown = Math.min(this.campFull.length, Math.floor(this.campChars));
    const typing = shown < this.campFull.length;
    const blinkOn = this.campBlink % DLG_BLINK < DLG_BLINK * 0.6;
    // The caret rides in the text itself: monospace makes that exact, where a
    // separately-positioned bar would need a width measurement every frame.
    this.campLine.text = this.campFull.slice(0, shown) + (typing && blinkOn ? DLG_CARET : "");

    const g = this.campFxG;
    g.clear();

    // A line landing lights the glass rather than washing it in a colour — the
    // panel is grey chrome, so the arrival reads as the screen refreshing.
    if (ease < 1) {
      const gx = DLG_X + DLG_FRAME;
      const gw = DLG_W - DLG_FRAME * 2;
      g.rect(gx, DLG_Y + DLG_FRAME, gw, this.campH - DLG_FRAME * 2)
        .fill({ color: 0xffffff, alpha: 0.14 * (1 - ease) });
      g.rect(DLG_X, DLG_Y, DLG_W, this.campH)
        .stroke({ color: C_BEZEL_HI, width: 2, alpha: 0.8 * (1 - ease) });
    }

    if (!typing && blinkOn) {
      const cx = DLG_X + DLG_W - DLG_PAD - 7;
      const cy = DLG_Y + this.campH - DLG_PAD - 1;
      g.moveTo(cx, cy - 5).lineTo(cx + 7, cy - 5).lineTo(cx + 3.5, cy)
        .fill({ color: C_AMMO_WHITE, alpha: 0.85 });
    }

    const left = clamp01(Math.max(0, this.campTicks - DLG_FADE) / this.campSpan);
    if (left > 0) {
      // Hold timer, drawn on the glass inside the bezel so it never crosses the
      // frame's lit edge.
      const bx = DLG_X + DLG_FRAME;
      const by = DLG_Y + this.campH - DLG_FRAME - 2;
      g.rect(bx, by, (DLG_W - DLG_FRAME * 2) * left, 2).fill({ color: C_TEAL, alpha: 0.55 });
    }
  }

  /** Big, transient centre announcement (headshot / streak / Juggernaut). */
  announce(text: string, color = 0xffffff): void {
    this.announceText.text = text;
    this.announceText.style.fill = color;
    this.announceText.alpha = 1;
    this.announceTicks = ANN_HOLD + ANN_FADE;
  }

  /**
   * Directional damage marker. `angle` is in screen radians pointing FROM the
   * player TOWARD the source; `power` is the same 0..1 severity flashDamage
   * takes. Ignored in screenshot mode (the whole HUD is hidden anyway, but
   * clearing keeps stale wedges from popping back when it is restored).
   */
  showDamageFrom(angle: number, power: number): void {
    if (!this.view.visible) return;
    this.damage.add(angle, power);
  }

  // --- kill feed -----------------------------------------------------------

  /** Lay a row of tinted runs out right-aligned to the feed's right edge. */
  private pushFeedRow(runs: [string, number, number][]): void {
    const row = new Container();
    let total = 0;
    for (let i = 0; i < runs.length; i++) {
      total += measureMono(runs[i][0], runs[i][2]);
      if (i) total += KF_PAD;
    }

    // Rows are built right-aligned on the feed root's own origin, which
    // relayout() parks on the stage's right edge — so a resize moves the whole
    // feed with one assignment instead of re-measuring every live line.
    let x = -total;
    for (const [text, color, size] of runs) {
      const t = mkText(size, color, true);
      t.text = text;
      t.x = x;
      // Smaller runs (the headshot tag) sit on the same baseline.
      t.y = KF_SIZE - size;
      row.addChild(t);
      x += measureMono(text, size) + KF_PAD;
    }

    this.killFeedRoot.addChild(row);
    this.killFeed.unshift({ view: row, age: 0 });
    while (this.killFeed.length > KF_MAX) {
      const dropped = this.killFeed.pop()!;
      this.killFeedRoot.removeChild(dropped.view);
      dropped.view.destroy({ children: true });
    }
    this.layoutKillFeed();
  }

  private layoutKillFeed(): void {
    const top = this.kfY + (this.jugPanel.visible ? JUG_H + 8 : 0);
    for (let i = 0; i < this.killFeed.length; i++) {
      this.killFeed[i].view.y = top + i * KF_LINE_H;
    }
  }

  private advanceKillFeed(): void {
    if (!this.killFeed.length) return;
    let removed = false;
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      const m = this.killFeed[i];
      m.age++;
      if (m.age >= KF_LIFE) {
        this.killFeedRoot.removeChild(m.view);
        m.view.destroy({ children: true });
        this.killFeed.splice(i, 1);
        removed = true;
        continue;
      }
      const fadeStart = KF_LIFE - KF_FADE;
      m.view.alpha = m.age > fadeStart ? Math.max(0, 1 - (m.age - fadeStart) / KF_FADE) : 1;
    }
    if (removed) this.layoutKillFeed();
  }

  private advanceAnnounce(): void {
    if (this.announceTicks <= 0) return;
    this.announceTicks--;
    this.announceText.alpha =
      this.announceTicks >= ANN_FADE ? 1 : this.announceTicks / ANN_FADE;
  }

  // --- static chrome -------------------------------------------------------

  /** Slabs, recesses and captions. Redrawn only by `relayout`. */
  private drawChrome(): void {
    const g = this.chromeG;
    g.clear();

    // Credits footer, full width, with the two char-1478 cyan glow strips.
    razeGlass(g, 0, CRED_Y, GAME_WIDTH, CRED_H);
    for (const [x, w] of [[CRED_BAR1_X, CRED_BAR1_W], [CRED_BAR2_X, CRED_BAR2_W]]) {
      g.rect(x, CRED_BAR_Y, w, CRED_BAR_H).fill({ color: C_GLOW_CYAN, alpha: 0.3 });
      g.rect(x, CRED_BAR_Y + CRED_BAR_H / 2 - 1, w, 2)
        .fill({ color: C_GLOW_CYAN, alpha: 0.75 });
    }
    this.credLabels[0].position.set(EARN_LABEL_X, CRED_TEXT_Y);
    this.credLabels[1].position.set(CRED_LABEL_X, CRED_TEXT_Y);
    this.credLabels[2].position.set(TOTAL_LABEL_X, CRED_TEXT_Y);

    // Vitals slab, and the angled wedge that runs it into the weapon rack.
    razeGlass(g, 0, ROW_Y, VIT_W, ROW_H);
    g.moveTo(VIT_W, ROW_Y)
      .lineTo(VIT_W + VIT_TAIL, ROW_BOT)
      .lineTo(VIT_W, ROW_BOT)
      .fill({ color: C_BEZEL, alpha: 0.92 });
    g.moveTo(VIT_W, ROW_Y)
      .lineTo(VIT_W + VIT_TAIL, ROW_BOT)
      .stroke({ color: C_BEZEL_HI, width: 1.5, alpha: 0.5 });

    // Recesses for the weapon glyph and the heartbeat monitor.
    razeGlass(g, GUN_X, GUN_Y, GUN_W, GUN_H);
    razeGlass(g, EKG_X - 3, EKG_Y - 2, EKG_W + 6, EKG_H + 4);

    // The seven weapon-holder tiles; their contents are drawn per frame.
    for (let i = 0; i < RACK_SLOTS; i++) {
      bezelTile(g, RACK_X + i * (SLOT_W + SLOT_GAP), RACK_Y, SLOT_W, SLOT_H);
    }

    // Score header: just the gametype plate. There is deliberately no panel
    // behind the race bars — the original floats the caption, the two rows and
    // the bars straight over the level, and boxing them in a glass capsule is
    // what made this corner read as a generic widget instead of Raze chrome.
    // `mc_gametype` gets the mode it was built for rather than a fixed skull.
    modePlate(g, ICON_X, ICON_Y, ICON_SZ, String(SD.matchSettings?.type ?? "dm"));
  }

  // --- per-frame -----------------------------------------------------------

  enterFrame(): void {
    this.tick++;
    const p: any = this.game.player;

    const g = this.dynG;
    g.clear();

    // Advance the clock only while the match is actually running.
    if (this.game.gameStarted && !this.game.gameOver && !SD.paused) this.timerTicks++;

    this.drawGameInfo();
    this.drawStatusLine(p);
    this.advanceKillFeed();
    this.advanceAnnounce();
    this.advanceCampMsg();
    this.damage.enterFrame();
    this.drawFullScoreboard();

    if (!p) return;
    this.drawVitals(p);
    this.drawWeapon(p);
  }

  // --- bottom-left vitals cluster ------------------------------------------

  /**
   * The vitals slab, left to right: the current weapon's glyph, the magazine
   * ticks and their "xN" spare-clip multiplier, the shield and energy columns,
   * and the heartbeat monitor (doc 14 §1.1-1.2).
   */
  private drawVitals(p: any): void {
    const g = this.dynG;
    const dead = !!p.status?.dead;
    const hpPer = dead ? 0 : clamp01(p.status.getHpPer());
    const shPer = dead ? 0 : clamp01(p.status.getShPer());
    const gun = dead ? null : p.gun?.curGun;

    // --- weapon glyph ---
    const id: string | null = gun?.id ?? null;
    if (id && this.glyphId !== id) {
      const tex = ArmArt.getIcon(id);
      if (tex) {
        this.gunGlyph.texture = tex;
        this.glyphId = id;
      }
    }
    this.gunGlyph.visible = !!id && this.glyphId === id;
    if (this.gunGlyph.visible) this.fitSprite(this.gunGlyph, GUN_W - 10, GUN_H - 10);

    // --- magazine ticks + "xN" spare clips ---
    this.drawMagazine(gun);

    // --- shield (yellow) and energy (purple) columns ---
    this.drawVitalColumn(SH_X, shPer, C_SHIELD_YELLOW, 1);

    const ability = p.ability;
    const hasAbility = !!ability && ability.id !== "none";
    if (hasAbility) {
      const enPer = dead ? 0 : clamp01(p.status.getEnPer());
      const need = (ability.usedEnergy ?? 100) / (p.status.enMax || 100);
      const ready = !dead && enPer >= need;
      this.drawVitalColumn(
        EN_X, enPer, C_ENERGY_PURPLE,
        ready ? 0.75 + 0.25 * Math.sin(this.tick * 0.25) : 0.6,
      );
      this.enText.text = ready
        ? `${String(ability.name).toUpperCase()} [F]`
        : String(ability.name).toUpperCase();
      this.enText.style.fill = ready ? 0xe6d6ff : C_DIM;
      this.enText.visible = true;
    } else {
      this.drawVitalColumn(EN_X, 0, C_ENERGY_PURPLE, 1);
      this.enText.visible = false;
    }

    // --- heartbeat monitor ---
    // Scroll speed rises with the heartbeat rate, i.e. with health.
    this.ekgPhase += 0.015 + 0.035 * hpPer;
    const tint = healthTint(hpPer);
    for (let i = 1; i < 4; i++) {
      const gy = EKG_Y + (EKG_H * i) / 4;
      g.moveTo(EKG_X, gy).lineTo(EKG_X + EKG_W, gy)
        .stroke({ color: tint, width: 1, alpha: 0.13 });
    }
    // The trace starts clear of the "N%" column so the two never overlap.
    drawHeartbeat(
      g, EKG_X + EKG_TEXT_W, EKG_Y, EKG_W - EKG_TEXT_W - 4, EKG_H,
      hpPer, this.ekgPhase, tint,
    );
    this.hpText.text = `${Math.ceil(hpPer * 100)}%`;
    this.hpText.style.fill = tint;

    const streak = p.score?.killStreak ?? 0;
    this.streakText.text = streak >= 2 ? `${streak} KILL STREAK` : "";
  }

  /** One 33px-max vertical vitals column, growing upward from `SH_BOTTOM`. */
  private drawVitalColumn(x: number, per: number, color: number, alpha: number): void {
    const g = this.dynG;
    const top = SH_BOTTOM - SH_MAX_H;
    g.rect(x, top, SH_W, SH_MAX_H).fill({ color: 0x000000, alpha: 0.85 });
    const h = clamp01(per) * SH_MAX_H;
    if (h > 0) g.rect(x, SH_BOTTOM - h, SH_W, h).fill({ color, alpha });
    // Graduations, so a half-full column reads as a value and not just a blob.
    for (let i = 1; i < 5; i++) {
      const ty = SH_BOTTOM - (SH_MAX_H * i) / 5;
      g.moveTo(x, ty).lineTo(x + SH_W, ty).stroke({ color: 0x000000, width: 1, alpha: 0.55 });
    }
    g.rect(x, top, SH_W, SH_MAX_H).stroke({ color: 0x000000, width: 1, alpha: 0.9 });
  }

  /**
   * The magazine read-out: one tick per round in the clip — stacked into up to
   * four rows for magazines past 25 rounds, as `bar_ammo0..3` does — plus the
   * original's "xN" multiplier giving whole reload-clips still in reserve
   * (doc 14 §1.2; `txt_clip.text = "x" + ammo.clip`, `Guns.as:190`).
   * Charge weapons (`percAmmo` / `oneClip`) have no clips to count, so their
   * multiplier slot shows the charge percentage instead.
   */
  private drawMagazine(gun: any): void {
    if (!gun) {
      drawClipTicks(this.dynG, CLIP_X, CLIP_Y, CLIP_W, CLIP_H, 0, 12);
      this.clipMult.visible = false;
      return;
    }

    const clipPer = gun.maxClip ? clamp01(gun.curClip / gun.maxClip) : 0;
    const charge = !!(gun.percAmmo || gun.oneClip);
    drawClipTicks(
      this.dynG, CLIP_X, CLIP_Y, CLIP_W, CLIP_H, clipPer,
      charge ? 20 : gun.maxClip,
      gun.curClip === 0 ? C_DANGER : C_AMMO_WHITE,
    );

    this.clipMult.visible = true;
    if (charge) this.clipMult.text = `${Math.round(clipPer * 100)}%`;
    else if (gun.infAmmo) this.clipMult.text = "x∞";
    else this.clipMult.text = `x${gun.maxClip ? Math.floor(gun.curAmmo / gun.maxClip) : gun.curAmmo}`;
  }

  // --- top-right score header ----------------------------------------------

  /**
   * `Hud.setScore()` (doc 14 §1.5): two rows racing to the win score — you (or
   * your team) against the leading opposition — with the leader carrying the
   * original's `"> "` prefix and each side's `score / winScore` fill bar.
   */
  private drawGameInfo(): void {
    const g = this.dynG;

    this.gtText.text =
      MODE_LABELS[String(SD.matchSettings?.type)] ??
      (SD.matchSettings?.team ? "Team Deathmatch" : "Deathmatch");

    const secs = Math.floor(this.timerTicks / FPS);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    this.timerText.text = `${m}:${s < 10 ? "0" : ""}${s}`;

    const me: any = this.game.player;
    const myTeam: number = me?.team ?? 0;
    let sides: { name: string; score: number; team: number; self: boolean }[];
    if (this.teamMode) {
      const other = myTeam === 1 ? 2 : 1;
      // `Hud.as:382` labels the local player's side "Blue Team" whatever team
      // index it actually holds, and only the opposition is named by its real
      // colour. That is why the original never shows two colours you have to
      // work out — you are always Blue, they are Orange (or Yellow / Green).
      sides = [
        { name: "Blue Team", score: this.teamTotal(myTeam), team: 1, self: true },
        {
          name: `${TEAM_NAMES[other] ?? TEAM_NAMES[2]} Team`,
          score: this.teamTotal(other),
          team: other,
          self: false,
        },
      ];
    } else {
      const rival = this.game.units
        .filter((u) => u !== (me as any))
        .sort((a, b) => b.getScore - a.getScore)[0] as any;
      sides = [
        { name: me?._name || "Player", score: me?.getScore ?? 0, team: 0, self: true },
        { name: rival?._name || "—", score: rival?.getScore ?? 0, team: 0, self: false },
      ];
    }

    const cap = Math.max(1, this.game.match.maxScore || 20, sides[0].score, sides[1].score);
    const lead = sides[0].score >= sides[1].score ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const side = sides[i];
      const row = this.scoreRows[i];
      row.text = `${i === lead ? "> " : ""}${side.name.slice(0, 14)}: ${side.score}`;
      row.style.fill = side.self
        ? this.teamMode ? SELF_TEXT_TEAM : SELF_TEXT_FFA
        : TEAM_TEXT[side.team] ?? TEAM_TEXT[0];

      // Free-for-all gives your own bar the yellow frame and the rival the grey
      // one; on a team both sides take their team's colour frame.
      const grad =
        side.self && !this.teamMode
          ? BAR_SELF_FFA
          : (BAR_GRAD[side.team] ?? BAR_GRAD[0]);
      const y = SC_ROW0_Y + i * SC_ROW_PITCH + SB_DY;
      scoreBar(g, SB_X, y, SB_W, SB_H, side.score / cap, grad[0], grad[1]);
    }

    if (this.elimMode) {
      const me = this.game.player as any;
      const left = this.game.match.livesLeft(me);
      // Elimination has no score cap, so the objective line carries the two
      // numbers that actually decide it: your respawns, and theirs.
      this.objText.text = isFinite(left)
        ? `Lives left: ${left}   ·   To clear: ${this.game.match.killsToClear(me)}`
        : "Last one standing";
    }
    this.drawJugBanner();
  }

  /** Objective total for CTF / Domination, summed kills for the other modes. */
  private teamTotal(team: number): number {
    if (this.game.objectives?.active) return this.game.teamScore[team] ?? 0;
    let total = 0;
    for (const u of this.game.units) if (u.team === team) total += u.getScore;
    return total;
  }

  /**
   * The Juggernaut call-out. Given its own gold panel with a breathing border
   * rather than a line of text, because "who has the crown" changes who every
   * other player in the arena should be shooting at.
   */
  private drawJugBanner(): void {
    const jug: any = SD.matchSettings?.curJug;
    const active = !!jug && !jug.status?.dead;
    if (this.jugPanel.visible !== active) {
      this.jugPanel.visible = active;
      // The feed sits below the banner, so it shifts when the banner appears.
      this.layoutKillFeed();
    }
    if (!active) return;

    const isMe = jug === (this.game.player as any);
    this.jugText.text = isMe ? "YOU HOLD THE CROWN" : `JUG: ${String(jug._name).slice(0, 16)}`;

    const g = this.jugG;
    g.clear();
    const pulse = 0.6 + 0.4 * Math.sin(this.tick * 0.2);
    g.rect(JUG_X, this.jugY, JUG_W, JUG_H).fill({ color: C_ACCENT, alpha: 0.82 });
    // Outward halo: only when glow is on, since it is a second stroked pass.
    if (Quality.glow) {
      g.rect(JUG_X - 3, this.jugY - 3, JUG_W + 6, JUG_H + 6)
        .stroke({ color: C_ACCENT, width: 2, alpha: 0.25 + 0.35 * pulse });
    }
    g.rect(JUG_X, this.jugY, JUG_W, JUG_H)
      .stroke({ color: 0xfff0b0, width: 1.5, alpha: 0.5 + 0.5 * pulse });
  }

  // --- centre status -------------------------------------------------------

  /**
   * The centre line under the crosshair: warm-up countdown before the match,
   * the respawn prompt while down, and nothing at all the rest of the time.
   */
  private drawStatusLine(p: any): void {
    if (this.game.gameOver) return; // setResult owns the line

    if (!this.game.gameStarted) {
      const left = Math.max(0, Math.ceil(this.game.introTimer / FPS));
      this.statusText.text = left > 0 ? `GET READY — ${left}` : "GO!";
      this.statusText.style.fill = C_ACCENT;
      return;
    }

    if (p?.status?.dead) {
      if (!this.game.match.canRespawn(p)) {
        this.statusText.text = "ELIMINATED";
        this.statusText.style.fill = C_DANGER;
      } else if (p.canRespawn) {
        this.statusText.text = "CLICK TO RESPAWN";
        this.statusText.style.fill = this.tick % 24 < 12 ? C_ACCENT : C_TEXT;
      } else {
        const left = Math.max(0, Math.ceil((30 - (p.respawnCount ?? 0)) / FPS));
        this.statusText.text = `RESPAWNING IN ${left}`;
        this.statusText.style.fill = C_DIM;
      }
      return;
    }

    this.statusText.text = "";
  }

  // --- weapon rack + ammo state + credits ----------------------------------

  private drawWeapon(p: any): void {
    this.drawRack(p);
    this.drawAmmoState(p);
    this.drawCredits();
  }

  /**
   * The fixed weapon-holder tiles (doc 14 §1.3). Owned weapons fill them
   * left to right; each shows the tilted weapon glyph, its number-row hotkey,
   * and the in-slot ammo bar tinted `#FFFF00` when selected and `#CCCCCC`
   * otherwise. A weapon with nothing left dims to 0.3 alpha.
   *
   * The hotkey label is the weapon's index in `GUN_ORDER`, not its position in
   * the rack, because that is what the number row is actually bound to.
   */
  private drawRack(p: any): void {
    const g = this.dynG;
    const arsenal = p.gun?.arsenal ?? {};
    const curId = p.gun?.curGun?.id;
    const dead = !!p.status?.dead;

    // The player's own order, not this.gunOrder: it grows with picked-up guns.
    const order: string[] = p.gun?.gunOrder ?? this.gunOrder;
    const owned: { id: string; slot: any }[] = [];
    for (const id of order) {
      if (arsenal[id] && owned.length < RACK_SLOTS) owned.push({ id, slot: arsenal[id] });
    }

    for (let k = 0; k < RACK_SLOTS; k++) {
      const entry = owned[k];
      if (!entry) {
        this.slotIcons[k].visible = false;
        this.slotNums[k].visible = false;
        continue;
      }
      const { id, slot } = entry;
      // Number-row keys are positional, so the tile's index IS its hotkey.
      const hotkey = (k + 1) % 10;
      const x = RACK_X + k * (SLOT_W + SLOT_GAP);
      const sel = id === curId;
      const dry = slot.curClip <= 0 && slot.curAmmo <= 0 && !slot.infAmmo;

      if (sel) {
        g.rect(x, RACK_Y, SLOT_W, SLOT_H)
          .stroke({ color: C_SLOT_SELECTED, width: 2, alpha: 0.95 });
      }

      const icon = this.slotIcons[k];
      if (this.slotIconId[k] !== id) {
        const tex = ArmArt.getIcon(id);
        if (tex) {
          icon.texture = tex;
          this.slotIconId[k] = id;
        }
      }
      if (this.slotIconId[k] === id) {
        this.fitSprite(icon, SLOT_W - 12, SLOT_H - 26);
        icon.visible = true;
        icon.alpha = dead || dry ? 0.3 : 1;
      }

      const num = this.slotNums[k];
      num.text = String(hotkey);
      num.style.fill = sel ? C_SLOT_SELECTED : C_DIM;
      num.visible = true;

      // In-slot bar: total rounds left, current clip included (doc 14 §1.3).
      let frac: number;
      if (slot.infAmmo) frac = 1;
      else if (slot.oneClip || slot.percAmmo) frac = slot.maxClip ? clamp01(slot.curClip / slot.maxClip) : 0;
      else {
        const cur = slot.curClip + slot.curAmmo;
        const max = slot.maxClip + slot.maxAmmo;
        frac = max ? clamp01(cur / max) : 0;
      }
      const barX = x + 7;
      const barY = RACK_Y + SLOT_H - 11;
      const barW = SLOT_W - 14;
      g.rect(barX, barY, barW, 3).fill({ color: 0x000000, alpha: 0.85 });
      if (frac > 0) {
        g.rect(barX, barY, barW * frac, 3).fill({
          color: sel ? C_SLOT_SELECTED : C_SLOT_UNSELECTED,
          alpha: dry ? 0.4 : 1,
        });
      }
    }
  }

  /**
   * The one-word caption over the slab. The magazine ticks already answer "how
   * much is left", so this only speaks up for the states that need a reaction:
   * reloading, empty, running dry, or down.
   */
  private drawAmmoState(p: any): void {
    const gun = p.gun?.curGun;
    if (p.status?.dead) {
      this.ammoState.text = "DOWN";
      this.ammoState.style.fill = C_DANGER;
      return;
    }
    if (!gun) {
      this.ammoState.text = "";
      return;
    }

    const reservePer = gun.maxAmmo ? gun.curAmmo / gun.maxAmmo : 1;
    const lowReserve = !gun.infAmmo && !gun.oneClip && gun.maxAmmo > 0 && reservePer < LOW_AMMO;
    const flash = this.tick % 20 < 10;

    if (p.gun?.reloading) {
      this.ammoState.text = "RELOADING";
      this.ammoState.style.fill = C_ACCENT;
    } else if (gun.curClip === 0) {
      this.ammoState.text = flash ? "EMPTY" : "";
      this.ammoState.style.fill = C_DANGER;
    } else if (lowReserve) {
      this.ammoState.text = flash ? "LOW AMMO" : "";
      this.ammoState.style.fill = C_DANGER;
    } else {
      this.ammoState.text = "";
    }
  }

  /**
   * Credits footer (doc 14 §1.4): the running match earnings and the wallet
   * total, both comma-grouped via addNumCommas like the original.
   */
  private drawCredits(): void {
    const total = SD.credits;
    const earned = Math.max(0, total - this.creditBaseline);
    this.credEarned.text = `${addNumCommas(earned)} cr`;
    this.credTotal.text = `${addNumCommas(total)} cr`;
  }

  /** Scale a sprite to fit a box preserving aspect (position set by caller). */
  private fitSprite(s: Sprite, boxW: number, boxH: number): void {
    const tw = s.texture?.width ?? 0;
    const th = s.texture?.height ?? 0;
    if (tw <= 0 || th <= 0) return;
    s.scale.set(Math.min(boxW / tw, boxH / th, 2));
  }

  // --- full scoreboard overlay (Tab) --------------------------------------

  private drawFullScoreboard(): void {
    this.scoreOverlay.visible = SD.scores;
    if (!SD.scores) return;

    const units: any[] = (this.game.units ?? []).slice();
    units.sort((a, b) => b.getScore - a.getScore || b.spawnOrder - a.spawnOrder);

    // Grow the row-text pool to match the current player count.
    while (this.scoreOverlayRows.length < units.length) {
      const pos = mkText(13, C_DIM, true);
      const name = mkText(13, C_TEXT, false);
      const kills = mkText(13, C_TEXT, true);
      kills.anchor.set(1, 0);
      const deaths = mkText(13, C_TEXT, true);
      deaths.anchor.set(1, 0);
      const kd = mkText(13, C_DIM, false);
      kd.anchor.set(1, 0);
      this.scoreOverlay.addChild(pos, name, kills, deaths, kd);
      this.scoreOverlayRows.push({ pos, name, kills, deaths, kd });
    }

    const h = SC_HEADER_H + Math.max(units.length, 1) * SC_ROW_H + 14;
    this.scoreOverlay.x = GAME_WIDTH / 2;
    this.scoreOverlay.y = Math.round((GAME_HEIGHT - h) / 2);

    const g = this.scoreOverlayG;
    g.clear();
    panel(g, -SC_W / 2, 0, SC_W, h, { accent: C_ACCENT, alpha: 0.93 });
    rule(g, -SC_W / 2 + 12, SC_HEADER_H - 4, SC_W - 24, 0.8);

    this.scoreOverlayTitle.text = "SCOREBOARD";
    this.scoreOverlaySub.text = this.scoreSubtitle(units);

    const me = this.game.player as any;
    for (let i = 0; i < this.scoreOverlayRows.length; i++) {
      const row = this.scoreOverlayRows[i];
      const u = units[i];
      const visible = !!u;
      row.pos.visible = visible;
      row.name.visible = visible;
      row.kills.visible = visible;
      row.deaths.visible = visible;
      row.kd.visible = visible;
      if (!visible) continue;

      const isMe = u === me;
      const col = isMe ? C_ACCENT : this.teamMode ? teamColorOf(u) : C_TEXT;
      const y = SC_HEADER_H + i * SC_ROW_H;

      // The player's own row gets a tinted band so it is findable in a glance
      // even in a full eight-player lobby.
      if (isMe) {
        g.rect(-SC_W / 2 + 6, y - 3, SC_W - 12, SC_ROW_H)
          .fill({ color: C_ACCENT, alpha: 0.12 });
      }

      const kills = u.score?.kills ?? 0;
      const deaths = u.score?.deaths ?? 0;

      row.pos.text = `${i + 1}`;
      row.pos.style.fill = isMe ? C_ACCENT : C_FAINT;
      row.pos.x = SC_COL_POS;
      row.pos.y = y;

      row.name.text = `${(u._name || "?").slice(0, 20)}${u.status?.dead ? " ·" : ""}`;
      row.name.style.fill = col;
      row.name.x = SC_COL_NAME;
      row.name.y = y;

      row.kills.text = String(kills);
      row.kills.style.fill = col;
      row.kills.x = SC_COL_KILLS;
      row.kills.y = y;

      row.deaths.text = String(deaths);
      row.deaths.style.fill = col;
      row.deaths.x = SC_COL_DEATHS;
      row.deaths.y = y;

      // Deaths of zero would divide by zero; the convention is to report the
      // kill count itself as the ratio in that case.
      row.kd.text = (deaths ? kills / deaths : kills).toFixed(2);
      row.kd.style.fill = isMe ? C_ACCENT : C_DIM;
      row.kd.x = SC_COL_KD;
      row.kd.y = y;
    }
  }

  /** Team totals (team modes) or the mode + cap line under the title. */
  private scoreSubtitle(units: any[]): string {
    if (this.teamMode) {
      let t1 = 0;
      let t2 = 0;
      for (const u of units) {
        if (u.team === 1) t1 += u.getScore;
        else if (u.team === 2) t2 += u.getScore;
      }
      return `RED ${t1}   —   BLUE ${t2}`;
    }
    const mode = MODE_LABELS[String(SD.matchSettings?.type)] ?? "Deathmatch";
    return this.elimMode ? mode.toUpperCase() : `${mode.toUpperCase()}   —   FIRST TO ${this.game.match.maxScore || 20}`;
  }
}
