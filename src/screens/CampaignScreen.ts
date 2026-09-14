import { Container, Graphics, Rectangle, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Backgrounds } from "../assets/Backgrounds";
import { LEVELS, preloadLevel } from "../game/Arena";
import { getCamp } from "../game/Campaign";
import { getCutscene, loadPanels } from "../game/Cutscene";
import { GameScreen } from "../game/GameScreen";
import { CutsceneScreen } from "./CutsceneScreen";
import CAMPAIGN_DATA from "../assets/raze2/campaign.json";
import { makeBackground, addScreenChrome, makeVeil, TITLE_SIZE, TITLE_Y } from "./ui";
import type { ScreenChrome } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import {
  Raze2Button,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_NORMAL,
  C_SELECTED,
  C_LOCKED,
  C_VALUE,
  C_OPTIONS_GREEN,
  C_DIM,
  A_HEADER,
  A_VALUE,
  A_BODY,
} from "../ui/raze2";

/**
 * Campaign, rebuilt on the original front-end art (docs 13 §2).
 *
 * Two authentic screens from `Timeline_60`:
 *   - **Campaign Select** (frame 7): the human/alien faces with their
 *     "Human / Easy" and "Alien / Hard" plates. Transparent hit zones cover the
 *     two halves, exactly where the FLA's `but_human`/`but_alien` sat.
 *   - **Human / Alien Campaign** (frame 13): the mission list (`but_list0..14`,
 *     one 4-state row sprite, 27.6px pitch) beside the preview panel
 *     (`img_map`, `txt_matchtitle`, `txt_desc`, the Match Type / Kills-to-Win /
 *     Map / Extra values, the `mc_type` badge and the `mc_diff` difficulty
 *     dots). Static labels are baked into the plate; the live texts are drawn
 *     here at the ink positions the original fields render at, and each row's
 *     four states come from the baked `but_list` art.
 */

const TYPE_NAMES: Record<string, string> = {
  dm: "Deathmatch",
  tdm: "Team Deathmatch",
  ctf: "Capture the Flag",
  dom: "Domination",
  jug: "Juggernaut",
  elim: "Elimination",
  telim: "Team Elimination",
};

/** Mode code → `mc_type` (DefineSprite_461) frame: 1 Deathmatch, 2 Elimination,
 *  3 Capture the Flag, 4 Domination, 5 Protection, 6 Juggernaught, 7 Bang yo'
 *  Mama, 8 None. Team modes share their solo icon — the SWF has no others. */
const TYPE_ICON: Record<string, number> = {
  dm: 1, elim: 2, ctf: 3, dom: 4, prot: 5, jug: 6, tdm: 1, telim: 2,
};

/** Total pips in the Raze 2 difficulty read-out (`overallDiff` is 1..9). */
const DIFF_DOTS = 9;

/** Mission-list geometry, from `but_list0..14` (frame 13). */
const ROW_X = 456;
const ROW_H = 26;
/** Bar body + left cap, from the `but_list` bar shapes (24.5 x 321.3 / x 27). */
const ROW_BAR_H = 24.5;
const ROW_CAP_W = 27;
const ROW_Y0 = 75.7;
const ROW_PITCH = 27.55;
/** Right margin of the list from the stage edge (SWF 800 − 779). */
const ROW_RIGHT = 21;

/** Row text offsets inside the row sprite, measured from the exported inks. */
const ROW_NUM_POS = { x: 12.4, y: 6.6 };
const ROW_TITLE_POS = { x: 37.9, y: 4.6 };

function overallDiffFor(num: number): number {
  const alien = num > 15;
  const idx = alien ? num - 16 : num - 1;
  const raw = (CAMPAIGN_DATA as any)[alien ? "alien" : "human"]?.[idx];
  return Math.max(1, Math.min(DIFF_DOTS, Number(raw?.overallDiff) || 1));
}

