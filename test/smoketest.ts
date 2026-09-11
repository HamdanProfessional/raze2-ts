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
import { Arena, LEVELS, RAZE2_ITEM_KIND } from "../src/game/Arena";
import { SPREE_TIERS } from "../src/game/Score";
import { computeKillBonuses } from "../src/game/KillBonus";
import { RAZE2_KILL_BONUS_BY_ID } from "../src/assets/raze2";
import { Water } from "../src/game/Water";
import { Reflection } from "../src/game/Reflection";
import { PhysVap } from "../src/physics/PhysVap";
import { MapParticles } from "../src/game/MapParticles";
import { EMITTERS } from "../src/game/mapEmitters";
import { Transition } from "../src/core/Transition";
import RAZE2_MAPS from "../src/assets/raze2maps.json";
import { Input } from "../src/core/Input";
import { GAME_WIDTH, GAME_HEIGHT, PTM } from "../src/core/Config";
import { Vec2 } from "planck";
import { Sound, DEFAULT_RANGE } from "../src/audio/Sounds";
import { activateAbility, getAbility, ABILITY_ORDER } from "../src/game/Abilities";
import { AbilityArt } from "../src/assets/AbilityArt";
import { BgArt, LOL_CATS_SKY } from "../src/assets/BgArt";
import { SkinAnim } from "../src/assets/SkinAnim";
import { K } from "../src/core/K";
import { GUN_ORDER } from "../src/game/weapons";
import { LOADOUT_MAX, ensureLoadout, equippedGuns, equipGun, loadoutFull } from "../src/game/Armory";
import { teamColor, teamName, objectiveColor } from "../src/ui/raze2/palette";
import { teamColorOf } from "../src/game/HudComponents";
import { MapProps, PropClip } from "../src/game/MapProps";
import { PropArt, MID_CONT_DEPTH } from "../src/assets/PropArt";
import { surfaceForColor } from "../src/game/WallMask";
import { PickupWeapon } from "../src/game/PickupWeapon";
import { PickupWeaponArt } from "../src/assets/PickupWeaponArt";
import { artIdFor } from "../src/assets/weaponArtAlias";
import { droppableGuns } from "../src/game/Armory";
import { Achievements } from "../src/game/Achievements";
import R2_ACH from "../src/assets/raze2/achievements.json";

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

  // Score header (`Hud.as:382-394`): the local side is always captioned "Blue
  // Team" whatever team index it actually holds, and only the opposition is
  // named by its real colour. Raze 2's sides are Blue / Orange / Yellow /
  // Green — there is no red team, which is what this port used to invent.
  const rowText: string[] = hud.scoreRows.map((t: any) => String(t.text));
  if (rowText.some((s) => /\bRed\b/.test(s))) {
    throw new Error(`${type}: score header invented a Red team — ${rowText.join(" | ")}`);
  }
  if (teamMode) {
    if (!/^(> )?Blue Team: /.test(rowText[0])) {
      throw new Error(`${type}: self row should read "Blue Team", got "${rowText[0]}"`);
    }
    if (!/^(> )?Orange Team: /.test(rowText[1])) {
      throw new Error(`${type}: enemy row should read "Orange Team", got "${rowText[1]}"`);
    }
    const fills = hud.scoreRows.map((t: any) => t.style.fill);
    if (fills[0] !== 0xa3cfff || fills[1] !== 0xff9966) {
      throw new Error(
        `${type}: team row colours are not the Hud.as palette — ` +
          fills.map((f: number) => `#${Number(f).toString(16)}`).join(" / "),
      );
    }
  } else if (rowText.some((s) => /Team/.test(s))) {
    throw new Error(`${type}: free-for-all rows should carry names — ${rowText.join(" | ")}`);
  }
  if (!rowText.some((s) => s.startsWith("> "))) {
    throw new Error(`${type}: nobody marked as leading with "> " — ${rowText.join(" | ")}`);
  }

  // Kill feed caps at 13 rows (doc 14 §1.6, `Hud.as:780`) however many kills
  // land at once. Push well past the cap so this fails if it stops trimming.
  const KF_CAP = 13;
  for (let k = 1; k <= KF_CAP + 8; k++) {
    hud.addKillMessage("Alpha", "railgun", "Bravo", k % 3 === 0, {
      killerTeam: 1, victimTeam: 2, killerIsPlayer: k % 2 === 0,
    });
  }
  if (hud.killFeed.length !== KF_CAP) throw new Error(`${type}: kill feed not capped (${hud.killFeed.length})`);

  // Spree ladder: Raze 2 announces at exactly 5/10/15/20/25 (`Score.as`), so a
  // 25-kill run gives five callouts and every other kill gives none. Only the
  // player gets the centre-screen shout; a bot's run is feed-only.
  let tiers = 0;
  const realAnnounce = hud.announce.bind(hud);
  hud.announce = (...a: unknown[]) => { tiers++; realAnnounce(...a); };
  const runner: any = { _name: "Alpha", team: 1, human: true };
  for (let k = 1; k <= 25; k++) {
    const tier = SPREE_TIERS.find((t) => t.at === k);
    if (tier) hud.announceSpree(runner, tier.label, k, true);
  }
  hud.announce = realAnnounce;
  if (tiers !== SPREE_TIERS.length) {
    throw new Error(`${type}: spree ladder fired ${tiers}, expected ${SPREE_TIERS.length}`);
  }
  if (SPREE_TIERS[0].at !== 5 || SPREE_TIERS.some((t) => t.label === "Dominating")) {
    throw new Error(`${type}: spree ladder is not the Raze 2 one (5/10/15/20/25, no Dominating)`);
  }

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
console.log(
  "HUD: zones, score header (Blue/Orange naming + palette), kill feed, streaks, " +
    "damage bearings and scoreboard ok in dm/tdm/elim/telim",
);

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
  // Rect levels append " slopes N" after the wall count (Raze 2 maps read
  // "mask" instead and have no slope segments of their own).
  const counts =
    /units (\d+)\s+walls (\d+)(?:\s+slopes \d+)?\s+pickups (\d+)\s+bodies (\d+)/.exec(label);
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

// --- sloped terrain: fitted diagonals are ridden, not stair-stepped --------
// The Raze 1 levels' collision was extracted as a 3px-quantized maximal-rect
// cover, which is exact for flat platforms but turns every diagonal into a
// staircase — 37% of all rects across the four levels. `tools/slopes/
// fit_slopes.py` recovers those diagonals from the cover's top edge as real
// segments. Assert both halves: the segments describe actual geometry, and a
// real player walked across one tracks it instead of jamming on the risers.
{
  for (const id of ["city", "toxic", "pit", "space"]) {
    SD.matchSettings.level = id;
    const a: any = new Arena();
    if (!a.slopes.length) throw new Error(`slopes: ${id} loaded none`);
    for (const s of a.slopes) {
      if (!(s.x1 > s.x0)) {
        throw new Error(`slopes: ${id} segment ${JSON.stringify(s)} is not left-to-right`);
      }
      // A fitted segment must sit on the cover it was fitted from: some rect
      // covering that x must carry material in the band just beneath it.
      //
      // Deliberately an overlap test rather than `pointInWall`. That helper
      // tests rects with strict inequalities, so a probe landing exactly on the
      // seam between two abutting rects reads as empty — and since the whole
      // extraction is on a 3px grid, point probes land on seams constantly.
      // Overlap has no such measure-zero hole.
      let solid = 0;
      for (let k = 1; k <= 5; k++) {
        const t = k / 6;
        const px = s.x0 + (s.x1 - s.x0) * t;
        const py = s.y0 + (s.y1 - s.y0) * t;
        const found = a.walls.some((w: any) => {
          const l = w.x - w.width / 2;
          const r = w.x + w.width / 2;
          // Inclusive in x for the same reason: abutting rects share an edge,
          // and "is there material at this x" must say yes on the seam.
          return px >= l && px <= r && w.y + w.height / 2 > py + 1 && w.y - w.height / 2 < py + 9;
        });
        if (found) solid++;
      }
      if (solid < 5) {
        const mx = ((s.x0 + s.x1) / 2) | 0;
        const my = ((s.y0 + s.y1) / 2) | 0;
        throw new Error(`slopes: ${id} segment at ${mx},${my} floats (${solid}/5 probes solid)`);
      }
    }
  }

  // Walk the longest slope in `space` (47 segments, more than any other level).
  SD.matchSettings = { type: "dm", opponents: 1, level: "space", score: 10, diff: 1 } as any;
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 40; i++) gm.enterFrame(1);
  const arena: any = gm.arena;
  const lineY = (s: any, x: number) =>
    s.y0 + ((s.y1 - s.y0) * (x - s.x0)) / (s.x1 - s.x0);

  // Longest segment with clear headroom, so the walk is not fighting a ceiling.
  const seg = arena.slopes
    .slice()
    .sort((a: any, b: any) => b.x1 - b.x0 - (a.x1 - a.x0))
    .find((s: any) => {
      const mx = (s.x0 + s.x1) / 2;
      return !arena.pointInWall(mx, lineY(s, mx) - 40);
    });
  if (!seg) throw new Error("slopes: space has no segment with headroom to walk");

  const p: any = gm.player;
  const startX = seg.x0 + 6;
  p.x = startX;
  p.y = lineY(seg, startX);
  p.jumping = null;
  p.moving.vel = 0;
  Input.mouseX = GAME_WIDTH; // aim right so the unit faces the way it walks
  (Input as any).down.add("KeyD");

  const startY = p.y;
  let worstOff = 0;
  let samples = 0;
  let reached = startX;
  let crest = startY;
  for (let i = 0; i < 110; i++) {
    gm.enterFrame(1);
    if (p.status?.dead) break;
    if (p.x > seg.x1) break; // walked clear off the top — the climb is done
    if (p.x < seg.x0) continue;
    reached = Math.max(reached, p.x);
    crest = Math.min(crest, p.y); // y grows downward, so the crest is the min
    worstOff = Math.max(worstOff, Math.abs(p.y - lineY(seg, p.x)));
    samples++;
  }
  (Input as any).down.delete("KeyD");

  const span = seg.x1 - seg.x0;
  // Progress along the segment, not final x: once the unit crests the top it
  // leaves the slope entirely, and where it ends up after that says nothing.
  const covered = reached - startX;
  const deg = Math.abs((Math.atan2(seg.y1 - seg.y0, span) * 180) / Math.PI);
  // Jamming on a riser is the failure this work removes, so the unit has to
  // actually get somewhere.
  // Jamming on a riser is the failure this work removes. Before the fitted
  // segments the unit stalled after ~25% of this slope; assert both that it
  // travelled and that it actually gained the height, which is the property
  // that makes it a slope rather than a wall.
  if (covered < span * 0.7) {
    throw new Error(
      `slopes: unit jammed — covered ${covered.toFixed(0)}px of a ${span.toFixed(0)}px slope`,
    );
  }
  const rise = startY - crest;
  const fullRise = Math.abs(seg.y1 - seg.y0);
  if (rise < fullRise * 0.7) {
    throw new Error(
      `slopes: unit climbed only ${rise.toFixed(0)}px of a ${fullRise.toFixed(0)}px rise`,
    );
  }
  if (samples < 8) throw new Error(`slopes: only ${samples} samples on the slope`);
  // Riding the segment means staying on it. A unit stair-stepping the raw cover
  // drifts well clear of the fitted line between risers.
  if (worstOff > 8) {
    throw new Error(`slopes: unit strayed ${worstOff.toFixed(1)}px from the slope surface`);
  }
  console.log(
    `slopes: fitted segments on all 4 rect levels sit on real geometry; walked ` +
      `${covered.toFixed(0)}/${span.toFixed(0)}px up a ${deg.toFixed(0)}° slope ` +
      `(+${rise.toFixed(0)}px of ${fullRise.toFixed(0)}px rise), tracking it within ` +
      `${worstOff.toFixed(1)}px`,
  );
  gm.destructor();
}

