import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { ArmArt } from "../assets/ArmArt";
import { SkinArt } from "../assets/SkinArt";
import {
  RAZE2_WEAPONS, RAZE2_SKINS,
  type Raze2Weapon, type Raze2Skin, type Raze2Equipment,
} from "../assets/raze2";
import {
  isGunUnlocked, gunCost, canBuyGun, buyGun,
  isGunEquipped, equipGun, equippedGuns, ensureLoadout, loadoutFull, LOADOUT_MAX,
  isSkinUnlocked, skinCost, canBuySkin, buySkin, equipSkin,
} from "../game/Armory";
import {
  equipsForSlot, equipId, isEquipOwned, equipCost, canBuyEquip, buyEquip,
  equipItem, equippedInSlot,
} from "../game/Equipment";
import {
  allAbilities, isAbilityOwned, abilityCost, canBuyAbility, buyAbility,
  equipAbility, type AbilityDef,
} from "../game/Abilities";
import { makeBackground, makeScrim } from "./ui";
import { ArmoryScreen } from "./ArmoryScreen";
import {
  Raze2Button,
  drawRaze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_LABEL,
  C_DIM,
  C_SELECTED,
  C_LOCKED,
  C_STATUS_OWNED,
  C_OPTIONS_GREEN,
  C_ACCENT_YELLOW,
  C_ACCENT_BAR,
  C_WARNING,
  C_TEAM1,
  C_TEAM2,
  C_STATUS_LOCKED,
  A_HEADER,
  A_LABEL,
  makeAbilityIcon,
  abilityTypeColor,
} from "../ui/raze2";

/**
 * The Armory's browse/purchase view — the shop half of the screen pair. The
 * {@link ArmoryScreen} overview shows what you currently carry; this is where
 * you spend credits and change it.
 *
 * Opened from the overview's sub-nav with the category to show
 * (`engine.setScreen(ArmoryBrowseScreen, "weapons")`); Back returns to the
 * overview rather than the main menu, so the two read as one destination.
 *
 * All economy/unlock/equip behaviour is unchanged from the original combined
 * screen — only where it lives moved. Weapon tiles keep Raze 2's 5-bar stat
 * radar (Power / Accuracy / Clip / Range / Rate of Fire, doc 11 §2.2.1).
 */

/** Authentic Raze 2 weapon-type category names (doc 11 §2.2.1); type 7
 *  "Environment" is match-spawned, not a shop tab. */
const WEAPON_CATS = [
  "Starter", "Side Arm", "Close Range", "Automatic",
  "Long Range", "Heavy", "Explosive",
];
const SKIN_RACES = ["Human", "Alien", "Robot", "Zombie"];

/**
 * Accent colour per race. Weapons and skins both carry a `race`, so one ramp
 * gives the two tabs a shared visual language (edge stripe, art-plate tint,
 * chip) the way `abilityTypeColor` does for the abilities tab.
 */
const RACE_COLOR: Record<string, number> = {
  Human: C_TEAM1, // blue
  Alien: C_TEAM2, // orange
  Robot: C_STATUS_LOCKED, // pale purple
  Zombie: C_OPTIONS_GREEN, // the menu accent green
};

/** Source weapon data has a typo ("Unknoen") and a few blank races; both are
 *  the same thing, so normalise before labelling or colouring. */
function raceLabel(race: string): string {
  return RACE_COLOR[race] ? race : "Unknown";
}

function raceColor(race: string): number {
  return RACE_COLOR[race] ?? C_DIM;
}
/** Equipment slot names (cls 0-2), authentic Raze 2 wording (doc 11 §2.2.3). */
const EQUIP_SLOTS = ["Defensive", "Utility", "Offensive"];

export type ArmoryMode = "weapons" | "skins" | "equipment" | "abilities";

const MODE_TITLES: Record<ArmoryMode, string> = {
  weapons: "WEAPONS",
  skins: "SKINS",
  equipment: "EQUIPMENT",
  abilities: "ABILITIES",
};

/** Stage side margin. The title, sub-tab row and Back button all sit on it, so
 *  every tile grid is centred inside the same content column. */
const MARGIN = 40;
/** Read at build time, not import time — the stage size is the window's. */
const contentW = () => GAME_WIDTH - MARGIN * 2;
/** Lowest a tile grid may reach before it is scaled down; keeps it clear of the
 *  Back button at `GAME_HEIGHT - 54`. */
