import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Achievements, R2_ACH_IDS } from "../game/Achievements";
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
 * Stats & awards screen — also where the menu's ACHIEVEMENTS entry lands.
 *
 * Left panel: SD.stats (kills/deaths/K-D, wins/losses, headshots, accuracy).
 * Right panel: the ten Raze 2 achievements, then any Raze 1 kill-bonus medals
 * earned, both read out of the table in game/Achievements.ts. Achievements list
 * whether or not they are earned — `Menu.as:2585-2601` builds all ten rows, and
 * for the four secrets the locked row's description is the only hint the player
 * ever gets — while medals only appear once banked.
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
const MARGIN = 24;
const GAP = 20;
const PANEL_Y = 92;
/** Top of the awards list body, below the panel's fixed heading. */
const LIST_Y = PANEL_Y + 52;
/** Pixels scrolled per wheel notch / arrow press, as on the info screen. */
const SCROLL_STEP = 42;

/** The two columns split the stage (keeping the source 320:440 ratio) instead
 *  of sitting centred inside it, so a wide window has no side gutters. */
const statsW = () => Math.round((GAME_WIDTH - MARGIN * 2 - GAP) * (320 / 760));
const medalsW = () => GAME_WIDTH - MARGIN * 2 - GAP - statsW();
const statsX = () => MARGIN;
const medalsX = () => statsX() + statsW() + GAP;
const panelH = () => GAME_HEIGHT - PANEL_Y - 103;
const buttonY = () => GAME_HEIGHT - 64;

export class StatsScreen extends Screen {
  /** Rebuilt in place after a reset so the numbers refresh without a reload. */
  private statsLayer = new Container();
  private medalsLayer = new Container();
  private confirm!: Container;
  private toast!: Text;
  private toastTimer = 0;

