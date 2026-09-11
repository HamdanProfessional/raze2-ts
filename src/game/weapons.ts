/**
 * Weapon definitions — the Raze 2 roster, generated in full from
 * `Stats_Guns` (`src/assets/raze2/weapons.json`).
 *
 * There is no hand-authored weapon table here. Every one of the 36 purchasable
 * guns is derived from its catalog row, so a gun's damage, clip, range, rate,
 * spread, crit multipliers, tracer look and projectile behaviour are the values
 * the original shipped with. Damage and range are scaled ×10 because the port's
 * HP base is ~1000 against Raze 2's ~100 (see Status).
 *
 * The original stored a `bullet` class reference for each weapon's visual; here
 * we keep an `effectKey` string and let the effects layer resolve the visual.
 */

/**
 * How a weapon's shot resolves against the world:
 * - `hitscan`  — one instant ray, stops at the first unit hit (pistol, arifle, sniper).
 * - `spread`   — several hitscan rays in a cone, one trigger pull (shotgun).
 * - `beam`     — one instant ray that pierces every unit along its path (railgun,
 *                zapper, beamer); drawn as a thick energy line.
 * - `projectile` — a travelling body with gravity/splash (blaster, sticklaunch, rocket).
 */
import { RAZE2_WEAPONS, type Raze2Weapon } from "../assets/raze2";
import MUZZLE from "../assets/muzzle.json";

export type RayType = "hitscan" | "spread" | "beam" | "projectile";

/**
 * The seven authored tracer looks from Raze 2 (`Bullet_Line_*` subclasses,
 * doc 05). Each renders a different stroke geometry/lifetime; GameScreen's
 * `drawTracer` switches on this.
 *  - `basic`    — randomly-dashed single-frame flash (pistol/rifle/shotgun).
 *  - `sniper`   — dense polyline that drifts ("heat shimmer") and fades ~1s.
 *  - `bend`     — quadratic "whip" that un-kinks and fades ~0.3s (uzi/pshotgun).
 *  - `electric` — 3 jittered strands that drift and fade (railgun2 arc).
 *  - `laser`    — jittered double line, one frame, re-fired each tick (beamer).
 *  - `zapper`   — distance-scaled crackling double strand, one frame (zapper).
 *  - `effect`   — solid two-pass beam + a spark that chases to the impact (rail).
 */
export type TracerStyle =
  | "basic" | "sniper" | "bend" | "electric" | "laser" | "zapper" | "effect";

/** Draw options passed from Guns.ts to GameScreen.addTracer for one shot. */
export interface TracerOpts {
  style?: TracerStyle;
  /** Outer/glow colour. */
  color?: number;
  /** Inner/core colour (defaults to `color`). */
  color2?: number;
  /** Outer/inner stroke widths. */
  w1?: number;
  w2?: number;
  a1?: number;
  a2?: number;
  /** Randomly-dashed path (Bullet_Line_Basic look). */
  dashed?: boolean;
  /** The ray bit a body (bows the line slightly toward its midpoint). */
  hitUnit?: boolean;
}

export interface WeaponDef {
  id: string;
  /** Kill-feed verb, e.g. "Pistoled". */
  msg: string;
  /** Raze 2 `type`: the armory slot the gun occupies (0 sidearm … 7 special).
   *  Scripts gate on it — the tutorial's second panel only yields to slot 2. */
  slot?: number;
  /** How the shot resolves (see RayType). Defaults are derived in makeGun. */
  rayType?: RayType;
  /** Rounds per clip. */
  maxClip: number;
  /** Reserve ammo (ignored when oneClip). */
  curAmmo: number;
  maxAmmo: number;
  /** Weapons whose reserve IS the clip (chaingun, zapper, flamethrower). */
  oneClip?: boolean;
  infAmmo?: boolean;
  /** Fires a travelling projectile instead of hitscan. */
  projectile?: boolean;
  /**
   * Raze 2 `force`: how hard a killing blow throws the corpse (3..30). Distinct
   * from `kick`, which is the recoil shove the *shooter* takes.
   */
  force?: number;
  /** Distance covered by one collision step (Raze 2: always 5). */
  speed?: number;
  /** Raze 2 `params[1]`: substeps per frame. A frame advances 2x this many steps. */
  substeps?: number;
  /** Downward velocity added once per frame (Raze 2 `params[2] * 0.1`). */
  gravity?: number;