interface Row {
  num: number;
  view: Container;
  /** Bar/cap/selected-glow, drawn per state at the live row width. */
  art: Graphics;
  /** Baked padlock shown on locked rows, at its original offset. */
  lock: Sprite | null;
  numText: Text;
  titleText: Text;
  /** `but_list` state: 1 normal, 2 hover, 3 selected, 4 locked. */
  state: number;
}

/**
 * Which of the two frames to open on, so navigating *between* them can go
 * through `Engine.setScreen` and get the same slide every other menu move does.
 *
 * `Menu.as` treats them as two frames of one clip and moves with
 * `Transition.slideLeft(menfr, "Human Campaign")` (970) / `"Alien Campaign"`
 * (981) — the same call the Menu→Armory and Menu→Campaign-Select navigations
 * use. The port had them as two layers inside one screen toggled by
 * `visible`, which is why picking a side cut straight to the mission list.
 */
export interface CampaignArg {
  view?: "select" | "list";
  alien?: boolean;
  selected?: number;
}

export class CampaignScreen extends Screen {
  private alien = false;
  private selected = SD.curStage;
  private rows: Row[] = [];
  /** Live row width in SWF units (the list spans panel → right margin). */
  private rowWidth = 322.8;

  private selectLayer!: Container;
  private listLayer!: Container;
  private listChrome!: ScreenChrome;

  // Preview fields.
  private previewImg!: Container;
  private titleField!: Text;
  private descField!: Text;
  private typeField!: Text;
  private scoreLabelField!: Text;
  private scoreField!: Text;
  private mapField!: Text;
  private extraField!: Text;
  private diffDots!: Graphics;
  private typeIconHolder!: Container;

  private startBtn!: Raze2Button;
  private titleFieldHead!: Text;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    // `alien` has to be settled before buildList, which stamps each row's
    // absolute stage number from `base()`.
    const arg = (args[1] ?? {}) as CampaignArg;
    this.alien = arg.alien ?? SD.curStage > 15;
    this.selected = arg.selected ?? this.selected;
    if (this.selected < 1) this.selected = 1;

    this.view.addChild(makeBackground(Backgrounds.getTexture("jungle"), 0x0d1014));

