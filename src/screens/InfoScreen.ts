import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { Input } from "../core/Input";
import { UiArt } from "../assets/UiArt";
import { makeBackground, makeScrim } from "./ui";
import { Tween, fadeIn, slideIn } from "../core/Tween";
import { MenuScreen } from "./MenuScreen";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_BODY,
  C_DIM,
  C_HOVER,
  C_OPTIONS_GREEN,
  C_SCORE_GOLD,
  A_HEADER,
  A_BODY,
} from "../ui/raze2";

/**
 * About / credits screen. Replaces the cramped inline credits panel that used
 * to live on the menu, and carries the authorship the original SWF put in its
 * right-click context menu (Juice-Tin / AddisonR / Armor Games) plus port
 * notes and a short changelog.
 *
 * The body is a masked, scrollable column: mouse wheel, arrow keys and
 * PageUp/PageDown all move it, and a track on the right shows the position.
 */

/** Port version shown in the header — keep in step with package.json. */
const VERSION = "0.1.0";

// The viewport is centred on the stage and wide enough for the document's
// longest hard-wrapped line (~88 monospace columns at 12px); the old 590px
// window was sized for the original 700px stage, so it sat well left of the
// centred title/CLOSE button and its mask clipped the body copy.
const VIEW_W = 780;
const VIEW_Y = 92;
/** Read at build time, not import time — the stage size is the window's. */
const viewX = () => Math.round((GAME_WIDTH - VIEW_W) / 2);
/** Grows with the window so a taller one reads more of the document at once,
 *  rather than leaving a gap between the viewport and the CLOSE button. */
const viewH = () => GAME_HEIGHT - VIEW_Y - 135;

/** Pixels scrolled per wheel notch / key press. */
const SCROLL_STEP = 34;

/** Width of the document column: the viewport less its gutter and scrollbar. */
const COL_W = VIEW_W - 66;

type Row =
  | { kind: "h"; text: string }
  | { kind: "p"; text: string }
  /** Label left, value right — replaces dot leaders, which needed a mono face. */
  | { kind: "kv"; label: string; value: string }
  | { kind: "link"; text: string; onClick: () => void };

