/**
 * A minimal real-time tween system for front-end polish.
 *
 * Gameplay runs on a fixed 30Hz logic tick and must stay deterministic, so it
 * deliberately does NOT use this. UI motion is the opposite case: it should
 * look the same on a 30Hz and a 144Hz display and it has no business affecting
 * simulation, so it is driven off wall-clock milliseconds from the render
 * ticker instead (see Engine.startLoop).
 *
 * A job is just a callback that receives an eased 0..1 progress value. That
 * keeps the system property-agnostic — alpha, position, scale and colour all
 * animate through the same path — and means nothing here needs to know what a
 * Pixi display object is.
 *
 * Jobs are applied once at t = 0 the moment they are created, so a screen that
 * is built but never ticked (the headless UI smoke test) still ends up in a
 * defined state rather than a half-initialised one.
 */

export type EaseFn = (t: number) => number;

export const Ease = {
  linear: (t: number): number => t,
  /** Fast start, gentle settle. The default for UI: feels responsive. */
  outCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  /** Symmetric acceleration — for things that move a long way. */
  inOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  /** Slight overshoot before settling. Good for pops and hover states. */
  outBack: (t: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export interface TweenOpts {
  ease?: EaseFn;
  /** Milliseconds to wait before the first step. */
  delay?: number;
  onDone?: () => void;
  /**
   * Optional grouping token. `cancel(owner)` drops every job tagged with it —
   * used to stop a screen's animations touching its display objects after it
   * has been destroyed.
   */
  owner?: object;
}

interface Job {
  apply: (t: number) => void;
  ms: number;
  elapsed: number;
  delay: number;
  ease: EaseFn;
  onDone?: () => void;
  owner?: object;
}

class TweenSystem {
  private jobs: Job[] = [];

  /**
   * Animate `apply(t)` from t=0 to t=1 over `ms` milliseconds. A zero-length
   * tween applies its end state immediately and is never queued.
   */
  to(ms: number, apply: (t: number) => void, opts: TweenOpts = {}): void {
    const ease = opts.ease ?? Ease.outCubic;
    const delay = opts.delay ?? 0;
    if (ms <= 0 && delay <= 0) {
      apply(1);
      opts.onDone?.();
      return;
    }
    apply(0);
    this.jobs.push({
      apply,
      ms,
      elapsed: 0,
      delay,
      ease,
      onDone: opts.onDone,
      owner: opts.owner,
    });
  }

  /** Advance every live job by `dtMs` of wall-clock time. */
  update(dtMs: number): void {
    if (!this.jobs.length) return;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      if (j.delay > 0) {
        j.delay -= dtMs;
        if (j.delay > 0) continue;
        // Roll any overshoot past the delay into the first real step.
        j.elapsed = -j.delay;
        j.delay = 0;
      } else {
        j.elapsed += dtMs;
      }
      const raw = j.ms > 0 ? Math.min(1, j.elapsed / j.ms) : 1;
      j.apply(j.ease(raw));
      if (raw >= 1) {
        this.jobs.splice(i, 1);
        j.onDone?.();
      }
    }
  }

  /**
   * Drop queued jobs without applying their end state. With no argument every
   * job is dropped; with an `owner` token only that group is.
   */
  cancel(owner?: object): void {
    this.jobs = owner ? this.jobs.filter((j) => j.owner !== owner) : [];
  }
}

export const Tween = new TweenSystem();

// --- common UI motions ------------------------------------------------------
//
// Thin wrappers over Tween.to for the handful of shapes the front end actually
// uses. They take a structurally-typed target rather than a Pixi Container so
// this module stays free of a rendering dependency.

interface Fadeable {
  alpha: number;
}
interface Movable extends Fadeable {
  x: number;
  y: number;
}

/** Fade a display object up from transparent. */
export function fadeIn(target: Fadeable, ms = 250, opts: TweenOpts = {}): void {
  Tween.to(ms, (t) => void (target.alpha = t), opts);
}

/**
 * Slide a display object in from (dx, dy) away from its current position,
 * fading up as it travels. The resting position is captured at call time, so
 * this must run after the object has been laid out.
 */
export function slideIn(
  target: Movable,
  dx: number,
  dy: number,
  ms = 280,
  opts: TweenOpts = {},
): void {
  const restX = target.x;
  const restY = target.y;
  Tween.to(
    ms,
    (t) => {
      const k = 1 - t;
      target.x = restX + dx * k;
      target.y = restY + dy * k;
      target.alpha = t;
    },
    opts,
  );
}
