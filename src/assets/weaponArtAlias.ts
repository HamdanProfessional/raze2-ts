/**
 * Held-arm art resolution for every weapon.
 *
 * Each Raze 2 weapon now has its OWN authentic held-arm art, baked from the
 * decompiled `raze-2.swf`: the shared arm pose (DefineSprite_387, one of 6 —
 * pistol/rifle/shotgun/sniper/heavy/rocket) composited with that weapon's unique
 * gun sprite (DefineSprite_380, `curGun.sprite`) at every idle + reload frame,
 * exactly as `Guns.as` layers `arm1` + `arm1.gun.gotoAndStop(curGun.sprite)` at
 * runtime. Those composites live at `public/assets/arms-anim/<id>/<frame>.png`
 * with a matching `armMeta.json` entry, so `ArmArt` loads a weapon's own art
 * directly — no more aliasing 42 guns down onto 6 Raze 1 silhouettes.
 *
 * `artIdFor` therefore returns the id unchanged whenever that id has baked art,
 * which is every one of the 36 catalog guns. The fallback below only serves the
 * type-7 utility weapons (the thrown grenade, mine and katana that Abilities
 * spawns), so they still render an arm rather than nothing.
 */
import META from "./armMeta.json";

/** Every id that has its own baked held-arm art (an armMeta entry + PNG folder). */
const HAS_ART = new Set(Object.keys(META as Record<string, unknown>));

// Fallback only: map an arm POSE (a weapon's `frameIdle`) onto a representative
// baked art id, for ids that lack their own gun art.
const POSE_TO_ART: Record<string, string> = {
  pistol: "pistol",
  shotgun: "shotgun",
  rifle: "arifle",
  rocket: "rocket",
  sniper: "sniper",
  heavy: "chaingun",
};

function fallbackFor(id: string): string {
  if (/grenade|mine|stick/.test(id)) return "sticklaunch";
  return "pistol";
}

/** Resolve a gun id to the art id to actually load. Weapons with bespoke art
 *  resolve to themselves; the rest fall back to a shared pose art. */
export function artIdFor(id: string): string {
  if (HAS_ART.has(id)) return id;
  return POSE_TO_ART[id] ?? fallbackFor(id);
}
