// Headless layout audit for the front-end screens.
//
// Builds every menu screen against the pixi stub, walks the resulting display
// tree computing world-space bounds, and reports anything drawn outside the
// stage or intruding into a region another element owns. It guards the class of
// bug these screens kept regressing into: geometry written for the original
// 700x600 Flash stage, or a tile grid whose row count outgrew the space
// reserved for it.
//
// Text metrics are approximated by the stub (no font engine), so the off-stage
// scan runs with a small tolerance band rather than asserting to the pixel.

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
  addEventListener(type: string, fn: (e: any) => void) { (listeners[type] ??= []).push(fn); },
  removeEventListener(type: string, fn: (e: any) => void) {
    const arr = listeners[type];
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
};
// Screens with a text field (Customize's profile name, Multiplayer's login)
// overlay a real <input> on the canvas via `net/DomInput`. It lives outside the
// Pixi tree so it is never measured here, but it must not throw on construction.
(globalThis as any).document = {
  hidden: false,
  fonts: undefined,
  createElement: () => ({
    style: {},
    value: "",
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    focus() {},
    blur() {},
    setAttribute() {},
  }),
  body: { appendChild() {}, removeChild() {} },
  // LoaderScreen injects @font-face rules for the kit fonts on construction.
  head: { appendChild() {} },
};

import { GAME_WIDTH, GAME_HEIGHT } from "../src/core/Config";
import { SD } from "../src/state/SD";
import type { Screen } from "../src/core/Screen";
import { MenuScreen } from "../src/screens/MenuScreen";
import { PlayScreen } from "../src/screens/PlayScreen";
import { CampaignScreen } from "../src/screens/CampaignScreen";
import { ArmoryScreen } from "../src/screens/ArmoryScreen";
import { ArmoryBrowseScreen } from "../src/screens/ArmoryBrowseScreen";
import { OptionsScreen } from "../src/screens/OptionsScreen";
import { StatsScreen } from "../src/screens/StatsScreen";
import { InfoScreen } from "../src/screens/InfoScreen";
import { ScoresScreen } from "../src/screens/ScoresScreen";
import { CustomizeScreen } from "../src/screens/CustomizeScreen";
import { LoaderScreen } from "../src/screens/LoaderScreen";
import { MultiplayerScreen } from "../src/screens/MultiplayerScreen";

const fakeEngine: any = {
  app: { canvas: undefined },
  root: { addChild() {} },
  overlay: {},
  setScreen() { return null; },
};

/** Slack (px) allowed outside the stage before a node is reported. Absorbs the
 *  stub's approximate text metrics and 1-2px decorative strokes. */
const SLACK = 6;

interface Box { x0: number; y0: number; x1: number; y1: number }
interface Node { path: string; box: Box; node?: any }

/** Local-space extent of one node, or null when it draws nothing measurable. */
function localBox(n: any): Box | null {
  const ctor = n?.constructor?.name;
  if (ctor === "Text" || ctor === "Sprite") {
    // Only sprites the screen explicitly sized (background plates, map
    // previews) have known dimensions here; unsized art has no texture to
    // measure against.
    const w = typeof n.width === "number" && isFinite(n.width) ? n.width : 0;
    const h = typeof n.height === "number" && isFinite(n.height) ? n.height : 0;
    if (!w || !h) return null;
    return {
      x0: -n.anchor.x * w, y0: -n.anchor.y * h,
      x1: (1 - n.anchor.x) * w, y1: (1 - n.anchor.y) * h,
    };
  }
  return n?.localBounds ?? null;
}

/**
 * Walk a subtree accumulating world transforms, collecting a box per drawn
 * node. A node carrying a `mask` is a clipped viewport (the credits screen's
 * scrolling column), so its subtree is deliberately larger than the stage and
 * is skipped — the mask itself is a normal child and is still measured.
 */
function collect(
  node: any, path: string, ox: number, oy: number, sx: number, sy: number,
  out: Node[], masked = false,
): void {
  if (!node || node.visible === false) return;
  const clipped = masked || !!node.mask;

  const px = node.pivot?.x ?? 0;
  const py = node.pivot?.y ?? 0;
  const nsx = sx * (node.scale?.x ?? 1);
  const nsy = sy * (node.scale?.y ?? 1);
  // world = parent origin + this node's (already parent-scaled) offset, then
  // the pivot backed out at the node's own scale.
  const wx = ox + (node.x ?? 0) * sx - px * nsx;
  const wy = oy + (node.y ?? 0) * sy - py * nsy;

  const b = clipped ? null : localBox(node);
  if (b) {
    const label = node.constructor?.name === "Text"
      ? `Text("${String(node.text).slice(0, 34).replace(/\n/g, " ")}")`
      : node.constructor?.name;
    out.push({
      path: `${path} > ${label}`,
      box: { x0: wx + b.x0 * nsx, y0: wy + b.y0 * nsy, x1: wx + b.x1 * nsx, y1: wy + b.y1 * nsy },
      node,
    });
  }

  const kids = node.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    collect(kids[i], `${path}[${i}]`, wx, wy, nsx, nsy, out, clipped);
  }
}

