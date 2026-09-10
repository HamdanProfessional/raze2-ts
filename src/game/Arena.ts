import { Container, Graphics, Sprite } from "pixi.js";
import type { Texture } from "pixi.js";
import { GAME_WIDTH, GAME_HEIGHT, CAMERA_ZOOM } from "../core/Config";
import type { WallRect } from "../physics/Phys";
import { SD } from "../state/SD";
import { Quality } from "../state/Quality";
import { Backgrounds } from "../assets/Backgrounds";
import { WallMask, WallMasks } from "./WallMask";
import { AmbientParticles, themeForMap } from "./Particles";
import { PickupItem, type PickupItemSpec } from "../game/PickupItem";
import { PickupWeapon, type PickupWeaponSpec } from "../game/PickupWeapon";
import LEVEL_DATA from "../assets/levelData.json";
import RAZE2_MAPS from "../assets/raze2maps.json";
import { WEAPONS } from "./weapons";

/**
 * Pull in the backdrop and collision mask `level` needs. The Arena constructor
 * reads both synchronously out of their caches, and neither is preloaded at
 * boot any more (all ten maps together are 90 MB of art and ~100M pixels of
 * mask decoding), so this has to resolve before a match is built.
 */
export function preloadLevel(level: string): Promise<void> {
  return Promise.all([Backgrounds.ensureLevel(level), WallMasks.ensure(level)]).then(() => {});
}

/** Raze 2 item-pickup kind → this port's PickupItem kind. */
const RAZE2_ITEM_KIND: Record<string, string> = {
  health: "health",
  shealth: "healthBig", // super health
  shield: "shield",
  bshield: "shieldBig", // big shield
  damage: "ddamage", // double damage
  invin: "invin",
  fade: "fade",
  cloak: "fade",
  rapid: "ddamage", // no rapid-fire item in this port; nearest offensive buff
};

/** Raze 2 map definition (pixel-mask collision + extracted node data). */
interface Raze2MapDef {
  w: number;
  h: number;
  mask: string;
  /** Maps whose collision geometry is swapped at runtime list every variant
   *  here, `mask` being the first. The tutorial is the only one: its walkthrough
   *  opens the level a step at a time by restaging the whole wall layer. */
  frames?: string[];
  bg: string;
  /** The map's authored navigation graph, when we have it. Without one the bots
   *  fall back to a mesh over the spawn points, which is fine for an arena but
   *  cannot express a route — the tutorial's guide has to walk a fixed chain. */
  waypoints?: { name: string; x: number; y: number; connects: string[] }[];
  spawns: [number, number][];
  ctf: [number, number][];
  hold: [number, number][];
  /** [x, y, rawname] where rawname = `{p|w}_{kind}_{respawnSecs}`. */
  pickups: [number, number, string][];
  /** Cyan jump-pad bands from the wall mask: [x, y, w, h, power?, dirX?].
   *  power = launch multiplier (tier 1.2×–3.3×), dirX = horizontal kick for the
   *  5 diagonal variants (0 for straight pads). Extracted from the authentic
   *  `00fff*`/`00ccf*` wall colours (doc 12 §2.3). */
  jumpPads: [number, number, number, number, number?, number?][];
}

/** Authentic level definition (world size, collision rects, spawn points). */
interface LevelDef {
  w: number;
  h: number;
  walls: [number, number, number, number][];
  spawns: [number, number][];
  /** Authentic power-up placements lifted from the SWF Arena frame. */
  items?: { kind: string; x: number; y: number; respawn: number }[];
  /** Authentic weapon-drop placements lifted from the SWF Arena frame. */
  weapons?: { type: string; x: number; y: number; respawn: number }[];
  /** Arena boundary (the cyan play-box in the art): [x0, y0, x1, y1]. The
   *  container floor/ceiling/side walls are built from this so units cannot fall
   *  through the ground strip below the platforms or walk out of the arena. */
  bounds?: [number, number, number, number];
  /** Jump-boost pads: [x, y, w, h, power?]. A unit that lands on one is flung
   *  up (SWF "Jump Boost" zone). x/y is the pad's top-left; power defaults ~2.3. */
  jumpPads?: [number, number, number, number, number?][];
}

/** A live jump pad (world rect + launch multiplier + horizontal kick). */
export interface JumpPad {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Launch multiplier on the base jump impulse (authentic tiers 1.2×–3.3×). */
  power: number;
  /** Hard horizontal velocity snap for the 5 diagonal pads (0 = straight). */
  dirX: number;
}

/**
 * Level geometry: solid rectangles, spawn points and an AI waypoint graph.
 * Ported from Arena.as + the SideShooterSWF_fla spawn/waypoint data classes.
 *
 * Each playable level (City/Space/Toxic/Pit) has its own distinct platform
 * layout, spawn set and a fully-connected waypoint graph, plus a full-frame
 * background sprite pulled from the preloaded Backgrounds cache. `walls` feeds
 * both the kinematic unit collision and the planck ground body, keeping live
 * characters and ragdolls consistent.
 */

/** Parallax factor for the themed sky layer: it travels at 90% of the world's
 *  scroll speed, so it drifts ~10% relative to the collision-locked map art —
 *  authentic `bg`-vs-`wallMC` depth (doc 12 §3.2) without desyncing platforms. */
const SKY_PARALLAX = 0.9;
/** Grid step (world px) used when scanning the special layer for water. */
const WATER_STEP = 12;

/** Max distance a spawn may sit above its platform and still snap onto it. */
const SPAWN_SNAP = 6;
/** Max feet correction when grounding a spawn — one character height. */
const SPAWN_MAX_FIX = 92;

