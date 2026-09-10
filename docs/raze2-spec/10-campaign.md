# Campaign — Screen, 30 Missions, Cutscenes

## 1. Summary

Raze 2's single-player content is a fixed, linear **Campaign** of 30 missions split into two
15-mission arcs: the **Human Campaign** (you play Raze / J. Rockit's unit, fighting zombies then
aliens to recover four "artifacts") and the **Alien Campaign** (unlocked only after beating the
Human Campaign; you play an Alien Commander retrieving the same artifacts from the humans — a
mirror-universe retelling of the same story beats). Each mission is a hand-scripted match: a fixed
map, game mode, score cap, a named bot roster with fixed skins/levels/weapons/abilities, a text
briefing, and (in some missions) mid-match scripted dialogue lines and/or spawn events triggered by
elapsed time or score thresholds. Nine of the thirty missions also bracket the match with a
**Cutscene** — a static comic-panel viewer (`Cutscene.as`) that plays a numbered sequence of comic
frames with a music cue before ("pre") and/or after ("post") the mission.

The Campaign **menu screen** (reference screenshot 3, `#3` in the map — *could not be loaded this
session, see §6*) is a single panel: a species header ("HUMAN CAMPAIGN"/"ALIEN CAMPAIGN") with a
tab to switch arcs, a scrollable 15-row mission list on one side (unlocked rows read `"N. Title"`,
locked rows show a padlock glyph + `"Beat level N to unlock"` in light grey), and a preview panel
on the other side showing the selected mission's map screenshot, title, briefing text, and four
labelled read-outs (**Match Type**, **Kills to Win** — the label itself changes per mode, **Map**,
**Extra**) plus a difficulty indicator. A bottom bar offers **Back to Campaign Select** (species
picker) / **Upgrades** (Armory) / **Start Game**.

## 2. Raze 2 source of truth

### 2.1 Files

| File | Role |
|---|---|
| `decompiled_swf/raze 2/scripts/Stats_Campaign.as` (2502 lines) | All 30 missions' data: `setMatch(type, level)` dispatches to `setStats(...)` + `addBot(...)` calls per mission (lines 52–946); `runScripts(game)` (lines 1105–2419) is the per-frame scripted-event driver (dialogue, delayed spawns, unit-extra toggles) for every mission; `setWeapon`/`setEquip` (953–1103) turn a skin-family keyword into gun-slot/equip-slot arrays. |
| `decompiled_swf/raze 2/scripts/Cutscene.as` (201 lines) | The comic-panel viewer class. `MatchSettings[type + "CutSong"]` / `MatchSettings[type + "CutFrames"]` (`type` = `"pre"`/`"post"`) drive `gotoAndStop(frames[curFrame])`; Next/Previous buttons step through `frames`; last pre-frame button becomes "Start Game", last post-frame button becomes "Back to Campaign". |
| `decompiled_swf/raze 2/scripts/Game.as` (relevant: 610–670) | `destroy()`: on a campaign win, increments `SD.campStage` only if `SD.campStage` still equals the mission just played (`MatchSettings.matchLevel`, offset by 15 for the alien arc) — i.e. replaying an already-cleared mission does not advance progress. If `MatchSettings.postCutFrames` is set, launches `Cutscene({type:"post"})` instead of returning straight to the menu. |
| `decompiled_swf/raze 2/scripts/Menu.as` (196–247 list build, 1641–1721 `setCampaign()` preview builder, 966–994 tab/row click handling) | The actual Campaign Select screen: `"Human Campaign"`/`"Alien Campaign"` frame-enter blocks paint the 15 `but_listN` rows (locked = `textColor 13421772` (`0xCCCCCC`) + frame 4 + `"Beat level N to unlock"`); `setCampaign()` fills `img_map` (a screenshot MovieClip keyed by `map.id`), `txt_matchtitle`, `txt_desc`, `txt_type`/`mc_type`, `txt_score` + `txt_scoretype` (label depends on mode), `txt_extra` = `MatchSettings.matchExtra`, and `mc_diff.gotoAndStop(MatchSettings.overallDiff)`. |
| `decompiled_swf/raze 2/scripts/SD.as` (61, 107, 144–150, 197–232) | `campStage:uint` (0-based, default `0`) is the persisted unlock cursor, saved in `saveList`. |
| `raze-ts/src/assets/raze2/campaign.json` (3927 lines) | Pre-extracted per-mission data (see §2.3) — this is the primary data source the port already has; it is missing a few fields present in the AS3 (see §4). |

### 2.2 Data model per mission (`setStats`, `Stats_Campaign.as:2465`)

```
setStats(winScore, type, teams, mapName, overallDiff, playerSkin, song, matchName, matchDesc)
```
sets `MatchSettings.{winScore, type, map, teams, overallDiff, player.skin, matchName, matchDesc,
song}` and resets `matchExtra = "None"`, `weaponsUsed = "All"`, `specialMode = "None"`,
`abilitiesOn = true`, `equipsOn = false`. `addBot(name, team, skin, level, weapons[], ability,
equip[], extra?)` (`:2440`) pushes one scripted bot; `extra` is a free-form object (`spawn`,
`noSpawn`, `aimPlayer`, `speak`, `startWeap`, `lives`, `dblFire`, `permInvis`, `x`/`y`) consumed by
`runScripts`. `setCutscene(preSong, preFrames[], postSong, postFrames[])` (`:2432`) sets the four
`MatchSettings.preCut*`/`postCut*` fields the `Cutscene` class reads.

`setWeapon(skinFamily)` (`:1053`) returns a 7-slot gun-index array `[pistol?,shotgun?,smg?,
rifle?,launcher?,sniper?,special?]`-shaped per family, e.g. `"johnny"` → `[2,1,3,0,0,0,1]`,
`"alien"` → `[1,3,1,1,2,2,2]`, `"zombie"` → `[0,4,0,0,0,0,0]`, `"explosives"` → `[0,2,4,4,3,4,1]`.
`setEquip(skinFamily)` (`:957`) maps the family to an index 0–11, then a second table (`:1002`,
`Stats_Armory`-style loadout arrays) turns that index into a 3-slot equip preset, e.g. `"raze"`→0→
`[5,2,3]`, `"johnny"`→3→`[5,2,2]`, `"commander"`→8→`[1,6,4]`. (Full detail belongs to doc 11/14 —
noted here only because `addBot`'s `equip` arg is one of these keywords.)

### 2.3 `campaign.json` extracted fields (per mission)

`stage` (0-based index within its arm), `scoreCap`, `mode` (full name, e.g. `"Deathmatch"`),
`modeCode`, `teams`, `map`, `overallDiff` (**1–9**, not 1–5 — see §4), `playerSkin`, `music`
(`"M_*"` key or `null`), `title`, `desc` (briefing), `cutscene` (`{preSong,preFrames,postSong,
postFrames}` — `preFrames`/`postFrames` are stringified arrays, e.g. `"[13,1,2]"`), `bots[]`
(`{name, team, skin, level, weapon, ability, equip, extra, raw}`), `messages[]`
(`{whoUnit, whoPortrait, text, time, speaker}`). **`matchExtra` (the "Extra" readout text) and the
exact `runScripts` trigger conditions are not present in this file** — see §4.

### 2.4 The 30 missions — full data

Numbering below is the port's 1–30 stage index (`1–15` human, `16–30` alien); "stage" is the
0-based `Stats_Campaign` index used in `setMatch(campType, stage)`. Dialogue lines are quoted
verbatim from `campaign.json`/`Stats_Campaign.as`, in trigger order, tagged `[u<N>]` for
`whoUnit`/`units[N]` (`u0` = the player unit in some entries, `unull` = no unit tag in the source —
these render as an untagged HUD line in the original) with the display duration in seconds where
the source specified one. `Extra` in the bot table is the `addBot(...)`'s free-form `extra` object
verbatim (spawn coordinates/node, `noSpawn`, `aimPlayer`, `startWeap` slot override, `lives`,
`dblFire`, `permInvis`).

### HUMAN campaign

#### 1. Breaking In (stage 0)

- Map: `tut` | Mode: Deathmatch | Score cap: 15 | Teams: 2 | overallDiff: 1 | Player skin: `raze` | Song: `M_Throwdown`
- Cutscene: pre = `M_Infernal` / frames `[13,1,2]` — post = `M_Throwdown` / frames `[4]`
- Extra (`matchExtra`, `Stats_Campaign.as:64`): `"Weapon: Shotgun"`. Player also gets `noAmmo`, a fixed spawn `{x:138,y:513,node:"a"}`, `ability:"none"`, and `weapons[2]=0` (forced shotgun slot).
- Briefing: It's been 9 years since the last invasion. Relearn the ropes of battle from our highest ranking officer, Johnny Rockit

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 6 | johnny | sword | johnny | aimPlayer=true, speak=b, spawn={x:160,y:513,node:"a"} |
| Alien | 2 | aspace | 3 | alien | none | alien | noSpawn=true |
| Alien | 2 | aspace | 3 | alien | none | alien | noSpawn=true |

Dialogue (`runScripts` case 0, `Stats_Campaign.as:1179-1241`, triggered by `player.sEvent==11` +
`fc==30*N` frame gates, then score thresholds `team1score==5/8/12`):
[u1] "Perfect, communications are online!" (5s, fc=60) — [u1] "Okay {player}, I'll talk to you
through here now." (5s, fc=180) — [u1] "Watch out, here they come!" (5s, fc=300, then at fc=450
J. Rockit stops aiming/speaking and two aliens spawn at fixed nodes) — [u1] "AHHHRRG! Take that!"
(score==5) — [u1] "Hey, remember to use your ability if you're low on ammo!" (6s, score==8) —
[u1] "Just a few more, let's show 'em what we're made of!" (6s, score==12).