export class InfoScreen extends Screen {
  private content = new Container();
  private scrollBar!: Graphics;
  private scrollTrack!: Graphics;
  private scroll = 0;
  private maxScroll = 0;
  private prevWheel = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.68));

    const title = new Text({
      text: "ABOUT RAZE",
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

    const sub = new Text({
      text: `TypeScript / PixiJS port  ·  v${VERSION}`,
      style: new TextStyle({ fill: C_DIM, fontFamily: FONT_VALUE, fontSize: 12, letterSpacing: 2 }),
    });
    sub.anchor.set(0.5, 0);
    sub.x = GAME_WIDTH / 2;
    sub.y = 74;
    this.view.addChild(sub);

    const panel = new Raze2Panel(VIEW_W, viewH(), { accent: C_OPTIONS_GREEN });
    panel.view.x = viewX();
    panel.view.y = VIEW_Y;
    const viewportPanel = panel.view;
    this.view.addChild(viewportPanel);

    // Masked viewport: content scrolls under a fixed window.
    const mask = new Graphics();
    mask.rect(viewX(), VIEW_Y, VIEW_W, viewH()).fill({ color: 0xffffff });
    this.view.addChild(mask);
    this.content.mask = mask;
    this.content.x = viewX() + 22;
    this.content.y = VIEW_Y + 16;
    this.view.addChild(this.content);

    this.buildContent();
    this.buildScrollBar();

    // The credits panel rises into place and its text fades up just behind it,
    // so arriving here reads as opening a document rather than a hard cut.
    // Only the frame is moved: the content's own y is owned by the scroller.
    slideIn(viewportPanel, 0, 26, 300, { owner: this });
    fadeIn(this.content, 320, { owner: this, delay: 90 });

    const close = new Raze2Button("Back to Menu", {
      width: 220, height: 40, onClick: () => this.close(),
    });
    close.view.x = viewX();
    close.view.y = GAME_HEIGHT - 64;
    close.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(close.view);

    const hint = new Text({
      text: "scroll with the wheel or ↑/↓  ·  [Esc] close",
      style: new TextStyle({ fill: C_DIM, fontFamily: FONT_VALUE, fontSize: 12 }),
    });
    hint.alpha = A_BODY;
    // Shares the footer baseline with the button, pinned to the viewport's
    // right edge so the row reads action-left / instruction-right.
    hint.anchor.set(1, 0.5);
    hint.x = viewX() + VIEW_W;
    hint.y = GAME_HEIGHT - 44;
    this.view.addChild(hint);

    window.addEventListener("keydown", this.onKeyDown);
  }

  /** The document, laid out top-to-bottom into the scrollable column. */
  private rows(): Row[] {
    return [
      { kind: "h", text: "THE GAME" },
      {
        kind: "p",
        text:
          "RAZE is a 2D ragdoll arena shooter first released as a Flash game in 2010. Fight through\n" +
          "two 15-mission campaigns — Human and Alien — or set up a quick deathmatch against bots.",
      },

      { kind: "h", text: "ORIGINAL CREDITS" },
      { kind: "kv", label: "Design & programming", value: "Juice-Tin" },
      { kind: "kv", label: "Art & animation", value: "AddisonR" },
      { kind: "kv", label: "Published by", value: "Armor Games (2010)" },

      { kind: "h", text: "LINKS" },
      { kind: "link", text: "▸  Juice-Tin — juice-tin.com", onClick: () => SD.urlJuice() },
      { kind: "link", text: "▸  Armor Games — armorgames.com", onClick: () => SD.urlSponsor() },
      { kind: "link", text: "▸  Armor Games on Twitter", onClick: () => SD.urlTwitter() },
      { kind: "link", text: "▸  Armor Games on Facebook", onClick: () => SD.urlFacebook() },

      { kind: "h", text: "THIS PORT" },
      {
        kind: "p",
        text:
          "A from-scratch TypeScript rewrite of the decompiled ActionScript 3 source, rendered with\n" +
          "PixiJS v8 (WebGL) and simulated with planck.js for ragdoll physics. Art, sound and music\n" +
          "are extracted from the original SWF; saved data lives in localStorage rather than a Flash\n" +
          "SharedObject. No Flash Player, plugin or emulator is involved — it is plain web code.",
      },
      { kind: "kv", label: "Engine", value: "PixiJS v8 · planck.js · Vite · TypeScript 5" },
      { kind: "kv", label: "Resolution", value: "fills the window, 1136 x 639 floor, fixed 30 Hz logic step" },
      { kind: "kv", label: "Saved data", value: "localStorage (profile, stats, medals, progression)" },

      { kind: "h", text: "VERSION NOTES" },
      {
        kind: "p",
        text:
          `v${VERSION}\n` +
          "  · Campaign screen shows locked / next / completed missions and overall progress.\n" +
          "  · Juice-Tin developer splash restored between the loader and the title screen.\n" +
          "  · Menu hotkeys: Q quality, G glow, M music, S sound, Esc close panels.\n" +
          "  · Stats screen can clear statistics and medals behind a confirmation.\n" +
          "  · Graphics quality levels (Low/Medium/High/Max) with a live glow toggle.\n" +
          "  · Ragdoll deaths, medals, and both campaigns playable end to end.",
      },

      { kind: "h", text: "PORT CONTRIBUTORS" },
      { kind: "kv", label: "Port engineering", value: "Raze-TS contributors" },
      { kind: "kv", label: "Asset extraction", value: "from the original SWF via ffdec" },
      {
        kind: "p",
        text:
          "All original game content remains the property of its authors. This port exists for\n" +
          "preservation and study now that the Flash runtime is gone.",
      },
    ];
  }

  private buildContent(): void {
    let y = 0;
    for (const row of this.rows()) {
      if (row.kind === "h") {
        if (y > 0) y += 14;
        const t = new Text({
          text: row.text,
          style: new TextStyle({
            fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 16,
            fontWeight: "700", letterSpacing: 3,
          }),
        });
        t.alpha = A_HEADER;
        t.y = y;
        this.content.addChild(t);

        const rule = new Graphics();
        rule.rect(0, y + 22, COL_W, 1).fill({ color: C_OPTIONS_GREEN, alpha: 0.5 });
        this.content.addChild(rule);
        y += 32;
        continue;
      }

      if (row.kind === "kv") {
        const l = new Text({
          text: row.label,
          style: new TextStyle({ fill: C_DIM, fontFamily: FONT_VALUE, fontSize: 13 }),
        });
        l.alpha = A_BODY;
        l.y = y;
        this.content.addChild(l);

        const v = new Text({
          text: row.value,
          style: new TextStyle({ fill: C_BODY, fontFamily: FONT_VALUE, fontSize: 13 }),
        });
        v.alpha = A_BODY;
        v.anchor.set(1, 0);
        v.x = COL_W;
        v.y = y;
        this.content.addChild(v);
        y += 21;
        continue;
      }

      if (row.kind === "link") {
        const t = new Text({
          text: row.text,
          style: new TextStyle({ fill: C_SCORE_GOLD, fontFamily: FONT_VALUE, fontSize: 14 }),
        });
        t.alpha = A_BODY;
        t.y = y;
        t.eventMode = "static";
        t.cursor = "pointer";
        t.on("pointerover", () => {
          t.style.fill = C_HOVER;
          Sound.play("R2_Click");
        });
        t.on("pointerout", () => (t.style.fill = C_SCORE_GOLD));
        t.on("pointertap", () => {
          Sound.play("R2_ClickGo");
          row.onClick();
        });
        this.content.addChild(t);
        y += 22;
        continue;
      }

      const t = new Text({
        text: row.text,
        style: new TextStyle({
          fill: C_BODY,
          fontFamily: FONT_BODY,
          fontSize: 13,
          lineHeight: 19,
        }),
      });
      t.alpha = A_BODY;
      t.y = y;
      this.content.addChild(t);
      y += t.height + 8;
    }

    this.maxScroll = Math.max(0, y - (viewH() - 32));
  }

  private buildScrollBar(): void {
    const x = viewX() + VIEW_W - 14;
    this.scrollTrack = new Graphics();
    this.scrollTrack.roundRect(x, VIEW_Y + 8, 6, viewH() - 16, 3).fill({ color: 0x000000, alpha: 0.5 });
    this.view.addChild(this.scrollTrack);

    this.scrollBar = new Graphics();
    this.view.addChild(this.scrollBar);
    this.refreshScroll();
  }

  private refreshScroll(): void {
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll));
    this.content.y = VIEW_Y + 16 - this.scroll;

    const trackH = viewH() - 16;
    const x = viewX() + VIEW_W - 14;
    const visible = this.maxScroll > 0;
    this.scrollTrack.visible = visible;
    this.scrollBar.clear();
    if (!visible) return;

    // Thumb length is proportional to the fraction of the document on screen.
    const frac = viewH() / (viewH() + this.maxScroll);
    const thumbH = Math.max(28, trackH * frac);
    const t = this.maxScroll > 0 ? this.scroll / this.maxScroll : 0;
    const thumbY = VIEW_Y + 8 + (trackH - thumbH) * t;
    this.scrollBar.roundRect(x, thumbY, 6, thumbH, 3).fill({ color: C_OPTIONS_GREEN, alpha: 0.85 });
  }

  private scrollBy(px: number): void {
    this.scroll += px;
    this.refreshScroll();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    switch (e.code) {
      case "Escape":
      case "Backspace":
        this.close();
        break;
      case "ArrowDown":
        this.scrollBy(SCROLL_STEP);
        break;
      case "ArrowUp":
        this.scrollBy(-SCROLL_STEP);
        break;
      case "PageDown":
        this.scrollBy(viewH() - 40);
        break;
      case "PageUp":
        this.scrollBy(-(viewH() - 40));
        break;
      case "Home":
        this.scroll = 0;
        this.refreshScroll();
        break;
      case "End":
        this.scroll = this.maxScroll;
        this.refreshScroll();
        break;
    }
  };

  private close(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(MenuScreen, undefined, "slideRight");
  }

  enterFrame(): void {
    // Input.wheelDelta is a running accumulator, not a per-frame value; compare
    // against the previous reading the same way Player does.
    const wheel = Input.wheelDelta;
    if (wheel !== this.prevWheel) {
      this.scrollBy((wheel - this.prevWheel) * SCROLL_STEP);
      this.prevWheel = wheel;
    }
  }

  destructor(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    Tween.cancel(this);
    super.destructor();
  }
}