// --- arena containment: nothing survives outside the box -------------------
// `Unit.as:577` kills anything outside a 2880x2880 arena box. The boundary
// walls are the primary containment, but the x-pass pushes a unit out of a wall
// by the smaller overlap, so a unit driven past a boundary wall's centre gets
// ejected *outwards* — a live soak caught the player at x=-371 on `space`,
// riding the global floor plane and then wedging there, alive and unreachable.
{
  SD.matchSettings = { type: "dm", opponents: 1, level: "city", score: 10, diff: 1 } as any;
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 40; i++) gm.enterFrame(1);
  const p: any = gm.player;

  // Driven through gm.enterFrame, not p.EnterFrame: the containment call hangs
  // off GameScreen's unit loop precisely because Player / AI / NetPlayer all
  // override EnterFrame without chaining to super, so testing the method
  // directly would pass while the game itself never invoked it.
  const revive = () => {
    p.status.dead = false;
    p.status.hpCur = p.status.hpMax ?? 100;
    p.status.invuln = 0;
    p.status.invinTimer = 0;
  };

  const box = gm.arena.killBounds;

  // In bounds: left alone. Including the parts of the level that sit at
  // negative coordinates — these are real platforms, not "outside". Before the
  // box was derived per level, the literal `y < 0` killed units standing here.
  for (const [lx, ly, why] of [
    [200, 200, "in the middle of the level"],
    [-20, 300, "on the geometry left of x=0"],
    [400, -60, "on the geometry above y=0"],
  ] as [number, number, string][]) {
    revive();
    p.x = lx;
    p.y = ly;
    gm.enterFrame(1);
    if (p.status.dead) throw new Error(`bounds: killed a unit ${why} (${lx},${ly})`);
  }

  // Out of bounds: killed. Taken from the level's own box so the test states
  // the rule ("outside the level") rather than a constant that only describes
  // Raze 2's map layout.
  for (const [lx, ly, why] of [
    [box.x0 - 50, 551, "off the left edge"],
    [box.x1 + 50, 200, "past the right limit"],
    [200, box.y0 - 50, "above the ceiling"],
    [200, box.y1 + 50, "below the world"],
  ] as [number, number, string][]) {
    revive();
    p.x = lx;
    p.y = ly;
    gm.enterFrame(1);
    if (!p.status.dead) {
      throw new Error(`bounds: unit survived ${why} (${Math.round(lx)},${Math.round(ly)})`);
    }
  }

  // Spawn invulnerability must not save you — `Unit.as:581` passes the bypass
  // flag so falling out of the world kills through it.
  revive();
  p.status.invuln = 999;
  p.x = box.x0 - 50;
  p.y = 300;
  gm.enterFrame(1);
  if (!p.status.dead) throw new Error("bounds: spawn invulnerability survived falling out");
  console.log(
    `bounds: units outside city's box x[${Math.round(box.x0)},${Math.round(box.x1)}] ` +
    `y[${Math.round(box.y0)},${Math.round(box.y1)}] die to the environment; ` +
    "its negative-coordinate geometry is in bounds",
  );
  gm.destructor();
}

// --- the double-jump flip throws your aim off ------------------------------
// `Unit.as:1103` adds the spin straight into the firing angle:
//   aimRoation = UT.fixRotation(rotArm + 90) + spinMC.rotation
// so a shot fired mid-somersault leaves along the tumbling body, not along the
// line to the cursor. The port used one angle for both the arm sprite and the
// bullet, so you could flip and still shoot exactly where you pointed.
{
  SD.matchSettings = { type: "dm", opponents: 1, level: "city", score: 10, diff: 1 } as any;
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 40; i++) gm.enterFrame(1);
  const p: any = gm.player;

  // Grounded, no flip: the barrel is on the cursor, exactly.
  if (p.flipActive) throw new Error("flip: unit was already spinning before the double jump");
  if (p.fireRotation !== p.aimRotation) {
    throw new Error(
      `flip: standing still deflects the shot (${p.fireRotation} vs aim ${p.aimRotation})`,
    );
  }

  // A strong double jump with a direction held is what spins you (Movement.as
  // doSpin: vel < -10 && L/R). One press to leave the ground, one in the air.
  p.keys = K.RIGHT;
  p.doJump(true);
  p.doJump(true);
  if (!p.flipActive) throw new Error("flip: a double jump with RIGHT held did not spin the unit");

  let spun = 0;
  let peak = 0;
  let worstErr = 0;
  for (let i = 0; i < 40 && p.flipActive; i++) {
    gm.enterFrame(1);
    if (!p.flipActive) break;
    spun++;
    // The deflection is the spin itself, to the degree — not an approximation.
    const defl = p.fireRotation - p.aimRotation;
    const spin = ((p.flipAngle * p.flipDir) * 180) / Math.PI;
    worstErr = Math.max(worstErr, Math.abs(defl - spin));
    peak = Math.max(peak, Math.abs(defl));
  }
  if (spun < 8) throw new Error(`flip: spin lasted only ${spun} frames`);
  if (worstErr > 1e-9) {
    throw new Error(`flip: shot angle is off the body spin by ${worstErr.toFixed(4)}°`);
  }
  if (peak < 90) {
    throw new Error(`flip: shot deflected at most ${peak.toFixed(0)}°, expected a real tumble`);
  }

  // ...and it must come back. A flip that permanently biased the aim would be
  // worse than not having one at all.
  for (let i = 0; i < 60 && p.flipActive; i++) gm.enterFrame(1);
  if (p.flipActive) throw new Error("flip: the spin never ended");
  if (p.fireRotation !== p.aimRotation) {
    throw new Error("flip: aim stayed deflected after the spin finished");
  }
  console.log(
    `flip: double-jump spin deflects the shot up to ${peak.toFixed(0)}° over ${spun} frames, ` +
      `tracking spinMC exactly, and clears on landing`,
  );
  gm.destructor();
}

// --- the loadout can never carry more than the number row can select --------
// `prof_guns` persists across builds, so a profile saved when the rack was
// bigger kept every gun in it: the armory read "8 / 7 CARRIED" and `equipGun`
// then refused every new pick because the list was already over cap.
{
  SD.profile.prof_guns = [...GUN_ORDER, GUN_ORDER[0], "not_a_real_gun", GUN_ORDER[1]];
  ensureLoadout();
  const list = SD.profile.prof_guns as string[];
  if (list.length > LOADOUT_MAX) {
    throw new Error(`loadout: ${list.length} guns stored, rack holds ${LOADOUT_MAX}`);
  }
  if (new Set(list).size !== list.length) throw new Error("loadout: duplicate guns survived");
  if (list.includes("not_a_real_gun")) throw new Error("loadout: an unknown gun survived");
  if (equippedGuns().length > LOADOUT_MAX) {
    throw new Error(`loadout: ${equippedGuns().length} reported carried, rack holds ${LOADOUT_MAX}`);
  }
  // Repaired, the rack has room again — the over-cap list had jammed equipping.
  SD.profile.prof_guns = list.slice(0, LOADOUT_MAX - 1);
  if (!loadoutFull() && !equipGun(GUN_ORDER[LOADOUT_MAX - 1])) {
    throw new Error("loadout: could not equip into a rack with a free slot");
  }
  // An untouched profile still gets the default seven.
  SD.profile.prof_guns = [];
  ensureLoadout();
  if ((SD.profile.prof_guns as string[]).length !== GUN_ORDER.length) {
    throw new Error("loadout: an empty profile was not seeded with the default arsenal");
  }
  console.log(`loadout: stored guns repaired to at most ${LOADOUT_MAX}, duplicates and unknowns dropped`);
}

// --- one team palette, and no red team -------------------------------------
// Raze 2's sides are Blue / Orange / Yellow / Green, and the human always joins
// team 1 (`GameScreen` doc 11 §3). Four separate tables used to define team
// tints and two of them had team 1 red and team 2 blue, so in CTF/Domination
// your own flag and captured points rendered enemy-red and the enemy's blue.
{
  const chan = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  // Red vs the legitimate orange: both are red-dominant, so the tell is the
  // green channel — orange (255,153,0) sits at 60% green, red (255,90,77) half that.
  const isRed = (c: number) => {
    const [r, g, b] = chan(c);
    return r > 150 && g < r * 0.5 && b < r * 0.6;
  };

  for (const t of [1, 2, 3, 4]) {
    if (isRed(teamColor(t))) {
      throw new Error(`teams: team ${t} tint 0x${teamColor(t).toString(16)} is red; Raze 2 has no red team`);
    }
    if (/red/i.test(teamName(t))) throw new Error(`teams: team ${t} is named "${teamName(t)}"`);
  }
  const [r1, g1, b1] = chan(teamColor(1));
  if (!(b1 > r1 && b1 > 150)) throw new Error(`teams: team 1 (${teamName(1)}) is not blue`);
  const [r2, g2, b2] = chan(teamColor(2));
  if (!(r2 > 150 && g2 > 80 && b2 < 120)) throw new Error(`teams: team 2 (${teamName(2)}) is not orange`);
  void g1;

  // Every table that tints a side must agree, or the same unit reads as one
  // team on their nameplate and the other on their flag.
  for (const t of [1, 2, 3]) {
    if (teamColorOf({ team: t }) !== teamColor(t)) {
      throw new Error(`teams: HUD tint for team ${t} disagrees with the shared palette`);
    }
    if (objectiveColor(t) !== teamColor(t)) {
      throw new Error(`teams: objective tint for team ${t} disagrees with the shared palette`);
    }
  }
  // Team 0 means "no side" for a unit but "unclaimed" for a control point.
  if (objectiveColor(0) === teamColor(0)) {
    throw new Error("teams: an unclaimed control point is tinted as free-for-all");
  }

  // The human is team 1, so their own objective must carry the friendly tint.
  SD.matchSettings = { type: "ctf", team: true, opponents: 1, level: "city", score: 3, diff: 1 } as any;
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 20; i++) gm.enterFrame(1);
  const mine = gm.player.team;
  if (mine !== 1) throw new Error(`teams: the human joined team ${mine}, expected 1`);
  if (objectiveColor(mine) !== teamColor(1)) throw new Error("teams: the player's own flag is not friendly-tinted");
  if (isRed(objectiveColor(mine))) throw new Error("teams: the player's own flag is still red");
  gm.destructor();
  console.log(
    `teams: single palette — 1 ${teamName(1)} / 2 ${teamName(2)} / 3 ${teamName(3)} / 4 ${teamName(4)}, ` +
      `nameplate + objective tints agree, no red team`,
  );
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

// --- every Raze 2 map ships its authored AI graph and jump zones -----------
// Raze 2 hand-authors a waypoint graph per map plus `NodeAiAction` boxes that
// mark exactly where a route climbs; `AI.as:598-618` is the ONLY place a bot
// jumps. The port had extracted neither for any map but the tutorial, so Arena
// fell back to a fully-connected mesh over spawn points and the AI guessed with
// a random 8%-per-frame "next node is higher" hop — which is what made bots
// stand under a ledge hopping forever. Losing this data again would bring that
// back, so assert it is present and usable.
{
  const r2 = RAZE2_MAPS as unknown as Record<string, any>;
  for (const [id, m] of Object.entries(r2)) {
    if (!m || !Array.isArray(m.spawns)) continue;
    const wps = m.waypoints ?? [];
    if (wps.length < 5) {
      throw new Error(`waypoints: ${id} has ${wps.length} nodes — authored graph missing`);
    }
    const byName = new Map(wps.map((w: any) => [w.name, w]));
    let boxes = 0;
    for (const w of wps) {
      for (const c of w.connects) {
        if (!byName.has(c)) {
          throw new Error(`waypoints: ${id} node ${w.name} links to missing "${c}"`);
        }
      }
      if (!w.connects.length) {
        throw new Error(`waypoints: ${id} node ${w.name} is isolated`);
      }
      for (const a of w.actions ?? []) {
        if (a.action !== "j" && a.action !== "d") {
          throw new Error(`waypoints: ${id} has action "${a.action}", expected j or d`);
        }
        if (!(a.w > 0 && a.h > 0)) {
          throw new Error(`waypoints: ${id} jump box at ${a.x},${a.y} has no area`);
        }
        boxes++;
      }
    }
    if (!boxes) {
      throw new Error(`waypoints: ${id} has no jump zones — bots cannot climb it`);
    }
    // The graph has to be one connected component, or bots strand in a pocket.
    const seen = new Set<string>([wps[0].name]);
    const queue = [wps[0].name];
    while (queue.length) {
      const cur = byName.get(queue.shift()!)!;
      for (const c of cur.connects) {
        if (!seen.has(c)) { seen.add(c); queue.push(c); }
      }
    }
    if (seen.size !== wps.length) {
      throw new Error(
        `waypoints: ${id} graph splits — ${seen.size}/${wps.length} nodes reachable`,
      );
    }
  }
  // Arena must report which kind of graph it built: the AI keeps its climb
  // guess (and the bots' contact-launch on jump pads) only where there is none.
  SD.matchSettings.level = "r2_jungle";
  const a2: any = new Arena();
  if (!a2.authoredWaypoints) throw new Error("waypoints: r2_jungle built the fallback mesh");
  if (!a2.wayNodes.some((n: any) => n.actions.length)) {
    throw new Error("waypoints: r2_jungle wayNodes carry no jump zones");
  }
  SD.matchSettings.level = "pit";
  const a1: any = new Arena();
  if (a1.authoredWaypoints) throw new Error("waypoints: pit has no authored graph to report");

  const totalW = Object.values(r2).reduce(
    (n: number, m: any) => n + (m?.waypoints?.length ?? 0), 0);
  const totalB = Object.values(r2).reduce(
    (n: number, m: any) => n + (m?.waypoints ?? []).reduce(
      (k: number, w: any) => k + (w.actions?.length ?? 0), 0), 0);
  console.log(
    `waypoints: ${totalW} authored nodes + ${totalB} jump zones across ` +
    `${Object.keys(r2).length} Raze 2 maps, every graph connected`,
  );
}

