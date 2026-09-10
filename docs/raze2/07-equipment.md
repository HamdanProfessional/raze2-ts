# Equipment (3 slots)

Source: `Stats_Equipment.as` (definitions), `Unit.as` (loadout resolution into the
runtime `equips` map), and the consumers: `Status.as`, `Guns.as`, `Bullet.as`,
`NodePickup.as`, `KillPoints.as`. Menu/economy wiring: `Menu.as`, `SD.as`.

## 1. Data model

`Stats_Equipment` (`scripts/Stats_Equipment.as:12-38`) is a per-item record:

```
cls:uint     // slot index: 0, 1, or 2
name:String  // display name ("" for hidden/dead entries)
type:String  // key written into unit.equips[type] ("" = no effect)
value:Number // magnitude used by whichever system reads equips[type]
cost:uint    // credits to purchase; 0 = free/placeholder
desc:String  // shop description text
```

Items are registered via `addEquipment(cls, name, type, value, cost, desc)`
(`Stats_Equipment.as:115-125`) into one of three static arrays,
`equip0Ar` / `equip1Ar` / `equip2Ar`, looked up by `getEquipment(cls, index)`
(`Stats_Equipment.as:127-130`), which indexes `Stats_Equipment["equip"+cls+"Ar"][index]`.

The game does not give the three slots proper names in code or UI text beyond
"Equipment slot 0/1/2" (`Menu.as:291` — `txt_equip0/1/2`). By content they group as:

| `cls` | Content theme | Items |
|---|---|---|
| 0 | Survival / defense | Flux Capacitor, Medipack, Armor Plating, Combat Armor, Adrenaline Boost |
| 1 | Utility / economy | Point Allocator, Pickup Booster, Power Extender, Cooling Packs, Shield Battery |
| 2 | Weapon modifier | Stabilizer, Spiral Chamber, Target Marker, Hair Trigger, Extra Clips |

## 2. Full item table (all 21 registered entries)

Registration order == in-array index, per `Stats_Equipment.as:46-78` (item at
`equipXAr[0]` is always `Nothing`). The "Flux Capacitor" line is written through an
obfuscated `§§push`/`§§pop` sequence (`Stats_Equipment.as:47-55`); its argument
order was decoded from the AVM2 stack (findproperty pushes the call target first,
then args in call order, so the fully-resolved call is
`addEquipment(0, "Flux Capacitor", "shield", 0.8, 400, "-20% all damage when you have a shield")`).

| cls | idx | id (`name`) | type | value | cost | desc |
|---|---|---|---|---|---|---|
| 0 | 0 | Nothing | `""` | 0 | 0 | None |
| 0 | 1 | Flux Capacitor | `shield` | 0.8 | 400 | -20% all damage when you have a shield |
| 0 | 2 | Medipack | `hprecover` | 0.2 | 800 | Quickly regenerate health when under 40% |
| 0 | 3 | Armor Plating | `critdef` | 1 | 1200 | Immune to fire and critical hits to head/butt/crotch |
| 0 | 4 | Combat Armor | `health` | 50 | 1600 | +50% max health |
| 0 | 5 | Adrenaline Boost | `final` | 1 | 2000 | Fatal attacks will reduce you to 1% health |
| 0 | 6 | *(hidden, name="")* | `health` | 100 | 0 | "6" (dev placeholder, unreachable) |
| 0 | 7 | *(hidden, name="")* | `health` | 400 | 0 | "7" (dev placeholder, unreachable) |
| 1 | 0 | Nothing | `""` | 0 | 0 | None |
| 1 | 1 | Point Allocator | `credits` | 2 | 600 | +2 Credits earned per kill |
| 1 | 2 | Pickup Booster | `pcboost` | 1.6 | 900 | +60% health/shield from pickups |
| 1 | 3 | Power Extender | `powerup` | 1.4 | 1200 | +40% powerup duration |
| 1 | 4 | Cooling Packs | `recharge` | 1.3 | 1500 | +30% faster ability recharge |
| 1 | 5 | Shield Battery | `spspawn` | 25 | 1800 | Spawn with 25% Shield |
| 1 | 6 | *(hidden, name="")* | `spspawn` | 50 | 0 | "6" (dev placeholder, unreachable) |
| 2 | 0 | Nothing | `""` | 0 | 0 | None |
| 2 | 1 | Stabilizer | `recoil` | 0.6 | 1000 | +40% weapon accuracy |
| 2 | 2 | Spiral Chamber | `range` | 10 | 1200 | Weapons fire further |
| 2 | 3 | Target Marker | `critical` | 1.2 | 1400 | +20% damage to heads, crotches, and butts |
| 2 | 4 | Hair Trigger | `rof` | 0.8 | 1600 | +20% weapon fire speed |
| 2 | 5 | Extra Clips | `ammo` | 1 | 1800 | Pick up weapons with full ammo |

