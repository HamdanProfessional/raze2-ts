import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Anim } from "../assets/Anim";
import { PartArt } from "../assets/PartArt";
import { PartFigure } from "../game/PartFigure";
import { DomInput } from "../net/DomInput";
import {
  COSTUME_MAX,
  animStateFor,
  clampCostume,
  costumeForPreset,
  getAnimText,
  getNextPrevAnim,
  getNextPrevCost,
  idleAnimForPreset,
  persForCostume,
  persForIndex,
} from "../game/ProfileUnit";
import { makeBackground, makeScrim } from "./ui";
import { MenuScreen } from "./MenuScreen";
import {
  Raze2Button,
  drawRaze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_DIM,
  C_PANEL_HAIRLINE,
  C_OPTIONS_GREEN,
  C_GLOW_CYAN,
  C_LOCKED,
  A_HEADER,
  A_LABEL,
} from "../ui/raze2";

/**
 * Character customization — restyled as a modern game "character select":
 * a large character on a lit pedestal on the left, an editable name field, a
 * species/class strip, and a stack of glassy selector cards on the right for
 * preset / head / body / legs / action, plus RANDOMIZE / RESET / SAVE.
 *
 * All profile logic is unchanged (ProfileUnit helpers); this is a presentation
 * rework of the old three-column text menu.
 */

/** Chrome accent — the Raze 2 Options green, same as every other kit screen. */
const ACCENT = C_OPTIONS_GREEN;
/** Secondary accent for the pedestal ring and the ACTION card. */
const ACCENT2 = C_GLOW_CYAN;
const INK = C_HEADER;
const DIM = C_DIM;

const PERS_COLOR: Record<string, number> = {
  gamer: 0x4f9dd9,
  robot: 0xc7ccd1,
  alien: 0x6fd06f,
  zombie: 0x9b7fc4,
};
const PERS_LABEL: Record<string, string> = {
  gamer: "HUMAN",
  robot: "ROBOT",
  alien: "ALIEN",
  zombie: "ZOMBIE",
};
const PERS_ORDER = ["gamer", "robot", "alien", "zombie"];

type PartKey = "head" | "body" | "legs";

interface Selector {
  refresh: () => void;
}

// Stage (left) and card panel (right) geometry.
const STAGE_X = 40;
const STAGE_W = 470;
const PANEL_X = 540;
const PANEL_Y = 92;
/** Read at build time, not import time — the stage size is the window's. */
const panelW = () => GAME_WIDTH - PANEL_X - 40;
/** Both columns run from the header down to the footer button row. */
const panelH = () => GAME_HEIGHT - PANEL_Y - 107;
const buttonY = () => GAME_HEIGHT - 64;

export class CustomizeScreen extends Screen {
  private preset: number;
  private parts: Record<PartKey, number>;
  private action: string;

  private nameInput!: DomInput;
  private classPills: { pers: string; g: Graphics; label: Text }[] = [];
  private selectors: Selector[] = [];

