import { Container, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Achievements } from "../game/Achievements";
import { makeBackground, makeScrim } from "./ui";
import { Tween, slideIn } from "../core/Tween";
import { MenuScreen } from "./MenuScreen";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_LABEL,
  C_VALUE,
  C_DIM,
  C_BODY,
  C_OPTIONS_GREEN,
  C_SCORE_GOLD,
  A_HEADER,
  A_LABEL,
  A_VALUE,
  A_BODY,
} from "../ui/raze2";

/**
 * Stats & medals screen. Displays SD.stats (kills/deaths/K-D, wins/losses,
 * headshots, shot accuracy) and any medals earned in SD.medals, using the
 * medal table from game/Achievements.ts.
 *
 * "RESET STATS" clears SD.stats and SD.medals behind a confirmation dialog.
 * The profile (name, personality, preset, customisation) and campaign
 * progression are deliberately left untouched — this only wipes the tally.
 */

/** Ticks the "stats cleared" toast stays on screen (30fps logic ticks). */
const TOAST_TICKS = 90;

/**
 * Panel geometry. The two panels used to be 240px each on a 500px centred
 * block — sized for the original 700x600 stage — which left the medal
 * descriptions cramped, most of the 1136px stage empty, and the BACK / RESET
 * buttons stranded 25px from the stage edges with nothing to align to.
 *
 * The widths are fixed (the columns are sized to their content) but the block's
 * origin and height are read from the stage at layout time, so a larger window
 * keeps it centred and lets the panels grow rather than opening a gutter.
 */
const STATS_W = 320;
const MEDALS_W = 440;
const PANEL_Y = 92;
const BLOCK_W = STATS_W + 20 + MEDALS_W;

const statsX = () => Math.round((GAME_WIDTH - BLOCK_W) / 2);
const medalsX = () => statsX() + STATS_W + 20;
const panelH = () => GAME_HEIGHT - PANEL_Y - 103;
const buttonY = () => GAME_HEIGHT - 64;