  // --- projectile behaviours (Raze 2 Bullet_Proj_* classes) -------------
  /** Homing: seek turn rate in rad/frame (>0 enables homing). */
  homing?: number;
  /** Homing acquisition radius (px). */
  seekRadius?: number;
  /**
   * Bounces off walls instead of detonating (`Bullet_Proj_Bounce`). The shell is
   * bounded by its fuse, not a bounce count — the original tallies `extra.bounce`
   * only to award the icegun's multi-bounce kill bonus (`KillPoints.as:165`).
   */
  bounces?: boolean;
  /** Frames a bouncer lives before auto-detonating. */
  bounceLife?: number;
  /** Sticks to the unit it hits, then detonates after a fuse. */
  stick?: boolean;
  /** Frames stuck before detonating. */
  stickFuse?: number;
  /** Drops, settles on a surface, then proximity-detonates (land mine). */
  mine?: boolean;
  /** Frames a mine lives before auto-detonating. */
  mineLife?: number;
  /** Pellets per trigger pull (shotgun). */
  multiShot?: number;
  /** Ray passes through units (railgun, railgun2). */
  piercing?: boolean;
  /** Ammo consumed per-hit rather than per-shot. */
  percAmmo?: boolean;
  autoFire?: boolean;
  maxRange: number;
  recoil: number;
  reDuck: number;
  reJump: number;
  damage: number;
  /** Locational crit multipliers (Raze 2 `mults`). Default 1 when unset. */
  headMult?: number;
  crotchMult?: number;
  buttMult?: number;
  /** Splash damage multiplier for explosive projectiles. */
  splashMult?: number;
  /** Blast radius in px (Raze 2 `splash`). Slot-6 explosives run 100-120, the
   *  incidental splash on a torch or flame 60. */
  splashRadius?: number;
  /** Muzzle Y offset for held-gun position. */
  modPosY?: number;
  /** Impact effect on walls / on units. */
  wallEff?: string;
  unitEff?: string;
  effectKey?: string;

  // --- per-weapon audio (Raze 2 shotSound/reload rig, doc 03 §4) ---------
  /** Fire-sound key (resolves via Sounds ALIASES/MANIFEST). */
  fireSound?: string;
  /** Reload magazine-seat sound key. */
  reloadSound?: string;
  /** Frames between shots (from Raze 2 shootDelay×30). */
  fireDelay?: number;
  /**
   * Reload duration in logic frames. The original drove this off the reload
   * arm-animation length (per silhouette), not a data field; approximated here
   * per arm-rig (pistol fast, rocket slow) instead of one flat value.
   */
  reloadFrames?: number;
  /** Reload arm-rig (Raze 2 `frameReload`): pistol/rifle/shotgun/sniper/heavy/rocket. */
  reloadRig?: string;
  /** Throttle repeat fire-sound to every N shots (beam weapons; extra.soundFrames). */
  soundFrames?: number;

  // --- tracer look (Raze 2 Bullet_Line_* draw style, doc 05) -------------
  tracerStyle?: TracerStyle;
  /** Primary (outer glow) tracer colour. */
  tracerColor?: number;
  /** Secondary (inner core) tracer colour; defaults to tracerColor. */
  tracerColor2?: number;
  /** Outer/inner stroke widths. */
  tracerW1?: number;
  tracerW2?: number;
  tracerAlpha1?: number;
  tracerAlpha2?: number;
  /** Randomly dashed path (Bullet_Line_Basic with params[0]===true). */
  tracerDashed?: boolean;

  // --- extra hitscan/projectile behaviours (Raze 2 stats.extra) ---------
  /** Arc-chain: on unit hit, chain to up to 3 nearby enemies within this px. */
  arc?: number;
  /** Saw blades keep travelling through the ground at ~2× damage. */
  burrow?: boolean;
  /** On any impact, spawn N radial "bouncer" sub-munitions. */
  bounceShots?: number;
  /** Ignite strength applied to the victim (fire DoT). */
  setFire?: number;
  /** Flamethrower: rising, animation-driven flame projectile. */
  flame?: boolean;
  /** Homing turn rate in degrees/frame (Bullet_Proj_Follow params[4]). */
  homingTurn?: number;

  // --- projectile art colours (doc 04 §3 effect-key tints) --------------
  projColor?: number;
  projGlow?: number;

