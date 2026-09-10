import { Container, Graphics, Matrix, Sprite, Text, TextStyle, type Texture } from "pixi.js";
import { UT } from "../core/UT";
import { K } from "../core/K";
import { SD } from "../state/SD";
import { Score } from "./Score";
import { Achievements } from "./Achievements";
import { computeKillBonuses, killPoints } from "./KillBonus";
import { Status } from "./Status";
import { Guns } from "./Guns";
import { getAbility } from "./Abilities";
import { ArmArt } from "../assets/ArmArt";
import { ArmAnim } from "../assets/ArmAnim";
import { ArmAnim2 } from "../assets/ArmAnim2";
import { AnimNoArm } from "../assets/AnimNoArm";
import { AnimNoHead } from "../assets/AnimNoHead";
import { HeadArt } from "../assets/HeadArt";
import { PartArt } from "../assets/PartArt";
import { SkinAnim } from "../assets/SkinAnim";
import { Sound } from "../audio/Sounds";
import type { SurfaceMods } from "./WallMask";
import ARM_RIG from "../assets/armRig.json";
import type { AnimState as LegacyAnimState } from "../assets/Anim";
import { UnitAnimator, type AnimState } from "./UnitAnim";
import type { GameScreen } from "./GameScreen";
import { C_TEAM1, C_TEAM1_BACK, C_TEAM2, C_TEAM2_BACK, C_TEAM3, C_TEAM_FFA } from "../ui/raze2/palette";

/**
 * Fold the 12-state Raze 2 machine down onto the 7 states the older Raze 1 art
 * sets (`Anim` / `AnimNoArm` / `AnimNoHead` / the part rig) actually have baked.
 * The landing and crouch-transition poses are Raze 2 additions, so on those art
 * sets they render as the pose they resolve into.
 */
function legacyAnimState(state: AnimState): LegacyAnimState {
  switch (state) {
    case "landrun": return "run";
    case "landrunback": return "runback";
    case "land": return "idle";
    case "duck":
    case "getup": return "crouch";
    default: return state as LegacyAnimState;
  }
}

/**
 * Per-state character rig, extracted from the SWF body-state clips (idle=686,
 * run=851, jump=852, fall=853, crouch=860, runback=859).
 *
 * FFDec crops each state's frames to that state's own bounding box, so the
 * armless body PNGs have a DIFFERENT canvas size per state and their feet /
 * shoulder no longer sit at a fixed anchor fraction. `armRig.json` restores the
 * registration: `anchorX/Y` is the animation clip's ORIGIN as a fraction of the
 * state's canvas (a physically consistent point across states), and `arm[frame]`
 * is the front-arm (chid 685) attachment point in native clip px for that frame.
 * Anchoring the body at the clip origin and placing the overlay arm at the raw
 * clip coords keeps the arm welded to the shoulder through every pose.
 */
interface RigState {
  anchorX: number;
  anchorY: number;
  arm: [number, number][];
}
const RIG = ARM_RIG as unknown as {
  rootY: number;
  states: Record<string, RigState>;
};
// Native px height of the clip origin above the unit's feet (ground contact).
const ROOT_Y = RIG.rootY;

/**
 * Base actor. Ported from Unit.as.
 *
 * The original live character does NOT use Box2D — it is a custom kinematic
 * controller (Box2D is only for death ragdolls / dropped guns). This reproduces
 * that model with the extracted constants: horizontal accel 2.3 (air 1.6),
 * max speed 12, jump impulse -15, gravity 0.8, terminal fall 20, plus a
 * separated-axis AABB collision pass against the arena's solid rectangles.
 *
 * Rendering is a placeholder stick-figure sized to the character until the real
 * sprite pipeline (task 7) is wired in; the death ragdoll already uses physics.
 */

interface Moving {
  vel: number;
  acc: number;
  airAcc: number;
  brake: number;
  /** Idle brake while crouched (doc 01 §1 xCrouchBrake) — much softer than the
   *  standing brake, so a crouched unit keeps its momentum. */
  crouchBrake: number;
  airBrake: number;
  max: number;
}
interface Jumping {
  vel: number;
  grav: number;
  fallMax: number;
  dJump: boolean;
  /** Set on the double jump; drives the tucked-flip body pose until landing. */
  tuck?: boolean;
}

/**
 * World/physics footprint of a unit: every collision probe, step-up limit and
 * hitbox dimension is expressed as a native constant times this. It is tuned so
 * the probes land where `Movement.as`'s raw ones do (`hitTest(17,-20)` …
 * `hitTest(0,-50)`), and is NOT a render scale — see `bodyScale()`.
 */
export const UNIT_SCALE = 0.42;

/**
 * Render scale of the legacy Raze-1 body/head art (~121px native crown-to-feet)
 * against the 1:1 arena. Matches the Raze 2 skin bake's on-screen height.
 */
export const RIG_ART_SCALE = 0.66;

// Head height for the name bar (native px above feet). The body/arm registration
// now comes from the rig; this is only used to float the name tag above the head.
const SHOULDER_Y = -92;
const DEG = Math.PI / 180;

/** Degrees the weapon drops while reloading (`Unit.as:1122`, doc 02 §2.2). */
const RELOAD_DIP_DEG = 30;
/** Per-frame ease toward the dip target — the source's `* 0.2`. */
const RELOAD_DIP_EASE = 0.2;
// Render scale for the authentic Raze 2 held arm+gun composite. The baked art
// is drawn about the shoulder pivot, so scaling it keeps the shoulder attached
// while enlarging the whole arm+weapon. Bumped to 2x for a clearer read of each
// weapon's distinct gun art.
/**
 * On-screen scale of the aim arm + gun art, in the SAME native basis as the
 * body (which now renders at 1.0 against a 1:1 arena — see `CAMERA_ZOOM`).
 *
 * This used to be `this.scale * 2` = 0.84 against a body at 0.66 — the arm was
 * 27% larger than the body it hangs off, because the two were expressed in
 * different bases and only the body was re-scaled when the Raze 2 skin bakes
 * landed. Both are one number now, so they cannot drift apart again.
 */
export const ARM_SCALE = 1;
// Body-centre pivot (native px above feet): the double-jump flip spins about
// this point. Set near the middle of the ~124px-tall figure for a natural tumble.
const TORSO_PIVOT_Y = -62;
// Angular step of the double-jump front-flip; a full turn takes ~2pi/step ticks.
const FLIP_STEP = 0.36;
// Per-frame falloff of weapon knockback. 0.55^3 ≈ 0.17, so the shove is spent
// in about 0.1s at the fixed 30Hz logic rate — a shunt, not a slide.
const KNOCK_DECAY = 0.55;

// Maximum ledge height (native px, BEFORE scale) the kinematic controller will
// auto-step onto. The authentic levels greedy-mesh sloped art into a staircase
// of short axis-aligned rects; without a step-up the unit jams against every
// riser and cannot ascend. Anything taller than this reads as a real wall and
// still blocks. ~20px is a comfortable stair riser relative to the ~124px-tall
// figure, and caps how far we climb in a single tick for a smooth ascent.
// Max ledge (native px) the unit auto-climbs in one tick. Sized above the
// staircase risers the slope collision is meshed into, so stepped slopes are
// walked up smoothly instead of jamming the unit against each riser.
const STEP_UP_MAX = 30;

/**
 * Combat hurt box in native px about the feet, standing and crouching, exactly
 * as `Bullet.as:544-644` writes it. `head` and `low` are [top, bottom] bands
 * inside the body box; `low` reads as a crotch shot from the front and a butt
 * shot from behind. `broadHalfW` is the 50-wide first pass, `halfW` the 40-wide
 * box the zones are cut from.
 *
 * These are NOT multiplied by `UNIT_SCALE`. The original authored them against
 * an ~80px figure, and that is exactly what the Raze 2 skin bake now draws on a
 * 1:1 arena (measured: crown 84px above the feet, 40px across). Scaling them by
 * 0.42 — as the port did — left a 17x54 box under an 80px model, so the head sat
 * entirely above its own hitbox and most shots at the chest missed.
 */
const HURT = {
  broadHalfW: 25,
  halfW: 20,
  stand: { top: -80, head: [-80, -63], low: [-37, -27] },
  crouch: { top: -60, head: [-60, -43], low: [-25, -18] },
} as const;

// Nameplate health-bar geometry (doc 07 §2.2/§2.4): the SWF bar is 75px wide
// (`bar_width = 75`, Status.as:103); scaled by the unit render scale it reads as
// a compact floating bar above the head. Height is a thin continuous fill.
const NAMEPLATE_BAR_W = Math.round(75 * UNIT_SCALE); // ≈ 32px (unused legacy base)
// Fixed plate width — the reference nameplates are a constant size regardless of
// name length; a longer name simply centres and may overhang slightly.
const NAMEPLATE_W = 64;
// The nameplate is one integrated plate (reference bars 20/21): the unit name
// sits ON the team-coloured health fill (glossy — brighter at the top), a thin
// contrast energy strip runs along the bottom edge, all inside a dark border.
const NAMEPLATE_H = 8.1; // health / name row height
const NAMEPLATE_EN_H = 1.5; // energy strip height (bottom edge)
// Plate top, nameBox-local. The plate grows upward off a fixed bottom edge, so
// a taller health row never creeps down over the unit's head.
const NAMEPLATE_TOP = -6.6;
const NAMEPLATE_HP_Y = NAMEPLATE_TOP; // health fill occupies the name row
const NAMEPLATE_EN_Y = NAMEPLATE_TOP + NAMEPLATE_H; // energy strip below it

// Native px of ground covered per footstep. Because the trigger is *distance*
// rather than a timer, the step cadence rises naturally with running speed and
// stops dead when the unit does — no per-state animation hookup needed.
const STRIDE_PX = 44;
// Fall speed (px/frame) below which a landing is silent. Walking off a low kerb
// shouldn't thud; `fallMax` is 20, so this is roughly a knee-height drop.
const LAND_MIN_VEL = 6;

// Hearing ranges for body sounds, in arena pixels (see Sound.playAt). These are
// short on purpose: a footstep you can hear means somebody is genuinely close,
// which makes it information rather than clutter. With eight bots running
// around, a map-wide footstep range would be a constant shuffle.
const STEP_RANGE = 420;
const LAND_RANGE = 560;
// The respawn whoosh is a game event rather than a body sound, so it carries.
const SPAWN_RANGE = 900;

// Occasional character chatter, shown as a short speech line above the name.
const SPAWN_LINES = ["Here we go!", "Ready!", "Back in!", "Let's do this."];
const KILL_LINES = ["Got him!", "Take that!", "Boom!", "Too easy.", "Next!"];
function pick(a: string[]): string {
  return a[Math.floor(Math.random() * a.length)];
}

export class Unit {
  readonly view = new Container();

  /**
   * Live-unit knockback / hit-stun master switch. The original Raze 2 applies NO
   * knockback or stagger to a LIVING unit — `Stats_Guns.force` only drives the
   * Box2D death ragdoll (doc 01 §8). The port's self-recoil shove + hit-stun are
   * invented features, so they default OFF to match the source. The fields and
   * methods are kept (guarded) so weapon/status code still compiles and the
   * death-ragdoll impulse path is entirely unaffected.
   */
  static LIVE_KNOCKBACK = false;

  game: GameScreen;
  human: boolean;
  ai: boolean;
  team = 0;
  spawnOrder = 0;
  /** Stable network id for online play (matches snapshots to units). */
  netId = "";
  /** Client-side: this unit is driven by network snapshots, not simulated. */
  remote = false;
  /** Client-side: last-seen firing flag, for muzzle-flash edge detection. */
  private _netFiring = false;
  _name = "";
  pers = "gamer";
  diffMod = 1;
  extra: any;
  isJug = false;
  /** CTF: the enemy flag this unit is currently carrying (see Objectives). */
  hasFlag: any = null;
  /** Team to restore when the Juggernaut buff is dropped. */
  private jugTeam = 0;

  x = 0;
  y = 0;
  scale = UNIT_SCALE;
  /** Facing: +1 faces right, -1 faces left. Mirrors AS3 animMC.scaleX. */
  facing = 1;
  aimX = 0;
  aimY = 0;
  aimRotation = 0;
  /**
   * Horizontal weapon-recoil impulse in px/frame, applied on top of the walk
   * velocity and decayed by KNOCK_DECAY each tick. Kept separate from
   * `moving.vel` so firing never fights the player's movement input.
   */
  knockVel = 0;
  /**
   * Frames of hit-stun remaining. While non-zero the unit cannot drive itself:
   * movement input is ignored and it coasts to a stop, so a heavy hit visibly
   * staggers the target instead of being absorbed with no reaction at all.
   */
  hitStun = 0;

  /** Ground covered since the last footstep, in px. See STRIDE_PX. */
  private stepDist = 0;
  /** Last tick's fall velocity, kept so a landing knows how hard it was. */
  private fallVel = 0;