const gridBottom = () => GAME_HEIGHT - 70;

/** Sub-tab row (Starter / Side Arm / …): top edge and plate height. */
const TAB_ROW_Y = 108;
const TAB_ROW_H = 26;
/** Breathing room under the sub-tab row before the first row of tiles. */
const TAB_ROW_GAP = 16;
/**
 * Top of the tile grid.
 *
 * Derived from the sub-tab row rather than hand-set per tab: three of the four
 * tabs used to start at a literal y=124, which is 10px *inside* the row of
 * category buttons above them, so the top row of tiles was drawn over the tab
 * labels. Only Equipment had the correct value.
 */
const GRID_TOP = TAB_ROW_Y + TAB_ROW_H + TAB_ROW_GAP;
/** Abilities draws no sub-tabs, so its grid starts where that row would be. */
const GRID_TOP_NO_TABS = TAB_ROW_Y + TAB_ROW_GAP;

/** Weapon-tile stat radar metrics. The block is right-aligned in the tile, so
 *  its total width is what's left over for the gun name beside it. */
const STAT_LABEL_W = 34;
const STAT_SEG_W = 10;
const STAT_SEG_GAP = 2;
const STAT_BLOCK_W = STAT_LABEL_W + 8 * (STAT_SEG_W + STAT_SEG_GAP) - STAT_SEG_GAP;

/** Height of a {@link ArmoryBrowseScreen.chip} pill. */
const CHIP_H = 16;

