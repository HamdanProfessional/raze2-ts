import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";

/**
 * Ported from Level.as.
 *
 * Level in the original was the level-name registry plus four per-level
 * helpers:
 *   - getPaintSize(id)   → BitmapData scale used by the original Painter
 *                           (1×, 1.2×, 1.4×, 1.5× — by level). Unused in the
 *                           TS port (no persistent wall paint), but kept
 *                           here for parity.
 *   - getWpConnectors(id) → the AI waypoint graph for that level
 *                           (used by AI.patrol to walk between nodes).
 *   - getWp(id)          → the per-level list of (x, y, name) waypoints.
 *   - getSpawnNodes(id)  → spawn points for that level.
 *
 * The four playable levels in this port (city/space/toxic/pit) are built
 * directly in game/Arena.ts with its own Arena-specific node types
 * (Arena.SpawnNode / Arena.WayNode, which include a `taken` flag and a
 * `actions` list for jump nodes). This module adds the AI-waypoint graph
 * for each level so AI.patrol can find a connected set of (x, y) walk
 * targets; the types are distinct (LevelSpawn / LevelWaypoint) so there's
 * no name collision with Arena.
 *
 * `tut`, `test`, `base` are also defined here for compatibility with the
 * campaign data in game/Campaign.ts.
 */

export type LevelId = "city" | "space" | "toxic" | "pit" | "tut" | "test" | "base";

export interface LevelWaypoint {
  name: string;
  x: number;
  y: number;
  connects: string[];
}

export interface LevelSpawn {
  name: string;
  x: number;
  y: number;
}

/** Map of every playable level id -> paint scale used by Painter. */
const PAINT_SIZE: Record<LevelId, number> = {
  toxic: 1,
  city: 1.2,
  pit: 1,
  space: 1.4,
  tut: 1.5,
  test: 1.5,
  base: 1.5,
};

export function getPaintSize(id: string): number {
  return PAINT_SIZE[(id as LevelId)] ?? 1;
}

/** Order of levels as shown in the original menu carousel. */
export const LEVEL_LIST: LevelId[] = ["test", "toxic", "city", "base", "space", "pit"];

// --- Per-level waypoint + spawn data --------------------------------------

const CITY_WP: LevelWaypoint[] = [
  { name: "leftPlat",   x: 110, y: 380, connects: ["leftTop", "leftHole", "midPlat"] },
  { name: "leftHole",   x: 130, y: 540, connects: ["leftPlat", "midFloor", "rightHole"] },
  { name: "leftTop",    x:  60, y: 230, connects: ["leftPlat", "midPlat"] },
  { name: "leftCorner", x:  40, y: 170, connects: ["leftTop"] },
  { name: "midFloor",   x: 350, y: 530, connects: ["leftHole", "rightHole", "leftPlat", "rightPlat"] },
  { name: "midPlat",    x: 350, y: 280, connects: ["leftTop", "rightTop", "leftPlat", "rightPlat"] },
  { name: "rightPlat",  x: 590, y: 380, connects: ["rightTop", "rightHole", "midPlat", "midFloor"] },
  { name: "rightHole",  x: 570, y: 540, connects: ["rightPlat", "midFloor"] },
  { name: "rightTop",   x: 640, y: 230, connects: ["rightPlat", "midPlat"] },
  { name: "rightCorner",x: 660, y: 170, connects: ["rightTop"] },
];

const CITY_SPAWN: LevelSpawn[] = [
  { name: "leftPlat",  x: 110, y: 360 },
  { name: "leftTop",   x:  60, y: 210 },
  { name: "midFloor",  x: 350, y: 510 },
  { name: "midPlat",   x: 350, y: 260 },
  { name: "rightPlat", x: 590, y: 360 },
  { name: "rightTop",  x: 640, y: 210 },
];

const SPACE_WP: LevelWaypoint[] = [
  { name: "TopL",   x: 120, y: 240, connects: ["TopM", "PlatLT"] },
  { name: "TopM",   x: 350, y: 220, connects: ["TopL", "TopR", "PlatLT", "PlatRT"] },
  { name: "TopR",   x: 580, y: 240, connects: ["TopM", "PlatRT"] },
  { name: "PlatLT", x: 200, y: 360, connects: ["TopL", "TopM", "BotL"] },
  { name: "PlatRT", x: 500, y: 360, connects: ["TopM", "TopR", "BotR"] },
  { name: "BotL",   x: 120, y: 480, connects: ["PlatLT", "BotM"] },
  { name: "BotR",   x: 580, y: 480, connects: ["PlatRT", "BotM"] },
  { name: "BotM",   x: 350, y: 520, connects: ["BotL", "BotR"] },
];

