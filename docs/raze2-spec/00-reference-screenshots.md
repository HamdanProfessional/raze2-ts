# Reference Screenshots — Visual Description

The 9 reference screenshots the user provided live only in the chat (the
`.claude/image-cache/...` path is **not** on disk, so the doc subagents could not
open them — they reconstructed visuals from AS3 + SWF DefineText/sprite dumps).
This file captures what the images actually show, transcribed from the chat by the
orchestrator, so the implementation phase has the visual reference alongside the
AS3 truth. Pair each entry with the matching `NN-*.md` spec (which has the exact
symbol ids / colors / copy from the SWF).

> Colors below are eyeballed approximations — trust the exact `0xRRGGBB` values the
> spec docs recovered from the SWF over these where they conflict.

## #1 — In-game player health bar  (→ 07-hud-healthbar)
A short horizontal floating bar (the unit nameplate, shown above a friendly/player unit).
- Left: small label **"player"** in a light/steel-blue small-caps pixel font.
- The bar body is a thin dark-bordered capsule with a solid fill; player/team-1 tint reads
  as a cyan-blue (~`0x00CCFF`). Fill is continuous (not segmented ticks) and appears to be
  health; a thinner secondary sliver reads as shield.
- Overall very small (a few dozen px wide), sits right above the character's head.

## #2 — In-game alien health bar  (→ 07-hud-healthbar)
Same nameplate widget as #1 but the enemy/alien variant.
- Left label **"Alien"** in a warm gold/orange small-caps font.
- Bar tint is orange/amber (~`0xFF9900`), team-2/enemy coloring. Same capsule shape and size
  as #1. Confirms nameplate color is driven by team (team1 cyan / team2 orange).

## #3 — Human Campaign screen  (→ 10-campaign)
Full-screen menu over the amber Raze-2 city-at-sunset background.
- Title top-center: **"HUMAN CAMPAIGN"** (large white small-caps).
- Left panel: a **mission thumbnail** image (a ruined/zombie scene) with the mission name
  **"Survivor Lookout"** captioned under it, then a multi-line **story description** paragraph.
  Below that a stats block: **Match Type** = (skull icon) Deathmatch · **Kills to Win** = 30 ·
  **Map** = Judgement (Day) · **Extra** = None. A **Difficulty** row with a row of ~8 dots
  (page/selector dots, first filled). Bottom-left button: **"BACK TO CAMPAIGN SELECT"**.
- Right panel: a vertical **mission list**. Row 1 "Breaking In", row 2 "Survivor Lookout"
  (selected/lit), rows 3-14 locked showing a **padlock icon** + "Beat level N to unlock".
  Selected/hover rows have a lighter translucent bar fill; locked rows are dimmer.
- Bottom-right: **"UPGRADES"** and **"START GAME"** links. "v2.0" bottom-right,
  "GLOBAL STATS" bottom-left.

## #4 — Quick Match / play-setup screen  (→ 09-quickmatch-play)
Same amber background + chrome as #3.
- Title top-center **"QUICK MATCH"**, top-right **"WHAT IS THIS ?"**.
- Left: **map preview** image with **‹ Prev  [Dome]  Next ›** carousel, map name "Dome" and a
  description paragraph. Below, a settings stack, each a **‹ value ›** stepper:
  **Match Type** ‹Deathmatch› (with a one-line sub-description "Score points by Killing enemies."),
  **Kills to Win** ‹20›, **Weapons** ‹All›, **Special Mode** ‹None›, **Abilities** ‹On›,
  **Equipment** ‹On›.
- Right: **"+ Add Team"** button, then a roster panel: header **"Free For All"  4 / 12 Players**,
  a **"Player (with 3 bots)"** entry, and a row **Players ‹ 4 ›   Difficulty ‹ Medium ›** steppers.
- Bottom: **"BACK TO MENU"** (left), **"UPGRADES"** + **"START GAME"** (right).

