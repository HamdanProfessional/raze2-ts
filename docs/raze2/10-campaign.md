# Raze 2 — Campaign

Source: `scripts/Stats_Campaign.as` (the campaign mission table, bot rosters, scripted
dialogue, and cutscene wiring — no separate `Campaign.as` class exists in the decompile;
`Stats_Campaign` is the whole system). Supporting: `scripts/Cutscene.as` (comic-panel
viewer), `scripts/Hud.as` (`setCampMsg`/`setMsg`), `scripts/Game.as` (`destroy()` —
progression + achievement wiring), `scripts/Menu.as` (Campaign Select / Human Campaign /
Alien Campaign / Armory screens), `scripts/SD.as` (`campStage` save field),
`scripts/Stats_Achievements.as` (campaign-complete rewards).

All line numbers below are `Stats_Campaign.as:N` unless another file is named.

## 1. Overview

`Stats_Campaign.setMatch(matchType, matchLevel)` (`Stats_Campaign.as:52`) is the single
entry point. It reads `MatchSettings.matchType` (0 = Human, 1 = Alien, 2 = unused
"Challenge mode" stub — see §8) and `MatchSettings.matchLevel` (0–14), and for that
`(type, level)` pair calls, in order:

1. `setCutscene(preSong, preFrames, postSong, postFrames)` — `:2432`
2. `setStats(winScore, mode, teams, mapKey, overallDiff, skinKey, song, title, desc)` — `:2465`
3. Zero or more `addBot(name, team, skin, level, weapons, ability, equip0, extra)` calls — `:2440`

`Stats_Campaign.runScripts(game:Game)` (`:1105`) is polled every frame by `Game` while
`MatchSettings.isCampaign` and dispatches on the same `(matchType, matchLevel)` pair to
drive `setCampMsg` dialogue lines, timed bot spawns, music swaps, and (for a couple of
missions) mid-match difficulty/state changes.

### Helper function signatures

