import { Container, RenderTexture, Sprite } from "pixi.js";
import type { Renderer } from "pixi.js";

/**
 * Screen transitions. Ported from `Transition.as`.
 *
 * The original keeps two full-stage bitmaps: `tran1` is a snapshot of the
 * screen you are leaving, `tran2` of the one you are arriving at. The live
 * clip is hidden for the duration, so what you actually see is two still
 * images moving — which is why the menus can slide without every button
 * re-laying out mid-flight.
 *
 * The order matters and is exactly two frames: `slideLeft` snapshots the old
 * screen, switches the clip to the new one, and hides it; two frames later
 * (`waitFunc.timer = 2`, long enough for the new frame to have been built)
 * `slideLeft2` snapshots the result and slides it in from the right.
 *
 * `Transition.EnterFrame` is a per-frame switch on the action id, and every
 * constant below is lifted from it:
 *
 *   slideLeft/Right  `x += (toX - x) * 0.3` plus a flat ±5, so it eases out
 *                    but always finishes rather than creeping forever
 *   zoomIn/Out       10 frames of ±0.05 scale and ±0.1 alpha on the arriving
 *                    snapshot; the leaving one starts its count at 4 and fades
 *                    at -0.16, so it is gone well before the new one lands
 *   fallOff          the old screen tumbles: `velY` starts at -rand(0,20) and
 *                    gains 4 a frame, with a random -1..3 deg/frame spin
 *
 * Only `slideLeft` and `slideRight` are ever called in the shipped SWF (every
 * `Menu.as` navigation); the other three are authored but unused. They are
 * ported anyway because they are the same ten lines.
 */

export type TransitionKind =
  | "slideLeft"
  | "slideRight"
  | "zoomIn"
  | "zoomOut"
  | "fallOff";

/** Frames between hiding the old screen and snapshotting the new one. */
const WAIT_FRAMES = 2;
/** `action.count == 10` ends a zoom. */
const ZOOM_FRAMES = 10;

/** One snapshot: the outer node carries x/y/rotation, `spr` the scale/alpha. */
class Snap {
  readonly view = new Container();
  readonly spr = new Container();
  private sprite: Sprite | null = null;
  private tex: RenderTexture | null = null;

  /** Where it is heading, and how. Empty `id` means idle. */
  id = "";
  toX = 0;
  count = 0;
  alphCh = 0;
  rot = 0;
  velY = 0;
  /** True on the arriving snapshot: it is the one that hands control back. */
  reveals = false;

  constructor() {
    this.view.addChild(this.spr);
    this.view.visible = false;
  }

  /** Draw `source` into a fresh texture the size of the stage. */
  capture(renderer: Renderer, source: Container, w: number, h: number): void {
    this.release();
    this.tex = RenderTexture.create({ width: w, height: h, antialias: false });
    renderer.render({ container: source, target: this.tex, clear: true });
    this.sprite = new Sprite(this.tex);
    this.spr.addChild(this.sprite);
    this.view.visible = true;
  }

  reset(): void {
    this.id = "";
    this.view.visible = false;
    this.view.x = 0;
    this.view.y = 0;
    this.view.rotation = 0;
    this.spr.scale.set(1);
    this.spr.alpha = 1;
    this.release();
  }

  private release(): void {
    if (this.sprite) {
      this.spr.removeChild(this.sprite);
      this.sprite.destroy();
      this.sprite = null;
    }
    this.tex?.destroy(true);
    this.tex = null;
  }

  destroy(): void {
    this.release();
    this.view.destroy({ children: true });
  }
}

export class Transition {
  /** Add this above the screen layer. */
  readonly view = new Container();

  private t1 = new Snap(); // leaving
  private t2 = new Snap(); // arriving
  private kind: TransitionKind = "slideLeft";
  private wait = -1;
  private w = 0;
  private h = 0;
  /** Called once the arriving snapshot lands, to unhide the live screen. */
  private onDone: (() => void) | null = null;
  /** Called `WAIT_FRAMES` after the start, to snapshot the new screen. */
  private onCapture: (() => void) | null = null;

  constructor() {
    this.view.addChild(this.t1.view);
    this.view.addChild(this.t2.view);
    this.view.visible = false;
  }

  get working(): boolean {
    return !!this.t1.id || !!this.t2.id || this.wait > -1;
  }

