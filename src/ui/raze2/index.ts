/**
 * Raze 2 UI kit — the shared visual foundation for the restyled Pause /
 * Options / Scores / menu chrome. Pixel-faithful to the decompiled SWF
 * (see `docs/raze2/14-hud-chrome.md` and `docs/raze2/13-ui-menus.md`).
 *
 * See README.md in this folder for the component API + usage examples.
 */

export * from "./palette";
export {
  FONT_HEADER,
  FONT_VALUE,
  FONT_BODY,
  loadFonts,
} from "./fonts";
export { Raze2Button, type Raze2ButtonOpts } from "./Raze2Button";
export {
  Raze2Panel,
  drawRaze2Panel,
  type Raze2PanelOpts,
} from "./Raze2Panel";
export { Raze2Toggle, type Raze2ToggleOpts } from "./Raze2Toggle";
export { makeAbilityIcon, abilityTypeColor, ABILITY_TYPE_COLOR } from "./abilityIcon";
