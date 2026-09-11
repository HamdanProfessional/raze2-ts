// Campaign suite: boots all 30 missions headlessly and asserts each one is
// playable and correctly equipped.
//
// This started as an exploratory net and caught the big one: every scripted bot
// in the campaign spawned with the stock arsenal, because a mission's
// `weapon: "zombie"` names a *class kit* (a 7-slot tier array) and the port was
// passing it through as if it were a gun id, so `WEAPONS["zombie"]` missed and
// the whole roster fell back. Same for `equip`.

(globalThis as any).localStorage = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] ?? null; },
  setItem(k: string, v: string) { this.store[k] = v; },
  removeItem(k: string) { delete this.store[k]; },
};
(globalThis as any).window = { open() {}, addEventListener() {}, devicePixelRatio: 1 };

import { SD } from "../src/state/SD";
import { GameScreen } from "../src/game/GameScreen";
import { getCamp, campaignMap } from "../src/game/Campaign";
import { LEVELS } from "../src/game/Arena";
import { WEAPONS } from "../src/game/weapons";
import { getAbility } from "../src/game/Abilities";
import { resolveLoadout } from "../src/game/weapons";

const fakeEngine: any = { app: {}, root: { addChild() {} }, overlay: {} };
SD.init();

const LEVEL_IDS = new Set(LEVELS.map((l) => l.id));
const problems: string[] = [];
const note = (n: number, msg: string) => problems.push(`stage ${String(n).padStart(2)}: ${msg}`);

const rows: string[] = [];
const kitSeen = new Set<string>();
for (let num = 1; num <= 30; num++) {
  const c = getCamp(num);
  if (!c) { note(num, "getCamp returned null"); continue; }
  const s = c.settings;

  if (!LEVEL_IDS.has(s.level) && s.level !== "r2_tut") note(num, `level "${s.level}" is not a shipped level`);
  if (!s.type) note(num, "no mode code");
  if (!(s.score > 0) && s.lives === 0) note(num, `score cap ${s.score} with no lives`);
  if (!c.ai.length) note(num, "no bots in the roster");

  // Roster sanity.
  for (const [i, a] of c.ai.entries()) {
    if (a.gun && !WEAPONS[a.gun]) note(num, `bot ${i} "${a.name ?? "?"}" has unknown gun "${a.gun}"`);
    if (!a.weapons) note(num, `bot ${i} "${a.name ?? "?"}" got no weapon kit`);
    else if (a.weapons.length !== 7) note(num, `bot ${i} kit has ${a.weapons.length} slots`);
    if (a.ability && !getAbility(a.ability)) note(num, `bot ${i} has unknown ability "${a.ability}"`);
    if (!(a.diff > 0)) note(num, `bot ${i} has diff ${a.diff}`);
  }
  // Team modes need two populated sides (the human is always team 1).
  if (s.team) {
    const enemies = c.ai.filter((a) => a.team === 2).length;
    const allies = c.ai.filter((a) => a.team === 1).length;
    if (!enemies) note(num, `team mode "${s.type}" with 0 enemies (allies ${allies})`);
  }
  // Dialogue must resolve to something drawable.
  for (const [i, m] of c.messages.entries()) {
    if (!m.text) note(num, `message ${i} is empty`);
    if (!(m.hold > 0)) note(num, `message ${i} holds for ${m.hold}s`);
  }

  // Boot it.
  let booted = false;
  let err = "";
  let units = 0;
  let teamsSeen: number[] = [];
  try {
    SD.matchSettings = { ...s } as any;
    const gm: any = new GameScreen(fakeEngine, num);
    for (let i = 0; i < 90; i++) gm.enterFrame(1);
    booted = !!gm.gameStarted;
    units = gm.units.length;
    teamsSeen = [...new Set(gm.units.map((u: any) => u.team))].sort();

    // Nobody wins or loses in the opening seconds. The arena-containment rule
    // used to fire on scripted reinforcements, which `setSpawn` parks far
    // outside the box at (-4000,-4000) until their cue: on the tutorial that
    // failed the mission on frame 1 (any out-of-bounds unit fails it), and
    // everywhere else it killed the reinforcements where they stood.
    if (gm.gameOver) note(num, `match ended within 90 frames of starting`);
    for (const u of gm.units) {
      if (!u.extra?.noSpawn) continue;
      // Count deaths, not "is dead right now": a reinforcement killed while
      // parked respawns straight back into the parked slot, so by frame 90 it
      // looks untouched again and only its death tally gives the bug away.
      if (u.score.deaths > 0) {
        note(num, `parked reinforcement "${u.extra?.name}" died ${u.score.deaths}x before its cue`);
      }
      if (u.x > -3000) note(num, `parked reinforcement "${u.extra?.name}" was dislodged to ${Math.round(u.x)},${Math.round(u.y)}`);
    }

    for (const u of gm.units) {
      if (!u.ai) continue;
      const held = u.gun?.curGun?.id;
      const rack = u.gun?.gunOrder ?? [];
      if (!held) note(num, `a bot spawned holding nothing`);
      kitSeen.add(`${u.extra?.name ?? "?"} :: ${rack.join(",")} :: holds ${held}`);
      // A bot's rack must OPEN with its scripted kit, not the stock seven.
      // Anything past slot 7 is a weapon it picked up mid-match, which legitimately
      // appends to the rack — so this is a prefix check, not an equality one.
      const want = resolveLoadout(u.extra?.weapons as number[]);
      if (want.length && want.some((id, i) => rack[i] !== id)) {
        note(num, `bot "${u.extra?.name}" carries [${rack.slice(0, 7).join(",")}], kit says [${want.join(",")}]`);
      }
      for (const id of rack) {
        if (!WEAPONS[id]) note(num, `bot "${u.extra?.name}" has non-existent gun "${id}"`);
      }
    }
    const objs = gm.objectives;
    if ((s.type === "ctf" || s.type === "dom") && objs && !objs.active) {
      note(num, `${s.type} mission on ${s.level} has no objective nodes — unwinnable`);
    }
    if (gm.player && gm.player.team !== (s.team ? 1 : 0)) {
      note(num, `player is team ${gm.player.team}, expected ${s.team ? 1 : 0}`);
    }
    if (units <= 1) note(num, `only ${units} unit(s) spawned`);
    gm.destructor();
  } catch (e: any) {
    err = String(e?.message ?? e);
    note(num, `THREW while running: ${err}`);
  }
  rows.push(
    `${String(num).padStart(2)} ${s.type.padEnd(5)} ${String(s.level).padEnd(11)} ` +
      `bots=${String(c.ai.length).padStart(2)} msgs=${String(c.messages.length).padStart(2)} ` +
      `score=${String(s.score).padStart(2)} lives=${s.lives} team=${s.team ? "Y" : "n"} ` +
      `teams=${JSON.stringify(teamsSeen)} units=${units} ${booted ? "boot" : "NOBOOT"}${err ? " ERR" : ""}`,
  );
}

