import { Container, Graphics } from "pixi.js";
import { Quality } from "../state/Quality";
import { arcPath, clamp01, C_DANGER, C_DIM } from "./HudComponents";

/** The single, weapon-agnostic reticle colour (Raze 2 `Aimer`, doc 14 §1.8). */
const C_RETICLE = 0xffffff;

/**
 * Dynamic crosshair.
 *
 * The reticle is the one HUD element the player is always looking at, so it
 * carries the information that has to arrive without a glance:
 *
 *   - **Colour** is a single fixed white for every weapon — Raze 2 uses one
 *     shared `Aimer` reticle, not per-weapon art or tint (doc 14 §1.8). It only
 *     changes to red when the clip is empty, or dims while spectating.
 *   - **Gap** is the live spread cone. It opens on every shot from the gun's
 *     own recoil accumulator and closes as that decays, so what the player
 *     sees is literally where the next round can go — not a decorative
 *     animation. Moving fast opens it further; standing still tightens it.
 *   - **Reload** replaces the reticle with a progress ring, which is where the
 *     eye already is when a magazine runs dry.
 *   - **Red** means the clip is empty and the trigger will only click.
 *
 * Owned by GameScreen and parented above the HUD; hidden by screenshot mode.
 */

/** Gap in px at zero spread. */
const BASE_GAP = 6;
/** Length of each of the four ticks. */
const TICK = 8;
/** How hard `Guns.recoilAmount` (0..1.5) pushes the gap open. */
const RECOIL_GAIN = 26;
/** How hard the weapon's static spread cone pushes it open. */
const SPREAD_GAIN = 0.55;
/** Extra gap at full sprint. */
const MOVE_GAIN = 9;
/** Per-frame approach rate toward the target gap (higher = snappier). */
const EASE = 0.35;

interface GunLike {
  curGun?: { id: string; recoil: number; curClip: number; maxClip: number };
  recoilAmount?: number;
  reloading?: boolean;
  reloadProgress?: number;
}

interface UnitLike {
  gun?: GunLike;
  moving?: { vel: number };
  status?: { dead: boolean };
}

export class Crosshair {
  readonly view = new Container();
  private g = new Graphics();
  /** Eased gap, so a weapon swap doesn't snap the reticle open. */
  private gap = BASE_GAP;
  /** Last drawn signature; the path is only rebuilt when something changed. */
  private lastKey = "";

  constructor() {
    this.view.addChild(this.g);
  }

  set visible(v: boolean) {
    this.view.visible = v;
  }
  get visible(): boolean {
    return this.view.visible;
  }

  /**
   * Position at (x, y) and restyle from `unit`'s current weapon state.
   * `unit` may be null/dead — the reticle then falls back to a neutral dot.
   */
  enterFrame(x: number, y: number, unit: UnitLike | null | undefined): void {
    this.view.x = x;
    this.view.y = y;

    const gun = unit?.gun;
    const cur = gun?.curGun;
    const dead = !!unit?.status?.dead;

    // Target gap: static cone + live recoil + movement penalty.
    let target = BASE_GAP;
    if (cur && !dead) {
      target += cur.recoil * SPREAD_GAIN;
      target += clamp01((gun?.recoilAmount ?? 0) / 1.5) * RECOIL_GAIN;
      const speed = Math.abs(unit?.moving?.vel ?? 0);
      target += Math.min(1, speed / 8) * MOVE_GAIN;
    }
    this.gap += (target - this.gap) * EASE;

    const reloading = !!gun?.reloading;
    const empty = !reloading && !!cur && cur.curClip <= 0;
    const color = dead ? C_DIM : empty ? C_DANGER : C_RETICLE;
    const progress = reloading ? clamp01(gun?.reloadProgress ?? 0) : -1;

    // Quantise the gap for the redraw check: sub-pixel jitter is invisible but
    // would rebuild the path every single frame.
    const key = `${Math.round(this.gap * 2)}|${color}|${Math.round(progress * 20)}|${dead ? 1 : 0}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.draw(color, reloading, progress, dead);
  }

  private draw(color: number, reloading: boolean, progress: number, dead: boolean): void {
    const g = this.g;
    g.clear();

    if (dead) {
      // Spectating: a slim ring, deliberately inert.
      g.circle(0, 0, 7).stroke({ color, width: 1, alpha: 0.5 });
      return;
    }

    if (reloading) {
      // Progress ring in place of the ticks. Track first, then the sweep.
      const r = 13;
      arcPath(g, 0, 0, r, -Math.PI / 2, Math.PI * 1.5, 16);
      g.stroke({ color: 0x000000, width: 3.5, alpha: 0.45 });
      arcPath(g, 0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress, 16);
      g.stroke({ color, width: 2.5, alpha: 0.95 });
      g.circle(0, 0, 1.6).fill({ color, alpha: 0.9 });
      return;
    }

    const gap = this.gap;
    const end = gap + TICK;

    // Dark under-stroke so the reticle survives a bright muzzle flash or a
    // pale wall; drawn as one path, then the coloured pass on top of it.
    const ticks = () => {
      g.moveTo(-end, 0).lineTo(-gap, 0)
        .moveTo(gap, 0).lineTo(end, 0)
        .moveTo(0, -end).lineTo(0, -gap)
        .moveTo(0, gap).lineTo(0, end);
    };
    ticks();
    g.stroke({ color: 0x000000, width: 3.5, alpha: 0.5 });
    ticks();
    g.stroke({ color, width: 1.5, alpha: 0.95 });

    // Centre dot: the actual point of aim, which the opening gap otherwise
    // stops communicating once the cone is wide.
    g.circle(0, 0, 1.4).fill({ color, alpha: 0.85 });

    // A faint containment ring at the cone edge — pure polish, so it follows
    // the detail profile.
    if (Quality.detail && gap > BASE_GAP + 4) {
      g.circle(0, 0, gap).stroke({ color, width: 1, alpha: 0.18 });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
