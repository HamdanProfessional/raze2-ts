/**
 * Raze 2 UI palette — every colour the restyled chrome (Pause / Options /
 * Scores / menus) uses, lifted directly from the SWF reference docs
 * (`docs/raze2/14-hud-chrome.md` §6 token table and `docs/raze2/13-ui-menus.md`
 * §"Color palette"). Values are exact runtime `textColor` / gradient stops from
 * the decompiled ActionScript and the swf2xml dump, not eyeballed.
 *
 * All colours are PixiJS-style `0xRRGGBB` number literals. Alpha is applied at
 * the draw site (see the `A_*` alpha constants) because the source encodes it
 * separately from the RGB triples.
 */

// --- text colours ----------------------------------------------------------

/** Screen/panel header text ("txt_title"). White, drawn at {@link A_HEADER}. */
export const C_HEADER = 0xffffff;
/** Button label text ("txt_word", BlairMdITC). White, drawn at {@link A_LABEL}. */
export const C_LABEL = 0xffffff;
/**
 * Button label over the inverted (white) bar — the `on` frame of `MenuButton_34`.
 * Near-black rather than pure black so it sits with the bar's soft gradient
 * instead of punching a hole in it. Hover does NOT use this: `btn_menu_over` is
 * still a black bar, so its label stays {@link C_LABEL}.
 */
export const C_LABEL_ON = 0x141414;
/** Body / description copy (Calibri fields). White, drawn at {@link A_BODY}. */
export const C_BODY = 0xffffff;
/** Value / numeric read-out fields (QTypeSquare). White @ {@link A_VALUE}. */
export const C_VALUE = 0xffffff;

/** Normal / unselected list row (menu lists, `Menu.as:1650`). */
export const C_NORMAL = 0xffffff;
/** Selected / current list row (`Menu.as:1678`). Pale warm yellow. */
export const C_SELECTED = 0xffffcc;
/** Locked / unavailable row (`Menu.as:216,233`). Light grey. */
export const C_LOCKED = 0xcccccc;
/** Unselected option label, mouse NOT over (Options, `PauseScreen.as:294`). */
export const C_DIM = 0x999999;
/** Unselected option label, mouse hovering. Bright white. */
export const C_HOVER = 0xffffff;
/** Warning / penalty notice text (`Menu.as` Quick Match warning). Salmon. */
export const C_WARNING = 0xff9999;

// --- status text colours (menu purchase/status states) ---------------------

/** "owned / equipped" status. Pale green (`Menu.as:1769`). */
export const C_STATUS_OWNED = 0xccffcc;
/** "can afford" status. Pale cyan (`Menu.as:1798`). */
export const C_STATUS_AFFORD = 0xccffff;
/** "selected / new" status. Pale pink (`Menu.as:1305`). */
export const C_STATUS_NEW = 0xffcccc;
/** "locked / other" status. Pale purple (`Menu.as:2309`). */
export const C_STATUS_LOCKED = 0xcea6e7;

// --- accent colours --------------------------------------------------------

/**
 * The Options on/off "green" — teal-green `selCol` used for every selected
 * toggle word (`PauseScreen.as` `selCol = 0x57DEB0`). This is THE accent green.
 */
export const C_OPTIONS_GREEN = 0x57deb0;
/** Selected weapon-slot highlight tint (Hud_WeaponHolder). Pure yellow. */
export const C_ACCENT_YELLOW = 0xffff00;
/** Soft cyan glow under the credit popups (char 1478). */
export const C_GLOW_CYAN = 0x00cccc;
/**
 * Button accent for a secondary navigation path — the online-lobby entry the
 * port keeps alongside the eight authentic menu rows. Shares the bright blue of
 * {@link C_TEAM1}; named separately because the meaning here is "side door",
 * not "team 1".
 */
export const C_ACCENT_SECONDARY = 0x00ccff;
/**
 * Button accent for the armory / upgrades path. Same pure yellow as
 * {@link C_ACCENT_YELLOW}, aliased so the buttons read by intent.
 */
export const C_ACCENT_UPGRADE = 0xffff00;
/**
 * The authentic menu-button hairline outline — mint/seafoam green, drawn at
 * ~0.2 alpha on both idle and hover states (`MenuButton_34`/`DefineSprite_482`
 * SVG art, doc 08 §2.4). Distinct from the `0x57DEB0` Options `selCol`.
 */
export const C_BTN_OUTLINE = 0x66cc99;

// --- team colours (bar fills + score text) ---------------------------------

/** Team 1 (Blue) bright bar fill. */
export const C_TEAM1 = 0x00ccff;
/** Team 1 back / desaturated track. */
export const C_TEAM1_BACK = 0x003399;
/** Team 1 score text tint (`Hud.as:412`). */
export const C_TEAM1_TEXT = 0xa3cfff;
/** Team 2 (Orange / "alien") bright bar fill. */
export const C_TEAM2 = 0xff9900;
/** Team 2 back / desaturated track. */
export const C_TEAM2_BACK = 0x663300;
/** Team 2 score text tint. */
export const C_TEAM2_TEXT = 0xff9966;
/** Team 3 (Yellow) bright bar fill. */
export const C_TEAM3 = 0xffff00;
/** Team 3 score text tint. */
export const C_TEAM3_TEXT = 0xffff99;
/** FFA / no-team (team 0/4) bright bar fill. */
export const C_TEAM_FFA = 0x00ff00;
/** FFA / no-team score text tint. */
export const C_TEAM_FFA_TEXT = 0xffff99;