  /** Scrolled body of the awards column, rebuilt with the panel. */
  private medalsContent: Container | null = null;
  private scrollBar: Graphics | null = null;
  private scrollTrackH = 0;
  private scroll = 0;
  private maxScroll = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.6));

    const title = new Text({
      text: "STATS & AWARDS",
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
    this.button("Reset Stats", medalsX() + medalsW() - 180, buttonY(), 180,
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
    const panel = new Raze2Panel(statsW(), h, { accent: C_OPTIONS_GREEN });
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
    heading.x = x + statsW() / 2;
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
      v.x = x + statsW() - 18;
      v.y = rowY;
      layer.addChild(v);
    });
  }

  /**
   * The awards column: the ten Raze 2 achievements (always all ten — see
   * `R2_ACH_IDS`), then whatever Raze 1 kill-bonus medals have been earned.
   *
   * The rows outrun the panel, so the list body is a masked, wheel/arrow
   * scrollable column like the info screen's. Both the mask and the content live
   * inside `medalsLayer` so the intro slide carries them together.
   */
  private buildMedalsPanel(): void {
    const layer = this.medalsLayer;
    layer.removeChildren();

    const x = medalsX();
    const y = PANEL_Y;
    const w = medalsW();
    const h = panelH();
    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    layer.addChild(panel.view);

    const heading = new Text({
      text: "ACHIEVEMENTS",
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

    const content = new Container();
    const mask = new Graphics();
    mask.rect(x + 4, LIST_Y, w - 8, y + h - 14 - LIST_Y).fill({ color: 0xffffff });
    content.mask = mask;
    layer.addChild(mask, content);
    this.medalsContent = content;

    // Achievements first, earned or not: a locked row's description is the hint.
    let rowY = 0;
    for (const key of R2_ACH_IDS) {
      rowY = this.awardRow(content, key, rowY, !!SD.medals[key]);
    }

    // Then the Raze 1 kill-bonus medals, which are only listed once earned.
    const earned = Object.keys(SD.medals).filter(
      (k) => SD.medals[k] && !R2_ACH_IDS.includes(k),
    );
    if (earned.length) {
      const sub = new Text({
        text: "MEDALS",
        style: new TextStyle({
          fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16,
          fontWeight: "700", letterSpacing: 2,
        }),
      });
      sub.alpha = A_HEADER;
      sub.x = x + 18;
      sub.y = rowY + 10;
      content.addChild(sub);
      rowY += 38;
      for (const key of earned) rowY = this.awardRow(content, key, rowY, true);
    }

    this.maxScroll = Math.max(0, rowY - (y + h - 14 - LIST_Y) + 12);
    this.scroll = Math.min(this.scroll, this.maxScroll);
    this.buildScrollBar(layer);
    this.applyScroll();
  }

  /**
   * One award row. Locked rows keep the name and description — that text is the
   * only in-game hint for the four secrets — but drop to the dim palette, and
   * the reward is spelled out so the player can see what is on offer.
   */
  private awardRow(parent: Container, key: string, rowY: number, earned: boolean): number {
    const x = medalsX();
    const w = medalsW();
    const medal = Achievements.getAch(key);

    // The ten Raze 2 achievements carry their original `AchievementIcons_90`
    // art (baked per label); the Raze 1 medals have no per-award icon here.
    const iconTex = R2_ACH_IDS.includes(key) ? UiArt.r2(`ach_${key}`) : null;
    const textX = x + (iconTex ? 66 : 18);
    if (iconTex) {
      const icon = new Sprite(iconTex);
      const size = 40;
      icon.width = size;
      icon.height = size;
      icon.x = x + 16;
      icon.y = rowY + 2;
      icon.alpha = earned ? 1 : 0.4;
      parent.addChild(icon);
    }

    const name = new Text({
      text: medal.name,
      style: new TextStyle({
        fill: earned ? C_SCORE_GOLD : C_LABEL, fontFamily: FONT_HEADER,
        fontSize: 15, fontWeight: "700", letterSpacing: 1,
      }),
    });
    name.alpha = earned ? A_LABEL : A_LABEL * 0.55;
    name.x = textX;
    name.y = rowY;
    parent.addChild(name);

    // Right-aligned status: the payout while locked, a tick once it is banked.
    const rew = medal.rew;
    const tag = earned
      ? "✓"
      : rew
        ? rew[0] === "credits" ? `${rew[1]} cr` : `${rew[1]}`
        : "";
    if (tag) {
      const t = new Text({
        text: tag,
        style: new TextStyle({
          fill: earned ? C_OPTIONS_GREEN : C_DIM, fontFamily: FONT_VALUE,
          fontSize: 13, fontWeight: "700",
        }),
      });
      t.alpha = earned ? A_VALUE : A_BODY;
      t.anchor.set(1, 0);
      t.x = x + w - 18;
      t.y = rowY + 2;
      parent.addChild(t);
    }

    const desc = new Text({
      text: medal.desc,
      style: new TextStyle({
        fill: C_BODY,
        fontFamily: FONT_BODY,
        fontSize: 13,
        wordWrap: true,
        wordWrapWidth: w - (textX - x) - 18,
      }),
    });
    desc.alpha = earned ? A_BODY : A_BODY * 0.55;
    desc.x = textX;
    desc.y = rowY + 18;
    parent.addChild(desc);

    return rowY + 18 + desc.height + 14;
  }

  // --- award-list scrolling -------------------------------------------------

  private buildScrollBar(layer: Container): void {
    const x = medalsX() + medalsW() - 12;
    const trackH = panelH() - (LIST_Y - PANEL_Y) - 22;
    const track = new Graphics();
    track.roundRect(x, LIST_Y + 4, 5, trackH, 2.5).fill({ color: 0x000000, alpha: 0.5 });
    track.visible = this.maxScroll > 0;
    layer.addChild(track);

    this.scrollBar = new Graphics();
    layer.addChild(this.scrollBar);
    this.scrollTrackH = trackH;
  }

  private applyScroll(): void {
    if (!this.medalsContent) return;
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll));
    this.medalsContent.y = LIST_Y - this.scroll;

    const g = this.scrollBar;
    if (!g) return;
    g.clear();
    if (this.maxScroll <= 0) return;
    const trackH = this.scrollTrackH;
    const thumbH = Math.max(28, trackH * (trackH / (trackH + this.maxScroll)));
    const t = this.scroll / this.maxScroll;
    const x = medalsX() + medalsW() - 12;
    g.roundRect(x, LIST_Y + 4 + (trackH - thumbH) * t, 5, thumbH, 2.5)
      .fill({ color: C_OPTIONS_GREEN, alpha: 0.85 });
  }

  private scrollBy(px: number): void {
    if (this.maxScroll <= 0) return;
    this.scroll += px;
    this.applyScroll();
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.confirm?.visible) return;
    this.scrollBy(Math.sign(e.deltaY) * SCROLL_STEP);
  };

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

    // Esc dismisses the dialog, matching the menu's panel shortcuts; with it
    // closed the same handler drives the award list's arrow-key scrolling.
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("wheel", this.onWheel, { passive: true });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.confirm.visible) {
      if (e.code === "Escape") this.closeConfirm();
      return;
    }
    if (e.code === "ArrowDown") this.scrollBy(SCROLL_STEP);
    else if (e.code === "ArrowUp") this.scrollBy(-SCROLL_STEP);
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
    this.scroll = 0; // the list just got shorter; don't leave it parked past the end
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
    this.engine.setScreen(MenuScreen, undefined, "slideRight");
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
    window.removeEventListener("wheel", this.onWheel);
    Tween.cancel(this);
    super.destructor();
  }
}
