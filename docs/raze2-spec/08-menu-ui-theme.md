# Menu / Start Screen + Global UI Design System

## 1. Summary

Every Raze 2 menu screen (Menu, Campaign Select, Human/Alien Campaign, Quick Match, Armory, Profile,
Weapons, Equipment, Abilities, Kill Bonuses, Achievements, Options, Purchase Confirmation) is a single
`FrameLabelTag` on **one shared timeline**: the `Menu` symbol (`[Embed(symbol="symbol1177")]`,
`Menu.as`, instance `menfr`). There is no per-screen class or symbol — `menfr.gotoAndStop("<label>")` /
`Transition.slideLeft/slideRight(menfr,"<label>")` switch frames. Because every screen lives on that one
timeline, they all share **one button symbol, one font trio, and one alpha/colour rule-set** — that shared
system is this document's subject, plus the specific "Menu" frame's layout (logo/social/nav-list/footer
chrome). This doc is the cross-cutting reference every other `NN-*.md` (Campaign, Quick Match, Armory,
Options, Pause/Scores, Abilities/Equipment) should point back to for "what does a button/panel/label look
like here" instead of re-deriving it.

**Note on sourcing**: the reference screenshot for this domain (map entry 5, "Menu / start screen") was
listed in the assignment but the image file was **not present** in this session's `image-cache` directory
(confirmed empty/non-existent by directory listing) — this doc is built entirely from the decompiled AS3 +
extracted SWF art (frame-by-frame SVG renders of the actual button symbols, which is more precise than an
eyeballed screenshot for colour/gradient values) and the user's own text description of screenshot 5 in the
task brief. Layout/chrome claims are cross-checked against the prior `docs/raze2/13-ui-menus.md` pass
(twips→px coordinates from a swf2xml export) and against the current port's own doc comments. Anything
that could only be confirmed by literally looking at the PNG is flagged "unverified" below.

## 2. Raze 2 source of truth

### 2.1 Files