#### 2. Survivor Lookout (stage 1)

- Map: `city2` | Mode: Deathmatch | Score cap: 30 | Teams: 2 | overallDiff: 1 | Player skin: `raze` | Song: `M_Necro`
- No cutscene.
- Briefing: One week ago we lost communications with our military ship Echo-1. We believe it was attacked and there may be survivors in a zombie quarantine zone. Go check it out but be warned, there's been reports of many zombies in the area.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny | — |
| Zombie ×2 zurban, zbeach, zelderly, zbiker, zbiker2 (10 total, roster doubled) | 2 | (5 skins, each twice) | 1 | zombie | none | zombie | noSpawn=true |

Dialogue (`runScripts` case 1, `:1242-1319`, delayed spawns at `fc==30*20/30/38/46/54/64`):
[u1] "What... There's no one here?" — "I have a bad feeling about this..." — "Ah, I found one!
Kill it!" (spawns unit[2]) — "Wait a second, more are coming. Stay sharp!" (spawns unit[5]) —
"There's too many of them! Keep shooting!" — "We're surrounded! We need an evacuation! Repeat, we
need an Evac Now!" (8s) — [unull] "Roger, Evac is on it's way. Hold tight guys." (6s) — [unull]
"Landing zone is too hot, kill as many as you can and we'll pick you up!" (7s) — [u1] "Roger that,
let's do this {player}!" (8s).

#### 3. Sweep and Clear (stage 2)

- Map: `city` | Mode: Elimination | Score cap: 20 | Teams: 2 | overallDiff: 1 | Player skin: `mine` | Song: `M_Warhead`
- Extra: `"Weapon: Flamethrower\nEquipment: Armor Plating"` (`:174`). Player: `startWeap=5` (flamethrower slot), `weapons[5]=4`, `equip0=3` (Armor Plating).
- Briefing: We're sending you back in more equipped for the situation. This time you'll have flame throwers and new, flame resistant armor. Clear the city of infected and secure any survivors.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | mine | 9 | explosives | sword | explosives | startWeap=5 |
| Cpt. Biggs | 1 | raze3 | 10 | zombie | none | zombie | noSpawn=true |
| Zombie ×9 (zurban/zbeach/zelderly/zbiker/zbiker2, roster doubled minus one) | 2 | — | 1 | zombie | none | zombie | lives=3, dblFire=true |

Dialogue: [u1] "A survivor? Are you from the crashed Echo-1?" (6s) — [u2] "Yes I'm the captain,
please get out of here!" (6s) — [u1] "Copy that, lets clear out these zombies and I'll call for
evac." (8s) — "Alright lets clean this place up!" (5s) — "Keep your eyes peeled for any survivors"
— [u2] "Hey, don't shoot!" (8s).

#### 4. Cause and Effect (stage 3) — a flashback playing as Cpt. Biggs

- Map: `space2` | Mode: Deathmatch | Score cap: 16 | Teams: 2 | overallDiff: 2 | Player skin: `raze2` | Song: `M_Infernal`
- Cutscene: pre = `M_Theloop` / `[6,8]` — post = *(no song)* / `[10,9]`
- Extra: `"Character: Cpt. Biggs"` (`:251`).
- Briefing: Play as Captain Biggs one week ago, and watch the events that caused his Echo-1 ship to crash, and start the whole alien invasion.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Transport Bot ×3 | 1 | bspace | 6 | robot | static | robot |
| Alien ×3 | 2 | aspace | 4 | alien | none | alien (noSpawn=true) |

Dialogue: [u0] "What the... Why did they attack us?" — "AI, what's the ship status?" — [u1]
"Mainframe: Offline." / "Thrusters: Offline." / "Autocannons: Offline." / "Communications:
Offline." / "Escape Pods: ..." (5s) / "Escape Pods: Operational." (5s) — [u0] "Well at least the...
Incoming! Open fire!" — "What's going on here, why would they attack us?" (6s) — "Help me kill
these aliens fast..." (5s) — "I need to warn the people of earth!" (5s) — [u1] "Affirmative."

#### 5. Retrieval (stage 4)

- Map: `space` | Mode: Capture the Flag | Score cap: 5 | Teams: 2 | overallDiff: 2 | Player skin: `raze` | Song: `M_Ricochet`
- No cutscene.
- Briefing: The aliens must be attacking because they think we have their artifacts. Retrieve them from the crashed wreckage so we can return them and end this war once and for all.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | space | 9 | johnny | sword | johnny |
| Transport Bot ×3 | 2 | bspace | 4 | robot | static | robot |

Dialogue: [u2] "Intruder alert." — "Intruder alert.\nDestroy intruders." — [u1] "What, us? We're on
your side!" — [u2] "Verification failed.\nDestroy intruders." — [u1] "This is no use, we need to
get those artifacts!" (6s) — "Woohoo! Keep it up, almost done!"

#### 6. New Recruits (stage 5)

- Map: `jungle` | Mode: Juggernaut | Score cap: 10 | Teams: 0 (FFA) | overallDiff: 3 | Player skin: `raze` | Song: `M_Throwdown`
- No cutscene.
- Briefing: Before we give back the artifacts, we're having our top scientists look into them. There has to be a reason the aliens want them so badly. In the meantime, show our new recruits how it's done against some training bots in our testing dome.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Training Bot ×5 | 0 | bjungle | 3 | robot | static | robot |

Dialogue (unnamed narrator, `unull`): "Alright recruits, listen up." (5s) — "{player} here is our
top soldier, so take notes." (4s) — "What's going on, why does everyone keep switching teams?" (6s)
— "This is Juggernaut. Everyone is teamed up against the Juggernaut." (6s) — "If you kill the
Juggernaut, you become the Juggernaut." (6s) — "Oh right, I get it." (4s) — "Ohh nicely done, did
everyone see that?" (4s) — "Man, this guy is good..." (4s) — "Wow perfect, just perfect." (4s).
*(This is the mode-explainer mission — worth keeping as the canonical in-fiction Juggernaut
tutorial text if the port ever surfaces mode help text.)*