// --- every Raze 2 map draws its authored parallax backdrop ------------------
// `Game.as:105-110` stacks bgSky → bg2 → bg1 → arena, and `Arena.as:1172-1175`
// slides bg1/bg2 by the camera's own ratio. Two things here are easy to get
// backwards and invisible in a screenshot of an interior: bg1 is the NEAR layer
// (added last, on top), and `bgN.x` moves the clip's registration point, not
// the corner of its art — the ruined-city skies overhang 134px to the left, so
// dropping that offset slides the whole sky right and opens a black void at the
// edge of the view. Both cost the map its backdrop, so pin them down.
{
  const rig = BgArt.rig;
  const [stageW, stageH] = rig.stage;
  const r2 = RAZE2_MAPS as unknown as Record<string, unknown>;
  for (const id of Object.keys(r2)) {
    const use = BgArt.forMap(`r2_${id}`);
    if (!use) throw new Error(`backdrop: ${id} has no authored layers`);
    if (!use.bg2 || !use.sky) throw new Error(`backdrop: ${id} is missing bg2/sky`);
    for (const [kind, label] of [["bg", use.bg1], ["bg", use.bg2], ["sky", use.sky]] as const) {
      if (!label) continue;                       // only jungle, which has no bg1
      const f = (kind === "bg" ? rig.bg : rig.sky)[label];
      if (!f) throw new Error(`backdrop: ${id} wants ${kind} "${label}", not baked`);
      if (!(f.w > 0 && f.h > 0)) throw new Error(`backdrop: ${kind}/${label} is empty`);
    }
    // The sky never moves, so its art has to blanket the whole authoring stage
    // on its own. That is also exactly what lets it cover this port's view at
    // any window shape, since the layers are scaled by at least WIDTH/stageW.
    const s = rig.sky[use.sky];
    if (s.lx > 0 || s.lx + s.w < stageW || s.ly > 0 || s.ly + s.h < stageH) {
      throw new Error(
        `backdrop: sky "${use.sky}" spans ${s.lx}..${s.lx + s.w} x ${s.ly}..${s.ly + s.h}, ` +
        `short of the ${stageW}x${stageH} stage`,
      );
    }
  }

  // The "lol cats" mode replaces every map's sky, so that frame has to be baked
  // and has to blanket the stage too — it is the one label no map asks for.
  const lol = rig.sky[LOL_CATS_SKY];
  if (!lol) throw new Error(`backdrop: the "${LOL_CATS_SKY}" sky is not baked`);
  if (lol.lx > 0 || lol.lx + lol.w < stageW || lol.ly > 0 || lol.ly + lol.h < stageH) {
    throw new Error(`backdrop: the "${LOL_CATS_SKY}" sky is short of the stage`);
  }
  if (BgArt.forMap("r2_city", LOL_CATS_SKY)?.sky !== LOL_CATS_SKY) {
    throw new Error("backdrop: the lol cats override does not replace the map's sky");
  }

  await BgArt.ensure("r2_city");
  SD.matchSettings.level = "r2_city";
  const ab: any = new Arena();
  if (ab.skyG) throw new Error("backdrop: r2_city fell back to the procedural gradient");
  for (const [name, spr] of [["sky", ab.skySprite], ["bg2", ab.bg2], ["bg1", ab.bg1]] as const) {
    if (!spr) throw new Error(`backdrop: r2_city built no ${name} sprite`);
  }
  const at = (c: unknown) => ab.view.children.indexOf(c);
  if (!(at(ab.skySprite) < at(ab.bg2) && at(ab.bg2) < at(ab.bg1))) {
    throw new Error("backdrop: depth order is not bgSky -> bg2 -> bg1");
  }
  // Everything the arena draws itself has to land on top of all three layers.
  // (`ab.bg`, the map art, only exists once its texture has loaded.)
  const front = ab.bg ?? ab.geo;
  if (!(at(ab.bg1) < at(front))) throw new Error("backdrop: the map draws behind the backdrop");

  // Sweep the camera corner to corner; the sky must still cover the view at
  // both ends, which it only does if the registration offset survived.
  const scale = Math.max(GAME_WIDTH / stageW, GAME_HEIGHT / stageH);
  const skyF = rig.sky[BgArt.forMap("r2_city")!.sky];
  for (const [cx, cy] of [[0, 0], [GAME_WIDTH - ab.worldW, GAME_HEIGHT - ab.worldH]]) {
    ab.x = cx;
    ab.y = cy;
    ab.updateBackdrop();
    const x0 = ab.skySprite.x + ab.x, y0 = ab.skySprite.y + ab.y;
    if (x0 > 0 || y0 > 0 || x0 + skyF.w * scale < GAME_WIDTH || y0 + skyF.h * scale < GAME_HEIGHT) {
      throw new Error(
        `backdrop: at camera ${cx},${cy} the sky covers ${Math.round(x0)}..` +
        `${Math.round(x0 + skyF.w * scale)}, leaving a void in a ${GAME_WIDTH}px view`,
      );
    }
  }
  console.log(
    `backdrop: ${Object.keys(r2).length} Raze 2 maps, ` +
    `${Object.keys(rig.bg).length} parallax + ${Object.keys(rig.sky).length} sky frames, ` +
    `depth bgSky<bg2<bg1<map, sky covers the view at both camera extremes`,
  );
}

// --- the back slot carries the ability kit, and the CTF flag over it --------
// Raze 2 hangs one thing off a unit's back: `MC.body.ability` shows the
// equipped ability's kit, and `NodeCtfFlag.capture` overrides the same clip
// with `gotoAndStop("flag" + team)` (the FLAG's team, not the carrier's), with
// `reset()` restoring the kit. So the two can never show at once, and the port
// models it as one layer. The clip's 11 frame labels are the port's ability ids
// verbatim plus flag1/flag2, so a missing frame means a missing backpack.
{
  const rig = AbilityArt.rig;
  const want = ["heal", "static", "cloak", "sword", "mine", "grenade", "ammo",
                "teleport", "flag1", "flag2"];
  for (const f of want) {
    if (!rig.frames.includes(f)) {
      throw new Error(`ability: DefineSprite_249 frame "${f}" was never baked`);
    }
  }
  // `none` is a real frame but an empty one — deliberately not shipped, and the
  // layer hides instead. Shipping it would be a blank PNG on every unit.
  if (rig.frames.includes("none")) {
    throw new Error("ability: the empty `none` frame should not be baked");
  }
  // Every equippable ability must have a frame, or that loadout wears nothing.
  for (const id of ABILITY_ORDER) {
    if (!rig.frames.includes(id)) {
      throw new Error(`ability: "${id}" is equippable but has no back-slot frame`);
    }
  }
  // Attach points: every state/frame must have one, and it has to sit on the
  // torso rather than at the origin (a zeroed track would pin packs to the feet).
  for (const [name, st] of Object.entries(SkinAnim.manifest.states)) {
    const arr = (st as any).ability;
    if (!arr || arr.length !== (st as any).count) {
      throw new Error(
        `ability: state "${name}" has ${arr?.length ?? 0} attach points, ` +
        `expected ${(st as any).count}`,
      );
    }
    for (const [x, y, rot] of arr) {
      if (!(y < -25 && y > -70)) {
        throw new Error(`ability: "${name}" attach y=${y} is not on the torso`);
      }
      if (Math.abs(x) > 40 || Math.abs(rot) > 45) {
        throw new Error(`ability: "${name}" attach (${x}, rot ${rot}) is out of range`);
      }
    }
  }
  console.log(
    `ability: ${rig.frames.length} back-slot frames (kits + flag1/flag2), ` +
    `attach points on all ${Object.keys(SkinAnim.manifest.states).length} states`,
  );
}

// --- the water is a wave surface, not a blue rectangle ----------------------
// `Water.as` is a spring-mass line: a disturbance has to spread to its
// neighbours, rebound off the banks, and die away. The port shipped a static
// tint for a long time, so assert the three properties that distinguish a real
// simulation from a decorative one — it propagates, it decays, and it reacts to
// what a unit is doing rather than merely to their presence.
{
  const POOL = { x: 0, y: 100, w: 800, h: 200 };
  const flat = (w: Water) => (w as any).pools[0].dots.every((d: any) => d.y === d.oy);
  const offsets = (w: Water) => (w as any).pools[0].dots.map((d: any) => d.y - d.oy);
  const moving = (w: Water, eps = 0.2) => offsets(w).filter((v: number) => Math.abs(v) > eps).length;

  {
    const w = new Water([POOL]);
    const dots = (w as any).pools[0].dots.length;
    if (dots < 10) throw new Error(`water: ${dots} dots across an 800px pool`);
    if (!flat(w)) throw new Error("water: surface did not start at rest");

    // A kick in the middle must reach the banks, not stay a single spike.
    w.startWaveAtPos(POOL.x + POOL.w / 2, 8);
    let peak = 0;
    for (let i = 0; i < 10; i++) {
      w.enterFrame([]);
      peak = Math.max(peak, ...offsets(w).map(Math.abs));
    }
    for (let i = 0; i < 30; i++) w.enterFrame([]);
    const spread = moving(w);
    if (spread < dots / 2) {
      throw new Error(`water: wave reached only ${spread}/${dots} dots — not propagating`);
    }
    // And it must run down. The damping is gentle (velocity /1.05 a frame,
    // which is why the surface has an idle pulse at all), so this checks the
    // energy is going somewhere, not that the pool goes glassy.
    for (let i = 0; i < 400; i++) w.enterFrame([]);
    const settled = Math.max(...offsets(w).map(Math.abs));
    if (!(settled < peak * 0.5)) {
      throw new Error(`water: wave did not decay (${peak.toFixed(1)} -> ${settled.toFixed(1)})`);
    }
  }

  // Falling in, wading and standing still are three different disturbances
  // (`Water.EnterFrame`), so the same unit position must not always splash.
  {
    const at = (u: any) => {
      const w = new Water([POOL]);
      w.enterFrame([{ x: POOL.x + POOL.w / 2, y: POOL.y + 50, ...u }]);
      return Math.max(...offsets(w).map(Math.abs));
    };
    const landing = at({ jumping: { vel: 9 }, moving: { vel: 0 } });
    const wading = at({ jumping: null, moving: { vel: 7 } });
    const standing = at({ jumping: null, moving: { vel: 0 } });
    if (!(landing > wading && wading > standing)) {
      throw new Error(
        `water: splash sizes not ranked landing > wading > standing ` +
        `(${landing.toFixed(2)}, ${wading.toFixed(2)}, ${standing.toFixed(2)})`,
      );
    }
    if (standing !== 0) throw new Error("water: standing still disturbed the surface");
    // A dead unit is a corpse in the ragdoll world, not a swimmer.
    const corpse = at({ status: { dead: true }, jumping: { vel: 9 } });
    if (corpse !== 0) throw new Error("water: a dead unit still made a splash");
  }

  // Two ponds at different heights must not share a surface — a wave in one
  // would otherwise travel through the rock between them.
  {
    const w = new Water([POOL, { x: 900, y: 400, w: 400, h: 100 }]);
    w.startWaveAtPos(POOL.x + 40, 8);
    // Stop one frame short of the 20-frame idle pulse, which legitimately
    // stirs every pool and would otherwise look like the wave crossing.
    for (let i = 0; i < 19; i++) w.enterFrame([]);
    const near = (w as any).pools[0].dots.some((d: any) => Math.abs(d.y - d.oy) > 0.2);
    const far = (w as any).pools[1].dots.some((d: any) => Math.abs(d.y - d.oy) > 0.2);
    if (!near) throw new Error("water: the kicked pool never moved");
    if (far) throw new Error("water: a wave crossed between separate pools");
  }
  console.log("water: waves propagate, decay and rank landing > wading > standing; pools stay separate");
}