  keys = 0;
  moving!: Moving;
  jumping: Jumping | null = null;
  crouching: boolean = false;
  /** Terrain surface under the feet this tick (mud/ice/water/…), or null on plain
   *  ground. Recomputed every frame in `moveUnit`, consumed by the accel/brake/
   *  gravity math and by `doJump` (modJump). Not sticky — leaving the zone
   *  reverts to defaults, matching the SWF `resetMods()` model (doc 01 §7). */
  surfaceMods: SurfaceMods | null = null;

  /**
   * Passive equipment effect map (`equips[type] = value`), mirroring the SWF
   * `unit.equips`. Populated for the human player from the profile loadout; bots
   * leave it empty, so every `equips.<type>` check is a harmless no-op for them.
   */
  equips: Record<string, number> = {};
  /** The equipped F-key ability def (see game/Abilities.ts). */
  ability: any = null;
  /**
   * Frames the unit is locked out of all actions by an ability (Static Field's
   * lockdown). While non-zero, movement input is ignored and firing is blocked.
   */
  abilityLock = 0;

  status!: Status;
  score: Score;
  gun: Guns;
  costume: any;

  canRespawn = false;
  /** Frames spent waiting to respawn; the HUD renders it as a countdown. */
  respawnCount = 0;

  // Shims so the physics ragdoll (RdActor/RdGun) can read the same fields the
  // AS3 Unit exposed.
  animMC = { scaleX: 1 };
  ragActor: any = null;
  ragDoll: any = null;

  // --- rendering ---------------------------------------------------------
  /** Holds the body + arm so the whole character can spin (double-jump flip)
   * about the torso, independently of the fixed name tag. */
  private charC = new Container();
  /** Fallback stick figure while the baked animation art is still loading. */
  private bodyG = new Graphics();
  /** Baked armless SWF body frame (authentic motion, no arm). */
  private bodySprite: Sprite | null = null;
  /** Front weapon arm + gun, overlaid and rotated about the shoulder to aim. */
  private armSprite: Sprite | null = null;
  /** Back arm (`UnitMC.arm2`): same shoulder, same angle, drawn behind the body. */
  private arm2Sprite: Sprite | null = null;
  private armGunId = "";
  /**
   * Playhead into the equipped weapon's baked arm band (`ArmAnim`), in cells.
   * Fractional while reloading, since the reload is mapped across the port's
   * per-weapon `reloadFrames` rather than the band's own length.
   */
  private armCell = 0;
  /** True while the `_fire` recoil band is running (`Guns.as` "fire" state). */
  private armFiring = false;
  /** Last seen `Guns.shotCount`, to catch the trigger pull that restarts it. */
  private armShot = 0;
  /** Separate costume head, welded at the neck and rotated toward the aim. Only
   * used when the headless body + head art are available (else the head stays
   * baked into the body frame). */
  private headSprite: Sprite | null = null;
  private headCostume = -1;
  /** Whether this unit renders with the separate rotatable head layer. */
  private useHead = false;
  /** Layered per-costume rig (SWF parts): container + one sprite per depth. */
  private partsContainer: Container | null = null;
  private partSprites = new Map<number, Sprite>();
  /** Whether this unit renders with the layered part rig (full costume). */
  private useParts = false;
  /** Equipped Raze 2 skin id (empty if none). */
  skinId = "";
  /** Whether this unit renders with the animated Raze 2 skin bake (per skinId).
   *  The baked figure is body+head+legs; the aim arm + gun stay as the overlay. */
  private useSkinAnim = false;
  /** Part-rig render state, which may be a species idle (idleRobot/idleZombie). */
  private renderState = "idle";

  /**
   * The authentic UnitMC playhead (state + frame + the goto() guard table).
   * `animState`/`animFrame` below mirror it for the existing render paths.
   */
  private anim = new UnitAnimator();
  private animState: AnimState = "idle";
  private animFrame = 1;
  /** True on the tick the unit touches down, so the landing pose can be cued. */
  private justLanded = false;
  /** Airborne last tick — used to detect the touchdown edge. */
  private wasAirborne = false;
  /**
   * The reload weapon-dip, in degrees (`Unit.as`'s `rotReload`, doc 02 §2.2):
   *
   *     rotReload += ((reloading && rotArm < 30 ? 30 : 0) - rotReload) * 0.2
   *     arm1.rotation = arm2.rotation = rotReload + rotArm
   *     head.rotation = rotReload + rotArm * 0.6
   *
   * i.e. the character drops the weapon ~30 degrees while reloading and brings
   * it back up afterwards, eased both ways — and the head dips with it.
   */
  private rotReload = 0;
  /** Free-running counter for power-up tint pulses. */
  private fxTick = 0;

  /** Name bar above the head (bar + text), tinted by team colour. */
  private nameBox = new Container();
  private nameBar = new Graphics();
  private nameText: Text | null = null;
  private lastName = "";
  /** Current name-bar pixel width, reused to size the health bar underneath. */
  private nameW = 16;
  /** Small health bar drawn just below the name (green FFA / red / blue by team). */
  private healthBar = new Graphics();
  private lastHpDraw = -1;
  /**
   * Eased width (px) of the trailing red `bar_hurt` damage sliver. Lags behind
   * the main fill after damage and catches up at 5%/frame (doc 14 §2). -1 = not
   * yet initialised.
   */
  private hurtW = -1;
  /** Cached draw key for the energy bar, so it only redraws on visible change. */
  private lastEnDraw = -1;
  /** Per-unit ability-energy row above the health bar (magenta, doc 07 §2.2). */
  private energyBar = new Graphics();
  /** Gold crown drawn over the name bar while this unit holds the Jug buff. */
  private jugCrown = new Graphics();

  /** Short speech line above the name, shown for a couple of seconds. */
  private speechText: Text | null = null;
  private speechTimer = 0;

  /** Double-jump front-flip state. */
  private flipActive = false;
  private flipAngle = 0;
  private flipDir = 1;
  /** True from a double jump until landing — plays the tuck pose (SWF "tuck"). */
  private tucking = false;
  /**
   * Whole-body lean to match the ground slope, in radians (smoothed). Ported
   * from the original's `tiltMC`: the character leans to the angle between the
   * ground under each foot. Our collision is axis-aligned (no true slopes), so
   * this is ~0 on flat/stair ground and only leans on gentle real height
   * differences — harmless where it can't apply, faithful where it can.
   */
  private tilt = 0;

  constructor(game: GameScreen, human: boolean, team: number, extra: any) {
    this.game = game;
    this.human = human;
    this.ai = !human;
    this.extra = extra ?? {};
    // Equipment loadout + ability must be set BEFORE respawn() builds Status,
    // since the health / spawn-shield / recharge effects are read there.
    this.equips = this.extra.equips ?? {};
    // Abilities On/Off toggle (doc 11 §7): outside campaign, a match with
    // abilities disabled forces every unit's ability to "none". Campaign always
    // grants abilities regardless of the stored flag (the SWF `isCampaign ||`
    // short-circuit). Equipment has the same toggle, handled at the source in
    // Equipment.equipmentEnabled() (which builds `extra.equips`), so nothing to
    // do here for that one.
    const abilitiesOn = !!SD.matchSettings.campaign || SD.matchSettings.abilitiesOn !== false;
    this.ability = getAbility(abilitiesOn ? this.extra.ability : "none");
    this.initCostume(this.extra, team);
    this.score = new Score(this);
    this.gun = new Guns(this);
    // The flip pivot sits at the torso; matching position keeps the character
    // visually in place while `charC.rotation` spins it about that point.
    this.charC.pivot.set(0, TORSO_PIVOT_Y * this.bodyScale());
    this.charC.position.set(0, TORSO_PIVOT_Y * this.bodyScale());
    this.charC.addChild(this.bodyG);
    this.view.addChild(this.charC);
    this.buildNameBox();
    this.setTeam(team);
    this.respawn();
  }

  // --- costume / identity ------------------------------------------------

  initCostume(extra: any, team: number): void {
    const c: any = {};
    c.ohead = extra.head ?? extra.preset ?? 1;
    c.obody = extra.body ?? extra.preset ?? 1;
    c.olegs = extra.legs ?? extra.preset ?? 1;
    c.preset = extra.preset ?? 1;
    // Every unit renders on the animated Raze 2 skin bake. Callers that have a
    // skin to name (the player's equipped one, a campaign bot's scripted one)
    // pass it; the rest take one off the preset, which is deterministic — so
    // host and client agree without the roster having to carry a skin field.
    // Without this the unit falls back to the Raze 1 rig, which is a different
    // art set at a different size, and stands noticeably shorter than the
    // player next to it.
    const pool = SkinAnim.manifest.skins;
    this.skinId = extra.skin ?? pool[(c.preset - 1) % pool.length] ?? "";
    if (SD.matchSettings.campaign) {
      c.head = c.ohead;
      c.body = c.obody;
      c.legs = c.olegs;
    } else {
      c.head = c.ohead + team * 30;
      c.body = c.obody + team * 30;
      c.legs = c.olegs + team * 30;
    }
    this.costume = c;
  }

  setCostume(): void {
    this.drawFigure();
  }

  setName(n: string): void {
    this._name = n;
  }

  setTeam(team: number): void {
    this.team = team;
    this.drawFigure();
  }

  /**
   * Become the Juggernaut: a "king of the hill" buff granted by the crown
   * pickup. The holder gets a heavy shield bank on top of their own, hits
   * harder (see Status.damageMult), wears a gold name bar + crown, and is
   * announced to the whole arena so everyone knows who to hunt.
   *
   * Only one unit can hold it; SD.matchSettings.curJug is the arena-wide handle
   * that the pickup checks before it re-arms.
   */
  setJug(): void {
    if (this.isJug) return;
    const prev = SD.matchSettings.curJug as Unit | null;
    if (prev && prev !== this) prev.removeJug();

    this.isJug = true;
    this.jugTeam = this.team;
    SD.matchSettings.curJug = this;

    const shMult = Number(SD.matchSettings.jugSh) || 2;
    this.status.shMax = 1000 * shMult;
    this.status.shCur = this.status.shMax;

    this.drawFigure();
    this.game.addEffect(this.x, this.y, "getInvin");
    this.game.hud?.announce?.(`${this._name} is the JUGGERNAUT!`, 0xffcc33);
    this.game.hud?.addMessage?.(`${this._name} took the crown`, 0xffcc33);
  }

  /**
   * Drop the Juggernaut buff (on death, or when someone else claims it). The
   * original forced the ex-jug onto team 2 for its dedicated game mode; here we
   * restore whatever team they were on so it works in every mode.
   */
  removeJug(): void {
    if (!this.isJug) return;
    this.isJug = false;
    if (SD.matchSettings.curJug === (this as any)) SD.matchSettings.curJug = null;
    this.status.shMax = 1000;
    this.status.shCur = Math.min(this.status.shCur, this.status.shMax);
    this.setTeam(this.jugTeam);
  }

  private teamColor(): number {
    // Authentic team palette (doc 14 §2 / §6): team1 blue, team2 orange,
    // team3 yellow, FFA/no-team green. Jug overrides to gold.
    if (this.isJug) return 0xffcc33;
    if (this.team === 1) return 0x00ccff;
    if (this.team === 2) return 0xff9900;
    if (this.team === 3) return 0xffff00;
    if (this.team === 4) return 0xcc66ff;
    return 0x00ff00;
  }

  /**
   * Nameplate health-bar colours [front, back] by team (doc 14 §2): bright
   * team-tint front fill over a dark/desaturated team-tint back track.
   */
  private barColors(): [number, number] {
    if (this.isJug) return [0xffcc33, 0x664d00];
    switch (this.team) {
      case 1:
        return [C_TEAM1, C_TEAM1_BACK];
      case 2:
        return [C_TEAM2, C_TEAM2_BACK];
      case 3:
        return [C_TEAM3, 0x996600];
      case 4:
        return [0xcc66ff, 0x4d2673];
      default:
        return [C_TEAM_FFA, 0x006600];
    }
  }

  /** Body animation frame from the active source (headless if the head layer
   *  is in use, else the head-baked body). */
  private bodyFrame(state: AnimState, frame: number): Texture | null {
    const s = legacyAnimState(state);
    return this.useHead
      ? AnimNoHead.getFrame(s, frame)
      : AnimNoArm.getFrame(s, frame);
  }

  /**
   * Render scale of the body art. The two art sets have different native sizes
   * — the Raze-1 rig is ~121px crown-to-feet, the Raze 2 skin bake ~77px — so
   * each carries its own factor that lands them at the same on-screen height
   * against the now 1:1 arena (`RIG_ART_SCALE * 121 ≈ SkinAnim.scale * 77`).
   *
   * This is deliberately NOT `this.scale`: that is the world/physics footprint
   * (the collision probes), which stays put whatever art is drawn over it.
   */
  private bodyScale(): number {
    return this.useSkinAnim ? SkinAnim.scale : RIG_ART_SCALE;
  }

