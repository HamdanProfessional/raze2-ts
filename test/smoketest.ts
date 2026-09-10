// Headless gameplay smoke test. Bundled with pixi.js aliased to a stub so the
// real game logic + planck physics run without a browser.

// --- minimal browser globals the state layer touches --------------------
(globalThis as any).localStorage = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] ?? null; },
  setItem(k: string, v: string) { this.store[k] = v; },
  removeItem(k: string) { delete this.store[k]; },
};
(globalThis as any).window = { open() {}, addEventListener() {}, devicePixelRatio: 1 };

import { SD } from "../src/state/SD";
import { Quality, QUALITY_LEVELS } from "../src/state/Quality";
import { GameScreen } from "../src/game/GameScreen";
import { getCamp } from "../src/game/Campaign";
import { ARM_SCALE } from "../src/game/Unit";
import { Arena, LEVELS } from "../src/game/Arena";
import { Input } from "../src/core/Input";
import { GAME_WIDTH, GAME_HEIGHT, PTM } from "../src/core/Config";
import { Vec2 } from "planck";
import { Sound, DEFAULT_RANGE } from "../src/audio/Sounds";
import { activateAbility, getAbility } from "../src/game/Abilities";

const fakeEngine: any = { app: {}, root: { addChild() {} }, overlay: {} };

SD.init();
const g = new GameScreen(fakeEngine, undefined);

// Run through the intro so gameStarted flips.
for (let i = 0; i < 40; i++) g.enterFrame(1);
if (!g.gameStarted) throw new Error("game never started");

const ai: any = g.units.find((u) => u.ai);
const beforeActors = g.rdPhys.actors.length;

// Force a headshot kill on an AI.
ai.status.doDamage(999999, { x: 1, y: -0.5, attacker: g.player, headShot: true });
if (!ai.status.dead) throw new Error("AI did not die from lethal damage");
const ragdollSpawned = g.rdPhys.actors.length > beforeActors;

// Let the ragdoll settle and the AI respawn.
for (let i = 0; i < 200; i++) g.enterFrame(1);

console.log("gameStarted:", g.gameStarted);
console.log("units:", g.units.length);
console.log("player alive:", !g.player.status.dead);
console.log("ragdoll spawned on death:", ragdollSpawned);
console.log("AI respawned (alive again):", !ai.status.dead);
console.log("player kills after kill:", g.player.score.kills);
console.log("ragdoll actors now:", g.rdPhys.actors.length);

// --- weapon feel: recoil / muzzle flash / smoke / knockback --------------

const shooter: any = g.player;
// Pin the aim dead ahead to the right; the AI roams, so anything derived from
// live positions would make these assertions flaky.
//
// The AI also shoots back, and a dead unit is skipped entirely by the game
// loop — its weapon never ticks, so recoil and knockback would be stranded
// mid-decay. Worse, the human only ever leaves the ground on a respawn
// *click*, which never arrives headlessly, so one unlucky death upstream
// would strand these assertions for the rest of the run (~1 in 6).
//
// So: put the shooter back on its feet if it went down, and make it
// invulnerable for the duration. The hit-feedback section below clears the
// invulnerability again, because that one wants damage to land.
const aimRight = () => {
  if (shooter.status.dead) shooter.respawn();
  shooter.status.invinTimer = 99999;
  shooter.facing = 1;
  shooter.aimRotation = 0;
  shooter.knockVel = 0;
  (shooter.gun as any).cooldown = 0;
  shooter.gun.reloading = false;
};
aimRight();
shooter.gun.selectGun("shotgun");
const fxBefore = (g as any).fx.length;
shooter.gun.startShoot();
shooter.gun.endShoot();

if (shooter.gun.recoilAmount <= 0) throw new Error("recoilAmount not raised on fire");
// Recoil in Raze 2 opens the cone, it does NOT bend the aim: `Guns.as:456-462`
// randomises inside `rand(-dynRecoil, dynRecoilMod)` around the true aim, and
// `Unit.as:1123` rotates the arm by `rotReload + rotArm` with no recoil term.
// So after firing the barrel must still point exactly where the shot went —
// the visible kick is the weapon's `_fire` animation band, not a transform.
if (shooter.gun.lookAngle !== shooter.aimRotation) {
  throw new Error(
    `recoil bent the aim: look=${shooter.gun.lookAngle} aim=${shooter.aimRotation}`,
  );
}
const shotgunHeat = shooter.gun.recoilAmount;
// Authentic Raze 2 applies NO knockback to living units (doc 01) — the port's
// invented shooter-shove is neutralized behind Unit.LIVE_KNOCKBACK, so firing
// must NOT move the shooter. Recoil is cone-widening only (asserted above).
if (shooter.knockVel !== 0) throw new Error("live-unit knockback should stay neutralized (authentic Raze 2)");
if ((g as any).fx.length <= fxBefore) throw new Error("firing spawned no muzzle/impact effects");

// Both recover on their own inside ~0.2s (6 ticks) without further input.
for (let i = 0; i < 8; i++) g.enterFrame(1);
if (shooter.gun.recoilAmount > shotgunHeat * 0.1) {
  throw new Error(`recoil: dead=${shooter.status.dead} invin=${shooter.status.invinTimer} clip=${shooter.gun.curGun.curClip} reload=${shooter.gun.reloading} gunId=${shooter.gun.curGun.id} heat=${shooter.gun.recoilAmount} peak=${shotgunHeat}`);
}
if (shooter.gun.lookAngle !== shooter.aimRotation) throw new Error("aim drifted while the cone settled");
if (shooter.knockVel !== 0) throw new Error("knockback did not decay to rest");

