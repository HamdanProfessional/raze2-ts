import { Container, Graphics } from "pixi.js";
import { C_OPTIONS_GREEN, C_TEAM1, C_TEAM2, C_STATUS_LOCKED, C_DIM } from "./palette";

/**
 * Vector glyphs for the eight Raze 2 abilities.
 *
 * Raze 2 drew each ability as an icon clip (`mc_ability` on the Armory frame),
 * but no ability icon art was extracted with this port — `public/assets` has
 * sheets for weapons, skins, heads and pickups only. Rather than fall back on a
 * letter in a box, each ability is drawn here from primitives so the shop and
 * the loadout overview both read as designed art instead of placeholder text.
 *
 * Every glyph is drawn inside a `size`-square box centred on the origin, so a
 * caller only has to position the returned node.
 */

/** Accent colour per ability `type`, so a category reads at a glance. */
export const ABILITY_TYPE_COLOR: Record<string, number> = {
  Offense: C_TEAM2, // orange — the aggressive band
  Defensive: C_TEAM1, // blue
  Utility: C_OPTIONS_GREEN, // the menu accent green
  Relocation: C_STATUS_LOCKED, // pale purple
};

/** Accent for an ability type, falling back to a neutral grey. */
export function abilityTypeColor(type: string): number {
  return ABILITY_TYPE_COLOR[type] ?? C_DIM;
}