function nodesOf(root: any, path: string): Node[] {
  const out: Node[] = [];
  collect(root, path, 0, 0, 1, 1, out);
  return out;
}

/** Union of every measured box in a subtree, or null when it draws nothing. */
function union(nodes: Node[]): Box | null {
  if (!nodes.length) return null;
  return nodes.reduce<Box>((a, n) => ({
    x0: Math.min(a.x0, n.box.x0), y0: Math.min(a.y0, n.box.y0),
    x1: Math.max(a.x1, n.box.x1), y1: Math.max(a.y1, n.box.y1),
  }), { ...nodes[0].box });
}

// --- alignment invariants ---------------------------------------------------
// Guards the class of defect the Quick Match screen shipped with: a stepper's
// label, value and chevrons each placed off a common top edge by a different
// hand-tuned nudge, so nothing shared a centre line and the value sat ~9px left
// of the gap between its arrows. Checked on every screen so it cannot come back
// somewhere else.

const CHEVRON_PREV = "\u2039";
const CHEVRON_NEXT = "\u203a";

/** Centres are exact under the stub (anchors are honoured), so the tolerance
 *  only has to absorb rounding, not font-metric guesswork. */
const CENTRE_SLACK = 1.5;

function isText(n: Node): boolean {
  return n.node?.constructor?.name === "Text" && String(n.node.text ?? "").trim() !== "";
}
const midX = (n: Node) => (n.box.x0 + n.box.x1) / 2;
const midY = (n: Node) => (n.box.y0 + n.box.y1) / 2;

/** A `‹ value ›` cluster must put its value on the chevrons' centre line and at
 *  the exact midpoint between them. */
function checkSteppers(nodes: Node[]): string[] {
  const msgs: string[] = [];
  const texts = nodes.filter(isText);
  const prevs = texts.filter((n) => n.node.text === CHEVRON_PREV);
  const nexts = texts.filter((n) => n.node.text === CHEVRON_NEXT);

  for (const p of prevs) {
    const next = nexts.find((q) => Math.abs(midY(q) - midY(p)) < CENTRE_SLACK && midX(q) > midX(p));
    if (!next) continue; // a lone chevron is a carousel edge affordance, not a row
    const mid = (midX(p) + midX(next)) / 2;
    for (const b of texts) {
      if (b === p || b === next) continue;
      if (midX(b) <= midX(p) || midX(b) >= midX(next)) continue;
      if (Math.abs(midY(b) - midY(p)) > 14) continue;
      if (Math.abs(midX(b) - mid) > CENTRE_SLACK) {
        msgs.push(`stepper value "${b.node.text}" centre x=${midX(b).toFixed(1)}, chevron midpoint ${mid.toFixed(1)}`);
      }
      if (Math.abs(midY(b) - midY(p)) > CENTRE_SLACK) {
        msgs.push(`stepper value "${b.node.text}" centre y=${midY(b).toFixed(1)}, chevrons ${midY(p).toFixed(1)}`);
      }
    }
  }
  return msgs;
}

/** Two text runs drawn on top of one another. Requires a substantial overlap so
 *  the stub's approximate advance widths don't manufacture failures. */
function checkTextOverlap(nodes: Node[]): string[] {
  const texts = nodes.filter(isText).filter((n) => (n.node.alpha ?? 1) > 0.05);
  const msgs: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const ox = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
      const oy = Math.min(a.box.y1, b.box.y1) - Math.max(a.box.y0, b.box.y0);
      if (ox <= 5 || oy <= 5) continue;
      const areaA = (a.box.x1 - a.box.x0) * (a.box.y1 - a.box.y0);
      const areaB = (b.box.x1 - b.box.x0) * (b.box.y1 - b.box.y0);
      if (ox * oy < 0.4 * Math.min(areaA, areaB)) continue;
      msgs.push(`"${a.node.text}" collides with "${b.node.text}" (${ox.toFixed(0)}x${oy.toFixed(0)}px)`);
    }
  }
  return msgs;
}

/** Explicit click targets must be big enough to actually hit. */
function checkHitAreas(root: any): string[] {
  const msgs: string[] = [];
  const walk = (n: any): void => {
    if (!n || n.visible === false) return;
    const ha = n.hitArea;
    if (ha && typeof ha.width === "number" && (ha.width < 20 || ha.height < 20)) {
      msgs.push(`hit area only ${ha.width}x${ha.height}px`);
    }
    for (const k of n.children ?? []) walk(k);
  };
  walk(root);
  return msgs;
}

let failures = 0;

function fail(name: string, msg: string): void {
  failures++;
  console.log(`FAIL ${name}: ${msg}`);
}

/**
 * @param extra optional per-screen assertions run against the built screen;
 *              return a message to fail, or null to pass.
 */