#### 7. Hold the fort (stage 6)

- Map: `ocean` | Mode: Domination | Score cap: 100 | Teams: 2 | overallDiff: 3 | Player skin: `raze` | Song: `M_Theloop`
- Cutscene: post = *(no song)* / `[14]` (comic-only, no music change).
- Briefing: Our researchers are still looking into the power of the artifacts, but the aliens have discovered the underwater lab. Go there and secure the artifacts, we can't let them go until we know their full potential.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | mine | 9 | johnny | sword | johnny |
| Security Bot ×2 | 1 | bsnow | 5 | robot | static | robot |
| Alien ×3 | 2 | amarine | 5 | alien | mine | alien |
| Zombie | 2 | zbeach | 5 | zombie | none | zombie |

Dialogue: [unull] "Thank god you're here! They're trying to steal the artifacts!" (5s) — [u1] "No
problem brutha, we'll lock these babies down!" (5s) — [u2] "Land Mines detected, Proceed with
caution." (5s) — [u1] "Eugh ah, achoo!" (5s) — "I hate wearing suits." (5s) — "But until I can
breath underwater, I guess I have no choice." (5s) — [unull] "Yes, this is looking good... Keep
defending those artifacts!" (6s) — "I need more time... Just a little longer..." (6s) — "Almost
done..." (5s).

#### 8. My First Mission (stage 7)

- Map: `desert2` | Mode: Deathmatch | Score cap: 15 | Teams: 0 (score by kills-on-team) | overallDiff: 4 | Player skin: `raze` | Song: `M_Rocket`
- Cutscene: post = *(no song)* / `[11]`.
- Briefing: Alien shipyards have been discovered in the desert. They're actually building more ships on our planet. Take the new recruits on their very first mission and show 'em how it's done by getting the most kills on your team.
- Introduces the two recurring squadmates **Md. Sage** (Field Medic, `medic` ability = heal) and **Ex. Treem** (Explosives Specialist, `grenade` ability), who reappear through mission 15.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives |
| Alien ×3 | 2 | adesert | 5 | alien | mine | alien |

Dialogue: [u1] "Alright, you guys ready to see how a real pro does it?" (5s) — "Show 'em how it's
done {player}" (5s) — "Hey, what are you guys doin'? Introduce yourselves!" (5s) — [u2] "Oh right
uh... Field Medic, reporting for duty!" (5s) — [u3] "I'm Treem the Explosives Specialist." (5s) —
"Best stay far from me unless you want to get burned." (5s) — [u1] "That's it? Well you already
know me, expert at close quarters combat." (5s) — "Watch out for those land mines guys, they're
everywhere!" (5s) — [u2] "Woooohooo! I can get used to this!" (5s) — [u3] "Hah, they burn so
easily." (5s).

#### 9. Shocking Discovery (stage 8)

- Map: `snow` | Mode: Domination | Score cap: 150 | Teams: 2 | overallDiff: 5 | Player skin: `raze` | Song: `M_Theloop`
- Cutscene: post = `M_Infernal` / `[12,17,5,20]`.
- Briefing: We've found out the true nature of the artifacts but it seems that the aliens have found their location once again, they seem to be giving out some sort of GPS signal. Secure the artifacts at all costs.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage, Ex. Treem | 1 | rambo/soldier/soldier2 | 9/6/6 | johnny/medic/explosives | sword/heal/grenade | johnny/medic/explosives |
| Alien ×4 | 2 | asnow | 5 | alien | cloak | alien (noSpawn=true) |

Dialogue: [u2] "Okay we're here, let's do this!" (5s) — [u1] "Wait wait, there's no one else
here..." (5s) — [u3] "Yeah, they all got scared and ran home to mama!" (5s) — [u1] "No, something
doesn't feel right..." (5s) — "Ambush! Open fire!" (4s) — [u2] "What, how did they do that?" (5s) —
[u1] "They seem to be using some sort of cloaking device, stay alert!" (5s). *(First mission to
introduce cloaked aliens as an enemy ability.)*

#### 10. Strange Encounter (stage 9) — solo, vs. the Alien Commander

- Map: `desert` | Mode: Elimination | Score cap: 10 (lives) | Teams: 2 | overallDiff: 7 | Player skin: `raze` | Song: `M_Rose`
- No cutscene.
- Briefing: We've lost communications with the Ship Yards and we fear the worst... Your team is currently busy on other assignments, so you'll have to check it out alone.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Commander | 2 | acommander | 6 | commander | teleport | commander |

Dialogue (the villain's boast, reused verbatim as mission 25 "Tormented"'s dialogue from the
alien side): "Greetings human." — "What, surprised I speak your language?" — "We know what you're
planning with the artifacts." — "We will not stop until they are in our possession." — "Earth will
be destroyed, we will prevail." — "Hah hah hah. You're wasting your time human." — "Surrender now,
there is no chance for your race." — "Silence? Your race usually can not stop speaking." — "This is
pointless." — "You Will Fail."

#### 11. Trapped (stage 10)

- Map: `mines` | Mode: Domination | Score cap: 150 | Teams: 2 | overallDiff: 5 | Player skin: `raze` | Song: `M_Necro`
- Cutscene: pre = *(no song)* / `[16]` — post = *(no song)* / `[15]`.
- Briefing: Go to the mines to place the first artifact. There's too many zombies in the area, so you'll need to place the artifact while you fight. Your team is still busy on another assignment, but will soon come to assist you.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage, Ex. Treem | 1 | — | 9/6/6 | johnny/medic/explosives | sword/heal/grenade | — | noSpawn=true (arrive later — see dialogue) |
| Zombie ×4 | 2 | zurban/zbeach/zelderly/zbiker | 3 | zombie | none | zombie | — |