// A light weapon must not shove the shooter at all.
aimRight();
shooter.gun.selectGun("pistol");
shooter.gun.recoilAmount = 0;
shooter.gun.startShoot();
shooter.gun.endShoot();
if (shooter.knockVel !== 0) throw new Error("pistol should not knock the shooter back");
const pistolHeat = shooter.gun.recoilAmount;
if (pistolHeat <= 0) throw new Error("pistol produced no recoil at all");
if (pistolHeat >= shotgunHeat) throw new Error("pistol recoil should be lighter than the shotgun's");
console.log(
  "recoil: pistol heat", pistolHeat.toFixed(2),
  "vs shotgun", shotgunHeat.toFixed(2), "(cone width, not aim bias)",
);

// --- shot origin: shots leave the barrel tip, not the body centre ---------

aimRight();
shooter.gun.selectGun("sniper");
shooter.gun.recoilAmount = 0;
{
  const shoulder = shooter.getShoulder();
  // The shoulder must sit at the documented pivot (SHOULDER_Y = -92 native px),
  // not at the old hardcoded -58 the muzzle used to be pinned to. The exact
  // pivot is the arm rig's per-frame value (idle frame 1 is -91.85, and it
  // breathes by a few tenths across the cycle), so allow a 1px native band —
  // still 30+px clear of the -58 regression this guards against.
  //
  // Asserted in the body art's NATIVE px (divide out the render scale) rather
  // than against `shooter.scale`. The two are deliberately different numbers:
  // `scale` is the physics footprint, `bodyScale()` is how big the art is drawn
  // (see UNIT_SCALE vs RIG_ART_SCALE). Fixing the expectation in native px
  // keeps this guard honest if either render scale is retuned again.
  const nativeY = (shoulder.y - shooter.y) / (shooter as any).bodyScale();
  if (Math.abs(nativeY - -92) > 1) {
    throw new Error(`shoulder pivot at ${nativeY} native px, expected -92`);
  }

  // Aiming flat right, the muzzle is muzzleLen ahead at the same height.
  // muzzleLen is arm-art px, so it rides ARM_SCALE — the same basis getMuzzle
  // and updateSprites use.
  const len = shooter.gun.curGun.muzzleLen * ARM_SCALE;
  // `muzzleDy` is the barrel's perpendicular offset from the shoulder line (a
  // sniper's bore sits above the grip), signed by facing. It rides ARM_SCALE
  // too, and it rotates with the aim rather than staying a fixed screen offset.
  const dy = (shooter.gun.curGun.muzzleDy ?? 0) * ARM_SCALE * shooter.facing;
  const flat = shooter.getMuzzle(0);
  if (Math.abs(flat.y - (shoulder.y + dy)) > 0.001) {
    throw new Error(
      `flat shot's muzzle ${flat.y - shoulder.y}px off the shoulder, expected the ${dy}px bore offset`,
    );
  }
  if (Math.abs(flat.x - (shoulder.x + len)) > 0.001) {
    throw new Error(`muzzle ${flat.x - shoulder.x}px ahead of the shoulder, expected ${len}`);
  }
  if (len < 10) throw new Error("sniper barrel length not applied at all");

  // Straight down: the barrel must swing with the arm, not stay ahead of it —
  // and the bore offset must swing with it, moving from y onto x.
  const down = shooter.getMuzzle(90);
  if (Math.abs(down.x - (shoulder.x - dy)) > 0.001) {
    throw new Error("muzzle did not rotate with the aim angle");
  }
  if (down.y - shoulder.y < len - 0.001) {
    throw new Error("muzzle did not extend down the barrel when aiming down");
  }

  // Every shot leaves from that same point: the flash, the ray and the tracer
  // all resolve through Unit.getMuzzle, so they cannot drift apart.
  const tip = (shooter.gun as any).muzzleTip(0);
  if (Math.abs(tip.x - flat.x) > 0.001 || Math.abs(tip.y - flat.y) > 0.001) {
    throw new Error("muzzle flash tip and shot origin disagree");
  }
  console.log("muzzle: barrel tip", len.toFixed(1), "px off the shoulder pivot, rotates with aim");
}