  // --- feel / muzzle presentation ---------------------------------------
  /**
   * Punch factor, ~0..1. Drives the visual recoil kick, the muzzle-flash
   * scale and the shooter's knockback. Derived from Raze 2's `force` (the
   * impact impulse a round carries) times the pellet count, so a shotgun's
   * five 4-force pellets land as one heavy shove. `recoil` is NOT the proxy —
   * that field is the spread cone, and the two disagree: the sniper has the
   * tightest cone in the game and the hardest kick.
   */
  kick?: number;
  /** Muzzle-flash tint. */
  muzzleColor?: number;
  /** Muzzle-flash radius in px at kick 1. */
  muzzleSize?: number;
  /** Barrel length: how far ahead of the shoulder the flash/smoke sits. */
  muzzleLen?: number;
  /** Barrel offset perpendicular to aim (native px, +down/below the barrel
   *  line): guns whose muzzle sits below the hand, e.g. the rocket tube. */
  muzzleDy?: number;
  /** Barrel-smoke puffs generated per shot (fractional accumulates). */
  smoke?: number;
  /** Ejects a tumbling shell casing on fire. */
  shell?: boolean;
  /** Impact-spark tint for wall/ground hits. */
  sparkColor?: number;
  // AI tuning.
  AI_minRange?: number;
  AI_maxRange?: number;
  AI_firePerc?: number;
}

export const WEAPONS: Record<string, WeaponDef> = {};

// ---------------------------------------------------------------------------
// Generation. Every Raze 2 gun in the armory slots (`type` 0-6) is converted
// from its `Stats_Guns` row below. The type-7 rows (env, fire, sword, grenade,
// mine, bouncer) are utility/consumable damage sources driven by Abilities, not
// selectable guns, so they are not part of this table.
// ---------------------------------------------------------------------------

/** Raze 2 `shotSound` class name → port sound key (Sounds MANIFEST/ALIASES). */
const SHOT_SOUND: Record<string, string> = {
  S_pistolFire: "R2_pistolFire", S_plasmaFire: "R2_plasmaFire", S_uziFire: "R2_uziFire",
  S_sniperFire: "R2_sniperFire", S_shotgunFire: "R2_shotgunFire", S_laserBig: "R2_laserBig",
  S_Zapper: "R2_Zapper", S_assaultFire: "R2_assaultFire", S_alienSniper: "R2_alienSniper",
  S_ripperFire: "R2_ripperFire", S_Laser: "R2_Laser", S_Fire: "R2_Fire",
  S_rocketFire: "R2_rocketFire", S_Whip: "R2_Whip",
};
/** Reload arm-rig (`frameReload`) → reload sound key + duration in frames. */
const RELOAD_RIG: Record<string, { sound: string; frames: number }> = {
  pistol:  { sound: "R2_reloadPistol",  frames: 26 },
  rifle:   { sound: "R2_reloadRifle",   frames: 34 },
  shotgun: { sound: "R2_reloadShotgun", frames: 44 },
  sniper:  { sound: "R2_reloadSniper",  frames: 50 },
  heavy:   { sound: "R2_reloadHeavy",   frames: 58 },
  rocket:  { sound: "R2_reloadRocket",  frames: 54 },
};
/** Bullet_Line_* class → tracer style. */
const CLS_TRACER: Record<string, TracerStyle> = {
  Bullet_Line_Basic: "basic", Bullet_Line_Sniper: "sniper", Bullet_Line_Bend: "bend",
  Bullet_Line_Electric: "electric", Bullet_Line_Laser: "laser",
  Bullet_Line_Zapper: "zapper", Bullet_Line_Effect: "effect",
};
/** Projectile trail effect-key (params[0]) → [core, glow] tint (doc 04/05). */
const PROJ_TINT: Record<string, [number, number]> = {
  plasmapistol_shot: [0x00CCFF, 0x9900FF], plasma_shot: [0x66E0FF, 0x9933CC],
  photon_shot: [0x9999FF, 0x6666FF], blood_shot: [0xCC0000, 0x880000],
  bubble_shot: [0xAEE9FF, 0x66CCFF], ember: [0xFF9933, 0xFF5522],
  snow_fall: [0xE6F4FF, 0xAADDFF], saw_shot: [0xCCCCCC, 0x888888],
  gas_med: [0x99CC33, 0x66CC00], gas_small: [0xFFAA55, 0xFF6A2A],
  gas_sblue: [0x99DDFF, 0x66CCFF], chain_fire: [0xFF6633, 0xFF0000],
  flame: [0xFFCC44, 0xFF6622],
};

