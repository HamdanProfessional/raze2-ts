# Armory Shop + In-Game Loadout Bar + Credits Economy

## 1. Summary

This domain covers three tightly-coupled systems in Raze 2:

1. **The Armory** — a menu screen (`Menu.as`, frame label `"Armory"`) where the player spends
   **Credits** to unlock weapons, skins, equipment, and abilities, and to choose which of the
   owned items are equipped for the next match. It is reached from the main menu's "Armory"
   button and from the play-setup flow's "Upgrades" button (both call
   `Transition.slideLeft(menfr, "Armory")`).
2. **The in-game loadout bar** — the bottom-centre HUD strip during a match: one numbered slot
   per weapon type the player is carrying, a mini per-slot ammo bar, and (driven by the same
   `Hud` instance) the "Earned / Total credits" read-out. This is reference screenshot **#6**
   per the spec README, built from `Hud.as`/`Hud_WeaponHolder.as`.
3. **The credits economy** — how Credits are earned (per-kill, kill-bonus multipliers,
   end-of-match win/loss bonus, real-money IAP packs) and spent (guns, skins, equipment,
   abilities, in the Armory).

> **Screenshot access note:** reference screenshot `6.png` referenced by the spec README
> (`C:\Users\Hamdan\.claude\image-cache\726bbac7-a4b5-4dbc-a70a-5f8052af9970\6.png`) does **not
> exist on this machine** — the entire `image-cache\<session>` directory is absent (verified via
> `find`/`Glob`, both empty). Everything below about the loadout bar's exact pixel layout is
> reconstructed from `Hud.as` / `Hud_WeaponHolder.as` numeric constants (bar widths, colors,
> slot count) rather than read off the image. A future pass **must** re-open this doc against
* the real screenshot to confirm the visual description in §2.3 and correct anything that was
  inferred rather than measured.

## 2. Raze 2 source of truth

### 2.1 Data classes (catalog + cost tables)

| Class | Path | Role |
|---|---|---|
| `Stats_Guns` | `decompiled_swf/raze 2/scripts/Stats_Guns.as` | Full weapon catalog: `id, sprite, name, race, cost, type (0-7), dmg, …`. `cost < 0` = not sellable (campaign/reward only); `cost == 0` = native starter, always owned. |
| `Stats_Armory` | `.../Stats_Armory.as` | Armory-only view of `Stats_Guns`: `gunsAr[type][slot]` = every gun of that type (owned or not); `gunsArmoryAr[type]` = only guns with `cost >= 0` (i.e. purchasable/ownable, excludes `-1`-cost reward guns like `hrocket2`, `Frozen Death`). `getGun(type, slot)` is the accessor the Armory UI calls everywhere. |
| `Stats_Skins` | `.../Stats_Skins.as` | Skin catalog: `id, frame, cost, blood, race, name`. |
| `Stats_Equipment` | `.../Stats_Equipment.as` | 3 slot arrays `equip0Ar` (Defensive), `equip1Ar` (Utility), `equip2Ar` (Offensive), 6 entries each incl. "Nothing" at index 0. Fields: `cls, name, type, value, cost, desc`. |
| `Stats_Abilities` | `.../Stats_Abilities.as` | 8 abilities in `abilityOrder = ["ammo","cloak","static","heal","sword","grenade","mine","teleport"]`, `getAbility(id)` returns `{cost, rechargeSec, usedEnergy, effect, desc, …}`. (Full ability mechanics belong to doc 14; this doc only needs `.cost` for the Armory price list.) |
| `Stats_KillBonuses` | `.../Stats_KillBonuses.as` | 30 named kill-bonus multipliers, each `{id, worth (credits), name, desc}` — these are the credit *earn* side of the economy, applied in `KillPoints.as`. |
| `SD` | `.../SD.as` | Save data / player profile: `credits` (int, starts at **500**, `SD.as:143`), `gunList[7]` (equipped gun index per type slot), `gunsOwned[7][]`, `skinsOwned[]`, `equips[3]`, `equipsOwned[3][]`, `abilitiesOwned[]`. Persisted via `saveList` (`SD.as:107`). |

### 2.2 Armory shop — UI/flow (`Menu.as`)

The Armory is one MovieClip frame (`menfr`, label `"Armory"`) with sub-tabs switched by
button label; `Menu.MouseDown()` maps button `txt_word` text to a big `switch` (lines
601-780 in `Menu.as`):

| Button label | Target | Notes |
|---|---|---|
| `"Upgrades"` | `Transition.slideLeft(menfr, "Armory")` | Same destination as "Armory" — both entry points land on the Armory screen. |
| `"Armory"` | `Transition.slideLeft(menfr, "Armory")` | From main menu. |
| `"Armory Overview"` | `menfr.gotoAndStop("Armory")` | Direct jump (no slide), from the overview/summary panel. |
| `"Weapons"` / `"Abilities"` / `"Profile"` / `"Equipment"` / `"Kill Bonuses"` | sub-tab switch inside Armory | See §2.2.1-4. |
| `"Give 5000 Credits"` | debug/test button, present in the compiled SWF | Not a real shop feature — leftover dev cheat; case 4 in `MouseDown` is a no-op stub (`break;` with nothing). Confirms a dev-only credits cheat existed but doesn't fire in the shipped build's fallthrough. |
| `"Purchase"` | opens the IAP confirmation frame (`"Purchase Confirmation"`) | See §2.4. |

