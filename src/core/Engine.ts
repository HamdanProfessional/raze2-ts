import { Application, Container, Graphics } from "pixi.js";
import {
  GAME_WIDTH, GAME_HEIGHT, DESIGN_WIDTH, DESIGN_HEIGHT, MS_PER_FRAME, setStageSize,
} from "./Config";
import { Input } from "./Input";
import { Quality } from "../state/Quality";
import { Tween } from "./Tween";
import type { Screen, ScreenClass } from "./Screen";

/**
 * Half of a screen transition, in ms: the outgoing screen fades to black over
 * this, then the incoming one fades up over the same again — 0.3s door to
 * door. Long enough to read as a deliberate cut, short enough that menu
 * navigation never feels sluggish.
 */
const FADE_MS = 150;

/**
 * The application root. Ported from Main.as.
 *
 * Responsibilities of Main in the original:
 *  - own the Flash stage and a single "current class" (screen)
 *  - run an ENTER_FRAME loop that forwards to curClass.EnterFrame()
 *  - swap screens via newCurClass(), destroying the old one
 *  - keep the Achievements/medals overlay always on top
 *  - expose startLoader / startLogo / startMenu / startGame transitions
 *
 * We use a fixed-timestep accumulator so ported game logic (written for a
 * 30fps frame) stays deterministic regardless of the display refresh rate.
 */
export class Engine {
  readonly app: Application;
  /** Root of the current screen's display list. */
  readonly root = new Container();
  /** Always-on-top overlay (achievement popups, etc.). */
  readonly overlay = new Container();

  private current: Screen | null = null;
  private accumulator = 0;
  /** Wall-clock timestamp of the last logic step, for the fixed-step clock. */
  private lastLogic = 0;
  /** Off-thread heartbeat that keeps logic running while the tab is hidden. */
  private tickWorker: Worker | null = null;

  /** Black curtain for screen transitions; sits above everything. */
  private curtain = new Graphics();
  /** Curtain opacity, 0 (clear) .. 1 (black). */
  private fade = 0;
  /** +1 while fading to black, -1 while fading back up, 0 when settled. */
  private fadeDir = 0;
  /** Screen waiting for the curtain to close before it is swapped in. */
  private pending: { Ctor: ScreenClass; arg?: unknown } | null = null;
  /** What built the live screen, so a resize can rebuild it as it was. */
  private currentSpec: { Ctor: ScreenClass; arg?: unknown } | null = null;
  /** Pending rebuild-after-resize timer, so a drag rebuilds once at the end. */
  private rebuildTimer = 0;

