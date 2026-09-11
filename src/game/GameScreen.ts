import { Container, Graphics, Sprite, Text, TextStyle, BlurFilter } from "pixi.js";
import { Backgrounds } from "../assets/Backgrounds";
import { SkinAnim } from "../assets/SkinAnim";
import { GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, PTM, CAMERA_ZOOM, FPS } from "../core/Config";
import { Screen } from "../core/Screen";
import { Input } from "../core/Input";
import { UT } from "../core/UT";
import { SD } from "../state/SD";
import { Quality } from "../state/Quality";
import { Achievements } from "./Achievements";
import { Phys } from "../physics/Phys";
import { Vec2 } from "planck";
import { Arena } from "./Arena";
import { Hud } from "./Hud";
import { Crosshair } from "./Crosshair";
import { Match, DEFAULT_LIVES } from "./Match";
import { Objectives } from "./Objectives";
import { getCamp, type CampaignMessage } from "./Campaign";
import { endReel, loadPanels } from "./Cutscene";
import { getCampaignScript, type CampaignCue } from "./CampaignScript";
import { Tutorial } from "./Tutorial";
import { WEAPONS, GUN_KEYS, type TracerStyle, type TracerOpts } from "./weapons";
import { Player } from "./Player";
import { AI } from "./AI";
import { NetPlayer } from "./NetPlayer";
import { NetGame, type KillEvent, type RosterEntry, type UnitNetState, type NetInput } from "../net/NetGame";
import { Net } from "../net/Net";
import { K } from "../core/K";
import { Sound, MATCH_MUSIC } from "../audio/Sounds";
import { Unit } from "./Unit";
import {
  Raze2Button,
  Raze2Panel,
  Raze2Toggle,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_LABEL,
  C_BODY,
  C_OPTIONS_GREEN,
  A_HEADER,
  A_LABEL,
  A_BODY,
} from "../ui/raze2";
import { ScoreBoard, type ScoreRow } from "../screens/ScoresScreen";
import { C_VICTORY, C_DANGER } from "./HudComponents";
import { QUALITY_LEVELS } from "../state/Quality";

const DEG = Math.PI / 180;
/** Team-banner display names for the pause scoreboard (doc 12 §2.3). */
const TEAM_NAMES = ["Blue", "Orange", "Yellow", "Green"];

// --- round-end card, in 30fps ticks ----------------------------------------
/** Fade-in. Short enough that the standings are readable almost immediately. */
const ROUND_END_FADE = Math.round(FPS * 0.6);
/** Total time the card is up before it hands back to the level screen. */
const ROUND_END_HOLD = FPS * 3;
const ROUND_END_BOARD_W = 700;

/**
 * Effect types that belong *behind* unit bodies: gore should pool around a
 * body rather than paint over its face. Everything else — impacts, explosions,
 * pickup rings, popups — is feedback the player has to be able to read, so it
 * goes in front. See the layer fields on {@link GameScreen}.
 */
const FX_BEHIND = new Set(["blood", "bloodBig"]);
import { createEffect, type FxObject } from "./Fx";
import * as Fx from "./Fx";

/** One vertex of a tracer polyline, with a per-point drift ("lift"). */
interface TVert {
  x: number;
  y: number;
  lift: number;
}

/**
 * A shot tracer. Ported from Raze 2's `Bullet_Line_*` draw system (doc 05):
 * most guns flash a randomly-dashed line for a single frame, while the
 * sniper/electric/effect families persist and drift/fade over ~1s. The
 * geometry is generated once (in `addTracer`) and re-stroked each tick so the
 * dashes/jitter stay stable rather than shimmering every frame.
 */
interface Tracer {
  g: Graphics;
  life: number;
  /** Life it started with, so the fade ramp is correct at any quality. */
  max: number;
  /** Muzzle end / impact end. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  style: TracerStyle;
  color: number;
  color2: number;
  w1: number;
  w2: number;
  a1: number;
  a2: number;
  /** Perpendicular bow, in px. Non-zero only when the ray bit a body. */
  bow: number;
  // --- pre-generated geometry (per style) --------------------------------
  /** basic: flat list of dash-segment coords [ax,ay,bx,by, ...]. */
  segs?: number[];
  /** sniper/laser/zapper: primary polyline of vertices along the ray. */
  poly?: TVert[];
  /** laser/zapper: the parallel second strand. */
  poly2?: TVert[];
  /** electric: three independently-jittered strands. */
  strands?: TVert[][];
  /** bend: quadratic control points + their random offset. */
  bend?: { mx: number; my: number; c1x: number; c1y: number; c2x: number; c2y: number; ox: number; oy: number };
  /** zapper: line thickness multiplier from hit distance. */
  strength?: number;
  /** effect (railgun): unit direction for the chasing spark. */
  ux?: number;
  uy?: number;
  len?: number;
}

/**
 * Frames a red damage vignette takes to fade out. ~0.4s at the fixed 30Hz
 * tick: long enough to register in peripheral vision, short enough that
 * sustained fire doesn't leave the screen permanently red.
 */
const HIT_FLASH_FRAMES = 12;
/** `whiteFlash_139` runs 30 frames and stops — one second at the SWF's 30fps. */
const WHITE_FLASH_FRAMES = 30;

/**
 * How much of the camera's motion the backdrop follows: 0 = welded to the
 * screen, 1 = welded to the world. Purely a *motion* setting — it must not be
 * used to derive the backdrop's size (see BG_SLACK below for why that was
 * wrong).
 */
const BG_PARALLAX = 0.5;

/**
 * Sub-pixel slack, in px, added to the span the backdrop has to cover. The
 * parallax step is rounded to whole pixels, so without it the far edge can
 * land a hair inside the viewport and flash a one-pixel gap.
 */
const BG_SLACK = 2;

/**
 * Camera, ported term for term from `Arena.EnterFrame` (`Arena.as:1063-1171`).
 *
 *     tx = W*0.5 - focus.x - (mouseX - W*0.5) * camIntenseX
 *     ty = H*0.5 - focus.y - (mouseY - H*0.5) * camIntenseY + 20
 *     x += (tx - x) * 0.7        // then clamp, not before
 *
 * Two things make it feel like Raze rather than a generic follow-cam: the view
 * *leads toward the cursor* by half its offset from screen centre, so aiming
 * across the map shows you what you are aiming at; and the ease is a stiff 0.7
 * per frame, so it tracks rather than floats.
 */
/** `x += (target - x) * CAM_EASE` per 30Hz tick (`Arena.as:1147-1148`). */
const CAM_EASE = 0.7;
/** Default `camIntenseX/Y` — the share of the cursor's screen offset the camera
 *  leads by (`Arena.focus`'s `param3` default). */
const CAM_INTENSE = 0.5;
/** Constant downward bias on the camera target, so the unit sits slightly below
 *  centre and you see more of what is above them (`Arena.as:1138,1143`). */
const CAM_Y_BIAS = 20;
/** The camera may ride 5px past the top of the level (`Arena.as:1153-1156`). */
const CAM_TOP_SLACK = 5;
/** ...and 45px past the bottom, which is what kept the level's bottom edge clear
 *  of the original's bottom HUD strip (`Arena.as:1161-1170`). */
const CAM_BOTTOM_INSET = 45;
/** Per-tick bleed on a shake amplitude (`Arena.as:1072,1085`). */
const SHAKE_DECAY = 0.2;

/** Seconds the mission briefing holds before the scripted dialogue opens. */
const CAMP_BRIEF_HOLD = 9;

/** Mission numbers of the two campaign finales (1-15 Human, 16-30 Alien), the
 *  only missions the original puts on a clock. */
const HUMAN_FINALE = 15;
const ALIEN_FINALE = 30;
/** `Hud.as:652,656`: the warning line at 30*4*60 and the forced loss 30*5
 *  frames later. */
const CAMP_FINALE_WARN = 4 * 60 * FPS;
const CAMP_FINALE_END = CAMP_FINALE_WARN + 5 * FPS;
/** `setCampMsg(..., 6)` — both finale lines hold for six seconds. */
const CAMP_FINALE_HOLD = 6;
/** ...or, on a mission with no briefing, the silence before its first line.
 *  Human 1's first line is at `fc==60`, the earliest any mission speaks. */
const CAMP_LEAD_IN = 2;

/**
 * The playable game screen. Ported from Game.as — the orchestrator that owns
 * the arena, physics, units, match rules and HUD, and drives them each tick.
 *
 * The original Initialize() (heavily obfuscated) built the roster from the menu
 * settings; here we build a quick deathmatch from SD.matchSettings, defaulting
 * sensible values so the game runs directly while the menu is still being
 * ported (task 7).
 */
export class GameScreen extends Screen {
  arena: Arena;
  rdPhys!: Phys;
  hud: Hud;
  match: Match;
  units: Unit[] = [];
  player!: Player;

  /** CTF / Domination objective controller (Raze 2 modes); null otherwise. */
  objectives: Objectives | null = null;
  /** Team objective score (captures / domination points) for ctf & dom. */
  teamScore: Record<number, number> = { 1: 0, 2: 0 };
  /** The mission's scripted dialogue, in script order. */
  private campMessages: CampaignMessage[] = [];
  /** Index of the next line to speak. */
  private campNext = 0;
  /** Frames until that line is spoken. */
  private campWait = 0;
  /** The mission's `runScripts` cues, or empty when only its text was extracted. */
  private campCues: CampaignCue[] = [];
  /** Cues already fired, by index into `campCues`. */
  private campFired = new Set<number>();
  /** Raze 2's `fc`: the script clock the frame gates are counted against. */
  private campFc = 0;
  /** The player opened this mission with empty magazines and is still owed them. */
  private campNoAmmo = false;
  /** Mission 1's guided walkthrough; null on every other match. While it is
   *  running it owns the mission and the deathmatch script is held back. */
  tutorial: Tutorial | null = null;

  gameStarted = false;
  gameOver = false;
  /** Set once the exit from a finished match is committed, so the click that
   *  dismisses the result banner can't queue the handoff twice. */
  private leaving = false;
  /** SD reads `.main`; we expose the engine for stage/quality pokes. */
  main: any;

  /** Online role: "off" (single-player), "host" (authoritative) or "client". */
  netRole: "off" | "host" | "client" = "off";
  /** Net units by netId (all roles), for snapshot matching. */
  private netUnits = new Map<string, Unit>();
  /** Host: kill events accumulated since the last broadcast. */
  private netKills: KillEvent[] = [];
  /** Host: countdown to the next roster (identity) broadcast. */
  private rosterTimer = 0;
  /** Client: rolling id used to lazily create bot costumes deterministically. */
  private clientCreated = new Set<string>();
  /** Client: last mouse-wheel value, for weapon-cycle edge detection. */
  private prevWheelClient = 0;
  /** Net: unsubscribe from the server's matchEnd signal. */
  private netMatchEndUnsub: (() => void) | null = null;

  /** Round-end card: VICTORY/DEFEAT over the final scoreboard. Built by
   *  {@link endGame}, so it is null for the whole of a live match. */
  private roundEnd: Container | null = null;
  private roundEndBg = new Graphics();
  private roundEndHeader: Text | null = null;
  private roundEndBoard: ScoreBoard | null = null;
  /** Ticks since the match ended. Drives the fade-in and the auto-exit. */
  private roundEndTicks = 0;