// --- camera: leads toward the cursor, eases at 0.7, clamps to the level ----
// Ported from `Arena.EnterFrame` (`Arena.as:1063-1171`). The lead is the part
// that makes it feel like Raze rather than a generic follow-cam, so it is what
// this guards hardest.
{
  const ga: any = g;
  const settle = (n = 20) => { for (let i = 0; i < n; i++) g.enterFrame(1); };

  shooter.status.dead = false;
  shooter.status.invinTimer = 99999;
  // Park the player somewhere with room on both sides, so neither the left nor
  // the right clamp is what we end up measuring.
  shooter.x = ga.arena.worldW / 2;
  shooter.y = ga.arena.worldH / 2;

  Input.mouseX = GAME_WIDTH / 2;
  Input.mouseY = GAME_HEIGHT / 2;
  settle();
  const centred = ga.arena.view.x;

  // Cursor hard right: the view leads right, which moves the arena container
  // LEFT (more negative). Half the cursor's offset from centre, per CAM_INTENSE.
  Input.mouseX = GAME_WIDTH;
  settle();
  const lookRight = ga.arena.view.x;
  Input.mouseX = 0;
  settle();
  const lookLeft = ga.arena.view.x;

  if (!(lookRight < centred && centred < lookLeft)) {
    throw new Error(
      `camera does not lead toward the cursor (left=${lookLeft} centre=${centred} right=${lookRight})`,
    );
  }
  // Full sweep is the whole viewport width times the lead share, ±rounding.
  const sweep = lookLeft - lookRight;
  const expectSweep = GAME_WIDTH * 0.5;
  if (Math.abs(sweep - expectSweep) > 2) {
    throw new Error(`camera lead swept ${sweep}px, expected ~${expectSweep}`);
  }

  // Ease: one tick covers ~70% of the remaining distance, not all of it and not
  // the old 12%. Measured as the fraction of the gap closed by a single tick.
  Input.mouseX = GAME_WIDTH / 2;
  settle();
  const before = ga.arena.view.x;
  Input.mouseX = GAME_WIDTH;
  g.enterFrame(1);
  const afterOne = ga.arena.view.x;
  const closed = (afterOne - before) / (lookRight - before);
  if (closed < 0.6 || closed > 0.8) {
    throw new Error(`camera ease closed ${(closed * 100).toFixed(0)}% in one tick, expected ~70%`);
  }

  // Clamps: shoved hard into a corner, the view stops at the level edge rather
  // than sailing past it.
  shooter.x = 0;
  shooter.y = 0;
  Input.mouseX = 0;
  Input.mouseY = 0;
  settle(40);
  if (ga.arena.view.x > 0) throw new Error(`camera ran past the left edge (${ga.arena.view.x})`);
  if (ga.arena.view.y > 5) throw new Error(`camera ran past the top edge (${ga.arena.view.y})`);

  // Dead: the camera rides the corpse instead of freezing where they fell.
  shooter.x = ga.arena.worldW / 2;
  shooter.y = ga.arena.worldH / 2;
  Input.mouseX = GAME_WIDTH / 2;
  Input.mouseY = GAME_HEIGHT / 2;
  settle();
  const aliveAt = ga.arena.view.y;
  shooter.status.invinTimer = 0;
  shooter.status.doDamage(99999, { x: 0, y: 0 });
  if (!shooter.status.dead) throw new Error("camera test: shooter would not die");
  const corpse = ga.rdPhys.actors.find((a: any) => a.unit === shooter);
  if (!corpse) throw new Error("camera test: no ragdoll to follow");
  // Drop the corpse well below where the player stood and let the camera chase.
  corpse.part_body.setPosition(new Vec2(ga.arena.worldW / 2 / PTM, (ga.arena.worldH / 2 + 260) / PTM));
  settle(40);
  if (ga.arena.view.y >= aliveAt) {
    throw new Error(`camera did not follow the corpse down (${ga.arena.view.y} vs ${aliveAt})`);
  }
  shooter.respawn();
  console.log(
    `camera: leads ${sweep.toFixed(0)}px cursor-to-cursor, ` +
    `eases ${(closed * 100).toFixed(0)}%/tick, clamps to the level, follows the corpse`,
  );
}

// --- hit feedback: stagger on heavy hits, red flash for the player --------

{
  // Drop every form of invulnerability the shooter is carrying: the test-only
  // one from the section above, and the 30-frame spawn protection a respawn up
  // there may have granted (no frames run in between to decay it). This block
  // is specifically about damage landing.
  shooter.status.invinTimer = 0;
  shooter.status.invuln = 0;

  const victim: any = g.units.find((u) => u.ai && !u.status.dead);
  // A bot that respawned during the frames above still carries its 30-frame
  // spawn protection, which would silently swallow the test's damage — and one
  // worn down by AI crossfire would be *killed* by the test blow instead of
  // staggered (a lethal hit skips hitFeedback entirely). Pin it to full.
  victim.status.invuln = 0;
  victim.status.invinTimer = 0;
  victim.status.hpCur = victim.status.hpMax;
  victim.status.shCur = 0;
  victim.hitStun = 0;
  // Authentic Raze 2 has NO live-unit stagger (doc 01 §8) — the port's invented
  // hit-stun is neutralized behind the same `Unit.LIVE_KNOCKBACK` flag as the
  // shooter-shove asserted above, so `applyHitStun` is a no-op. Damage must
  // land without ever taking control away from the target.
  const hpBefore = victim.status.hpCur;
  victim.status.doDamage(victim.status.hpMax * 0.25, { x: 1, y: 0, attacker: g.player });
  if (victim.status.hpCur >= hpBefore) throw new Error("a heavy hit did no damage");
  if (victim.hitStun !== 0) throw new Error("live-unit stagger should stay neutralized (authentic Raze 2)");

  // The player taking damage raises the on-screen red vignette. Topped up
  // first: a blow that *kills* skips hitFeedback altogether, and a player worn
  // down by AI fire would die to this one instead of flinching.
  g.player.status.hpCur = g.player.status.hpMax;
  g.player.status.shCur = 0;
  (g as any).hitFlash = 0;
  g.player.status.doDamage(g.player.status.hpMax * 0.1, { x: -1, y: 0 });
  if ((g as any).hitFlash <= 0) throw new Error("player damage did not raise the hit indicator");

  // Watching it fade needs the player untouchable — incoming AI fire would
  // otherwise keep re-arming the vignette for as long as we watch.
  g.player.status.invinTimer = 99999;
  for (let i = 0; i < 30; i++) g.enterFrame(1);
  if ((g as any).hitFlash > 0) throw new Error("hit indicator never cleared");
  g.player.status.invinTimer = 0;
  console.log("hit feedback: damage lands without stagger, player vignette raises and clears");
}

// --- graphics settings: quality / glow / screenshot mode -----------------

// Cycling walks the four levels and wraps.
const seen: string[] = [];
for (let i = 0; i < QUALITY_LEVELS.length; i++) seen.push(SD.cycleQuality());
if (SD.qual !== "high") throw new Error("quality cycle did not wrap back around");
if (Quality.level !== SD.qual) throw new Error("Quality did not follow SD.qual");

// Low must actually thin things out and force glow off.
SD.setQuality("low");
if (Quality.glow) throw new Error("Low quality should disable glow");
if (Quality.particleScale >= 1) throw new Error("Low quality should thin particles");
if (Quality.count(10) >= 10) throw new Error("particle counts not scaled at Low");

// Max must be the densest step.
SD.setQuality("max");
if (Quality.count(10) <= 10) throw new Error("Max quality should fatten bursts");