    this.buildSelect();
    this.buildList();
    this.refresh();
    this.show(arg.view ?? "select");
  }

  private base(): number {
    return this.alien ? 16 : 1;
  }

  /** Show one of the two authentic screens. */
  private show(v: "select" | "list"): void {
    if (this.selectLayer) this.selectLayer.visible = v === "select";
    if (this.listLayer) this.listLayer.visible = v === "list";
    if (v === "list") this.refresh();
  }

  // --- campaign select (frame 7) -----------------------------------------

  private buildSelect(): void {
    // The two faces and the chrome between them are one 800x600 composition.
    // They used to be pinned to the stage edges with `cs_mid` stretched across
    // whatever was left, on the theory that the picture should follow the
    // window — but that only holds for art with nothing in the middle. Here the
    // connector IS the middle, so on a 16:9 window it drew as a 500px smear of
    // a 160px strip with the faces marooned either side of it.
    //
    // So the composition keeps its authored aspect and centres, and the window
    // gets wider around it rather than through it. The click zones still take
    // the full stage width: `but_human`/`but_alien` each covered half the
    // screen, and there is nothing else out there to click.
    const layer = new Container();
    this.selectLayer = layer;
    this.view.addChild(layer);

    const s = Math.min(GAME_HEIGHT / 600, GAME_WIDTH / 800);
    const stageW = 800 * s;
    const ox = Math.round((GAME_WIDTH - stageW) / 2);
    const y = Math.round((GAME_HEIGHT - 600 * s) / 2);

    const add = (name: string, x: number): void => {
      const meta = UiArt.meta(name);
      const tex = UiArt.r2(name);
      if (!meta || !tex) return;
      const sp = new Sprite(tex);
      sp.scale.set(s / meta.scale);
      sp.position.set(Math.round(ox + x), y);
      layer.addChild(sp);
    };
    add("cs_human", 0);
    add("cs_alien", stageW - 420 * s);

    // The connector strip spans the authored 320..480 gap, so at the authored
    // aspect this is 1:1 and nothing is smeared.
    const midMeta = UiArt.meta("cs_mid");
    const midTex = UiArt.r2("cs_mid");
    if (midMeta && midTex) {
      const mid = new Sprite(midTex);
      mid.scale.y = s / midMeta.scale;
      mid.scale.x = (stageW - 640 * s) / (160 * midMeta.scale);
      mid.position.set(Math.round(ox + 320 * s), y);
      layer.addChild(mid);
    }

    // Original `but_human` / `but_alien` covered each half of the screen.
    const zone = (x: number, w: number, alien: boolean) => {
      const g = new Graphics();
      g.rect(x, 0, w, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.001 });
      g.eventMode = "static";
      g.cursor = "pointer";
      g.on("pointerover", () => Sound.play("R2_Click"));
      g.on("pointertap", () => this.enterCampaign(alien));
      layer.addChild(g);
    };
    const half = Math.round(GAME_WIDTH / 2);
    zone(0, half, false);
    zone(half, GAME_WIDTH - half, true);

    // Native 245x28 SWF px carried to screen by `view.scale` (see the list
    // screen's bottom bar), pinned to the letterboxed art rather than the
    // window so it tracks the faces on a non-4:3 stage.
    const back = new Raze2Button("Back to Menu", {
      width: 245, height: 28, fontSize: 14,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    back.view.scale.set(s);
    back.view.x = ox + 37 * s;
    back.view.y = y + 529.85 * s;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    layer.addChild(back.view);
  }

  private enterCampaign(alien: boolean): void {
    if (alien && !SD.alienUnlocked) {
      Sound.play("R2_Error");
      return;
    }
    Sound.play("R2_ClickGo");
    // `SD.curStage` is an absolute 1..30 stage: 1..15 human, 16..30 alien. Land
    // on the player's current stage for the chosen species (clamped into range).
    const selected = alien
      ? Math.min(30, Math.max(16, SD.curStage))
      : Math.min(15, Math.max(1, SD.curStage));
    // `Menu.as:970/981` — picking a side slides LEFT into that campaign, like
    // every other forward move in the menus.
    this.engine.setScreen(
      CampaignScreen, { view: "list", alien, selected } satisfies CampaignArg, "slideLeft",
    );
  }

  // --- human/alien campaign (frame 13) ------------------------------------

  private buildList(): void {
    const layer = new Container();
    this.listLayer = layer;
    this.view.addChild(layer);

    const L = addScreenChrome(layer, { header: "campaign_header", left: "campaign_left" });
    this.listChrome = L;

    // Header title (`txt_title`), centred on the stretched strip.
    this.titleFieldHead = new Text({
      text: "HUMAN CAMPAIGN",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: TITLE_SIZE,
        fontWeight: "700", letterSpacing: 3,
      }),
    });
    this.titleFieldHead.alpha = A_HEADER;
    this.titleFieldHead.anchor.set(0.5, 0);
    this.titleFieldHead.x = Math.round(L.stageW / (2 * L.s));
    this.titleFieldHead.y = TITLE_Y;
    L.headerRoot.addChild(this.titleFieldHead);

    // Left panel content (crop-local = SWF - (0,56)).
    const at = L.leftRoot;
    this.previewImg = new Container();
    this.previewImg.x = 49.9;
    this.previewImg.y = 19.1;
    at.addChild(this.previewImg);

    const value = (x: number, y: number, size = 13): Text => {
      const t = new Text({
        text: "",
        style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: size }),
      });
      t.alpha = A_VALUE;
      t.x = x; t.y = y;
      at.addChild(t);
      return t;
    };

    this.titleField = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 15,
        fontWeight: "700", letterSpacing: 1,
      }),
    });
    this.titleField.alpha = A_HEADER;
    this.titleField.anchor.set(0.5, 0);
    this.titleField.x = 226;
    this.titleField.y = 151.2;
    at.addChild(this.titleField);

    this.descField = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_BODY, fontSize: 12,
        wordWrap: true, wordWrapWidth: 372, lineHeight: 15,
      }),
    });
    this.descField.alpha = A_BODY;
    this.descField.x = 49;
    this.descField.y = 172;
    at.addChild(this.descField);

    // Stat rows: the value column sits at 204 (the fields' rendered ink; the
    // FLA origins carry a left inset), and `Extra` stacks over its value.
    this.typeField = value(204.6, 266.9);
    this.scoreLabelField = value(53.1, 288.9);
    this.scoreField = value(204.1, 289.9);
    this.mapField = value(204.6, 312.8);
    this.extraField = value(53.1, 358.45);

    this.typeIconHolder = new Container();
    this.typeIconHolder.x = 178.8;
    this.typeIconHolder.y = 262.9;
    at.addChild(this.typeIconHolder);

    this.diffDots = new Graphics();
    this.diffDots.x = 204.1;
    this.diffDots.y = 432.5;
    at.addChild(this.diffDots);

    // Mission rows (`but_list0..14`): the list starts right after the left
    // panel (435 + 21 gutter) and runs to the 21px right margin, so it fills
    // the live stage instead of leaving a hole in the middle.
    const rowX = ROW_X * L.s;
    const rowW = Math.max(200, L.stageW - ROW_RIGHT * L.s - rowX);
    this.rowWidth = rowW / L.s;
    for (let i = 0; i < 15; i++) {
      const view = new Container();
      view.scale.set(L.s);
      view.x = Math.round(rowX);
      view.y = Math.round(L.headerH + (ROW_Y0 + i * ROW_PITCH - 56) * L.s);
      view.eventMode = "static";
      view.cursor = "pointer";
      view.hitArea = new Rectangle(0, 0, this.rowWidth, ROW_H);

      const art = new Graphics();
      view.addChild(art);
      const lock = UiArt.r2Sprite("row_lock");
      if (lock) {
        lock.visible = false;
        view.addChild(lock);
      }

      const style = (): TextStyle =>
        new TextStyle({ fill: C_NORMAL, fontFamily: FONT_VALUE, fontSize: 13 });
      const numText = new Text({ text: "", style: style() });
      numText.alpha = A_BODY;
      numText.position.set(ROW_NUM_POS.x, ROW_NUM_POS.y);
      const titleText = new Text({ text: "", style: style() });
      titleText.alpha = A_BODY;
      titleText.position.set(ROW_TITLE_POS.x, ROW_TITLE_POS.y);
      view.addChild(numText, titleText);

      const row: Row = { num: this.base() + i, view, art, lock, numText, titleText, state: 1 };
      view.on("pointerover", () => {
        Sound.play("R2_Click");
        if (row.state === 1) this.setRowState(row, 2);
      });
      view.on("pointerout", () => {
        if (row.state === 2) this.setRowState(row, 1);
      });
      view.on("pointertap", () => this.pick(row.num));

      layer.addChild(view);
      this.rows.push(row);
    }

    // Bottom bar: Back to select (left) / Upgrades + Start Game (right).
    //
    // Same geometry as the Quick Match bar, and for the same reasons: the plate
    // is baked at its native 245x28 **SWF** px, so a button parented to the
    // unscaled layer has to take its size through `view.scale` rather than by
    // pre-multiplying width/height (which stretches the plate and leaves the
    // label behind). `btn_*` placements on frame 13 are the plates' *centres*
    // — Back 543.85 -> 529.85, Upgrades 521.85 -> 507.85, Start 548.85 ->
    // 534.85 — and `bottomY` is SWF y 516. The right pair are the mirrored
    // `MenuButtonReverse` plate, so their labels are right-aligned.
    const { s, bottomY } = L;
    const btnW = 245, btnH = 28, btnFont = 14;
    const place = (b: Raze2Button, x: number, y: number): void => {
      b.view.scale.set(s);
      b.view.x = x;
      b.view.y = y;
      b.view.on("pointerover", () => Sound.play("R2_Click"));
      layer.addChild(b.view);
    };

    const back = new Raze2Button("Back", {
      width: btnW, height: btnH, fontSize: btnFont,
      // Back out the way we came in — `Menu.as` pairs every slideLeft with a
      // slideRight on the return leg (e.g. 1625/1636, Armory→Purchase→Armory).
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(
          CampaignScreen, { view: "select", alien: this.alien } satisfies CampaignArg, "slideRight",
        );
      },
    });
    place(back, L.ox + 37 * s, bottomY + 13.85 * s);

    const rightX = L.ox + L.stageW - 281.9 * s;
    const upgrades = new Raze2Button("Upgrades", {
      width: btnW, height: btnH, fontSize: btnFont, reverse: true,
      onClick: () => {
        Sound.play("R2_Click");
        this.engine.setScreen(ArmoryScreen, undefined, "slideLeft");
      },
    });
    place(upgrades, rightX, bottomY - 8.15 * s);

    this.startBtn = new Raze2Button("Start Game", {
      width: btnW, height: btnH, fontSize: btnFont, reverse: true,
      onClick: () => void this.launch(),
    });
    place(this.startBtn, rightX, bottomY + 18.85 * s);
  }

  private pick(num: number): void {
    if (num > SD.curStage) {
      Sound.play("R2_Error");
      return;
    }
    Sound.play("R2_Click");
    this.selected = num;
    this.refresh();
  }

  // --- painting ----------------------------------------------------------

  private refresh(): void {
    this.titleFieldHead.text = this.alien ? "ALIEN CAMPAIGN" : "HUMAN CAMPAIGN";

    for (const row of this.rows) this.paintRow(row);
    this.paintPreview();
  }

  private paintRow(row: Row): void {
    const num = row.num;
    const locked = num > SD.curStage;
    const isSel = num === this.selected;
    const entry = getCamp(num);
    const localNum = this.alien ? num - 15 : num;

    if (locked) {
      // Source copy uses the *local* mission number (Menu.as: "Beat level " +
      // i, the row's 0-based index) — the alien list numbers 1..15 like the
      // human one, it does not read 20+.
      row.numText.text = "";
      row.titleText.text = `Beat level ${localNum - 1} to unlock`;
      row.titleText.style.fill = C_LOCKED;
      row.state = 4;
    } else {
      row.numText.text = `${localNum}.`;
      row.titleText.text = entry?.settings.matchName ?? `Mission ${localNum}`;
      row.titleText.style.fill = isSel ? C_SELECTED : C_NORMAL;
      row.state = isSel ? 3 : row.state === 2 ? 2 : 1;
    }
    this.setRowArt(row);
  }

  /** Show one of the baked `but_list` states (also the headless-test fallback). */
  private setRowState(row: Row, state: number): void {
    row.state = state;
    this.setRowArt(row);
  }

  /** Redraw a row's `but_list` state at the live width. The bar and cap are
   *  plain translucent rects in the source (shape alphas 0.2 / 0.298); the
   *  hover and selected frames are alpha copies (0.65 / 0.4), and the selected
   *  frame's green edge is a 1.5px `#66cc99` stroke at 20% fading out. */
  private setRowArt(row: Row): void {
    const w = this.rowWidth;
    const g = row.art;
    g.clear();
    const barAlpha = row.state === 3 ? 0.4 : row.state === 2 ? 0.65 : 0.2;
    g.rect(0, 0, w, ROW_BAR_H).fill({ color: 0x000000, alpha: barAlpha });
    g.rect(0, 0, ROW_CAP_W, ROW_BAR_H).fill({ color: 0x000000, alpha: 0.298 });
    if (row.state === 3) {
      g.rect(-0.75, -0.75, w + 1.5, ROW_BAR_H + 1.5)
        .stroke({ color: 0x66cc99, width: 1.5, alpha: 0.18 });
    }
    if (row.lock) row.lock.visible = row.state === 4;
  }

  private paintPreview(): void {
    const entry = getCamp(this.selected);
    const locked = this.selected > SD.curStage;
    this.startBtn?.setEnabled(!locked);

    this.previewImg.removeChildren();
    if (!entry) {
      this.titleField.text = "No mission data";
      this.descField.text = "";
      return;
    }

    const s = entry.settings;
    const levelName = LEVELS.find((l) => l.id === s.level)?.name ?? String(s.level);

    // The original `img_map` plays the map's own screenshot (one frame per
    // `Stats_Maps` id). Port level ids are `r2_<map>`; strip the prefix.
    const mapLabel = String(s.level).replace(/^r2_/, "");
    const shot = UiArt.r2Sprite(`map_${mapLabel}`);
    if (shot) {
      this.previewImg.addChild(shot);
    } else {
      const tex = Backgrounds.getThumb(s.level);
      if (tex) {
        const spr = new Sprite(tex);
        spr.width = 360.44;
        spr.height = 128;
        this.previewImg.addChild(spr);
      } else {
        const g = new Graphics();
        g.rect(0, 0, 360.44, 128).fill({ color: 0x101820, alpha: 0.9 });
        this.previewImg.addChild(g);
      }
    }

    this.titleField.text = s.matchName ?? `Mission ${entry.num}`;
    this.descField.text = s.matchDesc ?? "";

    this.typeField.text = TYPE_NAMES[s.type] ?? s.type;
    this.typeIconHolder.removeChildren();
    const icon = UiArt.r2Sprite(`type_icon_${TYPE_ICON[s.type] ?? 8}`);
    if (icon) this.typeIconHolder.addChild(icon);

    const isElim = s.type === "elim" || s.type === "telim";
    this.scoreLabelField.text =
      s.type === "dom" || s.type === "ctf" ? "Points to Win"
        : isElim ? "Lives"
          : "Kills to Win";
    this.scoreField.text = String(isElim ? s.lives : s.score);

    this.mapField.text = levelName;
    this.extraField.text = "None";
    this.extraField.style.fill = C_VALUE;

    const dots = overallDiffFor(this.selected);
    this.diffDots.clear();
    for (let i = 0; i < DIFF_DOTS; i++) {
      this.diffDots
        .circle(i * 16.7, 0, 4.5)
        .fill({ color: i < dots ? C_OPTIONS_GREEN : 0x555555, alpha: i < dots ? 1 : 0.6 });
    }
  }

  // --- launch ------------------------------------------------------------

  private async launch(): Promise<void> {
    const entry = getCamp(this.selected);
    if (!entry || this.selected > SD.curStage) {
      Sound.play("R2_Error");
      return;
    }
    Sound.resume();
    Sound.play("R2_ClickGo");

    const avgDiff =
      entry.ai.length > 0
        ? entry.ai.reduce((sum, a) => sum + a.diff, 0) / entry.ai.length
        : 1;

    SD.matchSettings = {
      ...entry.settings,
      diff: avgDiff,
      opponents: entry.ai.length,
      team: entry.settings.team ? 1 : 0,
    };
    SD.curCampaign = this.selected <= 15 ? "human" : "alien";

    const reel = getCutscene(this.selected, "pre");
    if (reel) {
      this.view.addChild(makeVeil("LOADING…"));
      await loadPanels(reel.panels);
      this.engine.setScreen(CutsceneScreen, { reel });
      return;
    }

    Sound.stopMusic();
    this.view.addChild(makeVeil("LOADING MAP…"));
    await preloadLevel(String(entry.settings.level));
    this.engine.setScreen(GameScreen);
  }

  enterFrame(): void {
    // Static selection screen.
  }
}
