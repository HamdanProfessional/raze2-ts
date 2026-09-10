import { Graphics, Text, TextStyle } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT } from "../core/Config";
import {
  FONT_HEADER,
  FONT_VALUE,
  C_HEADER,
  C_LABEL,
  C_OPTIONS_GREEN,
  C_PANEL_HAIRLINE,
  A_HEADER,
  A_LABEL,
} from "../ui/raze2";
import { Sound } from "../audio/Sounds";
import { Anim } from "../assets/Anim";
import { AnimNoArm } from "../assets/AnimNoArm";
import { AnimNoHead } from "../assets/AnimNoHead";
import { HeadArt } from "../assets/HeadArt";
import { SkinArt } from "../assets/SkinArt";
import { SkinAnim } from "../assets/SkinAnim";
import { ArmArt } from "../assets/ArmArt";
import { ArmAnim } from "../assets/ArmAnim";
import { ArmAnim2 } from "../assets/ArmAnim2";
import { PickupArt } from "../assets/PickupArt";
import { PickupWeaponArt } from "../assets/PickupWeaponArt";
import { installGunDrop } from "../assets/GunDrop";
import { Parts } from "../assets/Parts";
import { Backgrounds } from "../assets/Backgrounds";
import { UiArt } from "../assets/UiArt";
import { loadFonts } from "../ui/raze2/fonts";
import { MenuScreen } from "./MenuScreen";

/**
 * Preloads assets then advances straight to the main menu. (The Juice-Tin
 * developer splash and the "click to start" title screen were removed — the
 * menu is the default start screen.) Ported from Loader.as (which showed a
 * loading bar with rotating hints while the SWF streamed in). Here it decodes
 * the audio bank; sprite atlases will join it when the art pipeline is complete.
 */
/** Width of the progress track. */
const BAR_W = 420;
const BAR_H = 6;

export class LoaderScreen extends Screen {
  private label: Text;
  private bar = new Graphics();
  private progress = 0;
  /** Eased toward `progress` so the bar sweeps instead of snapping between the
   *  coarse steps a 14-job loader produces. */
  private shown = 0;
  private done = false;

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    const bg = new Graphics();
    bg.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill(0x0d1014);
    this.view.addChild(bg);

    const title = new Text({
      text: "RAZE 2",
      style: new TextStyle({
        fill: C_HEADER,
        fontFamily: FONT_HEADER,
        fontSize: 44,
        fontWeight: "700",
        letterSpacing: 8,
      }),
    });
    title.anchor.set(0.5);
    title.alpha = A_HEADER;
    title.x = cx;
    title.y = cy - 54;
    this.view.addChild(title);

    // Empty track, drawn once; `bar` paints the filled portion over it.
    const track = new Graphics();
    track.rect(cx - BAR_W / 2, cy, BAR_W, BAR_H).fill({ color: C_PANEL_HAIRLINE, alpha: 0.5 });
    this.view.addChild(track);
    this.view.addChild(this.bar);

    this.label = new Text({
      text: "LOADING  0%",
      style: new TextStyle({
        fill: C_LABEL,
        fontFamily: FONT_VALUE,
        fontSize: 14,
        letterSpacing: 2,
      }),
    });
    this.label.anchor.set(0.5);
    this.label.alpha = A_LABEL;
    this.label.x = cx;
    this.label.y = cy + 26;
    this.view.addChild(this.label);

    void this.preload();
  }

  private drawBar(): void {
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const w = BAR_W * this.shown;
    this.bar.clear();
    if (w <= 0) return;
    this.bar.rect(cx - BAR_W / 2, cy, w, BAR_H).fill({ color: C_OPTIONS_GREEN, alpha: 0.95 });
  }

  private async preload(): Promise<void> {
    // Register + preload the Raze 2 UI kit fonts up front so chrome screens
    // built synchronously afterwards measure text with the correct metrics.
    void loadFonts();
    // Art providers are plain registrations; the textures they reach for are
    // fetched by the jobs below and looked up lazily at draw time.
    installGunDrop(); // real dropped-weapon art for the ragdoll layer
    Parts.install(); // ragdoll limbs use real per-costume art

    // Every loader owns its own cache and reads no other's, so they all run at
    // once — the browser stays saturated instead of idling between phases.
    // Layered per-costume rig (PartArt) stays disabled: the runtime Pixi
    // assembly is bugged and the baked body is the known-good path. (Data and
    // extraction are validated; Unit.updateParts / PartFigure need fixing.)
    const jobs: Promise<unknown>[] = [
      Sound.loadAll(),
      Anim.load(),
      AnimNoArm.load(),
      AnimNoHead.load(),
      HeadArt.load(),
      SkinArt.load(), // Raze 2 baked skin figures (customize/shop previews)
      SkinAnim.load(), // Raze 2 ANIMATED skin bakes for the live in-game unit
      ArmArt.load(),
      ArmAnim.load(), // authentic Raze 2 arm poses; bands stream in on equip
      ArmAnim2.load(), // the back arm — six pose sheets, small enough to hold
      PickupArt.load(),
      PickupWeaponArt.load(), // authentic weapon-pickup floater icons
      Backgrounds.loadCore(), // Raze 1 level art + one thumbnail per Raze 2 map
      UiArt.loadAll(), // title / menu / play backgrounds
    ];

    let done = 0;
    await Promise.all(
      // A loader that fails is not allowed to wedge the screen on "Loading…";
      // each degrades to its own fallback art.
      jobs.map((j) => j.catch(() => {}).then(() => void (this.progress = ++done / jobs.length))),
    );

    // 685 limb files for a layer that only appears when somebody is gibbed.
    // Held back so it doesn't compete for connections with the art the menu
    // needs; it lands long before the player finishes picking a match, and an
    // unloaded limb just falls back to the placeholder.
    void Parts.loadAll();

    this.progress = 1;
    this.done = true;
  }

  enterFrame(dt: number): void {
    this.shown += (this.progress - this.shown) * Math.min(1, 0.18 * dt);
    this.drawBar();
    this.label.text = `LOADING  ${Math.round(this.shown * 100)}%`;
    // Hold until the bar has visibly caught up, so it never cuts away mid-sweep.
    if (this.done && this.shown > 0.995) {
      this.engine.setScreen(MenuScreen);
    }
  }
}