Dialogue: [u4] "Braaiinnns..." (4s) — [u5] "Brraaiins?" (4s) — [u6] "Braaiinnns!" (4s) — [u4]
"... Aaarrtifaacct..." (4s) — [u5] "Aarrtifact..." (4s) — [u1] "Sorry we're late. Did ya miss us?"
(5s, this is when the human squad's `noSpawn` clears and they join the fight) — [u3] "Woo, let's
light 'em up!" (5s).

#### 12. Disposal (stage 11)

- Map: `ocean2` | Mode: Elimination | Score cap: 10 | Teams: 2 | overallDiff: 6 | Player skin: `raze` | Song: `M_Theloop`
- Cutscene: pre = *(no song)* / `[26]` — post = *(no song)* / `[23]`.
- Briefing: One of the artifacts was already placed and activated in the underwater lab but it's now being attacked. Wipe out all enemies in the lab!

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage | 1 | rambo/soldier | 9/6 | johnny/medic | sword/heal | johnny/medic |
| Security Bot | 1 | bsnow | 5 | robot | static | robot |
| Alien ×3 | 2 | amarine | 5 | alien | mine | alien |
| Zombie | 2 | zbeach | 5 | zombie | none | zombie |

Dialogue: [unull] "Sorry, I won't be joining you guys..." (5s, Ex. Treem sits this one out —
matches the roster: no Treem bot this mission) — "Water really gives me the creeps..." (4s) — [u3]
"Worry not. My assistance will be given instead." (5s, the Security Bot volunteering).

#### 13. Reclaimed (stage 12)

- Map: `mines2` | Mode: Capture the Flag | Score cap: 5 | Teams: 2 | overallDiff: 6 | Player skin: `raze` | Song: `M_Rocket`
- No cutscene.
- Briefing: Aliens have discovered the location of our first artifact and are removing it. Head back to the mines and steal it back at all costs. You will receive help from the mine security bots.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage, Ex. Treem | 1 | rambo/soldier/soldier2 | 9/6/6 | johnny/medic/explosives | sword/heal/grenade | — |
| Security Bot ×2 | 1 | bmine | 5 | robot | static | robot |
| Alien ×6 (3 mine-ability, 3 cloak-ability) | 2 | ajungle | 5 | alien | mine / cloak | alien |

Dialogue: [u1] "Alright guys, plain and simple. You know what to do." (5s) — [u3] "Tear 'em up!"
(5s).

#### 14. Mutation (stage 13)

- Map: `snow2` | Mode: Deathmatch | Score cap: 30 | Teams: 2 | overallDiff: 6 | Player skin: `raze` | Song: `M_Ricochet`
- Cutscene: pre = *(no song)* / `[27]` — post = *(no song)* / `[24]`.
- Extra: `"Equipment: Mutation"` (`:433`) — the player is starting to turn.
- Briefing: Place the 3rd artifact. The virus is starting to take effect, you can feel something changing inside you...

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage, Ex. Treem | 1 | — | 9/6/6 | johnny/medic/explosives | sword/heal/grenade | — | lives=2 |
| Alien ×3 (1 mine, 2 cloak) | 2 | asnow | 5 | alien | mine/cloak | alien | — |
| Commander | 2 | acommander | 7 | commander | teleport | commander | lives=6 |

Dialogue: [u1] "Whoa what, this thing is teleporting all over the place!" (5s) — [u2] "I can't hit
him, he's like a monkey on sugar!" (5s) — [u3] "Heh, explosives always seem to do the trick." (5s)
— [u1] "Right, explosives or strong weapons should take him down easily!" (6s).

#### 15. Final Deployment (stage 14) — season finale, playing mutated

- Map: `jungle3` | Mode: Elimination | Score cap: 10 | Teams: 2 | overallDiff: 7 | Player skin: `mutate` | Song: `M_Rose`
- Cutscene: pre = *(no song)* / `[28]` — post = `M_Warhead` / `[25,21,19,22]`.
- Extra: `"Character: Mutated"` (`:446`) — the player unit itself is now the zombie/mutant skin.
- Briefing: The final artifact is ready to be placed. Defeat the enemy with only minutes until the meteor shower hits. You have fully mutated into a Zombie, but the survival of the human race lies within your hands.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit, Md. Sage, Ex. Treem | 1 | — | 9/6/6 | johnny/medic/explosives | sword/heal/grenade | — | lives=2 |
| Commander ×3 | 2 | acommander | 6 | commander | teleport | commander | lives=6 |

Dialogue: [u1] "This is our last shot, we need to kill them before the Meteors hit." (5s) — "If we
can't activate the last artifact in time, earth is doomed..." (5s) — "We have exactly 4 minutes
before it's too late... We can do this!" (7s) — "Before I die... Kill them, please... Kill them
all..." (5s) — [u2] "I've.. learned so much... Thankyou..." (5s) — [u3] "Eugh, it's... been an
honor fighting by your side..." (5s). *(Human squadmates' death lines — the finale is meant to be a
Pyrrhic, sacrificial victory.)*

### ALIEN campaign (unlocked after mission 15 — see §2.5)

#### 16. Misscommunication (stage 0)

- Map: `space2` | Mode: Deathmatch | Score cap: 15 | Teams: 2 | overallDiff: 5 | Player skin: `acommander` | Song: `M_Rocket`
- Cutscene: pre = `M_Theloop` / `[7,31]` — post = *(no song)* / `[40]`.
- Briefing: A human ship has been spotted near our artifact transport ship. Remove all human threats, as the artifacts must travel safely back to our home planet.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 6 | alien | cloak | alien | x=800 |
| Alien | 1 | aspace | 6 | alien | cloak | alien | x=2000 |
| Captain | 2 | raze2 | 7 | johnny | grenade | johnny | — |
| Transport Bot ×2 | 2 | bspace | 6 | robot | static | robot | — |

Dialogue: [u0] "This human must die." (5s) — "We can't allow him to notify his people about our
attack." (6s) — "Human reinforcements is the last thing we need." (6s) — [u4] "Target acquired." —
[u0] "Fight past the machines, defend the artifact with your life!" (6s) — [u1] "Their defenses are
too strong. We are underequipped!" (5s) — [u0] "No, fight as a team, and we will prevail!"

#### 17. Search Party (stage 1)

- Map: `space` | Mode: Domination | Score cap: 150 | Teams: 2 | overallDiff: 5 | Player skin: `acommander` | Song: `M_Theloop`
- No cutscene.
- Briefing: The artifacts are no longer in our ship, search the surrounding wreckage for them.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 6 | alien | cloak | alien |
| Transport Bot ×3 | 2 | bspace | 6 | robot | static | robot |

Dialogue: [u0] "Those artifacts are a top priority. Search every corner." (5s) — [u3] "Intruder
Alert." — [u0] "These bots are nothing but scrap metal. Kill them and keep searching!" (6s) — [u3]
"Identify systems malfunction." (5s) — "Targeting systems malfunction." (5s) — "Rebooting all
Transport Bots..." (5s) — [u0] "Here's our chance to search uninterrupted!" (5s) — [u3] "Reboot
status: 50%" (5s) — "Reboot status: 75%" (5s) — "Reboot Complete. All systems 100%." (5s) —
"Identifaction database not found." (5s) — "Defaulting all personel to 'Intruder' status." (5s) —
[u0] "Great, that should slow down anyone that comes after us." (6s).

#### 18. Invasion (stage 2)

- Map: `tutq2` | Mode: Deathmatch | Score cap: 20 | Teams: 2 | overallDiff: 6 | Player skin: `acommander` | Song: none
- Cutscene: pre = `M_Rose` / `[29,30]` — no post.
- Briefing: The artifacts can not be found... The human must have taken them. Our first plan of action is to destroy their main combat facility.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 6 | alien | cloak | alien | spawn={x:2475,y:1090,node:"o"} |
| Human ("Human") | 2 | rambo | 6 | johnny | sword | johnny | — |
| Raze Soldier | 2 | raze | 6 | raze | ammo | raze | — |

Dialogue: [u0] "Oh no!" — [u1] "What is it commander?" (5s) — [u0] "It's the one they call...
'Raze'" (5s) — "In our first invasion attempt, we fought an elite group." (5s) — "We killed them all
off except this one." (5s) — "This man single handedly defeated us..." (5s) — [u1] "Not this time.
The artifacts will be ours once again!" (5s). *(Direct callback to mission 1's "Breaking In".)*

#### 19. Epidemic (stage 3)

- Map: `city` | Mode: Elimination | Score cap: 10 | Teams: 3 | overallDiff: 5 | Player skin: `acommander` | Song: `M_Ricochet`
- Briefing: We've located the escape pod from the survivor on that ship, it's in the infected city. We must find him and retrieve the artifacts before the humans do!

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 8 | alien | cloak | alien | — |
| Human | 3 | mine | 10 | johnny | sword | johnny | startWeap=5 |
| Survivor | 3 | raze3 | 7 | raze | none | raze | — |
| Zombie ×5 | 2 | zurban/zbeach/zelderly/zbiker/zbiker2 | 6 | zombie | none | zombie | lives=3, dblFire=true |

Dialogue: [u0] "Stay sharp. We must capture the survivor." — [u1] "I don't understand... Was it not
our species who created this virus?" (5s) — "Why are they attacking us." — [u5]
"Alllliiiennnn braaaaiinnnnnnnnnnsssssss" — [u0] "We haven't paid earth a visit in many years. The
infected now follow no one." (7s) — [u6] "BRAIIIINS" — [u1] "The intelectual level of these
creatures is... embarrising... to say the least." (8s) — [u0] "Enough! Capture the survivor and
secure the artifacts!" (5s). *(3-way team fight: Aliens vs. Zombies vs. Humans.)*