/**
 * Tint for a Raze 2 muzzle/impact effect name (`effShoot` / `effHit`). These
 * are the authored effect clips each gun points at, so they — not the tracer —
 * are what decides that the Ion Cannon flashes orange and the Zapper purple.
 * `bloodHuman` is deliberately absent: that impact draws blood, which carries
 * the victim's own colour rather than the weapon's.
 */
const EFFECT_TINT: Record<string, number> = {
  gas_small: 0xFFD86B, gas_big: 0xFFB04A, gas_big2: 0xCCFF66,
  gas_bred: 0xFF5544, gas_bblue: 0x88DDFF, gas_bigblue: 0x66CCFF,
  plasmapistol_hit: 0x00CCFF, plasma_explode: 0xBB66FF, purple_fire: 0xCC66FF,
  green_shot: 0x99FF66, orange_shot: 0xFFAA33, snow_splash: 0xCCEEFF,
  chain_fire: 0xFF6633, chain_hit: 0xFF4422, fexpand: 0xFF8833,
  spark_big: 0xFFFFFF, spark_small: 0xFFF2A0, getweapon: 0xFFFFAA,
};

/**
 * Barrel tip per weapon, measured off the shipped arm art by
 * `tools/measure-muzzle.py`: the offset from the arm clip's shoulder anchor to
 * the furthest opaque pixel of the gun, in the world px the arm renders at.
 *
 * `Stats_Guns` has no barrel-length field — the original never needed one,
 * because it spawned bullets from a `muzzle` MovieClip parented inside the gun
 * sprite, so the art WAS the answer. Measuring the same art recovers it.
 */
const MUZZLE_GEOM = MUZZLE as Record<string, { len: number; dy: number }>;

/** Pull the tracer colour/width layers out of a Bullet_Line_* params array. */
function tracerFromParams(w: Raze2Weapon): Partial<WeaponDef> {
  const style = CLS_TRACER[w.cls];
  if (!style) return {};
  const p = Array.isArray(w.params) ? w.params : [];
  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
  if (style === "zapper") {
    // Colours are hardcoded in the original (empty params).
    return { tracerStyle: style, tracerColor: 0xCC00FF, tracerColor2: 0x9900FF };
  }
  if (style === "laser") {
    // params = [w1, color1, a1, w2, color2, a2]  (no leading flag).
    return {
      tracerStyle: style,
      tracerW1: num(p[0], 8), tracerColor: num(p[1], 0x66CC00), tracerAlpha1: num(p[2], 0.5),
      tracerW2: num(p[3], 4), tracerColor2: num(p[4], 0x96CC01), tracerAlpha2: num(p[5], 0.8),
    };
  }
  // basic / sniper / bend / electric / effect:
  // params = [dashFlag, w1, color1, a1, w2, color2, a2, ...]
  return {
    tracerStyle: style,
    tracerDashed: p[0] === true || undefined,
    tracerW1: num(p[1], 3.5), tracerColor: num(p[2], 0xFFFFC4), tracerAlpha1: num(p[3], 0.3),
    tracerW2: num(p[4], 1.5), tracerColor2: num(p[5], num(p[2], 0xFFFFC4)), tracerAlpha2: num(p[6], 0.6),
  };
}

/**
 * Per-*step* motion for a projectile weapon, read off its Raze 2 bullet class.
 *
 * `Bullet.as:120` launches every round at speed 10 and each `Bullet_Proj_*`
 * constructor halves it, so one step is 5px — the same for every gun. What
 * differs per weapon is how many steps a frame is worth: EnterFrame runs
 * `params[1]` substeps and advances the position *twice* inside each
 * (`Bullet_Proj_Basic.as:39-46`). The doubling is deliberate rather than a
 * decompiler artefact — the range accumulator next to it reads
 * `countDistX += Math.abs(xVel) * 2`. So a round covers `2 * params[1] * 5`
 * per frame: 70px for the rocket's params[1]=7, 30px for the grenade's 3.
 *
 * Gravity is applied once per frame *before* the substep loop, not per step:
 * `yVel += params[2] * 0.1`. Reading it per-step (or feeding params[2] in raw)
 * makes a rocket fall 8x too fast.
 */
