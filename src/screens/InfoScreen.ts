import { Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground, makeScrim } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { Raze2Button, FONT_HEADER, C_HEADER, A_HEADER } from "../ui/raze2";

/**
 * Credits (`Timeline_60` frame 122), rebuilt for the dynamic stage.
 *
 * The source is a static 3-column grid inside a dark glass panel. The panel is
 * baked without its text (`credits_panel`) and stretched across the stage; the
 * text grid is baked on its own (`credits_text`) and centred at native scale,
 * so the screen fills any window width while the names stay crisp.
 */
export class InfoScreen extends Screen {
  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.45));

    const s = Math.min(GAME_HEIGHT / 600, GAME_WIDTH / 800);
    const M = Math.round(40 * s);
    const panelTop = Math.round(56 * s);

    // Stretchable panel band.
    const pMeta = UiArt.meta("credits_panel");
    const pTex = UiArt.r2("credits_panel");
    if (pMeta && pTex) {
      const sp = new Sprite(pTex);
      sp.scale.y = s / pMeta.scale;
      sp.scale.x = (GAME_WIDTH - 2 * M) / (pMeta.w * pMeta.scale);
      sp.position.set(M, panelTop);
      this.view.addChild(sp);
    }

    // The text grid, centred at native scale. Its baked registration is
    // SWF (0,0), so position it at the centred design origin.
    const tMeta = UiArt.meta("credits_text");
    const sp = UiArt.r2Sprite("credits_text");
    if (tMeta && sp) {
      sp.scale.set(s / tMeta.scale);
      sp.position.set(
        Math.round((GAME_WIDTH - 800 * s) / 2),
        Math.round(panelTop - 52 * s),
      );
      this.view.addChild(sp);
    }

    const title = new Text({
      text: "CREDITS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 19 * s,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2;
    title.y = Math.round(22 * s);
    this.view.addChild(title);

    const back = new Raze2Button("Back to Menu", {
      width: 245 * s, height: 28 * s,
      onClick: () => this.close(),
    });
    back.view.x = 38.2 * s;
    back.view.y = GAME_HEIGHT - 84 * s + 13.9 * s;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);

    window.addEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape" || e.code === "Backspace") this.close();
  };

  private close(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(MenuScreen, undefined, "slideRight");
  }

  enterFrame(): void {
    // Static screen.
  }

  destructor(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    super.destructor();
  }
}