Total registered entries: 8 (cls0) + 7 (cls1) + 6 (cls2) = **21**, matching the
task's "~21 items" — this count includes the 3 `Nothing` placeholders and the 3
hidden dead entries (idx 6/7 in cls0, idx 6 in cls1).

### Hidden / dead entries

`Stats_Equipment.as:64-65,72` register three extra items with blank `name` and a
`desc` that is just the string `"6"` or `"7"` (looks like leftover
index-labeling from development, not real copy). Critically, the shop UI loop in
`Menu.as:1330-1338` only iterates buttons `but_list_<cls>_<idx>` for `idx` in
`0..5` (`while(_loc1_ < 6)`), and the "Legendary Pack" unlock
(`Menu.as:508`) only grants indices `[0,1,2,3,4,5]` per slot. Index 6 (cls0/cls1)
and index 7 (cls0) are therefore **unreachable by any normal or IAP-unlock path**
— dead content. A port does not need a purchasable UI entry for them, but
`getEquipment(cls, idx)` must still resolve them if ever indexed directly (e.g.
save-data corruption / debug tooling parity is not required).

### "Nothing" placeholder

Index 0 of every slot array is `Nothing` (`type:"", value:0, cost:0`). It is the
default-owned, default-equipped item in every slot (see §5) and functionally
means "slot empty" — `type: ""` is never matched by any consumer, so it
contributes no key to the `equips` map.

## 3. Loadout resolution: how one item per slot becomes runtime effects

`Unit.as:186-200`, inside the unit constructor:

```as
equips = {};
if(MatchSettings.isCampaign || MatchSettings.equipsOn) {
   for (i in 0..2) {
      equips[ Stats_Equipment.getEquipment(i, param2["equip"+i]).type ] =
         Stats_Equipment.getEquipment(i, param2["equip"+i]).value;
   }
}
```

- `param2["equip0"/"equip1"/"equip2"]` are the per-slot **array indices** (0-7),
  not ids — this is the unit's spawn loadout, human or AI, sourced from
  `SD.equips` (human) or per-bot config.
- The loop always writes exactly 3 keys into `equips` (one per slot), but since
  `Nothing` has `type:""`, an empty slot's write is a no-op (`equips[""] = 0`,
  never read).
- **Gating**: if the match is not campaign and `MatchSettings.equipsOn` is
  false, `equips` stays `{}` entirely — no equipment effects apply at all for
  that match (toggle at `Menu.as:1145-1152`, `bt_equips_prev/next`).
- Every consumer reads `unit.equips.<type>` directly (a falsy/undefined key is
  treated as "no effect" via truthiness checks, e.g. `if(unit.equips.recoil)`).
- Because it's a flat object keyed by `type`, **two equipped items sharing the
  same `type` string would collide** (last slot processed wins) — not an issue
  in the current table since Slot 0's `health`/`hprecover`/`critdef`/`final`,
  Slot 1's `credits`/`pcboost`/`powerup`/`recharge`/`spspawn`, and Slot 2's
  `recoil`/`range`/`critical`/`rof`/`ammo` are all slot-exclusive.

## 4. Exact passive effects, per `type` key

