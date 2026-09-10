import { Sound } from "../audio/Sounds";
import { GAME_WIDTH, GAME_HEIGHT } from "./Config";

/**
 * Keyboard + mouse state tracker.
 *
 * Replaces AS3's global Key polling / stage MouseEvent listeners. The Game and
 * Player screens poll this each frame (e.g. isDown("KeyA")) to build the K.*
 * input bitmask for the local player, matching the original polling model.
 */
class InputManager {
  private down = new Set<string>();
  /** Keys that went down since the last consume() for edge-triggered actions. */
  private pressed = new Set<string>();

  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  /** Mouse pressed edge this frame. */
  mousePressed = false;
  /** Accumulated scroll wheel ticks (positive = scroll down). */
  wheelDelta = 0;

  /**
   * Debug: draw every collision box over the arena. Toggled by M on keydown
   * (not on the polled edge) so it flips exactly once per physical press no
   * matter which screen happens to be consuming input that frame.
   */
  showHitboxes = false;

  private attached = false;
  private target: HTMLElement | null = null;

  /** Attach listeners. `target` is the canvas used to translate mouse coords. */
  attach(target: HTMLElement): void {
    if (this.attached) return;
    this.attached = true;
    this.target = target;

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onBlur);
    target.addEventListener("wheel", this.onWheel, { passive: true });
    // Suppress the browser context menu so right-click can be used in-game.
    target.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical key press. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Clear per-frame edge state. Call at the end of each logic tick. */
  endFrame(): void {
    this.pressed.clear();
    this.mousePressed = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    Sound.resume();
    if (!this.down.has(e.code)) {
      this.pressed.add(e.code);
      if (e.code === "KeyM") this.showHitboxes = !this.showHitboxes;
    }
    this.down.add(e.code);
    // Prevent page scrolling on arrow keys / space.
    if (
      e.code === "Space" ||
      e.code.startsWith("Arrow") ||
      e.code === "Tab"
    ) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.target) return;
    // Map the pointer from screen CSS pixels into the stage's logical
    // GAME_WIDTH×GAME_HEIGHT space. The canvas fills the window at its CSS
    // size, so the on-screen box (getBoundingClientRect, which also folds in
    // any CSS transform) is what has to be divided out.
    const rect = this.target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.mouseX = ((e.clientX - rect.left) * GAME_WIDTH) / rect.width;
    this.mouseY = ((e.clientY - rect.top) * GAME_HEIGHT) / rect.height;
  };

  private onMouseDown = (e: MouseEvent) => {
    Sound.resume();
    if (e.button === 0) {
      if (!this.mouseDown) this.mousePressed = true;
      this.mouseDown = true;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onWheel = (e: WheelEvent) => {
    this.wheelDelta += e.deltaY > 0 ? 1 : -1;
  };

  private onBlur = () => {
    // Drop all held keys when the window loses focus to avoid stuck movement.
    this.down.clear();
    this.mouseDown = false;
  };
}

export const Input = new InputManager();