// The effect cap keeps concurrent effects (and their draw calls) bounded.
SD.setQuality("low");
for (let i = 0; i < 200; i++) g.addEffect(100, 100, "bullet");
const liveFx = (g as any).fx.length;
const fxCap = Quality.maxFx;
if (liveFx > fxCap) throw new Error(`effect cap breached: ${liveFx} > ${fxCap}`);

// Glow toggle is independent of level and applies live.
SD.setQuality("high");
SD.setNoGlow(true);
if (Quality.glow) throw new Error("noGlow did not disable glow");
SD.setNoGlow(false);
if (!Quality.glow) throw new Error("clearing noGlow did not restore glow");

// Persistence: save, wipe the in-memory values, reload.
SD.setQuality("medium");
SD.setNoGlow(true);
SD.qual = "max";
SD.noGlow = false;
SD.load();
if (SD.qual !== "medium" || SD.menuQual !== QUALITY_LEVELS.indexOf("medium")) {
  throw new Error(`quality did not persist (got ${SD.qual}/${SD.menuQual})`);
}
if (!SD.noGlow) throw new Error("noGlow did not persist");
if (Quality.level !== "medium" || Quality.glow) throw new Error("load() did not re-apply Quality");
SD.setNoGlow(false);

// Screenshot mode hides all chrome and restores it.
const hudView: any = (g.hud as any).view;
const nameBox: any = (g.player as any).nameBox;
SD.setSSmode(true);
if (!SD.ssMode || hudView.visible || nameBox.visible) {
  throw new Error("ssMode did not hide HUD chrome");
}
g.enterFrame(1); // gameplay keeps running while hidden
SD.setSSmode(false);
if (SD.ssMode || !hudView.visible || !nameBox.visible) {
  throw new Error("ssMode did not restore HUD chrome");
}

// --- profile reset: clears stats + medals, keeps profile & progression ---

SD.stats.kills = 42;
SD.stats.deaths = 7;
SD.stats.shots = 300;
SD.medals["headshot"] = true;
SD.profile.name = "Tester";
SD.profile.prof_preset = 9;
SD.curStage = 12;
SD.save();

SD.resetStats();
if (SD.stats.kills !== 0 || SD.stats.deaths !== 0 || SD.stats.shots !== 0) {
  throw new Error("resetStats did not clear combat stats");
}
if (Object.keys(SD.medals).length !== 0) throw new Error("resetStats did not clear medals");
if (SD.profile.name !== "Tester" || SD.profile.prof_preset !== 9) {
  throw new Error("resetStats wrongly cleared the profile");
}
if (SD.curStage !== 12) throw new Error("resetStats wrongly cleared campaign progress");

// And it must persist, not just clear the in-memory copy.
SD.stats.kills = 99;
SD.load();
if (SD.stats.kills !== 0 || Object.keys(SD.medals).length !== 0) {
  throw new Error("resetStats did not persist");
}
if (SD.curStage !== 12) throw new Error("campaign progress lost across reload");
console.log("resetStats cleared stats/medals, kept profile + stage", SD.curStage);

// --- HUD: zones build and drive in every match mode ----------------------

// The HUD branches hard on the match type (team score panel, lives objective,
// team-tinted scoreboard), and each zone is only exercised by the state that
// turns it on. Build one match per mode and drive every one of them.
for (const type of ["dm", "tdm", "elim", "telim"]) {
  SD.matchSettings = { type, opponents: 3, level: "city", score: 10, diff: 1 } as any;
  const gm = new GameScreen(fakeEngine, undefined);
  const hud: any = gm.hud;
  const teamMode = type === "tdm" || type === "telim";
  if (hud.teamMode !== teamMode) throw new Error(`${type}: team panel state wrong`);

  for (let i = 0; i < 40; i++) gm.enterFrame(1); // through the warm-up
  if (!gm.gameStarted) throw new Error(`${type}: never started`);

  // Kill feed caps at 13 rows (doc 14 §1.6, `Hud.as:780`) however many kills
  // land at once. Push well past the cap so this fails if it stops trimming.
  const KF_CAP = 13;
  for (let k = 1; k <= KF_CAP + 8; k++) {
    hud.addKillMessage("Alpha", "railgun", "Bravo", k % 3 === 0, {
      killerTeam: 1, victimTeam: 2, killerIsPlayer: k % 2 === 0,
    });
  }
  if (hud.killFeed.length !== KF_CAP) throw new Error(`${type}: kill feed not capped (${hud.killFeed.length})`);

  // Streak ladder announces once per tier, never twice for the same run.
  hud.resetStreak("Alpha");
  let tiers = 0;
  const realAnnounce = hud.announce.bind(hud);
  hud.announce = (...a: unknown[]) => { tiers++; realAnnounce(...a); };
  for (let k = 1; k <= 15; k++) hud.announceStreak("Alpha", k);
  for (let k = 1; k <= 15; k++) hud.announceStreak("Alpha", k); // replay: inert
  hud.announce = realAnnounce;
  if (tiers !== 5) throw new Error(`${type}: streak ladder fired ${tiers} times, expected 5`);

  // Directional damage merges same-bearing hits and caps the wedge count.
  hud.damage.clear();
  for (let a = 0; a < 12; a++) hud.showDamageFrom((a / 12) * Math.PI * 2, 0.6);
  if (hud.damage.hits.length > 4) throw new Error(`${type}: damage wedges uncapped`);
  if (!hud.damage.hits.length) throw new Error(`${type}: no damage wedge raised`);

  // Taking a real hit from a known attacker must raise a bearing, not just
  // the flat vignette.
  hud.damage.clear();
  const foe: any = gm.units.find((u) => u.ai && !u.status.dead);
  gm.player.status.doDamage(gm.player.status.hpMax * 0.1, { x: 1, y: 0, attacker: foe });
  if (!hud.damage.hits.length) throw new Error(`${type}: attacker gave no damage bearing`);

  // Tab scoreboard grows a row per unit and closes again.
  SD.scores = true;
  gm.enterFrame(1);
  if (!hud.scoreOverlay.visible) throw new Error(`${type}: scoreboard did not open`);
  if (hud.scoreOverlayRows.length !== gm.units.length) {
    throw new Error(`${type}: ${hud.scoreOverlayRows.length} rows for ${gm.units.length} units`);
  }
  SD.scores = false;
  gm.enterFrame(1);
  if (hud.scoreOverlay.visible) throw new Error(`${type}: scoreboard did not close`);

  // Weapon panel: empty clip, reload, and a charge weapon all render.
  const pl: any = gm.player;
  pl.gun.selectGun("shotgun");
  pl.gun.curGun.curClip = 0;
  pl.gun.curGun.curAmmo = 0;
  gm.enterFrame(1);
  pl.gun.curGun.curClip = 2;
  pl.gun.reloading = true;
  pl.gun.reloadProgress = 0.5;
  gm.enterFrame(1);
  pl.gun.reloading = false;
  pl.gun.selectGun("plasma");
  gm.enterFrame(1);

  // Down-and-waiting drives the respawn prompt; elim modes also hit the
  // "eliminated" branch once the lives are gone.
  pl.status.dead = true;
  for (let i = 0; i < 70; i++) { pl.respawnTimer(); gm.enterFrame(1); }
  pl.status.dead = false;

  // Glow is what the Low profile actually turns off on this screen.
  SD.setQuality("low");
  gm.enterFrame(1);
  if (Quality.glow) throw new Error(`${type}: Low profile should force glow off`);
  SD.setQuality("high");
  gm.enterFrame(1);

  // Screenshot mode takes the damage indicator down with everything else.
  hud.showDamageFrom(0, 1);
  SD.setSSmode(true);
  if (hud.damage.hits.length !== 0) throw new Error(`${type}: wedges survived ssMode`);
  gm.enterFrame(1);
  SD.setSSmode(false);

  hud.setResult(true);
  hud.setResult(false);
  for (let i = 0; i < 60; i++) gm.enterFrame(1);
  gm.destructor();
}
console.log("HUD: zones, kill feed, streaks, damage bearings and scoreboard ok in dm/tdm/elim/telim");