// --- the authored reflection copies the actors, not the map ------------------
// `Arena.doReflections` redraws the unit and effect layers — and only those —
// through a translate that puts the take rectangle at the texture origin, then
// shows the result at the author's own transform. Getting the translate sign
// wrong (or capturing the backdrop too) still renders something, so assert the
// three things that make it a reflection rather than a smear.
{
  const SPEC = {
    take: { x: 1006.6, y: 944.3, w: 781.2, h: 304.9 },
    show: { x: 1018.5, y: 946.9, sx: 1, sy: 0.951 },
  };
  const r = new Reflection(SPEC);
  const tex = (r as any).tex;
  if (tex.width !== 782 || tex.height !== 305) {
    throw new Error(`reflection: capture is ${tex.width}x${tex.height}, want 782x305`);
  }
  if (r.view.x !== SPEC.show.x || r.view.y !== SPEC.show.y) {
    throw new Error("reflection: sprite is not at the authored show point");
  }
  if (r.view.scale.y !== SPEC.show.sy) throw new Error("reflection: authored squash was dropped");

  // The capture must be world -> texture, i.e. the take corner lands on (0,0).
  const xf = (r as any).xf;
  if (xf.tx !== -SPEC.take.x || xf.ty !== -SPEC.take.y) {
    throw new Error(`reflection: capture transform is (${xf.tx}, ${xf.ty}), want the take corner negated`);
  }

  // Every source layer draws into the same texture, so only the first clears.
  const calls: { container: unknown; clear: boolean }[] = [];
  const renderer = { render: (o: any) => calls.push({ container: o.container, clear: o.clear }) };
  const layers = [{ id: "fxBehind" }, { id: "units" }, { id: "fxFront" }] as any[];
  const glow = Quality.glow;
  Quality.glow = true;
  r.update(renderer as any, layers);
  if (calls.length !== layers.length) {
    throw new Error(`reflection: ${calls.length} layers captured, want ${layers.length}`);
  }
  if (!calls[0].clear || calls.slice(1).some((c) => c.clear)) {
    throw new Error("reflection: later layers cleared the texture instead of stacking onto it");
  }
  if (!r.view.visible) throw new Error("reflection: hidden while lights are on");

  // With "Lights & Reflections" off it costs nothing and shows nothing.
  Quality.glow = false;
  calls.length = 0;
  r.update(renderer as any, layers);
  if (calls.length) throw new Error("reflection: still capturing with the lights off");
  if (r.view.visible) throw new Error("reflection: last frame left on screen with the lights off");
  Quality.glow = glow;
  console.log("reflection: captures the actor layers at the take corner and follows the lights toggle");
}

// --- corpses evaporate on a fixed clock, 40 pixels at a time ----------------
// `PhysActor` hands its ragdoll to `PhysVap` at exactly four seconds and
// `PhysVap` lifts the silhouette off in batches. The rates are what make it
// read as an ember cloud rather than a dissolve, and only one corpse may be
// vaporising at a time, so assert the batch size, the rise, and the queue.
{
  const SIZE = 100;
  // A solid 20x20 block of corpse in the middle of the capture.
  const src = new Uint32Array(SIZE * SIZE);
  for (let y = 40; y < 60; y++) for (let x = 40; x < 60; x++) src[y * SIZE + x] = 0xff3366cc;
  const TOTAL = 400;

  const vap = new PhysVap();
  if (!(vap as any).harvest(src)) throw new Error("vap: capture harvested nothing");
  const seeded = (vap as any).pixels as any[];
  if (seeded.length !== TOTAL) throw new Error(`vap: harvested ${seeded.length} pixels, want ${TOTAL}`);
  if (seeded.some((p) => p.x < 40 || p.x >= 60 || p.y < 40 || p.y >= 60)) {
    throw new Error("vap: harvest put a pixel outside the drawn block — index/row maths is wrong");
  }
  if (seeded.some((p) => !(p.yspd >= 2 && p.yspd < 7 && p.ymax >= 5 && p.ymax < 30))) {
    throw new Error("vap: a pixel got a rise speed or ceiling outside Pixel.as's ranges");
  }

  // 40 lift off per frame, and a leaver starts climbing immediately.
  (vap as any).target = {};
  vap.enterFrame(null);
  if ((vap as any).pixels.length !== TOTAL - 40) {
    throw new Error(`vap: ${TOTAL - (vap as any).pixels.length} pixels lifted off in one frame, want 40`);
  }
  // Not necessarily 40 still in the air: `ymax` bottoms out at 5 and `yspd`
  // tops out near 7, so the shortest-lived embers are already gone by the end
  // of the frame they lifted off in.
  const airborne = (vap as any).leavers as any[];
  if (airborne.length > 40 || airborne.length < 25) {
    throw new Error(`vap: ${airborne.length} leavers after one frame, want 40 less the short-lived`);
  }
  if (airborne.some((p) => p.ymov >= 0)) throw new Error("vap: a lifted pixel did not rise");
  if (airborne.some((p) => p.ymov < -p.ymax)) throw new Error("vap: a spent ember was kept");

  // The whole corpse clears, and it does so on the original's clock: 400
  // pixels at 40 a frame is 10 frames to strip, plus the tail of risers.
  let frames = 1;
  while ((vap as any).target && frames < 200) { vap.enterFrame(null); frames++; }
  if ((vap as any).target) throw new Error("vap: corpse never finished evaporating");
  if (frames < 10 || frames > 40) {
    throw new Error(`vap: 400 pixels took ${frames} frames to clear — expected ~10-40`);
  }

  // Only one at a time: a second corpse queues behind the first, and a queued
  // one that drifts off screen is dropped without ever being drawn.
  {
    const made = (x: number) => {
      const a: any = { destroyed: false, allParts: [] };
      a.part_body = { getPosition: () => ({ x: x / PTM, y: 300 / PTM }) };
      a.destroy = () => { a.destroyed = true; };
      return a;
    };
    const v2 = new PhysVap();
    const near = made(400);
    const far = made(90_000);
    // No renderer headless, so `grab` fails and the first corpse is destroyed
    // on the spot — which is also exactly the graphRagev-off path.
    v2.vaporize(near);
    if (!near.destroyed) throw new Error("vap: a corpse with nothing to render it was not destroyed");
    if ((v2 as any).target) throw new Error("vap: started an evaporation with no capture");

    (v2 as any).target = {};
    (v2 as any).pixels = [{ x: 0, y: 0, col: 1, ymov: 0, ymax: 10, yspd: 2 }];
    (v2 as any).queue.push(far);
    v2.enterFrame({ x: 0, y: 0 });
    if (!far.destroyed) throw new Error("vap: a queued corpse far off screen was kept");
    if ((v2 as any).queue.length) throw new Error("vap: off-screen corpse stayed in the queue");
  }
  console.log("vap: corpses harvest to embers, lift off 40/frame, clear fully, and queue one at a time");
}

// --- the corpse world is built from NodePhysBox, not the wall mask ----------
// Box2D cannot consume a pixel mask, so `Arena.as:894` collects the map's
// authored `NodePhysBox` clips and `PhysWorld.generateWorld` makes those — and
// only those — the ragdoll world's static geometry. The port fed it
// `arena.walls`, which is empty on every Raze 2 map, so every corpse and
// dropped gun free-fell out of the world.
{
  const WITH_BOXES: Record<string, number> = { jungle: 57, mines: 29, snow: 7 };
  for (const [id, def] of Object.entries(RAZE2_MAPS as Record<string, any>)) {
    const boxes = def.physBoxes ?? [];
    const want = WITH_BOXES[id] ?? 0;
    if (boxes.length !== want) {
      throw new Error(`physbox: ${id} has ${boxes.length} boxes, want ${want}`);
    }
    for (const [x, y, w, h] of boxes) {
      // Centre-anchored, and inside the map it belongs to.
      if (!(w > 0 && h > 0)) throw new Error(`physbox: ${id} has a degenerate ${w}x${h} box`);
      if (x < 0 || x > def.w || y < 0 || y > def.h) {
        throw new Error(`physbox: ${id} box at (${x}, ${y}) is outside its ${def.w}x${def.h} world`);
      }
    }
  }
  // And the arena must hand those, not `walls`, to the physics world.
  SD.matchSettings.level = "r2_jungle";
  const arena: any = new Arena();
  if (arena.walls.length) throw new Error("physbox: a mask map grew rect walls");
  if (arena.physBoxes.length !== WITH_BOXES.jungle) {
    throw new Error(`physbox: jungle loaded ${arena.physBoxes.length} rects, want 57`);
  }
  const rect = arena.physBoxes[0];
  if (!("rotation" in rect) || !("width" in rect)) {
    throw new Error("physbox: corpse geometry is not in WallRect form");
  }
  // The mask decodes from a texture, so headless it is null; the getter's
  // branch is what matters, not which one this run happens to take.
  arena.wallMask = {} as any;
  if (arena.corpseGeometry !== arena.physBoxes) {
    throw new Error("physbox: a mask map is still handing rect walls to the corpse world");
  }
  SD.matchSettings.level = "city";
  const rect1: any = new Arena();
  if (rect1.wallMask || rect1.corpseGeometry !== rect1.walls) {
    throw new Error("physbox: a Raze 1 level stopped using its own rects for corpses");
  }
  if (!rect1.walls.length) throw new Error("physbox: city has no walls to give");
  console.log(
    `physbox: 93 authored ragdoll rects across jungle/mines/snow, ` +
    `all in bounds; Raze 1 levels keep their own walls`,
  );
}