export class StatsScreen extends Screen {
  /** Rebuilt in place after a reset so the numbers refresh without a reload. */
  private statsLayer = new Container();
  private medalsLayer = new Container();
  private confirm!: Container;
  private toast!: Text;
  private toastTimer = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.6));

    const title = new Text({
      text: "STATS & MEDALS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 30,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2;
    title.y = 40;
    this.view.addChild(title);

    this.view.addChild(this.statsLayer, this.medalsLayer);
    this.buildStatsPanel();
    this.buildMedalsPanel();
    this.introPanels();

    // Anchored to the panel block's own edges so the bar reads as part of the
    // layout rather than floating out at the stage corners.
    this.button("Back to Menu", statsX(), buttonY(), 200, () => this.back());
    this.button("Reset Stats", medalsX() + MEDALS_W - 180, buttonY(), 180,
      () => this.askReset(), true);

    this.toast = new Text({
      text: "",
      style: new TextStyle({ fill: C_OPTIONS_GREEN, fontFamily: FONT_VALUE, fontSize: 14, letterSpacing: 1 }),
    });
    this.toast.anchor.set(0.5);
    this.toast.x = GAME_WIDTH / 2;
    this.toast.y = PANEL_Y + panelH() + 18;
    this.toast.visible = false;
    this.view.addChild(this.toast);

    this.buildConfirm();
  }

  /** A kit button on the footer row. `warn` tints the label for destructive actions. */
  private button(
    label: string, x: number, y: number, width: number,
    onClick: () => void, warn = false,
  ): void {
    const b = new Raze2Button(label, { width, height: 40, reverse: warn, onClick });
    b.view.x = x;
    b.view.y = y;
    b.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(b.view);
  }

  private buildStatsPanel(): void {
    const layer = this.statsLayer;
    layer.removeChildren();

    const x = statsX();
    const y = PANEL_Y;
    const h = panelH();
    const panel = new Raze2Panel(STATS_W, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    layer.addChild(panel.view);

    const s = SD.stats;
    const kd = s.deaths > 0 ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
    const accuracy = s.shots > 0 ? ((s.shotsHit / s.shots) * 100).toFixed(1) : "0.0";
    const totalGames = s.won + s.lost;
    const winPct = totalGames > 0 ? ((s.won / totalGames) * 100).toFixed(0) : "0";

    const heading = new Text({
      text: "COMBAT STATS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 18,
        fontWeight: "700", letterSpacing: 2,
      }),
    });
    heading.alpha = A_HEADER;
    heading.anchor.set(0.5, 0);
    heading.x = x + STATS_W / 2;
    heading.y = y + 18;
    layer.addChild(heading);

    const rows: [string, string][] = [
      ["Kills", String(s.kills)],
      ["Deaths", String(s.deaths)],
      ["K/D ratio", kd],
      ["Suicides", String(s.suicides)],
      ["Headshots", String(s.headshots)],
      ["Best killstreak", String(s.killstreak)],
      ["Shots fired", String(s.shots)],
      ["Shots hit", String(s.shotsHit)],
      ["Accuracy", `${accuracy}%`],
      ["Wins", String(s.won)],
      ["Losses", String(s.lost)],
      ["Win rate", `${winPct}%`],
      ["Campaign stage", String(SD.curStage)],
    ];

    // Spread the 13 rows evenly through the panel body instead of using a fixed
    // 27px pitch that left a growing gap at the bottom.
    const top = y + 58;
    const pitch = (h - 76 - (top - y)) / (rows.length - 1);
    rows.forEach(([label, value], i) => {
      const rowY = top + i * pitch;
      const l = new Text({
        text: label,
        style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 14 }),
      });
      l.alpha = A_LABEL;
      l.x = x + 18;
      l.y = rowY;
      layer.addChild(l);

      const v = new Text({
        text: value,
        style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 14, fontWeight: "700" }),
      });
      v.alpha = A_VALUE;
      v.anchor.set(1, 0);
      v.x = x + STATS_W - 18;
      v.y = rowY;
      layer.addChild(v);
    });
  }

  private buildMedalsPanel(): void {
    const layer = this.medalsLayer;
    layer.removeChildren();

    const x = medalsX();
    const y = PANEL_Y;
    const w = MEDALS_W;
    const h = panelH();
    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    layer.addChild(panel.view);

    const heading = new Text({
      text: "MEDALS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 18,
        fontWeight: "700", letterSpacing: 2,
      }),
    });
    heading.alpha = A_HEADER;
    heading.anchor.set(0.5, 0);
    heading.x = x + w / 2;
    heading.y = y + 18;
    layer.addChild(heading);

    const earnedKeys = Object.keys(SD.medals).filter((k) => SD.medals[k]);
    let rowY = y + 58;

    if (earnedKeys.length === 0) {
      const none = new Text({
        text: "No medals earned yet.\nPlay matches and complete\nthe campaign to unlock some!",
        style: new TextStyle({
          fill: C_DIM,
          fontFamily: FONT_BODY,
          fontSize: 14,
          align: "center",
          lineHeight: 20,
        }),
      });
      none.alpha = A_BODY;
      none.anchor.set(0.5, 0);
      none.x = x + w / 2;
      none.y = rowY + 20;
      layer.addChild(none);
      return;
    }

    for (const key of earnedKeys) {
      const medal = Achievements.getAch(key);
      if (rowY > y + h - 60) break; // stop before overflowing the panel

      const name = new Text({
        text: medal.name,
        style: new TextStyle({
          fill: C_SCORE_GOLD, fontFamily: FONT_HEADER, fontSize: 15,
          fontWeight: "700", letterSpacing: 1,
        }),
      });
      name.alpha = A_LABEL;
      name.x = x + 18;
      name.y = rowY;
      layer.addChild(name);

      const desc = new Text({
        text: medal.desc,
        style: new TextStyle({
          fill: C_BODY,
          fontFamily: FONT_BODY,
          fontSize: 13,
          wordWrap: true,
          wordWrapWidth: w - 36,
        }),
      });
      desc.alpha = A_BODY;
      desc.x = x + 18;
      desc.y = rowY + 18;
      layer.addChild(desc);

      rowY += 18 + desc.height + 14;
    }
  }

  // --- reset confirmation --------------------------------------------------

  private buildConfirm(): void {
    const c = new Container();
    c.visible = false;

    // Modal scrim: swallows clicks aimed at the screen behind the dialog.
    const scrim = makeScrim(0x000000, 0.72);
    scrim.eventMode = "static";
    c.addChild(scrim);

    const w = 420;
    const h = 210;
    const x = (GAME_WIDTH - w) / 2;
    const y = (GAME_HEIGHT - h) / 2;
    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN, alpha: 0.97 });
    panel.view.x = x;
    panel.view.y = y;
    c.addChild(panel.view);

    const heading = new Text({
      text: "RESET STATS",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 22,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    heading.alpha = A_HEADER;
    heading.anchor.set(0.5, 0);
    heading.x = GAME_WIDTH / 2;
    heading.y = y + 22;
    c.addChild(heading);

    const body = new Text({
      text:
        "Clear all statistics and medals?\nThis cannot be undone.\n\n" +
        "Your profile and campaign progress are kept.",
      style: new TextStyle({
        fill: C_BODY,
        fontFamily: FONT_BODY,
        fontSize: 14,
        align: "center",
        lineHeight: 20,
      }),
    });
    body.alpha = A_BODY;
    body.anchor.set(0.5, 0);
    body.x = GAME_WIDTH / 2;
    body.y = y + 56;
    c.addChild(body);

    for (const [label, dx, reverse, onClick] of [
      ["Cancel", -165, false, () => this.closeConfirm()],
      ["Clear", 15, true, () => this.doReset()],
    ] as [string, number, boolean, () => void][]) {
      const b = new Raze2Button(label, { width: 150, height: 40, reverse, onClick });
      b.view.x = GAME_WIDTH / 2 + dx;
      b.view.y = y + h - 56;
      b.view.on("pointerover", () => Sound.play("R2_Click"));
      c.addChild(b.view);
    }

    this.confirm = c;
    this.view.addChild(c);

    // Esc dismisses the dialog, matching the menu's panel shortcuts.
    window.addEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "Escape" && this.confirm.visible) this.closeConfirm();
  };

  private askReset(): void {
    Sound.play("R2_Click");
    this.confirm.visible = true;
  }

  private closeConfirm(): void {
    Sound.play("R2_ClickBack");
    this.confirm.visible = false;
  }

  private doReset(): void {
    SD.resetStats();
    this.confirm.visible = false;
    this.buildStatsPanel();
    this.buildMedalsPanel();
    this.introPanels();
    this.toast.text = "Statistics and medals cleared.";
    this.toast.visible = true;
    this.toastTimer = TOAST_TICKS;
    Sound.play("R2_ClickGo");
  }

  /**
   * Slide the two panels in from opposite edges, the medals a beat behind the
   * stats. Also replayed after a reset, where it doubles as the "these numbers
   * just changed" cue — the figures all go to zero at once, which is otherwise
   * a completely silent update.
   */
  private introPanels(): void {
    Tween.cancel(this);
    slideIn(this.statsLayer, -30, 0, 300, { owner: this });
    slideIn(this.medalsLayer, 30, 0, 300, { owner: this, delay: 70 });
  }

  private back(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(MenuScreen);
  }

  enterFrame(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
      // Fade the confirmation message out over its last half-second.
      this.toast.alpha = Math.min(1, this.toastTimer / 15);
      if (this.toastTimer === 0) this.toast.visible = false;
    }
  }

  destructor(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    Tween.cancel(this);
    super.destructor();
  }
}