export interface SpawnNode {
  x: number;
  y: number;
  name: string;
  taken: boolean;
}
export interface WayNode {
  name: string;
  x: number;
  y: number;
  connects: string[];
  actions: { action: string }[];
}

/** Playable levels, with display names for the menu. */
export const LEVELS: { id: string; name: string }[] = [
  { id: "city", name: "City" },
  { id: "space", name: "Space Station" },
  { id: "toxic", name: "Toxic Waste" },
  { id: "pit", name: "The Pit" },
  // Raze 2 maps (pixel-mask collision, extracted from raze-2.swf). Namespaced
  // `r2_` so their ids don't collide with the Raze 1 levels above.
  { id: "r2_jungle", name: "Jungle" },
  { id: "r2_jungle2", name: "Jungle II" },
  { id: "r2_city", name: "City (Raze 2)" },
  { id: "r2_desert", name: "Desert" },
  { id: "r2_ocean", name: "Ocean" },
  { id: "r2_mines", name: "Mines" },
  { id: "r2_mines2", name: "Mines II" },
  { id: "r2_space", name: "Space (Raze 2)" },
  { id: "r2_snow", name: "Snow" },
  { id: "r2_tutq", name: "Quarantine" },
  // Practice arena: one flat platform, every weapon + power-up laid out, infinite
  // ammo, and a key to freeze/unfreeze the bots (see GameScreen). Not authentic.
  { id: "sandbox", name: "Sandbox" },
];

export class Arena {
  readonly view = new Container();
  private bg?: Sprite;
  private geo = new Graphics();

  /** Camera offset (arena is not scrolled yet). */
  x = 0;
  y = 0;

  level: string;
  walls: WallRect[] = [];
  /** Pixel-mask collision for Raze 2 maps (null = rect-collision Raze 1 level).
   *  When present, Unit samples this instead of iterating `walls` for the
   *  interior geometry; the boundary rects still guard the world edges. */
  wallMask: WallMask | null = null;
  spawnNodes: SpawnNode[] = [];
  wayNodes: WayNode[] = [];
  /** CTF flag stands (Raze 2 maps). team 1 = left stand, 2 = right stand. */
  ctfNodes: { x: number; y: number; team: number }[] = [];
  /** Domination control points (Raze 2 maps). */
  holdNodes: { x: number; y: number }[] = [];
  humanWP = { x: GAME_WIDTH / 2, y: 0 };
  itemPickups: PickupItem[] = [];
  weapPickups: PickupWeapon[] = [];
  jumpPads: JumpPad[] = [];
  /** Animated overlay for the jump pads (pulsing chevrons). */
  private padGfx = new Graphics();
  /** Master frame counter (drives sky drift, water shimmer, particles, pads). */
  private tick = 0;

  // --- environment polish (Raze 2 maps) ----------------------------------
  /** Themed sky gradient, drawn oversized so it can parallax without gaps. */
  private skyG?: Graphics;
  /** Draw-origin of the sky (top-left of the oversized gradient, world px). */
  private skyHomeX = 0;
  private skyHomeY = 0;
  /** Static darkened tint painted over every water cell. */
  private waterGfx?: Graphics;
  /** Animated surface shimmer over the water (gated by the Lights setting). */
  private waterShimmer?: Graphics;
  /** Topmost water pixel per sampled column (the water surface line). */
  private waterSurface: { x: number; y: number }[] = [];
  /** Whether this map has any water region at all. */
  private hasWater = false;
  /** Per-map ambient particle emitter (dust/ember/snow/bubble). */
  private particles?: AmbientParticles;

  floorY = GAME_HEIGHT - 70;
  /** Full playfield size (world px). Camera clamps to this. */
  worldW = GAME_WIDTH;
  worldH = GAME_HEIGHT;
  /** True when this level uses the authentic SWF art + matched collision. */
  private authentic = false;

  constructor() {
    this.level = String(SD.matchSettings?.level ?? "city");

    // Raze 2 maps are namespaced `r2_<key>` so their ids can't shadow the Raze 1
    // levels (both have a "city"). Only the prefixed form uses the mask path.
    const r2 = this.level.startsWith("r2_")
      ? (RAZE2_MAPS as unknown as Record<string, Raze2MapDef>)[this.level.slice(3)]
      : undefined;
    const data = (LEVEL_DATA as unknown as Record<string, LevelDef>)[this.level];
    if (r2) {
      this.buildRaze2Map(this.level, r2);
      return; // buildRaze2Map spawns its own pickups from node data
    } else if (data) {
      this.buildFromData(this.level, data);
    } else {
      this.addBackground(this.level);
      this.view.addChild(this.geo);
      this.buildLevel(this.level);
      this.drawGeometry();
    }
    this.spawnPickups(this.level);
  }