function check(
  name: string,
  build: () => Screen,
  note = "",
  extra?: (s: any) => string | null,
): void {
  const screen = build();
  const all = nodesOf(screen.view, name);

  const off = all.filter((n) =>
    n.box.x0 < -SLACK || n.box.y0 < -SLACK ||
    n.box.x1 > GAME_WIDTH + SLACK || n.box.y1 > GAME_HEIGHT + SLACK);

  if (off.length) {
    fail(name + note, `${off.length} node(s) outside the ${GAME_WIDTH}x${GAME_HEIGHT} stage`);
    for (const o of off.slice(0, 6)) {
      console.log(
        `   ${o.path}  x ${o.box.x0.toFixed(0)}..${o.box.x1.toFixed(0)}  y ${o.box.y0.toFixed(0)}..${o.box.y1.toFixed(0)}`,
      );
    }
  }

  const align = [...checkSteppers(all), ...checkTextOverlap(all), ...checkHitAreas(screen.view)];
  if (align.length) {
    fail(name + note, `${align.length} alignment defect(s)`);
    for (const a of align.slice(0, 8)) console.log(`   ${a}`);
  }

  const msg = extra?.(screen);
  if (msg) fail(name + note, msg);
  if (!off.length && !align.length && !msg) console.log(`ok   ${name}${note}`);

  screen.destructor();
}

/** Assert a named subtree's content stays above `limit`. */
function mustClear(root: any, label: string, limit: number): string | null {
  const box = union(nodesOf(root, label));
  if (box && box.y1 > limit + 1) {
    return `${label} reaches y=${box.y1.toFixed(0)}, past the ${limit} reserved for the button bar`;
  }
  return null;
}

/**
 * Assert one subtree starts below another ends — two stacked bands of chrome
 * that must not run into each other.
 *
 * Guards the defect the armory shipped with: three of its four tabs positioned
 * their tile grid at a literal y that sat 10px *inside* the row of category
 * buttons above it, so the top row of tiles was drawn across the tab labels.
 * A whole-stage bounds check cannot see this — both bands are comfortably on
 * screen, they just occupy the same pixels.
 *
 * Returns null when either band is empty (a tab with no sub-tabs is legitimate).
 */
function mustSitBelow(above: any, below: any, aLabel: string, bLabel: string): string | null {
  const a = union(nodesOf(above, aLabel));
  const b = union(nodesOf(below, bLabel));
  if (!a || !b) return null;
  if (b.y0 < a.y1 - 1) {
    return `${bLabel} starts at y=${b.y0.toFixed(0)}, ` +
      `${(a.y1 - b.y0).toFixed(0)}px inside ${aLabel} (which ends at y=${a.y1.toFixed(0)})`;
  }
  return null;
}

SD.init();

check("MenuScreen", () => new MenuScreen(fakeEngine));
check("PlayScreen", () => new PlayScreen(fakeEngine));
check("CampaignScreen", () => new CampaignScreen(fakeEngine));
check("OptionsScreen", () => new OptionsScreen(fakeEngine));
check("StatsScreen", () => new StatsScreen(fakeEngine));
check("InfoScreen", () => new InfoScreen(fakeEngine));
check("ScoresScreen", () => new ScoresScreen(fakeEngine));

check("ArmoryScreen", () => new ArmoryScreen(fakeEngine));
check("CustomizeScreen", () => new CustomizeScreen(fakeEngine));
check("LoaderScreen", () => new LoaderScreen(fakeEngine));
check("MultiplayerScreen", () => new MultiplayerScreen(fakeEngine));

/** The four Weapons/Skins/Equipment/Abilities buttons as one measurable band. */
function modeRowOf(s: any): any {
  return { visible: true, children: Object.values(s.modeBtns).map((b: any) => b.view) };
}

// The browse sub-view's four modes and every sub-tab are separate layouts. The
// Human skins tab (15 tiles over 5 columns) is three rows deep and used to end
// 642px down a 639px stage, sitting on top of the Back button.
for (const [mode, tabs] of [["weapons", 7], ["skins", 4], ["equipment", 3], ["abilities", 1]] as const) {
  for (let tab = 0; tab < tabs; tab++) {
    check("ArmoryBrowseScreen", () => {
      const s: any = new ArmoryBrowseScreen(fakeEngine, mode);
      s.catIdx = tab;
      s.refresh();
      return s;
    }, `  [${mode} / tab ${tab}]`, (s) =>
      mustClear(s.grid, "tile grid", GAME_HEIGHT - 70)
      ?? mustSitBelow(s.tabRow, s.grid, "sub-tab row", "tile grid")
      ?? mustSitBelow(modeRowOf(s), s.tabRow, "mode tab row", "sub-tab row"));
  }
}

if (failures > 0) {
  console.log(`\n${failures} screen layout(s) failed`);
  process.exit(1);
}
console.log("LAYOUT_OK");
