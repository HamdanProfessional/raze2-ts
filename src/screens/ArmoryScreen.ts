import { Container, Graphics, Sprite, Text, TextStyle, Texture } from "pixi.js";
import { Screen } from "../core/Screen";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { ArmArt } from "../assets/ArmArt";
import { ArmAnim } from "../assets/ArmAnim";
import { SkinArt } from "../assets/SkinArt";
import { SkinAnim } from "../assets/SkinAnim";
import { RAZE2_WEAPON_BY_ID, RAZE2_SKINS } from "../assets/raze2";
import { equippedGuns, ensureLoadout, LOADOUT_MAX } from "../game/Armory";
import { equippedInSlot, equipById } from "../game/Equipment";
import { getAbility } from "../game/Abilities";
import { makeBackground, makeScrim, addScreenChrome, TITLE_SIZE, TITLE_Y } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { CustomizeScreen } from "./CustomizeScreen";
import { ArmoryBrowseScreen, type ArmoryMode } from "./ArmoryBrowseScreen";
import { ArmoryShopScreen, type ShopMode } from "./ArmoryShopScreen";
import {
  Raze2Button,
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_OPTIONS_GREEN,
  C_DIM,
  A_HEADER,
  A_LABEL,
  makeAbilityIcon,
} from "../ui/raze2";

/**
 * The Armory overview, rebuilt on the original SWF art (`Timeline_60` frame
 * 44) and edge-anchored to the dynamic stage: the identity/preview column
 * pins left, the weapon list pins right, and the ability/equipment column sits
 * just after the left column (the source's 5px gutter). Only the live values,
 * the character preview and the hit areas are created here; the panels, labels
 * and category captions are baked into the three region crops.
 */

/**
 * On-screen height of the character preview, in SWF px — the distance from the
 * figure's feet (the layer's origin) to the top of its head.
 *
 * Measured, not guessed: rendering frame 44 with and without character 898
 * (`mc_preview`) and diffing puts the authored figure's ink at x 98..214,
 * y 160..316. 156 tall, and 214 here lands the port's rig on that after the
 * `feetPx` normalisation below.
 */
const PREVIEW_H = 214;

const EQUIP_SLOTS = ["Defensive", "Utility", "Offensive"];

