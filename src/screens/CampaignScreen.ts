import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { Backgrounds } from "../assets/Backgrounds";
import { LEVELS } from "../game/Arena";
import { getCamp } from "../game/Campaign";
import { getCutscene, loadPanels } from "../game/Cutscene";
import { GameScreen } from "../game/GameScreen";
import { CutsceneScreen } from "./CutsceneScreen";
import { preloadLevel } from "../game/Arena";
import CAMPAIGN_DATA from "../assets/raze2/campaign.json";
import { makeBackground, makeScrim, makeVeil } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { ArmoryScreen } from "./ArmoryScreen";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_NORMAL,
  C_SELECTED,
  C_LOCKED,
  C_VALUE,
  C_OPTIONS_GREEN,
  C_ACCENT_UPGRADE,
  A_HEADER,
  A_VALUE,
  A_BODY,
} from "../ui/raze2";

/**
 * Campaign select, restyled to Raze 2 (doc 13 §2). A "HUMAN CAMPAIGN" /
 * "ALIEN CAMPAIGN" header with a tab to switch species, a right-side mission
 * list (unlocked rows read "N. Title", locked rows show a padlock + "Beat level
 * N to unlock" in `#CCCCCC`, the selected row in `#FFFFCC`), and a left preview
 * panel with the map screenshot, title, description and the Match Type / Kills
 * to Win / Map / Extra / Difficulty read-outs. A bottom bar offers Back to Menu
 * / Upgrades / Start Game.
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

/** Total pips in the Raze 2 difficulty read-out (`overallDiff` is 1..9, doc 10 §2.3). */
const DIFF_DOTS = 9;

/**
 * The scripted `overallDiff` (1..9) straight from the extracted mission data
 * (`Stats_Campaign.as` via `campaign.json`) — the same source `getCamp()`
 * reads, just pulling the one field the port's `CampaignSettings` shape
 * doesn't carry through. Falls back to 1 if the stage index is out of range.
 */
function overallDiffFor(num: number): number {
  const alien = num > 15;
  const idx = alien ? num - 16 : num - 1;
  const raw = (CAMPAIGN_DATA as any)[alien ? "alien" : "human"]?.[idx];
  return Math.max(1, Math.min(DIFF_DOTS, Number(raw?.overallDiff) || 1));
}

interface Row {
  num: number;
  bg: Graphics;
  numText: Text;
  titleText: Text;
  lock: Text;
}

export class CampaignScreen extends Screen {
  private alien = false;
  private selected = SD.curStage;
  private rows: Row[] = [];

  private humanTab!: Raze2Button;
  private alienTab!: Raze2Button;
  private headerText!: Text;

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

  private startBtn!: Raze2Button;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.alien = SD.curStage > 15;
    if (this.selected < 1) this.selected = 1;

    this.view.addChild(makeBackground(UiArt.getTexture("play"), 0x0d1014));
    this.view.addChild(makeScrim(0x000000, 0.55));

    this.buildHeader();
    this.buildPreviewPanel();
    this.buildMissionList();
    this.buildBottomBar();

