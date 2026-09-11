import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import { SD } from "../state/SD";
import { Sound } from "../audio/Sounds";
import { UiArt } from "../assets/UiArt";
import { makeBackground } from "./ui";
import { MenuScreen } from "./MenuScreen";
import { OptionsScreen } from "./OptionsScreen";
import {
  Raze2Button,
  Raze2Panel,
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  C_HEADER,
  C_BODY,
  A_HEADER,
  A_BODY,
  C_SCORE_TEAM,
  C_SCORE_GOLD,
  C_PANEL_FILL,
  C_PANEL_HAIRLINE,
  C_OPTIONS_GREEN,
} from "../ui/raze2";

/**
 * One scoreboard row descriptor. `team` uses the same indices as the rest of
 * the port (1 = blue, 2 = orange, 3 = yellow, 4 = green/FFA) — see doc 12 §2.6
 * for the `C_SCORE_TEAM` tri-tone family these rows are painted from.
 *
 * There are three row "kinds":
 *  - the plain `#/NAME/SCORE/KILLS/DEATHS` column-title header (`isHeader`),
 *  - a per-team banner row (`isBanner`, bright/100%-value team shade, team
 *    name + team total score, Kills/Deaths blank), and
 *  - an ordinary player/bot row (settled/50%-value team shade).
 */
export interface ScoreRow {
  rank: number | string;
  name: string;
  score: number | string;
  kills: number | string;
  deaths: number | string;
  team: number;
  /** Recently-dead → skull status icon (doc 12 §2.7, "Deathmatch" iconFrame). */
  dead?: boolean;
  /** Juggernaut status icon (doc 12 §2.7, "Juggernaught" iconFrame). */
  isJug?: boolean;
  /** Flag-carrier status icon (doc 12 §2.7, "Capture the Flag" iconFrame). */
  hasFlag?: boolean;
  /** AI rows are dimmed to 0.7 (doc 12 §2.4, `charAt(0) != "p"`). */
  ai?: boolean;
  /** Neutral `#/Name/Score/Kills/Deaths` column-title header row. */
  isHeader?: boolean;
  /** Team header banner row ("Blue Team" etc.), bright team shade. */
  isBanner?: boolean;
  /** Insert doc 12 §2.3's extra 5px gap above this row (before each new
   *  team's banner after the first). */
  gapBefore?: boolean;
}

const ROW_H = 30;
const TEAM_GAP = 5;
const TEAM_NAMES = ["Blue", "Orange", "Yellow", "Green"];
const SKULL = "☠"; // ☠ dead
const JUG_ICON = "♚"; // ♚ juggernaut crown
const FLAG_ICON = "⚑"; // ⚑ flag carrier

/** The settled/50%-value shade a plain row is painted with; bright/100% for
 *  team banners. Falls back to the "Green/FFA" family for team 0/undefined. */
function rowShade(team: number, bright: boolean): number {
  const fam = (C_SCORE_TEAM as any)[team] ?? C_SCORE_TEAM[4];
  return bright ? fam[0] : fam[2];
}

/**
 * Reusable Raze 2 scoreboard table (doc 12 §2.3-2.6). Renders the neutral
 * column-title header, then one row per entry — either a bright team banner
 * or a settled-shade player/bot row — with the Score column always pale gold,
 * a per-row status icon, alternating row striping and the 30px/+5px row
 * pitch rules from `displayScoreBars()`. Exported so the pause menu's "View
 * Scores" panel can reuse the exact same component.
 */
export class ScoreBoard {
  readonly view = new Container();
  /** Total rendered height (header + all rows/gaps), for panel sizing. */
  readonly totalHeight: number;
  private readonly width: number;

  constructor(width: number, rows: ScoreRow[], opts: { headerLabel?: string } = {}) {
    this.width = width;
    const headerLabel = opts.headerLabel ?? "SCORE";

    this.view.addChild(this.buildRow({
      rank: "#", name: "NAME", score: headerLabel, kills: "KILLS", deaths: "DEATHS",
      team: 0, isHeader: true,
    }, 0, 0));

    let y = ROW_H;
    let dataIndex = 0;
    for (const row of rows) {
      if (row.gapBefore) y += TEAM_GAP;
      const zebra = row.isHeader || row.isBanner ? 0 : dataIndex++;
      this.view.addChild(this.buildRow(row, y, zebra));
      y += ROW_H;
    }
    this.totalHeight = y;
  }