// --- the map's ambient life is authored, not a generic dust theme -----------
// `Stats_MapParticles` places fairies and fish by hand and runs per-map
// emitters whose rates are the player's "Particles" number used literally. The
// port shipped an invented dust/ember/snow/bubble theme picked off the map
// name, so no map had the right particles anywhere near the right place.
{
  const CAM = { x: 0, y: 0 };
  const nothing = () => {};

  // The one-time placements: fairies over the jungle pools, fish in the water.
  {
    const counts: Record<string, number> = {};
    for (const [id, e] of Object.entries(EMITTERS)) {
      counts[id] = e.init.length;
      if (e.init.some((s) => !s.force)) {
        throw new Error(`particles: ${id} has a mapInit placement that is not forced`);
      }
    }
    // 21 fairies + 16 fish on jungle, 35 fairies on jungle2, 15 fish on ocean.
    if (counts.jungle !== 37) throw new Error(`particles: jungle places ${counts.jungle}, want 37`);
    if (counts.jungle2 !== 35) throw new Error(`particles: jungle2 places ${counts.jungle2}, want 35`);
    if (counts.ocean !== 15) throw new Error(`particles: ocean places ${counts.ocean}, want 15`);
    const fish = EMITTERS.jungle.init.filter((s) => s.behave === "fish").length;
    if (fish !== 16) throw new Error(`particles: jungle has ${fish} fish, want 16`);
    for (const id of ["city", "mines", "mines2", "space", "desert", "snow", "tut"]) {
      if (counts[id] !== 0) throw new Error(`particles: ${id} should place nothing up front`);
    }
    // ocean2 is the same authored set, not a copy that can drift.
    if (EMITTERS.ocean2 !== EMITTERS.ocean) {
      throw new Error("particles: ocean2 no longer shares ocean's set");
    }
  }

  // Density is the setting used as a number: at 0 the rising motes stop dead.
  {
    const rate = (id: string, part: number) => {
      let n = 0;
      for (let fc = 1; fc <= 60; fc++) n += EMITTERS[id].frame(fc, part).length;
      return n;
    };
    const lo = rate("jungle", 1);
    const hi = rate("jungle", 3);
    if (!(hi > lo)) throw new Error(`particles: jungle emits ${lo} at Low but ${hi} at Ultra`);
    if (rate("mines2", 0) !== 0) {
      throw new Error("particles: the vents still emit with Particles off");
    }
    // Low emits the motes on alternate frames only.
    let odd = 0;
    for (let fc = 1; fc <= 20; fc++) if (EMITTERS.mines2.frame(fc, 1).length) odd++;
    if (odd !== 10) throw new Error(`particles: Low emitted on ${odd}/20 frames, want 10`);
  }

  // jungle falls through into jungle2's block in the original's switch, so it
  // gets the waterfalls *and* the vents. Losing that is a silent regression.
  {
    const j = EMITTERS.jungle.frame(2, 3);
    if (!j.some((s) => s.behave === "water")) throw new Error("particles: jungle has no waterfalls");
    if (!j.some((s) => s.behave === "raise")) {
      throw new Error("particles: jungle lost jungle2's vents — the switch fall-through is gone");
    }
  }

  // Behaviour: a droplet accelerates down, splashes on solid ground, and is
  // gone 20 frames later; a mote rises and expires on its own clock.
  {
    const solid: any = { solidAt: (_x: number, y: number) => y > 200 };
    let splashes = 0;
    const mp: any = new MapParticles("jungle", solid, () => splashes++);
    (mp as any).ps = [];
    (mp as any).emitter = { init: [], frame: () => [] };
    (mp as any).spawn({ pos: () => ({ x: 100, y: 100 }), behave: "water",
                        extra: { min: 0, max: 0, hitframe: 0 }, sub: "idle" }, true);
    const drop = (mp as any).ps[0];
    // The droplet's fall speed is randomised, so a fixed 40-frame budget was
    // racy: a slow one had not finished its 20-frame splash life by then and
    // the retire check failed maybe one run in five. What matters is that it
    // splashes and *eventually* goes, not that it manages it inside 40 frames.
    for (let i = 0; i < 200 && (mp as any).ps.length; i++) mp.enterFrame(CAM);
    if (!splashes) throw new Error("particles: a droplet never splashed on solid ground");
    if ((mp as any).ps.length) throw new Error("particles: a splashed droplet was never retired");
    if (drop.y <= 100) throw new Error("particles: a droplet did not fall");
  }
  {
    const mp: any = new MapParticles("city", null, nothing);
    (mp as any).ps = [];
    (mp as any).emitter = { init: [], frame: () => [] };
    (mp as any).spawn({ pos: () => ({ x: 100, y: 500 }), behave: "raise",
                        extra: { spd: 1 }, sub: "idle", frame: 6 }, true);
    const mote = (mp as any).ps[0];
    for (let i = 0; i < 19; i++) mp.enterFrame(CAM);
    if (!((mp as any).ps.length === 1 && mote.y < 500)) {
      throw new Error("particles: a vent mote did not rise for its full 20 frames");
    }
    mp.enterFrame(CAM);
    if ((mp as any).ps.length) throw new Error("particles: a vent mote outlived its 20 frames");
  }

  // Off-screen emitters cost nothing: `Game.createParticle` drops them.
  {
    const mp: any = new MapParticles("city", null, nothing);
    const before = mp.count;
    (mp as any).spawn({ pos: () => ({ x: 50_000, y: 50_000 }), behave: "spark" }, false, CAM);
    if (mp.count !== before) throw new Error("particles: spawned an emitter far off screen");
    (mp as any).spawn({ pos: () => ({ x: 50_000, y: 50_000 }), behave: "spark", force: true }, true, CAM);
    if (mp.count !== before + 1) throw new Error("particles: a forced placement was dropped");
  }

  console.log(
    "particles: 87 authored placements across jungle/jungle2/ocean, " +
    "density follows the Particles setting, jungle keeps the switch fall-through",
  );
}

// --- menus slide between snapshots, they do not cut to black ----------------
// `Transition.as` photographs the screen you are leaving, builds the new one
// behind it, and slides two stills. The port cut to black instead. The failure
// mode that matters is the live screen never coming back: it is hidden for the
// whole slide, so a transition that stalls leaves a blank game.
{
  const W = 1136;
  const H = 640;
  const renderer: any = { render: () => {} };
  const outgoing: any = { label: "old" };
  const incoming: any = { label: "new" };

  const run = (kind: any, maxFrames = 200) => {
    const tr = new Transition();
    let revealed = false;
    let captured = 0;
    tr.start(renderer, outgoing, kind, W, H,
      () => { captured++; return incoming; },
      () => { revealed = true; });
    if (!tr.working) throw new Error(`transition: ${kind} was not running after start`);
    let frames = 0;
    while (tr.working && frames < maxFrames) { tr.enterFrame(); frames++; }
    return { frames, revealed, captured, stalled: tr.working };
  };

  for (const kind of ["slideLeft", "slideRight", "zoomIn", "zoomOut", "fallOff"]) {
    const r = run(kind);
    if (r.stalled) throw new Error(`transition: ${kind} never finished`);
    if (!r.revealed) throw new Error(`transition: ${kind} left the live screen hidden`);
    // Two snapshots for every kind except fallOff, which only drops the old one.
    const want = kind === "fallOff" ? 0 : 1;
    if (r.captured !== want) {
      throw new Error(`transition: ${kind} took ${r.captured} arrival snapshots, want ${want}`);
    }
    // Short enough to feel like navigation, not a cutscene.
    if (r.frames > 40) throw new Error(`transition: ${kind} took ${r.frames} frames`);
  }

  // The arriving snapshot must come from the right side: left-slides enter
  // from +W, right-slides from -W. Getting this backwards still "works" but
  // reads as the menu going the wrong way.
  for (const [kind, sign] of [["slideLeft", 1], ["slideRight", -1]] as const) {
    const tr: any = new Transition();
    tr.start(renderer, outgoing, kind, W, H, () => incoming, () => {});
    tr.enterFrame(); tr.enterFrame(); tr.enterFrame();
    if (Math.sign(tr.t2.view.x) !== sign) {
      throw new Error(`transition: ${kind} brought the new screen in from the wrong side`);
    }
    if (Math.sign(tr.t1.view.x) !== -sign) {
      throw new Error(`transition: ${kind} pushed the old screen the wrong way`);
    }
  }

  // Navigating again mid-slide must not strand the screen either.
  {
    const tr = new Transition();
    let reveals = 0;
    tr.start(renderer, outgoing, "slideLeft", W, H, () => incoming, () => reveals++);
    tr.enterFrame();
    tr.start(renderer, outgoing, "slideRight", W, H, () => incoming, () => reveals++);
    let frames = 0;
    while (tr.working && frames < 200) { tr.enterFrame(); frames++; }
    if (reveals !== 2) throw new Error(`transition: ${reveals} reveals over two navigations, want 2`);
  }
  console.log("transition: all 5 slide/zoom/fall actions finish, reveal the screen, and enter from the right side");
}

// --- every kill bonus in the table can actually be earned -------------------
// `killBonuses.json` has had all 30 rows since the catalog was converted, but
// for a long time only 8 had a detector, so two thirds of the table was dead
// data you could never see in game. Drive one kill per bonus through the real
// dispatch and assert each one comes back — a detector that silently stops
// matching is invisible otherwise.
{
  const kills: Record<string, () => { killer: any; victim: any; cause: any }> = {};
  // A neutral pair: opposite teams, full health, nothing special about either.
  const pair = () => ({
    killer: {
      team: 1, human: true, score: {}, moving: { vel: 0, max: 11 }, equips: {},
      status: { dead: false, hpCur: 1000, hpMax: 1000, fadeTimer: 0, fireTimer: 0 },
      gun: { curGun: { id: "pistol" } }, respawnCount: 0, hasFlag: null, capturing: false,
    },
    victim: {
      team: 2, _name: "Bravo", diff: 1, capturing: false, target: null,
      status: { dead: false, hpCur: 1000, hpMax: 1000, fadeTimer: 0 },
    },
    cause: {} as any,
  });
  const on = (id: string, f: (p: ReturnType<typeof pair>) => void) => {
    kills[id] = () => { const p = pair(); f(p); return p; };
  };

  on("headMult", (p) => { p.cause.headMult = true; });
  on("assassin", (p) => { p.cause.assassin = true; });
  on("crotchMult", (p) => { p.cause.crotchMult = true; });
  on("buttMult", (p) => { p.cause.buttMult = true; });
  on("burrowMult", (p) => { p.cause.burrowMult = true; });
  on("splashDirect", (p) => { p.cause.splashDirect = true; });
  on("splashIndirect", (p) => { p.cause.splashIndirect = true; });
  on("spreeEnd", (p) => { p.cause.spreeEnd = 7; });
  on("reflect", (p) => { p.cause.reflect = p.victim; });
  on("refBounce", (p) => { p.cause.reflect = { _name: "Charlie" }; });
  on("jugKill", (p) => { p.cause.jugKill = true; });
  on("hasFlag", (p) => { p.cause.hasFlag = true; });
  on("hasFlag2", (p) => { p.killer.hasFlag = {}; });
  on("noShield", (p) => { p.cause.noShield = true; });
  on("corpsestick", (p) => { p.cause.corpseStick = true; });
  on("mauser", (p) => { p.cause.gun = "mauser"; });
  on("sword", (p) => { p.cause.gun = "sword"; });
  on("fire", (p) => { p.cause.gun = "fire"; });
  on("mine", (p) => { p.cause.gun = "mine"; });
  on("chill", (p) => { p.cause.gun = "icegun"; p.cause.bounce = 2; });
  on("dead", (p) => { p.killer.status.dead = true; p.killer.respawnCount = 4; });
  on("survive", (p) => { p.killer.status.hpCur = 10; });
  on("onfire", (p) => { p.killer.status.fireTimer = 40; });
  on("speed", (p) => { p.killer.moving.vel = 18; });
  on("invis", (p) => { p.victim.status.fadeTimer = 60; });
  on("steal", (p) => { p.victim.target = { _name: "Charlie" }; p.victim.status.hpCur = 100; });
  on("juice", (p) => { p.victim._name = "Juice-Tin"; });
  on("rad", (p) => { p.victim._name = "AddisonR"; });
  on("domKill", (p) => { p.victim.capturing = true; });
  on("domKill2", (p) => { p.killer.capturing = true; });

  const table = Object.keys(RAZE2_KILL_BONUS_BY_ID);
  const uncovered = table.filter((id) => !kills[id]);
  if (uncovered.length) {
    throw new Error(`bonuses: no detector exercised for ${uncovered.join(", ")}`);
  }

  const prevType = SD.matchSettings.type;
  for (const [id, build] of Object.entries(kills)) {
    // The two Domination bonuses only exist in Domination.
    SD.matchSettings.type = id.startsWith("domKill") ? "dom" : "dm";
    const { killer, victim, cause } = build();
    const got = computeKillBonuses(killer, victim, cause).all.map((b) => b.id);
    if (!got.includes(id)) {
      throw new Error(`bonuses: "${id}" did not fire — got [${got.join(", ") || "nothing"}]`);
    }
  }
  SD.matchSettings.type = prevType;

  // Only the first three pay, but every one is tallied (`KillPoints.addBonus`
  // increments the counter before the `remaining` check).
  {
    SD.matchSettings.type = "dm";
    const { killer, victim } = pair();
    const award = computeKillBonuses(killer, victim, {
      assassin: true, buttMult: true, burrowMult: true, splashDirect: true,
      noShield: true, jugKill: true,
    });
    if (award.all.length <= 3) throw new Error("bonuses: multi-bonus kill collapsed to 3 awards");
    if (award.paid.length !== 3) throw new Error(`bonuses: ${award.paid.length} paid, expected 3`);
    const paidWorth = award.paid.reduce((n, b) => n + b.worth, 0);
    const allWorth = award.all.reduce((n, b) => n + b.worth, 0);
    if (paidWorth >= allWorth) throw new Error("bonuses: unpaid awards still counted toward credits");
    SD.matchSettings.type = prevType;
  }

  // A team kill scores nothing at all — no bonuses, no credits.
  {
    const { killer, victim } = pair();
    const award = computeKillBonuses(killer, victim, { teamkill: true, headMult: true });
    if (award.all.length || award.points) throw new Error("bonuses: a betrayal still paid out");
  }

  console.log(
    `bonuses: all ${table.length} kill bonuses fire from the real dispatch; ` +
    `3 of 6 paid on a multi-bonus kill, betrayal pays nothing`,
  );
}