console.log("quality cycle:", seen.join(" -> "));
console.log("effects capped at:", liveFx, "with Low cap", fxCap);
console.log("quality/glow persisted across load()");
console.log("ssMode hide + restore ok");

// --- campaign story dialogue ---------------------------------------------
// The mission script's lines have to arrive one at a time, in script order,
// and stay up for the duration the script asked for. They used to be queued by
// their *display duration* (4-8) compared against a frame counter, so every
// line in the mission fired inside the first quarter-second.
{
  const entry = getCamp(2)!; // Survivor Lookout: 9 lines, 2 of them radio calls
  const prevSettings = SD.matchSettings;
  SD.matchSettings = {
    ...entry.settings,
    diff: 1,
    opponents: entry.ai.length,
    team: entry.settings.team ? 1 : 0,
  } as any;
  const gm = new GameScreen(fakeEngine, undefined);
  const hud: any = gm.hud;
  const spoken: string[] = [];
  const realCampMsg = hud.setCampMsg.bind(hud);
  hud.setCampMsg = (portrait: any, speaker: any, text: string, secs: number) => {
    spoken.push(text);
    realCampMsg(portrait, speaker, text, secs);
  };

  for (let i = 0; i < 40; i++) gm.enterFrame(1); // through the warm-up
  if (spoken.length !== 0) throw new Error(`dialogue jumped the briefing (${spoken.length} lines)`);

  for (let i = 0; i < 15 * 30; i++) gm.enterFrame(1); // fifteen seconds of match
  if (!spoken.length) throw new Error("no dialogue after fifteen seconds");
  if (spoken.length === entry.messages.length) throw new Error("whole script dumped at kickoff");

  for (let i = 0; i < 300 * 30; i++) gm.enterFrame(1);
  if (spoken.length !== entry.messages.length) {
    throw new Error(`spoke ${spoken.length} of ${entry.messages.length} lines`);
  }
  const scripted = entry.messages.map((m) => m.text.replace(/\{player\}/gi, SD.profile.name));
  if (spoken.join("|") !== scripted.join("|")) throw new Error("dialogue played out of script order");

  // A radio line resolves its portrait + speaker from the extracted skin/name
  // pair; a line tagged with a roster slot takes them from that bot.
  const radio = entry.messages.find((m) => m.unit === null)!;
  if (radio.speaker !== "Dani" || radio.portrait !== "girl") {
    throw new Error(`radio line lost its speaker: ${radio.speaker}/${radio.portrait}`);
  }
  const bot = entry.messages.find((m) => m.unit === 1)!;
  if (bot.speaker !== entry.ai[0].name) throw new Error(`unit line named ${bot.speaker}`);

  hud.setCampMsg = realCampMsg;
  gm.destructor();
  SD.matchSettings = prevSettings; // later sections build off whatever is current
  console.log(`campaign dialogue: ${spoken.length} lines paced in script order with portraits`);
}