  private drawFigure(): void {
    const s = this.scale;

    // Top priority: the equipped skin has ANIMATED bakes. Render the baked
    // per-state body (head + legs baked in) and keep the aim-tracking arm + gun
    // overlay on top, welded to the baked shoulder track. This is additive over
    // the Raze-1 rig, which still serves as the fallback below.
    if (this.skinId && SkinAnim.loaded && SkinAnim.has(this.skinId)) {
      this.useSkinAnim = true;
      this.useHead = false; // head is baked into the skin body
      if (!this.bodySprite) {
        const body = new Sprite(SkinAnim.getFrame(this.skinId, "idle", 1) ?? undefined);
        const a = SkinAnim.anchor();
        body.anchor.set(a.x, a.y);
        this.bodySprite = body;
        this.charC.addChildAt(body, 0);
        const arm = new Sprite();
        this.armSprite = arm;
        this.charC.addChildAt(arm, 1);
        this.addBackArm();
        this.syncArm();
      }
      this.bodyG.clear();
      return;
    }

    // Preferred path: the authentic LAYERED rig — the body is assembled from
    // separately-costumed SWF parts (neck/body/legs/feet), each welded per frame
    // by the extracted matrices, so head/body/legs customization all render. A
    // separate head + aiming arm sit on top.
    if (PartArt.loaded) {
      this.useParts = true;
      this.useHead = HeadArt.loaded;
      if (!this.partsContainer) {
        const pc = new Container();
        pc.sortableChildren = true;
        this.partsContainer = pc;
        this.charC.addChildAt(pc, 0);

        let z = 1;
        if (this.useHead) {
          const head = new Sprite();
          const piv = HeadArt.pivot();
          head.anchor.set(piv.px, piv.py);
          this.headSprite = head;
          this.charC.addChildAt(head, z++);
        }
        const arm = new Sprite();
        this.armSprite = arm;
        this.charC.addChildAt(arm, z);
        this.addBackArm();
        this.syncArm();
      }
      this.bodyG.clear();
      return;
    }

    // Fallback path: baked armless SWF body frames (fixed costume) plus a
    // separate weapon-arm overlay. Used only if the layered part art is missing.
    if (AnimNoArm.loaded || AnimNoHead.loaded) {
      // Prefer the headless body + separate rotatable head (matches the original
      // aim-tracking rig); fall back to the head-baked body if that art is
      // missing, so the character always renders.
      this.useHead = AnimNoHead.loaded && HeadArt.loaded;
      if (!this.bodySprite) {
        const tex = this.bodyFrame(this.animState, this.animFrame);
        const body = new Sprite(tex ?? undefined);
        const r0 = RIG.states.idle;
        body.anchor.set(r0.anchorX, r0.anchorY);
        this.bodySprite = body;
        // Body (+ head + arm) live in charC so the double-jump flip spins them.
        this.charC.addChildAt(body, 0);

        let z = 1;
        if (this.useHead) {
          const head = new Sprite();
          const piv = HeadArt.pivot();
          head.anchor.set(piv.px, piv.py);
          this.headSprite = head;
          // Head sits above the body but below the aiming arm.
          this.charC.addChildAt(head, z++);
        }

        const arm = new Sprite();
        this.armSprite = arm;
        this.charC.addChildAt(arm, z);
        this.addBackArm();
        this.syncArm();
      }
      this.bodyG.clear();
      return;
    }

    // Fallback: placeholder stick figure (art not loaded yet).
    const col = this.teamColor();
    const hw = 10 * s;
    const hipY = -46 * s;
    const headY = -80 * s;
    this.bodyG.clear();
    this.bodyG.rect(-hw, hipY, hw * 2, -hipY).fill({ color: 0x2b3138 });
    this.bodyG.rect(-hw, headY + 10 * s, hw * 2, hipY - (headY + 10 * s)).fill({ color: col });
    this.bodyG.circle(0, headY, 11 * s).fill({ color: 0xe0c0a0 });
    this.bodyG.stroke({ color: 0x000000, width: 1, alpha: 0.35 });
  }

  /**
   * The back arm. `UnitMC` carries two arm assemblies and the port only ever
   * drew the front one, leaving every character one-armed. `arm2` holds no gun
   * and no hands, so it needs no state of its own — it is inserted at the back
   * of the stack and then rides `arm1`'s playhead and transform.
   */
  private addBackArm(): void {
    const a = new Sprite();
    const anc = ArmAnim2.anchor();
    a.anchor.set(anc.x, anc.y);
    this.arm2Sprite = a;
    this.charC.addChildAt(a, 0);
  }

  /**
   * Drive the weapon arm's animation — this is `Guns.setFrame()`.
   *
   * The original never transforms the arm to show recoil or a magazine change;
   * it just moves the playhead of the arm clip and lets the baked band do the
   * work (`Guns.as:234-249`), with the clip's own frame scripts calling
   * `doneShoot()` / `doneReload()` to drop back to the idle pose:
   *
   *     idle    gotoAndStop(frameIdle)
   *     fire    gotoAndPlay(frameFire + "_fire")     -> runs to doneShoot
   *     reload  gotoAndPlay(frameReload + "_reload") -> runs to doneReload
   *
   * The one deviation: the reload is mapped across the port's per-weapon
   * `reloadFrames` instead of running at the band's native length, so weapon
   * balance is untouched and only the artwork changes.
   */
  private syncArm(): void {
    if (!this.armSprite) return;
    const arm = this.armSprite;
    const id = this.gun?.curGun?.id ?? "pistol";
    const band = ArmAnim.pose(id);

    // On weapon change: re-pivot to that art's shoulder and start its load.
    if (id !== this.armGunId) {
      if (band) {
        const a = ArmAnim.anchor();
        arm.anchor.set(a.x, a.y);
        ArmAnim.ensure(id);
      } else {
        const p = ArmArt.pivot(id);
        arm.anchor.set(p.ax, p.ay);
      }
      this.armGunId = id;
      this.armCell = band?.idle ?? 0;
      this.armFiring = false;
    }

    // The port-invented natives (plasma / grenade / rifle) have no Raze 2 gun
    // art to bake, so they keep the static legacy pose.
    if (!band) {
      const legacy = ArmArt.getTexture(id);
      arm.visible = !!legacy;
      if (legacy) arm.texture = legacy;
      if (this.arm2Sprite) this.arm2Sprite.visible = false;
      return;
    }

    const reloading = !!this.gun?.reloading;
    if (reloading) {
      this.armFiring = false;
      const prog = Math.max(0, Math.min(1, this.gun?.reloadProgress ?? 0));
      this.armCell = band.reload[0] + prog * (band.reload[1] - band.reload[0]);
    } else if (this.armFiring) {
      // Run the recoil band; doneShoot returns the arm to rest.
      this.armCell += 1;
      if (this.armCell > band.fire[1]) {
        this.armFiring = false;
        this.armCell = band.idle;
      }
    } else {
      this.armCell = band.idle;
    }

    // A trigger pull restarts the recoil band. Checked after the advance so the
    // shot's own tick shows the band's first cell, not its second.
    const shot = this.gun?.shotCount ?? 0;
    if (shot !== this.armShot) {
      this.armShot = shot;
      if (!reloading) {
        this.armFiring = true;
        this.armCell = band.fire[0];
      }
    }

    const tex = ArmAnim.getCell(id, this.armCell);
    arm.visible = !!tex;
    if (tex) arm.texture = tex;

    // `arm1/arm2.gotoAndStop(...)` (Guns.as:239-248) — one playhead, both arms.
    const back = this.arm2Sprite;
    if (back) {
      const tex2 = ArmAnim2.getCell(id, this.armCell);
      back.visible = !!tex2;
      if (tex2) back.texture = tex2;
    }
  }

  /** The current render state's rig entry (anchor + per-frame arm attach points).
   *  Uses renderState so species idles (idleRobot/idleZombie) get their own arm. */
  private rig(): RigState {
    return RIG.states[this.renderState] ?? RIG.states[this.animState] ?? RIG.states.idle;
  }

  /**
   * Absolute weapon-shoulder position for the current animation frame (native
   * px, before scale, measured from the unit's feet origin). Read straight off
   * the SWF arm layer's per-frame attach point plus the clip-origin height, so
   * the arm stays welded to the shoulder through every pose — run bob, jump,
   * duck and the moonwalk (runback has its own track).
   */
  private shoulder(): { x: number; y: number } {
    // Animated skin: the shoulder track is baked in clip px (feet origin), so it
    // is used directly (no ROOT_Y offset — the skin origin IS the feet).
    if (this.useSkinAnim) {
      return SkinAnim.shoulder(this.skinAnimState(this.animState), this.animFrame);
    }
    const r = this.rig();
    const a = r.arm[Math.min(this.animFrame, r.arm.length) - 1] ?? r.arm[0];
    return { x: a[0], y: ROOT_Y + a[1] };
  }

  /** Map a state onto one the animated-skin bake actually has. Every one of the
   *  12 modelled states is baked, so this only guards a missing sheet. */
  private skinAnimState(state: string): string {
    if (SkinAnim.hasState(state)) return state;
    if (state === "tuck") return "jump";
    if (state === "duck" || state === "getup") return "crouch";
    if (state === "landrun") return "run";
    if (state === "landrunback") return "runback";
    if (state === "land") return "idle";
    return "idle";
  }

  /**
   * The movement-driven animation REQUEST (the original's `unit.nextAnim`,
   * `Movement.as` → doc 02 §3.2). It is only a request: `UnitAnimator.goto()`
   * applies the guard table, so a play-once pose such as `land` or `getup` is
   * not cut short by whatever this returns on the following tick.
   */
  private computeAnimState(): AnimState {
    const moving = Math.abs(this.moving.vel) > 0.5;
    const forward = moving && Math.sign(this.moving.vel) === this.facing;

    // Crouching requests `duck`; the guard table runs it on into `duckloop`
    // (our `crouch`) and rewrites the exit into `getup`.
    if (this.crouching) return "duck";

    if (this.jumping) {
      if (this.tucking) return "tuck";
      return this.jumping.vel < -4 ? "jump" : "fall";
    }

    // The touchdown tick cues the landing pose — with a move key held it is the
    // running landing, which the guard table then runs on into the run loop.
    if (this.justLanded) {
      if (!moving) return "land";
      return forward ? "landrun" : "landrunback";
    }

    if (moving) return forward ? "run" : "runback";
    return "idle";
  }

  /**
   * Drive the layered part rig for one frame: position the parts container at the
   * clip origin, then weld each visible part (costume-indexed texture + the SWF
   * per-frame affine matrix). Depths map to z-order; unused depths are hidden.
   */
  private updateParts(render: string, s: number): void {
    const pc = this.partsContainer;
    if (!pc) return;
    pc.position.set(0, ROOT_Y * s);
    pc.scale.set(s * this.facing, s);
    const placements = PartArt.frame(render, this.animFrame - 1);
    const used = new Set<number>();
    for (const p of placements) {
      used.add(p.d);
      let sp = this.partSprites.get(p.d);
      if (!sp) {
        sp = new Sprite();
        this.partSprites.set(p.d, sp);
        pc.addChild(sp);
      }
      sp.zIndex = p.d;
      const piv = PartArt.pivot(p.cid);
      sp.anchor.set(piv.px, piv.py);
      const costume = PartArt.isBodyCostume(p.cid) ? this.costume.body : this.costume.legs;
      const tex = PartArt.getTexture(p.cid, costume);
      if (tex) sp.texture = tex;
      sp.visible = !!tex;
      // SWF affine m = [scaleX, rotateSkew0, rotateSkew1, scaleY, txPx, tyPx] maps
      // to a Pixi Matrix(a=sx, b=r1, c=r0, d=sy, tx, ty).
      const m = p.m;
      sp.setFromMatrix(new Matrix(m[0], m[2], m[1], m[3], m[4], m[5]));
    }
    for (const [d, sp] of this.partSprites) if (!used.has(d)) sp.visible = false;
  }

