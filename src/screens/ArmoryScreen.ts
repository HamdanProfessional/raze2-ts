import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { ArmArt } from "../assets/ArmArt";
import { SkinArt } from "../assets/SkinArt";
import { RAZE2_WEAPON_BY_ID, RAZE2_SKINS } from "../assets/raze2";
import { equippedGuns, ensureLoadout, LOADOUT_MAX } from "../game/Armory";
import { equippedInSlot, equipById } from "../game/Equipment";
import { getAbility } from "../game/Abilities";
import { makeBackground, makeScrim } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { CustomizeScreen } from "./CustomizeScreen";
import { ArmoryBrowseScreen, type ArmoryMode } from "./ArmoryBrowseScreen";
import {
  Raze2Button,
  drawRaze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_LABEL,
  C_DIM,
  C_OPTIONS_GREEN,
  C_ACCENT_YELLOW,
  makeAbilityIcon,
  abilityTypeColor,
  C_ACCENT_BAR,
  C_PANEL_HAIRLINE,
  A_HEADER,
  A_LABEL,
} from "../ui/raze2";

/**
 * The Armory — rebuilt as the authentic Raze 2 loadout *overview*
 * (`docs/raze2/13-ui-menus.md` §4) rather than a shop grid.
 *
 * The source frame reads as three columns: the player's name and character
 * preview with a sub-nav beneath them on the left (`txt_name`, `mc_preview`,
 * `btn_Weapons`/`Equipment`/`Abilities`/`Profile`), the equipped ability and
 * three equipment slots in the middle (`mc_ability`, `txt_equip0..2`), and the
 * seven weapon-slot rows on the right (`txt_weap0..6`), with the credit
 * read-out top-right. This screen answers "what am I taking into the match",
 * and every block is a hit area that opens the matching browse view — which is
 * where credits are actually spent (see {@link ArmoryBrowseScreen}).
 *
 * All economy/unlock/equip logic is untouched; this is presentation plus
 * navigation only.
 */

/** Stage side margin — the title, columns and Back button all sit on it. */
const MARGIN = 40;
/** Gutter between the three columns. */
const GUTTER = 16;
/** Top of the column band, below the title row. */
const BODY_TOP = 78;

/** On-screen height of the character preview, in stage px. */
const PREVIEW_H = 200;

/** Equipment slot names (cls 0-2), authentic Raze 2 wording (doc 11 §2.2.3). */
const EQUIP_SLOTS = ["Defensive", "Utility", "Offensive"];

/** Comma-group an integer (Raze 2 `UT.addNumCommas`, mirrors game/Hud.ts). */
function addNumCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A titled dark-glass block that behaves as one big button, mirroring the
 *  source's `bt_weapons` / `bt_equipment` / `bt_ability` hit areas. */
interface Section {
  view: Container;
  /** Add row content here; already offset below the section title. */
  body: Container;
}

export class ArmoryScreen extends Screen {
  private creditsText!: Text;