  private pauseOverlay!: Container;
  /** Pause sub-screens (doc 12 §2.2): idle content, scoreboard, options, quit
   *  confirm. The mission title/blurb + the four buttons themselves are
   *  persistent siblings, not part of any one sub-screen (doc 12 §2.2/gap 1). */
  private pauseMain!: Container;
  private pauseScores!: Container;
  private pauseOptions!: Container;
  private pauseQuit!: Container;
  /** Top-center frame title, swapped per active sub-screen ("PAUSED" /
   *  "VIEW SCORES" / "OPTIONS" / "QUIT GAME"). */
  private pauseTitle!: Text;
  /** The three tab buttons that persist across sub-screens and show the
   *  active tab as a dimmed/selected ghost (doc 12 §2.2). "Resume Game" is
   *  never a tab — it acts immediately. */
  private pauseTabButtons!: Record<"scores" | "options" | "quit", Raze2Button>;
  /** Holder the live scoreboard is rebuilt into each time it is shown. */
  private pauseScoreHolder!: Container;
  /** "Pause Blur" option (doc 14 §4): blur/darken the frozen game behind the
   * menu. Seeded from the persisted setting and honoured live from the
   * in-match Options toggle. */
  private pauseBlur = SD.pauseBlur;
  private pauseBlurFilter: BlurFilter | null = null;
  private crosshair!: Crosshair;
  /** Transient "SCREENSHOT MODE" toast — lives outside the HUD so it is still
   * visible on the frame that hides the HUD. */
  private ssToast!: Text;
  private ssToastTicks = 0;
  private unsubQuality: (() => void) | null = null;
  /**
   * World layers, bottom to top: effects that belong behind bodies (blood,
   * smoke, shells), the ragdoll world, the units themselves, then effects that
   * belong in front (muzzle flashes, explosions, tracers, popups).
   *
   * Before this split every effect shared one container that sat *under* every
   * unit, so a muzzle flash was drawn behind the arm holding the gun.
   */
  private fxBehind = new Container();
  private unitLayer = new Container();
  private fxFront = new Container();
  private frameEff: any[] = [];
  private fx: FxObject[] = [];
  private tracers: Tracer[] = [];
  /** Red "you are being hit" vignette, drawn over the arena but under the HUD. */
  private damageFlash = new Graphics();
  /** Scripted white-out (the tutorial's missile strike). Separate from the
   *  damage vignette: it is a story beat, not a health cue, so "Bloody Screen"
   *  does not silence it. */
  private whiteFlash = new Graphics();
  private whiteFlashTicks = 0;
  private hitFlash = 0;
  private hitFlashPeak = 0;
  /** Frames of warm-up left before the match goes live. Read by the HUD. */
  introTimer = 30;
  /** Flat fill under the backdrop, so a resize can never expose a raw gap. */
  private flatBg = new Graphics();
  /** Pause dim + vignette, redrawn on resize so it still covers the window. */
  private pauseBg!: Graphics;
  /**
   * The pause menu's left column + right pane, laid out against the design
   * width and shifted as a block so a wider window centres it instead of
   * stranding it against the left edge under a centred title.
   */
  private pauseBody = new Container();
  /** Backdrop parallax layer and its origin at camera (0, 0). */
  private bgSprite: Sprite | null = null;
  private bgHome = { x: 0, y: 0 };
  private camX = 0;
  private camY = 0;
  /** `useAim` — whether the camera leads toward the cursor (`Arena.focus`). */
  private camUseAim = true;
  /** `camIntenseX/Y` — how far it leads. */
  private camIntense = CAM_INTENSE;
  /** Live shake amplitudes in px, bled off per tick. See `shakeCamera`. */
  private shakeX = 0;
  private shakeY = 0;
  /**
   * Debug hitbox overlay (M). One Graphics for every box on screen — units,
   * walls, pickups and ragdoll fixtures all batch into a handful of strokes
   * rather than one draw call per body.
   */
  private hitboxG = new Graphics();
  private hitboxLabel!: Text;
  /** Pixel-perfect red silhouette of the wall mask (Raze 2 maps), created once
   *  and toggled with the overlay — shows slopes instead of a blocky cell grid. */
  private maskSil: Sprite | null = null;
  /** True on the frame the overlay was last drawn, so it clears exactly once. */
  private hitboxDrawn = false;