| type | Item | Formula | File:line |
|---|---|---|---|
| `shield` | Flux Capacitor | While `shCur > 0` and taking damage: `shCur -= dmg * 0.8` instead of `shCur -= dmg` (only reduces the portion absorbed by shield, i.e. shield lasts ~25% longer / effectively -20% damage while shielded) | `Status.as:345` |
| `hprecover` | Medipack | Every frame (`Status.EnterFrame`), if `hpCur < 40` (**absolute HP units, not %**): `heal(unit.equips.hprecover, false)` → heals `+0.2` HP/frame (no VFX, `param2=false`) while below the 40-HP threshold | `Status.as:415-424` |
| `critdef` | Armor Plating | Disables: (a) being set on fire — `param3.extra.setFire` check gated by `!unit.equips.critdef` (`Status.as:236`); (b) head/butt/crotch critical multipliers applied to this unit as *victim* — `headMult`/`buttMult`/`crotchMult` all gated by `!unit.equips.critdef` (`Status.as:274,293,301`) | `Status.as:236,274,293,301` |
| `health` | Combat Armor | At `Status` construction: `hpMax += unit.equips.health` (flat add of 50, not a % multiply despite the "+50% max health" wording — base `hpMax` is 100, so +50 flat ≈ +50% at default settings; in "4x Health" mode base is 400 so the same +50 flat is only +12.5%) | `Status.as:81-91` |
| `final` | Adrenaline Boost | Sets `finalChance = true` on any hit while `hpCur != 1`; if that hit would drop `hpCur < 1`, clamps `hpCur = 1` instead of dying. Re-arms itself any time `hpCur` is not currently exactly 1 (so it can trigger again after healing), preventing infinite-invuln-at-1-hp loops in the same frame | `Status.as:242-244,358-361` |
| `credits` | Point Allocator | When the human player's unit kills a bot (non-teamkill, victim not human): `points += unit.equips.credits` added to the on-screen `KillPoints` popup value (flat +2 per kill) before it's converted to credits | `KillPoints.as:73-82` |
| `pcboost` | Pickup Booster | Both `Status.shield()` and `Status.heal()` multiply the incoming pickup amount by `equips.pcboost` (1.6) instead of adding it raw — applies to health pickups, shield pickups, and (via `heal`) ability/regen sources that route through `heal()` | `Status.as:160,181` |
| `powerup` | Power Extender | Multiplies the duration counters of picked-up powerups by 1.4: `sInvin`, `sDamage` (damage-boost), `sRapid` (rapid-fire) — each is `stat *= equips.powerup` at pickup time in `NodePickup.as` | `NodePickup.as:204-206,223-225,251-253` |
| `recharge` | Cooling Packs | At `Status.setAbility()`: `abilityCharge *= unit.equips.recharge` (1.3) — this is energy gained per frame, so ability special-move energy fills 30% faster | `Status.as:122-130` |
| `spspawn` | Shield Battery | On `Status.reset()` (spawn/respawn): if set, calls `shield(unit.equips.spspawn, false)` — grants 25 shield points at spawn, silently (no VFX) | `Status.as:141-143` |
| `recoil` | Stabilizer | On weapon switch: `dynRecoil = curGun.recoil * unit.equips.recoil` (0.6) — the gun's per-shot recoil/spread value is multiplied down by 40% | `Guns.as:283-287` |
| `range` | Spiral Chamber | On bullet spawn: `maxDist += unit.equips.range` — flat +10 (world units) added to the bullet's travel-distance-before-despawn, computed from `extra.range || stats.range` | `Bullet.as:100-104` |
| `critical` | Target Marker | In `Status.damage()`, for the **attacker's** equips (`param2.equips.critical`, where `param2` is the shooter): after a head/butt/crotch multiplier is already applied to `param1` (damage), it's multiplied again by 1.2 — stacks multiplicatively on top of the gun's own crit multiplier | `Status.as:288-311` |
| `rof` | Hair Trigger | On shot fired: `shootDelay = curGun.shootDelay * (sRapid ? 15 : (!equips.rof ? 30 : 30 * equips.rof))` — replaces the normal "30 frames-per-delay-unit" constant with `30 * 0.8 = 24`, shortening the delay between shots by 20% (≈+25% actual fire rate since rate ∝ 1/delay) | `Guns.as:406` |
| `ammo` | Extra Clips | In `Guns.addClip()` (called when picking up a weapon/ammo crate): if set, forces `param2 = 999` (clip count added), i.e. picking up any weapon tops its reserve ammo off near-instantly instead of adding the pickup's normal small amount | `Guns.as:130-135` |

Note the two flavor-text imprecisions worth flagging for the port: `health`
(Combat Armor) is a **flat +50 HP**, not a true "+50%" scalar; `rof` (Hair
Trigger) is a **delay multiplier of 0.8**, which yields ~+25% fire rate, not
exactly +20%. Implement the mechanic (multiply/add against the underlying
formula), not the rounded description text.

## 5. Economy, ownership, and loadout storage (`SD.as`, `Menu.as`)

- `SD.equips: Array` — length 3, one **array index** per slot (not an id
  string): `SD.equips[cls]` is the currently-equipped index into
  `equipXAr`. Initialized implicitly to `0` (Nothing) per slot.
- `SD.equipsOwned: Array` — length 3, each element an `Array` of owned indices
  for that slot. Initialized to `[[0],[0],[0]]` (`SD.as:155`) — index 0
  (`Nothing`) is always "owned" for free in every slot.
- Both are in `SD.saveList` (`SD.as:107`) and persisted via `SharedObject`
  through `eOwn0/eOwn1/eOwn2` fields (`SD.as:214-216,251-253`).
- **Purchase flow** (`Menu.as:1330-1384`): clicking an unowned slot button
  checks `SD.credits >= getEquipment(cls, idx).cost`; on success it pushes
  `idx` onto `SD.equipsOwned[cls]`, deducts the cost from `SD.credits`, and
  **immediately equips it** (`SD.equips[cls] = idx`) — there is no separate
  "buy" vs. "equip" step. Clicking an already-owned index just re-equips it at
  no cost.