// --- spatial audio -------------------------------------------------------
// Sound.spatial() is pure maths, so it runs headless even though nothing can
// actually be played without an AudioContext. This guards the property the
// whole feature rests on: a sound's volume and pan depend on where it is
// relative to the listener, not on a fixed point in the arena.
{
  Sound.setListener(1000, 500);

  const here = Sound.spatial(1000, 500)!;
  if (!here || here.volume < 0.99) throw new Error("audio: sound at the listener isn't full volume");
  if (Math.abs(here.pan) > 0.01) throw new Error("audio: sound at the listener isn't centred");

  const near = Sound.spatial(1300, 500)!;
  const far = Sound.spatial(1800, 500)!;
  if (!near || !far) throw new Error("audio: in-range sound was culled");
  if (!(near.volume > far.volume)) throw new Error("audio: no distance attenuation");
  if (!(near.pan > 0.2)) throw new Error("audio: source on the right didn't pan right");
  if (!(Sound.spatial(700, 500)!.pan < -0.2)) throw new Error("audio: source on the left didn't pan left");

  // Out of earshot returns null so the caller skips the clip entirely.
  if (Sound.spatial(1000 + DEFAULT_RANGE + 10, 500) !== null) {
    throw new Error("audio: out-of-range sound was not culled");
  }
  // Per-call ranges override the default (footsteps carry less than a rocket).
  if (Sound.spatial(1400, 500, 300) !== null) {
    throw new Error("audio: short-range sound was not culled");
  }

  // The listener moving must change what you hear — the bug this fixes was a
  // listener welded to the arena centre.
  const before = Sound.spatial(1800, 500)!;
  Sound.setListener(1800, 500);
  const after = Sound.spatial(1800, 500)!;
  if (!(after.volume > before.volume)) throw new Error("audio: listener position ignored");

  console.log(
    `spatial audio: falloff ${near.volume.toFixed(2)} -> ${far.volume.toFixed(2)}, ` +
    `pan ${near.pan.toFixed(2)} right, culled beyond range, tracks the listener`,
  );
}

// --- debug hitbox overlay (M) --------------------------------------------
// The overlay reads real collision state (unit AABBs, arena walls, pickup
// touch boxes, planck fixtures), so a headless pass is enough to catch a
// shape-walk that throws or silently draws nothing.
{
  const { Input } = await import("../src/core/Input");
  // A fresh match: `g` has long since ended, and screenshot mode is refused
  // once the result banner is up.
  SD.setQuality("high");
  const gm: any = new GameScreen(fakeEngine, undefined);
  for (let i = 0; i < 40; i++) gm.enterFrame(1);

  // Off by default, and drawing while off must not light the readout.
  gm.enterFrame(1);
  if (gm.hitboxLabel.visible) throw new Error("hitboxes: readout shown while off");

  // A fresh corpse guarantees ragdoll fixtures are in the traced set.
  const victim: any = gm.units.find((u: any) => u.ai && !u.status.dead);
  victim?.status.doDamage(999999, { x: 1, y: -0.5, attacker: gm.player });
  if (gm.rdPhys.actors.length === 0) throw new Error("hitboxes: no ragdoll to trace");

  Input.showHitboxes = true;
  gm.enterFrame(1);
  const label: string = gm.hitboxLabel.text;
  if (!gm.hitboxLabel.visible) throw new Error("hitboxes: readout hidden while on");
  const counts = /units (\d+)\s+walls (\d+)\s+pickups (\d+)\s+bodies (\d+)/.exec(label);
  if (!counts) throw new Error(`hitboxes: unreadable label "${label}"`);
  const [, units, walls, pickups, bodies] = counts.map(Number);
  if (!(units > 0 && walls > 0 && pickups > 0 && bodies > 0)) {
    throw new Error(`hitboxes: empty family in "${label}"`);
  }

  // Screenshot mode is the one place the overlay must stay down even when on.
  SD.setSSmode(true);
  if (!SD.ssMode) throw new Error("hitboxes: could not enter screenshot mode");
  gm.enterFrame(1);
  if (gm.hitboxLabel.visible) throw new Error("hitboxes: survived screenshot mode");
  SD.setSSmode(false);

  Input.showHitboxes = false;
  gm.enterFrame(1);
  if (gm.hitboxLabel.visible) throw new Error("hitboxes: readout stuck on after toggle off");
  gm.destructor();

  console.log(
    `hitboxes: ${units} units, ${walls} walls, ${pickups} pickups, ` +
    `${bodies} physics fixtures; hidden in ssMode and when toggled off`,
  );
}

// --- spawn points sit ON the level geometry, never inside or over a void ---
// The extracted spawn data is not trustworthy on its own: some points are
// buried in the ground mesh (the unit spawns inside the art and gets shoved
// through the floor) and some hang over open space. Arena grounds them all, so
// every surviving node must be exactly a wall top under the spawn's x, and no
// node may be inside a solid.
{
  const skippedSpawnLevels: string[] = [];
  for (const { id } of LEVELS) {
    SD.matchSettings.level = id;
    const arena: any = new Arena();
    if (arena.spawnNodes.length < 4) {
      throw new Error(`spawns: ${id} kept only ${arena.spawnNodes.length} nodes`);
    }
    // The Raze 2 maps collide against a pixel mask decoded from a PNG by
    // WallMasks, which needs the browser asset pipeline — under the node stub
    // they load no geometry at all (`walls: 0`, no mask), so every point reads
    // as empty and grounding is unverifiable rather than wrong. Skip them here
    // and say so, instead of asserting against collision data that isn't there.
    if (!arena.walls.length) {
      skippedSpawnLevels.push(id);
      continue;
    }
    for (const n of arena.spawnNodes) {
      if (arena.pointInWall(n.x, n.y - 1)) {
        throw new Error(`spawns: ${id} node ${n.name} at ${n.x},${n.y} is inside a wall`);
      }
      // Asserted through pointInWall rather than against `arena.walls` rects:
      // the Raze 2 levels collide against a pixel mask and have no rect walls
      // at all, so a rect-top test could only ever pass on the Raze 1 maps.
      // Feet clear, solid immediately underneath — true of both representations.
      if (!arena.pointInWall(n.x, n.y + 1)) {
        throw new Error(`spawns: ${id} node ${n.name} at ${n.x},${n.y} floats — no surface`);
      }
    }
    console.log(`spawns: ${id} ${arena.spawnNodes.length} nodes, all grounded on geometry`);
  }
  if (skippedSpawnLevels.length) {
    console.log(
      `spawns: NOT verified for ${skippedSpawnLevels.length} pixel-mask level(s) ` +
      `(${skippedSpawnLevels.join(", ")}) — no collision data outside the browser`,
    );
  }
}

