import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Achievements, R2_ACH_IDS } from "../game/Achievements";
import { makeBackground, makeScrim } from "./ui";
import { MenuScreen } from "./MenuScreen";
import {
  Raze2Button,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_BODY,
  C_LABEL,
  C_DIM,
  C_SCORE_GOLD,
  C_OPTIONS_GREEN,
  drawRaze2Panel,
  A_HEADER,
  A_BODY,
} from "../ui/raze2";

/**
 * Achievements (`Timeline_60` frame 99), rebuilt for the port's dynamic stage.
 *
 * The source is a static 2-column x 5-row grid inside a dark panel. The panel
 * is drawn in code (it is a plain glass slab) and the ten rows follow the
 * original grid — but the columns spread to the live stage width and the rows
 * share the panel height, so the screen fills any window instead of sitting in
 * an 800x600 box. Each row keeps the original `AchievementIcons_90` art and the
 * source's name / description / reward columns, dimmed until earned.
 */
export class AchievementsScreen extends Screen {
  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.45));

    const s = Math.min(GAME_HEIGHT / 600, GAME_WIDTH / 800);
    const M = Math.round(40 * s);
    const headerH = Math.round(56 * s);
    const panelX = M;
    const panelY = headerH + Math.round(14 * s);
    const panelW = GAME_WIDTH - M * 2;
    const panelH = GAME_HEIGHT - panelY - Math.round(74 * s);

    const panel = new Graphics();
    drawRaze2Panel(panel, panelX, panelY, panelW, panelH, {
      accent: C_OPTIONS_GREEN,
    });
    this.view.addChild(panel);

    const title = new Text({
      text: "ACHIEVEMENTS",
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

    const hint = new Text({
      text: "Complete achievements to earn special modes and extra credits!",
      style: new TextStyle({
        fill: C_LABEL, fontFamily: FONT_BODY, fontSize: 12 * s,
      }),
    });
    hint.alpha = A_BODY;
    hint.anchor.set(0.5, 0);
    hint.x = GAME_WIDTH / 2;
    hint.y = panelY + Math.round(14 * s);
    this.view.addChild(hint);

    // 2 columns x 5 rows, spread across the panel.
    const colW = (panelW - M) / 2;
    const gridTop = panelY + Math.round(46 * s);
    const pitch = (panelH - Math.round(60 * s)) / 5;
    R2_ACH_IDS.forEach((key, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = panelX + M / 2 + col * (colW + M / 2);
      const y = gridTop + row * pitch;
      this.buildRow(key, x, y, colW, s);
    });

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

  private buildRow(key: string, x: number, y: number, colW: number, s: number): void {
    const earned = !!SD.medals[key];
    const medal = Achievements.getAch(key);

    const iconTex = UiArt.r2(`ach_${key}`);
    const iconSize = Math.round(40 * s);
    if (iconTex) {
      const icon = new Sprite(iconTex);
      icon.width = iconSize;
      icon.height = iconSize;
      icon.x = x;
      icon.y = y;
      icon.alpha = earned ? 1 : 0.4;
      this.view.addChild(icon);
    }

    const name = new Text({
      text: medal.name,
      style: new TextStyle({
        fill: earned ? C_SCORE_GOLD : C_LABEL, fontFamily: FONT_HEADER,
        fontSize: 13 * s, fontWeight: "700", letterSpacing: 1,
      }),
    });
    name.alpha = earned ? 1 : 0.65;
    name.x = x + 52 * s;
    name.y = y + 2;
    this.view.addChild(name);

    const rew = medal.rew;
    const reward = rew ? (rew[0] === "credits" ? `${rew[1]} cr` : `${rew[1]}`) : "";
    if (reward) {
      const t = new Text({
        text: earned ? "✓" : reward,
        style: new TextStyle({
          fill: earned ? C_OPTIONS_GREEN : C_DIM, fontFamily: FONT_VALUE,
          fontSize: 12 * s, fontWeight: "700",
        }),
      });
      t.anchor.set(1, 0);
      t.x = x + colW;
      t.y = y + 4 * s;
      this.view.addChild(t);
    }

    const desc = new Text({
      text: medal.desc,
      style: new TextStyle({
        fill: C_BODY, fontFamily: FONT_BODY, fontSize: 11 * s,
        wordWrap: true, wordWrapWidth: colW - 52 * s, lineHeight: 13 * s,
      }),
    });
    desc.alpha = earned ? A_BODY : A_BODY * 0.6;
    desc.x = x + 52 * s;
    desc.y = y + 19 * s;
    this.view.addChild(desc);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape" || e.code === "Backspace") this.close();
  };

  private close(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(MenuScreen, undefined, "slideRight");
  }

  enterFrame(): void {
    // Static grid.
  }

  destructor(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    super.destructor();
  }
}