console.log("=== campaign sweep ===");
for (const r of rows) console.log(r);
console.log(`\n=== ${problems.length} problem(s) ===`);
for (const p of problems) console.log(p);

// Map coverage: which campaign maps fall through to the jungle fallback?
const maps = new Set<string>();
for (let n = 1; n <= 30; n++) {
  const c = getCamp(n);
  if (c) maps.add(c.settings.level);
}
// --- scripted reinforcements actually arrive ------------------------------
// A `noSpawn` bot waits off-map until a cue calls it in. Only mission 1's cues
// had been transcribed, so missions 2/3/4/9/11 parked bots that nothing ever
// released — mission 2 fielded 1 enemy out of 11. Bots whose slot no cue names
// now open normally instead, and the transcribed waves are checked here.
{
  const WAVES: Record<number, { secs: number; want: number }> = {
    2: { secs: 140, want: 12 }, // timed zombie wave, whole roster by ~110s
    4: { secs: 70, want: 7 }, // three boarders at 21s
    9: { secs: 70, want: 8 }, // four-alien ambush at 20s
    11: { secs: 110, want: 8 }, // your squad arrives at 60s
  };
  for (const [numStr, w] of Object.entries(WAVES)) {
    const num = Number(numStr);
    const c = getCamp(num)!;
    SD.matchSettings = { ...c.settings } as any;
    const gm: any = new GameScreen(fakeEngine, num);
    for (let f = 0; f <= 30 * w.secs; f++) gm.enterFrame(1);
    const inPlay = gm.units.filter((u: any) => !u.extra?.noSpawn).length;
    if (inPlay < w.want) {
      note(num, `only ${inPlay}/${w.want} units in play after ${w.secs}s — a wave never arrived`);
    }
    const stranded = gm.units.filter((u: any) => u.extra?.noSpawn).length;
    if (stranded) note(num, `${stranded} bot(s) still parked after ${w.secs}s`);
    gm.destructor();
  }
  console.log(`waves: reinforcement cues verified on stages ${Object.keys(WAVES).join(", ")}`);
}

console.log(`\n=== ${kitSeen.size} distinct bot kits ===`);
for (const k of [...kitSeen].slice(0, 10)) console.log("  " + k);
console.log("\nlevels used:", [...maps].sort().join(", "));
console.log("campaignMap fallbacks:", ["nosuch", "space2", "city2", "tutq2"].map((m) => `${m}->${campaignMap(m)}`).join(", "));

if (problems.length) {
  console.error(`\nCAMPAIGN FAILED: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("\nCAMPAIGN_OK");