  // Character preview (mc_preview) — the equipped Raze 2 skin, rendered from
  // the same baked art the live in-game unit uses.
  private previewLayer = new Container();
  private previewSprite: Sprite | null = null;
  /** {@link previewKey} at the time the current preview was built. */
  private previewBuiltKey = "";

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);
    ensureLoadout();

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.55));

    // --- header ------------------------------------------------------------
    const title = new Text({
      text: "ARMORY",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER,
        fontSize: 32, fontWeight: "700", letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0, 0.5);
    title.x = MARGIN; title.y = 34;
    this.view.addChild(title);

    this.creditsText = new Text({
      text: `${addNumCommas(SD.credits)} credits`,
      style: new TextStyle({ fill: C_OPTIONS_GREEN, fontFamily: FONT_VALUE, fontSize: 22, fontWeight: "bold" }),
    });
    this.creditsText.anchor.set(1, 0.5);
    this.creditsText.x = GAME_WIDTH - MARGIN; this.creditsText.y = 34;
    this.view.addChild(this.creditsText);

    // --- column geometry ---------------------------------------------------
    // Left holds the identity block, middle the ability + equipment slots,
    // right the seven-gun rack (the widest, since gun names are longest).
    const total = GAME_WIDTH - MARGIN * 2;
    const leftW = 280;
    const midW = 300;
    const rightW = total - leftW - midW - GUTTER * 2;
    const leftX = MARGIN;
    const midX = leftX + leftW + GUTTER;
    const rightX = midX + midW + GUTTER;

    this.buildIdentity(leftX, leftW);
    this.buildAbility(midX, midW);
    this.buildEquipment(midX, midW);
    this.buildWeapons(rightX, rightW);

    const back = this.mkButton("Back to Menu", 200, 38, () => {
      Sound.play("R2_ClickBack");
      this.engine.setScreen(MenuScreen);
    });
    back.view.x = MARGIN; back.view.y = GAME_HEIGHT - 54;
    this.view.addChild(back.view);
  }

  // --- shared factories ----------------------------------------------------

  private mkButton(label: string, width: number, height: number, onClick: () => void): Raze2Button {
    const b = new Raze2Button(label, { width, height, onClick });
    b.view.on("pointerover", () => Sound.play("R2_Click"));
    return b;
  }

  private text(str: string, x: number, y: number, size: number, color: number, opts: {
    font?: string; bold?: boolean; alpha?: number; anchorX?: number; anchorY?: number; letterSpacing?: number;
    /** Hard width budget; a longer line is stepped down in point size to fit. */
    fit?: number;
  } = {}): Text {
    const t = new Text({
      text: str,
      style: new TextStyle({
        fill: color,
        fontFamily: opts.font ?? FONT_VALUE,
        fontSize: size,
        fontWeight: opts.bold ? "bold" : "normal",
        letterSpacing: opts.letterSpacing ?? 0,
      }),
    });
    if (opts.fit != null && t.width > opts.fit) {
      t.style.fontSize = Math.max(8, Math.floor(size * (opts.fit / t.width)));
    }
    if (opts.alpha != null) t.alpha = opts.alpha;
    t.anchor.set(opts.anchorX ?? 0, opts.anchorY ?? 0);
    t.x = x; t.y = y;
    return t;
  }

  /**
   * A titled panel that is itself the hit area for `onClick`. The accent rule
   * and border brighten on hover so the whole block reads as pressable without
   * needing a separate "change" button in every section.
   */
  private section(
    x: number, y: number, w: number, h: number,
    title: string, hint: string, onClick: () => void,
  ): Section {
    const view = new Container();
    view.x = x; view.y = y;

    const g = new Graphics();
    const paint = (hover: boolean) => {
      g.clear();
      drawRaze2Panel(g, 0, 0, w, h, {
        radius: 6,
        accent: hover ? C_OPTIONS_GREEN : C_ACCENT_BAR,
        corners: false,
      });
      g.roundRect(0, 0, w, h, 6).stroke({
        color: hover ? C_OPTIONS_GREEN : C_PANEL_HAIRLINE,
        width: hover ? 2 : 1,
        alpha: hover ? 0.9 : 0.7,
      });
    };
    paint(false);
    view.addChild(g);

    view.addChild(this.text(title, 14, 12, 12, C_HEADER, {
      font: FONT_HEADER, bold: true, alpha: A_HEADER, letterSpacing: 2,
    }));
    const hintText = this.text(hint, w - 14, 13, 10, C_OPTIONS_GREEN, {
      alpha: 0, anchorX: 1,
    });
    view.addChild(hintText);

    const body = new Container();
    body.y = 38;
    view.addChild(body);

    view.eventMode = "static";
    view.cursor = "pointer";
    view.on("pointerover", () => { paint(true); hintText.alpha = A_LABEL; Sound.play("R2_Click"); });
    view.on("pointerout", () => { paint(false); hintText.alpha = 0; });
    view.on("pointertap", () => { Sound.play("R2_ClickGo"); onClick(); });

    this.view.addChild(view);
    return { view, body };
  }

  private browse(mode: ArmoryMode): void {
    this.engine.setScreen(ArmoryBrowseScreen, mode);
  }

  /** One "label ....... value" slot row, with an optional leading index chip. */
  private slotRow(
    parent: Container, y: number, w: number,
    index: string | null, label: string, value: string, filled: boolean, accent: number,
  ): void {
    const left = 14;
    let tx = left;
    if (index != null) {
      const chip = new Graphics();
      chip.roundRect(left, y, 20, 18, 3)
        .fill({ color: filled ? accent : C_DIM, alpha: filled ? 0.22 : 0.1 })
        .stroke({ color: filled ? accent : C_DIM, width: 1, alpha: filled ? 0.7 : 0.25 });
      parent.addChild(chip);
      parent.addChild(this.text(index, left + 10, y + 3, 11, filled ? accent : C_DIM, {
        bold: true, anchorX: 0.5, alpha: filled ? 0.95 : 0.5,
      }));
      tx = left + 30;
    }
    if (label) {
      parent.addChild(this.text(label, tx, y + 4, 10, C_LABEL, { alpha: 0.45, letterSpacing: 1 }));
      tx += 74;
    }
    parent.addChild(this.text(
      value, tx, y + 2, 14,
      filled ? C_HEADER : C_DIM,
      { bold: filled, alpha: filled ? 0.95 : 0.5, fit: w - tx - 20 },
    ));
  }

  // --- left column: name + preview + sub-nav -------------------------------

  private buildIdentity(x: number, w: number): void {
    const panelH = 292;
    const panel = new Graphics();
    drawRaze2Panel(panel, x, BODY_TOP, w, panelH, { radius: 6, accent: C_ACCENT_BAR, corners: false });
    this.view.addChild(panel);

    this.view.addChild(this.text(SD.profile.name || "Recruit", x + w / 2, BODY_TOP + 14, 20, C_HEADER, {
      font: FONT_HEADER, bold: true, anchorX: 0.5, alpha: A_HEADER, fit: w - 28,
    }));
    const skin = RAZE2_SKINS.find((s) => s.id === SD.profile.prof_skin);
    this.view.addChild(this.text(skin?.name ?? "Recruit", x + w / 2, BODY_TOP + 40, 11, C_OPTIONS_GREEN, {
      anchorX: 0.5, alpha: A_LABEL, letterSpacing: 1, fit: w - 28,
    }));

    // Preview origin = the figure's feet, standing on the panel floor.
    this.previewLayer.x = x + w / 2;
    this.previewLayer.y = BODY_TOP + panelH - 18;
    this.view.addChild(this.previewLayer);
    this.rebuildPreview();

    // Sub-nav — the source's smaller-scale button column beneath the preview.
    const navY = BODY_TOP + panelH + 12;
    const navH = 30, navGap = 6;
    const nav: [string, () => void][] = [
      ["Weapons", () => this.browse("weapons")],
      ["Equipment", () => this.browse("equipment")],
      ["Abilities", () => this.browse("abilities")],
      ["Skins", () => this.browse("skins")],
      ["Profile", () => this.engine.setScreen(CustomizeScreen)],
    ];
    nav.forEach(([label, action], i) => {
      const btn = this.mkButton(label, w, navH, () => { Sound.play("R2_ClickGo"); action(); });
      btn.view.x = x; btn.view.y = navY + i * (navH + navGap);
      this.view.addChild(btn.view);
    });
  }

  // --- middle column: ability + equipment ----------------------------------

  private buildAbility(x: number, w: number): void {
    const h = 104;
    const a = getAbility(SD.profile.prof_ability);
    const has = a.id !== "none";
    const s = this.section(x, BODY_TOP, w, h, "ABILITY", "Change ›", () => this.browse("abilities"));

    // Same drawn glyph the browse view uses, so the equipped ability looks the
    // same in both places.
    const accent = has ? abilityTypeColor(a.type) : C_DIM;
    if (has) {
      const icon = makeAbilityIcon(a.id, a.type, 40);
      icon.x = 14; icon.y = 2;
      s.body.addChild(icon);
    } else {
      const badge = new Graphics();
      badge.roundRect(14, 2, 40, 40, 6)
        .fill({ color: C_DIM, alpha: 0.08 })
        .stroke({ color: C_DIM, width: 1, alpha: 0.25 });
      s.body.addChild(badge);
      s.body.addChild(this.text("–", 34, 12, 20, C_DIM, {
        font: FONT_HEADER, bold: true, anchorX: 0.5, alpha: 0.5,
      }));
    }

    s.body.addChild(this.text(has ? a.name : "— none —", 66, 4, 16, has ? C_HEADER : C_DIM, {
      font: FONT_HEADER, bold: true, alpha: has ? 0.95 : 0.5, fit: w - 86,
    }));
    if (has) {
      s.body.addChild(this.text(`${a.type}  ·  Recharge ${a.rechargeSec}s`, 66, 26, 10, accent, {
        alpha: A_LABEL, fit: w - 86,
      }));
      s.body.addChild(this.text(a.shortDesc, 66, 42, 10, C_LABEL, {
        font: FONT_BODY, alpha: 0.55, fit: w - 86,
      }));
    }
  }

  private buildEquipment(x: number, w: number): void {
    const y = BODY_TOP + 104 + GUTTER;
    const h = 150;
    const s = this.section(x, y, w, h, "EQUIPMENT", "Change ›", () => this.browse("equipment"));
    EQUIP_SLOTS.forEach((slot, i) => {
      const id = equippedInSlot(i);
      const item = id ? equipById(id) : undefined;
      this.slotRow(
        s.body, i * 32, w,
        null, slot.toUpperCase(),
        item?.name ?? "— none —", !!item, C_OPTIONS_GREEN,
      );
    });
  }

  // --- right column: the seven-gun rack ------------------------------------

  private buildWeapons(x: number, w: number): void {
    const guns = equippedGuns();
    const h = 42 + LOADOUT_MAX * 34 + 12;
    const s = this.section(x, BODY_TOP, w, h, "WEAPONS", "Change ›", () => this.browse("weapons"));

    s.view.addChild(this.text(
      `${guns.length} / ${LOADOUT_MAX} CARRIED`,
      w - 76, 13, 10,
      guns.length >= LOADOUT_MAX ? C_ACCENT_YELLOW : C_LABEL,
      { anchorX: 1, alpha: A_LABEL, letterSpacing: 1 },
    ));

    for (let i = 0; i < LOADOUT_MAX; i++) {
      const id = guns[i];
      const def = id ? RAZE2_WEAPON_BY_ID[id] : undefined;
      const y = i * 34;
      // The number row is 1-9 then 0, matching the in-match hotkeys.
      this.slotRow(
        s.body, y, w,
        String((i + 1) % 10), "",
        def?.name ?? (id ?? "— empty —"), !!id, C_OPTIONS_GREEN,
      );
      if (id) {
        const icon = ArmArt.getIcon(id);
        if (icon) {
          const sp = new Sprite(icon);
          sp.scale.set(Math.min(46 / (icon.width || 46), 24 / (icon.height || 24), 2));
          sp.anchor.set(1, 0.5);
          sp.x = w - 16; sp.y = y + 11;
          s.body.addChild(sp);
        }
      }
    }
  }

  // --- character preview ---------------------------------------------------

  /**
   * The equipped Raze 2 skin id. This is what the Armory previews — the same
   * `prof_skin` the live in-game unit renders (see GameScreen.makeSelfPlayer).
   * The customize part-rig (`PartFigure`/`PartArt`) is deliberately NOT used
   * here: LoaderScreen never loads `PartArt`, so it is both unavailable and
   * costume- rather than skin-driven, which is the wrong identity to show.
   */
  private previewSkin(): string {
    return SD.profile.prof_skin || "raze";
  }

  /**
   * What the current preview is built from: the skin plus whether its art has
   * arrived. `enterFrame` rebuilds only when this changes, so a skin with no
   * baked art settles on the placeholder instead of rebuilding every frame.
   */
  private previewKey(): string {
    const id = this.previewSkin();
    return `${id}:${SkinArt.getTexture(id) ? "art" : "none"}`;
  }

  private rebuildPreview(): void {
    this.previewLayer.removeChildren();
    this.previewSprite = null;
    this.previewBuiltKey = this.previewKey();

    // The complete baked idle figure — body, head, BOTH arms and legs (see
    // SkinArt's header). The animated bake (`SkinAnim`) is deliberately not
    // used here: it omits the aiming front arm, which the live in-game rig
    // overlays and a static menu preview has no way to supply.
    const tex = SkinArt.getTexture(this.previewSkin());
    if (tex) {
      const a = SkinArt.anchor();
      const s = new Sprite(tex);
      s.anchor.set(a.x, a.y);
      // The figure only occupies crown-to-feet inside the canvas (~90 of 96
      // native px), so size off the feet mark rather than the canvas height —
      // otherwise every character renders noticeably short.
      s.scale.set(PREVIEW_H / (SkinArt.manifest.feet[1] || SkinArt.canvas[1]));
      this.previewLayer.addChild(s);
      this.previewSprite = s;
      return;
    }

    // Art not loaded yet — hold the space so the panel does not visibly
    // reflow when it arrives.
    const g = new Graphics();
    g.roundRect(-34, -190, 68, 150, 10).fill({ color: 0x2a4a66, alpha: 0.5 });
    g.circle(0, -206, 26).fill({ color: 0xe0c0a0, alpha: 0.5 });
    this.previewLayer.addChild(g);
  }

  enterFrame(): void {
    // Art streamed in (or the equipped skin changed) — rebuild once, then stop.
    if (this.previewKey() !== this.previewBuiltKey) this.rebuildPreview();
  }
}
