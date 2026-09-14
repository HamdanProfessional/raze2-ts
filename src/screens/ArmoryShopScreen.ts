import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { ArmArt } from "../assets/ArmArt";
import { ArmAnim } from "../assets/ArmAnim";
import { RAZE2_WEAPONS, RAZE2_KILL_BONUSES, RAZE2_WEAPON_BY_ID } from "../assets/raze2";
import {
  isGunUnlocked, gunCost, canBuyGun, buyGun, isGunEquipped, equipGun, equippedGuns,
  ensureLoadout,
} from "../game/Armory";
import {
  equipsForSlot, equipId, isEquipOwned, equipCost, canBuyEquip, buyEquip,
  equipItem, equippedInSlot, equipById,
} from "../game/Equipment";
import {
  allAbilities, isAbilityOwned, abilityCost, canBuyAbility, buyAbility,
  equipAbility,
} from "../game/Abilities";
import { makeBackground, makeScrim, addMenuPlate, type MenuPlate } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import { CustomizeScreen } from "./CustomizeScreen";
import LAYOUT from "../assets/menuLayout.json";
import {
  Raze2Button,
  FONT_VALUE,
  C_HEADER,
  C_LABEL,
  C_DIM,
  C_LOCKED,
  C_STATUS_OWNED,
  C_OPTIONS_GREEN,
  C_ACCENT_YELLOW,
  C_WARNING,
  A_LABEL,
  makeAbilityIcon,
  abilityTypeColor,
} from "../ui/raze2";

/**
 * The authentic Armory shop screens — `Timeline_60` frames 70 (Weapons), 78
 * (Abilities), 85 (Equipment) and 92 (Kill Bonuses).
 *
 * Unlike the port's older tile browser, these are the source's own
 * list-plus-preview layouts, rebuilt on the baked 800x600 plates (`browse_*`)
 * with every interactive item placed at the coordinates `tools/ui/layout.py`
 * extracted into `menuLayout.json`. The equipped weapon column, the available-
 * item list (drawn with the source's `row_weapon_*`/`row_ability_*` row skins),
 * the stat panel and the bottom-left nav column are all in their authored
 * places.
 *
 * Skins are a port-only screen (Raze 2 has no skins shop tab) and stay on
 * {@link ArmoryBrowseScreen}; this screen owns the four tabs the original had,
 * plus "Profile" which routes to the customize screen.
 */

/** Authentic weapon-type category names (`Menu.as:2481`). */
const WEAPON_CATS = [
  "Starter", "Side Arm", "Close Range", "Automatic",
  "Long Range", "Heavy", "Explosive",
];

export type ShopMode = "weapons" | "equipment" | "abilities" | "killbonuses";

/** Comma-group an integer (Raze 2 `UT.addNumCommas`). */
function addNumCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** SWF coordinates from `menuLayout.json` (`screen.elements[name]`). */
function at(mode: ShopMode, name: string): { x: number; y: number } {
  const screens = (LAYOUT as unknown as {
    screens: Record<string, { elements: Record<string, { x: number; y: number }> }>;
  }).screens;
  return screens[`armory_${mode}`]?.elements?.[name] ?? { x: 0, y: 0 };
}

/** Stat-bar metrics for the weapons panel: 8 segments under each label. */
const STAT_SEG_W = 8;
const STAT_SEG_H = 6;
const STAT_SEG_GAP = 2;

export class ArmoryShopScreen extends Screen {
  private mode: ShopMode = "weapons";
  /** Selected weapon category (0-6). */
  private cat = 0;
  /** The weapon whose stats the panel shows; null = the equipped one. */
  private selGun: string | null = null;
  /** The ability whose details the left panel shows. */
  private selAbility = "";
  /** Kill-bonus page (0-2). */
  private page = 0;
  /** The kill bonus the blurb describes. */
  private selBonus = "";
  private plate: MenuPlate | null = null;
  private content = new Container();
  private nav = new Container();
  private credits!: Text;