#### 20. Discipline (stage 4)

- Map: `mines` | Mode: Juggernaut | Score cap: 15 | Teams: 0 | overallDiff: 5 | Player skin: `acommander` | Song: `M_Necro`
- Briefing: The humans have escaped with the survivor and artifacts. Zombies are no longer allied with us, so head over to the thickest zombie infestation in attempt to gain their loyalty. You'll have to do this alone.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Zombie ×5 | 0 | zurban/zbeach/zelderly/zbiker/zbiker2 | 6 | zombie | none | zombie |

Dialogue (`unull`): "Commander, we've supplied you with a highly delicious brain." (5s) — "The
zombies will all be fighting for it." (5s) — "You need to take the brain, and kill them all." (5s)
— [u0] "What?" — [unull] "This will show your dominence over them." (5s) — [u0] "Right, will do."

#### 21. Breaking Point (stage 5)

- Map: `ocean` | Mode: Elimination | Score cap: 9 | Teams: 3 | overallDiff: 6 | Player skin: `acommander` | Song: `M_Theloop`
- Briefing: We've finally trained the undead to fight along side our soldiers. Our tracking on the artifacts is now working, and we've located them at an underwater facility.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 8 | alien | static | alien |
| Zombie ×2 | 1 | zbeach | 5 | zombie | none | zombie |
| Human ×2 | 2 | mine | 7 | johnny | grenade | johnny / raze |
| Security Bot ×2 | 2 | bsnow | 8 | robot | mine | robot |

Dialogue: [u0] "Watch your step commrads. The security bots are leaving land mines everywhere."
(6s) — [u1] "Well well well... Look what I have found." (5s) — [unull] "Leave me alone... I... I
don't know anything!" (6s) — [u0] "Leave him!" — "A war is not what we want. Our only focus is the
artifacts." (5s) — "That human has no use to us. Let him go." (5s) — [unull] "Ugh... What... They're
letting me go?" (6s). *(A rare mercy beat for the alien side.)*

#### 22. A Strong Defense (stage 6)

- Map: `desert2` | Mode: Deathmatch | Score cap: 25 | Teams: 2 | overallDiff: 6 | Player skin: `acommander` | Song: `M_Rocket`
- Extra: `"Weapon: Acid Hound"` (`:748`).
- Briefing: In an attempt to build our offenses on Earth we've began ship production on various locations. However it appears the humans have found us out. We're equipping everyone on the team with Acid hounds, so be careful where you fire.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 7 | alien | grenade | alien | startWeap=6 |
| Human, Human, Human | 2 | rambo/soldier/soldier2 | 7 | johnny/medic/explosives | sword/heal/grenade | — | — |
| Raze Soldier | 2 | raze | 9 | raze | static | raze | — |

Dialogue: [u0] "We must defend our ships at all cost!" (5s) — "The one they call 'Raze'... He's
back. Was he not killed?" (5s) — [u1] "Commander, we can't kill him. No matter what we do, he
always escapes..." (6s) — [u0] "Hmph, impressive..."

#### 23. Underestimated (stage 7)

- Map: `mines` | Mode: Capture the Flag | Score cap: 10 | Teams: 2 | overallDiff: 6 | Player skin: `acommander` | Song: `M_Necro`
- Cutscene: post = *(no song)* / `[37]`.
- Briefing: The humans are attempting to place one of the artifacts. Stop them at all costs!

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 8 | alien | grenade | alien |
| Zombie ×2 | 1 | zurban/zbiker | 6 | zombie | none | zombie |
| Human, Human, Human | 2 | rambo/soldier/soldier2 | 9/8/8 | johnny/medic/explosives | sword/heal/grenade | — |
| Raze Soldier | 2 | raze | 10 | raze | static | raze |

Dialogue: [u0] "The humans are placing the first artifact. We must stop them!" (6s) — [u2]
"Arrrttiifffaccctt.." (6s).

#### 24. The Ambush (stage 8)

- Map: `snow` | Mode: Deathmatch | Score cap: 25 | Teams: 2 | overallDiff: 6 | Player skin: `acommander` | Song: `M_Theloop`
- Briefing: We've failed to retrieve the artifact from the mines. Use your cloaking to ambush their facility in the north. If we destroy it, it might disrupt their communications.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×3 | 1 | asnow | 8 | alien | cloak | alien | permInvis=true |
| Human, Human, Human | 2 | rambo/soldier/soldier2 | 9/8/8 | johnny/medic/explosives | sword/heal/grenade | — | — |
| Raze Soldier | 2 | raze | 9 | raze | static | raze | — |

Dialogue: [u0] "Alright men, get into position." (5s) — "The humans are here, get equipped and be
ready to strike..." (7s) — "Ready..." (4s) — "Attack!" (5s).

#### 25. Tormented (stage 9) — solo, mirrors mission 10

- Map: `desert` | Mode: Elimination | Score cap: 10 | Teams: 2 | overallDiff: 9 | Player skin: `acommander` | Song: `M_Rose`
- Briefing: We've developed a new technology that allows us to teleport around the field during battle. We purposely sent out a distress call to lure the humans to the shipyards.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Human | 2 | raze | 10 | raze | static | raze2 |

Dialogue: identical boast lines to mission 10 ("Greetings human." … "You Will Fail."), delivered by
the human side this time — the same ten lines, tagged `[u0]` throughout in this arm's script.

#### 26. Artifact Retrieval 101 (stage 10)

- Map: `ocean` | Mode: Capture the Flag | Score cap: 10 | Teams: 2 | overallDiff: 7 | Player skin: `acommander` | Song: `M_Theloop`
- Cutscene: post = *(no song)* / `[38]`.
- Briefing: The humans are placing the 2nd artifact in their underwater facility! Steal the artifact and bring it back to us.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | asnow | 6 | alien | cloak | alien |
| Human, Human, Human | 2 | rambo/soldier/soldier2 | 9/8/8 | johnny/medic/explosives | sword/heal/grenade | — |
| Raze Soldier | 2 | raze | 10 | raze | static | raze |

Dialogue: [u1] "Commander, we're outnumbered!" (5s) — [u0] "Right, so you'll need to be
strategic." (5s) — "Find the fastest and safest route, and stick to it!" (5s) — [u1] "Yes
commander!"

#### 27. Taking out the Trash (stage 11)

- Map: `jungle2` | Mode: Deathmatch | Score cap: 25 | Teams: 2 | overallDiff: 7 | Player skin: `acommander` | Song: `M_Necro`
- Briefing: The humans have been using one of their domes as a training grounds for soldiers. Eliminate the soldiers to ensure their army does not grow any stronger.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 6 | alien | cloak | alien |
| Human ×4 (all `camo` skin) | 2 | camo | 8 | johnny/medic/explosives/raze | sword/heal/grenade/mine | — |

Dialogue: [u1] "I thought these were supposed to be new recruits!" (6s) — [u0] "Looks like they've
been training hard..." (6s) — "Wipe 'em out." (5s).

#### 28. The Pickup (stage 12)

- Map: `space` | Mode: Domination | Score cap: 200 | Teams: 2 | overallDiff: 8 | Player skin: `acommander` | Song: `M_Ricochet`
- Cutscene: post = `M_Throwdown` / `[42]`.
- Briefing: We've received word that the carrier ship we shot down was carrying a very powerful weapon called "Frozen Death". Go secure the weapon. Wipe out any resistance you encounter.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 5 | alien | cloak | alien |
| Security Bot ×3 | 2 | bsnow | 9 | robot2 | static | robot2 |

Dialogue: [u0] "Just like last time, search all corners of this ship!" (6s) — "We need to find that
weapon." (6s).

#### 29. Rocket Race (stage 13)

