import { Container } from "pixi.js";
import type { Engine } from "./Engine";

/**
 * Base class for every top-level "screen" of the game.
 *
 * In the original AS3, each screen (Loader, Logo_Armor, Menu, Game, ...) was a
 * MovieClip constructed with a reference to Main, exposing `EnterFrame()` and
 * `destructor()`. Main swapped between them via `newCurClass()`.
 *
 * Here a Screen owns a Pixi `Container` (its display root) and receives one
 * `enterFrame(dt)` call per fixed tick. `dt` is in frames (1.0 == one 30fps
 * tick) so ported game logic that assumed per-frame constants keeps working.
 */
export abstract class Screen {
  readonly view = new Container();
  protected engine: Engine;

  constructor(engine: Engine, _arg?: unknown) {
    this.engine = engine;
  }

  /** Called once per fixed logic tick. dt is in 30fps-frame units. */
  abstract enterFrame(dt: number): void;

  /**
   * The window changed shape. Implement this to re-anchor in place; a screen
   * that does not is simply rebuilt, which re-runs its constructor layout
   * against the new size. Only screens holding state that must survive a
   * resize — the match — need to bother.
   */
  resize?(): void;

  /** Cleanup: remove listeners, destroy physics world, free display objects. */
  destructor(): void {
    this.view.destroy({ children: true });
  }
}

/**
 * Constructor signature for screens, used by Engine.setScreen(). Note that
 * setScreen is asynchronous in effect — it curtains the swap — so it returns
 * nothing and callers must not expect the new screen to exist on return.
 */
export type ScreenClass = new (engine: Engine, arg?: unknown) => Screen;