  private col(frac: number): number {
    return Math.round(this.width * frac);
  }

  private buildRow(row: ScoreRow, y: number, zebra: number): Container {
    const c = new Container();
    c.y = y;

    const bg = new Graphics();
    if (row.isHeader) {
      // Neutral "h0" column-title header — near-black, doc 12 §2.6.
      bg.rect(0, 0, this.width, ROW_H).fill({ color: C_PANEL_FILL, alpha: 0.9 });
      bg.rect(0, ROW_H - 1, this.width, 1).fill({ color: C_PANEL_HAIRLINE, alpha: 0.9 });
    } else {
      const shade = rowShade(row.team, !!row.isBanner);
      // Two stacked flat fills + a lighter mid-band, approximating the
      // source's soft vertical gradient banner (doc 12 §2.5).
      bg.rect(0, 0, this.width, ROW_H).fill({ color: shade, alpha: 0.298 });
      bg.rect(0, ROW_H * 0.18, this.width, ROW_H * 0.64).fill({ color: shade, alpha: 0.498 });
      bg.rect(0, 0, this.width, ROW_H).stroke({ color: shade, width: 1, alpha: 0.6 });
      // Alternating row striping for plain rows only.
      if (!row.isBanner && zebra % 2 === 1) {
        bg.rect(0, 0, this.width, ROW_H).fill({ color: 0x000000, alpha: 0.16 });
      }
    }
    c.addChild(bg);

    const fill = row.isHeader || row.isBanner ? C_HEADER : 0xffffff;
    const alpha = row.isHeader ? A_HEADER : row.ai ? 0.7 : 1;
    const font = row.isHeader || row.isBanner ? FONT_HEADER : FONT_VALUE;
    const size = row.isHeader ? 14 : row.isBanner ? 16 : 15;

    const cell = (text: string, x: number, anchor = 0, colorOverride?: number): Text => {
      const t = new Text({
        text,
        style: new TextStyle({
          fill: colorOverride ?? fill,
          fontFamily: font,
          fontSize: size,
          fontWeight: row.isHeader || row.isBanner ? "700" : "400",
          letterSpacing: row.isHeader ? 1 : 0,
        }),
      });
      t.anchor.set(anchor, 0.5);
      t.x = x;
      t.y = ROW_H / 2;
      t.alpha = alpha;
      c.addChild(t);
      return t;
    };

    // Score column is always pale gold (doc 12 §2.5), even for header/banner.
    const scoreColor = C_SCORE_GOLD;

    if (!row.isBanner) cell(String(row.rank), this.col(0.03));
    cell(row.name, this.col(0.10));
    cell(String(row.score), this.col(0.60), 1, scoreColor);
    cell(String(row.kills), this.col(0.76), 1);
    cell(String(row.deaths), this.col(0.90), 1);

    if (!row.isHeader && !row.isBanner) {
      const icon = row.hasFlag ? FLAG_ICON : row.isJug ? JUG_ICON : row.dead ? SKULL : "";
      if (icon) {
        const s = cell(icon, this.col(0.97));
        s.style.fill = 0xffffff;
      }
    }

    return c;
  }
}

/**
 * Standalone View Scores screen — mirrors the pause menu's "View Scores" tab
 * (doc 12 §2.2): a left column with the mission title/blurb and the four
 * persistent pause buttons (View Scores shown as the current/selected tab),
 * and the scoreboard table on the right, built from the reusable
 * {@link ScoreBoard} component. There is no live match in the menu context, so
 * the table demonstrates the team-banner layout with representative rows.
 */
export class ScoresScreen extends Screen {
  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    this.view.addChild(makeBackground(UiArt.getTexture("menu"), 0x0d1014));