**Armory frame init** (`Menu.as:277-317`, `case "Armory":`), run every time the frame is
entered:
```
menfr.txt_name.text        = SD.name
menfr.txt_credits.text     = UT.addNumCommas(SD.credits) + " credits"
menfr.txt_ability.text     = <equipped ability name>
menfr.mc_ability            → equipped ability sprite frame
txt_weap0..txt_weap6.text  = "<slot+1> <gun name>"   // 7 equipped-gun labels
txt_equip0..txt_equip2.text = <equipped equipment name>  // 3 equipment labels
setUnit(SD.skin)            // renders the character preview in the equipped skin
mc_preview.mc_player.gotoAndPlay("stand")
```
If the player isn't logged in to the Armor Games account system (`!AGI.isLoggedIn()`), the
3 "Purchase" buttons (`bt_purchase1/2/3`) are hidden — IAP is gated on login.

#### 2.2.1 Weapons tab (`case 9` in the per-frame button-poll switch, `Menu.as:1229-1324`)

- **7 category tabs** (`but_weap0`..`but_weap6`), one per `Stats_Guns.type` (0-6). Clicking
  sets `selWeapType` and calls `setGunList()`.
- Category names, read from `UT.getEl(selWeapType, [...])` (`Menu.as:2481`):
  `["Starter","Side Arm","Close Range","Automatic","Long Range","Heavy","Explosive"]`
  (type **7**, `"Environment"`/melee-utility guns like `sword`/`grenade`/`mine`, is **not** a
  shop tab — those are match-spawned, not player-owned).
- **Up to 8 list slots per category** (`but_list0`..`but_list7`), one per gun of that type
  in `Stats_Armory.gunsArmoryAr[selWeapType]` (`Menu.as:2492-2547`). Slots beyond the
  category's gun count are hidden (`gotoAndStop(1); visible = false`).