const SPACE_SPAWN: LevelSpawn[] = [
  { name: "TopL",   x: 120, y: 220 },
  { name: "TopM",   x: 350, y: 200 },
  { name: "TopR",   x: 580, y: 220 },
  { name: "PlatLT", x: 200, y: 340 },
  { name: "PlatRT", x: 500, y: 340 },
  { name: "BotL",   x: 120, y: 460 },
  { name: "BotR",   x: 580, y: 460 },
];

const TOXIC_WP: LevelWaypoint[] = [
  { name: "TopL",   x: 130, y: 230, connects: ["TopM", "PlatLT"] },
  { name: "TopM",   x: 350, y: 210, connects: ["TopL", "TopR", "PlatLT", "PlatRT"] },
  { name: "TopR",   x: 570, y: 230, connects: ["TopM", "PlatRT"] },
  { name: "PlatLT", x: 200, y: 340, connects: ["TopL", "TopM", "BotL"] },
  { name: "PlatRT", x: 500, y: 340, connects: ["TopM", "TopR", "BotR"] },
  { name: "BotL",   x: 150, y: 480, connects: ["PlatLT", "BotM"] },
  { name: "BotR",   x: 550, y: 480, connects: ["PlatRT", "BotM"] },
  { name: "BotM",   x: 350, y: 510, connects: ["BotL", "BotR"] },
];

const TOXIC_SPAWN: LevelSpawn[] = [
  { name: "TopL",   x: 130, y: 210 },
  { name: "TopR",   x: 570, y: 210 },
  { name: "PlatLT", x: 200, y: 320 },
  { name: "PlatRT", x: 500, y: 320 },
  { name: "BotL",   x: 150, y: 460 },
  { name: "BotR",   x: 550, y: 460 },
];

const PIT_WP: LevelWaypoint[] = [
  { name: "RingL", x: 180, y: 360, connects: ["RingM", "RingR"] },
  { name: "RingM", x: 350, y: 320, connects: ["RingL", "RingR"] },
  { name: "RingR", x: 520, y: 360, connects: ["RingL", "RingM"] },
  { name: "Pit",   x: 350, y: 530, connects: ["RingL", "RingR"] },
];

const PIT_SPAWN: LevelSpawn[] = [
  { name: "RingL", x: 180, y: 340 },
  { name: "RingR", x: 520, y: 340 },
  { name: "Pit",   x: 350, y: 510 },
];

const LEVEL_DATA: Record<LevelId, { wp: LevelWaypoint[]; spawn: LevelSpawn[] }> = {
  city:  { wp: CITY_WP,   spawn: CITY_SPAWN },
  space: { wp: SPACE_WP,  spawn: SPACE_SPAWN },
  toxic: { wp: TOXIC_WP,  spawn: TOXIC_SPAWN },
  pit:   { wp: PIT_WP,    spawn: PIT_SPAWN },
  tut:   { wp: CITY_WP,   spawn: CITY_SPAWN.slice(0, 1) },
  test:  { wp: CITY_WP,   spawn: CITY_SPAWN },
  base:  { wp: TOXIC_WP,  spawn: TOXIC_SPAWN },
};

/** Get the waypoint graph for `id`. Empty array if the id is unknown. */
export function getWp(id: string): LevelWaypoint[] {
  return LEVEL_DATA[(id as LevelId)]?.wp ?? [];
}

/** Get the spawn-point list for `id`. */
export function getSpawnNodes(id: string): LevelSpawn[] {
  return LEVEL_DATA[(id as LevelId)]?.spawn ?? [];
}

/** Convert the waypoint list into the AI connect map used by Arena. */
export function getWpConnectors(id: string): { node: string; connect: string[] }[] {
  return getWp(id).map((w) => ({ node: w.name, connect: w.connects }));
}

/** Initialise (placeholder — Level.init() in the original was a no-op). */
export function init(): void {
  // The original just filled Level.levelList with the order string. Nothing
  // to do in TS — the level list is the `LEVEL_LIST` const above.
}

/** Floor Y used by Arena (kept here for parity with the original API). */
export function getFloorY(): number {
  return GAME_HEIGHT - 70;
}

/** Right-edge x used by AI patrol algorithms as a "wall" check. */
export function getRightWall(): number {
  return GAME_WIDTH;
}
