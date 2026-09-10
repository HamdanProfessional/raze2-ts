/**
 * Ported from Debug.as.
 *
 * Debug in the original was an on-screen FPS/MS overlay with a small bar
 * (`iBar`) whose scaleX interpolated toward `frameTime / 10` (the per-frame
 * milliseconds, normalised). onEnterFrame() counted frames per second and
 * rewrote the text field every tick.
 *
 * In the TS port this lives as a lightweight HUD overlay that polls
 * performance.now() and re-draws every 0.5 s. Mount via `new DebugOverlay()`;
 * toggle visibility with the `KeyD` shortcut from the Game screen.
 *
 * The original had no per-edge / body-class breakdown — just frame time, so
 * this overlay mirrors that surface.
 */
export class DebugOverlay {
  private readonly view = document.createElement("div");
  private readonly bar = document.createElement("div");
  private prevFrame = 0;
  private prevSecond = 0;
  private frames = 0;
  private fps = "...";
  private frameTime = 0;
  private barScale = 1;

  constructor() {
    this.view.style.cssText = [
      "position:fixed",
      "top:6px",
      "right:6px",
      "z-index:100",
      "padding:4px 8px",
      "background:rgba(0,0,0,0.55)",
      "color:#9ee37d",
      "font:12px/1.2 monospace",
      "border:1px solid #2a333d",
      "border-radius:3px",
      "pointer-events:none",
      "user-select:none",
      "text-align:right",
      "min-width:90px",
    ].join(";");
    this.bar.style.cssText = [
      "display:block",
      "margin-top:3px",
      "height:3px",
      "width:80px",
      "margin-left:auto",
      "background:#53c65a",
      "transform-origin:right center",
      "transform:scaleX(1)",
    ].join(";");
    this.view.appendChild(this.bar);
    document.body.appendChild(this.view);
    const now = performance.now();
    this.prevFrame = now;
    this.prevSecond = now;
  }

  enterFrame(): void {
    const now = performance.now();
    this.frameTime = now - this.prevFrame;
    this.prevFrame = now;

    const since = now - this.prevSecond;
    if (since >= 1000) {
      this.fps = String(this.frames);
      this.frames = 0;
      this.prevSecond = now;
    } else {
      this.frames++;
    }

    const target = this.frameTime / 10;
    this.barScale += (target - this.barScale) / 5;
    this.bar.style.transform = `scaleX(${this.barScale.toFixed(2)})`;
    this.view.firstChild;
    this.view.childNodes[0];
    this.view.innerHTML = `${this.fps} FPS / ${this.frameTime.toFixed(1)} MS`;
    this.view.appendChild(this.bar);
  }

  setVisible(v: boolean): void {
    this.view.style.display = v ? "block" : "none";
  }

  destructor(): void {
    this.view.remove();
  }
}