// --- Raze 2 pickup ids map to the right item, and Rapid Fire behaves --------
// `NodePickup.getPickup` is explicit that `s`/`b` are small/big:
//   sshield->shield(50)  bshield->shield(100)  shealth->heal(50)  bhealth->heal(100)
// Reading `s` as "super" had shealth handing out the big heal and left sshield
// and bhealth unmapped — and because the lookup silently fell back to health,
// all 12 sshield drops in the game were health packs.
{
  const expect: Record<string, string> = {
    sshield: "shield", bshield: "shieldBig",
    shealth: "health", bhealth: "healthBig",
    damage: "ddamage", invin: "invin", rapid: "rapid",
  };
  for (const [id, want] of Object.entries(expect)) {
    if (RAZE2_ITEM_KIND[id] !== want) {
      throw new Error(`pickups: "${id}" maps to ${RAZE2_ITEM_KIND[id]}, expected ${want}`);
    }
  }
  // Every id the shipped maps actually place must be mapped — an unmapped one
  // degrades to a health pack, which is exactly how this went unnoticed.
  const placed = new Set<string>();
  for (const m of Object.values(RAZE2_MAPS as Record<string, any>)) {
    for (const [, , raw] of m?.pickups ?? []) {
      const [prefix, kind] = String(raw).split("_");
      if (prefix === "p") placed.add(kind);
    }
  }
  for (const id of placed) {
    if (!RAZE2_ITEM_KIND[id]) {
      throw new Error(`pickups: map data places "p_${id}_*" but nothing maps it`);
    }
  }
  console.log(
    `pickups: ${placed.size} placed power-up ids all mapped ` +
    `(${[...placed].sort().join(", ")}); small/big match NodePickup.getPickup`,
  );
}

{
  // Rapid Fire (`Guns.as:406/416`, `NodePickup.as:245`): 2x fire rate, no ammo
  // drain, and every gun goes full-auto because `shotPressed` is not latched.
  SD.matchSettings = { type: "dm", opponents: 1, level: "city", score: 10, diff: 1 } as any;
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  for (let i = 0; i < 40; i++) gm.enterFrame(1);
  const p: any = gm.player;
  const g: any = p.gun;

  const clipBefore = g.curGun.curClip;
  g.cooldown = 0;
  (g as any).tryShoot();
  const normalDelay = g.cooldown;
  const spent = clipBefore - g.curGun.curClip;
  if (spent !== 1) throw new Error(`rapid: a normal shot spent ${spent} rounds, expected 1`);

  p.status.startStatus("rapid");
  if (p.status.rapidTimer !== 195) {
    throw new Error(`rapid: timer ${p.status.rapidTimer} frames, expected 195 (6.5 s)`);
  }
  g.curGun.curClip = g.curGun.maxClip;
  const clipRapid = g.curGun.curClip;
  g.cooldown = 0;
  (g as any).tryShoot();
  const rapidDelay = g.cooldown;
  if (Math.abs(rapidDelay - normalDelay / 2) > 1e-6) {
    throw new Error(`rapid: delay ${rapidDelay}, expected half of ${normalDelay}`);
  }
  if (g.curGun.curClip !== clipRapid) {
    throw new Error(`rapid: fired for ${clipRapid - g.curGun.curClip} ammo, expected free`);
  }
  // It has to actually run out, or it would be a permanent buff.
  p.status.rapidTimer = 1;
  p.status.enterFrame();
  if (p.status.rapidTimer !== 0) throw new Error("rapid: timer did not expire");
  console.log(
    `rapid: 195-frame timer, delay ${normalDelay}->${rapidDelay}, clip untouched while up`,
  );
  gm.destructor();
}

// --- no spawn node sits outside its own level's out-of-bounds box ---------
// `Unit.containInArena` kills anything outside the arena box, bypassing spawn
// invulnerability. The SWF writes that box as the literal `0..2880`, which is
// a description of where Raze 2's maps sit, not a general rule — the ported
// Raze 1 levels are laid out around the Flash stage origin and have real
// geometry at negative coordinates. `space`'s topmost platform surfaces at
// y = -16 and two of its eight spawn nodes ground onto it, so a quarter of
// spawns on that map died on frame 1, through spawn invulnerability. Each
// level now publishes its own box.
{
  for (const { id } of LEVELS) {
    SD.matchSettings.level = id;
    const a: any = new Arena();
    const b = a.killBounds;
    if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) {
      throw new Error(`bounds: ${id} has a degenerate kill box ${JSON.stringify(b)}`);
    }
    for (const n of a.spawnNodes) {
      if (n.x < b.x0 || n.y < b.y0 || n.x > b.x1 || n.y > b.y1) {
        throw new Error(
          `bounds: ${id} spawn ${n.name} at ${Math.round(n.x)},${Math.round(n.y)} ` +
          `is outside the kill box ${JSON.stringify(b)} — a unit spawning there ` +
          `dies on its first frame`,
        );
      }
    }
    // The box has to still catch a unit that falls out of the world, or the
    // check stops doing its job. Well below the lowest geometry must be fatal.
    const deepY = b.y1 + 1000;
    if (deepY <= b.y1) throw new Error(`bounds: ${id} box is unbounded below`);
  }
  // On a Raze 2 map the box must remain exactly the SWF's literal constant.
  SD.matchSettings.level = "jungle";
  const r2: any = new Arena();
  const jb = r2.killBounds;
  if (jb.x0 !== 0 || jb.y0 !== 0 || jb.x1 !== 2880 || jb.y1 !== 2880) {
    throw new Error(`bounds: raze2 map box drifted from Unit.as:577 — ${JSON.stringify(jb)}`);
  }
  console.log(
    "bounds: every spawn node lies inside its level's out-of-bounds box; " +
    "Raze 2 maps keep the SWF's literal 0..2880",
  );
}

// --- jump pads come from the staged wall mask, not the frame-1 map JSON ----
// Raze 2 pads live in the per-frame special layer. The tutorial restages that
// layer as each step clears and *deletes* its diagonal pad from frame 5 on,
// once the shortcut it exists to provide has been used. `Arena.jumpPads` is
// built once from the map JSON, so reading pads from it left a pad live in the
// world for the rest of the walkthrough that fires the player back across the
// map to a beat they already finished. Two invariants, both checkable here:
// a staged mask must win over the stale list, and the maskless Raze 1 levels
// must still fall back to it.
{
  // Raze 1 `pit` decodes no PNG, so its four rect pads are the only ones there
  // are — the fallback path has to keep working.
  SD.matchSettings.level = "pit";
  const pit: any = new Arena();
  if (pit.wallMask) throw new Error("pads: pit unexpectedly has a pixel mask");
  if (pit.jumpPads.length !== 4) {
    throw new Error(`pads: pit has ${pit.jumpPads.length} rect pads, expected 4`);
  }
  for (const p of pit.jumpPads) {
    const hit = pit.jumpPadAt(p.x + p.w / 2, p.y);
    if (!hit) throw new Error(`pads: pit rect pad at ${p.x},${p.y} no longer fires`);
    if (hit.power !== p.power) {
      throw new Error(`pads: pit pad power ${hit.power}, expected ${p.power}`);
    }
  }
  // Feet well clear of the plate must NOT launch — the band is ±8px.
  if (pit.jumpPadAt(pit.jumpPads[0].x + 2, pit.jumpPads[0].y - 40)) {
    throw new Error("pads: pit fired from 40px above the plate");
  }

  // Now the mask path. A stub mask standing in for the decoded special layer:
  // it reports a pad in one band and nothing anywhere else, while the stale
  // rect list still claims pads at the old coordinates.
  const staged = { power: 1.3, dirX: -55 };
  pit.wallMask = {
    jumpPadAt: (x: number, y: number) =>
      x >= 2364 && x <= 2475 && y >= 894 && y <= 948 ? staged : null,
  };
  const onStaged = pit.jumpPadAt(2400, 940);
  if (!onStaged) throw new Error("pads: staged mask pad did not fire");
  if (onStaged.power !== staged.power || onStaged.dirX !== staged.dirX) {
    throw new Error(
      `pads: staged pad read ${onStaged.power}x/${onStaged.dirX}, ` +
      `expected ${staged.power}x/${staged.dirX}`,
    );
  }
  // The rect list still has pit's four pads; with a mask staged, none of them
  // may fire. This is the regression that stranded the tutorial.
  for (const p of pit.jumpPads) {
    if (pit.jumpPadAt(p.x + p.w / 2, p.y)) {
      throw new Error(
        `pads: stale map-JSON pad at ${p.x},${p.y} still fires while a mask is staged`,
      );
    }
  }
  // ...and when the step deletes the pad, the world must have no pad at all.
  pit.wallMask = { jumpPadAt: () => null };
  if (pit.jumpPadAt(2400, 940)) throw new Error("pads: deleted pad still fires");

  console.log(
    "pads: pit's 4 rect pads fire via the maskless fallback; a staged mask " +
    "overrides the map-JSON list and a deleted pad leaves nothing behind",
  );
}