/** Comma-group an integer (Raze 2 `UT.addNumCommas`, mirrors game/Hud.ts). */
function addNumCommas(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export class ArmoryBrowseScreen extends Screen {
  private mode: ArmoryMode = "weapons";
  private catIdx = 0;
  private tabRow = new Container();
  private grid = new Container();
  private creditsText!: Text;
  private titleText!: Text;
  private loadoutText!: Text;
  private modeBtns: Partial<Record<ArmoryMode, Raze2Button>> = {};

  constructor(engine: ConstructorParameters<typeof Screen>[0], arg?: unknown) {
    super(engine, arg);
    ensureLoadout();
    if (arg === "weapons" || arg === "skins" || arg === "equipment" || arg === "abilities") {
      this.mode = arg;
    }

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));
    this.view.addChild(makeScrim(0x05070c, 0.55));

    // --- header ------------------------------------------------------------
    this.titleText = new Text({
      text: MODE_TITLES[this.mode],
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER,
        fontSize: 32, fontWeight: "700", letterSpacing: 3,
      }),
    });
    this.titleText.alpha = A_HEADER;
    this.titleText.anchor.set(0, 0.5);
    this.titleText.x = MARGIN; this.titleText.y = 34;
    this.view.addChild(this.titleText);

    // Wallet read-out (comma-grouped + "cr" suffix, Raze 2 style).
    this.creditsText = new Text({
      text: "",
      style: new TextStyle({ fill: C_OPTIONS_GREEN, fontFamily: FONT_VALUE, fontSize: 22, fontWeight: "bold" }),
    });
    this.creditsText.anchor.set(1, 0);
    this.creditsText.x = GAME_WIDTH - MARGIN; this.creditsText.y = 24;
    this.view.addChild(this.creditsText);

    // What you carry into the match — the number row holds LOADOUT_MAX guns.
    // Right-aligned under the credits: a fixed left offset collided with the
    // wider mode titles ("ABILITIES", "EQUIPMENT") at this header size.
    this.loadoutText = new Text({
      text: "",
      style: new TextStyle({ fill: C_LABEL, fontFamily: FONT_VALUE, fontSize: 13, letterSpacing: 1 }),
    });
    this.loadoutText.anchor.set(1, 0);
    this.loadoutText.x = GAME_WIDTH - MARGIN; this.loadoutText.y = 50;
    this.view.addChild(this.loadoutText);

    // --- top-level mode tabs ----------------------------------------------
    const modes: [ArmoryMode, string][] = [
      ["weapons", "Weapons"], ["skins", "Skins"],
      ["equipment", "Equipment"], ["abilities", "Abilities"],
    ];
    const bw = 152, gap = 8;
    const totalW = modes.length * bw + (modes.length - 1) * gap;
    let bx = GAME_WIDTH / 2 - totalW / 2;
    for (const [m, label] of modes) {
      const btn = this.mkButton(label, bw, 30, () => this.setMode(m));
      btn.view.x = bx; btn.view.y = 66;
      this.modeBtns[m] = btn;
      this.view.addChild(btn.view);
      bx += bw + gap;
    }

    this.view.addChild(this.tabRow);
    this.view.addChild(this.grid);

    const back = this.mkButton("Back to Armory", 200, 38, () => this.back());
    back.view.x = MARGIN; back.view.y = GAME_HEIGHT - 54;
    this.view.addChild(back.view);

    this.refresh();
  }

  // --- shared button factory (wires the kit hover cue) --------------------

  private mkButton(label: string, width: number, height: number, onClick: () => void, reverse = false): Raze2Button {
    const b = new Raze2Button(label, { width, height, reverse, onClick });
    b.view.on("pointerover", () => Sound.play("R2_Click"));
    return b;
  }

  private setMode(m: ArmoryMode): void {
    if (this.mode === m) return;
    this.mode = m;
    this.catIdx = 0;
    Sound.play("R2_Click");
    this.refresh();
  }

  private labels(): string[] {
    switch (this.mode) {
      case "weapons": return WEAPON_CATS;
      case "skins": return SKIN_RACES;
      case "equipment": return EQUIP_SLOTS;
      case "abilities": return []; // single grid, no sub-tabs
    }
  }

  private buildTabs(): void {
    this.tabRow.removeChildren();
    const labels = this.labels();
    if (labels.length === 0) return;
    const y = TAB_ROW_Y;
    const gap = 6;
    const tw = (contentW() - gap * (labels.length - 1)) / labels.length;
    labels.forEach((label, i) => {
      const btn = this.mkButton(label, tw, TAB_ROW_H, () => {
        if (this.catIdx === i) return;
        this.catIdx = i;
        Sound.play("R2_Click");
        this.refresh();
      });
      btn.view.x = MARGIN + i * (tw + gap);
      btn.view.y = y;
      btn.setSelected(i === this.catIdx);
      this.tabRow.addChild(btn.view);
    });
  }

  private refresh(): void {
    this.titleText.text = MODE_TITLES[this.mode];
    this.creditsText.text = `${addNumCommas(SD.credits)} cr`;
    // The loadout counter is the gun-slot count, so it only means anything on
    // the weapons tab.
    const carried = equippedGuns().length;
    this.loadoutText.text = `LOADOUT  ${carried} / ${LOADOUT_MAX}`;
    this.loadoutText.style.fill = loadoutFull() ? C_ACCENT_YELLOW : C_LABEL;
    this.loadoutText.visible = this.mode === "weapons";

    for (const m of ["weapons", "skins", "equipment", "abilities"] as ArmoryMode[]) {
      this.modeBtns[m]?.setSelected(this.mode === m);
    }
    this.buildTabs();
    this.grid.removeChildren();
    if (this.mode === "weapons") this.refreshWeapons();
    else if (this.mode === "skins") this.refreshSkins();
    else if (this.mode === "equipment") this.refreshEquipment();
    else this.refreshAbilities();
  }

  /**
   * Lay a tile grid out centred in the content column and, when its rows would
   * run past {@link gridBottom}, shrink the whole grid uniformly so it still
   * fits above the Back button.
   *
   * Needed because the tab with the most entries (Human skins: 15 tiles over 5
   * columns) is three rows deep, which at the source tile size ended 642px down
   * a 639px stage — the bottom row was off screen and behind the Back button.
   * Scaling the container rather than the tiles keeps every tile's internal
   * layout (art, name, price, button) intact.
   */
  private layoutGrid(
    count: number,
    cols: number,
    tw: number,
    th: number,
    gapX: number,
    gapY: number,
    startY: number,
  ): (i: number) => { x: number; y: number } {
    const startX = MARGIN + (contentW() - (cols * tw + (cols - 1) * gapX)) / 2;

    const rows = Math.max(1, Math.ceil(count / cols));
    const bottom = startY + rows * (th + gapY) - gapY;
    this.grid.pivot.set(0, 0);
    this.grid.position.set(0, 0);
    this.grid.scale.set(1);
    if (bottom > gridBottom()) {
      const scale = (gridBottom() - startY) / (bottom - startY);
      this.grid.pivot.set(GAME_WIDTH / 2, startY);
      this.grid.position.set(GAME_WIDTH / 2, startY);
      this.grid.scale.set(scale);
    }

    return (i) => ({
      x: startX + (i % cols) * (tw + gapX),
      y: startY + Math.floor(i / cols) * (th + gapY),
    });
  }

  // --- small drawing helpers ---------------------------------------------

  /** Dark-glass tile panel with an optional coloured equipped border. */
  private tilePanel(w: number, h: number, equipped: boolean, accent: number): Graphics {
    const g = new Graphics();
    drawRaze2Panel(g, 0, 0, w, h, {
      radius: 6,
      accent: equipped ? accent : C_ACCENT_BAR,
      corners: false,
    });
    if (equipped) {
      g.roundRect(0, 0, w, h, 6).stroke({ color: accent, width: 2, alpha: 0.95 });
    }
    return g;
  }

  private text(str: string, x: number, y: number, size: number, color: number, opts: {
    font?: string; bold?: boolean; italic?: boolean; alpha?: number; wrap?: number; anchorX?: number; anchorY?: number;
    letterSpacing?: number;
    /** Hard width budget in px. A line that would run past it (a long gun name
     *  reaching the stat block) is stepped down in point size until it fits. */
    fit?: number;
  } = {}): Text {
    const t = new Text({
      text: str,
      style: new TextStyle({
        fill: color,
        fontFamily: opts.font ?? FONT_VALUE,
        fontSize: size,
        fontWeight: opts.bold ? "bold" : "normal",
        fontStyle: opts.italic ? "italic" : "normal",
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

  /**
   * A filled pill label — the shop's standard way of showing a category or a
   * state. Loose bold text at these sizes reads as a control you can press;
   * inside a bordered pill it reads as a tag, which keeps the real button the
   * only clickable-looking thing in a tile.
   *
   * Returns the node with its measured width so callers can flow chips in a row
   * or right-align one.
   */
  private chip(label: string, x: number, y: number, color: number, muted = false): { view: Container; w: number } {
    const view = new Container();
    const t = this.text(label, 8, 3.5, 9, color, { bold: true, letterSpacing: 1 });
    t.alpha = muted ? 0.55 : 0.95;
    const w = Math.ceil(t.width) + 16;
    const g = new Graphics();
    g.roundRect(0, 0, w, CHIP_H, CHIP_H / 2)
      .fill({ color, alpha: muted ? 0.08 : 0.16 })
      .stroke({ color, width: 1, alpha: muted ? 0.25 : 0.45 });
    view.addChild(g);
    view.addChild(t);
    view.x = x; view.y = y;
    return { view, w };
  }

  /** Non-clickable state badge, sized like a button so it sits in the same
   *  action column without inviting a click. */
  private stateBadge(label: string, x: number, y: number, w: number, h: number, color: number): Container {
    const view = new Container();
    const g = new Graphics();
    g.roundRect(0, 0, w, h, 4)
      .fill({ color, alpha: 0.18 })
      .stroke({ color, width: 1.5, alpha: 0.9 });
    view.addChild(g);
    view.addChild(this.text(label, w / 2, (h - 14) / 2, 12, color, {
      bold: true, anchorX: 0.5, letterSpacing: 1,
    }));
    view.x = x; view.y = y;
    return view;
  }

  /** Category stripe down a tile's leading edge. */
  private edgeStripe(c: Container, th: number, color: number, lit: boolean): void {
    const stripe = new Graphics();
    stripe.roundRect(0, 6, 3, th - 12, 1.5).fill({ color, alpha: lit ? 0.95 : 0.4 });
    c.addChild(stripe);
  }

  /** One 8-segment stat bar (label + segments) drawn into `g`, label into `c`. */
  private statBar(c: Container, g: Graphics, x: number, y: number, label: string, value: number): void {
    const v = Math.max(0, Math.min(8, value));
    c.addChild(this.text(label, x, y - 1, 9, C_LABEL, { alpha: A_LABEL }));
    const segW = STAT_SEG_W, segH = 7, gap = STAT_SEG_GAP, sx = x + STAT_LABEL_W;
    for (let i = 0; i < 8; i++) {
      const filled = i < v;
      g.roundRect(sx + i * (segW + gap), y, segW, segH, 1)
        .fill({ color: filled ? C_OPTIONS_GREEN : C_DIM, alpha: filled ? 0.95 : 0.18 });
    }
  }

  // --- weapons -----------------------------------------------------------

  private refreshWeapons(): void {
    const cols = 3, gapX = 12, gapY = 10;
    // Sized off the content column so the tiles line up with the sub-tab row
    // above them rather than overhanging it. At 3x140 from GRID_TOP the fullest
    // tab (Explosive, 7 guns over 3 rows) ends at 590, just past gridBottom(),
    // so that one tab scales to ~0.95 and the rest keep their authored size.
    const tw = (contentW() - (cols - 1) * gapX) / cols;
    const th = 140;
    const guns = RAZE2_WEAPONS.filter((w) => w.type === this.catIdx);
    const at = this.layoutGrid(guns.length, cols, tw, th, gapX, gapY, GRID_TOP);
    guns.forEach((w, i) => {
      const tile = this.weaponTile(w, tw, th);
      const p = at(i);
      tile.x = p.x;
      tile.y = p.y;
      this.grid.addChild(tile);
    });
  }

  /**
   * One weapon card. Left column: race stripe, name, race + special chips over
   * a wide art plate that shows the gun at a shared scale, so a pistol reads as
   * smaller than a shotgun the way it does in the rack. Right column: the
   * authentic 5-bar stat radar (doc 11 §2.2.1) with the action button directly
   * beneath it at exactly the block's width, which lines every button in the
   * grid up on one x.
   *
   * The source `desc` prose is not drawn. At three columns there is no room for
   * up to 186 characters beside the radar, and the two chips carry the same
   * distinction in a form that scans; the radar is the tile's decision content.
   */
  private weaponTile(w: Raze2Weapon, tw: number, th: number): Container {
    const c = new Container();
    const owned = isGunUnlocked(w.id);
    const cost = gunCost(w.id);
    const reward = !isFinite(cost);
    const equipped = owned && isGunEquipped(w.id);
    const slot = equipped ? equippedGuns().indexOf(w.id) : -1;
    const full = loadoutFull();
    const accent = raceColor(w.race);

    const g = this.tilePanel(tw, th, equipped, C_OPTIONS_GREEN);
    c.addChild(g);
    this.edgeStripe(c, th, accent, owned);

    const PAD = 12;
    // The radar and the action button share one right-hand column width, so the
    // button sits exactly under the bars in every tile.
    const colX = tw - PAD - STAT_BLOCK_W;
    const leftW = colX - PAD - 12;

    c.addChild(this.text(w.name, PAD, 8, 15, owned ? C_HEADER : C_LOCKED, {
      font: FONT_HEADER, bold: true, alpha: owned ? A_HEADER : 0.65, fit: leftW,
    }));

    // Race + special as chips rather than a "Human · Multi-Shot" run-on.
    const race = this.chip(raceLabel(w.race).toUpperCase(), PAD, 30, accent, !owned);
    c.addChild(race.view);
    if (w.special && w.special !== "None") {
      const sp = this.chip(w.special.toUpperCase(), PAD + race.w + 6, 30, C_ACCENT_YELLOW, !owned);
      c.addChild(sp.view);
    }

    // Art plate — a tinted rack the gun sits on, so an icon with a ragged
    // silhouette still occupies a rectangle the grid can align to.
    const plateY = 52, plateH = 52;
    const plate = new Graphics();
    plate.roundRect(PAD, plateY, leftW, plateH, 5)
      .fill({ color: accent, alpha: owned ? 0.1 : 0.05 })
      .stroke({ color: accent, width: 1, alpha: owned ? 0.3 : 0.15 });
    c.addChild(plate);

    const icon = ArmArt.getIcon(w.id);
    if (icon) {
      const s = new Sprite(icon);
      // A shared 2x, only reduced for the few icons that would overflow the
      // plate (shotgun is the widest at 81px, sawgun the tallest at 31). Fitting
      // each icon to the plate instead would blow a pistol up to a rifle's size.
      s.scale.set(Math.min(2, (leftW - 20) / (icon.width || 1), (plateH - 12) / (icon.height || 1)));
      s.anchor.set(0.5);
      s.x = PAD + leftW / 2; s.y = plateY + plateH / 2;
      s.alpha = owned ? 1 : 0.4;
      c.addChild(s);
    }

    // 5-bar stat radar (doc 11 §2.2.1). All source fields are present on
    // Raze2Weapon; extraShots is nested in `w.extra`.
    const es = Number((w.extra as Record<string, unknown> | undefined)?.extraShots) || 1;
    const dmgEff = es > 1 ? w.dmg * (es / 2) : w.dmg;
    let by = 8;
    const step = 17;
    this.statBar(c, g, colX, by, "PWR", Math.ceil((dmgEff / 100) * 8)); by += step;
    this.statBar(c, g, colX, by, "ACC", Math.ceil(((10 - w.recoil) / 10) * 8)); by += step;
    this.statBar(c, g, colX, by, "CLP", Math.ceil((w.clipSize / 50) * 8)); by += step;
    this.statBar(c, g, colX, by, "RNG", Math.ceil((w.range / 100) * 8)); by += step;
    this.statBar(c, g, colX, by, "ROF", Math.ceil(((1 - w.shootDelay) / 1) * 8));

    // Bottom-left state chip. Only ever says something the button does not: a
    // plain affordable purchase shows nothing here, because "Buy · 850" already
    // reads it out.
    const state: [string, number] | null =
      slot === 0 ? ["SLOT 1 · HELD", C_OPTIONS_GREEN]
      : equipped ? [`SLOT ${slot + 1}`, C_OPTIONS_GREEN]
      : owned ? (full ? ["RACK FULL", C_ACCENT_YELLOW] : ["OWNED", C_STATUS_OWNED])
      : reward ? ["REWARD", C_SELECTED]
      : canBuyGun(w.id) ? null
      : ["NOT ENOUGH CREDITS", C_WARNING];
    if (state) c.addChild(this.chip(state[0], PAD, th - PAD - CHIP_H, state[1], !owned).view);

    // Action column, bottom-right, the width of the radar above it. A reward
    // gun you already own can still be racked, so only an unowned one is
    // button-less.
    const bh = 28;
    if (owned || !reward) {
      const label = owned ? (equipped ? "Unequip" : "Equip") : `Buy · ${addNumCommas(cost)}`;
      const btn = this.mkButton(label, STAT_BLOCK_W, bh, () => {
        this.act(owned ? equipGun(w.id) : buyGun(w.id));
      });
      btn.view.x = colX; btn.view.y = th - PAD - bh;
      // Equipping past the rack cap is refused, so grey the button out first.
      if (!owned) btn.setEnabled(canBuyGun(w.id));
      else if (!equipped && full) btn.setEnabled(false);
      c.addChild(btn.view);
    }
    return c;
  }

  // --- skins -------------------------------------------------------------

  private refreshSkins(): void {
    const cols = 5, gapX = 12, gapY = 10;
    // Same content column as every other tab. At 5x140 from GRID_TOP the
    // fullest tab (Human, 15 skins over 3 rows) ends at 590, a little past
    // gridBottom(), so that tab alone scales to ~0.95.
    const tw = (contentW() - (cols - 1) * gapX) / cols;
    const th = 140;
    const race = SKIN_RACES[this.catIdx];
    const skins = RAZE2_SKINS.filter((s) => s.race === race);
    const at = this.layoutGrid(skins.length, cols, tw, th, gapX, gapY, GRID_TOP);
    skins.forEach((s, i) => {
      const tile = this.skinTile(s, tw, th);
      const p = at(i);
      tile.x = p.x;
      tile.y = p.y;
      this.grid.addChild(tile);
    });
  }

  /**
   * One skin card: a race-tinted portrait plate with the figure standing on its
   * floor line, the name beneath, and a single full-width action row. The tab
   * already names the race, so there is no race chip here — the edge stripe and
   * the plate tint carry it instead.
   */
  private skinTile(s: Raze2Skin, tw: number, th: number): Container {
    const c = new Container();
    const equipped = SD.profile.prof_skin === s.id;
    const owned = isSkinUnlocked(s.id);
    const cost = skinCost(s.id);
    const reward = !isFinite(cost);
    const accent = raceColor(s.race);

    c.addChild(this.tilePanel(tw, th, equipped, accent));
    this.edgeStripe(c, th, accent, owned);

    const PAD = 10;
    const plateY = 6, plateH = 74, plateW = tw - PAD * 2;
    // Floor line the figure stands on, a few px above the plate's base.
    const floorY = plateY + plateH - 5;

    const plate = new Graphics();
    plate.roundRect(PAD, plateY, plateW, plateH, 5)
      .fill({ color: accent, alpha: owned ? 0.1 : 0.05 })
      .stroke({ color: accent, width: 1, alpha: owned ? 0.3 : 0.15 });
    plate.moveTo(PAD + 14, floorY).lineTo(PAD + plateW - 14, floorY)
      .stroke({ color: accent, width: 1, alpha: owned ? 0.35 : 0.15 });
    c.addChild(plate);

    const tex = SkinArt.getTexture(s.id);
    if (tex) {
      const a = SkinArt.anchor();
      const sp = new Sprite(tex);
      sp.anchor.set(a.x, a.y);
      // Size off the feet mark, not the canvas height: the figure only occupies
      // crown-to-feet (~92 of 96 native px) inside the texture, so scaling by
      // the canvas rendered every skin noticeably short.
      sp.scale.set(64 / (SkinArt.manifest.feet[1] || SkinArt.canvas[1]));
      sp.x = tw / 2; sp.y = floorY;
      sp.alpha = owned ? 1 : 0.45;
      c.addChild(sp);
    }

    c.addChild(this.text(s.name, tw / 2, 84, 13, owned ? C_HEADER : C_LOCKED, {
      font: FONT_HEADER, bold: true, anchorX: 0.5, alpha: owned ? A_HEADER : 0.65, fit: plateW,
    }));

    // Full-width action row. There is no "not enough credits" hint here as on
    // the ability rows: at five across, any label wide enough to read crosses
    // the figure, so the dimmed portrait and the dead Buy button carry it.
    const bh = 26, by = th - 8 - bh;
    if (equipped) {
      c.addChild(this.stateBadge("EQUIPPED", PAD, by, plateW, bh, accent));
    } else if (owned) {
      const btn = this.mkButton("Equip", plateW, bh, () => this.act(equipSkin(s.id)));
      btn.view.x = PAD; btn.view.y = by;
      c.addChild(btn.view);
    } else if (reward) {
      // Campaign-granted (e.g. mutate) — there is nothing to buy.
      c.addChild(this.stateBadge("REWARD", PAD, by, plateW, bh, C_SELECTED));
    } else {
      const btn = this.mkButton(`Buy · ${addNumCommas(cost)}`, plateW, bh, () => this.act(buySkin(s.id)));
      btn.view.x = PAD; btn.view.y = by;
      btn.setEnabled(canBuySkin(s.id));
      c.addChild(btn.view);
    }
    return c;
  }

  // --- equipment ---------------------------------------------------------

  private refreshEquipment(): void {
    const cols = 2, gapX = 16, gapY = 12;
    const tw = (contentW() - (cols - 1) * gapX) / cols;
    const th = 92;
    const items = equipsForSlot(this.catIdx);
    const at = this.layoutGrid(items.length, cols, tw, th, gapX, gapY, GRID_TOP);
    items.forEach((e, i) => {
      const tile = this.equipTile(e, tw, th);
      const p = at(i);
      tile.x = p.x;
      tile.y = p.y;
      this.grid.addChild(tile);
    });
  }

  private equipTile(e: Raze2Equipment, tw: number, th: number): Container {
    const id = equipId(e);
    const c = new Container();
    const equipped = equippedInSlot(e.cls) === id;
    c.addChild(this.tilePanel(tw, th, equipped, C_OPTIONS_GREEN));

    c.addChild(this.text(e.name, 16, 12, 15, C_HEADER, { font: FONT_HEADER, bold: true }));
    c.addChild(this.text(e.desc, 16, 36, 11, C_LABEL, { font: FONT_BODY, alpha: A_LABEL, wrap: tw - 176 }));

    const owned = isEquipOwned(id);
    const cost = equipCost(id);
    const bw2 = 108, bh = 30;
    if (equipped) {
      c.addChild(this.text("EQUIPPED", tw - 16, 12, 13, C_OPTIONS_GREEN, { bold: true, anchorX: 1 }));
      const btn = this.mkButton("Unequip", bw2, bh, () => this.act(equipItem(id)));
      btn.view.x = tw - bw2 - 16; btn.view.y = th - bh - 12;
      c.addChild(btn.view);
    } else if (owned) {
      const btn = this.mkButton("Equip", bw2, bh, () => this.act(equipItem(id)));
      btn.view.x = tw - bw2 - 16; btn.view.y = (th - bh) / 2;
      c.addChild(btn.view);
    } else {
      const btn = this.mkButton(`Buy · ${addNumCommas(cost)}`, 128, bh, () => this.act(buyEquip(id)));
      btn.view.x = tw - 128 - 16; btn.view.y = (th - bh) / 2;
      btn.setEnabled(canBuyEquip(id));
      c.addChild(btn.view);
    }
    return c;
  }

  // --- abilities ---------------------------------------------------------

  private refreshAbilities(): void {
    const cols = 2, gapX = 16, gapY = 12;
    const tw = (contentW() - (cols - 1) * gapX) / cols;
    const th = 100;
    const items = allAbilities().filter((a) => a.id !== "none");
    const at = this.layoutGrid(items.length, cols, tw, th, gapX, gapY, GRID_TOP_NO_TABS);
    items.forEach((a, i) => {
      const tile = this.abilityTile(a, tw, th);
      const p = at(i);
      tile.x = p.x;
      tile.y = p.y;
      this.grid.addChild(tile);
    });
  }

  /**
   * One ability row: type stripe + icon badge on the left, name / type chip /
   * recharge / description in the middle, and a fixed action column on the
   * right so every button in the grid lines up.
   */
  private abilityTile(a: AbilityDef, tw: number, th: number): Container {
    const c = new Container();
    const equipped = SD.profile.prof_ability === a.id;
    const owned = isAbilityOwned(a.id);
    const cost = abilityCost(a.id);
    const accent = abilityTypeColor(a.type);

    c.addChild(this.tilePanel(tw, th, equipped, accent));

    this.edgeStripe(c, th, accent, owned);

    // Icon badge, vertically centred.
    const BOX = 56;
    const icon = makeAbilityIcon(a.id, a.type, BOX, !owned);
    icon.x = 16;
    icon.y = (th - BOX) / 2;
    c.addChild(icon);

    // Right-hand action column — fixed so buttons align across the grid.
    const ACT_W = 132;
    const actX = tw - ACT_W - 16;
    const textX = 16 + BOX + 16;

    c.addChild(this.text(a.name, textX, 15, 16, owned ? C_HEADER : C_LOCKED, {
      font: FONT_HEADER, bold: true, alpha: owned ? A_HEADER : 0.65, fit: actX - textX - 12,
    }));

    const chipY = 38;
    const type = this.chip(a.type.toUpperCase(), textX, chipY, accent, !owned);
    c.addChild(type.view);

    c.addChild(this.text(`RECHARGE ${a.rechargeSec}s`, textX + type.w + 12, chipY + 4, 9, C_LABEL, {
      alpha: 0.5, letterSpacing: 1,
    }));

    c.addChild(this.text(a.shortDesc, textX, 62, 11, C_LABEL, {
      font: FONT_BODY, alpha: owned ? 0.7 : 0.45, wrap: actX - textX - 12,
    }));

    const bh = 30;
    if (equipped) {
      // A state badge, not a button — nothing to click here.
      c.addChild(this.stateBadge("EQUIPPED", actX, (th - bh) / 2, ACT_W, bh, accent));
    } else if (owned) {
      const btn = this.mkButton("Equip", ACT_W, bh, () => this.act(equipAbility(a.id)));
      btn.view.x = actX; btn.view.y = (th - bh) / 2;
      c.addChild(btn.view);
    } else {
      const btn = this.mkButton(`Buy · ${addNumCommas(cost)}`, ACT_W, bh, () => this.act(buyAbility(a.id)));
      btn.view.x = actX; btn.view.y = (th - bh) / 2;
      btn.setEnabled(canBuyAbility(a.id));
      c.addChild(btn.view);
      // Make an unaffordable price legible as the reason the button is dead.
      if (!canBuyAbility(a.id)) {
        c.addChild(this.text("NOT ENOUGH CREDITS", actX + ACT_W / 2, (th - bh) / 2 + bh + 4, 8, C_WARNING, {
          anchorX: 0.5, alpha: 0.6, letterSpacing: 1,
        }));
      }
    }
    return c;
  }

  private act(ok: boolean): void {
    Sound.play(ok ? "R2_ClickGo" : "R2_Error");
    if (ok) this.refresh();
  }

  private back(): void {
    Sound.play("R2_ClickBack");
    this.engine.setScreen(ArmoryScreen, undefined, "slideRight");
  }

  enterFrame(): void {
    // Static shop screen.
  }
}
