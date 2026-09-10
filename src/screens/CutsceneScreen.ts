import { Container, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { Sound } from "../audio/Sounds";
import { SD } from "../state/SD";
import { preloadLevel } from "../game/Arena";
import {
  PANEL_W,
  PANEL_H,
  getPanel,
  type CutsceneReel,
} from "../game/Cutscene";
import { makeScrim, makeVeil } from "./ui";
import { Raze2Button, FONT_HEADER, C_DIM } from "../ui/raze2";

/**
 * The campaign story scenes, ported from `Cutscene.as`.
 *
 * One comic panel at a time, held until the player clicks: Previous walks back,
 * Next walks forward, and the last page offers "Start Game" (a pre-mission
 * scene, which hands off to the match) or "Back to Campaign" (a post-mission
 * one). The mission name sits across the top where the SWF put `txt_title`.
 *
 * The baked panels are the whole 800x600 SWF stage — painted backdrop, comic
 * frame and the narration caption are all in the image — so the layout below is
 * just that stage, letterboxed into the port's wider view, with the two live
 * widgets (title, buttons) placed back at their original stage coordinates.
 */

/** Where `Cutscene.as` put its chrome, in the SWF's own stage pixels. */
const TITLE_X = 403.65; // centre of the 534px-wide txt_title field
const TITLE_Y = 26.5;
const TITLE_SIZE = 16;

// The two MenuButton hitboxes: 229.7 x ~24 at y 552, one on each side.
const BTN_W = 229.7;
const BTN_H = 26;
const BTN_Y = 551;
const PREV_X = 45.3;
const NEXT_X = 526.3;

export interface CutsceneArg {
  reel: CutsceneReel;
}

export class CutsceneScreen extends Screen {
  private reel: CutsceneReel;
  private page = 0;
  /** Sprite showing the current panel; its texture is swapped as pages turn. */
  private panel: Sprite | null = null;
  private prevBtn!: Raze2Button;
  private nextBtn!: Raze2Button;
  /** Set once the player has committed to leaving, so a double-click can't
   *  queue the match twice. */
  private leaving = false;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);
    this.reel = (args[1] as CutsceneArg).reel;

    // Letterbox the 4:3 stage into the port's view; everything below is placed
    // in the SWF's own 800x600 coordinates inside this container.
    const scale = Math.min(GAME_WIDTH / PANEL_W, GAME_HEIGHT / PANEL_H);
    const stage = new Container();
    stage.scale.set(scale);
    stage.x = (GAME_WIDTH - PANEL_W * scale) / 2;
    stage.y = (GAME_HEIGHT - PANEL_H * scale) / 2;

    // The letterbox bars read as part of the panel's own dark border.
    this.view.addChild(makeScrim(0x000000, 1));
    this.view.addChild(stage);

    const tex = getPanel(this.reel.panels[0]);
    if (tex) {
      this.panel = new Sprite(tex);
      this.panel.width = PANEL_W;
      this.panel.height = PANEL_H;
      stage.addChild(this.panel);
    }

    const title = new Text({
      text: this.reel.title,
      style: new TextStyle({
        fill: C_DIM,
        fontFamily: FONT_HEADER,
        fontSize: TITLE_SIZE,
        letterSpacing: 1,
      }),
    });
    title.anchor.set(0.5);
    title.x = TITLE_X;
    title.y = TITLE_Y;
    stage.addChild(title);

    this.prevBtn = new Raze2Button("Previous", {
      width: BTN_W,
      height: BTN_H,
      onClick: () => this.step(-1),
    });
    this.prevBtn.view.x = PREV_X;
    this.prevBtn.view.y = BTN_Y;
    this.prevBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    stage.addChild(this.prevBtn.view);

    this.nextBtn = new Raze2Button("Next", {
      width: BTN_W,
      height: BTN_H,
      reverse: true,
      onClick: () => this.advance(),
    });
    this.nextBtn.view.x = NEXT_X;
    this.nextBtn.view.y = BTN_Y;
    this.nextBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    stage.addChild(this.nextBtn.view);

    if (this.reel.song) Sound.setMusic(this.reel.song);

    // A pre-mission scene is read while the map streams in behind it, so the
    // handoff to the match is usually instant.
    if (this.reel.type === "pre") void preloadLevel(String(SD.matchSettings.level));

    this.setButs();
  }

  /** Whether the final page's Next button ends the scene rather than turning. */
  private get onLastPage(): boolean {
    return this.page === this.reel.panels.length - 1;
  }

  private step(delta: number): void {
    const next = this.page + delta;
    if (next < 0 || next >= this.reel.panels.length) return;
    Sound.play(delta < 0 ? "R2_ClickBack" : "R2_Click");
    this.page = next;
    const tex = getPanel(this.reel.panels[this.page]);
    if (this.panel && tex) {
      this.panel.texture = tex;
      this.panel.width = PANEL_W;
      this.panel.height = PANEL_H;
    }
    this.setButs();
  }

  /** Next / Start Game / Back to Campaign — whichever the last page offered. */
  private advance(): void {
    if (!this.onLastPage) {
      this.step(1);
      return;
    }
    if (this.leaving) return;
    this.leaving = true;
    if (this.reel.type === "pre") {
      Sound.play("R2_ClickGo");
      Sound.stopMusic();
      this.view.addChild(makeVeil("LOADING MAP…"));
      void preloadLevel(String(SD.matchSettings.level)).then(() =>
        void import("../game/GameScreen").then(({ GameScreen }) =>
          this.engine.setScreen(GameScreen),
        ),
      );
    } else {
      Sound.play("R2_ClickBack");
      void import("./CampaignScreen").then(({ CampaignScreen }) =>
        this.engine.setScreen(CampaignScreen),
      );
    }
  }

  /**
   * `Cutscene.setButs()`: Previous is hidden on the first page (and on a
   * single-page scene), and the final page relabels Next to the scene's exit.
   */
  private setButs(): void {
    this.prevBtn.view.visible = this.page > 0;
    this.nextBtn.setLabel(
      !this.onLastPage ? "Next"
        : this.reel.type === "pre" ? "Start Game"
          : "Back to Campaign",
    );
  }

  enterFrame(): void {
    // Every page is held until the player clicks; nothing animates.
  }
}