// --- the tut map's authored props exist, are layered, and keep Flash timing --
// Campaign mission 1 is a factory that is supposed to be *running*: five gears,
// eight conveyor treads, three bridges that collapse on cue, nine lights. The
// port drew a still photograph of it. What matters beyond "they exist" is the
// depth split — `midCont` (the units) sits at 1663, and the author put the
// machinery ABOVE it, so the player runs behind the belt — and that each
// `play()` runs on to exactly the next authored stop, no further.
{
  const places = PropArt.placements("r2_tut");
  if (places.length !== 28) {
    throw new Error(`props: tut has ${places.length} placements, want 28`);
  }
  if (PropArt.placements("tut").length !== 28) {
    throw new Error("props: the r2_ prefix is not being stripped");
  }

  // Every map's inventory, straight off the SWF's own Arena frames. mines2 and
  // tutq matter most: they are authored as edits of the frame before them, so
  // their props arrive by inheritance and carry no character id — reading the
  // placement tags instead of simulating the display list loses them entirely,
  // along with two of the mine's.
  const PER_MAP: Record<string, number> = {
    jungle: 0, jungle2: 0, city: 4, desert: 11, ocean: 5, mines: 31,
    mines2: 1, space: 9, snow: 0, tut: 28, tutq: 1,
  };
  for (const [map, want] of Object.entries(PER_MAP)) {
    const got = PropArt.placements(`r2_${map}`).length;
    if (got !== want) throw new Error(`props: ${map} has ${got} placements, want ${want}`);
  }

  // Every placement on every map must resolve to baked art, not just tut's.
  const everyPlace = Object.keys(PER_MAP).flatMap((m) => PropArt.placements(`r2_${m}`));
  for (const p of everyPlace) {
    const def = PropArt.def(p.prop);
    if (!def) throw new Error(`props: no baked art for "${p.prop}"`);
    if (!def.frames.length) throw new Error(`props: "${p.prop}" baked 0 frames`);
    for (const f of def.frames) {
      if (f.w < 0 || f.h < 0) throw new Error(`props: "${p.prop}" has a negative frame rect`);
      if ((f.p ?? 0) >= def.files.length) {
        throw new Error(`props: "${p.prop}" frame points at page ${f.p}, only ${def.files.length} baked`);
      }
    }
    for (const st of def.stops ?? []) {
      if (st < 1 || st > def.frames.length) {
        throw new Error(`props: "${p.prop}" stops on frame ${st}, outside 1..${def.frames.length}`);
      }
    }
  }

  // The depth split, checked against the SWF's own numbers.
  const back = places.filter((p) => p.depth < MID_CONT_DEPTH);
  const front = places.filter((p) => p.depth >= MID_CONT_DEPTH);
  if (back.length !== 5 || front.length !== 23) {
    throw new Error(`props: depth split is ${back.length}/${front.length}, want 5 behind / 23 in front`);
  }
  for (const name of ["bridge", "bridge2", "bridge3", "heart", "arrow"]) {
    if (!back.some((p) => p.name === name)) {
      throw new Error(`props: "${name}" should be authored behind the units`);
    }
  }
  for (const kind of ["gear", "tread", "lightPulse"]) {
    if (!front.every((p) => p.prop !== kind || p.depth >= MID_CONT_DEPTH)) {
      throw new Error(`props: "${kind}" should be authored in front of the units`);
    }
  }
  if (front.filter((p) => p.prop === "gear").length !== 5) throw new Error("props: want 5 gears");
  if (front.filter((p) => p.prop === "tread").length !== 8) throw new Error("props: want 8 treads");

  const props = new MapProps("r2_tut");
  if (props.count !== 28) throw new Error(`props: built ${props.count} clips, want 28`);
  if (props.all("gear").length !== 5) throw new Error("props: gear lookup by kind failed");
  if (!props.get("bridge2")) throw new Error("props: name lookup failed");

  const frameOf = (c: PropClip) => (c as any).frame as number;
  const playingOf = (c: PropClip) => (c as any).playing as boolean;

  // A stop-driven clip parks on frame 1 and does not move until told.
  const b3 = props.get("bridge3")!;
  if (frameOf(b3) !== 1 || playingOf(b3)) throw new Error("props: bridge3 did not start parked on frame 1");
  for (let i = 0; i < 20; i++) b3.advance();
  if (frameOf(b3) !== 1) throw new Error("props: a parked bridge advanced on its own");

  // ...then each play() runs to exactly the NEXT stop (1 -> 36 -> 90).
  b3.play();
  for (let i = 0; i < 300 && playingOf(b3); i++) b3.advance();
  if (frameOf(b3) !== 36) throw new Error(`props: bridge3 halted on ${frameOf(b3)}, want 36`);
  b3.play();
  for (let i = 0; i < 300 && playingOf(b3); i++) b3.advance();
  if (frameOf(b3) !== 90) throw new Error(`props: bridge3 halted on ${frameOf(b3)}, want 90`);
  // Frame 90 is both the last stop and the last frame, so a third play() does
  // what Flash does: wrap to frame 1, where the clip's own stop() catches it.
  // The tutorial never asks for a third, but the wrap must not run off the end.
  b3.play();
  for (let i = 0; i < 300 && playingOf(b3); i++) b3.advance();
  if (frameOf(b3) !== 1) throw new Error(`props: bridge3 wrapped to ${frameOf(b3)}, want frame 1`);

  // Machinery runs from the start and stays stopped once the strike kills it.
  const gear = props.all("gear")[0];
  if (!playingOf(gear)) throw new Error("props: the gears should be running at match start");
  const g0 = frameOf(gear);
  gear.advance();
  if (frameOf(gear) === g0) throw new Error("props: a running gear did not advance");
  for (const g of props.all("gear")) g.stop();
  for (const g of props.all("gear")) {
    const f = frameOf(g);
    g.advance();
    if (frameOf(g) !== f) throw new Error("props: a stopped gear kept turning");
  }

  // A cycling clip wraps inside its authored range and never leaves it.
  const tread = props.all("tread")[0];
  for (let i = 0; i < 50; i++) {
    tread.advance();
    const f = frameOf(tread);
    if (f < 1 || f > 9) throw new Error(`props: a tread reached frame ${f}, outside its 1..9 loop`);
  }

  // The lights seed a random frame so seven copies of one clip run out of phase.
  const lights = props.all("lightPulse").map(frameOf);
  if (new Set(lights).size < 2) throw new Error("props: all 7 pulsing lights started on the same frame");
  for (const f of lights) {
    if (f < 2 || f > 57) throw new Error(`props: a light seeded frame ${f}, outside 2..57`);
  }

  // Rotation is not decoration on these placements: all eight of the tutorial's
  // conveyor treads are authored at a 22° tilt. Reading the matrix as scale
  // alone — which the extractor used to do — lays them flat across the belt.
  const treads = places.filter((p) => p.prop === "tread");
  for (const p of treads) {
    if (Math.abs(p.b) < 0.01 && Math.abs(p.c) < 0.01) {
      throw new Error("props: a tutorial tread lost its authored rotation");
    }
    // Taken modulo 180: half the treads are mirrored as well as tilted, which
    // flips the angle by 180° without changing the line the belt runs along.
    const deg = (Math.atan2(p.b, p.a) * 180) / Math.PI;
    const tilt = ((deg % 180) + 180) % 180;
    if (Math.abs(tilt - 22.4) > 1) {
      throw new Error(`props: a tread runs at ${tilt.toFixed(1)}°, want ~22.4°`);
    }
  }
  // ...and the clip must actually carry it through to its transform.
  const treadClip = props.all("tread")[0];
  const tv = treadClip.view as unknown as { rotation: number; skew: { x: number } };
  if (!tv.rotation && !tv.skew.x) throw new Error("props: the tread clip renders unrotated");

  // The mine's belts are rotated AND mirrored, which decomposes to skew rather
  // than a rotation — the placement has to survive that too.
  const mineBelts = PropArt.placements("r2_mines").filter((p) => p.prop === "treadDiag");
  if (!mineBelts.length) throw new Error("props: the mine lost its diagonal belts");
  if (!mineBelts.some((p) => p.a * p.d - p.b * p.c < 0)) {
    throw new Error("props: no mirrored mine belt — the flip was dropped");
  }

  // The lights are ONE red symbol recoloured per placement by the SWF's colour
  // transform (`mult=(0,0,0,1) add=(r,g,b,0)` — discard the art's colour, use a
  // flat authored one). Dropping that, as the extractor used to, painted every
  // light in every map the same red.
  {
    const lit = everyPlace.filter((p) => p.tint !== undefined);
    if (lit.length < 30) throw new Error(`props: only ${lit.length} placements carry a tint`);
    const hues = new Set(lit.map((p) => p.tint));
    if (hues.size < 8) throw new Error(`props: ${hues.size} distinct light colours, want 8+`);
    if (hues.has(0xff0000)) throw new Error("props: a light is tinted the art's own red");
    // A tinted prop must be a mask, or the tint multiplies instead of replacing.
    for (const p of lit) {
      const def = PropArt.def(p.prop)!;
      if (!def.whitened) {
        throw new Error(`props: "${p.prop}" is tinted but its art was not whitened`);
      }
    }
    // ...and an untinted placement of a whitened prop falls back to the colour
    // the art was actually drawn in, not to white.
    const plain = everyPlace.find((p) => p.tint === undefined && PropArt.def(p.prop)?.whitened);
    if (!plain) throw new Error("props: expected some lights to be placed untransformed");
    if (PropArt.def(plain.prop)!.nativeTint !== 0xff0000) {
      throw new Error("props: a whitened prop has no native colour to fall back to");
    }
    const tut2 = new MapProps("r2_tut");
    const tinted = tut2.all("lightPulse").map((c) => (c as any).spr.tint as number);
    if (new Set(tinted).size < 2) throw new Error("props: the tut lights all render one colour");
    tut2.destroy();
  }

  // The nav arrow is authored at alpha 0 and only switched on for one beat of
  // the walkthrough (`Unit.as:876` up, `Game.as:594` down), so it must not be
  // sitting on screen from the start.
  {
    const arrow = places.find((p) => p.prop === "arrow")!;
    if (arrow.alpha !== 0) throw new Error(`props: the nav arrow is placed at alpha ${arrow.alpha}, want 0`);
    const clip = props.get("arrow")!;
    if ((clip.view as unknown as { alpha: number }).alpha !== 0) {
      throw new Error("props: the nav arrow starts visible");
    }
    clip.setAlpha(1);
    if ((clip.view as unknown as { alpha: number }).alpha !== 1) {
      throw new Error("props: the script cannot raise the nav arrow off its authored 0");
    }
    clip.setAlpha(0);
  }

  // The flicker light re-rolls its frame every pass (its gotoAndPlay(irand(..))
  // sits on frame 1, inside the cycle), so it must not settle into a pattern.
  {
    const city = new MapProps("r2_city");
    const fl = city.all("lightFlicker")[0];
    if (!fl) throw new Error("props: city has no flicker lights");
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      fl.advance();
      const f = frameOf(fl);
      if (f < 1 || f > 11) throw new Error(`props: the flicker reached frame ${f}, outside 1..11`);
      seen.add(f);
    }
    if (seen.size < 8) {
      throw new Error(`props: the flicker only ever showed ${seen.size} frames — it is cycling, not flickering`);
    }
    city.destroy();
  }

  // The heart's labelled jump re-homes its loop: idle cycles 1..8, but once it
  // is dancing it cycles 9..21 and must never fall back into the idle range.
  const heart = props.get("heart")!;
  for (let i = 0; i < 30; i++) {
    heart.advance();
    if (frameOf(heart) > 8) throw new Error("props: the idle heart left its 1..8 cycle");
  }
  heart.gotoAndPlay("dance");
  if (frameOf(heart) !== 9) throw new Error("props: the dance label is not frame 9");
  for (let i = 0; i < 80; i++) {
    heart.advance();
    const f = frameOf(heart);
    if (f < 9 || f > 21) throw new Error(`props: the dancing heart reached ${f}, outside 9..21`);
  }

  console.log(
    "props: 90 authored clips across 8 maps build, tut splits 5 behind / 23 in " +
    "front of midCont, rotation/mirroring/per-placement light colour and the " +
    "arrow's authored alpha survive, and Flash timing holds (stops, loops, " +
    "out-of-phase lights, the flicker's re-roll, the dance label)",
  );
}

// --- spawn points carry the side the author tagged them with ---------------
// `NodeSpawn.as:24-33` reads the team off the marker's instance name (`k_2` is
// team 2) and `Arena.as:846-881` sorts them into neutral / T1 / T2 lists.
// `Unit.getSpawnNode()` then takes the team list **only in Capture the Flag**
// and the neutral list in every other mode. The port dropped the suffix when
// the spawn sets were extracted, so one flat pool served everyone: CTF teams
// could spawn in the enemy base, and free-for-all drew from base spawns the
// original never offers.
{
  const WANT: Record<string, [number, number, number]> = {
    jungle: [14, 8, 8], jungle2: [14, 8, 8], city: [13, 6, 7], desert: [13, 7, 6],
    ocean: [13, 9, 8], mines: [14, 7, 10], mines2: [14, 7, 10], space: [13, 11, 10],
    snow: [13, 7, 7], tut: [13, 7, 7], tutq: [13, 7, 7],
  };
  let tagged = 0;
  for (const [id, def] of Object.entries(RAZE2_MAPS as Record<string, any>)) {
    const want = WANT[id];
    if (!want) continue;
    const got: [number, number, number] = [0, 0, 0];
    for (const s of def.spawns) {
      const team = s[2] ?? 0;
      if (team !== 0 && team !== 1 && team !== 2) {
        throw new Error(`spawnteam: ${id} has a spawn tagged team ${team}`);
      }
      got[team]++;
    }
    if (got.join(",") !== want.join(",")) {
      throw new Error(`spawnteam: ${id} is ${got.join("/")}, want ${want.join("/")}`);
    }
    tagged += got[1] + got[2];
  }
  if (tagged !== 172) throw new Error(`spawnteam: ${tagged} team-tagged nodes, want 172`);

  // CTF hands each team its own side, and the two sides never overlap.
  SD.matchSettings.level = "r2_space";
  const arena: any = new Arena();
  const t1 = arena.spawnsFor(1, true);
  const t2 = arena.spawnsFor(2, true);
  if (!t1.length || !t2.length) throw new Error("spawnteam: a CTF team got an empty pool");
  const key = (n: any) => `${Math.round(n.x)},${Math.round(n.y)}`;
  const set2 = new Set(t2.map(key));
  if (t1.some((n: any) => set2.has(key(n)))) {
    throw new Error("spawnteam: the two CTF spawn pools overlap");
  }
  if (t1.some((n: any) => !n.team) || t2.some((n: any) => !n.team)) {
    throw new Error("spawnteam: a neutral node leaked into a CTF team pool");
  }

  // Every other mode draws from the neutral pool only — never a base spawn.
  for (const team of [0, 1, 2]) {
    const ffa = arena.spawnsFor(team, false);
    if (ffa.some((n: any) => n.team)) {
      throw new Error(`spawnteam: non-CTF pool for team ${team} includes a base spawn`);
    }
    if (!ffa.length) throw new Error("spawnteam: the neutral pool is empty");
  }

  // `Arena.as:846-855` flips which authored side each team gets, per match, so
  // over a session a team plays both ends. Rebuild until both outcomes appear.
  const seen = new Set<string>();
  for (let i = 0; i < 80 && seen.size < 2; i++) {
    const a: any = new Arena();
    seen.add(a.spawnsFor(1, true).map(key).sort().join("|"));
  }
  if (seen.size < 2) throw new Error("spawnteam: team 1 always got the same side");

  console.log(
    "spawnteam: 172 authored team spawns across 11 maps; CTF pools are disjoint, " +
    "non-CTF draws neutral only, and the sides flip per match",
  );
}