// --- render layers: effects must not draw behind the players ---------------
// Every effect used to share one container that sat *under* every unit, so a
// muzzle flash rendered behind the arm holding the gun. Assert both halves of
// the fix — the stacking order and the per-effect routing — since either one
// can regress on its own and neither is visible from the other.
{
  SD.matchSettings.level = "city";
  const lg: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 40; i++) lg.enterFrame(1);

  const kids = lg.arena.view.children;
  const at = (c: any) => kids.indexOf(c);
  const layers: [string, any][] = [
    ["fxBehind", lg.fxBehind],
    ["ragdolls", lg.rdPhys.view],
    ["unitLayer", lg.unitLayer],
    ["fxFront", lg.fxFront],
  ];
  for (const [name, c] of layers) {
    if (at(c) < 0) throw new Error(`layers: ${name} was never added to the arena`);
  }
  for (let i = 1; i < layers.length; i++) {
    if (at(layers[i][1]) <= at(layers[i - 1][1])) {
      throw new Error(
        `layers: ${layers[i][0]} must stack above ${layers[i - 1][0]} ` +
        `(got ${layers.map(([n, c]) => `${n}@${at(c)}`).join(", ")})`,
      );
    }
  }

  // Units belong in the unit layer, not loose in the arena where the old code
  // put them (which is what made insertion order decide depth).
  for (const u of lg.units) {
    if (!lg.unitLayer.children.includes(u.view)) {
      throw new Error("layers: a unit view is not in unitLayer");
    }
  }

  // Routing. Counting only works below the concurrent-effect cap, since at the
  // cap pushFx evicts as it adds — so assert the headroom rather than assume it.
  if (lg.fx.length + 2 >= Quality.maxFx) {
    throw new Error(`layers: no fx headroom (${lg.fx.length}/${Quality.maxFx}), test cannot measure`);
  }
  const frontBefore = lg.fxFront.children.length;
  const behindBefore = lg.fxBehind.children.length;
  lg.addMuzzleFlash(100, 100, 0, 0xffffff, 10);
  if (lg.fxFront.children.length !== frontBefore + 1) {
    throw new Error("layers: muzzle flash did not land in front of the units");
  }
  lg.addEffect(100, 100, "blood");
  if (lg.fxBehind.children.length !== behindBefore + 1) {
    throw new Error("layers: blood did not land behind the units");
  }

  console.log(
    `layers: fxBehind < ragdolls < units < fxFront, ${lg.units.length} units in the unit layer, ` +
    "muzzle flash routed front / blood routed behind",
  );
}

// --- round end: a card over a match that is still being played -------------
// The round-end card is a report on a fight that carries on behind it, so two
// things have to hold that used to be false: the sim must NOT freeze when the
// match ends, and the auto-exit must hand back to the level screen (Quick
// Match) rather than the main menu.
{
  SD.matchSettings.level = "city";
  SD.matchSettings.campaign = 0;

  const nav: any[] = [];
  const engine: any = {
    app: {}, root: { addChild() {} }, overlay: {},
    setScreen: (S: any) => nav.push(S),
  };
  const rg: any = new GameScreen(engine, undefined);
  for (let i = 0; i < 40; i++) rg.enterFrame(1);
  if (!rg.gameStarted) throw new Error("round end: match never started");

  // Count sim ticks across every unit, so "the game keeps running" is asserted
  // against the actual unit update rather than something merely adjacent. The
  // count is checked as zero/non-zero, not for an exact value: dead units are
  // skipped by the tick loop, so anything exact would flake on an unlucky death.
  let unitTicks = 0;
  for (const u of rg.units as any[]) {
    const realTick = u.EnterFrame.bind(u);
    u.EnterFrame = (...a: any[]) => { unitTicks++; return realTick(...a); };
  }

  if (!rg.endGame(true)) throw new Error("round end: endGame refused");
  if (!rg.roundEnd) throw new Error("round end: no card was built");
  if (rg.roundEnd.alpha !== 0) throw new Error("round end: card must start fully transparent");

  const cardText: string[] = [];
  (function walk(n: any) {
    if (typeof n?.text === "string" && n.text) cardText.push(n.text);
    for (const c of n?.children ?? []) walk(c);
  })(rg.roundEnd);
  if (!cardText.includes("VICTORY")) {
    throw new Error(`round end: card has no VICTORY header (got ${cardText.join("|")})`);
  }
  if (!cardText.includes("KILLS") || !cardText.includes("DEATHS")) {
    throw new Error("round end: card has no scoreboard");
  }

  // Fade-in window: 18 ticks (0.6s). Part-way through it must be part-way up.
  for (let i = 0; i < 9; i++) rg.enterFrame(1);
  const midFade = rg.roundEnd.alpha;
  if (!(midFade > 0 && midFade < 1)) {
    throw new Error(`round end: card should be mid-fade at 9 ticks, alpha ${midFade}`);
  }
  if (unitTicks === 0) {
    throw new Error("round end: sim froze — no unit ticked in the 9 frames after the match ended");
  }

  // Out to the 3s mark. The card is solid well before it, and nothing has
  // navigated away yet.
  for (let i = 0; i < 60; i++) rg.enterFrame(1);
  if (rg.roundEnd.alpha !== 1) throw new Error("round end: card never reached full opacity");
  if (nav.length) throw new Error("round end: left the match before the 3s hold was up");

  for (let i = 0; i < 25; i++) rg.enterFrame(1);
  await new Promise((r) => setTimeout(r, 0)); // leaveMatch() imports the screen
  if (nav.length !== 1) throw new Error(`round end: expected 1 navigation, got ${nav.length}`);
  if (nav[0]?.name !== "PlayScreen") {
    throw new Error(`round end: handed back to ${nav[0]?.name}, expected PlayScreen`);
  }

  console.log(
    "round end: VICTORY card + scoreboard faded in over the live arena, " +
    `sim kept running (${unitTicks} unit ticks), handed back to PlayScreen after 3s`,
  );
}