- Each list row shows: `txt_name` (gun name), `txt_race` (`"Human"`/`"Alien"`/etc.),
  `mc_weap` (gun sprite icon), and a status/price text with 4 states:

  | State | `txt_status.text` | `textColor` (0xRRGGBB) |
  |---|---|---|
  | Currently equipped | `"Equipped"` | `0xCCCCCC` (13434828→ actually `0xCCCCAC`? — raw dec `13434828`) |
  | Owned, not equipped | `"Owned\nClick to Equip"` | `0xCCCCFF` (dec `13434879`) |
  | Reward-only (`cost == 1` sentinel used for "pack exclusive") | `"Buy a Pack\nto Unlock"` | dec `13543143` |
  | Affordable | `"<cost> cr\nClick to Buy"` | dec `16777164` (≈ `0xFFFFCC`, pale yellow) |
  | Not affordable | `"<cost> cr\nCan't Afford"` | dec `16764108` (≈ `0xFFDA0C`? — actually `0xFFDA... `, a dull amber/red) |

  (Exact hex: `13434828 = 0xCD00CC`? — decimals are cited verbatim from source; convert with
  `n.toString(16)` when implementing. Precise conversions: `13434828 = 0xCD00CC` is wrong by
  hand-math — **do the conversion in code**, don't trust hand arithmetic here.)

- **Buy/equip click** (`Menu.as:1251-1291`): clicking a list slot for a gun you don't own
  purchases it if `SD.credits >= cost` (deduct cost, push to `SD.gunsOwned[type]`, play
  `S_Equip`), or plays `S_Error` if unaffordable or if `cost == 1` (pack-exclusive sentinel,
  can't be bought with credits at all). Clicking an **owned** gun equips it immediately
  (`SD.gunList[type] = slot`), free, no confirmation.
- **Current-weapon stat readout** (`setGunList()`, `Menu.as:2475-2491`) for the selected
  category's *equipped* gun: name, description, type label, and **5 stat bars**, each an
  8-frame MovieClip (`mc_curpow/curacc/curclip/currng/currof`) driven by:
  - Power: `ceil(dmg/100*8)`, using `dmg * (extraShots/2)` instead of `dmg` when the gun has
    an `extraShots` multi-pellet property (so shotgun-type guns show total burst damage).
  - Accuracy: `ceil((10-recoil)/10*8)`.
  - Clip: `ceil(clipSize/50*8)`.
  - Range: `ceil(range/100*8)`.
  - Rate of fire: `ceil((1-shootDelay)/1*8)`.
  - `txt_curspec` shows the gun's one-line `.special` tag (e.g. `"Multi-Shot"`, `"Homing"`,
    `"Headshot++"`).

#### 2.2.2 Skins tab (`"Profile"` button, `case 10` label / skin logic at `Menu.as:1000-1900`)

- Skins are shown filtered by race; `selSkin` cycles with next/prev buttons, wrapping via
  `Stats_Skins.skinAr.length`. `cost == -1` skins (e.g. `"mutate"`, id 14) are skipped when
  cycling — reward-only, not reachable by browsing.
- Buy/equip logic (`Menu.as:1837-1874`): if `SD.skinsOwned.indexOf(selSkin) == -1`, buying
  requires `SD.credits >= Stats_Skins.skinAr[selSkin].cost`; on success:
  `SD.credits -= cost; SD.skin = selSkin; SD.skinsOwned.push(selSkin)`. Already-owned skins
  equip for free with no confirmation.
- Status text mirrors the weapons tab: `"<cost> cr\nCan't Afford"` vs
  `"<cost> cr\nClick to Buy"` (`Menu.as:1782-1790`).

#### 2.2.3 Equipment tab (3 slots × 6 items each, `Menu.as:1325-1420`, `2380-2473`)

- 3 slot columns (`cls` 0/1/2 = Defensive/Utility/Offensive per `Menu.as:2447`:
  `UT.getEl(param1, ["Defensive","Utility","Offensive"])`), 6 buttons each
  (`but_list_<slot>_<item>`), item 0 is always `"Nothing"` (free, no effect).
- Buying an item (`Menu.as:1340-1384`): requires `SD.credits >= cost`; on purchase, pushes
  to `SD.equipsOwned[slot]` and immediately equips (`SD.equips[slot] = item`). Owning **4 or
  more items in all 3 slots simultaneously** unlocks the `"equipment"` achievement
  (`Stats_Achievements.setAchievement("equipment")`, `Menu.as:1351-1379`).
- Currently-equipped item per slot is mirrored to `txt_<slot>_name` / `txt_<slot>_desc` for
  a persistent "equipped" summary panel (`Menu.as:2466-2472`).

#### 2.2.4 Abilities tab (`case 8`, `Menu.as:1214-1228`, `2280-2372`)

- Single flat grid (no sub-tabs) over `Stats_Abilities.abilityOrder` (8 entries). Clicking an
  unowned ability buys it if affordable (`Menu.as:2359-2368`); owning **5 or more** abilities
  triggers... (achievement check continues past the excerpted range — not required for this
  doc; see doc 14 for full ability mechanics). Equipping picks the *one* active ability
  (`SD.ability`), shown in the Armory header (`txt_ability` / `mc_ability`).

#### 2.2.5 Kill Bonuses tab (`case 12`, `Menu.as:2550+`)

- Read-only browsable list (10 per page) of all 30 `Stats_KillBonuses` entries, showing name,
  description, and `"+<worth> cr"`. Bonuses not yet earned (`SD.bonusesOwned` doesn't contain
  `.num`) show `desc` replaced with `"???"` (mystery/undiscovered) — this tab is a *codex*,
  not a purchase screen.

### 2.3 In-game loadout bar (HUD, reference screenshot #6 — reconstructed, see §1 caveat)

Source: `Hud.as` (class `Hud extends MovieClip`, symbol `symbol1568`) and
`Hud_WeaponHolder.as` (symbol `symbol1447`).

- **7 weapon-holder slots**, `gun0`..`gun6` (`Hud.as:36,46,52,106,112,114,118`), one per
  `Stats_Guns.type` — **not 8** as a naive slot count might suggest; type 7 ("Environment":
  fists/sword/grenade/mine/fire) has no dedicated HUD slot; it overlays the current weapon
  display when active. `Hud` constructor loop: `while(_loc2_ < 7) weapHolders.push(this["gun"+i])`
  (`Hud.as:167-175`), each holder's `txt_num.text = "" + (i+1)` — **1-based slot numbers 1-7**.
- Each `Hud_WeaponHolder` (`Hud_WeaponHolder.as`) exposes `highlight`, `bar_ammo` (mini ammo
  fill), `txt_num` (slot number label), `weapon` (the tilted weapon-icon MovieClip).
- **Selected-slot highlight color**: `colTransOn.color = 16776960` = **`0xFFFF00`** (yellow)
  applied via `ColorTransform` to the selected slot's `bar_ammo` (`Hud.as:183-184, 603-605`).
- **Unselected-slot tint**: `colTransOff.color = 13421772` = **`0xCCCCCC`** (`Hud.as:176-177`).
- **Weapon icon dim-when-empty**: `weapHolders[i].weapon.alpha = (ammo != 0) ? 1 : 0.3`
  (`Hud_WeaponHolder`/`setMiniAmmoBars`, `Hud.as:592-599`) — an out-of-ammo weapon's icon in
  the strip fades to 30% alpha.
- **Per-slot mini ammo bar fill**: `bar_ammo.width = (curClip*clipSize + reserveCur) /
  (clipMax*clipSize) * 56` px (`Hud.as:582-584`) — i.e. total remaining rounds (current clip
  fill converted to round-equivalents + reserve clips) over max carryable rounds, scaled to a
  56px-wide bar.
- **Selected-weapon big ammo display + "oscilloscope/graph" look**: `setAmmoBar()`
  (`Hud.as:451-552`) draws a **grid overlay** (`ammoOutline`, a `MovieClip`, cleared and
  redrawn every weapon switch) with `lineStyle(1, 3355443, 1)` — **`0x333333`** (dark grey)
  1px lines — into up to 4 segmented "clip" rows (`bar_ammo0..bar_ammo3`), each row 14/`n`
  px tall where `n` = number of visible clips (1 clip if `clipSize<=25`, 2 if `<=50`, 3 if
  `<=75`, else 4 — i.e. clips render as horizontal bands, columns within each band mark
  round-count ticks at `58/_loc5_` px intervals where `_loc5_ = clipSize/n`). This tick-grid
  over a filled bar is what reads visually as an "oscilloscope/graph": a green/pale fill bar
  cross-hatched by dark 1px gridlines into per-round and per-clip segments. **The bar's own
  fill color was not directly found as a numeric constant in `Hud.as`** — it is almost
  certainly set on the `bar_ammo0..3` MovieClip symbols themselves inside the SWF library
  (FFDec render needed to confirm the exact green hex; treat as `~0x00FF66`-ish "HUD green"
  pending that render — **open question**, see §6).
- **Credits read-out** lives on the same `Hud` instance, `addPoints()` (`Hud.as:713-719`):
  ```
  SD.credits += n            // wallet total (persists across matches)
  curCredits  += n           // this-match running total ("Earned")
  txt_points.text     = UT.addNumCommas(SD.credits) + " cr"      // "Total"
  txt_pointsearn.text = UT.addNumCommas(curCredits) + " cr"      // "Earned"
  ```
  `curCredits` resets to 0 each match (field default `curCredits:int = 0`, `Hud.as:122`,
  never persisted). `removeCredits()` (`Hud.as:224-233`, used by the Credit Cannon's
  `useCredits` ammo mechanic — see §2.5) mirrors the same two-field update in reverse,
  clamping `SD.credits` at 0.

### 2.4 Credits economy — earning

| Source | Formula / value | File:line |
|---|---|---|
| Per-kill base | `points = 4 + killedUnit.diff * 0.8` (bot difficulty scales the base) | `KillPoints.as:55` |
| Equipment "Point Allocator" | `+ killer.equips.credits` (equipment `type:"credits"`, value `2`, cost `600`) added to `points` if equipped | `KillPoints.as:73-81`, `Stats_Equipment.as:67` |
| Kill-bonus multipliers | `points += bonus.worth` for every matched bonus condition (headshot +4, crotch +5, butt +12, assassin +10, burrow +8, splash direct +3 / indirect +5, spree-ender +10, reflect +4/refBounce +10, juggerkill +15, has-flag +10/+5, mauser +2, no-shield +5, corpse-stick +15, sword +4, fire +2, mine +3, on-fire +2, dead(revenge) +5, low-hp-survive +3, speed +5, invis +12, steal +2, juice/rad novelty +2 each, domination capture-kill +5/defender +5) — full table in `Stats_KillBonuses.as:29-91` (30 entries) | `KillPoints.as` (`addBonus`), `Stats_KillBonuses.as` |
| Objective-mode halving | In `Capture the Flag` / `Domination`, `points = ceil(points * 0.5)` before the kill-bonus additions (objective play is credit-taxed relative to deathmatch) | `KillPoints.as:220-230` |
| Match-wide credit modifier | `points = ceil(points * MatchSettings.creditMod)` — a per-match multiplier (e.g. from difficulty/special modes) applied to every kill's payout | `KillPoints.as:231` |
| End-of-match bonus | `bonus = round((rand(8,13) [*5 if won] + rand(1,10)) * MatchSettings.creditMod)`, added to `SD.credits` when the "gamedone" pause frame is shown; text reads `"Win Bonus\n+N"` or `"Match Bonus\n+N"` | `PauseScreen.as:213-231` |
| IAP: Recruit Pack | `+6,000 cr`, + `Teleport` ability, + `Credit Cannon` gun (type 6, slot 5) | `Menu.as:413-438` |
| IAP: Epic Pack | `+40,000 cr`, + `Teleport`, + `Credit Cannon` | `Menu.as:520-539` |
| IAP: Legendary Pack | `+80,000 cr`, **unlocks every weapon/skin/equipment/ability** (nulls out the owned-arrays' filters, then rebuilds `equipsOwned` to `[0..5]` per slot) | `Menu.as:440-511` |
| Starting balance | `SD.credits = 500` on a fresh save | `SD.as:143` |

### 2.5 Credits economy — spending

Everything in §2.2's tabs (guns, skins, equipment, abilities) is a credit sink; additionally:

- **Golden Mauser** (pistol type, cost 600cr) — deliberately weak weapon whose special
  `"Credits+"` awards the `mauser` kill-bonus (+2cr) on every kill with it.
  (`Stats_Guns.as:169`, bonus in `Stats_KillBonuses.as:68`)
- **Credit Cannon** (`creditsgun`, heavy/rocket-tab slot, cost 6300cr) — its ammo mechanic is
  `useCredits: 4`, i.e. it **drains 4 credits per shot instead of consuming ammo**
  (`Stats_Guns.as:644`); `Hud.removeCredits()` is the runtime hook for this.

## 3. Current port state

### 3.1 `src/game/Armory.ts` (116 lines) — economy/unlock logic, no UI

A clean, hybrid buy-to-unlock model:
- `NATIVE_GUNS` (from `GUN_ORDER`) are always free/owned; Raze 2-catalog guns
  (`RAZE2_WEAPON_BY_ID`) must be bought (`gunCost`, `canBuyGun`, `buyGun`, lines 13-43).
- Skins mirror the same shape (`isSkinUnlocked`/`skinCost`/`canBuySkin`/`buySkin`/`equipSkin`,
  lines 78-116).
- **Design departure from Raze 2**: the port's spawn loadout is **multi-equip** — `equipGun()`
  (lines 58-67) *toggles membership* in `SD.profile.prof_guns[]` (an array, any number of guns
  can be equipped at once, first entry = the one held at spawn) and `droppableGuns()` (lines
  70-76) feeds a shared drop-pool for *pickups* found in the map. Raze 2's `SD.gunList[7]` is
  instead **exactly one equipped gun per of the 7 type-slots**, always full (no "unequipped"
  state) — the player always carries one gun of each type simultaneously, swapped by scrolling
  the loadout bar, and the Armory only changes *which* gun of a type you carry, not *whether*
  you carry that type. This is a meaningful gameplay-shape difference, not just a naming one
  (see gap analysis below).
- Cost/ownership fields (`RAZE2_WEAPON_BY_ID[id].cost`, `RAZE2_SKINS` `.cost`) come from the
  already-extracted `src/assets/raze2/*.json` catalogs (per README §"Already-extracted
  catalogs"), sourced from `Stats_Guns.as`/`Stats_Skins.as` — cost numbers match §2.1/2.4
  exactly (spot-checked: this doc did not re-diff every value; flag as open item if a future
  pass wants a byte-for-byte cost audit).
- No equipment/abilities logic lives in `Armory.ts` — those are in separate
  `src/game/Equipment.ts` / `src/game/Abilities.ts` (referenced by `ArmoryScreen.ts` imports,
  not read in depth for this doc — belongs primarily to doc 14).

### 3.2 `src/screens/ArmoryScreen.ts` (402 lines) — the shop UI

- Single screen, 4 top-level mode buttons (`WEAPONS / SKINS / EQUIPMENT / ABILITIES`,
  lines 70-83) instead of Raze 2's `Weapons / Profile(skins) / Equipment / Abilities / Kill
  Bonuses` 5-tab layout — **Kill Bonuses codex tab is not ported** (see gap analysis).
  "Upgrades" as a separate menu entry-point that also lands here is likewise not modeled
  (there's presumably one `MenuScreen` button leading here; not verified in this pass).
- Weapon sub-tabs: `WEAPON_CATS` (line 34-37) = `["Starters","Sidearms","Close Range",
  "Automatics","Long Range","Heavies","Explosives"]` — **7 categories**, matching Raze 2's 7
  gun types exactly (name wording is a close paraphrase of `Menu.as:2481`'s
  `["Starter","Side Arm","Close Range","Automatic","Long Range","Heavy","Explosive"]`).
  Correctly excludes type 7 (Environment).
  Skin sub-tabs: `SKIN_RACES = ["Human","Alien","Robot","Zombie"]` (line 38) — matches
  Raze 2 races seen in `Stats_Skins.as` (Human/Alien/Robot/Zombie all present; no 5th race).
  Equipment sub-tabs: `EQUIP_SLOTS = ["Defense","Support","Weapon"]` (line 40) — Raze 2 calls
  these `Defensive / Utility / Offensive` (`Menu.as:2447`); the port's labels are a rename,
  not a structural gap.
- Weapon tile (`weaponTile`, lines 171-218): shows icon, name, `DMG`/`CLIP` stats, `.special`
  tag, and a status label (`EQUIPPED ★ HELD` / `EQUIPPED` / `OWNED` / `REWARD` / `◈<cost>`)
  with a single BUY or EQUIP/UNEQUIP button — collapses Raze 2's read-only 5-bar stat radar
  (Power/Accuracy/Clip/Range/RoF, §2.2.1) down to two raw numbers (`w.dmg`, `w.clipSize`); the
  bar-graph presentation is not ported.
- Skin tile / equipment tile / ability tile (lines 237-387): straightforward
  buy-or-equip cards; functionally equivalent to Raze 2's grid+buy-button pattern, without the
  race-cycling next/prev browse Raze 2 uses (the port shows the whole filtered grid at once,
  which is arguably better UX, not a regression).
- Currency icon `◈` used in place of Raze 2's `"cr"` suffix and comma-grouped numbers
  (`UT.addNumCommas`) — the port does not comma-group credits (`this.creditsText.text =
  \`◈ ${SD.credits}\``, line 142) — cosmetic gap only relevant once balances exceed 4 digits
  (which happens quickly given the >2000cr guns).

### 3.3 `src/screens/LoadoutScreen.ts` (247 lines) — pre-match weapon pick

- This screen has **no direct Raze 2 equivalent** — Raze 2 has no separate "choose your
  starting weapon" screen between play-setup and the match; the player simply spawns with
  whatever `SD.gunList[]` the Armory has equipped for each of the 7 types simultaneously (all
  7 at once, selectable in-match via the loadout bar). The port instead makes the player pick
  **one single starting weapon** from native starters + Armory-equipped Raze 2 guns
  (`this.guns`, lines 58-61), written to `SD.matchSettings.loadoutGun`.
- This is a deliberate design substitution documented in the file's own header comment
  (lines 14-19: "all weapons are available in the match regardless" — implying pickups still
  exist) but it means the port's core carry-model (any single held gun + drops found in-map)
  diverges from Raze 2's model (always carrying one gun per type, swap via number keys/scroll,
  no "starting weapon" choice screen at all). Not necessarily wrong for the port's design, but
  it means **this doc's §2.2.1 Armory "equip a gun into a type slot" flow and this screen serve
  overlapping-but-different purposes** in the port vs. the original.

### 3.4 `src/game/Hud.ts` (loadout-strip portion, lines 96-155, 311-331, 1113-1281)

This is the most faithful piece of the whole domain:
- `SLOT_W/H/GAP = 48/44/6` (lines 99-101), strip re-centred every frame from the live owned-
  weapon count (`drawLoadoutStrip`, lines 1126-1207) — **variable slot count**, unlike Raze 2's
  fixed 7 (`gunOrder.length`-sized pool, only populated slots shown) — a consequence of the
  port's multi-equip model (§3.1) rather than a fidelity bug.
- **Exact color match** to `Hud.as`: `C_SLOT_SELECTED = 0xFFFF00` and
  `C_SLOT_UNSELECTED = 0xCCCCCC` (`src/game/HudComponents.ts:49,51`) reproduce Raze 2's
  `colTransOn.color = 16776960` / `colTransOff.color = 13421772` (`Hud.as:177,184`) exactly.
- Dry-weapon dimming: icon alpha `0.3` when `dry` (line 1177) matches `Hud.as`'s
  `weapon.alpha = 0.3` when out of ammo (`Hud.as:598`) exactly.
- Mini per-slot ammo bar (lines 1188-1205): fraction computed from `curClip+curAmmo` over
  `maxClip+maxAmmo`, filled in the selected/unselected slot color — functionally equivalent to
  `Hud.as`'s `bar_ammo.width` formula (§2.3), though the port's bar sits *inside* the tile
  bottom edge rather than as the tile's fill-color background (Raze 2's `bar_ammo` **is** the
  visible tile surface, tinted by `colTransOn/Off`; the port draws a separate thin bar under a
  static-colored tile — a layout simplification, not a data gap).
  1-based slot numbers (`num.text = String((idx+1) % 10)`, line 1182) match `Hud.as`'s
  `"" + (i+1)` labeling (mod 10 handles a hypothetical 10th slot rolling to `"0"`, which Raze 2
  never needs since it's hard-capped at 7).
- **The grid/"oscilloscope" tick overlay from `setAmmoBar()` (§2.3) is not ported** — the big
  centre ammo read-out (`drawAmmoReadout`, lines 1214-1270) shows plain `curClip` / `curAmmo`
  numbers (`ammoClip`/`ammoReserve` texts) with no per-round tick-grid visual. This is the
  single largest visual gap between the port and the described Raze 2 selected-weapon panel.
- **Credits bar** (`drawCredits`, lines 1276-1281): reproduces the Earned/Total split exactly
  (`creditBaseline = SD.credits` at HUD construction, line 503; `earned = total -
  creditBaseline` each frame) — functionally identical to `Hud.as`'s `curCredits`/`SD.credits`
  pair (§2.3), using `addNumCommas` for both (matches `UT.addNumCommas`).
  Layout: bottom-right, `CRED_RIGHT = GAME_WIDTH - M - 6`, `CRED_Y = GAME_HEIGHT - M - 40`
  (lines 108-109), earned label above total (lines 504-514) — smaller "Earned" text
  (`fontSize 13`, `C_DIM`) over larger "Total" (`fontSize 18`, `C_ACCENT`), a legible ordering
  Raze 2's raw `txt_points`/`txt_pointsearn` text fields don't obviously prescribe (their
  relative screen position wasn't determined from code alone — another item needing the actual
  screenshot, see §6).

## 4. Gap analysis

| # | Raze 2 target | Port today | Severity |
|---|---|---|---|
| 1 | Player equips **exactly one gun per each of 7 fixed type-slots**, always carrying all 7 simultaneously, swapped via number keys during a match. | Player equips an arbitrary *set* of guns (`prof_guns[]`, toggle on/off) with no fixed per-type slot; carry count is variable, not always 7. | High — this is a core carry-model divergence, not a cosmetic one. Affects Armory equip semantics, loadout-bar slot count, and pickup/drop pool design (`droppableGuns`). |
| 2 | No "choose 1 starting weapon" screen; Armory alone determines the 7 carried guns. | `LoadoutScreen.ts` inserts an extra pre-match "pick your one starting weapon" step. | Medium — a deliberate design choice, but should be flagged as a scope decision rather than an oversight when doc-driven implementation happens. |
| 3 | Armory has **5 tabs**: Weapons, Profile(Skins), Equipment, Abilities, **Kill Bonuses** (read-only codex of all 30 bonus types + earned status). | `ArmoryScreen.ts` has 4 tabs; no Kill Bonuses codex UI at all (though `Stats_KillBonuses`-equivalent data likely exists elsewhere for gameplay — not checked in this doc). | Medium — a whole tab of content (30 named bonuses, their credit values, discovery/mystery-until-earned state) is unimplemented as UI. |
| 4 | Per-gun stat readout is a **5-bar radar** (Power/Accuracy/Clip/Range/RoF), each an 8-step bar, with an exact formula per stat (§2.2.1). | Weapon tile shows only 2 raw numbers (`DMG`, `CLIP`). | Low-medium — cosmetic/informational richness gap; doesn't block gameplay but is a visible fidelity loss in the shop. |
| 5 | Buy/equip status text has **5 distinct states** with specific colors (Equipped / Owned-click-to-equip / Pack-exclusive-locked / Affordable / Can't-afford), all with unique hex-ish decimal colors. | Port's status text has 5 comparable states (`EQUIPPED ★ HELD` / `EQUIPPED` / `OWNED` / `REWARD` / `◈cost`) but different color choices (`0x8bffa0` green-ish for equipped/owned, `0xffcc33` for reward, `0xffe08a`/`0xd8604a` for affordable/not) not reverse-derived from Raze 2's decimal constants. | Low — same state machine, different (and arguably more legible) palette; not a functional gap, just unverified-against-source colors. |
| 6 | Credits shown with **comma-grouping** everywhere (`UT.addNumCommas`), unit suffix `"cr"`/`"credits"`. | `ArmoryScreen.ts` shows raw `◈ ${SD.credits}` with no comma grouping; `Hud.ts`'s HUD credits bar *does* use `addNumCommas` correctly. | Low — cosmetic, only the Armory header is affected (HUD is already correct). |
| 7 | Selected-weapon ammo readout uses a **tick-grid ("oscilloscope") overlay**, segmenting the bar into per-round and per-clip bands. | `drawAmmoReadout` shows plain numeric clip/reserve counts, no grid-bar visual at all — the "big ammo bar" as a graphical element doesn't exist in the port; it's pure text. | Medium — this is the single most visually distinctive HUD element named in the task brief ("green oscilloscope/graph") and it's entirely unported. |
| 8 | IAP credit packs (Recruit/Epic/Legendary: +6,000/+40,000/+80,000cr plus item grants, gated on Armor Games account login). | Not applicable / not ported (no real-money IAP system in the port at all, and no evidence one is planned). | N/A — likely permanently out of scope (see open questions). |
| 9 | `Stats_Armory.gunsArmoryAr` explicitly excludes `cost < 0` guns (e.g. `hrocket2`/"Frozen Death", `cost: -1`) from ever appearing as purchasable — those are campaign/achievement-reward-only. | `Armory.ts`'s `gunCost()` returns `Infinity` for `cost < 0` and the UI shows `"REWARD"` — functionally equivalent, confirmed correct. | None — ported correctly. |
| 10 | Equipment "own 4+ in every slot" and Ability "own 5+" trigger achievements. | Not checked in this pass (belongs to doc 14 / an achievements doc); flag as unverified. | Unknown |
| 11 | Golden Mauser + Credit Cannon "credits as ammo/reward" special mechanics (§2.5) are gun-level special cases wired through `Hud.removeCredits()` / kill-bonus `mauser`. | `Armory.ts`/`ArmoryScreen.ts` don't need to model these (they're weapon-firing mechanics, not shop mechanics) — but the **credit-earning side** (kill-bonus worth table, §2.4) should be checked against wherever the port implements kill credit awards (not `Armory.ts` — likely a `KillBonus.ts`, referenced in `Armory.ts`'s own header comment line 5, not read in this pass). | Unknown — out of this doc's file set; flag for cross-check against doc covering kill-feed/scoring. |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. **Confirm the carry-model decision** before touching anything else: either (a) port
   Raze 2's fixed-7-type-slot model into `Armory.ts`/`LoadoutScreen.ts`/`Hud.ts`, replacing
   `prof_guns[]` toggle-equip with a `gunList[7]` per-type-slot equip, or (b) explicitly keep
   the current multi-equip model and update this doc's gap #1/#2 to "accepted design
   deviation" instead of "gap". This is a prerequisite decision, not a mechanical port step.
2. Re-open this doc against the real `6.png` screenshot (once available) and correct §2.3's
   inferred bar-fill color and the Earned/Total relative layout before implementing the
   "oscilloscope" tick-grid ammo bar (gap #7) in `Hud.ts`'s `drawAmmoReadout`.
3. Add the tick-grid overlay to the selected-weapon ammo readout: port `setAmmoBar()`'s
   segmentation logic (1/2/3/4 clip-bands based on `clipSize` thresholds 25/50/75, `0x333333`
   grid lines) into a new `Hud.ts` drawing routine, replacing the current plain-text
   `ammoClip`/`ammoReserve` display (or supplementing it with the bar underneath).
4. Add a **Kill Bonuses tab** to `ArmoryScreen.ts`: a read-only, paginated (10/page to match
   Raze 2, or single-scroll) list of all kill-bonus entries with name/desc/worth, and a
   "???" mystery-description state for undiscovered bonuses (needs an `SD.bonusesOwned`-
   equivalent tracking array if one doesn't already exist — check `KillBonus.ts`/`SD.ts`).
5. Expand the weapon tile's stat display from 2 numbers to the 5-bar radar (Power/Accuracy/
   Clip/Range/RoF), reusing the exact `ceil(x/y*8)` formulas from §2.2.1 so the bar step-counts
   match Raze 2 1:1.
6. Comma-group `ArmoryScreen.ts`'s credits header (reuse the `addNumCommas` helper already
   used in `Hud.ts`).
7. Cross-check the kill-credit earn formula (base `4 + diff*0.8`, kill-bonus worths, objective-
   mode halving, `creditMod` multiplier, end-of-match bonus formula) against wherever the port
   currently awards credits on kill (likely `KillBonus.ts`, not read in this pass) and note any
   divergence in that file's own doc (probably doc 15, "kill-bonuses" is listed there) — this
   doc only specifies the Raze 2 target numbers (§2.4), it does not audit the port's
   implementation of them.
8. Decide + document (as an explicit non-goal if skipped) whether the IAP credit-pack system
   (§2.4/gap #8) gets a port-side equivalent (e.g. a debug/cheat menu granting +6000/+40000/
   +80000 credits) — likely not worth porting as real IAP, but the "cheat credits" dev-button
   behavior (`"Give 5000 Credits"`, currently a no-op stub even in the original) could be a
   handy debug tool worth keeping in mind for `SD.ts`.

## 6. Open questions / data still missing

- **The reference screenshot (`6.png`) was unavailable in this environment** (entire
  image-cache session directory missing). §2.3's visual reconstruction from `Hud.as` numeric
  constants should be treated as provisional until someone re-runs this check with the actual
  image, especially: (a) the selected-weapon ammo bar's fill color (only the grid-line color,
  `0x333333`, was found in code — the fill itself is presumably set on the SWF library symbol,
  not in ActionScript), (b) the exact relative screen position/size of the Earned vs. Total
  credits text, (c) whether the loadout strip in the screenshot shows 7 or fewer visible slots
  (some weapon types may be unowned/hidden at the point the screenshot was taken).
- **Exact hex conversions for the Armory status-text decimal colors** (`13434828`,
  `13434879`, `13543143`, `16777164`, `16764108`) were **not hand-converted** in this doc — do
  the `Number(x).toString(16)` conversion in code/tooling rather than trusting a manual
  hex-from-decimal calculation, to avoid transcription error propagating into the port.
- **The "5 abilities owned" achievement threshold logic** (`Menu.as` around line 2364,
  `if(SD.abilitiesOwned.length >= 5)`) was seen but its consequence (which achievement fires)
  was not traced — likely belongs to an achievements-focused doc, flagged here only because it
  was noticed adjacent to ability-buy code.
- **`Stats_Guns`'s `type` field only goes 0-7** (7 = Environment/melee, not shop-purchasable) —
  confirmed by both `Stats_Armory.Init()`'s `gunsAr = new Array(8)` and the Armory UI's
  `while(_loc1_ < 7)` category loop (`Menu.as:283`, `:1231`) — consistent throughout, no
  contradiction found, but worth a second pair of eyes since 8 vs. 7 off-by-one errors are an
  easy trap here.
- **Whether `Equipment.ts`/`Abilities.ts` (imported by `ArmoryScreen.ts` but not read in depth
  for this doc) already match `Stats_Equipment.as`/`Stats_Abilities.as`'s cost tables 1:1** was
  not verified — this doc trusted the existing `RAZE2_*` JSON catalogs (per the spec README's
  "already extracted" claim) without a line-by-line cost diff. A future pass should diff
  `src/assets/raze2/equipment.json` / `abilities.json` against §2.2.3/§2.2.4's cost tables
  above.
- **`MatchSettings.creditMod`'s actual value(s)** (referenced twice in the earn formulas,
  `KillPoints.as:231`, `PauseScreen.as:220`) were not tracked down to their source/definition
  in this pass — likely set per difficulty or special-mode in a `MatchSettings.as` not opened
  here; needed for a byte-accurate port of the earn-rate formulas in checklist item 7.