/** Comma-group an integer (Raze 2 `UT.addNumCommas`). */
function addNumCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export class ArmoryScreen extends Screen {
  private creditsText!: Text;

  private previewLayer = new Container();
  private previewSprite: Sprite | null = null;
  private previewBuiltKey = "";

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);
    ensureLoadout();

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.45));
    const L = addScreenChrome(this.view, {
      headerL: "armory_header_l", headerR: "armory_header_r",
      left: "armory_left", mid: "armory_mid",
      rightStretch: {
        l: "armory_right_l", m: "armory_right_m", r: "armory_right_r", from: "mid",
      },
      // Same reason Quick Match caps: the Equipped Weapons column stretches, and
      // its slot labels ("Starter", "Side Arm", …) are right-aligned to the
      // column's far end. Let the stage run to a 1320px window and the band
      // becomes a 700px void with the labels stranded against the window edge,
      // half a screen from the gun names they label.
      maxW: 800,
    });

    this.buildTitle(L);
    this.buildIdentity(L);
    this.buildAbility(L);
    this.buildEquipment(L);
    this.buildWeapons(L);
    this.buildNav(L);
  }

  private text(str: string, x: number, y: number, size: number, color: number, opts: {
    font?: string; bold?: boolean; alpha?: number; anchorX?: number; anchorY?: number; letterSpacing?: number;
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

  /** Transparent click target over baked chrome. */
  private zone(parent: Container, x: number, y: number, w: number, h: number, onClick: () => void): void {
    const g = new Graphics();
    g.rect(x, y, w, h).fill({ color: 0x000000, alpha: 0.001 });
    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointerover", () => Sound.play("R2_Click"));
    g.on("pointertap", () => { Sound.play("R2_ClickGo"); onClick(); });
    parent.addChild(g);
  }

  private browse(mode: ShopMode | "skins"): void {
    // The four original tabs (Weapons / Equipment / Abilities / Kill Bonuses)
    // are the authentic list-and-preview shop; Skins is a port-only screen and
    // keeps the tile browser.
    if (mode === "skins") this.engine.setScreen(ArmoryBrowseScreen, mode, "slideLeft");
    else this.engine.setScreen(ArmoryShopScreen, mode, "slideLeft");
  }

  // --- header + identity ---------------------------------------------------

  private buildTitle(L: ReturnType<typeof addScreenChrome>): void {
    const title = new Text({
      text: "ARMORY",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: TITLE_SIZE,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = Math.round(L.stageW / (2 * L.s));
    title.y = TITLE_Y;
    L.headerRoot.addChild(title);
  }

  private buildIdentity(L: ReturnType<typeof addScreenChrome>): void {
    const root = L.leftRoot;

    this.plateRootText(root, SD.profile.name || "Recruit", 29.9, 57.5, 14, C_HEADER, true);
    const skin = RAZE2_SKINS.find((s) => s.id === SD.profile.prof_skin);
    this.plateRootText(root, skin?.name ?? "Recruit", 29.9, 74, 11, C_OPTIONS_GREEN, false);

    // `mc_preview` — feet-resting figure in the left panel. The layer's origin
    // is the figure's feet, so this is the bottom-centre of the authored ink
    // (SWF 156, 315) in crop-local space, not the clip's own placement: the
    // `<use>` at (102.25, 159.4) is the top-left of a 217x225 bounding box with
    // a lot of slack in it. The figure used to stand 134px lower than that,
    // hanging out of the bottom of the preview box.
    this.previewLayer.x = 131;
    this.previewLayer.y = 259;
    root.addChild(this.previewLayer);
    this.rebuildPreview();

    // `bt_profile` covers the identity block; opens the skin browser.
    this.zone(root, 10, 39, 230, 300, () => this.browse("skins"));
  }

  private plateRootText(
    root: Container, str: string, x: number, y: number, size: number, color: number, head: boolean,
  ): Text {
    const t = new Text({
      text: str,
      style: new TextStyle({
        fill: color, fontFamily: head ? FONT_HEADER : FONT_VALUE, fontSize: size,
        fontWeight: head ? "700" : "normal", letterSpacing: head ? 0 : 1,
      }),
    });
    if (head) t.alpha = A_HEADER; else t.alpha = A_LABEL;
    t.x = x; t.y = y;
    root.addChild(t);
    return t;
  }

  // --- middle column: ability + equipment ----------------------------------

  private buildAbility(L: ReturnType<typeof addScreenChrome>): void {
    const root = L.midRoot;

    // `txt_credits` tops the middle column in the source frame.
    this.creditsText = this.text(
      `${addNumCommas(SD.credits)} credits`, 18.4, 3.6, 14, C_OPTIONS_GREEN, { bold: true },
    );
    this.creditsText.alpha = A_LABEL;
    root.addChild(this.creditsText);

    const a = getAbility(SD.profile.prof_ability);
    const has = a.id !== "none";
    if (has) {
      const icon = makeAbilityIcon(a.id, a.type, 42);
      icon.x = 11.5;
      icon.y = 81.1;
      root.addChild(icon);
    }
    root.addChild(this.text(
      has ? a.name : "— none —", 93.9, 97.3, 13, has ? C_HEADER : C_DIM,
      { fit: 140, alpha: has ? 0.95 : 0.5 },
    ));
    this.zone(root, 7, 57, 250, 70, () => this.browse("abilities"));
  }

  private buildEquipment(L: ReturnType<typeof addScreenChrome>): void {
    const root = L.midRoot;
    EQUIP_SLOTS.forEach((_slot, i) => {
      const id = equippedInSlot(i);
      const item = id ? equipById(id) : undefined;
      const name = item?.name ?? (id ? id : "— none —");
      root.addChild(this.text(
        name, 13.4, 157.9 + i * 17.5, 12, id ? C_HEADER : C_DIM,
        { fit: 180, alpha: id ? 0.95 : 0.5 },
      ));
    });
    this.zone(root, 7, 132, 250, 85, () => this.browse("equipment"));
  }

  private buildWeapons(L: ReturnType<typeof addScreenChrome>): void {
    const root = L.rightRoot;
    const guns = equippedGuns();
    // The baked right-aligned slot labels ("Starter", "Close Range", …) sit in
    // the stretched panel's right piece; keep the names clear of them.
    const fit = Math.max(80, L.rightW - 16.5 - 120);
    for (let i = 0; i < LOADOUT_MAX; i++) {
      const id = guns[i];
      const def = id ? RAZE2_WEAPON_BY_ID[id] : undefined;
      const label = def?.name ?? (id ?? "");
      root.addChild(this.text(
        id ? `${i + 1}  "${label}"` : "", 16.5, 83.5 + i * 17.7, 12,
        id ? C_HEADER : C_DIM,
        { fit, alpha: id ? 0.95 : 0.5 },
      ));
    }
    this.zone(root, 7, 49.8, Math.max(60, L.rightW - 14), 165, () => this.browse("weapons"));
  }

  /** Sub-nav column (scale 0.8 in the source) + Back. */
  private buildNav(L: ReturnType<typeof addScreenChrome>): void {
    const root = L.leftRoot;
    const navW = 200, navH = 22;
    const nav: [string, number, () => void][] = [
      ["Weapons", 469.1, () => this.browse("weapons")],
      ["Equipment", 489.7, () => this.browse("equipment")],
      ["Abilities", 448.7, () => this.browse("abilities")],
      ["Profile", 428.1, () => this.engine.setScreen(CustomizeScreen, undefined, "slideLeft")],
    ];
    for (const [label, cy, action] of nav) {
      // The column is the standard plate at scale 0.8, so its label is 0.8 of
      // the bar's own ~14 — at the default 18 the four rows ran into each other.
      const btn = new Raze2Button(label, { width: navW, height: navH, fontSize: 11, onClick: action });
      btn.view.x = 136.2 - navW / 2;
      btn.view.y = cy - 56 - navH / 2;
      btn.view.on("pointerover", () => Sound.play("R2_Click"));
      root.addChild(btn.view);
    }

    // 245x28 and the ~14pt label are the plate's native **SWF** units, so the
    // size reaches the screen through `view.scale` — pre-multiplying by `s`
    // would stretch the bar and leave the label at its authored size. The
    // `btn_Back_to_Menu` placement is the plate's centre (543.85), so its top
    // is 529.85 = bottomY + 13.85.
    const back = new Raze2Button("Back to Menu", {
      width: 245, height: 28, fontSize: 14,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    back.view.scale.set(L.s);
    back.view.x = L.ox + 37 * L.s;
    back.view.y = L.bottomY + 13.85 * L.s;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);
  }

  // --- character preview ---------------------------------------------------

  private previewSkin(): string {
    return SD.profile.prof_skin || "raze";
  }

  private previewKey(): string {
    const id = this.previewSkin();
    const gun = equippedGuns()[0] ?? "";
    const ready = SkinAnim.getFrame(id, "idle", 0) ? "anim" :
      (SkinArt.getTexture(id) ? "art" : "none");
    return `${id}:${gun}:${ready}`;
  }

  private buildRiggedPreview(): boolean {
    const skin = this.previewSkin();
    const body = SkinAnim.getFrame(skin, "idle", 0);
    if (!body) return false;
    const gun = equippedGuns()[0] ?? "";
    const hasArm = !!gun && !!ArmAnim.pose(gun);

    const fig = new Container();
    const a = SkinAnim.anchor();
    const bs = SkinAnim.scale * SkinAnim.texScale;

    const bodySpr = new Sprite(body);
    bodySpr.anchor.set(a.x, a.y);
    bodySpr.scale.set(bs);

    if (hasArm) {
      const sh = SkinAnim.shoulder("idle", 0);
      const as = ArmAnim.scale;
      const aa = ArmAnim.anchor();
      const mk = (tex: Texture | null): Sprite | null => {
        if (!tex) return null;
        const sp = new Sprite(tex);
        sp.anchor.set(aa.x, aa.y);
        sp.scale.set(as);
        sp.x = sh.x * SkinAnim.scale;
        sp.y = sh.y * SkinAnim.scale;
        return sp;
      };
      const idle = ArmAnim.pose(gun)?.idle ?? 0;
      const back = mk(ArmAnim.skinCell(skin, gun, "arm2", idle));
      const armBack = mk(ArmAnim.skinCell(skin, gun, "back", idle));
      const gunSpr = mk(ArmAnim.gunCell(gun, idle));
      const armFront = mk(ArmAnim.skinCell(skin, gun, "front", idle));
      if (back) fig.addChild(back);
      fig.addChild(bodySpr);
      for (const sp of [armBack, gunSpr, armFront]) if (sp) fig.addChild(sp);
    } else {
      fig.addChild(bodySpr);
    }

    const feetPx = SkinAnim.anchor().y * (body.height * SkinAnim.texScale);
    fig.scale.set(PREVIEW_H / (feetPx || PREVIEW_H));
    this.previewLayer.addChild(fig);
    this.previewSprite = bodySpr;
    return true;
  }

  private rebuildPreview(): void {
    this.previewLayer.removeChildren();
    this.previewSprite = null;
    this.previewBuiltKey = this.previewKey();

    if (this.buildRiggedPreview()) return;

    const tex = SkinArt.getTexture(this.previewSkin());
    if (tex) {
      const a = SkinArt.anchor();
      const s = new Sprite(tex);
      s.anchor.set(a.x, a.y);
      s.scale.set(PREVIEW_H / (SkinArt.manifest.feet[1] || SkinArt.canvas[1]));
      this.previewLayer.addChild(s);
      this.previewSprite = s;
      return;
    }

    const g = new Graphics();
    g.roundRect(-34, -190, 68, 150, 10).fill({ color: 0x2a4a66, alpha: 0.5 });
    g.circle(0, -206, 26).fill({ color: 0xe0c0a0, alpha: 0.5 });
    this.previewLayer.addChild(g);
  }

  enterFrame(): void {
    if (this.previewKey() !== this.previewBuiltKey) this.rebuildPreview();
  }
}