## #5 — Menu / start screen  (→ 08-menu-ui-theme)
The main menu; amber futuristic city skyline with an airship, over which sits a big metallic
**"RAZE 2"** logo (brushed-steel 3D letters, top-center).
- Top-left: Twitter + Facebook glyphs and an **"Armor Games"** crossed-swords logo.
- Top-right: **"CONTROLS ?"**.
- Left menu list (large white small-caps, left-aligned, hover = lighter bar):
  **Campaign · Quick Match · Armory · Achievements · Options · Credits · Play More Games · Play Raze 1**.
- Title bar top-center reads **"MENU"**.
- Bottom-right: **"GAME SAVES TO: THIS WEBSITE"** and an **"Armor Games Enabled / Login now"** chip.
  "v2.0" bottom-right, "GLOBAL STATS" bottom-left.

## #6 — In-game loadout / weapon bar  (→ 11-armory-loadout)
A wide dark metallic strip along the bottom of the HUD.
- Far left: the **selected weapon** panel — a weapon icon with **"X1"** count, a segmented
  **ammo bar**, a **"100%"** readout, and a **green oscilloscope/EKG-style graph** (bright green
  waveform on black) — reads like an energy/heartbeat monitor.
- Middle: **numbered weapon slots 1–8**, each a beveled square tile with the gun's icon;
  the active slot (4) is highlighted with a **yellow** border.
- Bottom: a full-width bar labeled **"Earned: 0 cr"** on the left, **"Credits"** in the middle
  (a teal progress bar), **"Total: 597 cr"** on the right.
- Palette is dark gunmetal with teal/green accents and yellow selection.

## #7 — View Scores (pause) screen  (→ 12-pause-scores)
Pause overlay, "Armor Games" logo top-left, title **"VIEW SCORES"** top-center.
- Left column: mission name **"Survivor Lookout"** + story blurb, then the **pause buttons**
  stacked: **RESUME GAME**, **VIEW SCORES** (current/greyed as active), **OPTIONS**, **QUIT GAME** —
  each a dark beveled bar button.
- Right: the **scoreboard table**, columns **#  Name  Score  Kills  Deaths**. Rows are tinted by
  team: **"Blue Team"** header row in blue (~`0x2E6FB0`), **"Orange Team"** header in orange.
  Player row highlighted. A long list of "Zombie" rows follows; recently-dead rows show a small
  **skull icon** at the right. Alternating dark row striping.

## #8 — Options screen  (→ 13-options-quality)
Pause-style screen, title **"OPTIONS"** top-center, "Armor Games" logo top-left.
- Left column: **"GRAPHIC PRESETS"** — **Ultra / High / Medium / Low / Custom**, each with a small
  blurb ("The highest settings…", "For most computers (recommended).", etc.). **High** is shown
  selected (boxed/lit). Below, the pause buttons **RESUME GAME / VIEW SCORES / OPTIONS / QUIT GAME**.
- Right: **"GRAPHIC DETAILS"** panel with labeled toggles, the active option in **green**
  (~`0x57DEB0`), inactive grey: **Quality** Low/Medium/**High**, **Particles** Low/Medium/**High**/Ultra,
  **Glows** Low/**High**, **Lights & Reflections** Off/**On**, **Ragdoll evaporating** Off/**On**.
- Bottom-right: **"OTHER OPTIONS"** — **Sounds** Off/**On**, **Music** Off/**On**,
  **Bloody Screen** Off/**On**, **Pause Blur** Off/**On** (green = on).

## #9 — Raycast / tracer look  (→ 04-raycast-tracers)
A small in-game crop showing bullet tracers against a dark map interior. The key detail the user
called out: the raycast/tracer is **NOT a solid continuous line** — it renders as **short, broken,
partially-missing segments** (a dashed/gappy streak that looks "half there"), thin and bright,
fading quickly. Reproduce this deliberately-incomplete segmented tracer rather than a clean full
line. (See 04-raycast-tracers for the AS3 segment/alpha mechanism.)