- Map: `snow2` | Mode: Deathmatch | Score cap: 30 | Teams: 2 | overallDiff: 8 | Player skin: `acommander` | Song: `M_Rocket`
- Cutscene: post = *(no song)* / `[39]`.
- Extra: `"Weapon: Frozen Death"` (`:917`).
- Briefing: The humans have placed 2 of the 4 artifacts, and are about to place the third. Use the recovered weapon "Frozen Death" to kill them before they can place the artifact.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | asnow | 7 | alien | cloak | alien | startWeap=6 |
| Human | 2 | rambo | 9 | johnny | sword | johnny | startWeap=6 |
| Raze Soldier | 2 | raze | 10 | raze2 | static | raze2 | startWeap=6 |

Dialogue: [u0] "Now to try this thing out..." (5s) — [u1] "Commander, that weapon... it's
incredible!" (5s) — "Would be excellent in other battles!" (5s) — [u0] "Seems like it only works in
this cold weather." (6s) — "I don't think I can take it on our next mission." (6s).

#### 30. A Soldiers Demise (stage 14) — alien-arc finale

- Map: `jungle3` | Mode: Elimination | Score cap: 10 | Teams: 2 | overallDiff: 9 | Player skin: `acommander` | Song: `M_Rose`
- Cutscene: post = `M_Infernal` / `[32,33,34,36,35,41]`.
- Briefing: The Humans are placing the final artifact and the meteors are imminent. I'm afraid it's too late for our planet... Take 2 other Commanders, we must do what we can.

| Bot | Team | Skin | Lvl | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Commander ×2 | 1 | acommander | 6 | commander | teleport | commander | — |
| Raze Soldier (mutated) | 2 | mutate | 10 | raze3 | static | raze3 | lives=10, startWeap=6 |
| Human, Human, Human | 2 | rambo/soldier/soldier2 | 9 | johnny/medic/explosives | sword/heal/grenade | — | lives=5, startWeap=3/4/5 |

Dialogue: [u0] "This is it, fellow Commanders." (6s) — "The meteors are heading our way... We have
only 4 minutes." (8s) — "The one known as 'Raze'... He seems to have mutated into a powerful
form." (7s) — "Kill the others first, I want him all to myself." (7s). *(The "Raze Soldier" bot
uses the `mutate` skin — this is the same mutated Raze from mission 15's finale.)*

### 2.5 Progression / unlock rules

- `SD.campStage:uint` (`SD.as:61`) is the persisted 0-based unlock cursor, default `0`.
- `Game.as:641-652` (`destroy()`, win branch only): a completed mission only advances
  `campStage` if `campStage` still equals the mission's own index — i.e. `campStage++` happens iff
  you just cleared the mission at the very front of your unlock cursor (replaying an already-beaten
  mission does not push the cursor further). Human missions compare `campStage == matchLevel`
  (0–14); alien missions compare `campStage - 15 == matchLevel` (so `campStage` runs 15–29 through
  the alien arc, reaching 30 at full completion).
- `Menu.as:196-201` ("Campaign Select" frame): `if (SD.campStage < 15) menfr.nextFrame();` — the
  species-picker frame is skipped straight into "Human Campaign" while the alien arc is still
  locked (there is nothing to pick yet); once `campStage >= 15` the player lands on the split-tab
  screen and can choose either arc.
- `Menu.as:202-224` / `225-247`: building either list colors + labels every row `0..14`; the
  locked-row color is the literal `13421772` (`0xCCCCCC`), locked frame is `4`, and the text is
  `"Beat level " + N + " to unlock"` (1-based row index used in the string, 0-based `_loc1_` loop
  var).
- No explicit "is alien tab enabled" boolean exists in `Menu.as`'s click handler (`966-982`) —
  gating is implicit in the frame-skip above (see §4 for how the port's explicit
  `alienUnlocked` getter differs).

## 3. Current port state

### 3.1 Data (`raze-ts/src/assets/raze2/campaign.json`, `raze-ts/src/game/Campaign.ts`)