function projMotion(w: Raze2Weapon): { speed: number; substeps: number; gravity: number } {
  // A mine is dropped rather than fired: it ignores the shared launch speed and
  // simply falls until it settles.
  if (w.cls === "Bullet_Proj_Mine") return { speed: 0.2, substeps: 1, gravity: 1.2 };
  // Everything else — including the flamethrower, whose params[2] is negative
  // (["flame", 2, -2, 4]) because its "gravity" makes the flame rise.
  return { speed: 5, substeps: paramNum(w, 1, 2), gravity: paramNum(w, 2, 0) * 0.1 };
}

/** Read a numeric entry from a bullet-class params array, or a default. */
function paramNum(w: Raze2Weapon, i: number, dflt: number): number {
  const v = Array.isArray(w.params) ? w.params[i] : undefined;
  return typeof v === "number" ? v : dflt;
}

/** Does this params array actually carry a seek radius + turn rate (indices 3,4)? */
function hasHomingParams(w: Raze2Weapon): boolean {
  return Array.isArray(w.params) &&
    typeof w.params[3] === "number" && typeof w.params[4] === "number";
}

/** Projectile special behaviour flags, by Raze 2 bullet class. */
function projBehavior(w: Raze2Weapon): Partial<WeaponDef> {
  switch (w.cls) {
    case "Bullet_Proj_Follow":
      // Homing — params[3]=seek radius (px), params[4]=turn rate (deg/frame).
      // NOTE: alienrifle (params:null) and arifl2 (["ember",10,1]) carry NO
      // seek/turn params, so their "Homing" perk is a latent no-op in the
      // original (NaN comparisons fail closed). We match that: no homing wired.
      return hasHomingParams(w)
        ? { homing: 0.13, homingTurn: paramNum(w, 4, 7), seekRadius: paramNum(w, 3, 180) }
        : {};
    case "Bullet_Proj_Bounce": // params[3] = fuse seconds
      return { bounces: true, bounceLife: Math.round(paramNum(w, 3, 3) * 30) };
    case "Bullet_Proj_Stick": // params[3] = fuse seconds
      return { stick: true, stickFuse: Math.round(paramNum(w, 3, 3) * 30) };
    case "Bullet_Proj_Mine": // params[0] = lifetime seconds
      return { mine: true, mineLife: Math.round(paramNum(w, 0, 30) * 30) };
    case "Bullet_Proj_Frames": // flamethrower: rising animation-driven flame
      return { flame: true };
    default:
      return {};
  }
}

/** stats.extra flag behaviours shared across bullet classes (doc 04 §2.0). */
function extraBehavior(extra: Record<string, unknown>): Partial<WeaponDef> {
  const out: Partial<WeaponDef> = {};
  if (typeof extra.arc === "number") out.arc = extra.arc;
  if (extra.burrow) out.burrow = true;
  if (typeof extra.bounceShots === "number") out.bounceShots = extra.bounceShots;
  if (typeof extra.setFire === "number") out.setFire = extra.setFire;
  if (typeof extra.soundFrames === "number") out.soundFrames = extra.soundFrames;
  return out;
}

/** Impact effect keys by broad behaviour (reuse the port's existing effects). */
function effectsFor(rayType: RayType, splash: boolean): Pick<WeaponDef, "wallEff" | "unitEff" | "effectKey"> {
  if (rayType === "projectile") {
    return splash
      ? { wallEff: "rocketExplode", unitEff: "rocketExplode", effectKey: "Effect_Proj_Rocket" }
      : { wallEff: "bulletExplode", unitEff: "bulletExplode", effectKey: "Effect_Bullet" };
  }
  if (rayType === "beam") return { wallEff: "lightning", unitEff: "lightning", effectKey: "Effect_Lightning" };
  return { wallEff: "pistol", unitEff: "blood", effectKey: "Effect_Bullet" };
}