  constructor(engine: ConstructorParameters<typeof Screen>[0], arg?: unknown) {
    super(engine, arg);
    ensureLoadout();
    if (arg === "weapons" || arg === "equipment" || arg === "abilities" || arg === "killbonuses") {
      this.mode = arg;
    }

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.45));
    this.buildPlate();
    this.rebuild();
  }

  /** Swap the plate for the active tab. */
  private buildPlate(): void {
    if (this.plate) {
      // Keep the content/nav containers alive across plate swaps; their
      // children are rebuilt below.
      this.content.removeFromParent();
      this.nav.removeFromParent();
      this.plate.layer.destroy({ children: true });
      this.plate = null;
    }
    const plate = addMenuPlate(this.view, `browse_${this.mode}`);
    if (!plate) return;
    this.plate = plate;

    const root = plate.root;
    const c = at(this.mode, "txt_credits");
    this.credits = this.text(`${addNumCommas(SD.credits)} credits`, c.x, c.y, 14, C_OPTIONS_GREEN, { bold: true });
    this.credits.alpha = A_LABEL;
    root.addChild(this.credits);

    this.buildNav();
    root.addChild(this.content);
  }

  // --- helpers -------------------------------------------------------------

  private text(str: string, x: number, y: number, size: number, color: number, opts: {
    font?: string; bold?: boolean; alpha?: number; wrap?: number;
    anchorX?: number; anchorY?: number; letterSpacing?: number; fit?: number;
  } = {}): Text {
    const t = new Text({
      text: str,
      style: new TextStyle({
        fill: color,
        fontFamily: opts.font ?? FONT_VALUE,
        fontSize: size,
        fontWeight: opts.bold ? "bold" : "normal",
        letterSpacing: opts.letterSpacing ?? 0,
        wordWrap: opts.wrap != null,
        wordWrapWidth: opts.wrap ?? 0,
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
    g.on("pointertap", () => {
      Sound.play("R2_ClickGo");
      onClick();
    });
    parent.addChild(g);
  }

  /** One of the baked list-row skins, stretched to the authored row box. */
  private row(parent: Container, skin: string, x: number, y: number, w: number, h: number): void {
    const spr = UiArt.r2Sprite(skin);
    if (spr) {
      spr.position.set(x, y);
      spr.width = w;
      spr.height = h;
      parent.addChild(spr);
      return;
    }
    const g = new Graphics();
    g.rect(x, y, w, h).fill({ color: 0x0d1014, alpha: 0.55 });
    g.rect(x, y, w, h).stroke({ color: C_DIM, width: 1, alpha: 0.35 });
    parent.addChild(g);
  }

  private switchTo(mode: ShopMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.selGun = null;
    Sound.play("R2_Click");
    this.buildPlate();
    this.rebuild();
  }

  /** Rebuild the active tab's dynamic half (and refresh the wallet line). */
  private rebuild(): void {
    if (this.credits) this.credits.text = `${addNumCommas(SD.credits)} credits`;
    this.content.removeChildren();
    if (this.mode === "weapons") this.buildWeapons();
    else if (this.mode === "equipment") this.buildEquipment();
    else if (this.mode === "abilities") this.buildAbilities();
    else this.buildKillBonuses();
  }

  private act(ok: boolean): void {
    if (!ok) {
      Sound.play("R2_Error");
      return;
    }
    Sound.play("R2_Equip");
    this.rebuild();
  }

  // --- nav column + back ---------------------------------------------------

  private buildNav(): void {
    const root = this.plate?.root;
    if (!root) return;
    this.nav.removeChildren();
    root.addChild(this.nav);

    const navW = 200, navH = 22;
    const rows: [string, string, () => void][] = [
      ["Armory Overview", "btn_Armory_Overview", () => this.engine.setScreen(ArmoryScreen, undefined, "slideRight")],
      ["Profile", "btn_Profile", () => this.engine.setScreen(CustomizeScreen, undefined, "slideLeft")],
      ["Abilities", "btn_Abilities", () => this.switchTo("abilities")],
      ["Weapons", "btnl_Weapons", () => this.switchTo("weapons")],
      ["Equipment", "btn_Equipment", () => this.switchTo("equipment")],
      ["Kill Bonuses", "btn_Kill_Bonuses", () => this.switchTo("killbonuses")],
    ];
    const lit = (label: string): boolean =>
      (label === "Weapons" && this.mode === "weapons") ||
      (label === "Equipment" && this.mode === "equipment") ||
      (label === "Abilities" && this.mode === "abilities") ||
      (label === "Kill Bonuses" && this.mode === "killbonuses");
    for (const [label, key, action] of rows) {
      const p = at("weapons", key);
      const btn = new Raze2Button(label, { width: navW, height: navH, fontSize: 11, onClick: action });
      btn.view.x = p.x - navW / 2;
      btn.view.y = p.y - navH / 2;
      btn.setSelected(lit(label));
      btn.view.on("pointerover", () => Sound.play("R2_Click"));
      this.nav.addChild(btn.view);
    }

    const back = at("weapons", "btn_Back_to");
    const backBtn = new Raze2Button("Back to Menu", {
      width: 245, height: 28, fontSize: 14,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    backBtn.view.x = back.x - 245 / 2;
    backBtn.view.y = back.y - 28 / 2;
    backBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    this.nav.addChild(backBtn.view);
  }

  // --- weapons (frame 70) --------------------------------------------------

  private equippedOfType(type: number): string | null {
    for (const id of equippedGuns()) {
      if (RAZE2_WEAPON_BY_ID[id]?.type === type) return id;
    }
    return null;
  }

  private buildWeapons(): void {
    const root = this.content;
    const guns = RAZE2_WEAPONS.filter((w) => w.type === this.cat);
    const catX = at("weapons", "but_weap0").x;
    const catY = at("weapons", "but_weap0").y;

    // Category rows: click to select, active row lifted.
    for (let i = 0; i < 7; i++) {
      const y = catY + i * 36;
      const hit = new Graphics();
      hit.rect(catX, y, 290, 36).fill({ color: 0xffffff, alpha: i === this.cat ? 0.14 : 0.001 });
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.on("pointerover", () => Sound.play("R2_Click"));
      hit.on("pointertap", () => {
        if (this.cat === i) return;
        this.cat = i;
        this.selGun = null;
        Sound.play("R2_ClickGo");
        this.rebuild();
      });
      root.addChild(hit);

      // The equipped gun for this category, in the row's icon recess.
      const id = this.equippedOfType(i);
      const icon = id ? ArmAnim.gunIcon(id) ?? ArmArt.getIcon(id) : null;
      if (icon) {
        const s = new Sprite(icon);
        s.anchor.set(0.5);
        s.x = catX + 236;
        s.y = y + 18;
        s.scale.set(Math.min(1.5 * ArmAnim.scale, 96 / (icon.width || 1), 26 / (icon.height || 1)));
        root.addChild(s);
      }
    }

    // The selected gun: the picked one, else the equipped one, else the first.
    const sel = this.selGun && RAZE2_WEAPON_BY_ID[this.selGun]?.type === this.cat
      ? RAZE2_WEAPON_BY_ID[this.selGun]
      : guns.find((w) => w.id === this.equippedOfType(this.cat)) ?? guns[0];

    // Available list: 8 rows on the authentic row skin.
    for (let i = 0; i < 8; i++) {
      const w = guns[i];
      if (!w) continue;
      const p = at("weapons", `but_list${i}`);
      const owned = isGunUnlocked(w.id);
      const equipped = owned && isGunEquipped(w.id);
      const cost = gunCost(w.id);
      const reward = !isFinite(cost);
      const canBuy = canBuyGun(w.id);
      const isSel = sel?.id === w.id;

      this.row(root, isSel ? "row_weapon_over" : "row_weapon_up", p.x, p.y, 312, 34);
      this.zone(root, p.x, p.y, 312, 34, () => {
        this.selGun = w.id;
        if (equipped) this.rebuild();
        else if (owned) this.act(equipGun(w.id));
        else if (canBuy) this.act(buyGun(w.id));
        else {
          Sound.play("R2_Error");
          this.rebuild();
        }
      });

      const icon = ArmAnim.gunIcon(w.id) ?? ArmArt.getIcon(w.id);
      if (icon) {
        const s = new Sprite(icon);
        s.anchor.set(0.5);
        s.x = p.x + 28;
        s.y = p.y + 17;
        s.alpha = owned ? 1 : 0.45;
        s.scale.set(Math.min(1.2 * ArmAnim.scale, 46 / (icon.width || 1), 26 / (icon.height || 1)));
        root.addChild(s);
      }
      root.addChild(this.text(w.name, p.x + 52, p.y + 4, 12, owned ? C_HEADER : C_LOCKED, {
        bold: owned, alpha: owned ? 0.95 : 0.6, fit: 150,
      }));

      const status = equipped ? "Equipped"
        : owned ? "Owned — click to equip"
        : reward ? "Reward"
        : isFinite(cost) ? `${addNumCommas(cost)} cr — click to buy`
        : "";
      const statusColor = equipped ? C_OPTIONS_GREEN : owned ? C_STATUS_OWNED
        : canBuy ? C_ACCENT_YELLOW : C_WARNING;
      root.addChild(this.text(status, p.x + 306, p.y + 4, 10, statusColor, {
        anchorX: 1, alpha: 0.95, fit: 150,
      }));
    }

    // Stat panel for the selected gun.
    if (sel) {
      const es = Number((sel.extra as Record<string, unknown> | undefined)?.extraShots) || 1;
      const dmgEff = es > 1 ? sel.dmg * (es / 2) : sel.dmg;
      const bars = [
        Math.ceil((dmgEff / 100) * 8),
        Math.ceil((sel.range / 100) * 8),
        Math.ceil(((10 - sel.recoil) / 10) * 8),
        Math.ceil((1 - sel.shootDelay) * 8),
        Math.ceil((sel.clipSize / 50) * 8),
      ];
      const spots = ["mc_curpow", "mc_currng", "mc_curacc", "mc_currof", "mc_curclip"];
      for (let i = 0; i < bars.length; i++) {
        const p = at("weapons", spots[i]);
        const v = Math.max(0, Math.min(8, bars[i]));
        for (let s = 0; s < 8; s++) {
          const g = new Graphics();
          const filled = s < v;
          g.rect(0, 0, STAT_SEG_W, STAT_SEG_H)
            .fill({ color: filled ? C_OPTIONS_GREEN : C_DIM, alpha: filled ? 0.95 : 0.2 });
          g.x = p.x + s * (STAT_SEG_W + STAT_SEG_GAP);
          g.y = p.y;
          root.addChild(g);
        }
      }
      const spec = sel.special && sel.special !== "None" ? sel.special : "—";
      const np = at("weapons", "txt_curname");
      root.addChild(this.text(sel.name, np.x, np.y, 14, C_HEADER, { bold: true, fit: 130 }));
      const tp = at("weapons", "txt_curtype");
      root.addChild(this.text(WEAPON_CATS[this.cat], tp.x, tp.y, 11, C_LABEL, { alpha: A_LABEL }));
      const sp = at("weapons", "txt_curspec");
      root.addChild(this.text(`Special: ${spec}`, sp.x, sp.y, 10, C_LABEL, { alpha: A_LABEL }));
      const dp = at("weapons", "txt_curdesc");
      root.addChild(this.text(sel.desc || "", dp.x, dp.y, 9, C_DIM, { wrap: 300, alpha: 0.9 }));

      const icon = ArmAnim.gunIcon(sel.id) ?? ArmArt.getIcon(sel.id);
      if (icon) {
        const s = new Sprite(icon);
        const ip = at("weapons", "mc_curweap");
        s.anchor.set(0.5);
        s.x = ip.x + 60;
        s.y = ip.y + 30;
        s.scale.set(Math.min(2.4 * ArmAnim.scale, 170 / (icon.width || 1), 80 / (icon.height || 1)));
        root.addChild(s);
      }
    }
  }

  // --- equipment (frame 85) ------------------------------------------------

  private buildEquipment(): void {
    const root = this.content;

    for (let cls = 0; cls < 3; cls++) {
      const items = equipsForSlot(cls);
      const curId = equippedInSlot(cls);
      const cur = curId ? equipById(curId) : undefined;

      // Left panel: what is equipped in this slot (`txt_<cls>_name`/`desc`).
      const np = at("equipment", `txt_${cls}_name`);
      const dp = at("equipment", `txt_${cls}_desc`);
      root.addChild(this.text(cur?.name ?? "Nothing", np.x, np.y, 11, curId ? C_HEADER : C_DIM, {
        bold: !!curId, fit: 230, alpha: curId ? 0.95 : 0.5,
      }));
      if (cur?.desc) {
        root.addChild(this.text(cur.desc, dp.x, dp.y, 9, C_DIM, { wrap: 240, alpha: 0.8 }));
      }

      // Right panel: the slot's items in two columns of three.
      for (let i = 0; i < 6; i++) {
        const item = items[i];
        const p = at("equipment", `but_list_${cls}_${i}`);
        if (!item) continue;
        const id = equipId(item);
        const owned = isEquipOwned(id);
        const equipped = curId === id;
        const cost = equipCost(id);
        const canBuy = canBuyEquip(id);

        this.row(root, equipped ? "row_weapon_over" : "row_weapon_up", p.x, p.y, 195, 34);
        this.zone(root, p.x, p.y, 195, 34, () => {
          if (equipped) this.rebuild();
          else if (owned) this.act(equipItem(id));
          else this.act(buyEquip(id));
        });
        root.addChild(this.text(item.name, p.x + 8, p.y + 4, 11, owned ? C_HEADER : C_LOCKED, {
          bold: owned, fit: 120, alpha: owned ? 0.95 : 0.6,
        }));
        const status = equipped ? "Equipped" : owned ? "Owned" : canBuy ? `${addNumCommas(cost)} cr` : "Locked";
        root.addChild(this.text(status, p.x + 187, p.y + 5, 9,
          equipped ? C_OPTIONS_GREEN : owned ? C_STATUS_OWNED : C_WARNING,
          { anchorX: 1, fit: 70 }));
      }
    }
  }

  // --- abilities (frame 78) ------------------------------------------------

  private buildAbilities(): void {
    const root = this.content;
    const list = allAbilities().filter((a) => a.id !== "none");

    for (let i = 0; i < 8; i++) {
      const a = list[i];
      if (!a) continue;
      const p = at("abilities", `but_list${i}`);
      const owned = isAbilityOwned(a.id);
      const equipped = SD.profile.prof_ability === a.id;
      const cost = abilityCost(a.id);
      const canBuy = canBuyAbility(a.id);
      const isSel = this.selAbility === a.id;

      this.row(root, isSel ? "row_ability_over" : "row_ability_up", p.x, p.y, 312, 48);
      this.zone(root, p.x, p.y, 312, 48, () => {
        this.selAbility = a.id;
        if (equipped) this.rebuild();
        else if (owned) this.act(equipAbility(a.id));
        else if (canBuy) this.act(buyAbility(a.id));
        else {
          Sound.play("R2_Error");
          this.rebuild();
        }
      });

      const icon = makeAbilityIcon(a.id, a.type, 34);
      icon.x = p.x + 10;
      icon.y = p.y + 7;
      icon.alpha = owned ? 1 : 0.5;
      root.addChild(icon);

      root.addChild(this.text(a.name, p.x + 56, p.y + 8, 14, owned ? C_HEADER : C_LOCKED, {
        bold: true, fit: 150, alpha: owned ? 0.95 : 0.6,
      }));
      root.addChild(this.text(a.shortDesc, p.x + 56, p.y + 26, 9, C_DIM, { fit: 160, alpha: 0.85 }));

      const status = equipped ? "Equipped" : owned ? "Owned" : canBuy ? `${addNumCommas(cost)} cr` : "Locked";
      root.addChild(this.text(status, p.x + 306, p.y + 8, 10,
        equipped ? C_OPTIONS_GREEN : owned ? C_STATUS_OWNED : C_WARNING,
        { anchorX: 1, fit: 90, alpha: 0.95 }));
    }

    // Details on the left: the selected ability, or the equipped one.
    const sel = list.find((a) => a.id === this.selAbility)
      ?? list.find((a) => a.id === SD.profile.prof_ability)
      ?? list[0];
    if (sel) {
      const ip = at("abilities", "mc_ability");
      const icon = makeAbilityIcon(sel.id, sel.type, 64);
      icon.x = ip.x + 4;
      icon.y = ip.y + 4;
      root.addChild(icon);
      const np = at("abilities", "txt_name");
      root.addChild(this.text(sel.name, np.x, np.y, 15, C_HEADER, { bold: true, fit: 220 }));
      const shp = at("abilities", "txt_shortdesc");
      root.addChild(this.text(sel.shortDesc, shp.x, shp.y, 10, C_LABEL, { alpha: A_LABEL, fit: 230 }));
      const up = at("abilities", "txt_usage");
      root.addChild(this.text(`Usage: ${sel.usedEnergy} energy`, up.x, up.y, 10, C_LABEL, { alpha: A_LABEL }));
      const tp = at("abilities", "txt_type");
      root.addChild(this.text(sel.type, tp.x, tp.y, 10, abilityTypeColor(sel.type), { bold: true }));
      const dp = at("abilities", "txt_desc");
      root.addChild(this.text(
        `Recharges a full bar in ${sel.rechargeSec}s.` +
        (isAbilityOwned(sel.id) ? " Owned — click the row to equip." : ""),
        dp.x, dp.y, 9, C_DIM, { wrap: 260, alpha: 0.9 },
      ));
    }
  }

  // --- kill bonuses (frame 92) ---------------------------------------------

  private buildKillBonuses(): void {
    const root = this.content;
    const perPage = 10;
    const pageCount = Math.ceil(RAZE2_KILL_BONUSES.length / perPage);
    this.page = Math.max(0, Math.min(pageCount - 1, this.page));
    const page = RAZE2_KILL_BONUSES.slice(this.page * perPage, (this.page + 1) * perPage);

    for (let i = 0; i < page.length; i++) {
      const b = page[i];
      const p = at("killbonuses", `but_list${i}`);
      const isSel = this.selBonus === b.id;
      this.row(root, isSel ? "row_weapon_over" : "row_weapon_up", p.x, p.y, 312, 34);
      this.zone(root, p.x, p.y, 312, 34, () => {
        this.selBonus = b.id;
        Sound.play("R2_Click");
        this.rebuild();
      });
      root.addChild(this.text(b.name, p.x + 10, p.y + 4, 12, C_HEADER, { bold: true, fit: 200, alpha: 0.95 }));
      root.addChild(this.text(`${addNumCommas(b.worth)} cr`, p.x + 306, p.y + 4, 11, C_ACCENT_YELLOW, {
        anchorX: 1, bold: true,
      }));
    }

    const b = RAZE2_KILL_BONUSES.find((x) => x.id === this.selBonus) ?? page[0];
    if (b) {
      const np = at("killbonuses", "txt_name");
      root.addChild(this.text(b.name, np.x, np.y, 14, C_HEADER, { bold: true, fit: 220 }));
      const wp = at("killbonuses", "txt_worth");
      root.addChild(this.text(`${addNumCommas(b.worth)} cr`, wp.x, wp.y, 12, C_ACCENT_YELLOW, { bold: true }));
      const dp = at("killbonuses", "txt_desc");
      root.addChild(this.text(b.desc, dp.x, dp.y, 10, C_DIM, { wrap: 260, alpha: 0.9 }));
    }

    // Page labels are baked into the plate ("Page 1/2/3"); overlay the hit
    // areas and underline only the active one.
    for (let i = 0; i < 3; i++) {
      const p = at("killbonuses", `bt_page${i + 1}`);
      if (this.page === i) {
        const u = new Graphics();
        u.rect(p.x - 22, p.y + 10, 44, 2).fill({ color: C_OPTIONS_GREEN, alpha: 0.95 });
        root.addChild(u);
      }
      this.zone(root, p.x - 22, p.y - 11, 44, 22, () => {
        if (this.page === i) return;
        this.page = i;
        Sound.play("R2_Click");
        this.rebuild();
      });
    }
  }

  enterFrame(): void {}
}
