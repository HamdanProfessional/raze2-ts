// Verifies the ported Raze 2 character animation against the decompiled source
// (docs/raze2/02-player-rig-skins.md §3, `UnitMC.as`): the goto() guard table,
// the end-of-label frame scripts, and that every label the state machine can
// reach is actually present in the baked skin sheet with the SWF's frame count.

import { UnitAnimator, resolveGoto, type AnimState } from "../src/game/UnitAnim";
import SKIN_ANIM from "../src/assets/raze2/skinAnim.json";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}${detail ? "  — " + detail : ""}`);
  }
}

// --- 1. Frame counts match the SWF FrameLabelTag ranges --------------------
// label -> [startFrame, endFrame] on symbol 441, 1-based inclusive.
const SWF_RANGES: Record<string, [number, number]> = {
  idle: [1, 20],
  run: [21, 41],
  landrun: [42, 55],
  jump: [56, 69],
  fall: [70, 84],
  land: [85, 99],
  tuck: [100, 127],
  runback: [128, 145],
  landrunback: [146, 160],
  duck: [161, 163],
  crouch: [164, 179], // duckloop
  getup: [180, 183],
  armorlock: [184, 230], // Static Field freeze
};

const states = (SKIN_ANIM as any).states as Record<string, { start: number; count: number }>;
for (const [name, [a, b]] of Object.entries(SWF_RANGES)) {
  const want = b - a + 1;
  const got = states[name]?.count;
  check(`bake ${name} has ${want} frames`, got === want, `got ${got}`);
}

// Packed cells must tile the grid without overlapping or leaving holes, and the
// sheet must stay inside the common 4096px max texture size so it loads on
// every GPU.
const packed = Object.values(states).sort((a, b) => a.start - b.start);
let cursor = 0;
let contiguous = true;
for (const s of packed) {
  if (s.start !== cursor) contiguous = false;
  cursor += s.count;
}
check("bake cells pack contiguously", contiguous);
const cols = (SKIN_ANIM as any).cols as number;
const [cw, ch] = (SKIN_ANIM as any).cell as [number, number];
check("sheet is big enough for every cell",
  Math.ceil(cursor / cols) * ch <= (SKIN_ANIM as any).sheet[1] && cols * cw <= (SKIN_ANIM as any).sheet[0]);
const [sw, sh] = (SKIN_ANIM as any).sheet as [number, number];
check(`sheet ${sw}x${sh} within 4096`, sw <= 4096 && sh <= 4096);

// --- 2. goto() guard table (UnitMC.as:136-190) -----------------------------
const BLOCKED: [AnimState, AnimState][] = [
  ["jump", "fall"],
  ["tuck", "fall"],
  ["land", "idle"],
  ["landrun", "run"],
  ["landrunback", "runback"],
  ["crouch", "duck"],
  ["getup", "idle"],
];
for (const [cur, req] of BLOCKED) {
  check(`guard ${cur} -> ${req} is ignored`, resolveGoto(cur, req) === null);
}
// `armorlock` blocks every unforced request (UnitMC.as:145).
for (const req of ["idle", "run", "jump", "crouch", "fall"] as AnimState[]) {
  check(`guard armorlock -> ${req} is ignored`, resolveGoto("armorlock", req) === null);
}
check("guard duck -> idle becomes getup", resolveGoto("duck", "idle") === "getup");
check("guard crouch -> idle becomes getup", resolveGoto("crouch", "idle") === "getup");
check("guard idle -> run is allowed", resolveGoto("idle", "run") === "run");
check("guard same-state is a no-op", resolveGoto("run", "run") === null);

// --- 3. End-of-label frame scripts ----------------------------------------
/** Run `state` to its end and report where the playhead lands. */
function playOut(state: AnimState, extraTicks = 1): { state: AnimState; frame: number } {
  const a = new UnitAnimator();
  a.goto(state, true);
  const count = states[state].count;
  for (let i = 0; i < count - 1 + extraTicks; i++) a.advance(states[a.state].count);
  return { state: a.state, frame: a.frame };
}

// frame69: goto("fall") is rejected by the jump->fall guard, so the playhead
// runs on out of `jump` into the `fall` frames.
check("jump runs on into fall", playOut("jump").state === "fall");
// frame84 / frame127: stop() — hold the last frame indefinitely.
{
  const a = new UnitAnimator();
  a.goto("fall", true);
  for (let i = 0; i < 200; i++) a.advance(states.fall.count);
  check("fall holds its last frame", a.state === "fall" && a.frame === states.fall.count,
    `${a.state}:${a.frame}`);
}
{
  const a = new UnitAnimator();
  a.goto("tuck", true);
  for (let i = 0; i < 200; i++) a.advance(states.tuck.count);
  check("tuck holds its last frame", a.state === "tuck" && a.frame === states.tuck.count,
    `${a.state}:${a.frame}`);
}
{
  const a = new UnitAnimator();
  a.goto("armorlock", true);
  for (let i = 0; i < 200; i++) {
    a.goto("idle"); // movement re-requests its state every tick; the pose must not budge
    a.advance(states.armorlock.count);
  }
  check("armorlock holds until forced out",
    a.state === "armorlock" && a.frame === states.armorlock.count, `${a.state}:${a.frame}`);
  a.goto("idle", true); // the frame-230 end script's forced exit
  check("forced goto leaves armorlock", a.state === "idle", a.state);
}
// frame99 / frame183: goto("idle", true).
check("land returns to idle", playOut("land").state === "idle");
check("getup returns to idle", playOut("getup").state === "idle");
// frame160: goto("runback", true); duck falls through into duckloop.
check("landrunback returns to runback", playOut("landrunback").state === "runback");
check("duck runs on into crouch", playOut("duck").state === "crouch");
// frame54: goto("run", true) fires one frame EARLY (frame 54 of 42-55).
{
  const a = new UnitAnimator();
  a.goto("landrun", true);
  for (let i = 0; i < 12; i++) a.advance(states.landrun.count);
  check("landrun still playing at frame 13", a.state === "landrun" && a.frame === 13,
    `${a.state}:${a.frame}`);
  a.advance(states.landrun.count);
  check("landrun switches to run one frame early", a.state === "run", a.state);
}
// Looping labels replay rather than advancing away.
for (const s of ["idle", "run", "runback", "crouch"] as AnimState[]) {
  const a = new UnitAnimator();
  a.goto(s, true);
  for (let i = 0; i < states[s].count; i++) a.advance(states[s].count);
  check(`${s} loops`, a.state === s && a.frame === 1, `${a.state}:${a.frame}`);
}

// --- 4. The guards actually protect a pose from the per-tick movement state --
// This is the whole point of the table: `Movement` re-requests its state every
// tick, and without the guards a landing would never be visible.
{
  const a = new UnitAnimator();
  a.goto("land", true);
  for (let i = 0; i < 6; i++) {
    a.goto("idle"); // what a standing-still unit asks for every tick
    a.advance(states[a.state].count);
  }
  check("land is not cut short by a per-tick idle request", a.state === "land", a.state);
}
{
  const a = new UnitAnimator();
  a.goto("duck", true);
  for (let i = 0; i < 40; i++) {
    a.goto("duck");
    a.advance(states[a.state].count);
  }
  check("held crouch settles into the duckloop", a.state === "crouch", a.state);
  // Releasing crouch plays getup rather than snapping to idle.
  a.goto("idle");
  check("releasing crouch plays getup", a.state === "getup", a.state);
}

if (failures > 0) {
  console.log(`\n${failures} animation check(s) failed`);
  process.exit(1);
}
console.log("ANIM_OK");