  private constructor(app: Application) {
    this.app = app;
    this.app.stage.addChild(this.root);
    this.app.stage.addChild(this.overlay);

    this.curtain.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 });
    this.curtain.alpha = 0;
    this.curtain.visible = false;
    this.app.stage.addChild(this.curtain);
  }

  /** Async factory — Pixi v8 initialises asynchronously. */
  static async create(mount: HTMLElement): Promise<Engine> {
    const app = new Application();
    await app.init({
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      background: 0x000000,
      antialias: true,
      // autoDensity off: we drive the canvas CSS size ourselves (letterbox) and
      // set the renderer resolution to the true on-screen pixel size in resize().
      autoDensity: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    mount.appendChild(app.canvas);

    const engine = new Engine(app);
    engine.setupScaling(mount);
    Input.attach(app.canvas as unknown as HTMLElement);
    engine.startLoop();
    return engine;
  }

  /**
   * Fill the viewport exactly — no bars, no stretch, no crop — and render at
   * the true on-screen pixel density so nothing is blurred by CSS upscaling.
   *
   * Rather than fitting a fixed box, the logical stage itself takes the
   * window's aspect: we pick the largest uniform scale at which the design size
   * still fits, then hand the renderer whatever logical size the viewport works
   * out to at that scale. One axis lands exactly on its design length and the
   * other overshoots, so the stage is never smaller than the layouts assume and
   * the surplus becomes extra visible world rather than a black bar. Every
   * screen owns the whole stage, so a wider window pushes edge-anchored chrome
   * out to the real edges instead of stranding it 1136px in.
   *
   * Resolution is `scale × devicePixelRatio`, so the backing store matches the
   * displayed size. Capped so huge/hi-dpi screens don't allocate a giant buffer.
   */
  private setupScaling(mount: HTMLElement): void {
    const resize = () => {
      const vw = Math.max(1, mount.clientWidth);
      const vh = Math.max(1, mount.clientHeight);
      const scale = Math.min(vw / DESIGN_WIDTH, vh / DESIGN_HEIGHT);
      const logicalW = Math.max(DESIGN_WIDTH, Math.round(vw / scale));
      const logicalH = Math.max(DESIGN_HEIGHT, Math.round(vh / scale));

      const dpr = window.devicePixelRatio || 1;
      const resolution = Math.max(1, Math.min(scale * dpr, 4));
      this.app.renderer.resize(logicalW, logicalH, resolution);

      const canvas = this.app.canvas;
      canvas.style.width = `${vw}px`;
      canvas.style.height = `${vh}px`;

      // Publish before re-laying out, so subscribers read the new size.
      setStageSize(logicalW, logicalH);
      this.curtain.clear();
      this.curtain.rect(0, 0, logicalW, logicalH).fill({ color: 0x000000 });
      this.relayoutScreen();
    };
    window.addEventListener("resize", resize);
    resize();
  }

  /**
   * Apply the graphics-quality render cap. Logic always advances in fixed
   * 30fps steps below; this only limits how often we *draw*, which is the
   * cheapest win available on a low-end device.
   */
  private applyQuality = (): void => {
    this.app.ticker.maxFPS = Quality.maxFps;
  };

  private startLoop(): void {
    this.applyQuality();
    Quality.onChange(this.applyQuality);
    this.lastLogic = performance.now();

    // Presentation (tweens, transitions) rides the rAF ticker; so does logic
    // while the tab is VISIBLE. When the tab is hidden, rAF is paused by the
    // browser, so a Web Worker heartbeat takes over the logic clock — without
    // it a networked host would stop simulating/broadcasting the instant it is
    // tabbed out and every peer would freeze.
    this.app.ticker.add((ticker) => {
      Tween.update(ticker.deltaMS);
      this.advanceTransition(ticker.deltaMS);
      if (!document.hidden) this.stepLogic();
    });

    this.startTickWorker();
  }

  private startTickWorker(): void {
    try {
      const worker = new Worker(new URL("./tickWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = () => {
        // Only own the clock while rAF is asleep; otherwise the ticker drives
        // logic and stepping here too would double-advance the sim.
        if (document.hidden) this.stepLogic();
      };
      worker.postMessage(MS_PER_FRAME);
      this.tickWorker = worker;
    } catch {
      // No worker support: hidden tabs will pause logic (pre-existing behaviour).
      this.tickWorker = null;
    }
  }

  /**
   * Advance game logic in fixed 30fps steps against the wall clock, clamped to
   * avoid a spiral of death after a long stall. Uses performance.now() rather
   * than a frame delta so it is correct whichever clock (rAF or the worker)
   * calls it — only one is ever active at a time (gated by document.hidden).
   */
  private stepLogic(): void {
    const now = performance.now();
    this.accumulator += Math.min(now - this.lastLogic, MS_PER_FRAME * 5);
    this.lastLogic = now;
    let steps = 0;
    while (this.accumulator >= MS_PER_FRAME && steps < 5) {
      this.accumulator -= MS_PER_FRAME;
      steps++;
      this.current?.enterFrame(1);
      Input.endFrame();
    }
  }

  /**
   * Equivalent of Main.newCurClass(): destroy the old screen, instantiate the
   * new one — but curtained, so the swap is never a hard cut.
   *
   * The very first screen has nothing to fade out of, so it is built at once
   * and only fades *up*. Every later call queues the swap behind a fade to
   * black; calling it again mid-transition simply replaces the pending screen,
   * so a double-click on a menu button can't stack two swaps.
   */
  setScreen(ScreenCtor: ScreenClass, arg?: unknown): void {
    if (!this.current) {
      this.swapScreen(ScreenCtor, arg);
      this.fade = 1;
      this.fadeDir = -1;
      return;
    }
    this.pending = { Ctor: ScreenCtor, arg };
    this.fadeDir = 1;
  }

  /** The swap itself, with no transition. */
  private swapScreen(ScreenCtor: ScreenClass, arg?: unknown): void {
    if (this.current) {
      this.root.removeChild(this.current.view);
      this.current.destructor();
    }
    // The outgoing screen's display objects are gone; anything still animating
    // them would be writing to destroyed nodes.
    Tween.cancel();
    this.currentSpec = { Ctor: ScreenCtor, arg };
    this.current = new ScreenCtor(this, arg);
    this.root.addChild(this.current.view);
  }

  /**
   * Re-fit the live screen to a stage that just changed shape.
   *
   * Every screen fills the whole window, and menu layouts are expressed as
   * construction code against `GAME_WIDTH`/`GAME_HEIGHT` — so the honest way
   * to re-run one is to build it again. That is debounced, because a window
   * drag fires this dozens of times and the rebuild is not free.
   *
   * The match is the exception: it holds simulation state that must survive,
   * so it implements `resize()` and re-anchors itself in place instead.
   */
  private relayoutScreen(): void {
    if (!this.current) return;
    if (this.current.resize) {
      this.current.resize();
      return;
    }
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      const spec = this.currentSpec;
      if (spec && this.current) this.swapScreen(spec.Ctor, spec.arg);
    }, 160);
  }

  /** Drive the transition curtain. `dtMs` is wall-clock, not logic ticks. */
  private advanceTransition(dtMs: number): void {
    if (this.fadeDir !== 0) {
      this.fade += (dtMs / FADE_MS) * this.fadeDir;
      if (this.fadeDir > 0 && this.fade >= 1) {
        // Fully black: make the swap, then open back up.
        this.fade = 1;
        const next = this.pending;
        this.pending = null;
        if (next) this.swapScreen(next.Ctor, next.arg);
        this.fadeDir = -1;
      } else if (this.fadeDir < 0 && this.fade <= 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
    }
    this.curtain.alpha = this.fade;
    this.curtain.visible = this.fade > 0;
  }

  get screen(): Screen | null {
    return this.current;
  }
}