  /**
   * Authentic level: full-frame SWF art placed 1:1 with collision rectangles
   * extracted from the level's hidden `wall` clip (aligned to the art), plus
   * derived spawn/waypoint nodes. World is larger than the screen; the camera
   * follows the player and clamps to worldW/worldH.
   */
  private buildFromData(level: string, d: LevelDef): void {
    this.worldW = d.w;
    this.worldH = d.h;
    this.floorY = d.h;
    this.authentic = true;

    const tex = Backgrounds.getTexture(`lvl_${level}`) as Texture | null;
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0, 0);
      const w = (tex as any).width || d.w;
      const h = (tex as any).height || d.h;
      sprite.scale.set(d.w / w, d.h / h);
      this.bg = sprite;
      this.view.addChild(sprite);
    } else {
      // No authored backdrop (e.g. the Sandbox): paint a plain world fill so the
      // arena isn't a black void, then draw the collision rects below as solid
      // slabs (drawFlatGeo) since there's no art to show where the floor is.
      const fill = new Graphics();
      fill.rect(0, 0, d.w, d.h).fill({ color: 0x11151b });
      this.view.addChild(fill);
    }
    this.view.addChild(this.geo);

    for (const [x, y, w, h] of d.walls) this.wall(x, y, w, h);

    // Jump-boost pads (flung-up zones). Snap each pad's top to the real surface
    // under its centre so a grounded unit reliably registers on it.
    this.jumpPads = (d.jumpPads ?? []).map(([x, y, w, h, power]) => {
      const gy = this.groundSpawn(x + w / 2, y);
      return { x, y: gy ?? y, w, h, power: power ?? 2.3, dirX: 0 };
    });
    if (this.jumpPads.length) {
      this.view.addChild(this.padGfx);
      this.drawPads();
    }

    // Arena container. The extracted platform mask covers the interior geometry
    // but not the arena's own floor/walls — those are the cyan boundary box in
    // the art. Without them a unit walks off the lowest platform onto the ground
    // strip (which has no mask coverage) and falls straight through the map.
    // Build a floor, ceiling and two side walls at the boundary, inset to the
    // inner edge of the ~24px-thick boundary line so units rest on the visible
    // surface. The floor is extended well below the world so nothing slips past.
    if (d.bounds) {
      const [bx0, by0, bx1, by1] = d.bounds;
      const T = 24; // boundary line thickness (inner edge inset)
      const S = 40; // solid thickness of the container walls
      const bw = bx1 - bx0;
      const bh = by1 - by0;
      this.wall(bx0, by1 - T, bw, this.worldH - (by1 - T) + 80); // floor
      this.wall(bx0, by0 + T - S, bw, S); // ceiling
      this.wall(bx0 + T - S, by0, S, bh); // left wall
      this.wall(bx1 - T, by0, S, bh); // right wall
      // Ground the level's floor reference on the real arena floor.
      this.floorY = by1 - T;
    }

    // Spawn points are extracted data and cannot be trusted to sit on a
    // surface: a few are buried inside the ground mesh (the unit would spawn
    // embedded in the level art and get shoved out — usually downward, through
    // the floor) and a few hang over open space. Ground every one against the
    // real collision rects, and drop the ones with nothing under them at all.
    this.spawnNodes = [];
    d.spawns.forEach(([x, y]) => {
      const gy = this.groundSpawn(x, y);
      if (gy === null) return;
      this.spawnNodes.push({ x, y: gy, name: "s" + this.spawnNodes.length, taken: false });
    });
    // Never leave a level unplayable if the data is degenerate.
    if (!this.spawnNodes.length) {
      this.spawnNodes = d.spawns.map(([x, y], i) => ({ x, y, name: "s" + i, taken: false }));
    }
    const mid = this.spawnNodes[Math.floor(this.spawnNodes.length / 2)];
    this.humanWP = { x: mid.x, y: mid.y };
    this.wayNodes = this.spawnNodes.map((s, i) => ({
      name: s.name, x: s.x, y: s.y,
      connects: this.spawnNodes.filter((_, j) => j !== i).map((o) => o.name),
      actions: [],
    }));

    // Authentic levels show their platforms in the art, so no overlay. Levels
    // with no backdrop (Sandbox) need the collision drawn to be playable.
    this.geo.clear();
    if (!tex) this.drawFlatGeo();
  }

  /**
   * Build a Raze 2 map: pixel-mask collision (no rects), full-world background
   * art, and spawn / jump-pad / pickup nodes extracted from the SWF. World is
   * larger than the screen; the camera follows and clamps to worldW/worldH.
   */
  private buildRaze2Map(level: string, m: Raze2MapDef): void {
    this.worldW = m.w;
    this.worldH = m.h;
    this.floorY = m.h;
    this.authentic = true;
    this.wallMask = WallMasks.get(level);

    // Themed sky behind everything — the extracted backdrop art is transparent
    // where the sky was a separate SWF layer, so without this the empty areas
    // read as a black void. Drawn oversized and parallax-scrolled in enterFrame
    // so it drifts behind the collision-locked map art (depth).
    this.buildSky(level, m.w, m.h);

    const tex = Backgrounds.getTexture(level) as Texture | null;
    if (tex) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0, 0);
      const w = (tex as any).width || m.w;
      const h = (tex as any).height || m.h;
      sprite.scale.set(m.w / w, m.h / h);
      this.bg = sprite;
      this.view.addChild(sprite);
    }

    // Water reflection/tint band over any water terrain (sits above the map art
    // but below the actors). Cheap: a static darkened tint plus a quality-gated
    // animated surface shimmer. Self-gating — only maps with water get it.
    this.buildWater(m);

    // Per-map ambient particles (dust/ember/snow/bubble), density gated by the
    // particle-quality setting. Behind pickups/units, above the backdrop.
    this.particles = new AmbientParticles(themeForMap(level), m.w, m.h);
    this.view.addChild(this.particles.view);

    this.view.addChild(this.geo);

    // Jump pads (cyan surface bands). Snap each pad's top to the surface under
    // its centre. power/dirX are the authentic tier + diagonal kick extracted
    // from the wall `00fff*`/`00ccf*` colours (doc 12 §2.3); older data without
    // them falls back to a sensible mid tier.
    this.jumpPads = (m.jumpPads ?? []).map(([x, y, w, h, power, dirX]) => {
      const gy = this.groundSpawn(x + w / 2, y);
      return { x, y: gy ?? y, w, h, power: power ?? 2.2, dirX: dirX ?? 0 };
    });
    if (this.jumpPads.length) {
      this.view.addChild(this.padGfx);
      this.drawPads();
    }

    // Spawn points, grounded against the mask.
    this.spawnNodes = [];
    for (const [x, y] of m.spawns) {
      const gy = this.groundSpawn(x, y);
      if (gy === null) continue;
      this.spawnNodes.push({ x, y: gy, name: "s" + this.spawnNodes.length, taken: false });
    }
    if (!this.spawnNodes.length) {
      this.spawnNodes = m.spawns.map(([x, y], i) => ({ x, y, name: "s" + i, taken: false }));
    }
    const mid = this.spawnNodes[Math.floor(this.spawnNodes.length / 2)];
    this.humanWP = { x: mid.x, y: mid.y };
    this.wayNodes = m.waypoints
      ? m.waypoints.map((w) => ({
          name: w.name,
          x: w.x,
          y: this.groundSpawn(w.x, w.y) ?? w.y,
          connects: w.connects.slice(),
          actions: [],
        }))
      : this.spawnNodes.map((s, i) => ({
          name: s.name,
          x: s.x,
          y: s.y,
          connects: this.spawnNodes.filter((_, j) => j !== i).map((o) => o.name),
          actions: [],
        }));

    // CTF flag stands: leftmost = team 1, rightmost = team 2. Grounded so the
    // flag base rests on a surface.
    const ctf = (m.ctf ?? []).slice().sort((a, b) => a[0] - b[0]);
    this.ctfNodes = ctf.map(([x, y], i) => ({ x, y: this.groundSpawn(x, y) ?? y, team: i === 0 ? 1 : 2 }));
    // Domination control points.
    this.holdNodes = (m.hold ?? []).map(([x, y]) => ({ x, y: this.groundSpawn(x, y) ?? y }));

    this.geo.clear();
    this.spawnRaze2Pickups(m);
  }

  /**
   * Build the themed sky: a vertical gradient keyed by map theme, drawn behind
   * the (collision-locked) map art. It is drawn *oversized* by the maximum
   * parallax travel on each axis so that scrolling it at `SKY_PARALLAX` of the
   * camera speed (in `enterFrame`) never exposes an edge, and stored on
   * `this.skyG` with its draw-origin in `skyHomeX/Y`.
   */
  private buildSky(level: string, w: number, h: number): void {
    const theme = level.replace(/^r2_/, "").replace(/2$/, "");
    const SKY: Record<string, [number, number]> = {
      jungle: [0x1c3a1e, 0x081206],
      city: [0x3a2438, 0x140a1c],
      desert: [0xcf9a55, 0x5a3a1c],
      ocean: [0x1a4a63, 0x061a28],
      mines: [0x2a1c12, 0x080604],
      space: [0x0a1224, 0x020308],
      snow: [0x8fb0c6, 0x2a3846],
      tutq: [0x2e343c, 0x0e1116],
    };
    const [top, bot] = SKY[theme] ?? [0x1a2230, 0x0a0e14];

    // Max slack the sky slides through over the camera's clamped travel, on
    // each axis: (worldSpan*zoom - screen) * (1 - parallax) / zoom. Plus a small
    // buffer. Extending vertically too also means nothing empty ever shows just
    // below the world.
    const Z = CAMERA_ZOOM;
    const mx = Math.max(0, Math.ceil(((w * Z - GAME_WIDTH) * (1 - SKY_PARALLAX)) / Z)) + 8;
    const my = Math.max(0, Math.ceil(((h * Z - GAME_HEIGHT) * (1 - SKY_PARALLAX)) / Z)) + 8;
    const bw = w + mx * 2;
    const bh = h + my * 2;
    this.skyHomeX = -mx;
    this.skyHomeY = -my;

    const g = new Graphics();
    const bands = 24;
    const tr = (top >> 16) & 0xff, tg = (top >> 8) & 0xff, tb = top & 0xff;
    const br = (bot >> 16) & 0xff, bg = (bot >> 8) & 0xff, bb = bot & 0xff;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const c = ((tr + (br - tr) * t) << 16) | ((tg + (bg - tg) * t) << 8) | (tb + (bb - tb) * t);
      g.rect(0, (bh * i) / bands, bw, bh / bands + 1).fill({ color: c & 0xffffff });
    }
    g.x = this.skyHomeX;
    g.y = this.skyHomeY;
    this.skyG = g;
    this.view.addChild(g);
  }

  /**
   * Restage the collision layer to one of the map's geometry variants (1-based).
   *
   * The tutorial is built this way: rather than script individual doors, Raze 2
   * swaps the whole wall layer as each step is cleared, which both opens the way
   * on and removes the trigger the player just tripped. Everything else about
   * the map — art, pickups, spawn nodes — is unchanged, so only the mask moves.
   */
  changeWallFrame(n: number): void {
    const wm = WallMasks.frame(this.level, n);
    if (wm) this.wallMask = wm;
  }

  /**
   * Scan the map's special-surface layer for water terrain and, if any exists,
   * lay a cheap reflection band over it: a static darkened blue tint on every
   * water cell plus a per-column surface line reused by the animated shimmer.
   * No-op on maps with no water, so it is self-gating.
   */
  private buildWater(m: Raze2MapDef): void {
    const wm = this.wallMask;
    if (!wm) return;
    const step = WATER_STEP;
    const g = new Graphics();
    const surfaceTop = new Map<number, number>();
    let any = false;
    for (let x = 0; x < m.w; x += step) {
      for (let y = 0; y < m.h; y += step) {
        const s = wm.surfaceTypeAt(x, y);
        if (!s || (s.type !== "waterShallow" && s.type !== "waterDeep")) continue;
        any = true;
        g.rect(x, y, step + 1, step + 1);
        const cur = surfaceTop.get(x);
        if (cur === undefined) surfaceTop.set(x, y); // first (topmost) hit in column
      }
    }
    if (!any) {
      g.destroy();
      return;
    }
    // Darkened water tint (the "reflection" plane the actors sit in front of).
    g.fill({ color: 0x0a2a3a, alpha: 0.3 });
    this.hasWater = true;
    this.waterGfx = g;
    this.view.addChild(g);
    this.waterSurface = [...surfaceTop.entries()].map(([x, y]) => ({ x, y }));
    this.waterShimmer = new Graphics();
    this.view.addChild(this.waterShimmer);
  }

  /** Spawn a Raze 2 map's pickups from its node data (`{p|w}_{kind}_{secs}`). */
  private spawnRaze2Pickups(m: Raze2MapDef): void {
    const wm = Number(SD.matchSettings?.weapons) || 0;
    for (const [x, y, raw] of m.pickups ?? []) {
      const parts = raw.split("_");
      const prefix = parts[0];
      const kind = parts[1] ?? "";
      const respawn = Number(parts[2]) || 20;
      const gy = this.groundSpawn(x, y) ?? y;
      if (prefix === "w") {
        const type = kind === "rand" ? "random" : WEAPONS[kind] ? kind : "random";
        const spec: PickupWeaponSpec = { id: `weap_${kind}_${x}`, type, x, y: gy - 14, respawnSecs: respawn };
        const p = new PickupWeapon(spec, wm);
        this.weapPickups.push(p);
        this.view.addChild(p.view);
      } else {
        const ik = RAZE2_ITEM_KIND[kind] ?? "health";
        const spec: PickupItemSpec = { id: `item_${kind}_${x}`, kind: ik as PickupItemSpec["kind"], x, y: gy - 8, respawnSecs: respawn };
        const p = new PickupItem(spec);
        this.itemPickups.push(p);
        this.view.addChild(p.view);
      }
    }
  }

  /** Paint every collision rect as a solid slab (used when a level has no art,
   *  e.g. the Sandbox) so the floor and walls are visible. */
  private drawFlatGeo(): void {
    const g = this.geo;
    g.clear();
    for (const w of this.walls) {
      // WallRect is centre-based; convert back to a top-left rect.
      const x = w.x - w.width / 2;
      const y = w.y - w.height / 2;
      g.rect(x, y, w.width, w.height).fill({ color: 0x2a3038 });
      // A lit top edge reads as the standable surface.
      g.rect(x, y, w.width, 3).fill({ color: 0x4a5563 });
    }
  }

  /**
   * Resolve a raw spawn coordinate to a point where a unit's feet actually rest
   * on level geometry.
   *
   * Units are positioned by their feet, so a valid spawn y is the top edge of a
   * solid rect spanning that x. Two cases:
   *
   *   1. The point is buried inside a solid — walk straight up through the
   *      *contiguous* solid column to the surface above it. Slopes and mounds
   *      are meshed as stacks of overlapping slabs, so a buried point sits
   *      under several of them; climbing the stack lands the unit on the mound
   *      rather than inside it. Walking the column (instead of taking the
   *      nearest exposed top) matters on Pit, which has a full-width ceiling
   *      slab — the nearest exposed surface above a point in the right-hand
   *      rock face is the *roof*, outside the arena entirely.
   *   2. The feet are in open air — drop them onto the nearest exposed surface
   *      at or below. Tops covered by another slab are interior, not standable,
   *      so they are skipped.
   *
   * Either way the correction is capped at one character height: a spawn that
   * needs to move further than that does not describe the surface it is near
   * (it is extraction noise, or hangs over a void), so it is rejected rather
   * than teleported somewhere arbitrary or dropped through the map.
   *
   * @returns the grounded y, or null if the spawn has no usable support.
   */
  private groundSpawn(x: number, y: number): number | null {
    // Pixel-mask maps: find the surface at/near the point by scanning the mask.
    if (this.wallMask) {
      const s = this.wallMask.surfaceUnder(x, y, SPAWN_MAX_FIX);
      if (s !== null) return s;
      // Buried point with no air→solid boundary in range: climb out upward.
      if (this.wallMask.solidAt(x, y)) {
        for (let yy = y; yy >= Math.max(0, y - SPAWN_MAX_FIX); yy--) {
          if (!this.wallMask.solidAt(x, yy)) return yy;
        }
      }
      return null;
    }
    // 1. Climb out of any solid the point is inside of.
    let probe = y;
    let surface: number | null = null;
    for (let guard = 0; guard < 64; guard++) {
      let top: number | null = null;
      for (const w of this.walls) {
        if (w.rotation) continue;
        if (x <= w.x - w.width / 2 || x >= w.x + w.width / 2) continue;
        const t = w.y - w.height / 2;
        if (probe > t && probe < w.y + w.height / 2 && (top === null || t < top)) top = t;
      }
      if (top === null) break;
      surface = top;
      probe = top - 0.01;
    }

    // 2. Otherwise fall onto the nearest exposed surface below.
    if (surface === null) {
      for (const w of this.walls) {
        if (w.rotation) continue;
        if (x <= w.x - w.width / 2 || x >= w.x + w.width / 2) continue;
        const t = w.y - w.height / 2;
        if (t < y - SPAWN_SNAP) continue;
        if (this.pointInWall(x, t - 1)) continue;
        if (surface === null || t < surface) surface = t;
      }
    }

    if (surface === null) return null;
    return Math.abs(surface - y) <= SPAWN_MAX_FIX ? surface : null;
  }

  private addBackground(level: string): void {
    const tex = Backgrounds.getTexture(level) as Texture | null;
    if (!tex) return;
    const w = (tex as any).width || 0;
    const h = (tex as any).height || 0;
    const sprite = new Sprite(tex);
    sprite.anchor.set(0, 0);
    if (w > 0 && h > 0) {
      sprite.scale.set(GAME_WIDTH / w, GAME_HEIGHT / h);
    }
    this.bg = sprite;
    this.view.addChild(sprite);
  }

  private wall(x: number, y: number, w: number, h: number): void {
    // Store centre-based (matches planck + unit collision expectations).
    this.walls.push({ x: x + w / 2, y: y + h / 2, width: w, height: h, rotation: 0 });
  }

  /** Add ground + side walls shared by every level. */
  private addBounds(): void {
    const W = GAME_WIDTH;
    this.wall(0, this.floorY, W, GAME_HEIGHT - this.floorY + 20);
    this.wall(-20, 0, 20, GAME_HEIGHT);
    this.wall(W, 0, 20, GAME_HEIGHT);
  }

  /**
   * Finalize a level from a list of platform rects and spawn points.
   * Platforms are top-left based `[x, y, w, h]`; spawns are `[x, y]` (on top
   * of whatever surface). A fully-connected waypoint graph is derived from the
   * spawn set so the AI can path anywhere.
   */
  private finish(
    platforms: [number, number, number, number][],
    spawns: [number, number][],
  ): void {
    for (const [x, y, w, h] of platforms) this.wall(x, y, w, h);

    this.spawnNodes = spawns.map(([x, y], i) => ({
      x,
      y,
      name: "s" + i,
      taken: false,
    }));
    this.humanWP = { x: GAME_WIDTH / 2, y: this.floorY };

    this.wayNodes = this.spawnNodes.map((s, i) => ({
      name: s.name,
      x: s.x,
      y: s.y,
      connects: this.spawnNodes.filter((_, j) => j !== i).map((o) => o.name),
      actions: [],
    }));
  }

  private buildLevel(level: string): void {
    switch (level) {
      case "space":
        this.buildSpace();
        break;
      case "toxic":
        this.buildToxic();
        break;
      case "pit":
        this.buildPit();
        break;
      case "city":
      default:
        this.buildCity();
        break;
    }
  }

  // --- City: symmetric skyline with stepped rooftops ---------------------
  private buildCity(): void {
    const W = GAME_WIDTH;
    this.floorY = GAME_HEIGHT - 70;
    this.addBounds();
    const f = this.floorY;
    this.finish(
      [
        [40, f - 110, 150, 22], // left low roof
        [W - 190, f - 110, 150, 22], // right low roof
        [180, f - 220, 160, 22], // left high roof
        [W - 340, f - 220, 160, 22], // right high roof
        [W / 2 - 90, f - 320, 180, 22], // central tower top
      ],
      [
        [110, f],
        [W - 110, f],
        [W / 2, f],
        [115, f - 110],
        [W - 115, f - 110],
        [260, f - 220],
        [W - 260, f - 220],
        [W / 2, f - 320],
      ],
    );
  }

  // --- Space: tiered station catwalks around a central gap ---------------
  private buildSpace(): void {
    const W = GAME_WIDTH;
    this.floorY = GAME_HEIGHT - 60;
    this.addBounds();
    const f = this.floorY;
    this.finish(
      [
        [0, f - 130, 210, 20], // low left catwalk
        [W - 210, f - 130, 210, 20], // low right catwalk
        [W / 2 - 130, f - 150, 260, 20], // central mid platform
        [70, f - 250, 170, 20], // upper left
        [W - 240, f - 250, 170, 20], // upper right
        [W / 2 - 80, f - 350, 160, 20], // top command deck
      ],
      [
        [120, f],
        [W - 120, f],
        [100, f - 130],
        [W - 100, f - 130],
        [W / 2, f - 150],
        [150, f - 250],
        [W - 150, f - 250],
        [W / 2, f - 350],
      ],
    );
  }

  // --- Toxic: dense asymmetric vertical shaft of narrow gantries ---------
  private buildToxic(): void {
    const W = GAME_WIDTH;
    this.floorY = GAME_HEIGHT - 55;
    this.addBounds();
    const f = this.floorY;
    this.finish(
      [
        [30, f - 95, 120, 18],
        [200, f - 160, 130, 18],
        [W - 330, f - 160, 130, 18],
        [W - 150, f - 95, 120, 18],
        [W / 2 - 95, f - 235, 190, 18], // central toxic platform
        [60, f - 300, 130, 18],
        [W - 190, f - 300, 130, 18],
        [W / 2 - 60, f - 385, 120, 18], // top vent
      ],
      [
        [140, f],
        [W - 140, f],
        [W / 2, f],
        [90, f - 95],
        [W - 90, f - 95],
        [265, f - 160],
        [W - 265, f - 160],
        [W / 2, f - 235],
        [125, f - 300],
        [W - 125, f - 300],
        [W / 2, f - 385],
      ],
    );
  }

  // --- Pit: wide open arena, few low platforms, deep floor --------------
  private buildPit(): void {
    const W = GAME_WIDTH;
    this.floorY = GAME_HEIGHT - 50;
    this.addBounds();
    const f = this.floorY;
    this.finish(
      [
        [90, f - 100, 150, 24], // left block
        [W - 240, f - 100, 150, 24], // right block
        [W / 2 - 130, f - 175, 260, 24], // big central platform
        [0, f - 210, 90, 24], // left ledge
        [W - 90, f - 210, 90, 24], // right ledge
      ],
      [
        [160, f],
        [W - 160, f],
        [W / 2, f],
        [165, f - 100],
        [W - 165, f - 100],
        [W / 2, f - 175],
        [45, f - 210],
        [W - 45, f - 210],
      ],
    );
  }

  private spawnPickups(level: string): void {
    const wm = SD.matchSettings?.weapons ?? 0;

    // Authentic levels: place power-ups and weapon drops at the exact positions
    // and respawn timings lifted from the SWF Arena frame (`p_<N>_<kind>` named
    // instances; respawn = N * 10 s). Falls back to spawn-node scatter only if
    // a level has no extracted pickup data yet.
    if (this.authentic) {
      const def = (LEVEL_DATA as unknown as Record<string, LevelDef>)[level];
      const items = def?.items ?? [];
      const weapons = def?.weapons ?? [];
      if (items.length || weapons.length) {
        items.forEach((it, i) => {
          const spec: PickupItemSpec = {
            id: `item_${it.kind}_${i}`,
            kind: it.kind as PickupItemSpec["kind"],
            x: it.x,
            y: it.y,
            respawnSecs: it.respawn,
          };
          const p = new PickupItem(spec);
          this.itemPickups.push(p);
          this.view.addChild(p.view);
        });
        weapons.forEach((wp, i) => {
          // Weapon set other than "default"/"themed-0" forces every drop to a
          // random pull from the active pool (matches Pickup_Weapon.Init).
          const type = wm >= 2 ? "random" : wp.type;
          const spec: PickupWeaponSpec = {
            id: `weap_${wp.type}_${i}`,
            type,
            x: wp.x,
            y: wp.y,
            respawnSecs: wp.respawn,
          };
          const p = new PickupWeapon(spec, wm);
          this.weapPickups.push(p);
          this.view.addChild(p.view);
        });
        return;
      }
      const kinds = ["health", "shield", "ddamage", "invin", "fade"];
      this.spawnNodes.forEach((n, i) => {
        if (i % 2 === 0) {
          const kind = kinds[i % kinds.length];
          const spec: PickupItemSpec = { id: `item_${kind}_${i}`, kind: kind as any, x: n.x, y: n.y - 8, respawnSecs: 25 };
          const p = new PickupItem(spec); this.itemPickups.push(p); this.view.addChild(p.view);
        } else {
          const spec: PickupWeaponSpec = { id: `weap_${i}`, type: "random", x: n.x, y: n.y - 14, respawnSecs: 15 };
          const p = new PickupWeapon(spec, wm); this.weapPickups.push(p); this.view.addChild(p.view);
        }
      });
      return;
    }

    const f = this.floorY;
    const W = GAME_WIDTH;

    // Item pickup specs per level: [kind, x, y, respawnSecs]
    const itemDefs: Record<string, [string, number, number, number][]> = {
      city: [
        ["health",    115,  f - 10,  20],
        ["shield",    W - 115, f - 10, 20],
        ["ddamage",   W / 2, f - 10, 40],
        ["invin",     260,  f - 230, 45],
        ["health",    W - 260, f - 230, 20],
      ],
      space: [
        ["health",    100,  f - 140, 20],
        ["shield",    W - 100, f - 140, 20],
        ["ddamage",   W / 2, f - 160, 40],
        ["invin",     150, f - 260, 45],
      ],
      toxic: [
        ["health",    90,  f - 105, 20],
        ["shield",    W - 90, f - 105, 20],
        ["fade",      W / 2, f - 245, 40],
        ["ddamage",   125, f - 310, 40],
      ],
      pit: [
        ["health",    165,  f - 110, 20],
        ["shield",    W - 165, f - 110, 20],
        ["ddamage",   W / 2, f - 185, 40],
        ["invin",     45, f - 220, 45],
      ],
    };

    // Weapon pickup specs per level: [type, x, y, respawnSecs]
    const weapDefs: Record<string, [string, number, number, number][]> = {
      city: [
        ["random", 115, f - 110 - 12, 15],
        ["random", W - 115, f - 110 - 12, 15],
        ["random", 260, f - 220 - 12, 15],
        ["random", W - 260, f - 220 - 12, 15],
      ],
      space: [
        ["random", W / 2, f - 150 - 12, 15],
        ["random", 150, f - 250 - 12, 15],
        ["random", W - 150, f - 250 - 12, 15],
      ],
      toxic: [
        ["random", 265, f - 160 - 12, 15],
        ["random", W - 265, f - 160 - 12, 15],
        ["random", W / 2, f - 235 - 12, 15],
      ],
      pit: [
        ["random", 165, f - 100 - 12, 15],
        ["random", W - 165, f - 100 - 12, 15],
        ["random", W / 2, f - 175 - 12, 15],
      ],
    };

    // The Juggernaut crown sits on the highest contested spot of each map, so
    // holding it is a positional fight rather than a free grab. Campaign
    // missions run their own scripted rules, so it only spawns in quick match.
    const jugDefs: Record<string, [number, number]> = {
      city: [W / 2, f - 330],
      space: [W / 2, f - 260],
      toxic: [W / 2, f - 330],
      pit: [W / 2, f - 275],
    };
    const jugSpot = jugDefs[level];
    if (jugSpot && !SD.matchSettings?.campaign) {
      const p = new PickupItem({
        id: "item_jug",
        kind: "jug",
        x: jugSpot[0],
        y: jugSpot[1],
        respawnSecs: 20,
      });
      this.itemPickups.push(p);
      this.view.addChild(p.view);
    }

    for (const [kind, x, y, secs] of itemDefs[level] ?? []) {
      const spec: PickupItemSpec = { id: `item_${kind}_${x}`, kind: kind as any, x, y, respawnSecs: secs };
      const p = new PickupItem(spec);
      this.itemPickups.push(p);
      this.view.addChild(p.view);
    }

    for (const [type, x, y, secs] of weapDefs[level] ?? []) {
      const spec: PickupWeaponSpec = { id: `weap_${type}_${x}`, type, x, y, respawnSecs: secs };
      const p = new PickupWeapon(spec, wm);
      this.weapPickups.push(p);
      this.view.addChild(p.view);
    }
  }

  private drawGeometry(): void {
    this.geo.clear();
    // Skip the bounding walls (floor + side walls — last 3 entries from addBounds).
    const platforms = this.walls.slice(0, -3);
    const bounds = this.walls.slice(-3);

    // Floor and side walls: dark, barely visible.
    for (const w of bounds) {
      this.geo.rect(w.x - w.width / 2, w.y - w.height / 2, w.width, w.height);
    }
    this.geo.fill({ color: 0x1a1f25, alpha: 0.95 });

    // Platforms: visibly solid with a bright top-edge highlight.
    for (const w of platforms) {
      const x = w.x - w.width / 2;
      const y = w.y - w.height / 2;
      this.geo.rect(x, y, w.width, w.height);
    }
    this.geo.fill({ color: 0x3d4e5e, alpha: 1 });

    // Top-edge highlight on every platform (makes them stand out on dark bgs).
    for (const w of platforms) {
      const x = w.x - w.width / 2;
      const y = w.y - w.height / 2;
      this.geo.moveTo(x, y).lineTo(x + w.width, y);
    }
    this.geo.stroke({ color: 0x7a9ab5, width: 2.5, alpha: 0.9 });
  }

  /** True if the point is inside a solid wall. Pixel-mask maps (Raze 2) sample
   *  the mask; rect maps (Raze 1) test the wall rects. Used by bullets and
   *  projectiles as well as unit collision, so both must respect the mask. */
  pointInWall(px: number, py: number): boolean {
    if (this.wallMask) return this.wallMask.solidAt(px, py);
    for (const w of this.walls) {
      if (
        px > w.x - w.width / 2 &&
        px < w.x + w.width / 2 &&
        py > w.y - w.height / 2 &&
        py < w.y + w.height / 2
      ) {
        return true;
      }
    }
    return false;
  }

  getNode(i: number): WayNode {
    return this.wayNodes[i];
  }
  cloneNode(n: WayNode): WayNode {
    return { ...n };
  }

  enterFrame(): void {
    this.tick++;

    // Themed sky parallax: slide the oversized sky at SKY_PARALLAX of the
    // camera speed so it drifts behind the collision-locked map art. `this.x/y`
    // are the arena view's screen translation (set by GameScreen.updateCamera).
    if (this.skyG) {
      const Z = CAMERA_ZOOM;
      const k = (SKY_PARALLAX - 1) / Z; // negative: sky lags the world scroll
      this.skyG.x = this.skyHomeX + this.x * k;
      this.skyG.y = this.skyHomeY + this.y * k;
    }

    // Water surface shimmer — gated by the "Lights & Reflections" quality knob
    // (glow is off on Low / no-glow), so cheap hardware skips it entirely.
    if (this.waterShimmer) {
      const g = this.waterShimmer;
      g.clear();
      if (this.hasWater && Quality.glow) {
        const t = this.tick;
        for (const p of this.waterSurface) {
          const a = 0.08 + 0.12 * Math.max(0, Math.sin(p.x * 0.02 + t * 0.08));
          g.rect(p.x, p.y, WATER_STEP, 2).fill({ color: 0x8fd8ff, alpha: a });
        }
      }
    }

    // Ambient theme particles (dust/ember/snow/bubble).
    this.particles?.update(this.x, this.y, CAMERA_ZOOM);

    // Jump pads are drawn by the map's own background art (no procedural glyph),
    // so there is nothing to animate per frame here.
  }

  /** Pad a grounded unit's feet (px, feetY) sit on, or null. */
  jumpPadAt(px: number, feetY: number): JumpPad | null {
    for (const p of this.jumpPads) {
      if (px >= p.x && px <= p.x + p.w && feetY >= p.y - 8 && feetY <= p.y + p.h + 8) {
        return p;
      }
    }
    return null;
  }

  /**
   * Draw the jump pads: a glowing base plate + two pulsing up-chevrons.
   *
   * Palette is a warm amber launch cue rather than the old bright cyan. The
   * cyan plates were the only bright-cyan element in the whole world render, and
   * several maps place pads at the very bottom of the world (e.g. jungle pads at
   * y≈1844/1948 in a 2025-tall world), so a wide cyan plate down there read as
   * "a bright cyan band below the arena world" in HUD screenshots. Amber keeps
   * the pads legible while ensuring nothing cyan shows below the map. (Authentic
   * Raze 2 pads are invisible wall-colour zones — doc 12 §2.3 — so a subtle,
   * non-cyan cue is also closer to the original than the old glow.)
   */
  private drawPads(): void {
    // Raze 2 jump pads have no procedural glyph: the pad's visual is the metallic
    // launch platform painted into the map's own background art (DefineSprite_1365
    // → the map bg we render), and collision/launch is driven by the special-layer
    // detection band (jumpPads / WallMask). So we deliberately draw nothing here —
    // the authentic pad comes entirely from the game asset, not from code. Kept as
    // a no-op (clearing any stale graphics) so the call sites stay simple.
    this.padGfx.clear();
  }
}
