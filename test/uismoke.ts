// Headless front-end smoke test. Constructs every menu screen against the pixi
// stub and ticks it, so a broken constructor or enterFrame is caught without a
// browser. Rendering is a no-op; this only proves the screens build and run.

const listeners: Record<string, Array<(e: any) => void>> = {};

(globalThis as any).localStorage = {
  store: {} as Record<string, string>,
  getItem(k: string) { return this.store[k] ?? null; },
  setItem(k: string, v: string) { this.store[k] = v; },
  removeItem(k: string) { delete this.store[k]; },
};
(globalThis as any).window = {
  open() {},
  devicePixelRatio: 1,
  addEventListener(type: string, fn: (e: any) => void) {
    (listeners[type] ??= []).push(fn);
  },
  removeEventListener(type: string, fn: (e: any) => void) {
    const arr = listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
};

/** Dispatch a synthetic keydown to every registered window listener. */
function key(code: string): void {
  for (const fn of [...(listeners["keydown"] ?? [])]) {
    fn({ code, altKey: false, ctrlKey: false, metaKey: false, repeat: false, preventDefault() {} });
  }
}

import { SD } from "../src/state/SD";
import { Quality } from "../src/state/Quality";
import type { Screen, ScreenClass } from "../src/core/Screen";
import { MenuScreen } from "../src/screens/MenuScreen";
import { CampaignScreen } from "../src/screens/CampaignScreen";
import { StatsScreen } from "../src/screens/StatsScreen";
import { Achievements, R2_ACH_IDS } from "../src/game/Achievements";
import { InfoScreen } from "../src/screens/InfoScreen";

let requested: ScreenClass | null = null;
const fakeEngine: any = {
  app: {},
  root: { addChild() {} },
  overlay: {},
  setScreen(ctor: ScreenClass) {
    requested = ctor;
    return null;
  },
};

function make<T extends Screen>(Ctor: new (e: any, a?: unknown) => T): T {
  requested = null;
  return new Ctor(fakeEngine);
}

SD.init();

// --- menu hotkeys ----------------------------------------------------------
{
  SD.setQuality("high");
  SD.setNoGlow(false);
  SD.sound = true;
  SD.music = true;

  const s = make(MenuScreen);
  const panel: any = (s as any).optionsPanel;
  if (panel.visible) throw new Error("options panel should start hidden");

  key("KeyQ");
  if (!panel.visible) throw new Error("[Q] did not open the options panel");
  if (Quality.level !== "max") throw new Error(`[Q] did not cycle quality (got ${Quality.level})`);

  key("KeyG");
  if (!SD.noGlow) throw new Error("[G] did not toggle glow off");
  key("KeyG");
  if (SD.noGlow) throw new Error("[G] did not toggle glow back on");

  key("KeyM");
  if (SD.music) throw new Error("[M] did not toggle music off");
  key("KeyS");
  if (SD.sound) throw new Error("[S] did not toggle sound off");
  key("KeyM");
  key("KeyS");
  if (!SD.music || !SD.sound) throw new Error("audio hotkeys are not symmetric");

  key("Escape");
  if (panel.visible) throw new Error("[Esc] did not close the options panel");

  s.enterFrame(1);
  s.destructor();
  key("KeyQ"); // must be inert now
  console.log("MenuScreen: Q/G/M/S/Esc hotkeys work and unbind on destroy");
}

// --- campaign unlock states ------------------------------------------------
{
  // The authentic two-screen flow (doc 13 §2): a Campaign Select plate, then a
  // 15-row mission list per species with unlocked / current / locked per row.
  SD.curStage = 5;
  const s = make(CampaignScreen);
  const rows: any[] = (s as any).rows;
  if (rows.length !== 15) throw new Error(`expected 15 mission rows, got ${rows.length}`);
  const row = (num: number) => rows.find((r) => r.num === num);
  if (!row(4).numText.text.startsWith("4.")) {
    throw new Error(`completed mission should show its number: ${row(4).numText.text}`);
  }
  if ((s as any).selected !== 5) throw new Error("current stage should be selected by default");
  if (row(6).titleText.text !== "Beat level 5 to unlock") {
    throw new Error(`locked row copy wrong: ${row(6).titleText.text}`);
  }
  if (row(6).state !== 4) throw new Error("locked row should wear the padlock state");
  if (row(5).state !== 3) throw new Error("current row should wear the selected state");
  for (let i = 0; i < 10; i++) s.enterFrame(1);
  s.destructor();

  // Deeper progress unlocks more rows.
  SD.curStage = 7;
  const s2 = make(CampaignScreen);
  const rows2: any[] = (s2 as any).rows;
  if (!rows2.find((r) => r.num === 7).numText.text.startsWith("7.")) {
    throw new Error("stage 7 should be unlocked at curStage 7");
  }
  if (rows2.find((r) => r.num === 8).titleText.text !== "Beat level 7 to unlock") {
    throw new Error("stage 8 should still be locked");
  }
  s2.destructor();

  // Alien campaign: rows number 1..15 (local), and the "Beat level N" copy is
  // local too — Menu.as writes the row's index, not the absolute stage.
  SD.curStage = 20;
  const s3 = make(CampaignScreen);
  (s3 as any).enterCampaign(true);
  const rows3: any[] = (s3 as any).rows;
  if ((s3 as any).selected !== 20) {
    throw new Error(`alien entry should select the current stage, got ${(s3 as any).selected}`);
  }
  const row3 = (num: number) => rows3.find((r) => r.num === num);
  if (!row3(16).numText.text.startsWith("1.")) {
    throw new Error(`alien mission 1 should be numbered locally: ${row3(16).numText.text}`);
  }
  if (row3(21).titleText.text !== "Beat level 5 to unlock") {
    throw new Error(`alien locked row copy wrong: ${row3(21).titleText.text}`);
  }
  s3.destructor();
  console.log("CampaignScreen: 15-row list, locked/current/unlocked states ok");
}

// --- stats reset flow ------------------------------------------------------
{
  SD.stats.kills = 11;
  SD.medals["headshot"] = true;
  const s = make(StatsScreen);
  const confirm: any = (s as any).confirm;
  if (confirm.visible) throw new Error("confirm dialog should start hidden");

  (s as any).askReset();
  if (!confirm.visible) throw new Error("RESET STATS did not raise the confirmation");
  key("Escape");
  if (confirm.visible) throw new Error("[Esc] did not dismiss the confirmation");
  if (SD.stats.kills !== 11) throw new Error("cancelling still cleared the stats");

  (s as any).askReset();
  (s as any).doReset();
  if (SD.stats.kills !== 0 || Object.keys(SD.medals).length !== 0) {
    throw new Error("confirming did not clear stats/medals");
  }
  if (confirm.visible) throw new Error("confirm dialog stayed up after clearing");
  if (!(s as any).toast.visible) throw new Error("no success message after reset");
  for (let i = 0; i < 120; i++) s.enterFrame(1);
  if ((s as any).toast.visible) throw new Error("success message never faded out");
  s.destructor();
  console.log("StatsScreen: reset confirmation, clear and toast ok");
}

// --- the achievements list is a list, not a trophy case ---------------------
// The menu's ACHIEVEMENTS entry routes here, and the panel used to show only
// medals already earned. Four of the ten achievements are secrets whose only
// hint is their own description, so a filtered list made them undiscoverable:
// all ten must be present whether locked or not.
{
  SD.medals = {} as any;
  const s = make(StatsScreen);
  const texts = (s as any).medalsContent.children
    .filter((c: any) => typeof c.text === "string")
    .map((c: any) => c.text as string);
  for (const id of R2_ACH_IDS) {
    const m = Achievements.getAch(id);
    if (!texts.includes(m.name)) throw new Error(`achievement "${id}" is missing from the list`);
    if (!texts.includes(m.desc)) throw new Error(`achievement "${id}" lists no hint text`);
  }
  // A list that overflows its panel has to be reachable.
  if ((s as any).maxScroll <= 0) throw new Error("ten rows fit the panel? the scroller is dead");
  key("ArrowDown");
  if ((s as any).scroll === 0) throw new Error("arrow keys do not scroll the award list");
  for (let i = 0; i < 50; i++) key("ArrowDown");
  if ((s as any).scroll !== (s as any).maxScroll) throw new Error("scroll did not clamp at the end");
  for (let i = 0; i < 60; i++) key("ArrowUp");
  if ((s as any).scroll !== 0) throw new Error("scroll did not clamp at the top");
  // ...but not while the modal is up.
  (s as any).askReset();
  key("ArrowDown");
  if ((s as any).scroll !== 0) throw new Error("the list scrolled behind the confirm dialog");
  key("Escape");
  s.destructor();

  // Earned medals join the list below the achievements; earned achievements
  // stay in place rather than duplicating.
  SD.medals = { headshot: true, cat: true } as any;
  const s2 = make(StatsScreen);
  const names = (s2 as any).medalsContent.children
    .filter((c: any) => typeof c.text === "string")
    .map((c: any) => c.text as string);
  if (!names.includes(Achievements.getAch("headshot").name)) {
    throw new Error("an earned Raze 1 medal dropped off the list");
  }
  if (names.filter((t: string) => t === Achievements.getAch("cat").name).length !== 1) {
    throw new Error("an earned achievement was listed twice");
  }
  s2.destructor();
  SD.medals = {} as any;
  console.log("StatsScreen: all 10 achievements list (locked included), scroll clamps, medals append");
}

// --- about / credits screen -------------------------------------------------
{
  // Rebuilt on the original Credits plate: a static screen with Esc/Back out.
  const s = make(InfoScreen);
  s.enterFrame(1);
  key("Escape");
  if (requested !== (MenuScreen as unknown as ScreenClass)) {
    throw new Error("[Esc] did not close the credits screen");
  }
  s.destructor();
  console.log("InfoScreen: credits plate builds and closes");
}

if ((listeners["keydown"] ?? []).length !== 0) {
  throw new Error(`screens leaked ${listeners["keydown"].length} keydown listeners`);
}

console.log("UI_SMOKE_OK");
