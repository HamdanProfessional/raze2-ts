import { Container, Text, TextStyle } from "pixi.js";
import { GAME_WIDTH } from "../core/Config";
import type { Hud } from "./Hud";

/**
 * Ported from RollMsg.as.
 *
 * RollMsg was a kill-feed line that slid in from the right side of the HUD,
 * stayed for ~70 ticks, then faded out and removed itself. The original
 * held a message in `msg`, an alpha counter (`alphaCount`), and a target
 * position (gotoX/gotoY); each tick it lerped toward the target (0.2) and
 * decremented the timer.
 *
 * Here it's a Text inside a Container, mounted on the HUD's overlay. The
 * owning Hud keeps a list of live messages and removes them once their
 * timer expires.
 */
const FADE_TICKS = 70;
const FADE_RATE = 0.03;

export class RollMsg {
  readonly view = new Container();
  private text: Text;
  private alphaCount = FADE_TICKS;
  private gotoX: number;
  private gotoY: number;

  constructor(
    private hud: Hud,
    text: string,
    targetX: number,
    targetY: number,
    style: Partial<TextStyle> = {},
  ) {
    this.gotoX = targetX;
    this.gotoY = targetY;
    this.text = new Text({
      text,
      style: new TextStyle({
        fill: 0xffe2a8,
        fontFamily: "Consolas, 'Courier New', monospace",
        fontSize: 12,
        fontWeight: "bold",
        stroke: { color: 0x000000, width: 3 },
        ...style,
      }),
    });
    this.text.anchor.set(1, 0.5);
    this.view.addChild(this.text);
    this.view.x = targetX + 40;
    this.view.y = targetY;
  }

  enterFrame(): void {
    this.view.x += (this.gotoX - this.view.x) * 0.2;
    this.view.y += (this.gotoY - this.view.y) * 0.2;
    if (this.alphaCount > 0) {
      this.alphaCount--;
    } else {
      this.view.alpha -= FADE_RATE;
    }
    if (this.view.alpha <= 0.03) {
      this.hud.removeRollMsg(this);
    }
  }

  destructor(): void {
    this.view.destroy({ children: true });
  }
}

/** Build a default right-aligned kill feed line anchored to the HUD. */
export function makeKillFeedLine(
  hud: Hud,
  msg: string,
  rowIndex: number,
): RollMsg {
  return new RollMsg(
    hud,
    msg,
    GAME_WIDTH - 16,
    58 + rowIndex * 16,
    { fill: 0xffe2a8 },
  );
}
