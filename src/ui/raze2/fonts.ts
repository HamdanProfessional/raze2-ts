/**
 * Raze 2 UI fonts. Registers the three menu/chrome faces via an injected
 * `@font-face` block and exposes their family-name constants plus a
 * {@link loadFonts} hook that resolves once the embedded faces are ready.
 *
 * Font decision (see README):
 *  - **BlairMdITC TT** and **QTypeSquare-Book** are not web-safe, so the real
 *    TTFs extracted from `decompiled_swf/raze 2/fonts` are shipped in
 *    `public/assets/fonts/` and embedded here.
 *  - **Calibri** is a Windows system font (and the SWF used the OS copy, no
 *    local TTF existed), so the body face falls back to the system font stack
 *    rather than embedding a subset.
 *
 * Every family const is a full CSS font-family stack, so a missing embedded
 * face degrades to a sensible web-safe substitute (Oswald/Impact for the
 * squared small-caps header, Segoe UI for the others).
 */

import { ASSET_BASE } from "../../core/Config";

/**
 * Header + button face: BlairMdITC TT, a squared small-caps serif. Used for
 * screen titles and every button label (BlairMdITC, ~20pt in source).
 * Fallback: Oswald / Impact (condensed squared caps) then generic sans.
 */
export const FONT_HEADER = "'BlairMdITC TT', 'Oswald', 'Impact', sans-serif";

/**
 * Value / numeric read-out face: QTypeSquare-Book, the squarish "sci-fi HUD"
 * grotesque. Used for numeric fields, toggle words and short value labels.
 * Fallback: Segoe UI then generic sans.
 */
export const FONT_VALUE = "'QTypeSquare-Book', 'Segoe UI', sans-serif";

/**
 * Body / description face: Calibri (system font). Used for wrapping copy.
 * Fallback: Segoe UI then generic sans.
 */
export const FONT_BODY = "Calibri, 'Segoe UI', sans-serif";

/** Bare family names of the embedded faces, for `document.fonts.load`. */
const EMBEDDED = ["BlairMdITC TT", "QTypeSquare-Book"] as const;

const CSS = `
@font-face {
  font-family: 'BlairMdITC TT';
  font-weight: 700;
  font-style: normal;
  font-display: swap;
  src: url('${ASSET_BASE}/fonts/BlairMdITC-Bold.ttf') format('truetype');
}
@font-face {
  font-family: 'BlairMdITC TT';
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url('${ASSET_BASE}/fonts/BlairMdITC-Regular.ttf') format('truetype');
}
@font-face {
  font-family: 'QTypeSquare-Book';
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  src: url('${ASSET_BASE}/fonts/QTypeSquare-Book.ttf') format('truetype');
}
`;

let injected = false;
let loadPromise: Promise<void> | null = null;

/** Inject the `@font-face` <style> once. No-op outside a DOM (headless tests). */
function injectFontFaces(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.setAttribute("data-raze2-fonts", "");
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * Ensure the embedded UI fonts are registered and loaded before the first
 * render. Idempotent and safe to await from multiple call sites; resolves
 * immediately (and silently) in a headless environment with no `document`.
 *
 * Call this in the Loader alongside the other asset preloads so screens built
 * synchronously afterwards measure text with the correct metrics.
 */
export function loadFonts(): Promise<void> {
  if (loadPromise) return loadPromise;
  injectFontFaces();

  const fontSet = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fontSet) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  loadPromise = Promise.all(
    // Load a representative weight for each embedded family; browsers cache the
    // face so later size/weight requests reuse it.
    EMBEDDED.map((family) =>
      fontSet.load(`700 20px '${family}'`).catch(() => undefined),
    ),
  )
    .then(() => fontSet.ready)
    .then(() => undefined)
    .catch(() => undefined);

  return loadPromise;
}
