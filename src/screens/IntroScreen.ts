import { Graphics } from "pixi.js";
import { Screen } from "../core/Screen";
import { GAME_WIDTH, GAME_HEIGHT, ASSET_BASE, ASSET_V } from "../core/Config";
import { Sound } from "../audio/Sounds";
import { MenuScreen } from "./MenuScreen";
import introRig from "../assets/introRig.json";

/**
 * The pre-menu Intro timeline (`DefineSprite_1846_Intro`), which the port had
 * previously removed — and with it the only trigger for `S_CamelJizz`
 * (docs/raze2/15-audio-music.md §4).
 *
 * The original is a 393-frame MovieClip: the Juice-Tin swords drop in (frame 1
 * fires `SH.playSound(S_CamelJizz)`), frame 40 starts `M_MenuIntro`, and at the
 * end `Main.renderDone()` starts the Menu with `noMusic:true` so the intro
 * track carries into the front-end. The frames are baked to a WebM by
 * `tools/ui/bake_intro.py`; the entrance frame count is the master clock (the
 * SWF frame scripts are what drive the sound cues), and the video follows it.
 *
 * Click or Escape skips, but not during the first half second so the gesture
 * that unlocks the AudioContext does not also dismiss the splash.
 */
export class IntroScreen extends Screen {
  /** SWF timeline frame, 1-based. */
  private frame = 0;
  private finished = false;
  private video: HTMLVideoElement | null = null;
  private readonly hasDom = typeof document !== "undefined";
  private readonly hasWindow = typeof window !== "undefined";

  constructor(...args: ConstructorParameters<typeof Screen>) {
    super(...args);

    // Black behind the video, and the fallback when there is no DOM (headless).
    const black = new Graphics();
    black.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000 });
    this.view.addChild(black);

    if (this.hasDom) {
      const v = document.createElement("video");
      v.src = `${ASSET_BASE}/${introRig.file}?v=${ASSET_V}`;
      v.muted = true; // audio is the Sounds bank's job, so the mix stays in one place
      v.playsInline = true;
      v.loop = false;
      v.preload = "auto";
      v.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;object-fit:cover;" +
        "pointer-events:none;background:#000;z-index:5;opacity:0;" +
        "transition:opacity 150ms linear";
      v.addEventListener("loadeddata", () => {
        v.style.opacity = "1";
      });
      document.body.appendChild(v);
      void v.play().catch(() => {
        /* autoplay blocked: the frame clock still runs the timeline */
      });
      this.video = v;
    }

    if (this.hasWindow) {
      window.addEventListener("pointerdown", this.onSkip);
      window.addEventListener("keydown", this.onKey);
    }
  }

  private onSkip = (): void => {
    if (this.frame > 15) this.finish();
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && this.frame > 15) this.finish();
  };

  /** Timeline frame 1: `S_CamelJizz`; frame 40: `M_MenuIntro` (`Intro.as`). */
  enterFrame(): void {
    if (this.finished) return;
    this.frame++;
    if (this.frame === introRig.camelFrame) Sound.play("R2_CamelJizz");
    if (this.frame === introRig.menuIntroFrame) Sound.setMusic("R2_MenuIntro");
    if (this.frame >= introRig.frames || this.video?.ended === true) this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.teardownVideo();
    if (this.hasWindow) {
      window.removeEventListener("pointerdown", this.onSkip);
      window.removeEventListener("keydown", this.onKey);
    }
    // `Intro.as:done()` -> `main.startClass(Menu, {"noMusic":true})`: MenuIntro
    // keeps playing on the way in, so the menu must not re-cue its own track.
    this.engine.setScreen(MenuScreen, { noMusic: true });
  }

  private teardownVideo(): void {
    const v = this.video;
    if (!v) return;
    this.video = null;
    v.pause();
    v.style.opacity = "0";
    window.setTimeout(() => v.remove(), 200);
  }

  /** A resize must not rebuild the splash (that would restart the clock). */
  override resize(): void {}

  override destructor(): void {
    this.teardownVideo();
    if (this.hasWindow) {
      window.removeEventListener("pointerdown", this.onSkip);
      window.removeEventListener("keydown", this.onKey);
    }
    super.destructor();
  }
}