- **One item per slot, hard constraint**: `SD.equips` has exactly 3 slots;
  equipping index `idx` in slot `cls` simply overwrites `SD.equips[cls]` — the
  previous equip in that slot is unequipped (not un-owned) automatically,
  since only one index can occupy a slot at a time.
- **"Toolkit"/equipment achievement**: unlocked the moment a purchase makes
  `SD.equipsOwned[0].length >= 4 && SD.equipsOwned[1].length >= 4 &&
  SD.equipsOwned[2].length >= 4` (`Menu.as:1351-1378`) — i.e. at least 3
  *purchased* items owned in each of the 3 slots (4 including the free
  `Nothing`).
- **Match-level toggle**: `MatchSettings.equipsOn` (quick-match) or
  `MatchSettings.isCampaign` gates whether equips apply at all during a match
  (`Unit.as:187`, toggle UI at `Menu.as:1145-1152,1984-1989`).

## Port status

Port files: `src/game/Equipment.ts`, `src/assets/raze2/equipment.json`
(consumed via `RAZE2_EQUIPMENT`); passive hooks intended for
`src/game/Guns.ts` / `Bullet` / `Status`.

- **Correct**
  - `equipment.json` — all 21 entries (including 3 `Nothing` and 3 hidden
    dead entries) match `Stats_Equipment.as` exactly: `cls`, `name`, `type`,
    `value`, `cost`, `desc`, including the decoded `Flux Capacitor` values
    (0.8 / 400 / "-20%..."). Verified field-by-field against the source table
    in §2.
  - `equipsForSlot()` correctly excludes `Nothing` and the 0-cost hidden
    entries from the shop/loadout list, matching the fact that they are
    unreachable in the original UI.
  - `resolveEquips()` mirrors `Unit.as:186-200`'s `equips[type] = value` map
    construction (including "no type = no effect" for empty/Nothing slots).
  - Economy (`buyEquip`, `isEquipOwned`, `equipCost`, `canBuyEquip`) matches
    the source's "buy = spend + own" flow, and `equipItem()`'s one-slot
    replace-or-clear behavior matches `SD.equips[cls] = idx` overwrite
    semantics (the toggle-off-if-already-equipped behavior in `equipItem` is a
    reasonable UX addition; the original always force-equips and never
    "unequips to Nothing" via re-click, so this is a minor superset, not a
    bug).
  - "Toolkit" achievement gate (own ≥3 purchasable items per slot in all 3
    slots) matches `Menu.as:1351-1378`'s `.length >= 4` (3 purchased + 1 free
    `Nothing`) condition.

- **Wrong / incomplete**
  - The doc's own review (via `Equipment.ts` header comment) says passive
    hooks live in `Guns.ts`/`Bullet`/`Status`, but no consumer of
    `resolveEquips()`/`playerEquips()` was found wired into actual gameplay
    systems at the time of this survey — i.e. `equips.recoil`, `.rof`,
    `.range`, `.ammo`, `.critical` (Guns/Bullet effects), `.shield`,
    `.hprecover`, `.critdef`, `.health`, `.final`, `.pcboost`, `.spspawn`,
    `.recharge` (Status effects), and `.credits` (KillPoints/score) all need
    call sites added per the formulas in §4. Confirm current wiring state in
    the port's `Guns.ts`, `Bullet.ts`, and `Status`-equivalent before assuming
    any of these are live.
  - No equivalent of the "flat +50 HP, not %" and "0.8 delay multiplier, not
    exactly +20% rate" nuances is called out anywhere in the port; a naive
    reimplementation from the `desc` strings alone would get both wrong.
  - `hprecover`'s "under 40%" description is actually an **absolute HP < 40**
    check in source, not a percentage of `hpMax` — worth flagging since
    `hpMax` varies (100 baseline, 150 with Combat Armor, 400 in "4x Health"
    mode), so the effective regen threshold is not proportionally "40%" once
    other equipment/modes change `hpMax`.

- **Missing**
  - No match-level `equipsOn`/`isCampaign` gate equivalent found in the port's
    equipment resolution — `playerEquips()`/`resolveEquips()` always resolve
    the stored loadout with no way to force an empty map when equipment is
    disabled for a given match type.
  - No handling/acknowledgment in the port for the two dead hidden entries'
    unreachability (not required for correctness, but if any tooling
    iterates `RAZE2_EQUIPMENT` for UI generation, it must keep filtering them
    out the way `equipsForSlot` does).
