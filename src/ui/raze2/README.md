# Raze 2 UI kit (`src/ui/raze2/`)

The shared, pixel-faithful visual foundation for the restyled Raze 2 chrome
(Pause menu, Options, View Scores, and the ported menu screens). Every colour,
font and shape here is sourced from the decompiled SWF — see
`docs/raze2/14-hud-chrome.md` (primary spec) and `docs/raze2/13-ui-menus.md`.

Import everything from the barrel:

```ts
import { Raze2Button, Raze2Panel, Raze2Toggle, FONT_HEADER, C_OPTIONS_GREEN } from "../ui/raze2";
```

All components expose a PixiJS `Container` via `.view`; add that to your screen.
Only the Graphics primitives the headless test stub supports are used
(`rect`/`roundRect`/`circle`/`moveTo`/`lineTo`/`fill`/`stroke`) — no gradients.

---

## Fonts (`fonts.ts`)

Three family-name constants, each a full CSS font-family stack:

| Const | Face | Use | Source |
|---|---|---|---|
| `FONT_HEADER` | **BlairMdITC TT** (embedded, squared small-caps) | screen titles, button labels (~20pt) | `465/485_BlairMdITC TT.ttf` |
| `FONT_VALUE` | **QTypeSquare-Book** (embedded, sci-fi grotesque) | numeric/value fields, toggle words | `6_QTypeSquare-Book.ttf` |
| `FONT_BODY` | **Calibri** (system) → Segoe UI | wrapping description copy | system font |

**Font decision:** BlairMdITC TT and QTypeSquare-Book are not web-safe, so the
real TTFs extracted from `decompiled_swf/raze 2/fonts` ship in
`public/assets/fonts/` and are embedded via an injected `@font-face`. Calibri
is a Windows system font (the SWF used the OS copy — no local TTF existed), so
the body face uses the system stack rather than embedding a subset. Each const
carries web-safe fallbacks (Oswald/Impact for the header) so a missing embedded
face degrades gracefully.

```ts
import { loadFonts } from "../ui/raze2";
await loadFonts(); // idempotent; resolves immediately in headless/no-DOM
```

`loadFonts()` is already called from `LoaderScreen` during preload, so screens
built after the loader render with correct metrics. Safe to `await` again
anywhere.

---

## Palette (`palette.ts`)

Exact `0xRRGGBB` constants. Highlights (see the file for the full set):

- Text: `C_HEADER`, `C_LABEL`, `C_BODY`, `C_VALUE`, `C_NORMAL` (`#FFFFFF`),
  `C_SELECTED` (`#FFFFCC`), `C_LOCKED` (`#CCCCCC`), `C_DIM` (`#999999`).
- Accents: `C_OPTIONS_GREEN` (`#57DEB0`), `C_ACCENT_YELLOW` (`#FFFF00`),
  `C_GLOW_CYAN` (`#00CCCC`).
- Teams: `C_TEAM1` (`#00CCFF`), `C_TEAM2` (`#FF9900`), plus `_BACK`/`_TEXT`
  variants and helpers `teamColor(team)`, `teamBackColor(team)`.
- Panel: `C_PANEL_CENTER` (`#2B2B2B`), `C_PANEL_EDGE` (`#000000`),
  `C_PANEL_FILL`, `C_PANEL_HAIRLINE`, `C_ACCENT_BAR`.
- Alphas (source-accurate): `A_HEADER` (.69), `A_LABEL` (.80),
  `A_LABEL_DIM` (.40), `A_BODY` (.80), `A_VALUE` (.69).

---

## `Raze2Button`

Pause-menu button: dark-glass slab, coloured left-accent bar, top bevel,
small-caps `FONT_HEADER` ~20pt label; hover/selected/disabled states.

```ts
new Raze2Button(label: string, opts?: {
  width?: number;   // default 240
  height?: number;  // default 40
  accent?: number;  // left-bar colour, default C_ACCENT_BAR (#57DEB0)
  onClick?: () => void;
})
```

Methods: `setSelected(b)`, `setEnabled(b)`, `setLabel(s)`, `getLabel()`.
Property: `view` (Container). Selected label turns `#FFFFCC`; disabled dims to
~40% and ignores taps.

---

## `Raze2Panel`

Dark-glass slab (radial `#2B2B2B`→`#000000` approximated with layered rects),
hairline border, top accent rule, corner ticks.

```ts
const panel = new Raze2Panel(width, height, {
  alpha?: number;          // default 0.88
  accent?: number | null;  // top rule; null = none; default #57DEB0
  corners?: boolean;       // default true
  radius?: number;         // default 0 (hard corners)
});
panel.view.x = 40; panel.view.y = 60;  // position it
panel.resize(w, h);                     // repaint at a new size
```

Also `drawRaze2Panel(g, x, y, w, h, opts)` to compose the look into an existing
`Graphics` inline.

---

## `Raze2Toggle`

The Options toggle / segmented picker: side-by-side plain-text words, active
word teal-green (`#57DEB0`), inactive grey (`#999999`), inactive-hovered white.
Covers both binary On/Off and multi-value pickers.

```ts
new Raze2Toggle(labels: string[], selectedIndex: number, onChange: (i: number) => void, opts?: {
  fontSize?: number; // default 15
  gap?: number;      // default 16
})
```

Methods: `setSelected(i)` (no callback), `getSelected()`. Property: `view`.

---

## 5-line usage example

```ts
import { Raze2Panel, Raze2Button, Raze2Toggle } from "../ui/raze2";
const panel = new Raze2Panel(300, 200, { accent: 0x57deb0 });
this.view.addChild(panel.view);
const resume = new Raze2Button("Resume Game", { onClick: () => game.togglePause() });
resume.view.x = 30; resume.view.y = 30; panel.view.addChild(resume.view);
const sound = new Raze2Toggle(["Off", "On"], 1, (i) => (SD.sound = i === 1));
sound.view.x = 30; sound.view.y = 90; panel.view.addChild(sound.view);
```