- `campaign.json` already carries all 30 missions' `stage/scoreCap/mode/modeCode/teams/map/
  overallDiff/playerSkin/music/title/desc/cutscene/bots/messages` — extracted faithfully from
  `Stats_Campaign.as`'s `setStats`/`addBot`/`setCutscene` calls (verified against source in §2.4
  above; text, skins, levels, weapons, abilities, equip keywords, `extra` objects, and dialogue
  text/order all match).
- `Campaign.ts:getCamp(num)` (1–30 → `{num, settings, ai, messages, cutscene}`) adapts that JSON
  into the shapes `CampaignScreen`/`GameScreen` consume: `campaignMap()` (`:32-38`) remaps a Raze 2
  map id to a shipped level id; `toAi()` (`:114-128`) turns each scripted bot into a `CampaignAi`
  (`pers`, `diff`, `name`, `team`, `skin`, `gun`, `ability`, `equip`, `spawn`, `aimPlayer`).
- `persFor()` (`Campaign.ts:105-112`) infers an AI "personality" (`gamer`/`alien`/`zombie`/
  `robot`/`military`) from the bot's skin string via regex, since the port's `AI` class drives
  chatter/behavior off personality rather than named characters — a deliberate simplification (see
  §4).

### 3.2 Menu screen (`raze-ts/src/screens/CampaignScreen.ts`, 505 lines)

Already a faithful restyle to the port's Raze 2 UI kit (`src/ui/raze2/{palette,fonts}.ts`):
header `"HUMAN CAMPAIGN"`/`"ALIEN CAMPAIGN"` (`C_HEADER = 0xffffff`, `FONT_HEADER`, `A_HEADER =
177/255`) with Human/Alien tab buttons (`:105-152`); a 440×470 preview panel (`:156-218`) with a
screenshot placeholder (live level background texture or a dark plate, not the original's static
map-screenshot art — see §4), title/desc fields, and four stat read-outs (**Match Type**, **Kills
to Win**/label varies by mode, **Map**, **Extra**) plus 5 difficulty dots; a 15-row mission list
(`:252-308`) with locked rows showing `"Beat level N to unlock"` in `C_LOCKED = 0xcccccc` (matches
`Menu.as`'s literal `13421772`) and a 🔒 glyph; a bottom bar (`:322-362`) with Back to Menu /
Upgrades / Start Game buttons. Selection, locking, and launch (`:310-499`) all read/write
`SD.curStage`/`SD.matchSettings` correctly for a single-scene SPA (no per-frame MovieClip
transitions needed).

### 3.3 In-match dialogue + roster (`raze-ts/src/game/GameScreen.ts`)

- `setupMatch()` (`:479-493`): for a campaign match, announces `matchName`/`matchDesc` on the HUD,
  queues `entry.messages` into `this.campMessages` (sorted by `.time`), and swaps in the mission's
  music track (`"M_Foo"` → `"R2_Foo"` key remap).
- `tickCampaignDialogue()` (`:504-513`): once per game frame, increments `this.campFrame` and pops
  any queued message whose `.time <= campFrame`, printing it via `hud.addMessage?.()`.
- `buildRosterLocal()` (`:533-561`, campaign branch `:540-560`): spawns one `AI` per scripted bot
  using `preset` (random 1–20, since scripted `preset` is never populated), `pers`, `diff`, `name`,
  and — if recognized — `gun`/`ability`. Player always joins as `makeSelfPlayer(teamMatch ? 1 : 0)`.

## 4. Gap analysis

| # | Raze 2 target | Port today | Detail |
|---|---|---|---|
| 1 | `MatchSettings.matchExtra` — the literal "Extra" readout string (`"Weapon: Shotgun"`, `"Weapon: Flamethrower\nEquipment: Armor Plating"`, `"Character: Cpt. Biggs"`, `"Equipment: Mutation"`, `"Character: Mutated"`, `"Weapon: Acid Hound"`, `"Weapon: Frozen Death"`, else `"None"`) is set explicitly per mission in `Stats_Campaign.as` (7 missions override it; see §2.4) and read verbatim by `Menu.as:1717` (`txt_extra.text = MatchSettings.matchExtra`). | **Not extracted at all** — `campaign.json` has no `matchExtra`/`extra` string field. `CampaignScreen.ts:458` fabricates the "Extra" line as `` `Weapons set ${s.weapons}` `` (always false/0 in campaign data) or `` `${entry.ai.length} enemies` `` — i.e. it always shows an enemy count, never the real text. | Re-extract `matchExtra` per `setMatch` case (grep `matchExtra = ` in `Stats_Campaign.as`, 7 hits + the `"None"` default at `:2468`) into `campaign.json`, and read it straight in `CampaignScreen.paintPreview()`. |
| 2 | Difficulty indicator is `mc_diff.gotoAndStop(MatchSettings.overallDiff)` — `overallDiff` ranges **1–9** across the 30 missions (human: 1,1,1,2,2,3,4,5,7,5,6,6,6,7,7; alien: 5,5,6,5,5,6,6,6,6,9,7,7,8,8,9), i.e. a 9-frame MovieClip, not a 5-dot meter. | `CampaignScreen.paintPreview()` (`:460-469`) computes 5 dots from `entry.ai`'s *average bot `diff` field* (itself derived from bot `level/4`, clamped 0.5–2.4, in `Campaign.ts:toAi`) — a different, invented metric that ignores the mission's actual `overallDiff` entirely (which **is** present in `campaign.json` and simply dropped by `getCamp()`/`CampaignSettings`). | Thread `raw.overallDiff` through `CampaignSettings`, and either extend the dot meter to 9 steps or rescale `overallDiff` (1–9) onto a 5-dot display consistently — but use the real field, not a derived bot-level average. |
| 3 | `Menu.as:1680` — `img_map.gotoAndStop(MatchSettings.map.id)`: a purpose-drawn static screenshot/illustration per map, embedded in the SWF, shown at a fixed size in the preview panel. | `CampaignScreen.paintPreview()` (`:424-437`) tries `Backgrounds.getTexture(s.level)` (the *live in-game parallax background layer*, stretched to 400×180) and falls back to a plain dark rectangle if that texture doesn't exist. No dedicated "campaign thumbnail" art exists in the port at all. | Either accept the live-background stretch as the port's aesthetic (cheap, always available) or extract/author 400×180 thumbnails per map id (`decompiled_swf/raze 2/images`) if the screenshot reference (see §6) turns out to show distinct painterly thumbnails rather than live-render crops. |
| 4 | `jungle3` (missions 15 "Final Deployment" and 30 "A Soldiers Demise" — both story finales) is its own map id, distinct from `jungle`/`jungle2`. | `Campaign.ts:campaignMap()` (`:32-38`) only strips a **trailing "2"** (`id.replace(/2$/, "")`) before falling back to the base name; `"jungle3"` doesn't match that regex, isn't in `AVAILABLE`, and falls all the way through to the **default** `"r2_jungle"` — i.e. both finale missions silently reuse the plain jungle map used by mission 6 ("New Recruits"), not a distinct finale arena. | Add an explicit `jungle3` entry to `AVAILABLE`/the map table (even if it points at the same geometry file as `jungle`/`jungle2` for now, it should be a deliberate choice, documented, not an accidental fallthrough) — flag to whichever doc owns the map catalog (doc 15) if a distinct "jungle3" geometry needs to be sourced/authored. |
| 5 | `runScripts()` (`Stats_Campaign.as:1105-2419`) triggers each dialogue line and every delayed bot spawn off **elapsed match frames** (`param1.fc == 30 * <seconds>`, e.g. `fc==30*76` in mission 2) or **score thresholds** (`matchSettings.team1score == 5`), spreading a mission's ~10 lines and staged spawns across the whole match (minutes). | `GameScreen.tickCampaignDialogue()` (`:504-513`) increments `campFrame` **once per game tick** and fires each queued message once `campFrame >= msg.time`, where `msg.time` is actually the extracted **display-duration argument** of `setCampMsg(unit, text, duration)` (values 4–8), not a trigger frame — at 30fps that condition is satisfied within the first ~8 ticks (well under a second) after match start, so **all of a mission's dialogue effectively fires in a burst at kickoff** instead of being paced through the level, and no delayed bot spawns / mid-match unit toggles (`aimPlayer` clearing, `noSpawn` release, forced `wait()`) are reproduced at all. | This needs a second data-extraction pass over `runScripts()` (line ranges per mission are cited in §2.4/§5) to capture each line's *real* trigger (frame-count or score-threshold) plus any co-triggered spawn/unit-state change, then rebuild `tickCampaignDialogue()` (and the roster builder, for delayed spawns) around that timeline instead of reusing the duration field as a fake delay. |
| 6 | Bot `extra` fields captured in `campaign.json` (`spawn` coordinates/node, `noSpawn`, `aimPlayer`, `startWeap`, `lives`, `dblFire`, `permInvis`, `speak`) are consumed by `runScripts()` to fix spawn points, gate a bot's spawn until a scripted trigger, focus a scripted ally's aim on the player, override which weapon slot they start with, grant bonus lives, double their fire rate, or make them permanently invisible. | `Campaign.ts:toAi()` only forwards `spawn` and `aimPlayer` into `CampaignAi` (`:114-128`); `GameScreen.buildRosterLocal()`'s campaign branch (`:544-558`) reads none of `spawn`/`aimPlayer`/`noSpawn`/`startWeap`/`lives`/`dblFire`/`permInvis` — every scripted bot spawns immediately, at a random point, with only its base gun/ability. | Extend `CampaignAi` + the roster builder to honor `spawn` (fixed position/node), `noSpawn` (hold off spawning until the mission script calls for it — needs the runScripts rework in gap #5 first), `startWeap` (force initial weapon slot), `lives` (Elimination life count override per bot), `dblFire` (fire-rate multiplier), and `permInvis` (permanent cloak). |
| 7 | `Cutscene.as` (201 lines): a full-screen static comic-panel viewer with Next/Previous buttons, driven by `MatchSettings.preCutSong/preCutFrames`/`postCutSong/postCutFrames` (9 of the 30 missions set at least one side — see the `cutscene` column in §2.4); `Game.as:654-657` launches it automatically after a campaign win if `postCutFrames` is set. | **Entirely unported.** No `Cutscene`-equivalent screen exists anywhere under `raze-ts/src` (confirmed: zero matches for `Cutscene` in `src/`). `Campaign.ts`'s `CampaignEntry.cutscene` field is threaded through `getCamp()` but never read by any screen. | This is large enough to warrant its own follow-up spec (comic-panel art asset IDs live in `assets.swf` symbol `symbol2111`'s frames 1–42-ish, referenced only by frame number in `campaign.json`'s `cutscene.preFrames`/`postFrames` — those frames' actual artwork has not been located/reviewed in this pass). At minimum, flag comic frame numbers used per mission (§2.4) so a future agent can pull the corresponding art via FFDec. |
| 8 | `Menu.as:196-201`: the alien arc's gating is an implicit frame-skip (`if campStage<15, auto-advance past the species picker`) — there's no separate "is the Alien tab enabled" flag; the human arc is the only one reachable until `campStage>=15`. | `SD.ts:312-314`'s `get alienUnlocked() { return this.curStage > 15; }` and `CampaignScreen.ts:137,142-145` implement an explicit disabled-button + error-sound pattern instead. Functionally equivalent for a single-scene SPA, but note the **boundary**: port uses `curStage > 15` (strictly greater), meaning stage 15 itself (the last human mission, not yet beaten) still shows Alien disabled — consistent with `campStage<15` in the original only if `curStage` and `campStage` are consistently offset by one (port is 1-based, original is 0-based) — this has not been unit-tested against the exact off-by-one at the moment mission 15 is beaten. | Add a regression check: after beating human mission 15 (`curStage` should become 16), confirm `alienUnlocked` flips exactly then, matching original's `campStage` reaching 15. |
| 9 | Bot personalities are driven by explicit named characters in the script (`J. Rockit`, `Md. Sage`, `Ex. Treem`, `Cpt. Biggs`, unnamed `Alien`/`Zombie`/`Commander`/`Transport Bot`/`Security Bot`/`Training Bot`/`Human`/`Raze Soldier`/`Survivor`), each with a fixed skin, level, weapon, and ability. | `Campaign.ts:persFor()` (`:105-112`) collapses all of this down to 5 coarse buckets (`gamer/alien/zombie/robot/military`) via a skin-string regex purely to pick AI chatter/behavior flavor — the port's `AI` class has no concept of "this specific named character" at all, so e.g. Md. Sage's `heal` ability and Ex. Treem's `grenade` ability only come through if `ability` happens to be a recognized id (`GameScreen.ts:553`); their *names* are preserved (`CampaignAi.name`) but not surfaced anywhere in the HUD kill-feed/scoreboard as far as this doc's review found. | Out of scope for this doc's checklist (belongs with the AI/personality system, doc 15) — flagged here because it affects whether e.g. "Md. Sage" reads correctly as a name tag in-match. |
| 10 | A dead/unused `matchType==2` branch in `setMatch()` (`Stats_Campaign.as:948-953`) sets up a placeholder `"Challenge mode GO"` mission (`jungle`, Deathmatch, 10 kills, desc literally `"This is the description"`) — never wired to any menu button, clearly a debug leftover. | Not present in the port (correctly ignored). | None — noted only so nobody mistakes this for a missing 31st mission if they re-read `Stats_Campaign.as` later. |

## 5. Implementation checklist (for the LATER build phase — do NOT do it now)

1. **Extract `matchExtra` + `overallDiff` wiring.** Add a `matchExtra: string` field to each
   `campaign.json` entry (7 real strings + `"None"` default, see gap #1) and thread `overallDiff`
   through `CampaignSettings` (gap #2). Update `CampaignScreen.paintPreview()` to show the real
   Extra text and a difficulty readout keyed off `overallDiff` (decide 5-dot rescale vs. a 9-step
   meter). Files: `src/assets/raze2/campaign.json`, `src/game/Campaign.ts`, `src/screens/
   CampaignScreen.ts`.
2. **Fix `campaignMap()`'s `jungle3` fallthrough** (gap #4) — give it an explicit, deliberate
   mapping instead of silently defaulting to `"r2_jungle"`. File: `src/game/Campaign.ts:32-38`.
3. **Re-extract `runScripts()` trigger timelines** (gap #5) — for each of the 30 `case N:` blocks
   in `Stats_Campaign.as` (human: lines 1179–1814; alien: lines 1938–2400 — see §2.4 for the exact
   line of each mission's block), record every `setCampMsg` call's real trigger (`fc==30*S` → frame
   `S*30` — port runs at 30fps per `Config.ts:9`, so this maps 1:1 — or a score-threshold
   condition) plus any co-triggered `spawn()`/`wait()`/`matchInfo.extra` mutation, and encode that
   timeline into `campaign.json` (e.g. `messages[].trigger: {frame?: number, score?: {team: 1|2,
   value: number}}`) replacing the current (incorrect) reuse of the duration argument as a delay.
4. **Rebuild `tickCampaignDialogue()`** around the corrected timeline from step 3: gate on
   `frame`/`score` triggers instead of a monotonically-incrementing counter compared against the
   duration value; keep the `duration` value for how long the HUD line stays up. File: `src/game/
   GameScreen.ts:504-513`.
5. **Honor bot `extra` fields** (gap #6): `spawn` (fixed position/node — cross-reference the
   mission's arena nodes), `noSpawn` (defer spawn until its scripted trigger from step 3 fires),
   `startWeap` (force initial weapon slot index), `lives` (per-bot life count override in
   Elimination), `dblFire` (fire-rate multiplier), `permInvis` (permanent cloak state). Files:
   `src/game/Campaign.ts` (`CampaignAi` interface + `toAi()`), `src/game/GameScreen.ts` (roster
   builder campaign branch, `:540-560`).
6. **Cutscene viewer** (gap #7) — flag for its own follow-up spec doc given the scope (comic-panel
   art asset location/identification is unresolved — see §6). If pursued: a `CutsceneScreen`
   reading `entry.cutscene.{preSong,preFrames,postSong,postFrames}`, shown before match launch when
   `preFrames` is set and after a campaign win when `postFrames` is set (mirroring `Game.as:654-
   657`'s `postCutFrames` gate), with Next/Previous stepping and the exact
   Start-Game/Back-to-Campaign button-label swap logic from `Cutscene.as:113-164`.
7. **Regression-test the human→alien unlock boundary** (gap #8): beat mission 15, assert
   `SD.alienUnlocked` flips exactly at that point and mission 16 becomes selectable.
8. **Re-verify the reference screenshot** (see §6) once available in a later session, and correct
   §2's screen-layout description / any positions in `CampaignScreen.ts` that don't match (colors/
   fonts were cross-checked against `Menu.as` source values in this pass and do match; layout
   *positions* were not screenshot-verified).

## 6. Open questions / data still missing

- **Reference screenshot 3 (`…/image-cache/726bbac7-a4b5-4dbc-a70a-5f8052af9970/3.png`) could not be
  loaded in this session** (`Read` reported the file does not exist; `Test-Path` from PowerShell
  also returned `False`). §1/§3's layout description is instead reconstructed from
  `CampaignScreen.ts`'s own doc-comment (`:31-38`, presumably written against that screenshot by a
  prior session) cross-checked against `Menu.as`'s `setCampaign()` field list (§2.1) and the
  locked-row color literal (`13421772` = `0xCCCCCC`, confirmed to match `C_LOCKED`). A future pass
  with working image access should re-verify exact panel positions/sizes, the mission-list scroll
  behavior (all 15 rows fit on screen in the port; unclear if the original scrolled), and whether
  the map "screenshot" in the original is a photographic-style render or stylized art (affects
  checklist item 3 above).
- **Comic cutscene artwork is unidentified.** `cutscene.preFrames`/`postFrames` in `campaign.json`
  give frame numbers into the embedded `assets.swf` symbol `symbol2111` MovieClip (`Cutscene.as:16`
  `[Embed(source="/_assets/assets.swf", symbol="symbol2111")]`), but this pass did not open that
  symbol in FFDec to see what each numbered frame actually depicts. Needed before checklist item 6
  can be scoped for art/asset work.
- **`Stats_Campaign.as`'s equip-loadout second table** (`:1002-1050`, mapping `setEquip`'s 0–11
  index to a 3-slot preset array like `[5,2,3]`) is documented here only enough to explain what
  `addBot`'s `equip` keyword ultimately resolves to; full semantics (which slot is which equipment
  item) belong to doc 11/14 (Armory/Equipment) — not re-derived here.
- **Exact `runScripts()` per-mission trigger transcription was not completed in full** — §2.4's
  dialogue lists are extracted from `campaign.json` (accurate for text/order/unit/duration) with a
  handful of trigger conditions manually cross-referenced against `Stats_Campaign.as` for missions
  1–2 as a worked example (see gap #5 and checklist item 3). Transcribing all remaining 28 missions'
  exact `fc==` / score-threshold conditions is deferred to whoever implements checklist item 3, using
  the line ranges already cited (§2.4, §5).
- **Whether the "screenshot" `img_map` MovieClip's per-map frames are literally called out by
  `Stats_Maps.getMap(name).id`** was confirmed structurally (`Menu.as:1680`) but the map-id ↔
  frame-number table itself lives in `Stats_Maps.as`, not reviewed in this pass (out of scope —
  belongs to doc 15's map catalog).