/**
 * Side names by team index. Raze 2 has **no red team** — the sides are Blue,
 * Orange, Yellow and Green, and the local player is always Blue. Anything that
 * captions a side reads from here so a stray "RED" can't creep back in.
 */
export const TEAM_NAMES = ["FFA", "Blue", "Orange", "Yellow", "Green"] as const;

/** Side name for a team index; "FFA" for no team. */
export function teamName(team: number | undefined): string {
  return TEAM_NAMES[team ?? 0] ?? TEAM_NAMES[0];
}

/**
 * Objective tint (CTF flags, Domination points). Same ramp as the nameplates,
 * but team 0 here means *unclaimed* rather than free-for-all, so it gets a
 * neutral grey instead of the FFA green.
 */
export const C_OBJECTIVE_NEUTRAL = 0x9aa7b4;
export function objectiveColor(team: number | undefined): number {
  return team ? teamColor(team) : C_OBJECTIVE_NEUTRAL;
}

// --- scoreboard row colours (View Scores) ----------------------------------
// The scoreboard (`ScoreBoardBar`/symbol462) uses a DIFFERENT, richer team
// ramp than the in-game nameplate bars above — each team block steps through
// three shades at 100%/80%/50% value (doc 12 §colors, measured from the SVG
// frames). Score-column text is a pale gold. Use these for the scores table,
// NOT the nameplate C_TEAM* above.
export const C_SCORE_TEAM = {
  1: [0x3399ff, 0x297acc, 0x1a4d80], // Blue
  2: [0xff9900, 0xcc7a00, 0x804d00], // Orange
  3: [0xffff00, 0xcccc00, 0x808000], // Yellow
  4: [0x00ff00, 0x00cc00, 0x008000], // Green / FFA
} as const;
/** Scoreboard "Score" column text tint (pale gold, doc 12). */
export const C_SCORE_GOLD = 0xfefdb4;

/** Scoreboard team header/row base colour (100% shade) by team index. */
export function scoreTeamColor(team: number | undefined): number {
  return (C_SCORE_TEAM as any)[team ?? 4]?.[0] ?? C_SCORE_TEAM[4][0];
}

/** Team bright bar colour by team index (0/4 = FFA). */
export function teamColor(team: number | undefined): number {
  switch (team) {
    case 1:
      return C_TEAM1;
    case 2:
      return C_TEAM2;
    case 3:
      return C_TEAM3;
    default:
      return C_TEAM_FFA;
  }
}

/** Team desaturated back-track colour by team index. */
export function teamBackColor(team: number | undefined): number {
  switch (team) {
    case 1:
      return C_TEAM1_BACK;
    case 2:
      return C_TEAM2_BACK;
    case 3:
      return 0x996600; // olive
    default:
      return 0x006600; // dark green
  }
}

// --- panel / chrome fills --------------------------------------------------

/**
 * Dark-glass panel fill. The SWF panel (char 1448) is a radial gradient from
 * `#2B2B2B` (centre) to `#000000` (edge); Graphics has no radial gradient in
 * the headless stub, so the kit paints a flat centre colour and layers a
 * darkening edge/vignette. These two stops are the source of truth.
 */
export const C_PANEL_CENTER = 0x2b2b2b;
export const C_PANEL_EDGE = 0x000000;
/** Flat fill used when a single colour is wanted (mid-point of the gradient). */
export const C_PANEL_FILL = 0x1a1a1a;
/** 1px panel border (char 1448 stroke). Pure black in source; the kit uses a
 *  faintly lifted hairline so the border reads on a black backdrop. */
export const C_PANEL_BORDER = 0x000000;
/** Hairline border variant that stays visible over a dark backdrop. */
export const C_PANEL_HAIRLINE = 0x3a3a3a;
/** Screen dim/backdrop overlay colour (pause morph, char 463). Black. */
export const C_SCREEN_DIM = 0x000000;
/** Corner-tick / top accent rule default colour. */
export const C_ACCENT_BAR = 0x57deb0;

// --- alpha constants (source-accurate) -------------------------------------

/** Header text alpha (177/255 ≈ 0.69). */
export const A_HEADER = 177 / 255;
/** Button label alpha, idle (204/255 ≈ 0.80). */
export const A_LABEL = 204 / 255;
/** Dim / locked label alpha (102/255 ≈ 0.40). */
export const A_LABEL_DIM = 102 / 255;
/** Body copy alpha (204/255 ≈ 0.80). */
export const A_BODY = 204 / 255;
/** Value field alpha (177/255 ≈ 0.69). */
export const A_VALUE = 177 / 255;
/** Screen dim overlay peak alpha (102/255 ≈ 0.40). */
export const A_SCREEN_DIM = 102 / 255;