/** Map one Raze 2 weapon record onto the port's WeaponDef. */
function raze2ToDef(w: Raze2Weapon): WeaponDef {
  const extra = (w.extra ?? {}) as Record<string, unknown>;
  const isProj = w.cls.startsWith("Bullet_Proj");
  const isMelee = w.cls === "Bullet_Melee_Basic";
  const pellets = extra.extraShots ? Number(extra.extraShots) + 1 : 1;
  const piercing = w.cls === "Bullet_Line_Effect" || w.cls === "Bullet_Line_Electric" || !!extra.pierce;

  let rayType: RayType;
  if (isProj) rayType = "projectile";
  else if (w.cls === "Bullet_Line_Effect" || w.cls === "Bullet_Line_Zapper" ||
           w.cls === "Bullet_Line_Laser" || w.cls === "Bullet_Line_Electric") rayType = "beam";
  else rayType = "hitscan";
  if (!isProj && !isMelee && pellets > 1) rayType = "spread"; // shotgun-likes

  const oneClip = w.clipSize >= 60; // huge clips ARE the reserve (chaingun/zapper/beamer/…)
  const maxClip = Math.max(1, w.clipSize || 1);
  const maxAmmo = oneClip ? 0 : maxClip * Math.max(1, w.clipMax);
  const range = Math.round((w.range || 30) * 10); // Raze 2 range unit = 10px
  const [hm = 1, cm = 1, bm = 1] = w.mults ?? [];
  const splash = w.splash > 0;

  // Per-weapon audio: fire from shotSound, reload from the arm-rig silhouette.
  const fireSound = (w.shotSound && SHOT_SOUND[w.shotSound]) || undefined;
  const rig = RELOAD_RIG[w.frameReload] ?? RELOAD_RIG.rifle;

  // Projectile art tint from the trail effect-key (params[0]).
  const projKey = isProj && Array.isArray(w.params) && typeof w.params[0] === "string"
    ? (w.params[0] as string) : undefined;
  const projTint = projKey ? PROJ_TINT[projKey] : undefined;

  const tracer = isProj ? {} : tracerFromParams(w);
  // Muzzle / impact tint: the gun's own authored effect clip first, then the
  // tracer colour for line weapons or the projectile core for projectile ones,
  // so alien and upgrade guns flash in their own colour rather than a generic
  // bullet yellow.
  const muzzleTint = EFFECT_TINT[w.effShoot] ?? (isProj ? projTint?.[0] : tracer.tracerColor);
  const sparkTint = EFFECT_TINT[w.effHit] ?? muzzleTint;

  // `force` is the impulse a round lands with, so pellet guns multiply it up.
  const kick = Math.min(1, (w.force * pellets) / 25);
  const geom = MUZZLE_GEOM[w.id];
  // A puff of barrel smoke only for the guns whose muzzle effect IS smoke —
  // the `gas_*` clips. Energy weapons (purple_fire, green_shot) leave none.
  const smoke = w.effShoot.startsWith("gas_") ? 0.3 + kick * 2 : 0;

  return {
    id: w.id,
    msg: w.name,
    slot: w.type,
    rayType,
    maxClip,
    curAmmo: maxAmmo,
    maxAmmo,
    oneClip: oneClip || undefined,
    autoFire: w.autoFire || undefined,
    projectile: isProj || undefined,
    piercing: piercing || undefined,
    percAmmo: extra.useAmmo != null || undefined,
    multiShot: pellets > 1 ? pellets : undefined,
    maxRange: isMelee ? Math.max(70, range) : range,
    force: w.force,
    recoil: Math.max(2, Math.round(w.recoil * 2)),
    reDuck: 2,
    reJump: 8,
    damage: Math.round(w.dmg * 10), // port HP base ~1000 (×10 of Raze 2's ~100)
    headMult: hm,
    crotchMult: cm,
    buttMult: bm,
    splashMult: splash ? w.splashMult || 0.5 : undefined,
    splashRadius: splash ? w.splash : undefined,
    ...(isProj ? projMotion(w) : {}),
    ...(isProj ? projBehavior(w) : {}),
    ...extraBehavior(extra),
    ...effectsFor(rayType, splash),
    ...tracer,
    ...(muzzleTint != null ? { muzzleColor: muzzleTint } : {}),
    ...(sparkTint != null ? { sparkColor: sparkTint } : {}),
    fireSound,
    reloadSound: rig.sound,
    reloadFrames: rig.frames,
    reloadRig: w.frameReload || "rifle",
    fireDelay: Math.max(1, Math.round((w.shootDelay || 0.2) * 30)),
    ...(projTint ? { projColor: projTint[0], projGlow: projTint[1] } : {}),
    kick,
    muzzleSize: Math.round(7 + kick * 14),
    ...(geom ? { muzzleLen: geom.len, muzzleDy: geom.dy } : {}),
    smoke,
    // `effShell` names the casing clip a gun ejects; empty means it ejects none
    // (every energy weapon in the catalog).
    shell: !!w.effShell,
    AI_minRange: 0,
    AI_maxRange: Math.min(80, Math.round(range / 10)),
    AI_firePerc: w.autoFire ? 0.4 : 0.06,
  };
}