// --- Resupply grants one clip, not a free full rearm -----------------------
// The port used to set curAmmo/curClip straight to max, which made the free
// default ability strictly better than the Extra Clips equip you can buy.
// Original is `gun.addClip(gun.curNum, 1)`: reserve only, one clip, current
// weapon only (doc 14 §6.2).
{
  const ag: any = new GameScreen(fakeEngine, undefined);
  for (let i = 0; i < 40; i++) ag.enterFrame(1);
  const pl: any = ag.player;
  pl.ability = getAbility("ammo");
  pl.equips = {};

  // A gun with a real reserve pool, drained, and a half-spent magazine so the
  // "does not reload for you" half is observable.
  pl.gun.selectGun("shotgun");
  const gun = pl.gun.curGun;
  if (gun.oneClip) throw new Error("resupply: expected shotgun to have a separate reserve");
  const otherId = pl.gun.gunOrder.find((id: string) => id !== pl.gun.curGunName);
  const other = pl.gun.arsenal[otherId];
  other.curAmmo = 0;

  gun.curAmmo = 0;
  gun.curClip = 1;
  pl.status.enCur = 100;
  if (!activateAbility(pl)) throw new Error("resupply: ability did not fire");

  if (gun.curAmmo !== gun.maxClip) {
    throw new Error(`resupply: expected one clip (${gun.maxClip}) in reserve, got ${gun.curAmmo}`);
  }
  if (gun.curClip !== 1) {
    throw new Error(`resupply: must not reload the magazine, clip went 1 -> ${gun.curClip}`);
  }
  if (other.curAmmo !== 0) {
    throw new Error(`resupply: touched a holstered weapon, ${otherId} reserve ${other.curAmmo}`);
  }

  // The reserve is finite: repeated use tops out at maxAmmo rather than growing
  // without bound, which is what the original's clamp guarantees.
  for (let i = 0; i < 40; i++) {
    pl.status.enCur = 100;
    activateAbility(pl);
  }
  if (gun.curAmmo !== gun.maxAmmo) {
    throw new Error(`resupply: reserve should clamp to ${gun.maxAmmo}, got ${gun.curAmmo}`);
  }

  // Extra Clips (equips.ammo) is the paid upgrade that restores the old
  // behavior: the original forces the count to 999 inside addClip, so one
  // activation fills the reserve outright.
  gun.curAmmo = 0;
  pl.equips = { ammo: 1 };
  pl.status.enCur = 100;
  if (!activateAbility(pl)) throw new Error("resupply: ability did not fire with Extra Clips");
  if (gun.curAmmo !== gun.maxAmmo) {
    throw new Error(`resupply: Extra Clips should fill the reserve, got ${gun.curAmmo}/${gun.maxAmmo}`);
  }

  console.log(
    `resupply: +1 clip (${gun.maxClip} rounds) to reserve only, magazine untouched, ` +
    `other weapons untouched, clamps at ${gun.maxAmmo}, Extra Clips still fills outright`,
  );

  // --- weapon crates top up half a reserve, they do not rearm you ----------
  // Original is `gun.addClip(num, ceil(clipMax/2))` (doc 12 §5). The port used
  // to grant the whole reserve on every touch.
  pl.equips = {};
  const half = Math.ceil(gun.maxAmmo / gun.maxClip / 2) * gun.maxClip;

  gun.curAmmo = 0;
  gun.curClip = 1;
  pl.gun.pickUpGun(pl.gun.curGunName);
  if (gun.curAmmo !== half) {
    throw new Error(`crate: expected half a reserve (${half}), got ${gun.curAmmo}/${gun.maxAmmo}`);
  }
  if (gun.curClip !== 1) {
    throw new Error(`crate: must not reload the magazine, clip went 1 -> ${gun.curClip}`);
  }
  if (half >= gun.maxAmmo) {
    throw new Error(`crate: half reserve ${half} is not actually less than a full ${gun.maxAmmo}`);
  }

  // A weapon you don't carry yet arrives loaded but on that same half reserve,
  // so skipping a gun in the armory is never the better way to stock it.
  const fresh = "rocket";
  delete pl.gun.arsenal[fresh];
  pl.gun.gunOrder = pl.gun.gunOrder.filter((id: string) => id !== fresh);
  pl.gun.pickUpGun(fresh);
  const fg = pl.gun.arsenal[fresh];
  if (!fg) throw new Error(`crate: ${fresh} was never added to the arsenal`);
  if (fg.curClip !== fg.maxClip) {
    throw new Error(`crate: a new weapon should arrive loaded, clip ${fg.curClip}/${fg.maxClip}`);
  }
  const freshHalf = Math.ceil(fg.maxAmmo / fg.maxClip / 2) * fg.maxClip;
  if (fg.curAmmo !== freshHalf) {
    throw new Error(`crate: new weapon reserve ${fg.curAmmo}, expected half (${freshHalf})`);
  }
  if (!pl.gun.gunOrder.includes(fresh)) {
    throw new Error(`crate: ${fresh} never joined the Q/E cycle order`);
  }

  console.log(
    `crate: +${half / gun.maxClip} of ${gun.maxAmmo / gun.maxClip} clips ` +
    `(${half}/${gun.maxAmmo} rounds) to reserve, magazine untouched; ` +
    `a new ${fresh} arrives loaded on the same part reserve and joins the cycle`,
  );
}

console.log("SMOKE_OK");