  /** Advance the baked body animation and aim the weapon arm. */
  private updateSprites(): void {
    if (!this.bodySprite && !this.partsContainer) return;
    const s = this.scale;

    // Feed the movement request through the authentic goto() guard table, then
    // advance the playhead. The SWF timelines are authored at 30fps and the
    // logic step is 30fps, so this is one frame per tick — it used to advance
    // every other tick, playing every animation at half speed.
    this.anim.goto(this.computeAnimState());
    const state = this.anim.state;

    // The part rig has dedicated robot/zombie idle poses; pick them when idle.
    let render: string = state;
    if (this.useParts) {
      render = legacyAnimState(state);
      if (state === "idle") {
        if (this.pers === "robot" && PartArt.hasState("idleRobot")) render = "idleRobot";
        else if (this.pers === "zombie" && PartArt.hasState("idleZombie")) render = "idleZombie";
      }
    } else if (this.useSkinAnim) {
      render = this.skinAnimState(state);
    } else {
      render = legacyAnimState(state);
    }
    this.renderState = render;
    this.animState = state;

    const count = this.useParts
      ? PartArt.frameCount(render)
      : this.useSkinAnim
        ? SkinAnim.frameCount(render)
        : AnimNoArm.frameCount(legacyAnimState(state));
    this.anim.advance(count);
    // A state the active art set folds down (e.g. `land` -> `idle`) can have a
    // different length than the state machine's, so clamp into the rendered one.
    this.animFrame = count > 0 ? Math.min(this.anim.frame, count) : 1;

    if (this.useParts) {
      this.updateParts(render, s);
    } else if (this.useSkinAnim && this.bodySprite) {
      // Animated Raze 2 skin: swap in the baked per-state frame. The cell already
      // contains the whole figure (head + legs baked) with the feet at the anchor,
      // so the body sprite sits with its anchor on the unit origin (y = 0) and
      // scales by the skin's own render scale, flipped by facing.
      const tex = SkinAnim.getFrame(this.skinId, render, this.animFrame);
      if (tex) this.bodySprite.texture = tex;
      const a = SkinAnim.anchor();
      const bs = this.bodyScale();
      this.bodySprite.anchor.set(a.x, a.y);
      this.bodySprite.y = 0;
      this.bodySprite.scale.set(bs * this.facing, bs);
    } else if (this.bodySprite) {
      let tex = this.bodyFrame(state, this.animFrame);
      // Until the tuck art is extracted, fall back to the jump pose so the
      // double-jump still renders a body rather than freezing on a stale frame.
      if (!tex && state === "tuck") {
        const jf = Math.min(this.animFrame, AnimNoArm.frameCount("jump"));
        tex = this.bodyFrame("jump", jf);
      }
      if (tex) this.bodySprite.texture = tex;
      // Anchor the body at the animation clip's origin (per state) and hang it so
      // that origin sits ROOT_Y above the feet. `ROOT_Y` and the art are both in
      // the rig's own clip px, so they ride `bodyScale()` — NOT `this.scale`,
      // which is the physics footprint and drew this body at 64% of its height.
      const rig = this.rig();
      const bs = this.bodyScale();
      this.bodySprite.anchor.set(rig.anchorX, rig.anchorY);
      this.bodySprite.y = ROOT_Y * bs;
      this.bodySprite.scale.set(bs * this.facing, bs);
    }

    // Weld the weapon arm onto the shoulder and aim it.
    this.syncArm();
    const arm = this.armSprite;
    if (arm && arm.visible) {
      // `arm1.x = arm2.x = arm1hold.x` (UnitMC.as:103-109) — the arm sits exactly
      // on the shoulder marker, with no per-weapon displacement. The arm art has
      // its own shoulder anchor and renders at its own native scale (`as`), while
      // the shoulder track is measured in the (skin or rig) body's clip px and so
      // rides that body's scale (`bs`).
      const bs = this.bodyScale();
      const as = ARM_SCALE;
      const sh = this.shoulder();
      arm.x = sh.x * bs * this.facing;
      arm.y = sh.y * bs;
      // Just the reload dip. `Unit.as` applies it unconditionally — `MC.arm1
      // .rotation = rotReload + rotArm` (`:1123`) — *on top of* the reload band,
      // so the whole arm drops while the baked frames work the weapon. There is
      // no third term: the visible recoil is the `_fire` band, not a rotation,
      // which is why the arm points exactly where the bullet goes at any rate of
      // fire.
      const extra = this.rotReload * DEG * this.facing;
      const rad = this.aimRotation * DEG + extra;
      arm.scale.set(as * this.facing, as);
      // During a double-jump flip, hold the arm fixed relative to the body so it
      // tumbles cleanly with charC instead of re-aiming through the spin.
      // Otherwise subtract the body lean (charC is rotated by `tilt`) so the arm
      // still points exactly at the world aim angle whatever the ground slope.
      if (!this.flipActive) {
        const world = this.facing > 0 ? rad : rad + Math.PI;
        arm.rotation = world - this.tilt;
      }
      // One shoulder, one angle, two arms: `arm1.x = arm2.x = arm1hold.x`
      // (UnitMC.as:103-109) and `MC.arm2.rotation = rotReload + rotArm`
      // (Unit.as:1129). The back arm's own bake is registered on that same
      // shoulder origin, so it takes arm1's transform unchanged.
      const back = this.arm2Sprite;
      if (back && back.visible) {
        back.position.copyFrom(arm.position);
        back.scale.copyFrom(arm.scale);
        back.rotation = arm.rotation;
      }
    }

    this.updateHead();
    this.applyStatusTint();
    this.updateNameBox();
  }

  /**
   * Local aim elevation in degrees relative to the way the unit faces:
   * 0 = level, positive = aiming downward on screen, negative = upward.
   */
  private aimElevationDeg(): number {
    const forward = this.facing > 0 ? 0 : 180;
    let d = this.aimRotation - forward;
    d = ((d + 180) % 360 + 360) % 360 - 180;
    return this.facing > 0 ? d : -d;
  }

  /** Ease `rotReload` toward its target (see the field's doc comment). */
  private updateReloadDip(): void {
    // `rotArm < 30` in the source: don't add the dip when the weapon is already
    // pointed down past the dip angle, so it never drives the arm into the legs.
    const engaged = !!this.gun?.reloading && this.aimElevationDeg() < RELOAD_DIP_DEG;
    const target = engaged ? RELOAD_DIP_DEG : 0;
    this.rotReload += (target - this.rotReload) * RELOAD_DIP_EASE;
    if (Math.abs(this.rotReload) < 0.05) this.rotReload = 0;
  }

  /**
   * Weld the separate head at the neck for the current frame and turn it toward
   * the aim. Ported from the original `aimArms()`: the head follows the aim at
   * roughly half-rate, clamped so it never spins past a look-over-the-shoulder.
   * The head is a child of charC, so it also leans with the ground tilt and
   * tumbles with the double-jump flip for free.
   */
  private updateHead(): void {
    const head = this.headSprite;
    if (!head) return;
    // The neck track and the head art share the body's clip px, so the head has
    // to ride the same scale the body is drawn at or the weld drifts.
    const s = this.bodyScale();

    // Swap costume head texture on change.
    if (this.headCostume !== this.costume.head) {
      const tex = HeadArt.getTexture(this.costume.head);
      if (tex) head.texture = tex;
      this.headCostume = this.costume.head;
    }

    // Weld at the per-frame neck attach point (same basis as the arm shoulder).
    // Uses renderState so species idles get their own neck track.
    const neck = HeadArt.neck(this.renderState, this.animFrame);
    head.x = neck[0] * s * this.facing;
    head.y = (ROOT_Y + neck[1]) * s;
    head.scale.set(s * this.facing, s);

    if (this.flipActive) {
      head.rotation = 0; // tumble with the body during the flip
      return;
    }

    // Turn toward the aim at half-rate. Work in absolute world degrees (like the
    // arm) then apply the same facing mapping, so it reads correctly both ways.
    const forward = this.facing > 0 ? 0 : 180;
    let delta = this.aimRotation - forward;
    delta = ((delta + 180) % 360 + 360) % 360 - 180; // normalise to [-180,180]
    delta = Math.max(-90, Math.min(90, delta)); // never look backwards
    const HEAD_FOLLOW = 0.5;
    const HEAD_CLAMP = 32;
    const headDeg = forward + Math.max(-HEAD_CLAMP, Math.min(HEAD_CLAMP, delta * HEAD_FOLLOW));
    const world = (this.facing > 0 ? headDeg : headDeg + 180) * DEG;
    // The head dips with the weapon during a reload (`head.rotation =
    // rotReload + rotArm * 0.6`), so the character looks down at the magazine.
    head.rotation = world - this.tilt + this.rotReload * DEG * this.facing;
  }

