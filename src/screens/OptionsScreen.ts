import { Container, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { QUALITY_LEVELS, type QualityLevel } from "../state/Quality";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground } from "./ui";
import { MenuScreen } from "./MenuScreen";
import {
  Raze2Button,
  Raze2Panel,
  Raze2Toggle,
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_LABEL,
  A_HEADER,
  A_LABEL,
  C_OPTIONS_GREEN,
} from "../ui/raze2";

/**
 * Options screen, restyled to Raze 2 (spec doc 13 §2.6-2.7, screenshot #8).
 * Three groups, left to right:
 *   - Graphic Presets  — Ultra / High / Medium / Low / Custom, each with its
 *     one-line blurb; clicking one bulk-sets the 5 detail knobs (§2.3) and
 *     lights up that button. Custom lights up automatically whenever a detail
 *     knob is hand-edited (auto-demote, §2.3/2.4), matching `graphType = 0`.
 *   - Graphic Details  — Quality, Particles, Glows, Lights & Reflections,
 *     Ragdoll evaporating toggles, active option in `C_OPTIONS_GREEN`
 *     (`0x57DEB0`).
 *   - Other Options    — Sounds, Music, Bloody Screen, Pause Blur toggles
 *     (outside the preset system, per §2.4).
 *
 * Every toggle binds to the real persisted model: Quality/Glows/Particles/
 * Ragdoll evaporating to `SD.qual`/`SD.noGlow`/`SD.graphPart`/`SD.graphRagev`,
 * Sounds/Music to `SD.sound`/`SD.music`, and Bloody Screen/Pause Blur to
 * `SD.graphBlood`/`SD.pauseBlur`. All persist through `SD.save()`.
 */

/** Preset name -> blurb, exact copy from spec doc 13 §2.6 (text ids 515/517/519/521/523). */
const PRESET_BLURBS: Record<string, string> = {
  Ultra: "The highest settings. For only the most powerful computers!",
  High: "For most computers (recommended).",
  Medium: "Slightly less than High settings. Good if you experience some lag.",
  Low: "Turns off all graphics and effects. Good for low end computers.",
  Custom: "Your own custom settings.",
};

/** Preset -> detail bulk-apply table, exact mapping from spec doc 13 §2.3
 *  (`changeGraphType`, source `graphQual`/`graphPart`/`graphGlow`/`graphRagev`/
 *  `graphLights` columns). `qual` uses the port's 4-step `QualityLevel` scale
 *  (low/medium/high/max) in place of the source's 3-step `stage.quality`. */
const PRESETS: {
  label: string;
  qual: QualityLevel;
  particles: number;
  glow: boolean;
  ragev: boolean;
  lights: boolean;
}[] = [
  { label: "Ultra", qual: "max", particles: 3, glow: true, ragev: true, lights: true },
  { label: "High", qual: "high", particles: 2, glow: true, ragev: true, lights: true },
  { label: "Medium", qual: "medium", particles: 1, glow: false, ragev: false, lights: false },
  { label: "Low", qual: "low", particles: 0, glow: false, ragev: false, lights: false },
];

/**
 * Three even columns splitting the stage edge to edge (24px margins), with a
 * shared top and bottom — the source's hand-placed 300/300/280-wide panels at
 * x=60/430/790 left side gutters when the window grew.
 */
const COL_GAP = 28;
/** Read at build time, not import time — the stage size is the window's. */
const colW = () => Math.floor((GAME_WIDTH - 48 - COL_GAP * 2) / 3);
const colX = () => [24, 24 + colW() + COL_GAP, 24 + (colW() + COL_GAP) * 2];
const PANEL_Y = 110;
const PANEL_H = 420;

export class OptionsScreen extends Screen {
  private qualityToggle!: Raze2Toggle;
  private particlesToggle!: Raze2Toggle;
  private glowToggle!: Raze2Toggle;
  private lightsToggle!: Raze2Toggle;
  private ragevToggle!: Raze2Toggle;

  // Preset buttons, in `PRESETS` order, plus the trailing Custom button.
  private presetButtons: Raze2Button[] = [];
  private customButton!: Raze2Button;

