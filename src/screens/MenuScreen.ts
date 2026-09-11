import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Screen, type ScreenClass } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Quality } from "../state/Quality";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground, makeScrim } from "./ui";
import { Tween, fadeIn, slideIn } from "../core/Tween";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_LABEL,
  C_VALUE,
  C_DIM,
  C_SCORE_GOLD,
  C_OPTIONS_GREEN,
  C_ACCENT_SECONDARY,
  C_STATUS_OWNED,
  A_HEADER,
  A_LABEL,
  A_BODY,
  A_VALUE,
} from "../ui/raze2";
import { PlayScreen } from "./PlayScreen";
import { MultiplayerScreen } from "./MultiplayerScreen";
import { CampaignScreen } from "./CampaignScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import { StatsScreen } from "./StatsScreen";
import { InfoScreen } from "./InfoScreen";
import { OptionsScreen } from "./OptionsScreen";

/**
 * Main menu, restyled to pixel-match Raze 2 (doc 13 §1). A cityscape backdrop,
 * the "RAZE 2" wordmark, and the original's single left-aligned vertical nav
 * list (Campaign, Quick Match, Armory, Achievements, Options, Credits, Play
 * More Games, Play Raze 1) rendered with the shared UI kit. The Armor Games /
 * social chrome, "Controls ?" tooltip, "Game saves to:" line, version tag and
 * "Global Stats" corner entry complete the frame.
 *
 * A hidden quick-settings drawer (audio + quality) is kept behind the menu
 * hotkeys (Q quality, G glow, M music, S sound, Esc close) for power users; the
 * full Options screen is reached from the nav list.
 */

interface NavItem {
  label: string;
  action: () => void;
}

