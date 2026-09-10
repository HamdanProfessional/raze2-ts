import { Container, Text, TextStyle } from "pixi.js";

/**
 * Ported from TopText.as.
 *
 * TopText was the floating text bubble above each character in the arena —
 * a 3-line stack with a nameBox (the player's name), msgBox (a transient
 * message such as "+SHIELD" or "JUG"), and backBar/bar (the rounded panel
 * behind them). The message line showed power-up callouts and "JUG" for
 * the current Juggernaut.
 *
 * In the TS port each Unit already draws its own name tag (see
 * Unit.buildNameBox). The transient message / power-up callout is layered
 * on top via this class so callers can push a short string ("JUG!",
 * "+SHIELD", "DOUBLE DAMAGE") above a unit for a couple of seconds.
 */
const FADE_TICKS = 60;

export class TopText {
  readonly view = new Container();
  private text: Text;
  private timer = FADE_TICKS;

  constructor(text: string, color = 0xffd45a) {
    this.text = new Text({
      text,
      style: new TextStyle({
        fill: color,
        fontFamily: "Arial, sans-serif",
        fontSize: 11,
        fontWeight: "bold",
        stroke: { color: 0x000000, width: 3 },
      }),
    });
    this.text.anchor.set(0.5);
    this.view.addChild(this.text);
  }

  enterFrame(): void {
    if (this.timer > 0) {
      this.timer--;
      this.view.alpha = Math.min(1, this.timer / 15);
    } else {
      this.view.alpha = Math.max(0, this.view.alpha - 0.05);
    }
  }

  get done(): boolean {
    return this.timer <= 0 && this.view.alpha <= 0.02;
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}
