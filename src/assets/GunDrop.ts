import { Container, Sprite } from "pixi.js";
import { ArmArt } from "./ArmArt";
import { setGunArtProvider, type GunView } from "../physics/RdGun";

/**
 * Real art for the weapon a dead unit drops (GunFall in the original).
 *
 * `physics/RdGun` builds a placeholder grey box unless a provider is installed;
 * this wires in the authentic weapon sprite (the same arm+gun texture used for
 * the held weapon and the floor pickups) so the tumbling dropped gun matches
 * what the unit was carrying. Registered once, after ArmArt has loaded.
 */
export function installGunDrop(): void {
  setGunArtProvider((gunId): GunView | null => {
    const id = String(gunId);
    const tex = ArmArt.getIcon(id);
    if (!tex) return null;

    const view = new Container() as GunView;
    const sp = new Sprite(tex);
    sp.anchor.set(0.5);
    view.addChild(sp);
    // Trimmed art, so the box is the gun's solid body and it tumbles about its
    // own centre rather than the centre of a mostly-empty canvas.
    view.hitWidth = Math.min(tex.width, 60);
    view.hitHeight = Math.min(tex.height, 22);
    return view;
  });
}