    this.refresh();
  }

  private base(): number {
    return this.alien ? 16 : 1;
  }

  // --- header + campaign tabs --------------------------------------------

  private buildHeader(): void {
    this.headerText = new Text({
      text: "HUMAN CAMPAIGN",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 30,
        fontWeight: "700",
        letterSpacing: 3,
      }),
    });
    this.headerText.alpha = A_HEADER;
    this.headerText.x = 60;
    this.headerText.y = 34;
    this.view.addChild(this.headerText);

    // Both tabs sit inside the same 60px margin the header, preview panel and
    // mission list use, instead of overhanging it by 30px.
    const tabW = 130;
    const alienX = GAME_WIDTH - 60 - tabW;

    this.humanTab = new Raze2Button("Human", {
      width: tabW,
      height: 34,
      onClick: () => this.switchCampaign(false),
    });
    this.humanTab.view.x = alienX - 10 - tabW;
    this.humanTab.view.y = 34;
    this.view.addChild(this.humanTab.view);

    this.alienTab = new Raze2Button("Alien", {
      width: tabW,
      height: 34,
      onClick: () => this.switchCampaign(true),
    });
    this.alienTab.view.x = alienX;
    this.alienTab.view.y = 34;
    this.alienTab.setEnabled(SD.alienUnlocked);
    this.view.addChild(this.alienTab.view);
  }

  private switchCampaign(alien: boolean): void {
    if (alien && !SD.alienUnlocked) {
      Sound.play("R2_Error");
      return;
    }
    if (this.alien === alien) return;
    Sound.play("R2_Click");
    this.alien = alien;
    this.selected = this.base();
    for (let i = 0; i < this.rows.length; i++) this.rows[i].num = this.base() + i;
    this.refresh();
  }

  // --- preview panel (left) ----------------------------------------------

  private buildPreviewPanel(): void {
    const x = 60;
    const y = 90;
    const w = 440;
    const h = 470;

    const panel = new Raze2Panel(w, h, { accent: C_OPTIONS_GREEN });
    panel.view.x = x;
    panel.view.y = y;
    this.view.addChild(panel.view);

    // Screenshot holder.
    this.previewImg = new Container();
    this.previewImg.x = x + 20;
    this.previewImg.y = y + 20;
    this.view.addChild(this.previewImg);

    this.titleField = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 20,
        fontWeight: "700",
        letterSpacing: 1,
      }),
    });
    this.titleField.alpha = A_HEADER;
    this.titleField.x = x + 20;
    this.titleField.y = y + 215;
    this.view.addChild(this.titleField);

    this.descField = new Text({
      text: "",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_BODY,
        fontSize: 13,
        wordWrap: true,
        wordWrapWidth: w - 40,
        lineHeight: 18,
      }),
    });
    this.descField.alpha = A_BODY;
    this.descField.x = x + 20;
    this.descField.y = y + 245;
    this.view.addChild(this.descField);

    // Stat read-outs.
    const statY = y + 330;
    this.typeField = this.stat("Match Type", x + 20, statY);
    this.scoreLabelField = this.statLabel("Kills to Win", x + 20, statY + 26);
    this.scoreField = this.statValueAt(x + 20, statY + 26);
    this.mapField = this.stat("Map", x + 20, statY + 52);
    this.extraField = this.stat("Extra", x + 20, statY + 78);

    // Difficulty label + dots.
    this.statLabel("Difficulty", x + 20, statY + 104);
    this.diffDots = new Graphics();
    this.diffDots.x = x + 160;
    this.diffDots.y = statY + 104 + 8;
    this.view.addChild(this.diffDots);
  }

  /** A "Label   value" stat line; returns the value Text. */
  private stat(label: string, x: number, y: number): Text {
    this.statLabel(label, x, y);
    return this.statValueAt(x, y);
  }

  private statLabel(label: string, x: number, y: number): Text {
    const t = new Text({
      text: label,
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 13 }),
    });
    t.alpha = 0.6;
    t.x = x;
    t.y = y;
    this.view.addChild(t);
    return t;
  }

  private statValueAt(x: number, y: number): Text {
    const t = new Text({
      text: "",
      style: new TextStyle({ fill: C_VALUE, fontFamily: FONT_VALUE, fontSize: 14 }),
    });
    t.alpha = A_VALUE;
    t.x = x + 140;
    t.y = y;
    this.view.addChild(t);
    return t;
  }

  // --- mission list (right) ----------------------------------------------

  private buildMissionList(): void {
    const x = 540;
    const y = 96;
    const w = GAME_WIDTH - x - 60;
    const pitch = 30;

    for (let i = 0; i < 15; i++) {
      const num = this.base() + i;
      const rowY = y + i * pitch;

      const c = new Container();
      c.x = x;
      c.y = rowY;

      const bg = new Graphics();
      c.addChild(bg);

      const numText = new Text({
        text: "",
        style: new TextStyle({ fill: C_NORMAL, fontFamily: FONT_VALUE, fontSize: 15 }),
      });
      numText.x = 10;
      numText.y = 6;
      c.addChild(numText);

      const titleText = new Text({
        text: "",
        style: new TextStyle({ fill: C_NORMAL, fontFamily: FONT_VALUE, fontSize: 15 }),
      });
      titleText.x = 44;
      titleText.y = 6;
      c.addChild(titleText);

      const lock = new Text({
        text: "🔒",
        style: new TextStyle({ fill: C_LOCKED, fontFamily: FONT_VALUE, fontSize: 14 }),
      });
      lock.anchor.set(1, 0);
      lock.x = w - 10;
      lock.y = 6;
      lock.visible = false;
      c.addChild(lock);

      const row: Row = { num, bg, numText, titleText, lock };

      c.eventMode = "static";
      c.cursor = "pointer";
      c.on("pointerover", () => Sound.play("R2_Click"));
      c.on("pointertap", () => this.pick(row.num));

      this.rows.push(row);
      this.view.addChild(c);

      // Stash width on the bg for repaint.
      (bg as Graphics & { rowW: number }).rowW = w;
    }
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

  // --- bottom bar --------------------------------------------------------

  private buildBottomBar(): void {
    const y = GAME_HEIGHT - 52;

    // This screen *is* the campaign select, so Back leaves for the main menu —
    // the button used to be labelled "Back to Campaign Select" (and sized for
    // that much longer string) while doing exactly this.
    const back = new Raze2Button("Back to Menu", {
      width: 220,
      height: 40,
      onClick: () => {
        Sound.play("R2_ClickBack");
        this.engine.setScreen(MenuScreen, undefined, "slideRight");
      },
    });
    back.view.x = 60;
    back.view.y = y;
    back.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(back.view);

    const startW = 240;
    const upgradesW = 200;
    const startX = GAME_WIDTH - 60 - startW;

    const upgrades = new Raze2Button("Upgrades", {
      width: upgradesW,
      height: 40,
      accent: C_ACCENT_UPGRADE,
      onClick: () => {
        Sound.play("R2_Click");
        this.engine.setScreen(ArmoryScreen, undefined, "slideLeft");
      },
    });
    upgrades.view.x = startX - 20 - upgradesW;
    upgrades.view.y = y;
    upgrades.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(upgrades.view);

    this.startBtn = new Raze2Button("Start Game", {
      width: startW,
      height: 40,
      accent: C_OPTIONS_GREEN,
      onClick: () => void this.launch(),
    });
    this.startBtn.view.x = startX;
    this.startBtn.view.y = y;
    this.startBtn.view.on("pointerover", () => Sound.play("R2_Click"));
    this.view.addChild(this.startBtn.view);
  }

  // --- painting ----------------------------------------------------------

  private refresh(): void {
    this.headerText.text = this.alien ? "ALIEN CAMPAIGN" : "HUMAN CAMPAIGN";
    this.humanTab.setSelected(!this.alien);
    this.alienTab.setSelected(this.alien);

    for (const row of this.rows) this.paintRow(row);
    this.paintPreview();
  }

  private paintRow(row: Row): void {
    const num = row.num;
    const locked = num > SD.curStage;
    const isSel = num === this.selected;
    const entry = getCamp(num);

    const bg = row.bg;
    const w = (bg as Graphics & { rowW: number }).rowW ?? 480;
    bg.clear();
    if (isSel) {
      bg.rect(0, 0, w, 26).fill({ color: C_OPTIONS_GREEN, alpha: 0.14 });
      bg.rect(0, 0, 3, 26).fill({ color: C_OPTIONS_GREEN, alpha: 0.9 });
    } else {
      bg.rect(0, 25, w, 1).fill({ color: 0xffffff, alpha: 0.08 });
    }

    const localNum = this.alien ? num - 15 : num;
    if (locked) {
      row.numText.text = "";
      row.titleText.text = `Beat level ${localNum - 1} to unlock`;
      row.titleText.style.fill = C_LOCKED;
      row.titleText.alpha = 0.85;
      row.lock.visible = true;
    } else {
      row.numText.text = `${localNum}.`;
      row.titleText.text = entry?.settings.matchName ?? `Mission ${localNum}`;
      row.titleText.style.fill = isSel ? C_SELECTED : C_NORMAL;
      row.titleText.alpha = isSel ? 1 : 0.85;
      row.numText.style.fill = isSel ? C_SELECTED : C_NORMAL;
      row.numText.alpha = isSel ? 1 : 0.85;
      row.lock.visible = false;
    }
  }

  private paintPreview(): void {
    const entry = getCamp(this.selected);
    const locked = this.selected > SD.curStage;
    this.startBtn.setEnabled(!locked);

    this.previewImg.removeChildren();
    if (!entry) {
      this.titleField.text = "No mission data";
      this.descField.text = "";
      return;
    }

    const s = entry.settings;
    const levelName = LEVELS.find((l) => l.id === s.level)?.name ?? String(s.level);

    // Screenshot (400x180). Try the level texture; fall back to a dark plate.
    const w = 400;
    const h = 180;
    const tex = Backgrounds.getThumb(s.level);
    if (tex) {
      const spr = new Sprite(tex);
      spr.width = w;
      spr.height = h;
      this.previewImg.addChild(spr);
    } else {
      const g = new Graphics();
      g.rect(0, 0, w, h).fill({ color: 0x101820, alpha: 0.9 });
      this.previewImg.addChild(g);
    }
    const frame = new Graphics();
    frame.rect(0, 0, w, h).stroke({ color: C_OPTIONS_GREEN, width: 1, alpha: 0.6 });
    this.previewImg.addChild(frame);

    this.titleField.text = s.matchName ?? `Mission ${entry.num}`;
    this.descField.text = s.matchDesc ?? "";

    this.typeField.text = TYPE_NAMES[s.type] ?? s.type;

    // Score label varies by mode. Elimination has no score cap at all — it ends
    // when one side is wiped out — so it reports the respawn allowance instead.
    const isElim = s.type === "elim" || s.type === "telim";
    this.scoreLabelField.text =
      s.type === "dom" || s.type === "ctf" ? "Points to Win"
        : isElim ? "Lives"
          : "Kills to Win";
    this.scoreField.text = String(isElim ? s.lives : s.score);

    this.mapField.text = levelName;

    // "Extra" (`MatchSettings.matchExtra`) isn't captured in the extracted
    // campaign data (doc 10 §2.3) — every mission the port can actually read
    // resets to "None", so show that rather than fabricating a weapon/roster
    // readout that doesn't correspond to the real field.
    this.extraField.text = "None";

    // Difficulty dots — the real per-mission `overallDiff` (1..9, doc 10 §2.3),
    // not a guess averaged from bot levels.
    const dots = overallDiffFor(this.selected);
    this.diffDots.clear();
    for (let i = 0; i < DIFF_DOTS; i++) {
      this.diffDots
        .circle(i * 14, 0, 4.5)
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

    // Missions with a pre-mission comic (`Stats_Campaign`'s `preCutFrames`)
    // read it before the match. CutsceneScreen streams the map in behind the
    // scene, so "Start Game" on its last page hands straight over.
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