// --- the four secret achievements are reachable at all ----------------------
// Every Raze 2 achievement but these four was already wired. These are earned
// off wall-bitmap marker colours — `Unit.as:770-776` awards on contact, and
// `Bullet.as:426-474` on a hit — and none of the four colours had an entry in
// the surface table, so they decoded as plain ground. The four special modes
// they unlock were therefore unobtainable by any means.
{
  const MARKERS: [number, string][] = [
    [0xffff02, "secretCat"],
    [0xffff04, "secretHeart"],
    [0xffff06, "secretMoon"],
    [0x006600, "foliage"],
  ];
  for (const [rgb, type] of MARKERS) {
    const got = surfaceForColor(rgb);
    if (!got?.surf) {
      throw new Error(`ach: colour ${rgb.toString(16)} decodes to nothing — the secret is unreachable`);
    }
    if (got.surf.type !== type) {
      throw new Error(`ach: colour ${rgb.toString(16)} is "${got.surf.type}", want "${type}"`);
    }
    // A marker is a marker, not terrain: it must not alter movement.
    if (got.surf.damage || got.surf.modMove || got.surf.mega) {
      throw new Error(`ach: marker "${type}" carries movement/damage mods it should not`);
    }
  }
  // The markers must not have displaced a real surface.
  if (surfaceForColor(0xff00ff)?.surf?.type !== "tutStep") throw new Error("ach: tutStep lost");
  if (surfaceForColor(0x9900ff)?.surf?.type !== "tutWall") throw new Error("ach: tutWall lost");

  // All ten Raze 2 achievements are present, and their rewards are the source's.
  const ORDER = ["cat", "health", "ammo", "moon", "humanwin", "alienwin",
                 "abilities", "equipment", "bonus1", "bonus2"];
  const rows = R2_ACH as any[];
  if (rows.length !== 10) throw new Error(`ach: ${rows.length} achievements, want 10`);
  if (rows.map((r) => r.id).join(",") !== ORDER.join(",")) {
    throw new Error("ach: achievement order does not match Stats_Achievements.achOrder");
  }
  const REW: Record<string, [string, string | number]> = {
    cat: ["mode", "lol cats"], health: ["mode", "4x Health"],
    ammo: ["mode", "Unlimited Ammo"], moon: ["mode", "Moon Corpses"],
    humanwin: ["credits", 500], alienwin: ["credits", 1000],
    abilities: ["credits", 300], equipment: ["credits", 300],
    bonus1: ["credits", 500], bonus2: ["credits", 800],
  };
  for (const r of rows) {
    const want = REW[r.id];
    if (!want) throw new Error(`ach: unexpected achievement "${r.id}"`);
    if (String(r.rew?.[0]) !== want[0] || String(r.rew?.[1]) !== String(want[1])) {
      throw new Error(`ach: "${r.id}" rewards ${JSON.stringify(r.rew)}, want ${JSON.stringify(want)}`);
    }
  }

  // Awarding a mode achievement unlocks exactly that mode, once.
  SD.medals = {} as any;
  SD.modesUnlocked = [];
  SD.matchSettings.level = "r2_city";
  Achievements.addAch("cat");
  if (!SD.modesUnlocked.includes("lol cats")) throw new Error("ach: cat did not unlock lol cats");
  Achievements.addAch("cat");
  if (SD.modesUnlocked.filter((m) => m === "lol cats").length !== 1) {
    throw new Error("ach: re-awarding cat unlocked the mode twice");
  }
  // ...and a credits achievement pays out once.
  const before = SD.credits;
  Achievements.addAch("humanwin");
  if (SD.credits !== before + 500) {
    throw new Error(`ach: humanwin paid ${SD.credits - before} cr, want 500`);
  }
  Achievements.addAch("humanwin");
  if (SD.credits !== before + 500) throw new Error("ach: humanwin paid out twice");

  console.log(
    "ach: all 10 Raze 2 achievements carry the source's rewards, the 4 secret " +
    "marker colours decode, and awards pay out exactly once",
  );
}

// --- the tutorial's missile flash is an event, not a sky ---------------------
// `whiteFlash_139` is an opaque 800x600 white rectangle authored ON the
// `tut_attack` sky frame. It plays 30 frames and stops, but FFDec exports every
// clip parked on frame 1, so baking that sky statically painted the flash into
// it and campaign 1 went permanently white the moment the missile landed. The
// baker now strips it (`bake_bg.py` DROP_CLASSES) and the flash is replayed
// here instead.
{
  const gm: any = new GameScreen({ app: {}, root: { addChild() {} }, overlay: {} }, undefined);
  if (gm.whiteFlashTicks !== 0) throw new Error("flash: a match starts mid-flash");

  gm.flashWhite();
  if (gm.whiteFlashTicks !== 30) throw new Error(`flash: ${gm.whiteFlashTicks} ticks, want 30`);

  // It must fade, and it must clear itself completely rather than parking on a
  // faint permanent wash — which is the failure this test exists for.
  let prev = Infinity;
  for (let i = 0; i < 30; i++) {
    gm.updateWhiteFlash();
    const drawn = gm.whiteFlash.localBounds;
    if (gm.whiteFlashTicks > 0 && !drawn) throw new Error("flash: nothing drawn while flashing");
    if (gm.whiteFlashTicks >= prev) throw new Error("flash: the flash is not decaying");
    prev = gm.whiteFlashTicks;
  }
  if (gm.whiteFlashTicks !== 0) throw new Error("flash: still running after 30 ticks");
  gm.updateWhiteFlash();

  // Re-firing mid-flash extends rather than restarts-shorter.
  gm.flashWhite();
  gm.updateWhiteFlash();
  gm.flashWhite(5);
  if (gm.whiteFlashTicks !== 29) throw new Error("flash: a shorter re-trigger cut the flash short");

  // "Bloody Screen" silences the damage vignette; it must not silence a
  // scripted story beat.
  SD.graphBlood = false;
  gm.flashWhite();
  gm.updateWhiteFlash();
  if (gm.whiteFlashTicks !== 29) throw new Error("flash: graphBlood suppressed the scripted flash");
  SD.graphBlood = true;

  console.log(
    "flash: the tut missile white-out runs 30 frames and clears, survives the " +
    "Bloody Screen toggle, and is no longer baked into the sky",
  );
}


// --- the BH atlas covers the effects with no procedural stand-in ------------
// `Effect.as` is the whole of Raze 2's effect system: look a name up in
// `BH.BITS`, roll one of its pre-baked rotations, blit its frames. Nine names
// the game asks for had no art in the port at all and every one of them landed
// on `createEffect`'s `default:` — a shield break, a mud splash and a CTF flag
// return all drew the same generic ring.
{
  const { FxArt } = await import("../src/assets/FxArt");
  const { createEffect } = await import("../src/game/Fx");
  const fs = await import("node:fs");

  const WANT = [
    "smoke_big", "smoke_med", "mud_splash", "sand_splash", "leaf_splash",
    "shieldbreak", "bloodShield", "bloodRainbow", "flagReset1", "flagReset2",
  ];
  for (const name of WANT) {
    const def = FxArt.def(name);
    if (!def) throw new Error(`fx: "${name}" is not in the baked atlas`);
    if (def.frames < 2) throw new Error(`fx: "${name}" baked as ${def.frames} frame(s)`);
    if (def.cells.length !== def.frames * def.rotAmt) {
      throw new Error(
        `fx: "${name}" has ${def.cells.length} cells, want frames*rotAmt = ` +
        `${def.frames * def.rotAmt}`,
      );
    }
    // Rotation-major indexing is what BitAniFx assumes; a blank first cell of
    // any rotation would mean the pack order drifted.
    for (let r = 0; r < def.rotAmt; r++) {
      const c = def.cells[r * def.frames];
      if (!c || !c.w || !c.h) throw new Error(`fx: "${name}" rotation ${r} starts blank`);
    }
    for (const file of def.files) {
      if (!fs.existsSync(`public/assets/fx/${file}`)) {
        throw new Error(`fx: "${name}" atlas page ${file} is missing from public/`);
      }
    }
  }

  // The five skin bloods are one clip under five `mult=0` colour transforms, so
  // the atlas keeps a single white mask and the tint does the work. A coloured
  // mask could not produce gold from red however it was tinted.
  const shield = FxArt.def("bloodShield")!;
  if (!shield.whitened) throw new Error("fx: bloodShield is not a tintable mask");
  if (shield.tint !== 0xffcc33) {
    throw new Error(`fx: bloodShield tint 0x${(shield.tint ?? 0).toString(16)}, want 0xffcc33`);
  }
  // bloodRainbow is the same clip WITHOUT a colour transform — its rainbow comes
  // from a gradient-glow filter, so it must keep its own art rather than being
  // aliased onto the white mask.
  if (FxArt.def("bloodRainbow")!.whitened) {
    throw new Error("fx: bloodRainbow was whitened — its gradient glow is the effect");
  }

  // Procedural names still win: re-baking more of the atlas must not silently
  // replace effects that already look right.
  await FxArt.load();
  const mud: any = createEffect("mud_splash");
  if (!mud.def) throw new Error("fx: mud_splash did not resolve to the baked atlas");
  const spark: any = createEffect("pistol");
  if (spark.def) throw new Error("fx: the atlas overrode the procedural pistol spark");

  // It runs exactly `frames` ticks and then reports done, like Effect.as
  // (`paint(); frame++; if (frame > stats.frames) remove = true`).
  const def = FxArt.def("shieldbreak")!;
  const fx = createEffect("shieldbreak");
  let painted = 1; // the constructor paints frame 0
  while (!fx.enterFrame()) {
    if (++painted > def.frames + 2) throw new Error("fx: shieldbreak never finished");
  }
  if (painted !== def.frames) {
    throw new Error(`fx: shieldbreak painted ${painted} frames, want ${def.frames}`);
  }

  console.log(
    `fx: all ${WANT.length} BH effects baked and wired (bloodShield tints one ` +
    "white mask gold, bloodRainbow keeps its gradient glow, procedural effects " +
    "still take priority)",
  );
}


// --- a floor weapon is a lit stand with the gun floating over it ------------
// `NodePickup` is two things at once: the node clip is the STAND
// (`gotoAndStop(2)`, NodePickup.as:118 — powerups get `visible = false` and no
// stand at all) and `EnterFrame` paints the gun 40px above it, bobbing 4px on a
// 72-frame cycle. The port drew only the gun, at ground level: dark art on dark
// floor, and the tutorial's "grab that ammo backpack" pointed at nothing
// visible.
{
  // The stub's Assets.load hands back a Texture for anything, so this only
  // proves the art is *wired*; that the files exist is checked separately.
  await PickupWeaponArt.load();
  const p = new PickupWeapon(
    { id: "t", type: "shotgun", x: 100, y: 200, respawnSecs: 20 }, 0,
  ) as any;
  if (!p.base) throw new Error("weappickup: no stand sprite — the floor weapon has no backing");
  if (p.base.anchor.y !== 1) throw new Error("weappickup: the stand is not anchored on its base");
  if (!p.icon) throw new Error("weappickup: no gun icon");
  if (p.icon.y !== -40) throw new Error(`weappickup: gun sits at y=${p.icon.y}, want -40`);
  // The stand must draw under the gun, not over it.
  const kids = p.view.children;
  if (kids.indexOf(p.base) > kids.indexOf(p.icon)) {
    throw new Error("weappickup: the stand is drawn on top of the gun");
  }

  // It bobs, stays within its authored swing, and returns.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 72; i++) {
    p.enterFrame();
    lo = Math.min(lo, p.icon.y);
    hi = Math.max(hi, p.icon.y);
  }
  if (hi - lo < 7 || hi - lo > 8.5) {
    throw new Error(`weappickup: bob swing is ${(hi - lo).toFixed(1)}px, want ~8`);
  }
  if (Math.abs(p.bob) > 1e-9 && p.bob !== 0) throw new Error("weappickup: the bob cycle did not close");

  // A taken pickup stops bobbing and comes back after its respawn.
  p.tryTouch({ x: 100, y: 220, gun: { pickUpGun() {} } });
  if (p.view.visible) throw new Error("weappickup: still visible after being taken");
  for (let i = 0; i < 20 * 30; i++) p.enterFrame();
  if (!p.view.visible) throw new Error("weappickup: never respawned");

  // ...and the art it reaches for is actually on disk. A missing icon falls all
  // the way through to the arm-sprite fallback and the pickup goes near-invisible
  // again, which is the failure this whole block exists for.
  {
    const fs = await import("node:fs");
    const dir = "public/assets/pickups";
    if (!fs.existsSync(`${dir}/base.png`)) {
      throw new Error("weappickup: pickups/base.png is missing — no stand art ships");
    }
    const have = new Set(
      fs.readdirSync(`${dir}/weapons`).map((f) => f.replace(/\.png$/, "")),
    );
    const missing = droppableGuns().filter((g) => !have.has(g) && !have.has(artIdFor(g)));
    if (missing.length) {
      throw new Error(`weappickup: no floor icon for ${missing.join(", ")}`);
    }
  }

  console.log(
    "weappickup: floor weapons stand on the authentic lit base with the gun " +
    "floating 40px over it, bobbing 8px, respawn on their timer, and every " +
    "droppable gun has an icon on disk",
  );
}

console.log("SMOKE_OK");