/** Draw the glyph for `id` into `g`, centred on the origin. */
function drawGlyph(g: Graphics, id: string, size: number, color: number): void {
  const s = size / 2; // half-extent; glyphs are authored in -s..s
  const line = Math.max(2, Math.round(size * 0.09));
  const stroke = { color, width: line, alpha: 0.95, cap: "round" as const, join: "round" as const };
  const fill = { color, alpha: 0.95 };

  switch (id) {
    // Resupply — a magazine with a chevron feeding into it.
    case "ammo":
      g.roundRect(-s * 0.42, -s * 0.05, s * 0.84, s * 0.92, s * 0.12).fill(fill);
      g.moveTo(-s * 0.4, -s * 0.34).lineTo(0, -s * 0.74).lineTo(s * 0.4, -s * 0.34).stroke(stroke);
      break;

    // Cloak — a head silhouette fading out behind a slash.
    case "cloak":
      g.circle(0, -s * 0.34, s * 0.3).fill({ color, alpha: 0.45 });
      g.moveTo(-s * 0.52, s * 0.62)
        .lineTo(-s * 0.52, s * 0.16)
        .arcTo(-s * 0.52, -s * 0.06, 0, -s * 0.06, s * 0.5)
        .arcTo(s * 0.52, -s * 0.06, s * 0.52, s * 0.16, s * 0.5)
        .lineTo(s * 0.52, s * 0.62)
        .closePath()
        .fill({ color, alpha: 0.45 });
      g.moveTo(-s * 0.7, s * 0.66).lineTo(s * 0.7, -s * 0.74).stroke({ ...stroke, alpha: 1 });
      break;

    // Static Field — a bolt inside a containment ring.
    case "static":
      g.circle(0, 0, s * 0.86).stroke({ color, width: Math.max(1.5, line * 0.6), alpha: 0.5 });
      g.moveTo(s * 0.1, -s * 0.72)
        .lineTo(-s * 0.34, s * 0.06)
        .lineTo(s * 0.02, s * 0.06)
        .lineTo(-s * 0.12, s * 0.74)
        .lineTo(s * 0.36, -s * 0.08)
        .lineTo(-s * 0.01, -s * 0.08)
        .closePath()
        .fill(fill);
      break;

    // Emergency Heal — the medical cross.
    case "heal": {
      const a = s * 0.24, b = s * 0.72;
      g.roundRect(-a, -b, a * 2, b * 2, a * 0.5).fill(fill);
      g.roundRect(-b, -a, b * 2, a * 2, a * 0.5).fill(fill);
      break;
    }

    // Katana — an angled blade with a guard and grip.
    case "sword":
      g.moveTo(-s * 0.62, s * 0.66)
        .lineTo(s * 0.44, -s * 0.72)
        .lineTo(s * 0.68, -s * 0.5)
        .lineTo(-s * 0.38, s * 0.72)
        .closePath()
        .fill(fill);
      g.moveTo(-s * 0.72, s * 0.2).lineTo(-s * 0.12, s * 0.78).stroke(stroke);
      break;

    // Grenade — body, lever and pin ring.
    case "grenade":
      g.circle(0, s * 0.16, s * 0.6).fill(fill);
      g.roundRect(-s * 0.2, -s * 0.62, s * 0.4, s * 0.3, s * 0.08).fill(fill);
      g.moveTo(s * 0.16, -s * 0.56).lineTo(s * 0.56, -s * 0.56).stroke(stroke);
      g.circle(-s * 0.5, -s * 0.52, s * 0.2).stroke(stroke);
      break;

    // Land Mine — a dome on the ground with trigger prongs.
    case "mine":
      g.moveTo(-s * 0.72, s * 0.46)
        .arcTo(-s * 0.72, -s * 0.42, 0, -s * 0.42, s * 0.7)
        .arcTo(s * 0.72, -s * 0.42, s * 0.72, s * 0.46, s * 0.7)
        .closePath()
        .fill(fill);
      g.moveTo(-s * 0.86, s * 0.62).lineTo(s * 0.86, s * 0.62).stroke(stroke);
      g.moveTo(0, -s * 0.44).lineTo(0, -s * 0.86).stroke(stroke);
      g.moveTo(-s * 0.42, -s * 0.3).lineTo(-s * 0.56, -s * 0.7).stroke(stroke);
      g.moveTo(s * 0.42, -s * 0.3).lineTo(s * 0.56, -s * 0.7).stroke(stroke);
      break;

    // Teleport — a figure dissolving into forward chevrons.
    case "teleport":
      g.roundRect(-s * 0.72, -s * 0.6, s * 0.26, s * 1.2, s * 0.1).fill({ color, alpha: 0.9 });
      g.roundRect(-s * 0.28, -s * 0.44, s * 0.2, s * 0.88, s * 0.08).fill({ color, alpha: 0.5 });
      g.moveTo(s * 0.12, -s * 0.54).lineTo(s * 0.5, 0).lineTo(s * 0.12, s * 0.54).stroke(stroke);
      g.moveTo(s * 0.5, -s * 0.54).lineTo(s * 0.86, 0).lineTo(s * 0.5, s * 0.54)
        .stroke({ ...stroke, alpha: 0.5 });
      break;

    // Unknown ability — a neutral marker rather than an empty badge.
    default:
      g.circle(0, 0, s * 0.6).stroke(stroke);
      g.circle(0, s * 0.34, line * 0.5).fill(fill);
      g.moveTo(0, -s * 0.44).lineTo(0, s * 0.02).stroke(stroke);
      break;
  }
}

/**
 * An ability icon in a tinted rounded badge. Returns a container whose origin
 * is the badge's top-left corner.
 *
 * @param id    ability id (`ammo`, `cloak`, …)
 * @param type  ability `type`, which picks the accent colour
 * @param box   badge edge length in px
 * @param muted draw dimmed, for abilities the player has not unlocked
 */
export function makeAbilityIcon(id: string, type: string, box: number, muted = false): Container {
  const c = new Container();
  const color = abilityTypeColor(type);

  const plate = new Graphics();
  plate.roundRect(0, 0, box, box, Math.round(box * 0.22))
    .fill({ color, alpha: muted ? 0.06 : 0.14 })
    .stroke({ color, width: 1, alpha: muted ? 0.25 : 0.55 });
  c.addChild(plate);

  const glyph = new Graphics();
  drawGlyph(glyph, id, box * 0.52, color);
  glyph.x = box / 2;
  glyph.y = box / 2;
  glyph.alpha = muted ? 0.4 : 1;
  c.addChild(glyph);

  return c;
}