  private previewLayer = new Container();
  private previewSprite: Sprite | null = null;
  /** Layered per-costume preview figure (preferred over the baked sprite). */
  private previewFigure: PartFigure | null = null;
  private pedestalGlow = new Graphics();
  private previewScale = 1;
  private animFrame = 1;
  private animTick = 0;
  private turntable = 0;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.preset = clampCostume(SD.profile.prof_preset || 1);
    this.parts = {
      head: clampCostume(SD.profile.prof_head || this.preset),
      body: clampCostume(SD.profile.prof_body || this.preset),
      legs: clampCostume(SD.profile.prof_legs || this.preset),
    };
    // If a locked ALIEN costume was somehow saved (e.g. progress reset), fall back
    // to the default human preset so the player can't keep a locked species.
    if (!SD.alienUnlocked && persForIndex(this.preset) === "alien") {
      this.preset = 1;
      this.parts = { head: 1, body: 1, legs: 1 };
    }
    this.action = SD.profile.prof_action || "idle";

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0a0d12));
    this.view.addChild(makeScrim(0x05070c, 0.66));

    this.buildHeader();
    this.buildStage();
    this.buildPanel();

    this.rebuildPreview();
    this.refreshAll();
  }

  // --- header ------------------------------------------------------------

  private buildHeader(): void {
    const title = new Text({
      text: "CUSTOMIZE",
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
  }

  // --- character stage ---------------------------------------------------

  private buildStage(): void {
    // Framed stage.
    this.panel(STAGE_X, PANEL_Y, STAGE_W, panelH());

    const cx = STAGE_X + STAGE_W / 2;
    const groundY = PANEL_Y + panelH() - 96;

    // Soft pedestal glow (stacked translucent discs) behind the character.
    this.view.addChild(this.pedestalGlow);
    this.pedestalGlow.x = cx;
    this.pedestalGlow.y = groundY;

    // previewLayer origin = feet, centred on the pedestal.
    this.previewLayer.x = cx;
    this.previewLayer.y = groundY;
    this.view.addChild(this.previewLayer);

    // Pedestal ring + drop shadow, drawn above the glow but below nothing else.
    const ring = new Graphics();
    ring.ellipse(cx, groundY + 6, 116, 26).fill({ color: 0x000000, alpha: 0.45 });
    ring.ellipse(cx, groundY + 4, 108, 22).stroke({ color: ACCENT, width: 2, alpha: 0.5 });
    ring.ellipse(cx, groundY + 4, 84, 16).stroke({ color: ACCENT, width: 1, alpha: 0.25 });
    this.view.addChildAt(ring, this.view.getChildIndex(this.previewLayer));
  }

  private paintPedestalGlow(color: number): void {
    const g = this.pedestalGlow;
    g.clear();
    for (let i = 6; i >= 1; i--) {
      const r = i * 26;
      g.ellipse(0, -60, r, r * 0.9).fill({ color, alpha: 0.045 });
    }
  }

  // --- right panel: name, class strip, selectors, actions ----------------

  private buildPanel(): void {
    this.panel(PANEL_X, PANEL_Y, panelW(), panelH());
    const cx = PANEL_X + panelW() / 2;

    // Name field (editable inline).
    const nameLabel = new Text({
      text: "CALLSIGN",
      style: new TextStyle({ fill: DIM, fontFamily: FONT_VALUE, fontSize: 12, letterSpacing: 3 }),
    });
    nameLabel.alpha = A_LABEL;
    nameLabel.x = PANEL_X + 24;
    // The field below is centred on y=140 and 40px tall, so its top edge is at
    // 120 — the label sat on it at 112.
    nameLabel.y = 102;
    this.view.addChild(nameLabel);

    this.nameInput = new DomInput(this.engine, {
      x: cx, y: 140, width: panelW() - 48, height: 40, fontSize: 20,
      accent: "#57DEB0",
      placeholder: "Your name", maxLength: 16,
      value: SD.profile.name && SD.profile.name !== "Player" ? SD.profile.name : "",
    });

    // Class / species strip.
    const strip = new Text({
      text: "CLASS",
      style: new TextStyle({ fill: DIM, fontFamily: FONT_VALUE, fontSize: 12, letterSpacing: 3 }),
    });
    strip.alpha = A_LABEL;
    strip.x = PANEL_X + 24;
    strip.y = 176;
    this.view.addChild(strip);
    this.buildClassPills(PANEL_X + 24, 194, panelW() - 48);

    // Selector cards.
    const top = 244;
    const gap = 52;
    this.selectors.push(this.buildSelector("PRESET", top, {
      value: () => `${String(this.preset).padStart(2, "0")} · ${PERS_LABEL[costumeForPreset(this.preset).pers]}`,
      accent: () => PERS_COLOR[costumeForPreset(this.preset).pers] ?? ACCENT,
      changed: () => false,
      prev: () => this.cyclePreset(false),
      next: () => this.cyclePreset(true),
    }));
    for (const key of ["head", "body", "legs"] as PartKey[]) {
      this.selectors.push(this.buildSelector(key.toUpperCase(), top + gap * (["head", "body", "legs"].indexOf(key) + 1), {
        value: () => `${String(this.parts[key]).padStart(2, "0")} · ${PERS_LABEL[persForIndex(this.parts[key])]}`,
        accent: () => PERS_COLOR[persForIndex(this.parts[key])] ?? ACCENT,
        changed: () => this.parts[key] !== this.preset,
        prev: () => this.cyclePart(key, false),
        next: () => this.cyclePart(key, true),
      }));
    }
    this.selectors.push(this.buildSelector("ACTION", top + gap * 4, {
      value: () => getAnimText(this.action),
      accent: () => ACCENT2,
      changed: () => animStateFor(this.action) !== "idle",
      prev: () => this.cycleAction(false),
      next: () => this.cycleAction(true),
    }));

    // Footer row: Back under the character stage, the edit actions under the
    // card column, Save pinned to its right edge.
    const by = buttonY();
    this.button("Back", STAGE_X, by, 160, () => this.back());
    this.button("Random", PANEL_X, by, 150, () => this.randomize());
    this.button("Reset", PANEL_X + 162, by, 130, () => this.resetToPreset());
    this.button("Save", PANEL_X + panelW() - 160, by, 160, () => this.saveAndBack(), true);
  }

  /** A kit button. `go` marks the affirmative action with the inverted bar. */
  private button(
    label: string, x: number, y: number, width: number,
    onClick: () => void, go = false, height = 40,
  ): Raze2Button {
    const b = new Raze2Button(label, { width, height, reverse: go, onClick });
    b.view.x = x;
    b.view.y = y;
    b.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(b.view);
    return b;
  }

  private buildClassPills(x: number, y: number, w: number): void {
    const n = PERS_ORDER.length;
    const gap = 8;
    const pw = (w - gap * (n - 1)) / n;
    PERS_ORDER.forEach((pers, i) => {
      const px = x + i * (pw + gap);
      const g = new Graphics();
      this.view.addChild(g);
      const label = new Text({
        text: PERS_LABEL[pers],
        style: new TextStyle({
          fill: INK, fontFamily: FONT_HEADER, fontSize: 13,
          fontWeight: "700", letterSpacing: 1,
        }),
      });
      label.anchor.set(0.5);
      label.x = px + pw / 2;
      label.y = y + 15;
      this.view.addChild(label);
      // Repaint helper stored via closure on the pill entry.
      (g as any)._geo = { px, y, pw };
      this.classPills.push({ pers, g, label });
    });
  }

  /** A selector card: label, big value, accent bar, and ◀ / ▶ chevrons. */
  private buildSelector(
    label: string,
    y: number,
    hooks: {
      value: () => string;
      accent: () => number;
      changed: () => boolean;
      prev: () => void;
      next: () => void;
    },
  ): Selector {
    const x = PANEL_X + 24;
    const w = panelW() - 48;
    const h = 44;

    const card = new Graphics();
    card.x = x;
    card.y = y;
    this.view.addChild(card);

    const accentBar = new Graphics();
    accentBar.x = x;
    accentBar.y = y;
    this.view.addChild(accentBar);

    const labelText = new Text({
      text: label,
      style: new TextStyle({ fill: DIM, fontFamily: FONT_VALUE, fontSize: 11, letterSpacing: 2 }),
    });
    labelText.alpha = A_LABEL;
    labelText.x = x + 16;
    labelText.y = y + 7;
    this.view.addChild(labelText);

    const valueText = new Text({
      text: "",
      style: new TextStyle({ fill: INK, fontFamily: FONT_VALUE, fontSize: 16 }),
    });
    valueText.x = x + 16;
    valueText.y = y + 21;
    this.view.addChild(valueText);

    const marker = new Text({
      text: "",
      style: new TextStyle({
        fill: ACCENT, fontFamily: FONT_HEADER, fontSize: 11,
        fontWeight: "700", letterSpacing: 2,
      }),
    });
    marker.anchor.set(1, 0);
    marker.x = x + w - 96;
    marker.y = y + 8;
    this.view.addChild(marker);

    this.button("‹", x + w - 84, y + 5, 38, hooks.prev, false, 34);
    this.button("›", x + w - 42, y + 5, 38, hooks.next, true, 34);

    const refresh = () => {
      const accent = hooks.accent();
      const changed = hooks.changed();
      card.clear();
      card.rect(0, 0, w, h)
        .fill({ color: 0x000000, alpha: 0.55 })
        .stroke({ color: changed ? ACCENT : C_PANEL_HAIRLINE, width: changed ? 1.5 : 1, alpha: 0.9 });
      accentBar.clear();
      accentBar.rect(0, 6, 3, h - 12).fill({ color: accent });
      valueText.text = hooks.value();
      valueText.style.fill = changed ? ACCENT : INK;
      marker.text = changed ? "MODIFIED" : "";
    };

    return { refresh };
  }

  private panel(x: number, y: number, w: number, h: number): void {
    const g = new Graphics();
    drawRaze2Panel(g, x, y, w, h, { accent: ACCENT });
    this.view.addChild(g);
  }

  // --- interaction -------------------------------------------------------

  private cyclePreset(next: boolean): void {
    let p = getNextPrevCost(this.preset, next);
    // Skip the locked ALIEN species range until the human campaign is beaten.
    if (!SD.alienUnlocked) {
      let guard = 0;
      while (persForIndex(p) === "alien" && guard++ < COSTUME_MAX) p = getNextPrevCost(p, next);
    }
    this.preset = p;
    this.parts.head = this.preset;
    this.parts.body = this.preset;
    this.parts.legs = this.preset;
    if (animStateFor(this.action) === "idle") this.action = idleAnimForPreset(this.preset);
    this.rebuildPreview();
    this.afterChange();
  }

  private cyclePart(key: PartKey, next: boolean): void {
    this.parts[key] = getNextPrevCost(this.parts[key], next);
    this.afterChange();
  }

  private cycleAction(next: boolean): void {
    this.action = getNextPrevAnim(this.action, next, this.preset);
    this.rebuildPreview();
    this.afterChange();
  }

  private resetToPreset(): void {
    const c = costumeForPreset(this.preset);
    this.parts.head = c.head;
    this.parts.body = c.body;
    this.parts.legs = c.legs;
    this.afterChange();
  }

  private randomize(): void {
    // Never roll into the locked ALIEN range until it is unlocked.
    const r = () => {
      let v: number;
      do {
        v = Math.floor(Math.random() * COSTUME_MAX) + 1;
      } while (!SD.alienUnlocked && persForIndex(v) === "alien");
      return v;
    };
    this.preset = r();
    this.parts.head = r();
    this.parts.body = r();
    this.parts.legs = r();
    if (animStateFor(this.action) === "idle") this.action = idleAnimForPreset(this.preset);
    this.rebuildPreview();
    this.afterChange();
  }

  private afterChange(): void {
    this.refreshAll();
    Sound.play("R2_Click");
  }

  // --- repaint -----------------------------------------------------------

  private refreshAll(): void {
    for (const s of this.selectors) s.refresh();

    const pers = persForCostume(this.parts.head, this.parts.body, this.parts.legs);
    for (const pill of this.classPills) {
      const locked = pill.pers === "alien" && !SD.alienUnlocked;
      const active = pill.pers === pers;
      const col = PERS_COLOR[pill.pers] ?? ACCENT;
      const geo = (pill.g as any)._geo as { px: number; y: number; pw: number };
      pill.g.clear();
      pill.g.rect(geo.px, geo.y, geo.pw, 30)
        .fill({ color: active ? col : 0x000000, alpha: locked ? 0.35 : active ? 0.9 : 0.55 })
        .stroke({ color: active ? col : C_PANEL_HAIRLINE, width: active ? 2 : 1, alpha: active ? 1 : 0.9 });
      pill.label.text = locked ? `${PERS_LABEL[pill.pers]} (LOCKED)` : PERS_LABEL[pill.pers];
      pill.label.style.fill = locked ? C_LOCKED : active ? 0x000000 : DIM;
      pill.label.alpha = locked ? A_LABEL * 0.6 : A_LABEL;
    }

    this.paintPedestalGlow(PERS_COLOR[pers] ?? ACCENT);
  }

  // --- preview -----------------------------------------------------------

  /** Part-rig render state for a customize action (species idles map directly). */
  private renderStateForAction(): string {
    return PartArt.hasState(this.action) ? this.action : animStateFor(this.action);
  }

  private previewCostume(): { head: number; body: number; legs: number } {
    return { head: this.parts.head, body: this.parts.body, legs: this.parts.legs };
  }

  private rebuildPreview(): void {
    this.previewLayer.removeChildren();
    this.previewSprite = null;
    this.previewFigure = null;
    this.animFrame = 1;
    this.animTick = 0;

    // Preferred: the layered per-costume figure so head/body/legs all show.
    if (PartFigure.ready) {
      const fig = new PartFigure();
      this.previewScale = 340 / 128;
      const rs = this.renderStateForAction();
      fig.update(this.previewCostume(), rs, 0, this.previewScale);
      this.previewLayer.addChild(fig.view);
      this.previewFigure = fig;
      return;
    }

    const state = animStateFor(this.action);
    const tex = Anim.getFrame(state, 1);
    if (tex) {
      // Fill most of the stage height (bigger, hero-sized character).
      this.previewScale = 340 / tex.height;
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      s.scale.set(this.previewScale);
      this.previewLayer.addChild(s);
      this.previewSprite = s;
    } else {
      const g = new Graphics();
      const h = 320;
      const w = 70;
      g.roundRect(-w / 2, -h + 60, w, h - 60, 10).fill({ color: 0x2a4a66, alpha: 0.9 });
      g.circle(0, -h + 36, 30).fill({ color: 0xe0c0a0 });
      this.previewLayer.addChild(g);
    }
  }

  private saveAndBack(): void {
    const name = this.nameInput.value.trim();
    if (name.length > 0) SD.profile.name = name.slice(0, 16);
    SD.profile.prof_preset = this.preset;
    SD.profile.prof_head = this.parts.head;
    SD.profile.prof_body = this.parts.body;
    SD.profile.prof_legs = this.parts.legs;
    SD.profile.prof_action = this.action;
    SD.profile.pers = persForCostume(this.parts.head, this.parts.body, this.parts.legs);
    SD.save();
    Sound.play("R2_ClickGo");
    this.engine.setScreen(MenuScreen);
  }

  private back(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(MenuScreen);
  }

  enterFrame(dt: number): void {
    this.nameInput.update();

    // Gentle pedestal-ring shimmer via a slow turntable value (kept subtle so
    // the figure itself stays readable rather than spinning).
    this.turntable += dt * 0.02;

    // Layered figure path (preferred).
    if (this.previewFigure) {
      const rs = this.renderStateForAction();
      this.animTick += dt;
      if (this.animTick >= 2) {
        this.animTick = 0;
        const count = PartArt.frameCount(rs) || 1;
        this.animFrame = (this.animFrame % count) + 1;
      }
      this.previewFigure.update(this.previewCostume(), rs, this.animFrame - 1, this.previewScale);
      return;
    }
    // Part art finished loading after the screen opened — upgrade to the figure.
    if (PartFigure.ready) {
      this.rebuildPreview();
      return;
    }

    if (!this.previewSprite && Anim.getFrame(animStateFor(this.action), 1)) {
      this.rebuildPreview();
    }
    const s = this.previewSprite;
    if (!s) return;
    const state = animStateFor(this.action);
    this.animTick += dt;
    if (this.animTick >= 2) {
      this.animTick = 0;
      const count = Anim.frameCount(state);
      this.animFrame = (this.animFrame % count) + 1;
      const tex = Anim.getFrame(state, this.animFrame);
      if (tex) s.texture = tex;
    }
  }

  destructor(): void {
    this.nameInput?.destroy();
    super.destructor();
  }
}