  /**
   * Power-up state read straight off the character: a red wash while double
   * damage is running and a gold shimmer while invincible, both blinking in the
   * final ~2 s so the wearer can feel the buff about to lapse. Fade (cloak) is
   * handled as whole-unit alpha in Status.enterFrame, so it is left alone here.
   * Priority is invin over ddamage when both happen to be active.
   */
  private applyStatusTint(): void {
    if (!this.bodySprite) return;
    this.fxTick++;
    const st = this.status;
    let tint = 0xffffff;
    if (st?.invinTimer > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.fxTick * 0.4);
      // Blend white -> gold; near expiry, blink between gold and plain.
      const expiring = st.invinTimer < 60 && this.fxTick % 8 < 4;
      tint = expiring ? 0xffffff : pulse > 0.5 ? 0xffe66a : 0xfff6c8;
    } else if (st?.ddamageTimer > 0) {
      const expiring = st.ddamageTimer < 60 && this.fxTick % 8 < 4;
      tint = expiring ? 0xffffff : 0xff8a72;
    }
    this.bodySprite.tint = tint;
    if (this.armSprite) this.armSprite.tint = tint;
    if (this.arm2Sprite) this.arm2Sprite.tint = tint;
  }

  // --- name tag + speech -------------------------------------------------

  private buildNameBox(): void {
    this.nameText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffff,
        fontFamily: "Arial, sans-serif",
        fontSize: 7,
        fontWeight: "bold",
        stroke: { color: 0x000000, width: 1.5, alpha: 0.55 },
      }),
    });
    this.nameText.anchor.set(0.5);
    // Name rides on the health fill (centre of the plate's name row).
    this.nameText.y = NAMEPLATE_TOP + NAMEPLATE_H / 2;
    // The plate is tiny in world units and the camera zooms in, so a 1x text
    // raster upscales and reads blurry. Render the glyphs at higher resolution
    // (text is drawn, not an asset) so it stays crisp at the zoomed-in scale.
    this.nameText.resolution = 4;
    this.speechText = new Text({
      text: "",
      style: new TextStyle({
        fill: 0xffffcc,
        fontFamily: "Arial, sans-serif",
        fontSize: 11,
        fontStyle: "italic",
      }),
    });
    this.speechText.anchor.set(0.5);
    this.speechText.visible = false;

    // Five-point crown, drawn once and toggled with the Jug buff.
    this.jugCrown
      .moveTo(-9, 2).lineTo(-9, -5).lineTo(-4.5, -1).lineTo(0, -7)
      .lineTo(4.5, -1).lineTo(9, -5).lineTo(9, 2).lineTo(-9, 2)
      .fill({ color: 0xffcc33 })
      .stroke({ color: 0x6b4a00, width: 1, alpha: 0.7 });
    this.jugCrown.y = -13;
    this.jugCrown.visible = false;

    this.nameBox.addChild(
      this.nameBar,
      this.energyBar,
      this.healthBar,
      this.jugCrown,
      this.nameText,
      this.speechText,
    );
    this.nameBox.y = SHOULDER_Y * this.bodyScale() - 34; // above the drawn head
    this.view.addChild(this.nameBox);
  }

  /**
   * Show/hide this unit's floating name tag. Used by screenshot mode
   * (SD.ssMode) to strip player names off the arena for a clean capture.
   */
  setChromeVisible(visible: boolean): void {
    this.nameBox.visible = visible;
  }

  /** Refresh the name bar (name/colour) and animate the speech line. */
  private updateNameBox(): void {
    if (!this.nameText) return;

    this.jugCrown.visible = this.isJug;

    // Name-tag colour is a fixed marker, not tinted by the Jug buff either —
    // the source never tints the nameplate frame at all (doc 07 §2.2/§5), so
    // this only needs to redraw when the name text itself changes.
    if (this._name !== this.lastName) {
      this.lastName = this._name;
      this.nameText.text = this._name;
      // Fixed plate width (static regardless of name length). The health fill
      // and energy strip are drawn to this same width so the name rides on the
      // coloured bar (reference nameplates 20/21).
      const w = NAMEPLATE_W;
      this.nameW = w;
      const PH = NAMEPLATE_H + NAMEPLATE_EN_H; // full plate height
      const x = -w / 2;
      const [front] = this.barColors();
      this.nameBar.clear();
      // Dark plate base behind the fills, a crisp black border, and a faint
      // team-tinted outer glow so friend/foe reads at a glance.
      this.nameBar
        .rect(x, NAMEPLATE_TOP, w, PH)
        .fill({ color: 0x0a0a0a, alpha: 0.85 })
        .rect(x - 0.5, NAMEPLATE_TOP - 0.5, w + 1, PH + 1)
        .stroke({ color: front, width: 1, alpha: 0.35 })
        .rect(x, NAMEPLATE_TOP, w, PH)
        .stroke({ color: 0x000000, width: 1.5, alpha: 0.9 });
      // White name text with a black outline for legibility over any team fill.
      this.nameText.style.fill = 0xffffff;
      this.lastHpDraw = -1; // force health-bar redraw at the new width
      this.lastEnDraw = -1; // force energy-bar redraw at the new width
    }

    this.drawEnergyBar();
    this.drawHealthBar();

    // Speech line fades out over its last ~half second.
    if (this.speechTimer > 0 && this.speechText) {
      this.speechTimer--;
      this.speechText.visible = true;
      this.speechText.alpha = Math.min(1, this.speechTimer / 30);
      if (this.speechTimer === 0) this.speechText.visible = false;
    }
  }

  /**
   * Draw one nameplate bar row as three stacked alpha bands (doc 07 §2.3's
   * "bevel by opacity" trick): a dimmer top/bottom edge sandwiching a
   * brighter body, all one hue — reads as a subtle bevel without a gradient.
   */
  private drawBandedBar(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    edgeAlpha: number,
    bodyAlpha: number,
  ): void {
    if (w <= 0) return;
    const edgeH = Math.max(0.6, h * (1.4 / 7.6));
    const bodyH = Math.max(0.1, h - edgeH * 2);
    g.rect(x, y, w, edgeH).fill({ color, alpha: edgeAlpha });
    g.rect(x, y + edgeH, w, bodyH).fill({ color, alpha: bodyAlpha });
    g.rect(x, y + edgeH + bodyH, w, edgeH).fill({ color, alpha: edgeAlpha });
  }

  /**
   * Authentic per-unit nameplate health bar (doc 07 §2.2-2.4). A continuous
   * (NOT segmented) fill whose width tracks the HP fraction, drawn in three
   * layers, each itself a 3-band alpha bevel (§2.3: edge 0.298/0.647, body
   * 0.4/0.847 for back/front):
   *   - `backbar_hp`: full-width dark/desaturated team-tint track.
   *   - `bar_hurt`: a red (`#FF0000`) "recently lost HP" sliver that eases toward
   *     the main fill width at 5%/frame, showing behind the front bar.
   *   - `bar_hp`: the bright team-tint front fill (team1 blue / team2 orange /
   *     team3 yellow / FFA green).
   */
  private drawHealthBar(): void {
    if (this.status.dead) {
      this.healthBar.visible = false;
      return;
    }
    this.healthBar.visible = true;

    const per = Math.max(0, Math.min(1, this.status.getHpPer()));
    // Inset 1px inside the plate border (drawn by nameBar) so it stays crisp.
    const W = this.nameW - 2;
    const H = NAMEPLATE_H - 1;
    const x = -this.nameW / 2 + 1;
    const y = NAMEPLATE_HP_Y + 1;
    const frontW = W * per;

    // Ease the red damage sliver toward the current fill at 5%/frame
    // (Status.as:390: bar_hurt.width += (bar_hp.width - bar_hurt.width) * 0.05).
    // It only ever trails BEHIND the front bar — a heal snaps it up instantly so
    // no red shows on gaining HP.
    if (this.hurtW < 0) this.hurtW = frontW;
    if (frontW >= this.hurtW) this.hurtW = frontW;
    else this.hurtW += (frontW - this.hurtW) * 0.05;

    // Only rebuild geometry when something visibly changed (front or sliver).
    const key = Math.round(frontW * 4) * 1000 + Math.round(this.hurtW * 4) + this.team * 7;
    if (key === this.lastHpDraw) return;
    this.lastHpDraw = key;

    const [front, back] = this.barColors();
    this.healthBar.clear();
    // Dark team-tint empty track (full width).
    this.healthBar.rect(x, y, W, H).fill({ color: back, alpha: 0.5 });
    // Red "recently lost HP" sliver, trailing behind the fill.
    if (this.hurtW > frontW + 0.3) {
      this.healthBar.rect(x, y, this.hurtW, H).fill({ color: 0xcc1a1a, alpha: 0.85 });
    }
    // Bright team fill with a glossy top highlight + darkened base — reads as a
    // top-lit gradient like the reference bars, without a real gradient shader.
    if (frontW > 0) {
      this.healthBar.rect(x, y, frontW, H).fill({ color: front, alpha: 1 });
      this.healthBar.rect(x, y, frontW, H * 0.45).fill({ color: 0xffffff, alpha: 0.28 });
      this.healthBar.rect(x, y + H * 0.72, frontW, H * 0.28).fill({ color: 0x000000, alpha: 0.18 });
    }
  }

  /**
   * Per-unit ability-energy row (`bar_en`, doc 07 §2.2/§2.4): a bare magenta
   * fill above the health bar on every unit (not just the local player's
   * corner-HUD energy bar), same 75px-scaled width, dimming to 0.6 alpha when
   * the unit can't currently afford its ability (`Status.as:392`'s
   * affordability tell). Source has no back-track shape for this bar — it is
   * a bare fill with no visible track when empty. Hidden for units with no
   * ability equipped (mirrors the corner HUD's own `hasAbility` gate).
   */
  private drawEnergyBar(): void {
    if (this.status.dead) {
      this.energyBar.visible = false;
      return;
    }
    this.energyBar.visible = true;

    const hasAbility = !!this.ability && this.ability.id !== "none";
    const per = hasAbility ? Math.max(0, Math.min(1, this.status.getEnPer())) : 0;
    // Inset 1px inside the plate border, flush under the health fill.
    const W = this.nameW - 2;
    const H = NAMEPLATE_EN_H - 1;
    const x = -this.nameW / 2 + 1;
    const y = NAMEPLATE_EN_Y;
    const w = W * per;
    const affordable = hasAbility && this.status.hasEnergy(this.ability!.usedEnergy);
    // Contrast strip colour by team (magenta on the blue team, deep red on the
    // orange team) — matching the reference bars' lower band.
    const color = this.team === 2 ? 0x990000 : this.team === 1 ? 0xff33cc : 0xff66ff;

    const key = Math.round(w * 4) * 10 + (affordable ? 1 : 0);
    if (key === this.lastEnDraw) return;
    this.lastEnDraw = key;

    this.energyBar.clear();
    // Dark track so the plate always carries a bottom band.
    this.energyBar.rect(x, y, W, H).fill({ color: 0x1a0010, alpha: 0.7 });
    if (w > 0) {
      this.energyBar.rect(x, y, w, H).fill({ color, alpha: affordable ? 1 : 0.6 });
    }
  }

  /** Show a short speech line above the name for ~2 seconds. */
  say(text: string): void {
    if (!this.speechText) return;
    this.speechText.text = text;
    this.speechText.visible = true;
    this.speechText.alpha = 1;
    this.speechText.y = -18; // above the name bar
    this.speechTimer = 120; // ~2s at 60fps
  }

  // --- spawning / respawn -----------------------------------------------

  respawn(): void {
    if (this.ragActor) this.ragActor.respawned = true;
    this.ragActor = null;
    this.ragDoll = null;
    this.canRespawn = false;
    this.respawnCount = 0;
    this.status = new Status(this);
    this.gun.reset();
    this.jumping = null;
    this.crouching = false;
    this.flipActive = false;
    this.flipAngle = 0;
    this.tucking = false;
    this.tilt = 0;
    this.abilityLock = 0;
    this.charC.rotation = 0;
    // Authentic Raze 2 kinematic constants (doc 01 §1, Movement.as:36-98). The
    // port's previous "30% slower" tuning has been removed in favour of the
    // original feel.
    this.moving = {
      vel: 0,
      acc: 2.1, // xAcc
      brake: 1.7, // xBrake
      crouchBrake: 0.5, // xCrouchBrake
      airAcc: 1.5, // xAirAcc
      airBrake: 0.4, // xAirBrake
      max: 11, // xMax
    };
    this.keys = 0;
    this.view.visible = true;
    this.drawFigure();
    this.setSpawn();
    this.status.startStatus("spawn");

    // Occasional spawn chatter (only mid-match, not the initial placement).
    if (this.game.gameStarted && Math.random() < 0.3) {
      this.say(pick(SPAWN_LINES));
    }
  }

  private setSpawn(): void {
    // Scripted reinforcements wait off-map, hidden and inert, until the mission
    // script calls them in (Unit.as:222-227). Only the first placement — once
    // they have entered, a death respawns them at a node like anyone else.
    if (this.extra.noSpawn) {
      this.x = -4000;
      this.y = -4000;
      this.view.visible = false;
      return;
    }

    // A mission can place a unit at fixed coordinates for its opening beat. The
    // override is consumed on use (Unit.as:228-231), so dying later returns the
    // unit to the normal spawn set.
    const fixed = this.extra.spawn;
    if (fixed && typeof fixed.x === "number" && typeof fixed.y === "number") {
      this.extra.spawn = null;
      this.x = fixed.x;
      this.y = fixed.y;
      if (this.ai) this.setSpawnNode(fixed.node ?? "");
      this.game.addEffect(this.x, this.y, "spawn");
      return;
    }

    const nodes = this.game.arena.spawnNodes;
    let node: any;
    if (!this.game.gameStarted && this.human && SD.matchSettings.level === "tut") {
      node = { x: this.game.arena.humanWP.x, y: this.game.arena.humanWP.y };
    } else if (!this.game.gameStarted) {
      // Pick a random un-taken spawn.
      do {
        node = nodes[Math.floor(Math.random() * nodes.length)];
      } while (node.taken && nodes.some((n: any) => !n.taken));
      node.taken = true;
    } else {
      node = this.findFurthestSpawnNode() ?? nodes[0];
    }
    this.x = node.x;
    this.y = node.y;
    if (this.ai) this.setSpawnNode(node.name);
    this.game.addEffect(this.x, this.y, "spawn");
    Sound.playSynthAt("whoosh", this.x, this.y, 0.55, SPAWN_RANGE);
  }

  /**
   * Mission-script entry for a unit parked by `noSpawn`: drop the flag and put
   * it into play at the scripted point. The point is taken as given — the
   * invasion cues drop their aliens in above the arena floor on purpose — so
   * from here it just falls and plays on, respawning at a normal node if killed.
   */
  spawnScripted(x: number, y: number): void {
    this.extra.noSpawn = false;
    if (this.status.dead) {
      this.respawn();
    } else {
      this.view.visible = true;
    }
    this.x = x;
    this.y = y;
    this.jumping = null;
    this.moving.vel = 0;
    this.game.addEffect(this.x, this.y, "spawn");
    Sound.playSynthAt("whoosh", this.x, this.y, 0.55, SPAWN_RANGE);
  }

  /** Spawn point maximising distance to the nearest live enemy. */
  findFurthestSpawnNode(): any {
    let best: any = null;
    let bestDist = -9999;
    for (const node of this.game.arena.spawnNodes) {
      // Distance from THIS node to its nearest enemy — the metric the doc
      // comment promises. Comparing raw per-enemy distances across nodes (as
      // this used to) would let a node that merely happens to be far from
      // one enemy win even while it sits right on top of another one.
      let nearest = Infinity;
      for (const u of this.game.units) {
        if (u === this || u.status.dead) continue;
        if (this.team && u.team === this.team) continue;
        const d = UT.getDist(node.x, node.y, u.x, u.y);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestDist) {
        bestDist = nearest;
        best = node;
      }
    }
    return best;
  }

  /** Overridden by AI to bind a waypoint node. */
  setSpawnNode(_name: string): void {}

  respawnTimer(): void {
    // Elimination modes: once the lives are gone the unit stays down.
    if (!this.game.match.canRespawn(this as any)) {
      this.canRespawn = false;
      return;
    }
    this.respawnCount++;
    if (this.respawnCount >= 30) {
      this.canRespawn = true;
      if (this.ai) this.respawn();
    }
  }

  // --- input actions -----------------------------------------------------

  doJump(pressed: boolean): void {
    if (!this.game.gameStarted) return;

    // Jump pads (doc 12 §2.3): a pressed jump while standing on a pad pixel fires
    // the tiered mega-launch (+ horizontal kick for diagonal pads) instead of a
    // normal jump — this is the authentic active-press trigger. `f00007` hazard
    // tiles are a terrain-borne mega-jump (mega flag) and behave the same way.
    if (pressed && !this.crouching) {
      const pad = this.game.arena.jumpPadAt?.(this.x, this.y);
      if (pad) {
        this.launchPad(pad.power, pad.dirX);
        return;
      }
      const sm = this.surfaceMods;
      if (sm?.mega) {
        this.launchPad(sm.modJump, 0);
        return;
      }
    }

    // Normal jump impulse is scaled by the terrain `modJump` (low-grav/water make
    // a weaker hop; doc 01 §7).
    const modJump = this.surfaceMods?.modJump ?? 1;
    if (!this.jumping && !this.crouching) {
      // First jump: -13 impulse (yJump), plus a one-time 6px instant upward hop
      // (yJumpBoost) that masks the launch-frame ground clip (doc 01 §3,
      // Movement.as:161-166).
      if (pressed) this.y -= 6;
      this.jumping = { vel: pressed ? -13 * modJump : 0, grav: 0.8, fallMax: 20, dJump: false };
    } else if (!this.crouching && pressed && this.jumping && !this.jumping.dJump) {
      this.jumping.dJump = true;
      // Double jump: halve current vertical velocity first, THEN subtract yDjump
      // (10), so its height stays consistent wherever in the arc it fires
      // (doc 01 §3, Movement.as:169-176).
      this.jumping.vel = this.jumping.vel / 2 - 10;
      // The double jump always switches to the tucked-flip body pose.
      this.jumping.tuck = true;
      this.tucking = true;
      // ...but the full 360° spin only fires on a strong upward double jump WITH
      // horizontal input, matching the SWF (doSpin: jumping.vel < -10 && L/R held).
      if (this.jumping.vel < -10 && this.keys & (K.LEFT | K.RIGHT)) {
        this.startFlip(this.keys & K.RIGHT ? 1 : -1);
      }
    }
  }

  /**
   * Authentic jump-pad launch (doc 12 §2.3, `Movement.doJump` mega-jump branch).
   * Diagonal pads hard-snap horizontal velocity to `dirX`; then the vertical
   * impulse is `-yJump × power` (yJump = 13). Consumes the double jump (dJump),
   * tucks the body, plays the pad sound and puffs smoke. Shared by the human
   * press-trigger and the bot contact-launch fallback.
   */
  private launchPad(power: number, dirX: number): void {
    if (dirX) this.moving.vel = dirX;
    this.jumping = { vel: -13 * power, grav: 0.8, fallMax: 20, dJump: true, tuck: true };
    this.tucking = true;
    Sound.playAt("R2_Jumppad", this.x, this.y, 1, SPAWN_RANGE);
    this.game.addEffect(this.x, this.y - 20, "spawn");
  }

  /** Begin the signature double-jump front-flip, spun toward the held direction. */
  private startFlip(dir: number): void {
    this.flipActive = true;
    this.flipAngle = 0;
    this.flipDir = dir;
  }

  /** Advance the flip spin; applied to charC each frame while airborne. */
  private applyFlip(): void {
    // Touchdown edge: airborne last tick, grounded now. `computeAnimState` reads
    // this to cue land / landrun / landrunback for exactly one tick, which the
    // goto() guard table then protects until the pose has played out.
    const airborne = !!this.jumping;
    this.justLanded = this.wasAirborne && !airborne;
    this.wasAirborne = airborne;

    // Landing ends the tuck pose (the jump was cleared by ground collision).
    if (!this.jumping) this.tucking = false;
    if (this.flipActive) {
      // A grounded landing (jump cleared) ends the flip immediately.
      if (!this.jumping) {
        this.flipActive = false;
        this.flipAngle = 0;
      } else {
        this.flipAngle += FLIP_STEP;
        if (this.flipAngle >= Math.PI * 2) {
          this.flipActive = false;
          this.flipAngle = 0;
        }
      }
    }
    // Flip spin overrides the lean; otherwise the body rests at the ground tilt.
    this.charC.rotation = this.flipActive ? this.flipAngle * this.flipDir : this.tilt;
  }

  /**
   * Update the ground-slope lean (see `tilt`). Samples the surface under each
   * foot and eases toward the angle between them; levels out while airborne.
   * Steep steps (our staircase collision) are ignored so the body doesn't snap.
   */
  private updateTilt(): void {
    let target = 0;
    if (!this.jumping) {
      const s = this.scale;
      // Sample a wide baseline so the lean reads the overall slope of the
      // stair-meshed terrain, not the single box a foot happens to stand on.
      const span = 26 * s;
      const ly = this.groundYAt(this.x - span);
      const ry = this.groundYAt(this.x + span);
      if (ly !== null && ry !== null) {
        const a = Math.atan2(ry - ly, span * 2);
        if (Math.abs(a) < 0.6) target = a; // ignore true cliffs (~34°+)
      }
    }
    this.tilt += (target - this.tilt) * 0.15;
    if (Math.abs(this.tilt) < 0.002) this.tilt = 0;
  }

  /** Highest solid surface directly under world-x `wx`, near the feet, or null. */
  private groundYAt(wx: number): number | null {
    const feet = this.y;
    const band = 34 * this.scale; // reach across a step riser up or down
    const mask = this.game.arena.wallMask;
    if (mask) {
      const s = mask.surfaceUnder(wx, feet, band);
      if (s !== null) return s;
      return Math.abs(this.game.arena.floorY - feet) <= band ? this.game.arena.floorY : null;
    }
    let best: number | null = null;
    for (const w of this.game.arena.walls) {
      if (w.rotation) continue;
      const wl = w.x - w.width / 2;
      const wr = w.x + w.width / 2;
      const wt = w.y - w.height / 2;
      if (wx >= wl && wx <= wr && wt >= feet - band && wt <= feet + band) {
        if (best === null || wt < best) best = wt;
      }
    }
    if (best === null && Math.abs(this.game.arena.floorY - feet) <= band) {
      best = this.game.arena.floorY;
    }
    return best;
  }

  doCrouch(): void {
    if (!this.jumping) this.crouching = true;
  }

  // --- movement + collision ---------------------------------------------

  protected moveUnit(): void {
    // Face the aim point.
    this.facing = this.aimX > this.x ? 1 : -1;
    this.animMC.scaleX = this.facing;

    if (!(this.keys & K.DOWN)) this.crouching = false;
    else this.doCrouch();

    const m = this.moving;
    const airborne = !!this.jumping;

    // Terrain surface under the feet this tick (doc 01 §7 / doc 12 §2.3). Sampled
    // 1px below the feet from the wall bitmap's special-colour layer; the mods it
    // carries are applied to this tick's accel/brake/top-speed/gravity/jump and
    // reset next frame by re-sampling (non-sticky). null = plain ground.
    const sm = this.game.arena.wallMask?.surfaceTypeAt(this.x, this.y + 1) ?? null;
    this.surfaceMods = sm;
    const modSpeed = sm?.modSpeed ?? 1;
    const modMax = sm?.modMax ?? 1;
    const modBrake = sm?.modBrake ?? 1;

    // Reeling from a heavy hit: input is dropped for a few frames and the
    // brake below takes over, which reads as a stagger. The Static Field
    // ability's lockdown does the same (the unit is frozen while invulnerable).
    if (this.hitStun > 0) this.hitStun--;
    if (this.abilityLock > 0) this.abilityLock--;
    const stunned = this.hitStun > 0 || this.abilityLock > 0;
    if (this.game.gameStarted) {
      // A +3 over-speed slack on the input guards lets a unit already moving
      // faster than max (e.g. jump-pad momentum) still take counter-input accel
      // instead of being locked out (doc 01 §2, Movement.as:201-291).
      // Terrain scales accel (modSpeed), top speed (modMax) and brake (modBrake).
      const maxV = m.max * modMax;
      if (this.keys & K.LEFT && !this.crouching && !stunned && m.vel > -(maxV + 3)) {
        m.vel -= (airborne ? m.airAcc : m.acc) * modSpeed;
        if (m.vel < -maxV) m.vel = -maxV;
      } else if (this.keys & K.RIGHT && !this.crouching && !stunned && m.vel < maxV + 3) {
        m.vel += (airborne ? m.airAcc : m.acc) * modSpeed;
        if (m.vel > maxV) m.vel = maxV;
      } else {
        // Idle brake: air brake airborne, crouch brake while crouched, else the
        // standing brake — with a ×2.5 multiplier to bleed off any over-speed
        // above max quickly once input is released (doc 01 §2). Terrain scales it.
        let brake = (airborne ? m.airBrake : this.crouching ? m.crouchBrake : m.brake) * modBrake;
        if (!airborne && Math.abs(m.vel) > maxV) brake *= 2.5;
        if (m.vel > 0) m.vel = Math.max(0, m.vel - brake);
        else if (m.vel < 0) m.vel = Math.min(0, m.vel + brake);
      }
    }

    // Horizontal move + resolve. Weapon knockback rides on top of the walk
    // velocity as its own decaying impulse, so a shotgun blast shoves the
    // shooter without stalling or reversing their movement input.
    const preX = this.x;
    this.x += m.vel;
    if (this.knockVel !== 0) {
      this.x += this.knockVel;
      this.knockVel *= KNOCK_DECAY;
      if (Math.abs(this.knockVel) < 0.05) this.knockVel = 0;
    }
    this.resolveAxis("x");

    // Terrain surface consumption (doc 01 §5,§7 / doc 12 §2.3):
    if (sm) {
      // Conveyor belts add a constant horizontal push on top of xVel.
      if (sm.modMove) {
        this.x += sm.modMove;
        this.resolveAxis("x");
      }
      // Icy/muddy slopes slide the unit down-lean: authentic xVelSlide is the
      // body-lean angle (deg) × modSlide, folded into x each tick. `tilt` is in
      // radians here, so convert. Only while grounded (tilt levels out airborne).
      if (sm.modSlide && !this.jumping) {
        this.x += (this.tilt * 180) / Math.PI * sm.modSlide;
        this.resolveAxis("x");
      }
      // Hazard tiles (toxic pools / lava strips / instant-death zones) tick damage.
      if (sm.damage && this.game.gameStarted) {
        this.status.doDamage(sm.damage, { x: this.x, y: this.y });
      }
    }

    // Grounded slope-follow: after the horizontal move, glide the feet along the
    // terrain surface instead of stepping or hopping. Without this, walking UP a
    // pixel ramp buries the feet in it (the side-wall probes start 20px above the
    // feet and miss a gentle rise), and walking DOWN one drops the unit into a
    // brief fall every tick — a visible bob with a landing thud on each step.
    // We snap the feet onto the surface under the new position, but only within a
    // slope's reach: up to STEP_UP_MAX rising, and no further than the horizontal
    // distance moved plus a little slack when descending (≈45°). A bigger drop is
    // a ledge, so the unit walks off it and falls normally. Only while grounded
    // (never mid-jump) so it can't cancel a jump or yank a falling unit down.
    const slopeMask = this.game.arena.wallMask;
    if (slopeMask && !this.jumping && this.x !== preX) {
      const up = STEP_UP_MAX * this.scale;
      const down = Math.abs(this.x - preX) + 4 * this.scale;
      const surf = slopeMask.surfaceUnder(this.x, this.y, Math.max(up, down));
      if (surf !== null) {
        const dy = surf - this.y; // >0: surface below feet (descending); <0: above (ascending)
        if (dy < 0 ? -dy <= up : dy <= down) this.y = surf;
      }
    }

    // Gravity: start falling if we walked off an edge. Terrain scales both the
    // accel and the terminal-velocity cap (low-grav/water float; doc 01 §4b).
    const modGrav = sm?.modGrav ?? 1;
    if (!this.jumping && !this.onGround()) {
      this.jumping = { vel: 0, grav: 0.8, fallMax: 20, dJump: false };
    }
    if (this.jumping) {
      this.jumping.vel += this.jumping.grav * modGrav;
      const cap = this.jumping.fallMax * modGrav;
      if (this.jumping.vel > cap) this.jumping.vel = cap;
      this.y += this.jumping.vel;
      this.resolveAxis("y");
    }

    // Jump pads (authentic, doc 12 §2.3): a human must actively press Jump while
    // standing on a pad — that path lives in `doJump`. Bots have no NodeAiAction
    // cue graph wired for the Raze 2 maps, so they keep a contact-launch fallback
    // here (grounded on a pad → launch) so they can still clear pad gaps.
    if (this.ai && !this.jumping && this.game.gameStarted) {
      const pad = this.game.arena.jumpPadAt?.(this.x, this.y);
      if (pad) this.launchPad(pad.power, pad.dirX);
    }

    this.updateFootsteps(airborne);
    this.updateTilt();
    this.draw();
  }

  /**
   * Footstep + landing audio, driven straight off the movement state so it can
   * never fall out of sync with an animation.
   *
   * `wasAirborne` is the jump state from the *start* of this tick — the
   * transition airborne -> grounded is the landing.
   */
  private updateFootsteps(wasAirborne: boolean): void {
    const grounded = !this.jumping;

    if (grounded && wasAirborne) {
      // Landing thud, weighted by how fast the unit was falling.
      const speed = Math.abs(this.fallVel);
      if (speed >= LAND_MIN_VEL) {
        const impact = Math.min(1, speed / 20);
        Sound.playSynthAt("land", this.x, this.y, 0.3 + impact * 0.5, LAND_RANGE);
      }
      // Restart the stride from the landing foot, not mid-step.
      this.stepDist = 0;
    }
    this.fallVel = this.jumping ? this.jumping.vel : 0;
    // Footstep/stepping sounds are intentionally disabled (they read as noise on
    // a fast arena shooter); the landing thud above is kept as an impact cue.
  }

  /**
   * Character AABB in arena space (feet at y). Public so the M-key hitbox
   * overlay draws the exact box the kinematic controller collides with —
   * a debug view of a *copy* of the maths would be worse than none.
   */
  bounds(): { l: number; r: number; t: number; b: number } {
    // Movement box: stance width for `onGround` and the wall/ceiling sweeps.
    // NOTE the side-wall probes use a narrower dx = ±17 (doc 01 §4d). Shots are
    // NOT tested against this — see `hurtBounds`/`hitScan`, which follow the
    // drawn model; this one stays narrow so the unit fits the level's gaps.
    const hw = 20 * this.scale;
    const top = this.y - (this.crouching ? 104 : 128) * this.scale;
    return { l: this.x - hw, r: this.x + hw, t: top, b: this.y };
  }

  /**
   * Combat hurt box in arena space — the box shots are tested against, and what
   * the M-key overlay draws in amber. Distinct from `bounds()`, which is the
   * movement controller's narrower probe box: widening that one to the model
   * would jam the unit in the level's doorways.
   */
  hurtBounds(): { l: number; r: number; t: number; b: number } {
    const z = this.crouching ? HURT.crouch : HURT.stand;
    return {
      l: this.x - HURT.halfW,
      r: this.x + HURT.halfW,
      t: this.y + z.top,
      b: this.y,
    };
  }

  /**
   * Point-vs-character test for shots, resolving the damage zone
   * (`Bullet.as:544-658`). Returns the head band, the low band (crotch from the
   * front, butt from behind — the caller reads the shot direction) or a plain
   * body hit.
   */
  hitScan(px: number, py: number, pad = 6): { hit: boolean; head: boolean; low: boolean } {
    const dx = px - this.x;
    const dy = py - this.y;
    const miss = { hit: false, head: false, low: false };

    // Broad phase, 50 wide. `pad` is the port's ray half-thickness: the ray
    // marches in discrete steps, so the silhouette is padded to catch a step
    // that lands just off it.
    const bw = HURT.broadHalfW + pad;
    if (dx < -bw || dx > bw || dy < HURT.stand.top - pad || dy > pad) return miss;

    // Mid-flip the unit is one solid 50x70 box with no locational crits — you
    // cannot headshot a tumbling body (`Bullet.as:546`, :658).
    if (this.flipActive && Math.abs(this.flipAngle) > 30 * DEG) {
      return { hit: dy > -70 - pad, head: false, low: false };
    }

    const hw = HURT.halfW + pad;
    if (dx < -hw || dx > hw) return miss;

    // Zone bands use the source's exact bounds, unpadded: a shot crits because
    // it struck the head, not because it passed near it.
    const z = this.crouching ? HURT.crouch : HURT.stand;
    if (dy > z.head[0] && dy < z.head[1]) return { hit: true, head: true, low: false };
    if (dy > z.low[0] && dy < z.low[1]) return { hit: true, head: false, low: true };
    if (dy > z.top - pad && dy < pad) return { hit: true, head: false, low: false };
    return miss;
  }

  private onGround(): boolean {
    const b = this.bounds();
    const mask = this.game.arena.wallMask;
    if (mask) {
      // Solid just beneath the feet anywhere across the stance width = grounded.
      const yb = this.y + 2;
      if (
        mask.solidAt(this.x, yb) ||
        mask.solidAt(b.l + 1, yb) ||
        mask.solidAt(b.r - 1, yb)
      ) {
        return true;
      }
      return this.y >= this.game.arena.floorY - 0.5;
    }
    for (const w of this.game.arena.walls) {
      if (w.rotation) continue;
      const wl = w.x - w.width / 2;
      const wr = w.x + w.width / 2;
      const wt = w.y - w.height / 2;
      if (b.r > wl && b.l < wr && this.y >= wt - 2 && this.y <= wt + 8) {
        return true;
      }
    }
    return this.y >= this.game.arena.floorY - 0.5;
  }

  private resolveAxis(axis: "x" | "y"): void {
    const mask = this.game.arena.wallMask;
    if (mask) {
      this.resolveAxisMask(axis, mask);
      return;
    }
    // Hard arena floor.
    if (axis === "y" && this.y > this.game.arena.floorY) {
      this.y = this.game.arena.floorY;
      this.jumping = null;
    }
    for (const w of this.game.arena.walls) {
      if (w.rotation) continue; // slopes not handled in the kinematic pass
      const b = this.bounds();
      const wl = w.x - w.width / 2;
      const wr = w.x + w.width / 2;
      const wt = w.y - w.height / 2;
      const wb = w.y + w.height / 2;
      if (b.r <= wl || b.l >= wr || b.b <= wt || b.t >= wb) continue;

      if (axis === "x") {
        // Before treating this as a solid wall, see if it is really just a small
        // ledge the unit can auto-step onto (stair-stepped slopes are meshed as
        // many short rects). If so, the feet are lifted onto the ledge top and
        // the horizontal move is allowed to proceed instead of jamming.
        if (this.tryStepUp(w)) continue;

        // Push out horizontally by the smaller overlap.
        const pushLeft = b.r - wl;
        const pushRight = wr - b.l;
        if (pushLeft < pushRight) this.x -= pushLeft;
        else this.x += pushRight;
        this.moving.vel = 0;
        // Braced against a wall, so the recoil shove has nowhere to go.
        this.knockVel = 0;
      } else {
        const pushUp = b.b - wt; // landed on top
        const pushDown = wb - b.t; // bumped head
        if (pushUp < pushDown) {
          this.y -= pushUp;
          this.jumping = null; // grounded
        } else {
          this.y += pushDown;
          if (this.jumping) this.jumping.vel = 0;
        }
      }
    }
  }

  /**
   * Pixel-mask collision resolution (Raze 2 maps). Samples the wall silhouette
   * at the character's edges rather than iterating rects. Small risers up to
   * STEP_UP_MAX are auto-stepped; taller solid faces block and push the unit out.
   */
  private resolveAxisMask(axis: "x" | "y", mask: import("./WallMask").WallMask): void {
    // Hard arena floor below the world.
    if (axis === "y" && this.y > this.game.arena.floorY) {
      this.y = this.game.arena.floorY;
      this.jumping = null;
      return;
    }
    const stepMax = STEP_UP_MAX * this.scale;

    if (axis === "x") {
      const vx = this.moving.vel + this.knockVel;
      if (vx === 0) return;
      const dir = vx > 0 ? 1 : -1;
      // Authentic side-wall collision: 4 discrete point probes per side at
      // dx = ±17 px, heights -20/-25/-35/-45 native px above the feet origin
      // (doc 01 §4d, Movement.as:198-201). Nothing is probed between the origin
      // and -20, so the lower legs/feet never register as blocked by a side wall
      // — that gap is what lets a unit stand flush against low ledges.
      const sx = 17 * this.scale;
      const probeH = [-20, -25, -35, -45];
      const hitSide = (off: number): boolean => {
        for (const h of probeH) {
          if (mask.solidAt(this.x + off, this.y + h * this.scale)) return true;
        }
        return false;
      };
      const lead = dir * sx;
      if (!hitSide(lead)) return;

      // A small ledge right ahead? Climb it and keep moving (stair-meshed slopes).
      if (this.onGround()) {
        const surf = mask.surfaceUnder(this.x + lead, this.y, stepMax);
        if (surf !== null && this.y - surf > 0 && this.y - surf <= stepMax) {
          this.y = surf;
          return;
        }
      }
      // Otherwise step out of the wall one px at a time (doc 01 §4d).
      let guard = 0;
      while (guard++ < 48 && hitSide(dir * sx)) this.x -= dir;
      this.moving.vel = 0;
      this.knockVel = 0;
      return;
    }

    // Vertical axis.
    const rising = !!this.jumping && this.jumping.vel < 0;
    if (rising) {
      const headY = this.bounds().t;
      if (mask.solidAt(this.x, headY) || mask.solidAt(this.bounds().l + 1, headY) || mask.solidAt(this.bounds().r - 1, headY)) {
        if (this.jumping) this.jumping.vel = 0;
        let guard = 0;
        while (guard++ < 24 && mask.solidAt(this.x, this.bounds().t)) this.y += 1;
      }
      return;
    }
    // Falling / walking down: settle onto the surface beneath the feet.
    const band = Math.max(8, (this.jumping?.vel ?? 0) + 6);
    const surf = mask.surfaceUnder(this.x, this.y, band);
    if (surf !== null && this.y >= surf - 1) {
      this.y = surf;
      this.jumping = null;
    } else if (mask.solidAt(this.x, this.y)) {
      // Feet buried in geometry: lift out to the surface.
      let guard = 0;
      while (guard++ < 64 && mask.solidAt(this.x, this.y)) this.y -= 1;
      this.jumping = null;
    }
  }

  /**
   * Auto step-up: decide whether a wall that just blocked horizontal movement is
   * actually a small ledge the unit can climb onto in one tick, and if so lift
   * the feet onto it. Returns true when the step was taken (the caller then skips
   * the normal block so the horizontal move continues).
   *
   * All of the following must hold, so we never climb walls we shouldn't:
   *   - the unit is moving horizontally (under its own power or a recoil shove)
   *     TOWARD this wall — a unit standing still, or drifting away, is never
   *     teleported upward;
   *   - the unit is grounded — airborne units bump into walls normally, so you
   *     can't wall-climb mid-jump;
   *   - the ledge top sits ABOVE the feet but no higher than STEP_UP_MAX — a
   *     taller face is a real wall and keeps blocking.
   *
   * Lifting the feet to the ledge top makes the AABB bottom equal the wall top,
   * which clears the overlap for this wall; the following gravity/`resolveAxis`
   * pass keeps the unit planted. Consecutive risers of a staircase are climbed
   * one per tick, so the ascent is capped at STEP_UP_MAX per frame and stays
   * smooth rather than snapping up a whole slope at once.
   */
  private tryStepUp(w: { x: number; y: number; width: number; height: number }): boolean {
    // Effective horizontal velocity: walk input plus any weapon recoil shove.
    const vx = this.moving.vel + this.knockVel;
    if (Math.abs(vx) < 0.01) return false;
    // Only step up when moving INTO the step (wall lies ahead in travel dir).
    if (Math.sign(w.x - this.x) !== Math.sign(vx)) return false;
    // Never climb through the air — must be walking on ground/a ledge.
    if (!this.onGround()) return false;
    // The ledge must rise above the feet but by no more than one step.
    const wallTop = w.y - w.height / 2;
    const rise = this.y - wallTop;
    if (rise <= 0 || rise > STEP_UP_MAX * this.scale) return false;
    // Plant the feet on the ledge top; the horizontal move now proceeds.
    this.y = wallTop;
    return true;
  }

  private draw(): void {
    this.view.x = this.x;
    this.view.y = this.y;

    // Build the baked-frame sprites lazily once art is ready.
    if (!this.bodySprite && !this.partsContainer && (SkinAnim.loaded || PartArt.loaded || AnimNoArm.loaded || AnimNoHead.loaded)) this.drawFigure();

    // Aim angle: measured from the weapon-arm shoulder (including the per-frame
    // body-tracking offset) so the arm points exactly at the cursor while
    // ducking / bobbing.
    // Aim is computed in WORLD space (aimX/aimY are world coords). Zoom is a
    // uniform scale so the resulting angle is identical on screen.
    const sh = this.shoulder();
    const bs = this.bodyScale();
    const shoulderWorldX = this.x + sh.x * bs * this.facing;
    const shoulderWorldY = this.y + sh.y * bs;
    this.aimRotation = UT.getRotation(shoulderWorldX, shoulderWorldY, this.aimX, this.aimY);
    this.updateReloadDip();

    // Spin the character during a double-jump flip.
    this.applyFlip();

    if (this.bodySprite) {
      this.updateSprites();
      return;
    }
    // Placeholder path.
    this.bodyG.scale.x = this.facing;
    this.updateNameBox();
  }

  // --- combat ------------------------------------------------------------

  /**
   * Add a one-off horizontal impulse (px/frame), used by Guns to shove the
   * shooter back when a heavy weapon goes off. Impulses from rapid shots
   * stack, but are clamped so a held chaingun can't rocket-jump the unit.
   */
  addKnockback(v: number): void {
    // No-op by default: the original applies no knockback to live units
    // (doc 01 §8). Guarded so the death-ragdoll path (rdPhys) is untouched.
    if (!Unit.LIVE_KNOCKBACK) return;
    this.knockVel = Math.max(-8, Math.min(8, this.knockVel + v));
  }

  /**
   * Stagger this unit for `frames` (see `hitStun`). Takes the longest pending
   * stun rather than accumulating, so sustained fire pins a target without
   * ever locking it out for seconds at a time.
   */
  applyHitStun(frames: number): void {
    // No-op by default: the original has no live-unit stagger (doc 01 §8).
    if (!Unit.LIVE_KNOCKBACK) return;
    this.hitStun = Math.max(this.hitStun, Math.min(12, frames));
  }

  /**
   * The weapon-arm shoulder pivot, in arena space.
   *
   * This is the exact point the arm sprite is rotated about in updateSprites():
   * the per-frame arm attach point from the rig. Aim, muzzle and arm art
   * therefore all agree, whichever way the body is ducking or bobbing.
   */
  getShoulder(): { x: number; y: number } {
    // Must match updateSprites() term for term, or the shot leaves from a point
    // the arm isn't actually drawn at.
    const sh = this.shoulder();
    const bs = this.bodyScale();
    return {
      x: this.x + sh.x * bs * this.facing,
      y: this.y + sh.y * bs,
    };
  }

  /**
   * Where a shot from this unit originates, in arena space: the tip of the
   * weapon's barrel.
   *
   * Rounds leave the barrel, not the chest — so this walks the arm out from the
   * shoulder pivot along the aim, by the current weapon's `muzzleLen`. That
   * matters most for the long weapons (a 34px sniper barrel at scale 0.7 is a
   * ~24px offset) and for shots taken at a steep angle, where an origin fixed
   * to the body centre puts the shot visibly off the gun.
   *
   * `angleDeg` is the direction this particular shot leaves in (a shotgun's
   * pellets each get their own); it defaults to the arm's current look angle,
   * which is what non-firing callers (AI line-of-sight) want.
   */
  getMuzzle(angleDeg?: number): { x: number; y: number } {
    const s = this.getShoulder();
    const ang = angleDeg ?? this.gun?.lookAngle ?? this.aimRotation;
    const len = (this.gun?.curGun?.muzzleLen ?? 18) * ARM_SCALE;
    // Perpendicular drop for guns whose muzzle sits off the shoulder line (the
    // rocket tube, chaingun barrels, etc). "Below the barrel" in the art must
    // stay below in world space whichever way the unit faces, so it is signed
    // by facing. Zero for guns whose barrel runs through the shoulder.
    const dy = (this.gun?.curGun?.muzzleDy ?? 0) * ARM_SCALE * this.facing;
    const rad = ang * DEG;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
      x: s.x + cos * len - sin * dy,
      y: s.y + sin * len + cos * dy,
    };
  }

  /** Called by Status when HP hits 0. Spawns the ragdoll + dropped gun. */
  killGuy(info: { attacker?: any; x: number; y: number; headShot?: boolean; region?: string }): void {
    this.status.dead = true;
    this.view.visible = false;

    // Death spray at the wound. The killing shot's own impact effect is sized
    // for a flesh wound; this is the burst that marks the body going down, and
    // it fires whatever killed them (including splash, which has no impact fx
    // on the victim at all).
    // "lol cats" special mode (doc 11 §2.1): blood becomes a rainbow spray.
    const bloodColor = SD.matchSettings.lolCats
      ? [0xff5a5a, 0xffcc33, 0x66ff66, 0x66ccff, 0xcc66ff][Math.floor(Math.random() * 5)]
      : undefined;
    this.game.addEffect(
      this.x, this.y - 45 * this.bodyScale(),
      info.headShot ? "bloodBig" : "blood", bloodColor,
    );

    // The crown drops with its holder, freeing the pickup to re-arm.
    const wasJug = this.isJug;
    if (wasJug) {
      this.removeJug();
      this.game.hud?.addMessage?.(`${this._name} lost the crown`, 0xffcc33);
    }

    this.game.rdPhys.makeGuy(this, {
      x: info.x,
      y: info.y,
      headShot: info.headShot,
    });
    this.game.rdPhys.makeGun(this);

    this.score.addDeath();
    const killer = info.attacker;
    const hud = this.game.hud;
    if (killer && killer !== this) {
      killer.score.addKill(killer.gun.curGun.id, !!info.headShot);
      // A kill tops up the killer's ability energy (a port addition — the SWF
      // charged energy purely on a timer).
      killer.status?.addEnergy?.(20);
      // Host: replicate this kill to peers for their kill feed.
      (this.game as any).recordNetKill?.(killer, this, !!info.headShot);
      // "Death from Beyond the Grave": the killer was already down, waiting to
      // respawn, when their last shot / grenade landed.
      if (killer.human && killer.status?.dead) Achievements.addAch("gravekill");
      if (wasJug) {
        killer.score.jugKills++;
        // Juggernaut mode: slaying the Juggernaut passes the crown to the killer.
        if (SD.matchSettings.type === "jug" && !killer.status?.dead) killer.setJug();
      }
      // Kill-feed + transient announcements.
      hud?.addKillMessage?.(killer._name, killer.gun.curGun.id, this._name, !!info.headShot, {
        killerTeam: killer.team,
        victimTeam: this.team,
        killerIsPlayer: !!killer.human,
        victimIsPlayer: this.human,
      });
      // World-space kill card at the body — only for the human's own kills,
      // otherwise a busy arena covers itself in popups.
      if (killer.human) {
        this.game.addKillPopup?.(
          this.x,
          this.y - 70 * this.bodyScale(),
          killer.gun.curGun.id,
          !!info.headShot,
        );
      }
      if (info.headShot) hud?.announce?.("HEADSHOT!", 0xffcc33);

      // Raze 2 kill-bonus economy: award credits (base + bonuses) and, for the
      // human's own kills, float the itemised bonus popup above the body.
      const bonuses = computeKillBonuses(killer, this, info);
      const pts = killPoints(killer, bonuses);
      if (killer.human) {
        SD.addCredits(pts);
        // "Stylish" / "Kill Enthusiast": track distinct kill-bonuses earned.
        if (bonuses.length) {
          let fresh = false;
          for (const b of bonuses) {
            if (!SD.bonusesUnlocked.includes(b.id)) {
              SD.bonusesUnlocked.push(b.id);
              fresh = true;
            }
          }
          if (fresh) {
            SD.save();
            if (SD.bonusesUnlocked.length >= 15) Achievements.addAch("bonus1");
            if (SD.bonusesUnlocked.length >= 30) Achievements.addAch("bonus2");
          }
          this.game.addBonusPopup?.(
            this.x,
            this.y - 96 * this.bodyScale(),
            bonuses.map((b) => b.name),
            pts,
          );
        }
      }

      // Streak ladder lives in the HUD so the tiers and their colours are
      // defined next to the announcement styling that renders them.
      hud?.announceStreak?.(killer._name, killer.score.killStreak);
      // This death ends the victim's own run, so their ladder re-arms.
      hud?.resetStreak?.(this._name);
      if (typeof killer.say === "function" && Math.random() < 0.4) {
        killer.say(pick(KILL_LINES));
      }
    } else {
      this.score.addSuicide();
      hud?.addMessage?.(`${this._name} self-destructed`);
      // Juggernaught mode (doc 11 §1.5): if the Jug suicides, the crown passes
      // to a random *other* living unit rather than to a killer.
      if (wasJug && SD.matchSettings.type === "jug") {
        const others = this.game.units.filter((u) => u !== this && !u.status?.dead);
        if (others.length) {
          others[Math.floor(Math.random() * others.length)].setJug();
        }
      }
    }
  }

  /** The value Match / HUD ranks by. */
  get getScore(): number {
    if (SD.matchSettings.lives) {
      return Number(SD.matchSettings.lives) - this.score.deaths;
    }
    return this.score.value;
  }

  // --- per-frame (overridden by Player/AI) ------------------------------

  EnterFrame(): void {
    this.moveUnit();
  }

  // --- online multiplayer sync ------------------------------------------

  /** Host: capture everything a peer needs to render this unit this frame. */
  serializeNet(): import("../net/NetGame").UnitNetState {
    const g = this.gun?.curGun;
    return {
      id: this.netId,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      f: this.facing,
      a: Math.round(this.aimRotation * 10) / 10,
      c: this.crouching ? 1 : 0,
      air: this.jumping ? 1 : 0,
      vel: Math.round(this.moving.vel * 100) / 100,
      vy: this.jumping ? Math.round(this.jumping.vel * 100) / 100 : 0,
      g: g?.id ?? "pistol",
      clip: g?.curClip ?? 0,
      ammo: g?.curAmmo ?? 0,
      sh: Math.round(this.status.shCur),
      hp: Math.round(this.status.hpCur),
      d: this.status.dead ? 1 : 0,
      j: this.isJug ? 1 : 0,
      fire: this.gun?.isFiring ? 1 : 0,
      ki: this.score.kills,
      de: this.score.deaths,
    };
  }

  /**
   * Client: adopt a snapshot. `smooth` is the position lerp factor (1 = snap).
   * Never simulates — sets the fields the renderer reads and drives death /
   * respawn + the muzzle-flash edge locally.
   */
  applyNet(s: import("../net/NetGame").UnitNetState, smooth: number): void {
    // Death / respawn transitions.
    if (s.d && !this.status.dead) {
      this.netDie();
      return;
    }
    if (s.d) return; // stay down; the ragdoll owns the visual
    if (!s.d && this.status.dead) this.netRevive();

    // Position (smoothed) + orientation.
    if (smooth >= 1) {
      this.x = s.x;
      this.y = s.y;
    } else {
      this.x += (s.x - this.x) * smooth;
      this.y += (s.y - this.y) * smooth;
    }
    this.facing = s.f;
    this.aimRotation = s.a;
    this.crouching = !!s.c;
    this.moving.vel = s.vel;
    if (s.air) {
      if (!this.jumping) this.jumping = { vel: s.vy, grav: 0.8, fallMax: 20, dJump: false };
      else this.jumping.vel = s.vy;
    } else {
      this.jumping = null;
    }

    // Held weapon + ammo (the arsenal is always full, so selectGun is safe).
    if (this.gun.curGun?.id !== s.g) this.gun.selectGun(s.g);
    if (this.gun.curGun) {
      this.gun.curGun.curClip = s.clip;
      this.gun.curGun.curAmmo = s.ammo;
    }
    this.status.shCur = s.sh;
    this.status.hpCur = s.hp;
    this.isJug = !!s.j;
    this.score.kills = s.ki;
    this.score.deaths = s.de;

    // Muzzle flash on the rising edge of firing (peers don't run Guns).
    if (s.fire && !this._netFiring) this.spawnNetMuzzle();
    this._netFiring = !!s.fire;

    this.netRender();
  }

  /** Client prediction: run the local movement step for the owned unit. */
  predictMove(): void {
    this.moveUnit();
  }

  /**
   * Client prediction reconcile for the OWNED unit: keep the locally-predicted
   * movement/animation, but ease the position toward the host's authoritative
   * value (snap on a big desync) and adopt authoritative stats. Firing feedback
   * still comes from the host's fire flag.
   */
  applyNetOwn(s: import("../net/NetGame").UnitNetState): void {
    if (s.d && !this.status.dead) {
      this.netDie();
      return;
    }
    if (s.d) return;
    if (!s.d && this.status.dead) this.netRevive();

    const dx = s.x - this.x;
    const dy = s.y - this.y;
    if (Math.hypot(dx, dy) > 60) {
      this.x = s.x;
      this.y = s.y;
    } else {
      this.x += dx * 0.15;
      this.y += dy * 0.15;
    }

    if (this.gun.curGun?.id !== s.g) this.gun.selectGun(s.g);
    if (this.gun.curGun) {
      this.gun.curGun.curClip = s.clip;
      this.gun.curGun.curAmmo = s.ammo;
    }
    this.status.shCur = s.sh;
    this.status.hpCur = s.hp;
    this.isJug = !!s.j;
    this.score.kills = s.ki;
    this.score.deaths = s.de;

    if (s.fire && !this._netFiring) this.spawnNetMuzzle();
    this._netFiring = !!s.fire;
  }

  /** Client: render from the current field values without simulating. */
  netRender(): void {
    this.view.x = this.x;
    this.view.y = this.y;
    if (!this.bodySprite && !this.partsContainer && (SkinAnim.loaded || PartArt.loaded || AnimNoArm.loaded || AnimNoHead.loaded)) this.drawFigure();
    this.applyFlip();
    if (this.bodySprite) this.updateSprites();
    else {
      this.bodyG.scale.x = this.facing;
      this.updateNameBox();
    }
  }

  /** Client: cosmetic death — ragdoll + dropped gun, no scoring/kill-feed. */
  private netDie(): void {
    this.status.dead = true;
    this.view.visible = false;
    this._netFiring = false;
    this.game.addEffect(this.x, this.y - 45 * this.bodyScale(), "blood");
    if (this.isJug) this.removeJug();
    this.game.rdPhys.makeGuy(this, { x: this.x, y: this.y - 45 * this.bodyScale() });
    this.game.rdPhys.makeGun(this);
  }

  /** Client: cosmetic respawn. Position is corrected by the next applyNet. */
  private netRevive(): void {
    this.respawn();
  }

  private spawnNetMuzzle(): void {
    if (this.status.dead) return;
    const g = this.gun?.curGun;
    const m = this.getMuzzle(this.aimRotation);
    this.game.addMuzzleFlash(m.x, m.y, this.aimRotation, g?.muzzleColor ?? 0xffd86b, g?.muzzleSize ?? 8);
    // A short indicative tracer — the host owns real hit resolution, so this is
    // presentation only, capped so it doesn't shoot across the whole world.
    const rad = this.aimRotation * DEG;
    const len = Math.min(g?.maxRange ?? 400, 700);
    this.game.addTracer(m.x, m.y, m.x + Math.cos(rad) * len, m.y + Math.sin(rad) * len, g?.rayType === "beam");
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}