  /** Sandbox: when true, every AI bot is frozen (brain skipped). Toggled with B. */
  botsDisabled = false;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);
    this.main = { _stage: {}, stage: {} };

    this.ensureMatchSettings();

    // Online multiplayer role (set by LobbyScreen on match start).
    const mp = (SD as any).mp;
    if (mp && mp.selfId && mp.hostId) {
      this.netRole = mp.isHost ? "host" : "client";
      NetGame.begin(this.netRole, mp.selfId, mp.hostId, mp.seed);
      // Everyone returns to the party lobby when the match ends.
      this.netMatchEndUnsub = Net.on("matchEnd", () => this.returnToLobby());
    } else {
      this.netRole = "off";
    }

    SD.setGame(this as any);
    SD.paused = false;
    SD.scores = false;

    // Background. Flat fill underneath so the backdrop can never leave a gap.
    this.view.addChild(this.flatBg);

    this.arena = new Arena();

    // Level backdrop: sits above the flat fill and below the camera-translated
    // arena view. The authentic level art is ~70% transparent (city is all sky
    // above the rooftops), so this is what the player actually sees behind the
    // geometry — it has to be drawn at the *world's* scale, not the viewport's,
    // or the skyline looks like a toy model behind full-size buildings.
    const bgTex = Backgrounds.getTexture(this.arena.level);
    if (bgTex) {
      const s = new Sprite(bgTex);

      const worldW = Math.max(GAME_WIDTH, this.arena.worldW);
      const worldH = Math.max(GAME_HEIGHT, this.arena.worldH);
      const texW = (bgTex as any).width || GAME_WIDTH;
      const texH = (bgTex as any).height || GAME_HEIGHT;

      // 1. Scale. The backdrop art was authored to fill the stage back when the
      //    whole level fit on it; here the level is drawn 1:1 in world px and
      //    the camera scrolls, so the sky has to span the *world* rect or the
      //    skyline reads at roughly viewport/world scale — about half size on
      //    city — behind full-size geometry. This is the part sizing off the
      //    parallax factor got wrong: 0.5 only got the sky to 73% of world
      //    scale, so it still looked like a toy model.
      const coverScale = Math.max(worldW / texW, worldH / texH);

      // 2. Coverage floor. Because the sprite moves at only BG_PARALLAX of the
      //    camera speed it travels less than the camera does, so it must span
      //    at least screen + parallax-share-of-world to stay covering the
      //    viewport at both ends of the travel. World cover always clears this
      //    for BG_PARALLAX <= 1, but keep it as a guard.
      //    The camera's vertical travel is slightly larger than the world: it
      //    may ride CAM_TOP_SLACK above the level and CAM_BOTTOM_INSET below
      //    it, so that extra band has to be covered too.
      const camTravelH = worldH - GAME_HEIGHT + CAM_TOP_SLACK + CAM_BOTTOM_INSET;
      const needW = GAME_WIDTH + BG_PARALLAX * (worldW - GAME_WIDTH) + BG_SLACK;
      const needH = GAME_HEIGHT + BG_PARALLAX * camTravelH + BG_SLACK;

      // Uniform scale on both axes — level worlds are not all 16:9 (pit is
      // taller than it is wide), and stretching each axis independently would
      // shear the skyline.
      // Multiply by the camera zoom so the parallax sky sits at the same scale
      // as the now zoomed-up world geometry (the arena's own art zooms with
      // arena.view; this separate layer must match or it reads as a toy model).
      const scale = Math.max(coverScale, needW / texW, needH / texH) * CAMERA_ZOOM;
      s.width = texW * scale;
      s.height = texH * scale;

      // 3. Origin. The backdrop's top-left is welded to the *world's* top-left,
      //    exactly like the level art (Arena.buildFromData places it at 0,0 with
      //    a (0,0) anchor). At camera (0,0) both sprites therefore start at
      //    screen (0,0) and the sky meets the top of the geometry with no gap.
      //
      //    Centring the surplus over the travel band instead — which is what
      //    this used to do — pushed the sky up and left by half the overhang
      //    (~200px vertically on city), so the horizon sat above the rooftops.
      //    The surplus is not wasted: it is exactly the slack the sprite needs
      //    to still cover the viewport at the far end of its parallax travel,
      //    since it moves BG_PARALLAX slower than the camera and so trails
      //    behind it. needW/needH guarantee the sprite is big enough for that,
      //    so hanging the whole surplus off the far edge is safe.
      s.x = 0;
      s.y = 0;
      this.bgSprite = s;
      this.bgHome = { x: 0, y: 0 };
      this.view.addChild(s);
    }

    this.view.addChild(this.arena.view);

    this.match = new Match(this as any);
    this.hud = new Hud(this);

    this.initialize();
    // The hitbox overlay lives in arena space so it scrolls with the world,
    // and is added after initialize() so it sits above every unit and pickup.
    this.arena.view.addChild(this.hitboxG);
    // M is a global toggle on the Input singleton (the menu also listens for
    // M, for music), so start every match with the overlay off rather than
    // inheriting whatever the menu left behind.
    Input.showHitboxes = false;
    // Above the arena, below the HUD: the vignette must not obscure the bars
    // the player is checking *because* they just got shot.
    this.view.addChild(this.damageFlash);
    this.view.addChild(this.whiteFlash);
    this.view.addChild(this.hud.view);
    this.buildPauseOverlay();

    // Crosshair overlay, always on top. Restyles itself from the player's
    // weapon each frame (class colour, live spread cone, reload ring).
    this.crosshair = new Crosshair();
    this.view.addChild(this.crosshair.view);

    // Screenshot-mode toast, above everything including the (hidden) HUD.
    this.ssToast = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "monospace",
        fontSize: 16,
        fontWeight: "bold",
        letterSpacing: 2,
        stroke: { color: 0x000000, width: 4 },
      }),
    });
    this.ssToast.anchor.set(0.5, 0);
    this.ssToast.y = 12;
    this.ssToast.alpha = 0;
    this.view.addChild(this.ssToast);

    // Hitbox readout: bottom-left, out of the way of the HUD's bars and the
    // kill feed. Only visible while the overlay is on.
    this.hitboxLabel = new Text({
      text: "",
      style: new TextStyle({
        fill: 0x66ff88,
        fontFamily: "monospace",
        fontSize: 12,
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    this.hitboxLabel.x = 8;
    this.hitboxLabel.visible = false;
    this.view.addChild(this.hitboxLabel);

    // Re-apply glow/detail settings to live chrome whenever they change.
    this.unsubQuality = Quality.onChange(() => this.applyQuality());
    this.applyQuality();

    this.resize();

    // Hide the OS cursor in-game (the crosshair replaces it).
    const canvas = (this.engine as any).app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = "none";
  }

  /** Push the current quality profile into anything already on screen. */
  private applyQuality(): void {
    this.hud.applyQuality();
    if (this.main && this.main._stage && !SD.ssMode) {
      this.main._stage.quality = Quality.stageQuality;
    }
  }

  // --- screenshot / spectator mode ---------------------------------------

  /**
   * Hide (or restore) every piece of on-screen chrome: the whole HUD (bars,
   * kill feed, scoreboard, timer, banners), the floating unit name tags and
   * the crosshair. Called by SD.setSSmode. Gameplay and audio keep running.
   */
  applySSmode(on: boolean): void {
    const vis = !on;
    this.hud.setSSmode(on);
    for (const u of this.units) (u as any).setChromeVisible?.(vis);
    if (this.crosshair) this.crosshair.visible = vis;
  }

  private toggleSSmode(): void {
    const before = SD.ssMode;
    SD.toggleSSmode();
    // Refused — no live match, or the pause/scoreboard overlay owns the screen.
    if (SD.ssMode === before) return;
    this.ssToast.text = SD.ssMode
      ? "SCREENSHOT MODE  ON  -  press H to restore HUD"
      : "SCREENSHOT MODE  OFF";
    this.ssToast.alpha = 1;
    this.ssToastTicks = 60; // ~2s at 30fps
  }

  private ensureMatchSettings(): void {
    const m = SD.matchSettings;
    m.type ??= "dm";
    m.diff ??= 1;
    m.opponents ??= 3;
    m.level ??= "city";
    m.score ??= 20;
    m.dmgMod ??= 1;
    m.ff ??= false;

    // --- Raze 2 special modes (doc 11 §2) --------------------------------
    // `specialMode` is the authored string; the flags below are the derived
    // per-system switches the gameplay code branches on so each subsystem never
    // has to string-compare. Achievement-gating of which modes are *selectable*
    // happens in the Quick Match UI (PlayScreen) against SD.modesUnlocked; by
    // the time a match boots the mode is already chosen, so here we just apply it.
    m.specialMode ??= "None";
    const sm = String(m.specialMode);
    // Sandbox: infinite ammo for everyone (see Guns.tryShoot). Explicit so a
    // regular match after a sandbox run doesn't inherit the flag. "Infinite Ammo"
    // (doc 11 §2.1) has the same effect — the per-shot clip deduction is skipped,
    // so the weapon fires forever without reloading.
    m.infiniteAmmo = m.level === "sandbox" || sm === "Infinite Ammo";
    // "Infinite Clips": reloads never consume the reserve pool, so you still
    // reload a finite magazine but never run dry (Guns.startReload/endReload).
    m.infiniteClips = sm === "Infinite Clips";
    // "4x Health": every unit's base max HP is x4 (before the flat Combat Armor
    // add — see Status ctor). 1 = normal.
    m.hpMult = sm === "4x Health" ? 4 : 1;
    // "Moon Corpses": low ragdoll-world gravity (applied to rdPhys in initialize).
    m.moonCorpses = sm === "Moon Corpses";
    // "lol cats": cosmetic-only (rainbow blood on death — see Unit.killGuy).
    m.lolCats = sm === "lol cats";
    // Elimination modes need a life count. Everything else defaults to 0 —
    // a truthy `lives` switches Unit.getScore over to lives-remaining.
    if (m.type === "elim" || m.type === "telim") m.lives ??= DEFAULT_LIVES;
    else m.lives ??= 0;
    // Team roster assignment follows the mode unless the caller set it (campaign).
    m.team ??= m.type === "tdm" || m.type === "telim" || m.type === "ctf" || m.type === "dom" ? 1 : 0;
    // Numeric side count (doc 11 §3): 1 = FFA, 2-4 team slots. CTF is always 2.
    if (m.type === "ctf") m.teams = 2;
    else m.teams ??= m.team ? 2 : 1;
    m.curJug = null;
  }

  private initialize(): void {
    const m = SD.matchSettings;
    this.rdPhys = new Phys(this.arena.corpseGeometry);
    // PhysVap rasterises a corpse through the renderer, and drops queued ones
    // that have left the view — both need a handle the physics world can't
    // reach on its own.
    this.rdPhys.vap.renderer = (this.engine as any).app?.renderer ?? null;
    this.rdPhys.arena = this.arena;
    // Waterfall droplets and landing snowflakes throw the same little splash
    // the SWF fires from `Particle.EnterFrame`.
    this.arena.onSplash = (x, y) => this.addEffect(x, y, "snow_splash");
    // "Moon Corpses" special mode (doc 11 §2.1): drop the ragdoll world's
    // gravity from the default 10 to 2 so corpses flail and drift like they're
    // on the moon. Only the death/ragdoll physics world is affected — live-unit
    // movement uses its own kinematic gravity constant, unchanged.
    if (m.moonCorpses) this.rdPhys.world.setGravity(new Vec2(0, 2));
    // Stack the world layers once, up front, so everything added later lands in
    // the right one by construction rather than by insertion order. Corpses sit
    // above the gore they leave but below the living.
    this.arena.view.addChild(this.fxBehind);
    this.arena.view.addChild(this.rdPhys.view);
    this.arena.view.addChild(this.unitLayer);
    this.arena.view.addChild(this.fxFront);

    // The map props the author put ABOVE `midCont` — the tut map's conveyor
    // machinery and lights, which the player runs behind. Everything in this
    // block above is what the SWF packs into `midCont` itself.
    if (this.arena.props?.count) this.arena.view.addChild(this.arena.props.front);

    if (this.netRole === "off") this.buildRosterLocal();
    else if (this.netRole === "host") this.buildRosterHost();
    else this.buildRosterClient();

    this.match.setPlayers();
    // CTF / Domination objective controller (uses the Raze 2 map's flag / hold
    // nodes). Inactive — and harmless — on maps without them.
    if (m.type === "ctf") this.objectives = new Objectives(this, "ctf");
    else if (m.type === "dom") this.objectives = new Objectives(this, "dom");
    // Juggernaut mode: crown a random combatant at the start; the crown then
    // passes to whoever slays the Juggernaut (see Unit.killGuy). First to the
    // score cap wins, so everyone hunts the buffed crown-holder.
    else if (m.type === "jug" && this.units.length) {
      const pick = this.units[Math.floor(Math.random() * this.units.length)];
      pick.setJug?.();
    }
    // The warm-up countdown lives on the HUD's centre status line now, so the
    // banner stays free for transient notices ("Bots disabled").

    // Campaign: mission briefing + scripted dialogue + the mission's own track.
    if (m.campaign) {
      const entry = getCamp(Number(m.campaign));
      if (entry) {
        if (entry.settings.matchName) this.hud.announce?.(entry.settings.matchName, 0xffcc33);
        this.campMessages = entry.messages;
        this.campCues = getCampaignScript(Number(m.campaign))?.cues ?? [];
        // The briefing opens the mission in the same box the dialogue uses. It
        // used to go to the kill feed, which right-aligns one unwrapped run —
        // a 250-character briefing started a long way off the left of screen.
        if (entry.settings.matchDesc) {
          this.hud.setCampMsg?.(null, "Mission", entry.settings.matchDesc, CAMP_BRIEF_HOLD);
          this.campWait = CAMP_BRIEF_HOLD * FPS;
        } else {
          this.campWait = CAMP_LEAD_IN * FPS;
        }
        if (SD.music && entry.settings.music) {
          // Campaign scripts name Raze 2 tracks as "M_<Name>"; our keys are "R2_<Name>".
          Sound.setMusic("R2_" + entry.settings.music.replace(/^M_/, ""));
        }
      }
    } else if (SD.music) {
      Sound.setMusic(MATCH_MUSIC[Math.floor(Math.random() * MATCH_MUSIC.length)]);
    }
    // Ambient bed for this arena — wind on the rooftops, ventilation in space,
    // a failing mains buzz in the toxic plant. Torn down in destructor().
    Sound.setAmbience(String(m.level ?? "city"));

    if (m.level === "sandbox") {
      this.hud.addMessage?.("SANDBOX — infinite ammo · press B to toggle bot AI", 0x66ccff);
    }
  }

  /**
   * Run the mission's in-match script.
   *
   * Where `CampaignScript` has the mission's `runScripts` cues, this is the
   * original's own logic: a cue fires on an absolute script frame (`fc == 30*N`)
   * or on a team-score threshold, and speaks a line, calls in reinforcements or
   * releases a scripted escort. Missions whose gates have not been read back out
   * of the decompile keep the old fallback — their lines play back-to-back,
   * paced by their own display durations, which preserves the order but not the
   * silences between beats.
   */
  private tickCampaignDialogue(): void {
    // Neither path opens until the mission briefing has had its say.
    if (this.campWait > 0) {
      this.campWait--;
      return;
    }

    // The walkthrough owns mission 1 until it hands over; its own beats would
    // otherwise be talked over by the deathmatch script's cues.
    if (this.tutorial?.running) return;

    if (this.campCues.length) {
      this.campFc++;
      const score = this.teamTotals()[this.player.team || 1] ?? 0;
      this.campCues.forEach((cue, i) => {
        if (this.campFired.has(i)) return;
        if (cue.fc !== undefined && this.campFc < cue.fc) return;
        if (cue.score !== undefined && score < cue.score) return;
        this.campFired.add(i);
        this.runCampCue(cue);
      });
      return;
    }

    if (this.campNext >= this.campMessages.length) return;
    const msg = this.campMessages[this.campNext++];
    this.speakCampMsg(this.campNext - 1);
    this.campWait = Math.round(msg.hold * FPS);
  }

  /**
   * `Hud.as:648-676`: mission 15 of either campaign runs on a hard clock.
   *
   * At 4:00 the last line plays — Dani on the Human side, the player himself on
   * the Alien side — and at 4:05 the mission is **lost outright** regardless of
   * score. The port had no match clock wired to anything, so both campaign
   * finales could be taken at leisure; the meteor never landed.
   */
  private tickCampaignTimeout(): void {
    const num = Number(SD.matchSettings?.campaign ?? 0);
    if (num !== HUMAN_FINALE && num !== ALIEN_FINALE) return;
    const t = this.hud.gameTime;
    if (t === CAMP_FINALE_WARN) {
      if (num === HUMAN_FINALE) {
        this.hud.setCampMsg?.("girl", "Dani", "Sir, we're too late...", CAMP_FINALE_HOLD);
      } else {
        // `units[0]` is the player, so the Alien side's line is his own.
        this.hud.setCampMsg?.(
          SD.profile.prof_skin ?? null,
          SD.profile.name,
          "Time is up comrads, we are all doomed...",
          CAMP_FINALE_HOLD,
        );
      }
    } else if (t >= CAMP_FINALE_END) {
      this.endGame(false);
    }
  }

  /** Apply one `runScripts` branch. */
  private runCampCue(cue: CampaignCue): void {
    if (cue.msg !== undefined) this.speakCampMsg(cue.msg);

    for (const s of cue.spawn ?? []) {
      // Roster slots are 1-based in the script (unit 0 is the human).
      this.units[s.unit]?.spawnScripted(s.x, s.y);
    }

    for (const slot of cue.release ?? []) {
      const u = this.units[slot];
      if (!u) continue;
      u.extra.aimPlayer = false;
      u.extra.speak = null;
      // Clearing the station is not enough on its own — a scripted escort is
      // parked on a near-infinite hold that only `wait(0)` releases.
      (u as any).wait?.(0);
    }
  }

  /**
   * Hand the mission's held-back magazines over — the safety net that rides the
   * first scripted line, so a mission that opens you dry can never be
   * unwinnable. Mission 1 means it: you stay empty through the walkthrough and
   * shoot with the Resupply ability it teaches you, and this only lands once the
   * walkthrough has handed the mission over.
   */
  private grantCampAmmo(): void {
    if (!this.campNoAmmo) return;
    this.campNoAmmo = false;
    this.player.gun.refillAll();
    this.hud.announce?.("AMMO RESUPPLIED", 0x66ccff);
  }

  /** The walkthrough is done: start the deathmatch script's clock from zero
   *  (`game.fc = 0`), so its frame gates count from the hand-over. */
  startCampScript(): void {
    this.campFc = 0;
  }

  /** Speak one line from the mission's extracted dialogue. */
  private speakCampMsg(i: number): void {
    const msg = this.campMessages[i];
    if (!msg) return;
    // whoUnit 0 is the player, whose portrait and name are only known here.
    const self = msg.unit === 0;
    const portrait = self ? SD.profile.prof_skin : msg.portrait;
    const speaker = self ? SD.profile.name : msg.speaker;
    const text = msg.text.replace(/\{player\}/gi, SD.profile.name);
    this.hud.setCampMsg?.(portrait ?? null, speaker ?? null, text, msg.hold);

    // Safety net for a mission that opens the player with empty magazines: the
    // grant rides the first line so the mission can never be unwinnable, even
    // if the walkthrough that normally hands the ammo over is skipped.
    this.grantCampAmmo();
  }

  // --- roster construction (per net role) --------------------------------

  private makeSelfPlayer(team: number, scripted: any = {}): Player {
    const p = new Player(this, team, {
      head: SD.profile.prof_head,
      body: SD.profile.prof_body,
      legs: SD.profile.prof_legs,
      preset: SD.profile.prof_preset,
      skin: SD.profile.prof_skin, // equipped Raze 2 skin -> animated live rig
      gun: SD.matchSettings.loadoutGun,
      ...scripted,
    });
    p.spawnOrder = 101;
    this.unitLayer.addChild(p.view);
    this.units.push(p);
    return p;
  }

  /**
   * A mission's scripted overrides for the human (Raze 2 `setMatch`'s
   * `player.extra`): the single weapon it puts in your hands, the ability it
   * takes away and where it opens you. `noAmmo` is not here — the arsenal has
   * to exist before it can be emptied.
   */
  private campaignPlayerExtra(num: number): any {
    const p = getCampaignScript(num)?.player;
    if (!p) return {};
    const extra: any = {};
    // A scripted weapon is the mission's whole arsenal, not just what you open
    // holding — mission 1's briefing reads "Weapon: Shotgun" and its walkthrough
    // gates on you actually firing one.
    if (p.gun && WEAPONS[p.gun]) {
      extra.gun = p.gun;
      extra.equipGuns = [p.gun];
    }
    if (p.ability) extra.ability = p.ability;
    if (p.spawn) extra.spawn = { ...p.spawn };
    return extra;
  }

  /** Single-player: local player + AI bots (original behaviour). */
  private buildRosterLocal(): void {
    const m = SD.matchSettings;
    const teamMatch = !!m.team;

    // Campaign: spawn the mission's scripted roster (fixed names / skins /
    // weapons / difficulty / teams) instead of random opponents. The human is
    // team 1 in objective missions; enemy bots keep their scripted team.
    if (m.campaign) {
      const entry = getCamp(Number(m.campaign));
      if (entry) {
        const num = Number(m.campaign);
        this.player = this.makeSelfPlayer(teamMatch ? 1 : 0, this.campaignPlayerExtra(num));
        // A mission can open you dry; the first scripted line hands the ammo back.
        if (getCampaignScript(num)?.player?.noAmmo) {
          this.campNoAmmo = true;
          this.player.gun.emptyAll();
        }
        // Which roster slots does this mission's script actually call in? A bot
        // parked by `noSpawn` sits off-map until a cue spawns it, so if no cue
        // names its slot — because that mission's `runScripts` branch has not
        // been transcribed — it would wait out the whole match and the mission
        // would field a fraction of its roster. Those bots open normally
        // instead: less faithful than the scripted entrance, but playable.
        const scripted = new Set<number>();
        for (const cue of getCampaignScript(num)?.cues ?? []) {
          for (const sp of cue.spawn ?? []) scripted.add(sp.unit);
        }

        entry.ai.forEach((a, i) => {
          const team = teamMatch ? (a.team === 1 ? 1 : 2) : 0;
          // Roster slots are 1-based in the scripts (slot 0 is the human).
          const parked = !!a.noSpawn && scripted.has(i + 1);
          const extra: any = {
            preset: a.preset ?? Math.floor(Math.random() * 20 + 1),
            pers: a.pers,
            diff: a.diff,
            name: a.name,
            skin: a.skin, // scripted cast member — drives the live rig, not just the portrait
            // Scripted staging: where the unit opens, whether it opens at all,
            // and the escort locks the script releases later.
            spawn: a.spawn,
            noSpawn: parked,
            speak: a.speak,
            aimPlayer: a.aimPlayer,
          };
          // The mission's class kit: a 7-slot tier array Guns resolves into one
          // real gun per category, plus the passive equipment that goes with it.
          // Without these a scripted zombie/alien/Commander spawned carrying the
          // stock arsenal, since the kit name never matched a weapon id.
          if (a.weapons) extra.weapons = a.weapons;
          if (a.equips && Object.keys(a.equips).length) extra.equips = a.equips;
          if (a.gun && WEAPONS[a.gun]) extra.gun = a.gun;
          if (a.ability) extra.ability = a.ability;
          const ai = new AI(this, team, extra);
          ai.spawnOrder = 100 - i;
          this.unitLayer.addChild(ai.view);
          this.units.push(ai);
        });
        // Mission 1 is the guided walkthrough, which only exists on its own map.
        if (num === 1 && entry.settings.level === "r2_tut") this.tutorial = new Tutorial(this);
        return;
      }
    }

    // The human always joins team 1 in team modes (doc 11 §3); bots fill the
    // remaining slots round-robin across all `teams` sides (1..teams).
    const teams = Math.max(2, Number(m.teams) || 2);
    const playerTeam = teamMatch ? 1 : 0;
    this.player = this.makeSelfPlayer(playerTeam);

    const opponents = Number(m.opponents) || 3;
    const skinPool = SkinAnim.manifest.skins;
    for (let i = 0; i < opponents; i++) {
      const team = teamMatch ? (i % teams) + 1 : 0;
      // Give each bot a random animated Raze 2 skin so the roster shows the full
      // cast (the skin only changes cosmetics + chatter personality).
      const skin = skinPool[Math.floor(Math.random() * skinPool.length)];
      const ai = new AI(this, team, { preset: Math.floor(Math.random() * 20 + 1), skin });
      ai.spawnOrder = 100 - i;
      this.unitLayer.addChild(ai.view);
      this.units.push(ai);
    }
  }

  /** Host: local player + NetPlayers for peers + AI bot fill. Authoritative. */
  private buildRosterHost(): void {
    const m = SD.matchSettings;
    const mp = (SD as any).mp;
    const teamMatch = !!m.team;
    const humans: any[] = mp.players ?? [];

    const selfEntry = humans.find((p) => p.id === mp.selfId);
    const selfTeam = teamMatch ? selfEntry?.team || 1 : 0;
    this.player = this.makeSelfPlayer(selfTeam);
    this.player.netId = mp.selfId;
    this.netUnits.set(mp.selfId, this.player);

    let order = 100;
    humans.forEach((p, i) => {
      if (p.id === mp.selfId) return;
      const team = teamMatch ? p.team || (i % 2) + 1 : 0;
      const np = new NetPlayer(this, team, { name: p.name, preset: (i % 20) + 1 });
      np.netId = p.id;
      np.spawnOrder = order--;
      this.unitLayer.addChild(np.view);
      this.units.push(np);
      this.netUnits.set(p.id, np);
    });

    const bots = Number(m.opponents) || 0;
    for (let i = 0; i < bots; i++) {
      const team = teamMatch ? (i % 2) + 1 : 0;
      const ai = new AI(this, team, { preset: Math.floor(Math.random() * 20 + 1) });
      ai.netId = "bot" + i;
      ai.spawnOrder = order--;
      this.unitLayer.addChild(ai.view);
      this.units.push(ai);
      this.netUnits.set(ai.netId, ai);
    }

    this.broadcastRoster();
  }

  /** Client: only the local player up front; peers/bots created from snapshots. */
  private buildRosterClient(): void {
    const m = SD.matchSettings;
    const mp = (SD as any).mp;
    const teamMatch = !!m.team;
    const selfEntry = (mp.players ?? []).find((p: any) => p.id === mp.selfId);
    const selfTeam = teamMatch ? selfEntry?.team || 1 : 0;
    this.player = this.makeSelfPlayer(selfTeam);
    this.player.netId = mp.selfId;
    this.player.remote = true; // snapshot-driven, not simulated locally
    this.netUnits.set(mp.selfId, this.player);
    this.clientCreated.add(mp.selfId);
  }

  private broadcastRoster(): void {
    const roster: RosterEntry[] = this.units.map((u) => ({
      id: u.netId,
      name: u._name,
      team: u.team,
      cs: u.costume?.preset ?? 1,
      hu: u.human ? 1 : 0,
    }));
    NetGame.broadcastRoster(roster);
  }

  // --- host / client per-tick --------------------------------------------

  /** Host: publish this tick's authoritative state + any kill events. */
  private hostBroadcast(): void {
    const u = this.units.map((x) => x.serializeNet());
    NetGame.broadcastSnapshot(u, this.netKills);
    this.netKills = [];
    if (--this.rosterTimer <= 0) {
      this.broadcastRoster();
      this.rosterTimer = 60; // ~2s
    }
  }

  /** Host: record a kill for the peers' kill feed. Called from Unit.killGuy. */
  recordNetKill(killer: Unit, victim: Unit, headShot: boolean): void {
    if (this.netRole !== "host") return;
    this.netKills.push({
      atk: killer._name,
      vic: victim._name,
      gun: killer.gun.curGun?.id ?? "pistol",
      hs: headShot ? 1 : 0,
      atkTeam: killer.team,
      vicTeam: victim.team,
    });
  }

  /** Client: send our input, predict our own unit, apply snapshots to the rest. */
  private clientTick(): void {
    // Local input drives our own unit immediately (prediction) and is streamed
    // to the host, which is authoritative.
    const inp = this.buildClientInput();
    if (inp) {
      NetGame.sendInput(inp);
      this.predictOwn(inp);
    }

    const snap = NetGame.latest;
    if (snap) {
      for (const s of snap.u) {
        let u = this.netUnits.get(s.id);
        if (!u) u = this.createClientUnit(s);
        if (s.id === NetGame.selfId) {
          // Own unit: keep predicted motion, reconcile position + adopt stats.
          u.applyNetOwn(s);
        } else {
          u.applyNet(s, 0.4);
        }
      }
    }

    // Kill feed from host events.
    if (NetGame.pendingKills.length) {
      for (const k of NetGame.pendingKills) {
        this.hud.addKillMessage?.(k.atk, k.gun, k.vic, !!k.hs, {
          killerTeam: k.atkTeam,
          victimTeam: k.vicTeam,
          killerIsPlayer: k.atk === this.player._name,
          victimIsPlayer: k.vic === this.player._name,
        });
      }
      NetGame.pendingKills.length = 0;
    }

    // Pickups: bob animation only — the host owns touch/grant.
    for (const p of this.arena.itemPickups) p.enterFrame();
    for (const p of this.arena.weapPickups) p.enterFrame();
    this.arena.enterFrame(); // animated hazards / jump pads

    for (const fx of this.frameEff.slice()) fx.enterFrame();
    this.rdPhys.enterFrame();
    this.updateFx();
    this.updateCamera();
  }

  /** Client: create a plain, non-simulated Unit to render a snapshot entry. */
  private createClientUnit(s: UnitNetState): Unit {
    const r = NetGame.roster.get(s.id);
    const team = r?.team ?? 0;
    const preset = r?.cs ?? Math.floor(Math.random() * 20 + 1);
    const unit = new Unit(this, false, team, { preset });
    unit.netId = s.id;
    unit.remote = true;
    if (r?.name) unit.setName(r.name);
    unit.spawnOrder = 50;
    this.unitLayer.addChild(unit.view);
    this.units.push(unit);
    this.netUnits.set(s.id, unit);
    this.clientCreated.add(s.id);
    this.match.setPlayers();
    return unit;
  }

  /** Predict the owned unit locally from this tick's input for zero-lag feel. */
  private predictOwn(inp: NetInput): void {
    const p = this.player;
    if (p.status.dead) return;
    p.keys = inp.keys & (K.LEFT | K.RIGHT | K.DOWN);
    if (inp.jump) p.doJump(true);
    if (inp.gun) p.gun.selectGun(inp.gun);
    else if (inp.cycle > 0) p.gun.nextGun();
    else if (inp.cycle < 0) p.gun.prevGun();
    if (inp.reload) p.gun.startReload();
    // Aim: screen cursor → world, exactly like a local Player.
    p.aimX = (Input.mouseX - this.arena.x) / CAMERA_ZOOM;
    p.aimY = (Input.mouseY - this.arena.y) / CAMERA_ZOOM;
    p.predictMove();
  }

  private buildClientInput(): NetInput | null {
    if (!this.gameStarted || this.gameOver || SD.paused) return null;
    let keys = 0;
    if (Input.isDown("KeyA") || Input.isDown("ArrowLeft")) keys |= K.LEFT;
    if (Input.isDown("KeyD") || Input.isDown("ArrowRight")) keys |= K.RIGHT;
    if (Input.isDown("KeyS") || Input.isDown("ArrowDown")) keys |= K.DOWN;
    const jump =
      Input.wasPressed("KeyW") || Input.wasPressed("ArrowUp") || Input.wasPressed("Space") ? 1 : 0;
    const reload = Input.wasPressed("KeyR") ? 1 : 0;
    let gun = "";
    for (let i = 0; i < GUN_KEYS.length; i++) {
      if (Input.wasPressed(GUN_KEYS[i])) gun = this.player.gun.gunAtSlot(i) ?? "";
    }
    let cycle = 0;
    if (Input.wasPressed("KeyE")) cycle = 1;
    else if (Input.wasPressed("KeyQ") || Input.wasPressed("ShiftLeft")) cycle = -1;
    const wheel = (Input as any).wheelDelta ?? 0;
    if (wheel !== this.prevWheelClient) {
      cycle = wheel > this.prevWheelClient ? 1 : -1;
      this.prevWheelClient = wheel;
    }
    const fire = Input.mouseDown ? 1 : 0;

    // World-space aim angle: convert the cursor to world, take the angle from
    // the (world) shoulder. Zoom cancels out, so this equals the screen angle.
    const sh = this.player.getShoulder();
    const cursorWx = (Input.mouseX - this.arena.x) / CAMERA_ZOOM;
    const cursorWy = (Input.mouseY - this.arena.y) / CAMERA_ZOOM;
    const aim = Math.atan2(cursorWy - sh.y, cursorWx - sh.x) / DEG;

    return { keys, aim, fire, jump, gun, reload, cycle };
  }

  // --- effects API (used by Guns / Projectile / Unit) --------------------

  addEffect(x: number, y: number, type: string, color?: number, angleDeg?: number): void {
    this.pushFx(createEffect(type, color, angleDeg), x, y, FX_BEHIND.has(type));
  }

  /**
   * What the ground throws up where a round landed — the surface switch in
   * `Bullet.as:425-470`, on top of the weapon's own impact spark. Soft surfaces
   * only; anything else is hard cover and gets sparks alone.
   *
   * Mud/snow/sand are gated on `SD.graphPart`, foliage is not: the leaf burst is
   * also the feedback for the shot counting toward "I hate nature!", so muting
   * it would make the achievement invisible on the Low particle setting.
   *
   * `type` is optional so a caller that already sampled the surface (the hitscan
   * path needs it for the achievement checks) does not pay for a second lookup.
   */
  addSurfaceSplash(x: number, y: number, type?: string): void {
    const t = type ?? this.arena.wallMask?.surfaceTypeAt(x, y)?.type;
    if (!t) return;
    if (t === "foliage") {
      this.addEffect(x, y, "leaf_splash");
      return;
    }
    if (!SD.graphPart) return;
    if (t === "mud") this.addEffect(x, y, "mud_splash");
    else if (t === "snow") this.addEffect(x, y, "snow_splash");
    else if (t === "sand") this.addEffect(x, y, "sand_splash");
  }

  /**
   * Adopt a ready-made effect at (x, y) and enforce the concurrent-effect cap.
   * Each live effect owns a Graphics, so the cap doubles as a draw-call budget.
   * When it is hit, retire the oldest rather than dropping the new one — the
   * freshest impact is the one worth showing.
   */
  private pushFx(fx: FxObject, x: number, y: number, behind = false): void {
    while (this.fx.length >= Quality.maxFx) {
      const old = this.fx.shift();
      old?.view.destroy({ children: true });
    }
    fx.view.x = x;
    fx.view.y = y;
    (behind ? this.fxBehind : this.fxFront).addChild(fx.view);
    this.fx.push(fx);
  }

  /** Muzzle flash at a barrel tip, pointing along `angleDeg`. */
  addMuzzleFlash(x: number, y: number, angleDeg: number, color: number, size: number): void {
    this.pushFx(Fx.addMuzzleFlash(color, size, angleDeg), x, y);
  }

  /**
   * A puff of barrel smoke. Purely decorative, so it is skipped on the Low
   * profile (which also turns off `detail`) to keep the draw-call budget for
   * flashes and impacts.
   */
  addSmoke(x: number, y: number, size: number, vx: number, vy: number): void {
    if (!Quality.detail) return;
    // Behind the body: smoke drifting off the barrel shouldn't fog the shooter.
    this.pushFx(Fx.emitSmoke(size, vx, vy), x, y, true);
  }

  /** An ejected shell casing tumbling from the weapon. Detail-only polish. */
  addShell(x: number, y: number, vx: number, vy: number): void {
    if (!Quality.detail) return;
    this.pushFx(Fx.ejectShell(vx, vy), x, y, true);
  }

  /**
   * A shot tracer from the barrel to wherever the ray stopped.
   *
   * `hitUnit` bows the line very slightly toward its midpoint. A dead-straight
   * line through a body is ambiguous — it reads as passing behind or in front
   * — whereas a few pixels of deflection makes the eye land on the termination
   * point, which is exactly the feedback the shooter needs.
   */
  addTracer(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    opts: TracerOpts | boolean = false,
  ): void {
    // Back-compat: an older boolean `beam` arg (Unit's net-cosmetic path).
    const o: TracerOpts = typeof opts === "boolean"
      ? { style: opts ? "effect" : "basic", dashed: !opts }
      : opts;
    const style: TracerStyle = o.style ?? "basic";
    const beamy = style === "effect" || style === "laser" || style === "zapper";

    const g = new Graphics();
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const irnd = (a: number, b: number) => Math.floor(rnd(a, b + 1));

    // Lifetime by class: most guns are a single-frame flash; the sniper /
    // electric / effect families persist and drift/fade over ~1s (doc 05 §1).
    let life: number;
    switch (style) {
      case "sniper":
      case "electric":
      case "effect": life = Quality.tracerLife * 5 + 6; break;
      case "bend": life = 10; break;
      default: life = 2; break; // basic / laser / zapper flash
    }

    const tr: Tracer = {
      g, life, max: life, x1, y1, x2, y2, style,
      color: o.color ?? (beamy ? 0x66ccff : 0xfff2a0),
      color2: o.color2 ?? o.color ?? (beamy ? 0xeaffff : 0xfff2a0),
      w1: o.w1 ?? (beamy ? 5.5 : 3.5),
      w2: o.w2 ?? (beamy ? 2.5 : 1.5),
      a1: o.a1 ?? 0.3,
      a2: o.a2 ?? 0.7,
      bow: 0,
    };

    // Pre-generate per-style geometry once, so dashes/jitter stay stable.
    switch (style) {
      case "basic": {
        const segs: number[] = [];
        if (o.dashed ?? true) {
          // Bullet_Line_Basic: start at irand(0,100), gap irand(50,250), and
          // stroke only every *other* span → a scattered run of dashes.
          const stops: number[] = [];
          for (let d = irnd(0, 100); d < len; d += irnd(50, 250)) stops.push(d);
          stops.push(len);
          for (let i = 0; i + 1 < stops.length; i += 2) {
            const a = stops[i];
            const b = stops[i + 1];
            segs.push(x1 + ux * a, y1 + uy * a, x1 + ux * b, y1 + uy * b);
          }
        } else {
          segs.push(x1, y1, x2, y2);
        }
        tr.segs = segs;
        break;
      }
      case "sniper": {
        const poly: TVert[] = [];
        const hi = o.dashed ? 0.5 : 0.2;
        for (let d = 0; d <= len; d += 30) {
          poly.push({ x: x1 + ux * d, y: y1 + uy * d, lift: rnd(-0.2, hi) });
        }
        poly.push({ x: x2, y: y2, lift: rnd(-0.2, hi) });
        tr.poly = poly;
        break;
      }
      case "electric": {
        const strands: TVert[][] = [];
        for (let s = 0; s < 3; s++) {
          const arr: TVert[] = [];
          for (let d = 0; d <= len; d += 30) {
            const scat = o.dashed ? rnd(-3, 3) : rnd(-1, 1);
            arr.push({ x: x1 + ux * d + nx * scat, y: y1 + uy * d + ny * scat, lift: rnd(-0.3, 0.3) });
          }
          strands.push(arr);
        }
        tr.strands = strands;
        break;
      }
      case "bend": {
        tr.bend = {
          mx: x1 + dx * 0.5, my: y1 + dy * 0.5,
          c1x: x1 + dx * 0.25, c1y: y1 + dy * 0.25,
          c2x: x1 + dx * 0.75, c2y: y1 + dy * 0.75,
          ox: rnd(-50, 50), oy: rnd(-50, 50),
        };
        break;
      }
      case "laser":
      case "zapper": {
        const poly: TVert[] = [];
        for (let d = 0; d <= len; d += 20) poly.push({ x: x1 + ux * d, y: y1 + uy * d, lift: 0 });
        poly.push({ x: x2, y: y2, lift: 0 });
        tr.poly = poly;
        tr.strength = style === "zapper" ? (o.hitUnit ? 3 : 1.7) : 1;
        break;
      }
      case "effect": {
        tr.ux = ux; tr.uy = uy; tr.len = len;
        break;
      }
    }

    this.drawTracer(tr, 1);
    this.fxFront.addChild(g);
    this.tracers.push(tr);
  }

  /**
   * Redraw one tracer at fade level `k` (1 = fresh, 0 = gone). Every style
   * re-strokes its pre-generated geometry with a two-pass thick-glow + thin-
   * core layering, drifting the polyline points by their `lift` as it ages so
   * snipers "shimmer" and electric arcs crawl (Raze 2 Bullet_Line_*, doc 05).
   */
  private drawTracer(tr: Tracer, k: number): void {
    const { g, x1, y1, x2, y2, style } = tr;
    g.clear();
    const elapsed = tr.max - tr.life; // frames since spawn
    const glow = Quality.glow;

    /** Stroke a polyline given a coord-producing accessor. */
    const strokePoly = (pts: TVert[], drift: number, width: number, color: number, alpha: number) => {
      if (pts.length < 2 || alpha <= 0) return;
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      g.moveTo(pts[0].x + nx * pts[0].lift * drift, pts[0].y + ny * pts[0].lift * drift);
      for (let i = 1; i < pts.length; i++) {
        g.lineTo(pts[i].x + nx * pts[i].lift * drift, pts[i].y + ny * pts[i].lift * drift);
      }
      g.stroke({ color, width: Math.max(0.4, width), alpha });
    };

    switch (style) {
      case "basic": {
        // Randomly-dashed single-frame flash, two-pass (glow + core).
        const segs = tr.segs ?? [];
        const drawDashes = (width: number, color: number, alpha: number) => {
          for (let i = 0; i + 3 < segs.length; i += 4) {
            g.moveTo(segs[i], segs[i + 1]).lineTo(segs[i + 2], segs[i + 3]);
          }
          g.stroke({ color, width, alpha });
        };
        if (glow) drawDashes(tr.w1, tr.color, tr.a1 * k);
        drawDashes(tr.w2, tr.color2, Math.min(1, tr.a2 + 0.2) * k);
        break;
      }
      case "sniper": {
        const poly = tr.poly ?? [];
        // Points rise/drift with age → "heat shimmer"; alpha decays with k.
        if (glow) strokePoly(poly, -elapsed, tr.w1, tr.color, tr.a1 * k);
        strokePoly(poly, -elapsed, tr.w2, tr.color2, tr.a2 * k);
        if (glow) g.circle(x2, y2, tr.w1 * k).fill({ color: tr.color2, alpha: 0.5 * k });
        break;
      }
      case "electric": {
        const [s0, s1, s2] = tr.strands ?? [];
        // Three strands crawl outward as each vertex drifts by its lift.
        if (s0) strokePoly(s0, elapsed, tr.w1, tr.color, tr.a1 * k);
        if (s1) strokePoly(s1, elapsed, tr.w2, tr.color2, tr.a2 * k);
        if (s2 && glow) strokePoly(s2, -elapsed, 1.5, 0xccffff, 0.4 * k);
        break;
      }
      case "bend": {
        const b = tr.bend;
        if (b) {
          const f = Math.pow(0.9, elapsed); // un-whips toward straight
          const c1x = b.c1x + b.ox * f;
          const c1y = b.c1y + b.oy * f;
          const c2x = b.c2x - b.ox * f;
          const c2y = b.c2y - b.oy * f;
          const curve = (width: number, color: number, alpha: number) => {
            g.moveTo(x1, y1);
            g.quadraticCurveTo(c1x, c1y, b.mx, b.my);
            g.quadraticCurveTo(c2x, c2y, x2, y2);
            g.stroke({ color, width, alpha });
          };
          if (glow) curve(tr.w1, tr.color, tr.a1 * k);
          curve(tr.w2, tr.color2, tr.a2 * k);
        }
        break;
      }
      case "laser": {
        // Continuous jittered double-line; buzzes because it re-fires each tick.
        const poly = tr.poly ?? [];
        const jitter = (width: number, color: number, alpha: number) => {
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const nx = -(y2 - y1) / len;
          const ny = (x2 - x1) / len;
          for (let i = 0; i < poly.length; i++) {
            const j = (Math.random() * 2 - 1);
            const px = poly[i].x + nx * j;
            const py = poly[i].y + ny * j;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke({ color, width, alpha });
        };
        if (glow) jitter(tr.w1, tr.color, tr.a1 * (0.5 + k * 0.5));
        jitter(tr.w2, tr.color2, tr.a2 * (0.5 + k * 0.5));
        break;
      }
      case "zapper": {
        const poly = tr.poly ?? [];
        const st = tr.strength ?? 1.7;
        const jitter = (width: number, color: number, alpha: number) => {
          const len = Math.hypot(x2 - x1, y2 - y1) || 1;
          const nx = -(y2 - y1) / len;
          const ny = (x2 - x1) / len;
          for (let i = 0; i < poly.length; i++) {
            const j = (Math.random() * 2 - 1) * 1.5;
            const px = poly[i].x + nx * j;
            const py = poly[i].y + ny * j;
            if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
          }
          g.stroke({ color, width: Math.max(0.5, width), alpha });
        };
        if (glow) jitter(3 * st, tr.color, 0.5 * (0.5 + k * 0.5));
        jitter(2 * st, tr.color2, 1 * (0.5 + k * 0.5));
        break;
      }
      case "effect": {
        // Solid two-pass beam + a spark chasing muzzle→impact (railgun).
        const line = (width: number, color: number, alpha: number) => {
          g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width, alpha });
        };
        if (glow) line(tr.w1, tr.color, tr.a1 + 0.3 * k);
        line(tr.w2, tr.color2, tr.a2 + 0.2 * k);
        if (glow && tr.len) {
          const frac = Math.min(1, elapsed / Math.max(1, tr.max * 0.5));
          const cx = x1 + (tr.ux ?? 0) * tr.len * frac;
          const cy = y1 + (tr.uy ?? 0) * tr.len * frac;
          g.circle(cx, cy, 4).fill({ color: tr.color, alpha: 0.9 * k });
        }
        break;
      }
    }

    // Impact bloom for the persistent line families.
    if (glow && (style === "sniper" || style === "effect")) {
      g.circle(x2, y2, (style === "effect" ? 7 : 4) * k).fill({
        color: tr.color2, alpha: 0.5 * k,
      });
    }
  }

  /**
   * Secondary shower of embers at a hitscan impact, arcing out and falling.
   * Decorative, so it follows the detail profile.
   */
  addSparkRain(x: number, y: number, color?: number): void {
    if (!Quality.detail) return;
    this.pushFx(createEffect("sparkRain", color), x, y);
  }

  /** A rising kill card at the victim's body. Player kills only. */
  addKillPopup(x: number, y: number, weaponId: string, headshot: boolean): void {
    this.pushFx(Fx.addKillPopup(weaponId, headshot), x, y);
  }

  /** Floating kill-bonus popup (bonus names + credits) at a kill location. */
  addBonusPopup(x: number, y: number, lines: string[], points: number): void {
    this.pushFx(Fx.addBonusPopup(lines, points), x, y);
  }

  /**
   * Flash the screen red when the player is hit. `intensity` is 0..1 (roughly
   * "how much of a serious wound was that"); repeated hits take the strongest,
   * so a chaingun burst doesn't wash the screen out.
   *
   * `from` is the world position the damage came from, when it is known. The
   * edge vignette answers "am I being hurt"; the HUD's directional wedge
   * answers "from where", which is the difference between turning around and
   * dying facing the wrong way. Splash and fall damage pass nothing.
   */
  flashDamage(intensity: number, from?: { x: number; y: number }): void {
    const k = Math.max(0, Math.min(1, intensity));
    this.hitFlash = Math.max(this.hitFlash, HIT_FLASH_FRAMES * (0.4 + k * 0.6));
    this.hitFlashPeak = Math.max(this.hitFlashPeak, 0.18 + k * 0.4);

    if (from && this.player && !SD.ssMode) {
      const dx = from.x - this.player.x;
      const dy = from.y - (this.player.y - 45 * this.player.scale);
      // A hit from exactly where you stand carries no bearing worth drawing.
      if (dx !== 0 || dy !== 0) {
        this.hud.showDamageFrom(Math.atan2(dy, dx), k);
      }
    }
  }

  /** Fade the damage vignette, redrawing only while it is actually visible. */
  /**
   * The window changed shape. Everything that is anchored to a stage edge —
   * the fills that must cover it, the two corner readouts, the HUD — is laid
   * out again against the new size. The camera clamps read the stage live, so
   * the extra world simply comes into view on the next tick.
   */
  resize(): void {
    this.flatBg.clear();
    this.flatBg.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x11151a });

    this.ssToast.x = GAME_WIDTH / 2;
    this.hitboxLabel.y = GAME_HEIGHT - 20;

    if (this.pauseBg) {
      const g = this.pauseBg;
      g.clear();
      g.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.4 });
      g.rect(0, 0, GAME_WIDTH, 90).fill({ color: 0x000000, alpha: 0.28 });
      g.rect(0, GAME_HEIGHT - 90, GAME_WIDTH, 90).fill({ color: 0x000000, alpha: 0.28 });
      this.pauseTitle.x = GAME_WIDTH / 2;
      this.pauseBody.x = Math.round((GAME_WIDTH - DESIGN_WIDTH) / 2);
    }

    this.layoutRoundEnd();
    this.hud.relayout();
  }

  /**
   * `Raze2_fla.whiteFlash_139`: a full-screen white rectangle that plays once
   * over 30 frames and stops. In the SWF it lives on the `tut_attack` sky frame,
   * which is why baking that frame statically used to leave the tutorial's sky
   * permanently white — the flash is a one-second event, not scenery.
   */
  flashWhite(ticks = WHITE_FLASH_FRAMES): void {
    this.whiteFlashTicks = Math.max(this.whiteFlashTicks, ticks);
  }

  private updateWhiteFlash(): void {
    if (this.whiteFlashTicks <= 0) return;
    this.whiteFlashTicks--;
    const g = this.whiteFlash;
    g.clear();
    if (this.whiteFlashTicks <= 0) return;
    g.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({
      color: 0xffffff,
      alpha: this.whiteFlashTicks / WHITE_FLASH_FRAMES,
    });
  }

  private updateHitFlash(): void {
    // "Bloody Screen" off means no damage vignette at all — clear any frame
    // that is still up rather than freezing it on screen.
    if (!SD.graphBlood) {
      if (this.hitFlash > 0) {
        this.hitFlash = 0;
        this.hitFlashPeak = 0;
        this.damageFlash.clear();
      }
      return;
    }
    if (this.hitFlash <= 0) return;
    this.hitFlash--;
    const k = this.hitFlash / HIT_FLASH_FRAMES;
    const g = this.damageFlash;
    g.clear();
    if (this.hitFlash <= 0) {
      this.hitFlashPeak = 0;
      return;
    }
    // Vignette rather than a flat wash: a solid red fill hides the arena, and
    // the edges are where peripheral vision actually picks the warning up.
    const a = this.hitFlashPeak * k;
    const band = 90;
    g.rect(0, 0, GAME_WIDTH, band).fill({ color: 0xcc1111, alpha: a * 0.7 });
    g.rect(0, GAME_HEIGHT - band, GAME_WIDTH, band).fill({ color: 0xcc1111, alpha: a * 0.7 });
    g.rect(0, 0, band, GAME_HEIGHT).fill({ color: 0xcc1111, alpha: a * 0.7 });
    g.rect(GAME_WIDTH - band, 0, band, GAME_HEIGHT).fill({ color: 0xcc1111, alpha: a * 0.7 });
    g.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0xcc1111, alpha: a * 0.35 });
  }

  /** Projectiles and other self-ticking effects. In front: live ordnance is
   *  the one thing on screen the player must never lose track of. */
  addFrameEffect(fx: any): void {
    this.frameEff.push(fx);
    if (fx.view) this.fxFront.addChild(fx.view);
  }
  removeFrameEffect(fx: any): void {
    const i = this.frameEff.indexOf(fx);
    if (i >= 0) this.frameEff.splice(i, 1);
    if (fx.destructor) fx.destructor();
  }

  private updateFx(): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const fx = this.fx[i];
      const done = fx.enterFrame();
      if (done) {
        fx.view.destroy({ children: true });
        this.fx.splice(i, 1);
      }
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life--;
      if (tr.life <= 0) {
        tr.g.destroy();
        this.tracers.splice(i, 1);
        continue;
      }
      // Squared ramp: holds bright for the first instant, then drops away.
      const k = tr.life / (tr.max || 1);
      this.drawTracer(tr, k * k);
    }
    this.updateHitFlash();
    this.updateWhiteFlash();
  }

  /**
   * The in-match pause menu, rebuilt to match Raze 2's `PauseScreen` (doc 12
   * §2.2): a full-screen dim/vignette backdrop with a PERSISTENT left column
   * (mission title/blurb + the four buttons — Resume Game / View Scores /
   * Options / Quit Game, the active tab shown as a dimmed/selected ghost)
   * beside a right-hand content region that swaps between the idle/"main"
   * pane, the View Scores table, the Options panel and a Quit Yes/No confirm.
   */
  private buildPauseOverlay(): void {
    const o = new Container();
    o.visible = false;
    o.eventMode = "static"; // swallow gameplay clicks while modal

    // Backdrop: fade-to-40%-black overlay (char 463) + a soft corner vignette
    // (char 464) — the pause blur below adds the frosted-glass read.
    this.pauseBg = new Graphics();
    o.addChild(this.pauseBg);

    // Top-center frame title (`txt_title`), swapped per active sub-screen.
    const title = new Text({
      text: "PAUSED",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 26,
        fontWeight: "700", letterSpacing: 4,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2; title.y = 24;
    o.addChild(title);
    this.pauseTitle = title;

    // Everything below is authored against the 1136-wide design box and lives
    // in one container, so `resize()` re-centres it with a single assignment.
    const body = this.pauseBody;
    o.addChild(body);

    // --- persistent left column: mission title/blurb + the 4 tab buttons --
    const BX = 70;
    let ly = 96;
    const isCampaign = !!SD.matchSettings.campaign;
    const missionTitle = isCampaign ? (SD.matchSettings.matchName || "Mission") : "Quick Match";
    const missionDesc = isCampaign ? (SD.matchSettings.matchDesc || "") : "";

    const mTitle = new Text({
      text: missionTitle,
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 20,
        fontWeight: "700", letterSpacing: 1,
      }),
    });
    mTitle.alpha = A_HEADER;
    mTitle.x = BX; mTitle.y = ly;
    body.addChild(mTitle);
    ly += 30;

    if (missionDesc) {
      const mDesc = new Text({
        text: missionDesc,
        style: new TextStyle({
          fill: C_BODY, fontFamily: FONT_BODY, fontSize: 13,
          wordWrap: true, wordWrapWidth: 230, lineHeight: 17,
        }),
      });
      mDesc.alpha = A_BODY;
      mDesc.x = BX; mDesc.y = ly;
      body.addChild(mDesc);
      ly += mDesc.height + 20;
    } else {
      ly += 10;
    }

    let by = Math.max(ly, 172);
    const panelX = 340;
    const tabButtons: Partial<Record<"scores" | "options" | "quit", Raze2Button>> = {};
    const stack: [string, () => void, ("scores" | "options" | "quit")?][] = [
      ["Resume Game", () => { Sound.play("R2_ClickGo"); SD.togglePause(); }],
      ["View Scores", () => { Sound.play("R2_Click"); this.showPauseSub("scores"); }, "scores"],
      ["Options", () => { Sound.play("R2_Click"); this.showPauseSub("options"); }, "options"],
      ["Quit Game", () => { Sound.play("R2_Click"); this.showPauseSub("quit"); }, "quit"],
    ];
    for (const [label, onClick, tab] of stack) {
      const btn = new Raze2Button(label, { width: 240, height: 44, onClick });
      btn.view.x = BX; btn.view.y = by;
      btn.view.on("pointerover", () => Sound.play("R2_Click"));
      body.addChild(btn.view);
      if (tab) tabButtons[tab] = btn;
      by += 56;
    }
    this.pauseTabButtons = tabButtons as Record<"scores" | "options" | "quit", Raze2Button>;

    // --- main: idle content (right side blank while just paused) ---------
    const main = new Container();
    body.addChild(main);
    this.pauseMain = main;

    // --- View Scores sub-screen ------------------------------------------
    const scores = new Container();
    scores.visible = false;
    body.addChild(scores);
    this.pauseScores = scores;

    const boardW = 700;
    const sp = new Raze2Panel(boardW + 40, 470, { accent: C_OPTIONS_GREEN });
    sp.view.x = panelX - 20; sp.view.y = 80;
    scores.addChild(sp.view);

    const holder = new Container();
    holder.x = panelX; holder.y = 96;
    scores.addChild(holder);
    this.pauseScoreHolder = holder;

    // --- Quit confirm sub-screen (doc 12 §2.2, `btn_Yes`/`btn_No`) --------
    const quit = new Container();
    quit.visible = false;
    body.addChild(quit);
    this.pauseQuit = quit;

    const qp = new Raze2Panel(420, 200, { accent: C_OPTIONS_GREEN });
    qp.view.x = panelX - 20; qp.view.y = 200;
    quit.addChild(qp.view);

    const qText = new Text({
      text: "Quit to the main menu?",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 20, fontWeight: "700",
      }),
    });
    qText.alpha = A_HEADER;
    qText.x = panelX; qText.y = 232;
    quit.addChild(qText);

    const yesBtn = new Raze2Button("Yes", {
      width: 160, height: 40,
      onClick: () => {
        Sound.play("R2_ClickGo");
        void import("../screens/MenuScreen").then(({ MenuScreen }) =>
          this.engine.setScreen(MenuScreen),
        );
      },
    });
    yesBtn.view.x = panelX; yesBtn.view.y = 310;
    yesBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    quit.addChild(yesBtn.view);

    // "No" cancels back to View Scores, not "main" (`PauseScreen.as:514-516`).
    const noBtn = new Raze2Button("No", {
      width: 160, height: 40, reverse: true,
      onClick: () => { Sound.play("R2_ClickBack"); this.showPauseSub("scores"); },
    });
    noBtn.view.x = panelX + 240; noBtn.view.y = 310;
    noBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    quit.addChild(noBtn.view);

    // --- Options sub-screen ----------------------------------------------
    const options = new Container();
    options.visible = false;
    body.addChild(options);
    this.pauseOptions = options;

    const op = new Raze2Panel(460, 470, { accent: C_OPTIONS_GREEN });
    op.view.x = panelX - 20; op.view.y = 80;
    options.addChild(op.view);

    const oTitle = new Text({
      text: "OPTIONS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 26,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    oTitle.alpha = A_HEADER;
    oTitle.x = panelX; oTitle.y = 96;
    options.addChild(oTitle);

    const ox = panelX;
    let oy = 150;
    const step = 62;
    // Quality / Glows / Sounds / Music bind to the live SD model; changes apply
    // immediately (doc 14 §4). Pause Blur re-applies to the frozen frame now.
    this.addPauseToggle(options, "Quality", ox, oy,
      ["Low", "Medium", "High", "Ultra"],
      Math.max(0, QUALITY_LEVELS.indexOf(SD.qual)),
      (i) => SD.setQuality(QUALITY_LEVELS[i]));
    oy += step;
    this.addPauseToggle(options, "Glows", ox, oy, ["Off", "On"],
      SD.noGlow ? 0 : 1, (i) => SD.setNoGlow(i === 0));
    oy += step;
    this.addPauseToggle(options, "Sounds", ox, oy, ["Off", "On"],
      SD.sound ? 1 : 0, (i) => { SD.sound = i === 1; SD.save(); });
    oy += step;
    this.addPauseToggle(options, "Music", ox, oy, ["Off", "On"],
      SD.music ? 1 : 0, (i) => {
        SD.music = i === 1; SD.save();
        if (SD.music) Sound.setMusic(MATCH_MUSIC[Math.floor(Math.random() * MATCH_MUSIC.length)]);
        else Sound.stopMusic();
      });
    oy += step;
    this.addPauseToggle(options, "Pause Blur", ox, oy, ["Off", "On"],
      this.pauseBlur ? 1 : 0, (i) => {
        this.pauseBlur = i === 1;
        SD.setPauseBlur(this.pauseBlur);
        this.applyPauseBlur(SD.paused && this.pauseBlur);
      });

    const oBack = new Raze2Button("Back", {
      width: 160, height: 40,
      onClick: () => { Sound.play("R2_ClickBack"); this.showPauseSub("main"); },
    });
    oBack.view.x = panelX; oBack.view.y = 500;
    oBack.view.on("pointerover", () => Sound.play("R2_Click"));
    options.addChild(oBack.view);

    this.pauseOverlay = o;
    this.view.addChild(o);
  }

  /** A labelled Raze2Toggle row inside the pause Options panel. */
  private addPauseToggle(
    parent: Container, label: string, x: number, y: number,
    words: string[], selected: number, onChange: (i: number) => void,
  ): void {
    const t = new Text({
      text: label,
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    t.alpha = A_LABEL; t.x = x; t.y = y;
    parent.addChild(t);
    const toggle = new Raze2Toggle(words, selected, (i) => {
      Sound.play("R2_Click");
      onChange(i);
    });
    toggle.view.x = x; toggle.view.y = y + 20;
    parent.addChild(toggle.view);
  }

  /** Switch the visible pause sub-screen. Rebuilds the scoreboard live and
   *  updates the persistent tab buttons' selected/ghost state (doc 12 §2.2). */
  private showPauseSub(sub: "main" | "scores" | "options" | "quit"): void {
    if (sub === "scores") this.refreshPauseScores();
    // SD.scores keeps the Tab-scoreboard hotkey state coherent with the menu.
    SD.scores = sub === "scores";
    this.pauseMain.visible = sub === "main";
    this.pauseScores.visible = sub === "scores";
    this.pauseOptions.visible = sub === "options";
    this.pauseQuit.visible = sub === "quit";
    this.pauseTitle.text = sub === "scores" ? "VIEW SCORES"
      : sub === "options" ? "OPTIONS"
      : sub === "quit" ? "QUIT GAME"
      : "PAUSED";
    for (const tab of ["scores", "options", "quit"] as const) {
      const btn = this.pauseTabButtons[tab];
      if (!btn) continue;
      const active = sub === tab;
      btn.setSelected(active);
      btn.setEnabled(!active);
    }
  }

  /** Rebuild the View Scores table from the live standings. */
  private refreshPauseScores(): void {
    this.pauseScoreHolder.removeChildren();
    const { rows, headerLabel } = this.buildScoreRows();
    this.pauseScoreHolder.addChild(new ScoreBoard(700, rows, { headerLabel }).view);
  }

  /**
   * Snapshot the current standings as {@link ScoreBoard} rows, following
   * `displayScoreBars()` (doc 12 §2.3): a flat ranked list for FFA, or one
   * team-banner block per team (sorted by team total, members sorted within
   * the block, +5px gap between blocks) for team modes. Elimination modes
   * show "LIVES" (via `Unit.getScore`) instead of "SCORE" in the header.
   *
   * Shared by the pause overlay (rebuilt every time it opens) and the round-end
   * card (built once, so the final table stays put while the arena plays on
   * behind it).
   */
  private buildScoreRows(): { rows: ScoreRow[]; headerLabel: string } {
    const type = SD.matchSettings.type;
    const isElim = type === "elim" || type === "telim";
    const headerLabel = isElim ? "LIVES" : "SCORE";
    const scoreOf = (u: Unit) => u.getScore;
    const statusOf = (u: Unit): Pick<ScoreRow, "isJug" | "hasFlag" | "dead"> => ({
      isJug: u.isJug,
      hasFlag: !!u.hasFlag,
      dead: u.status.dead,
    });
    const rowFor = (u: Unit, rank: number, team: number): ScoreRow => ({
      rank,
      name: u._name || (u.human ? "Player" : "Bot"),
      score: scoreOf(u),
      kills: u.score.kills,
      deaths: u.score.deaths,
      team,
      ai: !u.human,
      ...statusOf(u),
    });

    let rows: ScoreRow[];
    if (this.match.isTeamMode) {
      const teams = Math.max(2, Number(SD.matchSettings.teams) || 2);
      const totals: Record<number, number> = {};
      for (const u of this.units) totals[u.team] = (totals[u.team] ?? 0) + scoreOf(u);
      const order = Array.from({ length: teams }, (_, i) => i + 1)
        .sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
      rows = [];
      order.forEach((team, ti) => {
        rows.push({
          rank: "", name: `${TEAM_NAMES[team - 1] ?? `Team ${team}`} Team`,
          score: totals[team] ?? 0, kills: "", deaths: "",
          team, isBanner: true, gapBefore: ti > 0,
        });
        const members = this.units
          .filter((u) => u.team === team)
          .sort((a, b) => scoreOf(b) - scoreOf(a));
        members.forEach((u, i) => rows.push(rowFor(u, i + 1, team)));
      });
    } else {
      const ranked = this.units.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
      rows = ranked.map((u, i) => rowFor(u, i + 1, u.team));
    }

    return { rows, headerLabel };
  }

  /**
   * Apply/remove the Pause Blur (doc 14 §4) on the frozen game layers behind
   * the menu. Pixi clamps filter textures to the viewport, so blurring the
   * world container only processes the on-screen region.
   */
  private applyPauseBlur(on: boolean): void {
    if (on && !this.pauseBlurFilter) {
      this.pauseBlurFilter = new BlurFilter({ strength: 6, quality: 3 });
    }
    const filters = on && this.pauseBlurFilter ? [this.pauseBlurFilter] : [];
    const layers: (Container | Sprite | null)[] = [
      this.bgSprite, this.arena.view, this.damageFlash, this.whiteFlash, this.hud.view,
    ];
    for (const l of layers) if (l) l.filters = filters;
  }

  // --- pause / scores (called by SD) -------------------------------------

  setPause(_showMenu: boolean): void {
    this.pauseOverlay.visible = SD.paused;
    this.applyPauseBlur(SD.paused && this.pauseBlur);
    if (this.crosshair) this.crosshair.visible = !SD.paused;
    // Tab jumps straight to the scoreboard; P opens the button stack.
    if (SD.paused) this.showPauseSub(SD.scores ? "scores" : "main");
    this.hud.setBanner("");
  }
  setUnPause(): void {
    SD.scores = false;
    this.pauseOverlay.visible = false;
    this.applyPauseBlur(false);
    if (this.crosshair) this.crosshair.visible = true;
    this.showPauseSub("main");
  }

  endGame(playerWon: boolean): boolean {
    if (this.gameOver) return false;
    this.gameOver = true;
    // Online: the authoritative host tells the server, which returns every
    // member (host included, via the matchEnd echo) to the party lobby.
    if (this.netRole === "host") Net.endMatch();
    if (playerWon) SD.addWin();
    else SD.addLoss();
    this.player.saveScoreStats();
    this.hud.setResult(playerWon);
    // The arena falls quiet and the result chord lands over it.
    Sound.stopAmbience();
    Sound.playSynth("fanfare", playerWon ? 0.9 : 0.5);

    if (!SD.matchSettings.campaign && SD.matchSettings.diff >= 1.1 &&
        this.player.score.kills / 2 >= this.player.score.deaths) {
      Achievements.addAch("nodie");
    }
    // ">= 2" rather than "=== 2" so Ego mode (2.8) still counts as hardest.
    if (SD.matchSettings.type === "dm" && SD.matchSettings.diff >= 2 &&
        this.match.scoreOrder[0] === (this.player as any)) {
      Achievements.addAch("rank");
    }
    if (playerWon && this.player.score.pistolOnly) Achievements.addAch("pistol");
    this.buildRoundEnd(playerWon);
    return true;
  }

  /**
   * Build the round-end card: VICTORY/DEFEAT over the final standings.
   *
   * Deliberately inert (`eventMode = "none"`): the match goes on ticking
   * underneath, with the player still holding a live mouse, so the card must
   * not swallow the input that is still driving the fight.
   */
  private buildRoundEnd(playerWon: boolean): void {
    const o = new Container();
    o.alpha = 0;
    o.eventMode = "none";
    o.addChild(this.roundEndBg);

    this.roundEndHeader = new Text({
      text: playerWon ? "VICTORY" : "DEFEAT",
      style: new TextStyle({
        fill: playerWon ? C_VICTORY : C_DANGER,
        fontFamily: FONT_HEADER, fontSize: 52, fontWeight: "700", letterSpacing: 8,
      }),
    });
    this.roundEndHeader.anchor.set(0.5, 0);
    o.addChild(this.roundEndHeader);

    const { rows, headerLabel } = this.buildScoreRows();
    this.roundEndBoard = new ScoreBoard(ROUND_END_BOARD_W, rows, { headerLabel });
    o.addChild(this.roundEndBoard.view);

    this.roundEnd = o;
    this.view.addChild(o);
    this.layoutRoundEnd();
  }

  /** Centre the card's header + board as one block. Also run on resize. */
  private layoutRoundEnd(): void {
    const header = this.roundEndHeader;
    const board = this.roundEndBoard;
    if (!this.roundEnd || !header || !board) return;

    this.roundEndBg.clear();
    this.roundEndBg.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.55 });

    const GAP = 30;
    const top = Math.round((GAME_HEIGHT - (header.height + GAP + board.totalHeight)) / 2);
    header.x = GAME_WIDTH / 2;
    header.y = top;
    board.view.x = Math.round((GAME_WIDTH - ROUND_END_BOARD_W) / 2);
    board.view.y = top + header.height + GAP;
  }

  /** Fade the card up over the still-running arena, then hand back. */
  private advanceRoundEnd(): void {
    if (!this.roundEnd) return;
    this.roundEndTicks++;
    this.roundEnd.alpha = Math.min(1, this.roundEndTicks / ROUND_END_FADE);
    if (this.roundEndTicks >= ROUND_END_HOLD) this.leaveMatch();
  }

  /**
   * Leave the match once the round-end card has had its say (ported from
   * `Game.destroy()`).
   *
   * Hands back to the screen the match was launched from — the level screen,
   * not the main menu. A campaign mission with a post-mission comic plays it
   * first, including the one scripted defeat scene, losing "Final Deployment";
   * the cutscene then returns to the campaign map itself.
   */
  private leaveMatch(): void {
    if (this.leaving) return;
    this.leaving = true;
    const reel = endReel();
    if (reel) {
      Sound.stopMusic();
      void loadPanels(reel.panels).then(() =>
        void import("../screens/CutsceneScreen").then(({ CutsceneScreen }) =>
          this.engine.setScreen(CutsceneScreen, { reel }),
        ),
      );
      return;
    }
    if (this.netRole !== "off") {
      this.returnToLobby();
      return;
    }
    if (SD.matchSettings.campaign) {
      void import("../screens/CampaignScreen").then(({ CampaignScreen }) =>
        this.engine.setScreen(CampaignScreen),
      );
      return;
    }
    void import("../screens/PlayScreen").then(({ PlayScreen }) => this.engine.setScreen(PlayScreen));
  }

  /** Online: leave the match and go back to the party lobby. */
  private returnToLobby(): void {
    if (!Net.room) {
      void import("../screens/MenuScreen").then(({ MenuScreen }) => this.engine.setScreen(MenuScreen));
      return;
    }
    void import("../screens/LobbyScreen").then(({ LobbyScreen }) => this.engine.setScreen(LobbyScreen));
  }

  // --- main loop ---------------------------------------------------------

  /** Debug: remove all AI so movement/aim/maps can be tested solo. Toggle with B. */
  private removeBots(): void {
    for (const u of this.units.slice()) {
      if (u.ai) {
        this.unitLayer.removeChild(u.view);
        u.destructor();
        this.units.splice(this.units.indexOf(u), 1);
      }
    }
    this.match.setPlayers();
    this.hud.setBanner("Bots disabled");
  }

  enterFrame(_dt: number): void {
    // Crosshair tracks the cursor and re-reads the weapon's spread state.
    this.crosshair.enterFrame(Input.mouseX, Input.mouseY, this.player);

    // The player's head is the audio listener: every world sound attenuates
    // and pans against it. Updated before anything can fire this tick, and
    // outside the !paused block so it also holds while dead/spectating (the
    // corpse's last position is a better reference than a stale one).
    if (this.player) {
      Sound.setListener(this.player.x, this.player.y - 45 * this.player.scale);
    }

    // H = hide the HUD (screenshot / spectator mode). Chosen because every
    // other sensible key is taken: WASD+arrows+Space move, Q/E/R/1-7 weapons,
    // Tab scoreboard, P pause, B/M debug.
    if (Input.wasPressed("KeyH")) this.toggleSSmode();
    this.advanceSSToast();

    // B key (single-player only — touching the roster online would desync the
    // authoritative snapshot). In the sandbox it freezes/unfreezes the bots so
    // you can line up shots; anywhere else it clears them for solo testing.
    if (this.netRole === "off" && Input.wasPressed("KeyB")) {
      if (SD.matchSettings.level === "sandbox") {
        this.botsDisabled = !this.botsDisabled;
        this.hud.setBanner(this.botsDisabled ? "Bot AI: OFF" : "Bot AI: ON");
      } else {
        this.removeBots();
      }
    }

    // On a client the local Player isn't ticked, so its scoreboard/pause
    // hotkeys are handled here instead of in Player.readInput.
    if (this.netRole === "client") {
      if (Input.wasPressed("Tab")) SD.toggleScores();
      if (Input.wasPressed("KeyP")) SD.togglePause();
    }

    // The match is over but the arena is NOT frozen: the fight plays on under
    // the round-end card until the card's own timer hands back to the level
    // screen, so the tick falls through to the normal sim below.
    if (this.gameOver) this.advanceRoundEnd();

    if (this.introTimer > 0) {
      this.introTimer--;
      if (this.introTimer === 0) {
        this.gameStarted = true;
        this.hud.setBanner("");
      }
    }

    if (!SD.paused) {
      if (this.netRole === "client") {
        this.clientTick();
      } else {
      for (const u of this.units) {
        // Arena containment first, where `Unit.as:577` does it — at the top of
        // the unit's frame, so anything that ended last tick outside the box
        // dies before it moves again. It lives here rather than in
        // `Unit.EnterFrame` because Player / AI / NetPlayer all override that
        // without chaining to super.
        if (!u.status.dead) u.containInArena();
        // Runs dead or alive: it is only the multikill window closing, and the
        // original ticks it from `Score.EnterFrame` regardless of state.
        u.score.enterFrame();
        if (!u.status.dead) {
          u.EnterFrame();
          u.gun.enterFrame();
          u.status.enterFrame();
          // Time-on-the-crown, the stat the Jug buff is scored by.
          if (u.isJug) u.score.jugTicks++;
        } else {
          u.respawnTimer();
        }
      }

      // Tick pickups and test against all live units.
      for (const p of this.arena.itemPickups) p.enterFrame();
      for (const p of this.arena.weapPickups) p.enterFrame();
      this.arena.enterFrame(); // animated hazards / jump pads
      // The wave surface reads every unit's position and velocity, so it ticks
      // here rather than inside the arena (`Game.EnterFrame` -> `water.EnterFrame`).
      this.arena.water?.enterFrame(this.units as any);
      for (const u of this.units) {
        if (u.status.dead) continue;
        for (const p of this.arena.itemPickups) p.tryTouch(u as any);
        for (const p of this.arena.weapPickups) p.tryTouch(u as any);
      }

      for (const fx of this.frameEff.slice()) fx.enterFrame();
      this.rdPhys.enterFrame();
      if (this.gameStarted) {
        this.objectives?.enterFrame();
        this.tutorial?.enterFrame();
        this.tickCampaignDialogue();
        this.tickCampaignTimeout();
      }
      this.match.enterFrame();
      this.updateFx();

      this.checkScoreCap();

      this.updateCamera();
      if (this.netRole === "host") this.hostBroadcast();
      }
    }

    // Redrawn after the world has moved, and outside the !paused block so the
    // boxes can be inspected frozen. Cheap no-op while the toggle is off.
    this.drawHitboxes();

    // Re-capture the authored reflection window last, once everything it
    // reflects has settled for the frame (`Arena.doReflections` is likewise the
    // tail of the arena's EnterFrame). Only the maps with one pay for it.
    this.arena.reflection?.update(
      (this.engine as any).app?.renderer,
      [this.fxBehind, this.rdPhys.view, this.unitLayer, this.fxFront],
    );

    this.hud.enterFrame();
  }

  // --- debug hitbox overlay (M) ------------------------------------------

  /**
   * Draw every collision volume the simulation actually uses: unit AABBs,
   * arena wall rects, pickup touch boxes and ragdoll fixtures.
   *
   * Each family batches its geometry into one path and issues a single
   * stroke(), so the whole overlay costs four draws no matter how busy the
   * arena is. Nothing is drawn — and the Graphics is not even cleared a second
   * time — while the toggle is off, so the debug view is free when unused.
   */
  private drawHitboxes(): void {
    // Screenshot mode exists to produce clean captures; debug chrome is
    // exactly what it is meant to suppress.
    const on = Input.showHitboxes && !SD.ssMode;
    if (!on) {
      if (this.hitboxDrawn) {
        this.hitboxG.clear();
        this.hitboxLabel.visible = false;
        if (this.maskSil) this.maskSil.visible = false;
        this.hitboxDrawn = false;
      }
      return;
    }
    this.hitboxDrawn = true;

    const g = this.hitboxG;
    g.clear();

    // Walls (red). Rotated walls are drawn as their unrotated footprint —
    // no level currently ships one, and an approximate box beats skipping it.
    for (const w of this.arena.walls) {
      g.rect(w.x - w.width / 2, w.y - w.height / 2, w.width, w.height);
    }
    g.stroke({ color: 0xff3333, width: 1, alpha: 0.5 });

    // Fitted walkable diagonals (green), drawn over the rects they replace so
    // it is obvious at a glance which staircases are being ridden as slopes.
    if (this.arena.slopes.length) {
      for (const s of this.arena.slopes) g.moveTo(s.x0, s.y0).lineTo(s.x1, s.y1);
      g.stroke({ color: 0x33ff88, width: 2, alpha: 0.9 });
    }

    // Pixel-mask maps (Raze 2) collide against a silhouette, not rects — so
    // there are no wall boxes above. Draw the mask itself as a pixel-perfect
    // red overlay (a single world-space sprite), so slopes and curves read as
    // slopes rather than a blocky cell grid.
    const mask = this.arena.wallMask;
    if (mask) {
      if (!this.maskSil) {
        this.maskSil = new Sprite(mask.silhouetteTexture());
        this.maskSil.tint = 0xff3333;
        this.maskSil.alpha = 0.3;
        this.arena.view.addChild(this.maskSil);
        // Keep the stroke overlay (unit/pickup boxes) on top of the silhouette.
        this.arena.view.addChild(this.hitboxG);
      }
      this.maskSil.visible = true;
    }

    // Pickups (yellow). These are the literal touch tests in tryTouch(): a
    // box centred on the spec position, NOT on the bobbing icon.
    let pickups = 0;
    for (const p of this.arena.itemPickups) {
      if (!p.view.visible) continue;
      g.rect(p.spec.x - 18, p.spec.y - 18, 36, 36);
      pickups++;
    }
    for (const p of this.arena.weapPickups) {
      if (!p.view.visible) continue;
      g.rect(p.spec.x - 22, p.spec.y - 18, 44, 36);
      pickups++;
    }
    g.stroke({ color: 0xffdd33, width: 1, alpha: 0.5 });

    // Ragdoll fixtures (cyan). The heaviest family by far — a single corpse is
    // 14 bodies — so it is the one the Low profile drops.
    let bodies = 0;
    if (Quality.detail) {
      for (const actor of this.rdPhys.actors) {
        for (const body of actor.allParts) bodies += this.traceBody(body);
      }
      for (const gun of this.rdPhys.guns) bodies += this.traceBody(gun.body);
      g.stroke({ color: 0x33ffff, width: 1, alpha: 0.5 });
    }

    // Units (green), stroked last so a body is never hidden under a wall line.
    let units = 0;
    for (const u of this.units) {
      if (u.status.dead) continue;
      const b = u.bounds();
      g.rect(b.l, b.t, b.r - b.l, b.b - b.t);
      units++;
    }
    g.stroke({ color: 0x33ff66, width: 2, alpha: 0.5 });

    // Combat hurt box (amber) — the box shots are actually tested against. It
    // is taller and wider than the green movement box, so both are drawn.
    for (const u of this.units) {
      if (u.status.dead) continue;
      const h = u.hurtBounds();
      g.rect(h.l, h.t, h.r - h.l, h.b - h.t);
    }
    g.stroke({ color: 0xffaa22, width: 2, alpha: 0.6 });

    this.hitboxLabel.visible = true;
    const geo = this.arena.wallMask
      ? "mask"
      : `walls ${this.arena.walls.length}` +
        (this.arena.slopes.length ? ` slopes ${this.arena.slopes.length}` : "");
    this.hitboxLabel.text =
      `HITBOXES: ON  units ${units}  ${geo}` +
      `  pickups ${pickups}  bodies ${bodies}`;
  }

  /**
   * Append one planck body's fixtures to the overlay path, converting meters
   * to arena pixels. Returns the number of fixtures traced.
   *
   * planck's shape internals are untyped here, so the vertex/radius reads go
   * through `any`; both shape kinds in this game (Box, Circle) are covered and
   * anything else is skipped rather than mis-drawn.
   */
  private traceBody(body: any): number {
    let n = 0;
    for (let f = body.getFixtureList?.(); f; f = f.getNext()) {
      const shape: any = f.getShape();
      const verts: any[] | undefined = shape.m_vertices;
      if (verts && verts.length) {
        for (let i = 0; i < verts.length; i++) {
          const p = body.getWorldPoint(verts[i]);
          if (i === 0) this.hitboxG.moveTo(p.x * PTM, p.y * PTM);
          else this.hitboxG.lineTo(p.x * PTM, p.y * PTM);
        }
        this.hitboxG.closePath();
        n++;
      } else if (typeof shape.m_radius === "number" && shape.m_p) {
        const p = body.getWorldPoint(shape.m_p);
        this.hitboxG.circle(p.x * PTM, p.y * PTM, shape.m_radius * PTM);
        n++;
      }
    }
    return n;
  }

  /** Hold the screenshot-mode toast, then fade it over the last ~0.5s. */
  private advanceSSToast(): void {
    if (this.ssToastTicks <= 0) return;
    this.ssToastTicks--;
    this.ssToast.alpha = this.ssToastTicks > 15 ? 1 : this.ssToastTicks / 15;
  }

  /**
   * Deathmatch victory: first to the cap. In team deathmatch the cap is checked
   * against the combined team total, not a single player's tally. Elimination
   * modes have no cap — Match decides those.
   */
  private checkScoreCap(): void {
    if (this.gameOver) return;
    const cap = this.match.maxScore || 20;
    const type = SD.matchSettings.type;

    if (type === "tdm" || type === "ctf" || type === "dom") {
      const totals = this.teamTotals();
      for (const team of Object.keys(totals)) {
        if (totals[+team] >= cap) {
          this.endGame(this.player.team === +team);
          return;
        }
      }
      return;
    }

    // Deathmatch and Juggernaut are free-for-all: first individual to the cap.
    if (type !== "dm" && type !== "jug") return;
    for (const u of this.units) {
      if (u.score.value >= cap) {
        this.endGame(u === (this.player as any));
        return;
      }
    }
  }

  /**
   * Combined score per team — objective points where a controller is running
   * (CTF captures / Domination holds), summed kills otherwise, which is also
   * the fallback for a non-Raze 2 level with no objective nodes.
   */
  private teamTotals(): Record<number, number> {
    const type = SD.matchSettings.type;
    const teams = Math.max(2, Number(SD.matchSettings.teams) || 2);
    const totals: Record<number, number> = {};
    for (let t = 1; t <= teams; t++) totals[t] = 0;
    if ((type === "ctf" || type === "dom") && this.objectives?.active) {
      for (let t = 1; t <= teams; t++) totals[t] = this.teamScore[t] ?? 0;
    } else {
      for (const u of this.units) totals[u.team] = (totals[u.team] ?? 0) + u.score.value;
    }
    return totals;
  }

  /**
   * Shake the camera, `Arena.shake()`. Amplitudes are in px and bleed away by
   * SHAKE_DECAY per tick; the jitter is applied to the camera *target*, so it
   * is smoothed by the same ease as everything else rather than buzzing.
   */
  shakeCamera(x: number, y: number = x): void {
    if (x > this.shakeX) this.shakeX = x;
    if (y > this.shakeY) this.shakeY = y;
  }

  /** Where the camera is looking: the player, or their corpse once they die. */
  private cameraFocus(): { x: number; y: number } | null {
    const p: any = this.player;
    if (!p) return null;
    if (!p.status.dead) return { x: p.x, y: p.y };
    // Dead: ride the ragdoll's torso instead of freezing where they fell, so a
    // death that throws the body still reads (`Arena.as:1108,1122` follow
    // `camFocus.dead.rdBody`, offset 50px down the corpse).
    const actor = this.rdPhys?.actors?.find((a: any) => a.unit === p);
    const body = actor?.part_body;
    if (!body) return null;
    const pos = body.getPosition();
    return { x: pos.x * PTM, y: pos.y * PTM + 50 };
  }

  private updateCamera(): void {
    const focus = this.cameraFocus();

    const W = GAME_WIDTH;
    const H = GAME_HEIGHT;
    const Z = CAMERA_ZOOM;

    // Arena is drawn scaled up by the zoom (smaller field of view). Everything
    // below works in scaled screen px: scaled world = worldW * Z.
    this.arena.view.scale.set(Z);
    const arenaW = this.arena.worldW * Z;
    const arenaH = this.arena.worldH * Z;

    // Shake bleeds off every tick whether or not anything is being followed.
    const shkX = this.shakeX ? UT.rand(-this.shakeX, this.shakeX) : 0;
    const shkY = this.shakeY ? UT.rand(-this.shakeY, this.shakeY) : 0;
    this.shakeX = Math.max(0, this.shakeX - SHAKE_DECAY);
    this.shakeY = Math.max(0, this.shakeY - SHAKE_DECAY);

    if (focus) {
      // Target: the focus centred, pulled toward the cursor by camIntense, and
      // biased down so the unit sits a little below the middle of the screen.
      // The lead is what lets you see across the map by aiming at it; it uses
      // the raw stage cursor (like `game.mouseX`), NOT a world position derived
      // from the camera, which would feed back on itself.
      let tx = W / 2 - focus.x * Z;
      let ty = H / 2 - focus.y * Z + CAM_Y_BIAS;
      if (this.camUseAim) {
        tx -= (Input.mouseX - W / 2) * this.camIntense;
        ty -= (Input.mouseY - H / 2) * this.camIntense;
      }
      tx += shkX;
      ty += shkY;

      this.camX += (tx - this.camX) * CAM_EASE;
      this.camY += (ty - this.camY) * CAM_EASE;
    }

    // Clamped AFTER the ease, as the original does: the camera stops dead at
    // the level edge instead of easing into it, so pushing into a wall doesn't
    // drift the view. `Math.min` guards worlds smaller than the viewport.
    this.camX = Math.min(0, Math.max(W - arenaW, this.camX));
    this.camY = Math.min(
      CAM_TOP_SLACK,
      Math.max(H - arenaH - CAM_BOTTOM_INSET, this.camY),
    );

    this.arena.view.x = Math.round(this.camX);
    this.arena.view.y = Math.round(this.camY);

    // Keep arena logical offset in sync so Unit.moveUnit() aim uses the right coords.
    this.arena.x = this.arena.view.x;
    this.arena.y = this.arena.view.y;

    // Backdrop parallax: the sky travels with the camera at BG_PARALLAX speed.
    // It was sized for exactly this travel in the constructor, so it stays
    // covering the viewport at both extremes without ever exposing an edge.
    if (this.bgSprite) {
      this.bgSprite.x = this.bgHome.x + Math.round(this.camX * BG_PARALLAX);
      this.bgSprite.y = this.bgHome.y + Math.round(this.camY * BG_PARALLAX);
    }
  }

  destructor(): void {
    // Tear down the online session (unsubscribe relay) and clear the MP context
    // so the next single-player match isn't mistaken for a networked one.
    if (this.netRole !== "off") {
      this.netMatchEndUnsub?.();
      this.netMatchEndUnsub = null;
      NetGame.end();
      (SD as any).mp = null;
    }
    // Leaving the match must not leave the HUD hidden for the next one.
    SD.setSSmode(false);
    Sound.stopAmbience();
    this.unsubQuality?.();
    this.unsubQuality = null;
    SD.removeGame();
    const canvas = (this.engine as any).app?.canvas as HTMLCanvasElement | undefined;
    if (canvas) canvas.style.cursor = "default";
    this.rdPhys.destroy();
    super.destructor();
  }
}
