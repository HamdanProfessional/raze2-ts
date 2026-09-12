/**
 * Global game configuration.
 * The original Flash stage was 700x600 running at ~30fps.
 */
/**
 * Design size: the layout every screen is authored against, and the floor for
 * the live stage. Nothing is ever laid out smaller than this.
 */
export const DESIGN_WIDTH = 1136;
export const DESIGN_HEIGHT = 639;

/**
 * Live logical stage size. The canvas fills the browser window, so rather than
 * letterboxing a fixed box these grow past the design size to match the
 * window's aspect — a wide window sees more world and pushes the edge-anchored
 * HUD out to the real edges. Nothing is ever stretched or cropped.
 *
 * These are `let` on purpose: ES module bindings are live, so every importer
 * reading `GAME_WIDTH` sees the current value for free. Anything that *derives*
 * a module-level constant from them would freeze at import instead, and must
 * read them at layout time and re-run on `onStageResize`.
 */
export let GAME_WIDTH: number = DESIGN_WIDTH;
export let GAME_HEIGHT: number = DESIGN_HEIGHT;

const stageResizeHandlers = new Set<() => void>();

/** Subscribe to stage-size changes. Returns an unsubscribe function. */
export function onStageResize(fn: () => void): () => void {
  stageResizeHandlers.add(fn);
  return () => {
    stageResizeHandlers.delete(fn);
  };
}

/** Set the live stage size and notify layout subscribers. Engine owns this. */
export function setStageSize(w: number, h: number): void {
  if (w === GAME_WIDTH && h === GAME_HEIGHT) return;
  GAME_WIDTH = w;
  GAME_HEIGHT = h;
  for (const fn of [...stageResizeHandlers]) fn();
}

/** Original Flash frame rate. The game logic assumes ~30 ticks/second. */
export const FPS = 30;
export const MS_PER_FRAME = 1000 / FPS;

/**
 * Box2D world scale. The AS3 Box2D wrapper (RdPhys) used a pixels-per-meter
 * factor so that physics bodies work in sensible meter units while the display
 * is in pixels. Original used 30 px/m.
 */
export const PTM = 30;

/** Root path (relative to the built site) where extracted SWF assets live. */
export const ASSET_BASE = "assets";

/**
 * Cache-busting stamp appended to every asset URL as `?v=`.
 *
 * The JS bundles are content-hashed by Vite, so a new build gets a new filename
 * and clients pick it up immediately. Asset paths are STABLE by design --
 * `assets/arms-r2/gun/rocket.png` is the same URL forever -- so a re-baked sheet
 * is invisible behind any cache until it expires. Cloudflare fronts this site
 * with a 4-hour browser TTL by default, which is how a fixed art bug can stay
 * broken for hours after a correct deploy.
 *
 * Injected by vite.config.ts at build time; "dev" while running the dev server,
 * where Vite already revalidates.
 */
export const ASSET_V: string =
  typeof __ASSET_V__ === "string" ? __ASSET_V__ : "dev";

/**
 * Camera zoom: how much the arena is scaled up on screen. >1 shows LESS of the
 * world (a smaller field of view). Zoom is a uniform scale, so aim angles are
 * unaffected.
 *
 * **1.0 = the original's framing.** Raze 2 draws the arena 1:1 — the collision
 * mask is native world px and `Movement.as` probes it at raw offsets
 * (`hitTest(17,-20)` … `hitTest(0,-50)`), so one world px is one screen px.
 * This used to be ≈1.571, which showed only 723x407 world px of a 1137x631
 * view: the map, backdrop, pickups and jump pads all rendered ~57% oversized
 * and the level read as cramped. The character art scales below are expressed
 * against this same native basis, so they no longer have to cancel a zoom out.
 */
export const CAMERA_ZOOM = 1;

/** Injected by vite.config.ts `define`. */
declare const __ASSET_V__: string | undefined;