    const title = new Text({
      text: "VIEW SCORES",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 30,
        fontWeight: "700",
        letterSpacing: 3,
      }),
    });
    title.alpha = A_HEADER;
    title.anchor.set(0.5, 0);
    title.x = GAME_WIDTH / 2;
    title.y = 30;
    this.view.addChild(title);

    // --- left column: mission title/blurb + the persistent pause buttons ---
    const BX = 60;
    let ly = 96;

    const mTitle = new Text({
      text: SD.matchSettings.matchName || "Quick Match",
      style: new TextStyle({
        fill: C_HEADER, fontFamily: FONT_HEADER, fontSize: 20,
        fontWeight: "700", letterSpacing: 1,
      }),
    });
    mTitle.alpha = A_HEADER;
    mTitle.x = BX; mTitle.y = ly;
    this.view.addChild(mTitle);
    ly += 30;

    const desc = SD.matchSettings.matchDesc || "A quick, unranked skirmish.";
    const mDesc = new Text({
      text: desc,
      style: new TextStyle({
        fill: C_BODY, fontFamily: FONT_BODY, fontSize: 13,
        wordWrap: true, wordWrapWidth: 220, lineHeight: 17,
      }),
    });
    mDesc.alpha = A_BODY;
    mDesc.x = BX; mDesc.y = ly;
    this.view.addChild(mDesc);
    ly += mDesc.height + 24;

    let by = Math.max(ly, 190);
    const stack: [string, (() => void) | undefined, boolean][] = [
      ["Resume Game", () => { Sound.play("R2_ClickBack"); this.engine.setScreen(MenuScreen, undefined, "slideRight"); }, false],
      ["View Scores", undefined, true],
      ["Options", () => { Sound.play("R2_Click"); this.engine.setScreen(OptionsScreen, undefined, "slideLeft"); }, false],
      ["Quit Game", () => { Sound.play("R2_ClickGo"); this.engine.setScreen(MenuScreen); }, false],
    ];
    for (const [label, onClick, selected] of stack) {
      const btn = new Raze2Button(label, { width: 240, height: 40, onClick });
      btn.view.x = BX; btn.view.y = by;
      btn.setSelected(selected);
      btn.setEnabled(!selected);
      if (onClick) btn.view.on("pointerover", () => Sound.play("R2_Click"));
      this.view.addChild(btn.view);
      by += 52;
    }

    // --- right: the scoreboard table ---------------------------------------
    // The board fills the column right of the button stack out to the same 60px
    // margin the left column uses; it used to stop at 980 and leave a 140px
    // gutter against a 60px one on the left.
    const boardX = BX + 240 + 36;
    const boardY = 96;
    const boardW = GAME_WIDTH - 60 - 16 - boardX;

    const panel = new Raze2Panel(boardW + 32, GAME_HEIGHT - boardY - 48, { accent: C_OPTIONS_GREEN });
    panel.view.x = boardX - 16;
    panel.view.y = boardY - 16;
    this.view.addChild(panel.view);

    const rows: ScoreRow[] = [
      { rank: "", name: "Blue Team", score: 24, kills: "", deaths: "", team: 1, isBanner: true },
      {
        rank: 1,
        name: SD.profile?.name ?? "Player",
        score: SD.stats?.kills ?? 14,
        kills: SD.stats?.kills ?? 14,
        deaths: SD.stats?.deaths ?? 3,
        team: 1,
      },
      { rank: 2, name: "Zombie", score: 10, kills: 10, deaths: 6, team: 1, ai: true },
      { rank: 3, name: "Zombie", score: 7, kills: 7, deaths: 9, team: 1, ai: true, dead: true },
      { rank: "", name: "Orange Team", score: 17, kills: "", deaths: "", team: 2, isBanner: true, gapBefore: true },
      { rank: 1, name: "Zombie", score: 12, kills: 12, deaths: 4, team: 2, ai: true, isJug: true },
      { rank: 2, name: "Zombie", score: 5, kills: 5, deaths: 11, team: 2, ai: true, dead: true },
    ];

    const board = new ScoreBoard(boardW, rows);
    board.view.x = boardX;
    board.view.y = boardY;
    this.view.addChild(board.view);
  }

  enterFrame(): void {
    // Static scoreboard.
  }
}