  // Detail toggles without a persisted backing field yet (visual parity only,
  // see class doc comment above).
  private lights = 1;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));

    this.header("OPTIONS", GAME_WIDTH / 2, 40);

    this.buildPresets(colX()[0], PANEL_Y);
    this.buildGraphicDetails(colX()[1], PANEL_Y);
    this.buildOtherOptions(colX()[2], PANEL_Y);

    const back = new Raze2Button("Back to Menu", {
      width: 220,
      height: 40,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    back.view.x = colX()[0];
    back.view.y = GAME_HEIGHT - 64;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);
  }

  // --- helpers -----------------------------------------------------------

  private header(text: string, x: number, y: number): void {
    const t = new Text({
      text,
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 30,
        fontWeight: "700",
        letterSpacing: 3,
      }),
    });
    t.alpha = A_HEADER;
    t.anchor.set(0.5, 0);
    t.x = x;
    t.y = y;
    this.view.addChild(t);
  }

  private groupTitle(text: string, x: number, y: number): void {
    const t = new Text({
      text,
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 18,
        fontWeight: "700",
        letterSpacing: 2,
      }),
    });
    t.alpha = A_HEADER;
    t.x = x;
    t.y = y;
    this.view.addChild(t);
  }

  private rowLabel(text: string, x: number, y: number): void {
    const t = new Text({
      text,
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    t.alpha = A_LABEL;
    t.x = x;
    t.y = y;
    this.view.addChild(t);
  }

  /** A labelled toggle row: label on the left, kit toggle below it. */
  private toggleRow(
    parent: Container,
    label: string,
    x: number,
    y: number,
    words: string[],
    selected: number,
    onChange: (i: number) => void,
  ): Raze2Toggle {
    this.rowLabel(label, x, y);
    const toggle = new Raze2Toggle(words, selected, (i) => {
      Sound.play("R2_Click");
      onChange(i);
    });
    toggle.view.x = x;
    toggle.view.y = y + 20;
    parent.addChild(toggle.view);
    return toggle;
  }

  // --- graphic presets ---------------------------------------------------

  private buildPresets(x: number, y: number): void {
    const panel = new Raze2Panel(colW(), PANEL_H, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    this.groupTitle("GRAPHIC PRESETS", x + 20, y + 16);

    const rowW = colW() - 40;
    const blurbStyle = () =>
      new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_VALUE,
        fontSize: 10,
        wordWrap: true,
        wordWrapWidth: rowW,
      });

    let by = y + 52;
    const step = 70;
    for (let i = 0; i < PRESETS.length; i++) {
      const preset = PRESETS[i];
      const btn = new Raze2Button(preset.label, {
        width: rowW,
        height: 28,
        onClick: () => this.applyPreset(i),
      });
      btn.view.x = x + 20;
      btn.view.y = by;
      btn.view.on("pointerover", () => Sound.play("R2_Click"));
      this.view.addChild(btn.view);
      this.presetButtons.push(btn);

      const blurb = new Text({ text: PRESET_BLURBS[preset.label], style: blurbStyle() });
      blurb.alpha = A_LABEL;
      blurb.x = x + 20;
      blurb.y = by + 30;
      this.view.addChild(blurb);

      by += step;
    }

    // "Custom" — no bulk-apply of its own; lights up automatically whenever a
    // detail knob is hand-edited (auto-demote, spec doc 13 §2.3).
    this.customButton = new Raze2Button("Custom", {
      width: rowW,
      height: 28,
      onClick: () => Sound.play("R2_Click"),
    });
    this.customButton.view.x = x + 20;
    this.customButton.view.y = by;
    this.customButton.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(this.customButton.view);

    const customBlurb = new Text({ text: PRESET_BLURBS.Custom, style: blurbStyle() });
    customBlurb.alpha = A_LABEL;
    customBlurb.x = x + 20;
    customBlurb.y = by + 30;
    this.view.addChild(customBlurb);

    this.highlightActivePreset(this.computeMatchingPresetIndex());
  }

  /** Which preset (if any) exactly matches the current detail-knob values;
   *  `-1` means Custom (source: `graphType` demotes to 0 unless every knob
   *  matches a preset's tuple, §2.3). */
  private computeMatchingPresetIndex(): number {
    for (let i = 0; i < PRESETS.length; i++) {
      const p = PRESETS[i];
      if (
        p.qual === SD.qual &&
        p.glow === !SD.noGlow &&
        p.particles === SD.graphPart &&
        (p.lights ? 1 : 0) === this.lights &&
        p.ragev === SD.graphRagev
      ) {
        return i;
      }
    }
    return -1;
  }

  /** Bulk-apply preset `i` (index into `PRESETS`): writes every detail knob
   *  the source's `changeGraphType` writes (§2.3), then repaints the detail
   *  toggles and the preset highlight. */
  private applyPreset(i: number): void {
    const preset = PRESETS[i];
    Sound.play("R2_ClickGo");
    SD.setQuality(preset.qual);
    SD.setNoGlow(!preset.glow);
    SD.setRagev(preset.ragev);
    SD.setGraphPart(preset.particles);
    this.lights = preset.lights ? 1 : 0;

    // Reflect the bulk change in the detail toggles (setSelected doesn't
    // re-fire onChange, so this won't recursively demote back to Custom).
    this.qualityToggle.setSelected(QUALITY_LEVELS.indexOf(preset.qual));
    this.glowToggle.setSelected(preset.glow ? 1 : 0);
    this.particlesToggle.setSelected(preset.particles);
    this.lightsToggle.setSelected(this.lights);
    this.ragevToggle.setSelected(preset.ragev ? 1 : 0);

    this.highlightActivePreset(i);
  }

  /** Light up preset button `i` (boxed/lit, `Raze2Button.setSelected`) and
   *  dim the rest; `i === undefined` (or no exact match) lights Custom, per
   *  the source's auto-demote-to-Custom behavior on manual detail edits. */
  private highlightActivePreset(i?: number): void {
    const active = i ?? -1;
    this.presetButtons.forEach((btn, idx) => btn.setSelected(idx === active));
    this.customButton.setSelected(active === -1);
  }

  /** Any individual detail-knob edit demotes the active preset to Custom
   *  (source: every one of `Menu.as` cases 0-12 also writes `graphType = 0`). */
  private demoteToCustom(): void {
    this.highlightActivePreset(-1);
  }

  // --- graphic details ---------------------------------------------------

  private buildGraphicDetails(x: number, y: number): void {
    const panel = new Raze2Panel(colW(), PANEL_H, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    this.groupTitle("GRAPHIC DETAILS", x + 20, y + 16);

    const lx = x + 20;
    let ly = y + 58;
    const step = 66;

    this.qualityToggle = this.toggleRow(
      this.view, "Quality", lx, ly, ["Low", "Medium", "High", "Ultra"],
      Math.max(0, QUALITY_LEVELS.indexOf(SD.qual)),
      (i) => {
        SD.setQuality(QUALITY_LEVELS[i]);
        this.demoteToCustom();
      },
    );
    ly += step;

    this.particlesToggle = this.toggleRow(
      this.view, "Particles", lx, ly, ["Low", "Medium", "High", "Ultra"],
      SD.graphPart,
      (i) => {
        SD.setGraphPart(i);
        this.demoteToCustom();
      },
    );
    ly += step;

    this.glowToggle = this.toggleRow(
      this.view, "Glows", lx, ly, ["Off", "On"], SD.noGlow ? 0 : 1,
      (i) => {
        SD.setNoGlow(i === 0);
        this.demoteToCustom();
      },
    );
    ly += step;

    this.lightsToggle = this.toggleRow(
      this.view, "Lights & Reflections", lx, ly, ["Off", "On"], this.lights,
      (i) => {
        this.lights = i;
        this.demoteToCustom();
      },
    );
    ly += step;

    this.ragevToggle = this.toggleRow(
      this.view, "Ragdoll evaporating", lx, ly, ["Off", "On"],
      SD.graphRagev ? 1 : 0,
      (i) => {
        SD.setRagev(i === 1);
        this.demoteToCustom();
      },
    );
  }

  // --- other options -----------------------------------------------------

  private buildOtherOptions(x: number, y: number): void {
    const panel = new Raze2Panel(colW(), PANEL_H, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    this.groupTitle("OTHER OPTIONS", x + 20, y + 16);

    const lx = x + 20;
    let ly = y + 58;
    const step = 66;

    this.toggleRow(this.view, "Sounds", lx, ly, ["Off", "On"], SD.sound ? 1 : 0, (i) => {
      SD.sound = i === 1;
      SD.save();
    });
    ly += step;

    this.toggleRow(this.view, "Music", lx, ly, ["Off", "On"], SD.music ? 1 : 0, (i) => {
      SD.music = i === 1;
      SD.save();
      if (SD.music) Sound.setMusic("R2_Menu");
      else Sound.stopMusic();
    });
    ly += step;

    this.toggleRow(this.view, "Bloody Screen", lx, ly, ["Off", "On"],
      SD.graphBlood ? 1 : 0, (i) => SD.setGraphBlood(i === 1));
    ly += step;

    this.toggleRow(this.view, "Pause Blur", lx, ly, ["Off", "On"],
      SD.pauseBlur ? 1 : 0, (i) => SD.setPauseBlur(i === 1));
  }

  enterFrame(): void {
    // Static settings screen.
  }
}