| File | Role |
|---|---|
| `decompiled_swf/raze 2/scripts/Menu.as` (2645 lines) | All menu screens: `init()` (frame setup, ~L115-411), `MouseDown()` (click routing, ~L601-1639), plus per-screen helpers (`setCampaign`, `setGunTypes`, `setEquipment`, `setAbilities`, `showKillBonuses`, `showAchievements`, `setGraphicsText`, `setQuickmatchSettings`, `setBotList`, `setTeams`, `setWinScore`, `setMap`, `setUnit`, `clickUnit`) further down the file (L1662-2645, not fully reproduced here — see doc 09/10/11/13/14 for those screens' specifics). |
| `decompiled_swf/raze 2/scripts/Raze2_fla/MenuButton_34.as` | The **one** interactive nav-button symbol (`[Embed(symbol="symbol482")]`, `DefineSprite_482`) used for every left-aligned/generic menu button (`btn_*`) across all six-plus screens. |
| `decompiled_swf/raze 2/scripts/Raze2_fla/MenuButtonReverse_37.as` | Mirror variant (`[Embed(symbol="symbol498")]`, `DefineSprite_498`) — same states, gradient/bar direction and text anchor flipped horizontally; used where the bar should read right-to-left (e.g. right-aligned rows/back-buttons). |
| `decompiled_swf/raze 2/scripts/MenuGlobalStats.as` (360 lines) | The corner "Global Stats" **ticker widget** (`[Embed(symbol="symbol1174")]`), not a navigable screen. |
| `decompiled_swf/raze 2/fonts/*.ttf` | Font files backing the SWF's embedded fonts (see §2.3). |
| `decompiled_swf/raze 2/sprites/DefineSprite_482_Raze2_fla.MenuButton_34/{1..70}.svg` | Frame-by-frame FFDec render of the button's own 66+-frame internal timeline — this is the *exact* vector art for every button state (see §2.4). |
| `decompiled_swf/raze 2/sprites/DefineSprite_498_Raze2_fla.MenuButtonReverse_37/{1..70}.svg` | Same for the reverse variant. |
| `decompiled_swf/raze 2/sprites/DefineSprite_977_Raze2_fla.BlackButton_82/` | A separate, smaller (~70×19px) flat black hit-rect button used for tiny UI elements (graphics-preset buttons etc.) — only 3 frames, frame 1 fully transparent (`fill-opacity="0.0"`, `fill="#010101"`); out of scope for this doc's "global button" story beyond flagging it exists (see §4). |
| `decompiled_swf/raze 2/symbolClass/symbols.csv` | Symbol-id → class-name table; confirms `498;"Raze2_fla.MenuButtonReverse_37"`, `482;"Raze2_fla.MenuButton_34"`, `1177;"Menu"`, `1174;"MenuGlobalStats"`, `2114;"M_Menu"` (menu music cue), `37;"M_MenuIntro"`. |

### 2.2 The button click/hover state machine (applies to every `btn_*` everywhere)

From `Menu.as` `init()` (L115-163) and `EnterFrame()` (L545-599):

- On `init()`, every child of `menfr` whose name starts with `"btn_"` is: label-derived from its own
  instance name (`btn_Quick_Match` → strip `"btn"`, join remaining `_`-parts with spaces → `"Quick Match"`;
  the literal case `"Back to"` gets `+ " " + cameFrom` appended, L137-139/153-155), pushed into the
  `buttons` array, and set to `gotoAndStop(1)` (frame 1 = idle "up" state). `Menu.as:146,157`
  (`_loc2_.txt_word.text = _loc5_`) is the code that stamps that derived label into the symbol's
  `txt_word` TextField.
- Names starting with `"btnl_"` (**l**ocked variant) get the same label treatment but `alpha = 0.5` and are
  **not** pushed into `buttons` — i.e. they render but never respond to hover/click. (`Menu.as:150-159`)
- Every frame, `EnterFrame()` (L545-599) hit-tests each active button's own `hitbox` child:
  ```
  hitbox NOT hit, clip on "up"   -> stays "up"                (idle)
  hitbox hit                     -> gotoAndPlay("over")        (hover-in; plays S_Click once, on frame 1)
  hitbox NOT hit, clip on "on"   -> gotoAndPlay("out")          (hover-out)
  ```
  i.e. the button *is* its own tiny state machine movie clip with internal frame-label segments
  `up` / `over` / `on` / `out`; the parent script only drives `gotoAndPlay` calls, the actual crossfade is
  baked keyframe animation (see §2.4), not a scripted tween.
- Click routing (`MouseDown()`, L601-1639) hit-tests every `buttons[i].hitbox` and switches on
  `buttons[i].txt_word.text` (the same string that was set as the label) — so **the button's own rendered
  text is the router key**, not a stable id. Falls through a giant `switch` of literal label strings
  (`"Start Game"`, `"Upgrades"`, `"Armory"`, `"Back to Menu"`, etc., L629-857) with an untyped `default:`
  case that does `Transition.slideLeft(menfr, buttons[i].txt_word.text)` — i.e. any button whose label
  matches an existing frame label just works with zero extra code (this is why "Achievements"/"Options"/
  "Credits" have no dedicated case, per `docs/raze2/13-ui-menus.md` L135-139).

### 2.3 Fonts (verified against `decompiled_swf/raze 2/fonts/`)

| Face | File(s) | Weight | Used for |
|---|---|---|---|
| **BlairMdITC TT** | `465_BlairMdITC TT.ttf` (Bold), `485_BlairMdITC TT.ttf` (Regular) | Bold 20pt for every button label (`txt_word`, `fontHeight=400` twips); Regular ~26pt for the generic screen header `txt_title` (`menfr.txt_title.text = menfr.currentLabel`, `Menu.as:125` — this is a **dynamic** field showing the current frame label as plain text, e.g. literally "Menu", "Armory", "Options"; not a "RAZE 2" logo — see §3.3) | Buttons everywhere + generic headers |
| **QTypeSquare-Book** | `6_QTypeSquare-Book.ttf` (+ sized variants `442/444/1441/1484/1499_QTypeSquare-Book_*.ttf`) | Regular | Short value/label fields: map title, match-type value, score, on/off toggle words, player name, credits readout |
| **QTypeSquare-Bold** | `50/557/564/566_QTypeSquare-Bold_*.ttf` | Bold | HUD-style large numerics (out of this doc's scope; see doc 07) |
| **Calibri** | no local `.ttf` (system font, OS-resolved at SWF runtime) | Regular | Longer wrapping body copy: map/type descriptions, warning text, ability descriptions |

This is a "squared/technical sans for numbers, an italic-leaning bold serif-slab for headers and buttons"
pairing — **not** a small-caps font family in the typographic sense (BlairMdITC has real lowercase glyphs);
the "small-caps look" the task brief and the port's own code comments refer to comes from every button
label being **rendered from an ALL-CAPS-styled string in practice** (menu nav labels like "QUICK MATCH" in
the reference screenshot) even though the font itself is a normal-case face — confirm per-string casing
against screenshot 5 when it becomes available; the port currently forces `.toUpperCase()` in code
(`Raze2Button.ts:65`, see §5) which is a reasonable-but-unverified assumption.

### 2.4 The button's own art — idle / hover states, pixel-exact (this is "the beveled/gradient bar look")

Read directly from the FFDec-exported frame SVGs of `DefineSprite_482` (`MenuButton_34`, the plain
left-to-right variant) and `DefineSprite_498` (`MenuButtonReverse_37`, the mirrored variant). Both symbols
share an internal structure of 3 layered children per frame: a full-height **gradient-filled bar** shape
(`shape1`/`morphshape0`), a **thin outline stroke**, and the **`txt_word`** text field, all sitting inside a
container offset so the shapes are centred on `(0,0)` and the whole clip is ~28px tall.

**Frame 1 — idle ("up") state** (`.../MenuButton_34/1.svg`):

| Element | Value |
|---|---|
| Bar shape bounding box | local x ∈ [-117.45, 122.20] px (width **239.65px**), y ∈ [-13.25, 13.25] px (height **26.5px**) — i.e. a **~240×26.5px horizontal bar** |
| Bar fill | Linear gradient, **black**, horizontal (left→right): stop 0 = `#000000` @ alpha 0.6, stop 0.66 = `#000000` @ alpha 0.4, stop 1.0 = `#000000` @ alpha 0.0 — i.e. **solid-ish black on the left third, fading to fully transparent by the right edge** (a left-heavy vignette bar, not a flat fill) |
| Left end-cap | A narrower vertical strip (`-122.45..-117.45`) with its own darker gradient (`#000000` alpha 0.6→0.4→0.0) reinforcing the bar's left edge |
| Outline stroke | 1.5px, colour `#66CC99` (a mint/seafoam green — **distinct from** the `0x57DEB0` `selCol` teal-green used on the Pause/Options screen, see §6.1) at only **alpha 0.2**, so it reads as a barely-visible cool-green hairline rather than a bold border; stroked on the left end-cap edge and along the full outer rectangle |
| Label (`txt_word`) | `fill="#ffffff"` @ **alpha 0.8** (204/255), font BlairMdITC (glyph paths embedded directly in the SVG, confirming the Bold TT face), left-anchored inside the bar with a small left inset (`transform x ≈ 4.6px` past the bar's left edge) |
| Overall clip size (incl. hitbox) | width **285.65px**, height **28.0px** (hitbox extends slightly past the visible bar) |

**Hover / "on" state** — sampled at frame 20 (mid-morph) and frame 66 (`.../MenuButton_34/20.svg`,
`66.svg`; the button's timeline runs frames 1→~65 as a **morph tween** then `frame66()` does
`gotoAndPlay("on")` to loop-hold the fully-hovered look, `MenuButton_34.as:25-28`):

| Element | Value |
|---|---|
| Bar fill | **Inverts to white**: linear gradient stop 0 = `#ffffff` @ alpha 0.6, stop 0.66 = `#ffffff` @ alpha 0.4, stop 1.0 = `#000000` @ alpha 0.0 (frame 20, mid-morph, still shows a residual black strip at the leading edge — `#000000` alpha 0.298 constant-stop segment — that fully disappears by frame 66) |
| Outline stroke | Same `#66CC99` @ alpha 0.2 mint hairline, unchanged position/colour through the whole morph |
| Label (`txt_word`) | **Inverts to black**: `fill="#000000"` @ alpha 0.8 (same 80% alpha, just the opposite polarity) |
| Net effect | A **dark→light polarity-swap "invert" hover**, not a glow/tint/scale-up — the whole bar and its text literally flip from black-bar/white-text to white-bar/black-text as the pointer enters, over roughly a 20-ish-frame (~0.6s @ 30fps) morph-shape tween, then holds solid white while hovered and reverses on `"out"`. |

**`MenuButtonReverse_37`** (`DefineSprite_498`) is byte-for-byte the same idle/hover recipe with every
gradient's transform x-scale negated (bar fades from the **right** instead of the left) and the label glyph
run positioned so text reads right-anchored inside the bar — used for rows that should visually "grow" or
read from the opposite side (e.g. a right-column list, or a "Back" row mirrored under a left-aligned
forward row).

**No distinct "selected" persistent visual exists on this button symbol** — only `up`/`over`/`on`/`out`.
Persistent "this is the current/active item" states (e.g. the Campaign mission list's "currently selected
level") are implemented completely differently, via `TextField.textColor` swaps on a *different* symbol
(`but_list*` rows, `Menu.as:1650-1716`, colours in §6.2) — the shared nav button itself has no equivalent.

### 2.5 Color palette (global, verified `TextField.textColor`/gradient values from source)

Superseding/confirming `docs/raze2/13-ui-menus.md` §"Color palette" and `docs/raze2/14-hud-chrome.md` §4/§6:

| Role | Value | Source |
|---|---|---|
| Screen header (`txt_title`) | `#FFFFFF` @ alpha 177/255 (~69%) | swf2xml `characterID="680"` textColor; `Menu.as:125` sets the *content* |
| Button label, idle | `#FFFFFF` @ alpha 204/255 (~80%) | Confirmed directly in the SVG art, §2.4 |
| Button label, hover/"on" | `#000000` @ alpha 204/255 (~80%) | Confirmed directly in the SVG art, §2.4 — **not previously captured in doc 13/14**, which only had the idle value from a swf2xml textColor dump |
| Button bar outline (idle + hover) | `#66CC99` @ alpha ~0.2 | Confirmed directly in the SVG art, §2.4 — **new finding**, not in doc 13/14 |
| Button bar fill, idle | Black gradient, alpha 0.6→0.4→0.0 (see §2.4) | Confirmed directly in the SVG art |
| Button bar fill, hover | White gradient, alpha 0.6→0.4→0.0 (see §2.4) | Confirmed directly in the SVG art |
| "Game saves to:" text | `#FFFFFF` @ alpha 204/255 (~80%), BlairMdITC Regular ~22pt | swf2xml `characterID="644"/"645"` |
| Body/description copy (Calibri) | `#FFFFFF` @ alpha 204/255 (~80%) | swf2xml `characterID="771","848","853"` |
| Value/label fields (QType) | `#FFFFFF` @ alpha 177/255 (~69%) | swf2xml `characterID="772","831","833","891"` |
| Warning text | `#FF9999` @ alpha 177/255 (~69%) | swf2xml `characterID="849"` |
| Campaign list — normal row | `#FFFFFF` (`16777215`) | `Menu.as:1650,1668` |
| Campaign list — selected/current row | `#FFFFCC` (`16777164`) | `Menu.as:216,1678` |
| Campaign list — locked row | `#CCCCCC` (`13421772`) | `Menu.as:216,233` |
| Status — "owned/equipped" | `#CCFFCC` (`13434828`) | `Menu.as:1769` region (owned-gun status text; the current file's line numbers shifted slightly vs. doc 13 due to a different decompile pass, but the same literal colour constant `0xCCFFCC`/`13434879` family appears at `Menu.as:1316,1322` in this read) |
| Status — "can afford" | `#CCFFFF` (`13434879`) | `Menu.as:1310` region |
| Status — "can't afford" | `#FFCCCC` (`16764108`) | `Menu.as:1305` |
| Options — disabled label | `#999999` (`10066329`) | Pause/Options shared rule, `docs/raze2/14-hud-chrome.md` L293 |
| Options — selected/on accent | `#57DEB0` (`selCol`) | `PauseScreen.as` (Options screen only — **do not** conflate with the Menu-button's `#66CC99` outline; these are two different greens used in two different places, see §6.1) |

No flat panel-fill hex exists anywhere in this system — every dark surface (button bars, and per doc
14's char 1448 ammo/weapon-slot panel) is a **black-alpha gradient**, never a solid colour. Treat any flat
hex "panel colour" documented elsewhere in this project (e.g. `C_PANEL_CENTER = 0x2b2b2b` in the port,
§5) as a *drawn approximation* of a gradient the headless renderer can't reproduce exactly, not a literal
source value.

## 3. The "Menu" frame (start screen) — layout

Reference: `Menu.as:170-192` (`case "Menu":`), cross-checked against `docs/raze2/13-ui-menus.md` §1 (twips→px
coordinates from a swf2xml dump against an assumed 800×600 stage) and the task brief's description of
reference screenshot 5.

### 3.1 Left-aligned nav list (all instances of `MenuButton_34`/char 482)

All 8 buttons share the same `x` (doc 13: 160.65px on the original 800px-wide stage) with `y` stepping by
~26-32px; derived labels (per §2.2's name-stripping rule) and click targets:

| Order | Instance name | Label shown | Click target (`Menu.as`) |
|---|---|---|---|
| 1 | `btn_Campaign` | Campaign | `Transition.slideLeft(menfr,"Campaign Select")` |
| 2 | `btn_Quick_Match` | Quick Match | default case → `Transition.slideLeft(menfr,"Quick Match")` |
| 3 | `btn_Armory` | Armory | `case 2:` → `Transition.slideLeft(menfr,"Armory")` (`Menu.as:753-761`) |
| 4 | `btn_Achievements` | Achievements | default case → slides to `"Achievements"` |
| 5 | `btn_Options` | Options | default case → slides to `"Options"` |
| 6 | `btn_Credits` | Credits | default case → slides to `"Credits"` |
| 7 | `btn_Play_More_Games` | Play More Games | `case 23:` → `AGI.urlSponsor()` (`Menu.as:847-850`) |
| 8 | `btn_Play_Raze_1` | Play Raze 1 | `case 24:` → `AGI.urlRaze1()` (`Menu.as:851-853`) |

### 3.2 Chrome present specifically on the "Menu" frame (`Menu.as:170-192`)

| Element | Purpose | Source |
|---|---|---|
| `menfr.mc_sponsor` | Armor Games logo, `buttonMode = true`, click → `AGI.urlSponsor()` | `Menu.as:171,920-923` |
| `menfr.mc_twitter` | Twitter icon, click → `AGI.urlTwitter()` | `Menu.as:172,924-926` |
| `menfr.mc_facebook` | Facebook icon, click → `AGI.urlFacebook()` | `Menu.as:173,934-937` |
| `menfr.newsbox` | Announcement box, shown only if `Main.GAMEVARS.NewsTitle`/`NewsDesc` are both present and >3 chars; otherwise hidden (`visible=false`) | `Menu.as:174-189` |
| `menfr.helpinfo` | The "Controls ?" tooltip trigger — swaps between a base/`"_"`-suffixed sub-state depending on live mouse-over, `helpinfo.gotoAndStop(menfr.currentLabel [+ "_"])` | `Menu.as:164-167,575-585` (generic, runs on every frame, not Menu-specific) |
| `AGI.setLoginForMenu()` / `AGI.displayLoginInfo(true)` | Login-state UI (username/avatar or "Login" prompt) | `Menu.as:190-191` |

Per `docs/raze2/13-ui-menus.md` §1, `txt_title` on this frame literally displays the string `"Menu"` (it's
the generic per-frame header, `Menu.as:125`) — **there is no confirmed dedicated "RAZE 2" wordmark symbol
or instance name** anywhere in `Menu.as`'s decompiled body (grepped for `logo`/`wordmark`/`mc_title`/
`img_logo` across `Menu.as`, `Menu_2.as`, `Main.as` — zero hits). If reference screenshot 5 shows a large
stylised "RAZE 2" logotype (as the task brief's framing implies — "the title treatment"), that art is
**baked directly into the Menu frame's low-depth background layer with no scripted instance name**, not a
dynamic text field and not something `grep`-able from the decompiled AS3. Treat the exact logo typography/
placement as **unverified** pending either (a) access to screenshot 5, or (b) a manual FFDec GUI walk of
symbol 1177's "Menu" frame's low-depth `PlaceObject` children.

### 3.3 Background

No shared "cityscape/parallax" bitmap symbol could be positively identified by name in the decompiled
scripts (consistent with `docs/raze2/13-ui-menus.md` L82-87 — the backdrop children on `menfr` were never
individually resolved to symbol/class names). The current port ships a single **flattened, static**
backdrop at `raze-ts/public/assets/ui/menu.jpg`: a dusk-orange sky, silhouetted city skyline (spires,
suspension-bridge cables between two towers, blocky low buildings), and two overlapping moons/planets in
the upper-right sky — thematically consistent with Raze 2's sci-fi setting (aliens, two moons) but almost
certainly a **pre-flattened composite** of what was originally multiple parallax-scrolling layers in the
SWF (foreground silhouette, mid buildings, sky/moon layer) rather than a faithful multi-layer port — see
Gap analysis §4. This is the single biggest unverified/likely-lossy asset in the whole menu system; if
screenshot 5 shows visible independent-speed layer movement, that motion is **not** reproduced by the port
today (the image is a static `Sprite`, `UiArt.ts:16`, stretched to fill the canvas, no per-layer parallax
transform).

### 3.4 Footer chrome

- **"Game saves to:"** — `mc_loginhelper` (char 647) contains a text pair (chars 644/645) switched by login
  state; exact string not resolved beyond "Game saves to: This Website" / "...Online Profile" per doc 13.
- **Version tag** — **not** a standalone footer string. It lives inside `MenuGlobalStats`
  (`txt_version.text = "v " + Main.VERSION`, `MenuGlobalStats.as:65`, with `Main.VERSION = "2.0"` set at
  `Main.as:96`) — i.e. the literal source string is **`"v 2.0"`** (with a space after `v`), and it is
  rendered as part of the same small widget as the community stat ticker (see next bullet), not a separate
  bottom-right label.
- **"Global Stats"** — `MenuGlobalStats` (`symbol1174`) is a **horizontally-scrolling marquee/ticker**, not
  a clickable link to a stats screen: `setNextText()` (`MenuGlobalStats.as:282`) and `EnterFrame()`
  (`:295`) continuously slide a queue of community-wide Playtomic stat strings (e.g. `"Suicides: 1,234,567"`,
  `"Humans Killed: ..."`, `"Aliens Neutralized: ..."`, `"Bullets Fired: ..."`, 15+ possible entries built
  from `Main.PLAYTOMIC.*`, `MenuGlobalStats.as:70-149+`) left-to-right using a running `x` offset
  (`txts[i].txtfld.x = txts[i-1].txtfld.x + txts[i-1].width + txtSpace`, `txtSpace = 50`), with the version
  string appended as one of the ticker entries. It is **not** a navigable "go see your personal
  achievements" entry point.
- **"Controls ?"** — the `helpinfo` tooltip described in §3.2, present on every frame (not Menu-specific).

## 4. Current port state

Files: `raze-ts/src/screens/MenuScreen.ts` (492 lines), `raze-ts/src/screens/ui.ts` (194 lines),
`raze-ts/src/ui/raze2/{palette,fonts,Raze2Button,Raze2Panel,Raze2Toggle}.ts`, art at
`raze-ts/public/assets/ui/menu.jpg`, `raze-ts/public/assets/fonts/{BlairMdITC-Bold,BlairMdITC-Regular,
QTypeSquare-Book}.ttf`, `raze-ts/public/assets/buttons/{btn_up,btn_over,btn_down}.png`.

The port has clearly already been through one faithfulness pass since `docs/raze2/13-ui-menus.md` was
written (that doc calls the menu "a completely different layout" with a centred "RAZE" wordmark, Impact
font, `#FF5533` orange — **none of that is true of the current file**, which is a substantial rewrite; doc
13's port-status table for this screen is now **stale** and should not be trusted for the current state).

What `MenuScreen.ts` does today, mapped against §3:

| Aspect | Port (`MenuScreen.ts`) | Faithfulness |
|---|---|---|
| Nav list | Left-aligned, 8 items, **exact same 8 labels in the exact same order** (`Campaign, Quick Match, Armory, Achievements, Options, Credits, Play More Games, Play Raze 1`, L147-156) | Matches §3.1 order/labels exactly |
| Nav button widget | `Raze2Button` (see §5), 250×36px, `x=60`, `y` stepping by 44px (L158-176) | Structurally right (left-aligned list, generic reusable button), but the button's **visual language does not match §2.4** — see §5 |
| Wordmark | Draws its own `"RAZE 2"` `Text` node, `FONT_HEADER` (BlairMdITC), size 84, at (60,46) (`buildWordmark`, L84-99) | A reasonable stand-in given §3.2's finding that no scripted logo instance exists, but the exact typography/placement is a **guess**, not extracted art |
| Armor Games / social chrome | `link()` helper renders "ARMOR GAMES" (x=62,y=156), "Twitter" (x=250,y=158), "Facebook" (x=336,y=158) as plain clickable text (L103-107) | Present and functionally wired to `SD.urlSponsor/urlTwitter/urlFacebook`; source uses icon art (`mc_sponsor`/`mc_twitter`/`mc_facebook`), port uses text labels instead — **icon art not ported** |
| "Controls ?" | `link("Controls  ?", ...)` top-right (L110-111), **but `onClick: () => {}`** — a no-op | Visually present, but the tooltip content itself (what "Controls" actually shows) is **not implemented** |
| "Game saves to" | Centred text "Game saves to:  This Website" (L256-270) | Matches the *string* doc 13 found; correctly static/non-interactive |
| Version tag | Bottom-right `"v2.0"` (L273-281), styled as its own standalone `Text`, independent of any stats ticker | Slightly wrong string (**source is `"v 2.0"`, with a space**, per §3.4) and, more importantly, structurally wrong: source has no standalone version label — it's one entry in the `MenuGlobalStats` ticker |
| "Global Stats" | Bottom-left clickable link → navigates to `StatsScreen` (L284) | **Wrong interaction model** — source's `MenuGlobalStats` is a passive scrolling community-stat ticker, not a navigation link to a personal stats screen (§3.4) |
| Background | `menu.jpg` stretched full-frame + a flat 42%-alpha black scrim (L63-67) | Static single-layer image where the source likely had scrolling parallax layers (§3.3, unverified) |
| Side panel ("PILOT" card + Online Match) | A `Raze2Panel` showing name/credits + an "Online Match" button (`buildSidePanel`, L192-250) | **Not part of the original Menu frame at all** — this is new UI added for the port's own online-multiplayer feature, explicitly called out as such in the file's own doc comment (L235-236) |
| Hidden options drawer (Q/G/M/S hotkeys) | A power-user quick-settings panel using the *other*, older `makeButton()` widget from `ui.ts` (L290-336) | Also new, not from source; **uses a visually different button system** than the nav list (see §5) |

## 5. Two competing button systems currently exist in the port — gap vs. §2.4

This is the most important actionable finding for implementers: **the port has two unrelated button
components**, and *neither* reproduces the source's actual black↔white invert-on-hover bar (§2.4).

1. **`Raze2Button`** (`src/ui/raze2/Raze2Button.ts`) — used by `MenuScreen.buildNav()`'s 8-item list and
   the side-panel "Online Match" button. Visual recipe (`redraw()`, L122-167): a dark-glass rectangle
   (`C_PANEL_EDGE`/`C_PANEL_CENTER`, i.e. `#000000`/`#2B2B2B`, both **flat fills**, not the source's
   gradient), a thin top highlight + bottom shade for fake bevel, a **left accent bar** (4px wide, coloured
   per-caller, default `C_ACCENT_BAR = 0x57DEB0`) that brightens on hover/selection, and label
   alpha/colour swaps (white @80%→100% on hover, pale-yellow `#FFFFCC` when `selected`). This is a
   coherent, good-looking *original* design, explicitly modelled on the **Pause-menu** button per its own
   doc comment (L30-38, citing "doc 14 §3.1") — but the Pause-menu button's own accent-bar colour was
   **never confirmed from source** either (`docs/raze2/14-hud-chrome.md` L238-245 explicitly flags this
   as an unresolved "action item for implementers", not a verified fact) — so `Raze2Button`'s left-accent-
   bar concept is an invented visual, not an extracted one, on both ends of the citation chain. Its
   `selected` (pale-yellow) state is also a source concept **from the Campaign mission-list rows**
   (`#FFFFCC`, §2.5), grafted onto a generic nav button that in the source has no such state.
2. **`makeButton()`** (`src/screens/ui.ts`, L77-172) — used only by `MenuScreen`'s hidden options drawer
   (sound/music/quality/glow toggles) and by other, older screens. Prefers 3 PNG textures
   (`btn_up.png`/`btn_over.png`/`btn_down.png`, comment says "lifted from `DefineButton2_1315`") with a
   `monospace` label overlay and a scale-up hover tween; falls back to a drawn rounded-rect with an
   orange (`#FF5533`) stroke if the textures fail to load. **Neither the texture path nor the fallback
   resembles §2.4 at all** — the PNGs (`public/assets/buttons/btn_up.png` etc., visually a grey-green /
   tan-gold / dark pill, ~4px tall stripe art) don't match any button symbol id confirmed in this
   session's `decompiled_swf/raze 2/buttons/` listing (`DefineButton2_507/687/784/828` — **no 1315
   exists**), so the citation in the code comment is unverifiable/likely stale, and the fallback's
   monospace font + orange accent match neither BlairMdITC/QTypeSquare nor the `#66CC99`/`#57DEB0` greens
   documented here.

Neither system currently implements: the black-gradient-bar idle look, the white-gradient-bar hover
invert, the mint-green (`#66CC99`) hairline outline, or the black-on-hover label colour flip from §2.4.

## 6. Gap analysis

- **Button visual language (biggest gap)**: source buttons are a **horizontal black-alpha-gradient bar
  with a barely-visible mint-green (`#66CC99`@0.2) outline** that **inverts to a white-alpha-gradient bar
  with black text** on hover (§2.4); the port's `Raze2Button` is a flat dark-glass rectangle with a
  coloured left accent stripe and alpha/colour label swaps — a different, invented visual language that
  happens to be tasteful but is not a port of the source art.
- **Two divergent button components** (`Raze2Button` vs. `ui.ts`'s `makeButton`) exist simultaneously with
  different fonts (BlairMdITC vs. monospace), different accent colours (`#57DEB0` vs. `#FF5533`), and
  different hover behaviours (colour/alpha redraw vs. texture-swap + scale) — pick one and retire the
  other once §2.4's real art is implemented.
- **6.1 Two distinct greens must not be conflated**: the Menu nav-button's outline is `#66CC99` (§2.4); the
  Options/Pause "selected" accent is `#57DEB0` (`selCol`, §2.5/doc 14 §4). The port's `palette.ts` only
  defines the latter (`C_OPTIONS_GREEN = 0x57deb0`, `C_ACCENT_BAR = 0x57deb0`) and reuses it everywhere
  (including as the Menu screen's button accent, `MenuScreen.ts:165`) — it should additionally define the
  `#66CC99` menu-button-outline green as its own named constant once the real button art is built, rather
  than substituting the Options green.
- **6.2 Missing "selected" concept on the wrong button**: `Raze2Button.setSelected()` paints
  `#FFFFCC` — that colour is real (§2.5), but it's the **Campaign mission-list row** colour, not a colour
  ever applied to the generic nav button in source. If a future implementation wants a "currently active
  screen" highlight on the nav list, that's a **new design decision**, not a source-accurate one.
- **Version string wrong**: port renders `"v2.0"`; source renders `"v 2.0"` (space after "v",
  `MenuGlobalStats.as:65`, `Main.as:96`).
- **Version tag structurally misplaced**: port renders it as an independent bottom-right label; source
  embeds it as one entry inside the scrolling `MenuGlobalStats` community-stat ticker (§3.4).
- **"Global Stats" is the wrong interaction**: port makes it a clickable nav link to the personal
  `StatsScreen`; source's `MenuGlobalStats` is a passive, non-interactive scrolling ticker of *community-
  wide* totals (§3.4) — these are different features entirely (personal stats do exist in source too, but
  as the separate `"Profile"` frame, reachable via Armory's Profile tab, not from this footer widget).
- **Social/sponsor chrome is text, not icon art**: source uses `mc_sponsor`/`mc_twitter`/`mc_facebook`
  icon symbols; port renders plain text labels ("ARMOR GAMES", "Twitter", "Facebook") in the same
  position/role but without the icon art (§3.2 vs. port table row 3).
- **"Controls ?" tooltip is a stub**: present visually, `onClick` is a no-op; source's `helpinfo` shows an
  actual controls-reference sub-state per current screen (§3.2).
- **Background likely lossy**: single flattened static JPG vs. a probable multi-layer parallax source
  (§3.3) — unverified without deeper FFDec symbol-tree work, flagged as the top candidate for its own
  follow-up spec if the parallax structure turns out to be real and non-trivial.
- **"RAZE 2" logo art unconfirmed**: no scripted symbol found; port's typed wordmark is a plausible but
  unverified stand-in (§3.2).
- **Canvas size mismatch**: source stage is ~800×600px (per doc 13's `helpinfo` x≈785px evidence); the
  port's canvas is 1136×639 (`Config.ts:5-6`) — every absolute x/y coordinate in §3 needs proportional
  rescaling, not literal reuse, when implementing layout.
- **Side panel + options drawer are net-new UI**, correctly labelled as such in the port's own comments —
  not a gap, just worth remembering they have no source-screen counterpart when auditing "does this match
  Raze 2" (they intentionally don't, by design).

## 7. Implementation checklist (for the LATER build phase — do NOT do it now)

1. Build a new shared `MenuBarButton` component (name TBD) that reproduces §2.4 exactly: a ~240×26.5px
   horizontal bar, black-alpha gradient (0.6→0.4→0.0) fill idle, full invert to white-alpha gradient +
   black text on hover, constant `#66CC99`@0.2 outline throughout, BlairMdITC Bold 20pt label at ~80%
   alpha (white idle / black hover), left-anchored text with ~5px inset. Consider a `reverse` prop for the
   `MenuButtonReverse_37` mirrored variant. Affected: new file under `src/ui/raze2/`, or extend
   `Raze2Button`.
2. Retire `ui.ts`'s `makeButton`/`makeImageButton`/the `btn_up/over/down.png` asset trio in favour of the
   new component (or explicitly re-scope `makeButton` to only the drawn-fallback path with corrected
   colours/fonts) — audit every call site (`grep -rn makeButton src/screens`).
3. Add a `C_MENU_BUTTON_OUTLINE = 0x66cc99` constant to `palette.ts`, distinct from `C_OPTIONS_GREEN`, and
   repoint `MenuScreen.ts`'s nav-list `accent` prop at it once the new button exists.
4. Fix the version string to `"v 2.0"` and fold it into a new `GlobalStatsTicker` component that
   marquee-scrolls community stat strings + the version, replacing the current static bottom-right `Text`
   and the "Global Stats"-as-navlink bottom-left `Text`. Affected: `MenuScreen.ts` `buildFooter()`.
5. Rescope the bottom-left link (or a new entry point) to open the existing `StatsScreen` under a label
   that doesn't imply it's the source's ticker (e.g. keep a "My Stats" or fold it into the Armory Profile
   tab flow instead, matching source's actual personal-stats entry point).
6. Replace the text-based "ARMOR GAMES"/"Twitter"/"Facebook" links with icon art once/if the corresponding
   sprite art is extracted from `images/`/`shapes/` (character ids 472/650/653 per doc 13).
7. Implement real "Controls ?" tooltip content (`helpinfo`'s per-frame sub-states) instead of the current
   no-op.
8. Investigate whether the Menu background was originally multi-layer parallax (walk symbol 1177's "Menu"
   frame children in FFDec's GUI, or re-run `-swf2xml` and inspect low-depth `PlaceObject` tags for
   multiple background-sized children with different `translateX` scroll deltas). If confirmed, split
   `menu.jpg` into layers and add parallax scroll to `MenuScreen`; if not confirmed, keep the static image
   but remove the "likely lossy" caveat from this doc.
9. Track down the "RAZE 2" logo art (manual FFDec GUI inspection of symbol 1177's low-depth children) and
   replace `buildWordmark()`'s typed placeholder with extracted art (or a verified font+size+position if
   it does turn out to be text after all).
10. Rescale every absolute coordinate pulled from doc 13 (800×600-relative) to the port's 1136×639 canvas
    before treating any x/y in §3 as literal.

## 8. Open questions / data still missing

- Reference screenshot 5 (`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\5.png`)
  was unavailable in this session (directory did not exist) — re-run this domain's visual-layout claims
  (§3.2 logo, §3.3 background/parallax, exact button label casing) against it once accessible.
- Exact per-instance x/y for the 8 nav buttons on the *current* 1136×639 port canvas equivalent (only the
  original 800×600-relative values are documented, from doc 13, not independently re-derived here).
- Whether the Menu background is genuinely multi-layer parallax in the SWF, or was always a single flat
  composite (checklist item 8) — not resolved in this pass.
- Full symbol/character-id chain for `mc_sponsor`/`mc_twitter`/`mc_facebook` icon art (ids 472/650/653 per
  doc 13, not independently re-verified or extracted to image files here).
- The precise `helpinfo` tooltip content/art per screen (only its existence and state-machine mechanism
  are documented, not its visual content).
- BlackButton_82/BlackButton_84("Weapon_ButtonList")/BlackButton_85("Ability_ButtonList") — smaller
  list-row button variants seen in `sprites/` alongside the two main button symbols — are out of this
  doc's scope (they belong to Armory/Abilities list rows, docs 10/11/14) but are flagged here since they
  share the "one button symbol per screen family" pattern this doc establishes; whoever writes those docs
  should apply the same frame-by-frame-SVG extraction method used in §2.4.
