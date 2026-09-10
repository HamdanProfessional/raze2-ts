import { SD } from "../state/SD";

/**
 * Ported from ProfileUnit.as.
 *
 * ProfileUnit in the original was the character-preview MovieClip used by
 * the menu's profile screen. It instantiated a Guns (so the preview
 * rotated through weapons), chose an `idle` animation label based on the
 * player's costume preset (idleRobot for presets 6..10, idleZombie for
 * 16..20, plain idle otherwise), and overlaid the Electricity effect on
 * zombie / robot costumes.
 *
 * NOTE ON NAMING: `getNextPrevCost` is *not* about a credit price — in the
 * original it means "get next/previous COSTume". Raze has no currency system;
 * every costume is free and simply cycles 1..20 with wrap-around. The name is
 * kept because the AS source used it.
 *
 * The costume itself is four independent values on SD.profile:
 *   - prof_head   1..20  → drives SsHead / SsNeck frames
 *   - prof_body   1..20  → drives SsBody / SsUpperArm / SsLowerArm / SsHand
 *   - prof_legs   1..20  → drives SsUpperLeg / SsLowerLeg / SsFoot
 *   - prof_action string → the pose the preview strikes (see PROF_ACTIONS)
 * `prof_preset` is a convenience: picking a preset assigns the same index to
 * all three part slots (ProfileUnit.setAllCostumes), and the player may then
 * override individual parts to mix and match.
 *
 * Helpers below:
 *   - getNextPrevCost(current, dir)  → walk the costume pool (1..20) with wrap.
 *   - getNextPrevAnim(anim, dir)     → walk the pose list, resolving the
 *                                      preset-specific idle variant.
 *   - getAnimText(anim)              → human-readable pose label.
 *   - setAllCostumes(preset)         → apply a preset to head/body/legs.
 *   - costumeForPreset(preset)       → resolve a preset to head/body/legs+pers.
 *   - persForCostume(h, b, l)        → species implied by a mixed costume.
 *   - idleAnimForPreset(preset)      → pick the matching idle animation label.
 *   - hasElectricity(preset)         → whether the Electricity overlay plays.
 *
 * The actual character preview rendering (Guns + idle MovieClip + electricity
 * overlay) is now a Pixi Sprite with the costumed body + weapon-arm
 * overlays, drawn by Unit.drawFigure().
 */

export type IdleAnim = "idle" | "idleRobot" | "idleZombie";

/** Costume index bounds — shared by preset, head, body and legs. */
export const COSTUME_MIN = 1;
export const COSTUME_MAX = 20;

/** The four selectable poses, in the order the original cycled them. */
export const PROF_ACTIONS = ["idle", "run", "runback", "crouch"] as const;
export type ProfAction = (typeof PROF_ACTIONS)[number];

/** Species bands within the 1..20 costume pool. */
export type Pers = "gamer" | "robot" | "alien" | "zombie";

/** Clamp any number into the valid costume range. */
export function clampCostume(v: number): number {
  if (!Number.isFinite(v)) return COSTUME_MIN;
  const i = Math.round(v);
  if (i < COSTUME_MIN) return COSTUME_MIN;
  if (i > COSTUME_MAX) return COSTUME_MAX;
  return i;
}

/** Walk a costume index 1..20, wrapping at the boundary. */
export function getNextPrevCost(current: number, next: boolean): number {
  let p = clampCostume(current) + (next ? 1 : -1);
  if (p > COSTUME_MAX) p = COSTUME_MIN;
  if (p < COSTUME_MIN) p = COSTUME_MAX;
  return p;
}

/** Which species band a single costume index falls into. */
export function persForIndex(index: number): Pers {
  const i = clampCostume(index);
  if (i >= 6 && i <= 10) return "robot";
  if (i >= 11 && i <= 15) return "alien";
  if (i >= 16 && i <= 20) return "zombie";
  return "gamer";
}

/**
 * Resolve a preset 1..20 to its head/body/legs triple.
 *
 * The original's `setAllCostumes` assigned the preset index verbatim to all
 * three slots (they index the same 20-frame costume timeline), so a preset is
 * simply "all three parts matching". Presets 1-5 are human, 6-10 robot,
 * 11-15 alien, 16-20 zombie.
 */
export function costumeForPreset(preset: number): {
  head: number;
  body: number;
  legs: number;
  pers: Pers;
} {
  const p = clampCostume(preset);
  return { head: p, body: p, legs: p, pers: persForIndex(p) };
}

/**
 * Species implied by a mixed costume. Whichever band owns two or more of the
 * three slots wins; a fully mixed costume reports the head's band, since the
 * head is what reads at a glance.
 */
export function persForCostume(head: number, body: number, legs: number): Pers {
  const bands = [persForIndex(head), persForIndex(body), persForIndex(legs)];
  for (const b of bands) {
    if (bands.filter((x) => x === b).length >= 2) return b;
  }
  return bands[0];
}

/** Pick the matching idle animation label for a preset. */
export function idleAnimForPreset(preset: number): IdleAnim {
  const p = clampCostume(preset);
  if (p >= 6 && p <= 10) return "idleRobot";
  if (p >= 16 && p <= 20) return "idleZombie";
  return "idle";
}

/**
 * Walk the pose list. `idleRobot` / `idleZombie` are treated as plain `idle`
 * on the way in, and the returned `idle` is re-specialised for the preset on
 * the way out — matching ProfileUnit.getNextPrevAnim.
 */
export function getNextPrevAnim(
  current: string,
  next: boolean,
  preset: number = SD.profile.prof_preset || 1,
): string {
  const cur = current === "idleRobot" || current === "idleZombie" ? "idle" : current;
  let i = PROF_ACTIONS.indexOf(cur as ProfAction);
  if (i < 0) i = 0;
  i += next ? 1 : -1;
  if (i >= PROF_ACTIONS.length) i = 0;
  if (i < 0) i = PROF_ACTIONS.length - 1;

  const picked = PROF_ACTIONS[i];
  return picked === "idle" ? idleAnimForPreset(preset) : picked;
}

/** Human-readable label for a pose — ported from ProfileUnit.getAnimText. */
export function getAnimText(anim: string): string {
  switch (anim) {
    case "idle":
    case "idleRobot":
    case "idleZombie":
      return "Stand";
    case "run":
      return "Run";
    case "runback":
      return "Run Back";
    case "crouch":
      return "Crouch";
    default:
      return anim;
  }
}

/** The animation clip a pose actually plays (idle variants share `idle` art). */
export function animStateFor(anim: string): "idle" | "run" | "runback" | "crouch" {
  if (anim === "run" || anim === "runback" || anim === "crouch") return anim;
  return "idle";
}

/** Apply a preset index to preset + all three part slots. Ported 1:1. */
export function setAllCostumes(preset: number): void {
  const p = clampCostume(preset);
  SD.profile.prof_preset = p;
  SD.profile.prof_head = p;
  SD.profile.prof_body = p;
  SD.profile.prof_legs = p;
  SD.profile.pers = persForIndex(p);
}

/** Zombie / robot costumes show the Electricity overlay on the preview. */
export function hasElectricity(preset: number): boolean {
  const p = clampCostume(preset);
  return (p >= 6 && p <= 10) || (p >= 16 && p <= 20);
}

/** Push the player's current preset one step forward (or back). */
export function bumpPreset(next: boolean): number {
  const updated = getNextPrevCost(SD.profile.prof_preset || 1, next);
  setAllCostumes(updated);
  SD.save();
  return updated;
}