  /**
   * Freeze the outgoing screen and start `kind`. The caller swaps the live
   * screen immediately and hides it; `capture` is invoked two frames later to
   * take the arriving snapshot, and `done` when the whole thing lands.
   */
  start(
    renderer: Renderer,
    outgoing: Container,
    kind: TransitionKind,
    w: number,
    h: number,
    capture: () => Container,
    done: () => void,
  ): void {
    this.finish();
    this.kind = kind;
    this.w = w;
    this.h = h;
    this.onDone = done;
    this.view.visible = true;
    this.t1.capture(renderer, outgoing, w, h);

    switch (kind) {
      case "slideLeft":
        this.t1.id = "slideLeft";
        this.t1.toX = -w;
        break;
      case "slideRight":
        this.t1.id = "slideRight";
        this.t1.toX = w;
        break;
      case "zoomIn":
      case "zoomOut":
        // The leaving snapshot starts 4 frames into the count, so it has only
        // 6 left: it blows out (or collapses) and fades before the new arrives.
        this.t1.id = kind;
        this.t1.count = 4;
        this.t1.alphCh = -0.16;
        this.t1.spr.scale.set(1);
        break;
      case "fallOff":
        // No arriving snapshot: the new screen is simply behind this one.
        this.t1.id = "fall";
        this.t1.rot = Math.random() * 4 - 1;
        this.t1.velY = -Math.random() * 20;
        this.t1.reveals = true;
        this.onCapture = null;
        return;
    }
    this.t1.reveals = false;
    this.onCapture = () => this.captureArriving(renderer, capture());
    this.wait = WAIT_FRAMES;
  }

  /** The `*2` half: snapshot the arrived screen and bring it on. */
  private captureArriving(renderer: Renderer, incoming: Container): void {
    this.t2.capture(renderer, incoming, this.w, this.h);
    this.t2.reveals = true;
    this.t2.toX = 0;
    switch (this.kind) {
      case "slideLeft":
        this.t2.id = "slideLeft";
        this.t2.view.x = this.w;
        break;
      case "slideRight":
        this.t2.id = "slideRight";
        this.t2.view.x = -this.w;
        break;
      case "zoomIn":
        this.t2.id = "zoomIn";
        this.t2.count = 0;
        this.t2.alphCh = 0.1;
        this.t2.spr.scale.set(0.5);
        this.t2.spr.alpha = 0;
        break;
      case "zoomOut":
        this.t2.id = "zoomOut";
        this.t2.count = 0;
        this.t2.alphCh = 0.1;
        this.t2.spr.scale.set(1.5);
        this.t2.spr.alpha = 0;
        break;
    }
  }

  /** One logic frame. Returns true while the transition is still running. */
  enterFrame(): boolean {
    if (this.wait > -1) {
      if (this.wait === 0) this.onCapture?.();
      this.wait--;
    }
    this.advance(this.t1);
    this.advance(this.t2);
    if (!this.working) {
      this.view.visible = false;
      return false;
    }
    return true;
  }

  private advance(s: Snap): void {
    switch (s.id) {
      case "slideLeft":
        s.view.x += (s.toX - s.view.x) * 0.3;
        s.view.x -= 5;
        if (s.view.x - s.toX < 1) this.land(s);
        break;
      case "slideRight":
        s.view.x += (s.toX - s.view.x) * 0.3;
        s.view.x += 5;
        if (s.view.x - s.toX > -1) this.land(s);
        break;
      case "zoomIn":
        s.count++;
        s.spr.scale.x += 0.05;
        s.spr.scale.y += 0.05;
        s.spr.alpha += s.alphCh;
        if (s.count === ZOOM_FRAMES) this.land(s);
        break;
      case "zoomOut":
        s.count++;
        s.spr.scale.x -= 0.05;
        s.spr.scale.y -= 0.05;
        s.spr.alpha += s.alphCh;
        if (s.count === ZOOM_FRAMES) this.land(s);
        break;
      case "fall":
        s.view.rotation += (s.rot * Math.PI) / 180;
        s.velY += 4;
        s.view.y += s.velY;
        if (s.view.y > this.h + 100) this.land(s);
        break;
    }
  }

  /** `Transition.endAction` — park the snapshot, and hand back if it reveals. */
  private land(s: Snap): void {
    const reveals = s.reveals;
    s.reset();
    if (reveals) {
      this.onDone?.();
      this.onDone = null;
    }
  }

  /** Cut any transition short — a second navigation, or a teardown. */
  finish(): void {
    this.wait = -1;
    this.onCapture = null;
    this.t1.reset();
    this.t2.reset();
    this.view.visible = false;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  destroy(): void {
    this.t1.destroy();
    this.t2.destroy();
    this.view.destroy({ children: true });
  }
}