export class MenuScreen extends Screen {
  private soundBtn!: Raze2Button;
  private musicBtn!: Raze2Button;
  private qualBtn!: Raze2Button;
  private glowBtn!: Raze2Button;
  private qualHint!: Text;
  private optionsPanel!: Container;
  /** Tween group for the quality hint, kept separate from the panel's own. */
  private hintToken = {};

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));

    this.view.addChild(makeScrim(0x000000, 0.42));

    this.buildWordmark();
    this.buildTopChrome();
    this.buildNav();
    this.buildSidePanel();
    this.buildFooter();

    this.buildOptions();

    window.addEventListener("keydown", this.onKeyDown);
    Sound.setMusic("R2_Menu");
    this.maybeShowUnlock();
  }

  // --- wordmark + banded chrome ------------------------------------------

  private buildWordmark(): void {
    // Big top-center "RAZE 2" logo (screenshot #5: metallic 3D letters, top-center).
    const mark = new Text({
      text: "RAZE 2",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 64,
        fontWeight: "700",
        letterSpacing: 6,
      }),
    });
    mark.alpha = A_HEADER;
    mark.anchor.set(0.5, 0);
    mark.x = GAME_WIDTH / 2;
    mark.y = 14;
    this.view.addChild(mark);

    // "MENU" title bar, centered just under the logo (generic per-frame header,
    // `txt_title`, doc 08 §3.2).
    const title = new Text({
      text: "MENU",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 22,
        fontWeight: "700",
        letterSpacing: 4,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    // Clear of the 64px wordmark above it — at y=90 the two overlapped.
    title.y = 108;
    title.x = GAME_WIDTH / 2;
    this.view.addChild(title);
  }

  private buildTopChrome(): void {
    // Armor Games sponsor line + social handles, top-left corner.
    const sponsor = this.link("ARMOR GAMES", 20, 18, 15, () => SD.urlSponsor());
    this.view.addChild(sponsor);

    // Lay the two handles out from the measured width of the first: at 13px the
    // embedded BlairMdITC renders "Twitter" ~72px wide from x=20, so the old
    // hardcoded x=100 for "Facebook" left no visible gap and the pair read as a
    // single word ("TwitterFacebook").
    const twitter = this.link("Twitter", 20, 42, 13, () => SD.urlTwitter());
    this.view.addChild(twitter);
    const facebook = this.link("Facebook", 0, 42, 13, () => SD.urlFacebook());
    facebook.x = twitter.x + (twitter.width || 72) + 16;
    this.view.addChild(facebook);

    // "Controls ?" helper, top-right of the stage. Right-anchored so it lands on
    // the margin whatever the font measures the string at, rather than being
    // left-anchored at a guessed offset and overhanging the edge.
    const controls = this.link("CONTROLS  ?", GAME_WIDTH - 20, 18, 15, () => {}, 1);
    this.view.addChild(controls);
  }

  /** A plain-text clickable link in the kit's label style. */
  private link(text: string, x: number, y: number, size: number, onClick: () => void, anchorX = 0): Text {
    const t = new Text({
      text,
      style: new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_HEADER,
        fontSize: size,
        fontWeight: "700",
        letterSpacing: 1,
      }),
    });
    t.alpha = A_LABEL;
    t.anchor.set(anchorX, 0);
    t.x = x;
    t.y = y;
    t.eventMode = "static";
    t.cursor = "pointer";
    t.on("pointerover", () => {
      t.style.fill = C_OPTIONS_GREEN;
      t.alpha = 1;
      Sound.play("R2_Click");
    });
    t.on("pointerout", () => {
      t.style.fill = C_LABEL;
      t.alpha = A_LABEL;
    });
    t.on("pointertap", onClick);
    return t;
  }

  // --- left-aligned navigation list --------------------------------------

  private buildNav(): void {
    const items: NavItem[] = [
      { label: "Campaign", action: () => this.go(CampaignScreen) },
      { label: "Quick Match", action: () => this.go(PlayScreen) },
      { label: "Armory", action: () => this.go(ArmoryScreen) },
      { label: "Achievements", action: () => this.go(StatsScreen) },
      { label: "Options", action: () => this.go(OptionsScreen) },
      { label: "Credits", action: () => this.go(InfoScreen) },
      { label: "Play More Games", action: () => SD.urlSponsor() },
      { label: "Play Raze 1", action: () => this.playRaze1() },
    ];

    const x = 60;
    let y = 210;
    const pitch = 44;
    for (const item of items) {
      const btn = new Raze2Button(item.label, {
        width: 250,
        height: 36,
        accent: C_OPTIONS_GREEN,
        onClick: () => {
          Sound.play("R2_Click");
          item.action();
        },
      });
      btn.view.x = x;
      btn.view.y = y;
      btn.view.on("pointerover", () => Sound.play("R2_Click"));
      this.view.addChild(btn.view);
      y += pitch;
    }
  }

  private go(ScreenCtor: ScreenClass): void {
    Sound.resume();
    this.engine.setScreen(ScreenCtor, undefined, "slideLeft");
  }

  private playRaze1(): void {
    if (typeof window !== "undefined" && window.open) {
      window.open("https://armorgames.com/play/1690/raze", "_blank");
    }
  }

  // --- right-side info / online panel ------------------------------------

  private buildSidePanel(): void {
    const w = 300;
    const h = 200;
    const px = GAME_WIDTH - w - 60;
    const py = 210;

    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN, alpha: 0.85 });
    panel.view.x = px;
    panel.view.y = py;
    this.view.addChild(panel.view);

    const heading = new Text({
      text: "PILOT",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 18,
        fontWeight: "700",
        letterSpacing: 2,
      }),
    });
    heading.alpha = A_HEADER;
    heading.x = px + 18;
    heading.y = py + 14;
    this.view.addChild(heading);

    const name = new Text({
      text: SD.profile?.name ?? "Player",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 22 }),
    });
    name.alpha = A_VALUE;
    name.x = px + 18;
    name.y = py + 44;
    this.view.addChild(name);

    const credits = new Text({
      text: `${SD.credits.toLocaleString()} credits`,
      style: new TextStyle({ fill: C_STATUS_OWNED, fontFamily: FONT_VALUE, fontSize: 16 }),
    });
    credits.x = px + 18;
    credits.y = py + 78;
    this.view.addChild(credits);

    // Preserve the online-lobby entry (the old menu's MULTIPLAYER button) as a
    // secondary path — it is not one of the eight authentic nav rows.
    const online = new Raze2Button("Online Match", {
      width: w - 36,
      height: 34,
      accent: C_ACCENT_SECONDARY,
      onClick: () => {
        Sound.play("R2_ClickGo");
        this.go(MultiplayerScreen);
      },
    });
    online.view.x = px + 18;
    online.view.y = py + h - 52;
    online.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(online.view);
  }

  // --- footer chrome ------------------------------------------------------

  private buildFooter(): void {
    // "Game saves to:" line, bottom-right (screenshot #5: right-aligned above the
    // version tag).
    const saves = new Text({
      text: "Game saves to:  This Website",
      style: new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_HEADER,
        fontSize: 15,
        fontWeight: "700",
        letterSpacing: 1,
      }),
    });
    saves.alpha = A_LABEL;
    saves.anchor.set(1, 1);
    saves.x = GAME_WIDTH - 20;
    saves.y = GAME_HEIGHT - 28;
    this.view.addChild(saves);

    // Version tag, bottom-right, under the "Game saves to" line.
    const ver = new Text({
      text: "v2.0",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    ver.alpha = A_VALUE;
    ver.anchor.set(1, 1);
    ver.x = GAME_WIDTH - 20;
    ver.y = GAME_HEIGHT - 8;
    this.view.addChild(ver);

    // Global Stats, bottom-left.
    const stats = this.link("Global Stats", 20, GAME_HEIGHT - 30, 15, () => this.go(StatsScreen));
    this.view.addChild(stats);
  }

  // --- hidden quick-settings drawer (menu hotkeys) -----------------------

  private buildOptions(): void {
    const cx = GAME_WIDTH / 2;
    const p = new Container();
    p.visible = false;

    const panel = new Raze2Panel(380, GAME_HEIGHT - 440, {
      accent: C_OPTIONS_GREEN,
      alpha: 0.85,
    });
    panel.view.x = cx - 190;
    panel.view.y = 440;
    p.addChild(panel.view);

    this.soundBtn = new Raze2Button(this.soundLabel(), {
      width: 160,
      height: 32,
      onClick: () => this.toggleSound(),
    });
    this.soundBtn.view.x = cx - 85 - 80;
    this.soundBtn.view.y = 470 - 16;

    this.musicBtn = new Raze2Button(this.musicLabel(), {
      width: 160,
      height: 32,
      onClick: () => this.toggleMusic(),
    });
    this.musicBtn.view.x = cx + 85 - 80;
    this.musicBtn.view.y = 470 - 16;

    this.qualBtn = new Raze2Button(this.qualLabel(), {
      width: 340,
      height: 32,
      onClick: () => this.cycleQuality(),
    });
    this.qualBtn.view.x = cx - 170;
    this.qualBtn.view.y = 508 - 16;

    this.glowBtn = new Raze2Button(this.glowLabel(), {
      width: 340,
      height: 32,
      onClick: () => this.toggleGlow(),
    });
    this.glowBtn.view.x = cx - 170;
    this.glowBtn.view.y = 546 - 16;

    this.qualHint = new Text({
      text: "",
      style: new TextStyle({ fill: C_DIM, fontFamily: FONT_VALUE, fontSize: 12 }),
    });
    this.qualHint.alpha = A_LABEL;
    this.qualHint.anchor.set(0.5);
    this.qualHint.x = cx;
    this.qualHint.y = 572;

    const keyHint = new Text({
      text: "[Q] Quality   [G] Glow   [M] Music   [S] Sound   [Esc] Close",
      style: new TextStyle({
        fill: C_SCORE_GOLD,
        fontFamily: FONT_VALUE,
        fontSize: 12,
        letterSpacing: 1,
      }),
    });
    keyHint.alpha = A_BODY;
    keyHint.anchor.set(0.5);
    keyHint.x = cx;
    keyHint.y = 589;

    p.addChild(
      this.soundBtn.view,
      this.musicBtn.view,
      this.qualBtn.view,
      this.glowBtn.view,
      this.qualHint,
      keyHint,
    );
    this.optionsPanel = p;
    this.view.addChild(p);
    this.refreshGraphicsLabels();
  }

  private toggleSound(): void {
    SD.sound = !SD.sound;
    SD.save();
    this.soundBtn.setLabel(this.soundLabel());
    Sound.play("R2_Click");
  }

  private toggleMusic(): void {
    SD.music = !SD.music;
    SD.save();
    this.musicBtn.setLabel(this.musicLabel());
    if (SD.music) Sound.setMusic("R2_Menu");
    else Sound.stopMusic();
  }

  private cycleQuality(): void {
    SD.cycleQuality();
    this.refreshGraphicsLabels();
    Sound.play("R2_Click");
  }

  private toggleGlow(): void {
    SD.toggleGlow();
    this.refreshGraphicsLabels();
    Sound.play("R2_Click");
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    switch (e.code) {
      case "KeyQ":
        this.showOptions(true);
        this.cycleQuality();
        break;
      case "KeyG":
        this.showOptions(true);
        this.toggleGlow();
        break;
      case "KeyM":
        this.showOptions(true);
        this.toggleMusic();
        break;
      case "KeyS":
        this.showOptions(true);
        this.toggleSound();
        break;
      case "Escape":
        if (this.optionsPanel.visible) {
          this.showOptions(false);
          Sound.play("R2_ClickBack");
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  private soundLabel() {
    return `Sound: ${SD.sound ? "ON" : "OFF"}`;
  }
  private musicLabel() {
    return `Music: ${SD.music ? "ON" : "OFF"}`;
  }
  private qualLabel() {
    return `Quality: ${Quality.label}  [${Quality.stars()}]`;
  }
  private glowLabel() {
    return `Glow: ${SD.noGlow ? "OFF" : "ON"}`;
  }

  private refreshGraphicsLabels(): void {
    this.qualBtn.setLabel(this.qualLabel());
    this.glowBtn.setLabel(this.glowLabel());
    const fps = Quality.maxFps ? `${Quality.maxFps} fps` : "uncapped";
    fadeIn(this.qualHint, 200, { owner: this.hintToken });
    this.qualHint.text = SD.qual === "low"
      ? `particles ${Math.round(Quality.particleScale * 100)}%  -  no glow at Low  -  ${fps}`
      : `particles ${Math.round(Quality.particleScale * 100)}%  -  glow ${
          Quality.glow ? "on" : "off"
        }  -  ${fps}`;
  }

  private showOptions(on: boolean): void {
    if (this.optionsPanel.visible === on) return;
    Tween.cancel(this);
    this.optionsPanel.visible = on;
    if (on) {
      slideIn(this.optionsPanel, 0, 44, 220, { owner: this });
    } else {
      this.optionsPanel.alpha = 1;
      this.optionsPanel.y = 0;
    }
  }

  // --- unlock banner ------------------------------------------------------

  private unlockBanner: Container | null = null;
  private unlockTimer = 0;

  private maybeShowUnlock(): void {
    const which = SD.showUnlock;
    if (!which) return;
    SD.showUnlock = "";
    SD.save();
    const msg =
      which === "unlock_alien"
        ? "ALIEN SPECIES UNLOCKED!"
        : which === "unlock_beatgame"
          ? "YOU BEAT RAZE!"
          : "";
    if (!msg) return;

    const b = new Container();
    const g = new Graphics();
    g.roundRect(GAME_WIDTH / 2 - 320, GAME_HEIGHT / 2 - 46, 640, 92, 6)
      .fill({ color: 0x000000, alpha: 0.9 })
      .stroke({ color: C_OPTIONS_GREEN, width: 2, alpha: 0.95 });
    b.addChild(g);
    const t = new Text({
      text: msg,
      style: new TextStyle({
        fill: C_OPTIONS_GREEN,
        fontFamily: FONT_HEADER,
        fontSize: 34,
        fontWeight: "700",
        letterSpacing: 3,
      }),
    });
    t.anchor.set(0.5);
    t.x = GAME_WIDTH / 2;
    t.y = GAME_HEIGHT / 2;
    b.addChild(t);
    this.view.addChild(b);
    this.unlockBanner = b;
    this.unlockTimer = 150;
    fadeIn(b, 250, { owner: this });
    Sound.play("R2_Medal");
  }

  enterFrame(): void {
    if (this.unlockBanner && --this.unlockTimer <= 0) {
      this.unlockBanner.destroy({ children: true });
      this.unlockBanner = null;
    }
  }

  destructor(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    Tween.cancel(this);
    Tween.cancel(this.hintToken);
    super.destructor();
  }
}