| Function | Signature | Notes |
|---|---|---|
| `setStats` | `(winScore:uint, mode:String, teams:uint, mapKey:String, overallDiff:uint, skinKey:String, song:*, title:String, desc:String)` | `:2465`. Resets `sn` (the per-mission dialogue-step static) to 0, sets `MatchSettings.matchExtra="None"`, `creditMod=1`, `bots=[]`, `weaponsUsed="All"`, `specialMode="None"`, `abilitiesOn=true`, `equipsOn=false`, `player.extra={}`. `teams=0` is coerced to 1 internally; if `teams>1` the player is forced to team 1, else team 0. |
| `setCutscene` | `(preSong:*, preFrames:Array, postSong:*, postFrames:Array)` | `:2432`. Stores onto `MatchSettings.preCutSong/preCutFrames/postCutSong/postCutFrames`. `null` frames array ⇒ no cutscene of that phase. |
| `addBot` | `(name:String, team:uint, skinKey:String, level:uint, weapons:Array, ability:String, equip0:Array, extra:Object=null)` | `:2440`. Pushes `{name, diff:level, skin:Stats_Skins.skinOb[skinKey].num, team, weapons, ability, equip0, 0, extra}` onto `MatchSettings.bots`. |
| `setWeapon` | `(preset:String):Array` | `:1053`. Maps a preset key to a 7-slot weapon-level array (indices = weapon slots 0–6: pistol/smg?, shotgun, ar, sniper?, explosive, alien/robot special, heavy — exact slot semantics are the general weapon system's, not campaign-specific). See table below. |
| `setEquip` | `(preset:String):Array` | `:957`. Maps a preset key to a 3-slot equipment-tier array `[eq0,eq1,eq2]`. See table below. |

**`setWeapon` presets** (`:1053`):

| preset | array `[0..6]` |
|---|---|
| `raze` / `raze2` / `raze3` | `[0,0,0,0,0,0,0]` |
| `johnny` | `[2,1,3,0,0,0,1]` |
| `medic` | `[0,1,0,3,0,0,3]` |
| `explosives` | `[0,2,4,4,3,4,1]` |
| `zombie` | `[0,4,0,0,0,0,0]` |
| `alien` | `[1,3,1,1,2,2,2]` |
| `commander` | `[1,3,2,2,3,3,4]` |
| `robot` / `robot2` | `[2,0,0,0,1,1,1]` |

**`setEquip` presets** (`:957`):

| preset | array `[eq0,eq1,eq2]` |
|---|---|
| `raze` | `[5,2,3]` |
| `raze2` | `[6,2,3]` |
| `raze3` | `[7,2,3]` |
| `johnny` | `[5,2,2]` |
| `medic` | `[2,4,1]` |
| `explosives` | `[3,3,4]` |
| `zombie` | `[6,0,0]` |
| `alien` | `[0,5,0]` |
| `commander` | `[1,6,4]` |
| `robot` | `[4,4,1]` |
| `robot2` (falls to default) | `null` |

## 2. Human campaign (matchType 0) — 15 missions

Stage numbers below are 1-based (`matchLevel` 0–14). "Player extra" lists non-default
`MatchSettings.player.*` overrides the mission sets before spawn.

| # | Title | Map | Mode | Cap | Teams | Diff | Player skin | Music | Player extra |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Breaking In | tut | Deathmatch | 15 | 2 | 1 | raze | M_Throwdown | Shotgun only, noAmmo, ability none, fixed spawn (138,513,"a") |
| 2 | Survivor Lookout | city2 | Deathmatch | 30 | 2 | 1 | raze | M_Necro | — |
| 3 | Sweep and Clear | city | Elimination | 20 | 2 | 1 | mine | M_Warhead | startWeap 5 (flamethrower Lv4), equip0=3 (armor plating) |
| 4 | Cause and Effect | space2 | Deathmatch | 16 | 2 | 2 | raze2 | M_Infernal | player renamed "Cpt. Biggs" |
| 5 | Retrieval | space | Capture the Flag | 5 | 2 | 2 | raze | M_Ricochet | — |
| 6 | New Recruits | jungle | Juggernaught | 10 | 0 | 3 | raze | M_Throwdown | — |
| 7 | Hold the fort | ocean | Domination | 100 | 2 | 3 | raze | M_Theloop | — |
| 8 | My First Mission | desert2 | Deathmatch | 15 | 0 | 4 | raze | M_Rocket | player.team=1 |
| 9 | Shocking Discovery | snow | Domination | 150 | 2 | 5 | raze | M_Theloop | — |
| 10 | Strange Encounter | desert | Elimination | 10 | 2 | 7 | raze | M_Rose | (solo — only one enemy bot scripted) |
| 11 | Trapped | mines | Domination | 150 | 2 | 5 | raze | M_Necro | your 3 squadmates start `noSpawn:true` |
| 12 | Disposal | ocean2 | Elimination | 10 | 2 | 6 | raze | M_Theloop | — |
| 13 | Reclaimed | mines2 | Capture the Flag | 5 | 2 | 6 | raze | M_Rocket | — |
| 14 | Mutation | snow2 | Deathmatch | 30 | 2 | 6 | raze | M_Ricochet | equip0=6 (Mutation); squad lives=2 |
| 15 | Final Deployment | jungle3 | Elimination | 10 | 2 | 7 | mutate | M_Rose | equip0=7 (Mutated skin); squad lives=2, alien lives=6/10 |

Descriptions (verbatim, `matchDesc` 9th arg to `setStats`):

1. "It's been 9 years since the last invasion. Relearn the ropes of battle from our highest ranking officer, Johnny Rockit" — `:63`
2. "One week ago we lost communications with our military ship Echo-1. We believe it was attacked and there may be survivors in a zombie quarantine zone. Go check it out but be warned, there's been reports of many zombies in the area." — `:121`
3. "We're sending you back in more equipped for the situation. This time you'll have flame throwers and new, flame resistant armor. Clear the city of infected and secure any survivors." — `:173`
4. "Play as Captain Biggs one week ago, and watch the events that caused his Echo-1 ship to crash, and start the whole alien invasion." — `:250`
5. "The aliens must be attacking because they think we have their artifacts. Retrieve them from the crashed wreckage so we can return them and end this war once and for all." — `:262`
6. "Before we give back the artifacts, we're having our top scientists look into them. There has to be a reason the aliens want them so badly. In the meantime, show our new recruits how it's done against some training bots in our testing dome." — `:279`
7. "Our researchers are still looking into the power of the artifacts, but the aliens have discovered the underwater lab. Go there and secure the artifacts, we can't let them go until we know their full potential." — `:305`
8. "Alien shipyards have been discovered in the desert. They're actually building more ships on our planet. Take the new recruits on their very first mission and show 'em how it's done by getting the most kills on your team." — `:316`
9. "We've found out the true nature of the artifacts but it seems that the aliens have found their location once again, they seem to be giving out some sort of GPS signal. Secure the artifacts at all costs." — `:341`
10. "We've lost communications with the Ship Yards and we fear the worst... Your team is currently busy on other assignments, so you'll have to check it out alone." — `:352`
11. "Go to the mines to place the first artifact. There's too many zombies in the area, so you'll need to place the artifact while you fight. Your team is still busy on another assignment, but will soon come to assist you." — `:370`
12. "One of the artifacts was already placed and activated in the underwater lab but it's now being attacked. Wipe out all enemies in the lab!" — `:385`
13. "Aliens have discovered the location of our first artifact and are removing it. Head back to the mines and steal it back at all costs. You will receive help from the mine security bots." — `:396`
14. "Place the 3rd artifact. The virus is starting to take effect, you can feel something changing inside you..." — `:432`
15. "The final artifact is ready to be placed. Defeat the enemy with only minutes until the meteor shower hits. You have fully mutated into a Zombie, but the survival of the human race lies within your hands." — `:445`

### Human bot rosters

Format: `Name | team | skin | level | weapon preset | ability | equip preset | extra`.
`extra` fields of note: `noSpawn:true` = bot does not appear until scripted `spawn()`;
`lives:N` overrides its life count; `dblFire:true` doubles its fire rate; `startWeap:N`
forces its starting weapon slot; `spawn:{x,y,node}` fixes its first spawn point.

**1 — Breaking In** (`:73-117`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 6 | johnny | sword | johnny | aimPlayer:true, speak:"b", spawn(160,513,"a") |
| Alien | 2 | aspace | 3 | alien | none | alien | noSpawn:true |
| Alien | 2 | aspace | 3 | alien | none | alien | noSpawn:true |

**2 — Survivor Lookout** (`:122-169`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny | — |
| Zombie ×9 | 2 | zurban/zbeach/zelderly/zbiker/zbiker2 (cycled) | 1 | zombie | none | zombie | noSpawn:true each |

**3 — Sweep and Clear** (`:178-246`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | mine | 9 | explosives | sword | explosives | startWeap:5 |
| Cpt. Biggs | 1 | raze3 | 10 | zombie | none | zombie | noSpawn:true |
| Zombie ×9 | 2 | zurban/zbeach/zelderly/zbiker/zbiker2 (cycled twice) | 1 | zombie | none | zombie | lives:3, dblFire:true each |

**4 — Cause and Effect** (`:253-258`) — player is "Cpt. Biggs".
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Transport Bot ×3 | 1 | bspace | 6 | robot | static | robot |
| Alien ×3 | 2 | aspace | 4 | alien | none | alien (noSpawn:true) |

**5 — Retrieval** (`:263-266`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | space | 9 | johnny | sword | johnny |
| Transport Bot ×3 | 2 | bspace | 4 | robot | static | robot |

**6 — New Recruits** (`:285-301`) — Juggernaut, no teams.
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Training Bot ×5 | 0 | bjungle | 3 | robot | static | robot |

**7 — Hold the fort** (`:306-312`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | mine | 9 | johnny | sword | johnny |
| Security Bot ×2 | 1 | bsnow | 5 | robot | static | robot |
| Alien ×3 | 2 | amarine | 5 | alien | mine | alien |
| Zombie | 2 | zbeach | 5 | zombie | none | zombie |

**8 — My First Mission** (`:318-332`) — player.team=1.
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives |
| Alien ×3 | 2 | adesert | 5 | alien | mine | alien |

**9 — Shocking Discovery** (`:342-348`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives |
| Alien ×4 | 2 | asnow | 5 | alien | cloak | alien | noSpawn:true each |

**10 — Strange Encounter** (`:353-366`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Commander | 2 | acommander | 6 | commander | teleport | commander |

**11 — Trapped** (`:371-381`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny | noSpawn:true |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic | noSpawn:true |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives | noSpawn:true |
| Zombie ×4 | 2 | zurban/zbeach/zelderly/zbiker | 3 | zombie | none | zombie | — |

**12 — Disposal** (`:386-392`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic |
| Security Bot | 1 | bsnow | 5 | robot | static | robot |
| Alien ×3 | 2 | amarine | 5 | alien | mine | alien |
| Zombie | 2 | zbeach | 5 | zombie | none | zombie |

**13 — Reclaimed** (`:397-428`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives |
| Security Bot ×2 | 1 | bmine | 5 | robot | static | robot |
| Alien ×3 | 2 | ajungle | 5 | alien | mine | alien |
| Alien ×3 | 2 | ajungle | 5 | alien | cloak | alien |

**14 — Mutation** (`:435-441`) — squad lives:2, MatchSettings.player.equip0=6.
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny | lives:2 |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic | lives:2 |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives | lives:2 |
| Alien | 2 | asnow | 5 | alien | mine | alien | — |
| Alien ×2 | 2 | asnow | 5 | alien | cloak | alien | — |
| Commander | 2 | acommander | 7 | commander | teleport | commander | lives:6 |

**15 — Final Deployment** (`:448-492`) — player.equip0=7 (Mutated).
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| J. Rockit | 1 | rambo | 9 | johnny | sword | johnny | lives:2 |
| Md. Sage | 1 | soldier | 6 | medic | heal | medic | lives:2 |
| Ex. Treem | 1 | soldier2 | 6 | explosives | grenade | explosives | lives:2 |
| Raze Soldier | 2 | mutate | 10 | raze3 | static | raze3 | lives:10, startWeap:6 |
| Human | 2 | rambo | 9 | johnny | sword | johnny | lives:5, startWeap:3 |
| Human | 2 | soldier | 9 | medic | heal | medic | lives:5, startWeap:4 |
| Human | 2 | soldier2 | 9 | explosives | grenade | explosives | lives:5, startWeap:5 |
| Commander ×2 | 2 | acommander | 6 | commander | teleport | commander | lives:6 (×2 addBot calls) |

## 3. Alien campaign (matchType 1) — 15 missions

| # | Title | Map | Mode | Cap | Teams | Diff | Player skin | Music | Player extra |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Misscommunication | space2 | Deathmatch | 15 | 2 | 5 | acommander | M_Rocket | spawn(1300,700,"o") |
| 2 | Search Party | space | Domination | 150 | 2 | 5 | acommander | M_Theloop | — |
| 3 | Invasion | tutq2 | Deathmatch | 20 | 2 | 6 | acommander | none (`null`) | spawn(1420,1090,"h") |
| 4 | Epidemic | city | Elimination | 10 | 3 | 5 | acommander | M_Ricochet | — |
| 5 | Discipline | mines | Juggernaught | 15 | 0 | 5 | acommander | M_Necro | (solo) |
| 6 | Breaking Point | ocean | Elimination | 9 | 3 | 6 | acommander | M_Theloop | — |
| 7 | A Strong Defense | desert2 | Deathmatch | 25 | 2 | 6 | acommander | M_Rocket | startWeap 6 (Acid Hound Lv4) |
| 8 | Underestimated | mines | Capture the Flag | 10 | 2 | 6 | acommander | M_Necro | — |
| 9 | The Ambush | snow | Deathmatch | 25 | 2 | 6 | acommander | M_Theloop | permInvis:true |
| 10 | Tormented | desert | Elimination | 10 | 2 | 9 | acommander | M_Rose | ability="teleport" |
| 11 | Artifact Retrieval 101 | ocean | Capture the Flag | 10 | 2 | 7 | acommander | M_Theloop | — |
| 12 | Taking out the Trash | jungle2 | Deathmatch | 25 | 2 | 7 | acommander | M_Necro | — |
| 13 | The Pickup | space | Domination | 200 | 2 | 8 | acommander | M_Ricochet | — |
| 14 | Rocket Race | snow2 | Deathmatch | 30 | 2 | 8 | acommander | M_Rocket | startWeap 6 (Frozen Death Lv6) |
| 15 | A Soldiers Demise | jungle3 | Elimination | 10 | 2 | 9 | acommander | M_Rose | — |

Descriptions:

1. "A human ship has been spotted near our artifact transport ship. Remove all human threats, as the artifacts must travel safely back to our home planet." — `:574`
2. "The artifacts are no longer in our ship, search the surrounding wreckage for them." — `:630`
3. "The artifacts can not be found... The human must have taken them. Our first plan of action is to destroy their main combat facility." — `:639`
4. "We've located the escape pod from the survivor on that ship, it's in the infected city. We must find him and retrieve the artifacts before the humans do!" — `:655`
5. "The humans have escaped with the survivor and artifacts. Zombies are no longer allied with us, so head over to the thickest zombie infestation in attempt to gain their loyalty. You'll have to do this alone." — `:690`
6. "We've finally trained the undead to fight along side our soldiers. Our tracking on the artifacts is now working, and we've located them at an underwater facility." — `:714`
7. "In an attempt to build our offenses on Earth we've began ship production on various locations. However it appears the humans have found us out. We're equipping everyone on the team with Acid hounds, so be careful where you fire." — `:747`
8. "The humans are attempting to place one of the artifacts. Stop them at all costs!" — `:770`
9. "We've failed to retrieve the artifact from the mines. Use your cloaking to ambush their facility in the north. If we destroy it, it might distrupt their communications. " — `:796`
10. "We've developed a new technology that allows us to teleport around the field during battle. We purposely sent out a distress call to lure the humans to the shipyards." — `:843`
11. "The humans are placing th[e] 2nd artifact in their underwater facility! Steal the artifact and bring it back to us." — `:849`
12. "The humans have been using one of their domes as a training grounds for soldiers. Eliminate the soldiers to ensure their army does not grow any stronger." — `:874`
13. "We've received word that the carrier ship we shot down was carrying a very powerful weapon called \"Frozen Death\". Go secure the weapon. Wipe out any resistance you encouner." — `:900`
14. "The humans have placed 2 of the 4 artifacts, and are about to place the third. Use the recovered weapon \"Frozen Death\" to kill them before they can place the artifact." — `:916`
15. "The Humans are placing the final artifact and the meteors are imminent. I'm afraid it's too late for our planet... Take 2 other Commanders, we must do what we can." — `:927`

### Alien bot rosters

**1 — Misscommunication** (`:580-626`) — player spawn overridden to (1300,700,"o").
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 6 | alien | cloak | alien | spawn(800,y,-) |
| Alien | 1 | aspace | 6 | alien | cloak | alien | spawn(2000,y,-) |
| Captain | 2 | raze2 | 7 | johnny | grenade | johnny | — |
| Transport Bot ×2 | 2 | bspace | 6 | robot | static | robot | — |

**2 — Search Party** (`:631-635`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 6 | alien | cloak | alien |
| Transport Bot ×3 | 2 | bspace | 6 | robot | static | robot |

**3 — Invasion** (`:645-651`) — player spawn (1420,1090,"h").
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 6 | alien | cloak | alien | spawn(2475,1090,"o") |
| Human | 2 | rambo | 6 | johnny | sword | johnny | — |
| Raze Soldier | 2 | raze | 6 | raze | ammo | raze | — |

**4 — Epidemic** (`:656-686`) — 3 teams.
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 8 | alien | cloak | alien | — |
| Human | 3 | mine | 10 | johnny | sword | johnny | startWeap:5 |
| Survivor | 3 | raze3 | 7 | raze | none | raze | — |
| Zombie ×5 | 2 | zurban/zbeach/zelderly/zbiker/zbiker2 | 6 | zombie | none | zombie | lives:3, dblFire:true each |

**5 — Discipline** (`:691-710`) — solo, no teams.
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Zombie ×5 | 0 | zurban/zbeach/zelderly/zbiker/zbiker2 | 6 | zombie | none | zombie |

**6 — Breaking Point** (`:715-743`) — 3 teams.
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 8 | alien | static | alien |
| Zombie ×2 | 1 | zbeach | 5 | zombie | none | zombie/raze2 (2nd uses raze2 equip — note likely typo in source) |
| Human ×2 | 2 | mine | 7 | johnny | grenade | johnny/raze | — |
| Security Bot ×2 | 2 | bsnow | 8 | robot | mine | robot |

**7 — A Strong Defense** (`:751-766`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 7 | alien | grenade | alien | startWeap:6 |
| Human | 2 | rambo | 7 | johnny | sword | johnny | — |
| Human | 2 | soldier | 7 | medic | heal | medic | — |
| Human | 2 | soldier2 | 7 | explosives | grenade | explosives | — |
| Raze Soldier | 2 | raze | 9 | raze | static | raze | — |

**8 — Underestimated** (`:771-788`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien | 1 | aspace | 8 | alien | grenade | alien |
| Zombie ×2 | 1 | zurban/zbiker | 6 | zombie | none | zombie |
| Human | 2 | rambo | 9 | johnny | sword | johnny |
| Human | 2 | soldier | 8 | medic | heal | medic |
| Human | 2 | soldier2 | 8 | explosives | grenade | explosives |
| Raze Soldier | 2 | raze | 10 | raze | static | raze |

**9 — The Ambush** (`:798-839`) — player.extra.permInvis=true.
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×3 | 1 | asnow | 8 | alien | cloak | alien | permInvis:true |
| Human | 2 | rambo | 9 | johnny | sword | johnny | — |
| Human | 2 | soldier | 8 | medic | heal | medic | — |
| Human | 2 | soldier2 | 8 | explosives | grenade | explosives | — |
| Raze Soldier | 2 | raze | 9 | raze | static | raze | — |

**10 — Tormented** (`:844-845`) — player.ability="teleport".
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Human | 2 | raze | 10 | raze | static | raze2 |

**11 — Artifact Retrieval 101** (`:850-870`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | asnow | 6 | alien | cloak | alien |
| Human | 2 | rambo | 9 | johnny | sword | johnny |
| Human | 2 | soldier | 8 | medic | heal | medic |
| Human | 2 | soldier2 | 8 | explosives | grenade | explosives |
| Raze Soldier | 2 | raze | 10 | raze | static | raze |

**12 — Taking out the Trash** (`:875-890`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 6 | alien | cloak | alien |
| Human | 2 | camo | 8 | johnny | sword | johnny |
| Human | 2 | camo | 8 | medic | heal | medic |
| Human | 2 | camo | 8 | explosives | grenade | explosives |
| Human | 2 | camo | 8 | raze | mine | raze |

**13 — The Pickup** (`:901-912`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip |
|---|---|---|---|---|---|---|
| Alien ×2 | 1 | aspace | 5 | alien | cloak | alien |
| Security Bot ×3 | 2 | bsnow | 9 | robot2 | static | robot2 |

**14 — Rocket Race** (`:920-923`) — player.extra.startWeap=6, weapons[6]=6 (Frozen Death Lv6).
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Alien ×2 | 1 | asnow | 7 | alien | cloak | alien | startWeap:6 |
| Human | 2 | rambo | 9 | johnny | sword | johnny | startWeap:6 |
| Raze Soldier | 2 | raze | 10 | raze2 | static | raze2 | startWeap:6 |

**15 — A Soldiers Demise** (`:928-945`)
| Name | Team | Skin | Lv | Weapon | Ability | Equip | Extra |
|---|---|---|---|---|---|---|---|
| Commander ×2 | 1 | acommander | 6 | commander | teleport | commander | — |
| Raze Soldier | 2 | mutate | 10 | raze3 | static | raze3 | lives:10, startWeap:6 |
| Human | 2 | rambo | 9 | johnny | sword | johnny | lives:5, startWeap:3 |
| Human | 2 | soldier | 9 | medic | heal | medic | lives:5, startWeap:4 |
| Human | 2 | soldier2 | 9 | explosives | grenade | explosives | lives:5, startWeap:5 |

## 4. matchType 2 — dead "Challenge mode" stub

`:948-954`: `setMatch` has a `case 2` that computes `_loc3_ = MatchSettings.matchLevel`,
runs an empty `switch(0){}`, then unconditionally calls
`setStats(10,"Deathmatch",0,"jungle",1,"raze",null,"Challenge mode GO","This is the description")`
with **no bots added**. `runScripts`'s `case 2` (`:2419-2428`) is likewise an empty
switch. This is inert placeholder content, not a real third campaign — there is no menu
entry that sets `matchType=2`. Treat as out of scope for the port.

## 5. Scripted dialogue system (`setCampMsg`)

`Hud.setCampMsg(who, text, time:Number=4, speakerName:*="")` (`Hud.as:286`) delegates to
`setMsg` which resolves the on-screen portrait/name either from a bot instance (`who` is
a unit — `who.skin.frame` + `who.name`) or from a raw skin-key string (`who` is a
`String` — looked up via `Stats_Skins.skinOb[who]`, e.g. `"girl"`, `"aspace"`, `"soldier2"`)
paired with an explicit 4th-arg display name override (e.g. `"Dani"`, `"Instructor"`,
`"Alien"`, `"Scientist"`, `"Recruit"`). `time` is how many seconds the box stays up
(defaults to 4). Every call in `runScripts` is gated on `param1.fc == 30 * N` (a frame
count, 30fps ⇒ N seconds into the match) or on a scripted state flag `sn` (a
`Stats_Campaign`-static uint/bitfield reused across missions to gate one-shot dialogue,
reset to 0 by every `setStats` call) or a live score/lives condition
(`matchSettings.team1score`, `player.pscore`, `units[n].score.lives`).

`runScripts` is dispatched the same way as `setMatch` — `matchType` then `matchLevel` —
and its body for each mission is a flat list of `if(param1.fc == 30*N) hud.setCampMsg(...)`
lines, occasionally interleaved with `units[n].spawn(...)`, `SH.playMusic(...)`, or
mid-match difficulty/state changes (see §6). The full `campaign.json` (already extracted
into the port, see §8) is the fully-parsed, per-mission `messages[]` array of
`{whoUnit, whoPortrait, text, time, speaker}`; the tables below are a compact index of
*what happens*, keyed by trigger, per mission — see `Stats_Campaign.as` line refs for the
verbatim text.

### Notable non-dialogue scripted behavior found in `runScripts`

| Mission | Frame/condition | Effect |
|---|---|---|
| Human 1 (Breaking In) | `player.sEvent==11`, `fc==300` | 3 dialogue lines, then at `fc==450`: clears unit 1's `aimPlayer`/`speak`, `wait(0)`s it, and spawns `units[2]`/`units[3]` at fixed coords — this is the tutorial's scripted intro sequence tied to `player.sEvent` (an `Arena` wall-frame/tutorial-progress counter), not a normal timer. |
| Human 1 | `team1score` thresholds 5/8/12 gated by static `sn` 0→1→2→3 | One-shot encouragement lines as the player racks up kills. |
| Human 2 (Survivor Lookout) | `fc` 150–3300 (steps of ~240–360 frames) | Staggered `units[2..11].spawn()` calls — the zombie horde trickles in over ~2 minutes; ends with an "Evac" call-in from `"girl"`/"Dani" at `fc==3600` and `3780`. |
| Human 3 (Sweep and Clear) | `sn==0` branch vs `else` branch | Branches entirely on whether a survivor unit (`units[2]`, "Cpt. Biggs") has been freed yet — same `fc` values used for two different dialogue tracks. |
| Human 4 (Cause and Effect) | `team1score==3 && sn==0` | One-shot "Woohoo!" line. |
| Human 6 (New Recruits) | `player.pscore` 4/6/8, gated by `sn` | Instructor/recruit banter reacts to the player's live personal score in the Juggernaut match. |
| Human 7 (Hold the fort) | `team1score` 60/75/90, gated by `sn` | Scientist ("addison") status lines as the Domination score climbs toward the 100 cap. |
| Human 9 (Shocking Discovery) | `fc==600` | `SH.playMusic(M_Ricochet)`; spawns `units[4..7]` (the 4 cloaked aliens) — a scripted ambush. |
| Human 11 (Trapped) | `fc==1800` | `SH.playMusic(M_Warhead)`; spawns `units[1..3]` (your squad, which started `noSpawn:true`) mid-match. |
| Human 15 (Final Deployment) | `fc==390` | Threshold line "We have exactly 4 minutes…" — matches the mission's hard 4-minute meteor timer (see §6). |
| Human 15 | `units[1/2/3].score.lives==0`, bitfield `sn` (bits 1/2/4) | Each squadmate gets a one-shot death line as they run out of lives, tracked independently via bitmask so lines don't repeat. |
| Alien 2 (Search Party) | `fc==1200/1020/1050` | Transport bots' AI difficulty is scripted down to 0 (`units[3/4/5].diff=0`) then back up to 9 (`setDiffStats()` on unit and its `status`) after a "rebooting" dialogue beat — a timed vulnerability window. |
| Alien 9 (The Ambush) | `fc==600` | "Attack!" line, `SH.playMusic(M_Ricochet)`, clears `permInvis` on `units[0..3]` (ends the pre-battle invisibility granted by `MatchSettings.player.extra.permInvis` / bot `extra.permInvis`). |

## 6. Meteor / hard-timeout endings (Hud.as)

Both campaign "final" missions have a hidden hard time limit enforced in `Hud.as` (not
`Stats_Campaign.as`), independent of the mission's score cap — `Hud.as:640-677`:

- **Human, matchType 0** (Final Deployment): at `gameTime == 30*4*60` (4:00) the game
  prints "Sir, we're too late..." from `"girl"`/Dani; at `gameTime == 30*4*60+30*5` (4:05)
  it force-calls `game.endGame(false)` — a loss, regardless of score, if the mission runs
  past 4 minutes 5 seconds.
- **Alien, matchType 1** (A Soldiers Demise): identical timer, "Time is up comrads, we
  are all doomed..." from `units[0]`, `endGame(false)` at 4:05.

`Game.as:669-676` — if the Human "Final Deployment" mission is lost (`!param1` at
`destroy(false)`), the game force-sets `postCutFrames=[18]`, `postCutSong=null` and plays
the post-cutscene anyway — a bad-ending comic panel shown only on loss, bypassing the
normal per-mission `postCutFrames` (which is `null` for this mission on a win — see the
per-mission cutscene table).

## 7. Cutscene system (`setCutscene` / `Cutscene.as`)

`setCutscene(preSong, preFrames, postSong, postFrames)` stores directly onto
`MatchSettings.preCutSong/preCutFrames/postCutSong/postCutFrames`. `Game.as:654-656`
starts `Cutscene({"type":"pre"})` before `Game` when `isCampaign && preCutFrames`, and
`{"type":"post"}` after `destroy(true)` when `isCampaign && postCutFrames`. A `null`
frames array for a phase means that phase is skipped entirely (checked via
`Boolean(...CutFrames)`).

`Cutscene` (`Cutscene.as:17`) is a single embedded `MovieClip` (`symbol2111` from
`assets.swf`) — a shared comic-panel timeline used for both Human and Alien campaigns.
`preFrames`/`postFrames` are lists of **frame numbers into that one shared timeline**
(not per-mission clips): the viewer `gotoAndStop(frames[curFrame])`, and "Next"/"Previous"
buttons step through the `frames` array index, not the raw frame number. `frame 22` and
`frame 41` have `addFrameScript` hooks that hide the nav buttons (used for full-bleed
panels); `frame 41` additionally force-plays `M_Warhead`. If a phase's song argument is
non-null, `SH.playMusic(song)` fires once when the `Cutscene` instance is constructed.
On the last frame of a `"pre"` cutscene the button becomes "Start Game" (→
`main.startClass(Game)`); on the last frame of a `"post"` cutscene it becomes "Back to
Campaign" (→ `main.startClass(Menu)`).

### Per-mission cutscene table

| Mission | preSong | preFrames | postSong | postFrames |
|---|---|---|---|---|
| Human 1 | M_Infernal | [13,1,2] | M_Throwdown | [4] |
| Human 2 | — | — | — | — |
| Human 3 | — | — | — | — |
| Human 4 | M_Infernal | [6,8] | — | [10,9] |
| Human 5 | — | — | — | — |
| Human 6 | — | — | — | [14] |
| Human 7 | — | — | — | [11] |
| Human 8 | — | — | M_Infernal | [12,17,5,20] |
| Human 9 | — | — | — | — |
| Human 10 | — | [16] | — | [15] |
| Human 11 | — | [26] | — | [23] |
| Human 12 | — | — | — | — |
| Human 13 | — | [27] | — | [24] |
| Human 14 | — | [28] | M_Warhead | [25,21,19,22] |
| Human 15 | — | — | — | — (see §6 for the loss-only `[18]` override) |
| Alien 1 | M_Theloop | [7,31] | — | [40] |
| Alien 2 | — | — | — | — |
| Alien 3 | M_Rose | [29,30] | — | — |
| Alien 4 | — | — | — | — |
| Alien 5 | — | — | — | — |
| Alien 6 | — | — | — | — |
| Alien 7 | — | — | — | — |
| Alien 8 | — | — | — | [37] |
| Alien 9 | — | — | — | — |
| Alien 10 | — | — | — | [38] |
| Alien 11 | — | — | — | — |
| Alien 12 | — | — | M_Throwdown | [42] |
| Alien 13 | — | — | — | [39] |
| Alien 14 | — | — | M_Infernal | [32,33,34,36,35,41] |

The comic art itself is embedded inside the `symbol2111` DisplayObject in `assets.swf`
(one shared MovieClip timeline reused by every mission's pre/post cutscene, addressed by
frame number); it was not individually exported by this documentation pass (would
require an FFDec export of that one symbol's ~42 frames). The frame numbers above are the
ground truth for which panels exist and in what order they play per mission.

## 8. Campaign UI: Upgrades button, progression, and completion rewards

### "Upgrades" button

`Menu.as:632-634` (button dispatch) → `case 1` at `Menu.as:748-752`:
```
case 1:
   SH.playSound(S_ClickGo);
   cameFrom = menfr.currentLabel;
   Transition.slideLeft(menfr,"Armory");
```
The "Upgrades" button shown on the Human/Alien Campaign select screens is **not a
separate screen** — it is a relabeled shortcut into the same "Armory" frame used from the
main menu (`Menu.as:277`, `case 2` at `:753-761` is the main-menu "Armory" button, same
destination). The Armory frame is the general weapon/ability/equipment purchase screen
(`Stats_Armory.as`, `Stats_Guns.as`, `Stats_Abilities.as`, `Stats_Equipment.as` — out of
scope for this doc) driven by `SD.credits` earned from missions (`Hud.as:442`:
`credits = Math.ceil(rawScore * MatchSettings.creditMod)`, added at `Hud.as:715`;
`MatchSettings.creditMod` is reset to `1` for every campaign mission by `setStats`, i.e.
no per-mission credit multiplier). "Back to Human Campaign" / "Back to Alien Campaign"
(`Menu.as:793-806`, cases 17/18) return from Armory to whichever campaign list was open.

### Mission unlock / progression rules

- `SD.campStage:uint` (`SD.as:61`, persisted, `saveList` includes `"campStage"`) is a
  single counter 0–30 spanning both campaigns: 0–14 = Human missions unlocked-through
  index, 15–29 = Alien. New players start at `campStage=0` (`SD.as:147`).
- **Human Campaign** list (`Menu.as:202-224`): for `_loc1_` 0..14, if
  `_loc1_ <= SD.campStage` the row shows its real title (via
  `Stats_Campaign.setMatch(0,_loc1_)`); otherwise it's greyed out
  (`textColor=13421772`), shown as a lock icon (`gotoAndStop(4)`), with text
  `"Beat level N to unlock"`. The list auto-selects
  `Math.min(SD.campStage, 14)`.
- **Alien Campaign** list (`Menu.as:225-247`): mirrors this but offset by 15 — row
  `_loc1_` is locked if `_loc1_ > SD.campStage - 15`.
- **Unlocking the Alien tab at all**: `Menu.as:197-201` — "Campaign Select" only advances
  past its first frame if `SD.campStage < 15` is false is *not* the gate — re-reading:
  the gate shown is `if(SD.campStage < 15) menfr.nextFrame();` which actually means the
  Campaign Select screen auto-advances one frame while still on the Human-only stage; the
  Alien Campaign button itself is simply always present but its missions are all locked
  (`campStage - 15 < 0` for every row) until `campStage` reaches 15 (i.e. Human campaign
  complete).
- **Progression trigger**: `Game.as:633-652` (`destroy(win:Boolean)`), only when
  `MatchSettings.isCampaign && win`: if `matchType==0 && SD.campStage==matchLevel` (i.e.
  you just beat the exact next unlocked Human stage — no skipping/replaying-to-progress),
  `SD.campStage++`; symmetrically for `matchType==1` against `SD.campStage-15`.
  Replaying an already-beaten mission does not advance `campStage` (the equality check
  fails since `campStage` is already past it).
- One `matchLevel==0` special case: `Menu.as:828-846` — selecting the first Human mission
  when `SD.campStage==0 && !SD.tutWarning` routes to a one-time "Tutorial Warning" screen
  instead of straight into the mission, then sets `SD.tutWarning=true`.

### Campaign-complete rewards

`Stats_Achievements.as:65-72` defines two credit-reward achievements keyed by id
(`achOrder` index 4/5):

| Achievement id | Name | Description | Reward |
|---|---|---|---|
| `humanwin` | "A New Hope" | "Complete the human campaign." | `+500` credits |
| `alienwin` | "A New Era" | "Complete the alien campaign." | `+1000` credits |

`setAchievement(id)` (`:170-215`) grants the credits immediately
(`SD.credits += rew[1]`), plays `S_Medal`, shows the achievement popup, and logs
`Log.CustomMetric("Campaign_Human"/"Campaign_Alien","Matches")`. **Caveat**: this pass
could not find a call site for `Stats_Achievements.setAchievement("humanwin"/"alienwin")`
anywhere in the non-obfuscated decompiled scripts (`Game.as`'s `campStage` increment at
`:641-652` does not call it, nor does `Menu.as`). It is possible the call exists only in
an obfuscated `_2.as` counterpart not read here, or that this reward path is effectively
dead/unreachable in the shipped SWF — worth a follow-up check against the obfuscated
`Game_2.as`/`Menu_2.as` if exact parity matters.

## 9. Port status

Extraction/data: `src/assets/raze2/campaign.json` (30 stages, bots, `messages[]`,
`cutscene{preSong,preFrames,postSong,postFrames}` all present per stage — verified stage
1 matches `Stats_Campaign.as:62-117` verbatim including bot `extra` fields). Adapter:
`src/game/Campaign.ts` (`getCamp`, `campaignMap`). Screen: `src/screens/CampaignScreen.ts`.
Progression/achievements: `src/state/SD.ts`.

| Area | Status | Notes |
|---|---|---|
| 30-mission table (map/mode/cap/teams/diff/skin/music/title/desc) | correct | `campaign.json` matches source per spot-check of stage 1 and the human/alien counts (`grep -c '"stage"'` → 30). `Campaign.ts` maps `mode` string → `dm/tdm/ctf/dom/jug` code and resolves `map` via `campaignMap()`, collapsing "2"/"tut" variants onto shipped geometries — this is a deliberate, documented simplification (not all 20+ Raze 2 maps are shipped). |
| Bot roster (name/team/skin/level/weapon/ability/equip/spawn/aimPlayer/speak) | correct-ish | `toAi()` carries name/team/skin/gun/ability/equip/spawn/aimPlayer through; `diff` is remapped from Raze 2's 1–10 `level` into the port's 0.5–2.4 AI-difficulty scale via `level/4` (a reinterpretation, not a literal port of `setDiffStats()`/level curves) — this is a known, intentional adaptation per the file's own comments, not a bug, but means enemy stat scaling will differ from the original at the extremes. `speak` (portrait/voice-line key on scripted talking bots, e.g. `"speak":"b"` in Human mission 1) is present in the raw JSON `extra` but not consumed by `toAi()` — likely fine since dialogue is driven by `messages[]` separately, but worth confirming no gameplay behavior (e.g. `wait()`/idle stance) hinges on it. |
| Scripted dialogue (`setCampMsg`) | correct (data), consumption unverified | `messages[]` is fully populated per stage (`whoUnit`/`whoPortrait`/`text`/`time`/`speaker`, `{player}` template token for name substitution). Not verified in this pass whether `CampaignScreen`/`GameScreen` actually plays these back in real time keyed to `fc`/score triggers, or whether the non-dialogue side effects in §5 (scripted spawns tied to `fc`, mid-match `SH.playMusic` swaps, the `sn` bitfield death-line gating in Human 15, the Alien-2 AI-diff reboot window) are implemented at all — likely **missing or partial**, since `Campaign.ts`'s own comment says cutscene frames are "unused — no comic art" and makes no mention of a dialogue-playback or scripted-spawn engine. |
| Meteor/hard-timeout endings (Human 15 / Alien 15, 4:05 forced loss) | missing (not checked) | No reference to a `gameTime`-based forced-loss timer was found in the port during this pass; needs verification against `GameScreen`/match-end logic. |
| Cutscene comic viewer (pre/post, `Cutscene.as`) | missing (intentional/documented) | `Campaign.ts`'s comment explicitly says "frames unused — no comic art" — the port carries the cutscene song/frame data through but does not render the comic-panel viewer. The bad-ending Human-15 loss cutscene override (`postCutFrames=[18]` on loss, §6) is very unlikely to be replicated. |
| Mission unlock/progression (`campStage`, sequential, 0–30) | correct | `SD.ts` `curStage`/`addWin()` advances by exactly 1 when the current stage is beaten, matching the source's `campStage==matchLevel` gate; `CampaignScreen.ts` clamps selection to unlocked stages and shows a "Locked — reach Stage N to unlock." message, matching the greyed-out row behavior. |
| Campaign-complete rewards (`humanwin`/`alienwin`, +500/+1000 credits) | correct | `SD.ts:279-290` fires both achievements at `curStage===15` and `curStage===30` respectively, with the exact credit amounts and comments citing the Raze 2 achievement names — this is implemented *more completely* than the traced source (see §8 caveat: the original call site wasn't found), so the port may be doing the "intended" thing even where the SWF's wiring is unclear. |
| Upgrades/Armory access from Campaign screen | missing | `CampaignScreen.ts` has no link to `ArmoryScreen.ts` (grepped for "Armory"/"Loadout" — none found). In the source, "Upgrades" is a first-class button on both Campaign lists routing straight into the Armory/purchase screen; the port's `ArmoryScreen.ts` exists but appears reachable only from elsewhere (e.g. main menu), not from the Campaign flow. |
| matchType 2 "Challenge mode" stub | correct to skip | Confirmed dead/inert in source (§4); the port rightly has no `challenge` arm in `campaign.json` (`human`/`alien` only). |
