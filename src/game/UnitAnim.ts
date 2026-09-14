/**
 * The authentic Raze 2 character animation state machine — a port of
 * `UnitMC.goto()` plus the timeline's end-of-label frame scripts
 * (`decompiled_swf/raze 2/scripts/UnitMC.as`, documented in
 * docs/raze2/02-player-rig-skins.md §3).
 *
 * The original is one 230-frame timeline carrying 13 labels, driven by
 * `gotoAndPlay(label)`. Two things give it its feel, and both are reproduced
 * here rather than approximated:
 *
 *  1. **`goto()` refuses some transitions.** A play-once pose (`land`, `getup`,
 *     `landrun`, …) cannot be cut short by the movement code re-requesting the
 *     state it is already heading for, and a crouch exit is *rewritten* into the
 *     `getup` pose instead of snapping to `idle`. Without this table the
 *     landing and crouch animations never actually play — the per-frame
 *     movement state overwrites them on the very next tick.
 *
 *  2. **The playhead runs past a label's end.** `jump`'s end-script calls
 *     `goto("fall")` *unforced*, which its own `jump → fall` guard then
 *     rejects — so the clip simply keeps playing forward out of `jump` (56-69)
 *     into `fall` (70-84) and stops there. Modelling that as a forced switch to
 *     `fall` is behaviourally identical (every later request resolves the same
 *     way) and is what {@link END} encodes.
 *
 * `armorlock` (frames 184-230) is not modelled: no ability the port implements
 * uses that pose, and it is not in the baked sheet.
 */

/** The 13 modelled UnitMC labels. `crouch` is the SWF's `duckloop`. */
export type AnimState =
  | "idle"
  | "run"
  | "landrun"
  | "jump"
  | "fall"
  | "land"
  | "tuck"
  | "runback"
  | "landrunback"
  | "duck"
  | "crouch"
  | "getup"
  | "armorlock";

/**
 * What happens when a label reaches its end, from the `addFrameScript`
 * registrations in the `UnitMC` constructor:
 *
 *  - `loop`   — `goto(self, true)`, replay from frame 1.
 *  - `hold`   — `stop()`, freeze on the last frame until something else is
 *               requested (`fall` and `tuck` both do this).
 *  - a state  — switch to it.
 *
 * `at` is the 1-based frame the script sits on when that is not the label's
 * last frame: `landrun`'s runs on frame 54 of 42-55, i.e. the 13th of 14.
 */
interface EndSpec {
  kind: "loop" | "hold" | "goto";
  to?: AnimState;
  at?: number;
}

const END: Record<AnimState, EndSpec> = {
  idle: { kind: "loop" },
  run: { kind: "loop" },
  // frame54: goto("run", true) — fires one frame early.
  landrun: { kind: "goto", to: "run", at: 13 },
  // frame69: goto("fall") is self-blocked, so the playhead runs on into `fall`.
  jump: { kind: "goto", to: "fall" },
  fall: { kind: "hold" },
  land: { kind: "goto", to: "idle" },
  tuck: { kind: "hold" },
  runback: { kind: "loop" },
  landrunback: { kind: "goto", to: "runback" },
  // `duck` (161-163) carries no script — it runs straight on into `duckloop`.
  duck: { kind: "goto", to: "crouch" },
  crouch: { kind: "loop" },
  getup: { kind: "goto", to: "idle" },
  // frame230: abilityDone(); goto("idle", true). The lock ends on the tick
  // `Unit.abilityLock` hits 0, which forces the exit (see Unit.updateSprites).
  armorlock: { kind: "hold" },
};

/**
 * `UnitMC.goto()`'s rejection table. Returns the state to actually play, or
 * `null` to ignore the request. Exported for the unit test.
 */
export function resolveGoto(cur: AnimState, req: AnimState): AnimState | null {
  if (cur === req) return null;
  // `UnitMC.goto()`: once armorlocked, every unforced request is ignored — the
  // pose can only be left by the end-script's forced `goto("idle", true)`.
  if (cur === "armorlock") return null;
  // Play-once poses that the movement state must not cut short.
  if (cur === "jump" && req === "fall") return null;
  if (cur === "tuck" && req === "fall") return null;
  if (cur === "land" && req === "idle") return null;
  if (cur === "landrun" && req === "run") return null;
  if (cur === "landrunback" && req === "runback") return null;
  if (cur === "crouch" && req === "duck") return null;
  if (cur === "getup" && req === "idle") return null;
  // Leaving a crouch plays the stand-up pose instead of snapping to idle.
  if ((cur === "duck" || cur === "crouch") && req === "idle") return "getup";
  return req;
}

/**
 * Playhead for one character. `state`/`frame` (1-based) are what the renderer
 * should draw; `frameCount` is supplied by the caller because it comes from
 * whichever art set is in use.
 */
export class UnitAnimator {
  state: AnimState = "idle";
  /** 1-based frame within `state`. */
  frame = 1;
  /** True once a `hold` label has parked on its last frame. */
  private held = false;

  /** Mirrors `UnitMC.goto(anim, force)`. Returns true if the state changed. */
  goto(req: AnimState, force = false): boolean {
    let next: AnimState | null = req;
    if (!force) {
      next = resolveGoto(this.state, req);
      if (next === null) return false;
      if (next === this.state) return false;
    }
    this.state = next;
    this.frame = 1;
    this.held = false;
    return true;
  }

  /**
   * Advance one 30fps tick. `count` is the current state's frame count; pass
   * the count for whichever art set is rendering.
   */
  advance(count: number): void {
    if (this.held || count <= 0) return;
    const spec = END[this.state];
    const last = Math.min(spec.at ?? count, count);
    if (this.frame < last) {
      this.frame++;
      return;
    }
    switch (spec.kind) {
      case "loop":
        this.frame = 1;
        break;
      case "hold":
        this.held = true;
        break;
      case "goto":
        this.goto(spec.to!, true);
        break;
    }
  }

  /** True while a play-once pose still owes frames (used to gate the tuck spin). */
  get busy(): boolean {
    return !this.held && END[this.state].kind !== "loop";
  }
}