/** Every Raze 2 gun id, in catalog order — the full pickup namespace. */
export const RAZE2_GUN_IDS: string[] = [];
for (const w of RAZE2_WEAPONS) {
  if (w.type > 6) continue;            // 7 = ability/environment-spawned
  WEAPONS[w.id] = raze2ToDef(w);
  RAZE2_GUN_IDS.push(w.id);
}

/** Every playable gun id — same set as RAZE2_GUN_IDS, kept as the pickup namespace. */
export const ALL_GUNS: string[] = [...Object.keys(WEAPONS)];

// ---------------------------------------------------------------------------
// Per-slot weapon catalog (Raze 2: every unit owns one gun per type-slot 0–6,
// doc 03 §6). `SLOT_GUNS[type]` lists the guns available in that slot, base
// (free) gun first — mirroring Stats_Armory.gunsAr[type]. A loadout is a
// per-slot index array (`unit.extra.weapons`, like Raze 2's matchInfo.weapons).
// ---------------------------------------------------------------------------
export const SLOT_GUNS: string[][] = [[], [], [], [], [], [], []];
for (const w of RAZE2_WEAPONS) {
  if (w.type > 6) continue;
  if (WEAPONS[w.id] && !SLOT_GUNS[w.type].includes(w.id)) SLOT_GUNS[w.type].push(w.id);
}

/**
 * Resolve a per-slot loadout (7 gun ids, one per type-slot 0–6) from an
 * optional index array. `weapons[type]` picks which gun in that slot the unit
 * carries; missing/out-of-range falls back to the slot's base (free) gun. This
 * is the starting-arsenal path (doc 03 §6) that lets a unit spawn holding any
 * genuine Raze 2 gun per category.
 */
export function resolveLoadout(weapons?: readonly number[]): string[] {
  const out: string[] = [];
  for (let t = 0; t < SLOT_GUNS.length; t++) {
    const slot = SLOT_GUNS[t];
    if (!slot.length) continue;
    const idx = weapons?.[t] ?? 0;
    out.push(slot[Math.max(0, Math.min(slot.length - 1, idx))] ?? slot[0]);
  }
  return out;
}

/**
 * Default arsenal: menu ordering, hotkeys 1-7, the spawn loadout and the bot
 * gun pool. One gun per armory slot, so the lineup covers every role exactly
 * once — sidearm, SMG, close range, automatic, long range, heavy, explosive —
 * with no two entries competing for the same job. The remaining 29 are
 * reachable by purchase (Armory) and by pickup.
 */
export const GUN_ORDER = [
  "pistol", "uzi", "shotgun", "arifle", "sniper", "chaingun", "rocket",
];

/**
 * Number-row keys in rack order, 1-7. They are positional: key `n` selects the
 * n-th gun the unit is actually carrying, so an armory loadout of three guns
 * binds to 1, 2 and 3 rather than to whatever GUN_ORDER slot they happen to
 * occupy.
 */
export const GUN_KEYS: string[] = [
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7",
];

/** Derive a weapon's raycast type, falling back from its other flags. */
export function resolveRayType(def: WeaponDef): RayType {
  if (def.rayType) return def.rayType;
  if (def.projectile) return "projectile";
  if ((def.multiShot ?? 1) > 1) return "spread";
  if (def.piercing) return "beam";
  return "hitscan";
}

/**
 * Punch factor (0..1) for a weapon: how hard it kicks the aim, shoves the
 * shooter and how big its muzzle flash burns. See `WeaponDef.kick` — it comes
 * from Raze 2's `force`, not `recoil`.
 */
export function kickOf(def: WeaponDef): number {
  return def.kick ?? 0.25;
}

/** Clone a weapon definition into a live, mutable ammo-carrying instance. */
export function makeGun(id: string): WeaponDef & { curClip: number; rayType: RayType } {
  const def = WEAPONS[id] ?? WEAPONS.pistol;
  return {
    ...def,
    rayType: resolveRayType(def),
    curClip: def.maxClip,
    curAmmo: def.curAmmo,
  };
}
